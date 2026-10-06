/**
 * dsh-chat-plus — 工具闸门（host 半身）。
 *
 * ## 为什么需要它
 *
 * 电脑操作（`cua_driver_native__*`，56 个）与浏览器操作
 * （`mcp__playwright-mcp__*`，24 个）在全局组合里常驻注册，于是每个会话、
 * 每一轮请求都要为这 80 个工具的 JSON schema 付约 3.1 万 token —— 实测占
 * 全部工具定义的 74.7%（136 个工具 / 164,979 B，其中这两组 123,178 B）。
 * 而本机 253 个会话里只有 44 个（17.4%）真正调用过它们。
 *
 * ## 为什么不用另外两条现成路子
 *
 * 1. **官方 `deferLoading`**：那是给声明了 `toolUpdate` 的适配器用的开关，只有
 *    `dsh-llm-deepseek` 声明了它。当前 magpie 路由走 pi-ai 的
 *    `openai-completions`，`dsh-llm` 的 `projectToolUpdates` 在
 *    `toolUpdate === undefined` 分支里把 developer 消息与 `deferLoading` 标记
 *    一起剥掉，工具照旧全量声明 —— 做了不生效。
 *
 * 2. **`ctx.tools.restrict({ deny })`**：只过滤「继承来的」工具（global 层 +
 *    祖先作用域层），不过滤自己那一层注册的（core/tools 的 `view()` 对
 *    `own.tools` 无条件 visible）。computer-use 的工具在 global 层，挡得住；
 *    browser-use 的工具由 provider 经 `createScope(ctx, agent)` 注册进 agent
 *    自己的作用域层，挡不住。两套后端要共用一套开关，就不能靠 restrict。
 *
 * ## 做法
 *
 * 在 `system-prompt/assemble` waterfall 的**出口**按 agent 过滤最终组装结果：
 * 该组的工具 schema 与它自己注册的系统提示词段一起拿掉。这一步对注册层级不
 * 敏感（无论工具在 global 还是 agent 层，最终都要过这次组装），且不改任何
 * provider、不动 DSH 源码、不动 profile 配置：
 *
 *  - 默认全关 → 每轮请求真的少 3.1 万 token，不是「注册了但看不见」；
 *  - `/computer-use on|off`、`/browser-use on|off` 按会话切换，下一步生效；
 *  - 关闭时相关的 GUIDANCE 提示词段一并移除，避免模型去调用看不见的工具而收
 *    `UNKNOWN_TOOL`（官方 browser-use runtime 对 blocked 会话也是这么做的）。
 *
 * ## 已知代价
 *
 * 切换会改变请求工具集：`agent-loop` 因此追加一条 tool-addition/removal 的
 * developer 消息并刷新 `request/header`（当前路由下这些 developer 消息不发往
 * 模型，只在会话日志留痕），KV-cache 前缀从那一点起失效一次。用一次前缀失效
 * 换每轮 3.1 万 token 的固定支出，划算。
 *
 * 注：本模块只管模型能看见什么。provider 本身的进程成本（cua 的原生运行时、
 * playwright 每会话一个 Chrome）不在闸门范围内。
 */

/** 日志面（方法与 cordis logger 同形，全部可选）。 */
export interface GateLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  debug?: (message: string) => void
}

/** 工具 schema 的最小形状（`system-prompt` 组装产物的子集）。 */
export interface GateToolSchema {
  name: string
  description?: string
  parameters?: unknown
  deferLoading?: true
}

/** 系统提示词段的最小形状。 */
export interface GatePromptSection {
  name: string
  text?: unknown
}

/** 一次组装的最小形状（只声明本模块读写到的字段）。 */
export interface GateAssembly {
  tools?: readonly GateToolSchema[]
  sections?: readonly GatePromptSection[]
}

/** 命令 handler 收到的调用信息（只用 agent 与原文）。 */
export interface GateCommandInvocation {
  agent: unknown
  rawInput: string
}

/** 命令结果（官方 `CommandResult` 的同形子集）。 */
export interface GateCommandResult {
  kind: 'success' | 'error'
  text: string
}

/** commands 服务面。 */
export interface GateCommands {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler: (invocation: GateCommandInvocation) => GateCommandResult | Promise<GateCommandResult>
  }): () => void
}

/** tools 服务面（只用于统计某组有多少个工具、占多少字节）。 */
export interface GateTools {
  schemas(scope?: unknown): readonly GateToolSchema[]
}

/** 组装上下文（`assembleContextFor` 会带上 agent）。 */
export interface GateAssembleContext {
  agent?: unknown
  scope?: unknown
}

/** 本模块用到的全部 ctx 面。刻意不引 `@deepseek-ai/cordis` 类型：那个垫片对
 * `commands` 服务与 `system-prompt/assemble` 没有声明，且 host 产物必须保持
 * 对 `@deepseek-ai/*` 零运行时依赖（见 build.mjs 的 assertHostExternals）。 */
export interface GateHostContext {
  logger?: GateLogger
  /** 无 inject 要求的服务读取（cordis `ctx.get`）；拿 tools 只用于文案里的体积统计。 */
  get?(name: string): unknown
  effect?(fn: () => void | (() => void), label?: string): void
  inject(names: string[], callback: (ctx: never) => void): void
  on?(
    event: string,
    listener: (assembly: GateAssembly, context: GateAssembleContext, next: () => Promise<GateAssembly>) => Promise<GateAssembly>,
  ): void
}

/** webServer 服务面（与 mail 模块同形）。 */
export interface GateWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: never, res: never) => void
  }): () => void
}

/** 一个工具组：前缀命中即归入该组，关闭时连同其提示词段一起从请求里移除。 */
export interface GateGroup {
  /** 状态键，同时就是 `/` 命令名（须满足官方命令语法：小写字母开头，可含 `-`/`_`/数字）。 */
  key: string
  /** 命令返回文案里的中文展示名。 */
  label: string
  /** 工具名前缀；按数组顺序先到先得。 */
  prefixes: readonly string[]
  /** 该组 provider 注册的系统提示词段名，关闭时一并移除。 */
  sections: readonly string[]
  /** `/` 菜单里的一句话说明。 */
  description: string
}

/** 默认闸门组：实测占全部工具定义 74.7% 的那两组。 */
export const DEFAULT_GATE_GROUPS: readonly GateGroup[] = [
  {
    key: 'computer-use',
    label: '电脑操作',
    prefixes: ['cua_driver_native__'],
    sections: ['computer-use:cua-driver-native'],
    description: '电脑操作工具按需开关（/computer-use on|off|status；不带参数 = 切换）',
  },
  {
    key: 'browser-use',
    label: '浏览器操作',
    prefixes: ['mcp__playwright-mcp__'],
    sections: ['mcp:playwright-mcp'],
    description: '浏览器操作工具按需开关（/browser-use on|off|status；不带参数 = 切换）',
  },
]

/** 配置面（cordis.patch.yml 的 toolsGate 段）。 */
export interface GateConfig {
  /** 需要默认开启的组 key（缺省全关 = 每轮直接省下这几万 token）。 */
  defaultEnabled?: readonly string[]
  /** 覆盖默认分组（改前缀或加新组时用）。 */
  groups?: readonly GateGroup[]
}

/** 命中某组返回该组，否则 null。无前缀匹配的普通工具返回 null。 */
export function groupOfTool(name: string, groups: readonly GateGroup[] = DEFAULT_GATE_GROUPS): GateGroup | null {
  for (const group of groups) {
    for (const prefix of group.prefixes) {
      if (name.startsWith(prefix)) return group
    }
  }
  return null
}

/** 组装产物的过滤结果。 */
export interface GateProjection {
  tools: readonly GateToolSchema[]
  sections: readonly GatePromptSection[]
  /** 被拿掉的工具名（诊断与文案用）。 */
  removedTools: string[]
  /** 被拿掉的提示词段名。 */
  removedSections: string[]
}

/**
 * 按当前开关过滤一次组装产物。
 *
 * 纯函数：不读 ctx、不改入参。`enabled` 由调用方按 agent 提供，因此同一份
 * 组装逻辑对任意 agent 都成立。
 *
 * @param assembly 组装产物（工具 + 提示词段）。
 * @param enabled 判定某组是否开启。
 * @param groups 分组表。
 * @returns 过滤后的工具与提示词段，以及被移除项的清单。
 */
export function projectGate(
  assembly: GateAssembly,
  enabled: (key: string) => boolean,
  groups: readonly GateGroup[] = DEFAULT_GATE_GROUPS,
): GateProjection {
  const removedTools: string[] = []
  const removedSections: string[] = []

  const tools = (assembly.tools ?? []).filter((tool) => {
    const name = typeof tool?.name === 'string' ? tool.name : ''
    if (name === '') return true
    const group = groupOfTool(name, groups)
    if (group === null || enabled(group.key)) return true
    removedTools.push(name)
    return false
  })

  const droppedSections = new Set<string>()
  for (const group of groups) {
    if (enabled(group.key)) continue
    for (const section of group.sections) droppedSections.add(section)
  }
  const sections = (assembly.sections ?? []).filter((section) => {
    const name = typeof section?.name === 'string' ? section.name : ''
    if (name === '' || !droppedSections.has(name)) return true
    removedSections.push(name)
    return false
  })

  return { tools, sections, removedTools, removedSections }
}

/** 一组的体积统计（工具个数 + schema 的 UTF-8 字节数）。 */
export interface GateMeasurement {
  count: number
  bytes: number
}

/**
 * 渲染「哪些能力当前关着」的提示词段。
 *
 * 为什么需要：工具被挡在请求之外后，模型既看不见它们的 schema，也不知道
 * 「本来有、只是关着」。缺了这句话，模型会去调一个不存在的工具（拿
 * UNKNOWN_TOOL），或者更糟——声称自己已经点击/截图了。这段说明让它知道
 * 该请求用户开开关，而不是编。
 *
 * 全部开启时返回 null（不往请求里加任何字）。
 */
export function offlineNotice(
  groups: readonly GateGroup[],
  enabled: (key: string) => boolean,
): GatePromptSection | null {
  const off = groups.filter((group) => !enabled(group.key))
  if (off.length === 0) return null
  const items = off.map((group) => `- ${group.label}（工具名前缀 \`${group.prefixes[0]}\`）：用 \`/${group.key} on\` 打开，或让用户说「开启${group.label}」`).join('\n')
  return {
    name: 'tools-gate:offline',
    text: [
      '本会话的以下工具组当前**未注入**（按需开关，默认关闭，以节省上下文）：',
      items,
      '不要假装调用了这些能力。需要时先请用户用上面的 `/` 命令开启（或直接调用 slash 命令开关），开启后下一步请求即可使用。',
    ].join('\n'),
  }
}

/** 统计某组在给定 schema 列表里的工具个数与字节数。 */
export function measureGroup(
  schemas: readonly GateToolSchema[],
  group: GateGroup,
  groups: readonly GateGroup[] = DEFAULT_GATE_GROUPS,
): GateMeasurement {
  let count = 0
  let bytes = 0
  for (const schema of schemas) {
    if (groupOfTool(schema.name, groups)?.key !== group.key) continue
    count += 1
    bytes += utf8Bytes(JSON.stringify(schema))
  }
  return { count, bytes }
}

/** JSON 字符串的 UTF-8 字节数（不依赖 Buffer/TextEncoder 的浏览器差异）。 */
function utf8Bytes(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

/** 按 3.5 字节/token 粗估（与实测口径一致，只用于给用户一个量级）。 */
function estimateTokens(bytes: number): number {
  return Math.round(bytes / 3.5)
}

/** 每个 agent 的开关状态。用 WeakMap：agent 销毁即回收，无需监听 disposed。 */
const agentStates = new WeakMap<object, Record<string, boolean>>()

/** 读一个 agent 的状态表（懒建）。 */
function stateOf(agent: unknown, groups: readonly GateGroup[]): Record<string, boolean> {
  if (typeof agent !== 'object' || agent === null) return {}
  let state = agentStates.get(agent)
  if (state === undefined) {
    state = {}
    for (const group of groups) state[group.key] = false
    agentStates.set(agent, state)
  }
  return state
}

/** 命令语法：官方 `parseCommand` 的规则（小写开头，可含数字/`-`/`_`）。 */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

/** 渲染一条命令的用法。 */
function usage(group: GateGroup): string {
  return `用法：/${group.key} [on|off|status]（不带参数 = 切换）`
}

/**
 * 装配工具闸门。在 host 的 apply 同步路径上调用一次即可。
 *
 * @param ctx host 上下文（logger/commands/tools 三者按需）。
 * @param config toolsGate 配置段。
 * @returns 句柄：`status(sessionId)` 供路由/诊断读取当前开关。
 */
export function applyToolsGate(ctx: GateHostContext, config: GateConfig = {}): GateHandle {
  const groups = normalizeGroups(config.groups)
  const defaultEnabled = new Set(config.defaultEnabled ?? [])

  /** 读某会话的全部组状态（enabled 已并入部署默认值）。 */
  const status = (sessionId: string): GateGroupStatus[] => {
    const agent = agentOf(ctx, sessionId)
    const state = stateOf(agent, groups)
    return groups.map((group) => statusOf(ctx, group, groups, agent, state[group.key] === true || defaultEnabled.has(group.key)))
  }

  /** 写某会话的一组开关（客户端胶囊与命令共用同一张状态表）。 */
  const setEnabled = (sessionId: string, key: string, enabled: boolean): boolean => {
    const agent = agentOf(ctx, sessionId)
    if (agent === undefined || agent === null) return false
    if (!groups.some((group) => group.key === key)) return false
    stateOf(agent, groups)[key] = enabled
    return true
  }

  // ── 1. 组装出口过滤：默认关，`/指令` 打开 ──────────────────────────────
  // agent 缺失（服务级组装，例如标题生成）时原样放行：宁可多占也不误伤
  // 非会话请求的组装语义（官方 browser-use runtime 对无 agent 的组装同样放行）。
  if (typeof ctx.on !== 'function') {
    ctx.logger?.warn?.('[tools-gate] ctx.on unavailable: tool gating is inert')
  } else {
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      const result = await next()
      const agent = context?.agent
      if (agent === undefined || agent === null) return result
      const state = stateOf(agent, groups)
      const isOn = (key: string): boolean => state[key] === true || defaultEnabled.has(key)
      const projection = projectGate(result, isOn, groups)
      if (projection.removedTools.length === 0 && projection.removedSections.length === 0) return result
      // 追加一条「工具被关了」的说明：否则模型会去调看不见的工具（收
      // UNKNOWN_TOOL），或者更糟——假装自己点过了。放在末尾，不影响既有前缀。
      const notice = offlineNotice(groups, isOn)
      return {
        ...result,
        tools: projection.tools,
        sections: notice === null ? projection.sections : [...projection.sections, notice],
      }
    })
  }

  // ── 2. `/` 命令：按会话切换 ────────────────────────────────────────────
  // 服务面可能不完整（裸组合 / 测试桩）：缺 commands 时只丢命令，闸门本身照常。
  // 延迟注入回调里抛错会从 apply 冒出去，把同插件后面所有 inject 一起中断
  // （triad 工作台全不挂）—— 所以这里必须自查而不是等 TypeError。
  ctx.inject(['commands'], (commandCtx: never) => {
    const commands = (commandCtx as unknown as { commands?: GateCommands }).commands
    if (commands === undefined || typeof commands.register !== 'function') {
      ctx.logger?.warn?.('[tools-gate] commands service unavailable: /commands skipped')
      return
    }
    for (const group of groups) {
      if (!COMMAND_NAME.test(group.key)) {
        ctx.logger?.warn?.(`[tools-gate] skip group "${group.key}": not a valid command name`)
        continue
      }
      commands.register({
        name: group.key,
        description: group.description,
        // 必须声明 `input`：官方 ui-commands 的 matchEnter 里，**不带** input 的
        // 宿主命令只认裸 token（`/computer-use`），一旦带参数（`/computer-use off`）
        // 就直接 `return undefined` —— 命令行被静默降级成普通提示词发给模型。
        // 那是比多按一次回车严重得多的失败：用户以为关掉了，实际只是对着模型
        // 说了一句话，工具照样关着。
        //
        // 代价（已实测确认）：裸敲 `/computer-use` + 回车会进入 leadingInput
        // 认领态（草稿留下 `/computer-use ` 与 hint），需再回车一次（空参数 =
        // toggle）或直接输入 on/off/status。`/computer-use on` 这类带参写法
        // 一次回车即可。两害相权，取不静默降级。
        input: { hint: '[on|off|status]' },
        handler: (invocation) => runGateCommand(ctx, groups, group, invocation, defaultEnabled),
      })
    }
    ctx.logger?.info?.(`[tools-gate] commands ready: ${groups.map((g) => `/${g.key}`).join(', ')} (default off)`)
  })

  // ── 3. 状态路由：输入栏胶囊读/写同一张状态表 ───────────────────────────
  // 与 /指令 是同一份 state，不存在两套真相：胶囊点开关 == 敲 /xxx on|off。
  ctx.inject(['webServer'], (webCtx: never) => {
    const webServer = (webCtx as unknown as { webServer?: GateWebServer }).webServer
    if (webServer === undefined || typeof webServer.register !== 'function') {
      ctx.logger?.warn?.('[tools-gate] webServer unavailable: status route skipped')
      return
    }
    webServer.register({
      kind: 'exact',
      path: GATE_ROUTE,
      handler: (req: never, res: never) => handleGateRoute(req, res, status, setEnabled, groups),
    })
  })

  return { status, setEnabled, groups }
}

/** 闸门状态路由（GET 读 / POST 写）。 */
export const GATE_ROUTE = '/api/chat-flow/tools-gate'

/** 读请求体（限 64KB，只接受 JSON 对象）。 */
function readJsonBody(req: {
  on: (event: string, listener: (chunk?: never) => void) => void
  destroy?: () => void
}): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: string[] = []
    let size = 0
    let settled = false
    const done = (value: Record<string, unknown>): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk?: never) => {
      const text = String(chunk ?? '')
      size += text.length
      if (size > 65536) {
        req.destroy?.()
        done({})
        return
      }
      chunks.push(text)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        done({})
        return
      }
      try {
        const parsed = JSON.parse(chunks.join('')) as unknown
        done(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {})
      } catch {
        done({})
      }
    })
    req.on('error', () => done({}))
  })
}

/**
 * 处理一次状态请求。
 *
 * GET  `?session=<id>`                        → 该会话全部组的状态
 * POST `{ session, key, enabled }`            → 切换一组并返回新状态
 *
 * 一律 200 + `{ ok }`：闸门是可选能力，路由失败不该在 UI 上变成红色报错。
 */
function handleGateRoute(
  req: never,
  res: never,
  status: (sessionId: string) => GateGroupStatus[],
  setEnabled: (sessionId: string, key: string, enabled: boolean) => boolean,
  groups: readonly GateGroup[],
): void {
  const request = req as unknown as {
    method?: string
    url?: string
    on: (event: string, listener: (chunk?: never) => void) => void
    destroy?: () => void
  }
  const response = res as unknown as {
    writeHead: (code: number, headers: Record<string, string>) => void
    end: (body: string) => void
  }
  const json = (payload: Record<string, unknown>): void => {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(payload))
  }
  const parseSession = (raw: string | null): string => (raw === null ? '' : raw.trim())

  try {
    if (request.method === 'POST') {
      void readJsonBody(request).then((body) => {
        const sessionId = typeof body.session === 'string' ? body.session : ''
        const key = typeof body.key === 'string' ? body.key : ''
        const enabled = body.enabled === true
        if (!setEnabled(sessionId, key, enabled)) {
          json({ ok: false, error: 'unknown session or group', groups: [] })
          return
        }
        json({ ok: true, groups: status(sessionId) })
      })
      return
    }
    const url = new URL(request.url ?? GATE_ROUTE, 'http://x')
    const sessionId = parseSession(url.searchParams.get('session'))
    json({ ok: true, groups: status(sessionId), keys: groups.map((group) => group.key) })
  } catch {
    json({ ok: false, error: 'internal error', groups: [] })
  }
}

/** 闸门句柄。 */
export interface GateHandle {
  /** 某会话当前的全部组状态。 */
  status(sessionId: string): GateGroupStatus[]
  /** 写某会话的一组开关；会话或组未知时返回 false。 */
  setEnabled(sessionId: string, key: string, enabled: boolean): boolean
  /** 生效的分组表。 */
  groups: readonly GateGroup[]
}

/** 校验并归一化分组表（空表时回落到默认）。 */
function normalizeGroups(input: readonly GateGroup[] | undefined): readonly GateGroup[] {
  if (input === undefined || input.length === 0) return DEFAULT_GATE_GROUPS
  return input.filter((group) => typeof group?.key === 'string' && group.key !== '' && Array.isArray(group.prefixes))
}

/** 一组对客户端暴露的状态。 */
export interface GateGroupStatus {
  key: string
  label: string
  enabled: boolean
  count: number
  bytes: number
}

/**
 * 按 session id 解析实时 agent。
 *
 * 闸门状态挂在 agent 对象上（WeakMap），客户端只有 session id，所以状态路由
 * 必须走 `ctx.agents.get(id)` 换回对象。`ctx.agents` 可能尚未就绪（无
 * agent-loop 的裸组合），此时返回 undefined，路由如实报 unavailable。
 */
function agentOf(ctx: GateHostContext, sessionId: string): unknown {
  if (sessionId === '') return undefined
  try {
    const agents = ctx.get?.('agents') as { get?: (id: string) => unknown } | undefined
    return agents?.get?.(sessionId)
  } catch {
    return undefined
  }
}

/** 一组对客户端的状态（含体积统计）。 */
function statusOf(
  ctx: GateHostContext,
  group: GateGroup,
  groups: readonly GateGroup[],
  agent: unknown,
  enabled: boolean,
): GateGroupStatus {
  const measurement = groupMeasurement(ctx, group, groups, agent)
  return {
    key: group.key,
    label: group.label,
    enabled,
    count: measurement?.count ?? 0,
    bytes: measurement?.bytes ?? 0,
  }
}

/** 统计一组当前的工具个数与体积（工具注册表不可用时返回 null）。 */
function groupMeasurement(ctx: GateHostContext, group: GateGroup, groups: readonly GateGroup[], agent: unknown): GateMeasurement | null {
  try {
    const tools = ctx.get?.('tools') as GateTools | undefined
    const schemas = tools?.schemas?.(agent)
    if (schemas === undefined) return null
    return measureGroup(schemas, group, groups)
  } catch {
    return null
  }
}

/** 渲染当前状态（`status` 与切换后的回执共用）。 */
function renderState(
  ctx: GateHostContext,
  group: GateGroup,
  groups: readonly GateGroup[],
  agent: unknown,
  enabled: boolean,
  switched: boolean,
): GateCommandResult {
  const measurement = groupMeasurement(ctx, group, groups, agent)
  const countText = measurement === null || measurement.count === 0 ? '该组工具' : `${measurement.count} 个${group.label}工具`
  const tokenText = measurement === null || measurement.bytes === 0 ? '' : `（约 ${estimateTokens(measurement.bytes).toLocaleString('en-US')} tok）`
  const lines: string[] = []
  if (switched) lines.push(enabled ? `✅ ${group.label} 已启用` : `⛔ ${group.label} 已关闭`)
  else lines.push(`${enabled ? '✅' : '⛔'} ${group.label}：${enabled ? '已启用' : '已关闭'}`)
  if (enabled) {
    lines.push(`${countText}${tokenText} 将从本会话下一步请求开始注入。`)
    lines.push(`关闭：/${group.key} off`)
  } else {
    lines.push(`${countText}${tokenText} 已从本会话请求中移除，不再占用上下文。`)
    lines.push(`开启：/${group.key} on`)
  }
  return { kind: 'success', text: lines.join('\n') }
}

/** 一条闸门命令的完整处理：toggle / on / off / status。 */
function runGateCommand(
  ctx: GateHostContext,
  groups: readonly GateGroup[],
  group: GateGroup,
  invocation: GateCommandInvocation,
  defaultEnabled: ReadonlySet<string>,
): GateCommandResult {
  const verb = String(invocation?.rawInput ?? '').trim().toLowerCase()
  const state = stateOf(invocation?.agent, groups)
  const current = state[group.key] === true || defaultEnabled.has(group.key)

  if (verb === 'status' || verb === 'list' || verb === 'show') {
    return renderState(ctx, group, groups, invocation?.agent, current, false)
  }

  let next: boolean
  if (verb === '') next = !current
  else if (verb === 'on' || verb === 'enable' || verb === 'true' || verb === '1') next = true
  else if (verb === 'off' || verb === 'disable' || verb === 'false' || verb === '0') next = false
  else return { kind: 'error', text: `${verb} 不是有效取值。${usage(group)}` }

  state[group.key] = next
  return renderState(ctx, group, groups, invocation?.agent, next, true)
}

/** 测试面（smoke 直接断言纯函数与状态机，不依赖真实 cordis）。 */
export const __test = {
  projectGate,
  groupOfTool,
  measureGroup,
  renderState,
  runGateCommand,
  usage,
  utf8Bytes,
  estimateTokens,
  normalizeGroups,
  handleGateRoute,
  offlineNotice,
  GATE_ROUTE,
  DEFAULT_GATE_GROUPS,
}
