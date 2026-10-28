/**
 * dsh-chat-plus — 对话完成胶囊（host 半身，done-pill 模块）。
 *
 * 移植自 dsh-webui 的 done-pill（_tmp-webui/src/done-pill.ts），拆分为独立
 * 插件；行为与数据契约保持原样，仅路由改为本插件私有路径（避免与 webui
 * 同时安装时 webServer.register 重复路径抛错）。
 *
 * 全局监听 `session/event`（含后台会话）：任一会话 turn/end 时提取
 *   - 会话标题（session/title 事件 > cwd basename > session id）
 *   - 触发回合的用户问题（回合内最后一条真人 user/message 的文本）
 *   - 助手回复全文（本回合 assistant/message 的 text 块按序拼接）
 * 存入内存完成列表（最近 MAX_ITEMS 条，seq 单调递增）。
 * GET /api/dsh-done-pill?since=N 供前端轮询增量（items = seq > N，升序）。
 *
 * 设计约束：
 *  - 只报非 subagent 会话（header.origin === 'subagent' 跳过）；
 *  - aborted 回合不算完成（用户主动停止）；
 *  - 最小服务契约（webui 同款做法），不引入 dsh-session 类型依赖。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

const ROUTE = '/api/dsh-done-pill'
/** 热区状态上报路由（client POST → host 经壳子 CDP 注入壳页面）。 */
const HOT_ROUTE = '/api/dsh-done-pill/shell-hot'
/**
 * 系统通知派发路由（client POST → host 经壳页面弹原生通知）。
 * 壳页面侧点击通知后把 sessionId POST 回 `NOTIFY_CLICK_PATH`。
 */
const NOTIFY_ROUTE = '/api/dsh-done-pill/notify'
const NOTIFY_CLICK_PATH = '/api/dsh-done-pill/notify-click'
/** 等壳页面回执的超时（ms）：超时按「没弹出来」处理，让 client 回落页内卡。 */
const NOTIFY_TIMEOUT_MS = 2500
/** 通知标题/正文上限（防止 CDP expression 过长）。 */
const MAX_NOTIFY_TITLE = 120
const MAX_NOTIFY_BODY = 400
/** 提示音在壳页面里的播放音量（0~1）。 */
const NOTIFY_VOLUME = 0.55
/** 提示音的静态资源路径（本插件 sfx 路由，见 done-pill/sfx.ts）。 */
const SFX_PATH = '/api/chat-flow/sfx/task-done.wav'
/** 内存完成列表上限。 */
const MAX_ITEMS = 50
/** 单条问题/回复文本上限（超出截断加省略号；本地回传足够展示全文）。 */
const MAX_TEXT_CHARS = 20000

// ── 最小服务契约 ────────────────────────────────────────────────────────────

interface SessionLike {
  id: string
  header?: { cwd?: string; origin?: string }
  events?: readonly SessionEventLike[]
}

interface SessionEventLike {
  type: string
  seq: number
  data?: {
    turn?: number
    title?: unknown
    reason?: { kind?: unknown }
    message?: { content?: unknown }
    content?: unknown
    source?: { kind?: unknown }
  }
}

/**
 * 事件日志访问：DSH 0.1.2+ 的 Session 已把事件日志私有化，只暴露
 * `snapshotEvents()`（旧版直接暴露 `events` 数组）——读取两者兼容，
 * 任一不可用时回退空数组（v0.2.5 修复：旧实现读 `session.events`
 * 恒为空，完成条目全部被「空回合」跳过，提示不出现）。
 */
function eventsOf(session: SessionLike): readonly SessionEventLike[] {
  const candidate = session as SessionLike & { snapshotEvents?: () => unknown }
  if (typeof candidate.snapshotEvents === 'function') {
    try {
      const snapshot = candidate.snapshotEvents()
      if (Array.isArray(snapshot)) return snapshot as readonly SessionEventLike[]
    } catch { /* 快照失败按空处理 */ }
    return []
  }
  return session.events ?? []
}

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
  /** 监听端口（webServer 服务暴露；缺省时提示音 URL 回落到 3080）。 */
  port?: number
}

// ── 壳子顶栏热区让位（CDP applier）────────────────────────────────────────
// client 把胶囊热区状态 POST 到 HOT_ROUTE；这里经壳子的 CDP 调试端口
// （端口见 DSH_SHELL_CDP_PORT_FILE 环境变量或会话 cwd 的 .shell-cdp-port，壳子 main.js 启动时写入）把状态
// 注入壳页面：拖拽带 #drag-strip 在胶囊矩形范围内穿透（pointer-events:
// none），光标离开/胶囊移开自动恢复。壳子未运行（纯浏览器访问 WebUI）
// 或老版本壳子（无 setupShellHotZone 钩子）时静默降级，胶囊不受影响。

/** 热区状态（client 上报体）。 */
interface HotState {
  over: boolean
  rects: Array<{ x: number; y: number; w: number; h: number }>
}

/** 经壳页面派发的一条系统通知（标题/正文由 client 截断好）。 */
interface NotifyPayload {
  title: string
  body: string
  /** 通知中心合并键：同一 tag 的新通知替换旧卡片，不堆一屏。 */
  tag: string
  /** 点击通知后要进入的会话 id（壳页面回传给 host）。 */
  sessionId: string
}

/** 与壳子的连接：ws + 心跳 + 状态驱动的单飞发送 + 通知派发。 */
interface ShellConn {
  /** 发送一次状态（失败自动按壳子不在处理）；立即返回，不阻塞路由。 */
  send: (state: HotState) => void
  /** 在壳页面里弹一条系统通知；true = 已真的交给通知中心。 */
  notify: (payload: NotifyPayload) => Promise<boolean>
  close: () => void
}

/** 读壳子 CDP 端口；读不到/未写盘（壳子不在）返回 null。 */
function readShellCdpPort(): number | null {
  const candidates: string[] = []
  const fromEnv = process.env.DSH_SHELL_CDP_PORT_FILE
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') candidates.push(fromEnv.trim())
  candidates.push(join(process.cwd(), '.shell-cdp-port'))
  // 包位置向上两级：<工作区>/dsh-chat-plus/lib/index.js → <工作区>/.shell-cdp-port。
  // 壳子把这个文件写在**工作区根**，而 DSH 启动脚本的 cwd 是 dsh-runtime，
  // 只靠 cwd 会读不到（表现为胶囊贴顶时点不到，壳子拖拽带吞掉上半段）。
  try {
    candidates.push(fileURLToPath(new URL('../../.shell-cdp-port', import.meta.url)))
  } catch { /* 非 file:// 上下文（单测里用 data: URL 等）：跳过该候选 */ }
  for (const file of candidates) {
    try {
      const raw = readFileSync(file, 'utf8').trim()
      const port = Number(raw)
      if (Number.isInteger(port) && port > 0 && port < 65536) return port
    } catch { /* 候选文件不存在：试下一个 */ }
  }
  return null
}

/** 浏览器风格 WebSocket 的最小面（Node ≥22 全局内置）。 */
interface WebSocketLike {
  addEventListener(type: 'open' | 'error' | 'close' | 'message', fn: (event?: { data?: unknown }) => void): void
  send(data: string): void
  close(): void
}

/** 拉取壳子（主框架页面）的 CDP target 列表；壳子不在返回 null。 */
async function fetchShellTargets(port: number): Promise<Array<{ id: string; type: string; url?: string }> | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const list = (await res.json()) as Array<{ id: string; type: string }>
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

/**
 * 建立与壳页面的 CDP 会话（全局 WebSocket，Node ≥22 内置）。
 * 做两件事：
 *  1. 把热区状态写进壳页面（`window.__dshPillHot`）并驱动 #drag-strip 的穿透类切换；
 *  2. 在壳页面里弹**系统通知 / 桌面浮窗**（见 notify）。提示音不在这里播——
 *     改由 Web 端本页发声，壳子再响一次就是双声。
 * 壳页面侧由首次连接时注入的幂等补丁承接。
 *
 * 为什么通知要绕道壳页面：壳页面用 iframe 承载 WebUI，而 topbar.html 的
 * iframe **没有** `allow="notifications"`（Permissions Policy 默认不允许），
 * 所以 WebUI 文档里 `new Notification()` 在壳内会被拦掉——系统通知只能由
 * 壳页面（file:// 顶层）自己的上下文发出。纯浏览器访问 WebUI 时走不到这里，
 * client 侧会走原生 Notification（见 client/notify-center.ts）。
 *
 * @param port - 壳子的 CDP 端口（连 ws 用）。
 * @param webPort - DSH web 端口。提示音 URL 必须用它：topbar.html 的 CSP 是
 *   `media-src 'self' http://127.0.0.1:<webPort>`，用 CDP 端口会被 CSP 拦掉
 *   （NotSupportedError，且 play() 的 rejection 被吞 → 静默没声音，真机踩过）。
 * @param sfxUrl - 已经拼好的提示音 URL（由调用方按 webPort 构造）。
 *   **当前无调用方**：提示音已改由 Web 端播，壳页面 sfx 通道保留为可选能力。
 */
async function connectShell(
  port: number,
  targetId: string,
  sfxUrl: string,
  onDead: () => void,
): Promise<ShellConn | null> {
  const WS = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket
  if (typeof WS !== 'function') return null
  const ws = new WS(`ws://127.0.0.1:${port}/devtools/page/${targetId}`)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close() } catch { /* 忽略 */ } reject(new Error('cdp ws handshake timeout')) }, 2000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp ws error')) })
  })
  let seq = 0

  /** 在壳页面主世界执行一段 JS（发后即忘；状态上报允许丢帧）。 */
  function evalInShell(expression: string): void {
    const id = ++seq
    try {
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: false } }))
    } catch { /* ws 已断：close 统一清理 */ }
  }

  /**
   * 带回执执行：等 CDP 的 Runtime.evaluate 结果（通知必须知道到底弹没弹出来，
   * 好回话给 client 决定是否回落到页内卡）。超时按失败处理，不无限等。
   */
  const pending = new Map<number, (value: { ok: boolean; detail: string }) => void>()
  function evalInShellAwait(expression: string, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
      const id = ++seq
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, detail: 'cdp timeout' })
      }, timeoutMs)
      pending.set(id, (value) => { clearTimeout(timer); resolve(value) })
      try {
        ws.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }))
      } catch {
        clearTimeout(timer)
        pending.delete(id)
        resolve({ ok: false, detail: 'cdp send failed' })
      }
    })
  }

  ws.addEventListener('message', (event?: { data?: unknown }) => {
    const raw = event?.data
    if (typeof raw !== 'string') return
    let frame: { id?: unknown; result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }
    try { frame = JSON.parse(raw) as typeof frame } catch { return }
    const id = typeof frame.id === 'number' ? frame.id : -1
    const waiter = pending.get(id)
    if (waiter === undefined) return
    pending.delete(id)
    if (frame.result?.exceptionDetails !== undefined) {
      waiter({ ok: false, detail: 'shell evaluate threw' })
      return
    }
    const value = frame.result?.result?.value
    // ⚠ 壳页面的补丁返回的是 Promise，而 `awaitPromise: true` 会让 CDP 直接把它
    // **解包成对象**（不是 JSON 字符串）。曾经按字符串 JSON.parse，于是每次都走
    // 「不是字符串」分支判失败——表现是系统通知永远 dispatched:false，宿主侧零报错。
    // 所以这里两种形态都要认：对象（已解包）与字符串（未解包/旧壳子）。
    let parsed: unknown = value
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value) } catch { waiter({ ok: false, detail: 'shell reply not json' }); return }
    }
    if (parsed === null || typeof parsed !== 'object') {
      waiter({ ok: false, detail: 'shell reply not an object' })
      return
    }
    const reply = parsed as { ok?: unknown; detail?: unknown }
    waiter({ ok: reply.ok === true, detail: typeof reply.detail === 'string' ? reply.detail : '' })
  })

  /**
   * 壳页面补丁（幂等）：注入穿透类样式 + 在 window 上挂状态对象。
   * 老版本壳子没有 #drag-strip 时只挂对象不注入（applyState 自然 no-op）。
   */
  /**
   * 壳页面补丁（幂等）：穿透样式 + 状态对象 + 壳侧命中试探。
   * 壳侧 mousemove 只在拖拽带自身上触发（iframe 区域的事件不冒泡到壳
   * 文档），用于「光标从侧方直接进入胶囊被覆盖的上半段」的首次接触——
   * 命中已上报矩形即点亮穿透，下一个事件起 WebUI 文档接管判断。
   */
  const SHELL_HOT_PATCH = `
(function () {
  var w = window
  var mod = w.__dshPillHot || (w.__dshPillHot = { state: { over: false, rects: [] } })
  if (mod.ready) return
  mod.ready = true
  var strip = document.getElementById('drag-strip')
  if (strip !== null) {
    var style = document.createElement('style')
    style.id = 'dsh-pill-hot-style'
    style.textContent = '#drag-strip.dsh-pill-hot{pointer-events:none !important;-webkit-app-region:no-drag !important;}'
    document.head.appendChild(style)
    strip.addEventListener('mousemove', function (e) {
      var m = window.__dshPillHot
      if (!m || !m.ready) return
      var hit = (m.state.rects || []).some(function (r) {
        return e.clientX >= r.x && e.clientX < r.x + r.w && e.clientY >= r.y && e.clientY < r.y + r.h
      })
      strip.classList.toggle('dsh-pill-hot', hit)
    }, true)
  }
  mod.strip = function () { return document.getElementById('drag-strip') }
})()`

  evalInShell(SHELL_HOT_PATCH)

  /**
   * 通知补丁（幂等）：在壳页面挂
   * `window.__dshNotify.call(title, body, tag, sessionId)` 与 `window.__dshNotify.sfx(url)`。
   *
   * 壳页面是 file:// 顶层文档，`new Notification()` 在这里才不受 iframe 的
   * Permissions Policy 限制（topbar.html 的 iframe 没有 allow="notifications"，
   * WebUI 文档里直接 new Notification 会被拦）。要点：
   *  - permission 为 default 时先 requestPermission()（壳子 main.js 的
   *    setPermissionCheckHandler 已放行 notifications）；
   *  - 点击通知：window.focus() 唤起窗口，并 POST 回
   *    `/api/dsh-done-pill/notify-click`（topbar.html 的 CSP connect-src 已含
   *    http://127.0.0.1:3080），host 记下待跳转会话，客户端下一轮轮询即跳过去；
   *  - 失败不抛：把原因放进 ok:false 的返回值，由 host 转告 client 回落页内卡。
   *
   * `sfx(url)`：在壳页面播提示音。**当前无调用方**——提示音改由 Web 端本页播
   * （内嵌应用自己会响，壳子再响就是双声），此处保留为壳页面可选能力。历史理由：
   * WebUI 在跨源 iframe 里，自动播放策略会拦掉「无用户手势的 iframe 播放」，而壳
   * 页面是顶层文档、不受该限制（实测壳页面里 `new Audio()` 可直接 play()）。
   * 音频 URL 由 host 拼好（插件自己的 /mp/sfx/* 静态路由），不在补丁里硬编码。
   */
  const notifyPatch = `
(function () {
  var w = window
  var mod = w.__dshNotify || (w.__dshNotify = {})
  if (mod.ready) return
  mod.ready = true
  var base = ${JSON.stringify(`http://127.0.0.1:${port}`)}
  var click = ${JSON.stringify(NOTIFY_CLICK_PATH)}
  mod.sfx = function (url) {
    try {
      if (typeof url !== 'string' || url === '') return false
      var a = mod.audio || (mod.audio = new w.Audio())
      // 换源重播：连续完成时同一元素重头播，不叠加多个 Audio 实例。
      try { a.pause() } catch (e) { /* 未播放过 */ }
      a.currentTime = 0
      a.volume = ${JSON.stringify(NOTIFY_VOLUME)}
      a.src = url
      var p = a.play()
      if (p && typeof p.catch === 'function') {
        // ⚠ 播放失败**必须留痕**：play() 的 rejection 曾经被完全吞掉，于是
        // CSP 拦掉音频源（NotSupportedError）时表现为「静默没声音」，宿主侧
        // 也看不到任何线索，排查花了两轮。现在把原因记进 mod.lastSfxError，
        // 排查时可在壳页面里直接读。
        p.then(function () { mod.lastSfxError = null }).catch(function (e) {
          mod.lastSfxError = String((e && e.name) || '') + ': ' + String((e && e.message) || e)
        })
      }
      return true
    } catch (e) {
      mod.lastSfxError = String(e)
      return false
    }
  }
  mod.call = function (title, body, tag, sessionId) {
    return new Promise(function (resolve) {
      try {
        // ── 桌面浮窗（首选）──────────────────────────────────────────────
        // 壳子主进程开的桌面浮窗不受 Windows 通知设置影响（实测 ToastEnabled=0
        // 或专注助手全局静音时，系统通知不报错但根本不显示），所以**优先**走它。
        // 壳页面在 window 上挂了 __dshShellToast（见 .shell-src/renderer.js）。
        var shellToast = w.__dshShellToast
        if (shellToast && typeof shellToast.show === 'function') {
          try {
            Promise.resolve(shellToast.show({
              title: String(title),
              // 桌面浮窗的正文用 body 的第一行（问题），meta 放剩余信息
              text: String(body || '').split('\\n')[0] || '',
              meta: String(body || '').split('\\n').slice(1).join(' ').trim(),
              kind: /出错/.test(String(title)) ? 'error' : 'done',
              sessionId: String(sessionId || ''),
            })).then(function (accepted) {
              if (accepted === true) { resolve({ ok: true, detail: 'desktop-toast' }); return }
              fireSystem()
            }, function () { fireSystem() })
          } catch (e) { fireSystem() }
          return
        }
        fireSystem()

        // ── 系统通知（浮窗不可用时的回落）────────────────────────────────
        function fireSystem() {
          if (typeof w.Notification !== 'function') {
            resolve({ ok: false, detail: 'shell page has no Notification' })
            return
          }
          var fire = function () {
            try {
              var n = new w.Notification(String(title), { body: String(body), tag: String(tag || 'dsh-done') })
              n.onclick = function () {
                try { w.focus() } catch (e) { /* 唤起失败不影响跳转 */ }
                try {
                  fetch(base + click, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ sessionId: String(sessionId || '') }),
                  }).catch(function () {})
                } catch (e) { /* 服务不可达：只唤起窗口 */ }
              }
              resolve({ ok: true, detail: 'system-notification' })
            } catch (e) {
              resolve({ ok: false, detail: String(e) })
            }
          }
          if (w.Notification.permission === 'granted') { fire(); return }
          if (w.Notification.permission === 'denied') {
            resolve({ ok: false, detail: 'permission denied' })
            return
          }
          w.Notification.requestPermission().then(function (p) {
            if (p === 'granted') fire()
            else resolve({ ok: false, detail: 'permission ' + String(p) })
          }, function () { resolve({ ok: false, detail: 'requestPermission failed' }) })
        }
      } catch (e) {
        resolve({ ok: false, detail: String(e) })
      }
    })
  }
  // 桌面浮窗被点击后，壳页面把会话 id 送进来（见 renderer.js 的 shell:open-session）；
  // 壳页面调这个入口把跳转交回 WebUI 侧的插件处理（含失败提示条）。
  mod.openSession = function (sessionId) {
    try {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      fetch(base + click, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId }),
      }).catch(function () {})
      return true
    } catch (e) {
      return false
    }
  }
})()`

  evalInShell(notifyPatch)

  let lastSig = ''
  function applyState(state: HotState): void {
    const sig = JSON.stringify(state)
    if (sig === lastSig) return
    lastSig = sig
    // 穿透完全由 client 侧状态驱动：壳页面在 iframe 区域收不到 mousemove
    //（事件不跨文档冒泡），壳侧自行探测永远慢一拍——over 标志由看得见
    // 胶囊的那一端（WebUI 文档）算好推过来，壳侧只做类切换。
    evalInShell(`(function () {
  var mod = window.__dshPillHot
  if (!mod || !mod.ready) return
  mod.state = ${sig}
  var strip = mod.strip ? mod.strip() : null
  if (strip !== null) strip.classList.toggle('dsh-pill-hot', ${state.over ? 'true' : 'false'})
})()`)
  }

  ws.addEventListener('close', onDead)
  ws.addEventListener('error', () => { try { ws.close() } catch { /* 忽略 */ } })

  return {
    send(state) { applyState(state) },
    notify(payload) {
      // 壳子后台不需要每次都响一下（Web 端已自行播放提示音，避免响两次）。
      // 这里仅向壳页面派发桌面浮窗/系统通知，并等待回执。
      const expression = `window.__dshNotify.call(${JSON.stringify(payload.title)}, ${JSON.stringify(payload.body)}, ${JSON.stringify(payload.tag)}, ${JSON.stringify(payload.sessionId)})`
      return evalInShellAwait(expression, NOTIFY_TIMEOUT_MS)
        .then(result => result.ok)
        .catch(() => false)
    },
    close() {
      try { applyState({ over: false, rects: [] }) } catch { /* 忽略 */ }
      try { ws.close() } catch { /* 忽略 */ }
    },
  }
}

/** 壳子热区连接管理 + 系统通知派发：懒连接、断线重连、失败冷却。 */
function createShellHotZone(webPort: number): {
  handle: (state: HotState) => void
  notify: (payload: NotifyPayload) => Promise<boolean>
  stop: () => void
} {
  const SHELL_RETRY_MS = 5000
  // 提示音 URL 用 **web 端口**：topbar.html 的 CSP media-src 只放行它。
  // 用 CDP 端口会被 CSP 拦成 NotSupportedError（真机踩过，静默没声音）。
  const sfxUrl = `http://127.0.0.1:${webPort}${SFX_PATH}`
  let conn: ShellConn | null = null
  let connecting: Promise<ShellConn | null> | null = null
  let retryAt = 0
  let stopped = false
  let pendingState: HotState | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  async function ensureConn(): Promise<ShellConn | null> {
    if (stopped) return null
    if (conn !== null) return conn
    if (connecting !== null) return connecting
    if (Date.now() < retryAt) return null
    connecting = (async () => {
      try {
        const port = readShellCdpPort()
        if (port === null) { retryAt = Date.now() + SHELL_RETRY_MS; return null }
        const targets = await fetchShellTargets(port)
        if (targets === null) { retryAt = Date.now() + SHELL_RETRY_MS; return null }
        // 只找主框架页面（topbar.html）；iframe/DevTools 等目标一律忽略。
        const page = targets.find(t => t.type === 'page' && t.url.includes('topbar.html'))
        if (page === undefined) { retryAt = Date.now() + SHELL_RETRY_MS; return null }
        const established = await connectShell(port, page.id, sfxUrl, () => {
          conn = null
          retryAt = Date.now() + SHELL_RETRY_MS
        })
        if (established === null) { retryAt = Date.now() + SHELL_RETRY_MS; return null }
        conn = established
        return established
      } catch {
        retryAt = Date.now() + SHELL_RETRY_MS
        return null
      } finally {
        connecting = null
      }
    })()
    return connecting
  }

  function flush(): void {
    flushTimer = null
    const state = pendingState
    pendingState = null
    if (state === null || stopped) return
    void ensureConn().then((c) => { c?.send(state) })
  }

  return {
    handle(state) {
      if (stopped) return
      pendingState = state
      if (flushTimer === null) flushTimer = setTimeout(flush, 80)
    },
    /**
     * 在壳页面弹一条系统通知。壳子不在（纯浏览器访问 WebUI）或壳页面
     * 没有 Notification 时返回 false，由调用方决定是否回落到页内卡。
     */
    async notify(payload) {
      if (stopped) return false
      const c = await ensureConn()
      if (c === null) return false
      return c.notify(payload)
    },
    stop() {
      stopped = true
      if (flushTimer !== null) clearTimeout(flushTimer)
      flushTimer = null
      conn?.close()
      conn = null
    },
  }
}
// ── 数据结构 ────────────────────────────────────────────────────────────────

export interface DonePillEntry {
  /** 单调递增序号（也是增量拉取水位）。 */
  seq: number
  /** 稳定 id（seq 字符串化，供前端去重/已读标记）。 */
  id: string
  sessionId: string
  /** 会话显示标题（title 事件 > cwd basename > id）。 */
  title: string
  /** 触发回合的用户问题文本（找不到真人消息时为空串）。 */
  question: string
  /** 本回合助手回复全文（text 块拼接）。 */
  answer: string
  /** 回合结束时间戳。 */
  endedAt: number
  /** 本回合耗时（ms）：turn/start → turn/end；拿不到开始时间时为 0。 */
  durationMs: number
  turn: number
  /** 结束原因 kind（error 时前端标注「出错结束」）。 */
  reasonKind: string
}

/** 内容块数组 → 纯文本（text 块取原文；image 等非文本块输出占位标记）。 */
function blocksToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const type = (block as { type?: unknown }).type
    if (type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    } else if (type === 'image') {
      parts.push('[图片]')
    }
  }
  return parts.join('\n').trim()
}

function clampText(text: string): string {
  return text.length <= MAX_TEXT_CHARS ? text : `${text.slice(0, MAX_TEXT_CHARS)}…`
}

/** cwd → 显示名（与 client displayTitleOf 同款规则：去尾分隔符取末段）。 */
function workspaceTitleOf(cwd: string): string {
  return cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

export function applyDonePillHost(ctx: Record<string, any>): void {
  const titles = new Map<string, string>()
  const items: DonePillEntry[] = []
  // 正在执行的回合：turn/start 时记录开始时间 + 触发消息（该会话最近的
  // 真人 user/message，steering 中途插话也跟随更新）+ 会话标题快照，
  // turn/end 移除（含 aborted）。供前端展示「正在执行的消息 + 实时时长」。
  // 服务重启后清零。subagent 回合不进表（与完成列表口径一致）。
  const runningTurns = new Map<string, { since: number; question: string; title: string }>()
  const lastQuestions = new Map<string, string>()
  const lastDoneTurnBySession = new Map<string, number>()
  // 壳页面点过通知、但客户端还没来取走的待跳转会话。同一时刻只留最新一条
  // （通知点击语义就是「去那条」），客户端 GET 时取走即清空。
  let pendingOpenSessionId: string | null = null
  // seq = 启动时间戳 + 计数器：进程内单调；重启后启动时间戳变大，
  // 新 seq 必然大于客户端在旧进程里见过的所有 seq（增量水位永不回绕卡死）。
  const seqBase = Date.now()
  let counter = 0

  /** 会话显示标题：缓存 title 事件 > 日志反查 > cwd basename > id。 */
  function titleOf(session: SessionLike): string {
    const cached = titles.get(session.id)
    if (cached !== undefined && cached !== '') return cached
    const events = eventsOf(session)
    for (let i = events.length - 1; i >= 0; i--) {
      const data = events[i]?.data
      if (events[i]?.type === 'session/title' && typeof data?.title === 'string' && data.title !== '') {
        titles.set(session.id, data.title)
        return data.title
      }
    }
    const cwd = session.header?.cwd
    if (typeof cwd === 'string' && cwd !== '') {
      const base = workspaceTitleOf(cwd)
      if (base !== '') return base
    }
    return session.id
  }

  /**
   * 反向扫描事件日志：收集本回合 assistant/message 文本（保持正序拼接），
   * 遇到第一条真人 user/message 记为触发问题后停止。
   */
  function extractTurnTexts(events: readonly SessionEventLike[], turn: number): { question: string; answer: string } {
    const answerParts: string[] = []
    let question = ''
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event === undefined) continue
      if (event.type === 'assistant/message') {
        if (event.data?.turn === turn) {
          const text = blocksToText(event.data.message?.content)
          if (text !== '') answerParts.push(text)
        }
        continue
      }
      if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
        question = clampText(blocksToText(event.data.content))
        break
      }
    }
    return { question, answer: clampText(answerParts.reverse().join('\n\n')) }
  }

  ctx.on('session/event', ((session: SessionLike, event: SessionEventLike) => {
    try {
      if (event.type === 'session/title') {
        if (typeof event.data?.title === 'string' && event.data.title !== '') {
          titles.set(session.id, event.data.title)
        }
        return
      }
      if (event.type === 'user/message') {
        // 真人消息（含 queued / steering）：记录为该会话最新触发消息；
        // 若回合已在执行中，同步刷新正在执行的消息展示。
        if (event.data?.source?.kind === 'user') {
          const text = clampText(blocksToText(event.data.content))
          if (text !== '') {
            lastQuestions.set(session.id, text)
            const running = runningTurns.get(session.id)
            if (running !== undefined) runningTurns.set(session.id, { ...running, question: text })
          }
        }
        return
      }
      if (event.type === 'turn/start') {
        if (session.header?.origin === 'subagent') return
        runningTurns.set(session.id, { since: Date.now(), question: lastQuestions.get(session.id) ?? '', title: titleOf(session) })
        return
      }
      if (event.type !== 'turn/end') return
      // 回合结束（含 aborted / subagent）都清除执行计时。
      const startedAt = runningTurns.get(session.id)?.since
      runningTurns.delete(session.id)
      lastQuestions.delete(session.id)
      if (session.header?.origin === 'subagent') return
      const reasonKind = typeof event.data?.reason?.kind === 'string' ? event.data.reason.kind : ''
      if (reasonKind === 'aborted') return
      const turn = typeof event.data?.turn === 'number' ? event.data.turn : -1
      if (turn >= 0) {
        if (lastDoneTurnBySession.get(session.id) === turn) return
        lastDoneTurnBySession.set(session.id, turn)
      }
      const events = eventsOf(session)
      const { question, answer } = extractTurnTexts(events, turn)
      // 空回合（无回复也无提问，例如纯斜杠命令回合）不值得上报。
      if (question === '' && answer === '') return
      counter += 1
      const seq = seqBase + counter
      // 耗时：优先用本回合的 turn/start 记录；服务重启/中途接入导致没有
      // 开始时间时为 0（客户端只按 0 跳过「耗时」那一段文案，不误报）。
      const endedAt = Date.now()
      const durationMs = startedAt === undefined ? 0 : Math.max(0, endedAt - startedAt)
      items.push({
        seq,
        id: String(seq),
        sessionId: session.id,
        title: titleOf(session),
        question,
        answer,
        endedAt,
        durationMs,
        turn,
        reasonKind,
      })
      if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-chat-plus] done-pill turn/end handling failed for ${session.id}: ${String(error)}`)
    }
  }) as never, { global: true })

  ctx.inject(['webServer'], (webCtx: any) => {
    const webServer = webCtx.webServer as WebServerService
    const webPort = typeof webServer?.port === 'number' && webServer.port > 0 ? webServer.port : 3080
    // 壳子顶栏热区让位：client POST 状态 → 这里经壳子 CDP 推给壳页面。
    const hotZone = createShellHotZone(webPort)

    webCtx.effect(() => {
      try {
        return webCtx.webServer.register({
          kind: 'exact',
          path: ROUTE,
          handler: (req, res) => {
            if (req.method !== 'GET') {
              res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
              return
            }
            let since = 0
            try {
              const url = new URL(req.url ?? '/', 'http://localhost')
              const raw = url.searchParams.get('since')
              if (raw !== null && /^\d+$/.test(raw)) since = Number(raw)
            } catch { /* since 解析失败按 0 处理 */ }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
            const openSessionId = pendingOpenSessionId
            // 取走即清空：通知点击只该被消费一次，避免每轮轮询反复跳转。
            pendingOpenSessionId = null
            res.end(JSON.stringify({
              ok: true,
              version: seqBase + counter,
              items: items.filter(item => item.seq > since),
              running: [...runningTurns.entries()].map(([sessionId, info]) => ({
                sessionId,
                since: info.since,
                question: info.question,
                title: info.title,
              })),
              ...(openSessionId === null ? {} : { openSessionId }),
            }))
          },
        })
      } catch (error) {
        // 路由可能已被同路径的其他插件注册（如 webui 的 done-pill 模块）；
        // 记录警告并继续，不让一个路由冲突拖垮整个插件加载。
        ctx.logger?.warn?.(`[dsh-chat-plus] done-pill route ${ROUTE} already registered (webui done-pill 模块共存？): ${String(error)}`)
        return undefined
      }
    }, 'dsh-chat-plus: done-pill /api/dsh-done-pill')

    webCtx.effect(() => {
      try {
        return webCtx.webServer.register({
          kind: 'exact',
          path: HOT_ROUTE,
          handler: (req, res) => {
            // 热区状态上报（client 半身 POST）：over=true 时光标悬停在胶囊上，
            // rects 是胶囊当前矩形（页面视口坐标 = 壳页面坐标，iframe 铺满窗口）。
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
              return
            }
            let body = ''
            let tooLarge = false
            req.on('data', (chunk: Buffer) => {
              body += chunk.toString()
              if (body.length > 4096) { tooLarge = true; req.destroy() }
            })
            req.on('end', () => {
              if (tooLarge) return
              try {
                const parsed = JSON.parse(body || '{}') as Partial<HotState>
                const rects = Array.isArray(parsed.rects)
                  ? parsed.rects.filter(r => r !== null && typeof r === 'object'
                    && Number.isFinite(r.x) && Number.isFinite(r.y)
                    && Number.isFinite(r.w) && Number.isFinite(r.h) && (r.w as number) > 0 && (r.h as number) > 0)
                  .map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
                  .slice(0, 8)
                  : []
                hotZone.handle({ over: parsed.over === true, rects })
              } catch { /* 上报体损坏：忽略本帧 */ }
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
              res.end(JSON.stringify({ ok: true }))
            })
          },
        })
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-chat-plus] done-pill route ${HOT_ROUTE} already registered: ${String(error)}`)
        return undefined
      }
    }, 'dsh-chat-plus: done-pill /api/dsh-done-pill/shell-hot')

    /**
     * 系统通知派发（client POST → 壳页面弹原生通知）。
     *
     * 为什么绕一圈：WebUI 是壳页面里的 iframe，而 topbar.html 的 iframe 没有
     * `allow="notifications"`，WebUI 文档里 `new Notification()` 会被 Permissions
     * Policy 拦掉。所以由 client 把「标题/正文/会话 id」POST 上来，host 经 CDP
     * 在壳页面（file:// 顶层）里发。返回 dispatched=false 时 client 回落页内卡。
     */
    webCtx.effect(() => {
      try {
        return webCtx.webServer.register({
          kind: 'exact',
          path: NOTIFY_ROUTE,
          handler: (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
              return
            }
            let body = ''
            let tooLarge = false
            req.on('data', (chunk: Buffer) => {
              body += chunk.toString()
              if (body.length > 8192) { tooLarge = true; req.destroy() }
            })
            req.on('end', async () => {
              if (tooLarge) return
              let title = ''
              let text = ''
              let tag = ''
              let sessionId = ''
              try {
                const parsed = JSON.parse(body || '{}') as Record<string, unknown>
                title = typeof parsed.title === 'string' ? parsed.title.slice(0, MAX_NOTIFY_TITLE) : ''
                text = typeof parsed.body === 'string' ? parsed.body.slice(0, MAX_NOTIFY_BODY) : ''
                tag = typeof parsed.tag === 'string' ? parsed.tag.slice(0, 120) : ''
                sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
              } catch { /* 上报体损坏：按空处理，下面会返回 dispatched=false */ }
              const dispatched = title !== '' && sessionId !== ''
                ? await hotZone.notify({ title, body: text, tag, sessionId })
                : false
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
              res.end(JSON.stringify({ ok: true, dispatched }))
            })
          },
        })
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-chat-plus] done-pill route ${NOTIFY_ROUTE} already registered: ${String(error)}`)
        return undefined
      }
    }, 'dsh-chat-plus: done-pill /api/dsh-done-pill/notify')

    /**
     * 通知点击回传（壳页面 → host）。壳页面点通知后 POST 会话 id，host 存下来，
     * 客户端下一轮 GET /api/dsh-done-pill 时取走并跳进该会话——这样「点通知 →
     * 唤醒窗口 → 进入对应会话」变成一条闭环，不依赖壳子改动。
     */
    webCtx.effect(() => {
      try {
        return webCtx.webServer.register({
          kind: 'exact',
          path: NOTIFY_CLICK_PATH,
          handler: (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
              return
            }
            let body = ''
            let tooLarge = false
            req.on('data', (chunk: Buffer) => {
              body += chunk.toString()
              if (body.length > 2048) { tooLarge = true; req.destroy() }
            })
            req.on('end', () => {
              if (tooLarge) return
              try {
                const parsed = JSON.parse(body || '{}') as { sessionId?: unknown }
                if (typeof parsed.sessionId === 'string' && parsed.sessionId !== '') {
                  pendingOpenSessionId = parsed.sessionId
                }
              } catch { /* 损坏的点击回传：丢弃 */ }
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
              res.end(JSON.stringify({ ok: true }))
            })
          },
        })
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-chat-plus] done-pill route ${NOTIFY_CLICK_PATH} already registered: ${String(error)}`)
        return undefined
      }
    }, 'dsh-chat-plus: done-pill /api/dsh-done-pill/notify-click')

    // 插件卸载时恢复壳页面常态并断开 CDP 连接。
    webCtx.effect(() => () => hotZone.stop(), 'dsh-chat-plus: done-pill shell-hot zone lifecycle')

    console.log(`[dsh-chat-plus] done-pill mounted: ${ROUTE} + ${HOT_ROUTE} + ${NOTIFY_ROUTE} + ${NOTIFY_CLICK_PATH} (global session/event listener active)`)
  })
}
