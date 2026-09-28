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
  // 工作台的窄屏覆盖（src/client/triad/responsive.ts）。曾经定义了却没人
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
  } else if (!code.includes('.kr-card--plain') || !code.includes('kr-plain-step-in')) {
    fail('client bundle is missing the plain-progress card styles (.kr-card--plain / kr-plain-step-in)')
  } else if (/^\.kr-plain-intent/m.test(code)) {
    fail('「接下来」预告行已整块删除，样式表里不该再有 .kr-plain-intent 规则')
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

// 记忆卡：默认折叠 + 折叠态右侧带一行「N 条」纯文字（不再是带底色的徽标）。
// 断言读源码而不是 bundle —— bundle 里中文被 esbuild 转成 \uXXXX，正则难写；
// 而这两条契约本身就是源码里的一行状态初值与一个类名，直接读最实。
if (krEnabled) {
  const memorySrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrMemoryCard.tsx'), 'utf8')
  if (!/const \[collapsed, setCollapsed\] = useState\(true\)/.test(memorySrc)) {
    fail('记忆卡必须默认折叠（有新增也不自动展开），useState 初值应为 true')
  } else if (!memorySrc.includes('kr-card__meta')) {
    fail('记忆卡折叠态必须带「N 条」说明文字（.kr-card__meta）')
  } else if (!/\.kr-card__meta \{[^}]*white-space: nowrap/.test(code)) {
    fail('.kr-card__meta 必须 white-space: nowrap（固定短文本不参与收缩）')
  } else {
    pass('记忆卡默认折叠，折叠态带「N 条」纯文字')
  }
}

// 用时读数已从对话流那张「Agent 正在…」活动卡上撤掉：卡片只讲「正在做什么」，
// 每秒跳一格的时长留在这里只会跟动作名抢主角。
if (krEnabled) {
  const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrLiveActivityCard.tsx'), 'utf8')
  const shadowSrc = readFileSync(resolve(ROOT, 'src/client/tool-summary/TurnProcessShadowView.tsx'), 'utf8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')
  if (/kr-elapsed|elapsedText/.test(cardSrc)) {
    fail('活动卡不该再渲染用时读数（.kr-elapsed / elapsedText 必须清干净）')
  } else if (/\bturnStart\b/.test(cardSrc) || /krProjection\.turnStart/.test(shadowSrc)) {
    fail('活动卡已不用 turnStart：KrActivityProjection 里的本轮起点与透传都要一并撤掉')
  } else if (panelSrc.includes('KrTurnTimer') || /kr-turn-strip/.test(code)) {
    fail('用时已搬去活动卡，右栏大盘不该再留着 kr-turn-strip / KrTurnTimer')
  } else if (/^\.kr-elapsed\b/m.test(code)) {
    fail('client bundle is stale: the elapsed readout styles are still there')
  } else {
    pass('活动卡不再显示用时读数（时长只在右栏大盘与总结卡上）')
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
// download toolview / kr-todo-bridge）+ 融合工作台三枚（dsh-memory-builtin-toggle、
// dsh-memory-inject-toggle、skill toolview）。座位 id/order/locale 全部原样保留；
// 原 automation-notifier 随自动化模块一起下线。
const cell = (key) => registeredSlots.find((s) => s?.slot === 'conversation.chat.node' && s?.key === key)
if (registeredSlots.length !== 8) {
  fail(`expected 8 slot registrations, got ${registeredSlots.length}: ${JSON.stringify(registeredSlots)}`)
} else {
  pass('registered 8 seats (5 chat-plus + 3 triad: builtin+memory toggles / skill toolview)')
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

// 内置提示词通道单独一枚按钮：两种不同的东西不挤一张卡里。
const builtinToggle = registeredSlots.find((s) => s?.slot === 'conversation.input.left' && s?.id === 'dsh-memory-builtin-toggle')
if (builtinToggle === undefined) fail('missing triad seat conversation.input.left / dsh-memory-builtin-toggle')
else if (builtinToggle.order !== 98) fail(`builtin toggle order = ${builtinToggle.order}, expected 98`)
else if (builtinToggle.order >= memoryToggle.order) fail('内置通道按钮必须排在记忆按钮左侧（order 更小）')
else pass('seat conversation.input.left / dsh-memory-builtin-toggle @ order 98 (triad)')

// 自动化完成通知（shell.overlay / automation-notifier）随 automation 模块一起下线：
// 官方的 schedule 任务页自带提醒目录，这条壳子里的 toast 不该复活。
const notifier = registeredSlots.find((s) => s?.slot === 'shell.overlay' && s?.id === 'automation-notifier')
if (notifier !== undefined) {
  fail('automation-notifier 座位已下线，不该再注册')
} else {
  pass('seat shell.overlay / automation-notifier 已下线')
}

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

// 无障碍：活动卡整块是 aria-live=polite（动作名换字要播报），思考视口则会每秒
// 念一段新内容。后者必须显式关掉 live 播报，否则读屏变成噪音。
const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrLiveActivityCard.tsx'), 'utf8')
const reasoningSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrReasoningCard.tsx'), 'utf8')
// 断言要打在**代码**上：这几个文件的注释里会解释「为什么不给 role="status"」，
// 直接正则匹配整份源码会被注释里的字面量误伤。
const cardCode = cardSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
const reasoningCode = reasoningSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
if (!/aria-live=\{active && !closing \? 'polite' : 'off'\}/.test(cardCode)) {
  fail('活动卡的 live region 必须只在动作名切换期间开启')
} else if (/aria-live=\{running \? 'polite'/.test(reasoningCode)) {
  fail('思考视口不得在流式期间开 aria-live=polite（会持续打断读屏用户）')
} else if (!/aria-live="off"/.test(reasoningCode)) {
  fail('思考视口必须显式 aria-live="off"')
} else {
  pass('live 播报面只留动作名切换，思考视口不轰炸读屏')
}

// 标题行右侧的短文本不参与收缩：否则窄栏里「3/5 完成」这类含空格的文本会被
// 压到一个词宽（min-width:auto → min-content）而竖排换行。
if (krEnabled) {
  if (!/\.kr-card__meta \{[^}]*white-space: nowrap/.test(code)) {
    fail('.kr-card__meta 必须 white-space: nowrap（窄栏里「3/5 完成」会被压成竖排）')
  } else if (/\.kr-card__badge\s*\{/.test(code) || /\.kr-plain-tech-toggle\s*\{/.test(code)) {
    fail('卡片头部不再有徽标与「技术细节」开关，bundle 里不该再有 kr-card__badge / kr-plain-tech-toggle 规则')
  } else {
    pass('标题行右侧只留纯文字，无徽标 / 无技术细节开关')
  }
}

// 思考过程卡必须贴在 KR 对话流里，不能回到右栏大盘。
// 两处一起断：右栏不再挂这张卡；对话流侧 assistant-step 真的挂了 inline 实例。
if (krEnabled) {
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')
  const panelCode = panelSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  const stepSrc = readFileSync(resolve(ROOT, 'src/client/thinking/ThinkingStepNodeView.tsx'), 'utf8')
  const stepCode = stepSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  if (/<KrReasoningCard[\s\S]{0,200}?\/>/.test(panelCode)) {
    fail('思考过程卡已移到 KR 对话流，右栏大盘不该再挂 <KrReasoningCard>')
  } else if (!/ownsReasoningCard[\s\S]{0,200}?<KrReasoningCard[\s\S]{0,300}?\sinline\b/.test(stepCode)) {
    fail('assistant-step 座位必须在「本回合第一个带思考的 step」上挂 inline 思考卡')
  } else if (!/REASONING_MAX_ROWS/.test(reasoningCode)) {
    fail('思考卡仍应保留 REASONING_MAX_ROWS 行数上限常量')
  } else {
    pass('思考过程卡贴在 KR 对话流（inline），右栏大盘不再重复挂载')
  }

  // 「思考一长就卡」的四处成因 + 折叠时机，逐条钉住：
  //  1. 喂进去的文本数组引用必须稳定（memo 一旦被打穿，每帧重算整轮思考）；
  //  2. 跟随探针只能是长度指纹，不能是全文 join（流式期每个 delta 拼一次全文）；
  //  3. DOM 必须只挂尾部窗口，不能整轮上千行全塞进去；
  //  4. 折叠判据是「总结卡出现」（summarizing），不是回合收口。
  const reasons = []
  if (!/reasoningSignature[\s\S]{0,500}?stableReasoningTexts/.test(stepCode)) {
    reasons.push('思考文本数组需用长度指纹稳定引用（stableReasoningTexts）')
  }
  if (/points\.join\('\\u0000'\)/.test(reasoningCode)) {
    reasons.push('跟随探针不能是全文 join（应为长度指纹）')
  }
  // 注意只查**渲染处** `{points.map(`：探针那行 points.map((p) => p.length) 是
  // 长度指纹本身，不该被这条误伤。
  if (!/WINDOW_ROWS/.test(reasoningCode)
    || /\{points\.map\(\(item/.test(reasoningCode)
    || !/\{windowed\.map\(/.test(reasoningCode)) {
    reasons.push('思考行必须只挂尾部 WINDOW_ROWS 窗口（{windowed.map}），不能整轮全量渲染')
  }
  // 4. 折叠判据是「回合已定型」（turnClosed || interrupted），不是
  //    assistant-step 的 running——工具间隙里 step 早就不 running 了。
  if (!/summarizing\s*=\s*turnClosed\s*\|\|\s*interrupted/.test(stepCode)
    || !/if \(!inline \|\| !summarizing \|\| was\) return/.test(reasoningCode)) {
    reasons.push('折叠判据必须是「回合已定型」（turnClosed || interrupted），不是 step 的 running')
  }
  // 5. 初始态只能看 summarizing。写成 `summarizing || !running` 会让卡在
  //    工具间隙挂成折叠态，而那时 summarizing 还没翻，之后再没有任何东西
  //    把它展开——整轮都看不见（工具执行期 step 早就不 running 了）。
  if (!/useState\(inline \? summarizing : false\)/.test(reasoningCode)) {
    reasons.push('卡片初始态必须只看 summarizing（写成 summarizing || !running 会整轮吞卡）')
  }
  // 6. 思考取数必须能在 locations 漏掉 step 时兜底扫全量节点，否则工具
  //    间隙里会出现「右栏能抽出预告、对话流却没有思考卡」。
  if (!/EMPTY_REASONING/.test(stepCode) || !/typeof nodes\.values === 'function'/.test(stepCode)) {
    reasons.push('思考取数需在 locations 为空时兜底扫全量 nodes')
  }
  // 7. 轮次号与回合状态必须双路取值：data.turn / data.status 优先，location
  //    那一路只作兜底。已收口的历史轮次上 location 对象可能整个缺字段，只写
  //    locationTurn?.turn 会取到 undefined，后续按轮次号的取数全部短路——
  //    卡连落脚点都没有，正是「总结完了怎么查看」看不到的原因。右栏一直好好的，
  //    因为 collectTurnNodes 本来就有 data.turn 那一路。
  if (!/\(data as \{ turn\?: number \}\)\.turn/.test(stepCode)
    || !/locationTurn\?\.status \?\?/.test(stepCode)) {
    reasons.push('轮次号/回合状态需 data.turn / data.status 优先、location 兜底（否则历史轮次取不到）')
  }
  if (reasons.length > 0) {
    fail('思考卡性能/时机回退：' + reasons.join('；'))
  } else {
    pass('思考卡：稳定引用 + 指纹探针 + 尾部窗口 + 按总结卡折叠 + 全量兜底')
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

  // 大盘常驻化：标签行那枚「Agent 轨迹大盘」开关与 store.panelOpen 已整块删除。
  // 一旦复活就说明右栏又能被收起，而那时若标签行按钮也被删掉，用户就再也回不来。
  if (krEnabled) {
    const ctrlSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/kr-chat-controller.tsx'), 'utf8')
    const storeSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/kr-chat-store.ts'), 'utf8')
    if (/function syncKrPanelToggle|getElementById\('kr-panel-toggle-btn'\)|const KR_PANEL_ICON/.test(ctrlSrc)) {
      fail('大盘已改为 KR 对话常态常驻，标签行那枚「Agent 轨迹大盘」开关不该复活')
    } else if (/readonly panelOpen|setPanelOpen\(|togglePanel\(|_panelOpen/.test(storeSrc)) {
      fail('store 的 panelOpen 开合状态已整块删除（大盘常驻，没有收起态）')
    } else if (/\.kr-panel-toggle\b/.test(code)) {
      fail('.kr-panel-toggle 样式已随按钮一起删除，样式表里不该再有残留')
    } else if (/readonly onCollapse/.test(agentSrc) || /onCollapse=/.test(ctrlSrc)) {
      fail('顶栏的「收起大盘 ×」已随常驻化删除，KrAgentPanel 不该再有 onCollapse')
    } else if (!/<KrAgentPanel/.test(ctrlSrc)) {
      fail('KR 对话必须常驻渲染 KrAgentPanel')
    } else {
      pass('大盘在 KR 对话里常驻（无开关 / 无 panelOpen / 无收起入口）')
    }
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

    // 「操作面板」卡：技术细节入口已按要求整块删除（连带它打开时的蓝底），
    // 于是这张卡只剩人话；列表仍必须有上下渐隐（否则顶部被硬切出半行）、
    // 收口时必须回顶（内容定格后停在底部会把开头几步挡在视口外）。
    const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPlainTimelineCard.tsx'), 'utf8')
    if (/showTech|kr-plain-tech-toggle|kr-plain-step__tech/.test(cardSrc)) {
      fail('「技术细节」开关与展开块已整块删除，卡片里不该再有残留')
    } else if (/kr-card__badge/.test(cardSrc)) {
      fail('标题行的「N 步」徽标已删除，只留文字')
    } else if (!code.includes('.kr-plain-list[data-edges="both"]')) {
      fail('时间线列表缺少上下渐隐遮罩（顶部会被硬切出半行）')
    } else if (!/wasRunningRef/.test(cardSrc)) {
      fail('轮次收口时必须把时间线列表拉回顶部')
    } else {
      pass('操作面板只留人话（无徽标 / 无技术细节）+ 列表渐隐 + 收口回顶')
    }

    // 行首布局：只剩一枚类别图标（那列 14px 空槽只为等一条红叉，已删）；
    // 标题行右侧也只剩标题本身（「当前在做什么」那行与它的样式一并删除）。
    if (/className="kr-plain-step__status"/.test(cardSrc) || code.includes('.kr-plain-step__status {')) {
      fail('行首的 14px 空状态槽已删除，失败改由类别图标角标承担')
    } else if (!code.includes('.kr-plain-step__icon[data-failed="true"]::after')) {
      fail('失败行必须在类别图标右上角挂红点角标（否则整列失去唯一的反例信号）')
    } else if (/className="kr-plain-now/.test(cardSrc) || /useCrossfadeText/.test(cardSrc)) {
      fail('标题行右侧的「当前在做什么」已删除，卡片里不该再有 now 渲染点')
    } else if (code.includes('.kr-plain-now')) {
      fail('.kr-plain-now 整套样式已随标题行那行文字删除，样式表里不该再有残留')
    } else {
      pass('行首无空槽 + 标题行只剩标题（失败由图标角标承担）')
    }

    // 简要模式不画图标、动词写回文字。
    if (!/data-brief=\{brief \? 'true' : undefined\}/.test(cardSrc)) {
      fail('简要模式必须打 data-brief（无图标排布靠它选样式）')
    } else if (!/\{!brief && \(/.test(cardSrc)) {
      fail('简要模式必须整枚跳过 .kr-plain-step__icon 的渲染')
    } else if (!/<span className="kr-plain-step__verb">\{step\.verb\}<\/span>/.test(cardSrc)) {
      // 断言渲染结果而不是变量名：早先查的是 `const label = brief`，那是实现
      // 细节，拆成三段 span 后变量名一变断言就误报，而「动词进文字」这件事
      // 其实一直是对的。改查动词那一枚 span 真的被渲染出来。
      fail('简要模式必须把动词写回文字（没图标时"plain-language.ts"分不出改还是读）')
    } else if (!/<span className="kr-plain-step__object">\{base\}<\/span>/.test(cardSrc)) {
      fail('简要模式的对象（文件名等）必须是独立的一段，词重量级不同但同色可读')
    } else if (!/<span className="kr-plain-step__count">\{count\}<\/span>/.test(cardSrc)) {
      fail('折叠次数必须从对象字符串里拆出来单独排（混在一起会被一起压成小字）')
    } else if (!/\.kr-plain-step__count \{/.test(code)) {
      fail('.kr-plain-step__count 缺少样式，药丸会退回无背景的裸文字')
    } else if (!/\.kr-plain-step\[data-brief="true"\]\[data-status="failed"\]/.test(code)) {
      fail('简要模式的失败行必须仍有可见标记（左缘 2px 红条）')
    } else {
      pass('简要模式无图标、动词入句、失败有红条')
    }

    // 详细/简要切换：卡头右上角两枚按钮，点了不能连带收起卡片（整行 header
    // 都是折叠热区，少了 stopPropagation 就会一点两变），且**默认档必须是简要**。
    const viewBtnCount = (cardSrc.match(/className="kr-plain-view__btn"/g) ?? []).length
    if (viewBtnCount !== 2) {
      fail('操作面板卡头右上角必须有「详细」「简要」两枚按钮（现在只有一枚）')
    } else if (!/className="kr-plain-view__btn"[\s\S]{0,400}?stopPropagation\(\); setViewDirect\('brief'\)/.test(cardSrc)
      || !/className="kr-plain-view__btn"[\s\S]{0,400}?stopPropagation\(\); setViewDirect\('full'\)/.test(cardSrc)) {
      fail('两枚档位按钮都必须 stopPropagation（整行 header 是折叠热区）')
    } else if (!/useState<PlainStepView>\(\(\) => readStoredView\(\)\)/.test(cardSrc)) {
      fail('详细/简要必须是组件状态并落盘（dsh.kr_chat.plain_view_v2）')
    } else if (!/localStorage\.getItem\(VIEW_STORAGE_KEY\) === 'full' \? 'full' : 'brief'/.test(cardSrc)) {
      fail('默认档必须是「简要」（只有显式存了 full 才回详细）')
    } else if (!/\.kr-plain-view__btn\[data-active="true"\]/.test(code)) {
      fail('档位按钮的激活态样式缺失（.kr-plain-view__btn[data-active="true"]）')
    } else {
      pass('操作面板卡头带详细/简要双按钮（默认简要 / 不误触折叠）')
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
