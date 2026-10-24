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
 * 现在它是自己的一张卡：**几个子智能体就几行**，一行一个，点一行就跳过去看
 * 那个子会话（走官方 `uiWorkspace.openSession`，与官方目录里点一行同一条链路）。
 *
 * ## 固定 5 行窗口（2026-10-24 用户最终定稿）
 *
 * 这一轮试过四种形态，用户最后确认的是**固定 5 行**：
 *   ① 定高 10 行 → 「没有显示那么多行的情况下不要卡片留这么多」；
 *   ② 封顶 10 行自适应 → 卡高仍随行数变，排在它下面的操作面板跟着跳；
 *   ③ 把操作面板搬出滚动区钉在顶部 → 位置死了，但排到了这张卡上面，
 *      用户看到的是「怎么跑到最上面去了」；
 *   ④ **固定 5 行**（现在这个）= 卡高与内容多少彻底无关。
 *
 * 5 行是「恒定」与「别占太多地方」的折中：有 3 个子智能体时它占 5 行（多出
 * 的空间留白），有 8 个时还是 5 行（第 6 个起在窗口内滚动）。**卡高恒定，所以
 * 紧贴其下的「操作面板」永远停在同一位置** —— 那正是用户三次点名要的东西。
 *
 * 行高与窗口高度同源（--kr-subs-row-h，随官方字号轴缩放）：字号调到 22 时
 * 「5 行」跟着长高，任何字号档下都精确是 5 行行高盒。
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
 * ## 什么时候不出现（2026-10-24 第二轮回归）
 *
 * 用户原话：「没有子智能体的时候也不要显示」。所以这张卡又回到**按需出现**：
 * 这次会话一个子智能体都没有、也从没派生过时整张卡不渲染。
 *
 * 中间试过让它常驻（为了"操作面板位置绝对不动"），代价是一张空卡长期占着右栏
 * 顶部 —— 用户明确否决了那个代价。真有派生动作但目录还没落地时仍占一行
 * 「正在读取」，那是**事实**（我们确实还没读到），不是「这次没有」
 * （那是我们不知道的结论）。
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
 * ## 固定窗口里的两段分区（2026-10-24）
 *
 * 两段的区别仍由**结构**承担（段标题 + 行内形状图标），但两段各自的展开体都
 * 收进**同一个 5 行窗口**里滚动：窗口高度是「几个就几行」那版的反面 ——
 * 它固定，所以下面的操作面板不会被子智能体的增减推走。
 *
 * 两段各自往窗口里投什么，按「这一屏该看见什么」定：
 *  · **进行中摊开**（占满窗口），这正是这张卡存在的理由；
 *  · **已完成收进折叠带**，点开才占窗口。
 *
 * 没有进行中的行时**不折叠**（那时折叠带只会把卡掏空），已结束的行直接摊在
 * 窗口里，并且 **「已完成 N」这条标题整条不出现**：全部已结束的卡里，卡头读数
 * 已经写明「全部结束」，再挂一条对勾 + 淡字的标题只会被读成第 N+1 行 —— 它形状
 * 和下面每一行一样，而分区标题的意义是把两段分开，只剩一段就没得可分。判据见
 * `doneFoldable`。
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useHeightAnimation, useMotionAllowed } from '../motion-utils.ts'
import { formatDuration } from '../tool-summary/tool-stats.ts'
import { openSubagentSession, type SubagentCatalogView, type SubagentRow } from './subagent-catalog.ts'

/**
 * 已结束分区展开体的 id：折叠带按钮用它做 aria-controls。
 * 固定值即可 —— 右栏同一时刻只挂一张子智能体卡（见 KrAgentPanel 的卡片座位）。
 */
const DONE_BODY_ID = 'kr-subs-done-body'

/*
 * 窗口固定 5 行 —— 行数由 CSS 的 `--kr-subs-rows`（.kr-card--subs 上）决定，
 * 不是这里的常量。第 6 行起在窗口内部滚动。
 *
 * **行不在这里裁**：原先那套「默认露出 6 行 + 超出的收进『展开其余 N 个』」
 * 随窗口一起撤掉。窗口自己能滚，看不见的行往下滚一行就是；再留一枚展开按钮，
 * 等于给同一件事配两个出口，按下去还会把读者刚滚到的位置整段跳掉。
 */

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
  /**
   * 右栏是否已被挤压。
   *
   * **定高窗口下这个值不再改变卡的高度**（2026-10-24）：窗口恒为 10 行，是用户
   * 点名要的"永远占 10 行"。挤压时降一档露出条数的那套做法随「按条数折叠」一起
   * 撤掉了 —— 一旦卡高随挤压变，操作面板又会跟着挪，正是本轮要消除的东西。
   * 参数留着只为不改挂载方的调用面与冒烟断言。
   */
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
}: KrSubagentsCardProps) {
  // 默认展开：这张卡常驻右栏，内容即是要看的东西。
  const [open, setOpen] = useState(true)
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
  /*
   * 进行中在前、已结束在后（两边各自保持目录给的创建顺序）。
   *
   * 这不只是排序偏好：已结束的分区要能被折叠，折叠区就必须是**连续的尾块** ——
   * 否则收起时中间被抽走几行、下面的行往上跳，读起来像列表在乱动。分完组之后
   * 「谁还在跑」固定占据卡的上半段，与 Claude 那张面板同一种形态。
   */
  const runningRows = useMemo(() => rows.filter((row) => row.running), [rows])
  const doneRows = useMemo(() => rows.filter((row) => !row.running), [rows])
  /*
   * 两段各自渲染的行：**全量**。
   *
   * 不在这里按条数裁剪（2026-10-24）：卡的高度由 CSS 的 10 行窗口决定，
   * DOM 里该有多少行就渲染多少行，超出的靠窗口内滚动看 —— 裁掉又不给入口，
   * 第 11 个子智能体就永远点不到了。（原先那套「露出 6 行 + 展开其余 N 个」
   * 是配合"卡高随内容变"的，窗口化之后不再需要。）
   *
   * 进行中永远排在上面（这是这张卡的意义）。已结束折叠时展开体整块卸载
   * （donePresent 为 false），不会有"看不见却还挂着动画"的节点。
   */
  const visible = runningRows
  const doneVisible = doneRows

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
   * 什么时候**只占位、不显示**（2026-10-25 用户定稿）。
   *
   * 用户原话：「没有子智能体时不上移」。这句话把前后两轮的要求接上了：
   *  · 2026-10-24「没有子智能体的时候也不要显示」→ 卡上不能有可见内容；
   *  · 现在「不上移」→ 下面那张「操作面板」的位置不能变。
   *
   * 两条只能靠**不可见占位**同时满足：这次会话确实没有子智能体时，仍然渲染
   * 一张**结构性**的卡（卡头 + 固定 5 行窗口，与外层真实卡片同一套结构，所以
   * 高度精确相等），但整张卡 visibility:hidden + aria-hidden + 不接交互。
   * 视觉上它不存在，位置上它还在 —— 操作面板于是纹丝不动。
   *
   * 为什么不用「高度写死的空白 div」：卡片高度由卡头行高、字号轴缩放、gap 一起
   * 决定，写死一个数只会在改字号或改卡头时对不上（而且对不上时没有任何报错，
   * 只表现成"操作面板又开始跳了"）。复用同一套结构 = 高度天然一致。
   *
   * 真正有内容时（含「正在读取」那种目录还没落地的中间态）走正常渲染。
   */
  const placeholder = rows.length === 0 && !spawning

  /** 没行时唯一的那一行说明（占位态里不可见，但保留结构以维持高度）。 */
  const emptyLine = catalog.state === 'error'
    ? '子智能体清单读不到（会话服务未就绪）'
    : '正在读取子智能体…'

  /*
   * 标题右侧的读数。折叠之后**已结束的那部分也必须出现在读数里** ——
   * 否则卡上只剩两行进行中，读者会以为"这轮就派了两个"，而下面那行
   * 「M 个已结束」正是告诉他还有一摞收在折叠区里。
   *
   * 口径是**整场会话**（2026-10-23）：读数的 N 与下面逐行列出的行数一致，
   * 也与操作面板「派出 N 个子智能体」那枚徽标一致 —— 三处对不上，读者就会
   * 以为卡里漏了东西。
   */
  const meta = placeholder
    ? '暂无'
    : rows.length === 0
      ? '读取中'
      : doneRows.length === 0
        ? `${rows.length} 个 · 全部进行中`
        : runningRows.length === 0
          ? `${rows.length} 个 · 全部结束`
          : `${rows.length} 个 · ${runningRows.length} 个进行中`

  return (
    /*
     * 占位态（placeholder）：整张卡**视觉上不存在**，但结构、高度、外边距全部
     * 照旧 —— 下面那张操作面板因此不上移（用户 2026-10-25：「没有子智能体时不上移」）。
     *
     * 三件套一起关：
     *  · aria-hidden：读屏用户不该听到一张空卡；
     *  · inert：焦点掉不进去（卡头是个 role=button 的可折叠热区）；
     *  · data-placeholder：样式表的 visibility 规则挂在这个属性上。
     * 用 visibility 而不是 display:none —— 后者会把盒子整个抽掉，高度归零，
     * 正好是我们要消除的那个位移。
     */
    <div
      className="kr-card kr-card--subs"
      data-empty={rows.length === 0 || undefined}
      data-placeholder={placeholder || undefined}
      aria-hidden={placeholder || undefined}
      {...(placeholder ? { inert: '' } : {})}
    >
      <div
        className="kr-card__header"
        onClick={placeholder ? undefined : () => { setOpen((value) => !value) }}
        role={placeholder ? undefined : 'button'}
        tabIndex={placeholder ? undefined : 0}
        aria-expanded={placeholder ? undefined : open}
        onKeyDown={placeholder ? undefined : (event) => {
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

      {/*
       * 占位态必须**连 body 一起渲染**：高度由卡头 + 5 行窗口构成，少了 body 就只剩
       * 一个卡头，高度对不上，操作面板照样上移。
       */}
      {(bodyPresent || placeholder) && (
        <div
          ref={bodyRef}
          className="kr-subs-body"
          data-open={open || undefined}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          {/*
           * 封顶窗口：**max-height = 10 行行高盒**，内容少就按内容收。
           *
           * 「上限 10 行」与「别预先留白」是两句话、两件事：定高（height）能保证
           * 操作面板绝对不动，代价是只有 1 行时也挂着 9 行空气——用户明确不要
           * 那个。max-height 保留上限，行少时卡高跟着内容走。溢出在窗口内部滚动，
           * overscroll-behavior: contain 让滚到头的滚动链停在这里，不再把外层
           * 右栏一起带着走。
           */}
          <div className="kr-subs-window">
            {rows.length === 0 ? (
              <div className="kr-subs-empty">{emptyLine}</div>
            ) : (
              <>
                {/*
                 * 进行中分区：卡的上半段永远是「谁还在跑」。
                 *
                 * 段标题「正在执行 N」：状态原先只靠行内一颗 6px 点区分，用户
                 * 看不出区别。段标题把「上面这摞在跑」变成**结构事实**——主色 +
                 * 呼吸点 + 计数，扫一眼卡头下方就知道此刻有几个活的。
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
                     * 「展开其余 N 个」已撤（2026-10-24 定高窗口后）。
                     *
                     * 它原本在这里展开"卡在上限之外"的进行中行。窗口化之后，超出
                     * 的行本来就在**窗口里**，往下滚一行就是 —— 再留一枚按钮，等于
                     * 给"看不见第 11 行"这件事配两个出口，而且按下去会换掉窗口内容
                     * （读者刚滚到的位置整段跳掉）。滚动条是这里唯一诚实的出口。
                     */}
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
                        {/* 「展开其余 N 个」同样撤掉：窗口本来就在滚（理由见进行中那一段）。 */}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
})