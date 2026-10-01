/**
 * dsh-chat-plus — 人话行动时间线组装（plain-timeline）。
 *
 * 把「本轮的工具调用事实」组装成一条**按时间升序、全中文、可读**的行动流，
 * 供右栏「操作面板」卡渲染。
 *
 * 曾经还有第二路输入：模型在思考里播报的 `下一步：…`，被抽成 intent 喂给
 * 折叠态那行 nowLabel。2026-10-01 整条下掉 —— 承载它的「接下来」预告行早已
 * 从卡片里删除，nowLabel 也早就没有渲染出口（只剩一个滚动跟随探针），
 * 整条通道的净效果是让模型每步白写一行。相关注入规则（PLAIN_PROGRESS_RULE）
 * 与 composer 那枚开关同步移除。
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

export interface PlainTimeline {
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
  /** 本轮工具调用节点，须按 anchorSeq 升序（collectTurnNodes 已保证）。 */
  readonly tools: readonly ChatNode<'tool-call'>[]
  /** 本轮是否仍在执行。 */
  readonly running: boolean
  /** 当前时刻（ms），用于算进行中调用的耗时。 */
  readonly now: number
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

  return {
    steps,
    activeCount,
    doneCount,
    failedCount,
  }
}

/**
 * 「简要」模式：一份**进展纪要**，不是一份缩短的动作流水。
 *
 * 读者是普通用户，他要的三件事（与「任务概览」同一口径）：
 *  1. **走到哪一步了** —— 每一个**里程碑**都要说清"干了什么"；
 *  2. **出了什么事** —— 失败必须写出**人话原因**（`issue`），不是只给一枚红叉；
 *  3. **卡到哪了** —— 正在跑的那一步永远保留。
 *
 * 明确**不写**的：
 *  · **文件操作整类**（`fileOp`：查看 / 新建 / 修改 / 删除文件，**成功的那些**）。
 *    这是用户点名要的：一屏「修改文件 xxx」「新建文件 xxx」读下来等于什么都没说
 *    —— 他不想知道改了哪些文件，只想知道干了什么事。要看文件清单另有两处：切
 *    「详细」档，或看下面那张「产出物」卡（那才是为文件而生的卡）。
 *    两处**不砍**：① 失败的（"卡住了"的信号）；② 进行中的（"现在在干什么"，
 *    模型连续改文件时它往往就是唯一那一条，砍了整张卡会空）。
 *    **下载 / 上传不在此列**：它们是"从外面拿进来 / 送出去"，不是改本地文件。
 *  · **已解决的失败**。后面同类动作又成了，说明模型自己绕过去了；把一次已经翻篇
 *    的报错留在纪要里，用户会以为现在还有个坑。判定方式：某个 failed 之后还有
 *    **同一 icon** 的 done 步骤 → 视为已解决（同一个动作重来一遍成了）。
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
  /** 被砍掉的文件操作条数：整轮只剩文件操作时用它出一行兜底。 */
  let droppedFileOps = 0

  for (const [index, step] of steps.entries()) {
    // 1. 已解决的失败：不写（模型后来把同一个动作做成了，这次失败已翻篇）。
    if (resolved.has(index)) continue
    // 2. **未解决的失败**一律留下，哪怕它是文件操作。
    //
    // "读不到某个文件"、"没权限改"这类失败恰恰是**卡住**的信号 —— 进展纪要
    // 漏掉它，用户就看不出模型为什么停下。已解决的那些在上面一步已经被剔掉了。
    if (step.status === 'failed') {
      out.push(step)
      lastIndex = -1
      lastCount = 0
      continue
    }
    // 3. 进行中：永远保留（"卡到哪了"）。它打断合并计数——它是一次新的尝试，
    //    不该被并进上一条"连做 N 次"里去。
    //
    //    **文件操作也照留**：模型连续改文件时，进行中那一步往往正是「修改文件
    //    x.ts」。砍掉它整张卡就空了，而"现在在干什么"恰恰是这张卡最该回答的
    //    问题（同时也只有一条 —— 同时只可能有一件事在跑，不构成流水）。
    if (step.status === 'running') {
      out.push(step)
      lastIndex = -1
      lastCount = 0
      continue
    }
    // 4. 成功的文件操作整类不显示（用户点名要的：不想看"改了哪些文件"）。
    if (step.fileOp === true) {
      droppedFileOps += 1
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

  /*
   * 兜底：整轮只剩文件操作时，不能给一张空列表。
   *
   * 这个分支在纯编码会话里很容易撞上（改一堆文件、别的什么都没干），而空列表
   * 读起来是「这轮什么都没发生」，与事实正好相反。折成一行说清"动过 N 个文件"
   * 即可 —— 想知道是哪些文件，切「详细」或看「产出物」卡。
   */
  if (out.length === 0 && droppedFileOps > 0) {
    out.push({
      id: 'plain-fileops-summary',
      icon: 'fileEdit',
      verb: `改动了 ${droppedFileOps} 个文件`,
      status: 'done',
      fileOp: true,
    })
  }

  return out
}

/** 合并后 detail 尾部「· 共 N 次」的分隔规则。拆开渲染时与 {@link stripCount} 同源。 */
const COUNT_SUFFIX = / · 共 (\d+) 次$/

/** 去掉 detail 尾部的「· 共 N 次」，还原成合并前的原始对象描述。 */
export function stripCount(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined
  return detail.replace(COUNT_SUFFIX, '')
}

/**
 * 取出 detail 尾部的次数短语（如「共 7 次」），无则 null。
 *
 * 供简报模式把次数从对象字符串里拆出来单独排版——次数是折叠产物，
 * 它的重要性低于「改了哪个文件」，混在对象里会被一起压成小字。
 */
export function countOf(detail: string | undefined): string | null {
  if (detail === undefined) return undefined
  const matched = COUNT_SUFFIX.exec(detail)
  return matched === null ? null : `共 ${matched[1]} 次`
}
