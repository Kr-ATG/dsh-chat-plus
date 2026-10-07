/**
 * Dock.tsx — 工作台悬浮胶囊导航（2026-10 全新设计的导航骨架）。
 *
 * ── 为什么是它 ────────────────────────────────────────────────────────
 * 效果图定稿：分类切换从「页面顶部整条 tab 栏」换成漂浮在内容之上的
 * 玻璃胶囊 Dock。六个分类因此各自成为完整板块，页面 chrome 里不再常驻
 * 一排切换器；侧栏行的 hover 浮层 / 滚轮直切语义（row-flyout）原样保留，
 * 两边经 WORKBENCH_TAB_EVENT 广播互通。
 *
 * ── 取舍 ─────────────────────────────────────────────────────────────
 * 1. sticky 而非 fixed：工作台本体在 PopoverShell 的滚动容器里，fixed 会
 *    飘到会话主区上面去；sticky top:0 只在本面板滚动区内吸顶，收起面板
 *    自动消失，不需要额外清理。
 * 2. 滚轮直切用原生监听 + passive:false：React 的 onWheel 在根上是
 *    passive，preventDefault 会被浏览器忽略（吃掉页面滚动就失效了）。
 * 3. 选中态光晕 / hover 微动全在 theme.ts 的 CSS 里，本组件零样式逻辑。
 */

import { useEffect, useRef } from 'react'
import type { WorkbenchTab } from './WorkbenchPanel.js'
import { WORKBENCH_TABS, WorkbenchTabIcon } from './row-flyout.js'

export interface WorkbenchDockProps {
  active: WorkbenchTab
  onSelect: (tab: WorkbenchTab) => void
  onClose: () => void
}

/** 滚轮节流：一格滚轮 = 一个分类，不连跳（与侧栏行同款 300ms）。 */
const WHEEL_THROTTLE_MS = 300

export function WorkbenchDock({ active, onSelect, onClose }: WorkbenchDockProps): JSX.Element {
  const navRef = useRef<HTMLElement | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const nav = navRef.current
    if (nav === null) return undefined
    let last = 0
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const now = Date.now()
      if (now - last < WHEEL_THROTTLE_MS) return
      last = now
      const index = WORKBENCH_TABS.findIndex((t) => t.id === activeRef.current)
      const base = index < 0 ? 0 : index
      const next = (base + (event.deltaY > 0 ? 1 : -1) + WORKBENCH_TABS.length) % WORKBENCH_TABS.length
      onSelect(WORKBENCH_TABS[next].id)
    }
    nav.addEventListener('wheel', onWheel, { passive: false })
    return () => { nav.removeEventListener('wheel', onWheel) }
  }, [onSelect])

  return (
    <div className="wb2-dock-wrap">
      <nav className="wb2-dock" ref={navRef} role="tablist" aria-label="工作台分类导航" data-workbench-nav="true">
        <div className="wb2-dock-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
          </svg>
          <b>工作台</b>
        </div>
        {WORKBENCH_TABS.map((tab) => {
          const isOn = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="wb2-dock-btn"
              data-on={isOn ? '1' : undefined}
              aria-selected={isOn}
              title={tab.desc}
              onClick={() => { onSelect(tab.id) }}
            >
              <WorkbenchTabIcon tab={tab.id} size={14} />
              <span>{tab.label}</span>
            </button>
          )
        })}
        <button type="button" className="wb2-dock-close" title="关闭并切回会话" aria-label="关闭" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </nav>
    </div>
  )
}
