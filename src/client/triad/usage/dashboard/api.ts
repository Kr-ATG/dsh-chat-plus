/**
 * 用量数据请求（loopback-only 同源路由）。
 *
 * 精简后前端只消费 /api/usage-stats/usage 一条：观测大盘（ObservePanel）与
 * compact 小卡（UsagePanel）都基于它。其余路由（signal / providers / account /
 * subscriptions / budget / day-sessions）仍由 host 半身注册并对外可用，但已没有
 * 客户端消费者，故这里不再保留封装。
 *
 * 返回类型是 observe-types 的 ObservePayload，不是 aggregate 的历史 UsagePayload：
 * 这条路由真正的响应形状（含 prices / currency / failed / ttft 等观测字段）由本
 * 文件声明，调用方不必再各自宽化一次。历史字段仍然全部在位，两个消费者都能读。
 */
import type { ObservePayload } from './observe-types'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init, headers: { accept: 'application/json', ...init?.headers } })
  return res.json() as Promise<T>
}

export const usageApi = {
  /**
   * Ask the host for usage.
   *
   * There is deliberately no `?refresh=1` call site any more. That flag makes
   * the host recompute the whole corpus *synchronously* before answering —
   * with 1400+ stored sessions, where a single changed log is decompressed
   * and re-folded in full (DSH stores one zstd frame per event, so there is no
   * random access into a log), one press of refresh cost 7–22 seconds of a
   * frozen panel. The host now always returns its best snapshot and refreshes
   * in the background, so a plain request is all a client ever needs.
   */
  usage: () => fetchJson<ObservePayload>('/api/usage-stats/usage'),
}
