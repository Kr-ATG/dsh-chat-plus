/**
 * dsh-chat-plus — 子智能体清单（KR「操作面板」卡的子智能体区块数据源）。
 *
 * ## 为什么需要单独一层
 *
 * 子智能体（`subagent` / `workflow` 派出去的）在 DSH 里是**独立会话**，不是
 * 父调用 tree 上的 `subCalls`（那条通道是 Code Dispatch「工具里再调工具」）。
 * 所以父会话的事件流里只有一个「调用了 workflow」，底下有几个子智能体、各自
 * 叫什么、谁还在跑，父调用一概不知道 —— 这正是用户「得跑去别的地方看」的由来。
 *
 * ## 现在能拿到什么、拿不到什么
 *
 * 能拿到（client 侧零 RPC）：`ctx.sessions.list` 的快照里带
 * `subagentsByParent[parentSessionId]`，每个子智能体给出 **id / label /
 * running| inactive / 是否还有后代 / one-shot|continuable**。这是官方子智能体
 * 目录 UI 用的同一份数据，权威且实时。
 *
 * 拿不到：子智能体**当前在调用哪个工具 / 说了什么**。那需要读子会话的消息
 * 投影，而 client 侧的 projection store 只保留 title 之类的少量投影值，没有
 * 完整消息节点；官方为此提供的唯一入口就是「点开子会话」（切换整个会话）。
 * 本模块不去伪造这部分内容 —— 空着就是空着，用户点一下就能跳过去看。
 */

import { useEffect, useMemo, useState } from 'react'

export interface SubagentRow {
  readonly id: string
  /** 子智能体的名字（模型给的 label）。没有 label 时回落到 id 前 8 位。 */
  readonly label: string
  /** true = 还在跑。 */
  readonly running: boolean
  /** 它自己下面还派了子智能体。 */
  readonly hasChildren: boolean
  readonly mode: 'one-shot' | 'continuable'
}

export interface SubagentCatalogView {
  readonly rows: readonly SubagentRow[]
  readonly runningCount: number
  readonly doneCount: number
  /**
   * `unloaded` = 这个父会话的子智能体目录**还没被拉取过**（键不存在，或首次读取
   * 尚未成功）；`empty` = 拉取过、确实一个都没有。两者对用户是天壤之别：把
   * unloaded 说成 empty，就等于对着明明派了子智能体的步骤撒谎。
   */
  readonly state: 'loading' | 'ready' | 'error' | 'empty' | 'unloaded'
}

/** 防御式取任意字段：DSH 的投影形状随版本变过，取不到就回 undefined。 */
function pick(record: unknown, ...keys: string[]): unknown {
  if (typeof record !== 'object' || record === null) return undefined
  const obj = record as Record<string, unknown>
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

/** 从一份「形状未知」的 catalog 快照里抠出子智能体行。 */
function rowsOf(catalog: unknown): SubagentRow[] {
  const entries = pick(catalog, 'entries', 'items', 'children')
  if (!Array.isArray(entries)) return []
  const rows: SubagentRow[] = []
  for (const raw of entries) {
    if (pick(raw, 'kind') === 'diagnostic') continue
    const id = pick(raw, 'id', 'childSessionId', 'sessionId')
    if (typeof id !== 'string' || id === '') continue
    const label = pick(raw, 'label', 'displayTitle', 'title')
    const running = pick(raw, 'activity', 'state', 'status')
    rows.push({
      id,
      label: typeof label === 'string' && label.trim() !== ''
        ? clipLabel(label)
        : id.slice(0, 8),
      // activity 是官方口径：running = 逻辑记录在驻；老快照里可能只有 state。
      running: running === 'running' || running === 'active' || running === true,
      hasChildren: pick(raw, 'hasChildren') === true,
      mode: pick(raw, 'mode') === 'continuable' ? 'continuable' : 'one-shot',
    })
  }
  return rows
}

function clipLabel(label: string): string {
  const clean = label.replace(/\s+/g, ' ').trim()
  return clean.length > 34 ? `${clean.slice(0, 33)}…` : clean
}

/**
 * 纯函数：从任意形状的 list 快照里找出某个父会话的子智能体清单。
 *
 * **「没读过」和「读过是空」必须分开**。`subagentsByParent` 是
 * *durable catalogs keyed by their selected parent address* —— 只有父会话的子
 * 智能体目录被打开过（manager 里的 openCatalogs）才会去拉，所以刚进会话时这个
 * 键**根本不存在**。把「键不存在」当成「没有子智能体」就会对着一个明明派出了子
 * 智能体的步骤说「这次没有派生独立的子智能体」——自相矛盾且是假的。
 *
 * 两者靠 `parentAvailable` 区分：它在「首次成功读取」之前是 undefined。
 */
export function readSubagentCatalog(
  snapshot: unknown,
  parentSessionId: string | null,
): SubagentCatalogView {
  const empty: SubagentCatalogView = { rows: [], runningCount: 0, doneCount: 0, state: 'empty' }
  if (snapshot === null || snapshot === undefined || parentSessionId === null || parentSessionId === '') {
    return { ...empty, state: 'unloaded' }
  }

  const byParent = pick(snapshot, 'subagentsByParent')
  const catalog = typeof byParent === 'object' && byParent !== null
    ? (byParent as Record<string, unknown>)[parentSessionId]
    : undefined
  // 键不存在 = 这个父会话的目录从来没读过
  if (catalog === undefined) return { ...empty, state: 'unloaded' }

  const state = pick(catalog, 'state')
  if (state === 'loading') return { ...empty, state: 'loading' }
  if (state === 'error') return { ...empty, state: 'error' }
  // 读到了但还没成功过一次（parentAvailable 在首次成功读取前是 undefined）
  if (pick(catalog, 'parentAvailable') === undefined) return { ...empty, state: 'unloaded' }

  const rows = rowsOf(catalog)
  if (rows.length === 0) return empty
  const runningCount = rows.filter((row) => row.running).length
  return {
    rows,
    runningCount,
    doneCount: rows.length - runningCount,
    state: 'ready',
  }
}

/** 定位 sessions 列表快照。`ctx.get('sessions')` 的形状随版本变过，逐个试。 */
function snapshotOf(sessions: unknown): unknown {
  if (typeof sessions !== 'object' || sessions === null) return null
  const list = pick(sessions, 'list')
  if (typeof list === 'object' && list !== null) {
    const getter = (list as { getSnapshot?: () => unknown }).getSnapshot
    if (typeof getter === 'function') {
      try { return getter.call(list) } catch { /* 桩 / 旧版：继续找下一处 */ }
    }
  }
  return pick(sessions, 'state', 'snapshot', 'list') ?? null
}

function subscribeTo(sessions: unknown, cb: () => void): () => void {
  if (typeof sessions !== 'object' || sessions === null) return () => {}
  const list = pick(sessions, 'list')
  const sub = pick(list, 'subscribe')
  if (typeof sub === 'function') {
    try { return (sub as (fn: () => void) => () => void).call(list, cb) } catch { /* 忽略 */ }
  }
  return () => {}
}

/** 取 client ctx 上的 sessions 服务。 */
function sessionsService(): unknown {
  if (typeof window === 'undefined') return null
  try {
    const ctx = (window as unknown as { __dshClientCtx__?: { get?: (name: string) => unknown } }).__dshClientCtx__
    return ctx?.get?.('sessions') ?? null
  } catch {
    return null
  }
}

/**
 * 主动拉一次子智能体目录。
 *
 * **这不是可选优化，是功能能否成立的前提**：`subagentsByParent` 里的条目只在父会话
 * 的子智能体目录被打开过之后才存在（SessionManager 的 openCatalogs；handleConnected
 * 也只对 openCatalogs 里的父会话补拉）。用户不点那个目录，我们就永远读不到任何
 * 子智能体——而 SessionsService 恰好把 `refreshSubagents(parentSessionId)` 公开出来了
 * （api-session-controller/src/client/sessions/service.ts:305），不必去碰私有
 * `scheduleCatalogRefresh`。
 *
 * 拿不到这个方法（旧版 host）就安静跳过：那台机器上此功能本来就不成立，不该因此
 * 报错或刷屏。
 */
function requestRefresh(sessions: unknown, parentSessionId: string): void {
  const fn = pick(sessions, 'refreshSubagents')
  if (typeof fn !== 'function') return
  try {
    void (fn as (id: string) => Promise<void>).call(sessions, parentSessionId).catch(() => undefined)
  } catch { /* 忽略：拉不到就维持当前显示 */ }
}

/**
 * 订阅某个父会话下的子智能体清单。
 *
 * 刻意用「轮询 + 订阅」双保险：官方 sessions 服务暴露了订阅接口，但它的形状
 * 同样随版本变过；订阅拿到就实时刷新，拿不到就退回 1.5s 轮询 —— 子智能体的
 * running 状态本来就以秒级变化，轮询完全够用，而漏订阅只会让刷新慢一点，
 * 不会让功能消失。
 *
 * 目录本身靠 requestRefresh 主动拉：挂载立刻拉一次，之后每 REFRESH_EVERY_TICKS
 * 轮再拉一次（子智能体是陆续派生的，只在挂载时拉一次会漏掉后面新增的那些）。
 */
export function useSubagentCatalog(parentSessionId: string | null, pollMs = 1500): SubagentCatalogView {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (parentSessionId === null || parentSessionId === '') return undefined
    let alive = true
    const bump = (): void => { if (alive) setTick((value) => value + 1) }
    const sessions = sessionsService()
    const unsubscribe = subscribeTo(sessions, bump)
    // 挂载先拉一次；之后每 4 轮（默认 6 秒）补拉，兼顾"陆续派生的子智能体"
    // 与"别把 RPC 打成轮询"。拉取本身是幂等的读操作。
    let sinceRefresh = 0
    requestRefresh(sessions, parentSessionId)
    const timer = window.setInterval(() => {
      bump()
      sinceRefresh += 1
      if (sinceRefresh >= 4) {
        sinceRefresh = 0
        requestRefresh(sessions, parentSessionId)
      }
    }, pollMs)
    return () => {
      alive = false
      window.clearInterval(timer)
      try { unsubscribe() } catch { /* 忽略 */ }
    }
  }, [parentSessionId, pollMs])

  return useMemo(() => {
    if (typeof window === 'undefined') {
      return { rows: [], runningCount: 0, doneCount: 0, state: 'unloaded' } as SubagentCatalogView
    }
    // tick 是唯一的刷新触发：快照本身是外部可变对象，不进依赖。
    return readSubagentCatalog(snapshotOf(sessionsService()), parentSessionId)
  }, [parentSessionId, tick])
}
