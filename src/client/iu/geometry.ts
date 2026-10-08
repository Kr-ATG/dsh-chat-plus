/**
 * dsh-chat-plus — iu 图表的几何计算（对话流与截图**同源**）。
 *
 * 为什么单独抽出来：同一个图表要在两处画出来——
 *   · 对话流：IuCard 渲染成 React JSX（可交互、图例可点）；
 *   · 截图页：card.ts 拼成静态 HTML 字符串（无 JS 运行时，只能定格）。
 * 如果两处各写一份坐标算法，迟早会漂移成「截图里的柱子和对话流里的不一样高」。
 * 这里只做纯计算、不碰 DOM 也不碰框架，两边各自消费同一份结果。
 */

import type { IuChartSpec } from './parse.ts'

/** 系列配色（按系列下标取模；对话流与截图共用，保证同色）。 */
export const CHART_COLORS = ['#4176e6', '#e67e22', '#27ae60', '#9b59b6'] as const

/** 视口与内边距（viewBox 坐标，实际显示宽度由 CSS 拉伸）。 */
export const CHART_W = 320
export const CHART_H = 168
export const CHART_PAD_L = 8
export const CHART_PAD_T = 12
export const CHART_PAD_B = 20

/** 一根柱子。 */
export interface BarRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: string
  readonly value: number
}

/** 一条折线及其节点。 */
export interface LineShape {
  readonly name: string
  readonly color: string
  readonly points: string
  readonly dots: ReadonlyArray<{ readonly x: number; readonly y: number }>
}

/** 一张图表的完整几何。 */
export interface ChartLayout {
  readonly w: number
  readonly h: number
  readonly max: number
  /** 网格线的 y 坐标（从下往上 4 条）。 */
  readonly gridYs: readonly number[]
  /** 横轴 y 坐标。 */
  readonly axisY: number
  /** 横轴刻度：x 坐标 + 文本。 */
  readonly ticks: ReadonlyArray<{ readonly x: number; readonly text: string }>
  readonly bars: readonly BarRect[]
  readonly lines: readonly LineShape[]
}

/**
 * 计算图表几何。
 *
 * @param spec - 图表 spec（labels / series 已在 parse 层对齐到等长）。
 * @param hidden - 被图例关掉的系列下标（对话流用；截图传空集）。
 */
export function chartLayout(spec: IuChartSpec, hidden: ReadonlySet<number> = new Set()): ChartLayout {
  const vis = spec.series
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !hidden.has(i))
  let max = 0
  for (const { s } of vis) for (const v of s.values) if (v > max) max = v
  if (!(max > 0)) max = 1

  const n = spec.labels.length
  const innerW = CHART_W - CHART_PAD_L - 8
  const innerH = CHART_H - CHART_PAD_T - CHART_PAD_B
  const axisY = CHART_PAD_T + innerH

  const gridYs = [0.25, 0.5, 0.75, 1].map(f => CHART_PAD_T + innerH * (1 - f))
  const ticks = spec.labels.map((text, li) => ({
    x: CHART_PAD_L + 4 + (innerW - 8) * (n === 1 ? 0.5 : li / (n - 1)),
    text,
  }))

  const bars: BarRect[] = []
  if (spec.chart === 'bar') {
    const groupW = innerW / Math.max(1, n)
    const cols = vis.length
    const bw = Math.min(26, (groupW - 8) / Math.max(1, cols))
    for (let li = 0; li < n; li += 1) {
      vis.forEach(({ s, i }, si) => {
        const v = s.values[li] ?? 0
        const h = (v / max) * innerH
        bars.push({
          x: CHART_PAD_L + 4 + li * groupW + si * bw,
          y: CHART_PAD_T + innerH - h,
          w: Math.max(3, bw - 3),
          h: Math.max(1, h),
          color: CHART_COLORS[i % CHART_COLORS.length] as string,
          value: v,
        })
      })
    }
  }

  const lines: LineShape[] = spec.chart === 'line'
    ? vis.map(({ s, i }) => {
      const dots = s.values.map((v, li) => ({
        x: CHART_PAD_L + 4 + (innerW - 8) * (n === 1 ? 0.5 : li / (n - 1)),
        y: CHART_PAD_T + innerH - (v / max) * innerH,
      }))
      return {
        name: s.name,
        color: CHART_COLORS[i % CHART_COLORS.length] as string,
        points: dots.map(d => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' '),
        dots,
      }
    })
    : []

  return { w: CHART_W, h: CHART_H, max, gridYs, axisY, ticks, bars, lines }
}

// ── 钢琴键盘 ─────────────────────────────────────────────────────────────

/** 一个八度里 12 个半音的音名（升号写法）。 */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** 黑键在半音里的下标（C# D# F# G# A#）。 */
const BLACK_SET = new Set([1, 3, 6, 8, 10])

/** 一个琴键。 */
export interface PianoKey {
  /** MIDI 音高（C4 = 60）。 */
  readonly midi: number
  /** 音名（如 C4、F#5）。 */
  readonly name: string
  /** 是否黑键。 */
  readonly black: boolean
  /** 键的左边缘百分比（0–100）。 */
  readonly leftPct: number
  /** 键宽百分比。 */
  readonly widthPct: number
}

/**
 * 生成键盘布局。
 *
 * 白键等分整宽、黑键叠在两白键交界处（宽为白键的 0.62、位置偏移 -0.31 个白键宽）——
 * 与真钢琴一致。百分比坐标让键盘随容器自适应，不需要 JS 量宽。
 *
 * @param octave - 起始八度（C4 = 中央 C）。
 * @param octaves - 八度个数。
 */
export function pianoLayout(octave: number, octaves: number): readonly PianoKey[] {
  const total = octaves * 12
  const whiteCount = octaves * 7
  const keys: PianoKey[] = []
  let whiteIndex = 0
  for (let i = 0; i < total; i += 1) {
    const semi = i % 12
    const black = BLACK_SET.has(semi)
    const midi = (octave + 1) * 12 + i
    const name = `${NOTE_NAMES[semi]}${octave + Math.floor(i / 12)}`
    if (black) {
      // 黑键嵌在前一个白键的右侧：中心落在两白键交界处。
      const w = 100 / whiteCount
      keys.push({
        midi,
        name,
        black: true,
        leftPct: whiteIndex * w - w * 0.31,
        widthPct: w * 0.62,
      })
    } else {
      const w = 100 / whiteCount
      keys.push({ midi, name, black: false, leftPct: whiteIndex * w, widthPct: w })
      whiteIndex += 1
    }
  }
  return keys
}

/** MIDI 音高 → 频率（A4 = 440Hz，十二平均律）。 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** 音名 → 简谱唱名（用于回写；黑键带升号，直接标 ♯）。 */
export function noteToJianpu(name: string): string {
  const map: Record<string, string> = {
    C: '1', D: '2', E: '3', F: '4', G: '5', A: '6', B: '7',
  }
  const letter = name.charAt(0)
  const sharp = name.charAt(1) === '#'
  const base = map[letter] ?? '?'
  return sharp ? `♯${base}` : base
}

/** 琴键宽度百分比（供截图快照复用同一套布局算法）。 */
export function pianoKeyWidth(octaves: number): number {
  return 100 / (octaves * 7)
}

/** 数字显示：保留两位小数、去掉多余的 0（对话流与截图共用）。 */
export function formatNum(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return String(Math.round(v * 100) / 100)
}
