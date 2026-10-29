/**
 * nav-registry — 侧栏「区域（section）」与「菜单条目（entry）」注册表。
 *
 * ── 这套方法解决什么 ─────────────────────────────────────────────────
 * 侧栏原本是「官方面板行 + 一条横滑分类条 + 官方会话区」三块拼图：每加一个
 * 入口都要改挂载器、改样式、改显隐，三处各写一份真相。这里把它收敛成
 * **一张注册表**，侧栏只按表渲染：
 *
 *   · 区域（section）——侧栏当前显示哪一屏，两屏互斥：
 *     `工作区`（内容 = 官方会话浏览区 `sidebar.workspaces`，我们只做显隐）
 *     与 `操作间`（内容 = 本注册表里该区域的条目行，由我们渲染）。
 *   · 条目（entry）——挂在某个区域下的一行菜单，点它打开对应页面。
 *
 * 侧栏只有一个「切换按钮」，文字永远是**下一个区域**的名字：人在工作区
 * 时它写「操作间」，点一下切进操作间、它自己变成「工作区」，再点切回。
 * 两屏场景下就是 toggle；三个以上区域按 `order` 轮转。
 *
 * ── 以后加一个新菜单，只要三步 ──────────────────────────────────────
 *   1. （只有新增区域才需要）
 *      `registerNavSection({ id, label, icon, order, source, anchor? })`
 *      `source: 'official'` = 内容由官方 DOM 提供（只做显隐，anchor 指定
 *      那个官方节点，缺省是会话浏览区）；`source: 'plugin'` = 内容是本
 *      注册表里该区域的条目行。
 *   2. `registerNavEntry({ id, section, label, icon, order, target, children? })`
 *      `target` 三种写法：
 *        `{ kind: 'workbench', tab }` 打开工作台的某个分类（记忆/SKILL/用量/画廊/档案）
 *        `{ kind: 'panel', panelId }` 打开任意官方 main 面板
 *        `{ kind: 'custom', run }`    自定义动作（弹浮层、发命令…）
 *      `children` 给出该行的**二级菜单**（可省略；省略就是一行不可展开的菜单）。
 *   3. 把返回的 dispose 交给 `ctx.effect(...)` 回收，热重载不残留。
 *
 * ── 二级菜单（2026-10-25 用户要求）──────────────────────────────────
 * 「记忆的侧边栏可以放到操作间的记忆菜单下变成二级菜单，画廊的分类也可以
 * 变为二级菜单」——原来长在**页面里**的两组筛选（记忆的工作区/项目、
 * 画廊的 8 个类别）搬到了侧栏，成为所在条目行的下一级：
 *
 *   操作间
 *     └ 记忆   ⌄        ← 点箭头展开，行本体仍然打开记忆页
 *         ├ 全部工作区
 *         ├ 全局记忆
 *         └ D:\AI\Dsh      ← 数据驱动：宿主下发多少个工作区就多少行
 *     └ 画廊   ⌄
 *         ├ 图片 / 网页 / 视频 / PDF / 幻灯片 / 表格 / 文档 / 音频
 *
 * 三条与之配套的机制（都在本模块里）：
 *   · `children` 是**结构**，`setNavEntryChildren()` 是**数据刷新入口**——
 *     记忆的工作区列表由页面侧异步拉取后推给注册表，注册表只管渲染；
 *   · `readActiveChild` / `writeActiveChild`：二级菜单的「当前在哪一项」，
 *     与区域一样持久化（重开界面仍高亮上次那一项）；
 *   · `readExpandedMenus` / `writeExpandedMenus`：**此刻展开的是哪一行**，
 *     同样持久化。语义是**手风琴**（2026-10-26 用户要求「选中某一个二级菜单后
 *     其他二级菜单都折叠起来」）：同一时刻最多只有一行展开，展开 B 就自动收起 A
 *     —— 侧栏高度永远只被一组子项撑开，不会因为展开好几行而越滚越长。
 *
 * 不需要碰任何 DOM、样式或显隐逻辑——挂载器（./nav-sections.tsx）会自己
 * 按注册表重渲染，宽度/滚动/rail 折叠/官方行隐藏全部由它统一处理。
 *
 * 本模块**纯逻辑**：不碰 DOM、不 import 具体组件（图标只是类型），因此
 * 可以直接在 node 里 require 做冒烟断言。
 */

import type { ComponentType } from 'react'
import type { WorkbenchTab } from './WorkbenchPanel.js'

/** 侧栏状态里「当前区域」的持久化键（侧栏宿主与页面共用同一把）。 */
export const NAV_SECTION_STORE = 'dsh-sidebar-active-section'

/**
 * 二级菜单「此刻展开的是哪一行」的持久化键（用户选的是「记住上次展开状态」）。
 *
 * 值是一串逗号分隔的条目 id，但**手风琴语义下正常只会有 0 或 1 个**：旧版本
 * 允许多行同时展开，所以存量数据里可能出现 `memory,gallery` 这种多值——读取
 * 时只认第一个，下次任何一次展开/收起都会顺手把它写回单值。
 */
export const NAV_EXPANDED_STORE = 'dsh-sidebar-expanded-menu'

/** 区域切换广播事件名（跨模块/跨 React 根的唯一通道）。 */
export const NAV_SECTION_EVENT = 'dsh-sidebar-section'

/** 条目缺省所属区域：不写 section 的条目都落在操作间。 */
export const DEFAULT_ENTRY_SECTION = 'workshop'

/** 缺省官方区域 id（官方会话浏览区）。 */
export const OFFICIAL_SECTION_ID = 'workspaces'

/**
 * 官方区域缺省锚点：`sidebar.workspaces` slot。
 *
 * 这个节点在官方 SidebarRoot 的 `regionArea` 里，是本插件唯一能安全「只做
 * 显隐」的官方 DOM——我们不搬它、不重建它，只给它打/摘一个隐藏属性。
 */
export const DEFAULT_OFFICIAL_ANCHOR = '[data-slot="sidebar.workspaces"]'

/**
 * 图标组件形态：注册表只要求「给个尺寸、画一个 svg」。
 *
 * 官方侧栏按 `size` 渲染图标（宽栏 16 / 折叠 rail 18），自绘条目同样是
 * 16px——所以注册表不需要知道任何颜色/布局，颜色由行样式统一 `currentColor`。
 */
export type NavSectionIcon = ComponentType<{ size: number }>

/** 条目点击行为。 */
export type NavEntryTarget =
  /** 打开工作台并落在指定分类（记忆 / SKILL / 用量 / 画廊 / 档案）。 */
  | { readonly kind: 'workbench'; readonly tab: WorkbenchTab }
  /** 打开任意官方 main 面板（`ctx.layout.selectPanel(panelId)`）。 */
  | { readonly kind: 'panel'; readonly panelId: string }
  /** 自定义动作：弹浮层、发命令、开外链…… 由注册方自己负责。 */
  | { readonly kind: 'custom'; readonly run: () => void }

/**
 * 二级菜单的一个子项。
 *
 * 与 `NavEntryDef` 的区别是**没有 section / target.kind**：子项永远挂在某
 * 一个条目行下，点击行为由那一行决定「打开哪一页」，子项只负责「那一页里
 * 看哪一批」。所以它的 `run` 是唯一的动作形态（写意图 + 持久化）。
 */
export interface NavChildDef {
  /** 行内唯一 id（同一父行下不重复即可；持久化键会带上父行 id）。 */
  readonly id: string
  /** 行文字（工作区名 / 类别名 / 「全部工作区」…）。 */
  readonly label: string
  /**
   * 子项图标（可省略）。
   *
   * 二级菜单的行高只有 30px、左边距已经推进去一级，再塞图标会挤成一条
   * 彩色噪点；只有「全部 / 全局」这种**与具体数据无关的固定项**才给图标，
   * 数据驱动的项（工作区、类别）默认不画。
   */
  readonly icon?: NavSectionIcon
  /** 行顺序（缺省 100）。 */
  readonly order?: number
  /** 行尾的小数字（工作区条目数 / 类别项数；缺省不显示，0 也不显示）。 */
  readonly count?: number
  /** 点击动作：切到这一项（分组行可为空操作，见 children）。 */
  readonly run: () => void
  /** 悬停提示（工作区路径这类长文本走这里，不上屏）。 */
  readonly hint?: string
  /**
   * 该子项自己的下一级（三级菜单；目前档案场景分组使用）。
   *
   * 省略 = 普通叶子项；给出数组 = 分组行，点行只展开/收起，不执行 run。
   * 之所以不另造一套 Group 类型：分组与叶子在侧栏里是同一列行，只是有无下级，
   * 复用同一个数组最省渲染分支，也不会让「全部工作区」这类固定项被迫升级成组。
   */
  readonly children?: readonly NavChildDef[]
}

/** 侧栏区域定义。 */
export interface NavSectionDef {
  /** 全局唯一 id（同一 id 重复注册 = 覆盖，热重载安全）。 */
  readonly id: string
  /** 区域名。切换按钮上显示的是**下一个**区域的名字。 */
  readonly label: string
  /** 区域图标（切换按钮与 rail 态共用，官方按 size 渲染）。 */
  readonly icon: NavSectionIcon
  /** 轮转顺序（小的在前；缺省 100）。 */
  readonly order?: number
  /**
   * 内容来源：
   *  - `official`：内容由官方 DOM 提供，本插件只负责隐藏/显示（缺省）；
   *  - `plugin`：内容是本注册表里该区域的条目行，由挂载器渲染。
   */
  readonly source?: 'official' | 'plugin'
  /** `source: 'official'` 时要显隐的官方节点（缺省 = 会话浏览区）。 */
  readonly anchor?: string
}

/** 侧栏菜单条目定义。 */
export interface NavEntryDef {
  /** 全局唯一 id（同一 id 重复注册 = 覆盖）。 */
  readonly id: string
  /** 所属区域 id（缺省 `workshop` = 操作间）。 */
  readonly section?: string
  /** 行文字。 */
  readonly label: string
  /** 行图标。 */
  readonly icon: NavSectionIcon
  /** 行顺序（缺省 100）。 */
  readonly order?: number
  /** 点击行为。 */
  readonly target: NavEntryTarget
  /**
   * 该行的二级菜单（可省略 = 不可展开）。
   *
   * 空数组与省略**不同**：省略 = 这一行没有下级（不画箭头）；空数组 =
   * 有下级但此刻没数据（画箭头、展开后显示「暂无」）。记忆的工作区列表在
   * 首次拉取完成前就是空数组。
   */
  readonly children?: readonly NavChildDef[]
  /**
   * 该行的二级菜单此刻高亮哪一项（可省略 = 不高亮）。
   *
   * **不在注册表里另存一份选中态**：选中项的真相只有一个，就是子项自己写进
   * 持久化层的那份意图（`workbench-intent.ts` 的 readMemoryScope /
   * readGalleryKind）。注册表只提供一个「怎么算出来」的函数，渲染时现算——
   * 于是侧栏高亮与页面里的实际筛选天生同步，不会出现「侧栏说 PDF、页面显示
   * 图片」这类两套状态的经典分叉。
   * @returns 当前生效的子项 id；null = 没有高亮项。
   */
  readonly activeChild?: () => string | null
}

/** 注册表变更监听器。 */
export type NavListener = () => void

/** 区域表（id → 定义）。 */
const sections = new Map<string, NavSectionDef>()
/** 条目表（id → 定义）。 */
const entries = new Map<string, NavEntryDef>()
/** 变更监听器。 */
const listeners = new Set<NavListener>()

/** 内存里的当前区域（首次读取时从 localStorage 回填）。 */
let activeId: string | null = null
/** 是否已经从持久化层读过（避免反复读 localStorage）。 */
let hydrated = false

/** 读持久化层（隐私模式 / node 环境返回 null）。 */
function readStored(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(NAV_SECTION_STORE)
    return value === null || value === '' ? null : value
  } catch {
    return null
  }
}

/** 写持久化层（失败静默：无痕模式只是不记住偏好）。 */
function writeStored(id: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(NAV_SECTION_STORE, id)
  } catch { /* 忽略写入失败 */ }
}

/** 读任意持久化键（二级菜单的展开态与选中项共用这一对工具函数）。 */
function readPref(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(key)
    return value === null || value === '' ? null : value
  } catch {
    return null
  }
}

/** 写任意持久化键（空串 = 删掉这个键）。 */
function writePref(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (value === '') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* 忽略写入失败 */ }
}

/** 通知全部监听器（注册/切换都走这里，渲染与逻辑不分叉）。 */
function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[dsh-chat-plus] sidebar nav listener failed:', error)
    }
  }
}

/** 广播切换事件（跨 React 根 / 跨模块；无 window 时静默）。 */
function broadcast(id: string): void {
  try {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<string>(NAV_SECTION_EVENT, { detail: id }))
  } catch { /* 忽略广播失败 */ }
}

/**
 * 注册一个侧栏区域。
 * @param def - 区域定义。
 * @returns 注销函数（只在仍是自己的定义时才删除，被覆盖后是 no-op）。
 */
export function registerNavSection(def: NavSectionDef): () => void {
  sections.set(def.id, def)
  notify()
  return () => {
    if (sections.get(def.id) !== def) return
    sections.delete(def.id)
    notify()
  }
}

/**
 * 注册一条侧栏菜单。
 * @param def - 条目定义。
 * @returns 注销函数（只在仍是自己的定义时才删除）。
 */
export function registerNavEntry(def: NavEntryDef): () => void {
  entries.set(def.id, def)
  notify()
  return () => {
    if (entries.get(def.id) !== def) return
    entries.delete(def.id)
    notify()
  }
}

/** 订阅注册表与切换状态的变化。 */
export function subscribeNav(listener: NavListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/* ───────────────────── 便捷注册器（加菜单就靠这几个） ───────────────────── */
/**
 * 最常用的一条：把一个「打开某页面」注册成操作间里的菜单行。
 *
 * 这就是「以后加新菜单」的入口——绝大多数新菜单都是「点一下、打开某个页面」，
 * 用这个函数一行就够，不用记 section/target 那套结构：
 *
 * ```ts
 * // 示例：加一个「任务」菜单，打开官方 schedule 面板
 * ctx.effect(() => navMenuItem({
 *   id: 'tasks',
 *   label: '任务',
 *   icon: MyTasksIcon,
 *   panelId: 'schedule',
 * }), 'dsh-chat-plus: 任务菜单')
 *
 * // 加一个工作台新标签页：
 * ctx.effect(() => navMenuItem({
 *   id: 'gallery-2',
 *   label: '画廊',
 *   icon: MyGalleryIcon,
 *   workbenchTab: 'gallery',
 * }), 'dsh-chat-plus: 画廊菜单')
 * ```
 * @param options - 菜单定义。
 * @returns 注销函数（交给 `ctx.effect` 回收）。
 */
export function navMenuItem(options: {
  /** 全局唯一 id（同 id 重复注册 = 覆盖，热重载安全）。 */
  id: string
  /** 行文字。 */
  label: string
  /** 行图标。 */
  icon: NavSectionIcon
  /** 所属区域（缺省 = 操作间）。 */
  section?: string
  /** 行顺序（缺省 100；工作台五个条目占 10–50）。 */
  order?: number
  /** 打开官方 main 面板（与 panelId 二选一）。 */
  panelId?: string
  /** 打开工作台的某个分类（与 panelId 二选一）。 */
  workbenchTab?: WorkbenchTab
  /** 自定义动作（与上面两个三选一）。 */
  run?: () => void
  /** 二级菜单子项（省略 = 不可展开；空数组 = 可展开但暂无数据）。 */
  children?: readonly NavChildDef[]
  /** 二级菜单此刻高亮哪一项（缺省不高亮）。 */
  activeChild?: () => string | null
}): () => void {
  const target: NavEntryTarget = options.run !== undefined
    ? { kind: 'custom', run: options.run }
    : options.workbenchTab !== undefined
      ? { kind: 'workbench', tab: options.workbenchTab }
      : { kind: 'panel', panelId: options.panelId ?? options.id }
  return registerNavEntry({
    id: options.id,
    section: options.section ?? DEFAULT_ENTRY_SECTION,
    label: options.label,
    icon: options.icon,
    order: options.order ?? 100,
    target,
    children: options.children,
    activeChild: options.activeChild,
  })
}

/**
 * 把某一行的二级菜单换成新的子项（**数据驱动行的唯一刷新入口**）。
 *
 * 记忆的工作区列表是异步拉的：侧栏先渲染「全部工作区 / 全局」这两行固定项，
 * 宿主回来项目清单后再调本函数补上。只换 children，不动行本身（图标、order、
 * 点击行为都保留），因此不会打断正在展开的那一行。
 *
 * 传 `undefined` = 这一行不再有二级菜单（箭头消失）。
 * @param entryId - 条目行 id。
 * @param children - 新子项；`undefined` 表示取消二级菜单。
 * @returns 是否命中并更新了这一行（行不存在时 false，不抛）。
 */
export function setNavEntryChildren(
  entryId: string,
  children: readonly NavChildDef[] | undefined,
): boolean {
  const current = entries.get(entryId)
  if (current === undefined) return false
  entries.set(entryId, { ...current, children })
  notify()
  return true
}

/**
 * 换掉某一行的「当前高亮项算法」（与 `setNavEntryChildren` 配对使用）。
 *
 * 数据驱动的行（记忆的工作区）在子项刷新后，高亮算法可能也要跟着换（例如
 * 工作区被删、需要回落到「全部工作区」）。传 `undefined` = 不高亮。
 * @param entryId - 条目行 id。
 * @param activeChild - 新的高亮算法。
 * @returns 是否命中并更新了这一行。
 */
export function setNavEntryActiveChild(
  entryId: string,
  activeChild: (() => string | null) | undefined,
): boolean {
  const current = entries.get(entryId)
  if (current === undefined) return false
  entries.set(entryId, { ...current, activeChild })
  notify()
  return true
}

/**
 * 再加一整屏：注册一个新区域（侧栏就多一个可切换的屏）。
 *
 * 只有「要新增一屏」才需要用到；只是加菜单用 `navMenuItem` 就够了。
 * 新区域默认 `source: 'plugin'`（内容 = 该区域的条目行），要接管某个官方
 * 区域则传 `source: 'official'` + `anchor`。
 * @param options - 区域定义。
 * @returns 注销函数（交给 `ctx.effect` 回收）。
 */
export function navSection(options: {
  /** 全局唯一 id。 */
  id: string
  /** 区域名（切换行上显示的就是它）。 */
  label: string
  /** 区域图标。 */
  icon: NavSectionIcon
  /** 轮转顺序（缺省 100）。 */
  order?: number
  /** 内容来源（缺省 plugin）。 */
  source?: 'official' | 'plugin'
  /** official 源要显隐的官方节点（缺省 = 会话浏览区）。 */
  anchor?: string
}): () => void {
  return registerNavSection({
    id: options.id,
    label: options.label,
    icon: options.icon,
    order: options.order ?? 100,
    source: options.source ?? 'plugin',
    anchor: options.anchor,
  })
}

/** 按 order 排好序的区域表（order 相同的保持注册顺序）。 */
export function orderedNavSections(): NavSectionDef[] {
  return [...sections.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/** 某个区域下的条目（按 order 排序）。 */
export function entriesOfSection(sectionId: string): NavEntryDef[] {
  return [...entries.values()]
    .filter((entry) => (entry.section ?? DEFAULT_ENTRY_SECTION) === sectionId)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/**
 * 读当前区域 id。
 *
 * 三级来源：内存 → localStorage → 第一个区域的 id。存的值若已不存在
 * （区域被删掉、插件升级改了 id）自动回落到第一个区域，不会卡在空白态。
 * @returns 当前区域 id；注册表为空时返回 null。
 */
export function readActiveSection(): string | null {
  const list = orderedNavSections()
  if (list.length === 0) return null
  if (!hydrated) {
    hydrated = true
    activeId = readStored()
  }
  if (activeId !== null && list.some((section) => section.id === activeId)) return activeId
  activeId = list[0].id
  return activeId
}

/**
 * 切到指定区域（写入持久化层 + 广播 + 通知）。
 * @param id - 目标区域 id；不存在的 id 直接忽略。
 */
export function writeActiveSection(id: string): void {
  const list = orderedNavSections()
  if (!list.some((section) => section.id === id)) return
  if (activeId === id) return
  activeId = id
  hydrated = true
  writeStored(id)
  broadcast(id)
  notify()
}

/**
 * 当前区域的「下一个」区域 id（按 order 轮转）。
 *
 * 切换按钮的文字就是它——用户看到的是**点下去会去哪**，而不是现在在哪。
 * @returns 下一个区域 id；不足两个区域时返回 null（没有可切的目标）。
 */
export function nextSectionId(): string | null {
  const list = orderedNavSections()
  if (list.length < 2) return null
  const current = readActiveSection()
  const index = Math.max(0, list.findIndex((section) => section.id === current))
  return list[(index + 1) % list.length].id
}

/** 直接切到下一个区域（切换按钮的唯一动作）。 */
export function rotateActiveSection(): void {
  const next = nextSectionId()
  if (next !== null) writeActiveSection(next)
}

/* ─────────────────── 二级菜单：展开态与选中项 ─────────────────── */

/**
 * 读某一行二级菜单当前高亮的子项 id（现算，不另存状态）。
 *
 * 唯一真相是条目自己给的 `activeChild()`（它去读 workbench-intent 里那份
 * 持久化意图）。本函数只多做一道收敛：返回的 id 必须真的还在 children 里
 * ——工作区被删除、类别改名之后，高亮自动消失而不是指着一个不存在的项。
 * @param entry - 条目定义。
 * @returns 高亮的子项 id；没有则 null。
 */
export function resolveActiveChild(entry: NavEntryDef): string | null {
  const children = entry.children
  if (children === undefined || children.length === 0 || entry.activeChild === undefined) return null
  let id: string | null = null
  try {
    id = entry.activeChild()
  } catch {
    return null
  }
  if (id === null) return null
  return children.some((child) => child.id === id) ? id : null
}

/**
 * 读「此刻展开的是哪一行」的二级菜单（**手风琴：至多一行**）。
 *
 * 持久化格式仍是一串逗号分隔的条目 id——不用 JSON 是因为它要能容忍人工改写 /
 * 半截写入：解析失败就当没展开过，不会让侧栏整个挂掉。
 *
 * 但**只有第一个有效 id 会被认**：旧版本允许多行同时展开，存量数据里可能有
 * `memory,gallery`；若照旧全部认下来，升级后第一帧就会把所有行一起撑开，
 * 与手风琴语义直接打架。取第一个即可——用户随后任何一次展开/收起都会把
 * 持久化层写回单值，脏数据自己就没了。
 * @returns 展开中的条目 id 集合（元素数恒为 0 或 1，且只含仍有下级的行）。
 */
export function readExpandedMenus(): ReadonlySet<string> {
  const saved = readPref(NAV_EXPANDED_STORE)
  if (saved === null) return new Set()
  for (const raw of saved.split(',')) {
    const id = raw.trim()
    if (id === '') continue
    const entry = entries.get(id)
    // 行被删 / 升级后不再有下级：这类陈旧 id 直接丢弃，继续看下一个。
    if (entry === undefined || entry.children === undefined) continue
    return new Set([id])
  }
  return new Set()
}

/**
 * 展开/收起某一行的二级菜单（持久化 + 通知）。
 *
 * **展开是互斥的**（手风琴）：展开某一行时不需要逐个删掉其它行，直接把这行的
 * id **覆盖**成唯一值——其余行在同一拍里一起收起，侧栏高度只被一组子项撑开。
 * 收起只对自己生效：收一行不会连带收别的行（别的行此刻本来就没展开）。
 * @param entryId - 父条目行 id。
 * @param expanded - true 展开（并收起其它行），false 收起。
 */
export function writeExpandedMenus(entryId: string, expanded: boolean): void {
  const stored = readPref(NAV_EXPANDED_STORE) ?? ''
  if (expanded) {
    const entry = entries.get(entryId)
    // 没有下级就没有「展开」这回事（不存在的行同理）：写进去也永远读不回来，
    // 干脆不写，免得持久化层里留下一条读不出来、却会盖掉旧值的幽灵 id。
    if (entry?.children === undefined) return
    // 比较的是**持久化层原文**而不是解析结果：存着 `memory,gallery` 这种旧版多值时，
    // 展开 memory 也必须真写一次（把多值收敛成单值），否则脏数据会一直留着。
    if (stored === entryId) return
    writePref(NAV_EXPANDED_STORE, entryId)
    notify()
    return
  }
  // 收起：清掉自己这一项。不是当前展开项时，把持久化层收敛成「仍然有效的那一个」
  // （旧版多值 + 收起非首项的情况），值没变就完全不碰 DOM、不触发重渲染。
  const current = readExpandedMenus()
  const next = current.has(entryId) ? '' : ([...current][0] ?? '')
  if (stored === next) return
  writePref(NAV_EXPANDED_STORE, next)
  notify()
}

/**
 * 直接翻转某一行的展开态（点整行时的唯一动作）。
 *
 * 手风琴语义下这个动作只有两种结果：展开它（并收起别的所有行）/ 收起它。
 * @param entryId - 父条目行 id。
 */
export function toggleExpandedMenu(entryId: string): void {
  const entry = entries.get(entryId)
  if (entry?.children === undefined) return
  writeExpandedMenus(entryId, !readExpandedMenus().has(entryId))
}

/**
 * 收起**全部**二级菜单（把展开态清空）。
 *
 * 与 {@link writeExpandedMenus}(id, false) 的区别：那个只收自己这一行，别的行本来
 * 就没展开；这个不看是哪一行，直接把「此刻展开着的那一组」收掉。
 *
 * 什么时候需要它：用户点了一个**不产生二级菜单选中态**的目标 —— 区域切换行
 * （工作区 ⇄ 操作间）、以及没有下级的普通条目行。这两种点击都意味着「我要去别处」，
 * 语义与「选中某个子项」同级，所以其它二级菜单必须让位（2026-10-27 用户要求
 * 「操作间点击一级菜单或二级菜单，其他二级收起」）。
 *
 * 已经是收起态时**一个字节都不写**：不碰 localStorage、不 notify、不触发重渲染。
 * 侧栏每次点击都先调它，抖动代价必须为零。
 */
export function collapseExpandedMenus(): void {
  if ((readPref(NAV_EXPANDED_STORE) ?? '') === '') return
  writePref(NAV_EXPANDED_STORE, '')
  notify()
}

/**
 * 把展开态**一次性**收敛成指定的那一行（空串 = 全部收起）。
 *
 * 与「先 collapse 再 write」的区别只有一个，但很要紧：**只 notify 一次**。
 * 两者都是同步写 localStorage，所以最终值一样；差别在于中间那一帧 —— 先收起会
 * 广播一次「此刻没有任何行展开」，渲染层当场重渲染成全收起，紧接着展开又广播一次。
 * 用户在点二级子项的那一刻能看到这一下闪烁（子项列表闪一下再回来）。
 *
 * 所以凡是「已经知道最终要展开哪一行」的路径都走这里；只有真正不知道该展开谁
 * （点一级条目 / 切区域 / 只是要清空）时才用 {@link collapseExpandedMenus}。
 * @param entryId - 要保留为唯一展开项的行 id；空串 = 全部收起。
 */
function setExpandedMenu(entryId: string): void {
  const stored = readPref(NAV_EXPANDED_STORE) ?? ''
  if (stored === entryId) return
  if (entryId !== '') {
    const entry = entries.get(entryId)
    // 没有下级的行不能被「展开」——与 writeExpandedMenus 同一条约束。
    if (entry?.children === undefined) return
  }
  writePref(NAV_EXPANDED_STORE, entryId)
  notify()
}

/**
 * 展开某一行并**同时**收起其它行，一次广播完成。
 *
 * 供「点二级子项」这类已经确定最终态的路径使用：内部等价于
 * `collapseExpandedMenus() + writeExpandedMenus(id, true)`，但不会闪一帧。
 * @param entryId - 目标行 id。
 */
export function focusExpandedMenu(entryId: string): void {
  setExpandedMenu(entryId)
}

/**
 * 清空注册表与状态（**仅供冒烟测试**：node 里重复 require 时复位）。
 *
 * 运行时代码不要调它——那会让侧栏失去全部菜单。
 */
export function resetNavRegistryForTests(): void {
  sections.clear()
  entries.clear()
  listeners.clear()
  activeId = null
  hydrated = false
  writePref(NAV_EXPANDED_STORE, '')
}
