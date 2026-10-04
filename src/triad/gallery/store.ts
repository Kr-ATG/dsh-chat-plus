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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import {
  extractFromEventPair,
  galleryDedupeKey,
  type GalleryRawItem,
  type ToolCallEvent,
  type ToolResultEvent,
} from './extract.ts'

/** 缓存格式版本：形状变更时 +1，强制一次全量重折。 */
const CACHE_VERSION = 1

/** 单会话最多保留的条目数（防一个截图狂魔会话吃掉整个响应）。 */
const MAX_ITEMS_PER_SESSION = 500

/** pending tool/call 的 arguments 存储上限（run_code 代码体可能很大）。 */
const MAX_PENDING_ARGS = 256 * 1024

/** 一次折叠最多同时打开几个会话日志（与 usage-skill 同值）。 */
const FOLD_CONCURRENCY = 8

/** 响应里最多返回的条目数（按时间降序截断）。 */
export const MAX_RESPONSE_ITEMS = 2000

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
}

function cachePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'triad-gallery-cache.json')
}

let loadedCache: GalleryCache | null = null
let loadPromise: Promise<GalleryCache> | null = null
let inflight: Promise<GalleryResponse> | null = null

/** 每进程只加载一次；损坏时降级为空缓存（与 usage-skill 同语义）。 */
async function loadCache(): Promise<GalleryCache> {
  if (loadedCache !== null) return loadedCache
  loadPromise ??= (async () => {
    const fresh: GalleryCache = { version: CACHE_VERSION, sessions: {} }
    try {
      const raw = await readFile(cachePath(), 'utf8')
      const parsed = JSON.parse(raw) as { version?: unknown; sessions?: Record<string, unknown> }
      if (parsed !== null && typeof parsed === 'object' && parsed.version === CACHE_VERSION
        && parsed.sessions !== null && typeof parsed.sessions === 'object') {
        const sessions: Record<string, SessionState> = {}
        for (const [id, entry] of Object.entries(parsed.sessions ?? {})) {
          if (typeof id === 'string' && id.length > 0) sessions[id] = parseSession(entry)
        }
        return { version: CACHE_VERSION, sessions }
      }
    } catch { /* 首跑或缓存损坏 */ }
    return fresh
  })()
  loadedCache = await loadPromise
  return loadedCache
}

/** 原子写缓存（tmp + rename）；失败只记日志。 */
async function saveCache(logger: { warn?: (msg: string) => void } | undefined, cache: GalleryCache): Promise<void> {
  try {
    const path = cachePath()
    await mkdir(dirname(path), { recursive: true })
    const serialized: Record<string, unknown> = { version: CACHE_VERSION, sessions: {} }
    const out: Record<string, unknown> = {}
    for (const [id, state] of Object.entries(cache.sessions)) out[id] = serializeSession(state)
    serialized.sessions = out
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(serialized), 'utf8')
    await rename(tmp, path)
  } catch (error) {
    logger?.warn?.(`[dsh-chat-plus] gallery: 保存缓存失败: ${String(error)}`)
  }
}

/* ── 事件读取（跨宿主代际兼容，逐字沿用 usage-skill 的手法）────────────── */

interface PersistedEvent {
  type: string
  seq?: number
  time?: number
  data?: Record<string, unknown>
}

/** 读一个持久化会话的整段/增量事件日志（readFrom 与 handle 两代 API 都认）。 */
async function readPersistedEvents(
  persistence: Record<string, any>,
  id: string,
  offset = 0,
): Promise<PersistedEvent[]> {
  if (typeof persistence.readFrom === 'function') {
    const { events } = await persistence.readFrom(id, offset)
    return [...(events ?? [])] as PersistedEvent[]
  }
  const handle = await persistence.open(id, 'read')
  try {
    const events: PersistedEvent[] = []
    let cursor = offset
    for (;;) {
      const slice = await handle.read(cursor, 2000)
      const batch = (slice?.events ?? []) as PersistedEvent[]
      if (batch.length === 0) break
      for (const event of batch) events.push(event)
      const last = batch[batch.length - 1]
      cursor = typeof last?.seq === 'number' ? last.seq + 1 : cursor + batch.length
      if (batch.length < 2000) break
    }
    return events
  } finally {
    try { await handle.close() } catch { /* 收尾失败不掩盖读取结果 */ }
  }
}

/**
 * revision 是否对应同一份物理文件状态。
 * DSH 会给历史格式的 revision 追加语料级 hash（任何会话被碰过都会变），
 * 而 dev:ino:size:mtime:ctime 五段不变则内容必然不变 —— 与 usage-skill 同判据。
 */
function sameFileRevision(a: string | undefined, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aParts = a.split(':')
  const bParts = b.split(':')
  if (aParts.length >= 5 && bParts.length >= 5) {
    return aParts[0] === bParts[0] && aParts[1] === bParts[1]
      && aParts[2] === bParts[2] && aParts[3] === bParts[3] && aParts[4] === bParts[4]
  }
  return false
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
      const extracted = extractFromEventPair(callEvent, resultEvent, { cwd: state.cwd })
      for (const item of extracted) {
        if (state.items.length >= MAX_ITEMS_PER_SESSION) break
        // 会话内去重：同一路径只留首见（时间取最新一次产出）。
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
const COLLECT_TTL_MS = 15_000

interface CollectDeps {
  readonly sessions?: { list: () => Iterable<Record<string, any>> }
  readonly persistence?: Record<string, any>
  readonly logger?: { warn?: (msg: string) => void }
}

/**
 * 聚合全部会话的画廊条目。
 *
 * force=false 时绝不排队等冷扫：有旧值先回旧值、刷新丢后台；冷启动先用磁盘
 * 缓存渲染 stale 快照。force=true（用户点刷新）同步等完整折叠。
 */
export async function collectGallery(deps: CollectDeps, force = false): Promise<GalleryResponse & { stale?: boolean }> {
  if (!force && cachedResponse !== null && Date.now() - lastCollectTime < COLLECT_TTL_MS) {
    return cachedResponse
  }
  if (!force && cachedResponse !== null) {
    void withLock(() => collectLocked(deps)).catch((error) => {
      deps.logger?.warn?.(`[dsh-chat-plus] gallery: 后台折叠失败: ${String(error)}`)
    })
    return cachedResponse
  }
  if (!force) {
    // 冷启动：先渲染磁盘缓存（不碰任何会话日志），完整折叠丢后台。
    const cache = await loadCache()
    if (cachedResponse === null) {
      cachedResponse = renderCache(cache)
      void withLock(() => collectLocked(deps)).catch((error) => {
        deps.logger?.warn?.(`[dsh-chat-plus] gallery: 后台折叠失败: ${String(error)}`)
      })
      return { ...cachedResponse, stale: true }
    }
  }
  return withLock(() => collectLocked(deps))
}

/** 单飞闸门：并发请求共享同一次聚合。 */
function withLock(run: () => Promise<GalleryResponse>): Promise<GalleryResponse> {
  if (inflight !== null) return inflight
  inflight = run().finally(() => { inflight = null })
  return inflight
}

/** 聚合本体（只在 withLock 下跑）。 */
async function collectLocked(deps: CollectDeps): Promise<GalleryResponse> {
  if (cachedResponse !== null && Date.now() - lastCollectTime < COLLECT_TTL_MS) {
    return cachedResponse
  }
  const cache = await loadCache()

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
      }
      state.kind = 'live'
      cache.sessions[id] = state
    }
  }

  // ── 持久化会话：revision 未变零 I/O 跳过 ──
  if (deps.persistence !== undefined) {
    const persistence = deps.persistence
    let listed: readonly any[] = []
    try {
      listed = (await persistence.list()) ?? []
    } catch (error) {
      deps.logger?.warn?.(`[dsh-chat-plus] gallery: 持久化会话列表读取失败: ${String(error)}`)
    }
    const entries: { id: string; revision: unknown; cwd: string | null }[] = []
    const persistedIds = new Set<string>()
    for (const item of listed) {
      if (item === null || typeof item !== 'object') continue
      const header = (item.header !== undefined ? item.header : item) as Record<string, unknown>
      const id = header?.id
      if (typeof id !== 'string' || id === '') continue
      persistedIds.add(id)
      entries.push({
        id,
        revision: (item as Record<string, unknown>).revision,
        cwd: typeof header?.cwd === 'string' ? (header.cwd as string) : null,
      })
    }
    const stale: typeof entries = []
    for (const entry of entries) {
      if (attached.has(entry.id)) continue
      const previous = cache.sessions[entry.id]
      if (previous !== undefined && previous.kind === 'persisted'
        && entry.revision !== undefined && sameFileRevision(previous.revision, entry.revision)) {
        if (previous.revision !== entry.revision && typeof entry.revision === 'string') previous.revision = entry.revision
        continue
      }
      stale.push(entry)
    }
    await runPooled(stale, FOLD_CONCURRENCY, async (entry) => {
      try {
        cache.sessions[entry.id] = await foldPersistedSession(
          persistence, entry.id, entry.revision, cache.sessions[entry.id], entry.cwd,
        )
      } catch (error) {
        // 单会话读取失败保留旧折叠态 —— 绝不抹历史（usage-skill 同规矩）。
        deps.logger?.warn?.(`[dsh-chat-plus] gallery: 折叠会话 "${entry.id}" 失败: ${String(error)}`)
      }
    })
    // 消失的会话从缓存剔除。
    for (const id of Object.keys(cache.sessions)) {
      if (!attached.has(id) && !persistedIds.has(id)) delete cache.sessions[id]
    }
  }

  const rendered = renderCache(cache)
  cachedResponse = rendered
  lastCollectTime = Date.now()
  await saveCache(deps.logger, cache)
  return rendered
}

/** 预热：挂载后把磁盘缓存渲染出来，第一个请求不空手（不碰会话日志）。 */
export async function warmGallerySnapshot(): Promise<void> {
  if (cachedResponse !== null) return
  const cache = await loadCache()
  if (cachedResponse === null) cachedResponse = renderCache(cache)
}
