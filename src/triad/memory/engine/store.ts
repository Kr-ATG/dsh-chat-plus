/**
 * dsh-memory 文件存储层：entries.json / state.json / changes/<date>.jsonl /
 * 各层 md 产物。所有写入走「tmp + rename」原子写，防止半写损坏。
 * 数据根：${DSH_HOME:-~/.dsh}/memories/dsh-memory/（与 memory-evolve 遗留数据同根目录、不同前缀，互不读写）。
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ChangeRecord,
  MemoryConfig,
  MemoryEntry,
  MemoryKind,
  ProjectMeta,
  RevisionMeta,
  StoreState,
} from '../types.js'

/** 数据根目录。 */
export function memoryHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'memories', 'dsh-memory')
}

/** workspace 路径 → 项目目录 hash（sha1 前 12 位）。 */
export function projectHashOf(cwd: string): string {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12)
}

/** 记忆条目稳定 id：mem_<sha1(content|scope|projectHash)>，同内容合并。 */
export function entryIdOf(content: string, scope: 'global' | 'project', projectHash: string | null): string {
  const key = `${scope}\u0000${projectHash ?? ''}\u0000${content.trim()}`
  return `mem_${createHash('sha1').update(key).digest('hex').slice(0, 16)}`
}

/** 本地日期 YYYY-MM-DD。 */
export function localDate(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** ISO 时间（本地时区偏移保留）。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 原子写文本：tmp + rename（同一目录内）。
 *
 * 临时名必须**每次唯一**。曾经这里写死 `${file}.tmp`，于是两个并发写同一文件时：
 * A 写完 tmp → B 把 tmp 截断重写 → A rename(tmp, file) 成功（落盘的却是 B 的
 * 内容）→ B rename(tmp, file) 抛 ENOENT。记忆库同一路径的并发写是常态
 * （面板改一条记忆的 compileAll 与会话结束触发的 final compile 并不共享
 * ticker 那条串行队列，两个 HTTP 请求在各 await 处随时交错），用户会看到
 * 一句完全不知所云的「ENOENT: rename ... memory.md.tmp」——而记忆其实已经
 * 进 entries.json 了，只是产物没编译出来。
 *
 * 拼上 pid + 随机段之后，同一路径的并发写互不干扰：各自的 tmp 独立，A 落盘
 * 的是 A 的内容，B 落盘的是 B 的内容，最后一个 rename 的胜出即最新写入。
 */
export async function atomicWriteText(file: string, content: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, file)
  } catch (error) {
    // 写一半失败时别把 tmp 留在盘上（下次启动会以为有历史残留）。
    try { await unlink(temp) } catch { /* 已被 rename 走或从不存在 */ }
    throw error
  }
}

/** 原子写 JSON。 */
export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** 读取 JSON，缺失/损坏返回 fallback。 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** 追加一行 JSONL（追加本身用 appendFile；损坏容忍，读侧幂等）。 */
export async function appendJsonl(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

/** 读取 JSONL（容忍坏行），返回 { entries, seq }。 */
export async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return []
  }
  const out: T[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      // 单条解析失败跳过，不中断批次。
    }
  }
  return out
}

/** 修订版本保留上限（滚动清理，超过只保留最近 N 个）。 */
const REVISION_KEEP = 20

/**
 * MemoryStore：所有记忆数据的读写入口。
 * 线程模型：调用方（ticker / turn/end 捕获）通过同一实例串行化写入，
 * 内部只保证单文件操作的原子性。
 */
export class MemoryStore {
  readonly root: string

  /** 回刷 debounce（毫秒）：合并短窗口内的多次写。 */
  private static readonly FLUSH_DEBOUNCE_MS = 500

  /** 内存态条目（权威副本；磁盘 entries.json 是它的节流回刷镜像）。 */
  private entries: MemoryEntry[] = []
  /** 内存态是否落后于磁盘（有待回刷）。 */
  private dirty = false
  /** 节流回刷计时器。 */
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(root = memoryHome()) {
    this.root = root
    const data = readJsonSync<{ version: 1 | 2; entries: unknown }>(
      this.entriesFile(),
      { version: 2, entries: [] },
    )
    this.entries = migrateEntries(data.entries)
  }

  // ── 路径 ────────────────────────────────────────────────────────────

  entriesFile(): string {
    return join(this.root, 'store', 'entries.json')
  }

  stateFile(): string {
    return join(this.root, 'store', 'state.json')
  }

  configFile(): string {
    return join(this.root, 'store', 'config.json')
  }

  /** 读运行时配置覆盖（config.json；缺失返回空）。 */
  readConfigSync(): Partial<MemoryConfig> {
    return readJsonSync<Partial<MemoryConfig>>(this.configFile(), {})
  }

  /** 写运行时配置覆盖（面板设置持久化）。 */
  async writeConfig(config: Partial<MemoryConfig>): Promise<void> {
    await atomicWriteJson(this.configFile(), config)
  }

  changesFile(date: string): string {
    return join(this.root, 'changes', `${date}.jsonl`)
  }

  globalDir(): string {
    return join(this.root, 'global')
  }

  projectDir(hash: string): string {
    return join(this.root, 'projects', hash)
  }

  dailyFile(date: string): string {
    return join(this.root, 'daily', `${date}.md`)
  }

  // ── 条目 ────────────────────────────────────────────────────────────

  /** 全量条目索引（内存快照的浅拷贝，避免外部误改内存态）。 */
  async readEntries(): Promise<MemoryEntry[]> {
    return [...this.entries]
  }

  /** 节流回刷：标记 dirty 并在 debounce 后落盘（合并写放大）。 */
  private scheduleFlush(): void {
    this.dirty = true
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flushNow().catch(() => undefined)
    }, MemoryStore.FLUSH_DEBOUNCE_MS)
  }

  /**
   * 立即落盘。
   *
   * dirty 的清除必须排在写盘**之后**：原来写成「先 dirty=false 再 await」，
   * 于是写盘失败时这批增量只留在内存里，而唯一能兜底的 dispose → flush()
   * 会撞上 flushNow 开头的 `if (!this.dirty) return` 直接空转——脏标记早就
   * 没了，那批数据再也写不出去。用户在面板上刚记下的东西随进程退出蒸发，
   * 且没有任何报错。
   *
   * 串行化：多个调用方（ticker 的节流 flush、手动 flush、dispose 的 flush）
   * 可能同时进来，加一把 in-flight 锁让它们排队，避免后一次拿着旧的
   * entries 快照把前一次刚落盘的新内容盖回去。
   */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.flushNow()
  }

  private flushInFlight: Promise<void> = Promise.resolve()

  private async flushNow(): Promise<void> {
    if (!this.dirty) return
    const run = this.flushInFlight.then(async () => {
      if (!this.dirty) return
      await atomicWriteJson(this.entriesFile(), { version: 2, entries: this.entries })
      this.dirty = false
    })
    // 无论成败都让队列继续，但错误要原样抛给调用方去记日志/重试。
    this.flushInFlight = run.catch(() => undefined)
    return run
  }

  /**
   * 修改内存态条目（fn 原地修改传入数组或返回替换数组），随后节流回刷。
   * 单线程下内存数组的同步操作天然原子，无需额外写串行队列。
   */
  async mutateEntries<T>(fn: (entries: MemoryEntry[]) => Promise<T> | T): Promise<T> {
    const result = await fn(this.entries)
    this.scheduleFlush()
    return result
  }

  async getEntry(id: string): Promise<MemoryEntry | undefined> {
    return this.entries.find(entry => entry.id === id)
  }

  /**
   * 新增或更新（同 id 合并）。返回 { created, entry }。
   * 同时按去重逻辑：新增时若同内容（同 scope+projectHash）已存在则合并为 update。
   */
  async upsertEntry(next: {
    content: string
    scope: 'global' | 'project'
    projectHash: string | null
    tags?: string[]
    pinned?: boolean
    importance?: number
    lastHitAt?: string | null
    layer?: 'short' | 'long'
    source?: 'extract' | 'manual'
    kind?: MemoryKind
    confidence?: number
    provenance?: { sessionId?: string; turn?: number; snippet?: string }
  }): Promise<{ created: boolean; entry: MemoryEntry }> {
    return this.mutateEntries(entries => {
      const id = entryIdOf(next.content, next.scope, next.projectHash)
      const existing = entries.find(entry => entry.id === id)
      const now = nowIso()
      let entry: MemoryEntry
      if (existing !== undefined) {
        // 同内容条目已存在：若它处于软废弃状态，重新写入视为「复活」。
        const revived = existing.deprecated === true
          ? { ...existing, deprecated: undefined, deprecatedAt: undefined, deprecatedReason: undefined, supersededBy: undefined }
          : existing
        entry = {
          ...revived,
          content: next.content,
          tags: mergeTags(revived.tags, next.tags),
          pinned: next.pinned ?? revived.pinned,
          importance: Math.max(revived.importance, next.importance ?? revived.importance),
          layer: next.layer ?? revived.layer,
          updatedAt: now,
          version: revived.version + 1,
          // 更新分支同样刷新溯源：本会话既动了它，本会话就该看得见（KR 记忆卡
          // 按 provenance.sessionId 判定「本会话新增/更新」）。
          provenance: next.provenance ?? revived.provenance,
        }
        entries.splice(entries.indexOf(existing), 1, entry)
        return { created: false, entry }
      }
      entry = {
        id,
        content: next.content,
        scope: next.scope,
        projectHash: next.scope === 'project' ? next.projectHash : null,
        tags: next.tags ?? [],
        pinned: next.pinned ?? false,
        createdAt: now,
        updatedAt: now,
        importance: next.importance ?? 10,
        lastHitAt: null,
        layer: next.layer ?? 'short',
        source: next.source ?? 'extract',
        version: 1,
        confidence: next.confidence ?? (next.source === 'manual' ? 1 : 0.6),
        verified: next.source === 'manual',
        kind: next.kind ?? inferKind(next.tags),
        provenance: next.provenance,
        embedding: undefined,
      }
      entries.push(entry)
      return { created: true, entry }
    })
  }

  /**
   * 替换单条（用于裁决操作：改内容/标签/移项目/置顶/启用）。返回新条目；不存在返回 undefined。
   *
   * id 是 content+scope+projectHash 的稳定派生值，所以内容或归属变化时必须重算 id，
   * 否则 id 与内容脱钩：后续 upsertEntry（提取/手动添加）算出的新 id 找不到本条，
   * 会把同一条记忆再插一遍（面板出现重复条目）。若新 id 已存在（改成了与另一条
   * 完全相同的内容），把两条合并为一条，保留较高的 importance 与并集标签。
   */
  async patchEntry(id: string, patch: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry | undefined> {
    return this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.id === id)
      if (index === -1) return undefined
      const current = entries[index]
      const merged: MemoryEntry = {
        ...current,
        ...patch,
        id,
        updatedAt: nowIso(),
        version: current.version + 1,
        verified: true,
      }
      if (merged.scope === 'global') merged.projectHash = null
      const nextId = entryIdOf(merged.content, merged.scope, merged.projectHash)
      if (nextId === id) {
        entries[index] = merged
        return merged
      }
      // 内容/归属变了 → 换 id；撞上已有同内容条目则合并。
      const clashIndex = entries.findIndex((entry, at) => at !== index && entry.id === nextId)
      const updated: MemoryEntry = { ...merged, id: nextId }
      if (clashIndex === -1) {
        entries[index] = updated
        return updated
      }
      const clash = entries[clashIndex]
      const combined: MemoryEntry = {
        ...updated,
        tags: mergeTags(clash.tags, updated.tags),
        pinned: clash.pinned || updated.pinned,
        importance: Math.max(clash.importance, updated.importance),
        layer: clash.layer === 'long' || updated.layer === 'long' ? 'long' : 'short',
        createdAt: clash.createdAt < updated.createdAt ? clash.createdAt : updated.createdAt,
        version: Math.max(clash.version, updated.version) + 1,
      }
      entries[clashIndex] = combined
      entries.splice(index, 1)
      return combined
    })
  }

  /** 删除条目。返回是否删除成功。 */
  async removeEntry(id: string): Promise<boolean> {
    return this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.id === id)
      if (index === -1) return false
      entries.splice(index, 1)
      return true
    })
  }

  /**
   * 软废弃一条记忆（retire，无后继）：数据保留但默认不再检索/注入/编译。
   * 已废弃条目重复 retire 是幂等 no-op。
   */
  async retireEntry(id: string, reason?: string): Promise<MemoryEntry | undefined> {
    return this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.id === id)
      if (index === -1) return undefined
      const current = entries[index]
      if (current.deprecated === true) return current
      const entry: MemoryEntry = {
        ...current,
        deprecated: true,
        deprecatedAt: nowIso(),
        deprecatedReason: reason?.trim() !== '' ? reason?.trim() : undefined,
        supersededBy: undefined,
        updatedAt: nowIso(),
        version: current.version + 1,
      }
      entries[index] = entry
      return entry
    })
  }

  /**
   * 修订一条记忆（revise，软废弃 + 后继）：把旧内容软废弃，写入新内容作为后继。
   * 参考 opencontext 的 oc_memory_revise 语义：{ deprecatedId, newId }。
   *
   * 后继条目复用 upsertEntry 的稳定 id 派生：新内容与库中已有条目撞 id 时
   * 直接复用（不重复插入）；旧条目标记 supersededBy 指向后继。
   * 内容未变化时视为 no-op（不产生废弃条目）。
   */
  async reviseEntry(input: {
    id: string
    content: string
    reason?: string
    tags?: string[]
    importance?: number
    kind?: MemoryKind
    provenance?: { sessionId?: string; turn?: number; snippet?: string }
  }): Promise<{ deprecatedId: string; newId: string; entry: MemoryEntry } | undefined> {
    const content = input.content.trim()
    if (content === '') throw new Error('content 不能为空')
    const target = await this.getEntry(input.id)
    if (target === undefined) return undefined
    if (target.deprecated === true) return undefined

    const nextId = entryIdOf(content, target.scope, target.projectHash)
    // 内容没变（或只是空白差异）：无修订空间。
    if (nextId === input.id) return undefined

    // 先软废弃旧条目（supersededBy 指向后继 id；后继撞已有条目时指向已有条目）。
    await this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.id === input.id)
      if (index === -1) return
      const current = entries[index]
      entries[index] = {
        ...current,
        deprecated: true,
        deprecatedAt: nowIso(),
        deprecatedReason: input.reason?.trim() !== '' ? input.reason?.trim() : undefined,
        supersededBy: nextId,
        updatedAt: nowIso(),
        version: current.version + 1,
      }
    })

    // 后继条目：继承旧条目的归属/层/来源/置信度/置顶，内容与标签为新的。
    // 溯源不继承：后继是本会话写下的新内容，记本会话（provenance 是「谁写的」，
    // 不是「最初由谁产生」——后者在旧条目的废弃记录里）。
    const { entry } = await this.upsertEntry({
      content,
      scope: target.scope,
      projectHash: target.projectHash,
      tags: input.tags,
      pinned: target.pinned,
      importance: input.importance ?? target.importance,
      layer: target.layer,
      source: target.source,
      kind: input.kind ?? target.kind,
      confidence: target.confidence,
      provenance: input.provenance,
    })
    return { deprecatedId: input.id, newId: entry.id, entry }
  }

  /** 复活一条已废弃的记忆（undo retire / undo revise 的后继侧）。 */
  async restoreEntry(id: string): Promise<MemoryEntry | undefined> {
    return this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.id === id)
      if (index === -1) return undefined
      const current = entries[index]
      if (current.deprecated !== true) return current
      const entry: MemoryEntry = {
        ...current,
        deprecated: undefined,
        deprecatedAt: undefined,
        deprecatedReason: undefined,
        supersededBy: undefined,
        updatedAt: nowIso(),
        version: current.version + 1,
      }
      entries[index] = entry
      return entry
    })
  }

  /** 注入命中刷新（原子）：给命中的条目加分并刷新 lastHitAt，返回刷新条数。 */
  async applyHits(hitIds: Set<string>, bonus: number): Promise<number> {
    return this.mutateEntries(entries => {
      let count = 0
      for (const entry of entries) {
        if (!hitIds.has(entry.id)) continue
        entry.importance = Math.min(20, Math.round((entry.importance + bonus) * 100) / 100)
        entry.lastHitAt = nowIso()
        count += 1
      }
      return count
    })
  }

  /** 原子替换全部条目（ticker 每日编译等批量场景；fn 返回新数组）。 */
  async replaceEntries(fn: (entries: MemoryEntry[]) => Promise<MemoryEntry[]> | MemoryEntry[]): Promise<MemoryEntry[]> {
    const next = await fn(this.entries)
    this.entries = next
    this.scheduleFlush()
    return next
  }

  // ── 变更流 ──────────────────────────────────────────────────────────

  async appendChange(change: Omit<ChangeRecord, 'id' | 'at'>): Promise<ChangeRecord> {
    const record: ChangeRecord = {
      ...change,
      id: `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
      at: nowIso(),
    }
    await appendJsonl(this.changesFile(localDate()), record)
    return record
  }

  async readChanges(date?: string): Promise<ChangeRecord[]> {
    if (date !== undefined) return readJsonl<ChangeRecord>(this.changesFile(date))
    const dir = join(this.root, 'changes')
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return []
    }
    const dates = files
      .filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .sort()
    const all: ChangeRecord[] = []
    for (const file of dates) {
      all.push(...await readJsonl<ChangeRecord>(join(dir, file)))
    }
    return all
  }

  // ── ticker 状态 ─────────────────────────────────────────────────────

  /**
   * 追加一行日志（按分类落独立文件 + 大小轮转，防无界增长）。
   * kind: extract=提取诊断 / consolidate=整理诊断 / api=API 请求（默认关闭）/ error=插件错误。
   * 轮转：当前文件 ≥ 10MB 时改名成带时间戳归档，只保留最近 5 个归档。
   */
  private async appendLog(kind: 'extract' | 'consolidate' | 'api' | 'error', line: string): Promise<void> {
    const { appendFile, stat, rename, readdir, unlink } = await import('node:fs/promises')
    const logDir = join(this.root, 'log')
    const file = join(logDir, `${kind}.log`)
    await mkdir(logDir, { recursive: true })
    const maxBytes = 10 * 1024 * 1024
    const keep = 5
    try {
      const info = await stat(file)
      if (info.size >= maxBytes) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        try { await rename(file, join(logDir, `${kind}.${stamp}.log`)) } catch { /* 忽略 */ }
        try {
          const names = (await readdir(logDir))
            .filter(name => name.startsWith(`${kind}.`) && name.endsWith('.log'))
            .sort()
          const excess = names.slice(0, Math.max(0, names.length - keep))
          for (const name of excess) {
            try { await unlink(join(logDir, name)) } catch { /* 忽略 */ }
          }
        } catch { /* 忽略 */ }
      }
    } catch { /* 文件不存在，直接追加 */ }
    await appendFile(file, `${line}\n`, 'utf8')
  }

  /** 插件错误日志（本插件 async 任务失败；DSH 控制台日志不落盘）。 */
  async appendErrorLog(stage: string, message: string): Promise<void> {
    await this.appendLog('error', `[${nowIso()}] ${stage}: ${message}`)
  }

  /** 提取诊断日志（turn= 开始/结束/耗时/候选数，排查提取卡死）。 */
  async appendExtractLog(message: string): Promise<void> {
    await this.appendLog('extract', `[${nowIso()}] ${message}`)
  }

  /**
   * 整理诊断日志：consolidate 引擎的每次「为什么没整理/整理成什么」都落盘。
   * 引擎 debug 级日志不进 DSH 控制台（不落盘），此前 consolidate 静默
   * skip/失败时磁盘上毫无痕迹，无法区分「无需整理」与「路由拿不到模型」。
   */
  async appendConsolidateLog(message: string): Promise<void> {
    await this.appendLog('consolidate', `[${nowIso()}] ${message}`)
  }

  /** API 请求诊断日志（默认关闭；仅 config.logApiRequests 开启时由 api.ts 调用）。 */
  async appendApiLog(message: string): Promise<void> {
    await this.appendLog('api', `[${nowIso()}] ${message}`)
  }

  async readState(): Promise<StoreState> {
    const state = await readJson<StoreState>(this.stateFile(), {
      schemaVersion: 1,
      perSession: {},
      lastDailyDate: null,
    })
    if (state.perSession === undefined || state.perSession === null) state.perSession = {}
    return state
  }

  async writeState(state: StoreState): Promise<void> {
    await atomicWriteJson(this.stateFile(), state)
  }

  // ── 记忆注入开关（按会话，内存缓存 + state.json 持久化） ───────────

  /** 注入被关闭的会话 id（内存缓存；null = 未加载）。 */
  private injectDisabledCache: Set<string> | null = null
  /** 注入被显式开启的会话 id（内存缓存；null = 未加载）。 */
  private injectForcedCache: Set<string> | null = null

  private async ensureInjectCaches(): Promise<{ disabled: Set<string>; forced: Set<string> }> {
    if (this.injectDisabledCache === null || this.injectForcedCache === null) {
      const state = await this.readState()
      this.injectDisabledCache = new Set(Array.isArray(state.injectDisabled) ? state.injectDisabled : [])
      this.injectForcedCache = new Set(Array.isArray(state.injectForced) ? state.injectForced : [])
    }
    return { disabled: this.injectDisabledCache, forced: this.injectForcedCache }
  }

  /**
   * 该会话的显式开关；未单独设置返回 null（调用方回退 config.injectDefaultEnabled）。
   * 关闭列表优先于开启列表：同时出现按更保守的「不注入」处理。
   */
  async injectStateOf(sessionId: string): Promise<boolean | null> {
    const { disabled, forced } = await this.ensureInjectCaches()
    if (disabled.has(sessionId)) return false
    if (forced.has(sessionId)) return true
    return null
  }

  /** 该会话是否启用记忆注入（未单独设置时用 fallback，即配置默认值）。 */
  async isInjectEnabled(sessionId: string, fallback = true): Promise<boolean> {
    return (await this.injectStateOf(sessionId)) ?? fallback
  }

  /**
   * 设置该会话的记忆注入开关（持久化到 state.json；调用频率极低，直接写）。
   * null = 清除本会话覆盖，回到 config.injectDefaultEnabled（面板「跟随默认」）。
   */
  async setInjectEnabled(sessionId: string, enabled: boolean | null): Promise<void> {
    const { disabled, forced } = await this.ensureInjectCaches()
    const nextDisabled = new Set(disabled)
    const nextForced = new Set(forced)
    if (enabled === null) {
      nextDisabled.delete(sessionId)
      nextForced.delete(sessionId)
    } else if (enabled) {
      nextDisabled.delete(sessionId)
      nextForced.add(sessionId)
    } else {
      nextForced.delete(sessionId)
      nextDisabled.add(sessionId)
    }
    this.injectDisabledCache = nextDisabled
    this.injectForcedCache = nextForced
    const state = await this.readState()
    state.injectDisabled = [...nextDisabled]
    state.injectForced = [...nextForced]
    await this.writeState(state)
  }

  // ── 中文记忆独立注入开关（全局单值） ──────────────────────────────

  /**
   * 中文记忆注入是否开启（三态：state 显式值 ?? 调用方给的 fallback）。
   *
   * 刻意做成**全局单值**而不是会话级：主注入的会话级覆盖是为了让不同会话
   * 临时收放上下文；中文偏好记忆是跨会话恒定的语言契约，逐会话开关只会
   * 制造「这个会话说中文、下个会话说英文」的割裂。
   */
  async isZhInjectEnabled(fallback: boolean): Promise<boolean> {
    const state = await this.readState()
    return typeof state.zhInjectEnabled === 'boolean' ? state.zhInjectEnabled : fallback
  }

  /** 写中文记忆注入开关（全局单值；直接落盘，调用频率极低）。 */
  async setZhInjectEnabled(enabled: boolean): Promise<void> {
    const state = await this.readState()
    state.zhInjectEnabled = enabled
    await this.writeState(state)
  }

  // ── 对话内流程图能力规范注入开关（全局单值） ──────────────────────

  /**
   * diagram 围栏规范注入是否开启（三态：state 显式值 ?? 调用方给的 fallback）。
   *
   * 与中文通道同样是**全局单值**：它是「本客户端支持什么呈现能力」的声明，
   * 不是逐会话的上下文松紧，逐会话开关只会制造「这个会话能画图、下个不能」
   * 的不可预期。
   */
  async isDiagramInjectEnabled(fallback: boolean): Promise<boolean> {
    const state = await this.readState()
    return typeof state.diagramInjectEnabled === 'boolean' ? state.diagramInjectEnabled : fallback
  }

  /** 写 diagram 规范注入开关（全局单值；直接落盘，调用频率极低）。 */
  async setDiagramInjectEnabled(enabled: boolean): Promise<void> {
    const state = await this.readState()
    state.diagramInjectEnabled = enabled
    await this.writeState(state)
  }

  // ── 对话内 HTML 卡片能力规范注入开关（全局单值） ────────────────────

  /**
   * html 围栏规范注入是否开启（三态：state 显式值 ?? 调用方给的 fallback）。
   *
   * 与 diagram 通道同样是**全局单值**，理由完全一致：它是「本客户端支持什么
   * 呈现能力」的声明，不是逐会话的上下文松紧。
   */
  async isHtmlInjectEnabled(fallback: boolean): Promise<boolean> {
    const state = await this.readState()
    return typeof state.htmlInjectEnabled === 'boolean' ? state.htmlInjectEnabled : fallback
  }

  /** 写 html 规范注入开关（全局单值；直接落盘，调用频率极低）。 */
  async setHtmlInjectEnabled(enabled: boolean): Promise<void> {
    const state = await this.readState()
    state.htmlInjectEnabled = enabled
    await this.writeState(state)
  }

  // ── 灵魂（Soul）注入开关（全局单值） ──────────────────────────────

  /**
   * 灵魂注入是否开启（三态：state 显式值 ?? 调用方给的 fallback）。
   *
   * 与 zh / diagram 同样是**全局单值**：灵魂是跨会话恒定的顶层身份契约，
   * 逐会话开关只会制造「这个会话是人设、下个不是」的人格分裂。
   */
  async isSoulInjectEnabled(fallback: boolean): Promise<boolean> {
    const state = await this.readState()
    return typeof state.soulInjectEnabled === 'boolean' ? state.soulInjectEnabled : fallback
  }

  /** 写灵魂注入开关（全局单值；直接落盘，调用频率极低）。 */
  async setSoulInjectEnabled(enabled: boolean): Promise<void> {
    const state = await this.readState()
    state.soulInjectEnabled = enabled
    await this.writeState(state)
  }

  // ── 效率约束规范注入开关（全局单值） ────────────────────────────────

  /**
   * 效率约束注入是否开启（三态：state 显式值 ?? 调用方给的 fallback）。
   *
   * 与 diagram / html 通道同样是**全局单值**：它投的是「本环境如何省 token」的
   * 静态纪律，跨会话恒定，逐会话开关只会制造「这个会话守纪律、下个不守」的
   * 不可预期。
   */
  async isEfficiencyInjectEnabled(fallback: boolean): Promise<boolean> {
    const state = await this.readState()
    return typeof state.efficiencyInjectEnabled === 'boolean' ? state.efficiencyInjectEnabled : fallback
  }

  /** 写效率约束注入开关（全局单值；直接落盘，调用频率极低）。 */
  async setEfficiencyInjectEnabled(enabled: boolean): Promise<void> {
    const state = await this.readState()
    state.efficiencyInjectEnabled = enabled
    await this.writeState(state)
  }

  // ── 项目 meta ───────────────────────────────────────────────────────

  async readProjectMeta(hash: string): Promise<ProjectMeta | undefined> {
    const meta = await readJson<ProjectMeta | null>(join(this.projectDir(hash), 'meta.json'), null)
    return meta ?? undefined
  }

  async writeProjectMeta(hash: string, meta: ProjectMeta): Promise<void> {
    await atomicWriteJson(join(this.projectDir(hash), 'meta.json'), meta)
  }

  /** 该工作区是否开启自动记忆（默认 true；meta 缺失或字段未写视为开启）。 */
  async isAutoMemoryEnabled(hash: string): Promise<boolean> {
    const meta = await this.readProjectMeta(hash)
    return meta?.autoMemory !== false
  }

  /**
   * 该工作区是否被排除出记忆注入（默认 false；meta 缺失或字段未写视为不排除）。
   * 注入引擎在 pre-step 时用它跳过被排除项目的会话——自动提取、手动记忆、
   * 检索与面板展示均不受影响。
   */
  async isInjectExcluded(hash: string): Promise<boolean> {
    const meta = await this.readProjectMeta(hash)
    return meta?.injectExcluded === true
  }

  /**
   * projects/ 下的全部目录名（hash），含 meta.json 缺失的裸目录。
   * 编译时用它找出「条目已被删光、md 产物却还留着旧内容」的项目。
   */
  async listProjectHashes(): Promise<string[]> {
    try {
      return (await readdir(join(this.root, 'projects'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch {
      return []
    }
  }

  /**
   * 列出全部项目（含 meta 与统计）。
   *
   * entryCount / pinnedCount 只数活跃条目：已软废弃（回收站里的）不计。
   * 早先这里把 deprecated 一并算进去，导致「全部记忆 5」与「某项目 8」
   * 自相矛盾——删掉的记忆在项目计数里阴魂不散。
   */
  async listProjects(entries: MemoryEntry[]): Promise<Array<ProjectMeta & { hash: string; entryCount: number; pinnedCount: number; autoMemory: boolean; injectExcluded: boolean }>> {
    const dir = join(this.root, 'projects')
    let hashes: string[]
    try {
      hashes = (await readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch {
      hashes = []
    }
    const projects: Array<ProjectMeta & { hash: string; entryCount: number; pinnedCount: number; autoMemory: boolean; injectExcluded: boolean }> = []
    for (const hash of hashes) {
      const meta = await this.readProjectMeta(hash)
      if (meta === undefined) continue
      const owned = entries.filter(entry =>
        entry.scope === 'project' && entry.projectHash === hash && entry.deprecated !== true)
      projects.push({
        hash,
        path: meta.path,
        alias: meta.alias,
        locked: meta.locked,
        autoMemory: meta.autoMemory !== false,
        injectExcluded: meta.injectExcluded === true,
        entryCount: owned.length,
        pinnedCount: owned.filter(entry => entry.pinned).length,
      })
    }
    projects.sort((a, b) => a.path.localeCompare(b.path))
    return projects
  }

  /**
   * 读取 DSH 工作区注册表（${DSH_HOME}/storages/workspace.json），容错返回空。
   * 用于让「尚无记忆的新工作区」也出现在面板项目列表（entryCount 0）。
   */
  async listDshWorkspaces(): Promise<Array<{ path: string; title: string }>> {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const file = join(dshHome, 'storages', 'workspace.json')
    const raw = await readJson<{ tables?: { workspaces?: Record<string, { path?: string; title?: string }> } }>(file, {})
    const table = raw?.tables?.workspaces
    if (typeof table !== 'object' || table === null) return []
    const out: Array<{ path: string; title: string }> = []
    for (const record of Object.values(table)) {
      if (typeof record === 'object' && record !== null && typeof record.path === 'string' && record.path !== '') {
        out.push({ path: record.path, title: typeof record.title === 'string' && record.title !== '' ? record.title : record.path })
      }
    }
    return out
  }

  // ── 修订版本（consolidate 回滚锚点） ────────────────────────────────

  revisionsDir(): string {
    return join(this.root, 'revisions')
  }

  /**
   * 写入一个修订快照（整理前调用），返回修订 id。
   * 保存 meta + 全量 entries，回滚时直接整体恢复。
   */
  async writeRevision(input: { entries: MemoryEntry[]; scope: string; trigger: 'daily' | 'manual' }): Promise<string> {
    const id = `rev_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
    const meta: RevisionMeta = {
      id,
      at: nowIso(),
      entryCount: input.entries.length,
      scope: input.scope,
      trigger: input.trigger,
    }
    await atomicWriteJson(join(this.revisionsDir(), `${id}.json`), { version: 1, meta, entries: input.entries })
    await this.pruneRevisions(REVISION_KEEP)
    return id
  }

  /** 列出修订版本（新 → 旧）。 */
  async listRevisions(): Promise<RevisionMeta[]> {
    const dir = this.revisionsDir()
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return []
    }
    const metas: RevisionMeta[] = []
    for (const file of files) {
      if (!/^rev_[0-9a-z]+_[0-9a-z]+\.json$/.test(file)) continue
      const data = await readJson<{ meta?: RevisionMeta }>(join(dir, file), {})
      if (data.meta !== undefined && typeof data.meta.id === 'string') metas.push(data.meta)
    }
    return metas.sort((a, b) => b.at.localeCompare(a.at))
  }

  /** 读修订快照的全部条目；不存在返回 null。 */
  async readRevisionEntries(id: string): Promise<MemoryEntry[] | null> {
    const data = await readJson<{ entries?: MemoryEntry[] } | null>(join(this.revisionsDir(), `${id}.json`), null)
    if (data === null || !Array.isArray(data.entries)) return null
    return data.entries
  }

  /** 回滚到某修订（整体恢复 entries，走写串行队列）。返回是否成功。 */
  async restoreRevision(id: string): Promise<boolean> {
    const entries = await this.readRevisionEntries(id)
    if (entries === null) return false
    await this.replaceEntries(() => entries)
    return true
  }

  /** 滚动清理：只保留最近 keep 个修订。 */
  async pruneRevisions(keep: number): Promise<void> {
    const metas = await this.listRevisions()
    if (metas.length <= keep) return
    for (const meta of metas.slice(keep)) {
      try {
        await unlink(join(this.revisionsDir(), `${meta.id}.json`))
      } catch {
        // 已不存在则忽略。
      }
    }
  }

  // ── md 产物（compile.ts 调用） ─────────────────────────────────────

  /** 写任意 md 产物（原子）。 */
  async writeArtifact(path: string, content: string): Promise<void> {
    await atomicWriteText(join(this.root, path), content)
  }

  /** 写项目层产物。 */
  async writeProjectArtifacts(hash: string, artifacts: { memory?: string; facts?: string; pinned?: string }): Promise<void> {
    const dir = this.projectDir(hash)
    await mkdir(dir, { recursive: true })
    for (const [name, content] of Object.entries(artifacts)) {
      if (content === undefined) continue
      await atomicWriteText(join(dir, `${name}.md`), content)
    }
  }

  /** 写全局层产物。 */
  async writeGlobalArtifacts(artifacts: { identity?: string; facts?: string; pinned?: string }): Promise<void> {
    const dir = this.globalDir()
    await mkdir(dir, { recursive: true })
    for (const [name, content] of Object.entries(artifacts)) {
      if (content === undefined) continue
      await atomicWriteText(join(dir, `${name}.md`), content)
    }
  }
}

/** 合并标签（保留旧标签 + 新标签，去重，上限 8）。 */
export function mergeTags(existing: string[], next: string[] | undefined, max = 8): string[] {
  const out: string[] = []
  for (const tag of [...existing, ...(next ?? [])]) {
    const t = String(tag).trim()
    if (t === '') continue
    if (!out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** 摘要（截断 80 字）。 */
export function summarize(content: string, max = 80): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

// ── schema v1 → v2 迁移与记忆类型推断 ────────────────────────────────

/** 同步读 JSON（构造时用，容错返回 fallback）。 */
function readJsonSync<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** 校验是否为合法 MemoryKind。 */
function isMemoryKind(value: unknown): value is MemoryKind {
  return value === 'identity' || value === 'preference' || value === 'fact'
    || value === 'decision' || value === 'gotcha' || value === 'session-summary'
}

/** 由标签推断记忆类型（v1 无 kind 字段时的迁移兜底）。 */
function inferKind(tags: string[] | undefined): MemoryKind {
  const lower = (tags ?? []).map(tag => String(tag).toLowerCase())
  if (lower.some(tag => tag === '身份' || tag === 'identity')) return 'identity'
  if (lower.some(tag => tag === '偏好' || tag === 'preference' || tag === '风格' || tag === 'style' || tag === '习惯' || tag === 'habit')) return 'preference'
  if (lower.some(tag => tag === '踩坑' || tag === 'gotcha' || tag === '坑')) return 'gotcha'
  if (lower.some(tag => tag === '决策' || tag === 'decision')) return 'decision'
  return 'fact'
}

/** v1 → v2 迁移：补 version/confidence/verified/kind（容错坏行）。 */
function migrateEntries(entries: unknown): MemoryEntry[] {
  if (!Array.isArray(entries)) return []
  const out: MemoryEntry[] = []
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Partial<MemoryEntry>
    if (typeof entry.id !== 'string' || typeof entry.content !== 'string') continue
    const source = entry.source === 'manual' ? 'manual' as const : 'extract' as const
    out.push({
      id: entry.id,
      content: entry.content,
      scope: entry.scope === 'global' ? 'global' : 'project',
      projectHash: entry.scope === 'project' ? (typeof entry.projectHash === 'string' ? entry.projectHash : null) : null,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      pinned: entry.pinned === true,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : nowIso(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : nowIso(),
      importance: typeof entry.importance === 'number' ? entry.importance : 10,
      lastHitAt: typeof entry.lastHitAt === 'string' ? entry.lastHitAt : null,
      layer: entry.layer === 'long' ? 'long' : 'short',
      source,
      version: typeof entry.version === 'number' ? entry.version : 1,
      confidence: typeof entry.confidence === 'number' ? entry.confidence : (source === 'manual' ? 1 : 0.6),
      verified: entry.verified === true || source === 'manual',
      kind: isMemoryKind(entry.kind) ? entry.kind : inferKind(entry.tags),
      provenance: entry.provenance,
      embedding: Array.isArray(entry.embedding) ? entry.embedding : undefined,
      // disabled 是可选字段：仅 true 时保留（undefined=启用，落盘不冗余）。
      ...(entry.disabled === true ? { disabled: true } : {}),
      // schema v3：软废弃字段（仅真实废弃时保留）。
      ...(entry.deprecated === true
        ? {
            deprecated: true as const,
            deprecatedAt: typeof entry.deprecatedAt === 'string' ? entry.deprecatedAt : nowIso(),
            ...(typeof entry.deprecatedReason === 'string' && entry.deprecatedReason !== ''
              ? { deprecatedReason: entry.deprecatedReason }
              : {}),
            ...(typeof entry.supersededBy === 'string' ? { supersededBy: entry.supersededBy } : {}),
          }
        : {}),
    })
  }
  return out
}
