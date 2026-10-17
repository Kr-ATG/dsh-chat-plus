/**
 * ObserveChart — 「观测 / 用量」大盘中段的按日堆叠柱状图。
 *
 * 为什么自绘：需求是「一天一根柱、柱内按模型分层、点某天下钻当天」，而「不新增
 * 依赖」是红线；图表库为这点需求要拖进几十 KB，还要覆写一整套主题色。这里用内联
 * SVG 画柱与网格、用 HTML 浮层做卡片式 tooltip，颜色全部从官方主题 token 混出来，
 * 亮暗两套由官方 body 属性自动切换。
 *
 * 口径（全部从 props 来，组件不取数、不请求）：
 *  - tokens / requests 是可加量，按模型堆叠；
 *  - speed 是速率，速率不可加，堆叠会造出一个并不存在的「合计出速」，所以该口径下
 *    画单色柱（当天平均出速），各模型出速只在 tooltip 里逐条列。
 *
 * 与主壳的分工：范围窗口由主壳决定（默认近 30 天），本组件只做排序、去重与一个
 * 纯可读性上限的截断，不擅自改范围、不改数据。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObserveDayStat, ObserveMetric, ObserveModelStat } from './observe-types'
import { formatExact, formatUnits } from './format'

const STYLE_ID = 'dsh-observe-chart-styles'

/** 绘图区总高：与右侧拆分列表同高，让主壳的两栏排版不用猜高度。 */
const PLOT_HEIGHT = 248
const PAD_LEFT = 46
const PAD_RIGHT = 10
const PAD_TOP = 16
const PAD_BOTTOM = 24
const PLOT_TOP = PAD_TOP
const BOTTOM = PLOT_HEIGHT - PAD_BOTTOM

/**
 * 单次渲染的柱数上限。超过时只画最近这些天并在右上角标注——直接全部画出来柱子会
 * 细到不可点，而静默丢掉更早的天数会让人以为「那段时间没用量」，所以截断必须可见。
 */
const MAX_BARS = 90

/**
 * 段色阶：只用官方强调色的明度阶，不发明新色相。混色对象取 label-primary ——
 * 亮色主题里它是近黑（段越靠后越深），暗色主题里它是近白（段越靠后越亮），
 * 同一套规则在两种主题下都朝「与背景反差更大」的方向走，所以不必写第二份色表。
 */
export const SEGMENT_TOKENS = `
  --obs-seg-0: var(--dsw-alias-state-business-primary, #4176e6);
  --obs-seg-1: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 84%, var(--dsw-alias-label-primary, #0f1115));
  --obs-seg-2: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 68%, var(--dsw-alias-label-primary, #0f1115));
  --obs-seg-3: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 53%, var(--dsw-alias-label-primary, #0f1115));
  --obs-seg-4: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 39%, var(--dsw-alias-label-primary, #0f1115));
  --obs-seg-5: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 27%, var(--dsw-alias-label-primary, #0f1115));
  --obs-seg-6: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 17%, var(--dsw-alias-label-primary, #0f1115));
  --obs-seg-7: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 10%, var(--dsw-alias-label-primary, #0f1115));
  --obs-seg-other: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 34%, transparent);
`

export const OBSERVE_SEG_RANKS = 8
export const OBSERVE_SEG_OTHER_COLOR = 'var(--obs-seg-other)'

/** 第 rank 名的段色（rank 越界时退回「其他」色）。 */
export function observeSegColor(rank: number): string {
  if (!Number.isFinite(rank) || rank < 0 || rank >= OBSERVE_SEG_RANKS) return OBSERVE_SEG_OTHER_COLOR
  return `var(--obs-seg-${Math.floor(rank)})`
}

/**
 * 按口径权重给模型排名，柱图与右侧拆分列表共用同一份规则——两边各排一次的话，
 * 同一个模型会在柱子里是蓝、在列表里是紫。同权重按名字升序兜底，保证确定性。
 */
export function rankObserveModels(entries: Array<{ model: string; weight: number }>): Map<string, number> {
  const sorted = [...entries].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    return a.model < b.model ? -1 : a.model > b.model ? 1 : 0
  })
  const out = new Map<string, number>()
  sorted.forEach((entry, index) => { out.set(entry.model, index) })
  return out
}

/** 注入式样式表。CSS 正文里不写注释，避免任何注释闭合序列把后面的规则拖成非法选择器。 */
const SHEET = `
.obs-chart {
  position: relative;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary, #0f1115);
  ${SEGMENT_TOKENS}
}
.obs-chart-plot { position: relative; width: 100%; min-width: 0; }
.obs-chart-svg { display: block; width: 100%; overflow: visible; }
.obs-chart-grid { stroke: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08)); stroke-width: 1; stroke-dasharray: 3 4; }
.obs-chart-baseline { stroke: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16)); stroke-width: 1; }
.obs-chart-tick { stroke: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16)); stroke-width: 1; }
.obs-chart-axis { fill: var(--dsw-alias-label-tertiary, #81858c); font-size: 10px; font-variant-numeric: tabular-nums; }
.obs-chart-axis-unit { fill: var(--dsw-alias-label-tertiary, #81858c); font-size: 9.5px; }
.obs-chart-xlab { fill: var(--dsw-alias-label-tertiary, #81858c); font-size: 10px; font-variant-numeric: tabular-nums; }
.obs-chart-xlab[data-active='true'] { fill: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; }
.obs-chart-bar { transition: opacity 200ms cubic-bezier(0.2, 0.8, 0.2, 1); animation: obs-bar-grow 560ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }
.obs-chart-bar[data-dim='true'] { opacity: 0.34; }
.obs-chart-seg { transition: filter 180ms ease; }
.obs-chart-bar[data-active='true'] .obs-chart-seg { filter: saturate(1.14) brightness(1.06); }
.obs-chart-bar[data-selected='true'] .obs-chart-seg { stroke: var(--dsw-alias-label-primary, #0f1115); stroke-width: 0.8; stroke-opacity: 0.45; }
.obs-chart-hit { fill: transparent; cursor: pointer; }
.obs-chart-hit:hover { fill: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 7%, transparent); }
.obs-chart-hit:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: -2px; }
@keyframes obs-bar-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.obs-tip {
  position: absolute;
  top: 6px;
  z-index: 4;
  box-sizing: border-box;
  padding: 9px 11px 10px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-base, #fff));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  font-size: 11.5px;
  line-height: 16px;
  pointer-events: none;
  transition: opacity 140ms ease, transform 170ms cubic-bezier(0.22, 0.61, 0.36, 1), left 180ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
body[data-ds-dark-theme] .obs-tip { box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55); }
.obs-tip[data-show='true'] { opacity: 1; transform: translateY(0); }
.obs-tip[data-show='false'] { opacity: 0; transform: translateY(4px); }
.obs-tip-date { margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }
.obs-tip-row { display: flex; align-items: center; gap: 6px; }
.obs-tip-row + .obs-tip-row { margin-top: 2px; }
.obs-tip-dot { flex: none; width: 8px; height: 8px; border-radius: 2px; }
.obs-tip-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #61666b); }
.obs-tip-val { flex: none; color: var(--dsw-alias-label-primary, #0f1115); font-variant-numeric: tabular-nums; }
.obs-tip-val[data-muted='true'] { color: var(--dsw-alias-label-tertiary, #81858c); }
.obs-tip-sep { height: 1px; margin: 7px 0 6px; background: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08)); }
.obs-tip-sum { display: flex; align-items: baseline; gap: 6px; }
.obs-tip-sum-k { flex: none; color: var(--dsw-alias-label-secondary, #61666b); }
.obs-tip-sum-v { flex: 1 1 auto; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.obs-tip-sum-r { flex: none; color: var(--dsw-alias-label-tertiary, #81858c); font-variant-numeric: tabular-nums; }
.obs-tip-note { margin-top: 4px; font-size: 10.5px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #81858c); }
.obs-chart-clamp { flex: none; margin-left: auto; font-size: 10.5px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #81858c); }
.obs-chart-empty { display: flex; align-items: center; justify-content: center; min-height: 160px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.obs-chart-notice { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 76%; padding: 7px 11px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08)); background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08)); font-size: 11.5px; line-height: 16px; text-align: center; color: var(--dsw-alias-label-secondary, #61666b); }
@media (prefers-reduced-motion: reduce) {
  .obs-chart-bar { animation: none !important; }
  .obs-chart-bar, .obs-chart-seg, .obs-tip, .obs-chart-hit { transition: none !important; }
}
`

/** 幂等注入柱状图样式：同一个 id 只建一次，插件卸载时由 loader 连带清掉。 */
export function ensureObserveChartStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.dataset.pluginCss = 'triad/observe-chart'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

export interface ObserveChartProps {
  days: ObserveDayStat[]
  metric: ObserveMetric
  highlightDate?: string | null
  onSelectDate?: (date: string | null) => void
}

/** 一段堆叠（或一行 tooltip 明细）。 */
interface ObserveSeg {
  key: string
  label: string
  value: number
  color: string
}

interface ObserveBar {
  date: string
  /** 画在柱上的合计高度（speed 口径下就是当天平均出速）。 */
  total: number
  segs: ObserveSeg[]
  /** tooltip 明细：多数口径下与 segs 同源，speed 口径下逐模型列出速率。 */
  detail: ObserveSeg[]
  requests: number
}

/** 四桶求和：host 未给 tokens 字段时的兜底口径。 */
function bucketSumOf(ms: ObserveModelStat): number {
  return (ms.inputTokens ?? 0) + (ms.outputTokens ?? 0) + (ms.cacheReadTokens ?? 0) + (ms.cacheWriteTokens ?? 0)
}

/** 单模型出速（token/秒）；计时字段缺失即不可得。 */
function modelSpeedOf(ms: ObserveModelStat): number | null {
  const tokens = ms.genTokens ?? 0
  const ms2 = ms.genMs ?? 0
  if (tokens <= 0 || ms2 <= 0) return null
  return tokens / (ms2 / 1000)
}

/** 当天平均出速：优先用日级计时，缺失时按各模型 tokens 加权——props 里只有 tokens 是可用的权重。 */
function daySpeedOf(day: ObserveDayStat): number {
  const tokens = day.genTokens ?? 0
  const genMs = day.genMs ?? 0
  if (tokens > 0 && genMs > 0) return tokens / (genMs / 1000)
  let sum = 0
  let weight = 0
  for (const ms of day.models ?? []) {
    const speed = modelSpeedOf(ms)
    if (speed === null) continue
    const w = ms.genTokens ?? ms.tokens ?? 0
    sum += speed * w
    weight += w
  }
  return weight > 0 ? sum / weight : 0
}

/** 单模型按当前 metric 的口径值。 */
function modelValueOf(ms: ObserveModelStat, metric: ObserveMetric): number {
  switch (metric) {
    case 'requests':
      return ms.requests ?? 0
    case 'speed':
      return modelSpeedOf(ms) ?? 0
    default:
      return ms.tokens ?? bucketSumOf(ms)
  }
}

/** 日级兜底口径：历史数据没有模型明细，只能整段呈现。 */
function dayValueOf(day: ObserveDayStat, metric: ObserveMetric): number {
  switch (metric) {
    case 'tokens': return day.tokens ?? ((day.inputTokens ?? 0) + (day.outputTokens ?? 0) + (day.cacheReadTokens ?? 0) + (day.cacheWriteTokens ?? 0))
    case 'requests': return day.requests ?? 0
    case 'speed': return daySpeedOf(day)
    default: return 0
  }
}

/**
 * 取值文本。导出是因为右栏拆分列表要显示同一口径的主值——两处各写一份必然漂移。
 */
export function observeMetricText(value: number, metric: ObserveMetric): string {
  if (metric === 'speed') return `${Math.round(value)} token/秒`
  return formatUnits(value)
}

function tickText(value: number, metric: ObserveMetric): string {
  return value === 0 ? '0' : formatUnits(value)
}

/** 步长取 1 / 2 / 2.5 / 5 × 10^n，保证刻度是整数好读。 */
function niceScale(max: number, count: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 }
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  const stepNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = stepNorm * magnitude
  const top = Math.ceil((max * 1.000001) / step) * step
  return { top, step }
}

export function ObserveChart(props: ObserveChartProps): JSX.Element {
  ensureObserveChartStyles()
  const { days, metric, highlightDate, onSelectDate } = props

  const hostRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)

  // 柱宽要按真实可用宽度算（数据点多时自动变细），所以量容器而不是拿 viewBox 缩放。
  useEffect(() => {
    const el = hostRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = entry.contentRect.width
        if (next > 0) setWidth(next)
      }
    })
    observer.observe(el)
    const initial = el.clientWidth
    if (initial > 0) setWidth(initial)
    return () => { observer.disconnect() }
  }, [])

  const { bars, clampNotice } = useMemo(() => {
    const dayMap = new Map<string, ObserveDayStat>()
    for (const day of days ?? []) {
      if (day === null || day === undefined) continue
      const date = typeof day.date === 'string' ? day.date.slice(0, 10) : ''
      if (date.length !== 10) continue
      dayMap.set(date, day)
    }
    const sorted = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    const truncated = sorted.length > MAX_BARS
    const used = truncated ? sorted.slice(sorted.length - MAX_BARS) : sorted

    // 排名口径必须与右侧拆分列表一致（同一模型同色），两边都用「期间内按当前 metric
    // 的可加合计」。
    const weights: Array<{ model: string; weight: number }> = []
    const weightMap = new Map<string, number>()
    for (const [, day] of used) {
      for (const ms of day.models ?? []) {
        weightMap.set(ms.model, (weightMap.get(ms.model) ?? 0) + modelValueOf(ms, metric))
      }
    }
    for (const [model, weight] of weightMap) weights.push({ model, weight })
    const rank = rankObserveModels(weights)

    const out: ObserveBar[] = []
    for (const [date, day] of used) {
      const models = day.models ?? []
      const requests = day.requests ?? models.reduce((sum, ms) => sum + (ms.requests ?? 0), 0)

      if (metric === 'speed') {
        // 速率不可加：柱子只表达「当天平均出速」，模型明细退到 tooltip。
        const detail: ObserveSeg[] = []
        for (const ms of models) {
          const speed = modelSpeedOf(ms)
          if (speed === null || speed <= 0) continue
          const ranked = rank.get(ms.model)
          detail.push({
            key: ms.model,
            label: ms.model,
            value: speed,
            color: observeSegColor(ranked === undefined ? -1 : ranked),
          })
        }
        detail.sort((a, b) => b.value - a.value)
        const average = daySpeedOf(day)
        out.push({
          date,
          total: average,
          segs: average > 0
            ? [{ key: '__speed', label: '当日平均出速', value: average, color: observeSegColor(0) }]
            : [],
          detail,
          requests,
        })
        continue
      }

      const grouped = new Map<string, ObserveSeg>()
      for (const ms of models) {
        const value = modelValueOf(ms, metric)
        if (value <= 0) continue
        const ranked = rank.get(ms.model)
        const isOther = ranked === undefined || ranked >= OBSERVE_SEG_RANKS
        const key = isOther ? '__other' : `m:${ms.model}`
        const current = grouped.get(key)
        if (current !== undefined) {
          current.value += value
          continue
        }
        grouped.set(key, {
          key,
          label: isOther ? '其他' : ms.model,
          value,
          color: isOther ? OBSERVE_SEG_OTHER_COLOR : observeSegColor(ranked as number),
        })
      }

      // 模型明细不足以分堆时整段呈现。两个触发条件都必须兜住：
      //  1) 这天压根没有 models（老格式数据）；
      //  2) 有 models 但每条 tokens 都是 0——从旧缓存迁移过来的会话就是这样，
      //     host 侧的模型桶曾经漏加 token，天级是对的、模型级全零。只判 1) 的话
      //     这些天会画成一根空柱，看起来像「这天没用量」，而实际上用了一整天的量。
      const modelSum = [...grouped.values()].reduce((sum, seg) => sum + seg.value, 0)
      const whole = dayValueOf(day, metric)
      if (modelSum <= 0 && whole > 0) {
        grouped.set('__all', { key: '__all', label: '未分类', value: whole, color: observeSegColor(0) })
      }

      const segs = [...grouped.values()].sort((a, b) => b.value - a.value)
      const total = segs.reduce((sum, seg) => sum + seg.value, 0)
      out.push({ date, total, segs, detail: segs, requests })
    }

    return {
      bars: out,
      clampNotice: truncated ? `已折叠更早的 ${sorted.length - MAX_BARS} 天` : '',
    }
  }, [days, metric])

  const geometry = useMemo(() => {
    const plotWidth = Math.max(80, width - PAD_LEFT - PAD_RIGHT)
    const step = bars.length > 0 ? plotWidth / bars.length : plotWidth
    const barWidth = Math.max(3, Math.min(30, step * 0.62))
    return { plotWidth, step, barWidth }
  }, [bars.length, width])

  const scale = useMemo(() => {
    let max = 0
    for (const bar of bars) if (bar.total > max) max = bar.total
    const nice = niceScale(max, 4)
    const ticks: number[] = []
    for (let value = 0; value <= nice.top + nice.step * 0.5; value += nice.step) ticks.push(value)
    return { top: nice.top, ticks }
  }, [bars])

  const [hoverDate, setHoverDate] = useState<string | null>(null)
  const tipBarRef = useRef<ObserveBar | null>(null)
  const hoverBar = hoverDate === null ? null : bars.find(bar => bar.date === hoverDate) ?? null
  if (hoverBar !== null) tipBarRef.current = hoverBar
  const tipBar = hoverBar ?? tipBarRef.current

  if (bars.length === 0) {
    return <div className="obs-chart"><div className="obs-chart-empty">所选范围暂无用量数据</div></div>
  }

  const yOf = (value: number): number => BOTTOM - (value / scale.top) * (BOTTOM - PLOT_TOP)
  // 轴单位贴在刻度列顶端：speed 口径的刻度值是 token/秒，纯数字读不出量纲。
  const unitLabel = metric === 'tokens' ? 'Token' : metric === 'requests' ? '请求' : 'token/秒'
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor(geometry.plotWidth / 66))))

  const tipIndex = tipBar === null ? -1 : bars.findIndex(bar => bar.date === tipBar.date)
  const tipWidth = Math.max(198, Math.min(276, width - 12))
  const tipCenter = tipIndex >= 0 ? PAD_LEFT + (tipIndex + 0.5) * geometry.step : 0
  const tipLeft = Math.min(Math.max(6, tipCenter - tipWidth / 2), Math.max(6, width - tipWidth - 6))

  return (
    <div className="obs-chart" ref={hostRef}>
      <div className="obs-chart-plot" style={{ height: PLOT_HEIGHT }}>
        <svg
          className="obs-chart-svg"
          width={width}
          height={PLOT_HEIGHT}
          viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
          role="img"
          aria-label="按日用量堆叠柱状图"
        >
          <text className="obs-chart-axis-unit" x={PAD_LEFT - 7} y={PLOT_TOP - 6} textAnchor="end">{unitLabel}</text>

          {scale.ticks.map(value => {
            const y = yOf(value)
            return (
              <g key={`tick-${value}`}>
                {value > 0 && <line className="obs-chart-grid" x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} />}
                <line className="obs-chart-tick" x1={PAD_LEFT - 4} y1={y} x2={PAD_LEFT} y2={y} />
                <text className="obs-chart-axis" x={PAD_LEFT - 7} y={y + 3} textAnchor="end">{tickText(value, metric)}</text>
              </g>
            )
          })}

          {bars.map((bar, index) => {
            const center = PAD_LEFT + (index + 0.5) * geometry.step
            const selected = highlightDate !== undefined && highlightDate !== null && highlightDate === bar.date
            const dim = highlightDate !== undefined && highlightDate !== null && highlightDate !== bar.date
            let cursor = BOTTOM
            const rects = bar.segs
              .filter(seg => seg.value > 0)
              .map(seg => {
                const rawHeight = (seg.value / scale.top) * (BOTTOM - PLOT_TOP)
                const height = Math.max(1, rawHeight - (rawHeight > 2.5 ? 1 : 0))
                const y = cursor - rawHeight
                cursor -= rawHeight
                return { seg, y, height }
              })
            return (
              <g
                key={`${metric}:${bar.date}`}
                className="obs-chart-bar"
                data-active={selected || (hoverBar !== null && hoverBar.date === bar.date) ? 'true' : 'false'}
                data-dim={dim ? 'true' : 'false'}
                data-selected={selected ? 'true' : 'false'}
                style={{ transformOrigin: `${center}px ${BOTTOM}px`, animationDelay: `${Math.min(index * 16, 380)}ms` }}
              >
                {rects.map(rect => (
                  <rect
                    key={rect.seg.key}
                    className="obs-chart-seg"
                    x={center - geometry.barWidth / 2}
                    y={rect.y}
                    width={geometry.barWidth}
                    height={rect.height}
                    rx={rect.y <= PLOT_TOP + 0.5 ? Math.min(2, geometry.barWidth / 4) : 0}
                    fill={rect.seg.color}
                  />
                ))}
                <rect
                  className="obs-chart-hit"
                  x={center - geometry.step / 2}
                  y={PLOT_TOP}
                  width={geometry.step}
                  height={BOTTOM - PLOT_TOP}
                  tabIndex={0}
                  onMouseEnter={() => { setHoverDate(bar.date) }}
                  onMouseLeave={() => { setHoverDate(null) }}
                  onFocus={() => { setHoverDate(bar.date) }}
                  onBlur={() => { setHoverDate(null) }}
                  onClick={() => {
                    if (onSelectDate === undefined) return
                    onSelectDate(selected ? null : bar.date)
                  }}
                />
              </g>
            )
          })}

          <line className="obs-chart-baseline" x1={PAD_LEFT} y1={BOTTOM} x2={width - PAD_RIGHT} y2={BOTTOM} />

          {bars.map((bar, index) => {
            if (index % labelEvery !== 0 && index !== bars.length - 1) return null
            const center = PAD_LEFT + (index + 0.5) * geometry.step
            return (
              <text
                key={`xlab-${bar.date}`}
                className="obs-chart-xlab"
                data-active={highlightDate === bar.date ? 'true' : 'false'}
                x={center}
                y={BOTTOM + 15}
                textAnchor="middle"
              >
                {bar.date.slice(5)}
              </text>
            )
          })}
        </svg>


        {tipBar !== null && (
          <div className="obs-tip" data-show={hoverBar === null ? 'false' : 'true'} style={{ left: tipLeft, width: tipWidth }}>
            <div className="obs-tip-date">{tipBar.date.replace(/-/g, '/')}</div>
            {tipBar.detail.map(item => (
              <div className="obs-tip-row" key={`d-${item.key}`}>
                <span className="obs-tip-dot" style={{ background: item.color }} />
                <span className="obs-tip-name" title={item.label}>{item.label}</span>
                <span className="obs-tip-val">{observeMetricText(item.value, metric)}</span>
              </div>
            ))}
            <div className="obs-tip-sep" />
            <div className="obs-tip-sum">
              <span className="obs-tip-sum-k">合计</span>
              <span className="obs-tip-sum-v">{observeMetricText(tipBar.total, metric)}</span>
              <span className="obs-tip-sum-r">· {formatExact(tipBar.requests)} 请求</span>
            </div>
          </div>
        )}
      </div>

      {clampNotice !== '' && <div className="obs-chart-clamp">{clampNotice}</div>}
    </div>
  )
}
