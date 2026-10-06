/**
 * dsh-chat-plus — 对话流内嵌 HTML 卡片（```html 围栏的渲染器）。
 *
 * 对齐官方 MCP Apps widget 的形态：对话流里一张可交互卡片，内容是独立沙箱
 * 文档。与官方那条链路的差异只在触发方式（围栏 vs tool 资源），渲染语义一致。
 *
 * 安全模型（整个能力的核心，改动前先读这段）：
 *  · iframe 只给 `allow-scripts`，**不给 allow-same-origin**。内容来自模型，
 *    给了 same-origin 就等于把宿主 DOM 与会话数据交出去。
 *  · 宿主不信任 iframe 的任何消息：来源窗口比对 + source 标记 + 类型/范围校验，
 *    通过后也只用它的一个字段（高度），且钳到 [MIN, MAX]。
 *  · 高度上报必须走 postMessage —— opaque origin 下宿主读不到内部 DOM，
 *    这正是官方 widget 需要 notifyIntrinsicHeight() 的原因，不是绕路。
 *
 * 交互取舍：
 *  · 默认渲染预览而不是源码：模型写 ```html 绝大多数时候就是想给一个能点的东西。
 *    想看源码有一个按钮切过去（等宽 + 可滚动），不牺牲任何透明度。
 *  · 高度变化带 transition，但**只在两次上报之间**做——首次挂载直接给最终高度，
 *    否则卡片会从 40px 拉长到内容高度，长页面看着像抽搐。
 *  · prefers-reduced-motion 下关掉全部过渡。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HtmlSpec } from './parse.ts'
import { assembleHtmlDocument, BRIDGE_TO_FRAME, BRIDGE_TO_HOST, MAX_FRAME_HEIGHT, MIN_FRAME_HEIGHT } from './bridge.ts'

/** 主题属性（与官方 ui-theme boot 脚本一致）。 */
const THEME_ATTR = 'data-ds-dark-theme'

/** 判断当前是否暗色主题。 */
function isDarkNow(): boolean {
  if (typeof document === 'undefined') return false
  return document.body.hasAttribute(THEME_ATTR)
}

/**
 * 订阅主题变化，返回当前是否暗色。
 *
 * 用 MutationObserver 而不是 matchMedia：官方主题是 `body` 上的属性，用户可以
 * 在设置里手动切，跟系统偏好并不总是一致。
 */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState<boolean>(() => isDarkNow())
  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => { setDark(isDarkNow()) })
    observer.observe(document.body, { attributes: true, attributeFilter: [THEME_ATTR] })
    return () => { observer.disconnect() }
  }, [])
  return dark
}

/**
 * 把字节数写成人话（只用于卡片角落的小字）。
 */
function formatBytes(size: number): string {
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / 1024 / 1024).toFixed(1) + ' MB'
}

/** 图标：代码 / 预览切换。 */
function CodeIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.6 4 2 8l3.6 4" />
      <path d="M10.4 4 14 8l-3.6 4" />
    </svg>
  )
}

/** 图标：重新加载（重挂 iframe，用于页面自己跑挂了的情形）。 */
function ReloadIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" />
      <path d="M13.6 2.6v3.2h-3.2" />
    </svg>
  )
}

/** 图标：复制源码。 */
function CopyIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.8" />
      <path d="M10.6 5.4V4a1.8 1.8 0 0 0-1.8-1.8H4A1.8 1.8 0 0 0 2.2 4v4.8A1.8 1.8 0 0 0 4 10.6h1.4" />
    </svg>
  )
}

/** 图标：全屏。 */
function ExpandIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2.4H2.4V6" />
      <path d="M10 13.6h3.6V10" />
      <path d="M13.6 6V2.4H10" />
      <path d="M2.4 10v3.6H6" />
    </svg>
  )
}

/** 图标：关闭（全屏层）。 */
function CloseIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  )
}

/**
 * 一个沙箱 iframe + 高度桥。预览态与全屏态共用它。
 *
 * `fullscreen` 只影响尺寸策略：全屏时高度铺满容器，不再跟随内容高度上报
 * （那个高度是为对话流里的内联卡片服务的）。
 */
function SandboxFrame({ doc, dark, fullscreen, reloadKey, onHeight }: {
  readonly doc: string
  readonly dark: boolean
  readonly fullscreen: boolean
  readonly reloadKey: number
  readonly onHeight?: ((height: number) => void) | undefined
}): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  /**
   * 当前主题的实时引用。
   *
   * 消息监听器刻意不把 dark 放进依赖：那会在每次主题切换时重挂监听（没必要，
   * 且切换瞬间可能漏掉一条高度上报）。用 ref 让监听器读到最新值。
   */
  const darkRef = useRef(dark)
  darkRef.current = dark

  /**
   * 把主题推给 iframe。
   *
   * 两个入口共用：iframe 主动发 ready 时（可靠路径），以及 dark 变化时。
   * 挂载那一刻直接推是不可靠的——srcDoc 异步解析，postMessage 常常早于
   * iframe 内脚本注册监听，消息直接丢失（表现为卡片永远是亮色）。
   */
  const pushTheme = useCallback((next: boolean): void => {
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    try {
      win.postMessage({ source: BRIDGE_TO_FRAME, kind: 'theme', dark: next }, '*')
    } catch {
      // 跨源 postMessage 在极少数浏览器策略下会抛，主题同步失败不该影响渲染。
    }
  }, [])

  // 高度上报 + ready 握手：三重校验后才接受，且只取高度一个字段。
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      // ① 来源窗口必须是本卡片自己的 iframe（opaque origin 下 origin 恒为 "null"，
      //    所以只能比窗口引用，比不了 origin）。
      if (frameRef.current === null || event.source !== frameRef.current.contentWindow) return
      const data = event.data as { source?: unknown; kind?: unknown; height?: unknown } | null
      if (data === null || typeof data !== 'object') return
      // ② 命名空间标记，避免把模型页面自己的 postMessage 当成桥消息。
      if (data.source !== BRIDGE_TO_HOST) return
      // ③ ready：iframe 脚本就绪，此刻推主题才收得到。
      if (data.kind === 'ready') {
        pushTheme(darkRef.current)
        return
      }
      if (data.kind !== 'height') return
      if (onHeight === undefined) return
      // ④ 类型 + 范围：钳到硬上下限，页面再高也撑不爆对话流。
      if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
      const height = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.round(data.height)))
      onHeight(height)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [onHeight, pushTheme])

  // dark 变化时主动推一次（iframe 已在运行，这条不会丢）。
  useEffect(() => { pushTheme(dark) }, [dark, pushTheme, reloadKey])

  return (
    <iframe
      ref={frameRef}
      key={reloadKey}
      className="dtt-he__frame"
      srcDoc={doc}
      // 只给脚本权限，**绝不给 allow-same-origin**（见文件头安全模型）。
      // allow-popups 配合文档里的 <base target="_blank">，让页面内链接开新标签页
      // 而不是在卡片里导航走；allow-forms / allow-modals 是交互式 demo 的常见需要。
      sandbox="allow-scripts allow-popups allow-forms allow-modals allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="eager"
      title="HTML 卡片"
      style={fullscreen ? { height: '100%' } : undefined}
    />
  )
}

/**
 * 预渲染占位的**内容**（流式期，围栏还没闭合）。
 *
 * 为什么需要它：模型写 HTML 卡片时是逐字流出来的，几百行代码逐字往外冒既没法
 * 读、又把对话流撑得老长。这里一出现 ```html 就换成一张卡，把「正在写」这件事
 * 收进一个稳定的容器里。
 *
 * 三条设计约束：
 *  1. **不挂 iframe**。半截 HTML 挂进去只会白屏 + 每次 delta 重载（这正是官方
 *     widget 要等资源完整才渲染的原因）。占位内容纯 CSS，零成本。
 *  2. **只是内容，不是组件**。刻意写成返回 JSX 的普通函数而非 React 组件：
 *     闭合那一刻必须复用同一个 <figure> DOM 节点，卡片才会「原地变成真身」
 *     而不是卸载重建（实测过：作为独立组件返回时节点 identity 会变，卡片会跳）。
 *  3. **动效克制**：一条不确定进度条 + 呼吸点。用户偏好动效，但这是等待态，
 *     不该比成品更抢眼。
 */
function pendingStage(bytes: number): JSX.Element {
  return (
    <div className="dtt-he__stage dtt-he__stage--pending" aria-busy="true" aria-live="polite">
      <div className="dtt-he__pending">
        <span className="dtt-he__pending-dot" />
        <span className="dtt-he__pending-text">正在预渲染…</span>
      </div>
      <div className="dtt-he__pending-track"><span className="dtt-he__pending-bar" /></div>
      <span className="dtt-he__pending-bytes">{formatBytes(bytes)}</span>
    </div>
  )
}

/**
 * HTML 卡片：标题栏 + 预览/源码切换 + 沙箱预览。
 *
 * 高度策略：首次上报之前先给一个保守初值，拿到真实高度后一次性设上去，
 * **这一跳不带过渡**（从矮拉到高很难看）；第二次上报起才打开 transition，
 * 让「内容真的变多了」表现成平滑生长。区分方式是上报计数而不是布尔——
 * 过渡属性必须和「后续那一跳」同帧生效才动画得到那一跳。
 *
 * pending → ready 的切换必须**复用同一个 <figure> 节点**：调用方给的 key 不变，
 * 只是 `pending` 从 true 变 false。所以占位不是另一个组件、也不能提前 return——
 * 提前 return 另一个组件会让 React 卸载重建 DOM，卡片闭合那一刻会跳一下。
 * 正确做法是在同一个 <figure> 内部条件渲染内容（见 return 里的三元）。
 */
export const HtmlCard = memo(function HtmlCard({ spec, pending = false }: {
  readonly spec: HtmlSpec
  /** 流式期围栏未闭合 → 只渲染占位，不挂 iframe。 */
  readonly pending?: boolean
}): JSX.Element {
  const dark = useDarkTheme()
  const [showSource, setShowSource] = useState(false)
  const [height, setHeight] = useState<number | null>(null)
  /** 已收到的上报次数（首次落位不加过渡，见上面的高度策略）。 */
  const reports = useRef(0)
  const [animated, setAnimated] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)

  const doc = useMemo(() => assembleHtmlDocument(spec.html), [spec.html])

  const onHeight = useCallback((next: number): void => {
    reports.current += 1
    setHeight(prev => (prev === next ? prev : next))
    // 第二次起才允许过渡：第一次是「落位」，之后才是「生长」。
    if (reports.current > 1) setAnimated(true)
  }, [])

  // 全屏时锁滚动，并支持 Esc 退出。
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [fullscreen])

  const copySource = useCallback((): void => {
    void navigator.clipboard.writeText(spec.html).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1600)
    }).catch(() => undefined)
  }, [spec.html])

  const frame = (
    <SandboxFrame doc={doc} dark={dark} fullscreen={fullscreen} reloadKey={reloadKey} onHeight={onHeight} />
  )

  /*
   * 流式期占位。
   *
   * 位置必须在**所有 hooks 之后**：hooks 数量与顺序在两个分支间保持一致，
   * pending 变 false 时 React 才能复用同一实例（提前 return 是安全的，因为
   * 后面不再有 hook 调用）。iframe 也在这个分支里不渲染——半截 HTML 挂进去
   * 只会白屏，而且每个 delta 都会重载一次。
   */
  return (
    <figure className={pending ? 'dtt-he dtt-he--pending' : 'dtt-he'}>
      <figcaption className="dtt-he__bar">
        <span className={pending ? 'dtt-he__title dtt-he__title--muted' : 'dtt-he__title'} title={pending ? undefined : spec.title}>
          {pending ? 'HTML 卡片' : spec.title}
        </span>
        {/* 占位态的字节数放在舞台里（跟随进度条一起读），成品态放标题栏。 */}
        {!pending && <span className="dtt-he__meta">{formatBytes(spec.bytes)}</span>}
        {/* 占位期不给动作按钮：没有可复制/可全屏的内容，给了只会误导。 */}
        {!pending && (
        <span className="dtt-he__actions">
          <button
            type="button"
            className={showSource ? 'dtt-he__btn dtt-he__btn--active' : 'dtt-he__btn'}
            aria-pressed={showSource}
            title={showSource ? '看预览' : '看源码'}
            onClick={() => { setShowSource(prev => !prev) }}
          >
            <CodeIcon />
          </button>
          <button
            type="button"
            className={copied ? 'dtt-he__btn dtt-he__btn--active' : 'dtt-he__btn'}
            title={copied ? '已复制' : '复制源码'}
            onClick={copySource}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            className="dtt-he__btn"
            title="重新加载"
            onClick={() => { setReloadKey(prev => prev + 1) }}
          >
            <ReloadIcon />
          </button>
          <button
            type="button"
            className="dtt-he__btn"
            title="全屏"
            onClick={() => { setFullscreen(true) }}
          >
            <ExpandIcon />
          </button>
        </span>
        )}
      </figcaption>

      {pending ? pendingStage(spec.bytes) : showSource ? (
        <pre className="dtt-he__code"><code>{spec.html}</code></pre>
      ) : (
        <div
          className={animated ? 'dtt-he__stage dtt-he__stage--settled' : 'dtt-he__stage'}
          style={{ height: height === null ? MIN_FRAME_HEIGHT * 4 : height }}
        >
          {frame}
        </div>
      )}

      {fullscreen && typeof document !== 'undefined' && createPortal(
        <div className="dtt-he__overlay" role="dialog" aria-modal="true" aria-label={spec.title}>
          <div className="dtt-he__overlay-bar">
            <span className="dtt-he__title">{spec.title}</span>
            <span className="dtt-he__actions">
              <button
                type="button"
                className="dtt-he__btn"
                title="重新加载"
                onClick={() => { setReloadKey(prev => prev + 1) }}
              >
                <ReloadIcon />
              </button>
              <button
                type="button"
                className="dtt-he__btn"
                title="关闭（Esc）"
                onClick={() => { setFullscreen(false) }}
              >
                <CloseIcon />
              </button>
            </span>
          </div>
          <div className="dtt-he__overlay-stage">
            <SandboxFrame doc={doc} dark={dark} fullscreen reloadKey={reloadKey} />
          </div>
        </div>,
        document.body,
      )}
    </figure>
  )
})
