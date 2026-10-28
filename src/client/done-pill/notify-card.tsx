/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 页内完成提醒卡（client 半身）。
 *
 * 系统通知发不出去时的兜底（权限被拒 / 壳内策略拦截且 host 不可达），也作为
 * 「通知中心之外的可见反馈」常驻：右下角堆叠、从下方滑入 + 缩放，6 秒自动
 * 收起（悬停暂停），点卡片跳进对应会话。
 *
 * 挂载在 `shell.overlay#dsh-done-pill-notify`（与胶囊同槽位，无会话时也在）。
 * 配色走 pill.tsx 注入的 --dpl-* 变量（深浅主题自适应），动画走 PILL_CSS 的
 * `dplNoticeIn` / `dplNoticeOut`（用户偏好动效，不是静态弹出）。
 *
 * 与 nav-toast.tsx 的分工：提示条报**跳转失败**（信息/错误，居中底部），本卡报
 * **任务完成**（成功语义，右下堆叠）。两者样式语言一致但位置与语义不同。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { notifyCardStore, type NotifyCard } from './notify-center'
import { openSessionById } from './session-nav'
import { fontScaleCss, getFontRatio, subscribeFontRatio } from './font-axis'

/** 自动收起延迟（ms）：比提示条长——完成提醒值得多看一眼。 */
const AUTO_HIDE_MS = 6000
/** 退场动画时长（ms）：与 PILL_CSS 的 dplNoticeOut 同源。 */
const OUT_MS = 260

/*
 * 字号跟随官方「设置 → 字号」（见 font-axis.ts）。
 *
 * 这张卡不参与 `--dps`「胶囊大小」缩放（它是独立浮层，不该被胶囊滑块改变大小），
 * 但要跟随官方字号轴：它是成段文字（会话标题 + 摘要），字号设置调大而它钉在
 * 13px，读起来就是两块不搭的字。
 *
 * `--dpt` 变量由外壳容器注入这里——从 `shell.overlay` 往下都是它的作用域，
 * 但本组件挂在**自己的** overlay 槽位上（与胶囊并列、不是它的后代），
 * 所以得自己挂一份（`wrapStyle` 上）。
 */

const wrapStyle = (ratio: number): CSSProperties => ({
  position: 'fixed',
  right: 20,
  bottom: 20,
  zIndex: 9500,
  display: 'flex',
  flexDirection: 'column-reverse',
  gap: 10,
  width: 'min(360px, calc(100vw - 32px))',
  pointerEvents: 'none',
  // 本组件挂在自己的 overlay 槽位（与胶囊并列），拿不到胶囊上的 --dpt，自己挂一份。
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
  cursor: 'pointer',
  textAlign: 'left',
  animation: leaving
    ? `dplNoticeOut ${OUT_MS}ms cubic-bezier(.4,0,1,1) forwards`
    : 'dplNoticeIn .38s cubic-bezier(.32,.72,0,1)',
})

/** 左侧语义竖条：出错用暖赭色，正常完成用墨色（与提示条同一套语义色）。 */
const barStyle = (failed: boolean): CSSProperties => ({
  flex: 'none',
  width: 3,
  alignSelf: 'stretch',
  borderRadius: 1.5,
  background: failed ? 'var(--dpl-warn)' : 'var(--dpl-ok)',
})

const iconStyle = (failed: boolean): CSSProperties => ({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 20,
  color: failed ? 'var(--dpl-warn)' : 'var(--dpl-ok)',
})

const bodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const titleStyle: CSSProperties = {
  fontSize: fontScaleCss(13),
  fontWeight: 550,
  lineHeight: fontScaleCss(19),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const textStyle: CSSProperties = {
  fontSize: fontScaleCss(12),
  lineHeight: fontScaleCss(18),
  color: 'var(--dpl-fg-dim)',
  wordBreak: 'break-word',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
}

const metaStyle: CSSProperties = {
  fontSize: fontScaleCss(11),
  lineHeight: fontScaleCss(16),
  color: 'var(--dpl-fg-weak)',
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

/** 完成勾（圆环 + 对勾）：与胶囊同款单色线稿。 */
function CheckIcon(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.4l2.6 2.6L16 9.6" />
    </svg>
  )
}

/** 出错感叹号（与提示条同款）。 */
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

/** 单张卡：自己管自动收起与退场。 */
function NoticeCardView(props: {
  card: NotifyCard
  onDismiss: (seq: number) => void
}): JSX.Element {
  const { card, onDismiss } = props
  const [leaving, setLeaving] = useState(false)
  const hoveredRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback((): void => {
    if (hideTimer.current !== null) { clearTimeout(hideTimer.current); hideTimer.current = null }
    if (outTimer.current !== null) { clearTimeout(outTimer.current); outTimer.current = null }
  }, [])

  /** 播退场动画后再摘节点（先挂 leaving，动画结束再从 store 移除）。 */
  const startHide = useCallback((): void => {
    setLeaving(true)
    if (outTimer.current !== null) clearTimeout(outTimer.current)
    outTimer.current = setTimeout(() => {
      outTimer.current = null
      onDismiss(card.seq)
    }, OUT_MS)
  }, [card.seq, onDismiss])

  const scheduleHide = useCallback((): void => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      if (!hoveredRef.current) startHide()
    }, AUTO_HIDE_MS)
  }, [startHide])

  useEffect(() => {
    scheduleHide()
    return clearTimers
  }, [scheduleHide, clearTimers])

  useEffect(() => () => { clearTimers() }, [clearTimers])

  const activate = useCallback((): void => {
    clearTimers()
    const outcome = openSessionById(card.sessionId)
    // 失败不收起：提示条会说明原因，卡留着让用户再点一次。
    if (outcome.ok) onDismiss(card.seq)
  }, [card.sessionId, card.seq, clearTimers, onDismiss])

  return (
    <div
      data-dpl-notice={card.failed ? 'error' : 'done'}
      role="status"
      aria-live="polite"
      tabIndex={0}
      style={cardStyle(leaving)}
      onMouseEnter={() => { hoveredRef.current = true }}
      onMouseLeave={() => {
        hoveredRef.current = false
        // 悬停期间到点的卡在移开后立刻收（不再等一个完整周期）。
        if (hideTimer.current === null && !leaving) startHide()
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate()
        }
      }}
    >
      <span style={barStyle(card.failed)} aria-hidden />
      <span style={iconStyle(card.failed)} aria-hidden>
        {card.failed ? <WarnIcon /> : <CheckIcon />}
      </span>
      <span style={bodyStyle}>
        <span style={titleStyle} title={card.title}>
          {card.failed ? `任务出错 · ${card.title}` : `任务完成 · ${card.title}`}
        </span>
        <span style={textStyle}>{card.text}</span>
        {card.meta !== '' && <span style={metaStyle}>{card.meta}</span>}
      </span>
      <button
        type="button"
        className="dsh-done-pill-close"
        style={closeStyle}
        aria-label="关闭提醒"
        onClick={(event) => {
          event.stopPropagation()
          clearTimers()
          startHide()
        }}
      >
        ✕
      </button>
    </div>
  )
}

/**
 * 页内完成提醒卡容器。无卡时返回 null（不占位、不吃事件）。
 */
export function NotifyCards(): JSX.Element | null {
  const [cards, setCards] = useState<NotifyCard[]>(() => notifyCardStore.list())
  const [fontRatio, setFontRatio] = useState(() => getFontRatio())

  useEffect(() => notifyCardStore.subscribe(setCards), [])
  useEffect(() => subscribeFontRatio(() => { setFontRatio(getFontRatio()) }), [])

  const dismiss = useCallback((seq: number): void => { notifyCardStore.dismiss(seq) }, [])

  if (cards.length === 0) return null

  return createPortal(
    <div className="dsh-done-pill" style={wrapStyle(fontRatio)}>
      {cards.map(card => (
        <NoticeCardView key={card.seq} card={card} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  )
}
