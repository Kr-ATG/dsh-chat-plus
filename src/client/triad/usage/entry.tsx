/**
 * 用量入口：侧边栏导航行 + 点击打开用量卡片。
 *
 * 「用量」是本插件唯一保留自绘导航行的入口——它点开的不是一整页工作台，而是
 * 贴入口弹出的 **648×414 紧凑小卡**（热力图 + token 消耗查询），做成整页视图
 * 反而要在 main 里放一张小卡、周围全是空白。其余三个工作台（记忆 / 能力 /
 * 邮箱）2026-10-04 起改走官方 `main` 页 + `sidebar.panellist` 菜单行，见
 * `../panel-seat.tsx`。
 *
 * 与官方菜单行的互斥：点本行打开卡片前先把 main 切回会话
 * （`ctx.layout.selectPanel(null)`）——否则卡片会浮在别人那一页上面，
 * 用户以为自己还在那个工作台里。
 *
 * 本行原先在行尾常驻「今日总用量」并每 60s 轮询一次。多个入口合并成一行后
 * 每格只有约 1/2 侧栏宽，放不下「文字 + 数字」（且行尾的 margin-left:auto
 * 会顶掉居中），故整块去掉——完整数据点开卡片即可，顺带省掉轮询。
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UsagePanel } from './dashboard/UsagePanel'
import { ensureModalAnimStyles, useModalClose } from '../triad-modal-animation'
import { ErrorBoundary } from '../../error-boundary'
import { NavButton, NavPortal, ensureNavMount, ensureNavStyles, navAnchorFrom, usePanelAutoClose, useRail } from '../sidebar-nav'
import { ensureShellStyles, type PopoverAnchor } from '../popover-shell'
import { closePanelSeat } from '../panel-seat'

/** 从点击事件取锚点：所在导航行右缘 +8、按钮顶缘 -6。 */
function anchorFromEvent(e: React.MouseEvent<HTMLButtonElement>): PopoverAnchor | null {
  return navAnchorFrom(e.currentTarget)
}

function UsagePanelEntry({ ctx }: { ctx: ClientContext }): JSX.Element {
  ensureModalAnimStyles()
  ensureShellStyles()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const { closing, requestClose, cancelClose } = useModalClose(open, () => { setOpen(false) })
  const rail = useRail()
  usePanelAutoClose(open, requestClose)

  // 导航行是这一格唯一的开关，三种落点必须各自成立：
  //   退场中 → 原地弹回（必须清掉待执行的关闭，否则动画结束时仍会把它关掉）
  //   已打开 → 收起
  //   已关闭 → 打开
  const toggle = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    const next = anchorFromEvent(e)
    if (closing) {
      cancelClose()
      if (next !== null) setAnchor(next)
      return
    }
    if (open) {
      requestClose()
      return
    }
    // 打开前先离开任何 main 工作台页：卡片是浮层，压在别人那一页上会让人
    // 误判当前所在视图（官方菜单行的选中态也还亮着）。
    closePanelSeat(ctx)
    if (next !== null) setAnchor(next)
    setOpen(true)
  }

  return (
    <>
      <NavButton
        icon={<IconDataOutlineRegular size={rail ? 18 : 16} />}
        label="用量"
        rail={rail}
        expanded={open}
        onClick={toggle}
      />
      {/* 面板单独包边界：面板内部崩了只收面板，导航行按钮留着（否则 React 18
          会卸载整个 root，侧边栏入口凭空消失且控制台无痕）。 */}
      {open && (
        <ErrorBoundary label="用量面板" fallback={null} onError={requestClose}>
          <UsagePanel closing={closing} onClose={requestClose} anchor={anchor} />
        </ErrorBoundary>
      )}
    </>
  )
}

/** 导航行应用：用量入口 portal 到 nav host 的 usage 槽（独立一行）。 */
function UsageNavApp({ ctx }: { ctx: ClientContext }): JSX.Element | null {
  ensureNavStyles()
  return (
    <NavPortal name="usage">
      <UsagePanelEntry ctx={ctx} />
    </NavPortal>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    ensureNavMount()
    // React 根挂在游离容器上（React 18 支持容器后入树）；实际 UI 经 portal
    // 落到 sidebar-nav 的槽位 div。
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(<UsageNavApp ctx={ctx} />)
    return () => { root.unmount() }
  }, 'triad: usage nav entry')
}
