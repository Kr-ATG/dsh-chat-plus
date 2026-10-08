/**
 * seat.ts — 工作台座位的统一挂载。
 *
 * 侧边栏一个「工作台」菜单行（`sidebar.panellist`），页面在官方 `main` 槽位渲染。
 *
 * 2026-10 v4 导航定稿（用户：「分类在工作台菜单这里变成一行可滚动显示的，直接把
 * 工作台菜单给替换掉，然后页面里面不需要这样展示分类」）：
 *  - 那一行菜单的**位置**交给横滑分类条（./strip.tsx）——宽栏下条出六格，官方行
 *    被隐藏（属性标记，随时可还原）；rail 折叠态条让位，官方图标列照常可用；
 *  - 页内不再有任何分类切换器（悬浮 Dock / 面包屑 tab 全删）；
 *  - 官方 panellist 座位照旧注册（selectPanel 语义、选中态、快捷键归官方），
 *    条挂不上时那一行自动显示——入口永不丢。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { registerPanelSeat } from '../panel-seat.js'
import { WorkbenchGridIcon, WorkbenchPanel } from './WorkbenchPanel.js'
import { attachWorkbenchRowFlyout, WORKBENCH_ROW_MARK, WORKBENCH_PANEL_ID } from './row-flyout.js'
import { attachWorkbenchStrip } from './strip.js'

/** 挂载统一工作台页面、侧栏菜单行与横滑分类条 */
export function applyWorkbenchSeat(ctx: ClientContext): void {
  ctx.effect(() => registerPanelSeat(ctx, {
    id: WORKBENCH_PANEL_ID,
    label: () => '工作台',
    // 图标槽里带一个标记 span：官方只把本组件当图标渲染，标记供 strip /
    // row-flyout 的委托监听认行（不碰官方行 DOM，官方重渲染也不丢）。
    icon: ({ size }) => createElement('span', {
      style: { display: 'inline-flex', alignItems: 'center' },
      [WORKBENCH_ROW_MARK]: 'true',
    }, createElement(WorkbenchGridIcon, { size })),
    order: 20,
    render: (close) => createElement(WorkbenchPanel, { onClose: close }),
  }), 'dsh-triad: workbench main page + sidebar row')

  // 横滑分类条：替换官方那一行的视觉，宽栏隐藏官方行 / rail 还原
  ctx.effect(attachWorkbenchStrip, 'dsh-triad: workbench sidebar strip')

  // 滚轮直切语义保留在官方行上（rail 态与条未挂载时的兜底入口）
  ctx.effect(attachWorkbenchRowFlyout, 'dsh-triad: workbench row flyout + wheel switch')
}
