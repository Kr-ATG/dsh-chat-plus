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
const sessionsStub = { list: { getSnapshot: () => ({ byId: {} }) } }
const inputTriggersStub = { register: () => () => {} }
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
  'dsh-chat-flow-download-styles',
  'dsh-triad-skill-source-styles',
  // 面板外壳（page / compact 两种形态）。2026-10-04 起由 registerPanelSeat 在
  // apply() 时同步注入（三个工作台页共用一个座位注册器），不再等 React 首帧。
  'dsh-popover-shell-styles',
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

// 十四枚槽位：对话增强五枚（turn-process / assistant-step keyed / 截图按钮 /
// download toolview / kr-todo-bridge）+ 融合工作台九枚（记忆 / 能力 / 邮箱三个
// 工作台各两枚：main 页 + sidebar.panellist 菜单行，共 6；composer 两枚开关
// dsh-memory-builtin-toggle / dsh-memory-inject-toggle；skill toolview 一枚）。
// 座位 id/order/locale 全部原样保留；原 automation-notifier 随自动化模块一起下线。
const cell = (key) => registeredSlots.find((s) => s?.slot === 'conversation.chat.node' && s?.key === key)
if (registeredSlots.length !== 10) {
  fail(`expected 10 slot registrations, got ${registeredSlots.length}: ${JSON.stringify(registeredSlots)}`)
} else {
  pass('registered 10 seats (5 chat-plus + 5 triad: 1 unified workbench page/row + 2 toggles + skill toolview)')
}

// 4合1 统一工作台页面：本体挂官方 `main`（key=workbench），侧边栏菜单行 `sidebar.panellist`（id=workbench）。
const wbPage = registeredSlots.find((s) => s?.slot === 'main' && s?.key === 'workbench')
const wbRow = registeredSlots.find((s) => s?.slot === 'sidebar.panellist' && s?.id === 'workbench')
if (wbPage === undefined) fail('missing unified workbench page seat main / workbench')
else if (wbRow === undefined) fail('missing unified sidebar row seat sidebar.panellist / workbench')
else if (wbRow.order !== 20) fail(`sidebar row workbench order = ${wbRow.order}, expected 20`)
else pass('seat main / workbench + sidebar.panellist / workbench @ order 20')

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
  } else if (!/params: \{ line: options\.line \}/.test(previewSrc)) {
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
  } else {
    pass('path-linkify：裸路径 → 官方链接；单图路径 → 图片；代码块/行内代码/已有链接不动')
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

// ── 产出物卡（会话累计的成品清单，挂在操作面板之下） ─────────────────────
//
// 这张卡有四条**形态契约**，缺一条就从「点一下就看见」退化成「看着一堆文件名」：
//  1. 整行即入口 —— 行本身是 button，**没有**行内「预览」小按钮（多一枚只是把
//     同一句话说了两遍）；悬停箭头是 aria-hidden 的纯视觉提示。
//  2. 缩略图是**按类型画的 SVG**，不是 <img> 真实文件预览（28px 见方读不出画面，
//     而为每行发一次文件请求的代价与收益完全不成比例）。
//  3. 代码文件折成一行计数，可展开（一次编码任务改十几个源文件，逐条占行会把
//     「做出来了什么」整个淹掉）。
//  4. 卡片常驻：没有产出时给一行空态，不整张 return null。
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
    fail('产出物行主体必须是真 button（键盘可达 + 触屏 :active），点开画廊式 Lightbox')
  } else if (!/<button[\s\S]{0,300}?className="kr-out-row__open"/.test(outputsCode)) {
    fail('产出物行尾必须有「在侧栏打开」真 button（保留原右栏预览链路，用户 2026-10-04 点名）')
  } else if (!/aria-label=\{`在侧栏打开 \$\{item\.name\}`\}/.test(outputsCode)) {
    fail('行尾钮必须带 aria-label（它是真动作，不再是 aria-hidden 视觉箭头）')
  } else if (!/INLINE_PREVIEW_KINDS\.has\(item\.kind\)/.test(outputsCode)) {
    fail('行主体点击必须分流：可内联预览类别开 Lightbox，md/代码等回退侧栏原路')
  } else if (!/MediaLightbox/.test(outputsCode) || !/sessionRawUrl\(item\.path/.test(outputsCode)) {
    fail('产出物卡必须复用画廊共享 MediaLightbox，且文件地址走 session 作用域 raw')
  } else if (/<img\b/.test(outputsCode)) {
    fail('缩略图必须是按类型画的 SVG，不得用 <img> 拉真实文件（28px 见方读不出画面，且每行一次请求）')
  } else if (!/function Thumb\(\{ kind \}/.test(outputsCode) || !/case 'model3d':/.test(outputsCode)) {
    fail('缩略图必须按 OutputKind 分派（image/video/model3d/doc/sheet/archive/code…）')
  } else if (!/kr-out-code__toggle/.test(outputsCode) || !/另有 \$\{code\.length\} 个代码文件/.test(outputsCode)) {
    fail('代码文件必须折成一行「另有 N 个代码文件」，可展开')
  } else if (!/本次会话还没有产出文件/.test(outputsCode)) {
    fail('产出物卡空态必须常驻一行（不整张 return null，与任务概览同一口径）')
  } else if (!/KrOutputsCard[\s\S]{0,600}?squeezed=\{panelSqueezed\}/.test(outputsPanelSrc)) {
    fail('右栏挤压时必须把 squeezed 传给产出物卡（默认露出条数降一档）')
  } else if (!/KrPlainTimelineCard[\s\S]{0,900}?<KrOutputsCard/.test(outputsPanelSrc)) {
    fail('产出物卡必须挂在操作面板**之下**（滚动区最后一张卡）')
  } else {
    pass('产出物卡：整行可点 + SVG 类型缩略图 + 代码折行 + 常驻空态，挂在操作面板之下')
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
    fail('outputs.ts 必须把代码类归 code，认不出的扩展名归 other（不列也不计数）')
  } else if (!/html: 'page'/.test(outputsSrc) || /html: 'code'/.test(outputsSrc)) {
    // 用户报的 BUG：做出来的 .html 演示页被折进「另有 N 个代码文件」，成品就此
    // 消失在一个计数里。.html 对用户是"能打开的页面"（成果），.ts/.css 才是"做
    // 页面的材料"，两者不能同类。
    fail('outputs.ts 必须把 html/htm 归 page（能打开的页面），不得归 code —— '
      + '归 code 会把做出来的演示页折进「另有 N 个代码文件」计数里')
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
  } else if (!/allGone/.test(outputsCardSrc) || !/都已不在磁盘上/.test(outputsCardSrc)) {
    fail('全被核对掉时要有专门空态（「都已不在磁盘上」），不能和「还没产出」说同一句话')
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
  } else {
    pass('outputs.ts：参数/结果两路工具集分离 + spill 排除 + 落盘说明闸门 + 交付路径优先 + run_code/媒体豁免')
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
  } else if (!/KR_ASK_CARD_VISIBLE/.test(thinkingSrc) || !/<KrAskCard asks=\{turnAsks\} inline \/>/.test(thinkingSrc)) {
    fail('问答卡必须由 ThinkingStepNodeView 以 inline 形态挂载（贴在对话流里）')
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

// ── 邮箱工作台（Agent Mail）座位契约 ─────────────────────────────────
// 2026-10-04 改版：入口由「自绘导航行 + portal 到 body 的 fixed 抽屉」改为官方
// `main` 页 + `sidebar.panellist` 菜单行。旧契约（open=false 必须返回 null）防的是
// 「fixed 全高抽屉从插件加载那一刻就盖住界面」，page 形态是 centerCol 里的普通
// flex item、只在被选中时才渲染，那条守卫连同 open/closing 状态机一并删除。
// 新契约：面板不得再依赖 open/closing/anchor（否则等于没改完），且必须仍能被
// 官方座位装配起来。
{
  const mailPanelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const mailIndexSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/index.ts'), 'utf-8')

  if (/\bclosing\b/.test(mailPanelSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 '))) {
    fail('MailPanel 不得再有 closing（page 形态由官方 main keyed 槽位负责挂载/卸载，没有退场动画阶段）')
  } else if (/PopoverAnchor/.test(mailPanelSrc)) {
    fail('MailPanel 不得再依赖 PopoverAnchor（page 形态铺满 main，不需要贴入口定位）')
  } else if (!/registerPanelSeat/.test(mailIndexSrc)) {
    fail('邮箱入口必须走 registerPanelSeat（main 页 + sidebar.panellist 菜单行）')
  } else {
    pass('邮箱工作台：page 形态（无 open/closing/anchor）+ 官方 main / sidebar.panellist 座位')
  }
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

// ── 邮箱破坏性操作必须跟着「邮件实际所在文件夹」走 ──────────────────────
{
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/mail/Panel.tsx'), 'utf-8')
  const cliSrc = readFileSync(resolve(ROOT, 'src/mail/cli.ts'), 'utf-8')
  const serviceSrc = readFileSync(resolve(ROOT, 'src/mail/service.ts'), 'utf-8')
  const storeSrc = readFileSync(resolve(ROOT, 'src/mail/store.ts'), 'utf-8')

  // Agent Mail 的规则：+trash 只作用于非回收站邮件、+delete 只作用于回收站邮件。
  // 收件箱里给「永久删除」= 用户点出一个 404（真实故障：Message does not exist
  // or is not in trash）。
  //
  // ⚠️ 判定依据必须是**服务端给出的邮件实际归属**（detail.dir.dir_name），不能
  // 用「当前列表的文件夹」：列表可能来自本地缓存（邮件早已被移走），拿它判定
  // 就会给错按钮，用户点下去撞的是真实故障 `Cannot delete message from this
  // directory`（截图里那句英文），而且刷新也刷不掉。
  if (!/const actualDir = detail\.dir\?\.dir_name/.test(panelSrc)) {
    fail('破坏性按钮必须按 detail.dir.dir_name（邮件实际所在文件夹）判定，不能用列表文件夹')
  } else if (/inTrash=\{folder === 'trash'\}/.test(panelSrc)) {
    fail('禁止用「当前列表的文件夹」判定 inTrash（缓存陈旧时会给错按钮 → Cannot delete message from this directory）')
  } else if (!/\{inTrash\s*\n?\s*\?\s*\(/.test(panelSrc)) {
    fail('「移入回收站」与「永久删除」必须按 inTrash 二选一渲染')
  } else if (!/Cannot delete message from this directory/i.test(cliSrc)) {
    fail('CLI 的 Cannot delete message from this directory 必须翻成人话（否则用户只看到一句英文）')
  } else if (!/not in trash/.test(cliSrc) || !/humanizeCliError/.test(cliSrc)) {
    fail('CLI 英文报错必须翻译成人话（至少覆盖 not in trash 这条）')
  } else if (!/async invalidateCache\(/.test(storeSrc) || !/invalidateCache\(\)/.test(serviceSrc)) {
    fail('写操作成功后必须作废列表缓存（否则刚删掉的邮件还留在列表里，用户重复点）')
  } else {
    pass('邮箱破坏性操作：按邮件实际归属二选一 + 写后作废缓存 + 英文报错人话化')
  }
}

// ── 面板写操作：点一下就执行，不给「待确认」条 ──────────────────────────
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
  // 用户明确要求：**面板上不要「待确认」条**。用户亲手点那一下就是许可，
  // 再让他在警示条上点一次「确认执行」是同一个问题问两遍。所以 now 变体
  // 一次请求走完两阶段，面板侧不再有 pending 状态与警示条。
  if (!/^\s*replay:\s*WriteReplay/m.test(typesSrc) || !/export type WriteReplay/.test(typesSrc)) {
    fail('待确认记录必须存下完整的 replay 参数（不能靠 CLI summary 反推）')
  } else if (!/async confirmPending\(token: string\)/.test(serviceSrc)) {
    fail('host 必须提供 confirmPending(token)：从落盘 replay 原样重放')
  } else if (!/pending\/confirm/.test(readFileSync(resolve(ROOT, 'src/mail/api.ts'), 'utf-8'))) {
    fail('必须提供 /pending/confirm 路由（模型工具的两阶段确认走它）')
  } else if (/preview\.id|preview\.body|preview\.subject/.test(panelSrc)) {
    fail('面板不得从 preview 里读业务字段拼请求（summary 里没有正文/附件，字段名也不同）')
  } else if (/css\.pendingBar|待确认警示条/.test(panelSrc)) {
    fail('面板不得再渲染「待确认」警示条（用户明确要求：点一下就执行，不要二次确认）')
  } else if (/api\.pending\(/.test(panelSrc) || /api\.pending\(/.test(entrySrc)) {
    fail('面板/入口不得再拉待确认列表（没有警示条要用它）')
  } else if (!/async trashNow\(/.test(serviceSrc) || !/async deleteNow\(/.test(serviceSrc)) {
    fail('面板的移入/删除要走 now 变体（用户点击即许可，一次请求走完两阶段）')
  } else if (!/confirmationToken/.test(serviceSrc.slice(serviceSrc.indexOf('async trash('), serviceSrc.indexOf('async trash(') + 420))) {
    fail('trash() 必须把 confirmationToken 传进 writeCall（只收形参不往下传 = 第二阶段又拿新令牌，永远停在 pending）')
  } else {
    pass('面板写操作：点一下就执行（无待确认条）+ host 侧 replay 原样重放两阶段')
  }
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
  if (reasons.length > 0) {
    fail('任务/操作面板取数回退：' + reasons.join('；'))
  } else {
    pass('任务取数：PTC 内层穿透 + 按 seq 取最新 + 切会话立即回填 live todos')
  }
}

// ── 灵魂卡片化 + 「灵魂 / 记忆」两个独立分类（2026-10-05）────────────────────
//
// 这几条是**布局契约**，不是实现细节。历史沿革值得写下来，否则后人很容易改回去：
//   1. 一开始灵魂只是记忆面板里的一个 Tab；
//   2. 2026-10-05 用户要求「打开工作台后左侧是灵魂、右侧是记忆」→ 同屏并排一页；
//   3. 同日用户改口「还是把记忆和灵魂分开两个分类吧」→ **当前形态：两个平级 Tab**。
// 并排时每边只有半屏，灵魂的卡片列表与记忆的三栏都伸展不开——这才是拆分的原因。
// 断言必须锁住「灵魂与记忆各自独立成页」，否则后人「顺手」合回去时没有任何提示。
{
  const hubSrc = readFileSync(resolve(ROOT, 'src/client/triad/hub/WorkbenchPanel.tsx'), 'utf8')
  const hubCss = readFileSync(resolve(ROOT, 'src/client/triad/hub/styles.ts'), 'utf8')
  const panelSrc = readFileSync(resolve(ROOT, 'src/client/triad/memory/Panel.tsx'), 'utf8')
  const whaleSrc = readFileSync(resolve(ROOT, 'src/client/triad/soul/WhaleLogo.tsx'), 'utf8')
  const cardsSrc = readFileSync(resolve(ROOT, 'src/client/triad/soul/CardsSection.tsx'), 'utf8')
  const presetsSrc = readFileSync(resolve(ROOT, 'src/client/triad/soul/PresetsSection.tsx'), 'utf8')
  const reasons = []

  if (!/export const DEFAULT_TAB: WorkbenchTab = 'soul'/.test(hubSrc)) {
    reasons.push('默认 Tab 必须是 soul（用户要求打开工作台先看到灵魂）')
  }
  // 灵魂与记忆各自独立成页（互不嵌套）：soul 分类只放 SoulPanel，memory 分类只放 MemoryPanel。
  if (!/activeTab === 'soul'[\s\S]{0,300}SoulPanel/.test(hubSrc)) {
    reasons.push('「灵魂」必须是独立分类，直接挂 SoulPanel')
  }
  if (!/activeTab === 'memory'[\s\S]{0,300}MemoryPanel/.test(hubSrc)) {
    reasons.push('「记忆」必须是独立分类，直接挂 MemoryPanel')
  }
  if (/wb-pair/.test(hubSrc) || /wb-pair/.test(hubCss)) {
    reasons.push('并排布局（wb-pair）已废弃：用户要求灵魂与记忆分开两个分类')
  }
  if (/pairMode/.test(panelSrc)) {
    reasons.push('pairMode 已废弃：记忆面板不再有「只做概览」的半屏形态')
  }
  // 灵魂入口唯一：记忆面板内不得再有「灵魂」子 Tab / SoulPanel（拆分后归工作台分类）。
  // 注意判据要精确到「记忆分类那一块」——hub 里的 soulApi 是灵魂分类自己在用，合法。
  if (/SoulPanel|'soul'/.test(panelSrc)) {
    reasons.push('记忆面板内不得再挂灵魂子 Tab（灵魂是平级分类，入口只此一处）')
  }
  const memoryBranch = /activeTab === 'memory'[\s\S]{0,400}?MemoryPanel[^>]*\/>/.exec(hubSrc)
  if (memoryBranch === null || /soulApi/.test(memoryBranch[0])) {
    reasons.push('记忆分类的 MemoryPanel 不得再接收 soulApi（灵魂入口只此一处）')
  }
  // 判据：必须有「原样回填」这条分支，且不得再出现任何 'memory' 的强制迁移
  // （曾经有过 saved === 'memory' → 'soul'，拆分后那会让用户每次都被拽去灵魂页）。
  if (!/return saved/.test(hubSrc) || /saved === 'memory'/.test(hubSrc)) {
    reasons.push("localStorage 的 'memory' 是合法值，必须原样回填（拆分后不可再强制迁移到 soul）")
  }
  if (!/\.wb-soul-scroll\s*\{[\s\S]{0,200}overflow-y:\s*auto/.test(hubCss)) {
    reasons.push('灵魂分类要独占整页滚动容器（wb-soul-scroll）')
  }

  // 鲸鱼：动效类名在样式表里（组件只挂类名），path 是官方完整数据。
  const soulCss = readFileSync(resolve(ROOT, 'src/client/triad/soul/styles.ts'), 'utf8')
  if (!/dsh-soul-whale-breathe/.test(soulCss)) reasons.push('鲸鱼缺少呼吸动效')
  if (!/dsh-soul-whale-sweep/.test(soulCss)) reasons.push('鲸鱼缺少流光动效')
  if (!/prefers-reduced-motion[\s\S]{0,600}dsh-soul-whale/.test(soulCss)) {
    reasons.push('鲸鱼动效必须在 prefers-reduced-motion 下关闭')
  }
  // 灵魂主体双栏（用户 2026-10-05 要求「灵魂用双栏布局」）：左卡片区 / 右预设区。
  // 注意 soulCss 在本块上方才声明——把这条断言写在其声明之前会触发 TDZ 直接崩掉脚本。
  const soulPanelSrc = readFileSync(resolve(ROOT, 'src/client/triad/soul/SoulPanel.tsx'), 'utf8')
  if (!/css\.columns[\s\S]{0,900}CardsSection[\s\S]{0,900}css\.colRight[\s\S]{0,600}PresetsSection/.test(soulPanelSrc)) {
    reasons.push('灵魂主体必须是双栏：左卡片区 / 右预设区')
  }
  if (!/\.dsh-soul-columns\s*\{[\s\S]{0,160}grid-template-columns/.test(soulCss)) {
    reasons.push('灵魂双栏要用 grid 两列，并在窄面板下折叠成单列')
  }
  // path 在源码里是**分段拼接**的（只为可读性），判据必须取「常量声明到常量结束」
  // 之间的全部单引号串再拼接：按段首字符过滤会漏掉以负号开头的续段，量出来比真值短，
  // 把一份正确的 3448 字符 path 误判成手绘简化版（踩过一次）。
  const whaleStart = whaleSrc.indexOf('const FISH_LOGO_PATH')
  const whaleEnd = whaleSrc.indexOf('/** WhaleLogo 属性')
  const whalePath = (whaleStart === -1 || whaleEnd === -1)
    ? ''
    : [...whaleSrc.slice(whaleStart, whaleEnd).matchAll(/'([^']*)'/g)].map(match => match[1]).join('')
  if (whalePath.length !== 3448 || !whalePath.startsWith('M22.9168')) {
    reasons.push('鲸鱼 path 必须是官方 FishLogo 的完整数据（3448 字符），不是手绘简化版')
  }
  if (!/cards|Card/.test(cardsSrc) || !/soul-cards-|soulCard/.test(cardsSrc + soulCss)) {
    reasons.push('缺少灵魂卡片区')
  }
  const soulLocales = readFileSync(resolve(ROOT, 'src/client/triad/soul/locales.ts'), 'utf8')
  if (!/soulPresetApplyReplace: '整体替换'/.test(soulLocales) || !/soulPresetApplyMerge: '合并应用'/.test(soulLocales)) {
    reasons.push('预设区必须同时提供「整体替换」与「合并应用」两条路径')
  }
  if (reasons.length > 0) {
    fail('灵魂/记忆分类契约：' + reasons.join('；'))
  } else {
    pass('工作台分类：灵魂与记忆各自独立成页（默认 soul · 无并排残留 · memory 原样回填）')
    pass('灵魂卡片化：会动的鲸鱼（官方 path）+ 卡片区 + 预设两条应用路径')
  }
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${CLIENT}`)
process.exit(process.exitCode ?? 0)
