/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— idle motion scheduling policy.
 *
 * Pure logic, kept separate from the React component so it is directly
 * testable (Node cannot type-strip .tsx). These rules are ported verbatim from
 * the macOS director (macos/Sources/IdleRobot.swift):
 *
 *  - 5–10s of rest between motions;
 *  - the previous motion is never replayed;
 *  - a rare \`dance\` every 20–40 min;
 *  - prefers-reduced-motion suppresses motion entirely.
 */

/** The nine base motions, in the upstream order. */
export const BASICS = ['blink', 'scan', 'tilt', 'nod', 'stretch', 'hop', 'balance', 'sneeze', 'sleep'] as const
export type Basic = typeof BASICS[number]
export type Motion = Basic | 'dance'

/** Clip durations the vendored exporter used (see tools/idle/export.mjs). */
const DURATION: Record<string, number> = { dance: 20.783, sleep: 9 }
const DEFAULT_DURATION = 7

/** Wall-clock length of one motion, in seconds. */
export function clipDuration(id: Motion): number {
  return DURATION[id] ?? DEFAULT_DURATION
}

/** Rest between motions: 5–10s, matching the macOS director. */
export function restSeconds(): number {
  return 5 + Math.random() * 5
}

/** The rare dance interval: 20–40 min, matching the macOS director. */
export function rareSeconds(): number {
  return 1200 + Math.random() * 1200
}

/**
 * Pick the next motion: the rare dance once its interval elapsed, otherwise a
 * basic motion that is NOT the one just played.
 * @param nowSeconds - current time on the same clock as nextRareAt.
 * @param nextRareAt - when the rare dance becomes due.
 * @param previous - the motion just played; excluded from the basic pool.
 * @param random - 0..1 source, injectable for deterministic tests.
 */
export function chooseMotion(
  nowSeconds: number,
  nextRareAt: number,
  previous: Motion | '',
  random: () => number = Math.random,
): Motion {
  if (nowSeconds >= nextRareAt) return 'dance'
  const pool = BASICS.filter((id) => id !== previous)
  if (pool.length === 0) return 'blink'
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index] ?? 'blink'
}

/** Reduced motion: honour the OS preference, like the macOS director. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
