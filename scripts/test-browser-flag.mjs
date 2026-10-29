/**
 * dsh-chat-plus — 浏览器操作标志（client 半身）行为测试。
 *
 * ## 为什么这些判据必须被断言
 *
 * 本模块的四类行为错了**都不会抛错**，只会静默地不对：
 *   1. 响应解析：字段名歪了 / 脏记录没筛掉 → 图标永远不出现，或常驻不灭；
 *   2. 是否显示：判据写成 active>=0 → 一屏会话全挂上图标；
 *   3. 行标记：属性名或选择器写歪 → 图标一个都不出现（React 不认识的属性，
 *      没有异常也没有日志）；
 *   4. 路由失败降级：失败时抛错会打断官方列表；不降级则会一直显示旧状态。
 *
 * ## 两种跑法
 *
 * 默认优先跑**构建产物** lib/client.js（与 smoke-client.mjs 同一套 vm + 桩化
 * DOM/React 方式）：那是用户真正加载的东西。若产物里还没有本模块（lib 尚未
 * 重建），退回用 esbuild 把源码临时打成一个内存 bundle 再跑同一批断言 —— 这样
 * 开发期不必等 Lead 构建也能验证，且不会在仓库里留下任何中间产物。
 *
 * Usage: node scripts/test-browser-flag.mjs
 *        node scripts/test-browser-flag.mjs --source   # 强制走源码 bundle
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CLIENT = resolve(ROOT, 'lib/client.js')
const SRC_DIR = resolve(ROOT, 'src/client/browser-flag')

const fail = (msg) => { console.error('FAIL  ' + msg); process.exitCode = 1 }
const pass = (msg) => console.log('ok    ' + msg)
const need = (cond, msg) => (cond ? pass(msg) : fail(msg))

// ── 桩：最小 DOM 节点（记录 id / 属性 / 子节点）───────────────────────────
function stubNode(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attrs: {},
    id: '',
    textContent: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild(child) { node.children.push(child); return child },
    insertBefore(child) { node.children.unshift(child); return child },
    removeChild(child) {
      const i = node.children.indexOf(child)
      if (i >= 0) node.children.splice(i, 1)
      return child
    },
    remove() {},
    setAttribute(k, v) { node.attrs[k] = String(v) },
    getAttribute(k) { return Object.hasOwn(node.attrs, k) ? node.attrs[k] : null },
    hasAttribute(k) { return Object.hasOwn(node.attrs, k) },
    removeAttribute(k) { delete node.attrs[k] },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    contains: () => false,
    getRootNode: () => sandbox.document,
    focus: () => {},
    click: () => {},
    ownerDocument: null,
  }
  return node
}

/** 假会话行：只实现 row-mark 用到的那几个方法。 */
function fakeRow(rowKey) {
  const attrs = { 'data-row-key': rowKey }
  return {
    attrs,
    setAttribute(k, v) { attrs[k] = String(v) },
    getAttribute(k) { return Object.hasOwn(attrs, k) ? attrs[k] : null },
    hasAttribute(k) { return Object.hasOwn(attrs, k) },
    removeAttribute(k) { delete attrs[k] },
  }
}

/**
 * 极简 React hooks 运行时。
 *
 * 为什么不能用「useState 返回初值、setState 空实现」那种一层桩：本组件的可见性
 * 完全由 **effect 里的 setState** 决定（首帧 pill 恒为 null）。一层桩下断言只会
 * 测到「桩什么都不做」，真实浏览器里组件却是好的 —— 假阴性比没测更糟。
 *
 * 所以这里实现一套能真正重放的 hooks：state/ref/effect 槽按调用顺序持久，
 * setState 触发一次重渲染（迭代而非递归，带环保护），effect 按 deps 比较决定
 * 是否重跑、重跑前先跑上次的 cleanup。
 */
const hookRuntime = {
  states: [],
  refs: [],
  effects: [],
  cursor: 0,
  collecting: [],
  pending: false,
  render(props) {
    this.pending = true
    let result = null
    let guard = 0
    while (this.pending) {
      if (++guard > 50) throw new Error('render loop (state 未收敛)')
      this.pending = false
      this.cursor = 0
      this.collecting = []
      result = currentComponent(props)
      this.commit()
    }
    return result
  },
  commit() {
    const collected = this.collecting
    const seen = new Set()
    for (const item of collected) {
      seen.add(item.index)
      const prev = this.effects[item.index]
      const same = prev !== undefined && item.deps !== undefined && prev.deps !== undefined
        && prev.deps.length === item.deps.length
        && prev.deps.every((dep, i) => Object.is(dep, item.deps[i]))
      if (same) continue
      if (prev?.cleanup !== undefined) prev.cleanup()
      const cleanup = item.fn()
      this.effects[item.index] = { deps: item.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    }
    // 本次渲染里消失的 effect 槽（组件卸载或 effect 数量变少）跑 cleanup。
    for (let i = 0; i < this.effects.length; i++) {
      if (seen.has(i) || this.effects[i] === undefined) continue
      this.effects[i]?.cleanup?.()
      this.effects[i] = undefined
    }
  },
  unmount() {
    for (const slot of this.effects) slot?.cleanup?.()
    this.effects = []
    this.states = []
    this.refs = []
  },
  useState(init) {
    const index = this.cursor++
    if (!(index in this.states)) this.states[index] = typeof init === 'function' ? init() : init
    const setState = (next) => {
      const value = typeof next === 'function' ? next(this.states[index]) : next
      if (Object.is(value, this.states[index])) return
      this.states[index] = value
      this.pending = true
    }
    return [this.states[index], setState]
  },
}

/** 当前正在渲染的组件（hookRuntime.render 期间被调用）。 */
let currentComponent = () => null

/** 最近一次 renderWithHooks 渲染的组件（rerenderWithHooks 复用同一份 hooks 槽）。 */
let lastRenderedComponent = () => null

/** 用 hooks 运行时渲染一次组件（含 effect 引发的重渲染直到收敛）。 */
function renderWithHooks(Component, props) {
  hookRuntime.unmount()
  lastRenderedComponent = Component
  currentComponent = Component
  try {
    return hookRuntime.render(props)
  } finally {
    currentComponent = () => null
  }
}

/**
 * 在**同一个** hooks 运行时上再渲染一帧（保留 state/ref/effect 槽）。
 *
 * 退场态必须这样测：组件挂载后活动才结束，才是真实时序。重新挂载会从
 * pill=null 起步、什么都不渲染 —— 那是「组件刚挂上就没有活动」的正确行为，
 * 拿它断言退场会得到假阴性。
 */
function rerenderWithHooks(props) {
  // 上一帧结束后 currentComponent 已被复位成空渲染器：这里必须显式换回来，
  // 否则「重渲染」实际渲染的是空组件，退场态永远测不到。
  currentComponent = lastRenderedComponent
  try {
    return hookRuntime.render(props)
  } finally {
    currentComponent = () => null
  }
}

/** 把 jsx 结果摊平成元素列表（含深层 children），断言类名与文案用。 */
function flattenElements(element, out = []) {
  if (element === null || element === undefined || typeof element !== 'object') return out
  if (Array.isArray(element)) {
    for (const item of element) flattenElements(item, out)
    return out
  }
  out.push(element)
  // jsx-runtime 把 children 放在 props.children 里（createElement 桩也是同一处），
  // 两个来源都摊一遍：断言类名与文案时不关心是哪种写法产出的。
  flattenElements(element.children, out)
  flattenElements(element.props?.children, out)
  return out
}

const REACT_OVERRIDES = {
  createElement: (type, props, ...children) => ({ type, props }),
  cloneElement: (el) => el,
  isValidElement: () => false,
  Children: { map: () => [], forEach: () => {}, count: () => 0, toArray: () => [] },
  Fragment: Symbol('Fragment'),
  // 产物里别的模块会 class X extends Component：必须是真类，桩函数会抛
  // 「not a constructor」。其余官方组件在桩表里不需要实例化，给函数就够。
  Component: class Component {
    constructor(props) { this.props = props; this.state = null }
    setState() {}
    forceUpdate() {}
    render() { return null }
  },
  StrictMode: stubComponent('StrictMode'),
  Suspense: stubComponent('Suspense'),
  forwardRef: (render) => render,
  lazy: () => stubComponent('Lazy'),
  startTransition: (fn) => fn?.(),
  createRef: () => ({ current: null }),
  createContext: () => ({ Provider: stubComponent('Provider'), Consumer: stubComponent('Consumer') }),
  useReducer: (reducer, init) => [init, () => {}],
  useLayoutEffect: () => {},
  useInsertionEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useImperativeHandle: () => {},
  useContext: () => ({}),
  useId: () => 'stub-id',
  useDebugValue: () => {},
  useTransition: () => [false, (fn) => fn?.()],
  useDeferredValue: (v) => v,
  useState: (init) => hookRuntime.useState(init),
  useEffect: (fn, deps) => { hookRuntime.collecting.push({ index: hookRuntime.cursor++, fn, deps }) },
  useRef: (init) => {
    const index = hookRuntime.cursor++
    if (!(index in hookRuntime.refs)) hookRuntime.refs[index] = { current: init }
    return hookRuntime.refs[index]
  },
  useSyncExternalStore: (_sub, get) => get(),
  memo: (comp) => comp,
}

/** 任意命名的桩组件（官方图标/组件在冒烟里只当不透明值）。 */
function stubComponent(name) {
  const Comp = () => ({ __stub: name })
  Object.defineProperty(Comp, 'name', { value: name })
  return Comp
}

const MODULES = {
  'react': new Proxy(REACT_OVERRIDES, {
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
  // 产物是整个插件的 client bundle（不是只有本模块）：其它模块 require 的
  // 官方包必须在桩表里，否则 factory 一行都跑不完 —— 与 smoke-client.mjs 同一份
  // 思路，用 Proxy 兜住任意图标名（离线桩里不可能枚举全）。
  '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined
      return target[prop] ?? stubComponent(prop)
    },
    has: () => true,
  }),
}

// ── 桩：sandbox（document / 计时器 / fetch / visibility）─────────────────
const headItems = []
const docListeners = new Map()
const timers = new Map()
let timerSeq = 0

const documentStub = {
  visibilityState: 'visible',
  hidden: false,
  head: stubNode('head'),
  body: stubNode('body'),
  documentElement: stubNode('html'),
  createElement: (tag) => stubNode(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: (id) => headItems.find((node) => node.id === id) ?? null,
  getElementsByTagName: () => [],
  addEventListener: (type, handler) => {
    const list = docListeners.get(type) ?? []
    list.push(handler)
    docListeners.set(type, list)
  },
  removeEventListener: (type, handler) => {
    const list = docListeners.get(type) ?? []
    docListeners.set(type, list.filter((h) => h !== handler))
  },
}
documentStub.head.appendChild = (child) => { headItems.push(child); return child }
documentStub.body.appendChild = (child) => { return child }

const sandbox = {
  document: documentStub,
  console,
  // 可控计时器：轮询节奏必须能被「手动推进」验证，否则只能靠真等 5 秒。
  setTimeout: (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, delay: ms ?? 0 }); return id },
  clearTimeout: (id) => { timers.delete(id) },
  setInterval: () => 0,
  clearInterval: () => {},
  queueMicrotask: (fn) => fn(),
  fetch: async () => ({ ok: false, status: 599, json: async () => ({}) }),
  AbortController,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  URL,
  URLSearchParams,
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  requestAnimationFrame: (fn) => { const id = ++timerSeq; timers.set(id, { fn: () => fn(Date.now()), delay: 0 }); return id },
  cancelAnimationFrame: (id) => { timers.delete(id) },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  CSS: { supports: () => () => '' },
  Element: class {},
  HTMLElement: class {},
  Node: class {},
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.top = sandbox
sandbox.parent = sandbox
sandbox.navigator = { userAgent: 'dsh-browser-flag-test', language: 'zh-CN' }
sandbox.location = { href: 'http://127.0.0.1:0/', origin: 'http://127.0.0.1:0' }
sandbox.addEventListener = () => {}
sandbox.removeEventListener = () => {}

const context = vm.createContext(sandbox)

/** 在 sandbox 里执行一段 CJS，返回其导出。 */
function runCjs(code, filename) {
  const wrapper = '__dsh_flag_module__ = (function(require, module, exports){' + code + '\nreturn module.exports;})'
  const factory = new vm.Script(wrapper, { filename }).runInContext(context)
  const module = { exports: {} }
  const requireStub = (id) => {
    if (id in MODULES) return MODULES[id]
    throw new Error('[test] unexpected require(' + id + ') — add it to the stub table')
  }
  sandbox.__dsh_flag_module__ = null
  const exported = factory(requireStub, module, module.exports)
  return exported ?? module.exports
}

// ── 载入被测模块：产物优先，源码兜底 ─────────────────────────────────────
const forceSource = process.argv.includes('--source')
let mod = null
let source = ''

if (!forceSource && existsSync(CLIENT) && readFileSync(CLIENT, 'utf8').includes('dsh-browser-flag-style')) {
  source = 'lib/client.js（构建产物）'
  const registrations = []
  sandbox.__ModuleLoader__ = { load: (entry) => { registrations.push(entry) } }
  runCjs(readFileSync(CLIENT, 'utf8'), CLIENT)
  if (registrations.length !== 1) {
    fail('expected 1 loader registration, got ' + registrations.length)
    process.exit(1)
  }
  const factory = registrations[0].factory
  const requireStub = (id) => {
    if (id in MODULES) return MODULES[id]
    throw new Error('[test] unexpected require(' + id + ')')
  }
  mod = factory(requireStub)
} else {
  source = 'src/client/browser-flag（esbuild 临时内存 bundle）'
  const { build } = await import('esbuild')
  const result = await build({
    stdin: {
      contents: [
        "export * from './store.ts'",
        "export * from './row-mark.ts'",
        "export * from './styles.ts'",
        "export * from './index.ts'",
      ].join('\n'),
      resolveDir: SRC_DIR,
      sourcefile: 'browser-flag-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react/jsx-runtime'],
  })
  mod = runCjs(result.outputFiles[0].text, 'browser-flag-source-bundle.cjs')
  if (!forceSource) {
    console.log('note  构建产物里还没有浏览器标志模块（lib 未重建），本次改用源码 bundle 验证\n')
  }
}
console.log('using ' + source + '\n')

// ── 0. 导出的契约名字（少一个就是接线断了）──────────────────────────────
const EXPECTED_EXPORTS = [
  'BROWSER_ACTIVITY_ROUTE', 'BROWSER_FLAG_PREVIEW_KEY', 'FAST_POLL_MS', 'SLOW_POLL_MS',
  'IDLE_ROUNDS_BEFORE_SLOW', 'isBrowserToolName', 'parseBrowserActivity', 'sessionFlagVisible',
  'browserFlagToolLabel', 'browserFlagTitle', 'fetchBrowserActivity', 'getBrowserFlagSnapshot',
  'subscribeBrowserFlag', 'ingestPreviewSessions', 'mountBrowserFlagPreview',
  'startBrowserActivityPolling', 'stopBrowserActivityPolling', 'BROWSER_FLAG_ROW_ATTR',
  'flagAttrValue', 'sessionIdOfRowKey', 'syncBrowserFlagRows', 'BROWSER_FLAG_STYLES',
  'BROWSER_FLAG_STYLE_ID', 'injectBrowserFlagStyles', 'applyBrowserFlagClient',
]
const missing = EXPECTED_EXPORTS.filter((name) => mod[name] === undefined)
need(missing.length === 0, '契约导出齐全' + (missing.length === 0 ? '' : '：缺 ' + missing.join(', ')))

need(mod.BROWSER_ACTIVITY_ROUTE === '/api/chat-flow/browser-activity',
  'BROWSER_ACTIVITY_ROUTE = /api/chat-flow/browser-activity（与 host 半身逐字一致）')
need(mod.FAST_POLL_MS === 1000 && mod.SLOW_POLL_MS === 1500 && mod.IDLE_ROUNDS_BEFORE_SLOW === 3,
  '轮询节奏 1000ms / 1500ms / 连续 3 次无活动降速')

// ── 1. 纯函数：响应解析 ──────────────────────────────────────────────────
{
  const ok = mod.parseBrowserActivity({
    ok: true,
    now: 1000,
    sessions: [{
      sessionId: 's1', active: 2, service: 'playwright-mcp', tool: 'browser_click',
      since: 100, lastAt: 900, lingering: false,
    }],
  })
  need(Array.isArray(ok) && ok.length === 1 && ok[0].sessionId === 's1',
    '解析：正常回包 → 一条会话')
  need(ok[0].active === 2 && ok[0].service === 'playwright-mcp' && ok[0].tool === 'browser_click',
    '解析：active / service / tool 逐字段保真')
  need(ok[0].since === 100 && ok[0].lastAt === 900 && ok[0].lingering === false,
    '解析：since / lastAt / lingering 保真')

  need(mod.parseBrowserActivity({ ok: false, sessions: [] }) === null,
    '解析：ok=false → null（客户端据此静默降级）')
  need(mod.parseBrowserActivity({ ok: true, sessions: 'nope' }) === null,
    '解析：sessions 不是数组 → null')
  need(mod.parseBrowserActivity(null) === null && mod.parseBrowserActivity('x') === null,
    '解析：非对象回包 → null')

  const empty = mod.parseBrowserActivity({ ok: true, now: 1, sessions: [] })
  need(Array.isArray(empty) && empty.length === 0, '解析：无活动 → 空数组（不是 null）')

  const dirty = mod.parseBrowserActivity({
    ok: true,
    sessions: [
      { sessionId: 'keep', active: 1, service: 'chrome', tool: 'x', since: 1, lastAt: 2, lingering: false },
      // 缺 sessionId：丢弃（否则会往一张没有键的表里塞数据）
      { active: 1, service: 'chrome', tool: 'x' },
      // active=0 且 lingering=false：服务端不该输出，脏数据也不该让图标常驻
      { sessionId: 'dead', active: 0, service: 'chrome', tool: 'x', lingering: false },
      // lingering=true 且 active=0：尾迹期，必须保留（避免连续调用之间闪）
      { sessionId: 'tail', active: 0, service: 'chrome', tool: 'x', lingering: true },
      // 字段类型脏：active 负数归零、时间非数字归零
      { sessionId: 'coerce', active: -3, service: 5, tool: null, since: 'no', lastAt: NaN, lingering: true },
      null,
    ],
  })
  need(dirty.length === 3 && dirty.map(e => e.sessionId).join(',') === 'keep,tail,coerce',
    '解析：脏数据筛除（缺 id / 无活动无尾迹 / null 三条被丢）')
  const coerced = dirty.find(e => e.sessionId === 'coerce')
  need(coerced.active === 0 && coerced.since === 0 && coerced.lastAt === 0 && coerced.service === '' && coerced.tool === '',
    '解析：字段类型容错（负数归零 / 非字符串归空）')
}

// ── 2. 纯函数：是否显示 + 文案 ───────────────────────────────────────────
{
  const live = { sessionId: 'a', active: 1, service: 'playwright-mcp', tool: 'browser_click', since: 1, lastAt: 2, lingering: false }
  const tail = { sessionId: 'b', active: 0, service: 'chrome', tool: 'navigate', since: 1, lastAt: 2, lingering: true }
  const idle = { sessionId: 'c', active: 0, service: 'chrome', tool: 'navigate', since: 1, lastAt: 2, lingering: false }

  need(mod.sessionFlagVisible(live) === true, '显示判据：active>0 → 显示')
  need(mod.sessionFlagVisible(tail) === true, '显示判据：lingering=true（尾迹）→ 显示')
  need(mod.sessionFlagVisible(idle) === false, '显示判据：既无活动又无尾迹 → 不显示')
  need(mod.sessionFlagVisible(null) === false && mod.sessionFlagVisible(undefined) === false,
    '显示判据：空值 → 不显示')

  need(mod.browserFlagToolLabel(live) === 'browser_click', '文案：工具名取 tool 段')
  need(mod.browserFlagToolLabel({ ...live, tool: '', service: 'chrome' }) === 'chrome',
    '文案：tool 缺失时退到 service')
  need(mod.browserFlagToolLabel({ ...live, tool: '', service: '' }) === '',
    '文案：两段都空 → 空串（悬浮说明不留悬空分隔符）')
  need(mod.browserFlagToolLabel(null) === '', '文案：null → 空串')

  need(mod.browserFlagTitle(live) === '浏览器操作中 · browser_click', '文案：标题 = 浏览器操作中 · 工具名')
  need(mod.browserFlagTitle({ ...live, tool: '', service: '' }) === '浏览器操作中',
    '文案：没有工具名时退化为纯「浏览器操作中」（不留悬空分隔符）')
}

// ── 3. 纯函数：浏览器工具判据（与 host 同口径）───────────────────────────
{
  // 对拍基准：下面这张表是 host 半身 src/browser-activity/tools.ts 的
  // isBrowserToolName 跑出来的真实结果（不是手写的期望）。两边判据一旦分叉，
  // 症状是「预览亮、真实数据不亮」或反之 —— 只能靠对拍发现。
  const HOST_RESULTS = [
    ['mcp__playwright-mcp__browser_click', true],
    ['mcp__chrome-devtools__navigate', true],
    ['mcp__foo__cdp_session', true],
    ['mcp__foo__openBrowserTab', true],
    ['pwsh', false],
    ['mcp__foo__bar', false],
    ['mcp__x__list_categories', false],
    ['mcp__playwright-mcp__anything', true],
    ['mcp__ego__do', true],
    ['mcp__stagehand__act', true],
    ['mcp__puppeteer__click', true],
    ['mcp__selenium__x', true],
    ['', false],
    ['mcp__', false],
    ['mcp__a__', false],
    ['notmcp__x__y', false],
    ['mcp__playwright-mcp-extension__click', true],
    ['mcp__browser__x', true],
    ['mcp__CDP__x', true],
    // 复合词前缀匹配（阈值 6）：BrowserOS / Browserbase 的真实 server 名。
    ['mcp__browseros_neo__navigate', true],
    ['mcp__browseros_neo__snapshot', true],
    ['mcp__browserbase__open', true],
    // 反向：短词（ego/cdp）不做前缀匹配，否则 egosystem / cdpdriver 会误判。
    ['mcp__foo__egosystem', false],
    ['mcp__foo__cdpdriver', false],
  ]
  const drift = HOST_RESULTS.filter(([name, expected]) => mod.isBrowserToolName(name) !== expected)
  need(drift.length === 0,
    '判据：与 host 半身对拍一致（' + HOST_RESULTS.length + ' 个样本'
    + (drift.length === 0 ? '' : '，分叉：' + drift.map(([n, e]) => JSON.stringify(n) + ' 期望' + e).join(', ')) + '）')

  need(mod.isBrowserToolName('mcp__playwright-mcp__browser_click') === true,
    '判据：mcp__<service>__<tool> 形式命中')
  need(mod.isBrowserToolName('mcp__chrome-devtools__navigate') === true, '判据：service 命中 chrome/devtools')
  need(mod.isBrowserToolName('mcp__playwright-mcp__anything') === true, '判据：前缀 mcp__playwright-mcp__ 命中')
  need(mod.isBrowserToolName('mcp__foo__cdp_session') === true, '判据：tool 段命中提示词')
  need(mod.isBrowserToolName('mcp__foo__openBrowserTab') === true, '判据：camelCase 工具名也能切出词元')
  need(mod.isBrowserToolName('pwsh') === false, '判据：普通工具不误伤')
  need(mod.isBrowserToolName('mcp__foo__bar') === false, '判据：无关 mcp 工具不误伤')
  // 与 host 半身 tools.ts 同一个坑：裸 includes 会把 categories 里的 ego 当命中。
  need(mod.isBrowserToolName('mcp__x__list_categories') === false,
    '判据：短词按词元匹配，不命中更长单词内部（categories 里藏着 ego）')
  need(mod.isBrowserToolName('') === false && mod.isBrowserToolName(null) === false
    && mod.isBrowserToolName(undefined) === false, '判据：空值 → false')
}

// ── 4. 行标记：对假 DOM 节点打属性 ──────────────────────────────────────
{
  need(mod.BROWSER_FLAG_ROW_ATTR === 'data-dsh-browser-flag',
    '行标记属性名 = data-dsh-browser-flag（styles.ts 按它选 ::before）')
  need(mod.sessionIdOfRowKey('session:abc') === 'abc', '行键解析：session:abc → abc')
  need(mod.sessionIdOfRowKey('project:p1') === null, '行键解析：项目行不参与')
  need(mod.sessionIdOfRowKey(null) === null && mod.sessionIdOfRowKey('session:') === null,
    '行键解析：空键 / 空 id → null')

  const entry = { sessionId: 'abc', active: 1, service: 'playwright-mcp', tool: 'browser_click', since: 1, lastAt: 2, lingering: false }
  need(mod.flagAttrValue(entry) === 'browser_click', '属性值：用工具名（CDP 可直接断言是哪一行什么工具）')
  need(mod.flagAttrValue({ ...entry, tool: '', service: '' }) === '1',
    '属性值：没有工具名时用占位 1（CSS 只关心属性在不在）')
  need(/^[\w.@/:+-]+$/.test(mod.flagAttrValue({ ...entry, tool: 'a b"c\nd' })),
    '属性值：危险字符被收敛（工具名可能带引号/空白/换行）')
  need(mod.flagAttrValue({ ...entry, tool: 'x'.repeat(200) }).length <= 64,
    '属性值：超长截断到 64 字符')

  const rows = [
    fakeRow('session:abc'),      // 有活动 → 打属性
    fakeRow('session:quiet'),    // 无活动 → 不该有属性
    fakeRow('project:p1'),       // 项目行 → 跳过
  ]
  const fakeRoot = { querySelectorAll: (selector) => (selector.startsWith('[data-row-key^="session:"]') ? rows : []) }
  const sessions = new Map([['abc', entry]])

  const changed = mod.syncBrowserFlagRows(fakeRoot, sessions)
  need(changed === 1 && rows[0].attrs['data-dsh-browser-flag'] === 'browser_click',
    '行标记：活动会话行被打上属性（值 = 工具名）')
  need(!('data-dsh-browser-flag' in rows[1].attrs), '行标记：无活动的会话行不被打属性')
  need(!('data-dsh-browser-flag' in rows[2].attrs), '行标记：项目行不被打属性')
  need(mod.syncBrowserFlagRows(fakeRoot, sessions) === 0, '行标记：幂等（值没变时不碰 DOM）')

  // 活动结束：属性必须被清掉，否则图标常驻不灭。
  const cleared = mod.syncBrowserFlagRows(fakeRoot, new Map())
  need(cleared === 1 && !('data-dsh-browser-flag' in rows[0].attrs),
    '行标记：活动结束 → 属性被清掉（图标跟着消失）')

  // 残留清理：切会话 / 尾迹到期后同样要清。
  mod.syncBrowserFlagRows(fakeRoot, new Map([['abc', entry]]))
  need(mod.syncBrowserFlagRows(fakeRoot, new Map([['abc', { ...entry, active: 0, lingering: false }]])) === 1
    && !('data-dsh-browser-flag' in rows[0].attrs),
    '行标记：尾迹也过期（active=0 且 lingering=false）→ 清掉属性')

  // 容错：没有 querySelectorAll 的根 / 抛错的根都不该炸。
  need(mod.syncBrowserFlagRows(null, sessions) === 0 && mod.syncBrowserFlagRows({}, sessions) === 0,
    '行标记：根不可用 → 返回 0 且不抛')
  need(mod.syncBrowserFlagRows({ querySelectorAll: () => { throw new Error('boom') } }, sessions) === 0,
    '行标记：查询抛错 → 吞掉并返回 0')
  const brokenRows = [{ getAttribute: () => { throw new Error('broken row') } }]
  let threw = false
  try {
    mod.syncBrowserFlagRows({ querySelectorAll: () => brokenRows }, sessions)
  } catch { threw = true }
  need(threw === false, '行标记：单行结构异常 → 不抛')
}

// ── 5. 路由失败一律降级（返回 null / 空，不抛不重试）────────────────────
{
  const cases = [
    ['非 ok 回包（404 等）', async () => ({ ok: false, status: 404, json: async () => ({}) })],
    ['网络抛错', async () => { throw new Error('ECONNREFUSED') }],
    ['json 解析抛错', async () => ({ ok: true, json: async () => { throw new Error('bad json') } })],
    ['回包 ok=false', async () => ({ ok: true, json: async () => ({ ok: false, sessions: [] }) })],
    ['回包形状坏', async () => ({ ok: true, json: async () => ({ sessions: 42 }) })],
    ['undefined 回包', async () => undefined],
  ]
  for (const [label, impl] of cases) {
    let out
    let threw = false
    try {
      out = await mod.fetchBrowserActivity(impl)
    } catch { threw = true }
    need(threw === false && out === null, '路由降级：' + label + ' → null 且不抛')
  }

  const good = await mod.fetchBrowserActivity(async () => ({
    ok: true,
    json: async () => ({ ok: true, now: 1, sessions: [{ sessionId: 's', active: 1, service: 'c', tool: 't', since: 1, lastAt: 1, lingering: false }] }),
  }))
  need(Array.isArray(good) && good.length === 1 && good[0].sessionId === 's', '路由：正常回包 → 解析后的会话数组')

  // 没有 fetch 的环境（老浏览器 / 非浏览器沙箱）：同样静默返回 null。
  const savedFetch = sandbox.fetch
  delete sandbox.fetch
  need(await mod.fetchBrowserActivity() === null, '路由降级：环境没有 fetch → null 且不抛')
  sandbox.fetch = savedFetch
}

// ── 6. 预览入口（window.__dshBrowserFlagPreview）─────────────────────────
{
  need(mod.BROWSER_FLAG_PREVIEW_KEY === '__dshBrowserFlagPreview', '预览入口名 = __dshBrowserFlagPreview')
  mod.mountBrowserFlagPreview()
  need(typeof sandbox.__dshBrowserFlagPreview === 'function', '预览入口已挂到 window')
  need(typeof sandbox.__dshBrowserFlagPreview === 'function'
    && mod.BROWSER_FLAG_PREVIEW_KEY in sandbox, '预览入口挂在 BROWSER_FLAG_PREVIEW_KEY 这个键上')

  const count = mod.ingestPreviewSessions([{ sessionId: 'demo', active: 1, service: 'playwright-mcp', tool: 'browser_snapshot', since: 1, lastAt: 2, lingering: false }])
  const snap = mod.getBrowserFlagSnapshot()
  need(count === 1 && snap.bySession.get('demo')?.tool === 'browser_snapshot',
    '预览：灌入一条 → 快照里能读到（不发起真实浏览器调用也能验证）')

  // 脏输入不抛、不破坏已有快照。
  let previewThrew = false
  try {
    sandbox.__dshBrowserFlagPreview({ nope: true })
    sandbox.__dshBrowserFlagPreview(42)
  } catch { previewThrew = true }
  need(previewThrew === false && mod.getBrowserFlagSnapshot().bySession.size === 1,
    '预览：脏输入不抛且不清空已有数据')

  const shell = sandbox.__dshBrowserFlagPreview(null)
  need(shell === 0 && mod.getBrowserFlagSnapshot().bySession.size === 0, '预览：传 null → 清空')

  // 订阅：数据变化必须通知（组件靠它重渲染）。
  let notified = 0
  const off = mod.subscribeBrowserFlag(() => { notified += 1 })
  sandbox.__dshBrowserFlagPreview([{ sessionId: 'demo', active: 1, service: 'c', tool: 't', since: 1, lastAt: 1, lingering: false }])
  const afterFirst = notified
  sandbox.__dshBrowserFlagPreview([{ sessionId: 'demo', active: 1, service: 'c', tool: 't', since: 1, lastAt: 1, lingering: false }])
  need(afterFirst === 1 && notified === 1, '订阅：内容真变化才通知（同样数据不重复通知，避免每秒重渲染）')
  off()
  sandbox.__dshBrowserFlagPreview(null)
  need(notified === 1, '订阅：退订后不再收到通知')
}

// ── 7. 轮询：节奏 / 隐藏暂停 / 恢复立刻拉 ───────────────────────────────
{
  mod.stopBrowserActivityPolling()
  timers.clear()
  mod.ingestPreviewSessions(null)

  const requests = []
  let payload = { ok: true, now: 1, sessions: [] }
  sandbox.fetch = async (url) => {
    requests.push(url)
    return { ok: true, json: async () => payload }
  }

  /** 排出当前最早的计时器并跑它（模拟时间前进一格）。 */
  const step = async () => {
    const first = [...timers.entries()][0]
    if (first === undefined) return null
    const [id, timer] = first
    timers.delete(id)
    timer.fn()
    // tick 是 async：让它的 await 链跑完（微任务 + 一次宏任务边界）。
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setImmediate(r))
    return timer.delay
  }

  mod.startBrowserActivityPolling()
  const firstDelay = [...timers.values()][0]?.delay
  need(firstDelay === 0, '轮询：起步立刻拉一次（delay 0，不等 1 秒）')

  await step()
  need(requests.length === 1 && requests[0] === '/api/chat-flow/browser-activity',
    '轮询：只打一条全局请求（不是每行一次）')
  const d1 = [...timers.values()][0]?.delay
  need(d1 === 1000, '轮询：空回包第 1 次 → 仍是 1000ms')

  await step()
  const d2 = [...timers.values()][0]?.delay
  await step()
  const d3 = [...timers.values()][0]?.delay
  need(d2 === 1000 && d3 === 1500, '轮询：连续 3 次无活动 → 降速到 1500ms 保活')

  // 有活动 → 立刻回到快速档，且快照里有数据。
  payload = { ok: true, now: 2, sessions: [{ sessionId: 'live', active: 1, service: 'playwright-mcp', tool: 'browser_click', since: 1, lastAt: 2, lingering: false }] }
  await step()
  need([...timers.values()][0]?.delay === 1000, '轮询：一旦有活动 → 回到 1000ms')
  need(mod.getBrowserFlagSnapshot().bySession.get('live')?.active === 1, '轮询：活动数据进了快照（行标记读它）')

  // 真实活动出现后，预览态让位（以路由数据为准）。
  sandbox.__dshBrowserFlagPreview([{ sessionId: 'demo-only', active: 1, service: 'c', tool: 't', since: 1, lastAt: 1, lingering: false }])
  need(mod.getBrowserFlagSnapshot().bySession.has('demo-only'), '预览：可临时覆盖快照（演示入口）')
  await step()
  const afterLive = mod.getBrowserFlagSnapshot()
  need(afterLive.bySession.has('live') && !afterLive.bySession.has('demo-only'),
    '轮询：真实活动优先，覆盖预览数据')

  // 页面不可见：不请求、不排期。
  const beforeHidden = requests.length
  documentStub.visibilityState = 'hidden'
  documentStub.hidden = true
  timers.clear()
  mod.startBrowserActivityPolling() // 幂等；running 已是 true
  const hiddenCallbacks = docListeners.get('visibilitychange') ?? []
  for (const cb of hiddenCallbacks) cb()
  await new Promise((r) => setImmediate(r))
  need(requests.length === beforeHidden && timers.size === 0,
    '轮询：document.hidden 时不请求也不排期（省掉后台空转）')

  // 恢复可见：立刻拉一次，不等保活计时器。
  documentStub.visibilityState = 'visible'
  documentStub.hidden = false
  for (const cb of hiddenCallbacks) cb()
  await new Promise((r) => setImmediate(r))
  need(requests.length === beforeHidden + 1, '轮询：恢复可见立刻拉一次')

  mod.stopBrowserActivityPolling()
  timers.clear()
  need(timers.size === 0, '轮询：stop 后不再排期')
}

// ── 8. 装配：样式 + 轮询 + 预览入口（不再有胶囊与座位）─────────────────
{
  headItems.length = 0
  // slots 桩：本模块已经**不占任何座位**（胶囊整块删除），万一有人加回来，
  // 这里会立刻抛错 —— 这是刻意的守卫，不是缺省值。
  const slotsStub = {
    inject: (slot) => { throw new Error('不该注册座位：' + String(slot)) },
    register: (spec) => { throw new Error('不该注册座位：' + String(spec?.name)) },
    entries: () => [],
  }
  const ctx = { slots: slotsStub, effect: (fn) => { const stop = fn(); return stop ?? (() => {}) } }

  let applyThrew = false
  try {
    mod.applyBrowserFlagClient(ctx)
  } catch (error) {
    applyThrew = true
    fail('applyBrowserFlagClient 抛错：' + (error?.stack ?? error))
  }
  need(applyThrew === false, '装配：applyBrowserFlagClient 不抛（且不占任何座位）')

  /*
   * ── 装配：**不再注入样式、不再挂行标记**（2026-10-25 搬迁）────────────────
   *
   * 那枚图标从「左侧会话列表行右端」搬到了**操作面板卡头、Seeker 文字右侧**。
   * 于是本模块只剩数据面（轮询 + 快照 + 预览入口），视觉归 kr-chat/styles.ts 的
   * .kr-plain-head__browser。
   *
   * 旧断言（绝对定位 / 行让位 padding / 让位宽度 / 行让位动效 / 样式注入幂等）
   * 全部随那套 DOM 注入一起作废 —— 它们验的是"往官方行上打属性"那套实现，
   * 而那套已经不挂了。留着只会让「已经搬走」变成永远红的断言。
   *
   * 现在要钉的是**反向**的两件事：
   *   ① 装配不再注入样式（否则白挂一张用不到的表）；
   *   ② 装配不再往会话行上打属性（否则会继续改官方列表的 DOM）。
   */
  need(headItems.every((node) => node.id !== 'dsh-browser-flag-style'),
    '装配：不再注入 dsh-browser-flag-style（视觉已搬到操作面板卡头）')
  need(mod.BROWSER_FLAG_STYLE_ID === 'dsh-browser-flag-style',
    '样式常量仍在（styles.ts 保留，只是不再挂载）')
  const rowsTouched = [...sandbox.document.querySelectorAll('[data-row-key^="session:"]')]
    .some((row) => row.hasAttribute('data-dsh-browser-flag'))
  need(!rowsTouched, '装配：不再往官方会话行上打属性（列表 DOM 零改动）')

  // 幂等：再装配一次不该多出任何 <style>。
  mod.applyBrowserFlagClient(ctx)
  need(headItems.filter((node) => node.id === 'dsh-browser-flag-style').length === 0,
    '装配：重复装配也不注入样式（幂等且彻底不挂）')
  mod.stopBrowserActivityPolling()
  timers.clear()
}

// ── 9. 预览入口（window 上的灌数据通道）─────────────────────────────────
{
  headItems.length = 0
  const ctx = { slots: { inject: () => {}, register: () => () => {}, entries: () => [] }, effect: (fn) => { const s = fn(); return s ?? (() => {}) } }
  mod.applyBrowserFlagClient(ctx)
  need(typeof sandbox.window.__dshBrowserFlagPreview === 'function',
    '预览入口：window.__dshBrowserFlagPreview 是函数（不发起真实调用也能验收）')
  const count = sandbox.window.__dshBrowserFlagPreview([
    { sessionId: 'demo', active: 1, service: 'playwright-mcp', tool: 'browser_click', since: 1, lastAt: 2, lingering: false },
  ])
  need(count === 1, '预览入口：灌一条返回 1（条数回执）')
  need(mod.getBrowserFlagSnapshot().bySession.get('demo')?.tool === 'browser_click',
    '预览入口：数据进了快照（行标记读它）')
  const cleared = sandbox.window.__dshBrowserFlagPreview(null)
  need(cleared === 0 && mod.getBrowserFlagSnapshot().bySession.size === 0, '预览入口：传 null 清空')
  mod.stopBrowserActivityPolling()
  timers.clear()
}

console.log('\n' + (process.exitCode ? 'TEST FAILED' : 'TEST PASSED') + ' — browser flag client half (' + source + ')')
process.exit(process.exitCode ?? 0)
