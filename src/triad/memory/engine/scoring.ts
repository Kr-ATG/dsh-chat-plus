/**
 * dsh-memory 评分引擎：importance 每天乘衰减、命中加分、分层判断。
 * 参考 openhanako 的评分衰减思路：被引用刷新衰减起点，低分条目不进入注入产物。
 */

import type { MemoryEntry } from '../types.js'
import { nowIso } from './store.js'

/** 衰减后的 importance（每天乘 (1 - λ)）。 */
export function decayImportance(importance: number, days: number, lambda: number): number {
  if (days <= 0) return importance
  const decayed = importance * Math.pow(1 - lambda, days)
  return Math.round(decayed * 100) / 100
}
/** 距离某时间的天数（不足 1 天按 0）。 */
export function daysSince(iso: string | null, from = new Date()): number {
  if (iso === null) return 0
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return 0
  return Math.max(0, Math.floor((from.getTime() - time) / 86_400_000))
}

/** 是否进入注入产物：pinned 无条件；否则 importance 达到阈值（仅短期层；长期层天然已沉淀）。 */
export function isInjectionEligible(entry: MemoryEntry, threshold: number): boolean {
  if (entry.pinned) return true
  if (entry.layer === 'long') return true
  return entry.importance >= threshold
}

/** 短期 → 长期沉淀判断：高价值或经时间检验。 */
export function shouldPromote(entry: MemoryEntry, threshold: number): boolean {
  if (entry.layer !== 'short') return false
  if (entry.importance >= threshold * 2) return true
  const age = daysSince(entry.updatedAt)
  if (age >= 14 && entry.importance >= threshold) return true
  return false
}

/**
 * 滚出窗口：超 60 天且 importance 低于阈值一半的短期条目直接删除。
 *
 * 这是**唯一按价值**（分数）而不是按概率（有没有被读到）删记忆的规则，
 * 因此它必须能真正生效：
 *   · 旧实现里 `threshold/2 = 2.25`，而提取 prompt 要求模型自评 ≥8 才值得记、
 *     代码又按 minImportance(7) 收 —— 初始 8 分的条目衰减 60 天后约 2.39，
 *     仍然 > 2.25，**永远滚不出去**，这条规则等于空转；
 *   · 现在改用与闲置清理同一个门槛（minImportanceForPrune 的一半），两条规则
 *     的严格程度才落在同一量级：低于门槛一半的才是「确实没价值」，
 *     在门槛与一半之间的交给「闲置清理 + 分数门槛」处理。
 */
export function shouldEvict(entry: MemoryEntry, threshold: number, importanceFloor = threshold): boolean {
  if (entry.layer !== 'short' || entry.pinned) return false
  const age = daysSince(entry.updatedAt)
  return age >= 60 && entry.importance < importanceFloor / 2
}

/** 注入排序分：pinned 最高，其次 importance 降序。 */
export function injectionRank(entry: MemoryEntry): number {
  return entry.pinned ? Number.POSITIVE_INFINITY : entry.importance
}
