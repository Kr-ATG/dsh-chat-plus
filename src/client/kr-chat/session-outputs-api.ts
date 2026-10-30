/**
 * dsh-chat-plus — 子会话产出物读取（client 半身）。
 *
 * 主会话的客户端快照只有自己的 tool-call 节点；子智能体是独立会话，它的
 * tool/call 事件不在这个快照里。这里按子会话 id 读取 host 的产出物清单：
 *  1. 优先走新的只读路由 /api/chat-flow/session-outputs（按会话精确读取）；
 *  2. 旧宿主没有新路由时，回落到已有的 /api/triad/gallery/media 聚合索引，
 *     再按 sessionId 过滤 —— 画廊索引本来就覆盖全部会话（含子代理），这条回落
 *     让子代理产出物不必等重启 host 才可见。
 *
 * 响应形状不对一律当空清单，绝不让一张坏响应把主卡打掉。
 */

import { isOutputKind } from './outputs.ts'
import type { OutputItem } from './outputs.ts'

/** 与 host 半身共用的精确路由常量。 */
export const SESSION_OUTPUTS_ROUTE = '/api/chat-flow/session-outputs'
/** 已有画廊聚合路由：旧宿主没有精确路由时的回落来源。 */
const GALLERY_MEDIA_ROUTE = '/api/triad/gallery/media'

interface JsonPayload {
  readonly ok?: unknown
  readonly items?: unknown
}

async function readJson(url: string, signal?: AbortSignal): Promise<JsonPayload | null> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return null
    const body = await response.json() as JsonPayload
    return body !== null && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/** 把一份接口条目校验成 OutputItem[]（只保留真实文件，跳过 generated spill 容器）。 */
function itemsOf(rawItems: unknown, sessionId: string): readonly OutputItem[] {
  if (!Array.isArray(rawItems)) return []
  const items: OutputItem[] = []
  const seen = new Set<string>()
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    if (record.source === 'generated') continue
    const path = typeof record.path === 'string' ? record.path.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const kind = record.kind
    if (path === '' || name === '' || !isOutputKind(kind)) continue
    const key = path.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const time = typeof record.time === 'number' && Number.isFinite(record.time) ? record.time : undefined
    items.push({ path, name, kind, ...(time === undefined ? {} : { time }), sessionId })
  }
  return items
}

/**
 * 读取某个会话（通常是子智能体会话）的产出清单。
 *
 * @param sessionId - 目标会话 id。
 * @param signal - 可选取消信号（切换会话 / 卸载时中止）。
 * @returns 校验后的条目；网络失败或形状异常返回空数组。
 */
export async function fetchSessionOutputs(
  sessionId: string,
  signal?: AbortSignal,
): Promise<readonly OutputItem[]> {
  if (typeof sessionId !== 'string' || sessionId === '') return []

  const direct = await readJson(SESSION_OUTPUTS_ROUTE + '?session=' + encodeURIComponent(sessionId), signal)
  if (direct !== null && direct.ok === true) {
    const items = itemsOf(direct.items, sessionId)
    if (items.length > 0) return items
  }

  /*
   * 回落：旧宿主没挂精确路由时，画廊 /media 已经按全部会话（含子代理）建好了
   * 索引；它一次返回的是全库条目，这里只留下目标 sessionId 的行。命中缓存时
   * 代价很低，且不会改变画廊自己的口径。
   */
  const gallery = await readJson(GALLERY_MEDIA_ROUTE, signal)
  if (gallery === null || gallery.ok !== true || !Array.isArray(gallery.items)) return []
  return itemsOf(gallery.items.filter((raw) => {
    return typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).sessionId === sessionId
  }), sessionId)
}
