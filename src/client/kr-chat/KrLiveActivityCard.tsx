/**
 * dsh-chat-plus — KR 对话内的极简 Agent 状态卡。
 *
 * 只展示“正在做什么”这一行，不把任务清单、思考全文、工具参数或调用树塞进
 * 左侧消息流 —— 那些右栏「任务概览 / 思考过程 / 工具调用」大盘已经各有其位，
 * 同一件事在对话流里再抄一份只会让人读到两遍。
 *
 * 头像可点击上传并持久化到 localStorage；图片会裁切为 128×128。
 * 卡片文字大小同样在头像菜单里调，落在 --kr-text-scale 上即时生效。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { callName, isRunning } from '../tool-summary/tool-stats.ts'
import { useCrossfadeText, useMotionAllowed } from '../motion-utils.ts'

const EXIT_MS = 980
const AVATAR_STORAGE_KEY = 'dsh.kr_chat.agent_avatar.v1'
const AVATAR_MENU_WIDTH = 188
const AVATAR_MENU_ESTIMATED_HEIGHT = 198
const AVATAR_MENU_GAP = 7
const AVATAR_MENU_VIEWPORT_GAP = 8

/**
 * 卡片文字大小档位：只改壳子上的 --kr-text-scale，卡内所有 font-size / line-height
 * 都按它 calc，阴影与高度预算也跟着缩放，字号与行高不会各走各的。
 */
const FONT_SCALE_KEY = 'dsh.kr_chat.font_scale.v1'
const FONT_SCALES = { sm: 0.92, md: 1, lg: 1.12, xl: 1.26 } as const
type FontScaleId = keyof typeof FONT_SCALES
const FONT_SCALE_OPTIONS: readonly { readonly id: FontScaleId; readonly label: string }[] = [
  { id: 'sm', label: '紧凑' },
  { id: 'md', label: '标准' },
  { id: 'lg', label: '大' },
  { id: 'xl', label: '特大' },
]

function readStoredFontScale(): FontScaleId {
  if (typeof localStorage === 'undefined') return 'md'
  try {
    const value = localStorage.getItem(FONT_SCALE_KEY)
    return value !== null && Object.prototype.hasOwnProperty.call(FONT_SCALES, value)
      ? value as FontScaleId
      : 'md'
  } catch {
    return 'md'
  }
}

interface AvatarMenuPosition {
  readonly left: number
  readonly top: number
}

/**
 * 头像菜单挂到 body 后按触发按钮定位；优先向下，空间不足时改向上。
 * turn-process 官方行有固定高度 + overflow:hidden，菜单留在卡片子树里会被整段裁掉。
 */
function positionAvatarMenu(anchor: DOMRect): AvatarMenuPosition {
  const maxLeft = Math.max(AVATAR_MENU_VIEWPORT_GAP, window.innerWidth - AVATAR_MENU_WIDTH - AVATAR_MENU_VIEWPORT_GAP)
  const left = Math.min(maxLeft, Math.max(AVATAR_MENU_VIEWPORT_GAP, anchor.left))
  const roomBelow = window.innerHeight - anchor.bottom - AVATAR_MENU_GAP - AVATAR_MENU_VIEWPORT_GAP
  const roomAbove = anchor.top - AVATAR_MENU_GAP - AVATAR_MENU_VIEWPORT_GAP
  const placeAbove = roomAbove >= AVATAR_MENU_ESTIMATED_HEIGHT || roomAbove > roomBelow
  const top = placeAbove
    ? Math.max(AVATAR_MENU_VIEWPORT_GAP, anchor.top - AVATAR_MENU_GAP - AVATAR_MENU_ESTIMATED_HEIGHT)
    : Math.max(
        AVATAR_MENU_VIEWPORT_GAP,
        Math.min(anchor.bottom + AVATAR_MENU_GAP, window.innerHeight - AVATAR_MENU_ESTIMATED_HEIGHT - AVATAR_MENU_VIEWPORT_GAP),
      )
  return { left, top }
}

export interface KrActivityReasoningItem {
  readonly text: string
  readonly running: boolean
  readonly step: number
  readonly time?: number | undefined
  readonly order?: number | undefined
}

function readStoredAvatar(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const value = localStorage.getItem(AVATAR_STORAGE_KEY)
    return value !== null && value.startsWith('data:image/') ? value : null
  } catch {
    return null
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => { resolve(image) }
    image.onerror = () => { reject(new Error('avatar decode failed')) }
    image.src = url
  })
}

/** 上传图中心裁切为正方形，避免 localStorage 被原图撑爆。 */
async function cropAvatar(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const side = 128
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('canvas unavailable')
    const crop = Math.min(image.naturalWidth, image.naturalHeight)
    const sourceX = (image.naturalWidth - crop) / 2
    const sourceY = (image.naturalHeight - crop) / 2
    context.drawImage(image, sourceX, sourceY, crop, crop, 0, 0, side, side)
    return canvas.toDataURL('image/webp', .88)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function toolVerb(name: string): string {
  const lower = name.toLowerCase()
  if (/^(read|read_file|view|open_file)$/.test(lower)) return '读取文件'
  if (/^(write|edit|apply_patch|str_replace_editor)$/.test(lower)) return '修改文件'
  if (/^(bash|pwsh|shell|terminal|exec_command|run_code)$/.test(lower)) return '执行命令'
  if (/^(grep|glob|find|search)$/.test(lower)) return '搜索文件'
  if (/^(web_search|web_fetch|web_open)$/.test(lower)) return '检索网页'
  if (lower === 'skill') return '加载技能'
  if (/memory|summar/.test(lower)) return '整理记忆'
  return `调用 ${name || '工具'}`
}

function defaultAvatar() {
  return (
    <span className="kr-agent-mini-avatar__default" aria-hidden>
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M8 9.5 16 5l8 4.5v8.7c0 4.2-2.8 7.3-8 8.8-5.2-1.5-8-4.6-8-8.8V9.5Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="m12 13 4 3 4-3M16 16v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export const KrLiveActivityCard = memo(function KrLiveActivityCard({
  turn,
  reasoning,
  tools,
  active,
  closing,
  committed,
  onExited,
}: {
  readonly turn: number
  readonly reasoning: readonly KrActivityReasoningItem[]
  readonly tools: readonly ChatNode<'tool-call'>[]
  readonly active: boolean
  readonly closing: boolean
  readonly committed: boolean
  readonly onExited?: (() => void) | undefined
}) {
  const motion = useMotionAllowed(true)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null)
  const avatarMenuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onExitedRef = useRef(onExited)
  onExitedRef.current = onExited
  const [present, setPresent] = useState(active)
  const [avatar, setAvatar] = useState<string | null>(readStoredAvatar)
  const [fontScale, setFontScale] = useState<FontScaleId>(readStoredFontScale)
  const [avatarMenu, setAvatarMenu] = useState(false)
  const [avatarMenuPosition, setAvatarMenuPosition] = useState<AvatarMenuPosition | null>(null)
  const [avatarError, setAvatarError] = useState(false)

  const runningTool = useMemo(() => {
    for (let index = tools.length - 1; index >= 0; index -= 1) {
      const node = tools[index]
      try {
        if (isRunning(node.data.root)) return callName(node.data.root) || '工具'
      } catch { /* 未知工具形状跳过 */ }
    }
    return null
  }, [tools])
  const thinking = reasoning.some((item) => item.running)
  const action = closing
    ? 'Agent 正在总结'
    : runningTool !== null
      ? `Agent 正在${toolVerb(runningTool)}`
      : thinking
        ? 'Agent 正在思考'
        : active ? 'Agent 正在分析' : 'Agent 正在整理结果'
  // 动作名换成交叉淡入淡出：旧层保留着淡出，新层同时淡入。
  const actionLayers = useCrossfadeText(action, motion)

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === AVATAR_STORAGE_KEY) setAvatar(readStoredAvatar())
      if (event.key === FONT_SCALE_KEY) setFontScale(readStoredFontScale())
    }
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('storage', onStorage) }
  }, [])

  useEffect(() => {
    if (!avatarMenu) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (rootRef.current?.contains(target) === true) return
      if (avatarMenuRef.current?.contains(target) === true) return
      setAvatarMenu(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAvatarMenu(false)
    }
    const syncPosition = (): void => {
      const button = avatarButtonRef.current
      if (button === null || button.isConnected === false) {
        setAvatarMenu(false)
        return
      }
      setAvatarMenuPosition(positionAvatarMenu(button.getBoundingClientRect()))
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', syncPosition)
    window.addEventListener('scroll', syncPosition, true)
    syncPosition()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', syncPosition)
      window.removeEventListener('scroll', syncPosition, true)
    }
  }, [avatarMenu])

  useEffect(() => {
    if (closing) {
      setAvatarMenu(false)
      setAvatarMenuPosition(null)
    }
  }, [closing])

  useEffect(() => {
    if (!closing) {
      setPresent(active)
      return undefined
    }
    if (!committed) return undefined
    if (!motion) {
      setPresent(false)
      onExitedRef.current?.()
      return undefined
    }
    const id = window.setTimeout(() => {
      setPresent(false)
      onExitedRef.current?.()
    }, EXIT_MS)
    return () => { window.clearTimeout(id) }
  }, [active, closing, committed, motion])

  const chooseAvatar = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    try {
      const value = await cropAvatar(file)
      localStorage.setItem(AVATAR_STORAGE_KEY, value)
      setAvatar(value)
      setAvatarError(false)
      setAvatarMenu(false)
    } catch {
      setAvatarError(true)
    }
  }, [])

  const resetAvatar = useCallback((): void => {
    try { localStorage.removeItem(AVATAR_STORAGE_KEY) } catch { /* storage 不可用时仅改内存 */ }
    setAvatar(null)
    setAvatarError(false)
    setAvatarMenu(false)
  }, [])

  /** 字号档位只落一个枚举 id，读时回放成 --kr-text-scale 供卡内所有 calc 使用。 */
  const chooseFontScale = useCallback((id: FontScaleId): void => {
    setFontScale(id)
    try { localStorage.setItem(FONT_SCALE_KEY, id) } catch { /* storage 不可用时仅改内存 */ }
  }, [])

  if (!present) return null

  return (
    <div
      ref={rootRef}
      className="kr-agent-mini-shell"
      data-turn={turn}
      data-active={active || undefined}
      data-closing={closing || undefined}
      data-committed={committed || undefined}
      style={{ '--kr-text-scale': FONT_SCALES[fontScale] } as CSSProperties}
    >
      <section
        className="kr-agent-mini-card"
        aria-label="Agent 当前状态"
        aria-live={active && !closing ? 'polite' : 'off'}
      >
        <button
          ref={avatarButtonRef}
          type="button"
          className="kr-agent-mini-avatar"
          onClick={(event) => {
            event.stopPropagation()
            if (avatarMenu) {
              setAvatarMenu(false)
              setAvatarMenuPosition(null)
              return
            }
            setAvatarMenuPosition(positionAvatarMenu(event.currentTarget.getBoundingClientRect()))
            setAvatarMenu(true)
            setAvatarError(false)
          }}
          title="设置 Agent 头像"
          aria-label="设置 Agent 头像"
          aria-expanded={avatarMenu}
        >
          {avatar === null ? defaultAvatar() : <img src={avatar} alt="" />}
          <span className="kr-agent-mini-avatar__status" aria-hidden />
        </button>

        <div className="kr-agent-mini-copy" data-running={active && !closing ? 'true' : undefined}>
          {/*
           * 动作名的每一层都占 stack 的同一格（CSS grid 叠放），所以旧层淡出的
           * 过程中新层已经淡进来，中间不会出现空白帧——这就是「平滑」。退场层标
           * aria-hidden，避免读屏把同一句话念两遍。
           */}
          <span className="kr-agent-mini-action-stack">
            {actionLayers.map((layer) => (
              <span
                key={layer.id}
                className="kr-agent-mini-action"
                data-phase={layer.exiting ? 'out' : 'in'}
                aria-hidden={layer.exiting || undefined}
              >
                {layer.text}
              </span>
            ))}
          </span>
          {/*
           * 末尾三点：模型停下来等的那段时间里，动作名不再变化，上面那次显影
           * 也就不会再播——这三点就是"还活着，但暂时没新动作"的持续信号。
           *
           * 必须是三个独立元素（不能靠伪元素凑）：opacity 动画打在同一个元素上
           * 时三颗会一起亮，错峰就没了。延迟在 CSS 里给，这里只管结构。
           */}
          <span className="kr-agent-dots" aria-hidden>
            <i /><i /><i />
          </span>
        </div>

        <input
          ref={inputRef}
          className="kr-agent-avatar-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => { void chooseAvatar(event) }}
          tabIndex={-1}
        />
      </section>

      {avatarMenu && avatarMenuPosition !== null && createPortal(
        <div
          ref={avatarMenuRef}
          className="kr-agent-avatar-menu"
          style={avatarMenuPosition as CSSProperties}
          role="dialog"
          aria-label="Agent 头像设置"
          onClick={(event) => { event.stopPropagation() }}
        >
          <div className="kr-agent-avatar-menu__title">Agent 设置</div>
          <button type="button" className="kr-agent-avatar-menu__action" onClick={() => { inputRef.current?.click() }}>
            上传头像
          </button>
          <button
            type="button"
            className="kr-agent-avatar-menu__action"
            onClick={resetAvatar}
            disabled={avatar === null}
          >
            恢复默认头像
          </button>
          <div className="kr-agent-avatar-menu__hint">自动居中裁切为 128 × 128</div>
          <div className="kr-agent-avatar-menu__sep" />
          <div className="kr-agent-avatar-menu__label">卡片文字大小</div>
          <div className="kr-agent-avatar-menu__scaleRow" role="group" aria-label="卡片文字大小">
            {FONT_SCALE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="kr-agent-avatar-menu__scale"
                aria-pressed={fontScale === option.id}
                onClick={() => { chooseFontScale(option.id) }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {avatarError && <div className="kr-agent-avatar-menu__error">图片无法读取，请换一张</div>}
        </div>,
        document.body,
      )}
    </div>
  )
})

interface KrActivityCardGateProps {
  readonly turn: number
  readonly reasoning: readonly KrActivityReasoningItem[]
  readonly tools: readonly ChatNode<'tool-call'>[]
  readonly active: boolean
  readonly closing: boolean
  readonly committed: boolean
}

/** closed 历史轮次不挂载真实卡片，避免每轮安装全局监听或退场计时器。 */
export const KrActivityCardGate = memo(function KrActivityCardGate({
  turn,
  reasoning,
  tools,
  active,
  closing,
  committed,
}: KrActivityCardGateProps) {
  const wasActiveRef = useRef(active)
  const [mounted, setMounted] = useState(active)

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true
      setMounted(true)
    } else if (closing && wasActiveRef.current) {
      setMounted(true)
    }
  }, [active, closing, turn])

  const handleExited = useCallback(() => {
    wasActiveRef.current = false
    setMounted(false)
  }, [])

  if (!mounted) return null
  return (
    <KrLiveActivityCard
      turn={turn}
      reasoning={reasoning}
      tools={tools}
      active={active}
      closing={closing}
      committed={committed}
      onExited={handleExited}
    />
  )
})
