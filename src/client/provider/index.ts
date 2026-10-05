/**
 * dsh-chat-plus — 供应商中心 client 半身（原 dsh-provider-hub，2026-10-05 融合）。
 *
 * 装配四个模块，每个独立 try/catch，一个失败不拖垮其余：
 *   1. 供应商标签 + 模型选择器 + 推理强度粒子滑杆（model-seats/*）。
 *   2. 「优化提示词」图标（prompt-optimize/*，座位 id dsh-prompt-optimize 保留）。
 *   3. 工作台「供应商」Tab 的页面依赖装配（webui/section 的 createSupplierInjected
 *      由页面自己调，这里只负责注入页面样式）。
 *   4. 「网络代理」工作台 Tab 的样式（panel/proxy-panel 自带内联样式，
 *      这里只保证 .pp-* 的全局动效样式随插件注入）。
 *
 * 与旧插件相比少了三处座位：`settings.general.item`（网络代理卡 / 辅助视觉卡）、
 * `settings.section`（供应商整页）——它们全部迁进工作台；官方「模型」设置页
 * 不再被隐藏（hideOfficialModelsNav 已删除）。数据通道与 settings 命名空间
 * （network-proxy / model-capabilities）原样保留，升级零迁移。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { applyModelSeats } from './model-seats/apply'
import { applyPromptOptimize } from './prompt-optimize/index'
import { injectStyles as injectSupplierStyles } from './webui/styles.ts'

/**
 * 对话输入区两个座位需要的服务（延迟注入；缺哪个只有那两块不挂）。
 *
 * 刻意不含 remote / configForms：那是「供应商」工作台页渲染时经
 * client-ctx 的 `getService` 防御式读取的（页面可能在任何时候挂载），
 * 写进这里等于给整块模块加硬依赖。
 */
export const providerClientServices = ['slots', 'modelDirectories', 'sessions'] as const

/** 共享清洗器随 client 半身一并导出（冒烟与面板兜底都从这里取）。 */
export { cleanOptimized, collapseToLine, previewOptimized } from './prompt-optimize/index'

/** 每个模块的失败不拖垮其余模块。 */
function guarded(label: string, mount: () => void): void {
  try {
    mount()
  } catch (error) {
    console.warn(`[dsh-chat-plus/provider] ${label} 挂载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 装配供应商中心 client 模块。
 * @param ctx - client root context。
 */
export function applyProviderClient(ctx: ClientContext): void {
  // 供应商页 / 代理页的全局样式（幂等，随插件卸载回收）。纯 DOM，不需要任何服务。
  guarded('supplier styles', () => {
    ctx.effect(() => injectSupplierStyles(), 'dsh-chat-plus: provider styles')
  })
  // 对话输入区的两个座位：延迟注入，服务缺失时只有这两块不挂。
  ctx.inject([...providerClientServices], (scope: ClientContext) => {
    guarded('model seats', () => applyModelSeats(scope))
    guarded('prompt optimize', () => applyPromptOptimize(scope))
  })}
