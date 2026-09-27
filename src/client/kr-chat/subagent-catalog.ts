/**
 * dsh-chat-plus — 子智能体清单（KR「正在做什么」卡的子智能体区块数据源）。
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
  /** 目录还没读到 / 读失败 / 根本没有子智能体。 */
  readonly state: 'loading' | 'ready' | 'error' | 'empty'
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

/** 纯函数：从任意形状的 list 快照里找出某个父会话的子智能体清单。 */
export function readSubagentCatalog(
  snapshot: unknown,
  parentSessionId: string | null,
): SubagentCatalogView {
  const empty: SubagentCatalogView = { rows: [], runningCount: 0, doneCount: 0, state: 'empty' }
  if (snapshot === null || snapshot === undefined || parentSessionId === null || parentSessionId === '') return empty

  // subagentsByParent 在 SessionListSnapshot 上；byId 只用来兜底确认父会话存在。
  const byParent = pick(snapshot, 'subagentsByParent')
  const catalog = typeof byParent === 'object' && byParent !== null
    ? (byParent as Record<string, unknown>)[parentSessionId]
    : undefined
  if (catalog === undefined) return empty

  const state = pick(catalog, 'state')
  if (state === 'loading') return { ...empty, state: 'loading' }
  if (state === 'error') return { ...empty, state: 'error' }

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

/**
 * 订阅某个父会话下的子智能体清单。
 *
 * 刻意用「轮询 + 订阅」双保险：官方 sessions 服务暴露了订阅接口，但它的形状
 * 同样随版本变过；订阅拿到就实时刷新，拿不到就退回 1.5s 轮询 —— 子智能体的
 * running 状态本来就以秒级变化，轮询完全够用，而漏订阅只会让刷新慢一点，
 * 不会让功能消失。
 */
export function useSubagentCatalog(parentSessionId: string | null, pollMs = 1500): SubagentCatalogView {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (parentSessionId === null || parentSessionId === '') return undefined
    let alive = true
    const bump = (): void => { if (alive) setTick((value) => value + 1) }
    let sessions: unknown = null
    try {
      const ctx = (window as unknown as { __dshClientCtx__?: { get?: (name: string) => unknown } }).__dshClientCtx__
      sessions = ctx?.get?.('sessions') ?? null
    } catch {
      sessions = null
    }
    const unsubscribe = subscribeTo(sessions, bump)
    const timer = window.setInterval(bump, pollMs)
    return () => {
      alive = false
      window.clearInterval(timer)
      try { unsubscribe() } catch { /* 忽略 */ }
    }
  }, [parentSessionId, pollMs])

  return useMemo(() => {
    if (typeof window === 'undefined') {
      return { rows: [], runningCount: 0, doneCount: 0, state: 'empty' } as SubagentCatalogView
    }
    let sessions: unknown = null
    try {
      const ctx = (window as unknown as { __dshClientCtx__?: { get?: (name: string) => unknown } }).__dshClientCtx__
      sessions = ctx?.get?.('sessions') ?? null
    } catch {
      sessions = null
    }
    return readSubagentCatalog(snapshotOf(sessions), parentSessionId)
    // tick 是唯一的刷新触发：快照本身是外部可变对象，不进依赖。
  }, [parentSessionId, tick])
}
