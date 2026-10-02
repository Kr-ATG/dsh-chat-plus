/**
 * sidebar-nav — 侧边栏导航区共享挂载器。
 *
 * 在 sidebar 的浏览区容器（`[data-slot="sidebar.workspaces"]`）正上方插
 * 一个 host，host 内按固定顺序（usage / skills / memory / team）
 * 放四个 `data-nav-slot` 槽位容器；各入口（usage / skills /
 * memory 三个 React 组件，以及 team）经 `useNavSlot` 轮询拿到
 * 自己的槽位后 `createPortal` 进去——顺序确定、互不覆盖、跟 React 首次提交不竞态。
 *
 * rail 折叠态由 `useRail` 观察 `data-shell-overlay` 框架容器的
 * `data-sidebar-collapsed` 属性切换，rail 下导航行收缩为图标钮。
 */

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PopoverAnchor } from './popover-shell.js'

/** nav host id（本模块创建）。 */
const HOST_ID = 'dsh-triad-nav-host'
/** slots 渲染器的稳定锚点（SidebarRoot 暴露的 `sidebar.workspaces` slot）。 */
const ANCHOR_SELECTOR = '[data-slot="sidebar.workspaces"]'
/** 侧边栏折叠观察：框架容器选择在所有 sidebar 状态（wide/rail）下都唯一。 */
const FRAME_SELECTOR = 'div:has(> [data-shell-overlay])'

/**
 * nav host 的行布局：每个数组元素是一行，行内数组是并排的槽位。
 *
 *   [usage][skills][memory] 合并一行 → mail 独立一行 → team 独立一行
 *
 * 历史：自动化入口从本插件删除后（官方 schedule bundle 接管），原本独占一行的
 * 用量并回首行最左，首行由 usage / skills / memory 三人共用；team 仍旧独立一行。
 * 2026-10-02 新增 mail（Agent 邮箱工作台）：它比三个工作台更「常开」——未读与
 * 待确认都要看角标，与三格挤在一行会让每格约 1/4 侧栏宽、文字被压掉，故独立成行。
 * 合并行由本模块自建的 `.dsh-nav-row` 容器承载。
 */
const SLOT_LAYOUT = [
  ['usage', 'skills', 'memory'],
  ['mail'],
  ['team'],
] as const

/** 槽位名。 */
export type NavSlotName = (typeof SLOT_LAYOUT)[number][number]

/** 建一个槽位容器（portal 目标）。 */
function makeSlot(name: string): HTMLDivElement {
  const slot = document.createElement('div')
  slot.dataset.navSlot = name
  return slot
}

let started = false
let pollTimer = 0
let hostObserver: MutationObserver | undefined

/** 确保 host 已创建并插到 `sidebar.workspaces` slot 之前（幂等）。 */
function ensureHostPlaced(): boolean {
  const anchor = document.querySelector(ANCHOR_SELECTOR)
  if (anchor === null) return false
  const parent = anchor.parentElement
  if (parent === null) return false
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null
  if (host === null) {
    host = document.createElement('div')
    host.id = HOST_ID
    host.dataset.plugin = 'dsh-triad'
    for (const row of SLOT_LAYOUT) {
      if (row.length === 1) {
        host.appendChild(makeSlot(row[0]))
        continue
      }
      // 合并行：槽位 display:contents，按钮直接参与行内横向布局。
      const rowEl = document.createElement('div')
      rowEl.className = 'dsh-nav-row'
      for (const name of row) rowEl.appendChild(makeSlot(name))
      host.appendChild(rowEl)
    }
  }
  // 就位判定：host 与锚点同父、且在锚点之前。
  const inPlace = host.parentElement === parent
    && (anchor.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
  if (!inPlace) {
    parent.insertBefore(host, anchor)
  }
  return true
}

/**
 * 盯住宿主的直接父节点，宿主一被摘掉立刻补位。
 *
 * host 是我们手工 `insertBefore` 进 DSH 自有 React 树的裸节点——React 不认识
 * 它，侧边栏任何一次 children 重排都可能把它回收掉。只靠 1.5s 轮询会留下
 * 最长 1.5s 的空窗（视觉上就是入口闪一下再回来）。这里只观察父节点的
 * childList（不开 subtree）：侧边栏自身的 DOM 变动频率很低，而弹层面板已经
 * portal 到 body，不会在这里产生噪音。
 *
 * 收敛性：补位后 host 已就位，`ensureHostPlaced` 不再改动 DOM，不会自激。
 * 父节点整体被替换时观察会失联，由轮询兜底重挂。
 */
function watchHostParent(): void {
  const parent = document.getElementById(HOST_ID)?.parentElement
  if (parent === undefined) return
  hostObserver?.disconnect()
  hostObserver = new MutationObserver(() => {
    const before = document.getElementById(HOST_ID)?.parentElement
    ensureHostPlaced()
    if (document.getElementById(HOST_ID)?.parentElement !== before) watchHostParent()
  })
  hostObserver.observe(parent, { childList: true })
}

/**
 * 挂载导航区 host（幂等单例）。首次调用者持有清理权（停轮询、移除 host），
 * 后续调用返回 no-op。
 */
export function ensureNavMount(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (started) return () => {}
  started = true
  ensureHostPlaced()
  watchHostParent()
  // 低频轮询兜底：侧边栏容器整体被替换（观察失联）时重挂（HMR、React 重建等）。
  pollTimer = window.setInterval(() => {
    ensureHostPlaced()
    if (hostObserver === undefined) watchHostParent()
  }, 1500)
  return () => {
    window.clearInterval(pollTimer)
    pollTimer = 0
    hostObserver?.disconnect()
    hostObserver = undefined
    started = false
    document.getElementById(HOST_ID)?.remove()
  }
}

/** 轮询获取指定槽位容器（未就位时返回 null，组件据此暂不渲染）。
 *
 * 槽位可能直接挂在 nav host 下（独立行的 team）或嵌在 `.dsh-nav-row`
 * 合并行容器里（usage / skills / memory），因此全局按 data-nav-slot 查找——
 * 槽位名由本模块统一创建，唯一。
 *
 * **永不停止**：未就位时 100ms 阶梯快查（10 次后退 400ms）；找到后退化为
 * 800ms 慢速校验——同一节点 setSlot 被 React 直接跳过，零渲染开销。这样
 * 槽位一旦被移除/替换（HMR、React 重建 host、竞态清空等），portal 会自动
 * 迁到新槽；否则会攥着游离的旧槽引用把入口「弄丢」且不再恢复。
 */
export function useNavSlot(name: NavSlotName): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let timer = 0
    let tries = 0
    const poll = (): void => {
      const found = document.querySelector<HTMLElement>(`[data-nav-slot='${name}']`)
      if (found !== null) tries = 0
      else tries += 1
      setSlot(found)
      timer = window.setTimeout(poll, found !== null ? 800 : tries <= 10 ? 100 : 400)
    }
    poll()
    return () => { window.clearTimeout(timer) }
  }, [name])
  return slot
}

/** 侧边栏折叠态（rail = 只显示图标）。
 *
 * 观察挂在 body 子树上（attributeFilter 限定 data-sidebar-collapsed）：
 * 框架容器可能在折叠时被 React 重挂，盯单节点会失联；body 级观察 + 低频
 * 兜底重读对「框架迟到 / 节点替换 / 属性时序」都免疫。值不变时 React 自动
 * 跳过渲染，轮询无额外开销。
 */
export function useRail(): boolean {
  const [rail, setRail] = useState(() =>
    document.querySelector(FRAME_SELECTOR)?.hasAttribute('data-sidebar-collapsed') ?? false)
  useEffect(() => {
    const read = (): void => {
      setRail(document.querySelector(FRAME_SELECTOR)?.hasAttribute('data-sidebar-collapsed') ?? false)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-sidebar-collapsed'], subtree: true })
    const timer = window.setInterval(read, 1500)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [])
  return rail
}

const STYLE_ID = 'dsh-triad-nav-styles'

const SHEET = `
/* 导航行：与自动化菜单行同款几何（透明底 + hover 高亮 + 文字省略） */
.dsh-nav-btn{position:relative;display:flex;align-items:center;gap:8px;width:calc(100% - 4px);height:34px;padding:0 10px;margin:0 2px 4px;box-sizing:border-box;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:14px;line-height:20px;font-family:inherit;cursor:pointer;text-align:left;user-select:none;overflow:hidden;transition:background 120ms ease}
.dsh-nav-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-nav-btn[data-open='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-nav-btn>svg{flex:none;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-nav-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 行尾附加内容（今日用量等）：等宽数字右贴 */
.dsh-nav-trailing{flex:none;margin-left:auto;font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);font-family:ui-monospace,SFMono-Regular,monospace}
/* 折叠 rail 态：只留图标 */
.dsh-nav-btn[data-rail='true']{width:36px;height:36px;padding:0;margin:0 0 8px;justify-content:center;border-radius:8px}
/* 未读 badge（记忆入口）：右上角小圆标 */
.dsh-nav-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;box-sizing:border-box;padding:0 4px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--dsw-alias-state-warn-primary,#e8a33d);color:#0e1116;font-size:10px;font-weight:700;line-height:16px}
/* nav host：各行纵向堆叠；独立行的槽位 display:contents，按钮直接撑满整行。 */
/* 宽度对齐官方相邻行：侧栏导航区（官方 panelRow/会话行）右边界在 268，
   而本 host 的父容器带 margin-right:-12px，width:100% 会一路顶到 280 —— 右边缘比
   官方行多探出 12px，「记忆」等按钮几乎贴住侧栏边缘。扣掉这 12px 即与官方对齐。 */
#dsh-triad-nav-host{display:flex;flex-direction:column;align-items:stretch;width:calc(100% - 12px)}
#dsh-triad-nav-host>[data-nav-slot]{display:contents}
/* 合并行：[用量][技能][记忆] 并排；槽位 display:contents 让按钮直接参与行布局，
   按钮等分整行（flex:1 1 0），与独立行的视觉节奏一致——
   否则收缩为内容宽时行尾会留出大片空白。 */
.dsh-nav-row{display:flex;flex-wrap:wrap;align-items:stretch;gap:2px;padding:0 2px}
.dsh-nav-row>[data-nav-slot]{display:contents;min-width:0}
.dsh-nav-row .dsh-nav-btn{width:auto;flex:1 1 0;min-width:0;margin:0 0 4px;justify-content:center;text-align:center;padding:0 8px}
.dsh-nav-row .dsh-nav-btn .dsh-nav-label{min-width:0}
/* 三等分后每格约 1/3 侧栏宽，放不下「文字 + 行尾数字」，且行尾的
   margin-left:auto 会顶掉居中。合并行统一不显示行尾附加内容
   （今日总量等）——完整数据点开工作台卡片即可。 */
.dsh-nav-row .dsh-nav-trailing{display:none}
/* 折叠 rail 态：合并行恢复纵向图标列（与原生 rail 图标钮节奏一致） */
#dsh-triad-nav-host:has(.dsh-nav-btn[data-rail]) .dsh-nav-row{flex-direction:column;align-items:flex-start;gap:0}
#dsh-triad-nav-host:has(.dsh-nav-btn[data-rail]) .dsh-nav-row .dsh-nav-btn{width:36px;flex:none;margin:0 0 8px}
`

/** 注入导航行样式（幂等）。 */
export function ensureNavStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** NavButton 属性。 */
export interface NavButtonProps {
  /** 行图标（svg 元素，颜色由样式表统一着色）。 */
  icon: ReactNode
  /** 行文字（rail 态不渲染）。 */
  label: string
  /** 折叠态（只留图标）。 */
  rail?: boolean
  /** 面板展开态（高亮底色）。 */
  expanded?: boolean
  /** 未读角标数（0/undefined 不显示；>99 显示 99+）。 */
  badge?: number
  /** 角标悬停提示。 */
  badgeTitle?: string
  /** 无障碍名（缺省用 label）。 */
  ariaLabel?: string
  /** 行尾附加内容（如今日用量数字；rail 态不渲染）。 */
  trailing?: ReactNode
  /** 悬停：滑出卡片（hover 模式）。 */
  onMouseEnter?: (e: MouseEvent<HTMLButtonElement>) => void
  /** 移出按钮：启动自动收回计时（hover 模式）。 */
  onMouseLeave?: () => void
  /** 点击（hover 模式 = 切换钉住）。 */
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
}

/** 渲染一条导航行按钮（与 auto-nav 同款观感）。 */
export function NavButton({
  icon, label, rail = false, expanded = false, badge = 0, badgeTitle, ariaLabel, trailing,
  onMouseEnter, onMouseLeave, onClick,
}: NavButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="dsh-nav-btn"
      data-rail={rail || undefined}
      data-open={expanded || undefined}
      aria-label={ariaLabel ?? label}
      aria-expanded={expanded}
      title={rail ? (ariaLabel ?? label) : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {icon}
      {!rail && <span className="dsh-nav-label">{label}</span>}
      {!rail && trailing !== undefined && (
        <span className="dsh-nav-trailing">{trailing}</span>
      )}
      {badge > 0 && (
        <span className="dsh-nav-badge" title={badgeTitle}>{badge > 99 ? '99+' : String(badge)}</span>
      )}
    </button>
  )
}

/** 便捷组合：portal 到指定槽位（slot 未就位时不渲染）。 */
export function NavPortal({ name, children }: { name: NavSlotName; children: ReactNode }): JSX.Element | null {
  const slot = useNavSlot(name)
  if (slot === null) return null
  return createPortal(children, slot)
}

/** 面板互斥 + 切会话自动收：三个入口共用的面板行为 hook。
 *
 *  - 互斥：任一面板打开时广播，其余已打开的面板自动收回（用量/能力/记忆
 *    同时只占住一个主区，不叠罗汉）；
 *  - 切会话自动收：面板盖住会话主区、无遮罩，侧栏保持可点；侧栏会话区内
 *    的点击（会话行/新会话/设置等，自己导航行与面板内部除外）直接收面板，
 *    跟「点会话回到会话」的直觉一致。
 */
export type TriadPanelName = 'usage' | 'skills' | 'memory' | 'mail'

const PANEL_OPEN_EVENT = 'dsh-triad:panel-open'

/** 点击是否落在侧栏列内（按几何判定，不依赖宿主的哈希类名）。
 *
 * 认「又高又窄、贴左」的列容器：整页级祖先（frame/root，宽占满视口）不算，
 * 否则主区点击顺着冒泡链也会误判成侧栏。 */
function clickInSidebar(target: Element): boolean {
  let node: Element | null = target
  while (node !== null && node !== document.body) {
    const rect = node.getBoundingClientRect()
    if (
      rect.height >= window.innerHeight * 0.7
      && rect.left <= 8
      && rect.right <= window.innerWidth * 0.6
    ) return true
    node = node.parentElement
  }
  return false
}

export function usePanelAutoClose(name: TriadPanelName, open: boolean, requestClose: () => void): void {
  // 打开时广播，挤掉别的面板。
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent(PANEL_OPEN_EVENT, { detail: name }))
  }, [open, name])
  // 听别人的广播 + 侧栏会话区点击。
  useEffect(() => {
    if (!open) return undefined
    const onSiblingOpen = (event: Event): void => {
      if ((event as CustomEvent<TriadPanelName>).detail !== name) requestClose()
    }
    const onDocClick = (event: globalThis.MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // 自己导航行、面板本体（含面板内弹到 body 的二级弹窗）不收。
      if (target.closest(`#${HOST_ID}, .psh-card`) !== null) return
      if (clickInSidebar(target)) requestClose()
    }
    window.addEventListener(PANEL_OPEN_EVENT, onSiblingOpen)
    document.addEventListener('click', onDocClick, true)
    return () => {
      window.removeEventListener(PANEL_OPEN_EVENT, onSiblingOpen)
      document.removeEventListener('click', onDocClick, true)
    }
  }, [open, name, requestClose])
}

/** 「导航行右缘」滑出锚点（兼容保留：右侧抽屉不再跟随按钮定位）。
 *
 * 取按钮所在行容器（dsh-triad 的 nav host）的右缘 +8 作水平位；top 取按钮
 * 顶缘 -6。nav host 是统一的行容器，三个入口共用。 */
export function navAnchorFrom(el: Element | null): PopoverAnchor | null {
  if (el === null) return null
  const row = el.closest(`#${HOST_ID}`)
  if (row === null) return null
  const rowRect = row.getBoundingClientRect()
  const btnRect = el.getBoundingClientRect()
  return { left: Math.round(rowRect.right + 8), top: Math.round(btnRect.top - 6) }
}
