/**
 * ObserveKpi.tsx — 观测大盘的 KPI 卡行（5 张）。
 *
 * 布局口径对齐参考图：一张卡 = 标签 / 主值 / 副行三层。主值承担「一眼看到量级」，
 * 副行承担「异常与口径」——失败数、未计价调用数这类会被 KPI 主值掩盖的信息必须
 * 留在副行，而不是塞进 tooltip（大盘是扫视界面，藏起来等于没有）。
 *
 * 动效：五张卡按 index 级联入场（CSS 变量传延迟），保留 prefers-reduced-motion
 * 一票否决；缓存命中率进度条走 transition，数值变化时是滑动而不是跳变。
 *
 * 样式注入在本文件内（obs-kpi- 前缀），与主壳的 obs- 前缀区分，避免互相覆盖。
 */

import type { CSSProperties } from 'react'
import { formatExact, formatUnits } from './format'
import type { ObserveTotals } from './cost'

const STYLE_ID = 'dsh-observe-kpi-styles'

/* 注入式 CSS 红线：正文与注释里不得出现会提前闭合模板的字符序列。 */
const SHEET = `
/* 四张卡：auto-fit + minmax(200px, 1fr)。宽屏均分铺满、窄屏自动折行，不靠写死的
   断点数量去猜。min 200px 是「≈1,234 token/秒」这类最长值不被 ellipsis 吃掉的下限。 */
.obs-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.obs-kpi {
  --obs-kpi-i: 0;
  position: relative; min-width: 0; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
  border-radius: 12px; padding: 12px 14px 13px;
  background: var(--dsw-alias-bg-base, #fff);
  overflow: hidden;
  opacity: 0;
  animation: obs-kpi-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: calc(var(--obs-kpi-i) * 55ms);
  transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
}
.obs-kpi:hover {
  border-color: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.16));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 8%, transparent);
}
@keyframes obs-kpi-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.obs-kpi-label { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary, #8f96a3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.obs-kpi-value {
  font-size: 26px; font-weight: 700; line-height: 32px; letter-spacing: -0.4px;
  color: var(--dsw-alias-label-primary, #0f1115); font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.obs-kpi-sub { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); font-variant-numeric: tabular-nums; }
.obs-kpi-sub-num { color: var(--dsw-alias-label-secondary, #61666b); }
/* 失败数用告警色点睛：副行里唯一需要被立刻看见的异常 */
.obs-kpi-bad { color: var(--dsw-alias-state-error-primary, #d94a3d); }
.obs-kpi-bar { position: relative; height: 6px; margin-top: 2px; border-radius: 999px; background: var(--dsw-alias-fill-l2, rgba(0, 0, 0, 0.06)); overflow: hidden; }
.obs-kpi-bar-fill {
  height: 100%; border-radius: 999px; background: var(--dsw-alias-state-business-primary, #4176e6);
  transition: width 640ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 240ms ease;
}
@media (max-width: 767.98px) { .obs-kpi-value { font-size: 22px; line-height: 28px; } }
@media (prefers-reduced-motion: reduce) {
  .obs-kpi { animation: none; opacity: 1; }
  .obs-kpi-bar-fill { transition: none; }
}
`

/** 幂等注入 KPI 样式；返回移除函数。 */
function ensureObserveKpiStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-triad'
    tag.dataset.pluginCss = 'triad/observe-kpi'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}


/** 速度：整数（token/秒量级下小数没意义，反而看着像抖动）。 */
function formatSpeed(n: number | null): string {
  if (n === null || !isFinite(n)) return '—'
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1)
}

/** 秒：首字延迟常是零点几秒，固定一位小数才有分辨率。 */
function formatSeconds(ms: number | null): string {
  if (ms === null || !isFinite(ms)) return '—'
  return (ms / 1000).toFixed(1)
}

export interface ObserveKpiProps {
  totals: ObserveTotals
}

/**
 * 五张 KPI 卡。
 *
 * 成功率分母取「成功 + 失败」：requests 是成功消息数、failed 是失败尝试数，
 * 只拿 requests 当分母的话成功率永远是 100%，等于把失败藏起来。
 */
export function ObserveKpi({ totals }: ObserveKpiProps): JSX.Element {
  ensureObserveKpiStyles()

  const attempts = totals.requests + totals.failed
  const successRate = attempts > 0 ? (totals.requests / attempts) * 100 : null
  const hit = totals.cacheHitRate

  const cards: Array<{ key: string; label: string; value: string; subs: JSX.Element[]; bar?: number | null }> = [
    {
      key: 'tokens',
      label: 'Token',
      value: formatUnits(totals.tokens),
      subs: [
        <span key="io">输入 <span className="obs-kpi-sub-num">{formatUnits(totals.input)}</span> · 输出 <span className="obs-kpi-sub-num">{formatUnits(totals.output)}</span></span>,
        <span key="cache">缓存 <span className="obs-kpi-sub-num">{formatUnits(totals.cache)}</span></span>,
      ],
    },
    {
      key: 'requests',
      label: '请求',
      value: formatExact(totals.requests),
      subs: [
        <span key="rate">
          <span className={totals.failed > 0 ? 'obs-kpi-bad' : undefined}>{formatExact(totals.failed)} 次失败</span>
          {' · '}成功 <span className="obs-kpi-sub-num">{successRate === null ? '—' : `${successRate.toFixed(1)}%`}</span>
        </span>,
        <span key="retry">{formatExact(totals.retriedSuccess)} 次重试后成功</span>,
      ],
    },
    {
      key: 'cache-hit',
      label: '缓存命中率',
      value: hit === null ? '—' : `${hit.toFixed(1)}%`,
      subs: [
        <span key="rw">读 <span className="obs-kpi-sub-num">{formatUnits(totals.cacheRead)}</span> · 写 <span className="obs-kpi-sub-num">{formatUnits(totals.cacheWrite)}</span></span>,
      ],
      bar: hit,
    },
    {
      key: 'speed',
      label: '输出速度',
      value: `${formatSpeed(totals.tokensPerSec)} token/秒`,
      subs: [
        <span key="steps">{formatExact(totals.ttftSteps)} 次计时 · 生成 {formatUnits(totals.genTokens)} token</span>,
        <span key="ttft">首字平均 <span className="obs-kpi-sub-num">{formatSeconds(totals.ttftAvgMs)}</span> 秒</span>,
      ],
    },
  ]

  return (
    <div className="obs-kpi-row" role="group" aria-label="用量关键指标">
      {cards.map((c, i) => (
        <div key={c.key} className="obs-kpi" style={{ '--obs-kpi-i': i } as CSSProperties}>
          <span className="obs-kpi-label">{c.label}</span>
          <span className="obs-kpi-value" title={c.value}>{c.value}</span>
          {c.subs.map((s, si) => <span key={si} className="obs-kpi-sub">{s}</span>)}
          {c.bar !== undefined && c.bar !== null && (
            <span className="obs-kpi-bar" role="progressbar" aria-label="缓存命中率" aria-valuenow={Math.round(c.bar)} aria-valuemin={0} aria-valuemax={100}>
              <span className="obs-kpi-bar-fill" style={{ width: `${Math.max(0, Math.min(100, c.bar))}%` }} />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
