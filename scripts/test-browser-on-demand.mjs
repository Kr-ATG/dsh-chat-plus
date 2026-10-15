/**
 * dsh-chat-plus — 浏览器按需拉起（browser-on-demand）行为测试。
 *
 * ## 为什么需要真跑
 *
 * 这个模块的四条主行为错了**都不会抛错**，只会表现为「Chrome 没起来」或
 * 「常驻不关」——正是它要修的那两个症状：
 *   1. 浏览器工具调用前确保端点就绪（已就绪不重复拉起）；
 *   2. 并发调用只拉起一次（去重）；
 *   3. 空闲到点关掉**只由自己拉起**的实例（用户的实例一律不碰）；
 *   4. 调用进行中绝不关停。
 *
 * 所以这里对**构建产物** lib/index.js 注入假探针/假启动器/假计时器，把状态机
 * 真跑一遍。不碰真实 Chrome、不依赖真实时间。
 *
 * Usage: node scripts/test-browser-on-demand.mjs
 */

import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const HOST = resolve(ROOT, 'lib/index.js')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)
const need = (cond, msg) => (cond ? pass(msg) : fail(msg))

if (!existsSync(HOST)) {
  fail(`lib/index.js 不存在，先跑 node build.mjs`)
  process.exit(1)
}

const mod = await import(new URL(`file://${HOST.replace(/\\/g, '/')}`))
const {
  OnDemandBrowser,
  isBrowserTool,
  waitForCdp,
  resolveBrowserOnDemandConfig,
  DEFAULT_IDLE_MS,
  DEFAULT_ATTACH_PORT,
  BROWSER_TOOL_PREFIX,
  browserOnDemandTest,
} = mod

for (const [name, value] of Object.entries({
  OnDemandBrowser, isBrowserTool, waitForCdp, resolveBrowserOnDemandConfig, browserOnDemandTest,
})) {
  if (value === undefined) { fail(`lib/index.js 未导出 ${name}`); process.exit(1) }
}

// ── 1. 纯函数 ─────────────────────────────────────────────────────────────
need(isBrowserTool('mcp__playwright-mcp__browser_click'), 'isBrowserTool 命中浏览器工具')
need(!isBrowserTool('mcp__playwright-mcp__x') === false, 'isBrowserTool 前缀匹配（边界：整前缀）')
need(!isBrowserTool('pwsh'), 'isBrowserTool 不误伤普通工具')
need(!isBrowserTool(undefined) && !isBrowserTool(''), 'isBrowserTool 对空值返回 false')

const defaults = resolveBrowserOnDemandConfig({})
need(defaults.port === DEFAULT_ATTACH_PORT && defaults.port === 9222, `默认端口 ${DEFAULT_ATTACH_PORT}`)
need(defaults.idleMs === DEFAULT_IDLE_MS && defaults.idleMs === 5 * 60 * 1000, '默认空闲 5 分钟')
need(defaults.toolPrefix === BROWSER_TOOL_PREFIX, '默认工具前缀')
need(defaults.idleMs === 300000, '空闲 300000ms = 5 分钟')
const custom = resolveBrowserOnDemandConfig({ port: 9333, idleMs: 0, profileDir: 'X:\\p' })
need(custom.port === 9333 && custom.idleMs === 0 && custom.profileDir === 'X:\\p', '自定义配置生效')

// ── 2. waitForCdp：轮询直到就绪 ───────────────────────────────────────────
{
  let calls = 0
  const probe = async () => (++calls >= 3)
  const ok = await waitForCdp(probe, { port: 1, timeoutMs: 2000, intervalMs: 1 })
  need(ok && calls === 3, `waitForCdp 轮询到就绪（试了 ${calls} 次）`)

  const never = await waitForCdp(async () => false, { port: 1, timeoutMs: 30, intervalMs: 5 })
  need(never === false, 'waitForCdp 超时返回 false')

  const ac = new AbortController()
  ac.abort()
  const aborted = await waitForCdp(async () => false, { port: 1, timeoutMs: 5000, intervalMs: 5, signal: ac.signal })
  need(aborted === false, 'waitForCdp 尊重取消信号')
}

// ── 测试脚手架：假探针 / 假启动器 / 假计时器 ─────────────────────────────
/** 造一个受控的 OnDemandBrowser 与它的探针记录。 */
function harness(overrides = {}) {
  const state = {
    ready: false,
    launches: [],
    kills: [],
    probes: 0,
    markers: [],
    cleared: 0,
    timers: [],
    logs: [],
  }
  const alive = new Set()
  let nextPid = 1000
  const browser = new OnDemandBrowser(
    { port: 9222, idleMs: 1000, startTimeoutMs: 200, pollIntervalMs: 1, ...overrides },
    {
      probe: async () => { state.probes += 1; return state.ready },
      launch: () => {
        const pid = nextPid++
        alive.add(pid)
        state.launches.push(pid)
        // 模拟：启动后端点可用（由调用方决定何时）
        return { proc: { pid }, port: 9222, profileDir: 'P' }
      },
      resolveChrome: () => 'C:\\fake\\chrome.exe',
      kill: (pid) => { state.kills.push(pid); alive.delete(pid) },
      isAlive: (pid) => alive.has(pid),
      readMarker: () => state.marker ?? null,
      writeMarker: (m) => { state.markers.push(m); state.marker = m },
      clearMarker: () => { state.cleared += 1; state.marker = null },
      setTimer: (fn, ms) => { const t = { fn, ms, cancelled: false }; state.timers.push(t); return t },
      clearTimer: (t) => { if (t) t.cancelled = true },
      log: { info: (m) => state.logs.push(m), warn: (m) => state.logs.push(m) },
    },
  )
  return {
    browser, state, alive,
    /** 触发最后一个未取消的计时器。 */
    fireTimers() {
      for (const t of state.timers) if (!t.cancelled && !t.fired) { t.fired = true; t.fn() }
    },
    liveTimers() { return state.timers.filter((t) => !t.cancelled && !t.fired) },
  }
}

// ── 3. 已就绪：不重复拉起 ─────────────────────────────────────────────────
{
  const h = harness()
  h.state.ready = true
  await h.browser.ensure()
  need(h.state.launches.length === 0, '端点已就绪时不拉起新实例')
  need(h.browser.owns === false, '已就绪且无归属记录时不认领')
}

// ── 4. 未就绪：拉起并等就绪 ───────────────────────────────────────────────
{
  const h = harness()
  h.state.ready = false
  const p = h.browser.ensure()
  // 让 waitForCdp 转一圈后端点才可用
  setTimeout(() => { h.state.ready = true }, 10)
  await p
  need(h.state.launches.length === 1, `未就绪时拉起一次（实际 ${h.state.launches.length}）`)
  need(h.browser.owns === true, '拉起后 owns = true')
  need(h.state.markers.length === 1 && h.state.markers[0].pid === h.state.launches[0],
    '拉起后写入归属记录（pid 正确）')
  need(h.state.markers[0].port === 9222, '归属记录带端口')
}

// ── 5. 并发去重：两个调用只拉起一次 ───────────────────────────────────────
{
  const h = harness()
  const ps = [h.browser.ensure(), h.browser.ensure(), h.browser.ensure()]
  setTimeout(() => { h.state.ready = true }, 10)
  await Promise.all(ps)
  need(h.state.launches.length === 1, `并发 ensure 只拉起一次（实际 ${h.state.launches.length}）`)
}

// ── 6. 拉起后未就绪：立刻关掉并抛错 ───────────────────────────────────────
{
  const h = harness({ startTimeoutMs: 30, pollIntervalMs: 1 })
  let threw = false
  try { await h.browser.ensure() } catch { threw = true }
  need(threw, '拉起后 CDP 未就绪 → ensure 抛错')
  need(h.state.kills.length === 1, '未就绪的实例被立刻关掉（不留半死进程）')
  need(h.browser.owns === false, '关掉后 owns 复位为 false')
}

// ── 7. 空闲关停：只关自己拉起的 ───────────────────────────────────────────
{
  const h = harness({ idleMs: 1000 })
  h.state.ready = true
  h.state.marker = { pid: 4242, port: 9222, profileDir: 'P', startedAt: 1 }
  h.alive.add(4242)
  await h.browser.ensure()
  need(h.browser.owns === true, '认领落盘的归属实例')
  need(h.liveTimers().length === 1, '认领后起算空闲计时')
  h.fireTimers()
  need(h.state.kills.includes(4242), '空闲到点关掉自己拉起的实例')
  need(h.state.cleared === 1, '关停后清掉归属记录')
}

// ── 8. 空闲到点时调用仍在进行 → 不关 ──────────────────────────────────────
{
  const h = harness({ idleMs: 1000 })
  h.state.ready = true
  h.state.marker = { pid: 777, port: 9222, profileDir: 'P', startedAt: 1 }
  h.alive.add(777)
  await h.browser.ensure()
  h.browser.beginCall()
  h.fireTimers()
  need(h.state.kills.length === 0, '调用进行中不关停')
  h.browser.endCall()
  need(h.liveTimers().length === 1, '最后一个调用结束后重新起算空闲')
  h.fireTimers()
  need(h.state.kills.includes(777), '重新起算后到点关停')
}

// ── 9. 不关别人的实例（无归属）────────────────────────────────────────────
{
  const h = harness()
  h.state.ready = true
  await h.browser.ensure()
  h.browser.shutdown('测试')
  need(h.state.kills.length === 0, '无归属时不杀任何进程（用户自己的 Chrome 不动）')
}

// ── 10. 归属记录的端口不符 → 不认领 ───────────────────────────────────────
{
  const h = harness()
  h.state.ready = true
  h.state.marker = { pid: 555, port: 9999, profileDir: 'P', startedAt: 1 }
  h.alive.add(555)
  await h.browser.ensure()
  need(h.browser.owns === false, '端口不符的归属记录不认领')
  h.browser.shutdown('测试')
  need(!h.state.kills.includes(555), '不杀端口不符的进程')
}

// ── 11. 归属进程已死 → 不认领 ─────────────────────────────────────────────
{
  const h = harness()
  h.state.ready = true
  h.state.marker = { pid: 888, port: 9222, profileDir: 'P', startedAt: 1 }
  // 不加进 alive
  await h.browser.ensure()
  need(h.browser.owns === false, '归属进程已死时不认领')
}

// ── 12. dispose 关掉自己拉起的实例 ────────────────────────────────────────
{
  const h = harness()
  const p = h.browser.ensure()
  setTimeout(() => { h.state.ready = true }, 10)
  await p
  const pid = h.state.launches[0]
  h.browser.dispose()
  need(h.state.kills.includes(pid), 'dispose 关掉自己拉起的实例（不留孤儿）')
}

// ── 13. 坏归属文件当没有 ──────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bod-'))
  try {
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ not json')
    const readBad = browserOnDemandTest.readMarkerFile
    need(readBad(bad) === null, '归属文件是坏 JSON 时当没有（不抛错）')
    const missing = join(dir, 'nope.json')
    need(readBad(missing) === null, '归属文件不存在时返回 null')
    const good = join(dir, 'good.json')
    writeFileSync(good, JSON.stringify({ pid: 12, port: 9222, profileDir: 'P', startedAt: 3 }))
    const parsed = readBad(good)
    need(parsed?.pid === 12 && parsed?.port === 9222, '归属文件可正常解析')
    const noPid = join(dir, 'nopid.json')
    writeFileSync(noPid, JSON.stringify({ port: 9222 }))
    need(readBad(noPid) === null, '缺 pid 的归属文件当没有')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 14. applyBrowserOnDemand 接线：只拦浏览器工具 ─────────────────────────
{
  const listeners = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    on(event, listener) { if (event === 'tools/execute') listeners.push(listener) },
    effect: (fn) => { fn(); return () => {} },
  }
  const handle = mod.applyBrowserOnDemand(ctx, { idleMs: 0 })
  need(handle !== null, 'applyBrowserOnDemand 返回句柄')
  need(listeners.length === 1, '注册了 1 个 tools/execute 监听')

  // 普通工具：原样透传，不触发任何探针
  let nextCalled = 0
  await listeners[0]({ name: 'pwsh' }, async () => { nextCalled += 1; return 'r' })
  need(nextCalled === 1, '普通工具调用原样透传')

  // 禁用时返回 null
  const off = mod.applyBrowserOnDemand({ on: () => {}, logger: {} }, { enabled: false })
  need(off === null, 'enabled:false 时不装配')

  // 缺 ctx.on：不抛错，返回 null
  const noOn = mod.applyBrowserOnDemand({ logger: {} }, {})
  need(noOn === null, 'ctx.on 缺失时静默降级（返回 null 不抛错）')
}

// ── 15. 构建产物仍是自包含的（本模块不引入 @deepseek-ai/* 运行时依赖）────
{
  const source = readFileSync(HOST, 'utf8')
  const specs = [...source.matchAll(/(?:^|[;\n])\s*(?:import|export)[^\n]*?from\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith('node:') && s !== 'undici')
  need(specs.length === 0, `host 产物仍零外部依赖（实际 ${JSON.stringify(specs)}）`)
}

if (process.exitCode === 1) console.error('\n[browser-on-demand] 有用例失败')
else console.log('\n[browser-on-demand] 全部通过')
