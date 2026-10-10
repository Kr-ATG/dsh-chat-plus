/**
 * dsh-memory 回合收口模块：回合结束时把清单里残留的 `in_progress` 项改写为 `pending`。
 *
 * 要解决的问题是展示层的：`todos` 投影是 **last-write-wins 的整表快照**，模型
 * 漏写最后一次 `todo/write` 时，那条 `in_progress` 会一直挂在右栏「任务概览」卡上
 * ——回合早就结束了，卡片却还显示「进行中」，用户看到的是「卡住了」。这里在回合
 * 收口时把残留项降级为 `pending`，让「未完成」变成可见且诚实的待办，而不是一个
 * 永远转圈的假状态。
 *
 * ── 为什么落点是 agent/turn-stopping，而不是 session/event 的 step/end ──
 *
 * 两条都是「一个 step 跑完了」的时机，但只有前者能用：
 *
 * 1. **reenter 硬约束**。`session.append()` 在发布事件期间会置 `appending = true`
 *    并**同步**调用 session/event 监听器；此时监听器里再 append 会撞上
 *    `session append cannot reenter while another append is being published`
 *    （dsh-session/lib/index.js 的 append 守卫）。而且这个错误在 contained
 *    observer 里被**吞成一条 warn**——不报错、不中断，只是收口永远不发生，
 *    排查时看不到任何异常信号。
 * 2. **turn 必须仍 open**。`todo/write` 的持久化 invariant 明确要求
 *    「appended inside any open turn」（dsh-tool-todo/lib/types/invariant.js）。
 *    `agent/turn-stopping` 在 `step/end` 之后、`turn/end` 之前触发，此刻 turn
 *    仍 open；而 `turn/end` 之后任何写入都会被 invariant 拒掉。
 *
 * 时机上还有一条：turn-stopping 是 serial + awaited 的，我们写完的
 * `todo/write` 会先于 `turn/end` 落进日志，投影与前端读到的是同一个最终态。
 *
 * ── 失败绝不冒泡 ──
 *
 * turn-stopping 的监听器抛错会让**用户的整个回合**以 `{ kind: 'error' }` 收尾。
 * 收口是锦上添花的清理动作，任何失败（开关读不到、投影服务缺席、append 被
 * invariant 拒）都只该记一条日志然后放手。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryConfig } from '../types.js'
import type { MemoryStore } from './store.js'

/** 收口用的最小日志面（ctx.logger 的子集；记日志本身失败也不该影响收口）。 */
export interface TodoClosureLogger {
  debug?: (message: string) => void
  warn?: (message: string) => void
}

/** `todos` 投影里一条清单项（与 dsh-tool-todo 的 TodoItem 同形，只取关心的两个字段）。 */
interface TodoItemLike {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** 收口只用到 session 的一件能力：追加一条 `todo/write`。 */
export interface TodoClosureSession {
  readonly id: string
  append: (type: string, data: unknown) => unknown
}

/** `agent/turn-stopping` 载荷里收口需要的最小 agent 面。 */
export interface TurnStoppingAgent {
  readonly id: string
  readonly session: TodoClosureSession
}

/** `sessionProjections` 服务里收口需要的唯一方法（stateOf 的窄化视图）。 */
interface ProjectionsLike {
  stateOf: (session: unknown, key: string) => unknown
}

/** 判断一个投影项是否是可用的清单项（形状不符时按「没有清单」处理，不猜）。 */
function isTodoItemLike(value: unknown): value is TodoItemLike {
  if (typeof value !== 'object' || value === null) return false
  const item = value as { content?: unknown; status?: unknown }
  return typeof item.content === 'string'
    && (item.status === 'pending' || item.status === 'in_progress' || item.status === 'completed')
}

/**
 * 创建回合收口器。
 *
 * 返回 `{ listener, dispose }`：listener 交给装配方注册到 `agent/turn-stopping`
 * （由 index.ts 统一挂，便于和其它模块一样独立 try/catch 隔离装配失败）；
 * dispose 只置一个失效标志，让卸载后仍在飞的 dispatch 不再写日志。
 */
export function createTodoClosure(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
  logger?: TodoClosureLogger,
): { listener: (payload: { agent: TurnStoppingAgent }) => Promise<void>; dispose: () => void } {
  let disposed = false

  async function listener(payload: { agent: TurnStoppingAgent }): Promise<void> {
    // 整段包住：本监听器是 serial + awaited 的，抛错会让用户的整个回合以
    // { kind: 'error' } 收尾。收口失败只是「清单没收干净」，绝不值得毁掉回合。
    try {
      if (disposed) return
      const session = payload?.agent?.session
      if (session === undefined || session === null) return

      // 开关闸门：三态（state 显式值 ?? config 默认），与其它内置通道同一口径。
      const enabled = await store.isTodoClosureEnabled(config.todoClosureDefaultEnabled !== false)
      if (!enabled) return

      // 投影服务缺席（插件按需装配 / 本 DSH 版本无该服务）时静默跳过：
      // 没有投影就没有可收口的清单，不是错误。
      const projections = ctx.get('sessionProjections') as ProjectionsLike | undefined
      if (projections === undefined || projections === null || typeof projections.stateOf !== 'function') return

      const todos = projections.stateOf(session, 'todos')
      // null = 首次写入前的空投影；空数组 = 清单被清空。两者都无需收口。
      if (!Array.isArray(todos) || todos.length === 0) return

      const items = todos.filter(isTodoItemLike)
      if (items.length === 0) return
      const stalled = items.filter(item => item.status === 'in_progress')
      // 没有 in_progress 就不 append：无意义的 todo/write 会往会话日志里塞
      // 整表快照，只为了写一个和现状完全一样的值。
      if (stalled.length === 0) return

      /*
       * 整表替换的完整性：`todo/write` 是 last-write-wins 的**整份清单**，
       * 少带一条就等于把它删掉。上面那个 filter 只是「用来判断有没有 in_progress」
       * 的视图，**绝不能拿它当写入载荷**——形状不符的项（未来 DSH 给 TodoItem
       * 加字段、或投影里混进异常行）会被它静默丢掉，表现为用户的任务凭空消失。
       *
       * 所以写入时回到原始 `todos` 全量映射：只对 in_progress 改 status，其余
       * 连引用一起原样搬运。只动 status、不动 content：content 的非空/已 trim/
       * 不重复由 invariant 把关，原样搬运天然满足。
       */
      let changed = 0
      const next = todos.map((item) => {
        if (isTodoItemLike(item) && item.status === 'in_progress') {
          changed += 1
          return { ...item, status: 'pending' as const }
        }
        return item
      })
      session.append('todo/write', { todos: next })
      logger?.debug?.(`[dsh-memory] todo closure: ${changed} in_progress → pending (session=${session.id})`)
    } catch (error) {
      // 只记日志。这里再抛一次就会把用户的回合打成 error。
      logger?.warn?.(`[dsh-memory] todo closure skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    listener,
    dispose: () => { disposed = true },
  }
}
