/**
 * dsh-chat-plus — Seeker 卡头「Git 大盘」开合状态与数据共享 Store。
 *
 * 最早这里只存一个 open 布尔值，负责让卡头 Git 按钮与 GitRosterModal 联动。
 * 2026-10-29 扩展：卡头 Git 图标要像邮箱按钮一样挂「待提交」角标，角标数字 =
 * **Git 大盘里有未提交改动的仓库个数**（工作区 + 自制插件：一个仓库改 11 个文件也只算 1）。
 *
 * 数据不能由角标单独轮询：/api/chat-flow/git-roster 会逐个仓库跑 git status，
 * 比单仓库的 /api/chat-flow/git-status 贵得多。所以把拉取与缓存一并收进本
 * store：卡头角标与 GitRosterModal 共用同一份数据、同一个 45 秒轮询；弹窗
 * 打开时立即强制刷新一次，关闭后仍跟着 45 秒节拍走（角标要持续可见）。
 *
 * 与 mail-unread-store / git-status-store 同款约束：
 *   · getSnapshot 必须返回稳定引用（每次现造对象会让 useSyncExternalStore
 *     判定「永远在变」，右栏大盘直接撞 React error #185）；
 *   · 页面隐藏时暂停轮询，切回前台 / 窗口聚焦时补一次；
 *   · 功能开关 view.git-status 关闭时不订阅、不请求。
 *
 * @module
 */

import { useCallback, useSyncExternalStore } from 'react'
import { getService } from '../client-ctx.ts'
import { featureEnabledNow } from '../features/gate.tsx'

/** 大盘里的一个仓库（工作区或自制插件）。 */
export interface GitRosterItem {
  readonly name: string
  readonly path: string
  readonly category: 'workspace' | 'plugin'
  readonly isGit: boolean
  readonly branch?: string
  readonly lastCommit?: {
    readonly timestamp: number
    readonly relative: string
    readonly subject: string
    readonly hash: string
    readonly dateIso: string
  }
  readonly pendingCount: number
  readonly conflictCount: number
  readonly clean: boolean
  readonly needsMerge: boolean
  readonly mergeReason?: 'conflict' | 'behind' | 'merging'
  readonly aheadCount: number
  readonly behindCount: number
  readonly error?: string
}

/** Git 大盘回包。 */
export interface GitRosterData {
  readonly ok: boolean
  readonly workspaces: readonly GitRosterItem[]
  readonly plugins: readonly GitRosterItem[]
}

/** 对外快照（引用稳定：只有数据真的变了才换对象）。 */
export interface GitRosterSnapshot {
  /** Git 大盘弹窗是否打开。 */
  readonly open: boolean
  /** 最近一次成功拉取的数据（未拿到时为 null）。 */
  readonly data: GitRosterData | null
  /** 是否正在请求。 */
  readonly loading: boolean
  /** 全部仓库的待提交文件数合计（大盘弹窗顶部统计用）。 */
  readonly totalPending: number
  /** **有未提交改动的仓库个数**（卡头角标数字：多少个 Git 项目没提交，不是文件数）。 */
  readonly dirtyRepoCount: number
  /** 全部仓库的冲突数合计。 */
  readonly totalConflicts: number
  /** 上次成功拉取的时间戳（毫秒）。 */
  readonly lastLoaded: number
  /** 上次失败原因（成功时为 null）。 */
  readonly error: string | null
}

type Listener = () => void

/** 自动轮询间隔（ms）：与邮箱未读检查同节奏（45 秒）；大盘要扫所有仓库，不宜更密。 */
const AUTO_POLL_INTERVAL_MS = 45_000

/** 最小冷却（ms）：弹窗打开 / focus 不会把大盘扫描打成连发。 */
const MIN_COOLDOWN_MS = 5_000

const STORE_GLOBAL_KEY = '__dshChatPlusGitRosterStore__'
const STORE_BRAND = '__dshGitRosterStoreBrand__'

/** 计算大盘的待提交 / 冲突合计（纯函数，供冒烟对拍）。 */
export function totalPendingOf(data: GitRosterData | null): number {
  if (data === null) return 0
  let total = 0
  for (const item of data.plugins ?? []) total += Math.max(0, Number(item.pendingCount) || 0)
  for (const item of data.workspaces ?? []) total += Math.max(0, Number(item.pendingCount) || 0)
  return total
}

/**
 * 计算「有未提交改动的仓库个数」——卡头角标的数字口径。
 *
 * 用户 2026-10-29 明确：角标要显示「有多少个 Git 项目没有提交」，不是文件条数。
 * 所以只数 isGit 且 pendingCount > 0 的仓库，一个仓库哪怕改了 11 个文件也只算 1。
 */
export function dirtyRepoCountOf(data: GitRosterData | null): number {
  if (data === null) return 0
  let count = 0
  for (const item of [...(data.plugins ?? []), ...(data.workspaces ?? [])]) {
    if (item.isGit && Math.max(0, Number(item.pendingCount) || 0) > 0) count += 1
  }
  return count
}

/** 计算大盘的冲突合计（纯函数）。 */
export function totalConflictsOf(data: GitRosterData | null): number {
  if (data === null) return 0
  let total = 0
  for (const item of data.plugins ?? []) total += Math.max(0, Number(item.conflictCount) || 0)
  for (const item of data.workspaces ?? []) total += Math.max(0, Number(item.conflictCount) || 0)
  return total
}

function emptySnapshot(): GitRosterSnapshot {
  return {
    open: false,
    data: null,
    loading: false,
    totalPending: 0,
    dirtyRepoCount: 0,
    totalConflicts: 0,
    lastLoaded: 0,
    error: null,
  }
}

class GitRosterStore {
  readonly [STORE_BRAND] = true as const

  private _open = false
  private _data: GitRosterData | null = null
  private _loading = false
  private _lastLoaded = 0
  private _lastAttempt = 0
  private _error: string | null = null
  private _active: Promise<void> | null = null
  private _snapshot: GitRosterSnapshot = emptySnapshot()
  private readonly _listeners = new Set<Listener>()
  private _timer: number | null = null

  constructor() {
    if (typeof window === 'undefined') return
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refreshAll()
      })
    }
    window.addEventListener('focus', () => { this.refreshAll() })
  }

  get open(): boolean {
    return this._open
  }

  get data(): GitRosterData | null {
    return this._data
  }

  get loading(): boolean {
    return this._loading
  }

  /** 当前快照（引用稳定，见文件头）。 */
  getSnapshot(): GitRosterSnapshot {
    return this._snapshot
  }

  /** 重建快照；值没变则不通知。 */
  private publish(): void {
    const next: GitRosterSnapshot = {
      open: this._open,
      data: this._data,
      loading: this._loading,
      totalPending: totalPendingOf(this._data),
      dirtyRepoCount: dirtyRepoCountOf(this._data),
      totalConflicts: totalConflictsOf(this._data),
      lastLoaded: this._lastLoaded,
      error: this._error,
    }
    const prev = this._snapshot
    if (prev.open === next.open
      && prev.data === next.data
      && prev.loading === next.loading
      && prev.totalPending === next.totalPending
      && prev.dirtyRepoCount === next.dirtyRepoCount
      && prev.totalConflicts === next.totalConflicts
      && prev.lastLoaded === next.lastLoaded
      && prev.error === next.error) {
      return
    }
    this._snapshot = next
    for (const listener of this._listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[git-roster-store] listener error', error)
      }
    }
  }

  setOpen(next: boolean): void {
    if (this._open === next) return
    this._open = next
    this.publish()
  }

  toggle(): void {
    this.setOpen(!this._open)
  }

  close(): void {
    this.setOpen(false)
  }

  /** 订阅（第一个订阅者启动定时器；最后一个离开时停掉）。 */
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    if (this._listeners.size === 1) this.start()
    return () => {
      this._listeners.delete(listener)
      if (this._listeners.size === 0) this.stop()
    }
  }

  /** 拉一次大盘状态。 */
  async refresh(force = false): Promise<void> {
    if (!featureEnabledNow('view.git-status')) return
    const now = Date.now()
    if (!force && now - this._lastAttempt < MIN_COOLDOWN_MS) return
    if (this._active !== null) return this._active

    this._lastAttempt = now
    this._loading = true
    this.publish()

    const active = (async () => {
      try {
        // 与 GitRosterModal 原逻辑同口径：把官方工作区服务里的目录一并带上，
        // 这样大盘能覆盖「已打开但不在当前工作区」的仓库。
        let extraPaths: string[] = []
        try {
          const workspacesService = getService<any>('workspaces')
          const items = workspacesService?.list?.getSnapshot?.()?.items
          if (Array.isArray(items)) {
            extraPaths = items.map((item: any) => item.directory).filter((dir: any) => typeof dir === 'string' && dir !== '')
          }
        } catch { /* 服务缺席：只按 host 端自己发现的工作区来 */ }

        const query = extraPaths.length > 0 ? `?workspaces=${encodeURIComponent(extraPaths.join(','))}` : ''
        const response = await fetch(`/api/chat-flow/git-roster${query}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = await response.json() as GitRosterData & { ok?: boolean; error?: string }
        if (payload !== null && typeof payload === 'object' && payload.ok === true) {
          this._data = payload
          this._lastLoaded = Date.now()
          this._error = null
        } else {
          this._error = payload?.error ?? 'invalid response'
        }
      } catch (error) {
        // 保留上一份数据（大盘不该因为一次扫描失败而清空），只记错误。
        this._error = error instanceof Error ? error.message : String(error)
      } finally {
        this._loading = false
        this._active = null
        this.publish()
      }
    })()
    this._active = active
    return active
  }

  private start(): void {
    if (typeof window === 'undefined') {
      void this.refresh(true)
      return
    }
    if (this._timer === null) {
      this._timer = window.setInterval(() => {
        if (!featureEnabledNow('view.git-status')) return
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void this.refresh(false)
      }, AUTO_POLL_INTERVAL_MS)
    }
    void this.refresh(this._lastLoaded === 0)
  }

  private stop(): void {
    if (this._timer !== null) {
      window.clearInterval(this._timer)
      this._timer = null
    }
  }

  private refreshAll(): void {
    if (!featureEnabledNow('view.git-status')) return
    if (this._listeners.size > 0) void this.refresh(false)
  }
}

class BrandedGitRosterStore extends GitRosterStore {}

let storeInstance: GitRosterStore | null = null

/** 取共享 store（跨 bundle 实例唯一，live reload 后不产生两套轮询）。 */
export function getGitRosterStore(): GitRosterStore {
  if (typeof window !== 'undefined') {
    const holder = window as unknown as Record<string, unknown>
    const existing = holder[STORE_GLOBAL_KEY] as GitRosterStore | undefined
    if (
      existing instanceof BrandedGitRosterStore
      || (existing !== undefined && (existing as unknown as Record<string, unknown>)[STORE_BRAND] === true
        && typeof existing.subscribe === 'function')
    ) {
      return existing
    }
    const created = storeInstance ?? new BrandedGitRosterStore()
    storeInstance = created
    holder[STORE_GLOBAL_KEY] = created
    return created
  }
  if (!storeInstance) storeInstance = new BrandedGitRosterStore()
  return storeInstance
}

/** React hook：订阅 Git 大盘快照（enabled=false 时不启动轮询）。 */
export function useGitRosterSnapshot(enabled: boolean): GitRosterSnapshot {
  const store = getGitRosterStore()
  const subscribe = useCallback(
    (listener: () => void): (() => void) => (enabled ? store.subscribe(listener) : () => {}),
    [enabled, store],
  )
  return useSyncExternalStore(subscribe, () => store.getSnapshot(), () => store.getSnapshot())
}
