/**
 * UsagePanel — 用量面板（贴入口弹出的定尺寸小卡片）。
 *
 * 只保留两件事：
 *  1. 热力图：52 周 Token 活动贡献图（每周/累计口径 + 指标下拉，点格子看当日明细）；
 *  2. token 消耗查询：顶部范围胶囊（今日/昨日/近 7 天/…/自定义）联动四格汇总
 *     （合计 / 输入 / 输出 / 缓存），下方一行元信息（天数 / 有量天数 / 模型数）。
 *
 * 范围只作用于第 2 项（所选区间的消耗）；热力图是横跨历史的总览，恒为全量 52 周，
 * 与 range.ts 的注释口径一致。
 *
 * 尺寸：交给 PopoverShell 的 compact 形态（内联宽高 + 视口夹紧），窄屏回退全屏。
 */

import { useEffect, useMemo, useState } from 'react'
import { usageApi } from './api'
import { averageCacheHitRate, collectModels, collectProviders, filterDaysByScope, providerOfModel, sumTokens, type UsageDay } from './aggregate'
import { filterDays, resolveRange, type DateRange, type RangePreset } from './range'
import { formatExact, formatHitRate, formatUnits } from './format'
import { ActivityGrid, type ActivityMetric, type ActivityMode } from './ActivityGrid'
import { RangePicker } from './primitives/RangePicker'
import { ScopeFilter } from './primitives/ScopeFilter'
import { ErrorCard } from './primitives/ErrorCard'
import { useIsMobile } from '../../responsive'
import { PshBody, PopoverShell, type PopoverAnchor } from '../../popover-shell'
import { modalStaggerClass } from '../../triad-modal-animation'
import { ensureHubStyles, CloseIcon, tokensIcon, inputIcon, outputIcon, hitIcon } from './hub'

/**
 * 卡片宽度（px）：比工作台小一个量级，仍能一行放下 52 周热力（9px 格）。
 *
 * 高度**不再写死**（2026-10-04）：曾经用 414 / 560 两档定值去凑两种内容形态，
 * 结果是「选某天」时高度跳一档、长模型名换行时内容被裁、而 `.usm-uc` 上还留着
 * `overflow-y:auto` —— 用户看到的是卡片里凭空多出一条滚动条，且卡底一片空白
 * （默认态 414 里内容只占 298）。现在 compact 形态的高度完全由内容撑开
 * （`PopoverShell` 的 `size.height` 不传），内部也不滚动。
 */
const CARD_WIDTH = 648

const STYLE_ID = 'dsh-usage-compact-styles'

/** 拿到陈旧快照后的重试间隔：host 后台一轮聚合的自适应间隔是 30s~5min，1.5s 起步轮询能几乎立刻接上新值，又不会在语料很大时空转。 */
const STALE_POLL_MS = 1500

/**
 * 紧凑用量卡样式。刻意局部注入而不进 hub.tsx：这份语言只服务这一个卡片，
 * 与工作台共享层解耦，未来再加卡片也不会把样式表撑成大杂烩。
 * 注释里不出现会提前闭合注释块的字符序列。
 */
const SHEET = `
/* 卡片主体：高度由内容撑开（不设 flex:1 / overflow），卡片多高它多高。
   曾经这里是 flex:1 1 auto + min-height:0 + overflow-y:auto —— 在写死高度的
   卡片里那是必要的（内容超出靠内部滚动），但用户明确不要滚动，且卡片高度现在
   自适应，这行就成了「内容没超出也留着一条滚动条」的来源。 */
.usm-uc { flex: none; min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 12px; }
.usm-uc-top { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.usm-uc-meta { flex: 1 1 auto; min-width: 0; text-align: right; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.usm-uc-sync { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-business-primary, #4176e6); white-space: nowrap; animation: usm-sync-in 180ms ease-out; }
.usm-uc-sync-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: usm-sync-pulse 1.1s ease-in-out infinite; }
@keyframes usm-sync-in { from { opacity: 0; transform: translateX(4px); } to { opacity: 1; transform: translateX(0); } }
@keyframes usm-sync-pulse { 0%, 100% { opacity: 0.35; transform: scale(0.75); } 50% { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .usm-uc-sync { animation: none; } .usm-uc-sync-dot { animation: none; opacity: 0.8; } }
.usm-uc-stats { flex: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.usm-uc-stat { min-width: 0; display: flex; flex-direction: column; gap: 1px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06)); border-radius: 10px; background: var(--dsw-alias-bg-base, #fff); padding: 7px 9px; }
.usm-uc-stat-head { display: flex; align-items: center; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary, #8f96a3); }
.usm-uc-label { font-size: 11px; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.usm-uc-value { font-size: 17px; font-weight: 700; line-height: 22px; letter-spacing: -0.2px; color: var(--dsw-alias-label-primary, #0f1115); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.usm-uc-sub { font-size: 10.5px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #81858c); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.usm-uc-card { flex: none; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06)); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.usm-uc-day-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.usm-uc-day-title { font-size: 12px; font-weight: 600; line-height: 18px; color: var(--dsw-alias-label-primary, #0f1115); white-space: nowrap; }
.usm-uc-day-sum { font-size: 11px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #81858c); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usm-uc-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-left: auto; border: none; border-radius: 6px; padding: 0; background: transparent; cursor: pointer; color: var(--dsw-alias-label-tertiary, #81858c); }
.usm-uc-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06)); color: var(--dsw-alias-label-primary, #0f1115); }
/* 当日模型明细：同样不滚动（当日模型通常 1–5 个，几十个的极端情况由卡片整体
   高度自适应承担，而不是在卡内再嵌一层滚动条）。 */
.usm-uc-models { display: flex; flex-direction: column; }
.usm-uc-model { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 0; font-size: 12px; line-height: 17px; }
.usm-uc-model + .usm-uc-model { border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.05)); }
.usm-uc-model-name { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-primary, #0f1115); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usm-uc-model-num { flex: none; color: var(--dsw-alias-label-secondary, #61666b); font-variant-numeric: tabular-nums; }
@media (max-width: 767.98px) {
  .usm-uc { padding: 10px 10px 12px; }
  .usm-uc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .usm-uc-meta { text-align: left; flex-basis: 100%; }
}
`

/** 幂等注入紧凑卡样式；返回移除函数。 */
function ensureCompactStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-triad'
    tag.dataset.pluginCss = 'triad/usage-compact'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'] as const

/** YYYY-MM-DD → 「08-23 周日」。 */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay()
  return `${date.slice(5)} 周${WEEK[wd]}`
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

import { UsageTrendChart } from './UsageTrendChart'
import { UsageHero } from './UsageHero'

export interface UsagePanelProps {
  closing?: boolean
  onClose: () => void
  anchor?: PopoverAnchor | null
  embedded?: boolean
}

export function UsagePanel({ closing = false, onClose, anchor = null, embedded = false }: UsagePanelProps): JSX.Element {
  const [preset, setPreset] = useState<RangePreset>('today')
  const [custom, setCustom] = useState<DateRange | null>(null)
  const [days, setDays] = useState<UsageDay[] | null>(null)
  const [metric, setMetric] = useState<ActivityMetric>('tokens')
  const [mode, setMode] = useState<ActivityMode>('day')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [stale, setStale] = useState(false)
  const [tick, setTick] = useState(0)
  const [provider, setProvider] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const isMobile = useIsMobile()

  ensureHubStyles()

  useEffect(() => ensureCompactStyles(), [])

  /**
   * 拉数据。拿到的可能是 host 的「陈旧快照」——进程刚起来、或后台重算还没
   * 跑完时，host 会立刻把持久化的折叠态返给我们（stale=true）而不让我们
   * 干等语料重扫。遇到这种就自己轮询下去，直到拿到新鲜的一轮，面板始终
   * 有内容可看，也不需要用户手动点刷新。
   */
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    setError(null)
    const load = (): void => {
      usageApi.usage().then((p) => {
        if (!alive) return
        if (p.ok !== true) throw new Error('用量数据加载失败')
        setDays(p.days)
        setRefreshing(false)
        setStale(p.stale === true)
        if (p.stale === true) timer = setTimeout(load, STALE_POLL_MS)
      }).catch((e: unknown) => {
        if (!alive) return
        setRefreshing(false)
        setError(e instanceof Error ? e.message : String(e))
      })
    }
    load()
    return () => { alive = false; if (timer !== null) clearTimeout(timer) }
  }, [tick])

  const { range, label: rangeLabel } = resolveRange(preset, custom)
  const inRangeDays = useMemo(() => filterDays(days ?? [], range), [days, range.start, range.end])

  // 换范围后当前选中的供应商/模型可能已不在范围内；留着会让下拉显示一个
  // 查不到数据的选项，比自动回落更费解。数据回来时同理（刷新后模型下线了）。
  useEffect(() => {
    setModel((current) => current !== null && !inRangeDays.some((d) => (d.models ?? []).some((m) => m.model === current)) ? null : current)
    setProvider((current) => current !== null && !inRangeDays.some((d) => (d.models ?? []).some((m) => providerOfModel(m.model) === current)) ? null : current)
    setSelectedDay(null)
  }, [inRangeDays])

  /** 头部刷新：重取一次快照，host 在后台重算，按钮转到数据回来为止。 */
  const doRefresh = (): void => {
    setRefreshing(true)
    setTick(t => t + 1)
  }

  const head = ((): JSX.Element => {
    if (error) return <ErrorCard message={error} onRetry={doRefresh} />
    if (days === null) {
      return <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</div>
    }
    return <Body
      days={days}
      range={range}
      rangeLabel={rangeLabel}
      preset={preset}
      custom={custom}
      onChangePreset={setPreset}
      onChangeCustom={setCustom}
      provider={provider}
      model={model}
      onChangeProvider={setProvider}
      onChangeModel={setModel}
      metric={metric}
      onMetric={setMetric}
      mode={mode}
      onMode={setMode}
      selectedDay={selectedDay}
      onSelectDay={setSelectedDay}
      isMobile={isMobile}
      stale={stale}
      embedded={embedded}
    />
  })()

  if (embedded) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', width: '100%', boxSizing: 'border-box' }}>
        {/* 效果图第 4 页页头：英雄区之上的定位说明 */}
        <header className="wb2-head wb2-rise">
          <div className="wb2-head-l">
            <span className="wb2-eyebrow"><i />Token Telemetry</span>
            <h1 className="wb2-title">用量 <em>/ 烧了多少</em></h1>
            <p className="wb2-sub">范围胶囊只作用于消耗汇总；热力带恒为全量 52 周，是横跨历史的总览。</p>
          </div>
        </header>
        <div style={{ padding: '0 22px 26px', maxWidth: 1400, margin: '0 auto', boxSizing: 'border-box' }}>
          {head}
        </div>
      </div>
    )
  }

  return (
    <PopoverShell
      solid
      closing={closing}
      onClose={onClose}
      anchor={anchor}
      /* 只给宽度、不给高度：compact 形态据此走「内容自适应」分支，
         卡片高度由 .usm-uc 的实际内容撑开（选某天多一张明细卡就自动长高）。 */
      size={{ width: CARD_WIDTH }}
      variant="compact"
      ariaLabel="用量"
    >
      <div className="psh-head">
        <span className="psh-title" style={{ flex: 'none' }}>用量</span>
        <span style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="usm-refresh" data-spin={refreshing || undefined} aria-label="刷新用量数据" onClick={doRefresh}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 0 1-15.9 5.7M3 12a9 9 0 0 1 15.9-5.7" />
            <path d="M21 3v6h-6M3 21v-6h6" />
          </svg>
        </button>
        <button type="button" className="psh-close" aria-label="关闭用量面板" onClick={onClose}>
          <CloseIcon size={13} />
        </button>
      </div>
      <PshBody>{head}</PshBody>
    </PopoverShell>
  )
}

/** 卡片主体：查询行 + 汇总四格 + 热力图 + 当日明细。 */
function Body({ days, range, rangeLabel, preset, custom, onChangePreset, onChangeCustom, provider, model, onChangeProvider, onChangeModel, metric, onMetric, mode, onMode, selectedDay, onSelectDay, isMobile, stale, embedded }: {
  days: UsageDay[]
  range: DateRange
  rangeLabel: string
  preset: RangePreset
  custom: DateRange | null
  onChangePreset: (preset: RangePreset) => void
  onChangeCustom: (range: DateRange) => void
  provider: string | null
  model: string | null
  onChangeProvider: (provider: string | null) => void
  onChangeModel: (model: string | null) => void
  metric: ActivityMetric
  onMetric: (metric: ActivityMetric) => void
  mode: ActivityMode
  onMode: (mode: ActivityMode) => void
  selectedDay: string | null
  onSelectDay: (date: string | null) => void
  isMobile: boolean
  stale: boolean
  embedded: boolean
}): JSX.Element {
  const inRange = filterDays(days, range)
  // 下拉选项来自「范围 ∩ 全量」：范围决定看哪几天，选项本身要能选到该范围内
  // 真实出现过的供应商/模型，而不是历史全量里那些这周没用过的。
  const options = useMemo(() => ({
    providers: collectProviders(inRange),
    models: collectModels(inRange, provider),
  }), [inRange, provider])
  const scoped = useMemo(() => filterDaysByScope(inRange, provider, model), [inRange, provider, model])
  const sum = sumTokens(scoped)
  const hitRate = averageCacheHitRate(scoped)
  const activeDays = scoped.filter(d => (d.tokens ?? 0) > 0).length
  const modelCount = new Set<string>()
  for (const d of scoped) for (const m of d.models ?? []) modelCount.add(m.model)
  const share = (n: number): string => (sum.total > 0 ? `${Math.round((n / sum.total) * 100)}%` : '—')
  // 热力图与当日明细走「全历史 × 当前筛选」：范围胶囊管的是 token 消耗查询，
  // 而活动是横跨 52 周的总览，不该被查询范围裁掉；筛选则要贯穿全局。
  const filtering = provider !== null || model !== null
  const scopedAll = useMemo(() => filterDaysByScope(days, provider, model), [days, provider, model])
  const day = selectedDay === null ? undefined : scopedAll.find(d => d.date === selectedDay)
  // 筛选态下调用次数按模型拆不出来（已归零），留在下拉里只会给出一片全空的格子。
  const shownMetric: ActivityMetric = filtering && metric === 'requests' ? 'tokens' : metric

  return (
    <div className={`usm-uc ${modalStaggerClass}`}>
      <div className="usm-uc-top" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <RangePicker compact preset={preset} custom={custom} onChangePreset={onChangePreset} onChangeCustom={onChangeCustom} />
          <ScopeFilter
            providers={options.providers}
            models={options.models}
            provider={provider}
            model={model}
            onChangeProvider={(next) => { onChangeProvider(next); onChangeModel(null) }}
            onChangeModel={onChangeModel}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {stale && (
            <span className="usm-uc-sync" role="status" aria-live="polite">
              <span className="usm-uc-sync-dot" />
              后台更新中
            </span>
          )}
          <span className="usm-uc-meta">共 {inRange.length} 天 · 有量 {activeDays} 天 · {modelCount.size} 个模型</span>
        </div>
      </div>
      {/* 工作台嵌入形态：效果图英雄区（大数 + 指标卡 + 仪表）取代旧四格小汇总；
          compact 小卡片保持旧四格（空间不够放英雄区）。 */}
      {embedded && (
        <UsageHero
          days={days}
          scoped={scoped}
          range={range}
          sum={sum}
          hitRate={hitRate}
          activeDays={activeDays}
          modelCount={modelCount.size}
        />
      )}
      {!embedded && (
      <div className="usm-uc-stats" role="group" aria-label={`${rangeLabel} token 消耗`} style={isMobile ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } : undefined}>
        <Stat icon={tokensIcon(14)} label="合计用量" value={formatUnits(sum.total)} sub={`≈ ${formatExact(sum.total)}`} tone="var(--dsw-alias-state-business-primary, #4176e6)" />
        <Stat icon={inputIcon(14)} label="输入 Tokens" value={formatUnits(sum.input)} sub={`占 ${share(sum.input)}`} tone="#0ea5e9" />
        <Stat icon={outputIcon(14)} label="输出 Tokens" value={formatUnits(sum.output)} sub={`占 ${share(sum.output)}`} tone="#f59e0b" />
        <Stat icon={hitIcon(14)} label="缓存命中" value={formatUnits(sum.cache)} sub={`命中率 ${formatHitRate(hitRate)}`} tone="#10b981" />
      </div>
      )}
      {!embedded && (
      <UsageTrendChart
        days={scopedAll}
        range={range}
        rangeLabel={rangeLabel}
        preset={preset}
        selectedDate={selectedDay}
        onSelectDate={onSelectDay}
      />
      )}
      <div className="usm-uc-card">
        <ActivityGrid
          days={scopedAll}
          mode={mode}
          onMode={onMode}
          metric={shownMetric}
          onMetricChange={onMetric}
          metricPicker
          metrics={filtering ? ['tokens', 'input', 'output', 'cache'] : undefined}
          title="Token 活动"
          subtitle="52 周"
          cellSize={9}
          selectedKey={selectedDay}
          onSelect={onSelectDay}
        />
      </div>
      {day !== undefined && (
        <div className="usm-uc-card">
          <div className="usm-uc-day-head">
            <span className="usm-uc-day-title">{dayLabel(day.date)}</span>
            <span className="usm-uc-day-sum">
              合计 {formatUnits(day.tokens ?? 0)} · 输入 {formatUnits(day.inputTokens ?? 0)} · 输出 {formatUnits(day.outputTokens ?? 0)} · 命中 {formatHitRate(day.cacheHitRate)}
            </span>
            <button type="button" className="usm-uc-close" aria-label="关闭当日明细" onClick={() => { onSelectDay(null) }}>
              <CloseIcon size={11} />
            </button>
          </div>
          {/* 当日模型明细：不设 maxHeight / overflow —— 卡片高度由内容撑开 */}
          <div className="usm-uc-models">
            {[...(day.models ?? [])].sort((a, b) => b.tokens - a.tokens).map(m => (
              <div key={m.model} className="usm-uc-model">
                <span className="usm-uc-model-name" title={m.model}>{m.model}</span>
                <span className="usm-uc-model-num" style={{ fontFamily: MONO }}>{formatUnits(m.tokens)}</span>
              </div>
            ))}
            {(day.models?.length ?? 0) === 0 && <div className="usm-uc-sub">当日无模型明细</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/** 汇总格：彩色指示微标 + 标签 + 主值 + 副行（精致语义点睛）。 */
function Stat({ icon, label, value, sub, tone }: { icon: JSX.Element; label: string; value: string; sub: string; tone: string }): JSX.Element {
  return (
    <div className="usm-uc-stat">
      <span className="usm-uc-stat-head">
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" style={{ flex: 'none' }}>
          <rect width="8" height="8" rx="2" fill={tone} opacity={0.9} />
        </svg>
        <span className="usm-uc-label">{label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', color: tone, opacity: 0.9, marginLeft: 'auto' }}>{icon}</span>
      </span>
      <span className="usm-uc-value">{value}</span>
      <span className="usm-uc-sub">{sub}</span>
    </div>
  )
}

