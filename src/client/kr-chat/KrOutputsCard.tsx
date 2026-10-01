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
import { tryOpenInSidebar } from '../open-preview.ts'
import { workspaceCwdOf } from '../client-ctx.ts'
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

  const items = outputs.items
  const code = outputs.code
  const maxVisible = squeezed ? MAX_VISIBLE_SQUEEZED : MAX_VISIBLE
  const visible = showAll ? items : items.slice(0, maxVisible)
  const hiddenCount = items.length - visible.length
  const empty = items.length === 0 && code.length === 0

  /*
   * 内容收敛时把两个展开态收回默认。
   *
   * 会话切换（新建 / 切到别的会话）会把 outputs 换成另一份内容，而 showAll 与
   * codeOpen 还留着上一份的状态：上一会话点开过「展开其余」，新会话一进来就是
   * 展开的，而用户从没在这里点过。用「成品数 + 代码数」做探针，两者同时归零
   * （= 换了一份空内容）或代码清单消失时收回。
   */
  const probe = `${items.length}:${code.length}`
  const lastProbeRef = useRef(probe)
  useEffect(() => {
    const last = lastProbeRef.current
    lastProbeRef.current = probe
    if (last === probe) return
    // 只在「内容换了一份」时收回，条数增长（同一会话继续产出）不打扰用户。
    const [lastItems, lastCode] = last.split(':').map(Number)
    if (items.length < (lastItems ?? 0) || code.length < (lastCode ?? 0)) {
      setShowAll(false)
      setCodeOpen(false)
    }
  }, [probe, items.length, code.length])

  const openPath = useCallback((path: string) => {
    // 静默失败：右栏服务不可用（旧宿主）时什么都不做，绝不弹错误框 ——
    // 这一行本来只是加速通道，不是必经之路（与操作面板那枚入口同一约定）。
    tryOpenInSidebar(path, { sessionId, cwd: workspaceCwdOf(sessionId) })
  }, [sessionId])

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
            <div className="kr-out-empty">本次会话还没有产出文件</div>
          ) : (
            <>
              {visible.length > 0 && (
                <div className="kr-out-list">
                  {visible.map((item, index) => (
                    <OutputRow
                      key={item.path}
                      item={item}
                      index={index}
                      sessionId={sessionId}
                      onOpen={openPath}
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
                          sessionId={sessionId}
                          onOpen={openPath}
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
 */
function OutputRow({ item, index, sessionId, onOpen, nested = false }: {
  readonly item: OutputItem
  readonly index: number
  readonly sessionId: string | null
  readonly onOpen: (path: string) => void
  readonly nested?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      className="kr-out-row"
      data-kind={item.kind}
      data-nested={nested ? 'true' : undefined}
      title={item.path}
      aria-label={`预览 ${item.name}`}
      // 错峰入场：只对靠后的若干条错开，卡片整体不拖出一段长尾。
      style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
      onClick={() => { onOpen(item.path) }}
    >
      <span className="kr-out-row__thumb" data-kind={item.kind} aria-hidden>
        <Thumb kind={item.kind} />
      </span>
      <span className="kr-out-row__name">{item.name}</span>
      <span className="kr-out-row__open" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.4 3.2H3.6A1.4 1.4 0 0 0 2.2 4.6v7.8a1.4 1.4 0 0 0 1.4 1.4h7.8a1.4 1.4 0 0 0 1.4-1.4V9.6" />
          <path d="M9.6 2.2h4.2v4.2" />
          <path d="M13.8 2.2 7.6 8.4" />
        </svg>
      </span>
    </button>
  )
}
