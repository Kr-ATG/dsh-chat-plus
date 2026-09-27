/**
 * dsh-chat-plus — 「操作面板」卡（右栏大盘滚动区的最后一张卡）。
 *
 * 读者是**不会编程的普通用户**。这张卡只回答两件事：
 *   · **已经做了什么** —— 来自工具调用事实，由 plain-language 翻成中文人话；
 *   · **准备做什么**   —— 来自模型在思考里自己播报的 `下一步：…`。
 *
 * 刻意不做的三件事：
 *  1. 不显示工具函数名、参数名、原始命令行、完整文件路径——那些只在点开
 *     单条时的二级技术信息里出现；
 *  2. 不做「同一动作聚合计数」——browser_click 点了 20 次，「点了 20 次」
 *     本身就是事实，折叠成一行会把它抹掉；
 *  3. 不自己算进度百分比——进行中 / 已完成 / 失败三个计数已经够了。
 *
 * 实时性：列表用 useSteppedFollow 跟随，新步骤贴底；用户上滚即截停，滚回
 * 底部自动恢复。与思考过程卡同一套手感。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { useHeightAnimation, useMotionAllowed, useSteppedFollow } from '../motion-utils.ts'
import { formatDuration } from '../tool-summary/tool-stats.ts'
import type { PlainIconKey, PlainStep } from './plain-language.ts'
import { condenseSteps, type PlainStepView, type PlainTimeline } from './plain-timeline.ts'
import { useSubagentCatalog, type SubagentCatalogView } from './subagent-catalog.ts'

/**
 * 详细/简要的落盘键。换个键名就会丢用户上次的偏好，改动时留意。
 *
 * 带 `_v2` 后缀：默认档从「详细」改成「简要」，而旧键里存着的是上一版留下的
 * 偏好（多数人从没按过，值是默认的 full）。不换键的话这批人会被旧值钉在详细档，
 * 新功能对他们等于没生效。换键时顺手清掉旧的。
 */
const VIEW_STORAGE_KEY = 'dsh.kr_chat.plain_view_v2'
const VIEW_STORAGE_KEY_LEGACY = 'dsh.kr_chat.plain_view'

/**
 * 读上次的选择；读不到（首次访问 / 隐私模式禁用存储）一律回**简要**。
 *
 * ��认简要而不是详细：这张卡的读者是普通用户，他明确说过"不在意你干了啥"，
 * 而 80% 以上的步骤都是翻文件/看网页这类 read——默认给详细等于每次都先砸给
 * 他一屏噪音、再让他自己动手关掉。想看全的人自己按一下"详细"，那是一个主动
 * 意图；反过来（默认详细、要收敛）是把收敛的活儿推给用户。
 */
function readStoredView(): PlainStepView {
  try {
    localStorage.removeItem(VIEW_STORAGE_KEY_LEGACY)
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'full' ? 'full' : 'brief'
  } catch {
    return 'brief'
  }
}
function writeStoredView(view: PlainStepView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch { /* ignore */ }
}

/**
 * 列表视口最大行数：6 → 8 → **13**（用户按实际观感定的档，8 → 13 是「再加 100px」：
 * 行高 22px，+5 行 = +110px）。
 *
 * 这张卡在右栏最末尾，视口高度就是它能一口气看到多少条动作。右栏本身有滚动区，
 * 列表内部再套一层滚动是双重滚动条（旧档位 6 行时这样更明显），所以宁可把视口
 * 开大些，让更多动作直接露出来。
 */
const LIST_MAX_ROWS = 13
/** 被右栏挤压时（记忆卡常驻底部触发自适应降档）收一档。 */
const LIST_MAX_ROWS_SQUEEZED = 9

export interface KrPlainTimelineCardProps {
  readonly timeline: PlainTimeline
  readonly running: boolean
  /** 右栏被挤压时为 true，列表降一档高度。 */
  readonly squeezed?: boolean
  /** 当前会话 id：用于查该会话派生了哪些子智能体。 */
  readonly sessionId?: string | null
}

/**
 * 类别图标：单色描边、14px（与状态圆圈同大），线宽 1.3。
 *
 * 这一枚图标负责「做了什么」（终端 / 地球 / 放大镜 / 文件夹…），所以行里的文字
 * 不再重复"在线缆执行命令""在浏览器里操作"这类动词前缀——前缀是把图标说的话
 * 又用文字抄一遍，扫一列下来全是重复句。文字只留动作的具体对象（「查看视频底层
 * 组件详情」），没有对象时才退回动词本身。
 */
function Icon({ name }: { readonly name: PlainIconKey }): ReactElement {
  const common = {
    width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
  } as const
  switch (name) {
    case 'globe':
      return <svg {...common}><circle cx="8" cy="8" r="5.9" /><path d="M2.2 8h11.6" /><path d="M8 2.1c1.7 2 1.7 9.8 0 11.8" /><path d="M8 2.1c-1.7 2-1.7 9.8 0 11.8" /></svg>
    case 'cursor':
      return <svg {...common}><path d="M3.2 2.2 13 7.1 9 8.6l-1.5 3.9z" /></svg>
    case 'keyboard':
      return <svg {...common}><rect x="1.6" y="4" width="12.8" height="8" rx="1.6" /><path d="M4.2 6.6h.01M7 6.6h.01M9.8 6.6h.01M5 9.6h6" /></svg>
    case 'eye':
      return <svg {...common}><path d="M1.6 8S4.1 3.6 8 3.6 14.4 8 14.4 8 11.9 12.4 8 12.4 1.6 8 1.6 8Z" /><circle cx="8" cy="8" r="1.9" /></svg>
    case 'scroll':
      return <svg {...common}><path d="M8 2.2v8.4M5.2 8l2.8 2.8L10.8 8" /><path d="M2.8 13.4h10.4" /></svg>
    case 'arrow':
      return <svg {...common}><path d="M12.8 8H3.4M6.8 4.6 3.4 8l3.4 3.4" /></svg>
    case 'folder':
      return <svg {...common}><path d="M2.1 4.6A1.5 1.5 0 0 1 3.6 3.1h2.1l1.3 1.6h5.4a1.5 1.5 0 0 1 1.5 1.5v5.3a1.5 1.5 0 0 1-1.5 1.5H3.6a1.5 1.5 0 0 1-1.5-1.5z" /></svg>
    case 'search':
      return <svg {...common}><circle cx="7" cy="7" r="4.3" /><path d="m10.2 10.2 3.2 3.2" /></svg>
    case 'terminal':
      return <svg {...common}><rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6" /><path d="m4.6 6.2 2 1.9-2 1.9" /><path d="M8.6 10.4h3.4" /></svg>
    case 'image':
      return <svg {...common}><rect x="1.6" y="3" width="12.8" height="10" rx="1.6" /><circle cx="5.7" cy="6.4" r="1.1" /><path d="m2.6 11.4 3.5-3.2 2.9 2.5 1.9-1.7 2.5 2.2" /></svg>
    case 'download':
      return <svg {...common}><path d="M8 2.4v7.2M5.2 6.9 8 9.7l2.8-2.8" /><path d="M2.8 12.6h10.4" /></svg>
    case 'cloud':
      return <svg {...common}><path d="M4.6 12.4a2.9 2.9 0 0 1-.3-5.8 4 4 0 0 1 7.5-.6 2.8 2.8 0 0 1-.3 6.4z" /></svg>
    case 'bolt':
      return <svg {...common}><path d="M8.9 1.8 4.2 9.1h3.3l-.4 5.1 4.7-7.3H8.5z" /></svg>
    case 'task':
      return <svg {...common}><path d="M2.6 4.6h10.8M2.6 8h10.8M2.6 11.4h6.8" /></svg>
    case 'spark':
      return <svg {...common}><path d="M8 2 9.3 6.1 13.4 7.4 9.3 8.7 8 12.8 6.7 8.7 2.6 7.4 6.7 6.1z" /></svg>
    case 'file':
    default:
      return <svg {...common}><path d="M9.2 1.9H4.6A1.5 1.5 0 0 0 3.1 3.4v9.2a1.5 1.5 0 0 0 1.5 1.5h6.8a1.5 1.5 0 0 0 1.5-1.5V5.9z" /><path d="M9.2 1.9v4h4" /></svg>
    /*
     * 文件族四枚（看 / 改 / 建 / 删）。
     *
     * 拆开的原因是形状本身要能说话：这一列里最需要被一眼认出的就是「在读 / 在改
     * / 在建 / 在删」，四者都画成同一枚文档时扫一列等于什么都没说——尤其一个
     * 「修改」和一个「查看」紧挨着时，用户根本分不出模型刚动过哪个文件。
     *
     * 14px 下细线会糊成一团，所以文件族单独用 1.5 的线宽（其余类别图标仍 1.3），
     * 文件轮廓缩到左侧 2/3，右下角让给动作符号；四枚共用同一份轮廓保证仍看得出
     * 是一家人（都是文件），符号不同保证不撞形。
     */
    case 'fileView':
      return <svg {...common} strokeWidth={1.5}><path d="M7.2 2.4H4.4A1.4 1.4 0 0 0 3 3.8v8.4a1.4 1.4 0 0 0 1.4 1.4h.8" /><path d="M7.2 2.4v3.1h3.1" /><circle cx="10.4" cy="10.4" r="3" /><path d="m12.7 12.7 1.9 1.9" /></svg>
    case 'fileEdit':
      return <svg {...common} strokeWidth={1.5}><path d="M7.2 2.4H4.4A1.4 1.4 0 0 0 3 3.8v8.4a1.4 1.4 0 0 0 1.4 1.4h.8" /><path d="M7.2 2.4v3.1h3.1" /><path d="m8.6 13 .6-2 3.9-3.9 1.4 1.4-3.9 3.9z" /><path d="m12.1 7.6 1.4 1.4" /></svg>
    case 'fileNew':
      return <svg {...common} strokeWidth={1.5}><path d="M7.2 2.4H4.4A1.4 1.4 0 0 0 3 3.8v8.4a1.4 1.4 0 0 0 1.4 1.4h.8" /><path d="M7.2 2.4v3.1h3.1" /><path d="M11.7 7.2v6.2M8.6 10.3h6.2" /></svg>
    case 'trash':
      return <svg {...common} strokeWidth={1.5}><path d="M2.4 4.2h11.2" /><path d="M6 4.2V2.9a1.1 1.1 0 0 1 1.1-1.1h1.8A1.1 1.1 0 0 1 10 2.9v1.3" /><path d="M3.8 4.2l.6 8.3a1.5 1.5 0 0 0 1.5 1.4h4.2a1.5 1.5 0 0 0 1.5-1.4l.6-8.3" /><path d="M6.7 6.9v3.9M9.3 6.9v3.9" /></svg>
  }
}

/**
 * 子智能体区块：挂在一条「派生子任务」的步骤下面。
 *
 * 回答的是「这个 workflow 底下到底有几个子智能体、谁还在跑」——这些信息父调用
 * 一概不知道（子智能体是独立会话），不给它的话用户只能自己去顶栏的子智能体
 * 目录里翻，那正是这张卡要取代的一跳。
 *
 * 只列拿得到的事实（名字 / 跑没跑 / 有没有后代），**不编造子智能体内部在做什么**：
 * 那部分数据不在 client 侧，宁可空着。
 */
function SubagentBlock({ catalog }: { readonly catalog: SubagentCatalogView }): ReactElement | null {
  if (catalog.state === 'loading') {
    return <div className="kr-plain-subs" data-state="loading">正在读取子智能体…</div>
  }
  if (catalog.state === 'unloaded') {
    /*
     * 目录还没拉到（subagentsByParent 里没有这个父会话的键，或首次读取未成功）。
     * 这里**不能说"这次没有派生独立的子智能体"** —— 那是在对一件我们并不知道的
     * 事下结论；截图里就出现过「派出子任务 · 子智能体徽标」下面紧跟这句自相矛盾
     * 的话。读者看不出区别，但这是假话。
     */
    return <div className="kr-plain-subs" data-state="empty">子智能体清单未加载</div>
  }
  if (catalog.state === 'error') {
    return <div className="kr-plain-subs" data-state="error">子智能体清单读不到（会话服务未就绪）</div>
  }
  if (catalog.state === 'empty' || catalog.rows.length === 0) {
    return <div className="kr-plain-subs" data-state="empty">这次没有派生独立的子智能体</div>
  }
  return (
    <div className="kr-plain-subs">
      <div className="kr-plain-subs__head">
        {catalog.runningCount > 0
          ? `${catalog.rows.length} 个子智能体 · ${catalog.runningCount} 个进行中`
          : `${catalog.rows.length} 个子智能体 · 全部结束`}
      </div>
      <ul className="kr-plain-subs__list">
        {catalog.rows.map((row) => (
          <li key={row.id} className="kr-plain-sub" data-running={row.running ? 'true' : undefined}>
            <span className="kr-plain-sub__dot" aria-hidden />
            <span className="kr-plain-sub__label" title={row.label}>{row.label}</span>
            {row.hasChildren && <span className="kr-plain-sub__tag">还有下级</span>}
            {row.mode === 'continuable' && <span className="kr-plain-sub__tag">可续接</span>}
            <span className="kr-plain-sub__state">{row.running ? '进行中' : '已结束'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StepRow({ step, index, catalog }: {
  readonly step: PlainStep
  readonly index: number
  /** 仅当 step.spawnsSubagents 为真时才有内容。 */
  readonly catalog: SubagentCatalogView | null
}): ReactElement {
  /*
   * 文字只留动作的**对象**，不把动词前缀再抄一遍。
   *
   * 原来是 `${verb} · ${detail}`：一列扫下来全是「在线缆执行命令 · …」「在浏览器
   * 里操作 · …」，而前面那枚图标（终端 / 地球 / 光标）说的就是同一件事。文字
   * 留下 detail（「查看视频底层组件详情」），detail 缺失时才退回动词本身。
   */
  const title = step.detail === undefined || step.detail === '' ? step.verb : step.detail
  const failed = step.status === 'failed'
  return (
    <div
      className="kr-plain-step"
      data-status={step.status}
      data-nested={step.spawnsSubagents === true ? 'true' : undefined}
      // 错峰入场：只对靠后的若干条错开，卡片整体不拖出一段长尾。
      style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
    >
      {/*
       * 行首只有**一枚**图标：类别图标说「是哪类动作」，失败时它自己变红。
       *
       * 原来行首是「状态槽 + 类别图标」两列，而状态槽 99% 的行是空盒——一整列
       * 14px 空白只为等那一条红叉，代价与收益完全不成比例。改为让失败直接由
       * 类别图标右上角那枚小红叉角标承担（见下方 .kr-plain-step__icon::after），
       * 正常态不占任何额外宽度，整列左边界因此齐到贴边。
       */}
      <span className="kr-plain-step__icon" data-failed={failed ? 'true' : undefined} aria-hidden>
        <Icon name={step.icon} />
      </span>
      <span className="kr-plain-step__title" title={title}>{title}</span>
      {/*
       * 失败原因：**人话**那一句，不是原始报错。
       *
       * 这是整张卡上最该被看见的一件事——用户要的是"出了什么问题"，而一枚红叉
       * 只说了"有件事没成"。原样贴 `ENOENT: no such file or directory` 也没用，
       * 那不是他会读的东西；plain-language 的 humanIssue 已经把它翻成「找不到
       * 文件或页面」这类他能据此判断的话。认不出类别时不显示这一枚，宁可空着。
       *
       * 简短、弱一级字色，不抢行的主文案——它是对那行标题的**补充**，不是并列。
       */}
      {failed && step.issue !== undefined && (
        <span className="kr-plain-step__issue">{step.issue}</span>
      )}
      {step.durationMs !== undefined && step.durationMs > 40 && (
        <span className="kr-plain-step__time">{formatDuration(step.durationMs)}</span>
      )}
      {step.spawnsSubagents === true && catalog !== null && (
        <span className="kr-plain-step__subcount">
          {catalog.state === 'ready' ? `${catalog.rows.length} 个子智能体` : '子智能体'}
        </span>
      )}
      {step.spawnsSubagents === true && catalog !== null && <SubagentBlock catalog={catalog} />}
    </div>
  )
}

export const KrPlainTimelineCard = memo(function KrPlainTimelineCard({
  timeline,
  running,
  squeezed = false,
  sessionId = null,
}: KrPlainTimelineCardProps) {
  // 默认展开：这张卡挂在滚动区最末尾，收起等于把它藏到视线之外。
  const [open, setOpen] = useState(true)
  const motion = useMotionAllowed(true)
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(open, motion)

  /*
   * 详细 / 简要：默认**简要**（见 readStoredView 的理由），选择落盘记住。
   */
  const [view, setView] = useState<PlainStepView>(() => readStoredView())
  /**
   * 直接定档并落盘。两枚按钮各写清自己的档位，就不需要"在两档间来回拨"的 toggle。
   *
   * 落盘**不能**写在 setState 的 updater 里：updater 必须保持纯函数（React 并发
   * 模式下可能调用它两次、也可能不调用，副作用就会时有时无）。所以 updater 只做
   * 纯状态变更，写盘放在它外面。ref 记着当前档，用来判断"值真的变了"——不能拿
   * 磁盘值比：controller 每 250ms 重渲染一次，磁盘值与此刻 state 可能不同步。
   */
  const viewRef = useRef(view)
  const setViewDirect = useCallback((next: PlainStepView) => {
    if (viewRef.current === next) return
    viewRef.current = next
    setView(next)
    writeStoredView(next)
  }, [])

  const brief = view === 'brief'
  const steps = useMemo(
    () => (brief ? condenseSteps(timeline.steps) : timeline.steps),
    [brief, timeline.steps],
  )

  /*
   * 子智能体清单只在**本轮真的派生了子智能体**时才去订阅。
   * 没有派生动作时完全不接轮询 —— 绝大多数轮次压根不 spawn，任何时候都在
   * 读目录是白花的开销。
   */
  const hasSpawning = useMemo(
    () => steps.some((step) => step.spawnsSubagents === true),
    [steps],
  )
  const subagentCatalog = useSubagentCatalog(hasSpawning ? sessionId : null)

  // 跟随探针：条目数 / 当前动作 / 预告任一变化都重新贴底。
  const probe = useMemo(
    () => `${steps.length}:${timeline.nowLabel}:${timeline.intent ?? ''}`,
    [steps.length, timeline.nowLabel, timeline.intent],
  )
  const { ref: listRef, onScroll, onWheel, overflow, following, edges } = useSteppedFollow(probe, running && open, motion)

  /*
   * 收口时把列表拉回顶部。
   *
   * 运行中列表一直贴底跟随（用户在追最新动作），轮次一结束内容就定格了——这时
   * 停在底部反而把开头那几步挡在视口外，而「这一轮一共做了什么」正是收口后用户
   * 最想看的东西。留着跟随时的滚动位置还会与后来的内容变化错位，顶部被硬切出
   * 半行（没有渐隐遮罩时尤其明显，见 styles.ts 的 kr-plain-list）。
   */
  const wasRunningRef = useRef(running)
  useEffect(() => {
    const was = wasRunningRef.current
    wasRunningRef.current = running
    if (!was || running) return
    const el = listRef.current
    if (el === null) return
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  }, [running, listRef])

  const empty = timeline.steps.length === 0
  const maxRows = squeezed ? LIST_MAX_ROWS_SQUEEZED : LIST_MAX_ROWS
  // 折叠了多少：给切换按钮做 tooltip，也让"简要"模式下的收敛量可核对。
  const hiddenCount = timeline.steps.length - steps.length

  return (
    <div className="kr-card kr-card--plain" data-empty={empty || undefined} data-view={view}>
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
           * 「一串按时间发生的动作」：左侧竖线 + 三个节点 + 右侧递减的短线。
           *
           * 换掉原来的八向光芒（那是从"思考/灵感"那儿借来的，与这张卡讲的事
           * 无关），也刻意避开和另外几张卡撞形：任务概览是横向清单、思考过程是
           * 灯泡、工具调用是扳手、记忆是大脑。这张卡讲的是「模型按顺序做了哪几
           * 件事」，时间线/序列是唯一诚实的图形语言。
           */}
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.2 3v10" />
            <circle cx="4.2" cy="4.6" r="1.35" />
            <circle cx="4.2" cy="8" r="1.35" />
            <circle cx="4.2" cy="11.4" r="1.35" />
            <path d="M8.4 4.6h4.4M8.4 8h3.4M8.4 11.4h2.2" />
          </svg>
        </span>
        <span className="kr-card__title">操作面板</span>
        {/*
         * 详细 / 简要 切换（卡头右上角）。
         *
         * 读者是普通用户：他不在意模型翻了多少个文件、点了几次屏幕，只关心「改了
         * 哪些东西」「出了什么事」。简要模式据此把连续的查看动作收敛成一行，只留
         * 写/改/删、失败与进行中（判定见 plain-timeline 的 condenseSteps）。
         *
         * 形态：两枚并列的小按钮，各带一枚图形（等宽三横线=详细，递减两横线=简
         * 要），当前档用**主文字色 + 一枚淡底色圆角块**标出。放弃上一版的滑块：
         * 滑块在 440px 宽的右栏里要占 66px，且"滑块停在哪"这件事在扫读时要盯一
         * 眼才读得出；两枚按钮各写清自己的名字，扫读零成本，宽度也省一半。
         *
         * stopPropagation 是必须的——整行 header 都是折叠热区，不拦住的话点切换
         * 会顺带把卡片收起。
         */}
        <div className="kr-plain-view" role="group" aria-label="操作面板显示密度">
          <button
            type="button"
            className="kr-plain-view__btn"
            data-active={view === 'brief' ? 'true' : undefined}
            aria-pressed={view === 'brief'}
            title="简要：只看改了东西、失败与进行中，其余查看动作收敛成一行"
            onClick={(event) => { event.stopPropagation(); setViewDirect('brief') }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M2.2 4.4h5.6" />
              <path d="M2.2 9.6h9.6" />
            </svg>
            <span>简要</span>
          </button>
          <button
            type="button"
            className="kr-plain-view__btn"
            data-active={view === 'full' ? 'true' : undefined}
            aria-pressed={view === 'full'}
            title={hiddenCount > 0
              ? `详细：看每一步做了什么（简要模式下可折叠 ${hiddenCount} 步）`
              : '详细：看每一步做了什么'}
            onClick={(event) => { event.stopPropagation(); setViewDirect('full') }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M2.2 2.9h9.6" />
              <path d="M2.2 7h9.6" />
              <path d="M2.2 11.1h9.6" />
            </svg>
            <span>详细</span>
          </button>
        </div>
      </div>

      {bodyPresent && (
        <div
          ref={bodyRef}
          className="kr-plain-body"
          data-open={open || undefined}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          {/*
           * 「接下来」预告行（模型自己播报的"下一步：…"）已整块删除。
           *
           * 它是**尚未发生**的事，而这张卡回答的是"已经做了什么"——一行还没兑现
           * 的承诺混在事实流水里，用户读完只会更困惑（"这条到底做没做？"）。而且
           * 80% 的情况下它与当前正在跑的那一行说的是同一件事（模型写"接下来查
           * model-seats 目录"，同一时刻列表里也正有一行"查看文件"在扫光），白白
           * 占掉一行高度。要看"现在在干什么"，进行中那行的扫光与右侧耗时已经说清。
           *
           * 模型侧的播报约定（PLAIN_PROGRESS_RULE）本身**保留**：它还喂 nowLabel
           * 与"进行中"高光的措辞，只是不再单独占一行。相关样式 .kr-plain-intent*
           * 一并从 styles.ts 移除。
           */}

          {empty ? (
            <div className="kr-plain-empty">本轮还没有执行动作</div>
          ) : (
            <div
              className="kr-plain-list"
              ref={listRef}
              onScroll={onScroll}
              onWheel={onWheel}
              role="region"
              aria-label="人话行动时间线"
              /*
               * 溢出时才进焦点序。没有 tabIndex 的溢出容器不进 Tab 序，纯键盘
               * 用户既聚焦不了也用方向键/PageDown 滚，只能读到前 6 行——同仓库
               * 的思考卡对完全同构的视口就写了 tabIndex={overflow ? 0 : undefined}
               * （KrReasoningCard.tsx），这里是漏抄。
               */
              tabIndex={overflow ? 0 : undefined}
              data-following={running && open && following ? 'true' : undefined}
              data-edges={edges}
              style={{ '--kr-plain-rows': maxRows } as CSSProperties}
            >
              {steps.map((step, index) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={index}
                  catalog={step.spawnsSubagents === true ? subagentCatalog : null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
