/**
 * dsh-chat-plus — 「操作面板」卡（右栏大盘第 4 张，挂在工具调用卡下方）。
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

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { useCrossfadeText, useHeightAnimation, useMotionAllowed, useSteppedFollow } from '../motion-utils.ts'
import { formatDuration } from '../tool-summary/tool-stats.ts'
import type { PlainIconKey, PlainStep } from './plain-language.ts'
import type { PlainTimeline } from './plain-timeline.ts'
import { useSubagentCatalog, type SubagentCatalogView } from './subagent-catalog.ts'

/** 列表视口最大行数：6 → 8（比上一版多约 40px，用户按实际观感定的档）。 */
const LIST_MAX_ROWS = 8
/** 被右栏挤压时（记忆卡常驻底部触发自适应降档）收一档。 */
const LIST_MAX_ROWS_SQUEEZED = 5

export interface KrPlainTimelineCardProps {
  readonly timeline: PlainTimeline
  readonly running: boolean
  /** 右栏被挤压时为 true，列表降一档高度。 */
  readonly squeezed?: boolean
  /** 当前会话 id：用于查该会话派生了哪些子智能体。 */
  readonly sessionId?: string | null
}

/** 类别图标：单色描边、13px，与既有工具行图标同一套视觉语言。 */
function Icon({ name }: { readonly name: PlainIconKey }): ReactElement {
  const common = {
    width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
  } as const
  switch (name) {
    case 'globe':
      return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" /></svg>
    case 'cursor':
      return <svg {...common}><path d="m3 2 10 5-4.2 1.6L7 13z" /></svg>
    case 'keyboard':
      return <svg {...common}><rect x="1.5" y="4" width="13" height="8" rx="1.5" /><path d="M4 6.5h.01M7 6.5h.01M10 6.5h.01M5 9.5h6" /></svg>
    case 'eye':
      return <svg {...common}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></svg>
    case 'scroll':
      return <svg {...common}><path d="M8 2v9M5 8.5 8 11.5l3-3M2.5 13.5h11" /></svg>
    case 'arrow':
      return <svg {...common}><path d="M13 8H3.5M7 4.5 3.5 8 7 11.5" /></svg>
    case 'folder':
      return <svg {...common}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.3 1.6h5.5A1.5 1.5 0 0 1 14 6.1v5.4A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" /></svg>
    case 'search':
      return <svg {...common}><circle cx="6.8" cy="6.8" r="4.3" /><path d="m10.2 10.2 3.3 3.3" /></svg>
    case 'terminal':
      return <svg {...common}><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="m4.5 6 2 2-2 2M8.5 10.5H12" /></svg>
    case 'image':
      return <svg {...common}><rect x="1.5" y="3" width="13" height="10" rx="1.5" /><circle cx="5.6" cy="6.4" r="1.1" /><path d="m2.5 11.5 3.6-3.3 3 2.6 2-1.8 2.4 2.2" /></svg>
    case 'download':
      return <svg {...common}><path d="M8 2v7.5M5 6.8 8 9.8l3-3M2.5 12.5h11" /></svg>
    case 'cloud':
      return <svg {...common}><path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.6-.6 2.9 2.9 0 0 1-.3 6.6z" /></svg>
    case 'bolt':
      return <svg {...common}><path d="M9 1.5 4 9h3.4l-.4 5.5L12 7H8.6z" /></svg>
    case 'task':
      return <svg {...common}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></svg>
    case 'spark':
      return <svg {...common}><path d="M8 1.8 9.4 6 13.6 7.4 9.4 8.8 8 13 6.6 8.8 2.4 7.4 6.6 6z" /></svg>
    case 'file':
    default:
      return <svg {...common}><path d="M9 1.8H4.5A1.5 1.5 0 0 0 3 3.3v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.8z" /><path d="M9 1.8v4h4" /></svg>
  }
}

/** 状态点：进行中转圈脉冲 / 已完成对勾 / 失败叉。 */
function StatusDot({ status }: { readonly status: PlainStep['status'] }): ReactElement {
  if (status === 'running') {
    return (
      <span className="kr-plain-dot kr-plain-dot--running" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="6" cy="6" r="4.2" strokeDasharray="3 3" />
        </svg>
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="kr-plain-dot kr-plain-dot--failed" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  return (
    <span className="kr-plain-dot kr-plain-dot--done" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M2.6 6.2 4.8 8.4 9.4 3.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
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

function StepRow({ step, index, showTech, catalog }: {
  readonly step: PlainStep
  readonly index: number
  /** 卡片级的「技术细节」总开关：开则本行展开，关闭时这一行干干净净。 */
  readonly showTech: boolean
  /** 仅当 step.spawnsSubagents 为真时才有内容。 */
  readonly catalog: SubagentCatalogView | null
}): ReactElement {
  const title = step.detail === undefined ? step.verb : `${step.verb} · ${step.detail}`
  const techText = step.tech === undefined
    ? ''
    : [step.tech.name, step.tech.args, step.tech.error].filter(Boolean).join('\n')
  return (
    <div
      className="kr-plain-step"
      data-status={step.status}
      data-nested={step.spawnsSubagents === true ? 'true' : undefined}
      data-tech={showTech && techText !== '' ? 'open' : undefined}
      // 错峰入场：只对靠后的若干条错开，卡片整体不拖出一段长尾。
      style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
    >
      <span className="kr-plain-step__dot" aria-hidden><StatusDot status={step.status} /></span>
      <span className="kr-plain-step__icon" aria-hidden><Icon name={step.icon} /></span>
      <span className="kr-plain-step__title" title={title}>{title}</span>
      {step.durationMs !== undefined && step.durationMs > 40 && (
        <span className="kr-plain-step__time">{formatDuration(step.durationMs)}</span>
      )}
      {step.spawnsSubagents === true && catalog !== null && (
        <span className="kr-plain-step__subcount">
          {catalog.state === 'ready' ? `${catalog.rows.length} 个子智能体` : '子智能体'}
        </span>
      )}
      {showTech && techText !== '' && <pre className="kr-plain-step__tech">{techText}</pre>}
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
  /**
   * 「技术细节」改成**卡片级**总开关。
   *
   * 原来每行挂一枚「技术细节」按钮：一轮 15 步就是 15 枚一模一样的按钮并排
   * 在右边，横向噪声比内容还大，还把每行标题的可用宽度压掉一截。现在收成
   * 头部一枚开关，开了每行下方统一展开——看全部技术细节本来就是一个整体意图，
   * 不该让人逐条点十五次。
   */
  const [showTech, setShowTech] = useState(false)
  const motion = useMotionAllowed(true)
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(open, motion)
  const nowLayers = useCrossfadeText(timeline.nowLabel, motion)

  /*
   * 子智能体清单只在**本轮真的派生了子智能体**时才去订阅。
   * 没有派生动作时完全不接轮询 —— 绝大多数轮次压根不 spawn，任何时候都在
   * 读目录是白花的开销。
   */
  const hasSpawning = useMemo(
    () => timeline.steps.some((step) => step.spawnsSubagents === true),
    [timeline.steps],
  )
  const subagentCatalog = useSubagentCatalog(hasSpawning ? sessionId : null)

  /** 本轮是否有任何一条带技术信息（决定头部那枚开关渲不渲染）。 */
  const hasTech = useMemo(
    () => timeline.steps.some((step) => step.tech !== undefined
      && [step.tech.name, step.tech.args, step.tech.error].some((part) => part !== undefined && part !== '')),
    [timeline.steps],
  )

  // 跟随探针：条目数 / 当前动作 / 预告任一变化都重新贴底。
  const probe = useMemo(
    () => `${timeline.steps.length}:${timeline.nowLabel}:${timeline.intent ?? ''}`,
    [timeline.steps.length, timeline.nowLabel, timeline.intent],
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
  /*
   * 徽标只报规模，不报状态。
   *
   * 原来运行中会变成「进行中」，那是标题行右边和「技术细节」并排的第二枚状态
   * 提示，而此刻标题行中间那句「正在派出子任务」已经把"现在在干什么"说完了——
   * 两句话讲同一件事，右侧还因此挤了一枚。运行态由那句话承载（它随动作实时
   * 变化），徽标回到它该干的活：这一轮一共几步。
   */
  const badge = empty ? '待开始' : `${timeline.steps.length} 步`
  const maxRows = squeezed ? LIST_MAX_ROWS_SQUEEZED : LIST_MAX_ROWS

  return (
    <div className="kr-card kr-card--plain" data-empty={empty || undefined}>
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
         * 「当前在做什么」与标题同行，不再单独占正文一整行。
         *
         * 原来它是卡片正文的第一行（「正在放大查看局部」），标题行只有"操作面板"
         * 四个字 + 徽标，中间空着一大片；把它提到标题右侧后，这张卡的表头本身就
         * 回答了"此刻它在干什么"，正文从「接下来」或步骤列表直接开始，省下一整行。
         *
         * 宽度不够时整段 ellipsis（不是换行——换行会把标题行撑成两行，等于没省）。
         */}
        <span className="kr-plain-now kr-plain-now--inline" title={timeline.nowLabel}>
          <span className="kr-plain-now__stack">
            {nowLayers.map((layer) => (
              <span
                key={layer.id}
                className="kr-plain-now__layer"
                data-phase={layer.exiting ? 'out' : 'in'}
                aria-hidden={layer.exiting || undefined}
              >
                {layer.text}
              </span>
            ))}
          </span>
        </span>
        <span className={`kr-card__badge ${running ? 'kr-card__badge--running' : 'kr-card__badge--done'}`}>
          {badge}
        </span>
        {hasTech && (
          <button
            type="button"
            className="kr-plain-tech-toggle"
            data-on={showTech ? 'true' : undefined}
            aria-pressed={showTech}
            onClick={(event) => { event.stopPropagation(); setShowTech((value) => !value) }}
          >
            技术细节
          </button>
        )}
      </div>

      {bodyPresent && (
        <div
          ref={bodyRef}
          className="kr-plain-body"
          data-open={open || undefined}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          {/* 「当前在做什么」已提到标题行（见 header 里那段注释），正文从预告
              或步骤列表直接开始。 */}

          {/* 预告：模型自己写的「下一步：…」，没有就整行不出现。 */}
          {timeline.intent !== undefined && (
            <div className="kr-plain-intent" data-live={running ? 'true' : undefined}>
              <span className="kr-plain-intent__label">接下来</span>
              <span className="kr-plain-intent__text">{timeline.intent}</span>
            </div>
          )}

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
              {timeline.steps.map((step, index) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={index}
                  showTech={showTech}
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
