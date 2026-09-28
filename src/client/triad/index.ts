/**
 * dsh-triad client 半身（搬迁进 dsh-chat-plus，三工作台融合）。
 *
 * 挂载三个模块，每个独立 try/catch，一个失败不拖垮其他：
 *
 *  - memory     → sidebar nav row + panel + composer inject toggle
 *  - usage      → sidebar nav row + workbench（usage / trend / accounts / signal）
 *  - skills     → sidebar nav row + panel + `/` slash source + skill tool row
 *
 * 定时自动化（原 automation 模块）已于 2026-09-28 删除：官方
 * `@deepseek-ai/dsh-experimental-schedule-bundle` 提供了任务页与 schedule_* 工具。
 *
 * 座位与命名空间（slot id / order / locale namespace / 路由前缀）原样保留，
 * dsh-triad 退役后用户零迁移。所有数据经 host 半身的 loopback-only HTTP
 * 路由以 same-origin fetch 获取，不修改任何 DSH 源码。
 *
 * 与 dsh-chat-plus 主入口的关系：主线程在 `src/client/index.ts` 里调用
 * `applyTriadClient(ctx)`；`inject` 白名单由主线程统一声明，此处不导出。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { applyMemoryClient } from './memory/index.js'
import { apply as applyUsageEntries } from './usage/entry.js'
import { apply as applySkillSource } from './skill-source/index.js'
import { injectResponsiveStyles } from './responsive.js'
import { buildActivityGrid, activityColor, ACTIVITY_COLUMNS } from './usage/dashboard/ActivityGrid.js'

/** Run one module's apply, logging and swallowing any failure. */
function safe(label: string, run: (ctx: ClientContext) => void, ctx: ClientContext): void {
  try {
    run(ctx)
  } catch (error) {
    console.error(`[dsh-chat-plus] triad ${label} failed:`, error)
  }
}

/** Apply the dsh-chat-plus browser half (three isolated modules). */
export function applyTriadClient(ctx: ClientContext): void {
  /*
   * 响应式覆盖样式先于三个工作台注入。
   *
   * 这一行是补接线：injectResponsiveStyles 从四工作台融合那次引入起就**没有任何
   * 调用方**，整段 SHEET 被 tree-shake 掉、从未注入，于是文件头承诺的三件事
   * 一件都没发生——窄屏下官方设置面板仍是「188px 左导航 + 内容」两栏（内容列
   * 被压到 ~140px，供应商页不可用）、居中对话框不强制全宽、安全区变量从未定义。
   * useIsMobile 一直是活的（用量面板在用），所以死的只是注入这一条链。
   *
   * 幂等且返回移除函数，交给 ctx.effect 随插件卸载回收。
   */
  safe('responsive styles', (c) => { c.effect(injectResponsiveStyles, 'dsh-chat-plus: triad responsive styles') }, ctx)
  safe('memory', applyMemoryClient, ctx)
  safe('usage', applyUsageEntries, ctx)
  safe('skills', applySkillSource, ctx)
}

/** 纯逻辑导出：供 smoke 测试直接断言「Token 活动」贡献热力模型。 */
export { buildActivityGrid, activityColor, ACTIVITY_COLUMNS }
