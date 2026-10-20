/**
 * dsh-chat-plus — 浏览器活动观测（host 半身）。
 *
 * ## 为什么需要它
 *
 * 浏览器操作是**长耗时、无席位于对话流**的动作：一次 `browser_navigate` 加一串
 * `snapshot/click/type` 往往要几十秒，而界面上能证明「此刻真的在开浏览器」的
 * 只有工具调用卡里的细节。用户切到别的会话再切回来，完全看不出那个会话还在跑
 * 浏览器；会话列表里更是毫无线索（模型可能正在后台会话里点网页）。
 *
 * 于是这里做一件事：观测 `tools/execute`，算出「哪些会话此刻有浏览器调用正在
 * 进行」，暴露一条只读路由给客户端轮询，由客户端把图标画在会话列表行与会话
 * 标题栏上。
 *
 * ## 为什么包装 tools/execute 而不是别的层
 *
 *  · 与 `src/browser-on-demand/index.ts` 同一接缝：那里已经证明这一层能拿到
 *    `exec.name`、`exec.callId`、`exec.agent`，且用 `await next()` 包住真实
 *    派发，begin/end 天然对应「调用真的在做事的整段时间」；
 *  · 不改任何 provider、不碰 DSH 源码、不需要 MCP server 配合；
 *  · 失败面极小：观测器全程 try/catch，任何异常都只是「图标不亮」，绝不
 *    影响工具调用本身（waterfall 里抛错会毁掉整次调用，这是硬红线）。
 *
 * ## 状态机
 *
 * 每个会话一张表 `{ entries: Map<callKey, {service, tool, since}>, lastAt,
 * idleSince }`：
 *
 *  - **begin**：按 `exec.callId` 去重后入表（同一 callId 重复 begin 不重复计数，
 *    也不刷新时间），清掉 idleSince；
 *  - **end**：删条目；该会话已无进行中调用时记 `idleSince = now`；
 *  - **快照**（路由被调时现算，不维护缓存）：`active > 0` 或
 *    `now - idleSince <= 1500ms` 才输出。
 *
 * 不维护「当前活跃会话列表」这类派生态，是因为派生态就有第二份真相：漏一次
 * end、漏一次清理，图标会永久亮着且无人能解释。快照现算的代价是每次轮询遍历
 * 一次 Map —— 会话量级是几十，可忽略。
 *
 * ## 尾迹（lingering）为什么要 1500ms
 *
 * 见 `BROWSER_ACTIVITY_LINGER_MS` 的说明：把一串相邻的工具调用缝成一段连续
 * 的「正在操作浏览器」，避免图标频闪。
 *
 * ## 契约（与客户端半身逐字对齐，改字段名即破裂）
 *
 *   GET /api/chat-flow/browser-activity[?session=<id>]  →
 *   200 { ok: true, now, sessions: [ { sessionId, active, service, tool,
 *        since, lastAt, lingering } ] }
 *
 * 任何异常一律 200 + `{ ok: false, sessions: [] }`：客户端据此静默降级，
 * 绝不让图标把界面变成错误面板。
 */

import {
  BROWSER_ACTIVITY_DEBUG_LIMIT,
  BROWSER_ACTIVITY_LINGER_MS,
  BROWSER_ACTIVITY_ROUTE,
  type BrowserActivityCall,
  type BrowserActivityConfig,
  type BrowserActivityDebugEntry,
  type BrowserActivityHostContext,
  type BrowserActivityLogger,
  type BrowserActivitySession,
  type BrowserActivitySnapshot,
  type BrowserActivityWebServer,
} from './types.ts'
import {
  BROWSER_ACTIVITY_HINTS,
  BROWSER_ACTIVITY_PREFIX,
  BROWSER_CLI_GENERIC_SUBCOMMANDS,
  BROWSER_CLI_NAMES,
  SESSION_SOURCES,
  SHELL_TOOL_NAMES,
  browserActivityLabelOf,
  browserCliInvocationOf,
  browserCliOfCommand,
  callKeyOfExecution,
  hasCallIdOfExecution,
  isBrowserToolName,
  isShellToolName,
  parseBrowserToolName,
  sessionIdOfAgent,
  sessionIdOfExecution,
  sessionSourceOfExecution,
  shellCommandOfExecution,
  type BrowserActivityLabel,
  type BrowserCliInvocation,
  type SessionResolution,
  type SessionSource,
} from './tools.ts'

export {
  BROWSER_ACTIVITY_DEBUG_LIMIT,
  BROWSER_ACTIVITY_LINGER_MS,
  BROWSER_ACTIVITY_ROUTE,
  type BrowserActivityConfig,
  type BrowserActivityCall,
  type BrowserActivityDebugEntry,
  type BrowserActivityHostContext,
  type BrowserActivityLogger,
  type BrowserActivitySession,
  type BrowserActivitySnapshot,
}
export {
  BROWSER_ACTIVITY_HINTS,
  BROWSER_ACTIVITY_PREFIX,
  BROWSER_CLI_NAMES,
  SESSION_SOURCES,
  SHELL_TOOL_NAMES,
  browserActivityLabelOf,
  browserCliInvocationOf,
  browserCliOfCommand,
  callKeyOfExecution,
  hasCallIdOfExecution,
  isBrowserToolName,
  isShellToolName,
  parseBrowserToolName,
  sessionIdOfAgent,
  sessionIdOfExecution,
  sessionSourceOfExecution,
  shellCommandOfExecution,
  type BrowserActivityLabel,
  type BrowserCliInvocation,
  type SessionResolution,
  type SessionSource,
}

/** 一个会话的观测态。 */
interface SessionState {
  /** 进行中的调用，键是 callKey（`exec.callId`）。 */
  entries: Map<string, BrowserActivityCall>
  /** 最近一次调用开始时间（尾迹期用它当 since/lastAt）。 */
  lastAt: number
  /** 最近一次调用的 service/tool —— 尾迹期没有 entries 了，靠它描述「刚才在做什么」。 */
  lastService: string
  lastTool: string
  /** 调用全部结束的时刻；有调用进行中时为 null。 */
  idleSince: number | null
}

/** tracker 的可注入面（测试用假时钟，生产用 Date.now）。 */
export interface BrowserActivityTrackerOptions {
  lingerMs?: number
  now?: () => number
  /** 诊断缓冲上限（默认 BROWSER_ACTIVITY_DEBUG_LIMIT，测试可调小）。 */
  debugLimit?: number
}

/**
 * 接缝诊断环形缓冲。
 *
 * 只保留最近 N 条「命中了浏览器工具判据、但会话是从哪条路径认出来的」。为什么
 * 是环形而不是只留最后一条：一次浏览器操作就是十几二十个工具调用，只看最后一条
 * 很容易正好落在一次异常上；环形才能让人一眼看出「是不是每一条都是 none」。
 *
 * 淘汰策略是最朴素的「满了就挤掉最旧的一条」：这里的量级是 20 条、每条五个标量，
 * 换成别的结构（时间窗、去重表）只会让排障时更难解释「为什么我看不到那次调用」。
 */
export class BrowserActivityDebugBuffer {
  private readonly entries: BrowserActivityDebugEntry[] = []
  private readonly limit: number

  constructor(limit: number = BROWSER_ACTIVITY_DEBUG_LIMIT) {
    this.limit = Number.isInteger(limit) && limit > 0 ? limit : BROWSER_ACTIVITY_DEBUG_LIMIT
  }

  /** 当前条数（测试/诊断用）。 */
  get size(): number {
    return this.entries.length
  }

  /**
   * 记一条摘要（最新的排在最后）。
   *
   * 入参已经是纯标量，调用方负责**不要把 `exec.arguments` 带进来** —— 浏览器
   * 工具的参数里就是页面内容、输入框文本乃至密码，进缓冲就等于进了一条可被
   * 任何同源请求读走的通道。
   */
  push(entry: BrowserActivityDebugEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
  }

  /** 取一份快照（浅拷贝数组；条目本身是新建的普通对象，不会被外部改到内部态）。 */
  list(): BrowserActivityDebugEntry[] {
    return this.entries.map((entry) => ({ ...entry }))
  }

  /** 清空（卸载时调用，与状态机一起回收）。 */
  clear(): void {
    this.entries.length = 0
  }
}

/**
 * 每会话的浏览器活动状态机。
 *
 * 线程模型：全部读写都在 host 单线程里完成，无锁。注入 `now` 是为了让冒烟能
 * 不真等 1.5 秒就验证尾迹边界 —— 尾迹窗判错的后果是「图标闪」或「图标不灭」，
 * 都不会抛错，只能靠断言发现。
 */
export class BrowserActivityTracker {
  private readonly sessions = new Map<string, SessionState>()
  /** 接缝诊断缓冲（只在 ?debug=1 时对外可见）。 */
  private readonly debugBuffer: BrowserActivityDebugBuffer
  /** 生效的尾迹窗口（诊断/日志读 lingerMs）。 */
  private readonly lingerMsValue: number
  private readonly now: () => number
  /** 每个会话当前的清理定时器（每会话最多一个；begin 时取消）。 */
  private readonly sweepOf = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(options: BrowserActivityTrackerOptions = {}) {
    this.lingerMsValue = typeof options.lingerMs === 'number' && options.lingerMs >= 0
      ? options.lingerMs
      : BROWSER_ACTIVITY_LINGER_MS
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.debugBuffer = new BrowserActivityDebugBuffer(options.debugLimit)
  }

  /**
   * 记一条接缝诊断。
   *
   * @param name 工具名（只留名字，不带任何参数内容）。
   * @param exec 本次执行 —— 只用来派生 hasCallId 与来源，**不读 arguments 的内容**。
   */
  recordDebug(name: unknown, exec: unknown): void {
    if (this.disposed) return
    try {
      const resolution = sessionSourceOfExecution(exec)
      this.debugBuffer.push({
        at: this.now(),
        name: typeof name === 'string' ? name : '',
        hasCallId: hasCallIdOfExecution(exec),
        resolvedVia: resolution.via,
        sessionIdResolved: resolution.sessionId,
      })
    } catch {
      /* 诊断本身失败绝不能连累观测与真实调用 */
    }
  }

  /** 诊断缓冲快照（`?debug=1` 用）。 */
  debug(): BrowserActivityDebugEntry[] {
    return this.debugBuffer.list()
  }

  /** 当前被跟踪的会话数（诊断/测试用，含尾迹期会话）。 */
  get size(): number {
    return this.sessions.size
  }

  /** 生效的尾迹窗口（诊断/日志用；配置可覆盖，所以不直接读常量）。 */
  get lingerMs(): number {
    return this.lingerMsValue
  }

  /**
   * 记一次调用开始。
   *
   * @param sessionId 归属会话；空串表示拿不到会话，调用方应跳过（这里也直接忽略）。
   * @param callKey 去重键（`exec.callId`）。
   * @param name 工具名，用于解析 service/tool。
   */
  begin(sessionId: string, callKey: string, name: unknown, label?: BrowserActivityLabel | null): void {
    if (this.disposed || sessionId === '') return
    const state = this.stateOf(sessionId)
    // 同一 callId 重复 begin：不重复计数、不刷新时间（否则 since 会被推后，
    // 「这段操作已经跑了多久」就失真了）。
    if (state.entries.has(callKey)) return
    const at = this.now()
    /*
     * 展示用 service/tool 由调用方给（label）：MCP 工具来自工具名拆解，shell 工具
     * 来自命令行解析出的 CLI 与子命令。缺省回落到工具名拆解，保证老调用点与
     * 只传工具名的测试不必改。
     */
    const parsed = label === undefined || label === null ? parseBrowserToolName(name) : label
    const service = parsed?.service ?? 'mcp'
    const tool = parsed?.tool ?? (typeof name === 'string' ? name : '')
    state.entries.set(callKey, { service, tool, since: at })
    state.lastAt = at
    state.lastService = service
    state.lastTool = tool
    state.idleSince = null
    // 有调用重新开始：尾迹期作废，撤掉待清理的定时器。
    this.cancelSweep(sessionId)
  }

  /**
   * 记一次调用结束。
   *
   * @param sessionId 归属会话。
   * @param callKey 与 begin 相同的去重键；未配对（或已 end 过）时静默无事。
   */
  end(sessionId: string, callKey: string): void {
    if (this.disposed || sessionId === '') return
    const state = this.sessions.get(sessionId)
    if (state === undefined) return
    if (!state.entries.delete(callKey)) return
    if (state.entries.size > 0) return
    state.idleSince = this.now()
    this.scheduleSweep(sessionId)
  }

  /** 丢弃某会话的全部观测（会话销毁时调用）。 */
  forget(sessionId: string): void {
    if (sessionId === '') return
    this.cancelSweep(sessionId)
    this.sessions.delete(sessionId)
  }

  /** 卸载：清定时器与全部状态，防止 Fiber 回收后还留着旧条目。 */
  dispose(): void {
    this.disposed = true
    for (const timer of this.sweepOf.values()) clearTimeout(timer)
    this.sweepOf.clear()
    this.sessions.clear()
    this.debugBuffer.clear()
  }

  /**
   * 现算一份快照。
   *
   * 只输出 `active > 0` 或尾迹窗口内的会话；其余静默不入数组（客户端据此
   * 决定图标亮不亮）。
   *
   * @param sessionId 可选：只输出该会话（服务 `?session=` 过滤）。
   */
  snapshot(sessionId?: string): BrowserActivitySnapshot {
    const at = this.now()
    const sessions: BrowserActivitySession[] = []
    for (const [id, state] of this.sessions) {
      if (sessionId !== undefined && sessionId !== '' && id !== sessionId) continue
      const rows = [...state.entries.values()]
      if (rows.length > 0) {
        let earliest = Number.POSITIVE_INFINITY
        let latest = Number.NEGATIVE_INFINITY
        let newest: BrowserActivityCall | undefined
        for (const row of rows) {
          if (row.since < earliest) earliest = row.since
          if (row.since >= latest) { latest = row.since; newest = row }
        }
        sessions.push({
          sessionId: id,
          active: rows.length,
          // service/tool 取「最近开始的那一次」：用户想知道的是此刻在做什么；
          // since 取最早那次，表示这段连续操作从什么时候开始。
          service: newest?.service ?? state.lastService,
          tool: newest?.tool ?? state.lastTool,
          since: Number.isFinite(earliest) ? earliest : latest,
          // lastAt 用整张表的 lastAt 而不是「进行中调用的最大 since」：契约说
          // 它是「最近一次调用开始时间」，而那一次可能已经结束了、同时另有
          // 一次还在跑。两值取大即可，不必再分辨谁结束了。
          lastAt: Math.max(state.lastAt, Number.isFinite(latest) ? latest : 0),
          lingering: false,
        })
        continue
      }
      if (state.idleSince === null) continue
      if (at - state.idleSince > this.lingerMsValue) {
        // 惰性清理：过期条目在这里就地删掉（遍历中删当前项是安全的）。
        // 清理定时器可能因为「假时钟 / 事件循环繁忙」没跑到，这里是兜底，
        // 保证「有人读就一定顺手收一遍」。
        this.cancelSweep(id)
        this.sessions.delete(id)
        continue
      }
      // 尾迹期：entries 已空，只剩下最后一调用的痕迹，所以 since 与 lastAt
      // 同值（契约里 since 的语义是「尾迹中那一次调用的开始时间」）。
      sessions.push({
        sessionId: id,
        active: 0,
        service: state.lastService,
        tool: state.lastTool,
        since: state.lastAt,
        lastAt: state.lastAt,
        lingering: true,
      })
    }
    return { now: at, sessions }
  }

  private stateOf(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (state === undefined) {
      state = { entries: new Map(), lastAt: 0, lastService: '', lastTool: '', idleSince: null }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  /**
   * 尾迹到点后清掉该会话。
   *
   * 为什么要有定时器而不是只靠轮询惰性清理：客户端轮询是「有人看才轮询」，
   * 用户切走后会话条目会一直留在 Map 里（会话数 × 若干字段虽小，但一个
   * 只写不删的表迟早变成泄漏）。定时器只删「已无进行中调用且尾迹过期」的
   * 会话，且 `unref` 掉 —— 不拖住进程退出。
   */
  private scheduleSweep(sessionId: string): void {
    this.cancelSweep(sessionId)
    const timer = setTimeout(() => {
      this.sweepOf.delete(sessionId)
      const state = this.sessions.get(sessionId)
      if (state === undefined) return
      if (state.entries.size > 0) return
      if (state.idleSince === null) { this.sessions.delete(sessionId); return }
      /*
       * 不重排是刻意的。时钟可能被替换成假时钟（冒烟就是这么做的），此时
       * 「到点」与「过期」不再等价：重排会变成每 50ms 一次的自旋，一直转到
       * 进程退出。这里只清真正过期的，没过的留给下一次 snapshot 惰性清理
       * —— 客户端轮询一定会在尾迹窗内读到它，那条路径必然经过 snapshot。
       */
      if (this.now() - state.idleSince >= this.lingerMsValue) this.sessions.delete(sessionId)
    }, this.lingerMsValue + 50)
    // 定时器只负责清理：不让它成为进程退不掉的最后一个句柄。
    const handle = timer as unknown as { unref?: () => void }
    handle.unref?.()
    this.sweepOf.set(sessionId, timer)
  }

  private cancelSweep(sessionId: string): void {
    const timer = this.sweepOf.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.sweepOf.delete(sessionId)
  }
}

/** 路由响应的统一出口：一律 200 + JSON，且自身不再抛。 */
function writeJson(res: unknown, payload: Record<string, unknown>): void {
  const response = res as { writeHead?: (code: number, headers: Record<string, string>) => void; end?: (body: string) => void }
  try {
    response?.writeHead?.(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response?.end?.(JSON.stringify(payload))
  } catch {
    // 响应已经关了（客户端先断开）：这里再抛就成了 unhandled rejection。
  }
}

/** 路由 handler 需要的最小状态机面（便于测试注入假实现）。 */
export interface BrowserActivitySource {
  snapshot(sessionId?: string): BrowserActivitySnapshot
  /** 诊断缓冲（可选：只提供 snapshot 的假实现也能跑路由）。 */
  debug?(): BrowserActivityDebugEntry[]
}

/**
 * 处理一次活动查询。
 *
 * 只读、同源 GET。任何异常（URL 解析失败、快照算炸、响应写失败）都收敛成
 * 200 + `{ ok: false, sessions: [] }` —— 客户端约定据此静默降级，绝不把
 * 一个装饰性能力变成界面上的红色报错，更不允许 4xx/5xx。
 *
 * `?debug=1` 时额外带一个 `debug` 数组（最近 N 条接缝诊断）。**不带该参数时
 * 响应形状与契约完全一致** —— 客户端按固定字段读，多一个键虽然无害，但「一个
 * 默认关闭的诊断开关不该改动主契约」这条线要守住：契约少一个字段是静默不显示，
 * 多一个字段则会让任何按 keys 断言的对拍（含本仓库的冒烟）失效。
 *
 * @param req Node 请求（只取 method/url）。
 * @param res Node 响应。
 * @param tracker 状态机（或任何同形快照源，便于测试注入）。
 */
export function handleBrowserActivityRoute(
  req: unknown,
  res: unknown,
  tracker: BrowserActivitySource,
): void {
  try {
    const request = req as { method?: unknown; url?: unknown } | null | undefined
    const method = typeof request?.method === 'string' ? request.method.toUpperCase() : 'GET'
    if (method !== 'GET') {
      // 只读路由：写请求按「无事发生」处理，仍然 200（客户端只做 GET）。
      writeJson(res, { ok: false, sessions: [] })
      return
    }
    const raw = typeof request?.url === 'string' && request.url !== '' ? request.url : BROWSER_ACTIVITY_ROUTE
    const url = new URL(raw, 'http://x')
    const filter = (url.searchParams.get('session') ?? '').trim()
    const snapshot = tracker.snapshot(filter === '' ? undefined : filter)
    const payload: Record<string, unknown> = {
      ok: true,
      now: snapshot.now,
      sessions: snapshot.sessions.map((row) => ({
        sessionId: row.sessionId,
        active: row.active,
        service: row.service,
        tool: row.tool,
        since: row.since,
        lastAt: row.lastAt,
        lingering: row.lingering,
      })),
    }
    // 只认显式的 1/true：debug 是排障开关，别让 ?debug=0 之类的写法产生歧义。
    const debugFlag = (url.searchParams.get('debug') ?? '').trim().toLowerCase()
    if (debugFlag === '1' || debugFlag === 'true') {
      payload.debug = typeof tracker.debug === 'function' ? tracker.debug() : []
    }
    writeJson(res, payload)
  } catch {
    writeJson(res, { ok: false, sessions: [] })
  }
}

/** 装配句柄。 */
export interface BrowserActivityHandle {
  tracker: BrowserActivityTracker
  /** 现算一份快照（诊断/测试用）。 */
  snapshot(sessionId?: string): BrowserActivitySnapshot
  /** 最近的接缝诊断摘要（`?debug=1` 的同一份数据）。 */
  debug(): BrowserActivityDebugEntry[]
  /** 浏览器活动观测是否真的接上了（ctx.on 缺失时为 false，路由仍可用）。 */
  tracking: boolean
  dispose(): void
}

/** 从配置里取 tracker 选项（`now` 只对测试有意义）。 */
function trackerOptionsOf(config: BrowserActivityConfig): BrowserActivityTrackerOptions {
  return {
    ...(typeof config.lingerMs === 'number' ? { lingerMs: config.lingerMs } : {}),
    ...(typeof config.now === 'function' ? { now: config.now } : {}),
    ...(typeof config.debugLimit === 'number' ? { debugLimit: config.debugLimit } : {}),
  }
}

/** 安全地从事件载荷里读 agent（cordis 的 Proxy 一读就抛）。 */
function agentOfPayload(payload: unknown): unknown {
  try {
    return (payload as { agent?: unknown } | null | undefined)?.agent
  } catch {
    return undefined
  }
}

/** 安全地调 logger（logger 本身也在 ctx Proxy 上，可能未 inject）。 */
function safeLog(ctx: BrowserActivityHostContext, level: 'info' | 'warn', message: string): void {
  try {
    const logger: BrowserActivityLogger | undefined = ctx.logger
    const sink = logger?.[level]
    if (typeof sink === 'function') sink(message)
  } catch {
    /* 拿不到 logger 时静默：不为了记日志再抛一次 */
  }
}

/**
 * 装配浏览器活动观测。在 host 的 apply 同步路径上调用一次即可。
 *
 * 三块各自独立降级：
 *  1. `tools/execute` 观测：ctx.on 缺失时只丢观测（路由仍如实返回空）；
 *  2. 路由注册：延迟注入 webServer，服务未就绪时回调不执行、天然静默跳过；
 *  3. 会话销毁清理：`agent/disposed` 缺失时靠尾迹定时器兜底。
 *
 * @param ctx host 上下文。
 * @param config browserActivity 配置段。
 * @returns 句柄；`enabled:false` 时返回 null。
 */
export function applyBrowserActivity(
  ctx: BrowserActivityHostContext,
  config: BrowserActivityConfig = {},
): BrowserActivityHandle | null {
  if (config.enabled === false) return null
  const tracker = new BrowserActivityTracker(trackerOptionsOf(config))

  let tracking = false
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('tools/execute', (async (exec: unknown, next: () => Promise<unknown>): Promise<unknown> => {
        // 观测全程 try/catch：这一层是 waterfall，抛出去会毁掉整次工具调用。
        // 宁可「图标不亮」，也绝不能让观测器影响真实操作。
        let observing = false
        let sessionId = ''
        let callKey = ''
        try {
          const name = (exec as { name?: unknown } | null | undefined)?.name
          /*
           * 两条判据合在 labelOf 里：MCP 工具名命中关键词，或 shell 工具的命令行
           * 在可执行位置调用了浏览器 CLI（ego-browser 这类不是 MCP 工具，只能用
           * 命令行判）。拿不到 label 就不是浏览器操作，直接透传。
           */
          const label = browserActivityLabelOf(name, exec)
          if (label !== null) {
            // 先记诊断再看能不能认出会话：取不到 sessionId 恰恰是最需要这份
            // 记录的情形（图标永远不亮、且没有任何异常可抓）。
            tracker.recordDebug(name, exec)
            sessionId = sessionIdOfExecution(exec)
            callKey = callKeyOfExecution(exec)
            // 拿不到会话就跳过：算到任何会话上都会在无关行点亮图标。
            if (sessionId !== '') {
              tracker.begin(sessionId, callKey, name, label)
              observing = true
            }
          }
        } catch {
          observing = false
        }
        try {
          return await next()
        } finally {
          if (observing) {
            try {
              tracker.end(sessionId, callKey)
            } catch {
              /* 收尾失败只影响图标，不影响结果 */
            }
          }
        }
      }) as never)
      // 只有观测器真的登记上才算 tracking。下面 agent/disposed 注册失败不该
      // 把这里改回 false —— 两条是独立能力，主体观测仍然在工作。
      tracking = true
    } else {
      safeLog(ctx, 'warn', '[browser-activity] ctx.on unavailable: 活动观测未装配（路由仍可用）')
    }
  } catch (error) {
    tracking = false
    safeLog(ctx, 'warn', '[browser-activity] tools/execute observer failed to mount: ' + describe(error))
  }

  // ── 会话销毁即清 ────────────────────────────────────────────────────────
  // 不清的话被删会话的条目要等尾迹定时器（1.55s）才走，而中间若有客户端轮询，
  // 会在已删除的会话名下回一条幽灵记录。这块独立兜底：它挂了只是晚 1.5s 清理，
  // 不该把主体观测一起判成失效。
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('agent/disposed', ((payload: unknown): void => {
        try {
          // 官方形状是 { agent }；顺手也认「载荷本身是 agent」的写法，
          // 免得服务面形状一变就静默漏清（forget 幂等，多清无害）。
          const sessionId = sessionIdOfAgent(agentOfPayload(payload)) || sessionIdOfAgent(payload)
          if (sessionId !== '') tracker.forget(sessionId)
        } catch {
          /* 清理失败不影响主流程 */
        }
      }) as never)
    }
  } catch (error) {
    safeLog(ctx, 'warn', '[browser-activity] agent/disposed hook failed: ' + describe(error))
  }

  // ── 卸载清理：先声明再挂载 ──────────────────────────────────────────────
  // 顺序刻意放在 inject 之前：inject 回调可能同步执行，回调里若抛错而被下面的
  // catch 吞掉，清理仍然要先登记好。宿主热重载后若不清，新旧两份 tracker 与
  // 定时器会同时存在（定时器闭包持有旧 tracker，等于泄漏一整张表）。
  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => tracker.dispose(), 'dsh-chat-plus.browser-activity')
    }
  } catch (error) {
    safeLog(ctx, 'warn', '[browser-activity] effect failed: ' + describe(error))
  }

  // ── 只读路由：客户端轮询入口 ────────────────────────────────────────────
  // 延迟注入：webServer 未就绪时回调根本不会执行，天然静默跳过；服务销毁时
  // 路由自动回收。不能在 apply 同步路径上直接读 ctx.webServer —— 那是 Proxy，
  // 未 inject 的属性一读就抛，会连累整棵插件树 boot 失败。
  try {
    ctx.inject(['webServer'], (webCtx: never) => {
      const webServer = (webCtx as unknown as { webServer?: BrowserActivityWebServer }).webServer
      if (webServer === undefined || typeof webServer.register !== 'function') {
        safeLog(ctx, 'warn', '[browser-activity] webServer unavailable: 活动路由未注册')
        return
      }
      const register = (): (() => void) => webServer.register({
        kind: 'exact',
        path: BROWSER_ACTIVITY_ROUTE,
        handler: (req: never, res: never) => handleBrowserActivityRoute(req, res, tracker),
      })
      // 用 webCtx.effect 包住注册：服务销毁 / 插件卸载时路由自动回收。
      // 不包的话 webServer 会一直持有 handler 闭包（连带整个 tracker 与它的
      // 定时器），热重载一次就留一份。webCtx 形状不全时退回直接注册。
      const scope = webCtx as unknown as { effect?: (fn: () => unknown, label?: string) => void }
      if (typeof scope.effect === 'function') scope.effect(register, 'dsh-chat-plus: browser-activity route')
      else register()
    })
  } catch (error) {
    safeLog(ctx, 'warn', '[browser-activity] route injection failed: ' + describe(error))
  }

  safeLog(
    ctx,
    'info',
    `[browser-activity] 就绪：route=${BROWSER_ACTIVITY_ROUTE}，尾迹 ${tracker.lingerMs}ms，tracking=${tracking}`,
  )

  return {
    tracker,
    tracking,
    snapshot: (sessionId?: string) => tracker.snapshot(sessionId),
    debug: () => tracker.debug(),
    dispose: () => tracker.dispose(),
  }
}

/** 把任意异常压成一行文案（日志用，不做类型收窄的花活）。 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

/** 测试面（冒烟直接断言纯函数与状态机，不依赖真实 cordis / 真实计时）。 */
export const __test = {
  BrowserActivityTracker,
  BrowserActivityDebugBuffer,
  isBrowserToolName,
  parseBrowserToolName,
  sessionIdOfAgent,
  sessionIdOfExecution,
  sessionSourceOfExecution,
  hasCallIdOfExecution,
  callKeyOfExecution,
  handleBrowserActivityRoute,
  applyBrowserActivity,
  SESSION_SOURCES,
  BROWSER_ACTIVITY_ROUTE,
  BROWSER_ACTIVITY_LINGER_MS,
  BROWSER_ACTIVITY_DEBUG_LIMIT,
  BROWSER_ACTIVITY_HINTS,
  BROWSER_ACTIVITY_PREFIX,
  BROWSER_CLI_GENERIC_SUBCOMMANDS,
  BROWSER_CLI_NAMES,
  SHELL_TOOL_NAMES,
  browserActivityLabelOf,
  browserCliInvocationOf,
  browserCliOfCommand,
  isShellToolName,
  shellCommandOfExecution,
}
