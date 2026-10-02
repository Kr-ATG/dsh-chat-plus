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
  /** 展示用的关键字段（面板「待确认」条）。 */
  preview: Record<string, unknown>
}

/** 运行时配置（可被 cordis.patch.yml / 面板覆盖）。 */
export interface MailConfig {
  /** 总开关：关掉后工具与路由都不注册（插件其余能力不受影响）。 */
  enabled: boolean
  /** 对话首步是否注入「邮箱身份 + 使用约定」。 */
  injectEnabled: boolean
  /**
   * 是否常驻监听新邮件（`agently-cli message +watch` 长轮询）。
   *
   * **默认关闭**，理由两条：
   *  1. watch 是常驻子进程，默认就起等于「装上插件就多一个长跑进程」，冒烟测试
   *     与 CI 也会被它吊住不退出；
   *  2. 未读角标靠 30 秒一次的 list 轮询已经够用，实时推送属于「用户要了才要」
   *     的能力。用户在面板顶栏点铃铛开启后写入配置，此后每次启动自动起。
   */
  watchEnabled: boolean
  /** 附件默认下载目录（绝对路径；缺省 DSH storages 下）。 */
  downloadDir?: string
  /** CLI 调用超时（毫秒）。 */
  timeoutMs: number
}

/** 默认配置。 */
export const DEFAULT_MAIL_CONFIG: MailConfig = {
  enabled: true,
  injectEnabled: true,
  watchEnabled: false,
  timeoutMs: 60_000,
}

/** 从 config.json 的覆盖层归一化配置（只认已知键，值非法即忽略）。 */
export function applyMailConfigOverrides(config: MailConfig, patch: Partial<MailConfig> | undefined): MailConfig {
  if (patch === undefined) return config
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled
  if (typeof patch.injectEnabled === 'boolean') config.injectEnabled = patch.injectEnabled
  if (typeof patch.watchEnabled === 'boolean') config.watchEnabled = patch.watchEnabled
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
