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
 * 口径是**整场会话**（2026-10-23 用户点名「一个会话里的子代理卡片不要根据对话
 * 区分了」，撤销了 2026-10-09 那版按轮次窗口裁剪的做法）：这个会话派生过的子
 * 智能体一个不落地都在卡上，与「产出物」卡同一粒度。
 *
 * 撤销的理由：子智能体是**独立会话**，不是某一轮的子步骤。按轮次裁剪时，上一轮
 * 派出去、到现在还在跑的那几个会在切到新一轮后从卡上消失 —— 而「谁还在跑」正是
 * 这张卡存在的理由，行数爆炸改由下面的进行中 / 已结束折叠与「展开其余 N 个」承担。
 *
 * 拿不到的信息一律空着：子智能体此刻在调什么工具、说了什么，client 侧没有这份
 * 数据（那是子会话的消息投影，只有点开才有）。这跟"假装它没在干活"是两件事。
 *
 * ## 什么时候不出现
 *
 * 这次会话一个子智能体都没有、也从没派生过时**整张卡不渲染** —— 任务 /
 * 操作面板 / 产出物三张卡是"这场对话一定有的东西"，子智能体不是；常驻一张空卡
 * 只会在右栏白占一行高度。真有派生动作但目录还没落地时给一行「正在读取」，
 * 那是**事实**（我们确实还没读到），不是「这次没有」（那是我们不知道的结论）。
 *
 * ## 两段分区 + 各自的段标题（2026-10-23 第二轮）
 *
 * 用户点名「已经完工的也可以放 Show more」，形态对齐 Claude 桌面端那张后台任务
 * 面板：**进行中摊在上面，已结束收在下面**，点一下才展开。折叠的是「结束的那一堆」
 * 而不是列表尾巴 —— 结束的行不再变化，摊在上面会把还在跑的那两行一路挤到卡底，
 * 而这张卡存在的意义恰恰是"谁还在跑"。
 *
 * **为什么又改一轮**：第一版只有行内那颗 6px 点和「进行中 / 已结束」一个词来分状态，
 * 用户在真实右栏里看不出区别（他原话：「正在执行和已结束看不出来，不明显」）。
 * 现在两段的区别由**结构**承担，而不是靠一颗点的深浅：
 *
 *  · **段标题**：「正在执行 2」是主色 + 呼吸点的小标题；「已完成 2」是一条带对勾
 *    的整块折叠带（有底色，点一下展开）。读者不用逐行比对，扫一眼卡就知道
 *    上面这摞在跑、下面这摞跑完了。
 *  · **行内图标**：跑着的转圈、结束的打勾 —— 形状差异，缩到 10px、灰度截图、
 *    色弱视角下都成立。行内那枚「进行中 / 已结束」文字随之撤掉：分区已经说了
 *    一遍，每行再说一遍只是噪声（用户 2026-10-23 同意）。
 *
 * 没有进行中的行时**不折叠**（那时折叠带只会把卡掏空），直接平铺，并且
 * **「已完成 N」这条标题整条不出现**：全部已结束的卡里，卡头读数已经写明
 * 「全部结束」，再挂一条对勾 + 淡字的标题只会被读成第 N+1 行 —— 它形状和下面
 * 每一行一样，而分区标题的意义是把两段分开，只剩一段就没得可分。判据见
 * `doneFoldable`。
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
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
/**
 * 已结束分区展开体的 id：折叠带按钮用它做 aria-controls。
 * 固定值即可 —— 右栏同一时刻只挂一张子智能体卡（见 KrAgentPanel 的卡片座位）。
 */
const DONE_BODY_ID = 'kr-subs-done-body'

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
  if (row.hasChildren) parts.push('它自己也派了子智能体')
  parts.push(row.running ? '进行中 · 点一下跳过去看' : '已结束 · 点一下跳过去看')
  return parts.join(' · ')
}

export interface KrSubagentsCardProps {
  /** 当前会话的子智能体目录（由 KrAgentPanel 单点订阅后传下来）。 */
  readonly catalog: SubagentCatalogView
  /**
   * 本**会话**的工具调用里是否存在「派出子任务」这一步（不是本轮）。
   *
   * 只用来决定**目录还没落地时**要不要占一行「正在读取」：从没派过时空目录
   * 就是真的没有，整张卡不该出现。口径必须与目录一致（都是会话累计），
   * 否则切到新一轮会出现「目录有行、卡却被判空」的错位。
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
        /*
         * 状态必须进 aria-label / title：行内那枚文字撤掉之后，视觉用户靠形状
         * 图标读状态，读屏用户只有这一处文字来源 —— 撤了却不在别处补，等于
         * 对他们把状态删掉了。
         */
        aria-label={`打开子智能体 ${row.label}（${row.running ? '进行中' : '已结束'}）`}
        onClick={() => { onOpen(row) }}
      >
        {/* 状态图标：**形状即状态**（2026-10-23 第二轮）。
            跑着的是主色转圈，结束的是灰对勾 —— 只靠颜色与深浅在右栏里读不出来
            （用户点名「看不出来，不明显」），形状差在 10px、灰度截图、色弱视角下
            都成立。两态共用同一格（12px 的方块槽，跟着字号轴缩放），切状态时
            行内布局不跳动。 */}
        <span className="kr-subs-row__icon" aria-hidden>
          {row.running ? (
            <svg className="kr-subs-row__spin" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="8" cy="8" r="5.6" strokeOpacity=".28" />
              <path d="M8 2.4A5.6 5.6 0 0 1 13.6 8" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3.4 8.5 3.1 3.1 6-6.6" />
            </svg>
          )}
        </span>
        <span className="kr-subs-row__label">{row.label}</span>
        {row.hasChildren && <span className="kr-subs-row__tag">还有下级</span>}
        {/* 「可续接」标签已按用户要求移除（2026-10-09）：mode 是官方目录的内部
            分类（one-shot / continuable），在这张卡上不改变任何可做的动作——
            行点击都是跳转、子会话输入框都只读，展示它只是噪声。 */}
        {/* 时长：进行中的行随轮询走秒（读数来自官方 subagentTiming 投影，
            拿不到就不渲染，绝不自己从"我看到它多久了"里凑一个数）。 */}
        {row.elapsedMs !== undefined && (
          <span className="kr-subs-row__time">{formatDuration(row.elapsedMs)}</span>
        )}
        {/*
          * 行内那枚「进行中 / 已结束」文字已撤（2026-10-23 第二轮）：
          * 分区标题已经说过一遍，每行再说一遍只是噪声；状态由行首图标承担。
          * 读屏用户不受影响 —— 整行的 aria-label 与 title 里都带着状态。
          */}
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
  /**
   * 已结束分区是否「展开其余」。
   *
   * 会话口径（2026-10-23）之后这张卡不再按轮次裁剪，一场长对话跑下来已结束的
   * 行可能有十几个。折叠条只负责「收起来」，展开后同样要有上限 —— 否则一点开
   * 就把右栏整段占满，上面的进行中行被顶出视口。所以展开态也走 maxRows 一档，
   * 超出部分交给同一枚「展开其余 N 个」。
   */
  const [doneShowAll, setDoneShowAll] = useState(false)
  /**
   * 已结束分区是否展开。
   *
   * 用户 2026-10-23 点名「已经完工的也可以放 Show more」，口径对齐 Claude 桌面端
   * 那张同名面板：完工的行是**已经交割完的事实**，正在跑的才是此刻要盯的东西。
   * 不折叠时——一轮派八个、跑完六个——进行中的那两行会被一路挤到卡的下半段去。
   *
   * 默认值分两种情况（`undefined` = 用户还没表过态）：
   *  · **还有人在跑** → 折叠。卡的目的是"谁还在跑"，结束的那摞收起来让位；
   *  · **全都结束了** → 那就没有折叠这回事了：卡上只有结束的行，任何折叠都
   *    只会变成"点开才能看见唯一的内容"，见下面 doneFoldable 的判据。
   *
   * 用 `undefined` 而不是布尔初值：这是**随状态推出来的默认值**，一旦用户亲手
   * 点过，他的选择就固定下来，不再被后面的 running 变化覆盖（用户刚点开展开看
   * 某个子智能体的名字，最后一个人跑完了，卡不能自作主张把它收回去）。
   */
  const [doneOverride, setDoneOverride] = useState<boolean | undefined>(undefined)
  /** 跳转失败（宿主没有 uiWorkspace）时的一枚短暂提示，避免"点了没反应"。 */
  const [blocked, setBlocked] = useState(false)
  const motion = useMotionAllowed(true)
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(open, motion)

  const rows = catalog.rows
  const maxRows = squeezed ? MAX_VISIBLE_SQUEEZED : MAX_VISIBLE
  /*
   * 进行中在前、已结束在后（两边各自保持目录给的创建顺序）。
   *
   * 这不只是排序偏好：已结束的分区要能被折叠，折叠区就必须是**连续的尾块** ——
   * 否则收起时中间被抽走几行、下面的行往上跳，读起来像列表在乱动。分完组之后
   * 「谁还在跑」固定占据卡的上半段，与 Claude 那张面板同一种形态。
   */
  const runningRows = useMemo(() => rows.filter((row) => row.running), [rows])
  const doneRows = useMemo(() => rows.filter((row) => !row.running), [rows])
  const visible = useMemo(
    () => (showAll ? runningRows : runningRows.slice(0, maxRows)),
    [runningRows, showAll, maxRows],
  )
  const hiddenCount = runningRows.length - visible.length
  /** 已结束分区实际渲染的行（展开后仍受 maxRows 约束，见 doneShowAll）。 */
  const doneVisible = useMemo(
    () => (doneShowAll ? doneRows : doneRows.slice(0, maxRows)),
    [doneRows, doneShowAll, maxRows],
  )
  const doneHiddenCount = doneRows.length - doneVisible.length

  /**
   * 这一堆已结束的行**值不值得折叠**。
   *
   * 判据是「折叠之前，上面还有没有别的行」：进行中一行都没有时，折叠行就成了
   * 卡里唯一的内容，默认展开它等于脱裤子放屁，默认收起它等于把整张卡变成一句
   * 「N 个已结束」。两种情况都不如**直接平铺**：卡上只有结束时，那几行就是
   * 这一屏要看的全部东西。此时折叠条整条不渲染（也就没有「收起」）。
   */
  const doneFoldable = runningRows.length > 0 && doneRows.length > 0
  /** 可折叠时默认收起；不可折叠时就是平铺（恒为展开）。 */
  const doneOpen = doneFoldable ? (doneOverride ?? false) : true
  // 已结束分区的展开体，和整卡折叠是两层独立的高度补间（两个 ref、两段状态）。
  // 放在 doneOpen 之后：hook 顺序必须稳定，而它的入参由上面那一行决定。
  const { ref: doneRef, present: donePresent } = useHeightAnimation(doneRows.length > 0 && doneOpen, motion)

  /*
   * 从「全部结束」切回「又有人开跑」时，把展开态**固化**下来。
   *
   * 全部已结束时 doneFoldable 为 false，doneOpen 恒为 true（平铺，整卡都是已结束的行）。
   * 那一刻 doneOverride 还是 undefined；等新派出的子智能体出现，doneFoldable 变回 true，
   * doneOpen 就回落成默认的 false —— 用户眼前那一摞已完成行**无声消失**，而他什么都没点。
   * 所以在这个边沿把 doneOverride 落成 true：用户看到的是「已结束的那摞留在原地，
   * 上面多了一行正在跑的」，而不是列表突然被抽走半截。
   */
  const prevRunningRef = useRef(runningRows.length)
  useEffect(() => {
    const prev = prevRunningRef.current
    prevRunningRef.current = runningRows.length
    if (prev === 0 && runningRows.length > 0 && doneRows.length > 0 && doneOverride === undefined) {
      setDoneOverride(true)
    }
  }, [runningRows.length, doneRows.length, doneOverride])

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
   *  · 没行但本会话有过派生动作 → 渲染一行「正在读取子智能体…」（目录还没落地）；
   *  · 其余 → null。这次会话确实没有子智能体，不该在右栏白占一行高度。
   */
  if (rows.length === 0 && !spawning) return null

  /*
   * 标题右侧的读数。折叠之后**已结束的那部分也必须出现在读数里** ——
   * 否则卡上只剩两行进行中，读者会以为"这轮就派了两个"，而下面那行
   * 「M 个已结束」正是告诉他还有一摞收在折叠区里。
   *
   * 口径是**整场会话**（2026-10-23）：读数的 N 与下面逐行列出的行数一致，
   * 也与操作面板「派出 N 个子智能体」那枚徽标一致 —— 三处对不上，读者就会
   * 以为卡里漏了东西。
   */
  const meta = rows.length === 0
    ? '读取中'
    : doneRows.length === 0
      ? `${rows.length} 个 · 全部进行中`
      : runningRows.length === 0
        ? `${rows.length} 个 · 全部结束`
        : `${rows.length} 个 · ${runningRows.length} 个进行中`

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
              {/*
               * 进行中分区：卡的上半段永远是「谁还在跑」。
               *
               * 段标题「正在执行 N」是这一轮（2026-10-23 第二轮）的关键改动：
               * 状态原先只靠行内一颗 6px 点区分，用户看不出区别。段标题把
               * 「上面这摞在跑」变成**结构事实**——主色 + 呼吸点 + 计数，扫一眼
               * 卡头下方就知道此刻有几个活的。
               *
               * 一行都没有时整段（含标题）不渲染：空段只会多一道杠。
               */}
              {visible.length > 0 && (
                <>
                  <div className="kr-subs-group kr-subs-group--run">
                    <span className="kr-subs-group__dot" aria-hidden />
                    <span className="kr-subs-group__label">正在执行</span>{' '}
                    <span className="kr-subs-group__count">{runningRows.length}</span>
                  </div>
                  <div className="kr-subs-list">
                    {visible.map((row, index) => (
                      <SubagentLine key={row.id} row={row} index={index} onOpen={onOpen} failed={blocked} />
                    ))}
                  </div>
                  {/*
                   * 「展开其余 N 个」**留在进行中分区里面**（2026-10-23 收尾）。
                   * 它原先渲染在两个分区之外、紧贴着下面那条有底色的「已完成」折叠带，
                   * 读起来像"展开已完成那摞"的按钮 —— 而它展开的是还卡在上限之外的
                   * 进行中行。归属写进结构里，就不用再靠文案解释。
                   */}
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

              {/*
               * 已结束分区（用户 2026-10-23 点名：完工的收进「Show more」）。
               *
               * 为什么折叠的是**结束的那一堆**而不是列表尾巴：结束的行不再变化，
               * 它们只是"已经交割完的事实"；把它们摊在上面，正在跑的那两行就被
               * 一路挤到卡底 —— 而这张卡存在的意义恰恰是"谁还在跑"。所以固定
               * 顺序是 进行中 → 已完成(折叠)。
               *
               * **这一轮（2026-10-23 第二轮）的关键变化**：段标题从「N 个已结束」
               * 一行淡灰文字，改成一条**带对勾、有底色、能点的整块折叠带**。
               * 旧形态读起来像列表结尾的省略号，读者根本意识不到「下面还收着一摞」；
               * 新形态是一个明确的分区标签：对勾图标 + 「已完成 N」 + chevron，
               * 与上面那条主色的「正在执行 N」形成对照。
               *
               * 不可折叠时（上面没有进行中的行）**整条标题不渲染**：那是「全部
               * 已结束」的卡，卡头读数已经写明，再挂一条「已完成 N」只会被读成
               * 第 N+1 行（对勾 + 淡字的形状和下面每一行一样）。分区标题存在的
               * 意义是「把两段分开」，只剩一段时它没有可分的东西。
               */}
              {doneRows.length > 0 && (
                <div className="kr-subs-done">
                  {doneFoldable ? (
                    <button
                      type="button"
                      className="kr-subs-group kr-subs-group--done kr-subs-group--toggle"
                      aria-expanded={doneOpen}
                      /*
                       * 展开体带 inert/aria-hidden 收起，所以必须给按钮一个程序化的
                       * 指向：读屏用户按下它之后要知道自己展开了哪一块。
                       * id 用固定值 —— 右栏同一时刻只有这一张子智能体卡。
                       *
                       * 只在展开体真的在 DOM 里时才挂：收起动画结束后展开体整块卸载
                       * （useHeightAnimation 的 present），此时若仍留着 aria-controls，
                       * 就是一个指向不存在元素的悬空 IDREF。
                       */
                      aria-controls={donePresent ? DONE_BODY_ID : undefined}
                      onClick={() => { setDoneOverride(!doneOpen) }}
                    >
                      <svg className="kr-subs-group__tick" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m3.4 8.5 3.1 3.1 6-6.6" />
                      </svg>
                      <span className="kr-subs-group__label">已完成</span>{' '}
                      <span className="kr-subs-group__count">{doneRows.length}</span>
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="kr-subs-group__chevron"
                      >
                        <path d="m4.4 6.2 3.6 3.6 3.6-3.6" />
                      </svg>
                    </button>
                  ) : null}
                  {donePresent && (
                    <div
                      ref={doneRef}
                      id={DONE_BODY_ID}
                      className="kr-subs-done__body"
                      data-open={doneOpen || undefined}
                      aria-hidden={!doneOpen}
                      {...(!doneOpen ? { inert: '' } : {})}
                    >
                      <div className="kr-subs-list">
                        {doneVisible.map((row, index) => (
                          <SubagentLine key={row.id} row={row} index={index} onOpen={onOpen} failed={blocked} />
                        ))}
                      </div>
                      {doneHiddenCount > 0 && (
                        <button
                          type="button"
                          className="kr-subs-more"
                          onClick={() => { setDoneShowAll(true) }}
                        >
                          <span>展开其余 {doneHiddenCount} 个</span>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m4.4 6.2 3.6 3.6 3.6-3.6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
})
