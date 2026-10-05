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
} from '../tool-summary/TurnProcessShadowView.tsx'

export interface DshTodoItem {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

let liveTodos: readonly DshTodoItem[] = []
const listeners = new Set<() => void>()

export function getLiveDshTodos(): readonly DshTodoItem[] {
  return liveTodos
}

export function setLiveDshTodos(todos: readonly DshTodoItem[]): void {
  liveTodos = Array.isArray(todos) ? todos : []
  for (const fn of listeners) {
    try { fn() } catch {}
  }
}

if (typeof window !== 'undefined') {
  (window as any).__dshSetLiveTodos__ = setLiveDshTodos
}

export function clearLiveDshTodos(): void {
  liveTodos = []
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
     * 这里在登记身份的同时把当前 todos 推回去：切过去那一帧就有数据，不依赖
     * 引用变化这个不可靠的信号。
     */
    setLiveDshTodos(Array.isArray(todosRef.current) ? todosRef.current : [])
    return () => {
      if (getLatestChatSessionId() === sessionId) setLatestChatSessionId(null)
    }
  }, [sessionId])

  // 本座位按会话渲染，因此由它持续发布「当前会话」的快照：
  // 切回某个已有会话、或新会话发出首条消息时，第一个到达的快照就是正确的。
  // 节点视图的发布带有「只有 assistant-step 挂载时才会触发」的前提，
  // 单靠它会让清空后的右侧大盘迟迟等不到数据回填。
  const snap = props?.useChat ? props.useChat((s: any) => s) : undefined
  useEffect(() => {
    if (snap === undefined || snap === null) return
    setLatestChatSnapshot(snap, sessionId)
  }, [snap, sessionId])

  // todos 投影更新时同步广播。走 setLiveDshTodos 而不是就地赋值：与上面那条
  // 回填路径共用同一个发布口，两条路径的行为不会分叉。
  useEffect(() => {
    setLiveDshTodos(Array.isArray(todos) ? todos : [])
  }, [todos])

  return null
}
