/**
 * observe-types.ts — 「观测 / 用量」大盘的共享数据契约（Lead 定稿，前后端共同遵守）。
 *
 * 这一层只放**类型与常量**，不放任何实现：host 半身产出的 wire 形状、前端大盘的
 * props 形状都在这里对齐，各组件按它 import，避免各写一份后接口错配。
 *
 * ── 与既有 aggregate.ts 的关系 ──────────────────────────────────────
 * UsageDay 是历史类型，字段少且**保持向后兼容**：观测大盘在它之上读取本文件
 * 新增的可选字段（host 未升级时全部缺省，UI 必须优雅降级，不得崩）。
 *
 * ── 为什么没有「费用」口径 ──────────────────────────────────────────
 * 曾经有一整套单价表（host 下发 prices/currency、前端 estimateCost、图表 cost
 * 口径、KPI 费用卡）。2026-10-17 用户明确要求「费用去掉不需要」，于是整条链路
 * 一并摘除：留着 host 侧算好却不展示，等于让一段没人读的代码继续左右响应体大小
 * 与维护成本。要恢复时：host 侧 pricing.js 的 git 历史里是完整实现。
 */

/** 模型级聚合（UsageDay.models[] 的观测扩展）。 */
export interface ObserveModelStat {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokens: number
  cacheHitRate: number | null
  /** 该模型当日的调用次数（assistant/message 计数）。 */
  requests?: number
  /** 该模型当日的失败尝试数（assistant/attempt 计数）。 */
  failed?: number
  /** 首字延迟累计（毫秒）与计入步数，两者都存在时可算平均。 */
  ttftMs?: number
  ttftSteps?: number
  /** 生成时长累计（毫秒）与对应的输出 token，两者都存在时可算 token/秒。 */
  genMs?: number
  genTokens?: number
  /** 重试后最终成功的次数。 */
  retriedSuccess?: number
}

/** 一天（UsageDay 的观测扩展字段）。 */
export interface ObserveDayStat {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokens: number
  cacheHitRate: number | null
  requests?: number
  /** 失败尝试数：assistant/attempt 事件计数（失败 / 重试 / 取消 / 流错误的结算）。 */
  failed?: number
  /** 触发过的模型重试次数（llm/retry-started 计数）。 */
  retries?: number
  /** 重试后最终成功的次数。 */
  retriedSuccess?: number
  ttftMs?: number
  ttftSteps?: number
  genMs?: number
  genTokens?: number
  /** 被压缩/剪枝替换出表面的 token 估算（非计费口径）。 */
  compacted?: number
  models?: ObserveModelStat[]
}

/** 一天里某个小时的用量（今日 24 小时趋势用）。 */
export interface ObserveHourStat extends ObserveDayStat {
  /** 本地小时（0–23）。 */
  hour: number
}

/** /api/usage-stats/usage 响应体（观测扩展后的形状）。 */
export interface ObservePayload {
  ok: boolean
  days: ObserveDayStat[]
  /**
   * 今天的 24 个小时桶（00–23 全量补齐，缺数据的小时补 0）。
   * 旧 host 没有这条字段时前端退回按天出柱，不得因此崩掉。
   */
  hours?: ObserveHourStat[]
  updatedAt?: number
  stale?: boolean
}

/** 时间粒度：观测大盘的图表与拆分列表共用。 */
export type ObserveMetric = 'tokens' | 'requests' | 'speed'

/** 口径中文名（Tab 与图例同源，不得各写一套）。 */
export const OBSERVE_METRIC_LABELS: Record<ObserveMetric, string> = {
  tokens: 'Token',
  requests: '请求',
  speed: '速度',
}

/** 请求状态筛选（对应参考图第二行的分段控件）。 */
export type ObserveStatus = 'all' | 'failed' | 'retried'

export const OBSERVE_STATUS_LABELS: Record<ObserveStatus, string> = {
  all: '全部',
  failed: '失败',
  retried: '重试后成功',
}

/** 自动刷新档位（毫秒）。0 = 关闭。 */
export const OBSERVE_REFRESH_STEPS: readonly number[] = [0, 5000, 15000, 60000]

/** 模型路由 → 供应商（取第一个斜杠前的前缀段；与 aggregate.ts 的 providerOfModel 同义，勿另立口径）。 */
export function observeProviderOf(model: string): string {
  const at = model.indexOf('/')
  return at <= 0 ? model : model.slice(0, at)
}
