/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 运行态笔画与状态色（client 半身叶子模块）。
 *
 * 移植自 dsh-notch 的原生 `StatusOrbit`（macos/Sources/StatusOrbit.swift）：
 * 运行中的指示不是「转圈 spinner」，而是一段**带笔尖的短笔画**在半径 9.5 的
 * 圆上匀速走——蓝色描边、圆头线帽、占圆周 70%，角速度恒为 2π/3 rad/s
 * （`DecisionSpin.runningVelocity`），即一圈 3 秒。数字压在笔画中心的实心圆上。
 *
 * 与旧实现的差别：旧版用 `conic-gradient` 做渐隐环（颜色有淡出、看着发虚）；
 * 上游是**等宽实色笔画**，靠「短 + 匀速」表达进行中，读数更清楚。
 *
 * 颜色取自上游 `NotchTokens` 与 `StatusOutcome.rgb`：
 *   deepSeekBlue (0.302,0.420,0.996) → #4d6bfe   运行中
 *   greenComplete(0.204,0.780,0.349) → #34c759   成功（Apple systemGreen）
 *   redFail      (1.000,0.251,0.000) → #ff4000   失败
 *   amber        (0.949,1.000,0.078) → #f2ff14   待决定
 */

/** 上游 NotchTokens / StatusOutcome 的等价 RGB（0-255）。 */
export const STATUS_INK = {
  running: '#4d6bfe',
  success: '#34c759',
  failure: '#ff4000',
  decision: '#f2ff14',
} as const

/** 笔画占圆周的比例：上游 `Circle().trim(from: 0, to: 0.70)`。 */
export const RUNNING_ARC_SPAN = 0.7

/** 运行态角速度：上游 `DecisionSpin.runningVelocity = 2π/3`（rad/s）→ 一圈 3 秒。 */
export const RUNNING_VELOCITY = (2 * Math.PI) / 3
export const RUNNING_PERIOD_SECONDS = (2 * Math.PI) / RUNNING_VELOCITY

/**
 * 运行中笔画：一段静态的 70% 圆弧，由 CSS 动画整体旋转。
 *
 * 之所以用 SVG 而不是 conic-gradient：需要**圆头线帽**（`stroke-linecap:round`）
 * 才能复刻上游「一笔」的观感，而 conic-gradient 画不出圆头端点。
 */
export function RunningArc({ size = 15, ink = STATUS_INK.running }: {
  size?: number
  ink?: string
}): JSX.Element {
  // 以 (10,10) 为圆心、半径 9.5 的圆周，留 0.5 线宽的余量。
  const r = 9.5
  const c = 10
  const circumference = 2 * Math.PI * r
  return (
    <svg
      className="dpl-run-arc"
      width={size} height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      style={{ flex: 'none', overflow: 'visible' }}
    >
      <circle
        cx={c} cy={c} r={r}
        stroke={ink}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={`${circumference * RUNNING_ARC_SPAN} ${circumference}`}
        // 起点朝上（-90°），与上游 rotate(angle) 从 12 点开始一致。
        transform={`rotate(-90 ${c} ${c})`}
      />
    </svg>
  )
}
