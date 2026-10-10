/**
 * dsh-chat-plus — 对话截图入口（client 端，自 dsh-webui 移植）：
 * assistant 消息操作栏的相机按钮。
 *
 * 点击打开截图面板（范围 / 主题 / 宽度可选，预览后再决定保存）。消息文本从
 * ChatSnapshot（useChat 快照）里现取——按钮本身不持有内容，面板改范围时重新
 * 抽取。
 *
 * 性能注意：这个按钮在**每条** assistant 消息上都有一份，绝不能订阅整份
 * 快照（订阅 ChatSnapshot 全量会让每条消息在每个会话事件上重渲染）。这里让
 * selector 只把快照写进 ref 并返回常量 0：订阅照旧、重渲染为零，点击时从
 * ref 读当前快照即可。
 *
 * 按钮无 Tooltip（对齐官方 IconActions 里的其他按钮）。
 *
 * 与 webui 0.1.1 版的差异：
 *  - props 从 `useSession/useSessions/sessionId` 换成 0.1.2 的 `useChat`（会话级
 *    快照 hook）+ `useSessions`（会话列表，取标题）；
 *  - 注册 id 换成 `chat-flow-screenshot`（与 webui 并存时各有各的按钮）。
 */
import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { getKrChatStore } from '../kr-chat/kr-chat-store.ts'
import { KR_CHAT_ENABLED } from '../kr-chat/enabled.ts'
// Type-only: 激活 ui-chat 的 SlotMap 合并（assistant-actions 槽位 props 契约）
// + ui-session 的会话标准 props 合并（useChat 之外还有 sessionId / useSessions）。
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { useModalClose, ensureModalAnimStyles } from '../modal-animation.ts'
import { collectMessages, deriveCurrentDialogueTitle, type ShotMessage, type ShotRange } from './collect.ts'
import { ShotPanel } from './Panel.tsx'
import { cls, ensureStyles } from './styles.ts'

import { setLatestChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'

/** 相机图标（16px 线性精致镂空，与操作栏复制/分支图标同规格）。 */
function CameraIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.75 2.5H6.25L4.85 4.5H3C2.17 4.5 1.5 5.17 1.5 6V12.5C1.5 13.33 2.17 14 3 14H13C13.83 14 14.5 13.33 14.5 12.5V6C14.5 5.17 13.83 4.5 13 4.5H11.15L9.75 2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="9.25" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="6.75" r="0.6" fill="currentColor" />
    </svg>
  )
}

/**
 * assistant 消息的截图按钮（conversation.chat.assistant-actions）。
 * @param props - 槽位标准 props（messageId + useChat / useSessions + sessionId）。
 */
export function AssistantScreenshotAction(
  props: PropsRuntime<'conversation.chat.assistant-actions'>,
): JSX.Element {
  const { messageId, useChat, useSessions, sessionId } = props
  const [open, setOpen] = useState(false)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })

  // 只把快照落进 ref（返回常量 → 不触发重渲染），点击时再读。
  const snapRef = useRef<ChatSnapshot | null>(null)
  useChat((snapshot: ChatSnapshot) => {
    setLatestChatSnapshot(snapshot)
    snapRef.current = snapshot
    return 0
  })
  const collect = useCallback((range: ShotRange): ShotMessage[] => {
    const snapshot = snapRef.current
    return snapshot === null ? [] : collectMessages(snapshot, messageId, range)
  }, [messageId])

  // 会话标题（整段会话截取时的备选标题）。
  const sessionTitle = useSessions(list => {
    const byId = (list as { byId?: Record<string, { displayTitle?: string } | undefined> }).byId ?? {}
    return byId[String(sessionId)]?.displayTitle ?? ''
  })
  // 会话工作目录：截图要把正文里的相对 HTML 路径解析成绝对路径去内嵌。
  const cwd = useSessions(list => {
    const byId = (list as { byId?: Record<string, { cwd?: string } | undefined> }).byId ?? {}
    return byId[String(sessionId)]?.cwd ?? ''
  })

  // 本次对话标题：从本轮问答提取（用户要求卡片标题是本次对话而不是整段会话）。
  const dialogueTitle = snapRef.current ? deriveCurrentDialogueTitle(snapRef.current, messageId) : ''
  const defaultTitle = dialogueTitle || sessionTitle

  // KR 开启时截图按钮只属于「KR对话」视图（KR 期间的既有设计）；
  // KR 关闭后回到「对话」里常驻 —— 这是用户明确要的：截图在普通对话里也要有。
  const krStore = getKrChatStore()
  const krState = useSyncExternalStore(cb => krStore.subscribe(cb), () => krStore.snapshot)
  if (KR_CHAT_ENABLED && krState.activeTab !== 'kr') {
    return null
  }

  return (
    <>
      <button
        type="button"
        className={open ? `${cls.btn} ${cls.btnBusy}` : cls.btn}
        aria-label="截图为图片"
        onClick={() => { setOpen(true) }}
      >
        <CameraIcon />
      </button>
      {open && (
        <ShotPanel
          closing={closing}
          onClose={requestClose}
          collect={collect}
          title={defaultTitle}
          dialogueTitle={dialogueTitle}
          sessionTitle={sessionTitle}
          cwd={cwd}
          messageKey={String(messageId)}
        />
      )}
    </>
  )
}

/**
 * 注册截图按钮（conversation.chat.assistant-actions，order 5）。
 * @param ctx - client 插件上下文。
 */
export function applyMessageScreenshot(ctx: ClientContext): void {
  ensureStyles()
  ensureModalAnimStyles()
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'chat-flow-screenshot',
    order: 5,
  }, AssistantScreenshotAction))
}
