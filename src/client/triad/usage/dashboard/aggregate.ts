/**
 * 用量数据模型 + 基础聚合。
 *
 * 精简前的聚合工具（模型排行 / 供应商占比 / 按供应商过滤 / 调用时长汇总）只服务
 * 已下线的趋势页与明细表，这里只留热力图与 token 汇总真正用到的四件，
 * 外加供应商/模型维度的筛选（查询区两个下拉要用的口径）。
 */

/** 某一天的用量聚合。 */
export interface UsageDay {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokens: number
  cacheHitRate: number
  /** 当天模型调用次数（assistant/message 计数）。 */
  requests?: number
  models?: Array<{ model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; tokens: number; cacheHitRate: number }>
}

/** /api/usage-stats/usage 响应体。 */
export interface UsagePayload {
  ok: boolean
  days: UsageDay[]
  updatedAt?: number
  /**
   * true = 这是 host 持久化折叠态的快照，后台重算仍在进行。客户端应当继续
   * 显示这份数据并稍后重取，而不是把它当成最终结果。
   */
  stale?: boolean
}

/** 区间合计：输入 / 输出 / 缓存（读+写）/ 总量。 */
export function sumTokens(days: UsageDay[]): { input: number; output: number; cache: number; total: number } {
  let input = 0, output = 0, cache = 0
  for (const d of days) {
    input += d.inputTokens ?? 0
    output += d.outputTokens ?? 0
    cache += (d.cacheReadTokens ?? 0) + (d.cacheWriteTokens ?? 0)
  }
  return { input, output, cache, total: input + output + cache }
}

/** 范围内平均缓存命中率（百分数，保留小数由 formatHitRate 统一格式化）。 */
export function averageCacheHitRate(days: UsageDay[]): number {
  if (days.length === 0) return 0
  const sum = days.reduce((acc, d) => acc + (d.cacheHitRate ?? 0), 0)
  return sum / days.length
}

/* ── 供应商 / 模型维度 ───────────────────────────────────────────────────── */

/**
 * 模型 id 形如 `provider/model`，且 provider 段内还可能带斜杠
 * （`openrouter/stealth/ox-alpha`），所以供应商只取**第一段**。
 */
export function providerOfModel(model: string): string {
  const at = model.indexOf('/')
  return at <= 0 ? model : model.slice(0, at)
}

/** 去掉供应商前缀后的模型名，仅用于展示（筛选仍按完整 id 比对）。 */
export function modelNameOf(model: string): string {
  const at = model.indexOf('/')
  return at < 0 ? model : model.slice(at + 1)
}

/** 某个下拉项：id 参与筛选，label 展示，tokens 供排序与占比提示。 */
export interface ScopeOption { id: string; label: string; tokens: number }

/** 按 tokens 降序汇总选项；`within` 限定在某供应商内的模型（null = 全部）。 */
function collectOptions(days: UsageDay[], within: string | null, key: (model: string) => string): ScopeOption[] {
  const totals = new Map<string, number>()
  for (const d of days) {
    for (const m of d.models ?? []) {
      if (within !== null && providerOfModel(m.model) !== within) continue
      const id = key(m.model)
      totals.set(id, (totals.get(id) ?? 0) + (m.tokens ?? 0))
    }
  }
  return [...totals]
    .map(([id, tokens]) => ({ id, label: within === null && key === modelNameOf ? modelNameOf(id) : id, tokens }))
    .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id))
}

/** 范围内出现过的供应商，按 token 降序。 */
export function collectProviders(days: UsageDay[]): ScopeOption[] {
  return collectOptions(days, null, providerOfModel)
}

/** 范围内的模型（`within` 给了供应商则只看该供应商），按 token 降序。 */
export function collectModels(days: UsageDay[], within: string | null): ScopeOption[] {
  return collectOptions(days, within, modelNameOf)
}

/**
 * 按供应商/模型重算每日聚合。
 *
 * 命中口径与 host 侧 `cacheHitRate()` 完全一致（cacheRead / prompt 侧，一位小数），
 * 否则筛出来的命中率和全量对不上——用户会以为是 bug。
 *
 * `requests` 无法按模型拆分（host 的 models 项不带调用次数），筛选态下一律
 * 归零：给一个假的数字比留空更糟，热力图切到「调用次数」口径会是一片空白，
 * 调用方据此把该口径从可选项里摘掉。
 */
export function filterDaysByScope(days: UsageDay[], provider: string | null, model: string | null): UsageDay[] {
  if (provider === null && model === null) return days
  const out: UsageDay[] = []
  for (const d of days) {
    const models = (d.models ?? []).filter((m) => (model !== null ? m.model === model : provider === null || providerOfModel(m.model) === provider))
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0
    for (const m of models) {
      input += m.inputTokens ?? 0
      output += m.outputTokens ?? 0
      cacheRead += m.cacheReadTokens ?? 0
      cacheWrite += m.cacheWriteTokens ?? 0
    }
    const prompt = input + cacheRead + cacheWrite
    out.push({
      ...d,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      tokens: input + output + cacheRead + cacheWrite,
      cacheHitRate: prompt > 0 ? Math.round((cacheRead / prompt) * 1000) / 10 : 0,
      requests: 0,
      models,
    })
  }
  return out
}
