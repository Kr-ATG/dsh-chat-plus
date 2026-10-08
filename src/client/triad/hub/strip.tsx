/**
 * strip.tsx — 侧栏「工作台」分类分段条（2026-10 定稿）。
 *
 * ── 为什么是它 ────────────────────────────────────────────────────────
 * 用户点名：「分类在工作台菜单这里变成一行可滚动显示的，直接把工作台菜单
 * 给替换掉，然后页面里面不需要这样展示分类」；随后按参考图收敛成
 * **深色胶囊条 + 左圆标 + 纯文字分段控件**（无卡片壳、无说明文字、无底部提示）。
 *
 * 于是导航语义收敛成一条：
 *   · 侧栏「工作台」菜单行的位置 → 一条分段控件（品牌圆标 + 六个纯文字分类），
 *     超宽横滚、滚轮横滚、点谁进谁，选中项走反色药丸；
 *   · 页内不再有任何分类切换器（悬浮 Dock / 面包屑 tab / hover 浮层全删）。
 *
 * ── 降级（关键） ──────────────────────────────────────────────────────
 * 官方 panellist 的「工作台」行**照旧注册**（selectPanel 语义、选中态、
 * 快捷键都由官方维护），只是在本条成功挂载后给它打上
 * `data-wb-row-hidden="true"` 把它藏起来。官方 DOM 一旦改版导致本条挂不上，
 * 隐藏属性就不会打，那一行照常可见可点——入口永不丢。
 *
 * ── 插位 ──────────────────────────────────────────────────────────────
 * 插在 `[data-slot="sidebar.workspaces"]` 之前（= 全局面板行之下、会话浏览
 * 区之上），也就是被隐藏那一行原本的位置；若本插件的用量 nav host 也在同父，
 * 则排在它之前，顺序稳定为：面板行 → 分段条 → 用量行 → 会话区。
 *
 * ── 与 row-flyout 的关系 ──────────────────────────────────────────────
 * 分类数据源（WORKBENCH_TABS / readWorkbenchTab / openWorkbench）与事件通道
 * 全部复用 row-flyout，本模块只负责「长什么样、怎么滚」，不新增第二份真相。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WorkbenchTab } from './WorkbenchPanel.js'
import {
  WORKBENCH_PANEL_ID,
  WORKBENCH_ROW_MARK,
  WORKBENCH_TABS,
  WORKBENCH_TAB_EVENT,
  openWorkbench,
  readWorkbenchTab,
} from './row-flyout.js'
import { getService } from '../../client-ctx.js'
import { useRail } from '../sidebar-nav.js'

/** 横滑条宿主 id（本模块创建）。 */
const HOST_ID = 'dsh-workbench-strip-host'
/** 插位锚点：官方会话浏览区（本条的落点紧贴其上方）。 */
const ANCHOR_SELECTOR = '[data-slot="sidebar.workspaces"]'
/** 用量 nav host（同父时本条排在它之前，保证顺序稳定）。 */
const NAV_HOST_ID = 'dsh-triad-nav-host'
/** 官方「工作台」行的隐藏属性（本条挂载成功后才打，挂不上就不打=照常显示）。 */
const ROW_HIDDEN_ATTR = 'data-wb-row-hidden'
/** 滚轮纵滚转横滚的增益：一格标准滚轮（deltaY≈100）≈ 34px，跟手不连跳。 */
const WHEEL_STEP_RATIO = 0.34

const STYLE_ID = 'dsh-workbench-strip-styles'

/**
 * 横滑条样式（2026-10 用户参考图定稿：深色胶囊条 + 左圆标 + 纯文字分段控件）。
 *
 * 色值一律取官方 `--dsw-alias-*`：本条渲染在**侧栏**里，不在 `.wb-root` 作用域
 * 内，拿不到 `--wb2-*` 那套深空短名，用自建色会在官方切主题时露馅。
 * 2026-10 用户二审：「背景色去掉，按钮颜色去掉」——条无底色无描边、分类无
 * 药丸底、hover 也无底色，全靠文字明度与一条 2px 强调线表达状态。
 */
const SHEET = `
/* 隐藏被替换掉的官方「工作台」行（只在本条挂载成功后才由 JS 打属性） */
button[${ROW_HIDDEN_ATTR}='true']{display:none !important}
#${HOST_ID}{display:block;width:calc(100% - 12px);box-sizing:border-box;margin:0 0 8px}
/* 外条：无底色、无描边、无前置图标（用户 2026-10：去掉菜单前面的图标）——
   条里只剩一行文字分类，最简形态。 */
.wbs-bar{display:flex;align-items:center;gap:4px;box-sizing:border-box;width:100%;
  padding:0 2px;background:transparent;border:none}
/* 滚动区：条内横滚，两端按需淡出 */
.wbs-scroll{position:relative;flex:1 1 auto;min-width:0}
.wbs-strip{display:flex;align-items:center;gap:2px;overflow-x:auto;overflow-y:hidden;
  margin:0;padding:0;scrollbar-width:none;overscroll-behavior-x:contain;
  -webkit-overflow-scrolling:touch}
.wbs-strip::-webkit-scrollbar{display:none}
/* 两端渐隐：条已无底色，渐隐色跟**侧栏底色**走，与侧栏融为一体。 */
.wbs-scroll::before,.wbs-scroll::after{content:"";position:absolute;top:0;bottom:0;width:16px;
  pointer-events:none;opacity:0;transition:opacity 200ms cubic-bezier(.32,.72,0,1);z-index:2}
.wbs-scroll::before{left:0;background:linear-gradient(90deg,var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,#0B0D12)),transparent)}
.wbs-scroll::after{right:0;background:linear-gradient(-90deg,var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,#0B0D12)),transparent)}
.wbs-scroll[data-l='1']::before{opacity:1}
.wbs-scroll[data-r='1']::after{opacity:1}
/* 分类项：纯文字，**无底色、无描边、hover 也无底色**（用户点名「按钮颜色去掉」）。
   状态只靠文字明度（未选=三级灰 / 选中与 hover=主文字色）+ 一条 2px 强调线。 */
.wbs-cell{flex:0 0 auto;box-sizing:border-box;position:relative;
  display:inline-flex;align-items:center;justify-content:center;
  padding:5px 9px;border-radius:8px;cursor:pointer;border:none;background:transparent;
  color:var(--dsw-alias-label-tertiary,#8a8f99);font-family:inherit;font-size:12.5px;
  font-weight:500;line-height:18px;white-space:nowrap;
  transition:color 320ms cubic-bezier(.32,.72,0,1),transform 320ms cubic-bezier(.32,.72,0,1)}
.wbs-cell:hover{color:var(--dsw-alias-label-primary,#eee)}
.wbs-cell:active{transform:scale(.95)}
.wbs-cell[data-on]{color:var(--dsw-alias-label-primary,#E9EBF1);font-weight:600}
/* 选中标记：底部 2px 短强调线，取**文字同色**（currentColor）——
   用户要求去掉彩色按钮，这里就不引入品牌蓝，纯靠明度对比成立。 */
.wbs-cell[data-on]::after{content:"";position:absolute;left:9px;right:9px;bottom:1px;height:2px;
  border-radius:2px;background:currentColor}
@media (prefers-reduced-motion:reduce){
  .wbs-cell,.wbs-scroll::before,.wbs-scroll::after{transition:none !important}
}
`

/** 注入横滑条样式（幂等，按内容比对判重）。 */
function ensureStripStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) {
    if (existing.textContent !== SHEET) existing.textContent = SHEET
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-chat-plus'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 官方 layout 的面板选中态最小可读面（HostObservable：getSnapshot + subscribe）。 */
interface PanelInfoLike {
  activePanelId?: string | null
}
interface PanelInfoSourceLike {
  getSnapshot?: () => PanelInfoLike
  subscribe?: (fn: () => void) => () => void
}

/**
 * 订阅官方「当前选中的 main 面板」（ctx.layout.panelInfo）。
 *
 * 横滑条的选中态原先只读 localStorage（上次看过的分类），于是离开工作台后
 * 那一格仍亮着下划线，看起来像「还停在工作台」。这里把官方选中态接进来：
 * 只有 activePanelId === 'workbench' 时才允许亮选中格，其余页面整条回到
 * 未选中态（无下划线、文字统一三级灰）。
 *
 * 读法全程防御：服务不存在 / 快照形状不对一律视为「未打开」，绝不抛。
 */
function useWorkbenchOpen(): boolean {
  const [open, setOpen] = useState<boolean>(() => readPanelOpen())
  useEffect(() => {
    const source = panelInfoSource()
    if (source === null) return undefined
    const sync = (): void => setOpen(readPanelOpen())
    sync()
    if (typeof source.subscribe !== 'function') return undefined
    return source.subscribe(sync)
  }, [])
  return open
}

/** 取 panelInfo 观察源（读不到返回 null）。 */
function panelInfoSource(): PanelInfoSourceLike | null {
  const layout = getService<{ panelInfo?: PanelInfoSourceLike }>('layout')
  const source = layout?.panelInfo
  if (source === undefined || source === null || typeof source.getSnapshot !== 'function') return null
  return source
}

/** 当前是否真的停在工作台页（官方选中态为准）。 */
function readPanelOpen(): boolean {
  try {
    const source = panelInfoSource()
    if (source === null) return false
    return source.getSnapshot?.().activePanelId === WORKBENCH_PANEL_ID
  } catch {
    return false
  }
}

/**
 * 按当前形态同步官方行的显隐（幂等）。
 *
 * 宽栏：本条渲染出六格 → 官方行隐藏；rail：本条让位 → 官方行必须回来。
 * 每次 place() 都调用，因此侧栏折叠/展开、官方 DOM 重建都会自动收敛。
 */
function syncOfficialRow(wide: boolean): void {
  if (typeof document === 'undefined') return
  const marked = document.querySelector(`[${WORKBENCH_ROW_MARK}]`)
  const row = marked?.closest('button') ?? null
  if (row === null) return
  if (wide) row.setAttribute(ROW_HIDDEN_ATTR, 'true')
  else row.removeAttribute(ROW_HIDDEN_ATTR)
}

/** 确保宿主已插到目标位（幂等）。 */
function ensureHostPlaced(): boolean {
  if (typeof document === 'undefined') return false
  const anchor = document.querySelector(ANCHOR_SELECTOR)
  if (anchor === null) return false
  const parent = anchor.parentElement
  if (parent === null) return false

  let host = document.getElementById(HOST_ID) as HTMLDivElement | null
  if (host === null) {
    host = document.createElement('div')
    host.id = HOST_ID
    host.dataset.plugin = 'dsh-chat-plus'
  }
  // 目标位：用量 nav host 之前（若有且同父），否则直接贴锚点之前。
  const navHost = document.getElementById(NAV_HOST_ID)
  const before: Element = navHost !== null && navHost.parentElement === parent ? navHost : anchor
  if (host.parentElement !== parent || host.nextElementSibling !== before) {
    parent.insertBefore(host, before)
  }
  return true
}

/** 分类格 props。 */
interface CellProps {
  id: WorkbenchTab
  label: string
  desc: string
  active: boolean
  onPick: (id: WorkbenchTab) => void
}

/** 单个分类项：纯文字 + 反色药丸选中态（用户 2026-10 定稿的形态）。 */
function Cell({ id, label, desc, active, onPick }: CellProps): JSX.Element {
  return (
    <button
      type="button"
      className="wbs-cell"
      data-on={active ? '1' : undefined}
      aria-current={active ? 'page' : undefined}
      title={desc}
      onClick={() => { onPick(id) }}
    >
      {label}
    </button>
  )
}

/**
 * 横滑条本体。
 *
 * 选中态由 WORKBENCH_TAB_EVENT 驱动：无论从本条点、从 ⌘1–6、还是别处广播，
 * 高亮都跟着走，不存在两份状态。
 *
 * `onWide` 把「本条当前是否真的渲染出内容」回传给挂载器——**只有宽栏才允许
 * 隐藏官方那一行**。rail（56px 折叠）放不下一行格，本条让位、官方图标列照常
 * 可用，入口在任何侧栏形态下都不丢。
 */
function WorkbenchStrip({ onWide }: { onWide: (wide: boolean) => void }): JSX.Element | null {
  const rail = useRail()
  const [active, setActive] = useState<WorkbenchTab>(() => readWorkbenchTab())
  // 官方选中态：只有真停在工作台页时才亮选中格，离开后整条无下划线。
  const open = useWorkbenchOpen()
  const [edge, setEdge] = useState<{ l: boolean; r: boolean }>({ l: false, r: false })
  const stripRef = useRef<HTMLDivElement | null>(null)

  // 渲染形态回传：宽栏=true（可隐藏官方行），rail=false（官方行必须留着）。
  // 用 useLayoutEffect 而非 useEffect：形态必须在**浏览器绘制前**同步给挂载器，
  // 否则首帧会先渲染出「官方行 + 横滑条」两份入口，下一帧才隐藏，视觉上闪一下。
  useLayoutEffect(() => {
    onWide(!rail)
    return () => { onWide(false) }
  }, [rail, onWide])

  // 选中态跟随广播
  useEffect(() => {
    const onTab = (event: Event): void => {
      const next = (event as CustomEvent<WorkbenchTab>).detail
      if (WORKBENCH_TABS.some((t) => t.id === next)) setActive(next)
    }
    window.addEventListener(WORKBENCH_TAB_EVENT, onTab)
    return () => { window.removeEventListener(WORKBENCH_TAB_EVENT, onTab) }
  }, [])

  /** 重算两端渐隐与滚动钮的显隐。 */
  const syncEdge = useCallback((): void => {
    const el = stripRef.current
    if (el === null) return
    const l = el.scrollLeft > 6
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 6
    setEdge((prev) => (prev.l === l && prev.r === r ? prev : { l, r }))
  }, [])

  // 尺寸/内容变化后重算（ResizeObserver 覆盖侧栏折叠、窗口缩放、字体加载）
  useEffect(() => {
    const el = stripRef.current
    if (el === null) return undefined
    syncEdge()
    const observer = new ResizeObserver(syncEdge)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [syncEdge])

  // 选中格滚进视野（横向居中；不改纵向滚动，避免侧栏跳动）
  useEffect(() => {
    if (rail) return
    const el = stripRef.current
    if (el === null) return
    const cell = el.querySelector<HTMLElement>(`[aria-current='page']`)
    if (cell === null) return
    const target = cell.offsetLeft - (el.clientWidth - cell.offsetWidth) / 2
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [active, rail])

  // 滚轮 → 横向滚动（原生监听 + passive:false：React 的 onWheel 在根上是
  // passive，preventDefault 会被忽略，吃掉侧栏纵向滚动就失效了）
  useEffect(() => {
    const el = stripRef.current
    if (el === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const next = el.scrollLeft + event.deltaY * WHEEL_STEP_RATIO
      if ((next <= 0 && el.scrollLeft <= 0) || (next >= max && el.scrollLeft >= max)) return
      event.preventDefault()
      el.scrollLeft = Math.max(0, Math.min(max, next))
      syncEdge()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [syncEdge])

  // rail（56px 折叠态）放不下一整条，本条让位——折叠时官方图标列照常可用
  if (rail) return null

  return (
    <div className="wbs-bar">
      <div className="wbs-scroll" data-l={edge.l ? '1' : '0'} data-r={edge.r ? '1' : '0'}>
        <div
          className="wbs-strip"
          ref={stripRef}
          role="tablist"
          aria-label="工作台分类"
          onScroll={syncEdge}
        >
          {WORKBENCH_TABS.map((tab) => (
            <Cell
              key={tab.id}
              id={tab.id}
              label={tab.label}
              desc={tab.desc}
              active={open && tab.id === active}
              onPick={(id) => { openWorkbench(id) }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 挂载侧栏横滑分类条（幂等单例）。返回清理函数交给 `ctx.effect`。
 *
 * 官方 DOM 是 React 的，本条的裸 host 随时可能被回收：MutationObserver 盯父节点
 * 补位 + 1.5s 低频兜底（与 sidebar-nav 同款策略）。
 */
export function attachWorkbenchStrip(): () => void {
  if (typeof document === 'undefined') return () => {}
  ensureStripStyles()

  const host = (): HTMLDivElement | null => document.getElementById(HOST_ID) as HTMLDivElement | null
  let root: Root | null = null
  let observer: MutationObserver | undefined
  /** 本条当前是否渲染出内容（rail 下为 false）。 */
  let wide = false

  /** 渲染进 host（React root 惰性建一次）。 */
  const render = (): void => {
    const el = host()
    if (el === null) return
    if (root === null) root = createRoot(el)
    root.render(<WorkbenchStrip onWide={onWide} />)
  }

  /** 形态回传：宽栏才允许隐藏官方行；rail 立刻把官方行放回来。 */
  const onWide = (next: boolean): void => {
    if (wide === next) return
    wide = next
    syncOfficialRow(next)
  }

  /** 就位 + 渲染 + 按形态同步官方行。 */
  const place = (): void => {
    if (!ensureHostPlaced()) return
    render()
    syncOfficialRow(wide)
  }

  /** 盯父节点：host 被 React 摘掉立刻补位。 */
  const watchParent = (): void => {
    const el = host()
    const parent = el?.parentElement ?? null
    if (parent === null) return
    observer?.disconnect()
    observer = new MutationObserver(() => {
      const before = host()?.parentElement ?? null
      place()
      if ((host()?.parentElement ?? null) !== before) watchParent()
    })
    observer.observe(parent, { childList: true })
  }

  place()
  watchParent()
  const timer = window.setInterval(() => {
    place()
    if (observer === undefined) watchParent()
  }, 1500)

  return () => {
    window.clearInterval(timer)
    observer?.disconnect()
    observer = undefined
    // 卸载即还原官方行：入口交回官方菜单，绝不留下一个被藏起来的死入口。
    syncOfficialRow(false)
    if (root !== null) root.unmount()
    root = null
    host()?.remove()
  }
}
