/**
 * dsh-chat-plus — ask_user_question 问答解析（纯函数，无 React / 无 DOM）。
 *
 * KR 右栏「提问与回答」卡要回答一件事：**模型问了什么、用户答了什么**。
 * 这两半分别落在互不相邻的两处数据里：
 *   · 问题在 tool call 的入参 JSON（questions 数组）；
 *   · 答案在工具结果文本里（answers 数组），或迟到回答时落在
 *     userQuestions 投影的 settled 行里。
 *
 * 官方 ui-tool 的 AskQuestionRow 自己解析一遍（questionEntries / answerEntries /
 * pairAnswers），但那份实现不导出、也不接受外部数据。本模块按同一语义重写一份
 * 最小版：**形状不一致就返回 null 交给调用方降级**，绝不半懂不懂地渲染半截。
 *
 * 解析口径与官方对齐的几处硬约定：
 *   · question.id / question.question 必须是字符串，重复 id 视为整批无效；
 *   · options 里任一条缺 label 就整批 options 作废（不是逐条丢弃）；
 *   · 多选字段两种拼写都认（线上是 snake_case multi_select，类型面是 multiSelect）；
 *   · 答案条目按 id 配对，配不上就整批 null —— 宁可只显示「已回复」不给细节，
 *     也不能把 A 题的答案挂到 B 题下面。
 *
 * 纯函数、无副作用，可直接在 smoke 里 import 断言。
 */

export interface AskOption {
  readonly label: string
  readonly description?: string
}

export interface AskQuestion {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly detail?: string
  readonly options?: readonly AskOption[]
  readonly multiSelect?: boolean
}

export interface AskAnswer {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

/** 一问一答的展示配对（values 为空 = 该题被跳过）。 */
export interface AskPair {
  readonly question: AskQuestion
  readonly values: readonly string[]
}

/**
 * 这次提问在卡片上该呈现成什么样。
 *
 *  · waiting     —— 模型正在等用户回答（面板可重开）
 *  · answered    —— 用户答完了
 *  · closed      —— 面板已关/超时且没有答案（模型按"用户没答"继续了）
 *  · cancelled   —— 用户主动取消
 *  · interrupted —— 回合被中断
 */
export type AskState = 'waiting' | 'answered' | 'closed' | 'cancelled' | 'interrupted'

export interface AskView {
  readonly state: AskState
  readonly questions: readonly AskQuestion[]
  /** 已配对的一问一答；问题解析失败时为空数组。 */
  readonly pairs: readonly AskPair[]
  /** 用户真正给了答案的题数（含自定义补充）。 */
  readonly answeredCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string): unknown {
  if (typeof text !== 'string' || text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 选项清单；不是数组时视为「没有选项」，数组里任一条不合格则整体作废。 */
function parseOptions(value: unknown): readonly AskOption[] | undefined {
  if (!Array.isArray(value)) return undefined
  const options: AskOption[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return undefined
    const label = str(entry.label)
    if (label === undefined) return undefined
    const description = str(entry.description)
    options.push({ label, ...(description === undefined ? {} : { description }) })
  }
  return options.length > 0 ? options : undefined
}

/** 问题清单；任何一条不合格就整批作废（与官方 questionEntries 同口径）。 */
export function parseAskQuestions(raw: unknown): readonly AskQuestion[] | null {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw
  if (!isRecord(parsed)) return null
  const list = parsed.questions
  if (!Array.isArray(list) || list.length === 0) return null
  const seen = new Set<string>()
  const questions: AskQuestion[] = []
  for (const entry of list) {
    if (!isRecord(entry)) return null
    const id = str(entry.id)
    const question = str(entry.question)
    if (id === undefined || question === undefined || seen.has(id)) return null
    seen.add(id)
    const options = parseOptions(entry.options)
    const header = str(entry.header)
    const detail = str(entry.detail)
    const multiSelect = typeof entry.multi_select === 'boolean'
      ? entry.multi_select
      : typeof entry.multiSelect === 'boolean' ? entry.multiSelect : undefined
    questions.push({
      id,
      question,
      ...(header === undefined ? {} : { header }),
      ...(detail === undefined ? {} : { detail }),
      ...(options === undefined ? {} : { options }),
      ...(multiSelect === undefined ? {} : { multiSelect }),
    })
  }
  return questions
}

/** 答案清单；形状不对返回 null。 */
export function parseAskAnswers(text: unknown): readonly AskAnswer[] | null {
  const parsed = typeof text === 'string' ? parseJson(text) : text
  if (!isRecord(parsed)) return null
  const list = parsed.answers
  if (!Array.isArray(list) || list.length === 0) return null
  const answers: AskAnswer[] = []
  for (const entry of list) {
    if (!isRecord(entry)) return null
    const id = str(entry.id)
    const selected = entry.selected
    if (id === undefined || !Array.isArray(selected)) return null
    if (!selected.every((item) => typeof item === 'string')) return null
    if (entry.custom !== undefined && typeof entry.custom !== 'string') return null
    const custom = str(entry.custom)
    answers.push({
      id,
      selected: selected as readonly string[],
      ...(custom === undefined ? {} : { custom }),
    })
  }
  return answers
}

/** 某一题的答案值：已选项 + 非空的自定义补充（官方 replyAnswerValues 同序）。 */
export function askValuesOf(answers: readonly AskAnswer[] | null, id: string): readonly string[] {
  if (answers === null) return []
  const hit = answers.find((answer) => answer.id === id)
  if (hit === undefined) return []
  return [...hit.selected, ...(hit.custom === undefined ? [] : [hit.custom])]
}

/** 逐题配对；问题或答案任一解析失败、或数量不一致时返回 null。 */
export function pairAskAnswers(
  questions: readonly AskQuestion[] | null,
  answers: readonly AskAnswer[] | null,
): readonly AskPair[] | null {
  if (questions === null || answers === null) return null
  if (questions.length !== answers.length) return null
  const byId = new Map<string, AskAnswer>()
  for (const answer of answers) {
    if (byId.has(answer.id)) return null
    byId.set(answer.id, answer)
  }
  const pairs: AskPair[] = []
  for (const question of questions) {
    const answer = byId.get(question.id)
    if (answer === undefined) return null
    pairs.push({ question, values: askValuesOf([answer], question.id) })
  }
  return pairs
}

/**
 * 工具结果里的纯文本。
 *
 * 官方的 singleResultText 只在「恰好一个 text 块」时认；这里放宽到 join，
 * 因为 ask 的结果就是一段 JSON 文本，多块拼接不会产生歧义，而漏认会让整张卡
 * 退化成「已回复但看不到答案」。
 */
export function askResultText(block: unknown): string {
  if (!isRecord(block)) return ''
  const content = block.content
  if (!Array.isArray(content)) return ''
  const texts = content
    .filter((part): part is { type: string; text: string } => (
      isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    ))
    .map((part) => part.text)
  return texts.length === 1 ? texts[0] as string : texts.join('\n')
}

/** 结果文本是不是「还没人回答，面板可重开」那一支。 */
export function isPendingAskResult(text: string): boolean {
  const parsed = parseJson(text)
  return isRecord(parsed) && parsed.pending === true && typeof parsed.callId === 'string'
}

/** 结果里的错误码（ASK_CANCELLED / ASK_ABORTED / TOOL_OUTCOME_UNKNOWN）。 */
export function askErrorCode(block: unknown): string | undefined {
  if (!isRecord(block)) return undefined
  const error = block.error
  if (!isRecord(error)) return undefined
  return str(error.code)
}

export interface AskViewInput {
  /** 调用入参原始 JSON。 */
  readonly argsRaw: string
  /** 工具结果文本；还没结果时传空串。 */
  readonly resultText: string
  /** 该调用是否仍在执行（尚无结果）。 */
  readonly running: boolean
  /** 投影里这个 callId 是否仍可作答（面板可重开）。 */
  readonly answerable: boolean
  /** 投影 settled 行里的答案（迟到回答只在这里）。 */
  readonly settledAnswers: readonly AskAnswer[] | null
  readonly errorCode?: string | undefined
}

/**
 * 一次提问的完整展示模型。
 *
 * 答案来源优先级：**投影 settled 优先**，其次结果文本里的 answers。
 * 迟到回答（超时后用户仍答了）只会记在投影里，结果文本里那份是旧的。
 */
export function buildAskView(input: AskViewInput): AskView {
  const questions = parseAskQuestions(input.argsRaw)
  const settled = input.settledAnswers
  const fromResult = parseAskAnswers(input.resultText)
  const answers = settled !== null && settled.length > 0 ? settled : fromResult
  const pairs = pairAskAnswers(questions, answers)
  const answeredCount = pairs === null ? 0 : pairs.filter((pair) => pair.values.length > 0).length

  let state: AskState
  if (input.errorCode === 'ASK_CANCELLED') state = 'cancelled'
  else if (input.errorCode === 'ASK_ABORTED') state = 'interrupted'
  else if (pairs !== null && answeredCount > 0) state = 'answered'
  else if (input.running) state = 'waiting'
  else if (input.answerable || isPendingAskResult(input.resultText)) state = 'waiting'
  else state = 'closed'

  return {
    state,
    questions: questions ?? [],
    pairs: pairs ?? [],
    answeredCount,
  }
}
