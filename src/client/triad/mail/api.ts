/**
 * dsh-mail — 邮箱 HTTP API 封装（client 半身）。
 *
 * 全部走 host 半身的 `/api/dsh-mail/*`（loopback-only 同源 fetch），
 * 不引任何 DSH 内部服务、不改 DSH 源码。
 *
 * 两条约定：
 *  - 业务错误也走 HTTP 200 + `{ ok: false, error }`，所以这里统一按 payload
 *    判成败，不看状态码；
 *  - 写操作返回 `outcome`：`{status:'pending', token, summary}` 表示「只拿到
 *    确认令牌、还没执行」，`{status:'done'}` 才是真的做了。UI 必须把这两态
 *    区分开呈现——把 pending 画成成功就是欺骗用户。
 */

/** 邮箱地址。 */
export interface MailAlias {
  alias_id: string
  email: string
  name: string
  is_primary: boolean
}

/** 账号视图。 */
export interface MailAccountView {
  auth: {
    logged_in: boolean
    status: string
    token_status?: string
    granted_at?: string
    expires_at?: string
    storage?: string
    workspace?: string
  }
  me: {
    aliases: MailAlias[]
    scopes: string[]
    constraints: { max_attachment_count: number; max_attachment_size_bytes: string; max_total_attachments_size_bytes: string }
    rate_limits: { daily_send_quota: number; requests_per_hour: number; requests_per_minute: number }
  } | null
  primary: MailAlias | null
  error: string | null
}

/** 配置视图。 */
export interface MailConfigView {
  enabled: boolean
  injectEnabled: boolean
  watchEnabled: boolean
  downloadDir?: string
  timeoutMs: number
  cliPath: string | null
  cliVersion: string | null
  dataDir: string
  tools: string[]
  watching: boolean
}

/** 邮件摘要。 */
export interface MailSummaryView {
  message_id: string
  subject: string
  snippet: string
  from: { email: string; name?: string }
  to: Array<{ email: string; name?: string }>
  created_at: string
  is_read: boolean
  has_attachments: boolean
  dir?: { dir_id?: number; dir_name?: string }
}

/** 附件。 */
export interface MailAttachmentView {
  attachment_id?: string
  download_url?: string
  filename?: string
  size?: number
  content_type?: string
}

/** 邮件全文。 */
export interface MailDetailView extends MailSummaryView {
  body: string
  body_format: string
  attachments: MailAttachmentView[]
  cc?: Array<{ email: string; name?: string }>
  bcc?: Array<{ email: string; name?: string }>
  rfc_message_id?: string
  attachment_count?: number
}

/** 一页列表。 */
export interface MailPageView {
  messages: MailSummaryView[]
  hasMore: boolean
  nextCursor: string
  at: number
  cached: boolean
}

/** 写操作结果。 */
export type MailWriteOutcome =
  | { status: 'pending'; token: string; summary: string; preview: Record<string, unknown> }
  | { status: 'done'; detail: Record<string, unknown> }

/** 待确认操作。 */
export interface MailPendingView {
  token: string
  action: 'send' | 'reply' | 'forward' | 'trash' | 'delete'
  summary: string
  createdAt: number
  preview: Record<string, unknown>
}

/** 新邮件事件。 */
export interface MailEventView {
  message_id?: string
  dir?: string
  occurred_at?: string
  at: number
}

/** 统一回包形状。 */
type Envelope<T> = { ok: true } & T | { ok: false; error: string; needsAuth?: boolean; code?: number | null }

/** 邮箱 API 面。 */
export interface MailApi {
  account(): Promise<MailAccountView>
  config(): Promise<MailConfigView>
  updateConfig(patch: Partial<Pick<MailConfigView, 'enabled' | 'injectEnabled' | 'watchEnabled' | 'downloadDir' | 'timeoutMs'>> & { reset?: boolean }): Promise<MailConfigView>
  list(query: { dir: string; limit?: number; cursor?: string; hasAttachments?: boolean; isUnread?: boolean; cache?: boolean }): Promise<MailPageView>
  search(query: Record<string, string | number | boolean | undefined>): Promise<MailPageView>
  read(id: string): Promise<MailDetailView>
  send(payload: Record<string, unknown>): Promise<MailWriteOutcome>
  reply(payload: Record<string, unknown>): Promise<MailWriteOutcome>
  forward(payload: Record<string, unknown>): Promise<MailWriteOutcome>
  trash(id: string, confirmationToken?: string): Promise<MailWriteOutcome>
  remove(payload: { id?: string; all?: boolean; confirmationToken?: string }): Promise<MailWriteOutcome>
  downloadAttachment(payload: { msg: string; att?: string; downloadUrl?: string; outputDir?: string }): Promise<{ savedTo?: string; downloadUrl?: string; filename?: string; size?: number }>
  pending(): Promise<MailPendingView[]>
  cancelPending(token: string): Promise<boolean>
  events(): Promise<{ events: MailEventView[]; watching: boolean }>
  clearEvents(): Promise<void>
  setWatch(enabled: boolean): Promise<boolean>
}

/** 网络/业务错误（needsAuth 时 UI 显示「去授权」引导）。 */
export class MailApiError extends Error {
  readonly needsAuth: boolean
  constructor(message: string, needsAuth: boolean) {
    super(message)
    this.name = 'MailApiError'
    this.needsAuth = needsAuth
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: { accept: 'application/json', ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    })
  } catch (error) {
    throw new MailApiError(`无法连接本地服务：${error instanceof Error ? error.message : String(error)}`, false)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MailApiError(`服务返回了非 JSON 响应（HTTP ${response.status}）`, false)
  }
  const envelope = payload as Envelope<T>
  if (envelope.ok !== true) {
    throw new MailApiError(envelope.error ?? `HTTP ${response.status}`, envelope.needsAuth === true)
  }
  return envelope as unknown as T
}

/** 把查询对象拼成 query string（跳过 undefined/空串）。 */
function qs(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

/** 创建 API（无状态，可安全单例）。 */
export function createMailApi(): MailApi {
  return {
    async account() {
      const data = await request<{ ok: true } & MailAccountView>('/api/dsh-mail/account')
      return { auth: data.auth, me: data.me, primary: data.primary, error: data.error }
    },
    async config() {
      const data = await request<{ config: MailConfigView }>('/api/dsh-mail/config')
      return data.config
    },
    async updateConfig(patch) {
      const data = await request<{ config: MailConfigView }>('/api/dsh-mail/config', {
        method: 'POST',
        body: JSON.stringify(patch),
      })
      return data.config
    },
    async list(query) {
      const data = await request<{ ok: true } & MailPageView>(`/api/dsh-mail/list${qs({
        dir: query.dir,
        limit: query.limit,
        cursor: query.cursor,
        hasAttachments: query.hasAttachments === true ? 1 : undefined,
        isUnread: query.isUnread === true ? 1 : undefined,
        cache: query.cache === true ? 1 : undefined,
      })}`)
      return { messages: data.messages, hasMore: data.hasMore, nextCursor: data.nextCursor, at: data.at, cached: data.cached }
    },
    async search(query) {
      const data = await request<{ ok: true } & MailPageView>(`/api/dsh-mail/search${qs(query)}`)
      return { messages: data.messages, hasMore: data.hasMore, nextCursor: data.nextCursor, at: data.at, cached: data.cached }
    },
    async read(id) {
      const data = await request<{ message: MailDetailView }>(`/api/dsh-mail/read${qs({ id })}`)
      return data.message
    },
    async send(payload) {
      const data = await request<{ outcome: MailWriteOutcome }>('/api/dsh-mail/send', { method: 'POST', body: JSON.stringify(payload) })
      return data.outcome
    },
    async reply(payload) {
      const data = await request<{ outcome: MailWriteOutcome }>('/api/dsh-mail/reply', { method: 'POST', body: JSON.stringify(payload) })
      return data.outcome
    },
    async forward(payload) {
      const data = await request<{ outcome: MailWriteOutcome }>('/api/dsh-mail/forward', { method: 'POST', body: JSON.stringify(payload) })
      return data.outcome
    },
    async trash(id, confirmationToken) {
      const data = await request<{ outcome: MailWriteOutcome }>('/api/dsh-mail/trash', {
        method: 'POST',
        body: JSON.stringify({ id, confirmationToken }),
      })
      return data.outcome
    },
    async remove(payload) {
      const data = await request<{ outcome: MailWriteOutcome }>('/api/dsh-mail/delete', { method: 'POST', body: JSON.stringify(payload) })
      return data.outcome
    },
    async downloadAttachment(payload) {
      return await request<{ savedTo?: string; downloadUrl?: string; filename?: string; size?: number }>(
        '/api/dsh-mail/attachment',
        { method: 'POST', body: JSON.stringify(payload) },
      )
    },
    async pending() {
      const data = await request<{ pending: MailPendingView[] }>('/api/dsh-mail/pending')
      return data.pending
    },
    async cancelPending(token) {
      const data = await request<{ removed: boolean }>('/api/dsh-mail/pending/cancel', { method: 'POST', body: JSON.stringify({ token }) })
      return data.removed
    },
    async events() {
      const data = await request<{ events: MailEventView[]; watching: boolean }>('/api/dsh-mail/events')
      return { events: data.events, watching: data.watching }
    },
    async clearEvents() {
      await request<{ ok: true }>('/api/dsh-mail/events/clear', { method: 'POST', body: '{}' })
    },
    async setWatch(enabled) {
      const data = await request<{ watching: boolean }>('/api/dsh-mail/watch', { method: 'POST', body: JSON.stringify({ enabled }) })
      return data.watching
    },
  }
}
