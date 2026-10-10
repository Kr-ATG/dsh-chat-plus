/**
 * dsh-chat-plus — iu 钢琴键盘的几何计算（对话流与截图**同源**）。
 *
 * 为什么单独抽出来：同一个键盘要在两处画出来——
 *   · 对话流：kinds/piano.body.tsx 渲染成 React JSX（可弹、有 Web Audio）；
 *   · 截图页：kinds/piano.ts 的 snapshot() 拼成静态 HTML 字符串（无 JS 运行时）。
 * 如果两处各写一份坐标算法，迟早会漂移成「截图里的琴键和对话流里的不一样宽」。
 * 这里只做纯计算、不碰 DOM 也不碰框架，两边各自消费同一份结果。
 *
 * kind 的角标文案（IU_KIND_LABELS）已迁到 kinds/registry.ts——它跟着 kind 注册表
 * 走才能「漏一个 kind 编译不过」；几何模块只该管几何。
 *
 * 历史：chart 的几何（chartLayout / CHART_COLORS / BarRect / LineShape）曾在本
 * 文件里，随 chart kind 一起删除（柱状图改由 ```html 手写 SVG 承接）。
 */

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
