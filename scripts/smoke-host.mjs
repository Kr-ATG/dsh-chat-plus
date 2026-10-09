/**
 * dsh-chat-plus — host 半身冒烟测试。
 *
 * 断言 lib/index.js 在裸 node（无 tsx、无 DSH 运行时）下可加载，并导出
 * 合法的 Cordis 插件形状。host 半身现在注册三条路由：
 *
 *   1. GET  /api/chat-flow/generated-images（exact）：spill 图片读取；
 *   2. prefix /api/chat-flow/download（prefix）：下载工具实时进度；
 *   3. prefix /api/chat-flow/screenshot（prefix）：对话截图渲染
 *      （render/save/reveal/image/diagnose）。
 *
 * 两者都走 `ctx.inject(['webServer'], cb)` —— 延迟注入，绝不是 apply 直接读
 * ctx.webServer（cordis 的 ctx 是 Proxy，未在 inject 中声明的属性一读
 * 就抛 `cannot get property "webServer" without inject`，会连累整棵
 * 插件树 boot 失败 → 3080 起不来——2026-09-03 真实踩坑）。
 *
 * 所以本冒烟除了检查自包含与导出形状，还实际驱动 apply()：
 *   1. 提供最小 ctx.inject stub，捕获延迟注入回调；
 *   2. 提供最小 webCtx（effect + webServer.register），执行回调并断言
 *      两条路由注册的 kind/path 一模一样；
 *   3. 裸 apply 直接访问 webServer 的老写法在这里必然 TypeError → FAIL。
 *
 * 验收：源码目录与「已安装位置」各跑一遍。
 * Usage: node scripts/smoke-host.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const HOST = resolve(ROOT, 'lib/index.js')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

// 先做文本守卫：安装位置解析不了的 specifier 一个都不许出现——包括
// `@deepseek-ai/*`。融合进来的工作台把需要的 DSH 叶子模块全部 vendor 化在
// src/vendor/ 下（含 dsh-util-crypto），所以产物对 @deepseek-ai/* 零运行时依赖；
// `@deepseek-ai/cordis` 只会以 `import type` 出现，构建时擦除。
const source = readFileSync(HOST, 'utf8')
const HOST_EXTERNAL_ALLOWLIST = new Set([
])
const externalImports = [...source.matchAll(
  /(?:^|[;\n])\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g,
)].map(m => m[1]).filter(spec => !spec.startsWith('node:') && !HOST_EXTERNAL_ALLOWLIST.has(spec))
if (externalImports.length > 0) {
  fail(`host bundle still imports non-node specifiers: ${externalImports.join(', ')}`)
} else {
  pass('host bundle is fully self-contained (no @deepseek-ai/* runtime imports)')
}

const mod = await import(new URL(`file://${HOST.replace(/\\/g, '/')}`))
if (mod.name !== 'dsh-chat-plus') fail(`expected name "dsh-chat-plus", got ${JSON.stringify(mod.name)}`)
else pass(`exports name = ${mod.name}`)
if (typeof mod.apply !== 'function') fail('apply is not a function')
else pass('exports apply()')

// ── 最小 cordis 桩：延迟注入 + 路由注册捕获 ──────────────────────────────
const registered = []
const unregistered = []
let effectRan = false
let effectDisposer = null
const injectNamesSeen = []
const registeredTools = []
const registeredCommands = []
const assembleListeners = []
const providerRoutes = []
const providerTools = []
const providerNamespaces = []
const liveRouteAgent = { id: 'route-session' }
const providerCtx = {
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get: (name) => (name === 'credentials' ? { describe: () => [], set: () => {}, unset: () => {}, resolve: () => undefined } : undefined),
  inject(_names, cb) { cb(providerCtx) },
  provide: () => {},
  // vision-helper 用 ctx.on('llm/stream') 挂图片自动降级的 waterfall。
  on: () => () => {},
  settings: {
    register: (ns) => { providerNamespaces.push(ns); return { get: () => ({}), update: async () => {} } },
    get: () => ({ providers: {} }),
    describe: () => [],
    mutate: async () => {},
  },
  webServer: { register(spec) { providerRoutes.push(spec); return () => {} } },
  tools: { register(def) { providerTools.push(def); return () => {} } },
  llm: { listProviders: () => [], listConfigurableProviders: () => [], listModels: async () => [], resolveModelInfo: async () => undefined },
  fs: { resolve: async (p) => p, readText: async () => '{}', writeText: async () => {} },
  shell: { resolve: () => ({}), execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  web: { registerSearchProvider: () => {} },
}
const stubCtx = {
  // 老写法（apply 里直接 ctx.webServer.xxx）在这里拿不到该属性 → TypeError。
  inject(names, callback) {
    injectNamesSeen.push([...names])
    // 工具闸门的命令注册面：只有它注入 ['commands']。
    if (names.includes('commands')) {
      callback({
        commands: {
          register(definition) { registeredCommands.push(definition); return () => {} },
        },
      })
      return
    }
    // 供应商中心的延迟注入：8 个服务（settings/webServer/llm/tools/fs/
    // sandboxPolicy/shell/web）齐全时才回调。
    // 供应商中心的延迟注入：服务名里带 fs（只有 providerHubServices 会这么写）。
    if (names.includes('fs')) {
      callback(providerCtx)
      return
    }
    if (names.includes('tools')) {
      // tools 桩：download 工具注册捕获。
      callback({
        effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
        tools: { register(definition) { registeredTools.push(definition); return () => {} } },
      })
      return
    }
    const webCtx = {
      effect(fn, label) {
        effectRan = true
        // cordis 在 fiber 提交时执行 effect；返回值为可选 disposer（真实
        // webServer.register 返回 () => void；渲染器回收这类清理 effect
        // 返回 undefined 也是合法的——见 src/shot/index.ts 的 shutdown）。
        const disposer = fn()
        if (typeof disposer === 'function') effectDisposer = disposer
        return disposer
      },
      webServer: {
        // 与真实 register 一致：返回注销函数。
        register(spec) {
          registered.push(spec)
          return () => { unregistered.push(spec) }
        },
      },
    }
    callback(webCtx)
  },
  // 工具闸门挂 system-prompt/assemble 出口过滤（工具注册层级无关，一律过组装）。
  on(event, listener) { if (event === 'system-prompt/assemble') assembleListeners.push(listener) },
  // tools 服务用于命令文案里的体积统计（无 inject 要求，故走 ctx.get）；
  // agents 用于把状态路由收到的 session id 换回 agent 对象。
  // 注意：必须返回**同一个** agent 对象——闸门状态挂在 agent 上的 WeakMap 里，
  // 每次新建对象会让写入的状态读不回来（真实运行时 agents.get 也返回稳定对象）。
  get(name) {
    if (name === 'agents') return { get: (id) => (id === 'route-session' ? liveRouteAgent : undefined) }
    if (name !== 'tools') return undefined
    return {
      schemas: () => [
        { name: 'cua_driver_native__click', description: 'click', parameters: { type: 'object' } },
        { name: 'cua_driver_native__drag', description: 'drag', parameters: { type: 'object' } },
        { name: 'mcp__playwright-mcp__browser_click', description: 'click', parameters: { type: 'object' } },
        { name: 'pwsh', description: 'shell', parameters: { type: 'object' } },
      ],
    }
  },
}

try {
  mod.apply(stubCtx)
  pass('apply(ctx) ran without throwing')
} catch (error) {
  fail(`apply(ctx) threw: ${error?.stack ?? error}`)
}

if (!injectNamesSeen.some(names => JSON.stringify(names) === JSON.stringify(['webServer']))) {
  fail(`expected deferred inject ['webServer'], saw ${JSON.stringify(injectNamesSeen)}`)
} else {
  pass('apply defers webServer access via ctx.inject(["webServer"], cb)')
}
if (!injectNamesSeen.some(names => JSON.stringify(names) === JSON.stringify(['tools']))) {
  fail(`expected deferred inject ['tools'], saw ${JSON.stringify(injectNamesSeen)}`)
} else {
  pass('apply defers tools access via ctx.inject(["tools"], cb)')
}
// download（本插件）+ generate_image / generate_video（融合的 dsh-provider-hub
// 的 capabilities-host；后者由 providerHubServices 的延迟注入回调注册）。
const allTools = [...registeredTools, ...providerTools]
const toolNames = allTools.map(t => t?.name)
for (const expected of ['download', 'generate_image', 'generate_video']) {
  const tool = allTools.find(t => t?.name === expected)
  if (tool === undefined) {
    fail(`missing registered wire tool '${expected}', got ${JSON.stringify(toolNames)}`)
    continue
  }
  if (typeof tool.execute !== 'function') fail(`${expected} tool has no execute()`)
  else if (typeof tool.output?.render !== 'function') fail(`${expected} tool has no output.render()`)
  else pass(`registered wire tool: ${expected} (execute + output.render present)`)
}

if (!effectRan) fail('deferred webServer callback never ran')
else pass('deferred webServer callback executed')

// 7 条：本插件 7 条（generated-images / open-path / tools-gate 三条 exact +
// screenshot / download / office / fonts 四条 prefix）+ 融合的 dsh-provider-hub 5 条
// （/api/dsh-proxy、/api/model-capabilities、/api/provider-hub-keys 三条 prefix +
// /api/dsh-prompt-optimize 与 /stop 两条 exact）。
// open-path 是「用文件资源管理器打开」改道用的（windowsHide 会吞掉 Explorer）。
// office 是 2026-10-06 新增：ppt/word/pdf 的页图与 PDF 渲染（画廊缩略图、
// 产出物弹窗内联预览、官方侧边栏接管三处共用）。
// fonts 是「界面字体」的资产路由（霞鹜新致宋 woff2 不内联进 client 产物）。
if (registered.length !== 7) {
  fail(`expected exactly 7 route registrations, got ${registered.length}: ${JSON.stringify(registered)}`)
} else {
  const exacts = registered.filter(spec => spec?.kind === 'exact')
  const prefix = registered.filter(spec => spec?.kind === 'prefix')
  if (!exacts.some(spec => spec?.path === '/api/chat-flow/generated-images')) {
    fail(`unexpected exact route specs: ${JSON.stringify(exacts)}`)
  } else if (!exacts.some(spec => spec?.path === '/api/chat-flow/open-path')) {
    fail('missing open-path route (exact /api/chat-flow/open-path)')
  } else if (!exacts.some(spec => spec?.path === '/api/chat-flow/tools-gate')) {
    fail('missing tools-gate route (exact /api/chat-flow/tools-gate)')
  } else {
    pass('registered GET /api/chat-flow/generated-images + /open-path + /tools-gate (kind=exact)')
  }
  const downloadRoute = prefix.find(spec => spec?.path === '/api/chat-flow/download')
  if (downloadRoute === undefined) {
    fail('missing download progress route (prefix /api/chat-flow/download)')
  } else {
    pass('registered GET /api/chat-flow/download/progress (kind=prefix)')
  }
  const screenshot = prefix.find(spec => spec?.path === '/api/chat-flow/screenshot')
  if (screenshot === undefined) {
    fail(`unexpected prefix route spec: ${JSON.stringify(prefix)}`)
  } else {
    pass('registered /api/chat-flow/screenshot (kind=prefix, render/save/reveal/image/diagnose)')
  }
  const office = prefix.find(spec => spec?.path === '/api/chat-flow/office')
  if (office === undefined) {
    fail('missing office preview route (prefix /api/chat-flow/office)')
  } else {
    pass('registered /api/chat-flow/office (kind=prefix, info/page/pdf/thumb)')
  }
  const fonts = prefix.find(spec => spec?.path === '/api/chat-flow/fonts')
  if (fonts === undefined) {
    fail(`missing font asset route (prefix /api/chat-flow/fonts): ${JSON.stringify(prefix)}`)
  } else {
    pass('registered /api/chat-flow/fonts (kind=prefix, woff2 + license)')
  }
  for (const spec of registered) {
    if (typeof spec?.handler !== 'function') fail(`route handler is not a function: ${spec?.path}`)
  }
  pass('both route handlers are functions')
  const disposer = effectDisposer
  if (typeof disposer === 'function') pass('routes return disposers (unregisterable)')
  else fail('route registration did not return an unregister disposer')
}

/* ── 界面字体：资产必须真的随包存在 + 路由真的吐得出来 ────────────────────
 *
 * 这块的失效方式全是静默的：资产没进包 → 用户切到霞鹜新致宋后浏览器拿 404，
 * 页面**不会报错**，只是悄悄回退系统字体，看起来像「功能没生效」；路由把任意
 * 文件名也放行 → 变成任意文件读。所以既要断言文件在位，也要真发请求。
 */
{
  const FONT_DIR = resolve(ROOT, 'assets', 'fonts')
  const woff2 = resolve(FONT_DIR, 'lxgw-neozhisong-screen.woff2')
  const license = resolve(FONT_DIR, 'IPA-Font-License-1.0.md')
  if (!existsSync(woff2)) {
    fail(`字体资产缺失：${woff2}（切到霞鹜新致宋会静默回退系统字体）`)
  } else {
    const size = statSync(woff2).size
    // 全字集约 5MB；明显偏小说明是子集或文件被截断（掉字同样不报错）。
    if (size < 3 * 1024 * 1024) fail(`字体资产偏小（${(size / 1024 / 1024).toFixed(2)} MB），可能被截断或误换成子集`)
    else pass(`字体资产在位（${(size / 1024 / 1024).toFixed(2)} MB 全字集 woff2）`)
  }
  if (!existsSync(license)) fail(`字体许可文件缺失：${license}（IPA 协议要求随字体一并分发）`)
  else pass('字体许可原文随包分发（IPA Font License 1.0）')

  // 产物必须**不**内联字体：4.15MB 的 base64 会让所有用户白下载 5.5MB。
  const clientBundle = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')
  if (clientBundle.includes('data:font/woff2;base64,')) {
    fail('client 产物内联了字体 base64（每个用户都要白下载，必须走 host 路由）')
  } else {
    pass('client 产物未内联字体（默认档零下载，按需拉取）')
  }

  // 真链路：起 http 服务挂路由，验证命中 / 未知名 / HEAD。
  const http = await import('node:http')
  const fontRegs = []
  const fontWebCtx = {
    logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    webServer: { register(spec) { fontRegs.push(spec); return () => {} } },
  }
  mod.applyFontRoutes(fontWebCtx)
  const fontRoute = fontRegs.find(spec => spec?.path === '/api/chat-flow/fonts')
  if (fontRoute === undefined) {
    fail('applyFontRoutes 未注册 /api/chat-flow/fonts')
  } else {
    const server = http.createServer((req, res) => fontRoute.handler(req, res))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const request = (method, path) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      })
      req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }))
      req.end()
    })
    try {
      const hit = await request('GET', '/api/chat-flow/fonts/lxgw-neozhisong-screen.woff2')
      // woff2 的魔数：'wOF2'。断言真实字体字节而不是只看 200 —— 200 空体同样
      // 会让浏览器静默回退，是最难发现的那种坏法。
      const magic = hit.body.subarray(0, 4).toString('latin1')
      if (hit.status !== 200) fail(`字体路由应 200，实得 ${hit.status}`)
      else if (hit.headers['content-type'] !== 'font/woff2') fail(`字体 content-type 应为 font/woff2，实得 ${hit.headers['content-type']}`)
      else if (magic !== 'wOF2') fail(`字体响应不是 woff2（魔数 ${JSON.stringify(magic)}）`)
      else if (Number(hit.headers['content-length']) !== hit.body.length) fail('字体 content-length 与实际字节数不符')
      else if (!/immutable/.test(String(hit.headers['cache-control']))) fail(`字体应带 immutable 缓存头，实得 ${hit.headers['cache-control']}`)
      else pass(`字体路由端到端可用（${hit.body.length} 字节 woff2 + immutable 缓存）`)

      const licenseHit = await request('GET', '/api/chat-flow/fonts/IPA-Font-License-1.0.md')
      if (licenseHit.status !== 200) fail(`许可文件应 200，实得 ${licenseHit.status}`)
      else pass('许可文件可经路由取到（前端可链接）')

      const head = await request('HEAD', '/api/chat-flow/fonts/lxgw-neozhisong-screen.woff2')
      if (head.status !== 200 || head.body.length !== 0) fail(`HEAD 应 200 且无体，实得 ${head.status}/${head.body.length}`)
      else pass('HEAD 请求回 200 无体（浏览器探测不白传 4MB）')

      // 未知文件名必须 404 —— 这条路由族**不能**变成任意文件读。
      for (const bad of ['/api/chat-flow/fonts/../../../etc/passwd', '/api/chat-flow/fonts/secret.txt', '/api/chat-flow/fonts/']) {
        const res = await request('GET', bad)
        if (res.status !== 404) fail(`未知名应 404（防任意文件读），${bad} 实得 ${res.status}`)
      }
      pass('未知/穿越文件名一律 404（不回落成任意文件读）')
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  }
}

// ── 数据安全与注入面（读源码断言，锁住这轮修掉的 P0/P1）──────────────────
// 断言读源码而不是 bundle：这些契约全都在源码的字面写法上（清 dirty 的先后、
// tmp 名是否唯一、有没有接 catch），从压缩后的产物里反而看不出来。

const srcOf = (rel) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8')
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1 ')

const storeSrc = stripComments(srcOf('src/triad/memory/engine/store.ts'))
if (/\n\s*const temp = `\$\{file\}\.tmp`/.test(storeSrc)) {
  fail('atomicWriteText 的临时名必须唯一（固定 ${file}.tmp 会让并发写互相截断 / rename ENOENT）')
} else if (!/const temp = `\$\{file\}\.\$\{process\.pid\}/.test(storeSrc)) {
  fail('atomicWriteText 缺少 pid/随机段的唯一临时名')
} else {
  pass('atomicWriteText 使用唯一临时名（并发写不再互相截断）')
}

// dirty 必须在写盘成功之后才清：先清的话，写失败时这批增量只留内存，
// 而 dispose 的 flush 会撞上 `if (!this.dirty) return` 空转 —— 数据随进程退出蒸发。
const flushNow = /private async flushNow[\s\S]*?\n  }/.exec(storeSrc)?.[0] ?? ''
if (/this\.dirty = false[\s\S]*?await atomicWriteJson/.test(flushNow)) {
  fail('flushNow 必须先 await 写盘再清 dirty（当前顺序会丢数据且无法补救）')
} else if (/await atomicWriteJson[\s\S]*?this\.dirty = false/.test(flushNow)) {
  pass('flushNow 写盘成功后才清 dirty（失败可重试，dispose 兜底有效）')
} else {
  fail('flushNow 的 dirty 清除位置无法判定，请人工确认')
}

const memIndexSrc = stripComments(srcOf('src/triad/memory/index.ts'))
if (/void store\.appendExtractLog\([^)]*\)\s*(?!\.catch)/.test(memIndexSrc)) {
  fail('appendExtractLog 的 fire-and-forget 必须显式接 .catch（未处理 rejection 会终止进程）')
} else if (/void store\.flush\(\)\s*(?!\.catch)/.test(memIndexSrc)) {
  fail('dispose 里的 store.flush() 必须显式接 .catch')
} else {
  pass('记忆引擎的 fire-and-forget 全部接了 .catch（磁盘故障不再拖垮进程）')
}

// 截图卡片：iframe 的 src/title 与 mermaid 的 data-lang 都是属性上下文，
// 走 escapeAttr（转义引号）而不是只转义 & < > 的 escapeHtml —— 卡片页是用
// --disable-web-security 的无头 Chrome 打开的，属性逃逸等于任意本地文件读取。
const cardSrc = stripComments(srcOf('src/shot/card.ts'))
const mdSrc = stripComments(srcOf('src/shot/markdown.ts'))
const themeSrc = stripComments(srcOf('src/shot/theme.ts'))
if (/src="\$\{embed\.fileUrl\}"/.test(cardSrc) || /title="\$\{escapeHtml\(name\)\}"/.test(cardSrc)) {
  fail('figureOf 的 iframe src/title 必须走 escapeAttr（文件名可含引号 → 属性逃逸）')
} else if (/data-lang="\$\{escapeHtml\(/.test(mdSrc)) {
  fail('mermaid 的 data-lang 属性必须走 escapeAttr（info string 由模型控制）')
} else {
  pass('截图卡片的属性上下文全部用 escapeAttr（属性逃逸面已封）')
}

// iu 围栏的截图快照：**必须在进 shiki 之前短路**。
//
// shiki 不认识 `iu` 这个语言（实测抛 Language 'iu' not found），异常被 catch 吞掉
// 后走降级分支产出 `<pre class="shiki plain">`，于是 card.ts 的 injectIu 按
// `language-iu` 找落点永远找不到 —— 截图里 iu 卡片静默退化成一段 JSON 源码。
// 这个失败不报错、不影响构建，只能靠「先判语言」的顺序断言钉住。
if (!/lang\.trim\(\)\.toLowerCase\(\) === 'iu'/.test(mdSrc)) {
  fail('iu 围栏必须在 highlight 里先于 shiki 短路（否则 shiki 抛未知语言 → 快照静默失效）')
} else if (!/class="shiki language-iu"/.test(mdSrc)) {
  fail('iu 短路分支必须直接产出 language-iu 标记（injectIu 靠它找落点）')
} else if (!/language-iu/.test(cardSrc) || !/figure class="dtt-iu"/.test(cardSrc)) {
  fail('card.ts 必须把 language-iu 的源码块替换成 dtt-iu 静态快照')
} else {
  pass('iu 截图快照：highlight 先于 shiki 短路 + language-iu 标记 + dtt-iu 替换齐备')
}

// iu 快照必须与对话流**同源**——否则两处必然漂移（截图里的柱子和对话流里的
// 不一样高、配色不一样、清单少了勾选框），而这类差异不报错，只能靠断言钉住。
//
// 架构升级后同源的载体变了：card.ts 不再有手写的 iuBodyOf 镜像（那 150 行出过
// 两次漂移事故），而是委派 kind 注册表——每个 kinds/<kind>.ts 自带 snapshot()，
// 与该 kind 的 React 体共用同一份几何/布局纯函数。断言随之改为钉「委派 + 各
// kind 模块自身的同源纪律」。
{
  const reasons = []
  // ① card.ts 必须委派注册表（iuKindOf + mod.snapshot + mod.label）。
  if (!/from '\.\.\/client\/iu\/kinds\/registry\.ts'/.test(cardSrc)) {
    reasons.push('card.ts 必须 import kind 注册表（快照正文/角标都来自它）')
  }
  if (!/iuKindOf\(/.test(cardSrc) || !/mod\.snapshot\(/.test(cardSrc) || !/mod\.label/.test(cardSrc)) {
    reasons.push('card.ts 必须走 iuKindOf → mod.snapshot/mod.label 委派（不得手写 kind 分支）')
  }
  if (/function iuBodyOf/.test(cardSrc)) {
    reasons.push('旧的手写镜像 iuBodyOf 不该残留（快照逻辑已收敛进各 kind 模块）')
  }
  // ② 样式必须内联同一份 IU_CSS（= 基座 + 全部 kind 专属样式），而不是另写一套。
  if (!/from '\.\.\/client\/iu\/styles\.ts'/.test(cardSrc) || !/IU_CSS/.test(cardSrc)) {
    reasons.push('card.ts 必须内联 client 的 IU_CSS（另写一份 = 样式漂移）')
  }
  if (/iushot/.test(cardSrc) || /iushot/.test(themeSrc)) {
    reasons.push('旧的 .iushot 独立规格不该残留（已改为复用 IU_CSS）')
  }
  // ③ 外壳 class（figure/head/title/tag）仍在 card.ts 的 iuFigureOf 里拼。
  for (const cls of ['figure class="dtt-iu"', 'dtt-iu__head', 'dtt-iu__title', 'dtt-iu__tag']) {
    if (!cardSrc.includes(cls)) reasons.push(`截图外壳缺 ${cls}（吃不到 IU_CSS）`)
  }
  // ④ IU_CSS 必须是**导出**的常量 = 基座 + iuKindsCss()，注入与截图共用同一份。
  const iuStylesSrc = stripComments(srcOf('src/client/iu/styles.ts'))
  if (!/export const IU_CSS/.test(iuStylesSrc)) {
    reasons.push('styles.ts 必须 export const IU_CSS（截图管线要复用同一份）')
  }
  if (!/style\.textContent = IU_CSS/.test(iuStylesSrc)) {
    reasons.push('injectIuStyles 必须注入 IU_CSS 本体（不能是另一份副本）')
  }
  if (!/iuKindsCss\(\)/.test(iuStylesSrc)) {
    reasons.push('IU_CSS 必须拼上 iuKindsCss()（否则截图里 kind 专属样式全丢）')
  }
  // ⑤ 每个 kind 的纯逻辑模块必须自带 snapshot 且转义模型文本（esc/escAttr），
  //    React 体与快照必须同源（chart/gauge/tree/diff/table 等靠共用纯函数）。
  //    安全面：卡片页在 --disable-web-security 的无头 Chrome 里打开，
  //    模型文本逃出标签上下文 = 任意脚本读本地文件。
  const kindFiles = readdirSync(resolve(ROOT, 'src/client/iu/kinds'))
    .filter(f => f.endsWith('.ts') && !['core.ts', 'contract.ts', 'registry.ts', 'types.ts', 'bodies.ts'].includes(f))
  if (kindFiles.length < 13) reasons.push(`kinds 目录应有 ≥13 个纯逻辑模块，实得 ${kindFiles.length}`)
  for (const f of kindFiles) {
    const src = stripComments(srcOf(`src/client/iu/kinds/${f}`))
    const kind = f.replace(/\.ts$/, '')
    if (!/snapshot/.test(src)) { reasons.push(`${kind}.ts 缺 snapshot（截图会画不出这种卡）`); continue }
    if (!/\besc\(/.test(src)) reasons.push(`${kind}.ts 的 snapshot 必须用 esc/escAttr 转义模型文本（无头浏览器安全面）`)
    if (!/readonly css/.test(src) && !/css:/.test(src)) reasons.push(`${kind}.ts 缺 css 字段（样式必须随 kind 模块走）`)
    if (!/readonly doc|doc:/.test(src)) reasons.push(`${kind}.ts 缺 doc 字段（注入文档必须随实现走，防漂移）`)
    // 纯逻辑半边不得 import React（host 半身依赖链，见 kinds/contract.ts 头注释）。
    if (/from 'react'|from "react"/.test(src)) reasons.push(`${kind}.ts（纯逻辑半边）不得 import React——host 半身会内联第二份`)
    // React 体必须存在且与 kind 同名（bodies.ts 按名收拢）。
    if (!existsSync(resolve(ROOT, `src/client/iu/kinds/${kind}.body.tsx`))) {
      reasons.push(`缺 ${kind}.body.tsx（React 体；bodies.ts 的 import 会直接编译失败）`)
    }
  }
  // ⑥ 注册表与 React 体注册表的 kind 集合必须一致（漏一边 = 能解析不能渲染，或反之）。
  const registrySrc = stripComments(srcOf('src/client/iu/kinds/registry.ts'))
  const bodiesSrc = stripComments(srcOf('src/client/iu/kinds/bodies.ts'))
  for (const kind of kindFiles.map(f => f.replace(/\.ts$/, ''))) {
    if (!new RegExp(`\\b${kind}Kind\\b`).test(registrySrc)) reasons.push(`registry.ts 缺 ${kind}Kind 注册`)
    if (!new RegExp(`'${kind}'`).test(bodiesSrc)) reasons.push(`bodies.ts 缺 '${kind}' 的 React 体注册`)
  }
  // ⑦ chart 的几何仍必须单点来自 geometry.ts（柱子高度/刻度两处同源）。
  const chartSrc = stripComments(srcOf('src/client/iu/kinds/chart.ts'))
  if (!/from '\.\.\/geometry\.ts'/.test(chartSrc) || !/chartLayout\(/.test(chartSrc)) {
    reasons.push('chart.ts 的快照必须调用 geometry.ts 的 chartLayout（几何单点）')
  }
  const chartBodySrc = stripComments(srcOf('src/client/iu/kinds/chart.body.tsx'))
  if (!/chartLayout\(/.test(chartBodySrc)) {
    reasons.push('chart.body.tsx 必须调用同一个 chartLayout（否则截图与对话流坐标漂移）')
  }
  if (reasons.length > 0) fail('iu 截图与对话流同源契约：' + reasons.join('；'))
  else pass(`iu 截图与对话流同源：注册表委派 + ${kindFiles.length} 个 kind 模块自带 snapshot/css/doc + 转义齐备 + 几何单点`)
}

// 截图页没有宿主 CSS 变量，IU_CSS 里的 --dsw-alias-* 必须映射到卡片调色板，
// 否则所有 var() 落到兜底中性灰（暗色下尤其明显）。
if (!/--dsw-alias-state-business-primary:var\(--accent\)/.test(cardSrc)) {
  fail('截图页必须把 --dsw-alias-* 映射到卡片变量（否则 iu 卡片在截图里是灰的）')
} else {
  pass('截图页映射了 --dsw-alias-* 宿主变量（IU_CSS 配色正确落地）')
}

// iu 快照的模型文本转义断言已上移到「同源契约」块的第 ⑤ 条：架构升级后快照
// 逻辑收敛进各 kind 模块（card.ts 不再有 iuBodyOf），转义判据改为逐 kind 查
// esc/escAttr（那里同时钉了 snapshot/css/doc 存在、纯逻辑半边不得 import React、
// registry 与 bodies 的 kind 集合一致）。安全面不变：卡片页在
// --disable-web-security 的无头 Chrome 里打开，模型文本逃出标签上下文 = 任意脚本。

// 净化器：HARDENED_PAIR_TAGS 里有 void 元素（base/link/meta/embed/source）与
// 自闭合元素（svg/math/template）。压栈前不判自闭合，它们永远弹不出来，
// 同一 html_block 之后的内容会被整段静默吞掉。
const sanitizeSrc = stripComments(srcOf('src/shared/sanitize-html.ts'))
const hardenedPush = /if \(HARDENED_PAIR_TAGS\.has\(tagName\)\) \{ dropStack\.push\(tagName\); continue \}/.test(sanitizeSrc)
if (hardenedPush) {
  fail('HARDENED_PAIR_TAGS 分支未判自闭合/void：void 标签压栈后永不弹出，后续内容被整段吞掉')
} else {
  pass('净化器在压栈前判自闭合/void（void 标签不再吞掉后续内容）')
}

// 合并记忆：当 LLM 把合并结果写成某条源条目的逐字副本时，merged 撞上自己的
// 源 id，既不入库又随源条目一起被删 —— 两条记忆凭空消失。
const consolidateSrc = stripComments(srcOf('src/triad/memory/engine/consolidate.ts'))
if (!/clashIsSource/.test(consolidateSrc)) {
  fail('merge 分支必须处理「合并结果撞上自己源条目」的情况（否则两条记忆一起消失）')
} else {
  pass('consolidate 的 merge 覆盖了「撞上源条目」分支（记忆不再凭空消失）')
}

// 定时自动化已于 2026-09-28 整块删除（官方 schedule bundle 接管）：源目录、
// 工具注册与 /api/triad-automation/* 路由都不该复活。
if (existsSync(resolve(ROOT, 'src/triad/automation')) || existsSync(resolve(ROOT, 'src/client/triad/automation'))) {
  fail('automation 模块已删除：src/triad/automation 与 src/client/triad/automation 不该复活')
} else {
  pass('automation 模块已删除（官方 schedule bundle 接管）')
}

// ── 融合的 dsh-provider-hub：路由 / 工具 / settings 命名空间 ─────────────
const providerPaths = providerRoutes.map(spec => spec?.path)
for (const expected of ['/api/dsh-proxy', '/api/model-capabilities', '/api/vision-helper/providers', '/api/provider-hub-keys', '/api/dsh-prompt-optimize']) {
  if (!providerPaths.includes(expected)) fail(`provider hub route missing: ${expected} (got ${JSON.stringify(providerPaths)})`)
}
if (providerPaths.includes('/api/dsh-proxy') && providerPaths.includes('/api/provider-hub-keys')) {
  pass(`provider hub routes registered (prefix/exact 共 ${providerRoutes.length} 条，前缀与旧插件逐字一致)`)
}
const providerToolNames = providerTools.map(t => t?.name)
if (!providerToolNames.includes('generate_image') || !providerToolNames.includes('generate_video')) {
  fail(`provider hub tools missing: generate_image/generate_video (got ${JSON.stringify(providerToolNames)})`)
} else {
  pass('provider hub tools registered: generate_image + generate_video')
}
for (const ns of ['network-proxy', 'model-capabilities', 'web-search-anysearch']) {
  if (!providerNamespaces.includes(ns)) fail(`provider hub settings namespace missing: ${ns}`)
}
if (providerNamespaces.length >= 3) {
  pass(`provider hub settings namespaces preserved: ${providerNamespaces.join(', ')}`)
}

// ── 工具闸门：默认全关 + `/指令` 按会话打开 ──────────────────────────────
// 主回归：computer-use（56 个）+ browser-use（24 个）实测占全部工具定义
// 74.7%（约 3.1 万 tok/请求），默认必须不进入请求；`/` 命令打开后才注入。
if (registeredCommands.length !== 2) {
  fail(`expected 2 gate commands (computer-use / browser-use), got ${JSON.stringify(registeredCommands.map(c => c?.name))}`)
} else {
  const names = registeredCommands.map(c => c?.name).sort()
  if (names[0] !== 'browser-use' || names[1] !== 'computer-use') {
    fail(`gate command names must be browser-use / computer-use, got ${JSON.stringify(names)}`)
  } else if (registeredCommands.some(c => typeof c?.handler !== 'function')) {
    fail('gate command without a handler')
  } else if (registeredCommands.some(c => c?.input?.hint === undefined)) {
    // 回归钉子：**必须**声明 input。官方 ui-commands 的 matchEnter 对不带 input
    // 的宿主命令只认裸 token，`/computer-use off` 会被静默降级成普通提示词发给
    // 模型 —— 用户以为关了，其实只是说了句话。这条断言防的正是那种静默失败。
    fail('gate commands must declare input.hint（否则 /xxx off 会静默降级为普通提示词）')
  } else {
    pass(`gate commands registered: /${names.join(', /')} (input hint ${JSON.stringify(registeredCommands[0]?.input?.hint)})`)
  }
}
if (assembleListeners.length !== 1) {
  fail(`expected exactly 1 system-prompt/assemble listener, got ${assembleListeners.length}`)
} else {
  pass('gate hooks system-prompt/assemble (registration-layer agnostic)')
}

const gateTest = mod.toolsGateTest
if (gateTest === undefined) {
  fail('tools-gate test surface (__test) not exported')
} else {
  const assemble = (agent) => ({
    tools: [
      { name: 'pwsh', description: 'shell', parameters: {} },
      { name: 'cua_driver_native__click', description: 'click', parameters: {} },
      { name: 'cua_driver_native__drag', description: 'drag', parameters: {} },
      { name: 'mcp__playwright-mcp__browser_click', description: 'click', parameters: {} },
    ],
    sections: [
      { name: 'persona', text: 'x' },
      { name: 'computer-use:cua-driver-native', text: 'guidance' },
      { name: 'mcp:playwright-mcp', text: 'server instructions' },
    ],
  })
  const project = async (agent) => {
    const listener = assembleListeners[0]
    return listener(assemble(agent), { agent, scope: agent }, async () => assemble(agent))
  }
  const namesOf = (out) => out.tools.map(t => t.name).sort().join(',')
  const sectionsOf = (out) => out.sections.map(s => s.name).sort().join(',')

  const agentA = { id: 'agent-a' }
  const off = await project(agentA)
  if (namesOf(off) !== 'pwsh') {
    fail(`默认（未开关）应只留 pwsh，实得 ${namesOf(off)}`)
  } else if (!sectionsOf(off).includes('persona')) {
    fail(`默认应保留 persona 段，实得 ${sectionsOf(off)}`)
  } else if (!sectionsOf(off).includes('tools-gate:offline')) {
    fail(`默认应追加「工具关着」的说明段（否则模型会假装调用），实得 ${sectionsOf(off)}`)
  } else {
    pass('默认全关：电脑/浏览器工具与 provider 提示词段移除 + 追加「工具关着」说明段')
  }

  // 说明段必须点名每个关着的组与开启方式，且不含已开启的组。
  const offlineText = off.sections.find(s => s.name === 'tools-gate:offline')?.text ?? ''
  if (!offlineText.includes('/computer-use on') || !offlineText.includes('/browser-use on')) {
    fail(`说明段应点名两个关着的组的开启命令，实得 ${JSON.stringify(offlineText)}`)
  } else if (!/不要假装/.test(offlineText)) {
    fail('说明段应明确禁止假装调用（否则模型会编造已操作）')
  } else {
    pass('说明段点名关着的组 + 开启命令 + 禁止假装调用')
  }

  // 非 agent 组装（标题生成等服务级请求）原样放行：不误伤。
  const agentless = await project(undefined)
  if (namesOf(agentless) !== 'cua_driver_native__click,cua_driver_native__drag,mcp__playwright-mcp__browser_click,pwsh') {
    fail(`无 agent 的组装不该被过滤，实得 ${namesOf(agentless)}`)
  } else {
    pass('无 agent 的组装原样放行（服务级请求不受闸门影响）')
  }

  const invoke = async (name, rawInput, agent) => {
    const def = registeredCommands.find(c => c?.name === name)
    return def.handler({ agent, rawInput, attachments: [], signal: undefined, commandId: 'x' })
  }

  const onResult = await invoke('computer-use', ' on', agentA)
  const afterOn = await project(agentA)
  if (namesOf(afterOn) !== 'cua_driver_native__click,cua_driver_native__drag,pwsh') {
    fail(`/computer-use on 后应注入 cua 工具，实得 ${namesOf(afterOn)}`)
  } else if (!sectionsOf(afterOn).includes('computer-use:cua-driver-native')) {
    fail(`/computer-use on 后应恢复 guidance 段，实得 ${sectionsOf(afterOn)}`)
  } else if (sectionsOf(afterOn).includes('mcp:playwright-mcp')) {
    fail('/computer-use on 不该连带打开浏览器组')
  } else {
    pass(`/computer-use on 只打开本组（工具 ${namesOf(afterOn)}；段 ${sectionsOf(afterOn)}）`)
  }
  if (onResult?.kind !== 'success' || !/已启用/.test(onResult?.text ?? '')) {
    fail(`/computer-use on 应回 success 且文案含「已启用」，实得 ${JSON.stringify(onResult)}`)
  } else if (!/2 个电脑操作工具/.test(onResult.text)) {
    fail(`回执应带上该组工具数量（来自 ctx.get('tools').schemas），实得 ${JSON.stringify(onResult.text)}`)
  } else {
    pass('切换回执带上该组工具个数与 token 量级（用户能看见省了多少）')
  }
  // 部分开启时说明段必须只提还关着的组（开着的不该被劝去开）。
  const partialNotice = afterOn.sections.find(s => s.name === 'tools-gate:offline')?.text ?? ''
  if (partialNotice.includes('/computer-use on')) {
    fail(`已开启的组不该出现在「关着」说明里，实得 ${JSON.stringify(partialNotice)}`)
  } else if (!partialNotice.includes('/browser-use on')) {
    fail(`还关着的组应出现在说明里，实得 ${JSON.stringify(partialNotice)}`)
  } else {
    pass('部分开启时说明段只点名还关着的组')
  }

  await invoke('browser-use', 'on', agentA)
  const bothOn = await project(agentA)
  if (namesOf(bothOn) !== 'cua_driver_native__click,cua_driver_native__drag,mcp__playwright-mcp__browser_click,pwsh') {
    fail(`两组都打开时应全部注入，实得 ${namesOf(bothOn)}`)
  } else {
    pass('/browser-use on 与电脑组互不干扰（两组可同时开）')
  }

  // 会话隔离：另一个 agent 不该继承 agentA 的开关。
  const agentB = { id: 'agent-b' }
  const bDefault = await project(agentB)
  if (namesOf(bDefault) !== 'pwsh') {
    fail(`开关必须按会话隔离，agentB 实得 ${namesOf(bDefault)}`)
  } else {
    pass('开关按 agent 隔离（新会话默认仍是全关）')
  }

  const offResult = await invoke('computer-use', 'off', agentA)
  const afterOff = await project(agentA)
  if (namesOf(afterOff) !== 'mcp__playwright-mcp__browser_click,pwsh') {
    fail(`/computer-use off 后应移除 cua 工具，实得 ${namesOf(afterOff)}`)
  } else {
    pass('/computer-use off 立刻收回本组（浏览器组不受影响）')
  }
  if (offResult?.kind !== 'success' || !/已关闭/.test(offResult?.text ?? '')) {
    fail(`/computer-use off 应回 success 且文案含「已关闭」，实得 ${JSON.stringify(offResult)}`)
  }

  // 不带参数 = 切换；非法取值 = error（不静默降级）。
  // 此刻状态是 off（上一步刚 off 过），故第一次裸调用 → 启用，第二次 → 关闭。
  const toggle1 = await invoke('computer-use', '', agentA)
  const toggle2 = await invoke('computer-use', '  ', agentA)
  if (toggle1?.kind !== 'success' || toggle2?.kind !== 'success' || !/已启用/.test(toggle1.text) || !/已关闭/.test(toggle2.text)) {
    fail(`裸 /computer-use 应逐次切换，实得 ${JSON.stringify([toggle1, toggle2])}`)
  } else {
    pass('裸 /computer-use 逐次切换（toggle 语义）')
  }
  const bad = await invoke('computer-use', 'maybe', agentA)
  if (bad?.kind !== 'error' || !/用法/.test(bad?.text ?? '')) {
    fail(`非法取值应回 error 且带用法，实得 ${JSON.stringify(bad)}`)
  } else {
    pass('非法取值回 error 并给出用法（命令行不会被静默吞掉）')
  }
  const status = await invoke('computer-use', 'status', agentA)
  if (status?.kind !== 'success' || !/电脑操作/.test(status?.text ?? '')) {
    fail(`/computer-use status 应回当前状态，实得 ${JSON.stringify(status)}`)
  } else {
    pass('/computer-use status 回当前状态')
  }

  // 纯函数：分组判定与体积统计（改前缀或加新组时的钉子）。
  if (gateTest.groupOfTool('pwsh') !== null) fail('pwsh 不该被任何闸门组命中')
  else if (gateTest.groupOfTool('cua_driver_native__click')?.key !== 'computer-use') fail('cua 前缀未命中 computer-use 组')
  else if (gateTest.groupOfTool('mcp__playwright-mcp__browser_click')?.key !== 'browser-use') fail('playwright 前缀未命中 browser-use 组')
  else pass('分组前缀判定正确（未命中的普通工具一律放行）')
  const measured = gateTest.measureGroup(
    [{ name: 'cua_driver_native__a', parameters: {} }, { name: 'cua_driver_native__b', parameters: {} }, { name: 'pwsh', parameters: {} }],
    gateTest.DEFAULT_GATE_GROUPS[0],
  )
  if (measured.count !== 2 || measured.bytes <= 0) fail(`measureGroup 统计错误：${JSON.stringify(measured)}`)
  else pass(`measureGroup 统计正确（2 个工具 / ${measured.bytes} B）`)

  // 状态路由：客户端胶囊读/写与 /指令 同一张状态表（GET 读、POST 写）。
  const route = registered.find(spec => spec?.path === '/api/chat-flow/tools-gate')
  const callRoute = async (method, url, body) => {
    const chunks = []
    const req = {
      method,
      url,
      on(event, listener) {
        if (event === 'data' && body !== undefined) listener(JSON.stringify(body))
        if (event === 'end') listener()
      },
      destroy() {},
    }
    let payload = null
    let status = 0
    const res = {
      writeHead(code) { status = code },
      end(text) { payload = JSON.parse(text) },
    }
    route.handler(req, res)
    // POST 走 promise 链，让微任务跑完。
    await new Promise(resolve => setTimeout(resolve, 0))
    return { status, payload }
  }
  const agentState = { id: 'route-session' }
  if (typeof route?.handler !== 'function') {
    fail('tools-gate route has no handler')
  } else {
    // GET：未开关时两组都应是 enabled=false。
    const read = await callRoute('GET', '/api/chat-flow/tools-gate?session=route-session')
    if (read.status !== 200 || read.payload?.ok !== true) {
      fail(`GET /tools-gate 应回 200 {ok:true}，实得 ${JSON.stringify(read)}`)
    } else if (!Array.isArray(read.payload.groups) || read.payload.groups.some(g => g.enabled !== false)) {
      fail(`GET /tools-gate 默认应两组全关，实得 ${JSON.stringify(read.payload.groups)}`)
    } else if (!read.payload.keys.includes('computer-use') || !read.payload.keys.includes('browser-use')) {
      fail(`GET /tools-gate 应带 keys，实得 ${JSON.stringify(read.payload.keys)}`)
    } else {
      pass(`GET /tools-gate 回两组默认全关（keys ${read.payload.keys.join(', ')}）`)
    }
    // POST：写一组，回新状态。
    const write = await callRoute('POST', '/api/chat-flow/tools-gate', { session: 'route-session', key: 'computer-use', enabled: true })
    if (write.payload?.ok !== true) {
      fail(`POST /tools-gate 应回 ok，实得 ${JSON.stringify(write)}`)
    } else {
      const group = write.payload.groups.find(g => g.key === 'computer-use')
      if (group?.enabled !== true) fail(`POST 后该组应为 enabled，实得 ${JSON.stringify(group)}`)
      else if (write.payload.groups.find(g => g.key === 'browser-use')?.enabled !== false) {
        fail('POST 不该连带打开另一组')
      } else {
        pass('POST /tools-gate 只切换目标组并回新状态')
      }
    }
    // 未知会话/组：如实报 false，不抛 500。
    const badWrite = await callRoute('POST', '/api/chat-flow/tools-gate', { session: 'nope', key: 'computer-use', enabled: true })
    if (badWrite.status !== 200 || badWrite.payload?.ok !== false) {
      fail(`未知会话应回 200 {ok:false}，实得 ${JSON.stringify(badWrite)}`)
    } else {
      pass('未知会话/组回 200 {ok:false}（闸门是可选能力，不报红）')
    }
    // 单一真相：胶囊（路由）写的状态，/指令 必须读得到，反之亦然。
    const statusAfterRouteWrite = await invoke('computer-use', 'status', liveRouteAgent)
    if (!/已启用/.test(statusAfterRouteWrite?.text ?? '')) {
      fail(`胶囊与 /指令 状态不一致：路由写了 enabled，/computer-use status 却回 ${JSON.stringify(statusAfterRouteWrite)}`)
    } else {
      pass('胶囊与 /指令 共用同一张状态表（无第二套真相）')
    }
    const routeAfterCommandWrite = await invoke('browser-use', 'on', liveRouteAgent)
    const readBack = await callRoute('GET', '/api/chat-flow/tools-gate?session=route-session')
    const browserGroup = readBack.payload?.groups?.find(g => g.key === 'browser-use')
    if (routeAfterCommandWrite?.kind !== 'success' || browserGroup?.enabled !== true) {
      fail(`/指令 写的状态，路由读不到：${JSON.stringify({ routeAfterCommandWrite, browserGroup })}`)
    } else {
      pass('/指令 写的状态，胶囊（路由）读得到')
    }
  }
}

// 源码契约：供应商配置与代理回到官方「设置」弹窗（2026-10-05 用户点名）。
// 官方「模型」页导航项随之隐藏（两页管同一件事），供应商页注册 settings.section。
const providerStylesSrc = stripComments(srcOf('src/client/provider/webui/styles.ts'))
if (!/hideOfficialModelsNav/.test(providerStylesSrc)) {
  fail('styles.ts 必须恢复 hideOfficialModelsNav（供应商页接管模型目录，官方「模型」页重复）')
} else if (!/:has\(\.phub-host\)/.test(providerStylesSrc)) {
  fail('弹窗尺寸适配必须用 :has(.phub-host) 锁定（否则通用/插件页也被改尺寸）')
} else {
  pass('官方「模型」页隐藏逻辑恢复 + 弹窗尺寸适配只对供应商页生效')
}
const providerClientSrc = stripComments(srcOf('src/client/provider/index.ts'))
const supplierSectionSrc = stripComments(srcOf('src/client/provider/webui/section.tsx'))
if (!/applySupplierSection\(ctx\)/.test(providerClientSrc)) {
  fail('provider 入口必须调用 applySupplierSection(ctx)（设置里没有供应商页）')
} else if (!/ctx\.slots\.inject\('settings\.section'/.test(supplierSectionSrc)) {
  fail('供应商页必须注册 settings.section 座位')
} else if (/settings\.general\.item/.test(providerClientSrc + supplierSectionSrc)) {
  fail('通用设置里的独立代理卡不该回来（代理是供应商页底部的区块）')
} else {
  pass('供应商设置页在位：settings.section / provider-hub，代理并入页面底部')
}

/* ── Office 预览（2026-10-06）：纯函数契约 + 真 HTTP 链路 ────────────────
 *
 * 这块的价值全在「错了也不会报错」：引擎解析失败只是静默退回下载按钮、
 * 路径准入错只是 403、扩展名表漏一个只是那一类永远没有缩略图。所以既要钉
 * 纯函数，也要真发一次请求（用假 ctx 挂路由 + node:http 收响应）。
 */
{
  const officeTest = mod.officeTest
  const admitTest = mod.officeAdmitTest
  const scratchTest = mod.officeScratchTest

  // 1) 路由分流表：四条端点的 tail 都要认得出（漏一个就是那个功能 404）。
  const expectedTails = { '/info': 'info', '/page': 'page', '/pdf': 'pdf', '/thumb': 'thumb' }
  let routeTableOk = true
  for (const [tail, kind] of Object.entries(expectedTails)) {
    if (officeTest.resolveRoute(tail) !== kind || officeTest.resolveRoute(`${tail}/`) !== kind) routeTableOk = false
  }
  if (!routeTableOk || officeTest.resolveRoute('/nope') !== null) {
    fail('office 路由分流表错误（info/page/pdf/thumb 必须都认，未知 tail 必须为 null）')
  } else {
    pass('office 路由四条端点分流正确（info / page / pdf / thumb）')
  }

  // 2) 可渲染扩展名：pdf / ppt / pptx / doc / docx 必须在列；代码与图片不在列
  //    （图片走自己的 raw，不该被误判成 Office）。
  const renderable = officeTest.RENDERABLE_EXT
  const mustHave = ['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.odp', '.odt']
  const missing = mustHave.filter(ext => !renderable.has(ext))
  if (missing.length > 0) fail(`office 可渲染扩展名缺 ${missing.join(', ')}`)
  else if (renderable.has('.png') || renderable.has('.html')) {
    fail('office 可渲染表不该含图片 / html（它们走各自的链路）')
  } else {
    pass(`office 可渲染扩展名覆盖 PPT/Word/PDF（${mustHave.join(' ')}）`)
  }

  // 2b) 引擎向上查找逻辑：给一个「<某目录>/node_modules/@deepseek-ai/...」的
  //     已知布局，必须能沿父目录找到入口。这条错了不会报错，只会静默退回
  //     下载按钮 —— 也就是 ppt / word 永远没有预览。
  const dshRuntime = process.env.DSH_RUNTIME ?? 'D:\\AI\\Dsh\\dsh-runtime'
  const expectedKit = resolve(dshRuntime, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js')
  if (!existsSync(expectedKit)) {
    pass('本机没有 DSH runtime 的 libreoffice-kit（跳过引擎查找断言）')
  } else {
    const found = officeTest.locateKit([resolve(dshRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')])
    if (found === null) fail('locateKit 未能在 DSH runtime 布局下找到 libreoffice-kit')
    else if (resolve(found) !== resolve(expectedKit)) fail(`locateKit 命中错误路径：${found}`)
    else pass('locateKit 沿 DSH 安装布局找到 liboffice-kit 入口')
  }

  // 3) 路径准入键归一：Windows 盘符大小写与反斜杠必须折叠成同一个键。
  const keyA = admitTest.previewPathKey('D:\\AI\\Dsh\\a.html')
  const keyB = admitTest.previewPathKey('d:/ai/dsh/A.HTML')
  if (keyA !== keyB) fail(`准入键未归一：${keyA} !== ${keyB}`)
  else pass('office 准入键归一（裸反斜杠与盘符大小写折叠一致）')

  // 4) 工作目录候选：必须是「候选根 / _tmp/.dsh-office-scratch」，且第一档跟随
  //    工作区（实测判据：scratch 落在 workspace 之下才拿得到沙箱写权限）。
  //    放在 _tmp/ 而不是工作区根：临时产物该落 _tmp（工作区根多一个点目录是噪声）。
  const candidates = scratchTest.candidates()
  const suffix = scratchTest.SCRATCH_DIR_NAME.replace(/\\/g, '/')
  if (candidates.length === 0) {
    fail('office 工作目录候选项为空（引擎会照着坏掉的 TEMP 去写盘）')
  } else if (!candidates.every(p => p.replace(/\\/g, '/').endsWith(suffix))) {
    fail(`office 候选项命名不符：${JSON.stringify(candidates)}`)
  } else {
    const normalized = candidates[0].replace(/\\/g, '/').toLowerCase()
    const cwdNormalized = process.cwd().replace(/\\/g, '/').toLowerCase()
    if (!normalized.startsWith(cwdNormalized)) {
      fail(`office 首选项未跟随工作区：${candidates[0]}（cwd=${process.cwd()}）`)
    } else {
      pass(`office 工作目录首选跟随工作区（${suffix}）`)
    }
  }

  // 4b) ACE 判据（纯函数）：这条错了不会报错，只会静默选中一个写不了的目录，
  //     于是 ppt/word 预览继续失败、看起来像「修复没生效」。
  const aceCases = [
    ['S-1-4-697522640-1053477726:(OI)(CI)(W,D,DC)', true],
    ['S-1-4-1-2-3:(OI)(CI)(M)', true],
    ['S-1-4-1-2-3:(OI)(CI)(F)', true],
    ['S-1-4-1-2-3:(OI)(CI)(RX)', false],
    ['S-1-4-1-2-3:(OI)(CI)(S,X)', false],
    ['Everyone:(CI)(DENY)(DC)', false],
    ['BUILTIN\\Users:(RX)', false],
  ]
  const aceBad = aceCases.filter(([line, want]) => scratchTest.parseAceLines(`dir ${line}`) !== want)
  if (aceBad.length > 0) {
    fail(`ACE 写权限判据错误：${JSON.stringify(aceBad.map(c => c[0]))}`)
  } else {
    pass('ACE 写权限判据正确（W/M/F 算可写，RX/S/X 与无沙箱 ACE 不算）')
  }

  // 5) 真链路：用假 ctx 挂路由 → node:http 起服务 → 请求四条端点。
  //
  //    未准入的路径必须 403（这条路由族等于「读本机任意文件」，判据松了就是
  //    任意文件读取）；已登记的路径在引擎可用时须出 PNG。引擎不可用（非 win32 /
  //    没装 kit）时整块降级为「503 而不是 500」的断言 —— 那仍是一次真请求。
  const http = await import('node:http')
  const registrations = []
  let officeMod = null
  const fakeWebCtx = {
    logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    get: () => undefined,
    webServer: { register(spec) { registrations.push(spec); return () => {} } },
  }
  try {
    officeMod = await import(new URL(`file://${HOST.replace(/\\/g, '/')}`))
    officeMod.applyOfficePreview(fakeWebCtx)
  } catch (error) {
    fail(`applyOfficePreview threw: ${error?.stack ?? error}`)
  }
  const officeRoute = registrations.find(spec => spec?.path === '/api/chat-flow/office')
  if (officeRoute === undefined) {
    fail('applyOfficePreview 未注册 /api/chat-flow/office 路由')
  } else if (officeRoute.kind !== 'prefix' || typeof officeRoute.handler !== 'function') {
    fail(`office 路由形状错误：${JSON.stringify({ kind: officeRoute.kind })}`)
  } else {
    pass('applyOfficePreview 注册 prefix /api/chat-flow/office')

    const server = http.createServer((req, res) => officeRoute.handler(req, res))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const get = (path) => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      })
      req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }))
    })

    try {
      // 5a) 未准入的路径：403（**不得**因为路径不存在就变成 404 —— 404 会泄露
      //     「本机确实有这个文件」这条信息）。
      const denied = await get('/api/chat-flow/office/page?path=' + encodeURIComponent('C:\\Windows\\win.ini'))
      if (denied.status !== 403) {
        fail(`office 未准入路径应 403，实得 ${denied.status}`)
      } else {
        pass('office 未准入路径 403（这条路由族没有开成任意文件读）')
      }

      // 5b) 未知端点：404 + JSON。
      const unknown = await get('/api/chat-flow/office/nope')
      if (unknown.status !== 404) fail(`office 未知端点应 404，实得 ${unknown.status}`)
      else pass('office 未知端点 404')

      // 5c) 已登记路径 + 引擎可用 → 真出 PNG（页图链路端到端）。
      const engine = await officeMod.officeEngineAvailable().catch(() => false)
      if (!engine) {
        pass('office 引擎不可用（未装 libreoffice-kit）→ 跳过真渲染断言')
      } else {
        const sample = process.env.DSH_SMOKE_OFFICE_SAMPLE
          ?? 'D:\\AI\\Dsh\\dsh-chat-plus\\README.md' // 只用来验准入，不参与渲染
        const pptx = process.env.DSH_SMOKE_OFFICE_PPTX
        if (pptx !== undefined && existsSync(pptx)) {
          officeMod.rememberOfficePaths([pptx])
          const info = await get('/api/chat-flow/office/info?path=' + encodeURIComponent(pptx))
          let payload = null
          try { payload = JSON.parse(info.body.toString('utf8')) } catch { /* 非 JSON 走下面报错 */ }
          if (info.status !== 200 || payload?.ok !== true) {
            fail(`office /info 对已登记 pptx 应 200 {ok:true}，实得 ${info.status} ${info.body.toString('utf8').slice(0, 160)}`)
          } else if (payload.renderable !== true || typeof payload.scratch !== 'string') {
            fail(`office /info 应回 renderable + scratch 诊断，实得 ${JSON.stringify(payload)}`)
          } else {
            pass(`office /info 回 renderable + 工作目录（${payload.scratch}）`)
          }
        } else {
          void sample
          pass('office 引擎可用（真渲染留待 DSH_SMOKE_OFFICE_PPTX 指定样本时断言）')
        }
      }
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  }
}

/* ── spill 准入（2026-10-06 修「画廊生图格子全空」）─────────────────────
 *
 * 判据错了不会报错，只会让历史会话的生图条目**全部 403** —— 界面上是一排
 * 点开什么都没有的空白格子。所以正反例都要钉：历史 root 可读、任意路径不可读、
 * 伪造命名不可读。
 */
{
  const spillTest = mod.spillTest
  const fakeRoots = [spillTest.canonical('C:/fake/dsh-spill-Ab3x9Q')]
  const cases = [
    ['历史 root 内的生图 spill', 'C:/fake/dsh-spill-Ab3x9Q/session-0123456789ab/abcd1234-generate_image.txt', true],
    ['任意路径', 'C:/Windows/win.ini', false],
    ['root 内但无 session 层', 'C:/fake/dsh-spill-Ab3x9Q/loose.txt', false],
    ['session 目录但非 txt', 'C:/fake/dsh-spill-Ab3x9Q/session-0123456789ab/x.png', false],
    ['路径穿越', 'C:/fake/dsh-spill-Ab3x9Q/session-0123456789ab/../../evil.txt', false],
    ['伪造 root 前缀（非精确 6 位）', 'C:/fake/dsh-spill-test-1/session-0123456789ab/x.txt', false],
    ['相对路径', 'session-0123456789ab/x.txt', false],
  ]
  const bad = []
  for (const [label, path, want] of cases) {
    const verdict = mod.admitSpillPath(path, fakeRoots)
    if (verdict.ok !== want) bad.push(`${label}: 期望 ${want ? '通过' : '拒绝'}，实得 ${verdict.ok ? '通过' : `拒(${verdict.reason})`}`)
  }
  if (bad.length > 0) fail(`spill 准入判据错误：${bad.join('；')}`)
  else pass('spill 准入：历史 root 可读 + 任意/伪造/穿越路径全拒（7 组正反例）')

  // root 发现：base 必须并上「插件启动时记住的原始 tmpdir」—— office 模块会把
  // TEMP 改到 workspace，改完 os.tmpdir() 就不再是 spill root 的出生地，只信当前
  // tmpdir 会一个历史 root 都扫不到（整批生图重新变 403）。
  const bases = spillTest.spillBases()
  if (bases.length < 2) fail(`spill root 扫描基准必须 ≥2 个（原始 tmpdir + 当前 tmpdir + 平台惯例），实得 ${bases.length}`)
  else pass(`spill root 扫描基准取并集（${bases.length} 个，TEMP 被改写后仍能发现历史 root）`)
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${HOST}`)
process.exit(process.exitCode ?? 0)
