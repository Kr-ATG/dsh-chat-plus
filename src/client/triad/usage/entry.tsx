/**
 * 用量卡片 + 技能面板入口：侧边栏导航行。
 *
 * 「用量」「能力」两个入口合并成一行；用量点开的是贴入口弹出的小卡片
 * （热力图 + token 消耗查询），技能点开覆盖会话主区（跟点会话一样占住主区，
 * 移动端回退底部 sheet）。
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UsagePanel } from './dashboard/UsagePanel'
import { SkillsPanel } from './dashboard/SkillsPanel'
import { ensureModalAnimStyles, useModalClose } from '../triad-modal-animation'
import { ErrorBoundary } from '../../error-boundary'
import { NavButton, NavPortal, ensureNavMount, ensureNavStyles, navAnchorFrom, usePanelAutoClose, useRail } from '../sidebar-nav'
import { ensureShellStyles, type PopoverAnchor } from '../popover-shell'

/** 从点击事件取锚点：所在导航行右缘 +8、按钮顶缘 -6（合并行统一滑出位）。 */
function anchorFromEvent(e: React.MouseEvent<HTMLButtonElement>): PopoverAnchor | null {
  return navAnchorFrom(e.currentTarget)
}

/**
 * 用量入口：导航行 + 点击打开用量卡片。
 *
 * 本行原先在行尾常驻「今日总用量」并每 60s 轮询一次。多个入口合并成一行后
 * 每格只有约 1/2 侧栏宽，放不下「文字 + 数字」（且行尾的 margin-left:auto
 * 会顶掉居中），故整块去掉——完整数据点开卡片即可，顺带省掉轮询。
 */
function UsagePanelEntry(): JSX.Element {
  ensureModalAnimStyles()
  ensureShellStyles()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const { closing, requestClose, cancelClose } = useModalClose(open, () => { setOpen(false) })
  const rail = useRail()
  usePanelAutoClose('usage', open, requestClose)

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

/** 技能入口：导航行 + 覆盖会话主区的面板。 */
function SkillsEntry(): JSX.Element {
  ensureModalAnimStyles()
  ensureShellStyles()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const { closing, requestClose, cancelClose } = useModalClose(open, () => { setOpen(false) })
  const rail = useRail()
  usePanelAutoClose('skills', open, requestClose)
  // 同 UsagePanelEntry：退场中再点是弹回，不是收起。
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
    if (next !== null) setAnchor(next)
    setOpen(true)
  }
  return (
    <>
      {/* 能力（闪电，Feather zap 线性风，与自动化/记忆的自绘图标同款描边） */}
      <NavButton
        icon={(
          <svg width={rail ? 18 : 16} height={rail ? 18 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        )}
        label="能力"
        rail={rail}
        expanded={open}
        onClick={toggle}
      />
      {open && (
        <ErrorBoundary label="技能面板" fallback={null} onError={requestClose}>
          <SkillsPanel closing={closing} onClose={requestClose} anchor={anchor} />
        </ErrorBoundary>
      )}
    </>
  )
}

/** 导航行应用：用量入口 portal 到 nav host 的 usage 槽（独立行）；
 * 技能入口 portal 到 skills 槽——与自动化、记忆合成首行。 */
function UsageSkillsNavApp(): JSX.Element | null {
  ensureNavStyles()
  return (
    <>
      <NavPortal name="usage">
        <UsagePanelEntry />
      </NavPortal>
      <NavPortal name="skills">
        <SkillsEntry />
      </NavPortal>
    </>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    ensureNavMount()
    // React 根挂在游离容器上（React 18 支持容器后入树）；实际 UI 经 portal
    // 落到 sidebar-nav 的槽位 div。
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(<UsageSkillsNavApp />)
    return () => { root.unmount() }
  }, 'triad: usage/skills nav entries')
}