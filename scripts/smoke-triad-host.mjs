/**
 * dsh-chat-plus — 融合工作台（原 dsh-triad）host 半身 smoke。
 *
 * 直接 import 真正的 `lib/index.js`（@deepseek-ai/* 从 live DSH profile 解析），
 * 先校验 dsh-chat-plus 主插件契约，再跑 `apply(ctx)` 证明各工作台都挂上、路由
 * 与工具都注册，全程不碰真实 DSH 运行时。
 *
 * 与 dsh-triad 原版的差别：name 期望改为 dsh-chat-plus；inject 断言改为主插件
 * 的并集；桩 ctx 需要 inject 方法（主插件 apply 用 ctx.inject 延迟等 service）。
 * 定时自动化已删除（官方 schedule bundle 接管），本脚本断言旧路由与工具不再出现。
 *
 * Usage: node scripts/smoke-triad-host.mjs
 */

import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

// ── 1. import the plugin ─────────────────────────────────────────────────
// `@deepseek-ai/dsh-util-crypto` 只在已安装位置（profile 的 node_modules）能解析；
// 源码目录直接 import lib/index.js 会 ERR_MODULE_NOT_FOUND。所以这里优先从
// profile 安装位置加载，取不到再回退源码目录（那时只验证契约形状，路由与工具
// 断言会在第 3 步自然失败并报出来）。
const INSTALLED = resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', 'web', 'node_modules', 'dsh-chat-plus', 'lib', 'index.js')
const HOST_PATH = existsSync(INSTALLED) ? INSTALLED : resolve(ROOT, 'lib/index.js')
if (existsSync(INSTALLED)) pass(`loading host half from the installed profile: ${INSTALLED}`)
else console.log('info  installed copy not found; loading the source checkout build instead')

let mod
try {
  mod = await import(pathToFileURL(HOST_PATH).href)
  pass('lib/index.js imported (@deepseek-ai/* resolved from the live profile)')
} catch (error) {
  fail(`cannot import lib/index.js: ${error?.stack ?? error}`)
  process.exit(process.exitCode ?? 1)
}

// ── 2. Cordis plugin contract ────────────────────────────────────────────
if (mod.name !== 'dsh-chat-plus') fail(`expected name "dsh-chat-plus", got ${JSON.stringify(mod.name)}`)
else pass(`name = ${JSON.stringify(mod.name)}`)

// host 半身不导出顶层 `inject`：本插件的 host 用 `ctx.inject([...], cb)` 延迟等
// service 就绪（未声明的属性一读就抛，会把整棵插件树 boot 失败），工作台需要的
// 七个 service 全部由 apply 内部按需取。client 半身才导出 inject（并集）。
if (mod.inject !== undefined && !Array.isArray(mod.inject)) {
  fail(`inject, when present, must be an array; got ${typeof mod.inject}`)
} else if (mod.inject === undefined) {
  pass('host defers every service via ctx.inject() (no top-level inject export)')
} else {
  pass(`inject = [${mod.inject.join(', ')}]`)
  const REQUIRED_SERVICES = [
    'webServer', 'tools', 'credentials', 'sessions', 'sessionPersistence', 'settings', 'llm',
  ]
  for (const svc of REQUIRED_SERVICES) {
    if (!mod.inject.includes(svc)) fail(`inject is missing required service "${svc}"`)
  }
  pass('inject covers every service the four workbenches reach for (chat-plus ∪ triad)')
}

if (typeof mod.apply !== 'function') fail('apply is not a function')
else pass('apply is a function')

// ── 3. run apply() against a stub host context ───────────────────────────
const routes = new Map()
const listeners = new Map()
const tools = []
const logs = []
const injectNamesSeen = []

const ctx = {
  logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), debug: () => {} },
  webServer: {
    register(route) {
      if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  tools: {
    register(definition) {
      if (typeof definition.name !== 'string') throw new Error('tool without name')
      tools.push(definition.name)
      return () => { const i = tools.indexOf(definition.name); if (i >= 0) tools.splice(i, 1) }
    },
    /**
     * 全局视图只给 patch 里 insert 的 mcp-client 工具；带 agent 参数时返回该
     * 会话作用域注册的工具（官方 browser-use 的 playwright-mcp 走这条）。
     * mcp-status 的枚举口径就靠这个桩区分「全局 vs 会话级」。
     */
    schemas: (agent) => (agent === undefined
      ? [{ name: 'mcp__github__get_me', description: 'global github tool' }]
      : [{ name: 'mcp__playwright-mcp__browser_navigate', description: 'session browser tool' }]),
  },
  on: (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return () => {}
  },
  get: (name) => ctx[name],
  // 会话级 MCP 的挂载主体：mcp-status 会用 ctx.get('agents').list() 逐个取
  // scoped 工具视图（官方 browser-use 把 playwright-mcp 挂在 Agent scope 里）。
  agents: { list: () => [{ id: 'agent-under-test' }] },
  effect: (fn) => { fn?.(); return () => {} },
  settings: { get: () => ({ providers: {} }), register: () => () => {} },
  credentials: {},
  sessions: {},
  sessionPersistence: {},
  llm: {},
  // 主插件 apply 用 ctx.inject 延迟等 service 就绪；桩要真的把回调跑起来，
  // 否则工作台一次都不挂载，下面的路由断言全 false。
  //
  // scope 必须是「ctx 的超集 + effect」：工作台的模块一進去就调
  // `webCtx.effect(fn, 'dsh-memory: routes')` 做资源回收登记，scope 里少了
  // effect 会 TypeError，而且这个异常会从 apply 里冒出去，把后面所有
  // ctx.inject 全部中断（表现为 routes/tools/listeners 全 0）。
  inject: (names, fn) => {
    injectNamesSeen.push([...names])
    const scope = {
      ...ctx,
      effect: (dispose, label) => { void label; const d = typeof dispose === 'function' ? dispose() : undefined; return typeof d === 'function' ? d : () => {} },
      // 模块内部还会再 inject 一次（如 automation/models.ts 等
      // modelDirectories/sessions），这里递归放行，否则第一个嵌套 inject 就炸。
      inject: (innerNames, innerFn) => {
        if (Array.isArray(innerNames)) injectNamesSeen.push([...innerNames])
        innerFn?.(scope)
      },
    }
    for (const name of names) if (scope[name] === undefined) scope[name] = ctx[name]
    fn?.(scope)
  },
}

// 注意：`applyTriadHost` 是 async（usage host 与 skill-toggles 都 await），而主插件
// 的 `ctx.inject([...], cb)` 回调是同步的、不返回 promise。所以工作台里凡是被
// await 的挂载（usage/skills、skill-toggles、skill-health、mcp-*）在同步 apply 期间
// **根本没跑完**——routes 里看不到它们不是缺陷，是同步回调的固有语义。
//
// 等待方式必须是**真实时间**的轮询，不能只等一个 setImmediate（微任务拍）：
// 那些挂载里有真的 await（读文件、读注册表），一个微任务拍回来时它们只走到
// 第一个 await 就停了，于是下面 7 组路由断言会全部误报 FAIL（实测：同一个
// bundle 等 400ms 后全部挂上）。这里轮询到 /api/dsh-memory 出现为止，最多 3s。
try {
  // 显式传 mail.enabled=true：邮箱总开关是**用户运行时偏好**（面板设置页会把它
  // 写进 ~/.dsh/mail/dsh-mail/store/config.json），一旦用户关掉，下面的
  // 「11 个 mail_* 工具都注册」断言就会跟着失败 —— 那是配置生效的正确行为，
  // 不是缺陷。冒烟测的是「插件能不能把工具挂上」，所以这里把开关钉成 true，
  // 让结果只取决于代码本身，不取决于跑测试时用户恰好把开关拨到哪边。
  mod.apply(ctx, { mail: { enabled: true, injectEnabled: true, watchEnabled: false } })
  pass('apply(ctx) completed without throwing')
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && ![...routes.keys()].some((p) => p.startsWith('/api/dsh-memory'))) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  pass('deferred async mounts (memory/usage/skills/toggles/mcp) settled')
} catch (error) {
  fail(`apply(ctx) threw: ${error?.stack ?? error}`)
}

// ── 4. what actually got mounted ─────────────────────────────────────────
const paths = [...routes.keys()].sort()
console.log(`\n  routes (${paths.length}):`)
for (const p of paths) console.log(`    ${p}`)

console.log(`\n  tools (${tools.length}):`)
for (const t of tools) console.log(`    ${t}`)

console.log(`\n  listeners (${listeners.size}): ${[...listeners.keys()].join(', ')}`)

const need = (cond, msg) => (cond ? pass(msg) : fail(msg))
need(paths.some(p => p.startsWith('/api/dsh-memory')), 'memory routes registered (/api/dsh-memory/*)')
need(paths.some(p => p.startsWith('/api/usage-stats')), 'usage routes registered (/api/usage-stats/*)')
need(paths.some(p => p.startsWith('/api/skill-manager')), 'skill routes registered (/api/skill-manager/*)')
// 技能面板的开关与「Agent 预设」筛选条都打这条；漏了就全 404、面板顶部没有预设条。
need(paths.some(p => p.startsWith('/api/skill-toggles')), 'skill toggle routes registered (/api/skill-toggles/*)')
// 定时自动化已下线：官方 schedule bundle 接管，旧路由不得复活。
need(!paths.some(p => p.startsWith('/api/triad-automation')), 'automation routes gone (/api/triad-automation/* 未注册)')
// 融合后由本插件自己提供这些前缀（原 dsh-triad 的 client fetch 原样打过来）。
need(paths.some(p => p.startsWith('/api/skill-health')), 'skill-health route registered (/api/skill-health)')
need(paths.some(p => p.startsWith('/api/mcp-recommended')), 'mcp recommended route registered (/api/mcp-recommended)')
need(paths.some(p => p.startsWith('/api/triad/mcp-status')), 'mcp status route registered (/api/triad/mcp-status)')
// 多媒体画廊（跨会话产出物索引）：prefix /api/triad/gallery（media / raw / raw-asset）。
need(paths.some(p => p.startsWith('/api/triad/gallery')), 'media gallery route registered (/api/triad/gallery/*)')
// 本插件自己的两条 host 路由（截图 / download 进度）不能因融合丢掉。
need(paths.some(p => p.startsWith('/api/chat-flow/screenshot')), 'chat-plus screenshot routes still registered')
need(paths.some(p => p.startsWith('/api/chat-flow/download')), 'chat-plus download progress route still registered')
need(paths.some(p => p.startsWith('/api/chat-flow/generated-images')), 'chat-plus generated-images route still registered')
need(tools.includes('download'), 'chat-plus download tool still registered')
need(!tools.includes('automation'), 'automation tool gone (官方 schedule_* 工具接管)')
need(tools.includes('memory_search') && tools.includes('memory_remember'), 'memory tools registered')
// 记忆第四层「灵魂（Soul）」：路由与工具都挂在记忆模块内（不另开工作台 Tab）。
// 这条断言防的是「soul 模块被 try/catch 静默吞掉」——记忆引擎照常工作，
// 只有灵魂面板整块 404，没有断言就只能在用户点开面板时才发现。
need(paths.some(p => p.startsWith('/api/dsh-memory/soul')), 'soul routes registered (/api/dsh-memory/soul)')
need(tools.includes('soul_show') && tools.includes('soul_set'), 'soul tools registered (soul_show / soul_set)')
// 灵魂卡片化（2026-10-05）：卡片是灵魂的权威层（soul.md 是它的全文投影）。
// 三个卡片工具漏注册 = 「模型能在对话里改人设」这条路径整块消失，而面板侧照常
// 可用——没有断言就只能等用户自己发现。
need(tools.includes('soul_cards') && tools.includes('soul_card_set') && tools.includes('soul_card_remove'),
  'soul card tools registered (soul_cards / soul_card_set / soul_card_remove)')
need(listeners.has('agent/pre-step'), 'agent/pre-step injection hooked')
need(listeners.has('session/event'), 'session/event capture hooked')
// 邮箱工具：11 个 mail_* 全注册（含验证码等待与附件下载）。
{
  const MAIL_TOOLS = [
    'mail_account', 'mail_list', 'mail_search', 'mail_read', 'mail_send', 'mail_reply',
    'mail_forward', 'mail_trash', 'mail_delete', 'mail_download_attachment', 'mail_wait_code',
  ]
  const missing = MAIL_TOOLS.filter(name => !tools.includes(name))
  need(missing.length === 0, `mail tools registered (${MAIL_TOOLS.length} 个${missing.length > 0 ? `，缺 ${missing.join(', ')}` : ''})`)
}
// CLI 英文报错必须翻成人话：这是「点永久删除却看到 Message does not exist or is
// not in trash」那类故障的可读性底线（原文照旧附在括号里，翻译不吞信息）。
{
  const humanize = mod.humanizeCliError
  const sample = typeof humanize === 'function' ? humanize('Message does not exist or is not in trash') : ''
  const unmapped = typeof humanize === 'function' ? humanize('totally unmapped english error') : ''
  need(typeof humanize === 'function' && /回收站/.test(sample), 'CLI 英文报错翻成人话（not in trash → 提示先移入回收站）')
  need(unmapped === 'totally unmapped english error', '未映射的报错保留原文（翻译不吞信息）')
}
// 路由零撞车：融合进来的 8 组前缀与本插件 /api/chat-flow/* 无交集。
need(![...routes.keys()].some(p => p.startsWith('/api/chat-flow/') && p.includes('dsh-memory')),
  'no route collision between chat-plus and the merged workbenches')

// ── MCP 状态口径：会话级 MCP 必须可见（本次修复的核心）─────────────────
// 回归背景：官方 browser-use 用 `mountSessionMcp` 把 mcp-client 挂在**每个 Agent
// 自己的 scope** 里，工具只在 `ctx.tools.schemas(agent)` 下可见。旧实现只扫全局
// 视图 `ctx.tools.schemas()`，于是「DSH 自己开的浏览器 MCP（playwright-mcp）」在
// 面板里永远不显示 —— 用户报的正是这个。
{
  const route = routes.get('/api/triad/mcp-status')
  need(route !== undefined, 'mcp-status route reachable for the scoped-MCP assertion')
  if (route !== undefined) {
    const captured = { status: 0, body: null }
    const res = {
      writeHead: (status) => { captured.status = status },
      end: (body) => { try { captured.body = JSON.parse(body) } catch { captured.body = null } },
    }
    route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, url: '/api/triad/mcp-status' }, res)
    const body = captured.body
    const servers = Array.isArray(body?.servers) ? body.servers : []
    const names = servers.map((s) => s.serverName)
    need(captured.status === 200 && body !== null, 'mcp-status answers 200 JSON on loopback')
    need(names.includes('github'), 'global (patch-inserted) MCP server listed: github')
    need(names.includes('playwright-mcp'), 'session-scoped MCP server listed: playwright-mcp（浏览器 MCP 不再漏显示）')
    const playwright = servers.find((s) => s.serverName === 'playwright-mcp')
    need(playwright?.scope === 'session', 'session-scoped server is tagged scope="session"')
    need(playwright?.config?.editable === false, 'session-scoped server is read-only (无开关/删除)')
    const github = servers.find((s) => s.serverName === 'github')
    need(github?.scope === 'global', 'global server stays scope="global"')
    need(body?.toolCount === 2, `toolCount counts both scopes (got ${body?.toolCount})`)
  }
}

const warns = logs.filter(([lvl]) => lvl === 'warn')
if (warns.length > 0) {
  console.log('\n  warnings during apply:')
  for (const [, m] of warns) console.log(`    ${m}`)
}

// apply 内部按需取的 service（工作台 + 本插件自己的截图/下载）。
const union = new Set(injectNamesSeen.flat())
for (const svc of ['webServer', 'tools', 'credentials', 'sessions', 'sessionPersistence', 'settings', 'llm']) {
  need(union.has(svc), `apply defers service "${svc}" via ctx.inject (four-workbench ∪ chat-plus)`)
}
console.log(`\n  inject names seen by apply: ${JSON.stringify(injectNamesSeen)}`)

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${HOST_PATH}`)
process.exit(process.exitCode ?? 0)
