/**
 * dsh-chat-plus — 生图占位的两个纯判据。
 *
 * 单独成文件的原因与项目里其它纯逻辑模块一致：这两条判错不会抛异常，
 * 只会让点阵的形状/数量悄悄走样 —— 必须能被冒烟直接断言。
 *
 *  · parseImageRequest：从 generate_image 的入参 JSON 里读 n（张数）与
 *    size / aspect_ratio（比例）。流式半截 JSON、字符串数字、X 拼接的尺寸
 *    都要容错，解析失败回落 1 张 / 1:1。
 *  · dotGridForRatio：按图片宽高比算点阵行列数，保证任何比例下点数总量接近、
 *    视觉密度一致。
 */

/** 一次生图请求在占位上的形状。 */
export interface ImageRequestShape {
  /** 生成张数（1–4）。 */
  readonly count: number
  /** 图片宽高比（宽 / 高，0.2–5）。 */
  readonly ratio: number
}

const SIZE_RE = /^\s*(\d{1,5})\s*[xX×*]\s*(\d{1,5})\s*$/
const ASPECT_RE = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/

/**
 * 解析 generate_image 的入参。
 *
 * 工具声明（provider/capabilities-host.js）只有 `size: '1024x1024'` 与 `n: 1`；
 * 部分网关 / 模型会自行附 `aspect_ratio: '16:9'`，一并兼容。
 */
export function parseImageRequest(argsRaw: string): ImageRequestShape {
  let record: Record<string, unknown> = {}
  if (typeof argsRaw === 'string' && argsRaw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(argsRaw)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>
      }
    } catch {
      /* 流式半截 JSON：按默认值处理 */
    }
  }

  let ratio = 1
  const size = record.size
  if (typeof size === 'string') {
    const match = SIZE_RE.exec(size)
    if (match !== null) {
      const width = Number(match[1])
      const height = Number(match[2])
      if (width > 0 && height > 0) ratio = width / height
    }
  }
  if (ratio === 1) {
    const aspect = record.aspect_ratio ?? record.aspectRatio
    if (typeof aspect === 'string') {
      const match = ASPECT_RE.exec(aspect)
      if (match !== null) {
        const width = Number(match[1])
        const height = Number(match[2])
        if (width > 0 && height > 0) ratio = width / height
      }
    }
  }

  const rawN = record.n
  const numericN = typeof rawN === 'number'
    ? rawN
    : typeof rawN === 'string' && rawN.trim() !== '' ? Number(rawN) : 1
  const count = Number.isFinite(numericN) ? Math.min(4, Math.max(1, Math.round(numericN))) : 1
  return { count, ratio: Math.min(5, Math.max(0.2, ratio)) }
}

/**
 * 点阵网格：按图片宽高比决定行列数。
 *
 * 基准 11 列（1:1 时 11×11 ≈ 121 个点）；横图拉宽列数、竖图拉高行数，
 * 保证任何比例下点的总量都差不多、视觉密度一致。上限 24 用来控制 CSS
 * 动画元素数量（4 张并排时每块仍约 120 个点）。
 */
export function dotGridForRatio(ratio: number): { readonly cols: number; readonly rows: number } {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const base = 11
  const root = Math.sqrt(safe)
  return {
    cols: Math.min(24, Math.max(7, Math.round(base * root))),
    rows: Math.min(24, Math.max(7, Math.round(base / root))),
  }
}

/**
 * 正文 markdown 里是否已经出现过图片。
 *
 * 用途：模型生图后常在最终回答里自己贴 `![...](...)` 或 `<img>`；此时总结卡
 * 再补一条 GeneratedImageStrip 就会同一张图出现两遍（用户 2026-10-30 报的
 * 「对话流卡里面这样显示出来我也觉得很奇怪，重复了」）。只在正文完全没有
 * 图片时才让画廊兜底显示（模型只写文件路径 / 纯文字的场景）。
 */
export function textHasMarkdownImage(text: string): boolean {
  if (typeof text !== 'string' || text === '') return false
  if (/!\[[^\]]*\]\([^)]+\)/.test(text)) return true
  if (/<img\b[^>]*>/i.test(text)) return true
  return false
}
