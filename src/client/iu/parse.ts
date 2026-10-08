/**
 * dsh-chat-plus — iu 围栏解析（对话流内嵌原生交互卡片）。
 *
 * 与 diagram / proto-tabs 同通道：正文 markdown 里的 iu 代码围栏 → IuCard。
 * 语义差异：diagram 是静态 SVG，iu 是带本地状态的原生 React 组件
 * （滑块 / 图表 / 清单 / 对比），主题与动效跟随宿主，不走 iframe 沙箱。
 *
 * 四个关键取舍（与 html-embed/parse.ts 同构）：
 *  1. 语言标记必须精确是 iu（iu-preview 这类不吞），大小写不敏感。
 *  2. 非法 JSON / 结构不对 → 当普通 markdown 原样渲染，绝不抛错。
 *  3. 流式期未闭合围栏 → pending 占位（只占位，不按半截 JSON 渲染）。
 *  4. 超长一律回退原文。
 */

export type IuKind = 'slider' | 'chart' | 'checklist' | 'tabs' | 'piano'

export interface IuSliderOutput {
  readonly label: string
  readonly per: number
  readonly unit: string
}

export interface IuSliderSpec {
  readonly kind: 'slider'
  readonly title: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly unit: string
  readonly desc: string
  readonly outputs: readonly IuSliderOutput[]
}

export interface IuChartSeries {
  readonly name: string
  readonly values: readonly number[]
}

export interface IuChartSpec {
  readonly kind: 'chart'
  readonly title: string
  readonly chart: 'bar' | 'line'
  readonly labels: readonly string[]
  readonly series: readonly IuChartSeries[]
  readonly unit: string
}

export interface IuCheckItem {
  readonly label: string
  readonly desc: string
}

export interface IuChecklistSpec {
  readonly kind: 'checklist'
  readonly title: string
  readonly items: readonly IuCheckItem[]
}

export interface IuTabsTab {
  readonly label: string
  readonly heading: string
  readonly body: string
}

export interface IuTabsSpec {
  readonly kind: 'tabs'
  readonly title: string
  readonly tabs: readonly IuTabsTab[]
}

/**
 * 钢琴键盘卡片。
 *
 * 为什么做成 iu 而不是 html 沙箱卡片：发声要 Web Audio，而沙箱 iframe 是
 * opaque origin（连 localStorage 都没有）；虽然 AudioContext 在沙箱里能用，
 * 但键盘手感、主题跟随、动效都与宿主一致才像「对话里的一张琴」，而不是
 * 嵌进来的一小块网页。原生组件还能顺手把弹过的音回写成简谱。
 */
export interface IuPianoSpec {
  readonly kind: 'piano'
  readonly title: string
  readonly desc: string
  /** 起始八度（科学音高记号，C4 = 中央 C）。 */
  readonly octave: number
  /** 显示几个八度（1–3）。 */
  readonly octaves: number
  /** 音色：sine 柔和 / triangle 清亮 / square 电子 / sawtooth 明亮。 */
  readonly wave: 'sine' | 'triangle' | 'square' | 'sawtooth'
  /** 琴键上标注音名（C D E…）。 */
  readonly showNotes: boolean
}

export type IuSpec = IuSliderSpec | IuChartSpec | IuChecklistSpec | IuTabsSpec | IuPianoSpec

export type IuPart =
  | { readonly kind: 'md'; readonly text: string }
  | { readonly kind: 'iu'; readonly spec: IuSpec; readonly pending: false }
  | { readonly kind: 'iu'; readonly pending: true; readonly bytes: number }

/** 单个 iu 围栏的内容上限（字符）。JSON 配参数很小，超了多半是贴错了东西。 */
const MAX_IU_CHARS = 20_000

const TICK = String.fromCharCode(96)
/**
 * 围栏正则：iu + 行尾 + 任意内容 + 收尾反引号。
 *
 * 语言标记后必须直接换行（只允许行尾空白），因此 iu-preview、
 * ius 这类标记不会被误吞；i 标志容忍模型写成 IU。
 * 只匹配闭合围栏；流式期半截围栏由 findOpenFence 走 pending 那条路。
 */
const FENCE = new RegExp(
  TICK.repeat(3) + 'iu' + '[ \\t]*\\r?\\n([\\s\\S]*?)' + TICK.repeat(3),
  'gi',
)

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  return t.length > max ? t.slice(0, max) : t
}

function asSlider(raw: Record<string, unknown>): IuSliderSpec | undefined {
  let min = num(raw.min, -1000000, 1000000, 1)
  let max = num(raw.max, -1000000, 1000000, 10)
  if (!(max > min)) max = min + 1
  const stepRaw = num(raw.step, 0, 1000000, 1)
  const step = stepRaw > 0 ? stepRaw : 1
  const value = Math.min(max, Math.max(min, num(raw.value, min, max, min)))
  const outputsRaw = Array.isArray(raw.outputs) ? raw.outputs : []
  const outputs: IuSliderOutput[] = []
  for (const item of outputsRaw) {
    if (outputs.length >= 8) break
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const label = str(it.label, 16)
    if (label === '') continue
    outputs.push({ label, per: num(it.per, 0, 1000000000, 0), unit: str(it.unit, 8) })
  }
  return {
    kind: 'slider',
    title: str(raw.title, 40) || '取值',
    min,
    max,
    step,
    value,
    unit: str(raw.unit, 8),
    desc: str(raw.desc, 80),
    outputs,
  }
}

function asChart(raw: Record<string, unknown>): IuChartSpec | undefined {
  const labelsRaw = Array.isArray(raw.labels) ? raw.labels : []
  const labels: string[] = []
  for (const item of labelsRaw) {
    if (labels.length >= 12) break
    const s = str(item, 12)
    if (s !== '') labels.push(s)
  }
  const seriesRaw = Array.isArray(raw.series) ? raw.series : []
  const series: IuChartSeries[] = []
  for (const item of seriesRaw) {
    if (series.length >= 4) break
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const valuesRaw = Array.isArray(it.values) ? it.values : []
    const values: number[] = []
    for (const v of valuesRaw) {
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
    }
    if (values.length === 0) continue
    series.push({ name: str(it.name, 16) || '系列', values })
  }
  if (labels.length === 0 || series.length === 0) return undefined
  // 对齐到最短长度：缺数据就截断，绝不凭空补 0（那是编造数据）。
  let n = labels.length
  for (const s of series) n = Math.min(n, s.values.length)
  if (n < 1) return undefined
  return {
    kind: 'chart',
    title: str(raw.title, 40) || '对比',
    chart: raw.chart === 'line' ? 'line' : 'bar',
    labels: labels.slice(0, n),
    series: series.map(s => ({ name: s.name, values: s.values.slice(0, n) })),
    unit: str(raw.unit, 8),
  }
}

function asChecklist(raw: Record<string, unknown>): IuChecklistSpec | undefined {
  const itemsRaw = Array.isArray(raw.items) ? raw.items : []
  const items: IuCheckItem[] = []
  for (const item of itemsRaw) {
    if (items.length >= 12) break
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const label = str(it.label, 40)
    if (label === '') continue
    items.push({ label, desc: str(it.desc, 80) })
  }
  if (items.length === 0) return undefined
  return { kind: 'checklist', title: str(raw.title, 40) || '清单', items }
}

function asTabs(raw: Record<string, unknown>): IuTabsSpec | undefined {
  const tabsRaw = Array.isArray(raw.tabs) ? raw.tabs : []
  const tabs: IuTabsTab[] = []
  for (const item of tabsRaw) {
    if (tabs.length >= 6) break
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const label = str(it.label, 12)
    if (label === '') continue
    const heading = str(it.heading, 60)
    const body = str(it.body, 500)
    if (heading === '' && body === '') continue
    tabs.push({ label, heading, body })
  }
  if (tabs.length === 0) return undefined
  return { kind: 'tabs', title: str(raw.title, 40) || '对比', tabs }
}

/** 允许的音色（与 IuPianoSpec['wave'] 一致）。 */
const PIANO_WAVES = new Set(['sine', 'triangle', 'square', 'sawtooth'])

function asPiano(raw: Record<string, unknown>): IuPianoSpec | undefined {
  // 八度钳到 [0,7]：C8 = 4186Hz 已是听觉上限，再高就没意义了；
  // 负八度同理（C0 = 16.35Hz 接近次声）。
  const octave = Math.round(num(raw.octave, 0, 7, 4))
  const octaves = Math.round(num(raw.octaves, 1, 3, 1))
  const waveRaw = typeof raw.wave === 'string' ? raw.wave : ''
  return {
    kind: 'piano',
    title: str(raw.title, 40) || '钢琴',
    desc: str(raw.desc, 80),
    octave,
    octaves,
    wave: (PIANO_WAVES.has(waveRaw) ? waveRaw : 'sine') as IuPianoSpec['wave'],
    showNotes: raw.showNotes !== false,
  }
}

function asSpec(raw: unknown): IuSpec | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  switch (obj.kind) {
    case 'slider': return asSlider(obj)
    case 'chart': return asChart(obj)
    case 'checklist': return asChecklist(obj)
    case 'tabs': return asTabs(obj)
    case 'piano': return asPiano(obj)
    default: return undefined
  }
}

/**
 * 找出文本里最后一个未闭合的代码围栏（与 html-embed/parse.ts 同算法）。
 *
 * 逐行 toggle：遇到围栏标记行就在围栏内外翻转，扫完仍在围栏内的那个就是
 * 没闭合的。这里只处理半截输入，正则匹配不了它，只能逐行扫描。
 */
function findOpenFence(text: string): { lang: string; fenceStart: number; bodyStart: number } | undefined {
  let open: { lang: string; fenceStart: number; bodyStart: number } | undefined
  let cursor = 0
  for (const line of text.split('\n')) {
    const lineStart = cursor
    cursor += line.length + 1
    const fence = /^\s{0,3}(?:`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/.exec(line)
    if (fence === null) continue
    if (open === undefined) {
      open = { lang: (fence[1] ?? '').toLowerCase(), fenceStart: lineStart, bodyStart: cursor }
    } else {
      open = undefined
    }
  }
  return open
}

/**
 * 廉价预判：正文里是否可能存在 iu 围栏。
 *
 * 只做一次正则（调用方在正文渲染热路径上用它决定要不要走切分）。
 * 后瞻排除 iu-preview / ius 这类更长的标记，免得每次都白跑一遍切分。
 */
export function looksLikeIuFence(text: string): boolean {
  return text.indexOf(TICK.repeat(3)) >= 0 && /`{3}\s*iu(?![A-Za-z0-9_-])/i.test(text)
}

/**
 * 把 text 切成 markdown 片段与 iu 卡片；无围栏时返回整段 md。
 *
 * @param streaming 是否处于流式输出中。true 时末尾未闭合的 iu 围栏会产出一个
 *   pending 占位卡片；false（已定稿）时未闭合围栏原样当代码块显示。
 */
export function splitIu(text: string, streaming = false): readonly IuPart[] {
  if (!looksLikeIuFence(text)) return [{ kind: 'md', text }]
  const parts: IuPart[] = []
  let cursor = 0
  FENCE.lastIndex = 0
  for (;;) {
    const match = FENCE.exec(text)
    if (match === null) break
    const head = text.slice(cursor, match.index)
    if (head !== '') parts.push({ kind: 'md', text: head })
    const body = (match[1] ?? '').trim()
    let spec: IuSpec | undefined
    if (body !== '' && body.length <= MAX_IU_CHARS && body.charAt(0) === '{') {
      try {
        spec = asSpec(JSON.parse(body))
      } catch {
        spec = undefined
      }
    }
    if (spec === undefined) {
      parts.push({ kind: 'md', text: match[0] as string })
    } else {
      parts.push({ kind: 'iu', spec, pending: false })
    }
    cursor = match.index + (match[0] as string).length
  }
  let tail = text.slice(cursor)

  // 未闭合围栏：流式期换成占位卡；定稿态回退原文（被截断的历史消息不该
  // 永远停在等待态）。
  if (streaming && tail !== '') {
    const open = findOpenFence(tail)
    if (open !== undefined && open.lang === 'iu') {
      const head = tail.slice(0, open.fenceStart)
      if (head !== '') parts.push({ kind: 'md', text: head })
      const partial = tail.slice(open.bodyStart)
      parts.push({ kind: 'iu', pending: true, bytes: partial.length })
      tail = ''
    }
  }

  if (tail !== '') parts.push({ kind: 'md', text: tail })
  return parts.length > 0 ? parts : [{ kind: 'md', text }]
}
