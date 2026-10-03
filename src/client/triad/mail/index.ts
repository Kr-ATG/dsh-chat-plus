/**
 * dsh-mail client 半身入口：官方 `main` 工作台页 + 侧边栏「全局面板」菜单行
 * （`sidebar.panellist`）。
 *
 * 与记忆/能力两个工作台同一套座位（`../panel-seat.tsx`）：菜单行本体、图标槽、
 * hover / 选中态、rail 折叠态全由官方 SidebarRoot 渲染，点击走
 * `ctx.layout.selectPanel('mail')`，页面渲染在 `[data-slot="main"]` 里，与官方
 * 「自动化任务」页完全同座位。
 *
 * 数据全部走 host 半身的 `/api/dsh-mail/*`（loopback-only 同源 fetch），
 * 不引任何 DSH 内部服务、不改 DSH 源码。
 *
 * 独立 try/catch：邮箱挂载失败不影响本插件其余能力。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MailIcon, MailPanel } from './Panel.js'
import { createMailApi } from './api.js'
import { registerPanelSeat } from '../panel-seat.js'

export { MailPanel, MailIcon, type MailPanelProps } from './Panel.js'
export { createMailApi, MailApiError } from './api.js'
export type { MailApi, MailConfigView, MailDetailView, MailSummaryView, MailWriteOutcome } from './api.js'
export { sanitizeMailHtml, sanitizeCss, wrapMailHtml } from './sanitize.js'

/** 座位 id：main 的 key 与 sidebar.panellist 的 id。 */
export const MAIL_PANEL_ID = 'mail'

/** 挂载邮箱工作台页面与侧边栏菜单行。 */
export function applyMailClient(ctx: ClientContext): void {
  // api 单例：slots 的 inject 函数每次渲染都会调用，若每次返回新对象，
  // 面板里依赖 api 的 useCallback / useEffect 会随渲染重建并重发请求。
  // createMailApi 是无状态 fetch 包装，单例安全。
  const api = createMailApi()
  ctx.effect(() => registerPanelSeat(ctx, {
    id: MAIL_PANEL_ID,
    label: () => '邮箱',
    icon: MailIcon,
    order: 30,
    render: (close) => createElement(MailPanel, { api, onClose: close }),
  }), 'dsh-mail: main page + sidebar row')
}
