/**
 * dsh-chat-plus — 画廊预览弹窗（媒体查看器）。
 *
 * ## 它是什么
 *
 * 画廊里点一张卡片，就在原地把它放大看 —— 不切会话、不占右栏、不离开列表。
 * 关掉还停在原来那格，这是画廊作为「浏览工具」该有的手感。
 *
 * ## 为什么画廊用弹窗、产出物卡用右栏
 *
 * 两者的阅读姿势不同，2026-10-19 先统一到右栏后按用户要求拆开：
 *  · **画廊**是横向扫一遍的地方 —— 一次看十几张，来回翻、快速关掉，弹窗最顺；
 *  · **产出物卡**讲的是「这次对话做出来了什么」，点开就该在旁边长期停着，
 *    右栏那份才是对的。
 *
 * ## 视觉（2026-10-19 重做）
 *
 * 旧版被用户点名「太丑」，问题都在**没有容器**：关闭钮与全屏钮挂在图片外
 * 右上角（负偏移，像贴纸）、文件名与元信息散在图片下方一行、图片和遮罩之间
 * 没有边界，整块看起来是「一张图浮在暗背景上」。
 *
 * 现在是一个**完整的浮动面板**：
 *   · 一条 52px 的头部 —— 类型图标 + 文件名 + 元信息，右侧一组图标按钮；
 *   · 中间内容区自己持有边界（图片居中留白 / iframe 撑满 / 页图带翻页条）；
 *   · 面板本体有 1px 内描边 + 双层投影，跟浏览器窗口是两张明确的层。
 *
 * 动效走「弹出」而不是「淡入」：遮罩 200ms 雾化，面板 340ms 从 96% 缩放 + 8px
 * 上移落位（cubic-bezier(.16,1,.3,1)，末尾有轻微回弹感），内容再延迟 60ms 渐显。
 * 退出反向且更快（170ms）—— 关闭动作要立即响应。
 *
 * ## 键盘
 *
 * Esc 分层（全屏中先退全屏，再按才关）；←/→ 翻页；F 切全屏。焦点不进面板内部
 * 循环 —— 它是随手看一眼的浮层，不是需要 Tab 遍历的对话框。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  displayNameOf, formatRelativeTime, formatSize, officePageUrl, officePdfUrl, officeRenderable,
  resolveGeneratedUrls,
} from './api.js'
import { ensureGalleryStyles } from './styles.js'

/** 弹窗条目（画廊 GalleryItem 与产出物 OutputItem 的公共超集）。 */
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
 * 可在弹窗内直接预览的类别。
 *
 * 真正的分流判据是 {@link canInlinePreview}：类别是粗粒度的（`sheet` 里有
 * csv / tsv、`doc` 里有 md / rtf），而 Office 引擎只认其中一部分。这张表只是
 * 「可能内联」的快速过滤。
 */
export const INLINE_PREVIEW_KINDS: ReadonlySet<string> = new Set([
  'image', 'video', 'audio', 'page', 'pdf', 'slide', 'sheet', 'doc',
])

/**
 * 真正的内联预览判据（类别 + 扩展名）。
 *
 * ⚠ `page`（html 成品）必须**先短路放行**：它走插件 /raw 的沙箱 iframe，与
 * Office 那条「引擎出页图」的链路无关，`officeRenderable` 对它一律 false。
 * 曾经直接套 officeRenderable，结果 html 卡片点一下变成静默下载（弹窗不开）。
 *
 * @param kind - 展示类别。
 * @param path - 文件路径（取扩展名）。
 */
export function canInlinePreview(kind: string, path: string): boolean {
  if (!INLINE_PREVIEW_KINDS.has(kind)) return false
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'page') return true
  return officeRenderable(kind, path)
}

/** spill 解析缓存：路径 → 可显示 URL 列表（网格缩略图与弹窗共享，重开秒回）。 */
export const generatedUrlCache = new Map<string, readonly string[]>()

/* ── 图标 ─────────────────────────────────────────────────────────────── */

const svgProps = {
  width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/** 类型标识（头部左侧那枚，24px 档）。 */
function KindGlyph({ kind }: { readonly kind: string }): JSX.Element {
  const p = { ...svgProps, width: 16, height: 16 } as const
  switch (kind) {
    case 'image':
      return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
    case 'video':
      return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" /></svg>
    case 'audio':
      return <svg {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
    case 'page':
      return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18" /><circle cx="6.5" cy="6.5" r=".9" fill="currentColor" stroke="none" /></svg>
    case 'pdf':
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 15h8" /></svg>
    case 'slide':
      return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M12 17v4M8 21h8" /></svg>
    case 'sheet':
      return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>
    case 'doc':
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg>
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>
  }
}

/* ── 页图预览（PPT / Word / Excel）────────────────────────────────────── */

/** 服务端页图预览的页码上限（与 host 的 MAX_PAGES 一致）。 */
const MAX_PAGE_VIEW = 12

/**
 * PPT / Word / Excel 的页内预览：服务端逐页出 PNG，客户端就是一个 <img> + 翻页条。
 *
 * 为什么是图片而不是 iframe PDF 查看器：官方那条 PDF 链路要额外加载 pdf.js
 * chunk，只为看一页 PPT 不值；页图还天然带回「共几页」，翻页 UI 不用再探一次。
 * 页码与页数从响应头（x-dsh-page / x-dsh-page-count）读，一次请求带回元信息。
 */
function PagedPreview({ item, full }: { readonly item: LightboxItem; readonly full: boolean }): JSX.Element {
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setPage(1); setPageCount(0); setFailed(false); setLoading(true) }, [item.path])

  const src = officePageUrl(item.path, item.sessionId, page)
  const total = pageCount > 0 ? Math.min(pageCount, MAX_PAGE_VIEW) : MAX_PAGE_VIEW

  if (failed) {
    return (
      <div className="glb-note">
        <KindGlyph kind={item.kind} />
        <span>这一份暂时渲染不出来（引擎或文件状态不支持），可以下载后本地打开。</span>
      </div>
    )
  }

  return (
    <div className="glb-paged" data-full={full ? 'true' : undefined}>
      <img
        className="glb-paged__img"
        src={src}
        alt={`${item.name} 第 ${page} 页`}
        draggable={false}
        data-loaded={loading ? undefined : 'true'}
        onLoad={() => { setLoading(false) }}
        onError={() => { setFailed(true); setLoading(false) }}
      />
      {loading && <span className="glb-spin" aria-hidden="true"><svg {...svgProps} width="18" height="18"><path d="M12 3a9 9 0 1 0 9 9" /></svg></span>}
      {pageCount > 1 && (
        <div className="glb-paged__bar">
          <button type="button" className="glb-paged__step" disabled={page <= 1}
            onClick={() => { setLoading(true); setPage(v => Math.max(1, v - 1)) }} aria-label="上一页">上一页</button>
          <span className="glb-paged__pos">
            {page}{pageCount > 0 ? ` / ${pageCount}` : ''}
            {pageCount > MAX_PAGE_VIEW ? `（预览前 ${MAX_PAGE_VIEW} 页）` : ''}
          </span>
          <button type="button" className="glb-paged__step" disabled={pageCount > 0 ? page >= total : page >= MAX_PAGE_VIEW}
            onClick={() => { setLoading(true); setPage(v => v + 1) }} aria-label="下一页">下一页</button>
        </div>
      )}
      {pageCount === 0 && (
        <PageCountProbe item={item} onCount={v => { setPageCount(v) }} />
      )}
    </div>
  )
}

/** 用一次 HEAD 读出文档页数（拿不到不影响预览，只是没有总数）。 */
function PageCountProbe({ item, onCount }: {
  readonly item: LightboxItem
  readonly onCount: (value: number) => void
}): null {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    let alive = true
    void (async () => {
      try {
        const res = await fetch(officePageUrl(item.path, item.sessionId, 1), { method: 'HEAD', cache: 'force-cache' })
        const raw = res.headers.get('x-dsh-page-count')
        const value = raw === null ? 0 : Number(raw)
        if (alive && Number.isFinite(value) && value > 0) onCount(value)
      } catch { /* 引擎不可用：不报错，翻页按钮照常可用 */ }
    })()
    return () => { alive = false }
  }, [item.path, item.sessionId, onCount])
  return null
}

/* ── 主组件 ───────────────────────────────────────────────────────────── */

export interface MediaLightboxProps {
  readonly items: readonly LightboxItem[]
  readonly index: number
  /** 条目 → 浏览器可显示 URL（画廊走 /raw，产出物卡走 /session-raw）。 */
  readonly fileUrlOf: (item: LightboxItem) => string
  readonly onNavigate: (index: number) => void
  readonly onClose: () => void
  /** 「打开会话」按钮（画廊用；产出物卡本就身处该会话，不传即不显示）。 */
  readonly onOpenSession?: (item: LightboxItem) => void
  /** 「预览文档」按钮：交给官方右栏文档预览（调用方自行关闭弹窗）。 */
  readonly onOpenSidebar?: (item: LightboxItem) => void
}

export function MediaLightbox({
  items, index, fileUrlOf, onNavigate, onClose, onOpenSession, onOpenSidebar,
}: MediaLightboxProps): JSX.Element | null {
  // 样式自注入：产出物卡从右栏直接打开本组件时 GalleryPanel 没挂载，
  // 缺表会让无样式 portal 以普通块排在 body 末尾（视觉上「一点就跳到底」）。
  ensureGalleryStyles()
  const item = items[index]
  const [closing, setClosing] = useState(false)
  const [full, setFull] = useState(false)
  const [genUrls, setGenUrls] = useState<readonly string[] | null>(null)
  const closeTimer = useRef<number | null>(null)

  // generated 条目：打开时解析 spill（缓存命中则同步返回）。
  // 缓存只认非空结果 —— 空数组写进去会让「这次没解析出来」变成永久结论。
  useEffect(() => {
    if (item === undefined || item.source !== 'generated') { setGenUrls(null); return undefined }
    const cached = generatedUrlCache.get(item.path)
    if (cached !== undefined && cached.length > 0) { setGenUrls(cached); return undefined }
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
    closeTimer.current = window.setTimeout(onClose, 170)
  }, [closing, onClose])

  const step = useCallback((delta: number) => {
    if (items.length <= 1) return
    onNavigate((index + delta + items.length) % items.length)
  }, [items.length, index, onNavigate])

  // 键盘：Esc 分层（全屏中先退全屏）；←/→ 翻页；F 切全屏。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (full) setFull(false)
        else requestClose()
      } else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'f' || event.key === 'F') setFull(v => !v)
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [requestClose, step, full])

  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }, [])

  if (item === undefined) return null

  /** 下载：file 条目走它的可显示地址；generated 没有文件实体，用第一张 URL。 */
  const download = (): void => {
    const anchor = document.createElement('a')
    anchor.href = item.source === 'generated' ? (genUrls?.[0] ?? fileUrlOf(item)) : fileUrlOf(item)
    anchor.download = displayNameOf(item)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  /** 主体：按类别分流。 */
  const body = (): JSX.Element => {
    if (item.source === 'generated') {
      if (genUrls === null) return <div className="glb-note"><span className="glb-spin-inline" aria-hidden="true"><svg {...svgProps} width="15" height="15"><path d="M12 3a9 9 0 1 0 9 9" /></svg></span><span>正在解析生图结果…</span></div>
      if (genUrls.length === 0) return <div className="glb-note"><span>生图结果已过期（spill 文件不在了）</span></div>
      return (
        <div className="glb-genrow">
          {genUrls.map(url => <img key={url.slice(0, 64)} className="glb-media" src={url} alt={item.name} draggable={false} />)}
        </div>
      )
    }
    const raw = fileUrlOf(item)
    switch (item.kind) {
      case 'image':
        return <img className="glb-media" src={raw} alt={item.name} draggable={false} />
      case 'video':
        return <video className="glb-media glb-media--video" src={raw} controls autoPlay preload="metadata" />
      case 'audio':
        return (
          <div className="glb-audio">
            <span className="glb-audio__glyph"><KindGlyph kind="audio" /></span>
            <audio src={raw} controls autoPlay preload="metadata" />
          </div>
        )
      case 'page':
        // 沙箱 iframe：不给 allow-same-origin，成品页落不透明源，读不到宿主状态。
        return <iframe className="glb-frame" src={raw} title={item.name} sandbox="allow-scripts allow-popups allow-forms allow-modals" />
      case 'pdf':
        // 插件自己的 /office/pdf（host 已转好；官方 /api/file 在本地 file 基址下会 401）。
        return <iframe className="glb-frame" src={officePdfUrl(item.path, item.sessionId)} title={item.name} />
      case 'slide':
      case 'sheet':
      case 'doc':
        return <PagedPreview item={item} full={full} />
      default:
        return <div className="glb-note"><KindGlyph kind={item.kind} /><span>该格式不支持页内预览</span></div>
    }
  }

  /*
   * 承载式内容（iframe / 服务端页图）要让面板拿到确定高度。
   *
   * iframe 的固有高度是 150px（HTML 规范默认值），内容驱动高度的布局会把它
   * 压成一条缝 —— 实测 1480×150，页面类内容根本没法看。图片 / 音频则相反：
   * 一张小图不该被撑成整屏高、四周包一圈空气。两类分开处理，见样式表
   * .glb-panel[data-fill] 那段注释。
   */
  const fill = item.source !== 'generated'
    && (item.kind === 'page' || item.kind === 'pdf'
      || item.kind === 'slide' || item.kind === 'sheet' || item.kind === 'doc')

  const shownName = displayNameOf(item)
  /** 元信息：时间 · 大小（generated 没有文件大小）。 */
  const dims = [
    formatRelativeTime(item.time),
    item.source === 'file' && item.size !== undefined && item.size > 0 ? formatSize(item.size) : '',
  ].filter(part => part !== '').join(' · ')

  return createPortal(
    <div
      className="glb"
      data-closing={closing ? 'true' : undefined}
      data-full={full ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={shownName}
      onClick={requestClose}
    >
      <div className="glb-panel" data-fill={fill ? 'true' : undefined} onClick={event => { event.stopPropagation() }}>
        <header className="glb-head">
          <span className="glb-head__glyph"><KindGlyph kind={item.kind} /></span>
          <span className="glb-head__title" title={item.path}>{shownName}</span>
          <span className="glb-head__dims">{dims}</span>
          <span className="glb-head__actions">
            {onOpenSession !== undefined && (
              <button type="button" className="glb-btn" title="打开所属会话" aria-label="打开所属会话"
                onClick={() => { onOpenSession(item) }}>
                <svg {...svgProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </button>
            )}
            {onOpenSidebar !== undefined && (
              <button type="button" className="glb-btn" title="在侧栏打开" aria-label="在侧栏打开"
                onClick={() => { onOpenSidebar(item) }}>
                <svg {...svgProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
              </button>
            )}
            {item.source === 'file' && (
              <button type="button" className="glb-btn" title="下载" aria-label="下载" onClick={download}>
                <svg {...svgProps}><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5" /><path d="M4 19h16" /></svg>
              </button>
            )}
            <span className="glb-head__sep" aria-hidden="true" />
            <button type="button" className="glb-btn" data-active={full ? 'true' : undefined}
              title={full ? '退出全屏（F）' : '全屏（F）'} aria-label={full ? '退出全屏' : '全屏'}
              onClick={() => { setFull(v => !v) }}>
              {full
                ? <svg {...svgProps}><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>
                : <svg {...svgProps}><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" /></svg>}
            </button>
            <button type="button" className="glb-btn glb-btn--close" title="关闭（Esc）" aria-label="关闭" onClick={requestClose}>
              <svg {...svgProps} width="16" height="16"><path d="M5 5l14 14M19 5L5 19" /></svg>
            </button>
          </span>
        </header>

        <div className="glb-body" data-kind={item.kind} data-fill={fill ? 'true' : undefined}>
          {items.length > 1 && (
            <>
              <button type="button" className="glb-nav glb-nav--prev" aria-label="上一个" onClick={() => { step(-1) }}>
                <svg {...svgProps} width="20" height="20"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
              <button type="button" className="glb-nav glb-nav--next" aria-label="下一个" onClick={() => { step(1) }}>
                <svg {...svgProps} width="20" height="20"><path d="M9 5l7 7-7 7" /></svg>
              </button>
            </>
          )}
          {body()}
        </div>

        {items.length > 1 && (
          <footer className="glb-foot">
            <span className="glb-foot__count">{index + 1} / {items.length}</span>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
