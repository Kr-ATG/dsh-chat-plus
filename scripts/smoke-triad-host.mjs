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
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/*
 * ── DSH_HOME 隔离（必须在 import 插件之前设置）────────────────────────
 *
 * 记忆引擎的数据根走 `memoryHome()`（src/triad/memory/engine/store.ts:24）：
 * `process.env.DSH_HOME ?? ~/.dsh`。不隔离的话，本脚本里的「开关写回」类断言
 * 会直接改写**用户真实的** `~/.dsh/memories/dsh-memory/store/state.json` ——
 * 冒烟进程被杀 / 断电 / 还原路径自身抛错，都会把用户的开关状态弄坏。
 *
 * 隔离到工作区 `_tmp/`（用户约定的临时产物目录，有定期清理）之后，「开关关闭
 * 真的不写」这类断言才能安全地进仓库冒烟。实测隔离不影响其它断言。
 *
 * 注意位置：`DSH_HOME` 必须在插件模块求值前生效，所以这段放在所有 import 之后、
 * 但仍在 `await import(...)` 插件之前——store 的路径是**调用时**读环境变量，
 * 不是模块加载时，因此这里设置是有效的。
 *
 * 每次跑前先删掉上一轮的残留：隔离目录里会落技能资产副本等文件，留着只会
 * 让 _tmp 越滚越大（内容每次重生成，无需保留）。
 */
const SMOKE_DSH_HOME = resolve(ROOT, '_tmp', 'smoke-triad-host-dsh-home')
try {
  rmSync(SMOKE_DSH_HOME, { recursive: true, force: true })
} catch { /* 残留清不掉（被占用等）不影响本次运行：写入会覆盖同名文件 */ }
process.env.DSH_HOME = SMOKE_DSH_HOME

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
/** 收口断言摆场景用：投影里当前的 todos 值（由断言段赋值）。 */
let projectionTodos = null
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
  /*
   * `sessionProjections` 桩：只实现收口模块用到的那一个方法 `stateOf`。
   *
   * 下面「回合结束自动收口」那组断言要**真跑监听器**（而不是扫源码字符串），
   * 收口逻辑会问投影要当前清单，所以这里必须给一个能改写的 `todos` 值。
   * `projectionTodos` 由断言段直接赋值来摆场景。
   */
  sessionProjections: {
    stateOf: (_session, key) => (key === 'todos' ? projectionTodos : undefined),
  },
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
    // 「空白卡片」事故（2026-10-08 实测）：模型把围栏正文写成一行
    // `<!-- 内容较长，此处省略 -->`，判定链只看「有没有标签」而 `<!--` 算标签，
    // 于是被当合法卡片渲染成一张空白框（角落标 55 B）。用户看到的现象是
    // 「对话框里没有完整展示 html 而是空白的」，而模型以为自己在「说明省略原因」。
    ['严禁只写一行注释', '禁止用占位注释代替围栏正文'],
  ]) {
    need(injectSrc.includes(needle), `HTML 注入规范必须写清「${why}」（缺 ${needle}）`)
  }
  need(/htmlStepCounters/.test(injectSrc) && /isHtmlInjectEnabled/.test(injectSrc),
    'html 通道有独立 step 计数器（不与其它通道抢首步名额）')

  // `/iu` 的语义必须由注入通道交代 —— 这是「前端不转换」方案的前提。
  //
  // 客户端**什么都不做**：matchEnter 恒返回 undefined，输入机走默认发送，把
  // 用户打的原文（**连 `/iu` 一起**）照发（见 client/iu/slash.ts）。所以模型唯一
  // 能知道「这条消息要求出卡」的来源就是这段注入文本。少了它，`/iu 做个钢琴`
  // 在模型眼里就是普通一句「做个钢琴」，卡片不会出现——而且不报错。
  //
  // ⚠ 关键词必须写「原样发给你 / 连 /iu 一起」：曾经写成「客户端已剥掉前缀」，
  // 模型据此以为收到的是干净文本，于是把 `/iu` 当成了不认识的命令。
  for (const [needle, why] of [
    ['/iu', '前缀本身'],
    ['前缀', '说明这是前缀式指令'],
    ['连 `/iu` 一起原样发给你', '说明前缀会一并到达（否则模型会当成未知命令）'],
    ['必须', '强制语气（不是建议）'],
  ]) {
    need(injectSrc.includes(needle), `HTML 注入规范必须交代 /iu 语义的「${why}」（缺 ${needle}）`)
  }

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
  // 通道总数的历史注释会误导下一个人，直接钉住条数表述与实现一致。
  // 2026-10-09：diagram 通道随图形 iu kind（graph/arch/sequence）移除，五条→四条。
  need(/四条\*\*内置通道\*\*[\s\S]{0,140}team 团队协作/.test(injectSrc),
    'inject.ts 头部注释声明的内置通道条数与实现一致（当前 4 条，含 team）')
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
  // 收口模块的承载文件：缺失时给一条清晰失败，而不是让整个冒烟抛 ENOENT
  // （那样报的是「冒烟脚本崩了」，读不出「收口没实现」这个真因）。
  const readOrFail = (rel) => {
    try {
      return readFileSync(resolve(ROOT, rel), 'utf8')
    } catch (error) {
      fail(`缺少承载文件 ${rel}：${error?.code ?? error?.message ?? error}`)
      return ''
    }
  }
  const closureSrc = readOrFail('src/triad/memory/engine/todo-closure.ts')
  const memoryApiSrc = readOrFail('src/triad/memory/api.ts')
  const clientApiSrc = readOrFail('src/client/triad/memory/api.ts')
  for (const key of ['teamInjectLabel', 'teamInjectHint']) {
    need(clientLocales.includes(`${key}:`), `locales 定义 ${key}`)
    need(clientToggle.includes(`t('${key}')`), `Toggle 取用 ${key}`)
  }
  need(clientToggle.includes(`pushChannel('teamEnabled'`), 'Toggle 写 team 通道走 teamEnabled 键')

  // ── 回合结束自动收口（todo-closure） ────────────────────────────────
  // 它不是「注入通道」（不往上下文里塞任何文本），而是**行为通道**：回合结束时
  // 把残留 in_progress 降级为 pending，让任务卡不再挂着假进行中。因此它不进
  // 上面那条「四条内置通道」的条数断言，单开一段钉。
  if (route !== undefined) {
    const call3 = async (method, url) => {
      const captured = { status: 0, body: null }
      const res = {
        writeHead: (status) => { captured.status = status },
        end: (payload) => { try { captured.body = JSON.parse(payload) } catch { captured.body = null } },
      }
      route.handler({ method, url, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } }, res)
      await new Promise((r) => setTimeout(r, 60))
      return captured
    }
    const got = await call3('GET', '/api/dsh-memory/todo-closure-state')
    need(got.status === 200, `GET /todo-closure-state answers 200（实得 ${got.status}）`)
    need(typeof got.body?.enabled === 'boolean', 'todo-closure-state returns a boolean enabled')
    // 默认开：这条兜底治的是「模型没在收尾时回写清单」这个实测 35% 的行为缺口，
    // 默认关等于大多数人永远碰不到它（见 types.ts 字段注释）。
    need(got.body?.enabled === true, `自动收口默认开（实得 ${JSON.stringify(got.body)}）`)
    need(got.body?.builtin === true, 'todo-closure-state is tagged builtin (无卸载入口)')
    const is = await call3('GET', '/api/dsh-memory/inject-state?sessionId=smoke-closure')
    need(typeof is.body?.todoClosureEnabled === 'boolean', 'GET /inject-state 顺带回传 todoClosureEnabled')
  }
  /*
   * ── 收口的行为验证（真跑监听器，不扫源码字符串）────────────────────
   *
   * 为什么整段改掉原来的正则断言：正则只能证明「源码里出现过某个串」，
   * 证明不了行为。实测这些正则有多处假阳性——把写入载荷换成 filter 子集
   * （会静默删用户任务）`/todos\.map\(/` 照样通过；把整个降级逻辑删掉
   * `/in_progress/` 照样通过；`/agent\/turn-stopping/` 命中的其实是模块头
   * **注释**（真正注册它的 index.ts 根本没被扫）。断言段于是提供了虚假的
   * 安全感——这正是本次审计的结论。
   *
   * 改法：从 listeners 里取出真实注册的监听器直接调用，验它对投影做了什么。
   * 这样「注册点写错事件名」「载荷被截断」「开关没生效」三类缺陷都会当场失败。
   */
  const stopping = listeners.get('agent/turn-stopping') ?? []
  need(stopping.length === 1,
    `agent/turn-stopping 上恰好挂 1 个收口监听器（实得 ${stopping.length}）`)

  // 剥注释后的源码：下面几处「有没有某个调用」的判定必须看代码本体，
  // 否则模块头注释里解释「为什么不用 session/event」会被当成违规。
  const closureSrcNoComment = closureSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  /** 造一个可观测的假 session：记录每次 append 的类型与载荷。 */
  const makeSession = () => {
    const appended = []
    return {
      id: 'smoke-closure-session',
      appended,
      append: (type, data) => { appended.push({ type, data }); return { type } },
    }
  }

  if (stopping.length === 1) {
    const closureListener = stopping[0]

    // ① 有 in_progress → 恰好写一次，整表长度不变，只改 status。
    // **两条** in_progress：只放一条时，「只降级第一条」这类缺陷区分不出来
    // （实测该变异能逃逸），而真实清单确实允许多条并行（config 的
    // allowParallelInProgress 默认 true）。
    projectionTodos = [
      { content: '已完成的事', status: 'completed' },
      { content: '正在做的事甲', status: 'in_progress' },
      { content: '正在做的事乙', status: 'in_progress' },
      { content: '还没做的事', status: 'pending' },
    ]
    const s1 = makeSession()
    await closureListener({ agent: { id: 'a1', session: s1 } })
    need(s1.appended.length === 1,
      `有 in_progress 时恰好 append 一次（实得 ${s1.appended.length}）`)
    const write1 = s1.appended[0]
    need(write1?.type === 'todo/write', `append 的事件类型是 todo/write（实得 ${write1?.type}）`)
    const out1 = write1?.data?.todos
    need(Array.isArray(out1) && out1.length === 4,
      `写入载荷是**全量**清单、长度 4（实得 ${Array.isArray(out1) ? out1.length : out1}）——载荷用 filter 子集会把未改动项静默删掉`)
    need(out1?.[1]?.status === 'pending' && out1?.[2]?.status === 'pending',
      `**每一条** in_progress 都被降级为 pending（实得 ${out1?.[1]?.status} / ${out1?.[2]?.status}）——只改第一条会漏掉并行任务的其余项`)
    need(out1?.[0]?.status === 'completed' && out1?.[3]?.status === 'pending',
      '未改动的项状态原样保留（completed / pending 不被波及）')
    need(out1?.[0]?.content === '已完成的事' && out1?.[1]?.content === '正在做的事甲' && out1?.[2]?.content === '正在做的事乙',
      'content 一字未动（invariant 的非空/trim/不重复天然满足）')
    // 投影返回的数组不得被原地改写（上游可能持有同一引用）。
    need(projectionTodos[1].status === 'in_progress' && projectionTodos[2].status === 'in_progress',
      '不原地修改投影返回的数组（原数组仍是 in_progress）')

    // ② 没有 in_progress → 不写。无意义的整表快照只会污染会话日志。
    projectionTodos = [
      { content: '已完成的事', status: 'completed' },
      { content: '还没做的事', status: 'pending' },
    ]
    const s2 = makeSession()
    await closureListener({ agent: { id: 'a2', session: s2 } })
    need(s2.appended.length === 0, `无 in_progress 时不 append（实得 ${s2.appended.length}）`)

    // ③ 投影为空（回合刚开始、还没写过清单）→ 不写。
    for (const empty of [null, []]) {
      projectionTodos = empty
      const s3 = makeSession()
      await closureListener({ agent: { id: 'a3', session: s3 } })
      need(s3.appended.length === 0,
        `投影为 ${JSON.stringify(empty)} 时不 append（实得 ${s3.appended.length}）`)
    }

    /*
     * ④ 形状不符的项不得被丢掉：整表替换下少带一条 = 删掉用户的任务。
     *
     * 这一条必须用**真的过不了 isTodoItemLike 的项**（status 不在三值枚举里），
     * 否则区分不出正确实现与「拿 filter 子集当载荷」的缺陷——实测：用
     * `{extra:1}` 这种仍合法（content+status 都对）的项时，变异成 `items.map`
     * 依然全绿，断言等于没有。未来 DSH 给 TodoItem 加状态值就会踩到这个坑。
     */
    projectionTodos = [
      { content: '正常项', status: 'in_progress' },
      { content: '未来版本的新状态项', status: 'unknown_future_status' },
      { content: '正常待办', status: 'pending' },
    ]
    const s4 = makeSession()
    await closureListener({ agent: { id: 'a4', session: s4 } })
    const out4 = s4.appended[0]?.data?.todos
    need(Array.isArray(out4) && out4.length === 3,
      `形状不符的项不被丢弃、整表长度仍是 3（实得 ${Array.isArray(out4) ? out4.length : out4}）——拿 filter 子集当载荷会静默删掉用户的任务`)
    need(out4?.[1]?.content === '未来版本的新状态项' && out4?.[1]?.status === 'unknown_future_status',
      '形状不符的项原样搬运（不改写、不丢弃）')
    need(out4?.[0]?.status === 'pending', '合法项的降级不受形状不符项影响')

    /*
     * ④b content 本身不合法的项也必须原样搬运。
     *
     * 这条防的是「放宽 isTodoItemLike + 拿 filter 子集当载荷」的**组合**变异：
     * 单放宽守卫是等价变异（改写条件仍只认 in_progress，行为不变，不该被抓）；
     * 单换载荷已被 ④ 抓住；但两者叠加时，status 非法的项会被放宽后的守卫收进
     * items，于是 ④ 的用例区分不出来——只有 content 非法（守卫无论如何都拒）
     * 的项能暴露它。当前 invariant 保证 content 非空 string，所以这是**防御
     * 未来形状漂移**，不是现存缺陷。
     */
    projectionTodos = [
      { content: '正常项', status: 'in_progress' },
      { content: null, status: 'pending' },
    ]
    const s4b = makeSession()
    await closureListener({ agent: { id: 'a4b', session: s4b } })
    const out4b = s4b.appended[0]?.data?.todos
    need(Array.isArray(out4b) && out4b.length === 2,
      `content 非法的项也不被丢弃、整表长度仍是 2（实得 ${Array.isArray(out4b) ? out4b.length : out4b}）`)

    // ⑤ append 被拒（例如 turn 已关闭、invariant 拦下）→ 监听器必须仍 resolve。
    // turn-stopping 是 serial + awaited，抛错会把用户的整个回合打成 error。
    projectionTodos = [{ content: '正在做的事', status: 'in_progress' }]
    const s5 = makeSession()
    s5.append = () => { throw new Error('invariant: todo/write appended outside any open turn') }
    let threw = false
    try {
      await closureListener({ agent: { id: 'a5', session: s5 } })
    } catch { threw = true }
    need(!threw, 'append 抛错时监听器仍然 resolve（绝不把用户的回合打成 error）')

    /*
     * ⑥ 开关真的生效——**行为断言**，不是「源码里有 isTodoClosureEnabled」。
     *
     * 为什么必须有这条：只断言「读了开关」会漏掉最恶劣的一种缺陷——读了但
     * 不用（`const enabled = await ...` 后面忘了 `if (!enabled) return`）。
     * 那种情况下面板显示「已关闭」而行为照旧，是**假状态**，用户点开关看不出
     * 任何区别。实测该变异能逃过所有静态断言。
     *
     * 安全性：本脚本顶部已把 DSH_HOME 隔离到工作区 _tmp/，这里的写回只落在
     * 隔离目录，碰不到用户的真实 state.json。
     *
     * 走 state.json 而不是伪造 POST 请求体：路由层已由上面的 GET 断言覆盖，
     * 而这里要验的是「store 里的开关值真的影响行为」这条链路。
     */
    projectionTodos = [{ content: '正在做的事', status: 'in_progress' }]
    const statePath = resolve(SMOKE_DSH_HOME, 'memories', 'dsh-memory', 'store', 'state.json')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const setClosureSwitch = (enabled) => {
      const raw = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
      raw.todoClosureEnabled = enabled
      mkdirSync(dirname(statePath), { recursive: true })
      writeFileSync(statePath, JSON.stringify(raw))
    }

    let switchWritable = true
    try {
      setClosureSwitch(false)
    } catch (error) {
      switchWritable = false
      fail(`无法在隔离目录写 state.json（${error?.message ?? error}）`)
    }
    if (switchWritable) {
      const s6 = makeSession()
      await closureListener({ agent: { id: 'a6', session: s6 } })
      need(s6.appended.length === 0,
        `开关关闭时监听器完全不 append（实得 ${s6.appended.length}）——读了开关却不用会让面板显示假状态`)

      // 复原为开，确认开关双向可用（否则「写死关闭」也能过上面那条）。
      setClosureSwitch(true)
      const s7 = makeSession()
      await closureListener({ agent: { id: 'a7', session: s7 } })
      need(s7.appended.length === 1,
        `开关打开时监听器恢复写入（实得 ${s7.appended.length}）——防「写死关闭」蒙混过关`)

      /*
       * ⑦ 三态的 **fallback 分支**：state.json 里**没有**该字段时（用户从未
       * 拨过这个开关），行为要跟随 `config.todoClosureDefaultEnabled`。
       *
       * 上面两条用例总是显式写字段，永远走不到 fallback —— 于是把
       * `config.todoClosureDefaultEnabled !== false` 硬编码成 `true` 的变异能
       * 全绿逃逸，而真实后果是：用户在 config.json 里关掉默认收口后它照样收口
       * （三态语义的 fallback 透传被破坏）。实测该变异确实逃逸过。
       *
       * 这里先删掉字段（制造「从未拨过」的状态）验证 fallback 被走到且取到真值。
       * 注意：`config` 在插件装配时就已冻结，运行时改不了它，所以「config 为
       * false 时不收口」这条只能靠下面的**表达式精确断言**兜住，不能靠行为。
       */
      try {
        const raw = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
        delete raw.todoClosureEnabled
        mkdirSync(dirname(statePath), { recursive: true })
        writeFileSync(statePath, JSON.stringify(raw))
        const s8 = makeSession()
        await closureListener({ agent: { id: 'a8', session: s8 } })
        need(s8.appended.length === 1,
          `state 里没有开关字段时走 config fallback、默认开 → 照常收口（实得 ${s8.appended.length}）`)
      } catch (error) {
        fail(`fallback 用例失败：${error?.message ?? error}`)
      }
    }
    projectionTodos = null
  }

  /*
   * ⑦b fallback 表达式必须**透传 config**，不能硬编码。
   *
   * 这条只能静态钉：`config` 是装配期冻结值，运行时无法构造「config 为 false」
   * 的场景。但硬编码成 `true` 正是实测逃逸过的变异，后果是用户在 config.json
   * 里关掉默认后仍被收口——静默失效，且面板显示成关（假状态）。
   */
  need(/isTodoClosureEnabled\(\s*config\.todoClosureDefaultEnabled\s*!==\s*false\s*\)/.test(closureSrcNoComment),
    '收口的开关 fallback 透传 config.todoClosureDefaultEnabled（硬编码 true 会让 config 关闭失效）')

  // 收口不得注册到 session/event：那里是 append 的发布边界内，重入会被
  // dsh-session 的守卫拒绝、且错误被吞成 warn（静默失效）。扫的是**真实注册表**，
  // 不是源码文本——源码注释里必然要解释为什么不用它。
  need(listeners.has('agent/turn-stopping'), '收口注册在 agent/turn-stopping（turn 仍 open 的唯一合法补写点）')
  need(!/(?:ctx\.)?\.?on\(\s*['"]session\/event['"]/.test(closureSrcNoComment),
    '收口模块自身不注册 session/event（会撞 append 重入检查且静默失败）')
  need(/isTodoClosureEnabled/.test(storeSrc) && /setTodoClosureEnabled/.test(storeSrc),
    'store 提供自动收口开关的读写')
  // 卸载后不再动作：dispose 是插件的资源回收契约（ctx.effect 登记）。
  // 这条行为影响很小（只关系卸载后的多余 append），但它是插件契约的一部分，
  // 静态钉一下成本为零。
  need(/if\s*\(disposed\)\s*return/.test(closureSrcNoComment),
    '收口监听器尊重 dispose（卸载后不再动作）')
  need(/todoClosureEnabled/.test(memoryApiSrc), 'host api 回传/写入 todoClosureEnabled')
  need(/todoClosureEnabled/.test(clientApiSrc), 'client api 声明 todoClosureEnabled')
  // client 侧默认开的通道必须用 `!== false` 兜底；写成 `=== true`（html/team 那种
  // 默认关口径）会让 host 未升级时开关显示成关——这类错不编译失败，只静默错。
  need(/todoClosureEnabled: res\.todoClosureEnabled !== false/.test(clientToggle),
    'client 回包映射用 !== false 兜底（默认开通道的正确口径）')
  for (const key of ['todoClosureLabel', 'todoClosureHint']) {
    need(clientLocales.includes(`${key}:`), `locales 定义 ${key}`)
    need(clientToggle.includes(`t('${key}')`), `Toggle 取用 ${key}`)
  }
  need(clientToggle.includes(`pushChannel('todoClosureEnabled'`),
    'Toggle 写自动收口走 todoClosureEnabled 键')
  // 任务卡口径：自动收口把 in_progress 改成 pending 之后，若卡片仍只认
  // in_progress，兜底标签会静默消失（永远不触发）。钉住判定表达式本身
  // （不是变量名存在），否则把 stalled 改回旧口径也能蒙混过关。
  //
  // 三层都要钉：整卡判定（stalled）→ 行级判定（rowStalled）→ 渲染消费点。
  // 只钉前两层时，把渲染条件改回 `isInProgress` 仍会全绿，而 pending 行
  // 恰恰是收口后最该被标出来的那批（实测该变异能逃逸）。
  const taskCard = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrTaskOverviewCard.tsx'), 'utf8')
  const taskCardCode = taskCard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  need(/unfinishedCount\s*=\s*tasks\.filter\(\(t\)\s*=>\s*t\.status\s*!==\s*'completed'\)/.test(taskCardCode),
    '任务卡按「非完成项」计算未完成数（只认 in_progress 会让收口后的 pending 行静默裸奔）')
  need(/stalled\s*=\s*!isRunning\s*&&\s*unfinishedCount\s*>\s*0/.test(taskCardCode),
    '任务卡停滞判定真的用了 unfinishedCount（变量名存在不算）')
  // 行级判定必须与整卡同口径：`!isCompleted` 而非 `isInProgress`。
  need(/rowStalled\s*=\s*!isRunning\s*&&\s*!isCompleted/.test(taskCardCode),
    '任务卡行级判定覆盖全部非完成行（写成 isInProgress 会让 pending 行不标）')
  // 渲染消费点：标签必须挂在 rowStalled 上，而不是回退到 isInProgress。
  need(/\{rowStalled\s*&&\s*\(/.test(taskCardCode),
    '任务卡把「未完成」标签挂在 rowStalled 上（挂回 isInProgress 等于只标旧口径）')
  need(/unfinishedCount\s*>\s*0\s*\?\s*\(stalled\s*\?\s*'[^']*未完成'/.test(taskCardCode),
    '任务卡 meta 文案按 stalled 出「未完成」（回退成「进行中」会让收口后的残留看着像在跑）')
  need(/未完成/.test(taskCardCode), '任务卡用「未完成」文案（收口后 pending 行也标）')
  need(!/未收口/.test(taskCardCode), '任务卡渲染文案不再用已过时的「未收口」（注释里的改口记录不算）')
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
