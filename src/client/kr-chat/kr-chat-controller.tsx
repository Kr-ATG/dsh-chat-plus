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
  const snap = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
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
      syncDom()
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

    const tablist = document.querySelector<HTMLElement>('header:not(.wb-header) [role="tablist"]')
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

    // 只认用户提问那一条：assistant 正文、思考卡、工具行、过程行一律不响应。
    const userEl = target.closest<HTMLElement>('[data-conversation-scroll] [data-chat-flow-kind="user"]')
    if (!userEl) return

    const rawTurn = userEl.getAttribute('data-chat-turn')
    if (!rawTurn) return

    const turn = parseInt(rawTurn, 10)
    if (Number.isFinite(turn) && turn > 0) {
      store.setSelectedTurn(turn)
    }
  }, true)

  const syncDom = () => {
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
    if (!hasActiveChat || store.snapshot.activeTab !== 'kr') {
      if (container && container.style.display !== 'none') {
        container.style.display = 'none'
      }
      return
    }

    // 会话身份变化时，令常驻的 React 根重新读取会话状态。
    // 切换到有效会话时，默认恢复进入 Seeker (KR) 模式
    if (lastRenderedSessionId !== latestChatSessionId) {
      lastRenderedSessionId = latestChatSessionId
      if (latestChatSessionId !== null && store.snapshot.activeTab !== 'kr') {
        store.setActiveTab('kr')
      }
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
