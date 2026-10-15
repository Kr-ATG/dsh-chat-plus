/**
 * dsh-chat-plus — Seeker 顶栏「大盘设置」按钮与右栏设置抽屉之间的共享开合状态。
 *
 * 为什么需要这层：设置入口在**顶栏标签行**（紧邻 Seeker 标签，由
 * kr-chat-controller 以裸 DOM 注入），抽屉本体在**右栏**（KrPanelSettings，
 * 由 KrPanelSystem 用 createRoot 单独挂的一棵 React 树）。两者既不同树也不同根，
 * props 传不过去 —— 于是收敛成一个模块级 store：DOM 按钮负责 toggle，
 * React 抽屉 subscribe 它读 open。
 *
 * 为什么挂 window 而不是模块级单例：DSH 的 profile 默认 `patchReload: "live"`，
 * 插件重建后页面会再加载一份 client bundle，旧 bundle 的模块级变量不会被回收。
 * 两份 store 各持一份 open，就会出现「点按钮抽屉不开 / 开了关不掉」这类
 * 对撞（kr-chat-store 当年正是这么踩的）。按品牌字段判别形状，跨 bundle 共享一份。
 *
 * 为什么状态不放在 KrPanelSettings 里：那样顶栏按钮就得反向穿透 React 树去调
 * 组件内部的 setState，只能靠全局自定义事件绕 —— 比一个 store 更难维护。
 */

type Listener = () => void

/** 跨 bundle 共享槽位。 */
const STORE_GLOBAL_KEY = '__dshChatPlusPanelSettings__'
/** 品牌字段：live reload 后 instanceof 失效，用它认自己放的 store。 */
const STORE_BRAND = '__dshPanelSettingsStoreBrand__'

class PanelSettingsStore {
  readonly [STORE_BRAND] = true as const

  private _open = false
  private readonly _listeners = new Set<Listener>()

  get open(): boolean {
    return this._open
  }

  setOpen(next: boolean): void {
    if (this._open === next) return
    this._open = next
    this.notify()
  }

  toggle(): void {
    this.setOpen(!this._open)
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this._listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[panel-settings-store] listener error', error)
      }
    }
  }
}

class BrandedPanelSettingsStore extends PanelSettingsStore {}

let storeInstance: PanelSettingsStore | null = null

/** 取共享 store（跨 bundle 实例唯一）。 */
export function getPanelSettingsStore(): PanelSettingsStore {
  if (typeof window !== 'undefined') {
    const holder = window as unknown as Record<string, unknown>
    const existing = holder[STORE_GLOBAL_KEY] as PanelSettingsStore | undefined
    if (
      existing instanceof BrandedPanelSettingsStore
      || (existing !== undefined && (existing as unknown as Record<string, unknown>)[STORE_BRAND] === true
        && typeof existing.subscribe === 'function')
    ) {
      return existing
    }
    const created = storeInstance ?? new BrandedPanelSettingsStore()
    storeInstance = created
    holder[STORE_GLOBAL_KEY] = created
    return created
  }
  if (!storeInstance) storeInstance = new BrandedPanelSettingsStore()
  return storeInstance
}
