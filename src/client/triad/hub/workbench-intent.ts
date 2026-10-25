/**
 * workbench-intent — 侧栏二级菜单 → 工作台页面内部筛选项的「意图」通道。
 *
 * ── 为什么需要它（2026-10-25 用户要求）──────────────────────────────────
 * 「记忆的侧边栏可以放到操作间的记忆菜单下变成二级菜单，画廊的分类也可以
 * 变为二级菜单」。落地之后导航只有一个真相（侧栏），而**页面内部的筛选**
 * 必须能跟着侧栏走：
 *
 *   · 记忆页：原 212px 左侧栏（首页 / 全部 / 变更 / 修订 / 回收站 / 设置 +
 *     项目 + 分类）整条删除，项目（工作区）选择搬进侧栏二级菜单；
 *   · 画廊页：类别芯片（图片 / 网页 / 视频 / PDF / 幻灯片 / 表格 / 文档 /
 *     音频）搬进侧栏二级菜单。
 *
 * 侧栏与页面是两个互不相邻的 React 根（侧栏是插进官方 DOM 的裸节点，
 * 页面在官方 `main` 槽位），没有任何共同祖先，也没有共享的 context。所以
 * 「侧栏点一行 → 已经打开的那个页面切到那一批」只能走一条独立通道：
 *
 *   · **localStorage** —— 页面还没挂载（或已卸载）时，挂载时回填；
 *   · **window 自定义事件** —— 页面已经挂载时原地切换，不必重开。
 *
 * ── 与 WORKBENCH_TAB_EVENT 的分工（别合并）─────────────────────────────
 * `row-flyout.ts` 的 `WORKBENCH_TAB_EVENT` 回答「打开工作台的**哪一页**」；
 * 本文件回答「已经打开的那一页里看**哪一批**」。合并成一个事件会让「切页」
 * 与「页内筛选」互相覆写（打开画廊时被记忆的 scope 事件抢先改一遍），
 * 所以刻意分成两条。
 *
 * ── 再加一种意图只要两步 ────────────────────────────────────────────
 *   1. 在 `WorkbenchIntent` 里加一个判别式成员；
 *   2. 照抄 `readMemoryScope` / `requestMemoryScope` 那三行加一对。
 * 页面侧统一用 `subscribeWorkbenchIntent` 订阅，不需要各自挂 window 监听。
 *
 * 本模块**纯逻辑**：不碰 DOM 结构、不 import 任何组件（`GalleryKind` 是
 * type-only，编译后消失），因此 node 里可以直接 import 做冒烟断言。
 */

import type { GalleryKind } from '../gallery/api.js'

/** 意图广播事件名（跨 React 根 / 跨模块的唯一通道）。 */
export const WORKBENCH_INTENT_EVENT = 'dsh-workbench-intent'

/** 记忆页当前工作区（scope）的持久化键。 */
export const MEMORY_SCOPE_STORE = 'dsh-workbench-memory-scope'

/** 画廊页当前类别的持久化键。 */
export const GALLERY_KIND_STORE = 'dsh-workbench-gallery-kind'

/**
 * 记忆页的作用域筛选值。
 *
 * 与 `memory/Panel.tsx` 内部的 `ScopeFilter` 同构（那边是面板私有类型，
 * 这里复制的是一份**通讯协议**而不是实现）：`'all'` 全部 / `'global'`
 * 全局记忆 / `project:<hash>` 某个工作区。
 */
export type MemoryScopeIntent = 'all' | 'global' | `project:${string}`

/** 一条意图。判别式 `kind` 决定 payload 形状（加新意图就往这里加成员）。 */
export type WorkbenchIntent =
  /** 记忆页切到某个工作区。 */
  | { readonly kind: 'memory-scope'; readonly scope: MemoryScopeIntent }
  /** 画廊页切到某个类别。 */
  | { readonly kind: 'gallery-kind'; readonly galleryKind: GalleryKind }

/** 画廊类别的展示顺序（与 `gallery/GalleryPanel.tsx` 的 KIND_ORDER 同源）。 */
export const GALLERY_KIND_ORDER: readonly GalleryKind[] = [
  'image', 'page', 'video', 'pdf', 'slide', 'sheet', 'doc', 'audio',
]

/** 画廊类别的中文名（与 `gallery/api.ts` 的 KIND_LABEL 同源）。 */
export const GALLERY_KIND_LABEL: Readonly<Record<GalleryKind, string>> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  page: '网页',
  pdf: 'PDF',
  slide: '演示',
  sheet: '表格',
  doc: '文档',
}

/** 缺省记忆作用域（没有任何持久化时）。 */
export const DEFAULT_MEMORY_SCOPE: MemoryScopeIntent = 'all'

/** 缺省画廊类别（没有任何持久化时）。 */
export const DEFAULT_GALLERY_KIND: GalleryKind = 'image'

/** 变更监听器。 */
export type WorkbenchIntentListener = () => void

/** 监听器集合（订阅方：记忆页与画廊页各一枚）。 */
const listeners = new Set<WorkbenchIntentListener>()

/** 最近一次收到的意图（纯内存：给「事件早于监听器注册」那一拍兜底）。 */
let lastIntent: WorkbenchIntent | null = null

/** 读持久化层（隐私模式 / node 环境返回 null）。 */
function readStored(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(key)
    return value === null || value === '' ? null : value
  } catch {
    return null
  }
}

/** 写持久化层（失败静默：无痕模式只是不记住偏好）。 */
function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch { /* 忽略写入失败 */ }
}

/** 通知全部监听器（同一 React 树内的订阅方）。 */
function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[dsh-chat-plus] workbench intent listener failed:', error)
    }
  }
}

/** 广播意图（跨 React 根；无 window 时静默）。 */
function broadcast(intent: WorkbenchIntent): void {
  lastIntent = intent
  try {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<WorkbenchIntent>(WORKBENCH_INTENT_EVENT, { detail: intent }))
  } catch { /* 忽略广播失败 */ }
}

/* ───────────────────── 记忆：工作区（scope） ───────────────────── */

/** 读当前记忆工作区（持久化回填，非法值回落 'all'）。 */
export function readMemoryScope(): MemoryScopeIntent {
  const saved = readStored(MEMORY_SCOPE_STORE)
  if (saved === null) return DEFAULT_MEMORY_SCOPE
  if (saved === 'all' || saved === 'global') return saved
  if (saved.startsWith('project:')) return saved as MemoryScopeIntent
  return DEFAULT_MEMORY_SCOPE
}

/** 请求记忆页切到某个工作区（写持久化 + 广播 + 通知）。 */
export function requestMemoryScope(scope: MemoryScopeIntent): void {
  writeStored(MEMORY_SCOPE_STORE, scope)
  broadcast({ kind: 'memory-scope', scope })
  notify()
}

/* ───────────────────── 画廊：类别（kind） ───────────────────── */

/** 读当前画廊类别（持久化回填，非法值回落 'image'）。 */
export function readGalleryKind(): GalleryKind {
  const saved = readStored(GALLERY_KIND_STORE)
  if (saved === null) return DEFAULT_GALLERY_KIND
  return GALLERY_KIND_ORDER.includes(saved as GalleryKind)
    ? saved as GalleryKind
    : DEFAULT_GALLERY_KIND
}

/** 请求画廊页切到某个类别（写持久化 + 广播 + 通知）。 */
export function requestGalleryKind(galleryKind: GalleryKind): void {
  if (!GALLERY_KIND_ORDER.includes(galleryKind)) return
  writeStored(GALLERY_KIND_STORE, galleryKind)
  broadcast({ kind: 'gallery-kind', galleryKind })
  notify()
}

/* ───────────────────────── 订阅面 ───────────────────────── */

/**
 * 订阅意图变化。
 *
 * 同时挂两条线：本模块的监听器集合（同树内），以及 window 事件（跨根）。
 * 页面组件只需要订阅这一个函数，不必关心意图是从哪条线过来的。
 * @param listener - 任何意图变化时调用。
 * @returns 取消订阅函数。
 */
export function subscribeWorkbenchIntent(listener: WorkbenchIntentListener): () => void {
  listeners.add(listener)
  let onWindow: (() => void) | null = null
  try {
    if (typeof window !== 'undefined') {
      onWindow = () => { listener() }
      window.addEventListener(WORKBENCH_INTENT_EVENT, onWindow)
    }
  } catch { /* 无 window：只走本地监听器 */ }
  return () => {
    listeners.delete(listener)
    if (onWindow !== null) {
      try {
        window.removeEventListener(WORKBENCH_INTENT_EVENT, onWindow)
      } catch { /* 忽略移除失败 */ }
    }
  }
}

/** 读最近一次广播的意图（没有则 null，仅供诊断与冒烟）。 */
export function readLastIntent(): WorkbenchIntent | null {
  return lastIntent
}

/**
 * 清空监听器、最近意图与持久化层（**仅供冒烟测试**）。
 *
 * 运行时代码不要调它——那会让侧栏与页面失去同步。
 */
export function resetWorkbenchIntentForTests(): void {
  listeners.clear()
  lastIntent = null
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(MEMORY_SCOPE_STORE)
      localStorage.removeItem(GALLERY_KIND_STORE)
    }
  } catch { /* 忽略清理失败 */ }
}
