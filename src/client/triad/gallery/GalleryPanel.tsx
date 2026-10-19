/**
 * dsh-chat-plus — 多媒体画廊面板（工作台第五个 Tab）。
 *
 * 回答一个问题：**所有对话产出过的图片 / 网页 / 演示 / 文档，在哪儿一次看全。**
 *
 * 布局：工具条（类别 chips + 时间筛选 + 搜索 + 视图切换 + 刷新）→ 筛选条
 * （会话 / 时间，选中时出现）→ 卡片网格或时间轴。点卡片 = 在**官方右侧栏**
 * 打开该条（本面板没有自己的预览层）。
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
 * 打开方式（2026-10-19 收口为「一律官方侧栏」）：
 *  · 磁盘成品（图片 / 音视频 / 网页 / PDF / Office）→ 直接把文件地址交给官方
 *    右侧栏的文档预览 tab。PDF / Office 由插件的 sidebar-doc 渲染器接管（官方
 *    内嵌 pdf.js 对带 /ID 的 PDF 必崩），音视频由 sidebar-media 接管（官方把
 *    mp4 / mp3 列为「没有渲染器」）；
 *  · 生图 / 生视频 → 内容只存在于 spill 的 .txt 里，先请 host 落成真实图片文件
 *    （materialize 路由，幂等）再交右栏。
 *
 *  这条路径的上一版是「插件自己的 Lightbox」，再上一版是「按扩展名分裂」。
 *  两者都被推翻：用户要的是一份文件只有一个查看器，就是官方侧边栏。
 *
 *  缩略图（同为 2026-10-06）：html / ppt / word / pdf 的卡片此前只有一枚类型
 *  图标 —— 一整屏长得一样的占位图，认不出哪张是哪张。现在经 host 的
 *  /office/thumb 取首页位图当缩略图（html 走无头浏览器截首屏，文档走
 *  LibreOffice / PDFium 栅格化），失败时回落原来的类型图标。
 *
 * 动效（渐进式微调，不推翻工作台既有骨架）：卡片入场级联上浮、hover 浮起 +
 * 缩略图缓推、类别徽标下滑浮现、骨架屏微光、刷新图标旋转。全部尊重
 * prefers-reduced-motion（样式表里统一关）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  dayKeyOf,
  dayLabelOf,
  deleteGalleryPaths,
  displayNameOf,
  fetchGalleryMedia,
  formatRelativeTime,
  formatSize,
  galleryRawUrl,
  generatedUrlCache,
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
import { canInlinePreview, MediaLightbox } from './media-lightbox.js'
import { openWorkspacePreview } from '../../open-preview.js'
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

/* ── 分类删除的节奏常量（2026-10-16）────────────────────────────────────
 *
 * 与 kr-chat 的 KrMemoryCard 同一套节奏参数（确认自动回退 6s、每行错峰 45ms、
 * 封顶 900ms），只是这里的单位是「卡片」而不是「记忆行」：两处同频，用户在同一
 * 个产品里学一次就够了。
 */

/** 确认态无操作自动回退（毫秒）。放着不管时过几秒自己回到常态，压掉误触窗口。 */
const DEL_CONFIRM_MS = 6000

/** 每张卡片错峰退场的间隔（毫秒）。 */
const DEL_STAGGER_MS = 45

/** 单张卡片退场动画时长（毫秒），与 styles.ts 的 tg-card-out 成对维护。 */
const DEL_CARD_MS = 260

/** 错峰等待封顶：条目多时不再线性拉长，否则点一下要等好几秒才发请求。 */
const DEL_STAGGER_CAP = 900

/** 第 N 张卡片退场的延后量。与 .tg-card--out 的内联 animation-delay 对应。 */
function delStaggerMs(index: number): number {
  return index * DEL_STAGGER_MS
}

/** 退场动画整体要等多久（与卡片数相关，封顶见上）。 */
function delAnimationMs(count: number): number {
  return Math.min(DEL_STAGGER_CAP, DEL_CARD_MS + Math.max(0, count - 1) * DEL_STAGGER_MS)
}

/** 删除失败原因 → 人话（host 给的是机器码）。 */
const DEL_FAIL_LABEL: Readonly<Record<string, string>> = {
  'not-indexed': '不在画廊索引里',
  'not-a-file': '不是普通文件（符号链接 / 目录一律拒删）',
  missing: '文件已经不在了',
  network: '连不上服务',
}

function humanDeleteReason(code: string): string {
  if (DEL_FAIL_LABEL[code] !== undefined) return DEL_FAIL_LABEL[code]
  if (code.startsWith('io:')) return `磁盘错误（${code.slice(3)}）`
  if (code.startsWith('http-')) return `服务返回 ${code.slice(5)}`
  return code
}

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

/** 分类芯片上的垃圾桶（与 kr-chat 记忆卡同一枚线框图标，保持同一套语言）。 */
function TrashIcon({ size = 12 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.9 4.3h10.2M6.4 4.3V3.1a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9v1.2M4.4 4.3l.5 8.4a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.5-8.4" />
    </svg>
  )
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
 * IntersectionObserver 进视口才请求，解析结果进共享缓存（api.ts 的
 * generatedUrlCache：网格重进视口与弹窗打开都复用同一份，重开秒回）。
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
      // 只有成功才写共享缓存（重进视口 / 落盘前都要用它）；失败不写，下次进视口重试。
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
      {urls.length > 1 && <span className="tg-card__count">{urls.length} 张</span>}
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
  /**
   * 分类删除的退场延迟（毫秒）。给了就说明这条正在被删：卡片改走 tg-card-out
   * 退场动画、按这个延迟错峰淡出，且不再可点（退场中再点会把一个正在消失的
   * 条目塞进右栏，那一下体验更怪）。undefined = 正常态。
   */
  readonly outMs?: number
}

/**
 * 缩略图半身：generated 走 GeneratedThumb、file 走 FileThumb，与 GalleryCard
 * 同一套解析口径。Coverflow 焦点卡复用它——轮播里的图和网格里的图必须同源，
 * 否则会出现「轮播能看到、网格里读不到」的鬼条目。
 */
const GalleryCardThumb = ({ item, now, onUnresolvable }: {
  readonly item: GalleryItem
  readonly now: number
  readonly onUnresolvable?: (path: string) => void
}): JSX.Element => (
  item.source === 'generated'
    ? <GeneratedThumb path={item.path} alt={displayNameOf(item)} thumbClass="tg-card__thumb" onUnresolvable={onUnresolvable} />
    : <FileThumb item={item} now={now} thumbClass="tg-card__thumb" onUnresolvable={onUnresolvable} />
)

const GalleryCard = ({ item, index, sessionTitle, now, onOpen, onUnresolvable, compact = false, outMs }: CardProps): JSX.Element => {
  // generated 条目的原始名是 spill 容器的 .txt 文件名，上屏前换成内容类型名。
  const shownName = displayNameOf(item)
  const leaving = outMs !== undefined
  return (
  <button
    type="button"
    className={[compact ? 'tg-card tg-card--tile' : 'tg-card', leaving ? 'tg-card--out' : ''].filter(Boolean).join(' ')}
    // 退场期间不重复挂入场动画的延迟变量（那条动画已被 tg-card-out 覆盖），
    // 退场延迟直接内联成 animation-delay 让逐条错开。
    style={leaving
      ? { animationDelay: `${String(outMs)}ms` } as CSSProperties
      : { '--tg-i': Math.min(index, compact ? 12 : 30) } as CSSProperties}
    onClick={() => { if (!leaving) onOpen(item) }}
    // 不用 disabled：UA 会给 disabled 的 button 染上灰字，退场那 260ms 看起来像
    // 「变灰消失」而不是「淡出下沉」。不可点由 CSS 的 pointer-events:none（见
    // .tg-card--out）与这里的守卫一起承担，视觉与交互两边都干净。
    aria-disabled={leaving ? true : undefined}
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
  /** 弹窗当前打开的条目下标（null = 关着）。可见清单变了由渲染处的上界守卫兜住。 */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  /**
   * 从清单里剔除的路径（两件事同口径，都只增不减）：
   *  · 缩略图这一次确认读不到的条目（2026-10-06 用户点名：不存在的文件不要显示）；
   *  · 刚刚被分类删除掉的条目（2026-10-16）。
   *
   * 后者走同一份集合而不是另开一份"已删除"集合：对清单来说两者效果一样 —— 都不该
   * 再显示，拆两份迟早分叉。删除后的条目在 host 下一次 /media 回来之前仍会出现在
   * items 里，没有这层剔除的话，用户看到的就是「我明明删了、东西还在」。
   *
   * 纯会话内内存（useState），**刻意不落 localStorage**。理由是 host 侧已经兜住了
   * 跨会话的一致性：verifyResponse 每次 /media 都对每个条目做 statSync 存在性核对，
   * 核对不过的直接不列（src/triad/gallery/index.ts:148-159），即使聚合快照还在
   * 15s TTL 内也一样实时剔除 —— 所以「刷新后已删条目复活」不会发生，客户端不需要
   * 跨会话记忆。而持久化反而会造出两个更难救的问题：① 缩略图一次瞬时读取失败
   * （网络抖动 / spill 准入瞬断）也被写进盘，路径被永久隐身；② 路径被重新产出
   * （report.pdf 这类固定名很常见）后新文件永远不显示，且没有任何恢复入口。
   * 这层记忆只需要覆盖「请求返回 → 下次 load 完成」这个窗口。
   *
   * host 的 /media 已经核对过存在性与 spill 准入，这里兜的只是"列表下发之后才
   * 失效"与"客户端取不回"两种残余 —— 一次失败就够判死刑，重试只会闪。
   */
  const [gonePaths, setGonePaths] = useState<ReadonlySet<string>>(() => new Set())
  const hideUnresolvable = useCallback((path: string) => {
    setGonePaths((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))
  }, [])
  /** 把一批路径并进"不再显示"集合（删除成功 / 部分成功都走它）；纯内存并集。 */
  const rememberGone = useCallback((paths: readonly string[]) => {
    if (paths.length === 0) return
    setGonePaths((prev) => {
      const next = new Set(prev)
      for (const path of paths) next.add(path)
      return next
    })
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

  /* ── 分类删除（2026-10-16）────────────────────────────────────────────
   *
   * 状态机与 kr-chat 记忆卡的「一键删除」同构，只多了一层"哪个分类正在确认"：
   *
   *   delConfirmId   待确认的分类（芯片原地变「删除 N 项？确认/取消」）
   *   delBusyKind    请求在飞的分类（芯片 data-busy + 显示「删除中…」，禁止重复点击）
   *   delLeave       正在退场的路径 → 延迟量（错峰动画期间卡片仍在 DOM 里）
   *   delError       删除失败/部分失败的一行提示
   *
   * 三者分开而不是揉成一个 phase：退场动画播完就要发请求，而动画期间确认态已经
   * 收掉了（芯片在 busy 态）；把「要不要显示错误」和「现在能不能点」塞进同一个
   * 枚举会让这几个独立事实互相覆盖。
   */
  const [delConfirmId, setDelConfirmId] = useState<GalleryKind | null>(null)
  const [delBusyKind, setDelBusyKind] = useState<GalleryKind | null>(null)
  const [delLeave, setDelLeave] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [delError, setDelError] = useState<string | null>(null)
  /**
   * host 下发的全局分类计数（未截断口径）与它是否被截断。
   *
   * 单独存在 state 里而不是从 items 现算：它可能比 items 的条目数大（截断），
   * 也可能在用户还没拿到 items 时就有了（stale 快照），两者不是一回事。
   * truncated 决定"本地计数能不能拿来当准"（见 totalOf）。
   */
  const [kindTotals, setKindTotals] = useState<Readonly<Record<string, number>> | null>(null)
  const [truncated, setTruncated] = useState(false)

  /** 确认态的自动回退定时器。 */
  const delConfirmTimerRef = useRef<number | null>(null)
  /** 清单代次：退场动画期间用户刷新/切筛选时用它判断"这批还算不算当前视图"。 */
  const delGenRef = useRef(0)
  /** 退场动画期间的挂起定时器（卸载时收掉）。 */
  const delTimersRef = useRef<number[]>([])
  /** 请求在飞（同步可读，避免同一帧内连点两次进入两条删除流程）。 */
  const delBusyRef = useRef(false)

  /** 收掉确认态的回退定时器（进删除 / 取消 / 卸载时都要先收）。 */
  const cancelDelConfirmTimer = useCallback(() => {
    if (delConfirmTimerRef.current !== null) {
      window.clearTimeout(delConfirmTimerRef.current)
      delConfirmTimerRef.current = null
    }
  }, [])

  /** 取消分类删除：收回确认态，什么都不改。 */
  const cancelDel = useCallback(() => {
    cancelDelConfirmTimer()
    setDelConfirmId(null)
  }, [cancelDelConfirmTimer])

  // 点别处 / Esc → 收回确认态（与时间弹层同一套"就地反悔"出口）。
  // 判据钉在**同一枚芯片**上：点另一枚分类芯片也算"别处"（它会把选中分类切走，
  // 而确认态里那个 N 是按旧分类算的，留着就成了张冠李戴）。
  useEffect(() => {
    if (delConfirmId === null) return undefined
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      const chip = target instanceof Element ? target.closest('.tg-kind') : null
      if (chip?.getAttribute('data-kind') !== delConfirmId) cancelDel()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelDel()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [delConfirmId, cancelDel])

  // 卸载：把两处定时器收干净（退场等待里的 setState 在 React 18 下是无害 no-op，
  // 但继续 await 完请求会让"删除中"停在真空中，所以真正要拦的是 delBusyRef）。
  useEffect(() => () => {
    if (delConfirmTimerRef.current !== null) window.clearTimeout(delConfirmTimerRef.current)
    for (const timer of delTimersRef.current) window.clearTimeout(timer)
    delTimersRef.current = []
  }, [])

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
      setKindTotals(payload.kindTotals ?? null)
      setTruncated(payload.truncated === true)
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
      // 已经删掉的与已经读不到的都不算：删完那一拍计数就要归零，不能等下一次
      // /media 回来（客户端还有 15s 索引缓存），否则芯片上挂着一个已不存在的数字。
      if (gonePaths.has(item.path)) continue
      if (sessionId !== null && item.sessionId !== sessionId) continue
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
    }
    return counts
  }, [items, sessionId, gonePaths])

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

  /**
   * 会话 / 时间 / 搜索筛过、但**还没按类别过滤**的清单。
   *
   * 单独留这一层的理由：分类芯片上的删除键对**每个**分类都可用，包括当前没选中的
   * 那个。若拿已按 kind 过滤的 visible 去数目标条目，未选中分类的 N 永远是 0，
   * 那枚删除键就成了摆设。所以"这个分类筛出来有几条"必须在类别过滤之前算。
   */
  const filteredBase = useMemo(() => {
    const base = items ?? []
    const needle = queryTimeRange === null ? query.trim().toLowerCase() : ''
    return base.filter((item) => {
      // gonePaths 同时承载「读不到的」与「刚被删掉的」两种：对清单来说效果一样
      // —— 都不该再显示（见它的声明处）。
      if (gonePaths.has(item.path)) return false
      if (sessionId !== null && item.sessionId !== sessionId) return false
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
  }, [items, sessionId, query, queryTimeRange, effectiveRange, sessionById, gonePaths])

  /** 过滤后的展示清单（时间降序，host 已排好，这里只做筛选 + 剔除读不到的）。 */
  const visible = useMemo(
    () => filteredBase.filter((item) => item.kind === kind),
    [filteredBase, kind],
  )

  /** 时间轴分组（visible 的按天折叠）。 */
  const dayGroups = useMemo(() => groupByDay(visible, now), [visible, now])

  /** 切换筛选时网格重建（key 变化 → 入场动画重播，形成「换一批」的视觉反馈）。 */
  const gridKey = `${kind}|${sessionId ?? 'all'}|${query.trim().toLowerCase()}|${view}|${effectiveRange?.from ?? ''}-${effectiveRange?.to ?? ''}`

  /* ── 真实计数（2026-10-16：不再用两位数的近似符号）─────────────────────
   *
   * 用户问的是「画廊里究竟有多少张图」，一个近似符号回答不了。
   * 口径分两种，混用就会骗人：
   *  · 无任何筛选（会话 / 时间 / 搜索词）时优先用 host 下发的 kindTotals ——
   *    它是**未截断**的全局口径（items 会在 MAX_RESPONSE_ITEMS 处被截，本地数
   *    出来只会偏小）；旧 host 不下发时静默回落本地计数。
   *  · 有任一筛选时只有本地 kindCounts 是对的 —— 用户在问「筛出来的这批里有几条」。
   *
   * kindTotals 是 host 侧"删除前 / 下一次刷新前"的快照，本地计数则已经把本次会话
   * 里刚删掉的剔掉了，所以两者取小的那个（刚删过就别让数字挂在原位）。唯一的例外
   * 是 truncated：清单被截到 MAX_RESPONSE_ITEMS 时本地计数天生偏小，此时只能听
   * host 的（宁可暂时多算刚删掉的几条，也不能给出一个明显缺斤少两的数）。
   */
  const hasFilter = sessionId !== null || effectiveRange !== null || query.trim() !== ''
  const totalOf = useCallback((entry: GalleryKind): number => {
    const local = kindCounts.get(entry) ?? 0
    if (hasFilter) return local
    const remote = kindTotals?.[entry]
    if (remote === undefined) return local
    return truncated ? remote : (local < remote ? local : remote)
  }, [hasFilter, kindTotals, kindCounts, truncated])

  /** 平板风格底部 Dock 展示的分类清单（核心常用 + 任何有产出物的类别）。 */
  const dockKinds = useMemo(() => {
    // 判据用上面那套「真实计数」口径：host 给了 kindTotals 时，哪怕本地 items
    // 还没落地 / 被截断，有产出的分类也该出现在工具条上（否则芯片会说「没有」）。
    const withItems = KIND_ORDER.filter((entry) => totalOf(entry) > 0)
    if (withItems.length >= 3) {
      return KIND_ORDER.filter((entry) => totalOf(entry) > 0 || kind === entry)
    }
    const defaultCore: readonly GalleryKind[] = ['image', 'page', 'video', 'pdf', 'doc']
    return KIND_ORDER.filter((entry) => totalOf(entry) > 0 || defaultCore.includes(entry) || kind === entry)
  }, [totalOf, kind])

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
   * 打开一个条目：**就地弹窗**（2026-10-19 二次改版，用户点名要弹窗回来）。
   *
   * 这条路径已经来回走过三次，把结论钉在这里：
   *  1. 2026-10-06 前：按扩展名分裂（Office 走右栏、其余进弹窗）；
   *  2. 2026-10-19 上旬：全部改走官方右栏 —— 确实统一了，但**代价是离开画廊**。
   *     官方右栏的 DOM 在全局面板占主列时整个是 hidden 的（RightbarRoot 的
   *     `visible = activePanelId === null`），所以在画廊里点一张图必然把工作台
   *     页关掉、跳回会话才能看见 —— 用户的原话是「为啥点了就跳转到会话」。
   *  3. 现在：**画廊回到弹窗**。它是横向扫一遍的地方（一次看十几张、来回翻、
   *     快速关掉），弹窗才对；产出物卡仍然走右栏（那是「这次做出来了什么」，
   *     点开该在旁边长期停着）。
   *
   * 只有一种情况不进弹窗：**弹窗里渲染不出来的类别**（canInlinePreview 为 false，
   * 例如 rtf / csv 这类同类别但引擎不认的扩展名）。它们退回官方右栏 —— 那里
   * 至少能给出文件信息与下载入口，比在弹窗里摆一张「不支持预览」的占位图好。
   */
  const openItem = useCallback((item: GalleryItem) => {
    if (!canInlinePreview(item.kind, item.path)) {
      openWorkspacePreview(item.path, {
        sessionId: item.sessionId,
        cwd: sessionById.get(item.sessionId)?.cwd ?? undefined,
      })
      return
    }
    setLightboxIndex(visible.indexOf(item))
  }, [visible, sessionById])

  /* ── 分类删除的执行（2026-10-16）───────────────────────────────────── */

  /** 某个分类的待删清单：当前筛过（会话 / 时间 / 搜索）的清单里该分类的条目。 */
  const entriesFor = useCallback(
    (entry: GalleryKind): readonly GalleryItem[] => filteredBase.filter((item) => item.kind === entry),
    [filteredBase],
  )

  /**
   * 点芯片上那枚垃圾桶：进确认态（并起一个自动回退定时器）。
   *
   * 与 KrMemoryCard 的 armClear 同款：一次只允许一个分类亮着确认态，点第二个
   * 时先把上一个收掉 —— 两处确认态同时亮着，用户分不清「确认」会删哪一批。
   */
  const armDel = useCallback((entry: GalleryKind) => {
    if (delBusyRef.current) return
    setDelError(null)
    setDelConfirmId(entry)
    cancelDelConfirmTimer()
    delConfirmTimerRef.current = window.setTimeout(() => {
      delConfirmTimerRef.current = null
      setDelConfirmId(null)
    }, DEL_CONFIRM_MS)
  }, [cancelDelConfirmTimer])

  /**
   * 真正执行分类删除。
   *
   * 时序刻意分两段 —— **先播退场动画、动画走完再发请求**：
   *  · 进 busy 态、把这批路径按索引标成错峰退场，卡片逐条淡出下沉；
   *  · 动画跑完（条数越多等得越久，但封顶 900ms）才发请求；成功即把这批路径并进
   *    gonePaths，卡片从清单里消失 —— 消失那一刻它早就淡到透明，接得上。
   *
   * 为什么不等请求回来再播动画：失败时动画已经播完，就得把卡片重新插回来，
   * 那一下「删掉的东西又长回来」比不播动画更吓人。现在整批失败是**一条都没动**
   * （不在 gonePaths 里，卡片本来就还在屏幕上，动画结束只是淡入复原），工具条
   * 下方留一行错误说明原因。
   *
   * 代次校验（delGenRef）拦的是「动画这段窗口里用户点了刷新 / 切了筛选」：清单
   * 已经被换掉，成功后就别再触发一次全量拉取（那次刷新会自己做这件事）。
   */
  const runDel = useCallback(async (entry: GalleryKind) => {
    if (delBusyRef.current) return
    const targets = entriesFor(entry)
    if (targets.length === 0) {
      cancelDelConfirmTimer()
      setDelConfirmId(null)
      return
    }
    const paths = targets.map((item) => item.path)
    const generation = delGenRef.current
    cancelDelConfirmTimer()
    delBusyRef.current = true
    setDelBusyKind(entry)
    setDelConfirmId(null)
    setDelError(null)
    setDelLeave(new Map(paths.map((path, index) => [path, delStaggerMs(index)])))

    await new Promise<void>((resolvePromise) => {
      const timer = window.setTimeout(resolvePromise, delAnimationMs(paths.length))
      delTimersRef.current.push(timer)
    })
    if (!mounted.current) { delBusyRef.current = false; return }

    const result = await deleteGalleryPaths(paths)
    if (!mounted.current) { delBusyRef.current = false; return }

    const failed = result.failed ?? []
    const failedPaths = new Set(failed.map((entryFail) => entryFail.path))
    /**
     * 哪些路径真的没了。
     *
     * **只有 host 明确说「删掉了东西」时才移除**：整批失败（403/405/400/500
     * 这类响应只有 {ok:false,error}，没有 failed 字段）时 failed 是空数组，
     * 若按「非失败即成功」推断会把一整批留在磁盘上的文件标成"已删除"—— 用户
     * 看到的是「删掉了」而文件其实还在，正是契约里点名不许出现的状态。
     * 判据取 deleted（host 给的真实条数）：>0 才认领非 failed 的那些。
     */
    const removed = result.ok === true || (result.deleted ?? 0) > 0
      ? paths.filter((path) => !failedPaths.has(path))
      : []
    rememberGone(removed)

    setDelLeave(new Map())
    setDelBusyKind(null)
    delBusyRef.current = false

    if (result.ok === true) {
      setDelError(null)
      // 与 host 对齐（并发删除 / 别的客户端同时写），顺带把 kindTotals 拉成最新。
      // 代次不一致说明用户已经刷新过清单，这一次就不用再拉了。
      if (delGenRef.current === generation) void load(false)
      return
    }

    // 失败：只有真正删掉的那部分进 gonePaths（上面已处理），其余的留在清单里，
    // 并把这行提示的文案说清楚 —— 用户必须知道「哪些还在」以及「为什么」。
    if (removed.length === 0) {
      setDelError(failed.length === 0
        ? (result.message ?? '删除失败')
        : `这 ${failed.length} 项都没删掉，仍留在画廊里：${humanDeleteReason(failed[0]?.error ?? '')}`)
      return
    }
    const first = failed[0]
    setDelError(`有 ${failed.length} 项没删掉，仍留在画廊里（已删除 ${removed.length} 项）：${first !== undefined ? humanDeleteReason(first.error) : ''}`)
  }, [cancelDelConfirmTimer, entriesFor, rememberGone, load])

  // 每次清单/筛选变化都推进代次：退场动画期间用户切了筛选或刷新，这次删除就不再
  // 去认领新清单（卡片早已从可见集合里消失，认领会把不相干的东西标成"正在退场"）。
  useEffect(() => { delGenRef.current += 1 }, [items, kind, sessionId, query, timeFilter])

  /**
   * 工具条右侧那个总数。
   *
   * 不能直接数 items.length：刚删掉的条目在 host 下一次 /media 回来之前仍留在
   * items 里（客户端还有 15s 索引缓存），那时右边写着「199 项」而左边每一类都
   * 已经少了几条 —— 同一块工具条上两个数字互相打脸。所以这里与清单同口径剔除。
   */
  const totalCount = useMemo(
    () => (items ?? []).reduce((sum, item) => (gonePaths.has(item.path) ? sum : sum + 1), 0),
    [items, gonePaths],
  )
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
        {/* 右侧工具组：时间 / 视图 / 分类 / 数量 / 刷新。
            整组 margin-left:auto 贴右，且**作为一个整体换行**（justify-content:flex-end）——
            窄屏折行时仍贴右，不会散到左边去。 */}
        <div className="tg-tools">
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
        {/* 类别筛选（图片 / 网页 / PDF / 音频…）：**分类在前、数量与刷新在后**
            （用户 2026-10 要求）。
            形态简化：只有「图标 + 文字 + 数字」，不再叠图标盒、悬浮角标、选中圆点
            三层装饰——一枚 chip 里塞四个视觉元素，扫视时反而认不出主信息。 */}
        <nav className="tg-dock" role="tablist" aria-label="内容分类导航">
          {dockKinds.map((entry) => {
            const count = totalOf(entry)
            const isActive = kind === entry
            const confirming = delConfirmId === entry
            const busy = delBusyKind === entry
            // 确认态 / 删除中显示的条数 = 这次**真的会删掉**的那几条（当前可见清单
            // 里该分类的条目），而不是芯片上那个全局数字 —— 两者在有筛选时不同，
            // 而「确认」要回答的正是"会删掉什么"。
            const targetCount = confirming || busy ? entriesFor(entry).length : count
            const exact = count.toLocaleString('zh-CN')
            /* 芯片本体是**外层 div + 内层 button**，不是单个 button。
               原因：确认态里要放「确认 / 取消」两枚真按钮，而 HTML 不允许 button
               嵌套 button（React 会告警、浏览器会拆 DOM，点击目标也乱）。所以外层
               只做布局与 data 态（role=tab 的语义仍挂在它上面），内层 button 承担
               「选中这个分类」这一个动作，删除键与确认键各自独立。 */
            return (
              <div
                key={entry}
                role="tab"
                aria-selected={isActive}
                className="tg-dock__item tg-kind"
                // 确认态"点别处就取消"靠它判"别处"是哪一枚（见上面的 mousedown 监听）。
                data-kind={entry}
                data-active={isActive ? 'true' : undefined}
                data-busy={busy ? 'true' : undefined}
                data-confirm={confirming ? 'true' : undefined}
                title={confirming
                  ? `删除「${KIND_LABEL[entry]}」分类下的 ${targetCount} 项？从磁盘删除，不可恢复`
                  : `${KIND_LABEL[entry]}（${exact} 项）${count > 0 ? ' · 可分类删除' : ''}`}
              >
                {confirming ? (
                  /* 就地二次确认：芯片原地换成「删除 N 项？不可恢复 确认 / 取消」。
                     不弹系统对话框 —— 反悔就在这一枚胶囊里完成，不跳走、不失焦。
                     busy 态沿用同一个容器（只为共用脉冲与布局），文案换成「删除中…」。

                     「不可恢复」**必须落在可见文本里**（而不是只写 title）：这一步删的是
                     磁盘文件、不可逆，而 title 是 hover tooltip —— 触屏永远看不到、键盘
                     用户也读不到，只写 title 等于对触摸/键盘用户隐瞒后果。做成独立小字
                     元素是为了给它自己的字号与告警色（视觉上不与问句抢主位），文本仍与
                     问句连读成一句完整的话。 */
                  <span className="tg-kind__confirm">
                    <span className="tg-kind__ask">
                      删除 {targetCount} 项？<span className="tg-kind__warn">不可恢复</span>
                    </span>
                    <button
                      type="button"
                      className="tg-kind__yes"
                      // aria-label 与可见文本同义（同样含「不可恢复」）：可见文本里
                      // 「不可恢复确认取消」是连读的（视觉上有 gap，朗读没有），显式
                      // 给按钮一个自足的句子，屏幕阅读器才不会把它读成一句怪话。
                      aria-label={`确认删除「${KIND_LABEL[entry]}」分类下的 ${targetCount} 项，不可恢复`}
                      title={`确认从磁盘删除这 ${targetCount} 项（不可恢复）`}
                      onClick={() => { void runDel(entry) }}
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      className="tg-kind__no"
                      aria-label={`取消删除「${KIND_LABEL[entry]}」分类的条目`}
                      title="取消，什么都不改"
                      onClick={cancelDel}
                    >
                      取消
                    </button>
                  </span>
                ) : busy ? (
                  <span className="tg-kind__confirm">
                    <span className="tg-kind__ask">删除中…</span>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tg-kind__pick"
                      // 删除中 / 确认中不接受切换：busy 的 pointer-events:none 已挡住
                      // 鼠标，这里再拦一道键盘（Tab 之后按回车仍会触发 click）。
                      disabled={busy || confirming}
                      aria-label={`筛选${KIND_LABEL[entry]}`}
                      onClick={() => { setKind(entry) }}
                    >
                      <KindTabIcon kind={entry} size={14} />
                      <span className="tg-dock__label">{KIND_LABEL[entry]}</span>
                      {count > 0 && <span className="tg-dock__num" title={`${exact} 项`}>{exact}</span>}
                    </button>
                    {/* 每个分类都带删除键（契约 B2-2）；但一枚都没有时置灰 ——
                        否则点下去只会得到「删除 0 项？」再自己取消，是条纯噪声的死路
                        （空分类很常见：切筛选、刚删完都会出现）。 */}
                    <button
                      type="button"
                      className="tg-kind__del"
                      disabled={count === 0}
                      aria-label={count === 0
                        ? `「${KIND_LABEL[entry]}」分类没有可删除的条目`
                        : `删除「${KIND_LABEL[entry]}」分类的全部 ${count} 项`}
                      title={count === 0
                        ? `「${KIND_LABEL[entry]}」当前没有条目`
                        : `删除「${KIND_LABEL[entry]}」分类下的全部 ${count} 项…`}
                      onClick={() => { armDel(entry) }}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </nav>
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
      </div>

      {/* stale 提示（后台正在完整重扫） */}
      {stale && (
        <div className="tg-stale">
          <span className="tg-stale__dot" />
          <span>正在后台扫描全部会话，当前显示的是缓存快照…</span>
        </div>
      )}

      {/* 删除失败 / 部分失败的一行提示：落在工具条下方、筛选条上方 —— 删除是
          工具条上的动作，结果就近显示在同一视野里，不用翻列表找。
          文案里必须带条数与首条原因：失败的条目仍留在清单里，这行是它们的解释；
          已成功删掉的那几条不会因为这一行而被"放回来"（磁盘上确实没了）。 */}
      {delError !== null && (
        <div className="tg-del-error" role="alert">
          <span className="tg-del-error__icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5M12 16.5v.1" />
            </svg>
          </span>
          <span className="tg-del-error__text">{delError}</span>
          <button type="button" className="tg-del-error__close" onClick={() => { setDelError(null) }}>知道了</button>
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
      {/* ── Coverflow 焦点轮播（2026-10 深空改版，效果图第 5 页顶部）──
           取当前可见列表前 5 条做 3D 焦点舞台：中间那张放大正对，两侧旋转退后。
           数据是真条目，点击任意一张 = 在官方右栏打开该条（与网格同一入口）。
           条目不足 3 条不渲染（轮播没有意义），时间轴视图也不渲染。 */}
      {view === 'grid' && items !== null && error === null && visible.length >= 3 && (
        <div className="wb2-cover" aria-label="焦点产出轮播">
          <div className="wb2-cover-track">
            {visible.slice(0, 5).map((item, index) => {
              const pos = index === 2 ? 'c' : index < 2 ? 'p' : 'n'
              const dist = Math.abs(index - 2)
              return (
                <button
                  key={item.path + '|' + item.sessionId}
                  type="button"
                  className="wb2-cv"
                  data-c={pos === 'c' ? '1' : undefined}
                  data-p={pos === 'p' ? String(dist) : undefined}
                  data-n={pos === 'n' ? String(dist) : undefined}
                  onClick={() => { if (delBusyKind === null) openItem(item) }}
                  aria-disabled={delBusyKind !== null ? true : undefined}
                  title={displayNameOf(item)}
                >
                  <GalleryCardThumb item={item} now={now} onUnresolvable={hideUnresolvable} />
                  <span className="wb2-cv-meta">
                    <span className="wb2-cv-n">{displayNameOf(item)}</span>
                    <span className="wb2-cv-s">{KIND_LABEL[item.kind]} · {formatRelativeTime(item.time, now)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
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
                    outMs={delLeave.get(item.path)}
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
                outMs={delLeave.get(item.path)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 类别筛选已上移到工具条（刷新钮之后），此处不再重复渲染 */}

      {/*
        预览弹窗（2026-10-19 重做样式）。上界守卫必须带：gonePaths 剔除条目后
        visible 会缩短，旧下标可能越界 —— 越界时组件内部 item === undefined
        会 return null，不崩但弹窗凭空消失，比不显示更怪。

        取图地址分两类：磁盘成品走画廊 /raw（索引即白名单）；生图/生视频的
        内容只在 spill 里，由组件自己经 resolveGeneratedUrls 解析成 data URL。
      */}
      {lightboxIndex !== null && lightboxIndex >= 0 && lightboxIndex < visible.length && (
        <MediaLightbox
          items={visible}
          index={lightboxIndex}
          fileUrlOf={(item) => galleryRawUrl(item.path)}
          onNavigate={setLightboxIndex}
          onClose={() => { setLightboxIndex(null) }}
          onOpenSession={(item) => {
            try {
              const ctx = getClientCtx()
              const workspace = ctx?.get?.('uiWorkspace') as { openSession?: (id: string) => void } | undefined
              workspace?.openSession?.(item.sessionId)
              ctx?.get?.('layout')?.selectPanel?.(null)
            } catch { /* 服务不可用：留在弹窗里，不影响预览 */ }
            setLightboxIndex(null)
          }}
          onOpenSidebar={(item) => {
            const session = sessionById.get(item.sessionId)
            const opened = openWorkspacePreview(item.path, {
              sessionId: item.sessionId,
              cwd: session?.cwd ?? undefined,
            })
            if (opened.ok) setLightboxIndex(null)
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
