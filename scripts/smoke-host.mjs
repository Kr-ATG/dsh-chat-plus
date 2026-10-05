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

import { existsSync, readFileSync } from 'node:fs'
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
const providerRoutes = []
const providerTools = []
const providerNamespaces = []
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

// 9 条：本插件 4 条（generated-images / open-path 两条 exact + screenshot /
// download 两条 prefix）+ 融合的 dsh-provider-hub 5 条（/api/dsh-proxy、
// /api/model-capabilities、/api/provider-hub-keys 三条 prefix +
// /api/dsh-prompt-optimize 与 /stop 两条 exact）。
// open-path 是「用文件资源管理器打开」改道用的（windowsHide 会吞掉 Explorer）。
if (registered.length !== 4) {
  fail(`expected exactly 4 route registrations, got ${registered.length}: ${JSON.stringify(registered)}`)
} else {
  const exacts = registered.filter(spec => spec?.kind === 'exact')
  const prefix = registered.filter(spec => spec?.kind === 'prefix')
  if (!exacts.some(spec => spec?.path === '/api/chat-flow/generated-images')) {
    fail(`unexpected exact route specs: ${JSON.stringify(exacts)}`)
  } else if (!exacts.some(spec => spec?.path === '/api/chat-flow/open-path')) {
    fail('missing open-path route (exact /api/chat-flow/open-path)')
  } else {
    pass('registered GET /api/chat-flow/generated-images + /open-path (kind=exact)')
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
  for (const spec of registered) {
    if (typeof spec?.handler !== 'function') fail(`route handler is not a function: ${spec?.path}`)
  }
  pass('both route handlers are functions')
  const disposer = effectDisposer
  if (typeof disposer === 'function') pass('routes return disposers (unregisterable)')
  else fail('route registration did not return an unregister disposer')
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
if (/src="\$\{embed\.fileUrl\}"/.test(cardSrc) || /title="\$\{escapeHtml\(name\)\}"/.test(cardSrc)) {
  fail('figureOf 的 iframe src/title 必须走 escapeAttr（文件名可含引号 → 属性逃逸）')
} else if (/data-lang="\$\{escapeHtml\(/.test(mdSrc)) {
  fail('mermaid 的 data-lang 属性必须走 escapeAttr（info string 由模型控制）')
} else {
  pass('截图卡片的属性上下文全部用 escapeAttr（属性逃逸面已封）')
}

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

// 源码契约：官方「模型」设置页不再被隐藏（hideOfficialModelsNav 已删除）。
const providerStylesSrc = stripComments(srcOf('src/client/provider/webui/styles.ts'))
if (/hideOfficialModelsNav/.test(providerStylesSrc)) {
  fail('官方「模型」设置页仍被隐藏：styles.ts 里不该再有 hideOfficialModelsNav')
} else if (/display\s*=\s*'none'/.test(providerStylesSrc)) {
  fail('styles.ts 里仍有把官方导航项 display:none 的写法')
} else {
  pass('官方「模型」设置页不再被隐藏（hideOfficialModelsNav 已删除）')
}
// 供应商页与代理页必须是工作台 Tab 的页面，不能再注册 settings 座位。
const providerClientSrc = stripComments(srcOf('src/client/provider/index.ts'))
if (/settings\.(section|general\.item)/.test(providerClientSrc)) {
  fail('供应商中心仍在注册设置座位：应当只由工作台 Tab 承载')
} else {
  pass('供应商中心不再注册 settings.section / settings.general.item 座位')
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${HOST}`)
process.exit(process.exitCode ?? 0)
