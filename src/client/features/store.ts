/**
 * dsh-chat-plus — 组件开关的客户端镜像（所有功能门共用）。
 *
 * 真相在宿主：插件页面「包含的组件」每一行的「运行中」开关直接改 cordis
 * loader entry 的 disabled 字段。客户端不参与写，只做两件事：
 *
 *   · **首帧**：localStorage 里上一轮读到的组件状态先顶上，避免刷新时先按
 *     全开画一遍再闪成用户关掉的样子；
 *   · **同步**：每 2 秒 + 窗口聚焦时 GET /api/chat-flow/components，把宿主
 *     当前的行状态折进 store；组件行被拨动后，界面最迟 2 秒内跟着消失/出现。
 *
 * 为什么用轮询而不是 WebSocket：DSH 的插件管理页操作本身不是高频动作，2 秒
 * 延迟完全可接受；轮询失败也只是保持上一次状态（不闪、不弹窗），比长连接
 * 的失败恢复简单得多。
 *
 * 所有 UI 组件通过 useFeature('view.panel-memory') 这类**细粒度 id** 订阅；
 * store 内部用 FEATURE_COMPONENT 把它翻译成组件行状态。这样组件行少而稳，
 * 代码侧仍然可以按功能粒度写判断。
 *
 * @module
 */

import { useSyncExternalStore } from 'react'
import { COMPONENTS, componentOfFeature, type ComponentId } from '../../shared/components.ts'

/** localStorage 键（缓存上一轮组件状态）。 */
export const COMPONENTS_STORAGE_KEY = 'dsh.chat_plus.components.v1'

/** 宿主路由。 */
export const COMPONENTS_ROUTE = '/api/chat-flow/components'
/** 兼容旧名（部分冒烟脚本按 FEATURES_ROUTE 断言）。 */
export const FEATURES_ROUTE = COMPONENTS_ROUTE

/** 同步状态。 */
export type FeatureSyncStatus = 'local' | 'syncing' | 'synced' | 'offline'

/** 对外快照（稳定引用，只有真变化时才换对象）。 */
export interface FeatureSnapshot {
  /** 组件 id → 是否启用。 */
  readonly values: Record<string, boolean>
  readonly updatedAt: number
  readonly status: FeatureSyncStatus
  readonly error: string | null
}

/** 默认组件状态（全部按定义默认值；正常情况下全是 true）。 */
function defaultValues(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const component of COMPONENTS) out[component.id] = component.defaultEnabled
  return out
}

/** 只保留已知组件 id 的 boolean，缺失补默认值。 */
export function normalizeComponentStates(raw: unknown): Record<string, boolean> {
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const out: Record<string, boolean> = {}
  for (const component of COMPONENTS) {
    const value = source[component.id]
    out[component.id] = typeof value === 'boolean' ? value : component.defaultEnabled
  }
  return out
}

/** 读 localStorage 缓存。 */
function readStored(): { values: Record<string, boolean>; updatedAt: number } {
  try {
    if (typeof localStorage === 'undefined') return { values: defaultValues(), updatedAt: 0 }
    const raw = localStorage.getItem(COMPONENTS_STORAGE_KEY)
    if (raw === null) return { values: defaultValues(), updatedAt: 0 }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      values: normalizeComponentStates(parsed.values),
      updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
    }
  } catch {
    return { values: defaultValues(), updatedAt: 0 }
  }
}

/** 写 localStorage（失败只影响下次首帧，不影响本次会话）。 */
function writeStored(values: Record<string, boolean>, updatedAt: number): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(COMPONENTS_STORAGE_KEY, JSON.stringify({ values, updatedAt }))
  } catch { /* 隐私模式 / 存储满：忽略 */ }
}

/** 当前状态。 */
let state: FeatureSnapshot = (() => {
  const stored = readStored()
  return { values: stored.values, updatedAt: stored.updatedAt, status: 'local', error: null }
})()

/** 稳定快照缓存。 */
let snapshotCache: FeatureSnapshot = state

/** 订阅者集合。 */
const listeners = new Set<() => void>()

/** 发布新快照（只在内容变化时换对象）。 */
function publish(next: Partial<FeatureSnapshot>): void {
  const values = next.values ?? state.values
  const updatedAt = next.updatedAt ?? state.updatedAt
  const status = next.status ?? state.status
  const error = next.error === undefined ? state.error : next.error
  state = { values, updatedAt, status, error }
  snapshotCache = state
  for (const listener of listeners) {
    try {
      listener()
    } catch (error2) {
      console.error('[dsh-chat-plus] component store listener failed:', error2)
    }
  }
}

/** 读快照（useSyncExternalStore 的 getSnapshot）。 */
export function getFeatureSnapshot(): FeatureSnapshot {
  return snapshotCache
}

/** 订阅变化。 */
export function subscribeFeatures(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 同步取一个细粒度功能是否开启（映射到组件行状态）。 */
export function featureEnabledNow(featureId: string): boolean {
  const componentId = componentOfFeature(featureId)
  return state.values[componentId] !== false
}

/** 同步取一个组件是否开启。 */
export function componentEnabledNow(componentId: ComponentId): boolean {
  return state.values[componentId] !== false
}

/** React hook：订阅单个细粒度功能。 */
export function useFeature(featureId: string): boolean {
  return useSyncExternalStore(
    subscribeFeatures,
    () => featureEnabledNow(featureId),
    () => featureEnabledNow(featureId),
  )
}

/** React hook：订阅单个组件。 */
export function useComponent(componentId: ComponentId): boolean {
  return useSyncExternalStore(
    subscribeFeatures,
    () => componentEnabledNow(componentId),
    () => componentEnabledNow(componentId),
  )
}

/** React hook：订阅整份快照。 */
export function useFeatureSnapshot(): FeatureSnapshot {
  return useSyncExternalStore(subscribeFeatures, getFeatureSnapshot, getFeatureSnapshot)
}

/** 是否已启动（幂等）。 */
let started = false
/** 轮询定时器。 */
let timer: ReturnType<typeof setInterval> | null = null
/** 是否正在请求（防止 2 秒间隔内叠加请求）。 */
let inflight = false

/** 拉一次宿主状态。 */
async function refresh(): Promise<void> {
  if (inflight) return
  // 页面隐藏时跳过轮询：切到后台还每 2 秒打一次请求没有意义；切回来时
  // visibilitychange 监听会立刻补一次，状态不会停在旧值上。
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  inflight = true
  try {
    const response = await fetch(COMPONENTS_ROUTE, { headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json() as { ok?: boolean; values?: Record<string, unknown>; updatedAt?: number }
    if (payload.ok !== true || typeof payload.values !== 'object' || payload.values === null) {
      throw new Error('invalid response')
    }
    const values = normalizeComponentStates(payload.values)
    const updatedAt = typeof payload.updatedAt === 'number' ? payload.updatedAt : Date.now()
    writeStored(values, updatedAt)
    publish({ values, updatedAt, status: 'synced', error: null })
  } catch (error) {
    // 宿主旧版 / 页面还在启动：保持上一轮状态，只标 offline。绝不因为网络
    // 失败把组件全部关掉（那会让界面突然清空）。
    publish({ status: 'offline', error: error instanceof Error ? error.message : String(error) })
  } finally {
    inflight = false
  }
}

/**
 * 启动同步：先发一次，之后每 2 秒一次；窗口聚焦时补一次（切回页面能立刻
 * 看到用户在插件页刚拨的开关，不用等下一个 tick）。
 */
export function bootstrapFeatures(): void {
  if (started) return
  started = true
  void refresh()
  if (typeof window !== 'undefined') {
    if (timer === null) timer = setInterval(() => { void refresh() }, 2000)
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('focus', () => { void refresh() })
      document?.addEventListener?.('visibilitychange', () => {
        if (document.visibilityState === 'visible') void refresh()
      })
    }
  }
}

/** 供冒烟断言：默认组件状态。 */
export { COMPONENTS, componentOfFeature }
export type { ComponentId }
