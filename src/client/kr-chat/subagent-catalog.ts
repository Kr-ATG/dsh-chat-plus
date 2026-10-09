/**
 * dsh-chat-plus — 子智能体清单（数据层 + 跳转动作）。
 *
 * ## 为什么需要单独一层
 *
 * 子智能体（`subagent` / `workflow` 派出去的）在 DSH 里是**独立会话**，不是
 * 父调用 tree 上的 `subCalls`（那条通道是 Code Dispatch「工具里再调工具」）。
 * 所以父会话的事件流里只有一个「调用了 workflow」，底下有几个子智能体、各自
 * 叫什么、谁还在跑，父调用一概不知道 —— 这正是用户「得跑去别的地方看」的由来。
 *
 * ## 数据从哪来（2026-10-08 重写，修正了一处读错形状的硬伤）
 *
 * 权威来源是**官方子智能体目录用的同一份投影**：
 * `sessions.list` 快照的 `projectionsBySession[父会话 id].values.subagentCatalog`
 * —— 一个 `{ id, createdAt, mode, label }[]`，host 侧 `subagent/catalog` 事件折出来的。
 *
 * 上一版读的是 `snapshot.items` 与 `snapshot.subagentsByParent`，**这两个键在
 * 实际快照里都不存在**：`items` 是 SessionManager 内部 `buildListSnapshot()` 的
 * 入参形状，`ISessions.list` 对外发布的是 `{ ids, byId, phase, projectionsBySession }`；
 * `subagentsByParent` / `refreshSubagents` 这套 API 在当前 DSH 版本里根本没有。
 * 于是 `rowsFromItems` 恒返回空、`subagentsByParent` 恒 undefined，目录永远停在
 * 「未加载」—— 用户截图里那句自相矛盾的话就是这么来的。
 *
 * 现在三路并用，互为兜底：
 *  1. **投影路（主）**：`projectionsBySession[parent].values.subagentCatalog`。
 *  2. **列表路**：`byId` 里 `parentId === parent` 且 `origin === 'subagent'` 的行。
 *     官方 `projectList()` 会把目录里的 child 补进 byId，这条路在投影还没落地时
 *     就能给出「有几个、谁还在跑」。
 *  3. **running 只有一个来源**：`byId[id].running`。catalog 条目本身不带运行态，
 *     官方渲染层也是 `statuses.get(id)?.running ?? summaries[id]?.running` 合成的。
 *
 * 主动拉取用 `ctx.sessions.refreshProjections(parentSessionId)`（`ISessions` 公开面），
 * 不是旧版那个并不存在的 `refreshSubagents`。
 *
 * ## 拿不到什么
 *
 * 子智能体**当前在调用哪个工具 / 说了什么**。那需要读子会话的消息投影，而
 * client 侧的 projection store 只保留少量投影值，没有完整消息节点；官方为此
 * 提供的唯一入口就是「点开子会话」。本模块不去伪造这部分内容 —— 空着就是空着，
 * 用户点一下就能跳过去看（见 {@link openSubagentSession}）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { getService } from '../client-ctx.ts'

export type SubagentMode = 'one-shot' | 'continuable' | 'unknown'

export interface SubagentRow {
  readonly id: string
  /** 直接父会话（跳转时构造 durable address 用）。 */
  readonly parentSessionId: string
  /** 子智能体的名字（模型给的 label）。没有 label 时回落到 id 前 8 位。 */
  readonly label: string
  /** true = 还在跑。 */
  readonly running: boolean
  /** 它自己下面还派了子智能体。 */
  readonly hasChildren: boolean
  readonly mode: SubagentMode
  /** 已跑时长（ms）：进行中的会随轮询走秒。拿不到就是 undefined。 */
  readonly elapsedMs?: number
  /** 累计 token（四个桶求和）。拿不到就是 undefined。 */
  readonly tokens?: number
  /**
   * 官方 catalog 条目的创建时刻（ms）。用于按**轮次**过滤：
   * 卡只列「当前查看的这一轮对话」派出去的子智能体（用户 2026-10-09 点名：
   * 会话口径下对话一多行数爆炸）。拿不到时该行不参与时间过滤（宁可多列不漏列）。
   */
  readonly createdAt?: number
}

export interface SubagentCatalogView {
  readonly rows: readonly SubagentRow[]
  readonly runningCount: number
  readonly doneCount: number
  /**
   * `unloaded` = 这个父会话的子智能体目录**还没被拉取过**（投影 store 里没有
   * 这个键，或首次读取尚未成功）；`empty` = 拉取过、确实一个都没有。两者对用户
   * 是天壤之别：把 unloaded 说成 empty，就等于对着明明派了子智能体的步骤撒谎。
   *
   * 渲染层对 loading / unloaded 给同一句「正在读取」，但**状态本身必须分开**：
   * 只有 `empty` 才允许下「这次没有派生独立的子智能体」这个结论。
   */
  readonly state: 'loading' | 'ready' | 'error' | 'empty' | 'unloaded'
}

/** 空视图（也用作 SSR / 无 window 时的返回值，出口保证非 nullish）。 */
const EMPTY: SubagentCatalogView = { rows: [], runningCount: 0, doneCount: 0, state: 'unloaded' }

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

/** 按 id 取一行列表条目。 */
function rowOf(byId: unknown, id: string): unknown {
  if (typeof byId !== 'object' || byId === null) return undefined
  return (byId as Record<string, unknown>)[id]
}

function clipLabel(label: string): string {
  const clean = label.replace(/\s+/g, ' ').trim()
  return clean.length > 34 ? `${clean.slice(0, 33)}…` : clean
}

function labelOf(raw: unknown, id: string): string {
  const label = pick(raw, 'label', 'displayTitle', 'title')
  return typeof label === 'string' && label.trim() !== '' ? clipLabel(label) : id.slice(0, 8)
}

function modeOf(raw: unknown): SubagentMode {
  const mode = pick(raw, 'mode')
  return mode === 'continuable' ? 'continuable' : mode === 'one-shot' ? 'one-shot' : 'unknown'
}

/** 某个会话下面还有没有别的会话（用于「还有下级」标签）。 */
function hasChildrenOf(id: string, byId: unknown, projections: unknown): boolean {
  if (typeof byId === 'object' && byId !== null) {
    for (const entry of Object.values(byId as Record<string, unknown>)) {
      if (pick(entry, 'parentId') === id) return true
    }
  }
  const catalog = pick(pick(projections, id), 'values', 'subagentCatalog')
  return Array.isArray(catalog) && catalog.length > 0
}

/**
 * 官方口径的运行时长：settledMs + 当前这一轮已经跑了多久。
 * 投影缺失时返回 undefined（宁可空着，也不编一个数）。
 */
function elapsedOf(summary: unknown, running: boolean, now: number): number | undefined {
  const timing = pick(pick(summary, 'projectionValues'), 'subagentTiming')
  if (timing === undefined) return undefined
  const settled = pick(timing, 'settledMs')
  const base = typeof settled === 'number' ? settled : 0
  const active = pick(timing, 'active')
  if (active === undefined) return base
  const since = pick(active, 'since')
  if (typeof since !== 'number') return base
  const through = pick(active, 'through')
  const end = running ? now : (typeof through === 'number' ? through : since)
  return base + Math.max(0, end - since)
}

/** 官方 tokenTotal：四个互不重叠的桶求和。 */
function tokensOf(summary: unknown): number | undefined {
  const usage = pick(pick(summary, 'projectionValues'), 'tokenUsage')
  if (usage === undefined) return undefined
  const buckets = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
    .map((key) => pick(usage, key))
  if (buckets.every((value) => typeof value !== 'number')) return undefined
  return buckets.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
}

/** 把一条 id/label/mode 补齐成完整行（running / 后代 / 时长 / token）。 */
function enrich(
  base: { id: string; label: string; mode: SubagentMode; createdAt?: number },
  parentSessionId: string,
  byId: unknown,
  projections: unknown,
  now: number,
  runningHint = false,
): SubagentRow {
  const summary = rowOf(byId, base.id)
  const running = summary !== undefined ? pick(summary, 'running') === true : runningHint
  return {
    id: base.id,
    parentSessionId,
    label: base.label,
    running,
    hasChildren: hasChildrenOf(base.id, byId, projections),
    mode: base.mode,
    ...(base.createdAt === undefined ? {} : { createdAt: base.createdAt }),
    ...(elapsedOf(summary, running, now) === undefined ? {} : { elapsedMs: elapsedOf(summary, running, now) }),
    ...(tokensOf(summary) === undefined ? {} : { tokens: tokensOf(summary) }),
  }
}

/** catalog 条目的创建时刻：host 侧折 `subagent/catalog` 事件时带的时间戳。 */
function createdAtOf(raw: unknown): number | undefined {
  const value = pick(raw, 'createdAt', 'createdMs', 'startedAt')
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 从 `values.subagentCatalog` 条目造行。 */
function rowsFromEntries(entries: readonly unknown[], parentSessionId: string, byId: unknown, projections: unknown, now: number): SubagentRow[] {
  const rows: SubagentRow[] = []
  for (const raw of entries) {
    if (pick(raw, 'kind') === 'diagnostic') continue
    const id = pick(raw, 'id', 'childSessionId', 'sessionId')
    if (typeof id !== 'string' || id === '') continue
    // catalog 条目不带运行态；`activity` 只在官方渲染层合成过，这里作旧快照兜底。
    const hint = pick(raw, 'activity', 'status') === 'running'
    rows.push(enrich({ id, label: labelOf(raw, id), mode: modeOf(raw), createdAt: createdAtOf(raw) }, parentSessionId, byId, projections, now, hint))
  }
  return rows
}

/**
 * 从列表快照（`byId`）造行：`parentId` 指向本父会话、且 `origin === 'subagent'`。
 *
 * 两个条件都要：`parentId` 单独不足以判定 —— fork 出来的子会话也带父 id，
 * 但它不是子智能体。官方侧同样是按 `origin === 'subagent'` 过滤的。
 */
function rowsFromList(byId: unknown, parentSessionId: string, projections: unknown, now: number): SubagentRow[] {
  if (typeof byId !== 'object' || byId === null) return []
  const rows: SubagentRow[] = []
  for (const [id, entry] of Object.entries(byId as Record<string, unknown>)) {
    if (pick(entry, 'parentId') !== parentSessionId) continue
    if (pick(entry, 'origin') !== 'subagent') continue
    rows.push(enrich({ id, label: labelOf(entry, id), mode: modeOf(entry), createdAt: createdAtOf(entry) }, parentSessionId, byId, projections, now))
  }
  return rows
}

/** 投影路的行优先（它带 mode / createdAt），列表路的行按 id 补齐缺失的那些。 */
function mergeRows(primary: readonly SubagentRow[], extra: readonly SubagentRow[]): SubagentRow[] {
  if (extra.length === 0) return [...primary]
  const seen = new Set(primary.map((row) => row.id))
  const merged = [...primary]
  for (const row of extra) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  return merged
}

function finalize(rows: readonly SubagentRow[]): SubagentCatalogView {
  if (rows.length === 0) return { rows: [], runningCount: 0, doneCount: 0, state: 'empty' }
  const runningCount = rows.filter((row) => row.running).length
  return { rows, runningCount, doneCount: rows.length - runningCount, state: 'ready' }
}

/**
 * 按**轮次**过滤目录：只留创建时刻落在 [turnStart, turnEnd] 窗口内的行。
 *
 * 用户 2026-10-09 点名：会话口径下对话一多，这张卡会堆出十几行历史子智能体，
 * 而读者关心的是「**当前查看的这一轮对话**派出去的那几个」。catalog 条目自带
 * `createdAt`（host 折 `subagent/catalog` 事件的时间戳），轮次窗口来自官方快照
 * 的 turn start/end，两者都是现成事实，不需要猜。
 *
 * 边界口径：
 *  · `turnStart` 拿不到（新会话快照还没落地）→ 不过滤，全量显示（宁可多列不漏列）；
 *  · `turnEnd` 拿不到（本轮还在跑）→ 上界放开到 +∞，进行中的轮次里陆续派生的
 *    子智能体能实时进卡；
 *  · 行自身没有 `createdAt`（旧快照 / 列表路兜底行）→ 保留，同上「宁可多列」。
 *
 * 过滤后一行不剩时 state 落 `empty`：渲染层据此整卡不渲染（本轮没派 = 没东西可说），
 * 而不是留一张空卡白占右栏高度。
 */
export function filterCatalogByTurn(
  view: SubagentCatalogView,
  turnStart: number | undefined,
  turnEnd: number | undefined,
): SubagentCatalogView {
  if (view.rows.length === 0) return view
  if (typeof turnStart !== 'number' || !Number.isFinite(turnStart)) return view
  const end = typeof turnEnd === 'number' && Number.isFinite(turnEnd) ? turnEnd : Number.POSITIVE_INFINITY
  const rows = view.rows.filter((row) => row.createdAt === undefined || (row.createdAt >= turnStart && row.createdAt <= end))
  if (rows.length === view.rows.length) return view
  return finalize(rows)
}

/**
 * 纯函数：找出某个父会话下的子智能体清单。
 *
 * @param snapshot - `ctx.sessions.list` 的快照（`{ ids, byId, phase, projectionsBySession }`）。
 * @param parentSessionId - 父会话 id；null/空串一律回 unloaded。
 * @param now - 当前时刻（ms），用于给进行中的行算时长。
 */
export function readSubagentCatalog(
  snapshot: unknown,
  parentSessionId: string | null,
  now: number = Date.now(),
): SubagentCatalogView {
  if (snapshot === null || snapshot === undefined || parentSessionId === null || parentSessionId === '') {
    return EMPTY
  }

  const byId = pick(snapshot, 'byId')
  const projections = pick(snapshot, 'projectionsBySession')
  const cell = typeof projections === 'object' && projections !== null
    ? (projections as Record<string, unknown>)[parentSessionId]
    : undefined
  const cellState = pick(cell, 'state')
  const entries = pick(pick(cell, 'values'), 'subagentCatalog')

  const fromList = rowsFromList(byId, parentSessionId, projections, now)

  // 投影读取失败：列表路还有东西就先给出来（那是列表投影，与 catalog 不是同一次读）。
  if (cellState === 'error') {
    return fromList.length > 0 ? finalize(fromList) : { ...EMPTY, state: 'error' }
  }

  if (Array.isArray(entries)) {
    // 读到了：空数组 = 官方口径的「确实没有」，非空 = ready。
    return finalize(mergeRows(rowsFromEntries(entries, parentSessionId, byId, projections, now), fromList))
  }

  // entries 还不是数组：`idle + undefined` 是「还没读」，`loading` 是「正在读」，
  // 两者在官方渲染层给的是同一句「正在读取」；`ready + undefined` 则是**读完了
  // 而且真的没有**（投影基线里就没有这个键），那才是 empty。
  if (fromList.length > 0) return finalize(fromList)
  if (cellState === 'ready') return EMPTY
  if (cellState === 'loading' || cellState === 'idle') return { ...EMPTY, state: 'loading' }
  return EMPTY
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
 * 主动拉一次该父会话的投影基线。
 *
 * **这不是可选优化，是功能能否成立的前提**：`projectionsBySession` 里那个键
 * 只在有人为这个会话读过投影之后才存在（`SessionManager.refreshProjections`），
 * 而官方只在会话被打开、或父会话已被读过时才补拉。用户不点开子智能体目录，
 * 我们就读不到任何子智能体 —— 而 `ISessions` 恰好把 `refreshProjections(id)`
 * 公开出来了，不必去碰任何私有方法。
 *
 * 拿不到这个方法（旧版 host）就安静跳过：那台机器上此功能本来就不成立，
 * 不该因此报错或刷屏。
 */
function requestRefresh(sessions: unknown, parentSessionId: string): void {
  // refreshSubagents 是旧版残留名，留着只为兼容；现行公开面是 refreshProjections。
  const fn = pick(sessions, 'refreshProjections', 'refreshSubagents')
  if (typeof fn !== 'function') return
  try {
    const result = (fn as (id: string) => unknown).call(sessions, parentSessionId)
    if (result !== null && typeof result === 'object' && typeof (result as PromiseLike<unknown>).then === 'function') {
      void (result as Promise<unknown>).catch(() => undefined)
    }
  } catch { /* 忽略：拉不到就维持当前显示 */ }
}

/**
 * 订阅某个父会话下的子智能体清单。
 *
 * 刻意用「订阅 + 轮询」双保险：官方 sessions 服务暴露了订阅接口，但它的形状
 * 同样随版本变过；订阅拿到就实时刷新，拿不到就退回 1.5s 轮询 —— 子智能体的
 * running 状态本来就以秒级变化，轮询完全够用，而漏订阅只会让刷新慢一点，
 * 不会让功能消失。
 *
 * **全仓库只应有一处调用**（KrAgentPanel），结果向下传给操作面板的计数与
 * 子智能体卡：两张卡各订阅一次会各开一条 interval，白白把 RPC 打成轮询。
 *
 * @param parentSessionId - 父会话 id；null 时不订阅、不轮询。
 * @param pollMs - 轮询间隔。
 */
export function useSubagentCatalog(parentSessionId: string | null, pollMs = 1500): SubagentCatalogView {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (parentSessionId === null || parentSessionId === '') return undefined
    let alive = true
    const bump = (): void => { if (alive) setTick((value) => value + 1) }
    const sessions = getService('sessions')
    const unsubscribe = subscribeTo(sessions, bump)
    // 挂载先拉一次；之后每 4 轮补拉，兼顾"陆续派生的子智能体"与"别把 RPC
    // 打成轮询"。拉取本身是幂等的读操作：`refreshProjections` 在 state 已是
    // ready 时直接 resolve，稳态下等于零 RPC。
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

  /*
   * 出口做**引用稳定化**：tick 每次自增都重新读快照，而读出来的是同一份内容时
   * 不该让下游整棵子树跟着重渲染。签名取"会显示出来的那几个量"——进行中的行
   * 时长每秒都在变（那本来就该重渲染），没有进行中的行时签名稳定、引用稳定。
   */
  const view = useMemo(() => {
    if (typeof window === 'undefined') return EMPTY
    // tick 是唯一的刷新触发：快照本身是外部可变对象，不进依赖。
    // 出口保证非 nullish：消费端读 catalog.state，undefined 会直接抛错。
    return readSubagentCatalog(snapshotOf(getService('sessions')), parentSessionId) ?? EMPTY
  }, [parentSessionId, tick])

  const signature = view.rows
    .map((row) => `${row.id}:${row.running ? 1 : 0}:${row.elapsedMs ?? -1}:${row.tokens ?? -1}:${row.hasChildren ? 1 : 0}`)
    .join('|') + `#${view.state}`
  const cacheRef = useRef<{ sig: string; view: SubagentCatalogView } | null>(null)
  if (cacheRef.current === null || cacheRef.current.sig !== signature) {
    cacheRef.current = { sig: signature, view }
  }
  return cacheRef.current.view
}

/**
 * 跳到某个子智能体的会话（主区切换）。
 *
 * 走官方公开面 `ctx.uiWorkspace.openSession(target)` —— 与官方子智能体目录里
 * 点一行、以及侧边栏点一个会话是同一条链路（`replaceMain` + retain），所以
 * 子会话的 lineage 面包屑、只读 composer 这些官方配套全都跟着生效。
 *
 * target 优先给 **durable address**（`{ parentSessionId, childSessionId, mode }`）：
 * 官方 `resolveTarget` 见到 address 会顺带把父子关系装上，面包屑才认得出它
 * 是谁派出来的；拿不到 address（旧版 sessions 服务）就退回裸 id，官方会按
 * 已加载的目录自行解析。
 *
 * @param row - 要打开的子智能体行。
 * @returns 是否真的发出了跳转（false = 宿主没有这套服务，调用方据此给反馈）。
 */
export function openSubagentSession(row: SubagentRow): boolean {
  const workspace = getService<{ openSession?: (target: unknown) => void }>('uiWorkspace')
  const open = workspace?.openSession
  if (typeof open !== 'function') return false
  let target: unknown = row.id
  try {
    const sessions = getService<{ subagentAddress?: (id: string) => unknown }>('sessions')
    const address = sessions?.subagentAddress?.(row.id)
    if (address !== undefined && address !== null) target = address
    else if (row.mode !== 'unknown') {
      target = { parentSessionId: row.parentSessionId, childSessionId: row.id, mode: row.mode }
    }
  } catch { /* 地址解析失败就退回裸 id */ }
  try {
    open.call(workspace, target)
    return true
  } catch {
    return false
  }
}
