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

  private syncBodyAttribute(tab: KrTabType): void {
    if (typeof document !== 'undefined') {
      const hasActiveChat = Boolean(
        document.querySelector('header [role="tablist"]') ||
        document.querySelectorAll('[data-chat-turn]').length > 0
      )
      if (tab === 'kr' && hasActiveChat) {
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

let storeInstance: KrChatStore | null = null

/** 宽度钳制（模块级函数，构造器里也能用）。 */
export function clampPanelWidth(width: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(width)))
}

export function getKrChatStore(): KrChatStore {
  if (!storeInstance) {
    storeInstance = new KrChatStore()
  }
  return storeInstance
}
