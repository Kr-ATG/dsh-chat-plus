/**
 * dsh-chat-plus — 浏览器活动（host 半身）：公共类型与契约常量。
 *
 * 两半身（host 观测 / client 渲染）逐字共用这一组字段名，改名即契约破裂：
 * 客户端只认 `sessionId/active/service/tool/since/lastAt/lingering` 六个键，
 * 多一个不多、少一个就静默不显示。所以类型集中在这里，index.ts 只做实现。
 */

/** 客户端轮询的路由（只读，同源 GET）。 */
export const BROWSER_ACTIVITY_ROUTE = '/api/chat-flow/browser-activity'

/**
 * 尾迹窗口：最后一次浏览器工具调用结束后，图标继续亮 1500ms。
 *
 * 为什么需要：playwright 的一次网页操作几乎从不只调一个工具 —— 典型序列是
 * `browser_navigate` → `browser_snapshot` → `browser_click` → `browser_type`，
 * 每个工具调用各自有开始/结束。严格按「有调用才亮」渲染，图标会在一串调用之间
 * 闪成频闪灯；1.5s 的窗口把一串相邻调用缝成一段连续的「正在操作浏览器」。
 *
 * 上限不能再大：超过 2s 就会出现「调用早就结束了、图标还挂着」的假活跃；
 * 1.5s 是「读一次快照（百毫秒级）+ 模型决定下一步」的常见间隔，够用。
 */
export const BROWSER_ACTIVITY_LINGER_MS = 1500

/** 一次调用在状态机里的明细。 */
export interface BrowserActivityCall {
  /** 工具名 `mcp__<service>__<tool>` 里的第二段（如 `playwright-mcp`）。 */
  service: string
  /** 第三段起的部分（如 `browser_click`）。 */
  tool: string
  /** 这次调用开始的时间戳（ms）。 */
  since: number
}

/** 路由里一条会话条目（客户端逐字段消费）。 */
export interface BrowserActivitySession {
  sessionId: string
  /** 此刻仍在进行的浏览器工具调用数（去重后）。 */
  active: number
  service: string
  tool: string
  /** 最早一次仍在进行（尾迹期则是最后一次）调用的开始时间。 */
  since: number
  /** 最近一次调用的开始时间。 */
  lastAt: number
  /** true = 调用已全部结束，只是还在 1500ms 尾迹窗口内。 */
  lingering: boolean
}

/** 一次快照（`now` 与 sessions 同一时钟，便于客户端算相对时间）。 */
export interface BrowserActivitySnapshot {
  now: number
  sessions: BrowserActivitySession[]
}

/**
 * 一条接缝诊断摘要（只在 `?debug=1` 时返回）。
 *
 * 刻意只留「接缝是否对得上」需要的那几个事实：工具名、有没有 callId、会话是从
 * 哪条路径认出来的、认出来的值。**绝不包含 `exec.arguments` 的原文** —— 浏览器
 * 工具的参数里就是页面内容、输入框文本，甚至登录用的账号密码。
 *
 * 为什么需要它：本功能最大的失败模式是「真实运行时 exec 上取不到 sessionId」，
 * 那样图标永远不亮、且没有任何异常可抓，只有这份摘要能直接指认是哪条路径断了。
 */
export interface BrowserActivityDebugEntry {
  /** 观测时刻（ms）。 */
  at: number
  /** 工具名（形如 `mcp__playwright-mcp__browser_click`）。 */
  name: string
  /** 这次执行有没有 `callId`（没有的话去重会退化成进程内合成键）。 */
  hasCallId: boolean
  /** 会话是从哪条路径认出来的。 */
  resolvedVia: 'agent.session.id' | 'agent.id' | 'arguments.sessionId' | 'none'
  /** 认出来的会话 id（`none` 时是空串）。 */
  sessionIdResolved: string
}

/** 诊断缓冲上限：够看清最近几次调用是怎么被认出来的，又不至于攒成内存负担。 */
export const BROWSER_ACTIVITY_DEBUG_LIMIT = 20

/** 配置面（cordis.patch.yml 的 browserActivity 段）。 */
export interface BrowserActivityConfig {
  /** 总开关，默认 true。 */
  enabled?: boolean
  /** 覆盖尾迹窗口（测试用；生产用 BROWSER_ACTIVITY_LINGER_MS）。 */
  lingerMs?: number
  /** 覆盖时钟（测试用假时钟，避免真等 1.5s）。 */
  now?: () => number
  /** 覆盖诊断缓冲上限（测试用；生产用 BROWSER_ACTIVITY_DEBUG_LIMIT=20）。 */
  debugLimit?: number
}

/** 日志面（与 cordis logger 同形，全部可选）。 */
export interface BrowserActivityLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  debug?: (message: string) => void
}

/** webServer 服务面（与 tools-gate / mail 模块同形）。 */
export interface BrowserActivityWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: never, res: never) => void
  }): () => void
}

/**
 * 本模块用到的 ctx 面。刻意不引 `@deepseek-ai/cordis` 类型：
 * host 产物必须对 `@deepseek-ai/*` 零运行时依赖（见 build.mjs 的
 * assertHostExternals），连 `import type` 也不掺 —— 类型垫片一旦与真实服务面
 * 漂移，反而会掩盖「服务缺失」这个真正需要运行时防御的失败模式。
 */
export interface BrowserActivityHostContext {
  logger?: BrowserActivityLogger
  /** 无 inject 要求的服务读取；本模块不需要，但保留成可选以兼容宿主 ctx 形状。 */
  get?(name: string): unknown
  effect?(fn: () => void | (() => void), label?: string): void
  /** 延迟注入：webServer 未就绪时回调不执行，天然静默降级。 */
  inject(names: string[], callback: (ctx: never) => void): void
  on?(event: string, listener: (payload: unknown, next: () => Promise<unknown>) => unknown): void
}
