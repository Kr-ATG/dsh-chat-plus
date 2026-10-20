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
  // 「6 个 mail_* 工具都注册」断言就会跟着失败 —— 那是配置生效的正确行为，
  // 不是缺陷。冒烟测的是「插件能不能把工具挂上」，所以这里把开关钉成 true，
  // 让结果只取决于代码本身，不取决于跑测试时用户恰好把开关拨到哪边。
  mod.apply(ctx, { mail: { enabled: true, injectEnabled: true } })
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
/*
 * ── 画廊分类计数（kindTotals）与分类删除（POST /delete）────────────────
 *
 * 这两块是「画廊里的任何分类都允许删除」这条需求的地基，而两者都极易**静默半通**：
 *  · 计数少一个字段，面板就回落成 99+ 或本地小计（不报错）；
 *  · 删除准入松一格，就是**不可逆的数据损失**——本插件的删除不落回收站。
 *
 * 所以这里钉的是**行为**而不是「源码里出现过某个词」（安全审计 2026-10-16 之后
 * 全部改成行为断言；原先的两条源码正则与一条静默跳过已按审计意见移除）：
 *  · 准入判据（纯函数）逐个喂真实文件 / 目录 / 符号链接 / 不存在的路径；
 *  · 路由分发靠**真发一次 HTTP POST** 证明，不靠 prefix 名字检查；
 *  · kindTotals 靠喂合成响应给真实 verifyResponse 证明计数语义，并另有一条
 *    断言 HTTP 响应体里真的有这个字段；
 *  · CSRF 两道闸门各有纯判据断言 + 走 HTTP 的回归断言（无/错 content-type、
 *    cross-site、非法 Origin、合法 Origin）；
 *  · 已存在的文件才可能被删掉，验证「删索引外的路径」这条真的拒绝；
 *  · 删除目标的文件全是本脚本自建的临时文件（工作区 _tmp/ 下），碰不到用户数据。
 */
{
  const { mkdirSync, symlinkSync, writeFileSync } = await import('node:fs')
  const { classifyDeleteTarget, parseDeletePaths } = mod.galleryTest

  /*
   * ① 路由分发不在这里断言。
   *
   * 原来这里写的是 `paths.some(p => p.startsWith('/api/triad/gallery'))` ——
   * 它只证明「有这么一条 prefix 路由」，既不证明 /delete 被分发到 handler，也和
   * 上面那条 media gallery 路由断言完全重复（安全审计 2026-10-16 点名）。
   * 真正的分发证明挪到 ⑤：对 /delete 真发一次 POST，断言拿到 handler 的 JSON 契约。
   */
  // ② 准入纯函数必须暴露（没有可测面 = 只能靠用户误删来发现问题）。
  need(typeof classifyDeleteTarget === 'function',
    'gallery __test exposes classifyDeleteTarget（删除准入纯函数）')
  need(typeof parseDeletePaths === 'function', 'gallery __test exposes parseDeletePaths')
  need(typeof mod.galleryTest.verifyResponse === 'function',
    'gallery __test exposes verifyResponse（kindTotals 的行为断言要用它）')
  // 修 1 的两道闸门纯判据也要可测（HTTP 那组在 ⑤b，这里钉判据本身）。
  need(typeof mod.galleryTest.isJsonContentType === 'function',
    'gallery __test exposes isJsonContentType（CSRF 闸门一的可测面）')
  need(typeof mod.galleryTest.isCrossSiteWrite === 'function',
    'gallery __test exposes isCrossSiteWrite（CSRF 闸门二的可测面）')
  {
    const { isJsonContentType, isCrossSiteWrite } = mod.galleryTest
    // 闸门一：只有 application/json 算数，参数后缀容忍。
    need(isJsonContentType('application/json') === true, 'content-type 判据：application/json 放行')
    need(isJsonContentType('application/json; charset=utf-8') === true, 'content-type 判据：带 charset 后缀放行')
    need(isJsonContentType('APPLICATION/JSON') === true, 'content-type 判据：大小写不敏感')
    need(isJsonContentType('text/plain') === false, 'content-type 判据：text/plain 拒（CORS 简单请求）')
    need(isJsonContentType('application/x-www-form-urlencoded') === false, 'content-type 判据：表单编码拒')
    need(isJsonContentType('multipart/form-data; boundary=x') === false, 'content-type 判据：multipart 拒')
    need(isJsonContentType(undefined) === false, 'content-type 判据：缺失拒（跨站简单请求就是这种形态）')
    need(isJsonContentType(['application/json']) === true, 'content-type 判据：数组形态取首值（Node 头可能给数组）')
    // 闸门二：只拒「存在且非法」。
    need(isCrossSiteWrite({ 'sec-fetch-site': 'cross-site' }) === true, 'CSRF 判据：cross-site 拒')
    need(isCrossSiteWrite({ 'sec-fetch-site': 'same-origin' }) === false, 'CSRF 判据：same-origin 放行')
    need(isCrossSiteWrite({ origin: 'https://evil.example.com' }) === true, 'CSRF 判据：非法 Origin 拒')
    need(isCrossSiteWrite({ origin: 'null' }) === true, 'CSRF 判据：Origin: null 拒（sandbox iframe）')
    need(isCrossSiteWrite({ origin: 'http://127.0.0.1:3080' }) === false, 'CSRF 判据：loopback Origin 放行')
    need(isCrossSiteWrite({ origin: 'http://localhost:3080' }) === false, 'CSRF 判据：localhost Origin 放行')
    need(isCrossSiteWrite({}) === false, 'CSRF 判据：Origin 缺失放行（同源 fetch / curl 不带它）')
  }

  const DELETE_KIT = resolve(ROOT, '_tmp', 'smoke-gallery-delete')
  try { rmSync(DELETE_KIT, { recursive: true, force: true }) } catch { /* 上一轮残留被占用时覆盖即可 */ }
  mkdirSync(DELETE_KIT, { recursive: true })
  const plain = resolve(DELETE_KIT, 'plain.png')
  writeFileSync(plain, 'x')
  const subdir = resolve(DELETE_KIT, 'subdir')
  mkdirSync(subdir, { recursive: true })
  writeFileSync(resolve(subdir, 'inner.png'), 'x')

  // ③ 只删普通文件：目录、符号链接、不存在的路径一律拒（且**不递归**）。
  need(classifyDeleteTarget(plain) === null, '/delete 准入：普通文件放行')
  need(classifyDeleteTarget(subdir) === 'not-a-file',
    '/delete 准入：目录被拒（not-a-file，绝不递归、不吃目录前缀）')
  need(classifyDeleteTarget(resolve(DELETE_KIT, 'nope.png')) === 'missing',
    '/delete 准入：不存在的路径 → missing（如实回报，不静默吞）')
  /*
   * 符号链接这条**不能静默跳过**（安全审计 2026-10-16 点名）。
   *
   * 旧写法是 `catch { /* 忽略 *\/ }` + `console.log('info ...跳过')` —— 在没开
   * 开发者模式 / 无 SeCreateSymbolicLinkPrivilege 的机器上，这条防「删除放大」的
   * 核心断言会**无声消失**，而冒烟照样 PASSED。那等于把最该被盯住的一条判据
   * 变成了「本机恰好能建链接时才检查」。失败就是失败：拿不到这个前提说明环境
   * 不足以验证它，必须报出来让人去补权限，而不是让它绿着过。
   */
  const link = resolve(DELETE_KIT, 'link.png')
  try {
    symlinkSync(plain, link, 'file')
    need(classifyDeleteTarget(link) === 'not-a-file',
      '/delete 准入：符号链接被拒（防「删一个格子 = 删掉链路另一头」的删除放大）')
    // 拒删之后链接与目标都必须健在——判据错的表现就是这里没了。
    need(existsSync(link) && existsSync(plain), '/delete 准入不通过时不产生任何副作用')
  } catch (error) {
    fail(`/delete 符号链接准入无法验证：本机建不出符号链接（${error?.code ?? error?.message}）。`
      + ' 这条是防「删除放大」的核心判据，必须能跑；请以开发者模式或管理员权限重跑冒烟。')
  }

  // ④ 请求体校验：整单拒绝，绝不半接受。
  need('error' in parseDeletePaths('nope'), '/delete 400：paths 非数组整单拒绝')
  need('error' in parseDeletePaths([]), '/delete 400：空数组整单拒绝')
  need('error' in parseDeletePaths(Array.from({ length: 2001 }, (_, i) => `p${i}`)), '/delete 400：超过 2000 条拒绝')
  need('error' in parseDeletePaths(['ok.png', 42]), '/delete 400：含非字符串整单拒绝')
  need('error' in parseDeletePaths(['']), '/delete 400：含空串整单拒绝')
  {
    // 去重键沿用索引归一（分隔符 + 大小写）：同一文件传两次只删一次。
    const deduped = parseDeletePaths(['D:\\A\\B.PNG', 'd:/a/b.png'])
    need(deduped.paths?.length === 1, `/delete：同一路径不同写法去重（实得 ${deduped.paths?.length}）`)
  }

  // ⑤ 真实删除走 HTTP 路由：先登记索引，再删；未索引的路径必须留在原地。
  const route = routes.get('/api/triad/gallery')
  if (route === undefined) {
    fail('gallery route missing — 无法对拍 /delete 的 HTTP 契约')
  } else {
    /*
     * 请求桩：`contentType` 默认给 `application/json` —— 因为**这正是修 1 之后
     * 的正常请求形态**，不给的话每条断言都会先被 content-type 闸门打成 400，
     * 后面那些删除语义就全测不到了。专门测闸门的两条断言显式传别的值 / null。
     */
    const callDelete = async (method, body, {
      host = '127.0.0.1:3080',
      peer = '127.0.0.1',
      raw,
      contentType = 'application/json',
      extraHeaders = {},
    } = {}) => {
      const captured = { status: 0, body: null }
      const res = {
        writeHead: (status) => { captured.status = status },
        end: (payload) => { try { captured.body = JSON.parse(payload) } catch { captured.body = payload ?? null } },
        destroy: () => {},
      }
      const headers = { host, ...extraHeaders }
      if (contentType !== null) headers['content-type'] = contentType
      const req = {
        method,
        url: '/api/triad/gallery/delete',
        socket: { remoteAddress: peer },
        headers,
        on: (event, handler) => {
          if (event === 'data') handler(Buffer.from(raw ?? JSON.stringify(body ?? {})))
          else if (event === 'end') handler()
          return req
        },
        destroy: () => {},
      }
      route.handler(req, res)
      await new Promise((r) => setTimeout(r, 200))
      return captured
    }

    need((await callDelete('GET')).status === 405, '/delete 非 POST → 405 method-not-allowed')
    need((await callDelete('POST', { paths: [plain] }, { peer: '10.0.0.9' })).status === 403,
      '/delete 非 loopback peer → 403 forbidden（写路由同样过 fence）')
    need((await callDelete('POST', { paths: [plain] }, { host: 'evil.example.com' })).status === 403,
      '/delete 非本机 Host → 403 forbidden（DNS rebinding 面）')
    need((await callDelete('POST', undefined, { raw: 'not-json' })).status === 400,
      '/delete 非 JSON body → 400 bad-request')
    need((await callDelete('POST', { paths: { nope: 1 } })).status === 400, '/delete paths 非数组 → 400')

    /*
     * ⑤b CSRF 盲删通路的回归护栏（安全审计 2026-10-16，修 1）。
     *
     * 攻击面：跨站页面用 CORS **简单请求**（`text/plain`，不触发 preflight）盲发
     * POST，请求会真的送达并执行删除，而响应因无 CORS 头读不到 —— 用户无感知。
     * 本插件的 prefix 路由抢在官方 `/api` 那层校验之前命中，拿不到官方 CSRF 防护，
     * 所以这两道闸门（content-type + Origin/sec-fetch-site）必须自己钉住。
     */
    // 闸门一：没有 content-type 的简单请求。
    {
      /*
       * 用**已索引**的专用文件验闸门：只断言「未索引文件没被删」是没有信息量的
       * （它本来就在准入名单外）。这里先登记进索引，再发跨站请求 —— 若闸门被
       * 摘掉，这个文件会真的消失。跑完显式摘掉，避免污染后面的 remaining 计数。
       */
      const csrfVictim = resolve(DELETE_KIT, 'csrf-victim.png')
      writeFileSync(csrfVictim, 'x')
      mod.galleryTest.rememberIndex([
        { path: csrfVictim, name: 'csrf-victim.png', kind: 'image', source: 'file', time: 1, sessionId: 'smoke-csrf' },
      ])
      need(mod.galleryTest.isIndexed(csrfVictim) === true, '/delete CSRF 前置：csrf-victim 已在索引里')

      const noType = await callDelete('POST', { paths: [csrfVictim] }, { contentType: null })
      need(noType.status === 400 && noType.body?.error === 'bad-request',
        `/delete 无 content-type → 400（跨站简单请求发不出 application/json，实得 ${noType.status}）`)
      const textPlain = await callDelete('POST', { paths: [csrfVictim] }, { contentType: 'text/plain' })
      need(textPlain.status === 400 && textPlain.body?.message === 'content-type must be application/json',
        `/delete text/plain → 400 bad-request（实得 ${textPlain.status} / ${JSON.stringify(textPlain.body?.message)}）`)
      const formType = await callDelete('POST', { paths: [csrfVictim] }, { contentType: 'application/x-www-form-urlencoded' })
      need(formType.status === 400, '/delete 表单编码 content-type → 400（简单请求三件套都要挡）')
      need(existsSync(csrfVictim),
        '/delete content-type 闸门拦下的请求**没有删掉已索引文件**（闸门真在起作用的证据）')

      const crossSite = await callDelete('POST', { paths: [csrfVictim] }, {
        contentType: 'application/json', extraHeaders: { 'sec-fetch-site': 'cross-site' },
      })
      need(crossSite.status === 403 && crossSite.body?.error === 'forbidden',
        `/delete sec-fetch-site: cross-site → 403（实得 ${crossSite.status}）`)
      const badOrigin = await callDelete('POST', { paths: [csrfVictim] }, {
        contentType: 'application/json', extraHeaders: { origin: 'https://evil.example.com' },
      })
      need(badOrigin.status === 403 && badOrigin.body?.error === 'forbidden',
        `/delete 非法 Origin → 403（实得 ${badOrigin.status}）`)
      need(existsSync(csrfVictim),
        '/delete Origin / sec-fetch-site 闸门拦下的请求**没有删掉已索引文件**（盲删通路被堵住的证据）')

      // 合法形态放行：charset 后缀 + loopback Origin + 无 Origin 三种，都要能走到业务层。
      const withCharset = await callDelete('POST', { paths: [] }, { contentType: 'application/json; charset=utf-8' })
      need(withCharset.status === 400 && withCharset.body?.error === 'bad-request',
        '/delete application/json; charset=utf-8 不被闸门误伤（空 paths 走到业务校验，实得 '
        + `${withCharset.status} / ${withCharset.body?.error}）`)
      for (const site of ['same-origin', 'same-site', 'none']) {
        const ok = await callDelete('POST', { paths: [] }, {
          contentType: 'application/json', extraHeaders: { 'sec-fetch-site': site },
        })
        need(ok.status === 400 && ok.body?.error === 'bad-request',
          `/delete sec-fetch-site: ${site} 放行到业务层（实得 ${ok.status}）`)
      }
      for (const origin of ['http://127.0.0.1:3080', 'http://localhost:3080', 'http://[::1]:3080']) {
        const ok = await callDelete('POST', { paths: [] }, {
          contentType: 'application/json', extraHeaders: { origin },
        })
        need(ok.status === 400 && ok.body?.error === 'bad-request',
          `/delete 合法同源 Origin（${origin}）放行到业务层（实得 ${ok.status}）`)
      }
      // `Origin: null`（sandbox iframe / file:// 会发这个）解析不出主机，判非法。
      const nullOrigin = await callDelete('POST', { paths: [] }, {
        contentType: 'application/json', extraHeaders: { origin: 'null' },
      })
      need(nullOrigin.status === 403, '/delete Origin: null → 403（sandbox iframe / file:// 的形态）')
      // Origin 缺失（同源 fetch / curl 的形态）必须放行 —— 缺失当非法会让删除直接不可用。
      const noOrigin = await callDelete('POST', { paths: [] }, { contentType: 'application/json' })
      need(noOrigin.status === 400 && noOrigin.body?.error === 'bad-request',
        '/delete Origin 缺失放行到业务层（同源 fetch / curl 不带这个头）')
      // 闸门必须**早于** body 解析：跨站请求连请求体都不该被读。
      const crossWithBadBody = await callDelete('POST', undefined, {
        raw: 'not-json', extraHeaders: { 'sec-fetch-site': 'cross-site' },
      })
      need(crossWithBadBody.status === 403,
        '/delete 跨站 + 坏 body → 403（闸门早于 body 解析，不是先 400）')

      mod.galleryTest.forgetIndexed(csrfVictim)
      need(mod.galleryTest.isIndexed(csrfVictim) === false, '/delete CSRF 用例收尾：摘掉临时索引项')
      rmSync(csrfVictim, { force: true })
    }

    // 未索引路径：即使文件真实存在也必须拒（这是不可逆删除的第一道闸）。
    const free = resolve(DELETE_KIT, 'free.png')
    writeFileSync(free, 'x')
    const notIndexed = await callDelete('POST', { paths: [free] })
    need(notIndexed.status === 200 && notIndexed.body?.ok === false
      && notIndexed.body?.deleted === 0 && notIndexed.body?.failed?.[0]?.error === 'not-indexed',
      `/delete 未索引路径 → not-indexed 且 deleted=0（实得 ${JSON.stringify(notIndexed.body)}）`)
    need(existsSync(free), '/delete 未索引路径被拒后文件仍在原地（绝不删自由路径）')

    // 已索引的普通文件：真删 + 从索引摘除 + remaining 计数。
    const victim = resolve(DELETE_KIT, 'victim.png')
    writeFileSync(victim, 'x')
    mod.galleryTest.rememberIndex([
      { path: victim, name: 'victim.png', kind: 'image', source: 'file', time: 1, sessionId: 'smoke-delete' },
    ])
    need(mod.galleryTest.isIndexed(victim) === true, '/delete 前置：victim 已在索引名单里')
    const wiped = await callDelete('POST', { paths: [victim] })
    need(wiped.status === 200 && wiped.body?.ok === true && wiped.body?.deleted === 1
      && Array.isArray(wiped.body?.failed) && wiped.body.failed.length === 0
      && wiped.body?.remaining === 0,
      `/delete 索引内的普通文件真删（实得 ${JSON.stringify(wiped.body)}）`)
    need(!existsSync(victim), '/delete 磁盘文件已删除（不可逆）')
    need(mod.galleryTest.isIndexed(victim) === false,
      '/delete 删完从准入名单摘除（同一进程内 /raw 立刻拒绝这些路径）')

    // 索引里登记成目录：仍然拒（索引准入不能替代文件形状判据）。
    mkdirSync(subdir, { recursive: true })
    mod.galleryTest.rememberIndex([
      { path: subdir, name: 'subdir', kind: 'page', source: 'file', time: 1, sessionId: 'smoke-delete' },
    ])
    const asDir = await callDelete('POST', { paths: [subdir] })
    need(asDir.body?.deleted === 0 && asDir.body?.failed?.[0]?.error === 'not-a-file',
      '/delete 索引里的目录仍被拒（not-a-file）')
    need(existsSync(resolve(subdir, 'inner.png')), '/delete 目录被拒时不连带删除里面的文件（不递归）')
  }

  /*
   * ⑥ kindTotals：**行为断言**，不是扫源码词（安全审计 2026-10-16 点名）。
   *
   * 旧写法是拿正则去匹配源码文本（断言 index.ts 里出现过 kindTotals / overflow
   * 这两个词）—— 把 kindTotals 从响应体里删掉、只在别处留个同名标识符，断言照样
   * pass；而这段自己的注释还写着「钉行为不钉源码词」，自相矛盾。
   *
   * 改成直接喂一份**合成的 GalleryResponse** 给 verifyResponse（真实实现，不是桩）：
   *  · items 段：3 个真实文件（image×2 + page×1）+ 1 个不存在的（必须被核对剔除）；
   *  · overflow 段：1 个真实文件（page）—— 它**不进 items**，但必须进计数。
   * 这样「核对通过才计数」「overflow 也算」「按 kind 分组」三条语义全在同一断言里，
   * 任何一条被改坏都会当场失败。
   */
  {
    const { verifyResponse } = mod.galleryTest
    const counted = resolve(DELETE_KIT, 'counted')
    mkdirSync(counted, { recursive: true })
    const mk = (name) => {
      const p = resolve(counted, name)
      writeFileSync(p, 'x')
      return p
    }
    const item = (path, kind) => ({ path, name: path.split(/[\\/]/).pop(), kind, source: 'file', time: 1, sessionId: 'smoke-kinds' })
    const response = {
      items: [
        item(mk('k1.png'), 'image'),
        item(mk('k2.jpg'), 'image'),
        item(mk('k3.html'), 'page'),
        // 磁盘上不存在：verifyResponse 必须把它剔掉，且不计入任何 kind。
        item(resolve(counted, 'ghost.pdf'), 'pdf'),
      ],
      // 被 MAX_RESPONSE_ITEMS 截掉的那一段：只进计数、不进 items。
      overflow: [item(mk('k4.html'), 'page')],
      sessions: [{ id: 'smoke-kinds', title: null, cwd: null, count: 4, lastTime: 1 }],
      truncated: true,
    }
    const verified = verifyResponse(response, [])
    need(verified.items.length === 3,
      `verifyResponse 核对掉不存在的条目：items 剩 3（实得 ${verified.items.length}）`)
    need(JSON.stringify(verified.kindTotals) === JSON.stringify({ image: 2, page: 2 }),
      `kindTotals 按 kind 分组且含 overflow 段、不含被剔除项（实得 ${JSON.stringify(verified.kindTotals)}）`)
    // 反证：把 overflow 拿掉，计数必须真的少一条 —— 证明它确实参与了计数，
    // 而不是「恰好等于 items 的分布」蒙对的。
    const noOverflow = verifyResponse({ ...response, overflow: [] }, [])
    need(noOverflow.kindTotals?.page === 1,
      `去掉 overflow 后 page 计数降为 1（实得 ${noOverflow.kindTotals?.page}）—— 证明 overflow 真的参与了计数`)
    // 响应体本身不下发 overflow（它是传输细节，不是响应契约的一部分）。
    need(verified.overflow === undefined,
      'verifyResponse 不把 overflow 漏进核对后的响应对象（只在计数层消费）')
  }
  /*
   * ⑥b /media 的响应体里**真的有** kindTotals 字段（A1 的对外契约）。
   *
   * 上面 ⑥ 钉的是计数语义，这一条钉的是「字段有没有被真的写进 HTTP 响应」——
   * 把 kindTotals 从 json(...) 的载荷里删掉而保留内部标识符，只有这条能抓到。
   * 冒烟环境没有真会话（sessions/persistence 都是空桩），所以这里只断言字段形状：
   * 空索引下应为对象（client 用 `?? 0` 兜缺失键），非 undefined。
   */
  {
    const mediaRoute = routes.get('/api/triad/gallery')
    if (mediaRoute === undefined) {
      fail('/media 契约无法对拍：gallery 路由缺席')
    } else {
      const captured = { status: 0, body: null }
      mediaRoute.handler(
        {
          method: 'GET',
          url: '/api/triad/gallery/media',
          socket: { remoteAddress: '127.0.0.1' },
          headers: { host: '127.0.0.1:3080' },
          on: () => {},
        },
        {
          writeHead: (status) => { captured.status = status },
          end: (payload) => { try { captured.body = JSON.parse(payload) } catch { captured.body = null } },
          destroy: () => {},
        },
      )
      await new Promise((r) => setTimeout(r, 300))
      need(captured.status === 200, `GET /media answers 200（实得 ${captured.status}）`)
      need(captured.body !== null && typeof captured.body.kindTotals === 'object' && captured.body.kindTotals !== null,
        `GET /media 响应体里真的有 kindTotals 字段（实得 ${JSON.stringify(captured.body?.kindTotals)}）——`
        + ' 只保留内部标识符而不写进响应，这条会失败')
    }
  }
  try { rmSync(DELETE_KIT, { recursive: true, force: true }) } catch { /* 清不掉不影响断言 */ }
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
// 邮箱工具：6 个 mail_* 全注册（只留查看类，写类已整块下线）。
{
  const MAIL_TOOLS = [
    'mail_account', 'mail_list', 'mail_search', 'mail_read',
    'mail_download_attachment', 'mail_wait_code',
  ]
  const missing = MAIL_TOOLS.filter(name => !tools.includes(name))
  need(missing.length === 0, `mail tools registered (${MAIL_TOOLS.length} 个${missing.length > 0 ? `，缺 ${missing.join(', ')}` : ''})`)
  // 写类不得再注册：模型这一侧必须没有写信能力，否则「裁剪」只是文案变化。
  const WRITE_TOOLS = ['mail_send', 'mail_reply', 'mail_forward', 'mail_trash', 'mail_delete']
  const leaked = WRITE_TOOLS.filter(name => tools.includes(name))
  need(leaked.length === 0, `mail 写类工具不再注册（漏了 ${leaked.join(', ')}）`)
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
    // 2026-10-20：这条从「请别引外链」升级成「引了也不生效」——iframe 文档现在带
    // CSP（default-src none + connect-src none），外链与 fetch/XHR 全被浏览器拦。
    // 断言随之更新：提示词必须说的是**会被拦**，不是「离线会白屏」那种软提醒。
    ['外链一律被拦', 'CSP 硬拦外链与出网这一事实'],
    ['别贴整站', '卡片不是交付网站这一定位'],
    ['data-ds-dark-theme', '主题同步事实'],
    // 「卡片多一层灰底」事故（2026-10-15 实测）：模型给 `body` 铺了整页底色
    // `#f5f7f9`，宿主那层最低优先级的主题兜底色被盖掉，卡片在对话流里显成一块
    // 明显色差的板子——用户直接当成 bug 追问「为什么会有背景色」。
    ['背景别铺满整页', '整页底色会盖掉宿主兜底色这一事实'],
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
  /*
   * 这些开关的承载组件。
   *
   * 2026-10-15：用户要求删掉 composer 的「内置提示词通道」卡、把设置挪到 Seeker
   * 旁边，于是 team / 收口 / 邮箱三组开关的**客户端承载者**从
   * `triad/memory/Toggle.tsx` 换成 `kr-chat/KrPanelSettings.tsx`。
   * 断言对象随之迁移 —— 判的是 host 端点 ↔ 客户端键名逐字对齐，与它在哪个组件里无关。
   * 抽屉里的文案是硬编码中文而非 t() 键，所以下面按「键名出现在抽屉里」判，
   * 不再要求 `t('xxx')` 形式。
   */
  const clientToggle = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPanelSettings.tsx'), 'utf8')
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
    // 抽屉里这一行是硬编码中文「团队协作」，键仍留在 locales 供别处复用；
    // 这里判「团队协作」这一行确实在抽屉里（比 t() 形式更贴近实际写法）。
    need(clientToggle.includes('团队协作'), `抽屉里有 team 通道这一行（${key} 的承载者）`)
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
  //
  // 注意这段归一化逻辑仍在 Toggle.tsx（抽屉 import 它复用，不另写第二套口径），
  // 所以这里读的是**归一化的老家**，不是承载开关行的那个文件。
  const clientNormalize = readFileSync(resolve(ROOT, 'src/client/triad/memory/Toggle.tsx'), 'utf8')
  need(/todoClosureEnabled: res\.todoClosureEnabled !== false/.test(clientNormalize),
    'client 回包映射用 !== false 兜底（默认开通道的正确口径）')
  for (const key of ['todoClosureLabel', 'todoClosureHint']) {
    need(clientLocales.includes(`${key}:`), `locales 定义 ${key}`)
  }
  need(clientToggle.includes('回合结束自动收口'),
    '抽屉里有自动收口这一行（todoClosureLabel 的承载者）')
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

/*
 * ── Agent 邮箱通道（跨模块：dsh-mail 的声明 + 记忆卡片的开关）─────────────
 *
 * 这次修的是一个「两个开关套在一起、用户开的那个被吞掉」的静默失效：
 * 邮箱工作台总开关（mail.enabled）是启动期装配开关，用户关掉它之后，邮箱
 * 设置页里「对话里自动声明邮箱能力」照样显示成开，而注入一次都没跑过。
 * 用户的实际感受是「每次注册都要我提醒你用邮箱」。
 *
 * 三条断言各钉一个失效面：
 *  1. 注入器**必须现读闸门**（构造期拿一次布尔 = 拨开关不生效）；
 *  2. 声明文本必须写死「不要就邮箱向用户提问」（旧文案只写了「不要问用户要
 *     个人邮箱」，模型于是改问「你有邮箱吗」——对用户是同一个问题被反复问）；
 *  3. 工作台开关必须**运行时**可改（工具动态挂/卸），否则面板拨了要重启。
 */
{
  const mailInjectSrc = readFileSync(resolve(ROOT, 'src/mail/inject.ts'), 'utf8')
  const mailIndexSrc = readFileSync(resolve(ROOT, 'src/mail/index.ts'), 'utf8')
  const mailRegistrySrc = readFileSync(resolve(ROOT, 'src/mail/registry.ts'), 'utf8')

  // ① 闸门现读：注入器拿的是回调而不是构造期布尔。
  need(/isEnabled:\s*\(\)\s*=>/.test(mailIndexSrc) || /isEnabled\s*\(\s*\)/.test(mailIndexSrc),
    'mail 注入器的闸门是回调（现读配置），不是构造期布尔——否则拨开关不生效')
  need(/gate\.isEnabled\(\)/.test(mailInjectSrc),
    '注入器在每次 pre-step 现读闸门（构造期拿一次 = 运行中改配置不生效）')

  /*
   * ①b **声明与工具解耦**（用户明确要求）。
   *
   * 关掉邮箱工作台往往只是想省下那些 mail_* 工具每轮占的 schema，不该因此让模型
   * 忘掉自己有个邮箱——那样每次注册又要用户提醒一遍，正是这次要修的痛点。
   * 所以闸门只能读 `injectEnabled`，**绝不能**把 `enabled` 也相与进来。
   * 这条断言钉的就是那个相与（它曾经真的写在那里）。
   */
  need(/isEnabled:\s*\(\)\s*=>\s*service\.getConfig\(\)\.injectEnabled/.test(mailIndexSrc),
    '注入闸门只读 injectEnabled（与工作台总开关解耦）')
  need(!/isEnabled:\s*\(\)\s*=>\s*\{[\s\S]{0,200}?&&[\s\S]{0,80}?injectEnabled/.test(mailIndexSrc),
    '注入闸门不得把 enabled 与 injectEnabled 相与（那会让工作台一关、声明跟着哑掉）')
  // 工具缺席时注入文本必须换一份（走 agently-cli），否则声明了却无能力可用。
  need(/MAIL_CLI_FALLBACK_RULE/.test(mailInjectSrc),
    '工具缺席时注入文本走 agently-cli 命令行版本（否则声明了却让模型去调不存在的工具）')
  need(/toolsAvailable/.test(mailInjectSrc) && /toolsAvailable:\s*\(\)\s*=>/.test(mailIndexSrc),
    '注入器按「工具在不在」二选一文本（toolsAvailable 回调）')
  // CLI 命令必须是本机实测过的那几条（写错一条模型就跑不通），且**只有只读命令**：
  // 写类工具已下架，兜底说明里再出现发信命令 = 又给了模型一条写信路。
  for (const [needle, why] of [
    ['agently-cli message +list', '列邮件命令（实测可用）'],
    ['agently-cli message +read --id', '读邮件命令'],
    ['绝不臆造验证码', '轮询收码时的诚实底线'],
  ]) {
    need(mailInjectSrc.includes(needle), `CLI 兜底声明必须写清「${why}」（缺 ${needle}）`)
  }
  for (const [needle, why] of [
    ['message +send', '发信'],
    ['message +reply', '回信'],
    ['message +forward', '转发'],
    ['--confirmation-token', '两阶段确认第二段'],
    ['--confirmed', '两阶段确认跳过'],
  ]) {
    need(!mailInjectSrc.includes(needle), `CLI 兜底声明不得再出现「${why}」（${needle}）`)
  }

  // ② 声明强度：必须点名「不要就邮箱向用户提问」，并给出例外（用户指定了自己的邮箱）。
  //    只写「不要问用户要个人邮箱」时，模型会改问「你有邮箱吗 / 要不要用你的邮箱注册」，
  //    用户体感仍是同一个问题被反复问。
  for (const [needle, why] of [
    ['不要就「用哪个邮箱」向用户提问', '禁止就邮箱征求许可（旧文案只禁「要个人邮箱」，模型改问「你有邮箱吗」）'],
    ['你有邮箱吗', '把模型会改口的那几种问法逐一点名'],
    ['要不要用你的邮箱注册', '同上（这是实测里最像的一句）'],
    ['用户当轮明确说了', '给出唯一例外：用户指定了自己的邮箱'],
  ]) {
    need(mailInjectSrc.includes(needle), `邮箱声明必须写清「${why}」（缺 ${needle}）`)
  }

  // ③ 工作台开关运行时生效：service 要有配置变更订阅，装配层要订阅它。
  need(/onConfigChange/.test(readFileSync(resolve(ROOT, 'src/mail/service.ts'), 'utf8')),
    'MailService 提供 onConfigChange（工具动态挂/卸的订阅口）')
  need(/service\.onConfigChange\(/.test(mailIndexSrc),
    '装配层订阅配置变更（不订阅 = 面板拨总开关要重启 DSH 才生效）')
  need(/registerMailTools\(ctx, service\)/.test(mailIndexSrc) && /toolsDispose\?\.\(\)/.test(mailIndexSrc),
    '工具随 enabled 动态注册与注销（只注册不注销 = 关掉后模型仍能调 mail_*）')
  /*
   * `ctx.effect(cb)` 是**立即执行** cb、拿返回值当 disposer。写成
   * `ctx.effect(() => { toolsDispose?.(); toolsDispose = null })` 会在注册的
   * 下一行就把刚挂上的工具全注销 —— 而且是静默的（模型看不见 mail_*，路由却
   * 一切正常）。这个 bug 本次真的写出来过，由「mail_* 都注册」那条断言
   * 当场抓到，所以在这里再钉一道静态防线：注销必须包在内层函数里。
   */
  need(/ctx\.effect\(\(\)\s*=>\s*\(\)\s*=>\s*\{[^}]*toolsDispose/.test(mailIndexSrc),
    'ctx.effect 的注销回调必须包一层（外层立即执行，裸写会在注册下一行就把工具注销掉）')
  /*
   * 2026-10-18 反向断言：「新邮件实时监听」整块删掉后不得复活。
   *
   * 那条能力跑起来是一个 agently-cli message +watch 常驻长轮询进程，产出只有
   * 「面板开着时弹一个 toast」，面板一关什么都没有；而且事件缓冲从不清空，
   * 每次打开面板都会把历史事件当新邮件误报一遍。删掉是用户点名的决定（方案 A），
   * 所以这里钉死：源码里不该再出现 watcher / watchEnabled / 事件缓冲。
   */
  need(!/MailWatcher|watchEnabled|mountedWatch|startWatch/.test(mailIndexSrc),
    '邮箱装配层不得再有 watch（新邮件实时监听已整块下线，别复活常驻长轮询进程）')
  need(!/listEvents|pushEvent|clearEvents/.test(readFileSync(resolve(ROOT, 'src/mail/store.ts'), 'utf8')),
    'MailStore 不得再有新邮件事件缓冲（它从不清空，是「每次开面板误报新邮件」的根因）')
  // 必须剥注释再判：文件头注释里**叙述**了「删掉 /events 与 /watch」，那是
  // 解释不是代码，拿全文匹配会变成「越解释越违规」。
  const mailApiClean = readFileSync(resolve(ROOT, 'src/mail/api.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  need(!/rest === '\/events|rest === '\/watch/.test(mailApiClean),
    '邮箱路由不得再挂 /events 与 /watch（功能下线了，路由留着就是给不存在的能力开后门）')

  // ④ 跨模块状态槽位：记忆卡片读邮箱状态不能走 ctx 赋值（cordis 会 throw）。
  need(/setMailStatusSource/.test(mailIndexSrc) && /clearMailStatusSource/.test(mailIndexSrc),
    'mail 模块装配时写入状态槽位、卸载时清空')
  need(/getMailStatusSource/.test(readFileSync(resolve(ROOT, 'src/triad/memory/api.ts'), 'utf8')),
    '记忆路由经槽位读邮箱状态（不这样做就得把实例挂 ctx，cordis 会 throw）')
  need(!/ctx\.(mailStatusSource|mailStatus)\s*=/.test(mailRegistrySrc + mailIndexSrc),
    '不得把邮箱实例挂到 ctx 属性上（未 declare 的属性赋值会让插件树 boot 失败）')

  // ⑤ 端点语义：`enabled` 只跟声明开关走，与工作台总开关**解耦**。
  const mailRoute = routes.get('/api/dsh-memory')
  if (mailRoute !== undefined) {
    const callMail = async (method, url) => {
      const captured = { status: 0, body: null }
      const res = {
        writeHead: (status) => { captured.status = status },
        end: (payload) => { try { captured.body = JSON.parse(payload) } catch { captured.body = null } },
      }
      const req = { method, url, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } }
      mailRoute.handler(req, res)
      await new Promise((r) => setTimeout(r, 80))
      return captured
    }
    const got = await callMail('GET', '/api/dsh-memory/mail-inject-state')
    need(got.status === 200, `GET /mail-inject-state answers 200（实得 ${got.status}）`)
    // 冒烟把 mail.enabled 与 injectEnabled 都钉成 true，所以这里应为真。
    need(got.body?.enabled === true, `声明默认生效（实得 ${JSON.stringify(got.body)}）`)
    // 解耦的**行为**证据：enabled 必须与 injectEnabled 逐字一致，而不是与
    // 「工作台 && 声明」一致。把两者相与正是要修的那个坑。
    need(got.body?.enabled === got.body?.injectEnabled,
      'enabled 必须等于 injectEnabled（与工作台总开关解耦，不是两者相与）')
    need(typeof got.body?.workbenchEnabled === 'boolean', '回传工作台总开关状态')
    need(typeof got.body?.toolsMounted === 'boolean', '回传 toolsMounted（卡片据此说「走命令行」）')
    // inject-state 合并回包也要带上，否则卡片一次 hover 拿不到邮箱状态。
    const is = await callMail('GET', '/api/dsh-memory/inject-state?sessionId=smoke-mail')
    need(typeof is.body?.mailEnabled === 'boolean', 'GET /inject-state 顺带回传 mailEnabled')
    need(typeof is.body?.mailAvailable === 'boolean', 'GET /inject-state 顺带回传 mailAvailable（区分「关着」与「没挂」）')
    need(typeof is.body?.mailToolsMounted === 'boolean', 'GET /inject-state 顺带回传 mailToolsMounted')
  }
  // client 侧：解耦后的消费点必须都在。
  //
  // 2026-10-15：邮箱那一行的承载者从 Toggle.tsx 换到 KrPanelSettings.tsx，
  // 且抽屉里的副说明是**硬编码中文**（含地址插值），不走 t() 键。断言按实际写法钉：
  // 「工具缺席 → 走命令行」这一分支必须真实存在（画成关/逼用户开工作台都是错的）。
  const clientMailCarrier = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPanelSettings.tsx'), 'utf8')
  const mailLocales = readFileSync(resolve(ROOT, 'src/client/triad/memory/locales.ts'), 'utf8')
  for (const key of ['mailInjectLabel', 'mailInjectHint', 'mailInjectHintCli', 'mailInjectUnavailable', 'mailInjectUnauthorized']) {
    need(mailLocales.includes(`${key}:`), `locales 定义 ${key}`)
  }
  // 工作台关着时副说明必须换成「走命令行」那一版，而不是把开关画成关。
  need(/mailToolsMounted/.test(clientMailCarrier) && /agently-cli 命令行收发/.test(clientMailCarrier),
    '工具缺席时副说明换「走命令行」版（画成关/逼用户开工作台都是错的）')
  need(!/mailInjectWorkbenchOff|mailInjectEnableWorkbench/.test(clientMailCarrier),
    '不再有「工作台关着 → 声明不注入」的旧文案与「打开工作台」按钮（两者已解耦）')
  // 邮箱在抽屉里的那一行必须只有「声明」一个写入点（不信「工作台」那条死路径）。
  need(/setMailInjectState/.test(clientMailCarrier),
    '抽屉写邮箱声明走 setMailInjectState（跨模块落 dsh-mail 的 injectEnabled）')
}

/*
 * ── 工作区「项目记忆记录开关」（项目 meta 的 autoMemory）经 /inject-state 读写 ──
 *
 * 这个开关是**写入侧**的，不是注入（读取）侧：关掉它，该工作区不再自动提取记忆
 * （index.ts:188 的提取闸门）、模型也不能手动记项目层（tools.ts:112 的写入闸门）。
 * 宿主侧一直是同一个 per-project `autoMemory` 字段，本端点只是把它转出来给
 * 「大盘设置」抽屉读、并接受回写，所以这组断言钉的是三件事：
 *   1. 读得到**真值**（有 meta 读 meta、没 meta 走默认开）；
 *   2. 写得到**盘上**（GET 回读得到、且 meta.json 真的存在）；
 *   3. 写的时候**只覆盖 autoMemory**（alias / locked / injectExcluded / path 一个不丢）
 *      —— 整份 replace 会把用户改过的别名和「锁定归属 / 排除注入」静默清空。
 *
 * 另外两条容易漏的语义：
 *   · 无 cwd 时三件套必须是 null（不是 false、也不是凭空造一个项目）；
 *   · `enabled`（每会话注入开关）与 `projectMemory`（每工作区记录开关）**互不干扰**
 *     —— 只传 enabled 时回包与行为要和加字段前逐字一致。
 *
 * 隔离：DSH_HOME 已在脚本顶部指向工作区 `_tmp/smoke-triad-host-dsh-home`，临时
 * 工作区目录也落在 `_tmp/` 下，全程碰不到用户真实的记忆库。
 */
{
  const route = routes.get('/api/dsh-memory')
  need(route !== undefined, 'memory prefix route reachable for the project-memory assertion')
  if (route !== undefined) {
    const { mkdirSync, readFileSync: readFile, writeFileSync, readdirSync } = await import('node:fs')
    /** 临时工作区：真实存在的目录（路由只按路径派生 hash，不要求它是 DSH 工作区）。 */
    const WORKSPACE = resolve(ROOT, '_tmp', 'project-memory-workspace')
    mkdirSync(WORKSPACE, { recursive: true })
    const projectsRoot = resolve(SMOKE_DSH_HOME, 'memories', 'dsh-memory', 'projects')
    const metaPathOf = (hash) => resolve(projectsRoot, hash, 'meta.json')
    const readMeta = (hash) => {
      try { return JSON.parse(readFile(metaPathOf(hash), 'utf8')) } catch { return null }
    }
    const projectDirCount = () => {
      try { return readdirSync(projectsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).length } catch { return 0 }
    }
    // handler 是异步的（且 POST 要走 readBody 的 data/end 两个事件），桩必须真的发事件。
    const callJson = async (method, url, body) => {
      const captured = { status: 0, body: null }
      const res = {
        writeHead: (status) => { captured.status = status },
        end: (payload) => { try { captured.body = JSON.parse(payload) } catch { captured.body = null } },
      }
      const req = {
        method,
        url,
        socket: { remoteAddress: '127.0.0.1' },
        headers: { host: '127.0.0.1:3080' },
        on: (event, handler) => {
          if (event === 'data') handler(Buffer.from(JSON.stringify(body ?? {})))
          else if (event === 'end') handler()
          return req
        },
      }
      route.handler(req, res)
      await new Promise((r) => setTimeout(r, 120))
      return captured
    }

    // ① 无 cwd：三件套全 null，且既有回包字段一个都不少（composer 卡片全靠这份回包）。
    const none = await callJson('GET', '/api/dsh-memory/inject-state?sessionId=smoke-projmem')
    need(none.status === 200, `GET /inject-state（无 cwd）answers 200（实得 ${none.status}）`)
    need(none.body?.projectHash === null && none.body?.projectPath === null && none.body?.projectMemoryEnabled === null,
      `无 cwd 时 project* 三件套全 null（实得 ${JSON.stringify({ h: none.body?.projectHash, p: none.body?.projectPath, e: none.body?.projectMemoryEnabled })}）`)
    need(typeof none.body?.enabled === 'boolean' && typeof none.body?.defaultEnabled === 'boolean' && typeof none.body?.mailEnabled === 'boolean',
      '新增字段不挤掉既有回包字段（enabled / defaultEnabled / mailEnabled 仍在）')

    // ② 带 cwd 读：hash 是 12 位 hex、path 原样回显、开关默认开（meta 还不存在）。
    const fresh = await callJson('GET', `/api/dsh-memory/inject-state?sessionId=smoke-projmem&cwd=${encodeURIComponent(WORKSPACE)}`)
    need(typeof fresh.body?.projectHash === 'string' && /^[0-9a-f]{12}$/.test(fresh.body.projectHash),
      `projectHash 是 12 位 hex（实得 ${JSON.stringify(fresh.body?.projectHash)}）`)
    need(fresh.body?.projectPath === WORKSPACE, `projectPath 原样回显 cwd（实得 ${JSON.stringify(fresh.body?.projectPath)}）`)
    need(fresh.body?.projectMemoryEnabled === true,
      `meta 缺失时项目记忆默认开（实得 ${JSON.stringify(fresh.body?.projectMemoryEnabled)}）`)
    const hash = fresh.body.projectHash
    need(readMeta(hash) === null, '只读一次不带写：GET 不得凭空创建 meta.json')

    // ③ 写入侧：POST projectMemory:false（meta 还不存在）→ 必须真的落盘，不能静默失败。
    const off = await callJson('POST', '/api/dsh-memory/inject-state', {
      sessionId: 'smoke-projmem', enabled: true, cwd: WORKSPACE, projectMemory: false,
    })
    need(off.status === 200 && off.body?.ok === true, `POST /inject-state（projectMemory:false）answers 200 ok（实得 ${off.status} / ${JSON.stringify(off.body)}）`)
    need(off.body?.projectMemoryEnabled === false && off.body?.projectHash === hash && off.body?.projectPath === WORKSPACE,
      `回包回读真实值 false（不是回显意图值，实得 ${JSON.stringify(off.body?.projectMemoryEnabled)}）`)
    const created = readMeta(hash)
    need(created !== null && created.autoMemory === false && created.path === WORKSPACE,
      `meta 不存在时被创建且带上 path（实得 ${JSON.stringify(created)}）`)

    // ④ 再 GET 同一 cwd：读到的必须是盘上的 false（证明落盘，而不是只在内存里）。
    const afterOff = await callJson('GET', `/api/dsh-memory/inject-state?sessionId=smoke-projmem&cwd=${encodeURIComponent(WORKSPACE)}`)
    need(afterOff.body?.projectMemoryEnabled === false,
      `关闭后 GET 同一 cwd 读到 false（实得 ${JSON.stringify(afterOff.body?.projectMemoryEnabled)}）——读了却没落盘会让抽屉显示假状态`)

    // ⑤ 只覆盖 autoMemory：先把 meta 写成带全字段的样子，再拨开关，其它字段一个都不能丢。
    writeFileSync(metaPathOf(hash), JSON.stringify({
      path: WORKSPACE, alias: '不要抹掉我', locked: true, injectExcluded: true, autoMemory: false,
    }))
    const back = await callJson('POST', '/api/dsh-memory/inject-state', {
      sessionId: 'smoke-projmem', cwd: WORKSPACE, projectMemory: true,
    })
    need(back.body?.projectMemoryEnabled === true,
      `POST projectMemory:true 能改回来（实得 ${JSON.stringify(back.body?.projectMemoryEnabled)}）`)
    const kept = readMeta(hash) ?? {}
    need(kept.alias === '不要抹掉我' && kept.locked === true && kept.injectExcluded === true && kept.path === WORKSPACE,
      `写开关只覆盖 autoMemory，meta 其它字段不被抹掉（实得 ${JSON.stringify(kept)}）`)

    // ⑥ `enabled` / `projectMemory` 互不干扰：只传 enabled 时新三件套走 null 分支，
    //    既有三件套（ok/enabled/defaultEnabled/explicit）与加字段前逐字一致。
    const enabledOnly = await callJson('POST', '/api/dsh-memory/inject-state', { sessionId: 'smoke-projmem', enabled: false })
    need(enabledOnly.body?.enabled === false && enabledOnly.body?.explicit === true && enabledOnly.body?.defaultEnabled === true,
      `只传 enabled 时既有回包语义不变（实得 ${JSON.stringify(enabledOnly.body)}）`)
    need(enabledOnly.body?.projectHash === null && enabledOnly.body?.projectPath === null && enabledOnly.body?.projectMemoryEnabled === null,
      '只传 enabled 时不得顺带改写任何项目开关（cwd 缺失 → 三件套 null）')
    const afterEnabledOnly = await callJson('GET', `/api/dsh-memory/inject-state?sessionId=smoke-projmem&cwd=${encodeURIComponent(WORKSPACE)}`)
    need(afterEnabledOnly.body?.projectMemoryEnabled === true,
      '只拨会话注入开关不改工作区记录开关（两者互不干扰）')

    // ⑦ 无 cwd 的 POST projectMemory：静默忽略（不报错、不写盘）——不知道是哪个项目时，
    //    凭空造一个项目比什么都不做更糟（开关会落到一个用户看不见的 hash 上）。
    const before = projectDirCount()
    const noCwd = await callJson('POST', '/api/dsh-memory/inject-state', {
      sessionId: 'smoke-projmem', enabled: true, projectMemory: false,
    })
    need(noCwd.status === 200 && noCwd.body?.ok === true, `无 cwd 时 POST projectMemory 不报错（实得 ${noCwd.status} / ${JSON.stringify(noCwd.body)}）`)
    need(noCwd.body?.projectMemoryEnabled === null && noCwd.body?.projectHash === null,
      '无 cwd 时 POST 不回一个假的项目状态（三件套仍为 null）')
    need(projectDirCount() === before, `无 cwd 时 POST 不写任何项目目录（前 ${before} 后 ${projectDirCount()}）`)
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
