/**
 * dsh-chat-plus — 多媒体 Lightbox（画廊与产出物卡共用的全屏预览层）。
 *
 * 从 GalleryPanel 的内部 Lightbox 抽出来独立成组件，因为「按格式分流预览」
 * 这套交互被产出物卡复用了（用户 2026-10-04 要求：产出物行点主体走画廊式
 * 预览、点行尾按钮才走原来的右栏）。
 *
 * 分流规则（INLINE_PREVIEW_KINDS）：
 *  · image  → <img> 直显；
 *  · video / audio → 原生播放器；
 *  · page   → 沙箱 iframe（host 的 /raw 或 /session-raw 已注入 base 与 CSP
 *    sandbox；这里再不给 allow-same-origin，成品页落不透明源）；
 *  · pdf    → iframe 直接指向**插件自己的 /office/pdf**（已经真 PDF，浏览器
 *    自带查看器；用官方 /api/file 那条路在本地 file 基址下会 401/白屏）；
 *  · slide / sheet / doc（PPT / Excel / Word）→ 服务端出页图的图片序列：
 *    LibreOffice 渲染首页 + 页码切换，不再依赖系统 Office 或官方 PDF 链路
 *    （后者要求 TEMP 落在带沙箱写 ACE 的目录，否则 100% 报转换失败）。
 *  · 其余（code …）→ 组件内只给占位与出口按钮。
 *
 * 全屏态（2026-10-04 新增）：右上角一枚展开/收拢钮（F 键同效），进入后预览体
 * 铺满视口、元信息行沉底成渐变浮层、翻页钮收进内侧；Esc 分层——全屏中先退
 * 全屏，再按才关闭。入场有缩放动画，退出即时（iframe 不重挂载，html 预览不闪）。
 *
 * generated（生图/生视频）条目：spill 文件经 resolveGeneratedUrls 解析成可显示
 * URL；解析结果进模块级缓存（网格缩略图与 Lightbox 共享，重开秒回）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  displayNameOf, formatRelativeTime, formatSize, officePageUrl, officePdfUrl, officeRenderable,
  resolveGeneratedUrls, type GalleryKind,
} from './api.js'
import { ensureGalleryStyles } from './styles.js'

/** Lightbox 条目（画廊 GalleryItem 与产出物 OutputItem 的公共超集）。 */
export interface LightboxItem {
  readonly path: string
  readonly name: string
  readonly kind: string
  readonly source: 'file' | 'generated'
  readonly time: number
  readonly size?: number
  readonly sessionId: string
}

/**
 * 可在 Lightbox 内直接预览的类别。
 *
 * 2026-10-06 扩容：原本 ppt / word / excel 被排除在外，理由是「官方右栏有
 * Office 预览」。实测那条路在本机**根本不通**（LibreOffice 转换写盘被沙箱拒，
 * 报 impl_store failed），于是这三类在画廊里点开只有一句「该格式不支持页内
 * 预览」+ 一个必然失败的「预览文档」按钮。现在改由插件自己的 host 路由出
 * 页图，三类一并内联。
 *
 * ⚠ 类别是粗粒度的：`sheet` 里还有 csv / tsv、`doc` 里还有 md / txt，而引擎
 * 只认 `OFFICE_RENDERABLE_EXT`。所以真正的分流判据是 `canInlinePreview()`，
 * 这张表只是「可能内联」的快速过滤（也供产出物卡的行点击复用）。
 */
export const INLINE_PREVIEW_KINDS: ReadonlySet<string> = new Set([
  'image', 'video', 'audio', 'page', 'pdf', 'slide', 'sheet', 'doc',
])

/**
 * 真正的内联预览判据（类别 + 扩展名）。调用方（产出物卡 / 画廊）用它决定
 * 「点开是进 Lightbox 还是回退右栏」——判错了的表现是点一下什么都不发生
 * （Lightbox 里只有一句占位），比直接走右栏更糟。
 *
 * ⚠ `page`（html 成品）必须**先短路放行**：它走的是插件 /raw 的沙箱 iframe，
 * 与 Office 那条「引擎渲染页图」的链路无关，`officeRenderable` 对它一律返回
 * false。曾经的写法直接套 officeRenderable，结果 html 卡片点一下就变成了静默
 * 下载（弹窗根本不开）—— 正是这次要修的「点开没有 UI」换了个形态复现。
 *
 * @param kind - 展示类别。
 * @param path - 文件路径。
 */
export function canInlinePreview(kind: string, path: string): boolean {
  if (!INLINE_PREVIEW_KINDS.has(kind)) return false
  // image / video / audio / page：走原生元素或插件 /raw 的沙箱 iframe，无引擎依赖。
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'page') return true
  // pdf / slide / sheet / doc：需要 host 侧引擎出页图或 PDF。
  return officeRenderable(kind, path)
}

/** spill 解析缓存：路径 → 可显示 URL 列表（网格缩略图与 Lightbox 共享）。 */
export const generatedUrlCache = new Map<string, readonly string[]>()

const svgProps = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
} as const

/** 类别大图标（非内联类别的占位）。 */
function KindIcon({ kind, size = 72 }: { readonly kind: string; readonly size?: number }): JSX.Element {
  const common = { width: size, height: size, viewBox: '0 0 48 48', ...svgProps }
  switch (kind as GalleryKind) {
    case 'audio':
      return (
        <svg {...common}>
          <rect x="6" y="10" width="36" height="28" rx="4" />
          <path d="M16 20v8M24 16v16M32 22v4" strokeWidth="2.4" />
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
      return (
        <svg {...common}>
          <path d="M12 6h16l8 8v28H12z" />
          <path d="M28 6v8h8" />
        </svg>
      )
  }
}

export interface MediaLightboxProps {
  readonly items: readonly LightboxItem[]
  readonly index: number
  /** 条目 → 浏览器可显示 URL（画廊走 /raw，产出物卡走 /session-raw）。 */
  readonly fileUrlOf: (item: LightboxItem) => string
  readonly onNavigate: (index: number) => void
  readonly onClose: () => void
  /** 「打开会话」按钮（画廊用；产出物卡本就身处该会话，不传即不显示）。 */
  readonly onOpenSession?: (item: LightboxItem) => void
  /** 「预览文档」按钮：交给官方右栏文档预览（调用方自行关闭 Lightbox）。 */
  readonly onOpenSidebar?: (item: LightboxItem) => void
}

/** 服务端页图预览的页码上限（与 host 的 MAX_PAGES 一致）。 */
const MAX_PAGE_VIEW = 12

/**
 * PPT / Word / Excel 的页内预览：服务端逐页出 PNG，客户端就是 <img> 序列。
 *
 * 为什么是图片而不是 iframe PDF 查看器：
 *  · 官方那条 PDF 链路要加载 7MB 的 pdf.js chunk，只为看一页 PPT 不值；
 *  · 关键是**侧边栏那条官方 Office 预览在本机是坏的**（见 host 的 office/scratch.ts
 *    根因），把弹窗也压在同一条链路上等于两个地方一起坏；
 *  · 页图天然带「有多少页」这个信息，翻页 UI 因此不用另探一次。
 *
 * 页码与页数从响应头（x-dsh-page / x-dsh-page-count）读：图片请求本身就能带回
 * 元信息，不必先发一次 JSON 探测再发一次图片。
 */
function PagedPreview({ item, full }: { readonly item: LightboxItem; readonly full: boolean }): JSX.Element {
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  // 换条目时回到第一页（上一份文档的页码对新文档无意义）。
  useEffect(() => { setPage(1); setPageCount(0); setFailed(false); setLoading(true) }, [item.path])

  const src = officePageUrl(item.path, item.sessionId, page)
  const total = pageCount > 0 ? Math.min(pageCount, MAX_PAGE_VIEW) : MAX_PAGE_VIEW

  if (failed) {
    return (
      <div className="tg-lb__loading tg-lb__loading--col">
        <KindIcon kind={item.kind} size={64} />
        <span>这一份暂时渲染不出来（引擎或文件状态不支持），可以下载后本地打开。</span>
      </div>
    )
  }

  return (
    <div className="tg-paged" data-full={full ? 'true' : undefined}>
      <img
        className="tg-lb__img tg-paged__img"
        src={src}
        alt={`${item.name} 第 ${page} 页`}
        draggable={false}
        data-loaded={loading ? undefined : 'true'}
        onLoad={() => { setLoading(false) }}
        onError={() => { setFailed(true); setLoading(false) }}
      />
      {loading && (
        <span className="tg-paged__spin" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        </span>
      )}
      {/*
        翻页条：只要不止一页就常驻。
        一开始写成「页数超上限 或 已翻过页」才出现，结果 12 页的 PPT 首页
        只能看到一张图、没有任何「还能往下翻」的线索 —— 用户以为预览就这一页。
        页数是响应头带回来的，首屏通常几十毫秒内就有，不会长期空转。
      */}
      {pageCount > 1 && (
        <div className="tg-paged__bar">
          <button
            type="button"
            className="tg-lb__btn tg-paged__step"
            disabled={page <= 1}
            onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }}
          >
            上一页
          </button>
          <span className="tg-paged__pos">
            {page}{pageCount > 0 ? ` / ${pageCount}` : ''}
            {pageCount > MAX_PAGE_VIEW ? `（预览前 ${MAX_PAGE_VIEW} 页）` : ''}
          </span>
          <button
            type="button"
            className="tg-lb__btn tg-paged__step"
            disabled={pageCount > 0 ? page >= total : page >= MAX_PAGE_VIEW}
            onClick={() => { setLoading(true); setPage((value) => value + 1) }}
          >
            下一页
          </button>
        </div>
      )}
      {/* 页数探测：预取下一页的响应头（不发第二次图片解码开销太大的请求，
          只取头部）。失败静默——翻页按钮仍可用，只是没有总数。 */}
      {pageCount === 0 && (
        <PageCountProbe
          path={item.path}
          sessionId={item.sessionId}
          onCount={(value) => { setPageCount(value) }}
          onFail={() => { /* 引擎不可用由 onError 那条路兜住 */ }}
        />
      )}
    </div>
  )
}

/**
 * 用一次 HEAD 请求读出文档页数。
 *
 * 放在独立组件里是为了让它只挂一次（依赖不变就不重跑），并且与图片加载解耦：
 * 页数拿不到不该让预览失败，图片加载失败也不该被页数探测拖着不显示。
 */
function PageCountProbe({ path, sessionId, onCount, onFail }: {
  readonly path: string
  readonly sessionId: string
  readonly onCount: (value: number) => void
  readonly onFail: () => void
}): JSX.Element | null {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return undefined
    done.current = true
    let alive = true
    void (async () => {
      try {
        const res = await fetch(officePageUrl(path, sessionId, 1), { method: 'HEAD', cache: 'force-cache' })
        const raw = res.headers.get('x-dsh-page-count')
        const value = raw === null ? 0 : Number(raw)
        if (alive && Number.isFinite(value) && value > 0) onCount(value)
        else if (alive) onFail()
      } catch {
        if (alive) onFail()
      }
    })()
    return () => { alive = false }
  }, [path, sessionId, onCount, onFail])
  return null
}

export function MediaLightbox({
  items, index, fileUrlOf, onNavigate, onClose, onOpenSession, onOpenSidebar,
}: MediaLightboxProps): JSX.Element | null {
  // 样式自注入（2026-10-04 修「点一下就跑到下面」的真根因）：tg-* 样式表此前
  // 只在 GalleryPanel 里注入，产出物卡从右栏直接打开本组件时样式表不存在 ——
  // 无样式的 portal div 以普通块排在 body 末尾，把整页内容顶到视口下方，
  // 视觉上就是「一点就跳到底」。共享组件必须自带样式，不能依赖调用方。
  ensureGalleryStyles()
  const item = items[index]
  const [closing, setClosing] = useState(false)
  const [full, setFull] = useState(false)
  const [genUrls, setGenUrls] = useState<readonly string[] | null>(null)
  const closeTimer = useRef<number | null>(null)

  // generated 条目：打开时解析 spill（缓存命中则同步返回）。
  // 缓存只认非空结果：空数组写进缓存会让「这次没解析出来」变成永久结论
  // （服务端修好后 Lightbox 仍显示「已过期」），与画廊缩略图同一条口径。
  useEffect(() => {
    if (item === undefined || item.source !== 'generated') { setGenUrls(null); return }
    const cached = generatedUrlCache.get(item.path)
    if (cached !== undefined && cached.length > 0) { setGenUrls(cached); return }
    let alive = true
    void resolveGeneratedUrls(item.path).then((urls) => {
      if (urls.length > 0) generatedUrlCache.set(item.path, urls)
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

  const toggleFull = useCallback(() => { setFull((value) => !value) }, [])

  // 键盘：Esc 分层（全屏中先退全屏）；←/→ 翻页；F 切全屏。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (full) setFull(false)
        else requestClose()
      } else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'f' || event.key === 'F') toggleFull()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [requestClose, step, full, toggleFull])

  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }, [])

  if (item === undefined) return null

  const download = (): void => {
    const anchor = document.createElement('a')
    anchor.href = fileUrlOf(item)
    anchor.download = item.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
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
    const raw = fileUrlOf(item)
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
        // 直接喂插件自己的 /office/pdf（host 侧已转好并落盘缓存）。
        // 不再用官方 /api/file：那条路在 dsh-app:// 基址下拿不到认证，本地
        // file 场景会 401；而 /office/pdf 与弹窗其余部分同一套准入，稳。
        return <iframe className="tg-lb__frame" src={officePdfUrl(item.path, item.sessionId)} title={item.name} />
      case 'slide':
      case 'sheet':
      case 'doc':
        // PPT / Excel / Word：服务端出页图，客户端翻页。
        return <PagedPreview item={item} full={full} />
      default:
        // code 等：浏览器渲染不了。
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
      data-full={full ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      onClick={requestClose}
    >
      <div className="tg-lb__stage" onClick={(event) => { event.stopPropagation() }}>
        <button type="button" className="tg-lb__close" aria-label="关闭" title="关闭（Esc）" onClick={requestClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="tg-lb__fullbtn"
          aria-label={full ? '退出全屏' : '放大全屏'}
          title={full ? '退出全屏（F / Esc）' : '放大全屏（F）'}
          data-full={full ? 'true' : undefined}
          onClick={toggleFull}
        >
          {full ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
            </svg>
          )}
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
          <span className="tg-lb__name" title={item.path}>{displayNameOf(item)}</span>
          <span className="tg-lb__dim">
            {formatRelativeTime(item.time)}
            {item.source === 'file' && item.size !== undefined && item.size > 0 ? ' · ' + formatSize(item.size) : ''}
          </span>
          <span className="tg-lb__actions">
            {onOpenSession !== undefined && (
              <button type="button" className="tg-lb__btn" onClick={() => { onOpenSession(item) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                打开会话
              </button>
            )}
            {onOpenSidebar !== undefined && (
              <button type="button" className="tg-lb__btn" onClick={() => { onOpenSidebar(item) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                预览文档
              </button>
            )}
            {item.source === 'file' && (
              <button type="button" className="tg-lb__btn" onClick={download}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5" /><path d="M4 19h16" /></svg>
                下载
              </button>
            )}
          </span>
        </div>
        {!full && (
          <div className="tg-lb__hint">
            {items.length > 1 ? '← / → 翻页 · ' : ''}F 全屏 · Esc 或点击空白处关闭 · {index + 1} / {items.length}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
