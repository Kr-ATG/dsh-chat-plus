/**
 * dsh-chat-plus — KR 对话状态管理 Store。
 *
 * 管理 KR 对话双栏界面的关键交互状态：
 * 1. 当前选中的查看轮次（selectedTurn: number | null，null 表示跟随最新活跃轮次）；
 * 2. 历史对话联动与最新轮次自动跟随机制；
 * 3. 大盘宽度（拖拽调整 + localStorage 持久化）。
 *
 * **右侧大盘的开合状态已整块删除**（panelOpen / setPanelOpen / togglePanel /
 * localStorage 键 dsh.kr_chat.panel_open）：大盘改为在 KR 对话里常态常驻，
 * 标签行那枚「Agent 轨迹大盘」开关也一并移除 —— 一个常驻面板不需要开关。
 *
 * KR 整体受 KR_CHAT_ENABLED 关闭（只隐藏不删除，见 enabled.ts）：关闭时初始
 * activeTab 直接是 'chat'，于是 isKrMode 全链路为 false —— 不写 data-dsh-kr-chat、
 * 不隐藏左侧工具树、插件「对话」呈现回到 KR 之前的形态。改回 true 即恢复。
 */

import { KR_CHAT_ENABLED } from './enabled.ts'

const STORAGE_KEY_PANEL_WIDTH = 'dsh.kr_chat.panel_width'
/** 旧的开合状态键：功能已删除，顺手清掉，避免 localStorage 里留一条永不读的脏值。 */
const STORAGE_KEY_PANEL_OPEN_LEGACY = 'dsh.kr_chat.panel_open'

/** 大盘宽度取值域（px）。下限保证三张卡可读，上限不能把左栏对话挤没了。 */
export const PANEL_WIDTH_MIN = 360
export const PANEL_WIDTH_MAX = 720
/** 默认宽度与 styles.ts 的 .kr-split__side width 保持一致。 */
export const PANEL_WIDTH_DEFAULT = 440

export type KrTabType = 'kr' | 'chat' | 'trajectory'

export interface KrChatState {
  readonly selectedTurn: number | null
  readonly fullscreen: boolean
  readonly activeTab: KrTabType
  /** 大盘宽度（px，拖拽调整 + localStorage 持久化）。 */
  readonly width: number
}

type Listener = () => void

class KrChatStore {
  private _selectedTurn: number | null = null
  private _fullscreen: boolean = false
  // KR 关闭时初始即 'chat'：没有「KR对话」标签可点，绝不能停在 'kr' 上 ——
  // 那会让 isKrMode 为 true 却又不挂右侧大盘，左侧工具树被 CSS 隐藏后无处可看。
  private _activeTab: KrTabType = KR_CHAT_ENABLED ? 'kr' : 'chat'
  private _width: number = PANEL_WIDTH_DEFAULT
  private _cachedSnapshot: KrChatState | null = null
  private readonly _listeners = new Set<Listener>()

  constructor() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY_PANEL_OPEN_LEGACY)
        const storedWidth = Number(localStorage.getItem(STORAGE_KEY_PANEL_WIDTH))
        if (Number.isFinite(storedWidth) && storedWidth > 0) {
          this._width = clampPanelWidth(storedWidth)
        }
      } catch { /* ignore */ }
    }
    /*
     * 初始化时**以页面上已有的视图事实为准**，而不是直接用字段默认值。
     *
     * live reload 的时序是：新 bundle 求值 → 构造 store → 挂载控制器。此刻页面
     * 上 `data-dsh-kr-chat` 还是**上一份实例**留下的、用户当下真正在看的视图。
     * 若构造器无脑按默认值（KR 开启时是 'kr'）写一遍属性，会把用户停在「对话」
     * 的视图顶回 Seeker —— 反过来也是：用户正停在 Seeker，却被旧实例残留的
     * 属性带偏。
     *
     * 所以先读属性：读到 'true' 就认 Seeker，读到属性缺失就认普通对话；
     * 完全读不到（首帧、无 DOM）才回落到编译期默认值。
     */
    if (typeof document !== 'undefined' && document.body) {
      const existing = document.body.getAttribute('data-dsh-kr-chat')
      if (existing === 'true') {
        // 页面上已是 Seeker 视图：KR 关闭时不能认（没有 Seekr 标签可回），按默认走。
        if (KR_CHAT_ENABLED) this._activeTab = 'kr'
      } else if (existing === null && KR_CHAT_ENABLED) {
        // 属性缺失 = 当前不在 Seeker。但「刚打开页面」也是这个形状，那时应当
        // 进 Seeker —— 用「是否已有 Seeker 按钮」区分「首帧」与「用户切走了」。
        const hasKrButton = document.getElementById('kr-chat-tab-btn') !== null
        this._activeTab = hasKrButton ? 'chat' : 'kr'
      }
    }
    this.updateSnapshot()
    // 初始化同步 body 属性（KR 关闭时按 'chat' 走，绝不写 data-dsh-kr-chat）
    this.syncBodyAttribute(this._activeTab)
  }

  get snapshot(): KrChatState {
    if (!this._cachedSnapshot) {
      this.updateSnapshot()
    }
    return this._cachedSnapshot!
  }

  private updateSnapshot(): void {
    this._cachedSnapshot = {
      selectedTurn: this._selectedTurn,
      fullscreen: this._fullscreen,
      activeTab: this._activeTab,
      width: this._width,
    }
  }

  setActiveTab(tab: KrTabType, force = false): void {
    if (!force && this._activeTab === tab) {
      this.syncBodyAttribute(tab)
      return
    }
    this._activeTab = tab
    this.updateSnapshot()
    this.syncBodyAttribute(tab)
    this.notify()
  }

  /**
   * 把 body 属性对齐到当前 activeTab。
   *
   * 公开出来是因为**属性现在只由这一条路径写**（控制器那边已停止 250ms 轮询写，
   * 见 kr-chat-controller 的说明）。带上「值相同就不动 DOM」的短路：本方法是
   * 幂等的，重复调用不会产生 DOM 抖动。
   */
  syncBodyAttribute(tab: KrTabType = this._activeTab): void {
    if (typeof document !== 'undefined') {
      if (tab === 'kr') {
        if (document.body.getAttribute('data-dsh-kr-chat') !== 'true') {
          document.body.setAttribute('data-dsh-kr-chat', 'true')
        }
      } else {
        if (document.body.getAttribute('data-dsh-kr-chat') !== null) {
          document.body.removeAttribute('data-dsh-kr-chat')
        }
      }
    }
  }

  /** 拖拽中连续调用：只更新内存态（不写 localStorage、节流由调用方控制）。 */
  setPanelWidth(width: number): void {
    const next = clampPanelWidth(width)
    if (this._width === next) return
    this._width = next
    this.updateSnapshot()
    this.notify()
  }

  /** 拖拽结束调用一次：把最终宽度落盘。 */
  commitPanelWidth(): void {
    try {
      localStorage.setItem(STORAGE_KEY_PANEL_WIDTH, String(this._width))
    } catch { /* ignore */ }
  }

  resetPanelWidth(): void {
    this.setPanelWidth(PANEL_WIDTH_DEFAULT)
    this.commitPanelWidth()
  }

  setSelectedTurn(turn: number | null): void {
    if (this._selectedTurn === turn) return
    this._selectedTurn = turn
    this.updateSnapshot()
    this.notify()
  }

  setFullscreen(fs: boolean): void {
    if (this._fullscreen === fs) return
    this._fullscreen = fs
    this.updateSnapshot()
    this.notify()
  }

  toggleFullscreen(): void {
    this.setFullscreen(!this._fullscreen)
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this._listeners) {
      try {
        listener()
      } catch (err) {
        console.error('[kr-chat-store] listener error', err)
      }
    }
  }
}

/**
 * 跨 bundle 实例共享的 store（**不是**普通模块级单例）。
 *
 * ── 为什么必须挂到 window 上 ────────────────────────────────────────────────
 * DSH 的 profile 默认 `patchReload: "live"`：插件重新构建后，页面会**再加载一份
 * 新的 client bundle**，而旧 bundle 的执行上下文（含它的模块级变量、setInterval、
 * 事件监听）并不会被回收 —— 旧实例仍在跑。
 *
 * 模块级单例只对「同一个 bundle 实例内」成立，于是 reload 之后会同时存在两份
 * store：顶部 Seeker 按钮的 onclick 是**旧实例闭包**（写旧 store），而新实例的
 * 控制器读的是新 store。两边对 `data-dsh-kr-chat` 各写各的（一个 set、一个
 * remove），表现为左栏在两个宽度之间每 250ms 来回跳一次 —— 用户报的
 * 「切到对话再切回 Seeker 就一直跳来跳去」正是这一条（点 Seeker 只把旧 store
 * 置成 kr，新 store 仍是 chat，从此永久对撞）。
 *
 * 修法：store 挂在 window 上，并按品牌字段判别（不能 instanceof —— 两份 bundle
 * 的 KrChatStore 是两个不同的类对象）。这样无论 reload 多少次，全页面只有一份
 * 真相，所有实例读写同一个 activeTab。
 */
const STORE_GLOBAL_KEY = '__dshChatPlusKrStore__'
const STORE_BRAND = '__dshKrChatStoreBrand__'

/**
 * 带品牌的 store。
 *
 * 品牌字段**显式声明在类上**（而不是就地打补丁）：live reload 之后判断「共享
 * 槽里那个对象是不是本插件放的 store」需要它，显式声明同时能让 TS 认识这个属性，
 * 不必对实例做 any 转换。
 */
class BrandedKrChatStore extends KrChatStore {
  readonly [STORE_BRAND] = true as const
}

let storeInstance: KrChatStore | null = null

/** 宽度钳制（模块级函数，构造器里也能用）。 */
export function clampPanelWidth(width: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(width)))
}

export function getKrChatStore(): KrChatStore {
  if (typeof window !== 'undefined') {
    const holder = window as unknown as Record<string, unknown>
    const existing = holder[STORE_GLOBAL_KEY] as KrChatStore | undefined
    // 品牌 + 形状双判据：免得读到别人（或旧版本）放在同名键上的异物。
    if (
      existing instanceof BrandedKrChatStore
      // instanceof 只对同一次页面生命周期内的同一份类对象成立；live reload 后
      // 旧实例的类对象是另一个函数，instanceof 会 false —— 那时退回结构判据。
      || (existing !== undefined && (existing as unknown as Record<string, unknown>)[STORE_BRAND] === true
        && typeof existing.subscribe === 'function')
    ) {
      return existing
    }
    const created = storeInstance ?? new BrandedKrChatStore()
    storeInstance = created
    holder[STORE_GLOBAL_KEY] = created
    return created
  }
  if (!storeInstance) {
    storeInstance = new BrandedKrChatStore()
  }
  return storeInstance
}
