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
 *  · answered    —— 用户答完了（部分题跳过也算 answered，逐题读数见 answeredCount）
 *  · resumed     —— 等待超时 / 面板被关 / 结果里根本没有答案，模型按"用户没答"
 *                   继续往下做了。**这是超时提问唯一能被观测到的形态**：
 *                   legacy 模式下超时不会留下 ASK_TIMED_OUT，也不会留下 pending
 *                   结果，只留下"调用已结束、答案为空"这一个事实。
 *                   措辞上必须与"用户主动跳过"分开：这里没人做选择，是时间到了。
 *  · cancelled   —— 用户主动取消了这次提问
 *  · interrupted —— 调用被中断（ASK_ABORTED，或回合被用户停止）
 */
export type AskState = 'waiting' | 'answered' | 'resumed' | 'cancelled' | 'interrupted'

export interface AskView {
  readonly state: AskState
  readonly questions: readonly AskQuestion[]
  /** 已配对的一问一答；问题解析失败时为空数组。 */
  readonly pairs: readonly AskPair[]
  /** 用户真正给了答案的题数（含自定义补充）。 */
  readonly answeredCount: number
  /**
   * 这次提问是不是**等待超时**收场的。
   *
   * 只影响措辞（"超时未答" vs "未提交回答"），不影响状态机：legacy 模式下超时
   * 是静默的（既没有 ASK_TIMED_OUT 也没有 pending 结果），所以这里的 false
   * 不代表"不是超时"，只代表"没有证据说是超时"。措辞必须诚实到这个粒度。
   */
  readonly timedOut: boolean
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

/**
 * 结果里的错误码（ASK_CANCELLED / ASK_ABORTED / ASK_TIMED_OUT / TOOL_OUTCOME_UNKNOWN）。
 *
 * ASK_TIMED_OUT 只在 timed 模式、且客户端真的把倒计时跑到零时才会落到结果里；
 * legacy 模式下超时是**静默**的（见 AskState.resumed 的注释），所以状态机里
 * 超时主要靠"running 已结束 + 没有答案"这条路认出来，这里的码只做加分项。
 */
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

  /*
   * 状态机的顺序本身就是优先级，几条别动：
   *  1. 显式错误码最硬（用户取消 / 调用被中断），它盖过一切推断；
   *  2. **还在跑，或投影说仍可作答** → waiting。这两条必须排在 answered 之前：
   *     迟到回答的场景是"超时后用户又答了"，面板还开着，卡片不该读成已收口；
   *  3. 有答案 → answered；
   *  4. 其余 = 调用结束、没有答案 —— 即 resumed（超时 / 面板关闭 / 用户没答）。
   *     **绝不能落到 waiting**：那会让一张早已作废的卡片永远转着等待动效，
   *     正是"超时的提问显示不出来"这条反馈的成因。
   */
  let state: AskState
  if (input.errorCode === 'ASK_CANCELLED') state = 'cancelled'
  else if (input.errorCode === 'ASK_ABORTED') state = 'interrupted'
  else if (input.running) state = 'waiting'
  else if (input.answerable || isPendingAskResult(input.resultText)) state = 'waiting'
  else if (pairs !== null && answeredCount > 0) state = 'answered'
  else state = 'resumed'

  return {
    state,
    questions: questions ?? [],
    pairs: pairs ?? [],
    answeredCount,
    timedOut: state === 'resumed' && input.errorCode === 'ASK_TIMED_OUT',
  }
}

/* ══ 展开后的结论行与题干分段（纯函数，smoke 可直接断言） ═══════════════════ */

/** 结论行该用什么语气上色（与卡头状态读数同一套语义）。 */
export type AskVerdictTone = 'waiting' | 'answered' | 'unanswered'

export interface AskVerdict {
  readonly tone: AskVerdictTone
  /** 一行结论，直接印在展开后正文的第一行。 */
  readonly text: string
}

/**
 * 展开后正文顶部那一行结论：**先给结果，再给细节**。
 *
 * 为什么需要它：折叠态只有卡头一行读数（"已回答 / 未回答"），展开后如果直接跳到
 * 问题清单，读者得自己把"这些问题有没有被答"算一遍。超时那种情形尤其糟 ——
 * 清单看起来和"正在等你答"一模一样，而事实是这一轮早就过去了。
 *
 * 措辞口径（用户点名过的三条）：
 *  · 「已跳过」只留给用户**主动**跳过，超时绝不能写成跳过（没人做选择）；
 *  · 超时能确认时明说"超时"（timed 模式有 ASK_TIMED_OUT）；
 *  · 确认不了时只说"未提交回答"——不猜，也不含糊其辞。
 */
export function askVerdict(view: AskView): AskVerdict {
  const total = view.questions.length
  const picked = view.answeredCount
  const progress = total > 0 && picked > 0 && picked < total ? `${picked}/${total} 已回答` : ''
  switch (view.state) {
    case 'waiting':
      return { tone: 'waiting', text: total > 1 ? `等待回答（共 ${total} 题）` : '等待回答' }
    case 'answered':
      return { tone: 'answered', text: progress === '' ? '已提交回答' : `已提交回答（${progress}）` }
    case 'cancelled':
      return { tone: 'unanswered', text: '已取消，未提交回答' }
    case 'interrupted':
      return { tone: 'unanswered', text: '本轮已中断，未提交回答' }
    default:
      return {
        tone: 'unanswered',
        text: view.timedOut ? '等待超时，未提交回答' : '未提交回答，模型已继续',
      }
  }
}

/** 题干的一段：正文 or 括号里的补充说明（后者用次级色）。 */
export interface AskTextSegment {
  readonly kind: 'text' | 'note'
  readonly text: string
}

/**
 * 题干切成「正文 / 括号说明」两段。
 *
 * 读者扫问题清单时看的是**问题本身**，括号里那截（范围、默认值、补充限定）
 * 属于注解。两者用同一个字色时，长题干会连成一片灰，眼睛得逐字读才知道哪截是
 * 重点。拆开之后括号走次级色，问题骨架立刻浮出来。
 *
 * 只认成对括号（全角「（）」与半角「()」都算），**落单的括号不拆** —— 把
 * "价格 (元/斤" 这种半截括号也切开，会得到一段凭空多出来的灰色尾巴。
 */
export function splitAskQuestionText(text: string): readonly AskTextSegment[] {
  if (typeof text !== 'string' || text === '') return []
  const segments: AskTextSegment[] = []
  let cursor = 0
  for (let index = 0; index < text.length; index += 1) {
    const open = text[index]
    if (open !== '（' && open !== '(') continue
    const closeChar = open === '（' ? '）' : ')'
    const close = text.indexOf(closeChar, index + 1)
    if (close === -1) continue
    if (index > cursor) segments.push({ kind: 'text', text: text.slice(cursor, index) })
    segments.push({ kind: 'note', text: text.slice(index, close + 1) })
    cursor = close + 1
    index = close
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments.length > 0 ? segments : [{ kind: 'text', text }]
}

/**
 * 题干里该被加粗的**前导关键词**：冒号（全角/半角）之前那一截。
 *
 * 模型写问题几乎都是一个句式：「要不要改渲染方式：现在这样……」。冒号前那截
 * 就是这条问题的标签，加粗它，一屏五六条问题时能竖着扫完；没有冒号就整句不加粗
 * （给半句随机加粗比不加更吵）。
 *
 * 三条门槛，缺一条就不加粗——**加粗必须稀有**，乱加一遍等于全都不加：
 *  · 短：≤ 12 字。实测 17 字的"任务概览卡里「进行中」有两处"已经是一句完整
 *    的判断，加粗后整条问题一半是黑体，反而看不出重点；
 *  · 干净：不含句读（。，、；！？…）。带逗号的前导是叙述，不是标签；
 *  · 单行：不许跨行（\n），跨行的"前导"必然是整段正文。
 */
export function askQuestionLead(text: string): string | null {
  if (typeof text !== 'string') return null
  const hit = /^([^：:\n]{1,12})[：:]/.exec(text)
  const lead = hit?.[1]?.trim()
  if (lead === undefined || lead === '') return null
  if (/[。，、；！？…]/.test(lead)) return null
  return lead
}
