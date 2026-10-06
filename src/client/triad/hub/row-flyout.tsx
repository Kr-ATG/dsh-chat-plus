/**
 * row-flyout — 侧栏「工作台」行的二级导航：hover 浮层 + 滚轮直切。
 *
 * 为什么把分类导航从页面顶部搬到侧栏行上（2026-10 用户要求）：
 * 六个页面原先共用一条顶部 tab 栏，每进一页先看到一排切换器，页面本体
 * 反而像「某个 tab 的内容」而不是一个独立板块。现在侧栏那一行「工作台」
 * 承担全部导航语义：
 *
 *  - hover 行 → 右侧滑出小卡列出六个分类（图标 + 名字 + 一句说明），点谁进谁；
 *  - 停留在行上滚轮 → 不弹浮层，直接把当前分类滚到下一个/上一个（页面原地换）；
 *  - 单击行 → 进工作台，落在「上次看过的分类」（localStorage 回填）。
 *
 * 页面顶部因此不再需要 tab 栏，只留一行面包屑（工作台 / 当前分类）说明身在何处。
 *
 * 实现取舍：
 *  - **不碰官方行 DOM**：官方 SidebarRoot 渲染 button.panelRow，我们在 document
 *    上挂捕获期委托监听（mouseenter 不冒泡，必须捕获），按「行内含
 *    [data-workbench-row] 标记」识别本行。标记由本插件的 panellist 图标组件
 *    渲染（官方只把它当图标槽，span 里放什么都行）。
 *  - 浮层 portal 到 body、fixed 定位贴行右缘；鼠标在「行 ↔ 浮层」之间移动有
 *    140ms 宽限期，斜着划过去不会闪断。
 *  - 滚轮只在指针真的停在本行上时接管（且 preventDefault 吃掉页面滚动）；
 *    300ms 节流，一格滚轮 = 一个分类，不连跳。
 *  - 分类切换经 window 自定义事件 dsh-workbench-tab 广播：页面已打开时
 *    WorkbenchPanel 监听它原地换页；页面没打开时只写 localStorage，
 *    下次点行进工作台就是滚轮停下的那一页。
 */

import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WorkbenchTab } from './WorkbenchPanel.js'
import { DSH_WHALE_PATH, DSH_WHALE_VIEWBOX } from '../brand/whale-path.js'

/** 侧栏行内的标记属性（图标组件渲染，委托监听据此认行）。 */
export const WORKBENCH_ROW_MARK = 'data-workbench-row'

/** 分类切换广播事件名（页面与侧栏行之间的唯一通道）。 */
export const WORKBENCH_TAB_EVENT = 'dsh-workbench-tab'

/** localStorage 键：与 WorkbenchPanel 的回填键同一把，两边读写同一份真相。 */
export const WORKBENCH_TAB_STORE = 'dsh-workbench-active-tab'

/** 分类元数据：浮层列表与面包屑共用（顺序 = 滚轮切换顺序）。 */
export interface WorkbenchTabMeta {
  id: WorkbenchTab
  label: string
  desc: string
}

export const WORKBENCH_TABS: readonly WorkbenchTabMeta[] = [
  { id: 'soul', label: '灵魂', desc: '身份契约 · 卡片与预设' },
  { id: 'memory', label: '记忆', desc: '条目 · 变更 · 修订' },
  { id: 'skills', label: '能力', desc: '技能包与 MCP 服务' },
  { id: 'usage', label: '用量', desc: 'Token 消耗与活动热力' },
  { id: 'gallery', label: '画廊', desc: '图片 · 网页 · 文档产出' },
  { id: 'mail', label: '邮件', desc: 'Agent Mail 收件与回信' },
] as const

/** 读当前分类（localStorage 回填，非法值回落灵魂页）。 */
export function readWorkbenchTab(): WorkbenchTab {
  try {
    const saved = localStorage.getItem(WORKBENCH_TAB_STORE) as WorkbenchTab | null
    if (saved !== null && WORKBENCH_TABS.some((t) => t.id === saved)) return saved
  } catch { /* 隐私模式等读取失败：回落默认 */ }
  return 'soul'
}

/** 写当前分类并广播（页面在听就原地换页）。 */
export function writeWorkbenchTab(tab: WorkbenchTab): void {
  try { localStorage.setItem(WORKBENCH_TAB_STORE, tab) } catch { /* 忽略写入失败 */ }
  window.dispatchEvent(new CustomEvent<WorkbenchTab>(WORKBENCH_TAB_EVENT, { detail: tab }))
}

/** 滚轮步进：循环取下一个/上一个分类。 */
function stepTab(current: WorkbenchTab, delta: number): WorkbenchTab {
  const index = WORKBENCH_TABS.findIndex((t) => t.id === current)
  const base = index < 0 ? 0 : index
  const next = (base + delta + WORKBENCH_TABS.length) % WORKBENCH_TABS.length
  return WORKBENCH_TABS[next].id
}

const STYLE_ID = 'dsh-workbench-row-flyout-styles'

/**
 * 浮层样式：中性灰阶，与工作台页内同一套色阶（不引入第二个强调色）。
 * 选中行 = 中性灰底 + 主文字色，与官方侧栏行的 hover/选中语言一致。
 */
const SHEET = `
/* 浮层底色走 static token 的实底（与 popover-shell solid 模式同法）：
   半透明 menu token 依赖 backdrop-filter，而无头/降级环境不保证模糊生效，
   实底在任何环境都不会透出底下页面文字。 */
.wbf-fly{position:fixed;z-index:1100;width:216px;box-sizing:border-box;padding:6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:12px;background:var(--dsw-static-neutral-bluish-00,#fff);box-shadow:var(--dsw-shadow-lv3,0 10px 34px rgba(0,0,0,.34));transform-origin:left center;animation:wbf-in 150ms cubic-bezier(.2,.8,.2,1)}
body[data-ds-dark-theme] .wbf-fly{background:var(--dsw-static-neutral-bluish-850,#2c2c2e)}
@keyframes wbf-in{from{opacity:0;transform:translateX(-6px) scale(.97)}to{opacity:1;transform:none}}
.wbf-title{padding:4px 8px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);user-select:none}
.wbf-item{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:7px 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-family:inherit;font-size:13px;line-height:19px;text-align:left;cursor:pointer;transition:background 130ms ease,color 130ms ease}
.wbf-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#eee)}
.wbf-item:active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.wbf-item[data-active]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#eee);font-weight:600}
.wbf-item svg{flex:none;color:inherit;opacity:.85}
.wbf-item-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.wbf-item-desc{font-size:11px;line-height:15px;font-weight:400;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbf-item[data-active] .wbf-item-desc{color:var(--dsw-alias-label-secondary,#aaa)}
.wbf-hint{margin-top:4px;padding:5px 8px 3px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#777);user-select:none}
@media (prefers-reduced-motion:reduce){.wbf-fly{animation:none}}
`

function ensureFlyStyles(): void {
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

/** 分类图标：与页面面包屑、浮层列表共用同一组线性图标（13px）。 */
export function WorkbenchTabIcon({ tab, size = 14 }: { tab: WorkbenchTab; size?: number }): JSX.Element {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (tab) {
    case 'soul':
      // 官方鲸鱼剪影（与品牌徽标同一 path；viewBox 必须用官方盒子，否则拉伸变形）
      return (
        <svg width={size} height={Math.round(size * 0.74)} viewBox={DSH_WHALE_VIEWBOX} fill="currentColor" aria-hidden="true">
          <path d={DSH_WHALE_PATH} />
        </svg>
      )
    case 'memory':
      return (<svg {...common}><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></svg>)
    case 'skills':
      return (<svg {...common}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>)
    case 'usage':
      return (<svg {...common}><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /></svg>)
    case 'gallery':
      return (<svg {...common}><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>)
    case 'mail':
      return (<svg {...common}><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>)
  }
}

interface FlyoutState {
  top: number
  left: number
}

/**
 * 侧栏行行为挂载：hover 浮层 + 滚轮切分类。
 *
 * 全局只挂一次（模块级单例 ref 计数），返回清理函数交给 ctx.effect。
 * 委托监听挂在 document 上：官方侧栏任何一次重渲染都不会丢监听。
 */
export function attachWorkbenchRowFlyout(): () => void {
  if (typeof document === 'undefined') return () => {}
  ensureFlyStyles()

  /** 浮层宿主（游离 div，React root 后入树）。 */
  const holder = document.createElement('div')
  holder.dataset.workbenchFlyoutHost = 'true'
  document.body.appendChild(holder)

  let flyRoot: Root | null = null
  let flyState: FlyoutState | null = null
  let hoverRow: HTMLElement | null = null
  let hoverFly = false
  let closeTimer = 0
  let lastWheelAt = 0

  /** 浮层渲染进 holder 本体（fixed 定位）：holder 已在 body 上，无需再 portal。 */
  const renderFly = (): void => {
    if (flyState === null) return
    const current = readWorkbenchTab()
    if (flyRoot === null) flyRoot = createRoot(holder)
    flyRoot.render(
      <Flyout
        top={flyState.top}
        left={flyState.left}
        current={current}
        onEnter={() => { hoverFly = true; cancelClose() }}
        onLeave={() => { hoverFly = false; scheduleClose() }}
      />,
    )
  }

  const openFly = (row: HTMLElement): void => {
    const rect = row.getBoundingClientRect()
    flyState = { top: Math.max(8, rect.top - 6), left: rect.right + 8 }
    renderFly()
  }

  const closeFly = (): void => {
    flyState = null
    if (flyRoot !== null) flyRoot.render(null)
  }

  const cancelClose = (): void => {
    if (closeTimer !== 0) { window.clearTimeout(closeTimer); closeTimer = 0 }
  }

  const scheduleClose = (): void => {
    cancelClose()
    closeTimer = window.setTimeout(() => {
      closeTimer = 0
      if (hoverFly === false && hoverRow === null) closeFly()
    }, 140)
  }

  /** 认行：事件目标向上找 button，行内含本插件标记才算。 */
  const rowFrom = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null
    const btn = target.closest('button')
    if (btn === null) return null
    return btn.querySelector(`[${WORKBENCH_ROW_MARK}]`) !== null ? btn : null
  }

  const onEnter = (event: MouseEvent): void => {
    const row = rowFrom(event.target)
    if (row === null) return
    hoverRow = row
    cancelClose()
    openFly(row)
  }

  const onLeave = (event: MouseEvent): void => {
    const row = rowFrom(event.target)
    if (row === null || row !== hoverRow) return
    hoverRow = null
    scheduleClose()
  }

  /** 滚轮：停在行上滚动 = 直接切分类（不弹浮层、吃掉页面滚动）。 */
  const onWheel = (event: WheelEvent): void => {
    const row = rowFrom(event.target)
    if (row === null) return
    const now = Date.now()
    if (now - lastWheelAt < 300) { event.preventDefault(); return }
    if (Math.abs(event.deltaY) < 2) return
    lastWheelAt = now
    event.preventDefault()
    // 滚轮时收起浮层：切页反馈在 main 区，浮层留着反而挡视线。
    hoverRow = null
    closeFly()
    writeWorkbenchTab(stepTab(readWorkbenchTab(), event.deltaY > 0 ? 1 : -1))
  }

  /** 浮层本体鼠标进出（经 React 回调回传）。 */
  holder.addEventListener('mouseenter', () => { hoverFly = true; cancelClose() }, true)
  holder.addEventListener('mouseleave', () => { hoverFly = false; scheduleClose() }, true)

  document.addEventListener('mouseenter', onEnter, true)
  document.addEventListener('mouseleave', onLeave, true)
  document.addEventListener('wheel', onWheel, { capture: true, passive: false })

  return () => {
    document.removeEventListener('mouseenter', onEnter, true)
    document.removeEventListener('mouseleave', onLeave, true)
    document.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
    cancelClose()
    if (flyRoot !== null) flyRoot.unmount()
    holder.remove()
  }
}

/** 浮层本体：六个分类行 + 一句滚轮提示。 */
function Flyout({ top, left, current, onEnter, onLeave }: {
  top: number
  left: number
  current: WorkbenchTab
  onEnter: () => void
  onLeave: () => void
}): JSX.Element {
  // 视口夹紧：行贴屏幕下缘时浮层不能伸出视口。
  const [clamp, setClamp] = useState(0)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const h = el.getBoundingClientRect().height
    const overflow = top + h + 8 - window.innerHeight
    setClamp(overflow > 0 ? overflow : 0)
  }, [top])
  return (
    <div
      ref={ref}
      className="wbf-fly"
      style={{ top: top - clamp, left }}
      role="menu"
      aria-label="工作台分类"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="wbf-title">工作台</div>
      {WORKBENCH_TABS.map((meta) => (
        <button
          key={meta.id}
          type="button"
          role="menuitem"
          className="wbf-item"
          data-active={meta.id === current || undefined}
          onClick={() => { writeWorkbenchTab(meta.id) }}
        >
          <WorkbenchTabIcon tab={meta.id} />
          <span className="wbf-item-main">
            <span>{meta.label}</span>
            <span className="wbf-item-desc">{meta.desc}</span>
          </span>
        </button>
      ))}
      <div className="wbf-hint">停在「工作台」行滚轮可直接切换</div>
    </div>
  )
}
