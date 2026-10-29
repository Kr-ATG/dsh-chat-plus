/**
 * dsh-chat-plus — 对话流 / 右栏滚动条自动隐藏测试（2026-10-29）。
 *
 * 行为口径：滚动 / 滚轮时显示，停止 3 秒后隐藏；会话切换换掉滚动容器后
 * 自动重挂；新出现的右栏滚动容器自动接管；卸载时清掉所有属性与监听。
 *
 * 用 fake DOM 直接驱动源模块（Node 24 原生剥离 TS 类型），不依赖浏览器。
 */
const HIDE_MS = 3000
const WATCH_MS = 500
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fails = []
function need(condition, label) {
  if (condition) console.log('ok    ' + label)
  else { fails.push(label); console.log('FAIL  ' + label) }
}

/** 只实现本模块用到的 DOM 面：属性读写 + 事件登记。 */
class FakeScroller {
  constructor() {
    this.attrs = new Map()
    this.listeners = new Map()
  }
  setAttribute(key, value) { this.attrs.set(key, String(value)) }
  getAttribute(key) { return this.attrs.has(key) ? this.attrs.get(key) : null }
  removeAttribute(key) { this.attrs.delete(key) }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) ?? []
    const index = list.indexOf(fn)
    if (index >= 0) list.splice(index, 1)
  }
  emit(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event)
  }
  listenerCount() {
    let total = 0
    for (const list of this.listeners.values()) total += list.length
    return total
  }
}

let chat = new FakeScroller()
const panels = [new FakeScroller()]
const fakeDocument = {
  querySelectorAll: (selector) => {
    if (selector === '[data-conversation-scroll]') return [chat]
    if (selector === '.kr-panel__scroll') return panels
    return []
  },
}
globalThis.document = fakeDocument
globalThis.window = globalThis

const mod = await import('../src/client/kr-chat/scrollbar-autohide.ts')
const dispose = mod.installConversationScrollbarAutoHide()

need(mod.SCROLLBAR_HIDE_DELAY_MS === HIDE_MS, '隐藏延迟是 3000ms')
need(JSON.stringify(mod.SCROLLBAR_TARGET_SELECTORS) === JSON.stringify(['[data-conversation-scroll]', '.kr-panel__scroll']),
  '目标容器覆盖官方对话流与 Seeker 右栏')
need(chat.getAttribute('data-scrollbar-autohide') === '', '官方对话流容器装上自动隐藏标记')
need(panels[0].getAttribute('data-scrollbar-autohide') === '', 'Seeker 右栏滚动容器装上自动隐藏标记')
need(chat.getAttribute('data-scrollbar-active') === null && panels[0].getAttribute('data-scrollbar-active') === null,
  '初始状态都是隐藏')

chat.emit('scroll')
need(chat.getAttribute('data-scrollbar-active') === 'true', '对话流滚动后滚动条立即显示')
need(panels[0].getAttribute('data-scrollbar-active') === null, '对话流滚动不会误点亮右栏')
await sleep(HIDE_MS + 150)
need(chat.getAttribute('data-scrollbar-active') === null, '对话流停止滚动 3 秒后滚动条隐藏')

panels[0].emit('scroll')
need(panels[0].getAttribute('data-scrollbar-active') === 'true', '右栏滚动后滚动条立即显示')
await sleep(HIDE_MS + 150)
need(panels[0].getAttribute('data-scrollbar-active') === null, '右栏停止滚动 3 秒后滚动条隐藏')

chat.emit('wheel')
need(chat.getAttribute('data-scrollbar-active') === 'true', '滚轮事件也会立即点亮滚动条')
await sleep(1000)
chat.emit('scroll')
await sleep(HIDE_MS - 800)
need(chat.getAttribute('data-scrollbar-active') === 'true', '滚动持续发生时 3 秒计时不断重置（不会半途隐藏）')
await sleep(800)
need(chat.getAttribute('data-scrollbar-active') === null, '最后一次滚动后 3 秒仍然隐藏')

const oldChat = chat
chat = new FakeScroller()
const newPanel = new FakeScroller()
panels.push(newPanel)
await sleep(WATCH_MS + 200)
need(chat.getAttribute('data-scrollbar-autohide') === '', '会话切换换掉对话流容器后自动重挂到新节点')
need(oldChat.getAttribute('data-scrollbar-autohide') === null, '旧对话流容器上的标记与监听被清理')
need(newPanel.getAttribute('data-scrollbar-autohide') === '', '后挂载的右栏滚动容器也会被自动接管')
chat.emit('scroll')
need(chat.getAttribute('data-scrollbar-active') === 'true', '新容器上的滚动同样会点亮滚动条')

dispose()
need(chat.getAttribute('data-scrollbar-autohide') === null && panels[0].getAttribute('data-scrollbar-autohide') === null,
  '卸载时清掉所有容器上的标记')
need(chat.listenerCount() === 0 && panels[0].listenerCount() === 0 && newPanel.listenerCount() === 0,
  '卸载时摘掉所有事件监听')

console.log('')
if (fails.length > 0) {
  console.log('SCROLLBAR AUTOHIDE TEST FAILED — ' + String(fails.length) + ' 个断言未通过')
  process.exit(1)
}
console.log('SCROLLBAR AUTOHIDE TEST PASSED — 3 秒自动隐藏 + 双容器 + 容器替换重挂')
