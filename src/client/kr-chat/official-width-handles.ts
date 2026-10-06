/**
 * dsh-chat-plus — 修正官方「正文宽度」拖拽手柄在 Seeker 下的位置。
 *
 * ── 问题 ────────────────────────────────────────────────────────────────────
 * 官方对话正文有两条 [data-width-handle="left|right"] 拖拽手柄（ui-conversation 的
 * ConversationRoot），用来调正文最大宽度。它们的定位是**相对包含块居中**：
 *
 *   [side=right]{ left:  calc(50% + var(--dsh-chat-content-width)/2 + 24px) }
 *   [side=left] { right: calc(50% + var(--dsh-chat-content-width)/2 + 24px) }
 *
 * 包含块是父元素 [data-conversation-content]。官方原设计里那个容器只装对话流，
 * 「容器中心」= 「对话流中心」，两条线正好落在正文内容区两侧各 24px 处。
 *
 * Seeker 把同一个容器改成 flex row 并塞进右侧大盘后，容器比对话流宽出整整一个
 * 面板，而手柄仍按「容器中心」定位 —— 整体右移约「面板宽 / 2」。实测（视口 2560、
 * 面板 489）：对话流 287→2069、正文右边界 2022，右柄却在 x=2294，偏了 272px；
 * 左柄则被推到对话流左缘之外。用户原话：「官方的那个拖拽还存在让我觉得非常难受，
 * 因为他不在对应的位置，是因为我们加了一个大盘后导致的」。
 *
 * ── 修法 ────────────────────────────────────────────────────────────────────
 * 不碰 DOM 结构（搬节点会与官方 React 调和打架），只**重写这两个元素的
 * left/right inline style**，按对话流自己的内容区边界重新摆：
 *
 *   内容区左边界 X0 = 对话流左缘 + (对话流宽 - 正文宽) / 2
 *   右柄 left  = X0 + 正文宽 + gap - 容器 padding box 左缘
 *   左柄 right = 容器 padding box 右缘 - (X0 - gap)
 *
 * gap 取官方语义的 24px，但按对话流真实留白钳制（见下），保证手柄不会越出对话流。
 *
 * 官方自身的定位规则一概不改，功能也不停用：两条线照旧可拖、照旧调正文宽度，
 * 只是位置对了。卸载时清掉 inline style，普通「对话」视图立刻回到官方原样。
 *
 * ── 为什么用「观察 + 重算」而不是纯 CSS ──────────────────────────────────────
 * 正确的 left/right 依赖两个量，CSS 都拿不到：
 *   1. 大盘宽度 —— 它是 React 写在 .kr-split__side 上的 inline style；
 *   2. --dsh-chat-content-width —— 官方在对话流上现算的 px 值。
 * 只能读出来再写回去。变化源有三类，各自打点：
 *   · 容器/对话流尺寸变（窗口、官方侧边栏、官方右栏、大盘拖拽）→ ResizeObserver；
 *   · 正文宽度变（用户拖这两条手柄本身）→ 观察官方写变量的那个元素；
 *   · 手柄被 React 重建（inline style 会一起丢）→ MutationObserver 盯容器子节点。
 */
import { useEffect } from 'react'

/** 官方正文内容区边界到拖拽手柄的固定间距（与官方 CSS 的 24px 一致）。 */
const HANDLE_GAP = 24

/**
 * 官方手柄的宽度（px，与官方 CSS 的 `.widthHandle{width:10px}` 一致）。
 *
 * 计算手柄左缘时要拿它当尺寸用：手柄是**以 left/right 定位一个 10px 宽的盒子**，
 * 不是一条线，落点必须把整条命中区算进去。
 */
const HANDLE_WIDTH = 10

/** 找出承载手柄的容器与对话流元素。 */
function resolveTargets(): { host: HTMLElement; flow: HTMLElement } | null {
  if (typeof document === 'undefined') return null
  const host = document.querySelector<HTMLElement>('[data-conversation-content]')
  if (!host) return null
  const flow = host.querySelector<HTMLElement>('[data-conversation-scroll]')
  if (!flow) return null
  return { host, flow }
}

/**
 * 把两条手柄摆到对话流内容区两侧。
 *
 * 只在**正文宽度轴确实启用**（对话流上有正的 --dsh-chat-content-width）时接管：
 * 该变量缺失说明官方没开这条轴，手柄本来就没有有效位置，硬写只会把官方的默认
 * 布局弄坏。
 */
function syncHandles(): void {
  const targets = resolveTargets()
  if (!targets) return
  const { host, flow } = targets
  const handles = host.querySelectorAll<HTMLElement>('[data-width-handle]')
  if (handles.length === 0) return

  const rawContentWidth = Number.parseFloat(
    getComputedStyle(flow).getPropertyValue('--dsh-chat-content-width'),
  )
  if (!Number.isFinite(rawContentWidth) || rawContentWidth <= 0) {
    clearHandles(host)
    return
  }

  const hostRect = host.getBoundingClientRect()
  const flowRect = flow.getBoundingClientRect()
  if (!(flowRect.width > 0)) return

  /*
   * 正文实际可用宽取「官方给的正文宽」与「对话流自身宽」的较小值：
   * Seeker 下官方仍按**容器**（含大盘）算正文宽，大盘一宽这个值就可能超过对话流
   * 本身，此时正文被容器压回对话流宽渲染 —— 手柄要跟正文的实际落点走，
   * 否则会跑到对话流外面去。
   */
  const contentWidth = Math.min(rawContentWidth, flowRect.width)
  const contentLeft = flowRect.left + (flowRect.width - contentWidth) / 2
  const contentRight = contentLeft + contentWidth

  /*
   * 落点：官方语义是「正文内容区外 24px」，但手柄本身是个 10px 宽的盒子，且那
   * 24px 的余量本身就来自「对话流比正文宽出来的部分」。Seeker 下正文常常已被压满
   * 整个对话流（留白 = 0），此时按 24px 摆会把手柄整条推出对话流、落进右侧大盘
   * （大盘 z-index 更高，那半边点不到，用户看到的就是「线不在它该在的位置」）。
   *
   * 所以按**对话流边界**钳制：留白够就沿用官方 24px；不够就把手柄整条收进对话流
   * 内边缘（贴住、但不越界）。两条线各自独立钳制，正文很窄时也不会互相串位。
   */
  const rightHandleLeft = Math.min(contentRight + HANDLE_GAP, flowRect.right - HANDLE_WIDTH)
  const leftHandleLeft = Math.max(contentLeft - HANDLE_GAP - HANDLE_WIDTH, flowRect.left)

  // absolute 定位的包含块是容器的 padding box（clientLeft/clientWidth 已排除边框）。
  const boxLeft = hostRect.left + host.clientLeft
  const boxRight = boxLeft + host.clientWidth

  for (const handle of handles) {
    const side = handle.getAttribute('data-width-handle')
    if (side === 'right') {
      const left = `${Math.round(rightHandleLeft - boxLeft)}px`
      if (handle.style.left !== left) handle.style.left = left
      if (handle.style.right !== 'auto') handle.style.right = 'auto'
    } else if (side === 'left') {
      const right = `${Math.round(boxRight - (leftHandleLeft + HANDLE_WIDTH))}px`
      if (handle.style.right !== right) handle.style.right = right
      if (handle.style.left !== 'auto') handle.style.left = 'auto'
    }
  }
}

/** 清掉本模块写过的 inline 定位，把控制权交还官方样式表。 */
function clearHandles(host?: HTMLElement | null): void {
  const root = host ?? (typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('[data-conversation-content]')
    : null)
  if (!root) return
  root.querySelectorAll<HTMLElement>('[data-width-handle]').forEach((handle) => {
    if (handle.style.left) handle.style.left = ''
    if (handle.style.right) handle.style.right = ''
  })
}

/**
 * 目标就位后的实际接线。返回卸载函数。
 *
 * 重算走 rAF 合并：拖拽与三栏重排会在同一帧里连着触发多次观察回调，逐次重算等于
 * 每帧多算几遍布局；合并后一帧至多一次，且读几何发生在样式写入之前，不会互相打架。
 */
function attach(targets: { host: HTMLElement; flow: HTMLElement }): () => void {
  let frame: number | null = null
  const schedule = (): void => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      syncHandles()
    })
  }

  schedule()

  const observers: Array<{ disconnect: () => void }> = []

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(targets.host)
    resizeObserver.observe(targets.flow)
    observers.push(resizeObserver)
  }

  if (typeof MutationObserver !== 'undefined') {
    /*
     * 正文宽度变化：官方把新值写在**对话 root 的 inline style** 上
     * （实测 --dsh-conversation-column-width / --dsh-chat-user-width，对话流上那条
     * --dsh-chat-content-width 是从它派生下来的），而 root 正是容器的父元素。
     * 只盯对话流自己的 style 会漏掉「用户拖官方手柄」这一路 —— 表现为拖完位置不跟。
     *
     * 自激是收敛的：本模块写的是手柄自己的 left/right（不是父元素），写完再跑一轮
     * 时值相同、不再写 DOM，观察链到此为止。
     */
    const root = targets.host.parentElement
    if (root) {
      const widthObserver = new MutationObserver(schedule)
      widthObserver.observe(root, { attributes: true, attributeFilter: ['style'] })
      observers.push(widthObserver)
    }

    // 手柄被 React 重建：新节点没有我们的 inline style，重算一次补回去。
    const structureObserver = new MutationObserver(schedule)
    structureObserver.observe(targets.host, { childList: true })
    observers.push(structureObserver)
  }

  /*
   * 兜底：拖拽期逐帧跟随。
   *
   * style 观察是异步批处理的，官方在指针移动里连续改宽度时可能一帧才回调一次，
   * 而手柄正是被拖的那个元素 —— 它必须**逐帧**跟住指针，否则手感上就是「线在手里
   * 抖」。所以指针按在手柄上期间直接开 rAF 循环，抬手即停。
   */
  let dragFrame: number | null = null
  const dragLoop = (): void => {
    syncHandles()
    dragFrame = requestAnimationFrame(dragLoop)
  }
  const stopDragLoop = (): void => {
    if (dragFrame !== null) cancelAnimationFrame(dragFrame)
    dragFrame = null
  }
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null
    if (!target || !target.closest('[data-width-handle]')) return
    stopDragLoop()
    dragFrame = requestAnimationFrame(dragLoop)
  }
  const onPointerUp = (): void => stopDragLoop()

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerUp, true)

  const onResize = (): void => schedule()
  window.addEventListener('resize', onResize)

  return () => {
    if (frame !== null) cancelAnimationFrame(frame)
    stopDragLoop()
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerUp, true)
    window.removeEventListener('resize', onResize)
    for (const observer of observers) observer.disconnect()
    clearHandles(targets.host)
  }
}

/**
 * 装上修正。返回卸载函数：断开全部观察并还原 inline style。
 *
 * 安装时机不保证对话流已就位（座位挂载与官方会话体渲染有先后），所以拿不到目标
 * 时不放弃，改挂一个 body 级观察等它出现 —— 否则「先挂大盘、后出对话流」这一帧
 * 就会让修正永久失效。
 */
export function installOfficialWidthHandleFix(): () => void {
  let detach: (() => void) | null = null
  let waiting: MutationObserver | null = null

  const start = (): boolean => {
    const targets = resolveTargets()
    if (!targets) return false
    detach = attach(targets)
    return true
  }

  if (!start() && typeof MutationObserver !== 'undefined') {
    waiting = new MutationObserver(() => {
      if (!start()) return
      waiting?.disconnect()
      waiting = null
    })
    waiting.observe(document.body, { childList: true, subtree: true })
  }

  return () => {
    waiting?.disconnect()
    waiting = null
    detach?.()
    detach = null
  }
}

/** 组件侧一行接入：Seeker 大盘挂载期间修正官方正文宽度手柄的位置。 */
export function useOfficialWidthHandleFix(): void {
  useEffect(() => installOfficialWidthHandleFix(), [])
}
