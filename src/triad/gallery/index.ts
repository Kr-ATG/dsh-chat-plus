/**
 * dsh-chat-plus — 多媒体画廊 host 半身：路由挂载 + 存在性核对 + 页面资源服务。
 *
 * 三条路由，前缀 /api/triad/gallery（与 dsh-triad 融合模块同前缀，用户零迁移）：
 *
 *   GET /media      — 全部会话的产出物清单（条目 + 会话侧栏 + stale 标记）
 *   GET /raw        — 单文件字节服务（**只服务画廊索引里登记过的路径**）
 *   GET /raw-asset/ — html 成品的同目录渲染资源（css/js/图/字体，token 目录）
 *
 * 安全边界（这条路由族等于「读本机任意已产出文件」的能力，必须收窄）：
 *  · loopback fence（peer socket 地址判据，与 usage-skill 同款）+ Host 头复核；
 *  · /raw 只认**画廊索引内的路径**：索引来自会话事件日志的产出物提取，
 *    不是用户可控的自由列表 —— 没被任何对话产出过的文件一个字节都读不到；
 *  · /raw-asset 的目录必须是某个 html 成品的父目录（token = base64url(目录)），
 *    扩展名走渲染白名单（刻意不含 txt/json/csv/map —— 预览页面不该顺带把
 *    同目录的笔记与数据文件变成可读），rel 路径逐段校验拒绝 .. 与绝对段；
 *  · html 响应带 CSP sandbox（允许脚本但不允许同源），iframe 侧再套
 *    sandbox 属性（不给 allow-same-origin）—— 成品页读不到宿主 cookie。
 *
 * /media 的 stat 核对：渲染响应时对每个磁盘条目做一次 statSync，确认不存在的
 * 直接不列（这张画廊的全部价值是「点一下就看见」）；generated（spill）条目
 * 同样核对 .txt 是否还在（30 天保留期过了就消失）。核对结果随聚合缓存
 * （TTL 15s），不会每请求全量重扫磁盘。
 */

import { statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { collectGallery, sessionItemsFor, warmGallerySnapshot, type GalleryItemView, type GalleryResponse } from './store.ts'
import { galleryDedupeKey } from './extract.ts'

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

interface VerifiedResponse extends Omit<GalleryResponse, 'items'> {
  readonly items: readonly VerifiedItem[]
  readonly generatedAt: number
}

/**
 * 对渲染结果做一次存在性核对（statSync，逐个 try/catch）。
 * 确认不存在的条目直接剔除 —— 与产出物卡「只列磁盘上真实存在的文件」同口径。
 */
function verifyResponse(response: GalleryResponse): VerifiedResponse {
  const items: VerifiedItem[] = []
  const sessionCounts = new Map<string, number>()
  for (const item of response.items) {
    try {
      const info = statSync(item.path)
      if (!info.isFile() || info.size <= 0) continue
      items.push({ ...item, size: info.size })
      sessionCounts.set(item.sessionId, (sessionCounts.get(item.sessionId) ?? 0) + 1)
    } catch { /* 不存在 / 无权限：不列 */ }
  }
  const sessions = response.sessions
    .map((entry) => ({ ...entry, count: sessionCounts.get(entry.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
  return { ...response, items, sessions, generatedAt: Date.now() }
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
  return { sessions, persistence, logger }
}

/* ── /raw 与 /raw-asset：画廊索引即白名单 ─────────────────────────────── */

/** 最近一次聚合的索引（去重键 → 条目），/raw 的准入名单。 */
let lastIndex: Map<string, VerifiedItem> | null = null

function rememberIndex(items: readonly VerifiedItem[]): void {
  const index = new Map<string, VerifiedItem>()
  for (const item of items) index.set(galleryDedupeKey(item.path), item)
  lastIndex = index
}

function isIndexed(path: string): boolean {
  return lastIndex !== null && lastIndex.has(galleryDedupeKey(path))
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
 * 会话作用域准入：路径是否被**指定会话**产出过。
 *
 * 产出物卡（右栏）的 Lightbox 也走 /raw，但用户可能从没开过画廊（全局索引
 * 还没建）。带 session 参数时按该会话现折一份清单（store.sessionItemsFor，
 * 带缓存）比对 —— 与全局索引同一套提取规则，安全口径不变：仍然只认「被某个
 * 对话产出过」的路径，自由路径一律 403。
 */
async function isSessionOutput(ctx: Context, target: string, sessionId: string): Promise<boolean> {
  if (sessionId === '') return false
  const items = await sessionItemsFor(readDeps(ctx), sessionId)
  const key = galleryDedupeKey(target)
  return items.some((item) => galleryDedupeKey(item.path) === key)
}

async function handleRaw(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rejectForeign(req, res)) return
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const raw = url.searchParams.get('path') ?? ''
    if (raw === '') { json(res, 400, { ok: false, error: 'missing path' }); return }
    const target = resolve(raw)
    // 准入：全局画廊索引，或 session 参数指定的会话自己的产出。
    if (!isIndexed(target) && !await isSessionOutput(ctx, target, url.searchParams.get('session') ?? '')) {
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
    const verified = verifyResponse(collected)
    rememberIndex(verified.items)
    json(res, 200, {
      ok: true,
      items: verified.items,
      sessions: verified.sessions,
      truncated: verified.truncated,
      stale: (collected as { stale?: boolean }).stale === true,
      generatedAt: verified.generatedAt,
    })
  } catch (error) {
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

/** 导出给冒烟：raw 准入索引的可测面。 */
export const __test = { rememberIndex, isIndexed, htmlDirsToken, tokenMeta }
