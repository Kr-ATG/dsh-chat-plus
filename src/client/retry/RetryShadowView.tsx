/**
 * dsh-chat-plus — model-retry 行影子（官方重试提示行同款）。
 *
 * 官方 `conversation.chat.node / model-retry`（RetryNodeView）在流式期显示
 * 「已重试模型请求（1/5）· 1s」等多行；出总结卡（回合 closed）后这些行还
 * 留在总结卡上方，看着像没收尾的碎行。用户要求：出总结时把它们隐藏掉。
 *
 * 实现：同 priority -100 接管该 keyed 槽位——
 * - 回合已结束（location.turn.status === 'closed'，即总结卡已挂载）→
 *   直接返回 null（空槽位被既有 `[data-chat-flow-key]:has(> [data-slot]:empty)`
 *   规则折叠，不留空白条）；
 * - 回合进行中 → 按官方 ModelRetryItem 同逻辑渲染（同 locale 文案、倒计时、
 *   details 展开），视觉与官方逐项一致，只是类名前缀换成 dtt__retry。
 */

import { memo, useEffect, useMemo, useState } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: activates the ui-chat SlotMap augmentation so ChatNodeViewProps
// resolves the 'model-retry' keyed share.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { isTurnSettled } from '../turn-status.ts'

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000))
}

function failureMessage(message: string, code: string | undefined, t: ChatNodeViewProps<'model-retry'>['t']): string {
  return code === 'AUTH' ? t('message.failure.auth') : message
}

/** 单条重试链（官方 ModelRetryItem 同款逻辑，类名换前缀）。 */
const RetryItem = memo(function RetryItem({ node, active, t }: {
  readonly node: {
    readonly seq: number
    readonly delayMs: number
    readonly mode: 'normal' | 'always'
    readonly maxRetries?: number | undefined
    readonly retry: number
    readonly retryState: 'scheduled' | 'started' | 'cancelled'
    readonly failure: { readonly message: string; readonly code?: string | undefined }
  }
  readonly active: boolean
  readonly t: ChatNodeViewProps<'model-retry'>['t']
}) {
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries as number : '∞'
  const [countdown, setCountdown] = useState(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())
  useEffect(() => {
    if (!active) return undefined
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => current.deadline === deadline && current.seconds === next
        ? current
        : { deadline, seconds: next })
      return next
    }
    if (updateCountdown() === 1) return undefined
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])
  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds
  return (
    <details className="dtt__retry-row" data-active={active || undefined}>
      <summary className="dtt__retry-summary">
        <span className="dtt__retry-text" role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className="dtt__retry-details">
        <div>
          <span className="dtt__retry-detail-label">{t('message.retry.delay')}</span>
          {t('duration.milliseconds', { milliseconds: Math.round(node.delayMs) })}
        </div>
        <div>
          <span className="dtt__retry-detail-label">{t('message.retry.failure')}</span>
          {failureMessage(node.failure.message, node.failure.code, t)}
        </div>
      </div>
    </details>
  )
})

/** 出总结（回合 closed）即隐藏，否则按官方同款渲染。 */
export const RetryShadowView = memo(function RetryShadowView(props: ChatNodeViewProps<'model-retry'>) {
  const { node, t } = props
  const loc = node.location as
    | { readonly kind?: string; readonly turn?: { readonly status?: string } }
    | undefined
  const closed = loc !== undefined
    && (loc.kind === 'turn' || loc.kind === 'step')
    // 走 isTurnSettled 而非 `=== 'closed'`：切视图后历史回合会落进 'unknown'，
    // 那时重试行也该收起来，否则它们会一直挂在总结卡上方。
    && isTurnSettled(loc.turn as { readonly status: 'open' | 'closed' | 'unknown' } | undefined)
  if (closed === true) return null
  const data = node.data
  return (
    <RetryItem
      node={data.current}
      active={data.current.retryState === 'scheduled'}
      t={t}
    />
  )
})
