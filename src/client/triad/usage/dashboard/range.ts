/**
 * 用量查询范围：预设（今日/昨日/近7天/近30天/本月/上月/今年/全部/自定义区间）
 * + 区间过滤。
 *
 * 日期一律 YYYY-MM-DD 字符串（与 UsageDay.date 同构），字典序即时间序。
 *
 * 历史版本的粒度自适应聚合（按日/周/月、按小时、环比）只服务趋势图，趋势页
 * 已随「用量工作台」一起精简掉，这里不再保留——只留查询真正要用的四个件：
 * 预设解析、区间过滤、日期互转。
 */

import type { UsageDay } from './aggregate'

/** 范围预设。 */
export type RangePreset =
  | 'today' | 'yesterday' | '7d' | '30d'
  | 'month' | 'lastMonth' | 'year' | 'all' | 'custom'

/** 闭区间日期范围。 */
export interface DateRange {
  start: string
  end: string
}

/** 本地日期 → YYYY-MM-DD。 */
export function toDayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 加减天数。 */
function addDays(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

/** 解析预设为具体区间与展示名。 */
export function resolveRange(preset: RangePreset, custom: DateRange | null, now = new Date()): { range: DateRange; label: string } {
  const today = toDayStr(now)
  switch (preset) {
    case 'today':
      return { range: { start: today, end: today }, label: '今日' }
    case 'yesterday': {
      const y = toDayStr(addDays(now, -1))
      return { range: { start: y, end: y }, label: '昨日' }
    }
    case '7d':
      return { range: { start: toDayStr(addDays(now, -6)), end: today }, label: '近 7 天' }
    case '30d':
      return { range: { start: toDayStr(addDays(now, -29)), end: today }, label: '近 30 天' }
    case 'month': {
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      return { range: { start, end: today }, label: '本月' }
    }
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { range: { start: toDayStr(first), end: toDayStr(last) }, label: '上月' }
    }
    case 'year':
      return { range: { start: `${now.getFullYear()}-01-01`, end: today }, label: '今年' }
    case 'all':
      return { range: { start: '2000-01-01', end: today }, label: '全部' }
    case 'custom':
      return { range: custom ?? { start: today, end: today }, label: custom !== null ? `${custom.start} ~ ${custom.end}` : '自定义' }
  }
}

/** 按区间过滤（字符串字典序比较，含端点）。 */
export function filterDays(days: UsageDay[], r: DateRange): UsageDay[] {
  return days.filter(d => d.date >= r.start && d.date <= r.end)
}
