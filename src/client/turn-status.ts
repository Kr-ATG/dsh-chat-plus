/**
 * dsh-chat-plus — 回合是否已收口的统一判据。
 *
 * 官方 `TurnLocation.status` 是**三态**：`'open'`（回合还在跑）/ `'closed'`（收到过
 * `turn/end`）/ `'unknown'`。第三态极易被忽略 —— 切换视图（对话 ↔ 轨迹 ↔ KR对话）
 * 会重挂载对话流，重放历史时未必重新投递 `turn/end`，于是**所有历史回合一起落进
 * `'unknown'`**。
 *
 * 早先各处都写成 `status === 'closed'`，结果用户切一次视图回来，左侧对话流里
 * 每一条 assistant 回复的总结卡集体消失、只剩正文（"卡片没了只剩下总结"）。
 * `'unknown'` 的语义是「没有活跃信号」，对呈现而言与 `'closed'` 等价，所以口径
 * 统一成「只要不是 open 就算收口」。
 */

/** 官方回合状态的三态之一（只用到 status，结构上放宽以便直接吃 TurnLocation）。 */
export type TurnStatusLike = { readonly status: 'open' | 'closed' | 'unknown' }

/**
 * 回合是否已结束（可以呈现总结卡 / 收起过程投影）。
 *
 * - `undefined`（拿不到回合定位）→ false，维持"不包卡"的保守表现；
 * - `'open'` → false；
 * - `'closed'` / `'unknown'` → true。
 */
export function isTurnSettled(turn: TurnStatusLike | undefined): boolean {
  return turn !== undefined && turn.status !== 'open'
}
