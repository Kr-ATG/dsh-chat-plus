/**
 * webui — 截图尺寸预设（host / client 两端共用的纯数据）。
 *
 * 「设备 × 画质」两档选择，映射成一组 CSS 宽度 + 输出缩放：
 *  - 电脑版：横幅版面（宽屏阅读，适合发群/贴文档）；
 *  - 手机版：窄幅版面（竖屏阅读，转发到聊天里不用横向缩放）。
 *  - 1080P / 2K / 4K 决定的是**输出像素宽度**，靠 deviceScaleFactor 放大，
 *    文字始终按 CSS 宽度排版，所以放大画质不会让版式变形、只会更清晰。
 *
 * 高度不固定：内容多就自动往下长（长图），这里给的是最小高度。
 */

/** 设备版式。 */
export type ShotDevice = 'desktop' | 'phone'

/** 输出画质档。 */
export type ShotQuality = '1080p' | '2k' | '4k'

/**
 * 画幅比例：'auto' = 跟随内容长度（现状长图行为）；其余为固定宽高比，
 * 内容不足时补背景画布、超出时保留完整内容（比例退化为下限）。
 */
export type ShotAspect = 'auto' | '16:9' | '4:3' | '1:1' | '9:16' | '3:4'

/** 画幅 → 宽高比数值（auto 无固定比）。 */
const ASPECT_RATIO: Record<Exclude<ShotAspect, 'auto'>, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
}


/** 画幅档位顺序（UI 分段选择按此渲染）。 */

/**
 * 解析画幅参数。
 * @returns 固定比例的宽高比数值；自适应 / 未知值返回 null。
 */
export function shotAspectRatio(aspect: unknown): number | null {
  if (typeof aspect !== 'string') return null
  const ratio = (ASPECT_RATIO as Record<string, number | undefined>)[aspect]
  return typeof ratio === 'number' ? ratio : null
}

/** 一档预设的渲染参数。 */
export interface ShotPreset {
  /** 排版用的 CSS 宽度（决定字号/留白比例）。 */
  cssWidth: number
  /** 输出缩放（deviceScaleFactor）。 */
  scale: number
  /** 卡片最小高度（CSS px），内容更高时自动扩展。 */
  minHeight: number
}

/** 设备 × 画质 → 渲染参数。 */
export const SHOT_PRESETS: Record<ShotDevice, Record<ShotQuality, ShotPreset>> = {
  desktop: {
    // 960×2 = 1920 宽
    '1080p': { cssWidth: 960, scale: 2, minHeight: 540 },
    // 1280×2 = 2560 宽
    '2k': { cssWidth: 1280, scale: 2, minHeight: 720 },
    // 1280×3 = 3840 宽
    '4k': { cssWidth: 1280, scale: 3, minHeight: 720 },
  },
  phone: {
    // 540×2 = 1080 宽
    '1080p': { cssWidth: 540, scale: 2, minHeight: 900 },
    // 480×3 = 1440 宽
    '2k': { cssWidth: 480, scale: 3, minHeight: 820 },
    // 540×4 = 2160 宽
    '4k': { cssWidth: 540, scale: 4, minHeight: 900 },
  },
}

/**
 * 宽度档位预设（6 档）：
 *  - 540：手机竖屏（紧凑窄幅，适合聊天转发不横向缩放）；
 *  - 720：小窗/紧凑文档；
 *  - 960：标准默认（均衡阅读节奏，适合发群/贴文档）；
 *  - 1200：宽屏（适合横向代码/表格/对比场景）；
 *  - 1440：超宽屏（大幅展示场景）；
 *  - 1920：全宽（1080P 满幅宽度；宽表格/多列对比/整页看板不再被横向压缩）。
 */
export const WIDTH_PRESETS = [540, 720, 960, 1200, 1440, 1920] as const
export type WidthPreset = (typeof WIDTH_PRESETS)[number]
export const DEFAULT_WIDTH = 960

/** 自定义宽度的合法区间（CSS px，host 与面板共用，避免两处各写一份）。 */
export const WIDTH_MIN = 360
export const WIDTH_MAX = 2560

/** 宽度档位中文标签。 */
export const WIDTH_LABELS: Record<WidthPreset, string> = {
  540: '540 手机',
  720: '720 紧凑',
  960: '960 标准',
  1200: '1200 宽屏',
  1440: '1440 超宽',
  1920: '1920 全宽',
}

/** 根据画质档与排版宽度计算 deviceScaleFactor 缩放倍率。 */
export function qualityScale(quality: ShotQuality, width: number): number {
  const isNarrow = width <= 640
  if (quality === '1080p') return 2
  if (quality === '4k') return isNarrow ? 4 : 3
  // 2k 默认
  return isNarrow ? 3 : 2
}


/** 画质档中文名。 */
export const QUALITY_LABEL: Record<ShotQuality, string> = {
  '1080p': '1080P',
  '2k': '2K',
  '4k': '4K',
}

/** 解析宽度与画质参数。 */
export function resolveShotPreset(widthInput: unknown, qualityInput: unknown): ShotPreset & { width: number; quality: ShotQuality } {
  let width = typeof widthInput === 'number' && !Number.isNaN(widthInput)
    ? Math.round(widthInput)
    : (typeof widthInput === 'string' && /^\d+$/.test(widthInput)
      ? parseInt(widthInput, 10)
      : (widthInput === 'phone' ? 540 : DEFAULT_WIDTH))
  width = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, width))
  const q: ShotQuality = qualityInput === '1080p' || qualityInput === '4k' ? qualityInput : '2k'
  const scale = qualityScale(q, width)
  return {
    cssWidth: width,
    scale,
    minHeight: width <= 640 ? 800 : 540,
    width,
    quality: q,
  }
}

/**
 * 取一档预设（兼容旧版按 device 查，也支持传入具体 width 数值）。
 * @param deviceOrWidth - 设备版式或数值宽度。
 * @param quality - 画质档。
 * @returns 该档的渲染参数。
 */
export function shotPreset(deviceOrWidth: unknown, quality: unknown): ShotPreset & { device: ShotDevice; quality: ShotQuality } {
  const d: ShotDevice = deviceOrWidth === 'phone' || (typeof deviceOrWidth === 'number' && deviceOrWidth <= 640) ? 'phone' : 'desktop'
  const q: ShotQuality = quality === '1080p' || quality === '4k' ? quality : '2k'
  if (typeof deviceOrWidth === 'number' && !Number.isNaN(deviceOrWidth)) {
    const resolved = resolveShotPreset(deviceOrWidth, q)
    return { cssWidth: resolved.cssWidth, scale: resolved.scale, minHeight: resolved.minHeight, device: d, quality: q }
  }
  return { ...SHOT_PRESETS[d][q], device: d, quality: q }
}
