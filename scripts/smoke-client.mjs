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

import { readFileSync, existsSync } from 'node:fs'
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
  // URL / URLSearchParams 是 Node 注入的宿主全局、不是 ECMAScript 内建，
  // vm.createContext 造的新 context 里默认没有。不显式给就等于 undefined，
  // bundle 里所有 `new URL(...)` 全走 catch 降级，而其中有些降级（站点名认不出
  // 来、落地页判定恒为 false）**不会报错**，只会让断言测到一个浏览器里不存在的
  // 行为。真实浏览器里这两个一直在，sandbox 必须还原。
  URL,
  URLSearchParams,
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
  // 四工作台的窄屏覆盖（src/client/triad/responsive.ts）。曾经定义了却没人
  // 调用，整段样式被 tree-shake 掉、从未注入 —— 窄屏下设置面板与居中对话框
  // 全是坏的。断言它必须在册，防止再次掉线。
  'dsh-triad-responsive-styles',
  // 全局动画节流（页面不可见时暂停全页 CSS 动画），与 KR 开关无关，始终注入。
  'dsh-anim-pause',
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
// 「操作面板」卡（人话行动时间线）：默认开着，样式与组件都必须在 bundle 里。
// 断言样式族而非组件名——组件名可能因打包混淆消失，.kr-card--plain 是契约。
if (krEnabled) {
  const plainCardVisible = /export const KR_PLAIN_TIMELINE_CARD_VISIBLE = (true|false)/
    .exec(readFileSync(resolve(ROOT, 'src/client/kr-chat/enabled.ts'), 'utf8'))?.[1] === 'true'
  if (!plainCardVisible) {
    fail('KR_PLAIN_TIMELINE_CARD_VISIBLE must default to true (人话行动流卡默认展示)')
  } else if (!code.includes('.kr-card--plain') || !code.includes('.kr-plain-intent') || !code.includes('kr-plain-step-in')) {
    fail('client bundle is missing the plain-progress card styles (.kr-card--plain / .kr-plain-intent / kr-plain-step-in)')
  } else if (!/\\u64CD\\u4F5C\\u9762\\u677F/.test(code)) {
    // bundle 里中文被 esbuild 转成字面 \uXXXX（大写 hex），正则里要写双反斜杠。
    fail('client bundle is missing the plain-progress card title (操作面板)')
  } else if (!/kr-card__title[^)]*?\\u64CD\\u4F5C\\u9762\\u677F/.test(code)) {
    // 只认标题那一处：源码注释里「正在做什么」作为旧名还会出现若干处，那是描述性
    // 文字，不该让断言失败；真正要锁的是卡片头部渲染出来的那一行。
    fail('plain-progress card header must render the title 操作面板')
  } else {
    pass('plain-progress card (操作面板) present with its styles')
  }
}

// 记忆卡：默认折叠 + 折叠态带「N 条」徽标。
// 断言读源码而不是 bundle —— bundle 里中文被 esbuild 转成 \uXXXX，正则难写；
// 而这两条契约本身就是源码里的一行状态初值与一个类名，直接读最实。
if (krEnabled) {
  const memorySrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrMemoryCard.tsx'), 'utf8')
  if (!/const \[collapsed, setCollapsed\] = useState\(true\)/.test(memorySrc)) {
    fail('记忆卡必须默认折叠（有新增也不自动展开），useState 初值应为 true')
  } else if (!memorySrc.includes('kr-card__badge--count')) {
    fail('记忆卡折叠态必须带「N 条」徽标（kr-card__badge--count）')
  } else if (!code.includes('.kr-card__badge--count')) {
    fail('client bundle is missing the .kr-card__badge--count style')
  } else {
    pass('记忆卡默认折叠，折叠态带「N 条」徽标')
  }
}

// 用时读数：挂在对话流那张「Agent 正在…」活动卡里（右栏大盘里不再有）。
if (krEnabled) {
  const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrLiveActivityCard.tsx'), 'utf8')
  const shadowSrc = readFileSync(resolve(ROOT, 'src/client/tool-summary/TurnProcessShadowView.tsx'), 'utf8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')
  if (!/className="kr-elapsed"/.test(cardSrc)) {
    fail('活动卡必须渲染用时读数 .kr-elapsed')
  } else if (!/typeof turnStart === 'number'/.test(cardSrc)) {
    fail('用时读数只认真实起点：turnStart 拿不到就不渲染（不许猜数）')
  } else if (!/turnStart=\{krProjection\.turnStart\}/.test(shadowSrc)) {
    fail('turnStart 必须从 KrActivityProjection 透传到活动卡（投影要含本轮真实起点）')
  } else if (panelSrc.includes('KrTurnTimer') || /kr-turn-strip/.test(code)) {
    fail('用时已搬去活动卡，右栏大盘不该再留着 kr-turn-strip / KrTurnTimer')
  } else if (!code.includes('.kr-elapsed')) {
    fail('client bundle is missing the elapsed readout styles')
  } else {
    pass('用时读数挂在活动卡上（真实起点、无大盘残留）')
  }
}
// 头像菜单不能留在 turn-process 固定高度 / overflow:hidden 的子树里；必须 portal 到 body。
if (!code.includes('avatarMenuPosition') || !code.includes('.kr-agent-avatar-menu {\n  position: fixed;')) {
  fail('client bundle is missing the body-portaled Agent avatar menu')
} else {
  pass('Agent avatar menu is body-portaled with fixed positioning')
}
// 状态卡动作文字的运行信号必须拆成两层：换字时交叉淡入淡出、等待时末尾三点。
// 两层都只动 opacity/transform，走合成器。
//
// 交叉淡入淡出的必要条件是「两层同时在 DOM 里」：useCrossfadeText 保留退场层，
// 两层由 .kr-agent-mini-action-stack 叠在同一 grid 格。退回 key={action} 重建节点
// 就等于退回「旧字瞬间消失 + 新字淡入」的闪一下，所以必须断言存在退场层这条路径
// （data-phase="out"）和叠放容器。
//
// 三点必须真的是三个独立元素：靠伪元素只能凑两颗，且 opacity 打在同一个元素上
// 时三颗会一起亮、错峰就没了。产物是 JSX 编译后的 jsx() 调用。
//
// 被否掉的方案不要复活：整行遮罩扫光（kr-agent-text-sweep）每帧都要重绘文字，
// 终端光标（kr-agent-caret）与单点呼吸（kr-agent-dot）都被嫌丑，
// 逐字延时（kr-agent-mini-char-in）则光带宽度≈动画时长、窄了就必然快。
// 注意：不能全 bundle 禁 background-clip —— tool-summary 的 .dts__process 忙碌
// 微光（本插件自己的旧折叠行，KR 模式下不显示）本来就用它，不在本次范围内。
if (!code.includes('useCrossfadeText')
  || !code.includes('kr-agent-mini-action-stack')
  || !code.includes('kr-agent-action-in')
  || !code.includes('kr-agent-action-out')
  || !/"data-phase": \w+\.exiting \? "out" : "in"/.test(code)
  || !code.includes('kr-agent-dots')
  // 三颗 <i> 必须真在产物里：jsx("span", { className: "kr-agent-dots", ... children: [ jsx("i", {}) ...
  || !/className: "kr-agent-dots"[^)]*children: \[\s*\/\* @__PURE__ \*\/ \(0, \w+\.jsx\)\("i", \{\}\)/.test(code)
  || code.includes('kr-agent-text-sweep')
  || code.includes('kr-agent-caret')
  || code.includes('kr-agent-mini-dot')
  || code.includes('kr-agent-mini-char-in')
  || code.includes('kr-agent-mini-color-flow')) {
  fail('KR Agent action must use compositor-only motion: crossfade + three-dot loader')
} else {
  pass('KR Agent action uses compositor-only motion (crossfade on change + three-dot loader)')
}

if (styleIds.length === expectedStyles.length) {
  pass(`injected ${styleIds.length} <style> sheets (dtt__ + dts__ + tsh__ + modal + proto + diagram + download + anim-pause${krEnabled ? ' + kr' : ''})`)
} else if (styleIds.length > expectedStyles.length) {
  fail(`unexpected extra styles: ${styleIds.join(', ')}`)
}

// 页面不可见 → body 打标记 → 全页 CSS 动画挂起。高刷屏（300Hz）上 rAF 会跑满
// 帧，常驻 infinite 动画没人看时也在满帧重绘，这层是插件侧能兜住的部分。
if (!code.includes('data-dsh-anim-paused') || !code.includes('animation-play-state: paused !important')) {
  fail('client bundle is missing the global animation throttle (page hidden → pause all CSS animations)')
} else {
  pass('global animation throttle pauses all CSS animations when the page is hidden')
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

// 已清理的死文件：这些组件写下来却从没有任何地方渲染/引用，留着只会让人以为
// 「默认视图判定」「结果卡」这些能力还在。锁住它们不被误复活。
for (const dead of [
  'src/client/kr-chat/KrChatView.tsx',
  'src/client/kr-chat/KrExecutionResultCard.tsx',
  'src/client/kr-chat/step-parser.ts',
  'src/client/kr-chat/default-view.ts',
]) {
  if (existsSync(resolve(ROOT, dead))) fail(`死代码已清理，不应复活：${dead}`)
}
if (!existsSync(resolve(ROOT, 'src/client/kr-chat/plain-language.ts'))) {
  fail('plain-language.ts 缺失（人话行动流的核心翻译层）')
} else {
  pass('死代码已清理（KrChatView / KrExecutionResultCard / step-parser / default-view）')
}

// 无障碍：活动卡上的用时读数与思考视口都不能被 live region 反复播报。
// 两处的文本都随时间/流式高频变化：活动卡整块是 aria-live=polite（动作名换字
// 要播报），用时读数每秒变一次，留在 live 树里就是每秒念一次时长；思考视口
// 则会每秒念一段新内容。两者都会把读屏变成噪音。
const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrLiveActivityCard.tsx'), 'utf8')
const reasoningSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrReasoningCard.tsx'), 'utf8')
// 断言要打在**代码**上：这几个文件的注释里会解释「为什么不给 role="status"」，
// 直接正则匹配整份源码会被注释里的字面量误伤。
const cardCode = cardSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
const reasoningCode = reasoningSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
if (!/className="kr-elapsed"[\s\S]{0,400}aria-hidden="true"/.test(cardCode)) {
  fail('活动卡的用时读数必须 aria-hidden（整卡是 aria-live=polite，读数每秒变会被每秒播报）')
} else if (/aria-live=\{[^}]*elapsed/i.test(cardCode)) {
  fail('用时读数不得单独开 aria-live')
} else if (/aria-live=\{running \? 'polite'/.test(reasoningCode)) {
  fail('思考视口不得在流式期间开 aria-live=polite（会持续打断读屏用户）')
} else if (!/aria-live="off"/.test(reasoningCode)) {
  fail('思考视口必须显式 aria-live="off"')
} else {
  pass('用时读数与思考视口都不在 live 播报面上（高频文本不轰炸读屏）')
}

// 表头短徽标不许被 flex 压成竖排。回归过一次：「2 步」在窄栏里被压成一个字宽、
// 「步」掉到第二行，徽标凭空长高一截——根因是 flex item 的 min-width:auto 解析成
// min-content，而含空格的短文本 min-content 就是第一个词。
if (krEnabled) {
  if (!/\.kr-card__badge \{[^}]*white-space: nowrap/.test(code)) {
    fail('.kr-card__badge 必须 white-space: nowrap（窄栏里「2 步」会被压成竖排两行）')
  } else if (!/\.kr-plain-tech-toggle \{[^}]*white-space: nowrap/.test(code)) {
    fail('.kr-plain-tech-toggle 必须 white-space: nowrap（窄栏里「技术细节」会竖排）')
  } else {
    pass('表头短徽标与开关按钮不会被压成竖排')
  }
}

// 三条这轮修掉的 P1：规则形状不能回退。
if (krEnabled) {
  const toolViewSrc = readFileSync(resolve(ROOT, 'src/client/tool-summary/ToolGroupNodeView.tsx'), 'utf8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/shot/Panel.tsx'), 'utf8')
  const agentSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')

  // hook 早退：isKrMode 的 return null 必须在两个 useChat 之后，否则切
  // 对话标签（controller 会 removeAttribute）后同一 fiber 再次渲染会抛
  // "Rendered more hooks than during the previous render"，异常冒到聊天树的 ErrorBoundary。
  const earlyExit = /const isKrMode =[\s\S]{0,200}?if \(isKrMode\) return null[\s\S]{0,200}?useChat\(/.test(toolViewSrc)
  if (earlyExit) {
    fail('ToolGroupNodeView 不得在 useChat 之前 return null（违反 rules of hooks，切换视图会抛异常）')
    // 截图面板：空消息分支必须复位 busy，否则面板永久卡在「正在渲染…」。
  } else if (/if \(messages\.length === 0\) \{\s*setResult\(null\)/.test(panelSrc)) {
    fail('截图面板的空消息分支必须先 setBusy(false)（否则 token 守卫让 busy 永远为 true，面板卡死）')
    // 大盘：turnData 必须做引用稳定化，否则下游 memo 全被击穿、每帧重扫全轮思考。
  } else if (!/fingerprintTurnData/.test(agentSrc)) {
    fail('KrAgentPanel 缺少 turnData 引用稳定化（memo 会被每帧击穿）')
  } else if (!/const toolViews = useMemo/.test(agentSrc) && /KrToolCallsCard/.test(agentSrc)) {
    fail('KrAgentPanel 若仍挂着工具调用卡，其 toolViews 必须 memo（含每条一次的 rawResultJson 序列化）')
  } else if (existsSync(resolve(ROOT, 'src/client/kr-chat/KrToolCallsCard.tsx'))) {
    fail('工具调用卡已按要求整块移除，KrToolCallsCard.tsx 不该还在')
  } else if (/KrToolCallsCard|kr-tool-|kr-tools-/.test(agentSrc) || /kr-tool-|kr-tools-/.test(code)) {
    fail('工具调用卡已整块移除，大盘与样式表里不该再留 kr-tool* 残留')
  } else {
    pass('hook 顺序 / busy 收口 / 大盘 memo 三处修复在位；工具调用卡无残留')
  }

  // 子智能体区块：样式族 + 会话 id 传递。缺任何一样都会让 workflow 底下
  // 看不到子智能体清单（而子智能体是独立会话，父调用里根本没有这些信息）。
  if (krEnabled) {
    if (!code.includes('.kr-plain-subs__list') || !code.includes('.kr-plain-sub__label')) {
      fail('client bundle is missing the subagent block styles (.kr-plain-subs*)')
    } else if (!/sessionId=\{latestChatSessionId\}/.test(agentSrc)) {
      fail('KrPlainTimelineCard 必须收到当前会话 id（子智能体目录按父会话寻址）')
    } else {
      pass('子智能体区块样式与父会话 id 传递在位')
    }

    // 「操作面板」卡的三个布局修复：行内技术细节按钮必须收成卡片级（15 行挂
    // 15 枚按钮是横向噪声）、列表必须有上下渐隐（否则顶部被硬切出半行）、
    // 收口时必须回顶（内容定格后停在底部会把开头几步挡在视口外）。
    const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPlainTimelineCard.tsx'), 'utf8')
    if (/kr-plain-step__tech-toggle/.test(cardSrc)) {
      fail('行内「技术细节」按钮已废弃，必须收成卡片级总开关（.kr-plain-tech-toggle）')
    } else if (!code.includes('.kr-plain-list[data-edges="both"]')) {
      fail('时间线列表缺少上下渐隐遮罩（顶部会被硬切出半行）')
    } else if (!/wasRunningRef/.test(cardSrc)) {
      fail('轮次收口时必须把时间线列表拉回顶部')
    } else {
      pass('技术细节收成卡片级开关 + 列表渐隐 + 收口回顶')
    }

    // 子智能体：主数据源必须是 items（实时投影），subagentsByParent 只作兜底。
    // 后者只在父会话的目录被打开过时才存在，要靠 refreshSubagents 主动拉、依赖
    // host 的 remote 子服务能不能通；而顶栏「N 个子智能体」读的是 items 里的投影
    // 条目——那条路零 RPC 且一定有数据。
    const catSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/subagent-catalog.ts'), 'utf8')
    if (!/rowsFromItems/.test(catSrc) || !/'origin'/.test(catSrc)) {
      fail('子智能体目录必须先从 items（origin==subagent 的条目）读实时投影')
    } else if (!/state: 'unloaded'/.test(catSrc) || !/parentAvailable/.test(catSrc)) {
      fail('子智能体目录必须区分「未加载」与「确实为空」（靠 parentAvailable 判定）')
    } else if (!/state === 'unloaded'/.test(cardSrc) || !/子智能体清单未加载/.test(cardSrc)) {
      fail('未加载态必须有独立文案，不能复用「这次没有派生独立的子智能体」')
    } else {
      pass('子智能体目录：items 实时投影为主 + 未加载/为空分层')
    }
  }
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${CLIENT}`)
process.exit(process.exitCode ?? 0)
