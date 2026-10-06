/**
 * dsh-chat-plus — 工具闸门客户端（client 半身）。
 *
 * 与 host 半身 `src/tools-gate/index.ts` 配对：那里默认把电脑操作（56 个工具）
 * 与浏览器操作（24 个工具）挡在每轮请求之外，这里给用户一个**看得见、点得到**
 * 的开关 —— 输入栏工具行左端的一张卡片，两个开关项，开启后点亮并显示该组会注入
 * 的工具数。
 *
 * 为什么不是纯 `/` 命令就够：命令要用户记住名字；卡片把「当前关着、开了会花
 * 多少」直接摆出来。两者读写的是**同一张 host 状态表**（同一路由），所以卡片
 * 点了之后 `/computer-use status` 立刻能读到，不存在第二套真相。
 *
 * 为什么在左端而不是右端：右侧紧邻模型选择器，实测文字重叠（用户实机确认）。
 * 左端是「输入区能力开关」的既有座位（记忆注入开关就在那儿）。
 *
 * 动效（纯 CSS，遵循 prefers-reduced-motion）：
 *  - 卡片入场位移淡入；开关项 hover 底色与图标微放大；
 *  - 点亮时滑块位移 + 轨道渐变过渡，开启瞬间有一道扫光；
 *  - 切换中显示脉冲，切换失败回到原状态并抖动一下（不静默失败）。
 *
 * 降级：路由不可用（host 未挂、会话未就绪）时不渲染任何东西，工具行保持原样。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.right 槽位契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { GATE_STYLES } from './styles.ts'
import { mountGateMenuIcons } from './menu-icons.ts'

/** host 状态路由（与 src/tools-gate/index.ts 的 GATE_ROUTE 逐字一致）。 */
export const GATE_ROUTE = '/api/chat-flow/tools-gate'

/** 一组开关的当前状态（与 host 的 GateGroupStatus 对齐）。 */
export interface GateGroupStatus {
  key: string
  label: string
  enabled: boolean
  /** 该组工具个数（0 = 统计不可用，文案退化为不带数量）。 */
  count: number
  /** 该组工具 schema 的 UTF-8 字节数。 */
  bytes: number
}

/** 3.5 字节/token 粗估，与 host 侧口径一致。 */
export function estimateTokens(bytes: number): number {
  return Math.round(bytes / 3.5)
}

/** 注入一次样式（幂等）。 */
let stylesInjected = false
function ensureStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  if (document.getElementById('dsh-tools-gate-style') === null) {
    const style = document.createElement('style')
    style.id = 'dsh-tools-gate-style'
    style.textContent = GATE_STYLES
    document.head.appendChild(style)
  }
  stylesInjected = true
}

/** 读一个会话的全部开关状态；失败返回 null（调用方据此降级隐藏）。 */
export async function fetchGateStatus(sessionId: string): Promise<GateGroupStatus[] | null> {
  if (sessionId === '') return null
  try {
    const res = await fetch(`${GATE_ROUTE}?session=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { ok?: boolean; groups?: GateGroupStatus[] }
    if (data.ok !== true || !Array.isArray(data.groups)) return null
    return data.groups
  } catch {
    return null
  }
}

/** 写一组开关；成功返回新状态，失败返回 null。 */
export async function writeGateStatus(
  sessionId: string,
  key: string,
  enabled: boolean,
): Promise<GateGroupStatus[] | null> {
  try {
    const res = await fetch(GATE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ session: sessionId, key, enabled }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { ok?: boolean; groups?: GateGroupStatus[] }
    if (data.ok !== true || !Array.isArray(data.groups)) return null
    return data.groups
  } catch {
    return null
  }
}

/** 开关项的相位：静默 / 提交中 / 刚失败（失败态用于抖一下）。 */
type Phase = 'idle' | 'pending' | 'failed'

/**
 * 卡片里的一项开关：图标 + 名称 + 滑块，整项可点。
 *
 * 状态来源是 props（父级统一持有整组状态，避免每项各拉一次路由）。
 */
function GateItem(props: {
  group: GateGroupStatus
  phase: Phase
  onToggle: (key: string, next: boolean) => void
}): JSX.Element {
  const { group, phase, onToggle } = props
  const tokens = estimateTokens(group.bytes)
  const detail = group.enabled
    ? `${group.count} 个工具 · 约 ${tokens.toLocaleString('en-US')} tok`
    : '已关闭 · 不占上下文'
  const className = [
    'dsh-gate-item',
    group.enabled ? 'is-on' : 'is-off',
    phase === 'pending' ? 'is-pending' : '',
    phase === 'failed' ? 'is-failed' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={className}
      data-gate-key={group.key}
      role="switch"
      aria-checked={group.enabled}
      title={`${group.label}：${detail}（也可用 /${group.key} on|off）`}
      onClick={() => onToggle(group.key, !group.enabled)}
    >
      <span className="dsh-gate-item__icon" aria-hidden="true" />
      <span className="dsh-gate-item__label">{group.label}</span>
      <span className="dsh-gate-item__track" aria-hidden="true">
        <span className="dsh-gate-item__knob" />
      </span>
      {group.enabled && group.count > 0 ? <span className="dsh-gate-item__count">{group.count}</span> : null}
      <span className="dsh-gate-item__sheen" aria-hidden="true" />
    </button>
  )
}

/**
 * 输入栏工具行左端的闸门卡片（与记忆开关同一排）。
 *
 * 首次挂载拉一次状态；之后每次点击只更新被点的那一组（乐观更新 + 失败回滚），
 * 不做轮询 —— 状态只可能被本页或 `/` 命令改，而 `/` 命令改完会走一次会话事件
 * 刷新，不需要常驻轮询。
 */
export function ToolsGateCard(props: { sessionId: SessionId | undefined }): JSX.Element | null {
  const sessionId = props.sessionId
  const [groups, setGroups] = useState<GateGroupStatus[] | null>(null)
  const [phases, setPhases] = useState<Record<string, Phase>>({})
  const aliveRef = useRef(true)
  /** 当前会话 id 的镜像：异步回包据此判断「会话是否已被切走」。 */
  const sessionRef = useRef<SessionId | undefined>(sessionId)
  sessionRef.current = sessionId

  useEffect(() => {
    ensureStyles()
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    if (sessionId === undefined) {
      setGroups(null)
      return
    }
    // 切会话时先清空，避免把上一个会话的开关状态显示在新会话上（拉取很快，
    // 但状态错了会误导用户去点一个其实没关的开关）。
    setGroups(null)
    let alive = true
    void fetchGateStatus(sessionId).then((next) => {
      if (alive && aliveRef.current && sessionRef.current === sessionId) setGroups(next)
    })
    return () => { alive = false }
  }, [sessionId])

  const onToggle = useCallback((key: string, next: boolean) => {
    if (sessionId === undefined) return
    setGroups((current) => current === null ? current : current.map(g => g.key === key ? { ...g, enabled: next } : g))
    setPhases((current) => ({ ...current, [key]: 'pending' }))
    // 会话可能在提交途中被切走：捕获本次请求的 sessionId，回包时若已不是当前
    // 会话就丢弃（否则会把上一个会话的开关状态画到新会话的工具行上）。
    const forSession = sessionId
    void writeGateStatus(forSession, key, next).then((result) => {
      if (!aliveRef.current || sessionRef.current !== forSession) return
      if (result === null) {
        // 失败：回滚到服务端真实状态（再拉一次），并抖一下让用户看见。
        void fetchGateStatus(forSession).then((truth) => {
          if (!aliveRef.current || sessionRef.current !== forSession) return
          if (truth !== null) setGroups(truth)
          setPhases((current) => ({ ...current, [key]: 'failed' }))
          setTimeout(() => {
            if (aliveRef.current) setPhases((current) => ({ ...current, [key]: 'idle' }))
          }, 600)
        })
        return
      }
      setGroups(result)
      setPhases((current) => ({ ...current, [key]: 'idle' }))
    })
  }, [sessionId])

  if (groups === null || groups.length === 0) return null

  return (
    <div className="dsh-gate-card" role="group" aria-label="按需工具开关">
      {groups.map(group => (
        <GateItem key={group.key} group={group} phase={phases[group.key] ?? 'idle'} onToggle={onToggle} />
      ))}
    </div>
  )
}

/**
 * 挂载闸门卡片到输入栏工具行左端。
 *
 * 座位：`conversation.input.left`（与记忆注入开关同一排）。
 *
 * 为什么不是 `input.right`：右侧紧邻模型选择器与提交按钮，实测两枚胶囊的文字
 * 会与模型名重叠（用户实机截图确认）。左端是「输入区能力开关」的既有座位
 * （记忆注入 order 99 / 内置提示词 98），与它们的语义也一致。
 *
 * order 100：排在记忆两枚（98/99）之后，紧邻其右，形成「能力开关」这一组。
 *
 * @param ctx - client root context。
 */
export function applyToolsGateClient(ctx: ClientContext): void {
  try {
    ensureStyles()
    const scope = ctx
    scope.slots.inject('conversation.input.left', () => scope.slots.register({
      name: 'conversation.input.left',
      id: 'dsh-tools-gate',
      order: 100,
      inject: (sessionId: SessionId) => ({ sessionId }),
    }, ToolsGateCard as never))
    // `/` 菜单里给两条指令补图标（宿主命令没有官方图标通道，见 menu-icons.ts）。
    mountGateMenuIcons()
  } catch (error) {
    console.warn(`[dsh-chat-plus] 工具闸门卡片挂载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
