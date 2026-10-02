/**
 * dsh-mail — 本地状态存储（host 半身）。
 *
 * 数据根：`${DSH_HOME:-~/.dsh}/mail/dsh-mail/`
 *
 *   store/config.json   运行时配置覆盖层（面板改动落这里，重启后仍生效）
 *   store/state.json    待确认写操作 + 新邮件事件环形缓冲
 *   cache/messages.json 最近一次列表结果（面板打开瞬间先渲染缓存，再刷新）
 *
 * 三条设计约束：
 *
 *  1. **邮箱本身的真相在服务端**，本地只缓存「信封」（subject/snippet/…），
 *     且缓存随时可丢——缓存读不出来就当空，绝不让面板因为缓存损坏而打不开。
 *  2. **待确认操作必须落盘**：两阶段确认的第二阶段可能发生在进程重启之后
 *     （用户隔了一会儿才回「确认」），只存内存会让 ctk 凭空消失，用户看到
 *     「确认了但没发出去」。
 *  3. **写盘走唯一临时名 + rename**：Windows 上固定 `${file}.tmp` 会让并发写
 *     互相截断（这条踩坑在记忆引擎里已经吃过一次，同一手法复用）。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { MailConfig, MailSummary, PendingConfirmation } from './types.js'
import { DEFAULT_MAIL_CONFIG, applyMailConfigOverrides } from './types.js'

/** 一条新邮件事件（watch 收到后落盘，面板据此提示）。 */
export interface StoredWatchEvent {
  message_id?: string
  dir?: string
  occurred_at?: string
  /** 本地收到时间（毫秒）。 */
  at: number
}

/** state.json 的形状。 */
interface MailState {
  /** 待确认写操作：token → 记录。 */
  pending: Record<string, PendingConfirmation>
  /** 新邮件事件（最多 50 条，最新在前）。 */
  events: StoredWatchEvent[]
  /** 上次列表缓存的时间戳（毫秒）。 */
  lastListAt: number
}

/** cache/messages.json 的形状。 */
interface MailCache {
  dir: string
  at: number
  messages: MailSummary[]
}

const EMPTY_STATE: MailState = { pending: {}, events: [], lastListAt: 0 }

/** 邮箱数据根。 */
export function mailDataDir(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'mail', 'dsh-mail')
}

/** 原子写文本：唯一临时名 → rename。 */
async function atomicWrite(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, file)
}

/** 读 JSON（不存在/损坏都返回 fallback，绝不抛）。 */
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as T : fallback
  } catch {
    return fallback
  }
}

/**
 * 邮箱本地状态（进程内单例）。
 *
 * 内存态权威 + 节流刷盘：待确认操作与事件都是低频写，直接落盘也够，
 * 但列表缓存每次翻页都写就太吵，故缓存单独走节流。
 */
export class MailStore {
  private state: MailState = { ...EMPTY_STATE }
  private loaded = false
  private cacheWriteTimer: ReturnType<typeof setTimeout> | null = null

  /** 数据根（诊断/面板展示用）。 */
  readonly root: string = mailDataDir()

  private get stateFile(): string { return join(this.root, 'store', 'state.json') }
  private get configFile(): string { return join(this.root, 'store', 'config.json') }
  private get cacheFile(): string { return join(this.root, 'cache', 'messages.json') }

  /** 首次读取落盘状态（幂等）。 */
  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const raw = await readJson<Partial<MailState>>(this.stateFile, {})
    this.state = {
      pending: typeof raw.pending === 'object' && raw.pending !== null ? raw.pending : {},
      events: Array.isArray(raw.events) ? raw.events.slice(0, 50) : [],
      lastListAt: typeof raw.lastListAt === 'number' ? raw.lastListAt : 0,
    }
    this.prunePending()
  }

  private async persist(): Promise<void> {
    await atomicWrite(this.stateFile, JSON.stringify(this.state, null, 2)).catch(() => undefined)
  }

  /** 清掉过期（>5 分钟，与 ctk 有效期一致）的待确认记录。 */
  private prunePending(): void {
    const now = Date.now()
    let changed = false
    for (const [token, record] of Object.entries(this.state.pending)) {
      if (now - record.createdAt > 5 * 60_000) {
        delete this.state.pending[token]
        changed = true
      }
    }
    if (changed) void this.persist()
  }

  /* ── 待确认写操作 ─────────────────────────────────────────────────── */

  /** 记下一条待确认操作（ctk 落盘，重启后仍能续）。 */
  async putPending(record: PendingConfirmation): Promise<void> {
    await this.load()
    this.state.pending[record.token] = record
    this.prunePending()
    await this.persist()
  }

  /** 取一条待确认操作（顺带做一次过期清理）。 */
  async getPending(token: string): Promise<PendingConfirmation | undefined> {
    await this.load()
    this.prunePending()
    return this.state.pending[token]
  }

  /** 列出全部待确认操作（面板「待确认」区）。 */
  async listPending(): Promise<PendingConfirmation[]> {
    await this.load()
    this.prunePending()
    return Object.values(this.state.pending).sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 撤销/完成一条待确认操作。 */
  async dropPending(token: string): Promise<boolean> {
    await this.load()
    if (this.state.pending[token] === undefined) return false
    delete this.state.pending[token]
    await this.persist()
    return true
  }

  /* ── 新邮件事件 ───────────────────────────────────────────────────── */

  /** 记一条新邮件事件（最多保留 50 条）。 */
  async pushEvent(event: StoredWatchEvent): Promise<void> {
    await this.load()
    this.state.events = [event, ...this.state.events].slice(0, 50)
    await this.persist()
  }

  /** 读事件缓冲（面板「新邮件」提示）。 */
  async listEvents(): Promise<StoredWatchEvent[]> {
    await this.load()
    return [...this.state.events]
  }

  /** 清空事件缓冲（用户看过之后）。 */
  async clearEvents(): Promise<void> {
    await this.load()
    this.state.events = []
    await this.persist()
  }

  /* ── 列表缓存 ─────────────────────────────────────────────────────── */

  /** 写列表缓存（节流 800ms：翻页时不至于每页都写盘）。 */
  writeCache(dir: string, messages: MailSummary[]): void {
    this.state.lastListAt = Date.now()
    if (this.cacheWriteTimer !== null) clearTimeout(this.cacheWriteTimer)
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = null
      const payload: MailCache = { dir, at: Date.now(), messages }
      void atomicWrite(this.cacheFile, JSON.stringify(payload)).catch(() => undefined)
    }, 800)
  }

  /** 读列表缓存（不存在返回 null）。 */
  async readCache(): Promise<MailCache | null> {
    const cache = await readJson<MailCache | null>(this.cacheFile, null)
    if (cache === null || !Array.isArray(cache.messages)) return null
    return cache
  }

  /**
   * 作废列表缓存（写操作成功后调用）。
   *
   * 三件事一起做，缺任何一件缓存都会「复活」：
   *  1. **清掉待写的节流定时器** —— 它是 800ms 后落盘的一次性任务，留着就会把
   *     「删除前」那份快照原样写回磁盘，刚作废的缓存又活了；
   *  2. **删掉磁盘缓存文件** —— 面板下次打开/刷新时读不到，只能走实时；
   *  3. 只碰缓存，不动待确认与事件（那是另一条状态线）。
   *
   * 为什么必须作废：面板刷新列表时带 `cache=1`，命中就直接返回快照、不再拉
   * 实时。移入回收站成功后若缓存还在，邮件会**继续留在原文件夹的列表里**，
   * 用户以为没生效就再点一次 —— 那一击必然撞上服务端的目录约束
   * （`Cannot delete message from this directory`）。
   */
  async invalidateCache(): Promise<void> {
    if (this.cacheWriteTimer !== null) {
      clearTimeout(this.cacheWriteTimer)
      this.cacheWriteTimer = null
    }
    await rm(this.cacheFile, { force: true }).catch(() => undefined)
  }

  /** 读运行时配置覆盖层（不存在返回 {}）。 */
  async readConfig(): Promise<Partial<MailConfig>> {
    return await readJson<Partial<MailConfig>>(this.configFile, {})
  }

  /** 写配置覆盖层。 */
  async writeConfig(patch: Partial<MailConfig>): Promise<void> {
    await atomicWrite(this.configFile, JSON.stringify(patch, null, 2))
  }

  /** 合并出最终配置（默认 → 覆盖层 → 代码级配置）。 */
  async resolveConfig(overrides: Partial<MailConfig> | undefined): Promise<MailConfig> {
    const config: MailConfig = { ...DEFAULT_MAIL_CONFIG }
    applyMailConfigOverrides(config, await this.readConfig())
    applyMailConfigOverrides(config, overrides)
    return config
  }
}
