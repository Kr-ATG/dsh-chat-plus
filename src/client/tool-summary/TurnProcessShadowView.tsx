/**
 * Official turn-process control, shadowed (dsh-chat-plus).
 *
 * KR 对话在同一 per-turn 座位挂一张瞬态活动卡：分析 / 思考 / 工具调用自动跟随，
 * 最终回答开始后上移退场。普通「对话」不渲染这条 control，也不打开活动弹窗；
 * 过程内容由官方正文与独立工具行按各自链路呈现。
 *
 * 存储层的普通模式闸门只做兜底：即便旧 bundle / 旧调用方仍调用 open，
 * 普通「对话」也不会弹窗。
 */

import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: activates the ui-chat / ui-tool SlotMap augmentation so
// ChatNodeViewProps resolves its owner/keyed share.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { activityStore, type ActivityReasoningItem } from './activity-drawer.tsx'
import { callName, isRunning } from './tool-stats.ts'
import { argFields, toolArgsRaw } from './activity-view-model.ts'
import { getKrChatStore } from '../kr-chat/kr-chat-store.ts'
import { getOfficialTurnProcessNodeView } from '../index.ts'
import { KrActivityCardGate, type KrActivityReasoningItem } from '../kr-chat/KrLiveActivityCard.tsx'
import { clearLiveDshTodos } from '../kr-chat/kr-todo-bridge.ts'

const NS = 'dts'
const LIVE_SUMMARY_CONFIRM_MS = 1200

export let latestChatSnapshot: any = null
/**
 * 当前活动会话 id（由 session 作用域座位登记；null = 尚无会话身份）。
 *
 * 之所以把会话身份显式登记：快照本身不带 sessionId，新建/切换会话时
 * navigation.current 为空，旧的启发式（首条输入锚点）根本不会触发，
 * 于是上一会话的快照被一直沿用、右侧大盘显示的是上一次对话的内容。
 */
export let latestChatSessionId: string | null = null
const snapshotListeners = new Set<() => void>()
let currentSessionKey: string | null = null
let notifyScheduled = false

export function subscribeLatestChatSnapshot(cb: () => void): () => void {
  snapshotListeners.add(cb)
  return () => {
    snapshotListeners.delete(cb)
  }
}

/**
 * 通知延迟到微任务。
 *
 * 快照发布点基本都在 React 渲染期（useChat selector）。若同步 notify，
 * 订阅者的 setState 会落在「渲染另一个组件期间」，React 直接丢弃该更新，
 * 右侧大盘于是只能等下一次无关重渲染才刷新 —— 表现就是「不实时」。
 * 放到当前同步渲染任务结束之后再广播，更新必然生效。
 */
function scheduleNotify(): void {
  if (notifyScheduled) return
  notifyScheduled = true
  const flush = (): void => {
    notifyScheduled = false
    for (const cb of [...snapshotListeners]) {
      try { cb() } catch { /* 单个订阅者异常不得阻断其余订阅者 */ }
    }
  }
  if (typeof queueMicrotask === 'function') queueMicrotask(flush)
  else setTimeout(flush, 0)
}

/** 清空上一会话残留：抽屉缓存、live todos、已选轮次。 */
function resetSessionCaches(): void {
  try { activityStore().clear() } catch {}
  try { clearLiveDshTodos() } catch {}
  try { getKrChatStore().setSelectedTurn(null) } catch {}
}

/**
 * 登记（或切换）当前会话身份。id 变化即视为「新建 / 切换 / 离开会话」：
 * 立刻丢弃旧快照并清掉缓存，右侧大盘不得复用上一会话的数据。
 *
 * 由 conversation.input.dock 座位（KrTodoBridge）在每次 sessionId 变化时调用 ——
 * 该座位在新会话的空白 Hero 态同样渲染，因此空白新会话也能即时完成清空。
 */
/** 读取当前已登记的会话 id（供座位卸载时做「是否仍是我登记的」判断）。 */
export function getLatestChatSessionId(): string | null {
  return latestChatSessionId
}

export function setLatestChatSessionId(id: string | null): void {
  if (id === latestChatSessionId) return
  latestChatSessionId = id
  if (typeof window !== 'undefined') {
    // 诊断镜像：控制台可直接查当前已登记的会话 id。
    (window as any).__dshLatestChatSessionId__ = id
  }
  clearLatestChatSnapshot()
  resetSessionCaches()
  scheduleNotify()
}

/** 显式清空快照（不改会话身份）。 */
export function clearLatestChatSnapshot(): void {
  latestChatSnapshot = null
  if (typeof window !== 'undefined') {
    (window as any).__dshLatestChatSnapshot__ = null
  }
  scheduleNotify()
}

if (typeof window !== 'undefined') {
  // KrTodoBridge 经 window 总线登记会话身份：插件内两侧互不 import，避免循环依赖。
  (window as any).__dshSetActiveSessionId__ = setLatestChatSessionId
}

export function setLatestChatSnapshot(snapshot: any, sessionId?: string | null): void {
  // 会话身份优先走显式参数。座位先登记 id、节点视图随后发布快照；
  // 若节点视图先于座位 effect 到达，这里就地采纳该 id（避免空面板）。
  if (sessionId !== undefined && sessionId !== null && sessionId !== latestChatSessionId) {
    setLatestChatSessionId(sessionId)
  }

  latestChatSnapshot = snapshot
  if (typeof window !== 'undefined') {
    (window as any).__dshLatestChatSnapshot__ = snapshot
  }

  // 兜底启发式（宿主未提供会话 id 座位时）：首条输入锚点变化即视为换会话
  const firstInputKey = snapshot?.navigation?.current?.[0]?.anchorKey
    || snapshot?.order?.find((k: string) => typeof k === 'string' && k.includes('input-message'))
    || null

  if (firstInputKey && firstInputKey !== currentSessionKey) {
    currentSessionKey = firstInputKey
    resetSessionCaches()
  }

  // 广播通知大盘与抽屉重新渲染
  scheduleNotify()
}

/** Per-turn activity counts (tool-call nodes + reasoning blocks, drawer 口径一致）. */
export function useTurnActivityCounts(turn: number, useChat: ChatNodeViewProps<'tool-call'>['useChat']): {
  readonly tools: number
  readonly reasoning: number
  /** 本轮仍有 assistant-step 在流式输出。 */
  readonly streaming: boolean
  /** 本轮仍有 tool-call 在执行（含 tool 间隙：思考已停但工具还在跑）。 */
  readonly toolsRunning: boolean
} {
  return useChat((snapshot) => {
    let tools = 0
    let reasoning = 0
    let streaming = false
    let toolsRunning = false
    const keys = snapshot?.locations?.getTurn?.(turn) ?? []
    for (const key of keys) {
      const candidate = snapshot?.nodes?.get?.(key)
      if (candidate === undefined) continue
      if (candidate.kind === 'tool-call') {
        tools += 1
        try {
          const block = (candidate as ChatNode<'tool-call'>).data.root
          if (isRunning(block)) toolsRunning = true
        } catch { /* 块形状未知时按未运行处理 */ }
      } else if (candidate.kind === 'assistant-step' || candidate.kind === 'assistant') {
        const step = candidate as any
        if (step.data?.status === 'running' || step.status === 'running') streaming = true
        const blocks = step.data?.blocks ?? step.blocks ?? []
        for (const block of blocks) {
          const isReasoning = block?.kind === 'reasoning' || block?.type === 'reasoning'
          const text = typeof block?.text === 'string' ? block.text : typeof block?.content === 'string' ? block.content : ''
          if (isReasoning && text.trim() !== '') reasoning += 1
        }
      }
    }
    return { tools, reasoning, streaming, toolsRunning }
  }, (a, b) => a.tools === b.tools && a.reasoning === b.reasoning && a.streaming === b.streaming && a.toolsRunning === b.toolsRunning)
}

/**
 * 完整收集一轮的活动节点（tool-call + assistant-step/reasoning）：
 * 优先从 locations.getTurn 读，若收口或折叠后被官方隐藏，则从 snapshot.nodes.values()
 * 中基于 location.turn 或 data.turn 补齐隐藏成员，确保收口后依然有料可看、能开抽屉。
 * 纯读取函数，仅在用户点击打开抽屉时按需执行，绝不在 render / effect 循环执行。
 */
export interface TurnTaskItem {
  readonly id: string
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

export function collectTurnNodes(snapshot: any, turn: number): {
  readonly tools: readonly ChatNode<'tool-call'>[]
  readonly reasoning: readonly ActivityReasoningItem[]
  readonly tasks: readonly TurnTaskItem[]
  readonly turnStart?: number | undefined
  readonly turnEnd?: number | undefined
  readonly durationMs?: number | undefined
} {
  const toolMap = new Map<string, ChatNode<'tool-call'>>()
  const reasoningList: ActivityReasoningItem[] = []
  let turnTasks: TurnTaskItem[] = []

  if (snapshot === null || snapshot === undefined) {
    return { tools: [], reasoning: [], tasks: [] }
  }

  const addNode = (candidate: any): void => {
    if (candidate === undefined || candidate === null) return
    if (candidate.kind === 'tool-call') {
      const toolNode = candidate as ChatNode<'tool-call'>
      if (toolNode.key && !toolMap.has(toolNode.key)) {
        toolMap.set(toolNode.key, toolNode)
      }
      try {
        const root = (toolNode as any).data?.root
        const tName = root?.call?.name || root?.toolName || root?.name || (toolNode as any).data?.call?.name
        if (tName === 'todo_write') {
          const raw = root?.call?.argsRaw || root?.arguments || (toolNode as any).data?.call?.argsRaw
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (parsed && Array.isArray(parsed.todos) && parsed.todos.length > 0) {
            turnTasks = parsed.todos.map((item: any, idx: number) => ({
              id: `todo-${turn}-${idx}`,
              content: String(item.content ?? ''),
              status: (item.status === 'completed' || item.status === 'in_progress' || item.status === 'pending') ? item.status : 'pending',
            }))
          }
        }
      } catch {}
    } else if (candidate.kind === 'submitted-plan') {
      try {
        const planData = candidate.data
        if (planData && typeof planData.title === 'string' && turnTasks.length === 0) {
          const markdown = planData.markdown || ''
          const mdLines = markdown.split('\n')
          const mdTasks: TurnTaskItem[] = []
          for (const line of mdLines) {
            const checkMatch = line.match(/^[\s\*\-]*\[([ xX])\]\s*(.+)/)
            if (checkMatch) {
              mdTasks.push({
                id: `plan-task-${turn}-${mdTasks.length}`,
                content: checkMatch[2].trim(),
                status: checkMatch[1].toLowerCase() === 'x' ? 'completed' : 'pending',
              })
            }
          }
          if (mdTasks.length > 0) {
            turnTasks = mdTasks
          } else {
            turnTasks = [{
              id: `plan-${turn}-0`,
              content: planData.title,
              status: 'completed',
            }]
          }
        }
      } catch {}
    } else if (candidate.kind === 'assistant-step' || candidate.kind === 'assistant') {
      const step = candidate as any
      const blocks = step.data?.blocks ?? step.blocks ?? []
      for (const block of blocks) {
        const isReasoning = block?.kind === 'reasoning' || block?.type === 'reasoning'
        const text = typeof block?.text === 'string' ? block.text : typeof block?.content === 'string' ? block.content : ''
        if (isReasoning && text.trim() !== '') {
          const stepNum = step.data?.step ?? step.step ?? 0
          if (!reasoningList.some(r => r.step === stepNum && r.text === text)) {
            reasoningList.push({
              text,
              running: step.data?.status === 'running' || step.status === 'running',
              step: stepNum,
            })
          }
        }
      }
    }
  }

  // 1. 优先从 locations.getTurn 收集本轮可见键
  try {
    const turnKeys = snapshot?.locations?.getTurn?.(turn)
    if (Array.isArray(turnKeys)) {
      for (const key of turnKeys) {
        addNode(snapshot?.nodes?.get?.(key))
      }
    }
  } catch { /* ignore */ }

  // 2. 穿透扫描全量节点表（补齐 compact/折叠时被过滤掉的 tool-call 与 assistant-step）
  const scanCandidate = (node: any): void => {
    if (!node) return
    const loc = node.location
    const candTurn = node.data?.turn
      ?? (typeof loc?.turn === 'number' ? loc.turn : loc?.turn?.turn)
    if (candTurn !== undefined && candTurn == turn) {
      addNode(node)
    }
  }

  try {
    if (typeof snapshot?.nodes?.values === 'function') {
      for (const node of snapshot.nodes.values()) {
        scanCandidate(node)
      }
    }
  } catch { /* ignore */ }

  try {
    if (Array.isArray(snapshot?.order)) {
      for (const key of snapshot.order) {
        scanCandidate(snapshot?.nodes?.get?.(key))
      }
    }
  } catch { /* ignore */ }

  const tools = [...toolMap.values()].sort((a, b) => (a.anchorSeq ?? 0) - (b.anchorSeq ?? 0))
  reasoningList.sort((a, b) => (a.step ?? 0) - (b.step ?? 0))

  let turnStart: number | undefined
  let turnEnd: number | undefined
  let durationMs: number | undefined

  // 3. 提取真实生命周期耗时：优先从 snapshot.timeline.turns 读取
  try {
    const turnsMap = snapshot?.timeline?.turns
    const t = turnsMap?.get ? turnsMap.get(turn) : turnsMap?.[turn]
    if (t) {
      if (typeof t.start?.time === 'number') turnStart = t.start.time
      if (typeof t.end?.time === 'number') turnEnd = t.end.time
      if (turnStart !== undefined && turnEnd !== undefined) {
        durationMs = Math.max(0, turnEnd - turnStart)
      }
    }
  } catch { /* ignore */ }

  // 4. 次选从 turn-tail 节点的 location.turn 读取
  if (durationMs === undefined) {
    try {
      for (const key of (snapshot?.order ?? [])) {
        const node = snapshot?.nodes?.get?.(key)
        if (node?.kind === 'turn-tail' && (node.data?.turn === turn || node.location?.turn?.turn === turn)) {
          const locTurn = node.location?.turn
          const s = locTurn?.start?.time
          const e = locTurn?.end?.time
          if (typeof s === 'number') turnStart = s
          if (typeof e === 'number') turnEnd = e
          if (typeof s === 'number' && typeof e === 'number') {
            durationMs = Math.max(0, e - s)
          }
          break
        }
      }
    } catch { /* ignore */ }
  }

  // 5. 兜底兼容 legacy startTime
  if (turnStart === undefined) {
    turnStart = snapshot?.legacy?.turnTimings?.get?.(turn)?.startTime
  }

  return { tools, reasoning: reasoningList, tasks: turnTasks, turnStart, turnEnd, durationMs }
}

interface KrActivityStepState {
  readonly step: number
  readonly status: 'running' | 'settled' | 'interrupted'
  readonly hasVisibleAnswer: boolean
  /** 同一 step 仍含工具调用时，不把它误判为最终总结。 */
  readonly hasToolCall: boolean
  /** 可见答案内容探针：文本增长时重置总结候选的静默计时。 */
  readonly answerProbe: string
}

interface KrActivityProjection {
  readonly reasoning: readonly KrActivityReasoningItem[]
  readonly tools: readonly ChatNode<'tool-call'>[]
  readonly tasks: readonly TurnTaskItem[]
  readonly steps: readonly KrActivityStepState[]
  /** 本轮真实起点（毫秒时间戳），供活动卡的用时读数使用；取不到时为 undefined。 */
  readonly turnStart?: number | undefined
}

const EMPTY_KR_ACTIVITY_PROJECTION: KrActivityProjection = {
  reasoning: [],
  tools: [],
  tasks: [],
  steps: [],
  turnStart: undefined,
}

/**
 * 从 chat snapshot 投影 KR 活动卡数据。live 时只走本轮 locations 快路径；
 * closed 的第一次收口发布可传 includeHidden 扫全量 nodes，补齐 compact/answer
 * 隐藏成员并拿到工具终态。
 */
function collectKrActivityProjection(snapshot: any, turn: number, includeHidden = false): KrActivityProjection {
  const tools = new Map<string, ChatNode<'tool-call'>>()
  const steps = new Map<string, ChatNode<'assistant-step'>>()
  const tasks = new Map<string, TurnTaskItem>()
  let hasTodoTasks = false

  const addTodoTasks = (value: unknown): void => {
    if (!Array.isArray(value)) return
    tasks.clear()
    value.forEach((item: any, index: number) => {
      const content = String(item?.content ?? '').trim()
      if (content === '') return
      const status = item?.status === 'completed' || item?.status === 'in_progress' || item?.status === 'pending'
        ? item.status
        : 'pending'
      tasks.set(`todo-${turn}-${index}`, { id: `todo-${turn}-${index}`, content, status })
    })
    hasTodoTasks = tasks.size > 0
  }

  const addNode = (candidate: any): void => {
    if (candidate === undefined || candidate === null) return
    if (candidate.kind === 'tool-call' && candidate.key !== undefined) {
      const toolNode = candidate as ChatNode<'tool-call'>
      tools.set(candidate.key, toolNode)
      try {
        const root = (toolNode as any).data?.root
        if (callName(root) === 'todo_write') addTodoTasks(argFields(toolArgsRaw(root)).todos)
      } catch { /* 未知 todo 形状不影响其它活动 */ }
      return
    }
    if (candidate.kind === 'submitted-plan' && !hasTodoTasks) {
      try {
        const plan = candidate.data
        const markdown = String(plan?.markdown ?? '')
        const parsed = markdown.split('\n').flatMap((line: string, index: number) => {
          const match = line.match(/^[\s\*\-]*\[([ xX])\]\s*(.+)/)
          if (match === null) return []
          return [{
            id: `plan-${turn}-${index}`,
            content: match[2].trim(),
            status: match[1].toLowerCase() === 'x' ? 'completed' as const : 'pending' as const,
          }]
        })
        if (parsed.length > 0) parsed.forEach((task) => { tasks.set(task.id, task) })
        else if (typeof plan?.title === 'string' && plan.title.trim() !== '') {
          tasks.set(`plan-${turn}-title`, { id: `plan-${turn}-title`, content: plan.title.trim(), status: 'completed' })
        }
      } catch { /* 忽略未知 plan 形状 */ }
      return
    }
    if (candidate.kind === 'assistant-step' && candidate.key !== undefined) {
      steps.set(candidate.key, candidate as ChatNode<'assistant-step'>)
    }
  }

  try {
    for (const key of snapshot?.locations?.getTurn?.(turn) ?? []) {
      addNode(snapshot?.nodes?.get?.(key))
    }
  } catch { /* 投影不可读时继续走全量扫描 */ }

  // live 投影只扫本轮 locations；完整 nodes 扫描仅在 closed 的第一次
  // 收口发布执行一次，用来补齐 compact/hidden 终态。
  if (includeHidden) {
    try {
      if (typeof snapshot?.nodes?.values === 'function') {
        for (const candidate of snapshot.nodes.values()) {
          const locationTurn = candidate?.location?.turn
          const candidateTurn = candidate?.data?.turn
            ?? (typeof locationTurn === 'number' ? locationTurn : locationTurn?.turn)
          if (candidateTurn === turn) addNode(candidate)
        }
      }
    } catch { /* 未知 snapshot 形状返回空投影 */ }
  }

  const orderedSteps = [...steps.values()].sort((a, b) => a.anchorSeq - b.anchorSeq)
  const reasoning: KrActivityReasoningItem[] = []
  const stepStates: KrActivityStepState[] = []
  for (const step of orderedSteps) {
    let hasVisibleAnswer = false
    let hasToolCall = false
    let answerProbe = ''
    let blockIndex = 0
    for (const block of step.data.blocks) {
      if (block.kind === 'reasoning') {
        const text = block.text.trim()
        if (text !== '') {
          reasoning.push({
            text,
            running: step.data.status === 'running',
            step: step.data.step,
            order: step.anchorSeq + (blockIndex++) / 1000,
          })
        }
      } else if (block.kind === 'tool-call') {
        hasToolCall = true
      } else {
        hasVisibleAnswer = true
        const visibleText = typeof (block as any).text === 'string' ? (block as any).text : ''
        answerProbe += `${visibleText}\u0000`
      }
    }
    stepStates.push({
      step: step.data.step,
      status: step.data.status,
      hasVisibleAnswer,
      hasToolCall,
      answerProbe,
    })
  }

  /*
   * 本轮真实起点。活动卡里那枚用时读数只认它——拿不到就不渲染读数，绝不用
   * 「工具数 × 800ms」那种兜底猜数去冒充用户看到的时长。
   */
  let turnStart: number | undefined
  try {
    const turnsMap = snapshot?.timeline?.turns
    const t = turnsMap?.get ? turnsMap.get(turn) : turnsMap?.[turn]
    if (typeof t?.start?.time === 'number') turnStart = t.start.time
  } catch { /* 取不到就交给下面的 legacy 兜底 */ }
  if (turnStart === undefined) {
    try { turnStart = snapshot?.legacy?.turnTimings?.get?.(turn)?.startTime } catch { /* 仍无起点 */ }
  }

  return {
    reasoning,
    tools: [...tools.values()].sort((a, b) => a.anchorSeq - b.anchorSeq),
    tasks: [...tasks.values()],
    steps: stepStates,
    turnStart,
  }
}

function sameKrActivityProjection(left: KrActivityProjection, right: KrActivityProjection): boolean {
  if (left === right) return true
  if (
    left.reasoning.length !== right.reasoning.length
    || left.tools.length !== right.tools.length
    || left.tasks.length !== right.tasks.length
    || left.steps.length !== right.steps.length
    || left.turnStart !== right.turnStart
  ) return false
  for (let index = 0; index < left.reasoning.length; index += 1) {
    const a = left.reasoning[index]
    const b = right.reasoning[index]
    if (a.text !== b.text || a.running !== b.running || a.step !== b.step || a.order !== b.order) return false
  }
  for (let index = 0; index < left.tools.length; index += 1) {
    const a = left.tools[index]
    const b = right.tools[index]
    // DSH snapshot 对未变化节点保持引用稳定；只让真正变化的 tool node
    // 触发新 projection，避免每个 live delta 都重建整张列表。
    if (a.key !== b.key || a.data.root !== b.data.root) return false
  }
  for (let index = 0; index < left.steps.length; index += 1) {
    const a = left.steps[index]
    const b = right.steps[index]
    if (
      a.step !== b.step
      || a.status !== b.status
      || a.hasVisibleAnswer !== b.hasVisibleAnswer
      || a.hasToolCall !== b.hasToolCall
      || a.answerProbe !== b.answerProbe
    ) return false
  }
  for (let index = 0; index < left.tasks.length; index += 1) {
    const a = left.tasks[index]
    const b = right.tasks[index]
    if (a.id !== b.id || a.content !== b.content || a.status !== b.status) return false
  }
  return true
}

/** Single per-turn row at the official control position (priority -100 shadows builtin). */
export const TurnProcessShadowView = memo(function TurnProcessShadowView(props: ChatNodeViewProps<'turn-process'>) {
  const { node, useChat, turnProcess, t, cwd, openFile, inspectCall } = props
  const store = activityStore()
  const krStore = getKrChatStore()
  const krTab = useSyncExternalStore(
    (cb) => krStore.subscribe(cb),
    () => krStore.snapshot.activeTab,
  )
  const turn = node.data.turn

  // 1. 获取计数（浅比较，避免非必要重渲染）
  const counts = useTurnActivityCounts(turn, useChat)

  // 2. 捕获最新 snapshot 引用供读取（返回值恒定为 0，永不触发重渲染）
  const snapshotRef = useRef<any>(null)
  useChat((snapshot) => {
    snapshotRef.current = snapshot
    latestChatSnapshot = snapshot
    return 0
  })

  // 3. KR 活动卡直接消费实时投影；useChat 会在思考文本增长、工具状态变化、
  // 新节点加入时发布新数组，因此卡片内容与右侧大盘同步，不需要轮询 DOM。
  // store 是 KR 视图的唯一实时真相；body 属性由控制器稍后同步，不能拿它
  // 作为 React 渲染门槛，否则刚切到 KR 的那一帧会漏掉活动卡。
  const isKrMode = krTab === 'kr'
  const locationTurn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  // 初次就是 closed 的历史轮次不扫描；open → closed 的第一次发布仍扫描
  // 一次，拿到工具已结束/失败/中断的终态，再冻结给退场动画。
  const krClosedProjectionCollectedRef = useRef(locationTurn?.status !== 'open')
  const krProjectionCacheRef = useRef<KrActivityProjection>(EMPTY_KR_ACTIVITY_PROJECTION)
  const krProjectionSnapshot = useChat((snapshot) => {
    const shouldCollect = isKrMode && (
      locationTurn?.status === 'open'
      || (locationTurn?.status === 'closed' && !krClosedProjectionCollectedRef.current)
    )
    if (!shouldCollect) return EMPTY_KR_ACTIVITY_PROJECTION
    const next = collectKrActivityProjection(
      snapshot,
      turn,
      locationTurn?.status === 'closed' && !krClosedProjectionCollectedRef.current,
    )
    if (sameKrActivityProjection(krProjectionCacheRef.current, next)) {
      return krProjectionCacheRef.current
    }
    krProjectionCacheRef.current = next
    return next
  })
  // closed 历史轮次不再全量扫描 snapshot；保留最后一次开放期数据只供退场
  // 冻结使用，避免长会话里 N 个历史 turn × 全量 nodes 的重复开销。
  const krLastProjectionRef = useRef<KrActivityProjection>(EMPTY_KR_ACTIVITY_PROJECTION)
  if (
    krProjectionSnapshot !== EMPTY_KR_ACTIVITY_PROJECTION
    && (krProjectionSnapshot.reasoning.length > 0 || krProjectionSnapshot.tools.length > 0)
  ) {
    krLastProjectionRef.current = krProjectionSnapshot
  }
  const krProjection = krProjectionSnapshot === EMPTY_KR_ACTIVITY_PROJECTION
    ? krLastProjectionRef.current
    : krProjectionSnapshot
  const answerStep = turnProcess?.spec.answerStep ?? null
  const configuredAnswerStarted = answerStep !== null && krProjection.steps.some(
    (step) => step.step === answerStep && step.hasVisibleAnswer && !step.hasToolCall,
  )
  // DSH 只有 assistant step 定型后才发布 answerStep；最终答案流式期间
  // answerStep 仍是 null。用「最新 step 正在运行、已有可见正文、且不含
  // tool-call」作为候选，并要求正文静默 1.2s；文本增长会重置计时，工具
  // 调用到达会立即取消，避免把工具前的桥接回复误判成总结。
  const latestStep = krProjection.steps.at(-1)
  const liveSummaryCandidate = isKrMode && (
    configuredAnswerStarted
    || (latestStep?.status === 'running'
      && latestStep.hasVisibleAnswer
      && !latestStep.hasToolCall)
  )
  const liveSummaryProbe = liveSummaryCandidate
    ? `${configuredAnswerStarted ? 'settled' : 'streaming'}:${latestStep?.step ?? 0}:${latestStep?.answerProbe ?? ''}`
    : ''
  const [liveSummaryReady, setLiveSummaryReady] = useState(false)
  const previousKrMode = useRef(isKrMode)
  useEffect(() => {
    if (!liveSummaryCandidate) {
      setLiveSummaryReady(false)
      return undefined
    }
    const id = window.setTimeout(() => { setLiveSummaryReady(true) }, LIVE_SUMMARY_CONFIRM_MS)
    return () => { window.clearTimeout(id) }
  }, [liveSummaryCandidate, liveSummaryProbe, turn])
  const answerStarted = liveSummaryReady
  const interrupted = krProjection.steps.some((step) => step.status === 'interrupted')
  const krCommitted = locationTurn?.status === 'closed' || interrupted
  const krClosing = krCommitted || answerStarted
  const krActive = isKrMode && locationTurn?.status === 'open' && !krClosing
  useEffect(() => {
    if (locationTurn?.status === 'open') {
      krClosedProjectionCollectedRef.current = false
    } else if (locationTurn?.status === 'closed') {
      krClosedProjectionCollectedRef.current = true
    }
  }, [locationTurn?.status])

  // 实时思考预览堆叠只在 KR 模式保留；普通「对话」不创建这个浮层。
  const activeThinking = isKrMode
    && counts.reasoning > 0
    && (counts.streaming === true || counts.toolsRunning === true)
  useEffect(() => {
    if (activeThinking) {
      const row = document.querySelector('[data-turn-process="' + turn + '"].' + NS + '__process')
      store.setPreviewAnchor((row as HTMLElement) ?? undefined, turn)
    } else {
      store.setPreviewAnchor(undefined, null)
    }
    return () => { if (activeThinking) store.setPreviewAnchor(undefined, null) }
  }, [activeThinking, turn, store])

  // 只在真实 tab 模式切换时关闭抽屉；初次普通挂载/虚拟化重挂不误关其它
  // 插件或普通工具抽屉。这里是当前座位级补救，跨所有座位卸载的切换仍由
  // 控制器/DOM 状态同步负责。
  useEffect(() => {
    const previous = previousKrMode.current
    previousKrMode.current = isKrMode
    if (previous !== isKrMode && store.openTurn !== null) store.close()
  }, [isKrMode, store])

  // KR 无论当前回合是否 foldable 都由活动卡占位；它从 turn-process 的
  // per-turn 座位出现，因此第一条 assistant 文本之前也能立刻显示。
  if (isKrMode) {
    return (
      <KrActivityCardGate
        turn={turn}
        reasoning={krProjection.reasoning}
        tools={krProjection.tools}
        turnStart={krProjection.turnStart}
        active={krActive}
        closing={krClosing}
        committed={krCommitted}
      />
    )
  }
  // 普通「对话」把座位原样还给官方：那条「工具调用 N 次 · 已思考…」的折叠行
  // 与它内部的思考、工具树都是官方自己的实现，插件一个字节都不该插手。
  //
  // 这里是「占座即替换」——插件用 priority -100 注册在这个 key 上，官方组件
  // 就不会再被渲染。所以 return null 不是"少画一点"，而是普通对话里工具调用
  // 与折叠入口一起消失。必须显式转发给官方组件。
  const OfficialProcess = getOfficialTurnProcessNodeView()
  if (OfficialProcess) {
    return <OfficialProcess {...props} />
  }
  // 捕获失败（官方组件尚未就位）时的兜底：宁可这一拍没有折叠行，也不能崩。
  return null
})
