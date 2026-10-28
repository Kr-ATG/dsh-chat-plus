/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 窗口抓帧源（client 半身，叶子模块）。
 *
 * 把 host 侧 PrintWindow 抓到的 JPEG 帧变成一个 MediaStream，让 recorder 那条
 * 「video → canvas → GIF」管线原样复用（含静止帧合并、差分透明这些瘦身逻辑）。
 *
 * 为什么这么绕：窗口录制**不能**走「整屏流 + 矩形裁剪」——整屏流拿的是屏幕
 * 合成结果，窗口被挡住就录到挡它的那个窗口（用户反馈的原始 bug：点窗口录制，
 * 录出来是被其它窗口覆盖的画面）。也不能走 Chromium 的窗口捕获：Electron 33 /
 * Win11 实测对任何 `window:<hwnd>:0` 源都 `NotReadableError`（见 host 的
 * rec-capture.js 文件头，那里有完整矩阵）。唯一可行的是 host 侧 PrintWindow
 * 抓窗口自身内容，再喂回 renderer —— 天然免遮挡，也天然支持子窗口。
 *
 * 一个额外好处：抓到的帧**就是窗口内容本身**，不含屏幕上的位置信息，所以
 * 不需要「按矩形裁剪」，也不需要跟随窗口移动。窗口拖动/缩放完全不影响录制。
 *
 * 关键实测约束（改前必读）：
 *  1. **`await video.play()` 会永久挂起**：generator 轨道在写入首帧前没有数据，
 *     play() 的 Promise 不 settle（实测 probe15 卡死，且 executeJavaScript 一起
 *     挂住）。所以 recorder 里 play() 只 catch 不 await，并且本模块的抓帧主循环
 *     必须由 `begin()` **显式启动** —— 等 recorder 把 video 挂好、srcObject 设好、
 *     play() 发起之后再写首帧，否则首帧 write() 会因无人消费而背压挂死。
 *  2. **rVFC 真的会被注入帧驱动**（实测写 6 帧回调 6 次），所以 recorder 那条
 *     requestVideoFrameCallback 抽帧循环不用改；
 *  3. JPEG 的有损压缩在 GIF 那 127 色量化之后不可见，所以 host 出 JPEG 而非 PNG
 *     （PNG 大图单帧 ~100ms，JPEG ~27ms，见 host 文件头取舍 3）。
 *  4. 帧按**真实到达节奏**写：抓帧是串行的（一次 HTTP 一来回），`pump()` 里
 *     await 完再排下一个，天然不堆叠请求。丢帧比堆帧好。
 *  5. **缩放交给 host**：2K 窗口整尺寸抓帧 ~193ms/帧（5fps），host 缩到 1280
 *     只要 39ms/帧、800 是 33ms/帧 —— 因为瓶颈是把 7MB 的位图搬过 HTTP 与
 *     base64，不是缩放本身。所以 maxW 按输出档位传给 host，而不是在这边缩。
 */
import { REC_FRAME_ROUTE } from './rec-picker'

/** 单帧 HTTP 超时（ms）：host 侧有 4s 抓帧超时，客户端留一点余量。 */
const FRAME_TIMEOUT_MS = 5000
/**
 * 连续失败多少帧判定源已死。窗口关掉时 host 回 window-gone（立刻终结，不走这里）；
 * 留余量是防偶发超时（大窗口 PrintWindow 遇到阻塞的窗口可能慢一帧）。
 */
const MAX_CONSECUTIVE_FAILS = 6

/** 首帧元信息（recorder 用它定 GIF 帧尺寸）。 */
export interface WindowFrameMeta {
  /** 抓到的帧像素宽高（= host 侧输出尺寸，已按 maxW 缩过）。 */
  width: number
  height: number
}

/** 源终止原因。 */
export type WindowSourceEnd = 'gone' | 'hidden' | 'failed' | 'stopped'

/** 抓帧源句柄。 */
export interface WindowFrameSource {
  /** 供 <video> 用的流（含一条 generator 轨道）。 */
  stream: MediaStream
  /**
   * 启动抓帧主循环。**必须在 recorder 挂好 video 之后调用**（见文件头坑 1）；
   * 幂等，重复调用无副作用。
   */
  begin(): void
  /** 已成功写入的帧数。 */
  frames(): number
  /** 窗口是否已消失（关掉/最小化）。 */
  gone(): boolean
  /** 请求停止（幂等）。 */
  stop(): void
}

interface StartOptions {
  hwnd: number
  /** 目标输出宽度档（0 = 原尺寸）；host 侧缩放（见文件头坑 5）。 */
  maxW: number
  /** 抓帧间隔（ms）：跟着 recorder 的 fps 走。 */
  intervalMs: number
  /** 首帧到位回调。 */
  onFirstFrame?: (meta: WindowFrameMeta) => void
  /** 源终止回调（窗口关闭 / 不可见 / 连续失败 / 主动停止）。 */
  onEnd?: (reason: WindowSourceEnd) => void
}

/** 环境是否具备抓帧源能力（缺任一项就回退整屏裁剪）。 */
export function windowSourceSupported(): boolean {
  if (typeof window === 'undefined') return false
  return typeof MediaStreamTrackGenerator !== 'undefined'
    && typeof VideoFrame !== 'undefined'
    && typeof createImageBitmap === 'function'
    && typeof atob === 'function'
}

/** base64 → Uint8Array（atob 出 latin1 字符串，逐字符取码点，不用 TextEncoder）。 */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 起一个窗口抓帧源（不同步写帧，等 `begin()`）。
 *
 * @returns 源句柄；环境不支持时返回 null（调用方回退整屏裁剪）。
 */
export function startWindowFrameSource(options: StartOptions): WindowFrameSource | null {
  if (!windowSourceSupported()) return null

  const generator = new MediaStreamTrackGenerator({ kind: 'video' })
  const writer = generator.writable.getWriter()
  const stream = new MediaStream([generator])

  let stopped = false
  let started = false
  let frames = 0
  let failStreak = 0
  let gone = false
  let ended = false
  let timer: number | null = null
  let inflight: AbortController | null = null

  /** 统一终止路径：清定时器、断流、只通知一次。 */
  const finish = (reason: WindowSourceEnd): void => {
    if (ended) return
    ended = true
    stopped = true
    if (reason === 'gone' || reason === 'hidden') gone = true
    if (timer !== null) { window.clearInterval(timer); timer = null }
    if (inflight !== null) { try { inflight.abort() } catch { /* 已结束 */ } inflight = null }
    try { void writer.close() } catch { /* 轨道已断 */ }
    try { generator.stop() } catch { /* 已停 */ }
    options.onEnd?.(reason)
  }

  /**
   * 抓一帧：HTTP 拿 JPEG → bitmap → VideoFrame 写进轨道。
   * @returns 'ok' | 'gone'（窗口没了/不可见，应立刻终结）| 'retry'（这一帧失败，可重试）
   */
  const grabOnce = async (): Promise<'ok' | 'gone' | 'retry'> => {
    const controller = new AbortController()
    inflight = controller
    const timeout = window.setTimeout(() => { try { controller.abort() } catch { /* 已结束 */ } }, FRAME_TIMEOUT_MS)
    try {
      const url = `${REC_FRAME_ROUTE}?hwnd=${encodeURIComponent(String(options.hwnd))}&maxW=${options.maxW}`
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) {
        // 502 带结构化 code：窗口没了/最小化时 host 如实报 window-gone /
        // window-hidden —— 这种必须**立刻收尾**，不能继续录（实测对不可见窗口
        // 抓帧会拿到别的窗口的画面或全黑，继续录就是往 GIF 里灌垃圾帧）。
        let code = ''
        try {
          const body = (await res.json()) as { code?: string }
          code = typeof body?.code === 'string' ? body.code : ''
        } catch { /* 非 JSON 响应按可重试处理 */ }
        if (code === 'window-gone') return 'gone'
        if (code === 'window-hidden') return 'hidden'
        return 'retry'
      }
      const body = (await res.json()) as { ok?: boolean; w?: number; h?: number; data?: string }
      if (body?.ok !== true || typeof body.data !== 'string' || body.data === '') return 'retry'
      const bitmap = await createImageBitmap(new Blob([base64ToBytes(body.data)], { type: 'image/jpeg' }))
      if (stopped) { bitmap.close(); return 'retry' }
      const size = { width: bitmap.width, height: bitmap.height }
      const frame = new VideoFrame(bitmap, {
        timestamp: Math.round(performance.now() * 1000),
        duration: Math.round(options.intervalMs * 1000),
      })
      bitmap.close()
      await writer.write(frame)
      frame.close()
      if (frames === 0) options.onFirstFrame?.(size)
      frames += 1
      return 'ok'
    } catch {
      return 'retry'
    } finally {
      window.clearTimeout(timeout)
      if (inflight === controller) inflight = null
    }
  }

  /**
   * 抓帧主循环：串行抓（一次 HTTP 一来回），每轮结束再排下一次。
   * 用递归 setTimeout 而不是 setInterval：抓帧耗时波动大（6–193ms），
   * setInterval 会堆叠并发请求把 host 的 agent 打乱，串行递归天然自适应。
   */
  const pump = async (): Promise<void> => {
    if (stopped) return
    const result = await grabOnce()
    if (stopped) return
    if (result === 'gone' || result === 'hidden') { finish(result); return }    if (result === 'ok') {
      failStreak = 0
    } else {
      failStreak += 1
      if (failStreak >= MAX_CONSECUTIVE_FAILS) { finish('failed'); return }
    }
    timer = window.setTimeout(() => { void pump() }, Math.max(0, Math.round(options.intervalMs)))
  }

  return {
    stream,
    begin(): void {
      if (started || stopped) return
      started = true
      void pump()
    },
    frames: () => frames,
    gone: () => gone,
    stop: () => { finish('stopped') },
  }
}
