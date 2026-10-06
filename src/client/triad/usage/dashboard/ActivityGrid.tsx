/**
 * Token 活动 —— GitHub 风格贡献热力（52 周 × 7 天，右对齐当前周）。
 *
 * 卡头分段控件两种口径（与设计稿一致）：
 *  - 每周：当天指标值（按周滚动窗口逐日着色）；
 *  - 累计：自首个有记录日起的滚动累计（跨 52 周窗口，保持曲线连续）。
 *
 * 布局：格子固定 14px 方格，不拉伸；月份标签按像素定位，与格子列对齐。
 *
 * 顶部月份标签（每周起始月只在列首出现）、左侧星期标签（周一/周三/周五/周日），
 * 悬浮出卡片式 tooltip（日期 + 星期 + 指标值 + 当日模型数），点击带日期（过去）
 * 的格子下钻「当日模型明细」，与月/年热力共用同一个 selectedDay 状态。
 * 未到的未来天渲染为不可交互占位格，日历形状不跳动。
 * 数据取完整记录（不限查询范围）——「活动」是横跨历史的总览。
 *
 * 导出的 `buildActivityGrid` / `activityColor` 属插件公开 API，保持可用。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { formatUnits } from './format'
import { css, CheckIcon } from './hub'
import type { UsageDay } from './aggregate'

export type ActivityMode = 'day' | 'week' | 'cumulative'

/** 热力图指标口径：与工具栏下拉联动。 */
export type ActivityMetric = 'tokens' | 'input' | 'output' | 'cache' | 'requests'

export const METRIC_LABELS: Record<ActivityMetric, string> = {
  tokens: 'Token 用量',
  input: '输入',
  output: '输出',
  cache: '缓存',
  requests: '调用次数',
}

/** 指标下拉选项（卡头每周/累计左侧，口径与工具栏下拉一致）。 */
export const METRIC_OPTIONS: Array<{ id: ActivityMetric; label: string }> = [
  { id: 'tokens', label: '用量' },
  { id: 'input', label: '输入' },
  { id: 'output', label: '输出' },
  { id: 'cache', label: '缓存' },
  { id: 'requests', label: '调用次数' },
]

/** 单日某指标的数值（无数据 = 0）。 */
export function metricValueOf(day: UsageDay | null | undefined, metric: ActivityMetric): number {
  if (day === null || day === undefined) return 0
  switch (metric) {
    case 'input': return day.inputTokens ?? 0
    case 'output': return day.outputTokens ?? 0
    case 'cache': return (day.cacheReadTokens ?? 0) + (day.cacheWriteTokens ?? 0)
    case 'requests': return day.requests ?? 0
    default: return day.tokens ?? 0
  }
}

/** 列数固定为 52 周（GitHub 年视图惯例）；数据不足时左侧自然留空。 */
export const ACTIVITY_COLUMNS = 52
/** 默认格子尺寸（px）：宽面板用 14；窄卡片（compact 用量面板）传 9 缩一档。 */
const CELL = 14
const GAP = 2
const RADIUS = 3
const TIP_GAP = 8

const STYLE_ID = 'dsh-activity-styles'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
/** 紧凑格子的星期标签：单字，否则两字会顶到网格上。 */
const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const

/**
 * 贡献格子样式：入场回落 + 悬浮放大光晕 + 选中环 / 今日环 + 模式切换时的
 * 背景色过渡（rgba 可插值）。CSS 块内不写注释，防注入式注释提前闭合（对应
 * 「星号紧跟正斜杠」红线：任何注释闭合序列都会把后续规则拖成非法选择器）。
 */
const SHEET = `
@keyframes dsh-activity-cell-in {
  from { opacity: 0; transform: translate3d(0, 4px, 0) scale(0.7); }
  to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}
.dsh-activity-cell {
  border: 0;
  border-radius: var(--dsh-activity-radius, ${RADIUS}px);
  width: var(--dsh-activity-cell, ${CELL}px);
  height: var(--dsh-activity-cell, ${CELL}px);
  flex: none;
  padding: 0;
  cursor: default;
  opacity: 0;
  animation: dsh-activity-cell-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transition: transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 140ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dsh-activity-cell[data-clickable="true"] { cursor: pointer; }
.dsh-activity-cell[data-clickable="true"]:hover {
  z-index: 2;
  transform: scale(1.5);
  box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary), 0 6px 14px color-mix(in srgb, var(--dsw-alias-state-business-primary) 38%, transparent);
}
.dsh-activity-cell[data-today="true"] { box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary); }
.dsh-activity-cell[data-selected="true"] { box-shadow: 0 0 0 1px var(--dsw-alias-label-primary), 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 26%, transparent); }
.dsh-activity-tabs {
  position: relative;
  flex: none;
  width: 104px;
  display: flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--dsw-alias-fill-l2);
}
.dsh-activity-ind {
  position: absolute;
  left: 3px;
  top: 3px;
  bottom: 3px;
  z-index: 0;
  width: calc((100% - 6px) / 2);
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transform: translateX(calc(var(--dsh-activity-ind, 0) * 100%));
  transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dsh-activity-tab {
  flex: 1 1 0;
  min-width: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  padding: 0 2px;
  font-family: inherit;
  font-size: 12px;
  line-height: 22px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-align: center;
  position: relative;
  z-index: 1;
  transition: color 220ms cubic-bezier(0.2, 0.8, 0.2, 1), font-weight 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dsh-activity-tab:hover { color: var(--dsw-alias-label-secondary); }
.dsh-activity-tab[data-active="true"] { color: var(--dsw-alias-label-primary); font-weight: 600; }
@media (prefers-reduced-motion: reduce) {
  .dsh-activity-cell { animation: none; opacity: 1; }
  .dsh-activity-cell[data-clickable="true"]:hover { transform: none; }
  .dsh-activity-ind { transition: none; }
}
`

/** 幂等注入贡献区样式；返回移除函数。 */
export function ensureActivityStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-triad'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

// ── 日期工具（与 range.ts 同构：YYYY-MM-DD 字典序即时间序） ──────────────

/** `YYYY-MM-DD` 偏移 N 天（Date 滚转，跨月/年正确）。 */
function shiftDayKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + delta)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 周一起始的星期索引（周一 = 0 … 周日 = 6）。 */
export function weekdayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return (new Date(y, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7
}


export interface ActivityCell {
  key: string
  column: number
  row: number
  /** 当前口径下的展示值（每周 = 当日指标值 / 累计 = 滚动累计）。 */
  tokens: number
  /** 当日指标值（口径由 buildActivityGrid 的 metric 决定；tokens 口径即当日 token 总量）。 */
  dayTokens: number
  /** 当前周（同列）指标合计，仅在 week 口径下与展示值一致。 */
  weekTokens: number
  /** 当日请求数。 */
  requests: number
  weekRequests: number
  /** 当日出现的不同模型数。 */
  modelCount: number
  hitRate: number | null
  isToday: boolean
  /** 该日已到（<= 今天）；false = 当前周内未到的占位格。 */
  past: boolean
}

export interface ActivitySnapshot {
  mode: ActivityMode
  metric: ActivityMetric
  columns: number
  cells: ActivityCell[]
  /** 7 行（周一 → 周日），每行一列一周。 */
  rows: ActivityCell[][]
  max: number
  total: number
  activeDays: number
  peakDay: string | null
  peakTokens: number
  startKey: string
  endKey: string
  firstRecorded: string | null
  /** 每周列首的月份标签：{column, label(如 "10月")}，列 0 起跳。 */
  monthLabels: Array<{ column: number; label: string }>
}

/**
 * 由完整记录构建 52 周贡献热力。纯函数，`today` 可注入以便测试。
 * 累计口径贯穿全部记录（含窗口外更早的天），末格累计 == 全部指标总和。
 */
export function buildActivityGrid(
  days: UsageDay[] | null | undefined,
  mode: ActivityMode,
  today: Date = new Date(),
  metric: ActivityMetric = 'tokens',
): ActivitySnapshot {
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const dayMap = new Map<string, UsageDay>()
  if (Array.isArray(days)) {
    for (const day of days) {
      if (day !== null && typeof day === 'object' && typeof day.date === 'string') dayMap.set(day.date, day)
    }
  }

  const columns = ACTIVITY_COLUMNS
  const totalDays = columns * 7
  const firstKey = shiftDayKey(todayKey, -((columns - 1) * 7 + weekdayIndex(todayKey)))
  const endKey = shiftDayKey(firstKey, totalDays - 1)

  const buckets = new Array<{ key: string; tokens: number; requests: number; cumulative: number; active: boolean }>(totalDays)
  const indexByKey = new Map<string, number>()
  for (let i = 0; i < totalDays; i += 1) {
    const key = shiftDayKey(firstKey, i)
    indexByKey.set(key, i)
    buckets[i] = { key, tokens: 0, requests: 0, cumulative: 0, active: false }
  }

  let running = 0
  let firstRecorded: string | null = null
  for (const key of [...dayMap.keys()].sort()) {
    if (firstRecorded === null) firstRecorded = key
    const entry = dayMap.get(key)!
    const value = metricValueOf(entry, metric)
    running += value
    const index = indexByKey.get(key)
    if (index === undefined) continue
    buckets[index].tokens = value
    buckets[index].requests = entry.requests ?? 0
    buckets[index].cumulative = running
    buckets[index].active = value > 0
  }

  const weekTokens = new Array<number>(columns).fill(0)
  const weekRequests = new Array<number>(columns).fill(0)
  for (let c = 0; c < columns; c += 1) {
    let t = 0
    let r = 0
    for (let i = 0; i < 7; i += 1) {
      t += buckets[c * 7 + i].tokens
      r += buckets[c * 7 + i].requests
    }
    weekTokens[c] = t
    weekRequests[c] = r
  }

  const cells: ActivityCell[] = []
  const rows: ActivityCell[][] = Array.from({ length: 7 }, () => [])
  let max = 0
  let total = 0
  let activeDays = 0
  let peakDay: string | null = null
  let peakTokens = 0
  for (let i = 0; i < totalDays; i += 1) {
    const bucket = buckets[i]
    const column = Math.floor(i / 7)
    const value = mode === 'week' ? weekTokens[column]
      : mode === 'cumulative' ? bucket.cumulative
        : bucket.tokens
    const day = dayMap.get(bucket.key)
    const cell: ActivityCell = {
      key: bucket.key,
      column,
      row: i % 7,
      tokens: value,
      dayTokens: bucket.tokens,
      weekTokens: weekTokens[column],
      requests: bucket.requests,
      weekRequests: weekRequests[column],
      modelCount: day?.models?.length ?? 0,
      hitRate: bucket.active ? (day?.cacheHitRate ?? null) : null,
      isToday: bucket.key === todayKey,
      past: bucket.key <= todayKey,
    }
    cells.push(cell)
    rows[i % 7].push(cell)
    total += bucket.tokens
    if (bucket.active) activeDays += 1
    if (bucket.tokens > peakTokens) {
      peakTokens = bucket.tokens
      peakDay = bucket.key
    }
    if (value > max) max = value
  }

  // 月份标签：每周列首（该周周一的月份）与上一列不同时标注；首列月份
  // 不标注（与参考稿一致：窗口起始月省去，避免与网格左缘挤在一起）。
  const monthLabels: Array<{ column: number; label: string }> = []
  let prevMonth = firstKey.slice(0, 7)
  for (let c = 1; c < columns; c += 1) {
    const monday = shiftDayKey(firstKey, c * 7)
    const month = monday.slice(0, 7)
    if (month !== prevMonth) {
      monthLabels.push({ column: c, label: `${Number(month.slice(5))}月` })
      prevMonth = month
    }
  }

  return {
    mode,
    metric,
    columns,
    cells,
    rows,
    max,
    total,
    activeDays,
    peakDay: activeDays > 0 ? peakDay : null,
    peakTokens,
    startKey: firstKey,
    endKey,
    firstRecorded,
    monthLabels,
  }
}

/**
 * 贡献格配色：中性灰 alpha 渐变（平方根曲线，低值可见、高峰突出）。
 * 2026-10 色彩收敛：原先是 Codex 蓝渐变，工作台统一灰阶后热力图也跟着
 * 走中性灰——深浅表达用量，颜色不承担语义。
 * 零值/占位返回中性灰；未来占位格由更浅的背景色区分。
 */
const INK = [108, 114, 122] as const
export function activityColor(tokens: number, max: number): string {
  if (!(tokens > 0)) return 'color-mix(in srgb, var(--dsw-alias-border-l2) 55%, transparent)'
  const ratio = max > 0 ? Math.sqrt(Math.min(1, tokens / max)) : 1
  const alpha = Math.min(1, 0.25 + 0.75 * ratio)
  return `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${alpha.toFixed(3)})`
}

/** UI 分段控件口径（与参考稿一致：每周 = 逐日着色 / 累计）。 */
const MODES: Array<{ id: ActivityMode; index: number; label: string }> = [
  { id: 'day', index: 0, label: '每周' },
  { id: 'cumulative', index: 1, label: '累计' },
]

interface HoverState { cell: ActivityCell; left: number; top: number }

export function ActivityGrid({ days, mode, onMode, selectedKey, onSelect, metric = 'tokens', onMetricChange, metricPicker = false, metrics, title = 'Token 活动', subtitle = '52 周滚动热力图，点击格子查看当日模型明细', cellSize = CELL, gap = GAP }: {
  days: UsageDay[] | null
  mode: ActivityMode
  onMode: (mode: ActivityMode) => void
  selectedKey: string | null
  onSelect: (key: string) => void
  metric?: ActivityMetric
  /** 传入后在每周/累计左侧渲染指标下拉（明细 tab 用）。 */
  onMetricChange?: (metric: ActivityMetric) => void
  metricPicker?: boolean
  /**
   * 指标下拉里可选项，缺省为 {@link METRIC_OPTIONS} 全部。
   * 按供应商/模型筛选时调用次数无法按模型拆分（host 的 models 项不带该计数），
   * 此时由调用方摘掉 `requests`，免得切过去是一片全空的格子。
   */
  metrics?: ActivityMetric[]
  title?: string
  /** 副标题；传 null 则整块不渲染（窄卡片省位）。 */
  subtitle?: string | null
  /** 格子边长（px）。窄卡片传 9 缩一档，52 周正好一行放下。 */
  cellSize?: number
  /** 格子间距（px），默认 2。 */
  gap?: number
}): JSX.Element {
  const [hover, setHover] = useState<HoverState | null>(null)
  const [metricMenuOpen, setMetricMenuOpen] = useState(false)
  const snapshot = useMemo(() => buildActivityGrid(days, mode, new Date(), metric), [days, mode, metric])

  // 窄格子时（cellSize < 12）同步收窄圆角与星期标签列，否则留白比格子还抢眼。
  const radius = Math.max(2, Math.round(cellSize * RADIUS / CELL))
  const labelW = cellSize >= 12 ? 30 : 18

  // 网格自然宽度（星期标签列 + 52 列格子 + 列间距），纯计算、不受容器影响。
  // 用计算值而不是 scrollWidth：后者会被「当前是否挂着滚动条」反向影响，
  // 判据一旦自反馈就会在临界宽度上抖动。
  const naturalW = labelW + snapshot.columns * (cellSize + gap) - gap
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [needsScroll, setNeedsScroll] = useState(false)
  const measure = useCallback((): void => {
    const box = scrollRef.current
    if (box === null) return
    // 判据统一用 offsetWidth（含滚动条占位，与挂不挂滚动条无关）：
    // 它代表容器的可用外框宽度，是本次决策的稳定输入。
    setNeedsScroll(box.offsetWidth < naturalW)
  }, [naturalW])

  useEffect(() => {
    measure()
    const box = scrollRef.current
    if (box === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => { observer.disconnect() }
  }, [measure])

  useEffect(() => ensureActivityStyles(), [])

  const weekLabel = cellSize >= 12 ? WEEKDAYS : WEEKDAYS_SHORT
  const gridVars = {
    '--dsh-activity-cell': `${cellSize}px`,
    '--dsh-activity-radius': `${radius}px`,
  } as CSSProperties

  const legendSteps = [0.3, 0.5, 0.68, 0.85, 1]
  const metricLabel = METRIC_LABELS[metric]

  const tooltipBody = (cell: ActivityCell): JSX.Element => {
    if (mode === 'week') {
      const start = shiftDayKey(cell.key, -cell.row)
      const end = shiftDayKey(cell.key, 6 - cell.row)
      return (
        <>
          <div style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{start} ～ {end}</div>
          <span>周合计 {formatUnits(cell.tokens)} · {cell.weekRequests} 次请求</span>
        </>
      )
    }
    const valueLabel = mode === 'cumulative' ? `累计${metricLabel}` : metricLabel
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 170 }}>
          <div style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 1 }}>
            {cell.key} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontWeight: 500 }}>{WEEKDAYS[cell.row]}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
            <span>{valueLabel}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)' }}>{formatUnits(cell.tokens)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
            <span>模型数</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)' }}>{cell.modelCount}</span>
          </div>
        </div>
      </>
    )
  }

  return (
    <div>
      {/* 卡头：标题 + 副标题 + 分段控件（滑动指示器） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{title}</span>
        {subtitle !== null && (
          <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {metricPicker && onMetricChange !== undefined && (
            <span className={css.dropWrap}>
              <button
                type="button"
                className={css.toolButton}
                style={{ height: 24, padding: '0 8px', fontSize: 11, gap: 4, lineHeight: '16px' }}
                aria-haspopup="menu"
                aria-expanded={metricMenuOpen || undefined}
                onClick={() => { setMetricMenuOpen(v => !v) }}
                title="活动指标口径"
              >
                {METRIC_OPTIONS.find(m => m.id === metric)?.label ?? '用量'}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.7 }}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {metricMenuOpen && (
                <>
                  <button type="button" className={css.bulkOverlay} aria-label="关闭" onClick={() => { setMetricMenuOpen(false) }} />
                  <div className={css.dropMenu} role="menu" aria-label="活动指标口径" style={{ left: 'auto', right: 0 }}>
                    {METRIC_OPTIONS.filter(m => metrics === undefined || metrics.includes(m.id)).map(m => (
                      <button
                        key={m.id}
                        type="button" role="menuitemradio" className={css.dropItem} aria-checked={m.id === metric}
                        onClick={() => { onMetricChange(m.id); setMetricMenuOpen(false) }}
                      >
                        <span className={css.dropCheck} data-on={m.id === metric || undefined} aria-hidden="true"><CheckIcon size={11} /></span>
                        {m.label}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{METRIC_LABELS[m.id]}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </span>
          )}
          <span
            className="dsh-activity-tabs"
            role="group"
            aria-label="Token 活动口径"
            style={{ '--dsh-activity-ind': String(MODES.find(m => m.id === mode)?.index ?? 0) } as CSSProperties}
          >
            <span className="dsh-activity-ind" aria-hidden="true" />
            {MODES.map(m => (
              <button
                key={m.id}
                type="button"
                className="dsh-activity-tab"
                data-active={m.id === mode}
                aria-pressed={m.id === mode}
                onClick={() => onMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </span>
        </span>
      </div>

      {/* 7 行 × 52 列贡献网格：正方形格子固定尺寸，不拉伸。
          滚动容器只在**真的装不下**时才挂：`overflow-x:auto` 会把容器变成滚动
          容器，而里面 `width:fit-content + margin:0 auto` 在滚动容器里按
          scrollWidth 参与居中，亚像素舍入就足以让 scrollWidth 比 clientWidth
          多 1px —— 于是明明只有 52 列、内容装在容器里，右侧却常驻一条滚动条。
          改成按测量结果决定 overflow，装得下时零滚动容器；挂上也显式压掉
          纵向（`overflow-x:auto` 会把 overflow-y 一并提升为 auto，多出一条
          纵向轨道）。 */}
      <div
        ref={scrollRef}
        style={needsScroll
          ? { overflowX: 'auto', overflowY: 'hidden', marginTop: 12, paddingBottom: 2 }
          : { overflow: 'visible', marginTop: 12, paddingBottom: 2 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: 'fit-content', margin: '0 auto', ...gridVars }}>
          {/* 月份标签行（GitHub 惯例：新月份第一周列首标注，跳过首列；按列比例定位，与拉伸后的列对齐） */}
          <div style={{ position: 'relative', height: 16, marginLeft: labelW }}>
            {snapshot.monthLabels.map(m => (
              <span
                key={m.column}
                style={{
                  position: 'absolute',
                  left: `${m.column * (cellSize + gap)}px`,
                  top: 0,
                  fontSize: 11,
                  lineHeight: '16px',
                  color: 'var(--dsw-alias-label-tertiary)',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
          {/* 星期行：周一/周三/周五/周日（与参考稿一致，隔行标注） */}
          {snapshot.rows.map((row, rowIndex) => (
            <div key={rowIndex} style={{ display: 'flex', alignItems: 'center', marginTop: rowIndex === 0 ? 0 : gap }}>
              <span
                style={{
                  flex: 'none',
                  width: labelW,
                  fontSize: 11,
                  lineHeight: `${cellSize}px`,
                  color: 'var(--dsw-alias-label-tertiary)',
                  textAlign: 'left',
                  paddingRight: 6,
                  boxSizing: 'border-box',
                }}
              >
                {rowIndex % 2 === 0 ? weekLabel[rowIndex] : ''}
              </span>
              <span style={{ display: 'flex', gap, flex: 'none' }}>
                {row.map(cell => {
                  if (!cell.past) {
                    return (
                      <span
                        key={cell.key}
                        className="dsh-activity-cell"
                        data-clickable="false"
                        data-past="false"
                        aria-hidden="true"
                        style={{
                          background: 'color-mix(in srgb, var(--dsw-alias-border-l2) 30%, transparent)',
                          animationDelay: `${cell.column * 6}ms`,
                        }}
                      />
                    )
                  }
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className="dsh-activity-cell"
                      data-clickable="true"
                      data-past="true"
                      data-today={cell.isToday}
                      data-selected={selectedKey === cell.key}
                      aria-label={`${cell.key} · ${formatUnits(cell.tokens)}`}
                      aria-pressed={selectedKey === cell.key}
                      onClick={() => onSelect(cell.key)}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setHover({ cell, left: r.left, top: r.top })
                      }}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        background: activityColor(cell.tokens, snapshot.max),
                        animationDelay: `${cell.column * 6}ms`,
                      }}
                    />
                  )
                })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 图例 + 范围标注 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' }}>
        <span>少</span>
        {legendSteps.map((alpha, i) => (
          <span key={i} style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${alpha})` }} />
        ))}
        <span>多</span>
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{snapshot.startKey} ~ {snapshot.endKey}</span>
      </div>

      {/* 悬浮 tooltip：portal 到 body，防祖先 backdrop-filter/transform 钉死坐标系 */}
      {hover !== null && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed',
          bottom: typeof window !== 'undefined' ? window.innerHeight - hover.top + TIP_GAP : 0,
          left: hover.left + 10,
          background: 'var(--dsw-alias-bg-layer-3)',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 10,
          padding: '9px 12px',
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--dsw-alias-label-secondary)',
          zIndex: 6100,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          pointerEvents: 'none',
        }}>
          {tooltipBody(hover.cell)}
        </div>,
        document.body,
      )}
    </div>
  )
}
