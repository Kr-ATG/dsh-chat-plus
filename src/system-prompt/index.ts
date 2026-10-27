/**
 * dsh-chat-plus — 「系统提示词」观测（host 半身）。
 *
 * 用户要的东西：操作间里点开「系统提示词」，就能看见**这次发送会话时真正带上
 * 的系统提示词**是什么。
 *
 * ── 为什么这份数据只可能由 host 出 ──────────────────────────────────
 * 系统提示词在浏览器侧不存在：它由 @deepseek-ai/dsh-system-prompt 在每个
 * step 之前把「全局段 + 作用域段 + 运行时上下文 + 工具清单 + 变量」组装出来，
 * 再经 system-prompt/assemble waterfall 逐层改写（**本插件的工具闸门就在这
 * 条链上删工具、删提示词段、追加「哪些能力关着」的说明**），最后渲染成一段
 * 纯文本交给 provider。客户端没有这份中间态，只能读会话事件里回放的
 * system/message —— 那已是「过去某一步的渲染结果」，不带分段信息，也看不到
 * 「关闭工具组之后剩什么」。
 *
 * 所以在 waterfall 的**出口**抓一份快照留在内存，页面通过只读路由取。出口
 * 意味着拿到的是**最终值**：任何插件（包括本插件自己的闸门）改写之后的形态。
 *
 * ── 为什么不落盘 ────────────────────────────────────────────────────
 * 这是调试视角的数据：工作目录、模型、各开关状态、时间都在里面，每次组装都
 * 会变。落盘等于存一堆只有几分钟价值的副本，还要处理清理、迁移与（更麻烦的）
 * 加密边界。所以只留最近 N 个会话各一份，进程重启即清空 —— 页面如实说明这
 * 件事，而不是给用户一个「空的但不知道为什么空」的页面。
 *
 * ── 新会话一个字都没发的时候看什么 ─────────────────────────────────
 * 内存里没有快照时，路由会**现场跑一次 assemble**（systemPrompt.assemble
 * 配 { agent, scope: agent }）：同一套组装链、同一批监听器、同一个出口，所以
 * 结果与真正发出去的一致。只有「活会话」才有 agent —— 历史会话（进程重启前
 * 的）直接如实回「不在本进程内」，不编一个看起来像真的提示词给用户。
 *
 * ── 绝不抛穿 ────────────────────────────────────────────────────────
 * 出口 hook 抛错会毁掉用户真实的那一轮请求；路由抛错会变成页面上的红屏。
 * 所以记录逻辑整段 try/catch，路由一律 200 + ok 字段，失败只是「这一次没抓到
 * 快照」，绝不影响对话本身。
 *
 * @module
 */

import { rejectCrossSite } from '../shared/csrf.ts'

/** 只读路由（GET，?session= 指定会话；缺省 = 最近一次组装）。 */
export const SYSTEM_PROMPT_ROUTE = '/api/chat-flow/system-prompt'

/**
 * 内存里最多保留多少个会话的快照。
 *
 * 40 的原因：本机日常同时活跃的会话在 10 个以内，40 足够覆盖「今天开过的那几个」；
 * 每条快照是几万字符（约 100~200KB 序列化后），40 条最多几 MB —— 对一个桌面端
 * 宿主进程可以忽略，但它同时挡住「开几百个会话把内存吃满」这条退化路径。
 */
const MAX_SESSIONS = 40

/** 单段文本保留上限（字符）：正常段最长的是卡片规范那一批，实测几万字符。 */
const MAX_SECTION_CHARS = 200_000

/** 一份快照的全文上限（字符）：超了直接截断并打 truncated 标记。 */
const MAX_TOTAL_CHARS = 2_000_000

/** 会话 id 的合理长度上限（路由 query 里的值只做这一步校验，避免脏 key）。 */
const MAX_SESSION_ID_CHARS = 200

/** token 粗估口径（与 tools-gate 一致：3.5 字节/token，只给用户一个量级）。 */
const BYTES_PER_TOKEN = 3.5

/** 空行（避免在源码里出现反斜杠转义序列，便于逐行生成与审阅）。 */
const BLANK_LINE = '\n\n'

/* ───────────────────────────── 数据形状 ───────────────────────────── */

/** 一段提示词（或一条运行时上下文）在页面上的样子。 */
export interface PromptSectionView {
  /** 段名（官方注册名，例如 harness:identity / tool:pwsh）。 */
  readonly name: string
  /** 渲染后字符数（空段已被丢弃，不会出现 0）。 */
  readonly chars: number
  /** 渲染后的正文（变量已插值）。 */
  readonly text: string
  /** 原文是否带变量引用（false = 官方声明 interpolate:false，原样输出）。 */
  readonly interpolated: boolean
  /** 引用了但这次组装里没有值的变量名（官方会抛错，这里宽容保留原文）。 */
  readonly unresolved: readonly string[]
  /** 是否因为超长被截断。 */
  readonly truncated?: boolean
}

/** 工具清单的摘要（工具 schema 也是每轮请求的一部分，一起给用户看）。 */
export interface PromptToolsView {
  readonly count: number
  readonly bytes: number
  readonly tokens: number
  readonly names: readonly string[]
}

/** 一个会话在某一刻的组装结果。 */
export interface PromptSnapshot {
  readonly sessionId: string
  /** 会话工作目录（组装时从 agent.session.header 读，读不到为 null）。 */
  readonly cwd: string | null
  /** 抓取时刻（毫秒时间戳）。 */
  readonly at: number
  /** 快照来源：assemble = 真实请求经过出口；live = 路由现场组装。 */
  readonly source: 'assemble' | 'live'
  /** 模型真正看到的 system 文本（官方 renderPrompt 的等价渲染）。 */
  readonly text: string
  readonly chars: number
  /** 估算 token（按字节 / 3.5，与闸门同口径）。 */
  readonly tokens: number
  /** 分段明细（按组装顺序；空段已丢弃）。 */
  readonly sections: readonly PromptSectionView[]
  /** 运行时上下文快照（作为 user 消息注入的那一段，见 joinContextSections）。 */
  readonly contextText: string
  readonly contexts: readonly PromptSectionView[]
  /** 组装时生效的提示词变量（provider / model 等）。 */
  readonly variables: readonly { readonly name: string; readonly value: string }[]
  readonly tools: PromptToolsView
  /** 全文是否被截断（超大工具集才会发生）。 */
  readonly truncated: boolean
}

/** 会话列表里的一行。 */
export interface PromptSessionSummary {
  readonly sessionId: string
  readonly cwd: string | null
  readonly at: number
  readonly chars: number
  readonly tools: number
  readonly source: 'assemble' | 'live'
}

/** 路由响应。 */
export interface PromptRouteResponse {
  readonly ok: boolean
  /** 内存里有快照的会话（按时间倒序）。 */
  readonly sessions: readonly PromptSessionSummary[]
  /** 这次返回的是哪个会话（null = 一个都没有）。 */
  readonly active: string | null
  /** 快照本体（null = 取不到，原因见 reason）。 */
  readonly prompt: PromptSnapshot | null
  /** prompt 为 null 时的人话原因。 */
  readonly reason?: string
}

/* ───────────────────────── 官方组装产物的最小面 ───────────────────────── */

/** 组装产物里本模块读写到的字段（不引官方类型：host 产物对 @deepseek-ai 零依赖）。 */
export interface PromptAssemblyLike {
  readonly sections?: readonly { readonly name?: unknown; readonly text?: unknown; readonly interpolate?: unknown }[]
  readonly contexts?: readonly { readonly name?: unknown; readonly text?: unknown; readonly interpolate?: unknown }[]
  readonly tools?: readonly { readonly name?: unknown }[]
  readonly variables?: Readonly<Record<string, unknown>>
}

/** agent 的最小面（只用到会话身份与工作目录）。 */
interface PromptAgentLike {
  readonly id?: unknown
  readonly session?: {
    readonly id?: unknown
    readonly header?: { readonly cwd?: unknown }
  }
}

/** host ctx 的最小面。 */
export interface SystemPromptHostContext {
  inject?: (names: string[], cb: (ctx: never) => void) => void
  on?: (event: string, listener: (...args: never[]) => unknown, options?: { prepend?: boolean }) => unknown
  effect?: (fn: () => unknown, label?: string) => void
  get?: (name: string) => unknown
  logger?: { warn?: (message: string) => void; info?: (message: string) => void }
}

/* ───────────────────────────── 渲染 ───────────────────────────── */

/**
 * 变量引用：官方只认「双花括号 + 小写字母开头」这种完整简单组。
 *
 * 用正则而不是手写扫描，是为了拿到与官方同一份判据：不匹配的引用（含空分组、
 * 带空格、大写）在官方那边是错，在这里一律**原样保留**——展示器不该因为一个
 * 坏引用就什么都不显示，那会让用户以为提示词是空的。
 */
const VARIABLE_REFERENCE = new RegExp('[{]{2}([a-z][a-z0-9_]*)[}]{2}', 'g')

/**
 * 插值一段文本（官方 interpolate 的宽容版）。
 *
 * 官方遇到「变量没注册 / 值为 undefined」会抛错让整次组装失败；这里只把没能
 * 解析的引用原样留下并登记名字，由页面提示「这个变量这次没有值」。差异是刻意
 * 的：这段代码在**观测**路径上，它失败不该反过来影响任何东西。
 *
 * @param text - 段原文。
 * @param variables - 组装时的变量表。
 * @returns 插值后的文本与没能解析的变量名（去重）。
 */
export function interpolatePromptText(
  text: string,
  variables: Readonly<Record<string, unknown>>,
): { text: string; unresolved: string[] } {
  if (!text.includes('{{')) return { text, unresolved: [] }
  const unresolved: string[] = []
  const rendered = text.replace(VARIABLE_REFERENCE, (whole: string, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      unresolved.push(name)
      return whole
    }
    const value = variables[name]
    if (typeof value !== 'string') {
      unresolved.push(name)
      return whole
    }
    return value
  })
  return { text: rendered, unresolved: [...new Set(unresolved)] }
}

/** 截断一段文本（保留头部；提示词总是「先说的更基础」）。 */
function clampText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  return { text: text.slice(0, limit), truncated: true }
}

/**
 * 渲染一组段（sections 或 contexts）：插值 → 丢空 → 收集 → 空行拼接。
 *
 * 这就是官方 renderPrompt 的全部语义（逐段插值、过滤空串、用两个换行连接），
 * 逐条对齐，否则页面显示的文本会与模型真正收到的差一两个空行 —— 而这种
 * 「看起来差不多」的偏差最难被发现。
 *
 * @param entries - assembly.sections / assembly.contexts。
 * @param variables - 组装变量表。
 * @returns 拼好的整段文本与逐段视图。
 */
export function renderPromptEntries(
  entries: readonly { readonly name?: unknown; readonly text?: unknown; readonly interpolate?: unknown }[] | undefined,
  variables: Readonly<Record<string, unknown>>,
): { text: string; sections: PromptSectionView[] } {
  const sections: PromptSectionView[] = []
  for (const entry of entries ?? []) {
    const name = typeof entry?.name === 'string' ? entry.name : ''
    const raw = typeof entry?.text === 'string' ? entry.text : ''
    const interpolated = entry?.interpolate !== false
    const resolved = interpolated ? interpolatePromptText(raw, variables) : { text: raw, unresolved: [] }
    // 空段丢弃（官方语义）：一个关了开关的插件段渲染出来就是空串，
    // 它不该在页面上占一行「（空）」让人以为是没抓到。
    if (resolved.text.length === 0) continue
    const clamped = clampText(resolved.text, MAX_SECTION_CHARS)
    sections.push({
      name,
      chars: resolved.text.length,
      text: clamped.text,
      interpolated,
      unresolved: resolved.unresolved,
      ...clamped.truncated ? { truncated: true } : {},
    })
  }
  return { text: sections.map((section) => section.text).join(BLANK_LINE), sections }
}

/**
 * 渲染运行时上下文快照（官方 joinContextSections 的等价实现）。
 *
 * 这段文本在真实请求里是**一条 user 消息**（source.kind === 'runtime-context'），
 * 不是系统提示词的一部分。页面必须把它分开展示，否则用户会把「当前工作目录是
 * …」当成模型的身份设定。
 *
 * @param entries - assembly.contexts。
 * @param variables - 组装变量表。
 * @returns 拼好的快照文本（无上下文时为空串）与逐条视图。
 */
export function renderContextSnapshot(
  entries: readonly { readonly name?: unknown; readonly text?: unknown; readonly interpolate?: unknown }[] | undefined,
  variables: Readonly<Record<string, unknown>>,
): { text: string; sections: PromptSectionView[] } {
  const rendered = renderPromptEntries(entries, variables)
  if (rendered.text.length === 0) return rendered
  return {
    text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'
      + BLANK_LINE + rendered.text,
    sections: rendered.sections,
  }
}

/** 字符串的 UTF-8 字节数（与 tools-gate 的 utf8Bytes 同口径）。 */
export function utf8Bytes(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

/** 按 3.5 字节/token 粗估。 */
export function estimateTokens(bytes: number): number {
  return Math.round(bytes / BYTES_PER_TOKEN)
}

/**
 * 把一个组装产物折成页面用的快照。
 *
 * @param assembly - system-prompt/assemble 的最终值（或现场 assemble 的返回值）。
 * @param meta - 会话身份与来源。
 * @returns 快照（纯函数，不写任何全局状态）。
 */
export function snapshotOf(
  assembly: PromptAssemblyLike | null | undefined,
  meta: { sessionId: string; cwd: string | null; source: 'assemble' | 'live' },
): PromptSnapshot {
  const variables = (assembly?.variables ?? {}) as Readonly<Record<string, unknown>>
  const prompt = renderPromptEntries(assembly?.sections, variables)
  const context = renderContextSnapshot(assembly?.contexts, variables)
  const clamped = clampText(prompt.text, MAX_TOTAL_CHARS)

  const toolNames: string[] = []
  let toolBytes = 0
  for (const tool of assembly?.tools ?? []) {
    const name = typeof tool?.name === 'string' ? tool.name : ''
    if (name === '') continue
    toolNames.push(name)
    // 工具的体积按「名字 + 描述 + 参数」估：页面说的是「这些 schema 占多少上下文」，
    // 只算名字会把这块体积说小一个数量级。
    toolBytes += utf8Bytes(JSON.stringify(tool))
  }

  return {
    sessionId: meta.sessionId,
    cwd: meta.cwd,
    at: Date.now(),
    source: meta.source,
    text: clamped.text,
    chars: prompt.text.length,
    tokens: estimateTokens(utf8Bytes(prompt.text)),
    sections: prompt.sections,
    contextText: context.text,
    contexts: context.sections,
    variables: Object.entries(variables)
      .filter((entry) => typeof entry[1] === 'string')
      .map(([name, value]) => ({ name, value: String(value) })),
    tools: {
      count: toolNames.length,
      bytes: toolBytes,
      tokens: estimateTokens(toolBytes),
      names: toolNames,
    },
    truncated: clamped.truncated,
  }
}

/* ───────────────────────────── 内存表 ───────────────────────────── */

/**
 * 会话 id → 最近一次快照。
 *
 * 用 Map 的插入顺序当「最久未更新」的依据：每次写入先删后插（见 recordSnapshot），
 * 于是第一个永远是应该被淘汰的那个。切换会话、重建会话都只是换一个 key，不需要
 * 额外的 LRU 结构。
 */
const snapshots = new Map<string, PromptSnapshot>()

/** 从 agent 上读会话 id（agent 与 session 同 id，两者都试一遍）。 */
export function sessionIdOfAgent(agent: unknown): string | null {
  if (typeof agent !== 'object' || agent === null) return null
  const record = agent as PromptAgentLike
  const fromSession = record.session?.id
  if (typeof fromSession === 'string' && fromSession !== '') return fromSession
  const fromAgent = record.id
  if (typeof fromAgent === 'string' && fromAgent !== '') return fromAgent
  return null
}

/** 从 agent 上读工作目录。 */
function cwdOfAgent(agent: unknown): string | null {
  if (typeof agent !== 'object' || agent === null) return null
  const cwd = (agent as PromptAgentLike).session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : null
}

/** 写一条快照（淘汰最久未更新的那条）。 */
export function recordSnapshot(snapshot: PromptSnapshot): void {
  if (snapshot.sessionId === '') return
  // 先删后插：让刚更新的这条排到队尾，淘汰永远发生在头部。
  snapshots.delete(snapshot.sessionId)
  snapshots.set(snapshot.sessionId, snapshot)
  while (snapshots.size > MAX_SESSIONS) {
    const oldest = snapshots.keys().next()
    if (oldest.done === true) break
    snapshots.delete(oldest.value)
  }
}

/** 读某会话最近一次快照。 */
export function readSnapshot(sessionId: string): PromptSnapshot | undefined {
  return snapshots.get(sessionId)
}

/** 最近的会话摘要列表（按时间倒序，最多 MAX_SESSIONS 条）。 */
export function listSnapshotSummaries(): PromptSessionSummary[] {
  return [...snapshots.values()]
    .map((snapshot) => ({
      sessionId: snapshot.sessionId,
      cwd: snapshot.cwd,
      at: snapshot.at,
      chars: snapshot.chars,
      tools: snapshot.tools.count,
      source: snapshot.source,
    }))
    .sort((left, right) => right.at - left.at)
}

/** 清空内存表（**仅供冒烟**：进程内跑多组断言时复位）。 */
export function resetSnapshotsForTests(): void {
  snapshots.clear()
}

/* ───────────────────────────── 路由 ───────────────────────────── */

/** 路由依赖（抽出来是为了让冒烟拿假实现直接对拍 handler）。 */
export interface SystemPromptRouteDeps {
  readonly list: () => readonly PromptSessionSummary[]
  readonly read: (sessionId: string) => PromptSnapshot | undefined
  /**
   * 现场组装（活会话才有结果）。
   *
   * 返回 snapshot 为 null 时 reason 说明为什么组装不出来（会话不活 / 没有
   * systemPrompt 服务 / 组装抛错）——页面据此显示一句人话，而不是空白。
   */
  readonly assemble: (sessionId: string) => Promise<{ snapshot: PromptSnapshot | null; reason?: string }>
}

/**
 * 处理一次查询。
 *
 * GET 带 ?session=id  → 该会话的快照（内存里没有就问现场组装）
 * GET 不带 session    → 最近一次组装的会话
 *
 * 一律 200：这是只读观测面，路由失败不该在页面上变成红色报错。
 *
 * @param req - Node 请求（只读 url 与 headers）。
 * @param res - Node 响应。
 * @param deps - 数据来源。
 */
export function handleSystemPromptRoute(req: unknown, res: unknown, deps: SystemPromptRouteDeps): void {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  const respond = (status: number, payload: PromptRouteResponse): void => {
    try {
      const target = res as {
        writeHead?: (status: number, headers: Record<string, string>) => void
        setHeader?: (name: string, value: string) => void
        end?: (body: string) => void
      }
      if (typeof target.writeHead === 'function') target.writeHead(status, headers)
      else if (typeof target.setHeader === 'function') {
        target.setHeader('content-type', headers['content-type'])
        target.setHeader('cache-control', headers['cache-control'])
      }
      target.end?.(JSON.stringify(payload))
    } catch {
      /* 回包写失败只说明连接断了，无事可做 */
    }
  }

  // 只读路由也过跨站闸门：这条可能触发一次真实的提示词组装（有副作用），
  // 让任意网页能把本机宿主拖进组装没有道理。判据见 shared/csrf.ts。
  if (rejectCrossSite((req as { headers?: Record<string, unknown> })?.headers, (status, payload) => {
    respond(status, { ok: false, sessions: [], active: null, prompt: null, reason: String(payload.error ?? 'forbidden') })
  })) return

  const finish = (sessionId: string | null, prompt: PromptSnapshot | null, reason?: string): void => {
    let sessions: readonly PromptSessionSummary[] = []
    try {
      sessions = deps.list()
    } catch {
      sessions = []
    }
    respond(200, {
      ok: prompt !== null,
      sessions,
      active: prompt?.sessionId ?? sessionId,
      prompt,
      ...reason === undefined ? {} : { reason },
    })
  }

  void (async (): Promise<void> => {
    let requested = ''
    let fresh = false
    try {
      const url = new URL((req as { url?: string })?.url ?? SYSTEM_PROMPT_ROUTE, 'http://x')
      requested = (url.searchParams.get('session') ?? '').trim().slice(0, MAX_SESSION_ID_CHARS)
      /*
       * fresh=1：跳过缓存，直接现场组装。
       *
       * 为什么必须有：页面上的「刷新」按钮对**已有缓存**的会话本来是一次空操作
       * —— 路由先命中内存快照就返回了，用户点完只看到时间戳没变，会以为按钮坏了。
       * 而「刷新」的全部意义就是「按当前开关重新组装一份给我看」（刚关掉某个工具组、
       * 刚切了模型，都要看新的）。所以刷新走 fresh，首屏仍走缓存（快）。
       *
       * 活会话才组装得出来；组不出来就回落缓存，而不是把页面清空。
       */
      fresh = url.searchParams.get('fresh') === '1'
    } catch {
      requested = ''
      fresh = false
    }

    if (requested !== '') {
      const cached = deps.read(requested)
      if (cached !== undefined && !fresh) return finish(requested, cached)
      let live: PromptSnapshot | null = null
      let liveReason = ''
      try {
        const result = await deps.assemble(requested)
        live = result.snapshot
        if (result.reason !== undefined) liveReason = result.reason
      } catch (error) {
        live = null
        liveReason = '现场组装失败：' + describe(error)
      }
      if (live !== null) return finish(requested, live)
      // fresh 但组装不出来（会话已不在本进程）→ 回落缓存，别把页面清空。
      if (cached !== undefined) return finish(requested, cached, liveReason === '' ? undefined : liveReason)
      return finish(
        requested,
        null,
        '这个会话当前不在运行（宿主重启过，或它只是历史记录），本进程里没有它的快照，也无法现场组装。'
        + '在对话里发一条消息，或切回该会话让它跑起来，再点刷新。',
      )
    }

    // 没指定会话：回最近一次真实组装的那份（时间倒序取第一）。
    let latest: PromptSnapshot | undefined
    try {
      const first = deps.list()[0]
      if (first !== undefined) latest = deps.read(first.sessionId)
    } catch {
      latest = undefined
    }
    if (latest !== undefined) return finish(latest.sessionId, latest)
    return finish(null, null, '本进程里还没有任何会话组装过提示词。在对话里发一条消息，再回来点刷新。')
  })().catch(() => {
    respond(200, { ok: false, sessions: [], active: null, prompt: null, reason: '读取快照失败（已忽略，不影响对话）' })
  })
}

/* ───────────────────────────── 装配 ───────────────────────────── */

/**
 * 读一次活会话的组装结果（路由现场组装用）。
 *
 * 这条路径会真的跑一遍 system-prompt/assemble：所有监听器都会执行，包括本插件
 * 工具闸门的出口过滤、官方 working-directory 的 ensure、模型选择快照。也就是说
 * 它拿到的就是「下一步请求会带上的东西」，不是另一套近似实现。代价是每次调用
 * 有一点开销（毫秒级），页面只在用户点开 / 切会话 / 点刷新时调。
 */
async function assembleLive(
  hostCtx: SystemPromptHostContext,
  sessionId: string,
): Promise<{ snapshot: PromptSnapshot | null; reason?: string }> {
  const agents = hostCtx.get?.('agents') as { get?: (id: string) => unknown } | undefined
  const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
  if (agent === undefined || agent === null) {
    return { snapshot: null, reason: '这个会话当前不是活会话（宿主里没有它的 agent）。' }
  }
  const systemPrompt = hostCtx.get?.('systemPrompt') as {
    assemble?: (context: unknown) => Promise<unknown>
  } | undefined
  if (systemPrompt === undefined || typeof systemPrompt.assemble !== 'function') {
    return { snapshot: null, reason: '宿主没有 systemPrompt 服务，无法现场组装。' }
  }
  // signal 必须给：官方 working-directory 的 hook 会把它透传给 ensure。一个
  // 永不 abort 的 controller 就够。
  const controller = new AbortController()
  try {
    const assembly = await systemPrompt.assemble({ agent, scope: agent, signal: controller.signal })
    return {
      snapshot: snapshotOf(assembly as PromptAssemblyLike, {
        sessionId,
        cwd: cwdOfAgent(agent),
        source: 'live',
      }),
    }
  } catch (error) {
    // 组装本身抛错：把原因带出去（页面会显示），而不是静默退化成「取不到」。
    // 真实请求遇到同样的错会毁掉那一轮，所以这条信息对排查有实际价值。
    return { snapshot: null, reason: '现场组装失败：' + describe(error) }
  }
}

/** 统一错误描述。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 装配「系统提示词」观测：出口 hook + 只读路由。
 *
 * @param hostCtx - host 根上下文（logger / on / get / inject / effect 都按需）。
 */
export function applySystemPromptInspector(hostCtx: SystemPromptHostContext): void {
  const log = (level: 'warn' | 'info', message: string): void => {
    try {
      if (level === 'warn') hostCtx.logger?.warn?.(message)
      else hostCtx.logger?.info?.(message)
    } catch {
      /* 拿不到 logger 时静默：不为了记日志再抛一次 */
    }
  }

  // ── 1. 出口抓快照 ────────────────────────────────────────────────────
  /*
   * prepend: true 是刻意的，不是抄来的。
   *
   * waterfall 的语义是「监听器依次套住 next()」：注册在我们后面的监听器在
   * next() 之内执行。只有排在最前面，await next() 返回的才是**整条链跑完
   * 之后的最终值** —— 否则我们记下的是「跑到一半」的形态：工具闸门删掉的段会
   * 重新出现，offline notice 也不会在，于是页面显示的东西与模型收到的不是同一份。
   *
   * 官方 working-directory / session-reference / model-selection 都用 prepend
   * 读最终值，同一个理由。
   */
  try {
    if (typeof hostCtx.on !== 'function') {
      log('warn', '[system-prompt] ctx.on 不可用：出口快照关闭（仍可用现场组装查看）')
    } else {
      const onAssemble = hostCtx.on(
        'system-prompt/assemble',
        async (...args: never[]): Promise<unknown> => {
          const [assembly, context, next] = args as unknown as [
            PromptAssemblyLike | undefined,
            { agent?: unknown } | undefined,
            (() => Promise<PromptAssemblyLike>) | undefined,
          ]
          const resolved = typeof next === 'function' ? await next() : assembly
          try {
            const agent = context?.agent
            const sessionId = sessionIdOfAgent(agent)
            if (sessionId !== null) {
              recordSnapshot(snapshotOf(resolved, {
                sessionId,
                cwd: cwdOfAgent(agent),
                source: 'assemble',
              }))
            }
          } catch {
            /* 记录失败绝不影响真实请求：这一段是观测，不是链路的一部分 */
          }
          return resolved
        },
        { prepend: true },
      )
      // 事件监听必须随插件卸载回收，否则热重载一次就多挂一条（同一份快照会被
      // 写 N 次，且旧闭包一直活着）。
      try {
        if (typeof hostCtx.effect === 'function') {
          hostCtx.effect(() => () => {
            try {
              if (typeof onAssemble === 'function') (onAssemble as () => void)()
            } catch { /* 已回收 */ }
          }, 'dsh-chat-plus.system-prompt hook')
        }
      } catch { /* effect 不可用时监听会随插件上下文一起销毁 */ }
      log('info', '[system-prompt] assemble 出口快照已就绪')
    }
  } catch (error) {
    log('warn', '[system-prompt] 出口 hook 注册失败：' + describe(error))
  }

  // ── 2. 只读路由 ──────────────────────────────────────────────────────
  try {
    hostCtx.inject?.(['webServer'], (webCtx: never) => {
      const webServer = (webCtx as unknown as {
        webServer?: {
          register: (entry: {
            kind: 'exact'
            path: string
            handler: (req: unknown, res: unknown) => void
          }) => () => void
        }
      }).webServer
      if (webServer === undefined || typeof webServer.register !== 'function') {
        log('warn', '[system-prompt] webServer 不可用：路由未注册')
        return
      }
      const deps: SystemPromptRouteDeps = {
        list: listSnapshotSummaries,
        read: readSnapshot,
        assemble: (sessionId) => assembleLive(hostCtx, sessionId),
      }
      const register = (): (() => void) => webServer.register({
        kind: 'exact',
        path: SYSTEM_PROMPT_ROUTE,
        handler: (req: unknown, res: unknown) => handleSystemPromptRoute(req, res, deps),
      })
      const scope = webCtx as unknown as { effect?: (fn: () => unknown, label?: string) => void }
      if (typeof scope.effect === 'function') scope.effect(register, 'dsh-chat-plus: system-prompt route')
      else register()
    })
  } catch (error) {
    log('warn', '[system-prompt] 路由注入失败：' + describe(error))
  }
}

/** 测试面（冒烟直接对拍纯函数与 handler，不依赖真实 cordis）。 */
export const __test = {
  interpolatePromptText,
  renderPromptEntries,
  renderContextSnapshot,
  snapshotOf,
  sessionIdOfAgent,
  handleSystemPromptRoute,
  recordSnapshot,
  readSnapshot,
  listSnapshotSummaries,
  resetSnapshotsForTests,
  estimateTokens,
  utf8Bytes,
  SYSTEM_PROMPT_ROUTE,
  MAX_SESSIONS,
}
