/**
 * dsh-chat-plus — 工作区 Git 待提交状态共享 Store（client 半身）。
 *
 * ## 为什么需要它
 *
 * 1. 操作面板卡头的 Git 图标要像邮箱按钮一样挂「待提交条数」角标；
 *    数据必须自动刷新，不能等用户点开才会更新。
 * 2. 卡头下方已经有 `SeekerGitStatus` 微组件，它原本自己每 15 秒轮询
 *    `/api/chat-flow/git-status`。如果再让角标单独轮询，同一份 git 状态
 *    会被同一页面请求两遍（host 每次要跑 6~8 条 git 子命令，白烧）。
 * 3. 因此把「拉取 + 缓存」收进这一个 store：卡头角标与 SeekerGitStatus
 *    共享同一份数据、同一个定时器。谁先订阅谁启动轮询，最后一个订阅者
 *    离开才停。
 *
 * ## 行为与 mail-unread-store 同款
 *
 *   · 15 秒轮询（沿用 SeekerGitStatus 原来的节奏）；
 *   · 5 秒冷却：focus / visibilitychange 与手动刷新不会把请求打成连发；
 *   · 页面隐藏时暂停轮询，切回前台 / 窗口聚焦时补一次；
 *   · **getSnapshot 必须返回稳定引用**——每次现造对象会让 useSyncExternalStore
 *     判定「永远在变」，右栏大盘直接撞 React error #185（mail-unread-store 踩过）。
 *
 * @module
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { GitStatusData } from './git-status-types.ts'
import { featureEnabledNow } from '../features/gate.tsx'

/** 自动轮询间隔（ms）：与 SeekerGitStatus 旧实现保持一致。 */
const AUTO_POLL_INTERVAL_MS = 15_000

/** 最小冷却（ms）：本机 git status 比邮件接口便宜，但不能被 focus/visibility 打成连发。 */
const MIN_COOLDOWN_MS = 5_000

const STORE_GLOBAL_KEY = '__dshChatPlusGitStatusStore__'
const STORE_BRAND = '__dshGitStatusStoreBrand__'

/** 对外快照（引用稳定：只有数据真的变了才换对象）。 */
export interface GitStatusSnapshot {
  /** 快照对应的 cwd（'' = 跟随宿主 process.cwd）。 */
  readonly cwd: string
  /** 完整 Git 状态（未拿到 / 失败时为 null）。 */
  readonly data: GitStatusData | null
  /** 待提交文件数（isGit=false / 失败时为 0）。 */
  readonly pendingCount: number
  /** 当前是否正在请求。 */
  readonly loading: boolean
  /** 上次**成功**拉取的时间戳（毫秒）。 */
  readonly lastChecked: number
  /** 上次失败的原因（成功时为 null）。 */
  readonly error: string | null
}

type Listener = () => void

/** 空快照（cwd 未确定 / 未订阅时的稳定返回值）。 */
const EMPTY_SNAPSHOT: GitStatusSnapshot = Object.freeze({
  cwd: '',
  data: null,
  pendingCount: 0,
  loading: false,
  lastChecked: 0,
  error: null,
})

interface Entry {
  readonly cwd: string
  data: GitStatusData | null
  pendingCount: number
  loading: boolean
  lastChecked: number
  /** 上次失败原因（成功时为 null）。 */
  error: string | null
  /** 上次**发起请求**的时刻（失败也更新，避免失败路径把冷却绕过）。 */
  lastAttempt: number
  active: Promise<number> | null
  snapshot: GitStatusSnapshot
  readonly listeners: Set<Listener>
  timer: number | null
}

class GitStatusStore {
  readonly [STORE_BRAND] = true as const

  private readonly entries = new Map<string, Entry>()

  constructor() {
    if (typeof window === 'undefined') return
    // 页面切回前台 / 窗口重新聚焦时补一次（冷却会吞掉过密的重复触发）。
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refreshAll(false)
      })
    }
    window.addEventListener('focus', () => { this.refreshAll(false) })
  }

  /** 取/建某个 cwd 的条目。 */
  private entryOf(cwd: string): Entry {
    let entry = this.entries.get(cwd)
    if (entry === undefined) {
      entry = {
        cwd,
        data: null,
        pendingCount: 0,
        loading: false,
        lastChecked: 0,
        error: null,
        lastAttempt: 0,
        active: null,
        snapshot: { cwd, data: null, pendingCount: 0, loading: false, lastChecked: 0, error: null },
        listeners: new Set<Listener>(),
        timer: null,
      }
      this.entries.set(cwd, entry)
    }
    return entry
  }

  /** 发布新快照（只在内容变化时换对象并通知）。 */
  private publish(entry: Entry): void {
    const next: GitStatusSnapshot = {
      cwd: entry.cwd,
      data: entry.data,
      pendingCount: entry.pendingCount,
      loading: entry.loading,
      lastChecked: entry.lastChecked,
      error: entry.error,
    }
    const prev = entry.snapshot
    if (prev.data === next.data
      && prev.pendingCount === next.pendingCount
      && prev.loading === next.loading
      && prev.lastChecked === next.lastChecked
      && prev.error === next.error) {
      return
    }
    entry.snapshot = next
    for (const listener of entry.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[git-status-store] listener error', error)
      }
    }
  }

  /** 读快照（useSyncExternalStore 的 getSnapshot；引用稳定）。 */
  getSnapshot(cwd: string): GitStatusSnapshot {
    return this.entries.get(cwd)?.snapshot ?? EMPTY_SNAPSHOT
  }

  /**
   * 订阅某个 cwd 的 Git 状态。
   *
   * 第一个订阅者启动定时器并立即拉一次；最后一个订阅者离开时停掉定时器
   * （已拿到的数据保留，下次重新订阅先用缓存顶上，避免闪一下空白）。
   */
  subscribe(cwd: string, listener: Listener): () => void {
    const entry = this.entryOf(cwd)
    entry.listeners.add(listener)
    if (entry.listeners.size === 1) this.start(entry)
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) this.stop(entry)
    }
  }

  /**
   * 拉一次状态。
   *
   * @param cwd - 工作区根目录（'' = 不传 query，host 用 process.cwd）。
   * @param force - 跳过冷却（提交成功后的主动刷新）。
   */
  async refresh(cwd: string, force = false): Promise<number> {
    const entry = this.entryOf(cwd)
    // 功能开关关闭：任何调用都不真的发请求（SeekerHead/SeekerGitStatus 已不订阅，
    // 这里再守一道，避免其它入口绕过）。
    if (!featureEnabledNow('view.git-status')) return entry.pendingCount
    const now = Date.now()
    if (!force && now - entry.lastAttempt < MIN_COOLDOWN_MS) return entry.pendingCount
    if (entry.active !== null) return entry.active

    entry.lastAttempt = now
    entry.loading = true
    this.publish(entry)

    const active = (async () => {
      try {
        const query = entry.cwd === '' ? '' : `?cwd=${encodeURIComponent(entry.cwd)}`
        const response = await fetch(`/api/chat-flow/git-status${query}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = await response.json() as GitStatusData & { ok?: boolean; error?: string }
        if (payload !== null && typeof payload === 'object' && payload.ok === true) {
          entry.data = payload
          entry.pendingCount = payload.isGit ? Math.max(0, Number(payload.pendingCount) || 0) : 0
          entry.lastChecked = Date.now()
          entry.error = null
        } else {
          entry.data = null
          entry.pendingCount = 0
          entry.error = payload?.error ?? 'invalid response'
        }
      } catch (error) {
        // 优雅降级：网络抖动 / 尚未启动时收起角标，不干扰主流程。
        entry.data = null
        entry.pendingCount = 0
        entry.error = error instanceof Error ? error.message : String(error)
      } finally {
        entry.loading = false
        entry.active = null
        this.publish(entry)
      }
      return entry.pendingCount
    })()
    entry.active = active

    return active
  }

  /** 启动某个条目的定时器（幂等）。 */
  private start(entry: Entry): void {
    if (typeof window === 'undefined') {
      void this.refresh(entry.cwd, true)
      return
    }
    if (entry.timer === null) {
      entry.timer = window.setInterval(() => {
        if (!featureEnabledNow('view.git-status')) return
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void this.refresh(entry.cwd, false)
      }, AUTO_POLL_INTERVAL_MS)
    }
    void this.refresh(entry.cwd, entry.lastChecked === 0)
  }

  /** 停掉某个条目的定时器（保留缓存）。 */
  private stop(entry: Entry): void {
    if (entry.timer !== null) {
      window.clearInterval(entry.timer)
      entry.timer = null
    }
  }

  /** 刷新所有仍有订阅者的条目。 */
  private refreshAll(force: boolean): void {
    if (!featureEnabledNow('view.git-status')) return
    for (const entry of this.entries.values()) {
      if (entry.listeners.size > 0) void this.refresh(entry.cwd, force)
    }
  }
}

class BrandedGitStatusStore extends GitStatusStore {}

let storeInstance: GitStatusStore | null = null

/** 取共享 store（跨 bundle 实例唯一，live reload 后不产生两套轮询）。 */
export function getGitStatusStore(): GitStatusStore {
  if (typeof window !== 'undefined') {
    const holder = window as unknown as Record<string, unknown>
    const existing = holder[STORE_GLOBAL_KEY] as GitStatusStore | undefined
    if (
      existing instanceof BrandedGitStatusStore
      || (existing !== undefined && (existing as unknown as Record<string, unknown>)[STORE_BRAND] === true
        && typeof existing.subscribe === 'function')
    ) {
      return existing
    }
    const created = storeInstance ?? new BrandedGitStatusStore()
    storeInstance = created
    holder[STORE_GLOBAL_KEY] = created
    return created
  }
  if (!storeInstance) storeInstance = new BrandedGitStatusStore()
  return storeInstance
}

/** React hook：订阅某个 cwd 的 Git 状态快照（enabled=false 时不启动轮询）。 */
export function useGitStatusSnapshot(cwd: string | undefined, enabled: boolean): GitStatusSnapshot {
  const store = getGitStatusStore()
  const key = cwd ?? ''
  const subscribe = useCallback(
    (listener: () => void): (() => void) => (enabled ? store.subscribe(key, listener) : () => {}),
    [enabled, key, store],
  )
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot(key),
    () => store.getSnapshot(key),
  )
}

/** 主动刷新（提交成功 / 打开 Git 大盘后调用）。 */
export function refreshGitStatus(cwd: string | undefined, force = true): Promise<number> {
  return getGitStatusStore().refresh(cwd ?? '', force)
}
