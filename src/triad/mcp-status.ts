/**
 * mcp-config — 真实 MCP Server 状态 + 启用/禁用/删除（host 半身）。
 *
 * GET  /api/triad/mcp-status  只读：注册工具 ∪ 配置文件
 *                             （~/.dsh/profiles/web/cordis.patch.yml 的
 *                             mcp-client 条目，含 disabled 标记）。
 *                             工具来源有两个视图，缺一不可：
 *                               - 全局层 ctx.tools.schemas()：patch 里 insert
 *                                 的 mcp-client（github / browseros 等）；
 *                               - 各 Agent 的 scoped 视图
 *                                 ctx.tools.schemas(agent)：官方 browser-use
 *                                 用 mountSessionMcp 挂在**会话作用域**里的
 *                                 mcp-client（serverName=playwright-mcp）。
 *                                 全局视图看不到 scoped 注册——这正是「DSH 自己
 *                                 开的浏览器 MCP 不显示」的根因。
 *                             带会话来源的 server 回传 scope:'session'，客户端
 *                             据此标注「会话级」并只读展示（开关/删除作用于
 *                             cordis.patch.yml，对会话级 MCP 无意义）。
 * POST /api/triad/mcp-config  写：三种动作（默认 toggle 兼容旧客户端）：
 *                             - 无 action → disabled=true/false 标记（禁用/启用）；
 *                             - action: remove → 删除该 mcp-client 整个条目
 *                               （连同所属单条目 insert 容器，保留上方注释）。
 *                             文本级编辑，保留注释与其余行；改前自动备份到
 *                             cordis.patch.yml.bak-last-toggle。web profile 为
 *                             patchReload: live，写完后 DSH 热重载配置：
 *                             禁用→工具立即注销，启用→重新注册，删除→条目消失。
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { loopbackAllowed, writeJsonResponse } from './mcp-recommended.ts'

const STATUS_ROUTE = '/api/triad/mcp-status'
const CONFIG_ROUTE = '/api/triad/mcp-config'
const MCP_CLIENT_PKG = '@deepseek-ai/dsh-mcp-client'
const PROFILE_NAME = 'web'
/** 备份文件名（固定名，覆盖式；保留最近一次切换前的版本）。 */
const BACKUP_SUFFIX = '.bak-last-toggle'

function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  return fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv.trim() : join(homedir(), '.dsh')
}

/** 面板管理的补丁文件：默认 web profile 的 cordis.patch.yml。 */
function patchFilePath(): string {
  return join(dshHome(), 'profiles', PROFILE_NAME, 'cordis.patch.yml')
}

interface PatchMcpEntry {
  /** 文件中的条目 id（编辑定位用）。 */
  entryId: string
  serverName: string
  disabled: boolean
  /** streamable-http 端点（存在即远程服务型，watchdog 候选）。 */
  url: string
  /** 行号（文件行索引，编辑用）。 */
  idLine: number
  nameLine: number
  serverNameLine: number
  disabledLine: number
}

/**
 * 扫描补丁文件中所有 `@deepseek-ai/dsh-mcp-client` 条目。
 * 逐行解析：`- id:` 开头的条目，后续数行内找 name 行与 serverName 行。
 */
function scanPatchEntries(content: string): PatchMcpEntry[] {
  const lines = content.split(/\r?\n/)
  const entries: PatchMcpEntry[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trimStart()
    if (!trimmed.startsWith('- id:')) continue
    const idMatch = /^- id:\s*([A-Za-z0-9_-]+)/.exec(trimmed)
    if (idMatch === null) continue
    const idLine = i
    let nameLine = -1
    let serverNameLine = -1
    let serverName = ''
    let entryUrl = ''
    for (let j = i + 1; j < lines.length && j <= i + 10; j += 1) {
      const line = lines[j].trimStart()
      if (line.startsWith('- ')) break
      if (nameLine === -1 && line.startsWith('name:') && line.includes(MCP_CLIENT_PKG)) nameLine = j
      if (nameLine !== -1 && serverNameLine === -1 && line.startsWith('serverName:')) {
        const m = /^serverName:\s*([A-Za-z0-9_-]+)/.exec(line)
        if (m !== null) {
          serverNameLine = j
          serverName = m[1]
        }
      }
      if (nameLine !== -1 && entryUrl === '' && line.startsWith('url:')) {
        const m = /^url:\s*(.+?)\s*$/.exec(line)
        if (m !== null) entryUrl = m[1]
      }
    }
    if (nameLine === -1 || serverNameLine === -1) continue
    let disabledLine = -1
    for (let j = i + 1; j < lines.length && j <= i + 10; j += 1) {
      const line = lines[j].trimStart()
      if (line.startsWith('- ')) break
      if (line.startsWith('disabled:')) { disabledLine = j; break }
    }
    entries.push({ entryId: idMatch[1], serverName, disabled: disabledLine >= 0, url: entryUrl, idLine, nameLine, serverNameLine, disabledLine })
  }
  return entries
}

function defaultLineEnding(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

/** 编辑条目：disabled=true 在 name 行后插入 disabled 行，false 删除既有行（保留注释）。 */
function applyToggle(content: string, entry: PatchMcpEntry, disabled: boolean): string {
  const eol = defaultLineEnding(content)
  const lines = content.split(/\r?\n/)
  if (entry.disabled === disabled) return content
  if (disabled) {
    const indent = /^\s*/.exec(lines[entry.nameLine])?.[0] ?? '      '
    lines.splice(entry.nameLine + 1, 0, `${indent}disabled: true`)
  } else if (entry.disabledLine >= 0) {
    lines.splice(entry.disabledLine, 1)
  }
  return lines.join(eol)
}

function readPatchContent(): string {
  const path = patchFilePath()
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

/** 工具条目（面板只回传名称与描述）。 */
interface McpToolEntry {
  name: string
  description: string
}

/** 把一个 schema 列表里 `mcp__<server>__<tool>` 的工具按 server 归组（同名工具去重）。 */
function groupMcpTools(
  schemas: ReadonlyArray<{ name?: unknown; description?: unknown }>,
  into: Map<string, McpToolEntry[]>,
): void {
  for (const schema of schemas) {
    if (typeof schema.name !== 'string' || !schema.name.startsWith('mcp__')) continue
    const rest = schema.name.slice('mcp__'.length)
    const sep = rest.indexOf('__')
    if (sep <= 0) continue
    const serverName = rest.slice(0, sep)
    const tool: McpToolEntry = {
      name: schema.name,
      description: typeof schema.description === 'string' ? schema.description : '',
    }
    const list = into.get(serverName)
    if (list === undefined) into.set(serverName, [tool])
    else if (!list.some((item) => item.name === tool.name)) list.push(tool)
  }
}

/**
 * 当前存活的 Agent 列表（会话作用域 MCP 的挂载主体）。
 *
 * 官方 browser-use 这类提供方用 `mountSessionMcp` 把 mcp-client 挂在**每个
 * Agent 自己的 scope** 里（工具仅在 `ctx.tools.schemas(agent)` 下可见），所以要
 * 列出「DSH 自己开的浏览器 MCP」必须逐个 Agent 取一次 scoped 视图。
 *
 * `agents` 不在本插件的 inject 之列，因此用 `ctx.get` 探测而不是属性访问
 * （属性访问在未 inject 时直接抛错）：服务缺失/尚未就绪时返回空数组，面板
 * 退化为「仅全局视图」，不会连累其余数据源。
 */
function liveAgents(ctx: Context): unknown[] {
  try {
    const registry = ctx.get('agents') as { list?: () => unknown } | undefined
    const list = typeof registry?.list === 'function' ? registry.list() : undefined
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 只读：合并配置文件条目、全局注册工具与各会话 scoped 注册的工具。 */
function collectMcpStatus(ctx: Context): Record<string, unknown> {
  const path = patchFilePath()
  const content = readPatchContent()
  const patchEntries = content === '' ? [] : scanPatchEntries(content)

  /** 全局层注册的 mcp-client 工具（cordis.patch.yml 里的 insert 条目）。 */
  const globalGroups = new Map<string, McpToolEntry[]>()
  groupMcpTools(ctx.tools.schemas(), globalGroups)

  /**
   * 会话作用域注册的工具（browser-use 的 playwright-mcp 等）。
   *
   * 全局视图 `ctx.tools.schemas()`（无 scope = global 层）看不到它们——这是
   * 「DSH 自己开的浏览器 MCP 在面板里不显示」的根因，故补这一次带 Agent 的枚举。
   */
  const sessionGroups = new Map<string, McpToolEntry[]>()
  for (const agent of liveAgents(ctx)) {
    try {
      groupMcpTools(ctx.tools.schemas(agent as never), sessionGroups)
    } catch {
      /* 单个 Agent 取不到就跳过：不影响其余 Agent 与全局视图。 */
    }
  }

  /** 合并两个来源（同名工具只留一条），并记住该 server 是否来自会话作用域。 */
  const merged = new Map<string, { tools: McpToolEntry[]; sessionScoped: boolean }>()
  const absorb = (source: Map<string, McpToolEntry[]>, sessionScoped: boolean): void => {
    for (const [serverName, tools] of source) {
      const current = merged.get(serverName)
      if (current === undefined) {
        merged.set(serverName, { tools: [...tools], sessionScoped })
        continue
      }
      for (const tool of tools) {
        if (!current.tools.some((item) => item.name === tool.name)) current.tools.push(tool)
      }
      if (sessionScoped) current.sessionScoped = true
    }
  }
  absorb(globalGroups, false)
  absorb(sessionGroups, true)

  const seen = new Set<string>()
  const servers: Array<Record<string, unknown>> = []
  for (const entry of patchEntries) {
    seen.add(entry.serverName)
    const group = merged.get(entry.serverName)
    const tools = group?.tools ?? []
    const sessionScoped = group?.sessionScoped === true
    servers.push({
      serverName: entry.serverName,
      toolCount: tools.length,
      tools,
      scope: sessionScoped ? 'session' : 'global',
      // 开关/删除写的是 cordis.patch.yml；会话级 MCP 由提供方在运行时挂载，
      // 改配置既无效也无意义，一律置为只读。
      config: { entryId: sessionScoped ? null : entry.entryId, disabled: entry.disabled, editable: !sessionScoped },
    })
  }
  // 注册了工具但没有配置条目（会话级 MCP、手工改过文件等情况）：只读展示。
  for (const [serverName, group] of merged) {
    if (seen.has(serverName)) continue
    servers.push({
      serverName,
      toolCount: group.tools.length,
      tools: group.tools,
      scope: group.sessionScoped ? 'session' : 'global',
      config: { entryId: null, disabled: false, editable: false },
    })
  }
  servers.sort((a, b) => String(a.serverName).localeCompare(String(b.serverName)))
  return {
    at: new Date().toISOString(),
    serverCount: servers.length,
    toolCount: servers.reduce((sum, server) => sum + (server.toolCount as number), 0),
    patchFile: path,
    servers,
  }
}

/** 写：标记 disabled。成功返回新状态；失败返回 error（不改文件）。 */
function togglePatchEntry(serverName: string, disabled: boolean): { ok: boolean; error?: string; entryId?: string; disabled?: boolean } {
  const path = patchFilePath()
  const content = readPatchContent()
  if (content === '') return { ok: false, error: `patch file not found: ${path}` }
  const entries = scanPatchEntries(content)
  const entry = entries.find((item) => item.serverName === serverName)
  if (entry === undefined) return { ok: false, error: `no mcp-client entry for serverName "${serverName}" in ${path}` }
  const next = applyToggle(content, entry, disabled)
  if (next === content) return { ok: true, entryId: entry.entryId, disabled: entry.disabled }
  try {
    copyFileSync(path, `${path}${BACKUP_SUFFIX}`)
    writeFileSync(path, next, 'utf8')
  } catch (error) {
    return { ok: false, error: `write failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, entryId: entry.entryId, disabled }
}

/**
 * 写：从 patch 文件中删除指定 serverName 的完整 mcp-client 条目。
 *
 * 以 YAML 缩进界定块边界（避开注释归属问题）：
 *  - 条目块 = `- id:` 行 + 其下全部缩进行，到下一个 0 缩进行（注释/空行/下一
 *    顶层条目）或文件尾止；
 *  - 向上找最近一个 `- ` 行：是 `- insert:` 且其内只剩当前一条 → 连同该
 *    `- insert:` 整块（按同样缩进边界）删；是 `- id:` 或顶层 → 只删条目块；
 *  - 条目上方注释按本文件惯例保留（删项留注释存档），不并入删除范围。
 * 改前自动备份到 cordis.patch.yml.bak-last-toggle。
 */
function removePatchEntry(serverName: string): { ok: boolean; error?: string; entryId?: string } {
  const path = patchFilePath()
  const content = readPatchContent()
  if (content === '') return { ok: false, error: `patch file not found: ${path}` }
  const entries = scanPatchEntries(content)
  const entry = entries.find((item) => item.serverName === serverName)
  if (entry === undefined) return { ok: false, error: `no mcp-client entry for serverName "${serverName}" in ${path}` }
  const lines = content.split(/\r?\n/)
  /** 块尾：line 之后第一个 0 缩进行（注释/空行/下一个顶层条目）或文件尾。 */
  const blockEndOf = (line: number): number => {
    for (let j = line + 1; j < lines.length; j += 1) {
      const current = lines[j]
      if (current.length === 0) return j
      if (!/^[ \t]/.test(current)) return j
    }
    return lines.length
  }
  // 条目所属容器：向上最近的一个 `- ` 行（可能是 `- insert:`、同 insert 的前一条目，或顶层条目）。
  let insertLine = -1
  for (let k = entry.idLine - 1; k >= 0; k -= 1) {
    const trimmed = lines[k].trimStart()
    if (trimmed.startsWith('- ')) { insertLine = k; break }
  }
  let removeFrom = entry.idLine
  let removeTo = blockEndOf(entry.idLine)
  if (insertLine >= 0 && lines[insertLine].trimStart().startsWith('- insert:')) {
    let itemCount = 0
    for (let k = insertLine + 1; k < removeTo; k += 1) {
      if (lines[k].trimStart().startsWith('- id:')) itemCount += 1
    }
    // 该 insert 仅含此一条：连 `- insert:` 一起删，不留空容器。
    if (itemCount === 1) {
      removeFrom = insertLine
      removeTo = blockEndOf(insertLine)
    }
  }
  const next = lines.slice(0, removeFrom).concat(lines.slice(removeTo)).join(defaultLineEnding(content))
  try {
    copyFileSync(path, `${path}${BACKUP_SUFFIX}`)
    writeFileSync(path, next, 'utf8')
  } catch (error) {
    return { ok: false, error: `write failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, entryId: entry.entryId }
}

/* ── 自动守护（watchdog）：MCP 会话被服务端回收后自动重建，DSH 永不卡死 ──
 *
 * 原理：neo（claw-server）正常回收闲置 MCP 会话；回收后它的 REST
 * /api/v1/sessions 中该客户端（slug=dsh-mcp-client）的 status 由 live
 * 落为 done（sessions.rs: contract_status(task.status, live.is_some()),
 * 会话对象消失即非 live）。本守护每隔 WATCHDOG_INTERVAL_MS 探活一次：
 * 未发现 live 的 dsh-mcp-client 会话 → 对该 serverName 执行
 * disabled 切换（禁→启, 与面板开关同机制,HMR 重建拿新会话）。
 *
 * 防误伤：启动后宽限期不进圈；最近一次修复 90s 内不重复；每次探活失败
 * 只是跳过（neo 未运行时也无副作用, 因为条目未 enabled 时禁用切换而已）。
 */

const WATCHDOG_INTERVAL_MS = 60_000
const WATCHDOG_GRACE_MS = 150_000
const WATCHDOG_RETRY_GAP_MS = 90_000
const WATCHDOG_CLIENT_SLUG = 'dsh-mcp-client'

let watchdogStartedAt = 0
let watchdogLastHealAt = 0
let watchdogHealing = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** 探活一个远程 MCP 服务：其 REST sessions 里是否有本客户端 live 会话。 */
async function remoteSessionAlive(entryUrl: string): Promise<boolean | null> {
  const base = /^(https?:\/\/[^/]+)/.exec(entryUrl)?.[1]
  if (base === undefined) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(`${base}/api/v1/sessions`, { headers: { accept: 'application/json' }, signal: controller.signal })
      if (!response.ok) return null
      const body = await response.json() as { items?: Array<{ slug?: unknown; status?: unknown }> }
      if (!Array.isArray(body.items)) return null
      return body.items.some((item) => item.slug === WATCHDOG_CLIENT_SLUG && item.status === 'live')
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/** 一轮探活：收集远程型条目（streamable-http url 存在且未 disabled）。 */
async function watchdogTick(): Promise<void> {
  if (watchdogHealing) return
  const content = readPatchContent()
  if (content === '') return
  const entries = scanPatchEntries(content).filter((entry) => entry.url !== '' && !entry.disabled)
  for (const entry of entries) {
    const alive = await remoteSessionAlive(entry.url)
    if (alive !== null && !alive) {
      // 会话被回收 → 自动重连：禁→启（与面板开关同机制）。
      watchdogHealing = true
      try {
        const before = Date.now()
        if (before - watchdogLastHealAt < WATCHDOG_RETRY_GAP_MS) continue
        watchdogLastHealAt = before
        const disable = togglePatchEntry(entry.serverName, true)
        if (disable.ok) {
          await sleep(2500)
          togglePatchEntry(entry.serverName, false)
          console.log(`[dsh-triad] mcp watchdog: session for ${entry.serverName} reclaimed by server; reconnected (disabled toggle)`)
        }
      } finally {
        watchdogHealing = false
      }
    }
  }
}

/** 注册自动守护（周期探活;effect 清理时释放计时器）。 */
function startWatchdog(): () => void {
  watchdogStartedAt = Date.now()
  const timer = setInterval(() => {
    if (Date.now() - watchdogStartedAt < WATCHDOG_GRACE_MS) return
    void watchdogTick()
  }, WATCHDOG_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** 注册 GET /api/triad/mcp-status 与 POST /api/triad/mcp-config。 */
export function applyMcpStatus(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: STATUS_ROUTE,
    handler: (req: { socket: { remoteAddress?: string }; headers: { host?: string } }, res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }) => {
      if (!loopbackAllowed(req)) {
        writeJsonResponse(res, 403, { error: 'loopback-only' })
        return
      }
      writeJsonResponse(res, 200, collectMcpStatus(ctx))
    },
  }), 'dsh-mcp-status: routes')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: CONFIG_ROUTE,
    handler: (req: { socket: { remoteAddress?: string }; headers: { host?: string }; method?: string }, res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }) => {
      void (async () => {
        if (!loopbackAllowed(req)) {
          writeJsonResponse(res, 403, { error: 'loopback-only' })
          return
        }
        let body = ''
        for await (const chunk of req as unknown as AsyncIterable<Uint8Array>) {
          body += Buffer.from(chunk).toString('utf8')
        }
        let parsed: { serverName?: unknown; disabled?: unknown; action?: unknown }
        try {
          parsed = JSON.parse(body) as { serverName?: unknown; disabled?: unknown; action?: unknown }
        } catch {
          writeJsonResponse(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const serverName = typeof parsed.serverName === 'string' ? parsed.serverName : ''
        if (serverName === '') {
          writeJsonResponse(res, 400, { ok: false, error: 'serverName required' })
          return
        }
        const result = parsed.action === 'remove'
          ? removePatchEntry(serverName)
          : togglePatchEntry(serverName, parsed.disabled === true)
        writeJsonResponse(res, result.ok ? 200 : 400, result)
      })()
    },
  }), 'dsh-mcp-config: routes')

  // ── 自动守护：会话被服务端回收后自动重建（免重启 DSH）──────────
  ctx.effect(() => startWatchdog(), 'dsh-mcp-watchdog: interval')
}
