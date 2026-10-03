/**
 * skills-seat — 技能与 MCP 工作台的座位装配。
 *
 * 页面本体（`SkillsPanel`）走官方 `main` 槽位 + `sidebar.panellist` 菜单行，
 * 与记忆 / 邮箱两个工作台同一套（`../panel-seat.tsx`）；2026-10-04 之前这里是
 * 一条自绘的 `.dsh-nav-btn` 导航行 + portal 到 body 的 drawer 抽屉。
 *
 * 菜单行文案与原导航行保持一致（「能力」）；图标沿用那枚线性闪电（Feather zap，
 * 与记忆 / 邮箱的自绘图标同款描边）。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { SkillsPanel } from './dashboard/SkillsPanel'
import { registerPanelSeat } from '../panel-seat'

/** 座位 id：main 的 key 与 sidebar.panellist 的 id。 */
export const SKILLS_PANEL_ID = 'skills'

/** 菜单行图标（Feather zap 线性风）。 */
function ZapIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  )
}

/** 挂载技能工作台页面与侧边栏菜单行。 */
export function applySkillsSeat(ctx: ClientContext): void {
  ctx.effect(() => registerPanelSeat(ctx, {
    id: SKILLS_PANEL_ID,
    label: () => '能力',
    icon: ZapIcon,
    order: 25,
    render: (close) => createElement(SkillsPanel, { onClose: close }),
  }), 'skills: main page + sidebar row')
}
