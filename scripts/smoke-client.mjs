/**
 * dsh-chat-plus — browser half smoke test.
 *
 * Executes `lib/client.js` under a stubbed DSH client environment and asserts:
 *   1. registers exactly one `__ModuleLoader__` entry with id "dsh-chat-plus"
 *   2. the factory exports `apply` (function) and `inject` (array = ['slots'])
 *   3. `apply(ctx)` mounts the shared activity drawer (body 级宿主) + 注入七枚
 *      <style>（dsh-chat-flow-styles / dsh-tool-summary-styles /
 *      dsh-chat-flow-shot-styles / dsh-modal-animation-styles /
 *      dsh-chat-flow-proto-styles / dsh-chat-flow-diagram-styles /
 *      dsh-chat-flow-download-styles）
 *   4. `apply(ctx)` registers the two active chat-node seats + actions + toolview:
 *        conversation.chat.node / turn-process     priority -100
 *        conversation.chat.node / assistant-step   priority -100
 *        conversation.chat.assistant-actions / chat-flow-screenshot  order 5
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

/** Minimal DOM node (records id / children / styles for later assertions). */
function stubNode(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    attrs: {},
    id: '',
    textContent: '',
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
    hasAttribute(k) { return k in node.attrs },
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
    ownerDocument: null,
  }
  return node
}

/** Explicit React overrides. */
const REACT_OVERRIDES = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  cloneElement: (el) => el,
  isValidElement: () => false,
  Children: { map: () => [], forEach: () => {}, count: () => 0, toArray: () => [] },
  Fragment: Symbol('Fragment'),
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
  '@deepseek-ai/dsh-client-ui-primitives': {
    IconThinkOutline14: stubComponent('IconThinkOutline14'),
    IconApiOutline14: stubComponent('IconApiOutline14'),
    IconBrowseOutline16: stubComponent('IconBrowseOutline16'),
    IconChevronDownOutline14: stubComponent('IconChevronDownOutline14'),
    IconChevronRightOutline14: stubComponent('IconChevronRightOutline14'),
    IconDownloadOutline16: stubComponent('IconDownloadOutline16'),
    IconEditOutline16: stubComponent('IconEditOutline16'),
    IconSearchOutline16: stubComponent('IconSearchOutline16'),
    IconSkillOutline16: stubComponent('IconSkillOutline16'),
    IconSparkle16: stubComponent('IconSparkle16'),
    DiffBlock: stubComponent('DiffBlock'),
    JsonBlock: stubComponent('JsonBlock'),
    JsonTree: stubComponent('JsonTree'),
    MarkdownText: stubComponent('MarkdownText'),
    ReadBlock: stubComponent('ReadBlock'),
    SearchBlock: stubComponent('SearchBlock'),
    TerminalBlock: stubComponent('TerminalBlock'),
    WebBlock: stubComponent('WebBlock'),
  },
}

// ── capture the loader registration ──────────────────────────────────────
const registrations = []
const headItems = []
const bodyItems = []
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
sandbox.location = { href: 'http://127.0.0.1:0/', origin: 'http://127.0.0.1:0', protocol: 'http:', host: '127.0.0.1:0' }
sandbox.navigator = { userAgent: 'dsh-chat-flow-smoke', language: 'zh-CN', maxTouchPoints: 0 }
sandbox.innerWidth = 1440
sandbox.innerHeight = 900
sandbox.devicePixelRatio = 1
sandbox.addEventListener = () => {}
sandbox.removeEventListener = () => {}
sandbox.dispatchEvent = () => true
sandbox.scrollTo = () => {}

// 记录 document 挂载点（head 的 style + body 的抽屉宿主）。
const originalHeadAppend = sandbox.document.head.appendChild.bind(sandbox.document.head)
sandbox.document.head.appendChild = (child) => {
  headItems.push(child)
  return originalHeadAppend(child)
}
const originalBodyAppend = sandbox.document.body.appendChild.bind(sandbox.document.body)
sandbox.document.body.appendChild = (child) => {
  bodyItems.push(child)
  return originalBodyAppend(child)
}

const context = vm.createContext(sandbox)
const code = readFileSync(CLIENT, 'utf8')
new vm.Script(code, { filename: CLIENT }).runInContext(context)

// ── assertions ───────────────────────────────────────────────────────────
const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

if (registrations.length !== 1) fail(`expected 1 loader registration, got ${registrations.length}`)
else pass('registered exactly one __ModuleLoader__ entry')

const entry = registrations[0]
if (entry?.id !== 'dsh-chat-plus') fail(`expected id "dsh-chat-plus", got ${JSON.stringify(entry?.id)}`)
else pass('loader id is "dsh-chat-plus"')

const require = (id) => {
  if (id in MODULES) return MODULES[id]
  throw new Error(`[smoke] unexpected require(${id}) — add it to the stub table`)
}

const mod = entry.factory(require)
if (typeof mod.apply !== 'function') fail('factory did not export apply()')
else pass('factory exports apply()')
if (!Array.isArray(mod.inject)) fail('factory did not export inject[]')
else pass(`factory exports inject[] = [${mod.inject.join(', ')}]`)
// inject[] 取并集：原 dsh-chat-plus 的 slots + 原 dsh-triad 的
// locale / inputTriggers / sessions（四个工作台的服务面）。
if (JSON.stringify(mod.inject) !== JSON.stringify(['slots', 'locale', 'inputTriggers', 'sessions'])) {
  fail(`expected inject = ['slots','locale','inputTriggers','sessions'], got [${mod.inject.join(', ')}]`)
} else {
  pass('client inject = ["slots","locale","inputTriggers","sessions"] (chat-plus + triad union)')
}

// ── run apply() against a stub client context ────────────────────────────
const registeredSlots = []
const slotsService = {
  inject: (slot, factory) => {
    if (typeof factory !== 'function') throw new Error('slots.inject expects a factory')
    factory()
  },
  register: (spec, comp) => {
    if (comp === undefined) throw new Error('slots.register called without component')
    registeredSlots.push({
      slot: spec?.name, key: spec?.key, priority: spec?.priority, locale: spec?.locale,
      id: spec?.id, order: spec?.order,
    })
    return () => {}
  },
  entries: (name) => [],
}
// 融合后的 client 需要四类 service（slots 之外）。原 dsh-chat-plus 只要 slots；
// 原 dsh-triad 的四个工作台要 locale / inputTriggers / sessions / modelDirectories。
// 缺了哪个，对应工作台的 try/catch 就吃掉它、座位少注册一个——所以这里必须
// 给全，否则下面的座位数断言分不清「真没注册」与「stub 不够」。
const sessionsStub = { list: { getSnapshot: () => ({ byId: {} }) } }
const inputTriggersStub = { register: () => () => {} }
const modelDirectoriesStub = { list: () => Promise.resolve([]) }
const ctx = {
  effect: (fn) => { const stop = typeof fn === 'function' ? fn() : undefined; return stop ?? (() => {}) },
  locale: { register: () => () => {} },
  get: (name) => {
    if (name === 'sessions') return sessionsStub
    if (name === 'inputTriggers') return inputTriggersStub
    if (name === 'modelDirectories') return modelDirectoriesStub
    return undefined
  },
  slots: slotsService,
  inject: (names, fn) => {
    if (!Array.isArray(names)) throw new Error('ctx.inject expects a names array')
    const scope = { slots: slotsService }
    for (const name of names) {
      if (name === 'sessions') scope.sessions = sessionsStub
      else if (name === 'inputTriggers') scope.inputTriggers = inputTriggersStub
      else if (name === 'modelDirectories') scope.modelDirectories = modelDirectoriesStub
      else scope[name] = ctx.get(name)
    }
    fn(scope)
  },
}

try {
  mod.apply(ctx)
  pass('apply(ctx) ran without throwing')
} catch (error) {
  fail(`apply(ctx) threw: ${error?.stack ?? error}`)
}

// 活动抽屉宿主挂到 body。
const drawerHost = bodyItems.find((item) => item?.id === 'dsh-activity-drawer-root')
if (drawerHost === undefined) fail('activity drawer host was not appended to document.body')
else pass('activity drawer host mounted on document.body')

// 九枚 <style> 注入 head：dsh-chat-plus 自带八枚 + 融合进来的 skill-source 一枚
// （id 刻意带 dsh-triad 前缀，与其它样式表互不吞并）。KR 对话总开关关闭时少
// 注入一枚 dsh-kr-chat-styles（只隐藏不删除，见 src/client/kr-chat/enabled.ts），
// 因此这里与开关同源断言。
const krEnabled = /export const KR_CHAT_ENABLED = (true|false)/.exec(
  readFileSync(resolve(ROOT, 'src/client/kr-chat/enabled.ts'), 'utf8'),
)?.[1] === 'true'
const styleIds = headItems.filter((item) => item?.tagName === 'STYLE').map((item) => item?.id ?? '')
const expectedStyles = [
  'dsh-chat-flow-styles', 'dsh-tool-summary-styles',
  'dsh-chat-flow-shot-styles', 'dsh-modal-animation-styles',
  'dsh-chat-flow-proto-styles', 'dsh-chat-flow-diagram-styles',
  'dsh-chat-flow-download-styles',
  'dsh-triad-skill-source-styles',
  ...(krEnabled ? ['dsh-kr-chat-styles'] : []),
]
for (const expected of expectedStyles) {
  if (!styleIds.includes(expected)) fail(`missing injected <style id=${expected}>`)
}
if (!krEnabled && styleIds.includes('dsh-kr-chat-styles')) {
  fail('KR_CHAT_ENABLED=false 时不应注入 dsh-kr-chat-styles（KR 只隐藏不删除）')
}
if (!code.includes('kr-agent-mini-card') || !code.includes('kr-agent-mini-exit')) {
  fail('client bundle is missing the KR minimal activity card / exit motion')
} else {
  pass('client bundle contains KR minimal activity card and exit motion')
}
// 头像菜单不能留在 turn-process 固定高度 / overflow:hidden 的子树里；必须 portal 到 body。
if (!code.includes('avatarMenuPosition') || !code.includes('.kr-agent-avatar-menu {\n  position: fixed;')) {
  fail('client bundle is missing the body-portaled Agent avatar menu')
} else {
  pass('Agent avatar menu is body-portaled with fixed positioning')
}
// 状态卡动作文字必须是整行遮罩扫光（background-clip: text + background-position 位移）：
// 光带宽度与推进速度解耦，才能又窄又慢。逐字延时那套（kr-agent-mini-char-in）
// 光带宽度≈动画时长，窄了就必然快，属于退化。
if (!code.includes('kr-agent-text-sweep')
  || !code.includes('-webkit-background-clip: text')
  || code.includes('kr-agent-mini-char-in')
  || code.includes('kr-agent-mini-color-flow')) {
  fail('KR Agent action must use a mask-based left-to-right sweep (not per-character jumping)')
} else {
  pass('KR Agent action uses mask-based left-to-right color sweep motion')
}

if (styleIds.length === expectedStyles.length) {
  pass(`injected ${styleIds.length} <style> sheets (dtt__ + dts__ + tsh__ + modal + proto + diagram + download${krEnabled ? ' + kr' : ''})`)
} else if (styleIds.length > expectedStyles.length) {
  fail(`unexpected extra styles: ${styleIds.join(', ')}`)
}

// 八枚槽位：对话增强五枚（turn-process / assistant-step keyed / 截图按钮 /
// download toolview / kr-todo-bridge）+ 融合工作台三枚（automation-notifier、
// dsh-memory-inject-toggle、skill toolview）。座位 id/order/locale 全部原样保留。
const cell = (key) => registeredSlots.find((s) => s?.slot === 'conversation.chat.node' && s?.key === key)
if (registeredSlots.length !== 8) {
  fail(`expected 8 slot registrations, got ${registeredSlots.length}: ${JSON.stringify(registeredSlots)}`)
} else {
  pass('registered 8 seats (5 chat-plus + 3 triad: automation-notifier / memory toggle / skill toolview)')
}

const downloadSeat = registeredSlots.find((s) => s?.slot === 'tool.call.toolview' && s?.key === 'download')
if (downloadSeat === undefined) fail('missing keyed toolview seat tool.call.toolview / download')
else pass('seat tool.call.toolview / download (keyed by wire tool name)')

const skillSeat = registeredSlots.find((s) => s?.slot === 'tool.call.toolview' && s?.key === 'skill')
if (skillSeat === undefined) fail('missing triad seat tool.call.toolview / skill')
else pass('seat tool.call.toolview / skill (triad)')

const memoryToggle = registeredSlots.find((s) => s?.slot === 'conversation.input.left' && s?.id === 'dsh-memory-inject-toggle')
if (memoryToggle === undefined) fail('missing triad seat conversation.input.left / dsh-memory-inject-toggle')
else if (memoryToggle.order !== 99) fail(`memory toggle order = ${memoryToggle.order}, expected 99`)
else pass('seat conversation.input.left / dsh-memory-inject-toggle @ order 99 (triad)')

const notifier = registeredSlots.find((s) => s?.slot === 'shell.overlay' && s?.id === 'automation-notifier')
if (notifier === undefined) fail('missing triad seat shell.overlay / automation-notifier')
else if (notifier.order !== 90) fail(`automation notifier order = ${notifier.order}, expected 90`)
else pass('seat shell.overlay / automation-notifier @ order 90 (triad)')

const todoDockSeat = registeredSlots.find((s) => s?.slot === 'conversation.input.dock' && s?.id === 'kr-todo-bridge')
if (todoDockSeat === undefined) fail('missing input.dock seat conversation.input.dock / kr-todo-bridge')
else pass('seat conversation.input.dock / kr-todo-bridge')

const processSeat = cell('turn-process')
if (processSeat === undefined) {
  fail('missing registration for key turn-process')
} else if (processSeat.priority !== -100) {
  fail(`key turn-process priority = ${processSeat.priority}, expected -100`)
} else if (processSeat.locale !== 'chat') {
  fail(`key turn-process locale = ${processSeat.locale}, expected "chat"`)
} else {
  pass('seat conversation.chat.node / turn-process @ priority -100')
}

const asst = cell('assistant-step')
if (asst === undefined) {
  fail('missing registration for key assistant-step')
} else if (asst.priority !== -100) {
  fail(`key assistant-step priority = ${asst.priority}, expected -100`)
} else if (asst.locale !== 'chat') {
  fail(`key assistant-step locale = ${asst.locale}, expected "chat"`)
} else {
  pass('seat conversation.chat.node / assistant-step @ priority -100')
}

const shot = registeredSlots.find((s) => s?.slot === 'conversation.chat.assistant-actions')
if (shot === undefined) {
  fail('missing screenshot action registration for conversation.chat.assistant-actions')
} else if (shot.id !== 'chat-flow-screenshot') {
  fail(`screenshot action id = ${JSON.stringify(shot.id)}, expected "chat-flow-screenshot"`)
} else if (shot.order !== 5) {
  fail(`screenshot action order = ${shot.order}, expected 5`)
} else {
  pass('seat conversation.chat.assistant-actions / chat-flow-screenshot @ order 5')
}

// 思考 chip / 工具 chip 共用的 window 级抽屉总线已创建（apply 内不会建，
// 但 mountActivityDrawer 只挂根；总线由首个 chip 挂载时惰性创建——此处
// 校验抽屉根存在即视为通道就绪）。
const bus = sandbox.__dshActivityDrawerStore__
console.log(`info  activity drawer bus present at apply time: ${bus !== undefined ? 'yes' : 'no (lazy, created on first chip mount)'}`)

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${CLIENT}`)
process.exit(process.exitCode ?? 0)
