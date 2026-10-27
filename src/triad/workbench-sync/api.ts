/**
 * 工作台资产双向同步 HTTP 路由（Host 侧）。
 *
 * 路由列表：
 *   · GET  /api/triad/workbench-sync/status     公开状态
 *   · POST /api/triad/workbench-sync/save       保存配置（口令/令牌加密落盘）
 *   · POST /api/triad/workbench-sync/upload-now 立即备份上传
 *   · POST /api/triad/workbench-sync/pull-now   一键从云端同步拉取
 *   · GET  /api/triad/workbench-sync/progress   实时进度
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { rejectCrossSite } from '../../shared/csrf.js'
import type { WorkbenchSyncEngine } from './engine.js'
import type { WorkbenchSyncPatch } from './types.js'

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function mountWorkbenchSyncRoutes(ctx: Context, engine: WorkbenchSyncEngine): () => void {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (rejectCrossSite(req, res)) return

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()

    try {
      if (path === '/api/triad/workbench-sync/status' && method === 'GET') {
        const status = await engine.publicView()
        json(res, 200, { ok: true, status })
        return
      }

      if (path === '/api/triad/workbench-sync/progress' && method === 'GET') {
        const status = await engine.publicView()
        json(res, 200, { ok: true, progress: status.progress, running: status.running })
        return
      }

      if (path === '/api/triad/workbench-sync/save' && method === 'POST') {
        const body = await readBody<WorkbenchSyncPatch>(req)
        if (!body) {
          json(res, 400, { ok: false, error: '请求体格式错误' })
          return
        }
        const updated = await engine.save(body)
        json(res, 200, { ok: true, status: updated })
        return
      }

      if (path === '/api/triad/workbench-sync/upload-now' && method === 'POST') {
        const run = await engine.uploadNow('manual')
        const status = await engine.publicView()
        json(res, 200, { ok: true, run, status })
        return
      }

      if (path === '/api/triad/workbench-sync/pull-now' && method === 'POST') {
        const run = await engine.pullNow()
        const status = await engine.publicView()
        json(res, 200, { ok: true, run, status })
        return
      }

      json(res, 404, { ok: false, error: 'Not Found' })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      json(res, 400, { ok: false, error: msg })
    }
  }

  // 注册前缀路由
  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/triad/workbench-sync',
    handler,
  })

  return () => {
    // 卸载
  }
}
