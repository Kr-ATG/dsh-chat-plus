/**
 * dsh-chat-plus — 多媒体画廊面板（工作台第五个 Tab）。
 *
 * 回答一个问题：**所有对话产出过的图片 / 网页 / 演示 / 文档，在哪儿一次看全。**
 *
 * 布局：工具条（类别 chips + 时间筛选 + 搜索 + 视图切换 + 刷新）→ 筛选条
 * （会话 / 时间，选中时出现）→ 卡片网格或时间轴 → Lightbox。
 *
 * 时间能力（2026-10-04 增补）：
 *  · 时间轴视图 —— 按天分组，左侧竖轨 + 日期钉住头，卡片仍走同一张 GalleryCard；
 *  · 时间筛选 —— 工具条时钟钮弹预设（今天/昨天/近7天/近30天/本周/本月/上月）
 *    或自定义起止日期；
 *  · 时间搜索 —— 搜索框直接输入时间表达（「昨天」「最近30天」「2026-10-01」
 *    「10月」…），parseTimeQuery 认出来就按时间过滤而不是按文本。数据来自 host 的 /api/triad/gallery/media（跨会话
 * 增量折叠，stat 核对过才下发）；generated（生图/生视频）条目经既有的
 * /api/chat-flow/generated-images 二次解析成可显示 URL。
 *
 * 三类内容的两种打开方式（2026-10-06 收口为「一律弹窗内预览」）：
 *  · 图片 / 视频 / 音频 / 网页 → Lightbox 内直接预览（网页走沙箱 iframe，
 *    host 已注入 base 与 CSP sandbox，成品页读不到宿主同源状态）；
 *  · PDF → Lightbox 内嵌插件自己的 /office/pdf（真 PDF，浏览器查看器）；
 *  · PPT / Word / Excel → Lightbox 内由 host 出页图并翻页。
 *
 *  为什么原来这三类走「打开官方右栏」：那时假设官方文档预览可用。实测在本机
 *  官方那条 Office 链路是坏的（LibreOffice 转换写盘被沙箱拒，报 impl_store
 *  failed），于是画廊里点一个 ppt 的结果是「面板关了、右栏弹一条转换失败」。
 *  现在改成插件自己出页图，同一套准入口径，也不再依赖宿主侧 TEMP 的权限状况。
 *
 *  缩略图（同为 2026-10-06）：html / ppt / word / pdf 的卡片此前只有一枚类型
 *  图标 —— 一整屏长得一样的占位图，认不出哪张是哪张。现在经 host 的
 *  /office/thumb 取首页位图当缩略图（html 走无头浏览器截首屏，文档走
 *  LibreOffice / PDFium 栅格化），失败时回落原来的类型图标。
 *
 * 动效（渐进式微调，不推翻工作台既有骨架）：卡片入场级联上浮、hover 浮起 +
 * 缩略图缓推、类别徽标下滑浮现、骨架屏微光、Lightbox 缩放入场与关闭钮旋转、
 * 刷新图标旋转。全部尊重 prefers-reduced-motion（样式表里统一关）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  dayKeyOf,
  dayLabelOf,
  displayNameOf,
  fetchGalleryMedia,
  formatRelativeTime,
  formatSize,
  galleryRawUrl,
  inTimeRange,
  KIND_LABEL,
  officeRenderable,
  parseTimeQuery,
  presetRange,
  previewThumbUrl,
  resolveGeneratedUrls,
  TIME_PRESET_LABEL,
  type GalleryItem,
  type GalleryKind,
  type GallerySession,
  type TimePresetId,
  type TimeRange,
} from './api.js'
import { ensureGalleryStyles } from './styles.js'
import { generatedUrlCache, canInlinePreview, MediaLightbox } from './media-lightbox.js'
import { tryOpenInSidebar } from '../../open-preview.js'
import { getClientCtx } from '../../client-ctx.js'

/** 类别 chips 的展示顺序（全部之后，按产出频率排）。 */
const KIND_ORDER: readonly GalleryKind[] = ['image', 'page', 'video', 'pdf', 'slide', 'sheet', 'doc', 'audio']

/** 筛选状态：当前选中的分类。 */
type KindFilter = GalleryKind

/** 视图形态：网格 / 时间轴。 */
type ViewMode = 'grid' | 'timeline'

/** 时间轴的一天分组。 */
interface DayGroup {
  readonly key: string
  readonly label: string
  readonly weekday: string
  readonly items: readonly GalleryItem[]
}

const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 按天分组（items 已由 host 时间降序，分组保持顺序）。 */
function groupByDay(items: readonly GalleryItem[], now: number): readonly DayGroup[] {
  const groups: DayGroup[] = []
  const byKey = new Map<string, GalleryItem[]>()
  for (const item of items) {
    const key = dayKeyOf(item.time)
    let bucket = byKey.get(key)
    if (bucket === undefined) {
      bucket = []
      byKey.set(key, bucket)
      groups.push({
        key,
        label: dayLabelOf(key, now),
        weekday: WEEKDAY_LABEL[new Date(item.time).getDay()] ?? '',
        items: bucket,
      })
    }
    bucket.push(item)
  }
  return groups
}

/** YYYY-MM-DD（date input 的 value 形状，本地时区）。 */
function toDateInputValue(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 相对时间要跟着走：每 30s 触发一次重渲染（与 tool-summary 的 use-now 同思路）。 */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, intervalMs)
    return () => { window.clearInterval(timer) }
  }, [intervalMs])
  return now
}

/* ── 图标 ────────────────────────────────────────────────────────────── */

const svgProps = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
} as const

/** 类别大图标（缩略图占位，64px 框内）。 */
function KindIcon({ kind, size = 44 }: { readonly kind: GalleryKind; readonly size?: number }): JSX.Element {
  const common = { width: size, height: size, viewBox: '0 0 48 48', ...svgProps }
  switch (kind) {
    case 'image':
      return (
        <svg {...common}>
          <rect x="6" y="10" width="36" height="28" rx="4" />
          <circle cx="17" cy="20" r="3" />
          <path d="M8 34l9-9 6 5.5 5-4.5 12 10" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="6" y="10" width="36" height="28" rx="4" />
          <path d="M20 18.5v11l9.5-5.5z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'audio':
      return (
        <svg {...common}>
          <rect x="6" y="10" width="36" height="28" rx="4" />
          <path d="M16 20v8M24 16v16M32 22v4" strokeWidth="2.4" />
        </svg>
      )
    case 'page':
      return (
        <svg {...common}>
          <rect x="6" y="10" width="36" height="28" rx="4" />
          <path d="M6 18h36" />
          <circle cx="11.5" cy="14" r="1.2" fill="currentColor" stroke="none" />
          <path d="M12 24h14M12 30h22" />
        </svg>
      )
    case 'pdf':
      return (
        <svg {...common}>
          <path d="M12 6h16l8 8v28H12z" />
          <path d="M28 6v8h8" />
          <path d="M12 30h24" strokeWidth="3" />
        </svg>
      )
    case 'slide':
      return (
        <svg {...common}>
          <rect x="8" y="10" width="32" height="22" rx="3" />
          <path d="M24 32v6M18 42h12" />
          <path d="M21 17v8l7.5-4z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'sheet':
      return (
        <svg {...common}>
          <rect x="8" y="10" width="32" height="28" rx="3" />
          <path d="M8 19h32M8 28h32M19 10v28M30 10v28" />
        </svg>
      )
    case 'doc':
      return (
        <svg {...common}>
          <path d="M12 6h16l8 8v28H12z" />
          <path d="M28 6v8h8" />
          <path d="M18 24h12M18 30h9" />
        </svg>
      )
    default:
      return <svg {...common}><rect x="8" y="8" width="32" height="32" rx="4" /></svg>
  }
}

/** 播放角标（视频 / 音频缩略图上）。 */
function PlayBadge(): JSX.Element {
  return (
    <span className="tg-card__play">
      <svg width="42" height="42" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="17" fill="rgba(10,11,15,.62)" stroke="rgba(255,255,255,.5)" strokeWidth="1.4" />
        <path d="M19.5 16.5v15L33 24z" fill="#fff" />
      </svg>
    </span>
  )
}

/** 分类切换微图标。 */
function KindTabIcon({ kind, size = 18 }: { readonly kind: GalleryKind; readonly size?: number }): JSX.Element {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (kind) {
    case 'image':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      )
    case 'page':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      )
    case 'pdf':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      )
    case 'slide':
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      )
    case 'sheet':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
        </svg>
      )
    case 'doc':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
      )
    case 'audio':
      return (
        <svg {...common}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      )
  }
}

/* ── 缩略图降采样（滚动性能的关键）────────────────────────────────────── */

/**
 * 把已加载的全分辨率原图换成「显示尺寸 × DPR」的小 bitmap。
 *
 * 根因：画廊缩略图直接挂原图（实测 67 张合计 178MP、单张最大 27MP），解码后
 * 纹理内存约 700MB，滚动时 GPU 瓦片缓存被挤出、反复重光栅 —— 帧率从 98 掉到 40。
 * createImageBitmap 的 resize 是浏览器原生解码+缩放（编解码线程，不占主线程），
 * 换源后元素只持有小 bitmap（67 张约 30MB），滚动恢复满帧。
 * 全分辨率解码仍是一次性的（loading=lazy 控制在视口附近），SVG 等不支持
 * createImageBitmap 的来源静默保留原图。
 */
function shrinkThumbToDisplaySize(img: HTMLImageElement): void {
  if (img.dataset.shrunk === '1') return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const target = Math.round((img.clientWidth || 200) * dpr) + 8
  if (!Number.isFinite(target) || target <= 0) return
  if (img.naturalWidth <= target && img.naturalHeight <= target) { img.dataset.shrunk = '1'; return }
  if (typeof createImageBitmap !== 'function') { img.dataset.shrunk = '1'; return }
  img.dataset.shrunk = '1'
  void createImageBitmap(img, { resizeWidth: target, resizeQuality: 'medium' })
    .then((bitmap) => {
      const ratio = bitmap.height / bitmap.width
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = Math.max(1, Math.round(bitmap.width * ratio))
      const context = canvas.getContext('2d')
      if (context === null) { bitmap.close(); return }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      canvas.toBlob((blob) => {
        if (blob === null || !img.isConnected) return
        img.src = URL.createObjectURL(blob)
      }, 'image/png')
    })
    .catch(() => { /* 保留原图：降采样失败不影响显示 */ })
}

/* ── generated 缩略图（spill 懒解析）──────────────────────────────────── */

/**
 * 生图/生视频条目的缩略图：spill 文件 2~9MB，不能首屏全解析 ——
 * IntersectionObserver 进视口才请求，解析结果进共享缓存
 * （media-lightbox 的 generatedUrlCache，Lightbox 打开时秒回）。
 *
 * 解析失败（spill 被清理 / 内容不是生图结果 / 读取被拒）**整卡隐藏**，由
 * `onUnresolvable` 上报路径、面板把它从清单里剔掉（2026-10-06 用户点名：
 * 「不存在的文件就不要显示了」）。原来失败时画一枚类型图标占位，结果就是
 * 一整排点开什么都没有的空白格子 —— 比不显示更误导：它承诺了内容却没有。
 * 隐藏是唯一诚实的口径，与 host 侧「列出的条目必须读得到」同一条原则。
 */
function GeneratedThumb({ path, alt, thumbClass = 'tg-card__thumb', onUnresolvable }: {
  readonly path: string
  readonly alt: string
  readonly thumbClass?: string
  readonly onUnresolvable?: (path: string) => void
}): JSX.Element {
  const [urls, setUrls] = useState<readonly string[]>(() => generatedUrlCache.get(path) ?? [])
  const [failed, setFailed] = useState(false)
  const holderRef = useRef<HTMLDivElement | null>(null)
  const reportedRef = useRef(false)

  useEffect(() => {
    // 缓存只认**非空**结果：空数组是「这次没解析出来」，不是「以后也解析不出」。
    // 旧实现把失败也写进缓存，于是服务端修好（比如 spill 准入放宽）之后客户端
    // 命中空缓存直接 return、一个请求都不发 —— 14 张生图永远停在空白格子。
    const cached = generatedUrlCache.get(path)
    if (cached !== undefined && cached.length > 0) { setUrls(cached); return undefined }
    const holder = holderRef.current
    if (holder === null || typeof IntersectionObserver === 'undefined') {
      void load()
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void load()
    }, { rootMargin: '240px' })
    observer.observe(holder)
    return () => { observer.disconnect() }

    async function load(): Promise<void> {
      const resolved = await resolveGeneratedUrls(path)
      // 只有成功才写共享缓存（Lightbox 打开时秒回）；失败不写，下次进视口重试。
      if (resolved.length > 0) generatedUrlCache.set(path, resolved)
      if (resolved.length === 0) {
        setFailed(true)
        // 只上报一次：state 更新会重渲染，重复上报会让父组件的 Set 反复重建。
        if (!reportedRef.current) {
          reportedRef.current = true
          onUnresolvable?.(path)
        }
      } else {
        setUrls(resolved)
      }
    }
  }, [path, onUnresolvable])

  if (failed) {
    // 隐藏由父组件完成（从清单里剔除）；这里只留一个零尺寸占位，避免
    // 「先画图标再消失」的闪动 —— 剔除发生在同一次渲染周期内。
    return <div ref={holderRef} className={thumbClass} data-unresolvable="true" />
  }
  const first = urls[0]
  if (first === undefined) {
    // 解析中：占位图标 + 微光（骨架屏同款动画由 thumb 底色承担）。
    return (
      <div ref={holderRef} className={thumbClass}>
        <span className="tg-card__icon" style={{ opacity: 0.45 }}><KindIcon kind="image" size={40} /></span>
      </div>
    )
  }
  return (
    <div ref={holderRef} className={thumbClass}>
      <img className="tg-card__img" src={first} alt={alt} loading="lazy" decoding="async" data-loaded="true" draggable={false} onLoad={(event) => { shrinkThumbToDisplaySize(event.currentTarget) }} />
      {urls.length > 1 && <span className="tg-card__kind-dot">{urls.length} 张</span>}
    </div>
  )
}

/* ── 卡片 ────────────────────────────────────────────────────────────── */

/**
 * 走服务端「首页位图」当缩略图的类别（html 截首屏 / 文档首页栅格化）。
 *
 * `page`（html 成品）与 `pdf` 直接放行；Office 三类再叠一层扩展名判据
 * （`officeRenderable`）—— `sheet` 里的 csv / tsv、`doc` 里的 rtf 引擎都不认，
 * 发出去只会拿到 415，白等一次往返。
 */
function thumbUrlOf(item: GalleryItem): string | null {
  if (item.kind === 'page' || item.kind === 'pdf') return previewThumbUrl(item.path, item.sessionId)
  if (officeRenderable(item.kind, item.path)) return previewThumbUrl(item.path, item.sessionId)
  return null
}

/**
 * 磁盘图片的加载态管理：解码完成前不闪白（opacity 0 → 1 过渡）。
 *
 * 同时承担页 / 文档三类的新缩略图（2026-10-06）：它们经 host 的 /office/thumb
 * 取首页位图。走同一条 `<img>` + `shrinkThumbToDisplaySize`（位图下来往往比
 * 显示尺寸大得多，不降采样滚动就掉帧），失败一律**静默回落类型图标** ——
 * 缩略图是锦上添花，不能因为渲染不出来就把卡片变成空白。
 */
/**
 * 磁盘文件的缩略图：image 走画廊 /raw，html / pdf / Office 走 host 的
 * /office/thumb（首页位图）。
 *
 * 加载失败（文件被删 / 准入没跟上 / 引擎不可用）**上报隐藏**而不是回落类型
 * 图标（2026-10-06 用户点名「不存在的文件就不要显示」）：host 的 /media 已经
 * 核对过存在性与 spill 准入，客户端再取不到基本就是真读不到 —— 留一枚图标
 * 等于承诺了一个打不开的内容。video / audio 没有缩略图链路（本来就只有图标 +
 * 播放角标），不属于「读不到」，保持原样。
 */
function FileThumb({ item, now, thumbClass = 'tg-card__thumb', onUnresolvable }: {
  readonly item: GalleryItem
  readonly now: number
  readonly thumbClass?: string
  readonly onUnresolvable?: (path: string) => void
}): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  void now

  const serverThumb = thumbUrlOf(item)
  /**
   * 缩略图加载失败时探一次真实状态码，再决定「隐藏」还是「回落图标」。
   *
   * 4xx（404 文件没了 / 403 准入没跟上）= 这条永远取不到内容 → 上报隐藏；
   * 5xx（引擎缺失 / 转换超时）= 环境问题，条目本身是好的 → 保留类型图标，
   * 点开弹窗里还有失败态文案与下载出口。不分开会误伤：非 win32 或没装引擎的
   * 机器上所有 Office 缩略图都 503，一律隐藏等于整类条目从画廊消失。
   */
  const handleThumbError = useCallback((): void => {
    setFailed(true)
    const url = serverThumb ?? galleryRawUrl(item.path)
    void fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then((res) => { if (res.status >= 400 && res.status < 500) onUnresolvable?.(item.path) })
      .catch(() => { /* 网络抖动：保留图标，不判死刑 */ })
  }, [serverThumb, item.path, onUnresolvable])

  if ((item.kind === 'image' || serverThumb !== null) && !failed) {
    return (
      <div className={thumbClass}>
        <img
          className="tg-card__img"
          // 图片走画廊自己的 raw（索引即白名单）；html / 文档走 office/thumb
          // （按扩展名分流到无头浏览器截图或 LibreOffice 栅格化）。
          src={serverThumb ?? galleryRawUrl(item.path)}
          alt={item.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          data-loaded={loaded ? 'true' : undefined}
          onLoad={(event) => { setLoaded(true); shrinkThumbToDisplaySize(event.currentTarget) }}
          onError={handleThumbError}
        />
        {/* 文档类位图要跑一次真渲染（秒级），期间的占位图与失败回落是同一枚。 */}
        {!loaded && <span className="tg-card__icon"><KindIcon kind={item.kind} size={serverThumb !== null ? 44 : 40} /></span>}
      </div>
    )
  }
  return (
    <div className={thumbClass}>
      <span className="tg-card__icon"><KindIcon kind={item.kind} size={44} /></span>
      {(item.kind === 'video' || item.kind === 'audio') && <PlayBadge />}
    </div>
  )
}

interface CardProps {
  readonly item: GalleryItem
  readonly index: number
  readonly sessionTitle: string | null
  readonly now: number
  readonly onOpen: (item: GalleryItem) => void
  /** 缩略图确认读不到时上报路径（面板把该条目从清单里剔掉）。 */
  readonly onUnresolvable?: (path: string) => void
  /** 手机相册式方格：只留正方形缩略图，名字/类别沉到 hover 浮层。 */
  readonly compact?: boolean
}

const GalleryCard = ({ item, index, sessionTitle, now, onOpen, onUnresolvable, compact = false }: CardProps): JSX.Element => {
  // generated 条目的原始名是 spill 容器的 .txt 文件名，上屏前换成内容类型名。
  const shownName = displayNameOf(item)
  return (
  <button
    type="button"
    className={compact ? 'tg-card tg-card--tile' : 'tg-card'}
    style={{ '--tg-i': Math.min(index, compact ? 12 : 30) } as CSSProperties}
    onClick={() => { onOpen(item) }}
    title={item.path}
  >
    {item.source === 'generated'
      ? <GeneratedThumb path={item.path} alt={shownName} thumbClass={compact ? 'tg-tile__thumb' : 'tg-card__thumb'} onUnresolvable={onUnresolvable} />
      : <FileThumb item={item} now={now} thumbClass={compact ? 'tg-tile__thumb' : 'tg-card__thumb'} onUnresolvable={onUnresolvable} />}
    <span className="tg-card__kind-dot">{KIND_LABEL[item.kind]}</span>
    {compact ? (
      <span className="tg-tile__meta">
        <span className="tg-tile__name" title={shownName}>{shownName}</span>
        <span className="tg-tile__sub">{formatRelativeTime(item.time, now)}</span>
      </span>
    ) : (
      <span className="tg-card__meta">
        <span className="tg-card__name">{shownName}</span>
        <span className="tg-card__sub">
          <span>{sessionTitle ?? '会话'}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.time, now)}</span>
          {item.source === 'file' && item.size > 0 && (
            <>
              <span>·</span>
              <span>{formatSize(item.size)}</span>
            </>
          )}
        </span>
      </span>
    )}
  </button>
  )
}


/* ── 面板主体 ────────────────────────────────────────────────────────── */

export interface GalleryPanelProps {
  readonly onClose: () => void
}

export function GalleryPanel({ onClose }: GalleryPanelProps): JSX.Element {
  ensureGalleryStyles()

  const [items, setItems] = useState<readonly GalleryItem[] | null>(null)
  const [sessions, setSessions] = useState<readonly GallerySession[]>([])
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [kind, setKind] = useState<KindFilter>('image')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  /**
   * 缩略图确认读不到的条目（2026-10-06 用户点名：不存在的文件不要显示）。
   *
   * host 的 /media 已经核对过存在性与 spill 准入，这里兜的是「列表下发之后
   * 才失效」与「host 认为在、客户端取不回」两种残余：条目渲染时发现取不到
   * 内容，就把路径记进这个集合、从清单里剔掉 —— 不留点开空白的格子。
   * 只增不减（与 gonePaths 同口径）：一次失败就够判死刑，重试只会闪。
   */
  const [gonePaths, setGonePaths] = useState<ReadonlySet<string>>(() => new Set())
  const hideUnresolvable = useCallback((path: string) => {
    setGonePaths((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))
  }, [])
  /** 视图形态（网格 ⇄ 时间轴）；默认时间轴（用户 2026-10-04 指定）。 */
  const [view, setView] = useState<ViewMode>('timeline')
  /** 显式时间筛选（时钟钮弹层设置）；null = 不限。 */
  const [timeFilter, setTimeFilter] = useState<TimeRange | null>(null)
  const [timePopover, setTimePopover] = useState(false)
  /** 自定义区间的两个 date input（弹层内）。 */
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const now = useNow()
  const mounted = useRef(true)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // 点弹层外部 / Esc 关闭时间筛选弹层。
  useEffect(() => {
    if (!timePopover) return undefined
    const onPointer = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setTimePopover(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTimePopover(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [timePopover])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    if (refresh) setRefreshing(true)
    try {
      const payload = await fetchGalleryMedia(refresh)
      if (!mounted.current) return
      if (payload.ok !== true) {
        setError(payload.message ?? payload.error ?? '画廊数据加载失败')
        return
      }
      setItems(payload.items ?? [])
      setSessions(payload.sessions ?? [])
      setStale(payload.stale === true)
      setError(null)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setRefreshing(false)
    }
  }, [])

  // 首载：先吃 stale 快照（秒开），后台完整折叠落地后 host 会给新值 ——
  // stale 时延迟再拉一次（host 的后台刷新是即发即跑，2.5s 后大概率已完成）。
  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    if (!stale) return undefined
    const timer = window.setTimeout(() => { void load(false) }, 2500)
    return () => { window.clearTimeout(timer) }
  }, [stale, load])

  const sessionById = useMemo(() => {
    const map = new Map<string, GallerySession>()
    for (const entry of sessions) map.set(entry.id, entry)
    return map
  }, [sessions])

  /** 各类别计数（受会话筛选影响，不受类别筛选影响）。 */
  const kindCounts = useMemo(() => {
    const counts = new Map<GalleryKind, number>()
    for (const item of items ?? []) {
      if (sessionId !== null && item.sessionId !== sessionId) continue
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
    }
    return counts
  }, [items, sessionId])

  // 首次载入后：若默认选中的 'image' 分类没有内容，而其他分类有内容，自动切到首个有内容的分类。
  useEffect(() => {
    if (items === null || items.length === 0) return
    if ((kindCounts.get(kind) ?? 0) === 0) {
      const firstAvailable = KIND_ORDER.find((entry) => (kindCounts.get(entry) ?? 0) > 0)
      if (firstAvailable !== undefined) {
        setKind(firstAvailable)
      }
    }
  }, [items, kindCounts, kind])

  /** 平板风格底部 Dock 展示的分类清单（核心常用 + 任何有产出物的类别）。 */
  const dockKinds = useMemo(() => {
    const withItems = KIND_ORDER.filter((entry) => (kindCounts.get(entry) ?? 0) > 0)
    if (withItems.length >= 3) {
      return KIND_ORDER.filter((entry) => (kindCounts.get(entry) ?? 0) > 0 || kind === entry)
    }
    const defaultCore: readonly GalleryKind[] = ['image', 'page', 'video', 'pdf', 'doc']
    return KIND_ORDER.filter((entry) => (kindCounts.get(entry) ?? 0) > 0 || defaultCore.includes(entry) || kind === entry)
  }, [kindCounts, kind])

  /** 搜索词里的时间表达（认出来就按时间过滤，不再按文本匹配搜索词）。 */
  const queryTimeRange = useMemo(() => parseTimeQuery(query, now), [query, now])

  /** 生效的时间区间：显式筛选与搜索词取交集（都可独立为 null）。 */
  const effectiveRange = useMemo<TimeRange | null>(() => {
    if (timeFilter === null) return queryTimeRange
    if (queryTimeRange === null) return timeFilter
    const from = Math.max(timeFilter.from, queryTimeRange.from)
    const to = Math.min(timeFilter.to, queryTimeRange.to)
    if (from >= to) return { from, to, label: '空区间' }
    return { from, to, label: `${timeFilter.label} ∩ ${queryTimeRange.label}` }
  }, [timeFilter, queryTimeRange])

  /** 过滤后的展示清单（时间降序，host 已排好，这里只做筛选 + 剔除读不到的）。 */
  const visible = useMemo(() => {
    const base = items ?? []
    const needle = queryTimeRange === null ? query.trim().toLowerCase() : ''
    return base.filter((item) => {
      if (gonePaths.has(item.path)) return false
      if (sessionId !== null && item.sessionId !== sessionId) return false
      if (item.kind !== kind) return false
      if (effectiveRange !== null && !inTimeRange(item.time, effectiveRange)) return false
      if (needle !== '') {
        const title = sessionById.get(item.sessionId)?.title ?? ''
        // 搜索面与展示名对齐：generated 条目上屏的是「生图.png」这类名字，
        // 只匹配原始 .txt 名会让「搜生图」一条都搜不到。
        if (!displayNameOf(item).toLowerCase().includes(needle)
          && !item.name.toLowerCase().includes(needle)
          && !item.path.toLowerCase().includes(needle)
          && !title.toLowerCase().includes(needle)) return false
      }
      return true
    })
  }, [items, sessionId, kind, query, queryTimeRange, effectiveRange, sessionById, gonePaths])

  /** 时间轴分组（visible 的按天折叠）。 */
  const dayGroups = useMemo(() => groupByDay(visible, now), [visible, now])

  /** 切换筛选时网格重建（key 变化 → 入场动画重播，形成「换一批」的视觉反馈）。 */
  const gridKey = `${kind}|${sessionId ?? 'all'}|${query.trim().toLowerCase()}|${view}|${effectiveRange?.from ?? ''}-${effectiveRange?.to ?? ''}`

  /** 应用一个时间预设（'all' = 清除）。 */
  const applyPreset = useCallback((id: Exclude<TimePresetId, 'custom'>) => {
    setTimePopover(false)
    setTimeFilter(id === 'all' ? null : presetRange(id))
  }, [])

  /** 应用自定义区间（date input：起日 00:00 → 止日次日 00:00）。 */
  const applyCustom = useCallback(() => {
    if (customFrom === '' && customTo === '') return
    const fromDate = customFrom === '' ? new Date(0) : new Date(`${customFrom}T00:00:00`)
    const toDate = customTo === '' ? new Date(8.64e15) : new Date(`${customTo}T00:00:00`)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return
    const from = fromDate.getTime()
    const to = toDate.getTime() + 86_400_000
    setTimeFilter({ from, to, label: `${customFrom || '起始'} ~ ${customTo || '现在'}` })
    setTimePopover(false)
  }, [customFrom, customTo])

  /**
   * 打开一个条目（2026-10-06 收口）：**能内联的一律进 Lightbox**。
   *
   * 此前 ppt / word / excel 走的是「关掉工作台页 + 官方右栏预览」，理由是那条
   * 链路有原生保真度。实测本机官方 Office 转换是坏的（LibreOffice 写盘被沙箱
   * 拒），于是点一个 ppt 只会让面板消失、右栏弹一句转换失败 —— 比不响应更糟。
   * 现在三类都由 host 出页图在弹窗里预览，「预览文档」按钮仍保留在弹窗底部，
   * 想要官方那条路（或下载）随时可走。
   *
   * 判据用 `canInlinePreview`（类别 + 扩展名）：csv / tsv / rtf 这些同类别但
   * 引擎不认的扩展名会回落到「下载」，而不是让用户对着占位图等一场注定失败的
   * 渲染。
   */
  const openItem = useCallback((item: GalleryItem) => {
    if (!canInlinePreview(item.kind, item.path)) {
      const anchor = document.createElement('a')
      anchor.href = galleryRawUrl(item.path)
      anchor.download = item.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      return
    }
    setLightboxIndex(visible.indexOf(item))
  }, [visible])

  /** 跳到条目所属会话：官方 uiWorkspace.openSession + 关掉工作台页。 */
  const openSessionOf = useCallback((item: { readonly sessionId: string }) => {
    try {
      const ctx = getClientCtx()
      const workspace = ctx?.get?.('uiWorkspace') as { openSession?: (id: string) => void } | undefined
      if (workspace !== undefined && typeof workspace.openSession === 'function') {
        workspace.openSession(item.sessionId)
        try {
          const layout = ctx?.get?.('layout') as { selectPanel?: (id: string | null) => void } | undefined
          layout?.selectPanel?.(null)
        } catch { /* 面板关不掉不阻塞跳转 */ }
        return
      }
    } catch { /* 服务不可用：走兜底 */ }
    // 兜底：至少把会话 id 抄给用户（极旧宿主拿不到 uiWorkspace）。
    window.alert('无法直接跳转，会话 id：' + item.sessionId)
  }, [])

  const totalCount = items?.length ?? 0
  const sessionBar = sessionId !== null ? sessionById.get(sessionId) : undefined

  return (
    <div className="tg-root">
      {/* 工具条：搜索 + 时间筛选 + 视图切换 + 统计 + 刷新 */}
      <div className="tg-toolbar">
        <label className="tg-search">
          <span className="tg-search__icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          </span>
          <input
            className="tg-search__input"
            type="search"
            placeholder="搜文件名 / 会话 / 时间（如「昨天」「近30天」「2026-10-01」）…"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            data-time-hit={queryTimeRange !== null ? 'true' : undefined}
          />
          {queryTimeRange !== null && (
            <span className="tg-search__time-tag" title={`按时间过滤：${queryTimeRange.label}`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              {queryTimeRange.label}
            </span>
          )}
        </label>
        {/* 时间筛选钮 + 预设弹层 */}
        <div className="tg-time" ref={popoverRef}>
          <button
            type="button"
            className="tg-icon-btn tg-time__btn"
            data-active={timeFilter !== null ? 'true' : undefined}
            title="按时间筛选"
            aria-label="按时间筛选"
            aria-expanded={timePopover}
            onClick={() => { setTimePopover((open) => !open) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {timeFilter !== null && <span className="tg-time__badge">{timeFilter.label}</span>}
          </button>
          {timePopover && (
            <div className="tg-time-pop" role="menu">
              <div className="tg-time-pop__presets">
                {(['all', 'today', 'yesterday', 'last7', 'last30', 'thisWeek', 'thisMonth', 'lastMonth'] as const).map((id) => {
                  const isCurrent = id === 'all'
                    ? timeFilter === null
                    : timeFilter !== null && timeFilter.label === TIME_PRESET_LABEL[id]
                  return (
                    <button
                      key={id}
                      type="button"
                      className="tg-time-pop__preset"
                      data-active={isCurrent ? 'true' : undefined}
                      onClick={() => { applyPreset(id) }}
                    >
                      {TIME_PRESET_LABEL[id]}
                    </button>
                  )
                })}
              </div>
              <div className="tg-time-pop__custom">
                <span className="tg-time-pop__custom-label">自定义区间</span>
                <div className="tg-time-pop__custom-row">
                  <input
                    className="tg-time-pop__date"
                    type="date"
                    value={customFrom}
                    max={customTo === '' ? undefined : customTo}
                    onChange={(event) => { setCustomFrom(event.target.value) }}
                  />
                  <span className="tg-time-pop__sep">至</span>
                  <input
                    className="tg-time-pop__date"
                    type="date"
                    value={customTo}
                    min={customFrom === '' ? undefined : customFrom}
                    onChange={(event) => { setCustomTo(event.target.value) }}
                  />
                  <button type="button" className="tg-time-pop__apply" onClick={applyCustom}>应用</button>
                </div>
              </div>
            </div>
          )}
        </div>
        {/* 视图切换：网格 ⇄ 时间轴 */}
        <div className="tg-view" role="tablist" aria-label="视图">
          <button
            type="button"
            className="tg-view__btn"
            data-active={view === 'grid' ? 'true' : undefined}
            title="网格视图"
            aria-label="网格视图"
            onClick={() => { setView('grid') }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </button>
          <button
            type="button"
            className="tg-view__btn"
            data-active={view === 'timeline' ? 'true' : undefined}
            title="时间轴视图"
            aria-label="时间轴视图"
            onClick={() => { setView('timeline') }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3v18" /><circle cx="6" cy="8" r="2" /><circle cx="6" cy="16" r="2" />
              <path d="M11 8h9M11 16h6" />
            </svg>
          </button>
        </div>
        <span className="tg-count">
          {visible.length === totalCount ? `${totalCount} 项` : `${visible.length} / ${totalCount} 项`}
        </span>
        <button
          type="button"
          className="tg-icon-btn"
          data-spinning={refreshing ? 'true' : undefined}
          title="重新扫描全部会话"
          aria-label="刷新"
          onClick={() => { void load(true) }}
          disabled={refreshing}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      {/* stale 提示（后台正在完整重扫） */}
      {stale && (
        <div className="tg-stale">
          <span className="tg-stale__dot" />
          <span>正在后台扫描全部会话，当前显示的是缓存快照…</span>
        </div>
      )}

      {/* 时间筛选条（显式预设/自定义，或搜索词命中时间表达时出现） */}
      {(timeFilter !== null || queryTimeRange !== null) && (
        <div className="tg-time-bar">
          <span className="tg-time-bar__icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <span>已按时间筛选：</span>
          <span className="tg-time-bar__name">{effectiveRange?.label ?? ''}</span>
          <span>（{visible.length} 项）</span>
          {timeFilter !== null && (
            <button type="button" className="tg-session-clear" onClick={() => { setTimeFilter(null) }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              清除
            </button>
          )}
          {queryTimeRange !== null && (
            <button type="button" className="tg-session-clear" onClick={() => { setQuery('') }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              清除搜索时间
            </button>
          )}
        </div>
      )}

      {/* 会话筛选条 */}
      {sessionBar !== undefined && (
        <div className="tg-session-bar">
          <span>已按会话筛选：</span>
          <span className="tg-session-bar__name" title={sessionBar.id}>{sessionBar.title ?? sessionBar.id}</span>
          <span>（{sessionBar.count} 项）</span>
          <button type="button" className="tg-session-clear" onClick={() => { setSessionId(null) }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            清除
          </button>
          <button
            type="button"
            className="tg-session-clear"
            onClick={() => {
              try {
                const ctx = getClientCtx()
                const workspace = ctx?.get?.('uiWorkspace') as { openSession?: (id: string) => void } | undefined
                workspace?.openSession?.(sessionBar.id)
                ctx?.get?.('layout')?.selectPanel?.(null)
              } catch { /* 兜底忽略 */ }
            }}
          >
            打开该会话 →
          </button>
        </div>
      )}

      {/* 主体 */}
      {error !== null && items === null ? (
        <div className="tg-empty">
          <span className="tg-empty__icon">
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="24" cy="24" r="18" />
              <path d="M24 15v11M24 32.5v.1" strokeWidth="2.4" />
            </svg>
          </span>
          <span className="tg-empty__title">画廊加载失败</span>
          <span className="tg-empty__hint">{error}</span>
        </div>
      ) : items === null ? (
        <div className="tg-scroll">
          <div className="tg-grid">
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="tg-skel" style={{ '--tg-i': index } as CSSProperties}>
                <div className="tg-skel__thumb" />
                <div className="tg-skel__line" />
                <div className="tg-skel__line tg-skel__line--short" />
              </div>
            ))}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="tg-empty">
          <span className="tg-empty__icon">
            <svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="6" y="10" width="36" height="28" rx="4" />
              <circle cx="17" cy="20" r="3" />
              <path d="M8 34l9-9 6 5.5 5-4.5 12 10" />
            </svg>
          </span>
          <span className="tg-empty__title">{totalCount === 0 ? '还没有多媒体产出' : '没有匹配的条目'}</span>
          <span className="tg-empty__hint">
            {totalCount === 0
              ? '对话中生成的图片、网页、演示、文档、音视频会出现在这里。产出物来自全部会话的工具调用记录，新对话完成后点右上角刷新即可看到。'
              : '换一个类别、清空搜索词或时间筛选（工具条时钟钮），或清除会话筛选试试。'}
          </span>
        </div>
      ) : view === 'timeline' ? (
        /* 时间轴：左侧竖轨 + 按天分组，日期头钉住，卡片仍是同一张 GalleryCard。 */
        <div className="tg-scroll" key={gridKey}>
          {dayGroups.map((group, groupIndex) => (
            <section
              className="tg-day"
              key={group.key}
              style={{ '--tg-day-i': Math.min(groupIndex, 12) } as CSSProperties}
            >
              <header className="tg-day__head">
                <span className="tg-day__dot" aria-hidden="true" />
                <span className="tg-day__label">{group.label}</span>
                <span className="tg-day__weekday">{group.weekday}</span>
                <span className="tg-day__count">{group.items.length}</span>
                <span className="tg-day__rule" aria-hidden="true" />
              </header>
              <div className="tg-day__tiles">
                {group.items.map((item, index) => (
                  <GalleryCard
                    key={item.path + '|' + item.sessionId}
                    item={item}
                    index={index}
                    sessionTitle={sessionById.get(item.sessionId)?.title ?? null}
                    now={now}
                    onOpen={openItem}
                    onUnresolvable={hideUnresolvable}
                    compact
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="tg-scroll">
          <div className="tg-grid" key={gridKey}>
            {visible.map((item, index) => (
              <GalleryCard
                key={item.path + '|' + item.sessionId}
                item={item}
                index={index}
                sessionTitle={sessionById.get(item.sessionId)?.title ?? null}
                now={now}
                onOpen={openItem}
                onUnresolvable={hideUnresolvable}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 平板风格底部悬浮 Dock（分类导航，更宽阔方便的触控/点击面积）── */}
      <nav className="tg-dock" role="tablist" aria-label="内容分类导航">
        {dockKinds.map((entry) => {
          const count = kindCounts.get(entry) ?? 0
          const isActive = kind === entry
          return (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={isActive}
              className="tg-dock__item tg-kind"
              data-active={isActive ? 'true' : undefined}
              onClick={() => { setKind(entry) }}
              title={`${KIND_LABEL[entry]}（${count} 项）`}
            >
              <div className="tg-dock__icon-wrap">
                <KindTabIcon kind={entry} size={18} />
                {count > 0 && <span className="tg-dock__badge tg-kind__count">{count > 99 ? '99+' : count}</span>}
              </div>
              <span className="tg-dock__label">{KIND_LABEL[entry]}</span>
              {isActive && <span className="tg-dock__dot" aria-hidden="true" />}
            </button>
          )
        })}
      </nav>

      {/* Lightbox（共享组件：画廊与产出物卡同一套预览与全屏）。
          上界守卫必须带：gonePaths 剔除条目后 visible 会缩短，旧 index 可能越界
          （越界时 MediaLightbox 内部 item===undefined 会 return null，不崩但弹窗
          凭空消失，比不显示更怪）。 */}
      {lightboxIndex !== null && lightboxIndex >= 0 && lightboxIndex < visible.length && (
        <MediaLightbox
          items={visible}
          index={lightboxIndex}
          fileUrlOf={(item) => galleryRawUrl(item.path)}
          onNavigate={setLightboxIndex}
          onClose={() => { setLightboxIndex(null) }}
          onOpenSession={(item) => { openSessionOf(item); setLightboxIndex(null) }}
          onOpenSidebar={(item) => {
            // 出口保留：官方的原生保真度（字体、复杂排版）仍是备选路径。
            const session = sessionById.get(item.sessionId)
            if (tryOpenInSidebar(item.path, { sessionId: item.sessionId, cwd: session?.cwd ?? undefined })) setLightboxIndex(null)
          }}
        />
      )}
    </div>
  )
}

/** 侧边栏 / Tab 用的小图标（与工作台其他 Tab 同风格）。 */
export function GalleryTabIcon({ size = 13 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}
