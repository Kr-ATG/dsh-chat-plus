/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 录屏按钮（client 半身）。
 *
 * 两种胶囊形态共用（悬浮 pill / 左下角卡片 wide），三态渲染：
 *  - idle：镜头图标，hover 背景浮现 + 轻微放大；
 *  - recording：红点呼吸光环（dplRecPulse）+ m:ss 计时（key 变化重挂载淡入），
 *    图标切成停止方块；
 *  - encoding：旋转 spinner（dplRecSpin），禁用点击。
 *
 * 样式钩子类名（.dpl-rec-btn 及 data-state）挂在 pill.tsx 的 PILL_CSS 上，
 * 配色走 --dpl-* 变量随深浅主题；本组件只管几何与结构。
 * 动画定义在 PILL_CSS（cssRevision 指纹机制自动换表，升级无残留）。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { recorder, recSupported, recBlockedByPolicy, type RecSnapshot } from './recorder'
import { formatRecDuration, type RecState } from './rec-core'
import { fontScaleCss } from './font-axis'

/** 尺寸变体：float = 悬浮胶囊内；card = 左下角小横条旁。 */
export type RecButtonVariant = 'float' | 'card'

interface RecButtonProps {
  variant: RecButtonVariant
  /** 悬浮胶囊的缩放系数（--dps 已含，card 变体传 1）。 */
  scale?: number
}

/** 现在能不能录（能力 + 策略双闸门）。壳内 iframe 被 policy 拦时禁用。 */
export function recAvailable(): boolean {
  return recSupported() && !recBlockedByPolicy()
}

function unavailableTitle(): string {
  if (!recSupported()) return '当前浏览器不支持录屏（需要 getDisplayMedia）'
  return '壳内环境不支持录屏（display-capture 被 Permissions Policy 拦截）'
}

/** 待机镜头图标：圆点 + 取景框（单色线稿，随 currentColor）。 */
function LensIcon(props: { size: number }): JSX.Element {
  const s = props.size
  return (
    <svg
      width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ flex: 'none' }}
    >
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 13.5 5 3.2a.6.6 0 0 0 .9-.5V7.8a.6.6 0 0 0-.9-.5l-5 3.2Z" />
    </svg>
  )
}

/** 停止方块（录制中图标）。 */
function StopIcon(props: { size: number }): JSX.Element {
  const s = Math.round(props.size * 0.5)
  return <span className="dpl-rec-stop" style={{ width: s, height: s }} aria-hidden />
}

/** 编码 spinner。 */
function SpinIcon(props: { size: number }): JSX.Element {
  const s = props.size
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden style={{ flex: 'none' }}>
      <circle
        cx="12" cy="12" r="9" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" strokeDasharray="42 14" opacity="0.85"
      />
    </svg>
  )
}

/** 订阅录制状态 + 每秒计时（录制中才起 interval）。 */
function useRecorder(): [RecSnapshot, string] {
  const [snap, setSnap] = useState<RecSnapshot>(() => recorder.get())
  useEffect(() => recorder.subscribe(setSnap), [])
  const [, force] = useState(0)
  useEffect(() => {
    if (snap.state !== 'recording') return undefined
    const timer = window.setInterval(() => { force((n) => n + 1) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [snap.state])
  const clock = snap.state === 'recording'
    ? formatRecDuration(Date.now() - snap.since)
    : ''
  return [snap, clock]
}

/** 按钮几何（两种形态同源，尺寸随变体）。 */
const btnStyle = (variant: RecButtonVariant, scale: number): CSSProperties => {
  const h = variant === 'float' ? Math.round(24 * scale) : 22
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: h,
    padding: variant === 'float' ? '0 calc(9px * var(--dps))' : '0 8px',
    border: 'none',
    borderRadius: 999,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: 'inherit',
    fontWeight: 500,
    lineHeight: 1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  }
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flex: 'none',
  // 芯片出现在录屏选择面板头部（portal 节点，自带 --dpt），跟随官方字号轴。
  fontSize: fontScaleCss(12),
  lineHeight: fontScaleCss(18),
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
}

/**
 * 录制状态芯片（弹窗面板头部用）：仅 recording/encoding 时渲染。
 * 录制中 = 红点脉冲 + m:ss + 帧数；编码中 = 旋转 spinner + 「生成 GIF…」。
 */
export function RecStatusChip(): JSX.Element | null {
  const [snap, clock] = useRecorder()
  if (snap.state === 'idle') return null
  if (snap.state === 'encoding') {
    return (
      <span className="dpl-rec-chip" style={{ ...chipStyle, color: 'var(--dpl-fg-dim)' }} title="正在编码 GIF">
        <span className="dpl-rec-chip-spin"><SpinIcon size={12} /></span>        生成 GIF…
      </span>
    )
  }
  const chipTitle = `录制中（${snap.frames} 帧）— 点胶囊上的录屏按钮停止并保存`
  return (
    <span className="dpl-rec-chip" style={{ ...chipStyle, color: '#e5484d' }} title={chipTitle}>
      <span className="dpl-rec-chip-dot" aria-hidden />
      {clock}
    </span>
  )
}
/**
 * 录屏按钮。注意：**不自带 onClick 触发 toggle 之外的事件语义**——
 * 悬浮胶囊里点击分发由 wrap 的 pointerup zone 机制处理（data-dp-zone="rec"，
 * 见 pill.tsx）；卡片形态里按钮独立于 dpp-bar，直接 onClick。
 */
export function RecButton(props: RecButtonProps): JSX.Element | null {
  const variant = props.variant
  const scale = props.scale ?? 1
  const [snap, clock] = useRecorder()
  const state: RecState = snap.state
  const available = recAvailable()

  if (!recSupported()) return null

  const iconSize = variant === 'float' ? Math.max(12, Math.round(14 * scale)) : 13
  const label = state === 'recording'
    ? clock
    : state === 'encoding'
      ? '生成中…'
      : '录屏'
  const title = !available
    ? unavailableTitle()
    : state === 'recording'
      ? `录制中 ${clock}（${snap.frames} 帧）— 点击停止并保存 GIF`
      : state === 'encoding'
        ? '正在生成 GIF…'
        : '录屏（GIF）— 点击开始，再点停止并自动下载'

  return (
    <button
      type="button"
      className="dpl-rec-btn"
      data-state={state}
      data-dp-zone="rec"
      aria-label={title}
      title={title}
      disabled={state === 'encoding' || !available}
      style={btnStyle(variant, scale)}
      onClick={(event) => {
        // 悬浮形态的点击由 wrap pointerup 分发，这里吞掉原生 click 防双触发；
        // 卡片形态按钮不在拖拽 wrap 内，直接生效。
        if (variant === 'float') { event.stopPropagation(); return }
        event.stopPropagation()
        recorder.toggle()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        // 键盘可达：悬浮形态 pointerup 不会触发，这里补上。
        if (variant === 'float' && !available) return
        event.preventDefault()
        event.stopPropagation()
        recorder.toggle()
      }}
    >
      <span className="dpl-rec-icon" aria-hidden>
        {/* 录制中：停止方块 + CSS 脉冲光环（.dpl-rec-icon::before，见 PILL_CSS） */}
        {state === 'recording'
          ? <StopIcon size={iconSize + 4} />
          : state === 'encoding'
            ? <SpinIcon size={iconSize} />
            : <LensIcon size={iconSize} />}
      </span>
      {state === 'idle' && variant === 'card' ? null : (
        <span className="dpl-rec-label" key={state === 'recording' ? clock : state}>{label}</span>
      )}
    </button>
  )
}
