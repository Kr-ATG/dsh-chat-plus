/**
 * dsh-provider-hub — model seats 注册入口。
 *
 * 通过 `ctx.modelDirectories`（ui-model-selection 提供）共享 per-session
 * ModelDirectory，注册三个入口（左→右：供应商标签、模型名、推理等级）：
 *  1. `conversation.input.right`（ProviderBadge，order 10）。
 *  2. `conversation.input.right`（ModelSeat，order 20，按供应商分组的两栏弹出）。
 *  3. `conversation.input.model`（EffortSeat，priority -100 覆盖官方
 *     ModelSelect；光尘粒子 ParticleField 承载档位动画）。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.model / input.right）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelSeatInjected } from './types'
import { ModelSeat } from './ModelSeat'
import { EffortSeat } from './EffortSeat'
import { ProviderBadge, type ProviderBadgeInjected } from './ProviderBadge'

/**
 * 挂载供应商标签 + 模型选择座位 + 推理等级入口。
 * @param ctx - client root context。
 */
export function applyModelSeats(ctx: ClientContext): void {
  const scope = ctx
  const models = scope.modelDirectories
  const sessions = scope.sessions

  const face = (sessionId: SessionId): ModelSeatInjected => {
    const directory = models.directoryFor(sessionId)
    const available = sessions.subagentAddress(sessionId) === undefined
    return {
      available,
      directory: directory.store,
      load: () => {
        if (available) directory.load().catch(() => { /* 错误落在 store 上 */ })
      },
      select: (selection: ModelSelection) => available
        ? directory.select(selection).then(() => true, () => false)
        : Promise.resolve(false),
    }
  }

  // 供应商标签：当前供应商 chip（目录未加载时渲染空）。
  scope.slots.inject('conversation.input.right', () => scope.slots.register({
    name: 'conversation.input.right',
    id: 'peff-provider',
    order: 10,
    inject: (sessionId: SessionId): ProviderBadgeInjected => {
      const directory = models.directoryFor(sessionId)
      return { directory: directory.store }
    },
  }, ProviderBadge))

  // 模型选择入口：工具行右侧，供应商标签之后。
  scope.slots.inject('conversation.input.right', () => scope.slots.register({
    name: 'conversation.input.right',
    id: 'peff-model',
    order: 20,
    inject: (sessionId: SessionId): ModelSeatInjected => face(sessionId),
  }, ModelSeat))

  // 推理等级：接管模型座位（负数 priority 覆盖 ui-model-selection 的 ModelSelect），
  // 位于模型名右侧、靠近发送按钮。
  scope.slots.inject('conversation.input.model', () => scope.slots.register({
    name: 'conversation.input.model',
    id: 'peff-effort',
    priority: -100,
    inject: (sessionId: SessionId): ModelSeatInjected => face(sessionId),
  }, EffortSeat))
}
