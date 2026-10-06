/**
 * dsh-chat-plus — KR 对话右侧 Agent 实时执行与轨迹大盘。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { activityStore } from '../tool-summary/activity-drawer.tsx'
import { latestChatSnapshot, latestChatSessionId, collectTurnNodes, collectLatestSessionTasks, subscribeLatestChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'
import { callDurationMs, formatDuration, isRunning } from '../tool-summary/tool-stats.ts'
import { toolArgsRaw } from '../tool-summary/activity-view-model.ts'
import { useNow } from '../tool-summary/use-now.ts'
import { getKrChatStore, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from './kr-chat-store.ts'
import { KrTaskOverviewCard, type DshTaskItem, type TaskSource } from './KrTaskOverviewCard.tsx'
import { KrMemoryCard } from './KrMemoryCard.tsx'
import { usePanelSqueezed } from './use-adaptive-rows.ts'
import { ShotPanel } from '../shot/Panel.tsx'
import { collectMessages, deriveCurrentDialogueTitle, type ShotRange, type ShotMessage } from '../shot/collect.ts'
import { useModalClose } from '../modal-animation.ts'
import { getLiveDshTodos, subscribeLiveDshTodos } from './kr-todo-bridge.ts'
import { buildPlainTimeline } from './plain-timeline.ts'
import { KrPlainTimelineCard } from './KrPlainTimelineCard.tsx'
import { KrOutputsCard } from './KrOutputsCard.tsx'
import { collectOutputs, collectSessionToolNodes, outputsFingerprint, type OutputsView } from './outputs.ts'
import { AGENT_DISPLAY_NAME, KR_MEMORY_CARD_VISIBLE, KR_OUTPUTS_CARD_VISIBLE, KR_PANEL_HEADER_VISIBLE, KR_PLAIN_TIMELINE_CARD_VISIBLE } from './enabled.ts'
import { installConversationScrollGuard } from './scroll-guard.ts'
import { useOfficialWidthHandleFix } from './official-width-handles.ts'

/**
 * 左侧对话流必须保留的最小宽度（px）。
 *
 * 官方 AppFrame 把中心栏钳到 CENTER_MIN=400（ui-layout/columns.ts），本面板正是
 * 挂在中心栏里、且与对话流平分这 400px。留 380 给对话流，剩下 20px 的余量刚好
 * 抵掉两侧滚动条 —— 再窄，正文一行放不下十几个字，双栏就失去意义了。
 */
const CHAT_FLOW_MIN_WIDTH = 380

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
  /**
   * 大盘已是 KR 对话的常驻右栏，**没有收起态**：原先的 onCollapse（收起大盘 ×）
   * 与标签行那枚「Agent 轨迹大盘」开关是一对，一起按用户要求删掉了。
   */
}

export const KrAgentPanel = memo(function KrAgentPanel({
  latestTurn,
  isTurnRunning,
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

  // 对话滚动守卫（2026-10-04 修「滚到上面读旧内容，点一下右栏就被拽回底部」）：
  // 官方跟随控制器在内容提交/布局变化时会把不贴底的读者拉回 floor，插件层常驻
  // 状态机只对抗「无用户意图 + 短窗口落底」这一种指纹，其余一律放行。
  useEffect(() => installConversationScrollGuard(), [])

  // 官方「正文宽度」两条拖拽手柄按**容器中心**定位（见 official-width-handles.ts）。
  // Seeker 把容器改成 flex row 并塞进本面板后，容器比对话流宽出一个面板，手柄于是
  // 整体右移半个面板宽 —— 用户报的「官方那个拖拽手柄不在对应的位置」。这里在面板
  // 挂载期间把它们摆回对话流内容区两侧（可拖、可调宽度，只是位置对了），
  // 卸载即还原官方原样。
  useOfficialWidthHandleFix()

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

  /*
   * 会话切换时清掉选中轮次。
   *
   * 上面那条只处理「越界」：切到轮次更少的会话时才解除。反过来的情况——从 2 轮
   * 的会话切到 8 轮的会话、且此前点选过第 2 轮——选中值仍然"合法"，于是右栏
   * 会**停在新会话的第 2 轮**而不是最新轮次。用户刚切过来看到的是几轮之前的
   * 中间状态：任务概览显示那时写过的旧清单、操作面板只剩那一轮的动作，
   * 读起来就是「信息没了」。轮次选中是**会话内**的浏览位置，跨会话不该继承。
   *
   * 会话身份由 KrTodoBridge 登记，setLatestChatSessionId 里已经清过一次
   * （resetSessionCaches），这里再兜一层：本组件在会话切换后可能先于座位
   * effect 渲染，只靠那一路会漏掉一帧。
   */
  const sessionIdRef = useRef<string | null>(latestChatSessionId)
  useEffect(() => {
    if (sessionIdRef.current === latestChatSessionId) return
    sessionIdRef.current = latestChatSessionId
    if (krState.selectedTurn !== null) store.setSelectedTurn(null)
  }, [latestChatSessionId, krState.selectedTurn, store])

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
   * 下游 reasoningTexts / tools 的 memo 拿不到稳定引用 → 每帧被击穿 →
   * plainTimeline 的 steps 整份重建。而快照发布的频率在流式期很高（每个 delta
   * 一次），不是每秒一次。
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

  /*
   * 会话产出物（「产出物」卡）。
   *
   * 口径是**整个会话累计**，不随选中的轮次切换：这张卡回答的是「这次对话一共
   * 做出来了什么」，而轮次切换是"我想看看某一轮发生了什么"——两者问的不是
   * 一件事。跨全部轮次收集，所以走 snapshot 全量节点而不是本轮 locations。
   *
   * 与 turnData 同一套引用稳定化：collectSessionToolNodes 每次返回新数组，
   * 而它下游要做的是「遍历全部工具节点 + 对没见过的节点扫结果文本」。指纹
   * 不变就复用上一次的引用，下游整条 memo 链原样命中。
   */
  const outputsCacheRef = useRef<{ sig: string; data: OutputsView } | null>(null)
  const outputs = useMemo<OutputsView>(() => {
    const snap = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
    let next: OutputsView
    try {
      next = collectOutputs(collectSessionToolNodes(snap))
    } catch (err) {
      // 节点形状未知时不该让整张卡消失：退到空态。
      console.warn('[kr-agent-panel] collectOutputs error', err)
      next = { items: [], code: [] }
    }
    const sig = outputsFingerprint(next)
    const cached = outputsCacheRef.current
    if (cached !== null && cached.sig === sig) return cached.data
    outputsCacheRef.current = { sig, data: next }
    return next
  }, [actTick, snapTick])

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
   * 下面的兜底分支会拿「工具数 × 800ms + 1500ms」硬凑一个数——对副标题里
   * 「N 次工具调用 · 耗时 …」这句统计说明无所谓，但对话流活动卡上那枚常驻
   * 读数只认真实起点（见 KrLiveActivityCard），拿不到就不渲染。
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

  // 任务数据源提取：优先使用本轮已记录的 todo_write / submitted-plan，当前未结轮次可回退到 live todos；
  // 均为空时跨轮次回溯获取会话最近有效的任务清单，绝不误显“本轮还没有任务”。
  // source 记录走了哪条路：'turn'（本轮快照）/ 'live'（官方 todos 投影）/
  // 'session'（会话回溯）/ 'none'（空）。卡片用它做口径标注——回溯到别的轮次
  // 的清单时给一枚「会话清单」小标，避免用户误以为看到的是本轮任务。
  const tasksView = useMemo<{ tasks: readonly DshTaskItem[]; source: TaskSource }>(() => {
    if (turnData?.tasks && turnData.tasks.length > 0) {
      return { tasks: turnData.tasks, source: 'turn' }
    }
    if (!isViewingHistory) {
      const live = getLiveDshTodos()
      if (live && live.length > 0) {
        return {
          tasks: live.map((item, idx) => ({
            id: `live-${idx}`,
            content: item.content,
            status: item.status,
          })),
          source: 'live',
        }
      }
    }
    /*
     * 回溯口径是**整场会话最近一次**，不再限制在 displayTurn 之前。
     *
     * 原实现传 `displayTurn`（截止到当前查看的轮次），于是点开一个**自己没写过
     * todo** 的历史轮次时回溯不到任何清单，任务卡直接翻成「本轮还没有任务」——
     * 用户看到的就是「一切换轮次/会话，任务信息就没了」。可任务卡回答的是
     * 「这次对话在推进什么」，那是**跨轮次持续**的事实：切到第 1 轮去看当时干了
     * 什么，不代表当前推进中的清单应该消失。有本轮的优先用本轮的，没有就退回
     * 会话最近一次。
     */
    const snap = latestChatSnapshot || (typeof window !== 'undefined' ? (window as any).__dshLatestChatSnapshot__ : null)
    if (snap) {
      const fallbackTasks = collectLatestSessionTasks(snap)
      if (fallbackTasks && fallbackTasks.length > 0) {
        return { tasks: fallbackTasks, source: 'session' }
      }
    }
    return { tasks: [], source: 'none' }
  }, [turnData, isViewingHistory, todoTick, snapTick, displayTurn])
  const tasks = tasksView.tasks


  // 人话行动时间线：把本轮工具调用翻成中文人话（「打开携程 · 机票」）。
  // 纯推导，无副作用。tools 已由 collectTurnNodes 按 anchorSeq 升序给出，无需再排。
  const plainTimeline = useMemo(
    () => buildPlainTimeline({
      tools,
      running: currentRunning,
      now,
    }),
    [tools, currentRunning, now],
  )

  // 本轮/本会话是否已有可展示内容。新会话空白期一律走干净空态，
  // 绝不回落到 activityStore 里上一会话的缓存。
  // 回合已在执行（哪怕工具/思考尚未落盘）也算内容，避免空白新会话刚发起
  // 提问时错误地显示「等待本次对话开始」。
  const hasContent = currentRunning
    || tasks.length > 0
    || reasoningTexts.length > 0
    || tools.length > 0
    // 产出物是**会话累计**的：本轮刚开始、什么都还没落盘时，前几轮做出的文件
    // 依然该被看见。不算进来的话，切到新一轮的瞬间整栏会闪一次空态。
    || outputs.items.length > 0
    || outputs.code.length > 0

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
     滚动区 flex:1 1 0 自动让出剩余高度。footer 太高时滚动区内容放不下，
     此刻让操作面板与记忆卡各自缩一档：
       · 记忆卡条目变化 → KrMemoryCard 经 onContentChange 把 memoryTick +1；
       · 思考/工具内容变化 → 下面那份 fingerprint 跟着变；
       · 两者任一变化都让 usePanelSqueezed 重测一次。
     思考过程卡已于 2026-09-28 移到 KR 对话流内联展示（右栏不再有可缩放的
     思考视口），所以这里保留的只是「挤了没有」这一个布尔量。 */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [memoryTick, setMemoryTick] = useState(0)
  const handleMemoryContentChange = useCallback(() => { setMemoryTick((tick) => tick + 1) }, [])
  const reasoningChars = useMemo(
    () => reasoningTexts.reduce((sum, text) => sum + text.length, 0),
    [reasoningTexts],
  )
  const heightFingerprint = `${memoryTick}|${reasoningChars}|${reasoningTexts.length}|${tools.length}|${tasks.length}|${plainTimeline.steps.length}|${outputs.items.length}|${outputs.code.length}`
  const panelSqueezed = usePanelSqueezed(scrollRef, heightFingerprint)

  // 会话切换（新建 / 切换 / 离开）时重置本面板的本地视图状态，
  // 避免「截图弹窗开着」被带到新会话。
  useEffect(() => {
    setShotOpen(false)
  }, [latestChatSessionId])

  // ── 左边缘拖拽调宽 ────────────────────────────────────────────────────
  // pointer events（不是 mouse events）：Pointer Capture 保证指针滑出手柄、
  // 甚至滑出窗口后 move/up 依然派发给手柄，不丢拖拽；同时天然覆盖触屏。
  //
  // 锚点是**面板自身右缘**，不是 window.innerWidth。
  // 官方 AppFrame 是三栏 grid（sidebar | center | rightbar，见
  // @deepseek-ai/dsh-client-ui-layout 的 AppFrame.tsx），本面板挂在 center 栏内的
  // [data-conversation-content] 里，其右缘 = frame 右缘 - rightbar 宽度。官方
  // rightbar 默认占视口 45%、还能被用户继续拖宽，sidebar 也可展开/折叠成 rail ——
  // 于是「视口右缘」与「面板右缘」之间恒有一段偏差 δ。旧算法 width = innerWidth - x
  // 把这段 δ 错算进宽度，手柄于是恒定偏在指针左边 δ 像素，表现为「拖不动 / 位置不对」，
  // 右栏一开 δ 更大、错位更明显。改成量自己的 getBoundingClientRect().right 后：
  // 面板左缘 = right - width = 指针 x，与指针逐像素对齐，且官方三栏怎么变都不用跟改。
  const width = krState.width
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const widthBadgeRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; handle: HTMLElement } | null>(null)
  /**
   * 手势内冻结的锚点。right 是拖拽起手那一帧的面板右缘（全程不重取，避免布局
   * 抖动把基准带跑）；max 是这次手势允许的宽度上限（见下）。
   */
  const dragAnchorRef = useRef<{ right: number; max: number } | null>(null)
  /**
   * 当前空间允许的宽度上限。拖拽与键盘共用：官方 rightbar / 侧边栏一变，中心栏
   * 宽窄就变，静态的 PANEL_WIDTH_MAX 不再是真实天花板。挂载时与窗口 resize 时重算。
   */
  const [spaceMax, setSpaceMax] = useState(PANEL_WIDTH_MAX)
  /** handleDragStart 是空依赖的稳定回调，需要读 fullscreen 时走这个镜像。 */
  const krStateRef = useRef(krState)
  krStateRef.current = krState

  /**
   * 本次手势的宽度上限：除了 store 的静态 PANEL_WIDTH_MAX，还要受**当前可用空间**
   * 约束。中心栏宽度会随官方 rightbar 开合、侧边栏展开/折叠而变，中心栏最窄被官方
   * 钳到 CENTER_MIN=400；若此时仍允许 720，KR 面板会吃掉整个中心栏、把左栏对话流
   * 压成 0 宽（content 是 overflow:hidden，看起来就是「面板糊满一整块」）。
   * 所以上限取 min(静态上限, 宿主宽 - 左栏对话流最小可读宽)，并保底不低于面板自身
   * 最小宽 —— 空间实在不够时宁可让左栏窄，也不能让面板宽度算成负数或缩到 0。
   */
  const resolveDragMax = useCallback((): number => {
    const panel = panelRef.current
    if (!panel) return PANEL_WIDTH_MAX
    const host = panel.closest('[data-conversation-content]') as HTMLElement | null
    if (!host) return PANEL_WIDTH_MAX
    const hostWidth = host.getBoundingClientRect().width
    if (!(hostWidth > 0)) return PANEL_WIDTH_MAX
    const maxBySpace = Math.max(PANEL_WIDTH_MIN, Math.round(hostWidth - CHAT_FLOW_MIN_WIDTH))
    return Math.min(PANEL_WIDTH_MAX, maxBySpace)
  }, [])

  // 空间上限随官方三栏布局的变化实时重算：官方 rightbar 的开关/拖拽、侧边栏的
  // 展开/折叠都会改中心栏宽度，而它们发生在我们的组件之外，只能靠观测宿主盒。
  // ResizeObserver 打在 [data-conversation-content] 上（比 window.resize 精确：
  // 官方三栏重排不改变窗口宽度，却会改变这个盒的宽度）。
  useEffect(() => {
    const panel = panelRef.current
    const host = panel?.closest('[data-conversation-content]') as HTMLElement | null
    if (!host) return
    const sync = (): void => setSpaceMax(resolveDragMax())
    sync()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync)
      return () => window.removeEventListener('resize', sync)
    }
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    return () => observer.disconnect()
  }, [resolveDragMax])

  const handleDragStart = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    // 全屏态面板铺满整栏，宽度由 CSS !important 决定，拖拽无意义 —— 直接不接。
    if (krStateRef.current.fullscreen) return
    const handle = e.currentTarget
    const panel = panelRef.current
    if (!panel) return
    dragStateRef.current = { pointerId: e.pointerId, handle }
    dragAnchorRef.current = { right: panel.getBoundingClientRect().right, max: resolveDragMax() }
    setSpaceMax(dragAnchorRef.current.max)
    // setPointerCapture 之后 move/up 事件始终派发给 handle，指针滑出也不断。
    try { handle.setPointerCapture(e.pointerId) } catch {}
    setDragging(true)
    e.preventDefault()
  }, [resolveDragMax])

  useEffect(() => {
    if (!dragging) return
    // 全局光标/选择锁定：拖拽滑过左栏文字时不再误选中文本。
    document.body.setAttribute('data-kr-resizing', 'true')
    // rAF 节流：setPanelWidth 会广播到整棵 KR 面板订阅树，按原始 pointermove
    // 频率（可达 120Hz+）重渲染只会让拖拽发涩、跟手发飘。每帧至多一次。
    let frame: number | null = null
    let queued: number | null = null
    const flush = (): void => {
      frame = null
      if (queued === null) return
      const anchor = dragAnchorRef.current
      if (!anchor) return
      // 向左拖 = 变宽：面板左缘 = 锚点右缘 - 宽度，令它贴住指针 x。
      const next = Math.min(anchor.max, anchor.right - queued)
      queued = null
      store.setPanelWidth(next)
      // 宽度读数直写 DOM 文本，不走 setState：数值每帧都变，交给 React 会把
      // 整个大盘按帧重渲染一遍。读 snapshot.width 而不是 next —— store 还会
      // 按 [PANEL_WIDTH_MIN, PANEL_WIDTH_MAX] 二次钳制，气泡要显示真正生效的值，
      // 否则撞到上限时会出现「气泡还在涨、面板不动」。
      if (widthBadgeRef.current) {
        widthBadgeRef.current.textContent = `${store.snapshot.width} px`
      }
    }
    const onMove = (e: PointerEvent): void => {
      if (dragStateRef.current?.pointerId !== e.pointerId) return
      queued = e.clientX
      frame ??= requestAnimationFrame(flush)
    }
    const onUp = (e: PointerEvent): void => {
      if (dragStateRef.current?.pointerId !== e.pointerId) return
      if (frame !== null) { cancelAnimationFrame(frame); frame = null }
      // 最后一帧的位移不能丢：抬手与 move 之间常有一小段没派发的位移。
      if (queued !== null) {
        const anchor = dragAnchorRef.current
        if (anchor) store.setPanelWidth(Math.min(anchor.max, anchor.right - queued))
        queued = null
      }
      const handle = dragStateRef.current.handle
      try { handle.releasePointerCapture(e.pointerId) } catch {}
      dragStateRef.current = null
      dragAnchorRef.current = null
      setDragging(false)
      store.commitPanelWidth()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
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
    if (currentRunning) return `${AGENT_DISPLAY_NAME} 执行中`
    if (validSelectedTurn !== null) return '已选对话'
    return hasContent ? '任务已完成' : '新对话'
  }, [dialogueTitle, currentRunning, validSelectedTurn, hasContent])

  return (
    <div
      ref={panelRef}
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
        tabIndex={krState.fullscreen ? -1 : 0}
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={PANEL_WIDTH_MIN}
        aria-valuemax={spaceMax}
        aria-disabled={krState.fullscreen ? 'true' : undefined}
        aria-label="调整大盘宽度"
        title="拖拽调整大盘宽度；键盘 ←/→ 微调，Shift 加速，Home 恢复默认"
        onKeyDown={(event) => {
          // 键盘与拖拽共用同一条空间上限：官方右栏/侧边栏一改，静态的
          // PANEL_WIDTH_MAX 就不是真实天花板，键盘也不能把面板推出中心栏。
          const step = event.shiftKey ? 64 : 16
          if (event.key === 'ArrowLeft') {
            // 向左 = 面板变宽（与拖拽方向一致）
            event.preventDefault()
            store.setPanelWidth(Math.min(spaceMax, width + step))
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
      {/*
        拖拽中的实时宽度读数。

        纯 CSS 显隐（挂在 [data-dragging] 下），文本由 pointermove 直接写
        textContent —— 数值每帧都变，走 setState 会把整棵大盘按帧重渲染。
        进入拖拽的那一帧 effect 补一次初值，让气泡不是从空字符串跳出来。
      */}
      <div
        ref={widthBadgeRef}
        className="kr-panel__resize-badge"
        aria-hidden="true"
      >{`${width} px`}</div>

      {/* 顶部 Header：头像 + 标题（当前对话提问）+ 副标题（任务/工具统计行）
          + 右侧「生成对话截图」一枚按钮（原先还有一枚「收起大盘 ×」，与标签行
          那枚开关是一对，已随大盘常驻化一起删除）。
          整块由 KR_PANEL_HEADER_VISIBLE 门控（默认隐藏，只隐藏不删除）：
          截图入口另有归属 —— assistant 消息操作栏的相机按钮常驻（见
          shot/index.tsx），走同一个 ShotPanel。 */}
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
            <div className="kr-panel__empty-desc">发送消息后，任务、思考与操作进展会实时显示在这里</div>
          </div>
        )}

        {/*
         * 原先这里有一条「已选对话：xxx / 返回最新对话」的提示带。
         * 整条删掉：它常驻在大盘顶部，和下面的卡片标题叠在一起既占位又抢注意力，
         * 而且「返回最新对话」这个动作本身是多余的——点击对话流里任意一条消息
         * 就会切换到那一轮，再点另一条即可返回，不需要一个常驻按钮提醒。
         * 仍保留 store.setSelectedTurn 的能力，只是入口不再常驻占位。
         */}

        {/* 任务概览卡片：常驻，无任务时给一行低对比度空态。
            source 传三级回退的口径（turn/live/session），卡片据此决定是否
            标注「会话清单」——回溯数据不该被误读成本轮任务。 */}
        <KrTaskOverviewCard tasks={tasks} isRunning={currentRunning} source={tasksView.source} />

        {/* 思考过程卡已从右栏移出，改为贴在 KR 对话流里（见 ThinkingStepNodeView
            挂的 KrReasoningCard inline 模式）：思考与它对应的回答是同一件事的
            两半，分两栏摆就得来回对照才读得完整。thinking 文本在本面板仍要留
            一份——操作面板的「接下来」预告要从里面抽播报句。 */}

        {/* 人话行动流（「操作面板」卡）。给不懂技术的用户看的一张：「已经做了什么」
            来自工具调用事实，「准备做什么」来自模型自己播报的预告。原先下面还挂
            着一张技术视角的「工具调用」卡，两张卡讲的是同一批事件，现已按用户
            要求整块移除，工具细节统一收进本卡每条末尾的「技术细节」折叠。 */}
        {KR_PLAIN_TIMELINE_CARD_VISIBLE && (
          <KrPlainTimelineCard
            timeline={plainTimeline}
            running={currentRunning}
            squeezed={panelSqueezed}
            sessionId={latestChatSessionId}
          />
        )}

        {/* 产出物卡：会话累计的成品清单（操作面板之下，滚动区最后一张）。
            与上面那张的分工是「过程 vs 结果」——操作面板回答"中间做了哪些动作"，
            这张回答"最后落地了哪些文件"。整行可点，点一下即在右栏打开预览。
            口径是整个会话而非本轮，所以不看 displayTurn（理由见上面 outputs 的注释）。 */}
        {KR_OUTPUTS_CARD_VISIBLE && (
          <KrOutputsCard
            outputs={outputs}
            squeezed={panelSqueezed}
            sessionId={latestChatSessionId}
          />
        )}
      </div>

      {/*
        右栏底部：滚动区之外的独立 flex footer（.kr-panel__memory-dock）。
        不放滚动容器内部——sticky 只能在「内容溢出且滚动」时贴底，内容少时卡片会
        悬在中间；独立 footer 才能做到「永远钉在右栏最下方」。

        现在只剩**记忆卡**一块：保持钉在最后，维持用户已有的空间习惯；分「工作区
        记忆 / 全局记忆」两个分区，支持多选批量删除。用时与工具调用都已移出
        footer：用时搬去了对话流里那张「Seeker 正在…」活动卡（用时读数跟着本轮
        动作走，所见即所测）；工具调用卡整块移除，工具细节只留在「操作面板」
        每条末尾的「技术细节」折叠里。

        记忆卡 return null 时 footer 命中 :empty，自身连 padding 一起收起。
      */}
      {KR_MEMORY_CARD_VISIBLE && (
        <div className="kr-panel__memory-dock">
          <KrMemoryCard
            squeezed={panelSqueezed}
            onContentChange={handleMemoryContentChange}
          />
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
