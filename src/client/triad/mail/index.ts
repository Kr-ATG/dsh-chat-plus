/**
 * dsh-mail client 半身入口：侧边栏导航行 + 邮箱工作台面板。
 *
 * 与记忆/用量/技能三个入口并列，挂在 sidebar-nav 的 `mail` 槽位（独立一行）。
 * 数据全部走 host 半身的 `/api/dsh-mail/*`（loopback-only 同源 fetch），
 * 不引任何 DSH 内部服务、不改 DSH 源码。
 *
 * 独立 try/catch：邮箱挂载失败不影响本插件其余能力。
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MailNavApp } from './Entry.js'
import { ensureNavMount } from '../sidebar-nav.js'

export { MailPanel, MailIcon, type MailPanelProps } from './Panel.js'
export { MailNavApp } from './Entry.js'
export { createMailApi, MailApiError } from './api.js'
export type { MailApi, MailConfigView, MailDetailView, MailSummaryView, MailWriteOutcome } from './api.js'
export { sanitizeMailHtml, sanitizeCss, wrapMailHtml } from './sanitize.js'

/** 挂载邮箱导航行与面板。 */
export function applyMailClient(ctx: ClientContext): void {
  ctx.effect(() => {
    ensureNavMount()
    // React 根挂在游离容器上（React 18 支持容器后入树）；实际 UI 经 portal
    // 落到 sidebar-nav 的 mail 槽位 div。
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(createElement(MailNavApp))
    return () => { root.unmount() }
  }, 'dsh-mail: nav entry')
}
