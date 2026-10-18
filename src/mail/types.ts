/**
 * dsh-mail — 数据模型与配置（host 半身）。
 *
 * 邮箱能力由腾讯 Agent Mail（agent.qq.com）提供：QQ 邮箱团队为 Agent 打造的
 * 专属邮箱，与个人邮箱隔离，通过 `agently-cli` 命令行工具收发。
 * 本模块只描述「信封」形状，不依赖任何 @deepseek-ai/* 运行时包
 * （host 产物必须自包含，见 build.mjs 的 assertHostExternals）。
 */

/** 邮箱地址（一个 Agent Mail 账号可挂多个 alias，当前普遍是单地址）。 */
export interface MailAlias {
  alias_id: string
  email: string
  name: string
  is_primary: boolean
}

/** `agently-cli +me` 的 data 段。 */
export interface MailMe {
  aliases: MailAlias[]
  scopes: string[]
  constraints: {
    max_attachment_count: number
    max_attachment_size_bytes: string
    max_total_attachments_size_bytes: string
  }
  rate_limits: {
    daily_send_quota: number
    requests_per_hour: number
    requests_per_minute: number
  }
}

/** `agently-cli auth status` 的 data 段。 */
export interface MailAuthStatus {
  logged_in: boolean
  status: string
  token_status?: string
  granted_at?: string
  expires_at?: string
  storage?: string
  app_id?: string
  workspace?: string
  message?: string
}

/** 收件人/发件人对象。 */
export interface MailAddress {
  email: string
  name?: string
}

/** 附件：普通附件有 attachment_id，超大附件只有 download_url。 */
export interface MailAttachment {
  attachment_id?: string
  download_url?: string
  filename?: string
  size?: number
  content_type?: string
}

/** 邮件摘要（+list / +search 的条目）。 */
export interface MailSummary {
  message_id: string
  subject: string
  snippet: string
  from: MailAddress
  to: MailAddress[]
  created_at: string
  is_read: boolean
  has_attachments: boolean
  dir?: { dir_id?: number; dir_name?: string }
}

/** 邮件全文（+read）。 */
export interface MailDetail extends MailSummary {
  body: string
  body_format: string
  attachments: MailAttachment[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
  rfc_message_id?: string
  attachment_count?: number
  calendar_ics?: string
}

/** 邮件文件夹。 */
export type MailDir = 'inbox' | 'sent' | 'trash' | 'spam'

/** 写操作的种类（两阶段确认的 action 字段）。 */
export type MailWriteAction = 'send' | 'reply' | 'forward' | 'trash' | 'delete'

/** 一条待确认的写操作（拿到 ctk 后停在这里等用户回话）。 */
export interface PendingConfirmation {
  /** CLI 给的确认令牌（ctk_ 前缀，5 分钟有效）。 */
  token: string
  action: MailWriteAction
  /** 人类可读的操作摘要（发给用户看的那段）。 */
  summary: string
  createdAt: number
  /**
   * 展示用的关键字段（面板「待确认」条）。
   *
   * ⚠️ **只用于展示，绝不用于重建执行参数**。CLI 的 summary 里只有
   * `action` / `to` / `subject` / `message_id` / `attachment_count` 这几个
   * 展示字段 —— 正文、附件路径、cc/bcc 全都没有。早期版本让面板从 preview
   * 里读 `id` 来续跑第二阶段，结果是：字段名对不上（CLI 给的是 `message_id`）
   * 拿到 undefined，CLI 直接报 `id required`；就算字段名对上，正文也已经丢了。
   */
  preview: Record<string, unknown>
  /**
   * 第二阶段的**完整调用参数**（原样重放）。
   *
   * 这是两阶段确认能真正走通的关键：拿令牌那次与带令牌那次必须用**同样的
   * 参数**，而 CLI 的 summary 不提供这些参数，所以由我们自己存。
   * 结构按 action 区分（见 service.ts 的 WriteReplay）。
   */
  replay: WriteReplay
}

/**
 * 两阶段确认的第二阶段要原样重放的参数。
 *
 * ⚠️ **形状必须与 service 里各方法自己的入参逐字一致**（`send` 用
 * `recipients: {to,cc,bcc}`，不是平铺的 `to`）。
 *
 * 这里踩过坑：早期把 `to` 写成平铺，而落盘的其实是 `recipients` —— 类型撒谎，
 * `confirmPending` 按类型读 `replay.to` 拿到 undefined，重放时直接
 * `Cannot read properties of undefined (reading 'length')`。
 * 类型与真实数据不一致时，类型检查是负资产。
 */
export type WriteReplay =
  | { action: 'send'; recipients: { to: string[]; cc?: string[]; bcc?: string[] }; subject: string; body: string; bodyFile?: string; format?: string; attachments?: string[] }
  | { action: 'reply'; id: string; body: string; bodyFile?: string; format?: string; replyAll?: boolean; cc?: string[]; bcc?: string[]; attachments?: string[] }
  | { action: 'forward'; id: string; recipients: { to: string[]; cc?: string[]; bcc?: string[] }; body?: string; bodyFile?: string; format?: string; includeAttachments?: boolean; attachments?: string[] }
  | { action: 'trash'; id: string }
  | { action: 'delete'; id?: string; all?: boolean }

/**
 * 运行时配置（可被 cordis.patch.yml / 面板覆盖）。
 *
 * 2026-10-18 删除 `watchEnabled`（连同整条「新邮件实时监听」）：那条能力跑起来
 * 就是一个 `agently-cli message +watch` 常驻长轮询进程，而它产出的全部价值只有
 * 「面板开着时弹一个 toast」。面板一关什么都没发生（没有系统通知、没有侧栏角标、
 * 对话流里也看不见），而未读数本来就由 list 自带。
 *
 * 更要命的是它还会误报：事件缓冲从不清空，面板每次挂载都把历史事件当新邮件弹一遍。
 * 代价（常驻进程 + 一条假提示）明显大过收益，所以整块删掉，而不是修。
 *
 * 老用户 config.json 里残留的 `watchEnabled` 由 applyMailConfigOverrides 的
 * 「只认已知键」策略自然忽略，不需要迁移。
 */
export interface MailConfig {
  /** 总开关：关掉后工具与路由都不注册（插件其余能力不受影响）。 */
  enabled: boolean
  /** 对话首步是否注入「邮箱身份 + 使用约定」。 */
  injectEnabled: boolean
  /** 附件默认下载目录（绝对路径；缺省 DSH storages 下）。 */
  downloadDir?: string
  /** CLI 调用超时（毫秒）。 */
  timeoutMs: number
}

/** 默认配置。 */
export const DEFAULT_MAIL_CONFIG: MailConfig = {
  enabled: true,
  injectEnabled: true,
  timeoutMs: 60_000,
}

/** 从 config.json 的覆盖层归一化配置（只认已知键，值非法即忽略）。 */
export function applyMailConfigOverrides(config: MailConfig, patch: Partial<MailConfig> | undefined): MailConfig {
  if (patch === undefined) return config
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled
  if (typeof patch.injectEnabled === 'boolean') config.injectEnabled = patch.injectEnabled
  if (typeof patch.downloadDir === 'string' && patch.downloadDir.trim() !== '') config.downloadDir = patch.downloadDir.trim()
  if (typeof patch.timeoutMs === 'number' && Number.isFinite(patch.timeoutMs) && patch.timeoutMs >= 5_000) {
    config.timeoutMs = Math.min(600_000, Math.round(patch.timeoutMs))
  }
  return config
}

/** 面板可见的配置视图（公开字段 + CLI 探测结果）。 */
export interface MailConfigView extends MailConfig {
  /** CLI 可执行文件（探测到的绝对路径，null = 没找到）。 */
  cliPath: string | null
  /** CLI 版本号（探测失败为 null）。 */
  cliVersion: string | null
  /** 数据目录（诊断用）。 */
  dataDir: string
}
