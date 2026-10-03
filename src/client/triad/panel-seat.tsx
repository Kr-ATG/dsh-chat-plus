/**
 * panel-seat — 工作台页面按**官方「自动化任务」同款方式**挂载。
 *
 * 官方的任务页是三件事的组合（见 `@deepseek-ai/dsh-client-ui-schedule` 的
 * `apply()`），本模块把它抽成可复用的注册器：
 *
 *   1. `main`（keyed / root）——页面本体，渲染在 `[data-slot="main"]` 里
 *      （frame 的 centerCol 内，与对话平级），不是 body 下的浮层；
 *   2. `sidebar.panellist`（list / root）——侧边栏「全局面板」区的菜单行，
 *      行本体、图标槽、hover / 选中态、rail 折叠态全由官方 SidebarRoot 渲染；
 *      点击由官方调 `ctx.layout.selectPanel(id)`，选中态经 `usePanelInfo` 回传；
 *   3. 关闭 = `ctx.layout.selectPanel(null)`（切回会话），与点侧边栏会话行等价。
 *
 * 一个座位注册两处：`main` 的 key 与 `panellist` 的 id 必须同名
 * （SidebarRoot 按 id 调 selectPanel，layout 按 key 找 main 条目）。
 *
 * **生命周期由官方管**：`main` 是 keyed 槽位，AppFrame 每帧只把 `entryKey`
 * 等于当前 activePanelId 的那一条渲染出来（`renderSlot("main", {}, { entryKey
 * })`），所以取消选中会自动卸载本页——插件侧不需要 open / closing 状态机，
 * 也就不存在「退场动画播到一半用户切了会话」那类竞态。
 *
 * 为什么不做 portal：portal 到 body 就还是浮层（fixed 定位、要自己算侧栏
 * 宽度、要自己画遮罩、Tab 顺序排在整个应用之后）。留在 main 槽位里则天然
 * 拿到 centerCol 的 flex 布局、`--dsh-frame-top-clearance` 与右栏让位。
 */

import type { ComponentType, ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only：拉入 ui-layout（main 的 SlotMap 声明与 `ctx.layout` 服务）、
// ui-sidebar（sidebar.panellist 菜单行的 SlotMap 声明）、ui-slots / ui-renderer
// 的类型合并。运行时不 import 任何官方包（由 client 模块表提供实例）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ensureShellStyles } from './popover-shell.js'
import { ErrorBoundary } from '../error-boundary.js'

/** 面板页面的座位描述。 */
export interface PanelSeat {
  /** main 的 key 与 panellist 的 id（必须同名）。 */
  id: string
  /** 侧边栏菜单行文案（官方 `resolveSlotLabel` 支持 thunk，跟随语言切换）。 */
  label: () => string
  /** 菜单行图标（官方按 `size` 渲染：宽栏 16 / 折叠 rail 18）。 */
  icon: ComponentType<{ size: number }>
  /** 行顺序（官方插件页 0、自动化任务页 10；本插件排在自动化之后）。 */
  order: number
  /** 页面本体（已由 PopoverShell 的 page 形态包好，铺满 main）。 */
  render: (close: () => void) => ReactNode
}

/** 官方 layout 服务的最小可读面（避免为它 import 具体类型）。 */
interface LayoutLike {
  selectPanel?: (id: string | null) => void
}

/** 读 layout 服务（读不到返回 undefined，调用方各自降级）。 */
function layoutOf(ctx: ClientContext): LayoutLike | undefined {
  try {
    return (ctx as unknown as { get?: (name: string) => unknown }).get?.('layout') as LayoutLike | undefined
  } catch {
    return undefined
  }
}

/** 把某个面板切回会话（点会话行、关页、Esc 都走这一条）。 */
export function closePanelSeat(ctx: ClientContext): void {
  try {
    layoutOf(ctx)?.selectPanel?.(null)
  } catch (error) {
    console.warn('[dsh-chat-plus] 切回会话失败：', error)
  }
}

/**
 * 注册一个工作台页面的两处座位（main + sidebar.panellist）。
 *
 * 两处各自独立注册、各自独立回收：菜单行注册失败不影响页面本体，页面本体
 * 注册失败也不留一个点了没反应的行。页面本体外再包一层错误边界——页面崩了
 * 只让 main 显示空位，侧边栏菜单行还在，点会话即可离开。
 * @param ctx - client root context。
 * @param seat - 座位描述。
 * @returns 撤销两处注册的清理函数（交给 `ctx.effect` 随插件卸载回收）。
 */
export function registerPanelSeat(ctx: ClientContext, seat: PanelSeat): () => void {
  ensureShellStyles()
  const close = (): void => { closePanelSeat(ctx) }

  const Page = (): JSX.Element => (
    <ErrorBoundary label={`${seat.label()}页`} fallback={null}>
      {seat.render(close)}
    </ErrorBoundary>
  )

  /** 菜单行图标：官方按 size 渲染（宽栏 16 / 折叠 rail 18）。 */
  const RowIcon = ({ size }: { size: number }): JSX.Element => {
    const Icon = seat.icon
    return <Icon size={size} />
  }

  const disposePage = ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: seat.id },
    Page,
  ))

  const disposeRow = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: seat.id, order: seat.order, label: seat.label },
    RowIcon,
  ))

  return () => {
    try { disposeRow() } catch { /* 已回收：忽略 */ }
    try { disposePage() } catch { /* 已回收：忽略 */ }
  }
}
