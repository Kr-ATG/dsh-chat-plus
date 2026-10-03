/**
 * sidebar-nav — 侧边栏导航区共享挂载器（**只服务「用量」一个入口**）。
 *
 * 在 sidebar 的浏览区容器（`[data-slot="sidebar.workspaces"]`）正上方插
 * 一个 host，host 内放 `data-nav-slot` 槽位容器；入口（用量 React 组件）经
 * `useNavSlot` 轮询拿到自己的槽位后 `createPortal` 进去——顺序确定、互不覆盖、
 * 跟 React 首次提交不竞态。
 *
 * 2026-10-04 收缩：记忆 / 能力 / 邮箱三个入口已改为官方 `sidebar.panellist`
 * 菜单行（行本体、图标槽、hover / 选中态、rail 折叠态全由官方 SidebarRoot
 * 渲染，见 `./panel-seat.tsx`），本模块因此只剩用量一格——用量点开的是贴入口
 * 弹出的紧凑小卡而不是整页工作台，官方菜单行只表达「选中一个 main 页面」，
 * 装不下这个语义，故保留自绘行。
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
 *   [usage]  独立一行
 *
 * 历史：2026-10-04 之前这里还有 skills / memory / mail / team 四格（首行
 * usage+skills+memory 并排、mail 与 team 各占一行），全部改走官方菜单行后
 * 只剩用量。team 槽位自始自终没有注册方，是 `SLOT_LAYOUT` 里的空占位，
 * 一并清掉。
 */
const SLOT_LAYOUT = [
  ['usage'],
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
  if (parent === undefined || parent === null) return
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
/* 导航行：与官方自动化菜单行同款几何（透明底 + hover 高亮 + 文字省略）。
   内边距 8px 是**实测对齐官方行**的结果：官方「插件」「自动化任务」行按钮
   x=14、图标 x=22（= padding-left 8px）。取 10px 会让本插件的行整体右移 2px。 */
.dsh-nav-btn{position:relative;display:flex;align-items:center;gap:8px;width:calc(100% - 4px);height:34px;padding:0 8px;margin:0 2px 4px;box-sizing:border-box;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:14px;line-height:20px;font-family:inherit;cursor:pointer;text-align:left;user-select:none;overflow:hidden;transition:background 120ms ease}
.dsh-nav-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-nav-btn[data-open='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-nav-btn>svg{flex:none;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-nav-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 折叠 rail 态：只留图标 */
.dsh-nav-btn[data-rail='true']{width:36px;height:36px;padding:0;margin:0 0 8px;justify-content:center;border-radius:8px}
/* nav host：槽位纵向堆叠；槽位 display:contents，按钮直接撑满整行。 */
/* 宽度对齐官方相邻行：侧栏导航区（官方 panelRow/会话行）右边界在 268，
   而本 host 的父容器带 margin-right:-12px，width:100% 会一路顶到 280 —— 右边缘比
   官方行多探出 12px，按钮几乎贴住侧栏边缘。扣掉这 12px 即与官方对齐。 */
#dsh-triad-nav-host{display:flex;flex-direction:column;align-items:stretch;width:calc(100% - 12px)}
#dsh-triad-nav-host>[data-nav-slot]{display:contents}
`

/** 注入导航行样式（幂等）。 */
export function ensureNavStyles(): void {
  if (typeof document === 'undefined') return
  const tag = document.getElementById(STYLE_ID)
  if (tag !== null) {
    // 内容比对：插件升级后已打开的页面里那份旧 <style> 会一直命中早退分支，
    // JSX 拿到新 class 名却匹配不到新规则（删掉的行样式还会继续生效）。
    if (tag.textContent !== SHEET) tag.textContent = SHEET
    return
  }
  const created = document.createElement('style')
  created.id = STYLE_ID
  created.dataset.plugin = 'dsh-triad'
  created.textContent = SHEET
  document.head.appendChild(created)
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
  /** 无障碍名（缺省用 label）。 */
  ariaLabel?: string
  /** 悬停：滑出卡片（hover 模式）。 */
  onMouseEnter?: (e: MouseEvent<HTMLButtonElement>) => void
  /** 移出按钮：启动自动收回计时（hover 模式）。 */
  onMouseLeave?: () => void
  /** 点击（hover 模式 = 切换钉住）。 */
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
}

/** 渲染一条导航行按钮（与 auto-nav 同款观感）。 */
export function NavButton({
  icon, label, rail = false, expanded = false, ariaLabel,
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
    </button>
  )
}

/** 便捷组合：portal 到指定槽位（slot 未就位时不渲染）。 */
export function NavPortal({ name, children }: { name: NavSlotName; children: ReactNode }): JSX.Element | null {
  const slot = useNavSlot(name)
  if (slot === null) return null
  return createPortal(children, slot)
}

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

/**
 * 面板行为 hook：切会话自动收。
 *
 * 2026-10-04 收缩：原先还带一层「面板互斥」（任一面板打开时广播挤掉其余），
 * 那是四个入口各弹一个 body 级浮层时代的产物——现在只剩用量一张 compact 卡片
 * 是浮层，能力/记忆/邮箱都是官方 main 页（切页天然互斥，由 layout 负责），
 * 互斥广播连同 `TriadPanelName` 联合类型一起删掉。
 *
 * 留下的这条仍然必要：卡片盖住会话主区、无遮罩、侧栏保持可点，用户在侧栏
 * 会话区里的点击（会话行 / 新会话 / 设置等，自己导航行与卡片本体除外）应当
 * 直接收卡片——跟「点会话回到会话」的直觉一致。
 * @param open - 卡片是否打开。
 * @param requestClose - 收卡片（播退场动画）。
 */
export function usePanelAutoClose(open: boolean, requestClose: () => void): void {
  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (event: globalThis.MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // 自己导航行、卡片本体（含卡片内弹到 body 的二级弹窗）不收。
      if (target.closest(`#${HOST_ID}, .psh-card`) !== null) return
      if (clickInSidebar(target)) requestClose()
    }
    document.addEventListener('click', onDocClick, true)
    return () => { document.removeEventListener('click', onDocClick, true) }
  }, [open, requestClose])
}

/** 「导航行右缘」滑出锚点。
 *
 * 取按钮所在行容器（dsh-triad 的 nav host）的右缘 +8 作水平位；top 取按钮
 * 顶缘 -6。nav host 是统一的行容器。 */
export function navAnchorFrom(el: Element | null): PopoverAnchor | null {
  if (el === null) return null
  const row = el.closest(`#${HOST_ID}`)
  if (row === null) return null
  const rowRect = row.getBoundingClientRect()
  const btnRect = el.getBoundingClientRect()
  return { left: Math.round(rowRect.right + 8), top: Math.round(btnRect.top - 6) }
}
