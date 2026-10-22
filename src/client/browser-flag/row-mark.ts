/**
 * dsh-chat-plus — 会话行上的浏览器标志（DOM 注入）。
 *
 * ## 为什么用属性 + 伪元素，而不是往行里插节点
 *
 * 官方会话行是 React 渲染的（Rows.tsx 的 SessionNodeItem）。插进去的节点会在
 * 下一次重渲染时被 diff 抹掉，表现为「图标闪一下就没了」，还得反复重插
 * —— 这是 tools-gate/menu-icons.ts 已经踩过的坑，同一套路照搬：在行元素上打
 * 一个 data 属性，图标本体交给纯 CSS 的 ::after + mask。React 不认识这个属性，
 * 重渲染不会清掉它；元素还在，图标就在。
 *
 * ## 为什么图标在**行右端**
 *
 * 2026-10-22 按用户要求定稿：标志挪到**行右侧**（时间戳旁边）。行首那 16px 还给
 * 会话状态点（spinner）—— 转圈表达「正在生成」，浏览器图标表达「正在操作浏览器」，
 * 两者本来就不是同一件事，挤在一格反而互相盖。右侧本就承载「这个会话最近怎么样」
 * （相对时间 / pending 标签），浏览器活动放这里读起来是一路的。
 *
 * 实现是「绝对定位到行尾 padding 区 + 行自己让出一格」（见 styles.ts 的定位规则），
 * 不改行结构：行是官方 React 渲染的 draggable treeitem，任何结构改动都会在下次
 * 重渲染时打架。
 *
 * ## 为什么属性值放工具名
 *
 * 属性值是该会话正在用的浏览器工具名（tool 或 service）。两个用处：
 *  1. CDP / 冒烟可以直接断言「哪一行、什么工具」，不用截图肉眼看；
 *  2. CSS 可以按值做差（例如将来给不同 service 不同颜色），无需改 JS。
 * 值做了收敛（只留 [\w.@/:-]，其它字符换成 - 并截断），免得带引号或换行的
 * 工具名把属性写坏。
 *
 * ## 容错
 *
 * 找不到行、观察器不可用、数据为空，都只是「没有图标」，绝不抛错 ——
 * 会话列表是官方核心 UI，插件在这里出问题等于把整个列表拖下水。
 */

import type { BrowserActivitySession } from './store.ts'
import {
  browserFlagToolLabel,
  getBrowserFlagSnapshot,
  sessionFlagVisible,
  subscribeBrowserFlag,
} from './store.ts'

/** 行元素上的标志属性（styles.ts 按它选 ::after）。 */
export const BROWSER_FLAG_ROW_ATTR = 'data-dsh-browser-flag'

/** 会话行的行键前缀（官方 data-row-key="session:<id>"）。 */
const ROW_KEY_PREFIX = 'session:'

/** 行选择器：只认会话行，项目行（project:<id>）不参与。 */
const ROW_SELECTOR = '[data-row-key^="session:"]'

/**
 * 属性值收敛：只保留安全字符，其余折成 '-'，并截断到 64 字符。
 * 工具名来自模型/配置，可能含引号、空白或极长串，直接塞进属性会把 DOM 写坏。
 */
export function flagAttrValue(entry: BrowserActivitySession | null | undefined): string {
  const raw = browserFlagToolLabel(entry)
  if (raw === '') return '1'
  const safe = raw.replace(/[^\w.@/:+-]/g, '-').slice(0, 64)
  return safe === '' ? '1' : safe
}

/** 从行键里取会话 id；不是会话行则返回 null。 */
export function sessionIdOfRowKey(key: string | null | undefined): string | null {
  if (typeof key !== 'string') return null
  if (!key.startsWith(ROW_KEY_PREFIX)) return null
  const id = key.slice(ROW_KEY_PREFIX.length)
  return id === '' ? null : id
}

/**
 * 给一棵子树里所有会话行同步标志属性。
 *
 * 幂等：值没变时不碰 DOM —— 否则我们每秒写一次属性，会在 DevTools 里刷满
 * mutation 记录，也会让任何观察 attributes 的官方代码白跑。
 *
 * @param root - 观察范围内的根（通常 document）。
 * @param sessions - sessionId → 活动条目（来自 store 快照）。
 * @returns 本次真正改动（打上或清掉）的行数。
 */
export function syncBrowserFlagRows(
  root: { querySelectorAll?: (selector: string) => ArrayLike<Element> | Iterable<Element> | null } | null | undefined,
  sessions: ReadonlyMap<string, BrowserActivitySession>,
): number {
  if (root === null || root === undefined || typeof root.querySelectorAll !== 'function') return 0
  // NodeList（真实浏览器）是「ArrayLike + iterable」，而测试桩可能只给数组。
  // 统一成数组再遍历：两种形状都能吃，也避免只写 ArrayLike 时在 for..of 上
  // 拿到「不可迭代」的类型错误。
  let rows: Element[] = []
  try {
    const found = root.querySelectorAll(ROW_SELECTOR)
    if (found !== null && found !== undefined) rows = Array.from(found as ArrayLike<Element>)
  } catch {
    return 0
  }
  let changed = 0
  try {
    for (const row of rows) {
      if (row === null || row === undefined) continue
      const sessionId = sessionIdOfRowKey(row.getAttribute('data-row-key'))
      if (sessionId === null) continue
      const entry = sessions.get(sessionId)
      if (!sessionFlagVisible(entry)) {
        if (row.hasAttribute(BROWSER_FLAG_ROW_ATTR)) {
          row.removeAttribute(BROWSER_FLAG_ROW_ATTR)
          changed += 1
        }
        continue
      }
      const next = flagAttrValue(entry)
      if (row.getAttribute(BROWSER_FLAG_ROW_ATTR) === next) continue
      row.setAttribute(BROWSER_FLAG_ROW_ATTR, next)
      changed += 1
    }
  } catch {
    // 行结构异常（节点被移除 / 不是 Element）：本轮跳过，下次变化再试。
    return changed
  }
  return changed
}

let observer: MutationObserver | null = null
let unsubscribe: (() => void) | null = null
let scheduled = false

/** 推迟到下一帧：官方列表在滚动、搜索、切工作区时会连续重渲染。 */
function scheduleSync(): void {
  if (scheduled) return
  scheduled = true
  const run = (): void => {
    scheduled = false
    try {
      syncBrowserFlagRows(document, getBrowserFlagSnapshot().bySession)
    } catch {
      // 结构异常：本轮跳过。
    }
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

/**
 * 常驻观察列表并维持标志属性。幂等。
 *
 * 观察**整棵 body** 的 childList：会话行散布在多个工作区分组里，且滚动、
 * 折叠、搜索都会重建节点，没有稳定的挂载点可以只观察一小块（与 menu-icons
 * 同一判断）。刻意**不观察 attributes**：我们自己就在写属性，观察它会自激。
 */
export function mountBrowserFlagRows(): void {
  if (typeof document === 'undefined') return
  if (unsubscribe === null) {
    // 数据变化也立刻同步一次，别等到下一次 DOM 变动。
    unsubscribe = subscribeBrowserFlag(() => { scheduleSync() })
  }
  if (typeof MutationObserver === 'undefined') {
    scheduleSync()
    return
  }
  if (observer !== null) return
  try {
    observer = new MutationObserver(scheduleSync)
    observer.observe(document.body, { childList: true, subtree: true })
    // 首帧扫一遍：插件可能晚于列表挂载（热重载后列表正开着）。
    scheduleSync()
  } catch {
    observer = null
    scheduleSync()
  }
}

/** 卸载观察器（测试与热重载用）。 */
export function unmountBrowserFlagRows(): void {
  observer?.disconnect()
  observer = null
  unsubscribe?.()
  unsubscribe = null
  scheduled = false
}
