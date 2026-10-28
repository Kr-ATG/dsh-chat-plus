/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 官方字号轴订阅（对话胶囊跟随「设置 → 字号」）。
 *
 * ## 为什么需要这个模块
 *
 * 官方把正文字号发布成 `document.body` 上的行内变量
 * `--dsh-content-font-size`（10..22，默认 14，派生 `--dsh-content-font-delta`）。
 * CSS 侧直接 `calc()` 引用它就够了，但胶囊有两处**只能用 JS 算**：
 *
 *  1. **胶囊外壳高度**（`PILL_H` → `pillHeight()`）参与拖拽钳制与中心锚点换算
 *     （`clampPos` / `anchorToPos`）——这些是纯函数，拿不到 CSS 变量；
 *  2. **图标尺寸**走 React 的 `size` prop（`Math.round(18 * scale)` 之类），
 *     同样是 JS 数值，不能写 `calc()`。
 *
 * 所以需要一个「当前字号比例」的真值，且必须能**订阅**它的变化。
 *
 * ## 为什么能订阅：官方把变量写在 body 的 style 上
 *
 * 实测（CDP）：官方主题投影器 `ThemePresenter.apply()` 每次都用
 * `body.style.setProperty('--dsh-content-font-size', ...)` 写行内样式，
 * 因此 `MutationObserver` 观察 body 的 `style` 属性就能收到每一次字号变更
 * ——实测改两次字号、观察器命中两次，无遗漏。
 *
 * ## 比例口径
 *
 * `ratio = 当前字号 / 默认字号(14)`。选 14 而不是「用户首次加载时的值」：
 *  · 默认档（14）ratio 恒为 1，胶囊**一个像素都不变**——与字号轴改造前完全一致；
 *  · 换机器、换会话、清缓存后重新加载，ratio 仍然只由当前设置决定，不依赖历史。
 *
 * 口径与 `dsh-chat-plus` 的 `--kr-fs-*` 同源（那里也是「相对正文档平移」），
 * 两个插件在同一屏里对同一个设置给出同一套缩放。
 *
 * 边界：ratio 钳在 0.72 ~ 1.6。下限保住 10px 档时胶囊仍可读（13.5 × 0.72 ≈ 9.7px）；
 * 上限与「胶囊大小」滑块的上限（1.6）同档，两个维度叠乘后最大约 2.56 倍，
 * 再大就不是「跟随字号」而是「把胶囊撑爆」了。
 */

/** 官方默认正文字号（px）：与官方 `DEFAULT_FONT_SIZE` 一致。 */
const DEFAULT_FONT_SIZE = 14

/** 比例下限：字号 10px 档时胶囊不至于小到读不出。 */
const RATIO_MIN = 0.72

/** 比例上限：与「胶囊大小」滑块上限同档，避免两个维度叠乘后失控。 */
const RATIO_MAX = 1.6

type Listener = () => void

const listeners = new Set<Listener>()
let observer: MutationObserver | null = null
let current = 1
let started = false

/**
 * 读当前字号比例。
 *
 * 拿不到变量时返回 1（= 不缩放）：老宿主、纯壳环境、SSR 都走这条，
 * 胶囊退回改造前的尺寸，绝不因为读不到变量而变形。
 * @returns 当前字号相对默认字号的比例（已钳制）。
 */
export function readFontRatio(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 1
  try {
    const raw = getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size').trim()
    if (raw === '') return 1
    const px = Number.parseFloat(raw)
    if (!Number.isFinite(px) || px <= 0) return 1
    return Math.min(RATIO_MAX, Math.max(RATIO_MIN, px / DEFAULT_FONT_SIZE))
  } catch {
    return 1
  }
}

/** 通知所有订阅者（单个订阅者抛错不影响其余）。 */
function emit(): void {
  for (const fn of [...listeners]) {
    try { fn() } catch { /* 忽略 */ }
  }
}

/**
 * 重新读取比例；变化才通知。
 *
 * 「变化才通知」是必需的：观察器会在 body 的**任何** style 写入上触发
 * （主题切换、官方别处改 token 都会写 body.style），每次都通知会让
 * 胶囊无谓重渲染。
 * @returns 比例是否发生了变化。
 */
function refresh(): boolean {
  const next = readFontRatio()
  if (next === current) return false
  current = next
  emit()
  return true
}

/**
 * 订阅字号比例。首次订阅时启动观察器（幂等）。
 * @param listener - 比例变化时调用（不传新值，调用方自行 `getFontRatio()`）。
 * @returns 取消订阅函数。
 */
export function subscribeFontRatio(listener: Listener): () => void {
  listeners.add(listener)
  if (!started) start()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stop()
  }
}

/** 当前字号比例（同步读缓存值，不在渲染期碰 getComputedStyle）。 */
export function getFontRatio(): number {
  return current
}

/**
 * 把一个基准字号换算成跟随字号轴的 CSS 表达式。
 *
 * 供给那些**不参与 `--dps` 缩放**的浮层（滑出面板、完成提醒卡、跳转提示条）：
 * 它们的字号只跟官方字号轴，不跟本插件的「胶囊大小」。
 * 变量缺省值 1 让老宿主 / 无变量环境退回改造前的尺寸。
 *
 * @param size - 基准字号（px，= 改造前的字面量）。
 * @returns 形如 `calc(13px * var(--dpt, 1))` 的 CSS 值。
 */
export function fontScaleCss(size: number): string {
  return `calc(${size}px * var(--dpt, 1))`
}

/**
 * 启动观察器并同步一次初值。
 *
 * 观察 `attributes` + `attributeFilter: ['style']`：官方只改 body 的行内样式，
 * 不必观察整棵子树（`childList` / `subtree` 会让整个 App 的每次 DOM 变动都回调）。
 */
export function start(): void {
  if (started || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
  started = true
  current = readFontRatio()
  try {
    observer = new MutationObserver(() => { refresh() })
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] })
  } catch {
    observer = null
  }
}

/** 停止观察器并清空订阅（幂等；订阅数为 0 时自动调用）。 */
export function stop(): void {
  if (observer !== null) {
    try { observer.disconnect() } catch { /* 忽略 */ }
    observer = null
  }
  started = false
}

/**
 * 纯函数面：供裸 node 冒烟直接断言，不经 DOM。
 *
 * 「比例口径」是这条功能的契约本身（默认档必须精确为 1，边界必须钳住），
 * 错了不会报错、只会静默显示成错的尺寸，所以要能被测试钉死。
 */
export const __test = {
  DEFAULT_FONT_SIZE,
  RATIO_MIN,
  RATIO_MAX,
  /** 由字号（px）算比例，与 readFontRatio 同一套钳制。 */
  ratioOf(px: number): number {
    if (!Number.isFinite(px) || px <= 0) return 1
    return Math.min(RATIO_MAX, Math.max(RATIO_MIN, px / DEFAULT_FONT_SIZE))
  },
} as const
