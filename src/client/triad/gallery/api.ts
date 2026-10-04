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

/* ── 时间范围：预设筛选 + 搜索词里的时间表达 ──────────────────────────── */

/** 一个闭-开时间区间 [from, to)。 */
export interface TimeRange {
  readonly from: number
  readonly to: number
  readonly label: string
}

/** 时间预设 id（'all' 之外都对应一个 TimeRange）。 */
export type TimePresetId =
  | 'all' | 'today' | 'yesterday' | 'last7' | 'last30'
  | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom'

/** 预设 → 中文名（chips 与弹层共用）。 */
export const TIME_PRESET_LABEL: Readonly<Record<Exclude<TimePresetId, 'custom'>, string>> = {
  all: '全部时间',
  today: '今天',
  yesterday: '昨天',
  last7: '近 7 天',
  last30: '近 30 天',
  thisWeek: '本周',
  thisMonth: '本月',
  lastMonth: '上月',
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/** 本周一 00:00（周一为一周之首）。 */
function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  const weekday = (day.getDay() + 6) % 7
  day.setDate(day.getDate() - weekday)
  return day
}

/** 预设 id → 区间（custom 由调用方自带，这里不处理）。 */
export function presetRange(id: Exclude<TimePresetId, 'custom'>, now = Date.now()): TimeRange {
  const today = startOfDay(new Date(now))
  const dayMs = 86_400_000
  switch (id) {
    case 'today':
      return { from: today.getTime(), to: now + 1000, label: TIME_PRESET_LABEL.today }
    case 'yesterday':
      return { from: today.getTime() - dayMs, to: today.getTime(), label: TIME_PRESET_LABEL.yesterday }
    case 'last7':
      return { from: today.getTime() - 6 * dayMs, to: now + 1000, label: TIME_PRESET_LABEL.last7 }
    case 'last30':
      return { from: today.getTime() - 29 * dayMs, to: now + 1000, label: TIME_PRESET_LABEL.last30 }
    case 'thisWeek': {
      const from = startOfWeek(new Date(now)).getTime()
      return { from, to: now + 1000, label: TIME_PRESET_LABEL.thisWeek }
    }
    case 'thisMonth': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1).getTime()
      return { from, to: now + 1000, label: TIME_PRESET_LABEL.thisMonth }
    }
    case 'lastMonth': {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime()
      const to = new Date(today.getFullYear(), today.getMonth(), 1).getTime()
      return { from, to, label: TIME_PRESET_LABEL.lastMonth }
    }
    default:
      return { from: 0, to: Number.MAX_SAFE_INTEGER, label: TIME_PRESET_LABEL.all }
  }
}

/**
 * 把搜索框里的时间表达解析成区间（时间搜索）。
 *
 * 认的说法：今天/昨天/前天、本周/上周、本月/上月（含「这个月」等变体）、
 * 「最近N天 / 近N天 / N天内 / 最近N小时」、具体日期（2026-10-01、2026/10/1、
 * 10-01、2026年10月1日）、具体月份（2026-10、2026年10月、10月）。
 * 解析不出来返回 null（调用方回落普通文本匹配）。
 */
export function parseTimeQuery(raw: string, now = Date.now()): TimeRange | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (text === '') return null
  const today = startOfDay(new Date(now))
  const dayMs = 86_400_000
  const tomorrow = today.getTime() + dayMs

  const named: ReadonlyArray<readonly [RegExp, TimeRange]> = [
    [/^(今天|今日|当天)$/, { from: today.getTime(), to: now + 1000, label: '今天' }],
    [/^(昨天|昨日)$/, { from: today.getTime() - dayMs, to: today.getTime(), label: '昨天' }],
    [/^前天$/, { from: today.getTime() - 2 * dayMs, to: today.getTime() - dayMs, label: '前天' }],
    [/^(本周|这周|这个星期|本星期)$/, (() => {
      const from = startOfWeek(new Date(now)).getTime()
      return { from, to: now + 1000, label: '本周' }
    })()],
    [/^(上周|上个星期|上星期)$/, (() => {
      const thisWeek = startOfWeek(new Date(now)).getTime()
      return { from: thisWeek - 7 * dayMs, to: thisWeek, label: '上周' }
    })()],
    [/^(本月|这个月|本月份)$/, {
      from: new Date(today.getFullYear(), today.getMonth(), 1).getTime(),
      to: now + 1000, label: '本月',
    }],
    [/^(上月|上个月)$/, {
      from: new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime(),
      to: new Date(today.getFullYear(), today.getMonth(), 1).getTime(), label: '上月',
    }],
  ]
  for (const [pattern, range] of named) {
    if (pattern.test(text)) return range
  }

  // 相对区间：最近/近/过去 N 天，N 天内，N 小时。
  const relDay = /^(?:最近|近|过去)?(\d{1,3})(?:天|日)(?:之?内)?$/.exec(text)
  if (relDay !== null) {
    const days = Math.max(1, Number(relDay[1]))
    return { from: today.getTime() - (days - 1) * dayMs, to: now + 1000, label: `近 ${days} 天` }
  }
  const relHour = /^(?:最近|近|过去)(\d{1,3})(?:小时|个小时|时)(?:之?内)?$/.exec(text)
  if (relHour !== null) {
    const hours = Math.max(1, Number(relHour[1]))
    return { from: now - hours * 3_600_000, to: now + 1000, label: `近 ${hours} 小时` }
  }

  // 具体日期：2026-10-01 / 2026/10/1 / 2026年10月1日 / 10-01（当年）。
  const fullDate = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(text)
  if (fullDate !== null) {
    const from = new Date(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3])).getTime()
    if (Number.isFinite(from)) return { from, to: from + dayMs, label: `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}` }
  }
  const shortDate = /^(\d{1,2})[-/](\d{1,2})$/.exec(text)
  if (shortDate !== null) {
    const month = Number(shortDate[1])
    const day = Number(shortDate[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = today.getFullYear()
      const from = new Date(year, month - 1, day).getTime()
      return { from, to: from + dayMs, label: `${year}-${month}-${day}` }
    }
  }

  // 月份：2026-10 / 2026/10 / 2026年10月 / 10月（当年）。
  const fullMonth = /^(\d{4})[-/年](\d{1,2})月?$/.exec(text)
  if (fullMonth !== null) {
    const year = Number(fullMonth[1])
    const month = Number(fullMonth[2])
    if (month >= 1 && month <= 12) {
      return {
        from: new Date(year, month - 1, 1).getTime(),
        to: new Date(year, month, 1).getTime(),
        label: `${year} 年 ${month} 月`,
      }
    }
  }
  const shortMonth = /^(\d{1,2})月$/.exec(text)
  if (shortMonth !== null) {
    const month = Number(shortMonth[1])
    if (month >= 1 && month <= 12) {
      const year = today.getFullYear()
      return {
        from: new Date(year, month - 1, 1).getTime(),
        to: new Date(year, month, 1).getTime(),
        label: `${year} 年 ${month} 月`,
      }
    }
  }
  return null
}

/** 条目时间是否落在区间内。 */
export function inTimeRange(time: number, range: TimeRange): boolean {
  return time >= range.from && time < range.to
}

/* ── 时间轴分组 ─────────────────────────────────────────────────────── */

/** 时间戳 → 本地日期键（YYYY-MM-DD）。 */
export function dayKeyOf(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 日期键 → 人话标题（今天 / 昨天 / 10月2日 / 2025年9月28日）。 */
export function dayLabelOf(key: string, now = Date.now()): string {
  const todayKey = dayKeyOf(now)
  const yesterdayKey = dayKeyOf(now - 86_400_000)
  if (key === todayKey) return '今天'
  if (key === yesterdayKey) return '昨天'
  const [year, month, day] = key.split('-')
  if (year === todayKey.slice(0, 4)) return `${Number(month)}月${Number(day)}日`
  return `${year}年${Number(month)}月${Number(day)}日`
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
