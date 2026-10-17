/**
 * ObserveBreakdown — 「观测 / 用量」大盘右栏的「拆分维度」列表。
 *
 * 纯展示：数据全部来自 props（主壳算好的模型级聚合），组件只做排名、聚合与呈现，
 * 不取数、不请求、不写回。
 *
 * 两个维度：
 *  - 模型：props 原样一行一个模型；
 *  - 供应商：按 observe-types 的 observeProviderOf 归并路由前缀。归并后主值直接
 *    加总（tokens / requests 都是可加量），而命中率、出速、首字延迟是不可加
 *    的比率，只能加权平均；这里用 tokens 作权重，因为 props 里只有 tokens 是各维度
 *    都有的可比权重。缺值（null）的行不参与该比率的加权，也不把结果拉成 0。
 *
 * 颜色与柱状图同源：rankObserveModels + observeSegColor 用的是同一份「按当前口径
 * 权重排名」，所以同一个模型在柱图里是什么颜色，在这里就是什么颜色。
 */
import { useMemo, useState, type CSSProperties } from 'react'
import type { ObserveMetric } from './observe-types'
import { observeProviderOf } from './observe-types'
import { formatExact, formatHitRate, formatUnits } from './format'
import { SEGMENT_TOKENS, observeMetricText, observeSegColor, rankObserveModels } from './ObserveChart'

const STYLE_ID = 'dsh-observe-breakdown-styles'

/** 维度切换：模型 / 供应商。 */
type ObserveDimension = 'model' | 'provider'

/** props 里的模型级聚合行（字段名由主壳契约固定，不得改名）。 */
export interface ObserveBreakdownModel {
  model: string
  tokens: number
  requests: number
  failed: number
  cacheHitRate: number | null
  tokensPerSec: number | null
  ttftMs: number | null
}

export interface ObserveBreakdownProps {
  models: ObserveBreakdownModel[]
  metric: ObserveMetric
}

/** 列表渲染行：模型维度直接来自 props，供应商维度是归并结果。 */
interface ObserveRow {
  key: string
  name: string
  value: number
  tokens: number
  requests: number
  failed: number
  cacheHitRate: number | null
  tokensPerSec: number | null
  ttftMs: number | null
}

/** 注入式样式表。CSS 正文里不写注释，避免任何注释闭合序列把后面的规则拖成非法选择器。 */
const SHEET = `
.obs-bd {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  color: var(--dsw-alias-label-primary, #0f1115);
  ${SEGMENT_TOKENS}
}
.obs-bd-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 0 2px 8px; }
.obs-bd-title { flex: 1 1 auto; min-width: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.obs-bd-switch { position: relative; flex: none; display: flex; padding: 2px; border-radius: 9px; background: var(--dsw-alias-fill-l2, rgba(127, 127, 127, 0.12)); }
.obs-bd-ind { position: absolute; left: 2px; top: 2px; bottom: 2px; z-index: 0; width: calc((100% - 4px) / 2); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #fff); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16); transform: translateX(calc(var(--obs-bd-ind, 0) * 100%)); transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.obs-bd-tab { position: relative; z-index: 1; flex: none; width: 62px; border: 0; padding: 3px 0; border-radius: 7px; background: transparent; font: inherit; font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer; transition: color 200ms ease; }
.obs-bd-tab[data-active='true'] { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; }
.obs-bd-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 1px; }
.obs-bd-list { flex: 1 1 auto; min-height: 0; max-height: 320px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 2px; padding-right: 2px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, 0.3)) transparent; }
.obs-bd-list::-webkit-scrollbar { width: 6px; }
.obs-bd-list::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, 0.3)); }
.obs-bd-list::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l2, rgba(127, 127, 127, 0.5)); }
.obs-bd-row { flex: none; display: flex; flex-direction: column; gap: 3px; padding: 7px 8px 8px; border-radius: 9px; border: 1px solid transparent; animation: obs-bd-row-in 320ms cubic-bezier(0.22, 0.61, 0.36, 1) both; transition: background-color 160ms ease, border-color 160ms ease; }
.obs-bd-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.08)); border-color: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06)); }
.obs-bd-line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.obs-bd-dot { flex: none; width: 8px; height: 8px; border-radius: 2px; }
.obs-bd-name { flex: 1 1 auto; min-width: 0; font-size: 12px; line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary, #0f1115); }
.obs-bd-value { flex: none; font-size: 12px; line-height: 17px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, #0f1115); }
.obs-bd-value[data-muted='true'] { color: var(--dsw-alias-label-tertiary, #81858c); font-weight: 400; }
.obs-bd-track { position: relative; height: 3px; border-radius: 2px; background: var(--dsw-alias-fill-l2, rgba(127, 127, 127, 0.14)); overflow: hidden; }
.obs-bd-bar { height: 100%; border-radius: 2px; transform-origin: left center; animation: obs-bd-bar-grow 460ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.obs-bd-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 6px; font-size: 10.5px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #81858c); font-variant-numeric: tabular-nums; }
.obs-bd-sub-item { white-space: nowrap; }
.obs-bd-sub-item[data-tone='error'] { color: var(--dsw-alias-state-error-primary, #d93f4c); }
.obs-bd-sub-sep { color: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.4)); }
.obs-bd-note { flex: none; padding: 6px 8px 0; font-size: 10.5px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #81858c); }
.obs-bd-empty { display: flex; align-items: center; justify-content: center; min-height: 120px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
@keyframes obs-bd-row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes obs-bd-bar-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (prefers-reduced-motion: reduce) {
  .obs-bd-row, .obs-bd-bar, .obs-bd-ind, .obs-bd-tab { animation: none !important; transition: none !important; }
}
`

/** 幂等注入拆分列表样式：同一个 id 只建一次，插件卸载时由 loader 连带清掉。 */
export function ensureObserveBreakdownStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.dataset.pluginCss = 'triad/observe-breakdown'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 按当前口径取行的主值——排序、归一化条、主值显示都用它，避免三处各算一遍。 */
function valueOf(row: ObserveRow, metric: ObserveMetric): number {
  switch (metric) {
    case 'requests': return row.requests
    case 'speed': return row.tokensPerSec ?? 0
    default: return row.tokens
  }
}

/** 加权平均：缺值行不进分子也不进分母，权重为 0 时返回 null（不把未知渲染成 0）。 */
function weightedAvg(rows: Array<{ value: number | null; weight: number }>): number | null {
  let sum = 0
  let weight = 0
  for (const item of rows) {
    if (item.value === null || !isFinite(item.value) || item.weight <= 0) continue
    sum += item.value * item.weight
    weight += item.weight
  }
  return weight > 0 ? sum / weight : null
}

function rowFromModel(model: ObserveBreakdownModel): ObserveRow {
  return {
    key: model.model,
    name: model.model,
    value: 0,
    tokens: model.tokens ?? 0,
    requests: model.requests ?? 0,
    failed: model.failed ?? 0,
    cacheHitRate: model.cacheHitRate ?? null,
    tokensPerSec: model.tokensPerSec ?? null,
    ttftMs: model.ttftMs ?? null,
  }
}

/** 供应商归并：可加量加总，比率按 tokens 加权。 */
function groupByProvider(models: ObserveBreakdownModel[]): ObserveRow[] {
  const groups = new Map<string, ObserveBreakdownModel[]>()
  for (const model of models) {
    const key = observeProviderOf(model.model)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [model])
    else bucket.push(model)
  }
  const out: ObserveRow[] = []
  for (const [key, list] of groups) {
    out.push({
      key,
      name: key,
      value: 0,
      tokens: list.reduce((sum, item) => sum + (item.tokens ?? 0), 0),
      requests: list.reduce((sum, item) => sum + (item.requests ?? 0), 0),
      failed: list.reduce((sum, item) => sum + (item.failed ?? 0), 0),

      cacheHitRate: weightedAvg(list.map(item => ({ value: item.cacheHitRate ?? null, weight: item.tokens ?? 0 }))),
      tokensPerSec: weightedAvg(list.map(item => ({ value: item.tokensPerSec ?? null, weight: item.tokens ?? 0 }))),
      ttftMs: weightedAvg(list.map(item => ({ value: item.ttftMs ?? null, weight: item.tokens ?? 0 }))),
    })
  }
  return out
}

export function ObserveBreakdown(props: ObserveBreakdownProps): JSX.Element {
  ensureObserveBreakdownStyles()
  const { models, metric } = props
  const [dimension, setDimension] = useState<ObserveDimension>('model')

  const rows = useMemo(() => {
    const source = Array.isArray(models) ? models.filter(item => item !== null && item !== undefined) : []
    const merged = dimension === 'provider'
      ? groupByProvider(source)
      : source.map(rowFromModel)

    // 主值在这里算一次：排序、条宽、显示都复用它，避免三处各算一遍口径。
    for (const row of merged) row.value = valueOf(row, metric)
    merged.sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    return merged
  }, [models, dimension, metric])

  const ranked = useMemo(() => rankObserveModels(rows.map(row => ({ model: row.key, weight: row.value }))), [rows])
  const max = rows.reduce((peak, row) => (row.value > peak ? row.value : peak), 0)

  return (
    <div className="obs-bd">
      <div className="obs-bd-head">
        <span className="obs-bd-title">拆分维度</span>
        <div className="obs-bd-switch" style={{ '--obs-bd-ind': dimension === 'provider' ? 1 : 0 } as CSSProperties}>
          <span className="obs-bd-ind" aria-hidden="true" />
          <button
            type="button"
            className="obs-bd-tab"
            data-active={dimension === 'model' ? 'true' : 'false'}
            aria-pressed={dimension === 'model'}
            onClick={() => { setDimension('model') }}
          >
            模型
          </button>
          <button
            type="button"
            className="obs-bd-tab"
            data-active={dimension === 'provider' ? 'true' : 'false'}
            aria-pressed={dimension === 'provider'}
            onClick={() => { setDimension('provider') }}
          >
            供应商
          </button>
        </div>
      </div>

      <div className="obs-bd-list">
        {rows.length === 0 && <div className="obs-bd-empty">所选范围暂无拆分数据</div>}
        {rows.map((row, index) => {
          const rank = ranked.get(row.key)
          const color = observeSegColor(rank === undefined ? -1 : rank)
          const width = max > 0 ? (row.value / max) * 100 : 0
          return (
            <div
              key={`${dimension}:${row.key}`}
              className="obs-bd-row"
              style={{ animationDelay: `${Math.min(index * 24, 320)}ms` }}
            >
              <div className="obs-bd-line1">
                <span className="obs-bd-dot" style={{ background: color }} />
                <span className="obs-bd-name" title={row.name}>{row.name}</span>
                <span className="obs-bd-value">
                  {observeMetricText(row.value, metric)}
                </span>
              </div>
              <div className="obs-bd-track">
                <div className="obs-bd-bar" style={{ width: `${width}%`, background: color, animationDelay: `${Math.min(index * 24, 320) + 60}ms` }} />
              </div>
              <div className="obs-bd-sub">
                <span className="obs-bd-sub-item">{formatExact(row.requests)} 个请求</span>
                <span className="obs-bd-sub-sep">·</span>
                <span className="obs-bd-sub-item">命中率 {formatHitRate(row.cacheHitRate)}</span>
                <span className="obs-bd-sub-sep">·</span>
                <span className="obs-bd-sub-item">{row.tokensPerSec === null ? '出速 —' : `${Math.round(row.tokensPerSec)} token/秒`}</span>
                {row.ttftMs !== null && (
                  <>
                    <span className="obs-bd-sub-sep">·</span>
                    <span className="obs-bd-sub-item">首字 {(row.ttftMs / 1000).toFixed(1)} 秒</span>
                  </>
                )}
                {row.failed > 0 && (
                  <>
                    <span className="obs-bd-sub-sep">·</span>
                    <span className="obs-bd-sub-item" data-tone="error">{formatExact(row.failed)} 次失败</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {metric === 'tokens' && rows.length > 0 && (
        <div className="obs-bd-note">合计 {formatUnits(rows.reduce((sum, row) => sum + row.tokens, 0))} token</div>
      )}
    </div>
  )
}
