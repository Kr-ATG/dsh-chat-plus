/**
 * dsh-chat-plus — 人话行动时间线组装（plain-timeline）。
 *
 * 把「本轮的工具调用事实」+「模型自己播报的下一步」组装成一条**按时间升序、
 * 全中文、可读**的行动流，供右栏「操作面板」卡渲染。
 *
 * 两路输入各司其职：
 *  · **steps（已经做了什么）** ← 工具调用节点。事实源，只有客户端知道；
 *  · **intent（准备做什么）** ← 思考文本里模型自己写的 `下一步：…`。由
 *    PLAIN_PROGRESS_RULE 注入通道约定而来，模型不写就退化成工具推导文案。
 *
 * 纯函数：相同输入返回等价输出，无副作用，可在 smoke 里直接断言。
 */

import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only：激活 ui-chat / ui-tool 的 SlotMap 增强，让 ChatNode 解析到宿主类型。
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { callDurationMs, callName, isRunning } from '../tool-summary/tool-stats.ts'
import { argFields, resultParagraphs, toolArgsRaw, viewPhase } from '../tool-summary/activity-view-model.ts'
import { isMetaTool, toPlainStep, type PlainStep } from './plain-language.ts'

/** 预告行最长 60 字：超过多半是模型把整段思考写进来了，截掉更利落。 */
const MAX_INTENT = 60

export interface PlainTimeline {
  /** 模型播报的「接下来准备做什么」；未播报则为 undefined。 */
  readonly intent?: string
  /** 折叠态那一行动作短语：现在到底在干什么。 */
  readonly nowLabel: string
  /** 已执行 / 执行中的人话步骤，时间升序。 */
  readonly steps: readonly PlainStep[]
  readonly activeCount: number
  readonly doneCount: number
  readonly failedCount: number
}

/**
 * 卡片当前该显示哪一份步骤：完整时间线，还是只留重要节点。
 *
 * `brief` 模式下由 `condenseSteps()` 产出，规则见那里的注释。
 */
export type PlainStepView = 'full' | 'brief'

export interface PlainTimelineInput {
  /** 本轮思考文本（已按块收集）。 */
  readonly reasoningTexts: readonly string[]
  /**
   * 已抽好的「下一步」，用来跳过本函数内的抽取。
   *
   * 抽取要对**整轮**思考做一次 join + 逐行正则匹配，是这条链路上最贵的一步；
   * 而 steps 那边为了刷新「进行中」那一条的耗时，`now` 每秒都在变。若把两者
   * 绑在一个 useMemo 里，等于每秒重扫几千字思考一次。调用方把
   * `extractIntent()` 单独 memo（只依赖 reasoningTexts）后把结果传进来，
   * 这份开销就只在思考真的增长时才付。
   *
   * 传 undefined 时照常自己抽——纯函数语义不变，smoke 照旧直接调。
   */
  readonly intent?: string | undefined
  /** 本轮工具调用节点，须按 anchorSeq 升序（collectTurnNodes 已保证）。 */
  readonly tools: readonly ChatNode<'tool-call'>[]
  /** 本轮是否仍在执行。 */
  readonly running: boolean
  /** 当前时刻（ms），用于算进行中调用的耗时。 */
  readonly now: number
}

/**
 * 从思考文本里抽「接下来准备做什么」。
 *
 * 取**最后一条**匹配而不是第一条：思考是流式追加的，同一句话会在后续 chunk 里
 * 再出现一次（模型重述），取最后一条天然完成去重，也天然反映最新意图。
 *
 * 先试行首严格匹配（注入契约要求行首就是「下一步：」），再退到行内匹配 ——
 * 模型偶尔会把标记写成句子中间，宁可放过也不要整条丢掉。
 */
export function extractIntent(reasoningTexts: readonly string[]): string | undefined {
  const whole = reasoningTexts.join('\n')
  if (whole.trim() === '') return undefined
  const lines = whole.split('\n')
  let found: string | undefined
  for (const line of lines) {
    const strict = /^\s*下一步[：:]\s*(.+?)\s*$/.exec(line)
    if (strict?.[1] !== undefined) {
      found = strict[1]
      continue
    }
    const loose = /下一步[：:]\s*([^，。；\n]{2,40})/.exec(line)
    if (loose?.[1] !== undefined) found = loose[1]
  }
  if (found === undefined) return undefined
  const clean = found.replace(/\s+/g, ' ').trim()
  if (clean === '') return undefined
  return clean.length > MAX_INTENT ? `${clean.slice(0, MAX_INTENT - 1)}…` : clean
}

function statusOf(root: Parameters<typeof viewPhase>[0]): 'running' | 'done' | 'failed' {
  const phase = viewPhase(root)
  if (phase === 'running') return 'running'
  if (phase === 'failed' || phase === 'interrupted') return 'failed'
  return 'done'
}

/** 失败调用的错误原文。形状随宿主版本变过，一律防御式取，取不到就 undefined。 */function errorTextOf(root: unknown): string | undefined {
  if (typeof root !== 'object' || root === null) return undefined
  const record = root as { isError?: unknown; error?: unknown }
  if (record.isError !== true) return undefined
  const error = record.error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return undefined
}

/** 判元信息那一步不能抛：节点形状未知时按「不是 todo」处理。 */
function safeCallName(node: ChatNode<'tool-call'>): string {
  try {
    return callName(node.data.root)
  } catch {
    return ''
  }
}

/** 读 todo_write 的 todos 列表；形状不对返回 null（汇总行照常出，只少计数）。 */
function safeTodoList(node: ChatNode<'tool-call'>): ReadonlyArray<{ status?: unknown }> | null {
  try {
    const todos = argFields(toolArgsRaw(node.data.root)).todos
    return Array.isArray(todos) ? (todos as ReadonlyArray<{ status?: unknown }>) : null
  } catch {
    return null
  }
}

/** 降级提示只报一次，避免每帧刷屏。 */
let warnedDegrade = false

export function buildPlainTimeline(input: PlainTimelineInput): PlainTimeline {
  const main: PlainStep[] = []
  /*
   * 任务清单维护（todo_write）**按时间原位出现一次**，不再甩到末尾。
   *
   * 旧做法是把它当"元信息"强行挪到最后：理由是模型每改一次任务状态就重写
   * 一次清单，按时间排会得到「更新清单 → 做A → 更新清单 → 做B」这种反复穿插。
   * 但那张卡叫"操作面板"、是一列按顺序的步骤，读者默认它按发生时间读——把
   * 一件往往发生在**开头**的事（模型列计划）固定甩到最后，等于对用户撒了个
   * 小谎。而且任务状态已经有上面那张「任务概览」卡实时在显示，这里逐条重复
   * 纯属冗余。
   *
   * 现在折中：整轮只出**一行汇总**，钉在它第一次出现的位置，说清「改了几次、
   * 完成了几项」。既不打断阅读，也不破坏时间语义，还留着「模型在按计划推进」
   * 这个事实。
   */
  let todoCalls = 0
  let todoAt = -1
  let todoDone = 0
  let todoTotal = 0

  for (const [index, node] of input.tools.entries()) {
    if (isMetaTool(safeCallName(node))) {
      todoCalls += 1
      if (todoAt < 0) todoAt = main.length
      const todos = safeTodoList(node)
      if (todos !== null) {
        todoTotal = todos.length
        todoDone = todos.filter((item) => item?.status === 'completed').length
      }
      continue
    }
    let step: PlainStep
    try {
      const root = node.data.root
      const name = callName(root)
      const durationMs = callDurationMs(root, input.now)
      const errorText = errorTextOf(root)
      step = toPlainStep({
        id: node.key || `plain-${index}`,
        toolName: name,
        args: argFields(toolArgsRaw(root)),
        argsRaw: toolArgsRaw(root),
        // 结果文本只为「落地 URL 与请求不一致」服务（见 plain-language 的
        // landedUrlOf）；只有已结束、且有文本时才去拼，避免运行中反复 join。
        ...(isRunning(root) ? {} : { resultText: resultParagraphs(root) }),
        status: statusOf(root),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(errorText !== undefined ? { errorText } : {}),
      })
    } catch (error) {
      // 未知节点形状不该让整条时间线消失：给一条最小可显示的兜底。
      //
      // 但必须留一条 warn：这份兜底**会把代码级错误也一起吞掉**（一次漏 import
      // 的 `isRunning` 变成 ReferenceError → 整条时间线全是「执行操作」，界面
      // 上看着只是"翻译得不好"，没有任何线索指向真正的错误）。去重后每个进程
      // 最多报一次，既能定位又不刷屏。
      if (!warnedDegrade) {
        warnedDegrade = true
        console.warn('[kr-plain-timeline] 有工具调用无法翻译，已降级为「执行操作」：', error)
      }
      step = toPlainStep({ id: `plain-fallback-${index}`, toolName: '', status: 'done' })
    }
    main.push(step)
  }

  if (todoCalls > 0) {
    const parts = [todoCalls > 1 ? `改 ${todoCalls} 次` : '列了任务清单']
    parts.push(todoTotal > 0 ? `${todoDone} / ${todoTotal} 项完成` : '暂无完成项')
    main.splice(Math.max(0, todoAt), 0, {
      id: 'plain-todo-summary',
      icon: 'task',
      verb: '维护任务清单',
      detail: parts.join(' · '),
      status: 'done',
    })
  }

  const steps = main

  const activeCount = steps.filter((step) => step.status === 'running').length
  const doneCount = steps.filter((step) => step.status === 'done').length
  const failedCount = steps.filter((step) => step.status === 'failed').length

  const intent = input.intent !== undefined ? input.intent : extractIntent(input.reasoningTexts)

  return {
    ...(intent !== undefined ? { intent } : {}),
    nowLabel: nowLabelOf(steps, intent, input.running),
    steps,
    activeCount,
    doneCount,
    failedCount,
  }
}

/**
 * 折叠态那一行。
 *
 * 优先用模型自己播报的下一步——它最贴近用户视角（「打开携程搜索机票」比
 * 「正在打开网页」具体得多）。没有播报时退到当前那条工具调用的人话动作。
 */
function nowLabelOf(steps: readonly PlainStep[], intent: string | undefined, running: boolean): string {
  if (intent !== undefined) return `正在${intent}`
  const runningStep = steps.find((step) => step.status === 'running')
  if (runningStep !== undefined) {
    return runningStep.detail === undefined
      ? `正在${runningStep.verb}`
      : `正在${runningStep.verb} · ${runningStep.detail}`
  }
  if (running) return '正在思考下一步'
  return steps.length === 0 ? '本轮还没有执行动作' : `本轮已完成 · ${steps.length} 步`
}

/**
 * 「简要」模式：一份**进展纪要**，不是一份缩短的动作流水。
 *
 * 读者是普通用户，他要的三件事（与「任务概览」同一口径）：
 *  1. **走到哪一步了** —— 每一个**里程碑**都要说清"改了什么"；
 *  2. **出了什么事** —— 失败必须写出**人话原因**（`issue`），不是只给一枚红叉；
 *  3. **卡到哪了** —— 正在跑的那一步永远保留。
 *
 * 明确**不写**的：
 *  · **已解决的失败**。后面同类动作又成了，说明模型自己绕过去了；把一次已经翻篇
 *    的报错留在纪要里，用户会以为现在还有个坑。判定方式：某个 failed 之后还有
 *    **同一 icon** 的 done 步骤 → 视为已解决（同一个动作重来一遍成了）。
 *  · **成功的 read**（翻文件、看网页、截图…）。它们是达成里程碑的手段，不是里程碑
 *    本身。注意只砍成功的 —— **失败的 read 恰恰是"卡住了"的信号**，必须留着。
 *  · 连续同类里程碑的**中间步骤**。同一个文件改了 5 次只出一条"修改文件 x.ts ·
 *    共 5 次"，而不是 5 行——那 5 行在用户眼里是同一件事被反复说。
 *
 * 纯函数，相同输入返回等价输出，可在 smoke 里直接断言。
 */
export function condenseSteps(steps: readonly PlainStep[]): readonly PlainStep[] {
  /*
   * 哪些失败**已经翻篇**（不必再报）。
   *
   * 倒着扫、维护"在它之后出现过的成功 icon"：某条 failed 后面若还有**同 icon**
   * 的 done，说明模型已经把同一个动作又做成功了一次（改了参数重试、换条路走通），
   * 这次失败对用户已经没有意义——留着只会让他以为现在还有个坑。反过来，倒扫到它
   * 时 `seenDoneIcons` 里还没有它的 icon，说明后面没人再把它做成功过，这就是
   * **真的还没解决**，必须留下。
   */
  const resolved = new Set<number>()
  const seenDoneIcons = new Set<string>()
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]!
    if (step.status === 'done') {
      seenDoneIcons.add(step.icon)
    } else if (step.status === 'failed' && seenDoneIcons.has(step.icon)) {
      resolved.add(i)
    }
  }

  const out: PlainStep[] = []
  /** 同类里程碑合并：icon 相同就续上计数，detail 换成带次数的那条。 */
  let lastIndex = -1
  let lastCount = 0

  for (const [index, step] of steps.entries()) {
    // 1. 已解决的失败：不写（模型后来把同一个动作做成了，这次失败已翻篇）。
    if (resolved.has(index)) continue
    // 2. **未解决的失败**一律留下，哪怕它是 read。
    //
    // "读不到某个文件"、"命令跑不通"这类失败恰恰是**卡住**的信号 —— 进展纪要
    // 漏掉它，用户就看不出模型为什么停下。已解决的那些在上面一步已经被剔掉了。
    if (step.status === 'failed') {
      out.push(step)
      lastIndex = -1
      lastCount = 0
      continue
    }
    // 3. 成功的 read 不是里程碑，整段丢掉。
    if (step.impact !== 'write') continue
    // 4. 进行中：永远保留（"卡到哪了"）。它打断合并计数——它是一次新的尝试，
    //    不该被并进上一条"连做 N 次"里去。
    if (step.status === 'running') {
      out.push(step)
      lastIndex = -1
      lastCount = 0
      continue
    }
    // 5. 里程碑：连续的同 icon 合并成一条（同一件事被反复说只说一次）。
    if (lastIndex >= 0 && out[lastIndex]!.icon === step.icon && step.issue === undefined) {
      lastCount += 1
      const prev = out[lastIndex]!
      // prev.detail 可能已经带过"共 N 次"（上一轮合并写进去的），所以先剥掉再
      // 按新计数重新贴，避免出现"共 2 次 · 共 3 次"这种叠出来的串。
      const base = stripCount(prev.detail)
      out[lastIndex] = {
        ...prev,
        detail: base === undefined || base === ''
          ? `共 ${lastCount} 次`
          : `${base} · 共 ${lastCount} 次`,
      }
      continue
    }
    out.push(step)
    lastIndex = out.length - 1
    lastCount = 1
  }
  return out
}

/** 去掉 detail 尾部的「· 共 N 次」，还原成合并前的原始对象描述。 */
function stripCount(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined
  return detail.replace(/ · 共 \d+ 次$/, '')
}
