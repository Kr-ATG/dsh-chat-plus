/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 跳转结果提示条（client 半身）。
 *
 * 胶囊点击跳转失败时，旧实现只在 console 里留一行 warn——用户看到的就是
 * 「点了没反应」，既不知道失败也不知道为什么。本组件订阅
 * `session-nav` 的 navNoticeStore，把失败原因做成一条**可见**的浮层提示：
 * 底部居中滑入、3.6 秒自动收起、悬停暂停、可手动关闭。
 *
 * 挂载在 `shell.overlay#dsh-done-pill-nav-toast`（与胶囊同一个全局浮层，
 * 无会话时也能显示）。配色走 pill.tsx 注入的 --dpl-* 变量，深浅主题自适应；
 * 入场/退场动画走 PILL_CSS 里的 keyframes（用户偏好动效，别做成静态弹出）。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { navNoticeStore, type NavNotice } from './session-nav'
import { fontScaleCss, getFontRatio, subscribeFontRatio } from './font-axis'

/** 自动收起延迟（ms）。 */
const AUTO_HIDE_MS = 3600
/** 退场动画时长（ms）：与 PILL_CSS 的 dplToastOut 同源。 */
const OUT_MS = 240

/*
 * 字号跟随官方「设置 → 字号」（见 font-axis.ts）：提示条不参与 `--dps`
 * 「胶囊大小」缩放（独立浮层），但要跟官方字号轴——它挂在自己的
 * `shell.overlay` 槽位上，与胶囊并列而非其后代，所以 `--dpt` 得自己挂一份。
 */
const wrapStyle = (ratio: number): CSSProperties => ({
  position: 'fixed',
  left: '50%',
  bottom: 24,
  transform: 'translateX(-50%)',
  zIndex: 9500,
  display: 'flex',
  justifyContent: 'center',
  width: 'min(560px, calc(100vw - 32px))',
  pointerEvents: 'none',
  '--dpt': String(ratio),
} as CSSProperties)

const cardStyle = (leaving: boolean): CSSProperties => ({
  pointerEvents: 'auto',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  width: '100%',
  padding: '12px 12px 12px 14px',
  borderRadius: 14,
  border: '1px solid var(--dpl-panel-border)',
  background: 'var(--dpl-panel-bg)',
  color: 'var(--dpl-fg)',
  boxShadow: 'var(--dpl-panel-shadow)',
  fontSize: fontScaleCss(13),
  lineHeight: fontScaleCss(20),
  animation: leaving
    ? `dplToastOut ${OUT_MS}ms cubic-bezier(.4,0,1,1) forwards`
    : 'dplToastIn .34s cubic-bezier(.32,.72,0,1)',
})

/** 左侧语义竖条：错误态用暖赭色（与提醒芯片同源），信息态用墨色。 */
const barStyle = (kind: NavNotice['kind']): CSSProperties => ({
  flex: 'none',
  width: 3,
  alignSelf: 'stretch',
  borderRadius: 1.5,
  background: kind === 'error' ? 'var(--dpl-warn)' : 'var(--dpl-fg-dim)',
})

const iconStyle = (kind: NavNotice['kind']): CSSProperties => ({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 20,
  color: kind === 'error' ? 'var(--dpl-warn)' : 'var(--dpl-fg-dim)',
})

const textStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  wordBreak: 'break-word',
}

const closeStyle: CSSProperties = {
  flex: 'none',
  width: 22,
  height: 22,
  marginTop: -1,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--dpl-fg-weak)',
  fontSize: fontScaleCss(12),
  lineHeight: fontScaleCss(22),
  cursor: 'pointer',
}

/** 错误感叹号（圆环 + 竖点）：与胶囊同款单色线稿。 */
function WarnIcon(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <line x1="12" y1="16.5" x2="12" y2="16.6" />
    </svg>
  )
}

/** 信息圆点（i）：同款线稿。 */
function InfoIcon(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <line x1="12" y1="7.5" x2="12" y2="7.6" />
    </svg>
  )
}

/**
 * 跳转结果提示条。无提示时返回 null（不占位、不吃事件）。
 */
export function NavToast(): JSX.Element | null {
  const [notice, setNotice] = useState<NavNotice | null>(() => navNoticeStore.get())
  const [leaving, setLeaving] = useState(false)
  const [fontRatio, setFontRatio] = useState(() => getFontRatio())
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 悬停暂停：鼠标在条上时不自动收起（读屏/细看失败原因）。
  const hoveredRef = useRef(false)

  useEffect(() => subscribeFontRatio(() => { setFontRatio(getFontRatio()) }), [])

  const clearTimers = useCallback((): void => {
    if (hideTimer.current !== null) { clearTimeout(hideTimer.current); hideTimer.current = null }
    if (outTimer.current !== null) { clearTimeout(outTimer.current); outTimer.current = null }
  }, [])

  /** 播退场动画后再摘掉节点（先挂 leaving 类，动画结束清 store）。 */
  const startHide = useCallback((): void => {
    setLeaving(true)
    if (outTimer.current !== null) clearTimeout(outTimer.current)
    outTimer.current = setTimeout(() => {
      outTimer.current = null
      setLeaving(false)
      navNoticeStore.dismiss()
    }, OUT_MS)
  }, [])

  const scheduleHide = useCallback((): void => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      if (!hoveredRef.current) startHide()
    }, AUTO_HIDE_MS)
  }, [startHide])

  useEffect(() => navNoticeStore.subscribe((next) => {
    clearTimers()
    setLeaving(false)
    setNotice(next)
  }), [clearTimers])

  // 每条新提示重置自动收起计时（seq 变化即重新计时，同文案重复出现也重播）。
  useEffect(() => {
    if (notice === null) return
    scheduleHide()
    return clearTimers
  }, [notice, scheduleHide, clearTimers])

  useEffect(() => () => { clearTimers() }, [clearTimers])

  if (notice === null) return null

  return createPortal(
    <div className="dsh-done-pill" style={wrapStyle(fontRatio)} aria-live="polite">
      <div
        data-dpl-toast={notice.kind}
        style={cardStyle(leaving)}
        role={notice.kind === 'error' ? 'alert' : 'status'}
        onMouseEnter={() => { hoveredRef.current = true }}
        onMouseLeave={() => {
          hoveredRef.current = false
          // 悬停期间到点的提示在移开后立刻收（不再等一个完整周期）。
          if (hideTimer.current === null && !leaving) startHide()
        }}
      >
        <span style={barStyle(notice.kind)} aria-hidden />
        <span style={iconStyle(notice.kind)} aria-hidden>
          {notice.kind === 'error' ? <WarnIcon /> : <InfoIcon />}
        </span>
        <span style={textStyle}>{notice.text}</span>
        <button
          type="button"
          className="dsh-done-pill-close"
          style={closeStyle}
          aria-label="关闭提示"
          onClick={() => { clearTimers(); startHide() }}
        >
          ✕
        </button>
      </div>
    </div>,
    document.body,
  )
}
