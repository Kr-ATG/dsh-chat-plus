/**
 * ObservePanel.tsx — 「观测 / 用量」大盘主壳（工作台 embedded 形态）。
 *
 * ── 这一层负责什么 ──────────────────────────────────────────────────
 * 只做「取数 + 筛选 + 装配」：数据源仍是 ./api 的 usageApi.usage()（普通 GET，
 * 绝不带 ?refresh=1 —— 那条路径会让 host 同步重扫全语料，实测冻 7–22 秒），
 * 视觉细节分别交给 ObserveKpi / ObserveChart / ObserveBreakdown / ActivityGrid。
 *
 * ── 范围 vs 筛选的口径（沿用既有语义，不要在这里另立一套）────────────
 *  - 范围胶囊作用于 KPI、图表、拆分列表；
 *  - 供应商 / 模型 / 关键字筛选是**全局**的，连底部热力图也一起筛（用户点筛选
 *    的意图是「只看这家」，热力图若还显示别家会读成筛选失灵）；
 *  - 状态分段（全部 / 失败 / 重试后成功）只作用于 KPI、图表、拆分列表，不作用于
 *    热力图：热力图是「哪些天有活动」的历史总览，被状态裁掉会变成大面积空白。
 *
 * ── 状态分段的粒度限制（已知近似，不是实现取巧）──────────────────────
 * host 的 failed / retriedSuccess 是**按天计数**，token 也按天聚合，取不到
 * 「这一天里失败那几次花了多少 token」。所以失败档做的是「只保留有失败的天」，
 * 而不是把失败调用的 token 单独切出来；哪天 host 把 failed 做成按调用记账，
 * 这一层才谈得上精确切分。
 *
 * 样式注入在本文件内，前缀 obs-；hub 的 usm- 类（范围胶囊 / 下拉 / 刷新按钮）
 * 直接复用，保证与既有面板手感一致。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usageApi } from './api'
import type { ScopeOption, UsageDay } from './aggregate'
import { resolveRange, toDayStr, type DateRange, type RangePreset } from './range'
import { ActivityGrid, type ActivityMetric, type ActivityMode } from './ActivityGrid'
import { RangePicker } from './primitives/RangePicker'
import { ScopeFilter } from './primitives/ScopeFilter'
import { ErrorCard } from './primitives/ErrorCard'
import { css, ensureHubStyles } from './hub'
import { aggregateModels, observeTotals, type ObserveBreakdownRow } from './cost'
import { ObserveKpi } from './ObserveKpi'
import { ObserveChart } from './ObserveChart'
import { ObserveBreakdown } from './ObserveBreakdown'
import {
  OBSERVE_METRIC_LABELS,
  OBSERVE_REFRESH_STEPS,
  OBSERVE_STATUS_LABELS,
  observeProviderOf,
  type ObserveDayStat,
  type ObserveMetric,
  type ObserveModelStat,
  type ObservePayload,
  type ObserveStatus,
} from './observe-types'

const STYLE_ID = 'dsh-observe-panel-styles'

/**
 * 拿到陈旧快照后的重取间隔。
 * host 的持久化折叠态可以立刻返回，但后台重算要 30s~5min；1.5s 起步轮询几乎
 * 能第一时间接上新值，又不会在大语料下空转。与 UsagePanel 的取值同源。
 */
const STALE_POLL_MS = 1500

/** 自动刷新默认档：15 秒。0 档是「关闭」档，取值由 OBSERVE_REFRESH_STEPS 定义。 */
const DEFAULT_REFRESH_MS = 15000

/* 注入式 CSS 红线：正文与注释里不得出现会提前闭合模板的字符序列。 */
const SHEET = `
/* 宽度：铺满宿主给的空间。曾经这里是 max-width 1400 + margin auto——在 2804px 的
   窗口里两侧各空 700px，看着像「只画了中间一条」。大盘没有「可读宽度」的限制，
   数据越多越该铺开；真正需要收窄的是卡内文字行，那是各行自己的 max-width 的事。
   侧栏与内边距按容器宽度分档，不靠视口——工作台可能是全屏也可能嵌在更窄的栏里。 */
.obs-root { display: flex; flex-direction: column; gap: 12px; padding: 0 22px 26px; margin: 0; box-sizing: border-box; width: 100%; container-type: inline-size; }
.obs-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.obs-bar-l { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.obs-bar-r { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.obs-spacer { flex: 1 1 auto; min-width: 0; }
.obs-stale { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-business-primary, #4176e6); white-space: nowrap; animation: obs-fade-in 180ms ease-out; }
.obs-stale-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: obs-pulse 1.1s ease-in-out infinite; }
@keyframes obs-fade-in { from { opacity: 0; transform: translateX(4px); } to { opacity: 1; transform: translateX(0); } }
@keyframes obs-pulse { 0%, 100% { opacity: 0.35; transform: scale(0.75); } 50% { opacity: 1; transform: scale(1); } }
.obs-meta { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); font-variant-numeric: tabular-nums; white-space: nowrap; }
.obs-foot { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); }
/* 状态分段控件：与 ActivityGrid 的每周/累计同族，但宽度跟着文案走 */
.obs-seg { position: relative; flex: none; display: inline-flex; padding: 3px; border-radius: 10px; background: var(--dsw-alias-fill-l2, rgba(0, 0, 0, 0.05)); }
.obs-seg-btn {
  position: relative; z-index: 1; flex: none; border: none; border-radius: 7px; padding: 0 10px; height: 26px;
  background: transparent; font-family: inherit; font-size: 12px; line-height: 16px; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #61666b); white-space: nowrap;
  transition: color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 140ms ease;
}
.obs-seg-btn:hover { color: var(--dsw-alias-label-primary, #0f1115); }
.obs-seg-btn:active { transform: scale(0.97); }
.obs-seg-btn[data-active] { background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; box-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 18%, transparent); }
/* 自动刷新间隔：用原生下拉，键盘可达、移动端可用，样式收窄到与胶囊视觉一致 */
.obs-select {
  flex: none; height: 28px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 8px; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit; font-size: 12px; line-height: 16px; padding: 0 6px; cursor: pointer; outline: none;
  transition: border-color 140ms ease, background 140ms ease;
}
.obs-select:hover { border-color: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.2)); background: var(--dsw-alias-interactive-bg-hover-solid, #f7f8f9); }
.obs-select:focus-visible { border-color: var(--dsw-alias-state-business-primary, #4176e6); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.obs-search { position: relative; flex: none; display: inline-flex; align-items: center; }
.obs-search-input {
  width: 196px; height: 28px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 8px; background: var(--dsw-alias-bg-base, #fff); padding: 0 26px 0 28px;
  font-family: inherit; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-primary, #1f2430); outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.obs-search-input:focus { border-color: var(--dsw-alias-state-business-primary, #4176e6); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.obs-search-icon { position: absolute; left: 9px; display: inline-flex; color: var(--dsw-alias-label-tertiary, #81858c); pointer-events: none; }
.obs-search-clear { position: absolute; right: 4px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 6px; padding: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #81858c); cursor: pointer; }
.obs-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06)); color: var(--dsw-alias-label-primary, #0f1115); }
.obs-export {
  flex: none; display: inline-flex; align-items: center; gap: 5px; height: 28px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12)); border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit; font-size: 12px; line-height: 16px; padding: 0 10px; cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 140ms ease;
}
.obs-export:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid, #f7f8f9); color: var(--dsw-alias-label-primary, #0f1115); }
.obs-export:active:not(:disabled) { transform: scale(0.97); }
.obs-export:disabled { opacity: 0.45; cursor: default; }
/* 中段：Tab + 图表 + 右侧拆分列表。
   右栏在宽屏固定 320（再宽也只是把列表拉松，没有信息增量），窄到放不下两栏时
   由下面那条 @container 折成单栏——用容器查询而不是视口查询：工作台本身可能是
   全屏，也可能被嵌在更窄的栏里，视口宽度代表不了这一块的可用宽度。 */
/* align-items: stretch（默认）让右栏跟左栏同高：右栏内容（模型列表或空态）比图表短，
   用 start 对齐时右半边会塌成一张小卡，下方留一片空白。 */
.obs-main { display: grid; grid-template-columns: minmax(0, 1fr) clamp(280px, 22%, 380px); gap: 12px; align-items: stretch; }
.obs-card { box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06)); border-radius: 12px; background: var(--dsw-alias-bg-base, #fff); min-width: 0; }
.obs-card-pad { padding: 12px 14px; }
.obs-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 10px 12px 0; }
.obs-tab {
  position: relative; flex: none; border: none; border-radius: 8px; padding: 0 12px; height: 28px;
  background: transparent; font-family: inherit; font-size: 12px; line-height: 16px; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #61666b);
  transition: background 160ms ease, color 160ms ease, transform 140ms ease;
}
.obs-tab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05)); color: var(--dsw-alias-label-primary, #0f1115); }
.obs-tab:active { transform: scale(0.97); }
.obs-tab[data-active] { background: var(--dsw-alias-fill-l2, rgba(0, 0, 0, 0.05)); color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; }
.obs-chart-slot { padding: 4px 12px 10px; min-width: 0; }
/* 右栏与左栏顶对齐、且至少与图表卡同高：空态文案（模型明细重建中 / 无明细）
   只有一行字，不撑高的话右半边会塌成一张小卡、下方留一片空白。 */
.obs-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; align-items: stretch; }
.obs-side > .obs-card { flex: 1 1 auto; display: flex; flex-direction: column; }
.obs-side .obs-bd { flex: 1 1 auto; }
.obs-heat { padding: 2px; }
.obs-empty { display: flex; align-items: center; justify-content: center; padding: 28px 12px; text-align: center; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #81858c); }
.obs-side .obs-empty { flex: 1 1 auto; }
@container (max-width: 900px) { .obs-main { grid-template-columns: minmax(0, 1fr); } }
@container (max-width: 720px) { .obs-root { padding: 0 12px 20px; } .obs-bar-r { margin-left: 0; width: 100%; } .obs-search { flex: 1 1 160px; } .obs-search-input { width: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .obs-stale, .obs-stale-dot { animation: none; }
  .obs-search-input, .obs-seg-btn, .obs-tab, .obs-export, .obs-select { transition: none; }
}
`

/** 幂等注入大盘样式；返回移除函数。 */
function ensureObservePanelStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-triad'
    tag.dataset.pluginCss = 'triad/observe-panel'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

/**
 * 区间过滤（与 range.filterDays 逐字同口径：字符串字典序、含端点）。
 *
 * 不调用 range.filterDays 而自己写一行：它的入参是 UsageDay，而 ObserveDayStat
 * 的 cacheHitRate 允许 null，传过去只能靠双重断言硬塞——类型上假装兼容，实际
 * 是「编译器别管我」。这里日期与比较逻辑都只有一行，重复的成本远低于那份断言
 * 在未来某次字段调整时给的虚假安全感。
 */
function dayInRange(date: string, r: DateRange): boolean {
  return date >= r.start && date <= r.end
}

/**
 * 观测天 → 热力图入参（ActivityGrid 声明的是 UsageDay[]）。
 *
 * 这是一次**显式适配**而不是断言：UsageDay 的 cacheHitRate 是老契约的 number，
 * 观测契约允许 null 表示「当天没有 prompt token」，双重断言能骗过编译器却骗不过
 * 运行时。热力图的读取面（date / 四个 token 桶 / requests）不含该字段，这里把它
 * 归一成 0，其余字段按 ActivityGrid 真正会读的清单给全。
 *
 * 导出给 UsagePanel 的 compact 路径共用：它的 days 状态声明仍是 UsageDay[]（历史
 * 契约），拿到的却是这条路由的观测快照。同一份适配只有一份，别在两处各写一遍。
 */
export function toUsageDays(days: ObserveDayStat[]): UsageDay[] {
  return days.map(d => ({
    date: d.date,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    cacheReadTokens: d.cacheReadTokens,
    cacheWriteTokens: d.cacheWriteTokens,
    tokens: d.tokens,
    cacheHitRate: d.cacheHitRate ?? 0,
    requests: d.requests,
  }))
}

/**
 * 区间内出现过的供应商 / 模型选项，按 token 降序。
 *
 * 与 aggregate.collectProviders / collectModels 同口径（供应商取第一段、模型
 * 用完整路由、选项 id 参与筛选比对、label 只用于展示），但只声明 ObserveDayStat
 * 这一个入参形状，调用点就不必写「观测天当用量天用」的断言。为什么允许这种重复：
 * aggregate 那两个函数服务的是 compact 小卡，它们只认 UsageDay；把入参放宽成
 * 结构类型是另一条路，但那要改别人的文件，且会把两个模块的耦合面扩大。
 *
 * @param days - 参与汇总的观测天（调用方负责先按范围裁好）。
 * @param within - 限定在某供应商内（null = 全部）。
 */
function collectObserveOptions(days: ObserveDayStat[], within: string | null): { providers: ScopeOption[]; models: ScopeOption[] } {
  const providerTotals = new Map<string, number>()
  const modelTotals = new Map<string, number>()
  for (const d of days) {
    for (const m of d.models ?? []) {
      const provider = observeProviderOf(m.model)
      const tokens = m.tokens ?? 0
      providerTotals.set(provider, (providerTotals.get(provider) ?? 0) + tokens)
      // 选了供应商后模型下拉只列该供应商——与 ScopeFilter 的级联语义一致。
      if (within !== null && provider !== within) continue
      modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + tokens)
    }
  }
  const rank = (totals: Map<string, number>, labelOf: (id: string) => string): ScopeOption[] =>
    [...totals].map(([id, tokens]) => ({ id, label: labelOf(id), tokens }))
      .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id))
  return {
    providers: rank(providerTotals, (provider) => provider),
    // 模型展示名剥掉供应商前缀：筛选仍按完整路由比对（ScopeFilter 的既有契约）。
    models: rank(modelTotals, (model) => (model.indexOf('/') < 0 ? model : model.slice(model.indexOf('/') + 1))),
  }
}

/**
 * 用给定的模型子集重算这一天的观测字段。
 *
 * 四桶、命中率、计时都必须一起重算：只改 models 数组而留着原来的 tokens，KPI 会
 * 显示一批「明细里找不到来源」的数字。命中率按重算后的桶重算，与 host 侧
 * cacheHitRate() 同源，否则筛选后的命中率会与全量对不上。
 */
function recomputeDay(d: ObserveDayStat, models: ObserveModelStat[]): ObserveDayStat {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0
  let requests = 0, failed = 0, retriedSuccess = 0
  let genMs = 0, genTokens = 0, ttftMs = 0, ttftSteps = 0
  for (const m of models) {
    input += m.inputTokens ?? 0
    output += m.outputTokens ?? 0
    cacheRead += m.cacheReadTokens ?? 0
    cacheWrite += m.cacheWriteTokens ?? 0
    requests += m.requests ?? 0
    failed += m.failed ?? 0
    retriedSuccess += m.retriedSuccess ?? 0
    genMs += m.genMs ?? 0
    genTokens += m.genTokens ?? 0
    ttftMs += m.ttftMs ?? 0
    ttftSteps += m.ttftSteps ?? 0
  }
  const prompt = input + cacheRead + cacheWrite
  return {
    ...d,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    tokens: input + output + cacheRead + cacheWrite,
    cacheHitRate: prompt > 0 ? Math.round((cacheRead / prompt) * 1000) / 10 : null,
    requests,
    failed,
    retriedSuccess,
    genMs,
    genTokens,
    ttftMs,
    ttftSteps,
    models,
  }
}

/**
 * 供应商 / 模型筛选。
 *
 * 不走 aggregate.filterDaysByScope：它会丢掉观测扩展字段（failed / 计时），
 * 而大盘的 KPI 与拆分列表全靠这些字段。模型子集没变化时返回原对象，让下游
 * useMemo 的依赖比较能直接命中同一引用。
 */
function applyScope(days: ObserveDayStat[], provider: string | null, model: string | null): ObserveDayStat[] {
  if (provider === null && model === null) return days
  return days.map((d) => {
    const all = d.models ?? []
    const models = all.filter((m) => (model !== null ? m.model === model : provider !== null && observeProviderOf(m.model) === provider))
    return models.length === all.length ? d : recomputeDay(d, models)
  })
}

/**
 * 关键字过滤（匹配完整模型路由或供应商前缀）。
 *
 * 供应商只取第一段（observeProviderOf），与下拉筛选的口径一致：用户搜
 * 「workbuddy」时不该漏掉 workbuddy-ai/... 之外的兄弟供应商，也不该因为模型名
 * 里恰好含这个词而把别家拉进来——两种都算命中，才是最不让人意外的行为。
 */
function applyKeyword(days: ObserveDayStat[], query: string): ObserveDayStat[] {
  const q = query.trim().toLowerCase()
  if (q === '') return days
  return days.map((d) => {
    const all = d.models ?? []
    const models = all.filter((m) => m.model.toLowerCase().includes(q) || observeProviderOf(m.model).toLowerCase().includes(q))
    return models.length === all.length ? d : recomputeDay(d, models)
  })
}

/** CSV 单元格转义：模型路由里可能出现逗号或引号，包一层双引号并翻倍内部引号。 */
function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** 自动刷新档位的中文名：0 档是「关闭」，其余按秒展示。 */
function refreshLabel(ms: number): string {
  return ms === 0 ? '不自动刷新' : `${Math.round(ms / 1000)} 秒`
}

export function ObservePanel(): JSX.Element {
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [custom, setCustom] = useState<DateRange | null>(null)
  const [payload, setPayload] = useState<ObservePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [stale, setStale] = useState(false)
  const [tick, setTick] = useState(0)
  const [autoMs, setAutoMs] = useState<number>(DEFAULT_REFRESH_MS)
  const [provider, setProvider] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [status, setStatus] = useState<ObserveStatus>('all')
  const [query, setQuery] = useState('')
  const [metric, setMetric] = useState<ObserveMetric>('tokens')
  const [heatMetric, setHeatMetric] = useState<ActivityMetric>('tokens')
  const [heatMode, setHeatMode] = useState<ActivityMode>('day')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // 手动刷新与自动刷新共用同一条取数链路；只有手动那一次转圈，否则按钮会一直闪。
  const manualRef = useRef(false)

  ensureHubStyles()
  useEffect(() => ensureObservePanelStyles(), [])

  /**
   * 取数。host 可能先给持久化折叠态（stale=true）再在后台重算，遇到这种就自己
   * 接着轮询到新鲜为止——面板始终有内容可看，用户不必手动点刷新。
   */
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    setError(null)
    const load = (): void => {
      usageApi.usage().then((p) => {
        if (!alive) return
        if (p.ok !== true) throw new Error('用量数据加载失败')
        setPayload(p)
        setStale(p.stale === true)
        if (manualRef.current) { manualRef.current = false; setRefreshing(false) }
        if (p.stale === true) timer = setTimeout(load, STALE_POLL_MS)
      }).catch((e: unknown) => {
        if (!alive) return
        manualRef.current = false
        setRefreshing(false)
        setError(e instanceof Error ? e.message : String(e))
      })
    }
    load()
    return () => { alive = false; if (timer !== null) clearTimeout(timer) }
  }, [tick])

  /** 自动刷新：只递增 tick 复用上面那条链路，不另写一套请求逻辑。 */
  useEffect(() => {
    if (autoMs <= 0) return undefined
    const id = setInterval(() => { setTick(t => t + 1) }, autoMs)
    return () => { clearInterval(id) }
  }, [autoMs])

  const days = payload?.days ?? []
  const { range, label: rangeLabel } = resolveRange(preset, custom)
  const inRange = useMemo(() => days.filter(d => dayInRange(d.date, range)), [days, range.start, range.end])

  // 下拉选项取「范围 ∩ 全量」：范围决定看哪几天，选项要能选到该范围内真实出现过的。
  const options = useMemo(() => collectObserveOptions(inRange, provider), [inRange, provider])

  const scoped = useMemo(() => applyKeyword(applyScope(inRange, provider, model), query), [inRange, provider, model, query])

  /** 状态档：按天过滤（见文件头「粒度限制」）。 */
  const filtered = useMemo(() => {
    if (status === 'failed') return scoped.filter(d => (d.failed ?? 0) > 0)
    if (status === 'retried') return scoped.filter(d => (d.retriedSuccess ?? 0) > 0)
    return scoped
  }, [scoped, status])

  const totals = useMemo(() => observeTotals(filtered), [filtered])
  const rows = useMemo<ObserveBreakdownRow[]>(() => {
    const all = aggregateModels(filtered)
    // 失败档下拆分列表跟着 KPI 走：KPI 只统计有失败的天，列表若还列满所有模型，
    // 右栏合计会大于左侧 KPI，读起来像对不上账。
    return status === 'failed' ? all.filter(r => r.failed > 0) : all
  }, [filtered, status])

  const activeDays = useMemo(() => scoped.filter(d => (d.tokens ?? 0) > 0).length, [scoped])
  // 热力图 = 全历史 × 筛选（不含范围与状态档），与既有面板口径一致。
  const heatDays = useMemo(() => applyKeyword(applyScope(days, provider, model), query), [days, provider, model, query])
  const heatGridDays = useMemo(() => toUsageDays(heatDays), [heatDays])

  // 换范围后选中的那天可能已不在结果里：留着会让图表高亮一条不存在的柱子。
  useEffect(() => { setSelectedDay(null) }, [range.start, range.end])

  const doRefresh = useCallback((): void => {
    manualRef.current = true
    setRefreshing(true)
    setTick(t => t + 1)
  }, [])

  if (error !== null) {
    return <div className="obs-root" style={{ paddingTop: 12 }}><ErrorCard message={error} onRetry={doRefresh} /></div>
  }

  /** 导出当前拆分列表：纯前端生成，字段与右栏展示的六个口径逐字一致。 */
  const exportCsv = (): void => {
    const header = 'model,tokens,requests,failed,cache_hit_rate,tokens_per_sec,ttft_ms\n'
    const body = rows.map(r => [
      csvCell(r.model),
      String(r.tokens),
      String(r.requests),
      String(r.failed),
      r.cacheHitRate === null ? '' : String(r.cacheHitRate),
      r.tokensPerSec === null ? '' : r.tokensPerSec.toFixed(1),
      r.ttftMs === null ? '' : String(Math.round(r.ttftMs)),
    ].join(',')).join('\n')
    const blob = new Blob([`${header}${body}\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `usage-${rangeLabel.replace(/\s+/g, '')}-${toDayStr(new Date())}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const topBar = (
    <div className="obs-bar">
      <div className="obs-bar-l">
        <RangePicker compact preset={preset} custom={custom} onChangePreset={setPreset} onChangeCustom={setCustom} />
      </div>
      <div className="obs-bar-r">
        {stale && <span className="obs-stale" role="status" aria-live="polite"><span className="obs-stale-dot" />后台更新中</span>}
        <button type="button" className={css.refresh} data-spin={refreshing || undefined} aria-label="刷新用量数据" onClick={doRefresh}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 0 1-15.9 5.7M3 12a9 9 0 0 1 15.9-5.7" />
            <path d="M21 3v6h-6M3 21v-6h6" />
          </svg>
        </button>
        <select
          className="obs-select"
          aria-label="自动刷新间隔"
          title="自动刷新间隔"
          value={String(autoMs)}
          onChange={(e) => { setAutoMs(Number(e.target.value)) }}
        >
          {OBSERVE_REFRESH_STEPS.map(ms => <option key={ms} value={String(ms)}>{refreshLabel(ms)}</option>)}
        </select>
      </div>
    </div>
  )

  const filterBar = (
    <div className="obs-bar">
      <div className="obs-bar-l">
        <ScopeFilter
          providers={options.providers}
          models={options.models}
          provider={provider}
          model={model}
          onChangeProvider={(next) => { setProvider(next); setModel(null) }}
          onChangeModel={setModel}
        />
        <div className="obs-seg" role="group" aria-label="请求状态">
          {(Object.keys(OBSERVE_STATUS_LABELS) as ObserveStatus[]).map(s => (
            <button
              key={s}
              type="button"
              className="obs-seg-btn"
              data-active={status === s || undefined}
              aria-pressed={status === s}
              onClick={() => { setStatus(s) }}
            >
              {OBSERVE_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="obs-bar-r">
        <span className="obs-search">
          <span className="obs-search-icon" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            className="obs-search-input"
            type="search"
            value={query}
            placeholder="搜索模型、供应商"
            aria-label="搜索模型或供应商"
            onChange={(e) => { setQuery(e.target.value) }}
          />
          {query !== '' && (
            <button type="button" className="obs-search-clear" aria-label="清除搜索" onClick={() => { setQuery('') }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </span>
        <button type="button" className="obs-export" onClick={exportCsv} disabled={rows.length === 0}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
          </svg>
          导出 CSV
        </button>
      </div>
    </div>
  )

  if (payload === null) {
    return <div className="obs-root" style={{ paddingTop: 12 }}>{topBar}{filterBar}<div className="obs-empty">加载中…</div></div>
  }

  const noData = filtered.length === 0
  /**
   * 模型明细不可用：整体有量、但每个模型行的 token 都是 0。
   *
   * 从旧缓存（v8 及更早）迁移过来的会话就是这个状态——host 的模型桶曾经漏加
   * token，天级对、模型级全零，后台重折完成前一直如此。这时拆分列表会渲染成
   * 一列「0」，看着像坏了；明说原因、提示后台正在补，比让人怀疑数据准确更诚实。
   */
  const modelsUnusable = rows.length > 0 && rows.every(r => r.tokens <= 0) && totals.tokens > 0

  return (
    <div className="obs-root">
      {topBar}
      {filterBar}
      <div className="obs-bar">
        <span className="obs-foot">统计网关调用与会话日志调用；本地拒绝的请求不计入汇总。</span>
        <span className="obs-spacer" />
        <span className="obs-meta">共 {inRange.length} 天 · 有量 {activeDays} 天 · {rows.length} 个模型</span>
      </div>
      <ObserveKpi totals={totals} />
      <div className="obs-main">
        <div className="obs-card">
          <div className="obs-tabs" role="tablist" aria-label="图表口径">
            {(Object.keys(OBSERVE_METRIC_LABELS) as ObserveMetric[]).map(m => (
              <button
                key={m}
                type="button"
                role="tab"
                className="obs-tab"
                data-active={metric === m || undefined}
                aria-selected={metric === m}
                onClick={() => { setMetric(m) }}
              >
                {OBSERVE_METRIC_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="obs-chart-slot">
            {noData
              ? <div className="obs-empty">当前范围与筛选下没有数据</div>
              : (
                <ObserveChart
                  days={filtered}
                  metric={metric}
                  highlightDate={selectedDay}
                  onSelectDate={setSelectedDay}
                />
              )}
          </div>
        </div>
        <div className="obs-side">
          {/* 拆分列表自带的是列表内部样式（.obs-bd 无边框无内边距，按「外层给壳」设计），
              卡片壳与内边距由这里提供，避免两处各画一层边框。 */}
          <div className="obs-card obs-card-pad">
            {rows.length === 0
              ? <div className="obs-empty">没有可拆分的模型明细</div>
              : modelsUnusable
                ? <div className="obs-empty">模型级明细正在后台重建，稍后自动出现</div>
                : <ObserveBreakdown models={rows} metric={metric} />}
          </div>
        </div>
      </div>
      <div className="obs-card obs-card-pad">
        <div className="obs-heat">
          <ActivityGrid
            days={heatGridDays}
            mode={heatMode}
            onMode={setHeatMode}
            metric={heatMetric}
            onMetricChange={setHeatMetric}
            metricPicker
            title="用量热力图"
            subtitle="最近 53 周的每日用量"
            cellSize={12}
            selectedKey={selectedDay}
            onSelect={setSelectedDay}
          />
        </div>
      </div>
    </div>
  )
}
