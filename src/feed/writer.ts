/**
 * dsh-chat-plus — 个人动态（Feed）· 真实写作流水线（host 半身）。
 *
 * 把「提示词」变成「真内容」的那一段：规划检索 → 检索 → 验活 → 写作 → 校验
 * （方案 §4 的阶段 2-6）。本文件是 P2 的核心，替换掉 P1 的占位 writer。
 *
 * ── 两条不可妥协的硬要求 ────────────────────────────────────────────
 *
 * **1. 不许有占位内容落地。** 写作失败就 0 条 + run.status = failed +
 * run.error 说清原因。用户看到「更新失败：模型没有返回内容」远好过看到
 * 一条「本轮动态（占位）」——后者会让整个动态页失去可信度。
 *
 * **2. 模型绝不能输出 URL（闸 2，从结构上消灭编造）。**
 * 给模型的来源清单是**带下标的**，它只能回 sourceIds: [0, 2]。落地时用
 * 下标去已验活清单里取真实 URL —— 模型手里根本没有 URL，也就没有机会编。
 * 再加一道兜底：正文里任何 http(s) 形式的链接一律剥掉（它只可能来自
 * 「回忆」，因为清单里根本没有 URL 可抄）。
 *
 * ── 降级策略（每一级都必须可失败且不拖垮整轮）──────────────────────
 *
 * | 故障 | 行为 |
 * |---|---|
 * | ctx.web 不可用 / 没有 provider | 本轮无检索，仍让模型基于提示词写，帖子标注无来源 |
 * | 单条 query 搜索失败 | 跳过该条，其余照常 |
 * | 单个 URL 验活失败 | 判 limited（抓不到不等于没有），保留 URL + 标题 |
 * | 模型调用失败 | 非默认模型时回退默认模型重试一次；仍失败则 0 条 + failed |
 * | JSON 解析失败 | 追加更强约束重试 1 次；仍失败则 0 条 + failed（**不产占位**） |
 * | 整轮超时（180s） | AbortController 中止，0 条 + failed（写明超时） |
 *
 * ── 可验证性（用户与 Lead 要能看出「内容真的来自模型」）─────────────
 *
 * 每一阶段都把计数写进 FeedWriteReport，由 executeRun 并进 run.stats：
 * queries / sourcesOpen / sourcesLimited / sourcesBlocked / rawChars /
 * modelUsed / modelResolution / degraded。看到 queries=0 且 rawChars=0
 * 就是检索与模型都没跑起来；看到 rawChars>0 但 postsCreated=0 就是
 * 校验把它们全丢了。
 *
 * ── 增量时间窗（2026-10-27，用户原话「只更新上次时间节点到当前时间节点」）
 *
 * sinceAt 由 executeRun 从「上一轮成功生成的时刻」定出来（见 incremental.ts 的
 * resolveSinceWindow），writer 里有**三处**用到它，缺一不可：
 *
 *  1. **检索限定**：第 3 条 query 加时间尾巴（同一天用中文日期，跨天用
 *     `after:YYYY-MM-DD`）。provider 认不认 after: 我们控制不了，所以这只是
 *     「让候选更可能落在窗口内」，不是保证。
 *  2. **结果过滤**：applySinceWindow 丢掉明确早于 sinceAt 的候选。缺
 *     publishedAt 的**保留但标注**（provider 不给时间是常态，一刀切会把
 *     「有内容的轮次」变成「一条来源都没有的轮次」）。
 *  3. **提示词**：system 里明确「本轮的时间范围：从 X 到现在」，user 里再强调
 *     一次；来源清单里缺时间的条目会标「（发布时间未知）」。
 *
 * ── 去重：判断权归模型（用户原话「让模型自己去判断去重」）────────────
 *
 * 这一层**不做**字符串相似度阈值判定。理由是语义重复（同一件事换个说法、
 * 同一批资料的另一个角度）字符串算不出来：「模型权重层算不算技术出口」与
 * 「开源加条款：披露、阈值、迁移限制」2-gram 相似度很低，人一眼就知道是同一件事。
 *
 * 所以：
 *  - `formatKnownPostsBlock` 把已有内容的**标题 + 主题 + 来源域名 + 时间**摆给模型，
 *    并明确要求它自己判断；
 *  - 模型的输出里带 `skipped[]`（它主动放弃的候选 + 理由），由 readModelSkipped
 *    解析后记进 run.stats.modelSkipped / modelSkipNotes —— 判断**可追溯**；
 *  - 代码层只在 executeRun 落盘前留两条零歧义的兜底（incremental.ts 的
 *    dedupePosts：标题字符级相同、来源 URL 全重复）。
 *
 * @module
 */

import { createUserMessage } from '../vendor/dsh-llm/index.ts'
import {
  classifySource,
  domainOf,
  htmlToText,
  MAX_EXCERPT_CHARS,
  tightenSource,
  tweetToSource,
  type AccessVerdict,
  } from './sources.ts'
import type { FeedDraft, FeedWriteInput, FeedWriteReport, FeedWriter, KnownPostBrief } from './trigger.ts'
import { mergeReportIntoStats as mergeReportBase } from './trigger.ts'
import { MAX_FEED_MEDIA, type FeedMedia, type FeedRunStats, type FeedSource, type XTweet } from './types.ts'
import {
  applySinceWindow,
  formatDayCn,
  formatMomentCn,
  formatWindowInstruction,
  isoDateOf,
  MAX_KNOWN_POSTS_FOR_PROMPT,
  parsePublishedAt,
  sameLocalDay,
  urlKeyOf as sharedUrlKeyOf,
} from './incremental.ts'
import {
  readModelMaxTokens,
  resolveWriteRoute,
  type ServiceGetter,
  type WriteRoute,
  } from './models.ts'

/* ───────────────────────── 预算与上限 ───────────────────────── */

/** 整轮硬上限（方案 §4 的「单轮总耗时设上限」；用户点名的 180s）。 */
export const FEED_RUN_BUDGET_MS = 180_000

/** 单条 query 的检索超时。 */
export const WEB_SEARCH_TIMEOUT_MS = 25_000

/** 单个 URL 验活超时（代理卡住时靠它兜住）。 */
export const WEB_FETCH_TIMEOUT_MS = 9_000

/** 验活并发上限（方案 §4 阶段 4 要求「并发 ≤3」）。 */
export const WEB_FETCH_CONCURRENCY = 3

/** 每轮检索意图条数上限（2-3 条就够，多了慢且容易被限流）。 */
export const MAX_QUERIES = 3

/** 每条 query 的 maxResults。 */
export const SEARCH_MAX_RESULTS = 8

/** 送去验活的候选 URL 上限（再多就是浪费带宽与时间）。 */
export const MAX_CANDIDATES = 8

/**
 * 送去写作的来源名额 —— **不设上限**（用户 2026-10-28：「去掉名额限制」）。
 *
 * 沿革：8 → 24 → 无上限。前两个数字都造成过同一类问题：X 推文被名额截断，
 * 部分关注账号的内容压根没进提示词，于是那些账号永远写不出动态
 * （8 的时候 X 只占 4 条，6 个账号里必然有 2-3 个被挤掉）。
 *
 * 用 Infinity 而不是「一个很大的数字」：后者只是把同一个 bug 推迟到
 * 「关注账号更多的那天」才爆发。抓到的推文本来就不多（实测 6 个账号 11 条
 * 原创），全给模型没有任何代价。
 */
export const MAX_PROMPT_SOURCES = Number.POSITIVE_INFINITY

/** 喂给模型的单条来源正文上限（实测建议 1500-2500 字符）。 */
export const SOURCE_CONTEXT_CHARS = 2200

/**
 * 模型输出的输出预算下限。
 *
 * 为什么是 16384 而不是 8192：配置里 `reasoningEffort: max`，而**思考链也算在
 * maxTokens 里**。写 2-3 条动态正文本身只要 1-2k token，但思考链轻松吃掉一万。
 * 预算给紧了的后果不是报错，而是 finish 报 max-tokens、JSON 被截在半截 ——
 * 表现为"模型返回的不是可解析的 JSON"，却看不出根因在预算。
 * （prompt-optimize.ts 的 REASONING_HEADROOM 取的也是 16384。）
 */
const OUTPUT_BUDGET_FLOOR = 16_384

/** 拿不到模型声明时的兜底上限。 */
const OUTPUT_BUDGET_CEILING_FALLBACK = 32_768

/**
 * 本轮该让模型写几条 —— **由「有几个账号有新内容」决定，不设上限**。
 *
 * 用户原话：「所有账号而不是有上限」「去掉名额限制」。
 *
 * 算法：账号数 × 2（每个账号保底 1 条，再给 1 条余量），最少 3 条。
 * **没有上限** —— 前两版是固定值（5 / 12），第三版是 40 的兜底上限，
 * 都被用户否掉了：任何固定上限都意味着「关注更多账号时，总有几个写不出来」。
 *
 * 为什么敢完全放开：可用的 X 线索本来就受抓取端限制（不登录只能拿到每个账号
 * 主页首屏那几条），实测 6 个账号 11 条原创 —— 算出来是 12 条，离「写不完」
 * 差得远。真出现异常账号数时，模型自己的输出长度也会先触顶。
 *
 * @param accountCount - 本轮清单里出现的**不同账号数**（按 @handle 去重）。
 */
export function postsAskedFor(accountCount: number): number {
  const accounts = Number.isFinite(accountCount) ? Math.max(0, Math.floor(accountCount)) : 0
  return Math.max(3, accounts * 2)
}

/**
 * 数一数「来源清单里出现了几个不同的 X 账号」。
 *
 * 依据是 host 侧 `tweetToSource` 生成的标题格式：`@handle · 昵称`
 * （见 sources.ts）。只数 `x.com` 域名下的来源 —— 网页来源没有「账号」概念，
 * 把它们算进来会让目标条数虚高。
 *
 * @returns 不同账号数（按 @handle 小写去重）。
 */
export function countDistinctXAccounts(
  sources: readonly { url: string; title: string }[],
): number {
  const seen = new Set<string>()
  for (const source of sources) {
    if (!/^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(source.url)) continue
    const title = source.title.trim()
    if (!title.startsWith('@')) continue
    const handle = (title.split(' · ')[0] ?? '').trim().toLowerCase()
    if (handle.length > 1) seen.add(handle)
  }
  return seen.size
}

/**
 * 单条帖子正文上限（模型跑飞时兜底，不是为了限制正常输出）。
 *
 * 2026-10-28 从 1200 提到 2400：用户要求「X账号相关的动态不要压缩原文内容」，
 * 而关注账号的长推文翻成中文后很容易超过 1200 字 —— 那会被这里静默截断，
 * 界面上表现为「翻译到一半没了」。2400 字足以容纳 X 单条推文（上限 25000 字符，
 * 但个人动态不需要整篇长文）的完整翻译。
 */
const MAX_BODY_CHARS = 2400

/** 单条帖子标题上限。 */
const MAX_TITLE_CHARS = 60

/*
 * 交给模型的「已有内容」条数上限统一取 incremental.ts 的
 * MAX_KNOWN_POSTS_FOR_PROMPT（30 条）。
 *
 * 不再在这里另写一个 30：两处各写一个魔数时，调大调小必然只改一处，
 * 表现为「提示词里明明列了 30 条、去重池却按 12 条算」这种查不出来的漂移。
 */

/* ───────────────────────── 注入面 ───────────────────────── */

/** ctx.web 的最小面（结构对齐 dsh-web 的类型）。 */
export interface WebSourceLike {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export interface WebSearchResultLike {
  content?: string
  sources: readonly WebSourceLike[]
  truncated?: boolean
}

export interface WebFetchResultLike {
  url: string
  statusCode: number
  body: { kind: 'html' | 'text'; content: string }
  truncated?: boolean
}

export interface WebLike {
  search?: (
    request: { query: string; maxResults?: number },
    signal?: AbortSignal,
  ) => Promise<WebSearchResultLike>
  fetch?: (request: { url: string }, signal?: AbortSignal) => Promise<WebFetchResultLike>
}

/** 真实 writer 的依赖（全部可注入，冒烟不碰网络也不碰真模型）。 */
export interface RealWriterDeps {
  /** 取 cordis 服务（ctx.get 的投影）。缺失时 writer 一定失败并写明原因。 */
  getService?: ServiceGetter
  /** 覆盖 web 服务（测试用）。 */
  web?: WebLike | null
  /** 覆盖 llm 服务（测试用）。 */
  llm?: unknown
  /** 时刻来源（注入以便测试）。 */
  now?: () => number
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
  /** 整轮预算覆盖（测试用；默认 FEED_RUN_BUDGET_MS）。 */
  runBudgetMs?: number
  searchTimeoutMs?: number
  fetchTimeoutMs?: number
  concurrency?: number
}

/* ───────────────────────── 对外错误 ───────────────────────── */

/**
 * writer 的失败原因。
 *
 * 单独一个类而不是 Error：executeRun 要靠它区分「写作失败（0 条 + failed）」
 * 与「代码 bug（也记 failed 但要打日志堆栈）」，两类的 message 前缀不同，
 * 用户与排查者一眼能看出是谁的问题。
 */
export class FeedWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedWriteError'
  }
}

/* ───────────────────────── 检索意图规划（阶段 2） ───────────────────────── */

/** 提示词里这些动作词不是主题，拆关键词时剥掉（否则会拿「盯住」去搜）。 */
const ACTION_PREFIXES = [
  '盯住', '关注', '只收', '只看', '只要', '只读', '我想', '我要', '需要', '帮我',
  '每天', '每周', '两三条', '就够', '即可',
]

/** 纯虚词（单独出现时不作为检索词）。 */
const STOP_WORDS = new Set([
  '与', '和', '及', '或', '的', '了', '是', '在', '有', '我', '你', '他', '这', '那',
  '一手', '来源', '内容', '资讯', '信息', '新闻', '动态', '消息', '最新', '相关',
])

/** 从提示词里抽主题词（规则拆，不花一次模型调用）。 */
export function extractKeywords(prompt: string): string[] {
  const parts = prompt
    .replace(/[，。；、！？,.;!?:：""\u2018\u2019\u201c\u201d\u3001\u3002\uff0c\uff1b\uff01\uff1f…—\-~～()（）\[\]【】\n\r\t]/g, ' ')
    .split(/\s+/)
  const out: string[] = []
  for (const raw of parts) {
    // 先按「与 / 和 / 及 / 或」再切一层：中文里主题词常这么并起来。
    for (const piece of raw.split(/[与和及或]/)) {
      let text = piece.trim()
      if (text === '') continue
      for (const prefix of ACTION_PREFIXES) {
        if (text.startsWith(prefix) && text.length > prefix.length + 1) {
          text = text.slice(prefix.length).trim()
        }
      }
      if (text === '' || STOP_WORDS.has(text)) continue
      // 单字几乎拿不到有用召回，且会污染 query。
      if ([...text].length < 2) continue
      if (out.includes(text)) continue
      out.push(text)
      if (out.length >= 6) return out
    }
  }
  return out
}

/** 把时刻格式化成「2026年10月27日」（中文检索带上日期召回更准）。 */
export function formatTodayCn(now: number): string {
  const date = new Date(now)
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日'
}

/**
 * 从提示词拆出 2-MAX_QUERIES 条检索意图（方案 §4 阶段 2）。
 *
 * 规则拆而不是让模型拆：多一次模型调用就是多十几秒与一份 token，而这段
 * 逻辑的目标只是「别只拿整句提示词去搜」。三条 query 各司其职：
 *
 *  1. 提示词原文 —— 语义最完整，向量检索友好；
 *  2. 主题词（去动作词/虚词）—— 去掉「盯住」「每天两三条」这类噪声；
 *  3. 主题词 + 日期 —— 抓「最近发生了什么」，纯语义 query 容易召回旧文章。
 *
 * ── 时间限定是怎么进 query 的（2026-10-27 增量需求）───────────────
 *
 * 检索 provider 的接口面**没有**统一的时间参数（`ctx.web.search` 只收
 * query 与 maxResults），所以时间限定只能写在 query 文本里：
 *
 *  - 与今天同一天 → 加今天的日期（`2026年10月27日`），与老行为一致；
 *  - **跨天**（水位线不是今天）→ 用 `after:YYYY-MM-DD` 这种检索器普遍认的
 *    前缀形式，而不是把两个日期都塞进去。两个日期塞进一句话，多数检索器
 *    只会把它当成关键词做字面匹配，反而把召回搞坏。
 *
 * 这是**尽力而为**：provider 认不认 after: 我们控制不了。真正的保证在
 * 「结果过滤（applySinceWindow）+ 提示词明确时间范围」那两步 ——
 * 检索只是让候选更可能落在窗口内。
 *
 * @param prompt - 用户提示词。
 * @param now - 当前时刻（毫秒）。
 * @param sinceAt - 本轮时间窗起点（毫秒；0 = 不启用）。
 */
export function planQueries(prompt: string, now: number, sinceAt = 0): string[] {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  const queries: string[] = []
  const push = (value: string): void => {
    const text = value.trim()
    if (text === '' || queries.length >= MAX_QUERIES) return
    // 归一化去重：只差空格/标点的两条 query 没有意义各搜一次。
    const key = text.replace(/\s+/g, '').toLowerCase()
    if (queries.some(item => item.replace(/\s+/g, '').toLowerCase() === key)) return
    queries.push(text)
  }

  if (clean !== '') push(clean.slice(0, 80))
  const keywords = extractKeywords(clean)
  if (keywords.length > 0) {
    push(keywords.slice(0, 4).join(' '))
    push(keywords.slice(0, 2).join(' ') + ' ' + timeHintOf(now, sinceAt))
  }
  return queries
}

/**
 * 第 3 条 query 的时间尾巴：跨天用 `after:YYYY-MM-DD`，同一天用中文日期。
 *
 * 抽成独立函数是为了让冒烟能直接对拍「跨天时到底拼了什么」——
 * 埋在 planQueries 里就只能通过整条 query 反推。
 */
export function timeHintOf(now: number, sinceAt = 0): string {
  const floor = typeof sinceAt === 'number' && Number.isFinite(sinceAt) && sinceAt > 0 ? sinceAt : 0
  if (floor > 0 && !sameLocalDay(floor, now)) return 'after:' + isoDateOf(floor)
  return formatTodayCn(now)
}

/* ───────────────────────── 检索（阶段 3） ───────────────────────── */

/** 候选来源（还没验活）。 */
export interface CandidateSource {
  url: string
  title?: string
  snippet?: string
  /** provider 给的发布日期原文（用于时间窗过滤，可能缺失）。 */
  publishedAt?: string | number
  /** 已解析的毫秒时间（0 = 未知）。 */
  publishedAtMs?: number
  /** 出参标记：缺发布时间。 */
  timeUnknown?: boolean
  /** 命中的 query 下标（排查时看「这条是怎么搜出来的」）。 */
  queryIndex: number
}

/**
 * URL 去重键（去 fragment、去末尾斜杠、host 小写）。解析失败返回原串。
 *
 * 实现搬到了 incremental.ts（去重那一层要用同一份），这里只做转发：
 * 两处各写一份必然分叉，而分叉的表现是「检索阶段认为两条不同、去重阶段认为
 * 相同」—— 那种不一致几乎无法从现象反推。
 */
export function urlKeyOf(url: string): string {
  return sharedUrlKeyOf(url)
}

/**
 * 合并多条 query 的结果、按 URL 去重、截断到 MAX_CANDIDATES。
 *
 * 只认 http(s)：provider 偶尔会给非 http 的 citation（如 mailto:），
 * 那些既不能验活也不能展示。
 */
export function mergeSearchResults(
  batches: ReadonlyArray<{ queryIndex: number; sources: readonly WebSourceLike[] }>,
  limit: number = MAX_CANDIDATES,
): CandidateSource[] {
  const seen = new Set<string>()
  const out: CandidateSource[] = []
  for (const batch of batches) {
    for (const source of batch.sources) {
      const url = typeof source?.url === 'string' ? source.url.trim() : ''
      if (url === '' || /^https?:\/\//i.test(url) === false) continue
      const key = urlKeyOf(url)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      out.push({
        url,
        ...(typeof source.title === 'string' && source.title.trim() !== '' ? { title: source.title.trim() } : {}),
        ...(typeof source.snippet === 'string' && source.snippet.trim() !== '' ? { snippet: source.snippet.trim() } : {}),
        // publishedAt 原样带下来：它下一步要用于时间窗过滤（缺了会在
        // applySinceWindow 里被标成 timeUnknown，不会在这里就被丢掉）。
        ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
        queryIndex: batch.queryIndex,
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

/* ───────────────────────── 验活（阶段 4） ───────────────────────── */

/** 验活后的来源（模型只看到下标 + 标题 + 域名 + 摘录，看不到 URL）。 */
export interface VerifiedSource {
  /** 清单下标 —— 模型输出的 sourceIds 就是它。 */
  index: number
  url: string
  domain: string
  title: string
  access: 'open' | 'limited'
  /** open 的正文摘录（给模型当上下文）。 */
  body: string
  /** limited 的话题线索（≤200 字符）。 */
  clue: string
  fetchedAt: number
  httpStatus?: number
  /**
   * provider 给的发布日期（毫秒；0 = 未知）。
   *
   * 只用于**时间窗过滤与提示词标注**，不落盘（FeedSource 没有这一格）：
   * 落盘会让「这条来源是哪天发的」变成迁移不掉的历史字段，而它唯一的作用
   * 就是「这一轮该不该写它」—— 判定完就没用了。
   */
  publishedAtMs?: number
  /** true = 发布时间未知（缺 publishedAt）。提示词据此如实标注，不假装是新的。 */
  timeUnknown?: boolean
  /**
   * 这条来源带的媒体类型（'photo' / 'video'，可多值）。仅 X 推文会有。
   *
   * 用途只有一个：**提示词里标注「含图 / 含视频」**，让模型在信息量相近时
   * 优先写带媒体的来源（用户 2026-10-28：「有图片或视频就把链接放上来」）。
   * 实测：21 条关注账号推文里 9 条带媒体，但模型按内容价值挑时经常挑中纯文字
   * 那几条 —— 页面上一张图都没有，用户以为「抓不到图」。
   * 不落盘（FeedSource 没有这一格），判定完就没用了。
   */
  mediaKinds?: string[]
}

/** 并发地跑一个异步映射（保持结果顺序）。 */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 给一次子调用套一个超时，并与整轮 signal 串起来。 */
function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, Math.max(1, timeoutMs))
  const onParentAbort = (): void => { controller.abort() }
  if (parent !== undefined) {
    if (parent.aborted) controller.abort()
    else parent.addEventListener('abort', onParentAbort)
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    },
  }
}

/** 把 web.fetch 的正文转成判定用的纯文本。 */
export function probeTextOf(body: { kind: 'html' | 'text'; content: string }): string {
  const raw = typeof body?.content === 'string' ? body.content : ''
  return body?.kind === 'html' ? htmlToText(raw) : raw.replace(/\s+/g, ' ').trim()
}

/** 单条来源的验活结果。 */
export interface ProbeOutcome {
  url: string
  verdict: AccessVerdict
  /** 判定用的纯文本（已被截断，只用于摘录，不整段留存）。 */
  text: string
  statusCode: number
  fetchedAt: number
}

/**
 * 验活一个 URL 并判定可用性（方案 §7.2 的 classifySource）。
 *
 * 关键约定：**抓不到 → limited，不是 blocked**。抓不到只说明我们没读到它，
 * 不说明它不开放；把「暂时失败」判成 blocked 会把好来源整批丢掉。
 */
export async function probeSource(
  web: WebLike | null,
  url: string,
  options: { timeoutMs?: number; signal?: AbortSignal; now?: () => number } = {},
): Promise<ProbeOutcome> {
  const now = options.now ?? Date.now
  const preVerdict = classifySource(url, null)
  // 已知不开放抓取的平台（X / 公众号…）**不发请求**：省时间也避免被判爬。
  if (preVerdict === 'limited') {
    return { url, verdict: 'limited', text: '', statusCode: 0, fetchedAt: 0 }
  }
  if (web === null || typeof web.fetch !== 'function') {
    return { url, verdict: 'limited', text: '', statusCode: 0, fetchedAt: 0 }
  }
  const guard = withTimeout(options.signal, options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS)
  try {
    const result = await web.fetch({ url }, guard.signal)
    const statusCode = typeof result?.statusCode === 'number' ? result.statusCode : 0
    const text = probeTextOf(result?.body ?? { kind: 'text', content: '' })
    const verdict = classifySource(url, { statusCode, text })
    return { url, verdict, text, statusCode, fetchedAt: now() }
  } catch {
    // 超时 / 网络错 / provider 报错：当作「没读到」，保留 URL 但按 limited 处理。
    return { url, verdict: 'limited', text: '', statusCode: 0, fetchedAt: 0 }
  } finally {
    guard.dispose()
  }
}

/**
 * 把候选来源跑成「已验活清单」。
 *
 * 三态处置（方案 §7.1）：
 *  - blocked  → **整条丢弃**（付费墙 / 法律限制 / 空壳页），计入 sourcesBlocked；
 *  - limited  → 只留 URL + 标题 + 线索摘要（**不带正文**，法律边界）；
 *  - open     → 留正文摘录（截断到 SOURCE_CONTEXT_CHARS）给模型当上下文。
 */
export async function verifyCandidates(
  web: WebLike | null,
  candidates: readonly CandidateSource[],
  options: {
    timeoutMs?: number
    concurrency?: number
    signal?: AbortSignal
    now?: () => number
    limit?: number
  } = {},
): Promise<{ sources: VerifiedSource[]; open: number; limited: number; blocked: number }> {
  const now = options.now ?? Date.now
  const probes = await mapPool(
    candidates,
    options.concurrency ?? WEB_FETCH_CONCURRENCY,
    candidate => probeSource(web, candidate.url, {
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      now,
    }),
  )

  const sources: VerifiedSource[] = []
  let open = 0
  let limited = 0
  let blocked = 0
  const limit = options.limit ?? MAX_PROMPT_SOURCES
  for (let index = 0; index < probes.length; index += 1) {
    const probe = probes[index]!
    const candidate = candidates[index]!
    if (probe.verdict === 'blocked') {
      blocked += 1
      continue
    }
    if (sources.length >= limit) continue
    const domain = domainOf(probe.url)
    // 已解析的毫秒时间优先（applySinceWindow 会填），否则现解析一次。
    const publishedAtMs = typeof candidate.publishedAtMs === 'number' && candidate.publishedAtMs > 0
      ? candidate.publishedAtMs
      : parsePublishedAt(candidate.publishedAt)
    const title = candidate.title !== undefined && candidate.title !== ''
      ? candidate.title
      : (domain === '' ? probe.url : domain)
    if (probe.verdict === 'open') {
      open += 1
      sources.push({
        index: sources.length,
        url: probe.url,
        domain,
        title,
        access: 'open',
        body: probe.text.slice(0, SOURCE_CONTEXT_CHARS),
        clue: '',
        fetchedAt: probe.fetchedAt,
        ...(probe.statusCode > 0 ? { httpStatus: probe.statusCode } : {}),
        ...(publishedAtMs > 0 ? { publishedAtMs } : { timeUnknown: true }),
      })
      continue
    }
    // limited：正文一律不留，只留一句话题线索（≤200 字符）。
    limited += 1
    const clue = (candidate.snippet ?? candidate.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    sources.push({
      index: sources.length,
      url: probe.url,
      domain,
      title,
      access: 'limited',
      body: '',
      clue,
      fetchedAt: probe.fetchedAt,
      ...(probe.statusCode > 0 ? { httpStatus: probe.statusCode } : {}),
      ...(publishedAtMs > 0 ? { publishedAtMs } : { timeUnknown: true }),
    })
  }
  return { sources, open, limited, blocked }
}

/**
 * 把 X 线索合并进清单（X 恒为 limited，见 sources.ts 的 tweetToSource）。
 *
 * ⚠ **X 线索优先，网页来源让位**（2026-10-27 实测修正）。
 *
 * 原实现是「网页来源原样保留，推文往后追加，超上限就 break」。实测踩到：
 * 网页检索一轮产出正好 8 条（= MAX_PROMPT_SOURCES），于是 `next.length >= limit`
 * 在第一条推文就命中 —— **抓到的 21 条关注账号推文一条都没进清单**。模型看到的
 * 全是「值得关注的 AI 账号清单」这类泛化网页，判定「不是关注账号本人发的」，
 * 交 0 条；而 stats 里 sourcesLimited 看起来正常，完全看不出根因。
 *
 * 用户要的是「这几个关注账号的动态」，X 线索才是主体、网页检索是补充。
 * 所以：X 最多占一半名额（优先保新鲜的），剩下的一半留给网页来源。
 *
 * @param sources - 已验活的网页来源（保持原顺序，超出预算时从尾部截断）。
 * @param tweets - 关注账号的推文（已按时间倒序）。
 * @param limit - 清单总名额。
 */
export function appendTweetsAsSources(
  sources: readonly VerifiedSource[],
  tweets: readonly XTweet[],
  limit: number = MAX_PROMPT_SOURCES,
): VerifiedSource[] {
  /*
   * X 推文**优先占满**（2026-10-28 修正）。
   *
   * 原来是「最多占一半」（limit=8 时只放 4 条）—— 关注 6 个账号、抓到 11 条
   * 原创推文时，有 7 条连提示词都没进去，对应的账号自然一条动态都写不出来。
   * 用户要的是「这些账号的动态」，X 线索才是主体，网页来源只是补充，
   * 所以顺序反过来：先把 X 全部放下，剩下的名额才给网页。
   */
  const tweetBudget = limit
  const next: VerifiedSource[] = []
  const seen = new Set<string>()

  for (const tweet of tweets) {
    if (next.length >= tweetBudget) break
    const source = tweetToSource(tweet)
    const key = urlKeyOf(source.url)
    if (seen.has(key)) continue
    seen.add(key)
    next.push({
      index: next.length,
      url: source.url,
      domain: source.domain,
      title: source.title,
      access: 'limited',
      body: '',
      // 推文原文**完整**给模型（用户：「不要压缩原文内容」）——
      // 截断会让模型看不到后半句，翻译出来就是残缺的。
      clue: (source.excerpt ?? '').slice(0, MAX_EXCERPT_CHARS),
      fetchedAt: source.fetchedAt,
      // X 推文的 createdAt 是**已知**的（抓取时就解析出来了），所以这里一定
      // 有真实发布时间 —— 除非它是 0（解析失败），那时才标 timeUnknown。
      ...(tweet.createdAt > 0 ? { publishedAtMs: tweet.createdAt } : { timeUnknown: true }),
      // 带上媒体类型，供提示词标注「含图 / 含视频」（不落盘）。
      ...(tweet.media.length > 0 ? { mediaKinds: [...new Set(tweet.media.map(m => m.type))] } : {}),
    })
  }

  // 剩余名额给网页来源（可能被 X 挤掉一部分，这是有意的）。
  for (const source of sources) {
    if (next.length >= limit) break
    const key = urlKeyOf(source.url)
    if (seen.has(key)) continue
    seen.add(key)
    next.push({ ...source, index: next.length })
  }

  return next
}

/* ───────────────────────── 媒体（图片 / 视频） ───────────────────────── */

/**
 * 从「这条帖子引用的来源」里收集媒体（2026-10-28 用户要求）。
 *
 * 用户原话：「他们的动态有图片或视频就把链接放上来，渲染出来，可播放可查看」。
 *
 * ── 为什么必须在 writer 里做，而不是在 trigger 落盘时做 ──────────────
 *
 * 媒体只存在于**抓到的推文对象**里（XTweet.media），而 `sourceRefs` 只是
 * FeedSource（url/domain/title/access/…，没有媒体）。推文对象在本函数所在的
 * 作用域（`withTweets` 的组装处）之后就不存在了 —— 那里是唯一能按 URL
 * 把「这条帖引用了哪条推文」还原出来的地方。
 *
 * ── 归属判定为什么按 URL 全等 ────────────────────────────────────
 *
 * X 来源的 URL 是 host 侧自己拼的（tweetToSource → tweet.url），与推文对象
 * 的 url 是**同一个字符串**，不存在「差不多」的写法。用全等而不是子串/前缀
 * 匹配：子串匹配会让 `.../status/12` 命中 `.../status/123` 那条推文的媒体，
 * 把别人的图挂到这条动态上 —— 那种错误在界面上完全看不出来。
 *
 * @param sources - 这条帖子引用的来源（VerifiedSource，含真实 URL）。
 * @param tweets - 本轮进过清单的推文（fresh + stale）。
 * @returns 落盘用的媒体数组（已截断到 MAX_FEED_MEDIA，可能为空）。
 */
export function collectDraftMedia(
  sources: readonly VerifiedSource[],
  tweets: readonly XTweet[],
): FeedMedia[] {
  if (sources.length === 0 || tweets.length === 0) return []
  // URL → 推文：一次建表，避免「每条来源扫一遍全部推文」。
  const byUrl = new Map<string, XTweet>()
  for (const tweet of tweets) {
    if (tweet.media.length === 0) continue
    byUrl.set(tweet.url, tweet)
  }
  if (byUrl.size === 0) return []

  const out: FeedMedia[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const tweet = byUrl.get(source.url)
    if (tweet === undefined) continue
    for (const item of tweet.media) {
      if (out.length >= MAX_FEED_MEDIA) return out
      /*
       * 同一条推文可能被两条动态同时引用（模型常这么干），去重键用
       * 「媒体 URL + 视频直链」：同一张图重复出现只是白占位置，
       * 而 videoUrl 进键是为了不把「同封面不同视频」的两条误判成一条。
       */
      const key = item.url + '\u0000' + (item.videoUrl ?? '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        url: item.url,
        type: item.type,
        ...(item.videoUrl === undefined ? {} : { videoUrl: item.videoUrl }),
        ...(item.width === undefined ? {} : { width: item.width }),
        ...(item.height === undefined ? {} : { height: item.height }),
        // 溯源：这张图是哪条推文带来的（界面「查看原推」/ 核对版权都用它）。
        sourceUrl: tweet.url,
      })
    }
  }
  return out
}

/**
 * 从「这条帖子引用的来源」里还原出**推文原文**（2026-10-28 用户要求）。
 *
 * 用户原话：「X账号相关的动态不要压缩原文内容，如果原文是英文翻译中文原文放里面」。
 *
 * 与 {@link collectDraftMedia} 完全同一条链路（按 URL 全等匹配推文对象），
 * 但取的是 `tweet.text` 而不是 `tweet.media`。
 *
 * 为什么只取**第一条**命中的推文：一条动态通常只引用一条推文；如果模型把
 * 两三条推文拼进一条动态，正文是综合翻译，没有「唯一原文」可放 —— 那种情况下
 * 取第一条（模型 sourceIds 里的首个）最接近「这条动态主要在讲什么」。
 *
 * @returns `{ originalText, originalLang }`；没有可用原文时返回 null（不落这一格）。
 */
export function collectDraftOriginal(
  sources: readonly VerifiedSource[],
  tweets: readonly XTweet[],
): { originalText: string; originalLang: string } | null {
  if (sources.length === 0 || tweets.length === 0) return null
  const byUrl = new Map<string, XTweet>()
  for (const tweet of tweets) {
    if (tweet.text.trim() === '') continue
    byUrl.set(tweet.url, tweet)
  }
  if (byUrl.size === 0) return null
  for (const source of sources) {
    const tweet = byUrl.get(source.url)
    if (tweet === undefined) continue
    return {
      // 原文**不压缩**，只归一化空白（推文里的换行在界面按段落渲染）。
      originalText: tweet.text.trim().slice(0, MAX_EXCERPT_CHARS),
      originalLang: (tweet.lang ?? '').trim() || 'en',
    }
  }
  return null
}

/** 已验活清单 → 落盘用 FeedSource（再过一道 tightenSource 收紧）。 */
export function toFeedSources(source: VerifiedSource): FeedSource {
  const base: FeedSource = {
    url: source.url,
    domain: source.domain,
    title: source.title,
    access: source.access,
    fetchedAt: source.fetchedAt,
    ...(source.httpStatus !== undefined ? { httpStatus: source.httpStatus } : {}),
    ...(source.access === 'open' ? { snippet: source.body.slice(0, 300) } : {}),
    ...(source.access === 'limited' && source.clue !== '' ? { excerpt: source.clue } : {}),
  }
  return tightenSource(base)
}

/* ───────────────────────── 提示词组装（阶段 5） ───────────────────────── */

/**
 * 给模型看的来源清单（**只有下标，没有 URL**）。
 *
 * 这是闸 2 的落点：模型能引用的唯一凭据是 [0] [1] … 这些下标，
 * 真实 URL 只存在于 host 侧对象里，落地时按下标取。模型即便「想」编一个
 * 链接也没有可抄的样本 —— 从结构上而不是从措辞上消灭编造。
 */
export function formatSourceListForPrompt(sources: readonly VerifiedSource[]): string {
  if (sources.length === 0) return '（本轮没有检索到可用来源，请只基于用户的关注点写，不要编造任何链接。）'
  return sources.map(source => {
    const mediaTag = (() => {
      const kinds = source.mediaKinds ?? []
      if (kinds.length === 0) return ''
      if (kinds.includes('video') || kinds.includes('animated_gif')) return '（含视频）'
      if (kinds.includes('photo')) return '（含图）'
      return ''
    })()
    const head = '[' + source.index + '] ' + source.title + ' — ' + (source.domain === '' ? '未知站点' : source.domain)
      + (source.access === 'limited' ? '（不开放抓取，只知道话题线索）' : '')
      + (source.timeUnknown === true ? '（发布时间未知）' : '')
      + mediaTag
    const detail = source.access === 'open' && source.body !== ''
      ? source.body
      : (source.clue !== '' ? source.clue : '（无摘要）')
    return head + '\n    ' + detail.replace(/\n+/g, ' ')
  }).join('\n')
}

/**
 * 写作的 system 提示词。
 *
 * @param sinceAt - 本轮时间窗起点（毫秒）；0/undefined 时不写时间范围段。
 * @param now - 现在（毫秒）。
 */
export function writerSystemPrompt(sinceAt?: number, now?: number): string {
  const lines: string[] = [
    '你是一个个人资讯编辑，负责按用户长期关注点写「这段时间值得一看的新动态」。',
    '',
  ]
  /*
   * 时间范围写进 **system** 而不是 user：system 是模型的长期约束，user 是这一轮
   * 的具体任务与数据。时间窗属于「本次任务的边界」，放 system 更不容易被后面那
   * 一长串来源清单与历史标题冲淡（实测：放在 user 末尾时模型经常整段忽略）。
   */
  if (typeof sinceAt === 'number' && sinceAt > 0) {
    lines.push(formatWindowInstruction(sinceAt, typeof now === 'number' ? now : Date.now()))
    lines.push('')
  }
  lines.push('硬规则（违反任意一条，产出会被全部丢弃）：')
  lines.push('1. 只能引用用户消息里给出的**来源编号**（形如 [0] [1] 的方括号数字），绝不输出任何网址、域名或链接。')
  lines.push('   你没有网址可抄，凭空写出来的链接一定是错的。')
  lines.push('2. 每条动态必须写「发生了什么 + 为什么值得关注」，不要复述来源原文（不接受转载式抄写）。')
  /*
   * 第 3 条在 2026-10-28 拆成两种情形（用户：「X账号相关的动态不要压缩原文内容，
   * 如果原文是英文翻译中文原文放里面」）。
   *
   * 原来一刀切「2-4 句、最长 300 字」，对网页资讯是对的（用户要的是摘要），
   * 但对**关注账号的推文**是错的 —— 那条推文本身就是用户想看的内容，
   * 压成 300 字等于把原文吃掉一半。所以：
   *   · X 关注账号推文 → 完整翻译/转述，不设 300 字上限（上限交给 1200 字防爆）；
   *   · 其他来源 → 保持摘要口径。
   * 原文由系统另外落盘（FeedPost.originalText），模型不需要复述原文，
   * 只需要保证中文正文**信息完整**。
   */
  lines.push('3. 标题不超过 20 个字，要有信息量，不要写成报告标题。正文怎么写给两种来源：')
  /*
   * X 推文的正文规则（2026-10-28 用户第二次修正，非常关键）。
   *
   * 用户原话：「原文原文不是让你翻译人话，只是英文做一个翻译」。
   *
   * 上一版写的是「完整中文翻译与**转述**」——「转述」这个词让模型把第一人称的
   * 推文改写成第三人称的报道腔：
   *   原文「小花也要完整的一生！…所以我想，如果有一个既温柔，又有人味的 Bot…」
   *   被写成「liliMozi 发帖表示，受到大肥鱼等近期动态启发，萌生了打造专属 Bot 的想法…」
   * 用户看到的是「你把我关注的人的话改写成了通稿」，而不是「他原话是什么」。
   *
   * 正确口径：
   *   · 推文本来就是中文 → **照录原文**（只允许整理换行/分段，不许改写措辞、
   *     不许改人称、不许把第一人称改成第三人称）；
   *   · 推文是外文（英文等）→ **忠实直译**成中文（同样保留第一人称与语气），
   *     原文另行保存并在界面展示，模型不需要复述外文原文。
   * 也就是说：中文推文**不该被翻译/改写**，只有外文才需要翻。
   */
  lines.push('   · 来源是 X（域名 x.com，标题形如「@账号 · 昵称」）→ 那是用户主动关注账号本人的发言，'
    + '正文要**保留他本人的原话**，不要改写成新闻报道或第三人称转述：')
  lines.push('       – 推文原文是中文：**原样照录**（只可以整理换行与分段，一个字都不要改写，'
    + '不要加「他提到」「发帖表示」这类转述词，不要改人称）；')
  lines.push('       – 推文原文是英文/其他外文：**必须译成中文**（正文里不许出现成段的英文原句，'
    + '英文单词/产品名可以保留），忠实直译、保留第一人称与语气；外文原文由系统另行保存并展示，你不用复述。')
  /*
   * 实测补充（2026-10-28）：只写「忠实直译」时，模型对**很短**的英文推文会偷懒
   * 直接把原句抄进正文 —— 实测 lauren 的「hire grok bot! what are you going to
   * ship this week with grok bot?」被原样当成正文，一个字都没翻。用户看不懂英文
   * 原文才需要翻译，抄原文等于没做这件事。所以把「再短也要译」写成硬要求。
   */
  lines.push('         ⚠ 哪怕原文只有一句话（如「hire grok bot!」），也必须译成中文'
    + '（如「招个 grok bot 吧！」）—— 直接把英文原句当正文是不合格的。')
  lines.push('       – 两种情况都不要压缩、不要只摘一句、不要省略后半段。')
  lines.push('   · 其他来源（网页文章等）→ 用简体中文写 2-4 句，最长 300 字，写「发生了什么 + 为什么值得关注」。')
  lines.push('4. 不要编造来源里没有的事实、数字、人名、时间。来源没说的就不要写。')
  lines.push('5. 不同的动态尽量引用**不同**的来源；不要几条动态全都指向同一个编号。')
  /*
   * 「一条动态 = 一条推文」（2026-10-28 用户报障）。
   *
   * 用户截图原话：「一条动态怎么可能有两个原文，而且两个原文的动态都是不一样的」。
   * 实测那条帖把 lauren 的两条推文（一条晒新域名、一条招 grok bot）揉进同一段
   * 正文、sourceIds 同时引用两条 —— 界面上「原文来源 · 2 个」列出两条互不相干
   * 的推文，而正文是两者的拼接，用户看到的是「这条动态到底在讲哪条」。
   * 推文是「某个人说的原话」，一条动态只能对应一份原话；两条推文 = 两个事件 = 两条动态。
   */
  lines.push('5.1 **一条动态只能对应一条 X 推文**（清单里域名是 x.com 的编号，在 sourceIds 里最多用 1 个）。')
  lines.push('    两条推文讲的是两件事时，请分别写成两条动态 —— 绝对不要把两条推文揉进同一段正文：'
    + '那样读者会看到「两个互不相干的原文」，也无法判断这条动态到底在讲哪一条。')
  lines.push('    网页来源不受这条限制（可以一条动态引用多篇网页）。')
  /*
   * 第 6、7 条是「不要重复」在提示词层的落点（用户原话「并且不要重复」）。
   *
   * 为什么必须写「不要每个角度各写一条」：用户实测的 17 条里有 12 条都在讲同一
   * 件事（AI 出海合规），每条标题都不一样、每个角度都成立 —— 模型会认为它们
   * 各不相同，但人看到的是「同一件事写了 12 遍」。这是**语义层面的重复**，
   * 字符串相似度判不出来，只能靠模型自己的判断。
   */
  lines.push('6. 同一批资料里如果有多个角度，**只挑最有信息增量的 1-2 个**写，不要每个角度各写一条。')
  lines.push('7. 如果检索到的内容与「已经发过的内容」是**同一件事 / 同一批资料 / 同一个角度**，直接不写 —— 宁可少写，不要重复。')
  /*
   * 第 9 条：优先写带媒体的来源（用户 2026-10-28 要求「有图片或视频就把链接放上来」）。
   *
   * 媒体只存在于**推文来源**里（网页来源没有）。实测：21 条关注账号推文里 9 条
   * 带图/带视频，但模型按内容价值挑时经常挑中那几条纯文字 —— 结果页面上一条媒体
   * 都没有，用户以为「抓不到图」。这里只做**偏好**（同等价值时优先带媒体的），
   * 不是硬要求：内容本身没价值时仍然不该为了配图去写。
   */
  lines.push('9. 如果清单里有的来源带图片或视频（标注为「含图」/「含视频」），在信息量相近时**优先写它** —— 用户希望看到媒体内容。')
  lines.push('10. 只输出一个 JSON 对象，不要任何解释文字、不要 markdown 围栏。')
  lines.push('')
  lines.push('输出格式（严格）：')
  lines.push('{"posts":[{"title":"...","body":"...","sourceIds":[0,2],"topics":["tech"],"dueInHours":0}],'
    + '"skipped":[{"ofTitle":"...","why":"..."}]}')
  lines.push('')
  lines.push('字段说明：')
  lines.push('- sourceIds：本条引用的来源编号数组，元素必须是上面清单里**真实存在**的编号；')
  lines.push('  清单非空时至少给 1 个。数组里放数字，不要放字符串。')
  lines.push('  ⚠ x.com（推文）编号最多 1 个 —— 一条动态只有一个「原文」；多条推文请拆成多条动态。')
  lines.push('- topics：1-3 个小写英文或中文标签，用来归到左栏频道（如 tech / fit / 商业）。')
  lines.push('- dueInHours：如果需要用户在某小时内处理就填数字，否则填 0。')
  /*
   * skipped 是「让模型自己判断去重」这条路的**可观测落点**（2026-10-27 用户要求）。
   *
   * 没有它也不是不能去重，但用户与排查者就永远看不到「模型到底判了什么」。
   * 有了它，run.stats.modelSkipped 能直接回答「这轮为什么只有 2 条」——
   * 是模型主动跳过了 3 条重复，而不是检索没内容。
   */
  lines.push('- skipped：数组，列出**你判断后主动放弃**的候选，每条说清它与哪条已发内容重复。')
  lines.push('  ofTitle：与之重复的那条已发内容的标题（照抄上面清单里的标题）；')
  lines.push('  why：一句话说明为什么判为重复（如「与某条同属技术出口管制这件事」）。')
  lines.push('  没有可跳过的就给空数组 []。')
  return lines.join('\n')
}

/**
 * 把「已经发过的内容」摆给模型，并要求它**自己判断**哪些是同一件事。
 *
 * 为什么不再只列标题（2026-10-27 用户要求「让模型自己去判断去重」）：
 *
 *  - 只有标题串时，模型判不出「模型权重层算不算技术出口」与「开源加条款：
 *    披露、阈值、迁移限制」是同一件事 —— 字面几乎没有重叠；
 *  - 主题（topics）说明了这条属于哪个频道；
 *  - 来源域名说明了**它当时用的是哪批资料**，这正是「同一批资料的另一个角度」
 *    唯一可靠的线索（用户实测：同一批 5 个法律站被反复使用 2-3 次）。
 *
 * 域名可以出现在提示词里：它与「协议头 + 路径」拼不出可访问地址，闸 2 不受影响
 * （见 formatSourceListForPrompt 的同款理由）。
 *
 * @returns 追加到 user 文本里的段落行；没有历史时返回空数组。
 */
export function formatKnownPostsBlock(knownPosts: readonly KnownPostBrief[]): string[] {
  const list = knownPosts.filter(post => typeof post?.title === 'string' && post.title.trim() !== '')
  if (list.length === 0) return []
  const blocks: string[] = []
  blocks.push('')
  blocks.push('【已经发过的内容 —— 请你自己判断哪些是同一件事】')
  blocks.push('下面是之前已经发过的动态。请你判断本轮候选内容里，哪些与它们是同一件事 / 同一批资料 / 同一个角度：')
  blocks.push('')
  list.forEach((post, index) => {
    blocks.push((index + 1) + '. 标题：' + post.title.trim())
    if (Array.isArray(post.topics) && post.topics.length > 0) {
      blocks.push('   主题：' + post.topics.join('、'))
    }
    if (Array.isArray(post.domains) && post.domains.length > 0) {
      blocks.push('   当时的来源：' + post.domains.join('、'))
    }
    if (typeof post.createdAt === 'number' && post.createdAt > 0) {
      blocks.push('   发布时间：' + formatDayCn(post.createdAt))
    }
  })
  blocks.push('')
  blocks.push('**判断标准（请严格执行）**：')
  blocks.push('- 如果候选内容与上面任一条说的是**同一件事**（哪怕标题写得不一样）→ 不要写这条')
  blocks.push('- 如果候选内容与上面某条只是**同一批资料的另一个角度** → 不要写这条')
  blocks.push('- 如果只是**话题大类相同但事件不同**（比如都是 AI 监管，但一个是欧盟、一个是美国）→ 可以写')
  blocks.push('- 宁可少写 1-2 条，也不要写重复的；被你这样放弃的候选，请写进输出里的 skipped 数组')
  return blocks
}

/**
 * 「本轮关注的对象」段（2026-10-27「右侧悬浮球」的配套增强）。
 *
 * 为什么这里值得多占几十个 token：它同时喂给模型**两个**互相独立的判断，
 * 而且两个都用得上：
 *
 *  1. **写什么**：用户关注的人/公司，本轮优先覆盖他们的新进展（否则模型会
 *     按提示词的大主题泛泛而写，悬浮球点开永远是空的）；
 *  2. **判重**：「用户关注的这个人的同一件事被写两遍」是最强的一条重复信号，
 *     比标题字面比对和来源域名比对都准 —— 而判重的权力按用户要求归模型。
 *
 * ⚠ 这里只做**数据注入**，不做任何判断：不给模型排优先级、不告诉它谁更重要、
 *   也不在代码里按 entities 去重。判断全部留在模型那一侧 —— 这是 feed-incremental
 *   在 writer.ts 里已经定好的分工（见 formatKnownPostsBlock 的同款说明）。
 *
 * 只下发名字 / 类型 / 别名三个字段（见 entities.ts 的 writerEntitiesOf）：
 * id 不能让模型看见（它会照抄、而且抄错就静默丢归属），头像与 URL 对写内容
 * 没有帮助、只是白占 token。
 *
 * @returns 追加到 user 文本里的段落行；没有关注对象时返回空数组。
 */
export function formatFollowedEntitiesBlock(
  entities: readonly { name: string; kind: 'person' | 'company'; aliases?: readonly string[] }[],
): string[] {
  const list = entities.filter(entity => typeof entity?.name === 'string' && entity.name.trim() !== '')
  if (list.length === 0) return []
  const blocks: string[] = []
  blocks.push('')
  blocks.push('【本轮关注的对象】')
  blocks.push('用户特别关注下面这些人物/公司，请优先覆盖与它们相关的新进展：')
  for (const entity of list) {
    const aliases = Array.isArray(entity.aliases) ? entity.aliases.filter(alias => alias.trim() !== '') : []
    blocks.push('- ' + entity.name.trim() + '（' + (entity.kind === 'person' ? '人物' : '公司') + '）'
      + (aliases.length > 0 ? '  别名：' + aliases.join('、') : ''))
  }
  blocks.push('')
  blocks.push('判断重复时也要利用这一层线索：**同一个人的同一件事**如果已经发过，就不要写第二条。')
  blocks.push('同时在输出 JSON 里为每条动态标注它主要关于谁：')
  blocks.push('  "entities": ["OpenAI"]   ← 用上面的名字（不是别名、不是 id），没有就留空数组')
  /*
   * 归属只标**发言者**（2026-10-28 实测修正）。
   *
   * 踩到的现象：liliMozi 发推批评 Claude 的新客户端，模型把那条动态同时标成
   * 「liliMozi + Claude」两个实体 —— 于是点开 Claude 账号，看到的是别人在批评
   * Claude 的推文。用户会直接理解成「这条不是 Claude 发的」。
   *
   * 规则：一条动态归属「谁说的」，不是「提到了谁」。被提到的人只该出现在正文里。
   */
  blocks.push('⚠ 归属只标**这条动态是谁发的**（X 来源里 @ 后面的那个账号），'
    + '不要把「正文里提到的人/公司」也标进去 —— 点开某个账号时应该只看到它自己发的内容。')
  return blocks
}
/** 组装一次写作的 user 文本。 */
export function buildWriterUserText(input: {
  prompt: string
  now: number
  sources: readonly VerifiedSource[]
  knownTitles: readonly string[]
  /** 已有内容的完整信息（有就用它，没有才回落到 knownTitles）。 */
  knownPosts?: readonly KnownPostBrief[]
  /** 本轮时间窗起点（毫秒）；有值时在 user 里再强调一次。 */
  sinceAt?: number
  degradeNote?: string
  /**
   * 本轮关注的人物 / 公司（右侧悬浮球里那几枚球对应的人）。
   *
   * **可选**：没有关注对象时整段不出现（老调用方与冒烟都不传）。
   * 形状刻意只留名字/类型/别名三格 —— 见 formatFollowedEntitiesBlock 的说明。
   */
  followedEntities?: readonly { name: string; kind: 'person' | 'company'; aliases?: readonly string[] }[]
}): string {
  const blocks: string[] = []
  blocks.push('用户长期关注点（提示词）：' + input.prompt.trim())
  blocks.push('今天是 ' + formatDayCn(input.now) + '。')
  /*
   * 时间窗在 user 里**再强调一次**（system 里已经写过一遍）。
   *
   * 重复不是啰嗦：system 与 user 之间隔着整段来源清单，实测模型对「本轮只写
   * 这段时间」这类边界条件的遵守率，两处都写明显高于只写 system。这一句很短，
   * 代价可以忽略。
   */
  if (typeof input.sinceAt === 'number' && input.sinceAt > 0) {
    blocks.push('本轮只需要 ' + formatMomentCn(input.sinceAt) + ' 之后的新进展（更早的内容不要当成今天的新闻）。')
  }
  if (input.degradeNote !== undefined && input.degradeNote !== '') {
    blocks.push('注意：' + input.degradeNote)
  }
  /*
   * 关注对象段放在**来源清单之前**：模型读提示词是从上往下的，先把「这一轮
   * 该盯谁」摆出来，再给资料 —— 顺序反了（资料在前）实测更容易写出「资料
   * 综述」而不是「关于这个人发生了什么」。
   */
  if (input.followedEntities !== undefined && input.followedEntities.length > 0) {
    blocks.push(...formatFollowedEntitiesBlock(input.followedEntities))
  }
  blocks.push('')
  blocks.push('本轮已验活的来源清单（只能用编号引用，禁止输出网址）：')
  blocks.push(formatSourceListForPrompt(input.sources))

  /*
   * 已有内容：优先用信息更全的 knownPosts（标题 + 主题 + 来源），
   * 只有在调用方没给 knownPosts 时才回落到老契约 knownTitles ——
   * 冒烟里有只注入 knownTitles 的老用例，断掉它们没有意义。
   */
  const knownPosts = input.knownPosts ?? []
  if (knownPosts.length > 0) {
    blocks.push(...formatKnownPostsBlock(knownPosts))
  } else if (input.knownTitles.length > 0) {
    blocks.push('')
    blocks.push('已经发过、这次不要再重复的标题：')
    blocks.push(input.knownTitles.map(title => '- ' + title).join('\n'))
  }
  blocks.push('')
  /*
   * 「每个关注账号至少一条」（2026-10-28 用户反馈：「关注了这么多账号为啥只有
   * 2 个账号有动态」）。
   *
   * 原来的指令只说「写 1-N 条新的」，模型就按「信息量最大」挑两三条写 ——
   * 其余账号永远 0 条。但用户关注的是**这些账号**，他要的是「每个人最近说了什么」，
   * 而不是「今天最重要的三条」。所以这里把覆盖面写成硬要求：清单里出现了几个
   * 不同账号，就至少要有几条对应它们（上限仍然受 MAX_POSTS_ASKED 约束）。
   */
  const accountCount = countDistinctXAccounts(input.sources)
  const asked = postsAskedFor(accountCount)
  /*
   * 条数**由账号数决定**，不写死（用户 2026-10-28：「所有账号而不是有上限」）。
   * 清单里有 6 个账号 → 让模型写最多 12 条，每个账号都够分；
   * 有 1 个账号 → 写 3 条。所以「所有账号都有动态」是算出来的，不是靠调大常数。
   */
  blocks.push('请写 1-' + String(asked) + ' 条**新的、不与上面重复的**动态，只输出 JSON。')
  if (accountCount > 0) {
    blocks.push('⚠ 覆盖面要求：清单里有 ' + String(accountCount) + ' 个不同的账号，'
      + '**每一个账号至少写一条**（除非它已经在「已发过」清单里）。'
      + '用户关注的是这些账号本身，不要只挑「最重要的两三条」而让其余账号一条都没有。')
  }
  return blocks.join('\n')
}

/** 剥掉模型可能套在外面的 markdown 围栏。 */
export function stripCodeFence(raw: string): string {
  let text = raw.trim()
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(text)
  if (fence !== null) text = (fence[1] ?? '').trim()
  // 围栏没闭合（被 max-tokens 截断）时也要能剥。
  if (text.startsWith('```')) {
    const newline = text.indexOf('\n')
    if (newline > 0) text = text.slice(newline + 1).trim()
    if (text.endsWith('```')) text = text.slice(0, -3).trim()
  }
  return text
}

/** 模型产出的一条帖子（还没校验）。 */
export interface ModelPost {
  title: string
  body: string
  sourceIds: number[]
  topics: string[]
  dueInHours: number
  /**
   * 模型标注的「这条主要关于谁」（**名字**，不是 id）。
   *
   * 提示词里有一条专门要求它输出 entities: ["OpenAI"]（见 formatFollowedEntitiesBlock）。
   * 落盘时由 trigger.ts 用 entities.ts 的 resolveEntityIds 换回 id。
   * 模型没标 / 标了个不存在的人 → 空数组，此时靠别名兜底匹配（见 createEntityMatcher）。
   */
  entities: string[]
}

/**
 * 模型**自己判断**放弃的一条候选（输出里的 skipped[]）。
 *
 * 这是「让模型自己去判断去重」这条路唯一的可观测落点：模型判了什么、为什么判，
 * 都在这里。host 侧只记录与展示，**不再拿它做二次判定** —— 判定权归模型，
 * 因为语义重复（同一件事换个说法、同一批资料的另一个角度）字符串算不出来。
 */
export interface ModelSkipped {
  /** 与之重复的那条已发内容的标题（模型照抄历史清单时才有值）。 */
  ofTitle: string
  /** 一句话说明为什么判为重复。 */
  why: string
}

/** 解析结果。 */
export interface ParsedWriterOutput {
  posts: ModelPost[]
  /** 被跳过的畸形条目数（结构不对，不是校验失败）。 */
  malformed: number
  /** 模型主动放弃的候选（它可以只给 posts 不给 skipped，所以默认空数组）。 */
  skipped: ModelSkipped[]
}

/** 把 JSON 里的一个对象读成 ModelPost（宽松：字段缺失/类型不对都容忍）。 */
function readModelPost(raw: unknown): ModelPost | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
  const body = typeof record['body'] === 'string' ? record['body'].trim() : ''
  if (title === '' && body === '') return null
  const rawIds = record['sourceIds']
  const sourceIds: number[] = []
  if (Array.isArray(rawIds)) {
    for (const value of rawIds) {
      // 模型有时把编号写成字符串 "0" —— 容忍，但只认整数。
      const numeric = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : Number.NaN)
      if (Number.isInteger(numeric) && numeric >= 0) sourceIds.push(numeric)
    }
  }
  const rawTopics = record['topics']
  const topics: string[] = []
  if (Array.isArray(rawTopics)) {
    for (const value of rawTopics) {
      if (typeof value === 'string' && value.trim() !== '') topics.push(value.trim())
    }
  }
  const rawDue = record['dueInHours']
  const dueInHours = typeof rawDue === 'number' && Number.isFinite(rawDue) && rawDue > 0 ? rawDue : 0
  /*
   * entities：模型标注的「这条主要关于谁」（用名字）。
   *
   * 三种脏数据都要容忍，它们都是实测会出现的形态：
   *  - 完全没有这个字段（旧提示词 / 模型不听话）→ 空数组；
   *  - 给了个字符串而不是数组（`"entities": "OpenAI"`）→ 当成单元素数组；
   *  - 数组里混着 null / 数字 / 空串 → 只留非空字符串。
   */
  const rawEntities = record['entities']
  const entities: string[] = []
  const entityList = Array.isArray(rawEntities) ? rawEntities : (typeof rawEntities === 'string' ? [rawEntities] : [])
  for (const value of entityList) {
    if (typeof value === 'string' && value.trim() !== '') entities.push(value.trim())
  }
  return { title, body, sourceIds: [...new Set(sourceIds)], topics, dueInHours, entities: [...new Set(entities)] }
}

/**
 * 解析模型输出为结构化帖子（**容错**：围栏、前后说明文字、顶层数组都认）。
 *
 * 四种形态都接受：
 *  - {"posts":[...]}（约定形态）；
 *  - {"items":[...]} / {"data":[...]}（模型换了字段名）；
 *  - 裸数组 [{...}]（模型懒得包一层）；
 *  - 单个对象 {...}（只产一条时）。
 *
 * @returns 解析结果；完全找不到 JSON 结构时返回 null（调用方据此重试）。
 */
export function parseWriterOutput(raw: string): ParsedWriterOutput | null {
  const text = stripCodeFence(raw)
  if (text === '') return null

  const tryParse = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate)
    } catch {
      return undefined
    }
  }

  let data: unknown = tryParse(text)
  if (data === undefined) {
    // 截断/夹带解释文字：取第一个 { 到最后一个 }（或第一个 [ 到最后一个 ]）。
    const objStart = text.indexOf('{')
    const objEnd = text.lastIndexOf('}')
    if (objStart >= 0 && objEnd > objStart) data = tryParse(text.slice(objStart, objEnd + 1))
    if (data === undefined) {
      const arrStart = text.indexOf('[')
      const arrEnd = text.lastIndexOf(']')
      if (arrStart >= 0 && arrEnd > arrStart) data = tryParse(text.slice(arrStart, arrEnd + 1))
    }
  }
  if (data === undefined) return null

  let rows: unknown[] | null = null
  if (Array.isArray(data)) {
    rows = data
  } else if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>
    for (const key of ['posts', 'items', 'data', 'list', 'results']) {
      const value = record[key]
      if (Array.isArray(value)) { rows = value; break }
    }
    // 只给了一条、而且没包数组：把整个对象当一条帖子。
    if (rows === null && (typeof record['title'] === 'string' || typeof record['body'] === 'string')) {
      rows = [record]
    }
  }
  if (rows === null) return null

  const posts: ModelPost[] = []
  let malformed = 0
  for (const row of rows) {
    const post = readModelPost(row)
    if (post === null) { malformed += 1; continue }
    posts.push(post)
  }
  return { posts, malformed, skipped: readModelSkipped(data) }
}

/**
 * 读模型自己报的 skipped[]（它主动判为重复 / 无信息增量而放弃的候选）。
 *
 * 三种形态都认，因为模型不总是严格按约定写：
 *  - [{ ofTitle, why }]              —— 约定形态；
 *  - ["某标题", "另一条"]           —— 只给了标题串；
 *  - 字段名写成 title / reason / of  —— 实测模型爱改字段名。
 *
 * 读不出来就给空数组：**这个字段缺失不影响去重正确性**（提示词约束与兜底去重
 * 都在），它只影响「用户能不能看到模型判了什么」。为它抛错是拿可观测性换稳定性，
 * 不划算。
 */
export function readModelSkipped(data: unknown): ModelSkipped[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return []
  const raw = (data as Record<string, unknown>)['skipped']
  if (!Array.isArray(raw)) return []
  const out: ModelSkipped[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim()
      if (text !== '') out.push({ ofTitle: '', why: text.slice(0, 120) })
      continue
    }
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const readField = (key: string): string =>
      (typeof record[key] === 'string' ? (record[key] as string).trim() : '')
    const ofTitle = readField('ofTitle') || readField('of') || readField('duplicateOf') || readField('title')
    const why = readField('why') || readField('reason') || readField('note')
    if (ofTitle === '' && why === '') continue
    out.push({ ofTitle: ofTitle.slice(0, 80), why: why.slice(0, 120) })
    if (out.length >= 20) break
  }
  return out
}

/* ───────────────────────── 校验（阶段 6） ───────────────────────── */

/** 一条通过校验的帖子（还没转成 FeedDraft）。 */
export interface ValidatedPost {
  title: string
  body: string
  sources: VerifiedSource[]
  topics: string[]
  dueAt: number
  dueLabel: string
  /** 模型标注的「这条主要关于谁」（名字；换 id 在 trigger.ts 里做）。 */
  entities: string[]
}

/** 校验结果（dropped 记原因，写进 run.error 便于用户看懂为什么没内容）。 */
export interface ValidateResult {
  accepted: ValidatedPost[]
  dropped: number
  reasons: string[]
}

/**
 * 正文里的 http(s) 链接一律剥掉（闸 2 的兜底）。
 *
 * 为什么可以无条件剥：给模型的清单里**根本没有 URL**，正文里出现链接
 * 只可能来自它的「记忆」。那类链接要么是编的，要么是旧训练数据里的地址，
 * 两种都不该呈现给用户。剥掉链接不影响正文可读性（来源单独展示）。
 */
export function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)）\]】"\u2019\u201d，。；！？]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。；！？、])/g, '$1')
    .trim()
}

/** 由 dueAt 生成展示文案（今天/明天 + HH:mm；无截止返回空串）。 */
export function dueLabelOf(dueAt: number, now: number): string {
  if (dueAt <= 0) return ''
  const date = new Date(dueAt)
  const today = new Date(now)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000)
  const isTomorrow = date.getFullYear() === tomorrow.getFullYear()
    && date.getMonth() === tomorrow.getMonth()
    && date.getDate() === tomorrow.getDate()
  const prefix = sameDay ? '今天' : isTomorrow ? '明天' : (date.getMonth() + 1) + '/' + date.getDate()
  return prefix + ' ' + hh + ':' + mm
}

/**
 * 逐条校验模型产出的帖子（方案 §4 阶段 6 + §9 闸 1/2）。
 *
 * 与数据安全相关的四条（内容质量判定不在这一层）：
 *  1. 标题/正文非空、长度合理（空帖进列表就是一行空白）；
 *  2. sourceIds 每一条都必须是**已验活清单里真实存在的下标** —— 越界
 *     说明模型在编，整帖丢弃（闸 2 的最后一环）；
 *  3. 清单非空时必须至少引用 1 条来源（无出处的「新闻」不可信）；
 *  4. 来源按 §7.3 收紧（limited 不带正文摘要，由 toFeedSources 落实）。
 *
 * @param posts - 模型产出的帖子。
 * @param sources - 已验活清单（下标与 sourceIds 对齐）。
 * @param now - 当前时刻（算 dueAt）。
 */
export function validateModelPosts(
  posts: readonly ModelPost[],
  sources: readonly VerifiedSource[],
  now: number,
): ValidateResult {
  const accepted: ValidatedPost[] = []
  const reasons: string[] = []
  let dropped = 0
  const sourceCount = sources.length

  for (const post of posts) {
    const title = stripUrls(post.title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS)
    const body = stripUrls(post.body).replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_CHARS)
    if (title === '' || body === '') {
      dropped += 1
      reasons.push('标题或正文为空')
      continue
    }
    if (body.length < 8) {
      dropped += 1
      reasons.push('正文过短（' + body.length + ' 字符）')
      continue
    }

    // 闸 2：每一条 sourceId 都必须在清单范围内。
    const outOfRange = post.sourceIds.filter(id => id < 0 || id >= sourceCount)
    if (outOfRange.length > 0) {
      dropped += 1
      reasons.push('引用了不存在的来源编号 ' + outOfRange.slice(0, 3).join(',')
        + '（清单共 ' + sourceCount + ' 条）')
      continue
    }
    if (sourceCount > 0 && post.sourceIds.length === 0) {
      dropped += 1
      reasons.push('本轮有 ' + sourceCount + ' 条可用来源，但该帖一条都没引用')
      continue
    }

    const rawRefs = post.sourceIds
      .map(id => sources[id])
      .filter((source): source is VerifiedSource => source !== undefined)

    /*
     * 一条动态只能有一个「原文」：X 推文来源最多保留第一条（2026-10-28 用户报障）。
     *
     * 用户原话：「一条动态怎么可能有两个原文，而且两个原文的动态都是不一样的」。
     * 实测那条帖把 lauren 的两条推文（晒新域名 / 招 grok bot）揉进一段正文，
     * sourceIds 同时引了 [0,1] —— 来源浮层里出现两条互不相干的推文。
     *
     * 提示词层已经要求「一条动态只写一条推文」，这里是兜底：模型不听话时，
     * 仍然只保留 sourceIds 里**第一个** x.com 来源，其余推文丢弃。
     * 网页来源不受影响（一条动态可以引用多篇文章）—— 它们没有「原文」这层语义。
     */
    let keptTweet = false
    const refs = rawRefs.filter((source) => {
      if (source.domain !== 'x.com') return true
      if (keptTweet) return false
      keptTweet = true
      return true
    })

    const topics = [...new Set(post.topics
      .map(topic => topic.trim().toLowerCase())
      .filter(topic => topic !== ''))]
    const dueAt = post.dueInHours > 0 ? now + post.dueInHours * 60 * 60 * 1000 : 0

    accepted.push({
      title,
      body,
      sources: refs,
      topics,
      dueAt,
      dueLabel: dueLabelOf(dueAt, now),
      // 归属标注原样带过去（校验不判它：标错了只是没归属，不是坏内容）。
      entities: post.entities,
    })
  }
  return { accepted, dropped, reasons }
}

/* ───────────────────────── 模型调用 ───────────────────────── */

/** 一次模型调用的结果。 */
export interface StreamOutcome {
  /** 累积的正文（只收 text-delta，不含思考链）。 */
  text: string
  /** 失败原因；成功时为 null。 */
  failure: string | null
  /** 是否被 max-tokens 截断（可能是半截 JSON）。 */
  truncated: boolean
  tokensIn: number
  tokensOut: number
}

/** 按输出预算挑 maxTokens（推理模型的思考链也算在内，所以给足）。 */
export function outputBudget(modelCap: number | undefined): number {
  const ceiling = typeof modelCap === 'number' && Number.isSafeInteger(modelCap) && modelCap > 0
    ? modelCap
    : OUTPUT_BUDGET_CEILING_FALLBACK
  return Math.min(Math.max(OUTPUT_BUDGET_FLOOR, OUTPUT_BUDGET_FLOOR), ceiling)
}

/**
 * 调一次模型，把流收成一段文本。
 *
 * StreamChunk 的处理**照抄 prompt-optimize.ts:244-270**（那是本仓库里唯一
 * 一条已在生产跑通的 llm.stream 用法），只多收一份 usage。
 */
export async function streamOnce(
  llm: {
    stream?: (options: unknown) => AsyncIterable<unknown>
  },
  options: {
    provider: string
    model: string
    reasoningEffort?: string
    system: string
    userText: string
    maxTokens: number
    temperature: number
    signal: AbortSignal
  },
): Promise<StreamOutcome> {
  if (typeof llm.stream !== 'function') {
    return { text: '', failure: 'llm.stream 不可用（模型服务未装载）', truncated: false, tokensIn: 0, tokensOut: 0 }
  }
  let text = ''
  let failure: string | null = null
  let truncated = false
  let tokensIn = 0
  let tokensOut = 0

  const messages = [createUserMessage({
    content: [{ type: 'text', text: options.userText }],
    // 归属必须写当前实际装载的 bundle id（缺失会让用量与会话日志失去归属，
    // 与 prompt-optimize.ts 的注释同一条理由）。
    source: { kind: 'plugin:dsh-chat-plus', plugin: 'dsh-chat-plus' },
  })]

  const request = {
    provider: options.provider,
    model: options.model,
    messages,
    system: options.system,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    signal: options.signal,
    ...(options.reasoningEffort === undefined || options.reasoningEffort === ''
      ? {}
      : { reasoningEffort: options.reasoningEffort }),
  }

  try {
    const stream = llm.stream(request as never) as AsyncIterable<unknown>
    for await (const chunk of stream) {
      if (typeof chunk !== 'object' || chunk === null) continue
      const record = chunk as Record<string, unknown>
      const type = record['type']
      if (type === 'text-delta') {
        const delta = record['text']
        if (typeof delta === 'string') text += delta
        continue
      }
      if (type === 'usage') {
        const usage = record['usage']
        if (typeof usage === 'object' && usage !== null) {
          const u = usage as Record<string, unknown>
          if (typeof u['inputTokens'] === 'number') tokensIn = u['inputTokens']
          if (typeof u['outputTokens'] === 'number') tokensOut = u['outputTokens']
        }
        continue
      }
      if (type !== 'finish') continue
      const reason = record['reason']
      if (typeof reason !== 'object' || reason === null) continue
      const kind = (reason as Record<string, unknown>)['kind']
      if (kind === 'error' || kind === 'aborted') {
        const detail = (reason as Record<string, unknown>)['failure']
        const message = typeof detail === 'object' && detail !== null
          ? String((detail as Record<string, unknown>)['message'] ?? '')
          : ''
        failure = message !== '' ? message : (kind === 'aborted' ? '模型调用被中止' : '模型调用失败')
      } else if (kind === 'max-tokens') {
        truncated = true
      } else if (kind !== 'stop') {
        failure = '模型未正常结束：' + String(kind)
      }
    }
  } catch (error) {
    // llm.stream 一般会把 adapter 的异常归一成 finish(error)，但保险起见兜住。
    if (options.signal.aborted) return { text, failure: '模型调用超时或被中止', truncated, tokensIn, tokensOut }
    return {
      text,
      failure: error instanceof Error ? error.message : String(error),
      truncated,
      tokensIn,
      tokensOut,
    }
  }
  return { text, failure, truncated, tokensIn, tokensOut }
}

/* ───────────────────────── 报告（可验证性） ───────────────────────── */

/*
 * ⚠ FeedWriteReport 与 mergeReportIntoStats 的**唯一定义在 trigger.ts**。
 *
 * 这里曾经各自复制了一份（writer.ts 与 trigger.ts 各一份 interface + 各一份
 * 合并函数），结果是 2026-10-27 加「增量 + 去重」那几个计数时，只在 trigger.ts
 * 那份里加，writer.ts 写 report.droppedStale 直接类型报错 —— 而**运行时不报错**
 * （对象多一个键而已），所以这个分叉只有在跑 tsc 时才看得见。
 *
 * 现在这里只做转发：类型从 trigger.ts 取，合并函数也转调它。两处再也不会分叉。
 */
export type { FeedWriteReport }

/** 把报告并进 stats（转发到 trigger.ts 的唯一定义，见上方说明）。 */
export function mergeReportIntoStats(
  stats: FeedRunStats,
  report: FeedWriteReport,
): FeedRunStats {
  return mergeReportBase(stats, report)
}

/** 追加一条降级说明（多条用「；」连起来）。 */
export function appendNote(before: string | undefined, note: string): string {
  const text = note.trim()
  if (text === '') return before ?? ''
  return before === undefined || before === '' ? text : before + '；' + text
}

/* ───────────────────────── 服务读取 ───────────────────────── */

/** 读 web 服务（拿不到返回 null，调用方降级成「本轮无检索」）。 */
function readWeb(getService: ServiceGetter | undefined): WebLike | null {
  if (typeof getService !== 'function') return null
  try {
    const raw = getService('web')
    if (typeof raw !== 'object' || raw === null) return null
    return raw as WebLike
  } catch {
    return null
  }
}

function safeGet(getService: ServiceGetter, name: string): unknown {
  try {
    return getService(name)
  } catch {
    return undefined
  }
}

/** 取写作要用的 llm（注入优先；上面的 effectiveGet 已经处理了这条优先级）。 */
function readLlmForWrite(
  getService: ServiceGetter,
): { stream?: (options: unknown) => AsyncIterable<unknown> } | null {
  const candidate = safeGet(getService, 'llm')
  if (typeof candidate !== 'object' || candidate === null) return null
  return candidate as { stream?: (options: unknown) => AsyncIterable<unknown> }
}

/**
 * 读默认模型的 reasoningEffort 并原样透传。
 *
 * 用户配置里有 reasoningEffort: max：不传的话模型行为会和会话里不一致
 * （可能不推理了、质量下降）。拿不到就不传（适配器是「有则透传」）。
 */
function readReasoningEffort(getService: ServiceGetter | undefined, isDefault: boolean): string | undefined {
  if (!isDefault || typeof getService !== 'function') return undefined
  try {
    const service = getService('agentDefaultModel') as { currentSelection?: () => unknown } | undefined
    if (typeof service?.currentSelection !== 'function') return undefined
    const selection = service.currentSelection()
    if (typeof selection !== 'object' || selection === null) return undefined
    const effort = (selection as Record<string, unknown>)['reasoningEffort']
    return typeof effort === 'string' && effort !== '' ? effort : undefined
  } catch {
    return undefined
  }
}

/* ───────────────────────── 主流程 ───────────────────────── */

/** writer 内部用的一次解析结果（路由 + 透传参数）。 */
interface WriterRoute {
  route: WriteRoute
  reasoningEffort?: string
}

/** 解析写作路由（连同 reasoningEffort 一起取，供 stream 原样透传）。 */
async function resolveWriterRoute(
  getService: ServiceGetter | undefined,
  wanted: string,
  now: () => number,
): Promise<WriterRoute> {
  const result = await resolveWriteRoute(getService, wanted, now)
  if (!result.ok) throw new FeedWriteError(result.error)
  const effort = readReasoningEffort(getService, result.route.isDefault)
  return {
    route: result.route,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  }
}

/** 读最近发过的标题（老契约；读不到就当没有，不阻断写作）。 */
/**
 * 读「本轮关注的对象」（input.followedEntities 的容错版）。
 *
 * 容错点两条，都是脏数据的手改面：
 *  - name 不是非空字符串的项直接丢（空名字喂给模型只会得到一句「（无）」）；
 *  - aliases 不是数组时当空数组（模型看到的是 join 结果，undefined 会变成字面量）。
 *
 * 干净时**原样返回同一个数组**（不复制）：这个函数会被调用两次（一次判空、
 * 一次传参），复制两份对 24 个元素的数组来说只是无谓的分配。
 */
function readFollowedEntities(
  input: FeedWriteInput,
): readonly { name: string; kind: 'person' | 'company'; aliases?: readonly string[] }[] {
  const raw = input.followedEntities
  if (!Array.isArray(raw)) return []
  return raw.filter(entity => entity !== null && typeof entity === 'object'
    && typeof entity.name === 'string' && entity.name.trim() !== '')
}
function readKnownTitles(input: FeedWriteInput): string[] {
  const titles = input.knownTitles
  if (!Array.isArray(titles)) return []
  return titles
    .filter((title): title is string => typeof title === 'string' && title.trim() !== '')
    .slice(0, MAX_KNOWN_POSTS_FOR_PROMPT)
}

/**
 * 读最近发过的**完整信息**（标题 + 主题 + 来源域名），交给模型自己判断重复。
 *
 * 为什么不再只用标题：见 formatKnownPostsBlock 的说明 —— 光看标题串，模型判不出
 * 「同一批资料的另一个角度」，而那正是用户实测里 12/17 条的重复形态。
 *
 * 条数上限 {@link MAX_KNOWN_POSTS_FOR_PROMPT}（30 条）在 executeRun 侧已经截过，
 * 这里再兜一次：第三方注入实现可能不守约定。
 */
function readKnownPosts(input: FeedWriteInput): KnownPostBrief[] {
  const posts = input.knownPosts
  if (!Array.isArray(posts)) return []
  return posts
    .filter((post): post is KnownPostBrief =>
      typeof post === 'object' && post !== null && typeof post.title === 'string' && post.title.trim() !== '')
    .slice(0, MAX_KNOWN_POSTS_FOR_PROMPT)
}

/**
 * 造一个**真实**的 writer（默认实现）。
 *
 * 一次调用 = 方案 §4 的阶段 2-6：
 *   规划检索 → web.search → 验活 + 判定 → 组装清单 → llm.stream → 解析 → 校验
 *
 * 失败语义（与 executeRun 的契约）：**抛 FeedWriteError**。
 * executeRun 会把它转成 run.status = failed + run.error + 0 条帖子，
 * 绝不产出占位内容。成功时返回的草稿已经过闸 2 校验，落地即上架。
 *
 * @param deps - 注入面（测试可换掉 web / llm / 时钟）。
 */
export function createRealWriter(deps: RealWriterDeps = {}): FeedWriter {
  const now = deps.now ?? Date.now
  const log = deps.logger

  /*
   * 生效的服务读取面：注入的 llm 覆盖真实 ctx.get('llm')。
   *
   * 为什么需要这一层：models.ts 的目录加载与路由解析都要读 llm 服务
   * （listProviders / listModels / resolveModelInfo），而冒烟会注入一个
   * 纯对象的假 llm（不碰真模型）。如果只覆写"调 stream 的那一处"，
   * 路由解析仍然会去问真 ctx → 冒烟就必须真的起一个 DSH 才能测到流程。
   * 所以把注入的 llm 也接进 getService，全链路走同一份假实现。
   */
  const injectedLlm = deps.llm
  const effectiveGet: ServiceGetter = (name) => {
    if (name === 'llm' && injectedLlm !== undefined) return injectedLlm
    if (typeof deps.getService !== 'function') return undefined
    try {
      return deps.getService(name)
    } catch {
      return undefined
    }
  }

  return async (input: FeedWriteInput): Promise<FeedDraft[]> => {
    const startedAt = now()
    const budgetMs = deps.runBudgetMs ?? FEED_RUN_BUDGET_MS
    const report: FeedWriteReport = {}
    const publish = (): void => {
      if (input.report !== undefined) Object.assign(input.report, report)
    }

    const controller = new AbortController()
    const budgetTimer = setTimeout(() => { controller.abort() }, Math.max(1000, budgetMs))
    const checkAborted = (): void => {
      if (controller.signal.aborted) {
        throw new FeedWriteError('本轮超过 ' + Math.round(budgetMs / 1000) + ' 秒上限，已中止')
      }
    }

    try {
      /* ── 1. 解析模型路由 ─────────────────────────────────────── */
      const getService = effectiveGet
      const resolved = await resolveWriterRoute(getService, input.config.model, now)
      /*
       * modelUsed 必须是**真实路由**，不能是配置值。
       *
       * 配置里存的是 'default'，直接记下来的话用户在界面上看到的是
       * 「上轮模型：default」——一句没有信息量的鬼话。这里记
       * provider/model（机器可读、可对拍），人类可读的名字另放 modelLabel。
       */
      report.modelUsed = resolved.route.provider + '/' + resolved.route.model
      report.modelLabel = resolved.route.label
      report.modelResolution = resolved.route.resolution
      if (resolved.route.note !== undefined) {
        report.degraded = appendNote(report.degraded, resolved.route.note)
      }
      publish()
      checkAborted()

      /* ── 2. 检索（带时间限定）──────────────────────────────────── */
      const web = deps.web !== undefined ? deps.web : readWeb(getService)
      /*
       * 时间窗起点：由 executeRun 定好后传进来（详见 incremental.ts 的
       * resolveSinceWindow）。读不到就不启用窗口 —— 宁可多写，也不能因为
       * 水位线缺失把整轮检索废掉。
       */
      const sinceAt = typeof input.sinceAt === 'number' && input.sinceAt > 0 ? input.sinceAt : 0
      const queries = planQueries(input.config.prompt, now(), sinceAt)
      report.queries = queries.length

      const batches: Array<{ queryIndex: number; sources: readonly WebSourceLike[] }> = []
      let webFailure: string | null = null
      if (web === null || typeof web.search !== 'function') {
        webFailure = 'web 检索不可用（ctx.get("web") 拿不到或没有 search provider）'
      } else {
        for (let index = 0; index < queries.length; index += 1) {
          checkAborted()
          const guard = withTimeout(controller.signal, deps.searchTimeoutMs ?? WEB_SEARCH_TIMEOUT_MS)
          try {
            const result = await web.search({ query: queries[index]!, maxResults: SEARCH_MAX_RESULTS }, guard.signal)
            const sources = Array.isArray(result?.sources) ? result.sources : []
            batches.push({ queryIndex: index, sources })
          } catch (error) {
            // 单条 query 失败只跳过它 —— 其余 query 仍可能拿到结果。
            log?.warn?.('[dsh-feed] search failed for query #' + index + ': '
              + (error instanceof Error ? error.message : String(error)))
          } finally {
            guard.dispose()
          }
        }
        if (batches.length === 0) {
          webFailure = '所有检索请求都失败了（网络或检索 provider 出错）'
        }
      }

      const merged = mergeSearchResults(batches)
      if (webFailure !== null) report.degraded = appendNote(report.degraded, webFailure)

      /*
       * ── 2b. 时间窗过滤（只留 sinceAt 之后的候选）────────────────────
       *
       * 三态处置（见 incremental.ts 的 applySinceWindow）：明确早于水位线的丢、
       * 明确在窗口内的留、**缺时间的留但标注**。缺时间不能一刀切丢掉 ——
       * provider 不给 publishedAt 是常态，一刀切会把「有内容的轮次」变成
       * 「一条来源都没有的轮次」，而现象上看不出根因是字段缺失。
       */
      const windowed = applySinceWindow(merged, sinceAt)
      const candidates = windowed.kept
      report.droppedStale = windowed.droppedStale
      report.sourcesTimeUnknown = windowed.unknown
      if (windowed.droppedStale > 0) {
        log?.info?.('[dsh-feed] since window dropped ' + windowed.droppedStale
          + ' stale candidate(s) older than ' + new Date(sinceAt).toISOString())
      }
      publish()

      /* ── 3. 验活 + 可用性判定 ────────────────────────────────── */
      const verified = await verifyCandidates(web, candidates, {
        ...(deps.fetchTimeoutMs === undefined ? {} : { timeoutMs: deps.fetchTimeoutMs }),
        ...(deps.concurrency === undefined ? {} : { concurrency: deps.concurrency }),
        signal: controller.signal,
        now,
      })
      /*
       * X 线索：fresh **和 stale 都要**（2026-10-27 实测修正）。
       *
       * 原来只传 input.freshTweets，而 fresh 的定义是「72 小时内」。实测抓到的
       * 21 条关注账号推文**全部落在 72 小时窗口外**（最晚的一条也是 10-26），
       * 于是 fresh 为空 → X 一条都没进清单 → 模型只能看到网页检索那些泛化
       * 的「值得关注的 AI 账号」清单页，最后判定「没有可写内容」交了 0 条。
       *
       * 用户要的是「这几个账号的动态」，不是「72 小时内的新闻」。X 内容本来就
       * 按 limited 处理（只给话题线索 + 原文入口），不存在「把旧内容当新闻」
       * 的风险 —— 它只是「这个人最近说过什么」的素材。所以合并后再按时间倒序，
       * 让模型看到最新的几条。
       */
      const xTweets = [...input.freshTweets, ...input.staleTweets]
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
      const withTweets = appendTweetsAsSources(verified.sources, xTweets)
      report.sourcesOpen = verified.open
      report.sourcesLimited = verified.limited + (withTweets.length - verified.sources.length)
      report.sourcesBlocked = verified.blocked
      publish()
      checkAborted()

      // 一条来源都没有时，明确降级并在提示词里说明 —— 但仍让模型写
      // （用户要的是「有内容」而不是「没内容且不解释」）。
      if (withTweets.length === 0) {
        report.degraded = appendNote(report.degraded,
          '本轮没有任何可用来源，内容仅基于你的关注点撰写（无出处）')
        publish()
      }

      /* ── 4. 写作 ─────────────────────────────────────────────── */
      const llm = readLlmForWrite(getService)
      if (llm === null) throw new FeedWriteError('llm 服务不可用，无法生成内容')

      const knownTitles = readKnownTitles(input)
      const knownPosts = readKnownPosts(input)
      const maxTokens = outputBudget(await safeMaxTokens(getService, resolved.route))
      const ask = (route: WriterRoute, temperature: number, extra: string): Promise<StreamOutcome> => streamOnce(llm, {
        provider: route.route.provider,
        model: route.route.model,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        // 时间范围进 system（长期约束），历史内容进 user（数据）。见 writerSystemPrompt 的说明。
        system: writerSystemPrompt(sinceAt, now()),
        userText: buildWriterUserText({
          prompt: input.config.prompt,
          now: now(),
          sources: withTweets,
          knownTitles,
          knownPosts,
          ...(sinceAt > 0 ? { sinceAt } : {}),
          ...(report.degraded === undefined ? {} : { degradeNote: report.degraded }),
          // 本轮关注的人物/公司（没有就不出现这一段）。
          ...(readFollowedEntities(input).length > 0 ? { followedEntities: readFollowedEntities(input) } : {}),
        }) + extra,
        maxTokens,
        temperature,
        signal: controller.signal,
      })

      let first = await ask(resolved, 0.6, '')
      report.rawChars = first.text.length
      publish()

      // 模型调用本身失败 → 非默认模型时先回退默认模型（§5.4 第 3 条）。
      let used = resolved
      if (first.failure !== null && first.text.trim() === '' && !resolved.route.isDefault) {
        const fallback = await resolveWriterRoute(getService, 'default', now)
        log?.warn?.('[dsh-feed] model ' + resolved.route.label + ' failed (' + first.failure
          + '), falling back to ' + fallback.route.label)
        report.degraded = appendNote(report.degraded,
          '模型「' + resolved.route.label + '」调用失败（' + first.failure
          + '），已回退到默认模型「' + fallback.route.label + '」')
        used = fallback
        report.modelUsed = fallback.route.provider + '/' + fallback.route.model
        report.modelLabel = fallback.route.label
        report.modelResolution = 'fallback-default'
        first = await ask(fallback, 0.6, '')
        report.rawChars = first.text.length
        publish()
      }

      if (first.failure !== null && first.text.trim() === '') {
        throw new FeedWriteError('模型没有返回内容：' + first.failure)
      }
      if (first.text.trim() === '') {
        throw new FeedWriteError('模型没有返回内容（0 字符）')
      }

      /* ── 5. 解析 ─────────────────────────────────────────────── */
      let parsed = parseWriterOutput(first.text)
      if (parsed === null && !controller.signal.aborted) {
        /*
         * JSON 解析失败 → 用同一路由**重试一次**（方案 §4 阶段 5）。
         * 重试不是原样再要一遍：把 temperature 降到 0.2 并再压一次
         * 「只要 JSON」，因为失败的主因通常是模型在 JSON 前后絮叨。
         */
        log?.warn?.('[dsh-feed] writer output is not JSON, retrying once (chars=' + first.text.length + ')')
        const retry = await ask(used, 0.2,
          '\n\n只输出 JSON 对象本身，第一个字符必须是 {，最后一个字符必须是 }。不要任何解释。')
        report.rawChars = (report.rawChars ?? 0) + retry.text.length
        publish()
        if (retry.failure !== null && retry.text.trim() === '') {
          throw new FeedWriteError('模型没有返回内容：' + retry.failure)
        }
        parsed = parseWriterOutput(retry.text)
      }
      if (parsed === null) {
        throw new FeedWriteError('模型返回的不是可解析的 JSON（'
          + (report.rawChars ?? 0) + ' 字符）'
          + (first.truncated ? '，且输出被 max-tokens 截断' : ''))
      }
      /*
       * 模型自己判断的「跳过」先记进 report —— 即使它一条都没写，我们也能
       * 说清「为什么 0 条」是模型主动判重，而不是链路坏了。
       */
      const modelSkipped = parsed.skipped ?? []
      report.modelSkipped = modelSkipped.length
      if (modelSkipped.length > 0) {
        report.modelSkipNotes = modelSkipped.slice(0, 10).map(item =>
          item.ofTitle === '' ? item.why : ('与《' + item.ofTitle + '》重复：' + (item.why || '模型判断为同一件事')))
        publish()
      }

      if (parsed.posts.length === 0) {
        /*
         * 0 条产出有两种性质，**绝不能混成一件事**（2026-10-27 真实服务实测）：
         *
         *  ① 模型一条都没写、但**明确报了 skipped[]**：这不是链路故障，而是它
         *     按「宁可少写不要重复」做出的判断。实测那次它逐条比对了 30 条已发
         *     内容后报「11 条候选全是同一件事」—— 那正是用户要的「让模型自己
         *     判断去重」完美工作的证据。
         *
         *     这里**不抛异常**：抛出会经 trigger.ts 的 catch 变成 status='failed'，
         *     界面显示红色「更新失败」，用户以为坏了，实际是「确实没有新内容」。
         *     改成正常返回空数组 + noNewContent 标记，由 executeRun 记成
         *     status='skipped'（中性、非错误）。
         *
         *  ② JSON 里压根没有条目（posts:[] 且 skipped:[]）：那是真异常，
         *     模型跑了却没给任何判断依据，必须抛错让用户看见。
         *
         * ⚠ 不要为了让状态变绿把 ② 也吞掉 —— 那会把「模型什么都没给」伪装成
         *   「模型判断没有新内容」，从此再也没人能从界面上发现真实故障。
         */
        if (modelSkipped.length > 0) {
          const reason = '模型判断 ' + String(modelSkipped.length)
            + ' 条候选都与已发内容重复，本轮没有新内容'
          report.noNewContent = true
          report.noNewContentReason = reason
          publish()
          log?.info?.('[dsh-feed] writer no-new-content: model skipped '
            + String(modelSkipped.length) + ' candidates, 0 drafted')
          void input.sync
          return []
        }
        throw new FeedWriteError('模型返回了 JSON，但里面没有任何动态条目')
      }

      /* ── 6. 校验 ─────────────────────────────────────────────── */
      const validated = validateModelPosts(parsed.posts, withTweets, now())
      report.dropped = (report.dropped ?? 0) + validated.dropped + parsed.malformed
      publish()
      if (validated.accepted.length === 0) {
        const why = validated.reasons.slice(0, 3).join('；')
        throw new FeedWriteError('模型产出 ' + parsed.posts.length + ' 条，全部未通过校验'
          + (why === '' ? '' : '：' + why))
      }

      /* ── 7. 转成草稿 ─────────────────────────────────────────── */
      /*
       * 落盘前再按「账号数」截一次（与提示词里那个数字同源）。
       *
       * 为什么两处都要：提示词只是**告诉**模型写多少，模型完全可能多写
       * （实测它会写 5 条而清单里只有 3 个账号）。落盘这道是硬闸，
       * 用同一个 postsAskedFor 保证「提示词说的」与「真正收下的」一致。
       */
      const acceptedLimit = postsAskedFor(countDistinctXAccounts(withTweets))
      const drafts: FeedDraft[] = validated.accepted.slice(0, acceptedLimit).map(post => ({
        title: post.title,
        body: post.body,
        topics: post.topics,
        dueAt: post.dueAt,
        dueLabel: post.dueLabel,
        sourceRefs: post.sources.map(toFeedSources),
        /*
         * 媒体：从这条帖子**引用的 X 来源**里搬过来（用户要求「有图片或
         * 视频就把链接放上来」）。最多 MAX_FEED_MEDIA 条，没有就不写这一格
         * —— 空数组不落盘，见 trigger.ts 的落盘处说明。
         */
        ...((): { media?: FeedMedia[] } => {
          const media = collectDraftMedia(post.sources, xTweets)
          return media.length > 0 ? { media } : {}
        })(),
        /*
         * 原文：与 media 同一条链路（用户 2026-10-28：「不要压缩原文内容，
         * 如果原文是英文翻译中文原文放里面」）。正文是中文翻译/转述，
         * 原文另存一格给界面展示 —— 用户能对照，也能核对翻译有没有丢信息。
         */
        ...((): { originalText?: string; originalLang?: string } => {
          const origin = collectDraftOriginal(post.sources, xTweets)
          return origin === null ? {} : origin
        })(),
        // 模型标的「关于谁」→ 落盘时换 id（见 trigger.ts 的 resolveEntityIds）。
        ...(post.entities.length > 0 ? { entityNames: post.entities } : {}),
      }))
      publish()
      log?.info?.('[dsh-feed] writer ok: model=' + (report.modelUsed ?? '?')
        + ' (' + (report.modelLabel ?? '?') + ')'
        + ' queries=' + (report.queries ?? 0)
        + ' sources=' + withTweets.length
        + ' rawChars=' + (report.rawChars ?? 0)
        + ' accepted=' + drafts.length
        + ' elapsed=' + (now() - startedAt) + 'ms')
      void input.sync
      return drafts
    } finally {
      clearTimeout(budgetTimer)
    }
  }
}

/** 读模型声明的输出上限（失败不致命）。 */
async function safeMaxTokens(getService: ServiceGetter | undefined, route: WriteRoute): Promise<number | undefined> {
  if (route.defaultMaxTokens !== undefined) return route.defaultMaxTokens
  return await readModelMaxTokens(getService, route.provider, route.model)
}

/** 导出给冒烟对拍（纯逻辑，全部不碰网络也不碰模型）。 */
export const __test = {
  extractKeywords,
  planQueries,
  timeHintOf,
  mergeSearchResults,
  formatSourceListForPrompt,
  formatKnownPostsBlock,
  writerSystemPrompt,
  readModelSkipped,
  readKnownPosts,
  stripCodeFence,
  parseWriterOutput,
  validateModelPosts,
  stripUrls,
  dueLabelOf,
  outputBudget,
  probeTextOf,
  urlKeyOf,
  withTimeout,
  appendNote,
  collectDraftMedia,
}
