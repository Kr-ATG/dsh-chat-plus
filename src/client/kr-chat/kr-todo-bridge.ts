/**
 * dsh-chat-plus — DSH 原生 todo 投影桥接器。
 * 注入至 conversation.input.dock 槽位，静默获取官方 useProjection('todos') 实时数据并广播。
 *
 * 该座位同时是插件的「会话身份登记点」：input.dock 是 session 作用域且在新建
 * 会话的空白 Hero 态照常渲染，因此 sessionId 变化（新建 / 切换 / 离开）能第一
 * 时间被捕获，用于清空右侧大盘的上一会话残留数据。
 */
import { useEffect, useRef } from 'react'
import {
  setLatestChatSessionId,
  getLatestChatSessionId,
  setLatestChatSnapshot,
  leaveCurrentChatSession,
} from '../tool-summary/TurnProcessShadowView.tsx'

export interface DshTodoItem {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

let liveTodos: readonly DshTodoItem[] = []
/**
 * 这份 liveTodos 属于哪个会话（null = 来源未声明归属）。
 *
 * 与 latestChatSnapshot 的 owner 同一个理由：`liveTodos` 是模块级全局，
 * 清理一旦漏跑（例如某条离开会话的路径没调到 clearLiveDshTodos），新会话就会
 * 读到上一会话的任务清单。记上归属后，**读取口自己就能拒绝跨会话数据**，
 * 不再依赖「每个离开路径都记得清」这种易漏的约定。
 */
let liveTodosOwner: string | null = null
const listeners = new Set<() => void>()

/**
 * 读取当前 live todos（**仅在它属于当前会话时**返回，否则空数组）。
 *
 * 消费方一律走这个函数。会话身份来自 TurnProcessShadowView 的登记口——
 * 这里刻意用「读取时比对」而不是「写入时校验」：写入时机与身份登记时机
 * 存在先后竞态（座位 effect 与投影 effect 谁先跑不确定），写入时校验会误杀
 * 合法数据；读取时比对只回答「这份数据现在还能不能用」，语义更准。
 */
export function getLiveDshTodos(): readonly DshTodoItem[] {
  if (liveTodosOwner === null) return liveTodos
  const current = getLatestChatSessionId()
  if (current === null) return []
  return liveTodosOwner === current ? liveTodos : []
}

export function setLiveDshTodos(todos: readonly DshTodoItem[], sessionId?: string | null): void {
  liveTodos = Array.isArray(todos) ? todos : []
  /*
   * owner 语义与快照完全一致（见 TurnProcessShadowView.setLatestChatSnapshot 的
   * 长注释）：**只在 owner 尚未确立时写入**，标记「这份数据是从哪个会话来的」。
   *
   * 不每次覆写成当前身份的理由：那样读取校验会被自我满足（owner 恒等于当前
   * 会话），形同虚设——变异测试里「去掉读取口校验」能逃逸正是这个原因。
   * 跨会话误发的识别由发布点负责（比对数据引用是否换过），这里只做廉价兜底。
   *
   * sessionId 参数保留但不参与归属：它只表达「发布者认为自己在哪个会话」。
   */
  void sessionId
  /*
   * owner 记「写入这一刻的身份」，每次覆写 —— 与快照完全同一套语义与理由
   * （见 TurnProcessShadowView.setLatestChatSnapshot 的长注释）。
   * 跨会话误发的识别归发布点，这里不做拒绝，避免误杀新会话自己的第一份数据。
   */
  liveTodosOwner = getLatestChatSessionId()
  for (const fn of listeners) {
    try { fn() } catch {}
  }
}

if (typeof window !== 'undefined') {
  (window as any).__dshSetLiveTodos__ = setLiveDshTodos
}

export function clearLiveDshTodos(): void {
  liveTodos = []
  liveTodosOwner = null
  for (const fn of listeners) {
    try { fn() } catch {}
  }
}

export function subscribeLiveDshTodos(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function KrTodoBridge(props: any) {
  const todos = props?.useProjection ? props.useProjection('todos') : null
  const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : null
  // 供下面的「身份登记」effect 读最新投影：那个 effect 的依赖只能是 sessionId
  // （加 todos 会让每次投影更新都跑一遍 cleanup，把会话 id 置 null 造成闪烁），
  // 于是它必须从 ref 取，不能从闭包取。
  const todosRef = useRef(todos)
  todosRef.current = todos

  /*
   * 「这份数据是哪个会话给的」——跨会话误发的**源头指纹**。
   *
   * 用户报的「新对话还显示上个对话的任务概览」根因就在下面那两个 effect：
   * 它们的依赖都含 sessionId，切会话时必然重跑，而那一帧 `snap` / `todos` 仍是
   * **上一会话**的对象（useChat / useProjection 的结果要等下一次更新才换）。
   * 于是旧数据被贴上新的 sessionId 再发布一次，把 setLatestChatSessionId 刚做的
   * 清空**当场撤销**；新会话又没有第二个发布者来纠正，误显示是持久的。
   *
   * 判据：记住上一轮发布时的「sessionId + 数据引用」。若 sessionId 变了而引用
   * **没变**，说明这不是新会话的数据，而是旧对象被复用 —— 跳过本次发布。
   * 一旦上游给出新会话的对象（引用变化），就正常发布。
   *
   * **两条发布路径各记各的会话 id**（snapSessionId / todosSessionId）：两个
   * effect 的依赖都含 sessionId，谁先跑不确定；若共用一份 sessionId 记录，先跑的
   * 那个会把后跑的那个的判据污染成「已经是新会话」，后跑的那条于是放行（实测：
   * 快照被正确拦下，todos 却漏过去了）。
   *
   * 为什么不在 setLatestChatSnapshot / setLiveDshTodos 里拦：那里只能看到
   * 「owner 与当前会话不符」，而新会话**自己的**第一份数据同样是这个形状
   * （owner 还指着上一会话），无法区分——拦了会把合法发布一起拒掉，
   * 新会话永远空白（实测踩过）。「引用是否换过」只有发布点知道。
   */
  const lastPublishRef = useRef<{
    sessionId: string | null
    snap: unknown
    todos: unknown
    snapSessionId: string | null
    todosSessionId: string | null
  } | null>(null)

  // 会话身份变化 → 立即注销旧快照与缓存（右侧大盘不得复用上一会话内容）。
  // 卸载（离开会话回新建页）时同样注销；若新的座位已经登记了别的会话 id，
  // 说明本实例只是被替换，则不动它。
  useEffect(() => {
    setLatestChatSessionId(sessionId)
    /*
     * 会话切换后**立即用本座位手上这份 todos 回填一次**。
     *
     * 清空是同步发生的（setLatestChatSessionId → resetSessionCaches →
     * clearLiveDshTodos），而回填只挂在下面那个 `[todos]` effect 上：切回一个
     * 已经定型的历史会话时，官方 todos 投影的引用**没有变化**（内容本来就一样），
     * effect 不会重跑，liveTodos 就一直停在空数组上 —— 任务卡于是长期显示
     * 「本轮还没有任务」，直到模型下一次写清单才恢复。用户报的「切换会话后任务
     * 概览就没了」正是这一条。
     *
     * 但回填前要排除「旧对象被复用」：切会话那一帧 todosRef.current 还是上一
     * 会话的投影值，无条件回填等于把旧清单塞给新会话（这正是本次要修的 bug）。
     * 判据同上——引用没换过就跳过，让下面的 [todos] effect 在新投影到达时补上。
     */
    const prev = lastPublishRef.current
    // 回填走 todos 这一路的指纹：它发的是 todos，判据必须与 todos effect 一致。
    const todosReused = prev !== null && prev.todosSessionId !== sessionId && prev.todos === todosRef.current
    if (!todosReused) {
      setLiveDshTodos(Array.isArray(todosRef.current) ? todosRef.current : [], sessionId)
    }
    return () => {
      /*
       * 卸载 = 离开会话：走统一清空口而不是 setLatestChatSessionId(null)。
       *
       * 后者首行是 `if (id === latestChatSessionId) return` —— 身份本就是 null
       * 时（或重复离开）会提前返回、跳过 liveTodos 与 activityStore 的清理，
       * 上一会话的任务清单就留在全局里给下一个会话读了。
       *
       * 只在「仍是我登记的会话」时清：若新座位已经登记了别的 id，说明本实例
       * 只是被替换，不该把新会话的身份一起抹掉。
       */
      if (getLatestChatSessionId() === sessionId) leaveCurrentChatSession()
    }
  }, [sessionId])

  // 本座位按会话渲染，因此由它持续发布「当前会话」的快照：
  // 切回某个已有会话、或新会话发出首条消息时，第一个到达的快照就是正确的。
  // 节点视图的发布带有「只有 assistant-step 挂载时才会触发」的前提，
  // 单靠它会让清空后的右侧大盘迟迟等不到数据回填。
  const snap = props?.useChat ? props.useChat((s: any) => s) : undefined
  useEffect(() => {
    if (snap === undefined || snap === null) return
    const prev = lastPublishRef.current
    if (prev !== null && prev.snapSessionId !== sessionId && prev.snap === snap) {
      // 旧快照被贴上新会话 id：丢弃（见 lastPublishRef 的长注释）。
      // 只推进**快照这一路**的指纹，不动 todos 那一路 —— 两个 effect 各自独立
      // 判断，共用一份指纹会让先跑的那个把后跑的那个的判据污染掉（实测：快照
      // 被正确拦下，todos 却因为 sessionId 已被改写而放行）。
      lastPublishRef.current = { ...prev, snapSessionId: sessionId }
      return
    }
    lastPublishRef.current = {
      ...(prev ?? { sessionId: null, snap: null, todos: null, snapSessionId: null, todosSessionId: null }),
      sessionId,
      snap,
      snapSessionId: sessionId,
    }
    setLatestChatSnapshot(snap, sessionId)
  }, [snap, sessionId])

  // todos 投影更新时同步广播。走 setLiveDshTodos 而不是就地赋值：与上面那条
  // 回填路径共用同一个发布口，两条路径的行为不会分叉。
  useEffect(() => {
    const prev = lastPublishRef.current
    /*
     * 判据：**这份 todos 引用上一次是在哪个会话发布的**。与当前 sessionId 不同
     * 且引用没变 → 旧对象被复用，丢弃。
     *
     * 关键：`todosSessionId` 初值不能当「未知」跳过判断。切会话后它一定已被前一
     * 轮记成旧会话，所以判断是可靠的；只有「从未发布过」（prev === null）才放行。
     */
    if (prev !== null && prev.todosSessionId !== sessionId && prev.todos === todos) {
      // 旧投影被贴上新会话 id：丢弃，并推进这一路的指纹。
      lastPublishRef.current = { ...prev, todosSessionId: sessionId, todos }
      return
    }
    lastPublishRef.current = {
      ...(prev ?? { sessionId: null, snap: null, todos: null, snapSessionId: null, todosSessionId: null }),
      sessionId,
      todos,
      todosSessionId: sessionId,
    }
    setLiveDshTodos(Array.isArray(todos) ? todos : [], sessionId)
  }, [todos, sessionId])

  return null
}
