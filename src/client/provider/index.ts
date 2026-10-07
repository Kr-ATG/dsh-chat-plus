/**
 * dsh-chat-plus — 供应商中心 client 半身（原 dsh-provider-hub，2026-10-05 融合）。
 *
 * 装配三个模块，每个独立 try/catch，一个失败不拖垮其余：
 *   1. 供应商标签 + 模型选择器 + 推理强度粒子滑杆（model-seats/*）。
 *   2. 「优化提示词」图标（prompt-optimize/*，座位 id dsh-prompt-optimize 保留）。
 *   3. 「供应商」设置页（webui/section 的 applySupplierSection）——**官方「设置」
 *      弹窗的 `settings.section` 座位**（id provider-hub / order 10 / label
 *      「供应商」逐字保留），页内底部含辅助视觉 / 生图 / 生视频与网络代理区块。
 *
 * 座位沿革：原 dsh-provider-hub 就是 `settings.section` + `settings.general.item`
 * （通用设置里的网络代理卡）；融合进 dsh-chat-plus 时曾整体搬进工作台 Tab，
 * 2026-10-05 用户点名「还是把供应商配置和代理放在设置里面吧」，于是撤回设置页：
 * 工作台不再有「供应商」Tab，官方「模型」页导航项同步隐藏
 * （hideOfficialModelsNav 恢复）——两页管同一件事只会让用户不知道该点哪个。
 *
 * 数据通道与 settings 命名空间（network-proxy / model-capabilities）原样保留，
 * 升级零迁移。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { applyModelSeats } from './model-seats/apply'
import { applyPromptOptimize } from './prompt-optimize/index'
import { applySupplierSection } from './webui/section.tsx'
import { injectStyles as injectSupplierStyles } from './webui/styles.ts'

/**
 * 对话输入区三个座位需要的服务（延迟注入；缺哪个只有那几块不挂）。
 *
 * `remote.session` 必须在内：`modelDirectories.directoryFor(sessionId)` 内部会读它，
 * 少一个就在渲染时抛 `cannot get property "remote.session" without inject`
 * （2026-10-05 实测：座位注册成功、渲染即崩，整排控件空白）。
 * `remote.settings` / `remote.credentials` / `remote.llm` / `configForms` 不在列——
 * 供应商设置页渲染时经 client-ctx 的 `getService` 防御式读取，
 * 写进这里等于给整块模块加硬依赖。
 */
export const providerClientServices = ['slots', 'modelDirectories', 'sessions', 'remote.session'] as const

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
  // 供应商页 / 代理区块的全局样式（幂等，随插件卸载回收）。纯 DOM，不需要任何服务。
  guarded('supplier styles', () => {
    ctx.effect(() => injectSupplierStyles(), 'dsh-chat-plus: provider styles')
  })
  // 「供应商」设置页座位：只依赖 slots（settings.section 是官方设置 shell 的槽位），
  // 不塞进下面的延迟注入里——那组服务是对话输入区座位专用的。
  guarded('supplier settings section', () => { applySupplierSection(ctx) })
  // 对话输入区的两个座位：延迟注入，服务缺失时只有这两块不挂。
  ctx.inject([...providerClientServices], (scope: ClientContext) => {
    guarded('model seats', () => applyModelSeats(scope))
    guarded('prompt optimize', () => applyPromptOptimize(scope))
  })}
