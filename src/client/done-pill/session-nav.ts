/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 会话跳转（session-nav，client 半身叶子模块）。
 *
 * 为什么单独抽一层：胶囊的两种形态（顶部悬浮 pill / 左下角小横条卡片）都要
 * 「点击进入某个会话」，而 DSH 的会话切换入口在版本间搬过家——
 *
 *  · **DSH 0.2（当前）**：`ctx.uiWorkspace.openSession(target)`
 *    （`@deepseek-ai/dsh-client-ui-workspace` 提供的跨插件导航面，声明见
 *    `navigation.d.ts` 的 `UiWorkspace.openSession`）。官方 schedule /
 *    subagent / workflow-run / chat / agent-team 全都走它。
 *    `ctx.get('sessions')` 拿到的是 `ISessions`，它**只有**
 *    retain / using / create / fork / scope / binding……**没有 open()**。
 *  · **更早的版本**：session-controller 直接在 sessions 服务上挂 `open(id)`。
 *
 * 旧实现只认后者（`runtime.open(...)`），于是 0.2 上每次点击都抛
 * `TypeError: runtime.open is not a function`，又被 catch 吞成一行
 * console.warn——用户看到的就是「点了没反应」。这里按
 * 「官方现行入口 → 历史 API」的顺序探测，并把结果通过 navNoticeStore
 * 广播出去，让胶囊能显示**可见**的失败反馈，不再静默。
 *
 * 约束：本文件不 import pill.tsx / sidebar-card.tsx（叶子模块，无循环依赖），
 * 也不 import 任何 @deepseek-ai/* 运行时值（只按结构探测服务）。
 */

/** 客户端根上下文的最小可读面（避免 import 官方类型造成运行时依赖）。 */
export interface SessionNavCtx {
  get?(name: string): unknown
}

/** 官方导航面里我们用到的部分。 */
interface UiWorkspaceLike {
  openSession(target: string): void
  /** 私有但可读：当前主视图选择，仅用于**校验**本次跳转是否真的生效。 */
  selection?: { getSnapshot?: () => { sessionId?: unknown } | undefined }
}

/** 历史版本 sessions 服务上的 open。 */
interface SessionsLegacyLike {
  open(id: string): void
}

/** 跳转实际走通的通道。 */
export type SessionNavVia = 'uiWorkspace' | 'sessions.open'

export interface SessionNavOutcome {
  ok: boolean
  via?: SessionNavVia
  /** 失败原因（人类可读，直接进提示条）。 */
  reason?: string
}

// ---- 上下文登记（由 applyDonePill 在 apply() 时注入一次）----

let clientCtx: SessionNavCtx | null = null

/** 由插件入口在 apply() 中登记（幂等）。 */
export function setSessionNavContext(ctx: SessionNavCtx | null): void {
  clientCtx = ctx
}

/**
 * 防御式读一个服务。
 *
 * cordis 的 ctx 是 Proxy：未在 inject 白名单里声明的**属性**一读就抛
 * `cannot get property "x" without inject`。`ctx.get(name)` 是官方 API、
 * 不走该检查，但服务缺失/未就绪时仍可能抛，所以统一 try/catch。
 */
function service<T>(name: string): T | undefined {
  const ctx = clientCtx
  if (ctx === null || typeof ctx.get !== 'function') return undefined
  try {
    const value = ctx.get(name)
    return value === null ? undefined : (value as T | undefined)
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 读当前主视图会话 id（读不到返回 undefined，仅用于校验）。 */
function selectionOf(workspace: UiWorkspaceLike): string | undefined {
  try {
    const snapshot = workspace.selection?.getSnapshot?.()
    const id = snapshot?.sessionId
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

// ---- 跳转结果通知（供胶囊显示可见反馈）----

export interface NavNotice {
  /** 单调递增序号：同一文案重复出现时也能重播入场动画。 */
  seq: number
  kind: 'error' | 'info'
  text: string
}

let notice: NavNotice | null = null
let noticeSeq = 0
/** 相同文案的去重窗口（ms）：连点/批量失败时不刷屏。 */
const NOTICE_DEDUPE_MS = 2500
let lastText = ''
let lastAt = 0
const listeners = new Set<(next: NavNotice | null) => void>()

function publish(next: NavNotice | null): void {
  notice = next
  for (const fn of [...listeners]) {
    try { fn(next) } catch { /* 单个订阅者异常不影响其它订阅者 */ }
  }
}

function notify(kind: NavNotice['kind'], text: string): void {
  const now = Date.now()
  if (text === lastText && now - lastAt < NOTICE_DEDUPE_MS) return
  lastText = text
  lastAt = now
  noticeSeq += 1
  publish({ seq: noticeSeq, kind, text })
}

/** 提示条 store（NavToast 组件订阅；无 React 依赖，便于裸 node 单测）。 */
export const navNoticeStore = {
  get: (): NavNotice | null => notice,
  subscribe(fn: (next: NavNotice | null) => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  /** 手动收起（提示条上的关闭按钮）。 */
  dismiss(): void {
    if (notice !== null) publish(null)
  },
}

/**
 * 对外通知入口：把一条 error/info 广播到提示条（NavToast 订阅）。
 * 录屏器（recorder.ts）等非跳转场景复用它做可见反馈，不再各写一套 toast。
 * 与内部 notify 同一去重窗口与 seq 语义。
 */
export function pushNotice(kind: NavNotice['kind'], text: string): void {
  notify(kind, text)
}

// ---- 跳转 ----

function fail(reason: string): SessionNavOutcome {
  notify('error', reason)
  console.warn(`[dsh-done-pill] 跳转会话失败：${reason}`)
  return { ok: false, reason }
}

/**
 * 打开指定会话（两种胶囊形态共用）。
 *
 * 成功 = 官方导航面已受理**且**（可读到时）主视图选择确实切到了目标 id。
 * 失败一律返回原因并经 navNoticeStore 广播——调用方不需要自己处理错误。
 * @param sessionId - host 下发条目里的会话 id。
 * @returns 跳转结果。
 */
export function openSessionById(sessionId: string): SessionNavOutcome {
  if (typeof sessionId !== 'string' || sessionId === '') {
    return fail('这条记录没有可用的会话 id')
  }

  // 1) 官方现行入口：ui-workspace 的跨插件导航面。
  const workspace = service<UiWorkspaceLike>('uiWorkspace')
  if (workspace !== undefined && typeof workspace.openSession === 'function') {
    const before = selectionOf(workspace)
    try {
      workspace.openSession(sessionId)
    } catch (error) {
      return fail(`打开会话失败：${messageOf(error)}`)
    }
    // openSession 是同步的（replaceMain 同步写 selection）：调用后即可校验。
    // 读不到 selection（字段改名/未就绪）时跳过校验，按已受理处理。
    const after = selectionOf(workspace)
    if (before !== undefined && after !== undefined && after !== sessionId) {
      return fail('DSH 拒绝了这次切换：该会话可能已归档或已不存在')
    }
    return { ok: true, via: 'uiWorkspace' }
  }

  // 2) 历史版本：sessions 服务自带 open()（0.2 上不存在，保留兼容）。
  const sessions = service<SessionsLegacyLike>('sessions')
  if (sessions !== undefined && typeof sessions.open === 'function') {
    try {
      sessions.open(sessionId)
    } catch (error) {
      return fail(`打开会话失败：${messageOf(error)}`)
    }
    return { ok: true, via: 'sessions.open' }
  }

  return fail('DSH 未提供会话导航服务（uiWorkspace 不可用），请更新 dsh-companion')
}
