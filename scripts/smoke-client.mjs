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

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
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
/*
 * getElementById 必须真的按 id 查找。
 *
 * 幂等注入的样式表全靠它判重（`if (document.getElementById(id) !== null) return`），
 * 恒返回 null 会让每处调用都新建一份 <style>：三个工作台各自 ensureShellStyles()
 * 一次，head 里就出现三份 dsh-popover-shell-styles —— 那是桩的假象，真实浏览器
 * 里只有一份，但断言会把它报成"多余样式"。
 */
sandbox.document.getElementById = (id) => {
  const pool = [...headItems, ...bodyItems]
  for (const node of pool) {
    if (node?.id === id) return node
    const hit = node?.children?.find?.((child) => child?.id === id)
    if (hit !== undefined) return hit
  }
  return null
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
// locale / inputTriggers / sessions（四个工作台的服务面）+ layout（2026-10-04 起
// 记忆/能力/邮箱三个工作台改挂官方 main 页座位，开合走 ctx.layout.selectPanel）。
if (JSON.stringify(mod.inject) !== JSON.stringify(['slots', 'locale', 'inputTriggers', 'sessions', 'layout'])) {
  fail(`expected inject = ['slots','locale','inputTriggers','sessions','layout'], got [${mod.inject.join(', ')}]`)
} else {
  pass('client inject = ["slots","locale","inputTriggers","sessions","layout"] (chat-plus + triad union)')
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
// 融合后的 client 需要五类 service（slots 之外）。原 dsh-chat-plus 只要 slots；
// 原 dsh-triad 的四个工作台要 locale / inputTriggers / sessions / modelDirectories，
// 2026-10-04 起再加 layout（三个工作台页挂在官方 main 座位，开合走 selectPanel）。
// 缺了哪个，对应工作台的 try/catch 就吃掉它、座位少注册一个——所以这里必须
// 给全，否则下面的座位数断言分不清「真没注册」与「stub 不够」。
// sessions 桩：**必须带 scope()**。/iu 的投递链路走
// `sessions.scope(id).get('conversation').send(text)`，桩里少这一层就会让
// 投递静默失败（返回 false → 回退默认发送），冒烟却看不出问题。
const sentPrompts = []
const sessionsStub = {
  list: { getSnapshot: () => ({ byId: {} }) },
  scope: (id) => ({
    get: (name) => (name === 'conversation'
      ? { send: async (text) => { sentPrompts.push({ id, text }) } }
      : undefined),
  }),
}
// inputTriggers 桩：**两个方法都要给**。`register` 是技能源的旧面，`registerSource`
// 是 input-trigger 契约的正名；少一个就会让对应源静默不注册（catch 里只 warn），
// 表现为「菜单里没有那一组」，冒烟却看不出问题。
const registeredTriggerSources = []
const inputTriggersStub = {
  register: () => () => {},
  registerSource: (src) => {
    registeredTriggerSources.push({ trigger: src?.trigger, name: src?.name, order: src?.order, source: src })
    return () => {}
  },
  sessionOf: () => ({}),
}
const modelDirectoriesStub = { list: () => Promise.resolve([]) }
// layout 桩：selectPanel 记录调用（下面断言「点用量入口先切回会话」）。
const layoutCalls = []
const layoutStub = {
  selectPanel: (id) => { layoutCalls.push(id) },
  panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
}
const ctx = {
  effect: (fn) => { const stop = typeof fn === 'function' ? fn() : undefined; return stop ?? (() => {}) },
  // locale.bind：菜单行文案走官方 locale 命名空间（register 保留 + bind 返回翻译函数）。
  locale: { register: () => () => {}, bind: () => (key) => key },
  get: (name) => {
    if (name === 'sessions') return sessionsStub
    if (name === 'inputTriggers') return inputTriggersStub
    if (name === 'modelDirectories') return modelDirectoriesStub
    if (name === 'layout') return layoutStub
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
  // 对话内 HTML 卡片（src/client/html-embed/styles.ts）：标题栏 + 沙箱舞台 +
  // 全屏层。与 diagram 同批注入，独立 style id。
  'dsh-chat-flow-html-embed-styles',
  // iu 原生交互卡片（src/client/iu/styles.ts）：滑块 / 图表 / 清单 / 对比 +
  // 流式占位。与 html 卡片同批注入，独立 style id（命名空间 dtt-iu）。
  'dsh-chat-plus-iu-styles',
  'dsh-chat-flow-download-styles',
  'dsh-triad-skill-source-styles',
  // 供应商页样式（原 dsh-provider-hub/webui/styles）：.phub-* 卡片与控件规格、
  // 交互态、入场动效。2026-10-05 随供应商中心融合进来，由 applyProviderClient
  // 的 effect 注入 —— 之前这条链路漏了调用，所以这张表一直没出现在页面里。
  'dsh-provider-hub-styles',
  // 面板外壳（page / compact 两种形态）。2026-10-04 起由 registerPanelSeat 在
  // apply() 时同步注入（三个工作台页共用一个座位注册器），不再等 React 首帧。
  'dsh-popover-shell-styles',
  // 工作台的窄屏覆盖（src/client/triad/responsive.ts）。曾经定义了却没人
  // 调用，整段样式被 tree-shake 掉、从未注入 —— 窄屏下设置面板与居中对话框
  // 全是坏的。断言它必须在册，防止再次掉线。
  'dsh-triad-responsive-styles',
  // 全局动画节流（页面不可见时暂停全页 CSS 动画），与 KR 开关无关，始终注入。
  'dsh-anim-pause',
  // 工具闸门胶囊（src/client/tools-gate/styles.ts）：computer-use / browser-use
  // 按需开关的滑块、扫光、抖动。纯 CSS 动效，带 prefers-reduced-motion 兜底。
  'dsh-tools-gate-style',
  // 侧栏文档预览面板样式（src/client/sidebar-doc/index.tsx）。8b1db4b 引入时
  // 漏登本表，导致 smoke 一直报 unexpected extra styles —— 补录。
  'dsh-sdp-styles',
  // 侧栏「工作台」行的分类浮层（src/client/triad/hub/row-flyout.tsx）：
  // apply 时随 attachWorkbenchRowFlyout 注入（hover 浮层 + 滚轮切分类）。
  'dsh-workbench-row-flyout-styles',
  // 侧栏「工作区 / 操作间」双屏导航（src/client/triad/hub/nav-sections.tsx）：
  // apply 时随 attachSidebarSections 注入。横滑分类条（strip.tsx）已于 2026-10-25
  // 删除——四个入口收进「操作间」屏，不再平铺在侧栏。
  'dsh-sidebar-nav-sections-styles',
  // 界面字体覆盖（src/client/ui-font/font.ts）：把 --dsh-font-family-text/-code
  // （官方 0.2.1 的可写槽位）与 --dsw-font-family / --ds-font-family-code（消费值）
  // 改写成所选字体。必须在 apply 阶段就注入（不等 React），否则首帧会先按系统
  // 字体渲染、再闪成所选字体。
  'dsh-chat-plus-ui-font',
  // 首 token 平均平铺读数（src/client/stats-ttft/styles.ts）：只定分隔与入场，
  // 字号颜色全部继承官方 pill。apply 阶段随桥一起注入。
  'dsh-stats-ttft-styles',
  // 「@ 运行中的程序」（src/client/running-apps/styles.ts）：候选行里真实进程
  // 图标的尺寸/圆角/入场，以及前台窗口那枚小圆点。apply 阶段随 @ 源一起注入。
  'dsh-running-apps-styles',
  /*
   * 浏览器标志的样式表**已不在注入清单里**（2026-10-25 搬迁）。
   *
   * 那枚图标从「左侧会话列表行右端」（DOM 属性 + 伪元素，必须单独注入一张样式表）
   * 搬到了**操作面板卡头、Seeker 文字右侧**（我们自己的 React 树）。视觉改用
   * kr-chat/styles.ts 的 .kr-plain-head__browser，与那张表一起注入。
   *
   * browser-flag/styles.ts 仍然保留（含它的测试），只是不再挂载 —— 所以这里
   * 不能再要求 dsh-browser-flag-style 存在，否则「已经搬走」会变成一条永远红的断言。
   */
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
  } else if (code.includes('kr-plain-sweep') || /kr-plain-step\[data-status="running"\][^{]*\{[^}]*background-clip:\s*text/.test(code)) {
    // 用户点名「太反人类」的就是这套：进行中的那一行用 background-clip:text 让文字
    // 自带一道 2.2s 无限来回的扫光。它动的是**文字本身**——想读那行时正好被光带
    // 打断，且渐变裁切让整行大部分时间比邻居更暗、字更虚（中文笔画密，虚一点就糊）。
    // 换成「文字静止 + 行左竖线脉冲」后，这条断言负责防止扫光被重新加回来。
    fail('操作面板进行中行不得再用文字扫光（kr-plain-sweep / background-clip:text）：'
      + '活动信号必须交给行左竖线（kr-plain-active），文字保持静止可读')
  } else if (!code.includes('kr-plain-active')) {
    fail('操作面板进行中行必须用竖线脉冲（kr-plain-active）承担活动信号')
  } else if (/data-brief="true"\][^{]*\.kr-plain-step__title[^{]*\{[^}]*color:/.test(code)
    || /data-brief="true"\][^{]*\{[^}]*color:\s*var\(--dsw-alias-label-primary\)/.test(code)) {
    // 用户报的「简要的字体颜色要与详细保持一致」：简要档曾把 title 提为
    // primary + 500，切档时整列文字由灰转黑（实测 secondary #61666b →
    // primary #0f1115），读起来像换了一张卡。颜色现在只由基类（secondary）
    // 与 [data-status="running"]（primary）两处决定，**两档共用**。
    fail('简要档不得单独覆盖 title 颜色：两档色阶必须同源（基类 secondary + '
      + '进行中 primary），否则切档时整列文字由灰转黑')
  } else if (!/\.kr-plain-step__verb\s*\{[^}]*font-weight:\s*500/.test(code)) {
    // 动词的 600 在 12px 下会把 CJK 笔画糊成一团（读起来比对象更"脏"而不是更"重"），
    // 且与详细档整串 400 的差距过大——层次只能用字重排，且要排得住。
    fail('简要档动词字重必须是 500（600 在 12px 下糊笔画，与详细档差距也过大）')
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

// 「执行过程播报」内置通道已整条下掉（2026-10-01）。它当年给「操作面板」卡喂
// 「下一步：…」预告行；那行删除后，intent 只剩一个滚动跟随探针在消费、nowLabel
// 干脆没有渲染出口，而模型每一步都要多写一行。四处必须一起消失，漏一处就是
// 「模型白写一行」或「死代码复活」：
//   1. 注入规则 PLAIN_PROGRESS_RULE（host 半身）
//   2. composer 那枚「操作面板」开关（客户端内置通道卡）
//   3. extractIntent / nowLabel（客户端时间线）
//   4. plainInjectEnabled 那套读写法与路由
{
  const hostSrc = readFileSync(resolve(ROOT, 'src/triad/memory/engine/inject.ts'), 'utf8')
  const hostApiSrc = readFileSync(resolve(ROOT, 'src/triad/memory/api.ts'), 'utf8')
  const storeSrc = readFileSync(resolve(ROOT, 'src/triad/memory/engine/store.ts'), 'utf8')
  const typesSrc = readFileSync(resolve(ROOT, 'src/triad/memory/types.ts'), 'utf8')
  const timelineSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/plain-timeline.ts'), 'utf8')
  const toggleSrc = readFileSync(resolve(ROOT, 'src/client/triad/memory/Toggle.tsx'), 'utf8')
  const localesSrc = readFileSync(resolve(ROOT, 'src/client/triad/memory/locales.ts'), 'utf8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')
  const cardSrc2 = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPlainTimelineCard.tsx'), 'utf8')

  // 判据只看**活代码**：几个文件里都留着「这条通道为什么下掉」的历史注释，
  // 直接正则整份源码会被注释里的 nowLabel / PLAIN_PROGRESS_RULE 误伤。
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  const h = stripComments(hostSrc)
  const ha = stripComments(hostApiSrc)
  const st = stripComments(storeSrc)
  const ty = stripComments(typesSrc)
  const tls = stripComments(timelineSrc)
  const tg = stripComments(toggleSrc)
  const lc = stripComments(localesSrc)
  const pn = stripComments(panelSrc)
  const cd = stripComments(cardSrc2)

  const leftovers = [
    ['注入规则', /PLAIN_PROGRESS_RULE/.test(h)],
    ['注入分支', /plainStepCounters/.test(h)],
    ['开关路由', /plain-inject-state/.test(ha)],
    ['store 读写法', /PlainInjectEnabled/.test(st)],
    ['config 字段', /plainInject/.test(ty)],
    ['extractIntent', /export function extractIntent/.test(tls)],
    ['nowLabel', /nowLabel/.test(tls)],
    ['开关 UI', /plainInjectLabel|pushChannel\('plainEnabled'/.test(tg)],
    ['开关文案', /plainInject/.test(lc)],
    ['面板传参', /plainIntent/.test(pn)],
    ['卡片探针', /nowLabel|timeline\.intent/.test(cd)],
  ].filter(([, hit]) => hit)

  if (leftovers.length > 0) {
    fail(`「执行过程播报」通道已整条下掉，这些残留必须清干净：${leftovers.map(([n]) => n).join(' / ')}`)
  } else {
    pass('执行过程播报通道已整条下掉（注入 / 开关 / 路由 / store / extractIntent / nowLabel 全清）')
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

  // 标题行右上角的一键删除（删本会话新增全集）。四件事必须同时成立，缺一条这套
  // 交互就有静默失效面：按钮在标题行里、点第一下只进确认态（真删走 clearSessionNew）、
  // 确认态带自动回退、删光后卡片先收拢再卸载。
  if (!memorySrc.includes('kr-memory__clear-act')) {
    fail('记忆卡标题行必须挂一键删除按钮（.kr-memory__clear-act）')
  } else if (!memorySrc.includes('const [clearPhase, setClearPhase] = useState<ClearPhase>(\'idle\')')) {
    fail('一键删除必须有 idle / confirm / deleting 三段状态（clearPhase）')
  } else if (!/CLEAR_CONFIRM_MS = \d+/.test(memorySrc) || !memorySrc.includes('setClearPhase(\'confirm\')')) {
    fail('一键删除必须先二次确认，且确认态带自动回退（CLEAR_CONFIRM_MS）')
  } else if (!memorySrc.includes('data-leaving') || !/kr-memory-row-out/.test(code)) {
    fail('一键删除必须带行级错峰退场（data-leaving + kr-memory-row-out）')
  } else if (!memorySrc.includes('data-collapsing') || !/kr-memory-card-out/.test(code)) {
    fail('删光后卡片必须收拢退场（data-collapsing + kr-memory-card-out）')
  } else if (!/\.kr-memory__clear-act \{[^}]*opacity: 0/.test(code)) {
    fail('.kr-memory__clear-act 必须常态隐藏、hover/聚焦才浮现（破坏性操作不常驻）')
  } else {
    pass('记忆卡标题行一键删除：二次确认 + 自动回退 + 行错峰退场 + 卡片收拢')
  }
}

/*
 * 用时读数 = **官方那条行**，不在总结卡里（用户 2026-10-05 三轮口径的最终结论：
 * 「给总结卡加个用时」→「用官方的」→「不要放总结里，就用官方的那种」）。
 *
 * 钉四件事，任何一件回归用户都会当场看见：
 *  1. 插件**不得再仿造**读数（dtt__card-elapsed / useTurnElapsed / formatOfficialElapsed
 *     与那个文件一起清干净）—— 仿造件与官方那行会同时在屏上出现，是两句话；
 *  2. KR 模式的 turn-process 座位要把官方组件**同时渲染**出来（活动卡 + 官方行），
 *     官方组件在 turn 未 closed 时自己返回 null，所以进行中不会多出一行；
 *  3. `[data-turn-process]` 不得出现在 KR 的隐藏名单里 —— 它就是用户要的那条读数；
 *     同时 `[data-step-process]` 必须在名单里（整轮过程内容仍不给回左侧对话流）；
 *  4. 总结卡外壳本身保持纯正文（没有任何头部统计件）。
 */
{
  const cardSrc = readFileSync(resolve(ROOT, 'src/client/flow-card.tsx'), 'utf8')
  const shadowSrc = readFileSync(resolve(ROOT, 'src/client/tool-summary/TurnProcessShadowView.tsx'), 'utf8')
  const krStyleSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/styles.ts'), 'utf8')
  const styleSrc = readFileSync(resolve(ROOT, 'src/client/styles.ts'), 'utf8')
  const hookPath = resolve(ROOT, 'src/client/thinking/use-turn-elapsed.ts')
  // 只取**选择器**那一段（注释里也会提到这些属性名，必须排除掉）。
  const hideRule = krStyleSrc.slice(
    krStyleSrc.indexOf('body[data-dsh-kr-chat="true"] .dts__process'),
    krStyleSrc.indexOf('[data-step-process],', krStyleSrc.indexOf('body[data-dsh-kr-chat="true"] .dts__process')) + 30,
  )
  // 注释里会出现这些名字（当初为什么删的说明），比对前先把注释剥掉。
  const bareCard = cardSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
  const bareStyle = styleSrc.replace(/\/\*[\s\S]*?\*\//g, ' ')
  if (/dtt__card-elapsed|useTurnElapsed|formatOfficialElapsed/.test(bareCard + bareStyle)) {
    fail('总结卡里的仿造用时读数必须整块删除（dtt__card-elapsed / useTurnElapsed 不得残留）')
  } else if (existsSync(hookPath)) {
    fail('use-turn-elapsed.ts 已无引用，必须删除（否则下一个人会以为它还在用）')
  } else if (!/OfficialProcessRow|getOfficialTurnProcessNodeView/.test(shadowSrc)) {
    fail('KR 模式必须把官方 turn-process 组件渲染出来（那条「已完成，用时」读数归官方）')
  } else if (!/\{OfficialProcessRow\s*\?/.test(shadowSrc) || !/<OfficialProcessRow/.test(shadowSrc)) {
    fail('KR 分支必须与活动卡并列渲染官方过程行（缺了那条「已完成，用时」读数就没了）')
  } else if (!/foldable: false/.test(shadowSrc) || !/hasContent: false/.test(shadowSrc)) {
    fail('交给官方的 turnProcess 必须折成 foldable:false + hasContent:false（否则点一下会把整轮过程摊进对话流）')
  } else if (hideRule.includes('[data-turn-process]')) {
    fail('[data-turn-process] 不得再被 KR 隐藏（它就是官方那条用时读数）')
  } else if (!hideRule.includes('[data-step-process]')) {
    fail('[data-step-process] 必须仍在 KR 隐藏名单里（整轮过程内容不给回左侧对话流）')
  } else if (/dtt__card-elapsed|data-has-elapsed/.test(bareStyle)) {
    fail('styles.ts 里的仿造读数样式（含 [data-has-elapsed] 让位规则）必须删干净')
  } else {
    pass('用时读数归官方：仿造件已删 + KR 渲染官方行 + [data-turn-process] 放行 / [data-step-process] 仍隐藏')
  }
}

// ── 总结卡外观开关（框 + 阴影）────────────────────────────────────────────
//
// 用户要求：Seeker 对话流总结卡的框与阴影要做成开关，开关放在 composer 那枚
// 「内置提示词通道」按钮（PromptIcon）的卡片里。
//
// 这套东西错了**一声不响**：属性名写歪、CSS 选择器写歪、或者特异性被上面那条
// 深色主题规则压住，开关拨下去界面毫无反应——没有异常、没有日志。所以三件事
// 都要断言：行为（属性真的挂/摘）、CSS（关掉时框影真的让掉）、接线（开关真在
// 那张卡里且能拨动）。
{
  const styleSrc = readFileSync(resolve(ROOT, 'src/client/styles.ts'), 'utf8')
  const toggleSrc = readFileSync(resolve(ROOT, 'src/client/triad/memory/Toggle.tsx'), 'utf8')
  const entrySrc = readFileSync(resolve(ROOT, 'src/client/index.ts'), 'utf8')
  // 大盘设置抽屉：外观偏好开关的现居地（2026-10-15 从 composer 那张卡迁来）。
  const drawerSrcRaw = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPanelSettings.tsx'), 'utf8')
  // 注释里会提到这些选择器（当初为什么这么写的说明），比对前先把注释剥掉。
  const bareStyle = styleSrc.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const bareToggle = toggleSrc.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const bareDrawer = drawerSrcRaw.replace(/\/\*[\s\S]*?\*\//g, ' ')

  // 1) 行为级：拨一下，body 属性真的挂上 / 摘掉。
  if (typeof mod.setReplyCardChromeEnabled !== 'function' || typeof mod.REPLY_PLAIN_ATTR !== 'string') {
    fail('缺少 setReplyCardChromeEnabled / REPLY_PLAIN_ATTR 导出（开关状态不可断言）')
  } else {
    const attr = mod.REPLY_PLAIN_ATTR
    const has = () => sandbox.document.body.getAttribute(attr) !== null
    mod.installReplyCardChrome()
    // 默认必须是「有框有影」：当前观感是用户认可的成熟形态，升级不该改变它。
    if (has()) {
      fail('默认应为有框有影（body 不该带 data-dsh-reply-plain）')
    } else {
      mod.setReplyCardChromeEnabled(false)
      const offOk = has()
      mod.setReplyCardChromeEnabled(true)
      const onOk = !has()
      if (!offOk) fail('关掉开关后 body 未挂 data-dsh-reply-plain（CSS 不会生效，界面毫无反应）')
      else if (!onOk) fail('重新打开开关后 data-dsh-reply-plain 未摘掉（框影回不来）')
      else pass('总结卡外观开关：关→body 挂 data-dsh-reply-plain，开→摘掉（默认开）')
    }
    // 订阅通知：卡片里的开关靠它刷新，不通知则 UI 与真实状态脱节。
    let notified = 0
    const unsub = mod.subscribeReplyCardChrome(() => { notified += 1 })
    mod.setReplyCardChromeEnabled(false)
    mod.setReplyCardChromeEnabled(true)
    unsub()
    if (notified !== 2) fail(`订阅者应收到 2 次通知（实得 ${notified}）`)
    else pass('总结卡外观开关：变化会通知订阅者（开关 UI 能跟随）')
  }

  // 1b) 工具调用卡展示开关：同款纯呈现偏好（localStorage + 订阅），行为级断言。
  //     判据错了界面毫无反应，必须钉住：默认开、拨关生效、订阅收到通知。
  if (typeof mod.setToolCallsVisible !== 'function' || typeof mod.toolCallsVisible !== 'function') {
    fail('缺少 setToolCallsVisible / toolCallsVisible 导出（工具调用卡开关不可断言）')
  } else {
    mod.installToolCallsVisible()
    if (mod.toolCallsVisible() !== true) {
      fail('工具调用卡开关默认必须是开（恢复这张卡就是用户要的形态）')
    } else {
      mod.setToolCallsVisible(false)
      const offOk = mod.toolCallsVisible() === false
      mod.setToolCallsVisible(true)
      const onOk = mod.toolCallsVisible() === true
      if (!offOk) fail('关掉工具调用卡开关后 toolCallsVisible() 未变 false（右栏不会隐藏）')
      else if (!onOk) fail('重新打开工具调用卡开关后未回到 true')
      else pass('工具调用卡展示开关：默认开，拨关/拨开即时生效')
    }
    let notified = 0
    const unsubTools = mod.subscribeToolCallsVisible(() => { notified += 1 })
    mod.setToolCallsVisible(false)
    mod.setToolCallsVisible(true)
    unsubTools()
    if (notified !== 2) fail(`工具调用卡开关订阅者应收到 2 次通知（实得 ${notified}）`)
    else pass('工具调用卡展示开关：变化会通知订阅者（右栏与开关 UI 能跟随）')
    // 持久化：换一份 Map 版 localStorage 模拟浏览器盘，set 关 → 重新 install
    // （= 刷新页面 / 重启 DSH 后模块重新读盘）必须读回关。判据错了表现为
    // 「拨了开关刷新就丢」，用户感知极强，必须钉住。
    {
      const disk = new Map()
      const savedLs = sandbox.localStorage
      sandbox.localStorage = {
        getItem: (k) => (disk.has(k) ? disk.get(k) : null),
        setItem: (k, v) => { disk.set(k, String(v)) },
        removeItem: (k) => { disk.delete(k) },
      }
      try {
        mod.setToolCallsVisible(false)
        if (disk.get('dsh.chat_plus.tool_calls_visible') !== '0') {
          fail('工具调用卡开关未落盘 localStorage（刷新即丢，不持久）')
        } else {
          mod.installToolCallsVisible() // 模拟 reload：模块重新读盘
          const persisted = mod.toolCallsVisible() === false
          mod.setToolCallsVisible(true)
          mod.installToolCallsVisible()
          const backOn = mod.toolCallsVisible() === true
          if (!persisted) fail('刷新后工具调用卡开关未读回「关」（持久化链断）')
          else if (!backOn) fail('恢复开后 reload 未读回「开」')
          else pass('工具调用卡展示开关：落盘 + reload 读回（持久化链完整，全局生效）')
        }
      } finally {
        sandbox.localStorage = savedLs
        mod.installToolCallsVisible()
      }
    }
    // 装配链：大盘设置抽屉里有这一行、KrAgentPanel 消费它、index 初始化它。
    //
    // 2026-10-15：这一行原先住在 Toggle.tsx（composer 那张卡），随卡片删除迁到
    // kr-chat/KrPanelSettings.tsx，断言对象随之迁移。
    if (!/label="工具调用卡"/.test(bareDrawer) || !/setToolCallsVisible\(!toolCallsOn\)/.test(bareDrawer)) {
      fail('大盘设置抽屉缺「工具调用卡」开关行（label / onToggle 未接 setToolCallsVisible）')
    } else if (!/toolCallsOn/.test(readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8'))) {
      fail('KrAgentPanel 未消费工具调用卡展示开关（拨了没反应）')
    } else if (!/installToolCallsVisible/.test(entrySrc)) {
      fail('index.ts 未初始化 installToolCallsVisible（刷新后不读盘、跨窗口不同步）')
    } else {
      pass('工具调用卡展示开关：抽屉行 / 大盘消费 / apply 初始化三处在位')
    }
  }

  // 2) CSS：关掉时描边与投影都要让掉，且**保留边框宽度**（否则正文会位移）。
  const plainAt = bareStyle.indexOf('body[data-dsh-reply-plain]')
  if (plainAt < 0) {
    fail('styles.ts 缺少 body[data-dsh-reply-plain] .dtt__card--reply 规则（关掉开关不会有任何视觉变化）')
  } else {
    const rule = bareStyle.slice(plainAt, bareStyle.indexOf('}', plainAt) + 1)
    if (!/border-color:\s*transparent/.test(rule)) {
      fail('关掉时必须用 border-color:transparent 让掉描边（用 border:none 会让正文位移 1px）')
    } else if (!/box-shadow:\s*none/.test(rule)) {
      fail('关掉时必须让掉 box-shadow')
    } else if (/\bborder\s*:\s*none/.test(rule)) {
      fail('关掉时不得写 border:none —— 边框占位消失会让正文横向位移')
    } else {
      pass('总结卡外观开关：关掉时描边转透明 + 投影归零，且保留 1px 占位不位移')
    }
    // 深色主题那条规则在它之前，靠书写顺序取胜：顺序反了深色下关不干净。
    const darkAt = bareStyle.indexOf('body[data-ds-dark-theme] .dtt__card--reply')
    if (darkAt < 0) fail('样式里找不到深色主题的总结卡规则（本断言的前提已失效，需复核）')
    else if (darkAt > plainAt) fail('data-dsh-reply-plain 规则必须写在深色主题规则之后（否则深色下框影让不掉）')
    else pass('总结卡外观开关：规则顺序正确（深色主题下同样让得掉）')
    // 过渡：颜色与阴影都要能插值，切换才是渐变而不是跳变。
    if (!/\.dtt__card--reply\s*\{[^}]*transition:[^}]*border-color/.test(bareStyle)) {
      fail('总结卡缺少 border-color/box-shadow 的 transition（切换会「啪」一下跳变，不是渐变）')
    } else {
      pass('总结卡外观开关：框影切换走过渡（渐变掉，不是跳变）')
    }
  }

  // 3) 接线：开关真的在**大盘设置抽屉**里，且走的是本地状态而不是注入通道。
  //
  // 2026-10-15 之前这三条断言的对象是 Toggle.tsx 的 BuiltinToggle（composer 那张
  // 「内置提示词通道」卡）。用户要求删掉那张卡、把设置挪到 Seeker 旁边之后，
  // 承载者换成 kr-chat/KrPanelSettings.tsx，断言对象随之迁移 —— 判据本身不变：
  // 一行独立开关、接本地状态、busy 恒 false（写 localStorage 没有网络往返）。
  const drawerSrc = bareDrawer
  if (!/setReplyCardChromeEnabled\s*\(/.test(drawerSrc)) {
    fail('大盘设置抽屉里没有接上总结卡外观开关（用户点不到）')
  } else if (!/on=\{chromeOn\}/.test(drawerSrc)) {
    fail('总结卡外观开关的 on 必须接本地状态 chromeOn（接错则开关显示与真实不一致）')
  } else if (!/setReplyCardChromeEnabled\(!chromeOn\)/.test(drawerSrc)) {
    fail('总结卡外观开关的 onToggle 必须写本地状态（不得误接 host 写入）')
  } else {
    pass('总结卡外观开关：接在大盘设置抽屉里 + 本地状态')
  }
  // 三条 localStorage 行的 busy 必须恒为 false：它们同步落盘、没有网络往返，
  // 写成 busy={busy} 会让它们在别的 host 通道保存时莫名变灰、点不动。
  const localRows = [drawerSrc.match(/busy=\{false\}/g)?.length ?? 0]
  if (localRows[0] < 3) {
    fail(`三条外观偏好行都该 busy={false}（实得 ${localRows[0]} 处）——写成 busy 会让它们被 host 保存连坐变灰`)
  } else {
    pass(`外观偏好行 busy 恒 false（${localRows[0]} 处：总结卡外框 / 工具调用卡 / 操作面板）`)
  }
  // 抽屉必须分组：注入通道 / 按工作区的记录开关 / 纯外观 / 任务清单，
  // 四者混一列会被读成同一种能力。抽屉里的组标题是**硬编码中文**（与它其余各行
  // 同款），不走 i18n —— 断言按实际写法钉。
  //
  // 2026-10-25 新增「任务清单」组：「回合结束自动收口」原来住在「提示词通道」组里，
  // 而它自己的说明就写着「它不改提示词，只动任务清单的状态」—— 语义自相矛盾的
  // 分组，读者扫到它时已经被前四行带进「这组都改提示词」的预期。一行也值得单开
  // 一个组：组的判据是「同一种东西」，不是「行数够多」。
  if (!/kr-settings__group-title">提示词通道|>提示词通道</.test(drawerSrc)) {
    fail('大盘设置抽屉缺「提示词通道」组标题')
  } else if (!/>工作区记忆</.test(drawerSrc)) {
    // 「项目记忆记录」是**写入侧**且**按工作区**存：并进「提示词通道」（读取侧、全局单值）
    // 会被读成同一种能力，用户关掉它以为只是「不注入」，实际是整个工作区不再积累记忆。
    fail('大盘设置抽屉缺「工作区记忆」组标题（写入侧开关被混进注入组，语义会被读错）')
  } else if (!/>展示</.test(drawerSrc)) {
    fail('大盘设置抽屉缺「展示」组标题（外观偏好会被读成一条注入能力）')
  } else if (!/>任务清单</.test(drawerSrc)) {
    fail('大盘设置抽屉缺「任务清单」组标题（自动收口不改提示词，不能留在提示词通道组里）')
  } else if (/>提示词通道<[\s\S]{0,4000}?回合结束自动收口/.test(drawerSrc.replace(/<\/?div[^>]*>/g, '\u0001'))) {
    // 分区之后写反了（把收口又挪回提示词通道组里）：允许跨子节点的粗略检查，
    // 只要求这两样东西不在同一个 4000 字符窗口里同时出现。
    fail('「回合结束自动收口」不得回到「提示词通道」组（它不改提示词，分组要与行为一致）')
  } else {
    pass('大盘设置抽屉：四组分区（提示词通道 / 任务清单 / 展示 / 工作区记忆区块）在位')
  }
  // 初始化必须在 apply 阶段跑（挂晚了会先画一遍带框卡片再闪成纯正文）。
  if (!/installReplyCardChrome/.test(entrySrc.replace(/\/\*[\s\S]*?\*\//g, ' '))) {
    fail('client/index.ts 的 apply 未调用 installReplyCardChrome（刷新后开关不生效）')
  } else {
    pass('总结卡外观开关：在 apply 阶段初始化（首帧即正确形态，不闪）')
  }
}

// 用时读数已从对话流那张「Seeker 正在…」活动卡上撤掉：卡片只讲「正在做什么」，
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
//
// 2026-10-24 起改查**组件源码**而不是 bundle：那张「Seeker 正在分析…」活动卡已按
// 用户要求从对话流撤掉（TurnProcessShadowView 不再挂 KrActivityCardGate），组件
// 本体与样式全部保留以便随时恢复 —— 所以它不再出现在产物里，但实现仍然必须正确。
const liveCardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrLiveActivityCard.tsx'), 'utf8')
if (!liveCardSrc.includes('avatarMenuPosition') || !code.includes('.kr-agent-avatar-menu {\n  position: fixed;')) {
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
//
// 断言对象是**组件源码**（cardSrc）而非 bundle：活动卡已不挂载，产物里没有它。
if (!liveCardSrc.includes('useCrossfadeText')
  || !liveCardSrc.includes('kr-agent-mini-action-stack')
  || !code.includes('kr-agent-action-in')
  || !code.includes('kr-agent-action-out')
  || !/data-phase=\{layer\.exiting \? 'out' : 'in'\}/.test(liveCardSrc)
  || !liveCardSrc.includes('kr-agent-dots')
  // 三颗 <i> 必须是三个独立元素（源码里的 <i /><i /><i /> 形态）。
  || !/className="kr-agent-dots"[\s\S]{0,80}?<i \/><i \/><i \/>/.test(liveCardSrc)
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

// 十三枚槽位：对话增强六枚（turn-process / assistant-step keyed / 截图按钮 /
// download toolview / kr-todo-bridge / tools-gate 胶囊）+ 融合工作台五枚
// （记忆 / 能力 / 邮箱三个工作台各两枚：main 页 + sidebar.panellist 菜单行，
// 共 6；
// skill toolview 一枚）+ 供应商设置页一枚（settings.section / provider-hub，
// 2026-10-05 从工作台 Tab 撤回官方设置弹窗）
// + 首 token 平均平铺桥一枚（input.dock / dsh-stats-ttft-flat，只做 DOM 追认）。
// 座位 id/order/locale 全部原样保留；原 automation-notifier 随自动化模块一起下线，
// ui-font 通用设置行随「界面字体」整块移除。
//
// 2026-10-15：composer 那枚 dsh-memory-builtin-toggle（内置提示词通道卡，order 98）
// 按用户要求删除，槽位从 13 → 12。它的 9 个开关迁到 Seeker 右栏「大盘设置」抽屉，
// 入口是顶栏 Seeker 标签右侧的齿轮（裸 DOM 注入，**不占槽位**）。
const cell = (key) => registeredSlots.find((s) => s?.slot === 'conversation.chat.node' && s?.key === key)
// 2026-10-20：浏览器标志**不占任何座位** —— 标题栏胶囊整块删除（用户反馈不好看）。
// 2026-10-25 起它住在**操作面板卡头**（Seeker 文字右侧），仍不占座位：
// 那是插件自己的 React 树，不是官方槽位。若哪天有人把胶囊座位加回来，计数会立刻红。
// 2026-10-23：composer 那枚 dsh-memory-inject-toggle（记忆注入卡，order 99）
// 按用户要求删除，槽位从 12 → 11。它的开关能力仍在 Seeker 右栏「大盘设置」抽屉里。
// 2026-10-25：ui-font 通用设置行（settings.general.item / order 12）随「界面字体」
// 功能恢复而回归，槽位从 11 → 12。
if (registeredSlots.length !== 12) {
  fail(`expected 12 slot registrations, got ${registeredSlots.length}: ${JSON.stringify(registeredSlots)}`)
} else {
  pass('registered 12 seats (6 chat-plus + 4 triad + 1 provider settings section + 1 ttft flat bridge + 1 ui-font general row)')
}

// 工具闸门卡片：挂在输入栏工具行**左端**（与记忆注入开关同一排），order 100。
// 曾经挂在 input.right / order 6 —— 那里紧邻模型选择器，实测两枚胶囊的文字与
// 模型名重叠（用户实机截图确认）。左端才是「输入区能力开关」的既有座位。
const gateSeat = registeredSlots.find((s) => s?.slot === 'conversation.input.left' && s?.id === 'dsh-tools-gate')
if (gateSeat === undefined) {
  fail(`missing tools-gate seat (conversation.input.left / dsh-tools-gate)，实得 ${JSON.stringify(registeredSlots.filter(s => s?.id === 'dsh-tools-gate'))}`)
} else if (gateSeat.order !== 100) {
  fail(`tools-gate 座位 order 应为 100（排在记忆开关 98/99 之后），实得 ${gateSeat.order}`)
} else {
  pass('tools-gate 卡片座位：conversation.input.left / order 100')
}
// 卡片而非散落胶囊：一个容器装两个开关项。
if (!code.includes('dsh-gate-card') || !code.includes('dsh-gate-item')) {
  fail('client bundle 缺少工具闸门卡片结构（dsh-gate-card / dsh-gate-item）')
} else if (code.includes('dsh-gate-chip')) {
  fail('旧的独立胶囊样式（dsh-gate-chip）不该再出现')
} else {
  pass('工具闸门渲染为一张卡片（dsh-gate-card 内含 dsh-gate-item）')
}
// 布局硬约束（实机踩过，两次都表现为「页面上只剩一条竖线」，不报错）：
//  1. 卡片必须 flex:none —— 槽位容器是 display:contents，真正定宽的是官方工具行
//     （实测 234px 可用），可压缩的卡片会被压成 2px；
//  2. 卡片上不能挂 container-type —— 容器查询基准是自身内容宽度，而宽度又由内容
//     决定，被挤窄就触发「隐藏文字」规则，自噬到只剩图标。
{
  const cardRule = /\.dsh-gate-card\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
  const itemRule = /\.dsh-gate-item\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
  if (cardRule === '') fail('未找到 .dsh-gate-card 规则')
  else if (!/flex:\s*none/.test(cardRule)) fail('.dsh-gate-card 必须 flex:none（否则被工具行压成 2px，页面上只剩一条竖线）')
  else if (/container-type/.test(cardRule)) fail('.dsh-gate-card 不能挂 container-type（容器查询会自噬：变窄→隐藏文字→更窄）')
  else if (!/width:\s*max-content/.test(cardRule)) fail('.dsh-gate-card 需要 width:max-content（内容定宽）')
  else if (!/flex:\s*none/.test(itemRule)) fail('.dsh-gate-item 必须 flex:none')
  else pass('工具闸门布局硬约束在位（卡片与开关项 flex:none、无容器查询、width:max-content）')
  // 名称必须视觉隐藏但留在无障碍树里（工具行放不下中文标签）。
  const labelRule = /\.dsh-gate-item__label\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
  if (labelRule === '') fail('未找到 .dsh-gate-item__label 规则（名称需视觉隐藏但可被读屏念出）')
  else if (!/clip-path/.test(labelRule) || !/position:\s*absolute/.test(labelRule)) {
    fail('.dsh-gate-item__label 应为视觉隐藏（absolute + clip-path），而非 display:none（后者读屏也念不到）')
  } else {
    pass('工具闸门名称视觉隐藏但保留在无障碍树（读屏可念，鼠标说明走 title）')
  }
}
// 契约：卡片与 /指令 读写同一路由；两条命令名与 host 侧分组 key 逐字一致。
if (!code.includes('/api/chat-flow/tools-gate')) {
  fail('client bundle 缺少 tools-gate 状态路由调用')
} else {
  pass('client bundle 调用 host 状态路由 /api/chat-flow/tools-gate')
}
for (const motion of ['dsh-gate-sheen', 'dsh-gate-shake', 'dsh-gate-pulse', 'dsh-gate-card-in', 'prefers-reduced-motion']) {
  if (!code.includes(motion)) fail(`工具闸门动效缺失：${motion}`)
}
pass('工具闸门动效齐备（卡片入场 + 扫光 + 抖动 + 脉冲 + reduced-motion 兜底）')

// `/` 菜单图标：宿主命令没有官方 icon 通道（candidates() 只认 6 个内置
// definitionId），且同名 contribution 会抛 collides 把菜单炸掉。所以走
// MutationObserver 打属性 + CSS mask。
for (const piece of ['data-dsh-gate-icon', 'dsh-gate-icon-computer', 'dsh-gate-icon-browser', 'MutationObserver']) {
  if (!code.includes(piece)) fail(`/ 菜单图标链路缺失：${piece}`)
}
pass('/ 菜单图标链路齐备（属性标记 + CSS mask 图标 + 观察器维持）')

// 判据本身（真实实现，不是复刻）：按官方菜单行的 DOM 形状决定哪些行该补图标。
// 判据错了不报错、只多几个错图标，所以必须直接断言。
if (typeof mod.gateIconForRow !== 'function') {
  fail('client 入口未导出 gateIconForRow（菜单图标判据无法被测试钉住）')
} else {
  // 造一行：children = [类名, 文本][]，firstElementChild 取第一个。
  const mkRow = (children) => {
    const kids = children.map(([cls, text]) => ({ className: cls, textContent: text }))
    return {
      firstElementChild: kids[0] ?? null,
      attrs: {},
      hasAttribute(k) { return k in this.attrs },
      setAttribute(k, v) { this.attrs[k] = v },
    }
  }
  const hit = []
  for (const name of mod.GATE_ICON_COMMANDS) {
    const got = mod.gateIconForRow(mkRow([['itemName', name], ['itemDescription', `开关（/${name} on|off）`]]))
    if (got !== name) fail(`「${name}」行应命中，实得 ${JSON.stringify(got)}`)
    else hit.push(name)
  }
  if (hit.length === mod.GATE_ICON_COMMANDS.length) {
    pass(`命中两条指令行（${hit.join(', ')}）`)
  }
  // 官方命令行不被误标。
  const others = ['goal', 'plan', 'compact', 'permission', 'export', 'feedback']
  const wrong = others.filter((n) => mod.gateIconForRow(mkRow([['itemName', n], ['itemDescription', 'x']])) !== null)
  if (wrong.length > 0) fail(`官方命令行被误标：${wrong.join(', ')}`)
  else pass(`${others.length} 条官方命令行都不被误标`)
  // 关键回归：描述里提到命令名的普通行不能被误标（判据必须是严格相等）。
  const decoy = mkRow([['itemName', 'some-other-cmd'], ['itemDescription', '参考 /computer-use on|off 的写法']])
  if (mod.gateIconForRow(decoy) !== null) {
    fail('描述里提到命令名的普通行被误标 —— 判据必须严格相等而非包含')
  } else {
    pass('描述里提到命令名的普通行不被误标（严格相等判据）')
  }
  // 官方已给图标的行（第一个子元素是空 itemIcon）→ 不补，避免双图标。
  if (mod.gateIconForRow(mkRow([['itemIcon', ''], ['itemName', 'computer-use']])) !== null) {
    fail('官方已给图标的行不该再补（会出现双图标）')
  } else {
    pass('官方已给图标的行不重复补')
  }
  // 幂等：已标记的行不重复计数。
  const rows = [
    mkRow([['itemName', 'computer-use']]),
    mkRow([['itemName', 'goal']]),
    mkRow([['itemName', 'browser-use']]),
  ]
  const firstPass = mod.decorateGateMenuRows({ querySelectorAll: () => rows })
  const secondPass = mod.decorateGateMenuRows({ querySelectorAll: () => rows })
  if (firstPass !== 2 || secondPass !== 0) {
    fail(`菜单图标幂等失败：首次 ${firstPass}（应 2）、二次 ${secondPass}（应 0）`)
  } else {
    pass('菜单图标幂等：首次标 2 行、二次标 0 行（观察器重复触发不反复改 DOM）')
  }
}

// 统一工作台页面：本体挂官方 `main`（key=workbench），侧边栏菜单行 `sidebar.panellist`（id=workbench）。
const wbPage = registeredSlots.find((s) => s?.slot === 'main' && s?.key === 'workbench')
const wbRow = registeredSlots.find((s) => s?.slot === 'sidebar.panellist' && s?.id === 'workbench')
if (wbPage === undefined) fail('missing unified workbench page seat main / workbench')
else if (wbRow === undefined) fail('missing unified sidebar row seat sidebar.panellist / workbench')
else if (wbRow.order !== 20) fail(`sidebar row workbench order = ${wbRow.order}, expected 20`)
else pass('seat main / workbench + sidebar.panellist / workbench @ order 20')

// 供应商设置页：官方设置弹窗的 `settings.section`，id / order / label 逐字保留
// （2026-10-05 用户点名把供应商配置与代理放回设置里，此前一轮曾搬进工作台 Tab）。
const supplierSection = registeredSlots.find((s) => s?.slot === 'settings.section' && s?.id === 'provider-hub')
if (supplierSection === undefined) fail('missing provider seat settings.section / provider-hub（设置里没有供应商页）')
else if (supplierSection.order !== 10) fail(`provider section order = ${supplierSection.order}, expected 10`)
else pass('seat settings.section / provider-hub @ order 10（供应商配置 + 代理在设置里）')

const downloadSeat = registeredSlots.find((s) => s?.slot === 'tool.call.toolview' && s?.key === 'download')
if (downloadSeat === undefined) fail('missing keyed toolview seat tool.call.toolview / download')
else pass('seat tool.call.toolview / download (keyed by wire tool name)')

const skillSeat = registeredSlots.find((s) => s?.slot === 'tool.call.toolview' && s?.key === 'skill')
if (skillSeat === undefined) fail('missing triad seat tool.call.toolview / skill')
else pass('seat tool.call.toolview / skill (triad)')

// 2026-10-23：composer 的「记忆注入」座位（dsh-memory-inject-toggle / order 99）
// 按用户要求整块删除（原话「算了这个对话框内的记忆开关给删掉吧」）。这里反向断言
// 它**不再**被注册 —— 复活即意味着对话框里又长出那张重复的卡。
const memoryToggle = registeredSlots.find((s) => s?.slot === 'conversation.input.left' && s?.id === 'dsh-memory-inject-toggle')
if (memoryToggle !== undefined) {
  fail('dsh-memory-inject-toggle 座位已删除（开关迁至大盘设置抽屉），不该再注册')
} else {
  pass('seat conversation.input.left / dsh-memory-inject-toggle 已下线（开关迁至大盘设置抽屉）')
}

// 2026-10-15：composer 的「内置提示词通道」座位（dsh-memory-builtin-toggle / order 98）
// 按用户要求整块删除，其 9 个开关迁到 Seeker 右栏「大盘设置」抽屉。这里反向断言
// 它**不再**被注册 —— 复活即意味着对话区又长出那张重复的卡。
const builtinToggle = registeredSlots.find((s) => s?.slot === 'conversation.input.left' && s?.id === 'dsh-memory-builtin-toggle')
if (builtinToggle !== undefined) {
  fail('dsh-memory-builtin-toggle 座位已删除（开关迁到 Seeker 右栏设置抽屉），不该再注册')
} else {
  pass('seat conversation.input.left / dsh-memory-builtin-toggle 已下线（开关迁至大盘设置抽屉）')
}

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

// 首 token 平均平铺桥：与 kr-todo-bridge 同槽的隐形座位，只读投影 + DOM 追认，
// 不占视觉行、不 shadow 官方 StatsPills。
const ttftSeat = registeredSlots.find((s) => s?.slot === 'conversation.input.dock' && s?.id === 'dsh-stats-ttft-flat')
if (ttftSeat === undefined) fail('missing input.dock seat conversation.input.dock / dsh-stats-ttft-flat')
else if (ttftSeat.order !== 1000) fail(`ttft flat bridge order = ${ttftSeat.order}, expected 1000（排在桥之后、不占行）`)
else pass('seat conversation.input.dock / dsh-stats-ttft-flat @ order 1000 (ttft flat bridge)')

// 首 token 平均平铺纯逻辑：平均值、紧凑时长、窗口回退三条都必须可断言。
// 这三条错了不报错，只会让状态栏显示错的数或干脆不显示。
if (typeof mod.ttftAverageMs !== 'function' || typeof mod.ttftFlatText !== 'function'
  || typeof mod.formatFlatDuration !== 'function' || typeof mod.foldWindowTtft !== 'function'
  || typeof mod.syncTtftFlat !== 'function' || typeof mod.TtftFlatBridge !== 'function'
  || typeof mod.injectTtftFlatStyles !== 'function') {
  fail('缺少 ttft 平铺纯逻辑导出（ttftAverageMs / ttftFlatText / formatFlatDuration / foldWindowTtft / syncTtftFlat / TtftFlatBridge / injectTtftFlatStyles）')
} else {
  const ttftReasons = []
  // ① 平均：9.8 秒样例与空口径。
  if (mod.ttftAverageMs({ ttftMs: 19600, ttftSteps: 2 }) !== 9800) ttftReasons.push('平均值应为合计除以步数')
  if (mod.ttftAverageMs({ ttftMs: 0, ttftSteps: 0 }) !== null) ttftReasons.push('步数为 0 应返回 null（不渲染）')
  if (mod.ttftAverageMs(undefined) !== null) ttftReasons.push('投影缺席应返回 null')
  // ② 文本：中文前缀与 60 秒分界。
  const zhSec = (k, p) => k === 'duration.compactSeconds' ? `${p.seconds}秒` : `${p.minutes}分${p.seconds}秒`
  if (mod.ttftFlatText({ ttftMs: 9800, ttftSteps: 1 }, zhSec) !== '首 token 9.8秒') {
    ttftReasons.push(`9.8 秒样例文本不对，实得 ${mod.ttftFlatText({ ttftMs: 9800, ttftSteps: 1 }, zhSec)}`)
  }
  const zhLong = mod.ttftFlatText({ ttftMs: 112000, ttftSteps: 1 }, zhSec)
  if (zhLong !== '首 token 1分52秒') ttftReasons.push(`112 秒应进分秒，实得 ${zhLong}`)
  const enSec = (k, p) => k === 'duration.compactSeconds' ? `${p.seconds}s` : `${p.minutes}m${p.seconds}s`
  if (mod.ttftFlatText({ ttftMs: 9800, ttftSteps: 1 }, enSec) !== 'TTFT 9.8s') {
    ttftReasons.push('英文环境前缀应为 TTFT（不新增 locale key）')
  }
  if (mod.ttftFlatText({ ttftMs: 0, ttftSteps: 0 }, zhSec) !== null) ttftReasons.push('无数据时文本应为 null（调用方卸载读数）')
  // ③ 窗口回退：只认双时间戳齐全的 assistant 步子。
  const folded = mod.foldWindowTtft([
    { kind: 'assistant', timing: { stepStartTime: 0, firstTokenTime: 9800 } },
    { kind: 'assistant', timing: { stepStartTime: 0, firstTokenTime: 10200 } },
    { kind: 'tool-result', callTime: 0, time: 1 },
    { kind: 'assistant', timing: { stepStartTime: null, firstTokenTime: 1 } },
  ])
  if (folded === undefined || folded.ttftSteps !== 2 || folded.ttftMs !== 20000) {
    ttftReasons.push(`窗口回退合计不对，实得 ${JSON.stringify(folded)}`)
  }
  if (mod.foldWindowTtft(undefined) !== undefined) ttftReasons.push('快照缺席回退应为 undefined（走无读数分支）')
  // ④ 样式在册：读数只继承 pill 形态，自身只定分隔与入场；动效必须有兜底。
  if (!code.includes('data-dsh-ttft-flat') || !code.includes('dsh-ttft-in')) {
    ttftReasons.push('client bundle 缺少 ttft 平铺样式（data-dsh-ttft-flat / dsh-ttft-in）')
  } else if (!code.includes('dsh-stats-ttft-styles')) {
    ttftReasons.push('ttft 平铺样式 id 应为 dsh-stats-ttft-styles（幂等注入可断言）')
  } else if (!/prefers-reduced-motion[\s\S]{0,200}dsh-ttft/.test(code)) {
    ttftReasons.push('ttft 平铺动效必须在 prefers-reduced-motion 下兜底')
  }
  // ⑤ 座位形状：桥必须同时读投影与窗口快照（缺一路就是降级链断了）。
  const bridgeSrc = readFileSync(resolve(ROOT, 'src/client/stats-ttft/TtftFlatBridge.tsx'), 'utf8')
  if (!/useProjection\('sessionStats'\)/.test(bridgeSrc)) ttftReasons.push('桥必须优先读 sessionStats 投影（整场会话口径）')
  else if (!/foldWindowTtft/.test(bridgeSrc)) ttftReasons.push('桥在无投影时必须用窗口节点现算（与官方回退同源）')
  else if (!/MutationObserver/.test(bridgeSrc)) ttftReasons.push('官方重渲染会洗掉追认节点，桥必须有 MutationObserver 补回')
  else if (!/aria-label/.test(bridgeSrc)) ttftReasons.push('追认后必须同步按钮的 aria-label（读屏不能只念旧数）')
  // ⑥ 锚点契约（0.2.1-alpha.4 真机实测）：官方给每颗 pill 打的是**单数**
  // data-composer-stat，旧版整行容器才是复数 data-composer-stats。删掉单数那条
  // 就是本次线上静默失效的复现，必须被断言拦住。
  else if (!/data-composer-stat="activity"/.test(bridgeSrc)) ttftReasons.push('桥必须认官方 activity pill 锚点 data-composer-stat="activity"')
  else if (!/data-composer-stats/.test(bridgeSrc)) ttftReasons.push('桥必须保留旧版整行容器锚点 data-composer-stats 作兜底')
  else if (!/ariaLedger/.test(bridgeSrc)) ttftReasons.push('aria 基准必须存内存账本：存 data-* 属性会在官方重渲染后变陈旧、把新步数覆盖回旧值')
  if (ttftReasons.length > 0) fail('首 token 平均平铺契约：' + ttftReasons.join('；'))
  else {
    pass('首 token 平均平铺：平均/文本/回退口径正确（9.8秒样例 + 分秒分界 + 中英前缀）')
    pass('首 token 平均平铺：样式与动效兜底在位 + 桥读投影与窗口双路 + observer 追认 + aria 同步')
  }
}

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

  /*
   * reasoning 投影过滤 + TDZ 防回归（两次事故各钉一头）：
   *  1. 官方 AssistantMarkdown 在 reasoning 投影里只渲染 reasoning 块；本组件
   *     接管座位后必须复现同一过滤（gallery / showBody 前置 !isReasoningProjection），
   *     否则总结期答案 step 的 reasoning 投影被思考卡放行规则带出来，正文同屏两份。
   *  2. isReasoningProjection 的**声明必须早于所有使用点**。曾因声明晚于 gallery
   *     求值触发 TDZ ReferenceError，assistant-step 座位整个渲染崩溃——思考卡、
   *     问答卡、正文全部消失。本文件的形状断言不执行组件，拦不住这类运行时错误，
   *     只能把声明顺序本身钉死。
   */
  {
    const declIdx = stepCode.indexOf("const isReasoningProjection = groupPart === 'reasoning'")
    const galleryIdx = stepCode.indexOf('const gallery = !isReasoningProjection')
    const bodyIdx = stepCode.indexOf('const showBody = !isReasoningProjection')
    if (declIdx < 0 || galleryIdx < 0 || bodyIdx < 0) {
      fail('reasoning 投影过滤缺失：gallery / showBody 都必须以 !isReasoningProjection 前置（总结期正文会重复两份）')
    } else if (!(declIdx < galleryIdx && declIdx < bodyIdx)) {
      fail('isReasoningProjection 必须声明在 gallery / showBody 使用点之前（TDZ 会让整个 assistant-step 座位渲染崩溃，思考卡/问答卡/正文全消失）')
    } else {
      pass('reasoning 投影过滤在位且声明先于使用点（防重复正文 + 防 TDZ 崩座）')
    }
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
  // 6. 标题行右侧只留跟随状态（2026-10-05 用户要求去掉折叠 chevron 与跟随胶囊底色）：
  //    折叠功能必须还在（整行 role=button + aria-expanded），去掉的只是装饰。
  if (/kr-reasoning-chevron/.test(reasoningCode)) {
    reasons.push('思考卡标题行的折叠 chevron 已按用户要求删除（kr-reasoning-chevron 不得复活）')
  }
  if (!/role="button"[\s\S]{0,200}aria-expanded={open}/.test(reasoningCode)) {
    reasons.push('去掉箭头后整行仍必须是可折叠按钮（role=button + aria-expanded），功能不受影响')
  }
  if (!/kr-card__follow/.test(reasoningCode) || !/跟随中/.test(reasoningCode)) {
    reasons.push('跟随状态文字（跟随中 / 已暂停）必须保留，只去掉底色')
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
    pass('思考卡：稳定引用 + 指纹探针 + 尾部窗口 + 按总结卡折叠 + 全量兜底 + 无箭头/跟随无底色')
  }

  /*
   * 总结卡判据不得再拿 `data.finalNode` 当「这一步是最终回答」用（2026-10-25 修）。
   *
   * data.finalNode 来自官方 projectAssistant：
   *   `...settled === void 0 ? {} : { finalNode: settled }`
   * 只要这一步收到过 assistant/message（即**每一次工具调用之后的落定**）它就有值，
   * 与「是不是最终回答」毫无关系。曾写成
   *   isClosingReply = owner !== undefined || (turnClosed && (node.key === lastStepKey || data.finalNode !== undefined))
   * 等于宣布每个中间步骤都是总结：
   *   · 每个 step 各自包一张带框的 reply 卡 → 过程播报被逐条包装成一排碎片卡；
   *   · showBody 里的 isClosingReply 恒真 → hideProcessText 整条规则失效。
   *
   * 实测（浏览器量 DOM，同一构建）：被中断的回合 22 张 reply 卡 / 0 张 step 卡；
   * **正常完成的回合 89 张 reply 卡 / 0 张 step 卡、74 张有高度** —— 说明它不是
   * 「中断」特有的问题，每个多步回合都在这样渲染，用户只是在插话那一轮看见了它。
   *
   * 断言形状：finalNode 只允许出现在「lastStepKey === undefined」的兜底分支里。
   */
  {
    // ⚠ 判据跨行书写（本仓源码是 CRLF + 多行三元），必须整段抓取而不是只抓第一行。
    const closingMatch = stepCode.match(/const isClosingReply = ([\s\S]{0,400}?)\n\s*const isSummary/)
    const closing = closingMatch === null ? stepCode.match(/const isClosingReply = [\s\S]{0,300}/)?.[0] ?? '' : closingMatch[1]
    if (closing === '') {
      fail('缺少 isClosingReply（总结卡判据），对话流卡片无法判定包哪种卡')
    } else if (!/owner !== undefined/.test(closing)) {
      fail('isClosingReply 必须保留 owner（官方 turn-tail closing）这一路——它才是官方认定的收尾回复')
    } else if (!/node\.key === lastStepKey/.test(closing)) {
      fail('isClosingReply 必须用「本回合最后一个 assistant-step」判最终回答（node.key === lastStepKey）')
    } else if (/data\.finalNode !== undefined/.test(closing)
      && !/lastStepKey === undefined[\s\S]{0,80}data\.finalNode !== undefined/.test(closing)) {
      fail('isClosingReply 的 data.finalNode 只能是 lastStepKey 取不到时的兜底，不能直接并列'
        + '（每个 step 都有 finalNode，并列等于把整轮过程播报逐条包成总结卡，并让过程性发言隐藏失效）')
    } else {
      pass('总结卡判据：owner / 最后一步为准，finalNode 仅在取不到最后一步时兜底（不把中间步骤当成总结）')
    }
  }
}

/*
 * 大盘的点击入口**只归用户自己发的消息**（2026-10-05 用户要求）。
 *
 * 判据两条缺一不可：
 *  1. 控制器里 click 监听必须用 [data-chat-flow-kind="user"] 定位（原来向上找
 *     [data-chat-turn] = 整条轮次都可点，助手正文/思考卡/总结卡全在响应点击）；
 *  2. 光标规则也必须收窄到同一条上（styles.ts）—— 手掌铺满整片对话流正是用户
 *     报的「总结老是出来一个手掌看着烦人」；其余区域显式 cursor:auto 兜底。
 */
if (krEnabled) {
  const controllerSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/kr-chat-controller.tsx'), 'utf8')
  const krStyleSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/styles.ts'), 'utf8')
  if (/target\.closest<HTMLElement>\('\[data-conversation-scroll\] \[data-chat-turn\], \[data-conversation-scroll\] \[data-turn-tail\]'\)/.test(controllerSrc)) {
    fail('大盘点击不得再按整轮命中（[data-chat-turn] 那版会让助手正文也切轮次）')
  } else if (!/data-chat-flow-kind="user"/.test(controllerSrc)) {
    fail('大盘点击必须只认用户消息（data-chat-flow-kind="user"）')
  } else if (!/\[data-conversation-scroll\] \[data-chat-flow-kind="user"\] \{\s*cursor: pointer/.test(krStyleSrc)) {
    fail('手掌光标必须只给用户消息那一条')
  } else if (!/\[data-chat-turn\]:not\(\[data-chat-flow-kind="user"\]\) \{[\s\S]{0,40}cursor: auto/.test(krStyleSrc)) {
    fail('其余区域必须显式 cursor:auto（不靠隐式结果，防止将来宽规则又铺满手掌）')
  } else {
    pass('大盘点击与手掌光标都只归用户消息（其余区域 cursor:auto）')
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
  } else if (!/const toolViews = useMemo/.test(agentSrc)) {
    fail('KrAgentPanel 的 toolViews 必须 memo（含每条一次的 rawResultJson 序列化）')
    // 工具调用卡（2026-10-09 恢复）：组件、装配、样式封顶、默认 5 行四样缺一不可。
  } else if (!existsSync(resolve(ROOT, 'src/client/kr-chat/KrToolCallsCard.tsx'))) {
    fail('工具调用卡组件 KrToolCallsCard.tsx 缺失（2026-10-09 已恢复，不该再被删）')
  } else if (!/KrToolCallsCard/.test(agentSrc) || !/KR_TOOL_CALLS_CARD_VISIBLE/.test(agentSrc)) {
    fail('KrAgentPanel 未装配工具调用卡（缺 KrToolCallsCard 引用或 KR_TOOL_CALLS_CARD_VISIBLE 开关）')
  } else if (!/\.kr-panel__memory-dock \.kr-tools-list[\s\S]{0,160}?max-height: calc\(5 \* var\(--kr-tool-row-h/.test(code)) {
    fail('工具调用卡列表缺「5 行滚动窗口」封顶（全量渲染 + 窗口内滚动，行高随字号轴）')
  } else if (!/\.kr-tool-card-item \{[\s\S]{0,260}?flex: none/.test(code)) {
    fail('工具调用卡条目缺 flex:none（overflow:hidden 让 flex 最小尺寸归零，条目会被压扁成 2px 细线，2026-10-09 实测事故）')
  } else if (!/overscroll-behavior: contain/.test(code)) {
    fail('工具调用卡滚动窗口缺 overscroll-behavior: contain（滚到头会带动外层滚动链）')
  } else {
    const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrToolCallsCard.tsx'), 'utf8')
    if (!/const \[collapsed, setCollapsed\] = useState\(false\)/.test(cardSrc) || !/\{!collapsed && \(/.test(cardSrc)) {
      fail('工具调用卡默认必须展开（列表全量渲染、5 行窗口滚动），整卡折叠只能是用户点击后的状态')
    } else if (!/useSteppedFollow\(/.test(cardSrc) || !/data-edges=\{edges\}/.test(cardSrc) || !/onScroll=\{onScroll\}/.test(cardSrc)) {
      fail('工具调用卡列表缺滚动跟随三件套（useSteppedFollow + onScroll + data-edges，与操作面板同款）')
    } else if (!/running=\{currentRunning\}/.test(agentSrc)) {
      fail('KrAgentPanel 未把 currentRunning 传给工具调用卡（收口拉回顶部 / 运行中贴底跟随都靠它）')
    } else if (!/\.kr-tools-list\[data-edges="both"\]/.test(code)) {
      fail('工具调用卡列表缺上下缘渐隐遮罩（5 行窗口硬切会留半行字，操作面板同款解法）')
    } else {
      pass('hook 顺序 / busy 收口 / 大盘 memo / 工具调用卡装配 + 5 行窗口 + 滚动跟随在位')
    }
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

  // 子智能体**独立成卡**（2026-10-08 用户点名要的形态）：不再是操作面板某一步
  // 下面的缩进小块。三件事各自都可能断，任何一处断了这张卡就白给：
  //   1. 卡本身存在、样式族在位、有几个就几行；
  //   2. 每一行**可点**且点了真的跳（官方 uiWorkspace.openSession）；
  //   3. 数据源读的是**真实存在的快照形状**（projectionsBySession.subagentCatalog
  //      + byId）—— 上一版读 items / subagentsByParent 这两个不存在的键，
  //      目录永远停在「未加载」，用户截图里那句自相矛盾的话就是这么来的。
  if (krEnabled) {
    /**
     * 样式表花括号平衡（2026-10-23 收尾加）。
     *
     * 这一轮真的在 @keyframes 后面多出过一个孤立 `}`：styles.ts 从那一行开始深度变
     * -1，紧随其后的 .kr-subs-row__label 会带着非法前导选择器解析、在 Chrome 里整条
     * 被丢弃（省略号 / 字重一起失效）—— 而整份冒烟全绿，因为没有任何一条在验语法。
     * 剥离注释与字符串后逐字符计数，堵住这一类静默错误。
     */
    const bracesBalanced = (src) => {
      const bare = src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      let depth = 0
      for (const ch of bare) {
        if (ch === '{') depth += 1
        else if (ch === '}') {
          depth -= 1
          if (depth < 0) return false
        }
      }
      return depth === 0
    }
    const subsSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrSubagentsCard.tsx'), 'utf8')
    const catSrc0 = readFileSync(resolve(ROOT, 'src/client/kr-chat/subagent-catalog.ts'), 'utf8')
    // 操作面板源码在本块与下面几块都要读，提到这里声明（下面几块共用同一份）。
    const cardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPlainTimelineCard.tsx'), 'utf8')
    /**
     * 断言「实现里没有某个东西」时必须**先剥注释**：这一整轮的改动恰恰在注释里
     * 反复解释了"旧的那套已经删掉、为什么删"，拿原文匹配会把说明文字当成残留。
     */
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    const cardCode = stripComments(cardSrc)
    const subsCode = stripComments(subsSrc)
    if (!code.includes('.kr-card--subs') || !code.includes('.kr-subs-row__label')) {
      fail('client bundle is missing the subagents card styles (.kr-card--subs / .kr-subs-*)')
    } else if (/kr-plain-subs|kr-plain-sub__|SubagentBlock/.test(cardCode) || /\.kr-plain-subs\b/.test(code)) {
      fail('子智能体已独立成卡，操作面板里不该再有内嵌清单（kr-plain-subs* / SubagentBlock 应已整块删除）')
    } else if (!/sessionId=\{latestChatSessionId\}/.test(agentSrc)) {
      fail('操作面板必须收到当前会话 id（产出行预览按会话寻址）')
    } else if (!/<KrSubagentsCard/.test(agentSrc)) {
      fail('右栏必须挂 KrSubagentsCard（子智能体独立成卡）')
    } else if (!/useSubagentCatalog\(latestChatSessionId\)/.test(agentSrc)) {
      fail('子智能体目录必须由 KrAgentPanel 单点订阅（两张卡各订一次 = 各开一条 interval + 各发一份 RPC）')
    } else if (!/subagentCatalog=\{subagentCatalog\}/.test(agentSrc)) {
      fail('操作面板那枚计数必须拿到同一份目录（单点订阅、向下传）')
    } else if (
      // 两段各渲一份：进行中走 visible、已结束走 doneVisible。
      // 只验其中一份的话，另一段被删成空容器也照样通过 —— 而折叠带展开就是空的。
      !/visible\.map\(\(row, index\) => \(/.test(subsSrc) ||
      !/doneVisible\.map\(\(row, index\) => \(/.test(subsSrc)
    ) {
      fail('子智能体卡必须**有几个就几行**（进行中 visible / 已结束 doneVisible 各一份，逐行渲染）')
    } else if (!/className="kr-subs-row__main"[\s\S]{0,400}?onClick=\{\(\) => \{ onOpen\(row\) \}\}/.test(subsSrc)) {
      fail('每一行必须是可点的跳转入口（整行一个 button，点了 openSubagentSession）')
    } else if (!/kr-subs-group--toggle/.test(subsSrc) || !/kr-subs-done__body/.test(subsCode)) {
      fail('已结束的子智能体必须收进可折叠分区（用户 2026-10-23 点名「完工的也放 Show more」）')
    } else if (!/kr-subs-group--done/.test(code) || !/kr-subs-group__chevron/.test(code)) {
      fail('client bundle is missing the group-header styles (.kr-subs-group--done / __chevron)')
    } else if (
      // 2026-10-23 第二轮：用户点名「正在执行和已结束看不出来，不明显」。
      // 状态必须由**结构**承担，而不是靠一颗点的深浅：
      //   ① 两段各有自己的段标题（主色「正在执行 N」/ 带对勾的「已完成 N」）；
      //   ② 行首图标用形状差（转圈 vs 对勾），不依赖颜色与动画。
      !/kr-subs-group--run/.test(subsSrc) ||
      !/className="kr-subs-group__label">正在执行</.test(subsSrc) ||
      !/className="kr-subs-group__label">已完成</.test(subsSrc) ||
      // 打包 CSS 侧也要验：上面那条主色标题靠「主色 + 呼吸点 + kr-pulse」三样才成立，
      // 而这三样只写样式、源码里 grep 不到，删掉后源码断言依旧全绿。
      !/kr-subs-group--run/.test(code) ||
      !/kr-subs-group__dot/.test(code) ||
      !/@keyframes kr-pulse/.test(code)
    ) {
      fail('子智能体必须分「正在执行 / 已完成」两段并各带段标题（用户点名状态看不出来）')
    } else if (
      !/kr-subs-row__spin/.test(subsSrc) ||
      !/kr-subs-row__icon/.test(subsSrc) ||
      !/kr-subs-row__spin/.test(code) ||
      // 结束态那枚对勾：只验转圈分支的话，删掉对勾后已结束行会变成行首空白，
      // 而"形状即状态"里的另一半就没了。
      !/d="m3\.4 8\.5 3\.1 3\.1 6-6\.6"/.test(subsSrc)
    ) {
      fail('行首必须是形状状态图标（进行中转圈 / 已结束对勾），不能退回只有一颗点')
    } else if (
      // 行内那枚「进行中 / 已结束」文字已撤：分区标题说过一遍，每行再说一遍是噪声。
      // 但状态必须仍在无障碍面 —— aria-label 里要带。
      /kr-subs-row__state/.test(subsCode) ||
      !/进行中' : '已结束/.test(subsSrc) ||
      // 悬停说明（title）是视觉用户唯一的文字来源，aria-label 只服务读屏 —— 两处都得带状态。
      !/row\.running \? '进行中 · 点一下跳过去看' : '已结束 · 点一下跳过去看'/.test(subsCode)
    ) {
      fail('行内状态文字必须撤掉（分区已交代），但 aria-label 与 title 里都必须仍带状态')
    } else if (
      // 折叠区必须是**连续的尾块**：先按 running 分组、再进行中在前已结束在后，
      // 否则收起时中间被抽走几行、下面的行往上跳。
      !/rows\.filter\(\(row\) => row\.running\)/.test(subsCode) ||
      !/rows\.filter\(\(row\) => !row\.running\)/.test(subsCode)
    ) {
      fail('子智能体必须按 running 分组：进行中在前、已结束在后（折叠区要是连续尾块）')
    } else if (
      // 折叠带上的计数必须在**收起态**可见：读者要知道下面收着几个。
      // 现在它是一条带对勾的分区带（「已完成 N」），不再是「N 个已结束」的淡灰行。
      !/className="kr-subs-group__count">\{doneRows\.length\}/.test(subsSrc)
    ) {
      fail('已完成折叠带必须带计数（收起态可见，读者要知道下面收着几个）')
    } else if (
      !/aria-expanded=\{doneOpen\}/.test(subsSrc) ||
      // 展开体带 inert / aria-hidden，读屏用户按完按钮要知道自己展开了哪一块；
      // 收起后展开体整块卸载，所以属性本身要跟着 donePresent 出现/消失（否则是悬空 IDREF）。
      !/aria-controls=\{donePresent \? DONE_BODY_ID : undefined\}/.test(subsSrc) ||
      !/id=\{DONE_BODY_ID\}/.test(subsSrc)
    ) {
      fail('已完成折叠带必须给 aria-expanded 与 aria-controls（读屏用户要知道这块是开是合、开了哪一块）')
    } else if (
      // 没有进行中的行时**整条标题不渲染**（2026-10-23 收尾）：那时折叠只会把卡掏空，
      // 而挂一条对勾 + 淡字的静态标题又会被读成第 N+1 行（形状和下面每一行一样）。
      // 判据是 doneFoldable，两个分支必须一个 button、一个 null —— 都做成 button
      // 就会有一个按不动的假按钮。
      !/doneFoldable = runningRows\.length > 0 && doneRows\.length > 0/.test(subsCode) ||
      !/\{doneFoldable \? \(/.test(subsSrc) ||
      !/\) : null\}/.test(subsCode) ||
      /data-foldable=/.test(subsCode)
    ) {
      fail('已完成分区只在「上面还有进行中」时才可折叠；全部结束时整条标题不渲染（只平铺行）')
    } else if (!/openSubagentSession/.test(subsSrc) || !/uiWorkspace/.test(catSrc0)) {
      fail('跳转必须走官方 uiWorkspace.openSession（与官方子智能体目录点一行同一条链路）')
    } else if (!/projectionsBySession/.test(catSrc0) || !/subagentCatalog/.test(catSrc0)) {
      fail('子智能体目录必须读 projectionsBySession[父].values.subagentCatalog（官方目录用的同一份投影）')
    } else if (!/refreshProjections/.test(catSrc0)) {
      fail('子智能体目录必须主动调 refreshProjections 拉基线（不拉就永远读不到目录）')
    } else if (/filterCatalogByTurn/.test(stripComments(catSrc0)) || /filterCatalogByTurn/.test(stripComments(agentSrc))) {
      // 2026-10-23 用户点名「一个会话里的子代理卡片不要根据对话区分了」：
      // 目录回到整场会话口径，按轮次窗口裁剪的那一层整块删除。
      // 匹配前必须剥注释：这一轮的改动恰恰在注释里反复解释"那一层已删、为什么删"。
      fail('子智能体目录不得再按轮次过滤（filterCatalogByTurn 必须删除，卡按整场会话列）')
    } else if (!/const subagentCatalog = useSubagentCatalog\(latestChatSessionId\)/.test(agentSrc)) {
      fail('子智能体目录必须直接是整场会话口径（useSubagentCatalog 结果不再被轮次窗口包一层）')
    } else if (!/spawnsSubagents\(callName\(/.test(agentSrc)) {
      fail('子智能体卡的「正在读取」判定必须扫**会话全部**工具节点（与目录同粒度，不能只看本轮）')
    } else if (!bracesBalanced(readFileSync(resolve(ROOT, 'src/client/kr-chat/styles.ts'), 'utf8'))) {
      fail('styles.ts 花括号必须平衡（这一轮出过@keyframes 后多一个孤立 }，会让紧随的规则整条被浏览器丢弃，而冒烟全绿）')
    } else {
      pass('子智能体独立成卡：有几个几行 + 整行可点跳转 + 数据源读真实快照形状')
    }

    // 「操作面板」卡：技术细节入口已按要求整块删除（连带它打开时的蓝底），
    // 于是这张卡只剩人话；列表仍必须有上下渐隐（否则顶部被硬切出半行）、
    // 收口时必须回顶（内容定格后停在底部会把开头几步挡在视口外）。
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

    // 简要 / 详细两档已整块删除（2026-10-24 用户要求：「点击就是详细不需要简要了」）。
    //
    // 现在的口径：**折叠态只有一行当前动作，展开就是完整详细时间线**。所以这里
    // 反过来断言「简要档确实不存在」——残留任何一处都会让 UI 与代码说法不一致。
    if (/data-brief=/.test(cardSrc)) {
      fail('简要档已删除，卡片里不该再有 data-brief 分支')
    } else if (/brief=\{brief\}|useState<PlainStepView>|condenseSteps\(/.test(cardSrc)) {
      fail('简要档已删除，不该再引用 brief 状态 / condenseSteps')
    } else if (!/<span className="kr-plain-step__title" title=\{title\}>\{title\}<\/span>/.test(cardSrc)) {
      fail('详细时间线的行标题必须直接渲染 title（对象优先，无对象回退动词）')
    } else {
      pass('简要档已删除：展开即完整详细时间线（无 brief 分支残留）')
    }

    // 默认折叠 + 卡头耗时隐藏（2026-10-24 用户两次点名）：
    //   · 「操作面板默认不展开」→ 初始 open 必须是 false；
    //   · 「那一行的秒数给隐藏，里面的不隐藏」→ 卡头 .kr-plain-head__time 的渲染
    //     必须已注释掉，而明细行 .kr-plain-step__time 的渲染**必须还在**。
    // 第二句是这个断言真正防的东西：两句一起读很容易把两处耗时都删了，而删掉
    // 明细那枚会让展开后的每一行失去耗时读数（用户说的"里面的"）。
    if (!/const \[open, setOpen\] = useState\(false\)/.test(cardSrc)) {
      fail('操作面板必须默认收起（用户：「操作面板默认不展开」），初始 open 应为 false')
    } else if (/^\s*\{currentAction\.durationMs !== undefined/m.test(cardSrc.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''))) {
      fail('卡头那一行的耗时必须隐藏（用户：「那一行的秒数给隐藏」）')
    } else if (!/<span className="kr-plain-step__time">\{formatDuration\(step\.durationMs\)\}<\/span>/.test(cardSrc)) {
      fail('明细行里的耗时必须保留（用户：「里面的不隐藏」）—— 展开后每行都要有耗时读数')
    } else {
      pass('操作面板默认收起 + 卡头耗时已隐藏、明细行耗时保留')
    }

    // 卡头形态：竖排「任务动画 / 名字(+浏览器标志) / 一行当前动作」，点一下展开全部。
    // 卡头已抽成 SeekerHead.tsx（操作面板卡与新对话页共用），断言改查那个文件。
    // 2026-10-26：立绘位从静态 WhalePortrait 换成 9 段任务动画（SeekerStage）。
    const seekerHeadSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/SeekerHead.tsx'), 'utf8')
    // 空闲文案的唯一真相（2026-10-26 从两处重复的表抽成一个模块）。
    const idleSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/idle-phrase.ts'), 'utf8')
    if (!/className="kr-plain-head__name">Seeker</.test(seekerHeadSrc)) {
      fail('操作面板卡头必须显示名字（Seeker）')
    } else if (!/<SeekerStage/.test(seekerHeadSrc) || !/idleClip=\{/.test(seekerHeadSrc)) {
      /*
       * 立绘位 2026-10-26 换成**任务动画**：用户给了 9 个 GIF，转成透明底 WebM 后
       * 按卡头状态播放（SeekerStage + motion-clips.ts）。原 WhalePortrait 已删除。
       *
       * 同时钉住 idleClip 这个传参：空闲片段（观月中/吃饭中/小憩中）是按钟点那句
       * 话反查出来的，漏传就永远只播默认那一段 —— 界面上不报错，只是「夜里她也在
       * 打盹」，只能靠断言看出来。
       */
      fail('操作面板卡头必须挂任务动画（SeekerStage，且传 idleClip）')
    } else if (!/className="kr-plain-head__name-row"/.test(seekerHeadSrc)
      || !/className="kr-plain-head__browser"/.test(seekerHeadSrc)) {
      /*
       * 浏览器标志必须在**名字右侧**（2026-10-25 用户：「这个球标志放在操作面板的
       * Seeker 文字右侧」）。它原先挂在左侧会话列表行右端（DOM 属性 + 伪元素），
       * 现在住在 name-row 里，跟着名字走。
       *
       * 两条都要在：name-row 包裹（并排布局的前提）与 browser 类名（图标本体）。
       * 少了包裹，图标会掉到名字下一行。
       */
      fail('浏览器标志必须挂在 Seeker 名字右侧（.kr-plain-head__name-row 里的 .kr-plain-head__browser）')
    } else if (!/\.kr-plain-head__browser/.test(code)) {
      fail('client bundle 缺 .kr-plain-head__browser 样式（图标会是一坨没尺寸的裸 SVG）')
    } else if (!/<button[\s\S]{0,200}?className="kr-plain-head__browser"[\s\S]{0,400}?onClick=\{onBrowserClick\}/.test(seekerHeadSrc)) {
      /*
       * 浏览器标志必须**可点击**（2026-10-25 用户要求：「点击浏览器图标自动进入到
       * ego 那个工作空间」）。
       *
       * 用 button 而不是 span + onClick：键盘可达、自带 :active/:focus-visible 语义、
       * 读屏能认出这是个能按的东西。断言直接钉 button + onClick 两件，
       * 退回 span 就会红。
       */
      fail('浏览器标志必须是可点击按钮（button.kr-plain-head__browser + onClick=onBrowserClick），'
        + '点了要能切到那个窗口')
    } else if (!/export async function activateBrowserWindow/.test(readFileSync(resolve(ROOT, 'src/client/browser-flag/activate.ts'), 'utf8'))) {
      fail('缺 activateBrowserWindow（POST /api/chat-flow/activate-window 的客户端封装）')
    } else if (!/data-flash=\{flash \?\? undefined\}/.test(seekerHeadSrc)) {
      /*
       * 点击要有**结果反馈**（2026-10-25 修「点了不跳转」时补）。
       *
       * 之前完全静默：成功和失败在界面上长得一模一样，用户不知道到底跳没跳 ——
       * 而这轮修的正是「点了不跳转」，静默失败让人连"是不是坏了"都判断不了。
       */
      fail('浏览器标志必须有点击结果反馈（data-flash=ok/fail），否则失败时用户无从判断')
    } else if (!/\.kr-card--subs\s*\{[^}]*background:\s*transparent/.test(code)
      || !/\.kr-card--subs\s*\{[^}]*border:\s*0/.test(code)
      || !/\.kr-card--subs\s*\{[^}]*box-shadow:\s*none/.test(code)) {
      /*
       * 子智能体**不套卡片外框**（2026-10-25 用户：「子智能体不要卡片包裹」）。
       *
       * 底色 / 描边 / 圆角 / 投影 四样必须全部抹掉 —— 只抹一两样的话，剩下的会
       * 让它仍然读成一张卡，用户看到的还是被包着。
       *
       * 同时必须保住固定 5 行高度（height 断言在上一条）：去外框只动视觉，
       * 不动盒子尺寸。高度一旦丢，下面那张操作面板立刻又开始跳。
       */
      fail('子智能体卡必须去掉卡片外框（background:transparent + border:0 + box-shadow:none）')
    } else if (!/\.kr-card--plain\s*\{[^}]*background:\s*transparent/.test(code)
      || !/\.kr-card--plain\s*\{[^}]*box-shadow:\s*none/.test(code)) {
      /*
       * 操作面板**也去外框**（2026-10-25 用户：「操作面板留，下截框」→ 确认口径
       * 为「也去掉外框，但保留下方一条分隔线」）。与子智能体卡同一套口径。
       */
      fail('操作面板必须去掉卡片外框（background:transparent + box-shadow:none）')
    } else if (!/\.kr-card--plain\s*\{[^}]*border-bottom:\s*1px solid var\(--kr-hairline\)/.test(code)) {
      /*
       * 下方那条发丝线是**本轮唯一保留的边界**：它把「这一轮的过程」与下面
       * 的「计划 / 成品」分开 —— 那里确实换了语义。上面（子智能体卡）不画线，
       * 两者都无框时靠内距与 gap 就够，再画反而像表格。
       */
      fail('操作面板必须保留下方一条分隔线（border-bottom: 1px solid var(--kr-hairline)）')
    } else if (!/export function syncSeekerHeroHead/.test(readFileSync(resolve(ROOT, 'src/client/kr-chat/SeekerHeroHead.tsx'), 'utf8'))) {
      fail('缺新对话页卡头（SeekerHeroHead.tsx 的 syncSeekerHeroHead）')
    } else if (!/\.kr-hero-head/.test(code)) {
      fail('client bundle 缺 .kr-hero-head 样式（新对话页卡头会没有居中与入场动效）')
    } else if (!/function SeekerHeroHead\(\{ running \}: \{ readonly running: boolean \}\)/.test(
      readFileSync(resolve(ROOT, 'src/client/kr-chat/SeekerHeroHead.tsx'), 'utf8'))) {
      /*
       * 新对话页卡头必须**感知本轮运行态**（2026-10-25 用户：「为什么总是在休息中」）。
       *
       * 它原先只显示按钟点选的空闲文案 —— 用户在新对话页发出第一条消息后、首条
       * 回复落定前，这块卡头仍挂着「休息中」，看起来像"她根本没在干活"。
       *
       * 运行态**由控制器传进来**（running prop），组件自己不轮询：
       * kr-chat-controller 本来就有 250ms 的 syncDom 轮询在调 syncSeekerHeroHead，
       * 同一个状态再开一套 400ms 定时器是纯浪费（两倍 DOM 查询、两个来源可能不一致）。
       */
      fail('新对话页卡头必须接收 running prop（运行态由控制器 250ms 轮询传入，组件不自开定时器）')
    } else if (!/export function isCurrentTurnRunning/.test(
      readFileSync(resolve(ROOT, 'src/client/kr-chat/turn-state.ts'), 'utf8'))) {
      fail('回合状态判据必须抽成独立模块（turn-state.ts），否则 controller 与 Hero 卡头循环依赖')
    } else if (!/\.kr-plain-head__name\s*\{[^}]*font-size:\s*max\(13px, calc\(var\(--dsh-content-font-size/.test(code)) {
      /*
       * 卡头文字字号 = **DSH 正文 +2**（2026-10-25 用户：「文字浏览器图标都跟随 dsh
       * 字号大 2 号」）。原先跟 --kr-fs-title（正文 −1），比正文还小一档 —— 而名字是
       * 卡头里唯一的那个名字，该比正文醒目。
       *
       * 不能改用 --kr-fs-* 档位：那张表是为正文密度设计的（−1 / −1.5 / −2 …），
       * 方向相反，硬塞进去只会得到「跟正文一样小」。
       */
      fail('卡头名字字号必须是 max(13px, calc(var(--dsh-content-font-size) + 2px))（DSH 正文 +2）')
    } else if (!/\.kr-plain-head__browser\s*\{[^}]*color:\s*var\(--dsw-alias-label-secondary\)/.test(code)) {
      /*
       * 浏览器标志必须**灰色**（2026-10-25 用户：「浏览器和 svg 都要用灰色」）。
       * 原先用主色 --kr-accent：那是「正在发生」的信号色，而这枚小图标只是状态标记，
       * 不必和主色抢注意力。
       */
      fail('浏览器标志必须用灰色（color: var(--dsw-alias-label-secondary)），不能用主色')
    } else if (!/\.kr-plain-head__tool\s*\{[^}]*opacity:\s*1/.test(code)) {
      /*
       * 两枚动作按钮的常态**不许再压透明度**（2026-10-25 用户：「设置被遮住了」）。
       * 0.55 在浅色主题里等于把 tertiary 灰再打薄一半 —— 白底上几乎看不见。
       */
      fail('卡头动作按钮常态必须 opacity:1（0.55 在白底上几乎看不见，读起来像被盖住）')
    } else if (!/\.kr-plain-head__tool\s*\{[^}]*width:\s*28px/.test(code)) {
      fail('卡头动作按钮必须是 28px 热区（24px 里放 16px 图标只剩 4px 边距，太挤）')
    } else if (!/viewBox="0 0 24 24" fill="currentColor"/.test(seekerHeadSrc) || !/fillRule="evenodd"/.test(seekerHeadSrc)) {
      /*
       * 齿轮必须是**实心** 8 齿（fill + fill-rule:evenodd 挖中心孔）。
       * 前两版：① 圆+发散线（那是太阳）；② 描边闭合 path（小尺寸下糊成一圈锯齿）。
       */
      fail('齿轮必须是实心（fill=currentColor + fillRule=evenodd），描边版在小尺寸下会糊')
    } else if (!/const browserOn = browserActive \|\| \(running && browserSticky\)/.test(cardSrc)) {
      /*
       * 「只要 ego 没收口就不要消失」（2026-10-25 用户要求）。
       *
       * 只认 store 的 active/尾迹时，一次调用结束 1.5s 后图标就灭 —— 而浏览器
       * 进程还开着，模型只是在两次调用之间思考。判据必须是**粘滞**：本轮出现过
       * 浏览器活动，就一直亮到本轮收口。
       *
       * ⚠ 别写成 browserActive || running：那会让每个正在跑的会话都亮图标，
       *   哪怕它根本没碰过浏览器。
       */
      fail('浏览器标志必须粘滞到本轮收口（browserActive || (running && browserSticky)），'
        + '不能只认单次调用，也不能无条件跟着 running 亮')
    } else if (!/kr-plain-head__act/.test(seekerHeadSrc)) {
      fail('卡头必须有「当前动作」这一行')
    } else if (/\.kr-plain-view\b/.test(cardSrc)) {
      fail('卡头不该再挂简要/详细按钮（点击整块卡头就是展开详细）')
    } else if (!/IDLE_SLOTS/.test(cardSrc) || !/idlePhraseFor\(new Date\(clockTick\)\)/.test(cardSrc)) {
      /*
       * 空闲文案必须**按真实时间**选（2026-10-25 用户：「这几个状态要根据时间来」）。
       *
       * 2026-10-26 改词：删掉「休息中 / 晒太阳」，改成夜里的「观月中」+ 白天的
       * 「小憩中」+ 11–13 点的「吃饭中」。时段表本身搬进了 idle-phrase.ts
       * （右栏与新对话页共用一份，两处各抄一遍必然分叉），所以这里改为断言
       * 「卡片确实用了那张表」：引用 IDLE_SLOTS 的模块 + 按 clockTick 现算。
       */
      fail('空闲文案必须按时间段选（引用 idle-phrase.ts 的 IDLE_SLOTS，并按 clockTick 现算）')
    } else if (!/idlePhraseFor\(new Date\(clockTick\)\)/.test(cardSrc)) {
      fail('空闲文案必须随分钟级 clockTick 重算（否则跨时段后用户得刷新页面才看到对的钟点）')
    } else if (!/if \(!running\) return null/.test(cardSrc)) {
      /*
       * 收口后必须回到空闲文案（2026-10-25 用户：「结束之后怎么不[变]回去呢」）。
       *
       * 原先 currentAction 在收口后会取最后一条动作，卡头于是长期挂着「收口任务
       * 清单」这类句子 —— 读起来像她还在干这件事。现在收口返回 null，走空闲文案。
       */
      fail('本轮收口后卡头必须回到空闲文案（currentAction 在 !running 时返回 null）')
    } else if (!/const IDLE_PHRASES: readonly string\[\] = \['观月中', '小憩中', '吃饭中'\]/.test(idleSrc)) {
      /*
       * 卡头空闲文案（2026-10-25 提，2026-10-26 定稿）：「不要显示等待本轮开始，
       * 显示休息中、吃饭中、小憩、晒太阳；当我发送出去对话的时候就变成在思考中」。
       *
       * 2026-10-26 用户删掉「休息中 / 晒太阳」、加回「观月中 / 小憩中」，判据改成
       * 按**夜里**分：19:00–次日 05:00 观月中。这三个说法各对应一段动画，所以
       * 这张表同时是动画片段的入口（idleClipFor）。
       *
       * 断言读 idle-phrase.ts 而不是卡片源码：那张表是唯一真相，两处共用。
       */
      fail('卡头空闲文案必须是「观月中 / 小憩中 / 吃饭中」三档（IDLE_PHRASES 表）')
    } else if (!/^\s*\[0, 5, '观月中'\],$/m.test(idleSrc)
      || !/^\s*\[19, 24, '观月中'\],$/m.test(idleSrc)) {
      /*
       * 「观月中」必须真的覆盖**夜里**（用户 2026-10-26：「根据晚上进行判断」）。
       * 跨零点拆成 [0,5] 与 [19,24] 两段 —— 只写一段会让 1 点显示成别的说法，
       * 而那恰恰是最该出现月亮的时候。
       */
      fail('「观月中」必须覆盖 19:00–次日 05:00（IDLE_SLOTS 里 [0,5] 与 [19,24] 两段都要在）')
    } else if (!/if \(running && empty\) return THINKING_PHRASE/.test(cardSrc)
      || !/export const THINKING_PHRASE = '在思考中'/.test(idleSrc)) {
      fail('刚发出消息、还没有任何动作时必须显示「在思考中」'
        + '（判据 running && empty：本轮在跑但时间线里一条动作都没有）')
    } else if (/等待本轮开始/.test(stripComments(cardSrc)) || /已收口/.test(stripComments(cardSrc))) {
      // 必须剥注释再查：这两句在这一轮的注释里被反复引用（"原来写的是…"），
      // 拿原文匹配会把说明文字当成残留 —— 本文件里 stripComments 已有定义。
      fail('卡头不该再出现「等待本轮开始 / 已收口」（系统视角措辞，用户点名换掉）')
    } else if (!/\{line\.hideVerb !== true && \(/.test(seekerHeadSrc)) {
      /*
       * 渲染层必须遵守 hideVerb（2026-10-25 用户：「也不要出现在电脑上操作，
       * 因为看 SVG 就能看出来」）。
       *
       * 只改 plain-language 的 verb 文本没用 —— 那只是把词换个说法，仍然印在卡头
       * 上。这一轮就是这么踩的：verb 从「在终端执行命令」改成「在电脑上操作」，
       * 冒烟全绿、卡片照旧显示一个词。两条断言分工：
       *   · smoke-triad 查数据层（hideVerb 是否为 true）；
       *   · 这里查渲染层（卡头有没有真的听这个标记）。
       */
      fail('卡头必须遵守 hideVerb（终端族的动词不上屏，行首图标已表达该意思）')
    } else {
      pass('操作面板卡头：鲸鱼娘 + 名字 + 一行当前动作（动词按 hideVerb 省略，点击展开详细）')
    }

    // 子智能体目录的三态语义：**未加载 ≠ 确实为空**。把「还没读到」说成
    // 「这次没有派生独立的子智能体」，就是在对一件我们并不知道的事下结论
    // （截图里那句自相矛盾的话正是这么来的）。
    if (!/state: 'unloaded'/.test(catSrc0) || !/state: 'empty'/.test(catSrc0)) {
      fail('子智能体目录必须区分「未加载 / 读取中」与「确实为空」两种状态')
    } else if (!/正在读取子智能体/.test(subsCode)) {
      fail('未加载态必须有独立文案，不能复用「这次没有派生独立的子智能体」')
    } else if (/这次没有派生独立的子智能体/.test(subsCode)) {
      fail('卡上不得再出现「这次没有派生独立的子智能体」这句结论（空目录只说明我们还没读到）')
    } else if (!/const placeholder = rows\.length === 0 && !spawning/.test(subsCode)
      || !/data-placeholder=\{placeholder \|\| undefined\}/.test(subsSrc)) {
      /*
       * 2026-10-25 用户定稿：「没有子智能体时不上移」。这条与 2026-10-24 的
       * 「没有子智能体的时候也不要显示」**必须同时满足**，做法是**不可见占位**：
       *   · data-placeholder + visibility:hidden → 视觉上不存在（不显示）；
       *   · 盒子保留、结构与真实卡同一套 → 高度精确相等（不上移）。
       *
       * ⚠ 别改回 return null：那会让下面的操作面板上移——正是用户这次要修的。
       * ⚠ 也别改成 display:none：盒子被抽掉，高度归零，效果同 return null。
       */
      fail('没有子智能体时必须**不可见占位**（placeholder + data-placeholder），'
        + '既不能显示、也不能让下面的操作面板上移')
    } else if (!/kr-subs-window/.test(subsSrc) || !/--kr-subs-rows:\s*5/.test(code)) {
      fail('子智能体卡必须是固定 5 行窗口（.kr-subs-window + --kr-subs-rows: 5）')
    } else if (!/\.kr-card--subs\[data-placeholder\]\s*\{[^}]*visibility:\s*hidden/.test(code)) {
      fail('占位态必须用 visibility:hidden（不能用 display:none —— 盒子被抽掉后高度归零，'
        + '下面的操作面板照样上移）')
    } else if (!/height:\s*calc\(var\(--kr-subs-rows,\s*5\)[\s\S]{0,80}?\)/.test(code)) {
      /*
       * 必须是 height，不能是 max-height —— 这一条是本轮的关键取舍。
       *
       * 这张卡存在的唯一目的是给紧贴其下的「操作面板」一个**恒定位置**：
       * max-height 会让卡高随行数变，那个目的就落空了（2026-10-24 实测过一轮，
       * 用户当场反馈「位置还是变来变去」）。代价是行数不足 5 行时下方留白，
       * 用户在这两者之间明确选了「恒定」。
       */
      fail('子智能体窗口必须用 height 固定（不是 max-height）：'
        + '卡高必须与行数无关，否则下面的操作面板会跟着跳')
    } else {
      pass('子智能体目录：真实快照形状为主 + 未加载/为空分层 + 封顶 10 行自适应窗口')
    }
  }

  /*
   * ── 「产出的文件 / 截图要能点开、能看见」这条链路 ─────────────────────
   *
   * 用户原始诉求：KR 对话里模型产出的文件与截图，点不了、看不到图，期望点击
   * 之后在 DSH 右侧栏的工作区文件预览里打开。这条链路的四段各自都可能断：
   *   1. 正文裸路径没人变成链接（官方只认「本回合写过的文件」的行内代码）；
   *   2. 行内代码的文件提及范围太窄（运行中的产出、历史文件都不认）；
   *   3. 右栏操作面板里的文件名是死文本，点不动；
   *   4. 打开动作没有接到官方 sidebarRight.openResource 上。
   * 下面逐段断言，任何一段断掉都能在这一行看出来。
   */
  const previewSrc = readFileSync(resolve(ROOT, 'src/client/open-preview.ts'), 'utf8')
  const linkifySrc = readFileSync(resolve(ROOT, 'src/client/path-linkify.ts'), 'utf8')
  const ctxSrc = readFileSync(resolve(ROOT, 'src/client/client-ctx.ts'), 'utf8')
  const thinkSrc = readFileSync(resolve(ROOT, 'src/client/thinking/ThinkingStepNodeView.tsx'), 'utf8')

  if (!/sidebarRight/.test(previewSrc) || !/openResource/.test(previewSrc)) {
    fail('open-preview 必须走官方 sidebarRight.openResource（右侧栏工作区预览的唯一入口）')
  } else if (!/dsh-resource:\/\/file\//.test(previewSrc) || !/sessionFileAddress/.test(previewSrc)) {
    fail('open-preview 必须构造官方 dsh-resource://file/session/<id>/<path> 地址')
  } else if (!/params: \{ line: (?:options\.line|line) \}/.test(previewSrc)) {
    // 形态随实现调整过：行号原先直传 options.line，2026-10-19 起统一走 attemptOpen
    // 的局部参数（同一条官方 params.line 契约，只是多了一层可重试的调用点）。
    // 断言钉的仍是「必须把行号送进官方 params」，不钉某个变量名。
    fail('open-preview 必须支持行号定位（官方文本预览的 params.line）')
  } else if (!/reason: 'no-service'|'no-service'/.test(previewSrc)) {
    fail('open-preview 拿不到右栏服务时必须静默降级（不能抛）')
  } else {
    pass('open-preview：官方 sidebarRight.openResource + 会话文件地址 + 行号 + 静默降级')
  }

  // 根上下文登记：右栏预览与正文提及都要读跨插件服务，而组件模块不能反向
  // import 插件入口（会成环）。
  if (!/setClientCtx/.test(ctxSrc) || !/getService/.test(ctxSrc)) {
    fail('client-ctx 必须提供 setClientCtx / getService（跨插件服务的登记与防御式读取）')
  } else if (!/setClientCtx\(/.test(readFileSync(resolve(ROOT, 'src/client/index.ts'), 'utf8'))) {
    fail('插件入口 apply() 必须登记根上下文（否则组件读不到 sidebarRight）')
  } else {
    pass('client-ctx：apply() 登记根上下文，组件侧防御式取服务')
  }

  // 裸路径链接化：必须产出官方认识的本地 Markdown 链接（renderAnchor 会把它
  // 接进 openFile → sidebarRight），且必须放过代码块 / 行内代码 / 已有链接。
  if (!/linkifyFilePaths/.test(linkifySrc) || !/toMarkdownLink/.test(linkifySrc)) {
    fail('path-linkify 必须把裸路径改写成 Markdown 链接（交给官方 renderAnchor 打开）')
  } else if (!/PROTECTED_RE/.test(linkifySrc) || !/fence/.test(linkifySrc)) {
    fail('path-linkify 必须放过围栏代码块、行内代码与已有链接/图片')
  } else if (!/promoteStandaloneImagePath/.test(linkifySrc) || !/IMAGE_EXTS/.test(linkifySrc)) {
    fail('path-linkify 必须能把「整段只有一个图片路径」升级成 Markdown 图片语法（否则用户还是看不到图）')
  } else if (!/linkifyFilePaths\(promoteStandaloneImagePath\(source\)\)/.test(thinkSrc)) {
    fail('正文渲染必须真的调用 linkifyFilePaths(promoteStandaloneImagePath(...))')
  } else if (!/streaming\) return source/.test(thinkSrc)) {
    fail('裸路径改写只能在定稿文本上做（流式期半截路径会产出死链）')
  } else if (!/repairHandwrittenImagePath/.test(linkifySrc)) {
    fail('path-linkify 必须修手写的反斜杠图片路径（Markdown 把 \\_ 当转义符吃掉 → 图片无法预览）')
  } else {
    pass('path-linkify：裸路径 → 官方链接；单图路径 → 图片；代码块/行内代码/已有链接不动')
  }

  // 手写反斜杠图片路径：**这是模型最可能写出来的形式**（Windows 习惯），
  // 而 Markdown 里 `\` 是转义符 —— `![x](D:\a\_tmp\s.png)` 会被解析成
  // `D:a_tmps.png`，渲染出的 src 指向不存在的文件，用户看到「图片无法预览」。
  // 插件自己生成的链接走 encodePathForMarkdown 早已统一正斜杠，唯独手写的这一路
  // 被 PROTECTED_RE 当「已有链接，原样保留」放过了 —— 保护变成放行。
  {
    const probe = mod.linkifyFilePaths === undefined
      ? null
      : mod.linkifyFilePaths(mod.promoteStandaloneImagePath('![截图](D:\\AI\\Dsh\\_tmp\\a\\s.png)'))
    if (probe === null) {
      fail('缺少 linkifyFilePaths / promoteStandaloneImagePath 导出（手写反斜杠图片路径不可断言）')
    } else if (/\\/.test(probe)) {
      fail(`手写反斜杠图片路径必须被修成正斜杠，实得 ${probe}`)
    } else if (!/!\[截图\]\(D:\/AI\/Dsh\/_tmp\/a\/s\.png\)/.test(probe)) {
      fail(`修好的图片语法不对：${probe}`)
    } else {
      pass('path-linkify：手写反斜杠图片路径修正为正斜杠（否则 Markdown 转义吃掉 \\_ → 图片无法预览）')
    }
    // 尖括号包裹形式同样要修（`![x](<D:\a\b.png>)`）。
    const angle = mod.linkifyFilePaths === undefined
      ? null
      : mod.linkifyFilePaths('![截图](<D:\\AI\\Dsh\\a\\s.png>)')
    if (angle !== null && /\\/.test(angle)) {
      fail(`尖括号包裹的反斜杠图片路径也必须修，实得 ${angle}`)
    }
    // 普通链接的反斜杠**不能**碰（可能是 URL 或别的东西，改了反而出错）。
    const plainLink = mod.linkifyFilePaths === undefined
      ? null
      : mod.linkifyFilePaths('[文字](C:\\a\\b.txt)')
    if (plainLink !== null && plainLink !== '[文字](C:\\a\\b.txt)') {
      fail(`普通链接的反斜杠不该被改（只修图片语法），实得 ${plainLink}`)
    }
  }

  // 正文提及的范围补齐：官方 fileMentions 只在回合收口后、且只认本回合产出的
  // 文件；运行中的产出与历史文件必须由自建那条兜底。
  if (!/bodyEnv/.test(thinkSrc) || !/looksLikeFilePath/.test(thinkSrc)) {
    fail('正文必须挂自建文件提及（官方只认本回合写过的文件，运行中的产出点不动）')
  } else if (!/mergedMentions: MarkdownFileMentions \| undefined = selfMentions === undefined/.test(thinkSrc)
    || !/mentions\.resolve\(value\) \?\? selfMentions\.resolve\(value\)/.test(thinkSrc)) {
    fail('文件提及必须官方优先、自建兜底，且在 useMemo 里合流（identity 不稳会打穿流式缓存）')
  } else if (!/sessionIdProp/.test(thinkSrc)) {
    fail('正文提及必须拿到 sessionId（构造 dsh-resource 地址要用）')
  } else if (!/decorateCache/.test(thinkSrc)) {
    fail('定稿正文的路径改写必须按源文本缓存（长会话里每次重渲染重扫全文是白花开销）')
  } else {
    pass('正文提及：官方优先 + 自建兜底（memo 合流）+ sessionId 取自官方标准 prop + 改写缓存')
  }

  // 右栏操作面板：产出行必须有一枚可点的「预览」入口，且它不能顺带把卡片收起
  // （整行 header 是折叠热区）。
  // 注意：外层作用域的 cardSrc 指的是 KrLiveActivityCard；这里要的是操作面板卡。
  const plainCardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrPlainTimelineCard.tsx'), 'utf8')
  if (!code.includes('.kr-plain-step__open')) {
    fail('client bundle is missing the per-step preview button styles (.kr-plain-step__open)')
  } else if (!/function OpenFileChip/.test(plainCardSrc) || !/kr-plain-step__open/.test(plainCardSrc)) {
    fail('操作面板必须有 OpenFileChip（产出行右侧的「预览」入口）')
  } else if (!/className="kr-plain-step__open"[\s\S]{0,600}?event\.stopPropagation\(\)/.test(plainCardSrc)) {
    fail('「预览」按钮必须 stopPropagation（整行 header 是折叠热区，否则一点两变）')
  } else if (!/!failed && <OpenFileChip/.test(plainCardSrc)) {
    fail('「预览」入口只在成功的产出行出现（失败行的路径往往指向没写成的文件）')
  } else if (!/sessionId=\{sessionId\}/.test(plainCardSrc)) {
    fail('StepRow 必须收到 sessionId（打开预览要构造会话文件地址）')
  } else {
    pass('操作面板：产出行带可点「预览」入口（成功行才有 / 不误触折叠）')
  }

  // 相对路径图片：官方 ui-chat 传给 MarkdownText 的 resolver 只认绝对路径
  // （fileMediaUrl 对非绝对路径直接返回 undefined），所以 `![](shot.png)` 在
  // 对话流里只剩 alt 文本 —— 这正是「看不到图」的另一半。必须自挂一份
  // pathImages，把相对路径按会话工作区根补成绝对路径。
  if (!/pathImages/.test(thinkSrc) || !/localFileMediaUrl\(resolveWorkspacePath\(cwd, value\)\)/.test(thinkSrc)) {
    fail('正文必须自挂 pathImages（官方的图片 resolver 只认绝对路径，相对路径图片不显示）')
  } else if (!/pathImages=\{env\?\.pathImages\}/.test(thinkSrc)) {
    fail('pathImages 必须真的传给 MarkdownText（挂而不用等于没挂）')
  } else {
    pass('正文图片：自挂 pathImages 补全相对路径（绝对路径仍走官方同一条 /api/file）')
  }

  // 产出路径的来源：规则表显式声明的，或从工具结果里捞出来的（生图 / 交付这类
  // 工具的参数里没有目标路径，只有返回值写着文件在哪）。
  const langSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/plain-language.ts'), 'utf8')
  if (!/filePath\?:/.test(langSrc) || !/filePathFromResult/.test(langSrc)) {
    fail('plain-language 必须产出 filePath（规则声明 + 从结果兜底捞）')
  } else if (!/filePath: \(a\) => filePathOf\(a, 'file_path', 'path', 'filePath'\)/.test(langSrc)) {
    fail('写/改/读文件这类规则必须声明 filePath（否则产出行没有可点的文件）')
  } else if (!/RESULT_PATH_RE/.test(langSrc) || /BARE_RESULT_PATH_RE/.test(langSrc)) {
    // 2026-10-01：相对路径与裸斜杠整类不收（与 outputs.ts 同一口径）。前者基准是
    // 命令当时的 cwd（客户端拿不到），后者与 URL 的 path 段语法同构无法区分 ——
    // 两边判据必须一致，否则同一份工具输出在两张卡上会得到不同的路径。
    fail('从结果捞路径只能认盘符前缀（RESULT_PATH_RE），不得再有裸路径分支：'
      + '相对路径基准不可知、裸斜杠会收下 URL path 段')
  } else if (!/let last: string \| undefined/.test(langSrc)) {
    fail('从结果捞路径必须取最后一个命中（落盘位置通常在末尾）')
  } else if (/[A-Z_]*RESULT_PATH_RE = [^\n]*\\\.\{0,2\}/.test(langSrc)
    || /[A-Z_]*RESULT_PATH_RE = [^\n]*\\\\\.\{1,2\}/.test(langSrc)) {
    // 用户 2026-10-01 报的「产出物路径不全」：旧正则的前缀是 `\.{0,2}[\\/]`（零个
    // 点也允许），于是 `Saved: out/report.pdf` 被从中间的斜杠起匹配，截出一条
    // 点开必然 404 的 `/report.pdf`。后来连 `\.{1,2}[\\/]` 也去掉了 —— 相对路径
    // 整体不收。这条断言把两种写法都钉死，防它们再回来。
    // 只查**正则声明那一行**，注释里复述旧写法不算违规。
    fail('plain-language 的路径前缀只能是盘符：`\\.{0,2}[\\\\/]` 会把 out/report.pdf '
      + '从中间的斜杠起匹配截出 /report.pdf；`\\.{1,2}[\\\\/]` 同样要不得（相对路径基准不可知）')
  } else {
    pass('plain-language：filePath 规则声明 + 结果兜底（只认产出物扩展名）')
  }
}

// ── 产出物卡（会话累计的成品清单，滚动区最后一张） ───────────────────────
//
// 这张卡有四条**形态契约**，缺一条就从「点一下就看见」退化成「看着一堆文件名」：
//  1. 整行即入口 —— 行本身是 button，**没有**行内「预览」小按钮（多一枚只是把
//     同一句话说了两遍）；悬停箭头是 aria-hidden 的纯视觉提示。
//  2. 缩略图是**按类型画的 SVG**，不是 <img> 真实文件预览（28px 见方读不出画面，
//     而为每行发一次文件请求的代价与收益完全不成比例）。
//  3. 代码文件**不出现**（2026-10-19：源文件是材料不是成品，连计数都不留）。
//  4. **没有产出时整张卡不挂载**（2026-10-19 按用户要求）：空态由 KrAgentPanel
//     的 outputs.items.length > 0 拦掉，组件内部没有空态分支。
if (krEnabled) {
  const outputsCardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrOutputsCard.tsx'), 'utf8')
  const outputsSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/outputs.ts'), 'utf8')
  const outputsCode = outputsCardSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  const outputsEnabled = /export const KR_OUTPUTS_CARD_VISIBLE = (true|false)/
    .exec(readFileSync(resolve(ROOT, 'src/client/kr-chat/enabled.ts'), 'utf8'))?.[1] === 'true'
  const outputsPanelSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')

  if (!outputsEnabled) {
    fail('KR_OUTPUTS_CARD_VISIBLE 必须默认 true（产出物卡默认展示）')
  } else if (!code.includes('.kr-card--outputs') || !code.includes('.kr-out-row')) {
    fail('client bundle is missing the outputs card styles (.kr-card--outputs / .kr-out-row)')
  } else if (!/\\u4EA7\\u51FA\\u7269/.test(code)) {
    // bundle 里中文被 esbuild 转成字面 \uXXXX（大写 hex），正则里要写双反斜杠。
    fail('client bundle is missing the outputs card title (产出物)')
  } else if (!/kr-card__title[^)]*?\\u4EA7\\u51FA\\u7269/.test(code)) {
    fail('outputs card header must render the title 产出物')
  } else if (!/<button[\s\S]{0,400}?className="kr-out-row__main"/.test(outputsCode)) {
    fail('产出物行主体必须是真 button（键盘可达 + 触屏 :active），点它在官方右栏打开')
  } else if (/className="kr-out-row__open"/.test(outputsCode)) {
    // 2026-10-19 收口：行尾那枚「在侧栏打开」真按钮删掉了 —— 它与行主体做的是
    // 同一件事（都是官方右栏打开），一列行挂两枚图标只是把一句话说两遍。
    // 这里断言它**不再存在**，防的是日后有人把双出口加回来。
    fail('产出物行尾不得再有第二枚「在侧栏打开」按钮（行主体就是唯一出口）')
  } else if (!/aria-label=\{target === 'sidebar'[\s\S]{0,200}?在右侧栏查看[\s\S]{0,200}?用默认应用打开/.test(outputsCode)) {
    // 2026-10-22：点击按「侧栏能不能正常展示」分流，aria-label 必须**两条都在**——
    // 读屏用户靠它知道这一行点下去是进右栏还是拉起外部程序，只写一条就是错误信息。
    fail('行主体 aria-label 必须按落点分两套（侧栏「在右侧栏查看」/ 外部「用默认应用打开」）')
  } else if (!/if \(canShowInSidebar\(path\)\)[\s\S]{0,600}?tryOpenInSidebar\(path, \{ sessionId, cwd \}\)/.test(outputsCode)) {
    // 2026-10-22 用户口径：**侧栏能正常展示的走侧栏**，判据收敛在 sidebar-display.ts。
    // 顺序必须是「先判类型、先试侧栏」，否则图 / PDF / 视频又会把外部程序整窗拉起来。
    fail('产出物行点击必须先按 canShowInSidebar 分流，可展示的直接 tryOpenInSidebar（不得先拉起系统应用）')
  } else if (!/await openOutputFile\(path, \{ cwd \}\)/.test(outputsCode)) {
    // 2026-10-21：系统默认那条走本插件 /api/chat-flow/open-file。
    // 官方那条对相对路径的解析基准是 host 进程 cwd，且 Windows 上从不把 .html
    // 交给默认浏览器 —— 两条叠起来就是用户报的「点产出物里的 html 打不开」。
    fail('侧栏展示不了的条目必须走本插件 openOutputFile（/api/chat-flow/open-file：按会话工作区绝对化 + 默认浏览器）')
  } else if (!/const result = await openOutputFile\(path, \{ cwd \}\)[\s\S]{0,900}?resolveWorkspacePath\(cwd, path\)[\s\S]{0,200}?openWithDefaultApp\(absolute\)/.test(outputsCode)) {
    // 退回官方链路时**必须补成绝对路径**：官方 verifyDesktopPath 用 host 进程 cwd
    // 解析相对路径，直接传相对路径正是 bug 本身。
    fail('退回官方 openWithDefaultApp 时必须先 resolveWorkspacePath 补成绝对路径（相对路径会被 host cwd 解析错）')
  } else if (!/className="kr-out-row__go"/.test(outputsCode) || !/data-target=\{target\}/.test(outputsCode)) {
    fail('行尾必须保留纯视觉落点图标（kr-out-row__go + data-target，aria-hidden），侧栏 / 外部两枚形状不同')
  } else if (/canInlinePreview|MediaLightbox/.test(outputsCode)) {
    // 2026-10-19：插件自带的 Lightbox 整套删除，预览一律交官方侧边栏。
    fail('产出物卡不得再引用 canInlinePreview / MediaLightbox（预览出口只有官方侧边栏）')
  } else if (/<img\b/.test(outputsCode)) {
    fail('缩略图必须是按类型画的 SVG，不得用 <img> 拉真实文件（28px 见方读不出画面，且每行一次请求）')
  } else if (!/function Thumb\(\{ kind \}/.test(outputsCode) || !/case 'model3d':/.test(outputsCode)) {
    fail('缩略图必须按 OutputKind 分派（image/video/model3d/doc/sheet/archive/code…）')
  } else if (/kr-out-code/.test(outputsCode) || /outputs\.code|\bcode\.length\b|rawCode/.test(outputsCode)) {
    // 2026-10-19 按用户要求整类移除：源文件是材料不是成品，连「另有 N 个代码文件」
    // 这行计数也不要。这里断言它**彻底不存在**，防的是日后有人把折行加回来。
    fail('代码文件不得出现在产出物卡（含「另有 N 个代码文件」折行）—— 材料不进成品清单')
  } else if (/Kind === 'code'|kind: 'code'/.test(outputsSrc)) {
    fail('收集层不得再产出 code 类条目（MATERIAL_KINDS 负责整类丢弃）')
  } else if (/本次会话还没有产出文件|kr-out-empty/.test(outputsCode)) {
    // 2026-10-19 按用户要求：没产出时整张卡不出现（原先常驻一行空态）。
    // 断言它**彻底不存在**，防的是日后把"常驻空壳"加回来。
    fail('产出物卡不得渲染空态（无产出时整卡不挂载，由 KrAgentPanel 拦）')
  } else if (!/outputs\.items\.length > 0 && \(\s*<KrOutputsCard/.test(outputsPanelSrc)) {
    fail('挂载方必须用 outputs.items.length > 0 拦住空态下的产出物卡（没产出就不出现）')
  } else if (!/KrOutputsCard[\s\S]{0,600}?squeezed=\{panelSqueezed\}/.test(outputsPanelSrc)) {
    fail('右栏挤压时必须把 squeezed 传给产出物卡（默认露出条数降一档）')
  } else if (!/<KrSubagentsCard[\s\S]{0,1200}?<KrPlainTimelineCard[\s\S]{0,1500}?<KrTaskOverviewCard[\s\S]{0,1500}?<KrOutputsCard/.test(outputsPanelSrc)) {
    /*
     * 2026-10-24 第四轮定稿的顺序：子智能体 → 操作面板 → 任务概览 → 产出物。
     *
     * 「操作面板位置恒定」这件事**完全由前一站保证**：子智能体卡固定 5 行，
     * 卡高与内容无关，所以紧贴其下的操作面板永远停在同一位置。这条顺序断言
     * 与上一条 height 断言是一对，缺任何一个「恒定」都不成立：
     *   · 没有 height 固定 → 子智能体多几个，操作面板就往下挪几行；
     *   · 不在子智能体下面 → 上面换成任何会变高的卡（比如任务概览），照样挪。
     *
     * 唯一允许的位移：一个子智能体都没有时那张卡整张不渲染，操作面板上移 5 行。
     * 那是用户明确选的取舍（「没有子智能体的时候也不要显示」）。
     */
    fail('右栏滚动区卡片顺序必须是 子智能体 → 操作面板 → 任务概览 → 产出物'
      + '（操作面板必须在固定 5 行的子智能体卡正下方，位置才恒定）')
  } else if (typeof mod.canShowInSidebar !== 'function') {
    fail('client bundle 必须导出 canShowInSidebar（点击分流判据要能被离线断言）')
  } else {
    /*
     * 点击分流判据（2026-10-22）：**侧栏能正常展示的走侧栏，其余走系统默认**。
     *
     * 判错的代价不会报错，只会让某个类型去错地方 —— 图点出一整个 PowerPoint，
     * 或者 3D 模型点开得到一句"不支持预览"。所以逐档钉死：
     *   · 真渲染（官方内置 + 插件接管）→ true
     *   · 只能看源码（rtf / xhtml / obj / gltf / dae）→ false（用户要的是成品形态）
     *   · 空态（avif/tif/heic、7 种压缩包）→ false
     *   · not-text（blend / glb / 3ds）→ false
     */
    const yes = [
      'a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.bmp', 'a.ico', 'a.svg', 'a.gif',
      // 媒体：只列**实测浏览器真能解码**的容器（2026-10-24 Chromium 154 灌真实
      // 文件逐个验证）。avi / wma 不在这里 —— 它们的播放器能挂出来，但一帧都解
      // 不出（三种 MIME 声明全 SRC_NOT_SUPPORTED），留在 yes 等于断言「黑播放器
      // 也算能看」。它们归 no。
      'a.mp4', 'a.webm', 'a.mov', 'a.mkv', 'a.m4v',
      'a.mp3', 'a.wav', 'a.flac', 'a.aac', 'a.ogg', 'a.m4a', 'a.opus',
      'a.md', 'a.markdown', 'a.txt',
      'a.doc', 'a.docx', 'a.odt', 'a.pdf',
      'a.csv', 'a.tsv', 'a.xls', 'a.xlsx', 'a.ods',
      'a.ppt', 'a.pptx', 'a.odp',
      'a.html', 'a.htm',
      // 大小写与反斜杠分隔符也要认（Windows 路径 + 会话里常见的大写后缀）
      'D:\\out\\报告.PNG',
    ]
    const no = [
      // 只能看源码
      'a.rtf', 'a.xhtml', 'a.obj', 'a.gltf', 'a.dae',
      // 官方图片渲染器不认、且在 UNVIEWABLE 里
      'a.avif', 'a.tif', 'a.tiff', 'a.heic',
      // 压缩包
      'a.zip', 'a.7z', 'a.rar', 'a.tar', 'a.gz', 'a.bz2', 'a.xz',
      // 既没注册也不在 UNVIEWABLE、落纯文本兜底后 not-text
      'a.blend', 'a.fbx', 'a.glb', 'a.3ds', 'a.stl', 'a.ply',
      // 浏览器解不了的媒体容器（2026-10-24 实测：播放器能挂出来，一帧都解不出）。
      // avi = Video for Windows，wma = Windows Media Audio，三种 MIME 声明全失败。
      // 判成 external 才是「点开就看见」—— 系统播放器本来就能放。
      'a.avi', 'a.wma',
      // 没有扩展名 / 空串
      'noext', '',
    ]
    const wrongYes = yes.filter((p) => mod.canShowInSidebar(p) !== true)
    const wrongNo = no.filter((p) => mod.canShowInSidebar(p) !== false)
    if (wrongYes.length > 0) {
      fail('可以侧栏展示却判成外部：' + wrongYes.join(', '))
    } else if (wrongNo.length > 0) {
      fail('侧栏展示不了却判成侧栏（点开只会是空态/乱码）：' + wrongNo.join(', '))
    } else if (mod.sidebarDisplayOf('a.png') !== 'sidebar' || mod.sidebarDisplayOf('a.zip') !== 'external') {
      fail('sidebarDisplayOf 的落点标签必须与 canShowInSidebar 同口径')
    } else {
      /*
       * 判据表与两个接管渲染器的 CLAIMED_EXTENSIONS 必须同源。
       *
       * 这三处任何一处漂移都是静默 bug：判据说能、渲染器没接管 → 点开是官方空态；
       * 渲染器接管了、判据没算 → 明明能看却被推去外部程序。用「包含」而不是
       * 「相等」：判据可以比渲染器多（官方的 md/html/图片/pdf 不在插件渲染器里）。
       */
      const docSrc = readFileSync(resolve(ROOT, 'src/client/sidebar-doc/index.tsx'), 'utf8')
      const mediaSrc = readFileSync(resolve(ROOT, 'src/client/sidebar-media/index.tsx'), 'utf8')
      const docClaimed = /const CLAIMED_EXTENSIONS = \[([^\]]+)\]/.exec(docSrc)?.[1] ?? ''
      const mediaClaimed = /const VIDEO_EXTENSIONS = \[([^\]]+)\]/.exec(mediaSrc)?.[1] ?? ''
      const mediaAudio = /const AUDIO_EXTENSIONS = \[([^\]]+)\]/.exec(mediaSrc)?.[1] ?? ''
      const claimed = [...(docClaimed + ',' + mediaClaimed + ',' + mediaAudio).matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1])
      // 注意不能写 `pluginExt instanceof Set`：bundle 跑在 vm sandbox 里，Set 是
      // 另一个 realm 的构造器，instanceof 恒为 false（实测过一次，报"全漏"）。
      // 用 Array.from 转成数组再比对，跨 realm 稳妥。
      const pluginExt = new Set(Array.from(mod.PLUGIN_RENDERED_EXT ?? []))
      const undecodable = new Set(Array.from(mod.BROWSER_UNDECODABLE_MEDIA_EXT ?? []))
      /*
       * 「渲染器接管了」与「判据算它能展示」是**两件有意分开的事**。
       *
       * 2026-10-24 之前这里断的是 claimed ⊆ pluginExt（同源）。加入 avi / wma
       * 之后这条不成立，改断 claimed ⊆ (pluginExt ∪ undecodable)：
       *  · 渲染器**必须**接管 avi / wma —— 官方把它们列进 UNVIEWABLE，不接管的话
       *    用户从文件树点开时连播放器都没有、没有任何重试或转交入口；
       *  · 但判据**不该**把它们算成「能正常展示」—— 实测浏览器一帧都解不出，
       *    送进侧栏只会得到一个黑格子。它们交系统默认应用，这才是好的落点。
       *
       * 额外钉住两条反向断言：这两个后缀必须真的在 undecodable 里；实测能播的
       * mkv / mov 不许被塞进去（塞进去等于把好文件推去外部程序）。
       */
      const covered = new Set([...pluginExt, ...undecodable])
      const missing = claimed.filter((ext) => !covered.has(ext))
      if (missing.length > 0) {
        fail('sidebar-display 既没把接管渲染器的扩展名算进 PLUGIN_RENDERED_EXT，'
          + '也没把它标进 BROWSER_UNDECODABLE_MEDIA_EXT：' + missing.join(', ')
          + '（每个被接管的扩展名都必须有明确落点，否则判据与渲染器漂移）')
      } else if (!undecodable.has('avi') || !undecodable.has('wma')) {
        fail('avi / wma 必须标进 BROWSER_UNDECODABLE_MEDIA_EXT（2026-10-24 Chromium 154 '
          + '灌真实文件实测：三种 MIME 声明全部 SRC_NOT_SUPPORTED，容器不在解码面里）')
      } else if (undecodable.has('mkv') || undecodable.has('mov')) {
        fail('mkv / mov 实测能解码（mkv 声明 video/x-matroska 可播、mov 声明 video/mp4 可播），'
          + '不得标进 BROWSER_UNDECODABLE_MEDIA_EXT')
      } else if (!pluginExt.has('ods')) {
        fail('ods 必须由插件接管（host 引擎本来就支持，官方 UNVIEWABLE 挡着 —— 不接管只能看空态）')
      } else {
        pass('产出物卡：整行可点 + SVG 类型缩略图 + 无代码文件 + 无产出时整卡不挂载（滚动区最后一张）')
        pass('点击分流判据：' + yes.length + ' 类能侧栏展示 / ' + no.length + ' 类交系统默认（含 ods 接管、大小写与反斜杠路径）')
        /*
         * 侧栏渲染器的**失败态第二出口**（2026-10-24）。
         *
         * 用户原话：「不支持侧边栏预览的用系统默认方式打开」。分流判据只覆盖
         * 「点开之前就知道展不了」的那一半；另一半是**点开之后才发现展不了**
         * —— 引擎没装、格式转换失败、容器解码面覆盖不到。那时如果失败态只有
         * 一枚「重试」，用户就被关在一个只会循环报错的格子里，而磁盘上的文件
         * 明明双击就能看。两个渲染器都要有这条出口，缺一个就少一半场景：
         *  · sidebar-doc 管 pdf / Office / ods；
         *  · sidebar-media 管视频 / 音频。
         */
        const docRendererSrc = readFileSync(resolve(ROOT, 'src/client/sidebar-doc/index.tsx'), 'utf8')
        const mediaRendererSrc = readFileSync(resolve(ROOT, 'src/client/sidebar-media/index.tsx'), 'utf8')
        const hasExit = (text) => /用系统默认应用打开/.test(text) && /openOutputFile\(openTarget\)/.test(text)
        if (!hasExit(docRendererSrc)) {
          fail('sidebar-doc 的失败态必须有「用系统默认应用打开」出口（openOutputFile(openTarget)）：'
            + '引擎不可用 / 转换失败时，用户需要交给他自己的 Office 打开，而不是只剩重试')
        } else if (!hasExit(mediaRendererSrc)) {
          fail('sidebar-media 的失败态必须有「用系统默认应用打开」出口（openOutputFile(openTarget)）：'
            + '容器解码不了时，重试一万次还是同一个结果，必须能交给系统播放器')
        } else if (!/const openTarget = parsed === null[\s\S]{0,220}?resolveWorkspacePath\(workspaceCwdOf\(parsed\.sessionId\), parsed\.path\)/.test(mediaRendererSrc)
          || !/const openTarget = parsed === null[\s\S]{0,220}?resolveWorkspacePath\(workspaceCwdOf\(parsed\.sessionId\), parsed\.path\)/.test(docRendererSrc)) {
          fail('失败态出口必须先把侧栏地址里的相对路径折成绝对（resolveWorkspacePath(cwd, path)）—— '
            + '直接发相对路径会被 host 的 resolveTarget 拒掉')
        } else if (!/onError=\{onMediaError\}/.test(mediaRendererSrc)
          || !/const onMediaError = useCallback/.test(mediaRendererSrc)) {
          /*
           * 第二出口的**触发条件**：播放器真解码失败时必须转 failed 态。
           *
           * 只加按钮不接 error 事件等于白加 —— ready 判定只看 HEAD 探测成功，
           * 那只证明文件读得到，不证明浏览器解得出。avi / wma 会一路走到 ready：
           * 播放器挂出来、UI 正常、画面全黑、没有任何按钮（2026-10-24 之前的实际形态）。
           */
          fail('sidebar-media 的播放器必须挂 onError 并转到 failed 态（onMediaError）：'
            + '不接解码失败事件，第二出口永远不会出现 —— 用户只能对着黑画面')
        } else if (!/媒体.*解不了|浏览器解不了这个容器/.test(mediaRendererSrc)) {
          fail('onMediaError 必须把 SRC_NOT_SUPPORTED 说成人话（「浏览器解不了这个容器」），'
            + '而不是只弹一个通用失败')
        } else {
          pass('侧栏渲染器失败态：两个渲染器都有「用系统默认应用打开」第二出口（绝对路径 + openOutputFile）')
          pass('媒体解码失败：<video>/<audio> 挂 onError → failed 态（否则第二出口永远不出现）')
        }
      }
    }
  }

  // 「用默认应用打开」通道（2026-10-20）：画廊与产出物卡的主入口。
  //
  // 三个决定必须被断言钉住，缺一即回归：
  //  ① **走官方 Remote，不自建 host 路由**：`remote.session.openWorkspacePath`
  //     （省略 action / application 才是「默认程序」）。自建一条同义路由等于把
  //     「打开本机文件」这个能力再开一个口子；
  //  ② **双路查找服务**：Gateway 把每个命名空间注册成独立 Service
  //     （`remote.session`），根 `remote` 也可能挂同名属性 —— 只认一条时宿主
  //     一升级就整个失效（open-preview.ts 里踩过同一个坑）；
  //  ③ **两处主入口都换了**，且都保留了降级：开不了就退回原来的内置预览，
  //     而不是「点了没反应」。
  {
    const openerSrc = readFileSync(resolve(ROOT, 'src/client/open-default-app.ts'), 'utf8')
    const openerCode = openerSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    const gallerySrc = readFileSync(resolve(ROOT, 'src/client/triad/gallery/GalleryPanel.tsx'), 'utf8')
    const lightboxSrc = readFileSync(resolve(ROOT, 'src/client/triad/gallery/media-lightbox.tsx'), 'utf8')

    if (!/openWorkspacePath/.test(openerCode)) {
      fail('默认应用打开必须走官方 remote.session.openWorkspacePath（shell-open 语义，窗口不会被 windowsHide 吞掉）')
    } else if (/action:\s*'open'/.test(openerCode) || /action:\s*"open"/.test(openerCode)) {
      // 官方契约里 action 只有 'reveal'；写成 'open' 会被 host 判成非法动作。
      fail("openWorkspacePath 不得传 action: 'open'（官方只认 'reveal'，默认应用是「不传 action」）")
    } else if (!/'remote\.session'/.test(openerCode) || !/remote\.session|name of \['remote/.test(openerCode)) {
      fail('remote.session 必须双路查找（独立 Service 名 + 根 remote 上的同名命名空间）')
    } else if (!/unavailable/.test(openerCode) || !/failed/.test(openerCode) || !/opened/.test(openerCode)) {
      fail('打开结果必须分三态（opened / unavailable / failed）：无桌面与打开失败对调用方的处置完全不同')
    } else if (!/desktopOpeningAvailable/.test(openerCode) || !/canOpenWorkspacePath/.test(openerCode)) {
      fail('调用前必须问一次 canOpenWorkspacePath 并缓存结论（手机远程访问时每次点击都空跑一次往返）')
    } else if (!/openAbsolute\(item\.path\)/.test(gallerySrc) || !/openWithDefaultBrowser\(target\)/.test(gallerySrc)) {
      // 2026-10-21：主出口换成插件 open-file（.html 才会进默认浏览器），
      // 官方 openWithDefaultApp 作为 'unavailable' 时的兜底仍在（下一条断言钉住）。
      fail('画廊卡片点击必须先交给系统打开（open-file → 默认浏览器），不得直接弹内置弹窗')
    } else if (!/openWithDefaultApp\(target\)/.test(gallerySrc)) {
      fail('画廊必须保留官方 openWithDefaultApp 作为路由未就绪时的兜底')
    } else if (!/setLightboxIndex\(visible\.indexOf\(item\)\)/.test(gallerySrc)) {
      fail('画廊必须保留内置弹窗作为降级出口（宿主没有桌面时原样退回，不能点了没反应）')
    } else if (!/materializeGenerated/.test(gallerySrc)) {
      fail('生图条目必须先落盘再打开：spill 的 .txt 交给默认应用只会弹记事本')
    } else if (!/onOpenDefaultApp/.test(lightboxSrc)) {
      fail('画廊弹窗必须留一枚「用默认应用打开」按钮（看到了想拿去用的那一刻就在弹窗里）')
    } else {
      pass('默认应用打开：走官方 remote.session + 三态收敛 + 画廊/弹窗/产出物三处入口 + 保留内置预览降级')
    }
  }

  // 对话滚动守卫（2026-10-04 修「点一下就跑到下面」）：常驻状态机在
  // KrAgentPanel 挂载，只对抗「无用户意图 + 短窗口落底」这一种官方跟随指纹。
  {
    const guardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/scroll-guard.ts'), 'utf8')
    const guardCode = guardSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    if (!/data-conversation-scroll/.test(guardCode)) {
      fail('滚动守卫必须挂在官方滚动容器 [data-conversation-scroll] 上')
    } else if (!/restores >= MAX_RESTORES/.test(guardCode) || !/MAX_RESTORES = 12/.test(guardCode)) {
      fail('滚动守卫必须限次回滚（持续对抗说明跟随是用户此刻的真实意图，必须让位）')
    } else if (!/SCROLL_KEYS/.test(guardCode) || !/wheel/.test(guardCode) || !/pointerdown/.test(guardCode)) {
      fail('滚动守卫必须识别用户意图（wheel / 滚动键 / 滚动区 pointerdown），意图窗口内只重定基线')
    } else if (!/JUMP_WINDOW_MS = 900/.test(guardCode)) {
      fail('守卫的跳变判定窗口必须是 900ms（官方跟随拽人的指纹是短窗口落底）')
    } else if (!/installConversationScrollGuard/.test(readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8'))) {
      fail('KrAgentPanel 必须挂载滚动守卫（KR 视图常驻）')
    } else {
      pass('对话滚动守卫：常驻状态机 + 意图窗口 + 限次回滚 + 官方容器钩子')
    }
  }

  // 滚动守卫 · iframe 滚轮缺口（2026-10-20 修「出现 html / iu 卡片后鼠标滚不动」）。
  //
  // 事故形态：html 卡片是 opaque origin 的 iframe，里面的 wheel 事件**不会冒泡到
  // 宿主文档**（实测宿主侧 wheel 计数恒为 0，对话流照样在滚）。守卫原来只认宿主
  // 侧 wheel 事件判断「这次滚动是用户干的」，收不到就把用户自己滚到底误判成官方
  // 跟随拽人、直接回滚 —— 表现为鼠标停在卡片上滚不动 / 一滚就被弹回去。
  //
  // 断言两组，缺一即回归：
  //  ① iframe 侧必须上报滚动意图（bridge 里的 scroll-intent）；
  //  ② 守卫必须有一条不依赖事件的判据（连续滚动串 / 斜率），否则事件通道一断
  //     就退回到「无意图 = 官方拽人」的误判。
  {
    const bridgeSrc = readFileSync(resolve(ROOT, 'src/client/html-embed/bridge.ts'), 'utf8')
    const htmlCardSrc = readFileSync(resolve(ROOT, 'src/client/html-embed/HtmlCard.tsx'), 'utf8')
    const guardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/scroll-guard.ts'), 'utf8')
    const guardCode = guardSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    if (!/scroll-intent/.test(bridgeSrc)) {
      fail('html 卡片 iframe 必须上报滚动意图（scroll-intent）：iframe 内 wheel 不会冒泡到宿主，不上报就无法区分「用户滚」与「官方拽人」')
    } else if (!/noteConversationScrollIntent/.test(htmlCardSrc)) {
      fail('HtmlCard 必须接收 scroll-intent 并登记到守卫（否则 bridge 上报了也没人用）')
    } else if (!/export function noteConversationScrollIntent/.test(guardCode)) {
      fail('scroll-guard 必须导出 noteConversationScrollIntent（跨模块意图登记入口）')
    } else if (!/externalIntentUntil/.test(guardCode)) {
      fail('守卫必须把外部上报的意图并入意图窗口判断')
    } else if (!/looksUserDriven/.test(guardCode) || !/SLOPE_MAX/.test(guardCode) || !/STREAK_WINDOW_MS/.test(guardCode)) {
      fail('守卫必须有「不依赖事件」的判据（连续滚动串 / 斜率闸门），否则滚轮事件被 iframe 吞掉时会误判用户滚动为官方拽人')
    } else if (!/attached !== current/.test(guardCode) && !/current !== attached/.test(guardCode)) {
      fail('守卫必须在滚动容器被替换后重挂（会话切换会让原节点脱离文档，守卫静默失效）')
    } else {
      pass('滚动守卫 · iframe 缺口：意图上报 + 外部登记 + 连续滚动串判据 + 容器替换重挂')
    }
  }

  // 收集层（纯函数）：只列成品、只认本地文件、按节点缓存。
  if (!/export function collectOutputs/.test(outputsSrc) || !/export function classifyOutput/.test(outputsSrc)) {
    fail('outputs.ts 必须导出 collectOutputs / classifyOutput（纯函数，可在 smoke 里直接断言）')
  } else if (!/const perNodeCache = new WeakMap/.test(outputsSrc)) {
    fail('outputs.ts 必须按节点缓存：流式期快照每个 delta 发布一次，逐帧重扫结果文本是白花开销')
  } else if (!/ARG_PATH_TOOLS/.test(outputsSrc) || !/RESULT_PATH_TOOLS/.test(outputsSrc)) {
    fail('outputs.ts 必须把参数路与结果路的工具集**分开**：上传的 paths 是用户给的源文件、'
      + '命令行的参数是输入（-i in.mp4），都不该算成"我做出来的"')
  } else if (!/gif: 'video'/.test(outputsSrc) || !/blend: 'model3d'/.test(outputsSrc)) {
    fail('outputs.ts 的类别表必须把 gif 归 video、blend 归 model3d（截图里那两类产出物）')
  } else if (!/ts: 'code'/.test(outputsSrc) || !/py: 'code'/.test(outputsSrc)
    || !/KIND_BY_EXT\[extOf\(path\)\] \?\? 'other'/.test(outputsSrc)) {
    fail('outputs.ts 仍须把代码类归 code、认不出的扩展名归 other（前者供 MATERIAL_KINDS 丢弃，后者不列）')
  } else if (!/MATERIAL_KINDS/.test(outputsSrc) || !/MATERIAL_KINDS\.has\(kind\)/.test(outputsSrc)) {
    // 2026-10-19：code 归了类但**不进卡** —— 判类与"收不收"分成两张表，
    // 「哪些扩展名算源码」仍然只有 KIND_BY_EXT 一处定义。
    fail('outputs.ts 必须用 MATERIAL_KINDS 把 code 整类丢弃（源码是材料不是成品）')
  } else if (!/html: 'page'/.test(outputsSrc) || /html: 'code'/.test(outputsSrc)) {
    // 用户报的 BUG：做出来的 .html 演示页被折进「另有 N 个代码文件」，成品就此
    // 消失在一个计数里。.html 对用户是"能打开的页面"（成果），.ts/.css 才是"做
    // 页面的材料"，两者不能同类。
    fail('outputs.ts 必须把 html/htm 归 page（能打开的页面），不得归 code —— '
      + '归 code 会让做出来的演示页被 MATERIAL_KINDS 整类丢掉，成品就此从卡里消失')
  } else if (!/case 'page':/.test(outputsCode)) {
    fail('缩略图必须为 page 类别分派一枚图形（浏览器窗口），不能落进 default 的通用文档形')
  } else if (!/SPILL_PATH_RE/.test(outputsSrc) || !/dsh-spill-/.test(outputsSrc)) {
    // 用户报的 BUG：卡里出现了 `*-pwsh.txt`。那是 DSH 把超长工具结果落到
    // %TEMP%/dsh-spill-*/session-*/ 的临时文件，路径必然出现在结果文本里。
    fail('outputs.ts 必须排除 DSH 的 spill 临时目录（它的路径必然出现在结果文本里，但不是产出）')
  } else if (!/SAVE_VERB_RE/.test(outputsSrc) || !/pathsInSaveContext/.test(outputsSrc)) {
    // 用户报的 BUG 的另一半：目录列表会把**别的会话生成的文件**也列出来。
    fail('结果路必须只在「落盘说明」上下文里取路径：Get-ChildItem / ls -R / git status '
      + '会把已有文件（含别的会话的）列出来，无差别扫描就会把它们当成本次产出')
  } else if (/const BARE_PATH_RE\s*=/.test(outputsSrc) || /function scanBare\s*\(/.test(outputsSrc)
    || /scanBare\(line\)/.test(outputsSrc)) {
    // 2026-10-01：相对路径整类不收。基准目录是**命令执行时的 cwd**，客户端拿不到
    // （`cd sub && python x.py` 里的 out/a.png 落在 sub/ 下），按会话工作区拼出来的
    // 路径指向别处的文件 —— 实测那 3 条 ../ui-chat/README.zh.md 全是文档正文里的
    // 相对链接，没有一条是产出。要收这类产出，模型得用绝对路径或 present 交付。
    fail('outputs.ts 不得再保留裸相对路径正则（BARE_PATH_RE / scanBare）：'
      + '相对路径的基准是命令当时的 cwd，按会话工作区解析会指向别处的文件')
  } else if (!/hasSeparator/.test(outputsSrc)) {
    fail('outputs.ts 必须用 hasSeparator 挡掉正文里的纯文件名引用（report.md 不是产出）')
  } else if (!/SLASH_PATH_RE/.test(outputsSrc) || !/\(\?<!\[A-Za-z\]:\)/.test(outputsSrc)) {
    // 用户 2026-10-01 报的「产出物路径不全」：卡里出现 `/report.pdf`、`/报告.pdf`。
    // 根因是 RESULT_PATH_RE 的左边界是**排除式黑名单**，放行了 `|`、`=` 这类
    // 格式化分隔符 —— 于是 `items: [ 'pdf|/report.pdf' ]` 里的 `out/report.pdf`
    // 被从中间的斜杠起匹配，截出一条点开必然 404 的残片。修法是把裸斜杠前缀
    // 拆成独立的 SLASH_PATH_RE，左边界改**白名单**（只认行首/空白/引号/括号/标点）。
    // lookbehind 挡掉盘符后的斜杠，否则 `D:/out/a.png` 会再被截成 `/out/a.png`。
    fail('outputs.ts 必须把裸斜杠前缀拆成 SLASH_PATH_RE（白名单左边界 + 盘符 lookbehind）：'
      + '排除式左边界会把 `pdf|/report.pdf` 里的相对路径截成残片')
  } else if (/scan\(scrubbed, ALL_PREFIX_RE\)/.test(outputsSrc)) {
    // 用户 2026-10-01 报的「产物点开路径永远不对」：卡里那条 index.html 来自
    // `GET /index.html -> 404` —— 一条探测 URL 的命令，斜杠被 token 切分吃掉后
    // 「index.html 在命令里被写出」成立，证据 2 就把它收成了产出物，右栏打开
    // 空 tab、路径行原样显示 `/index.html`。裸斜杠与 URL path 段语法同构，
    // 无法区分，所以证据 2 整类禁掉它；证据 1（落盘说明）保留。
    fail('证据 2 不得扫 ALL_PREFIX_RE：`GET /index.html -> 404` 这类 URL 探活结果'
      + '会被收成产出物（斜杠路径与 URL path 段同构，无法区分）')
  } else if (!/DECLARED_PREFIX_RE = \[RESULT_PATH_RE\]/.test(outputsSrc)
    || !/ALL_PREFIX_RE = \[RESULT_PATH_RE, SLASH_PATH_RE\]/.test(outputsSrc)) {
    fail('两条证据必须各用各的正则集：证据 1 走 ALL_PREFIX_RE，证据 2 走 DECLARED_PREFIX_RE')
  } else if (!/scan\(scrubbed, DECLARED_PREFIX_RE\)/.test(outputsSrc)) {
    fail('证据 2 必须显式用 DECLARED_PREFIX_RE 扫（漏了它就会退回全量扫描，URL 残片复发）')
  } else if (!/looksLikeOwnPathLine/.test(outputsSrc) || !/isCommentLikeLine/.test(outputsSrc)) {
    // 2026-10-01 端到端实测（headless Chrome 连真实宿主）：读插件源码时，注释行
    // 「脚本自己落盘」命中动词闸门 → 下一行 ` * 理由是 \`/index.html\` …` 被当成
    // 落盘上下文 → 那个与产出无关的 /index.html 进了卡（点开正是空白 tab）。
    // 两道门：① 注释/引用行不参与落盘上下文；② 下一行必须自己就像绝对路径。
    fail('落盘上下文必须排除注释/引用行（isCommentLikeLine），且「下一行」必须自己'
      + '就像绝对路径（looksLikeOwnPathLine）—— 否则读源码/文档时示例路径会被收成产出')
  } else if (!/save\.sameLine/.test(outputsSrc) || !/save\.nextLine/.test(outputsSrc)) {
    fail('证据 1 必须把「同一行」与「下一行」分开处理（同一行走全集，下一行收窄）')
  } else if (!/TRANSIENT_DIR_RE/.test(outputsSrc) || !/isTransientOutputPath/.test(outputsSrc)
    || !/!delivered && isTransientOutputPath\(path\)/.test(outputsSrc)) {
    // 用户 2026-10-01：33/80 条失效路径来自 `_tmp/` —— 那是一致性中转约定目录，
    // dsh-webui 清理器会定期清空它，列出来注定点不开。模型显式交付（present）
    // 的例外：那是它自己声明的最终位置。
    fail('outputs.ts 必须排除一次性中转目录 `_tmp/`（非交付路径），'
      + '并放行 present 显式交付的同目录路径')
  } else if (!/export type ProbeResult/.test(readFileSync(resolve(ROOT, 'src/client/open-preview.ts'), 'utf8'))
    || !/probeWorkspaceFile/.test(readFileSync(resolve(ROOT, 'src/client/open-preview.ts'), 'utf8'))
    || !/probeWorkspaceFiles/.test(readFileSync(resolve(ROOT, 'src/client/open-preview.ts'), 'utf8'))) {
    // 用户 2026-10-01：点开永远不对的**表层**原因 —— 官方右栏对不存在的路径不报错，
    // 只开一个空白 tab。所以打开前必须 stat 一次，把 missing 与「探测失败」分开。
    fail('open-preview.ts 必须导出三态探测（exists / missing / unknown）：'
      + '把探测失败也当成 missing 会让整卡在宿主降级时集体置灰')
  } else if (!/workspace-file\/not-found/.test(readFileSync(resolve(ROOT, 'src/client/open-preview.ts'), 'utf8'))) {
    fail('探测必须按 Host 的 not-found / not-regular-file 错误码判定 missing，'
      + '其余错误一律 unknown')
  } else if (!/probeWorkspaceFile\(path, \{ sessionId \}\)/.test(outputsCardSrc)) {
    fail('产出物卡点击前必须 probeWorkspaceFile 一次（missing 就不开 tab）')
  } else if (!/gonePaths/.test(outputsCardSrc) || !/setGonePaths/.test(outputsCardSrc)) {
    // 用户 2026-10-01 的要求：「已失效的究竟文件还存不存在呢，不存在还显示出来干嘛，
    // 我要的是真实有效的」。所以核对确认不存在的条目**直接从清单剔除**，不置灰、
    // 不留行 —— 这张卡的全部价值是「点一下就看见」，列一条点不开的就是在骗人。
    fail('产出物卡必须把核对确认不存在的条目从清单里剔除（gonePaths）：'
      + '用户要的是真实有效的产出，不是一条点不开的「已失效」')
  } else if (!/rawItems\.filter\(\(item\) => !gonePaths\.has\(item\.path\)\)/.test(outputsCardSrc)) {
    fail('过滤必须作用在渲染清单上（items = rawItems.filter(不在 gonePaths)）')
  } else if (/data-stale/.test(outputsCode) || /kr-out-row__stale/.test(outputsCode)) {
    // 置灰保留那一版已被用户否掉：卡里不该再有失效态的行。
    fail('产出物卡不得再渲染失效态行（data-stale / kr-out-row__stale 应已移除）')
  } else if (!/data-pending/.test(outputsCode)) {
    fail('核对尚未出结论的行要有 data-pending（轻微待定态），不能什么都不显示')
  } else if (!/verdict === 'missing'/.test(outputsCardSrc) || !/unknown/.test(outputsCardSrc)) {
    fail('只有 missing 才剔除：unknown（探测失败）必须保留 —— '
      + '宿主降级时把整卡清空比留一条可能点不开的更糟')
  } else if (/都已不在磁盘上|本次会话还没有产出文件/.test(outputsCode)) {
    // 2026-10-19：空态整类取消（没产出就不挂载），所以这里断言**两种空态文案都不存在**。
    // 原先这条要求"全被核对掉"与"还没产出"说两句不同的话；现在两句都不说了。
    fail('产出物卡不得再有空态文案（空态由挂载方拦掉，卡片只在有内容时出现）')
  } else if (!/kr-out-row\[data-pending="true"\]/.test(code)) {
    fail('待定态必须有不透明度样式（.kr-out-row[data-pending="true"]）')
  } else if (!/hasWriteIntent/.test(outputsSrc) || !/WRITE_INTENT_RE/.test(outputsSrc)) {
    // 2026-10-01 端到端实测：一条脚本写了 `"stat": "AGENTS.md"` 又把
    // `"abs": "D:\\AI\\Dsh\\AGENTS.md"` 打到结果里 —— 名字在命令里、路径在结果里，
    // 两道闸门全过，一个**只读**的 AGENTS.md 被当成了产出物。证据 2 必须再要求
    // 命令带写入语义（重定向 / -OutFile / Set-Content / savefig / ffmpeg…），
    // 否则 Test-Path、Get-Item、Select-String 这类读操作也会把文件名"写出来"。
    fail('证据 2 必须要求命令带写入语义（hasWriteIntent / WRITE_INTENT_RE）：'
      + '光看「文件名被写出」无法区分「打印」与「落盘」')
  } else if (!/if \(!hasWriteIntent\(command\)\) return names/.test(outputsSrc)) {
    fail('namesInCommand 必须先过写入语义闸门再收集文件名（顺序反了等于没加）')
  } else if (!/output\\s\+file|to\\s\+\[/.test(outputsSrc) || !/mp4\|mkv\|mov/.test(outputsSrc)) {
    // ffmpeg 的落盘行是 `Output #0, mp4, to 'out/video.mp4':`，没有 saved/导出
    // 这类词；漏了它整批 ffmpeg 产出都进不了卡。
    fail('SAVE_VERB_RE 必须认 ffmpeg 的落盘形态（`... to \'out/video.mp4\':`），'
      + '否则 ffmpeg 产出整批漏报')
  } else if (!/record\.path \?\? record\.file_path \?\? record\.filePath/.test(outputsSrc)) {
    // 用户报的 BUG：产出物卡里那条 present 交付的 PDF 点开是「文件不存在」。
    // 根因是 present 的入参是 `files: [{ path, description }]` 对象数组，
    // argPaths 只认字符串/字符串数组 → 交付路径整批没进卡，卡里只剩 download
    // 的中转路径（_tmp/…），文件被搬走后点开必然 404。
    fail('outputs.ts 的 argPaths 必须认 present 的对象数组形态（files: [{ path, description }]），'
      + '否则交付物永远进不了产出物卡')
  } else if (!/delivered/.test(outputsSrc) || !/kept\.delivered !== entry\.delivered/.test(outputsSrc)) {
    // 同一个文件先落中转位置、再搬到最终位置（download 到 _tmp 后 move 到 docs）
    // 时，两条路径 basename 相同、完整路径不同；只按完整路径去重会并排留一条
    // 已经失效的旧路径。present 的交付路径必须能顶掉同名中转路径。
    fail('outputs.ts 必须让 present 的交付路径顶掉同名的中转路径（否则卡里留下已失效的 _tmp 路径）')
  } else if (!/'run_code',/.test(outputsSrc) || !/typeof args\.code === 'string'/.test(outputsSrc)) {
    // 用户 2026-10-04 报的「产出物 png 不显示」：整轮生图走 run_code（PTC 沙箱），
    // 模型在**代码体**里调 generate_image + fs.writeFileSync 落盘，路径只出现在
    // code 与打印结果里。run_code 不在结果路白名单 → 收集层一条都收不到 → 卡显示
    // 0 项。补进白名单后，它的「命令原文」取 code 字段，证据 2 的两道闸门
    // （文件名被写出 + 写入语义）原样生效，列表/打印类代码依然进不来。
    fail('outputs.ts 结果路必须含 run_code，且把 args.code 当作证据 2 的命令原文：'
      + '否则 PTC 沙箱里脚本落盘的产出（生图 png 等）整批进不了卡')
  } else if (!/TRANSIENT_MEDIA_EXEMPT/.test(outputsSrc)
    || !/new Set\(\['image', 'video', 'audio'\]\)/.test(outputsSrc)
    || !/isTransientOutputPath\(path\) && !TRANSIENT_MEDIA_EXEMPT\.has\(kind\)/.test(outputsSrc)) {
    // 同一 BUG 的第二半：生图成品落点就是工作区 _tmp/（本工作区一次性产物约定
    // 目录），_tmp/ 整类排除把整轮媒体产出抹成 0 项。媒体类（image/video/audio）
    // 豁免 _tmp/ 排除；失效文件由卡片核对层（probeWorkspaceFile → gonePaths）剔除。
    fail('outputs.ts 必须对 _tmp/ 下的媒体成品（image/video/audio）豁免整类排除：'
      + '生图/渲染的落点常在 _tmp/，整类排除等于把整轮媒体产出从卡里抹掉')
  } else if (!/writeFile\(\?:Sync\)\?\\s\*\\\(/.test(outputsSrc)) {
    // run_code 代码体里的写入语义主要是 Node fs API；WRITE_INTENT_RE 原来只认
    // shell/Python 形态，代码体写 fs.writeFileSync 会被证据 2 的闸门挡掉。
    fail('WRITE_INTENT_RE 必须认 Node 落盘 API（writeFileSync/createWriteStream…）：'
      + 'run_code 代码体的写入语义靠它们自证')
  } else if (!/function anchoredTargets/.test(outputsSrc) || !/interface AnchoredTarget/.test(outputsSrc)) {
    // 用户 2026-10-24 报的「产出物里没有 MP4」：视频合流那一轮的命令形态是
    //   $V="D:\\…\\intro"  →  cd $V  →  ffmpeg -y -i output.mp4 … video_with_bgm.mp4
    //   →  Copy-Item video_with_bgm.mp4 final_video.mp4 -Force
    // 结果里只有 Get-ChildItem 的表（路径列被折掉，只剩 `280769947 final_video.mp4`），
    // 命令里又全是**相对**文件名 —— 证据 1（落盘说明）没有、证据 2（结果里的绝对
    // 路径 + 名字被写出）也空转，两个成品都没上卡。证据 3 补的就是这一环：命令里
    // 写死的绝对目录当基准，配结果里的裸文件名。
    fail('结果路必须有证据 3（anchoredTargets）：命令里写死的绝对目录 + 结果里的裸文件名。'
      + '缺了它，cd 进目录后用相对文件名产出的成品（ffmpeg 合流、Copy-Item 改名）整批进不了卡')
  } else if (!/BARE_NAME_RE/.test(outputsSrc) || !/'gim'/.test(outputsSrc)) {
    // m flag 是硬要求：这条正则判的形态是**行尾**（`285670289 output.mp4`），没有 m
    // 时 $ 只匹配整串末尾，除了最后一行以外一条都匹配不上 —— 实测几十行文件表
    // 收不到一条裸名，证据 3 恒为空，等于没加。
    fail('BARE_NAME_RE 必须带 m flag（多行模式）：它判的是行尾形态，否则只有整串最后一行能命中')
  } else if (!/for \(const match of scrubbed\.matchAll\(BARE_NAME_RE\)\)/.test(outputsSrc)) {
    // scan() 末尾强制 hasSeparator(path)，而证据 3 的输入按定义就是**裸文件名**
    // （表格把路径列折掉了）。复用它等于每一条都在闸门处被丢掉，证据 3 恒为空。
    fail('证据 3 不得复用 scan()：它的 hasSeparator 闸门会把裸文件名整类丢掉')
  } else {
    pass('outputs.ts：参数/结果两路工具集分离 + spill 排除 + 落盘说明闸门 + 交付路径优先 + run_code/媒体豁免 + 证据3 目录锚点')
  }
}

// 「提问与回答」卡。它存在的唯一理由是：KR 对话流只保留答案投影、工具明细整类
// 隐藏，而 ask_user_question 走 tool-call 节点 —— 问答整段从对话流里消失，用户
// 看不到自己答过什么。所以这张卡是问答的**唯一出口**，五件事缺一就静默失效：
// 开关在、组件在、解析层在、样式在、挂在思考卡下方且在对话流里。
if (krEnabled) {
  const enabledSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/enabled.ts'), 'utf8')
  const askCardVisible = /export const KR_ASK_CARD_VISIBLE = (true|false)/.exec(enabledSrc)?.[1] === 'true'
  const askCardSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAskCard.tsx'), 'utf8')
  const askParseSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/ask-parse.ts'), 'utf8')
  const thinkingSrc = readFileSync(resolve(ROOT, 'src/client/thinking/ThinkingStepNodeView.tsx'), 'utf8')
  const panelSrc2 = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')
  // 断言打在**活代码**上：styles.ts 里留着「为什么删掉」的历史注释，直接正则整份
  // 源码会被注释里的 kr-ask-row-in / kr-ask-pick-in 误伤（同仓库其它断言同理）。
  const askCss = readFileSync(resolve(ROOT, 'src/client/kr-chat/styles.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  if (!askCardVisible) {
    fail('KR_ASK_CARD_VISIBLE 必须默认 true（问答卡是问答在界面上的唯一出口）')
  } else if (!code.includes('.kr-card--ask') || !code.includes('kr-ask-pick') || !code.includes('kr-ask-dot')) {
    fail('client bundle 缺问答卡样式（.kr-card--ask / .kr-ask-pick / kr-ask-dot）')
  } else if (askCardSrc.includes('kr-ask-opt') || askCardSrc.includes('kr-ask-row__options')) {
    // 用户要求「直接显示回答了什么就行了，不需要每回答的也显示」：候选项整列不渲染，
    // 答案就是 values 本身。列候选会让答案淹在没被选的项里，每次都要找哪条是亮的。
    fail('问答卡不得再罗列候选项（kr-ask-opt / kr-ask-row__options）：'
      + '只显示用户实际选中的答案，完整候选走官方「查看回答」面板')
  } else if (!/kr-ask-row__answer/.test(askCardSrc) || !/kr-ask-pick/.test(askCardSrc)) {
    fail('问答卡必须渲染答案行（.kr-ask-row__answer + .kr-ask-pick）')
  } else if (!/export function buildAskView/.test(askParseSrc)
    || !/export function parseAskQuestions/.test(askParseSrc)
    || !/export function pairAskAnswers/.test(askParseSrc)) {
    fail('ask-parse.ts 必须导出 buildAskView / parseAskQuestions / pairAskAnswers')
  } else if (!/KR_ASK_CARD_VISIBLE/.test(thinkingSrc)
    || !/<KrAskCard asks=\{turnAsks\} inline summarizing=\{summarizing\} \/>/.test(thinkingSrc)) {
    fail('问答卡必须由 ThinkingStepNodeView 以 inline 形态挂载并接收 summarizing'
      + '（贴在对话流里 + 回复完成后跟着收起）')
  } else if (!/if \(!inline \|\| !summarizing \|\| was\) return/.test(askCardSrc)
    || !/useState\(!\(inline && summarizing\)\)/.test(askCardSrc)) {
    // 用户要求「回复完成后这个提问也收起」：与思考卡**逐字同构**的收口收起。
    //   · 只在 summarizing false→true 的那一次翻转上收起——写成持续态判据会
    //     在用户手动展开历史轮次后被下一次重渲染立刻按回去；
    //   · 初始态只看 summarizing——拿「等待回答」参与判定会在模型还在问的时候
    //     就把卡折起来，用户根本看不到它在问什么。
    fail('问答卡收口收起必须与思考卡同构（翻转触发 + 初始态只看 summarizing）')
  } else if (!/role="button"[\s\S]{0,200}aria-expanded=\{open\}/.test(askCardSrc)) {
    fail('问答卡收起后整行仍必须是可折叠按钮（点标题行 / Enter / 空格能再展开）')
  } else if (!/\{\(bodyPresent \|\| open\) && \(/.test(askCardSrc)) {
    // 折叠体与思考卡同一写法（KrReasoningCard 的 `(bodyPresent || open) &&`）：
    // 收起动画播完才卸载，但收起途中又被展开要能立刻挂回，否则快速连点会出现空帧。
    fail('问答卡折叠体必须用 (bodyPresent || open) 门控（同思考卡，防快速连点空帧）')
  } else if (!/\{\.\.\.\(!open \? \{ inert: '' \} : \{\}\)\}/.test(askCardSrc)) {
    // 压扁的内容仍留在 DOM 里（补间需要它），不加 inert 就能被 Tab 键聚焦进去。
    fail('问答卡收起态必须叠加 inert（同思考卡，压扁内容不该被键盘聚焦）')
  } else if (!/\.kr-ask-body:not\(\[data-open\]\)\s*\{[^}]*opacity:\s*0/.test(askCss)) {
    // 高度补间由 useHeightAnimation 改 inline height；没有这层 opacity，收口那一下
    // 会看到「字挤在 0 高度里闪一帧」。
    fail('问答卡折叠体必须有 data-open 的 opacity 门控（淡入淡出，同 .kr-reasoning-list）')
  } else if (!/\{inlineReasoning\}\s*\{inlineAsk\}/.test(thinkingSrc)) {
    // 顺序就是需求本身：用户明确要求"放到思考的下方"。
    fail('问答卡必须渲染在思考卡**下方**（inlineReasoning 之后才是 inlineAsk）')
  } else if (panelSrc2.includes('KrAskCard')) {
    fail('问答卡已搬进对话流，右栏大盘不该再挂它（会两处重复显示）')
  } else if (!code.includes(':has(.kr-card--ask)')) {
    // KR 对工具明细整类隐藏，而问答卡挂在 tool-call 节点上 ——
    // 没有这条放行规则，卡片有盒模型但宽高是 0，等于没做。
    fail('样式表必须有 :has(.kr-card--ask) 放行规则（否则卡片被 KR 的工具明细隐藏规则压成 0×0）')
  } else if (!/\[hidden="until-found"\]:has\(\.kr-card--ask\)[^{]*\{[^}]*max-height:\s*none/.test(askCss)) {
    // 用户报「agent 执行过程中点回答是在内部展开，结束后就正常了」。
    // 根因：进行中卡片挂在**过程投影**里，落在官方折叠体 .O_Ebla_body 内，
    // 而那个容器定死了 max-height: min(400px,50vh) + overflow-y: auto ——
    // 卡片一长就被截断、要在这个小框里内部滚动。收口后卡片改挂**答案投影**，
    // 那条链上没有这个折叠容器，所以显示正常（"结束后就正常了"的成因）。
    // 修法：只给「含卡片」的那个折叠体解除限制（官方自己的折叠体里没有卡片，
    // 所以 :has 的作用面精确等于含卡片的那一个），官方自己的 400px 折叠窗照旧。
    fail('含卡片的折叠体必须解除 max-height（否则进行中卡片被官方的 400px '
      + '折叠窗截断，表现为「在内部展开」；收口后换投影就正常了）')
  } else if (!/\[hidden="until-found"\]:has\(\.kr-card--ask\)[^{]*\{[^}]*overflow:\s*visible/.test(askCss)) {
    fail('含卡片的折叠体必须同时解除 overflow（只放 max-height 仍会内部滚动）')
  } else if (askCss.includes('kr-ask-row-in') || askCss.includes('kr-ask-pick-in')) {
    // 用户报「展开有点卡卡的」：原先每一行、每个被选中的选项各跑一个 translateY /
    // scale 动画，与卡片入场、高度补间三层同时起跑 —— 十几个元素同帧提升合成层。
    // 现在只留卡片入场（kr-card-in）与高度补间两次整体过渡。
    fail('问答卡不得再逐行/逐项播入场动画（kr-ask-row-in / kr-ask-pick-in）：'
      + '展开时只该有卡片入场与高度补间两次整体过渡')
  } else if (/kr-ask-breathe[^}]*border-left-color/.test(askCss)) {
    // 等待态呼吸若动 border-left-color，会**每帧重绘整张卡的边框**（12px 圆角 +
    // 多层嵌套），叠加高度补间就是"卡一下"的主因。现在呼吸走 ::after 的 opacity。
    fail('等待呼吸必须动 opacity（合成器），不得动 border-left-color（每帧重绘整卡边框）')
  } else if (/\.kr-ask-opt[^{]*\{[^}]*background:/.test(askCss)) {
    // 简约化：选项是**已发生事实的记录**，不是待操作的问卷。画成带描边+底色的
    // 可点控件既在骗人（点不动）又堆出一片框线噪声。
    fail('选项必须是纯文本行（不得带底色/控件外观）：这张卡是已答事实的记录')
  } else if (/\.kr-ask-opt/.test(askCss)) {
    // 用户要求「直接显示回答了什么就行了，不需要每回答的也显示」——候选项整列不渲染，
    // 组件里已无 .kr-ask-opt 渲染点，样式表里残留规则只会在下次改版时误导人。
    fail('样式表不该再留 .kr-ask-opt 规则（组件已不渲染候选项，只显示选中的答案）')
  } else {
    pass('提问与回答卡：挂在思考卡下方 + 折叠窗解除 + 单层过渡 + 只显示答案 + 解析层 + 开关在位')
  }
}

/*
 * ── 字号轴：两张对话流内联卡必须跟随官方「设置 → 字号」 ────────────────────
 *
 * 用户要求（2026-10-09）：「seeker 的思考过程、提问需要跟随官方设置里的字号大小」。
 *
 * 官方把正文字号发布成 body 上的行内变量 --dsh-content-font-size（10..22，
 * 默认 14），派生 --dsh-content-font-delta，官方自己的组件一律读这条轴。这两张
 * 卡贴在对话流里、与正文同列，硬编码字号的结果是「正文调到 20px，卡片还停在
 * 12.5px」—— 同一条消息里两种字级。
 *
 * 六条一起钉（前两条是回退闸门，其余钉住"改全了"）：
 *  1. 档位变量声明在两张卡的根类上，且都从 --dsh-content-font-size 派生；
 *  2. **默认档逐像素还原**改造前的硬编码值（12.5 / 13 / 12 / 11.5 / 11）。
 *     这五行的括号与数字就是契约本身，按整行文本精确比对 —— 偏移改一位，
 *     用户不改设置也会看到字号变了；
 *  3. 卡片命名空间里不许再出现裸 px 的 font-size（将来新增元素也拦得住）；
 *  4. 思考视口的行高必须从当前字级算（写死会在放大档与真实行高脱钩，视口按
 *     旧行高算 max-height，卡片要么被撑破要么显示不全）；
 *  5. 标题行图标跟着 --dsh-content-font-delta 放大；
 *  6. 与字级联动的行高 / 尺寸也得跟：.kr-ask-row__tag 的行高、.kr-ask-dots 的
 *     3px 三点写死过一版，字号轴推到 22px 时前者行距小于字高（挤字）、后者
 *     相对缩成看不见的芝麻（等待态的唯一动效线索丢了）。
 */
if (krEnabled) {
  const axisSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/styles.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  const axisReasons = []

  // 1 + 2：档位变量的整行文本比对（后缀 → 下限 / 基线 / 偏移 / 期望解析值）
  const EXPECT_AXIS = [
    ['body', '11px', '14px', '1.5px', 12.5],
    ['title', '12px', '14px', '1px', 13],
    ['12', '11px', '14px', '2px', 12],
    ['11-5', '10.5px', '14px', '2.5px', 11.5],
    ['11', '10px', '14px', '3px', 11],
    ['10-5', '9.5px', '14px', '3.5px', 10.5],
    ['10', '9.5px', '14px', '4px', 10],
  ]
  /*
   * 作用域必须覆盖**六个卡根类**：左栏两张（思考 / 问答）+ 右栏四张
   * （任务概览 / 操作面板 / 子智能体 / 产出物）。
   *
   * 少一个的后果是静默的：那张卡拿不到 --kr-fs-*，规则里的 var 全部退回
   * fallback（= 改造前的硬编码值），看起来「样式是对的」，只是字号永远不跟。
   * 所以逐个点名核对，而不是只要求「至少有这两个」。
   */
  const REQUIRED_CARD_SCOPES = ['reasoning', 'ask', 'task', 'plain', 'subs', 'outputs']
  const axisBlock = /\.kr-card--reasoning,\s*\.kr-card--ask[^{]*\{([^}]*)\}/.exec(axisSrc)
  if (axisBlock === null) {
    axisReasons.push('缺「字号轴」档位变量声明块（.kr-card--reasoning, .kr-card--ask, … 上声明 --kr-fs-*）')
  } else {
    const scopeText = axisBlock[0].slice(0, axisBlock[0].indexOf('{'))
    for (const card of REQUIRED_CARD_SCOPES) {
      if (!scopeText.includes('.kr-card--' + card)) {
        axisReasons.push('字号轴作用域缺 .kr-card--' + card + '（该卡拿不到 --kr-fs-*，字号会静默不跟随）')
      }
    }
    for (const [suffix, floor, base, offset, resolved] of EXPECT_AXIS) {
      const line = '--kr-fs-' + suffix + ': max(' + floor
        + ', calc(var(--dsh-content-font-size, ' + base + ') - ' + offset + '));'
      if (!axisBlock[1].includes(line)) {
        axisReasons.push('--kr-fs-' + suffix + ' 必须是「' + line + '」（默认档须解析成 ' + String(resolved) + 'px）')
      }
      if (Number.parseFloat(floor) >= resolved) {
        axisReasons.push('--kr-fs-' + suffix + ' 的下限 ' + floor + ' 不该 ≥ 默认档 ' + String(resolved) + 'px')
      }
    }
  }

  // 3：六张卡的命名空间里都不许再有裸 px 的 font-size
  const nakedFonts = []
  for (const block of axisSrc.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim().replace(/\s+/g, ' ')
    if (!/kr-reasoning|kr-ask|kr-card--(reasoning|ask|task|plain|subs|outputs)|kr-task-|kr-plain-|kr-subs-|kr-out-/.test(selector)) continue
    const hit = /font-size:\s*[\d.]+px/.exec(block[2])
    if (hit !== null) nakedFonts.push(selector + ' → ' + hit[0])
  }
  if (nakedFonts.length > 0) {
    axisReasons.push('六张卡命名空间里还有写死 px 的 font-size（应引用 --kr-fs-* 档位）：'
      + nakedFonts.join('；'))
  }

  // 4：思考视口行高从字级算
  const lineVar = /--kr-reasoning-line:\s*([^;]+);/.exec(axisSrc)
  if (lineVar === null || !lineVar[1].includes('var(--kr-fs-body')) {
    axisReasons.push('--kr-reasoning-line 必须从当前字级算出（var(--kr-fs-body) × 行高系数），不能写死 px')
  }

  // 5：六张卡的标题图标跟着 delta 放大（字号 22 时 16px 图标配 20.5px 正文会缩一号）
  if (!/\.kr-card--outputs \.kr-card__icon\s*\{[^}]*calc\(18px \+ var\(--dsh-content-font-delta/.test(axisSrc)) {
    axisReasons.push('六张卡的标题图标尺寸必须跟随 --dsh-content-font-delta')
  }

  // 6：与字级联动的行高 / 尺寸也得跟
  const tagBlock = /\.kr-ask-row__tag\s*\{([^}]*)\}/.exec(axisSrc)
  if (tagBlock === null || /line-height:\s*\d+(\.\d+)?px/.test(tagBlock[1])
    || !tagBlock[1].includes('--dsh-content-font-delta')) {
    axisReasons.push('.kr-ask-row__tag 的行高不得写死 px（字号 20.5px 时行距小于字高会挤字），应随 --kr-fs-11 缩放')
  }
  const dotsBlock = /\.kr-ask-dots > i\s*\{([^}]*)\}/.exec(axisSrc)
  if (dotsBlock === null || /(width|height):\s*3px/.test(dotsBlock[1])
    || !dotsBlock[1].includes('--dsh-content-font-delta')) {
    axisReasons.push('.kr-ask-dots 的三点不得写死 3px（放大档下会相对缩成看不见的芝麻），应随 --kr-fs-11-5 缩放')
  }

  /*
   * 7：右栏两张带**有界视口**的卡，视口高度必须从当前行高算。
   *
   * 操作面板列表的 max-height = 行数 × --kr-plain-row-h + 6px，而
   * `.kr-plain-step` 的 min-height 是同一个基准。写死 22px 时字号跟到 20px、
   * 每行实际约 30px，视口仍按 22px 算 —— 卡片会把内容切掉一半（反向则留空白）。
   * 这处耦合没有 CSS 报错、只有一个「显示不全」的现象，所以必须钉住。
   */
  const rowH = /--kr-plain-row-h:\s*([^;]+);/.exec(axisSrc)
  if (rowH === null || !rowH[1].includes('--dsh-content-font-delta')) {
    axisReasons.push('--kr-plain-row-h 必须随字号轴缩放（写死会让操作面板列表视口与实际行高脱钩，内容被截断）')
  }
  const stepBlock = /\.kr-plain-step\s*\{([^}]*)\}/.exec(axisSrc)
  if (stepBlock === null || !/min-height:\s*calc\(22px \+ var\(--dsh-content-font-delta/.test(stepBlock[1])) {
    axisReasons.push('.kr-plain-step 的 min-height 必须与 --kr-plain-row-h 同一系数缩放（否则视口与实际行高不一致）')
  }
  // 产出物行高同理（36px 是给 28px 缩略图定的）。
  const outRow = /\.kr-out-row\s*\{([^}]*)\}/.exec(axisSrc)
  if (outRow === null || !/min-height:\s*calc\(36px \+ var\(--dsh-content-font-delta/.test(outRow[1])) {
    axisReasons.push('.kr-out-row 的 min-height 必须随字号轴缩放（否则放大档把缩略图或文字夹住）')
  }

  /*
   * 8：**JSX 里的 svg 呈现属性必须被 CSS 覆盖**。
   *
   * 这是本轮真正漏过的一处，也是这类改造里最隐蔽的失败：svg 的 width/height
   * 写在 tsx 里（如产出物卡的 Thumb 是 28、跳转箭头是 12），容器跟着字号轴放大了、
   * 图形却纹丝不动 —— 容器成了一个大框、图形还是原来那么大，四周留空。
   * 零报错、零 console、样式表看起来完全正确，只有肉眼看得出来。
   *
   * 判据：凡是「容器尺寸走 calc(+delta)」的那些图标 / 缩略图，都必须有一条
   * 对应的 svg 覆盖规则。逐条点名，少一条就报出来。
   */
  const SVG_MUST_SCALE = [
    // [容器选择器（用于报错文案）, 覆盖规则必须匹配的正则]
    ['产出物缩略图 .kr-out-row__thumb', /\.kr-out-row__thumb svg\s*\{[^}]*calc\([^)]*--dsh-content-font-delta/],
    ['子智能体箭头 .kr-subs-row__go', /\.kr-subs-row__go svg/],
    // 「展开其余 N」只剩产出物卡一处：子智能体卡改成 10 行定高窗口后，
    // 它那枚按钮与 .kr-subs-more 整套样式一起删了（窗口自己能滚）。
    ['产出物「展开其余 N」.kr-out-more', /\.kr-out-more svg/],
    ['产出物右栏箭头 .kr-out-row__go', /\.kr-out-row__go svg/],
  ]
  for (const [label, re] of SVG_MUST_SCALE) {
    if (!re.test(axisSrc)) {
      axisReasons.push(label + ' 里的 svg 必须用 CSS 覆盖呈现属性（否则容器放大、图形不放大，零报错）')
    }
  }
  // 覆盖规则本身必须真的带 delta（只写死尺寸等于没覆盖）。
  const thumbSvg = /\.kr-out-row__thumb svg\s*\{([^}]*)\}/.exec(axisSrc)
  if (thumbSvg !== null && !thumbSvg[1].includes('--dsh-content-font-delta')) {
    axisReasons.push('缩略图 svg 的覆盖规则必须带 --dsh-content-font-delta（写死尺寸等于没覆盖）')
  }
  /*
   * 覆盖规则的**基准值必须等于 JSX 里的呈现属性**（12 / 12 / 11 / 11 / 11）。
   * 取错不会报错，只会在默认档就把图形放大或缩小一点 —— 那违反「默认档逐像素
   * 还原」。本轮就把 chevron 的 11 写成了 12，实测默认档量到 12px 才发现。
   */
  const svgBase12 = /\.kr-subs-row__go svg,\s*\.kr-out-row__go svg\s*\{\s*width:\s*calc\(12px/.test(axisSrc)
  const svgBase11 = /\.kr-out-more svg\s*\{\s*width:\s*calc\(11px/.test(axisSrc)
  if (!svgBase12) {
    axisReasons.push('跳转箭头与产出物右栏箭头 svg 的基准必须是 12px（与 JSX 呈现属性一致）')
  }
  if (!svgBase11) {
    axisReasons.push('产出物「展开其余 N」的 svg 基准必须是 11px（与 JSX 呈现属性一致）')
  }

  if (axisReasons.length > 0) {
    fail('字号轴跟随回退：' + axisReasons.join('；'))
  } else {
    pass('字号轴：六张卡（思考/问答/任务概览/操作面板/子智能体/产出物）'
      + '字号·行高·图标·视口全部跟随官方「设置 → 字号」'
      + '（默认档逐像素还原 12.5/13/12/11.5/11/10.5/10，无写死 px）')
  }
}

// ── 用量卡片：高度内容自适应 + 卡片内不滚动（用户明确要求） ────────────
//
// 用户原话：「用量页面不能够自动自适应卡片长度，这让我很困惑，我不想要滚动的方式」。
// 旧实现是 414 / 560 两档写死高度，配上 `.usm-uc { overflow-y:auto }` —— 内容
// 只有 298px 时卡片仍占 414，多出来的部分既空又带一条滚动条；选中某天后高度
// 跳一档，长模型名还会被裁。
//
// 契约（三条一起才成立）：
//   1. UsagePanel 不再给 size.height（只给宽度）→ 走内容自适应分支；
//   2. .usm-uc 不得再有 overflow-y:auto / flex:1（否则内容没超出也留滚动条）；
//   3. PopoverShell 必须实测卡片高度并据此夹紧 top（否则长卡片会伸出视口下缘）。
{
  const usageSrc = readFileSync(resolve(ROOT, 'src/client/triad/usage/dashboard/UsagePanel.tsx'), 'utf-8')
  const shellSrc = readFileSync(resolve(ROOT, 'src/client/triad/popover-shell.tsx'), 'utf-8')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')

  const usageCode = strip(usageSrc)
  const ucRule = /\.usm-uc\s*\{([^}]*)\}/.exec(usageCode)?.[1] ?? ''
  const violations = []
  if (/size=\{\{\s*width:[^}]*height:/.test(usageCode)) violations.push('UsagePanel 不得再给 size.height（卡片高度必须由内容决定）')
  if (/overflow-y\s*:\s*auto/.test(ucRule)) violations.push('.usm-uc 不得再滚动（overflow-y:auto）')
  if (/flex\s*:\s*1\s+1\s+auto/.test(ucRule)) violations.push('.usm-uc 不得再 flex:1（内容高度容器里没有剩余空间可分配）')
  if (!/ResizeObserver/.test(shellSrc)) violations.push('PopoverShell 必须实测卡片高度（ResizeObserver），否则长卡片会伸出视口下缘')

  if (violations.length > 0) {
    fail(`用量卡片自适应契约被破坏：${violations.join(' / ')}`)
  } else {
    pass('用量卡片：高度内容自适应（不给 size.height / 主体不滚动 / 实测高度夹紧定位）')
  }
}

// ── 邮箱面板：纯查看（2026-10 入口搬迁 + 写操作 UI 全裁） ───────────────
// 这一轮把邮件从「统一工作台第 6 个分类」搬成「Seeker 顶栏齿轮右侧的邮件按钮
// + 只读浮层」（入口本体在 src/client/kr-chat/mail-drawer.tsx），同时把面板
// 裁成**纯查看**：写邮件 / 回复 / 转发 / 移入回收站 / 永久删除全部删除。
//
// 旧契约（page 形态 / 无 open-closing-anchor / registerPanelSeat 座位）随搬迁
// 整体作废：registerPanelSeat 那条装配路径（applyMailClient + MAIL_PANEL_ID）
// 已删除，本文件不能再要求它存在，否则就是拿一把已经不用的尺子量。
// 新契约两条：① 邮箱只剩**导出面**（浮层 import 它）+ 工作台里已无 mail 分类；
// ② 面板是纯查看的（列表/搜索/读信/附件在位，写操作 UI 不存在）。
{
  const mailPanelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const mailIndexSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/index.ts'), 'utf-8')
  const hubSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/WorkbenchPanel.tsx'), 'utf-8')
  const flyoutSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/row-flyout.tsx'), 'utf-8')

  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  const hubClean = strip(hubSrc)
  const flyoutClean = strip(flyoutSrc)
  // 入口文件要剥注释后再判：注释里会提到 applyMailClient（说明它为什么被删），
  // 那是叙述不是代码，拿它当命中会变成「越解释越违规」。
  const indexClean = strip(mailIndexSrc)

  const reasons = []
  // ① 导出面：新入口（mail-drawer.tsx）靠这几个 export 装配面板。
  if (!/export \{ MailPanel, MailIcon/.test(mailIndexSrc)) reasons.push('mail/index.ts 必须导出 MailPanel / MailIcon（新浮层入口 import 它）')
  if (!/export \{ createMailApi, MailApiError \}/.test(mailIndexSrc)) reasons.push('mail/index.ts 必须导出 createMailApi')
  // 死代码必须真删掉：留着等于「还有第二个入口」的错觉。
  if (/applyMailClient/.test(indexClean)) reasons.push('applyMailClient 已是死代码，必须删除（否则让人以为还有注册的座位）')
  if (/MAIL_PANEL_ID/.test(indexClean)) reasons.push('MAIL_PANEL_ID 只服务已删的座位装配，必须一并删除')
  // ② 工作台里已无 mail 分类（类型 + 渲染分支 + 分类表 + 图标分支）。
  if (/'mail'/.test(hubClean)) reasons.push('WorkbenchPanel 不得再有 mail 分类（联合类型 / 渲染分支都要清）')
  if (/MailPanel|createMailApi/.test(hubClean)) reasons.push('WorkbenchPanel 不得再 import / 使用 MailPanel 与 createMailApi（死引用）')
  if (/id:\s*'mail'/.test(flyoutClean)) reasons.push('row-flyout 的 WORKBENCH_TABS 不得再有 mail 一项')
  if (/case 'mail':/.test(flyoutClean)) reasons.push('row-flyout 的分类图标不得再有 mail 分支')

  if (reasons.length > 0) {
    fail('邮箱入口搬迁：' + reasons.join('；'))
  } else {
    pass('邮箱入口搬迁：只剩导出面（无 applyMailClient / MAIL_PANEL_ID）+ 工作台已无 mail 分类')
  }
}

// ── 邮箱面板纯查看：查看能力在位 + 写操作 UI 不存在 ────────────────────
{
  const raw = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')

  const viewReasons = []
  // ── 查看能力必须全在位（删写操作时最容易误伤的就是这几处）──
  if (!/css\.topSearch/.test(src) || !/css\.topInput/.test(src)) viewReasons.push('顶栏搜索框必须保留')
  if (!/css\.listCol/.test(src) || !/css\.listScroll/.test(src)) viewReasons.push('邮件列表（中栏）必须保留')
  if (!/onClick=\{\(\) => \{ setPane\(\{ kind: 'read', id: message\.message_id \}\) \}\}/.test(src)) viewReasons.push('点列表项必须进 read 分支（查看详情）')
  if (!/function ReadPane\(/.test(src)) viewReasons.push('ReadPane 读信区必须保留')
  if (!/sandbox="allow-same-origin"/.test(src) || /allow-scripts/.test(src)) viewReasons.push('HTML 正文必须走 iframe sandbox 且不给 allow-scripts')
  if (!/css\.attachItem/.test(src) || !/css\.attachAlt/.test(src) || !/onDownloadAlt/.test(src)) viewReasons.push('附件行必须保留「下载」与「另选位置」两个入口')
  if (!/css\.navItem/.test(src) || !/FOLDERS\.map/.test(src)) viewReasons.push('文件夹导航（收件箱/已发送/回收站/垃圾邮件）必须保留')
  if (!/只看未读/.test(src) || !/只看附件/.test(src)) viewReasons.push('「只看未读 / 只看附件」两个过滤必须保留')
  if (!/css\.topBtn/.test(src) || !/IconRefreshOutline16/.test(src)) viewReasons.push('刷新按钮必须保留')

  // ── 写操作 UI 必须一个不剩（这是本轮的核心删除项）──
  const writeReasons = []
  for (const [needle, why] of [
    [/ComposePane/, 'ComposePane 组件与调用'],
    [/confirmState|ConfirmDialog/, '写操作确认弹层'],
    [/写邮件/, '「写邮件」入口'],
    [/>\s*回复\s*</, '读信区「回复」按钮'],
    [/>\s*转发\s*</, '读信区「转发」按钮'],
    [/移入回收站/, '「移入回收站」按钮'],
    [/永久删除/, '「永久删除」按钮'],
    [/api\.send\(|api\.forward\(|api\.trash\(|api\.remove\(/, '写操作 api 调用'],
    [/api\.pending\(|css\.pendingBar/, '待确认警示条'],
  ]) {
    if (needle.test(src)) writeReasons.push(`${why} 必须已删除（命中 ${needle}）`)
  }
  if (!/kind: 'read'/.test(src) || /kind: 'compose'|kind: 'forward'/.test(src)) {
    writeReasons.push("PaneMode 只能剩 { kind: 'read' }（compose / forward 分支要删干净）")
  }
  // ReadPane 的签名里不得再挂写操作回调。
  for (const prop of ['onReply', 'onForward', 'onTrash', 'onDelete']) {
    if (new RegExp(`${prop}\\s*[?:]`).test(src)) writeReasons.push(`ReadPane 的 props 不得再有 ${prop}`)
  }
  // host 侧写能力本轮**只裁 UI**：api.ts 的薄封装必须原样留着（另一侧工具数对账要用）。
  const apiSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/api.ts'), 'utf-8')
  if (!/send\(|reply\(|forward\(|trash\(|remove\(/.test(apiSrc)) {
    writeReasons.push('mail/api.ts 的写方法本轮不得删除（那是 host 路由的薄封装，只裁 UI 调用点）')
  }

  if (viewReasons.length > 0) {
    fail('邮箱纯查看面板：' + viewReasons.join('；'))
  } else if (writeReasons.length > 0) {
    fail('邮箱纯查看面板：' + writeReasons.join('；'))
  } else {
    pass('邮箱纯查看面板：列表/搜索/读信/附件/过滤全在位 + 写操作 UI（写邮件/回复/转发/回收站/删除/ComposePane/确认弹层）零残留')
  }
}

// ── 邮箱窄栏：容器查询 + 列表↔详情切换 ────────────────────────────────
// 面板宽度由外壳给（邮箱卡片最宽 1080px，窄窗口下被压小），**与视口宽度不是
// 同一个数**：视口 1400px 时卡片可能只有 900px，视口媒体查询判的是另一回事。
// 所以窄栏必须由容器查询驱动，量面板自己。
// 另有一条踩过的坑要钉住：container-type 必须挂**有确定宽度的那个根**
// （.dsh-mail-panel），挂到 display:contents 的官方 [data-slot="main"] 上
// 不会有任何效果 —— 容器查询永远不匹配。
{
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const stylesSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/styles.ts'), 'utf-8')
  const sheet = stylesSrc.slice(stylesSrc.indexOf('const SHEET'))
  const reasons = []

  // ① container-type 挂在面板根（有确定宽度的盒子）上，且是 inline-size。
  if (!/\.dsh-mail-panel\{[\s\S]*?container-type:inline-size/.test(sheet)) {
    reasons.push('container-type:inline-size 必须挂在 .dsh-mail-panel 根上（挂到 display:contents 的祖先上容器查询永不命中）')
  }
  if (!/container-name:mailpanel/.test(sheet)) reasons.push('容器要有 container-name（@container 用得到）')
  // ② 阈值必须是 620px：卡片宽 >620px 排三栏，压窄后落单栏范式。
  if (!/@container\s+mailpanel\s+\(max-width:\s*620px\)/.test(sheet)) {
    reasons.push('@container mailpanel (max-width: 620px) 必须存在（窄窗口 / 手机上落单栏范式）')
  }
  // ③ 明确不许用视口媒体查询做窄栏布局（面板宽度由外壳给，与视口不等同）。
  if (/@media\s*\(max-width:\s*900px\)/.test(sheet)) {
    reasons.push('窄栏不得用视口媒体查询（@media max-width:900px）——面板宽度由外壳给，与视口宽度不是同一个数')
  }
  // ④ 单栏切换：选中详情时列表让位，两栏都靠 data 属性驱动。
  if (!/\.dsh-mail-panel \.dsh-mail-list-col\[data-has-selection='true'\]\{display:none\}/.test(sheet)) {
    reasons.push("窄栏下选中邮件必须藏列表（.dsh-mail-list-col[data-has-selection='true']{display:none}）")
  }
  if (!/data-has-selection=/.test(panelSrc)) reasons.push('列表容器必须挂 data-has-selection 供窄栏 CSS 判定')
  // ⑤ 文件夹竖列 → 顶部横条。
  if (!/\.dsh-mail-panel \.dsh-mail-sidebar\{[\s\S]{0,300}?flex-direction:row/.test(sheet)) {
    reasons.push('窄栏下文件夹必须从竖列改顶部横条（flex-direction:row）')
  }
  // ⑥ 「返回列表」按钮：真按钮（不是只靠 CSS 藏列表），且 read 态才给。
  if (!/css\.back/.test(panelSrc) || !/返回列表/.test(panelSrc)) reasons.push('窄栏必须有明确的「返回列表」按钮')
  if (!/\.dsh-mail-back\{display:none/.test(sheet)) reasons.push('返回列表按钮在宽栏必须默认隐藏（三栏时列表常驻，没有返回语义）')
  if (!/\.dsh-mail-panel \.dsh-mail-back\{display:inline-flex\}/.test(sheet)) reasons.push('返回列表按钮必须在窄栏容器查询里显形')
  // ⑦ 过渡动效 + reduced-motion 兜底（用户偏好动效，但关掉动画后内容仍要完整可见）。
  if (!/@keyframes dsh-mail-pane-in/.test(sheet)) reasons.push('列表↔详情切换要有过渡动效（dsh-mail-pane-in）')
  if (!/@media \(prefers-reduced-motion:reduce\)/.test(sheet)) reasons.push('必须有 prefers-reduced-motion 兜底')
  // 兜底只能关动画：不得靠 opacity/visibility 藏内容（那样降级后内容会消失）。
  const rm = sheet.slice(sheet.indexOf('@media (prefers-reduced-motion:reduce)'))
  if (/visibility:hidden|opacity:0/.test(rm.slice(0, rm.indexOf('\n}')))) {
    reasons.push('reduced-motion 兜底不得用 visibility:hidden / opacity:0 藏内容（动画关掉后内容要完整可见）')
  }

  if (reasons.length > 0) fail('邮箱窄栏布局：' + reasons.join('；'))
  else pass('邮箱窄栏布局：容器查询(620px) + 文件夹横条 + 列表↔详情单栏切换 + 返回按钮 + 过渡动效与 reduced-motion 兜底')
}

// ── 邮箱附件保存位置（用户自选目录）───────────────────────────────────
{
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const apiSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/api.ts'), 'utf-8')
  const hostApiSrc = readFileSync(resolve(ROOT, 'src/mail/api.ts'), 'utf-8')
  const serviceSrc = readFileSync(resolve(ROOT, 'src/mail/service.ts'), 'utf-8')

  // 目录选择走官方 uiWorkspace.pickDirectory，不自己造选择器。
  if (!/uiWorkspace/.test(panelSrc) || !/pickDirectory/.test(panelSrc)) {
    fail('附件「另选位置」必须走官方 ctx.uiWorkspace.pickDirectory()，不要自造目录选择器')
  } else if (!/verify-dir/.test(hostApiSrc) || !/verify-dir/.test(apiSrc)) {
    fail('host 必须提供 /verify-dir 目录预检端点（保存前校验，别等下载时才撞 CLI 报错）')
  } else if (!/\.dsh-mail-write-probe/.test(serviceSrc)) {
    fail('目录校验必须真的试写探针文件（只查 existsSync 会把只读目录判成可用）')
  } else if (!/downloadDir\s*!==\s*undefined\s*&&\s*patch\.downloadDir\.trim\(\)\s*===\s*''/.test(serviceSrc)) {
    fail('updateConfig 必须支持「空串 = 清除覆盖回到默认目录」（否则恢复默认会留下空覆盖层）')
  } else if (!/onDownloadAlt/.test(panelSrc)) {
    fail('附件行必须同时提供「下载到默认目录」与「另选位置」两个入口')
  } else {
    pass('邮箱附件保存位置：原生选择器 + 保存前试写校验 + 恢复默认清覆盖 + 单附件另选位置')
  }
}

// ── host 侧写能力原样保留（本轮只裁「模型可见的工具」与面板 UI）────────
// 面板上的破坏性按钮删了，但 host 的 /api/dsh-mail 两阶段写链路**没删**：
// service 的 trashNow/deleteNow、CLI 英文报错人话化、写后作废缓存都是 host 能力，
// 删了会牵动 test-mail-two-phase.mjs。这里钉的就是「面板删了、能力还在」。
{
  const cliSrc = readFileSync(resolve(ROOT, 'src/mail/cli.ts'), 'utf-8')
  const serviceSrc = readFileSync(resolve(ROOT, 'src/mail/service.ts'), 'utf-8')
  const storeSrc = readFileSync(resolve(ROOT, 'src/mail/store.ts'), 'utf-8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')

  // Agent Mail 的规则：+trash 只作用于非回收站邮件、+delete 只作用于回收站邮件。
  // 旧故障：服务端按邮件真实归属判定，回 `Cannot delete message from this
  // directory`（截图里那句英文）——面板曾因此给出注定失败的按钮。
  if (!/Cannot delete message from this directory/i.test(cliSrc)) {
    fail('CLI 的 Cannot delete message from this directory 必须翻成人话（否则用户只看到一句英文）')
  } else if (!/not in trash/.test(cliSrc) || !/humanizeCliError/.test(cliSrc)) {
    fail('CLI 英文报错必须翻译成人话（至少覆盖 not in trash 这条）')
  } else if (!/async invalidateCache\(/.test(storeSrc) || !/invalidateCache\(\)/.test(serviceSrc)) {
    fail('写操作成功后必须作废列表缓存（否则刚删掉的邮件还留在列表里，用户重复点）')
  } else if (!/async trashNow\(/.test(serviceSrc) || !/async deleteNow\(/.test(serviceSrc)) {
    fail('host 的 trashNow / deleteNow 必须保留（面板删了按钮，host 能力仍在）')
  } else if (/inTrash|detail\.dir\?\.dir_name/.test(panelSrc)) {
    fail('面板不得再保留破坏性按钮的 inTrash 判定分支（写操作 UI 已整体删除）')
  } else {
    pass('邮箱 host 写能力保留：trashNow/deleteNow + 写后作废缓存 + 英文报错人话化（面板侧判定分支已清）')
  }
}

// ── 面板已无写操作：host 两阶段 chain 仍在（供 host 侧工具/测试用）────────
{
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const entrySrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/index.ts'), 'utf-8')
  const serviceSrc = readFileSync(resolve(ROOT, 'src/mail/service.ts'), 'utf-8')
  const typesSrc = readFileSync(resolve(ROOT, 'src/mail/types.ts'), 'utf-8')

  // 真实故障：面板点「确认执行」→ CLI 报 `id required`。根因是面板从 CLI 的
  // summary 里读 `id` 再拼一次请求，而 summary 里那个字段叫 `message_id`，
  // 而且压根没有正文/附件路径 —— 参数根本重建不出来。
  // 修法：第一阶段把完整参数落盘（replay），第二阶段由 host 原样重放。
  //
  // 本轮之后面板不再有任何写入口，但这套 host 链路**保留**（模型工具与
  // test-mail-two-phase.mjs 都还在用）。断言因此分两半：host 那几条照旧钉死，
  // 面板那几条改成「面板侧零写调用」。
  if (!/^\s*replay:\s*WriteReplay/m.test(typesSrc) || !/export type WriteReplay/.test(typesSrc)) {
    fail('待确认记录必须存下完整的 replay 参数（不能靠 CLI summary 反推）')
  } else if (!/async confirmPending\(token: string\)/.test(serviceSrc)) {
    fail('host 必须提供 confirmPending(token)：从落盘 replay 原样重放')
  } else if (!/pending\/confirm/.test(readFileSync(resolve(ROOT, 'src/mail/api.ts'), 'utf-8'))) {
    fail('必须提供 /pending/confirm 路由（模型工具的两阶段确认走它）')
  } else if (!/async trashNow\(/.test(serviceSrc) || !/async deleteNow\(/.test(serviceSrc)) {
    fail('host 的 now 变体必须保留（用户点击即许可，一次请求走完两阶段）')
  } else if (!/confirmationToken/.test(serviceSrc.slice(serviceSrc.indexOf('async trash('), serviceSrc.indexOf('async trash(') + 420))) {
    fail('trash() 必须把 confirmationToken 传进 writeCall（只收形参不往下传 = 第二阶段又拿新令牌，永远停在 pending）')
  } else if (/api\.(send|reply|forward|trash|remove|pending)\(/.test(panelSrc) || /api\.(send|reply|forward|trash|remove|pending)\(/.test(entrySrc)) {
    fail('面板/入口不得再有任何写操作（send/reply/forward/trash/remove）或待确认列表调用')
  } else if (/preview\.id|preview\.body|preview\.subject/.test(panelSrc)) {
    fail('面板不得从 preview 里读业务字段拼请求（summary 里没有正文/附件，字段名也不同）')
  } else {
    pass('面板零写操作（无 send/reply/forward/trash/remove/pending 调用）+ host 两阶段 replay/now 链路原样保留')
  }
}

// ── 设置页「模型可用工具」收敛为 6 个只读工具（与 host 侧一一对应）────────
// host 侧同时由另一名 teammate 删 5 个写工具，这里改的是同一事实的 client 侧：
// 设置页的工具表留着一个不存在的工具名，等于对用户撒谎。
{
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const reasons = []
  for (const name of ['mail_account', 'mail_list', 'mail_search', 'mail_read', 'mail_download_attachment', 'mail_wait_code']) {
    if (!new RegExp(`\\b${name}:`).test(panelSrc)) reasons.push(`TOOL_DESC 必须保留只读工具 ${name}`)
  }
  for (const name of ['mail_send', 'mail_reply', 'mail_forward', 'mail_trash', 'mail_delete']) {
    if (new RegExp(`\\b${name}:`).test(panelSrc)) reasons.push(`TOOL_DESC 不得再有已删工具 ${name}`)
  }
  // 数量徽标读的是 config.tools ?? Object.keys(TOOL_DESC) —— 键只有 6 个时即 6。
  const table = panelSrc.slice(panelSrc.indexOf('const TOOL_DESC'), panelSrc.indexOf('}', panelSrc.indexOf('const TOOL_DESC')))
  const keys = (table.match(/^\s{2}(\w+):/gm) ?? []).length
  if (keys !== 6) reasons.push(`TOOL_DESC 必须正好 6 项（实得 ${keys}）`)

  if (reasons.length > 0) fail('邮箱设置页工具表：' + reasons.join('；'))
  else pass('邮箱设置页工具表：6 个只读工具（写类 5 项零残留，数量徽标渲染为 6）')
}

// ── 任务/操作面板的取数与回填（2026-10-05 修「切换会话后两张卡就空了」）──────
//
// 三个必须同时在位的形状，缺一个就会复发：
//  1. **PTC 内层穿透**：模型在 PTC 模式下把整批工具塞进一次 run_code，真正的
//     todo_write 全在 root.subCalls 里，顶层只有 run_code。只认顶层 call.name
//     就整类漏掉任务清单（实测本会话 5 次 todo_write 无一在顶层）。
//  2. **候选按 seq 取最新**：locations / nodes.values / order 三路扫描的先后不
//     保证按时间序，边扫边覆盖会让较早那份清单赢，任务卡显示过期状态。
//  3. **切换会话立即回填 live todos**：清空是同步的，回填却只挂在 [todos]
//     引用变化上；切回已定型的历史会话时引用不变，effect 不跑，卡片长期空态。
if (krEnabled) {
  const shadowSrc = readFileSync(resolve(ROOT, 'src/client/tool-summary/TurnProcessShadowView.tsx'), 'utf8')
  const bridgeSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/kr-todo-bridge.ts'), 'utf8')
  const panelSrc2 = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')
  const reasons = []

  if (!/function collectTodoTasksFromTree/.test(shadowSrc)) {
    reasons.push('缺少 PTC 内层穿透（run_code 的 subCalls 里才是真正的 todo_write）')
  }
  // 三处调用点：本轮收集 / 跨轮次回溯 / 活动投影，缺一处就有一种场景空白。
  const nestedCalls = (shadowSrc.match(/collectTodoTasksFromTree\(/g) ?? []).length
  if (nestedCalls < 4) {
    reasons.push(`PTC 穿透只在 ${nestedCalls - 1} 处生效（本轮收集 / 跨轮次回溯 / 活动投影三处都要接）`)
  }
  if (!/todoCandidates\.sort\(\(a, b\) => a\.seq - b\.seq\)/.test(shadowSrc)) {
    reasons.push('本轮任务候选必须按 seq 取最新（三路扫描顺序不定，边扫边覆盖会取到旧清单）')
  }
  // 内层调用两种形状都要认：已结束的包在 call 里，运行中的把 name/argsRaw 摊平。
  if (!/sub\?\.call\?\.name \?\? sub\?\.name/.test(shadowSrc)
    || !/sub\?\.call\?\.argsRaw \?\? sub\?\.argsRaw/.test(shadowSrc)) {
    reasons.push('内层调用需同时认「call 包装」与「摊平」两种形状（运行中的没有 call）')
  }
  if (!/setLiveDshTodos\(Array\.isArray\(todosRef\.current\)/.test(bridgeSrc)) {
    reasons.push('会话身份登记时必须立即回填 live todos（只靠 [todos] 引用变化会长期空态）')
  }
  if (!/const todosRef = useRef\(todos\)/.test(bridgeSrc)) {
    reasons.push('回填需从 ref 取最新投影（todos 进依赖会让 cleanup 把会话 id 置 null）')
  }
  if (!/collectLatestSessionTasks\(snap\)/.test(panelSrc2)) {
    reasons.push('任务回溯口径必须是整场会话（传 displayTurn 会让没写过 todo 的历史轮次翻空）')
  }
  /*
   * 5. **任务清单只认本轮，看最新轮次时绝不回溯**（2026-10-24 用户报
   *    「发送新的对话时任务概览应该是空的才对」）。
   *
   * 复发路径有三条，逐条钉住：
   *   a. live 回退（官方 todos 投影按会话累积，新一轮开始时仍是上一轮那份）；
   *   b. 整场会话回溯被放到"看最新轮次"的分支里；
   *   c. 有人为了"切会话时任务卡别空着"把 a/b 之一加回来。
   */
  if (/getLiveDshTodos/.test(panelSrc2) || /source: 'live'/.test(panelSrc2)) {
    reasons.push('任务概览不得再回退到 live todos（按会话累积：新一轮刚发出时它仍是上一轮清单）')
  }
  if (!/if \(!isViewingHistory\) return \{ tasks: \[\], source: 'none' \}/.test(panelSrc2)) {
    reasons.push('看最新轮次且本轮没写清单时必须返回空（用户：「发送新的对话时任务概览应该是空的才对」）'
      + '；只有看历史轮次才允许回溯到会话最近一次清单')
  }
  // 回溯必须待在 isViewingHistory 判据之后：写在其前就是无条件回退。
  const histIdx = panelSrc2.indexOf("if (!isViewingHistory) return { tasks: [], source: 'none' }")
  const backIdx = panelSrc2.indexOf('collectLatestSessionTasks(snap)')
  if (histIdx < 0 || backIdx < 0 || backIdx < histIdx) {
    reasons.push('会话回溯必须排在「看最新轮次就返回空」之后（写在前面等于无条件回退）')
  }
  /*
   * 4. **跨会话归属校验**（2026-10-10 用户报「新对话还显示上个对话的任务概览」）。
   *
   * 根因是**发布点把旧对象贴上了新会话 id**：KrTodoBridge 的两个 effect 依赖都含
   * sessionId，切会话时必然重跑，而那一帧 snap / todos 仍是上一会话的对象
   * （useChat / useProjection 要等下一次更新才换引用）。于是旧数据被再发布一次，
   * 把 setLatestChatSessionId 刚做的清空当场撤销；新会话又没有第二个发布者纠正，
   * 误显示是**持久**的。
   *
   * 拦法必须是**引用指纹**（sessionId 变 + 数据引用没变 = 旧对象被复用）。
   * 试过在写入处按 owner 拒绝，但新会话**自己的**第一份数据同样是「owner 还是
   * 上一会话」的形状，无法区分 —— 拦了会把合法发布一起拒掉，新会话永远空白。
   * 这条教训值得钉住，否则后人很容易「简化」回那个错做法。
   */
  if (!/lastPublishRef/.test(bridgeSrc)) {
    reasons.push('座位必须有发布指纹 ref（否则旧对象贴新 id 的误发无法识别）')
  }
  /*
   * 三条断言各钉**自己那一路**的指纹字段：snapSessionId / todosSessionId。
   * 早先这里写的是单指纹 `prev.sessionId`——源码改成双指纹后（两条 effect 各记
   * 各的，共用一份会互相污染，见 kr-todo-bridge.ts 的长注释），这三条正则全部
   * 失配，于是「断言红、行为对」地卡住构建。字段名必须与源码逐字一致。
   */
  if (!/prev\.snapSessionId !== sessionId && prev\.snap === snap/.test(bridgeSrc)) {
    reasons.push('快照发布必须按「sessionId 变 + 引用未变」拦截（否则新会话显示上一会话内容）')
  }
  if (!/prev\.todosSessionId !== sessionId && prev\.todos === todos/.test(bridgeSrc)) {
    reasons.push('todos 发布必须按「sessionId 变 + 引用未变」拦截（否则任务概览显示上个对话的清单）')
  }
  if (!/prev\.todosSessionId !== sessionId && prev\.todos === todosRef\.current/.test(bridgeSrc)) {
    reasons.push('身份登记回填也必须做同样拦截（回填是最容易漏的一条路径）')
  }
  if (!/latestChatSnapshotOwner/.test(shadowSrc)) {
    reasons.push('快照必须记会话归属（读取口兜底校验要用）')
  }
  if (!/export function getCurrentChatSnapshot/.test(shadowSrc)) {
    reasons.push('必须提供带归属校验的快照读取口（裸读 latestChatSnapshot 会跨会话）')
  }
  if (!/export function leaveCurrentChatSession/.test(shadowSrc)) {
    reasons.push('必须有统一的「离开会话」清空口（各路径各写一遍必漏）')
  }
  if (!/liveTodosOwner/.test(bridgeSrc)) {
    reasons.push('liveTodos 必须记会话归属（模块级全局，清理漏跑就会跨会话泄漏）')
  }
  if (!/getLatestChatSessionId\(\)/.test(bridgeSrc)) {
    reasons.push('liveTodos 读取口必须比对当前会话身份')
  }
  if (!/leaveCurrentChatSession\(\)/.test(bridgeSrc)) {
    reasons.push('座位卸载必须走统一离开口（setLatestChatSessionId(null) 会被幂等短路跳过清理）')
  }
  // 消费方不得裸读全局快照：跨会话时会拿到上一个会话的内容。
  const rawSnapshotReads = (panelSrc2.match(/latestChatSnapshot\s*\|\|/g) ?? []).length
  if (rawSnapshotReads > 0) {
    reasons.push(`KrAgentPanel 仍有 ${rawSnapshotReads} 处裸读 latestChatSnapshot（须走 getCurrentChatSnapshot）`)
  }
  if (!/getCurrentChatSnapshot\(\)/.test(panelSrc2)) {
    reasons.push('KrAgentPanel 必须走带归属校验的快照读取口')
  }
  // 无会话身份时不得回退 actStore：上一会话的轮次数据会从缓存里流出来。
  if (!/if \(latestChatSessionId === null\) return EMPTY_TURN_DATA/.test(panelSrc2)) {
    reasons.push('无会话身份时不得回退 actStore（否则缓存里的上一会话轮次会漏出来）')
  }
  if (reasons.length > 0) {
    fail('任务/操作面板取数回退：' + reasons.join('；'))
  } else {
    pass('任务取数：PTC 内层穿透 + 按 seq 取最新 + 切会话立即回填 + 跨会话引用指纹拦截')
  }
}

// ── 工作台分类（2026-10-05 定稿，2026-10-21 去掉灵魂分类）──────────────────
//
// 形状契约，不是实现细节。历史沿革值得写下来，否则后人很容易懵：
//   1. 一开始灵魂只是记忆面板里的一个 Tab；
//   2. 2026-10-05 用户要求「打开工作台后左侧是灵魂、右侧是记忆」→ 同屏并排一页；
//   3. 同日用户改口「还是把记忆和灵魂分开两个分类吧」→ 两个平级 Tab；
//   4. **2026-10-21 用户要求「把插件灵魂这个功能和模块都删掉」→ 灵魂分类整体移除**，
//      记忆成为默认页（原默认页是灵魂，删掉后必须有人顶上）。
// 断言锁三件事：灵魂真的没了、默认落在记忆、其余分类仍各自独立成页。
{
  const hubSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/WorkbenchPanel.tsx'), 'utf8')
  const hubCss = readFileSync(resolve(ROOT, 'src/client/triad/hub/styles.ts'), 'utf8')
  const flyoutSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/row-flyout.tsx'), 'utf8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/memory/Panel.tsx'), 'utf8')
  const reasons = []

  // ── 灵魂模块必须整块不存在（源码目录 + 一切引用）──────────────────────
  // 用户原话「把插件灵魂这个功能和模块都删掉」。这条用目录存在性当判据最硬：
  // 只删引用不删目录 = 死代码；只删目录不删引用 = 构建直接炸。
  for (const dir of ['src/triad/soul', 'src/client/triad/soul']) {
    if (existsSync(resolve(ROOT, dir))) reasons.push(`灵魂模块目录必须已删除：${dir}`)
  }
  const hubAll = hubSrc + hubCss + flyoutSrc + panelSrc
  if (/soul|Soul|灵魂/.test(hubAll)) {
    reasons.push('工作台不得再残留任何 soul / 灵魂 引用（分类、图标、样式一律清掉）')
  }

  // ── 分类表与默认页 ───────────────────────────────────────────────────
  if (/export const DEFAULT_TAB: WorkbenchTab = 'soul'/.test(hubSrc)) {
    reasons.push("默认 Tab 必须不再是 soul")
  }
  if (!/export const DEFAULT_TAB: WorkbenchTab = 'memory'/.test(hubSrc)) {
    reasons.push('默认 Tab 必须是 memory（灵魂删掉后记忆是第一页）')
  }
  if (!/activeTab === 'memory'[\s\S]{0,300}MemoryPanel/.test(hubSrc)) {
    reasons.push('「记忆」必须是独立分类，直接挂 MemoryPanel')
  }
  // 分类表：四个分类，且顺序稳定（横滑条与浮层都遍历它，不另起一份真相）。
  const tabsBlock = /export const WORKBENCH_TABS: readonly WorkbenchTabMeta\[\] = \[([\s\S]*?)\] as const/.exec(flyoutSrc)
  const tabIds = tabsBlock === null ? [] : [...tabsBlock[1].matchAll(/id: '([a-z]+)'/g)].map(m => m[1])
  if (tabIds.join(',') !== 'memory,skills,usage,gallery') {
    reasons.push(`WORKBENCH_TABS 必须是 memory/skills/usage/gallery 四项，实得 [${tabIds.join(', ')}]`)
  }
  if (!/return 'memory'/.test(flyoutSrc)) {
    reasons.push("readWorkbenchTab 的非法值回落必须是 'memory'")
  }
  if (/wb-pair/.test(hubSrc) || /wb-pair/.test(hubCss)) {
    reasons.push('并排布局（wb-pair）已废弃')
  }
  if (/pairMode/.test(panelSrc)) {
    reasons.push('pairMode 已废弃：记忆面板不再有「只做概览」的半屏形态')
  }
  // 记忆面板里不得再出现灵魂子 Tab 或灵魂 API 面（灵魂是平级分类，去掉后入口为零）。
  if (/SoulPanel|soulApi|'soul'/.test(panelSrc)) {
    reasons.push('记忆面板内不得再挂灵魂子 Tab 或 soulApi')
  }
  // 两个工作区开关（自动记忆 / 排除注入）2026-10-18 迁到大盘设置卡片：
  // 记忆面板里**不许**再有一份。两处各留一个入口的后果不是「多一个方便」，
  // 而是「拨完一边、另一边还是旧值」—— 两处各自缓存一份 projects 快照。
  // 判据要剥注释：本仓习惯在注释里写「这两个开关已经搬走」，那是叙述不是代码。
  const panelClean = panelSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  if (/autoMemory/.test(panelClean)) {
    reasons.push('记忆面板不得再有 autoMemory 开关（已迁到大盘设置卡片，两处入口会各自缓存、互相不同步）')
  }
  if (/injectExcluded/.test(panelClean)) {
    reasons.push('记忆面板不得再有 injectExcluded 开关（同上，已迁到大盘设置卡片）')
  }
  if (/css\.switchLine|css\.switchText/.test(panelClean)) {
    reasons.push('记忆面板的项目上下文条不该再渲染开关行（switchLine / switchText 已无消费点）')
  }

  const memoryBranch = /activeTab === 'memory'[\s\S]{0,400}?MemoryPanel[^>]*\/>/.exec(hubSrc)
  if (memoryBranch === null || /soulApi/.test(memoryBranch[0])) {
    reasons.push('记忆分类的 MemoryPanel 不得接收 soulApi')
  }
  // 判据：必须有「原样回填」这条分支，且不得再出现任何强制迁移
  // （曾经有过 saved === 'memory' → 'soul'，那会让用户每次都被拽去别的页）。
  if (!/return saved/.test(hubSrc) || /saved === 'memory'/.test(hubSrc)) {
    reasons.push("localStorage 的 'memory' 是合法值，必须原样回填（不可强制迁移）")
  }

  if (reasons.length > 0) {
    fail('工作台分类契约：' + reasons.join('；'))
  } else {
    pass('工作台分类：灵魂模块已整块删除（目录 + 引用）+ 默认页落到记忆 + 四分类独立成页')
  }
}

// ── 侧栏「工作区 / 操作间」双屏导航（2026-10-25 定稿）─────────────────────
//
// 这组断言盯三件事，任何一条破了用户都会「找不到入口 / 侧栏被掏空」：
//   1. 注册表驱动：区域与条目都来自 nav-registry，挂载器里不许硬编码菜单清单；
//   2. 入口不丢：官方行只在宽栏隐藏，rail / 卸载必须还原；官方区域同理；
//   3. 三态闭环：点切换行 → 官方区域隐藏 + 条目出现；再点 → 官方区域回来。
{
  const reasons = []
  const sectionsSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/nav-sections.tsx'), 'utf8')
  const registrySrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/nav-registry.ts'), 'utf8')
  const seatSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/seat.ts'), 'utf8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/WorkbenchPanel.tsx'), 'utf8')

  // 1. 注册表驱动：挂载器必须挂在座位里，且分类清单来自 WORKBENCH_TABS
  if (!/attachSidebarSections/.test(seatSrc)) reasons.push('双屏导航没有挂进工作台座位')
  if (!/WORKBENCH_TABS\.map/.test(sectionsSrc)) reasons.push('默认条目必须遍历 WORKBENCH_TABS（不另起一份真相）')
  if (!/openWorkbench/.test(sectionsSrc)) reasons.push('工作台条目必须走 openWorkbench（复用官方 selectPanel）')
  if (!/entriesOfSection/.test(sectionsSrc)) reasons.push('条目必须按区域从注册表取（entriesOfSection）')
  if (!/orderedNavSections/.test(sectionsSrc)) reasons.push('区域必须从注册表按 order 取（orderedNavSections）')
  if (!/nextSectionId/.test(sectionsSrc)) reasons.push('切换行文字必须是「下一个区域」（nextSectionId），不是当前区域')

  // 2. 入口不丢：官方行/官方区域都只在宽栏隐藏，rail 与卸载必须还原
  if (!/useRail/.test(sectionsSrc)) reasons.push('必须观察侧栏折叠态（rail 下让位）')
  if (!/syncOfficialChrome\(\{ hideSection: false, hideRow: false \}\)/.test(sectionsSrc)) {
    reasons.push('卸载时必须还原官方区域与官方行（入口不丢）')
  }
  if (!/ROW_HIDDEN_ATTR/.test(sectionsSrc) || !/SECTION_HIDDEN_ATTR/.test(sectionsSrc)) {
    reasons.push('官方行/官方区域必须用属性显隐（不搬官方 DOM）')
  }
  // 降级：注册表为空/只有一个区域时不渲染切换行（避免点了没反应）
  if (!/sections\.length < 2/.test(sectionsSrc)) reasons.push('不足两个区域时必须不渲染切换行')

  // 3. 三态闭环：切换 = 写区域（持久化 + 广播），不是组件内局部 state
  if (!/rotateActiveSection/.test(sectionsSrc)) reasons.push('切换行点击必须走 rotateActiveSection')
  if (!/registerNavSection/.test(registrySrc) || !/registerNavEntry/.test(registrySrc)) {
    reasons.push('注册表必须提供区域/条目两级注册接口（这是「以后加菜单方便」的落点）')
  }
  // 「加菜单只要一行」：便捷注册器必须在，且默认清单自己就得用它（活样本）
  if (!/export function navMenuItem/.test(registrySrc)) {
    reasons.push('必须提供 navMenuItem 便捷注册器（加菜单只写一行）')
  }
  if (!/export function navSection/.test(registrySrc)) {
    reasons.push('必须提供 navSection 便捷注册器（加一整屏只需一行）')
  }
  if (!/navMenuItem\(\{/.test(sectionsSrc)) reasons.push('默认条目必须自己就用 navMenuItem 注册（活样本）')
  if (!/writeActiveSection/.test(registrySrc)) reasons.push('注册表必须提供 writeActiveSection（切换唯一入口）')
  if (!/NAV_SECTION_STORE/.test(registrySrc)) reasons.push('当前区域必须持久化（重开界面停在同一屏）')
  // 回到会话时自动切回工作区：否则在操作间点「新会话」后会话列表是不见的
  if (!/useSessionReturnToWorkspaces/.test(sectionsSrc)) {
    reasons.push('回到会话时必须自动切回工作区（否则操作间里点新会话会看不到会话列表）')
  }
  // rail 显隐必须走同一个决策点（applySectionChrome）。踩过：place() 里硬编码
  // hideRow:true，折叠后每 1.5s 又把官方行藏回去 —— 折叠态侧栏一个入口都没有。
  if (!/applySectionChrome/.test(sectionsSrc)) {
    reasons.push('官方 chrome 显隐必须收敛到 applySectionChrome 单一决策点')
  }
  if (!/readRail\(\)/.test(sectionsSrc)) reasons.push('place() 必须自己读一次 rail（轮询不能依赖组件 effect）')
  // 折叠态本插件让位后不能留空白占位
  if (!/SECTION_EMPTY_ATTR/.test(sectionsSrc)) reasons.push('rail 下必须打空标记收掉 host 占位')

  // 横滑条必须真的没了（它把四个入口平铺在侧栏，正是本次要收进操作间的）
  if (existsSync(resolve(ROOT, 'src/client/triad/hub/strip.tsx'))) reasons.push('strip.tsx 应已删除（入口收进操作间）')
  if (/attachWorkbenchStrip/.test(seatSrc)) reasons.push('座位里不该再挂横滑条')

  // 页内不得再有任何分类切换器
  if (/WorkbenchDock|wb2-dock/.test(panelSrc)) reasons.push('页内分类切换器（Dock）必须已删除')
  if (existsSync(resolve(ROOT, 'src/client/triad/hub/Dock.tsx'))) reasons.push('Dock.tsx 应已删除')
  // ⌘1–N 直切要在页内实现（侧栏导航自己不吃键盘）
  if (!/metaKey \|\| event\.ctrlKey/.test(panelSrc) || !/WORKBENCH_TABS\[index\]/.test(panelSrc)) {
    reasons.push('⌘1–N 直切分类必须在工作台页内实现')
  }

  if (reasons.length > 0) {
    fail('侧栏双屏导航契约：' + reasons.join('；'))
  } else {
    pass('侧栏双屏导航：注册表驱动（区域+条目）+ 官方行/区域宽栏隐藏·rail与卸载还原 + 切换持久化 + 回会话自动切回工作区')
  }
}

// ── 侧栏导航注册表纯逻辑（真跑一遍状态机）────────────────────────────────
//
// 注册表是「以后加菜单」的那个东西，它的语义要能被单独验证：轮转顺序、持久化
// 回填、注销、空表降级、重复注册覆盖。本模块只 import 类型（运行时零依赖），
// node 的 type-stripping 可以直接跑。
{
  const reasons = []
  const registry = await import(pathToFileURL(resolve(ROOT, 'src/client/triad/hub/nav-registry.ts')).href)

  // localStorage 垫片：注册表只用 getItem/setItem，缺了会走「不记住」分支。
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }

  const Icon = () => null
  registry.registerNavSection({ id: 'a', label: 'A', icon: Icon, order: 10 })
  registry.registerNavSection({ id: 'b', label: 'B', icon: Icon, order: 20 })
  registry.registerNavEntry({ id: 'e1', section: 'b', label: 'E1', icon: Icon, target: { kind: 'custom', run: () => {} } })

  if (registry.readActiveSection() !== 'a') reasons.push('无持久化时应落在第一个区域（a）')
  if (registry.nextSectionId() !== 'b') reasons.push('两个区域时下一个应是 b')
  registry.rotateActiveSection()
  if (registry.readActiveSection() !== 'b') reasons.push('轮转后应落在 b')
  if (registry.nextSectionId() !== 'a') reasons.push('在 b 时下一个应回到 a（轮转）')
  if (registry.entriesOfSection('b').length !== 1) reasons.push('b 区域应有 1 个条目')
  if (registry.entriesOfSection('a').length !== 0) reasons.push('a 区域不应有条目')
  if (store.get(registry.NAV_SECTION_STORE) !== 'b') reasons.push('当前区域必须写进持久化层')

  // 持久化回填：刷新后仍停在 b（不跳屏）
  registry.resetNavRegistryForTests()
  registry.registerNavSection({ id: 'a', label: 'A', icon: Icon, order: 10 })
  registry.registerNavSection({ id: 'b', label: 'B', icon: Icon, order: 20 })
  if (registry.readActiveSection() !== 'b') reasons.push('持久化过的区域必须回填（刷新不跳屏）')

  // 注销收敛
  registry.resetNavRegistryForTests()
  const disposeX = registry.registerNavSection({ id: 'x', label: 'X', icon: Icon })
  if (registry.orderedNavSections().length !== 1) reasons.push('注册后应有 1 个区域')
  disposeX()
  if (registry.orderedNavSections().length !== 0) reasons.push('注销后应为空')
  if (registry.readActiveSection() !== null) reasons.push('空注册表时 readActiveSection 必须返回 null')
  if (registry.nextSectionId() !== null) reasons.push('空注册表时 nextSectionId 必须返回 null')

  // 重复注册同 id = 覆盖（热重载不叠加两份）
  registry.resetNavRegistryForTests()
  registry.registerNavSection({ id: 'dup', label: '旧', icon: Icon })
  registry.registerNavSection({ id: 'dup', label: '新', icon: Icon })
  const dupList = registry.orderedNavSections()
  if (dupList.length !== 1 || dupList[0].label !== '新') reasons.push('同 id 重复注册必须覆盖（热重载不叠加）')

  // ── 便捷注册器：navMenuItem / navSection 是「以后加菜单」的真正入口，必须真能跑
  registry.resetNavRegistryForTests()
  registry.navSection({ id: 'official-x', label: '工作区', icon: Icon, order: 10, source: 'official' })
  registry.navSection({ id: 'shop', label: '操作间', icon: Icon, order: 20 })
  const dPanel = registry.navMenuItem({ id: 'm1', label: '任务', icon: Icon, section: 'shop', panelId: 'schedule', order: 10 })
  const dTab = registry.navMenuItem({ id: 'm2', label: '画廊', icon: Icon, section: 'shop', workbenchTab: 'gallery', order: 20 })
  let ranCustom = 0
  const dRun = registry.navMenuItem({ id: 'm3', label: '自定义', icon: Icon, section: 'shop', run: () => { ranCustom += 1 }, order: 30 })

  const shopEntries = registry.entriesOfSection('shop')
  if (shopEntries.length !== 3) reasons.push(`navMenuItem 应注册 3 个条目，实际 ${shopEntries.length}`)
  if (shopEntries[0]?.target.kind !== 'panel' || shopEntries[0].target.panelId !== 'schedule') {
    reasons.push('navMenuItem({ panelId }) 应生成 panel target')
  }
  if (shopEntries[1]?.target.kind !== 'workbench' || shopEntries[1].target.tab !== 'gallery') {
    reasons.push('navMenuItem({ workbenchTab }) 应生成 workbench target')
  }
  if (shopEntries[2]?.target.kind !== 'custom') reasons.push('navMenuItem({ run }) 应生成 custom target')
  shopEntries[2]?.target.run?.()
  if (ranCustom !== 1) reasons.push('custom target 的 run 应被调用')
  // 缺省 section = 操作间（不传 section 也应落进去）
  const dDefault = registry.navMenuItem({ id: 'm4', label: '默认区', icon: Icon })
  if (registry.entriesOfSection(registry.DEFAULT_ENTRY_SECTION).length !== 1) {
    reasons.push('navMenuItem 缺省 section 必须是操作间')
  }
  dDefault()
  // 按 order 排序（10/20/30）
  if (shopEntries.map((e) => e.id).join(',') !== 'm1,m2,m3') reasons.push('条目必须按 order 排序')
  // 注销收敛
  dPanel(); dTab(); dRun()
  if (registry.entriesOfSection('shop').length !== 0) reasons.push('navMenuItem 的注销必须收敛')

  registry.resetNavRegistryForTests()

  if (reasons.length > 0) {
    fail('侧栏导航注册表：' + reasons.join('；'))
  } else {
    pass('侧栏导航注册表：轮转顺序 + 持久化回填 + 注销收敛 + 空表降级 + 同 id 覆盖')
  }
}

// ── 侧栏二级菜单 + 页面内筛选意图通道（2026-10-25）────────────────────
//
// 用户原话：「记忆的侧边栏可以放在操作间的记忆菜单下变成二级菜单，画廊的
// 分类也可以变为二级菜单」。落地后导航只有一个真相（侧栏），页面内的筛选
// 必须跟着走的到底是不是侧栏那一项 —— 这条链路跨了两个 React 根，只能靠
// workbench-intent 的持久化+事件传递，写坏了不会报错、只会「侧栏说 PDF、
// 页面显示图片」这种静默分叉。所以这里既验注册表的二级菜单状态机，也验
// 意图通道的三个方向（初值回填 / 广播 / 只写意图不直接改状态）。
{
  const reasons = []

  /* ── ⓿ localStorage 与 window 垫片 ───────────────────────────────
   * 本块独立一份（不复用上一块的局部变量）：注册表的展开态走 localStorage，
   * 意图通道的跨根同步走 window 自定义事件与 localStorage 两个面，缺任何一个
   * 都有「页面已经挂着、侧栏点了没反应」的静默失效。 */
  const prefs = new Map()
  globalThis.localStorage = {
    getItem: (key) => (prefs.has(key) ? prefs.get(key) : null),
    setItem: (key, value) => { prefs.set(key, String(value)) },
    removeItem: (key) => { prefs.delete(key) },
    clear: () => { prefs.clear() },
  }
  const dispatched = []
  const windowListeners = new Map()
  globalThis.window = {
    dispatchEvent: (event) => { dispatched.push(event); return true },
    addEventListener: (name, fn) => { windowListeners.set(name, fn) },
    removeEventListener: (name) => { windowListeners.delete(name) },
  }

  /* ── ① 契约文件必须存在且被两侧真用上 ─────────────────────────── */
  const intentPath = resolve(ROOT, 'src/client/triad/hub/workbench-intent.ts')
  if (!existsSync(intentPath)) {
    reasons.push('缺少 workbench-intent.ts（侧栏与页面之间的筛选意图通道）')
  }
  const sectionsSrc2 = readFileSync(resolve(ROOT, 'src/client/triad/hub/nav-sections.tsx'), 'utf8')
  const memorySrc = readFileSync(resolve(ROOT, 'src/client/triad/memory/Panel.tsx'), 'utf8')
  const gallerySrc = readFileSync(resolve(ROOT, 'src/client/triad/gallery/GalleryPanel.tsx'), 'utf8')

  // 侧栏是「发意图」的一侧：记忆的工作区、画廊的类别都必须由侧栏点出来。
  if (!/requestMemoryScope/.test(sectionsSrc2)) reasons.push('侧栏记忆二级菜单必须调 requestMemoryScope 发意图')
  if (!/requestGalleryKind/.test(sectionsSrc2)) reasons.push('侧栏画廊二级菜单必须调 requestGalleryKind 发意图')
  // 两个页面是「收意图」的一侧：初值回填 + 订阅 + 反向回写，三件缺一都会分叉。
  if (!/readMemoryScope/.test(memorySrc)) reasons.push('记忆页必须用 readMemoryScope 回填初值（否则从侧栏进来筛选是空的）')
  if (!/subscribeWorkbenchIntent/.test(memorySrc)) reasons.push('记忆页必须订阅 subscribeWorkbenchIntent（已挂载时原地切换）')
  if (!/requestMemoryScope/.test(memorySrc)) reasons.push('记忆页改工作区后必须 requestMemoryScope 回写（侧栏高亮才跟得上）')
  if (!/readGalleryKind/.test(gallerySrc)) reasons.push('画廊页必须用 readGalleryKind 回填初值')
  if (!/subscribeWorkbenchIntent/.test(gallerySrc)) reasons.push('画廊页必须订阅 subscribeWorkbenchIntent')
  if (!/requestGalleryKind/.test(gallerySrc)) reasons.push('画廊页改类别后必须 requestGalleryKind 回写')

  // 记忆的工作区清单由页面侧推给侧栏（数据驱动），两步都必须接上。
  if (!/setNavEntryChildren/.test(memorySrc)) reasons.push('记忆页必须用 setNavEntryChildren 把工作区清单推给侧栏')
  if (!/setNavEntryActiveChild/.test(memorySrc)) reasons.push('记忆页必须用 setNavEntryActiveChild 让侧栏高亮跟随')

  /* ── ①b 画廊页那条类别胶囊栏必须整条删掉（2026-10-25 用户要求）──────
   *
   * 用户原话：「画廊页面的这些不需要了删除掉」。那条胶囊栏里的类别入口已经
   * 在侧栏二级菜单里，页内再排一排同样的东西只是重复；它原先是**唯一**能
   * 「一次清空某个分类」的地方 —— 用户明确选择连同该功能一起删掉。
   *
   * 这组断言盯两件事：
   *   1. 胶囊栏 DOM / 它的批量删除状态机不得残留（残留 = 死代码 + 误导后人）；
   *   2. 单卡删除必须**完好**（用户只删了「按分类」，没删「按单条」）。
   */
  if (/className="tg-dock"/.test(gallerySrc)) reasons.push('画廊页的类别胶囊栏（tg-dock）必须整条删除')
  // 只看**代码形态**而不是裸词：这几个符号在解释「为什么删掉」的中文注释里
  // 仍会出现（那是应该留的历史说明），用 \b 裸词会把注释也算成残留。
  for (const dead of [
    'const \\[delConfirmId',
    'const \\[delBusyKind',
    'const armDel =',
    'const runDel =',
    'const entriesFor =',
    'const dockKinds =',
    'const totalOf =',
  ]) {
    if (new RegExp(dead).test(gallerySrc)) {
      reasons.push(`画廊页的按分类批量删除已随胶囊栏删除，不得残留 ${dead.replace(/\\\\/g, '')}`)
    }
  }
  // 单卡删除必须还在（这是不能误删的那一半）
  if (!/delItemPath/.test(gallerySrc)) reasons.push('画廊单卡删除（delItemPath）必须保留')
  if (!/className="tg-card__del"/.test(gallerySrc)) reasons.push('画廊卡片上的单条删除键必须保留')
  if (!/deleteGalleryPaths/.test(gallerySrc)) reasons.push('画廊必须仍调用 deleteGalleryPaths 执行删除')
  // 侧栏二级菜单**不再有任何小标题**（画廊的「分类」与记忆的「工作区」先后被
  // 用户点名去掉）。小标题机制本身也已整块退役，所以这里钉「机制不许复活」。
  if (!/case 'gallery':[\s\S]{0,400}?activeChild: \(\) => readGalleryKind\(\)/.test(sectionsSrc2)) {
    reasons.push('侧栏画廊二级菜单必须仍在（activeChild 指向 readGalleryKind）')
  }
  if (/childrenTitle/.test(sectionsSrc2.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    reasons.push('侧栏不得再给二级菜单配小标题（「工作区」/「分类」都已被用户要求去掉）')
  }
  if (/dsn-sub-title/.test(sectionsSrc2.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    reasons.push('二级菜单小标题的渲染与样式（dsn-sub-title）必须已整块删除')
  }
  const registrySrc2 = readFileSync(resolve(ROOT, 'src/client/triad/hub/nav-registry.ts'), 'utf8')
  if (/childrenTitle/.test(registrySrc2.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    reasons.push('注册表里 childrenTitle 字段必须已退役（留着就是一条永远不执行的死分支）')
  }

  /* ── ①c 展开/收起必须点「整行」，不是点那枚箭头（2026-10-25 用户要求）──
   *
   * 用户原话：「点击展开和收起的方式不对，应该是这一行而不是图标」。
   *
   * 早先的写法把一行切成两个点击目标（行本体开页面 / 右侧 26px 箭头展开），
   * 实际用起来三个问题：想展开得去够那个很小的图标、箭头看着像装饰不像开关、
   * 触屏上 26px 低于可点下限容易点错。
   *
   * 现在整行是一个 button，箭头退化成纯装饰。这组断言钉四件事，破了任何一条
   * 都会退回「点图标才能展开」：
   *   1. 可展开行的根节点是**一个 button**（带 dsn-branch-row），不再是 div 套两个 button；
   *   2. 那个 button 上有 aria-expanded（读屏用户听到的就是这行状态）；
   *   3. 点击走 toggleExpandedMenu（而不是「打开页面 + 顺手展开」那套旧逻辑）；
   *   4. 箭头是 span（不是 button）+ aria-hidden + pointer-events:none。
   */
  const branchRowJsx = /<button[\s\S]{0,400}?className="dsn-row dsn-branch-row"[\s\S]{0,700}?<\/button>/.exec(sectionsSrc2)?.[0] ?? ''
  if (branchRowJsx === '') {
    reasons.push('可展开行必须是一个整行 button（className="dsn-row dsn-branch-row"）—— 用户要求点整行展开，不是点图标')
  } else if (!/aria-expanded=\{expanded\}/.test(branchRowJsx)) {
    reasons.push('整行 button 必须带 aria-expanded（读屏用户要知道这行是展开还是收起）')
  } else if (!/toggleExpandedMenu\(entry\.id\)/.test(branchRowJsx)) {
    reasons.push('整行点击必须走 toggleExpandedMenu（展开/收起同一个动作）')
  } else if (/<button[^>]*className="dsn-caret"/.test(sectionsSrc2)) {
    reasons.push('箭头不得再是可点的 button（整行才是开关，箭头只是状态装饰）')
  } else if (!/<span className="dsn-caret" aria-hidden="true"/.test(sectionsSrc2)) {
    reasons.push('箭头必须是 aria-hidden 的 span（纯装饰，不接收点击也不进 Tab 序列）')
  } else if (!/\.dsn-caret\{[^}]*pointer-events:none/.test(sectionsSrc2)) {
    reasons.push('.dsn-caret 必须 pointer-events:none（否则点箭头会吞掉整行的点击）')
  } else {
    pass('侧栏二级菜单展开/收起：整行是开关（aria-expanded + toggleExpandedMenu）+ 箭头降级为装饰')
  }

  /* ── ② 记忆页内那条 212px 左栏必须真删掉 ───────────────────────── */
  // 删掉之后视图切换只能在页内顶部，否则「变更/修订/回收站/设置」全部失联
  // —— 那比侧栏变长严重得多。
  const memoryStylesSrc = readFileSync(resolve(ROOT, 'src/client/triad/memory/styles.ts'), 'utf8')
  if (/dsh-memory-sidebar-nav\s*\{/.test(memoryStylesSrc)) {
    reasons.push('记忆页内左栏样式（dsh-memory-sidebar-nav）必须整条删除')
  }
  if (/css\.sidebarNav/.test(memorySrc)) reasons.push('记忆页内左栏 DOM 必须整条删除（css.sidebarNav 不得再出现）')
  for (const view of ['all', 'changes', 'revisions', 'trash', 'settings']) {
    if (!new RegExp(`viewTab\\(\\s*'${view}'`).test(memorySrc)) {
      reasons.push(`视图 ${view} 的入口必须保留在页内顶部（viewTab('${view}', …)）`)
    }
  }

  /* ── ②b 记忆「首页」视图必须整块退役（2026-10-25 用户要求）────────
   *
   * 用户原话：「点击展开记忆的页面也不对，主页应该去掉」。
   *
   * 那张「首页」是进记忆页的第一屏（问候语 + 新增/导入/链接/AI 整理四张动作卡
   * + 分类磁贴 + 类型分布环 + 最近浏览）。问题在于它和现在的入口语义打架：
   * 主入口是侧栏二级菜单里的**工作区**，用户点「Dsh」就是要看那个工作区的条目，
   * 结果先被一张概览挡一下、还得再点一次「全部记忆」。
   *
   * 所以要钉三件事，防止它被"顺手加回来"：
   *   1. 视图条里不得再有 home 这一项；
   *   2. 默认视图必须是 all（挂载即看列表，不是看仪表盘）；
   *   3. Home.tsx / home-styles.ts 不得复活（留着文件就一定会有人再接回去）。
   */
  if (/viewTab\(\s*'home'/.test(memorySrc)) {
    reasons.push("记忆视图条不得再有「首页」（用户要求去掉）")
  }
  if (!/useState<MemoryTab>\(initialTab \?\? 'all'\)/.test(memorySrc)) {
    reasons.push("记忆默认视图必须是 'all'（首页去掉后挂载即看列表）")
  }
  if (/MemoryHome/.test(memorySrc)) reasons.push('记忆面板不得再 import / 渲染 MemoryHome')
  if (/tab === 'home'/.test(memorySrc)) reasons.push("记忆面板不得再有 tab === 'home' 的渲染分支")
  if (existsSync(resolve(ROOT, 'src/client/triad/memory/Home.tsx'))) {
    reasons.push('Home.tsx（记忆首页仪表盘）应已删除')
  }
  if (existsSync(resolve(ROOT, 'src/client/triad/memory/home-styles.ts'))) {
    reasons.push('home-styles.ts（记忆首页样式）应已删除')
  }
  // 换肤层里那批 .dsh-memory-home / .hm-* 规则也必须清掉（匹配不到元素的死选择器）
  const themeSrc2 = readFileSync(resolve(ROOT, 'src/client/triad/hub/theme.ts'), 'utf8')
  if (/\.dsh-memory-home\s*\{|\.wb-root \.dsh-memory-home \.|\.hm-hero::/.test(themeSrc2)) {
    reasons.push('hub/theme.ts 里不得残留记忆首页（.dsh-memory-home / .hm-*）的换肤选择器')
  }
  // 侧栏的记忆子项必须**整组都带图标**（缺图标的行会左移一格、与上面几行对不齐）
  if (!/icon: WorkspaceIcon/.test(memorySrc)) {
    reasons.push('记忆页推给侧栏的每个工作区子项都必须带 icon（否则文字与上面几行对不齐）')
  }

  /* ── ②c 工作区清单必须由**侧栏自己**拉，不能等记忆页面先被访问 ─────
   *
   * 用户报障：「点二级菜单为什么左侧的侧边栏会跳一下，并且工作区目录应该直接
   * 展示而不是点击全局记忆才展示」。
   *
   * 根因是依赖方向反了：工作区清单原先只由记忆页面在挂载后推给侧栏，而记忆页
   * 只在「工作台已打开且 tab=memory」时挂载。于是没进过记忆页时侧栏只有两项
   * 固定项，点进去那一拍才补上真实工作区 —— 实测 host 高度 512 → 572px，
   * 那就是用户看到的「跳一下」。
   *
   * 修复：新增 hub/workspace-source.ts，侧栏挂载时自己拉 /api/dsh-memory/projects。
   * 这组断言钉住这条依赖方向，防止有人又把它改回「等页面推」。
   */
  const workspaceSrc = existsSync(resolve(ROOT, 'src/client/triad/hub/workspace-source.ts'))
    ? readFileSync(resolve(ROOT, 'src/client/triad/hub/workspace-source.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    : ''
  if (workspaceSrc === '') {
    reasons.push('必须存在 hub/workspace-source.ts（侧栏自带的工作区数据源）')
  } else {
    if (!/createMemoryApi/.test(workspaceSrc)) reasons.push('workspace-source 必须自己建 memory api 取数')
    if (!/export async function fetchWorkspaces/.test(workspaceSrc)) {
      reasons.push('workspace-source 必须导出 fetchWorkspaces')
    }
    if (!/projectsToChildren/.test(workspaceSrc)) reasons.push('workspace-source 必须提供 projectsToChildren 转换')
    if (!/catch[\s\S]{0,120}return \[\]/.test(workspaceSrc)) {
      reasons.push('fetchWorkspaces 失败必须静默返回空数组（侧栏不能因为副菜单拉不到就少行）')
    }
    if (!/icon,/.test(workspaceSrc) && !/icon: icon/.test(workspaceSrc)) {
      reasons.push('projectsToChildren 必须给每个子项带 icon（否则与固定项对不齐）')
    }
  }
  // 侧栏必须在挂载时就拉，而不是等某个页面调用
  const sectionsCode2 = sectionsSrc2.replace(/\/\*[\s\S]*?\*\//g, '')
  if (!/fetchWorkspaces/.test(sectionsCode2)) {
    reasons.push('侧栏挂载器必须自己调 fetchWorkspaces（不能只靠记忆页面 setNavEntryChildren 推）')
  }
  if (!/pushWorkspaceChildren|setNavEntryChildren/.test(sectionsCode2)) {
    reasons.push('侧栏必须把拉到的工作区写进注册表（setNavEntryChildren）')
  }
  if (!/MEMORY_FIXED_CHILDREN/.test(sectionsCode2)) {
    reasons.push('侧栏的工作区子项必须以 MEMORY_FIXED_CHILDREN 打底（拉取失败时仍有两项固定项）')
  }
  // 侧栏与记忆页两处的工作区图标必须同名同形（否则两份数据交替时图标会跳变）
  if (!/function WorkspaceIcon/.test(sectionsCode2)) {
    reasons.push('nav-sections 必须定义 WorkspaceIcon（与记忆页那份同形）')
  }
  // 记忆页卸载时**不得**把 children 缩回固定项：那会把侧栏自拉的那份一起抹掉，
  // 用户离开记忆页后工作区行凭空消失（报障的后半段）。
  const memoryCode = memorySrc.replace(/\/\*[\s\S]*?\*\//g, '')
  const cleanupBlock = /useEffect\(\(\) => \{[\s\S]{0,900}?setNavEntryChildren\('workbench-memory', fixedChildren\)[\s\S]{0,80}?\}, \[projects\]\)/.exec(memoryCode)
  if (cleanupBlock !== null) {
    reasons.push('记忆页卸载时不得把工作区子项缩回固定项（会抹掉侧栏自拉的那份）')
  }
  if (!/}, \[projects\]\)/.test(memoryCode)) {
    reasons.push('记忆页必须仍在 projects 变化时把更准的清单推给侧栏')
  }

  /* ── ②d 切筛选时不得闪骨架屏（2026-10-25 用户报障）───────────────
   *
   * 用户原话：「为什么点记忆的二级菜单会刷新整个页面呢」。
   *
   * 实测结论：面板**没有**重新挂载（DOM 身份全程不变、navigation 计数为 1），
   * 真正闪的是骨架屏 —— 切换工作区时 `load()` 走非 silent 分支把状态置回
   * loading，列表先被清空换成 4 行骨架屏（t+3ms），再填回新数据（t+11ms）。
   * 那一闪看起来就是「整页刷新」。
   *
   * 修法：数据已经就绪时切筛选必须静默（silent: true），只有首次挂载
   * （屏幕上一条都没有）才显示骨架屏。这组断言钉住判据，防止写回恒 false。
   */
  if (!/load\(\{ silent: stateRef\.current\.status === 'ready' \}\)/.test(memoryCode)) {
    reasons.push("切换筛选时必须有条件地静默加载（load({ silent: stateRef.current.status === 'ready' })），否则点二级菜单会闪骨架屏")
  }
  if (!/const stateRef = useRef\(state\)/.test(memoryCode)) {
    reasons.push('必须用 stateRef 读数据状态（把 state.status 放进 effect 依赖会导致加载死循环）')
  }

  /* ── ③ 注册表：二级菜单结构 / 展开态 / 高亮现算 ────────────────── */
  const registry2 = await import(pathToFileURL(resolve(ROOT, 'src/client/triad/hub/nav-registry.ts')).href)
  const Icon = () => null
  registry2.resetNavRegistryForTests()
  registry2.navSection({ id: 'official', label: '工作区', icon: Icon, order: 10, source: 'official' })
  registry2.navSection({ id: 'shop', label: '操作间', icon: Icon, order: 20 })

  let activeScope = 'all'
  let picked = null
  const childRun = (id) => { picked = id }
  const entryDispose = registry2.navMenuItem({
    id: 'workbench-memory',
    label: '记忆',
    icon: Icon,
    section: 'shop',
    workbenchTab: 'memory',
    order: 10,
    children: [
      { id: 'all', label: '全部工作区', order: 10, run: () => { childRun('all') } },
      { id: 'global', label: '全局记忆', order: 20, run: () => { childRun('global') } },
    ],
    activeChild: () => activeScope,
  })
  // 没有 children 的行 = 不可展开（不画箭头），它的 children 必须是 undefined
  const flatDispose = registry2.navMenuItem({ id: 'workbench-usage', label: '用量', icon: Icon, section: 'shop', workbenchTab: 'usage' })

  const entryList = registry2.entriesOfSection('shop')
  const memoryEntry = entryList.find((e) => e.id === 'workbench-memory')
  const usageEntry = entryList.find((e) => e.id === 'workbench-usage')
  if (memoryEntry?.children?.length !== 2) reasons.push('navMenuItem 的 children 必须原样落进注册表')
  // 小标题机制已退役：条目定义上不该再有这个字段（传了也应该被忽略）
  if ('childrenTitle' in (memoryEntry ?? {})) {
    reasons.push('二级菜单小标题机制已退役，条目定义上不该再有 childrenTitle')
  }
  if (usageEntry?.children !== undefined) reasons.push('不传 children 的条目必须没有二级菜单（不画箭头）')
  if (memoryEntry && registry2.resolveActiveChild(memoryEntry) !== 'all') {
    reasons.push('高亮项必须来自 activeChild() 的现值')
  }
  // 高亮必须收敛到「真的还在 children 里」：工作区被删/改名后不能指着一个不存在的项
  activeScope = 'project:gone'
  if (memoryEntry && registry2.resolveActiveChild(memoryEntry) !== null) {
    reasons.push('activeChild 指向不存在的子项时必须收敛成 null（不能高亮一个没有的行）')
  }
  activeScope = 'global'
  if (memoryEntry && registry2.resolveActiveChild(memoryEntry) !== 'global') {
    reasons.push('activeChild 切换到 global 后高亮必须跟着走')
  }
  // 子项的 run 是唯一动作形态：点了就要真的被调用
  memoryEntry?.children?.find((c) => c.id === 'global')?.run?.()
  if (picked !== 'global') reasons.push('子项 run 必须被调用（切筛选的唯一动作）')

  // activeChild 抛异常不得把侧栏整个带崩（工作区数据脏了也只是不高亮）
  registry2.setNavEntryActiveChild('workbench-memory', () => { throw new Error('boom') })
  const refreshedEntry = registry2.entriesOfSection('shop').find((e) => e.id === 'workbench-memory')
  if (registry2.resolveActiveChild(refreshedEntry) !== null) {
    reasons.push('activeChild 抛异常时必须静默降级为不高亮')
  }
  // 不传 activeChild 的行也不该高亮（没有选中态可言）
  if (registry2.resolveActiveChild(usageEntry) !== null) {
    reasons.push('没有 activeChild 的条目必须不高亮')
  }

  // 展开态：默认全收起 → toggle 展开 → 持久化 → 陈旧 id 被丢弃
  registry2.toggleExpandedMenu('workbench-memory')
  if (!registry2.readExpandedMenus().has('workbench-memory')) reasons.push('toggleExpandedMenu 必须能展开一行')
  if (registry2.readExpandedMenus().has('workbench-usage')) reasons.push('只有真带 children 的行才能被展开')
  if (prefs.get(registry2.NAV_EXPANDED_STORE) !== 'workbench-memory') {
    reasons.push('展开态必须写进持久化层（用户选的是「记住上次展开状态」）')
  }
  // 陈旧 id（行已被删 / 升级后不再有下级）必须被丢弃，否则展开态会指向幽灵
  prefs.set(registry2.NAV_EXPANDED_STORE, 'workbench-memory,ghost-row')
  if (registry2.readExpandedMenus().has('ghost-row')) {
    reasons.push('持久化里的陈旧行 id 必须被丢弃（不能展开一个不存在的行）')
  }
  registry2.toggleExpandedMenu('workbench-memory')
  if (registry2.readExpandedMenus().has('workbench-memory')) reasons.push('再 toggle 一次必须收起')

  // 数据驱动的刷新入口：换 children 不能把行本身（图标/order/target）换掉
  const beforeChildren = memoryEntry?.children?.length
  if (registry2.setNavEntryChildren('workbench-memory', [
    { id: 'all', label: '全部工作区', order: 10, run: () => {} },
    { id: 'global', label: '全局记忆', order: 20, run: () => {} },
    { id: 'project:abc', label: 'D:\\AI\\Dsh', order: 30, count: 48, run: () => {} },
  ], '工作区') !== true) {
    reasons.push('setNavEntryChildren 对存在的行必须返回 true')
  }
  const refreshed = registry2.entriesOfSection('shop').find((e) => e.id === 'workbench-memory')
  if (refreshed?.children?.length !== 3) reasons.push(`setNavEntryChildren 必须补上新子项（期望 3，实得 ${refreshed?.children?.length}，原 ${beforeChildren}）`)
  if (refreshed?.target?.kind !== 'workbench' || refreshed.target.tab !== 'memory') {
    reasons.push('setNavEntryChildren 不得改动行本身的 target（只换子项）')
  }
  if (refreshed?.order !== 10) reasons.push('setNavEntryChildren 不得改动行的 order')
  const projectChild = refreshed?.children?.find((c) => c.id === 'project:abc')
  if (projectChild?.count !== 48) reasons.push('子项的 count 必须原样保留（行尾计数）')
  if (projectChild?.label !== 'D:\\AI\\Dsh') reasons.push('子项的 label 必须原样保留（工作区名）')
  if (registry2.setNavEntryChildren('no-such-row', []) !== false) {
    reasons.push('setNavEntryChildren 对不存在的行必须返回 false（不抛）')
  }
  // 子项的 run 是唯一动作形态：点了就要真的被调用
  refreshed?.children?.find((c) => c.id === 'global')?.run?.()
  if (picked !== 'global') reasons.push('子项 run 必须被调用（切筛选的唯一动作）')

  entryDispose(); flatDispose()
  registry2.resetNavRegistryForTests()

  /* ── ④ 意图通道：初值回填 / 广播 / 不丢精度 ────────────────────── */
  const intent = await import(pathToFileURL(intentPath).href)
  intent.resetWorkbenchIntentForTests()

  if (intent.readMemoryScope() !== 'all') reasons.push('记忆工作区初值必须是 all')
  if (intent.readGalleryKind() !== 'image') reasons.push('画廊类别初值必须是 image')

  // 三个方向都要能过：all / global / project:<hash>（工作区名里带反斜杠也不能被破坏）
  intent.requestMemoryScope('project:D:\\AI\\Dsh')
  if (intent.readMemoryScope() !== 'project:D:\\AI\\Dsh') {
    reasons.push(`记忆工作区必须原样回填，实得 ${intent.readMemoryScope()}`)
  }
  intent.requestMemoryScope('global')
  if (intent.readMemoryScope() !== 'global') reasons.push('记忆工作区必须能切到 global')
  // 非法值（人工改坏 localStorage / 升级后格式变了）必须回落，不能让页面卡在空筛选
  prefs.set(intent.MEMORY_SCOPE_STORE, 'garbage')
  if (intent.readMemoryScope() !== 'all') reasons.push('记忆工作区的非法值必须回落 all（不能卡空）')

  // 画廊：8 个类别全部可切，越界值回落
  for (const kind of intent.GALLERY_KIND_ORDER) {
    intent.requestGalleryKind(kind)
    if (intent.readGalleryKind() !== kind) reasons.push(`画廊类别 ${kind} 必须能切并回填`)
  }
  prefs.set(intent.GALLERY_KIND_STORE, 'not-a-kind')
  if (intent.readGalleryKind() !== 'image') reasons.push('画廊类别的非法值必须回落 image')
  // 越界类别写不进去（requestGalleryKind 自己挡）
  intent.requestGalleryKind('nope')
  if (intent.readGalleryKind() !== 'image') reasons.push('requestGalleryKind 必须挡掉未知类别')

  // 8 个类别与画廊页的 KIND_ORDER 必须是同一份真相（少一个 = 侧栏少一个入口）
  if (intent.GALLERY_KIND_ORDER.length !== 8) {
    reasons.push(`画廊二级菜单必须是 8 个类别，实得 ${intent.GALLERY_KIND_ORDER.length}`)
  }
  for (const kind of intent.GALLERY_KIND_ORDER) {
    if (typeof intent.GALLERY_KIND_LABEL[kind] !== 'string' || intent.GALLERY_KIND_LABEL[kind] === '') {
      reasons.push(`类别 ${kind} 缺少中文名（侧栏会显示英文 id）`)
    }
  }

  // 订阅：写意图必须通知（同树）+ 广播（跨根）。两条线各自独立，缺一条就有
  // 「页面已经挂着、侧栏点了没反应」的静默失效。
  let notified = 0
  const unsubscribe = intent.subscribeWorkbenchIntent(() => { notified += 1 })
  intent.requestMemoryScope('global')
  if (notified === 0) reasons.push('意图变化必须通知订阅方（同一 React 树）')
  const beforeUnsub = notified
  unsubscribe()
  intent.requestMemoryScope('all')
  if (notified !== beforeUnsub) reasons.push('退订后不得再收到通知（否则卸载的页面还在刷新）')

  // 跨根广播：必须真的 dispatch 到 window（页面与侧栏没有共同祖先，只此一条路）
  dispatched.length = 0
  intent.requestGalleryKind('pdf')
  const broadcasted = dispatched.filter((event) => event?.type === intent.WORKBENCH_INTENT_EVENT)
  if (broadcasted.length === 0) {
    reasons.push('意图变化必须往 window 广播（跨 React 根的唯一通道）')
  } else if (broadcasted.at(-1).detail?.galleryKind !== 'pdf') {
    reasons.push('广播的 payload 必须带上目标类别（订阅方要靠它判断切到哪）')
  }

  intent.resetWorkbenchIntentForTests()
  if (intent.readLastIntent() !== null) reasons.push('resetWorkbenchIntentForTests 必须清掉最近意图')
  delete globalThis.window
  delete globalThis.localStorage

  if (reasons.length > 0) {
    fail('侧栏二级菜单 + 意图通道：' + reasons.join('；'))
  } else {
    pass('侧栏二级菜单：记忆列工作区/画廊列 8 类 + 展开态持久化 + 高亮现算收敛 + 意图三向同步（初值/订阅/回写）')
  }
}

// ── 构建期反引号守卫（2026-10-25 补强后）──────────────────────────────
//
// 这组断言盯的是「守卫本身还在、且口径够宽」。当天实际踩的坑是
// `gallery/styles.ts` 的 `const SHEET = \`…\`` 被 CSS 注释里的反引号打断：
// **构建成功**，产物一加载就 `ReferenceError: root is not defined`，全套冒烟
// 在第 270 行死掉，报错指向打包产物、与源码对不上。
//
// 原守卫只扫 kr-chat 一个文件、判据是「全文恰好 2 个反引号」，既管不到别的
// 样式表，也会被「同文件第二个模板」误报。所以这里钉三件事：
//   1. 守卫必须还在并被调用（删掉它就等于回到靠人肉记的路上）；
//   2. 判据必须是**扫整个源码树**（不能退回单文件）；
//   3. 不许再用「全文计数 == 2」那种写法（多模板文件必误报）。
{
  const reasons = []
  const buildSrc = readFileSync(resolve(ROOT, 'build.mjs'), 'utf8')
  if (!/function assertCssTemplateDelimiters/.test(buildSrc)) {
    reasons.push('build.mjs 必须保留 assertCssTemplateDelimiters 反引号守卫')
  }
  if (!/assertCssTemplateDelimiters\(\)/.test(buildSrc)) {
    reasons.push('反引号守卫必须在构建前被真正调用（定义了却不调用等于没有）')
  }
  // 口径必须覆盖整个 src/client（原版只写死了 kr-chat/styles.ts 一个文件）
  if (!/walk\(|readdirSync/.test(buildSrc.slice(buildSrc.indexOf('function assertCssTemplateDelimiters')))) {
    reasons.push('反引号守卫必须递归扫源码树（不能只看单个文件）')
  }
  // 不许退回「全文反引号计数」的老判据
  const guardBody = buildSrc.slice(
    buildSrc.indexOf('function assertCssTemplateDelimiters'),
    buildSrc.indexOf('/** Fail the build if the host bundle'),
  )
  if (/offsets\.length === 2/.test(guardBody)) {
    reasons.push('反引号守卫不得退回「全文计数 == 2」判据（同文件多个模板必误报）')
  }

  // 反向验证：当前源码树必须真的干净（守卫放行的前提）
  const dirty = []
  const walkSrc = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'vendor') continue
        walkSrc(full)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const lines = readFileSync(full, 'utf8').split('\n')
        let openLine = -1
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i].replace(/\\`/g, '')
          if (openLine < 0) {
            if (/=\s*`\s*$/.test(line)) openLine = i
            continue
          }
          if (/^\s*`\s*[;,)`]?\s*$/.test(line)) { openLine = -1; continue }
          if (line.includes('`')) {
            dirty.push(`${relative(ROOT, full)}:${i + 1}`)
            openLine = -1
          }
        }
      }
    }
  }
  walkSrc(resolve(ROOT, 'src/client'))
  if (dirty.length > 0) {
    reasons.push(`源码里有被反引号打断的模板字面量：${dirty.join('、')}`)
  }

  if (reasons.length > 0) {
    fail('构建期反引号守卫：' + reasons.join('；'))
  } else {
    pass('构建期反引号守卫：扫全源码树 + 逐条模板判断 + 构建前调用（防「构建成功、产物加载即崩」）')
  }
}

// ── 画廊「空类别不得自动弹回」（2026-10-25）────────────────────────────
//
// 类别入口搬到侧栏二级菜单后，用户点「PDF」必须是「停在 PDF」。这条曾经踩过：
// 页面里有一段既有的「当前类别 0 条 → 回落到首个有内容的类别」，是**页内芯片条**
// 时代的兜底；搬到侧栏之后它变成了反效果 ——
//   · 用户明确点了 PDF，页面自己跳去图片，等于否掉他刚那一下；
//   · 它还会回写意图，把侧栏高亮一起改掉，于是侧栏亮着 PDF、页面显示图片；
//   · 再点一次侧栏 PDF 毫无反应（值没变、事件不变）。
// 所以这里钉死：那段自动回落不得存在，且空类别要有自己那一档文案。
{
  const reasons = []
  const gallerySrc = readFileSync(resolve(ROOT, 'src/client/triad/gallery/GalleryPanel.tsx'), 'utf8')

  // 自动回落的特征写法：在 effect 里找 firstAvailable 再 changeKind 过去
  const autoFallback = /firstAvailable\s*=\s*KIND_ORDER\.find[\s\S]{0,200}?changeKind\(firstAvailable\)/
  if (autoFallback.test(gallerySrc)) {
    reasons.push('画廊不得再「当前类别 0 条就自动回落到首个有内容的类别」（会否掉用户在侧栏的点击并改掉侧栏高亮）')
  }
  if (/changeKind\(firstAvailable\)/.test(gallerySrc)) {
    reasons.push('画廊源码里仍残留 changeKind(firstAvailable) 自动回落调用')
  }
  // 空类别必须有专门的一档文案（否则一屏空白会被当成页面坏了）
  if (!/这一类还没有产出/.test(gallerySrc)) {
    reasons.push('选中空类别时必须有「这一类还没有产出」的专属空态文案')
  }
  // 意图三件套仍在（本块只删了自动回落，通道本身不能连带掉）
  if (!/requestGalleryKind/.test(gallerySrc)) reasons.push('画廊改类别必须仍回写 requestGalleryKind')

  if (reasons.length > 0) {
    fail('画廊空类别：' + reasons.join('；'))
  } else {
    pass('画廊空类别：不自动弹回（尊重侧栏点击）+ 专属空态文案 + 意图回写仍在')
  }
}

// ── 对话内 HTML 卡片（```html 围栏 → 沙箱 iframe）───────────────────────
//
// 这组断言盯的是「静默失效」：围栏不命中只会显示成代码块，沙箱写错只会变成
// 「能跑但能碰宿主」——两者都不报错，只能靠断言钉住。
{
  const reasons = []
  if (typeof mod.splitHtml !== 'function' || typeof mod.looksLikeHtmlFence !== 'function') {
    reasons.push('缺少 splitHtml / looksLikeHtmlFence 导出')
  } else {
    // ① 正常围栏必须切出卡片，且标题从 <title> / <h1> 提取。
    const ok = mod.splitHtml('前文\n```html\n<h1>计数器</h1><button>+1</button>\n```\n后文')
    const card = ok.find((part) => part.kind === 'html')
    if (ok.length !== 3 || card === undefined) {
      reasons.push(`普通围栏未被切出卡片：${JSON.stringify(ok.map(p => p.kind))}`)
    } else {
      if (card.spec.title !== '计数器') reasons.push(`标题应从 h1 提取，实得 ${card.spec.title}`)
      if (!card.spec.html.includes('<button>')) reasons.push('卡片正文丢了 HTML 内容')
      if (ok[0].kind !== 'md' || ok[2].kind !== 'md') reasons.push('围栏前后的 markdown 必须原样保留')
    }
    // ② 语言标记必须精确匹配 html：```html-preview / ```html5 不得被吞。
    for (const lang of ['html-preview', 'html5']) {
      const parts = mod.splitHtml('```' + lang + '\n<div>x</div>\n```')
      if (parts.some((part) => part.kind === 'html')) reasons.push('```' + lang + ' 不该被识别成 HTML 卡片')
    }
    // ③ 大写到 ```HTML 要认（模型经常这么写）。
    if (!mod.splitHtml('```HTML\n<div>x</div>\n```').some((part) => part.kind === 'html')) {
      reasons.push('```HTML 大写标记应被识别')
    }
    // ④ 未闭合围栏（流式半截）不得渲染成真卡片：否则每个 delta 都会重载 iframe。
    if (mod.splitHtml('```html\n<div>半截').some((part) => part.kind === 'html')) {
      reasons.push('未闭合围栏不得渲染成真卡片（流式期必须保持代码块或占位）')
    }
    // ⑤ 空内容 / 纯文字 → 回退原文；**体积不设闸门**（长卡片照常出卡）。
    if (mod.splitHtml('```html\n\n```').some((part) => part.kind === 'html')) reasons.push('空围栏应回退')
    if (mod.splitHtml('```html\njust text\n```').some((part) => part.kind === 'html')) reasons.push('无标签内容应回退')
    /*
     * ⑤a **不再有体积闸门**：卡片高度由宿主按上报值给框（MAX_FRAME_HEIGHT 才是
     * 真正的硬约束），按字符数截断只会误伤写得长的好卡片——同一句 80K 字符，
     * 中文是英文的三倍字节，而「整站贴进来」这种坏输入根本拦不住（它只是变长，
     * 并没有变得不可渲染）。所以这里反过来钉死：大围栏必须照常出卡。
     */
    const huge = '```html\n<div>' + 'x'.repeat(81000) + '</div>\n```'
    if (!mod.splitHtml(huge).some((part) => part.kind === 'html')) reasons.push('大围栏不该被体积闸门回退（已去掉上限）')

    /*
     * ⑤c **设计系统按需注入**（kit.ts）。
     *
     * 两条都不报错、都只会静默变差：
     *  · 该注入没注入 → 模型写了 .k-bar 却拿到一个裸 div，卡片看着像没样式；
     *  · 不该注入却注入了 → 每张纯 SVG 卡片白背 6KB，且可能撞上模型自己的类名。
     * 所以两侧都钉：用到 k- 必注入，没用到必不注入。
     */
    const withKit = mod.assembleHtmlDocument('<div class="k-bar"><span style="--n:3"></span></div>')
    const withoutKit = mod.assembleHtmlDocument('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')
    if (!withKit.includes('data-dsh-kit')) reasons.push('正文用了 k- 类名时必须注入设计系统')
    if (withoutKit.includes('data-dsh-kit')) reasons.push('没用到 k- 类名的卡片不该背 kit（纯浪费体积）')
    if (!withKit.includes('--k-accent')) reasons.push('kit 必须自带 --k-accent 等 token')
    if (!mod.needsKit('<div class="k-kv">x</div>')) reasons.push('needsKit 应识别 k-kv')
    if (mod.needsKit('<div class="k-9">x</div>')) reasons.push('needsKit 不该把 k-9 误判成 kit 类名')

    /*
     * ⑤d **共享运行时按需注入**（runtime.ts）。
     *
     * 三个能力各判各的：判据松了会白送字节，判紧了模型写了属性却拿到死元素。
     * 两侧都钉。
     */
    const tipDoc = mod.assembleHtmlDocument('<button data-tooltip="刷新">R</button>')
    const tabDoc = mod.assembleHtmlDocument('<div role="tablist"><button role="tab">A</button></div>')
    const bareDoc = mod.assembleHtmlDocument('<div>纯静态</div>')
    if (!tipDoc.includes('data-dsh-runtime')) reasons.push('用了 data-tooltip 必须注入运行时')
    if (!tipDoc.includes('dsh-tip')) reasons.push('tooltip 运行时必须含浮层类名 dsh-tip')
    if (!tabDoc.includes('data-dsh-runtime')) reasons.push('用了 role=tablist 必须注入运行时')
    if (bareDoc.includes('data-dsh-runtime')) reasons.push('没用到任何能力时不该注入运行时')
    const need = mod.needsRuntime('<i data-tooltip="x"></i>')
    if (need.tooltip !== true || need.tabs !== false || need.state !== false) {
      reasons.push('needsRuntime 应按能力分别判定（实得 ' + JSON.stringify(need) + '）')
    }
    if (mod.needsRuntime('正文里提了一句 tooltip 这个词').tooltip !== false) {
      reasons.push('needsRuntime 不该把「正文提到 tooltip」误判成要用提示气泡')
    }
    /*
     * ⑤e kit 与 runtime 必须**配合**：运行时把 aria-selected 维护对了，但
     * 没有对应的选中态样式，用户看到两个一模一样的 tab —— 功能对、体验错，
     * 这种最难发现（验收时功能断言全绿）。所以样式存在性也钉一条。
     */
    if (!mod.KIT_CSS.includes('[aria-selected="true"]')) {
      reasons.push('kit 必须给 tabs 选中态样式（否则看不出当前在哪个 tab）')
    }
    if (!mod.KIT_CSS.includes('data-tooltip') && !mod.RUNTIME_PARTS.tooltip.includes('dsh-tip')) {
      reasons.push('tooltip 浮层类名 dsh-tip 必须在运行时里')
    }
    // 减弱动效：动效必须可为系统设置关闭（无障碍硬要求）。
    if (!mod.KIT_CSS.includes('prefers-reduced-motion')) {
      reasons.push('kit 动效必须尊重 prefers-reduced-motion')
    }
    if (!mod.RUNTIME_PARTS.tooltip.includes('prefers-reduced-motion')) {
      reasons.push('tooltip 淡入必须尊重 prefers-reduced-motion')
    }

    /*
     * ⑤f **尺寸必须跟随字号轴**（用户 2026-10-19 指出）。
     *
     * 这条错了不报错、只是「字变大了但条还是细的」——正文是满跟随的，
     * 卡片里的图形停在 14px 世界，比整体不跟更难看。三件事一起钉：
     *  · 有 --k-scale 这个无单位系数；
     *  · 除数是 14px 不是 14（写错会让 calc 求值成 px²，整条声明被静默丢弃，
     *    元素回退成初始值）；
     *  · 关键图元（条高 / 轨道 / 圆角 / 内边距）真的乘了这个系数。
     */
    const kitFlat = mod.KIT_CSS.replace(/\s/g, '')
    if (!kitFlat.includes('--k-scale')) reasons.push('kit 必须有 --k-scale 缩放系数')
    /*
     * ⚠ 正则别写成 `calc\([^)]*\/14px\)`：源里是
     * `calc(var(--k-fs)/14px)`，字符类 [^)] 会在 var(--k-fs) 的第一个
     * 右括号处停下，永远匹配不到。这条自己踩过一次。
     */
    if (!/--k-scale:calc\(var\(--k-fs\)\/14px\)/.test(kitFlat)) {
      reasons.push('--k-scale 的除数必须是 14px（写成 14 会让 calc 求值成 px²，整条声明被丢弃）')
    }
    /*
     * ⑤g **自定义属性不得自引用**（2026-10-20 用户截图「页签挤一块」）。
     *
     * 曾经写成 `--k-fs:var(--dsh-frame-font-size,var(--k-fs))`：循环引用让整条
     * 声明成为 guaranteed-invalid，而 invalid 的自定义属性**在继承时也是
     * invalid** —— 后代拿到的 --k-scale 全部无效，所有 calc(… * var(--k-scale))
     * 声明被丢弃，gap 回退 normal、条高回退 auto。表现就是三个页签文字紧贴。
     *
     * 这条只能靠静态检查钉住：浏览器不报错、不警告，视觉上只是「间距没了」。
     */
    for (const decl of mod.KIT_CSS.match(/--[a-z-]+\s*:[^;}]*/g) ?? []) {
      const name = /^(--[a-z-]+)\s*:/.exec(decl)?.[1]
      if (name === undefined) continue
      const value = decl.slice(decl.indexOf(':') + 1)
      if (new RegExp('var\\(\\s*' + name + '\\s*[,)]').test(value)) {
        reasons.push('自定义属性 ' + name + ' 引用了自己（循环引用会让整条声明及其继承值全部失效）')
      }
    }
    for (const [sel, why] of [
      // k-bar 的高度包在 var(--k-bar-h, …) 里，模型可以覆盖；只断言 calc 那段在。
      ['calc(30px*var(--k-scale))', '堆叠条高度'],
      ['calc(6px*var(--k-scale))', '进度条高度'],
      ['--k-radius:calc(10px*var(--k-scale))', '圆角'],
      ['--k-pad:calc(16px*var(--k-scale))', '内边距'],
    ]) {
      if (!kitFlat.includes(sel)) reasons.push(why + '必须跟随 --k-scale 缩放')
    }

    // 运行时不得引外部资源：沙箱是 opaque origin，CDN 一律白屏。
    for (const [name, src] of Object.entries(mod.RUNTIME_PARTS)) {
      if (/<script[^>]+src=/.test(src)) reasons.push(name + ' 运行时不得引外部脚本')
      if (/fetch\(|XMLHttpRequest/.test(src)) reasons.push(name + ' 运行时不得发网络请求')
    }
    /*
     * ⑤b **只有注释的围栏必须回退**（2026-10-08 事故现场）。
     *
     * 模型把围栏正文写成一行 `<!-- 内容较长，此处省略 -->`；原判据
     * `/<[a-z!/]/i` 把注释的 `<!` 也算成标签 → 判成合法卡片 → 渲染成
     * **一张空白框**，角落标 `55 B`。用户看到「对话框里是空白的」，
     * 而模型以为自己已经说明了省略原因。
     *
     * 空白框是最坏的失败态：它不告诉任何人发生了什么。回退成代码块至少能
     * 让用户看见模型当时写了什么。同时**不能误伤**真卡片，所以下面这几条
     * 「必须放行」的也要一起断言。
     */
    const fence = (body) => mod.splitHtml('```html\n' + body + '\n```').some((part) => part.kind === 'html')
    const mustFallback = [
      ['只有占位注释', '<!-- 完整单文件内容较长，此处省略 —— 实际交付见下方卡片 -->'],
      ['只有普通注释', '<!-- 待补充 -->'],
      ['只有多行注释', '<!--\n  a\n  b\n-->'],
      ['注释 + 纯文字', '<!-- x -->\n这里什么都没有'],
    ]
    for (const [why, body] of mustFallback) {
      if (fence(body)) reasons.push(`html 围栏「${why}」必须回退成代码块（渲染出来是空白卡片，用户看不出发生了什么）`)
    }
    const mustPass = [
      ['注释 + 真标签', '<!-- 说明 -->\n<h1>标题</h1>'],
      ['DOCTYPE 开头', '<!DOCTYPE html><html><body><h1>x</h1></body></html>'],
      ['只有 style', '<style>body{background:#fff}</style>'],
      ['只有 script', '<script>console.log(1)</script>'],
    ]
    for (const [why, body] of mustPass) {
      if (!fence(body)) reasons.push(`html 围栏「${why}」必须仍渲染成卡片（剥注释判据不能误伤真内容）`)
    }
    // ⑥ 廉价预判不能误伤普通正文（正文里出现 "HTML" 三个字母太常见）。
    if (mod.looksLikeHtmlFence('这是一张 HTML 卡片，见下方')) reasons.push('looksLikeHtmlFence 不能只看 html 字样')
    if (!mod.looksLikeHtmlFence('```html\n<div></div>\n```')) reasons.push('looksLikeHtmlFence 漏掉了真围栏')

    // ⑦ CSP：把「不引外网资源」从提示词约定变成浏览器强制。
    //
    // sandbox 只挡同源、不挡网络 —— 模型页面里的 fetch/XHR/WebSocket 本来能自由
    // 外联，把正文里出现的工作区路径、内网地址拼进请求发出去。这条不写不会报错，
    // 只会在某天变成一条没人看得懂的出网记录。
    {
      const doc = mod.assembleHtmlDocument('<div>hi</div>')
      if (!/Content-Security-Policy/.test(doc)) reasons.push('iframe 文档必须带 CSP（否则卡片可自由外联）')
      if (!/default-src 'none'/.test(doc)) reasons.push("CSP 必须 default-src 'none'（兜底全禁，白名单放行）")
      if (!/connect-src 'none'/.test(doc)) reasons.push("CSP 必须 connect-src 'none'（断掉 fetch/XHR/WebSocket 外发）")
      if (!/script-src 'unsafe-inline'/.test(doc)) reasons.push("CSP 必须放行 script-src 'unsafe-inline'（卡片里的 JS 要能跑）")
      if (!/img-src data: blob:/.test(doc)) reasons.push('CSP 必须放行 data:/blob: 图片（内联 SVG 与 canvas 依赖它）')
      // CSP 必须在模型内容之前出现，否则前面那段已经有执行机会。
      const cspAt = doc.indexOf('Content-Security-Policy')
      const bodyAt = doc.indexOf('<body>')
      if (cspAt < 0 || (bodyAt >= 0 && cspAt > bodyAt)) reasons.push('CSP 必须出现在 <body> 之前（先于任何模型内容）')
      // 完整文档路径同样要带（模型自己写了 <html> 时走另一条分支）。
      const full = mod.assembleHtmlDocument('<html><head><title>t</title></head><body><p>x</p></body></html>')
      if (!/Content-Security-Policy/.test(full)) reasons.push('完整文档路径也必须带 CSP（分支漏一条等于没有）')
      // 模型自己声明了 CSP 时以它为准，不覆盖。
      const own = mod.assembleHtmlDocument('<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>x</body></html>')
      if ((own.match(/Content-Security-Policy/g) ?? []).length !== 1) reasons.push('模型自带 CSP 时不得再注入第二份')
    }

    // ⑧ 流式期未闭合围栏 → pending 占位卡（本轮需求的核心）。
    //
    // 背景：模型写 HTML 卡片是逐字流出来的，几百行代码逐字往外冒既没法读又把
    // 对话流撑长。所以一出现 ```html 就该换成一张「预渲染中」的占位卡。
    {
      const live = mod.splitHtml('前文\n```html\n<h1>计数器</h1>\n<button>+1', true)
      const ph = live.find((part) => part.kind === 'html')
      if (ph === undefined) {
        reasons.push('流式期未闭合的 ```html 必须产出占位卡（不能把代码逐字往外冒）')
      } else {
        if (ph.pending !== true) reasons.push('流式期未闭合围栏必须标记 pending=true')
        if (!ph.spec.html.includes('<h1>计数器</h1>')) reasons.push('占位卡丢了已写出的正文（字节数就靠它显示）')
        if (ph.spec.bytes !== ph.spec.html.length) reasons.push('占位卡的 bytes 必须等于已写出的字符数')
        // 围栏标记行本身不能出现在卡片正文里。
        if (ph.spec.html.includes('```')) reasons.push('占位卡正文不得包含围栏标记本身')
      }
      // 闭合那一刻：同一条内容必须从 pending=true 变成 pending=false，
      // 且**片段序号不变**（key 不变 → React 复用同一实例 → 不闪）。
      const closed = mod.splitHtml('前文\n```html\n<h1>计数器</h1>\n<button>+1</button>\n```', true)
      const done = closed.find((part) => part.kind === 'html')
      if (done === undefined || done.pending !== false) {
        reasons.push('围栏闭合后必须转为 pending=false（同 key 原位换真身）')
      } else if (done.spec.title !== '计数器') {
        reasons.push(`闭合后应能从 h1 抠出标题，实得 ${done.spec.title}`)
      }
      // 非流式期（历史消息）不得产出占位卡：被截断的围栏不该永远停在「预渲染中」。
      if (mod.splitHtml('```html\n<div>被截断', false).some((part) => part.kind === 'html')) {
        reasons.push('非流式期的未闭合围栏必须回退成代码块（不能永远显示预渲染中）')
      }
      // 未闭合围栏若不是 html 语言，一律不碰（```js 半截照旧走代码块）。
      if (mod.splitHtml('```js\nconst a = 1', true).some((part) => part.kind === 'html')) {
        reasons.push('只有 ```html 才走占位卡，其它语言的半截围栏不得被吞')
      }
      // 正文里的普通反引号（行内代码）不该被误判成围栏。
      if (mod.splitHtml('用 `code` 说明，然后 ```html 开始', true).some((part) => part.kind === 'html' && part.pending)) {
        reasons.push('行内反引号不得被误判成未闭合围栏')
      }
    }
  }

  // ⑦ 沙箱装配：安全约束是硬判据，不是风格问题。
  if (typeof mod.assembleHtmlDocument !== 'function') {
    reasons.push('缺少 assembleHtmlDocument 导出')
  } else {
    const doc = mod.assembleHtmlDocument('<div>hi</div>')
    if (!doc.includes('<div>hi</div>')) reasons.push('装配后的文档丢了原内容')
    if (!doc.includes(mod.BRIDGE_TO_HOST)) reasons.push('装配后的文档缺少高度桥脚本')
    if (!doc.includes('<base target="_blank">')) reasons.push('缺少 base target=_blank（卡片内点击会在 iframe 里导航走）')
    // 完整文档分支：不能重复套骨架，兜底样式进 head、bridge 进 body 末尾。
    const full = mod.assembleHtmlDocument('<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>')
    if ((full.match(/<html/g) ?? []).length !== 1) reasons.push('完整文档不得被再套一层骨架')
    if (!/<\/body>/.test(full) || full.indexOf(mod.BRIDGE_TO_HOST) > full.indexOf('</body>')) {
      reasons.push('bridge 必须插在 </body> 之前')
    }
    // 兜底样式必须在模型自己的样式**之前**（head 开头）：插在 body 末尾会用
    // 兜底覆盖模型写的 body margin 等设计意图（实测踩过）。
    if (full.indexOf('<style>html,body{margin:0') > full.indexOf('<title>')) {
      reasons.push('兜底样式必须插在 head 开头（在模型样式之前），否则会覆盖模型自己的布局')
    }
    // 没有 head 的完整文档也不能丢 bridge。
    const noHead = mod.assembleHtmlDocument('<html><body><p>y</p></body></html>')
    if (!noHead.includes(mod.BRIDGE_TO_HOST)) reasons.push('无 head 的完整文档也必须注入 bridge')
    if (!(mod.MAX_FRAME_HEIGHT > mod.MIN_FRAME_HEIGHT)) reasons.push('高度上下限不合法')

    // ⑦-2 截图定格：截图管线只等字体/图片，**不等动画**。带入场动画
    // （opacity:0 + animation-delay）的卡片抓帧时元素还停在起始帧 → 截图缺内容
    // 且无任何报错（实测五段动画只出现第一段）。所以截图路径必须能把动画推到终态。
    const settled = mod.assembleHtmlDocument('<div>x</div>', 'f0', { settleAnimations: true })
    const plain = mod.assembleHtmlDocument('<div>x</div>', 'f0')
    // 默认（对话流）绝不能带定格样式：那里的卡片是活的，动效必须保留。
    if (/animation-duration\s*:\s*1ms/.test(plain)) {
      reasons.push('默认装配不得注入定格样式（对话流卡片要保持真实动效）')
    }
    if (!/animation-duration\s*:\s*1ms/.test(settled)) {
      reasons.push('settleAnimations 必须把 animation-duration 压到 1ms（否则截图抓不到终态）')
    }
    // 定格不能靠 animation:none —— 那会让 opacity:0 的元素**永久**不可见，比原问题更糟。
    if (/animation\s*:\s*none/.test(settled)) {
      reasons.push('定格必须让动画「立刻跑完」而不是 animation:none（后者会让 opacity:0 永久不可见）')
    }
    // 必须同时收住 delay 与 infinite：前者决定起跑，后者决定抓帧落点是否随机。
    if (!/animation-delay\s*:\s*0s/.test(settled)) reasons.push('定格必须把 animation-delay 归零')
    if (!/animation-iteration-count\s*:\s*1/.test(settled)) {
      reasons.push('定格必须把 animation-iteration-count 收到 1（否则 infinite 动画会疯狂闪烁）')
    }
    // 模型样式通常写在 body 里、位置靠后；不带 !important 会被压回去，定格失效。
    if (!/animation-duration\s*:\s*1ms\s*!important/.test(settled)) {
      reasons.push('定格样式必须带 !important（模型样式在文档里更靠后，否则压不住）')
    }
    // 定格样式要排在模型样式之后（与 bridge 同处文档尾部），否则同样被覆盖。
    if (settled.indexOf('animation-duration:1ms') < settled.indexOf('<div>x</div>')) {
      reasons.push('定格样式必须排在正文之后（模型样式之后），否则被覆盖')
    }
  }

  // ⑦-3 截图内嵌 iframe 的高度上限：与对话流分开取值。
  // 对话流是视口内滚动容器（4000 合理）；截图是长图载体，管线自身允许到 14000，
  // 卡在 2400 会把一张 3000px 的卡片腰斩（实测 y=2000 之后内容消失）。
  {
    const cardSrc = readFileSync(resolve(ROOT, 'src/shot/card.ts'), 'utf8')
    const m = /const SHOT_FRAME_MAX_HEIGHT = (\d+)/.exec(cardSrc)
    if (m === null) {
      reasons.push('缺少 SHOT_FRAME_MAX_HEIGHT（截图内嵌高度上限）')
    } else {
      const limit = Number(m[1])
      if (!(limit > 2400)) reasons.push(`截图内嵌高度上限必须大于历史值 2400（当前 ${limit}，会把长图腰斩）`)
      if (limit > 14000) reasons.push(`截图内嵌高度上限不得超过管线自身上限 14000（当前 ${limit}）`)
    }
    if (!/MIN_FRAME_HEIGHT\s*,\s*Math\.min\(MAX_H/.test(cardSrc) && !/Math\.max\(MIN_H/.test(cardSrc)) {
      reasons.push('截图内嵌高度必须钳到 [MIN_FRAME_HEIGHT, SHOT_FRAME_MAX_HEIGHT]')
    }
    // 已上报判定必须靠显式标记：内容真高恰好等于兜底 320px 时，
    // 「高度 ≠ 320px」永远不成立，会白等到超时。
    const rendererSrc = readFileSync(resolve(ROOT, 'src/shot/renderer.ts'), 'utf8')
    if (!/data-settled/.test(cardSrc)) reasons.push('内嵌 iframe 上报后必须打 data-settled 标记')
    if (/style\.height === '320px'/.test(rendererSrc)) {
      reasons.push('等待判定不得用「高度 ≠ 320px」（真高恰为 320 时会白等到超时），必须用 data-settled')
    }
    // data-settled 的语义必须是「高度已停止变化」而不是「收到过上报」。
    // 桥在 DOMContentLoaded 就立刻量一次（图片/字体还没落地 → 偏矮值），
    // 一收到上报就放行会拿偏矮值定格整图；而 iframe 带 scrolling="no" +
    // 内部 overflow:hidden，晚到内容既不可见也不可滚动 → 静默裁掉。
    // 实测：初始 300px、300ms 后追加 1200px 的卡片，追加部分整块消失。
    if (!/SETTLE_QUIET_MS/.test(cardSrc)) {
      reasons.push('data-settled 必须靠静默窗口判定（SETTLE_QUIET_MS），不能一收到上报就标记')
    }
    if (!/removeAttribute\('data-settled'\)/.test(cardSrc)) {
      reasons.push('收到新高度时必须先摘掉 data-settled（否则 renderer 会拿中途值就走）')
    }
    // 等待上限必须显著大于静默窗口，否则正常内容也判不出稳定、每次白等到超时。
    const quietMatch = /const SETTLE_QUIET_MS = (\d+)/.exec(cardSrc)
    const waitMatch = /const FENCE_WAIT_MS = (\d+)/.exec(rendererSrc)
    if (quietMatch === null || waitMatch === null) {
      reasons.push('缺少 SETTLE_QUIET_MS / FENCE_WAIT_MS 常量')
    } else if (!(Number(waitMatch[1]) > Number(quietMatch[1]) * 2)) {
      reasons.push(`FENCE_WAIT_MS(${waitMatch[1]}) 必须显著大于 SETTLE_QUIET_MS(${quietMatch[1]})，否则判不出稳定`)
    }
    // 本地 HTML 文件内嵌走 probePageHeight（先单独导航量高），与围栏内嵌是两条路径。
    // 上限必须同源：否则同一张长页走文件内嵌与走围栏内嵌会得到两种结果（一处腰斩）。
    if (!/SHOT_FRAME_MAX_HEIGHT/.test(rendererSrc)) {
      reasons.push('probePageHeight 必须与围栏内嵌共用 SHOT_FRAME_MAX_HEIGHT（否则文件内嵌那条路仍会腰斩）')
    }
    if (/Math\.min\(2400/.test(rendererSrc)) {
      reasons.push('probePageHeight 不得再写死 2400（应改用 SHOT_FRAME_MAX_HEIGHT）')
    }
    // 常量必须从 card.ts 导出（renderer 复用），不能各写一份字面量。
    if (!/export const SHOT_FRAME_MAX_HEIGHT/.test(cardSrc)) {
      reasons.push('SHOT_FRAME_MAX_HEIGHT 必须从 card.ts 导出供 renderer 复用')
    }

    // ⑦-4 围栏落点必须按**内容哈希**定位，不能按序号。
    // 两侧的围栏识别规则不可能完全一致（markdown-it 认 ` ```html title=x `、不认
    // 缩进围栏；splitHtml 的正则反之），数序号必然漂移 → 卡片插到非法围栏的位置。
    // 实测：非法围栏（只有注释）在前时，卡片会插到它的位置上。
    if (!/export function fenceKey/.test(readFileSync(resolve(ROOT, 'src/shot/markdown.ts'), 'utf8'))) {
      reasons.push('markdown.ts 必须导出 fenceKey（围栏内容哈希定位键）')
    }
    const markdownSrc = readFileSync(resolve(ROOT, 'src/shot/markdown.ts'), 'utf8')
    if (!/data-fence-k="\$\{/.test(markdownSrc) && !/data-fence-k="\$\{fenceKey/.test(markdownSrc)) {
      reasons.push('html/iu 围栏必须写 data-fence-k（内容哈希）供注入侧定位')
    }
    if (/data-fence-i="/.test(markdownSrc) || /data-fence-i="/.test(cardSrc)) {
      reasons.push('不得再用序号 data-fence-i 定位（会被回退围栏与解析差异带偏），必须用 data-fence-k')
    }
    // shiki 语言名大小写敏感：```HTML 必须归一后再喂给 shiki，否则降级成
    // shiki plain（无定位键）→ 卡片整块消失、连源码块都不留。
    if (!/lang:\s*normalized/.test(markdownSrc)) {
      reasons.push('shiki 语言名必须小写归一（```HTML 否则会整块消失）')
    }

    // ⑦-5 内嵌页「量不准 / 装不下」都必须在卡片里说出来。
    // iframe 带 scrolling="no" + 内部 overflow:hidden，被裁的部分既不可见也不可
    // 滚动，不标注用户会以为那就是页面的全部。
    const themeSrc2 = readFileSync(resolve(ROOT, 'src/shot/theme.ts'), 'utf8')
    if (!/data-clipped/.test(cardSrc) || !/data-clipped="1"/.test(themeSrc2)) {
      reasons.push('内嵌围栏超上限时必须打 data-clipped 并在 CSS 里给出可见角标')
    }
    if (!/trusted/.test(cardSrc) || !/高度未能量准/.test(cardSrc)) {
      reasons.push('本地 HTML 量高不可信时必须在图注里说明')
    }
    if (!/clipped/.test(cardSrc) || !/超过 \$\{SHOT_FRAME_MAX_HEIGHT\}px 上限/.test(cardSrc)) {
      reasons.push('本地 HTML 超上限被截断时必须在图注里说明')
    }

    // ⑦-6 分段截图的滚动必须校验到位，不能静默吞掉。
    // 滚动没发生而 PNG 照常 push 到 y 位置 → 重复条带 + 底部缺失，且
    // stitchPng 的 totalHeight 是高度累加，不会暴露这个错位。
    if (!/scrollToY/.test(rendererSrc)) {
      reasons.push('分段截图必须校验滚动到位（scrollToY），不能 catch 后静默继续')
    }
    if (/window\.scrollTo\(0, \$\{y\}\); setTimeout\(resolve, 150\)/.test(rendererSrc)) {
      reasons.push('分段滚动不得再是无校验的 fire-and-forget')
    }

    // ⑦-7 长图截断必须可见（前端消费 truncated）。
    if (!/truncated/.test(rendererSrc)) reasons.push('renderPng 必须回报 truncated（长图是否被预算截断）')
    const panelSrc = readFileSync(resolve(ROOT, 'src/client/shot/Panel.tsx'), 'utf8')
    const apiSrc = readFileSync(resolve(ROOT, 'src/client/shot/api.ts'), 'utf8')
    if (!/truncated/.test(apiSrc)) reasons.push('RenderResult 必须声明 truncated')
    if (!/truncatedHint/.test(panelSrc)) reasons.push('面板必须消费 truncated 并给出提示（否则截断仍静默）')
    // 提示类名走 styles.ts 的 cls 映射（Panel 里写的是 cls.warn），所以两处都要查。
    const shotStylesSrc = readFileSync(resolve(ROOT, 'src/client/shot/styles.ts'), 'utf8')
    if (!/cls\.warn/.test(panelSrc) || !/tsh-warn/.test(shotStylesSrc)) {
      reasons.push('截断提示必须有对应样式（Panel 用 cls.warn + styles.ts 定义 .tsh-warn）')
    }

    // ⑦-8 本地 HTML 张数被截断要计入 omitted（与消息条数分开计数）。
    if (!/omittedEmbeds/.test(cardSrc)) reasons.push('卡片必须区分「消息被截」与「产物预览未内嵌」两类截断')
    const shotIndexSrc2 = readFileSync(resolve(ROOT, 'src/shot/index.ts'), 'utf8')
    if (!/omittedEmbeds:\s*collected\.omitted/.test(shotIndexSrc2)) {
      reasons.push('collectEmbeds 的丢弃张数必须传给卡片（omittedEmbeds）')
    }
  }

  // ⑧ 主题同步：亮色必须**移除属性**而不是设成 "false"。
  // CSS 选择器 html[data-ds-dark-theme] 只看属性在不在，写 "false" 一样命中，
  // 于是模型写的两套配色在亮色下也会走暗色那套（实测踩过）。
  // cardSrc 必须在用之前读（写在下面会触发 TDZ，脚本直接崩）。
  const cardSrc = readFileSync(resolve(ROOT, 'src/client/html-embed/HtmlCard.tsx'), 'utf8')
  const bridgeSrc = readFileSync(resolve(ROOT, 'src/client/html-embed/bridge.ts'), 'utf8')
  if (!/removeAttribute\("data-ds-dark-theme"\)/.test(bridgeSrc)) {
    reasons.push('亮色主题必须 removeAttribute，不能设成 "false"（属性存在即命中暗色选择器）')
  }
  // 握手：srcDoc 异步解析，宿主挂载时推的那条主题消息会早于 iframe 注册监听而丢失。
  if (!/"ready"/.test(bridgeSrc)) reasons.push('iframe 就绪后必须主动发 ready（否则主题消息会丢）')
  if (!/data\.kind === 'ready'/.test(cardSrc)) reasons.push('宿主必须响应 ready 并回推主题')

  // ⑧b 宽度下发：卡片宽度由宿主决定，模型写页面时看不到，只能靠下发（否则只能猜，
  // 猜小了就是「两侧有点空」——2026-10-15 实测被用户指出）。
  // 三处缺一不可：bridge 落变量、宿主 ready 时补推、ResizeObserver 跟随尺寸变化。
  if (!/--dsh-card-w/.test(bridgeSrc)) reasons.push('bridge 必须把宿主下发的宽度落成 --dsh-card-w')
  if (!/__dshCardWidth/.test(bridgeSrc)) reasons.push('bridge 必须同时暴露 window.__dshCardWidth')
  if (!/data\.kind === "width"/.test(bridgeSrc)) reasons.push('bridge 必须处理宿主下发的 width 消息')
  if (!/kind: 'width'/.test(cardSrc)) reasons.push('宿主必须下发 width 消息')
  if (!/pushWidth\(\)/.test(cardSrc)) reasons.push('宿主必须在 ready 与尺寸变化时补推宽度')
  if (!/ResizeObserver/.test(cardSrc)) reasons.push('宿主必须用 ResizeObserver 跟随卡片宽度变化')

  // ⑨ iframe 的 sandbox 属性：只给 allow-scripts，绝不能带 allow-same-origin。
  const sandboxAttr = /sandbox="([^"]*)"/.exec(cardSrc)?.[1] ?? ''
  if (sandboxAttr === '') {
    reasons.push('HtmlCard 的 iframe 没有 sandbox 属性')
  } else {
    if (!sandboxAttr.includes('allow-scripts')) reasons.push('sandbox 必须给 allow-scripts')
    if (sandboxAttr.includes('allow-same-origin')) {
      reasons.push('sandbox 绝不能带 allow-same-origin（模型产出的 HTML 会拿到宿主 DOM）')
    }
  }
  // ⑩ 高度上报必须做三重校验：来源窗口 / 命名空间 / 数值范围。
  if (!/event\.source !== frameRef\.current\.contentWindow/.test(cardSrc)) {
    reasons.push('高度上报缺少来源窗口校验')
  }
  if (!/data\.source !== BRIDGE_TO_HOST/.test(cardSrc)) reasons.push('高度上报缺少命名空间校验')
  if (!/Math\.min\(MAX_FRAME_HEIGHT/.test(cardSrc)) reasons.push('高度上报缺少范围钳制')

  // ⑪ pending 态的渲染约束：占位内容不能挂 iframe，且切换时不能卸载重挂。
  //
  // 这里断言的是**实现形状**而不是行为：占位必须写成返回 JSX 的普通函数，在
  // 同一个 <figure> 内部条件渲染。写成独立组件（或提前 return）会让 React 在
  // pending 翻转时卸载重建 DOM —— 实测过，卡片会跳一下，且丢掉高度过渡。
  if (!/function pendingStage\(/.test(cardSrc)) {
    reasons.push('占位内容必须写成普通函数 pendingStage（独立组件会导致闭合瞬间重建 DOM）')
  }
  if (/if \(pending\) return/.test(cardSrc)) {
    reasons.push('不得提前 return 占位组件（会卸载重建 <figure>，闭合那一刻卡片会跳）')
  }
  /*
   * 2026-10-19：源码视图已砍（卡片上不再有任何控件），判据随之从
   * `pending ? pendingStage : showSource ? ... : stage` 收成两分支。
   * 钉住的仍然是同一件事：占位与真身是**同一个 <figure> 里的三元**，
   * 不是两个组件、也不是提前 return。
   */
  if (!/\{pending \? pendingStage\(spec\.bytes\) : \(/.test(cardSrc)) {
    reasons.push('占位与真身必须在同一个 <figure> 内条件渲染（保住 DOM 节点 identity）')
  }
  // 卡片上不许再有常驻控件（2026-10-19 用户连续两次要求砍掉）。
  if (/dtt-he__actions|dtt-he__btn/.test(cardSrc)) {
    reasons.push('卡片上不得再有常驻控件（标题栏/动作按钮已按用户要求删除）')
  }
  if (/dtt-he__overlay/.test(cardSrc)) {
    reasons.push('全屏层已删除，不该再出现在组件里')
  }
  // 占位内容里绝不能有 iframe —— 半截 HTML 挂进去只会白屏 + 每个 delta 重载。
  const pendingFn = /function pendingStage[\s\S]*?\n}/.exec(cardSrc)?.[0] ?? ''
  if (pendingFn === '') reasons.push('找不到 pendingStage 实现')
  else if (/<iframe/.test(pendingFn)) reasons.push('pendingStage 不得挂 iframe（半截 HTML 会白屏且反复重载）')
  // 占位样式必须在册（含 reduced-motion 兜底：关掉动效后不能看起来像卡死）。
  const cssSrc = readFileSync(resolve(ROOT, 'src/client/html-embed/styles.ts'), 'utf8')
  for (const cls of ['dtt-he__pending-dot', 'dtt-he__pending-bar', 'dtt-he__stage--pending']) {
    if (!cssSrc.includes(cls)) reasons.push(`缺少占位卡样式 .${cls}`)
  }
  if (!/prefers-reduced-motion[\s\S]{0,400}dtt-he__pending-dot/.test(cssSrc)) {
    reasons.push('占位卡动效必须在 prefers-reduced-motion 下兜底（不能留下「看起来卡死」的等待态）')
  }

  if (reasons.length > 0) {
    fail('对话内 HTML 卡片契约：' + reasons.join('；'))
  } else {
    pass('HTML 卡片：围栏切分精确（大小写/未闭合/空内容各自回退，大围栏照常出卡）+ 标题提取')
    pass('HTML 卡片：流式期未闭合围栏 → 预渲染占位卡（pending 翻转同 key，不闪）')
    pass('HTML 卡片：沙箱只给 allow-scripts + 高度上报三重校验 + base target=_blank')
  }
}

// ── 对话内 iu 原生交互卡片（```iu 围栏 → IuCard）─────────────────────────
//
// 这组断言同样盯「静默失效」：围栏不命中只会显示成代码块；spec 校验写宽了会
// 让半截 JSON 变成空卡片；回写文案生成器坏了，回写链路就是空的。
{
  const reasons = []
  if (typeof mod.splitIu !== 'function' || typeof mod.looksLikeIuFence !== 'function') {
    reasons.push('缺少 splitIu / looksLikeIuFence 导出')
  } else {
    // ① 四种 kind 都必须切出卡片，且关键字段解析正确。
    const slider = mod.splitIu('```iu\n{"kind":"slider","title":"人数","min":1,"max":10,"step":1,"value":4,"unit":"人","outputs":[{"label":"面粉","per":120,"unit":"g"}]}\n```')
    const sCard = slider.find(p => p.kind === 'iu')
    if (sCard === undefined || sCard.pending !== false) {
      reasons.push('slider 围栏未被切出卡片')
    } else if (sCard.spec.kind !== 'slider' || sCard.spec.title !== '人数') {
      reasons.push(`slider spec 解析错误：${JSON.stringify(sCard.spec)}`)
    } else if (sCard.spec.outputs.length !== 1 || sCard.spec.outputs[0].per !== 120) {
      reasons.push('slider outputs 解析错误（per=每单位用量）')
    }
    // chart（柱状/折线/面积）已随图形类一起下线，改由 ```html 手写 SVG 承接。
    // 断言它**不再**被切成卡片：模型若写了 chart 围栏，应当原样回退成代码块。
    const chart = mod.splitIu('```iu\n{"kind":"chart","chart":"line","title":"趋势","labels":["A","B"],"series":[{"name":"S","values":[1,2]}]}\n```')
    if (chart.some(p => p.kind === 'iu')) {
      reasons.push('chart kind 已下线，不该再被切成卡片（应回退成代码块）')
    }
    const check = mod.splitIu('```iu\n{"kind":"checklist","title":"清单","items":[{"label":"甲","desc":"说明"}]}\n```')
    const kCard = check.find(p => p.kind === 'iu')
    if (kCard === undefined || kCard.spec.kind !== 'checklist' || kCard.spec.items.length !== 1) {
      reasons.push('checklist 围栏未被切出卡片')
    }
    const tabs = mod.splitIu('```iu\n{"kind":"tabs","title":"对比","tabs":[{"label":"A","heading":"H","body":"B"}]}\n```')
    const tCard = tabs.find(p => p.kind === 'iu')
    if (tCard === undefined || tCard.spec.kind !== 'tabs' || tCard.spec.tabs.length !== 1) {
      reasons.push('tabs 围栏未被切出卡片')
    }
    // piano：默认值与钳制都要对（八度越界、未知音色都该被收敛，而不是渲染崩掉）。
    const piano = mod.splitIu('```iu\n{"kind":"piano","title":"小星星","octave":4,"octaves":1,"wave":"triangle"}\n```')
    const pCard = piano.find(p => p.kind === 'iu')
    if (pCard === undefined || pCard.spec.kind !== 'piano') {
      reasons.push('piano 围栏未被切出卡片')
    } else {
      if (pCard.spec.octave !== 4 || pCard.spec.octaves !== 1) reasons.push('piano 的 octave/octaves 解析错误')
      if (pCard.spec.wave !== 'triangle') reasons.push('piano 的 wave 解析错误')
      if (pCard.spec.showNotes !== true) reasons.push('piano 的 showNotes 默认应为 true')
      const bare = mod.splitIu('```iu\n{"kind":"piano"}\n```').find(p => p.kind === 'iu')
      if (bare === undefined) reasons.push('piano 允许只给 kind（其余走默认）')
      else if (bare.spec.octave !== 4 || bare.spec.octaves !== 1 || bare.spec.wave !== 'sine') {
        reasons.push(`piano 默认值错误：${JSON.stringify(bare.spec)}`)
      }
      // 越界与未知值必须被收敛（八度钳到 0–7、octaves 钳到 1–3、未知音色回落 sine）。
      const wild = mod.splitIu('```iu\n{"kind":"piano","octave":99,"octaves":9,"wave":"nope"}\n```').find(p => p.kind === 'iu')
      if (wild === undefined) reasons.push('piano 越界值不该导致整卡回退')
      else if (wild.spec.octave !== 7 || wild.spec.octaves !== 3 || wild.spec.wave !== 'sine') {
        reasons.push(`piano 越界值未被钳制：${JSON.stringify(wild.spec)}`)
      }
    }

    // ② 非法 / 空 / 未知 kind / 超长 → 一律回退原文，绝不产空卡片。
    for (const [label, text] of [
      ['非法 JSON', '```iu\n{不是 JSON\n```'],
      ['空内容', '```iu\n\n```'],
      ['未知 kind', '```iu\n{"kind":"nope"}\n```'],
      ['缺 items 的清单', '```iu\n{"kind":"checklist","title":"x"}\n```'],
      ['超长', '```iu\n{"kind":"checklist","title":"' + 'x'.repeat(21000) + '"}\n```'],
    ]) {
      if (mod.splitIu(text).some(p => p.kind === 'iu')) reasons.push(`${label} 应回退成代码块`)
    }

    // ③ 语言标记精确匹配：iu-preview / ius 不得被吞；IU 大写要认。
    for (const lang of ['iu-preview', 'ius']) {
      if (mod.splitIu('```' + lang + '\n{"kind":"checklist","items":[{"label":"a"}]}\n```').some(p => p.kind === 'iu')) {
        reasons.push('```' + lang + ' 不该被识别成 iu 卡片')
      }
    }
    if (!mod.splitIu('```IU\n{"kind":"checklist","items":[{"label":"a"}]}\n```').some(p => p.kind === 'iu')) {
      reasons.push('```IU 大写标记应被识别')
    }
    if (mod.looksLikeIuFence('这是一张 iu 卡片')) reasons.push('looksLikeIuFence 不能只看 iu 字样')

    // ④ 流式期未闭合围栏 → pending 占位；定稿态未闭合 → 回退代码块。
    const live = mod.splitIu('前文\n```iu\n{"kind":"slider","tit', true)
    const ph = live.find(p => p.kind === 'iu')
    if (ph === undefined) reasons.push('流式期未闭合的 ```iu 必须产出占位卡')
    else {
      if (ph.pending !== true) reasons.push('流式期未闭合围栏必须标记 pending=true')
      if (!(ph.bytes > 0)) reasons.push('占位卡必须带已写出的字节数')
    }
    if (mod.splitIu('```iu\n{"kind":"slider","tit', false).some(p => p.kind === 'iu')) {
      reasons.push('非流式期的未闭合围栏必须回退成代码块（不能永远停在等待态）')
    }
    if (mod.splitIu('```js\nconst a = 1', true).some(p => p.kind === 'iu')) {
      reasons.push('只有 ```iu 才走占位卡，其它语言的半截围栏不得被吞')
    }

    // ⑤ 混排多卡（A）：一段正文里多张 iu 卡片都要切出来，且 md 片段原样保留。
    const multi = mod.splitIu('开头\n```iu\n{"kind":"checklist","items":[{"label":"a"}]}\n```\n中间\n```iu\n{"kind":"tabs","tabs":[{"label":"A","body":"B"}]}\n```\n结尾')
    const cards = multi.filter(p => p.kind === 'iu')
    if (cards.length !== 2) reasons.push(`一段正文里的多张 iu 卡片都要切出，实得 ${cards.length}`)
    if (!multi.some(p => p.kind === 'md' && p.text.includes('中间'))) {
      reasons.push('卡片之间的 markdown 正文必须原样保留（混排）')
    }
  }

  // ⑥ 回写文案生成器（纯函数）：状态必须真的进入文案，否则回写出去的是个空壳。
  if (typeof mod.sliderFillText !== 'function' || typeof mod.checklistFillText !== 'function') {
    reasons.push('缺少 sliderFillText / checklistFillText 导出（回写文案不可断言）')
  } else {
    const spec = { kind: 'slider', title: '人数', min: 1, max: 10, step: 1, value: 4, unit: '人', desc: '', outputs: [{ label: '面粉', per: 120, unit: 'g' }] }
    const text = mod.sliderFillText(spec, 6)
    if (!text.includes('6') || !text.includes('720')) reasons.push(`滑块回写文案必须含当前值与换算，实得 ${text}`)
    const cl = mod.checklistFillText({ kind: 'checklist', title: '清单', items: [{ label: '甲', desc: '' }, { label: '乙', desc: '' }] }, new Set([0]))
    if (!cl.includes('甲') || cl.includes('乙')) reasons.push(`清单回写文案必须只含已勾选项，实得 ${cl}`)
    const empty = mod.checklistFillText({ kind: 'checklist', title: '清单', items: [{ label: '甲', desc: '' }] }, new Set())
    if (!empty.includes('还没勾选')) reasons.push('未勾选时必须给出可读文案，不能是空串')
  }

  // ⑦ 沙箱回写桥（C）：bridge 里必须有 __dshFill，宿主侧必须校验来源与长度。
  const bridgeSrcIu = readFileSync(resolve(ROOT, 'src/client/html-embed/bridge.ts'), 'utf8')
  if (!/__dshFill/.test(bridgeSrcIu)) reasons.push('iframe bridge 必须暴露 window.__dshFill（沙箱卡片回写入口）')
  if (!/kind: "fill"/.test(bridgeSrcIu)) reasons.push('bridge 必须以 fill 消息类型上报回写')
  const cardSrcIu = readFileSync(resolve(ROOT, 'src/client/html-embed/HtmlCard.tsx'), 'utf8')
  if (!/data\.kind === 'fill'/.test(cardSrcIu)) reasons.push('宿主必须处理 fill 消息')
  if (!/slice\(0, 2000\)/.test(cardSrcIu)) reasons.push('回写文本必须钳长度（防模型页面推超长内容进草稿）')
  if (!/event\.source !== frameRef\.current\.contentWindow/.test(cardSrcIu)) reasons.push('fill 回写必须做来源窗口校验')
  // 原生卡片的回写必须走官方 inputActions.setDraft，而不是自己碰 DOM。
  const thinkSrcIu = readFileSync(resolve(ROOT, 'src/client/thinking/ThinkingStepNodeView.tsx'), 'utf8')
  if (!/inputActions/.test(thinkSrcIu) || !/setDraft/.test(thinkSrcIu)) {
    reasons.push('iu 回写必须走官方 inputActions.setDraft（唯一公开写入路径）')
  }
  if (!/splitIu/.test(thinkSrcIu)) reasons.push('正文渲染链路必须接上 splitIu（否则 iu 围栏不渲染）')

  // ⑨ 钢琴发声的三条硬约束（都是「不写就坏、但不报错」的那类）。
  //
  // ① AudioContext 必须**懒创建**：浏览器要求首次发声在用户手势里，提前 new
  //    会得到 suspended 的 context，之后弹琴全程无声——不报错，只是没声音。
  // ② 松手不能硬切波形：直接 stop() 会「啪」一声爆音，必须指数衰减到极小值。
  // ③ 每个音要有自己的振荡器：共用全局节点的话多指同按会互相掐断。
  //
  // 架构升级后发声逻辑在 kinds/piano.body.tsx（React 体半边），不再在 IuCard.tsx。
  const iuCardSrc = readFileSync(resolve(ROOT, 'src/client/iu/kinds/piano.body.tsx'), 'utf8')
  if (!/AudioContext/.test(iuCardSrc)) {
    reasons.push('钢琴必须用 Web Audio 发声（沙箱不能引外部音频资源）')
  }
  if (/new\s+\(?window\.AudioContext/.test(iuCardSrc) && !/ensureCtx/.test(iuCardSrc)) {
    reasons.push('AudioContext 必须懒创建（构造期 new 会拿到 suspended context → 全程无声）')
  }
  if (!/ensureCtx/.test(iuCardSrc) || !/state === 'suspended'/.test(iuCardSrc)) {
    reasons.push('AudioContext 必须懒创建并在 suspended 时 resume')
  }
  if (!/exponentialRampToValueAtTime/.test(iuCardSrc)) {
    reasons.push('发声包络必须指数衰减（直接 stop() 会爆音）')
  }
  if (!/voicesRef/.test(iuCardSrc) || !/Map</.test(iuCardSrc)) {
    reasons.push('每个音必须持有自己的振荡器（共用全局节点会让多指同按互相掐断）')
  }
  // 电脑键盘映射必须用 event.code：key 受输入法影响（中文下可能是 Process）。
  if (!/event\.code|e\.code/.test(iuCardSrc)) {
    reasons.push('电脑键盘演奏必须读 event.code（event.key 受输入法影响）')
  }
  // 键盘接管必须有闸门，否则会抢走对话输入框的按键。
  if (!/hoverRef/.test(iuCardSrc)) {
    reasons.push('键盘演奏必须有悬停闸门（否则抢走输入框按键）')
  }
  // 琴键的按下反馈不能在 reduced-motion 下被抹掉（那是反馈不是装饰）。
  // ⚠ 判据用到 iuCss，那段声明在本块**后面**，所以这条放在 ⑧ 之后检查。
  // 回写文案生成器必须可断言。
  if (typeof mod.pianoFillText !== 'function') {
    reasons.push('缺少 pianoFillText 导出（钢琴回写文案不可断言）')
  } else {
    const pSpec = { kind: 'piano', title: '小星星', desc: '', octave: 4, octaves: 1, wave: 'sine', showNotes: true }
    const empty = mod.pianoFillText(pSpec, [])
    if (!empty.includes('还没弹')) reasons.push('未弹奏时必须给出可读文案，不能是空串')
    const text = mod.pianoFillText(pSpec, ['C4', 'C4', 'G4', 'G4', 'A4'])
    if (!text.includes('C4') || !text.includes('G4')) reasons.push(`钢琴回写必须含音名，实得 ${text}`)
    if (!text.includes('简谱')) reasons.push('钢琴回写必须附简谱（用户要能直接拿去用）')
    if (!text.includes('1 1 5 5 6')) reasons.push(`简谱换算错误，实得 ${text}`)
  }

  // ⑨ `/iu` 斜杠指令（用户显式要求出卡）。
  //
  // 最终形态是**什么都不做**：源只提供菜单候选，matchEnter 恒返回 undefined，
  // 让输入机走默认发送把原文（含 `/iu`）发出去。这条链路反过来踩过两次坑：
  //  · 返回 `{ text }` → 消息被静默丢弃（输入机只认 claim/undefined）；
  //  · 自己调 conversation.send() → 前缀被剥、输入框不清空。
  // 断言因此分三层：前缀判定、源已注册、**matchEnter 真的不拦**。
  {
    const t = mod.iuSlashTest
    if (t === undefined) {
      reasons.push('缺少 iuSlashTest 导出（/iu 判定逻辑不可断言）')
    } else {
      if (t.command !== 'iu') reasons.push(`/iu 指令名应为 iu，实得 ${t.command}`)
      // 前缀判定：带空格 / 不带空格 / 带冒号 都要认；非 /iu 行一律不碰。
      const cases = [
        ['/iu 做个钢琴', true],
        ['/iu做个钢琴', true],
        ['/iu: 三个方案对比', true],
        ['  /iu   烤肉份量  ', true],
        ['/iu', true],
        ['/iux 别的命令', false],
        ['/skills', false],
        ['普通聊天', false],
      ]
      for (const [line, want] of cases) {
        const got = t.hasPrefix(line)
        if (got !== want) reasons.push(`hasPrefix(${JSON.stringify(line)}) 期望 ${want}，实得 ${got}`)
      }
      // 取内容只服务菜单提示；词边界必须正确（否则 /iux 会被误吞）。
      const stripCases = [
        ['/iu 做个钢琴', '做个钢琴'],
        ['/iu做个钢琴', '做个钢琴'],
        ['/iu', ''],
        ['/iux 别的命令', null],
        ['普通聊天', null],
      ]
      for (const [line, want] of stripCases) {
        const got = t.strip(line)
        if (got !== want) reasons.push(`strip(${JSON.stringify(line)}) 期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`)
      }
    }
    // 源必须**真的注册**到 inputTriggers：只写 applyIuSlash 不注册的话，
    // 菜单里永远没有 /iu，而 catch 只 warn —— 静默失效。
    const iuSrc = registeredTriggerSources.find(s => s?.name === 'iu')
    if (iuSrc === undefined) {
      reasons.push('/iu 源未注册到 inputTriggers（菜单里不会有这一组）')
    } else if (iuSrc.trigger !== '/') {
      reasons.push(`/iu 源的 trigger 应为 /，实得 ${iuSrc.trigger}`)
    } else if (iuSrc.order !== 1) {
      // 技能源现在会按 query 直接匹配技能名，`/iu` 能子序列命中一串技能；
      // 本源必须排在技能源之前，才能让提示项占住菜单高亮。
      reasons.push(`/iu 源 order 应为 1（排在技能源之前，否则 /iu 的高亮会被技能抢走），实得 ${iuSrc.order}`)
    }
    /*
     * 源码形状：**不得**再出现自建投递与包装。
     *
     * 这两样都修过 bug 才删掉，留着就会被重新启用：
     *  · conversation.send / sessions.scope → 绕过输入机，前缀被剥 + 草稿不清空；
     *  · matchEnter 里的 `{ text }` outcome → 输入机丢弃，消息发不出去。
     *
     * ⚠ 两条匹配纪律（都实测踩中过）：
     *  1. 必须**先剥注释**：本文件的说明注释里就写着这两个名字，全文正则会
     *     把注释也算成违规；
     *  2. `{ text }` 只能查 **matchEnter 体内**：`onPick()` 返回
     *     `{ text: '/iu ' }` 是**合法且必要**的（选中菜单项＝把前缀留在草稿里），
     *     全文查会误杀好人。两者语义完全不同：onPick 是用户主动选菜单，
     *     matchEnter 是抢回车键。
     */
    const slashSrc = readFileSync(resolve(ROOT, 'src/client/iu/slash.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (/conversation\.send|sessions\.scope/.test(slashSrc)) {
      reasons.push('/iu 不得自建投递（绕过输入机会导致前缀被剥 + 输入框不清空）')
    }
    if (/IU_PREFIX\s*=\s*['"`][^'"`]/.test(slashSrc)) {
      reasons.push('/iu 不得再拼包装前缀（用户要求原话原样发送）')
    }
    // 只取 matchEnter 的函数体（从 `matchEnter` 到下一个顶层 `},` 或 `}`）。
    const enterBody = /matchEnter\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{4}\}/.exec(slashSrc)?.[1]
    if (enterBody === undefined) {
      reasons.push('无法定位 /iu 的 matchEnter 函数体（冒烟断言失效，请检查写法）')
    } else {
      if (/return \{[^}]*text:/.test(enterBody) || /return \{\s*text:/.test(enterBody)) {
        reasons.push('/iu 的 matchEnter 不得返回 { text } outcome（输入机只认 claim/undefined，会静默吞掉消息）')
      }
      if (!/return undefined/.test(enterBody)) {
        reasons.push('/iu 的 matchEnter 必须显式 `return undefined`（声明不拦，走默认发送）')
      }
    }

    /*
     * 运行时验证：真的调一次 matchEnter，确认它**什么都不做**。
     *
     * 这是行为级回归钉子 —— 光断言源码形状挡不住「形状对但逻辑错」。
     * 判据有三条：返回 undefined、不投递、不改草稿。
     */
    const liveSrc = registeredTriggerSources.find(s => s?.name === 'iu')?.source
    if (liveSrc === undefined || typeof liveSrc.matchEnter !== 'function') {
      reasons.push('/iu 源缺 matchEnter（无法显式声明不拦）')
    } else {
      for (const line of ['/iu 做个钢琴', '普通聊天', '/iu']) {
        const before = sentPrompts.length
        const outcome = await liveSrc.matchEnter({ sessionId: 'smoke-iu' }, line, new AbortController().signal, { attachments: 0 })
        if (outcome !== undefined) {
          reasons.push(`/iu 对 ${JSON.stringify(line)} 必须返回 undefined（不认领，交给默认发送），实得 ${JSON.stringify(outcome)}`)
        }
        if (sentPrompts.length !== before) {
          reasons.push(`/iu 不得自己投递（${JSON.stringify(line)} 触发了投递）`)
        }
      }
    }

    /*
     * 技能源不得在**无关 query** 下留**集合行**（技能直达行是合法的，见下）。
     *
     * 真事：技能 slash 源第一级里「散装技能」那一行原来是无条件 push 的，
     * 于是任何 `/xxx`（比如中文输入法下不敲空格的 `/iu象棋`）都会在菜单里留
     * 一行且默认高亮。菜单开着时回车被菜单吃掉（arbitrate 的 enter 分支有高亮
     * 就 pick），草稿被替换成 `/_loose:` —— 消息发不出去，输入框里还多一坨
     * 看不懂的东西。用户报的「发不出去」有一半是这个，跟 /iu 本身无关。
     *
     * ⚠ 2026-10 之后判据变了：首层新增「按 query 直接匹配技能名」，
     * `/iu` 这类 query 命中真实技能（如 `dsh-plugin-ui-slots`）是**预期行为**，
     * 不再是 bug。会被 `continue: true` 改写草稿的只有集合行，所以只钉集合行：
     * 无关 query 下 candidates 里不得出现 `bundle:`/集合名字的候选。
     */
    const skillSrc = registeredTriggerSources.find(s => s?.name === 'skill')?.source
    if (skillSrc === undefined) {
      reasons.push('技能 slash 源未注册（/ 菜单里不会有技能与集合）')
    } else if (typeof skillSrc.candidates !== 'function') {
      reasons.push('技能源缺 candidates')
    } else {
      const okSkill = await skillSrc.candidates(
        { sessionId: 'smoke-iu' },
        { query: 'iu', position: 'leading', drilled: false, signal: new AbortController().signal },
      ).catch(() => undefined)
      // 依赖网络（技能快照）：拿不到就退化成源码形状断言，不误报「契约坏了」。
      if (Array.isArray(okSkill)) {
        const bundleRows = okSkill.filter(row => typeof row?.value === 'string' && row.value.startsWith('bundle:'))
        if (bundleRows.length > 0) {
          reasons.push(`技能源在无关 query「iu」下仍给了 ${bundleRows.length} 行集合（回车会被改写草稿，消息发不出去）`)
        }
      }
    }
    // 源码形状兜底：散装技能那一行必须带着 query 前缀判断，不能裸 push。
    const skillSrcText = readFileSync(resolve(ROOT, 'src/client/triad/skill-source/index.ts'), 'utf8')
    if (/if \(looseEnabled\.length > 0\) \{\s*\n\s*bundles\.push/.test(skillSrcText)) {
      reasons.push('技能源的散装技能行不得无条件入列（会让无关 /xxx 也被菜单吃掉回车）')
    }
    if (!/looseName\.startsWith\(req\.query\)/.test(skillSrcText)) {
      reasons.push('技能源的散装技能行必须和集合走同一套 query 前缀过滤')
    }
    /*
     * 技能直达（2026-10 用户报「选技能必须先输技能包」的修复）的形状钉子：
     *  · 必须真的调用共享 rankByName（自己写一套排序就是第二套真相）；
     *  · 空 query 不得铺技能行（会把集合与指令挤出首屏）；
     *  · 技能行必须带 section（菜单靠「与上一行不同」渲染分段标题）。
     */
    if (!/rankByName\(/.test(skillSrcText)) {
      reasons.push('技能源必须用内核共享的 rankByName 排技能直达行')
    }
    if (!/if \(needle === ''\) return \[\]/.test(skillSrcText)) {
      reasons.push('技能直达行在空 query 下必须为空（裸 / 首屏只列集合与指令）')
    }
    // 中文别名：技能名几乎全是英文，Q 里打中文必须能命中（否则菜单直接空）。
    const aliasSrcText = readFileSync(resolve(ROOT, 'src/client/triad/skill-source/aliases.ts'), 'utf8')
    if (!/SKILL_ALIASES/.test(aliasSrcText) || !/matchesAlias/.test(aliasSrcText)) {
      reasons.push('技能别名表必须导出 SKILL_ALIASES 与 matchesAlias')
    }
    if (!/matchesAlias\(skill\.name, needle\)/.test(skillSrcText)) {
      reasons.push('技能直达行必须把别名命中作为最高优先档（中文 query 才搜得到）')
    }
    /*
     * 别名表的形态钉子（**不**校验键是否等于已安装技能名）。
     *
     * 曾经想钉「每条别名都必须对应一个已安装技能」，但那会让冒烟跟着用户的
     * 技能增删漂移：卸载 lark 包 → 25 条键全部"对不上" → 冒烟变红，可代码
     * 一点没坏。别名表本来就是**允许有富余**的数据库（技能没装只是暂时用不上）。
     * 真正会静默失效的是形状写错（漏逗号、空数组、非 kebab-case 键），钉这些。
     */
    const aliasEntries = [...aliasSrcText.matchAll(/^\s*'([^']+)':\s*\[([^\]]*)\]/gm)]
    if (aliasEntries.length === 0) {
      reasons.push('技能别名表一条都没解析出来（格式写坏了？）')
    }
    for (const [, key, rawValues] of aliasEntries) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
        reasons.push(`技能别名表的键必须是技能规范名（kebab-case）：${key}`)
      }
      const values = rawValues.split(',').map(v => v.trim()).filter(v => v !== '')
      if (values.length === 0) {
        reasons.push(`技能别名表「${key}」是空数组（等于没配）`)
      }
      for (const value of values) {
        if (!/^'[^']+'$/.test(value)) {
          reasons.push(`技能别名表「${key}」的别名必须用单引号包起来：${value}`)
        }
      }
    }
    if (!/section: t\('menu\.skill'\)/.test(skillSrcText)) {
      reasons.push('技能直达行必须带 section 分段标题（menu.skill）')
    }

    /*
     * 技能引用着色（用户 2026-10-19 反馈「/ 指令发出去之后没有颜色了」）。
     *
     * 根因：内核 ui-skill 整块禁用后，它的 UserText 匹配规则 + skill chip
     * 座位一起被带走，发出的 /name 退化成纯文本。修复补在 reference.tsx。
     *
     * 五条钉子（少一条就悄悄退化成没颜色）：
     *  1. 着色模块真的被调用（不是只写了个文件）；
     *  2. 规则 id/order 与内核同值，且真的注册进 userText；
     *  3. uiConversation 走 ctx.inject 延迟注入 —— 直接 ctx.get 会拿到
     *     undefined（实测踩过，只留一行 warn，颜色静默消失）；
     *  4. chip 传给 ReferenceChip 的 invalid 必须有值（必填 props）；
     *  5. 匹配正则保留前后词边界（http://a/b、/iu做个钢琴 不得误伤）。
     */
    const refText = readFileSync(resolve(ROOT, 'src/client/triad/skill-source/reference.tsx'), 'utf8')
    // 源码里可能把注释也算进去，断言只看「去掉注释后还在不在」。
    const refCode = refText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (!skillSrcText.includes('applySkillReference(ctx)')) {
      reasons.push('技能源必须调用 applySkillReference（否则发出的 /name 没有颜色）')
    }
    if (!refCode.includes("id: 'skill'") || !refCode.includes('order: 20')) {
      reasons.push('技能引用规则必须注册 id=skill、order=20（与内核 ui-skill 同值）')
    }
    if (!refCode.includes('userText.register')) {
      reasons.push('技能引用规则必须真的注册进 uiConversation.userText')
    }
    if (!refCode.includes('inject(REFERENCE_SERVICES')) {
      reasons.push('uiConversation 必须走 ctx.inject 延迟注入（ctx.get 会拿到 undefined）')
    }
    if (!refCode.includes('invalid={false}')) {
      reasons.push('技能 chip 必须给 ReferenceChip 传 invalid（必填 props，漏了会丢无效态样式）')
    }
    if (!refCode.includes('(?<!\\S)') || !refCode.includes('(?!\\S)')) {
      reasons.push('技能引用正则必须保留前后词边界（否则 URL 里的斜杠会被误认）')
    }
    if (!refCode.includes("'conversation.user.text.node'")) {
      reasons.push('技能 chip 座位必须注册到 conversation.user.text.node')
    }
  }

  // ⑩ 图表可见性绝不依赖动画（实测踩中两次，无头截图 / 全局节流下图表变空卡）。
  //
  // 本插件的全局节流会在页面不可见时把 animation-play-state 置为 paused；无头
  // 截图与打印则直接抓第一帧。任何把「看得见」交给动画的写法在这三种场景下都会
  // 让柱子/折线消失，只剩网格线与数字——不报错，只是看起来像坏掉的空卡。
  //
  // 架构升级后 CSS 随 kind 走：琴键反馈查 kinds/piano.ts、基座兜底查 styles.ts——
  // 各查各的，谁的纪律谁自己钉。（图表那组断言随 chart kind 下线一并移除。）
  //
  // 但「可见性不依赖动画」这条纪律**不随 kind 消失**：它现在是 html 卡片的约束。
  // 断言 html 卡片文档里没有任何把可见性交给动画的写法（模型自己写的页面归它自己，
  // 这里钉的是宿主注入的兜底样式）。
  const htmlBridgeSrc = readFileSync(resolve(ROOT, 'src/client/html-embed/bridge.ts'), 'utf8')
  if (/BASE_STYLE[\s\S]{0,600}opacity:\s*0/.test(htmlBridgeSrc)) {
    reasons.push('html 卡片兜底样式不得含 opacity:0（首帧/暂停时内容会不可见）')
  }

  // 琴键的按下反馈不能在 reduced-motion 下被抹掉（下沉与高亮是**反馈**，
  // 不是装饰；关掉它按下去就没反应了——与等待态不能动到 0 反馈同一个道理）。
  const pianoCss = readFileSync(resolve(ROOT, 'src/client/iu/kinds/piano.ts'), 'utf8')
  if (/prefers-reduced-motion[\s\S]{0,1200}dtt-iu__pkey\[data-on="1"\][^}]*transform:\s*none/.test(pianoCss)) {
    reasons.push('reduced-motion 下不得抹掉琴键下沉反馈（只该关动画）')
  }
  if (!/prefers-reduced-motion[\s\S]{0,1200}dtt-iu__pkey/.test(pianoCss)) {
    reasons.push('钢琴必须在 prefers-reduced-motion 下兜底（关动画、留反馈）')
  }

  /*
   * kind 的 label 必须**单点定义**在 kind 模块里。
   *
   * 真事：截图管线那边原是一串三元表达式（… : '对比'），加了 piano 之后
   * 新 kind 掉进兜底分支，于是**同一张钢琴卡在对话里标「钢琴」、在截图里标
   * 「对比」**。用户看不出是漏改，只觉得「截图和实际不一样」。
   *
   * 那枚角标后来被整块移除（卡头只留标题 + 动作），但 label 仍是 kind 的对外
   * 契约字段（注入文档、IU_KIND_LABELS 都读它），所以断言保留「每个 kind 都得
   * 有 label」，并新增一条：卡头与截图外壳都不得再画 .dtt-iu__tag。
   */
  const kindDir = resolve(ROOT, 'src/client/iu/kinds')
  const kindModules = readdirSync(kindDir).filter(f => /^[a-z]+\.ts$/.test(f) && !['core.ts', 'contract.ts', 'registry.ts', 'types.ts', 'bodies.ts'].includes(f))
  for (const f of kindModules) {
    const src = readFileSync(resolve(kindDir, f), 'utf8')
    if (!/\blabel:\s*'[^']+'/.test(src)) {
      reasons.push(`${f} 缺 label 角标文案（对话流与截图会没有类型标签）`)
    }
  }
  const iuCardSrcForTag = readFileSync(resolve(ROOT, 'src/client/iu/IuCard.tsx'), 'utf8')
  if (/dtt-iu__tag/.test(iuCardSrcForTag)) {
    reasons.push('卡头不得再渲染类型角标 .dtt-iu__tag（该角标已取消）')
  }
  if (/tag="(滑块|图表|清单|对比|钢琴|数据表|看板|表单|时间线|结构|仪表|自测)"/.test(iuCardSrcForTag)) {
    reasons.push('IuCard 不得写死 kind 的中文字面量（label 单点在 kind 模块里）')
  }
  const shotCardSrc = readFileSync(resolve(ROOT, 'src/shot/card.ts'), 'utf8')
  if (/dtt-iu__tag|fence\.tag/.test(shotCardSrc)) {
    reasons.push('截图管线不得再渲染类型角标（该角标已取消）')
  }
  if (/kind === 'slider' \? '[^']*' : spec\.kind === 'chart'/.test(shotCardSrc)) {
    reasons.push('截图管线不得用 kind 三元链取任何展示文案（新增 kind 会静默掉进兜底）')
  }

  /*
   * 钢琴的两层容器（pwhite / pblack）在**截图快照**里也必须在。
   *
   * 真事：截图那边原先把白键黑键平铺进 `.dtt-iu__piano` 就完事，省掉了两层
   * 容器。而 IU_CSS 是照着真实组件写的：白键靠 `pwhite{display:flex}` 等分、
   * 黑键靠 `pblack{position:absolute}` 叠上去。少一层，白键的 left/width
   * 百分比全落回静态流 —— 截图里的琴键变成**一级级往下掉的阶梯**，对话流里
   * 却是正常键盘。共用样式表就必须共用 DOM 结构，只共用一半等于没共用。
   *
   * 架构升级后快照在 kinds/piano.ts（snapshot 字段），断言对象随之迁移。
   */
  const pianoSnapshotSrc = readFileSync(resolve(ROOT, 'src/client/iu/kinds/piano.ts'), 'utf8')
  for (const [needle, why] of [
    ['dtt-iu__pwhite', '白键层容器'],
    ['dtt-iu__pblack', '黑键层容器'],
  ]) {
    if (!pianoSnapshotSrc.includes(needle)) {
      reasons.push('piano.ts 的截图快照缺' + why + '（' + needle + '）——白键会退化成阶梯状')
    }
  }
  // 白键不得再自带 left/width 内联百分比（那是黑键层的活；带上就是重复定位）。
  if (/dtt-iu__pwhite"?>?\$\{white\}[\s\S]{0,200}left:\$\{/.test(pianoSnapshotSrc)) {
    reasons.push('piano.ts 快照的白键不得带 left 内联定位（白键靠 flex 等分，只有黑键才绝对定位）')
  }

  // ⑩ form 卡的提交链路：填完必须真的有出口。
  //
  // 这条断言的来由是一次真实的**文档说谎**：form 的注入文档（kinds/form.ts 的
  // doc 字段，直接进模型上下文）写着「卡内自带 submitLabel 提交按钮」，而外壳
  // 的 FillRow 在重构中被整块删掉、Body 里 onFill 出现 0 次 —— 模型照着文档
  // 造表单，用户填完发现没有提交按钮。功能空洞不会报错，只能靠断言钉住。
  {
    const formBodySrc = readFileSync(resolve(ROOT, 'src/client/iu/kinds/form.body.tsx'), 'utf8')
    if (!/onFill/.test(formBodySrc)) reasons.push('form Body 必须消费 onFill（否则提交按钮无处可去）')
    if (!/fillText/.test(formBodySrc)) reasons.push('form 提交必须复用 form.ts 的 fillText（不要在 Body 里重算文案）')
    if (!/submitLabel/.test(formBodySrc)) reasons.push('提交按钮文案必须取 spec.submitLabel（文档对模型承诺的就是这个字段）')
    const formSrc = readFileSync(resolve(ROOT, 'src/client/iu/kinds/form.ts'), 'utf8')
    if (!/export function fillText/.test(formSrc)) reasons.push('form.ts 的 fillText 必须导出（Body 要直接调它）')
    // 注入文档不得再承诺已不存在的能力，也不得漏掉新增的必填校验行为。
    const docLine = /doc:\s*'([^']|\\')*'/.exec(formSrc)
    if (docLine === null) reasons.push('form 的注入文档（doc）不见了')
    else {
      const docText = docLine[0]
      if (!/submitLabel/.test(docText)) reasons.push('form 注入文档必须提到 submitLabel')
      if (!/填入用户输入框|拼成文本/.test(docText)) reasons.push('form 注入文档必须说清提交产出的是什么')
    }
    // 截图快照必须含提交行，否则同一张卡在对话流与截图里长得不一样。
    if (!/dtt-iu__form-submit/.test(formSrc)) reasons.push('form 的 snapshot 必须包含提交行（否则截图缺按钮）')
  }

  if (reasons.length > 0) {
    fail('对话内 iu 卡片契约：' + reasons.join('；'))
  } else {
    pass('iu 卡片：五种 kind 切分 + 非法/空/未知/超长各自回退 + 标记精确匹配')
    pass('iu 卡片：流式占位（pending）与定稿回退语义正确 + 混排多卡')
    pass('iu 卡片：回写文案含状态 + 沙箱 __dshFill 桥 + inputActions.setDraft 回写')
    pass('iu 卡片：图表可见性不依赖动画（无头截图 / 全局节流下不会变空卡）')
    pass('iu 卡片：钢琴 Web Audio 懒创建 + 指数包络 + 独立振荡器 + 悬停闸门')
    pass('iu 卡片：/iu 前缀式指令（不拦不改写、原文含前缀照发、源已注册 + 行为级验证）')
    pass('iu 卡片：form 提交链路闭合（onFill + fillText + submitLabel + 截图快照对齐）')
  }
}

// ── iu 快照转义探针（运行期，不是看源码） ────────────────────────────────
//
// 各 kind 的 snapshot() 都是手写字符串拼 HTML，而截图页跑在
// --disable-web-security 的无头 Chrome 里 —— 一处漏 esc() 就等于任意脚本。
//
// 静态检查「源码里有没有写 esc」只能靠人眼，加一个 kind 就重新赌一次。
// 这里改成运行期探针：把带引号/尖括号的样本塞进**每个** kind 的模型文本字段，
// 跑一遍 snapshot()，断言输出里没有真的标签漏出来。漏了就是红。
{
  const reasons = []
  if (typeof mod.IU_KIND_MAP !== 'object' || mod.IU_KIND_MAP === null) {
    reasons.push('缺少 IU_KIND_MAP 导出（快照转义不可断言）')
  } else {
    // 危险样本：能闭合属性 / 开标签的字符都在里面。
    const EVIL = 'x"><img src=x onerror=alert(1)><script>alert(2)</script>'
    for (const [kind, k] of mod.IU_KIND_MAP) {
      const samples = {
        slider: { kind: 'slider', title: EVIL, desc: EVIL, unit: EVIL, outputs: [{ label: EVIL, per: 1, unit: EVIL }] },
        checklist: { kind: 'checklist', title: EVIL, items: [{ label: EVIL, desc: EVIL }] },
        tabs: { kind: 'tabs', title: EVIL, tabs: [{ label: EVIL, heading: EVIL, body: EVIL }] },
        piano: { kind: 'piano', title: EVIL, desc: EVIL },
        table: { kind: 'table', title: EVIL, columns: [{ key: 'a', label: EVIL }], rows: [[EVIL]] },
        kanban: { kind: 'kanban', title: EVIL, columns: [{ id: 'c1', label: EVIL, cards: [{ id: 'k1', text: EVIL, desc: EVIL, tag: EVIL }] }] },
        form: { kind: 'form', title: EVIL, desc: EVIL, submitLabel: EVIL, fields: [{ id: 'f1', label: EVIL, type: 'text', placeholder: EVIL }] },
        diff: { kind: 'diff', title: EVIL, before: EVIL, after: EVIL, lang: EVIL },
        timeline: { kind: 'timeline', title: EVIL, items: [{ label: EVIL, date: EVIL, body: EVIL }] },
        tree: { kind: 'tree', title: EVIL, root: { label: EVIL, children: [{ label: EVIL }] } },
        gauge: { kind: 'gauge', title: EVIL, desc: EVIL, gauges: [{ label: EVIL, value: 50, unit: EVIL }] },
        quiz: { kind: 'quiz', title: EVIL, desc: EVIL, questions: [{ q: EVIL, options: [EVIL, 'b'], answer: 0, explain: EVIL }] },
      }
      const sample = samples[kind]
      if (sample === undefined) { reasons.push(kind + '：新增 kind 必须在转义探针里补样本（否则它的快照没人守）'); continue }
      const spec = k.parse(sample)
      if (spec === undefined) { reasons.push(kind + '：示例 spec 解析失败，转义探针覆盖不到'); continue }
      const html = k.snapshot(spec)
      // 判据只看**未转义的 '<'+字母**（= 真标签）。不能查 "onerror=" 这类片段：
      // esc 只转义 & < >，转义后的 &lt;img ... onerror=...&gt; 里仍含 "onerror="，
      // 那是纯文本、安全，查它只会全员误报（实测过）。
      // 我们自己的标签都是已知白名单，模型文本一旦逃逸就会出现陌生的标签名。
      const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map(m => m[1].toLowerCase())
      const ALLOWED = new Set(['div','span','b','i','small','p','ul','li','svg','path','br','em','strong','code','pre','table','tr','td','th','thead','tbody','a','h1','h2','h3','h4','h5','h6','blockquote','hr','button','input','textarea','select','option','label','figure','g','line','circle','rect','text','tspan','defs','marker','polygon','polyline','use','title','desc','ellipse'])
      const stray = tags.filter(t => !ALLOWED.has(t))
      if (stray.length > 0) {
        reasons.push(kind + '：snapshot() 漏转义（出现未转义标签：' + [...new Set(stray)].join(',') + '）')
      }
      // 模型文本里的 < 必须已变成 &lt;。
      if (html.includes('<img') || html.includes('<script')) {
        reasons.push(kind + '：snapshot() 输出了模型文本里的原始标签')
      }
      // 反向确认样本确实被塞进去了（否则探针是空转）。
      if (!/&lt;|&quot;|&#/.test(html)) {
        reasons.push(kind + '：快照里找不到任何转义实体（样本可能没进到输出，探针空转）')
      }
    }
  }
  if (reasons.length > 0) fail('iu 快照转义：' + reasons.join('；'))
  else pass('iu 快照转义：12 个 kind 的模型文本全部以实体形式进 HTML（运行期探针）')
}

// ── 提示词与实现的一致性 ──────────────────────────────────────────────
//
// 提示词里对模型的每一条「沙箱事实」都必须有代码在背后兜着。写的时候是约定，
// 不钉住就迟早变成两句互不相干的话：模型按一句话写，代码按另一句话执行。
{
  const reasons = []
  const injectSrc = readFileSync(resolve(ROOT, 'src/triad/memory/engine/inject.ts'), 'utf8')
  const bridgeSrc = readFileSync(resolve(ROOT, 'src/client/html-embed/bridge.ts'), 'utf8')
  const pairs = [
    ['CSP', /CSP|Content-Security-Policy/, /Content-Security-Policy/],
    ['外链被拦', /外链一律被拦|外链全部|加载失败/, /default-src 'none'/],
  ]
  for (const [name, promptRe, codeRe] of pairs) {
    const inPrompt = promptRe.test(injectSrc)
    const inCode = codeRe.test(bridgeSrc)
    if (inPrompt !== inCode) {
      reasons.push(name + '：提示词与实现必须同时存在（提示词写了=' + inPrompt + '，代码做了=' + inCode + '）')
    }
  }
  if (reasons.length > 0) fail('提示词/实现一致性：' + reasons.join('；'))
  else pass('提示词与实现一致：外链拦截在文档与 CSP 两处同时成立')
}

// ── diagram / proto-tabs 的流式 pending 态 ──────────────────────────────
//
// 这两条通道长期**没有**流式态：围栏写到一半时半截 JSON 会以代码块逐字外冒，
// 而它们的正文恰恰是模型最容易写长的一类。补上之后再钉一次——退化成「又是
// 代码块」同样不会报错，只能靠断言。
{
  const reasons = []
  const TICK = '```'
  for (const [name, split, lang, body] of [
    ['diagram', mod.splitDiagram, 'diagram', '{"type":"flowchart","nodes":[{"id":"a"'],
    ['proto-tabs', mod.splitProtoTabs, 'proto-tabs', '{"title":"方案","tabs":[{"label":"A"'],
  ]) {
    if (typeof split !== 'function') {
      reasons.push('缺少 split' + name + ' 导出（流式行为不可断言）')
      continue
    }
    // ① 流式期未闭合围栏 → pending 占位卡。
    const live = split('前文\n' + TICK + lang + '\n' + body, true)
    const ph = live.find((p) => p.pending === true)
    if (ph === undefined) reasons.push(name + '：流式期未闭合围栏必须产出 pending 占位卡')
    else if (!(ph.bytes > 0)) reasons.push(name + '：占位卡必须带已写出的字节数')
    // ② 定稿期未闭合 → 回退代码块（被截断的历史消息不该永远停在等待态）。
    if (split(TICK + lang + '\n' + body, false).some((p) => p.pending === true)) {
      reasons.push(name + '：非流式期的未闭合围栏必须回退成代码块')
    }
    // ③ 只有本语言才走占位，别的语言的半截围栏不得被吞。
    if (split(TICK + 'js\nconst a = 1', true).some((p) => p.pending === true)) {
      reasons.push(name + '：只有本语言的围栏才走占位卡')
    }
    // ④ 已闭合的非本语言围栏不得出卡（补 pending 不能把正常路径改坏）。
    if (split(TICK + 'js\n1\n' + TICK).some((p) => p.kind !== 'md')) {
      reasons.push(name + '：非本语言的闭合围栏不得出卡')
    }
    // ⑤ 围栏前的正文必须原样保留（否则流式期上文会被吞掉）。
    const withHead = split('这里是正文\n' + TICK + lang + '\n' + body, true)
    if (!withHead.some((p) => p.kind === 'md' && p.text.includes('这里是正文'))) {
      reasons.push(name + '：未闭合围栏之前的正文必须原样保留')
    }
  }
  // ⑥ 四条通道必须共用同一份未闭合围栏扫描器。
  //
  // 此前 findOpenFence 在 html-embed/parse.ts 与 iu/parse.ts 各有一份逐字相同的
  // 副本；再加 diagram / proto 就是四份。任何一处判据变化都会让四条通道对同一段
  // markdown 给出不同切分，而这种漂移不会报错。
  for (const rel of [
    'src/client/html-embed/parse.ts',
    'src/client/iu/parse.ts',
    'src/client/diagram/parse.ts',
    'src/client/proto/parse.ts',
  ]) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
    if (!src.includes('shared/fence-scan.ts')) {
      reasons.push(rel + ' 必须复用 src/shared/fence-scan.ts 的扫描器（不要再写本地副本）')
    }
    if (/function findOpenFence/.test(src)) {
      reasons.push(rel + ' 不得再保留本地 findOpenFence 副本')
    }
  }

  if (reasons.length > 0) {
    fail('diagram / proto-tabs 流式契约：' + reasons.join('；'))
  } else {
    pass('diagram / proto-tabs：流式期未闭合围栏 → 占位卡，定稿回退代码块')
    pass('四条卡片通道共用同一份围栏扫描器（src/shared/fence-scan.ts）')
  }
}

// ── Seeker 右栏大盘「设置」抽屉（齿轮按钮 → 10 个开关）──────────────────
//
// 这组断言全部盯**静默失效**：齿轮位置写错（参与大盘 flex 流）会把右栏挤变形；
// 类名与样式表对不上则整个抽屉是裸 DOM；把抽屉写成条件渲染就丢了退场动画；
// 忘了 busy 门控会让用户在写盘期间连点出竞态。这些都不会报错，只会"看着不对"。
if (krEnabled) {
  const settingsPath = resolve(ROOT, 'src/client/kr-chat/KrPanelSettings.tsx')
  if (!existsSync(settingsPath)) {
    fail('大盘设置抽屉组件 KrPanelSettings.tsx 缺失（大盘上那枚齿轮点不开）')
  } else {
    const raw = readFileSync(settingsPath, 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    const agent = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')

    // 1) 装配：组件被大盘渲染，且拿到当前会话 id（/inject-state 要它）。
    if (!/<KrPanelSettings/.test(agent)) {
      fail('KrAgentPanel 未挂 KrPanelSettings（齿轮按钮不存在）')
    } else if (!/sessionId=\{latestChatSessionId\}/.test(agent)) {
      fail('KrPanelSettings 必须收到 latestChatSessionId（否则 host 状态读不出、开关是死的）')
    } else {
      pass('大盘设置：KrAgentPanel 装配 KrPanelSettings 并传入当前会话 id')
    }

    // 2) DOM 契约：类名逐字匹配样式表。改一边不改另一边就是裸 DOM（无样式、无动画）。
    //
    // 注意 `kr-panel-settings-btn`（顶栏齿轮）**不在这里** —— 它由
    // kr-chat-controller 以裸 DOM 注入，属于下面第 10 条那组断言的范畴。
    const required = [
      'kr-settings__scrim', 'kr-settings',
      'kr-settings__head', 'kr-settings__title', 'kr-settings__close',
      'kr-settings__body', 'kr-settings__group', 'kr-settings__group-title',
      'kr-settings__group-note', 'kr-settings__group--compact',
      // 两栏容器（2026-10-18 卡片化时新增）：左右两列各一个，缺了就是单列。
      'kr-settings__col--main', 'kr-settings__col--aside',
      // 工作区列表（2026-10-18 逐工作区开关）：容器 / 行 / 名称 / 路径 / 两个开关位 / 三态提示。
      'kr-settings__ws-list', 'kr-settings__ws-row', 'kr-settings__ws-main',
      'kr-settings__ws-name', 'kr-settings__ws-path', 'kr-settings__ws-flags',
      'kr-settings__ws-flag', 'kr-settings__ws-badge', 'kr-settings__ws-hint',
      'kr-settings__switch--mini',
      'kr-settings__row', 'kr-settings__row--lead', 'kr-settings__main',
      'kr-settings__label', 'kr-settings__hint', 'kr-settings__badge',
      'kr-settings__switch', 'kr-settings__foot',
    ]
    const missingClass = required.filter(name => !src.includes(name))
    const missingStyle = required.filter(name => !code.includes('.' + name))
    if (missingClass.length > 0) {
      fail(`KrPanelSettings 缺类名：${missingClass.join(', ')}（与样式契约不符）`)
    } else if (missingStyle.length > 0) {
      fail(`styles.ts 缺选择器：${missingStyle.join(', ')}（卡片会是裸 DOM）`)
    } else {
      pass(`大盘设置：${required.length} 个类名在组件与样式表两侧逐字对齐`)
    }

    // 3) 开合走 data-open，且抽屉**常驻 DOM**（条件渲染会丢掉退场动画）。
    if (!/data-open=/.test(src)) {
      fail('抽屉开合缺少 data-open 判据（样式表按它决定可见性）')
    } else if (!/aria-hidden=\{!open\}|aria-hidden=\{!opened\}/.test(src)) {
      fail('抽屉未把 aria-hidden 绑到开合状态（读屏会把隐藏的抽屉念出来）')
    } else {
      pass('大盘设置：开合走 data-open + aria-hidden（DOM 常驻，退场动画保得住）')
    }

    // 4) 三条关闭通路：Esc / 遮罩 / 抽屉关闭按钮。
    //
    // 「再点齿轮收起」那条不在本文件 —— 齿轮在顶栏，由 controller 负责。
    if (!/Escape/.test(src)) {
      fail('抽屉没接 Esc 关闭（键盘用户出不去）')
    } else if (!/setOpen\(false\)/.test(src)) {
      fail('遮罩或关闭按钮没接关闭动作（store.setOpen(false)）')
    } else {
      pass('大盘设置：Esc / 遮罩 / 关闭按钮三条关闭通路在位')
    }

    // 5) 数据面：复用 composer 那张卡的**同一套**归一化口径，不写第二套。
    //    两套口径（谁 !== false 谁 === true）会让同一个开关在两处显示成两个值。
    if (!/normalizeInjectState/.test(src) || !/FALLBACK_INJECT_STATE/.test(src)) {
      fail('KrPanelSettings 必须复用 Toggle.tsx 的 normalizeInjectState / FALLBACK_INJECT_STATE（第二套兜底口径会让同一开关显示成两个值）')
    } else if (!/createMemoryApi/.test(src)) {
      fail('KrPanelSettings 未接 host 数据面（createMemoryApi）')
    } else if (!/getInjectState/.test(src)) {
      fail('KrPanelSettings 打开时未拉取 /inject-state（展开看到的可能是过期状态）')
    } else {
      pass('大盘设置：复用同一套归一化口径 + 打开时重拉 host 状态')
    }

    // 6) 开关逐一在位：7 条 host 通道（6 条注入 + 1 条按工作区的「工作区项目记忆记录」）
    //    + 3 条外观偏好。
    //    行数**从源码推导**（数 `<SettingsRow`），不写死数字：写死过一次，加了新行之后
    //    断言与常量就成了两个事实源，改一处漏一处只会得到一个「看起来在测、其实没测」
    //    的绿勾。同理下面校验 `--row-i` 序号必须是从 0 起连续的整数 —— 新增行忘了顺延
    //    后面的序号，错开浮现会两行同时冒出来，而这既不该报错也不会打日志。
    const hostWriters = [
      'setZhInjectState', 'setHtmlInjectState',
      'setTeamInjectState', 'setStepInjectState', 'setTodoClosureState', 'setMailInjectState',
    ]
    const missingWriter = hostWriters.filter(name => !src.includes(name))
    const rowCount = (src.match(/<SettingsRow\b/g) ?? []).length
    // 10 处 = 4（中文 / 交互卡片 / 团队 / step 纪律）+ 2（邮箱「给开关 / 给角标」两分支）
    //      + 1（自动收口）+ 3（展示组）。
    // 灵魂注入那一行 2026-10-21 随灵魂模块整块删除：通道没了，闸门也就没有意义。
    // 邮箱那个三态行写两个分支是**刻意的**：省略 on 的那一支才是「不给拨不动的开关」。
    // 「工作区记忆」那一组 2026-10-18 改成了**逐工作区列表**（不再是固定的 SettingsRow），
    // 因此不计入这个数字 —— 它的判据在下面 6c。
    const expectedRows = 10
    // 10 个行序号（0..9）：邮箱两分支共用同一个 index（同一行的两种形态，不该占两个错开槽位）。
    // 2026-10-25 由 9 变 10：step 纪律从提示词通道组挪进「任务清单」组，与
    // 「回合结束自动收口」并列 —— 用户要求「任务清单相关的全部归到一个组」。
    // 开关**没有合并**：两者作用机理相反（一个写提示词、一个改状态），绑成一个
    // 开关会强迫用户做无意义的交易（想关"末项转圈"就得连带关掉"少往返"）。
    const expectedIndexes = 10
    const rowIndexes = [...src.matchAll(/index=\{(\d+)\}/g)].map(m => Number(m[1]))
    const distinctIndexes = [...new Set(rowIndexes)].sort((a, b) => a - b)
    const consecutive = distinctIndexes.length === expectedIndexes
      && distinctIndexes.every((value, i) => value === i)
    if (missingWriter.length > 0) {
      fail(`大盘设置缺写入口：${missingWriter.join(', ')}`)
    } else if (!/setReplyCardChromeEnabled/.test(src) || !/setToolCallsVisible/.test(src)) {
      fail('大盘设置缺两条外观偏好写入口（总结卡外框 / 工具调用卡）')
    } else if (!/subscribeReplyCardChrome/.test(src) || !/subscribeToolCallsVisible/.test(src)) {
      fail('外观偏好必须用 useSyncExternalStore 订阅（否则别的窗口改了本面板不跟随）')
    } else if (!/busy/.test(src)) {
      fail('host 写入缺少 busy 门控（写盘期间连点会出竞态，开关状态弹来弹去）')
    } else if (rowCount !== expectedRows) {
      fail(`大盘设置应有 ${expectedRows} 处 <SettingsRow>（4 注入 + 邮箱 2 分支 + 自动收口 + 展示 3），实得 ${rowCount}`)
    } else if (!consecutive) {
      fail(`行序号 --row-i 必须从 0 起连续到 ${expectedIndexes - 1}（新增行要顺延后面的序号，否则两行同时浮现）：实得 ${JSON.stringify(distinctIndexes)}`)
    } else {
      pass(`大盘设置：${expectedRows} 个开关行接线完整（6 条 host 通道 + 3 条外观偏好，邮箱两分支各占一行；--row-i 0..${expectedIndexes - 1} 连续，含 busy 门控）`)
    }

    // 6c) 「工作区记忆」组（2026-10-18 改成逐工作区列表）：用户要求「显示出来所有工作区
    //     每个单独进行开关，并且还需要有个开关是否排除注入」。
    //
    //     三条判据，缺一条都是**静默失效**：
    //       · 列表数据源必须是 host 的 /projects（接 /inject-state 只拿得到当前工作区，
    //         那样又退回「只显示一行」）；
    //       · 两个开关必须分别接 autoMemory 与 injectExcluded —— 只接一个就是少了一半能力；
    //       · 必须逐行 busy（projectBusy 是 hash 而不是 boolean）：用户会连着拨好几个，
    //         全局 busy 会让其余行全变灰、读起来像卡住。
    if (!/api\.projects\(\)/.test(src)) {
      fail('工作区列表必须走 api.projects()（/inject-state 只回当前工作区，列表会退回一行）')
    } else if (!/pushProjectFlag\(project\.hash, \{ autoMemory: !project\.autoMemory \}\)/.test(src)) {
      fail('「记录」开关必须接 autoMemory（缺了就是拨了不改记录行为）')
    } else if (!/pushProjectFlag\(project\.hash, \{ injectExcluded: !\(project\.injectExcluded === true\) \}\)/.test(src)) {
      fail('「不注入」开关必须接 injectExcluded（用户点名的第二个开关）')
    } else if (!/api\.meta\(hash, patch\)/.test(src)) {
      fail('逐工作区写入必须走 api.meta(hash, patch)（写 /inject-state 只会改当前工作区）')
    } else if (!/const \[projectBusy, setProjectBusy\] = useState<string \| null>/.test(src)) {
      fail('逐行 busy 必须是 hash 而不是全局 boolean（否则拨一行、其余全变灰）')
    } else if (!/projectsState === 'loading'/.test(src) || !/projectsState === 'error'/.test(src)) {
      fail('列表必须处理 loading / error 两态（否则首屏或拉失败时是一片空白）')
    } else if (!/samePath\(project\.path, projectCwd\)/.test(src)) {
      fail('列表必须标出「当前」工作区（用 samePath 归一化比较，别拿字符串直接 !==）')
    } else {
      pass('大盘设置：工作区记忆列出全部工作区 + 逐行两个开关（记录 / 不注入）+ 逐行 busy + 三态兜底')
    }

    // 6d) 灵魂注入行必须整块消失（2026-10-21 用户要求删除灵魂功能）。
    //     这一行原来拨的是 host 的 soulInjectEnabled —— 通道随模块一起删掉之后，
    //     留着这行就是「拨了没有任何东西可注入」的空开关，比缺失更误导。
    //     判据钉三处：行没了、写入口没了、归一化口径里的 soulEnabled 也没了。
    if (/label="灵魂注入"/.test(src) || /pushChannel\('soulEnabled'/.test(src) || /soulEnabled/.test(src)) {
      fail('大盘设置不得再留灵魂注入行（灵魂模块已整块删除，通道不存在了）')
    } else if (/SoulIcon|soulOn/.test(src)) {
      fail('大盘设置不得再引用灵魂图标 / soulOn 变量（灵魂模块已删除）')
    } else {
      pass('大盘设置：灵魂注入行已随模块删除（无空开关、无悬挂引用）')
    }

    // 6b) 操作面板显隐（同族第三条）：抽屉里一行 + 大盘消费 + apply 初始化，
    //     三处缺一，用户拨了就没反应（而这既不报错也不打日志）。
    //
    // 注意两处的文案来源**刻意不同**：抽屉里的行是硬编码中文（与它其余 9 行同款），
    // composer 侧走 i18n 键 plainTimelineLabel（键保留给别处复用/将来再入口）。
    // 断言要按各自的实际写法钉，不能拿 i18n 键去要求硬编码的那份。
    if (!/label="操作面板"/.test(src) || !/setPlainTimelineVisible\(!plainTimelineOn\)/.test(src)) {
      fail('大盘设置缺「操作面板」开关行（label / onToggle 未接 setPlainTimelineVisible）')
    } else if (!/plainTimelineOn/.test(src)) {
      fail('大盘设置未消费操作面板展示开关（拨了没反应）')
    } else if (!/plainTimelineVisible/.test(agent)) {
      fail('KrAgentPanel 未消费操作面板展示开关（右栏那张卡不会隐藏）')
    } else if (!/KR_PLAIN_TIMELINE_CARD_VISIBLE && plainTimelineOn/.test(agent)) {
      fail('操作面板的运行时开关必须与构建开关 KR_PLAIN_TIMELINE_CARD_VISIBLE 叠加（两个都开才渲染）')
    } else if (!/installPlainTimelineVisible/.test(readFileSync(resolve(ROOT, 'src/client/index.ts'), 'utf8'))) {
      fail('client/index.ts 未初始化 installPlainTimelineVisible（刷新后不读盘、跨窗口不同步）')
    } else {
      pass('大盘设置：操作面板开关三处在位（抽屉行 / 大盘消费 / apply 初始化）')
    }

    // 7) 邮箱三态：模块没挂时**不许**渲染开关（拨不动的开关是骗人）。
    if (!/mailAvailable/.test(src) || !/mailInjectBadge|不可用/.test(src)) {
      fail('邮箱行缺「模块未挂 → 不给开关、只给不可用徽标」的分支')
    } else {
      pass('大盘设置：邮箱行三态分级（未挂载时不给拨不动的开关）')
    }

    // 8) 定位硬约束（2026-10-18 卡片化后**整体反转**，改动前务必读完）：
    //
    //    遮罩与卡片现在 portal 到 document.body、position:fixed 铺满视口 ——
    //    它们是**全视口模态**，不再是右栏里的浮层。所以上一版那条
    //    「必须 absolute，否则参与大盘 flex 流」已经不适用了：portal 出去之后
    //    那棵 flex 子树里根本没有它们，absolute 反而是错的（会相对 body 定位
    //    但又不跟随视口）。
    //
    //    齿轮与邮箱按钮**已搬到操作面板卡头右上角**（2026-10-25 用户要求）。
    //    它们不再是顶栏里的文档流节点，而是卡头内的绝对定位按钮组
    //    （.kr-plain-head__tools）—— 见下面第 10 条那组断言。
    for (const cls of ['kr-settings__scrim', 'kr-settings']) {
      const rule = new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}').exec(code)?.[1] ?? ''
      if (rule === '') {
        fail(`未找到 .${cls} 样式规则`)
      } else if (!/position:\s*fixed/.test(rule)) {
        fail(`.${cls} 必须 position:fixed（卡片已 portal 到 body，absolute 不跟随视口）`)
      } else if (/position:\s*absolute/.test(rule)) {
        fail(`.${cls} 不得再用 position:absolute（那是右栏抽屉那套定位，已作废）`)
      }
    }
    // portal 必须真的调 createPortal：留在 .kr-split__side 里最宽只能盖住右栏。
    if (!/createPortal\(/.test(src)) {
      fail('KrPanelSettings 必须 createPortal 到 body（留在右栏子树里卡片最宽只能盖住右栏，且被 overflow:hidden 裁掉）')
    }
    /*
     * 齿轮/邮箱按钮的新位置（2026-10-25 用户：「这两个图标都移动到操作面板的
     * 右上角去」）。
     *
     * 判据三条，缺一条就说明它们没真的搬过去：
     *  · .kr-plain-head__tools 存在且绝对定位（卡头是竖排居中，按钮不能参与竖排）；
     *  · 卡头本身是 position:relative（否则绝对定位会相对别处）；
     *  · 两枚按钮共用 .kr-plain-head__tool（尺寸/悬停/打开态都挂在这个类上）。
     */
    // .kr-plain-head__tools 有两条规则：基础那条（absolute）与 Hero 里的覆盖（right:0）。
    // 断言要的是**存在一条绝对定位的**，不能只取第一条。
    const toolsRules = [...code.matchAll(/\.kr-plain-head__tools\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    const headRule = /\.kr-plain-head\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    if (toolsRules.length === 0) {
      fail('未找到 .kr-plain-head__tools（齿轮与邮箱按钮没搬到卡头右上角）')
    } else if (!toolsRules.some((rule) => /position:\s*absolute/.test(rule))) {
      fail('.kr-plain-head__tools 必须绝对定位（卡头是竖排居中，参与布局会把立绘挤偏）')
    } else if (!/position:\s*relative/.test(headRule)) {
      fail('.kr-plain-head 必须是 position:relative（右上角按钮组的定位基准）')
    } else if (!/\.kr-plain-head__tool\s*\{/.test(code)) {
      fail('未找到 .kr-plain-head__tool（两枚按钮的尺寸与打开态样式）')
    }
    // 遮罩平时不能拦点击：大盘上所有卡片都要点得到。
    const scrimRule = /\.kr-settings__scrim\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    if (!/pointer-events:\s*none/.test(scrimRule)) {
      fail('.kr-settings__scrim 常态必须 pointer-events:none（否则关着也挡住大盘全部交互）')
    } else {
      pass('大盘设置：遮罩/卡片 fixed 全视口 + portal 到 body + 顶栏齿轮留在文档流（三条定位约束都对）')
    }

    // 9) 动效与减弱动效兜底：可见性不许依赖动画。
    //    位移从「右滑 translateX」换成「浮起 translateY + 缩放」——卡片是居中的，
    //    横向滑入在居中外壳里读起来像「从右边飘过来」，方向语义不对。
    if (!/\.kr-settings[^{]*\{[^}]*translateY\(/.test(code)) {
      fail('卡片缺少浮起位移（用户要求带动效，静态显隐不算做到位）')
    } else if (!/prefers-reduced-motion[\s\S]{0,1400}?\.kr-settings/.test(code)) {
      fail('缺少 prefers-reduced-motion 兜底（减弱动效用户的卡片可能停留在不可见态）')
    } else if (!/prefers-reduced-motion[\s\S]{0,1400}?translate\(-50%,\s*-50%\)/.test(code)) {
      fail('减弱动效下必须把卡片的居中 transform 写回去（整体归零会让它贴到视口右下角）')
    } else {
      pass('大盘设置：浮起位移 + 减弱动效兜底（含居中归位）在位')
    }
    // 9b) 卡片几何：2026-10-18 从「右栏 380px 抽屉」改成「视口居中 960px 卡片」，
    //     判据整体换了：不再是「够宽不折行」，而是「够宽能排两栏 + 四周留边」。
    //
    //     三条都要钉，因为每一条失效都是**静默的**：
    //       · 宽度掉到 800px 以下 → 两栏挤不下（左栏说明折成 4~5 行）；
    //       · 缺 min(..., 100vw - 48px) → 窄窗口下卡片被挤出视口两侧；
    //       · 缺 max-height 夹紧 → 卡片撑出屏幕，底部内容被切掉。
    const cardRule = /\.kr-settings\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    const cardWidth = Number(/width:\s*min\((\d+)px/.exec(cardRule)?.[1] ?? 0)
    if (cardRule === '') {
      fail('未找到 .kr-settings 样式规则')
    } else if (cardWidth < 800) {
      fail(`卡片宽度 ${cardWidth}px 太窄（两栏排不下，左栏说明会折成 4~5 行）`)
    } else if (!/width:\s*min\(\d+px,\s*calc\(100vw\s*-\s*\d+px\)\)/.test(cardRule)) {
      fail('.kr-settings 宽度必须写成 min(Npx, calc(100vw - 留边))（否则窄窗口下卡片被挤出视口）')
    } else if (!/max-height:\s*calc\(100d?vh\s*-\s*\d+px\)/.test(cardRule)) {
      fail('.kr-settings 需要 max-height 夹紧在视口内（内容超长时撑出屏幕，底部被切）')
    } else {
      pass(`大盘设置：卡片宽 ${cardWidth}px + min() 视口夹紧 + max-height 兜底（两栏放得下）`)
    }

    // 9b2) 两栏布局（2026-10-18 用户点名「布局需要调整下」）：
    //
    //      左栏 = 提示词通道 6 行（说明最长），右栏 = 工作区记忆 1 行 + 展示 3 行。
    //      三处缺一即失效，而且**都不报错**：
    //        · body 不是 grid → 两栏塌回单列，看着像没改；
    //        · 缺 __col 两个容器 → 左栏那一组把右栏两组顶到下面去，白改；
    //        · 缺窄屏回退 → 820px 以下两栏挤成两根细柱子，说明全折行。
    const bodyRule = /\.kr-settings__body\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    if (!/display:\s*grid/.test(bodyRule)) {
      fail('.kr-settings__body 必须是 grid（否则两栏塌回单列，用户要的布局调整等于没做）')
    } else if (!/grid-template-columns:\s*minmax\(0,\s*[\d.]+fr\)\s+minmax\(0,\s*[\d.]+fr\)/.test(bodyRule)) {
      fail('.kr-settings__body 需要两列 grid-template-columns（左右两栏）')
    } else if (!src.includes('kr-settings__col--main') || !src.includes('kr-settings__col--aside')) {
      fail('组件必须把三组拆进 kr-settings__col--main / --aside 两个容器（缺了就还是单列）')
    } else if (!/kr-settings__col--main/.test(code) || !/kr-settings__col--aside/.test(code)) {
      fail('styles.ts 缺 .kr-settings__col--main / --aside 规则（两栏容器无样式）')
    } else if (!/@media \(max-width: 820px\)[\s\S]{0,400}?grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(code)) {
      fail('缺窄屏回退（820px 以下两栏挤成两根细柱子，说明全折行）')
    } else {
      pass('大盘设置：两栏布局（左 提示词通道 / 右 工作区记忆+展示）+ 窄屏回退单列')
    }

    // 9c) 「展示」组紧凑排版：两行上限 + 悬停/聚焦展开 + 触摸降级，三样缺一即失效
    //     （缺截断=没换展示方式；缺展开=说明读不全；缺触摸降级=手机用户永远读不全）。
    const compactHintRule = /\.kr-settings__group--compact \.kr-settings__hint\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    if (compactHintRule === '') {
      fail('缺少 .kr-settings__group--compact .kr-settings__hint 规则（「展示」组的紧凑排版失效）')
    } else if (!/-webkit-line-clamp:\s*[1-4]\b/.test(compactHintRule)) {
      fail('紧凑组 hint 未做行数封顶（用户要求换展示方式：长说明不该常驻铺满）')
    } else if (!/\.kr-settings__group--compact \.kr-settings__row:hover \.kr-settings__hint/.test(code)
      || !/\.kr-settings__group--compact \.kr-settings__row:focus-within \.kr-settings__hint/.test(code)) {
      fail('紧凑组 hint 缺悬停/聚焦展开（键盘用户与鼠标用户都会读不全说明）')
    } else if (!/@media \(hover: none\)[\s\S]{0,400}?kr-settings__group--compact[\s\S]{0,400}?line-clamp:\s*unset/.test(code)) {
      fail('紧凑组缺触摸设备降级（@media (hover: none) 下必须展开全文，手机没有悬停）')
    } else if (!/(?:title=\{hint\}|title=\{fullText\})/.test(src)) {
      fail('hint 未挂原生 title 全文（截断后拿不到完整内容的兜底）')
    } else if (!/const fullText = title \?\? hint \?\? label/.test(src)) {
      /* 2026-10-25 排版改造后 title 有了三级回退（显式 title > hint > label）：
       * 每行的 hint 只剩「差异那半句」，全文挪到 title 上。这条断言钉住回退链
       * 本身 —— 只写 title={hint} 的话，那些传了独立 title 的行拿不到全文，
       * 而那既不报错也不打日志。 */
      fail('SettingsRow 的悬停全文必须有三级回退（显式 title > hint > label）')
    } else {
      pass('大盘设置：「展示」组紧凑排版三件套在位（行数封顶 / 悬停+聚焦展开 / 触摸降级 + title 兜底）')
    }

    // 9d) 「工作区记忆」必须是**下方通栏独立区块**（2026-10-25 用户要求
    //     「工作区记忆应该放在下方独立的空间」）。
    //
    //     这条的前身是「它必须是普通组、不能带 --compact」，理由是它的说明是
    //     注记型、被截成一行就读不全。结构搬走之后判据整体换了 —— 但那条精神
    //     仍然成立，所以新断言里也钉了「组说明不许被 line-clamp 截断」。
    //
    //     四条判据，每条失效都是静默的：
    //       · 组件里得有 .kr-settings__ws-zone，且它**不在** .kr-settings__body 之内
    //         （在里面会被 body 的内边距切断底色，变成悬空的内嵌面板）；
    //       · 样式表得有这条规则，且带自己的底色（不套卡片外框，靠底色分区）；
    //       · 组说明不许被截断 —— 它是整组共性，截了没有第二出口；
    //       · 它必须排在上方两栏之后（DOM 顺序 = 视觉顺序，不靠 order 反排）。
    /*
     * 「区块在不在 body 之内」必须靠**真实的 div 深度扫描**判断，不能拿一个
     * 跨块正则去猜：`[\s\S]*?` 会一路跨过 `</div>`，把「body 之后出现的
     * ws-zone」也算成在 body 里（实测吃过一次假失败）。
     *
     * 做法：从 `<div className="kr-settings__body">` 的起始标签开始，扫描
     * 开/闭 div 标签维护深度；深度回到 0 那一刻就是 body 的收口位置。
     * ws-zone 若出现在它之后 = 在 body 之外（正确）；之前 = 还在 body 里（错）。
     */
    const zoneInBody = (() => {
      const bodyAt = raw.indexOf('className="kr-settings__body"')
      const zoneAt = raw.indexOf('kr-settings__ws-zone"')
      if (bodyAt < 0 || zoneAt < 0) return false
      /*
       * 从 body 的起始标签开始维护 div 深度，回到 0 的那一刻就是 body 的收口。
       *
       * ⚠ 循环里**不能**再写 `if (depth === 0) break` 之类的提前退出：起始标签
       * 本身是第一个匹配项，而那时 depth 还是 0 —— 提前退出会让循环一次都不累加，
       * closing 变成起始标签的位置，于是「zone 在 body 内」恒为假、断言永远通过
       * （这是一条会静默失去检测能力的写法，实测踩过）。
       */
      let depth = 0
      let i = 0
      const tagRe = /<(\/?)div\b[^>]*>/g
      tagRe.lastIndex = bodyAt
      let match
      while ((match = tagRe.exec(raw)) !== null) {
        depth += match[1] === '/' ? -1 : 1
        if (depth === 0) {
          i = match.index
          return zoneAt > bodyAt && zoneAt < i
        }
      }
      // 扫不到收口（畸形源码）：保守认为在 body 内，让断言把问题喊出来。
      return true
    })()
    const zoneRule = /\.kr-settings__ws-zone\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    const zoneNoteRule = /\.kr-settings__ws-zone \.kr-settings__group-note\s*\{([^}]*)\}/.exec(code)?.[1] ?? ''
    if (!raw.includes('kr-settings__ws-zone')) {
      fail('「工作区记忆」必须是独立区块 .kr-settings__ws-zone（用户要求「放在下方独立的空间」）')
    } else if (zoneInBody) {
      fail('「工作区记忆」区块不能留在 .kr-settings__body 里（body 的内边距会把极淡底色切断，变成悬空的内嵌面板）')
    } else if (zoneRule === '') {
      fail('styles.ts 缺 .kr-settings__ws-zone 规则（区块没有底色与分隔线，与上面两栏糊在一起）')
    } else if (!/border-top:\s*1px solid/.test(zoneRule)) {
      fail('.kr-settings__ws-zone 缺上方发丝分隔线（分区读不出来）')
    } else if (!/color-mix\(in srgb,[\s\S]{0,120}?2\.8%/.test(zoneRule)) {
      fail('.kr-settings__ws-zone 的底色必须是极淡的 color-mix（写死颜色在深色主题下会变成一块脏灰）')
    } else if (!/background:/.test(zoneRule) || /border-radius|box-shadow/.test(zoneRule)) {
      fail('.kr-settings__ws-zone 只能靠底色分区，不得套卡片外框（圆角+描边+阴影 = 卡中卡，本仓库老坑）')
    } else if (/-webkit-line-clamp/.test(zoneNoteRule)) {
      fail('「工作区记忆」的组说明不许 line-clamp（整组共性被截断没有第二出口）')
    } else {
      pass('大盘设置：「工作区记忆」是 body 之外的下方通栏区块（底色分区 + 发丝线，不套卡片外框；组说明不截断）')
    }

    // 9e) 行排版：**grid 三段定宽**（2026-10-25）。
    //
    //     拥挤的直接原因就在这里：原来是 flex，开关跟着说明文字的长度浮动，
    //     左栏 6 行与右栏 3 行停在两条不同的竖线上。改成 grid 之后开关贴右缘、
    //     上下对齐成一列。缺 grid-template-columns 就会退回「开关位置随文字浮动」，
    //     而这既不报错也看不出是"少了条样式"。
    //
    //     ⚠ 必须扫**全部**同名规则再挑：窄屏媒体查询里也有 `.kr-settings__row {…}`
    //     （它只改列定义），取第一个匹配会命中那段，得到假失败。
    const rowRules = [...code.matchAll(/\.kr-settings__row\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    if (!rowRules.some((rule) => /display:\s*grid/.test(rule))) {
      fail('.kr-settings__row 必须是 grid（flex 下开关位置随文字长度浮动，扫视时每栏都要重新找对齐线）')
    } else if (!rowRules.some((rule) => /grid-template-columns:\s*var\(--kr-settings-label-w[^)]*\)\s+minmax\(0,\s*1fr\)\s+auto/.test(rule))) {
      fail('.kr-settings__row 必须是「标签定宽 | 说明弹性 | 开关定宽」三列（开关才能上下对齐）')
    } else if (!/\.kr-settings__main\s*\{[^}]*display:\s*contents/.test(code)) {
      fail('.kr-settings__main 必须 display:contents（否则 label/hint 挤在一格里，父级三列排不出来）')
    } else if (!/@media \(max-width: 560px\)[\s\S]{0,300}?\.kr-settings__row[\s\S]{0,160}?minmax\(0,\s*1fr\)\s+auto/.test(code)) {
      fail('窄屏（≤560px）必须把行降成两列（标签+开关一行、说明独占下一行），否则说明被挤成两三个字一行')
    } else {
      pass('大盘设置：行是 grid 三列（标签定宽 / 说明弹性 / 开关定宽，开关排成一列）+ 窄屏降两列')
    }

    // 9f) 说明默认一行 + 悬停展开：拥挤的根因是 11 个开关常驻 22 行文字。
    //     这条机制原先是「展示」组的专属优化，2026-10-25 提升为基类默认形态。
    //     断言钉三处：基类有封顶、基类有展开、触摸设备一律展开（同 9e，扫全部同名规则）。
    const hintRules = [...code.matchAll(/\.kr-settings__hint\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    if (!hintRules.some((rule) => /-webkit-line-clamp:\s*1\b/.test(rule))) {
      fail('.kr-settings__hint 基类必须默认封顶一行（长说明常驻会把 11 个开关撑成 22 行）')
    } else if (!/\.kr-settings__row:hover \.kr-settings__hint/.test(code)
      || !/\.kr-settings__row:focus-within \.kr-settings__hint/.test(code)) {
      fail('基类 hint 缺悬停/聚焦展开（封顶之后读不到全文 = 信息被删掉了）')
    } else if (!/@media \(hover: none\)[\s\S]{0,300}?\.kr-settings__hint[\s\S]{0,200}?line-clamp:\s*unset/.test(code)) {
      fail('基类 hint 缺触摸设备降级（@media (hover: none) 下必须展开，手机没有悬停）')
    } else {
      pass('大盘设置：说明默认一行 + 悬停/聚焦/触摸三档展开（不是删字，是按需展开）')
    }

    // 9g) 组头右侧的「适用范围」小字（2026-10-25）。
    //
    //     它承担的是**整组共性**：原先「每会话首步注入一次」在团队协作与 step
    //     纪律两行里各写一遍，「只改本机观感/随浏览器保存」在展示组三行里各写
    //     一遍。提到组头说一次，各行的短说明才只剩差异。
    //     缺了它不会报错 —— 只是那些共性又得抄回每一行，拥挤会慢慢长回来。
    if (!/kr-settings__group-head/.test(raw) || !/kr-settings__group-scope/.test(raw)) {
      fail('组头缺 .kr-settings__group-head / __group-scope（整组共性无处安放，只能又抄回每行）')
    } else if (!/\.kr-settings__group-scope\s*\{/.test(code) || !/\.kr-settings__group-head\s*\{/.test(code)) {
      fail('styles.ts 缺组头 / 适用范围那两条规则（裸 DOM 会折行把组头撑高）')
    } else if (!/@media \(max-width: 560px\)[\s\S]{0,200}?\.kr-settings__group-scope[\s\S]{0,80}?display:\s*none/.test(code)) {
      fail('窄屏必须藏掉组头右侧的适用范围（放不下时折行，把标题压到中线以下）')
    } else {
      pass('大盘设置：组头右侧承载「整组共性」（提示词通道 / 展示 / 工作区记忆各一句），窄屏自动隐藏')
    }

    // 10) 入口位置：齿轮与邮箱按钮在**操作面板卡头右上角**（2026-10-25 用户要求
    //     「这两个图标都移动到操作面板的右上角去」）。
    //
    //     历史：2026-10-15 曾点名放到顶栏 Seeker 标签右侧，靠裸 DOM 注入 + 每 250ms
    //     同步位置 + 量几何反推官方 tablist 的 flex gap 才塞进去。搬到自己的卡头之后
    //     那整套成本归零 —— 但**必须留一句清理**摘掉旧 bundle 残留的顶栏按钮，
    //     否则页面上会出现两组一样的图标。
    const ctrl = readFileSync(resolve(ROOT, 'src/client/kr-chat/kr-chat-controller.tsx'), 'utf8')
    // 两枚按钮已随卡头抽到 SeekerHead.tsx（操作面板卡与新对话页共用）。
    const seekerHeadSrcHere = readFileSync(resolve(ROOT, 'src/client/kr-chat/SeekerHead.tsx'), 'utf8')
    if (!/id="kr-panel-settings-btn"/.test(seekerHeadSrcHere) || !/id="kr-mail-btn"/.test(seekerHeadSrcHere)) {
      fail('齿轮与邮箱按钮必须在 KrPlainTimelineCard 卡头里渲染（id 沿用旧版，e2e 按它找节点）')
    } else if (!/removeLegacyHeaderButtons/.test(ctrl)) {
      fail('controller 必须清理旧版顶栏按钮（热重载后会出现两组一样的图标）')
    } else if (!/closest\('header \[role="tablist"\]'\)/.test(ctrl)) {
      /*
       * ⚠ 清理的判据必须是「在不在顶栏里」，不能只看 id —— 新按钮沿用同一对 id，
       * 单纯 getElementById 会把刚渲染好的新按钮一起删掉，表现为「卡头右上角什么都没有」。
       * 这一条是踩过的坑，钉住。
       */
      fail('清理旧顶栏按钮必须按「在不在 header tablist 里」判断（只看 id 会误删新按钮）')
    } else if (!/getPanelSettingsStore|panel-settings-store/.test(ctrl)) {
      fail('controller 必须经共享 store 与抽屉联动（否则点了不开/关不掉）')
    } else {
      pass('大盘设置入口：齿轮+邮箱在操作面板卡头右上角（id 沿用）+ 旧顶栏按钮按位置清理')
    }

    // 11) 共享 store 的跨 bundle 共享语义：live reload 会让模块级单例分叉，
    //     表现为"点按钮抽屉不开"。必须挂 window + 品牌字段判别。
    const storeSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/panel-settings-store.ts'), 'utf8')
    if (!/__dshChatPlusPanelSettings__/.test(storeSrc) || !/STORE_BRAND/.test(storeSrc)) {
      fail('panel-settings-store 必须挂 window + 品牌字段（否则 live reload 后两份 store 分叉，按钮点了不开）')
    } else {
      pass('大盘设置：共享 store 跨 bundle 共享（window 槽位 + 品牌判别）')
    }

    // 12) composer 那张重复的卡必须**彻底**消失：座位、导出、组件三者缺一即复活。
    //
    // 必须先剥注释：本次改动恰恰在注释里反复说明"旧的那套已经删掉、为什么删"，
    // 拿原文匹配会把说明文字当成残留（本仓踩过这类假阳性）。
    const memIndex = readFileSync(resolve(ROOT, 'src/client/triad/memory/index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    const toggleFile = readFileSync(resolve(ROOT, 'src/client/triad/memory/Toggle.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    if (/dsh-memory-builtin-toggle/.test(memIndex)) {
      fail('composer 的 builtin-toggle 座位已删除，不该再注册（对话区又长出重复的卡）')
    } else if (/export function BuiltinToggle/.test(toggleFile)) {
      fail('BuiltinToggle 组件已删除，不该再导出（留着就会被重新挂回去）')
    } else if (/\bBuiltinToggle\b/.test(memIndex)) {
      fail('triad/memory/index.ts 仍引用 BuiltinToggle（应已随之删除）')
    } else {
      pass('composer 重复卡已彻底删除（座位 / 组件 / 引用三处都干净）')
    }

    // 13) 技能开关：**随操作组 hover 浮出，浮出后必须可点**。
    //     2026-10-23 踩过两次：
    //       ① 开关与操作组抢同一格，hover 时开关 opacity→0 + pointer-events:none，
    //          而要点开关必然先 hover → 一碰上去就自己藏起来，点了没反应；
    //       ② 开关常驻占位，把每行撑高、把描述挤窄（用户要的是紧凑目录行）。
    //     现在的形态：开关住在 .skm-skill-card-foot 里，操作组默认
    //     opacity:0 + pointer-events:none，hover/focus-within 时整体变可见可点。
    //     判据因此变成三条：操作组自身隐藏、可见态放开、且开关确实在里面。
    const skillsPanel = readFileSync(resolve(ROOT, 'src/client/triad/usage/dashboard/SkillsPanel.tsx'), 'utf8')
    const footBase = /\.skm-skill-card-foot\{([^}]*)\}/.exec(skillsPanel)
    const footShow = /\.skm-skill-card:hover \.skm-skill-card-foot,\.skm-skill-card:focus-within \.skm-skill-card-foot\{([^}]*)\}/.exec(skillsPanel)
    const toggleInFoot = /<div className=\{css\.skillCardFoot\}>[\s\S]{0,600}?role="switch"/.test(skillsPanel)
    if (footBase === null || footShow === null) {
      fail('找不到 .skm-skill-card-foot 的默认/浮出两条规则（技能操作组样式被改掉了？）')
    } else if (!/visibility\s*:\s*hidden/.test(footBase[1]) || !/opacity\s*:\s*0/.test(footBase[1])) {
      fail('操作组默认必须隐藏（visibility:hidden + opacity:0），否则开关会常驻占着右列、把行撑高')
    } else if (!/visibility\s*:\s*visible/.test(footShow[1]) || !/opacity\s*:\s*1/.test(footShow[1])) {
      fail('操作组 hover/focus 时必须恢复可见，否则开关浮出后点不动（2026-10-23 回归）')
    } else if (!toggleInFoot) {
      fail('技能开关应住在操作组（.skm-skill-card-foot）里，随它一起浮出 —— 常驻会把行撑高')
    } else {
      pass('技能开关随操作组 hover 浮出，浮出后可见可点（不常驻、不占行高）')
    }

    // 14) 收起态与展开态必须是**同一个技能行**，只差渲染数量。
    //     设计稿 dir-1 就是 `shown = open ? list : list.slice(0, 6)`；插件曾经把它
    //     实现成两套 DOM（.skm-bundle-preview-chip / .skm-skill-card），结果两边外观
    //     永远对不齐、每次只改一边另一边就掉队。这里钉死：收起态不许再有独立行组件。
    // 先剥注释：本次改动恰恰在注释里反复提到「旧的 .skm-bundle-preview-chip 已合并」，
    // 拿原文匹配会把说明文字当成残留（本仓第 12 条已经踩过同一类假阳性）。
    const skillsSrc2 = readFileSync(resolve(ROOT, 'src/client/triad/usage/dashboard/SkillsPanel.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    if (/bundlePreviewChip|skm-bundle-preview-chip/.test(skillsSrc2)) {
      fail('收起态又长出了独立的 .skm-bundle-preview-chip —— 收起/展开必须共用 .skm-skill-card')
    } else if (!/shownSkills/.test(skillsSrc2) || !/listSource\.slice\(0, COLLAPSED_ROWS\)/.test(skillsSrc2)) {
      fail('收起/展开应共用同一个列表（shownSkills = openView ? listSource : listSource.slice(0, COLLAPSED_ROWS)）')
    } else if (!/skillMoreRow/.test(skillsSrc2)) {
      fail('收起态缺少「还有 N 个」尾巴（它把同一批行的剩余部分露出来，而不是切版式）')
    } else {
      pass('收起/展开共用同一套技能行：只差渲染数量，另加「还有 N 个」尾巴')
    }

    // 15) 技能列表必须住在**右栏里面**，左栏 262px 整列归技能包。
    //     2026-10-23：列表一度被挪到 <header> 外面，于是横跨整行、压到左栏包名
    //     区域下方 —— 左栏只剩三行字贴顶，视觉上包名像是挂在技能列表的边角。
    //     判据：<div className={css.bundleRight}> 之内必须包住技能列表。
    const rightOpen = skillsSrc2.indexOf('<div className={css.bundleRight}>')
    const rightClose = skillsSrc2.indexOf('</header>', rightOpen)
    const gridInRight = rightOpen >= 0 && rightClose > rightOpen
      && /css\.skillGrid|gridClass/.test(skillsSrc2.slice(rightOpen, rightClose))
    if (rightOpen < 0) {
      fail('找不到右栏容器 <div className={css.bundleRight}>')
    } else if (!gridInRight) {
      fail('技能列表跑到右栏外面了 —— 它会横跨整行，左栏 262px 就不再是纯技能包信息')
    } else {
      pass('技能列表住在右栏内：左栏 262px 整列归技能包，两栏靠发丝竖线分隔')
    }

    // 16) 包行左侧那条主色竖线必须**彻底消失**。
    //     2026-10-23 用户截图指认「左侧这条线去掉」。它有两条来源，缺一条就复活：
    //       ① 面板表 SkillsPanel.tsx 的 .skm-bundle-row-outer::before（left:-20px）
    //       ② 换肤层 theme.ts  的 .wb-root .skm-bundle-row-outer::before（left:0, 2px）
    //     两条叠起来 hover 时从行首直贯行尾，比 25px 的包名还抢眼。
    const themeSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/theme.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    const panelSrc = skillsSrc2
    const lineInPanel = /\.skm-bundle-row-outer::before\s*\{/.test(panelSrc)
    const lineInTheme = /\.wb-root \.skm-bundle-row-outer::before\s*\{/.test(themeSrc)
    if (lineInPanel || lineInTheme) {
      fail(`包行左侧竖线又出现了（面板表:${lineInPanel} 换肤层:${lineInTheme}）—— 用户要求去掉`)
    } else {
      pass('包行左侧不再画主色竖线（面板表与换肤层两处来源都已清除）')
    }
  }
}

/* ── 界面字体：选项表 / 覆盖 CSS / 座位（纯逻辑，全部可断言）─────────────
 *
 * 这些错了都不会报错，只会静默显示成错的字体：
 *   ① 默认档不是微软雅黑 → 用户没选过却被换了字体；
 *   ② 字体栈漏掉通用回退链 → 缺字时掉成浏览器默认衬线（中文尤其明显）；
 *   ③ webfont 档的 URL 不指向 host 路由 → 404，浏览器静默回退；
 *   ④ 覆盖 CSS 不写 html:root → 压不过官方 :root，改了没反应；
 *   ⑤ **只写下层变量（--dsw-font-family）而漏掉上层槽位（--dsh-font-family-text）
 *      → 官方 body 自己重新声明了下层变量，元素自身声明压过继承，html 上写多高
 *      特异性都传不下去 —— 表现为「字体加载成功、document.fonts.check 为 true，
 *      但界面一个字都没变」。DSH 0.2.1 恢复本功能时踩过，必须钉死。
 */
{
  const fontTest = mod.uiFontTest
  if (fontTest === undefined) {
    fail('ui-font 纯逻辑测试面（uiFontTest）未导出')
  } else {
    const { FONT_OPTIONS, DEFAULT_FONT_ID, fontOptionOf, fontOverrideCss, fontFileUrl } = fontTest
    const reasons = []

    // ① 默认档必须是微软雅黑（用户点开设置看到的初始值）。
    if (DEFAULT_FONT_ID !== 'system') reasons.push(`默认档应为 system，实得 ${DEFAULT_FONT_ID}`)
    const system = FONT_OPTIONS.find(o => o.id === 'system')
    if (system === undefined) reasons.push('缺少 system 档（微软雅黑）')
    else if (!/Microsoft YaHei/.test(system.body)) reasons.push('system 档必须显式写 Microsoft YaHei')
    else if (system.webfont !== undefined) reasons.push('system 档不该带 webfont（默认档必须零下载）')

    // 下拉框恰好两个选项，且第二项是霞鹜新致宋。
    if (FONT_OPTIONS.length !== 2) reasons.push(`下拉框应恰好 2 个选项，实得 ${FONT_OPTIONS.length}`)
    const lx = FONT_OPTIONS.find(o => o.id === 'lxgw-neozhisong')
    if (lx === undefined) reasons.push('缺少 lxgw-neozhisong 档')
    else {
      if (lx.label !== '霞鹜新致宋') reasons.push(`档位标签应为「霞鹜新致宋」，实得 ${lx.label}`)
      if (lx.webfont === undefined) reasons.push('lxgw 档必须声明 webfont（否则永远拿不到真字体）')
      else if (!/@font-face/.test(fontOverrideCss(lx))) reasons.push('lxgw 档的覆盖 CSS 必须带 @font-face')
      else if (!fontFileUrl(lx.webfont.file).startsWith('/api/chat-flow/fonts/')) {
        reasons.push(`webfont URL 必须指向 host 路由，实得 ${fontFileUrl(lx.webfont.file)}`)
      }
    }

    // ② 每一档的正文字体栈都必须带通用回退（缺字不掉成衬线）。
    for (const option of FONT_OPTIONS) {
      if (!/sans-serif\s*$/.test(option.body.trim())) reasons.push(`${option.id} 的正文字体栈未以 sans-serif 收尾`)
      if (!option.code.includes('monospace') && !/Consolas|Menlo|SF Mono/.test(option.code)) {
        reasons.push(`${option.id} 的代码字体栈缺少等宽字体`)
      }
    }

    // ③ 覆盖 CSS 必须用 `html:root`（压过官方 :root）。
    //
    // 特异性实算：官方把变量声明在 `:root`（伪类，(0,1,0)）；`html` 只有
    // (0,0,1) —— **更低**，会被官方原值压过。实机踩过一次，必须钉死。
    const css = fontOverrideCss(FONT_OPTIONS[0])
    if (!/^html:root\{/.test(css)) {
      reasons.push('覆盖 CSS 必须用 html:root（html 特异性 (0,0,1) 低于官方 :root 的 (0,1,0)，会被压过）')
    }

    // ④ 上层槽位与下层消费值必须同时写（DSH 0.2.1 两层变量）。
    //
    // --dsh-font-family-text / -code 是官方「更多字体设置」写入的可写槽位，
    // body 上的 --dsw-font-family / --ds-font-family-code 由它们派生。
    // 只写后者 → body 自身的声明赢，html 上的值对后代不可见（改了没反应）。
    for (const name of ['--dsh-font-family-text', '--dsh-font-family-code']) {
      if (!css.includes(name + ':')) reasons.push(`覆盖 CSS 缺少上层槽位 ${name}（只写下层变量时 body 自身声明会赢，改了没反应）`)
    }
    for (const name of ['--dsw-font-family', '--ds-font-family-code']) {
      if (!css.includes(name + ':')) reasons.push(`覆盖 CSS 缺少下层变量 ${name}`)
    }

    // ⑤ 未知 id 必须回落默认档（localStorage 脏值不该白屏或换字体）。
    if (fontOptionOf('nope').id !== DEFAULT_FONT_ID) reasons.push('未知 id 未回落默认档')
    if (fontOptionOf(null).id !== DEFAULT_FONT_ID) reasons.push('null 未回落默认档')

    if (reasons.length > 0) fail('界面字体契约：' + reasons.join('；'))
    else pass('界面字体：默认微软雅黑 + 两档下拉 + 通用回退齐备 + 两层变量齐备')

    // 设置行座位：官方「通用」页的 settings.general.item，order 排在官方两行之后。
    const fontRow = registeredSlots.find(s => s?.slot === 'settings.general.item' && s?.id === 'ui-font')
    if (fontRow === undefined) {
      fail(`missing ui-font settings row (settings.general.item / ui-font)，实得 ${JSON.stringify(registeredSlots.filter(s => s?.slot === 'settings.general.item'))}`)
    } else if (fontRow.order !== 12) {
      // 官方 appearance=10 / font-size=11，本行必须排在它们之后（同列堆叠）。
      fail(`ui-font 行 order 应为 12（官方外观 10 / 字号 11 之后），实得 ${fontRow.order}`)
    } else {
      pass('ui-font 设置行座位：settings.general.item / order 12（排在官方外观与字号之后）')
    }

    // 字体覆盖必须**同步**应用（不能等 React 挂载）：apply 路径上就写 <style>。
    const fontIndexSrc = readFileSync(resolve(ROOT, 'src/client/ui-font/index.ts'), 'utf8')
    if (!/initFont\(\)/.test(fontIndexSrc) || !/applyStoredFont\(\)/.test(fontIndexSrc)) {
      fail('ui-font 入口必须同步调用 initFont() + applyStoredFont()（否则首帧会闪一下系统字体）')
    } else if (!/settings\.general\.item/.test(fontIndexSrc)) {
      fail('ui-font 入口必须注册 settings.general.item 座位')
    } else {
      pass('ui-font 在 apply 阶段同步应用（首帧即所选字体）+ 注册通用设置行')
    }

    // 失败必须可见：切换中/失败都要有状态文案，静默等待会被当成「点了没反应」。
    const rowSrc = readFileSync(resolve(ROOT, 'src/client/ui-font/Row.tsx'), 'utf8')
    if (!/加载失败/.test(rowSrc)) fail('字体加载失败必须给出可见提示（否则用户只会觉得字体坏了）')
    else if (!/加载中/.test(rowSrc)) fail('5.0MB 字体下载期间必须显示「加载中」（否则像是卡死）')
    else pass('字体状态可见：加载中 / 加载失败提示齐备')

    // 覆盖样式表必须真的出现在 head 里（apply 阶段注入，id 契约见 font.ts 的 STYLE_ID）。
    if (!styleIds.includes('dsh-chat-plus-ui-font')) {
      fail('apply 阶段没有把 <style id=dsh-chat-plus-ui-font> 注入 head（字体覆盖不会生效）')
    } else {
      pass('apply 阶段已注入字体覆盖样式表（首帧即所选字体）')
    }
  }
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${CLIENT}`)
process.exit(process.exitCode ?? 0)
