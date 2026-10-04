/**
 * seat.ts — 4 合 1 工作台座位的统一挂载。
 *
 * 将原先分散在侧边栏的 4 个入口（记忆、能力、用量、邮箱）合并为一个
 * 统一的「工作台」菜单行（`sidebar.panellist`），页面在官方 `main` 槽位渲染。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { registerPanelSeat } from '../panel-seat.js'
import { WorkbenchGridIcon, WorkbenchPanel } from './WorkbenchPanel.js'

/** 工作台座位 id */
export const WORKBENCH_PANEL_ID = 'workbench'

/** 挂载统一工作台页面与侧边栏单一「工作台」菜单行 */
export function applyWorkbenchSeat(ctx: ClientContext): void {
  ctx.effect(() => registerPanelSeat(ctx, {
    id: WORKBENCH_PANEL_ID,
    label: () => '工作台',
    icon: ({ size }) => createElement(WorkbenchGridIcon, { size }),
    order: 20,
    render: (close) => createElement(WorkbenchPanel, { onClose: close }),
  }), 'dsh-triad: workbench main page + sidebar row')
}
