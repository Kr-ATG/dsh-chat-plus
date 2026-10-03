/**
 * dsh-triad client 半身（搬迁进 dsh-chat-plus，三工作台融合）。
 *
 * 挂载五个模块，每个独立 try/catch，一个失败不拖垮其他：
 *
 *  - memory     → 官方 main 页 + sidebar.panellist 菜单行 + composer inject toggle
 *  - usage      → 侧边栏导航行 + 用量紧凑卡片（唯一保留的自绘浮层入口）
 *  - skills     → 官方 main 页 + sidebar.panellist 菜单行 + `/` slash source + skill tool row
 *  - mail       → 官方 main 页 + sidebar.panellist 菜单行（Agent Mail 三栏工作台）
 *  - responsive → 窄屏全局覆盖样式
 *
 * 定时自动化（原 automation 模块）已于 2026-09-28 删除：官方
 * `@deepseek-ai/dsh-experimental-schedule-bundle` 提供了任务页与 schedule_* 工具。
 *
 * 2026-10-04 入口改版：记忆 / 能力 / 邮箱三个工作台原先都是「自绘侧边栏导航行
 * + createPortal 到 body 的浮层抽屉」，现已全部改走官方座位（`main` 页 +
 * `sidebar.panellist` 菜单行），与官方「自动化任务」页完全同座位——见
 * `./panel-seat.tsx`。用量因为点开的是贴入口的紧凑小卡而不是整页，仍保留
 * 自绘导航行（官方菜单行只表达「选中一个 main 页面」，装不下这个语义）。
 *
 * 座位与命名空间（locale namespace / 路由前缀）原样保留，dsh-triad 退役后用户
 * 零迁移。所有数据经 host 半身的 loopback-only HTTP 路由以 same-origin fetch
 * 获取，不修改任何 DSH 源码。
 *
 * 与 dsh-chat-plus 主入口的关系：主线程在 `src/client/index.ts` 里调用
 * `applyTriadClient(ctx)`；`inject` 白名单由主线程统一声明，此处不导出。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { applyMemoryClient } from './memory/index.js'
import { apply as applyUsageEntries } from './usage/entry.js'
import { applySkillsSeat } from './usage/skills-seat.js'
import { apply as applySkillSource } from './skill-source/index.js'
import { applyMailClient } from './mail/index.js'
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

/** Apply the dsh-chat-plus browser half (five isolated modules). */
export function applyTriadClient(ctx: ClientContext): void {
  /*
   * 响应式覆盖样式先于各工作台注入。
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
  safe('skills seat', applySkillsSeat, ctx)
  safe('skills source', applySkillSource, ctx)
  // 邮箱工作台（Agent Mail）：官方 main 页 + 菜单行；host 半身未就绪时面板自己
  // 显示「未授权/连不上」的空态，不会把侧边栏入口弄丢。
  safe('mail', applyMailClient, ctx)
}

/** 纯逻辑导出：供 smoke 测试直接断言「Token 活动」贡献热力模型。 */
export { buildActivityGrid, activityColor, ACTIVITY_COLUMNS }
