/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 录屏目标选择面板（壳内无原生选择器时的替代）。
 *
 * 点录屏按钮且环境没有系统选择器时弹出三种目标：
 *  - 整屏：整个主屏；
 *  - 框选区域：进 rec-region-overlay 拖一个矩形，只录那一块；
 *  - 窗口：host 侧 PrintWindow 抓该窗口自己 —— **窗口被其它窗口遮挡也不影响**，
 *    且列表里带出各顶层窗的**子窗口**（缩进一层）。
 *
 * 窗口列表来自 GET /api/dsh-companion/rec-windows（已按「顶层窗 + 其子窗口」
 * 排好序，见 rec-core.orderWindowTree）。纯浏览器不会走到这里。
 *
 * 挂载 shell.overlay#dsh-done-pill-rec-picker（order 93）；配色走 --dpl-*，
 * 入场/行 stagger 走 PILL_CSS 的 dpMount / dpRowIn（用户偏好动效）。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { fetchRecWindows, pickerStore, regionStore, type RecWindow } from './rec-picker'
import { recorder } from './recorder'
import { windowSubtitle } from './rec-core'
import { fontScaleCss, getFontRatio, subscribeFontRatio } from './font-axis'

/** 面板宽度。 */
const PANEL_W = 480
/** 列表最多展示条数（超出滚动；子窗口也在内，所以给得比原来宽）。 */
const MAX_ROWS = 40

/**
 * 遮罩：同时**挂一份 `--dpt`**。
 *
 * 本面板 portal 到 `document.body`（挂 `shell.overlay#dsh-done-pill-rec-picker`），
 * 是独立节点、不是胶囊的后代，继承不到胶囊上那份变量；不在这里补挂，
 * 面板里所有 `var(--dpt)` 都会静默取缺省值 1（字号一点都不跟）。
 * 挂在遮罩上即可——卡片是它的子元素，继承得到。
 */
const maskStyle = (ratio: number): CSSProperties => ({
  position: 'fixed',
  inset: 0,
  zIndex: 9600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'color-mix(in srgb, var(--dpl-fg) 18%, transparent)',
  backdropFilter: 'blur(2px)',
  animation: 'dpFadeIn .18s ease backwards',
  '--dpt': String(ratio),
} as CSSProperties)

const cardStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: `min(${PANEL_W}px, calc(100vw - 32px))`,
  maxHeight: 'min(68vh, 600px)',
  padding: '14px 14px 12px',
  borderRadius: 16,
  border: '1px solid var(--dpl-panel-border)',
  background: 'var(--dpl-panel-bg)',
  color: 'var(--dpl-fg)',
  boxShadow: 'var(--dpl-panel-shadow)',
  animation: 'dpMount .26s cubic-bezier(.32,.72,0,1) backwards',
}

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 2px 6px',
}

const titleStyle: CSSProperties = {
  flex: 1,
  fontSize: fontScaleCss(15),
  fontWeight: 600,
  lineHeight: fontScaleCss(22),
}

const closeStyle: CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'transparent',
  color: 'var(--dpl-fg-dim)',
  fontSize: fontScaleCss(16),
  lineHeight: 1,
  padding: 4,
  borderRadius: 6,
  cursor: 'pointer',
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  minHeight: 0,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  boxSizing: 'border-box',
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: fontScaleCss(13),
  lineHeight: fontScaleCss(20),
  textAlign: 'left',
  cursor: 'pointer',
  animation: 'dpRowIn .26s cubic-bezier(.32,.72,0,1) backwards',
}

const rowTitleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const rowMetaStyle: CSSProperties = {
  flex: 'none',
  fontSize: fontScaleCss(11),
  color: 'var(--dpl-fg-weak)',
  fontVariantNumeric: 'tabular-nums',
}

const iconWrapStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 6,
  background: 'var(--dpl-accent-soft)',
  color: 'var(--dpl-fg-dim)',
}

/** 分组小标题（「屏幕」/「窗口」）。 */
const groupStyle: CSSProperties = {
  padding: '8px 10px 3px',
  fontSize: fontScaleCss(11),
  fontWeight: 600,
  letterSpacing: '.02em',
  color: 'var(--dpl-fg-weak)',
}

/** 显示器图标（整屏行）。尺寸走 CSS 变量，跟随官方字号轴。 */
function ScreenIcon(): JSX.Element {
  return (
    <svg className="dpl-rec-icon" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M9 21h6M12 17v4" />
    </svg>
  )
}

/** 框选图标（虚线选框 + 中心点）。 */
function RegionIcon(): JSX.Element {
  return (
    <svg className="dpl-rec-icon" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 窗口图标（窗口行）。 */
function WindowIcon(): JSX.Element {
  return (
    <svg className="dpl-rec-icon" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9h18" />
      <circle cx="6" cy="6.8" r=".6" fill="currentColor" />
      <circle cx="8.6" cy="6.8" r=".6" fill="currentColor" />
    </svg>
  )
}

/** 子窗口图标（小一号的窗，表示归属）。 */
function ChildWindowIcon(): JSX.Element {
  return (
    <svg className="dpl-rec-icon dpl-rec-icon--sm" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="3" width="15" height="12" rx="2" />
      <path d="M3 8.5v9A2.5 2.5 0 0 0 5.5 20h9" />
    </svg>
  )
}

/** 录屏目标选择面板。 */
export function RecPickerPanel(): JSX.Element | null {
  const [open, setOpen] = useState(() => pickerStore.get().open)
  const [windows, setWindows] = useState<RecWindow[]>([])
  const [loading, setLoading] = useState(false)
  // 官方字号比例：面板 portal 到 body，拿不到胶囊上那份 --dpt，自己读一份挂上去。
  const [fontRatio, setFontRatio] = useState(() => getFontRatio())
  useEffect(() => pickerStore.subscribe((next) => { setOpen(next.open) }), [])
  useEffect(() => subscribeFontRatio(() => { setFontRatio(getFontRatio()) }), [])

  // 打开时拉一次窗口列表（host 侧 2s 缓存，重复打开不重复跑 powershell）。
  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setLoading(true)
    void fetchRecWindows().then((list) => {
      if (!alive) return
      setWindows(list.slice(0, MAX_ROWS))
      setLoading(false)
    })
    return () => { alive = false }
  }, [open])

  const close = useCallback((): void => { pickerStore.close() }, [])

  // Escape 关闭。
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, close])

  /** 顶层窗口的数量（用于「没有其它可见窗口」的空态判断）。 */
  const topCount = useMemo(() => windows.filter((w) => w.depth === 0).length, [windows])

  if (!open) return null

  const pick = (target: Parameters<typeof recorder.startWith>[0]): void => {
    pickerStore.close()
    recorder.startWith(target)
  }

  /** 框选：关面板、开 overlay（overlay 里确认后才真正开录）。 */
  const pickRegion = (): void => {
    pickerStore.close()
    regionStore.open()
  }

  return createPortal(
    <div
      style={maskStyle(fontRatio)}
      role="dialog"
      aria-label="选择录屏目标"
      onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}
    >
      <div className="dsh-done-pill" style={cardStyle}>
        <div style={headStyle}>
          <span style={titleStyle}>选择录屏目标</span>
          <button type="button" style={closeStyle} aria-label="关闭" onClick={close}>✕</button>
        </div>
        <div style={listStyle}>
          <div style={groupStyle}>屏幕</div>
          <button
            type="button"
            className="dsh-done-pill-row"
            style={rowStyle}
            title="录制整个屏幕"
            onClick={() => { pick({ kind: 'full' }) }}
          >
            <span style={iconWrapStyle}><ScreenIcon /></span>
            <span style={rowTitleStyle}>整屏</span>
            <span style={rowMetaStyle}>全部显示器主屏</span>
          </button>
          <button
            type="button"
            className="dsh-done-pill-row"
            style={{ ...rowStyle, animationDelay: '26ms' }}
            title="拖拽框选要录制的区域"
            onClick={pickRegion}
          >
            <span style={iconWrapStyle}><RegionIcon /></span>
            <span style={rowTitleStyle}>框选区域</span>
            <span style={rowMetaStyle}>拖一个矩形</span>
          </button>

          <div style={groupStyle}>窗口</div>
          {windows.map((win, index) => {
            const child = win.depth > 0
            return (
              <button
                key={win.hwnd}
                type="button"
                className="dsh-done-pill-row"
                style={{
                  ...rowStyle,
                  // 子窗口缩进一层，并用左侧竖线标出归属。
                  marginLeft: child ? 18 : 0,
                  width: child ? 'calc(100% - 18px)' : '100%',
                  animationDelay: `${Math.min(index, 10) * 22}ms`,
                }}
                title={child
                  ? `录制子窗口「${windowSubtitle(win)}」（${win.cls}，${win.w}×${win.h}）`
                  : `录制窗口「${windowSubtitle(win)}」（${win.w}×${win.h}，被遮挡也不影响）`}
                onClick={() => { pick({ kind: 'window', hwnd: win.hwnd, pid: win.pid, title: windowSubtitle(win) }) }}
              >
                <span style={{ ...iconWrapStyle, ...(child ? { width: 18, height: 18, borderRadius: 5 } : {}) }}>
                  {child ? <ChildWindowIcon /> : <WindowIcon />}
                </span>
                <span style={rowTitleStyle}>{windowSubtitle(win)}</span>
                <span style={rowMetaStyle}>{`${win.w}×${win.h}`}</span>
              </button>
            )
          })}
          {loading && <div style={{ ...rowMetaStyle, padding: '4px 10px' }}>正在读取窗口列表…</div>}
          {!loading && topCount === 0 && (
            <div style={{ ...rowMetaStyle, padding: '4px 10px' }}>没有检测到其它可见窗口，可录整屏或框选区域</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
