/**
 * 工作台资产云端双向同步（Host 与 Client 共用类型契约）。
 *
 * 涵盖：
 *   · 档案（Vault：账号密码、服务器、证件、图片及主密钥）
 *   · 记忆（Memory：条目数据库 entries.json、状态元数据、各工作区 meta.json）
 *   · 技能（Skills：自定义技能包与 SKILL.md、技能启停开关）
 *
 * 安全约束：
 *   · 严禁在代码中出现任何私库、Token 或个人信息；
 *   · 敏感字段在本地加密保存；
 *   · 必须只允许私有仓库（Private Repo）。
 */

export const WORKBENCH_SYNC_FILE = 'workbench-sync.json'
export const WORKBENCH_SYNC_BLOB_PATH = 'dsh-workbench-backup.dshsync'
export const WORKBENCH_SYNC_MIN_PASSPHRASE = 8

export type SyncAction = 'upload' | 'pull'

/** 主次优先级：local (本地为主，主力机) | balanced (智能双向，平衡) | cloud (云端为主，从属机) */
export type SyncPriority = 'local' | 'balanced' | 'cloud'

export interface SyncStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  detail?: string
}

export interface SyncProgress {
  action: SyncAction
  status: 'idle' | 'running' | 'completed' | 'failed'
  stepIndex: number
  totalSteps: number
  steps: SyncStep[]
  startTime: number
  endTime?: number
  error?: string
  notice?: string
}

export interface WorkbenchSyncSettings {
  /** 规范化后的仓库路径，形如 owner/repo。 */
  repo: string
  /** 用户输入的原始地址（回显用）。 */
  repoInput: string
  /** 是否开启自动定时上传。 */
  autoUpload: boolean
  /** 是否开启自动双向同步。 */
  autoSync: boolean
  /** 主次模式：以谁为主。 */
  syncPriority: SyncPriority
  /** 自动同步间隔小时数（1 / 2 / 5 / 12 / 24）。 */
  everyHours: number
  /** 是否包含档案（默认 true）。 */
  includeVault: boolean
  /** 是否包含记忆（默认 true）。 */
  includeMemory: boolean
  /** 是否包含技能（默认 true）。 */
  includeSkills: boolean
  /** 上次成功上传时间（ISO 字符串）。 */
  lastUploadedAt?: string
  /** 上次成功上传的 commit sha。 */
  lastUploadedCommit?: string
  /** 上次成功上传的包字节数。 */
  lastUploadedBytes?: number
  /** 上次成功拉取恢复时间（ISO 字符串）。 */
  lastPulledAt?: string
  /** 上次成功拉取的 commit sha。 */
  lastPulledCommit?: string
  /** 运行历史记录。 */
  history: WorkbenchSyncRun[]
}

export interface WorkbenchSyncRun {
  at: string
  action: SyncAction
  status: 'ok' | 'error' | 'skipped'
  bytes?: number
  commit?: string
  error?: string
  durationMs: number
}

/** 暴露给前端页面的公开状态视图（绝不包含 Token / 口令明文）。 */
export interface WorkbenchSyncPublic {
  repo: string
  repoInput: string
  repoUrl: string
  repoPrivate: boolean | null
  autoUpload: boolean
  autoSync: boolean
  syncPriority: SyncPriority
  everyHours: number
  includeVault: boolean
  includeMemory: boolean
  includeSkills: boolean
  nextUploadAt: string
  nextSyncAt: string
  lastUploadedAt: string
  lastUploadedCommit: string
  lastUploadedBytes: number
  lastPulledAt: string
  lastPulledCommit: string
  localTotalBytes: number
  localVaultBytes: number
  localMemoryBytes: number
  localSkillsBytes: number
  passphraseSet: boolean
  tokenSet: boolean
  tokenSource: 'gh' | 'stored' | 'none'
  tokenTail: string
  running: boolean
  lastStatus: 'idle' | 'ok' | 'error'
  lastError: string
  history: WorkbenchSyncRun[]
  progress: SyncProgress | null
}

export interface WorkbenchSyncPatch {
  repo?: string
  token?: string
  passphrase?: string
  autoUpload?: boolean
  autoSync?: boolean
  syncPriority?: SyncPriority
  everyHours?: number
  includeVault?: boolean
  includeMemory?: boolean
  includeSkills?: boolean
  clearToken?: boolean
  clearPassphrase?: boolean
}

export const DEFAULT_WORKBENCH_SYNC_SETTINGS: WorkbenchSyncSettings = {
  repo: '',
  repoInput: '',
  autoUpload: true,
  autoSync: true,
  syncPriority: 'balanced',
  everyHours: 5,
  includeVault: true,
  includeMemory: true,
  includeSkills: true,
  history: [],
}

/** 解析与规范化 GitHub repo 地址。支持 https://github.com/owner/repo 或 owner/repo。 */
export function normalizeGithubRepo(input: string): string {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '')
  const parts = trimmed.split('/')
  if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
    return `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`
  }
  return ''
}

export function githubRepoUrl(repo: string): string {
  return repo !== '' ? `https://github.com/${repo}` : ''
}
