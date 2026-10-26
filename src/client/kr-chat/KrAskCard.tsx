/**
 * dsh-chat-plus — KR 对话流里的「提问与回答」卡片。
 *
 * 回答一件事：**这一轮模型问了什么、用户答了什么**。
 *
 * 为什么需要这张卡：KR 对话流只保留答案投影，工具明细整类隐藏（见
 * kr-chat/styles.ts 顶部那张对照），而 ask_user_question 走的是 tool-call 节点 ——
 * 于是问答整段从对话流里消失：模型说"我先确认一下"，下一句直接开工，中间那次
 * 问答没有留下任何痕迹。问答不是工具明细，它是**对话本身的一半**，必须有地方
 * 显示。
 *
 * 位置：**贴在 KR 对话流里、紧跟思考过程卡下方**（挂在同一个 assistant-step
 * 锚点上，见 ThinkingStepNodeView）。与思考卡当年从右栏搬进对话流同一个理由：
 * 思考、提问、回答是同一件事的几段，分两栏摆就得来回对照才读得完整。
 *
 * 数据来源：本轮工具节点里的 ask_user_question 调用（问题在入参 JSON，答案在
 * 结果文本的 answers 里）。解析逻辑见 ask-parse.ts。
 *
 * 动效（用户对这块有明确偏好）：
 *   · 卡片入场走通用 kr-card-in；
 *   · 等待回答时标题右侧三点跳动 + 竖线呼吸，读作"在等你"；
 *   · **回合收口时自动收起**（inline 模式，与思考过程卡同一套行为）：回答落定、
 *     正式回复出来之后，问答退成标题一行让位给正文，点标题随时能再展开；
 *   · 展开/收起走 useHeightAnimation 的高度补间，不是 display 硬切。
 *
 * 展开后的版式（2026-10-26 按用户给的样式重做）：
 *
 *   本轮已中断，未提交回答          ← 结论行（次级色，独立一行）
 *   · 要不要改渲染方式：现在这样…    ← 问题清单，一条一项、圆点在前
 *   · 卡片宽度（跟随对话流列宽）…
 *
 * 三件事缺一不可：**先说结果、再列问题**；每条问题前面有圆点（读作清单，不是
 * 一坨段落）；问题里冒号前那截加粗、括号里的补充说明降一档灰。超时/中断那句
 * 话不再混进问题行里 —— 之前它和问题挤在一起时，读者会误以为那是问题的一部分。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useHeightAnimation, useMotionAllowed } from '../motion-utils.ts'
import { toolArgsRaw } from '../tool-summary/activity-view-model.ts'
import { isRunning } from '../tool-summary/tool-stats.ts'
import {
  askErrorCode,
  askQuestionLead,
  askResultText,
  askVerdict,
  buildAskView,
  splitAskQuestionText,
  type AskPair,
  type AskView,
} from './ask-parse.ts'

/** 一条提问（同一次调用的问题与答案）。 */
export interface AskEntry {
  /** 调用 key，用作列表 key。 */
  readonly id: string
  readonly view: AskView
}

/** 调用名：运行中的块直接带 name，已结束的在 call.name 上。 */
function askCallName(root: unknown): string {
  if (typeof root !== 'object' || root === null) return ''
  const record = root as { name?: unknown; call?: { name?: unknown } }
  if (typeof record.name === 'string') return record.name
  const nested = record.call?.name
  return typeof nested === 'string' ? nested : ''
}

/**
 * 从本轮工具节点里抽出所有提问，按出现顺序返回。
 *
 * 一个回合可能问过多次（问一次、答完、接着又问），所以是数组。节点形状未知
 * 时跳过该节点——单条坏数据不该让整张卡消失。
 */
export function collectAsks(tools: readonly unknown[]): readonly AskEntry[] {
  const out: AskEntry[] = []
  for (const candidate of tools) {
    const node = candidate as { key?: string; data?: { root?: unknown } }
    const root = node?.data?.root
    if (root === undefined || root === null) continue
    if (askCallName(root) !== 'ask_user_question') continue
    try {
      const running = isRunning(root as never)
      const view = buildAskView({
        argsRaw: toolArgsRaw(root as never),
        resultText: running ? '' : askResultText(root),
        running,
        answerable: false,
        settledAnswers: null,
        errorCode: running ? undefined : askErrorCode(root),
      })
      if (view.questions.length > 0 || view.pairs.length > 0) {
        out.push({ id: node.key ?? String(out.length), view })
      }
    } catch {
      // 单个节点解析失败不影响其余提问
    }
  }
  return out
}

/**
 * 一行问答：**问句一行、答案一行**。
 *
 * 只显示用户**实际选了什么**，不再罗列所有候选项（2026-10-02 按用户要求）。
 *
 * 为什么不列候选：这张卡是**已经发生过的事实的记录**，读者要看的是"当时问了什么、
 * 我答了什么"，而不是一份可以重新选择的问卷。把三个候选项全铺出来，答案就淹在
 * 另外两个没被选的里 —— 每次都要在三条里找哪条是亮的，而"没被选的那两条"对
 * 读者是零信息。选中的那条**自己就是答案**，直接当答案显示最省读。
 *
 * 想回看完整候选（含当时没选的），走卡片头上官方那行的「查看回答」面板 ——
 * 那是官方为"重看整份问卷"准备的出口，比在这里堆列表更合适。
 */
function AskPairRow({ pair, settled }: {
  readonly pair: AskPair
  /** 整次提问已经收口（不再是"等待回答"）：未答的题才该标「已跳过」。 */
  readonly settled: boolean
}) {
  const { question, values } = pair
  return (
    <div className="kr-ask-row" data-answered={values.length > 0 || undefined}>
      {question.header !== undefined && <span className="kr-ask-row__tag">{question.header}</span>}
      <span className="kr-ask-row__q">{question.question}</span>
      {question.detail !== undefined && <span className="kr-ask-row__detail">{question.detail}</span>}

      {/*
       * 答案：用户选中的选项 label、或多选时的多个 label、或手打的自定义内容。
       * 官方答案结构里 selected 与 custom 可以同时存在（"选了某项 + 又补了一句"），
       * 所以两者都渲染，各占一行。
       */}
      {values.length > 0 ? (
        <div className="kr-ask-row__answer">
          {values.map((value) => (
            <span key={value} className="kr-ask-pick">{value}</span>
          ))}
        </div>
      ) : (
        settled && <span className="kr-ask-row__skip">未选择，已跳过</span>
      )}
    </div>
  )
}

export interface KrAskCardProps {
  /** 本轮抽出的提问（时间升序）。 */
  readonly asks: readonly AskEntry[]
  /**
   * 内联模式：贴在 KR 对话流里（挂在 assistant-step 节点上，紧跟思考过程卡
   * 下方）。右栏大盘不再有这张卡——问答与它对应的思考、回答是同一件事的几段，
   * 分两栏摆就得来回对照才读得完整（与思考卡当年从右栏搬进对话流同一个理由）。
   */
  readonly inline?: boolean
  /**
   * 内联模式：回合的**总结卡出现了**（与 KrReasoningCard 同名同义，由
   * ThinkingStepNodeView 用同一个 `summarizing` 传下来）。
   *
   * 翻转为 true 的那一刻收起卡片——用户要求「回复完成后这个提问也收起」：
   * 问答是过程材料，正式回复落定后它该退成标题一行让位给正文，而不是继续摊在
   * 答案上方占屏。此后点标题行随时能再展开重读。
   *
   * 判据必须是**翻转**而不是持续态：后者会在用户手动展开历史轮次后被下一次
   * 重渲染立刻按回去，「点开看看」这个动作根本留不住（思考卡踩过同一个坑，
   * 见 KrReasoningCard 里 summarize 自动折叠那段）。
   */
  readonly summarizing?: boolean
}

/**
 * 「提问与回答」卡。
 *
 * 空态策略与「任务概览」卡不同：这里**整张 return null**，不常驻空壳。
 * 理由：任务清单是模型每轮几乎都会写的东西（空态有信息量："这轮还没列计划"），
 * 而提问是**偶发事件** —— 绝大多数回合根本没有提问。常驻一张写着"本轮没有提问"
 * 的卡，等于用一块固定高度换一句"没有的事"，而对话流里每一行都在抢读者的注意力。
 * 所以没提问时这张卡不存在，有提问时它紧跟在思考卡下面。
 */
export const KrAskCard = memo(function KrAskCard({ asks, inline = false, summarizing = false }: KrAskCardProps) {
  const motion = useMotionAllowed(true)
  /*
   * 初始态：**只认 summarizing**（这回合的总结卡出来没有），与思考卡同一口径。
   *
   * 不能让「等待回答」参与初始折叠：模型问完到用户答完这段时间卡是活的，
   * 折叠了用户根本看不到它在问什么。历史轮次进来时 summarizing 本就是 true
   * （那些回合的 tail.closing 早被清空，turnClosed 直接按 data.status 判定），
   * 所以历史轮次开箱即折叠，正是要的效果。
   */
  const [open, setOpen] = useState(!(inline && summarizing))
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(open, motion)

  /*
   * 收口自动收起：只在 summarizing 由 false→true 的**那一次**翻转上触发。
   * 与 KrReasoningCard 的实现逐字同构，两卡行为不漂移。
   */
  const wasSettlingRef = useRef(summarizing)
  useEffect(() => {
    const was = wasSettlingRef.current
    wasSettlingRef.current = summarizing
    if (!inline || !summarizing || was) return
    setOpen(false)
  }, [inline, summarizing])

  // 汇总状态：只要还有一次在等回答，整张卡就是"等待回答"。
  const summary = useMemo(() => {
    const waiting = asks.filter((entry) => entry.view.state === 'waiting').length
    const answered = asks.filter((entry) => entry.view.state === 'answered').length
    const total = asks.reduce((count, entry) => count + entry.view.questions.length, 0)
    const picked = asks.reduce((count, entry) => count + entry.view.answeredCount, 0)
    // 状态读数只留必要的：等待 / 已回答 / 未回答。多问时补一个进度。
    const label = waiting > 0
      ? '等待回答'
      : answered > 0
        ? (total > picked ? picked + '/' + total + ' 已回答' : '已回答')
        : '未回答'
    return { waiting, answered, total, picked, label }
  }, [asks])

  if (asks.length === 0) return null

  const waiting = summary.waiting > 0

  return (
    <div
      className="kr-card kr-card--ask"
      data-inline={inline || undefined}
      data-state={waiting ? 'waiting' : 'settled'}
      data-open={open || undefined}
    >
      <div
        className="kr-card__header"
        onClick={() => setOpen((value) => !value)}
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
          {/* 对话气泡 + 问号：这张卡讲的是"有人在问你"，与任务清单、灯泡、
              扳手、大脑都不撞形。 */}
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.4 7.3c0-2.5 2.5-4.5 5.6-4.5s5.6 2 5.6 4.5-2.5 4.5-5.6 4.5c-.5 0-1-.1-1.5-.2l-2.7 1.4.6-2.2c-1.2-.8-2-2.1-2-3.5Z" />
            <path d="M8 5.9v.01M8 7.6v1.7" />
          </svg>
        </span>
        <span className="kr-card__title">提问与回答</span>
        <span className="kr-card__meta">
          {waiting && (
            <span className="kr-ask-dots" aria-hidden>
              <i /><i /><i />
            </span>
          )}
          {summary.label}
        </span>
        <span className="kr-ask-chevron" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6.2 8 10.2l4-4" />
          </svg>
        </span>
      </div>

      {/*
       * 折叠体用 `bodyPresent || open` 门控，与思考卡（KrReasoningCard）同一写法：
       * useHeightAnimation 在收起动画播完后才把 present 置回 false，条件里带上 open
       * 是给「收起途中又被展开」留一条立即挂回的路（只写 bodyPresent 会在快速连点
       * 时出现一次空帧：高度补间在跑，内容却还没挂回来）。
       *
       * 折叠态叠加 inert + aria-hidden：收起的问答仍然留在 DOM 里（补间需要它），
       * 但它既不该被读屏念出来，也不该被 Tab 键聚焦进去。
       */}
      {(bodyPresent || open) && (
        <div
          className="kr-ask-body"
          ref={bodyRef}
          data-open={open || undefined}
          aria-hidden={open ? undefined : true}
          {...(!open ? { inert: '' } : {})}
        >
          {bodyPresent && asks.map((entry) => (
            <div className="kr-ask-group" key={entry.id}>
              {entry.view.pairs.length > 0 ? (
                entry.view.pairs.map((pair) => (
                  <AskPairRow
                    key={pair.question.id}
                    pair={pair}
                    settled={entry.view.state !== 'waiting'}
                  />
                ))
              ) : (
                /*
                 * 问题解析失败（形状不认识）时的降级：只报状态，不猜内容。
                 * 半懂不懂地渲染半截问题，比什么都不显示更糟——用户会以为那就是
                 * 模型问的原话。
                 */
                <span className="kr-ask-fallback">
                  {entry.view.state === 'waiting' ? '模型正在提问，内容暂不可读' : '这次提问的内容无法解析'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
