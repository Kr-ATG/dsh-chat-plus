/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 录屏（GIF）核心纯逻辑（client 半身叶子模块）。
 *
 * 与 idle-director.ts 同款约束：**零 DOM / 零 React 依赖**，便于裸 node 单测
 * （Node 不能 strip .tsx，所以可测的策略必须留在 .ts 里）。录制/编码的浏览器
 * 副作用全部在 recorder.ts；本文件只放「可判定的纯函数 + 常量」。
 *
 * 帧率范围/默认值、输出宽度上限等常量在此**单点定义**，stores.ts 从这里
 * import 后 re-export，避免两处各写一份漂移。
 */

// ---- 输出参数常量 ----

/** 录屏帧率可选范围（fps）。GIF 逐帧全量编码，帧率越高体积涨得越快。 */
export const REC_FPS_MIN = 4
/**
 * 帧率上限 50。这个数由**播放端**决定，不是编码端：
 *
 *  GIF 的帧延时以 1/100 s 为单位，所以 50 fps（20ms）恰好是 2cs——这是浏览器
 *  能**忠实播放**的最高帧率。再往上就要用到 1cs 的帧，而 1cs 是有毒的：
 *  Firefox 把 0ms/10ms 的延迟一律改成 100ms（bug 232822），WebKit 同样钳到
 *  100ms（bug 36082）。也就是说 60 fps 的 GIF 在主流浏览器里会**掉成 10 fps**，
 *  比 50 fps 反而卡得多——体积还更大。
 *
 *  曾经设成 60，靠 allocateFrameDelay 的累积余数产出 2cs/1cs 交替来逼近 60fps。
 *  数学上没错，但产出的一半帧在浏览器里会被钳成 100ms，整段时间轴被拉垮。
 *  降到 50 之后，每一帧都是合法的 2cs，不需要任何钳制就精确表达。
 *
 *  编码速度仍有上限（逐帧同步编码，实测 1280 档单帧 11.7ms 能跑满 50fps；
 *  1920 档单帧 26ms → 实际 38.6 fps；2560 档 44.5ms → 23.1 fps）。一帧没编完
 *  会跳过后续新帧，帧率自然降级，但 delay 记的是真实间隔，播放速度与时长
 *  不失真（仿真里时间轴 1040ms vs 真实 1039ms）。
 */
export const REC_FPS_MAX = 50

/**
 * GIF 单帧延时下限（centisecond）：**2cs = 20ms**。
 *
 * 为什么不取 1cs：延时 0ms 与 10ms 是浏览器明确钳制的两个值——Firefox 与
 * WebKit 都把它们提升到 100ms（见 REC_FPS_MAX 的注释）。写 1cs 等于给解码器
 * 埋一个「这帧放 100ms」的雷，而且钳制发生在**播放时**，编码端完全看不出来。
 * 下限设 2cs 后，产出的每一个 delay 都是浏览器会忠实执行的值。
 *
 * 这与 REC_FPS_MAX = 50 是同一个约束的两面：50 fps 就是 2cs。
 */
export const REC_MIN_DELAY_CS = 2
/** 默认帧率：清晰度与体积的平衡点。 */
export const REC_FPS_DEFAULT = 12

/** 输出 GIF 的最大宽度（px）：超过则等比缩小；原始更窄不放大。 */
export const REC_MAX_W = 800

/**
 * 输出宽度档位（px）：0 = 原始分辨率不缩放。
 * GIF 逐帧全量编码，宽度越大体积近似平方级增长——做成档位而不是自由输入，
 * 就是把这个代价变成可预期的几档。
 *
 * 2560（2K）是最宽档：2560×1440 单帧 quantize + applyPalette + LZW 实测约
 * 44ms，已是 60fps 预算（16.7ms）的近三倍——选它等于「清晰优先、帧率让步」
 * （实际落在 23 fps 上下），所以它是独立档位而不是默认值。再往上（4K）单帧
 * 过百毫秒，录制会退化成幻灯片。
 */
export const REC_WIDTH_OPTIONS: readonly number[] = [480, 800, 1280, 1600, 1920, 2560, 0]
/** 默认档位：800 在文字场景下太糊（用户实测反馈），1280 是清晰度/体积平衡点。 */
export const REC_WIDTH_DEFAULT = 1280

/** 宽度档位的显示名（设置行共用，避免两处各写一份映射漂移）。 */
export function recWidthLabel(width: number): string {
  if (width === 0) return '原始'
  if (width === 2560) return '2K（2560px）'
  if (width === 1920) return '1K（1920px）'
  return `${width}px`
}

/** 把输出宽度吸附到合法档位（非法值回默认档）。 */
export function clampRecWidth(width: number): number {
  return REC_WIDTH_OPTIONS.includes(width) ? width : REC_WIDTH_DEFAULT
}

/** 把帧率钳制到合法整数范围。 */
export function clampFps(fps: number): number {
  const n = Number.isFinite(fps) ? Math.round(fps) : REC_FPS_DEFAULT
  return Math.min(REC_FPS_MAX, Math.max(REC_FPS_MIN, n))
}

/**
 * 把「本帧真实间隔 + 上一帧余数」分配成 GIF 的 centisecond 延时，余数带到下一帧。
 *
 * 为什么不能逐帧各自取整：目标 50 fps 的间隔是 20ms，`round(20/10) = 2cs` 没问题，
 * 但编码跟不上时真实间隔是 26ms、`round(2.6) = 3cs`，每帧各自取整会让误差单向
 * 累积（录 60s 实际时间轴漂移数秒）。累积余数则把不足一个 centisecond 的部分
 * 带到下一帧，长期平均值精确收敛到真实间隔。
 *
 * **被下限钳制时余数归零**（这是关键，不是可选的）：当 total 连 minCs 都不到
 * （例如请求 60 fps 的 16.7ms 而 minCs=2），写进去的延时比实际经过的时间长，
 * 差额**不能记成负余数带下去**——那会让 carry 无界负增长（实测每帧 -3.3ms，
 * 10 帧累积 -33ms），最终把后续一个真实的 40ms 间隔吞成 2cs，时间轴被压扁、
 * 播放变快。归零之后：钳制帧稳定输出 minCs，等真实间隔回来时如实记录。
 *
 * @param elapsedMs - 与上一帧的真实间隔（ms）；首帧传标称间隔 1000/fps。
 * @param carryMs - 上一帧留下的余数（ms）。
 * @param minCs - 单帧延时下限（cs），默认 REC_MIN_DELAY_CS。
 * @returns { delayCs, carryMs }：写进 GIF 的延时与新的余数。
 */
export function allocateFrameDelay(
  elapsedMs: number,
  carryMs: number,
  minCs: number = REC_MIN_DELAY_CS,
): { delayCs: number; carryMs: number } {
  const span = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0
  const carried = Number.isFinite(carryMs) ? carryMs : 0
  const floorCs = Number.isFinite(minCs) && minCs >= 1 ? Math.round(minCs) : REC_MIN_DELAY_CS
  const total = span + carried
  const rounded = Math.round(total / 10)
  // 够得着下限：正常量化，余数（含 ±5ms 内的负余数）带到下一帧做补偿。
  if (rounded >= floorCs) return { delayCs: rounded, carryMs: total - rounded * 10 }
  // 够不着下限：写最小合法延时，差额不传递（否则负余数无界累积，吞掉后续真实间隔）。
  return { delayCs: floorCs, carryMs: 0 }
}

// ---- 录制状态机 ----

export type RecState = 'idle' | 'recording' | 'encoding'

/** 合法迁移表（recording→idle 覆盖「取消/未授权回退」路径）。 */
const TRANSITIONS: Record<RecState, RecState[]> = {
  idle: ['recording'],
  recording: ['encoding', 'idle'],
  encoding: ['idle'],
}

/** 判断状态迁移是否合法。 */
export function canTransition(from: RecState, to: RecState): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

// ---- 帧尺寸计算 ----

/**
 * 计算输出 GIF 的帧尺寸：宽度超过 maxW 则等比缩小，宽高向下取偶数
 * （GIF 的 LZW 编码与部分解码器对奇数尺寸不友好）。
 *
 *  - 原始宽度 ≤ maxW：不放大，只把宽高取偶；
 *  - 原始宽度 > maxW：按 maxW 等比缩小后取偶；
 *  - 退化输入（非正数/NaN）：回退到 maxW 的 16:9 偶数尺寸。
 *
 * @returns { width, height }，均为 ≥2 的偶数。
 */
export function computeFrameSize(
  trackW: number,
  trackH: number,
  maxW: number = REC_MAX_W,
): { width: number; height: number } {
  const toEven = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)
  // maxW <= 0 / 非有限 = 不缩放（原始分辨率档）。
  const cap = Number.isFinite(maxW) && maxW > 0 ? maxW : trackW
  if (!Number.isFinite(trackW) || !Number.isFinite(trackH) || trackW <= 0 || trackH <= 0) {
    return { width: toEven(cap), height: toEven((cap * 9) / 16) }
  }
  const scale = trackW > cap ? cap / trackW : 1
  return { width: toEven(trackW * scale), height: toEven(trackH * scale) }
}

// ---- 窗口裁剪换算 ----

export interface RecRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 把屏幕 CSS 像素坐标的窗口矩形换算成捕获视频帧内的像素矩形。
 *
 * 坐标口径：host 的 GetWindowRect 跑在 DPI 不感知的 powershell 里，拿到的是
 * 96dpi 虚拟坐标——与浏览器 CSS 像素同一口径；而 chromeMediaSource 桌面捕获
 * 的视频帧是**物理**像素。换算系数 = 视频宽 / 屏幕 CSS 宽（即 dpr），
 * 横纵各算（多屏/非整数缩放下不假设两者相等），再钳进视频边界。
 *
 * @returns 视频像素坐标的裁剪矩形（整数、≥2px、不越界）；退化输入回退全帧。
 */
export function scaleCropToVideo(
  crop: RecRect,
  videoW: number,
  videoH: number,
  cssW: number,
  cssH: number,
): RecRect {
  if (videoW <= 0 || videoH <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  const fx = cssW > 0 ? videoW / cssW : 1
  const fy = cssH > 0 ? videoH / cssH : 1
  let x = Math.round(crop.x * fx)
  let y = Math.round(crop.y * fy)
  let w = Math.round(crop.w * fx)
  let h = Math.round(crop.h * fy)
  x = Math.min(Math.max(0, x), videoW - 2)
  y = Math.min(Math.max(0, y), videoH - 2)
  w = Math.min(Math.max(2, w), videoW - x)
  h = Math.min(Math.max(2, h), videoH - y)
  return { x, y, w, h }
}

// ---- 框选范围（屏幕区域录制）----

/**
 * 框选矩形的可视化最小边长（CSS 像素）。低于它的框没有录制意义，
 * 且会让 GIF 帧尺寸退化到 2px 级别——交互上直接拒绝。
 */
export const REC_REGION_MIN = 24

/** 两个点（拖拽起止）归一化：不管朝哪个方向拖，都给出正数宽高的矩形。 */
export function regionRectFromPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  boundsW: number,
  boundsH: number,
  minSize: number = REC_REGION_MIN,
): RecRect {
  const w0 = Number.isFinite(boundsW) && boundsW > 0 ? boundsW : minSize
  const h0 = Number.isFinite(boundsH) && boundsH > 0 ? boundsH : minSize
  const min = Math.min(Math.max(2, minSize), Math.min(w0, h0))
  // 起止点各自钳进边界（负坐标=拖出视口左侧，直接夹回）。
  const px = (n: number, max: number): number => Math.min(Math.max(0, n), max)
  const a = { x: px(ax, w0), y: px(ay, h0) }
  const b = { x: px(bx, w0), y: px(by, h0) }
  let x = Math.min(a.x, b.x)
  let y = Math.min(a.y, b.y)
  let w = Math.abs(a.x - b.x)
  let h = Math.abs(a.y - b.y)
  // 太小的框向外撑到最小边长（贴着右/下边时向内收，保证不越界）。
  if (w < min) {
    if (x + min > w0) x = Math.max(0, w0 - min)
    w = min
  }
  if (h < min) {
    if (y + min > h0) y = Math.max(0, h0 - min)
    h = min
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/**
 * 视口坐标 → 整屏坐标：框选 overlay 量到的是 **viewport CSS 像素**，而整屏流
 * 覆盖的是整个主屏，两者差一个窗口在屏幕上的原点（window.screenX/screenY）。
 * 只做平移与取整；越界与 dpr 换算交给 scaleCropToVideo。
 */
export function viewportToScreenRect(
  rect: RecRect,
  originX: number,
  originY: number,
): RecRect {
  return {
    x: Math.round(rect.x + (Number.isFinite(originX) ? originX : 0)),
    y: Math.round(rect.y + (Number.isFinite(originY) ? originY : 0)),
    w: Math.max(2, Math.round(rect.w)),
    h: Math.max(2, Math.round(rect.h)),
  }
}

// ---- 框选 overlay 操作条的指针命中（叶子逻辑，便于裸 node 单测）----

/**
 * 操作条按钮命中判定的判定顺序（与浏览器 click 语义对齐）。
 *
 * 为什么需要它：overlay 根层在 pointerdown 里 `setPointerCapture` 后，pointerup
 * 与合成的 click 的 target 都会变成**被捕获的根层**，操作条上「开始录制」的
 * onClick 永不触发——这正是用户报的 bug（只有 Enter 能开录）。
 * 可靠的判据只能是几何命中：`document.elementFromPoint(x, y)` 走的是布局，
 * 不受指针捕获影响。
 *
 * 这里把顺序写成纯函数，是因为它有三个容易搞错的分支：
 *  1. 没有捕获标记 → `none`：本次抬起不属于操作条，调用方什么都不做
 *     （绝不能默认当成 click，否则在任意位置松手都等于点了按钮）；
 *  2. 标记串不相等 → `mismatch`：按下与抬起不在同一个按钮上，按传统 click
 *     语义**不触发**（防止「按在取消上、拖到开始录制上松手」误开录）；
 *  3. 相等 → 返回该动作。
 */
export function resolveBarAction(
  down: string | null,
  up: string | null,
): 'go' | 'cancel' | 'none' | 'mismatch' {
  if (down === null || up === null) return 'none'
  if (down !== up) return 'mismatch'
  return down === 'go' ? 'go' : 'cancel'
}

/** 框选 overlay 操作条的按钮动作标记（DOM 属性值，组件与单测共用一个来源）。 */
export const REGION_ACTION_ATTR = 'data-dpl-region-action'

// ---- 窗口树排序（顶层窗 + 其子窗口缩进展示）----

/** 窗口条目（host 枚举 /api/dsh-companion/rec-windows 的规范形状）。 */
export interface RecWindowRow extends RecRect {
  hwnd: number
  pid: number
  title: string
  cls: string
  /** 所属顶层窗 hwnd；0 = 自己是顶层窗。 */
  parentHwnd: number
  /** 0 = 顶层窗，1 = 其子窗口。 */
  depth: number
}

/**
 * 把枚举结果排成「顶层窗，紧跟它的子窗口」的展示顺序。
 *
 * 为什么不能直接用 EnumWindows 的原始顺序：host 侧是「每个顶层窗枚举完自己的
 * 子窗口再继续下一个顶层窗」——顺序本来正确；但 client 侧可能过滤/截断，过滤后
 * 若不复排，子窗口会掉在无关的顶层窗下面（用户就分不清录的是谁）。
 * 孤儿子窗（父窗不可见未枚举）附在末尾，不丢条目。
 */
export function orderWindowTree<T extends { hwnd: number; parentHwnd: number }>(rows: T[]): T[] {
  const out: T[] = []
  const placed = new Set<number>()
  for (const row of rows) {
    if (row.parentHwnd !== 0) continue
    if (placed.has(row.hwnd)) continue
    out.push(row)
    placed.add(row.hwnd)
    for (const child of rows) {
      if (child.parentHwnd !== row.hwnd || placed.has(child.hwnd)) continue
      out.push(child)
      placed.add(child.hwnd)
    }
  }
  for (const row of rows) {
    if (placed.has(row.hwnd)) continue
    out.push(row)
    placed.add(row.hwnd)
  }
  return out
}

/** 窗口条目的副标题：子窗口带归属提示，尺寸另算。 */
export function windowSubtitle(win: Pick<RecWindowRow, 'title' | 'cls' | 'depth'>): string {
  const name = win.title.trim() !== '' ? win.title.trim() : win.cls
  return win.depth > 0 ? `子窗口 · ${name}` : name
}

// ---- 静止帧检测（GIF 瘦身：静止段不写帧，delay 累加）----

/** 采样块边长（px）：每 block×block 取中心一个样本点做签名。 */
export const REC_SIG_BLOCK = 8
/** 单样本三通道绝对差和超过它算「这个点变了」。 */
export const REC_SIG_PIXEL_DIFF = 48
/**
 * 变化样本占比低于它 → 整帧视为静止（不写帧，delay 累加到下一帧）。
 * 1280 宽下签名 14400 样本，0.0001 ≈ 1.4 个样本：单个字符/光标的变化
 * （约 7+ 样本）不会被误吞，纯静止（0 样本）照常合并。实测 0.0004 会把
 * 单字符变化判成静止（丢帧），收到这里。
 */
export const REC_STATIC_RATIO = 0.0001

/**
 * 从 RGBA 帧抽签名：每 REC_SIG_BLOCK×REC_SIG_BLOCK 块取中心像素的 RGB。
 * 1280×720 → 160×90 = 14400 样本（43KB），比存整帧 RGBA（3.7MB）便宜两个量级。
 */
export function sampleSignature(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  block: number = REC_SIG_BLOCK,
): Uint8ClampedArray {
  const cols = Math.max(1, Math.floor(w / block))
  const rows = Math.max(1, Math.floor(h / block))
  const out = new Uint8ClampedArray(cols * rows * 3)
  let o = 0
  const half = block >> 1
  for (let ry = 0; ry < rows; ry += 1) {
    const rowBase = (ry * block + half) * w
    for (let rx = 0; rx < cols; rx += 1) {
      const i = (rowBase + rx * block + half) * 4
      out[o] = rgba[i]
      out[o + 1] = rgba[i + 1]
      out[o + 2] = rgba[i + 2]
      o += 3
    }
  }
  return out
}

/**
 * 两份签名的变化样本占比（0~1）。与上一**已编码**帧比：连续静止帧会一直
 * 累加 delay，直到画面真的动才落一帧。
 */
export function signatureChangedRatio(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  pixelDiff: number = REC_SIG_PIXEL_DIFF,
): number {
  const n = Math.min(a.length, b.length) / 3
  if (n <= 0) return 1
  let changed = 0
  for (let i = 0; i < n; i += 1) {
    const j = i * 3
    const d = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2])
    if (d > pixelDiff) changed += 1
  }
  return changed / n
}

// ---- 差分透明（GIF 瘦身第二刀：只画变化的像素）----

/**
 * 变化像素占比超过它 → 放弃差分、整帧不透明编码（透明索引的开销不划算）。
 * 大面积滚动/视频画面走这里；光标、文字输入等小变化走差分。
 */
export const REC_DIFF_FULL_RATIO = 0.5

/** 逐像素比较两帧（预量化后），返回变化像素数。 */
export function countChangedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length)
  let changed = 0
  for (let i = 0; i < n; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed += 1
  }
  return changed
}

/**
 * 把「与上一帧相同」的像素的调色板索引改写成透明索引：解码器在这些位置
 * 保留上一帧画面（配合 disposal=1），LZW 则吃到超长同值 run——静止为主的
 * 录屏里这一刀比任何参数都狠。
 */
export function markUnchangedTransparent(
  prev: Uint8ClampedArray,
  cur: Uint8ClampedArray,
  index: Uint8Array,
  transparentIndex: number,
): void {
  const n = Math.min(prev.length, cur.length)
  for (let i = 0, p = 0; i < n; i += 4, p += 1) {
    if (prev[i] === cur[i] && prev[i + 1] === cur[i + 1] && prev[i + 2] === cur[i + 2]) {
      index[p] = transparentIndex
    }
  }
}

/**
 * 调色板条目数 → GIF LZW 最小码宽（bits）：entries 个索引需要
 * ceil(log2(entries)) 位，下限 2。128 条 → 7 位（比默认 8 位省 12.5% 索引流）。
 */
export function colorDepthFor(entries: number): number {
  if (entries <= 4) return 2
  return Math.min(8, Math.max(2, Math.ceil(Math.log2(entries))))
}

/**
 * 调色板实际色数 → 透明槽位方案（码宽 / 表条目数 / 透明索引）。
 *
 * **为什么需要它**：GIF 的 LZW 最小码宽（colorDepth）与局部调色板（LCT）条目数
 * 是两个**独立字段**，写盘时必须自洽——LCT 条目数 = 2^码宽，且索引值 < 条目数。
 * 旧实现把透明索引写死 127，而码宽是按 quantize 返回的**实际色数**算的：录屏画面
 * 颜色本就少（实测 480~1920 各档 UI 画面只有 2~27 色），码宽落到 2~5 位（最多表示
 * 索引 3~31），写 127 直接越界 → LZW 位流错位、整帧损坏。真机产物实测：
 * GDI+ 解出 99.9% 像素变纯绿、Pillow 报 broken data stream、ffmpeg 把越界码
 * 宽容地当成 clear 码跳过（所以肉眼未必立刻看出来）。
 *
 * 正确做法是把调色板**补位到 2^码宽**条，透明槽取补位后的最后一格——它恒 ≥
 * 真实色数，绝不会和画面里真实出现的颜色撞索引：
 *
 *   len=26 → 码宽 5 → 补到 32 条 → 透明索引 31（旧写法 127 越界）
 *   len=64 → 码宽 7 → 补到 128 条 → 透明索引 127（旧写法恰好安全）
 *
 * @param paletteLength - quantize 实际返回的色数。
 * @returns { depth, slots, transparentIndex }：depth = LZW 最小码宽；
 *   slots = LCT 条目数（也是调色板必须补齐到的长度）；transparentIndex = slots - 1。
 */
export function transparentSlotFor(paletteLength: number): {
  depth: number
  slots: number
  transparentIndex: number
} {
  const len = Number.isFinite(paletteLength) && paletteLength > 0 ? Math.floor(paletteLength) : 1
  const depth = colorDepthFor(len + 1)
  const slots = 1 << depth
  return { depth, slots, transparentIndex: slots - 1 }
}

/**
 * 把调色板补齐到 slots 条（不足处填黑）。
 *
 * gifenc 写 color table 的条目数是 `1 << max(ceil(log2(len)), 1)`——由**传进去的
 * 数组长度**推出，所以补位必须发生在调用方：补齐后 `len === slots === 2^depth`，
 * LCT 条目数与 colorDepth 才自洽。
 *
 * ⚠ 补位后的表**只用于写盘**，`applyPalette` 必须仍用原始调色板匹配：补的黑槽
 * 若参与匹配，画面里的纯黑像素会被映射到透明槽索引上，那些像素就会被解码器
 * 当成透明（显示上一帧），出现随机残影。
 */
export function padPalette(palette: number[][], slots: number): number[][] {
  if (!Array.isArray(palette) || palette.length >= slots) return palette
  const out = palette.slice()
  while (out.length < slots) out.push([0, 0, 0])
  return out
}

// ---- 差异帧裁剪（GIF 瘦身第三刀：只编码变化的矩形）----

/**
 * 裁剪框外扩的像素数。包围盒按**变化像素**算，但抗锯齿边缘、阴影、光标轨迹
 * 的过渡像素常常只差一两个色阶而落在「变化」判定之外；外扩 2px 把它们包进来，
 * 避免裁剪边界出现一圈没更新的旧像素（实测量化后这种边缘误差肉眼可见）。
 */
export const REC_CROP_PAD = 2
/**
 * 裁剪框面积占全屏的比例超过它 → 放弃裁剪、整帧编码。
 *
 * **这个守卫只为省 CPU，不是为了省体积** —— 实测裁剪在体积上永不亏：
 * 整帧编码本来也要写局部调色板（recorder 每帧都传 palette），所以裁剪帧的
 * 固定开销只多 10 字节 image descriptor，而省下的是整块没变区域的 LZW 数据。
 * 极端场景实测（全屏噪声 / 全屏渐变滚动，完全无静止区域）：裁剪与整帧编码
 * 的字节数差异 **0.0%**；单像素变化省 85.6%。
 *
 * 那为什么还留守卫：裁剪把每帧的 quantize/applyPalette 从整幅降到变化区，
 * 1280×720 实测单帧编码耗时 5~8ms → 0.5ms（**省 88%~93%**）。面积接近整幅时
 * 这份收益趋近于零，却还要多付一次 cropRgba 的整幅复制，不如直接整帧。
 *
 * 取 0.5 与 REC_DIFF_FULL_RATIO 一致：语义统一为「变化超过一半就不值得做
 * 局部优化」。实测 0.30 / 0.50 / 0.90 / 1.0 四个阈值体积基本持平
 * （合计 380.2 / 380.2 / 380.2 / 378.6 KB），所以选语义最整齐的那个。
 */
export const REC_CROP_MAX_RATIO = 0.5

/**
 * 求「两帧之间变化的像素」的包围盒（外扩 REC_CROP_PAD，并钳进画面边界）。
 *
 * 只比较 RGB，忽略 alpha（录屏帧恒不透明）。退化输入返回 null（调用方据此
 * 整帧编码，绝不产出一个非法或空矩形——空矩形会让解码器画出零像素帧）。
 *
 * @returns { x, y, w, h } 或 null（无变化 / 尺寸不一致 / 退化输入）。
 */
export function changeBounds(
  prev: Uint8ClampedArray,
  cur: Uint8ClampedArray,
  width: number,
  height: number,
  pad: number = REC_CROP_PAD,
): RecRect | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const w = Math.floor(width)
  const h = Math.floor(height)
  const need = w * h * 4
  if (!prev || !cur || prev.length < need || cur.length < need) return null
  const p = Number.isFinite(pad) && pad >= 0 ? Math.floor(pad) : 0

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    for (let x = 0; x < w; x += 1) {
      const i = (row + x) * 4
      if (prev[i] !== cur[i] || prev[i + 1] !== cur[i + 1] || prev[i + 2] !== cur[i + 2]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null

  const x0 = Math.max(0, minX - p)
  const y0 = Math.max(0, minY - p)
  const x1 = Math.min(w, maxX + 1 + p)
  const y1 = Math.min(h, maxY + 1 + p)
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/**
 * 从整幅 RGBA 里抠出子矩形，返回新的紧凑 RGBA（宽高为矩形尺寸）。
 *
 * 必须复制而非 subarray：quantize / applyPalette 按**连续内存**解析 RGBA
 * （`new Uint32Array(t.buffer)`），跨行的视图会被当成一整块读，颜色全乱。
 */
export function cropRgba(
  rgba: Uint8ClampedArray,
  width: number,
  box: RecRect,
): Uint8ClampedArray {
  const w = Math.floor(width)
  const out = new Uint8ClampedArray(box.w * box.h * 4)
  for (let y = 0; y < box.h; y += 1) {
    const src = ((box.y + y) * w + box.x) * 4
    out.set(rgba.subarray(src, src + box.w * 4), y * box.w * 4)
  }
  return out
}

/**
 * 判断这一帧是否值得裁剪：面积占比不超过上限。
 * 退化矩形（宽高非正）一律判 false —— 宁可整帧编码也不写非法帧。
 */
export function shouldCrop(box: RecRect | null, width: number, height: number): boolean {
  if (box === null) return false
  if (!Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0) return false
  const total = width * height
  if (!Number.isFinite(total) || total <= 0) return false
  return (box.w * box.h) / total <= REC_CROP_MAX_RATIO
}

// ---- 文件名 / 时长格式化 ----

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 录屏文件名：dsh-rec-YYYYMMDD-HHmmss.gif（本地时区）。
 * @param now - 起始时刻（默认 Date.now()）。
 */
export function nextRecFilename(now: number = Date.now()): string {
  const d = new Date(now)
  const date = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
  const time = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  return `dsh-rec-${date}-${time}.gif`
}

/**
 * 时长格式化：m:ss（超过 1 小时为 h:mm:ss）。用于按钮上的录制计时。
 * @param ms - 毫秒。
 */
export function formatRecDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}
