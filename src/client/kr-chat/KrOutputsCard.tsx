/**
 * dsh-chat-plus — 「产出物」卡（右栏大盘滚动区的最后一张卡）。
 *
 * 回答一个问题：**这次对话一共做出来了哪些文件。**
 *
 * 三件事决定了它的形态：
 *  1. **整行即入口**：不挂「预览」按钮。这张卡的每一行都一定对应一个真实文件
 *     （收集层已经把认不出来的路径滤掉了），所以「点这一行」和「点那个按钮」
 *     是同一件事 —— 多一枚按钮只是把同一句话说了两遍，还让一列行里多出一列
 *     按钮。悬停时右侧浮现一枚小箭头，承担「这里能点」的提示。
 *  2. **缩略图是 SVG**：不去读真实文件当缩略图。28px 见方读不出画面内容，
 *     而为每一行发一次文件请求，代价与收益完全不成比例。按**类型**画一枚
 *     矢量缩略图，一眼分得出图 / 视频 / 3D / 文档，这才是这一列真正要传达的。
 *  3. **代码文件折成一行**：一次编码任务改十几个源文件，逐条列会把「做出来了
 *     什么」整个淹掉。折成「另有 N 个代码文件」，要看的人自己展开。
 *
 * 卡片常驻：没有产出时给一行低对比度空态，而不是整张 return null ——
 * 与「任务概览」同一口径，理由见 KrTaskOverviewCard 顶部注释。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useHeightAnimation, useMotionAllowed } from '../motion-utils.ts'
import {
  localFileMediaUrl, probeWorkspaceFile, probeWorkspaceFiles, resolveWorkspacePath, tryOpenInSidebar,
} from '../open-preview.ts'
import type { ProbeResult } from '../open-preview.ts'
import { workspaceCwdOf } from '../client-ctx.ts'
import { sessionRawUrl } from '../triad/gallery/api.ts'
import { INLINE_PREVIEW_KINDS, MediaLightbox, type LightboxItem } from '../triad/gallery/media-lightbox.tsx'
import type { OutputKind, OutputItem, OutputsView } from './outputs.ts'

/**
 * 默认露出的成品条数。
 *
 * 6 条 ≈ 6 × 24px = 144px，是右栏在「任务概览 + 操作面板」都展开后还能容忍的
 * 增量；再多就把上面两张卡挤出视口了。超出部分由底部「展开其余 N 条」承接。
 */
const MAX_VISIBLE = 6
/** 被右栏挤压时（记忆卡常驻底部触发自适应降档）收一档。 */
const MAX_VISIBLE_SQUEEZED = 4

/**
 * 类别 → 缩略图。
 *
 * 28px 见方，只画**能一眼认出的轮廓**：图 / 视频 / 音频 / 3D / 文档 / 表格 /
 * 演示 / 压缩包 / 代码。颜色不承担类型（颜色由 CSS 按 data-kind 给），形状才是
 * 判据 —— 色弱用户和灰度截图下同样读得出。
 *
 * 图形一律用 currentColor + opacity 叠层次，颜色随主题走，不在 SVG 里写死色值。
 */
function Thumb({ kind }: { readonly kind: OutputKind }): ReactElement {
  const common = {
    width: 28, height: 28, viewBox: '0 0 28 28',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  } as const

  switch (kind) {
    // 图片：山峦 + 太阳。最通用的「这是一张图」。
    case 'image':
      return (
        <svg {...common}>
          <rect x="3.5" y="6" width="21" height="16" rx="2.6" opacity=".28" fill="currentColor" stroke="none" />
          <circle cx="10" cy="11.5" r="1.9" />
          <path d="M5 19.4 10.6 14l3.6 3.4 2.9-2.6 5.9 5.4" />
        </svg>
      )
    // 视频 / 动图：胶片框 + 播放三角。
    case 'video':
      return (
        <svg {...common}>
          <rect x="3.5" y="6" width="21" height="16" rx="2.6" opacity=".28" fill="currentColor" stroke="none" />
          <path d="M11.6 11.2v5.6l4.9-2.8z" fill="currentColor" stroke="none" />
          <path d="M6.6 6v16M21.4 6v16" opacity=".55" />
        </svg>
      )
    // 音频：三根高低不同的声波。
    case 'audio':
      return (
        <svg {...common}>
          <rect x="3.5" y="6" width="21" height="16" rx="2.6" opacity=".28" fill="currentColor" stroke="none" />
          <path d="M9.2 11.4v5.2M14 9.6v8.8M18.8 12.4v3.2" strokeWidth="1.8" />
        </svg>
      )
    // 3D：立方体。等轴测三面体是「模型」唯一不歧义的画法。
    case 'model3d':
      return (
        <svg {...common}>
          <path d="M14 4.6 24 10v8.8L14 24.2 4 18.8V10z" opacity=".28" fill="currentColor" stroke="none" />
          <path d="M4 10l10 5.4 10-5.4" />
          <path d="M14 15.4v8.8" />
          <path d="M4 10v8.8L14 24.2l10-5.4V10L14 4.6z" />
        </svg>
      )
    // 文档：折角纸。
    case 'doc':
      return (
        <svg {...common}>
          <path d="M7 4.6h9.2L21 9.4v14H7z" opacity=".28" fill="currentColor" stroke="none" />
          <path d="M7 4.6h9.2L21 9.4v14H7z" />
          <path d="M16.2 4.6v4.8H21" />
          <path d="M10.4 14.4h7.2M10.4 18h5" opacity=".7" />
        </svg>
      )
    // PDF：文档 + 一条横贯的书签带（不写字，28px 下写什么都糊）。
    case 'pdf':
      return (
        <svg {...common}>
          <path d="M7 4.6h9.2L21 9.4v14H7z" opacity=".28" fill="currentColor" stroke="none" />
          <path d="M7 4.6h9.2L21 9.4v14H7z" />
          <path d="M16.2 4.6v4.8H21" />
          <path d="M7 16.6h14" strokeWidth="2.6" opacity=".8" />
        </svg>
      )
    // 表格：格线 + 表头压深。
    case 'sheet':
      return (
        <svg {...common}>
          <rect x="4.6" y="6" width="18.8" height="16" rx="2" opacity=".28" fill="currentColor" stroke="none" />
          <rect x="4.6" y="6" width="18.8" height="16" rx="2" />
          <path d="M4.6 11.4h18.8M4.6 17h18.8" opacity=".7" />
          <path d="M11.6 6v16M17.8 6v16" opacity=".5" />
        </svg>
      )
    // 演示：投屏框 + 播放三角（与 video 的区别是框在正中、四角留白）。
    case 'slide':
      return (
        <svg {...common}>
          <rect x="4.6" y="6.6" width="18.8" height="13" rx="2" opacity=".28" fill="currentColor" stroke="none" />
          <rect x="4.6" y="6.6" width="18.8" height="13" rx="2" />
          <path d="M14 19.6v3.4M10.4 23h7.2" />
          <path d="M12.4 10.6v5l4.4-2.5z" fill="currentColor" stroke="none" />
        </svg>
      )
    // 压缩包：箱体 + 拉链。
    case 'archive':
      return (
        <svg {...common}>
          <rect x="4.6" y="6" width="18.8" height="16" rx="2.2" opacity=".28" fill="currentColor" stroke="none" />
          <rect x="4.6" y="6" width="18.8" height="16" rx="2.2" />
          <path d="M14 6v9" opacity=".7" />
          <path d="M11.6 8.6h4.8M11.6 11.2h4.8" opacity=".7" />
          <rect x="12.2" y="13.6" width="3.6" height="3.4" rx="1" fill="currentColor" stroke="none" />
        </svg>
      )
    // 可打开的页面：浏览器窗口 + 地址栏。与 code 的尖括号刻意区分 ——
    // .html 交付的是"一个能打开的页面"，不是"一段源码"。
    case 'page':
      return (
        <svg {...common}>
          <rect x="3.5" y="6" width="21" height="16" rx="2.6" opacity=".28" fill="currentColor" stroke="none" />
          <rect x="3.5" y="6" width="21" height="16" rx="2.6" />
          <path d="M3.5 11.2h21" opacity=".7" />
          <circle cx="7" cy="8.6" r=".9" fill="currentColor" stroke="none" />
          <path d="M7 14.6h9M7 18h13" opacity=".7" />
        </svg>
      )
    // 代码：尖括号 + 斜杠。
    case 'code':
      return (
        <svg {...common}>
          <rect x="3.5" y="6" width="21" height="16" rx="2.6" opacity=".28" fill="currentColor" stroke="none" />
          <path d="M10.4 11.4 7.2 14l3.2 2.6M17.6 11.4 20.8 14l-3.2 2.6M15.6 10.2l-3.2 7.6" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M7 4.6h9.2L21 9.4v14H7z" opacity=".28" fill="currentColor" stroke="none" />
          <path d="M7 4.6h9.2L21 9.4v14H7z" />
          <path d="M16.2 4.6v4.8H21" />
        </svg>
      )
  }
}

export interface KrOutputsCardProps {
  readonly outputs: OutputsView
  /** 右栏被挤压时为 true，默认露出条数降一档。 */
  readonly squeezed?: boolean
  /** 当前会话 id：点击行时用它构造文件地址。 */
  readonly sessionId?: string | null
}

export const KrOutputsCard = memo(function KrOutputsCard({
  outputs,
  squeezed = false,
  sessionId = null,
}: KrOutputsCardProps) {
  const motion = useMotionAllowed(true)

  /*
   * 展开状态（整卡折叠 / 展开其余 / 代码清单展开）三件互不干扰，各自一个 state。
   * 都不落盘：它们是「这一次想不想看全」，不是长期偏好 —— 换一轮对话就该回到
   * 默认的收敛态，否则用户会莫名其妙地被上一轮的展开状态带着走。
   */
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(open, motion)

  /*
   * 核对结论：这张卡**只列磁盘上真实存在的文件**。
   *
   * 为什么必须核对（2026-10-01）：卡里的路径是从工具输出里**推断**出来的，
   * 不是模型声明的交付 —— 推断会错（URL 路径段、命令当时的 cwd、已被清理的
   * 中转目录、后来被移走的文件）。而官方右栏对不存在的路径不报错，只会开一个
   * 空白 tab、路径行显示原始字符串，用户看到的就是「点开的位置永远不对」。
   * 所以挂载后核对一遍，**确认不存在的直接不列** —— 这张卡的全部价值是
   * 「点一下就看见」，列一条点不开的条目就是在骗人。
   *
   * 两份额外状态：
   *   · `gonePaths` —— 已确认不存在，从清单里剔除，不再渲染；
   *   · `checkedPaths` —— 已确认存在，用于把「核对中」的半透明态收掉。
   * 两者都是**只增不减**：探测分批异步返回，后到的一批不该把先到的结论擦掉。
   */
  const [gonePaths, setGonePaths] = useState<ReadonlySet<string>>(() => new Set())
  const [checkedPaths, setCheckedPaths] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * 探测结论缓存：同一路径只探一次（含「挂载体检」那次）。
   *
   * **缓存自带会话标识**，不靠 effect 去清。原因：会话切换时 render 先于 effect
   * 发生，`probeTargets` 在 render 期就会读这份缓存 —— 若它还是上一会话的结论，
   * 新会话里同名相对路径会被直接跳过核对（同一路径查缓存 → 判定「已探过」），
   * 从此永远不核对。带上 sid 后，跨会话的旧结论一律视为不存在。
   */
  const probeCacheRef = useRef<{ sid: string | null; map: Map<string, ProbeResult> }>(
    { sid: sessionId, map: new Map() },
  )
  if (probeCacheRef.current.sid !== sessionId) {
    probeCacheRef.current = { sid: sessionId, map: new Map() }
  }
  const probeCache = probeCacheRef.current.map

  const rawItems = outputs.items
  const rawCode = outputs.code
  /** 过滤后的清单 —— 卡片的唯一真相源（计数、空态、渲染都读它）。 */
  const items = useMemo(
    () => rawItems.filter((item) => !gonePaths.has(item.path)),
    [rawItems, gonePaths],
  )
  const code = useMemo(
    () => rawCode.filter((path) => !gonePaths.has(path)),
    [rawCode, gonePaths],
  )
  const maxVisible = squeezed ? MAX_VISIBLE_SQUEEZED : MAX_VISIBLE
  const visible = showAll ? items : items.slice(0, maxVisible)
  const hiddenCount = items.length - visible.length
  const empty = items.length === 0 && code.length === 0
  /** 全被核对掉（做过、但现在一个都不在了）：空态文案要说得不一样。 */
  const allGone = empty && (rawItems.length > 0 || rawCode.length > 0)
  /** 「核对中」＝ 还没有结论（既没确认存在，也没被剔除）。 */
  const isPending = useCallback(
    (path: string) => !gonePaths.has(path) && !checkedPaths.has(path),
    [gonePaths, checkedPaths],
  )

  /*
   * 内容收敛时把两个展开态收回默认。
   *
   * 会话切换（新建 / 切到别的会话）会把 outputs 换成另一份内容，而 showAll 与
   * codeOpen 还留着上一份的状态：上一会话点开过「展开其余」，新会话一进来就是
   * 展开的，而用户从没在这里点过。用「成品数 + 代码数」做探针，两者同时归零
   * （= 换了一份空内容）或代码清单消失时收回。
   *
   * 探针读**原始** outputs，不是过滤后的 items —— 核对剔除几条会让过滤后长度
   * 下降，若拿它当探针，用户刚点开「展开其余」就会被收回展开态（他没做任何事，
   * 行却自己收起）。剔除是同一份内容的收窄，不是换了一份内容。
   */
  const probe = `${rawItems.length}:${rawCode.length}`
  const lastProbeRef = useRef(probe)
  useEffect(() => {
    const last = lastProbeRef.current
    lastProbeRef.current = probe
    if (last === probe) return
    // 只在「内容换了一份」时收回，条数增长（同一会话继续产出）不打扰用户。
    const [lastItems, lastCode] = last.split(':').map(Number)
    if (rawItems.length < (lastItems ?? 0) || rawCode.length < (lastCode ?? 0)) {
      setShowAll(false)
      setCodeOpen(false)
    }
  }, [probe, rawItems.length, rawCode.length])

  /*
   * 挂载后核对一遍（并发、逐个降级）。
   *
   * 探**当前露出的那几条**（含代码清单展开后的），不是整份清单：这张卡默认只显示
   * 6 行，替看不见的行付一次往返没有意义；用户点「展开其余」时那些行会进入
   * visible 并触发本 effect 补探。
   *
   * 会话切换（sessionId 变）要把缓存与结论一起清掉 —— 同一个相对路径在两个会话
   * 下指向不同文件，跨会话复用结论会剔错行。
   */
  /*
   * 核对**当前露出的每一行**（含代码清单展开后的），不是整份清单。
   *
   * 「每一行」是硬要求：这张卡的契约是「看得见的条目都真实存在」，所以只要一行
   * 会渲染出来，它就必须被核对过 —— 曾经按上限截断过 12 条，结果「展开其余」
   * 之后超出的行永远停在待定态（半透明、没结论）。默认只显示 6 行，代价本来就小；
   * 展开后行数虽多，但已核对过的会经 probeCacheRef 过滤掉，不会重复往返。
   *
   * 会话切换（sessionId 变）要把缓存与结论一起清掉 —— 同一个相对路径在两个会话
   * 下指向不同文件，跨会话复用结论会剔错行。
   */
  const probeTargets = useMemo(() => {
    const paths: string[] = []
    for (const item of visible) paths.push(item.path)
    if (codeOpen) for (const path of code) paths.push(path)
    // 已有结论的不再探测：展开/收起会让 visible 反复变化，去重避免来回打请求。
    // 依赖里带上 gonePaths/checkedPaths —— ref 变化不触发重算，而这两个 state
    // 正是「结论已经拿到」的信号；漏了它们，收起再展开会对同一路径重复往返。
    return paths.filter((path) => !probeCache.has(path))
  }, [visible, codeOpen, code, gonePaths, checkedPaths, probeCache])
  const probeKey = probeTargets.join('\u0000')

  /*
   * 会话切换：清掉结论（缓存已由上面的 sid 比对换新）。
   *
   * gonePaths/checkedPaths 是 state，必须显式清 —— 否则新会话里会被上一会话的
   * 剔除名单误伤。
   */
  useEffect(() => {
    setGonePaths(new Set())
    setCheckedPaths(new Set())
  }, [sessionId])

  useEffect(() => {
    if (probeTargets.length === 0) return
    let cancelled = false
    void (async () => {
      const results = await probeWorkspaceFiles(probeTargets, { sessionId })
      if (cancelled) return
      const gone = new Set<string>()
      const settled = new Set<string>()
      for (const [path, verdict] of results) {
        // 三种结论都算「问过了」：缓存挡住重复请求，settled 收掉待定的半透明态。
        // unknown（宿主降级 / 载体中断）是「没探成」，不是「文件没了」—— 它**不剔除**
        // （宁可留一条可能点不开的，也不能在探测失败时把用户的产出清空），但也不该
        // 永远挂着待定外观：问过就是问过了，按可点处理，把决定权交回给右栏。
        probeCache.set(path, verdict)
        settled.add(path)
        if (verdict === 'missing') gone.add(path)
      }
      if (gone.size > 0) {
        setGonePaths((prev) => {
          const next = new Set(prev)
          for (const path of gone) next.add(path)
          return next
        })
      }
      if (settled.size > 0) {
        setCheckedPaths((prev) => {
          const next = new Set(prev)
          for (const path of settled) next.add(path)
          return next
        })
      }
    })()
    return () => { cancelled = true }
    // probeTargets 每帧都是新数组，用拼好的 key 做依赖。
  }, [probeKey, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 画廊式 Lightbox 的打开态（2026-10-04：产出物行点主体 = 画廊同款预览）。
   * index 指向 visible 清单；md / 代码等不可内联预览的类别不进这里（主体点击
   * 直接走 openSidebar 原路）。
   */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const openPath = useCallback(async (path: string) => {
    /*
     * 打开前再确认一次（缓存命中就不重复请求）。
     *
     * 体检是挂载那一刻的快照，文件可能在之后被删/被移走；而官方右栏对不存在的
     * 路径不报错，只会开一个空白 tab。所以点下去之前再问一次：确认不在就当场
     * 把这行从清单里剔掉（它会自然消失），不开空 tab。
     *
     * 只有 `missing` 才剔除 —— `unknown` 照常打开，把决定权交回给右栏。
     */
    const known = probeCache.get(path)
    const verdict: ProbeResult = known ?? await probeWorkspaceFile(path, { sessionId })
    probeCache.set(path, verdict)
    if (verdict === 'missing') {
      setGonePaths((prev) => {
        if (prev.has(path)) return prev
        const next = new Set(prev)
        next.add(path)
        return next
      })
      return
    }
    // 问过了（exists 或 unknown）：收掉待定外观。
    setCheckedPaths((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))
    tryOpenInSidebar(path, { sessionId, cwd: workspaceCwdOf(sessionId) })
  }, [sessionId])

  /**
   * 行主体点击（2026-10-04）：可内联预览类别开画廊式 Lightbox；md / 代码 /
   * Office 等**除外** —— 回退原侧栏路。对话滚动守卫已改为 KR 视图常驻
   * （scroll-guard.ts，在 KrAgentPanel 挂载），这里不再 per-click 装钩。
   */
  const openInline = useCallback((item: OutputItem, index: number) => {
    if (!INLINE_PREVIEW_KINDS.has(item.kind)) { void openPath(item.path); return }
    setLightboxIndex(index)
  }, [openPath])

  /** Lightbox 内的「预览文档」出口：交回官方右栏。 */
  const openSidebarFromLightbox = useCallback((item: LightboxItem) => {
    setLightboxIndex(null)
    void openPath(item.path)
  }, [openPath])

  /*
   * 交给 Lightbox 的条目：路径先**折成会话工作区下的绝对路径**。
   *
   * 为什么必须折（2026-10-05 修「点图片加载不出来」）：present / write 的参数
   * 常是相对路径（`深圳一日游_20261006/slide_01.png`），而 host 的 /raw 准入名单
   * 里存的是**绝对路径**（提取时按会话 cwd 解析过）。host 侧已按会话 cwd 兜住
   * 相对路径，这里再折一次是第二道保险：地址形态与索引形态完全一致，不再依赖
   * 服务端的路径基准推断；相对路径在 cwd 未知时原样传给 host（由它按会话 cwd 解）。
   *
   * 侧栏那条路（openPath → 官方 workspaceFiles）不受影响：它本来就把相对路径
   * 相对会话工作区解析，折成绝对只是同一结果的另一种写法。
   */
  const cwd = workspaceCwdOf(sessionId)
  const lightboxItems = useMemo<readonly LightboxItem[]>(
    () => visible.map((item) => ({
      path: resolveWorkspacePath(cwd, item.path),
      name: item.name,
      kind: item.kind,
      source: 'file' as const,
      time: 0,
      sessionId: sessionId ?? '',
    })),
    [visible, sessionId, cwd],
  )

  /*
   * Lightbox 的取图地址：**优先官方 /api/file**（与右栏文档预览同一条链路）。
   *
   * 为什么不再一律走画廊的 /raw（2026-10-05）：/raw 是插件自己的路由，它的准入
   * 名单由 host 半身在内存里折出来 —— 名单与浏览器里的这份清单是**两套独立状态**，
   * 任一侧没跟上（host 还挂着旧模块、会话索引尚未折到这条路径），用户看到的就是
   * 「产出物卡里明明有这张图，点开却是裂图」。而侧栏那条路一直是好的，因为它走
   * 官方 workspaceFiles / /api/file，与插件的索引无关。
   *
   * 于是这里与侧栏**对齐到同一条链路**：折成绝对路径后交给 /api/file；只有折不出
   * 绝对路径（会话 cwd 未知）时才退回 /raw（host 侧能按会话 cwd 解析）。
   * 画廊面板仍走 /raw —— 那是跨会话清单，白名单语义在那里才成立。
   */
  const mediaUrlOf = useCallback((item: LightboxItem): string => {
    const official = localFileMediaUrl(item.path)
    return official ?? sessionRawUrl(item.path, item.sessionId)
  }, [])

  /*
   * 计数读**过滤后**的清单（items / code），不是 outputs 原始值 —— 剔除的失效
   * 条目不该被算进「N 项」，否则头部的数字和下面的行数对不上，用户数一遍就懵。
   */
  const header = useMemo(() => {
    if (empty) return '0 项'
    if (code.length === 0) return `${items.length} 项`
    if (items.length === 0) return `${code.length} 个代码文件`
    return `${items.length} 项`
  }, [empty, items.length, code.length])

  return (
    <div className="kr-card kr-card--outputs" data-empty={empty || undefined}>
      <div
        className="kr-card__header"
        onClick={() => { setOpen((value) => !value) }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((value) => !value)
          }
        }}
      >
        <span className="kr-card__icon">
          {/*
           * 「做出来了什么」：一个打开的盒子，东西从里面露出来。
           * 刻意避开与另外几张卡撞形 —— 任务概览是横向清单、操作面板是时间线、
           * 记忆是大脑。产出物讲的是「容器里装着的成品」，盒子是唯一诚实的图形。
           */}
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.1 5.2 8 2.4l5.9 2.8v5.6L8 13.6 2.1 10.8z" />
            <path d="M2.1 5.2 8 8l5.9-2.8" />
            <path d="M8 8v5.6" />
          </svg>
        </span>
        <span className="kr-card__title">产出物</span>
        <span className="kr-card__meta">{header}</span>
      </div>

      {bodyPresent && (
        <div
          ref={bodyRef}
          className="kr-out-body"
          data-open={open || undefined}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          {empty ? (
            <div className="kr-out-empty">
              {allGone ? '本次会话产出的文件都已不在磁盘上' : '本次会话还没有产出文件'}
            </div>
          ) : (
            <>
              {visible.length > 0 && (
                <div className="kr-out-list">
                  {visible.map((item, index) => (
                    <OutputRow
                      key={item.path}
                      item={item}
                      index={index}
                      pending={isPending(item.path)}
                      onOpen={() => { openInline(item, index) }}
                      onSidebar={() => { void openPath(item.path) }}
                    />
                  ))}
                </div>
              )}

              {/*
               * 代码文件折行。
               *
               * 展开后逐条列出的仍是**同一套行样式**（缩略图 + 文件名），只是缩进
               * 一级 —— 复用样式而不是另造一套「代码清单」，是因为它们对用户是
               * 同一件事（做出来的文件），不该在视觉上分成两种东西。
               */}
              {code.length > 0 && (
                <div className="kr-out-code" data-open={codeOpen || undefined}>
                  <button
                    type="button"
                    className="kr-out-code__toggle"
                    aria-expanded={codeOpen}
                    onClick={() => { setCodeOpen((value) => !value) }}
                  >
                    <span className="kr-out-code__thumb" aria-hidden>
                      <Thumb kind="code" />
                    </span>
                    <span className="kr-out-code__text">
                      {codeOpen ? `${code.length} 个代码文件` : `另有 ${code.length} 个代码文件`}
                    </span>
                    <span className="kr-out-code__action">{codeOpen ? '收起' : '展开'}</span>
                    <svg className="kr-out-code__chevron" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m4.4 6.2 3.6 3.6 3.6-3.6" />
                    </svg>
                  </button>
                  {codeOpen && (
                    <div className="kr-out-list kr-out-list--code">
                      {code.map((path, index) => (
                        <OutputRow
                          key={path}
                          item={{ path, name: path.split(/[/\\]/).filter(Boolean).at(-1) ?? path, kind: 'code' }}
                          index={index}
                          pending={isPending(path)}
                          onOpen={() => { void openPath(path) }}
                          onSidebar={() => { void openPath(path) }}
                          nested
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="kr-out-more"
                  onClick={() => { setShowAll(true) }}
                >
                  <span>展开其余 {hiddenCount} 条</span>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m4.4 6.2 3.6 3.6 3.6-3.6" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 画廊同款 Lightbox（共享组件，含全屏）：行主体点开的预览层。 */}
      {lightboxIndex !== null && lightboxIndex >= 0 && lightboxIndex < lightboxItems.length && (
        <MediaLightbox
          items={lightboxItems}
          index={lightboxIndex}
          fileUrlOf={mediaUrlOf}
          onNavigate={setLightboxIndex}
          onClose={() => { setLightboxIndex(null) }}
          onOpenSidebar={openSidebarFromLightbox}
        />
      )}
    </div>
  )
})

/**
 * 一行产出物。
 *
 * **整行就是一个按钮**（不是 div + 行内小按钮）：这张卡每一行都对应一个真实
 * 文件，「点这一行」和「点那个按钮」是同一件事。做成整行可点还顺手解决了
 * 键盘与触屏：Tab 一次就到，不需要先聚焦到一个 10px 高的小按钮上。
 *
 * 悬停时右侧浮现一枚箭头（纯视觉、aria-hidden）：承担「这里能点」的提示，
 * 但不占按钮位、不进无障碍树 —— 读屏用户听到的是整行的 aria-label。
 *
 * `pending` 是**核对尚未出结论**：这一行刚上屏、还没问过磁盘。此时只要一点点
 * 低对比度（`data-pending`）而不是置灰 —— 绝大多数文件是活的，一瞬间的待定态
 * 不该看起来像出了事。结论是「不存在」的行根本不会走到这里（已被剔除）。
 */
function OutputRow({ item, index, pending = false, onOpen, onSidebar, nested = false }: {
  readonly item: OutputItem
  readonly index: number
  readonly pending?: boolean
  /** 行主体点击：可内联预览类别开画廊式 Lightbox，其余由调用方回退侧栏。 */
  readonly onOpen: () => void
  /** 行尾「侧栏预览」钮：维持原来的官方右栏打开方式（用户 2026-10-04 点名保留）。 */
  readonly onSidebar: () => void
  readonly nested?: boolean
}): ReactElement {
  return (
    <div
      className="kr-out-row"
      data-kind={item.kind}
      data-pending={pending ? 'true' : undefined}
      data-nested={nested ? 'true' : undefined}
      title={item.path}
      // 错峰入场：只对靠后的若干条错开，卡片整体不拖出一段长尾。
      style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
    >
      <button
        type="button"
        className="kr-out-row__main"
        aria-label={`预览 ${item.name}`}
        onClick={onOpen}
      >
        <span className="kr-out-row__thumb" data-kind={item.kind} aria-hidden>
          <Thumb kind={item.kind} />
        </span>
        <span className="kr-out-row__name">{item.name}</span>
      </button>
      {/*
       * 行尾真按钮（2026-10-04）：「在侧栏打开」—— 维持原来的官方右栏预览链路。
       * 行主体的画廊式 Lightbox 是新增的默认预览，这枚钮是用户点名的「按原来的
       * 方式打开」的显式出口。hover / focus 才浮现（与旧箭头同一套节奏），
       * stopPropagation 防止连带触发行主体。
       */}
      <button
        type="button"
        className="kr-out-row__open"
        aria-label={`在侧栏打开 ${item.name}`}
        title="在侧栏打开"
        onClick={(event) => { event.stopPropagation(); onSidebar() }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6.4 3.2H3.6A1.4 1.4 0 0 0 2.2 4.6v7.8a1.4 1.4 0 0 0 1.4 1.4h7.8a1.4 1.4 0 0 0 1.4-1.4V9.6" />
          <path d="M9.6 2.2h4.2v4.2" />
          <path d="M13.8 2.2 7.6 8.4" />
        </svg>
      </button>
    </div>
  )
}
