/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 录屏控制器（client 半身，单例）。
 *
 * 点胶囊上的录屏按钮 → 选录制目标 → 抽帧增量编码 GIF（gifenc，逐帧 local
 * palette，内存只留压缩输出，不存 RGBA 原始帧）→ 停止后 finish() 组 Blob
 * 自动下载。**无时长上限**：录到用户主动停止（按钮 / 浏览器原生「停止共享」）
 * 为止。
 *
 * 三种目标（见 RecTarget）：
 *  - native：纯浏览器的系统选择器（getDisplayMedia），用户自己选屏幕/窗口；
 *  - full / region：整屏流（Electron 壳的 chromeMediaSource:desktop），
 *    region 再按框选矩形裁剪（框选 overlay 量的 viewport 坐标 + 窗口原点平移）；
 *  - window：**host 侧 PrintWindow 抓那个窗口自己**（免遮挡、支持子窗口），
 *    帧经 rec-window-source 喂进同一条 video → canvas → GIF 管线。见该文件
 *    与 host 的 rec-capture.js —— 那里解释了为什么不能走 Chromium 的窗口捕获。
 *
 * 状态机与尺寸/文件名等纯逻辑在 rec-core.ts（可裸 node 单测）；本文件只
 * 做浏览器副作用。结果与失败经 session-nav 的 pushNotice 广播到提示条
 * （NavToast），与跳转失败共用同一条可见反馈通道。
 *
 * 环境边界：
 *  - 纯浏览器 http://127.0.0.1 是 secure context，getDisplayMedia 可用；
 *  - 壳内跨源 iframe：display-capture 是真正的 policy-controlled feature，
 *    `document.permissionsPolicy.allowsFeature('display-capture')` 可信
 *    （notifications 不是，别类推——见 notify-center.ts 顶部注释）；
 *  - 用户取消授权弹窗（NotAllowedError）→ 静默回待机，不算失败。
 */
import { GIFEncoder, applyPalette, quantize, type GIFEncoderInstance } from './vendor/gifenc'
import {
  REC_DIFF_FULL_RATIO, REC_STATIC_RATIO, allocateFrameDelay, canTransition,
  changeBounds, clampFps, clampRecWidth, computeFrameSize, countChangedPixels, cropRgba,
  formatRecDuration, markUnchangedTransparent, nextRecFilename, padPalette, sampleSignature,
  scaleCropToVideo, shouldCrop, viewportToScreenRect,
  signatureChangedRatio, transparentSlotFor, type RecRect, type RecState,
} from './rec-core'

/** 调色板条目数上限：留 1 槽给透明索引，凑满 128 = 2^7。 */
const REC_PALETTE_COLORS = 127
import { recStore } from './stores'
import { pushNotice } from './session-nav'
import { fetchRecWindows, pickerStore, regionStore } from './rec-picker'
import { startWindowFrameSource, windowSourceSupported, type WindowFrameSource } from './rec-window-source'
import { inEmbeddedFrame } from './notify-center'

/** 录制目标：native = 系统选择器；full = 整屏；region = 框选区域；window = 单个窗口。 */
export type RecTarget =
  | { kind: 'native' }
  | { kind: 'full' }
  | { kind: 'region'; rect: RecRect }
  | { kind: 'window'; hwnd: number; pid: number; title: string }

/** 对外快照：按钮/状态行订阅它渲染。 */
export interface RecSnapshot {
  state: RecState
  /** 录制起始时刻（state=idle 时无意义）。 */
  since: number
  /** 已编码帧数（录制中实时增长，编码中定格）。 */
  frames: number
  /** 最近一次产物文件名（idle 后短暂保留，供提示用）。 */
  lastFilename: string | null
}

let snapshot: RecSnapshot = { state: 'idle', since: 0, frames: 0, lastFilename: null }
const listeners = new Set<(next: RecSnapshot) => void>()

function emit(patch: Partial<RecSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const fn of [...listeners]) {
    try { fn(snapshot) } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

function setState(next: RecState): void {
  if (!canTransition(snapshot.state, next)) {
    console.warn(`[dsh-rec] 忽略非法状态迁移 ${snapshot.state} → ${next}`)
    return
  }
  emit({ state: next })
}

/** 环境是否具备录屏能力（按钮据此渲染/禁用）。
 *  标准 getDisplayMedia 或 Electron 整屏回退（getUserMedia）任一可用即可。 */
export function recSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  const md = navigator.mediaDevices
  if (md === undefined) return false
  return typeof md.getDisplayMedia === 'function' || typeof md.getUserMedia === 'function'
}

/** 壳内跨源 iframe 被 Permissions Policy 拦住 display-capture 时为 true。 */
export function recBlockedByPolicy(): boolean {
  if (typeof document === 'undefined') return false
  const policy = document.permissionsPolicy
  if (policy === undefined || typeof policy.allowsFeature !== 'function') return false
  try { return !policy.allowsFeature('display-capture') } catch { return false }
}

/**
 * 走原生选择器还是选择面板：壳内跨源 iframe 的 renderer 暴露 getDisplayMedia
 * 但没有选择 UI（调用直接 NotSupportedError），所以**壳内一律走选择面板**
 * （整屏 / host 枚举的窗口裁剪）；纯浏览器顶层页才有真的系统选择器。
 * acquireStream 里仍留 NotSupportedError → 整屏的兜底，防 inEmbeddedFrame
 * 误判（如同源壳）时至少能录。
 */
function nativePickerAvailable(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false
  return !inEmbeddedFrame()
}

export const recorder = {
  get: (): RecSnapshot => snapshot,
  subscribe(fn: (next: RecSnapshot) => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  /** 按钮入口：idle → 有原生选择器就直接录，没有就弹选择面板；recording → 停止。 */
  toggle(): void {
    if (snapshot.state === 'idle') {
      if (nativePickerAvailable()) void start({ kind: 'native' })
      else pickerStore.open()
    } else if (snapshot.state === 'recording') {
      void stop(false)
    }
  },
  /** 选择面板选定目标后的入口（idle 之外忽略）。 */
  startWith(target: RecTarget): void {
    if (snapshot.state !== 'idle') return
    void start(target)
  },
}

// ---- 内部：一次录制的全部运行态 ----

interface RunState {
  stream: MediaStream
  track: MediaStreamTrack
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  ctx2d: CanvasRenderingContext2D
  gif: GIFEncoderInstance
  /** 录制期间锁定的帧率（中途改设置不影响进行中的录制）。 */
  fps: number
  /** 帧最小间隔（ms）。 */
  minFrameGapMs: number
  width: number
  height: number
  startedAt: number
  /** 上一帧的 rVFC 时间戳（算 GIF delay 用真实间隔）。 */
  lastFrameTs: number
  frames: number
  /** 上一帧还在编码时跳过当前帧（编码是同步重活，防雪崩）。 */
  busy: boolean
  /** requestVideoFrameCallback 句柄（取消用；与 fallbackTimer 二选一）。 */
  rvfcHandle: number | null
  /** 定时器抽帧兜底的 interval id（无 rVFC 的老浏览器）。 */
  fallbackTimer: number | null
  /** 视频帧物理尺寸（裁剪换算基准）。 */
  videoW: number
  videoH: number
  /** 窗口裁剪矩形（视频像素坐标）；null = 全帧。 */
  crop: RecRect | null
  /** 上一**已编码**帧的采样签名（静止检测基准）。 */
  lastSig: Uint8ClampedArray | null
  /**
   * 上一**已编码**帧的完整 RGBA。差异帧裁剪的变化包围盒、差分透明的比对都以它为准。
   *
   * 它与「解码器上一帧画布」**等价**：包围盒覆盖了本帧与上一帧所有不同处，所以
   * 框外两帧相同；上一帧同样只更新了自己的框内——归纳下来画布 == 上一帧原始画面
   * （tests 里有等价性用例锁定）。所以不需要额外维护画布副本。
   */
  prevFullRgba: Uint8ClampedArray | null
  /** 走了差异帧裁剪的帧数（提示条里报出来，让用户看见省了多少）。 */
  croppedFrames: number
  /** 静止段累积的时长（ms）：下一帧落盘时并进它的 delay。 */
  pendingDelayMs: number
  /**
   * 帧延时取整的累积余数（ms）。GIF 延时是 centisecond，逐帧各自 round 会让
   * 60fps 一律落成 2cs（= 50fps）且误差单向累积；把余数带到下一帧，
   * 2cs/1cs 交替，平均帧率才真的等于设定值。见 rec-core.allocateFrameDelay。
   */
  carryMs: number
  /** 因静止被跳过的帧数（提示条里报出来，让用户看见省了多少）。 */
  skippedStatic: number
  /** 跟随的窗口 pid；null = 不跟随。仅「整屏裁剪」回退路径用（见 start）。 */
  followPid: number | null
  /** 窗口跟随轮询 interval id。 */
  followTimer: number | null
  /** 窗口抓帧源（window 目标的正路径）；null = 走 MediaStream 视频轨。 */
  frameSource: WindowFrameSource | null
  /** 窗口源终结监听 interval id（仅 frameSource 路径用）。 */
  watchTimer: number | null
  /** 抓帧目标的窗口标题（仅 frameSource 路径用；失败提示里指名道姓）。 */
  windowTitle: string | null
  /** stop 重入保护。 */
  stopping: boolean
}

let run: RunState | null = null
/** 计时器：录制中每 250ms 推一次 since（按钮计时文本）。 */
let tickTimer: number | null = null

function startTick(): void {
  stopTick()
  tickTimer = window.setInterval(() => {
    if (snapshot.state === 'recording' && run !== null) {
      emit({ frames: run.frames })
    }
  }, 250)
}

function stopTick(): void {
  if (tickTimer !== null) { window.clearInterval(tickTimer); tickTimer = null }
}

/**
 * 窗口跟随（**仅整屏裁剪回退路径**用）：每 500ms 重查 host 的窗口矩形，
 * 窗口被移动时裁剪区跟着走。
 *
 * 正路径（host PrintWindow 抓帧）不需要它：抓到的帧就是窗口内容本身，
 * 不含屏幕位置。只有 Chromium 窗口捕获不可用、且抓帧源也起不来时，
 * 才会退到「整屏流 + 按窗口矩形裁剪」，那时才必须跟随。
 * 按 pid 查而不是 hwnd：同一进程的第一个可见窗就是用户要的那个（枚举顺序稳定）。
 *
 * ⚠ 只跟**位置**不跟尺寸：GIF 的帧尺寸在首帧就定死（canvas 固定），中途改
 * 宽高会让解码器拿到尺寸不一致的帧序列。窗口被 resize 时裁剪尺寸保持首帧值
 * （钳进视频边界），位置继续跟随。
 */
function startFollow(pid: number): void {
  const active = run
  if (active === null) return
  active.followTimer = window.setInterval(() => {
    const cur = run
    if (cur === null || cur.stopping || cur.followPid !== pid || cur.crop === null) return
    void fetchRecWindows().then((windows) => {
      const now = run
      if (now === null || now.stopping || now.followPid !== pid || now.crop === null) return
      const win = windows.find((w) => w.pid === pid)
      if (win === undefined) return // 窗口消失/最小化：保持最后一次裁剪
      const next = scaleCropToVideo(
        win, now.videoW, now.videoH,
        typeof window !== 'undefined' ? window.screen.width : now.videoW,
        typeof window !== 'undefined' ? window.screen.height : now.videoH,
      )
      now.crop = {
        x: next.x,
        y: next.y,
        w: Math.min(now.crop.w, now.videoW - next.x),
        h: Math.min(now.crop.h, now.videoH - next.y),
      }
    })
  }, 500)
}

/**
 * 捕获入口：优先标准 getDisplayMedia（屏幕/窗口/标签页选择器）。
 *
 * 环境没有选择器时回退：Electron 壳的 renderer 暴露 getDisplayMedia 但没有
 * 选择 UI，调用直接 reject `NotSupportedError`（实测壳内点录屏就是这个报错）；
 * 此时改走 Chromium/Electron 私有的桌面捕获约束
 * （getUserMedia + chromeMediaSource:'desktop'，整屏、无需选择器）。
 */
async function acquireStream(fps: number): Promise<MediaStream> {
  const md = navigator.mediaDevices
  if (md !== undefined && typeof md.getDisplayMedia === 'function') {
    try {
      return await md.getDisplayMedia({
        // frameRate 是「捕获上限」提示（上限封顶 60：GIF 时间轴的表达上限）；
        // 落帧节奏由 minFrameGapMs 自己节流。
        video: { frameRate: Math.max(fps, 15), width: 2560, height: 1440 },
        audio: false,
      })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      // 用户取消（NotAllowedError/AbortError）与真实失败都原样抛给调用方；
      // 只有「环境没有选择器」这一类才回退。
      if (name !== 'NotSupportedError' && name !== 'TypeError') throw error
    }
  }
  const stream = await acquireElectronDesktop(fps)
  pushNotice('info', '当前环境没有屏幕选择器，已回退为整屏录制')
  return stream
}

/**
 * Electron 壳回退：getUserMedia 的 chromeMediaSource:'desktop' 私有约束，
 * 捕获整个主屏（无选择器、无授权弹窗）。纯浏览器里该约束被忽略会去开摄像头，
 * 但本路径只在 getDisplayMedia 缺失/NotSupported 时才走，纯浏览器不会误入。
 */
async function acquireElectronDesktop(fps: number): Promise<MediaStream> {
  const rate = Math.max(fps, 15)
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        // 2K 档要的是「原始像素」：这里给足 2560×1440，屏幕不到这个尺寸时
        // Chromium 按实际屏幕给帧，不会放大（原始档也据此不丢像素）。
        maxWidth: typeof window !== 'undefined' ? Math.max(window.screen.width, 2560) : 2560,
        maxHeight: typeof window !== 'undefined' ? Math.max(window.screen.height, 1440) : 1440,
        // 上限封顶 60：GIF 的帧延时以 centisecond 为单位，再高的捕获帧率
        // 只会被折进同一档 delay（体积涨、画面不变）。
        minFrameRate: Math.min(rate, 30),
        maxFrameRate: Math.min(rate, 60),
      },
    },
  } as unknown as MediaStreamConstraints
  return await navigator.mediaDevices.getUserMedia(constraints)
}

async function start(target: RecTarget): Promise<void> {
  if (!recSupported() || run !== null) return
  const cfg = recStore.get()
  const fps = clampFps(cfg.fps)
  // 输出宽度档位：0 = 原始分辨率不缩放。录制期间锁定（中途改设置不影响进行中的录制）。
  const outWidth = clampRecWidth(cfg.width)

  // 窗口目标先试**正路径**：host PrintWindow 抓帧（免遮挡、支持子窗口）。
  // 抓帧源起不来（老环境缺 MediaStreamTrackGenerator / host 路由缺失）时，
  // 回落到「整屏流 + 按窗口矩形裁剪」的老路——那条路仍然可用，只是被遮挡
  // 时会录到挡在上面的窗口（用户会看到提示条说明）。
  if (target.kind === 'window') {
    const source = await startWindowTarget(target, fps, outWidth)
    if (source) return
    // 回落到整屏裁剪：重新按 pid 查一次窗口矩形（枚举结果可能已过期）。
    const windows = await fetchRecWindows()
    const win = windows.find((w) => w.hwnd === target.hwnd)
      ?? windows.find((w) => w.pid === target.pid)
    if (win === undefined) {
      pushNotice('error', `无法开始录屏：窗口「${target.title}」已不可见`)
      return
    }
    pushNotice('info', '当前环境只能按屏幕区域录制该窗口，窗口被遮挡时会录到上层画面')
    return startScreenTarget({ kind: 'window', pid: win.pid, rect: win }, fps, outWidth)
  }
  return startScreenTarget(target, fps, outWidth)
}

/**
 * 起窗口抓帧源（正路径）。成功接管后返回句柄，失败返回 null（调用方回落）。
 *
 * 流程与 startScreenTarget 的区别：视频轨是自造的 generator，帧由 host 抓，
 * 所以不需要 play() 的 await（见 rec-window-source 文件头坑 1），也不需要
 * 任何裁剪 —— 帧本身就是窗口内容。首帧到位后才定 GIF 帧尺寸。
 */
async function startWindowTarget(
  target: Extract<RecTarget, { kind: 'window' }>,
  fps: number,
  outWidth: number,
): Promise<WindowFrameSource | null> {
  if (!windowSourceSupported()) return null
  const intervalMs = 1000 / fps
  // 让 host 直接出「最终要用的宽度」：抓帧瓶颈是把位图搬过 HTTP，
  // 2K 整尺寸 193ms/帧 vs 缩到 1280 只要 39ms/帧（见 rec-window-source 坑 5）。
  // 0 = 原始档：不缩，保持原分辨率。
  //
  // 首帧回执走 onFirstFrame 回调（写入成功那一刻就 resolve，比轮询
  // video.videoWidth 早一拍）。放弃用 await 是因为抓帧源必须在 video 挂好
  // 之后才 begin（见 rec-window-source 文件头坑 1）。
  let resolveFirst: (meta: { width: number; height: number } | null) => void = () => {}
  const firstFrame = new Promise<{ width: number; height: number } | null>((resolve) => { resolveFirst = resolve })
  /**
   * 源终止原因（窗口关闭 / 最小化 / 连续失败）。**必须在 run 建好之前就记下来**：
   * 抓帧源可能在首帧阶段就终结（用户点了别的窗口、窗口被关掉），那时 run 还是
   * null，回调不能直接读 run。
   */
  let endReason: WindowSourceEnd | null = null
  const source = startWindowFrameSource({
    hwnd: target.hwnd,
    maxW: outWidth,
    intervalMs,
    onFirstFrame: (meta) => { resolveFirst(meta) },
    onEnd: (reason) => {
      endReason = reason
      // 首帧还没到就终结：立刻兑现 null，别让下面的 Promise 悬到超时。
      resolveFirst(null)
    },
  })
  if (source === null) return null

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = source.stream
  // ⚠ 不能 await：generator 轨道在首帧写入前没有数据，play() 永不 settle。
  const played = video.play()
  if (played !== undefined && typeof played.catch === 'function') played.catch(() => { /* 首帧写入后自然推进 */ })

  // 现在才开抓（video 已消费端就绪），并等首帧。超时给足：host 起 agent 约 1s，
  // 单帧上限 4s，再算上大窗口的编码时间。
  source.begin()
  const first = await Promise.race([
    firstFrame,
    new Promise<null>((resolve) => { window.setTimeout(() => { resolve(null) }, 12000) }),
  ])
  if (first === null || first.width <= 0 || first.height <= 0) {
    source.stop()
    // 区分失败原因：窗口已关/最小化是最常见的（用户点了别的窗口），
    // 如实告诉用户而不是笼统的「取不到画面」。
    const why = endReason === 'gone'
      ? '窗口已关闭'
      : endReason === 'hidden'
        ? '窗口已最小化或被隐藏'
        : '取不到画面'
    pushNotice('error', `无法录制窗口「${target.title}」：${why}`)
    return null
  }
  // 竞态保护：等待期间用户可能已经点了停止/别的录制起来了。
  if (run !== null) { source.stop(); return null }

  const meta = first
  const size = computeFrameSize(meta.width, meta.height, outWidth)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx2d === null) {
    source.stop()
    pushNotice('error', '无法开始录屏：canvas 2d 上下文不可用')
    return null
  }
  ctx2d.imageSmoothingEnabled = true
  ctx2d.imageSmoothingQuality = 'high'

  run = {
    stream: source.stream,
    track: source.stream.getVideoTracks()[0],
    video,
    canvas,
    ctx2d,
    gif: GIFEncoder(),
    fps,
    minFrameGapMs: 1000 / fps,
    width: size.width,
    height: size.height,
    startedAt: Date.now(),
    lastFrameTs: -1,
    frames: 0,
    busy: false,
    rvfcHandle: null,
    fallbackTimer: null,
    videoW: meta.width,
    videoH: meta.height,
    // 抓帧路径不需要裁剪：帧就是窗口内容本身（也不受窗口移动/遮挡影响）。
    crop: null,
    followPid: null,
    followTimer: null,
    frameSource: source,
    watchTimer: null,
    windowTitle: target.title,
    lastSig: null,
    prevFullRgba: null,
    croppedFrames: 0,
    pendingDelayMs: 0,
    carryMs: 0,
    skippedStatic: 0,
    stopping: false,
  }

  // 窗口关闭 / 最小化 / 连续抓帧失败 → 正常收尾出 GIF（录到一半窗口就没了，
  // 保存已录部分是用户想要的；直接丢弃会让整段白录）。
  //
  // 这里**不能**用 onEnd 回调：回调是在起 source 时注册的，而 run 那一刻才建好，
  // 回调闭包里拿不到它。改成轮询 source 的终结标志——400ms 一查，代价可忽略。
  const watch = window.setInterval(() => {
    const cur = run
    if (cur === null || cur.frameSource !== source) { window.clearInterval(watch); return }
    if (!source.gone()) return
    window.clearInterval(watch)
    // 首帧都还没写成功就终结（用户选的窗口其实已最小化）：没有帧可保存，
    // 让 stop 走「未产生任何帧」的清理路径并如实报原因。
    if (cur.frames === 0) pushNotice('info', `窗口「${target.title}」已关闭或最小化，未录到内容`)
    void stop(false)
  }, 400)
  // 停止时清掉 watch（stop 里读不到它，挂到 run 上由 stop 统一清理）。
  run.watchTimer = watch

  setState('recording')
  emit({ since: run.startedAt, frames: 0 })
  startTick()
  pumpFrames()
  pushNotice('info', `正在录制窗口「${target.title}」（窗口被遮挡也不影响）`)
  return source
}

/**
 * 整屏流路径（整屏 / 框选区域 / 窗口裁剪回退），三者的差别只在裁剪矩形。
 *
 * @param target - full = 不裁剪；region = 按框选矩形裁剪（viewport 坐标先平移
 *                 到屏幕坐标）；window = 按窗口矩形裁剪并跟随窗口移动（回退）。
 */
async function startScreenTarget(
  target: Exclude<RecTarget, { kind: 'native' } | { kind: 'window' }> | Extract<RecTarget, { kind: 'window' }>,
  fps: number,
  outWidth: number,
): Promise<void> {
  let stream: MediaStream
  try {
    stream = await acquireElectronDesktop(fps)
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    // 用户在系统选择器里点了取消：静默回待机，不弹错误。
    if (name === 'NotAllowedError' || name === 'AbortError') return
    pushNotice('error', `无法开始录屏：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const track = stream.getVideoTracks()[0]
  if (track === undefined) {
    stream.getTracks().forEach((t) => { t.stop() })
    pushNotice('error', '无法开始录屏：未拿到视频轨')
    return
  }

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  try {
    await video.play()
  } catch (error) {
    track.stop()
    pushNotice('error', `无法开始录屏：${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const settings = track.getSettings()
  const trackW = typeof settings.width === 'number' && settings.width > 0 ? settings.width : video.videoWidth
  const trackH = typeof settings.height === 'number' && settings.height > 0 ? settings.height : video.videoHeight
  // 裁剪：屏幕 CSS 矩形 → 视频物理像素矩形（scaleCropToVideo 换算 dpr 并钳界）。
  let crop: RecRect | null = null
  let followPid: number | null = null
  const screenW = typeof window !== 'undefined' ? window.screen.width : trackW
  const screenH = typeof window !== 'undefined' ? window.screen.height : trackH
  if (target.kind === 'region') {
    // 框选量到的是 viewport 坐标，整屏流覆盖的是整个主屏：差一个窗口原点。
    const originX = typeof window !== 'undefined' ? window.screenX : 0
    const originY = typeof window !== 'undefined' ? window.screenY : 0
    crop = scaleCropToVideo(viewportToScreenRect(target.rect, originX, originY), trackW, trackH, screenW, screenH)
  } else if (target.kind === 'window') {
    crop = scaleCropToVideo(target.rect, trackW, trackH, screenW, screenH)
    followPid = target.pid
  } else if (target.kind === 'native') {
    // startScreenTarget 不会被 native 调用；显式挡一手，避免将来误用。
    stream.getTracks().forEach((t) => { t.stop() })
    return
  }
  const srcW = crop !== null ? crop.w : trackW
  const srcH = crop !== null ? crop.h : trackH
  const size = computeFrameSize(srcW, srcH, outWidth)

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx2d !== null) {
    // 高质量缩放：默认的低质量双线性在缩到 1280/800 时文字边缘发糊，
    // 录制是持续重活，高质量模式的额外开销相对 GIF 编码可忽略。
    ctx2d.imageSmoothingEnabled = true
    ctx2d.imageSmoothingQuality = 'high'
  }
  if (ctx2d === null) {
    track.stop()
    pushNotice('error', '无法开始录屏：canvas 2d 上下文不可用')
    return
  }

  run = {
    stream, track, video, canvas, ctx2d,
    gif: GIFEncoder(),
    fps,
    minFrameGapMs: 1000 / fps,
    width: size.width,
    height: size.height,
    startedAt: Date.now(),
    lastFrameTs: -1,
    frames: 0,
    busy: false,
    rvfcHandle: null,
    fallbackTimer: null,
    videoW: trackW,
    videoH: trackH,
    crop,
    followPid,
    followTimer: null,
    frameSource: null,
    watchTimer: null,
    windowTitle: null,
    lastSig: null,
    prevFullRgba: null,
    croppedFrames: 0,
    pendingDelayMs: 0,
    carryMs: 0,
    skippedStatic: 0,
    stopping: false,
  }

  // 窗口跟随：每 500ms 重查 host 窗口矩形，窗口被移动/缩放时裁剪区跟着走。
  if (followPid !== null) startFollow(followPid)

  // 用户点浏览器原生「停止共享」→ 等同点停止，正常出 GIF。
  track.addEventListener('ended', () => { void stop(false) }, { once: true })

  setState('recording')
  emit({ since: run.startedAt, frames: 0 })
  startTick()
  pumpFrames()
}

/** 抽帧循环：优先 requestVideoFrameCallback（真实新帧驱动），无则定时兜底。 */
function pumpFrames(): void {
  const active = run
  if (active === null) return
  const rvfc = active.video.requestVideoFrameCallback
  if (typeof rvfc === 'function') {
    const step = (_handle: number, meta: { mediaTime?: number }): void => {
      if (run === null || run.stopping) return
      captureFrame(typeof meta?.mediaTime === 'number' ? meta.mediaTime * 1000 : performance.now())
      run.rvfcHandle = run.video.requestVideoFrameCallback(step)
    }
    active.rvfcHandle = active.video.requestVideoFrameCallback(step)
  } else {
    // 兜底：定时器抽帧（非 Chromium 老浏览器）。
    const timer = window.setInterval(() => {
      if (run === null || run.stopping) { window.clearInterval(timer); return }
      captureFrame(performance.now())
    }, Math.round(active.minFrameGapMs))
    active.fallbackTimer = timer
  }
}

/** 抓一帧：节流（≥ minFrameGapMs）→ 缩放画进 canvas → 增量编码进 GIF。 */
function captureFrame(nowTs: number): void {
  const active = run
  if (active === null || active.busy || active.stopping) return
  if (active.lastFrameTs >= 0 && nowTs - active.lastFrameTs < active.minFrameGapMs * 0.9) return
  if (active.video.readyState < 2) return

  // 帧延时：首帧按标称间隔（1000/fps），后续按**真实**间隔（rVFC 的 mediaTime /
  // performance.now）——编码跟不上时帧率自然降级，但时间轴如实记录，播放速度
  // 与真实录制时长一致。余数带进下一帧（见 allocateFrameDelay）。
  const elapsedMs = active.lastFrameTs < 0 ? 1000 / active.fps : nowTs - active.lastFrameTs
  const { delayCs, carryMs } = allocateFrameDelay(elapsedMs, active.carryMs)
  active.carryMs = carryMs
  active.lastFrameTs = nowTs

  active.busy = true
  try {
    const src = active.crop ?? { x: 0, y: 0, w: active.videoW, h: active.videoH }
    active.ctx2d.drawImage(
      active.video,
      src.x, src.y, src.w, src.h,
      0, 0, active.width, active.height,
    )
    const rgba = active.ctx2d.getImageData(0, 0, active.width, active.height).data
    // 静止帧合并：与上一已编码帧比签名，没动就不写帧、把时长累加到下一帧的
    // delay（GIF 合法操作，播放总时长不变）。录屏大部分时间是静止画面，
    // 这一刀能砍掉大半帧数——GIF 体积几乎正比于帧数。
    const sig = sampleSignature(rgba, active.width, active.height)
    if (active.frames > 0 && active.lastSig !== null
      && signatureChangedRatio(active.lastSig, sig) < REC_STATIC_RATIO) {
      active.pendingDelayMs += delayCs * 10
      active.skippedStatic += 1
      return
    }

    // 差异帧裁剪（第三刀）：只编码「与上一帧不同」的矩形，其余交给解码器
    // 保留上一帧画面。录屏里常见的一小块文字/光标变化，裁剪后只要编码百分之几
    // 的面积。面积超过 REC_CROP_MAX_RATIO 时退回整帧（大滚动/视频场景裁剪反而
    // 更贵——每帧多一个 image descriptor 和局部调色板）。
    //
    // 基准是**上一帧的完整原始画面**（prevFullRgba）。它与「解码器画布」等价：
    // box 覆盖了本帧与上一帧所有不同处，所以框外两帧相同；而上一帧同样只更新了
    // 它自己的框内——归纳下来画布 == 上一帧原始画面（有等价性用例锁定）。
    //
    // ⚠ 别为了省一次 cropRgba 而按「框尺寸相同」复用上一帧的紧凑数组：录屏里
    // 滑块/光标每帧位移固定，框**尺寸恒定但位置在动**，复用会让 70% 的像素比对
    // 到错误位置，差分透明把该更新的像素误标成透明 → 残影随帧累积（实测 MAE
    // 逐帧 1.5→5.3）。每次按当前 box 现抠才是对的。
    const box = active.frames > 0 && active.prevFullRgba !== null
      ? changeBounds(active.prevFullRgba, rgba, active.width, active.height)
      : null
    const cropped = shouldCrop(box, active.width, active.height)
    const frameRgba = cropped && box !== null
      ? cropRgba(rgba, active.width, box)
      : rgba
    const frameW = cropped && box !== null ? box.w : active.width
    const frameH = cropped && box !== null ? box.h : active.height
    // 差分透明的比对基准：同一 box 下从上一帧完整画面现抠（尺寸/位置都必须对）。
    const prevForDiff = active.prevFullRgba === null
      ? null
      : cropped && box !== null
        ? cropRgba(active.prevFullRgba, active.width, box)
        : active.prevFullRgba

    // 调色板 127 色上限（屏幕内容颜色本就不多，127 色肉眼几乎无差）。
    // 实际色数常远低于 127（实测 UI 画面 2~27 色），所以**码宽/表长/透明索引
    // 必须按实际色数算**：transparentSlotFor 把表补位到 2^码宽 条，透明槽取
    // 补位后的最后一格。旧实现把透明索引写死 127，色数 < 64 时越界 → LZW
    // 位流错位、整帧损坏（真机产物实测过）。
    const rawPalette = quantize(frameRgba, REC_PALETTE_COLORS)
    const index = applyPalette(frameRgba, rawPalette)
    const { depth, slots, transparentIndex } = transparentSlotFor(rawPalette.length)
    const totalPixels = frameW * frameH
    // 差分透明：与上一已编码帧逐像素比，没变的像素索引改写成透明槽——解码器
    // 在这些位置保留上一帧画面（disposal=1），LZW 吃到超长同值 run。静止为主
    // 的录屏里这一刀比任何参数都狠（gifsicle / 录屏工具的同款做法）。
    // 变化面积超过 REC_DIFF_FULL_RATIO（大滚动/视频）时透明索引开销不划算，
    // 整帧不透明编码。
    const useDiff = prevForDiff !== null && prevForDiff.length === frameRgba.length
      && countChangedPixels(prevForDiff, frameRgba) / totalPixels < REC_DIFF_FULL_RATIO
    if (useDiff && prevForDiff !== null) {
      markUnchangedTransparent(prevForDiff, frameRgba, index, transparentIndex)
    }
    active.gif.writeFrame(index, frameW, frameH, {
      // 补位后的表只用于写盘；applyPalette 已用原始表匹配过，纯黑像素不会被
      // 误映射到透明槽（否则那些像素会被解码器当成透明，出现残影）。
      palette: padPalette(rawPalette, slots),
      delay: delayCs * 10 + active.pendingDelayMs,
      repeat: 0,
      colorDepth: depth,
      transparent: useDiff,
      transparentIndex,
      // 1 = do not dispose：透明像素位置保留上一帧，差分才成立。
      dispose: 1,
      // 裁剪帧的落点（gifenc 由 vendor 脚本打了 x/y 偏移补丁）。整帧编码时
      // 恒为 (0,0)——与未打补丁的上游行为一致。
      x: cropped && box !== null ? box.x : 0,
      y: cropped && box !== null ? box.y : 0,
    })
    active.pendingDelayMs = 0
    active.lastSig = sig
    active.prevFullRgba = rgba
    active.frames += 1
    if (cropped) active.croppedFrames += 1
  } catch (error) {
    // 单帧编码异常跳帧继续，不中断整段（首帧失败除外——没有首帧 GIF 无法成形）。
    if (active.frames === 0) {
      console.warn(`[dsh-rec] 首帧编码失败，终止录制：${String(error)}`)
      void stop(true)
      return
    }
    console.warn(`[dsh-rec] 帧编码失败，跳过：${String(error)}`)
  } finally {
    active.busy = false
  }
}

/**
 * 停止录制并输出 GIF。
 * @param failed - true = 录制已失败（如首帧编码挂掉），只清场不出文件。
 */
async function stop(failed: boolean): Promise<void> {
  const active = run
  if (active === null || active.stopping) return
  active.stopping = true
  stopTick()

  // 先停捕获轨与抽帧，再进入 encoding（帧循环看到 run.stopping 会自行退出）。
  if (active.rvfcHandle !== null && typeof active.video.cancelVideoFrameCallback === 'function') {
    active.video.cancelVideoFrameCallback(active.rvfcHandle)
  }
  if (active.fallbackTimer !== null) {
    window.clearInterval(active.fallbackTimer)
  }
  if (active.followTimer !== null) {
    window.clearInterval(active.followTimer)
    active.followTimer = null
  }
  // 窗口抓帧源：先停抓帧循环（否则它还会继续往已断的轨道写帧），再停轨道。
  if (active.watchTimer !== null) {
    window.clearInterval(active.watchTimer)
    active.watchTimer = null
  }
  if (active.frameSource !== null) {
    active.frameSource.stop()
    active.frameSource = null
  }
  active.stream.getTracks().forEach((t) => { t.stop() })
  active.video.srcObject = null

  const frames = active.frames
  const durationMs = Date.now() - active.startedAt

  if (failed || frames === 0) {
    const wasWindow = active.windowTitle
    run = null
    setState('idle')
    // 窗口源那一路已经在终结监听里报过具体原因（「已关闭或最小化」），
    // 这里别再补一条笼统的「画面可能始终未更新」叠上去。
    if (!failed && wasWindow === null) pushNotice('error', '录屏未产生任何帧，已取消（画面可能始终未更新）')
    return
  }

  setState('encoding')
  emit({ frames })

  // 让按钮先切到编码态再进重活：宏任务让出一帧，React 有机会渲染 spinner。
  await new Promise<void>((resolve) => { window.setTimeout(resolve, 30) })

  let blob: Blob | null = null
  let filename = ''
  try {
    active.gif.finish()
    const bytes = active.gif.bytes()
    blob = new Blob([bytes as unknown as BlobPart], { type: 'image/gif' })
    filename = nextRecFilename(active.startedAt)
    triggerDownload(blob, filename)
  } catch (error) {
    pushNotice('error', `GIF 编码失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    run = null
    setState('idle')
    if (blob !== null) {
      const mb = blob.size / (1024 * 1024)
      emit({ lastFilename: filename })
      const skipped = active.skippedStatic
      const cropped = active.croppedFrames
      const saved = [
        skipped > 0 ? `合并静止 ${skipped} 帧` : '',
        cropped > 0 ? `裁剪 ${cropped} 帧` : '',
      ].filter((s) => s !== '').join('，')
      pushNotice('info', `录屏已保存 ${filename}（${mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB'} · ${formatRecDuration(durationMs)} · ${frames} 帧${saved !== '' ? `，${saved}` : ''}）`)
    }
  }
}

/** a[download] 触发浏览器下载（与生图画廊同款做法）。 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 30000)
}

// 页面卸载：停轨道释放资源（进行中的编码直接丢弃，不做持久化）。
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (run !== null) {
      run.stopping = true
      if (run.followTimer !== null) window.clearInterval(run.followTimer)
      if (run.watchTimer !== null) window.clearInterval(run.watchTimer)
      if (run.frameSource !== null) run.frameSource.stop()
      run.stream.getTracks().forEach((t) => { t.stop() })
      run = null
    }
    stopTick()
  }, { once: true })
}
