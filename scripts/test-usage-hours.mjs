/**
 * dsh-chat-plus — 用量小时桶测试（2026-10-29）。
 *
 * 口径：
 *  · 今日 24 小时桶必须覆盖 00–23，缺数据的小时补 0；
 *  · 同一 turn:step 的重报只替换、不叠加；
 *  · 昨天的小时不混进「今天」的 24 小时序列；
 *  · 请求数按小时计数，兼容「有失败但没 token」的样本。
 */
import { applyUsageDelta, createUsageState, mergeHoursInto, mergeInto, renderUsage } from '../src/vendor/usage-skill/usage.js'

const fails = []
function need(condition, label) {
  if (condition) console.log('ok    ' + label)
  else { fails.push(label); console.log('FAIL  ' + label) }
}

const base = new Date()
base.setHours(12, 0, 0, 0)
const atHour = (hour, dayOffset = 0) => {
  const date = new Date(base)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}
const message = (time, turn, step, tokens) => ({
  type: 'assistant/message',
  time,
  data: {
    turn,
    step,
    usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    message: { source: { provider: 'p', model: 'p/m' } },
  },
})

const state = createUsageState()
applyUsageDelta(state, [
  message(atHour(9), 1, 1, 100),
  // 同一 turn:step 连续重报：只替换，不叠加（真实日志里 attempt/message 就是相邻的）
  message(atHour(10), 2, 1, 200),
  message(atHour(10), 2, 1, 50),
  message(atHour(10), 2, 1, 220),
  message(atHour(11), 3, 1, 300),
])
// 昨天的用量不应混进今天 24 小时
applyUsageDelta(state, [message(atHour(23, -1), 4, 1, 999)])

const byDay = new Map()
mergeInto(byDay, state.days)
const byHour = new Map()
mergeHoursInto(byHour, state.hours)
const rendered = renderUsage(byDay, byHour, base.getTime())

need(rendered.hours.length === 24, '今日 24 小时序列固定 24 项（00–23）')
need(rendered.hours[9].tokens === 100 && rendered.hours[10].tokens === 220 && rendered.hours[11].tokens === 300,
  '每小时 token 分别落桶，重报只替换不叠加（9/10/11 = 100/220/300）')
need(rendered.hours[9].requests === 1 && rendered.hours[10].requests === 1,
  '每小时请求数与样本同步计数')
need(rendered.hours[23].tokens === 0, '昨天的 23 点用量不会混进今天的 23 点')
const todayTokens = rendered.hours.reduce((sum, hour) => sum + hour.tokens, 0)
need(todayTokens === 620, '24 小时合计与今日总量一致（620）')
need(rendered.hours.every(hour => hour.date === rendered.hours[0].date), '小时桶的 date 全部是今天')

// 有失败但没 token 的 attempt：小时请求口径不能漏
const failedState = createUsageState()
applyUsageDelta(failedState, [{
  type: 'assistant/attempt',
  time: atHour(14),
  data: { turn: 1, step: 1, message: { source: { provider: 'p', model: 'p/m' } } },
}])
const failedByHour = new Map()
mergeHoursInto(failedByHour, failedState.hours)
const failedRendered = renderUsage(new Map(), failedByHour, base.getTime())
need(failedRendered.hours[14].failed === 1, '没有 token 的失败调用也按小时计入 failed')

console.log('')
if (fails.length > 0) {
  console.log('USAGE HOURS TEST FAILED — ' + String(fails.length) + ' 个断言未通过')
  process.exit(1)
}
console.log('USAGE HOURS TEST PASSED — 24 小时桶 + 重报替换 + 日期隔离')
