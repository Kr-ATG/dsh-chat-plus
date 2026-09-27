/**
 * dsh-chat-plus — 右栏卡片的统一状态图标（14px 圆圈族）。
 *
 * 任务概览与操作面板共用同一份实现，两边必须**长成一模一样**：同一枚圆圈、
 * 同一套线宽、同一个旋转节奏。此前是操作面板自己一套（绿勾 + 描边生长动画 +
 * 12px 无外圈），任务概览另一套（14px 圆圈 + 实心对勾），两行并排时像两个产品。
 *
 * 三态与任务概览原样：
 *   · 已完成 —— 实线圆 + 实心对勾；
 *   · 进行中 —— 虚线圆环（顺时针匀速转）；
 *   · 失败   —— 错误色圆环 + 叉。
 * 另留 pending（点线圆环）给需要三态以外的场合。
 */

import type { ReactElement } from 'react'

export type StatusIconState = 'pending' | 'running' | 'done' | 'failed'

/** 14px 圆圈族：viewBox 14、圆半径 6.2、描边 1.2，与任务概览原规格一致。 */
const FRAME = {
  width: 14,
  height: 14,
  viewBox: '0 0 14 14',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
} as const

/** 状态 → 徽标配色。空值让外层容器的 color 说话（各卡自定）。 */
const TONE: Record<StatusIconState, string | undefined> = {
  pending: 'var(--dsw-alias-label-tertiary, #86909c)',
  running: 'var(--dsw-alias-state-business-primary, #4176e6)',
  done: 'var(--dsw-alias-label-secondary, #5b6068)',
  failed: 'var(--dsw-alias-state-error-primary, #ef4444)',
}

export function StatusIcon({ state }: { readonly state: StatusIconState }): ReactElement {
  const color = TONE[state]
  const style = color === undefined ? undefined : { color }
  if (state === 'done') {
    return (
      <svg {...FRAME} style={style} aria-hidden="true">
        <circle cx="7" cy="7" r="6.2" />
        <path
          d="M10.963 5.714 7.702 8.976c-.222.221-.424.425-.61.574-.194.157-.429.303-.728.35a1.29 1.29 0 0 1-.479 0c-.3-.047-.534-.193-.729-.35-.185-.149-.387-.353-.61-.574L3.035 7.464l.928-.928 1.512 1.512c.242.242.387.386.504.48.107.086.13.079.111.076.045.007.091.007.136 0-.019.003.004-.004.111-.076.117-.094.262-.238.504-.48l3.262-3.262.928.928z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    )
  }
  if (state === 'running') {
    return (
      <svg {...FRAME} style={{ ...style, animation: 'kr-spin 1.2s linear infinite' }} aria-hidden="true">
        <circle cx="7" cy="7" r="6.2" strokeDasharray="7 7" />
      </svg>
    )
  }
  if (state === 'failed') {
    return (
      <svg {...FRAME} style={style} aria-hidden="true">
        <circle cx="7" cy="7" r="6.2" />
        <path d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg {...FRAME} style={style} aria-hidden="true">
      <circle cx="7" cy="7" r="6.2" strokeDasharray="2.4 2.4" />
    </svg>
  )
}
