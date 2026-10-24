/**
 * dsh-chat-plus — KR 对话系统控制器（kr-chat-controller）。
 *
 * 核心职能：
 * 1. 顶栏标签：在 header [role="tablist"] 注入 [ Seeker ]，与官方 [ 对话 ] [ 轨迹 ] 齐平；
 * 2. 默认进入 KR 分类：开箱即为 KR 对话，保持官方底层 chat 视图，确保多轮历史与输入框完整；
 * 3. 双栏大盘：在 [data-conversation-content] 渲染右侧大盘 KrAgentPanel，
 *    **在 KR 对话里常态常驻**（原先靠标签行最右端一枚「Agent 轨迹大盘」开关
 *    收起/展开，该开关与 panelOpen 状态已按用户要求整块删除）；
 * 4. 视图联动：点击 [ 对话 ] 切回标准单栏；点击 [ 轨迹 ] 切到原生轨迹；点击 [ Seeker ] 恢复双栏大盘。
 * 5. 空白新会话不占位：新对话刚打开、首条消息还没发出去时右栏整体不渲染
 *    （判据 hasConversationContent()，不看会话 id —— 空白 Hero 态也会登记 id）。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getKrChatStore } from './kr-chat-store.ts'
import { getPanelSettingsStore } from './panel-settings-store.ts'
import { getMailDrawerStore } from './mail-drawer-store.ts'
import { mountMailDrawer } from './mail-drawer.tsx'
import { syncSeekerHeroHead } from './SeekerHeroHead.tsx'
import { isCurrentTurnRunning, resolveLatestTurn } from './turn-state.ts'
import { KrAgentPanel } from './KrAgentPanel.tsx'
import { activityStore } from '../tool-summary/activity-drawer.tsx'
import { getCurrentChatSnapshot, latestChatSessionId, leaveCurrentChatSession, subscribeLatestChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'

let isSwitchingToKr = false

/**
 * 当前控制器实例令牌。
 *
 * DSH 的 profile 默认 `patchReload: "live"`：插件重建后页面会再加载一份新的
 * client bundle，而**旧 bundle 的模块级状态与 setInterval 不会被回收**——旧实例
 * 仍在跑它的 250ms syncDom。两份实例对 `data-dsh-kr-chat` 各写各的（store 未共享
 * 时一个 set、一个 remove），左栏就在双栏/单栏之间每 250ms 对撞一次。
 *
 * 令牌用于「归属权纠正」：DOM 上的按钮与处理器只认最新实例。
 */
const CONTROLLER_GLOBAL_KEY = '__dshChatPlusKrController__'
/**
 * Seeker 按钮点击的唯一分派口（存在 window 上，跨 bundle 实例共享）。
 *
 * 按钮是 DOM 节点，可能由**上一份 bundle** 创建并绑着它的闭包。那个闭包读的是
 * 旧实例的模块级变量；即使 store 已共享，闭包里的其它状态（面板根、上次会话 id）
 * 仍是旧的。所以按钮 onlick 一律只调这个分派器，而分派器由**当前生效实例**
 * 在每次 syncKrTab 时刷新 —— 点谁都走最新逻辑。
 */
const TAB_CLICK_GLOBAL_KEY = '__dshChatPlusKrTabClick__'

interface KrControllerHandle {
  /** 全局递增的实例号（存在 window 上，跨 bundle 实例唯一）。 */
  token: number
  /** 本实例的 DOM 同步函数；旧实例可经它转发，避免持有过期闭包。 */
  syncDom: () => void
  dispose: () => void
}

/**
 * 会话是否已经「有内容」——即不是刚点开、首条消息还没发出去的空白新会话。
 *
 * 只认官方稳定钩子，不看会话 id：
 *  1. [data-conversation-tabs]：官方 header 在 blank 态 hideChrome=true，
 *     tablist 整块不渲染（session.blank && conversationPhase === 'blank'），
 *     因此它存在 ⟺ 会话已经开张；
 *  2. [data-conversation-scroll] [data-chat-turn]：对话流里已有轮次（切回历史会话）。
 *
 * 不能拿「会话 id 已登记」当判据：input.dock 座位（KrTodoBridge）在新建会话的
 * 空白 Hero 态照常渲染，id 会立刻登记上来，于是「新对话刚打开、一个字都还没发」
 * 也会长出右侧大盘 —— 这正是本次要修掉的误显示。
 */
function hasConversationContent(): boolean {
  if (typeof document === 'undefined') return false
  const snap = getCurrentChatSnapshot()
  if (snap?.navigation?.current && snap.navigation.current.length > 0) return true
  if (snap?.order && snap.order.length > 0) return true
  if (document.querySelector('header:not(.wb-header) [role="tablist"]')) return true
  if (document.querySelector('header:not(.wb-header) nav')) return true
  if (document.querySelectorAll('[data-conversation-scroll] [data-chat-turn]').length > 0) return true
  if (document.querySelectorAll('[data-chat-turn]').length > 0) return true
  return false
}

function setAttrIfDiff(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value)
  }
}

function setClassIfDiff(el: Element, className: string): void {
  if (el.className !== className) {
    el.className = className
  }
}

/** 同步顶部 Tab 按钮（纯 DOM 级稳定注入，与官方原生按钮像素级对齐） */
function syncKrTab(tablist: HTMLElement): void {
  // 防御：绝不注入到工作台内部 Tab 栏
  if (tablist.closest('.wb-header') || tablist.closest('.wb-root') || tablist.getAttribute('data-workbench-nav') === 'true') {
    return
  }
  const store = getKrChatStore()
  const isKr = store.snapshot.activeTab === 'kr'
  let btn = document.getElementById('kr-chat-tab-btn') as HTMLButtonElement | null
  // 与官方原生按钮像素级对齐
  const chatBtn = Array.from(tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find((b) => b.id !== 'kr-chat-tab-btn')
  const siblingClass = chatBtn?.className || ''
  const baseClass = siblingClass.split(' ').find((c) => c.includes('tab') && !c.includes('Active')) || 'wSkVaW_tab'
  const activeClass = 'wSkVaW_tabActive'

  if (!btn || !btn.isConnected || btn.parentElement !== tablist) {
    if (btn) {
      try { btn.remove() } catch {}
    }
    btn = document.createElement('button')
    btn.type = 'button'
    btn.role = 'tab'
    btn.id = 'kr-chat-tab-btn'
    btn.textContent = 'Seeker'
    btn.onclick = (e) => {
      e.stopPropagation()
      /*
       * 一律走 window 上那个「当前生效实例」的分派器。
       *
       * 按钮是 DOM 节点：live reload 之后它可能仍是**上一份 bundle** 创建的，
       * 绑着的 onclick 属于旧实例闭包（旧的面板根、旧的上次会话 id）。旧实例
       * 已被接管，让它继续处理点击就会写回旧状态 —— 这正是「切回 Seeker 一直
       * 跳」的另一半。分派器每 250ms 由生效实例刷新，点谁都执行最新逻辑。
       */
      const dispatch = (window as unknown as Record<string, unknown>)[TAB_CLICK_GLOBAL_KEY]
      if (typeof dispatch === 'function') {
        ;(dispatch as (el: HTMLElement) => void)(tablist)
        return
      }
      // 兜底（分派器尚未登记，例如刚注入的那一帧）：至少把视图切到 Seeker。
      getKrChatStore().setActiveTab('kr')
    }
    tablist.insertBefore(btn, tablist.firstChild)
  }

  if (btn.textContent !== 'Seeker') {
    btn.textContent = 'Seeker'
  }

  const expectedBtnClass = isKr ? `${baseClass} ${activeClass} kr-tab-btn kr-tab-btn--active` : `${baseClass} kr-tab-btn`
  setClassIfDiff(btn, expectedBtnClass)
  setAttrIfDiff(btn, 'aria-selected', isKr ? 'true' : 'false')

  // 当处于 KR 模式时，原生的“对话”与“轨迹”视觉由 CSS (body[data-dsh-kr-chat="true"])
  // 接管，绝不直接去修改原生 chatBtn 的 classList 与 aria-selected，
  // 避免与官方 DSH React 虚拟 DOM 调和发生恶性竞争与闪烁。

  // 标签行最右侧原有一枚「Agent 轨迹大盘」开合开关（#kr-panel-toggle-btn），
  // 已按用户要求整块删除：大盘改为**在 KR 对话里常态化常驻**，标签行只剩三个
  // 官方/KR 标签，一个常驻面板不需要再挂一个"要不要它"的开关——那枚按钮反而
  // 让人以为右栏是可选的。收起/展开相关代码（syncKrPanelToggle、KR_PANEL_ICON、
  // store.panelOpen 与 .kr-panel-toggle 样式）一并删干净。
  /*
   * ── 齿轮与邮箱按钮**已搬到操作面板卡头右上角**（2026-10-25）──────────────
   *
   * 用户原话：「这两个图标都移动到操作面板的右上角去」。它们现在由
   * KrPlainTimelineCard 以 React 直接渲染（见 .kr-plain-head__tools），
   * 开合仍走 panel-settings-store / mail-drawer-store 这两个跨 bundle 共享 store，
   * 所以抽屉那边一行都不用改。
   *
   * 这里保留一句**清理**：热重载或旧 bundle 残留的顶栏按钮必须摘掉，否则页面上
   * 会出现两组一模一样的图标（一组在顶栏、一组在卡头），点哪个都开同一个抽屉，
   * 用户会以为坏了。
   *
   * 为什么不再注入：那套做法的全部复杂度（建节点、每 250ms 同步位置、量几何反推
   * 官方 tablist 的 flex gap）都只是为了把按钮塞进**别人的** DOM。搬到自己的卡头
   * 之后这些成本直接归零。
   */
  removeLegacyHeaderButtons()
}

/**
 * 摘掉旧版注入在**顶栏标签行**里的两枚按钮（幂等，找不到就是没事）。
 *
 * ⚠ 判据必须是「它在不在顶栏里」，不能只看 id —— 新按钮沿用同一对 id
 * （e2e 按 id 找节点），单纯 getElementById 会把**刚渲染好的新按钮**一起删掉，
 * 表现为「卡头右上角什么都没有」。
 *
 * 顶栏的判据用 closest('header [role="tablist"]')：旧按钮是直接插进那个
 * tablist 的，而新按钮在右栏卡头里，永远匹配不上。
 */
function removeLegacyHeaderButtons(): void {
  for (const id of ['kr-panel-settings-btn', 'kr-mail-btn']) {
    try {
      const el = document.getElementById(id)
      if (el === null) continue
      if (el.closest('header [role="tablist"]') === null) continue
      el.remove()
    } catch {
      /* 节点已被别处摘走：无事可做 */
    }
  }
}

/**
 * 顶栏「大盘设置」齿轮：注入到 Seeker 标签**右侧**（用户 2026-10-15 点名要求的位置）。
 *
 * 为什么是裸 DOM 而不是座位：官方标签行是 header 里那段 `[role="tablist"]`，
 * 没有对应的 slots 座位能插进去（座位是给 composer / sidebar / main 那些地方的），
 * 所以与 Seeker 标签同一套做法 —— 直接建节点、按稳定 id 幂等复用。
 *
 * 为什么放在 tab 之后而不是 `tablist.firstChild`：Seeker 是 `firstChild`，
 * 齿轮要跟它并排、落在它右边，且**不能**成为第 4 个视觉上的 tab（它是动作按钮，
 * 不是视图）。所以用 class 而非 role="tab"，并紧跟在 Seeker 之后插入。
 *
 * 点击只做一件事：toggle 共享 store；抽屉在右栏订阅它自行开合。这样按钮与抽屉
 * 各自归属自己的 React/DOM 树，不互相穿透。
 */
function syncPanelSettingsButton(tablist: HTMLElement): void {
  const seeker = document.getElementById('kr-chat-tab-btn')
  if (seeker === null) return
  const settings = getPanelSettingsStore()

  let btn = document.getElementById('kr-panel-settings-btn') as HTMLButtonElement | null

  if (!btn || !btn.isConnected || btn.parentElement !== tablist) {
    if (btn) {
      try { btn.remove() } catch {}
    }
    btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'kr-panel-settings-btn'
    btn.className = 'kr-panel-settings-btn'
    btn.title = '大盘设置'
    btn.setAttribute('aria-label', '大盘设置')
    /*
     * 齿轮图标（2026-10-25 修正形状）。
     *
     * 旧版是「一个圆 + 八根向外的短线」，用户截图反馈「设置的图标不对」——
     * 那画的其实是**太阳/辐条**，不是齿轮：齿轮的特征是**外缘有一圈齿**，
     * 而发散线之间是空的，扫一眼只会读成"亮度/主题"这类图标。
     *
     * 现在用一条闭合 path 画出 8 个齿的外缘（齿与齿之间凹进去），中心再挖一个
     * 圆孔 —— 这是齿轮图标的通用画法，与官方设置图标同一套视觉语言。
     */
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<circle cx="8" cy="8" r="2.2" />'
      + '<path d="M8 1.35l1.1 1.65 1.95-.5.5 1.95L13.2 5.55l-.5 1.95 1.65 1.1-1.65 1.1.5 1.95-1.95.5-.5 1.95-1.95-.5L8 14.65l-1.1-1.65-1.95.5-.5-1.95-1.65-1.1 1.65-1.1-.5-1.95 1.95-.5.5-1.95 1.95.5z" />'
      + '</svg>'
    btn.onclick = (e) => {
      e.stopPropagation()
      // 走共享 store（跨 bundle 实例唯一）——旧实例的闭包读到的也是同一份。
      getPanelSettingsStore().toggle()
    }
  }

  // 紧贴 Seeker 右侧：位置不对就搬过去（会话切换 / 官方重渲染后 tablist 可能重建）。
  if (btn.previousElementSibling !== seeker) {
    seeker.insertAdjacentElement('afterend', btn)
  }

  // 打开态由 store 决定，每次 sync 对齐一次（按钮是裸 DOM，不参与 React 重渲染）。
  const open = settings.open
  setAttrIfDiff(btn, 'data-open', open ? 'true' : 'false')
  setAttrIfDiff(btn, 'aria-expanded', open ? 'true' : 'false')
}

/** KR 对话右侧大盘 React 根组件 */
export function KrPanelSystem() {
  const store = getKrChatStore()
  const krState = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.snapshot,
  )

  const [, setActTick] = useState(0)
  useEffect(() => {
    return activityStore().subscribe(() => setActTick((t) => t + 1))
  }, [])

  const [, setSnapTick] = useState(0)
  useEffect(() => {
    return subscribeLatestChatSnapshot(() => setSnapTick((t) => t + 1))
  }, [])

  // 是否已绑定到真实会话（input.dock 座位在会话内才渲染，会话 id 由它登记）。
  //
  // 注意：id 已登记 ≠ 会话有内容 —— 新建会话的空白 Hero 态同样会登记 id。
  // 「刚点开新对话、首条还没发出去」是否该显示右栏，由下面的
  // hasConversationContent() 单独把关。
  const hasBoundSession = latestChatSessionId !== null
    || (typeof document !== 'undefined' && Boolean(
      document.querySelector('header [role="tablist"]') ||
      document.querySelectorAll('[data-chat-turn]').length > 0
    ))

  // 空白新会话（新对话刚开始、还没发送出去）不显示右侧大盘：
  // 没有内容可看，右栏只会是一块空壳，白占半屏宽。
  if (krState.activeTab !== 'kr' || !hasBoundSession || !hasConversationContent()) {
    return null
  }

  // 最新轮次：空白新会话没有 navigation 条目，按 1 处理（面板会走空态）。
  const latestTurn = Math.max(1, resolveLatestTurn())

  const isRunning = isCurrentTurnRunning(latestTurn)

  // 大盘在 KR 对话里**常态常驻**：不再有收起态，也就没有"展开胶囊"那一支。
  return (
    <KrAgentPanel
      latestTurn={latestTurn}
      isTurnRunning={isRunning}
    />
  )
}

let mounted = false

/**
 * 跨实例共享的面板宿主状态。
 *
 * 为什么放在 window 上而不是模块级：live reload 会让两份 bundle 各有一份模块级
 * 变量。若各自持有 `panelRoot`，两边都会往同一个 `#dsh-kr-panel-container` 上
 * `createRoot` —— React 18 对同一容器重复 createRoot 会直接告警并让两棵树互相
 * 覆盖，观感就是右栏内容反复重建。收敛成一份之后，「谁是当前根」全页面唯一。
 */
const PANEL_HOST_GLOBAL_KEY = '__dshChatPlusKrPanelHost__'

interface KrPanelHost {
  root: Root | null
  container: HTMLElement | null
  /** 上次已交给 React 根渲染的会话 id，用于会话切换时强制整树刷新。 */
  lastRenderedSessionId: string | null | undefined
  /** 上次的「会话是否有内容」闸门值，翻转时强制重渲染（见 syncDom）。 */
  lastContentGate: boolean | undefined
}

function getPanelHost(): KrPanelHost {
  const holder = window as unknown as Record<string, unknown>
  const existing = holder[PANEL_HOST_GLOBAL_KEY] as KrPanelHost | undefined
  if (existing && typeof existing === 'object') return existing
  const created: KrPanelHost = {
    root: null,
    container: null,
    lastRenderedSessionId: undefined,
    lastContentGate: undefined,
  }
  holder[PANEL_HOST_GLOBAL_KEY] = created
  return created
}

export function mountKrChatController(): void {
  if (mounted || typeof document === 'undefined') return
  mounted = true

  /*
   * 接管前任实例：live reload 之后旧 bundle 的 setInterval / 事件监听仍在跑，
   * 不主动拆掉就会有两个 syncDom 同时写 DOM 与 body 属性（用户报的
   * 「切回 Seeker 一直跳」）。旧实例把自己登记的 dispose 放在 window 上，
   * 新实例挂载时先调用它，然后登记自己 —— 全页面任意时刻只有一个控制器在跑。
   */
  const holder = window as unknown as Record<string, unknown>
  const previous = holder[CONTROLLER_GLOBAL_KEY] as KrControllerHandle | undefined
  const token = (typeof previous?.token === 'number' ? previous.token : 0) + 1
  if (previous && typeof previous.dispose === 'function') {
    try { previous.dispose() } catch { /* 旧实例已半死不活，忽略 */ }
  }

  const store = getKrChatStore()
  store.setActiveTab('kr')

  /*
   * 邮箱卡片挂到 body 级容器上（KR 对话控制器生命周期内挂一次，幂等）。
   *
   * 为什么不挂在右栏 .kr-split__side 里（设置抽屉就在那儿）：邮箱卡片是全视口
   * 模态，比右栏宽得多，且右栏在空白会话里整块不渲染 —— 挂进去就会出现「顶栏有
   * 邮箱按钮、点了却什么都没出来」。body 级 fixed 浮层与右栏的布局 / 裁剪 / 滚动
   * 完全解耦（理由详见 mail-drawer.tsx 的文件头注释）。
   */
  try { mountMailDrawer() } catch { /* 卡片挂不出来不影响其余控制器能力 */ }

  /** 本实例是否仍是当前生效的控制器（旧实例经此让位，不再写 DOM）。 */
  const owns = (): boolean => {
    const current = holder[CONTROLLER_GLOBAL_KEY] as KrControllerHandle | undefined
    return current?.token === token
  }

  const disposers: Array<() => void> = []

  /*
   * 齿轮与邮箱按钮的「打开态即时跟随」两段订阅**已删除**（2026-10-25）。
   *
   * 它们服务的对象是顶栏那两枚裸 DOM 按钮 —— 按钮不在 React 树里，只能靠订阅
   * store 手动改 data-open 属性。现在这两枚按钮搬到了操作面板卡头、由 React
   * 直接渲染，开合态走 useSyncExternalStore，React 自己保证同步。
   *
   * 留着这两段只会每 250ms 去 getElementById 一个已经不存在的节点。
   */

  // 全局事件委托：监听原生「对话」与「轨迹」按钮的点击事件，同步 activeTab 状态
  const onTabClick = (e: MouseEvent): void => {
    if (isSwitchingToKr || !e.isTrusted) return
    if (!owns()) return
    const target = (e.target as HTMLElement)?.closest<HTMLButtonElement>('header [role="tablist"] button[role="tab"]')
    if (!target || target.id === 'kr-chat-tab-btn') return

    const text = target.textContent?.trim() || ''
    // 严格全等匹配：避免 text.includes('对话') 误判 'KR对话'
    if (text === '轨迹') {
      store.setActiveTab('trajectory')
    } else if (text === '对话') {
      store.setActiveTab('chat')
    }

    const tablist = document.querySelector<HTMLElement>('header:not(.wb-header) [role="tablist"]')
    if (tablist) syncKrTab(tablist)
  }
  document.addEventListener('click', onTabClick, true)
  disposers.push(() => document.removeEventListener('click', onTabClick, true))

  // 监听侧边栏「新会话」点击：立即清掉当前大盘（不等新会话数据到位），
  // 随后再同步 DOM，保证点下的一瞬间右侧就已清空。
  const onNewSessionClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const btn = target.closest('button, div, span, a')
    if (btn && btn.textContent?.trim() === '新会话') {
      // 走统一离开口：只清快照会漏掉 liveTodos 与 activityStore 的上一会话残留。
      try { leaveCurrentChatSession() } catch {}
      setTimeout(syncDom, 0)
      setTimeout(syncDom, 50)
      setTimeout(syncDom, 200)
    }
  }
  document.addEventListener('click', onNewSessionClick, true)
  disposers.push(() => document.removeEventListener('click', onNewSessionClick, true))

  const onPopState = (): void => { setTimeout(syncDom, 50) }
  window.addEventListener('popstate', onPopState)
  disposers.push(() => window.removeEventListener('popstate', onPopState))

  /*
   * 对话流点击 → 切换右栏大盘轮次。
   *
   * **只有用户自己发的那条消息可以点**（2026-10-05 用户要求）。
   *
   * 原实现是「整个轮次区域都可点」：向上找 [data-chat-turn] 就切轮次，于是
   * 手感上整条对话流都是活的 —— 最直接的代价是**鼠标指针整片变成手掌**
   * （styles.ts 里那条 [data-chat-turn]{cursor:pointer}），用户原话「现在总结
   * 老是出来一个手掌看着烦人」。
   *
   * 现在的判据是**点击目标本身落在用户消息节点里**：官方 flowItem 上带
   * data-chat-flow-kind，用户消息那条的值就是 'user'（见 ui-chat 的
   * ChatView 注入：data-chat-flow-kind = routedNode.kind）。命中就取它的
   * data-chat-turn 切轮次；没命中就**什么都不做**，交回给官方原本的行为
   * （选中文本、点链接、点卡片折叠……一个都不受影响）。
   *
   * 用 closest 而不是判断 e.target 自己：用户消息气泡里还有时间戳、头像等
   * 子元素，点在它们身上同样算「点在提问上」。
   */
  const onFlowClick = (e: MouseEvent): void => {
    if (!owns()) return
    const state = store.snapshot
    if (state.activeTab !== 'kr') return

    const target = e.target as HTMLElement | null
    if (!target) return

    // 如果用户正在选中文本（例如正在进行复制操作），不拦截触发切换
    const sel = window.getSelection()
    if (sel && sel.toString().trim().length > 0) {
      return
    }

    // 忽略右侧大盘内部、顶栏导航、模态弹窗以及可交互控件（按钮、超链接、输入框、下拉菜单等）
    if (target.closest('#dsh-kr-panel-container, header, button, a, input, textarea, select, [role="button"], [role="menuitem"], .tsh-panel, .tsh-mask')) {
      return
    }

    // 只认用户提问那一条：assistant 正文、思考卡、工具行、过程行一律不响应。
    const userEl = target.closest<HTMLElement>('[data-conversation-scroll] [data-chat-flow-kind="user"]')
    if (!userEl) return

    const rawTurn = userEl.getAttribute('data-chat-turn')
    if (!rawTurn) return

    const turn = parseInt(rawTurn, 10)
    if (Number.isFinite(turn) && turn > 0) {
      store.setSelectedTurn(turn)
    }
  }
  document.addEventListener('click', onFlowClick, true)
  disposers.push(() => document.removeEventListener('click', onFlowClick, true))

  const syncDom = () => {
    if (!owns()) return
    const tablist = document.querySelector<HTMLElement>('header:not(.wb-header) [role="tablist"]')
    const turns = document.querySelectorAll('[data-chat-turn]')
    // 与 KrPanelSystem 同口径：会话 id 已登记即视为绑定了真实会话
    // （空白新会话没有 tablist、也没有轮次，但会话 id 存在）。
    const hasActiveChat = latestChatSessionId !== null || Boolean(tablist || turns.length > 0)

    // 1. 同步顶部 Tab 按钮
    if (tablist) {
      syncKrTab(tablist)
    }

    const isKr = store.snapshot.activeTab === 'kr'

    /*
     * body 的 data-dsh-kr-chat **不在这里写**。
     *
     * 这里原来每 250ms 无条件按本地 store 写/删该属性，于是它与 store 内部的
     * syncBodyAttribute 形成两个写入点：一旦 live reload 残留了第二份实例、
     * 两份 store 的 activeTab 分叉（一份 kr、一份 chat），左栏就在双栏与单栏
     * 之间每 250ms 对撞一次 —— 实测 30s 翻转 210 次，就是用户报的
     * 「切回 Seeker 一直跳」。
     *
     * 属性现在**只由 store 在 activeTab 真正变化时写一次**（syncBodyAttribute），
     * 这里不再轮询写。轮询只保留幂等的 DOM 同步（按钮类名、容器 display、
     * 轮次高亮），那些写入值相同、不会互相打架。
     */

    // 若当前脱离了会话（如回到新会话页），重置已选轮次
    if (!hasActiveChat && store.snapshot.selectedTurn !== null) {
      store.setSelectedTurn(null)
    }

    // 2. 同步左侧当前选中的对话轮次高亮视觉
    const selectedTurn = store.snapshot.selectedTurn
    const activeClass = 'kr-turn-selected'
    document.querySelectorAll(`.${activeClass}`).forEach(el => {
      if (!isKr || el.getAttribute('data-chat-turn') !== String(selectedTurn)) {
        el.classList.remove(activeClass)
      }
    })
    if (isKr && selectedTurn !== null && selectedTurn > 0) {
      document.querySelectorAll(`[data-chat-turn="${selectedTurn}"]`).forEach(el => {
        if (!el.classList.contains(activeClass)) {
          el.classList.add(activeClass)
        }
      })
    }

    /*
     * 2.5 新对话页（空白 Hero 态）顶部的 Seeker 卡头（2026-10-25 用户要求：
     *     「新对话页面的上面放上我们这个东西」）。
     *
     * 判据只有两条：**Seeker 视图** + **还没有内容**。
     *
     * 刻意**不看 hasActiveChat**：空白新会话在点开的那一瞬会话 id 可能还没登记
     * （input.dock 座位要等一拍），拿它当条件会让卡头在该出现的窗口里闪一下不出现
     * —— 而 Hero 存在与否本身就是"这是新对话页"最直接的证据（syncSeekerHeroHead
     * 内部找不到 composerStack 就什么都不做）。
     *
     * 「还没有内容」这条是关键：一旦发出第一条消息，右栏大盘自己会出现（那张卡头
     * 就在操作面板卡里），这里必须同时摘掉，否则页面上会同时出现两张一模一样的卡头。
     */
    try {
      /*
       * running 由这里算好传下去（控制器本来就有 250ms 的 syncDom 轮询，
       * 卡头组件不再自己开定时器）。判据与右栏大盘完全同一口径。
       */
      syncSeekerHeroHead(
        isKr && !hasConversationContent(),
        isCurrentTurnRunning(Math.max(1, resolveLatestTurn())),
      )
    } catch (error) {
      console.warn('[kr-chat] hero head sync failed', error)
    }

    // 3. 同步右侧大盘容器
    const content = document.querySelector<HTMLElement>('[data-conversation-content]')
    if (!content) return

    const host = getPanelHost()
    let container = document.getElementById('dsh-kr-panel-container')
    if (!hasActiveChat || store.snapshot.activeTab !== 'kr') {
      if (container && container.style.display !== 'none') {
        container.style.display = 'none'
      }
      return
    }

    // 会话身份变化时，令常驻的 React 根重新读取会话状态。
    // 切换到有效会话时，默认恢复进入 Seeker (KR) 模式
    if (host.lastRenderedSessionId !== latestChatSessionId) {
      host.lastRenderedSessionId = latestChatSessionId
      if (latestChatSessionId !== null && store.snapshot.activeTab !== 'kr') {
        store.setActiveTab('kr')
      }
      if (host.root) {
        host.root.render(<KrPanelSystem />)
      }
    }

    // 「空白新会话」闸门翻转（点开新对话 ↔ 发出首条 / 切回有历史的会话）时同样
    // 强制重渲染：状态广播不一定恰好在翻转那一刻到达，这里兜住 250ms 的确定性。
    const contentGate = hasConversationContent()
    if (contentGate !== host.lastContentGate) {
      host.lastContentGate = contentGate
      if (host.root) {
        host.root.render(<KrPanelSystem />)
      }
    }

    if (!container || !container.isConnected || container.parentElement !== content) {
      if (container) {
        try { container.remove() } catch {}
      }
      container = document.createElement('div')
      container.id = 'dsh-kr-panel-container'
      container.style.display = 'contents'
      content.appendChild(container)

      // 容器换新 → 旧根挂在已脱离文档的节点上，先卸掉再重建，
      // 否则 React 会对同一逻辑树重复挂载（内容闪两份）。
      if (host.root) {
        try { host.root.unmount() } catch {}
        host.root = null
      }
    } else {
      if (container.style.display !== 'contents') {
        container.style.display = 'contents'
      }
    }

    if (!host.root && container) {
      host.root = createRoot(container)
      host.root.render(<KrPanelSystem />)
      host.container = container
    }
  }

  /**
   * Seeker 按钮点击的实现体（由 window 分派器转调，永远是生效实例这一份）。
   *
   * 除了切 store，还要处理「当前停原生『轨迹』视图」这一种情况：轨迹与对话
   * 是官方两个真实视图，Seeker 复用对话视图，所以必须先把官方切回「对话」。
   */
  const handleKrTabClick = (tablist: HTMLElement): void => {
    isSwitchingToKr = true
    try {
      store.setActiveTab('kr')
      const activeClass = 'wSkVaW_tabActive'
      // 仅当当前处于原生“轨迹”视图时，才需要触发原生“对话”按钮切回底层 chat 流
      const trajectoryBtn = Array.from(tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
        .find(b => b.id !== 'kr-chat-tab-btn' && b.textContent?.trim() === '轨迹')
      const isTrajectoryActive = trajectoryBtn?.getAttribute('aria-selected') === 'true'
        || trajectoryBtn?.className.split(' ').includes(activeClass)
      if (isTrajectoryActive) {
        const chatBtn = Array.from(tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
          .find(b => b.id !== 'kr-chat-tab-btn' && b.textContent?.trim() === '对话')
        chatBtn?.click()
      }
    } finally {
      setTimeout(() => { isSwitchingToKr = false }, 150)
    }
    syncKrTab(tablist)
    syncDom()
  }

  holder[TAB_CLICK_GLOBAL_KEY] = handleKrTabClick

  // 登记自身供后续实例接管（live reload 场景）。
  holder[CONTROLLER_GLOBAL_KEY] = {
    token,
    syncDom,
    dispose: () => {
      for (const off of disposers) {
        try { off() } catch { /* 单个解绑失败不影响其余 */ }
      }
      if (intervalId !== 0) window.clearInterval(intervalId)
      // 只让位、不拆 UI：新实例随即接管并自行重绘，拆掉反而闪一下。
    },
  } satisfies KrControllerHandle

  const intervalId = window.setInterval(syncDom, 250)
  syncDom()
}