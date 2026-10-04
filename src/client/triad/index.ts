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
import { applyWorkbenchSeat } from './hub/seat.js'
import { applyMemoryClient } from './memory/index.js'
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

/** Apply the dsh-chat-plus browser half. */
export function applyTriadClient(ctx: ClientContext): void {
  safe('responsive styles', (c) => { c.effect(injectResponsiveStyles, 'dsh-chat-plus: triad responsive styles') }, ctx)
  // 4合1 统一工作台（记忆、能力、用量、邮件）
  safe('workbench', applyWorkbenchSeat, ctx)
  // 输入框左侧提示词与记忆注入开关
  safe('memory toggles', applyMemoryClient, ctx)
  // 斜杠命令与技能工具行源
  safe('skills source', applySkillSource, ctx)
}

/** 纯逻辑导出：供 smoke 测试直接断言「Token 活动」贡献热力模型。 */
export { buildActivityGrid, activityColor, ACTIVITY_COLUMNS }
/**
 * 纯逻辑导出：供 smoke 断言「下拉选项 id ↔ 筛选比对值」口径一致。
 *
 * 这条口径踩过真坑（选模型后四格全 0、热力图全空），必须由冒烟钉死：
 * 供应商选项的 id 是前缀段、模型选项的 id 是完整 model 串，两者都要能被
 * `filterDaysByScope` 原样吃下。
 */
export { collectModels, collectProviders, filterDaysByScope, providerOfModel } from './usage/dashboard/aggregate.js'
