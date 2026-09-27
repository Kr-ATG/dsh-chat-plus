/**
 * dsh-chat-plus — 对话流卡片外壳（client）。
 *
 * 两种卡（自 webui flow-card.tsx 移植）：
 *  - **步骤卡**（`variant="step"`）：回合中间的 assistant 片段，极轻量——只有
 *    一条左侧竖线 + 淡纱，用来在视觉上把「一步」圈起来，不抢主回复的注意力。
 *  - **总结卡**（`variant="reply"`）：回合最终回复，只留卡片外壳，正文用官方
 *    MarkdownText 渲染（流式期不包卡，见 thinking/ThinkingStepNodeView）。
 *
 * 头部的「完成徽章 + 用时 / 步骤 / Git 统计 chip」整行已按用户要求移除：
 * 收尾装饰压在正文上方会让人误以为那段数字是内容的一部分，统计类信息改由
 * KR 右侧大盘承接（面板有独立常驻入口，不依赖卡片头部）。
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
