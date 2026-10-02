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
 *   · 逐题错峰入场（kr-ask-row-in）；被选中的那条带一次 scale 回弹落位
 *     （kr-ask-pick-in），读作"被放上去的"，而不是"本来就是蓝的"；
 *   · 展开/收起走 useHeightAnimation 的高度补间，不是 display 硬切。
 */
import { memo, useMemo, useState } from 'react'
import { useHeightAnimation, useMotionAllowed } from '../motion-utils.ts'
import { toolArgsRaw } from '../tool-summary/activity-view-model.ts'
import { isRunning } from '../tool-summary/tool-stats.ts'
import {
  askErrorCode,
  askResultText,
  buildAskView,
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
export const KrAskCard = memo(function KrAskCard({ asks, inline = false }: KrAskCardProps) {
  const motion = useMotionAllowed(true)
  const [open, setOpen] = useState(true)
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(open, motion)

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

      <div className="kr-ask-body" ref={bodyRef} aria-hidden={open ? undefined : true}>
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
    </div>
  )
})
