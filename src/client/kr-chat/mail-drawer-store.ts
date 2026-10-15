/**
 * dsh-chat-plus — Seeker 顶栏「邮箱」按钮与右侧只读邮件抽屉之间的共享开合状态。
 *
 * 为什么需要这层：邮件入口是**顶栏标签行**里一枚裸 DOM 按钮（由
 * kr-chat-controller 每 250ms 幂等同步注入），抽屉本体在**body 级容器**里
 * （KrMailDrawer，由 createRoot 单独挂的一棵树）。两者既不同树也不同根，
 * props 传不过去 —— 于是收敛成一个模块级 store：DOM 按钮负责 toggle，
 * React 抽屉 subscribe 它读 open。与 panel-settings-store.ts 是同一套结构。
 *
 * 为什么不复用设置那个 store（`__dshChatPlusPanelSettings__`）：两个抽屉必须能
 * **各自独立开合** —— 共用一份 open 的结果是「打开邮箱把大盘设置也顶出来」、
 * 「关掉设置顺手把邮箱关了」，两个互不相干的面板被绑成一根跷跷板。
 * 另外两者的开合语义也不同：设置抽屉由大盘内部的组件订阅，邮件抽屉挂在 body 上，
 * 生命周期与重渲染时机都不一致，共用一个 store 只会让两边的订阅互相唤醒。
 *
 * 为什么挂 window 而不是模块级单例：DSH 的 profile 默认 `patchReload: "live"`，
 * 插件重建后页面会再加载一份 client bundle，旧 bundle 的模块级变量不会被回收。
 * 两份 store 各持一份 open，就会出现「点按钮抽屉不开 / 开了关不掉」这类对撞
 * （kr-chat-store 当年正是这么踩的）。按品牌字段判别形状，跨 bundle 共享一份。
 */

type Listener = () => void

/** 跨 bundle 共享槽位。 */
const STORE_GLOBAL_KEY = '__dshChatPlusMailDrawer__'
/** 品牌字段：live reload 后 instanceof 失效，用它认自己放的 store。 */
const STORE_BRAND = '__dshMailDrawerStoreBrand__'

class MailDrawerStore {
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
        console.error('[mail-drawer-store] listener error', error)
      }
    }
  }
}

class BrandedMailDrawerStore extends MailDrawerStore {}

let storeInstance: MailDrawerStore | null = null

/** 取共享 store（跨 bundle 实例唯一）。 */
export function getMailDrawerStore(): MailDrawerStore {
  if (typeof window !== 'undefined') {
    const holder = window as unknown as Record<string, unknown>
    const existing = holder[STORE_GLOBAL_KEY] as MailDrawerStore | undefined
    if (
      existing instanceof BrandedMailDrawerStore
      || (existing !== undefined && (existing as unknown as Record<string, unknown>)[STORE_BRAND] === true
        && typeof existing.subscribe === 'function')
    ) {
      return existing
    }
    const created = storeInstance ?? new BrandedMailDrawerStore()
    storeInstance = created
    holder[STORE_GLOBAL_KEY] = created
    return created
  }
  if (!storeInstance) storeInstance = new BrandedMailDrawerStore()
  return storeInstance
}
