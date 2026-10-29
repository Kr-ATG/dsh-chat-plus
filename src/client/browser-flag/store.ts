/**
 * dsh-chat-plus — 浏览器活动 store（client 半身）。
 *
 * ## 为什么是「一份」全局轮询器
 *
 * 官方会话列表一屏能有几十行。若每行各自轮询，「N 行 = N 次请求」，而这份
 * 数据（哪些会话正在跑浏览器工具）天然是全局的：host 一次回包就带着全部会话。
 * 所以这里只有一份轮询器 + 一份快照，会话行标记从它读 —— 切会话、增删行都不
 * 产生新请求。
 *
 * ## 为什么失败一律当「无活动」，不重试也不报错
 *
 * host 半身可能没装、没重启、或版本对不上（路由 404）。这类失败每次都一样，
 * 重试只会刷满控制台。降级形态就是「什么都没有」：图标不出现、
 * 对话与列表完全不受影响 —— 这是本模块唯一必须保证的失败姿态。
 *
 * ## 轮询节奏
 *
 * 活动存在时 1000ms（要跟得上工具调用的开始与结束）；连续 3 次无活动后降到
 * 5000ms 保活 —— 用户随时可能从别处（另一个标签页、手机端）发起浏览器操作，
 * 停掉轮询就再也看不见了。页面不可见时完全不请求（与 index.ts 的
 * installAnimationThrottle 同一思路），恢复可见立刻拉一次。
 *
 * ## 调试入口
 *
 * window 上暴露一份预览灌入函数（BROWSER_FLAG_PREVIEW_KEY）：不发起真实浏览器
 * 工具调用也能验证标志与动效。它只写快照，不改轮询节奏；真实活动一旦出现就以
 * 路由数据为准覆盖（详见 tick 里的取舍）。
 */

/** 活动路由（与 host 半身 BROWSER_ACTIVITY_ROUTE 逐字一致）。 */
export const BROWSER_ACTIVITY_ROUTE = '/api/chat-flow/browser-activity'

/** 有活动时的轮询间隔（ms）。 */
export const FAST_POLL_MS = 1000

/**
 * 连续无活动后的保活间隔（ms）。
 *
 * 2026-10-29 从 5000 降到 1500：**ego 的一次操作太短，5 秒的保活期会整段错过**。
 *
 * 症状（用户原话）：「使用 EGO 的时候操作间不显示浏览器标识了」。实测时序是：
 * 一次 `ego-browser nodejs -e ...` 调用只跑 2–5 秒，结束后 host 侧只剩 1.5s 尾迹；
 * 而轮询在连续无活动 3 轮后就降到 5s。于是「活动已经结束、下一次轮询还没到」，
 * 回包永远是空的 —— 图标不是没渲染，是**从来没拿到过数据**（CDP 里实测：活动出现
 * 后 7 秒才亮，那时调用早结束了）。
 *
 * 为什么敢降到 1.5s：有活动时本来就是 1000ms，本地同源 GET 的量级可以忽略；
 * 而这条路由的语义是「此刻在不在操作浏览器」，是瞬时状态，保活期比活动期还慢
 * 一倍多本身就是错的取舍。
 */
export const SLOW_POLL_MS = 1500

/** 连续多少次无活动后降速。 */
export const IDLE_ROUNDS_BEFORE_SLOW = 3

/** window 上的调试/预览入口名（给冒烟与演示用）。 */
export const BROWSER_FLAG_PREVIEW_KEY = '__dshBrowserFlagPreview'

/**
 * 浏览器工具判据里的提示词（与 host 半身 src/browser-activity/tools.ts 同一份）。
 *
 * 客户端这份不参与显示决策（显示只看路由回包），但口径必须与 host 逐字一致：
 * 预览灌入与冒烟都走它，两边不一致就会出现「预览亮、真实数据不亮」这种只能
 * 靠肉眼撞见的差异。
 */
const BROWSER_TOOL_HINTS: readonly string[] = [
  'playwright', 'browser', 'chrome', 'devtools', 'stagehand', 'ego', 'puppeteer', 'selenium', 'cdp',
  'browseros', 'browserbase',
]

/**
 * 复合词前缀匹配的最短词长（与 host 的 BROWSER_ACTIVITY_COMPOUND_MIN 同值）。
 *
 * BrowserOS 的 MCP server 叫 browseros_neo、Browserbase 叫 browserbase —— 都是
 * 「关键词 + 后缀」的一个单词，词元精确匹配认不出。阈值 6 保证够长的词才能做
 * 前缀匹配，ego(3) / cdp(3) 这类短词仍走精确匹配，不会误伤 egos、cdpx。
 */
const BROWSER_TOOL_COMPOUND_MIN = 6

/** 直接按前缀命中的工具名（playwright-mcp 的旧命名不在 mcp__<service>__<tool> 里）。 */
const BROWSER_TOOL_NAME_PREFIX = 'mcp__playwright-mcp__'

/** host 回包里的一个会话活动条目（字段名与契约逐字一致）。 */
export interface BrowserActivitySession {
  readonly sessionId: string
  /** 仍在进行中的调用数。 */
  readonly active: number
  /** 工具名 mcp__<service>__<tool> 的第二段。 */
  readonly service: string
  /** 第三段起的部分。 */
  readonly tool: string
  /** 最早一次仍在进行（或尾迹中那一次）调用的开始时间。 */
  readonly since: number
  /** 最近一次调用的开始时间。 */
  readonly lastAt: number
  /** 最后一次调用结束后 1500ms 内的尾迹（避免连续调用之间图标闪烁）。 */
  readonly lingering: boolean
}

/** 对外快照（useSyncExternalStore 的 getSnapshot 必须返回稳定引用）。 */
export interface BrowserFlagSnapshot {
  /** sessionId → 活动条目；只在真正变化时整张替换。 */
  readonly bySession: ReadonlyMap<string, BrowserActivitySession>
  /** 当前显示的会话表来自 window 预览而不是路由。 */
  readonly preview: boolean
}

const EMPTY_SNAPSHOT: BrowserFlagSnapshot = { bySession: new Map(), preview: false }

/** 按分隔符与 camelCase 切成小写词元（playwright-mcp → [playwright, mcp]）。 */
function tokensOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token !== '')
}

/**
 * 判据：工具名是不是浏览器工具（纯函数，与 host 半身逐字对齐）。
 *
 * 形如 mcp__<service>__<tool>，且 service 或 tool **词元**命中提示词之一；
 * 另外保留 mcp__playwright-mcp__ 前缀命中。
 *
 * 为什么是词元精确匹配而不是裸 includes：提示词表里有 ego / cdp 这类短词，
 * 裸子串匹配会把 mcp__x__list_categories（categories 里藏着 ego）判成浏览器
 * 工具 —— 用户看到一枚点亮却无从解释的图标。
 */
export function isBrowserToolName(name: unknown): boolean {
  if (typeof name !== 'string') return false
  const raw = name.trim()
  if (raw === '') return false
  if (raw.startsWith(BROWSER_TOOL_NAME_PREFIX)) return true
  const parts = raw.split('__')
  if (parts.length < 3 || parts[0] !== 'mcp') return false
  const service = (parts[1] ?? '').trim()
  const tool = parts.slice(2).join('__').trim()
  if (service === '' || tool === '') return false
  const tokens = new Set([...tokensOf(service), ...tokensOf(tool)])
  return BROWSER_TOOL_HINTS.some(hint => tokens.has(hint) || tokenIsCompoundOf(tokens, hint))
}

/** tokens 里是否有某个词元是 hint 的复合词（仅对够长的 hint 生效）。 */
function tokenIsCompoundOf(tokens: ReadonlySet<string>, hint: string): boolean {
  if (hint.length < BROWSER_TOOL_COMPOUND_MIN) return false
  for (const token of tokens) {
    if (token.length > hint.length && token.startsWith(hint)) return true
  }
  return false
}

/** 数字字段的容错读取：非有限数一律 0（脏数据不该让整条记录消失）。 */
function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** active 计数：负数与非数字归零。 */
function toCount(value: unknown): number {
  const n = toNumber(value)
  return n > 0 ? Math.floor(n) : 0
}

/** 一条原始记录 → 活动条目；缺 sessionId 的记录直接丢弃。 */
function normalizeEntry(item: unknown): BrowserActivitySession | null {
  if (item === null || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : ''
  if (sessionId === '') return null
  return {
    sessionId,
    active: toCount(raw.active),
    service: typeof raw.service === 'string' ? raw.service : '',
    tool: typeof raw.tool === 'string' ? raw.tool : '',
    since: toNumber(raw.since),
    lastAt: toNumber(raw.lastAt),
    lingering: raw.lingering === true,
  }
}

/**
 * 解析一次路由回包。
 *
 * @returns 条目数组（无活动时是空数组）；回包不可用（ok 不为 true、形状坏、
 *          根本不是对象）时返回 null —— 调用方据此决定「当无活动」而不是
 *          「数据是空的」，两者在预览态下的处理不同。
 */
export function parseBrowserActivity(payload: unknown): BrowserActivitySession[] | null {
  if (payload === null || typeof payload !== 'object') return null
  const record = payload as { ok?: unknown; sessions?: unknown }
  if (record.ok !== true) return null
  const list = record.sessions
  if (!Array.isArray(list)) return null
  const out: BrowserActivitySession[] = []
  for (const item of list) {
    const entry = normalizeEntry(item)
    // 服务端只输出「有活动或有尾迹」的会话，这里再筛一次是防脏数据：
    // 一条 active 与 lingering 都为假的记录会让图标常驻不灭。
    if (entry !== null && sessionFlagVisible(entry)) out.push(entry)
  }
  return out
}

/** 该条目是否该显示标志（类型守卫：调用方拿到的是非空条目）。 */
export function sessionFlagVisible(
  entry: BrowserActivitySession | null | undefined,
): entry is BrowserActivitySession {
  if (entry === null || entry === undefined) return false
  return entry.active > 0 || entry.lingering === true
}

/** 条目里可读的工具名：tool 优先，退到 service，都没有则空串。 */
function toolOrService(entry: BrowserActivitySession | null | undefined): string {
  if (entry === null || entry === undefined) return ''
  const tool = entry.tool.trim()
  if (tool !== '') return tool
  return entry.service.trim()
}

/** 悬浮说明里的那一段工具名（空串 = 不渲染这一段）。 */
export function browserFlagToolLabel(entry: BrowserActivitySession | null | undefined): string {
  return toolOrService(entry)
}

/** 一行文案：行标记的悬浮说明与调试预览共用同一种拼法。 */
export function browserFlagTitle(entry: BrowserActivitySession | null | undefined): string {
  const tool = toolOrService(entry)
  return tool === '' ? '浏览器操作中' : `浏览器操作中 · ${tool}`
}

// ── 快照与订阅 ───────────────────────────────────────────────────────────

let snapshot: BrowserFlagSnapshot = EMPTY_SNAPSHOT

/** 当前显示的数据是否来自 window 预览（尚未被真实活动覆盖）。 */
let previewActive = false

const listeners = new Set<() => void>()

/** 取当前快照（useSyncExternalStore 的 getSnapshot）。 */
export function getBrowserFlagSnapshot(): BrowserFlagSnapshot {
  return snapshot
}

/** 订阅快照变化（useSyncExternalStore 的 subscribe）。 */
export function subscribeBrowserFlag(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 便捷读法：某个会话的活动条目（无则 undefined）。 */
export function getBrowserFlagEntry(sessionId: string | undefined): BrowserActivitySession | undefined {
  if (sessionId === undefined || sessionId === '') return undefined
  return snapshot.bySession.get(sessionId)
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('[browser-flag] listener error', error)
    }
  }
}

/**
 * 比较两张会话表是否同内容。
 *
 * 为什么要逐字段比：路由每秒回一次包，条目对象每次都是新造的。不比内容的话
 * 每次轮询都会换快照 → 行标记每秒重扫一次，还会把 MutationObserver 的
 * 「有变化」信号淹没在噪声里。
 */
function sameSessions(
  a: ReadonlyMap<string, BrowserActivitySession>,
  b: ReadonlyMap<string, BrowserActivitySession>,
): boolean {
  if (a.size !== b.size) return false
  for (const [id, left] of a) {
    const right = b.get(id)
    if (right === undefined) return false
    if (left.active !== right.active) return false
    if (left.service !== right.service) return false
    if (left.tool !== right.tool) return false
    if (left.since !== right.since) return false
    if (left.lastAt !== right.lastAt) return false
    if (left.lingering !== right.lingering) return false
  }
  return true
}

/** 发布一张新会话表（没变化就什么都不做）。 */
function publishSessions(next: ReadonlyMap<string, BrowserActivitySession>): void {
  if (snapshot.preview === previewActive && sameSessions(snapshot.bySession, next)) return
  snapshot = { bySession: next, preview: previewActive }
  notify()
}

/** 条目数组 → 会话表。 */
function toSessionMap(list: readonly BrowserActivitySession[]): Map<string, BrowserActivitySession> {
  const map = new Map<string, BrowserActivitySession>()
  for (const entry of list) map.set(entry.sessionId, entry)
  return map
}

/**
 * 灌入一份预览数据（window 调试入口的实现）。
 *
 * @param payload - 会话条目数组（形状同路由 sessions 项）；null 表示清空。
 * @returns 当前快照里的会话数（CDP 里调用后可直接看到结果）。
 */
export function ingestPreviewSessions(payload: unknown): number {
  if (payload === null) {
    previewActive = false
    publishSessions(new Map())
    return 0
  }
  // 与路由回包走同一个解析器：预览数据的容错口径必须和真实数据一致，
  // 否则「预览能显示、真实数据不显示」这种差异会被误判成 host 的 bug。
  const parsed = parseBrowserActivity({ ok: true, sessions: payload })
  if (parsed === null) return snapshot.bySession.size
  previewActive = true
  publishSessions(toSessionMap(parsed))
  return parsed.length
}

/** 页面是否不可见（不可见时完全不请求）。 */
function pageHidden(): boolean {
  if (typeof document === 'undefined') return false
  if (document.visibilityState === 'hidden') return true
  return document.hidden === true
}

// ── 轮询 ─────────────────────────────────────────────────────────────────

/** 拉一次活动路由。失败（网络 / 404 / 非 ok / 回包坏）一律返回 null。 */
export async function fetchBrowserActivity(fetchImpl?: typeof fetch): Promise<BrowserActivitySession[] | null> {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
  if (doFetch === undefined) return null
  try {
    const res = await doFetch(BROWSER_ACTIVITY_ROUTE, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (res === undefined || res === null || res.ok !== true) return null
    return parseBrowserActivity(await res.json())
  } catch {
    return null
  }
}

let running = false
let inFlight = false
let idleRounds = 0
let timer: ReturnType<typeof setTimeout> | null = null
let visibilityBound = false

function schedule(delayMs: number): void {
  if (!running || timer !== null) return
  timer = setTimeout(() => {
    timer = null
    void tick()
  }, delayMs)
}

/** 一次轮询：拉数据 → 发布 → 按活动情况决定下一次的间隔。 */
async function tick(): Promise<void> {
  if (!running || inFlight) return
  // 不可见时不请求、也不排期：等 visibilitychange 把节奏接回来。
  if (pageHidden()) return
  inFlight = true
  let list: BrowserActivitySession[] | null = null
  try {
    list = await fetchBrowserActivity()
  } finally {
    inFlight = false
  }
  if (!running) return

  const hasActivity = list !== null && list.length > 0
  if (hasActivity) {
    idleRounds = 0
    // 真实活动优先：预览数据到此让位（用户手动灌的演示不该盖住真实状态）。
    previewActive = false
    publishSessions(toSessionMap(list as BrowserActivitySession[]))
  } else if (list !== null) {
    // 回包可用但没有活动。预览态下保留预览 —— 否则 host 已挂的环境里
    // 「预览」会被 1 秒后的空回包清掉，那个演示入口就等于不存在。
    idleRounds += 1
    if (!previewActive) publishSessions(new Map())
  } else {
    // 回包不可用（host 没挂 / 404 / 网络断）：同样当无活动处理，只是不覆盖预览。
    idleRounds += 1
    if (!previewActive) publishSessions(new Map())
  }

  schedule(idleRounds >= IDLE_ROUNDS_BEFORE_SLOW ? SLOW_POLL_MS : FAST_POLL_MS)
}

/** 页面回到可见：清掉降速状态并立刻拉一次（不等保活计时器）。 */
function onVisibilityChange(): void {
  if (!running || pageHidden()) return
  idleRounds = 0
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  void tick()
}

/**
 * 启动全局轮询器。幂等（重复调用只绑一次）。
 *
 * 起步用 0ms 排期而不是直接 await：apply() 里同步发请求会把首帧拖慢，
 * 而这枚标志本来就不急那一帧。
 */
export function startBrowserActivityPolling(): void {
  if (running) return
  running = true
  idleRounds = 0
  if (!visibilityBound && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    visibilityBound = true
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (pageHidden()) return
  schedule(0)
}

/** 停止轮询（测试与卸载用）。 */
export function stopBrowserActivityPolling(): void {
  running = false
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/**
 * 清空活动快照（功能总开关关闭时用）。
 *
 * 只停轮询不够：快照里最后一批活动会让操作面板卡头的浏览器图标继续亮着，
 * 看起来像「开关拨了没反应」。清空并通知订阅者，图标立刻熄灭。
 * 预览数据也一并清掉（否则 window 调试入口灌的数据会挂着不灭）。
 */
export function resetBrowserActivitySnapshot(): void {
  previewActive = false
  publishSessions(new Map())
}

/**
 * 挂 window 调试入口：灌一份会话数组即可在页面上看到标志与动效。
 *
 * 只挂 window、只写快照，不动轮询器 —— 真实活动出现时以路由数据为准覆盖。
 */
export function mountBrowserFlagPreview(): void {
  if (typeof window === 'undefined') return
  const host = window as unknown as Record<string, unknown>
  host[BROWSER_FLAG_PREVIEW_KEY] = (payload: unknown): number => {
    try {
      return ingestPreviewSessions(payload)
    } catch (error) {
      console.warn('[dsh-chat-plus] 浏览器标志预览灌入失败：', error)
      return snapshot.bySession.size
    }
  }
}

/** 撤掉 window 调试入口（功能总开关关闭时用，避免预览数据绕过开关点亮图标）。 */
export function unmountBrowserFlagPreview(): void {
  if (typeof window === 'undefined') return
  try {
    delete (window as unknown as Record<string, unknown>)[BROWSER_FLAG_PREVIEW_KEY]
  } catch { /* 忽略删除失败 */ }
}
