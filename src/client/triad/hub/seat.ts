/**
 * seat.ts — 工作台座位的统一挂载。
 *
 * 侧边栏一个「工作台」菜单行（`sidebar.panellist`），页面在官方 `main` 槽位渲染。
 *
 * 2026-10-25 导航定稿（用户：「更多下面应该是一个操作间菜单，点了隐藏工作区、
 * 文字变成工作区，下面显示记忆/SKILL/用量/画廊；再点回来……做一套方法，以后
 * 加新菜单也方便」）：
 *
 *  - 侧栏二级导航整块交给 `./nav-sections.tsx`（区域 + 条目注册表驱动）；
 *    横滑分类条（`./strip.tsx`）已删除——它把四个入口平铺在侧栏，正是用户
 *    这次要收进「操作间」里的东西；
 *  - 官方 panellist 座位照旧注册（selectPanel 语义、选中态、快捷键归官方）。
 *    **本行在宽栏下由 nav-sections 隐藏**（`data-wb-row-hidden`），rail 折叠态
 *    还原——那里放不下一整屏二级导航，官方图标行是唯一入口；
 *  - 页内不再有任何分类切换器，分类切换只在「操作间」里的条目行上。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { registerPanelSeat } from '../panel-seat.js'
import { WorkbenchGridIcon, WorkbenchPanel } from './WorkbenchPanel.js'
import { attachWorkbenchRowFlyout, WORKBENCH_ROW_MARK, WORKBENCH_PANEL_ID } from './row-flyout.js'
import { attachSidebarSections } from './nav-sections.js'

/** 挂载统一工作台页面、侧栏菜单行与「工作区 / 操作间」双屏导航。 */
export function applyWorkbenchSeat(ctx: ClientContext): void {
  ctx.effect(() => registerPanelSeat(ctx, {
    id: WORKBENCH_PANEL_ID,
    label: () => '工作台',
    // 图标槽里带一个标记 span：官方只把本组件当图标渲染，标记供 nav-sections /
    // row-flyout 的委托监听认行（不碰官方行 DOM，官方重渲染也不丢）。
    icon: ({ size }) => createElement('span', {
      style: { display: 'inline-flex', alignItems: 'center' },
      [WORKBENCH_ROW_MARK]: 'true',
    }, createElement(WorkbenchGridIcon, { size })),
    order: 20,
    render: (close) => createElement(WorkbenchPanel, { onClose: close }),
  }), 'dsh-triad: workbench main page + sidebar row')

  // 侧栏双屏导航（工作区 ⇄ 操作间）：区域与条目全由 ./nav-registry.ts 驱动，
  // 加新菜单只注册条目，不改挂载器。
  ctx.effect(attachSidebarSections, 'dsh-triad: sidebar sections (workspaces / workshop)')

  // rail 折叠态官方行只剩图标，hover 浮层与滚轮直切仍作兜底入口保留。
  ctx.effect(attachWorkbenchRowFlyout, 'dsh-triad: workbench row flyout + wheel switch')
}
