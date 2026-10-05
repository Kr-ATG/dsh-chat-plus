/**
 * dsh-provider-hub — 提示词优化模块（client 半身）。
 *
 * 原为独立插件 `dsh-prompt-optimize`（再上游是 dsh-webui 同模块），随「供应商
 * 中心」融合并入本包。并入时只改了导出名与相对路径，**座位与 order 逐字保留**：
 * 通过 `conversation.input.right` 槽位在供应商标签（`peff-provider`，order 10）
 * 左侧注册「优化提示词」图标（order 4，id `dsh-prompt-optimize`）。数据走
 * host 半身已挂载的 /api/dsh-prompt-optimize，模型选择读取与模型座位同源的
 * per-session ModelDirectory。
 *
 * 结果不会自动改草稿：面板内预览 → 用户点「应用到输入框」才写回；开关
 * 「设为长任务目标」开启时写成 `/goal <单行化优化文本>`，交由 DSH 既有
 * /goal 命令在用户发送后创建目标，零 DSH 源码改动。
 *
 * 服务依赖（slots / modelDirectories / sessions）已在 `src/client/index.ts`
 * 的 hub inject 里声明，本模块不再单独导出 inject。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.right 槽位契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PromptOptimizeButton } from './PromptOptimizeButton'
import type { PromptOptimizeInjected } from './PromptOptimizeButton'

/** 共享清洗器（与 host 半身同一份源码，供冒烟与面板兜底复用）。 */
export { cleanOptimized, collapseToLine, previewOptimized } from '../../../provider/modules/prompt-optimize-clean.ts'

/**
 * 挂载提示词优化图标入口。
 * @param ctx - client root context。
 */
export function applyPromptOptimize(ctx: ClientContext): void {
  try {
    const scope = ctx
    const models = scope.modelDirectories
    const sessions = scope.sessions

    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'dsh-prompt-optimize',
      // 供应商标签 order 10、模型座位 order 20；本图标 order 4 位于团队按钮（order 5）左侧。
      order: 4,
      inject: (sessionId: SessionId): PromptOptimizeInjected => {
        const directory = models.directoryFor(sessionId)
        return {
          available: sessions.subagentAddress(sessionId) === undefined,
          directory: directory.store,
          // 会话 id：POST 优化请求时回传，供 host 端「显式停止」定位本次优化。
          sessionId,
        }
      },
    }, PromptOptimizeButton))
  } catch (error) {
    console.warn(`[hub/prompt-optimize] 挂载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
