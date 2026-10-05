/**
 * dsh-chat-plus — 对话流卡片外壳（client）。
 *
 * 两种卡（自 webui flow-card.tsx 移植）：
 *  - **步骤卡**（`variant="step"`）：回合中间的 assistant 片段，极轻量——只有
 *    一条左侧竖线 + 淡纱，用来在视觉上把「一步」圈起来，不抢主回复的注意力。
 *  - **总结卡**（`variant="reply"`）：回合最终回复，只留卡片外壳，正文用官方
 *    MarkdownText 渲染（流式期不包卡，见 thinking/ThinkingStepNodeView）。
 *
 * 头部的「完成徽章 + 用时 / 步骤 / Git 统计 chip」整行早已按用户要求移除：
 * 收尾装饰压在正文上方会让人误以为那段数字是内容的一部分。
 *
 * **用时不在总结卡里**（用户 2026-10-05 两轮口径的最终结论：「给总结卡加个用时」
 * ——「用官方的」——「不要放总结里，就用官方的那种」）。官方那条
 * 「已完成，用时 13分14秒」是**回合过程行**（turn-process），它就长在总结卡上方
 * 的位置上；插件该做的是把那条行还给官方，而不是在总结卡头部仿造一句话。
 * 仿造件（dtt__card-elapsed / useTurnElapsed / formatOfficialElapsed）已整块删除，
 * 现在只有官方组件渲染这一个读数（见 kr-chat/styles.ts 里的放行规则）。
 */
import type { ReactNode } from 'react'

/** 卡片外壳：step 轻量、reply 带总结外壳。 */
export function FlowCard({ variant, interrupted, children }: {
  readonly variant: 'step' | 'reply'
  readonly interrupted?: boolean | undefined
  readonly children: ReactNode
}): JSX.Element {
  if (variant === 'step') {
    return <div className="dtt__card dtt__card--step">{children}</div>
  }
  return (
    <div
      className="dtt__card dtt__card--reply"
      data-interrupted={interrupted === true ? '' : undefined}
    >
      <div className="dtt__card-body">{children}</div>
    </div>
  )
}
