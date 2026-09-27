/**
 * dsh-chat-plus — KR 对话右侧 Agent 实时执行与轨迹大盘。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { activityStore } from '../tool-summary/activity-drawer.tsx'
import { latestChatSnapshot, latestChatSessionId, collectTurnNodes, subscribeLatestChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'
import { callDurationMs, callName, computeStats, formatDuration, isRunning } from '../tool-summary/tool-stats.ts'
import { rowTitle, toolArgsRaw, argFields, resultParagraphs, rawResultJson, executionFacts } from '../tool-summary/activity-view-model.ts'
import { useNow } from '../tool-summary/use-now.ts'
import { getKrChatStore, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from './kr-chat-store.ts'
import { KrTaskOverviewCard, type DshTaskItem } from './KrTaskOverviewCard.tsx'
import { KrReasoningCard, REASONING_MAX_ROWS } from './KrReasoningCard.tsx'
import { KrToolCallsCard, type ToolCallItemView } from './KrToolCallsCard.tsx'
import { KrMemoryCard } from './KrMemoryCard.tsx'
import { KrTurnTimer } from './KrTurnTimer.tsx'
import { useAdaptiveReasoningRows } from './use-adaptive-rows.ts'
import { ShotPanel } from '../shot/Panel.tsx'
import { collectMessages, deriveCurrentDialogueTitle, type ShotRange, type ShotMessage } from '../shot/collect.ts'
import { useModalClose } from '../modal-animation.ts'
import { getLiveDshTodos, subscribeLiveDshTodos } from './kr-todo-bridge.ts'
import { buildPlainTimeline, extractIntent } from './plain-timeline.ts'
import { KrPlainTimelineCard } from './KrPlainTimelineCard.tsx'
import { KR_MEMORY_CARD_VISIBLE, KR_PANEL_HEADER_VISIBLE, KR_PLAIN_TIMELINE_CARD_VISIBLE } from './enabled.ts'

/**
 * 一轮的数据视图。
 *
 * 显式声明成 readonly 形状，而不是直接用 collectTurnNodes 的返回类型推断：
 * 下面的稳定化层要先把 actStore.get() 的返回值规整成同一形状，才能对两条
 * 数据源用同一套指纹。
 */
interface TurnDataView {
  readonly tools: readonly ChatNode<'tool-call'>[]
  readonly reasoning: readonly { readonly text: string }[]
  readonly tasks: readonly { readonly id: string; readonly content: string; readonly status: string }[]
  readonly turnStart?: number | undefined
  readonly turnEnd?: number | undefined
  readonly durationMs?: number | undefined
}

/**
 * 内容指纹：判断「这一轮的数据真的变了没有」。
 *
 * 代价必须低到可以在每个 tick 上跑，所以只取**便宜且足够敏感**的几项：
 * 工具节点的 key + 是否在跑 + 入参串长度；思考的每段长度序列；任务的 id/status。
 * 代价是「内容变了但长度没变」这种改动会晚一拍被看见（最多到下一次 tick 触发
 * 的其它变化），对流式场景完全够用——思考增长时长度必变。
 */
function fingerprintTurnData(data: TurnDataView): string {
  const tools = data.tools.map(node => {
    try {
      const root = node.data.root
      return `${node.key}:${isRunning(root) ? 1 : 0}:${toolArgsRaw(root).length}`
    } catch {
      return `${node.key}:x`
    }
  }).join('|')
  const reasoning = data.reasoning.map(item => item.text.length).join(',')
  const tasks = data.tasks.map(task => `${task.id}:${task.status}`).join(',')
  return `${tools}#${reasoning}#${tasks}#${String(data.turnStart ?? 0)}#${String(data.turnEnd ?? 0)}#${String(data.durationMs ?? 0)}`
}

export interface KrAgentPanelProps {
  readonly latestTurn: number
  readonly isTurnRunning: boolean
  readonly onCollapse: () => void
}

export const KrAgentPanel = memo(function KrAgentPanel({
  latestTurn,
  isTurnRunning,
  onCollapse,
}: KrAgentPanelProps) {
  const store = getKrChatStore()
  const krState = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.snapshot,
  )

  // 监听快照更新（实时响应新提问、流式输出与会话切换）
  const [snapTick, setSnapTick] = useState(0)
  useEffect(() => {
    return subscribeLatestChatSnapshot(() => setSnapTick((t) => t + 1))
  }, [])

  // 动态计算当前会话真实的最新轮次（以会话快照与 DOM 节点为准，绝不被历史缓存干扰）
  const snapshot = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
  const snapTurns = snapshot?.navigation?.current?.map((n: any) => n.turn).filter((n: any) => typeof n === 'number' && n > 0) || []
  const domTurns = typeof document !== 'undefined'
    ? Array.from(document.querySelectorAll('[data-chat-turn]')).map(el => parseInt(el.getAttribute('data-chat-turn') || '0', 10)).filter(n => Number.isFinite(n) && n > 0)
    : []
  const effectiveLatestTurn = snapTurns.length > 0
    ? Math.max(...snapTurns)
    : (domTurns.length > 0 ? Math.max(...domTurns) : (latestTurn > 0 ? latestTurn : 1))

  // 若选中的轮次超出当前会话最大轮次（如切到只有1轮的新会话），立即自动解除越界选中
  const validSelectedTurn = (krState.selectedTurn !== null && krState.selectedTurn <= effectiveLatestTurn)
    ? krState.selectedTurn
    : null

  useEffect(() => {
    if (krState.selectedTurn !== null && krState.selectedTurn > effectiveLatestTurn) {
      store.setSelectedTurn(null)
    }
  }, [krState.selectedTurn, effectiveLatestTurn, store])

  // 决定当前展示哪个轮次：若用户点击了历史轮次则显示历史轮次，否则跟随最新轮次
  const displayTurn = validSelectedTurn ?? effectiveLatestTurn
  const isViewingHistory = validSelectedTurn !== null && validSelectedTurn !== effectiveLatestTurn
  const currentRunning = isTurnRunning && !isViewingHistory

  // 监听活动总线数据
  const actStore = activityStore()
  const [actTick, setActTick] = useState(0)
  useEffect(() => {
    return actStore.subscribe(() => setActTick((t) => t + 1))
  }, [actStore])

  // 监听官方 todos 实时投影更新
  const [todoTick, setTodoTick] = useState(0)
  useEffect(() => {
    return subscribeLiveDshTodos(() => setTodoTick((t) => t + 1))
  }, [])

  /*
   * 数据源：优先从 latestChatSnapshot 实时提取，回退到 actStore.get。
   *
   * 外面套一层**引用稳定化**。原因：collectTurnNodes 每次都返回全新对象，于是
   * 下游 reasoningTexts 的 memo 拿不到稳定引用 → 每帧被击穿 → extractIntent
   * 每帧把整轮思考 join + 逐行正则重扫一遍，plainTimeline 的 steps 也整份重建。
   * 而快照发布的频率在流式期很高（每个 delta 一次），不是每秒一次。
   *
   * 指纹不变就复用上一次的引用，下游整条 memo 链原样命中。
   */
  const turnDataCacheRef = useRef<{ sig: string; data: TurnDataView } | null>(null)
  const turnData = useMemo<TurnDataView>(() => {
    const raw = ((): TurnDataView => {
      const snap = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
      if (snap) {
        try {
          const collected = collectTurnNodes(snap, displayTurn)
          return {
            tools: collected.tools,
            reasoning: collected.reasoning,
            tasks: collected.tasks,
            turnStart: collected.turnStart,
            turnEnd: collected.turnEnd,
            durationMs: collected.durationMs,
          }
        } catch (err) {
          console.warn('[kr-agent-panel] collectTurnNodes error', err)
        }
      }
      return actStore.get(displayTurn)
    })()
    const sig = fingerprintTurnData(raw)
    const cached = turnDataCacheRef.current
    if (cached !== null && cached.sig === sig) return cached.data
    turnDataCacheRef.current = { sig, data: raw }
    return raw
  }, [displayTurn, actTick, snapTick])

  const now = useNow(isTurnRunning && !isViewingHistory)

  // 思考文本提取
  const reasoningTexts = useMemo<readonly string[]>(() => {
    return (turnData?.reasoning ?? []).map((r) => r.text).filter((t) => t.trim() !== '')
  }, [turnData, actTick, snapTick])

  // 工具调用数据转换
  const tools = useMemo<readonly ChatNode<'tool-call'>[]>(() => {
    return turnData?.tools ?? []
  }, [turnData, actTick, snapTick])

  // 耗时计算：精确优先从真实轮次生命周期中获取
  const turnStart = turnData?.turnStart
  const turnEnd = turnData?.turnEnd
  let elapsedMs: number
  /**
   * 这个用时有没有真实来源。
   *
   * 下面的兜底分支会拿「工具数 × 800ms + 1500ms」硬凑一个数——那对副标题
   * （一句统计说明）无所谓，但 footer 的「用时」是要一直挂在用户眼前的读数，
   * 凑出来的假数字会被当成真的看。拿不到真实起点就整行不渲染。
   */
  let elapsedMeasured = true

  if (currentRunning && turnStart) {
    elapsedMs = Math.max(0, now - turnStart)
  } else if (typeof turnData?.durationMs === 'number' && turnData.durationMs > 0) {
    elapsedMs = turnData.durationMs
  } else if (typeof turnStart === 'number' && typeof turnEnd === 'number' && turnEnd >= turnStart) {
    elapsedMs = turnEnd - turnStart
  } else {
    // 兜底计算：汇总工具调用实际耗时
    let toolsDuration = 0
    for (const t of tools) {
      try {
        const d = callDurationMs(t.data.root, now)
        if (d && d > 0) toolsDuration += d
      } catch {}
    }
    elapsedMs = toolsDuration > 0 ? toolsDuration : (tools.length * 800 + 1500)
    elapsedMeasured = toolsDuration > 0
  }
  const durationText = formatDuration(elapsedMs)

  /*
   * 工具列表构建。
   *
   * 必须 memo：这段映射里有 `rawResultJson(root)` —— 它对**每一条**工具调用做
   * 一次 JSON.stringify(…, null, 2)，把完整返回内容重新序列化成带缩进的字符串。
   * 一次 read 返回两千行文件就是几十到几百 KB，而这只在该条工具的「原始数据」
   * 页签被展开时才用到（KrToolCallsCard 里 tab === 'raw'）。写在渲染体里意味着
   * 每个 tick（useNow 1Hz）+ 每个流式快照都要白扔一遍，而且每次给下游
   * memo 的 KrToolCallsCard 都是全新数组 + 全新元素，卡片自己的 memo 必然失效。
   */
  const toolViews = useMemo<readonly ToolCallItemView[]>(() => tools.map((node, index) => {
    let name = 'tool'
    let title = '执行工具操作'
    let duration = '20ms'
    let status: 'success' | 'running' | 'failed' = 'success'
    let errorMsg: string | undefined
    let callId: string | undefined
    let argsRaw: string | undefined
    let args: Record<string, unknown> | undefined
    let resultText: string | undefined
    let rawJson: string | undefined
    let exitCode: number | undefined
    let signal: string | undefined

    try {
      const root = node.data.root
      callId = ('callId' in root ? (root as any).callId : undefined) || node.key
      name = callName(root)
      title = rowTitle(root)
      argsRaw = toolArgsRaw(root)
      args = argFields(argsRaw)
      resultText = resultParagraphs(root)
      rawJson = rawResultJson(root)
      const facts = executionFacts(root)
      exitCode = facts.exitCode
      signal = facts.signal

      const ms = callDurationMs(root, now)
      duration = ms !== undefined ? `${Math.round(ms)}ms` : '10ms'
      if (isRunning(root)) {
        status = 'running'
      } else {
        // 检查退出码或错误
        const r = root.result
        const isErr = root.isError || (r && (r.error || (typeof r.exitCode === 'number' && r.exitCode !== 0))) || (exitCode !== undefined && exitCode !== 0)
        if (isErr) {
          status = 'failed'
          errorMsg = typeof r?.error === 'string' ? r.error : (typeof (root as any).error === 'string' ? (root as any).error : ((root as any).error?.message || '工具执行返回非零状态或异常'))
        }
      }
    } catch {
      title = `工具调用 #${index + 1}`
    }

    return {
      id: node.key || `tool-${index}`,
      callId,
      name,
      description: title,
      durationText: duration,
      status,
      errorMessage: errorMsg,
      argsRaw,
      args,
      resultText,
      rawResultJson: rawJson,
      exitCode,
      signal,
    }
  }), [tools, now])

  // 任务数据源提取：优先使用本轮已记录的 todo_write / submitted-plan，当前未结轮次可回退到 live todos
  const tasks = useMemo<readonly DshTaskItem[]>(() => {
    if (turnData?.tasks && turnData.tasks.length > 0) {
      return turnData.tasks
    }
    if (!isViewingHistory) {
      const live = getLiveDshTodos()
      if (live && live.length > 0) {
        return live.map((item, idx) => ({
          id: `live-${idx}`,
          content: item.content,
          status: item.status,
        }))
      }
    }
    return []
  }, [turnData, isViewingHistory, todoTick, snapTick])

  // 人话行动时间线：把本轮工具调用翻成中文人话（「打开携程 · 机票」），
  // 并把模型在思考里自己播报的「下一步：…」抽成预告。纯推导，无副作用。
  // tools 已由 collectTurnNodes 按 anchorSeq 升序给出，无需再排。
  //
  // 意图抽取单独 memo：它要对整轮思考做一次 join + 逐行正则匹配，是这条链路上
  // 最贵的一步；而下面那个 memo 为了刷新「进行中」步骤的耗时，now 每秒都在变。
  // 绑在一起就等于每秒重扫几千字思考。拆开后只有思考真的增长时才重扫。
  const plainIntent = useMemo(() => extractIntent(reasoningTexts), [reasoningTexts])
  const plainTimeline = useMemo(
    () => buildPlainTimeline({
      reasoningTexts,
      intent: plainIntent,
      tools,
      running: currentRunning,
      now,
    }),
    [reasoningTexts, plainIntent, tools, currentRunning, now],
  )

  // 本轮/本会话是否已有可展示内容。新会话空白期一律走干净空态，
  // 绝不回落到 activityStore 里上一会话的缓存。
  // 回合已在执行（哪怕工具/思考尚未落盘）也算内容，避免空白新会话刚发起
  // 提问时错误地显示「等待本次对话开始」。
  // 「正在做什么」卡的预告行也算内容：模型可能还没调任何工具，但已经
  // 开口说了「接下来要做什么」，那一刻就不该是空态。
  const hasContent = currentRunning
    || tasks.length > 0
    || reasoningTexts.length > 0
    || tools.length > 0
    || (KR_PLAIN_TIMELINE_CARD_VISIBLE && plainTimeline.intent !== undefined)

  // 大盘副标题
  const subtitle = useMemo(() => {
    if (tasks.length > 0) {
      const done = tasks.filter((t) => t.status === 'completed').length
      return `${done}/${tasks.length} 项任务已完成`
    }
    if (currentRunning) return '正在执行工具调用…'
    if (tools.length > 0) return `${tools.length} 次工具调用 · 耗时 ${durationText}`
    return hasContent ? '对话已就绪' : '等待本次对话开始…'
  }, [tasks, currentRunning, tools.length, durationText, hasContent])

  // 对话截图弹窗控制
  const [shotOpen, setShotOpen] = useState(false)
  const { closing: shotClosing, requestClose: requestShotClose } = useModalClose(shotOpen, () => { setShotOpen(false) })

  /* ── 右栏挤压自适应 ─────────────────────────────────────────────────────
     记忆卡是滚动区之下的独立 flex footer（永远钉在右栏最下方，不可挤压），
     滚动区 flex:1 1 0 自动让出剩余高度。footer 高度变化会压缩滚动区，使
     「任务/思考/工具」三张卡溢出，唯一可让的尺寸是思考卡的视口行数：
       · 记忆卡条目变化 → KrMemoryCard 经 onContentChange 把 memoryTick +1；
       · 思考/工具内容变化 → 下面那份 fingerprint 跟着变；
       · 两者任一变化都让 useAdaptiveReasoningRows 重测，按溢出程度定一档行数。 */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [memoryTick, setMemoryTick] = useState(0)
  const handleMemoryContentChange = useCallback(() => { setMemoryTick((tick) => tick + 1) }, [])
  const reasoningChars = useMemo(
    () => reasoningTexts.reduce((sum, text) => sum + text.length, 0),
    [reasoningTexts],
  )
  const heightFingerprint = `${memoryTick}|${reasoningChars}|${reasoningTexts.length}|${tools.length}|${tasks.length}|${plainTimeline.steps.length}|${plainTimeline.intent ?? ''}`
  const reasoningRows = useAdaptiveReasoningRows(scrollRef, heightFingerprint)

  // 会话切换（新建 / 切换 / 离开）时重置本面板的本地视图状态，
  // 避免「截图弹窗开着」被带到新会话。
  useEffect(() => {
    setShotOpen(false)
  }, [latestChatSessionId])

  // ── 左边缘拖拽调宽 ────────────────────────────────────────────────────
  // pointer events（不是 mouse events）：Pointer Capture 保证指针滑出手柄、
  // 甚至滑出窗口后 move/up 依然派发给手柄，不丢拖拽；同时天然覆盖触屏。
  // 拖拽方向：向左拖 = 变宽（width = 视口右边缘 - 指针 x）。
  const width = krState.width
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{ pointerId: number; handle: HTMLElement } | null>(null)

  const handleDragStart = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const handle = e.currentTarget
    dragStateRef.current = { pointerId: e.pointerId, handle }
    // setPointerCapture 之后 move/up 事件始终派发给 handle，指针滑出也不断。
    try { handle.setPointerCapture(e.pointerId) } catch {}
    setDragging(true)
    e.preventDefault()
  }, [])

  useEffect(() => {
    if (!dragging) return
    // 全局光标/选择锁定：拖拽滑过左栏文字时不再误选中文本。
    document.body.setAttribute('data-kr-resizing', 'true')
    const onMove = (e: PointerEvent): void => {
      if (dragStateRef.current?.pointerId !== e.pointerId) return
      // 向左拖 = 变宽（面板左边缘 = 视口宽 - 面板宽）。store 内部钳制取值域。
      store.setPanelWidth(window.innerWidth - e.clientX)
    }
    const onUp = (e: PointerEvent): void => {
      if (dragStateRef.current?.pointerId !== e.pointerId) return
      const handle = dragStateRef.current.handle
      try { handle.releasePointerCapture(e.pointerId) } catch {}
      dragStateRef.current = null
      setDragging(false)
      store.commitPanelWidth()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      document.body.removeAttribute('data-kr-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, store])

  const collectForShot = useCallback((range: ShotRange): ShotMessage[] => {
    if (!latestChatSnapshot) return []
    return collectMessages(latestChatSnapshot, displayTurn, range)
  }, [displayTurn])

  const dialogueTitle = useMemo(() => {
    const snap = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
    // 1. 优先直接从官方快照的 navigation.current 提取真实提问 Prompt
    if (snap?.navigation?.current && Array.isArray(snap.navigation.current)) {
      const navItem = snap.navigation.current.find((n: any) => n.turn === displayTurn)
      if (navItem?.prompt && typeof navItem.prompt === 'string' && navItem.prompt.trim() !== '') {
        const p = navItem.prompt.trim()
        return p.length > 60 ? `${p.slice(0, 60)}…` : p
      }
    }
    // 2. 从 deriveCurrentDialogueTitle 中基于消息节点深入提取
    if (snap) {
      try {
        const title = deriveCurrentDialogueTitle(snap, displayTurn)
        if (title && title.trim() !== '') {
          return title
        }
      } catch (err) {
        console.warn('[kr-agent-panel] deriveCurrentDialogueTitle error', err)
      }
    }
    // 3. DOM 兜底：直接从左侧对话流中查找该轮的用户提问或主要文字
    if (typeof document !== 'undefined') {
      try {
        const userEl = document.querySelector<HTMLElement>(`[data-chat-turn="${displayTurn}"][data-chat-flow-kind="user"], [data-chat-turn="${displayTurn}"] [data-chat-flow-kind="user"]`)
        if (userEl) {
          const text = userEl.textContent?.trim()
          if (text) {
            const clean = text.replace(/\d+月\d+日\s+\d+:\d+.*$/, '').trim()
            if (clean) return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean
          }
        }
        const turnEls = document.querySelectorAll<HTMLElement>(`[data-chat-turn="${displayTurn}"]`)
        for (const el of turnEls) {
          const kind = el.getAttribute('data-chat-flow-kind')
          if (kind === 'assistant-step') {
            const text = el.textContent?.trim()
            if (text) {
              const clean = text.replace(/^本轮完成.*?[Git\d]+/, '').trim()
              if (clean) return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean
            }
          }
        }
      } catch {}
    }
    return ''
  }, [displayTurn, actTick, snapTick])

  // 大盘顶栏标题：直接展示选中的对话内容/标题，而不是“第几轮”
  const headerTitle = useMemo(() => {
    if (dialogueTitle && dialogueTitle.trim() !== '') {
      return dialogueTitle
    }
    if (currentRunning) return 'Agent 执行中'
    if (validSelectedTurn !== null) return '已选对话'
    return hasContent ? '任务已完成' : '新对话'
  }, [dialogueTitle, currentRunning, validSelectedTurn, hasContent])

  return (
    <div
      className={`kr-split__side ${krState.fullscreen ? 'kr-split__side--fullscreen' : ''}`}
      data-dragging={dragging ? 'true' : undefined}
      style={krState.fullscreen ? undefined : { width, minWidth: width, maxWidth: width }}
    >
      {/*
        左边缘拖拽手柄：按住向左拖 = 加宽，向右拖 = 收窄；宽度持久化。

        键盘可达是必须的：全仓库只有这一处能调大盘宽度，store 里那个
        resetPanelWidth() 至今没有任何 UI 调用它 —— 手柄不可聚焦、只能拖的话，
        键盘用户完全无法调整（WCAG 2.1.1），读屏用户听到「拖拽调整大盘宽度，
        分隔符」却什么也做不了。所以给它 tabIndex + aria-valuenow/min/max，
        并接上 ←/→（Shift 加速）与 Home（回默认宽度）。
      */}
      <div
        className="kr-panel__resize-handle"
        onPointerDown={handleDragStart}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={PANEL_WIDTH_MIN}
        aria-valuemax={PANEL_WIDTH_MAX}
        aria-label="调整大盘宽度"
        title="拖拽调整大盘宽度；键盘 ←/→ 微调，Shift 加速，Home 恢复默认"
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 16
          if (event.key === 'ArrowLeft') {
            // 向左 = 面板变宽（与拖拽方向一致：宽度 = 视口右缘 - 指针 x）
            event.preventDefault()
            store.setPanelWidth(width + step)
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            store.setPanelWidth(width - step)
          } else if (event.key === 'Home') {
            event.preventDefault()
            store.resetPanelWidth()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            store.resetPanelWidth()
          }
        }}
        onKeyUp={(event) => {
          // 键盘调完宽度也要落盘，行为与拖拽结束一致。
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight'
            || event.key === 'Home' || event.key === 'Enter') {
            store.commitPanelWidth()
          }
        }}
      />
      {/* 顶部 Header：头像 + 标题（当前对话提问）+ 副标题（任务/工具统计行）
          + 右侧「生成对话截图」「收起大盘 ×」两枚按钮。
          整块由 KR_PANEL_HEADER_VISIBLE 门控（默认隐藏，只隐藏不删除）：
          收起入口在顶部标签行最右端的「Agent 轨迹大盘」开关，截图入口在
          assistant 消息操作栏的相机按钮，因此隐藏顶栏不丢任何能力。 */}
      {KR_PANEL_HEADER_VISIBLE && (
      <div className="kr-panel__header">
        <div className="kr-panel__avatar">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="8" width="16" height="12" rx="2" />
            <path d="M12 2v6M9 5h6M8 14h.01M16 14h.01M10 17h4" />
          </svg>
        </div>

        <div className="kr-panel__titles">
          <div className="kr-panel__title-row">
            <span className={`kr-panel__status-dot ${currentRunning ? 'kr-panel__status-dot--running' : ''}`} />
            <span className="kr-panel__title" title={headerTitle}>
              {headerTitle}
            </span>
            {validSelectedTurn !== null && (
              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(127, 127, 127, 0.12)', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--kr-card-border)', fontWeight: 500, flex: 'none' }}>
                已选对话
              </span>
            )}
          </div>
          {/* 统计副标题：纯展示，不可点击（统计指标按钮与药丸行已按要求移除） */}
          <div className="kr-panel__subtitle" title={subtitle}>
            {subtitle}
          </div>
        </div>

        <div className="kr-panel__actions">
          <button
            type="button"
            className="kr-panel__action-btn"
            onClick={() => setShotOpen(true)}
            title="生成对话截图"
            aria-label="生成对话截图"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path
                d="M9.75 2.5H6.25L4.85 4.5H3C2.17 4.5 1.5 5.17 1.5 6V12.5C1.5 13.33 2.17 14 3 14H13C13.83 14 14.5 13.33 14.5 12.5V6C14.5 5.17 13.83 4.5 13 4.5H11.15L9.75 2.5Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="9.25" r="2.25" />
            </svg>
          </button>
          <button
            type="button"
            className="kr-panel__action-btn"
            onClick={onCollapse}
            title="收起右侧大盘"
            aria-label="收起右侧大盘"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      )}

      {/* 滚动卡片列表 */}
      <div className="kr-panel__scroll" ref={scrollRef}>
        {/* 空态：本次对话尚无任何内容（新会话空白期）。显式渲染，
            不依赖各卡片自行 return null —— 避免上一会话的缓存数据漏进来。 */}
        {!hasContent && !isViewingHistory && (
          <div className="kr-panel__empty">
            <div className="kr-panel__empty-icon">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="8" width="16" height="12" rx="2" />
                <path d="M12 2v6M9 5h6M8 14h.01M16 14h.01M10 17h4" />
              </svg>
            </div>
            <div className="kr-panel__empty-title">等待本次对话开始</div>
            <div className="kr-panel__empty-desc">发送消息后，任务、思考与工具调用会实时显示在这里</div>
          </div>
        )}

        {/*
         * 原先这里有一条「已选对话：xxx / 返回最新对话」的提示带。
         * 整条删掉：它常驻在大盘顶部，和下面的卡片标题叠在一起既占位又抢注意力，
         * 而且「返回最新对话」这个动作本身是多余的——点击对话流里任意一条消息
         * 就会切换到那一轮，再点另一条即可返回，不需要一个常驻按钮提醒。
         * 仍保留 store.setSelectedTurn 的能力，只是入口不再常驻占位。
         */}

        {/* 任务概览卡片：常驻，无任务时给一行低对比度空态 */}
        <KrTaskOverviewCard tasks={tasks} isRunning={currentRunning} />

        {/* 思考过程卡片（行数随右栏挤压自适应：默认 25 行，空间不够自动降档） */}
        <KrReasoningCard
          reasoningTexts={reasoningTexts}
          running={currentRunning}
          maxRows={reasoningRows}
        />

        {/* 工具调用卡片 */}
        <KrToolCallsCard
          tools={toolViews}
          onInspectCall={(callId) => {
            try {
              actStore.handlers().inspectCall(callId)
            } catch (err) {
              console.warn('[kr-agent-panel] inspectCall error', err)
            }
          }}
        />

        {/* 人话行动流：工具调用卡之下。给不懂技术的用户看的一张——
            「已经做了什么」来自上面的工具调用事实，「准备做什么」来自模型
            自己播报的预告。放在末尾而不是置顶，是因为它是复盘用的完整流水，
            置顶会跟「任务概览」抢第一眼的注意力。 */}
        {KR_PLAIN_TIMELINE_CARD_VISIBLE && (
          <KrPlainTimelineCard
            timeline={plainTimeline}
            running={currentRunning}
            squeezed={reasoningRows < REASONING_MAX_ROWS}
            sessionId={latestChatSessionId}
          />
        )}
      </div>

      {/* 记忆卡停靠区：滚动区之下的独立 flex footer（.kr-panel__memory-dock）。
          不再放滚动容器内部——sticky 只能在「内容溢出且滚动」时贴底，内容少时
          卡片会悬在中间；独立 footer 才能做到「永远钉在右栏最下方」。分「工作区
          记忆 / 全局记忆」两个分区，支持多选批量删除。

          footer 现在恒不为空：用时细行常驻在上方，即使记忆卡因「本会话没有新增」
          而 return null，这一行也照旧在（它跟记忆无关）。 */}
      {(KR_MEMORY_CARD_VISIBLE || elapsedMeasured) && (
        <div className="kr-panel__memory-dock">
          {elapsedMeasured && (
            <KrTurnTimer text={durationText} running={currentRunning && !isViewingHistory} />
          )}
          {KR_MEMORY_CARD_VISIBLE && (
            <KrMemoryCard
              squeezed={reasoningRows < REASONING_MAX_ROWS}
              onContentChange={handleMemoryContentChange}
            />
          )}
        </div>
      )}

      {shotOpen && (
        <ShotPanel
          closing={shotClosing}
          onClose={requestShotClose}
          collect={collectForShot}
          initialRange="turn"
          title={dialogueTitle || '对话记录'}
          dialogueTitle={dialogueTitle}
          sessionTitle={dialogueTitle}
          cwd=""
        />
      )}
    </div>
  )
})
