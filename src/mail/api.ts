/**
 * dsh-mail — HTTP API（loopback-only）：/api/dsh-mail/*。
 *
 * 面板（client 半身）与浏览器自动化都走这些路由；与 dsh-memory 同款
 * loopback 校验（socket 是 127.0.0.1 且 Host 头是 localhost/127.0.0.1/::1）。
 *
 * 路由表：
 *   GET  /api/dsh-mail/account            账号 + 授权 + 额度
 *   GET  /api/dsh-mail/config             运行时配置 + CLI 探测
 *   POST /api/dsh-mail/config             改配置（enabled / injectEnabled / downloadDir / timeoutMs）
 *   GET  /api/dsh-mail/list?dir=&limit=&cursor=&hasAttachments=&isUnread=&cache=1
 *   GET  /api/dsh-mail/search?q=&from=&to=&dir=&after=&before=&limit=&cursor=
 *   GET  /api/dsh-mail/read?id=msg_xxx    全文（HTML 正文原样给，前端自己净化渲染）
 *   POST /api/dsh-mail/send               两阶段确认
 *   POST /api/dsh-mail/reply
 *   POST /api/dsh-mail/forward
 *   POST /api/dsh-mail/trash
 *   POST /api/dsh-mail/delete
 *   POST /api/dsh-mail/attachment         下载附件（body: {msg, att, downloadUrl?, outputDir?}）
 *   GET  /api/dsh-mail/pending            待确认操作列表
 *   POST /api/dsh-mail/pending/confirm    body: { token } —— 执行（host 原样重放参数）
 *   POST /api/dsh-mail/pending/cancel     body: { token }
 *   GET  /api/dsh-mail/events             新邮件事件（watch 缓冲）
 *   POST /api/dsh-mail/events/clear
 *   POST /api/dsh-mail/watch              起停新邮件监听（body: { enabled })
 *   GET  /api/dsh-mail/diagnose           CLI 路径/版本/数据目录（排查用）
 *
 * 写操作的路由与工具**共用** MailService 的两阶段确认语义：不带
 * confirmationToken 的 POST 只拿令牌，带 token 才真正执行。面板上的「确认」
 * 按钮等于用户明确许可，因此那条路径允许直接带 token 执行。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { probeCliVersion, resolveCliPath } from './cli.js'
import { MAIL_TOOL_NAMES } from './tools.js'
import type { MailHostContext } from './context.js'
import type { MailService } from './service.js'
import type { MailConfig, MailDir } from './types.js'
import type { MailStore } from './store.js'
import type { MailWatcher } from './watch.js'

/** 路由前缀（与其它工作台并列，互不冲突）。 */
export const MAIL_ROUTE_PREFIX = '/api/dsh-mail'

/** 注册全部邮箱路由。 */
export function mountMailRoutes(
  ctx: MailHostContext,
  service: MailService,
  store: MailStore,
  watcher: MailWatcher,
): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: MAIL_ROUTE_PREFIX,
    handler: (req, res) => { void handle(ctx, service, store, watcher, req, res) },
  })
}

/** loopback 校验（与 dsh-memory / mcp-status 同款）。 */
function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return null
  return firstColon === -1 ? host : host.slice(0, firstColon)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = hostNameOf(req.headers.host)
  if (host === null) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) { rejectPromise(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolvePromise({}); return }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        resolvePromise(typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {})
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error('invalid JSON body'))
      }
    })
    req.on('error', rejectPromise)
  })
}

/** 取字符串参数（缺省返回 undefined，不用空串混淆「没给」与「给了空」）。 */
function str(value: string | null): string | undefined {
  return value === null || value.trim() === '' ? undefined : value.trim()
}

/** 取布尔参数（1/true/yes 为真）。 */
function bool(value: string | null): boolean {
  if (value === null) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** 取数组（兼容单值与数组）。 */
function strArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value.trim()]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
}

/**
 * 从 body 里取确认令牌。
 *
 * **三种命名都要认**：工具侧（模型）用 `confirmation_token`，早期面板用
 * `confirmationToken`，而 `/pending/confirm` 面板只传 `{ token }`。
 * 只认前两种时，confirm 路由会静默取到 undefined 并回 `token required` ——
 * 用户看到的就是「点了确认却说没令牌」。
 */
function tokenOf(body: Record<string, unknown>): string | undefined {
  for (const key of ['token', 'confirmationToken', 'confirmation_token']) {
    const value = body[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

async function handle(
  ctx: MailHostContext,
  service: MailService,
  store: MailStore,
  watcher: MailWatcher,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
  let url: URL
  let rest: string
  const method = req.method ?? 'GET'
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
    rest = url.pathname.slice(MAIL_ROUTE_PREFIX.length)
  } catch {
    json(res, 400, { ok: false, error: 'invalid request url' })
    return
  }
  try {
    /* ── 账号 / 配置 / 诊断 ────────────────────────────────────────── */
    if (method === 'GET' && rest === '/account') {
      json(res, 200, { ok: true, ...await service.account() })
      return
    }
    if (method === 'GET' && rest === '/config') {
      const cli = resolveCliPath()
      json(res, 200, {
        ok: true,
        config: {
          ...service.getConfig(),
          cliPath: cli?.path ?? null,
          cliVersion: await probeCliVersion(),
          dataDir: store.root,
          tools: MAIL_TOOL_NAMES,
          watching: watcher.isRunning(),
          // 附件保存位置：生效目录（含用户覆盖）与工厂默认目录都给前端，
          // 设置页要能显示「当前」并支持「恢复默认」。
          downloadDir: service.defaultDownloadDir(),
          defaultDownloadDir: service.builtinDownloadDir(),
          downloadDirOverridden: service.getConfig().downloadDir !== undefined && service.getConfig().downloadDir !== '',
        },
      })
      return
    }
    if (method === 'POST' && rest === '/config') {
      const body = await readBody(req)
      const patch: Partial<MailConfig> = {}
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
      if (typeof body.injectEnabled === 'boolean') patch.injectEnabled = body.injectEnabled
      if (typeof body.watchEnabled === 'boolean') patch.watchEnabled = body.watchEnabled
      if (typeof body.timeoutMs === 'number') patch.timeoutMs = body.timeoutMs
      if (body.reset === true) {
        await store.writeConfig({})
        json(res, 200, { ok: true, config: service.getConfig() })
        return
      }
      // 附件保存位置：先校验（真的试写一下）再落盘，避免把不可写目录存进去，
      // 让用户在「下载」那一刻才撞上英文的 CLI 报错。空串 = 恢复默认目录。
      if (typeof body.downloadDir === 'string') {
        const raw = body.downloadDir.trim()
        if (raw === '') {
          patch.downloadDir = ''
        } else {
          const verdict = await service.verifyDirectory(raw)
          if (!verdict.ok) {
            json(res, 200, { ok: false, error: verdict.error ?? '目录不可用', path: verdict.path })
            return
          }
          patch.downloadDir = verdict.path
        }
      }
      const config = await service.updateConfig(patch)
      json(res, 200, {
        ok: true,
        config: {
          ...config,
          downloadDir: service.defaultDownloadDir(),
          defaultDownloadDir: service.builtinDownloadDir(),
          downloadDirOverridden: config.downloadDir !== undefined && config.downloadDir !== '',
        },
      })
      return
    }
    if (method === 'GET' && rest === '/diagnose') {
      const cli = resolveCliPath()
      json(res, 200, {
        ok: true,
        cliPath: cli?.path ?? null,
        cliShell: cli?.needsShell ?? null,
        cliVersion: await probeCliVersion(),
        dataDir: store.root,
        account: await service.account(),
        pending: (await service.pending()).length,
        events: (await store.listEvents()).length,
      })
      return
    }

    /* ── 读 ────────────────────────────────────────────────────────── */
    if (method === 'GET' && rest === '/list') {
      const page = await service.list({
        dir: (str(url.searchParams.get('dir')) as MailDir | undefined) ?? 'inbox',
        limit: url.searchParams.get('limit') === null ? undefined : Number(url.searchParams.get('limit')),
        cursor: str(url.searchParams.get('cursor')),
        after: str(url.searchParams.get('after')),
        before: str(url.searchParams.get('before')),
        hasAttachments: bool(url.searchParams.get('hasAttachments')),
        isUnread: bool(url.searchParams.get('isUnread')),
      }, { preferCache: bool(url.searchParams.get('cache')) })
      json(res, 200, { ok: true, ...page })
      return
    }
    if (method === 'GET' && rest === '/search') {
      const page = await service.search({
        q: str(url.searchParams.get('q')),
        searchIn: str(url.searchParams.get('searchIn')) as 'SEARCH_IN_ALL' | 'SEARCH_IN_SUBJECT' | 'SEARCH_IN_CONTENT' | undefined,
        from: str(url.searchParams.get('from')),
        to: str(url.searchParams.get('to')),
        dir: str(url.searchParams.get('dir')) as MailDir | undefined,
        after: str(url.searchParams.get('after')),
        before: str(url.searchParams.get('before')),
        hasAttachments: bool(url.searchParams.get('hasAttachments')),
        isUnread: bool(url.searchParams.get('isUnread')),
        limit: url.searchParams.get('limit') === null ? undefined : Number(url.searchParams.get('limit')),
        cursor: str(url.searchParams.get('cursor')),
      })
      json(res, 200, { ok: true, ...page })
      return
    }
    if (method === 'GET' && rest === '/read') {
      const id = str(url.searchParams.get('id'))
      if (id === undefined) { json(res, 400, { ok: false, error: 'id required' }); return }
      json(res, 200, { ok: true, message: await service.read(id) })
      return
    }

    /* ── 写（两阶段确认） ─────────────────────────────────────────── */
    if (method === 'POST' && rest === '/send') {
      const body = await readBody(req)
      const outcome = await service.send({
        recipients: { to: strArray(body.to), cc: strArray(body.cc), bcc: strArray(body.bcc) },
        subject: typeof body.subject === 'string' ? body.subject : '',
        body: typeof body.body === 'string' ? body.body : '',
        format: (body.format === 'html' || body.format === 'markdown' ? body.format : 'plain'),
        attachments: strArray(body.attachments),
        confirmationToken: tokenOf(body),
      })
      json(res, 200, { ok: true, outcome })
      return
    }
    if (method === 'POST' && rest === '/reply') {
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (id === '') { json(res, 400, { ok: false, error: 'id required' }); return }
      const outcome = await service.reply({
        id,
        body: typeof body.body === 'string' ? body.body : '',
        format: (body.format === 'html' ? 'html' : 'plain'),
        replyAll: body.replyAll === true,
        cc: strArray(body.cc),
        attachments: strArray(body.attachments),
        confirmationToken: tokenOf(body),
      })
      json(res, 200, { ok: true, outcome })
      return
    }
    if (method === 'POST' && rest === '/forward') {
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (id === '') { json(res, 400, { ok: false, error: 'id required' }); return }
      const outcome = await service.forward({
        id,
        recipients: { to: strArray(body.to), cc: strArray(body.cc) },
        body: typeof body.body === 'string' ? body.body : '',
        includeAttachments: body.includeAttachments === true,
        attachments: strArray(body.attachments),
        confirmationToken: tokenOf(body),
      })
      json(res, 200, { ok: true, outcome })
      return
    }
    if (method === 'POST' && rest === '/trash') {
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (id === '') { json(res, 400, { ok: false, error: 'id required' }); return }
      // 面板按钮走 `now` 变体：用户亲手点的那一下就是许可，一次请求走完两阶段。
      // 模型工具仍走两阶段（先拿令牌、停下等用户回话），不受这里影响。
      json(res, 200, { ok: true, outcome: await service.trashNow(id) })
      return
    }
    if (method === 'POST' && rest === '/delete') {
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id.trim() : undefined
      json(res, 200, {
        ok: true,
        outcome: await service.deleteNow({ id, all: body.all === true }),
      })
      return
    }
    if (method === 'POST' && rest === '/attachment') {
      const body = await readBody(req)
      const msg = typeof body.msg === 'string' ? body.msg.trim() : ''
      if (msg === '') { json(res, 400, { ok: false, error: 'msg required' }); return }
      // 面板「另选位置」传的是用户刚挑的目录：同样先校验再下，避免挑到一个
      // 只读目录后在 CLI 子进程里抛一句英文错误。
      const rawDir = typeof body.outputDir === 'string' ? body.outputDir.trim() : ''
      if (rawDir !== '') {
        const verdict = await service.verifyDirectory(rawDir)
        if (!verdict.ok) {
          json(res, 200, { ok: false, error: verdict.error ?? '目录不可用', path: verdict.path })
          return
        }
      }
      const result = await service.downloadAttachment({
        msg,
        att: typeof body.att === 'string' ? body.att.trim() : undefined,
        downloadUrl: typeof body.downloadUrl === 'string' ? body.downloadUrl : undefined,
        outputDir: rawDir === '' ? undefined : rawDir,
      })
      json(res, 200, { ok: true, ...result })
      return
    }
    // 目录可用性预检（设置页与「另选位置」都在保存/下载前调一次）。
    // 回包形状就是 verdict 本身（`{ok, path, error?}`）—— 这里的 ok 是**目录
    // 结论**不是 HTTP 层，前端据此显示红字，所以不要再套一层外层 ok。
    if (method === 'POST' && rest === '/verify-dir') {
      const body = await readBody(req)
      const raw = typeof body.path === 'string' ? body.path.trim() : ''
      json(res, 200, await service.verifyDirectory(raw))
      return
    }

    /* ── 待确认 / 事件 / 监听 ─────────────────────────────────────── */
    if (method === 'GET' && rest === '/pending') {
      json(res, 200, { ok: true, pending: await service.pending() })
      return
    }
    if (method === 'POST' && rest === '/pending/cancel') {
      const body = await readBody(req)
      const token = tokenOf(body)
      if (token === undefined) { json(res, 400, { ok: false, error: 'token required' }); return }
      json(res, 200, { ok: true, removed: await service.cancelPending(token) })
      return
    }
    // 执行待确认操作：**只传令牌**，参数由 host 从第一阶段落盘的 replay 原样重放。
    // 面板/模型都不该自己拼业务参数（拼过一次就出过 `id required`：CLI 的 summary
    // 里字段叫 message_id，而且根本没有正文与附件路径）。
    if (method === 'POST' && rest === '/pending/confirm') {
      const body = await readBody(req)
      const token = tokenOf(body)
      if (token === undefined) { json(res, 400, { ok: false, error: 'token required' }); return }
      json(res, 200, { ok: true, outcome: await service.confirmPending(token) })
      return
    }
    if (method === 'GET' && rest === '/events') {
      json(res, 200, { ok: true, events: await store.listEvents(), watching: watcher.isRunning() })
      return
    }
    if (method === 'POST' && rest === '/events/clear') {
      await store.clearEvents()
      json(res, 200, { ok: true })
      return
    }
    if (method === 'POST' && rest === '/watch') {
      const body = await readBody(req)
      const enabled = body.enabled !== false
      if (enabled) watcher.start()
      else watcher.stop()
      json(res, 200, { ok: true, watching: watcher.isRunning() })
      return
    }

    json(res, 404, { ok: false, error: `no route for ${method} ${rest}` })
  } catch (error) {
    // 业务错误（含 CLI 退出码语义）回 200 + ok:false：前端统一按 payload 处理，
    // 不靠 HTTP 状态码猜语义；只有路由不存在才 404。
    json(res, 200, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: (error as { code?: number }).code ?? null,
      needsAuth: (error as { needsAuth?: boolean }).needsAuth === true,
    })
  }
}
