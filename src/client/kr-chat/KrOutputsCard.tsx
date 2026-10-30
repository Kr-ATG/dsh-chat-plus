/**
 * dsh-chat-plus — 「产出物」卡（右栏大盘滚动区的最后一张卡）。
 *
 * 回答一个问题：**这次对话一共做出来了哪些文件。**
 *
 * 三件事决定了它的形态：
 *  1. **整行即入口，落点按「侧栏能不能正常展示」分流**（2026-10-22 按用户口径
 *     定稿）：能展示的（图片 / 文档 / Office / PDF / 表格 / 页面 / 音视频）→
 *     **官方右侧栏**，就地看、不弹外部程序；侧栏展示不了的（3D 模型、压缩包、
 *     avif/tif/heic、ods…）→ **系统默认应用**。判据见 `../sidebar-display.ts`，
 *     它读官方 documentPreviews 注册表 + 一张与接管渲染器同源的静态表。
 *
 *     沿革：2026-10-20 曾改成「一律交给系统默认应用」，理由是"产出物是拿去用的"。
 *     实测那样对图 / 文档这类侧栏看得很好的东西是过度动作（点一下就把 PowerPoint
 *     整窗拉起来），而 3D / 压缩包反而只得到系统关联的一次弹窗。现在按类型分流，
 *     两边都各得其所。
 *     系统默认那条走本插件 `/api/chat-flow/open-file`（按会话工作区绝对化 +
 *     浏览器文档进默认浏览器），封装见 `../open-file.ts`；开不了再退回官方
 *     `remote.session.openWorkspacePath`，再不行退回侧栏。悬停时右侧浮现一枚
 *     小箭头，承担「这里能点」的提示。
 *  2. **缩略图是 SVG**：不去读真实文件当缩略图。28px 见方读不出画面内容，
 *     而为每一行发一次文件请求，代价与收益完全不成比例。按**类型**画一枚
 *     矢量缩略图，一眼分得出图 / 视频 / 3D / 文档，这才是这一列真正要传达的。
 *  3. **代码文件不出现**（2026-10-19）：源文件是材料不是成品，连"折成一行计数"
 *     也不留 —— 一行「另有 N 个代码文件」仍然在提示"这里有一批你看不到的东西"，
 *     而对读者来说那批东西本来就该去对话流的工具折叠里看。这张卡只列成品。
 *
 * **没有产出时整张卡不渲染**（2026-10-19 按用户要求；2026-10-28 用户再次强调
 * 「空的不要显示卡片」）。挂载方先按 outputs.items.length 拦一道；组件内部再按
 * **过滤后**的 items.length 兜一道 —— 路径核对（gonePaths）把条目全部剔除后，
 * 原始清单可能非空、屏幕上却只剩「0 项」，这一层必须也 return null，否则右栏
 * 底部会留一张空壳卡。任务概览卡现在同样空时不渲染（2026-10-28 统一口径）。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useHeightAnimation, useMotionAllowed } from '../motion-utils.ts'
import { probeWorkspaceFile, probeWorkspaceFiles, resolveWorkspacePath, tryOpenInSidebar } from '../open-preview.ts'
import type { ProbeResult } from '../open-preview.ts'
import { getService, workspaceCwdOf } from '../client-ctx.ts'
import { openWithDefaultApp } from '../open-default-app.ts'
import { openOutputFile } from '../open-file.ts'
import { canShowInSidebar } from '../sidebar-display.ts'
import { groupOutputs, outputTimeText } from './outputs.ts'
import type { OutputKind, OutputGroup, OutputItem, OutputsView } from './outputs.ts'

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
 * 分组后的可见切片。
 *
 * 只有一个类别时保持旧版「前 N 条」的行为，连组标题都不画 —— 一张只有图片的
 * 产出物卡不需要在每张图上再重复一遍「图片」。只有**两个及以上类别**才进入
 * 分组视图，此时默认露出策略改成「每组先露一条，剩余额度按组序补」：分类显示
 * 的第一价值是让读者知道「这次做出了哪几类东西」，不能让第一类把后面几类
 * 全挤到「展开其余」里。
 */
interface VisibleOutputGroup {
  readonly kind: OutputKind
  readonly label: string
  /** 该类的完整条数（不是当前露出的条数）—— 组标题上的计数读的是它。 */
  readonly total: number
  readonly items: readonly OutputItem[]
}

function visibleGroupsOf(
  groups: readonly OutputGroup[],
  showAll: boolean,
  maxVisible: number,
): readonly VisibleOutputGroup[] {
  if (groups.length === 0) return []
  if (groups.length === 1) {
    const only = groups[0]!
    return [{
      kind: only.kind,
      label: only.label,
      total: only.items.length,
      items: showAll ? only.items : only.items.slice(0, maxVisible),
    }]
  }
  if (showAll) {
    return groups.map((group) => ({
      kind: group.kind,
      label: group.label,
      total: group.items.length,
      items: group.items,
    }))
  }
  // 每组先占一个名额（组数比额度多时只露前 maxVisible 组），剩余额度再按组序补。
  let budget = maxVisible
  const counts = groups.map(() => 0)
  for (let index = 0; index < groups.length && budget > 0; index += 1) {
    counts[index] = 1
    budget -= 1
  }
  for (let index = 0; index < groups.length && budget > 0; index += 1) {
    const extra = Math.min(budget, groups[index]!.items.length - counts[index]!)
    if (extra > 0) {
      counts[index]! += extra
      budget -= extra
    }
  }
  return groups
    .map((group, index) => ({
      kind: group.kind,
      label: group.label,
      total: group.items.length,
      items: group.items.slice(0, counts[index]!),
    }))
    .filter((group) => group.items.length > 0)
}

/**
 * 把一条产出物插入当前会话的输入框（「引用到对话框」）。
 *
 * 走官方 @ 文件引用（source='reference' / ref='@path'）：插入的是可点、可删的
 * 文件引用 chip，不是普通字符串。路径先按条目所属会话（子智能体条目用子会话）
 * 解析成绝对路径，再交给主会话 composer —— 主会话与子会话通常共享工作区，
 * 绝对路径在两边都成立。
 *
 * 拿不到 composer 时回退剪贴板（至少用户能手动贴进去），绝不静默丢内容。
 * @param item - 要引用的产出物。
 * @param sessionId - 当前主会话 id（composer 落点）。
 * @returns 是否成功插入或回退到剪贴板。
 */
function insertOutputReference(item: OutputItem, sessionId: string | null): boolean {
  if (sessionId === null || sessionId === '') return false
  const cwd = workspaceCwdOf(item.sessionId ?? sessionId)
  const absolute = resolveWorkspacePath(cwd, item.path)
  const mention = /\s/u.test(absolute) ? '@"' + absolute + '"' : '@' + absolute
  const sessions = getService<any>('sessions')
  const conversation = getService<any>('conversation')
  const binding = sessions?.binding?.(sessionId)
  if (conversation !== undefined && conversation !== null && binding?.ctx !== undefined) {
    try {
      const shell = conversation.input?.for?.(binding.ctx)
      const span = shell?.actions?.captureInsertion?.()
      if (shell !== undefined && shell !== null && span !== undefined && typeof shell.insertReference === 'function') {
        const inserted = shell.insertReference({
          source: 'reference',
          ref: mention,
          label: item.name,
          appearance: 'file',
          clipboardText: mention,
        }, span)
        if (inserted === true) {
          try { shell.focus?.() } catch { /* 聚焦失败不影响插入结果 */ }
          return true
        }
      }
    } catch { /* 走剪贴板兜底 */ }
  }
  try {
    void navigator.clipboard.writeText(mention)
    return true
  } catch {
    return false
  }
}

/** 右键菜单的一条状态：点在哪、作用在哪条产出物上。 */
interface OutputMenuState {
  readonly item: OutputItem
  readonly x: number
  readonly y: number
}

/**
 * 产出物行的右键菜单。
 *
 * 只有两项：引用到对话框 / 使用系统默认程序打开。位置跟随指针、按视口夹紧；
 * 点击外部、Escape、滚动、窗口尺寸变化都关闭（与项目里其它浮层同一套手感）。
 */
function OutputContextMenu({ menu, onClose, onQuote, onOpenDefault }: {
  readonly menu: OutputMenuState
  readonly onClose: () => void
  readonly onQuote: () => void
  readonly onOpenDefault: () => void
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const firstRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    firstRef.current?.focus()
    const pointer = (event: PointerEvent): void => {
      if (ref.current !== null && event.target instanceof Node && ref.current.contains(event.target)) return
      onClose()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])
  const width = 208
  const height = 84
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))
  return createPortal(
    <div
      ref={ref}
      className="kr-out-menu"
      role="menu"
      style={{ left: left + 'px', top: top + 'px', width: width + 'px' }}
      onContextMenu={(event) => { event.preventDefault() }}
    >
      <button ref={firstRef} type="button" role="menuitem" className="kr-out-menu__item" onClick={onQuote}>
        引用到对话框
      </button>
      <button type="button" role="menuitem" className="kr-out-menu__item" onClick={onOpenDefault}>
        使用系统默认程序打开
      </button>
    </div>,
    document.body,
  )
}

/**
 * 类别 → 缩略图。
 *
 * 28px 见方，只画**能一眼认出的轮廓**：图 / 视频 / 音频 / 3D / 文档 / 表格 /
 * 演示 / 压缩包 / 安装文件 / 代码。颜色不承担类型（颜色由 CSS 按 data-kind 给），
 * 形状才是判据 —— 色弱用户和灰度截图下同样读得出。
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
    // 安装文件：箱体 + 向下的安装箭头（与压缩包的拉链箱区分开）。
    case 'installer':
      return (
        <svg {...common}>
          <rect x="4.6" y="6" width="18.8" height="16" rx="2.2" opacity=".28" fill="currentColor" stroke="none" />
          <rect x="4.6" y="6" width="18.8" height="16" rx="2.2" />
          <path d="M14 9v7" />
          <path d="m10.8 13 3.2 3.2 3.2-3.2" />
          <path d="M9.4 19.4h9.2" opacity=".7" />
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
  /** 过滤后的清单 —— 卡片的唯一真相源（计数、空态、渲染都读它）。 */
  const items = useMemo(
    () => rawItems.filter((item) => !gonePaths.has(item.path)),
    [rawItems, gonePaths],
  )
  const groups = useMemo(() => groupOutputs(items), [items])
  const grouped = groups.length > 1
  const maxVisible = squeezed ? MAX_VISIBLE_SQUEEZED : MAX_VISIBLE
  const visibleGroups = useMemo(
    () => visibleGroupsOf(groups, showAll, maxVisible),
    [groups, showAll, maxVisible],
  )
  const visible = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups])
  /** 全局行序号：错峰入场按整卡顺序走，不按组内序号重来（否则每组第一行都同时入场）。 */
  const rowOrder = useMemo(() => new Map(visible.map((item, index) => [item.path, index])), [visible])
  const hiddenCount = items.length - visible.length
  /** 「核对中」＝ 还没有结论（既没确认存在，也没被剔除）。 */
  const isPending = useCallback(
    (path: string) => !gonePaths.has(path) && !checkedPaths.has(path),
    [gonePaths, checkedPaths],
  )

  /*
   * 内容收敛时把两个展开态收回默认。
   *
   * 会话切换（新建 / 切到别的会话）会把 outputs 换成另一份内容，而 showAll
   * 还留着上一份的状态：上一会话点开过「展开其余」，新会话一进来就是展开的，
   * 而用户从没在这里点过。用「成品数」做探针，归零（= 换了一份空内容）时收回。
   *
   * 探针读**原始** outputs，不是过滤后的 items —— 核对剔除几条会让过滤后长度
   * 下降，若拿它当探针，用户刚点开「展开其余」就会被收回展开态（他没做任何事，
   * 行却自己收起）。剔除是同一份内容的收窄，不是换了一份内容。
   */
  const probe = String(rawItems.length)
  const lastProbeRef = useRef(probe)
  useEffect(() => {
    const last = lastProbeRef.current
    lastProbeRef.current = probe
    if (last === probe) return
    // 只在「内容换了一份」时收回，条数增长（同一会话继续产出）不打扰用户。
    if (rawItems.length < Number(last)) setShowAll(false)
  }, [probe, rawItems.length])

  /*
   * 挂载后核对一遍（并发、逐个降级）。
   *
   * 探**当前露出的那几条**，不是整份清单：这张卡默认只显示 6 行，替看不见的行
   * 付一次往返没有意义；用户点「展开其余」时那些行会进入 visible 并触发补探。
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
    const targets: { readonly path: string; readonly sessionId: string | null }[] = []
    const seen = new Set<string>()
    for (const item of visible) {
      // 子智能体条目的工作区是子会话，不能拿主会话 id 去 stat。按条目自带的
      // sessionId 分组探测；主会话条目回落到 props.sessionId。
      const targetSessionId = item.sessionId ?? sessionId
      const key = (targetSessionId ?? '') + '|' + item.path
      if (seen.has(key) || probeCache.has(item.path)) continue
      seen.add(key)
      targets.push({ path: item.path, sessionId: targetSessionId })
    }
    // 已有结论的不再探测：展开/收起会让 visible 反复变化，去重避免来回打请求。
    // 依赖里带上 gonePaths/checkedPaths —— ref 变化不触发重算，而这两个 state
    // 正是「结论已经拿到」的信号；漏了它们，收起再展开会对同一路径重复往返。
    return targets
  }, [visible, gonePaths, checkedPaths, probeCache, sessionId])
  const probeKey = probeTargets.map((target) => (target.sessionId ?? '') + '|' + target.path).join('\u0000')

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
      const bySession = new Map<string | null, string[]>()
      for (const target of probeTargets) {
        const bucket = bySession.get(target.sessionId)
        if (bucket === undefined) bySession.set(target.sessionId, [target.path])
        else bucket.push(target.path)
      }
      const batches = await Promise.all([...bySession.entries()].map(([targetSessionId, paths]) =>
        probeWorkspaceFiles(paths, { sessionId: targetSessionId })))
      if (cancelled) return
      const results = new Map<string, ProbeResult>()
      for (const batch of batches) for (const [path, verdict] of batch) results.set(path, verdict)
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

  /*
   * 右键菜单：使用系统默认程序打开。
   *
   * 与左键的分流相反：这里用户明确选了"系统默认程序"，所以不再先试侧栏。
   * 仍走本插件 openOutputFile（按会话工作区绝对化 + stat + .html 交给默认浏览器）；
   * 仅在该路由不可用的旧宿主上退回官方 openWithDefaultApp，最终仍失败才退回侧栏
   * 作为可操作落点。
   */
  const openDefault = useCallback(async (item: OutputItem): Promise<void> => {
    const targetSessionId = item.sessionId ?? sessionId
    const cwd = workspaceCwdOf(targetSessionId)
    /*
     * 安装文件（exe / msi / apk…）走官方「默认应用」而不是本插件 open-file：
     * 后者的安全策略明确拒绝可执行扩展名（防止被当成任意程序启动器）。用户
     * 主动点安装包时，语义就是「交给系统安装程序」，与双击一致；这里仍由官方
     * verifyDesktopPath 校验路径，失败再退回侧栏（侧栏通常不支持，至少不静默）。
     */
    if (item.kind === 'installer') {
      const absolute = cwd === undefined ? item.path : resolveWorkspacePath(cwd, item.path)
      if (await openWithDefaultApp(absolute) === 'opened') return
      tryOpenInSidebar(item.path, { sessionId: targetSessionId, cwd })
      return
    }
    const result = await openOutputFile(item.path, { cwd })
    if (result === 'opened') return
    if (result === 'unavailable') {
      const absolute = cwd === undefined ? item.path : resolveWorkspacePath(cwd, item.path)
      const legacy = await openWithDefaultApp(absolute)
      if (legacy === 'opened') return
    }
    tryOpenInSidebar(item.path, { sessionId: targetSessionId, cwd })
  }, [sessionId])

  const openPath = useCallback(async (item: OutputItem) => {
    /*
     * 打开前再确认一次（缓存命中就不重复请求）。
     *
     * 体检是挂载那一刻的快照，文件可能在之后被删/被移走；而两种打开方式对不存在
     * 的路径都不报错（默认应用会静默失败，官方右栏只会开一个空白 tab）。所以点
     * 下去之前再问一次：确认不在就当场把这行从清单里剔掉（它会自然消失）。
     *
     * 只有 `missing` 才剔除 —— `unknown` 照常打开，把决定权交回给打开链路。
     */
    const targetSessionId = item.sessionId ?? sessionId
    const path = item.path
    const known = probeCache.get(path)
    const verdict: ProbeResult = known ?? await probeWorkspaceFile(path, { sessionId: targetSessionId })
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
    const cwd = workspaceCwdOf(targetSessionId)
    /*
     * 分流（2026-10-22 按用户口径）：**侧栏能正常展示的走侧栏，其余走系统默认**。
     *
     * 为什么不是「一律系统默认」（2026-10-20 那版）：图 / PDF / Office / 视频
     * 这些侧栏看得很好的东西，点一下把 PowerPoint / 播放器整窗拉起来，是过度动作；
     * 而 3D 模型、压缩包这些侧栏根本展示不了的，点一下只有一句"不支持预览"。
     * 判据逐扩展名核验过（官方渲染器清单 + 本插件接管的两个渲染器），见
     * ../sidebar-display.ts 文件头。
     */
    if (canShowInSidebar(path)) {
      /*
       * 官方右侧栏：与对话流里的文件链接、文件树、deliverable 卡片同一条链路。
       * 全局面板占着主列时 openWorkspacePreview 会先收起面板（官方右栏只在
       * 会话填满主列时可见），这不是本卡多做的一步。
       */
      if (tryOpenInSidebar(path, { sessionId: targetSessionId, cwd })) return
      // 右栏服务不可用（旧宿主 / 手机远程）：退回系统默认 —— 总比点了没反应好。
    }
    await openDefault(item)
  }, [openDefault, sessionId])

  /** 右键菜单状态：作用条目 + 指针位置。 */
  const [menu, setMenu] = useState<OutputMenuState | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => { setMenu(null) }, [])
  const openMenu = useCallback((event: ReactMouseEvent, item: OutputItem) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ item, x: event.clientX, y: event.clientY })
  }, [])
  /*
   * 右键的**原生捕获兜底**。
   *
   * 某些页面环境里，右键事件会先被别的全局手势处理掉，React 的合成事件
   * （挂在根容器冒泡阶段）收不到；这里在卡片根节点用 capture 阶段拦一次，
   * 先于任何冒泡处理器执行，保证产出物行一定能打开自己的菜单。行上仍保留
   * React onContextMenu 作为普通环境的直路；捕获层 stopPropagation 后，
   * React 那条不会再触发，不会出现两份菜单。
   */
  useEffect(() => {
    const root = cardRef.current
    if (root === null) return undefined
    const onNativeContextMenu = (event: MouseEvent): void => {
      const target = event.target
      const row = target instanceof Element ? target.closest('.kr-out-row') : null
      if (!(row instanceof HTMLElement) || !root.contains(row)) return
      const path = row.dataset.outputPath
      const item = path === undefined ? undefined : items.find((entry) => entry.path === path)
      if (item === undefined) return
      event.preventDefault()
      event.stopPropagation()
      setMenu({ item, x: event.clientX, y: event.clientY })
    }
    // 挂在 window 的捕获阶段：比页面里任何 document / 卡片级右键拦截都先到。
    window.addEventListener('contextmenu', onNativeContextMenu, true)
    return () => { window.removeEventListener('contextmenu', onNativeContextMenu, true) }
  }, [items])
  const quoteMenuItem = useCallback(() => {
    if (menu !== null) insertOutputReference(menu.item, sessionId)
    setMenu(null)
  }, [menu, sessionId])
  const openDefaultMenuItem = useCallback(() => {
    if (menu !== null) void openDefault(menu.item)
    setMenu(null)
  }, [menu, openDefault])

  /*
   * 计数读**过滤后**的清单（items），不是 outputs 原始值 —— 剔除的失效条目不该
   * 被算进「N 项」，否则头部的数字和下面的行数对不上，用户数一遍就懵。
   * 走到这里时 items 必非空（空态由挂载方拦掉，见文件头）。
   */
  // 多类时把类别数也放进卡头：卡片收起（标题行仍可见）时也能看出「这次产出分几类」。
  const header = grouped ? `${items.length} 项 · ${groups.length} 类` : `${items.length} 项`

  // 2026-10-28：过滤后为空也不渲染（路径核对全部剔除时，清单只剩「0 项」空壳）。
  // 放在全部 hooks 之后，保证 hooks 顺序稳定。
  if (items.length === 0) return null

  return (
    <div className="kr-card kr-card--outputs" ref={cardRef}>
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
          {visible.length > 0 && (
            <div className={`kr-out-list${grouped ? ' kr-out-list--grouped' : ''}`}>
              {visibleGroups.map((group) => (
                <div
                  className="kr-out-group"
                  key={group.kind}
                  data-kind={group.kind}
                  role="group"
                  aria-label={`${group.label}，${group.total} 项`}
                >
                  {grouped && (
                    <div className="kr-out-group__head">
                      <span className="kr-out-group__name">{group.label}</span>
                      <span className="kr-out-group__rule" aria-hidden="true" />
                      <span className="kr-out-group__count">{group.total}</span>
                    </div>
                  )}
                  {group.items.map((item) => (
                    <OutputRow
                      key={item.path}
                      item={item}
                      index={rowOrder.get(item.path) ?? 0}
                      pending={isPending(item.path)}
                      onOpen={() => { void openPath(item) }}
                      onContextMenu={(event) => { openMenu(event, item) }}
                    />
                  ))}
                </div>
              ))}
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
        </div>
      )}

      {menu !== null && (
        <OutputContextMenu
          menu={menu}
          onClose={closeMenu}
          onQuote={quoteMenuItem}
          onOpenDefault={openDefaultMenuItem}
        />
      )}
    </div>
  )
})

/**
 * 一行产出物。
 *
 * **整行就是一个按钮**：这张卡每一行都对应一个真实文件。点击落点按类型分流
 * （2026-10-22）：侧栏能正常展示的 → **官方右侧栏**；展示不了的 → **系统默认
 * 应用**。做成整行可点还顺手解决了键盘与触屏：Tab 一次就到，不需要先聚焦到
 * 一枚 10px 高的小按钮上。
 *
 * 2026-10-19 起**行尾那枚「在侧栏打开」钮删掉**：行主体与它做的是同一件事，
 * 多一枚钮只是把同一句话说了两遍，还让一列行里多出一列图标。
 *
 * 2026-10-30 按用户要求**把行尾那枚纯视觉落点图标也去掉**：整行按钮仍然工作，
 * 落点由 aria-label 说明（「在右侧栏查看」/「用默认应用打开」），行尾只留具体时间。
 *
 * `pending` 是**核对尚未出结论**：这一行刚上屏、还没问过磁盘。此时只要一点点
 * 低对比度（`data-pending`）而不是置灰 —— 绝大多数文件是活的，一瞬间的待定态
 * 不该看起来像出了事。结论是「不存在」的行根本不会走到这里（已被剔除）。
 */
function OutputRow({ item, index, pending = false, onOpen, onContextMenu }: {
  readonly item: OutputItem
  readonly index: number
  readonly pending?: boolean
  /** 整行点击：侧栏能展示的进右栏，其余交给系统默认应用。 */
  readonly onOpen: () => void
  /** 右键：在指针处打开「引用到对话框 / 使用系统默认程序打开」菜单。 */
  readonly onContextMenu: (event: ReactMouseEvent) => void
}): ReactElement {
  /** 这一行的落点（决定 aria-label）。纯扩展名判断，无副作用。 */
  const target = canShowInSidebar(item.path) ? 'sidebar' : 'external'
  const timeText = outputTimeText(item.time)
  return (
    <div
      className="kr-out-row"
      data-kind={item.kind}
      data-output-path={item.path}
      data-origin={item.origin}
      data-pending={pending ? 'true' : undefined}
      title={item.origin === 'subagent' ? item.path + '\n来自子智能体' : item.path}
      onContextMenu={onContextMenu}
      // 某些环境只派发 mousedown（contextmenu 被全局手势吞掉）：右键按下就开菜单兜底。
      onMouseDown={(event) => { if (event.button === 2) onContextMenu(event) }}
      // 错峰入场：只对靠后的若干条错开，卡片整体不拖出一段长尾。
      style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
    >
      <button
        type="button"
        className="kr-out-row__main"
        aria-label={target === 'sidebar'
          ? `在右侧栏查看 ${item.name}`
          : `用默认应用打开 ${item.name}`}
        onClick={onOpen}
        // 行主体也挂一份：某些浏览器把右键事件落在 button 上时，父级容器也能稳定接管。
        onContextMenu={onContextMenu}
        onMouseDown={(event) => { if (event.button === 2) onContextMenu(event) }}
      >
        <span className="kr-out-row__thumb" data-kind={item.kind} aria-hidden>
          <Thumb kind={item.kind} />
        </span>
        <span className="kr-out-row__name">{item.name}</span>
        {item.origin === 'subagent' && <span className="kr-out-row__origin" title="子智能体产出">子代理</span>}
        {timeText !== '' && <span className="kr-out-row__time" title={timeText}>{timeText}</span>}
      </button>
    </div>
  )
}
