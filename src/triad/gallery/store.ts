/**
 * dsh-chat-plus — 多媒体画廊：跨会话产出物折叠存储（host 半身）。
 *
 * 回答一个问题：**所有对话一共产出了哪些可视文件。**
 *
 * 数据源是会话事件日志（live 内存事件 + 持久化 jsonl.zstd），折叠方式与
 * vendor 化的 usage-skill 完全同构 —— 那套「增量折叠 + 磁盘缓存 +
 * stale-while-revalidate」已经在上千会话的语料上验证过（冷扫分钟级、
 * 稳态毫秒级），这里逐条沿用它的骨架：
 *
 *  · 每会话一份折叠态（consumed 水位 + revision + pending 调用 + items）；
 *  · 持久化会话的 revision 未变则**零 I/O** 跳过；
 *  · 变化/新会话按 FOLD_CONCURRENCY 并发读日志、只折增量；
 *  · live 会话折内存事件尾部；
 *  · 缓存落 <DSH_HOME>/storages/triad-gallery-cache.json（原子写）；
 *  · 请求永不排队等冷扫：先回磁盘缓存渲染的 stale 快照，后台刷新。
 *
 * 提取本身不在这里做 —— 见 ./extract.ts（复用 client/kr-chat/outputs.ts 的
 * 全部纯函数，两条链路口径同源）。
 *
 * 约束：零 @deepseek-ai 运行时导入（build.mjs assertHostExternals）。
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import {
  extractFromEventPair,
  extractFromPtcDispatch,
  galleryDedupeKey,
  type GalleryRawItem,
  type PtcDispatchEvent,
  type ToolCallEvent,
  type ToolResultEvent,
} from './extract.ts'

/**
 * 缓存格式版本：形状变更时 +1，强制一次全量重折。
 *
 * v2（2026-10-05）：折叠新增 `tool/ptc-dispatch` 通道（PTC 沙箱里的 present /
 * generate_image 子调用）。旧缓存里这些条目**一条都没有**，而 revision 未变的
 * 会话会被整段跳过（零 I/O）—— 不升版本号，用户升级后点开旧会话的图片依然是
 * 403，直到那个会话自己再有新事件。
 */
const CACHE_VERSION = 2

/** 单会话最多保留的条目数（防一个截图狂魔会话吃掉整个响应）。 */
const MAX_ITEMS_PER_SESSION = 500

/** pending tool/call 的 arguments 存储上限（run_code 代码体可能很大）。 */
const MAX_PENDING_ARGS = 256 * 1024

/** 一次折叠最多同时打开几个会话日志（与 usage-skill 同值）。 */
const FOLD_CONCURRENCY = 8

/** 响应里最多返回的条目数（按时间降序截断）。 */
export const MAX_RESPONSE_ITEMS = 2000

/**
 * 首轮对账时每折多少个会话就落一次盘、刷一次内存快照。
 *
 * 取 50：分片写入是几十个几百字节的小文件，50 个一批约 20~40KB，代价可以忽略；
 * 而用户在中途打开画廊能看到「已经折好的最近 50 个会话」，体感差别很大。
 */
const FLUSH_EVERY = 50

/**
 * 单轮聚合最多折多少个会话，剩下的留给后续轮次。
 *
 * 为什么必须限量（2026-10-05 实测）：会话日志分两代，**老格式（v0~v3）每个要
 * 1.35~2.0 秒**（官方 `open()` 要先把它迁移成当前格式），新格式只要 9~212ms。
 * 本机 1485 个会话里绝大部分是老格式 —— 一次性折全库是 4~5 分钟，期间用户看到的
 * 永远是空画廊。
 *
 * 限量后配合 mtime 降序（最近动过的先折），第一轮 240 个大约 30~45 秒就能给出
 * 「最近会话的全部产出物」，剩下的在后续轮次里陆续补齐。未折完时 `reconciled`
 * 不置位，响应持续带 `stale`，前端那条「正在后台扫描」的提示与 2.5 秒重拉正好
 * 把补齐过程呈现成渐进加载。
 */
const ROUND_FOLD_LIMIT = 240

/* ── 折叠态 ──────────────────────────────────────────────────────────── */

/** 一个还没等到结果的 tool/call（跨 fold 切片携带）。 */
interface PendingCall {
  readonly name: string
  readonly arguments: string
  readonly time: number
}

/** 单会话折叠态。 */
interface SessionState {
  kind: 'live' | 'persisted'
  /** 已折叠到的事件 seq（增量水位）。 */
  consumed: number
  /** 持久化后端的不透明修订号（未变则跳过读取）。 */
  revision?: string
  /**
   * 会话日志所在目录（目录扫描拿到；有它就能跳过 `persistence.list()` 那个
   * 全量 header 解析——本机实测 40 秒 → 0.1 秒）。
   */
  dir?: string
  /** 日志文件 mtime（毫秒）：目录扫描的便宜水位，用来避免不必要的重折。 */
  mtimeMs?: number
  /** 会话标题（session/title 事件，last-wins）。 */
  title: string | null
  /** 会话工作区（相对路径基准）。 */
  cwd: string | null
  /** 最后一条产出事件的时间（排序用）。 */
  lastTime: number
  /** callId → 未配对的调用。 */
  pending: Map<string, PendingCall>
  /** 已提取的画廊条目（首见顺序）。 */
  items: GalleryRawItem[]
}

function createState(): SessionState {
  return { kind: 'persisted', consumed: 0, title: null, cwd: null, lastTime: 0, pending: new Map(), items: [] }
}

/** 折叠态 → 可序列化形状。 */
function serializeSession(state: SessionState): Record<string, unknown> {
  const pending: Record<string, PendingCall> = {}
  for (const [id, call] of state.pending) pending[id] = call
  return {
    kind: state.kind,
    consumed: state.consumed,
    ...(state.revision === undefined ? {} : { revision: state.revision }),
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    ...(state.mtimeMs === undefined ? {} : { mtimeMs: state.mtimeMs }),
    title: state.title,
    cwd: state.cwd,
    lastTime: state.lastTime,
    pending,
    items: state.items,
  }
}

/** 序列化形状 → 折叠态（宽容解析：坏字段回落默认，绝不让整个缓存报废）。 */
function parseSession(raw: unknown): SessionState {
  const state = createState()
  if (raw === null || typeof raw !== 'object') return state
  const record = raw as Record<string, unknown>
  state.kind = record.kind === 'live' ? 'live' : 'persisted'
  state.consumed = Number.isSafeInteger(record.consumed) ? (record.consumed as number) : 0
  if (typeof record.revision === 'string') state.revision = record.revision
  if (typeof record.dir === 'string' && record.dir !== '') state.dir = record.dir
  if (Number.isFinite(record.mtimeMs)) state.mtimeMs = record.mtimeMs as number
  if (typeof record.title === 'string' && record.title !== '') state.title = record.title
  if (typeof record.cwd === 'string' && record.cwd !== '') state.cwd = record.cwd
  if (Number.isFinite(record.lastTime)) state.lastTime = record.lastTime as number
  if (record.pending !== null && typeof record.pending === 'object') {
    for (const [id, call] of Object.entries(record.pending as Record<string, unknown>)) {
      if (call === null || typeof call !== 'object') continue
      const c = call as Record<string, unknown>
      if (typeof c.name !== 'string') continue
      state.pending.set(id, {
        name: c.name,
        arguments: typeof c.arguments === 'string' ? c.arguments : '',
        time: Number.isFinite(c.time) ? (c.time as number) : 0,
      })
    }
  }
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      if (item === null || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      if (typeof it.path !== 'string' || typeof it.kind !== 'string') continue
      if (state.items.length >= MAX_ITEMS_PER_SESSION) break
      state.items.push({
        path: it.path,
        name: typeof it.name === 'string' ? it.name : it.path,
        kind: it.kind as GalleryRawItem['kind'],
        source: it.source === 'generated' ? 'generated' : 'file',
        time: Number.isFinite(it.time) ? (it.time as number) : 0,
      })
    }
  }
  return state
}

/* ── 磁盘缓存 ────────────────────────────────────────────────────────── */

interface GalleryCache {
  version: number
  sessions: Record<string, SessionState>
  /**
   * 还没裁定的老单文件（v1）折叠态，原样挂着等 root 就绪。
   *
   * 为什么延后裁定：裁定要拿每个会话的日志 mtime（见 PTC_EPOCH_MS），而那要
   * 扫会话目录；`loadCache()` 可能在 `persistenceRoot` 尚未登记时就被
   * `warmGallerySnapshot()` 调到（挂载即预热）。挂起来、等第一次真正聚合时再裁，
   * 两个动作的先后顺序就无关了。
   */
  legacyPending: Record<string, unknown> | null
}

/** 每会话一个缓存分片 —— 形状变更只废掉受影响的那批，不必全库重折。 */
interface SessionShard {
  /** 折叠该会话所用的事件提取形状版本（!= CACHE_VERSION 时单独重折）。 */
  shape: number
  state: SessionState
}

function cachePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'triad-gallery-cache.json')
}

/**
 * 分片目录：`<DSH_HOME>/storages/triad-gallery/<会话 id>.json`。
 *
 * 为什么不继续用单文件：一个 `CACHE_VERSION` 变更会让**全部会话**的折叠态作废，
 * 下次聚合要把全库重折一遍 —— 本机 1485 个会话、1GB 日志，单会话最重 834ms，
 * 全量重折是分钟级。分片后 `shape` 版本**按会话比对**，只有提取逻辑真的影响到
 * 的那批才重折（例如新增 PTC 通道时，只重折 2026-10-05 之后写过的会话）。
 *
 * 分片还顺带解决写入成本：单文件缓存每次聚合都要把全部折叠态序列化一遍
 * （488KB），分片只写**这一轮真的动过**的那几个会话。
 */
function shardDir(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'triad-gallery')
}

/** 会话 id → 分片文件名。id 里可能有的怪字符一并编码，避免非法文件名。 */
function shardFileNameOf(id: string): string {
  return encodeURIComponent(id).replace(/%/g, '_') + '.json'
}

/** 分片文件名 → 会话 id；形状不对返回 null。 */
function shardIdOf(name: string): string | null {
  if (!name.endsWith('.json')) return null
  try {
    return decodeURIComponent(name.slice(0, -'.json'.length).replace(/_/g, '%'))
  } catch {
    return null
  }
}

/** 会话 id → 分片文件路径。 */
function shardPathOf(id: string): string {
  return join(shardDir(), shardFileNameOf(id))
}

/**
 * 裁定老单文件缓存（v1）里哪些会话的折叠态可以直接继承。
 *
 * v2 提取相对 v1 只多一条 PTC 子调用通道，而这类事件**只可能出现在
 * PTC_EPOCH_MS 之后写过的日志里**：那一刻之前没再动过的会话，日志内容自那时起
 * 就没变，折叠态语义等价，直接继承（本机 1464/1485 属于这一类）。
 * 其余（日志已消失、或那一刻之后还在写）一律重折。
 *
 * 继承时必须把 mtime / revision / dir 一起补上：老折叠态没有这些字段，不补的话
 * 下一轮扫描会拿真实 mtime 与 undefined 比、判「变了」，豁免就白做了。
 *
 * @param pending - 老单文件里的 sessions 映射。
 * @param scan - 会话目录扫描结果（root 未就绪时传 null，此时不继承任何一条）。
 * @returns 可继承的折叠态（调用方逐条写进 cache 并标脏）。
 */
function adoptLegacySessions(
  pending: Record<string, unknown>,
  scan: ScanSnapshot | null,
): Map<string, SessionState> {
  const adopted = new Map<string, SessionState>()
  if (scan === null) return adopted
  const byId = new Map<string, ScanEntry>()
  for (const entry of scan.entries) byId.set(entry.id, entry)
  for (const [id, entry] of Object.entries(pending)) {
    if (typeof id !== 'string' || id.length === 0) continue
    const hit = byId.get(id)
    if (hit === undefined || hit.mtimeMs >= PTC_EPOCH_MS) continue
    const state = parseSession(entry)
    state.mtimeMs = hit.mtimeMs
    state.revision = scanRevisionOf(hit)
    state.dir = hit.dir
    adopted.set(id, state)
  }
  return adopted
}

/** 哪些折叠态在本轮被动过（只写这些分片，省掉全量序列化）。 */
const dirtySessions = new Set<string>()

let loadedCache: GalleryCache | null = null
let loadPromise: Promise<GalleryCache> | null = null
let inflight: Promise<GalleryResponse> | null = null

/** 读一个分片；形状版本不匹配或损坏时返回 null（该会话单独重折）。 */
async function readShard(id: string): Promise<SessionState | null> {
  try {
    const raw = await readFile(shardPathOf(id), 'utf8')
    const parsed = JSON.parse(raw) as { shape?: unknown; state?: unknown }
    if (parsed === null || typeof parsed !== 'object') return null
    // shape 不匹配 = 这一份折叠态是用旧提取规则做的：只重折它，其余分片照用。
    if (parsed.shape !== CACHE_VERSION) return null
    return parseSession(parsed.state)
  } catch {
    return null
  }
}

/**
 * 加载缓存：先读老的单文件缓存（一次性迁移），再逐分片读。
 *
 * 老单文件**只有在版本号完全匹配时**才整体接受：它的折叠态没有逐会话的提取形状
 * 版本（分片才有 `shape` 字段），一旦提取规则变过（例如 v2 新增 PTC 通道），
 * 沿用老折叠态就等于把「漏掉的那批产出物」继续漏下去 —— 正是要修的那个 403。
 * 宁愿付一次全量重折，也不能把错的索引接着用。
 *
 * 老单文件不会被静默删除（不做无提示的删盘）；它已经判废，留着只是占 488KB。
 */
async function loadCache(): Promise<GalleryCache> {
  if (loadedCache !== null) return loadedCache
  loadPromise ??= (async () => {
    const sessions: Record<string, SessionState> = {}
    let legacyPending: Record<string, unknown> | null = null
    // 1) 老单文件缓存：同版本整体继承；v1 → v2 的裁定延后（见 legacyPending 说明）。
    try {
      const raw = await readFile(cachePath(), 'utf8')
      const parsed = JSON.parse(raw) as { version?: unknown; sessions?: Record<string, unknown> }
      if (parsed !== null && typeof parsed === 'object' && parsed.sessions !== null
        && typeof parsed.sessions === 'object') {
        if (parsed.version === CACHE_VERSION) {
          for (const [id, entry] of Object.entries(parsed.sessions ?? {})) {
            if (typeof id === 'string' && id.length > 0) sessions[id] = parseSession(entry)
          }
        } else if (parsed.version === 1) {
          legacyPending = parsed.sessions as Record<string, unknown>
        }
      }
    } catch { /* 首跑或老缓存不存在 */ }
    // 2) 分片目录：这是主存储。
    try {
      const names = await readdir(shardDir())
      await runPooled(names, FOLD_CONCURRENCY, async (name) => {
        if (!name.endsWith('.json')) return
        const id = shardIdOf(name)
        if (id === null) return
        const state = await readShard(id)
        if (state !== null) sessions[id] = state
      })
    } catch { /* 还没有分片目录 */ }
    return { version: CACHE_VERSION, sessions, legacyPending }
  })()
  loadedCache = await loadPromise
  return loadedCache
}

/** 原子写一个分片（tmp + rename）；失败只记日志。 */
async function saveShard(
  logger: { warn?: (msg: string) => void } | undefined,
  id: string,
  state: SessionState,
): Promise<void> {
  try {
    const dir = shardDir()
    await mkdir(dir, { recursive: true })
    const path = shardPathOf(id)
    const payload: SessionShard = { shape: CACHE_VERSION, state }
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(payload), 'utf8')
    await rename(tmp, path)
  } catch (error) {
    logger?.warn?.(`[dsh-chat-plus] gallery: 保存会话分片失败: ${String(error)}`)
  }
}

/** 切换数据来源时清空（冒烟/测试用）。 */
function resetCacheForTest(): void {
  loadedCache = null
  loadPromise = null
  inflight = null
  cachedResponse = null
  lastCollectTime = 0
  reconciled = false
  dirtySessions.clear()
}

/**
 * 落盘本轮被动过的分片，并删掉已消失会话的分片。
 *
 * @param cache - 内存折叠态。
 * @param removed - 本轮确认已消失的会话 id。
 * @param logger - 日志出口。
 */
async function saveDirtyShards(
  cache: GalleryCache,
  removed: readonly string[],
  logger: { warn?: (msg: string) => void } | undefined,
): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const id of dirtySessions) {
    const state = cache.sessions[id]
    if (state === undefined) continue
    jobs.push(saveShard(logger, id, state))
  }
  dirtySessions.clear()
  for (const id of removed) {
    jobs.push((async () => {
      try { await rm(shardPathOf(id), { force: true }) } catch { /* 删不掉不影响正确性 */ }
    })())
  }
  await Promise.all(jobs)
}

/* ── 事件读取（跨宿主代际兼容，逐字沿用 usage-skill 的手法）────────────── */

interface PersistedEvent {
  type: string
  seq?: number
  time?: number
  data?: Record<string, unknown>
}

/**
 * 单次读日志的事件数上限。
 *
 * 卡在 5 万而不是无限：首次遇到一个超长会话时最多先折 5 万条，剩余部分由下一轮
 * 聚合从 `consumed` 水位续上（`foldPersistedSession` 本来就是这个语义）。
 * 没有它，一个 10 万事件的会话会把并发池的一个槽占住几十秒。
 */
const MAX_EVENTS_PER_READ = 50_000

/*
 * 为什么**不**自己解 zstd 文件（2026-10-05 试过并撤回）：
 *
 * 磁盘上的 `session.jsonl.zstd` 是**物理事件**（可能是 v0/v2/v3 格式），而
 * 官方 `persistence.open()` 交给调用方的是**迁移后的 v4 逻辑事件流**：
 * 老会话里的 `tool/code-dispatch` 会被重写成 `tool/ptc-dispatch`，还会补出
 * `system/message` 这类新事件。画廊认的正是 `tool/ptc-dispatch` —— 自己解
 * 原始文件，9 月以前的老会话里 PTC 子调用（present / generate_image 交付的
 * 文件）**一条都提不到**：索引里少一批条目，`/raw` 准入跟着拒，用户看到的是
 * 「产出物卡列着、点开 403」。
 *
 * 实测对拍：同一个会话自己解得 350 条、官方给 80 条，官方独有的是迁移产物，
 * 自己独有的是官方刻意丢掉的 chunk 流 —— 两边都不等价，而**只有官方那份是对的**。
 * 迁移语义属于 DSH，插件复刻一遍就是等着它改版后静默跑偏。
 */

/**
 * 读一个持久化会话的事件日志（增量：从 `offset` 起）。
 *
 * 一律走官方 `persistence.open()`：只有它会给**迁移后的逻辑事件流**（见上方
 * 撤回说明），自己解磁盘原始文件会静默丢掉 PTC 通道。
 *
 * `dir` 参数保留但只作诊断用 —— `open()` 的入参是会话 id，官方 `findLog()`
 * 已经会按 id 定位到唯一那份日志，插件再传目录没有额外收益。
 *
 * @param persistence - sessionPersistence service。
 * @param id - 会话 id。
 * @param offset - 起始逻辑 seq（增量水位）。
 */
async function readPersistedEvents(
  persistence: Record<string, any>,
  id: string,
  offset = 0,
): Promise<PersistedEvent[]> {
  // 旧宿主（DSH 0.1.5 之前）只有 readFrom，没有 open。
  if (typeof persistence.open !== 'function') {
    if (typeof persistence.readFrom !== 'function') return []
    try {
      const { events } = await persistence.readFrom(id, offset)
      return [...(events ?? [])] as PersistedEvent[]
    } catch { return [] }
  }
  let handle
  try {
    handle = await persistence.open(id, 'read')
  } catch { return [] }
  try {
    /*
     * **一次读满**，不要按小批次循环。
     *
     * 官方 handle 的 `read()` 内部每次都把整份日志从磁盘重解一遍再切片
     * （`readCurrent` → `readStoredLog`，且带「读到的长度不能比上次短」的
     * 单调性断言，因此它自己也不会替调用方省这次重解）。按 2000 一批循环读一个
     * 20864 事件的会话 = 重解 11 遍，实测把首轮对账拖成了分钟级。
     * 一次读到上限，多数会话一次结束；真的超上限时再补一次。
     */
    const events: PersistedEvent[] = []
    let cursor = offset
    while (events.length < MAX_EVENTS_PER_READ) {
      const want = MAX_EVENTS_PER_READ - events.length
      const slice = await handle.read(cursor, want)
      const batch = (slice?.events ?? []) as PersistedEvent[]
      if (batch.length === 0) break
      for (const event of batch) events.push(event)
      const last = batch[batch.length - 1]
      cursor = typeof last?.seq === 'number' ? last.seq + 1 : cursor + batch.length
      // 没读满请求量 = 已经到日志末尾，不必再让它重解一遍。
      if (batch.length < want) break
    }
    return events
  } catch {
    return []
  } finally {
    try { await handle.close() } catch { /* 收尾失败不掩盖读取结果 */ }
  }
}

/**
 * PTC 子调用通道（`tool/ptc-dispatch`）进入提取规则的时刻。
 *
 * v2 提取相对 v1 只多了一条通道：PTC 沙箱里的 present / generate_image 子调用。
 * 这类事件**只可能出现在这个时刻之后写过的日志里** —— 早于它的会话，日志内容
 * 自那时起就没变过（变了的话 mtime 会更新），沿用 v1 的折叠态在语义上完全等价。
 *
 * 用途只有一个：老单文件缓存（v1，没有逐会话 shape）迁移到分片时，别把 1464 个
 * 不可能含 PTC 事件的旧会话白折一遍（实测老格式会话每个 1.35~2.0 秒，全量重折
 * 是 5 分钟，而豁免后只需重折 07-05 之后动过的 21 个）。
 *
 * 这是一次性迁移的判据，**只对 v1→v2 这一次有效**；后续再改提取规则时，缓存里
 * 已经有了逐会话的 `shape` 字段，直接比版本号即可，不需要新的时间点常量。
 */
const PTC_EPOCH_MS = Date.parse('2026-10-05T00:00:00+08:00')

/** 目录扫描合成 revision 的前缀（见 scanSessionDirs）。 */
const SCAN_REV_PREFIX = 'scan:'

/** 合成 revision：mtime（毫秒）+ 字节数，判「这份日志动过没有」足够。 */
function scanRevisionOfParts(mtimeMs: number, size: number): string {
  return `${SCAN_REV_PREFIX}${mtimeMs}:${size}`
}

/** 扫描条目 → 合成 revision。 */
function scanRevisionOf(entry: ScanEntry): string {
  return scanRevisionOfParts(entry.mtimeMs, entry.size)
}

/**
 * revision 是否对应同一份物理文件状态。
 * DSH 会给历史格式的 revision 追加语料级 hash（任何会话被碰过都会变），
 * 而 dev:ino:size:mtime:ctime 五段不变则内容必然不变 —— 与 usage-skill 同判据。
 *
 * 本插件自己扫目录时用的是 `scan:<mtimeMs>:<size>` 两段式合成 revision
 * （见 scanSessionDirs）：没有物理身份那五段，只能全等比较；与后端的五段式
 * 混在一起时一律判「变了」，宁可多折一次也不漏。
 */
function sameFileRevision(a: string | undefined, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.startsWith(SCAN_REV_PREFIX) || b.startsWith(SCAN_REV_PREFIX)) {
    return a.startsWith(SCAN_REV_PREFIX) && a === b
  }
  const aParts = a.split(':')
  const bParts = b.split(':')
  if (aParts.length >= 5 && bParts.length >= 5) {
    return aParts[0] === bParts[0] && aParts[1] === bParts[1]
      && aParts[2] === bParts[2] && aParts[3] === bParts[3] && aParts[4] === bParts[4]
  }
  return false
}

/* ── 便宜扫描：直接读会话目录，绕开后端的全量 header 解析 ─────────────── */

/** 一次会话目录扫描的结果：物理身份 + mtime（毫秒）。 */
interface ScanEntry {
  readonly id: string
  /** 目录名（= 会话 id 的编码形态），读日志时直接用，免去再走 findLog。 */
  readonly dir: string
  /** 挑中的日志文件名（一个目录里可能有多个 format generation，见下）。 */
  readonly file: string
  readonly mtimeMs: number
  readonly size: number
}

/** 一次扫描的结果，带扫描时刻（水位判据）。 */
interface ScanSnapshot {
  readonly root: string
  /** 扫描完成时刻（毫秒）：晚于它的变化留给下一轮，避免与扫描赛跑。 */
  readonly scannedAt: number
  readonly entries: readonly ScanEntry[]
}

/**
 * 直接扫 DSH 的会话目录，绕开 `persistence.list()`。
 *
 * 为什么必须自己扫（2026-10-05 实测）：后端 `list()` 要为每个会话文件重新解一遍
 * header 才能算出 opaque revision，本机 1386 会话要 37~46 秒；同样这批文件用
 * `readdir` + `stat` 只要 **120ms**（readdir 87ms + stat 34ms）。快 300 倍。
 *
 * 目录布局照抄官方 `listProjectDirs`/`listSessionDirs`：
 *  `<DSH_HOME>/sessions/<projectKey>/<encodeSegment(id)>/<generationFilename>`。
 * 生成文件名只是「谁最大取谁」的 tie-break：同一个会话目录里一般只有一份
 * `session.jsonl.zstd`，多份也只关心 mtime 最大的那份。
 *
 * 拿不到 root（老宿主没暴露，或目录不存在）时返回 null —— 调用方回落
 * `persistence.list()`，功能不降级，只是慢回老样子。
 */
async function scanSessionDirs(root: string | null): Promise<ScanSnapshot | null> {
  if (root === null || root === '') return null
  const entries: ScanEntry[] = []
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = join(root, project.name)
    let sessions
    try {
      sessions = await readdir(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const dir = join(projectDir, session.name)
      let files
      try {
        files = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      /*
       * 一个会话目录里可能有多个 format generation（`session.jsonl.zstd` /
       * `session.v3.jsonl.zstd` / `session.v4.jsonl.zstd` …，本机 1485 个会话里
       * 44 个是这种）。取 **mtime 最大**的那份当代表：官方按版本号取最高，而迁移
       * 之后最新的那份必然也是最后写过的，两者在正常语料上一致。
       */
      let best: { file: string; mtimeMs: number; size: number } | null = null
      for (const file of files) {
        if (!file.isFile() || !/\.jsonl(\.zstd)?$/i.test(file.name)) continue
        try {
          const info = await stat(join(dir, file.name))
          const mtimeMs = info.mtimeMs
          if (best === null || mtimeMs > best.mtimeMs) best = { file: file.name, mtimeMs, size: info.size }
        } catch { /* 单个文件读不到不影响其余会话 */ }
      }
      if (best === null) continue
      entries.push({ id: session.name, dir, file: best.file, mtimeMs: best.mtimeMs, size: best.size })
    }
  }
  return { root, scannedAt: Date.now(), entries }
}

/** 并发池（与 usage-skill 同实现）。 */
async function runPooled<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const size = Math.max(1, Math.min(limit, items.length))
  const runners: Promise<void>[] = []
  for (let slot = 0; slot < size; slot += 1) {
    runners.push((async () => {
      for (;;) {
        const index = next
        next += 1
        if (index >= items.length) return
        await worker(items[index])
      }
    })())
  }
  await Promise.all(runners)
}

/* ── 折叠 ─────────────────────────────────────────────────────────────── */

/** 把一段新事件折进会话态（tool/call ↔ tool/result 按 callId 配对）。 */
function foldEvents(state: SessionState, events: readonly PersistedEvent[]): void {
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const data = (event.data ?? {}) as Record<string, unknown>
    if (event.type === 'session/title') {
      const title = data.title
      if (typeof title === 'string' && title !== '') state.title = title
      continue
    }
    if (event.type === 'tool/call') {
      const callId = data.callId
      if (typeof callId !== 'string' || callId === '') continue
      const args = typeof data.arguments === 'string' ? data.arguments : ''
      state.pending.set(callId, {
        name: typeof data.name === 'string' ? data.name : '',
        arguments: args.length > MAX_PENDING_ARGS ? args.slice(0, MAX_PENDING_ARGS) : args,
        time: Number.isFinite(event.time) ? (event.time as number) : Date.now(),
      })
      continue
    }
    if (event.type === 'tool/result') {
      const message = data.message as Record<string, unknown> | undefined
      const callId = message?.toolCallId
      if (typeof callId !== 'string') continue
      const pending = state.pending.get(callId)
      if (pending === undefined) continue
      state.pending.delete(callId)
      const callEvent: ToolCallEvent = {
        type: 'tool/call',
        time: pending.time,
        data: { callId, name: pending.name, arguments: pending.arguments },
      }
      const resultEvent: ToolResultEvent = {
        type: 'tool/result',
        time: Number.isFinite(event.time) ? (event.time as number) : pending.time,
        data: { message: message as ToolResultEvent['data']['message'] },
      }
      mergeItems(state, extractFromEventPair(callEvent, resultEvent, { cwd: state.cwd }))
      continue
    }
    /*
     * PTC 沙箱子调用（run_code 代码体里调的 present / generate_image / pwsh…）。
     *
     * 这类调用**没有** tool/call 与 tool/result 事件，参数与结果都挂在这一条
     * dispatch 上（callId 形如 `<rootCallId>:ptc:<n>`）。2026-10-05 前只折
     * tool/result，于是模型在 run_code 里 present 交付的文件从未进过索引：
     * 产出物卡能列出那一行（client 侧读同一批事件），点开却走 /raw 403 ——
     * 用户看到的就是「点图片加载不出来，点侧栏按钮却能加载」（侧栏走官方
     * workspaceFiles，与这条准入名单无关）。
     */
    if (event.type === 'tool/ptc-dispatch') {
      mergeItems(state, extractFromPtcDispatch(event as unknown as PtcDispatchEvent, { cwd: state.cwd }))
    }
  }
}

/**
 * 把一批新条目并进会话态（会话内去重：同一路径只留一条，时间取最新）。
 *
 * 抽成函数是因为有两条事件通道（tool/result 与 tool/ptc-dispatch）要合并进
 * 同一份清单，去重与截断口径必须逐字一致 —— 复制一份迟早会分叉。
 */
function mergeItems(state: SessionState, extracted: readonly GalleryRawItem[]): void {
  for (const item of extracted) {
    if (state.items.length >= MAX_ITEMS_PER_SESSION) break
    const key = galleryDedupeKey(item.path)
    const prior = state.items.find((existing) => galleryDedupeKey(existing.path) === key)
    if (prior !== undefined) {
      if (item.time > prior.time) {
        state.items[state.items.indexOf(prior)] = item
        state.lastTime = Math.max(state.lastTime, item.time)
      }
      continue
    }
    state.items.push(item)
    state.lastTime = Math.max(state.lastTime, item.time)
  }
}

/** 折一个持久化会话的增量（失败保留旧折叠态，绝不抹历史）。 */
async function foldPersistedSession(
  persistence: Record<string, any>,
  id: string,
  revision: unknown,
  previous: SessionState | undefined,
  cwdFromHeader: string | null,
): Promise<SessionState> {
  const state = previous ?? createState()
  const wasPersisted = state.kind === 'persisted'
  const fromSeq = wasPersisted ? state.consumed : 0
  const events = await readPersistedEvents(persistence, id, fromSeq)
  if (!wasPersisted) {
    // live → persisted 迁移：整段重折（内存事件可能没进过折叠）。
    state.pending = new Map()
    state.items = []
    state.consumed = 0
    state.lastTime = 0
  }
  if (cwdFromHeader !== null && state.cwd === null) state.cwd = cwdFromHeader
  const fresh = wasPersisted ? events.filter((event) => (event.seq ?? 0) > state.consumed) : events
  if (fresh.length === 0) {
    // 没有新事件：稳态。不动折叠态（与 usage-skill 的空 delta 语义一致）。
  } else if (state.consumed > 0 && (fresh[0]?.seq ?? 0) !== state.consumed + 1) {
    // 有新事件却接不上：日志被截断/重写，从头重折。
    state.pending = new Map()
    state.items = []
    state.consumed = 0
    state.lastTime = 0
    const allEvents = await readPersistedEvents(persistence, id, 0)
    foldEvents(state, allEvents)
    state.consumed = allEvents.length > 0 ? (allEvents[allEvents.length - 1]?.seq ?? 0) : 0
  } else {
    foldEvents(state, fresh)
    state.consumed = fresh[fresh.length - 1]?.seq ?? state.consumed
  }
  state.kind = 'persisted'
  if (typeof revision === 'string') state.revision = revision
  return state
}

/* ── 响应渲染 ─────────────────────────────────────────────────────────── */

/** 一条对外条目（stat 核对由 host 路由层做）。 */
export interface GalleryItemView {
  readonly path: string
  readonly name: string
  readonly kind: GalleryRawItem['kind']
  readonly source: 'file' | 'generated'
  readonly time: number
  readonly sessionId: string
}

/** 一个有产出的会话。 */
export interface GallerySessionView {
  readonly id: string
  readonly title: string | null
  readonly cwd: string | null
  readonly count: number
  readonly lastTime: number
}

export interface GalleryResponse {
  readonly items: readonly GalleryItemView[]
  readonly sessions: readonly GallerySessionView[]
  readonly truncated: boolean
}

/** 把整份缓存渲染成响应（路径全局去重，时间降序，截断到上限）。 */
function renderCache(cache: GalleryCache): GalleryResponse {
  const byPath = new Map<string, GalleryItemView>()
  const sessions: GallerySessionView[] = []
  for (const [id, state] of Object.entries(cache.sessions)) {
    if (state.items.length === 0) continue
    sessions.push({ id, title: state.title, cwd: state.cwd, count: state.items.length, lastTime: state.lastTime })
    for (const item of state.items) {
      const key = galleryDedupeKey(item.path)
      const prior = byPath.get(key)
      const view: GalleryItemView = { ...item, sessionId: id }
      // 同一路径出现在多个会话：留时间最新的那条。
      if (prior === undefined || view.time > prior.time) byPath.set(key, view)
    }
  }
  const items = [...byPath.values()].sort((a, b) => b.time - a.time)
  const truncated = items.length > MAX_RESPONSE_ITEMS
  return { items: truncated ? items.slice(0, MAX_RESPONSE_ITEMS) : items, sessions, truncated }
}

/* ── 聚合入口（TTL + stale-while-revalidate，与 usage-skill 同节奏）────── */

/** 聚合结果缓存（渲染后的响应 + 时间戳）。 */
let cachedResponse: GalleryResponse | null = null
let lastCollectTime = 0
/**
 * 当前这份 `cachedResponse` 是否已经过**本轮的真实折叠**对过账。
 *
 * 分两种来源：`warmGallerySnapshot()` 与冷启动的磁盘缓存直读都只把**上次落盘的
 * 折叠态**渲染出来（快，但可能已经过期甚至为空）；只有跑完一次 `collectLocked`
 * 才算对账。没有这个标志时，预热写进去的空快照会在 TTL（15s）内被当成有效值
 * 直接返回 —— 用户看到的是一个「什么都没有」的画廊，而真正的折叠要等 TTL 过了
 * 再来一次请求才会启动（2026-10-05 实测的 items=0）。
 */
let reconciled = false
const COLLECT_TTL_MS = 15_000

/**
 * 上一轮聚合没能折完的会话数（见 ROUND_FOLD_LIMIT）。
 *
 * 必须声明在模块级：它在「持久化会话」那个 `if` 块里被赋值，却在块外决定
 * `reconciled` —— 早先写成块内 `const`，块外引用直接 ReferenceError，
 * 表现为「对账永远不成立、stale 一直不消」（2026-10-05 踩到）。
 */
let foldBacklog = 0

interface CollectDeps {
  readonly sessions?: { list: () => Iterable<Record<string, any>> }
  readonly persistence?: Record<string, any>
  readonly logger?: { warn?: (msg: string) => void }
}

/**
 * 会话日志根目录（`<DSH_HOME>/sessions`），由路由层从 persistence 实例上取一次。
 *
 * 拿它才能做目录扫描这个快速路径；拿不到就退回 `persistence.list()` 的老路
 * （功能完全一致，只是每次 40 秒）。
 */
let persistenceRoot: string | null = null

/**
 * 路由层装配时登记会话日志根目录（见 gallery/index.ts）。
 *
 * `null`／空串表示「这次没探到」，**不覆盖**已经登记的值 —— 装配期
 * `ctx.get('sessionPersistence')` 可能还没就绪，而那时传进来的 null 若覆盖，
 * 后面所有「按 mtime 逐会话继承」的判定都会因为扫不到目录而落空（2026-10-05
 * 踩到：表现为放弃继承、全库重折、`stale` 一直不消）。
 */
export function setPersistenceRoot(root: string | null): void {
  if (typeof root === 'string' && root !== '') persistenceRoot = root
}

/** 探测用：看快速路径是否可用。 */
export function hasPersistenceRoot(): boolean {
  return persistenceRoot !== null
}

/**
 * 聚合全部会话的画廊条目。
 *
 * force=false 时绝不排队等冷扫：有旧值先回旧值、刷新丢后台；冷启动先用磁盘
 * 缓存渲染 stale 快照。
 *
 * force=true（用户点「刷新」）**也不再同步等全量折叠**（2026-10-05 改）：
 * 旧实现直接 `withLock(collectLocked)`，而 collectLocked 第一步是
 * `persistence.list()` —— 后端要为每个会话文件重新解一遍 header 才能算出
 * revision，本机 1386 会话实测 37~46 秒，磁盘本身却只要 150ms。用户点一次
 * 刷新要等 40 秒，中间没有任何中间态。现在 force 同样回当前快照（stale:true）
 * 并把增量折叠丢后台，首屏毫秒级返回 —— 语义上「刷新」仍然跳过了 TTL 与磁盘
 * 缓存直读，只是不再把等待时间摊在用户身上。
 */
export async function collectGallery(deps: CollectDeps, force = false): Promise<GalleryResponse & { stale?: boolean }> {
  // 已对账且新鲜（非强制刷新）：直接回。
  if (!force && reconciled && cachedResponse !== null && Date.now() - lastCollectTime < COLLECT_TTL_MS) {
    return cachedResponse
  }
  /** 回一份「先给旧的、后台重扫」的响应。 */
  const serveStale = (): GalleryResponse & { stale?: boolean } => {
    void withLock(() => collectLocked(deps)).catch((error) => {
      deps.logger?.warn?.(`[dsh-chat-plus] gallery: 后台折叠失败: ${String(error)}`)
    })
    return cachedResponse === null ? { items: [], sessions: [], truncated: false, stale: true } : { ...cachedResponse, stale: true }
  }

  // 有快照但还没对账（预热/磁盘直读）或 TTL 过期：先给快照，重扫丢后台。
  if (cachedResponse !== null) {
    return force || !reconciled ? serveStale() : cachedResponse
  }
  // 完全没有内存快照：先用磁盘分片渲染一版（不碰会话日志），折叠丢后台。
  const cache = await loadCache()
  if (cachedResponse === null) cachedResponse = renderCache(cache)
  return serveStale()
}

/** 单飞闸门：并发请求共享同一次聚合。 */
function withLock(run: () => Promise<GalleryResponse>): Promise<GalleryResponse> {
  if (inflight !== null) return inflight
  inflight = run().finally(() => { inflight = null })
  return inflight
}

/** 聚合本体（只在 withLock 下跑）。 */
async function collectLocked(deps: CollectDeps): Promise<GalleryResponse> {
  /*
   * TTL 只对「已对账」的快照生效。
   *
   * 没对账就说明还有 backlog 没折完（见 ROUND_FOLD_LIMIT）：前端每 2.5 秒回来
   * 拉一次，若被 15 秒的 TTL 拦住，续折就会被拖成「每 15 秒才推进一批」，
   * 用户盯着 stale 提示等半天。未对账时一律直接进折叠。
   */
  if (reconciled && cachedResponse !== null && Date.now() - lastCollectTime < COLLECT_TTL_MS) {
    return cachedResponse
  }
  const cache = await loadCache()
  // 每轮重新起算：这一轮折不完的话会被下面重新置上（见 foldBacklog 说明）。
  foldBacklog = 0

  /*
   * 老单文件缓存的裁定（v1 → v2）：到这里才做，因为现在 root 一定已经登记过
   * （readDeps 在每次请求里调，而这里是请求驱动的聚合本体）。裁完立刻清空
   * pending，同一进程内只裁一次。
   */
  if (cache.legacyPending !== null && cache.legacyPending !== undefined) {
    const pending = cache.legacyPending
    cache.legacyPending = null
    const scanForLegacy = await scanSessionDirs(persistenceRoot)
    const adopted = adoptLegacySessions(pending, scanForLegacy)
    for (const [id, state] of adopted) {
      // 分片里若已有同 id（更权威，是分片时代折过来的），不覆盖。
      if (cache.sessions[id] !== undefined) continue
      cache.sessions[id] = state
      // 继承来的折叠态必须落盘，否则只活在内存里，进程重启又要从老单文件重来。
      dirtySessions.add(id)
    }
  }

  // ── live 会话：折内存事件尾部 ──
  const attached = new Set<string>()
  if (deps.sessions !== undefined && typeof deps.sessions.list === 'function') {
    for (const session of deps.sessions.list()) {
      const id = typeof session?.id === 'string' ? session.id : ''
      if (id === '') continue
      attached.add(id)
      const state = cache.sessions[id] ?? createState()
      if (state.kind !== 'live') {
        state.pending = new Map()
        state.items = []
        state.consumed = 0
        state.lastTime = 0
      }
      const cwd = session.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') state.cwd = cwd
      // 0.1.2-alpha.4 起公共 events 访问器可能缺席：两个都试（usage-skill 同款）。
      const events = (session.events !== undefined
        ? session.events
        : typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []) as PersistedEvent[]
      const count = events.length
      if (state.consumed < count) {
        foldEvents(state, events.slice(state.consumed))
        state.consumed = count
        dirtySessions.add(id)
      }
      state.kind = 'live'
      cache.sessions[id] = state
    }
  }

  /*
   * ── 持久化会话 ──
   *
   * 两条通道，优先走便宜的：
   *
   *  快路（目录扫描）：自己 readdir + stat 出「id → 目录 / mtime / size」，
   *    本机 1386 会话约 120ms。曾经动过的会话（mtime 比缓存水位新）才去开日志
   *    读增量，其余**一个字节都不读**。
   *
   *  老路（persistence.list()）：拿不到日志根目录时的回落。它的代价是后端要为
   *    每个会话重新解一遍 header 算 opaque revision —— 同样这批文件实测 37~46
   *    秒，是这条链路上唯一的大头。慢，但功能一致，所以只在快路不可用时用。
   */
  if (deps.persistence !== undefined) {
    const persistence = deps.persistence
    const scan = await scanSessionDirs(persistenceRoot)

    /** 一份待折的持久化会话（两条通道归一后的形状）。 */
    interface PendingFold {
      readonly id: string
      readonly revision: unknown
      readonly dir: string | null
      /** 扫描挑中的日志文件名（快路才有）。 */
      readonly file: string | null
      cwd: string | null
      /** 快路已知 mtime 时给出：等于缓存水位就跳过（连开日志都省了）。 */
      readonly mtimeMs?: number
    }

    const entries: PendingFold[] = []
    const persistedIds = new Set<string>()

    if (scan !== null) {
      for (const entry of scan.entries) {
        // 活会话以内存事件为准，不重复折磁盘日志。
        if (attached.has(entry.id)) continue
        // 会话 id 在目录名里是编码过的；能被看见就说明它本来就是干净的 id。
        persistedIds.add(entry.id)
        entries.push({
          id: entry.id,
          revision: scanRevisionOf(entry),
          dir: entry.dir,
          file: entry.file,
          cwd: null,
          mtimeMs: entry.mtimeMs,
        })
      }
    } else {
      let listed: readonly any[] = []
      try {
        listed = (await persistence.list()) ?? []
      } catch (error) {
        deps.logger?.warn?.(`[dsh-chat-plus] gallery: 持久化会话列表读取失败: ${String(error)}`)
      }
      for (const item of listed) {
        if (item === null || typeof item !== 'object') continue
        const header = (item.header !== undefined ? item.header : item) as Record<string, unknown>
        const id = header?.id
        if (typeof id !== 'string' || id === '') continue
        persistedIds.add(id)
        entries.push({
          id,
          revision: (item as Record<string, unknown>).revision,
          dir: null,
          file: null,
          cwd: typeof header?.cwd === 'string' ? (header.cwd as string) : null,
        })
      }
    }

    /*
     * 待折清单**按 mtime 降序**：首次对账（或者提取规则升版后的大批重折）要跑
     * 分钟级，而画廊里最可能被点开的永远是最近动过的会话。让它先折完先落盘，
     * 用户看到的是列表逐步补齐，而不是等全部折完才一次性出现。
     */
    entries.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))

    const stale: PendingFold[] = []
    for (const entry of entries) {
      const previous = cache.sessions[entry.id]
      if (previous !== undefined && previous.kind === 'persisted') {
        // 快路的额外一层闸：mtime 没动过就直接认账，不必解 revision。
        if (entry.mtimeMs !== undefined && previous.mtimeMs === entry.mtimeMs
          && previous.revision !== undefined) {
          if (previous.dir !== entry.dir) previous.dir = entry.dir
          continue
        }
        if (previous.revision !== undefined && sameFileRevision(previous.revision, entry.revision)) {
          if (previous.revision !== entry.revision && typeof entry.revision === 'string') {
            previous.revision = entry.revision
          }
          // 目录随宿主迁移会变，但日志没动：更新目录，不重折。
          if (previous.dir !== entry.dir) previous.dir = entry.dir
          continue
        }
      }
      stale.push(entry)
    }

    /*
     * 分批折 + 分批落盘：每 `FLUSH_EVERY` 个会话就把已经折好的分片写下去，
     * 并刷新一次内存快照。首轮对账要跑分钟级，用户中途刷新页面时能拿到**已经
     * 折好的那部分**，而不是上一轮的旧快照。
     */
    // 本轮只折最近的一批（见 ROUND_FOLD_LIMIT）；剩下的下一轮继续，顺序不变。
    const thisRound = stale.slice(0, ROUND_FOLD_LIMIT)
    foldBacklog = stale.length - thisRound.length

    let foldedSinceFlush = 0
    await runPooled(thisRound, FOLD_CONCURRENCY, async (entry) => {
      try {
        const next = await foldPersistedSession(
          persistence, entry.id, entry.revision, cache.sessions[entry.id], entry.cwd,
        )
        /*
         * 快路：把合成 revision 与 mtime 落到折叠态，下一轮零 I/O 跳过。
         *
         * mtime 记**扫描时看到的文件 mtime**（不是扫描时刻）：下一轮扫描若发现
         * 文件真被追加过（mtime 变大），revision 跟着变，增量照折 —— 这正是想要
         * 的语义；没变就命中闸门，连日志都不开。
         */
        if (entry.mtimeMs !== undefined) next.mtimeMs = entry.mtimeMs
        if (entry.dir !== null) next.dir = entry.dir
        if (typeof entry.revision === 'string') next.revision = entry.revision
        cache.sessions[entry.id] = next
        dirtySessions.add(entry.id)
        foldedSinceFlush += 1
        if (foldedSinceFlush >= FLUSH_EVERY) {
          foldedSinceFlush = 0
          await saveDirtyShards(cache, [], deps.logger)
          // 中途刷新快照：下一次请求就能看到这一批的新条目（仍是 stale 语义）。
          cachedResponse = renderCache(cache)
        }
      } catch (error) {
        // 单会话读取失败保留旧折叠态 —— 绝不抹历史（usage-skill 同规矩）。
        deps.logger?.warn?.(`[dsh-chat-plus] gallery: 折叠会话 "${entry.id}" 失败: ${String(error)}`)
      }
    })

    // 消失的会话从缓存剔除（分片文件也要跟着删，否则缓存目录只涨不缩）。
    const removed: string[] = []
    for (const id of Object.keys(cache.sessions)) {
      if (!attached.has(id) && !persistedIds.has(id)) {
        delete cache.sessions[id]
        removed.push(id)
      }
    }
    if (removed.length > 0) await saveDirtyShards(cache, removed, deps.logger)
  }

  const rendered = renderCache(cache)
  cachedResponse = rendered
  lastCollectTime = Date.now()
  /*
   * 只有**全部折完**才置「已对账」：还有 backlog 时快照虽然是真的，但只覆盖了
   * 最近一批会话，得继续带 stale 让前端接着重拉（见 ROUND_FOLD_LIMIT）。
   */
  reconciled = foldBacklog <= 0
  // 只落盘这一轮真的动过的会话分片 —— 全量重折不再等于全量重写。
  await saveDirtyShards(cache, [], deps.logger)
  return rendered
}

/**
 * 预热：挂载后把磁盘缓存渲染出来，第一个请求不空手（不碰会话日志）。
 *
 * 刻意**不置** `reconciled`：这份快照来自上次落盘，可能已经过期甚至为空，
 * 只有当次聚合折完才算数（见 reconciled 的说明）。
 */
export async function warmGallerySnapshot(): Promise<void> {
  if (cachedResponse !== null) return
  const cache = await loadCache()
  if (cachedResponse === null) cachedResponse = renderCache(cache)
}

/* ── 单会话按需提取（/raw 的会话作用域准入）──────────────────────────── */

/**
 * 单个会话的产出物清单（按需折，不碰全局缓存）。
 *
 * 给 /raw 的「会话作用域准入」用：产出物卡（右栏）的 Lightbox 也走 /raw，但用户
 * 可能从没开过画廊（全局索引还没建）。此时按 sessionId 现折这一个会话（live 折
 * 内存事件、persisted 读一份日志），只认**这个会话自己产出过**的路径 —— 与全局
 * 索引同一套提取规则，安全口径不变。
 *
 * 缓存键：live = 事件条数；persisted = 合成 revision（`scan:<mtime>:<size>` 或
 * 后端 opaque revision）。变了才重折。
 *
 * 缓存值里带**会话工作区**（cwd）：`/raw` 收到的是 client 原样传来的路径，而
 * present 的参数常是**相对路径**（`深圳一日游_20261006/slide_01.png`）。准入比对
 * 的基准必须是**该会话的 cwd**，不是 host 进程的 cwd —— 后者是 DSH 的安装目录，
 * 拼出来的绝对路径永远不在索引里，表现为「卡里看得见、点开 403」。
 */
const sessionItemsCache = new Map<string, { key: string; items: readonly GalleryRawItem[]; cwd: string | null }>()
const SESSION_ITEMS_CACHE_LIMIT = 64

function rememberSessionItems(
  sessionId: string,
  key: string,
  items: readonly GalleryRawItem[],
  cwd: string | null,
): void {
  if (sessionItemsCache.size >= SESSION_ITEMS_CACHE_LIMIT) {
    const oldest = sessionItemsCache.keys().next()
    if (oldest.done !== true) sessionItemsCache.delete(oldest.value)
  }
  sessionItemsCache.set(sessionId, { key, items, cwd })
}

/** 一个会话的产出清单 + 工作区（/raw 的会话作用域准入要两者）。 */
export interface SessionContext {
  readonly items: readonly GalleryRawItem[]
  /** 会话工作区；未知时 null（相对路径届时无法定位，只能拒绝）。 */
  readonly cwd: string | null
}

/** 单会话产出清单（/raw 的会话作用域准入用；同一次折叠顺带给出 cwd）。 */
export async function sessionItemsFor(
  deps: CollectDeps,
  sessionId: string,
): Promise<readonly GalleryRawItem[]> {
  return (await sessionContextFor(deps, sessionId)).items
}

/**
 * 导出给冒烟与对拍用的内部面（与 ./index.ts 的 __test 同惯例）。
 *
 * 这里暴露的是「快路」的两块地基：目录扫描与自解析日志切片。它们错了不会报错，
 * 只会静默少列几个产出物 —— 必须有能直接对拍的入口。
 */
export const __test = {
  scanSessionDirs,
  setPersistenceRoot,
  hasPersistenceRoot,
  collectGallery,
  loadCache,
  adoptLegacySessions,
  PTC_EPOCH_MS,
  scanRevisionOf,
  /** 诊断：当前内存态（是否已对账 / 缓存了多少会话）。 */
  peekState: () => ({
    reconciled,
    hasResponse: cachedResponse !== null,
    sessions: loadedCache === null ? -1 : Object.keys(loadedCache.sessions).length,
    pendingLegacy: loadedCache === null ? -1 : (loadedCache.legacyPending === null ? 0 : Object.keys(loadedCache.legacyPending ?? {}).length),
    dirty: dirtySessions.size,
  }),
}

/**
 * 单会话的产出清单与工作区（见 sessionItemsFor 的缓存与口径说明）。
 */
export async function sessionContextFor(
  deps: CollectDeps,
  sessionId: string,
): Promise<SessionContext> {
  const EMPTY: SessionContext = { items: [], cwd: null }
  if (sessionId === '') return EMPTY
  const cached = sessionItemsCache.get(sessionId)

  // live：内存事件，零 I/O。
  if (deps.sessions !== undefined && typeof deps.sessions.list === 'function') {
    for (const session of deps.sessions.list()) {
      if (session?.id !== sessionId) continue
      const events = (session.events !== undefined
        ? session.events
        : typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []) as PersistedEvent[]
      const key = `live:${events.length}`
      if (cached !== undefined && cached.key === key) return cached
      const state = createState()
      const cwd = session.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') state.cwd = cwd
      foldEvents(state, events)
      const context: SessionContext = { items: state.items, cwd: state.cwd }
      rememberSessionItems(sessionId, key, context.items, context.cwd)
      return context
    }
  }

  /*
   * persisted：只读这一份日志。
   *
   * 快路（目录扫描）：`<root>/<project>/<id>` 直接 stat 一次拿水位，连
   * `persistence.list()` 都不碰 —— 那条路要为全库每个会话解一遍 header，
   * 用户点开一张图不该付这份钱（本机 1386 会话实测 40 秒）。
   *
   * 老路（list()）：拿不到 root，或扫描里没有这个 id（写入中尚未落盘）时回落。
   */
  if (deps.persistence !== undefined) {
    const scan = await scanSessionDirs(persistenceRoot)
    if (scan !== null) {
      const hit = scan.entries.find((entry) => entry.id === sessionId)
      if (hit !== undefined) {
        const key = `scan:${hit.mtimeMs}:${hit.size}`
        if (cached !== undefined && cached.key === key) return cached
        try {
          const state = await foldPersistedSession(deps.persistence, sessionId, key, undefined, null)
          const context: SessionContext = { items: state.items, cwd: state.cwd }
          rememberSessionItems(sessionId, key, context.items, context.cwd)
          return context
        } catch {
          return EMPTY
        }
      }
    }

    let revision: unknown
    let cwd: string | null = null
    let found = false
    try {
      const listed = (await deps.persistence.list()) ?? []
      for (const entry of listed) {
        if (entry === null || typeof entry !== 'object') continue
        const header = (entry.header !== undefined ? entry.header : entry) as Record<string, unknown>
        if (header?.id !== sessionId) continue
        found = true
        revision = (entry as Record<string, unknown>).revision
        cwd = typeof header.cwd === 'string' ? (header.cwd as string) : null
        break
      }
    } catch {
      return EMPTY
    }
    if (!found) return EMPTY
    const key = `persisted:${String(revision ?? '')}`
    if (cached !== undefined && cached.key === key) return cached
    try {
      const state = await foldPersistedSession(deps.persistence, sessionId, revision, undefined, cwd)
      const context: SessionContext = { items: state.items, cwd: state.cwd }
      rememberSessionItems(sessionId, key, context.items, context.cwd)
      return context
    } catch {
      return EMPTY
    }
  }
  return EMPTY
}
