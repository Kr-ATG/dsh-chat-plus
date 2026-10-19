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
 * 订阅「正文表面参数」的变化：body 的 style 被官方改了（字号 / 字族 / 主题）。
 *
 * 为什么光靠 React 重渲染不够：官方的字号设置是**直接写 body.style 的 CSS 变量**
 * （见 ui-theme 的 bootTheme），不经过本插件的任何状态，我们这边一次 re-render
 * 都不会发生。于是用户把字号从 14 调到 18，正文变大了，而已经挂载的 html 卡片
 * 还停在旧的 14px —— 必须有一条 DOM 层的通知。
 *
 * 只观察 body 的 style 属性（attributeFilter 精确到 style），开销极小；回调里
 * 只做一次版本自增，真正的采集与下发在 SandboxFrame 里推。
 *
 * 返回一个自增版本号：它变化 → 上层 effect 重新推 surface。
 */
function useSurfaceTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return
    const observer = new MutationObserver(() => { setTick(prev => prev + 1) })
    observer.observe(document.body, { attributes: true, attributeFilter: ['style', THEME_ATTR] })
    return () => { observer.disconnect() }
  }, [])
  return tick
}

/**
 * 把字节数写成人话（只用于卡片角落的小字）。
 */
function formatBytes(size: number): string {
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * 卡片交互状态的宿主侧存储（P2 的 widgetState）。
 *
 * ## 为什么存 localStorage 而不是会话存储
 *
 * 这个状态的实际用途是「用户拖了个滑块 / 选了个分类，刷新后还在」。它属于
 * **呈现偏好**，不属于会话内容：同一条消息在别的会话里看到，用户也希望是
 * 自己上次调好的样子。
 *
 * ## key 怎么定
 *
 * 用正文内容的短哈希，不是消息 id：卡片是围栏正文的纯函数，同一条消息重渲染
 * 时正文不变 → key 不变 → 状态还在；模型改了一版正文 → key 变了 → 旧状态
 * 自然失效（这是对的，版式变了状态本来就没有意义）。
 *
 * ## 容量口径
 *
 * 单卡 ≤16 KiB（与 iframe 侧 runtime.ts 的判据一致，两边都要挡：iframe 侧挡
 * 是省一次 postMessage，宿主侧挡是防伪造）。
 */
const CARD_STATE_PREFIX = 'dsh-html-card-state:'
const CARD_STATE_MAX = 16 * 1024

/** 正文的短哈希（FNV-1a 32 位，够用且无需异步）。 */
function hashContent(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** 读回某张卡片的持久化状态；没有或损坏都返回 null（不抛）。 */
function readCardState(key: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(CARD_STATE_PREFIX + key)
    if (raw === null) return null
    if (raw.length > CARD_STATE_MAX) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** 写回状态；超限或存不下都静默放弃（不该因为存不下就让卡片报错）。 */
function writeCardState(key: string, state: Record<string, unknown>): void {
  try {
    const encoded = JSON.stringify(state)
    if (encoded.length > CARD_STATE_MAX) return
    window.localStorage.setItem(CARD_STATE_PREFIX + key, encoded)
  } catch {
    // 隐私模式 / 配额满：状态存不下就存不下，卡片照常用。
  }
}

/**
 * 一个沙箱 iframe + 高度桥。预览态与全屏态共用它。
 *
 * `fullscreen` 只影响尺寸策略：全屏时高度铺满容器，不再跟随内容高度上报
 * （那个高度是为对话流里的内联卡片服务的）。
 */
function SandboxFrame({ doc, dark, fullscreen, reloadKey, zoom, stateKey, onHeight, onFill }: {
  readonly doc: string
  readonly dark: boolean
  readonly fullscreen: boolean
  readonly reloadKey: number
  /** 内容缩放档位（下发到 iframe 内部应用，见 bridge.ts 的 applyZoom）。 */
  readonly zoom: number
  /** 交互状态的存储键（正文哈希）；空串表示这张卡片不用状态能力。 */
  readonly stateKey: string
  readonly onHeight?: ((height: number) => void) | undefined
  readonly onFill?: ((text: string) => boolean) | undefined
}): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  /**
   * 宿主表面参数的变化滴答（字号 / 字族 / 主题被官方改了 body.style）。
   *
   * 挂在这里而不是 HtmlCard：全屏层与内嵌层各有一个 SandboxFrame，两边都要跟。
   * 值只用来触发 effect，本身不参与计算。
   */
  const surfaceTick = useSurfaceTick()

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

  /**
   * 把内容缩放推给 iframe。
   *
   * 与主题同理：挂载那一刻直接推不可靠（srcDoc 异步解析，消息常常早于 iframe 内
   * 脚本注册监听），所以除了 zoom 变化时推，还要在收到 ready 时补推一次。
   */
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const pushZoom = useCallback((value: number): void => {
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    try {
      win.postMessage({ source: BRIDGE_TO_FRAME, kind: 'zoom', zoom: value }, '*')
    } catch {
      // 同上：缩放同步失败不该影响渲染。
    }
  }, [])

  /**
   * 把「卡片可用宽度」推给 iframe。
   *
   * 为什么需要：卡片在对话流里的宽度由宿主决定（侧栏折叠、窗口缩放、全屏切换都会
   * 变），而模型**写页面时看不到这个值**，只能猜——猜小了两侧留白（实测被用户指出
   * 「两侧有点空」），猜大了出横向滚动条。下发后模型可以直接消费：
   *
   *   width: var(--dsh-card-w);     或     var w = window.__dshCardWidth
   *
   * 量的是 iframe 元素自身的 clientWidth（布局宽度，不含边框）——正是 iframe 内
   * 文档的视口宽度。刻意不读 contentDocument：opaque origin 下读不到，而且那会
   * 破坏沙箱边界。
   */
  const pushWidth = useCallback((): void => {
    const el = frameRef.current
    if (el === null) return
    const width = el.clientWidth
    if (!(width > 0)) return
    const win = el.contentWindow
    if (win === null || win === undefined) return
    try {
      win.postMessage({ source: BRIDGE_TO_FRAME, kind: 'width', width }, '*')
    } catch {
      // 宽度同步失败不该影响渲染。
    }
  }, [])

  /**
   * 把宿主的「表面参数」推给 iframe：底色 / 字族 / 字号。
   *
   * 存在的理由：iframe 是 opaque origin，**读不到宿主任何 CSS 变量**。所以这个
   * 沙箱里跟宿主对齐的一切都只能写死兜底值——底色曾经写死 #16181d（宿主实际
   * #151517，暗色下就是一块偏蓝的色差板），字族与字号则完全没跟。
   * 这三项全是宿主的**计算值**，只有宿主这边算得出来。
   *
   * 采集口径（都读 body 的计算样式，官方主题变量就挂在 body 上）：
   *  · background —— body 底色。会话区底色由官方 canvas 决定，读 body 即真实值。
   *  · fontFamily —— body 字族，随官方「设置 → 字体」里的文本字族变化。
   *  · fontSize   —— body 字号，随「设置 → 字号」变化（范围 10–22）。
   *
   * 失败一律静默：拿不到就退回 iframe 里的写死兜底，不该影响卡片渲染。
   */
  const pushSurface = useCallback((): void => {
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    let background = ''
    let foreground = ''
    let fontFamily = ''
    let fontSize = 0
    let accent = ''
    try {
      const cs = getComputedStyle(document.body)
      background = cs.backgroundColor
      foreground = cs.color
      fontFamily = cs.fontFamily
      fontSize = Number.parseFloat(cs.fontSize)
      /*
       * 主色（kit 的 --k-accent 来源）。探针元素读链接色：卡片里唯一需要强调色
       * 的地方是「一组数据里最该被看见的那一项」，宿主的链接色在所有主题下都被
       * 调过对比度，最稳。拿不到就留空，iframe 退回 kit 的写死兜底。
       */
      const probe = document.createElement('span')
      probe.style.color = 'var(--dsw-alias-label-link, currentColor)'
      probe.style.display = 'none'
      document.body.appendChild(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      if (typeof resolved === 'string' && resolved !== '' && resolved !== 'rgba(0, 0, 0, 0)') accent = resolved
    } catch {
      // 拿不到就不下发，iframe 用兜底值。
    }
    try {
      win.postMessage({
        source: BRIDGE_TO_FRAME,
        kind: 'surface',
        background,
        foreground,
        fontFamily,
        fontSize: Number.isFinite(fontSize) ? fontSize : 0,
        accent,
      }, '*')
    } catch {
      // 表面参数同步失败不该影响渲染。
    }
  }, [])

  /**
   * 把持久化的交互状态推给 iframe。
   *
   * 与主题/宽度同理：挂载那一刻直接推不可靠（srcDoc 异步解析），所以 ready
   * 握手时补推一次才是主路径。没有存过就不推——让 iframe 侧保持 `null`，
   * 模型代码用默认值初始化，而不是拿一个空对象去覆盖自己的默认值。
   */
  const stateKeyRef = useRef(stateKey)
  stateKeyRef.current = stateKey
  const pushState = useCallback((): void => {
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    const key = stateKeyRef.current
    if (key === '') return
    const saved = readCardState(key)
    if (saved === null) return
    try {
      win.postMessage({ source: BRIDGE_TO_FRAME, kind: 'state', state: saved }, '*')
    } catch {
      // 状态同步失败不该影响渲染。
    }
  }, [])

  // 高度上报 + ready 握手 + fill 回写：三重校验后才接受，fill 只取 text 一个字段。
  const onFillRef = useRef(onFill)
  onFillRef.current = onFill
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      // ① 来源窗口必须是本卡片自己的 iframe（opaque origin 下 origin 恒为 "null"，
      //    所以只能比窗口引用，比不了 origin）。
      if (frameRef.current === null || event.source !== frameRef.current.contentWindow) return
      const data = event.data as { source?: unknown; kind?: unknown; height?: unknown; text?: unknown; state?: unknown } | null
      if (data === null || typeof data !== 'object') return
      // ② 命名空间标记，避免把模型页面自己的 postMessage 当成桥消息。
      if (data.source !== BRIDGE_TO_HOST) return
      // ③ ready：iframe 脚本就绪，此刻推主题、缩放与宽度才收得到。
      if (data.kind === 'ready') {
        pushTheme(darkRef.current)
        pushZoom(zoomRef.current)
        pushWidth()
        pushSurface()
        // 状态最后推：先保证「能显示」，再谈「能恢复」。
        pushState()
        return
      }
      /*
       * ③b 交互状态回传：卡片内调用 window.__dshState.set({...})。
       *
       * 与 fill 同一条通道、同一套不信任口径：typeof 校验 + 必须是普通对象 +
       * 序列化后 ≤16KiB。存不下就静默丢弃——状态是锦上添花，不该让它影响卡片。
       */
      if (data.kind === 'state') {
        const key = stateKeyRef.current
        if (key === '') return
        const next = (data as { state?: unknown }).state
        if (next === null || typeof next !== 'object' || Array.isArray(next)) return
        try {
          const encoded = JSON.stringify(next)
          if (encoded.length > CARD_STATE_MAX) return
          writeCardState(key, next as Record<string, unknown>)
        } catch {
          // 循环引用之类：丢弃，不影响卡片。
        }
        return
      }
      // ④ fill 回写：卡片内调用 window.__dshFill(text) 把结果推给输入草稿。
      //    只取 text 一个字段（≤2000 字），写草稿前不执行任何内容。
      if (data.kind === 'fill') {
        if (typeof data.text !== 'string') return
        const clean = data.text.trim().slice(0, 2000)
        if (clean === '') return
        try { onFillRef.current?.(clean) } catch { /* 写回失败不影响卡片 */ }
        return
      }
      if (data.kind !== 'height') return
      if (onHeight === undefined) return
      // ⑤ 类型 + 范围：钳到硬上下限，页面再高也撑不爆对话流。
      if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
      const height = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.round(data.height)))
      onHeight(height)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [onHeight, pushTheme, pushZoom, pushSurface, pushWidth, pushState])

  /**
   * dark 变化时主动推一次（iframe 已在运行，这条不会丢）。
   *
   * surface 必须跟着一起推：底色是**按主题算出来的**，只推 theme 不推 surface，
   * 切到暗色后 iframe 仍停在亮色底色上——正是改造前「暗色下卡片里一块白/色差板」
   * 的复现路径。重载（reloadKey）同样要补推。
   */
  useEffect(() => {
    pushTheme(dark)
    pushSurface()
    // surfaceTick：宿主在设置里改字号/字族时只写 body.style，不会让本组件重渲染，
    // 靠这个滴答把新值重新推下去（否则「调了字号，卡片里还是老字号」）。
  }, [dark, pushTheme, pushSurface, reloadKey, surfaceTick])

  // zoom 变化时同样主动推（含重载后补推）。
  useEffect(() => { pushZoom(zoom) }, [zoom, pushZoom, reloadKey])

  /**
   * 宽度变化时补推。
   *
   * 三档触发都要有，缺一条就会出现「卡片按旧宽度排版、右侧空一截」：
   *  1. 重载/首次挂载后补推（ready 那条是主路径，这条兜 ready 丢失）；
   *  2. 对话流侧栏折叠 / 窗口缩放 → ResizeObserver 命中；
   *  3. 全屏进出 → 全屏态 iframe 铺满容器，宽度完全不同。
   *
   * 观察 iframe 元素本身（不是 document.body）：沙箱内文档读不到，元素尺寸宿主
   * 侧随时可读，且它正是文档视口宽度的来源。
   */
  useEffect(() => {
    pushWidth()
    pushSurface()
    const el = frameRef.current
    if (el === null || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => {
      pushWidth()
      // 宽度变化常常伴随布局重排（侧栏折叠、进出全屏），底色/字号也可能已被
      // 官方重新计算过，顺手补推一次成本几乎为零。
      pushSurface()
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [pushWidth, pushSurface, fullscreen, reloadKey])

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
export const HtmlCard = memo(function HtmlCard({ spec, pending = false, onFill }: {
  readonly spec: HtmlSpec
  /** 流式期围栏未闭合 → 只渲染占位，不挂 iframe。 */
  readonly pending?: boolean
  /** 沙箱内 window.__dshFill(text) 的回写（C），拿不到时卡片照常渲染。 */
  readonly onFill?: ((text: string) => boolean) | undefined
}): JSX.Element {
  const dark = useDarkTheme()
  const [height, setHeight] = useState<number | null>(null)
  /** 已收到的上报次数（首次落位不加过渡，见上面的高度策略）。 */
  const reports = useRef(0)
  const [animated, setAnimated] = useState(false)

  const doc = useMemo(() => assembleHtmlDocument(spec.html), [spec.html])

  /*
   * 状态键：只有正文真的用了 `__dshState` 才给（否则每张纯静态卡片都会在
   * localStorage 里占一个空记录）。哈希的是**正文内容**，见 hashContent 的说明。
   */
  const stateKey = useMemo(
    () => (spec.html.includes('__dshState') ? hashContent(spec.html) : ''),
    [spec.html],
  )

  const onHeight = useCallback((next: number): void => {
    reports.current += 1
    setHeight(prev => (prev === next ? prev : next))
    // 第二次起才允许过渡：第一次是「落位」，之后才是「生长」。
    if (reports.current > 1) setAnimated(true)
  }, [])

  const frame = (
    <SandboxFrame doc={doc} dark={dark} fullscreen={false} reloadKey={0} zoom={1} stateKey={stateKey} onHeight={onHeight} onFill={onFill} />
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
      {/*
        * 卡片上**没有任何常驻控件**（2026-10-19，用户连续两次要求砍掉）。
        *
        * 先砍标题栏（标题 + 字节数 + 五个动作按钮），再把那五个按钮本身也砍了。
        * 结论是一条明确的定位：**卡片是正文的一部分，不是嵌进来的组件**。
        * 任何常驻控件——哪怕只在 hover 时浮现——都在提示用户「这是一块外来的东西」。
        *
        * 逐个交代为什么不需要：
        *  · 标题/字节数：卡片内容自己通常有 h1；字节数是纯调试信息。
        *  · 源码/复制：围栏正文就在会话里，消息本身可复制。
        *  · 缩放：属于「查看器」心智，这张卡片不需要被查看器管理。
        *  · 重载：iframe 只在正文变化时重建，跑挂了刷新消息即可。
        *  · 全屏：同上，卡片就是正文里的一屏内容。
        */}
      {pending ? pendingStage(spec.bytes) : (
        <div
          className={animated ? 'dtt-he__stage dtt-he__stage--settled' : 'dtt-he__stage'}
          style={{ height: height === null ? MIN_FRAME_HEIGHT * 4 : height }}
        >
          {frame}
        </div>
      )}
    </figure>
  )
})
