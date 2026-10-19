/**
 * dsh-chat-plus — 14px 圆圈状态图标（三态族）。
 *
 * 目前只有「任务概览」卡在用（已完成 / 进行中 / 待办）。「操作面板」卡原先也用
 * 同一份，但它那一列里的每条都已经发生过了，三态圆圈有 99% 的行是空盒——那枚
 * 空槽已随行首布局一起删除，失败改由类别图标右上角的红点角标承担（见
 * styles.ts 的 .kr-plain-step__icon[data-failed]）。
 *
 * 三态与任务概览原样：
 *   · 已完成 —— 实线圆 + 实心对勾；
 *   · 进行中 —— 淡轨道 + 圆头弧绕行并伸缩呼吸（见下 running 分支的注释）；
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

/*
 * 状态 → 徽标配色。空值让外层容器的 color 说话（各卡自定）。
 *
 * 三态只靠**亮度**分级，不用彩色（2026-10-19 按用户要求去掉蓝色）：
 *   running 最亮 → done 中间 → pending 最暗，读作「越亮越靠前」。
 *
 * 为什么不用品牌蓝：大盘里蓝色是「可点的主行动」（按钮 / 链接 / 可跳转行）的
 * 语义。一列任务里同时挂着「点这里」和「这里正在跑」，两者同色就互相稀释；
 * 而且一列里通常只有一行在进行中，那点蓝在整个右栏里孤零零地跳，比状态本身
 * 更抢眼。红色（failed）保留 —— 那是错误语义，不是装饰。
 */
const TONE: Record<StatusIconState, string | undefined> = {
  pending: 'var(--dsw-alias-label-tertiary, #86909c)',
  running: 'var(--dsw-alias-label-primary, #1f2329)',
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
    /*
     * 一枚圆头弧在淡轨道上绕行 + 伸缩呼吸，取代原来「整圈虚线匀速转」。
     *
     * 旧的转法在 14px 上有两处硬伤，都会读成「卡」：
     *   1. strokeDasharray="7 7" 的周期是 14px，而 r=6.2 的周长 38.96px 并不
     *      是 14 的整数倍（2.783 个周期）—— 每转完一圈，虚线段都要在起点处错开
     *      10.96px 重新接上。接缝每 1.2s 抖一次，这就是「不流畅」的物理来源。
     *      现在用 pathLength=100 把周长归一化，dash 直接按百分比写，误差归零。
     *   2. 整圈等长虚线里没有主次，视线找不到可以跟随的点。换成一枚 26% 周长
     *      的实体弧，运动有了明确主体（iOS / Material 的 indeterminate 语汇）。
     *
     * 旋转必须 linear（匀速）—— 变速会让「在转」读成「在顿」。弧长呼吸走
     * ease-in-out，两者同周期 1.6s：一个周期里「跑完一圈 + 收放一次」，是一个
     * 动作而不是两个节拍打架（旧实现与行内竖条 2.2s 呼吸互质，越看越乱）。
     */
    return (
      <svg {...FRAME} style={style} aria-hidden="true">
        <circle className="kr-status-ring__track" cx="7" cy="7" r="6.2" />
        <circle
          className="kr-status-ring__arc"
          cx="7"
          cy="7"
          r="6.2"
          pathLength={100}
          strokeDasharray="26 100"
          strokeLinecap="round"
        />
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
