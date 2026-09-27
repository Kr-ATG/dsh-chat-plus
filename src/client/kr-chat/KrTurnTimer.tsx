/**
 * dsh-chat-plus — 右栏 footer 的「用时」细行（记忆卡上方）。
 *
 * 显示的是**这一轮**从开始到现在的用时：运行中逐秒走，回合结束后定格。
 * 位置钉在记忆卡正上方，两者在同一个 footer（.kr-panel__memory-dock）里。
 *
 * 三条克制：
 *  1. **只显示真实测到的值**。拿不到生命周期起点（turnStart）就整行不渲染，
 *     绝不拿「工具数 × 800ms + 1500ms」那种兜底猜测去冒充用时——用户看到的
 *     每个数字都得站得住。
 *  2. **数字不做显影动画**。用时是持续变化的读数，不是「新内容到达」：每秒
 *     播一次淡入/擦除等于每秒提醒一次「变了」，比不动更躁。等宽数字
 *     （tabular-nums）保证位数变化时宽度不跳，这就够了。
 *  3. **动效只给状态不给数字**：运行中标签右侧那颗呼吸点表达「还在跑」，
 *     回合结束它熄灭、字色转三级，一眼能分清这行是活的还是已定格。
 */

import { memo } from 'react'

export interface KrTurnTimerProps {
  /** 已格式化的用时文本（如「1m 23s」）。 */
  readonly text: string
  /** 本轮是否仍在执行。 */
  readonly running: boolean
}

export const KrTurnTimer = memo(function KrTurnTimer({
  text,
  running,
}: KrTurnTimerProps) {
  return (
    <div
      className="kr-turn-timer"
      data-running={running ? 'true' : undefined}
      role="status"
      aria-label={`本轮用时 ${text}${running ? '，仍在执行' : ''}`}
    >
      <span className="kr-turn-timer__icon" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8.6" r="5.4" />
          <path d="M8 5.8v2.8l1.9 1.1M6 1.9h4" />
        </svg>
      </span>
      <span className="kr-turn-timer__label">用时</span>
      <span className="kr-turn-timer__value">{text}</span>
      {running && <span className="kr-turn-timer__dot" aria-hidden />}
    </div>
  )
})
