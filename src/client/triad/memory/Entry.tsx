/**
 * dsh-memory 侧边栏导航行入口（「自动化」菜单下方，sidebar-nav memory 槽位）：
 * 图标用「大脑/记忆」线性 SVG（无 emoji），rail 态只留图标；右上角 badge 显示
 * 未读变更数。记忆面板直接覆盖会话主区（跟点会话一样占住主区）；
 * 有未读变更时打开直达「变更」Tab。
 */

import { useMemo, useState } from 'react'
import { createMemoryApi, type MemoryApi } from './api.js'
import { MemoryPanel, BrainIcon, type MemoryTab } from './Panel.tsx'
import { useUnreadChanges, useBadgePref } from './Notify.tsx'
import { makeT } from './locales.js'
import { ensureNavStyles, NavButton, NavPortal, navAnchorFrom, usePanelAutoClose, useRail } from '../sidebar-nav.js'
import { ensureModalAnimStyles, useModalClose } from '../triad-modal-animation.js'
import { ensureShellStyles, type PopoverAnchor } from '../popover-shell.js'
import { ensureStyles } from './styles.js'
import { ErrorBoundary } from '../../error-boundary.js'

/**
 * 渲染记忆导航行与面板（自足组件：内部自建 API 与翻译，不依赖 slot 注入面）。
 */
export function MemoryNavApp(): JSX.Element | null {
  ensureStyles()
  ensureNavStyles()
  ensureModalAnimStyles()
  ensureShellStyles()
  const api = useMemo<MemoryApi>(createMemoryApi, [])
  const t = useMemo(makeT, [])
  const rail = useRail()
  const unread = useUnreadChanges(api)
  // badge 显隐偏好（设置 Tab「界面」分组开关）：关掉时未读计数照常累计，
  // 只是不渲染角标——重新打开偏好后数字立即回来，不丢通知能力。
  const badgeVisible = useBadgePref()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const [initialTab, setInitialTab] = useState<MemoryTab>('all')
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })
  usePanelAutoClose('memory', open, requestClose)

  const openPanel = (tab: MemoryTab): void => {
    setInitialTab(tab)
    setOpen(true)
    if (tab === 'changes') unread.markRead()
  }

  /** 角标关掉时点击直达「全部」而不是「变更」（没有可见未读提示，直达变更反而突兀）。 */
  const badgeCount = badgeVisible ? unread.count : 0

  return (
    <NavPortal name="memory">
      <NavButton
        icon={<BrainIcon size={rail ? 18 : 16} />}
        label={t('entry')}
        rail={rail}
        expanded={open}
        badge={badgeCount}
        badgeTitle={t('unreadChanges', { n: badgeCount })}
        onClick={e => {
          e.stopPropagation()
          // 已打开（哪怕正在退场）时再点同一行 = 收起，与「自动化 / 用量 / 能力」
          // 三个入口一致。少了这个分支：sidebar-nav 的自动关闭刻意把导航行排除
          // 在「点外面关闭」之外（那是为 toggle 语义准备的），于是 openPanel
          // 打在已打开的状态上毫无变化、又不会被自动关闭接手 —— 四个外观完全
          // 相同的并排入口里只有自动化会响应第二次点击。
          //
          // 同时把 markRead 挪进「真的要打开」的分支：否则「面板已经开着还去点
          // 这一行」会在收起的同时静默清掉未读角标。
          if (open || closing) { requestClose(); return }
          setAnchor(navAnchorFrom(e.currentTarget))
          openPanel(unread.count > 0 ? 'changes' : 'home')
        }}
      />
      {/* api 整体展开：面板 props 是 MemoryApi 的超集，逐字段列举会在
          API 面新增方法（deleteBatch / resetConfig 等）时漏传而编译失败。
          外面再包一层错误边界：面板崩了只收面板，导航按钮留着。 */}
      <ErrorBoundary label="记忆面板" fallback={null} onError={requestClose}>
        <MemoryPanel
          {...api}
          open={open}
          closing={closing}
          onClose={requestClose}
          initialTab={initialTab}
          anchor={anchor}
          t={t}
        />
      </ErrorBoundary>
    </NavPortal>
  )
}
