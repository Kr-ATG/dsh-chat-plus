/**
 * dsh-chat-plus — 动态（Feed）客户端半身的数据面。
 *
 * 与 host 半身（另一个人并行开发的 src/feed/）之间**只有 HTTP 契约**：
 *
 *   GET    /api/dsh-feed/posts?channel=all|mine|<topic>  → { ok:true, days:[{date,label,items:FeedPost[]}] }
 *   POST   /api/dsh-feed/like       { id }               → { ok:true, post:FeedPost }
 *   POST   /api/dsh-feed/comment    { id, text }         → { ok:true, post:FeedPost }
 *   DELETE /api/dsh-feed/post       { id }               → { ok:true }
 *   GET    /api/dsh-feed/config                          → { ok:true, config:FeedConfig }
 *   PUT    /api/dsh-feed/config     { prompt?, model? }  → { ok:true, config:FeedConfig }
 *   POST   /api/dsh-feed/refresh                         → { ok:true, state:'started'|'queued'|'rejected' }
 *   GET    /api/dsh-feed/status                          → { ok:true, running, lastRunAt, nextRunAt, promptHash, model, runs[] }
 *   GET    /api/dsh-feed/models                          → { ok:true, current, default, models:[{id,label,provider}] }
 *
 * ── 三条硬性约定（这一层替整个页面兜住，页面组件不需要再写一遍）──────
 *
 * 1. **永不抛异常**。host 路由可能还没挂载（并行开发期）／服务没重启／网络
 *    抖动，任何一种都只会让 request() 返回 ok:false + 一句人话，页面据此显示
 *    空态。绝不让 fetch 的 rejection 冒到 React 渲染里变成白屏。
 * 2. **业务失败也走 HTTP 200**（host 侧约定），所以统一按 payload 的 ok 判成败，
 *    不只看 res.ok。
 * 3. **字段全兜底**。client 与 host 是各自独立部署的两半：刷新页面 client 立即
 *    生效，host 要重启服务才换新。这段窗口里旧 host 可能缺 liked / read /
 *    comments，直接渲染会出 undefined 或整块崩掉，所以 normalize 在边界处补齐。
 */

/** 路由前缀（与 host 半身约定，见 docs/2026-10-25-personal-feed-design.md §8）。 */
const FEED_BASE = '/api/dsh-feed'

/** 单次请求超时（毫秒）。host 卡住时页面不能一直转圈。 */
const REQUEST_TIMEOUT_MS = 8000

/**
 * 把 X 的媒体 URL 换成 host 代理地址（2026-10-28，修「视频加载不出来」）。
 *
 * 为什么视频必须走代理：`video.twimg.com` 按 Referer 判来源，实测
 * `Referer: http://127.0.0.1:3080/` 直接 403，而不带 Referer 是 200。
 * 浏览器里的 `<video src>` **必然**会带当前页面地址，而 HTMLMediaElement
 * 又没有 referrerpolicy 属性（那是 img/iframe/a 才有的）—— 前端无解，
 * 只能让 host 转发一次（见 host 侧 api.ts 的 proxyMedia）。
 *
 * 图片不走这里：`<img referrerPolicy="no-referrer">` 已经够用，
 * 多绕一层只会增加 host 带宽。
 */
export function mediaProxyUrl(url: string): string {
  if (url === '') return ''
  return FEED_BASE + '/media?u=' + encodeURIComponent(url)
}

/** 来源可用性（§7）：open = 公开可抓取；limited = 平台不开放（X / 公众号）。 */
export type FeedAccess = 'open' | 'limited'

/** 一条来源。 */
export interface FeedSource {
  readonly url: string
  readonly domain: string
  readonly title: string
  readonly access: FeedAccess
  /** 只有 open 才有摘要；limited 必须为空（法律与边界）。 */
  readonly snippet?: string
  readonly fetchedAt?: number
}

/** 一条讨论。 */
export interface FeedComment {
  readonly id?: string
  readonly by?: 'user' | 'agent'
  readonly text: string
  readonly at?: number
}

/* ───────────────────────── 媒体 ───────────────────────── */

/**
 * 媒体的形态（与 host 侧 X 抓取保留的 type 同口径）。
 *
 * 三种都要能显示：photo 是图片直链；video 是**封面 + mp4 直链**；
 * animated_gif 在 X 上其实是无声 mp4，同样走 video 那条渲染路径。
 */
export type FeedMediaType = 'photo' | 'video' | 'animated_gif'

/**
 * 一条媒体（图片直链 / 视频封面）。
 *
 * ⚠ 这一整块是**后来才加的字段**，host 与 client 是各自独立部署的两半：
 * 刷新页面 client 立即生效、host 要重启服务才换新。所以：
 *   · 老 host 压根不下发 media → {@link FeedPost.media} 是**空数组**，
 *     页面按纯文字正常渲染，绝不能因为「没有这个字段」崩掉；
 *   · 新 host 下发的项也可能是脏的（url 空、type 是没见过的串）→
 *     normalizeMedia 在边界处补齐，脏项直接丢，不把 undefined 漏进渲染层。
 */
export interface FeedMedia {
  /** 图片直链；视频时是**封面图**。 */
  readonly url: string
  readonly type: FeedMediaType
  /**
   * 视频 mp4 直链（只有 video / animated_gif 可能有）。
   *
   * ⚠ 缺失是**正常情况**而不是错误：X 的 syndication 数据里很多视频不给
   * 直链，host 那时只能抓到封面。渲染层据此退化成「封面图 + 视频角标」，
   * 点开仍是全屏大图 —— 不能因为拿不到 mp4 就整条不显示。
   */
  readonly videoUrl?: string
  readonly width?: number
  readonly height?: number
  /** 这条媒体所属的原帖地址（点「查看原文」用；缺省回落成 url 本身）。 */
  readonly sourceUrl: string
}

/** 一条动态（host FeedPost 的镜像）。 */
export interface FeedPost {
  readonly id: string
  readonly createdAt: number
  readonly topics: readonly string[]
  readonly title: string
  readonly body: string
  readonly sources: readonly FeedSource[]
  /** 截止时间（毫秒）。0 = 无截止。 */
  readonly dueAt: number
  readonly dueLabel: string
  readonly likes: number
  readonly liked: boolean
  readonly comments: readonly FeedComment[]
  readonly read: boolean
  readonly runId: string
  /** 归属的关注对象 id（缺省 = 没有归属信息，老帖子与模型漏标都是这种）。 */
  readonly entityIds: readonly string[]
  /** 媒体（图片 / 视频）。**永远给数组**：没有就是空数组，渲染层不用判空。 */
  readonly media: readonly FeedMedia[]
  /**
   * 来源推文的原文全文（2026-10-28 用户要求「不要压缩原文内容」）。
   * 缺省 = 没有原文（网页来源的帖子、老帖子）。
   */
  readonly originalText?: string
  /** 原文语言（'en' / 'zh' / 'ja'…）。界面据此决定要不要显示原文块。 */
  readonly originalLang?: string
}

/** 一天的分组（服务端已按 §6 排好序，客户端不再排）。 */
export interface FeedDay {
  readonly date: string
  readonly label: string
  readonly items: readonly FeedPost[]
}

/** 模块配置。 */
export interface FeedConfig {
  readonly prompt: string
  /** 生成模型 id；'default' = 跟随系统默认。 */
  readonly model: string
  readonly cron?: string
}

/**
 * 一轮生成里的**过程计数**（host FeedRunStats 的镜像，字段全部可选）。
 *
 * 为什么这些格子是进度弹卡的「阶段」依据：host 的 writer 每走完一步就往
 * report 里写一格（queries → sourcesOpen → rawChars → postsCreated），顺序
 * 就是流水线的顺序。所以「哪一格有值」比「百分比」可靠得多 —— 百分比要
 * 知道总时长，而总时长只有跑完才知道。
 *
 * 实测坑（2026-10-27）：host 的 stats 是**跑完才落进 run 的**，也就是说
 * 生成中读到的往往是空对象。所以消费端必须两条路都走：有 stats 按 stats
 * 定位，没有就按已用时间/历史中位数推进（见 FeedPanel 的 phaseOfStatus）。
 */
export interface FeedRunStatsView {
  readonly postsCreated?: number
  readonly queries?: number
  readonly sourcesOpen?: number
  readonly sourcesLimited?: number
  readonly sourcesBlocked?: number
  readonly rawChars?: number
  readonly searched?: number
  readonly fetched?: number
  readonly dropped?: number
  readonly tokensIn?: number
  readonly tokensOut?: number
  /** 本轮实际使用的模型路由（过程快照；老数据可能没有）。 */
  readonly modelUsed?: string
  readonly modelLabel?: string
  /** 有值即说明这一轮走了降级路径（如「web 检索不可用」）。 */
  readonly degraded?: string

  /* ── 「本轮没有新内容」三格（2026-10-27；host 早已下发，client 一直没镜像）──
   *
   * 之前这里没有它们，于是 run.stats.modelSkipNotes 到了浏览器就消失 ——
   * 用户看不到「模型为什么判这条是重复」，而那是整个去重功能最有说服力的证据。
   */
  /** 模型自己判为重复而跳过的条数。 */
  readonly modelSkipped?: number
  /** 模型给的具体理由（每条一句话，最多 10 条）。 */
  readonly modelSkipNotes?: readonly string[]
  /** true = 0 条产出是模型主动判重（normal，不是故障）。 */
  readonly noNewContent?: boolean
  /** 一句话结论（如「模型判断 11 条候选都与已发内容重复」）。 */
  readonly noNewContentReason?: string
}

/** 一轮生成的结局。unknown = host 给了个我们不认识的字符串，按未完成处理。 */
export type FeedRunStatus = 'running' | 'ok' | 'failed' | 'skipped' | 'unknown'

/**
 * 一轮生成的记录（host FeedRun 的镜像）。
 *
 * 进度弹卡的三件事都从这里来：**已用时间**（now - startedAt）、**预计完成**
 * （历史 finishedAt - startedAt 的中位数）、**失败原因**（error）。
 */
export interface FeedRunView {
  readonly id: string
  readonly trigger: string
  readonly status: FeedRunStatus
  readonly startedAt: number
  /** 0 = 还没跑完。 */
  readonly finishedAt: number
  readonly modelUsed: string
  readonly stats: FeedRunStatsView
  /** 失败时的人话原因（host run.error）；空串 = 没给。 */
  readonly error: string
  /** 被上一轮拦住时记「当时正在跑的是谁」。 */
  readonly blockedBy: string
}

/** 生成状态。 */
export interface FeedStatus {
  readonly running: boolean
  readonly lastRunAt: number
  readonly nextRunAt: number
  readonly promptHash?: string
  /** 配置里「将要使用」的模型 id（'default' = 跟随系统默认）。 */
  readonly model?: string
  /**
   * 上一轮**实际用过**的模型（host 的 runs[0].modelUsed）。
   *
   * 与 {@link FeedStatus.model} 是两件事：配置里写的是「下一轮该用谁」，这里写的
   * 是「上一轮真的用了谁」。切换模型后到下一轮跑完之前，两者会不一样 —— 页面
   * 并排显示，用户才看得出「改的生效了没有」，而不是只有一个静态配置值。
   */
  readonly modelUsed?: string
  /**
   * 最近若干轮记录（host 新在前，最多 20 条）。
   *
   * **永远给数组**（host 没下发就是空数组），这样消费端不用写两层判空；
   * 老 host 没有这个字段时进度弹卡会退化成「没有历史耗时」的保守估算，
   * 而不是崩掉。
   */
  readonly runs: readonly FeedRunView[]
  /** 上一轮的结局（host 顶层 lastRunStatus；缺了就按 runs 推）。 */
  readonly lastRunStatus?: FeedRunStatus
  /** 上一轮的失败原因（host 顶层 lastRunError；缺了就按 runs 取）。 */
  readonly lastRunError?: string
}

/** 一个可选模型（host 的 /models 返回项）。 */
export interface FeedModelOption {
  /** 提交给 host 的完整模型 id（**带供应商前缀的完整串**，见下）。 */
  readonly id: string
  /** 下拉里显示的短名。 */
  readonly label: string
  /** 供应商 id（同名模型靠它区分）。 */
  readonly provider: string
}

/** 模型列表结果。 */
export interface FeedModelCatalog {
  /** 已有可选模型（不含「跟随系统默认」那一项，那一项由页面自己补）。 */
  readonly models: readonly FeedModelOption[]
  /** 当前系统默认模型 id（拉不到时为空串）。 */
  readonly current: string
  /** 数据来源：host 专门路由 / memory 目录降级 / 完全拉不到。 */
  readonly source: 'host' | 'catalog' | 'none'
}

/** refresh 的三种结果（对应单飞锁 §5.2）。 */
export type FeedRefreshState = 'started' | 'queued' | 'rejected'

/** 统一结果：永不抛，失败带一句人话。 */
export type FeedResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly message: string }

/** 把任意值读成有限数字（缺字段 / null / NaN 一律落 0）。 */
function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 把任意值读成字符串（缺字段落空串）。 */
function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 规范化一条来源。
 *
 * url 必须是非空字符串才留下 —— 没有链接的「来源」在界面上就是一个点了没反应
 * 的按钮，比不显示更糟（用户会以为页面坏了）。
 */
function normalizeSource(raw: unknown): FeedSource | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const url = toText(item.url)
  if (url === '') return null
  return {
    url,
    domain: toText(item.domain) || hostOf(url),
    title: toText(item.title) || url,
    access: item.access === 'limited' ? 'limited' : 'open',
    snippet: typeof item.snippet === 'string' && item.snippet !== '' ? item.snippet : undefined,
    fetchedAt: toNumber(item.fetchedAt),
  }
}

/** 从 URL 里取 host（只用于展示兜底，失败返回空串）。 */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * 规范化一条讨论。
 *
 * host 用 { by:'user'|'agent', text, at }；原型用 { w:'你'|'我', t, h }。
 * 两种都认——契约里只写了 comments[] 没展开元素形状，代码里却必须能显示。
 */
function normalizeComment(raw: unknown): FeedComment | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const text = toText(item.text) || toText(item.t)
  if (text === '') return null
  const byRaw = toText(item.by)
  const who = toText(item.w)
  const by = byRaw === 'agent' || who === '我' ? 'agent' : 'user'
  return {
    id: toText(item.id) || undefined,
    by,
    text,
    at: toNumber(item.at) > 0 ? toNumber(item.at) : undefined,
  }
}

/**
 * 规范化一条媒体。
 *
 * 丢掉的情形（宁可少一张图，也不要渲染一个点了没反应的破图）：
 *   · 没有 url 或 url 不是字符串 —— 无地址的媒体没有任何可渲染内容；
 *   · type 是我们不认识的串 —— 不猜（猜错会把封面当视频放，用户点了没反应）。
 *
 * 认得的 type 之外还有两种兼容：
 *   · 老 host 可能只给 url 不给 type → 按 photo 处理（那是唯一不需要额外字段的形态）；
 *   · X 的 animated_gif 在语义上就是无声 mp4，保留原 type 让渲染层加「GIF」角标。
 */
export function normalizeMedia(raw: unknown): FeedMedia | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const url = toText(item.url).trim()
  if (url === '') return null
  const typeRaw = toText(item.type)
  const type: FeedMediaType = typeRaw === 'video' || typeRaw === 'animated_gif' ? typeRaw : 'photo'
  const videoUrl = toText(item.videoUrl).trim()
  const width = optionalNumber(item.width)
  const height = optionalNumber(item.height)
  const sourceUrl = toText(item.sourceUrl).trim()
  return {
    url,
    type,
    // 只有视频类才认 videoUrl：photo 带上它一定是数据串了（渲染层会当视频放）。
    ...(type !== 'photo' && videoUrl !== '' ? { videoUrl } : {}),
    ...(width === undefined || width <= 0 ? {} : { width }),
    ...(height === undefined || height <= 0 ? {} : { height }),
    sourceUrl: sourceUrl === '' ? url : sourceUrl,
  }
}

/** 规范化媒体数组（坏项直接丢；不是数组一律当空数组）。 */
function normalizeMediaList(raw: unknown): FeedMedia[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeMedia).filter((item): item is FeedMedia => item !== null)
}

/** 规范化一条动态（缺字段一律补默认值，绝不返回 undefined 字段）。 */
export function normalizePost(raw: unknown): FeedPost | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = toText(item.id)
  if (id === '') return null
  const topics = Array.isArray(item.topics)
    ? item.topics.filter((topic): topic is string => typeof topic === 'string' && topic !== '')
    : []
  const sources = Array.isArray(item.sources)
    ? item.sources.map(normalizeSource).filter((source): source is FeedSource => source !== null)
    : []
  const comments = Array.isArray(item.comments)
    ? item.comments.map(normalizeComment).filter((comment): comment is FeedComment => comment !== null)
    : []
  return {
    id,
    createdAt: toNumber(item.createdAt),
    topics,
    title: toText(item.title) || '（无标题）',
    body: toText(item.body),
    sources,
    dueAt: toNumber(item.dueAt),
    dueLabel: toText(item.dueLabel),
    likes: toNumber(item.likes),
    liked: item.liked === true,
    comments,
    read: item.read === true,
    runId: toText(item.runId),
    // entityIds：host 的归属信息，缺省空数组（「没有归属」与「空」在界面同义）。
    entityIds: Array.isArray(item.entityIds)
      ? item.entityIds.filter((id): id is string => typeof id === 'string' && id !== '')
      : [],
    // ⚠ 媒体**永远给数组**。老 host 没这个字段时是 []，页面走纯文字那条路。
    media: normalizeMediaList(item.media),
    /*
     * 原文（2026-10-28 用户要求「不要压缩原文内容，英文翻译中文原文放里面」）。
     *
     * ⚠ 必须在这里显式列出来：normalizePost 是**白名单式**解析（只挑它认识的
     * 字段），不写这一行的话 host 明明下发了 originalText，客户端也会把它丢掉 ——
     * 现象就是「界面永远没有原文块」，而 API 调试看着一切正常。这个坑实测踩过。
     */
    ...(typeof item.originalText === 'string' && item.originalText !== ''
      ? { originalText: item.originalText }
      : {}),
    ...(typeof item.originalLang === 'string' && item.originalLang !== ''
      ? { originalLang: item.originalLang }
      : {}),
  }
}

/** 规范化一天。空天会被丢掉（不画一个只有标题的空分组）。 */
function normalizeDay(raw: unknown): FeedDay | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const items = Array.isArray(item.items)
    ? item.items.map(normalizePost).filter((post): post is FeedPost => post !== null)
    : []
  if (items.length === 0) return null
  return {
    date: toText(item.date),
    label: toText(item.label) || '更早',
    items,
  }
}

/** 把任意值读成「有就返回数字，没有就 undefined」的格子。 */
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 只留确实存在的统计格（undefined 不塞进去，界面据此判「有没有这一格」）。 */
function normalizeRunStats(raw: unknown): FeedRunStatsView {
  if (raw === null || typeof raw !== 'object') return {}
  const item = raw as Record<string, unknown>
  const numeric = (key: string): number | undefined => optionalNumber(item[key])
  const text = (key: string): string | undefined => toText(item[key]) || undefined
  return {
    ...(numeric('postsCreated') === undefined ? {} : { postsCreated: numeric('postsCreated') }),
    ...(numeric('queries') === undefined ? {} : { queries: numeric('queries') }),
    ...(numeric('sourcesOpen') === undefined ? {} : { sourcesOpen: numeric('sourcesOpen') }),
    ...(numeric('sourcesLimited') === undefined ? {} : { sourcesLimited: numeric('sourcesLimited') }),
    ...(numeric('sourcesBlocked') === undefined ? {} : { sourcesBlocked: numeric('sourcesBlocked') }),
    ...(numeric('rawChars') === undefined ? {} : { rawChars: numeric('rawChars') }),
    ...(numeric('searched') === undefined ? {} : { searched: numeric('searched') }),
    ...(numeric('fetched') === undefined ? {} : { fetched: numeric('fetched') }),
    ...(numeric('dropped') === undefined ? {} : { dropped: numeric('dropped') }),
    ...(numeric('tokensIn') === undefined ? {} : { tokensIn: numeric('tokensIn') }),
    ...(numeric('tokensOut') === undefined ? {} : { tokensOut: numeric('tokensOut') }),
    ...(text('modelUsed') === undefined ? {} : { modelUsed: text('modelUsed') }),
    ...(text('modelLabel') === undefined ? {} : { modelLabel: text('modelLabel') }),
    ...(text('degraded') === undefined ? {} : { degraded: text('degraded') }),
    ...(numeric('modelSkipped') === undefined ? {} : { modelSkipped: numeric('modelSkipped') }),
    // 理由清单：非字符串项直接丢（host 侧已洗过，但磁盘可手改），最多 10 条。
    ...(Array.isArray(item.modelSkipNotes)
      ? {
        modelSkipNotes: item.modelSkipNotes
          .filter((note): note is string => typeof note === 'string' && note !== '')
          .slice(0, 10),
      }
      : {}),
    ...(item.noNewContent === true ? { noNewContent: true } : {}),
    ...(text('noNewContentReason') === undefined ? {} : { noNewContentReason: text('noNewContentReason') }),
  }
}

/** 结局字符串 → 我们认识的四种（其余落 unknown，按「没跑完」处理）。 */
function normalizeRunStatus(raw: string): FeedRunStatus {
  if (raw === 'running' || raw === 'ok' || raw === 'failed' || raw === 'skipped') return raw
  return 'unknown'
}

/**
 * 规范化一轮记录。
 *
 * id 缺失时**不丢掉这一轮** —— 它是「已用时间 / 预计完成」唯一的数据源，
 * 丢一条就让中位数少一个样本。用 startedAt 拼一个稳定 id 顶上。
 *
 * 导出给冒烟直接对拍：这一层**最容易悄悄丢字段**（host 下发了、镜像时忘了接，
 * 界面上就永远看不到）。而这次丢掉的正是「模型判重的具体理由」——
 * 那是用户要亲眼看到的东西（见 FeedRunStatsView 那三格的说明）。
 */
export function normalizeRun(raw: unknown): FeedRunView | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const startedAt = toNumber(item.startedAt)
  const id = toText(item.id) || (startedAt > 0 ? 'run-' + String(startedAt) : '')
  if (id === '') return null
  return {
    id,
    trigger: toText(item.trigger),
    // 没有 status 但有 finishedAt 的老记录：算跑完了，别让界面一直以为在跑。
    status: toText(item.status) === ''
      ? (toNumber(item.finishedAt) > 0 ? 'ok' : 'unknown')
      : normalizeRunStatus(toText(item.status)),
    startedAt,
    finishedAt: toNumber(item.finishedAt),
    modelUsed: toText(item.modelUsed),
    stats: normalizeRunStats(item.stats),
    error: toText(item.error),
    blockedBy: toText(item.blockedBy),
  }
}

/** 规范化 runs 数组（坏项直接丢，不让一条脏数据打断整个状态）。 */
function normalizeRuns(raw: unknown): FeedRunView[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeRun).filter((run): run is FeedRunView => run !== null)
}

/** 规范化整个 days 响应。 */
function normalizeDays(raw: unknown): FeedDay[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeDay).filter((day): day is FeedDay => day !== null)
}

/**
 * 发一次请求。
 *
 * 四类失败都在这里收口成人话：路由没挂载（404）、HTTP 非 2xx、非 JSON 响应、
 * 网络异常 / 超时。调用方只看 ok 与 message，不需要关心是哪一类。
 */
async function request<T>(path: string, init?: RequestInit): Promise<FeedResult<T>> {
  return requestAt<T>(FEED_BASE + path, init)
}

/**
 * 同 {@link request}，但吃完整 URL 路径 —— 模型目录的降级源在**另一个**路由前缀
 * （/api/dsh-memory/models），不能复用 FEED_BASE。
 *
 * @param envelope - 成败判据形状。**这不是可选项的洁癖，是实测踩出来的**：
 *   · 'ok'（默认）：本模块自己的路由，业务失败也走 HTTP 200 + ok:false
 *     （见文件头约定 2），所以必须看 payload.ok；
 *   · 'bare'：老模块（dsh-memory）的路由**只回数据、不回 ok 信封** ——
 *     实测 GET /api/dsh-memory/models 返回的是 {"models":[...]}，压根没有 ok
 *     字段。按 'ok' 判会把它当失败，降级链**整条静默失效**：页面看起来正常
 *     （有「跟随系统默认」一项），实际一个真实模型都没列出来。
 *     这种「失败被当成空数据」不会抛错、不会白屏，只能靠真打网络发现。
 */
async function requestAt<T>(url: string, init?: RequestInit, envelope: 'ok' | 'bare' = 'ok'): Promise<FeedResult<T>> {
  const hasBody = init !== undefined && init.body !== undefined
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller !== null && typeof setTimeout === 'function'
    ? setTimeout(() => { try { controller.abort() } catch { /* 已结束 */ } }, REQUEST_TIMEOUT_MS)
    : 0
  try {
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      body: init?.body,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(controller !== null ? { signal: controller.signal } : {}),
    })
    // ⚠ 三道状态检查只是**粗筛**，真正的成败判定在下面看 payload.ok。
    //
    // 实测（2026-10-27 真实服务）：host 对没匹配上的路由返回的是
    //   HTTP 200 + {"ok":false,"error":"no route for POST /like"}
    // 而不是 404 —— 只按 response.ok 判成败会把这些**全部当成功**：
    // 点赞数字跳了、卡片删了，其实什么也没发生。所以这里放行 200，
    // 交给 payload.ok 定生死。
    if (response.status === 404) {
      return { ok: false, message: '动态服务还没挂载：请重启 DSH 服务后再试。' }
    }
    if (!response.ok) {
      return { ok: false, message: '请求失败（HTTP ' + String(response.status) + '）' }
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, message: '服务返回的不是 JSON：动态路由可能还没装好。' }
    }
    if (payload === null || typeof payload !== 'object') {
      return { ok: false, message: '服务返回了空响应。' }
    }
    const record = payload as Record<string, unknown>
    if (envelope === 'bare') {
      /*
       * 无信封路由（老模块 dsh-memory）：成功就是「HTTP 200 + 一个 JSON 对象」，
       * 里面**没有 ok 字段**。所以这里只排掉「明确说自己失败」的形状
       * （ok === false），不能要求 ok === true —— 那会把每一次正常回包都判成失败。
       */
      if (record.ok === false) {
        const why = toText(record.message) || toText(record.error)
        return { ok: false, message: why === '' ? '服务返回失败。' : why }
      }
    } else if (record.ok !== true) {
      // ⚠ 判据是 ok !== true（不是 ok === false）。仓库惯例见 mail/api.ts:164 的
      // envelope.ok !== true：**没给 ok 就不算成功**。写成 === false 会把
      // 「缺字段 / 未知形态」当成成功 —— 那正是「失败被当成功」的典型入口。
      const why = toText(record.message) || toText(record.error)
      return { ok: false, message: why === '' ? '服务返回失败。' : why }
    }
    return { ok: true, data: payload as T }
  } catch (error) {
    const aborted = error !== null && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError'
    return { ok: false, message: aborted ? '请求超时：动态服务没有响应。' : '连不上动态服务。' }
  } finally {
    if (timer !== 0 && typeof clearTimeout === 'function') clearTimeout(timer)
  }
}

/**
 * 拉动态列表。
 *
 * channel 语义与 host 一致：'all' 全部 / 'mine' 只含贴用户目标的部分 / 其余按主题。
 * 页面默认用 'all' 拉一次再本地切频道（见 FeedPanel 的说明：这样频道清单不会缺项，
 * 切频道也不用再等一次往返）。
 */
export async function fetchFeedPosts(channel: string): Promise<FeedResult<readonly FeedDay[]>> {
  const query = new URLSearchParams()
  if (channel !== '') query.set('channel', channel)
  const suffix = query.toString() === '' ? '' : '?' + query.toString()
  const result = await request<{ days?: unknown }>('/posts' + suffix)
  if (!result.ok) return result
  return { ok: true, data: normalizeDays(result.data.days) }
}

/** 点赞 / 取消点赞（幂等，host 回最新 post）。 */
export async function toggleFeedLike(id: string): Promise<FeedResult<FeedPost>> {
  const result = await request<{ post?: unknown }>('/like', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
  if (!result.ok) return result
  const post = normalizePost(result.data.post)
  if (post === null) return { ok: false, message: '点赞成功但服务没有返回这条动态。' }
  return { ok: true, data: post }
}

/** 发一条讨论。 */
export async function postFeedComment(id: string, text: string): Promise<FeedResult<FeedPost>> {
  const result = await request<{ post?: unknown }>('/comment', {
    method: 'POST',
    body: JSON.stringify({ id, text }),
  })
  if (!result.ok) return result
  const post = normalizePost(result.data.post)
  if (post === null) return { ok: false, message: '讨论已发送，但服务没有返回这条动态。' }
  return { ok: true, data: post }
}

/**
 * 标记一条动态为已读（左栏「未读」分类要靠它才有意义）。
 *
 * host 侧的形态是 RESTful 的 `POST /posts/:id/read`（见 src/feed/api.ts 的
 * matchPostAction）。**失败一律静默**：这个动作是「顺手记一下」，它失败不该
 * 让用户看到任何提示 —— 更不能因为标记失败就回滚界面上已经读到的内容。
 * 所以返回值只用来判断要不要本地更新那一格，不做 toast。
 */
export async function markFeedRead(id: string): Promise<FeedResult<null>> {
  const result = await request<unknown>('/posts/' + encodeURIComponent(id) + '/read', { method: 'POST' })
  if (!result.ok) return result
  return { ok: true, data: null }
}

/** 删除一条动态。 */
export async function deleteFeedPost(id: string): Promise<FeedResult<null>> {
  const result = await request<unknown>('/post', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
  if (!result.ok) return result
  return { ok: true, data: null }
}

/** 读配置（提示词 + 生成模型）。 */
export async function fetchFeedConfig(): Promise<FeedResult<FeedConfig>> {
  const result = await request<{ config?: unknown }>('/config')
  if (!result.ok) return result
  const raw = result.data.config
  const record = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    ok: true,
    data: {
      prompt: toText(record.prompt),
      model: toText(record.model) || 'default',
      cron: toText(record.cron) || undefined,
    },
  }
}

/** 写配置。提示词实质改动时 host 自己会触发一轮生成（§5.3），这里只负责落配置。 */
export async function saveFeedConfig(patch: { prompt?: string; model?: string }): Promise<FeedResult<FeedConfig>> {
  const result = await request<{ config?: unknown }>('/config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  if (!result.ok) return result
  const raw = result.data.config
  const record = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    ok: true,
    data: {
      prompt: toText(record.prompt) || (patch.prompt ?? ''),
      model: toText(record.model) || patch.model || 'default',
      cron: toText(record.cron) || undefined,
    },
  }
}

/** 请求跑一轮（手动更新）。连续点只会让 host 回 queued / rejected，不会跑两轮。 */
export async function refreshFeed(): Promise<FeedResult<FeedRefreshState>> {
  const result = await request<{ state?: unknown }>('/refresh', { method: 'POST' })
  if (!result.ok) return result
  const state = toText(result.data.state)
  const normalized: FeedRefreshState = state === 'queued' ? 'queued' : state === 'rejected' ? 'rejected' : 'started'
  return { ok: true, data: normalized }
}

/** 读生成状态（轮询用）。 */
export async function fetchFeedStatus(): Promise<FeedResult<FeedStatus>> {
  const result = await request<Record<string, unknown>>('/status')
  if (!result.ok) return result
  const record = result.data
  const runs = normalizeRuns(record.runs)
  /*
   * 上一轮的结局：顶层字段优先（host 的 /status 会平铺 lastRunStatus /
   * lastRunError），没有就按 runs 里 startedAt 最大的那一轮推。
   *
   * 为什么要兜这一层：进度弹卡「失败时显示具体原因」全靠它；老 host 只给
   * runs 不给顶层字段时，这一格没有就等于失败原因永远看不到。
   */
  const latest = latestRunOf(runs)
  const topStatus = toText(record.lastRunStatus)
  return {
    ok: true,
    data: {
      running: record.running === true,
      lastRunAt: toNumber(record.lastRunAt),
      nextRunAt: toNumber(record.nextRunAt),
      promptHash: toText(record.promptHash) || undefined,
      model: toText(record.model) || undefined,
      modelUsed: lastModelUsedOf(record),
      runs,
      lastRunStatus: topStatus === ''
        ? latest?.status
        : normalizeRunStatus(topStatus),
      lastRunError: toText(record.lastRunError) || latest?.error || undefined,
    },
  }
}

/**
 * 最近的一轮（按 startedAt 取最大，**不赌 host 的数组顺序**）。
 *
 * host 的 store 是新记录 unshift 在前面，但存档迁移 / 手工改 state.json 之后
 * 顺序不一定还成立；这一格决定「弹卡显示的是哪一轮」，赌顺序会显示错轮次。
 */
export function latestRunOf(runs: readonly FeedRunView[]): FeedRunView | null {
  let best: FeedRunView | null = null
  for (const run of runs) {
    if (best === null || run.startedAt > best.startedAt) best = run
  }
  return best
}

/**
 * 抠出「上一轮实际用的模型」。
 *
 * 两个来源，按可信度排：
 *  1. 顶层 modelUsed（host 将来若直接给，最省事）；
 *  2. runs[0].modelUsed —— **当前 host 就是这个形状**（实测
 *     /api/dsh-feed/status 返回 runs[]，每轮带 modelUsed）。
 *
 * 都不在时返回 undefined，页面就不显示这一格 —— 绝不编一个默认值冒充实测。
 */
function lastModelUsedOf(record: Record<string, unknown>): string | undefined {
  const top = usableModelId(toText(record.modelUsed))
  if (top !== undefined) return top
  const runs = record.runs
  if (!Array.isArray(runs) || runs.length === 0) return undefined
  // host 的 runs 是**新的在前**；保险起见按 startedAt 取最大的一轮，不赌顺序。
  let best: { startedAt: number; model: string } | null = null
  for (const item of runs) {
    if (item === null || typeof item !== 'object') continue
    const run = item as Record<string, unknown>
    const model = usableModelId(toText(run.modelUsed))
    if (model === undefined) continue
    const startedAt = toNumber(run.startedAt)
    if (best === null || startedAt > best.startedAt) best = { startedAt, model }
  }
  return best === null ? undefined : best.model
}

/**
 * 判断一个 modelUsed 值到底是「模型名」还是「配置占位符」。
 *
 * ⚠ 实测踩到的坑（2026-10-27 真服务）：host 的 runs[].modelUsed 记的是
 * **当时的 config.model 原样**，而默认配置就是字符串 'default' ——
 * 也就是 `"modelUsed": "default"`。直接把它当模型名显示，状态条会出现
 * 「模型：跟随系统默认 · 上轮实测：default」这种把占位符当成模型名的鬼话。
 *
 * 占位符不是模型名，返回 undefined 让页面隐藏那一格（宁可不显示，也不显示假的）。
 */
function usableModelId(raw: string): string | undefined {
  if (raw === '' || raw === 'default') return undefined
  return raw
}

/* ───────────────────────── 模型目录 ───────────────────────── */

/**
 * **降级**用的模型目录源：本插件自己已经挂着的 /api/dsh-memory/models。
 *
 * 为什么不只是「拉不到就只剩一项」：这个路由实测可用（2026-10-27 真服务），它
 * 回的是 ctx.llm.listProviders / listModels 的真实目录 —— 也就是用户机器上
 * **真配了凭据、真能调**的那些模型（实测含 auto/deepseek-v4.1-flash）。
 * 有真实目录可用却退化成一条，等于把「不要假数据」做成了「没有数据」。
 */
const CATALOG_FALLBACK_URL = '/api/dsh-memory/models'

/** 后端返回的模型目录分组（memory/api.ts 的 ModelCatalogView）。 */
interface CatalogGroup {
  readonly provider?: unknown
  readonly providerName?: unknown
  readonly models?: unknown
}

/** 统计跨供应商重名的模型 id（决定 label 要不要带供应商）。 */
function duplicatedIds(groups: ReadonlyArray<{ ids: readonly string[] }>): Set<string> {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const group of groups) {
    for (const id of group.ids) {
      if (seen.has(id)) dup.add(id)
      else seen.add(id)
    }
  }
  return dup
}

/**
 * 一组模型 id → 可选项。
 *
 * label 的口径：**同名的模型必须靠供应商区分**（实测目录里 deepseek-v4.1-flash
 * 同时挂在 sensenova 与 alymagpie 下）。所以只有重名时才把供应商名拼进 label，
 * 其余保持短名 —— 全都拼上会在下拉里塞一长串「供应商/模型」，反而看不清模型。
 */
function optionsOfGroup(provider: string, providerName: string, ids: readonly string[], duplicated: ReadonlySet<string>): FeedModelOption[] {
  const where = providerName !== '' ? providerName : provider
  return ids.map(id => ({
    id,
    label: duplicated.has(id) && where !== '' ? id + '（' + where + '）' : id,
    provider,
  }))
}

/** 从 memory 目录响应里摊平成可选项。 */
function optionsOfCatalog(raw: unknown): FeedModelOption[] {
  if (!Array.isArray(raw)) return []
  const groups: Array<{ provider: string; providerName: string; ids: string[] }> = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const group = item as CatalogGroup
    const provider = toText(group.provider)
    const ids = Array.isArray(group.models)
      ? group.models.filter((id): id is string => typeof id === 'string' && id !== '')
      : []
    if (ids.length === 0) continue
    groups.push({ provider, providerName: toText(group.providerName), ids })
  }
  const dup = duplicatedIds(groups)
  const options: FeedModelOption[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const option of optionsOfGroup(group.provider, group.providerName, group.ids, dup)) {
      // 同一 provider 下 host 可能重复给出同一个 id：按 provider + id 去重。
      const key = option.provider + '|' + option.id
      if (seen.has(key)) continue
      seen.add(key)
      options.push(option)
    }
  }
  return options
}

/** 从 host /models 响应里读可选项（正常路径）。 */
function optionsOfHostPayload(raw: unknown): FeedModelOption[] {
  if (!Array.isArray(raw)) return []
  const options: FeedModelOption[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = toText(record.id)
    if (id === '') continue
    const provider = toText(record.provider)
    const label = toText(record.label)
    options.push({ id, label: label !== '' ? label : id, provider })
  }
  return options
}

/**
 * 拉真实可用的模型列表。
 *
 * **永不抛**，失败只是 source:'none' + 空列表，页面照常可用（下拉里至少还有
 * 「跟随系统默认」那一项）。
 *
 * 三级回退，每一级都是**真实数据**：
 *  1. GET /api/dsh-feed/models（host 专门路由，契约见文件头）；
 *  2. GET /api/dsh-memory/models（本插件已挂载的真实 LLM 目录）；
 *  3. 都没有 → 空列表，只留「跟随系统默认」。
 *
 * @param configured - 配置里已存的模型 id（'default' 或具体 id）。它能保证「用户
 *   选过的那个」一定出现在候选里 —— 即使它已从目录里消失，也不能让下拉显示成
 *   一个不存在的值（select 找不到匹配项时会跳到第一项，看起来像「自己改了」）。
 */
export async function fetchFeedModels(configured = 'default'): Promise<FeedResult<FeedModelCatalog>> {
  // ── 一级：host 专门路由 ──
  const direct = await request<Record<string, unknown>>('/models')
  if (direct.ok) {
    const models = optionsOfHostPayload(direct.data.models)
    const current = toText(direct.data.current) || toText(direct.data.default)
    if (models.length > 0 || current !== '') {
      return { ok: true, data: { models: withConfigured(models, configured), current, source: 'host' } }
    }
  }

  // ── 二级：本插件已挂载的真实目录 ──
  const catalog = await requestAt<Record<string, unknown>>(CATALOG_FALLBACK_URL, undefined, 'bare')
  if (catalog.ok) {
    const models = optionsOfCatalog(catalog.data.models)
    if (models.length > 0) {
      return {
        ok: true,
        data: {
          models: withConfigured(models, configured),
          // 目录接口不告诉你「系统默认是谁」，这里留空，页面就不硬写一个假的。
          current: '',
          source: 'catalog',
        },
      }
    }
  }

  // ── 三级：一个都拿不到 ──
  return { ok: true, data: { models: withConfigured([], configured), current: '', source: 'none' } }
}

/** 把「配置里已选但不在目录里」的那个 id 补成最后一项（带标注）。 */
function withConfigured(models: readonly FeedModelOption[], configured: string): FeedModelOption[] {
  const list = [...models]
  if (configured === '' || configured === 'default') return list
  if (list.some(option => option.id === configured)) return list
  list.push({ id: configured, label: configured + '（已配置，未在目录中）', provider: '' })
  return list
}

/**
 * 「跟随系统默认」这一项的值。
 *
 * ⚠ 这里**只有**这一项是写死的，而且它是**语义**不是模型名：host 见到 'default'
 * 就去解析系统当前主模型。其余候选一律来自 {@link fetchFeedModels} 的真实目录。
 *
 * 历史（别再走回去）：这里曾硬编码六项 —— DeepSeek-V3 / R1 / Claude 3.5 Sonnet /
 * GPT-4o / Qwen 2.5 72B。那几个模型名是照原型抄的**假选项**：本机根本没接这些
 * 供应商，选中任何一个都跑不起来（用户原话「不要假数据」）。四个标签里的
 * deepseek-chat / deepseek-reasoner 即使真存在也不是当前在用的模型。
 */
export const FOLLOW_DEFAULT = 'default'

/**
 * 「跟随系统默认」那一项的完整文案。
 *
 * 必须带上**当前实际生效**的模型名：用户的原话是「选中我们现在的这个模型然后
 * 实际测试」，所以下拉第一项就得能看出「跟着谁」。current 为空（目录接口拿不到
 * 系统默认）时退回不带括号的写法，不编一个假名字进去。
 */
export function followDefaultLabel(current: string): string {
  return current === '' ? '跟随系统默认' : '跟随系统默认（' + current + '）'
}

/* ───────────────────────── 关注对象（右侧悬浮球） ───────────────────────── */

/**
 * 一个关注对象（host FollowedEntity 的镜像 + 服务端算好的首字）。
 *
 * initial 由**服务端**算（entities.ts 的 initialOf），客户端不再实现一遍 ——
 * 三条规则（拉丁首字母大写、跳过 emoji、东亚取首字）各写一份必然分叉，
 * 而分叉是可见的（同一颗球在两处显示不同的字）。旧 host 没给时用本地兜底
 * （见 initialFallbackOf），保证球上永远有字。
 */
export interface FeedEntity {
  readonly id: string
  readonly name: string
  readonly kind: 'person' | 'company'
  readonly xHandle?: string
  readonly homeUrl?: string
  readonly avatarUrl?: string
  readonly aliases: readonly string[]
  readonly weight?: number
  readonly createdAt: number
  /** 首字球的字（服务端算好；缺省时组件自己兜）。 */
  readonly initial: string
  /** 名下动态条数（host 现算；缺省表示 host 没给，而不是 0 条）。 */
  readonly postCount?: number
}

/** 新增 / 修改关注对象的入参。 */
export interface FeedEntityInput {
  readonly name?: string
  readonly kind?: 'person' | 'company'
  readonly xHandle?: string
  readonly homeUrl?: string
  readonly avatarUrl?: string
  /** 数组或逗号分隔的字符串都收（host 侧同款归一化）。 */
  readonly aliases?: string | readonly string[]
  readonly weight?: number
  /**
   * X 主页链接（2026-10-28 用户：「设置里的账号我以后直接给你他的主页」）。
   * 只给 url 不给 name 时，host 会抓主页把名字与头像补全。
   */
  readonly url?: string
}

/** 首字的本地兜底（**只**在 host 没给 initial 时用，不是第二套实现）。 */
export function initialFallbackOf(name: string): string {
  for (const char of name.trim()) {
    if (/[\p{L}\p{N}]/u.test(char)) return char.toUpperCase()
  }
  return name.trim() === '' ? '?' : name.trim().slice(0, 1).toUpperCase()
}

/** 规范化一个关注对象（缺字段一律补默认值，绝不返回 undefined 字段）。 */
export function normalizeEntity(raw: unknown): FeedEntity | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = toText(item.id)
  const name = toText(item.name).trim()
  if (id === '' || name === '') return null
  const aliases = Array.isArray(item.aliases)
    ? item.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim() !== '')
    : []
  const count = optionalNumber(item.postCount)
  return {
    id,
    name,
    kind: item.kind === 'person' ? 'person' : 'company',
    ...(toText(item.xHandle) === '' ? {} : { xHandle: toText(item.xHandle) }),
    ...(toText(item.homeUrl) === '' ? {} : { homeUrl: toText(item.homeUrl) }),
    ...(toText(item.avatarUrl) === '' ? {} : { avatarUrl: toText(item.avatarUrl) }),
    aliases,
    ...(optionalNumber(item.weight) === undefined ? {} : { weight: optionalNumber(item.weight) }),
    createdAt: toNumber(item.createdAt),
    initial: toText(item.initial) === '' ? initialFallbackOf(name) : toText(item.initial),
    ...(count === undefined ? {} : { postCount: count }),
  }
}

/**
 * 拉关注对象列表。
 *
 * **永不抛**：host 还没重启（路由 404）、服务没挂、网络抖动 —— 一律返回
 * ok:false + 一句人话。悬浮球据此**整块不渲染**（而不是渲染一颗空球），
 * 页面其余部分完全不受影响。
 */
export async function fetchFeedEntities(): Promise<FeedResult<readonly FeedEntity[]>> {
  const result = await request<Record<string, unknown>>('/entities')
  if (!result.ok) return result
  const raw = result.data.entities
  if (!Array.isArray(raw)) return { ok: true, data: [] }
  return {
    ok: true,
    data: raw.map(normalizeEntity).filter((entity): entity is FeedEntity => entity !== null),
  }
}

/** 新增一个关注对象（host 判重：同名同类会被拒绝，错误文案照原样返回）。 */
export async function createFeedEntity(input: FeedEntityInput): Promise<FeedResult<FeedEntity>> {
  const result = await request<{ entity?: unknown }>('/entities', {
    method: 'POST',
    body: JSON.stringify(entityPayloadOf(input)),
  })
  if (!result.ok) return result
  const entity = normalizeEntity(result.data.entity)
  if (entity === null) return { ok: false, message: '已保存，但服务没有返回这个关注对象。' }
  return { ok: true, data: entity }
}

/** 修改一个关注对象（**只传要改的字段**；没传的 host 保持原值）。 */
export async function updateFeedEntity(id: string, patch: FeedEntityInput): Promise<FeedResult<FeedEntity>> {
  const result = await request<{ entity?: unknown }>('/entities', {
    method: 'PUT',
    body: JSON.stringify({ id, ...entityPayloadOf(patch) }),
  })
  if (!result.ok) return result
  const entity = normalizeEntity(result.data.entity)
  if (entity === null) return { ok: false, message: '已保存，但服务没有返回这个关注对象。' }
  return { ok: true, data: entity }
}

/** 取消关注（幂等：host 对不存在的 id 也回 ok）。 */
export async function deleteFeedEntity(id: string): Promise<FeedResult<null>> {
  const result = await request<unknown>('/entities', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
  if (!result.ok) return result
  return { ok: true, data: null }
}

/**
 * 拉某个关注对象名下的动态。
 *
 * 复用 GET /posts 的 `entity=<id>` 筛选（**同一段归属判定**，见 host 的 api.ts）：
 * 这样球上的条数与点开看到的列表不可能对不上。
 */
export async function fetchEntityPosts(entityId: string): Promise<FeedResult<readonly FeedDay[]>> {
  const query = new URLSearchParams()
  query.set('entity', entityId)
  const result = await request<{ days?: unknown }>('/posts?' + query.toString())
  if (!result.ok) return result
  return { ok: true, data: normalizeDays(result.data.days) }
}

/** 只把**用户真的填了**的字段放进请求体（空串不传，否则会建出一堆空字符串字段）。 */
function entityPayloadOf(input: FeedEntityInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.kind !== undefined) payload.kind = input.kind
  if (input.xHandle !== undefined) payload.xHandle = input.xHandle
  if (input.homeUrl !== undefined) payload.homeUrl = input.homeUrl
  if (input.avatarUrl !== undefined) payload.avatarUrl = input.avatarUrl
  if (input.aliases !== undefined) payload.aliases = input.aliases
  if (input.weight !== undefined) payload.weight = input.weight
  // 主页链接：host 见到它而没见到 name 时会抓主页补全（见 feed/api.ts 的 POST /entities）。
  if (input.url !== undefined) payload.url = input.url
  return payload
}

/** 导出给冒烟对拍。 */
