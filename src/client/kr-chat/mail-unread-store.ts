/**
 * dsh-chat-plus — 邮箱未读条数状态存储与自动轮询（client 半身）。
 *
 * ## 为什么需要单独的 store
 *
 * 1. 邮箱未读数是操作面板卡头（SeekerHead）上邮箱按钮右上角的一枚角标徽章，
 *    用户需要自动看到未读邮件条数；
 * 2. 腾讯 Agent Mail 有严格的 API 频率预算（每分钟最多 10 次，每小时最多 200 次）。
 *    如果多个组件各自发起轮询，会轻易打爆频率限制导致封禁/限流；
 * 3. 跨 bundle 单例：遵从 DSH live reload 机制，挂 window 槽位并使用品牌字段判别，
 *    避免热重载后存在两套定时器和状态分叉。
 *
 * @module
 */

import { getMailDrawerStore } from './mail-drawer-store.ts'
import { featureEnabledNow } from '../features/gate.tsx'

export interface MailUnreadSnapshot {
  /** 未读条数。 */
  readonly count: number
  /** 是否超过单页限制（即 50+）。 */
  readonly hasMore: boolean
  /** 当前是否正在拉取。 */
  readonly loading: boolean
  /** 上次成功拉取的时间戳（毫秒）。 */
  readonly lastChecked: number
}

type Listener = () => void

const STORE_GLOBAL_KEY = '__dshChatPlusMailUnread__'
const STORE_BRAND = '__dshMailUnreadStoreBrand__'

/** 自动轮询安全间隔：45 秒（1.33 次/分钟，80 次/小时，远低于 10/分 和 200/小时 的预算）。 */
const AUTO_POLL_INTERVAL_MS = 45_000

/** 最小冷却时间：20 秒内不重复发静默请求。 */
const MIN_COOLDOWN_MS = 20_000

class MailUnreadStore {
  readonly [STORE_BRAND] = true as const

  private _count = 0
  private _hasMore = false
  private _loading = false
  /** 上次**成功**拿到未读数的时刻（快照里给 UI 用）。 */
  private _lastChecked = 0
  /**
   * 上次**发起请求**的时刻（只用于冷却判断）。
   *
   * 为什么不复用 _lastChecked：失败（未授权 / 网络抖动 / CLI 超时）时 _lastChecked
   * 不更新，冷却就永远判不过期 —— focus / visibilitychange / 45s 轮询三路会把
   * 失败请求打成连续重试，而 Agent Mail 有每分钟 10 次的硬限额，打爆了整块邮箱
   * 都不可用。失败也冷却，宁可晚 20 秒再试。
   */
  private _lastAttempt = 0
  private _activePromise: Promise<number> | null = null

  /**
   * 快照缓存 —— **这个字段是必需的，删掉会让整棵右栏崩掉**。
   *
   * useSyncExternalStore 的契约是：只要底层状态没变，getSnapshot() 必须返回
   * **同一个引用**。原先 getSnapshot() 每次现造一个对象，React 每次比较都判定
   * 「变了」→ 重渲染 → 再取快照 → 又判定变了 …… 直接把右栏大盘渲染成
   * 「Maximum update depth exceeded」（React error #185），表现是整块右栏
   * 不出现、控制台只有一条压缩过的 React 报错（2026-10-28 实测踩到）。
   *
   * 所以状态只在 mutate 时重建一次快照对象，getSnapshot() 只读引用。
   */
  private _snapshot: MailUnreadSnapshot = { count: 0, hasMore: false, loading: false, lastChecked: 0 }

  private readonly _listeners = new Set<Listener>()
  private _pollTimer: number | null = null
  private _drawerUnsub: (() => void) | null = null
  private _started = false

  get count(): number {
    return this._count
  }

  get hasMore(): boolean {
    return this._hasMore
  }

  get loading(): boolean {
    return this._loading
  }

  get lastChecked(): number {
    return this._lastChecked
  }

  /** 当前快照（**引用稳定**：状态不变时永远是同一个对象，见 _snapshot 的注释）。 */
  getSnapshot(): MailUnreadSnapshot {
    return this._snapshot
  }

  /**
   * 重建快照对象 —— 所有状态变更都必须经它，否则 React 拿不到新值。
   *
   * @returns 本次是否真的产生了新快照（false = 值没变，不必通知订阅者）。
   */
  private refreshSnapshot(): boolean {
    const next: MailUnreadSnapshot = {
      count: this._count,
      hasMore: this._hasMore,
      loading: this._loading,
      lastChecked: this._lastChecked,
    }
    const prev = this._snapshot
    if (prev.count === next.count && prev.hasMore === next.hasMore
      && prev.loading === next.loading && prev.lastChecked === next.lastChecked) {
      return false
    }
    this._snapshot = next
    return true
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    this.ensureAutoPoll()
    return () => {
      this._listeners.delete(listener)
    }
  }

  /**
   * 查询未读邮件数。
   *
   * @param force - 是否跳过冷却时间强制刷新（如用户刚关闭抽屉或点刷新）。
   */
  async checkUnread(force = false): Promise<number> {
    /*
     * view.mail 关闭：任何调用都不真的发请求（SeekerHead 已不再订阅，但
     * mail-drawer / 面板等其它入口仍可能调到这里；这是最后一道闸）。
     * 返回上一次缓存值，调用方拿到的形状不变。
     */
    if (!featureEnabledNow('view.mail')) return this._count
    const now = Date.now()
    if (!force && now - this._lastAttempt < MIN_COOLDOWN_MS) {
      return this._count
    }
    if (this._activePromise !== null) {
      return this._activePromise
    }

    this._lastAttempt = now
    this._loading = true
    // 只有值真变了才通知：loading 从 false→true 是一次变化，但重复调用不能刷屏。
    if (this.refreshSnapshot()) this.notify()

    this._activePromise = (async () => {
      try {
        // 请求 host 半身同源只读端点
        const res = await fetch('/api/dsh-mail/list?dir=inbox&isUnread=1&limit=50', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!res.ok) {
          return this._count
        }
        const data = await res.json() as {
          ok?: boolean
          messages?: unknown[]
          hasMore?: boolean
        }
        if (data.ok === true && Array.isArray(data.messages)) {
          this._count = data.messages.length
          this._hasMore = data.hasMore === true
          this._lastChecked = Date.now()
        }
      } catch (err) {
        // 优雅降级：网络抖动或未授权时不干扰主流程
        console.warn('[mail-unread-store] checkUnread failed', err)
      } finally {
        this._loading = false
        this._activePromise = null
        if (this.refreshSnapshot()) this.notify()
      }
      return this._count
    })()

    return this._activePromise
  }

  /** 手动扣减未读数（如用户在面板中阅读了一封邮件）。 */
  decrement(amount = 1): void {
    const next = Math.max(0, this._count - amount)
    if (next !== this._count) {
      this._count = next
      if (this.refreshSnapshot()) this.notify()
    }
  }

  /** 外部覆盖更新未读数。 */
  setUnread(count: number, hasMore = false): void {
    const safeCount = Math.max(0, count)
    if (this._count !== safeCount || this._hasMore !== hasMore) {
      this._count = safeCount
      this._hasMore = hasMore
      this._lastChecked = Date.now()
      if (this.refreshSnapshot()) this.notify()
    }
  }

  /** 启动自动轮询与可见性/抽屉联动监听。 */
  private ensureAutoPoll(): void {
    if (typeof window === 'undefined') return
    /*
     * view.mail 关闭：连定时器和 visibility / focus 监听都不建。
     *
     * ⚠ 必须在 `_started = true` **之前**返回：先置位再返回会让这个 store 在
     * 用户后来把开关打开时永远拒绝再启动（_started 已经是 true，ensureAutoPoll
     * 每次进来都直接 return）——那是一个「关一次就再也收不到未读」的死状态。
     */
    if (!featureEnabledNow('view.mail')) return
    if (this._started) return
    this._started = true

    // 首次立即静默检查一次
    void this.checkUnread(false)

    // 定时轮询
    this._pollTimer = window.setInterval(() => {
      // view.mail 关闭后不再发请求（用户可能是在本次会话里中途把按钮关掉的，
      // 此刻定时器已经存在；保留空转比强行重建整套监听简单，且一次网络都不打）。
      if (!featureEnabledNow('view.mail')) return
      // 页面处于后台隐藏时暂缓请求，切回前台时再拉取
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void this.checkUnread(false)
    }, AUTO_POLL_INTERVAL_MS)

    // 页面切回前台监听
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!featureEnabledNow('view.mail')) return
        if (document.visibilityState === 'visible') {
          void this.checkUnread(false)
        }
      })
    }

    // 窗口重新获取焦点监听
    window.addEventListener('focus', () => {
      if (!featureEnabledNow('view.mail')) return
      void this.checkUnread(false)
    })

    // 抽屉联动：当抽屉关闭时（可能读完或处置了邮件），刷新一次
    try {
      const drawerStore = getMailDrawerStore()
      let prevOpen = drawerStore.open
      this._drawerUnsub = drawerStore.subscribe(() => {
        const curOpen = drawerStore.open
        if (prevOpen && !curOpen) {
          // 由开转关，强制静默刷新
          void this.checkUnread(true)
        }
        prevOpen = curOpen
      })
    } catch {
      // 容错
    }
  }

  private notify(): void {
    for (const listener of this._listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[mail-unread-store] listener error', error)
      }
    }
  }
}

class BrandedMailUnreadStore extends MailUnreadStore {}

let unreadStoreInstance: MailUnreadStore | null = null

/** 取共享 store（跨 bundle 实例唯一）。 */
export function getMailUnreadStore(): MailUnreadStore {
  if (typeof window !== 'undefined') {
    const holder = window as unknown as Record<string, unknown>
    const existing = holder[STORE_GLOBAL_KEY] as MailUnreadStore | undefined
    if (
      existing instanceof BrandedMailUnreadStore
      || (existing !== undefined && (existing as unknown as Record<string, unknown>)[STORE_BRAND] === true
        && typeof existing.subscribe === 'function')
    ) {
      return existing
    }
    const created = unreadStoreInstance ?? new BrandedMailUnreadStore()
    unreadStoreInstance = created
    holder[STORE_GLOBAL_KEY] = created
    return created
  }
  if (!unreadStoreInstance) unreadStoreInstance = new BrandedMailUnreadStore()
  return unreadStoreInstance
}
