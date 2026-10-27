/**
 * dsh-vault 云端同步契约（host 与 client **共用同一份**）。
 *
 * ── 为什么单开一个文件，而不是塞进 types.ts ──────────────────────────
 * 档案的同步设置有三个消费者：宿主侧的同步引擎（读它决定什么时候上传）、
 * 宿主侧的 HTTP 路由（把它转成响应）、浏览器侧的面板（拿它渲染输入框并做
 * 前端预校验）。三方必须用同一个字面量、同一个默认值、同一套地址解析规则，
 * 否则会漂移成「页面说已配置、引擎说没配置」这类只在用户机器上复现的问题。
 *
 * ⚠ 本文件被**浏览器侧** import，因此与 types.ts 同一条纪律：
 *   不允许出现任何 node: 或 @deepseek-ai/* 的运行时导入，只放纯常量、纯类型、
 *   纯函数。esbuild 会把它原地打进 client 产物。
 *
 * ── 一条关键的安全边界（决定了整个功能长什么样）─────────────────────
 * 档案的敏感字段是用**本机密钥**加密的（vault/key）。只把 vault.json 传到
 * GitHub 是不完整的备份：换一台机器解不开，本机磁盘坏了密钥也没了。所以自动
 * 上传的包必须**含密钥**，而含密钥就**必须再用用户口令加密一层**——否则仓库
 * 里躺着明文密码库。于是「自动上传」这件事在配置上必然要求两样东西：
 *   1. 一个仓库地址（私库）；
 *   2. 一个同步口令（打包用，缺了就不能上传）。
 * 这条推导是 needsSetup() 里那两个判断条件的全部理由，别为了「少填一个框」
 * 把它放宽——放宽的后果是往 GitHub 上传一份能直接解开的密码库。
 */

/** 同步配置落盘文件名（位于 <vault root>/store/ 下）。 */
export const VAULT_SYNC_FILE = 'sync.json'

/** 打包用的口令最短长度。**必须与 backup.ts 的 MIN_BACKUP_PASSWORD 相等**。 */
export const VAULT_SYNC_MIN_PASSPHRASE = 8

/** 默认同步间隔（小时）。用户要求：每 5 小时自动上传一次。 */
export const VAULT_SYNC_DEFAULT_EVERY_HOURS = 5

/** 间隔取值域（越界钳制而非丢弃）。 */
export const VAULT_SYNC_HOUR_BOUNDS = { min: 1, max: 168 } as const

/**
 * 单次上传的字节上限（30MB）。
 *
 * GitHub Contents API 单文件硬上限 100MB，但对超过 ~50MB 的 base64 请求会因
 * 请求体过大而变慢或超时。30MB 是「含全部展示图仍然够用、且不会把一次自动
 * 同步拖成好几分钟」的中间值。超限时不静默截断：先退成「不含照片」，再不行
 * 就报错让用户自己导出——悄悄少传一半数据比报错危险得多。
 */
export const VAULT_SYNC_MAX_BYTES = 30 * 1024 * 1024

/** 仓库里那个包的路径（固定名，便于「找回上一版」时在提交历史里认出来）。 */
export const VAULT_SYNC_PATH = 'dsh-vault-backup.dshvault'

/** 一次同步的结果状态。 */
export type VaultSyncStatus = 'ok' | 'error' | 'never'

/** 一条同步历史（最近若干次，仅用于页面展示「上次成功是什么时候」）。 */
export interface VaultSyncRun {
  at: string
  status: Exclude<VaultSyncStatus, 'never'>
  /** 包体字节数。 */
  bytes?: number
  /** GitHub 上的 blob sha（判断「内容没变、无需提交」用）。 */
  sha?: string
  /** 这次提交的 commit sha（可在 GitHub 历史里点开）。 */
  commit?: string
  /** 失败原因（中文一句话）。 */
  error?: string
  durationMs?: number
  /** true = 本地内容与远端一致，本次没有产生新提交。 */
  unchanged?: boolean
}

/**
 * 同步设置（落盘形态；token 与口令**不在这个结构里**）。
 *
 * token / passphrase 是秘密，单独以密文存进同一个文件的 secrets 段（见
 * sync.ts 的 VaultSyncSecrets）。这里只放能明文躺着的东西：仓库地址、开关、
 * 间隔、以及上次结果。
 */
export interface VaultSyncSettings {
  /** 规范化后的 "owner/repo"（空串 = 还没配置）。 */
  repo: string
  /** 自动上传总开关（默认开；配好仓库与口令后即刻生效）。 */
  enabled: boolean
  /** 每隔多少小时自动上传一次。 */
  everyHours: number
  /** 是否把图片一并打包（默认关：多数时候只是防丢密码，图片体积大）。 */
  includePhotos: boolean
  /** 上次尝试时间（ISO；含失败）。 */
  lastAt?: string
  /** 上次结果。 */
  lastStatus?: VaultSyncStatus
  lastError?: string
  lastBytes?: number
  lastSha?: string
  lastCommit?: string
  /** 最近若干次运行记录（新的在前）。 */
  history: VaultSyncRun[]
}

/** 默认设置。 */
export const DEFAULT_VAULT_SYNC: VaultSyncSettings = {
  repo: '',
  enabled: true,
  everyHours: VAULT_SYNC_DEFAULT_EVERY_HOURS,
  includePhotos: false,
  lastStatus: 'never',
  history: [],
}

/**
 * 页面用的公开视图（**绝不包含 token 与口令的明文**）。
 *
 * token 只回后四位，用来让用户确认「配的是哪一把钥匙」；口令只回「有没有」。
 * 这两条与档案里敏感字段的掩码纪律同源：页面永远不持有能直接用的凭据。
 */
export interface VaultSyncPublic {
  /** 规范化后的 owner/repo（空串 = 未配置）。 */
  repo: string
  /** 用户填的原始地址回显（便于看出自己填错在哪）。 */
  repoInput: string
  /** 解析成功且形如 owner/repo。 */
  repoValid: boolean
  /** GitHub 网页地址（配置有效时给页面做外链）。 */
  repoUrl: string
  /** 是否已配置访问令牌。 */
  tokenSet: boolean
  /** 令牌后四位（未配置为空串）。 */
  tokenTail: string
  /** 令牌来源：'stored' 用户填的 / 'gh' 回退本机 gh 登录态 / 'none'。 */
  tokenSource: 'stored' | 'gh' | 'none'
  /** 是否已设置同步口令。 */
  passphraseSet: boolean
  enabled: boolean
  everyHours: number
  includePhotos: boolean
  lastAt: string
  lastStatus: VaultSyncStatus
  lastError: string
  lastBytes: number
  lastSha: string
  lastCommit: string
  /** 正在跑（避免用户连点两次「立即同步」）。 */
  running: boolean
  /** 下次自动上传的预计时间（ISO；空串 = 不会自动跑）。 */
  nextAt: string
  /** 仓库是否私有（'unknown' = 还没校验过 / 校验失败）。 */
  repoPrivate: boolean | 'unknown'
  /** 仓库是否可达（'unknown' = 还没校验过）。 */
  repoReachable: boolean | 'unknown'
  /**
   * 当前数据是否**已经全部上传**（页面据此显示「已全部上传 / 有 N 项待上传」）。
   *
   * 判据是内容指纹与上次成功上传时一致——与「这次跑没跑过」无关：用户可能刚
   * 改了档案还没到下次定时，那他就是"有未上传的改动"，即使上一轮是 ok。
   * 'unknown' = 尚未成功上传过（含未配置 / 首传失败），此时页面不宣称"已上传"。
   */
  upToDate: boolean | 'unknown'
  /** 上次成功上传时包里的记录条数（0 = 还没成功传过）。 */
  uploadedRecords: number
  /** 当前档案的记录条数（页面用来对比"传了几条 / 现在几条"）。 */
  currentRecords: number
  /** 需要用户去填东西（页面据此显示顶部提示条）。 */
  needsSetup: boolean
  /** 项目方给的默认仓库地址（预填与新用户引导用；空串 = 没有推荐地址）。 */
  suggestedRepo: string
  /** 最近若干次运行记录。 */
  history: VaultSyncRun[]
}

/** 保存同步设置的请求体（页面 → 宿主）。 */
export interface VaultSyncPatch {
  repo?: string
  /** 访问令牌；空串 = 清除已存令牌；undefined = 不改。 */
  token?: string
  /** 同步口令；空串 = 清除；undefined = 不改。 */
  passphrase?: string
  enabled?: boolean
  everyHours?: number
  includePhotos?: boolean
}

/* ───────────────────────── GitHub 地址解析 ───────────────────────── */

/** owner / repo 名的合法字符（GitHub 的实际规则是 [\w.-]，这里不做更严的校验）。 */
const NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

/**
 * 解析并规范化用户填的 GitHub 仓库地址。
 *
 * 支持用户真实会粘贴的各种形态（**这些都必须能过，否则用户会以为插件坏了**）：
 *   https://github.com/Kr-ATG/dsh-vault-backup
 *   https://github.com/Kr-ATG/dsh-vault-backup.git
 *   https://github.com/Kr-ATG/dsh-vault-backup/          （多了尾斜杠）
 *   https://github.com/Kr-ATG/dsh-vault-backup/tree/main （从浏览器地址栏直接复制）
 *   git@github.com:Kr-ATG/dsh-vault-backup.git           （SSH 克隆地址）
 *   github.com/Kr-ATG/dsh-vault-backup
 *   Kr-ATG/dsh-vault-backup                              （简写）
 *
 * 解析失败返回 null（**不要抛**：这个函数在渲染路径上被调用）。
 * 只认 github.com：GitHub Enterprise 的 host 各不相同，而本功能的实现用的是
 * api.github.com；静默把 GHE 地址当 github.com 用会得到一串 404。
 */
export function parseGithubRepo(input: string): { owner: string; repo: string; fullName: string; htmlUrl: string } | null {
  const raw = (input ?? '').trim()
  if (raw === '') return null
  let rest = raw
  // SSH 形态：git@github.com:owner/repo.git
  const ssh = /^git@github\.com:(.+)$/i.exec(rest)
  if (ssh !== null) rest = ssh[1]
  else {
    const hadScheme = /^[a-z]+:\/\//i.test(rest)
    // 去掉协议与可能的 userinfo（https://user@github.com/x/y）。
    rest = rest.replace(/^[a-z]+:\/\//i, '')
    rest = rest.replace(/^[^@/]+@/, '')
    /*
     * 第一段若是 host（含点号），**必须正好是 github.com**。
     * 这一步曾经漏掉，后果是 https://gitlab.com/a/b 会被解析成
     * owner="gitlab.com"、repo="a" 而"成功"——然后同步时拿这个怪名字去打
     * api.github.com，用户看到的是一串莫名其妙的 404。宁可在这里直接拒。
     */
    const firstSlash = rest.indexOf('/')
    if (firstSlash !== -1) {
      const host = rest.slice(0, firstSlash).toLowerCase()
      if (host.includes('.')) {
        if (host !== 'github.com' && host !== 'www.github.com') return null
        rest = rest.slice(firstSlash + 1)
      }
    } else if (hadScheme) {
      // "https://github.com" 这种只有 host 没有 owner/repo 的，直接拒。
      return null
    }
  }
  // 去掉 query / fragment / 尾斜杠
  rest = rest.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const parts = rest.split('/').filter((part) => part !== '')
  if (parts.length < 2) return null
  const owner = parts[0]
  let repo = parts[1]
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4)
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) return null
  // 末尾的点会让 GitHub 上的名字无效（"repo." 其实是 "repo"），直接拒掉更诚实。
  if (repo.endsWith('.') || owner.endsWith('.')) return null
  return { owner, repo, fullName: owner + '/' + repo, htmlUrl: 'https://github.com/' + owner + '/' + repo }
}

/** 规范化成 "owner/repo"；解析不了返回空串。 */
export function normalizeGithubRepo(input: string): string {
  const parsed = parseGithubRepo(input)
  return parsed === null ? '' : parsed.fullName
}

/** 由规范化名字拼出网页地址。 */
export function githubRepoUrl(fullName: string): string {
  return fullName === '' ? '' : 'https://github.com/' + fullName
}

/** 钳制间隔小时数。 */
export function clampSyncHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return VAULT_SYNC_DEFAULT_EVERY_HOURS
  const rounded = Math.round(value)
  return Math.min(VAULT_SYNC_HOUR_BOUNDS.max, Math.max(VAULT_SYNC_HOUR_BOUNDS.min, rounded))
}

/**
 * 还缺什么才能自动上传（页面顶部提示条与「立即同步」按钮的可用性判据）。
 *
 * 两个条件缺一不可，理由见文件头的安全边界：
 *   · repo 为空  → 没有地方可传；
 *   · 口令未设   → 包里有密钥，不能传一份没有口令保护的。
 * token 不在判据里：未配置时会回退本机 gh 登录态（见 sync.ts），只有当两者
 * 都没有时上传才会报错——那时页面会带着具体的错误信息提示填令牌。
 */
export function needsSyncSetup(settings: Pick<VaultSyncSettings, 'repo'>, passphraseSet: boolean): boolean {
  return settings.repo === '' || passphraseSet !== true
}

/**
 * 计算下次自动上传时间。
 *
 * 以「上次尝试时间」为锚点而不是「插件启动时间」：否则每次重启都会把下一次
 * 往后推，用户永远等不到它跑（插件重启比 5 小时频繁得多）。
 */
export function nextSyncAt(settings: VaultSyncSettings, now: Date = new Date()): string {
  if (settings.enabled !== true) return ''
  const anchor = settings.lastAt === undefined || settings.lastAt === '' ? null : new Date(settings.lastAt)
  /*
   * 从没成功过 → **就是现在**（立刻到期）。
   *
   * 曾经写成 now + everyHours，于是「刚配好仓库、口令」的用户要干等 5 小时
   * 才会有第一份备份——而那 5 小时里他随时可能关掉 DSH，于是这个功能在他
   * 眼里等于没生效。首次配置后立刻传一份，才符合「填完地址就能自动上传」的
   * 预期。
   */
  if (anchor === null || Number.isNaN(anchor.getTime())) return now.toISOString()
  return new Date(anchor.getTime() + settings.everyHours * 3600 * 1000).toISOString()
}

/** 是否到期该跑了。 */
export function isSyncDue(settings: VaultSyncSettings, now: Date = new Date()): boolean {
  if (settings.enabled !== true) return false
  const due = nextSyncAt(settings, now)
  if (due === '') return false
  return now.getTime() >= new Date(due).getTime()
}
