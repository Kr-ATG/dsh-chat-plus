/**
 * dsh-chat-plus — 个人动态（Feed）· 触发闸门与生成流水线（host 半身）。
 *
 * 两件事：
 *  1. **单飞锁**（方案 §5.2）：上一轮未完成时不重复启动；连续点只排队一次。
 *  2. **一轮生成**的编排骨架：上下文 → X 同步 → 写作 → 落盘。
 *
 * ── 单飞锁的四条硬要求（每条都有对应的验收用例）──────────────────
 *
 * | 要求 | 为什么 |
 * |---|---|
 * | 状态**落盘** | 「重启后连点两次」必须仍然只跑一轮；只存内存的话重启即失效 |
 * | 执行期间**续租** | LEASE_MS=10min，一轮长任务超过它就会被误判成死锁 |
 * | 崩溃后**可回收** | 进程被杀留下 running，租约过期后必须能起新一轮 |
 * | queued **合并而非串行** | 「连续点更新不会重复跑两轮」的根因就在这 |
 *
 * ── 写作阶段的契约（2026-10-27 改）────────────────────────────────
 *
 * executeRun 的写作阶段是一个可注入的 FeedWriter。**默认实现是真实的**
 * （writer.ts 的 createRealWriter：检索 → 验活 → 模型写作 → 校验）。
 *
 * 原来的 P1 占位 writer 已整块删除（用户要求「不要假数据」）：它会产一条
 * 「本轮动态（占位）」并真的写进 posts.json，接上真实流水线之后它只剩
 * 「让用户看到假内容」这一个作用。需要伪造内容时必须**显式注入** writer
 * （冒烟正是这么做），生产路径上不存在悄悄产占位内容的可能。
 *
 * writer 抛错 ⇒ 本轮 0 条 + status='failed' + error 说明原因。
 *
 * ── 增量 + 去重（2026-10-27，用户原话「只更新上次时间节点到当前时间节点，
 *    并且不要重复」）────────────────────────────────────────────────
 *
 * 一轮生成的完整顺序（增量与去重分别落在这条链的两端）：
 *
 *   阶段 0  定时间窗：sinceAt = 上一轮**成功**生成的时刻（读不到回落 7 天）
 *           → 写进 run.stats.sinceAt/sinceFallback/sinceSource
 *   阶段 1  X 同步（可失败、可跳过）
 *   阶段 2  写作：writer 拿到 sinceAt + knownPosts（最近 30 条的标题/主题/来源）
 *           → 提示词要求模型「只写这段新进展」+「自己判断哪些与已发内容重复」
 *           → 模型回报 skipped[]（它主动放弃的候选 + 理由）
 *   阶段 3  校验（sanitizeDraft）
 *   阶段 4  **兜底去重**（dedupePosts）：只拦「标题字符级相同」与「来源 URL
 *           全重复」这两条零歧义的；其余全靠模型判断
 *   阶段 5  落盘
 *
 * 为什么阶段 4 只留两条：用户明确要求「让模型自己去判断去重」。阈值型相似度
 * （Jaccard / URL 重合率）看着能防重复，实际会误杀「同一话题的新进展」——
 * 而误杀的表现是「更新了但没内容」，用户从现象上完全查不出原因。
 *
 * @module
 */

import { createHash } from 'node:crypto'
import {
  FEED_MAX_POSTS_PER_RUN,
  MAX_FEED_MEDIA,
  newPostId,
  newRunId,
  type FeedConfig,
  type FeedMedia,
  type FeedPost,
  type FeedRun,
  type FeedRunStats,
  type FeedRunStatus,
  type FeedSource,
  type FeedTriggerKind,
  type XTweet,
  type XSyncState,
} from './types.ts'
import type { FeedStore } from './store.ts'
import { resolveEntityIds, writerEntitiesOf, type EntityLike } from './entities.ts'
import { MAX_EXCERPT_CHARS, runXSyncRound, type XFetchDeps, type XSyncRoundResult } from './sources.ts'
import {
  dedupePosts,
  lastOkRunAtOf,
  MAX_DEDUPE_EXISTING,
  MAX_KNOWN_POSTS_FOR_PROMPT,
  resolveSinceWindow,
} from './incremental.ts'

/** 租约时长：10 分钟（§5.2 点名的值）。 */
export const LEASE_MS = 10 * 60 * 1000

/** 续租间隔：60 秒（§5.2 点名的值）。 */
export const LEASE_RENEW_MS = 60 * 1000

/** requestRun 的返回（与 §5.2 的签名一致）。 */
export type RunRequestResult = 'started' | 'queued' | 'rejected'

/* ───────────────────────── 提示词「实质」改动判定 ───────────────────────── */

/**
 * 归一化提示词（§5.3）：去空白 + 全角标点转半角 + 小写。
 *
 * 只改空白/标点、改回原样 → 不触发。这条在原型里验证过，这里保持同一口径，
 * 否则用户把句号改成逗号就会被生成一轮，等于把「点更新」的语义弄丢了。
 */
export function normalizePrompt(text: string): string {
  /*
   * 判据：**剥离**空白与标点后比较，而不是把全角标点「转换」成半角。
   *
   * 为什么不用 §5.3 那段伪代码的字面做法（全角→半角转换）：转换会把「句号」
   * 这种标点**保留成一个字符**，于是 `'盯住健身'` 与 `'盯住健身。'` 归一化后
   * 不相等 → 判为实质改动 → 触发一轮生成。而 §5.3 那一节自己的要求是
   * 「只改空白/标点、改回原样 → 不触发」。伪代码与它写下的意图互相矛盾，
   * 这里按**意图**实现：两边都剥掉标点再比。
   *
   * 副作用是好的：用户调整句读不会被打断，而真正改了要求的措辞一定还会
   * 留下文字差异，照样触发。
   */
  return text
    .replace(/\s+/g, '')
    // 全角与半角标点、常见符号一律剥掉（含中文引号、波浪线、省略号）。
    .replace(/[，。；、！？,.;!?:：""''''""\u3001\u3002\uff0c\uff1b\uff01\uff1f…—\-~～()（）\[\]【】]/g, '')
    .toLowerCase()
}

/** 提示词是否发生**实质**改动（§5.3）。 */
export function promptChanged(before: string, after: string): boolean {
  return normalizePrompt(before) !== normalizePrompt(after)
}

/** 提示词快照的短哈希（存进 FeedPost.promptHash，便于溯源）。 */
export function promptHashOf(prompt: string): string {
  return createHash('sha1').update(normalizePrompt(prompt)).digest('hex').slice(0, 12)
}

/* ───────────────────────── 写作注入面 ───────────────────────── */

/** 写作输入（writer 拿到的一切上下文）。 */
export interface FeedWriteInput {
  runId: string
  trigger: FeedTriggerKind
  config: FeedConfig
  /** 提示词哈希（要原样写进每条帖子的 promptHash）。 */
  promptHash: string
  /** 本轮可用的「今天的新事件」X 推文（已去重、已按新鲜度过滤）。 */
  freshTweets: XTweet[]
  /** 历史推文：只能当背景，不能当新闻（实测报告 §3.2）。 */
  staleTweets: XTweet[]
  /** 本轮 X 同步的原始结果（可读性信息，writer 可忽略）。 */
  sync: XSyncRoundResult | null
  /** 现在（毫秒）。 */
  now: number
  /**
   * 本轮的时间窗起点（毫秒）：只写这段时间之后的新进展。
   *
   * 由 executeRun 用 incremental.ts 的 {@link resolveSinceWindow} 定出来
   * （优先「上次成功生成的时点」，读不到回落到 7 天前），并同时写进
   * run.stats.sinceAt 与 GET /status —— 三处必须是**同一个值**，否则界面上
   * 显示的时间窗与实际过滤用的时间窗会悄悄分叉。
   */
  sinceAt?: number
  /** true = sinceAt 是回落值（首次运行 / 水位线读不到）。 */
  sinceFallback?: boolean
  /**
   * 最近发过的标题（去重参考）。
   *
   * 由 executeRun 从现有 posts 里取：模型最容易犯的错是把同一条新闻
   * 换个说法再写一遍，而它自己看不到历史 —— 把标题列给它是最便宜的
   * 去重手段（比内容相似度判定省一个数量级的复杂度）。
   */
  knownTitles?: string[]
  /**
   * 最近发过的**完整信息**（标题 + 主题 + 来源），让模型自己判断语义重复。
   *
   * 为什么不能只给标题（2026-10-27 用户要求「让模型自己去判断去重」）：
   * 光看标题串，模型判不出「模型权重层算不算技术出口」与「开源加条款：
   * 披露、阈值、迁移限制」是同一件事、更判不出「当前候选与已发内容用的是
   * 同一批资料」。把每条的标题 + 主题 + 来源域名一起摆出来，模型才有判断依据。
   *
   * 与 knownTitles 并存而不是替换：knownTitles 是老契约（冒烟与可能的第三方
   * 注入实现还在用），knownPosts 是新的、信息更全的那一份。
   */
  knownPosts?: KnownPostBrief[]
  /**
   * 本轮关注的人物 / 公司（右侧悬浮球里那几枚球对应的人）。
   *
   * 只下发**名字 / 类型 / 别名**三格（见 entities.ts 的 writerEntitiesOf）：
   *  - id 不能让模型看见 —— 它会照抄进输出，而抄错就静默丢失归属；
   *  - 头像与 URL 对写内容没有帮助，只是白占 token。
   *
   * 交给模型以后它做两件事（**判断权全在模型**，这里只提供数据）：
   *  1. 写的时候优先覆盖这些人/公司的新进展；
   *  2. 判重时把「同一个人的同一件事」当成最强的重复信号。
   */
  followedEntities?: readonly { name: string; kind: 'person' | 'company'; aliases?: readonly string[] }[]
  /**
   * **出参**：writer 可以往里写过程计数（queries / rawChars / 来源三态 …）。
   *
   * 为什么用出参而不是返回值：writer 的返回值必须保持 FeedDraft[]（那是
   * 所有注入实现与冒烟用例的契约，改成包装对象会让每一处都要解包）。
   * 而 run.stats 需要的是「走到哪一步」的过程数据，它只对真实 writer 有意义，
   * 假 writer 不填就是空的 —— 一个可选出参刚好表达这个语义。
   */
  report?: FeedWriteReport
}

/** 交给模型做「语义去重」判断的一条已有内容的简介。 */
export interface KnownPostBrief {
  title: string
  /** 主题标签（频道键）。 */
  topics: string[]
  /** 来源域名清单（不给完整 URL：闸 2 不让模型看到任何链接）。 */
  domains: string[]
  /** 生成时间（毫秒）。 */
  createdAt: number
}

/** writer 产出的草稿（还没过校验、还没落盘）。 */
export interface FeedDraft {
  title: string
  body: string
  topics: string[]
  /** 引用哪几条来源（调用方只传本轮验活过的清单，闸 2 靠这个结构消灭编造）。 */
  sourceRefs?: FeedSource[]
  /**
   * 这条动态带的媒体（图片 / 视频），由 writer 从**引用的 X 来源**里搬过来。
   *
   * 为什么不在这里现算、而由 writer 填：媒体只存在于抓到的推文对象里，
   * 而 `sourceRefs` 只是 FeedSource（不含媒体）。writer 手上有 `withTweets`，
   * 它是唯一能按 URL 把「这条帖引用了哪条推文」还原出来的地方。
   */
  media?: FeedMedia[]
  dueAt?: number
  dueLabel?: string
  /** 是否属于「我的动态」频道（topics 里会自动补 mine）。 */
  mine?: boolean
  /**
   * 这条动态主要关于谁（**名字**，模型标注的原样）。
   *
   * 为什么是名字而不是 id：模型抄 id 几乎必错，而抄错**不会报错** —— 只会让
   * 那条动态静默失去归属。名字错了还能靠 resolveEntityIds 的宽松匹配救回来。
   * 换 id 的动作在 executeRun 里做（那里才拿得到实体表）。
   */
  entityNames?: string[]
  /**
   * 引用的 X 推文**原文全文**（2026-10-28 用户要求「不要压缩原文内容」）。
   *
   * 由 writer 从「这条帖引用的 X 来源」里带出来（与 media 同一条链路），
   * 落盘进 FeedPost.originalText，界面在正文下方以「原文」块展示。
   */
  originalText?: string
  /** 原文语言（如 'en'）。界面据此显示「译自英文」。 */
  originalLang?: string
}

/** 写作函数（可注入：默认实现是 writer.ts 的真实流水线；测试可注入假实现）。 */
export type FeedWriter = (input: FeedWriteInput) => Promise<FeedDraft[]>

/**
 * 一轮写作的过程报告（真实 writer 填，executeRun 并进 run.stats）。
 *
 * 为什么这份字段要一路落到 run.stats 而不是只打日志：用户与排查者需要
 * 从界面上**一眼看出链路走到哪一步**。全都返回 0 条时，"0 条"本身不说
 * 任何事；而 `queries=0 & rawChars=0` 说明检索与模型都没跑起来，
 * `rawChars=3000 & postsCreated=0` 说明模型写了但全被校验挡下 —— 两种
 * 情况的处置完全不同（查 provider vs 查提示词）。
 */
export interface FeedWriteReport {
  /**
   * 实际生效的路由，形如 `alymagpie/auto/deepseek-v4.1-flash`。
   *
   * ⚠ 绝不能记 `config.model` 原样：配置里存的是 'default'，那样用户与
   * 排查者在界面上看到的是一句没有信息量的鬼话（「上轮模型：default」）。
   * 这里记真实路由，才能回答「用的确实是这个模型吗」。
   */
  modelUsed?: string
  /** 同一路由的人类可读名（如 WB-Deepseek-Flash），界面展示用。 */
  modelLabel?: string
  /** 路由是怎么定下来的：agentDefaultModel / first-available / configured / fallback-default … */
  modelResolution?: string
  /** 本轮发了几条检索 query。 */
  queries?: number
  /** 模型返回的原始字符数（0 = 模型压根没回话）。 */
  rawChars?: number
  /** 验活判定为 open / limited / blocked 的来源数。 */
  sourcesOpen?: number
  sourcesLimited?: number
  sourcesBlocked?: number
  /** 校验阶段丢弃的帖子数（越界 sourceIds / 空正文等）。 */
  dropped?: number
  /** 降级说明（如「web 检索不可用」），有值即说明走了降级路径。 */
  degraded?: string

  /* ── 增量 + 去重（2026-10-27）───────────────────────────────────────── */

  /** 因为明确早于 sinceAt 而丢掉的候选来源数。 */
  droppedStale?: number
  /** 缺 publishedAt、保留但标注「时间未知」的来源数。 */
  sourcesTimeUnknown?: number
  /**
   * 模型**自己**判断为重复而跳过的条数（输出里的 skipped[]）。
   *
   * 这是「让模型自己判断去重」这条路唯一的可观测落点：模型判了什么、为什么判，
   * 都从这里出来。与 dropped（校验失败）分开计，因为语义完全不同 ——
   * 一条是「模型主动少写」，一条是「写了但不合格」。
   */
  modelSkipped?: number
  /** 模型给的跳过理由原文（最多 10 条，给人看）。 */
  modelSkipNotes?: string[]

  /* ── 以下为 2026-10-27「全判重复 ≠ 更新失败」新增 ───────────────────── */

  /**
   * true = 本轮 0 条产出是**模型主动判断出来的**（它与已发内容重复），不是故障。
   *
   * 这是 writer 给 executeRun 的信号：writer 用「返回值」表达不了这件事
   * （0 条数组与 0 条数组长得一样），所以走 report 出参。executeRun 看到它就
   * 把 status 记成 `skipped`（中性）而不是 `failed`（红色报错）。
   *
   * ⚠ 只有「模型明说它跳过了 N 条」才允许置 true。JSON 里真没条目、全被校验
   *   丢掉、JSON 解析失败、模型调用报错 —— 一律不置，那些必须是 failed。
   */
  noNewContent?: boolean
  /** 一句话说明为什么没有新内容（给界面直接用）。 */
  noNewContentReason?: string
}

/** 把报告并进 stats（只覆盖有值的字段，stats 的老字段一个不动）。 */
export function mergeReportIntoStats(stats: FeedRunStats, report: FeedWriteReport): FeedRunStats {
  return {
    ...stats,
    ...(report.queries === undefined ? {} : { queries: report.queries }),
    ...(report.rawChars === undefined ? {} : { rawChars: report.rawChars }),
    ...(report.sourcesOpen === undefined ? {} : { sourcesOpen: report.sourcesOpen }),
    ...(report.sourcesLimited === undefined ? {} : { sourcesLimited: report.sourcesLimited }),
    ...(report.sourcesBlocked === undefined ? {} : { sourcesBlocked: report.sourcesBlocked }),
    ...(report.modelUsed === undefined ? {} : { modelUsed: report.modelUsed }),
    ...(report.modelLabel === undefined ? {} : { modelLabel: report.modelLabel }),
    ...(report.modelResolution === undefined ? {} : { modelResolution: report.modelResolution }),
    ...(report.degraded === undefined ? {} : { degraded: report.degraded }),
    ...(report.droppedStale === undefined ? {} : { droppedStale: report.droppedStale }),
    ...(report.sourcesTimeUnknown === undefined ? {} : { sourcesTimeUnknown: report.sourcesTimeUnknown }),
    ...(report.modelSkipped === undefined ? {} : { modelSkipped: report.modelSkipped }),
    ...(report.modelSkipNotes === undefined || report.modelSkipNotes.length === 0
      ? {}
      : { modelSkipNotes: report.modelSkipNotes.slice(0, 10) }),
    /*
     * 「没有新内容」这两个格子**只在为真时写**。
     *
     * 与上面那些计数的口径不同：那几格 0 与「缺失」是两件事（0 条检索 vs 没
     * 这个能力），所以要写；而这两格是**标记**，缺省就是「没有这个标记」，
     * 写一个恒为 false 的键只会让界面去猜「是没标记还是标记为假」。
     */
    ...(report.noNewContent === true ? { noNewContent: true } : {}),
    ...(report.noNewContentReason === undefined || report.noNewContentReason === ''
      ? {}
      : { noNewContentReason: report.noNewContentReason }),
  }
}

/**
 * ⚠ 占位 writer **已功能性删除**（2026-10-27，用户要求「不要假数据」）。
 *
 * 原来的实现会产一条「本轮动态（占位）」并真的写进 posts.json —— 那是 P1
 * 阶段在"没有真实 LLM"时验证排序 / 删除 / 单飞锁的手段。接上真实流水线
 * 之后，它剩下的唯一作用就是**让用户看到假内容**。
 *
 * ── 为什么保留函数名而不是整块删掉 ─────────────────────────────────
 *
 * 它被 `src/host.ts` re-export 出去了（那是另一个人的作用域，本模块不该
 * 单方面改）。直接删除会让那条 re-export 变成 undefined —— esbuild 对这种
 * 情况**静默放行**，构建绿、产物能 import，但任何
 * `import { createPlaceholderWriter } from 'dsh-chat-plus'` 都会拿到
 * undefined 然后在调用时炸成 "is not a function"，报错点离根因很远。
 *
 * 所以保留名字，把**行为**改成"抛出明确错误"：
 *  - 语义上仍然没有任何人能拿到占位内容（函数只会抛）；
 *  - 导出面不断裂，旧代码调用它会立刻得到一句人话。
 *
 * 真正该用的实现是 writer.ts 的 {@link createRealWriter}；需要伪造内容的
 * 测试请**显式注入自己的 writer**（冒烟正是这么做）。
 *
 * @deprecated 不产任何内容，调用即抛错。请用 createRealWriter 或显式注入。
 */
export function createPlaceholderWriter(): FeedWriter {
  return createFailingWriter(
    '占位 writer 已停用：本模块不再产出任何占位内容，请使用真实写作流水线（见 /status 的 modelResolved）',
  )
}

/**
 * 显式的失败 writer（**不产任何内容**）。
 *
 * 这是 `applyFeedHost` 在拿不到真实写作能力时的兜底：它产 0 条并抛错，
 * 让 executeRun 记一条 `status='failed'` + `run.error`。
 *
 * 为什么需要一个"专门用来失败"的实现，而不是直接不装 writer：
 * writer 是 executeRun 的必需依赖，缺了会在更晚的地方炸（那时错误信息
 * 只有 "undefined is not a function"，用户看到的就是"更新失败了"却没有
 * 原因）。这里在**最早的位置**给出人话原因，`/status` 里也能看到。
 *
 * @param reason - 写进 run.error 的原因。
 */
export function createFailingWriter(reason: string): FeedWriter {
  return async (): Promise<FeedDraft[]> => {
    throw new Error(reason)
  }
}

/* ───────────────────────── 校验（§4 阶段 6 的最小集） ───────────────────────── */

/** 校验修整后的草稿。 */
export interface CleanDraft {
  title: string
  body: string
  topics: string[]
  sources: FeedSource[]
  /** 媒体（图片 / 视频）。只从引用的 X 来源带过来，见 FeedDraft.media。 */
  media: FeedMedia[]
  dueAt: number
  dueLabel: string
  /** 模型标注的「主要关于谁」（名字原样；换 id 在 executeRun 里做）。 */
  entityNames: string[]
  /**
   * X 推文原文与语言（2026-10-28；空串不落盘）。
   *
   * ⚠ 这两个字段此前**只存在于运行时对象上、没写进接口** —— 落盘处要读它们，
   * 类型检查却一直报 "Property 'originalText' does not exist on type 'CleanDraft'"。
   * 接口漏声明不影响运行时，但会让下一个人以为「这里不能有原文」而删掉落盘逻辑。
   */
  originalText?: string
  originalLang?: string
}

/**
 * 校验并修整一条草稿：不合格返回 null（整帖丢弃）。
 *
 * 这里只做**与数据安全相关**的三条，不含内容质量判定（P2 再加相似度）：
 *  1. 标题/正文非空（空帖进列表就是一行空白）；
 *  2. 来源必须是真实 http(s) URL，且 limited/open 的摘要字段各归各位 ——
 *     limited 清 snippet、只留 excerpt；open 反之。闸 2（不许编造 URL）靠的是
 *     「调用方只能把本轮验活过的清单传进来」，这里再兜一层形状校验。
 *  3. topics 去重去空；一条都没有时给 mine（否则左栏频道过滤会把这条藏掉）。
 */
export function sanitizeDraft(draft: FeedDraft): CleanDraft | null {
  const title = draft.title.trim()
  const body = draft.body.trim()
  if (title === '' || body === '') return null
  const sources: FeedSource[] = []
  for (const source of draft.sourceRefs ?? []) {
    if (/^https?:\/\//i.test(source.url) === false) continue
    sources.push(source.access === 'limited'
      ? { ...source, snippet: undefined, excerpt: source.excerpt?.slice(0, 200) }
      : { ...source, excerpt: undefined })
  }
  // 一条来源都没有的帖子是允许的（见默认 writer 的第 ② 种情况），
  // 但有来源时绝不允许出现「不合法来源被偷偷留下」。
  const topics = [...new Set(draft.topics.map(topic => topic.trim()).filter(topic => topic !== ''))]
  if (draft.mine === true && topics.includes('mine') === false) topics.push('mine')
  if (topics.length === 0) topics.push('mine')
  /*
   * 媒体：只做**形状**清洗（与来源同一层职责），不做「该不该有」的判断。
   *
   * 三条都必须洗，因为它们是「能渲染」的前提：
   *  - url / sourceUrl 必须是 http(s)（相对路径或 javascript: 既不能显示也不能点）；
   *  - type 只认三态（脏值会让界面走到没有分支的 default）；
   *  - 上限 MAX_FEED_MEDIA 条（X 单条推文就 4 个，多出来的只会撑爆卡片）。
   */
  const media: FeedMedia[] = Array.isArray(draft.media)
    ? draft.media.filter(item => typeof item === 'object' && item !== null
        && /^https?:\/\//i.test(item.url)
        && /^https?:\/\//i.test(item.sourceUrl))
        .slice(0, MAX_FEED_MEDIA)
        .map(item => ({
          url: item.url,
          type: item.type,
          ...(typeof item.videoUrl === 'string' && /^https?:\/\//i.test(item.videoUrl) ? { videoUrl: item.videoUrl } : {}),
          ...(typeof item.width === 'number' && item.width > 0 ? { width: item.width } : {}),
          ...(typeof item.height === 'number' && item.height > 0 ? { height: item.height } : {}),
          sourceUrl: item.sourceUrl,
        }))
    : []
  return {
    title,
    body,
    topics,
    sources,
    media,
    dueAt: draft.dueAt !== undefined && Number.isFinite(draft.dueAt) ? draft.dueAt : 0,
    dueLabel: draft.dueLabel ?? '',
    /*
     * 模型标注的归属：只做**形状**清洗（非字符串 / 空串丢掉、去重），
     * 不在这里换 id —— 换 id 要读实体表，而校验是纯函数（冒烟直接对拍）。
     */
    entityNames: Array.isArray(draft.entityNames)
      ? [...new Set(draft.entityNames.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map(name => name.trim()))]
      : [],
    /*
     * 原文（2026-10-28 用户要求「不要压缩原文内容」）：
     * 只做形状清洗 —— 非字符串/空串丢掉，长度上限与 sources 的 excerpt 一致
     * （MAX_EXCERPT_CHARS），避免一条超长推文把 posts.json 撑大。
     * 这里**不判断语言**：模型不需要产出 originalText，它由 writer 从推文带出来。
     */
    ...(typeof draft.originalText === 'string' && draft.originalText.trim() !== ''
      ? { originalText: draft.originalText.trim().slice(0, MAX_EXCERPT_CHARS) }
      : {}),
    ...(typeof draft.originalLang === 'string' && draft.originalLang.trim() !== ''
      ? { originalLang: draft.originalLang.trim().slice(0, 16) }
      : {}),
  }
}

/* ───────────────────────── 一轮生成 ───────────────────────── */

/**
 * 关注对象存储的**最小读取面**（executeRun 只读不写）。
 *
 * 为什么不用 entities.ts 的 EntityStore 类型：runDeps 是**可注入**的
 * （冒烟与将来的测试会塞自己的实现），依赖一个具体的 class 会把注入方钉死在
 * 那个实现上。声明成结构化接口后，任何「能 list 出这几格」的对象都能用。
 *
 * 返回的每一项只要 name/kind/aliases 三格：生成侧只用得上这三样
 * （见 writerEntitiesOf 的说明 —— id 与头像刻意不进提示词）。
 */
export interface FollowedEntitySource {
  list(): Promise<readonly {
    readonly id: string
    readonly name: string
    readonly kind: 'person' | 'company'
    readonly aliases: readonly string[]
    /** X 账号（小写、不带 @）。用于按抓到的推文回填头像。 */
    readonly xHandle?: string
    /** 已有头像 URL（空/缺省才需要回填）。 */
    readonly avatarUrl?: string
  }[]>
  /**
   * 回填头像 URL（**可选能力**：没实现就跳过回填）。
   *
   * 为什么要自动回填：X 推文的 JSON 里本来就带 profile_image_url_https，
   * 而关注对象是我们手动建的、默认没有头像 —— 不自动补，用户就得一个个去
   * 设置页粘贴地址。这里只存 **URL**，不下载图片（用户明确要求「头像最好是
   * 链接渲染而不是保存下来」）：换头像时 URL 失效，界面自然回落到首字球。
   */
  updateAvatar?(id: string, avatarUrl: string): Promise<void>
}

/** 一轮执行所需的依赖。 */
export interface FeedRunDeps {
  store: FeedStore
  writer: FeedWriter
  /** 时刻来源（注入以便测试）。 */
  now: () => number
  /** X 抓取的注入面（fetch / sleep / now）。 */
  xDeps?: XFetchDeps
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
  /** 是否启用 X 同步（默认 true；没配账号时自然什么都不做）。 */
  syncX?: boolean
  /**
   * 关注对象存储（可选）：有它就把「本轮该盯谁」交给 writer，没有就整段不出现。
   *
   * 为什么是可选的：executeRun 是**所有**注入实现（含冒烟里的假 writer）共用的
   * 入口，要求必传会让每一处既有调用点同时编译失败。而缺了它的后果只是
   * 「提示词里少一段关注对象」—— 生成照常、归属仍可靠别名兜底算出来。
   */
  entityStore?: FollowedEntitySource
}

/**
 * 读「本轮关注的对象」，供提示词注入（writer.ts 的 formatFollowedEntitiesBlock）。
 *
 * 三条容错都在这里：
 *  - deps.entityStore 没注入 → 空数组（老调用方与假 writer 场景）；
 *  - store.list() 抛错 → 空数组（关注对象只是提示词里的一段数据）；
 *  - 单项缺名字 → 丢掉（空名字喂给模型只会得到一句「（无）」）。
 *
 * 只投影 name / kind / aliases 三个字段：id 不能让模型看见（它会照抄进输出、
 * 抄错就静默丢失归属），头像与 URL 对写内容没有帮助、只是白占 token。
 * 投影复用 entities.ts 的 writerEntitiesOf —— 排序口径（weight 降序）只有一处。
 */
async function followedEntitiesOf(
  deps: FeedRunDeps,
): Promise<readonly { name: string; kind: 'person' | 'company'; aliases: readonly string[] }[]> {
  if (deps.entityStore === undefined) return []
  try {
    // writerEntitiesOf 吃的是 EntityLike（name/kind/aliases/weight/createdAt 全可选），
    // 所以注入实现只给名字也能用，不需要在这里补齐其余字段。
    return writerEntitiesOf(await deps.entityStore.list())
  } catch {
    return []
  }
}

/**
 * 读**完整实体表**（换 id 用；与 followedEntitiesOf 的区别是不裁剪、不投影）。
 *
 * resolveEntityIds 需要别名与 id，所以不能复用 writerEntitiesOf 的投影
 * （那份刻意剥掉了 id）。读失败给空数组：归属是附加信息，读不到不该让落盘失败。
 */
async function followedEntitiesTable(deps: FeedRunDeps): Promise<readonly EntityLike[]> {
  if (deps.entityStore === undefined) return []
  try {
    const list = await deps.entityStore.list()
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 一轮执行的结果（写进 run 记录，也用于冒烟断言）。 */
export interface FeedRunOutcome {
  run: FeedRun
  posts: FeedPost[]
  sync: XSyncRoundResult | null
}

/**
 * 取最近发过的**完整信息**（标题 + 主题 + 来源域名），交给模型自己判断重复。
 *
 * 只取未删的、最近的若干条：删掉的帖子不该再影响新内容（用户删它就是因为
 * 不想再看到那个话题），而越老的越可能是已经过时的重复主题。
 *
 * 读盘失败时返回空数组 —— 去重是尽力而为的优化，读不到不该让整轮失败。
 *
 * @param limit - 条数上限（默认 MAX_KNOWN_POSTS_FOR_PROMPT = 30，任务要求从 12 扩到 30）。
 */
export async function recentPosts(store: FeedStore, limit = MAX_KNOWN_POSTS_FOR_PROMPT): Promise<KnownPostBrief[]> {
  try {
    const posts = await store.listPosts()
    return posts
      .filter(post => post.deletedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit))
      .map(post => ({
        title: typeof post.title === 'string' ? post.title.trim() : '',
        topics: Array.isArray(post.topics) ? post.topics.filter(topic => typeof topic === 'string' && topic !== '') : [],
        // 只给域名，不给完整 URL —— 闸 2 不让模型看到任何可抄的链接（见 writer.ts 文件头）。
        domains: [...new Set((post.sources ?? [])
          .map(source => (typeof source?.domain === 'string' && source.domain !== '') ? source.domain.trim() : '')
          .filter(domain => domain !== ''))],
        createdAt: post.createdAt,
      }))
      .filter(brief => brief.title !== '')
  } catch {
    return []
  }
}


/**
 * 执行一轮生成（**不负责**闸门：调用方必须先通过 requestRun 拿到许可）。
 *
 * 每个阶段独立 try/catch —— 尤其 X 同步失败**绝不能**让整轮失败：
 * 抓不到 X 只是「本轮没有 X 线索」，其它阶段照常。
 *
 * 阶段与 §4 的对应：1 载入上下文 → 3 检索（X 同步 = 固定来源的检索）
 * → 5 写作 → 6 校验 → 7 落盘上架。规划检索与验活留给 P2（需要 ctx.web）。
 */
/**
 * 把抓到的推文作者头像回填到关注对象上（只写 URL，不下载图片）。
 *
 * 匹配键是 X 账号（小写）。三种情况直接跳过：
 *   · deps.entityStore 没注入 / 没实现 updateAvatar（冒烟里的假实现）；
 *   · 这个 handle 不在关注列表里（本轮抓了别人的推文，不该凭空建实体）；
 *   · 该实体**已经有头像**了（不覆盖用户手动设置的，也不重复写盘）。
 *
 * 全程 try/catch：头像回填失败绝不能让一整轮生成失败。
 */
/**
 * 把 X 头像地址从 48px 的小图换成 400px 的大图。
 *
 * 推文 JSON 给的 profile_image_url_https 结尾是 _normal（48x48），
 * 放在左栏 22px 的位置上、retina 屏会明显发糊。X 同一张图有固定几档尺寸，
 * 换掉文件名后缀即可拿到大图（_400x400 / _bigger / _mini），不需要重新上传。
 * 只改后缀、不改域名与路径，所以它仍是**同一个外链**，不涉及下载保存。
 */
function upgradeAvatarSize(url: string): string {
  if (url === '') return ''
  return url.replace(/_normal(\.(?:jpg|jpeg|png|gif|webp))$/i, '_400x400$1')
}

async function backfillAvatars(
  deps: FeedRunDeps,
  tweets: readonly XTweet[],
): Promise<void> {
  const store = deps.entityStore
  if (store?.updateAvatar === undefined) return
  try {
    const list = await store.list()
    const byHandle = new Map<string, { id: string; hasAvatar: boolean }>()
    for (const entity of list) {
      const handle = entity.xHandle?.trim().toLowerCase() ?? ''
      if (handle === '') continue
      byHandle.set(handle, { id: entity.id, hasAvatar: (entity.avatarUrl ?? '') !== '' })
    }
    if (byHandle.size === 0) return
    const done = new Set<string>()
    for (const tweet of tweets) {
      const handle = tweet.handle.trim().toLowerCase()
      const avatar = upgradeAvatarSize(tweet.avatar.trim())
      if (avatar === '') continue
      const target = byHandle.get(handle)
      if (target === undefined || target.hasAvatar || done.has(target.id)) continue
      done.add(target.id)
      await store.updateAvatar(target.id, avatar)
    }
  } catch (error) {
    deps.logger?.warn?.('[dsh-feed] avatar backfill skipped: '
      + (error instanceof Error ? error.message : String(error)))
  }
}

export async function executeRun(
  deps: FeedRunDeps,
  runId: string,
  trigger: FeedTriggerKind,
  config: FeedConfig,
): Promise<FeedRunOutcome> {
  const now = deps.now
  const startedAt = now()
  const promptHash = promptHashOf(config.prompt)

  /*
   * ── 阶段 0：定出本轮的时间窗（「只更新上次时间节点到现在」）─────────────
   *
   * 水位线 = 上一轮**成功**生成的完成时刻。为什么不用 state.lastRunAt：
   * 那个字段 upsertRun 每轮都写（含失败轮），于是「上一轮 3 秒就挂了」会让
   * 下一轮的窗口只有 3 秒、什么都检索不到。
   *
   * 读盘失败**不能让整轮失败**：拿不到水位线就回落成「7 天前」并标注
   * sinceFallback=true（用户能从 stats 看出这轮为什么翻得这么早）。
   * resolveSinceWindow 本身不抛，这里的 try/catch 兜的是 store 读盘异常。
   */
  let sinceWindow = resolveSinceWindow({ now: startedAt })
  try {
    const snapshot = await deps.store.snapshot()
    sinceWindow = resolveSinceWindow({
      now: startedAt,
      lastOkRunAt: lastOkRunAtOf(snapshot.runs),
      lastRunAt: snapshot.lastRunAt,
    })
  } catch (error) {
    deps.logger?.warn?.('[dsh-feed] since watermark unavailable, falling back to 7d: '
      + (error instanceof Error ? error.message : String(error)))
  }

  const stats: FeedRunStats = {
    searched: 0, fetched: 0, dropped: 0, postsCreated: 0, tokensIn: 0, tokensOut: 0,
    sinceAt: sinceWindow.sinceAt,
    ...(sinceWindow.fallback ? { sinceFallback: true } : {}),
    sinceSource: sinceWindow.source,
  }
  let run: FeedRun = {
    id: runId,
    trigger,
    modelUsed: config.model,
    startedAt,
    status: 'running',
    stats: { ...stats },
  }

  // ── 阶段：X 同步（可失败、可跳过）────────────────────────────────
  let sync: XSyncRoundResult | null = null
  const freshTweets: XTweet[] = []
  const staleTweets: XTweet[] = []
  if (deps.syncX !== false && config.xHandles.length > 0) {
    try {
      const syncState = await deps.store.listXSync()
      const snapshot: Record<string, XSyncState> = { ...syncState }
      sync = await runXSyncRound(
        config.xHandles,
        snapshot,
        { ...deps.xDeps, now },
        async (state, result) => {
          snapshot[state.handle] = state
          await deps.store.setXSync(state)
          stats.searched += 1
          if (result.outcome === 'ok') {
            stats.fetched += 1
            freshTweets.push(...result.fresh)
            staleTweets.push(...result.stale)
          }
        },
      )
      await deps.store.touchSync(now())
      deps.logger?.info?.('[dsh-feed] x sync: ' + sync.summary)
      /*
       * 顺手回填关注对象的头像（用户 2026-10-28：「把头像放账号名称左侧，
       * 头像最好是链接渲染而不是保存下来」）。
       *
       * 只存 **URL**，不下载图片：X 的 profile_image_url_https 本身就是个
       * 稳定直链，前端 referrerPolicy=no-referrer 就能直接渲染；存图片文件
       * 反而要处理格式/体积/失效，且用户明确说了不要保存。
       *
       * 失败不影响本轮：头像只是展示信息，回填不到就继续用首字球。
       */
      await backfillAvatars(deps, [...freshTweets, ...staleTweets])
    } catch (error) {
      // 同步炸了也不影响本轮：当作「没有 X 线索」，照常写作。
      deps.logger?.warn?.('[dsh-feed] x sync failed: ' + (error instanceof Error ? error.message : String(error)))
      sync = null
    }
  }

  // ── 阶段：写作（writer 可注入；默认是 writer.ts 的真实流水线）──────
  //
  // 三条与「不许假数据」直接相关的约定：
  //  1. writer 抛错 → **0 条帖子** + status='failed' + error 说清原因。
  //     绝不 fallback 到任何本地生成的占位内容（那条路已经整块删掉）。
  //  2. knownPosts（标题 + 主题 + 来源）由这里从存量 posts 里取：模型自己看不到
  //     历史，最容易把同一条新闻换个说法再写一遍。摆给模型是为了让它**自己判断**
  //     语义重复（用户 2026-10-27 明确要求），而不是靠代码算字符串相似度。
  //  3. report 是**出参**：真实 writer 往里写过程计数（queries / rawChars /
  //     来源三态），这里并进 run.stats —— 用户从 /status 就能看出链路走到
  //     哪一步。假 writer 不填就是空的，语义刚好。
  let drafts: FeedDraft[] = []
  const report: FeedWriteReport = {}
  /*
   * knownPosts 在 try 外面先取：写作前的「已有内容清单」要取不到也照常写
   * （去重是优化，不能变成整轮的前置条件）。recentPosts 内部已 try/catch，
   * 读盘失败返回空数组。
   */
  const knownPosts = await recentPosts(deps.store)
  /*
   * 本轮关注的对象（右侧悬浮球里那几枚球对应的人）。
   *
   * 读失败给空数组：它只是提示词里的一段**数据**，读不到就不注入，
   * 绝不因此让整轮失败（判重的兜底与归属的别名匹配都不依赖它）。
   */
  const followedEntities = await followedEntitiesOf(deps)
  try {
    drafts = await deps.writer({
      runId,
      trigger,
      config,
      promptHash,
      freshTweets,
      staleTweets,
      sync,
      now: now(),
      // 时间窗与水位线一起交给 writer：它负责检索限定 + 结果过滤 + 提示词。
      sinceAt: sinceWindow.sinceAt,
      sinceFallback: sinceWindow.fallback,
      knownTitles: knownPosts.map(brief => brief.title),
      knownPosts,
      ...(followedEntities.length > 0 ? { followedEntities } : {}),
      report,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    run = {
      ...run,
      // modelUsed 优先用 writer 报告的实际路由（配置的 'default' 不是模型名，
      // 直接写进记录等于没记 —— 排查时看不出真用了谁）。
      modelUsed: report.modelUsed ?? run.modelUsed,
      status: 'failed',
      finishedAt: now(),
      error: message.startsWith('writer failed: ') ? message : 'writer failed: ' + message,
      stats: mergeReportIntoStats(stats, report),
    }
    await deps.store.upsertRun(run)
    return { run, posts: [], sync }
  }

  // ── 阶段：校验 + 兜底去重 + 落盘（硬上限 5 条/轮）────────────────────
  const created: FeedPost[] = []
  try {
    /*
     * 先校验、再**去重**、最后才建 FeedPost。顺序有讲究：
     *
     *  - 去重必须在校验**之后**：被 sanitizeDraft 丢掉的草稿不该占着去重池；
     *  - 去重必须在建对象**之前**：否则要给「建好又丢掉」的帖补一道回滚逻辑，
     *    而那种回滚没人会写对。
     *
     * 去重是**兜底**：主力是模型自己判断（见 writer.ts 的 formatKnownPostsBlock
     * 与输出里的 skipped[]）。这里只拦两条零歧义的（标题字符级相同、来源
     * 集合完全相同），见 incremental.ts 的分工说明。
     */
    const cleaned: CleanDraft[] = []
    for (const draft of drafts.slice(0, FEED_MAX_POSTS_PER_RUN)) {
      const clean = sanitizeDraft(draft)
      if (clean === null) {
        stats.dropped += 1
        continue
      }
      cleaned.push(clean)
    }

    const existing = (await deps.store.listPosts()).filter(post => post.deletedAt === undefined)
    const deduped = dedupePosts(cleaned, existing, { existingLimit: MAX_DEDUPE_EXISTING })
    if (deduped.dropped.length > 0) {
      stats.dropped += deduped.dropped.length
      stats.dropReasons = { ...deduped.counts }
      for (const item of deduped.dropped.slice(0, 3)) {
        deps.logger?.info?.('[dsh-feed] dedupe dropped (' + item.reason + '): ' + item.detail)
      }
    }

    /*
     * 实体表在落盘前读一次：模型标的「名字」要在这里换成 id 写进 entityIds。
     *
     * 读不到就是空表 → resolveEntityIds 返回空数组 → 这条不写 entityIds。
     * 这**不是**功能失效：GET /posts 的归属判定还有别名兜底（createEntityMatcher），
     * 而落盘的 id 只是「模型当时明确说了是谁」的那一份记录。
     */
    const entityTable = await followedEntitiesTable(deps)
    for (const clean of deduped.kept) {
      const xFetchedAt = sync?.results.find(result => result.outcome === 'ok')?.fetchedAt ?? 0
      const entityIds = resolveEntityIds(clean.entityNames, entityTable)
      created.push({
        id: newPostId(),
        createdAt: now(),
        topics: clean.topics,
        title: clean.title,
        body: clean.body,
        sources: clean.sources,
        /*
         * 媒体：**空数组不落盘**（与 entityIds 同一口径）。
         *
         * posts.json 是纯文本、整份读写，给每条帖子挂一个恒为空的字段
         * 既费体积，又会让客户端去猜「是没媒体还是没渲染」。
         */
        ...(clean.media.length > 0 ? { media: clean.media } : {}),
        /*
         * 原文（2026-10-28 用户要求「不要压缩原文内容」）：
         * 与 media 同一口径 —— 没有就不落这一格，避免 posts.json 里挂一堆空串。
         */
        ...(typeof clean.originalText === 'string' && clean.originalText !== ''
          ? { originalText: clean.originalText }
          : {}),
        ...(typeof clean.originalLang === 'string' && clean.originalLang !== ''
          ? { originalLang: clean.originalLang }
          : {}),
        dueAt: clean.dueAt,
        dueLabel: clean.dueLabel,
        likes: 0,
        comments: [],
        runId,
        promptHash,
        /*
         * 只在真的匹配上时才写这一格。空数组不落盘（与 withResolvedEntities
         * 的口径一致）：响应里出现一个恒为空的字段，只会让客户端去猜
         * 「是没归属还是没渲染」。
         */
        ...(entityIds.length > 0 ? { entityIds } : {}),
        ...(xFetchedAt > 0 ? { xFetchedAt } : {}),
      })
    }
    if (created.length > 0) await deps.store.addPosts(created)
    /*
     * 一条都没过闸时的状态：**ok / skipped / failed 三选一**（2026-10-27 修误报）。
     *
     * 判据是"0 条产出是什么性质"，三条互斥：
     *
     *  1. 有产出 → **ok**（结束，下面不看）。
     *  2. writer 产了草稿、但全被 sanitizeDraft / 兜底去重 / 硬上限挡掉
     *     → **skipped**（本轮确实写了一轮，只是没有可上架的新内容）。
     *  3. writer 一条草稿都没产，但**明确报告「模型判重，本轮没有新内容」**
     *     → **skipped** + noNewContentReason。这是用户实测里那种情形：模型
     *     逐条比对后把所有候选判为重复，是「让模型自己判断去重」正常工作的
     *     证据，不是故障。记成 failed 会让界面报红色「更新失败」，用户以为坏了。
     *  4. 上面都不是（0 条草稿、也没有判重标记）→ **failed** 并写明原因。
     *     ⚠ 这条必须保留：注入的 writer 返回空数组、或 writer 出了新的 bug 时
     *     都要在这里露出，不能被第 3 条顺带吞掉。
     *
     * error 只给真实故障 —— skipped 是正常态，写上任何「失败」字样都会
     * 让界面（与用户）把它读成出错。
     */
    const wroteSomething = drafts.length > 0
    const noNewContent = report.noNewContent === true
    const status: FeedRunStatus = created.length > 0
      ? 'ok'
      : (wroteSomething || noNewContent ? 'skipped' : 'failed')
    run = {
      ...run,
      modelUsed: report.modelUsed ?? run.modelUsed,
      status,
      finishedAt: now(),
      ...(status === 'failed' ? { error: '本轮没有产出任何内容（writer 返回 0 条草稿）' } : {}),
      stats: mergeReportIntoStats({ ...stats, postsCreated: created.length, dropped: stats.dropped + (report.dropped ?? 0) }, report),
    }
  } catch (error) {
    run = {
      ...run,
      status: 'failed',
      finishedAt: now(),
      error: 'persist failed: ' + (error instanceof Error ? error.message : String(error)),
      stats: mergeReportIntoStats(stats, report),
    }
  }
  await deps.store.upsertRun(run)
  return { run, posts: created, sync }
}

/* ───────────────────────── 单飞锁 ───────────────────────── */

/** 闸门依赖（与 FeedRunDeps 分开：闸门不需要 writer）。 */
export interface GateDeps {
  store: FeedStore
  now: () => number
  /** 真正跑一轮的实现（由 createFeedRunner 绑定）。 */
  run: (runId: string, trigger: FeedTriggerKind) => Promise<unknown>
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
}

/* ── 闸门临界区锁（2026-10-27 修并发重复跑）──────────────────────────
 *
 * ## 为什么必须有它
 *
 * 闸门的「读 → 判 → 写」三步之间隔着 await：
 *
 *     const gate = await deps.store.getGate()   // 读
 *     if (gate 还在跑) { ... }                  // 判
 *     await deps.store.setGate({ running })     // 写
 *
 * 单次请求是安全的，但**并发**时不是：6 个 HTTP 请求几乎同时到达，Node 并发
 * 处理，6 个调用都先 await getGate() 拿到同一份「idle」快照，然后依次全都走
 * 到「起新一轮」分支 —— 于是 6 次全部 started、真的跑了 6 轮，闸门形同虚设。
 *
 * 这不是理论风险：用户狂点「更新」按钮就是这个形态（每次点击一个 fetch），
 * 线上必然复现。串行 await 的测试**看不出**这个问题（每次都能读到上一个写），
 * 所以冒烟必须用 Promise.all 并发发请求。
 *
 * ## 为什么是进程内锁而不是文件锁
 *
 * 落盘的闸门已经保证**跨进程**语义（第二个进程读到磁盘上的 running）。这里
 * 补的是**同一进程内的并发**，用一把内存锁就够；文件锁（open 'wx'）属于加固，
 * 而且每个请求都去开一次文件比内存锁贵得多。两者管的不是同一件事，不重复。
 *
 * ## 按 store 实例分锁
 *
 * 用 WeakMap 以 store 为键：不同 store（测试里会造好几个，各自指向不同
 * DSH_HOME）互不阻塞，同一个 store 的请求严格串行。
 */
const gateLocks = new WeakMap<FeedStore, { tail: Promise<unknown> }>()

/** 取某个 store 的锁记录（懒建）。 */
function gateLockOf(store: FeedStore): { tail: Promise<unknown> } {
  let lock = gateLocks.get(store)
  if (lock === undefined) {
    lock = { tail: Promise.resolve() }
    gateLocks.set(store, lock)
  }
  return lock
}

/**
 * 在临界区里串行执行。
 *
 * `lock.tail.then(fn, fn)`：前一个任务**成功或失败**都要接着跑（否则一次
 * 异常就把整条队列卡死）。链表尾部单独吞掉异常，避免 unhandled rejection
 * 污染后续等待者。
 */
function withGateLock<T>(store: FeedStore, fn: () => Promise<T>): Promise<T> {
  const lock = gateLockOf(store)
  const next = lock.tail.then(fn, fn)
  lock.tail = next.catch(() => undefined)
  return next
}

/**
 * 请求启动一轮（方案 §5.2 的实现，**逐条对应**那段伪代码）。
 *
 * 三种返回：
 *  - started  —— 本轮已开跑；
 *  - queued   —— 上一轮还在跑，这次的请求**合并进当前轮**（第一次）；
 *  - rejected —— 已经排过一次队了，连续点第 2..N 次直接丢弃。
 *
 * 关键语义（最容易写错的地方）：**queued 不是「再排一轮」，而是「合并进
 * 正在跑的那一轮」**。所以收敛时清标记、**不立刻再跑** —— 否则「点 5 次跑
 * 2 轮」，验收 2 就永远过不了。
 *
 * 「读-判-写」整段在 withGateLock 临界区里（见上方长注释）：临界区内**绝不
 * await 真正的 run**（那是长任务，会把所有请求都堵住），只 `void` 起跑。
 */
export function requestRun(deps: GateDeps, trigger: FeedTriggerKind): Promise<RunRequestResult> {
  return withGateLock(deps.store, async (): Promise<RunRequestResult> => {
    const now = deps.now()
    const gate = await deps.store.getGate()

    // ① 有活锁 → 拦下。
    if (gate.status === 'running' && gate.leaseUntil > now) {
      if (gate.queued === false) {
        await deps.store.setGate({
          ...gate,
          queued: true,
          queuedTrigger: trigger,
          blockedCount: gate.blockedCount + 1,
        })
        return 'queued'
      }
      await deps.store.setGate({ ...gate, blockedCount: gate.blockedCount + 1 })
      return 'rejected'
    }

    // ② 死锁（进程崩了 / 租约过期）→ 收回，把那条僵尸 run 标成失败。
    if (gate.status === 'running' && gate.runId !== null) {
      const zombieId = gate.runId
      try {
        const runs = await deps.store.listRuns()
        const zombie = runs.find(item => item.id === zombieId)
        if (zombie !== undefined && zombie.status === 'running') {
          await deps.store.upsertRun({ ...zombie, status: 'failed', finishedAt: now, error: 'lease expired' })
        }
      } catch { /* 收回失败也要能继续起新一轮（否则永久卡死） */ }
      deps.logger?.info?.('[dsh-feed] reclaimed expired lease of ' + zombieId)
    }

    // ③ 起新一轮。
    const runId = newRunId()
    await deps.store.setGate({
      status: 'running',
      runId,
      leaseUntil: now + LEASE_MS,
      queued: false,
      queuedTrigger: null,
      blockedCount: gate.blockedCount,
    })
    // 不 await：HTTP 路由要在启动后立刻返回 started（§5.2 的 void executeRun）。
    void deps.run(runId, trigger).catch((error: unknown) => {
      deps.logger?.warn?.('[dsh-feed] run ' + runId + ' threw: ' + (error instanceof Error ? error.message : String(error)))
    })
    return 'started'
  })
}

/**
 * 续租（§5.2「执行期间每 60s 续租一次」）。
 *
 * 返回一个 stop()：一轮结束时调用它清掉定时器并把闸门收回 idle。
 * 定时器 unref()（若可用）—— 否则常驻的续租计时器会拖住 Node 进程退出，
 * 表现为「DSH 关不掉」。
 */
export function startLeaseRenewal(deps: GateDeps, runId: string): { stop: () => Promise<void> } {
  const { store } = deps
  let stopped = false

  const timer = setInterval(() => {
    if (stopped) return
    /*
     * 续租也要进临界区（2026-10-27 补）。
     *
     * 它是一个独立的定时器，与请求路径共享同一份磁盘闸门：不上锁时可能出现
     *
     *   tick:   getGate() → 读到 running
     *   stop(): setGate(idle)        ← 一轮刚好在这时结束
     *   tick:   setGate({...旧快照, running})  ← 把已经收敛的闸门「复活」了
     *
     * 复活后的闸门 status=running 但**没有任何 run 在跑**，要等 10 分钟租约
     * 过期才会被回收 —— 这 10 分钟里用户点更新永远只拿到 queued/rejected，
     * 表现就是「更新按钮失灵了」。进同一个临界区即可消除这个窗口。
     */
    void withGateLock(store, async () => {
      try {
        const gate = await store.getGate()
        // 闸门已经被别人接管（例如租约过期后另一轮起了）→ 不再续租。
        if (gate.status !== 'running' || gate.runId !== runId) return
        await store.setGate({ ...gate, leaseUntil: deps.now() + LEASE_MS })
      } catch { /* 续租失败不致命：租约到期后会被回收，最坏是多重一轮 */ }
    })
  }, LEASE_RENEW_MS)
  // Node 环境下 unref 让计时器不阻止进程退出。
  ;(timer as unknown as { unref?: () => void }).unref?.()

  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      // 同样进临界区：与 requestRun 的「读存量 → 起新一轮」严格串行，
      // 否则会出现「刚清成 idle，另一次请求判定时还没读到」的交叉。
      await withGateLock(store, async () => {
        try {
          const gate = await store.getGate()
          if (gate.status === 'running' && gate.runId === runId) {
            // 收敛：清掉排队标记但**不立刻再跑**（queued 的语义是「合并进本轮」，
            // 见 requestRun 的说明 —— 这里如果再跑一轮，验收 2 必挂）。
            await store.setGate({
              status: 'idle',
              runId: null,
              leaseUntil: 0,
              queued: false,
              queuedTrigger: null,
              blockedCount: gate.blockedCount,
            })
          }
        } catch { /* 收尾失败不影响本轮已经完成的工作 */ }
      })
    },
  }
}

/* ───────────────────────── 组合：带闸门的完整一轮 ───────────────────────── */

/** 完整一轮的装配结果。 */
export interface FeedRunner {
  requestRun: (trigger: FeedTriggerKind) => Promise<RunRequestResult>
  /** 等待当前在跑的轮次收敛（冒烟用；生产路径不需要）。 */
  idle: () => Promise<void>
}

/**
 * 把闸门与执行粘在一起（路由层只需要 requestRun）。
 *
 * 收尾顺序是有讲究的：**先跑完 executeRun，再 stop 续租**。反过来会留一个
 * 窗口 —— 续租停了但 run 还在跑，租约到期后另一次点击就能起第二轮，于是
 * 「同一时刻只有一轮」被打破。
 */
export function createFeedRunner(deps: FeedRunDeps): FeedRunner {
  /** 当前在跑的 Promise（仅用于 idle()，闸门本身以磁盘为准）。 */
  let inflight: Promise<unknown> | null = null

  const gateDeps: GateDeps = {
    store: deps.store,
    now: deps.now,
    logger: deps.logger,
    /*
     * 刻意写成**非 async 的包装**：run 被调用时第一件事就是把 task 赋给 inflight，
     * 这一句必须同步执行。若写成 `run: async (...) => { const config = await ... }`，
     * inflight 会晚于 requestRun 的返回才被赋值，于是 idle() 在那一刻读到 null
     * 直接返回 —— 等待方以为「已经跑完了」，实际一轮刚开始（冒烟里表现为
     * 「产帖 0 条 + 没有任何 run 记录」）。
     */
    run: (runId, trigger) => {
      const task = (async () => {
        let lease = null
        try {
          const config = await deps.store.getConfig()
          lease = startLeaseRenewal(gateDeps, runId)
          await executeRun(deps, runId, trigger, config)
        } catch (error) {
          deps.logger?.warn?.('[dsh-feed] run ' + runId + ' failed: '
            + (error instanceof Error ? error.message : String(error)))
        } finally {
          /*
           * 先收敛 run，再放开闸门。
           *
           * ⚠ 两条路径都必须收敛（2026-10-28 修「刷新机制」）：
           *   · lease 已建立 → lease.stop() 里会清闸门；
           *   · **lease 没建立**（上面 getConfig() 就抛了，lease 仍是 null）→
           *     原来这里什么都不做，而 requestRun 早就把闸门置成了 running。
           *     后果是用户点一次「更新」之后要等 10 分钟租约过期才能再点 ——
           *     界面上就是「更新按钮失灵 / 一直在生成中」。这里手动收回。
           */
          if (lease !== null) {
            await lease.stop()
          } else {
            await withGateLock(deps.store, async () => {
              try {
                const gate = await deps.store.getGate()
                if (gate.status === 'running' && gate.runId === runId) {
                  await deps.store.setGate({
                    status: 'idle',
                    runId: null,
                    leaseUntil: 0,
                    queued: false,
                    queuedTrigger: null,
                    blockedCount: gate.blockedCount,
                  })
                }
              } catch { /* 收尾失败不影响任何已完成的工作 */ }
            })
          }
        }
      })()
      inflight = task
      return task
    },
  }

  return {
    requestRun: trigger => requestRun(gateDeps, trigger),
    idle: async () => {
      while (inflight !== null) {
        const current = inflight
        await current.catch(() => undefined)
        if (inflight === current) inflight = null
      }
    },
  }
}

/** 导出给冒烟对拍。 */
export const __test = { sanitizeDraft }
