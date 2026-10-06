/**
 * seat.ts — 工作台座位的统一挂载。
 *
 * 侧边栏一个「工作台」菜单行（`sidebar.panellist`），页面在官方 `main` 槽位渲染。
 * 分类导航不在页面里：行上 hover 出浮层、停行滚轮直切（见 ./row-flyout.tsx），
 * 页面顶部只留面包屑。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { registerPanelSeat } from '../panel-seat.js'
import { WorkbenchGridIcon, WorkbenchPanel } from './WorkbenchPanel.js'
import { attachWorkbenchRowFlyout, WORKBENCH_ROW_MARK } from './row-flyout.js'

/** 工作台座位 id */
export const WORKBENCH_PANEL_ID = 'workbench'

/** 挂载统一工作台页面、侧栏菜单行与行上的分类浮层/滚轮行为 */
export function applyWorkbenchSeat(ctx: ClientContext): void {
  ctx.effect(() => registerPanelSeat(ctx, {
    id: WORKBENCH_PANEL_ID,
    label: () => '工作台',
    // 图标槽里带一个标记 span：官方只把本组件当图标渲染，标记供 row-flyout
    // 的委托监听认行（不碰官方行 DOM，官方重渲染也不丢）。
    icon: ({ size }) => createElement('span', {
      style: { display: 'inline-flex', alignItems: 'center' },
      [WORKBENCH_ROW_MARK]: 'true',
    }, createElement(WorkbenchGridIcon, { size })),
    order: 20,
    render: (close) => createElement(WorkbenchPanel, { onClose: close }),
  }), 'dsh-triad: workbench main page + sidebar row')

  ctx.effect(attachWorkbenchRowFlyout, 'dsh-triad: workbench row flyout + wheel switch')
}
