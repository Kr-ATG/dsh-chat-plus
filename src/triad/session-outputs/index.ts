/**
 * dsh-chat-plus — 单会话产出物查询（host 半身，只读路由）。
 *
 * 为什么需要它：子智能体在 DSH 里是**独立会话**，主会话的客户端快照里只有
 * 「派生了哪个子智能体」，没有子会话内部的 tool/call 事件。于是主会话的产出物
 * 卡天然看不到子代理做出来的文件 —— 用户只能点开子会话再看一遍。
 *
 * 本路由按会话 id 读取与画廊同一份折叠结果（gallery/store 的 sessionItemsFor：
 * 优先读 live 事件、冷会话读持久化日志，增量折叠 + 缓存），把子会话的产出清单
 * 交给客户端。客户端按子智能体目录里的 id 批量取，再并入主会话产出物卡。
 *
 * 口径与产出物卡一致：只返回本地文件路径（不含 spill 临时文件），时间取产出
 * 事件时间；路径已在折叠层按该会话 cwd 解析为绝对路径。文件是否真的在磁盘上
 * 由客户端卡片原有的 probe 层核对（与主会话条目同一道闸门）。
 */

import { classifyOutput } from '../../client/kr-chat/outputs.ts'
import { sessionItemsFor } from '../gallery/store.ts'

/** 路由：GET /api/chat-flow/session-outputs?session=<会话 id>。 */
export const SESSION_OUTPUTS_ROUTE = '/api/chat-flow/session-outputs'

interface SessionOutputsDeps {
  readonly sessions?: unknown
  readonly persistence?: unknown
  readonly logger?: { warn?: (message: string) => void }
}

/** 只回传白名单字段，绝不把 store 的内部对象透出去。 */
interface SessionOutputsItem {
  readonly path: string
  readonly name: string
  readonly kind: string
  readonly time: number
}

function json(res: any, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function handleSessionOutputs(req: any, res: any, deps: SessionOutputsDeps): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const sessionId = url.searchParams.get('session') ?? ''
    // 会话 id 是内部标识：拒绝空串与任何带路径分隔符/控制字符的输入。
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) {
      json(res, 400, { ok: false, error: 'bad-session' })
      return
    }
    const raw = await sessionItemsFor(deps as never, sessionId)
    const items: SessionOutputsItem[] = []
    for (const item of raw) {
      // generated 是 spill 里的生图结果容器（.txt），不是磁盘成品；产出物卡
      // 主链路同样把 spill 路径排除。这里只交付真实文件。
      if (item.source !== 'file') continue
      // 画廊折叠层按多媒体口径收窄过；这里再用产出物卡自己的类别表过一遍，
      // 保证 gif 等边界扩展名的类别与主卡一致（gallery 里 gif 是 image，
      // 产出物卡里是 video）。code/other 不进成品清单。
      const kind = classifyOutput(item.path)
      if (kind === 'code' || kind === 'other') continue
      items.push({ path: item.path, name: item.name, kind, time: item.time })
    }
    json(res, 200, { ok: true, items })
  } catch (error) {
    // 读失败就是读失败，不把内部错误细节漏给浏览器；调用方拿空清单即可。
    deps.logger?.warn?.(
      '[dsh-chat-plus] session-outputs read failed: ' + (error instanceof Error ? error.message : String(error)),
    )
    json(res, 500, { ok: false, error: 'read-failed' })
  }
}

/**
 * 注册单会话产出物路由。
 *
 * 调用方（applyTriadHost）已经处于 webServer / sessions / sessionPersistence
 * 注入完成的上下文里；这里只做形状防御，缺服务时安静跳过。
 */
export function applySessionOutputs(ctx: Record<string, any>): void {
  const webServer = ctx.webServer
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return
  const get = (name: string): unknown => {
    try { return ctx.get?.(name) } catch { return undefined }
  }
  const deps: SessionOutputsDeps = {
    sessions: get('sessions'),
    persistence: get('sessionPersistence'),
    logger: ctx.logger,
  }
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: SESSION_OUTPUTS_ROUTE,
    handler: (req: any, res: any) => { void handleSessionOutputs(req, res, deps) },
  }), 'dsh-chat-plus: session outputs route')
}

/** 供 smoke 直接对拍：路由常量与响应形状构造器。 */
export const __test = { SESSION_OUTPUTS_ROUTE }
