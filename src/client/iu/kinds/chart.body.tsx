/**
 * iu kind **chart** 的 React 体（client 专用）。
 *
 * 几何与 chart.ts 的 snapshot() **同源**：两边都调 geometry.ts 的 chartLayout，
 * 柱子高度 / 刻度位置 / 负数基线完全一致。本文件只负责把几何画成 JSX，并接上
 * 图例点击（隐藏系列）这一个交互。
 *
 * DOM 结构严格对齐 snapshot()：legend → svg(grid + zero? + axis + marks + ticks)。
 * bar 的 hover 数值走 SVG 原生 <title>（不可见元数据，不进截图，不影响结构对齐）。
 */

import { memo, useMemo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuChartSpec, ChartState } from './chart.ts'
import { CHART_COLORS, chartLayout } from '../geometry.ts'
import { formatNum } from './core.ts'

export const ChartBody = memo(function ChartBody(
  { spec, state, setState }: IuBodyProps<ChartState, IuChartSpec>,
): JSX.Element {
  const hidden = useMemo(() => new Set(state.hidden), [state.hidden])
  const geo = useMemo(() => chartLayout(spec, hidden), [spec, hidden])
  const visCount = spec.series.length - hidden.size
  /**
   * 可见系列（与 geo.lines **同序**：chartLayout 内部就是对 vis.map 生成 lines）。
   * dot 的 hover 数值按这个下标取，不用 name 反查（重名系列会查错）。
   */
  const visSeries = useMemo(
    () => spec.series.filter((_, i) => !hidden.has(i)),
    [spec.series, hidden],
  )

  const toggle = (i: number): void => {
    setState((prev) => {
      const set = new Set(prev.hidden)
      if (set.has(i)) set.delete(i)
      else set.add(i)
      return { hidden: [...set].sort((a, b) => a - b) }
    })
  }

  return (
    <>
      <div className="dtt-iu__legend">
        {spec.series.map((s, i) => (
          <button
            key={i}
            type="button"
            className={hidden.has(i) ? 'dtt-iu__chip dtt-iu__chip--off' : 'dtt-iu__chip'}
            aria-pressed={!hidden.has(i)}
            onClick={() => { toggle(i) }}
          >
            <span className="dtt-iu__swatch" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {s.name}
          </button>
        ))}
      </div>
      <svg className="dtt-iu__chart" data-i={String(visCount)} viewBox={`0 0 ${geo.w} ${geo.h}`} role="img" aria-label={spec.title}>
        {geo.gridYs.map((y, i) => (
          <line key={`g${i}`} className="dtt-iu__grid" x1={8} x2={geo.w - 8} y1={y} y2={y} />
        ))}
        {/* 负数基线：y=0 落在图中间时必须画出来，负柱才有落脚处 */}
        {geo.min < 0 && <line className="dtt-iu__axis" x1={8} x2={geo.w - 8} y1={geo.zeroY} y2={geo.zeroY} />}
        <line className="dtt-iu__axis" x1={8} x2={geo.w - 8} y1={geo.axisY} y2={geo.axisY} />
        {spec.chart === 'area' && geo.lines.map((line, i) => {
          if (line.dots.length === 0) return null
          const first = line.dots[0]!
          const last = line.dots[line.dots.length - 1]!
          const pts = `${first.x.toFixed(1)},${geo.zeroY.toFixed(1)} ${line.points} ${last.x.toFixed(1)},${geo.zeroY.toFixed(1)}`
          return <polygon key={`a${i}`} className="dtt-iu__area" points={pts} fill={line.color} />
        })}
        {spec.chart === 'bar' ? (
          <g>
            {geo.bars.map((bar, i) => (
              <g key={i}>
                <rect className="dtt-iu__bar" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={3} fill={bar.color}>
                  <title>{formatNum(bar.value)}</title>
                </rect>
                {bar.h > 14 && (
                  <text className="dtt-iu__barval" x={bar.x + bar.w / 2} y={bar.y + 11} textAnchor="middle" fill="#fff" opacity={.9}>
                    {formatNum(bar.value)}
                  </text>
                )}
              </g>
            ))}
          </g>
        ) : (
          <g>
            {geo.lines.map((line, i) => (
              <g key={i}>
                <polyline className="dtt-iu__line" points={line.points} stroke={line.color} />
                {line.dots.map((dot, j) => (
                  <circle key={j} className="dtt-iu__dot-svg" cx={dot.x} cy={dot.y} r={3} fill={line.color}>
                    <title>{`${line.name}: ${formatNum(visSeries[i]?.values[j] ?? 0)}`}</title>
                  </circle>
                ))}
              </g>
            ))}
          </g>
        )}
        {geo.ticks.map((tick, i) => (
          <text key={`t${i}`} className="dtt-iu__tick" x={tick.x} y={geo.h - 6} textAnchor="middle">{tick.text}</text>
        ))}
      </svg>
    </>
  )
})
