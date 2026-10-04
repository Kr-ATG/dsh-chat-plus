/**
 * dsh-triad — browser half smoke test.
 *
 * Executes `lib/client.js` under a stubbed DSH client environment and asserts:
 *   1. it registers exactly one `__ModuleLoader__` entry with the right id
 *   2. the factory exports `apply` (function) and `inject` (array)
 *   3. `apply(ctx)` runs all three modules without throwing
 *
 * Usage: node scripts/smoke-client.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CLIENT = resolve(ROOT, 'lib/client.js')

/** Stand-in for any React component export. */
function stubComponent(name) {
  const Comp = () => ({ __stub: name })
  Object.defineProperty(Comp, 'name', { value: name })
  return Comp
}

/**
 * Minimal DOM node. The nav-row mounting code walks the real sidebar with
 * `compareDocumentPosition`, so the stub has to answer it or the memory
 * module bails out before reaching the interesting code paths.
 */
function stubNode(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    attrs: {},
    appendChild(child) { node.children.push(child); return child },
    insertBefore(child) { node.children.unshift(child); return child },
    removeChild(child) {
      const i = node.children.indexOf(child)
      if (i >= 0) node.children.splice(i, 1)
      return child
    },
    remove() {},
    setAttribute(k, v) { node.attrs[k] = v },
    getAttribute(k) { return node.attrs[k] ?? null },
    removeAttribute(k) { delete node.attrs[k] },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    contains: () => false,
    compareDocumentPosition: () => 0,
    getRootNode: () => sandbox.document,
    focus: () => {},
    click: () => {},
  }
  return node
}

/** Explicit React overrides. Kept separate so the Proxy below can consult it
 *  first — a bare `get` trap would otherwise shadow every one of these. */
const REACT_OVERRIDES = {
      createElement: (type, props, ...children) => ({ type, props, children }),
      cloneElement: (el) => el,
      isValidElement: () => false,
      Children: { map: () => [], forEach: () => {}, count: () => 0, toArray: () => [] },
      Fragment: Symbol('Fragment'),
      // Real class, not a stub function: `class X extends Component` is a
      // module-top-level evaluation (error boundaries), and extending the
      // generic stub function throws "is not a constructor".
      Component: class Component {
        constructor(props) {
          this.props = props
          this.state = null
        }

        setState() {}

        forceUpdate() {}

        render() {
          return null
        }
      },
      StrictMode: stubComponent('StrictMode'),
      Suspense: stubComponent('Suspense'),
      memo: (comp) => comp,
      forwardRef: (render) => render,
      lazy: () => stubComponent('Lazy'),
      startTransition: (fn) => fn?.(),
      createRef: () => ({ current: null }),
      createContext: () => ({ Provider: stubComponent('Provider'), Consumer: stubComponent('Consumer') }),
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useReducer: (reducer, init) => [init, () => {}],
      useEffect: () => {},
      useLayoutEffect: () => {},
      useInsertionEffect: () => {},
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: (init) => ({ current: init }),
      useImperativeHandle: () => {},
      useContext: () => ({}),
      useId: () => 'stub-id',
      useDebugValue: () => {},
      useSyncExternalStore: (_sub, get) => get(),
      useTransition: () => [false, (fn) => fn?.()],
      useDeferredValue: (v) => v,
}

/** Everything the bundle may ask the platform for. */
const MODULES = {
  'react': new Proxy(REACT_OVERRIDES, {
    // Known export → the real override; anything else (icon sets, future
    // hooks) falls back to a stub component.
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined
      if (Object.hasOwn(target, prop)) return target[prop]
      return stubComponent(prop)
    },
    has: () => true,
  }),
  'react/jsx-runtime': {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
    Fragment: Symbol('Fragment'),
  },
  'react-dom': { createPortal: (node) => node },
  'react-dom/client': { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
  '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, {
    get: (_t, prop) => (typeof prop === 'string' ? stubComponent(prop) : undefined),
    has: () => true,
  }),
}

// ── capture the loader registration ──────────────────────────────────────
const registrations = []
const sandbox = {
  __ModuleLoader__: { load: (entry) => { registrations.push(entry) } },
  document: {
    head: stubNode('head'),
    body: stubNode('body'),
    documentElement: stubNode('html'),
    createElement: (tag) => stubNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByTagName: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  console,
  // **URL 必须显式注入**：vm.createContext 造的是全新 V8 context，而 URL 是 Node
  // 注入的宿主全局、不是 ECMAScript 内建，不给就等于 undefined。于是 bundle 里
  // 所有 `new URL(...)` 都在走 catch 降级分支 —— siteOf 恰好有裸主机名兜底看不出
  // 异样，但 navigateDetail 的「根路径默认落地」判定会静默变成 false，把首页
  // 自动跳频道页误报成「被重定向」。真实浏览器里 URL 一直在，sandbox 必须还原。
  URL,
  URLSearchParams,
  // Timers are recorded but never scheduled: the nav-mount poller would
  // otherwise keep the event loop alive and hang the smoke run.
  setTimeout: (() => { let id = 0; return (fn, ms) => { void fn; void ms; return ++id } })(),
  clearTimeout: () => {},
  setInterval: (() => { let id = 0; return (fn, ms) => { void fn; void ms; return ++id } })(),
  clearInterval: () => {},
  queueMicrotask: (fn) => fn(),
  fetch: async () => ({ ok: false, status: 599, json: async () => ({}) }),
  AbortController,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  CSS: { supports: () => false },
}
// Browsers alias `window` to the global object; the bundle uses `window.setInterval`.
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.top = sandbox
sandbox.parent = sandbox
sandbox.location = { href: 'http://127.0.0.1:0/', origin: 'http://127.0.0.1:0', protocol: 'http:', host: '127.0.0.1:0' }
sandbox.navigator = { userAgent: 'dsh-triad-smoke', language: 'zh-CN', maxTouchPoints: 0 }
sandbox.innerWidth = 1440
sandbox.innerHeight = 900
sandbox.devicePixelRatio = 1
sandbox.addEventListener = () => {}
sandbox.removeEventListener = () => {}
sandbox.dispatchEvent = () => true
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' })
sandbox.scrollTo = () => {}

const context = vm.createContext(sandbox)
const code = readFileSync(CLIENT, 'utf8')
new vm.Script(code, { filename: CLIENT }).runInContext(context)

// ── assertions ───────────────────────────────────────────────────────────
const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

if (registrations.length !== 1) fail(`expected 1 loader registration, got ${registrations.length}`)
else pass('registered exactly one __ModuleLoader__ entry')

// 融合后 client bundle 的 loader id 是主插件 id（dsh-chat-plus）；这里的断言面
// 从「triad 单独一枚」改成「融合后同一枚 factory 里 triad 半身仍可用」。
const entry = registrations[0]
if (entry?.id !== 'dsh-chat-plus') fail(`expected id "dsh-chat-plus", got ${JSON.stringify(entry?.id)}`)
else pass('loader id is "dsh-chat-plus" (fused bundle)')

const require = (id) => {
  if (id in MODULES) return MODULES[id]
  throw new Error(`[smoke] unexpected require(${id}) — add it to the stub table`)
}

const mod = entry.factory(require)
if (typeof mod.apply !== 'function') fail('factory did not export apply()')
else pass('factory exports apply()')
if (!Array.isArray(mod.inject)) fail('factory did not export inject[]')
else pass(`factory exports inject[] = [${mod.inject.join(', ')}]`)

// ── run apply() against a stub client context ────────────────────────────
// 融合后的 apply 同时装配对话增强 + 工作台，所以桩要给全 chat-plus 也要用的
// slots.entries（captureOfficialAssistantStep 要读官方 assistant-step 条目）。
const registered = []
const slotsStub = {
  register: (_spec, comp) => { if (comp === undefined) throw new Error('slots.register called without component'); return () => {} },
  inject: (_slot, factory) => { factory?.(); return () => {} },
  entries: (name) => (name === 'conversation.chat.node' ? [{ key: 'assistant-step', options: { inject: [] } }] : []),
}
const ctx = {
  effect: (fn) => { registered.push(typeof fn === 'function' ? fn() : undefined); return () => {} },
  // locale.bind：工作台菜单行文案走官方 locale 命名空间（thunk 每次读取都重跑）。
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: slotsStub,
  get: (name) => (name === 'sessions' ? { list: { getSnapshot: () => ({ byId: {} }) } } : undefined),
  inject: (names, fn) => {
    if (!Array.isArray(names)) throw new Error('ctx.inject expects a names array')
    const scope = { slots: slotsStub, locale: ctx.locale }
    for (const n of names) {
      if (n === 'sessions') scope.sessions = ctx.get('sessions')
      else if (n === 'inputTriggers') scope.inputTriggers = { register: () => () => {} }
      else if (n === 'layout') scope.layout = { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } }
      else scope[n] = undefined
    }
    fn?.(scope)
  },
}

try {
  mod.apply(ctx)
  pass('apply(ctx) ran all modules (chat-plus + four workbenches) without throwing')
} catch (error) {
  fail(`apply(ctx) threw: ${error?.stack ?? error}`)
}

// ── Token 活动：52 周贡献热力模型（纯函数断言） ─────────────────────────
const { buildActivityGrid, activityColor, ACTIVITY_COLUMNS: ACTIVITY_COLS } = mod
if (typeof buildActivityGrid !== 'function' || typeof activityColor !== 'function') {
  fail('buildActivityGrid / activityColor must be exported from the client bundle')
} else if (ACTIVITY_COLS !== 52) {
  fail(`Token 活动 must span 52 week columns, got ${ACTIVITY_COLS}`)
} else {
  pass('Token 活动 exports 52-week grid model')
}

const weekKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const weekdayIdx = (key) => { const [y, m, d] = key.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7 }
const fixedToday = new Date(2026, 7, 23) // 2026-08-23（周日）
const synthDays = []
for (let i = 0; i < 60; i += 1) {
  const d = new Date(2026, 7, 23 - i)
  const wd = (d.getDay() + 6) % 7
  const weekend = wd === 0 || wd === 6
  synthDays.push({ date: weekKey(d), tokens: weekend ? 4000 : 90000 + (i % 9) * 55000, requests: 3 + (i % 5), cacheHitRate: i % 4 === 0 ? 0 : 87.3 })
}

if (typeof buildActivityGrid === 'function') {
  const snap = buildActivityGrid(synthDays, 'day', fixedToday)
  if (snap.columns !== 52 || snap.cells.length !== 52 * 7) fail(`grid shape must be 52 x 7, got ${snap.cells.length} cells`)
  else if (snap.rows.length !== 7 || snap.rows.some((row) => row.length !== 52)) fail('rows must be 7 rows of 52')
  else pass('grid shape is 52 weeks x 7 weekday rows')

  const todayCell = snap.cells.find((c) => c.key === '2026-08-23')
  if (todayCell === undefined || todayCell.isToday !== true || todayCell.column !== 51) fail('today must sit in the last column')
  else pass('grid right-aligns on the current week')

  const futureCount = snap.cells.filter((c) => !c.past).length
  if (futureCount !== 6 - weekdayIdx('2026-08-23')) fail(`only the current week holds future placeholders, got ${futureCount}`)
  else pass('future days are in-week placeholders only')

  const byDate = new Map(synthDays.map((d) => [d.date, d.tokens]))
  const dayOk = snap.cells.every((c) => c.tokens === (byDate.get(c.key) ?? 0))
  if (!dayOk) fail('day mode must carry each day own tokens')
  else pass('day mode carries per-day tokens')

  const weekSnap = buildActivityGrid(synthDays, 'week', fixedToday)
  let weekOk = true
  for (let c = 0; c < 52; c += 1) {
    if (new Set(weekSnap.rows.map((row) => row[c].tokens)).size !== 1) { weekOk = false; break }
  }
  if (!weekOk) fail('week mode must share one Monday-start total per column')
  else pass('week mode shares one total per column')

  const cumSnap = buildActivityGrid(synthDays, 'cumulative', fixedToday)
  let prev = -1
  let cumOk = true
  for (const cell of cumSnap.cells) {
    if (cell.tokens < prev) { cumOk = false; break }
    prev = cell.tokens
  }
  if (!cumOk) fail('cumulative must never decrease')
  else pass('cumulative mode is monotonic')

  const expectedTotal = synthDays.reduce((sum, d) => sum + d.tokens, 0)
  if (cumSnap.cells[cumSnap.cells.length - 1].tokens !== expectedTotal) fail('cumulative tail must equal the token total')
  else pass('cumulative tail equals total tokens')

  const expectedPeak = Math.max(...synthDays.map((d) => d.tokens))
  if (snap.peakDay === null || snap.peakTokens !== expectedPeak) fail(`peak day must be the busiest day, expected ${expectedPeak}`)
  else pass('peak-day detection ok')

  if (snap.activeDays !== synthDays.filter((d) => d.tokens > 0).length) fail('activeDays must count non-zero days')
  else pass('active-day count ok')
}

if (typeof activityColor === 'function') {
  const alphaOf = (t, m) => Number(activityColor(t, m).match(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/)?.[1] ?? -1)
  if (!activityColor(0, 100).includes('color-mix')) fail('zero must render the neutral gray fill')
  else if (alphaOf(1e9, 1e9) !== 1) fail('the busiest cell must reach alpha 1')
  else {
    const ramp = [1, 1000, 100000, 10000000].map((t) => alphaOf(t, 10000000))
    if (ramp.some((a, i) => i > 0 && a <= ramp[i - 1])) fail(`color ramp must be monotonic: ${ramp.join(',')}`)
    else if (ramp[0] !== 0.25) fail(`the quietest cell must start at alpha 0.25, got ${ramp[0]}`)
    else pass(`activity color ramp ok: ${ramp.map((a) => a.toFixed(3)).join(' -> ')}`)
  }
}

// ── 用量筛选：下拉选项 id ↔ filterDaysByScope 比对值必须同口径 ──────────
//
// 真故障：模型下拉的 id 曾经是剥掉供应商前缀的短名（`deepseek-v4.1-flash`），
// 而 filterDaysByScope 拿它跟完整 model 串（`wb/deepseek-v4.1-flash`）全等比较
// —— 选任何模型都筛不出数据，四格归零、热力图全空、元信息显示
// 「有量 0 天 · 0 个模型」；同时三个供应商下的同名模型会先在 Map 里被合并成
// 一条，用户根本选不到其中任何一个。
//
// 口径固定为：**供应商选项 id = 前缀段；模型选项 id = 完整 model 串**。
// 两条都必须能被 filterDaysByScope 原样吃下，这里用「选它筛出来的总量 =
// 下拉里标的量」闭环断言，比断言字符串形状更抗改。
{
  const { collectModels, collectProviders, filterDaysByScope } = mod
  if (typeof collectModels !== 'function' || typeof collectProviders !== 'function' || typeof filterDaysByScope !== 'function') {
    fail('collectModels / collectProviders / filterDaysByScope must be exported from the client bundle')
  } else {
    const filterDays = [{
      date: '2026-10-01',
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, tokens: 165, cacheHitRate: 9,
      models: [
        { model: 'group/auto-deepseek-v4-1-flash', inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, tokens: 165, cacheHitRate: 9 },
        { model: 'workbuddy-ai/deepseek-v4.1-flash', inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 30, cacheHitRate: 0 },
        { model: 'workbuddy/deepseek-v4.1-flash', inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 10, cacheHitRate: 0 },
        { model: 'plainmodel', inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 6, cacheHitRate: 0 },
      ],
    }]

    const models = collectModels(filterDays, null)
    const providers = collectProviders(filterDays)
    const mismatched = [
      ...models.map((o) => ['model', o]),
      ...providers.map((o) => ['provider', o]),
    ].filter(([kind, o]) => {
      const got = filterDaysByScope(filterDays, kind === 'provider' ? o.id : null, kind === 'provider' ? null : o.id)[0].tokens
      return got !== o.tokens
    })

    // 同名不同供应商的模型必须是两条独立选项（合并 = 用户选不到其中任何一个）。
    const sameName = models.filter((m) => m.label === 'deepseek-v4.1-flash')

    if (mismatched.length > 0) {
      fail(`下拉选项 id 与 filterDaysByScope 口径不一致（选了筛不出数据）：${mismatched.map(([k, o]) => `${k}:${o.id}`).join(' / ')}`)
    } else if (sameName.length !== 2) {
      fail(`同名不同供应商的模型必须各自独立成项，期望 2 条 deepseek-v4.1-flash，实际 ${sameName.length} 条`)
    } else {
      pass(`用量筛选口径一致：${models.length} 个模型 / ${providers.length} 个供应商选项都能筛出下拉里标的量（同名模型各自独立）`)
    }
  }
}

// ── 人话行动流：工具调用 → 中文人话 + 时间线组装 ────────────────────────
//
// extractIntent 已随「执行过程播报」整条通道下掉（2026-10-01）：承载它的预告行
// 早被删除，nowLabel 没有渲染出口，模型每步白写一行。这里不再断言它存在。
const {
  toPlainStep, plainToolName, siteOf, isMetaTool, spawnsSubagents, buildPlainTimeline, condenseSteps, humanIssue,
} = mod

if (typeof toPlainStep !== 'function' || typeof buildPlainTimeline !== 'function' || typeof condenseSteps !== 'function' || typeof humanIssue !== 'function') {
  fail('toPlainStep / buildPlainTimeline / condenseSteps / humanIssue must be exported from the client bundle')
} else if (typeof extractIntent === 'function') {
  fail('extractIntent 已随播报通道下掉，不该再出现在产物里')
} else {
  pass('plain-language exports present（extractIntent 已下掉）')

  // 命名空间前缀必须被剥掉：MCP 服务前缀由注册决定，规则表不该跟着它变。
  if (plainToolName('mcp__playwright-mcp__browser_click') !== 'browser_click') fail('mcp__ prefix must be stripped')
  else if (plainToolName('cua_driver_native__click') !== 'click') fail('plugin __ prefix must be stripped')
  else pass('tool names are namespace-normalised')

  if (siteOf('https://flights.ctrip.com/online/list/oneway-ctrip') !== '携程 · 机票') fail(`ctrip must map to 携程 · 机票, got ${siteOf('https://flights.ctrip.com/online/list/oneway-ctrip')}`)
  else if (siteOf('https://www.taobao.com') !== '淘宝') fail('taobao must map to 淘宝')
  else if (siteOf('https://unknown-shop.example/page') !== 'unknown-shop.example') fail('unknown hosts must fall back to the bare host')
  else pass('site names resolve to friendly labels')

  // 站点友好名 + 业务后缀
  const nav = toPlainStep({
    toolName: 'mcp__playwright-mcp__browser_navigate',
    args: { url: 'https://flights.ctrip.com/online/list/oneway-ctrip' },
    status: 'done',
  })
  if (nav.verb !== '打开网页' || nav.detail !== '携程 · 机票') fail(`browser_navigate must read as 打开网页 · 携程 · 机票, got ${nav.verb} · ${nav.detail}`)
  else pass('browser_navigate reads as plain language with a friendly site name')

  const typed = toPlainStep({ toolName: 'browser_type', args: { ref: 'e12', text: '北京' }, status: 'done' })
  if (typed.verb !== '在输入框里填写' || typed.detail !== '北京') fail(`browser_type must show the typed text, got ${typed.verb} · ${typed.detail}`)
  else pass('browser_type shows the typed value')

  // playwright-mcp 的两个高频工具：信息量最大的两个，不能只给一句「操作浏览器」。
  const filled = toPlainStep({
    toolName: 'mcp__playwright-mcp__browser_fill_form',
    args: { fields: [{ ref: 'e3', text: '北京' }, { ref: 'e4', text: '上海' }] },
    status: 'done',
  })
  const evaluated = toPlainStep({ toolName: 'browser_evaluate', args: { function: '() => 1' }, status: 'done' })
  if (filled.verb !== '填写表单' || filled.detail !== '北京、上海') {
    fail(`browser_fill_form must name what was typed, got ${filled.verb} · ${filled.detail}`)
  } else if (evaluated.verb === '操作浏览器') {
    fail('browser_evaluate must not fall through to the generic browser label')
  } else {
    pass('fill_form / evaluate read as real actions, not generic ones')
  }

  // 导航落地的五种形态（全部来自携程真机实验）。
  const cases = [
    ['https://flights.ctrip.com/', 'https://flights.ctrip.com/online/channel/domestic', '携程 · 机票'],
    ['https://flights.ctrip.com/online/list/oneway-ctrip?ddate=2026-10-05&dcity=bjs&acity=sha', 'https://flights.ctrip.com/online/channel', '携程 · 机票 · 目标信息已被忽略'],
    ['https://flights.ctrip.com/online/list/oneway-ctrip?dcity=bjs', 'https://flights.ctrip.com/online/list/oneway-ctrip?dcity=bjs&from=search', '携程 · 机票'],
    ['https://flights.ctrip.com/booking/BJS-SHA-day-1.html', 'https://flights.ctrip.com/online/list/round-szx-sha', '携程 · 机票 · 被重定向'],
    ['https://flights.ctrip.com/', 'https://www.qunar.com/flightsearch/', '携程 · 机票 → 去哪儿 · 机票'],
  ]
  const navBad = cases.find(([req, land, want]) =>
    toPlainStep({ toolName: 'browser_navigate', args: { url: req }, status: 'done', resultText: `### Page\n- Page URL: ${land}` }).detail !== want)
  if (navBad !== undefined) {
    fail(`navigation ${navBad[0]} → ${navBad[1]} must read as ${navBad[2]}, got ${toPlainStep({ toolName: 'browser_navigate', args: { url: navBad[0] }, status: 'done', resultText: `### Page\n- Page URL: ${navBad[1]}` }).detail}`)
  } else {
    pass('navigation covers all five landing shapes (default / intent dropped / clean / same-site / cross-site)')
  }

  // 桌面控制（cua-driver）：命名空间前缀被剥掉后只剩通用短名，既匹配不上
  // /^cua_/ 兜底也看不出是干什么的。这一组是从真实右栏截图里抓出来的：
  // 一屏都是「执行 get_window_state」「执行 zoom」。
  const cua = [
    ['cua_driver_native__get_window_state', '查看窗口内容'],
    ['cua_driver_native__list_windows', '列出窗口'],
    ['cua_driver_native__get_accessibility_tree', '读取界面元素'],
    ['cua_driver_native__bring_to_front', '激活窗口'],
    ['cua_driver_native__zoom', '放大查看局部'],
    ['cua_driver_native__clipboard_read', '读取剪贴板'],
    ['cua_driver_native__press_key', '按下按键'],
  ]
  const cuaBad = cua.find(([name, want]) => toPlainStep({ toolName: name, args: {}, status: 'done' }).verb !== want)
  if (cuaBad !== undefined) {
    fail(`cua tool ${cuaBad[0]} must read as ${cuaBad[1]}, got ${toPlainStep({ toolName: cuaBad[0], args: {}, status: 'done' }).verb}`)
  } else if (/^执行 /.test(toPlainStep({ toolName: 'cua_driver_native__get_window_state', args: {}, status: 'done' }).verb)) {
    fail('cua tools must not fall through to the generic 执行 X form')
  } else {
    pass('cua desktop tools read as plain Chinese, not 执行 X')
  }

  // 英文枚举不许露到卡片上。
  const scrolled = toPlainStep({ toolName: 'browser_scroll', args: { direction: 'down' }, status: 'done' })
  if (scrolled.detail !== '向下') fail(`browser_scroll direction must be translated, got ${scrolled.detail}`)
  else pass('browser_scroll direction is humanised')

  // 工具描述里常带 JSON 转义（注入词条、schema 描述都是 JSON 编出来的），
  // 原样透到卡片上就是一串 \uXXXX，用户看到的是机器码不是内容。
  const escaped = toPlainStep({ toolName: 'grep', args: { pattern: '\\u6B63\\u5728\\u505A\\u4EC0\\u4E48' }, status: 'done' })
  if (escaped.detail !== '正在做什么') {
    fail(`\\uXXXX in a tool description must be decoded, got ${escaped.detail}`)
  } else if (/\\u[0-9a-fA-F]{4}/.test(toPlainStep({ toolName: 'read', args: { file_path: 'C:\\work\\a.ts' }, status: 'done' }).detail ?? 'x')) {
    fail('path separators must NOT be unescaped (\\w would eat real backslashes)')
  } else {
    pass('JSON unicode escapes in descriptions are decoded, paths left intact')
  }

  // 重定向：请求 URL 与落地 URL 不一致时必须说出来，否则用户会以为搜索成功了。
  // 这条来自真机实验：携程的 /online/list/oneway-ctrip?dcity=bjs&acity=sha
  // 会被打回 /online/channel 首页，两边都识别成「携程 · 机票」。
  const ctripSearch = 'https://flights.ctrip.com/online/list/oneway-ctrip?ddate=2026-10-05&dcity=bjs&acity=sha'
  const bounced = toPlainStep({
    toolName: 'mcp__playwright-mcp__browser_navigate',
    args: { url: ctripSearch },
    status: 'done',
    resultText: '### Page\n- Page URL: https://flights.ctrip.com/online/channel',
  })
  const landedOk = toPlainStep({
    toolName: 'browser_navigate', args: { url: ctripSearch }, status: 'done',
    resultText: '### Page\n- Page URL: ' + ctripSearch,
  })
  const jumpedAway = toPlainStep({
    toolName: 'browser_navigate', args: { url: ctripSearch }, status: 'done',
    resultText: '### Page\n- Page URL: https://www.qunar.com/flightsearch/',
  })
  if (!/目标信息已被忽略/.test(bounced.detail ?? '')) {
    // 这条 case 就是「请求带了搜索参数、落地一个不剩」——比普通跳转更严重，
    // 措辞也必须更重：用户要知道自己搜的东西根本没送过去。
    fail(`a bounced navigation must say its target was dropped, got ${bounced.detail}`)
  } else if (landedOk.detail !== '携程 · 机票') {
    fail(`a clean landing must stay a plain site name, got ${landedOk.detail}`)
  } else if (jumpedAway.detail !== '携程 · 机票 → 去哪儿 · 机票') {
    // 去哪儿这条 URL 里的 `/flightsearch` 确实命中机票特征词（它就是航班搜索），
    // 两端都带「· 机票」才对；早先按"通用搜索页"判成不带机票是误判。
    fail(`a cross-site jump must name both sites, got ${jumpedAway.detail}`)
  } else {
    pass('navigation reports redirects and cross-site jumps')
  }

  // 畸形入参不许把整张卡带崩：plainToolName 收到 undefined 时必须当空名处理。
  if (toPlainStep({ toolName: undefined, args: {}, status: 'done' }).verb !== '执行操作') {
    fail('a malformed tool name must fall back to 执行操作, not throw')
  } else if (typeof spawnsSubagents !== 'function' || spawnsSubagents(undefined) !== false) {
    fail('spawnsSubagents must tolerate a missing tool name')
  } else {
    pass('malformed tool names degrade instead of throwing')
  }

  const clicked = toPlainStep({ toolName: 'browser_click', args: { ref: 'e9', element: '出发地' }, status: 'done' })
  if (clicked.verb !== '点击网页' || clicked.detail !== '出发地') fail(`browser_click must show the element label, got ${clicked.verb} · ${clicked.detail}`)
  else pass('browser_click shows the element label')

  // 完整路径绝不上屏：只留文件名。
  const read = toPlainStep({ toolName: 'read', args: { file_path: 'D:\\AI\\Dsh\\dsh-chat-plus\\src\\client\\index.ts' }, status: 'done' })
  if (read.verb !== '查看文件' || read.detail !== 'index.ts') fail(`read must show only the file name, got ${read.detail}`)
  else if (read.detail.includes('D:\\')) fail('read must never surface a full path')
  else pass('read shows the file name only')

  // 文件族四枚图标必须互不相同：读者靠形状一眼分「在看 / 在改 / 在建 / 在删」，
  // 四者共用一枚「文档」等于这一列什么也没说（尤其「修改」与「查看」紧挨着时）。
  const fileIcons = ['read', 'edit', 'write', 'delete_file'].map((name) =>
    toPlainStep({ toolName: name, args: { file_path: 'a.ts' }, status: 'done' }).icon)
  if (new Set(fileIcons).size !== 4) {
    fail(`read/edit/write/delete must map to four distinct icons, got ${fileIcons.join(',')}`)
  } else if (fileIcons[0] !== 'fileView' || fileIcons[1] !== 'fileEdit' || fileIcons[2] !== 'fileNew' || fileIcons[3] !== 'trash') {
    fail(`unexpected file family icons: ${fileIcons.join(',')}`)
  } else {
    pass('文件族四枚图标互不相同（看 / 改 / 建 / 删）')
  }

  // 原始命令行绝不上屏：只进 tech。
  const sh = toPlainStep({ toolName: 'pwsh', args: { command: 'Get-ChildItem -Recurse C:\\secret', description: '列出目录' }, argsRaw: '{"command":"Get-ChildItem -Recurse C:\\\\secret","description":"列出目录"}', status: 'done' })
  if (sh.verb !== '在终端执行命令' || sh.detail !== '列出目录') fail(`pwsh must use the description, got ${sh.verb} · ${sh.detail}`)
  else if (sh.verb.includes('Get-ChildItem') || (sh.detail ?? '').includes('secret')) fail('the raw command must never reach the headline')
  else if (sh.tech?.name !== 'pwsh' || !String(sh.tech?.args ?? '').includes('Get-ChildItem')) fail('the raw command must stay reachable through the technical detail')
  else pass('pwsh keeps the raw command out of the headline but reachable in tech')

  const unknown = toPlainStep({ toolName: 'mcp__acme__do_the_thing', args: {}, status: 'done' })
  if (!unknown.verb.startsWith('执行 ')) fail(`unknown tools must fall back to 执行 X, got ${unknown.verb}`)
  else pass('unknown tools fall back without throwing')

  if (!isMetaTool('todo_write') || isMetaTool('read')) fail('only todo_write counts as meta')
  else pass('todo_write is flagged as meta')

  // 时间线组装：真实节点形状 —— 运行中无 kind（顶层 name/argsRaw），
  // 已结束有 kind 且工具名/入参都在 block.call 下（callName / toolArgsRaw 读的是它）。
  const runningTool = { key: 'n1', data: { root: { name: 'browser_navigate', argsRaw: JSON.stringify({ url: 'https://flights.ctrip.com/online/list/oneway-ctrip' }), time: Date.now() - 900, subCalls: [] } } }
  const doneTool = { key: 'n2', data: { root: { kind: 'tool-call', call: { name: 'read', argsRaw: JSON.stringify({ file_path: 'C:\\work\\notes.md' }) }, time: 1000, callTime: 900, subCalls: [], content: [{ type: 'text', text: 'ok' }], isError: false, meta: {} } } }
  const metaTool = { key: 'n3', data: { root: { kind: 'tool-call', call: { name: 'todo_write', argsRaw: JSON.stringify({ todos: [] }) }, time: 1100, callTime: 1000, subCalls: [], content: [], isError: false, meta: {} } } }

  const tl = buildPlainTimeline({
    tools: [runningTool, metaTool, doneTool],
    running: true,
    now: Date.now(),
  })
  if (tl.steps.length !== 3) fail(`timeline must keep all calls, got ${tl.steps.length}`)
  else if (tl.steps[0].id !== 'n1') fail('the first call must stay first')
  // todo_write 只出**一行汇总**，且钉在它首次出现的位置（不是甩到最后）。
  else if (tl.steps[1].id !== 'plain-todo-summary') fail('todo_write must collapse into one summary row at its first position')
  else if (tl.steps[1].verb !== '维护任务清单') fail(`summary row must read as 维护任务清单, got ${tl.steps[1].verb}`)
  else if (tl.steps.filter((s) => s.id === 'plain-todo-summary').length !== 1) fail('todo_write must produce exactly one summary row')
  else if (tl.steps[2].id !== 'n2') fail('calls after the todo_write must keep their order')
  else if (tl.activeCount !== 1 || tl.doneCount !== 2) fail(`active/done counts wrong: ${tl.activeCount}/${tl.doneCount}`)
  // 播报通道下掉后，时间线不再有 intent / nowLabel 两个字段。
  else if ('intent' in tl || 'nowLabel' in tl) fail('时间线不该再有 intent / nowLabel（播报通道已整条下掉）')
  else pass('timeline assembles calls in order, todo collapsed in place')

  // 多次 todo_write 折叠成一行，并报出「改了几次 / 完成几项」。
  const twiceTl = buildPlainTimeline({
    tools: [metaTool, doneTool, metaTool], running: false, now: 2000,
  })
  const summary = twiceTl.steps.find((s) => s.id === 'plain-todo-summary')
  if (twiceTl.steps.filter((s) => s.id === 'plain-todo-summary').length !== 1) {
    fail('repeated todo_write calls must still collapse into ONE row')
  } else if (summary?.detail === undefined || !summary.detail.includes('2 次')) {
    fail(`summary row must report how many times the list changed, got ${summary?.detail}`)
  } else {
    pass('repeated todo_write calls collapse into one row with a change count')
  }

  // 单个进行中的调用：卡片不能空，它必须仍被列出来（现在没有「当前动作」那行兜底了）。
  const bare = buildPlainTimeline({ tools: [runningTool], running: true, now: Date.now() })
  if (bare.steps.length !== 1) fail(`fallback timeline must still list the call, got ${bare.steps.length}`)
  else if (bare.activeCount !== 1) fail(`running call must be counted active, got ${bare.activeCount}`)
  else pass('timeline still lists a lone running call')

  // 子智能体标记：subagent / workflow / ralph 这类会派生**独立会话**的工具
  // 必须在时间线上打标，卡片才会给它挂子智能体区块。subCalls 那条通道是
  // Code Dispatch（工具里再调工具），两者不是一回事，别混。
  const wf = toPlainStep({ toolName: 'workflow', args: { name: '多角度审计' }, status: 'running' })
  const sb = toPlainStep({ toolName: 'subagent', args: { description: '查一下携程' }, status: 'done' })
  const rd = toPlainStep({ toolName: 'read', args: { file_path: 'a.ts' }, status: 'done' })
  if (wf.spawnsSubagents !== true || sb.spawnsSubagents !== true) {
    fail('workflow / subagent 必须标记 spawnsSubagents（否则卡片不挂子智能体区块）')
  } else if (rd.spawnsSubagents !== undefined) {
    fail('普通工具不应被标记 spawnsSubagents')
  } else {
    pass('派生独立会话的工具带 spawnsSubagents 标记')
  }

  // impact（读 / 写）：简要模式靠它决定谁留下。规则表漏声明的一律 read，
  // 但真正"改变了什么"的那几条必须逐条显式标 write —— 标漏一条，用户就在
  // 简要模式里看不到"改了哪个文件"。
  const impacts = [
    ['read', 'read'], ['glob', 'read'], ['grep', 'read'], ['web_search', 'read'],
    ['browser_snapshot', 'read'], ['get_window_state', 'read'],
    ['write', 'write'], ['edit', 'write'], ['apply_patch', 'write'], ['delete_file', 'write'],
    ['browser_click', 'write'], ['browser_navigate', 'write'], ['generate_image', 'write'],
    ['download', 'write'], ['present', 'write'], ['subagent', 'write'],
    ['memory_remember', 'write'],
  ].filter(([tool]) => toPlainStep({ toolName: tool, args: {}, status: 'done' }).impact !== undefined)
  const wrong = impacts.filter(([tool, want]) => toPlainStep({ toolName: tool, args: {}, status: 'done' }).impact !== want)
  if (wrong.length > 0) {
    fail(`impact 标注错误: ${wrong.map(([t, w]) => `${t} 期望 ${w} 实得 ${toPlainStep({ toolName: t, args: {}, status: 'done' }).impact}`).join('; ')}`)
  } else {
    pass('impact 读/写标注正确（写/改/删/下载/生成/派子任务/记记忆 = write）')
  }

  // 简要模式 = 详细 − 文件操作：走到哪（里程碑合并）、出了什么事（未解决的失败 +
  // 人话原因）、卡到哪（进行中永远保留）。
  //
  // 「文件操作整类不显示」是用户点名的口径：一屏「修改文件 xxx」「新建文件 xxx」
  // 读下来等于什么都没说。但两处必须留：① 失败的（卡住的信号）；② 进行中的
  // （"现在在干什么"，连续改文件时往往就这一条）。
  const seq = [
    toPlainStep({ toolName: 'read', args: { file_path: 'a.ts' }, status: 'done' }),
    toPlainStep({ toolName: 'read', args: { file_path: 'b.ts' }, status: 'done' }),
    toPlainStep({ toolName: 'edit', args: { file_path: 'd.ts' }, status: 'done' }),
    toPlainStep({ toolName: 'edit', args: { file_path: 'd.ts' }, status: 'done' }),
    toPlainStep({ toolName: 'edit', args: { file_path: 'd.ts' }, status: 'done' }),
    // 这一条失败后来重试成功了 → 已解决，不该出现在纪要里
    toPlainStep({ toolName: 'read', args: { file_path: 'f.ts' }, status: 'failed', errorText: 'ENOENT: no such file' }),
    toPlainStep({ toolName: 'read', args: { file_path: 'f.ts' }, status: 'done' }),
    // 这一条到时间线末尾都没成功 → 真出事了，必须留下并带人话原因
    toPlainStep({ toolName: 'pwsh', args: { description: '推送' }, status: 'failed', errorText: 'EACCES: permission denied' }),
    // 非文件动作：留着（打开网页不是"改了哪个文件"）。
    // 注意**不能用 pwsh/bash 这类 terminal 动作**当这条样本：上面那条失败的 pwsh
    // 也是 terminal icon，而"已解决的失败"是按 icon 判定的 —— 撞上就会被判成
    // 已翻篇而剔掉，这条断言就测不到东西了。
    toPlainStep({ toolName: 'browser_navigate', args: { url: 'https://ctrip.com' }, status: 'done' }),
    toPlainStep({ toolName: 'memory_remember', args: { content: '记一条' }, status: 'done' }),
    // 进行中的文件操作：留着（"卡到哪了"）
    toPlainStep({ toolName: 'edit', args: { file_path: 'e.ts' }, status: 'running' }),
  ]
  const briefSteps = condenseSteps(seq)
  const briefFailed = briefSteps.filter((s) => s.status === 'failed')
  const briefText = JSON.stringify(briefSteps.map((s) => [s.verb, s.detail]))
  if (briefSteps.some((s) => s.detail === 'a.ts' || s.detail === 'b.ts')) {
    fail('简要模式不该保留纯 read 步骤（翻文件不是里程碑）')
  } else if (briefSteps.some((s) => s.detail === 'd.ts')) {
    fail('简要模式不该保留成功的文件操作（用户点名：不想看"改了哪些文件"）')
  } else if (!briefSteps.some((s) => s.verb === '打开网页')) {
    fail('简要模式必须保留非文件动作（打开网页 / 搜索网络这类"真的干了什么"）')
  } else if (briefFailed.length !== 1 || briefFailed[0].issue !== '没有权限') {
    fail(`只该留下未解决的那条失败且带人话原因, got ${JSON.stringify(briefFailed.map((s) => [s.detail, s.issue]))}`)
  } else if (!briefSteps.some((s) => s.status === 'running' && s.detail === 'e.ts')) {
    fail('简要模式必须保留「卡到哪了」（进行中那一步，文件操作也算）')
  } else if (briefText.includes('d.ts')) {
    fail('成功的文件操作必须整类消失')
  } else {
    pass('简要模式 = 详细 − 文件操作（非文件动作留 / 未解决的错留 / 进行中的留）')
  }

  // 整轮只剩文件操作时的兜底：不能给空列表（读起来是"这轮什么都没发生"）。
  const onlyFiles = condenseSteps([
    toPlainStep({ toolName: 'edit', args: { file_path: 'a.ts' }, status: 'done' }),
    toPlainStep({ toolName: 'write', args: { file_path: 'b.ts' }, status: 'done' }),
  ])
  if (onlyFiles.length !== 1 || !/改动了 2 个文件/.test(onlyFiles[0].verb)) {
    fail(`整轮只剩文件操作时该折成一行兜底, got ${JSON.stringify(onlyFiles.map((s) => s.verb))}`)
  } else {
    pass('整轮只剩文件操作 → 折一行「改动了 N 个文件」，不给空列表')
  }

  // fileOp 标记：只有"改本地文件"那几条带，下载 / 上传刻意不带（用户要求留在简要里）。
  const fileOps = ['read', 'read_file', 'write', 'edit', 'apply_patch', 'str_replace_editor', 'delete_file']
  const notFileOps = ['download', 'browser_set_input_files', 'file_upload', 'browser_navigate', 'web_search', 'pwsh', 'present']
  const missed = fileOps.filter((t) => toPlainStep({ toolName: t, args: {}, status: 'done' }).fileOp !== true)
  const overreach = notFileOps.filter((t) => toPlainStep({ toolName: t, args: {}, status: 'done' }).fileOp === true)
  if (missed.length > 0) {
    fail(`这些工具必须标 fileOp（简要模式要砍掉）：${missed.join(', ')}`)
  } else if (overreach.length > 0) {
    fail(`这些工具不该标 fileOp（下载/上传/浏览不是改本地文件）：${overreach.join(', ')}`)
  } else {
    pass('fileOp 标记：查看/新建/修改/删除文件 = true；下载/上传/浏览 = false')
  }

  // 失败原因必须翻成人话，且认不出类别时宁可不给（不把英文报错糊到用户脸上）。
  if (humanIssue('ENOENT: no such file or directory, open \'D:\\a\\b.ts\'') !== '找不到文件或页面'
    || humanIssue('Request failed with status 403 Forbidden') !== '没有权限'
    || humanIssue('connect ECONNREFUSED 127.0.0.1:3080') !== '连不上对方'
    || humanIssue('the operation was aborted by the user') !== '被中断了') {
    fail('humanIssue 必须把常见技术报错翻成人话')
  } else if (humanIssue('zzz 完全无法归类的怪东西') !== undefined) {
    fail('认不出类别的报错必须返回 undefined（宁可空着，不贴英文原文）')
  } else if (toPlainStep({ toolName: 'read', args: {}, status: 'done', errorText: 'ENOENT' }).issue !== undefined) {
    fail('没失败的步骤不该带 issue')
  } else {
    pass('失败原因翻成人话；认不出就不显示')
  }

  // 纯函数性：相同输入必须等价输出。
  const again = buildPlainTimeline({ tools: [doneTool], running: false, now: 2000 })
  if (again.steps.length !== 1 || again.steps[0].id !== doneTool.key) fail('buildPlainTimeline must be deterministic')
  else pass('buildPlainTimeline is deterministic')
}

// ── 多媒体画廊（工作台第五 Tab）：源码形状契约 ─────────────────────────
{
  const { readFileSync: readSrc } = await import('node:fs')
  const { resolve: resolveSrc } = await import('node:path')
  const srcOf = (rel) => readSrc(resolveSrc(ROOT, rel), 'utf8')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')

  const hubSrc = strip(srcOf('src/client/triad/hub/WorkbenchPanel.tsx'))
  const panelSrc = strip(srcOf('src/client/triad/gallery/GalleryPanel.tsx'))
  const lbSrc = strip(srcOf('src/client/triad/gallery/media-lightbox.tsx'))
  const apiSrc = strip(srcOf('src/client/triad/gallery/api.ts'))

  if (!/'memory' \| 'skills' \| 'usage' \| 'gallery' \| 'mail'/.test(hubSrc)) {
    fail('WorkbenchTab 联合类型必须含 gallery（工作台第五 Tab）')
  } else if (!/<GalleryPanel onClose=\{onClose\} \/>/.test(hubSrc)) {
    fail('WorkbenchPanel 必须渲染 GalleryPanel（画廊 Tab 页本体）')
  } else if (!/>\s*画廊\s*</.test(hubSrc) && !/画廊</.test(hubSrc)) {
    fail('工作台 Tab 栏必须有「画廊」按钮')
  } else {
    pass('工作台第五 Tab「画廊」接入在位（类型 + 渲染 + 按钮）')
  }

  if (!/sandbox="allow-scripts allow-popups allow-forms allow-modals"/.test(lbSrc)) {
    fail('共享 MediaLightbox 的 html 预览 iframe 必须带 sandbox 且**不给 allow-same-origin**（成品页不得读宿主同源状态）')
  } else if (/allow-same-origin/.test(lbSrc)) {
    fail('Lightbox iframe 的 sandbox 绝不能含 allow-same-origin')
  } else if (!/data-full=\{full/.test(lbSrc) || !/tg-lb__fullbtn/.test(lbSrc)) {
    fail('共享 MediaLightbox 必须有全屏切换钮（data-full 态 + tg-lb__fullbtn，用户 2026-10-04 点名）')
  } else if (!/event\.key === 'f' \|\| event\.key === 'F'/.test(lbSrc)) {
    fail('全屏必须有 F 键快捷键，且 Esc 分层（全屏中先退全屏再关闭）')
  } else if (!/MediaLightbox/.test(panelSrc)) {
    fail('GalleryPanel 必须复用共享 MediaLightbox（不得自带第二份 Lightbox）')
  } else if (!/galleryRawUrl\(item\.path\)/.test(panelSrc)) {
    fail('画廊文件预览必须走 /api/triad/gallery/raw（host 索引白名单），不得直接 file:// 或 /api/file')
  } else if (!/tryOpenInSidebar\(item\.path/.test(panelSrc)) {
    fail('PPT/Word/Excel 必须走官方右栏文档预览（tryOpenInSidebar），拿不到服务才降级下载')
  } else if (!/INLINE_PREVIEW_KINDS/.test(panelSrc)) {
    fail('画廊必须按类别分流打开方式（内联预览白名单）')
  } else if (!/IntersectionObserver/.test(panelSrc) || !/generatedUrlCache/.test(panelSrc)) {
    fail('generated（生图）缩略图必须进视口才解析 spill（IntersectionObserver）且结果进缓存')
  } else if (!/prefers-reduced-motion/.test(srcOf('src/client/triad/gallery/styles.ts'))) {
    fail('画廊样式必须尊重 prefers-reduced-motion')
  } else if (!/tg-card-in/.test(srcOf('src/client/triad/gallery/styles.ts'))) {
    fail('画廊卡片必须有入场动效（tg-card-in 级联上浮）')
  } else {
    pass('画廊面板：沙箱 iframe + raw 白名单 + 右栏 Office 预览 + spill 懒解析 + 动效在位')
  }

  if (!/res\.status === 404/.test(apiSrc) || !/重启 DSH 服务/.test(apiSrc)) {
    fail('gallery api 必须把 404（host 未挂载）翻成人话「请重启 DSH 服务」，不得把 JSON 解析错误糊给用户')
  } else if (!/\/api\/triad\/gallery\/media/.test(apiSrc) || !/\/api\/triad\/gallery\/raw/.test(apiSrc)) {
    fail('gallery api 必须打 /api/triad/gallery/media 与 /raw 两条路由')
  } else if (!/\/api\/chat-flow\/generated-images/.test(apiSrc)) {
    fail('generated 条目必须经既有 /api/chat-flow/generated-images 解析 spill（不重造第二条 spill 通道）')
  } else {
    pass('gallery api：404 人话化 + 路由前缀 + generated 二次解析在位')
  }
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${CLIENT}`)
// Explicit exit: stubbed modules may hold listeners/timers that keep node alive.
process.exit(process.exitCode ?? 0)

