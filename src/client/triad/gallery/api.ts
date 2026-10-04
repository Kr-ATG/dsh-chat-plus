/**
 * dsh-chat-plus — 多媒体画廊 client API（/api/triad/gallery/*，loopback 同源）。
 *
 * 与记忆 / 邮箱 / 用量同款纯 fetch 封装。两条约定：
 *  · 业务错误也走 HTTP 200 + { ok:false }，统一按 payload 判成败；
 *  · generated（生图/生视频）条目只有 spill 文件路径，b64 要再经既有的
 *    /api/chat-flow/generated-images 路由解析成可显示 URL —— 两步都封在这里。
 */

/** 展示类别（host GalleryKind 镜像）。 */
export type GalleryKind =
  | 'image' | 'video' | 'audio' | 'page' | 'pdf' | 'slide' | 'sheet' | 'doc'

/** 一条画廊条目（host VerifiedItem 镜像）。 */
export interface GalleryItem {
  readonly path: string
  readonly name: string
  readonly kind: GalleryKind
  /** file = 磁盘成品；generated = 生图/生视频（spill 文件，需二次解析）。 */
  readonly source: 'file' | 'generated'
  readonly time: number
  readonly size: number
  readonly sessionId: string
}

/** 一个有产出的会话。 */
export interface GallerySession {
  readonly id: string
  readonly title: string | null
  readonly cwd: string | null
  readonly count: number
  readonly lastTime: number
}

/** /media 响应。 */
export interface GalleryMediaResponse {
  readonly ok: boolean
  readonly items?: readonly GalleryItem[]
  readonly sessions?: readonly GallerySession[]
  readonly truncated?: boolean
  readonly stale?: boolean
  readonly error?: string
  readonly message?: string
}

/**
 * 拉取画廊清单（refresh=true 时 host 同步重折全部会话）。
 *
 * 非 JSON 响应（host 半身在旧服务进程里没挂载 → 404 纯文本）必须翻成人话：
 * res.json() 对 "not found" 直接抛 SyntaxError，面板会把解析错误原文糊在
 * 空态上 —— 用户看不懂，也指不出「重启 DSH 服务」这个真正的修复动作。
 */
export async function fetchGalleryMedia(refresh = false): Promise<GalleryMediaResponse> {
  const res = await fetch(`/api/triad/gallery/media${refresh ? '?refresh=1' : ''}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  })
  if (res.status === 404) {
    return { ok: false, error: 'not-mounted', message: '画廊服务未挂载：请重启 DSH 服务后再试（host 半身在服务启动时注册路由）。' }
  }
  if (!res.ok) {
    return { ok: false, error: 'http-' + String(res.status), message: `画廊请求失败（HTTP ${res.status}）` }
  }
  try {
    return await res.json() as GalleryMediaResponse
  } catch {
    return { ok: false, error: 'bad-response', message: '画廊响应不是合法 JSON。' }
  }
}

/** 磁盘成品的浏览器可显示地址（走画廊自己的 raw 路由：索引即白名单）。 */
export function galleryRawUrl(path: string): string {
  return `/api/triad/gallery/raw?path=${encodeURIComponent(path)}`
}

/**
 * 会话作用域的 raw 地址（产出物卡用）。
 *
 * 产出物卡打开 Lightbox 时用户可能从没开过画廊（全局索引没建），host 按
 * session 参数现折该会话的产出清单做准入 —— 只认这个会话自己产出过的路径。
 */
export function sessionRawUrl(path: string, sessionId: string): string {
  return `/api/triad/gallery/raw?path=${encodeURIComponent(path)}&session=${encodeURIComponent(sessionId)}`
}

/**
 * 解析一条 generated 条目：spill 文件 → 可显示 URL 列表（data: 或 http(s)）。
 * 复用既有的 /api/chat-flow/generated-images 路由（只认 spill root 内的 .txt）。
 * @returns URL 列表；解析失败返回空数组。
 */
export async function resolveGeneratedUrls(spillPath: string): Promise<readonly string[]> {
  try {
    const res = await fetch(`/api/chat-flow/generated-images?file=${encodeURIComponent(spillPath)}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    const payload = await res.json() as { ok?: boolean; urls?: unknown }
    if (payload.ok !== true || !Array.isArray(payload.urls)) return []
    return payload.urls.filter((url): url is string => typeof url === 'string' && url !== '')
  } catch {
    return []
  }
}

/** 类别 → 中文名（筛选器与徽标共用）。 */
export const KIND_LABEL: Readonly<Record<GalleryKind, string>> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  page: '网页',
  pdf: 'PDF',
  slide: '演示',
  sheet: '表格',
  doc: '文档',
}

/** 字节数 → 人类可读。 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 时间戳 → 相对时间（分钟内 / 小时内 / 天内 / 日期）。 */
export function formatRelativeTime(time: number, now = Date.now()): string {
  if (!Number.isFinite(time) || time <= 0) return ''
  const diff = Math.max(0, now - time)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
