/**
 * cost.ts — 观测大盘的模型维度聚合（纯函数，零 IO、零依赖）。
 *
 * ── 文件名为什么还叫 cost.ts ────────────────────────────────────────
 * 它原本只负责费用估算，费用口径按用户要求下线后，这里留下的是「按模型把几天
 * 折叠成一行」这件大盘真正需要的事。改名会让五个调用点全动、且对 diff 毫无信息
 * 增益，所以文件名沿用，模块职责在注释里说清。
 *
 * ── 聚合口径（三条都不能各算一份）────────────────────────────────────
 *  - 命中率不是「各天命中率的平均」——那会让用量小的天和用量大的天等权。这里用
 *    累加后的 cacheRead / (input + cacheRead + cacheWrite) 重算，与 host 侧
 *    cacheHitRate() 同源，否则列表里的命中率会和 KPI 卡对不上。
 *  - 出速按**输出 token 加权**（总 genTokens / 总 genMs），同样不做日均。
 *  - 首字延迟取总延迟 / 总步数，缺任一侧就返回 null，不拿 0 冒充。
 */

import type { ObserveDayStat } from './observe-types'

/**
 * 拆分列表的一行。字段与 ObserveBreakdown 的 props 行逐字对齐——签名归那位
 * 维护者，这里只保证结构一致，不重复声明组件那边的类型。
 */
export interface ObserveBreakdownRow {
  model: string
  tokens: number
  requests: number
  failed: number
  cacheHitRate: number | null
  tokensPerSec: number | null
  /** 首字延迟**平均值**（毫秒），不是累计值；无计时数据时为 null。 */
  ttftMs: number | null
}

/**
 * 把按日的模型明细折叠成按模型聚合的行（跨天累加，token 降序）。
 *
 * @param days - 参与聚合的观测天（调用方负责先按范围与筛选裁好）。
 */
export function aggregateModels(days: ObserveDayStat[]): ObserveBreakdownRow[] {
  interface Bucket {
    input: number, output: number, cacheRead: number, cacheWrite: number, tokens: number
    requests: number, failed: number
    ttftMs: number, ttftSteps: number, genMs: number, genTokens: number
  }
  const acc = new Map<string, Bucket>()
  for (const d of days) {
    for (const m of d.models ?? []) {
      let b = acc.get(m.model)
      if (b === undefined) {
        b = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, requests: 0, failed: 0, ttftMs: 0, ttftSteps: 0, genMs: 0, genTokens: 0 }
        acc.set(m.model, b)
      }
      b.input += m.inputTokens ?? 0
      b.output += m.outputTokens ?? 0
      b.cacheRead += m.cacheReadTokens ?? 0
      b.cacheWrite += m.cacheWriteTokens ?? 0
      b.tokens += m.tokens ?? 0
      b.requests += m.requests ?? 0
      b.failed += m.failed ?? 0
      b.ttftMs += m.ttftMs ?? 0
      b.ttftSteps += m.ttftSteps ?? 0
      b.genMs += m.genMs ?? 0
      b.genTokens += m.genTokens ?? 0
    }
  }

  const rows: ObserveBreakdownRow[] = []
  for (const [model, b] of acc) {
    const prompt = b.input + b.cacheRead + b.cacheWrite
    rows.push({
      model,
      tokens: b.tokens,
      requests: b.requests,
      failed: b.failed,
      cacheHitRate: prompt > 0 ? Math.round((b.cacheRead / prompt) * 1000) / 10 : null,
      tokensPerSec: b.genMs > 0 ? b.genTokens / (b.genMs / 1000) : null,
      ttftMs: b.ttftSteps > 0 ? b.ttftMs / b.ttftSteps : null,
    })
  }
  rows.sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
  return rows
}

/** KPI 行需要的全局合计（按日累加，缺字段按 0 计）。 */
export interface ObserveTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cache: number
  tokens: number
  requests: number
  failed: number
  retriedSuccess: number
  /** 缓存命中率（百分数，一位小数）；无 prompt token 时为 null。 */
  cacheHitRate: number | null
  /** 输出速度（token/秒，按总输出 token / 总生成时长）；无计时时为 null。 */
  tokensPerSec: number | null
  genTokens: number
  genMs: number
  /** 首字计时步数（UI 里的「N 次计时」）。 */
  ttftSteps: number
  /** 首字延迟平均值（毫秒）；无计时时为 null。 */
  ttftAvgMs: number | null
}

/**
 * 全局合计。
 *
 * 成功率的分母刻意取 requests + failed：host 的 requests 是「成功的消息数」、
 * failed 是「失败/取消的尝试数」，两者不相交，相加才是总尝试次数。拿 requests
 * 当分母会让成功率恒等于 100%，那是把失败藏起来。
 */
export function observeTotals(days: ObserveDayStat[]): ObserveTotals {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, tokens = 0
  let requests = 0, failed = 0, retriedSuccess = 0
  let genMs = 0, genTokens = 0, ttftMs = 0, ttftSteps = 0
  for (const d of days) {
    input += d.inputTokens ?? 0
    output += d.outputTokens ?? 0
    cacheRead += d.cacheReadTokens ?? 0
    cacheWrite += d.cacheWriteTokens ?? 0
    tokens += d.tokens ?? 0
    requests += d.requests ?? 0
    failed += d.failed ?? 0
    retriedSuccess += d.retriedSuccess ?? 0
    genMs += d.genMs ?? 0
    genTokens += d.genTokens ?? 0
    ttftMs += d.ttftMs ?? 0
    ttftSteps += d.ttftSteps ?? 0
  }
  const prompt = input + cacheRead + cacheWrite
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cache: cacheRead + cacheWrite,
    tokens,
    requests,
    failed,
    retriedSuccess,
    cacheHitRate: prompt > 0 ? Math.round((cacheRead / prompt) * 1000) / 10 : null,
    tokensPerSec: genMs > 0 ? genTokens / (genMs / 1000) : null,
    genTokens,
    genMs,
    ttftSteps,
    ttftAvgMs: ttftSteps > 0 ? ttftMs / ttftSteps : null,
  }
}
