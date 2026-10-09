/**
 * dsh-chat-plus — 「子智能体」卡（右栏大盘里独立的一张）。
 *
 * ## 为什么单独一张卡
 *
 * 子智能体原先挂在「操作面板」某一步下面当一个缩进小块。那个位置有三个问题：
 *  1. 它是**独立会话**，不是那一步的子过程 —— 缩进读起来像"这一步内部的细节"，
 *     而事实是"这一步派出去几个独立干活的"；
 *  2. 操作面板是一列按时间读的流水，块一多就把流水截断成一段一段；
 *  3. 看不到全貌：同一轮派了两批，就是两个不相邻的小块。
 *
 * 现在它是自己的一张卡：**有几个子智能体就几行**，一行一个，点一行就跳过去看
 * 那个子会话（走官方 `uiWorkspace.openSession`，与官方目录里点一行同一条链路）。
 *
 * ## 一张卡只回答两件事
 *
 *  · **有几个、谁还在跑** —— 来自官方子智能体目录投影（见 subagent-catalog.ts）；
 *  · **点进去看它自己在干什么** —— 跳转，不在卡上编造子智能体内部的活动。
 *
 * 口径是**当前查看的这一轮对话**（2026-10-09 起，用户点名：会话口径下对话一多
 * 卡里堆十几行历史子智能体）：目录在 KrAgentPanel 里经 filterCatalogByTurn 按
 * 轮次窗口（catalog 条目自带 createdAt × 本轮 turnStart/turnEnd）过滤后才传进来，
 * 切到哪轮就看哪轮派出去的那几个；本轮没派 = 过滤后为空 = 整卡不渲染。
 *
 * 拿不到的信息一律空着：子智能体此刻在调什么工具、说了什么，client 侧没有这份
 * 数据（那是子会话的消息投影，只有点开才有）。这跟"假装它没在干活"是两件事。
 *
 * ## 什么时候不出现
 *
 * 这次会话一个子智能体都没有、本轮也没有派生动作时**整张卡不渲染** —— 任务 /
 * 操作面板 / 产出物三张卡是"这场对话一定有的东西"，子智能体不是；常驻一张空卡
 * 只会在右栏白占一行高度。真有派生动作但目录还没落地时给一行「正在读取」，
 * 那是**事实**（我们确实还没读到），不是「这次没有」（那是我们不知道的结论）。
 */

import { memo, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useHeightAnimation, useMotionAllowed } from '../motion-utils.ts'
import { formatDuration } from '../tool-summary/tool-stats.ts'
import { openSubagentSession, type SubagentCatalogView, type SubagentRow } from './subagent-catalog.ts'

/**
 * 默认露出的行数。
 *
 * 6 行 ≈ 6 × 26px = 156px，与「产出物」卡同一档：两张卡都可能一屏十几条，
 * 露太多就把上面的任务卡挤出视口。超出部分由底部「展开其余 N 个」承接。
 */
const MAX_VISIBLE = 6
/** 被右栏挤压时（记忆卡常驻底部触发自适应降档）收一档。 */
const MAX_VISIBLE_SQUEEZED = 4

/** 官方同款紧凑 token 计数（千 / 百万），只是不引它的 i18n。 */
function formatTokens(value: number): string {
  const scaled = (next: number): string => (next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10))
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1000)}k`
  return `${scaled(value / 1_000_000)}M`
}

/** 一行的悬停说明：拿得到的都写上，拿不到的不编。 */
function rowTitle(row: SubagentRow): string {
  const parts: string[] = [row.label]
  if (row.elapsedMs !== undefined) parts.push(`已跑 ${formatDuration(row.elapsedMs)}`)
  if (row.tokens !== undefined) parts.push(`${formatTokens(row.tokens)} tokens`)
  if (row.mode === 'continuable') parts.push('可续接')
  if (row.hasChildren) parts.push('它自己也派了子智能体')
  parts.push(row.running ? '进行中 · 点一下跳过去看' : '已结束 · 点一下跳过去看')
  return parts.join(' · ')
}

export interface KrSubagentsCardProps {
  /** 当前会话的子智能体目录（由 KrAgentPanel 单点订阅后传下来）。 */
  readonly catalog: SubagentCatalogView
  /**
   * 本轮时间线上是否存在「派出子任务」这一步。
   *
   * 只用来决定**目录还没落地时**要不要占一行「正在读取」：没有派生动作时
   * 空目录就是真的没有，整张卡不该出现。
   */
  readonly spawning: boolean
  /** 右栏是否已被挤压：露出的行数降一档。 */
  readonly squeezed?: boolean
}

/**
 * 一行子智能体。
 *
 * **整行是一个真 button**：这一行唯一能做的事就是"跳过去看它"，所以点这一行
 * 与点一个"跳转"按钮是同一件事，多挂一枚按钮只是把同一句话说了两遍，还让一列
 * 行里多出一列按钮。做成 button 还顺手解决了键盘与触屏：Tab 一次就到，
 * 回车即跳，触屏有 :active 反馈。
 */
function SubagentLine({ row, index, onOpen, failed }: {
  readonly row: SubagentRow
  readonly index: number
  readonly onOpen: (row: SubagentRow) => void
  /** 宿主没有跳转服务（旧版）：按钮仍在，但不做无反馈的假承诺。 */
  readonly failed: boolean
}): ReactElement {
  return (
    <div
      className="kr-subs-row"
      data-running={row.running ? 'true' : undefined}
      data-mode={row.mode}
      title={rowTitle(row)}
      // 错峰入场：与操作面板 / 产出物同一套节奏（新行从下方 6px 淡入），
      // 三张卡「有东西出现」读起来是一件事。
      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
    >
      <button
        type="button"
        className="kr-subs-row__main"
        aria-label={`打开子智能体 ${row.label}`}
        onClick={() => { onOpen(row) }}
      >
        {/* 状态点：跑着的用主色脉冲，结束的压成淡灰点。形状不承担状态，
            颜色 + 脉冲两重线索，色弱用户与灰度截图下也读得出。 */}
        <span className="kr-subs-row__dot" aria-hidden />
        <span className="kr-subs-row__label">{row.label}</span>
        {row.hasChildren && <span className="kr-subs-row__tag">还有下级</span>}
        {row.mode === 'continuable' && <span className="kr-subs-row__tag">可续接</span>}
        {/* 时长：进行中的行随轮询走秒（读数来自官方 subagentTiming 投影，
            拿不到就不渲染，绝不自己从"我看到它多久了"里凑一个数）。 */}
        {row.elapsedMs !== undefined && (
          <span className="kr-subs-row__time">{formatDuration(row.elapsedMs)}</span>
        )}
        <span className="kr-subs-row__state">{row.running ? '进行中' : '已结束'}</span>
        {/* 悬停浮现的跳转箭头：承担「这里能点」的提示，纯视觉、aria-hidden，
            不占按钮位、不进无障碍树（读屏用户听到的是整行的 aria-label）。 */}
        {!failed && (
          <span className="kr-subs-row__go" aria-hidden>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.4 8h9.2" />
              <path d="M9.2 4.6 12.6 8l-3.4 3.4" />
            </svg>
          </span>
        )}
      </button>
    </div>
  )
}

export const KrSubagentsCard = memo(function KrSubagentsCard({
  catalog,
  spawning,
  squeezed = false,
}: KrSubagentsCardProps) {
  // 默认展开：这张卡只在真有子智能体时出现，出现即是要看的东西。
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  /** 跳转失败（宿主没有 uiWorkspace）时的一枚短暂提示，避免"点了没反应"。 */
  const [blocked, setBlocked] = useState(false)
  const motion = useMotionAllowed(true)
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(open, motion)

  const rows = catalog.rows
  const maxRows = squeezed ? MAX_VISIBLE_SQUEEZED : MAX_VISIBLE
  const visible = useMemo(
    () => (showAll ? rows : rows.slice(0, maxRows)),
    [rows, showAll, maxRows],
  )
  const hiddenCount = rows.length - visible.length

  const onOpen = (row: SubagentRow): void => {
    if (openSubagentSession(row)) return
    setBlocked(true)
    window.setTimeout(() => { setBlocked(false) }, 2400)
  }

  /*
   * 什么时候整张卡不渲染。
   *
   * 判据是「有没有东西可说」，不是「state 是不是 ready」：
   *  · 有行 → 渲染（ready 是唯一能带出行的状态）；
   *  · 没行但本轮有派生动作 → 渲染一行「正在读取子智能体…」（目录还没落地）；
   *  · 其余 → null。这次会话确实没有子智能体，不该在右栏白占一行高度。
   */
  if (rows.length === 0 && !spawning) return null

  const meta = rows.length === 0
    ? '读取中'
    : catalog.runningCount > 0
      ? `${rows.length} 个 · ${catalog.runningCount} 个进行中`
      : `${rows.length} 个 · 全部结束`

  return (
    <div className="kr-card kr-card--subs" data-empty={rows.length === 0 || undefined}>
      <div
        className="kr-card__header"
        onClick={() => { setOpen((value) => !value) }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((value) => !value)
          }
        }}
      >
        <span className="kr-card__icon">
          {/*
           * 「派出去几个各自干活的」：一个主干分叉成两条支线，支线末端各有一个
           * 小节点。刻意避开与另外几张卡撞形 —— 任务概览是横向清单、操作面板是
           * 时间线、产出物是盒子、记忆是大脑。分叉是这里唯一诚实的图形语言。
           */}
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 2.4v3.1c0 1.2 1 2.2 2.2 2.2h5.6" />
            <path d="M3 13.6v-3.1c0-1.2 1-2.2 2.2-2.2h5.6" />
            <circle cx="3" cy="2.4" r="1.3" />
            <circle cx="3" cy="13.6" r="1.3" />
            <circle cx="12.4" cy="7.7" r="1.5" />
          </svg>
        </span>
        <span className="kr-card__title">子智能体</span>
        {blocked && <span className="kr-subs-blocked">当前宿主不支持跳转</span>}
        <span className="kr-card__meta">{meta}</span>
      </div>

      {bodyPresent && (
        <div
          ref={bodyRef}
          className="kr-subs-body"
          data-open={open || undefined}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          {rows.length === 0 ? (
            // 目录还没落地。**不能说"这次没有派生独立的子智能体"** —— 那是我们
            // 并不知道的结论，而上面操作面板里正摆着一条「派出子任务」。
            <div className="kr-subs-empty">
              {catalog.state === 'error' ? '子智能体清单读不到（会话服务未就绪）' : '正在读取子智能体…'}
            </div>
          ) : (
            <>
              <div className="kr-subs-list">
                {visible.map((row, index) => (
                  <SubagentLine key={row.id} row={row} index={index} onOpen={onOpen} failed={blocked} />
                ))}
              </div>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="kr-subs-more"
                  onClick={() => { setShowAll(true) }}
                >
                  <span>展开其余 {hiddenCount} 个</span>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m4.4 6.2 3.6 3.6 3.6-3.6" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
})
