/**
 * dsh-chat-plus — 本地 HTTP 路由的跨站闸门（host 半身共用）。
 *
 * ## 为什么必须有这一层（2026-10-17 安全审计）
 *
 * DSH 的 webServer 是 **longest-prefix-wins** 派发：插件注册的
 * `/api/chat-flow/screenshot`、`/api/dsh-memory` 等前缀都比官方 `/api` 长，
 * 于是官方 handler 里那道 `connection.requestRejection(req)`（含 Origin /
 * sec-fetch-site 校验）**根本不执行**。插件路由等于站在官方鉴权之外，必须自己
 * 补一道来源校验 —— 否则任意网页一个 CORS 简单请求就能盲调。
 *
 * 实测（修复前）：恶意页面 `text/plain` POST /api/chat-flow/screenshot/render
 * 可以往带 `--disable-web-security` 的无头 Chrome 里塞任意 HTML，读本机文件外传。
 *
 * ## 判据（既不漏也不误伤）
 *
 * 只拒两种「明确跨站」的形态，其余一律放行：
 *
 *  1. `sec-fetch-site: cross-site` —— 浏览器自己标的跨站，最可靠。
 *     同源是 `same-origin`、同站不同端口是 `same-site`，都放行。
 *  2. `origin` 存在且与 `host` **不同主机名** —— 精确比对。
 *     `origin: null`（sandbox iframe / file://）视为非法。
 *
 * **刻意不判**「Origin 必须是 loopback」：那种判据会把 `http://192.168.x.x:3080`
 * （手机远程配对 / 局域网访问）一起拒掉，属于拿可用性换安全。同源比对对任何 host
 * 都成立，不必假设客户端在 loopback。
 *
 * **Origin 缺失不能拒**：同源 `<img>` / EventSource / curl / 本机脚本都不带
 * Origin，缺失是正常形态。把缺失当非法会让截图图片、诊断脚本直接不可用。
 *
 * **端口怎么比**：Host 头带端口时要求与 Origin 端口一致；不带端口时只比主机名
 * （部署在 https 反代后面时 Host 常无端口，硬比端口会误伤正常访问；而攻击者无法
 * 伪造 Origin —— 浏览器控制这个头，主机名相同已足够强）。
 *
 * 口径与 `src/triad/gallery/index.ts` 的 `isCrossSiteWrite` 同源（那边更严，
 * 额外要求 loopback）；本模块是给没有既有闸门的路由族补的最小实现。
 */

/** 取请求头第一个非空值（Node 可能给 string | string[]）。 */
function headerValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

/**
 * `host` / `origin` 里的主机名归一化：去端口、去尾点、小写。
 * @param value - 形如 `127.0.0.1:3080` / `[::1]:3080` / `Example.COM`。
 * @returns 主机名；无法解析返回 null。
 */
export function hostNameOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host === '') return null
  // IPv6 字面量：[::1]:3080
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  // 多个冒号且不是 [..] 包裹 → 裸 IPv6，原样返回。
  if (firstColon !== lastColon) return host
  const name = firstColon === -1 ? host : host.slice(0, firstColon)
  return name.replace(/\.$/, '') || null
}

/**
 * Host 头里显式写出的端口（没有则 null）。
 * @param rawHost - `req.headers.host` 原值。
 * @returns 端口串，或 null（无端口 / 解析不出）。
 */
function explicitPortOf(rawHost: string | null): string | null {
  if (rawHost === null) return null
  const idx = rawHost.lastIndexOf(':')
  if (idx === -1) return null
  const port = rawHost.slice(idx + 1)
  return /^\d+$/.test(port) ? port : null
}

/**
 * 判定一个请求是否为「明确跨站」（纯函数，导出给 smoke 对拍）。
 *
 * @param headers - `req.headers`。
 * @returns true = 跨站，调用方应回 403。
 */
export function isCrossSiteRequest(headers: Record<string, unknown> | undefined): boolean {
  if (headers === undefined) return false

  // ① 浏览器标注的跨站：最可靠的一道，优先。
  const site = headerValue(headers['sec-fetch-site'])
  if (site !== null && site.trim().toLowerCase() === 'cross-site') return true

  // ② Origin 存在时做同主机名比对（缺失 = 非浏览器发起，放行）。
  const rawOrigin = headerValue(headers['origin'])
  if (rawOrigin === null || rawOrigin.trim() === '') return false
  const origin = rawOrigin.trim()
  // sandbox iframe / file:// / 重定向后：浏览器发的不透明来源，一律拒。
  if (origin === 'null') return true

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return true
  }
  // 非 http(s) 的 Origin（chrome-extension:// 等）不是本服务的来源。
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true

  const originHost = hostNameOf(parsed.host)
  const rawHost = headerValue(headers['host'])
  const hostHost = hostNameOf(rawHost)
  // 没有 Host 头就无从比对：只接受来源主机名本身是 loopback。
  if (hostHost === null) {
    return !(originHost === 'localhost' || originHost === '127.0.0.1' || originHost === '::1')
  }
  if (originHost === null || originHost !== hostHost) return true

  // 主机名相同：Host 头带了端口才继续比（见文件头「端口怎么比」）。
  const hostPort = explicitPortOf(rawHost)
  if (hostPort === null) return false
  const originPort = parsed.port !== '' ? parsed.port : (parsed.protocol === 'https:' ? '443' : '80')
  return originPort !== hostPort
}

/** JSON 403（各路由族的 json 助手签名不完全一致，这里只做最小集合）。 */
type JsonResponder = (status: number, payload: Record<string, unknown>) => void

/**
 * 跨站就直接拒绝并返回 true，否则返回 false。
 *
 * 用法（每个路由 handler 的第一句）：
 *
 *     if (rejectCrossSite(req, json)) return
 *
 * @param headers - `req.headers`。
 * @param json - 该路由族自己的 JSON 响应助手。
 * @returns true = 已写出 403，调用方应立刻 return。
 */
export function rejectCrossSite(
  headers: Record<string, unknown> | undefined,
  json: JsonResponder,
): boolean {
  if (!isCrossSiteRequest(headers)) return false
  json(403, { ok: false, error: 'forbidden', reason: 'cross-site request' })
  return true
}

/** 导出给冒烟对拍。 */
export const __test = { headerValue, explicitPortOf, hostNameOf }
