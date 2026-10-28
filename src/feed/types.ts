/**
 * dsh-chat-plus — 个人动态（Feed）· 数据模型（host 半身）。
 *
 * 形状以 `docs/2026-10-25-personal-feed-design.md` §3 为基准，**逐字段照抄**；
 * §3 之外只做三处必要扩展，每处都在下面标了 § 编号，理由同批写明 —— 不加
 * 「看起来会用得上」的字段，因为每一格都要写进 posts.json 并且永远迁移不掉。
 *
 * ── 与设计文档的三处扩展 ─────────────────────────────────────────────
 *
 *  1. `FeedPost.readAt`（§6.3 提到 readAt 集合，但没定它落哪）。排序在
 *     **服务端**（§8「排序放服务端」），服务端就必须知道已读状态；而 §6.3
 *     说 readAt 只在「展开正文 / 打开讨论 / 点开原文」时写，不是进页面就写。
 *     放 post 上最省事：一个字段、一次 patch，不用第二张表与两处一致性。
 *  2. `FeedPost.deletedAt`（§8「删除必须是软删：deletedAt，列表过滤」直接点名）。
 *  3. `FeedConfig.xHandles`（§4.2「取账号列表」但 §3 的 FeedConfig 没定义来源）。
 *     默认空数组 = 默认**不联网**，P1 阶段（假内容验收）不会被外部请求干扰。
 *
 * ── 时间口径 ─────────────────────────────────────────────────────────
 *
 * 全部时间戳都是**毫秒**（与 DSH 其余模块一致）。`dueAt === 0` 表示无截止，
 * 这是 §3 明确规定的哨兵值，所以任何地方都不许把 0 当成「1970 年过期」——
 * 判过期一律走 rank.ts 的 `isExpired()`，别就地写 `p.dueAt < Date.now()`。
 *
 * @module
 */

import { randomUUID } from 'node:crypto'

/* ───────────────────────────── 动态 ───────────────────────────── */

/** 一条动态。落盘在 posts.json。 */
export interface FeedPost {
  /** `p_<uuid>`。 */
  id: string
  /** 生成时间（毫秒），排序与「按天分组」的**唯一**时间源。 */
  createdAt: number

  /** 归属主题（左栏频道）。`'mine'` 表示同时属于「我的动态」频道。 */
  topics: string[]

  /** 现写的标题（不是原文标题）。 */
  title: string
  /** 现写的正文。 */
  body: string

  /**
   * 来源推文的**原文全文**（2026-10-28 用户要求）。
   *
   * 用户原话：「X账号相关的动态不要压缩原文内容，如果原文是英文翻译中文原文放里面」。
   *
   * 与 §7.3「limited 不复制正文」的关系：那条边界针对的是**转载他人文章**。
   * 这里是「用户自己主动关注的账号本人的发言」，用户要读原文、要对照翻译，
   * 属于个人阅读器而不是公开发布。所以：正文仍由模型用中文写（翻译 + 转述），
   * 原文另存一格、在界面上以「原文」块展示，并始终附回原推链接。
   *
   * 缺省 = 没有原文（网页来源的帖子、老帖子）。
   */
  originalText?: string
  /**
   * 原文语言（BCP-47 短码，如 'en' / 'zh' / 'ja'）。
   * 用于界面判断「要不要显示『译自英文』」以及原文块的排版方向。
   */
  originalLang?: string

  /** 来源。每条都必须过 §7 的可用性判定。 */
  sources: FeedSource[]

  /**
   * 本条动态带的多媒体（图片 / 视频），**只从 X 来源带过来**。
   *
   * 2026-10-28 用户要求：「他们的动态有图片或视频就把链接放上来，渲染出来，
   * 可播放可查看」。媒体 URL 只有 X syndication 通道给得出（网页检索那一路
   * 只返回正文摘要，没有媒体），所以这一格的数据源是「本条帖子引用的 X 来源」，
   * 由 writer.ts 的 {@link collectDraftMedia} 从抓到的推文里搬过来。
   *
   * 缺省 = 没有媒体（老帖子、纯网页来源、以及推文本身没带图/视频）。
   * 上限 {@link MAX_FEED_MEDIA} 条（X 单条推文最多 4 个媒体）。
   */
  media?: FeedMedia[]

  /** 截止时间（毫秒）。0 表示无截止。 */
  dueAt: number
  /** 展示用，如 '今天 18:00'。 */
  dueLabel: string

  /** 模型生成的基础点赞数（用户点赞另计，见 liked）。 */
  likes: number
  /** 用户是否点了赞（§8「点赞/取消（幂等）」的幂等状态）。 */
  liked?: boolean
  comments: FeedComment[]

  /** 生成这一条的那一轮 id，便于溯源与调试。 */
  runId: string
  /** 生成时用的提示词快照（提示词改了以后老帖仍可解释自己从哪来）。 */
  promptHash: string

  /** 已读时刻（§6.3；缺省 = 未读）。 */
  readAt?: number
  /** 软删时刻（§8；缺省 = 未删）。列表一律过滤掉有值的。 */
  deletedAt?: number

  /**
   * 这条动态归属的**关注对象** id 列表（`fe_…`，见 {@link FollowedEntity}）。
   *
   * 2026-10-27「右侧悬浮球 · 点开看某个人/公司的动态」新增，**只追加**：
   *  - 生成侧（writer）把关注列表的名字与别名注入提示词，让模型在输出里标
   *    `entities: ["OpenAI"]`，落盘时按名字/别名换回 id 存进这里；
   *  - 查询侧（api.ts 的 `GET /posts?entity=<id>`）先看这一格，
   *    **缺失或为空时**再用实体的 aliases 在 title/body 里做子串兜底
   *    （模型经常忘了标，而「新功能一上来全是空的」比漏标更糟）。
   *
   * 缺省 = 没有归属信息（老帖子、以及模型没标且兜底也没命中的情况）。
   */
  entityIds?: string[]

  /**
   * 本条内容里 X 线索的抓取时刻（毫秒；无 X 来源则为 0）。
   *
   * 为什么挂在帖子上而不是只挂在来源上：`docs/2026-10-27-x-feed-availability.md`
   * §3.2 的硬约束是「缓存逐账号独立、新鲜度不均，**不能把陈旧内容当今天的新事件**」。
   * 判定发生在**写这条帖子的那一刻**，之后来源对象可能被更新，历史判定会失真，
   * 所以把当时的抓取时刻钉在帖子上，界面据此如实标注「抓取于 X 时间」。
   */
  xFetchedAt?: number
}

/** 一条来源（§3 + §7.1）。 */
export interface FeedSource {
  /** 真实 URL（§9 闸 2 校验的真相）。 */
  url: string
  /** 展示用域名，从 URL 解析 —— 不接受模型自由发挥。 */
  domain: string
  /** 来源标题。 */
  title: string
  /**
   * 可用性判定结果。
   *
   * 只有两态：§7.1 的第三态 `blocked`（付费墙 / 私密）在落盘前就**整条丢弃**，
   * 所以它不会出现在数据里 —— 写进类型只会让人以为存在这种来源。
   */
  access: 'open' | 'limited'
  /**
   * 公开可抓取来源的**正文摘要**（§7.3）。
   *
   * `access === 'open'` 时才允许有值；`'limited'` 时**必须**为空 —— 这是
   * §7.3 的法律边界（不能复制不开放抓取平台的内容）。清空动作由
   * sources.ts 的 `tightenSource()` 强制，读盘时 store 再兜一次。
   */
  snippet?: string
  /**
   * 不开放平台来源的**话题线索摘要**（≤200 字符）。
   *
   * 与 snippet 分开是两份文档口径不同的结果：方案 §7.3 说 limited 的
   * 「正文/snippet 必须为空」，而 X 实测报告 §4.3 给了更细的口径 ——
   * 「允许存截断摘要（≤200 字符），但界面标注来源为 X」。两者说的其实不是
   * 同一件东西：前者禁的是**复制正文**，后者要的是**话题线索**。
   *
   * 所以拆成两个字段：snippet 只服务 open 来源、装真正的正文摘要；
   * excerpt 只服务 limited 来源、装一句线索提示。界面据此显示「需在平台查看」，
   * 正文永远由模型自己重写，不构成转载。
   */
  excerpt?: string
  /** 抓取时刻（毫秒）。0 = 未抓（域名预判直接 limited 的情况）。 */
  fetchedAt: number
  httpStatus?: number
}

/**
 * 一个媒体项（落盘形状，落在 {@link FeedPost.media} 里）。
 *
 * 与抓取侧的 {@link XMedia} **分开两个类型**，不是重复：这一份是「已经决定
 * 落盘的东西」，所以
 *  - 没有 `durationSec`（视频时长对渲染没有用，而 posts.json 每一格都要
 *    永远带着、永远迁移不掉）；
 *  - 多一格 `sourceUrl`（推文链接）：媒体是**别人的图片**，界面上要能一键
 *    跳回原推文核对，也让「这张图是哪条动态带来的」在数据里可追。
 *
 * `url` 与 `videoUrl` 的分工（与 X 的返回体一致，别搞反）：
 *  - 图片：`url` = 图片直链，没有 `videoUrl`；
 *  - 视频 / GIF：`url` = **封面图**（pbs.twimg.com），`videoUrl` = mp4 直链
 *    （video.twimg.com）。渲染时封面当 poster、videoUrl 进 <video src>。
 */
export interface FeedMedia {
  /** 图片直链；视频时是封面图。 */
  url: string
  type: 'photo' | 'video' | 'animated_gif'
  /** 视频 mp4 直链（图片时无）。 */
  videoUrl?: string
  width?: number
  height?: number
  /** 推文链接，用于溯源（界面「查看原推」/ 核对版权）。 */
  sourceUrl: string
}

/** 单条动态最多带几个媒体（X 单条推文上限就是 4）。 */
export const MAX_FEED_MEDIA = 4

/** 一条讨论（§3）。 */
export interface FeedComment {
  id: string
  by: 'user' | 'agent'
  text: string
  /** 毫秒时间戳。 */
  at: number
}

/* ───────────────────────────── 配置 ───────────────────────────── */

/** 模块全局配置（保存在 state.json 的 config 段）。 */
export interface FeedConfig {
  /** 用户设置的动态生成提示词。 */
  prompt: string
  /** 写作模型的标识符：'default' = 跟随系统全局主模型。 */
  model: string
  /** 定时表达式，默认一天两次 (12:00, 18:00)。 */
  cron: string
  /**
   * 要同步的 X 账号（§4.2「取账号列表」，§3 未定义来源的最小扩展）。
   * 默认空 = 不同步，P1 假内容验收不会触发任何外部请求。
   */
  xHandles: string[]
}

/** 原型里的默认提示词（§14 与 deliverables/feed-proto/index.html 一致）。 */
export const DEFAULT_FEED_PROMPT = '盯住健身与睡眠，只收一手来源，每天两三条就够'

/** 默认配置。cron 与 §5.1「默认 12:00 / 18:00」一致。 */
export const DEFAULT_FEED_CONFIG: FeedConfig = {
  prompt: DEFAULT_FEED_PROMPT,
  model: 'default',
  cron: '0 12,18 * * *',
  xHandles: [],
}

/** 每轮生成的硬上限（§4.2「硬上限 5 条/轮，防一次刷屏」）。 */
export const FEED_MAX_POSTS_PER_RUN = 5

/**
 * 「算今天的新事件」的新鲜度窗口：72 小时。
 *
 * 依据 `docs/2026-10-27-x-feed-availability.md` §3.2 —— syndication 的缓存是
 * **逐账号独立且不均匀**的（同一轮实测里微软停在当天、github 停在两周前），
 * 而且返回的 entries 还混着几年前的高互动推文。所以「抓到了」不等于「是新的」：
 * 超过这个窗口的推文只能当背景上下文（「这个话题他之前也提过」），
 * 不能当本轮新闻写进动态。判定函数是 sources.ts 的 `splitTweetsByFreshness`。
 */
export const FEED_FRESH_WINDOW_MS = 72 * 60 * 60 * 1000

/**
 * 每个账号最多记住多少个「已见过的推文 id」。
 *
 * 单账号一次最多约 100 条推文，1000 条 ≈ 十次抓取的窗口；再多也只是让
 * 去重表变胖（state.json 是纯文本、要整体读写）。裁剪只丢「最先见到的」，
 * 所以刚抓到的条目一定还在集合里，去重不会因为裁剪而漏判。
 */
export const MAX_SEEN_TWEET_IDS = 1000

/* ───────────────────────────── 一轮生成 ───────────────────────────── */

/** 触发来源（§5.1）。 */
export type FeedTriggerKind = 'schedule' | 'prompt' | 'manual'

/** 一轮生成的统计（§3 的六个基础计数 + 真实流水线的过程计数）。 */
export interface FeedRunStats {
  searched: number
  fetched: number
  /** 被 §7 丢弃的来源数。 */
  dropped: number
  postsCreated: number
  tokensIn: number
  tokensOut: number

  /* ── 以下为 2026-10-27 接上真实流水线后新增的过程计数（全部可选）──────
   *
   * 加它们的理由：全都返回 0 条时，"0 条"本身什么也不说明。而
   *   queries=0 且 rawChars=0  → 检索与模型都没跑起来（查 provider）
   *   rawChars>0 但 postsCreated=0 → 模型写了但全被校验挡下（查提示词/来源）
   * 两种情况的处置完全不同，靠这几个数一眼能分开。
   */

  /** 本轮发了几条检索 query。 */
  queries?: number
  /** 验活判定为 open / limited / blocked 的来源数。 */
  sourcesOpen?: number
  sourcesLimited?: number
  sourcesBlocked?: number
  /** 模型返回的原始字符数（0 = 模型压根没回话）。 */
  rawChars?: number
  /**
   * 本轮实际使用的模型路由（形如 `alymagpie/auto/deepseek-v4.1-flash`）。
   *
   * ⚠ 与 run.modelUsed 的区别：那个是"这一轮的记录"，这个是"过程快照"，
   * 两者由同一份 report 写入所以一定一致；分开是因为老数据里没有这一格，
   * 缺失时界面应该回落到 run.modelUsed 而不是显示"未知"。
   */
  modelUsed?: string
  /** 模型的人类可读名（如 WB-Deepseek-Flash）。 */
  modelLabel?: string
  /** 路由是怎么定下来的：agentDefaultModel / first-available / configured / fallback-default。 */
  modelResolution?: string
  /** 降级说明（如「web 检索不可用」），有值即说明走了降级路径。 */
  degraded?: string

  /* ── 以下为 2026-10-27「增量 + 去重」新增（全部可选，老数据没有这几格）──
   *
   * 用户原话：「只更新上次时间节点到当前时间节点，并且不要重复」。
   * 这一组计数回答的是「这一轮到底『新』到哪一步」—— 全都 0 条时，
   *   sinceFallback=true 且 droppedStale 很大 → 时间窗回落得太早，翻了一堆旧内容
   *   modelSkipped>0                    → 模型自己判断出重复并主动跳过了
   *   dropReasons['dup-title']>0        → 模型没判出来，兜底代码挡下的
   * 三种情况的处置完全不同，靠这几个数一眼能分开。
   */

  /** 本轮实际使用的时间窗起点（毫秒）。见 incremental.ts 的 resolveSinceWindow。 */
  sinceAt?: number
  /** true = 水位线读不到，回落成「7 天前」。 */
  sinceFallback?: boolean
  /** 水位线来源：last-ok-run / last-run-at / fallback。 */
  sinceSource?: string
  /** 因为明确早于 sinceAt 而被丢掉的候选来源数。 */
  droppedStale?: number
  /** 缺 publishedAt、被保留但标注「时间未知」的来源数。 */
  sourcesTimeUnknown?: number
  /**
   * 模型**自己**判断为重复/无信息增量而跳过的条数（输出里的 skipped[]）。
   *
   * 这是「让模型自己判断去重」这条路可观测的落点：模型判了什么、为什么，
   * 都能从这里看出来；它比兜底代码的 dup-title 计数更能反映真实语义重复。
   */
  modelSkipped?: number
  /**
   * 模型给出的跳过理由原文（最多 10 条，形如「重复：与《某标题》同一件事」）。
   *
   * 只存短文本：这是给人看的一句话，不是结构化数据；结构化会诱使未来
   * 有人拿它去做二次判定，而判定权已经明确交给模型了。
   */
  modelSkipNotes?: string[]
  /** 兜底去重各丢了几条（键是 dup-title / dup-source）。 */
  dropReasons?: Record<string, number>

  /* ── 以下为 2026-10-27「模型全判重复 ≠ 更新失败」新增 ──────────────────
   *
   * 用户实测：一轮跑完后 run.status='failed'，但模型其实**完全正确** —— 它
   * 逐条比对 30 条已发内容后认为 11 条候选全是重复，于是主动全部跳过。
   * 那是「让模型自己判断去重」正常工作的证据，不是故障。
   *
   * 所以 0 条产出必须分两种情况记：模型明说「没有新内容」（skipped），
   * 与链路真的坏了（failed）。这一格就是那个区分标记。 */

  /**
   * true = 模型**明确回报**它跳过了候选、本轮确实没有新内容（不是故障）。
   *
   * 只写 true、不写 false：缺省就是「没有这个标记」，写一个恒为 false 的键
   * 只会让界面去猜「是没标记还是标记为假」。
   */
  noNewContent?: boolean
  /**
   * 一句话说明为什么没有新内容（给界面直接用，如
   * 「模型判断 11 条候选都与已发内容重复」）。
   *
   * 与 modelSkipNotes 分工：这条是**结论**（一句），notes 是**逐条证据**
   * （模型给的具体理由，界面折叠展示）。
   */
  noNewContentReason?: string
}

/**
 * 一轮生成的结局。
 *
 * 四态，其中 `skipped` 与 `failed` 的分工是本模块最容易做错的一处：
 *
 * | 场景 | status | 理由 |
 * |---|---|---|
 * | 有产出 | `ok` | 正常 |
 * | 0 条，但模型回报了 skipped[] | `skipped` | 模型主动判重，正常态 |
 * | 0 条，且 JSON 里就没有条目 | `failed` | 异常 |
 * | 有产出但全部校验失败 | `failed` | 产出有问题 |
 * | JSON 解析失败 / 模型调用报错 | `failed` | 真故障 |
 *
 * ⚠ 绝不能用 `ok` 混过去：`ok` 表示「有产出」，而 `skipped` 表示
 * 「跑完了、没出错、只是没有新内容」。两者在界面上是两种颜色、两句话，
 * 用户对它们的反应也完全不同（一个是「更新了」，一个是「没有新东西」）。
 */
export type FeedRunStatus = 'running' | 'ok' | 'failed' | 'skipped'

/** 一轮生成的记录（§3）。 */
export interface FeedRun {
  id: string
  trigger: FeedTriggerKind
  /** 本轮写作实际使用的模型标识符。 */
  modelUsed: string
  startedAt: number
  finishedAt?: number
  status: FeedRunStatus
  /** 有值表示这次被拦下（上一轮还在跑）。 */
  blockedBy?: string
  stats?: FeedRunStats
  error?: string
}

/* ───────────────────────────── 单飞锁 ───────────────────────────── */

/** 闸门状态（§5.2，形状逐字段照抄）。落盘在 state.json 的 gate 段。 */
export interface GateState {
  status: 'idle' | 'running'
  runId: string | null
  /** 租约：防止进程崩溃后锁永久残留。 */
  leaseUntil: number
  /** 排队标记：最多一次，合并。 */
  queued: boolean
  queuedTrigger: FeedTriggerKind | null
  /** 被拦下的累计次数（原型「已拦下 N 次」）。 */
  blockedCount: number
}

/** 空闲闸门。 */
export const IDLE_GATE: GateState = {
  status: 'idle',
  runId: null,
  leaseUntil: 0,
  queued: false,
  queuedTrigger: null,
  blockedCount: 0,
}

/* ───────────────────────────── X 同步 ───────────────────────────── */

/**
 * 单个 X 账号的同步状态（`docs/2026-10-27-x-feed-availability.md` §4.1，逐字段照抄）。
 */
export interface XSyncState {
  /** 账号 @名（小写，不含 @）。 */
  handle: string
  /** 上次成功抓取时间（毫秒）。 */
  lastFetchedAt: number
  /** 429 冷却截止（毫秒；0 = 未冷却）。 */
  cooldownUntil: number
  /** 连续失败次数。 */
  consecutiveFailures: number
  /**
   * 「最近一次成功抓取到的**最新**推文 id」——**仅用于展示**，绝不当过滤闸门。
   *
   * 为什么不拿它过滤（2026-10-27 实测修正）：syndication 返回的 entries 是
   * **混合顺序**（最新推文与若干年前的高互动推文混排），所以「id 比水位线大
   * 才算新」会同时犯两个错——漏掉新抓到的历史条目，也可能因为 entries[0]
   * 不是最新而把水位线存错。真正的去重靠下面的 seenTweetIds。
   */
  lastTweetId?: string
  /**
   * 已见过的推文 id 集合：`id → 首次见到的时间（毫秒）`。
   *
   * 这是**去重闸门的唯一依据**（见 sources.ts 的 `selectNewTweets`）：只要
   * id 不在集合里就算新，与 id 大小无关，所以混合顺序不影响判定。
   * 用对象而不是数组是为了 O(1) 查找；容量上限见 `MAX_SEEN_TWEET_IDS`，
   * 超出时按「首次见到时间」保留最近的那批，避免无限增长。
   */
  seenTweetIds?: Record<string, number>
  /** 上次失败的机器可读原因（XFetchOutcome）。 */
  lastOutcome?: XFetchOutcome
  /** 上次失败时给用户看的中文一句话（「被限流，10 分钟后重试」这类）。 */
  lastErrorText?: string
}

/**
 * 单次抓取的结局。
 *
 * 把这六种分开而不是笼统的 ok/fail：实测里 429（限流，要冷却 10 分钟）、
 * 超时（多半是代理卡住）、解析失败（X 改结构）、网络错（DNS/TLS）四种的
 * 处置方式完全不同，混成一个 failed 就只能一律「稍后重试」，而限流重试
 * 只会把封禁拖更长。
 */
export type XFetchOutcome =
  | 'ok'
  | 'empty'
  | 'cooldown'
  | 'rate-limit'
  | 'timeout'
  | 'network'
  | 'parse-fail'
  | 'http-error'

/**
 * 一条推文里的一个媒体项（抓取侧形状，只在内存里用，不落盘）。
 *
 * 依据实测（`cdn.syndication.twimg.com/tweet-result` 的 `mediaDetails`）：
 *  - 图片：`media_url_https` 就是图片直链；
 *  - 视频 / GIF：`media_url_https` 只是**封面图**，真正的播放地址在
 *    `video_info.variants` 里（挑 `video/mp4` 且 bitrate 最高的那个）。
 *
 * 两条通道（主通道的 `entities.media`、备用通道的 `mediaDetails`）都解析成
 * 这一种形状 —— 消费方（writer.ts）不需要知道这条推文是从哪条路来的。
 */
export interface XMedia {
  /** 图片直链；视频时是封面图。 */
  url: string
  /** X 给的类型。'photo' | 'video' | 'animated_gif'（脏数据一律降级成 photo）。 */
  type: 'photo' | 'video' | 'animated_gif'
  /** 视频 mp4 直链（图片时无；视频但没拿到 mp4 时也没有）。 */
  videoUrl?: string
  /** 视频时长（秒，保留一位小数；图片时无）。 */
  durationSec?: number
  width?: number
  height?: number
}

/** 一条抓到的推文（只留生成环节真正用得上的字段）。 */
export interface XTweet {
  id: string
  /** 作者 @名（小写）。 */
  handle: string
  /** 作者昵称。 */
  name: string
  /** 头像 URL（可能为空串）。 */
  avatar: string
  /** 正文全文（**只在内存里用于判断话题线索，不落盘成 posts 正文**）。 */
  text: string
  /** 发布时间（毫秒）。 */
  createdAt: number
  /** 可跳转的原文链接（`https://x.com/<handle>/status/<id>`）。 */
  url: string
  likes: number
  retweets: number
  replies: number
  lang: string
  /** 媒体（图片 / 视频）。没带媒体的推文是空数组。 */
  media: XMedia[]
  /**
   * 这条是不是「回复别人的推文」（2026-10-28 用户：「应该是他单独发的动态，
   * 而不是他回复别人的」）。
   *
   * 判据是 X 自己的规则：**回复的正文必须以 @某人 开头**（不带 @ 的回复会被
   * X 归到原创里）。实测 20 条关注账号推文里 0 条以 @ 开头，说明当前抓到的
   * 本来就没有回复 —— 但这个标记保留着，将来抓到回复时能在这里拦掉。
   */
  isReply?: boolean
  /**
   * 这条是不是「引用别人的推文」（quote）。
   *
   * 为什么连它一起排除：用户要的是「他单独发的」。引用推文的主语其实是别人
   * （「XXX 说了这个，我评论一句」），与「他自己发了一条」在阅读体验上是两回事。
   * 实测 20 条里有 9 条是引用 —— 这正是用户看到「像在回复别人」的那些。
   */
  isQuote?: boolean
}

/* ───────────────────────────── 落盘形状 ───────────────────────────── */

/** posts.json 的形状（带 version，将来迁移有抓手）。 */
export interface FeedPostsFile {
  version: number
  posts: FeedPost[]
}

/** state.json 的形状。 */
export interface FeedStateFile {
  version: number
  config: FeedConfig
  gate: GateState
  runs: FeedRun[]
  xSync: Record<string, XSyncState>
  /** 上次完成 X 同步的时刻（毫秒）。 */
  lastSyncAt: number
  /** 上次生成轮次的 startedAt（毫秒）。 */
  lastRunAt: number
}

/** 落盘格式版本。字段语义不兼容地变时 +1，并在 store 的 load 里写迁移。 */
export const FEED_SCHEMA_VERSION = 1

/* ───────────────────────── 关注对象（FollowedEntity） ─────────────────────────
 *
 * 2026-10-27 用户新需求：「右侧增加悬浮球，鼠标移动上去后显示多个球每个关注的
 * 人物或公司头像与名称，点击后弹出该公司或人物的动态，在设置里可添加人物与公司」。
 *
 * 在这之前「关注谁」只有一个 `FeedConfig.xHandles: string[]`（纯 X 账号串）。
 * 那个形状装不下这次的三个核心要素：**显示名**（用户要看到「黄仁勋」而不是
 * `elonmusk`）、**头像**（悬停时展开的那几枚球）、**归属判定用的别名**
 * （把生成出来的动态挂回这个人身上）。所以新增这一组结构化对象。
 *
 * ⚠ `FeedConfig.xHandles` **保留**（老配置与 X 同步链路还在用它），
 *   但它由 entities 派生：见 entities.ts 的 `xHandlesOf()` —— 一处真相。
 *   新逻辑一律以 entities 为准，别再往 xHandles 里手写东西。
 */

/**
 * 一个关注对象（人物或公司）。落盘在 entities.json。
 *
 * 独立成文件而不是塞进 state.json：这份清单会被**两条互相无关的路径**写 ——
 * 用户在设置面板增删改、以及将来的头像抓取回填。而 state.json 每次闸门续租
 * （每 60 秒）都要整份重写，混在一起等于每 60 秒把这份清单重写一遍。
 */
export interface FollowedEntity {
  /** `fe_<uuid>`。 */
  id: string
  /** 显示名：'黄仁勋' / 'OpenAI' / 'DeepSeek'。**必填**，也是首字球的来源。 */
  name: string
  /** 人物 or 公司（只影响标签与默认头像配色）。 */
  kind: 'person' | 'company'
  /** X 账号（可选，不含 @、小写）。有人物/公司只用网页来源，不一定要 X。 */
  xHandle?: string
  /** 官网/主页 URL（可选，用于取头像或作为来源）。 */
  homeUrl?: string
  /**
   * 头像 URL（可选）。
   *
   * ⚠ 客户端**必须**有首字回落：外链图片可能被 CSP / 网络拦，
   * 而「一排灰底破图」比「首字色块」难看得多。见 EntityOrbs.tsx。
   */
  avatarUrl?: string
  /**
   * 别名/关键词：用于把生成出来的动态归到这个人/公司身上。
   *
   * 包含显示名之外的所有写法（'Jensen Huang' / 'NVIDIA CEO' / '英伟达'）。
   * 匹配一律**大小写不敏感的子串**（中英文都按这个口径）—— 中文没有词边界，
   * 做分词反而容易漏；英文子串匹配的误命中由「名字够长才匹配」兜（见 entities.ts）。
   */
  aliases: string[]
  /** 权重：影响生成时优先关注谁（越大越靠前）。缺省 1。 */
  weight?: number
  /** 创建时刻（毫秒）。列表按它排序（先加的在前），保证顺序稳定不跳。 */
  createdAt: number
}

/** entities.json 的形状（带 version，将来迁移有抓手）。 */
export interface FeedEntitiesFile {
  version: number
  entities: FollowedEntity[]
}

/**
 * entities.json 的格式版本（与 posts/state 的 FEED_SCHEMA_VERSION 分开）。
 *
 * 分开的理由：这份文件的读写路径与那两份完全独立（entities.ts 独占），
 * 用一个版本号绑死会让「只想给关注对象加一个字段」变成一次全模块的迁移。
 */
export const ENTITIES_SCHEMA_VERSION = 1

/** 单个实体的别名上限（防止有人把一整篇文章粘进别名列表）。 */
export const MAX_ENTITY_ALIASES = 24

/** 别名最大长度。太长的「别名」既不像别名，也会让子串匹配变成模糊命中。 */
export const MAX_ENTITY_ALIAS_LENGTH = 48

/** 关注对象数量上限（悬浮球展开要能一屏放下，而且每颗球都要算归属）。 */
export const MAX_ENTITIES = 24

/** 路由前缀（§8；与 dsh-mail / dsh-memory 等并列，不占用任何已有前缀）。 */
export const FEED_ROUTE_PREFIX = '/api/dsh-feed'

/* ───────────────────────────── id 工厂 ───────────────────────────── */

/** 动态 id：`p_<uuid>`（§3 点名了这个形状）。 */
export function newPostId(): string {
  return `p_${randomUUID()}`
}

/** 轮次 id：`r_<uuid>`。 */
export function newRunId(): string {
  return `r_${randomUUID()}`
}

/** 讨论 id：`c_<uuid>`。 */
export function newCommentId(): string {
  return `c_${randomUUID()}`
}

/** 关注对象 id：`fe_<uuid>`（`fe` = followed entity，与 `p_` / `r_` / `c_` 并列）。 */
export function newEntityId(): string {
  return `fe_${randomUUID()}`
}
