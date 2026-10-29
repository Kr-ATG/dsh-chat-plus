/**
 * nav-sections — 侧栏「工作区 / 操作间」双屏挂载器。
 *
 * ── 用户要的东西（2026-10-25）────────────────────────────────────────
 * 「更多」下面是一行**操作间**菜单；点它 → 工作区（会话浏览区）隐藏、
 * 这一行文字变成**工作区**、下方列出记忆 / SKILL / 用量 / 画廊 / 档案；点这一行
 * → 工作区回来、那五个条目收起。以后加新菜单要方便。
 *
 * ── 实现方式：一张注册表 + 一个切换行 ─────────────────────────────────
 * 侧栏不再有「横滑分类条」这种一次性写死的入口，全部收敛成
 * `./nav-registry.js` 里的两级数据：
 *
 *   区域 section（工作区 / 操作间 / 以后更多）
 *     └ 条目 entry（记忆 / SKILL / 用量 / 画廊 / 档案 / 以后更多）
 *
 * 本文件只做三件事：
 *   1. 在官方 `sidebar.workspaces` 之前插一个 host（= 「更多」下面）；
 *   2. 按注册表渲染**一个切换行** + **当前区域的条目行**；
 *   3. 控制官方工作区的显隐（只打属性、不搬 DOM、不重建）。
 *
 * 切换行文字永远是**下一个区域**的名字：人在工作区时写「操作间」，点一下
 * 就进了操作间、它自己变成「工作区」，再点回来。两个区域时就是 toggle。
 *
 * ── 加新菜单 ─────────────────────────────────────────────────────────
 * `./nav-registry.js` 的 `navMenuItem(...)` 一行搞定，**不需要动本文件**：
 *
 * ```ts
 * ctx.effect(() => navMenuItem({
 *   id: 'tasks', label: '任务', icon: MyIcon, panelId: 'schedule',
 * }), 'dsh-chat-plus: 任务菜单')
 * ```
 *
 * 要再加一整屏（第三个区域）用 `navSection(...)`。本文件里的默认清单只是
 * 「装了什么」，不是「怎么装」。
 *
 * ── 降级 ─────────────────────────────────────────────────────────────
 * 官方 DOM 改版导致 host 挂不上 → 什么都不做，官方「工作台」行照常可见
 * （`data-wb-row-hidden` 只有在本条真的渲染出来之后才打）。
 * rail（56px 折叠）→ 本条整体让位、官方行还原，入口永不丢。
 */

import { useEffect, useLayoutEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { readRail, useRail } from '../sidebar-nav.js'
import { getService } from '../../client-ctx.js'
import { ErrorBoundary } from '../../error-boundary.js'
import { WorkbenchGridIcon } from './WorkbenchPanel.js'
import { useSyncNotice } from './sync-notice.js'
import { useVisibleWorkbenchTabs, WORKBENCH_ROW_MARK, WORKBENCH_TABS, openWorkbench } from './row-flyout.js'
import {
  GALLERY_KIND_LABEL,
  GALLERY_KIND_ORDER,
  readGalleryKind,
  readMemoryScope,
  requestGalleryKind,
  requestMemoryScope,
} from './workbench-intent.js'
import {
  DEFAULT_OFFICIAL_ANCHOR,
  OFFICIAL_SECTION_ID,
  collapseExpandedMenus,
  entriesOfSection,
  focusExpandedMenu,
  navMenuItem,
  navSection,
  nextSectionId,
  orderedNavSections,
  readActiveSection,
  readExpandedMenus,
  resolveActiveChild,
  rotateActiveSection,
  setNavEntryChildren,
  subscribeNav,
  toggleExpandedMenu,
  writeActiveSection,
  writeExpandedMenus,
  type NavChildDef,
  type NavEntryDef,
  type NavSectionDef,
  type NavSectionIcon,
} from './nav-registry.js'
import { fetchWorkspaces, projectsToChildren } from './workspace-source.js'
import {
  clearVaultScene,
  fetchVaultSceneChildren,
  readVaultScene,
  requestVaultScene,
  VAULT_SCENE_EVENT,
} from '../vault/api.js'
import { SceneAccountsIcon } from '../vault/icons.js'

/** host id（本模块创建）。 */
const HOST_ID = 'dsh-sidebar-nav-sections'
/** 插位锚点：官方会话浏览区（本条落点紧贴其上方 = 官方菜单行之下）。 */
const ANCHOR_SELECTOR = '[data-slot="sidebar.workspaces"]'
/** 官方「工作台」行的隐藏属性（本条挂载成功后才打）。 */
const ROW_HIDDEN_ATTR = 'data-wb-row-hidden'
/** 官方区域被本插件隐藏时打的属性（CSS 负责 display:none）。 */
const SECTION_HIDDEN_ATTR = 'data-nav-section-hidden'
/** host 在 rail 下没有内容时打的标记（CSS 收掉它占的那点高度）。 */
const SECTION_EMPTY_ATTR = 'data-nav-host-empty'
/** 锚点等待硬上限（ms）：官方 DOM 大改版时观察器必须自己退出。 */
const ANCHOR_WAIT_MS = 5000

/* ───────────────────────── 默认区域与条目 ───────────────────────── */

/** 「工作区」图标：文件夹（官方会话浏览区就是按工作区分组）。 */
function WorkspaceSectionIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h3.4a1.5 1.5 0 0 1 1.2.6L11.5 6H18a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

/** 操作间图标：与工作台页同一套方阵（语义都是「一堆模块」）。 */
function WorkshopSectionIcon({ size }: { size: number }): JSX.Element {
  return <WorkbenchGridIcon size={size} />
}

/**
 * 默认区域清单。
 *
 * `order` 决定切换顺序：工作区（10）↔ 操作间（20）。两个区域时切换行就是
 * toggle；第三个区域出现后按 order 轮转。
 */
const DEFAULT_SECTIONS: readonly NavSectionDef[] = [
  {
    id: OFFICIAL_SECTION_ID,
    label: '工作区',
    icon: WorkspaceSectionIcon,
    order: 10,
    source: 'official',
    anchor: DEFAULT_OFFICIAL_ANCHOR,
  },
  {
    id: 'workshop',
    label: '操作间',
    icon: WorkshopSectionIcon,
    order: 20,
    source: 'plugin',
  },
]

/**
 * 条目图标：工作台五个分类各一枚线性图标。
 *
 * 与 `row-flyout.tsx` 的 `WorkbenchTabIcon` 同形（那边是浮层用），这里不直接
 * 复用它是因为注册表只接受 `{ size }` 形态的组件，需要一层适配。
 * @param tab - 工作台分类 id。
 * @returns 图标组件。
 */
function tabIcon(tab: (typeof WORKBENCH_TABS)[number]['id']): NavSectionIcon {
  return function TabIcon({ size }: { size: number }): JSX.Element {
    const common = {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
      'aria-hidden': true,
    }
    switch (tab) {
      case 'memory':
        return (
          <svg {...common}>
            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
          </svg>
        )
      case 'skills':
        return (<svg {...common}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>)
      case 'usage':
        return (
          <svg {...common}>
            <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
          </svg>
        )
      case 'gallery':
        return (
          <svg {...common}>
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        )
      case 'vault':
        // 档案 = 带锁的卡片（与 row-flyout 的浮层图标同一枚，免得两处各画一套）
        return (
          <svg {...common}>
            <rect x="3" y="6" width="18" height="14" rx="2.5" />
            <path d="M3 10h18" />
            <path d="M8 15.5h2.5" />
            <path d="M15.5 4v4" />
            <circle cx="15.5" cy="2.5" r="1" />
          </svg>
        )
      case 'prompt':
        // 系统提示词 = 一份带横线的文档：语义是「模型开工前被交代的那张纸」。
        return (
          <svg {...common}>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h4M9 17h6" />
          </svg>
        )
      case 'sync':
        // 同步设置 = 云端同步图标
        return (
          <svg {...common}>
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            <path d="m11 13 2-2 2 2" />
            <path d="M13 11v6" />
          </svg>
        )
    }
  }
}

/**
 * 二级菜单子项图标。
 *
 * 2026-10-25 修正：注册表原先的取舍是「只有固定项画图标、数据驱动的项不画」，
 * 理由是「30px 行高再塞图标会成彩色噪点带」。实际渲染出来是另一个问题 ——
 * 二级行是「图标 + 文字」两段式 flex，**有的行有图标、有的没有**时，没有图标
 * 的那几行文字会整体左移一格，与上面几行对不齐，看着像两组不相干的东西。
 * 所以现在规则改成：**同一组里要么都有图标、要么都没有**。
 *   · 记忆组：全部工作区（层叠）/ 全局记忆（地球）/ 每个工作区（文件夹）都带；
 *   · 画廊组：8 个类别都不带（它们彼此平级且文字自解释，统一无图标更清爽）。
 *
 * 图形语言沿用本文件上面那几个（24 视框 / stroke 1.8 / currentColor），
 * 尺寸由调用方给 13px —— 16px 会把 13px 的文字挤得没有呼吸。
 */
function AllScopesIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 8 4.5-8 4.5-8-4.5Z" />
      <path d="m4 12 8 4.5 8-4.5" />
      <path d="m4 16.5 8 4.5 8-4.5" />
    </svg>
  )
}

/** 全局记忆图标：地球（语义是「跨工作区的公共区」，不是某个项目）。 */
function GlobalScopeIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.4 2.6 3.6 5.6 3.6 9S14.4 18.4 12 21c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z" />
    </svg>
  )
}

/**
 * 「全部工作区」图标：一叠层（表达「跨所有」）。
 *
 * 三枚图标分工：层叠 = 全部工作区、地球 = 全局记忆、文件夹 = 某个具体工作区。
 * 文件夹那枚由**记忆页**在推送真实工作区清单时一起给（它才是这些行的注册方），
 * 侧栏这边不需要另外定义一份 —— 固定项只有前两个，永远用不到第三枚。
 */

/**
 * 「具体工作区」图标：文件夹。
 *
 * 与记忆页里的 `WorkspaceIcon` **必须是同一枚形状**：那边的同名图标用于
 * 「页面自己推送」的那一份（它手上有更准的 entryCount），这边用于「侧栏自己
 * 拉的那一份」。两处画得不一样会让用户在两份数据交替的瞬间看到图标跳变。
 *
 * ⚠ 改了这里记得同步 `memory/Panel.tsx` 的 `WorkspaceIcon`。
 */
function WorkspaceIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h3.4a1.5 1.5 0 0 1 1.2.6L11.5 6H18a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

/**
 * 记忆行的固定子项：全部工作区 / 全局记忆。
 *
 * 这两项与数据无关（任何工作区清单都含这两档），所以带图标、顺序固定在最上面。
 * 真实的工作区（项目）列表随后由**记忆页**用 `setNavEntryChildren` 推过来补齐
 * ——侧栏不自己拉数据：那会和页面各调一次同一个接口，而且首次渲染前是空箭头。
 *
 * 子项 id 与 `MemoryScopeIntent` 天然同构（`all` / `global` / `project:<hash>`），
 * 所以 `run` 只是把 id 原样写成意图，中间不需要任何映射表。
 */
const MEMORY_FIXED_CHILDREN: readonly NavChildDef[] = [
  {
    id: 'all',
    label: '全部工作区',
    icon: AllScopesIcon,
    order: 10,
    run: () => { requestMemoryScope('all') },
  },
  {
    id: 'global',
    label: '全局记忆',
    icon: GlobalScopeIcon,
    order: 20,
    run: () => { requestMemoryScope('global') },
  },
]

/**
 * 画廊类别子项图标：8 个类别各一枚线性图标（与侧栏整体风格保持一致）。
 */
function GalleryKindIcon({ kind, size }: { kind: (typeof GALLERY_KIND_ORDER)[number]; size: number }): JSX.Element {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (kind) {
    case 'image':
      return (
        <svg {...common}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      )
    case 'page':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <circle cx="6.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="9.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="20" height="16" rx="2.5" />
          <path d="m10 9 5 3-5 3V9z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'pdf':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 14h8M8 17h5" />
        </svg>
      )
    case 'slide':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="13" rx="2" />
          <path d="m12 16v5M8 21h8" />
        </svg>
      )
    case 'sheet':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18M9 9v12M15 9v12" />
        </svg>
      )
    case 'doc':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 13h6M9 17h4" />
        </svg>
      )
    case 'audio':
      return (
        <svg {...common}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      )
  }
}

/**
 * 画廊行的子项：8 个类别，顺序与中文名都取 `workbench-intent.ts` 那一份真相
 * （与画廊页的 `KIND_ORDER` 同源，少一个 = 侧栏少一个入口）。
 */
const GALLERY_CHILDREN: readonly NavChildDef[] = GALLERY_KIND_ORDER.map((kind, index) => ({
  id: kind,
  label: GALLERY_KIND_LABEL[kind],
  icon: ({ size }) => <GalleryKindIcon kind={kind} size={size} />,
  order: 10 + index * 10,
  run: () => { requestGalleryKind(kind) },
}))

/**
 * 档案行的固定子项：全部分组。
 *
 * 与记忆那两行同理——这一项与数据无关（任何场景清单都含这一档）。区别是
 * 档案的场景完全由用户定义（能新建、能改名），所以固定项只留「全部分组」，
 * 其余由宿主下发的场景补齐。子项 id 与 readVaultScene() 的返回值同构
 * （`null` = 全部），这里用空串占位并在 run 里调 clearVaultScene 清意图。
 */
const VAULT_FIXED_CHILDREN: readonly NavChildDef[] = [
  {
    id: 'all',
    label: '全部分组',
    icon: SceneAccountsIcon,
    order: 10,
    run: () => { clearVaultScene() },
  },
]

/**
 * 档案场景的三级菜单分组（2026-10-29 用户要求「做三级菜单这样看起来不花眼」）。
 *
 * 场景仍然是用户可增删改的数据；这里只决定侧栏怎么分组展示。分组固定成
 * 「账号与登录 / 支付与联系方式 / 证件与文件」三组，未列出的自定义场景落到
 * 末尾的「其它」叶子项。叶子项的 id 仍是场景 id，因此页面筛选、持久化与原有
 * AI 抽取归集完全不变。
 */
const VAULT_SCENE_GROUPS: ReadonlyArray<{ id: string; label: string; sceneIds: readonly string[] }> = [
  { id: 'account-login', label: '账号与登录', sceneIds: ['accounts', 'email'] },
  { id: 'payment-contact', label: '支付与联系方式', sceneIds: ['payment', 'contact'] },
  { id: 'document-config', label: '证件与文件', sceneIds: ['document', 'configs'] },
]

/** 把一个场景转成三级菜单的叶子项。 */
function vaultSceneLeaf(scene: { id: string; label: string; count: number }, index: number): NavChildDef {
  return {
    id: scene.id,
    label: scene.label,
    order: 10 + index * 10,
    count: scene.count,
    run: () => { requestVaultScene(scene.id) },
  }
}

/** 场景清单 → 三级菜单（分组 + 其它叶子）。 */
function vaultSceneChildren(scenes: Array<{ id: string; label: string; count: number }>): NavChildDef[] {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]))
  const used = new Set<string>()
  const out: NavChildDef[] = []
  let groupOrder = 20
  for (const group of VAULT_SCENE_GROUPS) {
    const members = group.sceneIds
      .map((id) => byId.get(id))
      .filter((scene): scene is { id: string; label: string; count: number } => scene !== undefined)
    if (members.length === 0) continue
    members.forEach((scene) => used.add(scene.id))
    const leaves = members.map((scene, index) => vaultSceneLeaf(scene, index))
    const total = leaves.reduce((sum, leaf) => sum + (leaf.count ?? 0), 0)
    out.push({
      id: 'group-' + group.id,
      label: group.label,
      order: groupOrder,
      ...(total > 0 ? { count: total } : {}),
      run: () => {},
      children: leaves,
    })
    groupOrder += 10
  }
  // 未归入固定分组的场景（用户自建 / 其它）：保持平铺在组之后，不强行塞进某个组。
  const rest = scenes.filter((scene) => !used.has(scene.id))
  rest.forEach((scene, index) => out.push(vaultSceneLeaf(scene, index + groupOrder)))
  return out
}

/** 条目行「有没有二级菜单」那几项字段（行本体与 target 不在这里）。 */
/** 条目行「有没有二级菜单」那几项字段（行本体与 target 不在这里）。 */
type BranchFields = Pick<NavEntryDef, 'children' | 'activeChild'>

/**
 * 哪些条目带二级菜单。
 *
 * 挂在**注册**时而不是渲染时判断，是因为注册表就是唯一真相：渲染层不该知道
 * 「记忆这一行的下级是工作区」这种业务语义，它只按 `children` 画——于是以后
 * 别的模块想加二级菜单，同样只要注册时给 `children`，挂载器一行都不用改。
 *
 * `activeChild` 一律**现算**（读意图模块里的当前值），不在这里存选中态：侧栏
 * 高亮与页面实际筛选因此天生同步，不会出现「侧栏说 PDF、页面显示图片」。
 *
 * 2026-10-25：两个分支都**不再给 `childrenTitle`**（小标题机制已整块删除）。
 * 记忆那行原本压着「工作区」三个字、画廊那行压着「分类」——用户先后点名把它们
 * 都去掉。理由一致：二级菜单本来就只有一组子项，上面那行小标题既不区分任何
 * 东西、又白占 20px 侧栏高度；「全部工作区 / 全局记忆 / Dsh」这些名字自己
 * 已经说得清，不需要一句分组说明。
 */
function branchFields(tab: (typeof WORKBENCH_TABS)[number]['id']): BranchFields {
  switch (tab) {
    case 'memory':
      return {
        children: MEMORY_FIXED_CHILDREN,
        activeChild: () => readMemoryScope(),
      }
    case 'gallery':
      return {
        children: GALLERY_CHILDREN,
        activeChild: () => readGalleryKind(),
      }
    case 'vault':
      // 场景清单是**数据**（用户能新建场景），首帧只有「全部分组」这一项固定项，
      // 真实场景等宿主 `/list` 回来后由 refreshVaultChildren() 推过来。
      return {
        children: VAULT_FIXED_CHILDREN,
        activeChild: () => readVaultScene(),
      }
    default:
      // 返回空对象 = `children` 保持 undefined = 不画箭头。
      // ⚠ 不能给它空数组：空数组的语义是「有下级但此刻没数据」（展开后显示暂无）。
      return {}
  }
}

/**
 * 默认条目清单（全部落在操作间）。
 *
 * 每一项都是「打开工作台的某个分类」——分类本身仍由 `WORKBENCH_TABS`
 * 提供唯一真相，这里只决定**侧栏怎么列出它们**。
 *
 * ⚠ 这份清单只是「装了什么」，不是「怎么装」。加一个新菜单**不需要动本文件**：
 * 在任意模块里 `ctx.effect(() => navMenuItem({ ... }), '...')` 即可，注册表
 * 会自动让侧栏重渲染（见 `./nav-registry.ts` 的 `navMenuItem`）。
 */
function registerDefaultEntries(): Array<() => void> {
  return WORKBENCH_TABS.map((tab, index) => navMenuItem({
    id: `workbench-${tab.id}`,
    label: tab.label,
    icon: tabIcon(tab.id),
    order: 10 + index * 10,
    workbenchTab: tab.id,
    ...branchFields(tab.id),
  }))
}

/**
 * 注册默认区域与条目（幂等：同 id 重复注册直接覆盖）。
 * @returns 注销全部默认注册的函数。
 */
function registerDefaults(): () => void {
  const disposers = [
    ...DEFAULT_SECTIONS.map((section) => navSection({
      id: section.id,
      label: section.label,
      icon: section.icon,
      order: section.order,
      source: section.source,
      anchor: section.anchor,
    })),
    ...registerDefaultEntries(),
  ]
  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* 已回收：忽略 */ }
    }
  }
}

/* ───────────────────────────── 样式 ───────────────────────────── */

const STYLE_ID = 'dsh-sidebar-nav-sections-styles'

/**
 * 行样式：与官方 `panelRow` 同款几何（行高 36 / 圆角 / hover 底色 / 14px 字号）。
 *
 * 宽度扣掉 12px：本 host 的父容器（官方 regionArea）右缘比官方菜单行的父容器
 * 多探出 12px（`margin-right:-inline-padding`），不扣就会比上面几行长出一截。
 */
const SHEET = `
/* 官方「工作台」行：本条挂载成功且处于宽栏时才隐藏（rail 由 JS 还原） */
button[${ROW_HIDDEN_ATTR}='true']{display:none !important}
/* 被切换走的官方区域（会话浏览区）整体隐藏 */
[${SECTION_HIDDEN_ATTR}='true']{display:none !important}

/* host：可收缩（条目多时内部滚动），不做 flex:1 —— 否则条目会把会话区挤走 */
#${HOST_ID}{display:flex;flex-direction:column;flex:0 1 auto;min-height:0;
  width:calc(100% - 12px);box-sizing:border-box;margin:0 0 6px;
  overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
/* rail 折叠态：本插件让位（组件返回 null），别留一条空白占位 */
#${HOST_ID}[${SECTION_EMPTY_ATTR}='true']{display:none}
#${HOST_ID}::-webkit-scrollbar{width:5px}
#${HOST_ID}::-webkit-scrollbar-thumb{background:transparent;border-radius:3px}
#${HOST_ID}:hover::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(127,127,127,.3))}

/* 通用行：官方 panelRow 的几何（x=14 / 图标 x=22 / 行高 36） */
.dsn-row{position:relative;display:flex;align-items:center;gap:8px;box-sizing:border-box;
  width:calc(100% - 4px);min-height:36px;flex:none;margin:0 2px 2px;padding:7px 8px;border:none;
  border-radius:var(--dsw-radius-md,8px);background:transparent;
  color:var(--dsw-alias-label-primary,#e6e6e6);font-family:inherit;font-size:14px;font-weight:400;
  line-height:22px;text-align:left;cursor:pointer;user-select:none;overflow:hidden;
  transition:background 120ms ease}
.dsn-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsn-row:active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dsn-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4d6bfe);
  outline-offset:-2px}
.dsn-row>svg{flex:none;color:var(--dsw-alias-label-secondary,#b0b0b0)}
.dsn-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── 可展开行（有二级菜单的条目）─────────────────────────────────────
   **整行就是开关**（2026-10-25 用户要求：「应该是这一行而不是图标」）。
   所以这里不再切分热区：.dsn-branch-row 本身就是一个 button，撑满整行 36px，
   hover/active/焦点全部打在它身上；右侧箭头只是行里的一个 span（纯装饰、
   pointer-events:none），不接收点击也不进 Tab 序列。 */
.dsn-branch{display:flex;flex-direction:column;flex:none;min-height:0}
.dsn-branch-row{display:flex;align-items:center;gap:8px;box-sizing:border-box;
  width:calc(100% - 4px);min-height:36px;flex:none;margin:0 2px 2px;padding:7px 8px;
  border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;
  color:var(--dsw-alias-label-primary,#e6e6e6);font-family:inherit;font-size:14px;font-weight:400;
  line-height:22px;text-align:left;cursor:pointer;user-select:none;overflow:hidden;
  transition:background 120ms ease}
.dsn-branch-row>svg{flex:none;color:var(--dsw-alias-label-secondary,#b0b0b0)}
.dsn-branch-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsn-branch-row:active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dsn-branch-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4d6bfe);
  outline-offset:-2px}
/* 箭头：纯装饰。收起 ▸ / 展开 ▾（图标只画朝右，靠旋转 90° 表达展开）。 */
.dsn-caret{display:flex;align-items:center;justify-content:center;flex:none;
  width:18px;color:var(--dsw-alias-label-tertiary,#8a8a8a);
  pointer-events:none;user-select:none;transition:color 120ms ease}
.dsn-branch-row:hover .dsn-caret{color:var(--dsw-alias-label-secondary,#b0b0b0)}
.dsn-caret>svg{flex:none;transition:transform 180ms cubic-bezier(.32,.72,0,1)}
.dsn-caret[data-expanded='true']>svg{transform:rotate(90deg)}

/* ── 二级菜单（树状层级） ──────────────────────────────────────────
   1. 导轨垂直线对齐一级图标中心（margin-left: 18px，对齐 16px 图标正中）。
   2. 每个子项行拥有水平分支连接线（.dsn-sub-row::before），形成清晰的 ├── 与 └── 树状分支。
   3. 垂直导轨在最后一行分支处精准收口（bottom: 15px），不拖尾。
   4. 子项行字号 12.5px，紧凑精致；激活项时分支线与图标均亮起主题高亮色。 */
.dsn-sub{display:flex;flex-direction:column;flex:none;min-height:0;margin:1px 0 4px;
  animation:dsn-sub-in 160ms cubic-bezier(.32,.72,0,1)}
/* 三级分组（档案场景：账号与登录 / 支付与联系方式 / 证件与文件） */
.dsn-sub-group{display:flex;flex-direction:column;flex:none}
.dsn-sub-group-row{font-weight:500}
.dsn-sub-caret{display:flex;align-items:center;justify-content:center;flex:none;
  width:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a);
  transition:transform 160ms cubic-bezier(.32,.72,0,1)}
.dsn-sub-caret[data-open='true']{transform:rotate(90deg)}
.dsn-sub-nested{margin:0 0 2px}
.dsn-sub-nested .dsn-rail{margin-left:14px;padding-left:12px}
.dsn-rail{position:relative;display:flex;flex-direction:column;min-height:0;
  margin-left:18px;padding-left:14px}
.dsn-rail::before{content:'';position:absolute;left:0;top:0;bottom:15px;width:1px;
  background:var(--dsw-alias-border-l1,rgba(127,127,127,.2));pointer-events:none}
.dsn-rail:has(.dsn-empty)::before{display:none}
.dsn-sub-row{position:relative;display:flex;align-items:center;gap:7px;box-sizing:border-box;
  width:calc(100% - 4px);min-height:28px;height:28px;flex:none;margin:1px 0;padding:3px 8px;border:none;
  border-radius:var(--dsw-radius-sm,6px);background:transparent;
  color:var(--dsw-alias-label-secondary,#9e9e9e);font-family:inherit;font-size:12.5px;font-weight:400;
  line-height:18px;text-align:left;cursor:pointer;user-select:none;overflow:hidden;
  transition:background 120ms ease,color 120ms ease}
.dsn-sub-row::before{content:'';position:absolute;left:-14px;top:50%;width:10px;height:1px;
  background:var(--dsw-alias-border-l1,rgba(127,127,127,.2));transform:translateY(-50%);
  transition:background 120ms ease;pointer-events:none}
.dsn-sub-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));
  color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsn-sub-row:hover>svg{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsn-sub-row:active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dsn-sub-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4d6bfe);
  outline-offset:-2px}
/* 当前生效的子项：分支线、图标与文字同步激活 */
.dsn-sub-row[data-active='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
  color:var(--dsw-alias-label-primary,#fff);font-weight:500}
.dsn-sub-row[data-active='true']::before{background:var(--dsw-alias-state-business-primary,#4d6bfe);height:1.5px}
.dsn-sub-row>svg{flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a);transition:color 120ms ease}
.dsn-sub-row[data-active='true']>svg{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
/* 窄容器里长工作区名必须能被截断 */
.dsn-sub-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsn-sub-count{flex:none;min-width:14px;padding:1px 5px;border-radius:10px;text-align:center;
  font-size:11px;line-height:14px;font-variant-numeric:tabular-nums;
  background:rgba(127,127,127,.12);color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsn-sub-row[data-active='true'] .dsn-sub-count{background:rgba(77,107,254,.18);
  color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}
/* 空态：children 是空数组时的一行小字 */
.dsn-empty{padding:4px 6px 5px;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,#8a8a8a);opacity:.8;user-select:none}
@keyframes dsn-sub-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}

/* 切换行：与条目行同一套几何，只多一枚右侧方向标（表达「点了会换屏」） */
.dsn-switch{font-weight:500}
.dsn-switch .dsn-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a);
  transition:color 120ms ease,transform 180ms cubic-bezier(.32,.72,0,1)}
.dsn-switch:hover .dsn-chevron{color:var(--dsw-alias-label-secondary,#b0b0b0);transform:translateX(1px)}

/* 切换行与条目行之间的一条发丝线（只有条目存在时才出现） */
.dsn-divider{height:1px;flex:none;margin:2px 10px 5px;
  background:var(--dsw-alias-border-l1,rgba(127,127,127,.16))}

/* 同步/上传小字标签（停留 1 分钟后自动淡出） */
.dsn-sync-tag{display:inline-flex;align-items:center;margin-left:7px;padding:1px 6px;border-radius:999px;
  font-size:11px;line-height:16px;font-weight:550;letter-spacing:0;
  color:#10b981;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.25);
  animation:dsn-tag-in 160ms cubic-bezier(.32,.72,0,1);vertical-align:middle}
@keyframes dsn-tag-in{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}

/* 条目入场：整组淡入上移，避免切换瞬间「啪」地换屏 */
.dsn-entries{display:flex;flex-direction:column;animation:dsn-in 180ms cubic-bezier(.32,.72,0,1)}
@keyframes dsn-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .dsn-row,.dsn-switch .dsn-chevron,.dsn-caret,.dsn-caret>svg,.dsn-sub-row{transition:none}
  .dsn-entries,.dsn-sub{animation:none}
}
`

/** 注入样式（幂等，按内容比对判重——升级后旧 style 也要能换掉）。 */
function ensureSectionStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) {
    if (existing.textContent !== SHEET) existing.textContent = SHEET
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-chat-plus'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/* ───────────────────────── 官方选中态订阅 ───────────────────────── */

/** 官方 layout 的面板选中态最小可读面（HostObservable）。 */
interface PanelInfoSourceLike {
  getSnapshot?: () => { activePanelId?: string | null }
  subscribe?: (fn: () => void) => () => void
}

/** 取 panelInfo 观察源（读不到返回 null，绝不抛）。 */
function panelInfoSource(): PanelInfoSourceLike | null {
  try {
    const layout = getService<{ panelInfo?: PanelInfoSourceLike }>('layout')
    const source = layout?.panelInfo
    if (source === undefined || source === null || typeof source.getSnapshot !== 'function') return null
    return source
  } catch {
    return null
  }
}

/** 当前官方 main 面板 id（未打开任何面板 = null）。 */
function readActivePanelId(): string | null {
  try {
    return panelInfoSource()?.getSnapshot?.().activePanelId ?? null
  } catch {
    return null
  }
}

/**
 * 官方面板「打开 → 关闭」的边沿：回到会话时把侧栏切回工作区。
 *
 * 为什么必须有：操作间里全是工作台入口，用户从操作间点条目进了「记忆」页，
 * 再点「新会话」/ 点侧栏某个会话就离开了面板页——此时侧栏若还停在操作间，
 * 会话列表是不见的，用户会觉得「会话全没了」。边沿触发保证只有**真的从
 * 面板页回到会话**才切回；用户刚点「操作间」时面板 id 一直是 null，不会被弹走。
 */
function useSessionReturnToWorkspaces(): void {
  useEffect(() => {
    const source = panelInfoSource()
    if (source === null || typeof source.subscribe !== 'function') return undefined
    let previous = readActivePanelId()
    return source.subscribe(() => {
      const next = readActivePanelId()
      if (previous !== null && next === null) writeActiveSection(OFFICIAL_SECTION_ID)
      previous = next
    })
  }, [])
}

/* ───────────────────────────── 渲染 ───────────────────────────── */

/** 注册表快照 hook（注册表变更时重渲染）。 */
function useNavVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeNav(() => { setVersion((value) => value + 1) }), [])
  return version
}

/**
 * 点一个条目：按 target 分发（唯一的分发点，加新 kind 只改这里）。
 *
 * ── ⚠ 这里**故意不碰**二级菜单的展开态 ─────────────────────────────
 * 「点一级菜单时收起其它二级菜单」这条规则**不在本函数里**，而在
 * {@link EntryRow} 那个「没有下级的行」的 onClick 里。
 *
 * 原因（2026-10-27 踩过的回归）：本函数有**两个**调用方——
 *   1. 无下级的条目行（用户点一级菜单 → 开页面）；
 *   2. **runChild**（用户点二级子项 → 先收敛展开态再开页面）。
 * 把 `collapseExpandedMenus()` 放这里，第 2 条路会变成
 * 「focusExpandedMenu(本行) → 本函数 → 全收起」，**用户点自己的二级子项时
 * 自己那一组反而被收起来**（实测被用户当场发现：「我点击自己的二级菜单为啥也被收起了」）。
 *
 * 收起动作属于「点一级菜单」这个**手势**，不属于「按 target 分发」这个**动作**——
 * 同一个分发动作在两条手势下的展开态语义相反，就不能写在分发层。
 */
function runEntry(entry: NavEntryDef): void {
  const target = entry.target
  try {
    switch (target.kind) {
      case 'workbench':
        openWorkbench(target.tab)
        return
      case 'panel': {
        getService<{ selectPanel?: (id: string | null) => void }>('layout')
          ?.selectPanel?.(target.panelId)
        return
      }
      case 'custom':
        target.run()
        return
    }
  } catch (error) {
    console.error(`[dsh-chat-plus] 侧栏条目 ${entry.id} 执行失败：`, error)
  }
}

/** 切换行右侧的方向标（表达「点了会换一屏」）。 */
function ChevronIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg className="dsn-chevron" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

/**
 * 可展开行右侧的箭头：收起朝右、展开朝下（靠 CSS 旋转 90°，图标本身只画朝右）。
 *
 * 为什么不直接画两个图标切换：换图标没有过渡，展开/收起时箭头会「啪」地跳；
 * 旋转一个图标则有连续动作，且 reduced-motion 下关掉过渡后依然指向正确。
 */
function CaretIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

/** 子项按 order 排（缺省 100）；稳定排序保留注册顺序，工作区列表不会无故跳位。 */
function orderedChildren(children: readonly NavChildDef[]): NavChildDef[] {
  return [...children].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/**
 * 点一个子项：**先**写筛选意图，**再**打开那一页。
 *
 * 顺序反了就会踩坑：页面挂载时是从意图模块回填初值的，若先打开页面、后写意图，
 * 页面读到的是上一次的旧值，于是「点 PDF 进来看到图片」，要再点一次才对。
 *
 * `run` 是注册方给的（工作区列表还可能来自宿主数据），它抛错不能把整个侧栏带崩
 * ——捕获后只留一条日志，行本身依然可用。
 */
function runChild(entry: NavEntryDef, child: NavChildDef): void {
  try {
    child.run()
  } catch (error) {
    console.error(`[dsh-chat-plus] 侧栏子项 ${entry.id}/${child.id} 执行失败：`, error)
  }
  // 选中一个子项 = 这一组就是「正在用的那一组」：别的行的二级菜单必须收起来
  // （2026-10-26 用户要求「选中某一个二级菜单后其他二级菜单都折叠起来」，
  // 2026-10-27 又明确「点击一级菜单或二级菜单，其他二级收起」）。
  //
  // 不靠 writeExpandedMenus(entry.id, true) 单独兜：那个调用在同一行已是唯一展开项时
  // 直接 return（为的是不白写 localStorage），于是「持久化层残留着别的行 + 本行恰好
  // 也已是展开项」这种半脏状态会留着不动。focusExpandedMenu 是「覆盖成单值并广播
  // 一次」，任何起点都收敛到「只有本行展开」，且中间不会闪一帧全收起。
  focusExpandedMenu(entry.id)
  runEntry(entry)
}

/**
 * 二级菜单本体：一条竖向发丝线隔出的子项列表。
 *
 * 2026-10-25：小标题（`childrenTitle`）机制整块删除。原本这里会先画一行
 * 「工作区」/「分类」的小字再列子项，用户先后点名把那两处都去掉 —— 二级菜单
 * 只有一组子项，小标题既不区分任何东西、又白占 20px 侧栏高度。
 */
function SubMenu({ entry }: { entry: NavEntryDef }): JSX.Element | null {
  const children = entry.children
  // 渲染时再判一次：类型上调用方已经保证有 children，这里只做收敛不抛。
  if (children === undefined) return null
  const active = resolveActiveChild(entry)
  const ordered = orderedChildren(children)
  /**
   * 当前展开的三级分组（只影响档案场景；其它条目没有分组，状态用不到）。
   *
   * 默认展开「当前选中项所在组」：从页面或别处切回侧栏时，高亮的叶子不会
   * 藏在一个收起的组里。用户手动收起后，除非 active 发生变化，否则不再强行
   * 展开——所以 effect 只依赖 active，不依赖整个 children（那个数组每次
   * setNavEntryChildren 都会换引用，会把用户的手动收起冲掉）。
   */
  const [expandedGroup, setExpandedGroup] = useState<string>(() => {
    const group = ordered.find((child) => child.children?.some((leaf) => leaf.id === active))
    return group?.id ?? ''
  })
  useEffect(() => {
    const group = ordered.find((child) => child.children?.some((leaf) => leaf.id === active))
    if (group !== undefined) {
      setExpandedGroup((current) => (current === group.id ? current : group.id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const renderLeaf = (child: NavChildDef): JSX.Element => {
    const ChildIcon = child.icon
    const showCount = typeof child.count === 'number' && child.count > 0
    return (
      <button
        key={child.id}
        type="button"
        className="dsn-sub-row"
        data-active={child.id === active ? 'true' : undefined}
        title={child.hint}
        aria-label={child.label}
        onClick={() => { runChild(entry, child) }}
      >
        {ChildIcon !== undefined ? <ChildIcon size={13} /> : null}
        <span className="dsn-sub-label">{child.label}</span>
        {showCount ? <span className="dsn-sub-count">{child.count}</span> : null}
      </button>
    )
  }

  return (
    <div className="dsn-sub">
      <div className="dsn-rail">
        {ordered.length === 0
          // 空数组 = 有下级但此刻没数据（工作区列表还没推过来），与「没有下级」
          // 是两种状态：后者连箭头都不画，见 NavEntryDef.children 的说明。
          // 文案用中性说法：小标题机制删除后，这里已经拿不到「是工作区还是分类」
          // 这个信息；而空态本身就极少见（只在页面还没挂载过时出现）。
          ? <div className="dsn-empty">暂无内容</div>
          : ordered.map((child) => {
            if (child.children === undefined) return renderLeaf(child)
            const open = expandedGroup === child.id
            const showCount = typeof child.count === 'number' && child.count > 0
            return (
              <div key={child.id} className="dsn-sub-group">
                <button
                  type="button"
                  className="dsn-sub-row dsn-sub-group-row"
                  aria-expanded={open}
                  title={child.hint}
                  aria-label={child.label}
                  onClick={() => { setExpandedGroup(open ? '' : child.id) }}
                >
                  <span className="dsn-sub-caret" data-open={open ? 'true' : undefined}>
                    <CaretIcon size={10} />
                  </span>
                  <span className="dsn-sub-label">{child.label}</span>
                  {showCount ? <span className="dsn-sub-count">{child.count}</span> : null}
                </button>
                {open && (
                  <div className="dsn-sub dsn-sub-nested">
                    <div className="dsn-rail">
                      {child.children.map((leaf) => renderLeaf(leaf))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

/**
 * 一个条目行：没有二级菜单时就是一个按钮；有二级菜单时是**一个整行按钮 + 一枚
 * 纯装饰箭头**。
 *
 * ── 点击语义（2026-10-25 用户要求改过）──────────────────────────────
 * 用户原话：「点击展开和收起的方式不对，应该是这一行而不是图标」。
 *
 * 早先的写法把一行切成两个点击目标：行本体 = 打开页面、右侧 26px 箭头 =
 * 展开/收起。问题在于箭头热区只有 26px 宽、又贴在最右边，实际用起来：
 *   · 想展开就得去够那个很小的图标，点偏一点就变成打开页面跳走了；
 *   · 箭头看着像「行的附属装饰」，没人预期它是唯一能展开的地方；
 *   · 触屏上 26px 低于可点尺寸的常见下限，更容易点错。
 *
 * 现在：**整行点击 = 展开/收起**，箭头只表达状态（不接收点击、不进 Tab 序列）。
 * 想打开那一页，点展开后列出来的具体子项就行 —— 子项点击会先写意图再打开页面，
 * 比「点行跳到默认项」更精确。整行可点也顺带把热区从 26px 扩到一整行 36px，
 * 触屏和鼠标都更好按。
 *
 * ── 手风琴（2026-10-26 用户要求）────────────────────────────────────
 * 用户原话：「当选中某一个二级菜单后其他二级菜单都折叠起来」。
 *
 * 展开是**互斥**的：点开「画廊」时，「记忆」的二级菜单在同一拍里收起。实现不在
 * 这里——`toggleExpandedMenu` 把持久化层覆盖成单值，渲染层只是按「这一行在不在
 * 那个集合里」画（见 ./nav-registry.ts 的 `writeExpandedMenus`）。所以本组件
 * 仍然只看自己那一份 `expanded` 布尔值，不需要知道兄弟行的存在。
 *
 * 为什么不做成「一次点击里先收其它行再展开自己」的显式两步：那样每次都要遍历
 * 全部条目、写多次持久化、再触发多次重渲染，而覆盖单值天然就是互斥的。
 */
function EntryRow({ entry, expanded }: { entry: NavEntryDef; expanded: boolean }): JSX.Element {
  const Icon = entry.icon
  const branch = entry.children !== undefined
  if (!branch) {
    return (
      <button
        type="button"
        className="dsn-row"
        aria-label={entry.label}
        onClick={() => {
          // 点一级菜单 = 离开当前展开的那一组，其它二级菜单让位
          // （2026-10-27 用户要求「操作间点击一级菜单或二级菜单，其他二级收起」）。
          // 只在**这条**手势里收起：runChild 也走 runEntry，但它要保留自己那一组，
          // 所以收起绝不能下沉进 runEntry（见该函数的注释）。
          collapseExpandedMenus()
          runEntry(entry)
        }}
      >
        <Icon size={16} />
        <span className="dsn-label">{entry.label}</span>
      </button>
    )
  }
  return (
    <div className="dsn-branch">
      <button
        type="button"
        className="dsn-row dsn-branch-row"
        // aria-expanded 挂在整行按钮上：它是真正的开关，读屏用户听到的就是这行的状态。
        aria-expanded={expanded}
        aria-label={`${entry.label}（${expanded ? '已展开' : '已收起'}，共 ${entry.children?.length ?? 0} 项）`}
        onClick={() => { toggleExpandedMenu(entry.id) }}
      >
        <Icon size={16} />
        <span className="dsn-label">{entry.label}</span>
        {/* 箭头是**纯装饰**：aria-hidden + 不接收指针事件，状态由上面那行的
            aria-expanded 与图标的旋转共同表达。 */}
        <span className="dsn-caret" aria-hidden="true" data-expanded={expanded ? 'true' : undefined}>
          <CaretIcon size={12} />
        </span>
      </button>
      {expanded ? <SubMenu entry={entry} /> : null}
    </div>
  )
}

/** 侧栏本体：一个切换行 + 当前区域的条目行。 */
function SidebarSections(): JSX.Element | null {
  // 订阅 work.* 七个开关（hook 必须无条件、且在任何条件 return 之前调用）。
  // 侧栏条目与工作台 tab 共用同一份可见性：tab 关掉，这一行入口同一拍消失；
  // 重新打开同一拍回来。切换行「工作区 / 操作间」本身不挂在工作台开关上，
  // 所以即使七个页面全关，双屏导航仍然可用。
  const visibleTabs = useVisibleWorkbenchTabs()
  // version 参与下面的 layout effect 依赖：注册表一改就重新同步一次官方 chrome。
  const version = useNavVersion()
  const rail = useRail()
  const active = readActiveSection()
  const syncNotice = useSyncNotice()
  const sections = orderedNavSections()
  const next = nextSectionId()
  const activeDef = sections.find((section) => section.id === active)
  const isPluginSection = activeDef?.source === 'plugin'
  // 注册表里仍然保留全部 workbench-* 条目（热重载 / 重新打开时不用重建），
  // 渲染时按开关过滤：非 workbench-* 的自定义菜单（未来别的模块注册的）不受影响。
  const visibleEntryIds = new Set(visibleTabs.map(tab => `workbench-${tab.id}`))
  const entries = isPluginSection
    ? entriesOfSection(active ?? '').filter((entry) => !entry.id.startsWith('workbench-') || visibleEntryIds.has(entry.id))
    : []
  // 展开态来自持久化层（用户选的是「记住上次展开状态」）：渲染时现读，
  // 点整行写回后由注册表 notify 触发重渲染，不另存组件 state。
  // 手风琴语义（2026-10-26）：集合里至多一个 id，其余行必然收起。
  const expanded = readExpandedMenus()

  useLayoutEffect(() => {
    // 与挂载器轮询共用同一个决策点（applySectionChrome），两边不会各算一套。
    applySectionChrome(isPluginSection, rail)
  }, [isPluginSection, rail, version])

  // 卸载时把官方 chrome 全部还原：绝不留下被藏起来的官方区域/行。
  useEffect(() => () => { syncOfficialChrome({ hideSection: false, hideRow: false }) }, [])

  useSessionReturnToWorkspaces()

  // rail（56px）放不下一整屏二级导航：本条整体让位，官方行照常可用。
  if (rail) return null
  // 不足两个区域时没有可切的屏，不渲染（避免一个点了没反应的按钮）。
  if (sections.length < 2 || next === null) return null

  const nextDef = sections.find((section) => section.id === next)
  const NextIcon = nextDef?.icon ?? null
  const ActiveLabel = activeDef?.label ?? ''

  return (
    <>
      <button
        type="button"
        className="dsn-row dsn-switch"
        aria-label={`切换到${nextDef?.label ?? next}`}
        aria-expanded={isPluginSection}
        onClick={() => {
          // 换一屏 = 彻底离开当前这一组，二级菜单没有理由继续展开着
          // （2026-10-27 用户要求「操作间点击一级菜单或二级菜单，其他二级收起」）。
          collapseExpandedMenus()
          rotateActiveSection()
        }}
      >
        {NextIcon !== null ? <NextIcon size={16} /> : null}
        <span className="dsn-label">
          {nextDef?.label ?? next}
          {syncNotice && (nextDef?.label === '操作间' || ActiveLabel === '操作间') && (
            <span className="dsn-sync-tag">{syncNotice}</span>
          )}
        </span>
        <ChevronIcon size={14} />
      </button>

      {entries.length > 0 && (
        <>
          <div className="dsn-divider" aria-hidden="true" />
          <div className="dsn-entries" role="group" aria-label={ActiveLabel}>
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} expanded={expanded.has(entry.id)} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

/**
 * 同步官方 chrome：隐藏/显示官方区域、隐藏/显示官方「工作台」行。
 *
 * 只打属性、不搬 DOM：官方 React 重渲染时属性可能被重置，所以每次 `place()`
 * 与每次组件提交都重新同步一次（幂等，值没变时不动 DOM）。
 *
 * **`hideSection` 的语义是「当前活跃区域由本插件渲染，官方区域整块让位」**，
 * 不是「隐藏 id 等于当前活跃 id 的那个官方区域」——当前活跃的是 plugin 区域，
 * 拿它去和 official 区域的 id 比对永远不会相等（踩过：会话树照旧显示）。
 * 官方区域的内容是官方 DOM，插件无法按 section 过滤，所以只要切到 plugin
 * 区域，全部 official 区域一起隐藏；切回任何一个 official 区域则全部还原。
 * @param options - 当前期望的显隐。
 */
function syncOfficialChrome(options: { hideSection: boolean; hideRow: boolean }): void {
  if (typeof document === 'undefined') return
  for (const section of orderedNavSections()) {
    if (section.source !== 'official') continue
    const anchor = document.querySelector(section.anchor ?? DEFAULT_OFFICIAL_ANCHOR)
    if (anchor === null) continue
    if (options.hideSection) anchor.setAttribute(SECTION_HIDDEN_ATTR, 'true')
    else anchor.removeAttribute(SECTION_HIDDEN_ATTR)
  }
  const marked = document.querySelector(`[${WORKBENCH_ROW_MARK}]`)
  const row = marked?.closest('button') ?? null
  if (row === null) return
  if (options.hideRow) row.setAttribute(ROW_HIDDEN_ATTR, 'true')
  else row.removeAttribute(ROW_HIDDEN_ATTR)
}

/* ───────────────────────────── 挂载 ───────────────────────────── */

/** 确保 host 已插到 `sidebar.workspaces` 之前（幂等）。 */
function ensureHostPlaced(): boolean {
  if (typeof document === 'undefined') return false
  const anchor = document.querySelector(ANCHOR_SELECTOR)
  if (anchor === null) return false
  const parent = anchor.parentElement
  if (parent === null) return false
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null
  if (host === null) {
    host = document.createElement('div')
    host.id = HOST_ID
    host.dataset.plugin = 'dsh-chat-plus'
  }
  if (host.parentElement !== parent || host.nextElementSibling !== anchor) {
    parent.insertBefore(host, anchor)
  }
  return true
}

/**
 * 挂载侧栏双屏导航（幂等单例）。返回清理函数交给 `ctx.effect`。
 *
 * 三条就位通道（都在，缺一条就有可见空窗）：
 *  1. 立即 `place()`（插件晚于侧栏渲染时一拍到位）；
 *  2. 锚点未出现时盯 body 子树等它出现（5s 硬超时，官方 DOM 大改版不永久挂载）；
 *  3. 1.5s 低频兜底（父节点被整体替换、HMR、React 重建等观察失联场景）。
 *
 * host 是插进官方 React 树的裸节点，侧栏任何一次 children 重排都可能把它
 * 回收——所以还要盯着 host 的直接父节点补位（只观察 childList，不开 subtree）。
 */
export function attachSidebarSections(): () => void {
  if (typeof document === 'undefined') return () => {}
  ensureSectionStyles()

  const disposeDefaults = registerDefaults()

  /**
   * 自己拉工作区清单并补进「记忆」那一行（**不再等记忆页面推送**）。
   *
   * 踩过的坑（用户报「侧栏会跳一下」「工作区要点了全局记忆才出现」）：工作区
   * 清单原先只由记忆页面在挂载后推过来，于是没进过记忆页时侧栏只有两项固定项，
   * 点进去那一拍才补上真实工作区，侧栏 host 高度实测 512 → 572px 跳一下。
   * 数据源现在归侧栏自己（见 ./workspace-source.ts 的说明）。
   *
   * 失败静默：拉不到就保持两项固定项，侧栏照常可用。
   */
  let disposed = false
  /** 把工作区子项写进注册表（固定项 + 数据项）。 */
  const pushWorkspaceChildren = async (): Promise<void> => {
    const projects = await fetchWorkspaces()
    if (disposed) return
    setNavEntryChildren('workbench-memory', [
      ...MEMORY_FIXED_CHILDREN,
      ...projectsToChildren(
        projects,
        WorkspaceIcon,
        (scope) => { requestMemoryScope(scope as Parameters<typeof requestMemoryScope>[0]) },
      ),
    ])
  }

  /**
   * 把档案场景清单写进「档案」那一行（固定项 + 每个场景一行）。
   *
   * 与工作区同理由侧栏自己拉：等档案页面挂载后再推，会让「没进过档案页」的
   * 用户永远只看到「全部分组」一项。失败**保持原样子项**（不推空数组）——
   * 空数组的语义是「有下级但此刻没数据」，会让人以为场景被删光了。
   */
  const pushVaultChildren = async (): Promise<void> => {
    try {
      const scenes = await fetchVaultSceneChildren()
      if (disposed) return
      setNavEntryChildren('workbench-vault', [
        ...VAULT_FIXED_CHILDREN,
        ...vaultSceneChildren(scenes),
      ])
    } catch {
      // 宿主还没起来 / 路由 404：保持固定项，侧栏照常可用。
    }
  }

  const host = (): HTMLDivElement | null => document.getElementById(HOST_ID) as HTMLDivElement | null
  let root: Root | null = null
  let observer: MutationObserver | undefined
  let observedParent: Element | null = null
  let anchorObserver: MutationObserver | undefined
  let anchorDeadline = 0
  let anchorGaveUp = false

  const render = (): void => {
    const el = host()
    if (el === null) return
    if (root === null) root = createRoot(el)
    root.render(
      <ErrorBoundary label="侧栏导航" fallback={null}>
        <SidebarSections />
      </ErrorBoundary>,
    )
  }

  const stopAnchorWatch = (): void => {
    anchorObserver?.disconnect()
    anchorObserver = undefined
    if (anchorDeadline !== 0) {
      window.clearTimeout(anchorDeadline)
      anchorDeadline = 0
    }
  }

  /**
   * 锚点还没出现时盯 body 子树等它出现。
   *
   * 只在锚点缺失期间挂、5s 硬超时——稳态零开销，官方大改版也不会永久挂在
   * body 上（超时后交回 1.5s 低频轮询兜底）。
   */
  const watchAnchor = (): void => {
    if (anchorGaveUp || anchorObserver !== undefined || typeof MutationObserver === 'undefined') return
    anchorObserver = new MutationObserver(() => { place() })
    anchorObserver.observe(document.body, { childList: true, subtree: true })
    anchorDeadline = window.setTimeout(() => {
      anchorDeadline = 0
      anchorGaveUp = true
      stopAnchorWatch()
    }, ANCHOR_WAIT_MS)
  }

  /** 就位 + 渲染 + 盯父节点 + 同步官方 chrome。 */
  const place = (): void => {
    if (!ensureHostPlaced()) {
      watchAnchor()
      return
    }
    stopAnchorWatch()
    render()
    watchParent()
    // 渲染是异步提交的：这里先按当前注册表状态同步一次，组件自己的 layout
    // effect 提交后会再同步一次（幂等，值没变时不动 DOM）。
    //
    // ⚠ 这里必须自己读一次 rail（不能只依赖组件的 layout effect）：本函数由
    // 1.5s 轮询反复调用，若硬编码 `hideRow: true`，用户折叠侧栏后组件已经把
    // 官方行还回去了，下一拍轮询又会把它藏起来 —— 而 rail 里本插件整体让位，
    // 结果就是**折叠态侧栏一个入口都没有**（实测踩过）。
    applySectionChrome(isPluginSectionActive(), readRailState())
  }

  /** 盯父节点：host 被 React 摘掉立刻补位。 */
  const watchParent = (): void => {
    const el = host()
    const parent = el?.parentElement ?? null
    if (parent === null) return
    if (observer !== undefined && observedParent === parent) return
    observer?.disconnect()
    observedParent = parent
    observer = new MutationObserver(() => {
      const before = host()?.parentElement ?? null
      place()
      if ((host()?.parentElement ?? null) !== before) watchParent()
    })
    observer.observe(parent, { childList: true })
  }

  place()
  // 侧栏自带的工作区数据源：挂载即拉，与「记忆页面有没有被访问过」无关。
  // 只拉一次（不轮询）：工作区清单变动频率极低，而 1.5s 轮询已经在跑。
  void pushWorkspaceChildren()
  // 档案场景同理（侧栏自己拉，不进档案页也要有菜单）。
  void pushVaultChildren()
  // 页面里增删场景后侧栏的计数要跟上：档案页会在场景变动时广播一次场景意图
  // 事件（requestVaultScene / clearVaultScene 都发），这里借它当刷新信号——
  // 比另开一套「场景变了」事件少一条通道，且行为一致（切场景本来就要重算）。
  const onVaultScene = (): void => { void pushVaultChildren() }
  window.addEventListener(VAULT_SCENE_EVENT, onVaultScene)
  const timer = window.setInterval(() => {
    place()
    if (observer === undefined) watchParent()
  }, 1500)

  return () => {
    disposed = true
    window.clearInterval(timer)
    window.removeEventListener(VAULT_SCENE_EVENT, onVaultScene)
    stopAnchorWatch()
    observer?.disconnect()
    observer = undefined
    observedParent = null
    // 卸载即还原官方 chrome：入口交回官方，绝不留下被藏起来的死区域。
    syncOfficialChrome({ hideSection: false, hideRow: false })
    try { disposeDefaults() } catch { /* 已回收：忽略 */ }
    if (root !== null) root.unmount()
    root = null
    host()?.remove()
  }
}

/** 当前活跃区域是否由本插件渲染（即需要隐藏官方区域）。 */
function isPluginSectionActive(): boolean {
  if (typeof document === 'undefined') return false
  const active = readActiveSection()
  return orderedNavSections().find((section) => section.id === active)?.source === 'plugin'
}

/**
 * 读侧栏是否折叠成 rail（同步、不订阅）。
 *
 * 直接用 `sidebar-nav.tsx` 的 `readRail`——rail 判定只留那份真相，两个模块
 * 各写一份选择器迟早会漂移。
 */
function readRailState(): boolean {
  return readRail()
}

/**
 * 按「活跃区域 + 侧栏形态」推导并落实官方 chrome 的显隐。
 *
 * 这是显隐逻辑的**唯一决策点**：组件提交（layout effect）与挂载器轮询
 * （`place()`）都走这里，两边不会各算一套。
 *
 * rail（56px）下本插件整体让位、什么都不渲染，所以官方部分必须全部还原：
 * 官方「工作台」行要回来（那是折叠态唯一入口），官方会话区也不能被藏
 * ——否则折叠态侧栏会空无一物。
 * @param pluginActive - 活跃区域是否由本插件渲染。
 * @param rail - 侧栏是否折叠成 rail。
 */
function applySectionChrome(pluginActive: boolean, rail: boolean): void {
  syncOfficialChrome({
    hideSection: pluginActive && !rail,
    hideRow: !rail,
  })
  // rail 下本组件返回 null（条目与切换行都不渲染），但 host 本身还占着
  // 父容器的布局位（margin-bottom 6px）——不打标记就会在折叠态侧栏顶部留
  // 一条 6px 空白。给它打个「空」标记由 CSS 收掉。
  try {
    const host = document.getElementById(HOST_ID)
    if (host !== null) {
      if (rail) host.setAttribute(SECTION_EMPTY_ATTR, 'true')
      else host.removeAttribute(SECTION_EMPTY_ATTR)
    }
  } catch { /* 忽略：纯视觉优化 */ }
}
