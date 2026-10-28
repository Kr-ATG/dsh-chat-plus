/**
 * dsh-chat-plus — 动态（Feed）模块的客户端装配入口。
 *
 * 这个文件只做一件事：**确保样式表在页面渲染前就位**，并导出面板与纯逻辑。
 *
 * ── 为什么没有 navMenuItem（与最初任务书的差异，2026-10-27 定）─────────
 * 侧栏「操作间」的条目行是**自动生成**的：hub/nav-sections.tsx 的
 * registerDefaultEntries() 会遍历 hub/row-flyout.tsx 的 WORKBENCH_TABS 逐条
 * 调 navMenuItem（id = workbench-<tab>）、order = 10 + index * 10。
 *
 * 所以这里再手动 navMenuItem 一次，侧栏就会出现**两行「动态」**（一行
 * workbench-feed、一行 feed），这是 bug 不是特性。「动态」这一行由我把它写进
 * WORKBENCH_TABS 之后自动出现 —— 一处真相，别再加第二份。
 *
 * ── 样式注入时机 ──────────────────────────────────────────────────────
 * 两个入口都调 ensureFeedStyles()，任一先到就先注入，重复调用是幂等的：
 *   · 本文件的 applyFeedClient()（apply 阶段，页面还没打开就先备好）；
 *   · FeedPanel 组件体首行（别处直接挂面板时的兜底，例如未来的独立入口）。
 * 注入只有**一个** style 标签（id = dsh-feed-styles）：smoke-client.mjs 有一条
 * 「head 里样式标签数量必须精确等于预期表长」的硬断言，多一枚就红。
 */

import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ensureFeedStyles } from './styles.js'

/** 装配动态模块（幂等；当前只负责样式注入）。 */
export function applyFeedClient(ctx: ClientContext): void {
  ensureFeedStyles()
  // 目前没有任何常驻副作用（无轮询、无全局监听），所以没有需要回收的 disposer。
  // 保留 ctx 参数是为了与其它模块的装配签名一致、将来加效果时不用改调用点。
  void ctx
}

export { FeedPanel } from './FeedPanel.js'
export type { FeedPanelProps } from './FeedPanel.js'
export { FEED_STYLE_ID, ensureFeedStyles } from './styles.js'
export {
  FOLLOW_DEFAULT,
  deleteFeedPost,
  fetchFeedConfig,
  fetchFeedModels,
  fetchFeedPosts,
  fetchFeedStatus,
  followDefaultLabel,
  normalizePost,
  postFeedComment,
  refreshFeed,
  saveFeedConfig,
  toggleFeedLike,
} from './api.js'
export type {
  FeedAccess,
  FeedComment,
  FeedConfig,
  FeedDay,
  FeedModelCatalog,
  FeedModelOption,
  FeedPost,
  FeedRefreshState,
  FeedRunStatsView,
  FeedRunStatus,
  FeedRunView,
  FeedSource,
  FeedStatus,
} from './api.js'
export { modelLabel, normalizePrompt, priorityKey } from './FeedPanel.js'
// 进度 / 日期 / 来源名全是纯函数，住在 progress.ts 里（见该文件头部的理由）。
// 它们由 client/index.ts 再导出一次，冒烟才能直接 import 跑真值断言。
export {
  activeRunOf,
  agoText,
  clockText,
  dateKeyOf,
  dateOnlyText,
  dayHeadingText,
  elapsedText,
  fullDateText,
  MAX_TOPIC_CHANNELS,
  medianOf,
  pad2,
  pickTopicChannels,
  prettySiteName,
  runDurationsOf,
  runProgressOf,
  shortModelName,
  sourceLabelOf,
  statusLabelOf,
} from './progress.js'
export { EntityOrbs, ENTITY_CHANGED_EVENT, notifyEntitiesChanged } from './EntityOrbs.js'
export { EntitySettings } from './EntitySettings.js'
export {
  createFeedEntity,
  deleteFeedEntity,
  fetchFeedEntities,
  fetchEntityPosts,
  initialFallbackOf,
  normalizeEntity as normalizeFeedEntity,
  updateFeedEntity,
} from './api.js'
export type { FeedEntity, FeedEntityInput } from './api.js'
export type { RunProgress, TopicChannel } from './progress.js'
export {
  CLOCK_TICK_MS,
  FALLBACK_ETA_MAX_MS,
  FALLBACK_ETA_MIN_MS,
  LOCAL_RUN_WINDOW_MS,
  PROGRESS_TICK_MS,
  RUN_STEPS,
  STATUS_POLL_MS,
} from './constants.js'
