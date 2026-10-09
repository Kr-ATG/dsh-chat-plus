/**
 * dsh-chat-plus — iu kind 的共享纯逻辑工具（host 与 client 两半身均可 import）。
 *
 * 这个文件里**不允许出现 React**：截图管线（src/shot/card.ts）在 host 半身，
 * 它要消费同一套 parse / snapshot / css / doc，一旦这里拖进 React，host 产物
 * 就会多出一份 React 实例（构建守卫 assertHostExternals 也会当场失败）。
 *
 * 所有 kind 模块都从这里取字段校验与转义工具，保证「同一个字段在对话流与
 * 截图里被同样地钳位、同样地转义」。
 */

/** HTML 文本转义（快照拼串必用；模型文本绝不能逃出标签上下文）。 */
export function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * HTML 属性值转义。
 *
 * 与 escapeHtml 的差别是**多转引号与反引号**：属性用双引号包裹时，值里一个
 * `"` 就能闭合属性、把事件处理器注入进标签。截图页跑在 --disable-web-security
 * 的无头 Chrome 里，注入的处理器能读本地文件再外传——不是理论风险。
 */
export function escAttr(value: unknown): string {
  return esc(value)
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('`', '&#96;')
}

/** 数字字段：非有限值或越界一律回 fallback，并钳进 [lo, hi]。 */
export function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

/** 整数字段（先四舍五入再钳位）。 */
export function int(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(v)))
}

/** 字符串字段：非字符串给空串，去首尾空白，超长截断。 */
export function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  return t.length > max ? t.slice(0, max) : t
}

/** 必填字符串字段：空则回 fallback（标题一类的兜底文案）。 */
export function strOr(v: unknown, max: number, fallback: string): string {
  return str(v, max) || fallback
}

/** 布尔字段：只有显式 false 才算 false（缺省 true 的写法）。 */
export function boolOrTrue(v: unknown): boolean {
  return v !== false
}

/** 布尔字段：只有显式 true 才算 true（缺省 false 的写法）。 */
export function boolOrFalse(v: unknown): boolean {
  return v === true
}

/** 枚举字段：不在白名单里回 fallback。 */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : fallback
}

/** 数组字段：非数组给空数组。 */
export function arr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : []
}

/**
 * 逐对象解析数组字段（带上限）。
 *
 * 三个约定，所有 kind 一致：
 *  · 非对象项直接跳过（不占额度）；
 *  · `pick` 返回 undefined 表示这一项不合格，同样跳过；
 *  · 上限只数**合格项**——模型多写了几个空的不会挤掉后面的真数据。
 */
export function pickAll<T>(raw: unknown, limit: number, pick: (item: Record<string, unknown>) => T | undefined): T[] {
  const out: T[] = []
  for (const item of arr(raw)) {
    if (out.length >= limit) break
    if (typeof item !== 'object' || item === null) continue
    const parsed = pick(item as Record<string, unknown>)
    if (parsed !== undefined) out.push(parsed)
  }
  return out
}

/** 数字数组（过滤非有限值）。 */
export function nums(v: unknown, limit = 64): number[] {
  const out: number[] = []
  for (const item of arr(v)) {
    if (out.length >= limit) break
    if (typeof item === 'number' && Number.isFinite(item)) out.push(item)
  }
  return out
}

/** 数字显示：保留两位小数、去掉多余的 0（对话流与截图共用同一份）。 */
export function formatNum(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return String(Math.round(v * 100) / 100)
}

/**
 * 系列配色（按下标取模）。
 *
 * 对话流与截图**必须**共用这一份：各写一份就会漂移成「同一张图在两处不同色」。
 */
export const SERIES_COLORS = ['#4176e6', '#e67e22', '#27ae60', '#9b59b6', '#e84393', '#00b894'] as const

/** 按系列下标取色。 */
export function seriesColor(i: number): string {
  return SERIES_COLORS[((i % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length] as string
}

/**
 * 状态语义色（新增 kind 里表示「好/坏/中/待办」时一律走这四个，不要自己挑颜色）。
 *
 * 用 var() 带兜底：跟随宿主主题，宿主没定义时也不会变成透明。
 */
export const STATE_COLORS = {
  ok: 'var(--dsw-alias-state-success-primary, #27ae60)',
  warn: 'var(--dsw-alias-state-warning-primary, #e67e22)',
  bad: 'var(--dsw-alias-state-error-primary, #e8503a)',
  idle: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.6))',
  brand: 'var(--dsw-alias-state-business-primary, #4176e6)',
} as const
