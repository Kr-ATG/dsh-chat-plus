/**
 * dsh-chat-plus — Seeker 右栏「操作面板」卡的展示开关（纯客户端呈现偏好）。
 *
 * 与「总结卡外框」「工具调用卡」同族：一个字都不进 prompt，host 那头没有消费者，
 * 所以走 localStorage 而不是 host 状态表 —— 拨完刷新页面即生效，不用重启 DSH
 * （仓库先例：tool-calls-visible、reply-card-chrome、kr-chat-store 的面板宽度）。
 *
 * 与构建期开关 KR_PLAIN_TIMELINE_CARD_VISIBLE 的关系是**叠加**：构建开关 false 时
 * 整卡连组件都不渲染（隐藏而非删除的语义不变）；构建开关 true 时本开关决定右栏
 * 滚动区里那张卡显不显示。默认开 —— 这张卡是大盘里唯一一张「讲人话」的卡，
 * 关掉它等于右栏只剩技术台账，那是刻意的选择而不是默认态。
 *
 * 生效方式不走 body 属性：消费者只有 KrAgentPanel 一个 React 组件，
 * useSyncExternalStore 订阅即可，不需要全局 CSS 钩子。
 */

/** localStorage 键（跨刷新保留）。 */
const STORAGE_KEY = 'dsh.chat_plus.plain_timeline_visible'

/** 当前值（true = 显示操作面板卡）。 */
let visible = true

/** 重入短路：install 可能被热重载再调一次，监听只绑一份。 */
let installed = false

/** 订阅者（组件用 useSyncExternalStore 接）。 */
const listeners = new Set<() => void>()

/** 从 localStorage 读取（读不到 / 被禁用 / 脏值 → 默认 true）。 */
function readStored(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // 只认显式的 '0' / '1'：脏值一律回默认，不把随机字符串当成某种意图。
    if (raw === '0') return false
    if (raw === '1') return true
    return true
  } catch {
    // 隐私模式 / 存储被禁时 getItem 会抛，读取失败按默认处理。
    return true
  }
}

/** 读当前值（useSyncExternalStore 的 getSnapshot）。 */
export function plainTimelineVisible(): boolean {
  return visible
}

/** 订阅变化（useSyncExternalStore 的 subscribe）。 */
export function subscribePlainTimelineVisible(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('[plain-timeline-visible] listener error', error)
    }
  }
}

/** 写值：落盘 + 通知订阅者。 */
export function setPlainTimelineVisible(next: boolean): void {
  if (visible === next) return
  visible = next
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // 落盘失败只影响「刷新后还记得吗」，本次会话内的显隐照常生效。
    }
  }
  notify()
}

/**
 * 初始化：读盘 + 跟随别的窗口的改动。在插件 apply 时调用一次。
 * `storage` 事件只在其它窗口/标签页改动时触发；同窗口的改动由
 * setPlainTimelineVisible 自己负责广播。
 */
export function installPlainTimelineVisible(): void {
  visible = readStored()
  if (installed) return
  installed = true
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return
      const next = readStored()
      if (next === visible) return
      visible = next
      notify()
    })
  }
}
