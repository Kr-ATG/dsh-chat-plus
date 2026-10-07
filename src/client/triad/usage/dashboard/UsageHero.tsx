/**
 * UsageHero.tsx — 用量页「英雄数字 + 指标卡 + 模型排行 + 构成环」（效果图第 4 页）。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────
 * 效果图的用量页首屏是四格英雄区（合计大数 + sparkline / 输入 / 输出 /
 * 缓存命中仪表）+ 底部两格（模型排行 / token 构成环）。这些数据 UsagePanel
 * 手里全有（scoped / sum / hitRate），但旧 Body 是「查询行 + 四格小汇总 +
 * 热力图」的紧凑卡形态，塞进去会让 Body 再涨三百行。抽成纯展示组件：
 * props 进、SVG 出，零状态零请求，compact 小卡片形态完全不碰它。
 *
 * ── 取舍 ─────────────────────────────────────────────────────────────
 * 1. 环比 = 把当前范围等长前移一段再 sumTokens，真算不造假；前一段全 0 时
 *    不显示环比 chip（除零无意义）。
 * 2. sparkline / 仪表 / 构成环全是内联 SVG + stroke-dashoffset 描边动画，
 *    零图表库（插件零运行时依赖硬约束）；动画在 theme.ts 统一收
 *    prefers-reduced-motion。
 * 3. 构成三口径：cacheRead / cacheWrite / fresh(=input+output)，与 host
 *    聚合口径一致，不自己发明第四类。
 * 4. 模型排行取 scoped 内 models 聚合 top4，条宽按最大值归一；并列不排序
 *    稳定化（数据量小，直接 sort 降序即可）。
 */

import type { CSSProperties } from 'react'
import type { UsageDay } from './aggregate.js'
import { filterDays, type DateRange } from './range.js'
import { formatUnits, formatHitRate } from './format.js'

export interface UsageHeroProps {
  /** 全量天（算环比用）。 */
  days: UsageDay[]
  /** 当前范围 ∩ 筛选后的天。 */
  scoped: UsageDay[]
  range: DateRange
  sum: { input: number; output: number; cache: number; total: number }
  hitRate: number
  activeDays: number
  modelCount: number
}

/** 等长前移一段的环比区间。 */
function prevRangeOf(range: DateRange): DateRange {
  const span = range.end.getTime() - range.start.getTime() + 86400000
  return { start: new Date(range.start.getTime() - span), end: new Date(range.start.getTime() - 86400000) }
}

/** 折线点：按日期升序，x 等分、y 按最大 tokens 归一（留 8% 顶部余量）。 */
function sparkPoints(scoped: UsageDay[], width: number, height: number): string {
  const sorted = [...scoped].sort((a, b) => (a.date < b.date ? -1 : 1))
  if (sorted.length === 0) return ''
  const max = Math.max(...sorted.map(d => d.tokens ?? 0), 1)
  const step = sorted.length > 1 ? width / (sorted.length - 1) : width
  return sorted.map((d, i) => {
    const x = i * step
    const y = height - 4 - ((d.tokens ?? 0) / max) * (height - 10)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export function UsageHero({ days, scoped, range, sum, hitRate, activeDays, modelCount }: UsageHeroProps): JSX.Element {
  // 环比：前一段等长窗口的合计
  const prevSum = (() => {
    const prev = filterDays(days, prevRangeOf(range))
    let total = 0
    for (const d of prev) total += d.tokens ?? 0
    return total
  })()
  const delta = prevSum > 0 ? ((sum.total - prevSum) / prevSum) * 100 : null

  // 模型排行 top4
  const modelTotals = new Map<string, number>()
  for (const d of scoped) for (const m of d.models ?? []) modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + m.tokens)
  const rank = [...modelTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const rankMax = rank.length > 0 ? rank[0][1] : 1

  // 构成环：cacheRead / cacheWrite / fresh
  let cacheRead = 0
  let cacheWrite = 0
  for (const d of scoped) { cacheRead += d.cacheReadTokens ?? 0; cacheWrite += d.cacheWriteTokens ?? 0 }
  const fresh = sum.input + sum.output
  const pieTotal = Math.max(cacheRead + cacheWrite + fresh, 1)
  const C = 264
  const seg = (n: number): number => (n / pieTotal) * C

  const gaugeOffset = 163 - (163 * Math.min(Math.max(hitRate, 0), 100)) / 100

  return (
    <>
      <div className="wb2-us-hero">
        <div className="wb2-bezel wb2-rise" style={{ '--d': '80ms' } as CSSProperties}>
          <div className="wb2-core wb2-us-main">
            <span className="wb2-lbl">区间合计消耗</span>
            <div className="wb2-us-big">{formatUnits(sum.total)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              {delta !== null && (
                <span className="wb2-chip" data-on={delta >= 0 ? undefined : '1'} style={delta < 0 ? { color: 'var(--dsw-alias-state-success-primary)' } : undefined}>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {delta >= 0 ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
                  </svg>
                  {`${Math.abs(delta).toFixed(1)}% 环比`}
                </span>
              )}
              <span style={{ fontSize: '10.5px', color: 'var(--wb2-t4)' }}>
                {`${String(scoped.length)} 天 · 有量 ${String(activeDays)} 天 · ${String(modelCount)} 个模型`}
              </span>
            </div>
            <div className="wb2-us-spark">
              <svg viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden="true">
                <polygon className="wb2-us-spark-fill" points={`0,40 ${sparkPoints(scoped, 320, 40)} 320,40`} />
                <polyline className="wb2-us-spark-line" points={sparkPoints(scoped, 320, 40)} />
              </svg>
            </div>
          </div>
        </div>

        <div className="wb2-card wb2-us-metric wb2-rise" style={{ '--d': '120ms' } as CSSProperties}>
          <span className="wb2-lbl">输入 Token</span>
          <div className="wb2-us-metric-v">{formatUnits(sum.input)}</div>
          <div className="wb2-us-metric-s">{`占比 ${sum.total > 0 ? Math.round((sum.input / sum.total) * 100) : 0}%`}</div>
          <div className="wb2-us-bar"><i style={{ width: `${sum.total > 0 ? (sum.input / sum.total) * 100 : 0}%` }} /></div>
        </div>

        <div className="wb2-card wb2-us-metric wb2-rise" style={{ '--d': '160ms' } as CSSProperties}>
          <span className="wb2-lbl">输出 Token</span>
          <div className="wb2-us-metric-v">{formatUnits(sum.output)}</div>
          <div className="wb2-us-metric-s">{`占比 ${sum.total > 0 ? Math.round((sum.output / sum.total) * 100) : 0}%`}</div>
          <div className="wb2-us-bar"><i style={{ width: `${sum.total > 0 ? (sum.output / sum.total) * 100 : 0}%` }} /></div>
        </div>

        <div className="wb2-card wb2-us-metric wb2-rise" style={{ '--d': '200ms' } as CSSProperties}>
          <span className="wb2-lbl">缓存命中率</span>
          <div className="wb2-us-gauge-wrap">
            <div className="wb2-us-gauge">
              <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
                <circle cx="29" cy="29" r="26" fill="none" stroke="var(--wb2-line)" strokeWidth="5" />
                <circle className="wb2-us-gauge-arc" cx="29" cy="29" r="26" fill="none" strokeWidth="5"
                  strokeLinecap="round" style={{ '--go': `${gaugeOffset.toFixed(1)}` } as CSSProperties} />
              </svg>
              <b><i>{formatHitRate(hitRate).replace('%', '')}</i><u>%</u></b>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '11.5px', color: 'var(--wb2-t2)', lineHeight: 1.6 }}>cacheRead 占上下文</div>
              <div className="wb2-num" style={{ fontSize: '10.5px', color: 'var(--wb2-t4)' }}>命中即省一次重算</div>
            </div>
          </div>
        </div>
      </div>

      <div className="wb2-us-bottom">
        <div className="wb2-card wb2-rise" style={{ '--d': '260ms' } as CSSProperties}>
          <div className="wb2-sech"><span className="wb2-lbl">模型消耗排行</span><i /><span className="wb2-chip">区间内</span></div>
          {rank.length === 0 && <div style={{ fontSize: '11.5px', color: 'var(--wb2-t4)', padding: '8px 0' }}>该范围内没有模型调用记录</div>}
          {rank.map(([model, tokens], index) => (
            <div className="wb2-us-rank-i" key={model}>
              <span className="wb2-us-rank-n wb2-num">{String(index + 1).padStart(2, '0')}</span>
              <div className="wb2-us-rank-c">
                <div className="wb2-us-rank-t">
                  <span className="wb2-us-rank-name">{model}</span>
                  <span className="wb2-us-rank-v">{formatUnits(tokens)}</span>
                </div>
                <div className="wb2-us-rank-bar">
                  <i style={{ width: `${(tokens / rankMax) * 100}%`, '--d': `${String(index * 80)}ms` } as CSSProperties} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="wb2-card wb2-rise" style={{ '--d': '300ms' } as CSSProperties}>
          <div className="wb2-sech"><span className="wb2-lbl">Token 构成</span><i /></div>
          <div className="wb2-us-pie-wrap">
            <svg className="wb2-us-pie" viewBox="0 0 96 96" aria-hidden="true">
              <circle cx="48" cy="48" r="42" stroke="var(--wb2-line)" />
              <circle cx="48" cy="48" r="42" stroke="var(--wb2-accent)" strokeDasharray={`${seg(cacheRead).toFixed(1)} ${String(C)}`} />
              <circle cx="48" cy="48" r="42" stroke="var(--wb2-accent-hi)" strokeDasharray={`${seg(cacheWrite).toFixed(1)} ${String(C)}`} strokeDashoffset={-seg(cacheRead)} />
              <circle cx="48" cy="48" r="42" stroke="var(--wb2-a4)" strokeDasharray={`${seg(fresh).toFixed(1)} ${String(C)}`} strokeDashoffset={-seg(cacheRead + cacheWrite)} />
            </svg>
            <div className="wb2-us-pie-lg">
              <div className="wb2-us-pie-i"><i style={{ background: 'var(--wb2-accent)' }} />cacheRead<span className="wb2-num">{`${Math.round((cacheRead / pieTotal) * 100)}%`}</span><b>{formatUnits(cacheRead)}</b></div>
              <div className="wb2-us-pie-i"><i style={{ background: 'var(--wb2-accent-hi)' }} />cacheWrite<span className="wb2-num">{`${Math.round((cacheWrite / pieTotal) * 100)}%`}</span><b>{formatUnits(cacheWrite)}</b></div>
              <div className="wb2-us-pie-i"><i style={{ background: 'var(--wb2-a4)' }} />fresh<span className="wb2-num">{`${Math.round((fresh / pieTotal) * 100)}%`}</span><b>{formatUnits(fresh)}</b></div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
