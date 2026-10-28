/**
 * dsh-chat-plus — 个人动态（Feed）· HTTP API（host 半身，loopback-only）。
 *
 * 前缀 `/api/dsh-feed`（方案 §8；与 dsh-mail / dsh-memory 等并列，不占任何已有前缀）。
 *
 * ── 两道闸门（缺一不可）────────────────────────────────────────────
 *
 *  `if (!loopbackAllowed(req)) → 403`
 *  `if (rejectCrossSite(headers, json)) → 403`
 *
 * 顺序固定、两条都要。理由见 `src/shared/csrf.ts` 头注释：DSH 的 webServer 是
 * **longest-prefix-wins** 派发，插件前缀比官方 `/api` 长，于是官方 handler 里那道
 * `connection.requestRejection`（含 Origin / sec-fetch-site 校验）**根本不执行** ——
 * 插件路由站在官方鉴权之外，必须自己补。少了 rejectCrossSite，任意网页一个 CORS
 * 简单请求就能盲调删除接口。
 *
 * ── 回包约定 ────────────────────────────────────────────────────────
 *
 * 业务错误是 **HTTP 200 + `{ ok: false, error }`**，只有两道闸门用 403。
 * 客户端按 `payload.ok` 判成败，不靠状态码猜语义 —— 与 mail/api.ts 同款。
 *
 * ── 排序与分组在服务端 ──────────────────────────────────────────────
 *
 * `GET /posts` 直接返回**已按天分组、组内已排好序**的 `days`（方案 §8
 * 「排序放服务端，客户端不再排」）。这样做的好处是双份排序不可能漂移；
 * 代价是响应里带一层分组结构，而客户端只需要遍历。
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { URL } from 'node:url'
import { rejectCrossSite } from '../shared/csrf.ts'
import {
  attachDayKeys,
  groupFeedPosts,
  isExpired,
  isUnread,
  matchTopic,
  queryFeedPosts,
  type FeedFilterKey,
} from './rank.ts'
import {
  DEFAULT_FEED_CONFIG,
  FEED_ROUTE_PREFIX,
  MAX_ENTITIES,
  newCommentId,
  type FeedComment,
  type FeedConfig,
  type FeedMedia,
  type FeedPost,
  type FollowedEntity,
} from './types.ts'
import type { FeedStore } from './store.ts'
import type { FeedRunner, RunRequestResult } from './trigger.ts'
import { promptChanged, promptHashOf } from './trigger.ts'
import { lastOkRunAtOf, resolveSinceWindow } from './incremental.ts'
import { parseCronIntervalMs } from './index.ts'
import { describeOutcome, fetchXProfile, X_COOLDOWN_MS } from './sources.ts'
import { loadModelCatalog, resolveWriteRoute, type ServiceGetter } from './models.ts'
import {
  createEntityMatcher,
  initialOf,
  normalizeXHandle,
  sharedEntityStore,
  withResolvedEntities,
  xHandlesOf,
  type EntityStore,
} from './entities.ts'

/* ───────────────────────── 闸门（照抄 mail/api.ts） ───────────────────────── */

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return null
  return firstColon === -1 ? host : host.slice(0, firstColon)
}

/** loopback 校验：socket 是 127.x/::1 且 Host 头是 localhost/127.0.0.1/::1。 */
export function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket?.remoteAddress ?? undefined)) return false
  const host = hostNameOf(req.headers.host)
  if (host === null) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/** 读 JSON body（≤2MB；空 body 视为 {}）。 */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) { rejectPromise(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolvePromise({}); return }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        resolvePromise(typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {})
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error('invalid JSON body'))
      }
    })
    req.on('error', rejectPromise)
  })
}

/** 取字符串参数（缺省 undefined，不用空串混淆「没给」与「给了空」）。 */
function str(value: string | null): string | undefined {
  return value === null || value.trim() === '' ? undefined : value.trim()
}

/** 取有限数参数。 */
function numParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/* ───────────────────────── 客户端投影 ───────────────────────── */

/**
 * 一条动态在 API 里的形状。
 *
 * 在 FeedPost 之上**只增不减**地补两个投影字段（客户端契约的最小集里点名要
 * `read`；`day` 用于插日期标题）：
 *  - `read`：由 `isUnread(post, now)` 反推。为什么不让客户端自己算 readAt +
 *    过期判定：那样客户端要复述一遍 rank.ts 的三条规则，两处实现迟早分叉。
 *  - `day`：这条属于哪个天分组（today / yesterday / older）。
 *
 * 另外 `media` 被**收窄成必有**（FeedPost 上是可选的）：出参里它恒为数组，
 * 客户端可以直接 map 渲染，不必每处先判空。
 */
export interface FeedPostView extends FeedPost {
  /** 媒体（图片 / 视频）。出参里恒为数组（见 toPostView 的说明）。 */
  readonly media: FeedMedia[]
  readonly read: boolean
  readonly day: 'today' | 'yesterday' | 'older'
}

/** 把一条帖子投影成客户端形状。 */
export function toPostView(post: FeedPost, now: number): FeedPostView {
  const [withDay] = attachDayKeys([post], now)
  return {
    ...(withDay as FeedPost & { day: FeedPostView['day'] }),
    /*
     * 媒体（图片 / 视频）：显式投影成**数组**，绝不把 undefined 直接透给客户端。
     *
     * 为什么这里值得多一行：客户端要拿它直接 map 渲染（图片卡片 / <video>）。
     * 一个可能缺失的字段会让每一处消费点都要先判空，而漏判的表现是
     * 「这条动态白屏」—— 那种错误不会在类型检查里露出来（客户端是独立构建的）。
     * 空数组的语义很清楚：这条没有媒体。
     */
    media: Array.isArray(post.media) ? post.media : [],
    read: !isUnread(post, now),
    // liked 在 FeedPost 里是可选字段（默认 false 不落盘，省体积），但客户端契约
    // 把它列进最小集，所以**出参里必须有且是布尔** —— 不能让前端写
    // `post.liked === true ? 已赞 : 未赞` 之外还得先判 undefined。
    liked: post.liked === true,
  }
}

/** 一个天分组在 API 里的形状（客户端按它渲染日期标题）。 */
export interface FeedDayView {
  /** 分组键：today / yesterday / older；也用作渲染的 key。 */
  readonly date: string
  readonly label: string
  readonly items: FeedPostView[]
}

/** 把帖子列表投影成「已分组 + 组内已排序」的 days。 */
export function toDayViews(posts: readonly FeedPost[], now: number): FeedDayView[] {
  return groupFeedPosts(posts, now)
    .filter(group => group.posts.length > 0)
    .map(group => ({
      date: group.key,
      label: group.label,
      items: group.posts.map(post => toPostView(post, now)),
    }))
}

/* ───────────────────────── 路由挂载 ───────────────────────── */

/** handler 需要的全部依赖。 */
export interface FeedApiDeps {
  store: FeedStore
  runner: FeedRunner
  now: () => number
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
  /**
   * 读 cordis 服务（`ctx.get` 的投影）。
   *
   * 只有 `GET /models` 与 `GET /status` 需要它 —— 它们要现场问 llm 服务
   * "到底有哪些模型可用、当前用的那个是谁"。可选：冒烟与旧调用方不传时
   * 两条路由都回一个**明确的空态**（不是报错，也不是假数据）。
   */
  getService?: ServiceGetter
  /**
   * 关注对象存储（右侧悬浮球 + 设置面板的数据源）。
   *
   * 可选：不传时路由层用 {@link sharedEntityStore} 懒建一个 —— 它指向同一个
   * 数据目录，所以「装配时忘了接」的后果只是多一个 store 实例（各自的 load
   * 读同一份磁盘），而不是接口 404。冒烟与旧调用方都能继续不传。
   */
  entityStore?: EntityStore
}

/**
 * 注册全部动态路由（prefix）。
 *
 * @returns 注销函数（webServer.register 的返回值）。
 */
export function mountFeedRoutes(ctx: { webServer: { register(route: unknown): () => void } }, deps: FeedApiDeps): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: FEED_ROUTE_PREFIX,
    handler: (req: IncomingMessage, res: ServerResponse) => { void handle(deps, req, res) },
  })
}

/** 从 rest 里抠 `/:id/<action>` 形状。 */
function matchPostAction(rest: string): { id: string; action: string } | null {
  const match = /^\/posts\/([^/]+)(?:\/([a-z]+))?$/.exec(rest)
  if (match === null) return null
  const id = decodeURIComponent(match[1] ?? '')
  if (id === '') return null
  return { id, action: match[2] ?? '' }
}

/** 频道名（客户端契约用的是 channel=）。 */
function channelOf(url: URL): string | undefined {
  return str(url.searchParams.get('channel')) ?? str(url.searchParams.get('topic'))
}

/** 解析筛选胶囊（非法值一律当 all，不报错）。 */
function filterOf(value: string | undefined): FeedFilterKey {
  if (value === 'unread' || value === 'due' || value === 'exp') return value
  return 'all'
}

/**
 * 取关注对象存储：装配注入了就用它，没注入就用共享单例。
 *
 * 为什么不要求必传：mountFeedRoutes 的 deps 是集成期双方约定的形状，
 * 而「关注对象」是 2026-10-27 才加的一条支线。要求必传会让**所有**既有调用方
 * （冒烟、旧装配）在同一瞬间编译失败；懒建单例让新旧调用都成立，而且两者
 * 指向同一个数据目录，读到的永远是同一份实体表。
 */
function entityStoreOf(deps: FeedApiDeps): EntityStore {
  return deps.entityStore ?? sharedEntityStore()
}

/**
 * 实体在 API 里的形状：主机侧 FollowedEntity + 服务端算好的首字。
 *
 * 为什么多给一个 initial：首字球的字有三条规则（拉丁首字母大写、跳过 emoji、
 * 东亚取首字），客户端再实现一遍就等着两边不一致 —— 而那个不一致是**可见的**
 * （同一颗球在两个页面显示不同字）。多下发一个字段的成本远低于此。
 */
export interface EntityView extends FollowedEntity {
  readonly initial: string
  /** 名下动态条数（悬浮球角标 / 设置面板）。读不到时缺省（组件自己显示空）。 */
  readonly postCount?: number
}

/** 投影一个实体给客户端。 */
export function toEntityView(entity: FollowedEntity, postCount?: number): EntityView {
  return {
    ...entity,
    initial: initialOf(entity.name),
    ...(postCount === undefined ? {} : { postCount }),
  }
}

/* ───────────────────────── 单条操作（两种形态共用） ───────────────────────── */

/**
 * 这三段是**两种路径形态的唯一实现**（扁平 /like 与 RESTful /posts/:id/like）。
 *
 * 为什么抽出来：集成阶段发现客户端调扁平形态、host 实现的是 RESTful 形态，
 * 两边各自冒烟都绿、合起来 404。补兼容时如果各写一份，就等着出现
 * 「点一次赞，两条路径给出两种结果」——那种漂移比 404 更难查。
 *
 * 返回 ok:false 时不再包一层（调用方直接把它当 JSON 回），错误文案统一中文。
 */
interface PostOutcome {
  ok: boolean
  post?: FeedPost
  error?: string
}

/** 点赞 / 取消（幂等：body.liked 缺省则翻转）。 */
async function applyLike(deps: FeedApiDeps, id: string, body: Record<string, unknown>, _now: number): Promise<PostOutcome> {
  const updated = await deps.store.patchPost(id, post => {
    post.liked = typeof body.liked === 'boolean' ? body.liked : post.liked !== true
  })
  if (updated === undefined) return { ok: false, error: 'post not found' }
  return { ok: true, post: updated }
}

/** 发表讨论。 */
async function applyComment(deps: FeedApiDeps, id: string, body: Record<string, unknown>, now: number): Promise<PostOutcome> {
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : ''
  if (text === '') return { ok: false, error: 'text required' }
  const comment: FeedComment = {
    id: newCommentId(),
    by: body.by === 'agent' ? 'agent' : 'user',
    text,
    at: now,
  }
  const updated = await deps.store.patchPost(id, post => {
    post.comments = [...post.comments, comment]
  })
  if (updated === undefined) return { ok: false, error: 'post not found' }
  return { ok: true, post: updated }
}

/** 软删（§8 明确要求软删：撤销要靠 deletedAt）。 */
async function applyDelete(deps: FeedApiDeps, id: string, now: number): Promise<PostOutcome> {
  const updated = await deps.store.patchPost(id, post => {
    post.deletedAt = now
  })
  if (updated === undefined) return { ok: false, error: 'post not found' }
  return { ok: true, post: updated }
}

/* ───────────────────────── 主 handler ───────────────────────── */

/**
 * 媒体代理：把 X 的图片/视频转发给浏览器，绕开 CDN 的防盗链。
 *
 * ── 为什么必须有这一层（2026-10-28 实测）────────────────────────────
 *
 * `video.twimg.com` 按 **Referer** 判来源，实测三种情况：
 *
 *   | 请求头 | 结果 |
 *   |---|---|
 *   | 无 Referer | 200 ✓ |
 *   | `Referer: https://x.com/` | 200 ✓ |
 *   | `Referer: http://127.0.0.1:3080/` | **403 ✗** |
 *
 * 浏览器里的 `<video src="https://video.twimg.com/...">` 会自动带上当前页面
 * 地址作为 Referer，于是必然 403 —— 界面上就是「媒体加载不出来」。
 *
 * 图片那边没事，因为 `<img>` 支持 `referrerPolicy="no-referrer"`；而
 * **`<video>` 是 HTMLMediaElement，规范里没有 referrerpolicy 属性**，
 * 前端没有任何办法把这个头去掉。所以只能在 host 侧转发一次。
 *
 * ── 安全 ────────────────────────────────────────────────────────────
 *
 * 这是一个「服务端替你请求任意 URL」的接口，必须锁死：
 *   · 只允许 https；
 *   · 域名白名单（只放 X 的媒体 CDN），杜绝 SSRF（否则能拿它探内网）；
 *   · 只转发 GET。
 */
const MEDIA_PROXY_HOSTS = new Set(['video.twimg.com', 'pbs.twimg.com'])

async function proxyMedia(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const raw = url.searchParams.get('u') ?? ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    json(res, 400, { ok: false, error: 'bad media url' })
    return
  }
  if (target.protocol !== 'https:' || !MEDIA_PROXY_HOSTS.has(target.hostname)) {
    json(res, 403, { ok: false, error: 'media host not allowed' })
    return
  }
  /*
   * 转发 Range：视频拖动进度条依赖它（实测 CDN 支持 206 + Accept-Ranges）。
   * 不转发的话，浏览器只能从头下整段，长视频体验会差很多。
   */
  const range = req.headers.range
  const headers: Record<string, string> = {
    // 不带 Referer 即可通过（实测 200）。显式写 x.com 也行，但没必要。
    accept: '*/*',
  }
  if (typeof range === 'string' && range !== '') headers['range'] = range

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), { headers })
  } catch (error) {
    json(res, 502, {
      ok: false,
      error: 'media fetch failed: ' + (error instanceof Error ? error.message : String(error)),
    })
    return
  }

  res.statusCode = upstream.status
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name)
    if (value !== null) res.setHeader(name, value)
  }
  // 让浏览器缓存一天：同一条动态反复看不必每次回源。
  res.setHeader('cache-control', 'public, max-age=86400')
  if (upstream.body === null) { res.end(); return }
  try {
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res)
  } catch {
    res.end()
  }
}

async function handle(deps: FeedApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // ① 闸门一：loopback。
  if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
  // ② 闸门二：跨站（顺序固定，缺一不可 —— 见文件头说明）。
  if (rejectCrossSite(req.headers as Record<string, unknown>, (status, payload) => {
    json(res, status, payload)
  })) return

  const method = req.method ?? 'GET'
  let url: URL
  let rest: string
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
    rest = url.pathname.slice(FEED_ROUTE_PREFIX.length)
  } catch {
    json(res, 200, { ok: false, error: 'invalid request url' })
    return
  }

  try {
    const now = deps.now()

    /* ── 媒体代理（视频防盗链，见 proxyMedia 的说明）───────────── */
    if (method === 'GET' && rest === '/media') {
      await proxyMedia(req, res, url)
      return
    }

    /* ── 列表 ─────────────────────────────────────────────────── */
    if (method === 'GET' && rest === '/posts') {
      const all = await deps.store.listPosts()
      /*
       * 关注对象：一次读全表，供「按实体过滤」与「响应里补 entityIds」共用。
       *
       * 读失败不该让列表整个挂掉（实体表只是一层附加信息）—— 读不到就当
       * 没有关注对象，动态列表照常返回。
       */
      const entityList = await entityStoreOf(deps).list().catch(() => [])
      const matcher = createEntityMatcher(entityList)
      const channel = channelOf(url)
      const filter = filterOf(str(url.searchParams.get('filter')))
      const q = str(url.searchParams.get('q')) ?? ''
      const limit = numParam(url.searchParams.get('limit'))
      const since = numParam(url.searchParams.get('since'))
      /*
       * entity=<id>：只看这个人物/公司的动态（右侧悬浮球点开的那一层）。
       *
       * 判据就是 matcher（先 entityIds、后别名兜底），与下面响应里补的
       * entityIds **必须同源** —— 否则会出现「某条动态的球上算它、点进去却
       * 不在列表里」这种自相矛盾。所以两边都走同一个 matcher 实例。
       */
      const entityId = str(url.searchParams.get('entity'))
      const scoped = entityId === undefined
        ? all
        : all.filter(post => matcher.belongsTo(post, entityId))
      const posts = queryFeedPosts(scoped, { topic: channel, filter, q, since, limit }, now)
      const days = toDayViews(withResolvedEntities(posts, matcher), now)
      json(res, 200, {
        ok: true,
        days,
        // 顺带给出计数：左栏频道的未读数与顶部「未读 N」都靠它，省掉客户端
        // 再拉一次全量列表自己算（客户端不该复述排序/未读规则）。
        counts: {
          // 带 entity 时，计数也只算这个实体名下的（否则「球上 3 条、点开 1 条」
          // 会被当成 bug —— 用户看到的数字就是他理解的那个范围）。
          total: (entityId === undefined ? all : scoped).filter(post => post.deletedAt === undefined).length,
          unread: (entityId === undefined ? all : scoped).filter(post => post.deletedAt === undefined && isUnread(post, now)).length,
          due: (entityId === undefined ? all : scoped).filter(post => post.deletedAt === undefined && post.dueAt > 0 && !isExpired(post, now)).length,
          expired: (entityId === undefined ? all : scoped).filter(post => post.deletedAt === undefined && isExpired(post, now)).length,
        },
        // 带 entity 时把它自己的名字也回一份，浮层标题直接用（不必再拉一次实体表）。
        ...(entityId === undefined ? {} : { entity: entityList.find(item => item.id === entityId) ?? null }),
        now,
      })
      return
    }
    /*
     * ── 扁平路径（客户端契约，2026-10-27 集成阶段补）─────────────────
     *
     * 客户端 `src/client/triad/feed/api.ts` 调的是**body 传 id** 的扁平形态：
     *   POST   /like      { id }              → { ok:true, post }
     *   POST   /comment   { id, text }        → { ok:true, post }
     *   DELETE /post      { id }              → { ok:true }
     *
     * 而本文件下面那组是 RESTful 形态（POST /posts/:id/like、DELETE /posts/:id）。
     * 两种**并存**：谁也不必改。这是集成阶段唯一能在不动客户端的前提下把两边
     * 接上的做法 —— 契约是双方约定的产物，不是某一侧的私产。
     *
     * ⚠ 两条形态必须走**同一段业务逻辑**，否则「点一次赞、两条路径给出两种结果」
     * 这种漂移迟早发生。所以下面三个分支都复用 handleLike / handleComment /
     * handleDelete 这三个函数（RESTful 分支也调它们）。
     */
    if (method === 'POST' && (rest === '/like' || rest === '/comment')) {
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (id === '') { json(res, 200, { ok: false, error: 'id required' }); return }
      const outcome = rest === '/like'
        ? await applyLike(deps, id, body, now)
        : await applyComment(deps, id, body, now)
      // 客户端读的是 `post` 字段（不是 id/liked 那些散值），所以这里必须回完整 post。
      json(res, 200, outcome.ok && outcome.post !== undefined
        ? { ok: true, post: toPostView(outcome.post, now) }
        : outcome)
      return
    }

    if (method === 'DELETE' && rest === '/post') {
      // Node 的 readBody 对 DELETE 同样能读（它只依赖 req 的 data/end 事件），
      // 客户端也确实在 DELETE 上带了 JSON body。
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (id === '') { json(res, 200, { ok: false, error: 'id required' }); return }
      const outcome = await applyDelete(deps, id, now)
      json(res, 200, outcome.ok ? { ok: true } : outcome)
      return
    }

    /* ── 单条操作 ─────────────────────────────────────────────── */
    const postAction = matchPostAction(rest)

    // 点赞 / 取消（RESTful 形态；业务逻辑与扁平 /like 共用 applyLike）。
    if (method === 'POST' && postAction !== null && postAction.action === 'like') {
      const body = await readBody(req)
      const outcome = await applyLike(deps, postAction.id, body, now)
      json(res, 200, outcome.ok && outcome.post !== undefined
        ? { ok: true, id: outcome.post.id, liked: outcome.post.liked === true, likes: outcome.post.likes, post: toPostView(outcome.post, now) }
        : outcome)
      return
    }

    // 标记已读（§6.3：展开正文 / 打开讨论 / 点开原文时写）。
    if (method === 'POST' && postAction !== null && postAction.action === 'read') {
      const updated = await deps.store.patchPost(postAction.id, post => {
        post.readAt = now
      })
      if (updated === undefined) { json(res, 200, { ok: false, error: 'post not found' }); return }
      json(res, 200, { ok: true, id: updated.id, readAt: updated.readAt })
      return
    }

    // 发表讨论（RESTful 形态；业务逻辑与扁平 /comment 共用 applyComment）。
    // 另外认单数 /comment —— 客户端契约用的是 `/comment` 加 body.id，
    // 而 RESTful 习惯是集合名词 `/comments`，两种都收，避免再分叉一次。
    if (method === 'POST' && postAction !== null
      && (postAction.action === 'comments' || postAction.action === 'comment')) {
      const body = await readBody(req)
      if (typeof body.id === 'string' && body.id.trim() !== '' && body.id.trim() !== postAction.id) {
        // 路径 id 与 body id 不一致时说清楚，别默默用一个。
        json(res, 200, { ok: false, error: 'path id and body id disagree' })
        return
      }
      const outcome = await applyComment(deps, postAction.id, body, now)
      json(res, 200, outcome.ok && outcome.post !== undefined
        ? { ok: true, id: outcome.post.id, comments: outcome.post.comments, post: toPostView(outcome.post, now) }
        : outcome)
      return
    }

    // 删除（RESTful 形态；**软删**，业务逻辑与扁平 DELETE /post 共用 applyDelete）。
    if (method === 'DELETE' && postAction !== null && postAction.action === '') {
      const outcome = await applyDelete(deps, postAction.id, now)
      json(res, 200, outcome.ok && outcome.post !== undefined
        ? { ok: true, id: outcome.post.id, deletedAt: outcome.post.deletedAt }
        : outcome)
      return
    }

    // 撤销删除（原型 toast 的「撤销」）。
    if (method === 'POST' && postAction !== null && postAction.action === 'restore') {
      const updated = await deps.store.patchPost(postAction.id, post => {
        delete post.deletedAt
      })
      if (updated === undefined) { json(res, 200, { ok: false, error: 'post not found' }); return }
      json(res, 200, { ok: true, id: updated.id })
      return
    }

    /*
     * ── 可用模型目录（客户端「生成模型」下拉的数据源）───────────────
     *
     * 客户端此前用的是**写死的假模型名**（DeepSeek-V3 / R1 / Claude / GPT-4o…），
     * 选任何一个都会在调用时失败 —— 而且模型名看起来特别像真的，用户会以为
     * 是自己的 key 配错了。这条路由把"真的有哪几个模型能用"变成事实：
     *
     *   { ok, current, currentModel, currentProvider, default, resolved,
     *     resolution, error?, models: [{ id, label, provider, providerName, modelId }] }
     *
     * 语义（用户明确要求「选中我们现在的这个模型」）：
     *  - `current` / `currentModel`：**当前系统主模型**（agentDefaultModel
     *    的唯一事实源），不是"随便挑一个能用的"；
     *  - `default`：`config.model = 'default'` 时等价于哪一项（客户端据此
     *    让下拉正确高亮）；
     *  - `resolution`：这个"当前模型"是怎么定下来的。`agentDefaultModel`
     *    = 真的；`first-available` = 兜底猜的；`none` = 解析不出来
     *    （此时 `error` 一定有值，客户端应显示「无法解析当前模型」）。
     */
    if (method === 'GET' && rest === '/models') {
      const catalog = await loadModelCatalog(deps.getService, deps.now)
      const config = await deps.store.getConfig()
      json(res, 200, {
        ok: true,
        // 客户端契约里 current 是"人类可读短名"，同时给出真实 id 便于核对。
        current: catalog.current,
        currentModel: catalog.currentModel,
        currentProvider: catalog.currentProvider,
        default: catalog.default,
        resolved: catalog.resolved,
        resolution: catalog.resolution,
        ...(catalog.error === undefined ? {} : { error: catalog.error }),
        models: catalog.models,
        // 当前配置的取值（'default' 或具体 id），客户端据此选中下拉项。
        configModel: config.model,
      })
      return
    }

    /* ── 关注对象（右侧悬浮球 / 设置面板）────────────────────────── */
    /*
     * GET    /entities          → { ok, entities: EntityView[] }
     * POST   /entities { name, kind, ... }            → { ok, entity }
     * PUT    /entities { id, ...patch }              → { ok, entity }
     * DELETE /entities { id }                        → { ok }
     *
     * 形状与方案 §4 的拆解一致，只补了一处：GET 顺带下发 postCount ——
     * 悬浮球与设置面板都要显示「名下 N 条动态」，让客户端再拉一次全量列表
     * 自己算属于白跑一趟（而且它会复述一遍归属规则，两处迟早分叉）。
     *
     * 业务失败一律 HTTP 200 + ok:false（与其余路由同款）。真失败的场景只有
     * 两种：名字为空、id 不存在 —— 都必须把话说明白，因为设置面板要显示它。
     */
    if (rest === '/entities') {
      const store = entityStoreOf(deps)
      if (method === 'GET') {
        const entities = await store.list()
        /*
         * 条数按**当前实体表**现算（含别名兜底），与 GET /posts?entity= 的
         * 过滤口径同源：两边都是 createEntityMatcher。
         */
        let counts: Record<string, number> = {}
        try {
          const all = await deps.store.listPosts()
          counts = createEntityMatcher(entities).countByEntity(all)
        } catch {
          // 帖子读不出来时只少一个数字，实体列表照常返回。
          counts = {}
        }
        json(res, 200, {
          ok: true,
          entities: entities.map(entity => toEntityView(entity, counts[entity.id] ?? 0)),
          max: MAX_ENTITIES,
        })
        return
      }
      if (method === 'POST' || method === 'PUT') {
        const rawBody = await readBody(req)
        /*
         * 「只给主页链接就能加人」（用户 2026-10-28：「设置里的账号我以后直接给你他的
         * 主页 https://x.com/lilililiMozi，这样省 token 生成又不容易错字」）。
         *
         * 三种输入都认（normalizeXHandle 已经处理过归一化）：
         *   { url: 'https://x.com/lilililiMozi' }   ← 用户复制浏览器地址栏
         *   { handle: '@lilililiMozi' }             ← 用户手打账号
         *   { name: '...', xHandle: '...' }         ← 老写法，行为不变
         *
         * 只给了 handle/url 而没给 name 时，**抓一次主页**把显示名与头像补上：
         * 用户不用手打名字，也就不会出现「Lauren / lauren / Lauren Huang」三种
         * 写法混在一起；模型那边看到的关注对象名字也统一了。
         *
         * 抓取失败不阻塞创建：退回「名字 = handle、没有头像」，用户之后仍可手改。
         */
        const body: Record<string, unknown> = { ...rawBody }
        const urlish = body['url'] ?? body['homeUrl'] ?? body['handle'] ?? body['xHandle']
        const wantsProfile = method === 'POST'
          && (typeof body['name'] !== 'string' || body['name'].trim() === '')
          && typeof urlish === 'string'
        if (wantsProfile) {
          const handle = normalizeXHandle(urlish)
          if (handle !== undefined) {
            body['xHandle'] = handle
            body['homeUrl'] = 'https://x.com/' + handle
            const profile = await fetchXProfile(handle).catch(() => null)
            if (profile !== null) {
              body['name'] = profile.name
              if (profile.avatarUrl !== '') body['avatarUrl'] = profile.avatarUrl
            } else {
              // 抓不到就退成 handle 当名字 —— 至少能建出来，用户之后可改。
              body['name'] = handle
            }
          }
        }
        const outcome = method === 'POST'
          ? await store.create(body)
          : await store.update(typeof body['id'] === 'string' ? body['id'].trim() : '', body)
        if (!outcome.ok) { json(res, 200, { ok: false, error: outcome.error }); return }
        /*
         * 实体变了要把 xHandles 派生回去（X 抓取链路读的是 config.xHandles）。
         * 派生失败**不影响**本次写入成功 —— 实体已经落盘，抓取清单晚一轮更新
         * 只是少抓一个账号，不该让用户看到「添加失败」而实际已经加进去了。
         */
        await syncXHandles(deps, store).catch(() => undefined)
        json(res, 200, { ok: true, entity: toEntityView(outcome.entity) })
        return
      }
      if (method === 'DELETE') {
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (id === '') { json(res, 200, { ok: false, error: 'id required' }); return }
        const outcome = await store.remove(id)
        await syncXHandles(deps, store).catch(() => undefined)
        // 删不存在的 id 也回 ok：删除天然幂等（连点两次不该弹一个错）。
        json(res, 200, { ok: true, removed: outcome.removed })
        return
      }
      json(res, 200, { ok: false, error: 'no route for ' + method + ' /entities' })
      return
    }

    /* ── 配置 ─────────────────────────────────────────────────── */
    if (method === 'GET' && rest === '/config') {
      const config = await deps.store.getConfig()
      const gate = await deps.store.getGate()
      json(res, 200, {
        ok: true,
        config,
        gate,
        defaults: DEFAULT_FEED_CONFIG,
        // 模型列表由客户端向官方接口取；这里只回「当前配置的是哪个」。
        modelOptions: ['default'],
      })
      return
    }

    if ((method === 'PUT' || method === 'POST') && rest === '/config') {
      const body = await readBody(req)
      const before = await deps.store.getConfig()
      const next: FeedConfig = {
        prompt: typeof body.prompt === 'string' ? body.prompt : before.prompt,
        model: typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : before.model,
        cron: typeof body.cron === 'string' && body.cron.trim() !== '' ? body.cron.trim() : before.cron,
        xHandles: Array.isArray(body.xHandles)
          ? body.xHandles
              .filter((item): item is string => typeof item === 'string')
              .map(item => item.trim().replace(/^@/, '').toLowerCase())
              .filter(item => item !== '')
          : before.xHandles,
      }
      next.xHandles = [...new Set(next.xHandles)]
      await deps.store.setConfig(next)
      /*
       * §5.3 + §5.4 的触发规则：
       *  - 提示词**实质**改动 → 立刻触发一轮（trigger='prompt'）；
       *  - 只改模型 / 账号 → 静默保存，下一轮再生效（不无故打断）。
       * 判据用 promptChanged（归一化比较），只改标点/空白不触发。
       */
      let triggered: RunRequestResult | null = null
      const changed = promptChanged(before.prompt, next.prompt)
      if (changed) {
        try {
          triggered = await deps.runner.requestRun('prompt')
        } catch (error) {
          deps.logger?.warn?.('[dsh-feed] prompt-triggered run failed: '
            + (error instanceof Error ? error.message : String(error)))
        }
      }
      json(res, 200, {
        ok: true,
        config: next,
        promptChanged: changed,
        triggered,
        gate: await deps.store.getGate(),
      })
      return
    }

    /* ── 手动更新（走单飞闸门）────────────────────────────────── */
    if (method === 'POST' && (rest === '/run' || rest === '/refresh')) {
      // 先读 body 再动闸门：body 读失败不该留下一个 already-queued 的标记。
      const body = await readBody(req)
      const trigger = body.trigger === 'schedule' || body.trigger === 'prompt' ? body.trigger : 'manual'
      const result = await deps.runner.requestRun(trigger)
      json(res, 200, {
        ok: true,
        result,
        // 客户端（client/triad/feed/api.ts 的 refreshFeed）读的是 `state` 字段。
        // 两个都发：`result` 是本模块内部一直用的名字（冒烟也在断言），
        // `state` 是客户端契约的名字。同值不同名，不冲突。
        state: result,
        // 被拦下时给一句人话：客户端据此显示「已有一轮在跑，已合并」。
        message: result === 'started'
          ? '已开始更新'
          : result === 'queued'
            ? '正在更新中，这次的请求已合并进当前一轮'
            : '正在更新中，重复的请求已忽略',
        gate: await deps.store.getGate(),
      })
      return
    }

    /* ── 状态 / 历史 ──────────────────────────────────────────── */
    if (method === 'GET' && rest === '/status') {
      const state = await deps.store.snapshot()
      const config = state.config
      const xSync = Object.values(state.xSync).map(syncState => ({
        ...syncState,
        cooling: syncState.cooldownUntil > now,
        coolingLeftMs: Math.max(0, syncState.cooldownUntil - now),
        message: syncState.lastOutcome === undefined
          ? '尚未同步'
          : describeOutcome(syncState.lastOutcome),
      }))
      /*
       * 顶层除了给本模块用的完整快照，还要满足客户端契约的最小集：
       * Client 的 `fetchFeedStatus` 直接读顶层的
       *   running / lastRunAt / nextRunAt / promptHash / model
       * 而它靠 `running` 决定「要不要继续轮询」。少这一个字段的后果不是报错，
       * 是页面永远以为没在生成 —— 轮询不启动、状态条不动、生成完也不刷新，
       * 用户看到的就是「点了更新没反应」。所以这几个必须平铺在顶层。
       */
      const running = state.gate.status === 'running' && state.gate.leaseUntil > now
      // 下一次定时大约什么时候：没有真 cron 库，用「上次 + 间隔」推一个近似值
      // （客户端只拿它显示「约 N 分钟后」，不参与任何判定）。
      const intervalMs = parseCronIntervalMs(config.cron)
      const nextRunAt = intervalMs === null
        ? 0
        : Math.max(now, (state.lastRunAt > 0 ? state.lastRunAt : now) + intervalMs)
      // 注意：FeedRun 上没有 promptHash（那一格在 FeedPost 上，用于让老帖解释
      // 「我是用哪版提示词生成的」）。状态页要的是**当前生效的**提示词哈希，
      // 直接按 config.prompt 现算 —— 若改用「最近一轮用过的」，改了提示词但还没
      // 跑起来时页面会显示旧哈希，与设置面板里预览的不一致。
      const currentPromptHash = promptHashOf(config.prompt)
      /*
       * 实际生效的模型（用户要能确认"用的确实是这个模型"）。
       *
       * 与 `model`（配置值，可能是 'default'）分开：
       *  - `model`         配置里存的是什么（'default' 或具体 id）；
       *  - `modelResolved` 那条配置**真正解析到**的路由。config.model='default'
       *    时它就是当前系统主模型；解析不出来时 resolved=false + error 说明原因。
       *
       * 为什么状态里必须能看出"解析失败"：静默降级成任意模型时，用户在
       * 设置页看到"跟随系统默认"，实际跑的却是别人 —— 而界面上一个字都不提。
       */
      const route = await resolveWriteRoute(deps.getService, config.model, deps.now)
      const lastRun = state.runs.find(item => item.id === state.gate.runId)
        ?? state.runs.find(item => item.finishedAt !== undefined)
      /*
       * 本轮（或下一轮）会用的时间窗起点（「只更新上次时间节点到现在」）。
       *
       * 两个值都给：
       *  - lastSinceAt：**上一轮实际用过的**起点（来自 run.stats，是既成事实）；
       *  - nextSinceAt：**下一轮会用的**起点（按当前水位线现算）。
       *
       * 为什么必须有 nextSinceAt：用户点更新前想知道「这次会从什么时候开始算」，
       * 而上一轮的起点回答不了这个问题（它永远是过去的值）。两个值用同一个
       * resolveSinceWindow 算出，所以界面上看到的时间窗与真正过滤用的时间窗
       * 不可能分叉 —— 这条一致性是靠「同一个纯函数」保证的，不是靠两处写法一致。
       */
      const nextSince = resolveSinceWindow({
        now: deps.now(),
        lastOkRunAt: lastOkRunAtOf(state.runs),
        lastRunAt: state.lastRunAt,
      })
      json(res, 200, {
        ok: true,
        // ── 客户端契约最小集（平铺）──
        running,
        lastRunAt: state.lastRunAt,
        nextRunAt,
        promptHash: currentPromptHash,
        model: config.model,
        // ── 模型解析（新增，客户端设置面板与排查都读它）──
        modelResolved: route.ok
          ? {
            ok: true,
            label: route.route.label,
            provider: route.route.provider,
            model: route.route.model,
            isDefault: route.route.isDefault,
            resolution: route.route.resolution,
            ...(route.route.note === undefined ? {} : { note: route.route.note }),
          }
          : { ok: false, error: route.error, resolution: route.catalog.resolution },
        // 上一轮**实际**用的模型与过程计数（来自 run.stats，证明链路走到哪一步）。
        lastRunModel: lastRun?.modelUsed ?? '',
        lastRunStats: lastRun?.stats ?? null,
        // ── 增量时间窗（「只更新上次时间节点到现在」）──
        // 上一轮**实际用过**的水位线（既成事实，来自 run.stats）。
        lastSinceAt: typeof lastRun?.stats?.sinceAt === 'number' ? lastRun.stats.sinceAt : 0,
        // 下一轮**会用**的水位线（按当前状态现算，点更新前就能看到）。
        sinceAt: nextSince.sinceAt,
        sinceFallback: nextSince.fallback,
        sinceSource: nextSince.source,
        lastRunStatus: lastRun?.status ?? '',
        lastRunError: lastRun?.error ?? '',
        // ── 本模块的完整快照 ──
        gate: state.gate,
        config,
        lastSyncAt: state.lastSyncAt,
        runs: state.runs.slice(0, 20),
        xSync,
        // 冷却时长常量给客户端做倒计时文案（不要在两边各写一份 10 分钟）。
        cooldownMs: X_COOLDOWN_MS,
        now,
      })
      return
    }

    if (method === 'GET' && rest === '/runs') {
      const limit = numParam(url.searchParams.get('limit')) ?? 20
      const runs = await deps.store.listRuns()
      json(res, 200, { ok: true, runs: runs.slice(0, Math.max(1, Math.min(200, limit))) })
      return
    }

    json(res, 200, { ok: false, error: 'no route for ' + method + ' ' + rest })
  } catch (error) {
    // 业务错误一律 200 + ok:false（客户端按 payload.ok 判成败）。
    deps.logger?.warn?.('[dsh-feed] route error: ' + (error instanceof Error ? error.message : String(error)))
    json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 把「所有实体的 xHandle 合集」写回 config.xHandles。
 *
 * X 抓取链路（sources.ts / trigger.ts）读的是 config.xHandles —— 那是既有契约，
 * 本次不改它。所以关注对象这边做**单向派生**：实体表是唯一真相，xHandles 是
 * 它的一份投影。合并时**保留** config 里本来就有的、不属于任何实体的 handle
 * （老用户手填的账号不该因为加了关注对象就消失）。
 *
 * @returns 写入后的 handle 列表（供诊断；调用方一般不关心）。
 */
export async function syncXHandles(deps: FeedApiDeps, store: EntityStore): Promise<string[]> {
  const entities = await store.list()
  const fromEntities = xHandlesOf(entities)
  const current = await deps.store.getConfig()
  const entityOwned = new Set(fromEntities)
  const entityNames = new Set(entities.map(entity => entity.xHandle).filter((handle): handle is string => handle !== undefined))
  /*
   * 「老的手填 handle」判据：它不在任何实体的 xHandle 里。
   *
   * 这里只做并集而不去清理，是因为**删掉一个关注对象**时我们无法区分
   * 「这个 handle 是当年为它加的」还是「用户自己早就填了同一个」。并集最坏
   * 多抓一个账号，清理最坏会让用户手填的账号无故消失 —— 后者是数据丢失。
   */
  void entityNames
  const merged: string[] = [...fromEntities]
  for (const handle of current.xHandles) {
    if (!entityOwned.has(handle) && !merged.includes(handle)) merged.push(handle)
  }
  if (merged.length === current.xHandles.length && merged.every((handle, index) => handle === current.xHandles[index])) {
    return merged
  }
  await deps.store.setConfig({ ...current, xHandles: merged })
  return merged
}

/** 导出给冒烟对拍。 */
export const __test = { isLoopbackAddress, hostNameOf, matchPostAction, filterOf, channelOf, toEntityView }
