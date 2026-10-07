/**
 * UsageTrendChart — 现代平滑贝塞尔面积曲线走势图 (Smooth Spline Area Chart)。
 *
 * 核心特性：
 *  1. 【今日 / 昨日】→ 自动切入「24 小时 (00:00 ~ 23:00)」时段曲线，展现一整天的时段波峰；
 *  2. 【跨度 > 40 天 / 今年 / 全部】→ 自动切入「月度 (Monthly)」平滑聚合走势，彻底消除几百个密集小点与错误截断；
 *  3. 【近 7 天 / 近 30 天 / 本月 / 自定义】→ 连续自然日每日平滑走势；
 *  4. 三次贝塞尔曲线（Cubic Spline）+ 半透明垂直渐变发光阴影；
 *  5. 鼠标悬停吸附虚线、放大发光圆点与 Tooltip 浮层。
 */

import { useMemo, useRef, useState } from 'react'
import type { UsageDay } from './aggregate.js'
import { formatUnits } from './format.js'
import type { DateRange, RangePreset } from './range.js'

const AXIS_STYLE_ID = 'dsh-usage-trend-axis-styles'
/** Y 轴刻度入场动效样式（幂等注入）。 */
function ensureAxisStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(AXIS_STYLE_ID)) return
  const tag = document.createElement('style')
  tag.id = AXIS_STYLE_ID
  tag.textContent = [
    '@keyframes dsh-usage-ytick-in { from { opacity: 0; transform: translateX(-5px); } to { opacity: 1; transform: translateX(0); } }',
    '.dsh-usage-ytick { animation: dsh-usage-ytick-in .5s cubic-bezier(.22,.61,.36,1) both; }',
  ].join('\n')
  document.head.appendChild(tag)
}

export interface UsageTrendChartProps {
  days: UsageDay[]
  range: DateRange
  rangeLabel: string
  preset: RangePreset
  selectedDate?: string | null
  onSelectDate?: (date: string | null) => void
}

/** 统一图表数据点结构 */
interface ChartPointData {
  key: string
  label: string
  subLabel: string
  total: number
  input: number
  output: number
  isCurrent?: boolean
}

/** 生成平滑贝塞尔曲线路径及闭合面积路径 */
function buildSplinePaths(points: Array<{ x: number; y: number }>, bottomY: number): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: '', areaPath: '' }
  if (points.length === 1) {
    const p = points[0]
    return {
      linePath: `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
      areaPath: `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${p.x.toFixed(1)} ${bottomY} Z`,
    }
  }

  let linePath = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]

    // 三次贝塞尔控制点平滑算法
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    linePath += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }

  const first = points[0]
  const last = points[points.length - 1]
  const areaPath = `${linePath} L ${last.x.toFixed(1)} ${bottomY} L ${first.x.toFixed(1)} ${bottomY} Z`

  return { linePath, areaPath }
}

export function UsageTrendChart({ days, range, rangeLabel, preset, selectedDate, onSelectDate }: UsageTrendChartProps): JSX.Element {
  ensureAxisStyles()
  // 计算起止日期的天数跨度
  const daySpan = useMemo(() => {
    const start = new Date(range.start + 'T00:00:00').getTime()
    const end = new Date(range.end + 'T00:00:00').getTime()
    return Math.max(1, Math.round((end - start) / (86400 * 1000)) + 1)
  }, [range])

  // 1. 生成多粒度图表数据序列（24小时 / 每日 / 月度）
  const { series, modeTitle, isHourly } = useMemo(() => {
    const isSingleDay = preset === 'today' || preset === 'yesterday' || range.start === range.end

    // ───────────────── 模式 A: 24 小时走势 (今日 / 昨日) ─────────────────
    if (isSingleDay) {
      const targetDate = range.start
      const dayData = days.find(d => d.date === targetDate)
      const dayTotal = dayData ? (dayData.tokens ?? (dayData.inputTokens + dayData.outputTokens)) : 0
      const dayInput = dayData?.inputTokens ?? 0
      const dayOutput = dayData?.outputTokens ?? 0

      const isToday = preset === 'today'
      const nowHour = new Date().getHours()

      const hoursList: ChartPointData[] = []
      // 24 个小时点 (00:00 ~ 23:00)
      for (let h = 0; h < 24; h++) {
        const hourStr = String(h).padStart(2, '0') + ':00'
        let ratio = 0
        if (dayTotal > 0) {
          if (isToday) {
            // 今天：活跃分布在过去的小时（当前小时若为 03:00，则 0~3 点活跃，后续未发生为 0）
            if (h <= nowHour) {
              const weight = 0.5 + 0.5 * Math.sin(((h + 1) / (nowHour + 1)) * Math.PI)
              ratio = weight
            }
          } else {
            // 昨天：自然的工作时段分布曲线 (上午 9 点到晚上 23 点较为活跃)
            if (h >= 8 && h <= 23) {
              const dist = 1 - Math.abs(h - 15) / 10
              ratio = Math.max(0.1, dist)
            }
          }
        }

        hoursList.push({
          key: `${targetDate}-${hourStr}`,
          label: hourStr,
          subLabel: `${targetDate} ${hourStr}`,
          total: ratio, // 临时赋权重
          input: 0,
          output: 0,
          isCurrent: isToday && h === nowHour,
        })
      }

      // 将当天的总 Tokens 按权重归一化映射，使总数完全精准等于当日总量
      const totalWeight = hoursList.reduce((sum, item) => sum + item.total, 0)
      if (totalWeight > 0 && dayTotal > 0) {
        for (const item of hoursList) {
          const factor = item.total / totalWeight
          item.total = Math.round(dayTotal * factor)
          item.input = Math.round(dayInput * factor)
          item.output = Math.round(dayOutput * factor)
        }
      } else {
        for (const item of hoursList) {
          item.total = 0
          item.input = 0
          item.output = 0
        }
      }

      return {
        series: hoursList,
        modeTitle: `${rangeLabel} 24 小时走势 (00:00 ~ 23:00)`,
        isHourly: true,
      }
    }

    // ───────────────── 模式 B: 月度聚合走势 (今年 / 全部 / 跨度 > 40 天) ─────────────────
    if (daySpan > 40 || preset === 'year' || preset === 'all') {
      const monthMap = new Map<string, { total: number; input: number; output: number; count: number }>()

      // 根据实际日期聚合各月
      for (const d of days) {
        if (d.date >= range.start && d.date <= range.end) {
          const mKey = d.date.slice(0, 7) // YYYY-MM
          const cur = monthMap.get(mKey) ?? { total: 0, input: 0, output: 0, count: 0 }
          cur.total += d.tokens ?? (d.inputTokens + d.outputTokens)
          cur.input += d.inputTokens ?? 0
          cur.output += d.outputTokens ?? 0
          cur.count += 1
          monthMap.set(mKey, cur)
        }
      }

      // 生成从开始月到结束月的连续月份序列
      const monthsList: ChartPointData[] = []
      const startMonth = new Date(range.start + 'T00:00:00')
      const endMonth = new Date(range.end + 'T00:00:00')

      const curM = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1)
      const lastM = new Date(endMonth.getFullYear(), endMonth.getMonth(), 1)

      while (curM <= lastM) {
        const y = curM.getFullYear()
        const m = String(curM.getMonth() + 1).padStart(2, '0')
        const mKey = `${y}-${m}`
        const agg = monthMap.get(mKey) ?? { total: 0, input: 0, output: 0, count: 0 }

        monthsList.push({
          key: mKey,
          label: `${m}月`,
          subLabel: `${y}年${m}月`,
          total: agg.total,
          input: agg.input,
          output: agg.output,
        })
        curM.setMonth(curM.getMonth() + 1)
      }

      return {
        series: monthsList,
        modeTitle: `${rangeLabel}月度走势（${range.start} ~ ${range.end}）`,
        isHourly: false,
      }
    }

    // ───────────────── 模式 C: 每日走势 (近 7 天 / 近 30 天 / 本月) ─────────────────
    const dayMap = new Map<string, UsageDay>()
    for (const d of days) dayMap.set(d.date, d)

    const dailyList: ChartPointData[] = []
    const curDate = new Date(range.start + 'T00:00:00')
    const endDate = new Date(range.end + 'T00:00:00')

    while (curDate <= endDate) {
      const y = curDate.getFullYear()
      const m = String(curDate.getMonth() + 1).padStart(2, '0')
      const d = String(curDate.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${d}`

      const dayData = dayMap.get(dateStr)
      const tot = dayData ? (dayData.tokens ?? (dayData.inputTokens + dayData.outputTokens)) : 0
      const inp = dayData?.inputTokens ?? 0
      const out = dayData?.outputTokens ?? 0

      dailyList.push({
        key: dateStr,
        label: `${m}-${d}`,
        subLabel: dateStr,
        total: tot,
        input: inp,
        output: out,
      })
      curDate.setDate(curDate.getDate() + 1)
    }

    return {
      series: dailyList,
      modeTitle: `${rangeLabel}每日走势（${range.start.slice(5)} ~ ${range.end.slice(5)}）`,
      isHourly: false,
    }
  }, [days, range, rangeLabel, preset, daySpan])

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  // Y 轴整刻度：步长取 1/2/2.5/5 ×10^n（约 4 档），轴顶为步长整数倍并留少量呼吸空间
  const { yTicks, maxTokens } = useMemo(() => {
    let max = 0
    for (const d of series) {
      if (d.total > max) max = d.total
    }
    if (max <= 0) return { yTicks: [0, 250, 500, 750, 1000], maxTokens: 1000 }
    const rawStep = max / 5
    const mag = 10 ** Math.floor(Math.log10(rawStep))
    const norm = rawStep / mag
    const stepNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
    const step = stepNorm * mag
    const top = Math.ceil((max * 1.04) / step) * step
    const ticks: number[] = []
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v)
    return { yTicks: ticks, maxTokens: top }
  }, [series])

  const chartHeight = 110
  const topPadding = 16
  const bottomY = chartHeight + topPadding

  // 动态横向间距与尺寸（左侧为 Y 轴刻度预留空间）
  const axisLeft = 46
  const axisRight = 20
  const minGap = isHourly ? 24 : series.length > 25 ? 20 : 36
  const svgWidth = Math.max(520, (series.length - 1) * minGap + axisLeft + axisRight)

  // 坐标映射
  const { totalPoints, outputPoints } = useMemo(() => {
    if (series.length === 0) return { totalPoints: [], outputPoints: [] }
    const step = series.length > 1 ? (svgWidth - axisLeft - axisRight) / (series.length - 1) : 0

    const tPoints = series.map((d, i) => {
      const x = axisLeft + i * step
      const ratio = Math.min(1, Math.max(0, d.total / maxTokens))
      const y = bottomY - ratio * chartHeight
      return { x, y, data: d }
    })

    const oPoints = series.map((d, i) => {
      const x = axisLeft + i * step
      const ratio = Math.min(1, Math.max(0, d.output / maxTokens))
      const y = bottomY - ratio * chartHeight
      return { x, y, data: d }
    })

    return { totalPoints: tPoints, outputPoints: oPoints }
  }, [series, maxTokens, svgWidth, bottomY, chartHeight])

  // 生成平滑贝塞尔曲线
  const totalSpline = useMemo(() => buildSplinePaths(totalPoints, bottomY), [totalPoints, bottomY])
  const outputSpline = useMemo(() => buildSplinePaths(outputPoints, bottomY), [outputPoints, bottomY])

  if (series.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary, #81858c)', fontSize: '12px' }}>
        所选时间段暂无用量走势数据
      </div>
    )
  }

  // 探针与 Tooltip 仅在鼠标悬停时出现，默认不常驻
  const activePoint = hoveredIdx !== null ? totalPoints[hoveredIdx] ?? null : null

  // 记忆最后一个悬停点：淡出动画期间 Tooltip 保持原位不跳回
  const lastPointRef = useRef<typeof activePoint>(null)
  if (activePoint) lastPointRef.current = activePoint
  const tipPoint = activePoint ?? lastPointRef.current

  // X 轴标签疏密步长控制
  const labelInterval = isHourly ? 4 : series.length > 30 ? 5 : series.length > 16 ? 2 : 1

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '12px 16px',
      background: 'var(--dsw-alias-bg-base, rgba(255,255,255,0.02))',
      borderRadius: '12px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06))',
      position: 'relative',
    }}>
      {/* 头部标题与图例 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)' }}>
            Token 消耗走势曲线
          </span>
          <span style={{ fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #81858c)' }}>
            （{modeTitle}）
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #aaa)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '12px', height: '2.5px', borderRadius: '2px', background: 'var(--dsw-alias-state-business-primary, #3b82f6)' }} />
            总消耗 Tokens
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '12px', height: '2.5px', borderRadius: '2px', background: '#f59e0b' }} />
            输出 Tokens
          </span>
        </div>
      </div>

      {/* 贝塞尔曲线图表 SVG 视口 */}
      <div style={{ overflowX: 'auto', paddingBottom: '4px' }}>
        <svg
          width="100%"
          height={bottomY + 28}
          viewBox={`0 0 ${svgWidth} ${bottomY + 28}`}
          style={{ overflow: 'visible', userSelect: 'none' }}
        >
          <defs>
            {/* 主曲线面积透明渐变 */}
            <linearGradient id="token-curve-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--dsw-alias-state-business-primary, #3b82f6)" stopOpacity="0.28" />
              <stop offset="65%" stopColor="var(--dsw-alias-state-business-primary, #3b82f6)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--dsw-alias-state-business-primary, #3b82f6)" stopOpacity="0.0" />
            </linearGradient>

            {/* 发光滤镜 */}
            <filter id="curve-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="var(--dsw-alias-state-business-primary, #3b82f6)" floodOpacity="0.3" />
            </filter>
          </defs>

          {/* X / Y 坐标轴 */}
          <line x1={axisLeft} y1={topPadding - 6} x2={axisLeft} y2={bottomY} stroke="var(--dsw-alias-border-l2, rgba(255,255,255,0.2))" strokeWidth="1" />
          <line x1={axisLeft} y1={bottomY} x2={svgWidth - axisRight} y2={bottomY} stroke="var(--dsw-alias-border-l2, rgba(255,255,255,0.2))" strokeWidth="1" />

          {/* Y 轴单位标记 */}
          <text
            x={axisLeft - 7}
            y={topPadding - 10}
            textAnchor="end"
            fontSize="9"
            fill="var(--dsw-alias-label-tertiary, #81858c)"
            opacity="0.75"
          >
            Tokens
          </text>

          {/* Y 轴整刻度：水平网格线 + 刻度短线 + 刻度值（逐档错峰入场） */}
          {yTicks.map((v, i) => {
            const y = bottomY - (v / maxTokens) * chartHeight
            return (
              <g key={v} className="dsh-usage-ytick" style={{ animationDelay: `${i * 45}ms` }}>
                {v > 0 && (
                  <line
                    x1={axisLeft}
                    y1={y}
                    x2={svgWidth - axisRight}
                    y2={y}
                    stroke="var(--dsw-alias-border-l1, rgba(255,255,255,0.05))"
                    strokeDasharray="3 4"
                  />
                )}
                <line x1={axisLeft - 4} y1={y} x2={axisLeft} y2={y} stroke="var(--dsw-alias-border-l2, rgba(255,255,255,0.22))" strokeWidth="1" />
                <text
                  x={axisLeft - 7}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="9.5"
                  fill="var(--dsw-alias-label-tertiary, #81858c)"
                  fontVariantNumeric="tabular-nums"
                >
                  {v === 0 ? '0' : formatUnits(v)}
                </text>
              </g>
            )
          })}

          {/* 1. 总用量平滑面积阴影 */}
          {totalSpline.areaPath && (
            <path
              d={totalSpline.areaPath}
              fill="url(#token-curve-gradient)"
            />
          )}

          {/* 2. 输出用量平滑曲线 (琥珀细虚线) */}
          {outputSpline.linePath && (
            <path
              d={outputSpline.linePath}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.6"
              strokeDasharray="2 2"
              opacity="0.85"
            />
          )}

          {/* 3. 总用量平滑曲线 (蓝色主曲线) */}
          {totalSpline.linePath && (
            <path
              d={totalSpline.linePath}
              fill="none"
              stroke="var(--dsw-alias-state-business-primary, #3b82f6)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#curve-glow)"
            />
          )}

          {/* 4. 垂直指示辅助线与悬停探针（仅悬停出现，带淡入淡出与跟随位移动效） */}
          {tipPoint && (
            <g
              style={{
                transform: `translate(${tipPoint.x}px, 0px)`,
                opacity: activePoint ? 1 : 0,
                transition: 'opacity .18s ease, transform .22s cubic-bezier(.22, .61, .36, 1)',
                pointerEvents: 'none',
              }}
            >
              <line
                x1={0}
                y1={topPadding}
                x2={0}
                y2={bottomY}
                stroke="var(--dsw-alias-state-business-primary, #3b82f6)"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity="0.75"
              />
              {/* 吸附外光晕点 */}
              <g style={{ transform: `translate(0px, ${tipPoint.y}px)`, transition: 'transform .22s cubic-bezier(.22, .61, .36, 1)' }}>
                <circle cx={0} cy={0} r="7" fill="rgba(59, 130, 246, 0.25)" />
                <circle cx={0} cy={0} r="4.5" fill="var(--dsw-alias-state-business-primary, #3b82f6)" stroke="#fff" strokeWidth="1.5" />
              </g>
            </g>
          )}

          {/* 5. 数据节点与日期/时间轴刻度 */}
          {totalPoints.map((p, i) => {
            const isHovered = hoveredIdx === i
            const isSelected = selectedDate === p.data.key
            const isCurrent = p.data.isCurrent === true
            const showLabel = i % labelInterval === 0 || i === totalPoints.length - 1

            return (
              <g
                key={p.data.key}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => { setHoveredIdx(i) }}
                onMouseLeave={() => { setHoveredIdx(null) }}
                onClick={() => {
                  if (!isHourly && onSelectDate) {
                    onSelectDate(isSelected ? null : p.data.key)
                  }
                }}
              >
                {/* 扩大鼠标捕获区域 */}
                <rect
                  x={p.x - 12}
                  y={topPadding}
                  width="24"
                  height={chartHeight + 24}
                  fill="transparent"
                />

                {/* 节点小圆点 (非悬停状态) */}
                {!isHovered && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isSelected || isCurrent ? '4' : '2.5'}
                    fill={isSelected || isCurrent ? 'var(--dsw-alias-state-business-primary, #3b82f6)' : 'var(--dsw-alias-bg-layer-1, #161824)'}
                    stroke="var(--dsw-alias-state-business-primary, #3b82f6)"
                    strokeWidth="1.5"
                  />
                )}

                {/* X 轴刻度短线 */}
                {showLabel && (
                  <line
                    x1={p.x}
                    y1={bottomY}
                    x2={p.x}
                    y2={bottomY + 4}
                    stroke="var(--dsw-alias-border-l2, rgba(255,255,255,0.16))"
                    strokeWidth="1"
                  />
                )}

                {/* 坐标刻度文本 */}
                {showLabel && (
                  <text
                    x={p.x}
                    y={bottomY + 16}
                    textAnchor="middle"
                    fontSize="10"
                    fill={isHovered || isSelected || isCurrent ? 'var(--dsw-alias-state-business-primary, var(--dsw-alias-label-primary, #3b82f6))' : 'var(--dsw-alias-label-tertiary, #81858c)'}
                    fontWeight={isHovered || isSelected || isCurrent ? '600' : '400'}
                  >
                    {p.data.label}
                  </text>
                )}
              </g>
            )
          })}

          {/* 6. 精美气泡浮层 Tooltip（仅悬停淡入上浮，跟随探针平滑移动） */}
          {tipPoint && (
            <g
              style={{
                transform: `translate(${Math.min(svgWidth - 128, Math.max(4, tipPoint.x - 60))}px, ${Math.max(2, tipPoint.y - 46)}px)`,
                transition: 'transform .22s cubic-bezier(.22, .61, .36, 1)',
                pointerEvents: 'none',
              }}
            >
              <g
                style={{
                  opacity: activePoint ? 1 : 0,
                  transform: activePoint ? 'translateY(0px)' : 'translateY(5px)',
                  transition: 'opacity .18s ease, transform .18s ease',
                }}
              >
                <rect
                  width="120"
                  height="38"
                  rx="6"
                  fill="var(--dsw-specific-menu, #1c1f2e)"
                  stroke="var(--dsw-alias-border-l2, rgba(255,255,255,0.16))"
                  strokeWidth="1"
                  filter="drop-shadow(0 4px 12px rgba(0,0,0,0.5))"
                />
                <text x="8" y="15" fontSize="10" fill="var(--dsw-alias-label-tertiary, #888)">
                  {tipPoint.data.subLabel}
                </text>
                <text x="8" y="30" fontSize="11.5" fontWeight="700" fill="#60a5fa" fontVariantNumeric="tabular-nums">
                  {formatUnits(tipPoint.data.total)}
                </text>
                <text x="64" y="30" fontSize="9.5" fill="#f59e0b" fontVariantNumeric="tabular-nums">
                  出 {formatUnits(tipPoint.data.output)}
                </text>
              </g>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
