/**
 * dsh-chat-plus — Soul 模块装配入口（记忆第四层：顶层身份契约）。
 *
 * 为什么把「装配」和「注入」拆开：
 *   本模块只负责**面板侧的能力面**——路由（读/写/切换/蒸馏/应用/开关）与模型工具。
 *   注入那一半刻意留在 memory/engine/inject.ts 里，与 zh / diagram / html / team
 *   几条内置通道并排：它们共享同一套「每会话首步一次、位于两道闸门之前、失败只记日志」
 *   的位置语义，分散到两个文件后，任何人调整闸门顺序都会漏掉其中一条。
 *
 * 失败隔离：调用方（memory/index.ts）用 try/catch 包住整个 mountSoul。Soul 是
 * 锦上添花的能力，路由挂不上不该把记忆引擎一起带走。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryConfig } from '../memory/types.js'
import type { MemoryStore } from '../memory/engine/store.js'
import { mountSoulRoutes, SOUL_ROUTE_PREFIX } from './router.js'
import { registerSoulTools } from './tools.js'
import { SoulStore } from './store.js'

export { SoulStore, isValidProfileId, profileIdFrom, SOUL_INJECT_BUDGET } from './store.js'
export { SOUL_ROUTE_PREFIX } from './router.js'
export { distillSoul, parseSoulDraft } from './distill.js'
export { selectDistillEntries, soulDistillSystemPrompt, soulDistillUserPrompt, SOUL_DISTILL_TIMEOUT_MS } from './prompt.js'
export {
  assembleInjection,
  applyPresetCards,
  cardsFromDraft,
  CARDS_INJECT_BUDGET,
  composeSoulText,
  dedupeCards,
  identityFromCards,
  injectableCards,
  seedCardsFromText,
} from './cards.js'
export { BUILTIN_SOUL_PRESETS, builtinPreset, isBuiltinPresetId } from './presets.js'
export {
  cardIdOf,
  CARD_BODY_MAX,
  CARD_TITLE_MAX,
  DEFAULT_SOUL_IDENTITY,
  DEFAULT_SOUL_TEMPLATE,
  normalizeCard,
  normalizeCards,
  normalizeCardKind,
  normalizeIdentity,
  normalizePreset,
  presetIdOf,
  SOUL_CARD_KINDS,
  SOUL_CARD_SECTION_TITLES,
  sortCards,
  type ProfileView,
  type SoulActiveFile,
  type SoulCard,
  type SoulCardKind,
  type SoulCardsFile,
  type SoulDistillStats,
  type SoulDraft,
  type SoulIdentity,
  type SoulPreset,
  type SoulPresetsFile,
  type SoulProfile,
  type SoulView,
} from './types.js'

/** Soul 模块装配结果。 */
export interface SoulMount {
  /** 灵魂存储（注入侧复用同一实例，避免两处各持一份状态）。 */
  readonly soul: SoulStore
  /** 路由 + 工具的合并 disposer。 */
  readonly dispose: () => void
}

/**
 * 挂载 Soul 的路由与工具。
 *
 * @param ctx    Cordis 上下文（需要 webServer 与 tools）。
 * @param memory 记忆存储（蒸馏的条目来源 + 注入开关的持久化位置）。
 * @param config 记忆配置（soulInjectDefaultEnabled 的默认值）。
 * @param soul   灵魂存储实例；省略时自建一个（测试/独立挂载用）。
 */
export function mountSoul(
  ctx: Context,
  memory: MemoryStore,
  config: MemoryConfig,
  soul: SoulStore = new SoulStore(),
): SoulMount {
  const routesDispose = mountSoulRoutes({ ctx, memory, config, soul })
  const toolsDispose = registerSoulTools(ctx, soul)
  return {
    soul,
    dispose: () => {
      toolsDispose()
      routesDispose()
    },
  }
}
