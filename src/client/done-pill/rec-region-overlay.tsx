/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 录屏框选 overlay（壳内「框选区域」目标的交互）。
 *
 * 面板点「框选区域」→ 本 overlay 铺满视口：拖拽画一个矩形，之后可以用 8 个
 * 手柄微调，Enter/双击确认、Esc 取消。确认后把 **viewport CSS 坐标**交给
 * recorder，由它平移窗口原点换算成屏幕坐标再裁剪整屏流（见 recorder.start）。
 *
 * 交互取舍（改前必读）：
 *  1. **不做整屏快照当背景**：那要先 getDisplayMedia 拿整屏授权——壳内跨源
 *     iframe 拿不到（display-capture 被 policy 拦就是录屏按钮本来就禁用的场景），
 *     白弹一次授权还失败。改用「四周压暗 + 选区透亮」，零权限即可用，
 *     用户本来就能看到屏幕上的真实内容（overlay 是半透明遮罩）。
 *  2. **遮罩用四块 div 而不是 box-shadow/radial-gradient**：需要的其实是
 *     「选区挖空」，四块矩形拼接最直白，也让选区的边界不依赖滤镜合成，
 *     在高 dpr 下边缘不发虚。
 *  3. **坐标一律用 viewport CSS 像素**（getBoundingClientRect 口径），
 *     dpr 换算交给 recorder 里的 scaleCropToVideo —— 两处都换一次必错。
 *  4. 挂 shell.overlay#dsh-done-pill-rec-region（order 94）：比选择面板（93）
 *     高一层，面板点完就关、由本 overlay 接棒。
 *  5. 动效走 PILL_CSS（cssRevision 指纹自动换表，升级无残留）：入场淡入、
 *     选框出现时轻微放大、提示文字呼吸、确认时选框收拢淡出。
 *
 * ⚠️ 指针捕获吞 click（**真机 bug 的根因，改前必读**）
 *   根层 `onPointerDown` 曾经**无条件** `setPointerCapture`，而操作条（取消 /
 *   开始录制）是根层的后代会冒泡到它——于是 Chromium 把随后的 pointerup 派发给
 *   **被捕获的根层**，合成的 click 也就落在根层上，两个按钮的 onClick 永不触发。
 *   表现：拖完框点「开始录制」毫无反应（按钮有 hover/active 反馈，看着像能点），
 *   只有 Enter 那条 window keydown 通路生效——用户就是这么报的。
 *   Electron 33 / Chromium 130 + CDP 真实指针事件实测（`_tmp/rec-probe`）：
 *     · 无捕获：`pointerup target=#btn` → `click target=#btn` → handler 触发；
 *     · 有捕获：`pointerup target=#root` → `click target=#root` → handler 不触发。
 *   现在三道闸：
 *   a. 操作条 `stopPropagation` 掉 pointerdown —— 根层收不到就不会捕获，
 *      按钮回到标准 click 语义（顺带避免点按钮把已画的选区重置掉）；
 *   b. 另开一条与 click 无关的通路：window **捕获阶段**的 pointerdown/pointerup
 *      记录并几何命中（`elementFromPoint`，不受指针捕获影响），命中才触发动作。
 *      这样即使将来谁再往祖先加捕获，按钮照样点得动；
 *   c. 两条通路用 ref 去重（一次点击只开一段录制），且根层双击确认会跳过操作条内
 *      的目标（否则双击「取消」= 先取消再开录）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { REC_REGION_MIN, REGION_ACTION_ATTR, regionRectFromPoints, resolveBarAction, type RecRect } from './rec-core'
import { fontScaleCss, getFontRatio, subscribeFontRatio } from './font-axis'
import { regionStore } from './rec-picker'
import { recorder } from './recorder'

/** 手柄命中边长（px）：够大好抓，又不至于盖住小选区的内部。 */
const HANDLE_HIT = 14
/** 手柄视觉边长（px）。 */
const HANDLE_VIS = 8
/** 拖拽手柄的种类：四角 + 四边。 */
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Array<{ id: HandleId; cursor: string; x: number; y: number }> = [
  { id: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { id: 'n', cursor: 'ns-resize', x: 0.5, y: 0 },
  { id: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { id: 'e', cursor: 'ew-resize', x: 1, y: 0.5 },
  { id: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { id: 's', cursor: 'ns-resize', x: 0.5, y: 1 },
  { id: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
  { id: 'w', cursor: 'ew-resize', x: 0, y: 0.5 },
]

/** 拖拽会话：从哪开始、当前是什么模式。 */
type Drag =
  | { kind: 'draw'; ax: number; ay: number; bx: number; by: number }
  | { kind: 'move'; origin: RecRect; ax: number; ay: number }
  | { kind: 'resize'; handle: HandleId; origin: RecRect; ax: number; ay: number }

const maskColor = 'color-mix(in srgb, var(--dpl-fg) 42%, transparent)'

/**
 * 根层：包裹提示胶囊、尺寸标签与操作条，同时**挂一份 `--dpt`**。
 *
 * 本 overlay portal 到 `document.body`，是独立节点、不是胶囊的后代（继承不到
 * 胶囊上那份变量）；不在这里补挂，下面所有 `var(--dpt)` 都会静默取缺省值 1。
 */
const rootStyle = (ratio: number): CSSProperties => ({
  position: 'fixed',
  inset: 0,
  zIndex: 9700,
  cursor: 'crosshair',
  userSelect: 'none',
  touchAction: 'none',
  // 整层淡入（PILL_CSS 的 dpFadeIn 已有；这里用专用 keyframe 带一点缩放）。
  animation: 'dplRegionIn .2s ease backwards',
  '--dpt': String(ratio),
} as CSSProperties)

const hintStyle: CSSProperties = {
  position: 'fixed',
  top: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 16px',
  borderRadius: 999,
  border: '1px solid var(--dpl-panel-border)',
  background: 'var(--dpl-panel-bg)',
  color: 'var(--dpl-fg)',
  fontSize: fontScaleCss(13),
  lineHeight: fontScaleCss(18),
  boxShadow: 'var(--dpl-panel-shadow)',
  pointerEvents: 'none',
  animation: 'dpMount .26s cubic-bezier(.32,.72,0,1) backwards',
}

const hintDotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: '#e5484d',
  animation: 'dplRegionPulse 1.6s ease-out infinite',
}

/** 选框：亮边 + 四角标记，随深色遮罩一起出现。 */
const selectionStyle: CSSProperties = {
  position: 'fixed',
  border: '1.5px solid color-mix(in srgb, #e5484d 78%, #fff)',
  boxShadow: '0 0 0 1px rgba(0,0,0,.35), 0 6px 24px rgba(0,0,0,.35)',
  cursor: 'move',
  animation: 'dplRegionPick .18s cubic-bezier(.32,.72,0,1) backwards',
}

const sizeTagStyle: CSSProperties = {
  position: 'fixed',
  padding: '3px 8px',
  borderRadius: 6,
  background: 'rgba(20,20,22,.86)',
  color: '#fff',
  fontSize: fontScaleCss(11),
  lineHeight: fontScaleCss(16),
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  animation: 'dpLineIn .2s ease backwards',
}

const barStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px 8px 14px',
  borderRadius: 12,
  border: '1px solid var(--dpl-panel-border)',
  background: 'var(--dpl-panel-bg)',
  color: 'var(--dpl-fg)',
  boxShadow: 'var(--dpl-panel-shadow)',
  animation: 'dpMount .24s cubic-bezier(.32,.72,0,1) backwards',
}

const barMetaStyle: CSSProperties = {
  fontSize: fontScaleCss(12),
  lineHeight: fontScaleCss(18),
  color: 'var(--dpl-fg-dim)',
  fontVariantNumeric: 'tabular-nums',
}

const btnStyle = (primary: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  padding: '0 12px',
  border: 'none',
  borderRadius: 7,
  background: primary ? '#e5484d' : 'var(--dpl-accent-soft)',
  color: primary ? '#fff' : 'var(--dpl-fg)',
  font: 'inherit',
  fontSize: fontScaleCss(12),
  fontWeight: 500,
  lineHeight: 1,
  cursor: 'pointer',
  transition: 'transform .12s ease, filter .12s ease',
})

/** 把矩形钳进视口。 */
function clampRect(rect: RecRect, vw: number, vh: number): RecRect {
  let { x, y, w, h } = rect
  w = Math.min(Math.max(REC_REGION_MIN, w), vw)
  h = Math.min(Math.max(REC_REGION_MIN, h), vh)
  x = Math.min(Math.max(0, x), vw - w)
  y = Math.min(Math.max(0, y), vh - h)
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** 按手柄调整矩形（resize 一侧/一角，对边固定）。 */
function resizeRect(
  origin: RecRect,
  handle: HandleId,
  dx: number,
  dy: number,
  vw: number,
  vh: number,
): RecRect {
  let { x, y, w, h } = origin
  const right = x + w
  const bottom = y + h
  if (handle.includes('w')) { x = Math.min(Math.max(0, x + dx), right - REC_REGION_MIN); w = right - x } else if (handle.includes('e')) { w = Math.min(Math.max(REC_REGION_MIN, w + dx), vw - x) }
  if (handle.includes('n')) { y = Math.min(Math.max(0, y + dy), bottom - REC_REGION_MIN); h = bottom - y } else if (handle.includes('s')) { h = Math.min(Math.max(REC_REGION_MIN, h + dy), vh - y) }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** 录屏框选 overlay。 */
export function RecRegionOverlay(): JSX.Element | null {
  const [open, setOpen] = useState(() => regionStore.get().open)
  const [rect, setRect] = useState<RecRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // 官方字号比例：overlay portal 到 body，拿不到胶囊上那份 --dpt，自己读一份。
  const [fontRatio, setFontRatio] = useState(() => getFontRatio())
  const dragRef = useRef<Drag | null>(null)
  /** 确认是否已经发起过（退场动效期间挡住重复确认，见 confirm）。 */
  const leavingRef = useRef(false)
  /** 按下时命中的操作条按钮（pointerup 通道要校验是**同一次**按下才触发）。 */
  const downActionRef = useRef<string | null>(null)
  /** 本次点击是否已被 pointerup 通道消化（click 通道据此去重，防重复开录）。 */
  const consumedRef = useRef(false)
  /** 视口尺寸（拖拽边界；resize 时更新）。 */
  const [view, setView] = useState(() => ({
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))

  useEffect(() => regionStore.subscribe((next) => { setOpen(next.open) }), [])
  useEffect(() => subscribeFontRatio(() => { setFontRatio(getFontRatio()) }), [])

  // 视口变化：框跟着重钳（否则窗口缩小后框会跑到视口外）。
  useEffect(() => {
    if (!open) return undefined
    const onResize = (): void => {
      const w = window.innerWidth
      const h = window.innerHeight
      setView({ w, h })
      setRect((cur) => (cur === null ? cur : clampRect(cur, w, h)))
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [open])

  // 打开时重置：每次进来都是干净的「等你画框」状态。
  useEffect(() => {
    if (open) {
      setRect(null)
      setDragging(false)
      setLeaving(false)
      dragRef.current = null
      leavingRef.current = false
      downActionRef.current = null
      consumedRef.current = false
      setView({ w: window.innerWidth, h: window.innerHeight })
    }
  }, [open])

  const close = useCallback((): void => { regionStore.close() }, [])

  /** 取消：直接收起，回到待机（不弹提示——用户主动取消不是错误）。 */
  const cancel = useCallback((): void => {
    // 已经发起确认（退场动效中）就不再响应取消，否则会出现「点了开始录制、
    // 又在 150ms 内点了取消」时序下 overlay 关了却仍然开录的怪状态。
    if (leavingRef.current) return
    close()
  }, [close])

  /** 确认：带一点退场动效再交给 recorder（动画期间不阻塞状态迁移）。 */
  const confirm = useCallback((): void => {
    // 重入闸：pointerup 与 click 两条通道都可能命中同一次点击，重复确认会
    // 起两次录制（recorder.startWith 里 idle 判断挡不住同一 tick 内的两次调用）。
    if (leavingRef.current) return
    const picked = rect
    if (picked === null || picked.w < REC_REGION_MIN || picked.h < REC_REGION_MIN) return
    leavingRef.current = true
    setLeaving(true)
    window.setTimeout(() => {
      close()
      recorder.startWith({ kind: 'region', rect: picked })
    }, 150)
  }, [rect, close])

  /**
   * 操作条按钮的动作通道（**不依赖 click**）。
   *
   * 为什么不能用 click 当唯一通路：祖先一旦 `setPointerCapture`，pointerup 与随后
   * 合成的 click 的 target 都会变成那个祖先，按钮的 onClick 静默失效——这正是本
   * 组件修掉的那个 bug（见文件头注释）。这里在 window 的**捕获阶段**监听，先于任何
   * stopPropagation，并用 `elementFromPoint` 做几何命中（命中测试不受指针捕获影响），
   * 因此无论祖先有没有偷走指针，按钮都点得动。
   *
   * 命中规则与传统 click 一致：按下与抬起必须落在**同一个**操作按钮上。
   * 触发后置 consumed 标记，紧随其后的 click 通道据此早退，保证一次点击只开录一次。
   */
  useEffect(() => {
    if (!open) return undefined
    const actionAt = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null
      const el = target.closest(`[${REGION_ACTION_ATTR}]`)
      return el === null ? null : el.getAttribute(REGION_ACTION_ATTR)
    }
    const onDown = (event: PointerEvent): void => {
      consumedRef.current = false
      downActionRef.current = event.button === 0 ? actionAt(event.target) : null
    }
    const onUp = (event: PointerEvent): void => {
      const down = downActionRef.current
      downActionRef.current = null
      if (event.button !== 0) return
      // 抬起位置用几何命中：指针被祖先捕获时 event.target 是捕获元素，不可信。
      const up = actionAt(document.elementFromPoint(event.clientX, event.clientY))
      const action = resolveBarAction(down, up)
      if (action === 'none' || action === 'mismatch') return
      consumedRef.current = true
      if (action === 'cancel') cancel()
      else confirm()
    }
    const onCancelPointer = (): void => { downActionRef.current = null }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancelPointer, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancelPointer, true)
    }
  }, [open, cancel, confirm])

  /** 操作条：拦掉按下，别让根层收到（根层一收到就会捕获指针 + 重置已画的框）。 */
  const onBarPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
  }, [])

  /** click 通道（键盘 Enter/Space 与未被捕获指针的正常点击走这里）。 */
  const onBarClick = useCallback((action: 'go' | 'cancel'): void => {
    // pointerup 通道已经消化过这次点击：早退（并复位标记，否则下一次键盘/
    // 无捕获点击会被误吞），保证一次点击只开一段录制。
    if (consumedRef.current) { consumedRef.current = false; return }
    if (action === 'cancel') cancel()
    else confirm()
  }, [cancel, confirm])

  /**
   * 根层双击 = 确认。但操作条内的双击要排除：那里的两次 click 已经是
   * 「取消 / 开始录制」本身，再叠一次 confirm 会变成「先取消又开录」。
   */
  const onRootDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest(`[${REGION_ACTION_ATTR}]`) !== null) return
    confirm()
  }, [confirm])

  // 键盘：Esc 取消、Enter 确认（有框时）。
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); return }
      if (event.key === 'Enter' && rect !== null) { event.preventDefault(); confirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, rect, cancel, confirm])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    // 操作条上的按下不是画框：既不重置已画的选区，更不能把指针捕获走——捕获一旦
    // 落在根层，随后的 pointerup / click 都会以根层为目标，按钮直接变哑巴。
    // 操作条自己也会 stopPropagation（见 onBarPointerDown），这里是**独立兜底**：
    // 将来谁把那个 stopPropagation 删了，行为也不会退化成原 bug。
    if (event.target instanceof Element && event.target.closest(`[${REGION_ACTION_ATTR}]`) !== null) return
    // 选框内的按下（move）与手柄（resize）各自 stopPropagation，不会走到这。
    const ax = event.clientX
    const ay = event.clientY
    dragRef.current = { kind: 'draw', ax, ay, bx: ax, by: ay }
    setDragging(true)
    setRect({ x: Math.round(ax), y: Math.round(ay), w: REC_REGION_MIN, h: REC_REGION_MIN })
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const vw = view.w
    const vh = view.h
    if (drag.kind === 'draw') {
      drag.bx = event.clientX
      drag.by = event.clientY
      setRect(regionRectFromPoints(drag.ax, drag.ay, drag.bx, drag.by, vw, vh))
      return
    }
    const dx = event.clientX - drag.ax
    const dy = event.clientY - drag.ay
    if (drag.kind === 'move') {
      setRect(clampRect({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }, vw, vh))
      return
    }
    setRect(resizeRect(drag.origin, drag.handle, dx, dy, vw, vh))
  }, [view])

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return
    dragRef.current = null
    setDragging(false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ }
  }, [])

  /** 选框本体内按下 = 整体拖动。 */
  const onSelectionDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || rect === null) return
    event.stopPropagation()
    dragRef.current = { kind: 'move', origin: rect, ax: event.clientX, ay: event.clientY }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [rect])

  const onHandleDown = useCallback((event: React.PointerEvent<HTMLDivElement>, handle: HandleId): void => {
    if (event.button !== 0 || rect === null) return
    event.stopPropagation()
    dragRef.current = { kind: 'resize', handle, origin: rect, ax: event.clientX, ay: event.clientY }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [rect])

  // 四块遮罩的几何（选区挖空的四个矩形；无选区时整屏压暗）。
  const masks = useMemo(() => {
    const vw = view.w
    const vh = view.h
    if (rect === null) return [{ left: 0, top: 0, width: vw, height: vh }]
    const { x, y, w, h } = rect
    return [
      { left: 0, top: 0, width: vw, height: y },
      { left: 0, top: y + h, width: vw, height: Math.max(0, vh - y - h) },
      { left: 0, top: y, width: x, height: h },
      { left: x + w, top: y, width: Math.max(0, vw - x - w), height: h },
    ]
  }, [rect, view])

  if (!open) return null

  const sizeTag = rect !== null ? `${rect.w} × ${rect.h}` : ''
  // 尺寸标签贴在选框上方，贴顶时改贴框内（否则会被视口裁掉）。
  const tagTop = rect === null ? 0 : (rect.y > 26 ? rect.y - 24 : rect.y + 6)

  return createPortal(
    <div
      style={{ ...rootStyle(fontRatio), opacity: leaving ? 0 : 1, transition: 'opacity .15s ease' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onRootDoubleClick}
      role="dialog"
      aria-label="框选录屏区域"
    >
      {masks.map((mask, index) => (
        <div
          key={index}
          style={{
            position: 'fixed',
            left: mask.left,
            top: mask.top,
            width: mask.width,
            height: mask.height,
            background: maskColor,
            pointerEvents: 'none',
            // 打开瞬间遮罩一起淡入，避免「闪一下全黑」。
            animation: 'dplRegionFade .22s ease backwards',
          }}
        />
      ))}

      {/* 顶部提示：这是唯一的操作说明，保持在视线中心上方。 */}
      <div style={hintStyle}>
        <span style={hintDotStyle} aria-hidden />
        {rect === null ? '拖拽框选要录制的区域' : '拖拽调整 · Enter 开始录制 · Esc 取消'}
      </div>

      {rect !== null && (
        <>
          <div
            style={{
              ...selectionStyle,
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              // 拖拽中不播放入场动画（重挂载会闪），只在落定时播一次。
              animation: dragging ? 'none' : selectionStyle.animation,
            }}
            onPointerDown={onSelectionDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          >
            {/* 手柄：命中区比视觉大一圈，四角略突出到框外便于抓取。 */}
            {HANDLES.map((handle) => (
              <div
                key={handle.id}
                onPointerDown={(event) => { onHandleDown(event, handle.id) }}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                style={{
                  position: 'absolute',
                  left: `calc(${handle.x * 100}% - ${HANDLE_HIT / 2}px)`,
                  top: `calc(${handle.y * 100}% - ${HANDLE_HIT / 2}px)`,
                  width: HANDLE_HIT,
                  height: HANDLE_HIT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: handle.cursor,
                }}
              >
                <span
                  style={{
                    width: HANDLE_VIS,
                    height: HANDLE_VIS,
                    borderRadius: 2,
                    background: '#fff',
                    boxShadow: '0 0 0 1.5px #e5484d',
                    transition: 'transform .12s ease',
                  }}
                  className="dpl-region-handle"
                />
              </div>
            ))}
          </div>

          <div style={{ ...sizeTagStyle, left: rect.x, top: tagTop }}>{sizeTag}</div>
        </>
      )}

      {/* 底部操作条：有框才出现（没框时只有提示，避免干扰画框）。
          data-dpl-region-action 是**几何命中标记**，供 pointerup 通道使用；
          onPointerDown 拦下冒泡，避免根层把指针捕获走 + 重置掉已画的框。 */}
      {rect !== null && (
        <div className="dpl-region-bar" style={{ ...barStyle, bottom: 26 }} onPointerDown={onBarPointerDown}>
          <span style={barMetaStyle}>{`选区 ${rect.w}×${rect.h}`}</span>
          <button
            type="button"
            data-dpl-region-action="cancel"
            style={btnStyle(false)}
            onClick={(event) => { event.stopPropagation(); onBarClick('cancel') }}
          >
            取消
          </button>
          <button
            type="button"
            data-dpl-region-action="go"
            style={btnStyle(true)}
            className="dpl-region-go"
            onClick={(event) => { event.stopPropagation(); onBarClick('go') }}
          >
            开始录制
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
