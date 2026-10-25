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
 *
 * 类别导航的去向（2026-10-25）——**导航在侧栏，操作在页内**：
 * 用户要求「画廊的分类也可以变为二级菜单」，于是 8 个类别的主入口搬进侧栏
 * 「操作间 → 画廊」，页内那条芯片条降级成一条**精简胶囊条**，只做侧栏做不到的
 * 三件事：切一下当前批次、看这一类实时有几条、把这一类整批删掉（分类删除与
 * 实时计数侧栏都没有，整条删掉就是丢功能）。所以它保留功能、去掉图标并收窄
 * 字号行高，视觉上明确从「主导航」退成「次级筛选」。类别的真值与侧栏双向同步，
 * 通道见 hub/workbench-intent.ts（两个 React 根之间没有别的通路）。
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
  materializeGenerated,
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
import { openWithDefaultApp } from '../../open-default-app.js'
import { openWithDefaultBrowser } from '../../open-file.js'
import { readGalleryKind, requestGalleryKind, subscribeWorkbenchIntent } from '../hub/workbench-intent.js'

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

/* ── 单卡删除的节奏常量 ────────────────────────────────────────────────
 *
 * 与 kr-chat 的 KrMemoryCard 同一套节奏参数（错峰 45ms、封顶 900ms），只是
 * 这里的单位是「卡片」：两处同频，用户在一个产品里学一次就够了。
 *
 * 2026-10-25：分类删除（一次清空一整类）随页内类别胶囊栏一起删除，原先为它
 * 服务的「确认态自动回退 6s」常量与「第 N 张卡片错峰」函数已无消费方，一并删。
 * 单卡删除仍是「点一次进确认态、再点一次真删」，但它由 delItemPath 自己管。
 */

/** 每张卡片错峰退场的间隔（毫秒）。 */
const DEL_STAGGER_MS = 45

/** 单张卡片退场动画时长（毫秒），与 styles.ts 的 tg-card-out 成对维护。 */
const DEL_CARD_MS = 260

/** 错峰等待封顶：条目多时不再线性拉长，否则点一下要等好几秒才发请求。 */
const DEL_STAGGER_CAP = 900

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
  /** 就地预览（卡片右下角那枚眼睛）：只在这里看，不交给外部程序。 */
  readonly onPreview: (item: GalleryItem) => void
  /** 缩略图确认读不到时上报路径（面板把该条目从清单里剔掉）。 */
  readonly onUnresolvable?: (path: string) => void
  /**
   * 单独删除这一条（卡片右上角那枚垃圾桶，2026-10-24 用户要求）。
   * 不传就不渲染这枚按钮（轮播等场景用不上）。
   */
  readonly onDelete?: (item: GalleryItem) => void
  /** 这一条正处在「再点一次才真删」的确认态。 */
  readonly deleteArmed?: boolean
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

const GalleryCard = ({ item, index, sessionTitle, now, onOpen, onPreview, onUnresolvable, onDelete, deleteArmed = false, compact = false, outMs }: CardProps): JSX.Element => {
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
    // 键盘路径的单卡删除：卡片聚焦后按 Delete / Backspace 与鼠标点垃圾桶同一套
    // 两拍语义（第一次进确认态、第二次真删）。垃圾桶那枚对读屏是隐藏的，
    // 所以键盘用户必须能从卡片本身发起这件事，否则「单卡删除」对他们不存在。
    onKeyDown={onDelete === undefined ? undefined : (event) => {
      if (leaving) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      event.preventDefault()
      event.stopPropagation()
      onDelete(item)
    }}
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
    {/*
      就地预览的快捷点（2026-10-20）。
      主点击换成了「用系统默认应用打开」，但画廊作为**浏览工具**的那一面不能丢：
      扫一眼十几张图的时候，每张都开外部程序是灾难。这枚小按钮 hover / 聚焦时
      浮现在卡片右下角，只负责「在这里看看」，不进无障碍树（读屏用户走 Enter =
      默认应用，那是这一格的主语义，多一个 Tab 站只会更绕）。
      span 而不是 button：卡片本体就是 <button>，button 不能嵌套 button。
    */}
    <span
      className="tg-card__peek"
      title="就地预览"
      aria-hidden="true"
      style={deleteArmed ? { display: 'none' } : undefined}
      onClick={(event) => {
        if (leaving) return
        event.stopPropagation()
        onPreview(item)
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="2.6" />
      </svg>
    </span>
    {/*
      单卡删除（2026-10-24 用户要求）：hover / 聚焦时浮现在卡片右上角。
      与工具条上的「按分类删除」是两条独立路径 —— 那里一次清一整类，这里只清这一条。

      第一次点**只进确认态**（按钮原地变成红底 + 「删除?」），再点一次才真删；
      确认态由面板统一持有（deleteArmed），所以鼠标移开、移回来时它不会自己消失，
      也不会出现「一张卡片已经确认、另一张也显示确认」的错位。点别处 / Esc 取消。

      span 而不是 button：卡片本体就是 <button>，button 不能嵌套 button。
    */}
    {onDelete !== undefined && (
      <span
        className="tg-card__del"
        // 不进无障碍树：卡片本体是 <button>，在里面再放一个 role=button 属于
        // interactive content 嵌套（HTML 违规，读屏会念两遍）。键盘用户的路径是
        // **卡片聚焦后按 Delete 键**（见下面 onKeyDown），那条路径有完整的
        // aria 语义；这一枚只管鼠标。
        aria-hidden="true"
        title={deleteArmed ? '再点一次即从磁盘删除（不可恢复）' : '删除这一项…'}
        data-armed={deleteArmed ? 'true' : undefined}
        onClick={(event) => {
          if (leaving) return
          event.stopPropagation()
          onDelete(item)
        }}
      >
        {deleteArmed
          ? <span className="tg-card__del-text">删除?</span>
          : <TrashIcon size={12} />}
      </span>
    )}
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
  const [kind, setKind] = useState<KindFilter>(() => readGalleryKind())
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
  /** 时间轴已收起的日期 key 集合（默认全展开）。 */
  const [collapsedDays, setCollapsedDays] = useState<ReadonlySet<string>>(() => new Set())
  /** 显式时间筛选（时钟钮弹层设置）；null = 不限。 */
  const [timeFilter, setTimeFilter] = useState<TimeRange | null>(null)
  const [timePopover, setTimePopover] = useState(false)
  /** 自定义区间的两个 date input（弹层内）。 */
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const now = useNow()
  const mounted = useRef(true)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  /* ── 类别意图通道（2026-10-25）────────────────────────────────────────
   *
   * 侧栏与画廊页是两个互不相邻的 React 根（侧栏是插进官方 DOM 的裸节点），
   * 没有共同祖先、也没有共享 context，所以「侧栏点一行 → 这里换一批」只能
   * 走 hub/workbench-intent.ts（localStorage 回填 + window 事件原地切换）。
   *
   * 三个方向缺一都会静默分叉（侧栏高亮 PDF、页面显示图片）：
   *  · 初值  —— useState 初始化时 readGalleryKind()，从侧栏进来不必再点一次；
   *  · 收意图 —— 订阅事件，读回目标类别；
   *  · 回写  —— 页面内改变类别时 requestGalleryKind()，侧栏高亮跟得上。
   *
   * **必须做变更检测**：记忆页的工作区意图广播到同一个事件上，若「有事件就
   * setState」，切记忆工作区会顺手把画廊重渲染一遍；更糟的是侧栏与页面各自
   * 回写会互相触发成环。所以值没变就不 set。
   *
   * 反过来，「从意图来」的那条**不回写** —— 它就是侧栏写下的值，再写一次
   * 只是把同一个事件绕回自己。
   */

  /** 页面内改类别：先改本地，再回写给侧栏（唯一写入口，自动回切也走它）。 */
  const changeKind = useCallback((next: KindFilter) => {
    setKind(next)
    requestGalleryKind(next)
  }, [])

  useEffect(() => subscribeWorkbenchIntent(() => {
    const next = readGalleryKind()
    setKind((current) => (current === next ? current : next))
  }), [])

  /* ── 单卡删除（2026-10-24）──────────────────────────────────────────
   *
   * 2026-10-25 起，按分类批量删除（一次清空整个「图片」分类）随页内的类别
   * 胶囊栏一起删除：类别的主入口已经在侧栏二级菜单（操作间 → 画廊），页内那
   * 条胶囊栏整条去掉，挂着它的「分类删除」也就没有容身处了。单卡删除不受影响，
   * 仍然是每条卡片右侧那枚垃圾桶。
   *
   * 下面这几个状态**只服务单卡删除**，与已删除的分类删除无关：
   *   delItemPath   待确认的路径（再点一次就真删）
   *   delItemBusy   请求在飞的路径集合
   *   delLeave      正在退场的路径 → 延迟量（错峰动画期间卡片仍在 DOM 里）
   *   delError      删除失败/部分失败的一行提示
   */
  const [delItemPath, setDelItemPath] = useState<string | null>(null)
  /** 单卡删除请求在飞的路径（同一时刻可能只有一条，用 Set 是为了将来放开并发）。 */
  const [delItemBusy, setDelItemBusy] = useState<ReadonlySet<string>>(() => new Set())
  const [delLeave, setDelLeave] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [delError, setDelError] = useState<string | null>(null)

  /**
   * 清单代次：退场动画期间用户刷新/切筛选时用它判断「这批还算不算当前视图」
   * —— 代次变了就别再触发一次全量拉取（那次刷新自己会做）。
   * 单卡删除用它；原先的分类删除也共用这一份。
   */
  const delGenRef = useRef(0)
  /** 退场动画期间的挂起定时器（卸载时收掉）。 */
  const delTimersRef = useRef<number[]>([])

  // 卸载：把退场等待里的定时器收干净（setState 在 React 18 下是无害 no-op，
  // 但继续 await 完请求会让"删除中"停在真空中）。
  useEffect(() => () => {
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

  /* 载入后**不再**自动切走「当前类别一条都没有」的情况（2026-10-25 改）。
   *
   * 历史：这里原本有一段「0 条就回落到首个有内容的类别」，是给**页内芯片条**
   * 时代写的兜底 —— 那时类别只有一排芯片可点，落在空类别上等于给用户一屏空白，
   * 自动带他去有东西的地方算体贴。
   *
   * 但现在（本次改造）类别的主入口搬到了**侧栏二级菜单**，语义全变了：
   *   · 用户是在侧栏**明确点了「PDF」**，页面却自己跳到「图片」，等于否掉了
   *     他刚刚那一下 —— 侧栏还亮着 PDF、页面显示图片，两处当场分叉；
   *   · 空类别本身是有意义的信息（「这一类我还没产出过」），该显示空态，
   *     而不是偷偷换成另一类；
   *   · 而且这段逻辑会**回写意图**，把侧栏高亮也一起改掉，用户点第二下都没反应
   *     （值没变、事件不变）。
   *
   * 所以彻底去掉自动回落，空类别就老老实实显示空态。用户想去别的类别，
   * 侧栏就在旁边，一步就到。 */

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

  /** 折叠/展开某一天。 */
  const toggleDay = useCallback((key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** 是否全部日期组都已折叠。 */
  const allCollapsed = dayGroups.length > 0 && dayGroups.every((group) => collapsedDays.has(group.key))

  /** 全部折叠 ⇄ 全部展开。 */
  const toggleAllDays = useCallback(() => {
    setCollapsedDays((prev) => {
      if (dayGroups.length === 0) return prev
      const isAll = dayGroups.every((group) => prev.has(group.key))
      if (isAll) return new Set()
      return new Set(dayGroups.map((group) => group.key))
    })
  }, [dayGroups])

  /**
   * 「换一批」的视觉反馈 —— **不再靠 key 重建整棵子树**（2026-10-25 改）。
   *
   * 原先这里是 `key={gridKey}`（gridKey 里含 kind），意图是让容器整体重建、
   * 顺带重播 `.tg-card` 的入场动画。实测代价极大：
   *   · 切到「图片」（140 张卡片）→ 整棵子树重建，**145 个 <img> 全部重新创建**，
   *     主线程出现 67ms 长任务，从点击到卡片稳定要 **1.3–1.7 秒**；
   *   · 切到「网页」（9 张）只要 ~100ms —— 差值几乎完全来自缩略图重建数量。
   * 用户报的「画廊切换二级菜单很慢有延迟」就是这个。
   *
   * 关键：**入场动画本来就不需要 key**。`.tg-card` 的
   * `animation: tg-card-in 320ms ... backwards` 挂在卡片自身的 CSS 上，
   * 元素一旦被创建就会播；切换类别时新出现的卡片自然播一次，而**已经存在的
   * 卡片（同一 path）会被 React 复用、不重播** —— 这恰恰是我们想要的：
   * 换类别时大部分卡片本来就该原样留着。
   *
   * 所以 key 只保留「必须整棵重建」的那一维：**视图形态**（网格 ⇄ 时间轴）。
   * 这两种布局的 DOM 结构完全不同（一个是 grid，一个是按天分组的 section），
   * 复用节点没有意义。
   */
  const viewKey = view

  /**
   * 渐进式渲染的「已渲染条数」。
   *
   * 为什么需要（2026-10-25 用户报「画廊切换二级菜单很慢有延迟」）：
   * 实测切换方向不同、耗时差一个量级 ——
   *   · 图片(140) → 网页(9)：首次变化 8–12ms，完全稳定 55–93ms；
   *   · 任意 → 图片(140)：首次变化 54–100ms，完全稳定 **344–467ms**。
   * 差异全在「一次要挂 140 张卡片」：每张卡片要建 DOM、起 CSS 入场动画、
   * 解码缩略图，140 张挤在同一帧里，浏览器只能排队处理。
   *
   * 做法：先渲染首屏够用的**一批**（保证「点了立刻有反应」），剩下的按帧补齐。
   * 用户感知就从「等半秒看空白」变成「立刻看到前几十张、其余陆续到位」。
   *
   * 三条约束：
   *   · 首批必须**足够填满一屏**，否则用户会看到「先出来几个、下面一片空」，
   *     比等一下更慌 —— 按 4 列 × 6 行 ≈ 24 张取 30；
   *   · 补齐用 requestAnimationFrame 而不是 setTimeout：跟着浏览器自己的帧走，
   *     帧率高时补得快、主线程忙时自动让路；
   *   · 切换筛选（kind/搜索/时间/会话）时重置回首批 —— 那是一个全新的清单。
   */
  const FIRST_BATCH = 30
  const BATCH_SIZE = 60
  const [renderLimit, setRenderLimit] = useState(FIRST_BATCH)

  // 清单变了就回到首批（依赖用「决定清单内容的那些筛选」，不含 items 本身，
  // 否则刷新数据也会把已经补齐的列表又缩回去，滚到一半会跳）。
  useEffect(() => {
    setRenderLimit(FIRST_BATCH)
  }, [kind, sessionId, query, view, effectiveRange?.from, effectiveRange?.to])

  // 还有没渲染完的就按帧继续补，直到补齐或清单变化。
  useEffect(() => {
    if (renderLimit >= visible.length) return undefined
    let cancelled = false
    let raf = 0
    const step = (): void => {
      if (cancelled) return
      setRenderLimit((current) => {
        const next = current + BATCH_SIZE
        return next >= visible.length ? visible.length : next
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [renderLimit, visible.length])

  /* ── 当前是否有任何筛选 ──────────────────────────────────────────────
   *
   * 2026-10-25 起，这里只剩 hasFilter 一个消费方（空态文案要区分「真的一条
   * 都没有」与「被筛选筛没了」）。原先配套的 totalOf / kindTotals / truncated
   * 一整套「真实计数」口径随页内类别胶囊栏一起删除 —— 那个数字唯一的去处就是
   * 胶囊上的计数徽标，胶囊没了就没有消费方，留着只会让 load() 白解析两个字段。
   */
  const hasFilter = sessionId !== null || effectiveRange !== null || query.trim() !== ''

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
   * 打开一个条目：**先交给系统默认应用**（2026-10-20 按用户要求改）。
   *
   * 这条路径的沿革，一次写清免得再绕回去：
   *  1. 2026-10-06 前：按扩展名分裂（Office 走右栏、其余进弹窗）；
   *  2. 2026-10-19 上旬：全部改走官方右栏 —— 代价是**离开画廊**：官方右栏在
   *     全局面板占主列时整个 hidden，点一张图必然把工作台页关掉、跳回会话；
   *  3. 2026-10-19 下旬：画廊回到**就地弹窗**；
   *  4. **现在（2026-10-20）**：点卡片 = **用系统默认应用打开这个文件**。
   *     画廊是「我产出的东西在哪儿」的入口，用户真正想干的是「拿它去用」
   *     （PPT 拿去改、视频拿去播、图拿去发），而不是在浏览器里再看一遍。
   *     打开走官方 `remote.session.openWorkspacePath`（`shell-open` 语义，
   *     与双击文件同一套默认程序解析），细节见 `../../open-default-app.ts`。
   *
   * **内置预览没有消失，只是降级成了兜底**：
   *   · `unavailable` —— 这台宿主没有桌面（手机远程 / 纯服务端部署）。此时
   *     **原样**走回原来的弹窗 / 右栏分流，行为与升级前一致；
   *   · `failed` —— 有桌面但这次调用被拒。同样退回内置预览，**不剔除条目**：
   *     文件是否存在由 host 的 /media 核对与缩略图读取负责，与这一跳无关
   *     （`failed` 的真实语义见 open-default-app.ts 的实测说明）。
   *
   * 生图（`source === 'generated'`）特殊：它的 `path` 是 spill 容器（一个
   * `.txt`），默认应用打开它只会弹记事本。所以先经 `materializeGenerated` 把
   * 图片解码成真实 `.png` / `.mp4`，再打开那个文件；落盘失败就退回弹窗 ——
   * 弹窗里本来就能直接看图，不必为此报错。
   */
  const openItem = useCallback((item: GalleryItem) => {
    /** 退回既有链路：可内联的进弹窗，不可内联的走官方右栏（与升级前一致）。 */
    const fallback = (): void => {
      if (!canInlinePreview(item.kind, item.path)) {
        openWorkspacePreview(item.path, {
          sessionId: item.sessionId,
          cwd: sessionById.get(item.sessionId)?.cwd ?? undefined,
        })
        return
      }
      setLightboxIndex(visible.indexOf(item))
    }

    /*
     * 2026-10-21：主出口从官方 openWithDefaultApp 换成**本插件 /api/chat-flow/open-file**。
     * 理由只有一条：Windows 上官方 opener 从不把 .html 交给默认浏览器（它只认
     * 文件关联），画廊里的「页面」类条目点开可能落到编辑器上。新链路对**绝对
     * 路径**的行为与官方一致（画廊条目的 path 在 extract.ts 里已绝对化），
     * 差别只是浏览器文档会走浏览器；'unavailable' 时仍退回官方链路。
     */
    const openAbsolute = (target: string): void => {
      void openWithDefaultBrowser(target).then((result) => {
        if (result === 'opened') return
        if (result === 'unavailable') {
          void openWithDefaultApp(target).then((legacy) => { if (legacy !== 'opened') fallback() })
          return
        }
        fallback()
      })
    }

    if (item.source === 'generated') {
      void materializeGenerated(item.path).then((files) => {
        const materialized = files[0]?.path
        if (materialized === undefined) { fallback(); return }
        openAbsolute(materialized)
      })
      return
    }

    openAbsolute(item.path)
  }, [visible, sessionById])

  /**
   * 就地预览：**只在这里看**，不交给外部程序。
   *
   * 入口是卡片右下角那枚眼睛（hover / 聚焦浮现）。扫一眼十几张图的时候，
   * 「每张都开一个外部窗口」是灾难 —— 画廊另一半价值就是快速比较。
   *
   * 可内联的进弹窗；不可内联的（rtf / csv 这类同类别但引擎不认的扩展名）
   * 仍走官方右栏 —— 那里至少有文件信息与下载入口，比一屏「不支持预览」好。
   */
  const previewItem = useCallback((item: GalleryItem) => {
    if (!canInlinePreview(item.kind, item.path)) {
      openWorkspacePreview(item.path, {
        sessionId: item.sessionId,
        cwd: sessionById.get(item.sessionId)?.cwd ?? undefined,
      })
      return
    }
    setLightboxIndex(visible.indexOf(item))
  }, [visible, sessionById])

  /* ── 单卡删除（2026-10-24）─────────────────────────────────────────── */

  /** 取消单卡删除的确认态（点别处 / Esc / 再点一次之后都要先收）。 */
  const cancelItemDel = useCallback(() => { setDelItemPath(null) }, [])

  /**
   * 点卡片右上角那枚垃圾桶。
   *
   * 两拍：**第一次只进确认态**，第二次才真删。这里删的是磁盘文件、不可逆，
   * 而这张卡片只有 180px 宽，误触概率比工具条上的芯片高得多 —— 所以必须
   * 有一道就地确认，而不是弹系统对话框（那会把浏览节奏打断）。
   *
   * 确认态**不设自动回退**：用户的视线就在这张卡上，一秒钟都没移开；
   * 自动收回反而会让「我刚点了确认、怎么没删」变成一次静默失败。
   * 取消出口是点别处 / Esc / 再点一次别的东西。
   *
   * 删除成功后与分类删除走同一个出口（rememberGone + 重新拉一次索引），
   * 所以工具条上的分类计数会同步减一，不会出现「卡片没了、数字还在」。
   */
  const runItemDel = useCallback(async (item: GalleryItem): Promise<void> => {
    if (delItemBusy.has(item.path)) return
    if (delItemPath !== item.path) {
      // 第一次点：进确认态（同时收掉别处的确认态，屏幕上永远只有一个「删除?」）。
      setDelError(null)
      setDelItemPath(item.path)
      return
    }
    // 第二次点：真删。
    setDelItemPath(null)
    setDelItemBusy((prev) => new Set(prev).add(item.path))
    setDelError(null)
    const generation = delGenRef.current
    // 先播退场动画再发请求：与分类删除同一套节奏（单条就是 0 延迟 + 260ms）。
    setDelLeave(new Map([[item.path, 0]]))
    await new Promise<void>((resolvePromise) => {
      const timer = window.setTimeout(resolvePromise, delAnimationMs(1))
      delTimersRef.current.push(timer)
    })
    if (!mounted.current) { setDelItemBusy((prev) => { const next = new Set(prev); next.delete(item.path); return next }); return }

    const result = await deleteGalleryPaths([item.path])
    if (!mounted.current) return

    const failedPaths = new Set((result.failed ?? []).map((entryFail) => entryFail.path))
    const removed = result.ok === true || (result.deleted ?? 0) > 0
      ? (failedPaths.has(item.path) ? [] : [item.path])
      : []
    rememberGone(removed)

    setDelLeave(new Map())
    setDelItemBusy((prev) => { const next = new Set(prev); next.delete(item.path); return next })

    if (removed.length > 0) {
      if (delGenRef.current === generation) void load(false)
      return
    }
    const first = (result.failed ?? [])[0]
    setDelError(first !== undefined
      ? `「${displayNameOf(item)}」没删掉：${humanDeleteReason(first.error)}`
      : `「${displayNameOf(item)}」没删掉：${result.message ?? '删除失败'}`)
  }, [delItemBusy, delItemPath, rememberGone, load])

  // 点别处 / Esc → 收回单卡确认态。判据与分类确认态同构：点在**另一枚**垃圾桶上
  // 不算「别处」（那一枚会自己进确认态，收掉旧的正是我们要的）。
  useEffect(() => {
    if (delItemPath === null) return undefined
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      const hit = target instanceof Element ? target.closest('.tg-card__del') : null
      const owner = hit?.closest('.tg-card') as HTMLElement | null
      // 卡片自身的 title 是绝对路径 —— 用它判「点的是不是这一张」，
      // 避免再往 DOM 上挂一份冗余的 data-path。
      if (owner?.getAttribute('title') !== delItemPath) setDelItemPath(null)
    }
    /**
     * Esc 取消确认态。
     *
     * **必须拦在 capture 阶段并 stopPropagation**：官方布局层自己有一条
     * 「Esc 关闭当前工作台面板」的全局监听（实测无确认态时按 Esc 会直接关掉
     * 整个画廊）。若这里只在冒泡阶段处理，用户按 Esc 想反悔，结果面板先被
     * 关掉、确认态跟着一起消失 —— 看起来像「按 Esc 就把画廊关了」。
     * 确认态存在时这一下 Esc 只属于确认态。
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setDelItemPath(null)
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [delItemPath])

  // 每次清单/筛选变化都推进代次：退场动画期间用户切了筛选或刷新，这次删除就不再
  // 去认领新清单（卡片早已从可见集合里消失，认领会把不相干的东西标成"正在退场"）。
  useEffect(() => { delGenRef.current += 1 }, [items, kind, sessionId, query, timeFilter])

  /* ── 工具条右侧那个总数 ───────────────────────────────────────────────
   *
   * 不能直接数 items.length：刚删掉的条目在 host 下一次 /media 回来之前仍留在
   * items 里（客户端还有 15s 索引缓存），那时右边写着「199 项」而清单里已经少了
   * 几条 —— 同一块工具条上两个数字互相打脸。所以这里与清单同口径剔除。
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
        {/* 右侧工具组：时间 / 视图 / 数量 / 刷新。
            （原先中间还有一排类别胶囊，2026-10-25 按用户要求整条删除 —— 类别
            入口在侧栏二级菜单里。）
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
        {/* 时间轴视图下的全部收起 / 全部展开快捷按钮 */}
        {view === 'timeline' && dayGroups.length > 0 && (
          <button
            type="button"
            className="tg-icon-btn"
            title={allCollapsed ? '展开全部日期' : '收起全部日期'}
            aria-label={allCollapsed ? '展开全部日期' : '收起全部日期'}
            onClick={toggleAllDays}
          >
            {allCollapsed ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 6l5 5 5-5M7 13l5 5 5-5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 11l5-5 5 5M7 18l5-5 5 5" />
              </svg>
            )}
          </button>
        )}
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
           数据是真条目，点击任意一张 = 用默认应用打开（与网格同一入口）。
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
                  // 分类删除已随胶囊栏删除，卡片点击不再需要「删除进行中」的锁。
                  // 单卡删除进行中的锁由卡片自己（delItemBusy）承担。
                  onClick={() => { openItem(item) }}
                  title={displayNameOf(item)}
                >
                  <GalleryCardThumb item={item} now={now} onUnresolvable={hideUnresolvable} />
                  {/* 与网格卡片同一枚「就地预览」快捷点：轮播里的主点击也是默认应用打开。 */}
                  <span
                    className="tg-card__peek wb2-cv__peek"
                    title="就地预览"
                    aria-hidden="true"
                    onClick={(event) => {
                      event.stopPropagation()
                      previewItem(item)
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="2.6" />
                    </svg>
                  </span>
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
          {/*
            * 三档空态文案。中间的「这一类还没有内容」是 2026-10-25 新增的：
            * 类别入口搬到侧栏二级菜单后，用户点一个空类别（如 PDF）会**停在这
            * 里**（不再自动弹回有内容的类别），所以必须有一句话明确回答「这一类
            * 确实没有」，否则一屏空白会被当成页面坏了。
            * 判据用 else 分支而不是精确相等：只要不是「全空」也不是「其它筛选
            * 造成为空」，剩下的就只可能是「当前类别自身为空」。
            */}
          <span className="tg-empty__title">
            {totalCount === 0
              ? '还没有多媒体产出'
              : !hasFilter && (kindCounts.get(kind) ?? 0) === 0
                ? `「${KIND_LABEL[kind]}」这一类还没有产出`
                : '没有匹配的条目'}
          </span>
          <span className="tg-empty__hint">
            {totalCount === 0
              ? '对话中生成的图片、网页、演示、文档、音视频会出现在这里。产出物来自全部会话的工具调用记录，新对话完成后点右上角刷新即可看到。'
              : !hasFilter && (kindCounts.get(kind) ?? 0) === 0
                ? `侧栏「画廊」下换一个类别（图片 / 网页 / 视频 / PDF / 演示 / 表格 / 文档 / 音频），或直接在对话里产出${KIND_LABEL[kind]}类内容。`
                : '换一个类别、清空搜索词或时间筛选（工具条时钟钮），或清除会话筛选试试。'}
          </span>
        </div>
      ) : view === 'timeline' ? (
        /* 时间轴：左侧极简细轨 + 按天折叠，日期头作为收起/展开开关，卡片走 compact 方格。
           key 只随**视图形态**变化（见 viewKey 的说明）：切类别时不再整棵重建。 */
        <div className="tg-scroll" key={viewKey}>
          {dayGroups.map((group, groupIndex) => {
            const isCollapsed = collapsedDays.has(group.key)
            return (
              <section
                className="tg-day"
                key={group.key}
                data-collapsed={isCollapsed ? 'true' : undefined}
                style={{ '--tg-day-i': Math.min(groupIndex, 12) } as CSSProperties}
              >
                <button
                  type="button"
                  className="tg-day__head"
                  onClick={() => { toggleDay(group.key) }}
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? `展开「${group.label}」（${group.items.length} 项）` : `收起「${group.label}」`}
                >
                  <span className="tg-day__dot" aria-hidden="true" />
                  <span className="tg-day__chevron" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                  <span className="tg-day__label">{group.label}</span>
                  <span className="tg-day__weekday">{group.weekday}</span>
                  <span className="tg-day__count">{group.items.length} 项</span>
                </button>
                <div className="tg-day__tiles" aria-hidden={isCollapsed}>
                  {group.items.map((item, index) => (
                    <GalleryCard
                      key={item.path + '|' + item.sessionId}
                      item={item}
                      index={index}
                      sessionTitle={sessionById.get(item.sessionId)?.title ?? null}
                      now={now}
                      onOpen={openItem}
                      onPreview={previewItem}
                      onUnresolvable={hideUnresolvable}
                      onDelete={(target) => { void runItemDel(target) }}
                      deleteArmed={delItemPath === item.path}
                      compact
                      outMs={delLeave.get(item.path)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="tg-scroll">
          {/* key 只随视图形态变化：切类别不再重建网格（否则 140 张缩略图全部重载） */}
          <div className="tg-grid" key={viewKey}>
            {visible.slice(0, renderLimit).map((item, index) => (
              <GalleryCard
                key={item.path + '|' + item.sessionId}
                item={item}
                index={index}
                sessionTitle={sessionById.get(item.sessionId)?.title ?? null}
                now={now}
                onOpen={openItem}
                onPreview={previewItem}
                onUnresolvable={hideUnresolvable}
                onDelete={(target) => { void runItemDel(target) }}
                deleteArmed={delItemPath === item.path}
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
          onOpenDefaultApp={(item) => {
            /*
             * 弹窗里的「用默认应用打开」：成功就关掉弹窗（用户已经切到别的程序
             * 去了，留着一个浮层挡在中间没有意义）；失败什么都不做 —— 弹窗本身
             * 已经把这份内容显示在眼前了，再弹一句提示只是噪音。
             */
            const target = item.source === 'generated'
              ? materializeGenerated(item.path).then((files) => files[0]?.path ?? null)
              : Promise.resolve(item.path)
            void target.then((path) => {
              if (path === null) return
              // 与卡片点击同一出口（浏览器文档进默认浏览器），失败退回官方链路。
              void openWithDefaultBrowser(path).then((result) => {
                if (result === 'opened') { setLightboxIndex(null); return }
                if (result !== 'unavailable') return
                void openWithDefaultApp(path).then((legacy) => { if (legacy === 'opened') setLightboxIndex(null) })
              })
            })
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
