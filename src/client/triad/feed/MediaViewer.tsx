/**
 * dsh-chat-plus — 「动态」页的全屏媒体查看器（lightbox）。
 *
 * 用户原话：「他们的动态有图片或视频就把链接放上来，渲染出来，可播放可查看，
 * 可点击放大全屏可滚轮缩放」。
 *
 * ── 为什么自己写一个，而不是复用画廊的弹窗 ────────────────────────────
 * 画廊那套（gallery/media-lightbox.tsx + use-zoom-pan.ts）的缩放是
 * **Ctrl + 滚轮**（那是给「页面里嵌着图，滚轮还要滚页面」的场景设计的）。
 * 而这里是**全屏模态**：整屏只有一张图，没有别的可滚，用户的直觉就是
 * 「直接滚滚轮放大」。语义不同，硬复用会让用户按着 Ctrl 才动、不按就滚不动。
 * 另外这一份要处理的是外链图（pbs.twimg.com 有防盗链），失败兜底也不同。
 *
 * ── 手势四条（用户明确要求）────────────────────────────────────────
 *  1. **滚轮缩放**：指数曲线，夹在 0.5x ~ 5x（{@link clampScale}）；
 *     以**光标位置**为锚点 —— 缩放时鼠标底下那个像素不动，这是看图工具的手感基准。
 *  2. **拖动平移**：只有放大之后才生效（1x 时没有可拖的余量），
 *     并按内容尺寸夹住边界，绝不把图拖出视野只剩一片黑。
 *  3. **双击**：1x ⇄ 2x（以双击点为锚点，落在哪儿放大哪儿）。
 *  4. **Esc 关闭**：多图时 ← / → 切换，+ / - 缩放，0 复位。
 *
 * ── 事件为什么是原生 addEventListener ─────────────────────────────────
 * 滚轮必须是 `addEventListener('wheel', ..., { passive:false })`：React 的
 * onWheel 走合成事件委托且默认 passive，里面 preventDefault 会被浏览器忽略，
 * 于是滚轮会**连带滚动背后的页面**（模态开着、底下列表却在动）。
 *
 * ── 图片容错（硬要求）──────────────────────────────────────────────
 * 外链图三种死法：防盗链 403、CSP 拦、网络断。所以每张图：
 *   · 一律带 referrerPolicy="no-referrer"（pbs.twimg.com 按 Referer 判盗链）；
 *   · onError 后**换成一块说明 + 原文入口**，绝不留下破图图标；
 *   · 加载前按宽高比先把盒子占好（没有尺寸就按容器自适应），
 *     避免图片一到把正文整体顶下去。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { mediaProxyUrl, type FeedMedia } from './api.js'
import { clampScale, isPlayable, mediaAspectOf, mediaBadgeOf } from './progress.js'

/** 缩放下限：再小就只剩一个点，用户会以为图没了。 */
const MIN_SCALE = 0.5
/** 缩放上限：5 倍足够看清 2000px 宽图里的小字。 */
const MAX_SCALE = 5
/** 双击放大到的档位（再双击回 1x）。 */
const DOUBLE_SCALE = 2
/** 复位动画时长（与样式表 .fd-lb-media 的 transition 成对维护）。 */
const RESET_MS = 220

/** 当前视图（s = 1 且位移 0 就是「适应窗口」的原始呈现）。 */
interface View {
  readonly s: number
  readonly x: number
  readonly y: number
}

const HOME: View = { s: 1, x: 0, y: 0 }

/** 一个被夹到区间内的数。 */
function clampTo(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

export interface MediaViewerProps {
  /** 这一条动态的全部媒体（顺序即左右切换顺序）。 */
  readonly items: readonly FeedMedia[]
  /** 打开时停在第几张（越界自动夹到区间内）。 */
  readonly index: number
  readonly onClose: () => void
}

/**
 * 全屏媒体查看器。
 *
 * 挂在 .fd-pop 之外单独一套类名（.fd-lb-*）：浮层骨架长得完全不一样
 * （整屏黑底 + 悬浮控件），复用 .fd-pop 的居中卡片只会到处写 !important 覆盖。
 */
export function MediaViewer({ items, index, onClose }: MediaViewerProps): JSX.Element | null {
  const total = items.length
  const [cursor, setCursor] = useState(() => clampTo(index, 0, Math.max(0, total - 1)))
  const [view, setView] = useState<View>(HOME)
  const [dragging, setDragging] = useState(false)
  /** 复位动画进行中：只有这段时间允许 transform 过渡，平时必须跟手。 */
  const [animating, setAnimating] = useState(false)
  /** 加载失败的媒体 url（按 url 记，切回来仍显示兜底，不反复重试同一张坏图）。 */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set())

  const stageRef = useRef<HTMLDivElement | null>(null)
  const mediaRef = useRef<HTMLDivElement | null>(null)
  /** 事件回调里读最新视图（React 状态在监听器闭包里会陈旧）。 */
  const viewRef = useRef<View>(HOME)
  viewRef.current = view
  /** 拖拽会话：起手指针位置 + 当时的位移。 */
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const current = total === 0 ? null : items[cursor]

  /**
   * 按内容实际尺寸夹住位移。
   *
   * offsetWidth / offsetHeight **不受 transform 影响** —— 正是「图上屏后的
   * 真实盒子尺寸」（含 max-width/max-height 的适应结果）。内容比容器小时
   * maxX 取 0，图自然保持居中，不会被拖到边角。
   */
  const confine = useCallback((next: View): View => {
    const box = stageRef.current
    const target = mediaRef.current
    if (box === null || target === null) return next
    const maxX = Math.max(0, (target.offsetWidth * next.s - box.clientWidth) / 2)
    const maxY = Math.max(0, (target.offsetHeight * next.s - box.clientHeight) / 2)
    return { s: next.s, x: clampTo(next.x, -maxX, maxX), y: clampTo(next.y, -maxY, maxY) }
  }, [])

  const reset = useCallback((): void => {
    setAnimating(true)
    setView(HOME)
    if (animTimer.current !== null) clearTimeout(animTimer.current)
    animTimer.current = setTimeout(() => { setAnimating(false) }, RESET_MS + 20)
  }, [])

  /** 以容器内某点（相对中心的坐标）为锚点缩放。 */
  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number): void => {
    setView((prev) => {
      const s = clampScale(prev.s * factor, MIN_SCALE, MAX_SCALE)
      if (s === prev.s) return prev
      const k = s / prev.s
      /*
       * 锚点公式：设光标相对中心 (cx, cy)，当前 s 与位移 (x, y)，则内容里
       * 那一点相对中心的坐标是 ((cx - x) / s, (cy - y) / s)。缩放后要保持
       * 它仍在 (cx, cy)：x' = cx - (cx - x) * (s'/s)。
       * 平移量与缩放量同乘这个比例，所以锚定是精确的，不是近似。
       */
      return confine({ s, x: anchorX - (anchorX - prev.x) * k, y: anchorY - (anchorY - prev.y) * k })
    })
  }, [confine])

  /** 以中心为锚点缩放（键盘 +/- 用）。 */
  const zoomBy = useCallback((factor: number): void => { zoomAt(factor, 0, 0) }, [zoomAt])

  /* ── 换图：视图必须复位（否则第二张图会带着上一张的放大倍数与位移出场）── */
  useEffect(() => {
    setView(HOME)
    setAnimating(false)
    setDragging(false)
  }, [cursor])

  /* ── 滚轮缩放（原生监听 + passive:false）─────────────────────────────
   * 全屏模态里没有别的可滚内容，所以**不要求修饰键**：直接滚就缩放。
   * 必须 preventDefault，否则滚轮会穿透到背后的列表。 */
  useEffect(() => {
    const box = stageRef.current
    if (box === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = box.getBoundingClientRect()
      const cx = event.clientX - rect.left - rect.width / 2
      const cy = event.clientY - rect.top - rect.height / 2
      // 三种 deltaMode（像素 / 行 / 页）都要折算，否则 Firefox 的行模式滚轮几乎不动。
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
      zoomAt(Math.exp(-event.deltaY * unit * 0.0016), cx, cy)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => { box.removeEventListener('wheel', onWheel) }
  }, [zoomAt])

  /* ── 拖拽平移：只有放大之后才生效 ─────────────────────────────────── */
  useEffect(() => {
    const box = stageRef.current
    if (box === null) return undefined

    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      if (viewRef.current.s <= 1.001) return
      // 点在控件（关闭 / 翻页 / 视频原生控件 / 链接）上时不接管：拖拽会把点击吞掉。
      const target = event.target as Element | null
      if (target !== null && target.closest('button, a, video, input') !== null) return
      drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: viewRef.current.x, oy: viewRef.current.y }
      setDragging(true)
      try { box.setPointerCapture(event.pointerId) } catch { /* 不支持捕获时退化为普通拖拽 */ }
    }

    const onMove = (event: PointerEvent): void => {
      const session = drag.current
      if (session === null || session.id !== event.pointerId) return
      event.preventDefault()
      setView(confine({
        s: viewRef.current.s,
        x: session.ox + (event.clientX - session.sx),
        y: session.oy + (event.clientY - session.sy),
      }))
    }

    const endDrag = (event: PointerEvent): void => {
      const session = drag.current
      if (session === null || session.id !== event.pointerId) return
      drag.current = null
      setDragging(false)
      try { box.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ }
    }

    box.addEventListener('pointerdown', onDown)
    box.addEventListener('pointermove', onMove)
    box.addEventListener('pointerup', endDrag)
    box.addEventListener('pointercancel', endDrag)
    return () => {
      box.removeEventListener('pointerdown', onDown)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerup', endDrag)
      box.removeEventListener('pointercancel', endDrag)
      drag.current = null
    }
  }, [confine])

  /* ── 双击：1x ⇄ 2x（落在哪儿放大哪儿）─────────────────────────────── */
  useEffect(() => {
    const box = stageRef.current
    if (box === null) return undefined
    const onDoubleClick = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (target !== null && target.closest('button, a, video, input') !== null) return
      if (viewRef.current.s > 1.001) { reset(); return }
      const rect = box.getBoundingClientRect()
      zoomAt(DOUBLE_SCALE, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2)
    }
    box.addEventListener('dblclick', onDoubleClick)
    return () => { box.removeEventListener('dblclick', onDoubleClick) }
  }, [reset, zoomAt])

  /* ── 键盘：Esc 关闭 / ← → 切换 / + - 缩放 / 0 复位 ─────────────────
   *
   * ⚠ Esc 必须**在捕获阶段**拦下并 preventDefault：动态页挂在工作台浮层里，
   * 工作台自己也监听 Esc 关闭。不拦的话一次 Esc 会把「查看器 + 整个工作台」
   * 一起关掉，用户看到的是「按 Esc 直接退出动态页」。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft' && total > 1) {
        event.preventDefault()
        setCursor((at) => (at - 1 + total) % total)
        return
      }
      if (event.key === 'ArrowRight' && total > 1) {
        event.preventDefault()
        setCursor((at) => (at + 1) % total)
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomBy(1.25)
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        zoomBy(0.8)
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onClose, reset, total, zoomBy])

  // 卸载时清掉复位动画定时器（否则会在已卸载组件上 setState）。
  useEffect(() => () => {
    if (animTimer.current !== null) clearTimeout(animTimer.current)
  }, [])

  const markBroken = useCallback((url: string): void => {
    setBroken((prev) => {
      if (prev.has(url)) return prev
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }, [])

  if (current === null) return null

  const playable = isPlayable(current)
  const isBroken = broken.has(current.url)
  const badge = mediaBadgeOf(current.type)
  const aspect = mediaAspectOf(current)

  const style: CSSProperties = {
    transform: 'translate3d(' + String(view.x) + 'px,' + String(view.y) + 'px,0) scale(' + String(view.s) + ')',
    transformOrigin: 'center center',
    // 复位才允许过渡；拖拽与滚轮必须零延迟跟手，否则手感是「拖着一块橡皮」。
    transition: animating ? 'transform ' + String(RESET_MS) + 'ms cubic-bezier(.2,.8,.2,1)' : 'none',
    cursor: dragging ? 'grabbing' : view.s > 1.001 ? 'grab' : 'zoom-in',
    willChange: view.s !== 1 ? 'transform' : undefined,
    ...(aspect === null ? {} : { aspectRatio: aspect }),
  }

  return createPortal(
    <div className="fd-lb" role="dialog" aria-modal="true" aria-label="查看媒体">
      {/* 舞台：滚轮 / 拖拽 / 双击都挂在它身上（它铺满整屏，锚点也按它算） */}
      <div className="fd-lb-stage" ref={stageRef}>
        <div className="fd-lb-media" ref={mediaRef} style={style} data-drag={dragging ? 'true' : undefined}>
          {isBroken ? (
            <div className="fd-lb-fail">
              <b>这张图加载不出来</b>
              <span>可能是对方站点防盗链，或网络被拦。可以点下面打开原帖看。</span>
              <a className="fd-lb-link" href={current.sourceUrl} target="_blank" rel="noopener noreferrer">
                打开原帖
              </a>
            </div>
          ) : playable ? (
            <video
              className="fd-lb-video"
              // 同 MediaGrid：video.twimg.com 按 Referer 判盗链，必须走 host 代理。
              src={mediaProxyUrl(current.videoUrl ?? '')}
              poster={current.url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              // 视频也会被防盗链：失败了退成封面图 + 原帖入口，而不是一个转圈的播放器。
              onError={() => { markBroken(current.url) }}
            />
          ) : (
            <img
              className="fd-lb-img"
              src={current.url}
              alt=""
              // ⚠ pbs.twimg.com 按 Referer 判盗链：不带这句会 403。
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => { markBroken(current.url) }}
            />
          )}
        </div>
      </div>

      {/* 顶部条：计数 + 缩放读数 + 关闭 */}
      <div className="fd-lb-bar">
        <span className="fd-lb-count">
          {total > 1 ? String(cursor + 1) + ' / ' + String(total) : ''}
          {badge !== null ? <em className="fd-lb-badge">{badge}</em> : null}
        </span>
        <span className="fd-lb-zoom">{Math.round(view.s * 100)}%</span>
        <button className="fd-lb-btn" type="button" onClick={reset} title="复位（0）">复位</button>
        <a
          className="fd-lb-btn"
          href={current.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="在新标签页打开原帖"
        >
          原文
        </a>
        <button className="fd-lb-btn" type="button" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
          关闭
        </button>
      </div>

      {/* 多图左右切换 */}
      {total > 1 ? (
        <>
          <button
            className="fd-lb-nav"
            data-side="prev"
            type="button"
            aria-label="上一张"
            title="上一张（←）"
            onClick={() => { setCursor((at) => (at - 1 + total) % total) }}
          >
            ‹
          </button>
          <button
            className="fd-lb-nav"
            data-side="next"
            type="button"
            aria-label="下一张"
            title="下一张（→）"
            onClick={() => { setCursor((at) => (at + 1) % total) }}
          >
            ›
          </button>
        </>
      ) : null}

      {/* 点击背景关闭：只有点到**舞台本身**（不是图、不是控件）才关 */}
      <div
        className="fd-lb-bd"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      />
    </div>,
    document.body,
  )
}
