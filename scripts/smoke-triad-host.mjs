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
import { existsSync, readFileSync } from 'node:fs'
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
const commandsSeen = []

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
  // 工具闸门（src/tools-gate）的 `/computer-use`、`/browser-use` 走这个服务。
  // 桩给全，否则闸门会走「服务面不完整」的降级分支，这里的命令断言就没意义了。
  commands: { register: (definition) => { commandsSeen.push(definition.name); return () => {} } },
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
/*
 * PTC 沙箱子调用必须进画廊折叠（2026-10-05 回归）。
 *
 * 背景：模型在 run_code 代码体里 await tools.present({...}) 交付的文件**没有**
 * tool/call 与 tool/result 事件，只有一条 tool/ptc-dispatch。旧折叠只认前者，
 * 于是这些路径从未进过 /raw 的准入索引 —— 产出物卡能列出那一行，点开却 403
 * （用户报的「点图片加载不出来，点侧栏按钮却能加载」，侧栏走官方 workspaceFiles，
 * 与这条名单无关）。这里直接把两条通道喂同一份提取纯函数对拍：不修好，present
 * 交付的 png 提不出来。
 */
{
  const { extractFromPtcDispatch } = await import(pathToFileURL(resolve(ROOT, 'src/triad/gallery/extract.ts')).href)
  const dispatch = {
    type: 'tool/ptc-dispatch',
    time: 1_791_202_375_294,
    data: {
      rootCallId: 'call_root',
      subCallId: 'call_root:ptc:2',
      name: 'present',
      arguments: { files: [{ path: '深圳一日游_20261006/slide_01.png', description: '封面页预览' }] },
      isError: false,
      content: [{ type: 'text', text: 'Presented 深圳一日游_20261006/slide_01.png' }],
    },
  }
  const items = extractFromPtcDispatch(dispatch, { cwd: 'D:\\AI\\Dsh' })
  const hit = items.find((item) => item.kind === 'image')
  need(hit?.path === 'D:\\AI\\Dsh\\深圳一日游_20261006\\slide_01.png',
    'PTC sub-call (tool/ptc-dispatch) feeds the gallery index — present 交付的图片进得了 /raw 准入名单')
  need(extractFromPtcDispatch({ ...dispatch, data: { ...dispatch.data, isError: true } }, { cwd: 'D:\\AI\\Dsh' }).length === 0,
    'failed PTC sub-call yields no gallery item（失败调用不产出成品）')
}
/*
 * /raw 的路径准入必须按**会话 cwd** 解析相对路径（2026-10-05 回归）。
 *
 * 产出物卡把行里的路径原样交给 /raw，而 present 交付的常是相对路径
 * （`深圳一日游_20261006/slide_01.png`）。旧实现直接 resolve(raw)，相对路径落到
 * host 进程的 cwd（DSH 安装目录），永远不在索引里 → 403；侧栏那条路走官方
 * workspaceFiles（相对会话工作区解析）所以正常 —— 用户看到的就是「点图片裂了、
 * 点侧栏却能看」。
 */
{
  const { resolveAdmittedPath } = mod.galleryTest
  const cwd = 'D:\\AI\\Dsh'
  const context = {
    cwd,
    items: [{ path: cwd + '\\深圳一日游_20261006\\slide_01.png', name: 'slide_01.png', kind: 'image', source: 'file', time: 1 }],
  }
  need(typeof resolveAdmittedPath === 'function', 'gallery __test exposes resolveAdmittedPath')
  need(resolveAdmittedPath('深圳一日游_20261006/slide_01.png', null, context) === cwd + '\\深圳一日游_20261006\\slide_01.png',
    '/raw 准入：相对路径按**会话 cwd** 折绝对（点图片不再 403）')
  need(resolveAdmittedPath('D:\\AI\\Dsh\\深圳一日游_20261006\\slide_01.png', 'D:\\AI\\Dsh\\深圳一日游_20261006\\slide_01.png', context) !== null,
    '/raw 准入：绝对路径原样命中会话产出')
  need(resolveAdmittedPath('..\\..\\Windows\\win.ini', null, context) === null,
    '/raw 准入：会话没产出过的相对路径一律拒绝（自由路径仍然 403）')
  need(resolveAdmittedPath('深圳一日游_20261006/slide_01.png', null, { cwd: null, items: context.items }) === null,
    '/raw 准入：会话 cwd 未知时拒绝相对路径（绝不拿 host 进程 cwd 当基准）')
}
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
// 内置灵魂预设（2026-10-06：原「可爱风」换成「萝莉」，并新增御姐 / 女王 / 公主）。
// 预设是**代码常量**，某套被改坏、或某张卡被 normalizeCard 过滤掉（标题正文同时
// 为空）都不会抛错——只会在面板上静默少一行 / 少一张卡。这里直接钉住 router 返给
// 面板的同一份常量：id 顺序 + 四套角色人格各自的卡数与 style 卡。
{
  const presets = mod.BUILTIN_SOUL_PRESETS
  const expectedIds = [
    'builtin:engineer', 'builtin:analyst', 'builtin:writer', 'builtin:concise',
    'builtin:loli', 'builtin:oneesan', 'builtin:queen', 'builtin:princess',
  ]
  const ids = Array.isArray(presets) ? presets.map(preset => preset.id) : []
  need(ids.join(',') === expectedIds.join(','),
    `builtin soul presets = ${expectedIds.length} 套（4 工作形态 + 4 角色人格），实际 [${ids.join(', ')}]`)
  // 旧 id 必须真的消失：留着 builtin:cute 会让「萝莉」这套长期挂着 cute 的名字。
  need(!ids.includes('builtin:cute'), 'builtin:cute 已被 builtin:loli 取代（不留旧 id 混淆）')
  // 四套角色人格都是「可直接生效的完整人格」：5 张卡，且都有 style 卡落地说法，
  // 缺了 style 就只剩一张语气卡（语气是全套里最容易写、也最不生效的一层）。
  const PERSONAS = [
    ['builtin:loli', '萝莉'],
    ['builtin:oneesan', '御姐'],
    ['builtin:queen', '女王'],
    ['builtin:princess', '公主'],
  ]
  for (const [id, name] of PERSONAS) {
    const preset = typeof mod.builtinPreset === 'function' ? mod.builtinPreset(id) : null
    need(preset !== null && preset.name === name && preset.cards.length === 5,
      `${id}（${name}）是可整体套用的完整人格：5 张卡（identity/tone/principles/boundaries/style）`)
    need(preset !== null && preset.cards.some(card => card.kind === 'style' && card.body.trim() !== ''),
      `${id} 带 style（风格）卡：角色腔调靠它落地，缺了就只剩一张语气卡`)
    // 人设只改说法、不改事实：四套都必须显式写下「报错/事故/安全话题照直说」这条硬边界。
    // 少了它，模型很容易把「本王 / 本公主」那层气场带到故障通报里。
    need(preset !== null && preset.cards.some(card => card.kind === 'boundaries' && /报错|事故|安全/.test(card.body)),
      `${id} 的 boundaries 必须点明「报错 / 事故 / 安全话题照直说，不带人设腔」`)
  }
}
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

// ── HTML 卡片通道：路由 + 注入规范 + 配置项 ────────────────────────────
//
// 这条链路最容易「静默半通」：客户端渲染器在，host 侧却没接线（模型永远不知道
// 这个围栏存在），或者开关写进了 config 但读取端忘了带。三个点都要断言。
{
  const route = routes.get('/api/dsh-memory')
  need(route !== undefined, 'memory prefix route reachable for the html-channel assertion')
  if (route !== undefined) {
    // handler 是 `void handle(...)` 包出来的异步函数：必须等一拍再读 captured，
    // 同步读会永远看到 status 0（第一次写这条断言就踩了）。
    const call = async (method, url) => {
      const captured = { status: 0, body: null }
      const res = {
        writeHead: (status) => { captured.status = status },
        end: (payload) => { try { captured.body = JSON.parse(payload) } catch { captured.body = null } },
      }
      route.handler({ method, url, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } }, res)
      await new Promise((r) => setTimeout(r, 60))
      return captured
    }
    const got = await call('GET', '/api/dsh-memory/html-inject-state')
    need(got.status === 200, `GET /html-inject-state answers 200（实得 ${got.status}）`)
    need(typeof got.body?.enabled === 'boolean', 'html-inject-state returns a boolean enabled')
    // 默认开：这是「交付形态本身」，不注入模型就不会主动用（见 types.ts 字段注释）。
    need(got.body?.enabled === true, `html 通道默认开（实得 ${JSON.stringify(got.body)}）`)
    need(got.body?.builtin === true, 'html-inject-state is tagged builtin (无卸载入口)')
  }

  // 注入器里的规范文本必须真的存在且带齐沙箱事实——少一条模型就会写出白屏卡片。
  const injectSrc = readFileSync(resolve(ROOT, 'src/triad/memory/engine/inject.ts'), 'utf8')
  for (const [needle, why] of [
    ['HTML_INJECTION_RULE', '规范常量'],
    ['没有 same-origin', '沙箱隔离事实'],
    ['高度自适应', '高度上报事实'],
    ['不引外部资源', '离线可用事实'],
    ['80KB', '容量上限'],
    ['data-ds-dark-theme', '主题同步事实'],
  ]) {
    need(injectSrc.includes(needle), `HTML 注入规范必须写清「${why}」（缺 ${needle}）`)
  }
  need(/htmlStepCounters/.test(injectSrc) && /isHtmlInjectEnabled/.test(injectSrc),
    'html 通道有独立 step 计数器（不与其它通道抢首步名额）')

  // 配置项三处必须齐：类型、默认值、可调布尔键表。
  const typesSrc = readFileSync(resolve(ROOT, 'src/triad/memory/types.ts'), 'utf8')
  need(/htmlInjectDefaultEnabled: boolean/.test(typesSrc), 'MemoryConfig 声明 htmlInjectDefaultEnabled')
  need(/htmlInjectDefaultEnabled: true/.test(typesSrc), 'htmlInjectDefaultEnabled 默认 true')
  need(/CONFIG_BOOLEAN_KEYS[\s\S]{0,400}htmlInjectDefaultEnabled/.test(typesSrc),
    'htmlInjectDefaultEnabled 在 CONFIG_BOOLEAN_KEYS 里（否则面板/补丁写不进去）')
  const storeSrc = readFileSync(resolve(ROOT, 'src/triad/memory/engine/store.ts'), 'utf8')
  need(/isHtmlInjectEnabled/.test(storeSrc) && /setHtmlInjectEnabled/.test(storeSrc),
    'store 提供 html 开关的读写')

  // ── team 通道（与 html 同构） ───────────────────────────────────────
  if (route !== undefined) {
    const call2 = async (method, url) => {
      const captured = { status: 0, body: null }
      const res = {
        writeHead: (status) => { captured.status = status },
        end: (payload) => { try { captured.body = JSON.parse(payload) } catch { captured.body = null } },
      }
      route.handler({ method, url, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } }, res)
      await new Promise((r) => setTimeout(r, 60))
      return captured
    }
    const got = await call2('GET', '/api/dsh-memory/team-inject-state')
    need(got.status === 200, `GET /team-inject-state answers 200（实得 ${got.status}）`)
    need(typeof got.body?.enabled === 'boolean', 'team-inject-state returns a boolean enabled')
    // 默认开：模型默认单线程串完，不注入就不会主动并行委派与组队（见 types.ts 字段注释）。
    need(got.body?.enabled === true, `team 通道默认开（实得 ${JSON.stringify(got.body)}）`)
    need(got.body?.builtin === true, 'team-inject-state is tagged builtin (无卸载入口)')
    // inject-state 合并回包也必须带上 teamEnabled（开关浮层一次 hover 要全部状态）。
    const is = await call2('GET', '/api/dsh-memory/inject-state?sessionId=smoke-team')
    need(typeof is.body?.teamEnabled === 'boolean', 'GET /inject-state 顺带回传 teamEnabled')
  }
  // 注入器里的规范文本必须真的存在且带齐三档纪律——少一档模型就学偏重点。
  for (const [needle, why] of [
    ['TEAM_INJECTION_RULE', '规范常量'],
    ['判据（顺序不能反）', '先分档再动手的判据'],
    ['默认并行', '独立子任务默认并行的基调（比旧「值得拆」更强）'],
    ['顺手就做完了', '钉住「我顺手就做完了」这个偷懒借口'],
    ['subagent', '独立子任务并行委派的载体'],
    ['spawn_teammate', '复杂任务组队的载体'],
    ['自包含', 'fresh 子代理看不到历史的委派纪律'],
    ['write_scopes', '写作用域先切分的硬规矩'],
    ['反模式', '先自己串完再补验证代理的顺序错误'],
  ]) {
    need(injectSrc.includes(needle), `团队协作注入规范必须写清「${why}」（缺 ${needle}）`)
  }
  need(/teamStepCounters/.test(injectSrc) && /isTeamInjectEnabled/.test(injectSrc),
    'team 通道有独立 step 计数器（不与其它通道抢首步名额）')
  need(/teamInjectDefaultEnabled: boolean/.test(typesSrc), 'MemoryConfig 声明 teamInjectDefaultEnabled')
  need(/teamInjectDefaultEnabled: true/.test(typesSrc), 'teamInjectDefaultEnabled 默认 true')
  need(/CONFIG_BOOLEAN_KEYS[\s\S]{0,400}teamInjectDefaultEnabled/.test(typesSrc),
    'teamInjectDefaultEnabled 在 CONFIG_BOOLEAN_KEYS 里（否则面板/补丁写不进去）')
  // 通道总数是「六条」时的历史注释会误导下一个人，直接钉住条数表述与实现一致。
  need(/五条\*\*内置通道\*\*[\s\S]{0,120}team 团队协作/.test(injectSrc),
    'inject.ts 头部注释声明的内置通道条数与实现一致（当前 5 条，含 team）')
  need(/isTeamInjectEnabled/.test(storeSrc) && /setTeamInjectEnabled/.test(storeSrc),
    'store 提供 team 开关的读写')
  // 旧「效率约束」通道已整条替换，源码里不该再有残留（用户明确要求换掉）。
  // 覆盖 host 与 client 两侧全部承载文件——只扫 host 三个文件时，client 侧的
  // 路由/字段/i18n 残留会静默溜过。
  for (const rel of [
    'src/triad/memory/engine/inject.ts',
    'src/triad/memory/engine/store.ts',
    'src/triad/memory/types.ts',
    'src/triad/memory/api.ts',
    'src/client/triad/memory/api.ts',
    'src/client/triad/memory/Toggle.tsx',
    'src/client/triad/memory/locales.ts',
  ]) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
    need(!/EFFICIENCY_INJECTION_RULE|efficiencyInject|efficiencyEnabled|efficiencyStepCounters|efficiency-inject-state/.test(src),
      `${rel} 里不得残留旧 efficiency 通道标识符`)
  }
  // client 侧也要钉住新键：i18n 键拼错不会编译失败，只会静默显示原始 key。
  const clientLocales = readFileSync(resolve(ROOT, 'src/client/triad/memory/locales.ts'), 'utf8')
  const clientToggle = readFileSync(resolve(ROOT, 'src/client/triad/memory/Toggle.tsx'), 'utf8')
  for (const key of ['teamInjectLabel', 'teamInjectHint']) {
    need(clientLocales.includes(`${key}:`), `locales 定义 ${key}`)
    need(clientToggle.includes(`t('${key}')`), `Toggle 取用 ${key}`)
  }
  need(clientToggle.includes(`pushChannel('teamEnabled'`), 'Toggle 写 team 通道走 teamEnabled 键')
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
