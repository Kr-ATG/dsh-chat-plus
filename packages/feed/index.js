/**
 * dsh-chat-plus — 动态（组件行）。
 *
 * 这是一个 **host-only 的标记插件**：它本身不注册任何服务、不挂任何 UI。
 * 存在的唯一意义是让 DSH 插件页面「包含的组件」列表多出一行、并带上官方
 * 原生的「运行中」开关（cordis.patch.yml 里的一条 insert）。
 *
 * 真正的功能由主入口 dsh-chat-plus 统一实现；主入口的
 * GET /api/chat-flow/components 会读取本 entry 的 disabled 字段，把这一行
 * 的开关状态告诉浏览器侧，从而让对应的 UI / 宿主能力一起停用。
 *
 * 为什么要一个空插件而不是直接在主入口里做开关：原生行开关只能改 loader
 * entry；没有独立 entry 就没有独立开关。空插件的开销约等于零（一个 fiber
 * 与一次空 apply），换来的是插件页面完全原生的组件列表。
 *
 * @module
 */

/** Cordis 插件名（仅用于诊断）。 */
export const name = 'dsh-chat-plus-feed'

/** 空装配：这一行只作为开关存在。 */
export function apply() {}
