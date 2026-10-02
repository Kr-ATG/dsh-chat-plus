/**
 * dsh-mail — 侧边栏导航行入口（sidebar-nav 的 mail 槽位，独立一行）。
 *
 * 与「记忆 / 用量 / 能力」三个入口同一套交互契约（这一层最容易写错，逐条对齐）：
 *  - 点已打开的行 = 收起（sidebar-nav 的自动关闭刻意把导航行排除在「点外面关闭」
 *    之外，那是给 toggle 语义留的位，少了这个分支会出现「四个入口里只有这个
 *    点第二下没反应」）；
 *  - 退场动画那 240ms 里再点是**弹回**而不是收起（此时 requestClose 会被自己的
 *    closingRef 挡下，什么都不做，而动画结束又把面板关掉——用户看到的是按钮失灵）；
 *  - 面板单独包 ErrorBoundary：面板崩了只收面板，导航行留着。
 *
 * 右上角 badge 显示「未读 + 待确认」数：待确认操作是必须被用户看见的状态
 * （拿到令牌但没执行），所以并入同一个角标，打开面板时警示条会顶在最上面。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createMailApi, type MailApi } from './api.js'
import { MailIcon, MailPanel } from './Panel.js'
import { ensureNavStyles, NavButton, NavPortal, navAnchorFrom, usePanelAutoClose, useRail } from '../sidebar-nav.js'
import { ensureModalAnimStyles, useModalClose } from '../triad-modal-animation.js'
import { ensureShellStyles, type PopoverAnchor } from '../popover-shell.js'
import { ensureMailStyles } from './styles.js'
import { ErrorBoundary } from '../../error-boundary.js'

/** 未读 + 待确认的轮询间隔（邮箱接口有额度，30 秒足够）。 */
const BADGE_POLL_MS = 30_000

/** 渲染邮箱导航行与面板（自足组件：内部自建 API，不依赖 slot 注入面）。 */
export function MailNavApp(): JSX.Element | null {
  ensureMailStyles()
  ensureNavStyles()
  ensureModalAnimStyles()
  ensureShellStyles()
  const api = useMemo<MailApi>(createMailApi, [])
  const rail = useRail()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const [badge, setBadge] = useState(0)
  const { closing, requestClose, cancelClose } = useModalClose(open, () => { setOpen(false) })
  usePanelAutoClose('mail', open, requestClose)

  /**
   * 角标计数：收件箱未读 + 待确认操作。
   *
   * 失败一律静默（未授权、服务未起、额度用尽都不该在侧边栏弹错误）。
   * 面板打开时暂停轮询——面板自己每 5 秒刷一次新邮件事件，再叠加一层轮询
   * 只是白白消耗邮箱接口额度。
   */
  const refreshBadge = useCallback(async (): Promise<void> => {
    try {
      const [page, pending] = await Promise.all([
        api.list({ dir: 'inbox', limit: 50 }),
        api.pending(),
      ])
      setBadge(page.messages.filter(item => !item.is_read).length + pending.length)
    } catch {
      /* 未授权 / 网络异常：保持上一次的数字，不弹错 */
    }
  }, [api])

  useEffect(() => {
    if (open) return undefined
    void refreshBadge()
    const timer = window.setInterval(() => { void refreshBadge() }, BADGE_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [open, refreshBadge])

  return (
    <NavPortal name="mail">
      <NavButton
        icon={<MailIcon size={rail ? 18 : 16} />}
        label="邮箱"
        rail={rail}
        expanded={open}
        badge={badge}
        badgeTitle={`${badge} 项待处理（未读邮件 + 待确认操作）`}
        onClick={e => {
          e.stopPropagation()
          const next = navAnchorFrom(e.currentTarget)
          if (closing) {
            cancelClose()
            if (next !== null) setAnchor(next)
            return
          }
          if (open) { requestClose(); return }
          if (next !== null) setAnchor(next)
          setOpen(true)
        }}
      />
      {(open || closing) && (
        <ErrorBoundary label="邮箱面板" fallback={null} onError={requestClose}>
          <MailPanel
            open={open}
            closing={closing}
            onClose={requestClose}
            anchor={anchor}
            api={api}
          />
        </ErrorBoundary>
      )}
    </NavPortal>
  )
}
