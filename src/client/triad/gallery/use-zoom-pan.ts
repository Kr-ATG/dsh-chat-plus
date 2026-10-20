/**
 * dsh-chat-plus — 弹窗内的缩放 / 平移手势（纯逻辑 hook，无 UI）。
 *
 * ## 为什么需要它
 *
 * 画廊里的图有大有小（微信截图 600px、生成式 UI 效果图 2280px），统一按
 * 「适应容器」显示时，细字与图例基本看不清。看图工具的通用解法就两个手势：
 * **Ctrl + 滚轮缩放**、**放大后拖拽平移**。这里把它们做成一个 hook，
 * 弹窗只管把返回的 transform 贴到目标元素上。
 *
 * ## 为什么不用 CSS 的 max-width 递进
 *
 * 改尺寸会触发重排（每一帧都在算布局），而且锚点没法跟光标走 —— 缩放时图会
 * 从中心「窜」到别处。`transform: translate() scale()` 走合成层，零重排，
 * 且坐标系是线性的，能做到「光标底下那个像素点不动」。
 *
 * ## 锚点公式
 *
 * 设光标相对容器中心的偏移为 (cx, cy)，当前缩放 s、平移 (tx, ty)，则内容里
 * 那一点相对中心的坐标是 ((cx - tx) / s, (cy - ty) / s)。缩放后要保持它仍在
 * (cx, cy)：
 *
 *     tx' = cx - (cx - tx) * (s' / s)
 *
 * 平移量与缩放量同乘这个比例，所以光标锚定是精确的（不是近似）。
 *
 * ## 边界
 *
 * 放大后允许拖动，但内容边缘不会被拖离容器：最大平移量 = (内容尺寸 × 缩放 -
 * 容器尺寸) / 2，小于 0 时取 0（内容还比容器小，就该保持居中）。这样不会
 * 出现「把图拖到视野外，只剩一片黑」。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/** 缩放下限：再小就只剩噪点（0.2 = 原尺寸的五分之一）。 */
const MIN_SCALE = 0.2
/** 缩放上限：8 倍足够看清 2280px 宽图里的 8px 小字。 */
const MAX_SCALE = 8
/** 滚轮灵敏度：deltaY 每 1px 对应 e^0.0016 倍，一格标准滚轮 ≈ 1.17 倍。 */
const WHEEL_GAIN = 0.0016
/** 双击放大到的档位（再双击回来）。 */
const DOUBLE_TAP_SCALE = 2
/** 复位动画时长（与样式表 .glb-media 的 transition 成对维护）。 */
const RESET_MS = 240

/** 一个被夹到区间内的数。 */
function clampTo(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

/** 当前视图状态（scale = 1 表示「适应容器」的原始呈现）。 */
interface View {
  readonly s: number
  readonly x: number
  readonly y: number
}

/** 复位态（scale 1 / 平移 0）。 */
const HOME: View = { s: 1, x: 0, y: 0 }

/** 可缩放元素上的标记属性：hook 靠它量「base 尺寸」。 */
export const ZOOM_TARGET_ATTR = 'data-zoom-target'

export interface ZoomPan {
  /** 当前缩放倍数（1 = 适应容器）。 */
  readonly scale: number
  /** 贴到可缩放元素上的样式（transform + 光标）。 */
  readonly style: CSSProperties
  /** 是否已离开原始视图（用于显示比例胶囊 / 复位按钮）。 */
  readonly active: boolean
  /** 拖拽中（样式上换成抓取光标）。 */
  readonly dragging: boolean
  /** 复位到原始视图（带动画）。 */
  reset: () => void
  /** 以容器中心为锚点缩放一个倍率（键盘 +/- 用）。 */
  zoomBy: (factor: number) => void
  /**
   * 当前是否按住了 Ctrl / ⌘（`enabled` 为 false 时也会跟踪）。
   *
   * 调用方用它盖一层透明遮罩：iframe 有自己的文档，轮子事件**不会冒泡到
   * 宿主页面**，于是「在网页预览里按 Ctrl + 滚轮」会落到浏览器默认行为上 ——
   * 整个 DSH 界面被缩放（Ctrl+滚轮 是 Chrome 的页面缩放快捷键）。遮罩把
   * 事件接回宿主，才能 preventDefault 掉它。
   */
  readonly ctrlHeld: boolean
}

/**
 * 绑定缩放 / 平移手势。
 *
 * @param container - 手势容器（弹窗内容区）。事件绑在它身上，锚点也按它的
 *   中心算；容器内的可缩放元素需要带 {@link ZOOM_TARGET_ATTR} 标记。
 * @param enabled - 这类内容是否支持缩放（iframe / 音频不参与：它们自己的
 *   滚动与原生控件不该被我们截胡）。
 * @returns 缩放状态与贴到目标元素上的样式。
 */
export function useZoomPan(container: RefObject<HTMLElement | null>, enabled: boolean): ZoomPan {
  const [view, setView] = useState<View>(HOME)
  /** 事件回调里读最新视图（React 状态在监听器闭包里会陈旧）。 */
  const viewRef = useRef<View>(HOME)
  viewRef.current = view
  /** 拖拽会话：起手时的指针位置与当时的平移量。 */
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  /** 复位动画进行中：只有这段时间允许 transform 过渡，平时必须跟手。 */
  const [animating, setAnimating] = useState(false)
  const animTimer = useRef<number | null>(null)
  /** Ctrl / ⌘ 按住状态（遮罩用；窗口失焦必须归零，否则会留一层死遮罩）。 */
  const [ctrlHeld, setCtrlHeld] = useState(false)

  /** 按内容实际尺寸夹住平移量（内容比容器小时返回 0，保持居中）。 */
  const confine = useCallback((next: View): View => {
    const box = container.current
    if (box === null) return next
    const target = box.querySelector<HTMLElement>(`[${ZOOM_TARGET_ATTR}]`)
    // offsetWidth/Height 不受 transform 影响 —— 正是「内容原始尺寸」。
    const w = target?.offsetWidth ?? 0
    const h = target?.offsetHeight ?? 0
    const maxX = Math.max(0, (w * next.s - box.clientWidth) / 2)
    const maxY = Math.max(0, (h * next.s - box.clientHeight) / 2)
    return { s: next.s, x: clampTo(next.x, -maxX, maxX), y: clampTo(next.y, -maxY, maxY) }
  }, [container])

  const reset = useCallback(() => {
    setAnimating(true)
    setView(HOME)
    if (animTimer.current !== null) window.clearTimeout(animTimer.current)
    animTimer.current = window.setTimeout(() => { setAnimating(false) }, RESET_MS + 20)
  }, [])

  /** 以容器内某点为中心缩放到指定倍数（双击、滚轮、键盘共用）。 */
  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number) => {
    setView((prev) => {
      const s = clampTo(prev.s * factor, MIN_SCALE, MAX_SCALE)
      if (s === prev.s) return prev
      const k = s / prev.s
      return confine({ s, x: anchorX - (anchorX - prev.x) * k, y: anchorY - (anchorY - prev.y) * k })
    })
  }, [confine])

  /** 以容器中心为锚点缩放（键盘 +/- 用；坐标原点就是中心，锚点传 (0, 0)）。 */
  const zoomBy = useCallback((factor: number) => { zoomAt(factor, 0, 0) }, [zoomAt])

  /* ── 滚轮：只在按住 Ctrl / Meta 时接管 ──────────────────────────────
   *
   * 必须是原生监听 + passive:false：React 的 onWheel 走的是合成事件委托，
   * 且默认 passive —— 里面调 preventDefault 会被浏览器忽略并告警，于是
   * 「Ctrl + 滚轮」会连带缩放整个页面（视口大字变，弹窗却不动）。
   *
   * 不按修饰键的滚轮**完全不拦截**：页图 / iframe 里还等着用它滚动。
   */
  useEffect(() => {
    const box = container.current
    if (box === null || !enabled) return undefined
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = box.getBoundingClientRect()
      const cx = event.clientX - rect.left - rect.width / 2
      const cy = event.clientY - rect.top - rect.height / 2
      // 三种 deltaMode：像素 / 行 / 页。行模式按 16px、页模式按 100px 折算，
      // 否则滚轮鼠标（Firefox 常用行模式）会缩放得几乎没反应。
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
      zoomAt(Math.exp(-event.deltaY * unit * WHEEL_GAIN), cx, cy)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => { box.removeEventListener('wheel', onWheel) }
  }, [container, enabled, zoomAt])

  /* ── 拖拽：只有放大之后才生效（原始视图下没有可拖的余量）───────────── */
  useEffect(() => {
    const box = container.current
    if (box === null || !enabled) return undefined

    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const current = viewRef.current
      if (current.s <= 1.001) return
      // 点在按钮 / 翻页条上时不接管：那些是控件，拖拽会把点击吞掉。
      const target = event.target as Element | null
      if (target !== null && target.closest('button, audio, video, iframe') !== null) return
      drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: current.x, oy: current.y }
      setDragging(true)
      try { box.setPointerCapture(event.pointerId) } catch { /* 不支持捕获时退化为普通拖拽 */ }
    }

    const onMove = (event: PointerEvent): void => {
      const session = drag.current
      if (session === null || session.id !== event.pointerId) return
      event.preventDefault()
      setView(confine({
        s: viewRef.current.s,
        x: session.ox + (event.clientX - session.sx),
        y: session.oy + (event.clientY - session.sy),
      }))
    }

    const endDrag = (event: PointerEvent): void => {
      const session = drag.current
      if (session === null || session.id !== event.pointerId) return
      drag.current = null
      setDragging(false)
      try { box.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ }
    }

    box.addEventListener('pointerdown', onDown)
    box.addEventListener('pointermove', onMove)
    box.addEventListener('pointerup', endDrag)
    box.addEventListener('pointercancel', endDrag)
    return () => {
      box.removeEventListener('pointerdown', onDown)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerup', endDrag)
      box.removeEventListener('pointercancel', endDrag)
      drag.current = null
    }
  }, [container, enabled, confine])

  /* ── 双击：放大 ⇄ 复位（以双击点为锚点，落在哪儿放大哪儿）───────────── */
  useEffect(() => {
    const box = container.current
    if (box === null || !enabled) return undefined
    const onDoubleClick = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (target !== null && target.closest('button, audio, video, iframe') !== null) return
      const current = viewRef.current
      if (current.s > 1.001) { reset(); return }
      const rect = box.getBoundingClientRect()
      zoomAt(DOUBLE_TAP_SCALE, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2)
    }
    box.addEventListener('dblclick', onDoubleClick)
    return () => { box.removeEventListener('dblclick', onDoubleClick) }
  }, [container, enabled, reset, zoomAt])

  /*
   * 跟踪 Ctrl / ⌘ 的按住状态（给「iframe 上盖遮罩」用）。
   *
   * 必须监听 keyup 之外还要监听 blur：用户按住 Ctrl 切走窗口、再切回来时
   * 收不到 keyup，遮罩会一直盖着，看起来像界面卡死。
   */
  useEffect(() => {
    const down = (event: KeyboardEvent): void => { if (event.ctrlKey || event.metaKey) setCtrlHeld(true) }
    const up = (event: KeyboardEvent): void => { if (!event.ctrlKey && !event.metaKey) setCtrlHeld(false) }
    const blur = (): void => { setCtrlHeld(false) }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => () => {
    if (animTimer.current !== null) window.clearTimeout(animTimer.current)
  }, [])

  const style: CSSProperties = {
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`,
    transformOrigin: 'center center',
    // 复位才允许过渡；拖拽与滚轮必须零延迟跟手，否则手感是"拖着一块橡皮"。
    transition: animating ? `transform ${RESET_MS}ms cubic-bezier(.2,.8,.2,1)` : 'none',
    // 光标给出可缩放 / 可拖拽的信号（比任何提示文字都省事）。
    cursor: dragging ? 'grabbing' : view.s > 1.001 ? 'grab' : enabled ? 'zoom-in' : 'default',
    willChange: view.s !== 1 ? 'transform' : undefined,
  }

  return {
    scale: view.s,
    style,
    active: view.s !== 1 || view.x !== 0 || view.y !== 0,
    dragging,
    reset,
    zoomBy,
    ctrlHeld,
  }
}
