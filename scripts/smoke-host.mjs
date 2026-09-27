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

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const HOST = resolve(ROOT, 'lib/index.js')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

// 先做文本守卫：安装位置解析不了的 specifier 一个都不许出现——包括
// `@deepseek-ai/*`。融合进来的四工作台把需要的 DSH 叶子模块全部 vendor 化在
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
const stubCtx = {
  // 老写法（apply 里直接 ctx.webServer.xxx）在这里拿不到该属性 → TypeError。
  inject(names, callback) {
    injectNamesSeen.push([...names])
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
if (registeredTools.length !== 1 || registeredTools[0]?.name !== 'download') {
  fail(`expected exactly 1 registered tool named 'download', got ${JSON.stringify(registeredTools.map(t => t?.name))}`)
} else {
  const tool = registeredTools[0]
  if (typeof tool.execute !== 'function') fail('download tool has no execute()')
  else if (typeof tool.output?.render !== 'function') fail('download tool has no output.render()')
  else pass('registered wire tool: download (execute + output.render present)')
}

if (!effectRan) fail('deferred webServer callback never ran')
else pass('deferred webServer callback executed')

// 4 条：generated-images(exact) + screenshot/download(prefix) + open-path(exact)。
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

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${HOST}`)
process.exit(process.exitCode ?? 0)
