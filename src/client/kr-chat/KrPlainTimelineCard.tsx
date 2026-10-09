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
 *
 * 子智能体（`subagent` / `workflow` 派出去的那些）**不在这张卡里列**：
 * 它们是独立会话，缩进挂在某一步下面会被读成"这一步的内部细节"，还会把一列按
 * 时间读的流水截成一段一段。2026-10-08 起它们有自己的卡（KrSubagentsCard），
 * 这里只在派生那一步留一枚计数徽标（「派出 3 个子智能体」）。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { useHeightAnimation, useMotionAllowed, useSteppedFollow } from '../motion-utils.ts'
import { formatDuration } from '../tool-summary/tool-stats.ts'
import type { PlainIconKey, PlainStep } from './plain-language.ts'
import { condenseSteps, countOf, stripCount, type PlainStepView, type PlainTimeline } from './plain-timeline.ts'
import type { SubagentCatalogView } from './subagent-catalog.ts'
import { workspaceCwdOf } from '../client-ctx.ts'
import { tryOpenInSidebar } from '../open-preview.ts'

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
  /**
   * 当前**查看轮次**的子智能体目录（KrAgentPanel 单点订阅后按轮次窗口过滤传下来）。
   *
   * 只用来给「派出子任务」那一步标一枚计数。**订阅不在这里做**：子智能体卡
   * 也要这份数据，两处各订阅一次会各开一条 interval，白白把 RPC 打成轮询。
   * 传 null = 本轮没派生过子智能体，计数那枚徽标直接显示「派生子任务」。
   */
  readonly subagentCatalog?: SubagentCatalogView | null
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
 * 产出行末尾的「打开预览」按钮。
 *
 * 读者是普通用户：他刚让模型做了张图 / 改了份文档，最想要的下一步就是**看一眼**。
 * 在那之前他只能自己去翻文件管理器 —— 因为卡片上写的只有文件名，点不动。
 * 这枚按钮把「文件名」变成「点一下就在右侧栏打开」。
 *
 * 只在这一步确实产出了一个文件时渲染（step.filePath 有值）。点击时优先走
 * 官方右栏预览；右栏服务不可用（旧宿主）就什么都不做，绝不弹错误框 ——
 * 那枚按钮本来只是加速通道，不是必经之路。
 */
function OpenFileChip({ step, sessionId }: {
  readonly step: PlainStep
  readonly sessionId: string | null
}): ReactElement | null {
  const path = step.filePath
  if (path === undefined || path === '') return null
  return (
    <button
      type="button"
      className="kr-plain-step__open"
      title={`在右侧栏预览 ${path}`}
      aria-label={`在右侧栏预览 ${path}`}
      onClick={(event) => {
        // 卡片头整行是折叠热区，这里必须拦住，否则点开预览会把卡片收起。
        event.stopPropagation()
        tryOpenInSidebar(path, { sessionId, cwd: workspaceCwdOf(sessionId) })
      }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6.4 3.2H3.6A1.4 1.4 0 0 0 2.2 4.6v7.8a1.4 1.4 0 0 0 1.4 1.4h7.8a1.4 1.4 0 0 0 1.4-1.4V9.6" />
        <path d="M9.6 2.2h4.2v4.2" />
        <path d="M13.8 2.2 7.6 8.4" />
      </svg>
      <span>预览</span>
    </button>
  )
}

function StepRow({ step, index, subagentCount, brief, sessionId }: {
  readonly step: PlainStep
  readonly index: number
  /**
   * 该步骤派生出的子智能体数量；null = 拿不到（目录没落地 / 服务未就绪）。
   *
   * 只在**这条步骤真的派生了子智能体**时才有值。清单本身**不再挂在这里** ——
   * 子智能体是独立会话，缩进挂在某一步下面读起来像"这一步的内部细节"，还会把
   * 一列按时间读的流水截成一段一段；现在它有自己的卡（KrSubagentsCard），
   * 这里只留一枚计数，说清"这一步派了几个"，要跳过去看在下面那张卡上。
   */
  readonly subagentCount: number | null
  /** 简要（纪要）模式：不要图标，动词写回文字里。 */
  readonly brief: boolean
  /** 当前会话 id：点「预览」时用它构造文件地址。 */
  readonly sessionId: string | null
}): ReactElement {
  /*
   * 一句话 = **动词 + 对象**。
   *
   * 详细模式下图标已经说了"是哪类动作"，文字只留对象（「plain-language.ts」）就够；
   * 简要模式没有图标，动词就没人说了——一行光写"plain-language.ts"用户根本读不出
   * 是改了它还是读了它。所以 brief 时把动词补回文字（`修改 plain-language.ts`），
   * 靠文字里的间隔号断句，不再靠图标承担。
   *
   * brief 下再拆成三段：动词、对象、次数。原来三者是同一个 span 的同一串字，
   * 读起来「修改文件」重、「triad-modal-animation.ts · 共 7 次」轻——那不是配色
   * 故意做的层次，只是 CJK 笔画密而拉丁字形细，视觉重量天然压在前半截，
   * 文件名与次数被顺带压到了"看不清"。拆开后各自有独立的字重与尺寸：
   * 动词最重、对象同色略轻、次数提为彩色药丸。层次是排出来的，不是撞出来的。
   *
   * 折叠时 `condenseSteps` 会在 detail 尾部贴「· 共 N 次」（对象为空时整条
   * 就是「共 N 次」），这里按同一条分隔规则拆开：分隔符随次数药丸走，不再
   * 把「共 N 次」混在对象字符串中间。
   */
  const base = brief ? stripCount(step.detail) : step.detail
  const title = brief
    ? (base === undefined || base === '' ? step.verb : `${step.verb} ${base}`)
    : (base === undefined || base === '' ? step.verb : base)
  const count = brief && step.detail !== undefined ? countOf(step.detail) : null
  const failed = step.status === 'failed'
  return (
    <div
      className="kr-plain-step"
      data-status={step.status}
      data-brief={brief ? 'true' : undefined}
      data-nested={step.spawnsSubagents === true ? 'true' : undefined}
      // 错峰入场：只对靠后的若干条错开，卡片整体不拖出一段长尾。
      style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
    >
      {/*
       * 行首图标：类别图标说「是哪类动作」，失败时它自己变红。
       *
       * 原来行首是「状态槽 + 类别图标」两列，而状态槽 99% 的行是空盒——一整列
       * 14px 空白只为等那一条红叉，已整列删除。
       *
       * **简要模式整枚不画**（brief 时不渲染）：那一列已经只剩三行里程碑与一条
       * 报错，图标在纪念要里是纯噪声——用户读的是「改了什么 / 出了什么事」，不是
       * 「这属于哪类工具」。省下的一列让文字从卡缘起，句子读起来是一整句而不是
       * 「图标 + 半个词」。失败由行文字本身的红色与那枚人话原因药丸承担。
       */}
      {!brief && (
        <span className="kr-plain-step__icon" data-failed={failed ? 'true' : undefined} aria-hidden>
          <Icon name={step.icon} />
        </span>
      )}
      {brief ? (
        <span className="kr-plain-step__title" title={title}>
          <span className="kr-plain-step__verb">{step.verb}</span>
          {base !== undefined && base !== '' && <span className="kr-plain-step__object">{base}</span>}
          {count !== null && <span className="kr-plain-step__count">{count}</span>}
        </span>
      ) : (
        <span className="kr-plain-step__title" title={title}>{title}</span>
      )}
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
      {/*
       * 「预览」入口：只在**成功了**的产出行上出现。
       * 失败那一步的 filePath 往往指向一个没写成的文件，给个点开就报错的按钮
       * 比不给更糟 —— 失败行要的是那句人话原因，不是出口。
       */}
      {!failed && <OpenFileChip step={step} sessionId={sessionId} />}
      {step.durationMs !== undefined && step.durationMs > 40 && (
        <span className="kr-plain-step__time">{formatDuration(step.durationMs)}</span>
      )}
      {step.spawnsSubagents === true && (
        <span
          className="kr-plain-step__subcount"
          /*
            * 计数口径是**当前查看的这一轮对话**（2026-10-09 起，目录按轮次窗口
            * 过滤后传下来）：这一步所在的那一轮派了几个，就是几个。会话累计的
            * 历史子智能体不再混进这枚徽标——对话一多时「共 N 个」会指到读者
            * 根本没参与的历史轮次上去。title 里点明去哪儿逐个看。
            */
          title={subagentCount === null
            ? '正在读取子智能体清单；读完可在下面「子智能体」卡里逐个点进去看'
            : `本轮对话派出 ${subagentCount} 个子智能体；在下面「子智能体」卡里点一行即跳过去看`}
        >
          {subagentCount === null ? '派出子任务' : `派出 ${subagentCount} 个子智能体`}
        </span>
      )}
    </div>
  )
}

export const KrPlainTimelineCard = memo(function KrPlainTimelineCard({
  timeline,
  running,
  squeezed = false,
  sessionId = null,
  subagentCatalog = null,
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
   * 子智能体目录**不在这里订阅**（2026-10-08 起）：数据由 KrAgentPanel 单点订阅
   * 后经 props 传下来。两张卡各订阅一次 = 各开一条 1.5s interval + 各发一份
   * refreshProjections，白白把 RPC 打成轮询；而它们读的本来就是同一份快照。
   *
   * 计数只给「派出子任务」那一步用；目录没落地时传 null，徽标显示「派生子任务」。
   */
  const subagentCount = subagentCatalog !== null && subagentCatalog.state === 'ready'
    ? subagentCatalog.rows.length
    : null

  // 跟随探针：条目数变化就重新贴底。
  const probe = useMemo(
    () => `${steps.length}`,
    [steps.length],
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
           * 模型侧的播报约定（PLAIN_PROGRESS_RULE）也于 2026-10-01 整条下掉：
           * 这行删掉之后，intent 只剩一个滚动跟随探针在消费、nowLabel 干脆没有
           * 渲染出口，而模型每一步都要多写一行。相关注入规则、composer 那枚
           * 「操作面板」开关、extractIntent / nowLabel 一并移除。
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
                  subagentCount={step.spawnsSubagents === true ? subagentCount : null}
                  brief={brief}
                  sessionId={sessionId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
