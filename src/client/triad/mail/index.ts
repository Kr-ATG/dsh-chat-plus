/**
 * dsh-mail client 半身入口 —— 纯导出面。
 *
 * 2026-10 入口搬迁：邮箱曾经是统一工作台里的第 6 个分类（官方 `main` 页 +
 * `sidebar.panellist` 菜单行，由 registerPanelSeat 装配）。现在它在 **Seeker
 * 顶栏齿轮右侧的邮件按钮** + 视口居中的只读卡片里（`src/client/kr-chat/mail-drawer.tsx`
 * 直接 import 本文件的 `MailPanel` 与 `createMailApi`），工作台里已无邮件分类。
 *
 * 所以本文件只剩「导出面」这一件事：原来的 `applyMailClient`（registerPanelSeat
 * 装配）已随入口搬迁一并成为死代码 —— 全仓无调用，留着只会让人以为还有第二
 * 个入口。`MAIL_PANEL_ID` 常量只被那个函数用（座位 id），一并删除。
 *
 * 数据全部走 host 半身的 `/api/dsh-mail/*`（loopback-only 同源 fetch），
 * 不引任何 DSH 内部服务、不改 DSH 源码。
 */

export { MailPanel, MailIcon, type MailPanelProps } from './Panel.js'
export { createMailApi, MailApiError } from './api.js'
export type { MailApi, MailConfigView, MailDetailView, MailSummaryView, MailWriteOutcome } from './api.js'
export { sanitizeMailHtml, sanitizeCss, wrapMailHtml } from './sanitize.js'
