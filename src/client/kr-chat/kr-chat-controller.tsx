/**
 * dsh-chat-plus — KR 对话系统控制器（kr-chat-controller）。
 *
 * 核心职能：
 * 1. 顶栏标签：在 header [role="tablist"] 注入 [ KR对话 ]，与官方 [ 对话 ] [ 轨迹 ] 齐平；
 * 2. 默认进入 KR 分类：开箱即为 KR 对话，保持官方底层 chat 视图，确保多轮历史与输入框完整；
 * 3. 双栏大盘：在 [data-conversation-content] 渲染右侧大盘 KrAgentPanel，
 *    **在 KR 对话里常态常驻**（原先靠标签行最右端一枚「Agent 轨迹大盘」开关
 *    收起/展开，该开关与 panelOpen 状态已按用户要求整块删除）；
 * 4. 视图联动：点击 [ 对话 ] 切回标准单栏；点击 [ 轨迹 ] 切到原生轨迹；点击 [ KR对话 ] 恢复双栏大盘。
 * 5. 空白新会话不占位：新对话刚打开、首条消息还没发出去时右栏整体不渲染
 *    （判据 hasConversationContent()，不看会话 id —— 空白 Hero 态也会登记 id）。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getKrChatStore } from './kr-chat-store.ts'
import { KR_TABBAR_DOCKED } from './enabled.ts'
import { KrAgentPanel } from './KrAgentPanel.tsx'
import { activityStore } from '../tool-summary/activity-drawer.tsx'
import { latestChatSnapshot, latestChatSessionId, clearLatestChatSnapshot, subscribeLatestChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'

let isSwitchingToKr = false

/**
 * 当前会话的最新轮次号。
 *
 * 空白新会话没有任何 navigation 条目，此时返回 1（面板随即走空态），
 * 绝不能沿用上一会话遗留的轮次号。数据源优先取实时快照，其次 DOM。
 */
function resolveLatestTurn(): number {
  const snap = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
  const snapTurns = snap?.navigation?.current?.map((n: any) => n.turn).filter((n: any) => typeof n === 'number' && n > 0) || []
  if (snapTurns.length > 0) return Math.max(...snapTurns)
  const domTurns = typeof document !== 'undefined'
    ? Array.from(document.querySelectorAll('[data-chat-turn]'))
      .map(el => parseInt(el.getAttribute('data-chat-turn') || '0', 10))
      .filter(n => Number.isFinite(n) && n > 0)
    : []
  return domTurns.length > 0 ? Math.max(...domTurns) : 1
}

/**
 * 回合是否仍在执行。以 snapshot.timeline 的 start/end 为事实源，避免活动卡
 * 正在播放 1.18s 退场动画时，DOM 仍有节点就把右侧大盘误判为 running。
 * 只有旧 host 读不到 timeline 时才回退到「active 卡 / assistant running」DOM。
 */
function isCurrentTurnRunning(turn: number): boolean {
  const snap = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
  try {
    const turns = snap?.timeline?.turns
    const timing = turns?.get ? turns.get(turn) : turns?.[turn]
    if (typeof timing?.start?.time === 'number') {
      return typeof timing.end?.time !== 'number'
    }
  } catch { /* 旧 snapshot 形状回退 DOM */ }
  if (typeof document === 'undefined') return false
  return Boolean(
    document.querySelector('.kr-agent-mini-shell[data-active="true"] .kr-agent-mini-card')
    || document.querySelector('[data-turn-process] [data-running="true"]')
    || document.querySelector('.dtt__assistant[data-running="true"]'),
  )
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
  if (document.querySelector('[data-conversation-tabs]')) return true
  return document.querySelectorAll('[data-conversation-scroll] [data-chat-turn]').length > 0
}

function setAttrIfDiff(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value)
  }
}

/** 同上，但支持 undefined = **移除**该属性（显示/隐藏切换要用，不能留空串）。 */
function setAttrOrRemove(el: Element, name: string, value: string | undefined): void {
  if (value === undefined) {
    if (el.hasAttribute(name)) el.removeAttribute(name)
  } else {
    setAttrIfDiff(el, name, value)
  }
}

function setClassIfDiff(el: Element, className: string): void {
  if (el.className !== className) {
    el.className = className
  }
}

/** 同步顶部 Tab 按钮（纯 DOM 级稳定注入，与官方原生按钮像素级对齐） */
function syncKrTab(tablist: HTMLElement): void {
  const store = getKrChatStore()
  const isKr = store.snapshot.activeTab === 'kr'
  let btn = document.getElementById('kr-chat-tab-btn') as HTMLButtonElement | null

  /*
   * 与官方原生按钮**像素级同源**：基础类与激活类都从旁边那枚官方按钮身上抄，
   * 连 hash 前缀都不用写死（官方换构建 hash 也不会失配）。
   *
   * 关键点：这里**不再附加任何自造类**（原先的 kr-tab-btn / kr-tab-btn--active 已删）。
   * 早先为了让 KR 标签有自己的配色与下划线，插件另起了一套 CSS，结果三枚标签的
   * 切换视觉和官方的对不上 —— 用户要求"跟官方的切换样式同步"，所以现在完全交回官方：
   * 字号、行高、内距、下划线位置与颜色、激活态，全部由官方那两个类决定。
   */
  const chatBtn = Array.from(tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find((b) => b.id !== 'kr-chat-tab-btn')
  const siblingClass = chatBtn?.className || ''
  const baseClass = siblingClass.split(' ').find((c) => c.includes('tab') && !c.includes('Active')) || 'wSkVaW_tab'
  const activeClass = siblingClass.split(' ').find((c) => c.includes('tab') && c.includes('Active')) || 'wSkVaW_tabActive'

  if (!btn || !btn.isConnected || btn.parentElement !== tablist) {
    if (btn) {
      try { btn.remove() } catch {}
    }
    btn = document.createElement('button')
    btn.type = 'button'
    btn.role = 'tab'
    btn.id = 'kr-chat-tab-btn'
    btn.textContent = 'KR对话'
    btn.onclick = (e) => {
      e.stopPropagation()
      isSwitchingToKr = true
      try {
        store.setActiveTab('kr')
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
    }
    tablist.insertBefore(btn, tablist.firstChild)
  }

  // 激活态就是官方那枚激活类的原样用法，三枚标签的切换表现因此完全一致。
  const expectedBtnClass = isKr ? `${baseClass} ${activeClass}` : baseClass
  setClassIfDiff(btn, expectedBtnClass)
  setAttrIfDiff(btn, 'aria-selected', isKr ? 'true' : 'false')

  // 原生的「对话」「轨迹」两枚**完全交给官方的 React 管**：它们自己的 classList
  // 与 aria-selected 反映的就是当前视图，插件一个字都不改。

  // 标签行最右侧原有一枚「Agent 轨迹大盘」开合开关（#kr-panel-toggle-btn），
  // 已按用户要求整块删除：大盘改为**在 KR 对话里常态化常驻**，标签行只剩三个
  // 官方/KR 标签，一个常驻面板不需要再挂一个"要不要它"的开关——那枚按钮反而
  // 让人以为右栏是可选的。收起/展开相关代码（syncKrPanelToggle、KR_PANEL_ICON、
  // store.panelOpen 与 .kr-panel-toggle 样式）一并删干净。

  // 把整条标签栏挪到右端（见 syncTabBarDock）。
  syncTabBarDock(tablist)
}

/**
 * 标签栏与锚点按钮（右上角「打开文件夹」）之间留的间距（px）。
 *
 * 官方那排按钮彼此贴得很紧，标签栏直接顶上去会读成同一枚按钮的一部分，
 * 给一段明确间距才看得出这里是两个不同的东西。
 */
const DOCK_ANCHOR_GAP = 8
/** 判定两枚按钮「同一行」的垂直容差（px）。 */
const DOCK_ROW_TOLERANCE = 8
/** 相邻按钮水平间距小于这个值，才算同一组（px）。 */
const DOCK_CLUSTER_GAP = 80
/** 只在视口顶部这么高的范围内找锚点（px）。 */
const DOCK_SEARCH_TOP = 160
/** 视口左侧这一比例以内的按钮不参与（避开左侧边栏里的新建/会话条目）。 */
const DOCK_SEARCH_MIN_X = 0.35

/**
 * 在视口右上角找出「打开文件夹 | … | 侧边栏开关」那一组按钮，返回其中**最靠左**的
 * 那枚（打开文件夹）。
 *
 * **刻意走几何而不是 DOM 关系**。这三枚按钮挂在哪个插槽、属于会话 header 还是全局
 * 顶栏，官方代码里有多处候选（headerActions / headerUtilities / headerCorner，
 * 分属不同的包），靠选择器猜会反复落到空的那一处 —— 上一版就是因此把标签定位到了
 * 页面顶端。而"它们在视口顶部右侧、彼此紧挨、水平排成一行"这件事是稳定的，用几何
 * 找一次到位，也不受会话状态（空会话 / 有历史）切换影响。
 *
 * 判据：视口顶部 DOCK_SEARCH_TOP 像素内、水平位置在右侧 65% 的可见按钮，按 left
 * 排序后切成「同一行且间距 < DOCK_CLUSTER_GAP」的簇，取枚数最多的那一簇的首枚。
 * 至少要有两枚（孤立的单按钮不算，否则会误锁到别的控件上）。
 */
function findDockAnchor(): DOMRect | null {
  if (typeof window === 'undefined') return null
  const vw = window.innerWidth
  const limit = Math.min(DOCK_SEARCH_TOP, window.innerHeight * 0.25)
  const items: DOMRect[] = []
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
    // 标签栏自己那三枚不算锚点，否则第一次（还没定位）会把自己锁成锚点。
    if (el.closest('[role="tablist"]')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    if (r.top < 0 || r.top > limit) continue
    if (r.left < vw * DOCK_SEARCH_MIN_X) continue
    items.push(r)
  }
  items.sort((a, b) => a.left - b.left)

  let best: DOMRect[] = []
  let cur: DOMRect[] = []
  for (const r of items) {
    const last = cur[cur.length - 1]
    if (last && Math.abs(last.top - r.top) <= DOCK_ROW_TOLERANCE && r.left - last.right <= DOCK_CLUSTER_GAP) {
      cur.push(r)
    } else {
      if (cur.length > best.length) best = cur
      cur = [r]
    }
  }
  if (cur.length > best.length) best = cur
  return best.length >= 2 ? best[0] : null
}

/**
 * 记录我们对官方元素写过的 inline style，关掉 KR_TABBAR_DOCKED 时原样还原。
 *
 * 只存「第一次写之前」的原值：重复调用 syncTabBarDock 不会把备份覆盖成我们自己
 * 写的值（否则还原就等于还原成停靠态，白还原一次）。
 */
const dockStyleBackup = new WeakMap<HTMLElement, Record<string, string>>()
let dockHeader: HTMLElement | null = null
let dockTablist: HTMLElement | null = null
let dockTablistClass = ''

function setDockStyle(el: HTMLElement, prop: string, value: string): void {
  let backup = dockStyleBackup.get(el)
  if (!backup) {
    backup = {}
    dockStyleBackup.set(el, backup)
  }
  if (!(prop in backup)) backup[prop] = el.style.getPropertyValue(prop)
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value)
}

function restoreDockStyle(el: HTMLElement | null): void {
  if (!el) return
  const backup = dockStyleBackup.get(el)
  if (!backup) return
  for (const [prop, value] of Object.entries(backup)) {
    if (value) el.style.setProperty(prop, value)
    else el.style.removeProperty(prop)
  }
  dockStyleBackup.delete(el)
}

/**
 * 把 [role="tablist"]（`KR对话 / 对话 / 轨迹`）挪到右上角、**「打开文件夹」按钮的左侧**。
 *
 * **不搬 DOM**：那三枚按钮由官方 React 虚拟 DOM 拥有，物理移动它们的父容器，官方
 * 下次重渲染就会搬回原位（甚至在原位留个空洞）。
 *
 * **走 fixed + 视口坐标**。前面试过 absolute 挂在 header 上，结果标签跑到了页面
 * 顶端：官方顶栏与会话 header 的层级关系和选择器猜的并不一致，包含块落到了更外层。
 * fixed 的包含块永远是视口，坐标直接取自锚点按钮的 getBoundingClientRect()，任何
 * 祖先的定位上下文都影响不到它。
 *
 * **锚点也走几何而不是选择器**（见 findDockAnchor）：右上角「打开文件夹 | … |
 * 侧边栏开关」那一行按钮稳定地待在视口顶部右侧、彼此紧挨，成组找出来取最左那枚
 * 即可 —— 不必赌它们挂在哪个插槽里。
 */
function syncTabBarDock(tablist: HTMLElement): void {
  // 早期定位 dock 时挂的诊断探针 #kr-dock-probe（黑底绿字、报 tablist 祖先链与
  // display/margin 的那块）已经下线：它只服务于"tablist 外面套了几层"那一次排查。
  // 删代码不等于节点消失——它是 createElement 挂到 body 上的，不显式清扫就会一直
  // 钉在视口左上角。所以放在函数最前面无条件清一次，与 KR_TABBAR_DOCKED 无关。
  document.getElementById('kr-dock-probe')?.remove()

  if (!KR_TABBAR_DOCKED) {
    if (dockTablistClass === '') dockTablistClass = tablist.className
    setClassIfDiff(tablist, dockTablistClass)
    setAttrOrRemove(tablist, 'data-kr-dock', undefined)
    restoreDockStyle(tablist)
    restoreDockStyle(dockHeader)
    dockHeader = null
    dockTablist = null
    for (const id of ['kr-tab-line', 'kr-tab-reveal']) {
      document.getElementById(id)?.remove()
    }
    return
  }

  // 官方整体重挂载（换会话、换窗口）时，先把上一个 header / tablist 的补丁还回去，
  // 否则旧节点上的 inline style 会一直留着。
  if (dockHeader && dockHeader !== tablist.parentElement) restoreDockStyle(dockHeader)
  if (dockTablist && dockTablist !== tablist) restoreDockStyle(dockTablist)

  if (dockTablistClass === '') dockTablistClass = tablist.className
  setClassIfDiff(tablist, `${dockTablistClass} kr-tab-docked`)
  setAttrIfDiff(tablist, 'data-kr-dock', 'right')

  const header = tablist.parentElement
  dockTablist = tablist
  dockHeader = header
  // 这一版不再需要 header 当包含块（用 fixed），顺手把上一版可能留下的
  // position:relative 还回去，免得它在别的计算里继续干扰。
  restoreDockStyle(header)

  /*
   * 先脱流、再测量。tablist 还在文档流里时会占一整行，把右侧那排按钮挤开，
   * 量出来的锚点位置是错的。
   */
  setDockStyle(tablist, 'position', 'fixed')
  setDockStyle(tablist, 'display', 'flex')
  setDockStyle(tablist, 'width', 'max-content')
  setDockStyle(tablist, 'margin', '0px')
  setDockStyle(tablist, 'align-items', 'center')
  setDockStyle(tablist, 'flex-wrap', 'nowrap')
  setDockStyle(tablist, 'white-space', 'nowrap')
  setDockStyle(tablist, 'z-index', '30')

  const tabBox = tablist.getBoundingClientRect()
  const anchor = findDockAnchor()

  if (anchor) {
    // 纵向直接对齐按钮组的中心线，横向停在「打开文件夹」左缘外侧一个间距。
    // 两者都取视口坐标（fixed 的包含块就是视口），不再经过任何祖先的定位上下文。
    const top = anchor.top + (anchor.height - tabBox.height) / 2
    const left = Math.max(8, anchor.left - DOCK_ANCHOR_GAP - tabBox.width)
    setDockStyle(tablist, 'top', `${Math.round(top)}px`)
    setDockStyle(tablist, 'left', `${Math.round(left)}px`)
    setDockStyle(tablist, 'right', 'auto')

    /*
     * 标题太长时（会话标题跟着撑开，挤到标签底下）给标题区补一段右内距，
     * 让标题自己截断，而不是让标签压住文字。平时不补 —— 一补，右上角那排按钮
     * 会跟着往左跑，等于我们替用户挪了别人的位置。
     */
    const titleCluster = header?.querySelector<HTMLElement>('[class*="_titleCluster"]')
    const crumbs = header?.querySelector<HTMLElement>('[class*="_titleRow"] nav')
    if (titleCluster && crumbs) {
      const overlap = crumbs.getBoundingClientRect().right + 4 - left
      if (overlap > 0) {
        setDockStyle(titleCluster, 'padding-right', `${Math.round(overlap)}px`)
      } else {
        restoreDockStyle(titleCluster)
      }
    }
  } else {
    // 一枚都没找到（极端窄窗 / 那一行还没渲染）：退回视口右上角，
    // 至少保证标签还在右上区域，不会飘到页面别处。
    setDockStyle(tablist, 'top', '10px')
    setDockStyle(tablist, 'right', '16px')
    setDockStyle(tablist, 'left', 'auto')
  }

  /*
   * 清掉上一版「收起标签栏」留下的两枚按钮（#kr-tab-line 细线 / #kr-tab-reveal 圆点）。
   *
   * 那一版做的是「把整条栏折成一条线 + 挂个圆点展开」，用户看过后改主意要移到右端。
   * 这两枚是当时用 createElement 注入的 —— 代码删掉不等于 DOM 消失，不显式清理就
   * 会一直挂在那里（点一下没反应的死按钮）。所以在这里补一次清扫。
   */
  for (const id of ['kr-tab-line', 'kr-tab-reveal']) {
    document.getElementById(id)?.remove()
  }
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
let panelRoot: Root | null = null
let currentContainer: HTMLElement | null = null
/** 上次已交给 React 根渲染的会话 id，用于会话切换时强制整树刷新。 */
let lastRenderedSessionId: string | null | undefined = undefined
/** 上次的「会话是否有内容」闸门值，翻转时强制重渲染（见 syncDom）。 */
let lastContentGate: boolean | undefined = undefined

export function mountKrChatController(): void {
  if (mounted || typeof document === 'undefined') return
  mounted = true

  const store = getKrChatStore()
  store.setActiveTab('kr')

  // 全局事件委托：监听原生「对话」与「轨迹」按钮的点击事件，同步 activeTab 状态
  document.addEventListener('click', (e: MouseEvent) => {
    if (isSwitchingToKr || !e.isTrusted) return
    const target = (e.target as HTMLElement)?.closest<HTMLButtonElement>('header [role="tablist"] button[role="tab"]')
    if (!target || target.id === 'kr-chat-tab-btn') return

    const text = target.textContent?.trim() || ''
    // 严格全等匹配：避免 text.includes('对话') 误判 'KR对话'
    if (text === '轨迹') {
      store.setActiveTab('trajectory')
    } else if (text === '对话') {
      store.setActiveTab('chat')
    }

    const tablist = document.querySelector<HTMLElement>('header [role="tablist"]')
    if (tablist) syncKrTab(tablist)
  }, true)

  // 监听侧边栏「新会话」点击：立即清掉当前大盘（不等新会话数据到位），
  // 随后再同步 DOM，保证点下的一瞬间右侧就已清空。
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const btn = target.closest('button, div, span, a')
    if (btn && btn.textContent?.trim() === '新会话') {
      try { clearLatestChatSnapshot() } catch {}
      setTimeout(syncDom, 0)
      setTimeout(syncDom, 50)
      setTimeout(syncDom, 200)
    }
  }, true)

  window.addEventListener('popstate', () => {
    setTimeout(syncDom, 50)
  })

  // 监听对话流区域内的点击：点击任意对话内容（用户提问、AI回复、思考卡等），
  // 右侧大盘立即联动切换展示该对话轮次的执行大盘与指标
  document.addEventListener('click', (e: MouseEvent) => {
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

    // 向上查找所属的对话轮次
    const turnEl = target.closest<HTMLElement>('[data-conversation-scroll] [data-chat-turn], [data-conversation-scroll] [data-turn-tail]')
    if (!turnEl) return

    const rawTurn = turnEl.getAttribute('data-chat-turn') || turnEl.getAttribute('data-turn-tail')
    if (!rawTurn) return

    const turn = parseInt(rawTurn, 10)
    if (Number.isFinite(turn) && turn > 0) {
      store.setSelectedTurn(turn)
    }
  }, true)

  const syncDom = () => {
    const tablist = document.querySelector<HTMLElement>('header [role="tablist"]')
    const turns = document.querySelectorAll('[data-chat-turn]')
    // 与 KrPanelSystem 同口径：会话 id 已登记即视为绑定了真实会话
    // （空白新会话没有 tablist、也没有轮次，但会话 id 存在）。
    const hasActiveChat = latestChatSessionId !== null || Boolean(tablist || turns.length > 0)

    // 1. 同步顶部 Tab 按钮
    if (tablist) {
      syncKrTab(tablist)
    }

    const isKr = store.snapshot.activeTab === 'kr' && hasActiveChat

    if (isKr) {
      if (document.body.getAttribute('data-dsh-kr-chat') !== 'true') {
        document.body.setAttribute('data-dsh-kr-chat', 'true')
      }
    } else {
      if (document.body.getAttribute('data-dsh-kr-chat') !== null) {
        document.body.removeAttribute('data-dsh-kr-chat')
      }
    }

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

    // 3. 同步右侧大盘容器
    const content = document.querySelector<HTMLElement>('[data-conversation-content]')
    if (!content) return

    let container = document.getElementById('dsh-kr-panel-container')
    if (!hasActiveChat) {
      if (container && container.style.display !== 'none') {
        container.style.display = 'none'
      }
      return
    }

    // 会话身份变化时，令常驻的 React 根重新读取会话状态。
    // 否则空白新会话期间大盘由上一会话的渲染结果继续挂在屏幕上。
    if (lastRenderedSessionId !== latestChatSessionId) {
      lastRenderedSessionId = latestChatSessionId
      if (panelRoot) {
        panelRoot.render(<KrPanelSystem />)
      }
    }

    // 「空白新会话」闸门翻转（点开新对话 ↔ 发出首条 / 切回有历史的会话）时同样
    // 强制重渲染：状态广播不一定恰好在翻转那一刻到达，这里兜住 250ms 的确定性。
    const contentGate = hasConversationContent()
    if (contentGate !== lastContentGate) {
      lastContentGate = contentGate
      if (panelRoot) {
        panelRoot.render(<KrPanelSystem />)
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

      if (panelRoot) {
        try { panelRoot.unmount() } catch {}
        panelRoot = null
      }
    } else {
      if (container.style.display !== 'contents') {
        container.style.display = 'contents'
      }
    }

    if (!panelRoot && container) {
      panelRoot = createRoot(container)
      panelRoot.render(<KrPanelSystem />)
      currentContainer = container
    }
  }

  syncDom()
  setInterval(syncDom, 250)
}
