/**
 * dsh-chat-plus — 多媒体画廊面板（工作台第五个 Tab）。
 *
 * 回答一个问题：**所有对话产出过的图片 / 网页 / 演示 / 文档，在哪儿一次看全。**
 *
 * 布局：工具条（类别 chips + 搜索 + 刷新）→ 会话筛选条（选中某会话时出现）
 * → 卡片网格 → Lightbox。数据来自 host 的 /api/triad/gallery/media（跨会话
 * 增量折叠，stat 核对过才下发）；generated（生图/生视频）条目经既有的
 * /api/chat-flow/generated-images 二次解析成可显示 URL。
 *
 * 三类内容的三种打开方式（与各自的最优预览链路对齐）：
 *  · 图片 / 视频 / 音频 / 网页 → Lightbox 内直接预览（网页走沙箱 iframe，
 *    host 已注入 base 与 CSP sandbox，成品页读不到宿主同源状态）；
 *  · PDF → Lightbox 内嵌 iframe（浏览器自带 PDF 查看器）；
 *  · PPT / Word / Excel → 官方右栏文档预览（tryOpenInSidebar，与对话流里
 *    点文件链接同一条链路），拿不到服务时降级为下载。
 *
 * 动效（渐进式微调，不推翻工作台既有骨架）：卡片入场级联上浮、hover 浮起 +
 * 缩略图缓推、类别徽标下滑浮现、骨架屏微光、Lightbox 缩放入场与关闭钮旋转、
 * 刷新图标旋转。全部尊重 prefers-reduced-motion（样式表里统一关）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchGalleryMedia,
  formatRelativeTime,
  formatSize,
  galleryRawUrl,
  KIND_LABEL,
  resolveGeneratedUrls,
  type GalleryItem,
  type GalleryKind,
  type GallerySession,
} from './api.js'
import { ensureGalleryStyles } from './styles.js'
import { tryOpenInSidebar } from '../../open-preview.js'
import { getClientCtx } from '../../client-ctx.js'

/** 类别 chips 的展示顺序（全部之后，按产出频率排）。 */
const KIND_ORDER: readonly GalleryKind[] = ['image', 'page', 'video', 'pdf', 'slide', 'sheet', 'doc', 'audio']

/** Lightbox 里直接预览的类别。 */
const INLINE_PREVIEW_KINDS = new Set<GalleryKind>(['image', 'video', 'audio', 'page', 'pdf'])

/** 筛选状态：null = 全部。 */
type KindFilter = GalleryKind | null

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

/* ── generated 缩略图（spill 懒解析）──────────────────────────────────── */

/**
 * 生图/生视频条目的缩略图：spill 文件 2~9MB，不能首屏全解析 ——
 * IntersectionObserver 进视口才请求，解析结果进模块级缓存（重开面板秒回）。
 */
const generatedUrlCache = new Map<string, readonly string[]>()

function GeneratedThumb({ path, alt }: { readonly path: string; readonly alt: string }): JSX.Element {
  const [urls, setUrls] = useState<readonly string[]>(() => generatedUrlCache.get(path) ?? [])
  const [failed, setFailed] = useState(false)
  const holderRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (generatedUrlCache.has(path)) { setUrls(generatedUrlCache.get(path) ?? []); return undefined }
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
      generatedUrlCache.set(path, resolved)
      if (resolved.length === 0) setFailed(true)
      else setUrls(resolved)
    }
  }, [path])

  if (failed) {
    return (
      <div ref={holderRef} className="tg-card__thumb">
        <span className="tg-card__icon"><KindIcon kind="image" size={40} /></span>
      </div>
    )
  }
  const first = urls[0]
  if (first === undefined) {
    // 解析中：占位图标 + 微光（骨架屏同款动画由 thumb 底色承担）。
    return (
      <div ref={holderRef} className="tg-card__thumb">
        <span className="tg-card__icon" style={{ opacity: 0.45 }}><KindIcon kind="image" size={40} /></span>
      </div>
    )
  }
  return (
    <div ref={holderRef} className="tg-card__thumb">
      <img className="tg-card__img" src={first} alt={alt} loading="lazy" decoding="async" data-loaded="true" draggable={false} />
      {urls.length > 1 && <span className="tg-card__kind-dot">{urls.length} 张</span>}
    </div>
  )
}

/* ── 卡片 ────────────────────────────────────────────────────────────── */

/** 磁盘图片的加载态管理：解码完成前不闪白（opacity 0 → 1 过渡）。 */
function FileThumb({ item, now }: { readonly item: GalleryItem; readonly now: number }): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  void now

  if (item.kind === 'image' && !failed) {
    return (
      <div className="tg-card__thumb">
        <img
          className="tg-card__img"
          src={galleryRawUrl(item.path)}
          alt={item.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          data-loaded={loaded ? 'true' : undefined}
          onLoad={() => { setLoaded(true) }}
          onError={() => { setFailed(true) }}
        />
        {!loaded && <span className="tg-card__icon"><KindIcon kind="image" size={40} /></span>}
      </div>
    )
  }
  return (
    <div className="tg-card__thumb">
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
}

const GalleryCard = ({ item, index, sessionTitle, now, onOpen }: CardProps): JSX.Element => (
  <button
    type="button"
    className="tg-card"
    style={{ '--tg-i': Math.min(index, 30) } as CSSProperties}
    onClick={() => { onOpen(item) }}
    title={item.path}
  >
    {item.source === 'generated'
      ? <GeneratedThumb path={item.path} alt={item.name} />
      : <FileThumb item={item} now={now} />}
    <span className="tg-card__kind-dot">{KIND_LABEL[item.kind]}</span>
    <span className="tg-card__meta">
      <span className="tg-card__name">{item.name}</span>
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
  </button>
)

/* ── Lightbox ────────────────────────────────────────────────────────── */

interface LightboxProps {
  readonly items: readonly GalleryItem[]
  readonly index: number
  readonly sessionOf: (item: GalleryItem) => GallerySession | undefined
  readonly onNavigate: (index: number) => void
  readonly onClose: () => void
  readonly onOpenSession: (item: GalleryItem) => void
}

function Lightbox({ items, index, sessionOf, onNavigate, onClose, onOpenSession }: LightboxProps): JSX.Element | null {
  const item = items[index]
  const [closing, setClosing] = useState(false)
  const [genUrls, setGenUrls] = useState<readonly string[] | null>(null)
  const closeTimer = useRef<number | null>(null)

  // generated 条目：打开时解析 spill（缓存命中则同步返回）。
  useEffect(() => {
    if (item === undefined || item.source !== 'generated') { setGenUrls(null); return }
    const cached = generatedUrlCache.get(item.path)
    if (cached !== undefined) { setGenUrls(cached); return }
    let alive = true
    void resolveGeneratedUrls(item.path).then((urls) => {
      generatedUrlCache.set(item.path, urls)
      if (alive) setGenUrls(urls)
    })
    return () => { alive = false }
  }, [item])

  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, 150)
  }, [closing, onClose])

  const step = useCallback((delta: number) => {
    if (items.length <= 1) return
    onNavigate((index + delta + items.length) % items.length)
  }, [items.length, index, onNavigate])

  // 键盘：Esc 关闭，左右翻页（只有可内联预览的条目间跳，其余直接顺移）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); requestClose() }
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [requestClose, step])

  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }, [])

  if (item === undefined) return null
  const session = sessionOf(item)
  const download = (): void => {
    const anchor = document.createElement('a')
    anchor.href = galleryRawUrl(item.path)
    anchor.download = item.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
  const openSidebar = (): void => {
    if (tryOpenInSidebar(item.path, { sessionId: item.sessionId, cwd: session?.cwd ?? undefined })) requestClose()
    else download()
  }

  /** 主体预览。 */
  const body = (): JSX.Element => {
    if (item.source === 'generated') {
      if (genUrls === null) {
        return (
          <div className="tg-lb__loading">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
            <span>正在解析生图结果…</span>
          </div>
        )
      }
      if (genUrls.length === 0) {
        return <div className="tg-lb__loading"><span>生图结果已过期（spill 文件不在了）</span></div>
      }
      return (
        <div className="tg-lb__genrow">
          {genUrls.map((url) => (
            <img key={url.slice(0, 64)} className="tg-lb__img" src={url} alt={item.name} draggable={false} />
          ))}
        </div>
      )
    }
    const raw = galleryRawUrl(item.path)
    switch (item.kind) {
      case 'image':
        return <img className="tg-lb__img" src={raw} alt={item.name} draggable={false} />
      case 'video':
        return <video className="tg-lb__video" src={raw} controls autoPlay preload="metadata" />
      case 'audio':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <span style={{ color: '#9ca3af' }}><KindIcon kind="audio" size={72} /></span>
            <audio src={raw} controls autoPlay preload="metadata" />
          </div>
        )
      case 'page':
        // 沙箱 iframe：host 已注入 base 与 CSP sandbox；这里再不给
        // allow-same-origin，成品页落在不透明源，读不到宿主任何状态。
        return (
          <iframe
            className="tg-lb__frame"
            src={raw}
            title={item.name}
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
          />
        )
      case 'pdf':
        return <iframe className="tg-lb__frame" src={raw} title={item.name} />
      default:
        // slide / sheet / doc：不进 Lightbox 内联（浏览器渲染不了 Office 格式），
        // 走到这里说明调用方没先分流 —— 给一个占位与两个出口。
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: '#c7ccd4' }}>
            <KindIcon kind={item.kind} size={72} />
            <span style={{ fontSize: 13 }}>该格式不支持页内预览</span>
          </div>
        )
    }
  }

  return createPortal(
    <div
      className="tg-lb"
      data-closing={closing ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      onClick={requestClose}
    >
      <div className="tg-lb__stage" onClick={(event) => { event.stopPropagation() }}>
        <button type="button" className="tg-lb__close" aria-label="关闭" onClick={requestClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {items.length > 1 && (
          <>
            <button type="button" className="tg-lb__nav tg-lb__nav--prev" aria-label="上一个" onClick={() => { step(-1) }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <button type="button" className="tg-lb__nav tg-lb__nav--next" aria-label="下一个" onClick={() => { step(1) }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </>
        )}
        {body()}
        <div className="tg-lb__meta">
          <span className="tg-lb__name" title={item.path}>{item.name}</span>
          <span className="tg-lb__dim">{KIND_LABEL[item.kind]} · {formatRelativeTime(item.time)}{item.source === 'file' && item.size > 0 ? ' · ' + formatSize(item.size) : ''}</span>
          <span className="tg-lb__actions">
            {session !== undefined && (
              <button type="button" className="tg-lb__btn" onClick={() => { onOpenSession(item) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                打开会话
              </button>
            )}
            <button type="button" className="tg-lb__btn" onClick={openSidebar}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
              预览文档
            </button>
            {item.source === 'file' && (
              <button type="button" className="tg-lb__btn" onClick={download}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5" /><path d="M4 19h16" /></svg>
                下载
              </button>
            )}
          </span>
        </div>
        <div className="tg-lb__hint">
          {items.length > 1 ? '← / → 翻页 · ' : ''}Esc 或点击空白处关闭{index + 1} / {items.length}
        </div>
      </div>
    </div>,
    document.body,
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
  const [kind, setKind] = useState<KindFilter>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const now = useNow()
  const mounted = useRef(true)

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

  /** 过滤后的展示清单（时间降序，host 已排好，这里只做筛选）。 */
  const visible = useMemo(() => {
    const base = items ?? []
    const needle = query.trim().toLowerCase()
    return base.filter((item) => {
      if (sessionId !== null && item.sessionId !== sessionId) return false
      if (kind !== null && item.kind !== kind) return false
      if (needle !== '') {
        const title = sessionById.get(item.sessionId)?.title ?? ''
        if (!item.name.toLowerCase().includes(needle)
          && !item.path.toLowerCase().includes(needle)
          && !title.toLowerCase().includes(needle)) return false
      }
      return true
    })
  }, [items, sessionId, kind, query, sessionById])

  /** 切换筛选时网格重建（key 变化 → 入场动画重播，形成「换一批」的视觉反馈）。 */
  const gridKey = `${kind ?? 'all'}|${sessionId ?? 'all'}|${query.trim().toLowerCase()}`

  const openItem = useCallback((item: GalleryItem) => {
    // Office 家族（slide/sheet/doc）不进 Lightbox：直接走官方右栏文档预览。
    if (!INLINE_PREVIEW_KINDS.has(item.kind)) {
      const session = sessionById.get(item.sessionId)
      if (tryOpenInSidebar(item.path, { sessionId: item.sessionId, cwd: session?.cwd ?? undefined })) {
        onClose()
        return
      }
      // 拿不到右栏服务（理论上不该发生）：退化为下载。
      const anchor = document.createElement('a')
      anchor.href = galleryRawUrl(item.path)
      anchor.download = item.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      return
    }
    setLightboxIndex(visible.indexOf(item))
  }, [visible, sessionById, onClose])

  /** 跳到条目所属会话：官方 uiWorkspace.openSession + 关掉工作台页。 */
  const openSessionOf = useCallback((item: GalleryItem) => {
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
      {/* 工具条 */}
      <div className="tg-toolbar">
        <div className="tg-kinds">
          <button
            type="button"
            className="tg-kind"
            data-active={kind === null ? 'true' : undefined}
            onClick={() => { setKind(null) }}
          >
            全部
            <span className="tg-kind__count">{totalCount}</span>
          </button>
          {KIND_ORDER.filter((entry) => (kindCounts.get(entry) ?? 0) > 0 || kind === entry).map((entry) => (
            <button
              key={entry}
              type="button"
              className="tg-kind"
              data-active={kind === entry ? 'true' : undefined}
              onClick={() => { setKind(kind === entry ? null : entry) }}
            >
              {KIND_LABEL[entry]}
              <span className="tg-kind__count">{kindCounts.get(entry) ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="tg-search">
          <span className="tg-search__icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          </span>
          <input
            className="tg-search__input"
            type="search"
            placeholder="搜文件名 / 路径 / 会话标题…"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </label>
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
              : '换一个类别、清空搜索词，或清除会话筛选试试。'}
          </span>
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
              />
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && lightboxIndex >= 0 && (
        <Lightbox
          items={visible}
          index={lightboxIndex}
          sessionOf={(item) => sessionById.get(item.sessionId)}
          onNavigate={setLightboxIndex}
          onClose={() => { setLightboxIndex(null) }}
          onOpenSession={(item) => { openSessionOf(item); setLightboxIndex(null) }}
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
