/**
 * dsh-soul browser half —— 灵魂面板（记忆工作台第四层）。
 *
 * 本目录只被 Lead 的接线消费（记忆面板的「灵魂」Tab + composer 浮层开关），
 * 自身不注册任何座位：座位与路由归属由记忆模块统一持有，灵魂不另开工作台，
 * 因为「灵魂由记忆蒸馏而来、记忆的价值靠灵魂体现」，两者是同一件事的两端。
 *
 * 导出契约（不得改名，Lead 按此接线）：
 *   SoulPanel     面板组件（api 由调用方 useMemo 固定引用）
 *   createSoulApi 无状态 fetch 包装，可安全单例
 *   SoulIcon      图标（面板标题 / Tab / 浮层按钮共用）
 *   SoulToggleRow composer 浮层里的一行开关
 *   类型：SoulApi / SoulView / SoulIdentity / SoulDraft / ProfileView
 */

export { SoulPanel, SoulIcon, SoulToggleRow } from './SoulPanel.js'
export type { SoulPanelProps } from './SoulPanel.js'
// 卡片化的三块（面板内部用，同时导出给 Lead 与临时渲染检查复用）：
// 鲸鱼是品牌件、卡片区/预设区是「灵魂」的主体，任何一处要单独摆放都能直接用。
export { WhaleLogo } from './WhaleLogo.js'
export type { WhaleLogoProps } from './WhaleLogo.js'
export { CardsSection, CardKindIcon } from './CardsSection.js'
export type { CardsSectionProps } from './CardsSection.js'
export { PresetsSection } from './PresetsSection.js'
export type { PresetsSectionProps } from './PresetsSection.js'
export {
  createSoulApi,
  SoulHostStaleError,
  EMPTY_IDENTITY,
  EMPTY_SOUL,
} from './api.js'
export type {
  SoulApi,
  SoulView,
  SoulIdentity,
  SoulDraft,
  ProfileView,
  SoulPatch,
  SoulStateView,
  SoulDistillResult,
  SoulDistillStats,
  SoulSnapshotResponse,
  SoulCard,
  SoulCardKind,
  SoulCardsPatch,
  SoulCardsResponse,
  SoulPreset,
  SoulPresetApplyMode,
  SoulPresetCreateResponse,
} from './api.js'
export { SOUL_CARD_KINDS } from './api.js'
export { makeSoulT, SOUL_CHAR_LIMIT } from './locales.js'
export type { SoulT, SoulLocaleKey } from './locales.js'
export { css as soulCss, ensureSoulStyles } from './styles.js'
