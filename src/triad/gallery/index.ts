/**
 * dsh-chat-plus — 多媒体画廊 host 半身：路由挂载 + 存在性核对 + 页面资源服务。
 *
 * 四条路由，前缀 /api/triad/gallery（与 dsh-triad 融合模块同前缀，用户零迁移）：
 *
 *   GET /media      — 全部会话的产出物清单（条目 + 会话侧栏 + stale 标记 + 分类计数）
 *   GET /raw        — 单文件字节服务（**只服务画廊索引里登记过的路径**）
 *   GET /raw-asset/ — html 成品的同目录渲染资源（css/js/图/字体，token 目录）
 *   POST /delete    — 删除索引内的产出物（**不可逆**，准入见下方 /delete 段）
 *
 * 安全边界（这条路由族等于「读本机任意已产出文件」的能力，必须收窄）：
 *  · loopback fence（peer socket 地址判据，与 usage-skill 同款）+ Host 头复核；
 *  · /raw 只认**画廊索引内的路径**：索引来自会话事件日志的产出物提取，
 *    不是用户可控的自由列表 —— 没被任何对话产出过的文件一个字节都读不到；
 *  · /raw-asset 的目录必须是某个 html 成品的父目录（token = base64url(目录)），
 *    扩展名走渲染白名单（刻意不含 txt/json/csv/map —— 预览页面不该顺带把
 *    同目录的笔记与数据文件变成可读），rel 路径逐段校验拒绝 .. 与绝对段；
 *  · html 响应带 CSP sandbox（允许脚本但不允许同源），iframe 侧再套
 *    sandbox 属性（不给 allow-same-origin）—— 成品页读不到宿主 cookie；
 *  · /delete 是这条路由族里唯一的**写**能力，也是唯一不可逆的动作：准入沿用
 *    /raw 的名单（只认索引内路径），再加一道 lstat 普通文件判据（目录/符号链接
 *    一律拒），绝不接受目录前缀、绝不递归。删除只影响磁盘上那一个文件。
 *
 * /media 的 stat 核对：渲染响应时对每个磁盘条目做一次 statSync，确认不存在的
 * 直接不列（这张画廊的全部价值是「点一下就看见」）；generated（spill）条目
 * 同样核对 .txt 是否还在（30 天保留期过了就消失）。核对结果随聚合缓存
 * （TTL 15s），不会每请求全量重扫磁盘。
 */

import { lstatSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  collectGallery,
  sessionContextFor,
  sessionItemsFor,
  setPersistenceRoot,
  warmGallerySnapshot,
  type GalleryItemView,
  type GalleryResponse,
  type SessionContext,
} from './store.ts'
import { galleryDedupeKey } from './extract.ts'
import { rememberOfficePaths } from '../../office/admit.ts'
import { admitSpillPath, spillRoots } from '../../spill/index.ts'

const ROUTE = '/api/triad/gallery'

/** 单文件大小上限（raw 服务；100MB 足够任何演示页/图片/文档）。 */
const MAX_RAW_BYTES = 100 * 1024 * 1024

/** 渲染资源扩展名白名单（/raw-asset 专用，见文件头安全说明）。 */
const ASSET_EXT_ALLOW = new Set([
  '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.ico', '.avif', '.bmp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wasm',
])

/** 简单 MIME 表（够用即可；官方 /api/file 才需要 mime-types 全家桶）。 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
}

/* ── loopback fence（与 usage-skill 同款：peer socket 为主判据）────────── */

function isLoopbackAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: unknown): string | null {
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
  if (firstColon !== lastColon) return host
  if (lastColon === -1) return host.replace(/\.$/, '')
  if (!/^\d+$/.test(host.slice(lastColon + 1))) return null
  return host.slice(0, lastColon).replace(/\.$/, '')
}

function rejectForeign(req: IncomingMessage, res: ServerResponse): boolean {
  const peer = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress
  const hostOk = (() => {
    const name = hostNameOf(req.headers.host)
    return name === 'localhost' || isLoopbackAddress(name)
  })()
  if (isLoopbackAddress(peer) && hostOk) return false
  json(res, 403, { ok: false, error: 'forbidden' })
  return true
}

/** 请求头可能是 string | string[]；取第一个非空值。 */
function headerValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

/**
 * content-type 是否为 JSON（允许 `; charset=utf-8` 之类的参数后缀）。
 *
 * 为什么这条单独成判据（2026-10-16 安全审计）：跨站表单 / `fetch(..., {mode:'no-cors'})`
 * 只能发出 CORS **简单请求**，而简单请求的 content-type 被限制在
 * `text/plain` / `application/x-www-form-urlencoded` / `multipart/form-data` 三者内
 * —— 它**发不出** `application/json`（一发就触发 preflight，跨站会被拦）。所以
 * 「必须带 application/json」本身就是一道天然闸门：没有它，一个恶意页面可以用
 * `text/plain` 盲发 POST，请求会真的送达并执行删除，而响应因无 CORS 头读不到 ——
 * 用户毫无感知。
 *
 * @param value - `req.headers['content-type']` 原值。
 */
export function isJsonContentType(value: unknown): boolean {
  const raw = headerValue(value)
  if (raw === null) return false
  // 只取 type/subtype 段比大小写；参数（charset 等）与空格容忍。
  const [type] = raw.split(';')
  return type.trim().toLowerCase() === 'application/json'
}

/** 从 Origin 头里取出主机名（复用 hostNameOf 的 Host 解析口径；非法值返回 null）。 */
function originHostOf(value: string): string | null {
  try {
    // Origin 是完整 URL；`.host` 恰好就是 host[:port] 形状，与 Host 头同口径。
    return hostNameOf(new URL(value).host)
  } catch {
    // 含 `Origin: null`（sandbox iframe / file:// 会发这个）——解析不出主机，判非法。
    return null
  }
}

/**
 * 跨站判据的**纯函数**核心（导出给冒烟对拍，无 res、无副作用）。
 *
 * 判据（只拒「存在且非法」，不拒缺失）：
 *  · `sec-fetch-site: cross-site` → 拒（现代浏览器都会带这个头）；
 *  · `origin` 存在时，其主机必须是 loopback / localhost → 否则拒。
 *
 * 为什么 Origin **缺失不能拒**：同源 `fetch` 与 `curl` 都不带 Origin，缺失是正常
 * 形态；把「缺失」当「非法」会让正常的删除功能直接不可用，是拿可用性换一个
 * 本来就被 content-type 闸门兜住的面。
 *
 * @param headers - `req.headers`（只读其中两个头）。
 * @returns true = 判定为跨站写请求。
 */
export function isCrossSiteWrite(headers: Record<string, unknown> | undefined): boolean {
  const site = headerValue(headers?.['sec-fetch-site'])
  if (site !== null && site.trim().toLowerCase() === 'cross-site') return true
  const origin = headerValue(headers?.origin)
  if (origin !== null && origin.trim() !== '') {
    const name = originHostOf(origin.trim())
    if (name !== 'localhost' && !isLoopbackAddress(name)) return true
  }
  return false
}

/**
 * 写路由专用的跨站复核（**不要**加到 rejectForeign 上）。
 *
 * 为什么不合并进 rejectForeign（2026-10-16 安全审计的根因）：本插件的路由是
 * prefix 注册，而 webserver 派发是 longest-prefix-wins —— `/api/triad/gallery`
 * 比官方 `/api` 长，所以本 handler **抢在官方那层 Origin / cross-site 校验之前**
 * 命中，官方校验根本不执行。也就是说这条路由族拿不到官方的 CSRF 防护，只能自己补。
 *
 * 只用于 /delete：契约 A3 要求 /media、/raw 的既有语义（含读路由的判据）不变，
 * 而读路由被跨站盲读的危害与盲删不在一个量级上。
 *
 * @returns true = 已判定为跨站并写出 403。
 */
export function rejectCrossSiteWrite(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isCrossSiteWrite(req.headers as Record<string, unknown> | undefined)) return false
  json(res, 403, { ok: false, error: 'forbidden' })
  return true
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

/* ── stat 核对 ───────────────────────────────────────────────────────── */

/** 核对后的响应条目（附带磁盘元数据）。 */
export interface VerifiedItem extends GalleryItemView {
  /** 字节数（generated 条目为 spill 文件大小）。 */
  readonly size: number
}

interface VerifiedResponse extends Omit<GalleryResponse, 'items' | 'overflow'> {
  readonly items: readonly VerifiedItem[]
  /** 核对通过后的**未截断**分类计数（画廊芯片的真实数字，见 verifyResponse 说明）。 */
  readonly kindTotals: Readonly<Record<string, number>>
  readonly generatedAt: number
}

/**
 * 单条存在性核对（statSync 逐个 try/catch，不存在 / 无权限一律不列）。
 *
 * 抽成函数是因为它现在有**两个**调用点（响应体与溢出段的计数），而口径必须
 * 逐字一致 —— 复制一份迟早分叉，分叉的表现是「芯片数字与清单条数对不上」。
 *
 * @param item - 待核对条目。
 * @param spillRoots - 可信 spill root 列表。
 * @returns 核对通过的条目（带磁盘 size）；不通过返回 null。
 */
function verifyItem(item: GalleryItemView, spillRoots: readonly string[]): VerifiedItem | null {
  try {
    const info = statSync(item.path)
    if (!info.isFile() || info.size <= 0) return null
    // 只有 generated 条目走 spill 准入核对；磁盘成品条目不受影响。
    if (item.source === 'generated' && !admitSpillPath(item.path, spillRoots).ok) return null
    return { ...item, size: info.size }
  } catch {
    /* 不存在 / 无权限：不列 */
    return null
  }
}

/**
 * 对渲染结果做一次存在性核对（statSync，逐个 try/catch）。
 * 确认不存在的条目直接剔除 —— 与产出物卡「只列磁盘上真实存在的文件」同口径。
 *
 * generated（生图 spill）条目多加一道核对（2026-10-06）：**读不到的也不列**。
 * 它的 .txt 在磁盘上存在 ≠ 本服务能读到 —— spill root 每次进程重启换名，历史
 * root 若不在可信集合里（被手动改名 / 移到别处 / 清理器已收走），读取路由会
 * 403，画廊里就是一个点开什么都没有的空白格子。用户看到的正是这种「不存在」：
 * 条目在、内容取不回。所以核对口径从「文件在」收紧成「文件在 **且** 准入通过」。
 *
 * 分类计数（2026-10-16 新增）走**同一套核对**，但把被 `MAX_RESPONSE_ITEMS`
 * 截掉的 `overflow` 段也算进去：芯片要显示真实总数，而截断只是传输策略 ——
 * 只按响应体计数的话，索引一超 2000 芯片就永远停在 2000。被核对剔除的条目
 * 两边都不计，口径始终是「磁盘上真的还在、且本服务读得到」。
 *
 * sessionCounts 刻意**不含** overflow：侧栏会话条数要与用户能看见的清单对齐，
 * 计数口径与可见性分离（前者是统计，后者是清单）。
 *
 * @param response - 聚合结果。
 * @param spillRoots - 可信 spill root 列表（由调用方从 spillStore 现取）。
 */
function verifyResponse(response: GalleryResponse, spillRoots: readonly string[]): VerifiedResponse {
  const items: VerifiedItem[] = []
  const sessionCounts = new Map<string, number>()
  const kindTotals: Record<string, number> = {}
  for (const item of response.items) {
    const verified = verifyItem(item, spillRoots)
    if (verified === null) continue
    items.push(verified)
    kindTotals[item.kind] = (kindTotals[item.kind] ?? 0) + 1
    sessionCounts.set(item.sessionId, (sessionCounts.get(item.sessionId) ?? 0) + 1)
  }
  for (const item of response.overflow) {
    if (verifyItem(item, spillRoots) !== null) kindTotals[item.kind] = (kindTotals[item.kind] ?? 0) + 1
  }
  const sessions = response.sessions
    .map((entry) => ({ ...entry, count: sessionCounts.get(entry.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
  // 逐字段列出而不是 `...response`：overflow 只在这一层被消费掉，不该顺着展开
  // 漏进任何下游对象（它是传输细节，不是响应的一部分）。
  return { items, sessions, truncated: response.truncated, kindTotals, generatedAt: Date.now() }
}

/* ── /media ──────────────────────────────────────────────────────────── */

interface GalleryDeps {
  readonly sessions?: { list: () => Iterable<Record<string, any>> }
  readonly persistence?: Record<string, any>
  readonly logger?: { warn?: (msg: string) => void }
}

function readDeps(ctx: Context): GalleryDeps {
  const get = (name: string): unknown => {
    try { return (ctx as unknown as { get?: (n: string) => unknown }).get?.(name) } catch { return undefined }
  }
  const sessions = get('sessions') as GalleryDeps['sessions'] | undefined
  const persistence = get('sessionPersistence') as GalleryDeps['persistence'] | undefined
  const logger = (ctx as unknown as { logger?: { warn?: (msg: string) => void } }).logger
  // 会话日志根目录是「便宜扫描」快速路径的入口：一次登记，之后每次聚合都省掉
  // persistence.list() 那 40 秒（见 store.ts 的 scanSessionDirs）。老宿主不暴露
  // root 时保持 null，store 侧自动回落 list()，功能不降级。
  const root = (persistence as { root?: unknown } | undefined)?.root
  setPersistenceRoot(typeof root === 'string' && root !== '' ? root : null)
  return { sessions, persistence, logger }
}

/* ── /raw 与 /raw-asset：画廊索引即白名单 ─────────────────────────────── */

/** 最近一次聚合的索引（去重键 → 条目），/raw 的准入名单。 */
let lastIndex: Map<string, VerifiedItem> | null = null

function rememberIndex(items: readonly VerifiedItem[]): void {
  const index = new Map<string, VerifiedItem>()
  for (const item of items) index.set(galleryDedupeKey(item.path), item)
  lastIndex = index
  // 同一次聚合顺带喂给 office 预览路由的准入名单：两条路由族认的是同一份
  // 「本插件索引过的产出物」，各自再折一遍会话就等于两套真相（会漂）。
  rememberOfficePaths(items.map((item) => item.path))
}

function isIndexed(path: string): boolean {
  return lastIndex !== null && lastIndex.has(galleryDedupeKey(path))
}

/**
 * 从准入名单里摘掉一条（删除成功后才调用）。
 *
 * 为什么必须摘（2026-10-16）：`lastIndex` 是 `/raw` 的准入名单，也是「同一个
 * 进程内这条路径还可读」的判据。删完不摘，用户在 TTL（15s）内再点开那张卡
 * 会拿到 403/404 之前的中间态 —— 更糟的是 `/media` 下一次聚合前它还在清单里，
 * 看起来「删了又没删」。摘掉之后同一进程内 `/raw` 立刻拒绝这些路径。
 *
 * @returns 名单里确实有这条并已摘除。
 */
function forgetIndexed(path: string): boolean {
  return lastIndex !== null && lastIndex.delete(galleryDedupeKey(path))
}

/** 名单剩余条目数（删除响应的 remaining）。 */
function indexedCount(): number {
  return lastIndex === null ? 0 : lastIndex.size
}

/** 某个 html 成品的父目录集合（/raw-asset 的目录准入名单）。 */
function htmlDirsOf(items: Iterable<{ readonly kind: string; readonly path: string }>): Set<string> {
  const dirs = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'page') continue
    const idx = Math.max(item.path.lastIndexOf('/'), item.path.lastIndexOf('\\'))
    if (idx > 0) dirs.add(galleryDedupeKey(item.path.slice(0, idx)))
  }
  return dirs
}

function indexedHtmlDirs(): Set<string> {
  return lastIndex === null ? new Set<string>() : htmlDirsOf(lastIndex.values())
}

function sendFile(req: IncomingMessage, res: ServerResponse, target: string, contentType: string, csp?: string): void {
  let size: number
  try {
    const info = statSync(target)
    if (!info.isFile()) { json(res, 404, { ok: false, error: 'not found' }); return }
    size = info.size
  } catch {
    json(res, 404, { ok: false, error: 'not found' })
    return
  }
  if (size > MAX_RAW_BYTES) { json(res, 413, { ok: false, error: 'too large' }); return }
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-length': String(size),
    'cache-control': 'private, max-age=30',
    'x-content-type-options': 'nosniff',
  }
  if (csp !== undefined) headers['content-security-policy'] = csp
  res.writeHead(200, headers)
  if (req.method === 'HEAD') { res.end(); return }
  const stream = createReadStream(target)
  stream.on('error', () => { try { res.destroy() } catch { /* ignore */ } })
  stream.pipe(res)
}

/**
 * html 成品：注入 <base> 让相对资源落到 /raw-asset/<token>/，再套 CSP sandbox。
 *
 * token = base64url(JSON [目录, 会话 id])：会话作用域写在 token 里而不是 query
 * 里 —— base href 后面一旦带 query，浏览器拼相对资源时会把 rel 塞进查询串
 * （?session=x&style.css），raw-asset 从 path 段取 rel 就全 404。
 */
function htmlDirsToken(dir: string, session: string): string {
  return Buffer.from(JSON.stringify([dir, session]), 'utf8').toString('base64url')
}

function tokenMeta(token: string): { dir: string; session: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed)) return null
    const [dir, session] = parsed as unknown[]
    if (typeof dir !== 'string' || dir === '') return null
    return { dir, session: typeof session === 'string' ? session : '' }
  } catch { return null }
}

/**
 * 会话作用域准入 + 目标解析：把 client 传来的路径解析成一个**准入过的绝对路径**。
 *
 * 为什么准入与解析必须一起做（2026-10-05 修「点图片加载不出来」）：
 *  · client 传的是**产出物卡里那一行原样的字符串**，而 `present` / `write` 的参数
 *    常是相对路径（`深圳一日游_20261006/slide_01.png`）；
 *  · 索引里存的是**绝对路径**（提取时已按会话 cwd 解析）。
 * 旧实现直接 `resolve(raw)`：相对路径按 **host 进程的 cwd**（DSH 安装目录）解析，
 * 既不在索引里（403），就算放行也会 stat 到不存在的文件（404）。侧栏那条路走的是
 * 官方 workspaceFiles（相对路径相对**会话工作区**解析）所以正常 —— 两边基准不
 * 一致，用户看到的就是「点图片裂了，点侧栏按钮却能看」。
 *
 * 安全口径不变：仍然只认「被某个对话产出过」的路径，自由路径一律 null（403）。
 *
 * @param ctx - 插件上下文。
 * @param raw - query 里的 path（绝对或相对）。
 * @param sessionId - query 里的 session（产出物卡会带；画廊不带）。
 * @returns 准入过的绝对路径；不通过返回 null。
 */
async function admitRawPath(ctx: Context, raw: string, sessionId: string): Promise<string | null> {
  const absolute = isAbsolute(raw)
  const target = absolute ? resolve(raw) : null
  // 快路：绝对路径命中全局索引（画廊与产出物卡的主路），不必折任何会话。
  if (target !== null && isIndexed(target)) return target
  // 其余（绝对未命中 / 相对）都要看**这个会话自己产出过什么**。
  if (sessionId === '') return null
  const context = await sessionContextFor(readDeps(ctx), sessionId)
  // 顺带登记：用户可能从没开过画廊（全局索引为空），此时产出物卡点开图片 / 文档
  // 走的就是这条会话作用域路。office 预览路由的准入名单需要同一份结论。
  rememberOfficePaths(context.items.map((item) => item.path))
  return resolveAdmittedPath(raw, target, context)
}

/**
 * 准入判定的纯函数核心（导出给冒烟对拍，无 I/O、无 ctx）。
 *
 * @param raw - query 里的 path 原文。
 * @param absoluteTarget - raw 是绝对路径时的 resolve 结果；相对路径传 null。
 * @param context - 该会话的产出清单与工作区。
 * @returns 准入过的绝对路径；不属于该会话产出返回 null。
 */
export function resolveAdmittedPath(
  raw: string,
  absoluteTarget: string | null,
  context: SessionContext,
): string | null {
  const same = (a: string, b: string): boolean => galleryDedupeKey(a) === galleryDedupeKey(b)
  if (absoluteTarget !== null) {
    return context.items.some((item) => same(item.path, absoluteTarget)) ? absoluteTarget : null
  }
  /*
   * 相对路径：基准取**该会话自己的 cwd**，取不到就拒绝 —— 拿 host 进程 cwd 当
   * 基准会把路径指到 DSH 安装目录去，正是这次要修的错。
   */
  if (context.cwd === null || context.cwd === '') return null
  const target = resolve(context.cwd, raw)
  return context.items.some((item) => same(item.path, target)) ? target : null
}

async function handleRaw(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rejectForeign(req, res)) return
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const raw = url.searchParams.get('path') ?? ''
    if (raw === '') { json(res, 400, { ok: false, error: 'missing path' }); return }
    // 准入 + 解析一步做完：相对路径按**会话 cwd** 折绝对（见 admitRawPath）。
    const target = await admitRawPath(ctx, raw, url.searchParams.get('session') ?? '')
    if (target === null) {
      json(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    const ext = extname(target).toLowerCase()
    if (ext === '.html' || ext === '.htm' || ext === '.xhtml') {
      // html 成品：读出来注入 <base>（相对资源走 raw-asset），CSP sandbox 隔离。
      const info = statSync(target)
      if (info.size > 8 * 1024 * 1024) { json(res, 413, { ok: false, error: 'too large' }); return }
      const { readFile } = await import('node:fs/promises')
      let html = await readFile(target, 'utf8')
      const dir = target.slice(0, Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')))
      const base = `${ROUTE}/raw-asset/${htmlDirsToken(dir, url.searchParams.get('session') ?? '')}/`
      const baseTag = '<base href="' + base + '">'
      const headIdx = html.search(/<head[^>]*>/i)
      if (headIdx >= 0) {
        const insertAt = html.indexOf('>', headIdx) + 1
        html = html.slice(0, insertAt) + baseTag + html.slice(insertAt)
      } else {
        html = baseTag + html
      }
      const body = Buffer.from(html, 'utf8')
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(body.byteLength),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox allow-scripts allow-popups allow-forms allow-modals',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
      return
    }
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    sendFile(req, res, target, mime)
  } catch (error) {
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

async function handleRawAsset(ctx: Context, req: IncomingMessage, res: ServerResponse, tail: string): Promise<void> {
  if (rejectForeign(req, res)) return
  try {
    // tail = /raw-asset/<token>/<rel...>
    const body = tail.slice('/raw-asset/'.length)
    const slash = body.indexOf('/')
    if (slash <= 0) { json(res, 400, { ok: false, error: 'bad token' }); return }
    const token = body.slice(0, slash)
    const rel = decodeURIComponent(body.slice(slash + 1))
    const meta = tokenMeta(token)
    if (meta === null) { json(res, 403, { ok: false, error: 'forbidden' }); return }
    const { dir, session } = meta
    // 目录准入：必须是某个 html 成品的父目录（全局索引或 token 里的会话作用域）。
    let allowed = indexedHtmlDirs().has(galleryDedupeKey(dir))
    if (!allowed && session !== '') {
      const items = await sessionItemsFor(readDeps(ctx), session)
      allowed = htmlDirsOf(items).has(galleryDedupeKey(dir))
    }
    if (!allowed) { json(res, 403, { ok: false, error: 'forbidden' }); return }
    // rel 逐段校验：拒绝 ..、绝对段、控制字符与盘符。
    const segments = rel.split('/')
    for (const segment of segments) {
      if (segment === '' || segment === '.' || segment === '..') { json(res, 403, { ok: false, error: 'forbidden' }); return }
      if (segment.includes('\\') || /^[A-Za-z]:/.test(segment) || /[\u0000-\u001f]/.test(segment)) {
        json(res, 403, { ok: false, error: 'forbidden' }); return
      }
    }
    const target = resolve(join(dir, ...segments))
    // resolve 之后仍必须在目录内（防符号链接外的意外拼接）。
    const normalizedDir = resolve(dir)
    if (target !== normalizedDir && !target.startsWith(normalizedDir + sep)) {
      json(res, 403, { ok: false, error: 'forbidden' }); return
    }
    const ext = extname(target).toLowerCase()
    if (!ASSET_EXT_ALLOW.has(ext)) { json(res, 403, { ok: false, error: 'forbidden' }); return }
    sendFile(req, res, target, MIME_BY_EXT[ext] ?? 'application/octet-stream')
  } catch {
    json(res, 500, { ok: false, error: 'internal' })
  }
}

/* ── /delete：索引内产物的不可逆删除 ─────────────────────────────────── */

/** 单次请求接受的路径条数上限（分类删除的最大规模；也是请求体的护栏）。 */
const MAX_DELETE_PATHS = 2000

/** 请求体上限：2000 条 Windows 路径最坏约 200KB，给足余量到 1MB。 */
const MAX_DELETE_BODY_BYTES = 1024 * 1024

/** 逐条删除的失败原因（client 按它给提示，不另做文案映射）。 */
type DeleteFailureReason = 'not-indexed' | 'not-a-file' | 'missing' | `io:${string}`

interface DeleteFailure {
  readonly path: string
  readonly error: DeleteFailureReason
}

interface DeleteOutcome {
  /** 真的从磁盘删掉的条数。 */
  deleted: number
  /** 逐条失败原因（成功的条目不在里面）。 */
  failed: DeleteFailure[]
}

/**
 * 校验单条待删路径的**文件系统**准入（纯函数，导出给冒烟对拍，无 I/O 之外的副作用）。
 *
 * 判据只有一条但必须严：`lstatSync` 看到的东西必须是**普通文件**。
 *
 *  · 为什么是 `lstat` 不是 `stat`：`stat` 跟随符号链接，一个指向别处的链接会
 *    被当成普通文件放行，于是「删画廊里的一个格子」实际删掉了链路另一头的东西
 *    —— 这是删除放大。`lstat` 看的是链接本身，直接判拒。
 *  · 目录一律拒：不做递归、不吃目录前缀。传 `D:\out` 只会失败，绝不会连带
 *    删掉 `D:\out\a.png`（这是「保守优先」最核心的一条）。
 *  · 设备 / FIFO 同样不是普通文件，一并拒。
 *
 * 索引准入（isIndexed）不在这里判：它是**本进程内存态**，不属于纯函数职责，
 * 由调用方在进这个方法之前先过一遍（见 handleDelete）。
 *
 * @param path - 待删路径（已通过索引准入的绝对路径）。
 * @returns null = 放行；否则是失败原因。
 */
export function classifyDeleteTarget(path: string): DeleteFailureReason | null {
  let info
  try {
    info = lstatSync(path)
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    // 文件索引之后被别处删掉/改名：如实报 missing，不当成异常吞掉。
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
    return `io:${code === undefined ? String(error) : String(code)}`
  }
  if (info.isSymbolicLink() || !info.isFile()) return 'not-a-file'
  return null
}

/** 请求体读取（与记忆路由同款；超限直接拒，绝不无界缓存）。 */
function readJsonBody(req: IncomingMessage, limit = MAX_DELETE_BODY_BYTES): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        reject(new Error('empty body'))
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 解析并校验 `paths` 字段。
 *
 * 校验宁可严：非数组、空数组、超上限、含非字符串或空串一律整单拒绝（400）。
 * 半接受一份坏请求比拒绝更危险 —— 用户以为删了 10 个，实际只处理了前面几个。
 *
 * @returns 去重后的路径列表。
 */
export function parseDeletePaths(value: unknown): { paths: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'paths must be an array' }
  if (value.length === 0) return { error: 'paths must not be empty' }
  if (value.length > MAX_DELETE_PATHS) return { error: `too many paths (max ${MAX_DELETE_PATHS})` }
  const seen = new Set<string>()
  const paths: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') return { error: 'every path must be a non-empty string' }
    // 去重键与索引/准入同一套归一（分隔符 + 大小写）：同一路径传两次只删一次，
    // `deleted` 也只计一次。用原串去重会漏掉 `D:\A.PNG` 与 `d:/a.png` 这种同一文件。
    const key = galleryDedupeKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(entry)
  }
  return { paths }
}

/**
 * 逐条删除（每条独立 try/catch）。
 *
 * 一次删一个文件，用 `rm`（不带 recursive）—— 契约明确要求不做 rm -r。
 * 任何一条失败都如实回报，且**不影响其余条目**：用户点一次分类删除，不该因为
 * 其中一个文件被占用而整批失败。
 *
 * @param paths - 已解析、已去重的路径列表。
 * @returns 成功条数与逐条失败原因。
 */
async function deletePaths(paths: readonly string[]): Promise<DeleteOutcome> {
  let deleted = 0
  const failed: DeleteFailure[] = []
  for (const path of paths) {
    // ① 先过索引准入：只删本插件索引过的路径，自由路径一律拒。
    if (!isIndexed(path)) {
      failed.push({ path, error: 'not-indexed' })
      continue
    }
    // ② 再判文件系统形状（普通文件；链接/目录/设备全拒）。
    const reason = classifyDeleteTarget(path)
    if (reason !== null) {
      failed.push({ path, error: reason })
      continue
    }
    // ③ 真删。单条独立 try/catch：失败只记这一条。
    try {
      await rm(path)
      deleted += 1
      // ④ 成功才摘名单，让同一进程内 /raw 立刻拒绝这条路径。
      forgetIndexed(path)
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ path, error: `io:${code === undefined ? message : String(code)}` })
    }
  }
  return { deleted, failed }
}

/**
 * POST /delete：删除画廊索引内的产出物。
 *
 * 状态码与 body 见冻结契约 A2：业务成功/部分成功一律 200，`ok` 只在**没有**
 * failed 时为 true（client 据此提示部分失败），但已成功的条目仍然删掉了。
 * 403 / 405 / 400 / 500 分别对应 fence / 方法 / 请求体 / 未预期异常。
 */
async function handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 准入规则 1：与 /media、/raw 同款 loopback fence + Host 复核。放在最前面 ——
  // 这是唯一的写路由，非本机来源连"能删什么"都不该问出来。
  if (rejectForeign(req, res)) return
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method-not-allowed' })
    return
  }
  /*
   * 跨站复核（写路由专用，见 rejectCrossSiteWrite 的说明）。
   *
   * 顺序上必须**早于**读 body：跨站请求连请求体都不该被解析，更不该走到删除。
   * 与下面的 content-type 闸门构成纵深防御 —— 前者挡带 Origin 的浏览器跨站请求，
   * 后者挡「连 Origin 都没有」的简单请求（跨站设不了 application/json）。
   */
  if (rejectCrossSiteWrite(req, res)) return
  // content-type 闸门：跨站发不出 application/json，所以这一条就把 CORS 简单请求
  // 盲删的路堵死了（见 isJsonContentType 的说明）。
  if (!isJsonContentType(req.headers['content-type'])) {
    json(res, 400, {
      ok: false, error: 'bad-request',
      message: 'content-type must be application/json',
    })
    return
  }
  try {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (error) {
      json(res, 400, {
        ok: false, error: 'bad-request',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }
    const parsed = parseDeletePaths((body as { paths?: unknown } | null)?.paths)
    if ('error' in parsed) {
      json(res, 400, { ok: false, error: 'bad-request', message: parsed.error })
      return
    }
    const outcome = await deletePaths(parsed.paths)
    json(res, 200, {
      ok: outcome.failed.length === 0,
      deleted: outcome.deleted,
      failed: outcome.failed,
      remaining: indexedCount(),
    })
  } catch (error) {
    json(res, 500, {
      ok: false, error: 'internal',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/* ── 挂载 ────────────────────────────────────────────────────────────── */

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

/**
 * 挂载画廊路由 + 后台预热。
 *
 * 与 shot/triad 同款约定：调用方经 ctx.inject(['webServer', ...]) 延迟注入，
 * 本函数只在 webServer 已就绪的上下文里跑；路由注册走 webCtx.effect 回收。
 * @param ctx - webServer / sessions / sessionPersistence 可用的插件上下文。
 */
export function applyGallery(ctx: Context): void {
  /*
   * 先登记会话日志根目录，再预热。
   *
   * 顺序是关键（2026-10-05 踩到）：root 原先只在 `readDeps`（每次请求）里登记，
   * 而 `warmGallerySnapshot()` 在挂载时立刻跑 —— 那一刻 root 还是 null，老单文件
   * 缓存迁移时扫不到会话目录，于是「按 mtime 逐会话继承」的裁定全部落空，
   * 1464 个本该直接继承的旧会话被原样重折一遍（分钟级）。
   */
  readDeps(ctx)
  const webServer = (ctx as unknown as { webServer: WebServerService }).webServer
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const tail = url.pathname.slice(ROUTE.length)
      if (tail === '/media' || tail === '/media/') { void handleMediaAndIndex(ctx, req, res); return }
      if (tail === '/raw' || tail === '/raw/') { void handleRaw(ctx, req, res); return }
      if (tail.startsWith('/raw-asset/')) { void handleRawAsset(ctx, req, res, tail); return }
      // 删除走同一个 prefix handler，方法校验放在 handleDelete 里（路由层只认路径）。
      if (tail === '/delete' || tail === '/delete/') { void handleDelete(req, res); return }
      json(res, 404, { ok: false, error: 'unknown gallery endpoint' })
    },
  }), 'dsh-chat-plus: gallery routes')
  // 挂载即预热：把磁盘缓存渲染出来，第一个请求不空手（不碰会话日志）。
  void warmGallerySnapshot().catch((error: unknown) => {
    const logger = (ctx as unknown as { logger?: { warn?: (msg: string) => void } }).logger
    logger?.warn?.(`[dsh-chat-plus] gallery: 预热失败: ${String(error)}`)
  })
}

/** /media 的包装：响应前先刷新 /raw 的准入索引。 */
async function handleMediaAndIndex(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rejectForeign(req, res)) return
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const force = url.searchParams.get('refresh') === '1'
    const deps = readDeps(ctx)
    const collected = await collectGallery(deps, force)
    // generated 条目的核对要问「本服务能否读到」：spillStore 未就绪时退化成空
    // 集合 —— 那批条目会被剔除，宁可少列也不留空白格子。
    const activeRoot = (() => {
      try {
        const store = (ctx as unknown as { get?: (n: string) => unknown }).get?.('spillStore') as { root?: unknown } | undefined
        return typeof store?.root === 'string' ? store.root : null
      } catch { return null }
    })()
    const verified = verifyResponse(collected, spillRoots(activeRoot))
    rememberIndex(verified.items)
    json(res, 200, {
      ok: true,
      items: verified.items,
      sessions: verified.sessions,
      truncated: verified.truncated,
      stale: (collected as { stale?: boolean }).stale === true,
      generatedAt: verified.generatedAt,
      // 全局口径的未截断分类计数：不受 client 侧会话/时间/搜索筛选影响，
      // 芯片在无筛选时直接用它显示真实数字（见 verifyResponse 说明）。
      kindTotals: verified.kindTotals,
    })
  } catch (error) {
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 导出给冒烟：raw 准入索引与删除准入的可测面。
 *
 * 删除那条路**不导出执行体**（deletePaths 会真的动磁盘）：冒烟只对拍纯判据
 * （索引准入、文件形状判据、请求体解析），真实删除用临时文件走 HTTP 路由验。
 */
export const __test = {
  rememberIndex,
  isIndexed,
  forgetIndexed,
  indexedCount,
  htmlDirsToken,
  tokenMeta,
  resolveAdmittedPath,
  classifyDeleteTarget,
  parseDeletePaths,
  deletePaths,
  isJsonContentType,
  isCrossSiteWrite,
  verifyResponse,
}