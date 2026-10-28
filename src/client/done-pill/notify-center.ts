/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 任务完成提醒（client 半身叶子模块）。
 *
 * 任一会话的回合**真正结束**时给一次提醒。系统通知发不出去时回落到页内
 * 动效通知卡（右下角堆叠、入退场动画、点击跳会话）。
 *
 * ## 通道为什么有三条
 * DSH WebUI 会在两种宿主里跑，两者的通知能力完全不同：
 *
 *  · **纯浏览器**（直接开 127.0.0.1:3080）：`Notification` 由页面自己发，
 *    需要用户授权（granted）。
 *  · **桌面壳子**（`topbar.html` + iframe）：WebUI 在跨源 iframe 里，
 *    `Notification.permission` 是 default/denied，而权限请求要用户手势、
 *    壳内又没有系统级授权 UI——用户实际上永远不会去点它，等于发不出去。
 *    可靠路径是绕道 host：POST `/api/dsh-done-pill/notify`，由 host 经 CDP 在
 *    壳页面（file:// 顶层文档，壳子 main.js 已用 setPermissionCheckHandler
 *    放行 notifications）里发原生通知；通知被点击时壳页面把会话 id 回传
 *    `/api/dsh-done-pill/notify-click`，客户端下一轮轮询取走并跳进会话。
 *  · **都不可用**（权限被拒 / 壳子没开 / host 不可达）→ 页内通知卡。
 *
 * 「在不在壳里」用「跨源父窗口是否存在」判断（读 `window.top` 抛 SecurityError
 * 即跨源嵌入），**不要**用 `permissionsPolicy.allowsFeature('notifications')`
 * ——`notifications` 不是 Chromium 的 policy-controlled feature，那个调用在
 * 任何上下文都返回 false（实测纠正，详见 nativePermission 上方的说明）。
 *
 * ## 触发口径
 * **每个完成的回合都提醒**。host 侧已排除 subagent 与 aborted 回合、空回合
 * 也不进完成列表，所以这里拿到「新条目」即提醒。
 *
 * ## 基线
 * host 保留最近完成记录，页面加载后首轮轮询会拉到一批**历史**条目——它们
 * 不是刚完成的，不能弹。首个 tick 只建立基线（把当时的 id 全部记账）。
 * 悬浮胶囊与左下角小横条各自轮询，两边都会调用 `consumeDoneEntries`，所以
 * 记账与去重都放在**模块级**（`seen` / `baselineDone`），谁先 tick 都安全，
 * 同一条目也只会提醒一次。
 *
 * 约束：本文件不 import React、不 import pill.tsx / sidebar-card.tsx
 * （叶子模块，裸 node 可单测）；跳转复用 ./session-nav。
 *
 * 注：`./session-nav.ts` 写成**带扩展名**——本模块要被 `tests/notify-center.test.mjs`
 * 用裸 node 直接加载（node 的 ESM 解析器不做扩展名补全；esbuild 两者都认）。
 */
import { openSessionById } from './session-nav.ts'

// ── 数据类型（与 host 的 DonePillEntry 对齐）────────────────────────────────

export interface DoneNoticeEntry {
  seq: number
  id: string
  sessionId: string
  title: string
  question: string
  answer: string
  endedAt: number
  /** 本回合耗时（ms）：host 拿不到开始时间时为 0（不展示耗时那一段）。 */
  durationMs?: number
  turn: number
  reasonKind: string
}

/** host 增量响应里我们关心的部分。 */
export interface DonePillPayload {
  ok: boolean
  version: number
  items: DoneNoticeEntry[]
  /** 壳页面点过系统通知、待客户端接管的会话 id。 */
  openSessionId?: string
}

// ── 开关（localStorage 持久化，默认开启）──────────────────────────────────

export const NOTIFY_KEY = 'dsh.donePill.notify'

interface NotifyConfig {
  /** 总开关：关掉后既不弹系统通知也不弹页内卡。 */
  enabled: boolean
  /** 提示音开关（与总开关独立：可以要通知不要声音）。 */
  sound: boolean
}

function loadNotifyConfig(): NotifyConfig {
  try {
    const raw = localStorage.getItem(NOTIFY_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw) as Partial<NotifyConfig>
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.enabled === 'boolean') {
        return {
          enabled: parsed.enabled,
          // 老版本只存了 enabled：补上默认值（默认开声音）。
          sound: typeof parsed.sound === 'boolean' ? parsed.sound : true,
        }
      }
    }
  } catch { /* 读不到按默认 */ }
  return { enabled: true, sound: true }
}

let notifyConfig: NotifyConfig = loadNotifyConfig()
const configListeners = new Set<(next: NotifyConfig) => void>()

/** 通知开关 store（设置行订阅）。 */
export const notifyStore = {
  get: (): NotifyConfig => notifyConfig,
  set(next: Partial<NotifyConfig>): void {
    notifyConfig = {
      enabled: typeof next.enabled === 'boolean' ? next.enabled : notifyConfig.enabled,
      sound: typeof next.sound === 'boolean' ? next.sound : notifyConfig.sound,
    }
    try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(notifyConfig)) } catch { /* 忽略 */ }
    for (const fn of [...configListeners]) {
      try { fn(notifyConfig) } catch { /* 单个订阅者异常不影响其它 */ }
    }
  },
  subscribe(fn: (next: NotifyConfig) => void): () => void {
    configListeners.add(fn)
    return () => { configListeners.delete(fn) }
  },
}

// ── 页内通知卡 store ────────────────────────────────────────────────────────

export interface NotifyCard {
  /** 单调递增序号：同文案重复出现也能重播入场动画。 */
  seq: number
  /** 完成条目 id（点击后按它标已读/去重）。 */
  id: string
  sessionId: string
  title: string
  /** 主文案（问题摘要）。 */
  text: string
  /** 出错结束的回合（用暖赭色语义标记）。 */
  failed: boolean
  /** 耗时文案（拿不到耗时为空串）。 */
  meta: string
}

/** 同时在屏的页内卡上限：连着一串完成时只留最新的几条。 */
const MAX_CARDS = 3
let cards: NotifyCard[] = []
let cardSeq = 0
const cardListeners = new Set<(next: NotifyCard[]) => void>()

function publishCards(next: NotifyCard[]): void {
  cards = next
  for (const fn of [...cardListeners]) {
    try { fn(cards) } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

/** 页内通知卡 store（组件订阅；无 React 依赖，便于裸 node 单测）。 */
export const notifyCardStore = {
  list: (): NotifyCard[] => cards,
  subscribe(fn: (next: NotifyCard[]) => void): () => void {
    cardListeners.add(fn)
    return () => { cardListeners.delete(fn) }
  },
  /** 手动收起某条（卡片上的关闭按钮 / 自动收起）。 */
  dismiss(seq: number): void {
    const next = cards.filter(card => card.seq !== seq)
    if (next.length !== cards.length) publishCards(next)
  },
  /** 全部收起（点击跳转后）。 */
  clear(): void {
    if (cards.length > 0) publishCards([])
  },
}

// ── 通知文案 ────────────────────────────────────────────────────────────────

/** 单行化 + 截断（通知里换行可控，但列表摘要要能塞进一行）。 */
function flat(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`
}

/** 耗时文案：<1s 不显示、<1min 用秒、其余 mm:ss。 */
export function elapsedText(durationMs: number | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 1000) return ''
  const total = Math.round(durationMs / 1000)
  if (total < 60) return `耗时 ${total} 秒`
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `耗时 ${mm}:${String(ss).padStart(2, '0')}`
}

interface NoticeContent {
  title: string
  body: string
  cardTitle: string
  cardText: string
  meta: string
  failed: boolean
}

/**
 * 由完成条目组装通知文案。
 *
 * 出错结束（reason.kind === 'error'）的回合换成「任务出错」标题——用户一眼
 * 能分辨是完成还是失败，不用点进去才知道。
 */
export function noticeContentOf(entry: DoneNoticeEntry): NoticeContent {
  const failed = entry.reasonKind === 'error'
  const session = entry.title !== '' ? entry.title : entry.sessionId
  const question = flat(entry.question, 80)
  const answer = flat(entry.answer, 140)
  const meta = elapsedText(entry.durationMs)
  const head = failed ? `任务出错 · ${session}` : `任务完成 · ${session}`
  const parts = [question, answer, meta].filter(part => part !== '')
  return {
    title: head,
    // 系统通知正文给两行：问题 + 回复摘要（再带一行耗时）。没有问题时只放回复。
    body: parts.length === 0 ? '回合已结束' : parts.join('\n'),
    cardTitle: session,
    cardText: question !== '' ? question : (answer !== '' ? answer : '回合已结束'),
    meta,
    failed,
  }
}

// ── 系统通知通道 ────────────────────────────────────────────────────────────

/**
 * 页面是否处在**壳子的 iframe 里**。
 *
 * 判据：跨源 iframe 读 `window.top` 会抛 SecurityError，能读到且不相同时说明
 * 有父窗口。壳子（topbar.html + iframe 承载 WebUI）与纯浏览器访问（顶层文档）
 * 由此区分——它决定「未授权时该期待哪条系统通道」。
 */
export function inEmbeddedFrame(): boolean {
  try {
    return window.top !== window.self
  } catch {
    // 读 window.top 抛错 = 跨源父窗口确实存在 = 我们就在别人家的 iframe 里。
    return true
  }
}

/**
 * 说明（实测纠正，勿想当然）：
 *
 *  **不要**用 `document.permissionsPolicy.allowsFeature('notifications')` 判断
 *  iframe 里能不能发通知——`notifications` 根本不是 Chromium 的
 *  policy-controlled feature（`allowedFeatures()` 的 76 项里没有它），该调用
 *  **在任何上下文都返回 false**。曾据此实现过一版，结果纯浏览器下也被判成
 *  「策略禁止」，系统通知永远发不出去。
 *
 *  另一个坑：`permission === 'denied'` 时 `new Notification()` **不抛异常**，
 *  只是静默不显示。所以判据只能是 `Notification.permission`，不能靠 try/catch
 *  兜底（试一次不会报错，会让你以为发出去了）。
 */

/** 原生 Notification 在本页是否可用（存在该构造函数）。 */
export function nativeNotifyUsable(): boolean {
  return typeof Notification === 'function'
}

/** 原生通知的当前权限（不支持时返回 'unsupported'）。 */
export function nativePermission(): NotificationPermission | 'unsupported' {
  if (!nativeNotifyUsable()) return 'unsupported'
  try { return Notification.permission } catch { return 'denied' }
}

export type NotifyChannel = 'native' | 'shell' | 'card'

/** 提示音资源路径（插件 public/sfx/，经 /mp 静态路由提供）。 */
const SFX_URL = '/api/chat-flow/sfx/task-done.wav'

/** 复用的 Audio 元素：连续完成时重头播，不叠一堆实例。 */
let sfxAudio: HTMLAudioElement | null = null

/**
 * 在**当前页面**播提示音（纯浏览器场景）。
 *
 * 壳内（跨源 iframe）不在这里播：iframe 的自动播放会被策略拦，那条路由 host
 * 在壳页面（顶层文档）播，见 host 的 notify 路由。两条路不会同时响——
 * 壳内 fireViaShell 成功时不走这里，浏览器里壳内通道失败才走。
 */
function fireSoundHere(): boolean {
  if (typeof Audio !== 'function') return false
  try {
    if (sfxAudio === null) sfxAudio = new Audio()
    try { sfxAudio.pause() } catch { /* 未播放过 */ }
    sfxAudio.currentTime = 0
    sfxAudio.volume = 0.55
    sfxAudio.src = SFX_URL
    const played = sfxAudio.play()
    if (played !== undefined && typeof played.catch === 'function') {
      played.catch(() => { /* 自动播放被拦：静默，不打扰用户 */ })
    }
    return true
  } catch {
    return false
  }
}

/**
 * 壳内通道的失败冷却：纯浏览器里宿主必然返回 dispatched=false，若不做冷却，
 * 每个完成的回合都会白发一次 POST。一次失败后暂停 60 秒再试——壳子中途启动
 * （先开浏览器页面、后开壳子）也能在一分钟内自愈。
 */
const SHELL_RETRY_MS = 60000
let lastShellFailAt = 0

/**
 * 在当前宿主里**预期**能用的系统通知通道（设置行展示用）。
 *
 *  · 已授权 → 'native'（无论是否在壳内，页面自己就能发）；
 *  · 未授权但在壳子的 iframe 里 → 'shell'（host 经 CDP 在壳页面里发，
 *    壳子主进程的权限处理器已放行 notifications，不需要用户手势）；
 *  · 其余（纯浏览器且未授权/已拒绝）→ 'card'：页内卡兜底，设置行的按钮
 *    能让用户升级到原生。
 */
export function activeChannel(): NotifyChannel {
  if (nativePermission() === 'granted') return 'native'
  return inEmbeddedFrame() ? 'shell' : 'card'
}

/**
 * 请求原生通知权限（**必须由用户手势触发**：设置行的按钮）。
 *
 * 不在壳内 iframe 里时才调用——壳内子框架的权限请求会挂起等待根本不会出现
 * 的权限弹窗（壳子没有系统级授权 UI），点击「启用」按钮将永远停在「请求中…」。
 */
export async function requestNativePermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!nativeNotifyUsable()) return 'unsupported'
  try { return await Notification.requestPermission() } catch { return 'denied' }
}

/** 在页面自己这一侧发原生通知；点击时聚焦窗口并跳进该会话。 */
function fireNative(title: string, body: string, sessionId: string, tag: string): boolean {
  // 权限不是 granted 时**不要**构造：Chromium 会静默丢弃（不抛异常），
  // 于是「以为发出去了、其实什么都没弹」。
  if (nativePermission() !== 'granted') return false
  try {
    const notification = new Notification(title, { body, tag })
    notification.onclick = () => {
      try { window.focus() } catch { /* 聚焦失败不影响跳转 */ }
      try { openSessionById(sessionId) } catch { /* 导航失败有提示条兜底 */ }
      try { notification.close() } catch { /* 忽略 */ }
    }
    return true
  } catch {
    return false
  }
}

/** 壳内通道的冷却是否生效（纯浏览器里避免每回合白发 POST）。 */
function shellCoolingDown(): boolean {
  return lastShellFailAt !== 0 && Date.now() - lastShellFailAt < SHELL_RETRY_MS
}

/** 壳内通道：交给 host，经 CDP 在壳页面里发（回执 true 才算成功）。 */
async function fireViaShell(title: string, body: string, sessionId: string, tag: string): Promise<boolean> {
  if (shellCoolingDown()) return false
  try {
    const res = await fetch('/api/dsh-done-pill/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, tag, sessionId }),
    })
    if (!res.ok) { lastShellFailAt = Date.now(); return false }
    const data = await res.json() as { ok?: boolean; dispatched?: boolean }
    const ok = data?.ok === true && data?.dispatched === true
    // 成功就清掉冷却（壳子起来了立刻恢复），失败则重新计时。
    lastShellFailAt = ok ? 0 : Date.now()
    return ok
  } catch {
    lastShellFailAt = Date.now()
    return false
  }
}

/** 派发去重窗口（ms）：防止短时间内因轮询竞态或事件重入对同一任务重复弹通知 */
const DISPATCH_DEDUP_MS = 6000
const recentDispatches = new Map<string, number>()

function isDuplicateDispatch(entry: DoneNoticeEntry): boolean {
  const now = Date.now()
  for (const [key, ts] of recentDispatches.entries()) {
    if (now - ts > DISPATCH_DEDUP_MS * 2) recentDispatches.delete(key)
  }
  const key = `${entry.sessionId}:${entry.id}`
  const last = recentDispatches.get(key)
  if (last !== undefined && now - last < DISPATCH_DEDUP_MS) {
    return true
  }
  recentDispatches.set(key, now)
  return false
}

/**
 * 派发一条完成提醒。
 *
 * 桌面浮窗/系统通知与页内卡互斥：壳内优先走壳页面（桌面浮窗），未授权/纯浏览器试
 * 原生通知；系统通道可用时不弹页内卡，仅在系统通道都走不通时（channel='card'）
 * 才用页内卡兜底——彻底避免桌面浮窗与页内卡同时弹两次。
 *
 * **提示音只响一次**：无论走哪条通道，声音一律由 Web 端本页播；壳子后台不再
 * 重复响（内嵌应用自己会响，两处都响就是双声）。
 * @returns 实际用上的系统通道（'card' 表示系统通道都没成，页内卡已兜底）。
 */
export async function dispatchNotice(entry: DoneNoticeEntry): Promise<NotifyChannel> {
  if (!notifyConfig.enabled) return 'card'
  if (isDuplicateDispatch(entry)) return 'card'
  const content = noticeContentOf(entry)
  const tag = `dsh-done-${entry.sessionId}`
  const wantSound = notifyConfig.sound
  const embedded = inEmbeddedFrame()

  // 系统通道：壳内优先走壳页面（桌面浮窗 / 系统通知）；否则试原生。
  let channel: NotifyChannel = 'card'
  if (embedded && await fireViaShell(content.title, content.body, entry.sessionId, tag)) {
    channel = 'shell'
  } else if (fireNative(content.title, content.body, entry.sessionId, tag)) {
    channel = 'native'
  } else if (!embedded && await fireViaShell(content.title, content.body, entry.sessionId, tag)) {
    channel = 'shell'
  }

  // 页内卡：仅当系统通道与壳子通道都不可用时（channel === 'card'）作为兜底弹出。
  // 避免桌面浮窗与页内卡同时弹两次打扰用户。
  if (channel === 'card') {
    cardSeq += 1
    const card: NotifyCard = {
      seq: cardSeq,
      id: entry.id,
      sessionId: entry.sessionId,
      title: content.cardTitle,
      text: content.cardText,
      failed: content.failed,
      meta: content.meta,
    }
    publishCards([card, ...cards.filter(item => item.id !== card.id)].slice(0, MAX_CARDS))
  }

  // 提示音：由 Web 端统一发声，壳子后台不再重复响（避免响两次）。
  if (wantSound) fireSoundHere()

  return channel
}

// ── 轮询接线 ────────────────────────────────────────────────────────────────

/** 已提醒过的完成条目 id 上限（超出丢最早的，防长会话里无限增长）。 */
const MAX_SEEN = 500
const seen = new Set<string>()

/**
 * 基线水位：页面上线时 host 里**已存在**的条目最大 seq。
 *
 * 只用一次「首轮建立基线」的布尔标志是错的——悬浮胶囊与左下角小横条**各自
 * 轮询**，两者水位线独立（各自 sinceRef=0），第二个组件的首轮会看到同一批
 * 历史条目，而全局标志早已被第一个组件置位，于是整批历史完成被当成新完成
 * 弹一屏通知（实测复现）。
 *
 * 改用 host 的 seq 做基线：seq 在 host 内单调递增（= 启动时间戳 + 计数器），
 * 所以「seq ≤ 基线水位」= 页面上线前就完成的条目。这样判据不依赖哪个组件先
 * tick、不依赖两端时钟，且 host 重启后 seq 变大 → 新条目照常提醒。
 *
 * ⚠ 水位必须**首轮就建立**，且来源是 host 的 `version`（= 当前最大 seq），
 * 不是「首个非空批次的最大 seq」。曾经的写法是「等第一个非空批次」，
 * 于是 host 刚重启（完成列表为空）时水位一直悬着——用户跑完的**第一个**任务
 * 恰好就是那个「首个非空批次」，被当成基线整个吃掉，表现为「跑完了但没提醒」
 * （真机复现：服务重启后首个完成静默）。
 *
 * -1 = 尚未建立。
 */
let baselineSeq = -1

/** 单测/热重载用：重置基线（下一轮重新建立）。 */
export function resetNotifyBaseline(): void {
  seen.clear()
  baselineSeq = -1
}

/**
 * 消费一轮 host 增量。
 *
 * 幂等：同一条目 id 只提醒一次，因此悬浮胶囊与左下角小横条**各自轮询**都
 * 调这里也不会重复弹。
 *
 * 基线：由 host 的 `version`（= 当前最大 seq）**首轮**建立，所以即便这一轮
 * items 为空也能把水位钉住——host 刚重启（列表为空）时用户跑完的第一个任务
 * 必须能提醒，不能被当成「首个非空批次」吃掉。
 * @param items - 本轮增量条目。
 * @param version - host 的版本水位（当前最大 seq）；拿不到时回退用本批最大 seq。
 * @returns 本轮真正派发出去的提醒条数。
 */
export async function consumeDoneEntries(
  items: readonly DoneNoticeEntry[],
  version?: number,
): Promise<number> {
  const watermark = typeof version === 'number' && Number.isFinite(version) ? version : null

  const valid: DoneNoticeEntry[] = []
  if (Array.isArray(items)) {
    for (const entry of items) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
      if (typeof entry.seq !== 'number' || !Number.isFinite(entry.seq)) continue
      valid.push(entry)
    }
  }

  if (baselineSeq < 0) {
    // 首轮：把水位钉在 host 当前的版本号上（没有 version 时退化为本批最大 seq）。
    // 这一轮里的条目都算存量，只记账不弹。
    const fromItems = valid.reduce((max, entry) => Math.max(max, entry.seq), -1)
    const base = watermark === null ? fromItems : Math.max(watermark, fromItems)
    if (base < 0) return 0
    baselineSeq = base
    for (const entry of valid) remember(entry.id)
    return 0
  }

  if (valid.length === 0) return 0

  const fresh: DoneNoticeEntry[] = []
  for (const entry of valid) {
    if (seen.has(entry.id)) continue
    remember(entry.id)
    // 水位以下 = 上线前就完成的（另一个轮询者已建基线时才会走到这里）。
    if (entry.seq <= baselineSeq) continue
    fresh.push(entry)
  }
  // ⚠ 水位**只能**用「本轮条目里已确认处理过的最大 seq」推进，**绝不能**用
  // host 的 `version`：version 是「当前最大 seq」，当新条目在同一轮到达时它就
  // 等于新条目的 seq——于是水位被推到新条目之上，另一个轮询者（悬浮胶囊 /
  // 左下角小横条各自 tick）再看同一条就判成存量跳过，表现为「有时响有时不响」。
  // 实测踩过：since 被推到 ...892 而 version 仍是 ...891，后续轮询全被判存量。
  const maxHandled = valid.reduce((max, entry) => Math.max(max, entry.seq), -1)
  if (maxHandled > baselineSeq) baselineSeq = maxHandled
  if (!notifyConfig.enabled) return 0
  let sent = 0
  for (const entry of fresh) {
    await dispatchNotice(entry)
    sent += 1
  }
  return sent
}

function remember(id: string): void {
  seen.add(id)
  if (seen.size > MAX_SEEN) {
    const oldest = seen.values().next().value
    if (typeof oldest === 'string') seen.delete(oldest)
  }
}

/**
 * 接管「壳页面点了系统通知」的跳转请求（host 在增量响应里回传一次）。
 * 取到即跳，失败有 navNoticeStore 的提示条兜底。
 */
export function consumeOpenRequest(sessionId: string | undefined): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const outcome = openSessionById(sessionId)
  return outcome.ok
}
