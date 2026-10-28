/**
 * dsh-provider-hub — model seats 注册入口。
 *
 * 通过 `ctx.modelDirectories`（ui-model-selection 提供）共享 per-session
 * ModelDirectory，注册入口（左→右：模型名、推理等级）：
 *  1. `conversation.input.right`（ModelSeat，order 20，按供应商分组的两栏弹出）。
 *  2. `conversation.input.model`（EffortSeat，priority -100 覆盖官方
 *     ModelSelect；光尘粒子 ParticleField 承载档位动画）。
 *
 * 曾经还有一个 ProviderBadge（order 10）在模型名左边显示当前供应商。composer
 * 那行已经够挤了，供应商名对「现在用哪个模型」没有增量信息（模型名本身 + 弹出层
 * 头部的供应商名都能看出来），按用户要求整块移除；代理 P 标仍在设置页的供应商
 * 列表/详情里显示。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.model / input.right）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelSeatInjected } from './types'
import { ModelSeat } from './ModelSeat'
import { EffortSeat } from './EffortSeat'
import { featureEnabledNow, onFeatureChange } from '../../features/gate.tsx'

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

  /**
   * 注册两个座位，返回摘除函数。
   *
   * 分开成「注册 / 摘除」而不是直接写死两次 inject，是为了让 input.model-seats
   * 能在用户拨开关的当下**真正撤掉座位**（而不是只让组件返回 null 留一个空位）。
   */
  const mountSeats = (): (() => void) => {
    const disposers: Array<() => void> = []
    try {
      // 模型选择入口：工具行右侧。
      disposers.push(scope.slots.inject('conversation.input.right', () => scope.slots.register({
        name: 'conversation.input.right',
        id: 'peff-model',
        order: 20,
        inject: (sessionId: SessionId): ModelSeatInjected => face(sessionId),
      }, ModelSeat)))
      // 推理等级：接管模型座位（负数 priority 覆盖 ui-model-selection 的 ModelSelect），
      // 位于模型名右侧、靠近发送按钮。
      disposers.push(scope.slots.inject('conversation.input.model', () => scope.slots.register({
        name: 'conversation.input.model',
        id: 'peff-effort',
        priority: -100,
        inject: (sessionId: SessionId): ModelSeatInjected => face(sessionId),
      }, EffortSeat)))
    } catch (error) {
      console.warn('[provider/model-seats] 座位注册失败：', error)
    }
    return () => {
      for (const dispose of disposers.reverse()) {
        try { dispose() } catch { /* 已被级联移除：忽略 */ }
      }
    }
  }

  /**
   * 开关同步：关掉 = 两个座位一起摘掉（输入框上方的供应商/模型选择器与推理
   * 滑杆都不占位，用户看到的是一条干净的输入行）；打开 = 原地恢复。
   *
   * 只在模块内部做，不在 provider/index.ts 外层做 apply 期门：外层门在用户
   * 上次把开关关掉的情况下会连监听都装不上，重新打开必须刷新页面。
   */
  let disposeSeats: (() => void) | null = null
  const syncSeats = (enabled: boolean): void => {
    if (enabled) {
      if (disposeSeats === null) disposeSeats = mountSeats()
    } else {
      disposeSeats?.()
      disposeSeats = null
    }
  }
  syncSeats(featureEnabledNow('input.model-seats'))
  const off = onFeatureChange('input.model-seats', syncSeats)
  ctx.effect(() => () => {
    off()
    disposeSeats?.()
    disposeSeats = null
  }, 'dsh-chat-plus: model seats feature gate')
}
