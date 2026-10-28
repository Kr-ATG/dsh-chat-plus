/**
 * dsh-chat-plus — 个人动态（Feed）· 来源与 X 抓取（host 半身）。
 *
 * 两块内容：
 *   1. **来源可用性判定**（方案 §7）：open / limited / blocked 三态；
 *   2. **X syndication 抓取**（实测报告 `docs/2026-10-27-x-feed-availability.md`）。
 *
 * ── X 抓取的硬约束全部来自实测，不是推测 ────────────────────────────
 *
 *  | 约束 | 值 | 依据 |
 *  |---|---|---|
 *  | 单次最多 | ~100 条 | 通道上限 |
 *  | 串行 + 账号间隔 | ≥1500ms | 实测：连续 10 个账号 → 前 5 成功、后 5 全 429 |
 *  | 单轮账号数 | ≤5 | 同上，5 是实测出来的安全上限 |
 *  | 429 冷却 | now + 10 分钟 | 实测等 60 秒仍全部 429（冷却期更长） |
 *  | 单账号尝试 | ≤2 次，第 2 次前 sleep 3000ms | 「绝不重试到底」 |
 *  | 超时 | 8~10s | 本插件会包装 globalThis.fetch（src/provider/proxy-host.js），
 *                             代理卡住时必须靠 AbortController 兜住 |
 *
 * ── 两条实测出来的「反直觉」细节 ────────────────────────────────────
 *
 * 1. **entries 不是时间顺序**：实测 elonmusk 返回 100 条，前五条的 id 分别是
 *    2026-10-21 / 2022-04-28 / 2024-07-13……也就是说最新推文与若干年前的
 *    高互动推文混排。所以解析后**必须按 created_at 自己重排**，绝不能假设
 *    `entries[0]` 是最新的。
 * 2. **不能拿「id 最大」当去重水位线**：既然顺序是混合的，「id 大于水位线
 *    才算新」会同时漏掉新抓到的历史条目、也可能把水位线存错。去重靠
 *    **已见 id 集合**（见 `selectNewTweets`），`lastTweetId` 只用于展示。
 *
 * 这三条任何一条判错都不会抛错 —— 只会表现为「少几条」「重复几条」或
 * 「几天后突然被限流封住」，所以全部由 `scripts/smoke-feed.mjs` 断言钉死。
 *
 * ── 失败一律不抛 ────────────────────────────────────────────────────
 *
 * 本模块所有对外函数都不抛异常：X 抓不到只是「本轮没有 X 线索」，绝不能
 * 影响其它来源与整轮生成。失败原因分成 8 种机器可读值（XFetchOutcome），
 * 因为「限流」和「超时」的处置方式完全不同 —— 前者要冷却 10 分钟，后者
 * 多半是代理卡住、下次可能就好。笼统的 failed 只会导出「一律稍后重试」，
 * 而限流重试只会把封禁拖更长。
 *
 * @module
 */

import {
  FEED_FRESH_WINDOW_MS,
  MAX_SEEN_TWEET_IDS,
  type FeedSource,
  type XFetchOutcome,
  type XMedia,
  type XSyncState,
  type XTweet,
} from './types.ts'

/* ───────────────────────── 常量（全部来自实测） ───────────────────────── */

/** syndication 时间线通道（实测 200 + 完整 JSON，无需登录态、无需 API Key）。 */
export const X_TIMELINE_URL = 'https://syndication.twitter.com/srv/timeline-profile/screen-name/'

/**
 * 原文/线索摘要的字符上限（2026-10-28 用户要求「不要压缩原文内容」）。
 *
 * X 单条推文上限 25000 字符，但个人动态不需要把长文全搬进 posts.json：
 * 4000 字符足够容纳绝大多数推文（含长文推文的前几段），同时防止
 * 一条超长推文把整份落盘文件撑大。
 */
export const MAX_EXCERPT_CHARS = 4000

/** 从 X 主页解析出来的资料（用户 2026-10-28：「设置里的账号我以后直接给你主页链接」）。 */
export interface XProfile {
  /** 显示名（og:title 里 @ 之前那段）。 */
  name: string
  /** 头像 URL（og:image，已是 400x400 大图）。 */
  avatarUrl: string
  /** 简介（og:description），只用于将来展示，不参与生成。 */
  bio: string
}

/**
 * 抓 X 主页、解析出显示名与头像（**只发一次请求**）。
 *
 * 用户原话：「要不设置里的账号我以后直接给你他的主页 https://x.com/lilililiMozi，
 * 这样省 token 生成又不容易错字」。
 *
 * 为什么这条路可行（2026-10-28 实测）：x.com/<handle> 的 HTML 里带三条 og 标签，
 * 信息足够建一个关注对象，不需要调模型、也不需要推文接口：
 *   og:title       = "liliMozi (@lilililiMozi) on X"  → 名字取 @ 之前那段
 *   og:image       = ".../profile_images/.../xxx_400x400.jpg" → 头像（已是 400x400）
 *   og:description = 简介
 * 三个账号实测都拿到了，含中文名（Tianyi Cui）。
 *
 * @returns 解析成功返回资料；任何一步失败返回 null（**永不抛** —— 加个账号失败
 *   不该让设置页报错，调用方会退回「只用 handle、名字留空」）。
 */
export async function fetchXProfile(
  handle: string,
  deps: XFetchDeps = {},
): Promise<XProfile | null> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch
  const clean = handle.trim().replace(/^@/, '').toLowerCase()
  if (clean === '' || typeof doFetch !== 'function') return null
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, X_FETCH_TIMEOUT_MS)
  try {
    const res = await doFetch('https://x.com/' + encodeURIComponent(clean), {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept: 'text/html',
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    const meta = (name: string): string => {
      const a = new RegExp('<meta\\s+(?:property|name)="' + name + '"\\s+content="([^"]*)"', 'i').exec(html)
      if (a !== null && a[1] !== undefined) return a[1]
      const b = new RegExp('content="([^"]*)"[^>]*\\b(?:property|name)="' + name + '"', 'i').exec(html)
      return b !== null && b[1] !== undefined ? b[1] : ''
    }
    const title = meta('og:title')
    // "liliMozi (@lilililiMozi) on X" → 取 @ 之前那段作为显示名。
    const name = title.replace(/\s*\(@[^)]*\)\s*on\s+X\s*$/i, '').trim()
    const avatarUrl = meta('og:image')
    const bio = meta('og:description')
    if (name === '' && avatarUrl === '') return null
    return {
      name: name === '' ? clean : name,
      avatarUrl,
      bio,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 账号之间的最小间隔（实测建议 1.5–3 秒；取 1500ms 是下限）。 */
export const X_HANDLE_GAP_MS = 1500

/** 同一账号单轮最多尝试次数（实测报告 §3.1 第 3 条）。 */
export const X_MAX_ATTEMPTS = 2

/** 第 2 次尝试前的等待（实测报告 §3.1 第 3 条点名 3000ms）。 */
export const X_RETRY_DELAY_MS = 3000

/**
 * 单轮最多抓几个账号。
 *
 * ⚠ 2026-10-28 从 5 提到 16（用户：「所有账号而不是有上限」）。
 *
 * 原来那个 5 是**主通道**实测出来的安全上限（连续抓 10 个账号 → 后 5 个全 429）。
 * 但主通道现在长期 429，实际走的是备用通道（主页 HTML + 单条详情），
 * 那条路没有「一次抓几个」的硬限制，只有单账号的请求间隔要求。
 *
 * 不改的后果是实测过的：用户关注 6 个账号，第 6 个**每轮都被直接跳过**，
 * 于是「Tianyi Cui」名下永远是 0 条动态 —— 而他的主页上明明有 3 条原创推文。
 *
 * 16 这个数字只防「关注了几百个」的极端情况；正常 6-10 个账号一轮抓完。
 */
export const X_MAX_HANDLES_PER_ROUND = 16

/** 429 后的冷却时长（实测：等 60 秒仍全部 429，所以取 10 分钟）。 */
export const X_COOLDOWN_MS = 10 * 60 * 1000

/** 单次请求超时（代理卡住时靠它兜住整轮）。 */
export const X_FETCH_TIMEOUT_MS = 9000

/** 解析后最多保留多少条推文（通道上限约 100，留余量防异常大的返回体）。 */
export const X_MAX_TWEETS = 120

/**
 * 已知不开放抓取的平台（方案 §7.2 原表）。
 *
 * 命中就**直接判 limited、不发请求**：既省时间，也避免被判爬。
 */
export const LIMITED_DOMAINS = new Set([
  'x.com', 'twitter.com', 'weibo.com', 'mp.weixin.qq.com',
  'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com',
])

/* ───────────────────────── 工具函数 ───────────────────────── */

/** 睡眠（可在测试里注入 0 延迟）。 */
export type SleepFn = (ms: number) => Promise<void>

/** 默认为真等待。 */
export const realSleep: SleepFn = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))

/** 注入面：抓取实现与时钟都可替换（冒烟里用假 fetch，不打真实网络）。 */
export interface XFetchDeps {
  /** fetch 实现（默认 globalThis.fetch；冒烟注入假实现）。 */
  fetchImpl?: typeof fetch
  /** 睡眠实现（默认真等待；冒烟注入 0 延迟）。 */
  sleep?: SleepFn
  /** 现在（毫秒）。 */
  now?: () => number
}

/** 从 URL 里取规范化主机名（小写、去 www.）。解析失败返回空串。 */
export function normalizeHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

/** 从 URL 取展示用域名（归一化后的 host）。 */
export function domainOf(url: string): string {
  return normalizeHost(url)
}

/* ───────────────────────── 来源可用性判定（§7） ───────────────────────── */

/** 判定结果。blocked 的条目不会被存进 posts（§7.1 第三态整条丢弃）。 */
export type AccessVerdict = 'open' | 'limited' | 'blocked'

/** 判定所需的抓取结果（把网络层挡在外面，便于纯函数测试）。 */
export interface FetchProbe {
  statusCode: number
  /** 已转成纯文本的正文（判定只看文本特征，不看标签）。 */
  text: string
}

/** 付费墙 / 登录墙的文本特征（§7.2 原表，逐条保留）。 */
const LOGIN_WALL_RE = /登录后(查看|阅读)|sign in to (continue|read)|log in to continue/i
const PAYWALL_RE = /订阅后(阅读|查看)|subscribers? only|subscribe to read/i

/**
 * 判定一个来源的可用性（纯函数，§7.2 的实现）。
 *
 * @param url - 来源 URL。
 * @param probe - 若已经抓过就把结果传进来；`null` 表示「只按域名预判、
 *                还没有抓取结果」（此时非 limited 域名返回 open 的乐观判定，
 *                由调用方决定是否真的去抓）。
 * @returns 三态判定。
 */
export function classifySource(url: string, probe: FetchProbe | null): AccessVerdict {
  const host = normalizeHost(url)
  // ① 已知不开放抓取的平台：直接 limited，不发请求。
  if (host !== '' && LIMITED_DOMAINS.has(host)) return 'limited'
  if (probe === null) return 'open'

  // ② 状态码判定。
  const status = probe.statusCode
  if (status === 401 || status === 403) return 'limited'
  if (status === 402 || status === 451) return 'blocked' // 付费墙 / 法律限制
  if (status < 200 || status >= 300) return 'blocked'

  // ③ 内容特征判定（顺序要紧：先登录墙，再付费墙）。
  if (LOGIN_WALL_RE.test(probe.text)) return 'limited'
  if (PAYWALL_RE.test(probe.text)) return 'blocked'
  // ④ 空壳页：抓到了但没正文，等于没有来源可用。
  if (probe.text.trim().length < 200) return 'blocked'
  return 'open'
}

/**
 * 按 §7.1 收紧一条来源：`limited` 的 snippet **必须**清空。
 *
 * 这是法律边界（§7.3 第 2 条），所以做成一个必经的纯函数而不是「记得别填」。
 */
export function tightenSource(source: FeedSource): FeedSource {
  if (source.access === 'limited') {
    /*
     * limited：snippet 一律清空（不复制网页正文）。
     *
     * excerpt 是「话题线索」，2026-10-28 起**不再截到 200 字符** —— 用户明确要求
     * 「X账号相关的动态不要压缩原文内容」。X 推文的 excerpt 就是推文原文本身，
     * 截断会让界面上的「原文」块变成半句话。
     *
     * 仍保留一个防爆上限（{@link MAX_EXCERPT_CHARS}）：单条推文最长 4000 字符
     * （X 自己的上限是 25000，但个人动态不需要把长文全搬进来），
     * 而网页来源的 snippet 本来就清空了，不存在「借 excerpt 绕过边界」的路径。
     */
    const { snippet: _drop, ...rest } = source
    return {
      ...rest,
      access: 'limited',
      ...(source.excerpt === undefined ? {} : { excerpt: source.excerpt.slice(0, MAX_EXCERPT_CHARS) }),
    }
  }
  // open：不保留 X 那种线索摘要（那是 limited 专用），避免两个字段语义混淆。
  const { excerpt: _unused, ...rest } = source
  return { ...rest, access: 'open' }
}

/* ───────────────────────── HTML → 文本（判定用） ───────────────────────── */

/** 去标签取纯文本（判定只需文本特征，不需要完整解析）。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ───────────────────────── X syndication 解析 ───────────────────────── */

/* ───────────────────────── 媒体解析（图片 / 视频） ─────────────────────────
 *
 * 2026-10-28 用户要求：「他们的动态有图片或视频就把链接放上来，渲染出来，
 * 可播放可查看」。媒体 URL 只在这两处出现，且**两处形状不同**：
 *
 *  | 通道 | 字段 | 视频直链在哪 |
 *  |---|---|---|
 *  | 主通道 `__NEXT_DATA__` | `entities.media[]` | `video_info.variants[]` |
 *  | 备用通道 `tweet-result` | `mediaDetails[]` | `video_info.variants[]` |
 *
 * 所以两个入口各自取字段、但都交给下面这一组函数归一化 —— 归一化的好处是
 * 下游（writer.ts）不需要知道这条推文是从哪条路来的，也就不会出现「主通道
 * 有视频、备用通道只有封面」这种漂移。
 */

/** X 的类型串 → 我们的三态（脏数据一律降级成 photo，绝不丢媒体）。 */
export function mediaTypeOf(raw: unknown): XMedia['type'] {
  if (raw === 'video') return 'video'
  if (raw === 'animated_gif') return 'animated_gif'
  return 'photo'
}

/**
 * 从 `video_info.variants` 里挑出**最高码率的 mp4**。
 *
 * 两条硬规则（都是实测踩出来的）：
 *  1. 只认 `content_type === 'video/mp4'` —— HLS（`application/x-mpegURL`）
 *     的 .m3u8 是播放列表不是媒体文件，浏览器 <video> 直接给它 src 是放不了的
 *     （需要 hls.js）；而 mp4 直链可以直接播。
 *  2. 按 bitrate **取最大**：variants 里同时有 320x180 / 640x360 / 1280x720，
 *     取第一个会拿到最低清那档。
 *
 * @returns mp4 直链；一个都没有（纯 HLS 或结构变了）时返回空串。
 */
export function bestMp4Of(videoInfo: unknown): string {
  if (typeof videoInfo !== 'object' || videoInfo === null) return ''
  const variants = (videoInfo as Record<string, unknown>)['variants']
  if (!Array.isArray(variants)) return ''
  let best = ''
  let bestBitrate = -1
  for (const item of variants) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (v['content_type'] !== 'video/mp4') continue
    const url = typeof v['url'] === 'string' ? v['url'].trim() : ''
    if (url === '') continue
    // bitrate 缺失时按 0 算：它仍比「没有任何 mp4」强，但不该压过有码率的那档。
    const bitrate = typeof v['bitrate'] === 'number' && Number.isFinite(v['bitrate']) ? v['bitrate'] : 0
    if (bitrate > bestBitrate) { bestBitrate = bitrate; best = url }
  }
  return best
}

/**
 * 把一个原始媒体对象归一化成 {@link XMedia}（两条通道共用）。
 *
 * @param raw - `entities.media[i]` 或 `mediaDetails[i]`。
 * @returns 归一化后的媒体；**没有可用 URL 时返回 null**（宁可不显示，
 *          也不落一个空 src —— 那在界面上就是一张破图）。
 */
export function parseMediaItem(raw: unknown): XMedia | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  const url = typeof m['media_url_https'] === 'string' ? m['media_url_https'].trim() : ''
  if (url === '') return null
  const type = mediaTypeOf(m['type'])
  const media: XMedia = { url, type }

  // ── 尺寸：photo 在 original_info，video 在 video_info 的 aspect_ratio 旁 ──
  const info = (typeof m['original_info'] === 'object' && m['original_info'] !== null
    ? m['original_info'] : {}) as Record<string, unknown>
  const width = typeof info['width'] === 'number' ? info['width'] : undefined
  const height = typeof info['height'] === 'number' ? info['height'] : undefined
  if (width !== undefined && width > 0) media.width = width
  if (height !== undefined && height > 0) media.height = height

  if (type !== 'photo') {
    const videoInfo = m['video_info']
    const mp4 = bestMp4Of(videoInfo)
    if (mp4 !== '') media.videoUrl = mp4
    const duration = typeof videoInfo === 'object' && videoInfo !== null
      ? (videoInfo as Record<string, unknown>)['duration_millis']
      : undefined
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      // 毫秒 → 秒，保留一位小数（界面上「45.0 秒」读起来比 45000 好）。
      media.durationSec = Math.round(duration / 100) / 10
    }
  }
  return media
}

/**
 * 解析一组媒体（`entities.media` / `mediaDetails` 都适用）。
 *
 * 单个脏条目跳过、不抛：媒体的缺失只影响「能不能看图」，绝不该让整条
 * 推文解析失败（那会让「同步成功但一条都没有」再次出现）。
 */
export function parseMediaList(raw: unknown): XMedia[] {
  if (!Array.isArray(raw)) return []
  const out: XMedia[] = []
  for (const item of raw) {
    const media = parseMediaItem(item)
    if (media !== null) out.push(media)
  }
  return out
}

/** 从 HTML 里抠 `__NEXT_DATA__` 的 JSON 文本。失败返回 null。 */
export function extractNextData(html: string): string | null {
  const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (match === null) return null
  const text = match[1]?.trim() ?? ''
  return text === '' ? null : text
}

/** 解析 created_at（`Wed Oct 21 15:38:10 +0000 2026`）成毫秒；失败返回 0。 */
export function parseTweetTime(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return 0
  const at = Date.parse(raw)
  return Number.isFinite(at) ? at : 0
}

/** 从 permalink 拼出真实可跳转的 URL；缺失时用 /i/status/<id> 兜底。 */
export function tweetUrlOf(permalink: unknown, handle: string, id: string): string {
  if (typeof permalink === 'string' && permalink.trim() !== '') {
    const link = permalink.trim()
    if (/^https?:\/\//i.test(link)) return link
    return `https://x.com${link.startsWith('/') ? '' : '/'}${link}`
  }
  return `https://x.com/i/status/${id}`
}

/**
 * 从 `__NEXT_DATA__` 的 JSON 文本解析出推文列表。
 *
 * 三件事必须做对（每件都有实测依据）：
 *  1. **只取 type === 'tweet'** —— 时间线里还混着 `profile-conversation` 等条目；
 *  2. **按 created_at 重排（倒序）** —— 实测返回顺序是混合的，`entries[0]`
 *     可能是一条 2022 年的老推文；
 *  3. **单条脏数据不能毁整批** —— 缺 id / 时间解析失败的条目跳过，不抛。
 *
 * @returns 推文数组（已倒序）；JSON 解析失败返回 null（调用方据此判 parse-fail）。
 */
export function parseTweetsFromNextData(jsonText: string): XTweet[] | null {
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    return null
  }
  const entries = (data as { props?: { pageProps?: { timeline?: { entries?: unknown } } } })
    ?.props?.pageProps?.timeline?.entries
  if (!Array.isArray(entries)) return null

  const tweets: XTweet[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (record['type'] !== 'tweet') continue
    const content = record['content']
    if (typeof content !== 'object' || content === null) continue
    const tweet = (content as Record<string, unknown>)['tweet']
    if (typeof tweet !== 'object' || tweet === null) continue
    const t = tweet as Record<string, unknown>

    const id = typeof t['id_str'] === 'string' ? t['id_str'] : ''
    if (id === '') continue
    const createdAt = parseTweetTime(t['created_at'])
    // 时间解析不出来的条目**跳过**：它没法参与「按时间排序」也没法判新鲜度，
    // 留着只会排到最后并让「今天的新事件」判定失去意义。
    if (createdAt === 0) continue

    const user = (typeof t['user'] === 'object' && t['user'] !== null ? t['user'] : {}) as Record<string, unknown>
    const handle = (typeof user['screen_name'] === 'string' ? user['screen_name'] : '').toLowerCase()
    if (handle === '') continue

    /*
     * entities.media 可能是 null / 空数组（实测），取值前必须判空。
     *
     * 2026-10-28 起不再只留封面图：图片要能直接显示、视频要能直接播，所以
     * 走 parseMediaList 归一化 —— 它会挑出最高码率的 mp4 放进 videoUrl
     * （video 的 media_url_https 只是封面，见该函数说明）。
     */
    const entities = (typeof t['entities'] === 'object' && t['entities'] !== null ? t['entities'] : {}) as Record<string, unknown>
    const media = parseMediaList(entities['media'])

    /*
     * 只保留「他自己单独发的」（与备用通道同一口径，2026-10-28 用户要求）。
     *
     * 主通道的条目带完整的 in_reply_to_status_id_str / quoted_status_id_str，
     * 判据比备用通道更直接：有这两个 id 就是回复 / 引用。
     */
    const fullText = typeof t['full_text'] === 'string' ? t['full_text'] : ''
    const isReply = typeof t['in_reply_to_status_id_str'] === 'string'
      || /^@[A-Za-z0-9_]{1,15}\b/.test(fullText.trim())
    const isQuote = typeof t['quoted_status_id_str'] === 'string'
      || (t['quoted_status'] !== undefined && t['quoted_status'] !== null)
    if (isReply || isQuote) continue

    tweets.push({
      id,
      handle,
      name: typeof user['name'] === 'string' ? user['name'] : handle,
      avatar: typeof user['profile_image_url_https'] === 'string' ? user['profile_image_url_https'] : '',
      text: typeof t['full_text'] === 'string' ? t['full_text'] : '',
      createdAt,
      url: tweetUrlOf(t['permalink'], handle, id),
      likes: typeof t['favorite_count'] === 'number' ? t['favorite_count'] : 0,
      retweets: typeof t['retweet_count'] === 'number' ? t['retweet_count'] : 0,
      replies: typeof t['reply_count'] === 'number' ? t['reply_count'] : 0,
      lang: typeof t['lang'] === 'string' ? t['lang'] : '',
      media,
    })
  }

  // **按时间倒序重排**（实测返回顺序是混合的，不能依赖）。
  tweets.sort((a, b) => b.createdAt - a.createdAt)
  return tweets.slice(0, X_MAX_TWEETS)
}

/* ───────────────────────── 单次抓取 ───────────────────────── */

/** 抓取一个账号的原始结果（不做任何状态更新，纯网络 + 解析）。 */
export interface XFetchResult {
  outcome: XFetchOutcome
  tweets: XTweet[]
  /** 给用户看的中文一句话。 */
  message: string
}

/** 把机器可读结局翻成一句人话（设置页与状态路由直接用）。 */
export function describeOutcome(outcome: XFetchOutcome): string {
  switch (outcome) {
    case 'ok': return '同步成功'
    case 'empty': return '该账号没有可用的推文'
    case 'cooldown': return '处于限流冷却期，已跳过'
    case 'rate-limit': return '被限流，10 分钟后重试'
    case 'timeout': return '请求超时（可能是网络代理不通）'
    case 'network': return '网络错误（DNS / TLS / 连接失败）'
    case 'parse-fail': return '返回格式无法解析（通道可能已变更）'
    case 'http-error': return '服务端返回错误状态'
    default: return '未知结果'
  }
}

/**
 * 抓单个账号（**不做**状态记账，也不 sleep 重试之外的等待）。
 *
 * 429 的返回体是纯文本 `"Rate limit exceeded "`、只有 20 字节（实测），
 * 所以**先判状态码与短正文**，不要直接当 HTML 解析 —— 否则会拿到
 * JSON.parse 异常而不是可识别的限流状态。
 *
 * @param handle - 账号名（可带 @，内部归一化）。
 * @param deps - 注入面。
 * @returns 结果对象，**永不抛**。
 */
/**
 * 备用通道：**主页推文 ID + 单条详情**。
 *
 * 为什么要它（2026-10-27 实测）：主通道 `syndication/srv/timeline-profile`
 * 在连续抓取后进入长冷却，实测**全部账号一律 HTTP 429**（正文正好 20 字节
 * `Rate limit exceeded`），冷却远超 60 秒。但另外两条端点仍是通的：
 *
 *   1. `https://x.com/<handle>` 主页 HTML —— 200，正文里带若干
 *      `/status/<id>` 形式的**真实推文 ID**（不含正文，也没有 __NEXT_DATA__）；
 *   2. `https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=en&token=a`
 *      —— 200，返回单条推文的**完整 JSON**（text / created_at / user / 互动数）。
 *
 * 组合起来就能在主通道限流期间继续拿到真实推文，且每条都是官方数据。
 *
 * ⚠ **必须按 `user.screen_name` 严格过滤**：主页上的 ID 里混着**转发**与
 * 「别人提到他」的推文（实测 @DeepSeekHarness 主页 3 个 ID 里有 1 个作者是
 * @deepseek_ai；@tianyi 的 7 个 ID 里有 2 个是 @deepseek_ai）。不过滤就会
 * 把别人的内容算成这个账号的动态 —— 那正是「不准有其他来源」要禁止的。
 *
 * @param handle - 账号名（已归一化，不带 @、小写）。
 * @param doFetch - fetch 实现（注入便于测试）。
 * @param signal - 外部中止信号。
 * @returns 本人推文数组；任何一步失败返回空数组（**永不抛**）。
 */
async function fetchViaProfileFallback(
  handle: string,
  doFetch: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<XTweet[]> {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

  // ① 主页拿候选 ID。
  let html = ''
  try {
    const res = await doFetch('https://x.com/' + encodeURIComponent(handle), {
      signal,
      headers: { 'user-agent': UA, accept: 'text/html' },
    })
    if (!res.ok) return []
    html = await res.text()
  } catch {
    return []
  }
  const ids = [...new Set((html.match(/\/status\/(\d+)/g) ?? []).map(m => m.replace('/status/', '')))]
  if (ids.length === 0) return []

  /*
   * ② 逐条取详情 —— **不截断**（用户 2026-10-28：「去掉名额限制」）。
   *
   * 原来写死 slice(0, 6)：主页 HTML 里有多少 ID 就只取前 6 个。虽然实测主页
   * 首屏只渲染 3-7 个 ID（所以多数账号本来也拿不到 7 个），但那是一层
   * 与「数据有多少」无关的人为上限 —— 哪天主页多给了几条，这里就会悄悄丢掉。
   * 现在有多少取多少。
   *
   * 代价是每多一条多一次请求（实测每条约 300-800ms），但总量本来就小。
   */
  const out: XTweet[] = []
  for (const id of ids) {
    try {
      const res = await doFetch(
        'https://cdn.syndication.twimg.com/tweet-result?id=' + id + '&lang=en&token=a',
        { signal, headers: { 'user-agent': UA, accept: 'application/json' } },
      )
      if (!res.ok) continue
      const raw = await res.text()
      let item: Record<string, unknown>
      try { item = JSON.parse(raw) as Record<string, unknown> } catch { continue }
      const user = item['user'] as Record<string, unknown> | undefined
      const author = typeof user?.['screen_name'] === 'string' ? (user['screen_name'] as string).toLowerCase() : ''
      // ⚠ 严格过滤：不是本人发的（转发 / 他人提到）一律丢掉。
      if (author !== handle) continue
      const text = typeof item['text'] === 'string' ? item['text'] : ''
      if (text.trim() === '') continue
      /*
       * 只保留「他自己单独发的」（2026-10-28 用户：「应该是他单独发的动态，
       * 而不是他回复别人的」）。
       *
       * 两条判据：
       *   1. **回复**：X 的规则是回复正文以 @某人 开头（不带 @ 的会被归进原创）；
       *   2. **引用**：响应里有 quoted_tweet —— 那条推文的主语其实是别人
       *      （「XXX 说了这个，我评论一句」），实测 20 条里 9 条是这种，
       *      用户看到的就是「像在回复别人」。
       * 两者都排除后，剩下的才是「他自己发了一条」。
       */
      const isReply = /^@[A-Za-z0-9_]{1,15}\b/.test(text.trim())
        || typeof item['in_reply_to_status_id_str'] === 'string'
      const isQuote = item['quoted_tweet'] !== undefined && item['quoted_tweet'] !== null
      if (isReply || isQuote) continue
      const createdAt = Date.parse(typeof item['created_at'] === 'string' ? item['created_at'] : '')
      if (!Number.isFinite(createdAt)) continue
      const avatar = typeof user?.['profile_image_url_https'] === 'string'
        ? (user['profile_image_url_https'] as string)
        : ''
      out.push({
        id,
        handle: author,
        name: typeof user?.['name'] === 'string' ? (user['name'] as string) : handle,
        avatar,
        text,
        createdAt,
        url: 'https://x.com/' + author + '/status/' + id,
        likes: typeof item['favorite_count'] === 'number' ? (item['favorite_count'] as number) : 0,
        retweets: typeof item['conversation_count'] === 'number' ? (item['conversation_count'] as number) : 0,
        replies: 0,
        lang: typeof item['lang'] === 'string' ? (item['lang'] as string) : '',
        // 标记留档：上面的 continue 已经把它们滤掉了，这里写 false 只为形状完整。
        isReply: false,
        isQuote: false,
        /*
         * 媒体（2026-10-28）：这一条通道**恰好**是媒体信息最全的那条 ——
         * tweet-result 的 mediaDetails[] 带 original_info（图片尺寸）与
         * video_info.variants（视频直链；实测 200 + video/mp4 + 3.5MB，可直接播）。
         *
         * 字段名与主通道不同（mediaDetails vs entities.media），但形状一致，
         * 所以同样交给 parseMediaList 归一化。
         */
        media: parseMediaList(item['mediaDetails']),
      })
    } catch {
      // 单条失败跳过，不影响其它条目。
      continue
    }
  }
  // 按时间倒序（与主通道的排序口径一致）。
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export async function fetchOnce(handle: string, deps: XFetchDeps = {}): Promise<XFetchResult> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    return { outcome: 'network', tweets: [], message: describeOutcome('network') }
  }
  const clean = handle.trim().replace(/^@/, '').toLowerCase()
  if (clean === '') return { outcome: 'empty', tweets: [], message: describeOutcome('empty') }

  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, X_FETCH_TIMEOUT_MS)
  try {
    const response = await doFetch(`${X_TIMELINE_URL}${encodeURIComponent(clean)}`, {
      signal: controller.signal,
      headers: {
        // 不伪装成浏览器做风控绕过：这个通道本来就是官方给嵌入组件用的公开端点，
        // 带一个说明性 UA 即可（实测不加 UA 也能成功）。
        'user-agent': 'dsh-chat-plus-feed/1.0 (+syndication embed endpoint)',
        accept: 'text/html,application/xhtml+xml',
      },
    })

    // ① 先判状态码，再判正文 —— 429 的正文不是 HTML。
    if (response.status === 429) {
      // 主通道限流 → 试备用通道（主页 ID + 单条详情）。拿到就照常返回，
      // 拿不到才算限流（备用通道也失败时，冷却逻辑仍然生效）。
      const viaFallback = await fetchViaProfileFallback(clean, doFetch, controller.signal)
      if (viaFallback.length > 0) {
        return { outcome: 'ok', tweets: viaFallback, message: describeOutcome('ok') }
      }
      return { outcome: 'rate-limit', tweets: [], message: describeOutcome('rate-limit') }
    }
    if (!response.ok) {
      return { outcome: 'http-error', tweets: [], message: `服务端返回 ${response.status}` }
    }

    const html = await response.text()
    /*
     * ② 先判「是不是限流短文本」，再判「有没有 __NEXT_DATA__」，最后才用长度兜底。
     *
     * 顺序为什么是这样（2026-10-27 冒烟实测踩到）：曾经的写法是「正文 <200 字节
     * 一律 parse-fail」，但**空时间线的页面本身也可能很短**（一个正常但没有任何
     * 条目的 timeline JSON 完全放得进 200 字节），于是「不存在的账号」会被判成
     * 解析失败 —— 那是**可冷却、可重试**的错误分类，而它其实只是「这个账号没有
     * 内容」。真正需要防的是 429 那种 20 字节纯文本，那个用内容特征判比用长度判准。
     */
    if (/^\s*rate limit/i.test(html) && html.length < 200) {
      const viaFallback = await fetchViaProfileFallback(clean, doFetch, controller.signal)
      if (viaFallback.length > 0) {
        return { outcome: 'ok', tweets: viaFallback, message: describeOutcome('ok') }
      }
      return { outcome: 'rate-limit', tweets: [], message: describeOutcome('rate-limit') }
    }

    const jsonText = extractNextData(html)
    if (jsonText === null) {
      // 没有 __NEXT_DATA__ 且正文极短 → 不是页面（多半还是限流/被拦）。
      if (html.length < 200) {
        return { outcome: 'rate-limit', tweets: [], message: describeOutcome('rate-limit') }
      }
      return { outcome: 'parse-fail', tweets: [], message: describeOutcome('parse-fail') }
    }
    const tweets = parseTweetsFromNextData(jsonText)
    if (tweets === null) {
      return { outcome: 'parse-fail', tweets: [], message: describeOutcome('parse-fail') }
    }
    // ③ 不存在的账号返回 200 + 空 entries（实测，不是 404）——按空处理，不当错误。
    if (tweets.length === 0) {
      /*
       * 主通道「成功但零条」也试一次备用通道（2026-10-27 实测）。
       *
       * 主通道在长冷却边缘会出现这种形态：HTTP 200、__NEXT_DATA__ 能解析、
       * 但 entries 是空的 —— 不是账号不存在，而是限流把它降级成了空时间线。
       * 实测 5 个真实账号全部「ok 但 0 条」，而备用通道能拿到 25 条真实推文。
       * 不降级的话，界面上就是「同步成功但什么都没有」，看起来像账号没发过东西。
       */
      const viaFallback = await fetchViaProfileFallback(clean, doFetch, controller.signal)
      if (viaFallback.length > 0) {
        return { outcome: 'ok', tweets: viaFallback, message: describeOutcome('ok') }
      }
      return { outcome: 'empty', tweets: [], message: describeOutcome('empty') }
    }
    return { outcome: 'ok', tweets, message: describeOutcome('ok') }
  } catch (error) {
    // AbortController 触发时抛 AbortError；代理卡住也走这里。
    const name = (error as { name?: string })?.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { outcome: 'timeout', tweets: [], message: describeOutcome('timeout') }
    }
    return { outcome: 'network', tweets: [], message: describeOutcome('network') }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 抓一个账号，最多尝试 `X_MAX_ATTEMPTS` 次（第 2 次前 sleep 3000ms）。
 *
 * 只有**可重试的失败**才重试：`rate-limit` 立刻停（重试只会把封禁拖更长），
 * `timeout` / `network` 值得再试一次，`parse-fail` / `empty` 重试无意义。
 */
export async function fetchWithRetry(handle: string, deps: XFetchDeps = {}): Promise<XFetchResult> {
  const sleep = deps.sleep ?? realSleep
  const retryable = new Set<XFetchOutcome>(['timeout', 'network', 'http-error'])
  let last: XFetchResult = { outcome: 'network', tweets: [], message: describeOutcome('network') }
  for (let attempt = 1; attempt <= X_MAX_ATTEMPTS; attempt++) {
    last = await fetchOnce(handle, deps)
    if (last.outcome === 'ok' || last.outcome === 'empty') return last
    if (!retryable.has(last.outcome)) return last
    if (attempt < X_MAX_ATTEMPTS) await sleep(X_RETRY_DELAY_MS)
  }
  return last
}

/* ───────────────────────── 去重与新鲜度 ───────────────────────── */

/**
 * 从抓到的推文里挑出「从没见过」的那些（去重闸门）。
 *
 * **不用 id 大小比较**（实测修正）：syndication 返回的是混合顺序 —— 最新推文
 * 与若干年前的高互动推文混排 —— 所以「id 比水位线大才算新」会漏掉新抓到的
 * 历史条目。这里只认「id 不在已见集合里」。
 *
 * @param tweets - 本次抓到的（已按时间倒序）。
 * @param seen - 已见 id → 首次见到的时间。
 * @returns 新推文（保持时间倒序）。
 */
export function selectNewTweets(tweets: readonly XTweet[], seen: Record<string, number>): XTweet[] {
  /*
   * ⚠ 这里**故意不做「只留没见过的」过滤**（2026-10-27 实测修正）。
   *
   * 原实现是 `tweets.filter(t => seen[t.id] === undefined)`，意图是「增量」。
   * 但对「用户主动关注的账号」这个场景它是错的：
   *
   *   关注账号的发文频率很低（实测 6 个账号总共 25 条，最活跃的一天两三条）。
   *   第一轮抓完，这些 id 全部进 seenTweetIds；第二轮起 `selectNewTweets` 恒返回
   *   空数组 → writer 收到 freshTweets=[] → 模型只能看到网页检索那些泛化结果
   *   （「值得关注的 AI 账号清单」这类），于是判定「没有可写内容」交 0 条。
   *   用户看到的是：同步明明成功（summary: 5 个账号 5 个成功），页面却永远是空的。
   *
   * 用户要的是「这几个账号最近说了什么」，不是「只写这轮新增的那几条」。
   * 一条三天前的推文，只要它是这个人说的，今天依然值得读。
   *
   * 真正防止「重复发同样的内容」的是另外两道，它们都还在：
   *   1. `splitTweetsByFreshness` 把推文分成 fresh / stale，提示词按新鲜度区别对待；
   *   2. writer 的 knownTitles / knownPosts 去重（模型自己判断 + 兜底去重）。
   * 所以这里返回**全部**抓到的推文是安全的 —— 去重不该在这一层做。
   *
   * @param tweets - 本次抓到的（已按时间倒序）。
   * @param seen - 已见 id 集合（保留参数：调用方仍需它来更新状态、做展示）。
   * @returns 抓到的全部推文（保持时间倒序）。
   */
  void seen
  return [...tweets]
}

/**
 * 把新见到的 id 并进已见集合，并按「首次见到时间」裁剪到上限。
 *
 * 裁剪只丢最久以前见到的，所以刚并进来的这批一定还在集合里 ——
 * 去重不会因为裁剪而漏判。
 */
export function mergeSeenTweets(
  seen: Record<string, number>,
  tweets: readonly XTweet[],
  now: number,
  limit: number = MAX_SEEN_TWEET_IDS,
): Record<string, number> {
  const next: Record<string, number> = { ...seen }
  for (const tweet of tweets) {
    if (next[tweet.id] === undefined) next[tweet.id] = now
  }
  const entries = Object.entries(next)
  if (entries.length <= limit) return next
  // 按「首次见到时间」倒序，保留最近的 limit 个。
  entries.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(entries.slice(0, limit))
}

/**
 * 按新鲜度切分：`fresh` 可当作「今天的新事件」写入，`stale` 只能作背景。
 *
 * 依据实测报告 §3.2：缓存逐账号独立且不均匀，且 entries 混着历史高互动推文，
 * 所以「抓到了」不等于「是新的」。窗口见 `FEED_FRESH_WINDOW_MS`（72 小时）。
 */
export function splitTweetsByFreshness(
  tweets: readonly XTweet[],
  now: number,
  windowMs: number = FEED_FRESH_WINDOW_MS,
): { fresh: XTweet[]; stale: XTweet[] } {
  const cutoff = now - windowMs
  const fresh: XTweet[] = []
  const stale: XTweet[] = []
  for (const tweet of tweets) {
    // 未来时间（时钟差异）也算 fresh —— 总比把今天的内容当历史强。
    if (tweet.createdAt >= cutoff) fresh.push(tweet)
    else stale.push(tweet)
  }
  return { fresh, stale }
}

/* ───────────────────────── 多账号一轮同步 ───────────────────────── */

/** 一轮同步里单个账号的结果（状态路由直接下发这一份给设置页）。 */
export interface XHandleResult {
  handle: string
  outcome: XFetchOutcome
  /** 新推文（已去重、已按时间倒序）。 */
  fresh: XTweet[]
  /** 历史推文（只作背景）。 */
  stale: XTweet[]
  message: string
  /** 该账号的抓取时刻（毫秒）。 */
  fetchedAt: number
}

/** 一轮同步的总结果。 */
export interface XSyncRoundResult {
  results: XHandleResult[]
  /** 本轮是否因为 429 提前中止（剩余账号未抓）。 */
  aborted: boolean
  /** 冷却截止（毫秒；0 = 无冷却）。 */
  cooldownUntil: number
  /** 给界面用的一句话（「同步了 3 个账号，2 个被限流」这类）。 */
  summary: string
}

/**
 * 选出本轮该抓哪几个账号（实测报告 §4.2 的 1–3 步）。
 *
 *  1. 过滤掉仍在冷却期的账号；
 *  2. 按 lastFetchedAt **升序**（最久没抓的优先，多轮就能轮转覆盖全部）；
 *  3. 最多取 `X_MAX_HANDLES_PER_ROUND`（5）个。
 */
export function pickHandlesForRound(
  handles: readonly string[],
  sync: Record<string, XSyncState>,
  now: number,
  limit: number = X_MAX_HANDLES_PER_ROUND,
): { picked: string[]; cooling: string[] } {
  const cooling: string[] = []
  const ready: { handle: string; lastFetchedAt: number }[] = []
  for (const raw of handles) {
    const handle = raw.trim().replace(/^@/, '').toLowerCase()
    if (handle === '') continue
    const state = sync[handle]
    if (state !== undefined && state.cooldownUntil > now) {
      cooling.push(handle)
      continue
    }
    ready.push({ handle, lastFetchedAt: state?.lastFetchedAt ?? 0 })
  }
  // lastFetchedAt 升序；同一时刻按账号名稳定排序（保证可测、不会每轮乱跳）。
  ready.sort((a, b) => (a.lastFetchedAt !== b.lastFetchedAt
    ? a.lastFetchedAt - b.lastFetchedAt
    : a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))
  return { picked: ready.slice(0, Math.max(0, limit)).map(item => item.handle), cooling }
}

/**
 * 一轮 X 同步（**串行 + 节流 + 退避**，实测报告 §4.2 的完整实现）。
 *
 * 行为：
 *  - 账号之间 sleep `X_HANDLE_GAP_MS`（1500ms）；
 *  - 遇 429 → 该账号 cooldownUntil = now + 10min，**本轮剩余账号全部跳过**；
 *  - 每抓一个就回调 `onHandle` 落一次状态（中断也不会丢已抓到的进度）；
 *  - 全程不抛：单账号失败只写进结果。
 *
 * @param handles - 候选账号（内部会按 pickHandlesForRound 选 5 个）。
 * @param sync - 当前的同步状态表（读）。
 * @param deps - 注入面（fetch / sleep / now）。
 * @param onHandle - 每个账号处理完后的回调（用于落盘状态）。
 */
export async function runXSyncRound(
  handles: readonly string[],
  sync: Record<string, XSyncState>,
  deps: XFetchDeps = {},
  onHandle?: (state: XSyncState, result: XHandleResult) => Promise<void> | void,
): Promise<XSyncRoundResult> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  const startedAt = now()
  const { picked, cooling } = pickHandlesForRound(handles, sync, startedAt)
  const results: XHandleResult[] = []
  let aborted = false
  let cooldownUntil = 0

  for (let index = 0; index < picked.length; index++) {
    const handle = picked[index]!
    // 账号之间至少隔 1500ms（第一个不等 —— 它没有上一个）。
    if (index > 0) await sleep(X_HANDLE_GAP_MS)

    const fetched = await fetchWithRetry(handle, deps)
    const at = now()
    const prev = sync[handle]
    const seen = prev?.seenTweetIds ?? {}

    if (fetched.outcome === 'ok') {
      const newTweets = selectNewTweets(fetched.tweets, seen)
      const mergedSeen = mergeSeenTweets(seen, fetched.tweets, at)
      const { fresh, stale } = splitTweetsByFreshness(newTweets, at)
      const state: XSyncState = {
        handle,
        lastFetchedAt: at,
        cooldownUntil: 0,
        consecutiveFailures: 0,
        seenTweetIds: mergedSeen,
        lastOutcome: 'ok',
      }
      // lastTweetId 只是「最近一次抓到的最新一条」用于展示，**不作过滤闸门**。
      const newest = fetched.tweets[0]
      if (newest !== undefined) state.lastTweetId = newest.id
      const result: XHandleResult = {
        handle, outcome: 'ok', fresh, stale, message: fetched.message, fetchedAt: at,
      }
      results.push(result)
      await onHandle?.(state, result)
      continue
    }

    // 失败：更新状态（冷却 / 连续失败）。
    const isRateLimit = fetched.outcome === 'rate-limit'
    const nextCooldown = isRateLimit ? at + X_COOLDOWN_MS : (prev?.cooldownUntil ?? 0)
    const state: XSyncState = {
      handle,
      lastFetchedAt: prev?.lastFetchedAt ?? 0,
      cooldownUntil: nextCooldown,
      consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
      seenTweetIds: seen,
      lastOutcome: fetched.outcome,
      lastErrorText: fetched.message,
    }
    if (prev?.lastTweetId !== undefined) state.lastTweetId = prev.lastTweetId
    const result: XHandleResult = {
      handle, outcome: fetched.outcome, fresh: [], stale: [], message: fetched.message, fetchedAt: at,
    }
    results.push(result)
    await onHandle?.(state, result)

    if (isRateLimit) {
      // 429 → 本轮剩余账号全部跳过（继续抓只会把封禁拖更长）。
      cooldownUntil = nextCooldown
      aborted = index + 1 < picked.length
      break
    }
  }

  const okCount = results.filter(item => item.outcome === 'ok').length
  const coolCount = results.filter(item => item.outcome === 'rate-limit').length
  const parts: string[] = []
  parts.push(`本轮同步 ${results.length} 个账号`)
  if (okCount > 0) parts.push(`${okCount} 个成功`)
  if (coolCount > 0) parts.push(`${coolCount} 个被限流（${Math.round(X_COOLDOWN_MS / 60000)} 分钟后重试）`)
  if (cooling.length > 0) parts.push(`${cooling.length} 个仍在冷却期`)
  if (aborted) parts.push('已中止剩余账号')

  return {
    results,
    aborted,
    cooldownUntil,
    summary: parts.join(' · '),
  }
}

/* ───────────────────────── 把推文变成来源 ───────────────────────── */

/**
 * 把一条 X 推文转成 FeedSource（**按 limited 处理**，实测报告 §4.3）。
 *
 * 规则（法律与边界）：
 *  - 只存 URL + 作者 + 截断摘要（≤200 字符）；
 *  - 不存全文正文，正文只能作为话题线索由模型自己重写；
 *  - 摘要必须标注来源为 X。
 *
 * @param tweet - 抓到的推文。
 */
export function tweetToSource(tweet: XTweet): FeedSource {
  // 保留推文原文（不压缩），只做空白归一化 —— 用户要求「不要压缩原文内容」。
  const excerpt = tweet.text.replace(/\s+/g, ' ').trim().slice(0, MAX_EXCERPT_CHARS)
  return {
    url: tweet.url,
    domain: 'x.com',
    title: `@${tweet.handle} · ${tweet.name}`,
    // ⚠ access 必须显式给：漏了这一格，来源会退化成「open」—— 界面上就变成
    // 「公开可抓取」，而实际内容来自不开放平台，等于把法律边界搞反了。
    access: 'limited',
    // limited 来源**不带 snippet**（§7.3 法律边界：不复制正文），
    // 只带 excerpt 话题线索（实测报告 §4.3：≤200 字符，界面标注来源为 X）。
    excerpt,
    fetchedAt: tweet.createdAt,
  }
}

/** 导出给冒烟对拍。 */
export const __test = {
  LOGIN_WALL_RE,
  PAYWALL_RE,
  X_MAX_TWEETS,
  bestMp4Of,
  parseMediaItem,
  parseMediaList,
  mediaTypeOf,
}
