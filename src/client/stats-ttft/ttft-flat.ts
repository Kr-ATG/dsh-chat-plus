/**
 * dsh-chat-plus — 首 token 平均平铺：纯逻辑层（平均值、时长格式、窗口回退）。
 *
 * 定位：官方会话统计把首 token 平均藏在点开的卡片里，这里把它拎到输入框下的
 * 状态栏。数据口径与官方完全一致 —— 有 sessionStats 投影用投影（整场会话），
 * 没有则用窗口内 assistant 节点现算（与官方 StatsPills 的回退同源）。
 *
 * 本文件只放纯函数：冒烟直接断言口径，不断言 DOM。
 */

export interface TtftStatsLike {
  readonly ttftMs?: unknown
  readonly ttftSteps?: unknown
}

export type FlatTranslate = (key: string, params?: Record<string, unknown>) => string

/**
 * 会话级首 token 平均（毫秒）。无记录时返回 null（调用方不渲染）。
 *
 * @param stats - sessionStats 投影或窗口回退的合计值。
 * @returns 平均毫秒数，无有效步数时为 null。
 */
export function ttftAverageMs(stats: TtftStatsLike | undefined | null): number | null {
  if (typeof stats !== 'object' || stats === null) return null
  const ms = (stats as { ttftMs?: unknown }).ttftMs
  const steps = (stats as { ttftSteps?: unknown }).ttftSteps
  if (typeof ms !== 'number' || typeof steps !== 'number') return null
  if (!Number.isFinite(ms) || !Number.isFinite(steps)) return null
  if (steps <= 0 || ms < 0) return null
  return ms / steps
}

/**
 * 紧凑时长：60 秒内一位小数，之上分秒。与官方 formatDuration 同口径。
 *
 * @param ms - 时长毫秒数。
 * @param t - chat 命名空间的语言座位，缺席走中文兜底。
 * @returns 本地化时长文本。
 */
export function formatFlatDuration(ms: number, t?: FlatTranslate): string {
  const s = Math.max(0, ms) / 1000
  if (s < 60) {
    const seconds = Math.round(s * 10) / 10
    if (t !== undefined) {
      try {
        return t('duration.compactSeconds', { seconds })
      } catch {
        // 语言座位异常时走中文兜底
      }
    }
    return seconds + '秒'
  }
  const whole = Math.round(s)
  const minutes = Math.floor(whole / 60)
  const seconds = whole % 60
  if (t !== undefined) {
    try {
      return t('duration.compactMinutes', { minutes, seconds })
    } catch {
      // 同上
    }
  }
  return minutes + '分' + seconds + '秒'
}

/**
 * 平铺前缀：中文环境用首 token，英文环境用 TTFT。
 * 由单位里有没有秒字判定，不新增任何 locale key。
 *
 * @param t - chat 命名空间的语言座位，缺席即中文。
 * @returns 前缀文本（含尾随空格）。
 */
export function ttftFlatPrefix(t?: FlatTranslate): string {
  if (t !== undefined) {
    try {
      const probe = t('duration.compactSeconds', { seconds: 1 })
      if (typeof probe === 'string' && probe.indexOf('秒') < 0) return 'TTFT '
    } catch {
      // 判定失败即中文
    }
  }
  return '首 token '
}

/**
 * 状态栏上最终显示的一整串，无数据时返回 null（调用方卸载读数）。
 *
 * @param stats - sessionStats 投影或窗口回退的合计值。
 * @param t - chat 命名空间的语言座位。
 * @returns 平铺文本，无数据时为 null。
 */
export function ttftFlatText(stats: TtftStatsLike | undefined | null, t?: FlatTranslate): string | null {
  const avg = ttftAverageMs(stats)
  if (avg === null) return null
  return ttftFlatPrefix(t) + formatFlatDuration(avg, t)
}

/**
 * 无投影时的窗口回退：扫一遍窗口内 assistant 节点的 timing。
 * 只认 stepStartTime 与 firstTokenTime 都是有限数字的步子（与官方回退同源）。
 *
 * @param nodes - chat 快照 legacy.nodes。
 * @returns 合计值，输入非法时为 undefined。
 */
export function foldWindowTtft(nodes: readonly unknown[] | undefined | null): { ttftMs: number; ttftSteps: number } | undefined {
  if (!Array.isArray(nodes)) return undefined
  let ttftMs = 0
  let ttftSteps = 0
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const rec = node as { kind?: unknown; timing?: unknown }
    if (rec.kind !== 'assistant') continue
    if (typeof rec.timing !== 'object' || rec.timing === null) continue
    const timing = rec.timing as { stepStartTime?: unknown; firstTokenTime?: unknown }
    if (typeof timing.stepStartTime !== 'number' || typeof timing.firstTokenTime !== 'number') continue
    if (!Number.isFinite(timing.stepStartTime) || !Number.isFinite(timing.firstTokenTime)) continue
    ttftMs += Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    ttftSteps += 1
  }
  return { ttftMs, ttftSteps }
}
