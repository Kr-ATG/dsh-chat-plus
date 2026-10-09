/**
 * iu kind: **chart**（柱状 / 折线，支持负数与图例开关）。
 *
 * 几何全部来自 geometry.ts 的 chartLayout —— 对话流（chart.body.tsx）与截图
 * （本文件 snapshot）消费**同一份算法**，两处永不漂移（柱子不会一边高一边矮）。
 *
 * 两个历史 bug 已在 chartLayout 修复（详见 geometry.ts 注释）：
 *  1. 负数柱不可见（老实现 max 只从 0 起算）；
 *  2. bar 模式刻度与柱子错位（刻度按折线坐标系均分）。
 *
 * ⚠ 本文件零 React、零 DOM。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, esc, escAttr, formatNum, num, str, strOr } from './core.ts'
import { CHART_COLORS, chartLayout } from '../geometry.ts'

export interface IuChartSeries {
  readonly name: string
  readonly values: readonly number[]
}

export interface IuChartSpec extends IuSpecBase {
  readonly kind: 'chart'
  readonly title: string
  /** 图表类型：柱状 / 折线 / 面积（面积=折线+渐变填充，共享同一套几何）。 */
  readonly chart: 'bar' | 'line' | 'area'
  readonly labels: readonly string[]
  readonly series: readonly IuChartSeries[]
  readonly unit: string
}

/** chart 的本地状态：被图例关掉的系列下标。 */
export interface ChartState extends IuState {
  readonly hidden: readonly number[]
}

function parse(raw: Record<string, unknown>): IuChartSpec | undefined {
  const labels: string[] = []
  for (const item of arr(raw.labels)) {
    if (labels.length >= 12) break
    const s = str(item, 12)
    if (s !== '') labels.push(s)
  }
  const series: IuChartSeries[] = []
  for (const item of arr(raw.series)) {
    if (series.length >= 4) break
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const values: number[] = []
    for (const v of arr(it.values)) {
      if (values.length >= 64) break
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
    }
    if (values.length === 0) continue
    series.push({ name: strOr(it.name, 16, '系列'), values })
  }
  if (labels.length === 0 || series.length === 0) return undefined
  // 对齐到最短长度：缺数据就截断，绝不凭空补 0（那是编造数据）。
  let n = labels.length
  for (const s of series) n = Math.min(n, s.values.length)
  if (n < 1) return undefined
  const chartRaw = typeof raw.chart === 'string' ? raw.chart : 'bar'
  return {
    kind: 'chart',
    title: strOr(raw.title, 40, '对比'),
    chart: chartRaw === 'line' ? 'line' : chartRaw === 'area' ? 'area' : 'bar',
    labels: labels.slice(0, n),
    series: series.map(s => ({ name: s.name, values: s.values.slice(0, n) })),
    unit: str(raw.unit, 8),
  }
}

function initState(_spec: IuChartSpec): ChartState {
  return { hidden: [] }
}

/**
 * 回填文本**必须含真实数值**。
 *
 * 老实现只回「labels｜系列名」——用户点了「填入输入框」，模型却拿不到任何
 * 数字，等于白填。现在把每个可见系列逐 label 的数值拼进去（钳长防超长）。
 */
function fillText(spec: IuChartSpec, state: ChartState): string {
  const hidden = new Set(state.hidden)
  const vis = spec.series.map((s, i) => ({ s, i })).filter(({ i }) => !hidden.has(i))
  if (vis.length === 0) return `${spec.title}：（图例全关）`
  const parts = vis.map(({ s }) => `${s.name}[${s.values.map(v => formatNum(v)).join(', ')}]`)
  return `${spec.title}（${spec.chart === 'bar' ? '柱状' : spec.chart === 'line' ? '折线' : '面积'}，横轴 ${spec.labels.join('/')}）：${parts.join('；')}${spec.unit !== '' ? ` 单位:${spec.unit}` : ''}`
}

/**
 * SVG 静态快照（截图用）。
 *
 * 几何来自 chartLayout（与 chart.body.tsx 同源）；结构按 Body 的 JSX 逐字对齐
 * （class、层级、顺序）。line/area 共用折线几何，area 多一层补到零线的填充多边形。
 */
function snapshot(spec: IuChartSpec): string {
  const geo = chartLayout(spec)
  const legend = spec.series.map((s, i) =>
    `<span class="dtt-iu__chip"><span class="dtt-iu__swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${esc(s.name)}</span>`).join('')
  const grid = geo.gridYs.map(y =>
    `<line class="dtt-iu__grid" x1="8" x2="${geo.w - 8}" y1="${y}" y2="${y}"></line>`).join('')
  const zero = geo.min < 0
    ? `<line class="dtt-iu__axis" x1="8" x2="${geo.w - 8}" y1="${geo.zeroY}" y2="${geo.zeroY}"></line>`
    : ''
  const axis = `<line class="dtt-iu__axis" x1="8" x2="${geo.w - 8}" y1="${geo.axisY}" y2="${geo.axisY}"></line>`
  const ticks = geo.ticks.map(t =>
    `<text class="dtt-iu__tick" x="${t.x.toFixed(1)}" y="${geo.h - 6}" text-anchor="middle">${esc(t.text)}</text>`).join('')
  let marks = ''
  if (spec.chart === 'bar') {
    marks = geo.bars.map(bar =>
      `<rect class="dtt-iu__bar" x="${bar.x.toFixed(1)}" y="${bar.y.toFixed(1)}" width="${bar.w.toFixed(1)}" height="${bar.h.toFixed(1)}" rx="3" fill="${bar.color}"></rect>`
      + (bar.h > 14 ? `<text class="dtt-iu__barval" x="${(bar.x + bar.w / 2).toFixed(1)}" y="${(bar.y + 11).toFixed(1)}" text-anchor="middle" fill="#fff" opacity=".9">${formatNum(bar.value)}</text>` : '')).join('')
  } else {
    if (spec.chart === 'area') {
      marks += geo.lines.map(line => {
        if (line.dots.length === 0) return ''
        const first = line.dots[0]!
        const last = line.dots[line.dots.length - 1]!
        return `<polygon class="dtt-iu__area" points="${first.x.toFixed(1)},${geo.zeroY.toFixed(1)} ${line.points} ${last.x.toFixed(1)},${geo.zeroY.toFixed(1)}" fill="${line.color}"></polygon>`
      }).join('')
    }
    marks += geo.lines.map(line =>
      `<polyline class="dtt-iu__line" points="${line.points}" stroke="${line.color}"></polyline>`
      + line.dots.map(d =>
        `<circle class="dtt-iu__dot-svg" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="3" fill="${line.color}"></circle>`).join('')).join('')
  }
  return `<div class="dtt-iu__legend">${legend}</div>`
    + `<svg class="dtt-iu__chart" data-i="${spec.series.length}" viewBox="0 0 ${geo.w} ${geo.h}" role="img" aria-label="${escAttr(spec.title)}">${grid}${zero}${axis}${marks}${ticks}</svg>`
}

const CSS = [
  '/* chart：图例开关 + 自适应 SVG + 负数基线 + 面积填充 */',
  '.dtt-iu__legend { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px; }',
  '.dtt-iu__chip { border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.2));',
  '  background: transparent; color: inherit; font: inherit; font-size: calc(11.5px * var(--iu-text-scale, 1));',
  '  border-radius: 999px; padding: 2px 10px 2px 6px; cursor: pointer;',
  '  display: inline-flex; align-items: center; gap: 6px; opacity: 1;',
  '  transition: opacity .18s ease, transform .18s ease; }',
  '.dtt-iu__chip:hover { transform: translateY(-1px); }',
  '.dtt-iu__chip--off { opacity: .38; }',
  '.dtt-iu__swatch { width: 8px; height: 8px; border-radius: 3px; flex: none; }',
  '.dtt-iu__chart { display: block; width: 100%; height: auto; margin-top: 4px; }',
  /* 柱子与折线的**可见性永远不依赖动画**——几何尺寸在最终态，入场动画的起点
     也必须是「已经看得见」的状态（opacity .5），绝不是 opacity 0。
     反例（实测踩中两次）：scaleY(0)→1 / stroke-dashoffset 满偏移到 0 /
     from{opacity:0}。三者在动画没跑或停在第一帧时都会让图表只剩网格线，
     看起来像坏掉的空卡——无头截图、打印、全局节流（页面不可见时
     animation-play-state: paused）都会命中。图表是数据本身，不能靠动效才可见。 */
  '.dtt-iu__bar { animation: dtt-iu-grow .5s cubic-bezier(.2,.8,.25,1) both; }',
  '.dtt-iu__chart[data-i="1"] .dtt-iu__bar { animation-delay: .06s; }',
  '.dtt-iu__chart[data-i="2"] .dtt-iu__bar { animation-delay: .12s; }',
  '.dtt-iu__chart[data-i="3"] .dtt-iu__bar { animation-delay: .18s; }',
  '@keyframes dtt-iu-grow { from { opacity: .5 } to { opacity: 1 } }',
  '.dtt-iu__line { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;',
  '  animation: dtt-iu-draw .5s ease .08s both; }',
  '@keyframes dtt-iu-draw { from { opacity: .5 } to { opacity: 1 } }',
  '.dtt-iu__area { opacity: .16; animation: dtt-iu-fade .5s ease .1s both; }',
  '.dtt-iu__dot-svg { animation: dtt-iu-fade .4s ease .3s both; }',
  '@keyframes dtt-iu-fade { from { opacity: .5 } to { opacity: 1 } }',
  '.dtt-iu__axis { stroke: var(--dsw-alias-border-l3, rgba(127,127,127,.25)); stroke-width: 1; }',
  '.dtt-iu__grid { stroke: var(--dsw-alias-border-l3, rgba(127,127,127,.14)); stroke-width: 1; }',
  '.dtt-iu__tick { font-size: 9px; fill: currentColor; opacity: .5; }',
  '.dtt-iu__barval { font-size: 9.5px; fill: currentColor; opacity: .75; font-weight: 600; }',
  /* hover 数值提示走 SVG 原生 <title>（柱子矮到画不下 barval 时仍可读），
     不用自定义浮层：原生 title 零瞬态状态、snapshot 与 Body 天然对齐。 */
  '.dtt-iu__bar, .dtt-iu__dot-svg { transition: opacity .15s ease; cursor: default; }',
  '.dtt-iu__bar:hover, .dtt-iu__dot-svg:hover { opacity: .82; }',
].join('\n')

export const chartKind: IuKind<ChartState, IuChartSpec> = {
  kind: 'chart',
  label: '图表',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · chart 图表：{"kind":"chart","chart":"bar","title":"标题","labels":["A","B"],"series":[{"name":"系列","values":[3,5]}],"unit":""}（chart=bar|line|area，labels ≤12，series ≤4；支持负数（自动画 0 基线），点图例可隐藏系列）。',
}
