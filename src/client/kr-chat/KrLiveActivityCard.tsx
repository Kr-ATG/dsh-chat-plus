/**
 * dsh-chat-plus — KR 对话内的极简 Agent 状态卡。
 *
 * 只展示“正在做什么”，不把思考全文、工具参数或调用树塞进左侧消息流。
 * 头像可点击上传并持久化到 localStorage；图片会裁切为 128×128。
 * 卡片文字大小同样在头像菜单里调，落在 --kr-text-scale 上即时生效。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { callName, isRunning } from '../tool-summary/tool-stats.ts'
import { useMotionAllowed } from '../motion-utils.ts'
import { KrFreshText } from './KrFreshText.tsx'

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

type WorkflowStatus = 'done' | 'current' | 'pending'

interface WorkflowStage {
  /**
   * 节点身份，**绝不能含 label 文本**。
   *
   * 原先 key 是 `${label}:${index}`，而 reasoning 是流式来的：模型每多吐一段
   * 文本，label 就变一次 → key 变 → 整行被卸载重建 → 淡入 + 上浮动画重播一次，
   * 顺带整段重排。看上去就是「一行一行蹦出来」，比不做动画还糟。
   * 换成与文本无关的稳定身份后，流式只改文本内容，节点不重建、动画不重播。
   */
  readonly key: string
  readonly label: string
  readonly detail: string
  readonly status: WorkflowStatus
}

interface WorkflowView {
  readonly title: string
  readonly stages: readonly WorkflowStage[]
}

export interface KrActivityTask {
  readonly id: string
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

/**
 * 模型当前的判断原样上屏：**不裁长度**，只规范空白。
 *
 * 原来这里用 /\s+/g 把换行全压成一行，于是模型写的「1. … 2. … 3. …」清单
 * 糊成一坨连续文字——那才是「看着很杂、没有分类」的真凶，宽度不够只是让它
 * 更明显。这些文本本来就是模型自己排好版的结构化输出，压平等于把分类扔掉。
 *
 * 行末换行、空行分段、**行首缩进**全部原样保留（缩进就是 markdown 的层级，
 * 压掉等于把列表拍平）；只收行内连续空白和多余空行，交给 pre-wrap 还原。
 *
 * 长度不裁：早先这里截到 1200 字再补省略号，用户看到的是「话没说完」。超长
 * 改由 UI 折叠（SOLO_FULL_LIMIT + 展开按钮），可见的文本永远完整。
 */
function structuredText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
      return `${indent}${line.slice(indent.length).replace(/[^\S\n]+/g, ' ')}`
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 单行判断超过这个字数才出现「展开全部」；低于它的一律整段直接显示。 */
const SOLO_FULL_LIMIT = 900

function taskStatusLabel(status: KrActivityTask['status']): string {
  return status === 'completed' ? '已完成' : status === 'in_progress' ? '进行中' : '待处理'
}

function buildTaskWorkflow(tasks: readonly KrActivityTask[]): WorkflowView {
  const visible = tasks.slice(0, 6)
  const current = visible.find((task) => task.status === 'in_progress')
    ?? visible.find((task) => task.status === 'pending')
    ?? visible.at(-1)
  const currentId = current?.id
  return {
    title: '模型任务',
    stages: visible.map((task) => ({
      key: task.id,
      label: task.content,
      detail: taskStatusLabel(task.status),
      status: task.id === currentId ? 'current' : task.status === 'completed' ? 'done' : 'pending',
    })),
  }
}

/**
 * 无任务列表时退化成单行「模型当前判断」。
 *
 * 语义摘要走 label 而不是 detail：detail 是给「已完成/进行中」这类短状态词准备的，
 * 固定 nowrap + flex:none，长文本落进去会把左侧 label 挤成 0 宽度（整行只剩摘要、
 * 标题被吃掉）。label 是可换行可截断的那一列，正好接长文本。
 */
function buildWorkflow(
  reasoning: readonly KrActivityReasoningItem[],
  tasks: readonly KrActivityTask[],
  active: boolean,
  closing: boolean,
): WorkflowView {
  if (tasks.length > 0) return buildTaskWorkflow(tasks)
  /*
   * 展示到「正在流式的那条」为止的**全部**思考，按顺序拼接。
   *
   * 早先只取最后一条，模型每换一条思考，卡片内容就被整段换掉——视觉上最难受
   * 的就是这种「突然更替」：上一段话说到一半，下一段话凭空顶上来。拼接后内容
   * 只增不减，新思考是接在旧思考后面的追加，配合 KrFreshText 的逐字淡入就
   * 读作「还在往下写」，而不是被换掉。
   *
   * 截到 running 那条为止，是因为 running 之后的条目是尚未开始的占位。
   */
  let cut = -1
  for (let index = reasoning.length - 1; index >= 0; index -= 1) {
    if (reasoning[index].running && reasoning[index].text.trim() !== '') { cut = index; break }
  }
  const upto = (cut >= 0 ? reasoning.slice(0, cut + 1) : reasoning)
    .filter((item) => item.text.trim() !== '')
  const joined = upto.map((item) => item.text).join('\n\n')
  const semantic = joined.trim() === ''
    ? (active ? '模型正在处理当前请求' : '模型已整理当前结果')
    : capSolo(structuredText(joined))
  return {
    title: '模型进度',
    stages: [{
      key: 'solo',
      label: semantic,
      detail: '',
      status: closing ? 'done' : 'current',
    }],
  }
}

/**
 * 思考总量兜底：从**尾部**保留，丢掉最早的部分并明说丢了多少。
 *
 * 只留尾部是刻意的——最新的一段才是当下相关的；砍头部同样是「更替」，那正是
 * 这次要消灭的东西。正常一轮思考远到不了这个量级，触顶只发生在极端长任务。
 */
const SOLO_MAX_CHARS = 20000
function capSolo(text: string): string {
  if (text.length <= SOLO_MAX_CHARS) return text
  const dropped = text.length - SOLO_MAX_CHARS
  return `（更早的 ${dropped} 字已折叠，完整思考见右侧「思考过程」）\n\n${text.slice(-SOLO_MAX_CHARS)}`
}

/** 进度卡可视窗口内最多平铺几行；超出的收成一行计数，不做纵向滚动。 */
const STAGE_WINDOW = 4

interface StageWindow {
  readonly items: readonly WorkflowStage[]
  readonly offset: number
  readonly before: number
  readonly after: number
}

/**
 * 以当前节点为锚开窗：当前行必留，前面留一行已完成作来路，后面顺延。
 * 序号用 offset 补回真实位次，折叠掉的行不丢上下文。
 */
function windowStages(stages: readonly WorkflowStage[]): StageWindow {
  const total = stages.length
  if (total <= STAGE_WINDOW) return { items: stages, offset: 0, before: 0, after: 0 }
  const anchor = stages.findIndex((stage) => stage.status === 'current')
  const offset = Math.max(0, Math.min(anchor < 0 ? 0 : anchor - 1, total - STAGE_WINDOW))
  return {
    items: stages.slice(offset, offset + STAGE_WINDOW),
    offset,
    before: offset,
    after: total - offset - STAGE_WINDOW,
  }
}

function stageWindowSummary({ before, after }: StageWindow): string | null {
  const parts: string[] = []
  if (before > 0) parts.push(`更早 ${before} 步`)
  if (after > 0) parts.push(`后续 ${after} 步`)
  return parts.length === 0 ? null : parts.join(' · ')
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
  tasks,
  active,
  closing,
  committed,
  onExited,
}: {
  readonly turn: number
  readonly reasoning: readonly KrActivityReasoningItem[]
  readonly tools: readonly ChatNode<'tool-call'>[]
  readonly tasks: readonly KrActivityTask[]
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
  const [expanded, setExpanded] = useState(true)
  const [textExpanded, setTextExpanded] = useState(false)

  const runningTool = useMemo(() => {
    for (let index = tools.length - 1; index >= 0; index -= 1) {
      const node = tools[index]
      try {
        if (isRunning(node.data.root)) return callName(node.data.root) || '工具'
      } catch { /* 未知工具形状跳过 */ }
    }
    return null
  }, [tools])
  const workflow = useMemo(
    () => buildWorkflow(reasoning, tasks, active, closing),
    [active, closing, reasoning, tasks],
  )
  const stageWindow = useMemo(() => windowStages(workflow.stages), [workflow.stages])
  const doneCount = useMemo(
    () => workflow.stages.filter((stage) => stage.status === 'done').length,
    [workflow.stages],
  )
  const stageSummary = stageWindowSummary(stageWindow)
  const thinking = reasoning.some((item) => item.running)
  const action = closing
    ? 'Agent 正在总结'
    : runningTool !== null
      ? `Agent 正在${toolVerb(runningTool)}`
      : thinking
        ? 'Agent 正在思考'
        : active ? 'Agent 正在分析' : 'Agent 正在整理结果'

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

  const toggleExpanded = useCallback((): void => {
    setExpanded((value) => !value)
  }, [])
  const toggleTextExpanded = useCallback((): void => {
    setTextExpanded((value) => !value)
  }, [])
  const handleCardClick = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button, input') !== null) return
    toggleExpanded()
  }, [toggleExpanded])
  const handleCardKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleExpanded()
  }, [toggleExpanded])

  if (!present) return null

  return (
    <div
      ref={rootRef}
      className="kr-agent-mini-shell"
      data-turn={turn}
      data-active={active || undefined}
      data-closing={closing || undefined}
      data-committed={committed || undefined}
      data-expanded={expanded || undefined}
      style={{ '--kr-text-scale': FONT_SCALES[fontScale] } as CSSProperties}
    >
      <section
        className="kr-agent-mini-card"
        role="button"
        tabIndex={0}
        aria-label="Agent 当前状态"
        aria-expanded={expanded}
        aria-live={active && !closing ? 'polite' : 'off'}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
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
           * 这里不再逐字拆 span：扫光改成 background-clip: text 的整行遮罩，
           * 逐字 span 反而会把渐变切进各自的盒子（inline-block 各自成盒），
           * 扫出来是整行一起闪而不是一道光推过去。key 用 action 本身，
           * 动作一变元素重建、扫光从右侧重新起一次。
           */}
          <span key={action} className="kr-agent-mini-action">{action}</span>
        </div>

        <span className="kr-agent-mini-chevron" data-open={expanded || undefined} aria-hidden>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 6 3 3 3-3" />
          </svg>
        </span>

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

      <div className="kr-agent-mini-details" data-open={expanded || undefined} aria-hidden={!expanded}>
        <div className="kr-agent-mini-details__inner">
          <div className="kr-agent-workflow-card">
            <div className="kr-agent-workflow-card__head">
              <span>执行进度</span>
              <span className="kr-agent-workflow-card__meta">
                {workflow.title}
                {/* 计数只在真正有多步时才有意义；单行判断下「0/1」纯属噪音。 */}
                {workflow.stages.length > 1 && (
                  <span className="kr-agent-workflow-card__count">
                    {doneCount}/{workflow.stages.length}
                  </span>
                )}
              </span>
            </div>
            <div
              className="kr-agent-workflow-card__steps"
              data-text-expanded={textExpanded || undefined}
            >
              {stageWindow.items.map((stage) => (
                <div className="kr-agent-workflow-step" data-status={stage.status} key={stage.key}>
                  {/* 节点只承担三态（✓ / 呼吸点 / 灰点），位次交给头部计数与底部汇总。 */}
                  <span className="kr-agent-workflow-step__index">
                    {stage.status === 'done' ? '✓' : ''}
                  </span>
                  <div className="kr-agent-workflow-step__copy" data-solo={stage.detail === '' || undefined}>
                    <span className="kr-agent-workflow-step__label">
                      <KrFreshText text={stage.label} />
                    </span>
                    {stage.detail !== '' && (
                      <span className="kr-agent-workflow-step__detail">{stage.detail}</span>
                    )}
                  </div>
                </div>
              ))}
              {stageWindow.items.some((stage) => stage.detail === '' && stage.label.length > SOLO_FULL_LIMIT) && (
                <button
                  type="button"
                  className="kr-agent-workflow-card__expand"
                  aria-expanded={textExpanded}
                  onClick={toggleTextExpanded}
                >
                  <span className="kr-agent-workflow-card__expandChevron" data-open={textExpanded || undefined} aria-hidden>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 6 3 3 3-3" />
                    </svg>
                  </span>
                  {textExpanded ? '收起' : '展开全部'}
                </button>
              )}
            </div>
            {stageSummary !== null && (
              <div className="kr-agent-workflow-card__more">{stageSummary}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

interface KrActivityCardGateProps {
  readonly turn: number
  readonly reasoning: readonly KrActivityReasoningItem[]
  readonly tools: readonly ChatNode<'tool-call'>[]
  readonly tasks: readonly KrActivityTask[]
  readonly active: boolean
  readonly closing: boolean
  readonly committed: boolean
}

/** closed 历史轮次不挂载真实卡片，避免每轮安装全局监听或退场计时器。 */
export const KrActivityCardGate = memo(function KrActivityCardGate({
  turn,
  reasoning,
  tools,
  tasks,
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
      tasks={tasks}
      active={active}
      closing={closing}
      committed={committed}
      onExited={handleExited}
    />
  )
})
