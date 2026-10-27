/**
 * dsh-vault 云端同步引擎（host 半身）：把加密档案包每 N 小时推到 GitHub 私库。
 *
 * ── 这个模块解决的真实痛点 ────────────────────────────────────────────
 * 档案的备份通道（BackupPanel）是**手动**的，而密码库的特点是「你越想不起来
 * 备份，越需要它」。用户 2026-10-27 要求：每 5 小时自动上传一次到 GitHub 私库，
 * 页面上给一个仓库地址输入框。
 *
 * ── 传上去的到底是什么（决定了安全边界的形状）─────────────────────────
 * 传的是 backup.ts 打的**加密备份包**：里面有本机密钥 + vault.json（敏感字段
 * 本身也是密文），整体再用用户在页面上设的同步口令加密一层。所以：
 *   · 仓库里**没有可读明文**，也没有裸密钥；
 *   · 换机器时用口令就能完整恢复（这正是「备份」的意义，只传 vault.json 不行，
 *     因为没有 key 就一个密码也解不开）；
 *   · 因此**口令是必需品**，没设口令就不该上传——本模块的 ready() 把它列为
 *     硬前置条件，而不是「建议填」。
 *
 * ── 三条安全底线（每一条都有对应实现，别为了省事放宽）──────────────
 *  1. **只许私有仓库**。上传前必查 remote 的 private 字段，false 直接拒绝并
 *     报错。即使包是加密的，把密码库放到公开仓库本身就是错的：文件名、
 *     提交时间、包体积都是元数据泄露，而且口令一旦被离线暴力就全完了。
 *  2. **令牌与口令加密落盘**。sync.json 里存的是 vault cipher 加密后的
 *     `secret:v1:...`，与档案敏感字段同一套机制。没有可用 cipher 时**拒绝
 *     保存**（宁可不配，也不在磁盘上留明文 token）。
 *  3. **令牌绝不进日志/响应**。公开视图只回后四位；日志只记来源（stored/gh）。
 *
 * ── 令牌从哪来（两级回退）──────────────────────────────────────────
 *  1. 用户在页面上填的（加密存本机，优先级最高）；
 *  2. 回退本机 `gh auth token`（用户已经 gh 登录过就直接能用，少一步配置）。
 * 第 2 条是**便利性**设计：本机装 gh 且已登录的用户不该被迫再贴一遍 PAT。
 * 但它是可选回退，不是必需——没有 gh 的用户填令牌即可，两者都没有才报错。
 *
 * ── 为什么用 Contents API 而不是 git 命令 ────────────────────────────
 * git 需要工作区、需要 clone、需要处理冲突与凭据助手；而「每次覆盖一个文件」
 * 这件事 Contents API 一条 PUT 就够（拿现有 sha → PUT 带 sha）。少一层
 * 磁盘状态，也就少一类「本地 clone 坏掉了」的故障。
 *
 * ── 内容没变就不提交 ────────────────────────────────────────────────
 * 每次 5 小时都往仓库里塞一个内容几乎相同的 commit，历史会变成噪音。上传前
 * 本地算 git blob sha 与远端比对，一致就不 PUT（记 unchanged=true）。这样
 * 仓库历史里每一条提交都对应一次真实的档案变化。
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MIN_BACKUP_PASSWORD, createBackupPackage } from './backup.js'
import type { VaultCipher } from './crypto.js'
import { atomicWriteText, type VaultStore } from './store.js'
import {
  DEFAULT_VAULT_SYNC,
  VAULT_SYNC_FILE,
  VAULT_SYNC_MAX_BYTES,
  VAULT_SYNC_MIN_PASSPHRASE,
  VAULT_SYNC_PATH,
  clampSyncHours,
  githubRepoUrl,
  isSyncDue,
  needsSyncSetup,
  nextSyncAt,
  normalizeGithubRepo,
  type VaultSyncPatch,
  type VaultSyncPublic,
  type VaultSyncRun,
  type VaultSyncSettings,
  type VaultSyncStatus,
} from './sync-types.js'

/** GitHub REST 根（只认 github.com；GHE 的 host 各不相同，见 sync-types 的说明）。 */
const GITHUB_API = 'https://api.github.com'

/** 单次 HTTP 请求超时。GitHub 在国内偶尔很慢，8 秒会误报，30 秒足够宽松。 */
const HTTP_TIMEOUT_MS = 30_000

/** 自动检查间隔：5 分钟查一次「到期没有」。 */
const TICK_MS = 5 * 60 * 1000

/** 保留多少条运行历史（页面只展示最近几条）。 */
const HISTORY_LIMIT = 20

/** 日志口（与主插件 logger 同形状，但全部可选）。 */
export interface VaultSyncLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  debug?: (message: string) => void
}

/**
 * 落盘结构（<vault root>/store/sync.json）。
 *
 * settings 明文可读（仓库地址、开关、上次结果）；secrets 是加密后的秘密。
 * 分成两段而不是混在一起，是为了让「页面能读的东西」与「只能解不能读的东西」
 * 在文件层面就分开——将来若有人加一个调试接口，明摆着不该碰 secrets。
 */
interface VaultSyncFile {
  version: number
  settings: VaultSyncSettings
  /** 用户填的原始地址（回显用；settings.repo 是规范化后的）。 */
  repoInput?: string
  /** 加密后的秘密（`secret:v1:...`）。 */
  secrets?: {
    token?: string
    passphrase?: string
  }
  /**
   * 上次**成功**上传时的数据指纹（内容判定用，见 buildPackage）。
   *
   * 为什么不能靠比对包体本身：加密包每次生成都带新的随机 salt/iv，同一份档案
   * 打两次得到的字节**永远不同**。用包体 sha 当判据的话，「内容没变」这条逻辑
   * 永远不会命中，5 小时一次的同步会稳定地往仓库里塞空提交。
   * 所以指纹算在**加密前的明文数据**上。
   */
  lastDataHash?: string
  /** 上次成功上传时包里的记录条数（页面显示「已上传 N 条」用）。 */
  lastRecords?: number
  /** 仓库探查结果缓存（避免每次上传都多打一次 API）。 */
  probe?: {
    at: string
    /** 远端报告的 private 字段。 */
    private: boolean
    /** 默认分支名（PUT 时要带）。 */
    branch: string
  }
}

/** 一次打包结果。 */
interface BuiltPackage {
  text: string
  bytes: number
  passphrase: string
  /** 明文数据的指纹（同一份档案恒定；用来判「内容没变」）。 */
  dataHash: string
  /** 包里的记录条数（用来显示「已上传 N 条」）。 */
  records: number
}

/**
 * 同步引擎。
 *
 * 生命周期：构造不读盘（与 VaultStore 同策略：读盘失败不该让插件挂不上），
 * 首次访问惰性读。定时器由 applyVault 挂载 / 卸载。
 */
export class VaultSync {
  private file: VaultSyncFile | null = null
  private loading: Promise<VaultSyncFile> | null = null
  /** 正在跑（页面据此禁用按钮，也防两次定时叠加）。 */
  private running: Promise<VaultSyncRun> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** 上次自动同步尝试（避免 tick 在同一个到期点上反复触发）。 */
  private lastAutoAttempt = 0

  constructor(
    private store: VaultStore,
    private cipher: VaultCipher | null,
    private logger: VaultSyncLogger = {},
  ) {}

  /** sync.json 路径。 */
  get filePath(): string {
    return join(this.store.root, 'store', VAULT_SYNC_FILE)
  }

  /* ────────────────── 读 / 写 ────────────────── */

  private async ensureLoaded(): Promise<VaultSyncFile> {
    if (this.file !== null) return this.file
    if (this.loading !== null) return this.loading
    this.loading = this.loadNow()
    try {
      this.file = await this.loading
      return this.file
    } finally {
      this.loading = null
    }
  }

  private async loadNow(): Promise<VaultSyncFile> {
    const empty: VaultSyncFile = { version: 1, settings: { ...DEFAULT_VAULT_SYNC, history: [] } }
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      return empty
    }
    try {
      const parsed = JSON.parse(raw) as Partial<VaultSyncFile>
      if (parsed === null || typeof parsed !== 'object') return empty
      const settings = normalizeSettings(parsed.settings)
      const file: VaultSyncFile = { version: 1, settings }
      if (typeof parsed.repoInput === 'string') file.repoInput = parsed.repoInput
      if (typeof parsed.lastDataHash === 'string') file.lastDataHash = parsed.lastDataHash
      if (typeof parsed.lastRecords === 'number') file.lastRecords = parsed.lastRecords
      if (parsed.secrets !== undefined && typeof parsed.secrets === 'object') {
        file.secrets = {
          ...(typeof parsed.secrets.token === 'string' ? { token: parsed.secrets.token } : {}),
          ...(typeof parsed.secrets.passphrase === 'string' ? { passphrase: parsed.secrets.passphrase } : {}),
        }
      }
      if (parsed.probe !== undefined && typeof parsed.probe === 'object') {
        file.probe = {
          at: typeof parsed.probe.at === 'string' ? parsed.probe.at : '',
          private: parsed.probe.private === true,
          branch: typeof parsed.probe.branch === 'string' ? parsed.probe.branch : 'main',
        }
      }
      return file
    } catch {
      // 坏文件不覆盖：改名留证，以默认值启动。与 vault.json / entries.json 同策略。
      const backup = this.filePath + '.corrupt-' + String(Date.now())
      await atomicWriteText(backup, raw).catch(() => undefined)
      this.logger.warn?.('[dsh-vault] sync.json 无法解析，已备份为 ' + backup)
      return empty
    }
  }

  private async persist(next: VaultSyncFile): Promise<void> {
    this.file = next
    await mkdir(join(this.store.root, 'store'), { recursive: true })
    await atomicWriteText(this.filePath, JSON.stringify(next, null, 2))
  }

  /* ────────────────── 秘密的加密存取 ────────────────── */

  /** 加密一个秘密。没有 cipher 时**抛错**（绝不落明文）。 */
  private seal(plain: string): string {
    if (this.cipher === null) {
      throw new Error('本机没有可用的加密密钥，无法安全保存访问令牌（重启 DSH 会自动生成）')
    }
    return this.cipher.encrypt(plain)
  }

  /** 解密一个秘密；失败返回空串（密钥换了 / 文件被改）。 */
  private open(sealed: string | undefined): string {
    if (sealed === undefined || sealed === '') return ''
    if (this.cipher === null) return ''
    try {
      return this.cipher.decrypt(sealed)
    } catch {
      return ''
    }
  }

  /** 当前存着的口令（未设 / 解不开为空串）。 */
  private async passphraseOf(): Promise<string> {
    const file = await this.ensureLoaded()
    return this.open(file.secrets?.passphrase)
  }

  /** 是否已设同步口令。 */
  async hasPassphrase(): Promise<boolean> {
    const value = await this.passphraseOf()
    return value.length >= VAULT_SYNC_MIN_PASSPHRASE
  }

  /**
   * 解析出可用的 GitHub 令牌（**两级回退**）。
   *
   * 返回值里带 source，页面上要显示「用的是你填的令牌 / 本机 gh 登录态」——
   * 用户排查「为什么 403」时，这条信息决定他去改哪里。
   */
  async resolveToken(): Promise<{ token: string; source: 'stored' | 'gh' | 'none'; tail: string }> {
    const file = await this.ensureLoaded()
    const stored = this.open(file.secrets?.token)
    if (stored !== '') {
      return { token: stored, source: 'stored', tail: stored.slice(-4) }
    }
    const fromGh = await readGhToken()
    if (fromGh !== '') {
      return { token: fromGh, source: 'gh', tail: fromGh.slice(-4) }
    }
    return { token: '', source: 'none', tail: '' }
  }

  /* ────────────────── 公开状态 ────────────────── */

  /**
   * 算当前档案的内容指纹（**只算指纹，不打包**）。
   *
   * 与 buildPackage 里的算法必须**逐字节一致**——同一份数据两处算出不同的哈希，
   * 「已全部上传」就会永远显示成"有改动"，比不显示更糟。图片部分刻意都用同一种
   * 口径（都取 sha、都排序），这样"带图上传"与"不带图上传"的指纹差别只在图片集合。
   *
   * 代价是每次刷新状态要读一遍 vault.json（几 KB~几十 KB），比每次去打一个包
   * 便宜得多，而且不会触发加密/压缩。
   */
  private async currentDataHash(): Promise<{ hash: string; records: number }> {
    const vaultJson = await this.store.exportRaw()
    const records = await this.store.listRecords({ includeArchived: true })
    const file = await this.ensureLoaded()
    let photoShas = ''
    if (file.settings.includePhotos) {
      const snapshot = await this.store.blobs.snapshot()
      photoShas = snapshot.map((item) => item.sha256).sort().join(',')
    }
    const hash = createHash('sha256')
      .update(stableDataOf(vaultJson))
      .update('\u0000')
      .update(photoShas)
      .digest('hex')
    return { hash, records: records.length }
  }

  /** 页面可见的状态（**绝不含令牌与口令明文**）。 */
  async publicView(): Promise<VaultSyncPublic> {
    const file = await this.ensureLoaded()
    const settings = file.settings
    const passphraseSet = await this.hasPassphrase()
    const token = await this.resolveToken()
    const probe = file.probe
    // 只有「成功传过」才谈得上"是否已全部上传"：没传过就如实显示 unknown，
    // 页面据此显示「尚未上传」，而不是给一个假的"已全部上传"。
    let upToDate: boolean | 'unknown' = 'unknown'
    let currentRecords = 0
    if (file.lastDataHash !== undefined) {
      try {
        const current = await this.currentDataHash()
        currentRecords = current.records
        upToDate = current.hash === file.lastDataHash
      } catch {
        upToDate = 'unknown'
      }
    }
    return {
      repo: settings.repo,
      repoInput: file.repoInput ?? (settings.repo === '' ? '' : githubRepoUrl(settings.repo)),
      repoValid: settings.repo !== '',
      repoUrl: githubRepoUrl(settings.repo),
      tokenSet: token.source !== 'none',
      tokenTail: token.tail,
      tokenSource: token.source,
      passphraseSet,
      enabled: settings.enabled,
      everyHours: settings.everyHours,
      includePhotos: settings.includePhotos,
      lastAt: settings.lastAt ?? '',
      lastStatus: settings.lastStatus ?? 'never',
      lastError: settings.lastError ?? '',
      lastBytes: settings.lastBytes ?? 0,
      lastSha: settings.lastSha ?? '',
      lastCommit: settings.lastCommit ?? '',
      running: this.running !== null,
      nextAt: settings.repo !== '' && passphraseSet ? nextSyncAt(settings) : '',
      repoPrivate: probe === undefined ? 'unknown' : probe.private,
      repoReachable: probe === undefined ? 'unknown' : true,
      upToDate,
      uploadedRecords: file.lastRecords ?? 0,
      currentRecords,
      needsSetup: needsSyncSetup(settings, passphraseSet),
      suggestedRepo: SUGGESTED_REPO,
      history: settings.history.slice(0, 10),
    }
  }

  /* ────────────────── 设置写入 ────────────────── */

  /**
   * 保存页面提交的设置。
   *
   * 三条纪律：
   *  1. repo 先解析再存：存的是 `owner/repo`，解析失败当场报错（不要让一个
   *     错地址悄悄躺在配置里，等到三小时后自动同步时才炸）。
   *  2. token / passphrase：undefined = 不改；空串 = 清除；非空 = 校验后加密存。
   *  3. token 与 passphrase 必填的长度校验在这里做（页面也做，但服务端必须兜住）。
   */
  async save(patch: VaultSyncPatch): Promise<VaultSyncPublic> {
    const file = await this.ensureLoaded()
    const next: VaultSyncFile = { ...file, settings: { ...file.settings, history: [...file.settings.history] } }

    if (patch.repo !== undefined) {
      const raw = String(patch.repo).trim()
      if (raw === '') {
        next.settings.repo = ''
        next.repoInput = ''
      } else {
        const full = normalizeGithubRepo(raw)
        if (full === '') {
          throw new Error('这不是一个有效的 GitHub 仓库地址。形如 https://github.com/用户名/仓库名（或直接写 用户名/仓库名）')
        }
        next.settings.repo = full
        next.repoInput = raw
        // 换了仓库 → 旧探查结果与内容指纹一起作废（否则「私有性」判断会沿用
        // 上一个仓库的结论，而内容指纹会让新仓库的首次同步被误判成"不用传"）。
        delete next.probe
        delete next.lastDataHash
      }
    }
    if (patch.enabled !== undefined) next.settings.enabled = patch.enabled === true
    if (patch.includePhotos !== undefined) next.settings.includePhotos = patch.includePhotos === true
    if (patch.everyHours !== undefined) next.settings.everyHours = clampSyncHours(patch.everyHours)

    const secrets = { ...(next.secrets ?? {}) }
    if (patch.token !== undefined) {
      const token = String(patch.token).trim()
      if (token === '') delete secrets.token
      else {
        if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
          // GitHub 的 PAT / OAuth token 都是 20 位以上的 [A-Za-z0-9_-]。
          // 明显不像令牌的值直接在门口拦住——省掉一轮「同步失败 401」的排查。
          throw new Error('这不像一个 GitHub 令牌（应为 20 位以上的字母数字，ghp_ / github_pat_ 开头）')
        }
        secrets.token = this.seal(token)
      }
    }
    if (patch.passphrase !== undefined) {
      const passphrase = String(patch.passphrase)
      if (passphrase === '') delete secrets.passphrase
      else {
        if (passphrase.length < VAULT_SYNC_MIN_PASSPHRASE) {
          throw new Error('同步口令至少 ' + String(VAULT_SYNC_MIN_PASSPHRASE) + ' 位：它是唯一能解开这个包的东西')
        }
        secrets.passphrase = this.seal(passphrase)
      }
    }
    if (Object.keys(secrets).length > 0) next.secrets = secrets
    else delete next.secrets

    await this.persist(next)
    return this.publicView()
  }

  /* ────────────────── 仓库校验 / 上传 ────────────────── */

  /**
   * 探查远端仓库：是否可达、是否私有、默认分支。
   *
   * 缓存 10 分钟：一次同步里要问两遍（校验 + 拿分支），而用户连点「立即同步」
   * 时不该把 GitHub 的 rate limit 打满。换了仓库（save 时）会清缓存。
   */
  async probeRepo(token: string, repo: string, force = false): Promise<{ private: boolean; branch: string }> {
    const file = await this.ensureLoaded()
    if (!force && file.probe !== undefined && file.probe.at !== '') {
      const age = Date.now() - new Date(file.probe.at).getTime()
      if (Number.isFinite(age) && age >= 0 && age < 10 * 60 * 1000) {
        return { private: file.probe.private, branch: file.probe.branch }
      }
    }
    const response = await ghFetch(token, GITHUB_API + '/repos/' + repo)
    if (response.status === 404) {
      throw new Error('GitHub 上找不到这个仓库（' + repo + '），或这枚令牌没有访问它的权限')
    }
    if (response.status === 401) {
      throw new Error('GitHub 令牌已失效，请重新填写（本机 gh 登录态也可以：gh auth login）')
    }
    if (response.status === 403) {
      throw new Error('GitHub 拒绝了这次请求（403）：令牌可能缺少 repo 权限，或触发了限流，稍后再试')
    }
    if (!response.ok) {
      throw new Error('读取仓库信息失败（HTTP ' + String(response.status) + '）')
    }
    const body = await response.json() as { private?: unknown; default_branch?: unknown }
    const isPrivate = body.private === true
    const branch = typeof body.default_branch === 'string' && body.default_branch !== '' ? body.default_branch : 'main'
    const next: VaultSyncFile = { ...file, probe: { at: new Date().toISOString(), private: isPrivate, branch } }
    // 探查结果落盘失败不该让本次同步失败（只是下次要多问一遍）。
    await this.persist(next).catch(() => undefined)
    return { private: isPrivate, branch }
  }

  /** 读远端那个文件的 blob sha（不存在返回空串）。 */
  private async remoteSha(token: string, repo: string, branch: string): Promise<string> {
    const url = GITHUB_API + '/repos/' + repo + '/contents/' + encodeURIComponent(VAULT_SYNC_PATH) + '?ref=' + encodeURIComponent(branch)
    const response = await ghFetch(token, url)
    if (response.status === 404) return ''   // 首次上传：文件还不存在
    if (!response.ok) {
      throw new Error('读取远端备份文件失败（HTTP ' + String(response.status) + '）')
    }
    const body = await response.json() as { sha?: unknown }
    return typeof body.sha === 'string' ? body.sha : ''
  }

  /** 本地算 git blob sha（与 GitHub 返回的 sha 同算法，用来判「内容没变」）。 */
  private blobSha(bytes: Buffer): string {
    const header = Buffer.from('blob ' + String(bytes.length) + '\u0000', 'utf8')
    return createHash('sha1').update(header).update(bytes).digest('hex')
  }

  /** 上传（或更新）仓库里的备份文件。 */
  private async upload(input: {
    token: string
    repo: string
    branch: string
    text: string
    bytes: number
    existingSha: string
    /** true = 本地明文指纹与上次成功上传时一致。 */
    dataUnchanged: boolean
  }): Promise<{ commit: string; sha: string; unchanged: boolean }> {
    const content = Buffer.from(input.text, 'utf8')
    const localSha = this.blobSha(content)
    /*
     * 两条「不必提交」的判据：
     *   1. 明文指纹与上次成功上传时一致（本地知道，零网络成本）；
     *   2. 极少数情况：远端 blob sha 恰好与本次包体相同（几乎不可能，因为
     *      加密带随机 salt，但保留这条兜底不会有坏处）。
     * 都不命中才真的 PUT。5 小时一次的同步绝大多数时候内容没变，这条判断
     * 决定了仓库历史是可读的提交记录还是一堆噪音。
     */
    if (input.dataUnchanged) {
      return { commit: '', sha: input.existingSha === '' ? localSha : input.existingSha, unchanged: true }
    }
    if (input.existingSha !== '' && input.existingSha === localSha) {
      return { commit: '', sha: localSha, unchanged: true }
    }
    const body: Record<string, unknown> = {
      message: 'vault backup ' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + ' (' + String(input.bytes) + ' bytes)',
      content: content.toString('base64'),
      branch: input.branch,
    }
    if (input.existingSha !== '') body.sha = input.existingSha
    const response = await ghFetch(
      input.token,
      GITHUB_API + '/repos/' + input.repo + '/contents/' + encodeURIComponent(VAULT_SYNC_PATH),
      { method: 'PUT', body: JSON.stringify(body) },
    )
    if (response.status === 409 || response.status === 422) {
      throw new Error('远端文件在同步过程中被改动了（冲突），请再点一次「立即同步」')
    }
    if (response.status === 404) {
      throw new Error('仓库是空的或没有默认分支：请先在 GitHub 上给这个仓库初始化一个 README，再重试')
    }
    if (response.status === 401) {
      throw new Error('GitHub 令牌已失效，请重新填写')
    }
    if (response.status === 403) {
      throw new Error('令牌没有写入权限（403）：需要对该仓库有 Contents 读写权限（经典 PAT 的 repo 作用域 / 细粒度 PAT 的 Contents: Read and write）')
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error('上传失败（HTTP ' + String(response.status) + '）' + (detail === '' ? '' : '：' + detail.slice(0, 200)))
    }
    const result = await response.json() as { content?: { sha?: unknown }; commit?: { sha?: unknown } }
    const sha = typeof result.content?.sha === 'string' ? result.content.sha : localSha
    const commit = typeof result.commit?.sha === 'string' ? result.commit.sha : ''
    return { commit, sha, unchanged: false }
  }

  /* ────────────────── 打包 ────────────────── */

  /**
   * 打一个加密包。
   *
   * 与 /backup 走同一个 createBackupPackage（**不另写一套打包逻辑**）：两条通道
   * 产出的文件必须是同一种格式，否则「从 GitHub 拉回来能不能恢复」就成了一个
   * 需要单独验证的假设。这里的包直接喂给 /restore 就能恢复。
   */
  private async buildPackage(): Promise<BuiltPackage> {
    const passphrase = await this.passphraseOf()
    if (passphrase.length < VAULT_SYNC_MIN_PASSPHRASE) {
      throw new Error('还没有设置同步口令：包里有你的密钥，必须先用口令加密才能上传')
    }
    const key = this.store.exportKeyBytes()
    if (key === null) {
      throw new Error('本机没有可用的加密密钥，打不出能恢复的备份包')
    }
    const file = await this.ensureLoaded()
    const vaultJson = await this.store.exportRaw()
    const records = await this.store.listRecords({ includeArchived: true })
    const scenes = await this.store.listScenes()
    const photoCount = records.reduce((sum, record) => sum + record.photos.length, 0)

    let blobs: Array<{ sha256: string; bytes: Buffer }> | undefined
    /** 索引里的全部图片 sha（指纹口径，见下方 dataHash 注释）。 */
    let indexedShas: string[] = []
    if (file.settings.includePhotos) {
      // 图片先按体积估一遍：超上限就不带图（带图是个可选项，不该让整次同步失败）。
      const snapshot = await this.store.blobs.snapshot()
      indexedShas = snapshot.map((item) => item.sha256)
      const collected: Array<{ sha256: string; bytes: Buffer }> = []
      for (const item of snapshot) {
        const bytes = await this.store.blobs.get(item.sha256)
        if (bytes !== null) collected.push({ sha256: item.sha256, bytes })
      }
      blobs = collected
    }

    let text = await createBackupPackage({
      key,
      vaultJson,
      ...(blobs !== undefined ? { blobs } : {}),
      password: passphrase,
      summary: { records: records.length, photos: photoCount, scenes: scenes.length },
    })
    let bytes = Buffer.byteLength(text, 'utf8')
    // 超上限：**退一步去掉图片重打**，并在结果里注明。悄悄截断是最坏的选择
    // （用户以为备份完整，恢复时才发现证件照片全没了）。
    if (bytes > VAULT_SYNC_MAX_BYTES && blobs !== undefined) {
      text = await createBackupPackage({
        key,
        vaultJson,
        password: passphrase,
        summary: { records: records.length, photos: photoCount, scenes: scenes.length },
      })
      bytes = Buffer.byteLength(text, 'utf8')
      this.logger.warn?.('[dsh-vault] 含图片的备份包超过上限，本次改为不含图片上传（' + String(bytes) + ' 字节）')
    }
    if (bytes > VAULT_SYNC_MAX_BYTES) {
      throw new Error('档案太大（' + String(Math.round(bytes / 1024 / 1024)) + 'MB），超过 ' + String(Math.round(VAULT_SYNC_MAX_BYTES / 1024 / 1024)) + 'MB 上限，请改用「备份」手动导出')
    }
    /*
     * 指纹算在**明文数据**上（不是包体）：加密包每次都有新的 salt/iv，包体
     * 字节永远不同（见 VaultSyncFile.lastDataHash）。
     *
     * ⚠ 不能直接拿 vaultJson 来算——store.exportRaw() 里带着 exportedAt
     * (nowIso())，**每次调用都不一样**。第一版就是这么写的，结果是「内容没变」
     * 这条判据永远不命中、每 5 小时稳定往仓库里塞一个空提交，而且测试里那条
     * 「unchanged 不产生新提交」的断言当场失败才暴露出来。
     * 所以先把 exportedAt 摘掉再算。
     *
     * 图片只取 sha 而不是字节：sha 是内容寻址的，等价于「这些图有没有变」，
     * 但不必为此把几十 MB 图片读进来算一遍哈希。
     *
     * ⚠ 口径取**索引全集**而不是"成功读到字节的那几张"：某张图恰好读不出来时，
     * 后者会算出不同的指纹，于是刚传完就又显示"有改动"。publicView 里的
     * currentDataHash 用的也是索引全集，两处必须一致。
     */
    const photoShas = indexedShas.slice().sort().join(',')
    const dataHash = createHash('sha256')
      .update(stableDataOf(vaultJson))
      .update('\u0000')
      .update(photoShas)
      .digest('hex')
    return { text, bytes, passphrase, dataHash, records: records.length }
  }

  /* ────────────────── 执行一次同步 ────────────────── */

  /** 现在同步一次（页面按钮 / 定时器都走这里）。并发保护：同一时刻只跑一次。 */
  async runNow(trigger: 'manual' | 'auto' = 'manual'): Promise<VaultSyncRun> {
    if (this.running !== null) return this.running
    this.running = this.runInternal(trigger).finally(() => { this.running = null })
    return this.running
  }

  private async runInternal(trigger: 'manual' | 'auto'): Promise<VaultSyncRun> {
    const startedAt = Date.now()
    const at = new Date().toISOString()
    const file = await this.ensureLoaded()
    let run: VaultSyncRun
    try {
      if (this.store.readOnly) throw new Error('档案数据版本高于本插件，当前只读，跳过同步')
      if (file.settings.repo === '') throw new Error('还没有填写 GitHub 仓库地址')
      const token = await this.resolveToken()
      if (token.token === '') {
        throw new Error('没有可用的 GitHub 令牌：请在档案页「云端备份」里填一个，或在本机执行 gh auth login')
      }
      // ① 私有性校验（**硬闸门**，见文件头安全底线 1）。
      // probeRepo 抛错（仓库被删 / 令牌失效）时同样要清掉过期结论，理由同 verify()。
      let probe: { private: boolean; branch: string }
      try {
        probe = await this.probeRepo(token.token, file.settings.repo, trigger === 'manual')
      } catch (error) {
        await this.clearProbe().catch(() => undefined)
        throw error
      }
      if (!probe.private) {
        throw new Error('目标仓库 ' + file.settings.repo + ' 是公开仓库。档案包虽然加密，也不该放进公开仓库——请把仓库改成 Private，或换一个私有仓库')
      }
      // ② 打包。
      const built = await this.buildPackage()
      /*
       * ③ 「内容没变」的判定**先看本地指纹**：一致就完全不必碰网络（连
       * GET 远端 sha 都省了）。这条路径在真实使用里占绝大多数——用户一天
       * 只改几个密码，而同步每 5 小时跑一次。
       */
      if (file.lastDataHash !== undefined && file.lastDataHash === built.dataHash) {
        run = {
          at,
          status: 'ok',
          bytes: built.bytes,
          ...(file.settings.lastSha !== undefined && file.settings.lastSha !== '' ? { sha: file.settings.lastSha } : {}),
          unchanged: true,
          durationMs: Date.now() - startedAt,
        }
        this.logger.debug?.('[dsh-vault] 档案内容与上次一致，跳过上传')
      } else {
        // ④ 与远端比一次（可能是别的机器 / 别的插件实例刚传过）。
        const existingSha = await this.remoteSha(token.token, file.settings.repo, probe.branch)
        const result = await this.upload({
          token: token.token,
          repo: file.settings.repo,
          branch: probe.branch,
          text: built.text,
          bytes: built.bytes,
          existingSha,
          dataUnchanged: false,
        })
        run = {
          at,
          status: 'ok',
          bytes: built.bytes,
          sha: result.sha,
          ...(result.commit !== '' ? { commit: result.commit } : {}),
          ...(result.unchanged ? { unchanged: true } : {}),
          durationMs: Date.now() - startedAt,
        }
        // 只有真的落地了才更新指纹：上传失败时不能记成"已同步"，否则下次
        // 会以为内容已是最新而永远不再试。
        if (!result.unchanged) await this.rememberDataHash(file.settings.repo, built.dataHash, built.records)
        this.logger.info?.('[dsh-vault] 云端备份' + (result.unchanged ? '已是最新' : '已上传')
          + '（' + String(built.bytes) + ' 字节，来源 ' + token.source + '）')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      run = { at, status: 'error', error: message, durationMs: Date.now() - startedAt }
      this.logger.warn?.('[dsh-vault] 云端备份失败：' + message)
    }
    await this.recordRun(run).catch(() => undefined)
    return run
  }

  /**
   * 记下「这份内容已经传上去了」。
   *
   * 与仓库地址一起存：换了仓库之后，上一个仓库的内容指纹不能当作「新仓库
   * 已有同样内容」——那会让换仓库后的第一次同步被误判成「不用传」。
   */
  private async rememberDataHash(repo: string, dataHash: string, records: number): Promise<void> {
    const file = await this.ensureLoaded()
    if (file.settings.repo !== repo) return
    await this.persist({ ...file, lastDataHash: dataHash, lastRecords: records })
  }

  /** 把一次结果写进 settings（含 history）。 */
  private async recordRun(run: VaultSyncRun): Promise<void> {
    const file = await this.ensureLoaded()
    const settings: VaultSyncSettings = {
      ...file.settings,
      lastAt: run.at,
      lastStatus: run.status as VaultSyncStatus,
      history: [run, ...file.settings.history].slice(0, HISTORY_LIMIT),
    }
    if (run.status === 'ok') {
      settings.lastError = ''
      settings.lastBytes = run.bytes ?? 0
      settings.lastSha = run.sha ?? ''
      settings.lastCommit = run.commit ?? ''
    } else {
      settings.lastError = run.error ?? '未知错误'
      // 失败时**保留**上一次成功的 bytes/sha/commit：页面上「上次成功是多大」
      // 仍然是有用信息，被一次失败覆盖成 0 反而看不出档案有没有缩水。
    }
    await this.persist({ ...file, settings })
  }

  /* ────────────────── 定时器 ────────────────── */

  /**
   * 启动自动同步。
   *
   * 用「每 5 分钟检查一次是否到期」而不是「一个 5 小时的定时器」：后者在机器
   * 休眠 / 改系统时间后会整体漂移，而到期判断以 lastAt 为锚点，醒来后该补跑的
   * 立刻补跑。
   */
  start(): void {
    this.stop()
    this.timer = setInterval(() => { void this.tick() }, TICK_MS)
    ;(this.timer as unknown as { unref?: () => void }).unref?.()
    // 启动 20 秒后先探一次：常见场景是「上次关机时已经过期」，用户开着页面
    // 就应该看到它自己跑起来，而不是等满 5 分钟。
    const kick = setTimeout(() => { void this.tick() }, 20_000)
    ;(kick as unknown as { unref?: () => void }).unref?.()
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 到期就跑一次。所有异常都吞掉（定时任务不能把宿主带走）。 */
  private async tick(): Promise<void> {
    try {
      const file = await this.ensureLoaded()
      if (!isSyncDue(file.settings)) return
      if (!(await this.hasPassphrase())) return
      if (this.running !== null) return
      // 同一次到期点只尝试一次：失败后不要每 5 分钟重试一次把 rate limit 打满。
      const anchor = file.settings.lastAt === undefined ? 0 : new Date(file.settings.lastAt).getTime()
      if (this.lastAutoAttempt >= anchor) return
      this.lastAutoAttempt = Date.now()
      await this.runNow('auto')
    } catch (error) {
      this.logger.warn?.('[dsh-vault] 自动同步检查失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** 供「立即校验仓库」按钮用：只探查，不上传。 */
  async verify(): Promise<{ private: boolean; branch: string; repo: string; tokenSource: string }> {
    const file = await this.ensureLoaded()
    if (file.settings.repo === '') throw new Error('还没有填写 GitHub 仓库地址')
    const token = await this.resolveToken()
    if (token.token === '') {
      throw new Error('没有可用的 GitHub 令牌：请在档案页「云端备份」里填一个，或在本机执行 gh auth login')
    }
    try {
      const probe = await this.probeRepo(token.token, file.settings.repo, true)
      return { private: probe.private, branch: probe.branch, repo: file.settings.repo, tokenSource: token.source }
    } catch (error) {
      /*
       * 校验失败必须**清掉旧的探查结论**。
       *
       * 否则会出现一个很难查的自相矛盾：用户把仓库从私有改成公开（或删掉仓库、
       * 令牌被撤），页面上仍显示「已确认是私有仓库」（那是十分钟前缓存的结论），
       * 而点「立即同步」却被硬闸门拒绝。两个入口给出相反结论，用户只会觉得
       * 插件在瞎报。清掉之后，两个入口的说法就一致了：都不知道 = unknown。
       */
      await this.clearProbe().catch(() => undefined)
      throw error
    }
  }

  /** 丢掉探查缓存（校验失败 / 用户点「重新校验」时用）。 */
  private async clearProbe(): Promise<void> {
    const file = await this.ensureLoaded()
    if (file.probe === undefined) return
    const next: VaultSyncFile = { ...file }
    delete next.probe
    await this.persist(next)
  }
}

/**
 * 「地址该填成什么样」的示例（**只用于展示格式，不可一键填入**）。
 *
 * 这里刻意留空而不是写某个真实仓库名。第一版曾把它填成插件作者自己的私库
 * 并在页面上给了一个「填入推荐地址」按钮，这是一个**方向反了**的设计：
 *   · 这个功能的语义是「每个人的档案传到他自己的私库」，不存在公共终点；
 *   · 别人点一下填进去，得到的是一个他没有写权限的仓库——要么 403（看到的
 *     人以为是插件坏了），要么更糟：如果他碰巧是协作者，就把自己的密码库
 *     传进了别人的仓库。
 * 所以这里只给格式示例，让用户自己去 GitHub 建一个 Private 仓库。
 * 页面文案与本字段配合：needsSetup 时提示「填一个你自己的私有仓库」。
 */
export const SUGGESTED_REPO = ''

/* ───────────────────────── 工具函数 ───────────────────────── */

/**
 * 抽出「剥掉时间戳」的数据本体，用于内容指纹。
 *
 * exportRaw() 的 exportedAt 是每次生成的新时间，它属于**导出动作**而不属于
 * 数据本身。内容判定的输入里出现任何「每次都不一样」的字段，判据就永远为假。
 * 解析失败（不该发生）时退回原文：宁可多传一次，也不要因为算不出指纹而不传。
 */
function stableDataOf(vaultJson: string): string {
  try {
    const parsed = JSON.parse(vaultJson) as Record<string, unknown>
    delete parsed.exportedAt
    return JSON.stringify(parsed)
  } catch {
    return vaultJson
  }
}

/** 规范化落盘的 settings（字段缺失/类型不对一律回落默认值，绝不信任磁盘）。 */
function normalizeSettings(raw: unknown): VaultSyncSettings {
  const base: VaultSyncSettings = { ...DEFAULT_VAULT_SYNC, history: [] }
  if (raw === null || typeof raw !== 'object') return base
  const input = raw as Record<string, unknown>
  const repo = typeof input.repo === 'string' ? normalizeGithubRepo(input.repo) : ''
  const history: VaultSyncRun[] = []
  if (Array.isArray(input.history)) {
    for (const item of input.history.slice(0, HISTORY_LIMIT)) {
      if (item === null || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      if (typeof entry.at !== 'string') continue
      if (entry.status !== 'ok' && entry.status !== 'error') continue
      history.push({
        at: entry.at,
        status: entry.status,
        ...(typeof entry.bytes === 'number' ? { bytes: entry.bytes } : {}),
        ...(typeof entry.sha === 'string' ? { sha: entry.sha } : {}),
        ...(typeof entry.commit === 'string' ? { commit: entry.commit } : {}),
        ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
        ...(typeof entry.durationMs === 'number' ? { durationMs: entry.durationMs } : {}),
        ...(entry.unchanged === true ? { unchanged: true } : {}),
      })
    }
  }
  const status: VaultSyncStatus = input.lastStatus === 'ok' || input.lastStatus === 'error' ? input.lastStatus : 'never'
  return {
    repo,
    enabled: input.enabled !== false,
    everyHours: clampSyncHours(input.everyHours),
    includePhotos: input.includePhotos === true,
    ...(typeof input.lastAt === 'string' ? { lastAt: input.lastAt } : {}),
    lastStatus: status,
    ...(typeof input.lastError === 'string' ? { lastError: input.lastError } : {}),
    ...(typeof input.lastBytes === 'number' ? { lastBytes: input.lastBytes } : {}),
    ...(typeof input.lastSha === 'string' ? { lastSha: input.lastSha } : {}),
    ...(typeof input.lastCommit === 'string' ? { lastCommit: input.lastCommit } : {}),
    history,
  }
}

/** 带超时与标准头的 GitHub 请求。**令牌只进 header，永远不进 URL/日志。** */
async function ghFetch(token: string, url: string, init: { method?: string; body?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + token,
    'x-github-api-version': '2022-11-28',
    // GitHub 要求有 User-Agent，缺了会 403。
    'user-agent': 'dsh-chat-plus-vault',
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  return fetch(url, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
}

/**
 * 读本机 gh 登录态里的令牌。
 *
 * 用 execFile（不是 exec）：令牌本身不该经过 shell 解析，而且这里只需要
 * 一个 argv 调用，没有任何理由引一层 shell。失败一律返回空串——「本机没装 gh」
 * 是完全正常的情况，不是错误。
 */
async function readGhToken(): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile('gh', ['auth', 'token'], { timeout: 8000, windowsHide: true }, (error, stdout) => {
        if (error !== null) { resolve(''); return }
        const token = String(stdout).trim()
        resolve(/^[A-Za-z0-9_-]{20,}$/.test(token) ? token : '')
      })
    } catch {
      resolve('')
    }
  })
}
