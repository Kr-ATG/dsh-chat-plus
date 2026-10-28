/**
 * 工作台资产云端双向同步引擎（Host 半身）：
 * 负责 GitHub 私库双向交互、端侧打包解密、定时自动上传、实时分步进度追踪。
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VaultCipher } from '../vault/crypto.js'
import { type VaultStore } from '../vault/store.js'
import { decryptSyncPayload, encryptSyncPayload, gitBlobSha, hashData } from './crypto.js'
import {
  gatherWorkbenchAssets,
  getWorkbenchSizes,
  restoreFeed,
  restoreMemory,
  restoreSkills,
  restoreVault,
  type GatheredWorkbenchPayload,
} from './gather.js'
import {
  DEFAULT_WORKBENCH_SYNC_SETTINGS,
  WORKBENCH_SYNC_BLOB_PATH,
  WORKBENCH_SYNC_FILE,
  WORKBENCH_SYNC_MIN_PASSPHRASE,
  githubRepoUrl,
  normalizeGithubRepo,
  type SyncAction,
  type SyncProgress,
  type SyncStep,
  type WorkbenchSyncPatch,
  type WorkbenchSyncPublic,
  type WorkbenchSyncRun,
  type WorkbenchSyncSettings,
} from './types.js'

const GITHUB_API = 'https://api.github.com'
const HTTP_TIMEOUT_MS = 35_000
const TICK_MS = 5 * 60 * 1000 // 5 分钟轮询一次定时
const HISTORY_LIMIT = 20

export interface WorkbenchSyncLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  debug?: (message: string) => void
}

interface PersistedSyncFile {
  version: number
  settings: WorkbenchSyncSettings
  secrets?: {
    token?: string
    passphrase?: string
  }
  lastDataHash?: string
  probe?: {
    at: string
    private: boolean
    branch: string
  }
}

/** 统一 ghFetch 包装。 */
async function ghFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, HTTP_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'dsh-workbench-sync/1.0',
        ...(init.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

export class WorkbenchSyncEngine {
  private file: PersistedSyncFile | null = null
  private loading: Promise<PersistedSyncFile> | null = null
  private runningPromise: Promise<WorkbenchSyncRun> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private currentProgress: SyncProgress | null = null

  constructor(
    private vaultStore: VaultStore,
    private cipher: VaultCipher | null,
    private logger: WorkbenchSyncLogger = {},
  ) {}

  get filePath(): string {
    return join(this.vaultStore.root, 'store', WORKBENCH_SYNC_FILE)
  }

  /* ────────────────── 持久化与秘密管理 ────────────────── */

  private async ensureLoaded(): Promise<PersistedSyncFile> {
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

  private async loadNow(): Promise<PersistedSyncFile> {
    const empty: PersistedSyncFile = {
      version: 1,
      settings: { ...DEFAULT_WORKBENCH_SYNC_SETTINGS, history: [] },
    }
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedSyncFile>
      if (!parsed || typeof parsed !== 'object') return empty
      return {
        version: 1,
        settings: {
          ...DEFAULT_WORKBENCH_SYNC_SETTINGS,
          ...(parsed.settings ?? {}),
          history: Array.isArray(parsed.settings?.history) ? parsed.settings.history.slice(0, HISTORY_LIMIT) : [],
        },
        secrets: parsed.secrets,
        lastDataHash: typeof parsed.lastDataHash === 'string' ? parsed.lastDataHash : undefined,
        probe: parsed.probe,
      }
    } catch {
      // 若 workbench-sync.json 不存在，尝试无缝继承旧版 sync.json（若用户之前配过档案云端私库）
      try {
        const legacyPath = join(this.vaultStore.root, 'store', 'sync.json')
        const legacyRaw = await readFile(legacyPath, 'utf8')
        const legacy = JSON.parse(legacyRaw) as {
          settings?: { repo?: string }
          repoInput?: string
          secrets?: { token?: string; passphrase?: string }
          probe?: { at: string; private: boolean; branch: string }
        }
        if (legacy && typeof legacy === 'object' && legacy.settings?.repo) {
          const inherited: PersistedSyncFile = {
            version: 1,
            settings: {
              ...DEFAULT_WORKBENCH_SYNC_SETTINGS,
              repo: legacy.settings.repo,
              repoInput: legacy.repoInput || legacy.settings.repo,
              history: [],
            },
            secrets: legacy.secrets,
            probe: legacy.probe,
          }
          await this.persist(inherited).catch(() => undefined)
          return inherited
        }
      } catch {}
      return empty
    }
  }

  private async persist(next: PersistedSyncFile): Promise<void> {
    this.file = next
    await mkdir(join(this.vaultStore.root, 'store'), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  private seal(plain: string): string {
    if (this.cipher === null) throw new Error('本机没有可用加密密钥，无法安全保存凭据')
    return this.cipher.encrypt(plain)
  }

  private open(sealed?: string): string {
    if (!sealed || this.cipher === null) return ''
    try {
      return this.cipher.decrypt(sealed)
    } catch {
      return ''
    }
  }

  /* ────────────────── 令牌解析（两级回退） ────────────────── */

  private async resolveToken(): Promise<{ token: string; source: 'stored' | 'gh' | 'none' }> {
    const file = await this.ensureLoaded()
    const stored = this.open(file.secrets?.token)
    if (stored !== '') return { token: stored, source: 'stored' }

    return new Promise((resolve) => {
      execFile('gh', ['auth', 'token'], { timeout: 4000 }, (err, stdout) => {
        if (!err && stdout) {
          const t = stdout.trim()
          if (t.length >= 10) return resolve({ token: t, source: 'gh' })
        }
        resolve({ token: '', source: 'none' })
      })
    })
  }

  private async resolvePassphrase(): Promise<string> {
    const file = await this.ensureLoaded()
    return this.open(file.secrets?.passphrase)
  }

  /* ────────────────── 仓库探查与私库验证 ────────────────── */

  private async probeRepo(token: string, repo: string): Promise<{ private: boolean; branch: string }> {
    const response = await ghFetch(token, `${GITHUB_API}/repos/${repo}`)
    if (response.status === 404) {
      throw new Error('未找到仓库：可能仓库不存在，或当前令牌没有访问该仓库的权限')
    }
    if (response.status === 401) throw new Error('GitHub 令牌已失效，请重新配置')
    if (!response.ok) throw new Error(`访问仓库失败（HTTP ${response.status}）`)
    const body = await response.json() as { private?: unknown; default_branch?: unknown }
    const isPrivate = body.private === true
    const branch = typeof body.default_branch === 'string' && body.default_branch !== '' ? body.default_branch : 'main'

    const file = await this.ensureLoaded()
    await this.persist({
      ...file,
      probe: { at: new Date().toISOString(), private: isPrivate, branch },
    }).catch(() => undefined)

    return { private: isPrivate, branch }
  }

  /* ────────────────── 进度管理 ────────────────── */

  private setProgress(action: SyncAction, steps: Array<{ id: string; name: string }>): void {
    this.currentProgress = {
      action,
      status: 'running',
      stepIndex: 0,
      totalSteps: steps.length,
      steps: steps.map((s) => ({ id: s.id, name: s.name, status: 'pending' })),
      startTime: Date.now(),
    }
  }

  private advanceStep(index: number, status: 'running' | 'done' | 'error', detail?: string): void {
    if (!this.currentProgress) return
    this.currentProgress.stepIndex = index
    if (this.currentProgress.steps[index]) {
      this.currentProgress.steps[index].status = status
      if (detail !== undefined) this.currentProgress.steps[index].detail = detail
    }
  }

  private finishProgress(status: 'completed' | 'failed', error?: string, notice?: string): void {
    if (!this.currentProgress) return
    this.currentProgress.status = status
    this.currentProgress.endTime = Date.now()
    if (error) this.currentProgress.error = error
    if (notice) this.currentProgress.notice = notice
  }

  /* ────────────────── 立即上传备份（Upload） ────────────────── */

  async uploadNow(trigger: 'manual' | 'auto' = 'manual'): Promise<WorkbenchSyncRun> {
    if (this.runningPromise !== null) return this.runningPromise
    this.runningPromise = this.doUpload(trigger)
    try {
      return await this.runningPromise
    } finally {
      this.runningPromise = null
    }
  }

  private async doUpload(trigger: 'manual' | 'auto'): Promise<WorkbenchSyncRun> {
    const started = Date.now()
    const file = await this.ensureLoaded()
    const repo = file.settings.repo
    if (!repo) {
      throw new Error('未配置 GitHub 私库地址')
    }
    const passphrase = await this.resolvePassphrase()
    if (passphrase.length < WORKBENCH_SYNC_MIN_PASSPHRASE) {
      throw new Error(`未设置同步口令（至少 ${WORKBENCH_SYNC_MIN_PASSPHRASE} 位），口令是端侧加密的前提`)
    }
    const { token } = await this.resolveToken()
    if (!token) {
      throw new Error('未获取到有效的 GitHub 令牌（请在页面填写或在本机执行 gh auth login）')
    }

    const steps = [
      { id: 'verify', name: '验证 GitHub 私库连接与权限' },
      { id: 'gather', name: '扫描并提取本地工作台资产' },
      { id: 'fingerprint', name: '计算数据指纹对比变更' },
      { id: 'encrypt', name: '使用口令进行端侧强加密' },
      { id: 'upload', name: '推送加密包至 GitHub 私库' },
      { id: 'complete', name: '同步完成并记录日志' },
    ]
    this.setProgress('upload', steps)

    try {
      // Step 1: verify
      this.advanceStep(0, 'running', '正在查询仓库信息...')
      const { private: isPrivate, branch } = await this.probeRepo(token, repo)
      if (!isPrivate) {
        throw new Error('安全拦截：目标仓库是公开仓库（Public）！工作台资产只允许上传到私库（Private）。')
      }
      this.advanceStep(0, 'done', `私库验证通过（分支: ${branch}）`)

      // Step 2: gather
      this.advanceStep(1, 'running', '正在收集档案、记忆、技能与动态设置...')
      const payload = await gatherWorkbenchAssets({
        includeVault: file.settings.includeVault,
        includeMemory: file.settings.includeMemory,
        includeSkills: file.settings.includeSkills,
        includeFeed: file.settings.includeFeed,
        vaultStore: this.vaultStore,
      })
      const vaultCount = payload.vault?.vaultJson ? JSON.parse(payload.vault.vaultJson)?.records?.length ?? 0 : 0
      const memoryCount = payload.memory?.entriesJson ? JSON.parse(payload.memory.entriesJson)?.entries?.length ?? 0 : 0
      const skillsCount = Object.keys(payload.skills?.files ?? {}).length
      const feedEntityCount = payload.feed?.entitiesJson ? JSON.parse(payload.feed.entitiesJson)?.entities?.length ?? 0 : 0
      const feedParts: string[] = []
      if (payload.feed?.configJson) feedParts.push('提示词与模型')
      if (feedEntityCount > 0) feedParts.push(`关注对象 ${feedEntityCount} 个`)
      const feedDetail = feedParts.length > 0 ? `, 动态设置(${feedParts.join(' / ')})` : ''
      this.advanceStep(1, 'done', `已收集: 档案 ${vaultCount} 条, 记忆 ${memoryCount} 条, 技能文件 ${skillsCount} 个${feedDetail}`)

      // Step 3: fingerprint
      this.advanceStep(2, 'running', '比对本地数据指纹与远端提交...')
      // 业务指纹仅比对实质数据（排除 payload 上的 createdAt 时间戳）
      const currentHash = hashData({
        vault: payload.vault,
        memory: payload.memory,
        skills: payload.skills,
        feed: payload.feed,
      })
      const isUnchanged = file.lastDataHash === currentHash

      // 检查远端文件是否已有提交记录
      let existingSha = ''
      const checkResp = await ghFetch(
        token,
        `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(WORKBENCH_SYNC_BLOB_PATH)}?ref=${encodeURIComponent(branch)}`,
      )
      if (checkResp.ok) {
        const checkBody = await checkResp.json() as { sha?: unknown }
        if (typeof checkBody.sha === 'string') existingSha = checkBody.sha
      }

      if (isUnchanged && existingSha !== '') {
        const lastCommit = file.settings.lastUploadedCommit ? file.settings.lastUploadedCommit.slice(0, 7) : existingSha.slice(0, 7)
        const lastTime = file.settings.lastUploadedAt ? new Date(file.settings.lastUploadedAt).toLocaleString('zh-CN', { hour12: false }) : '不久前'
        const noticeMsg = `数据未发生变更：已于 ${lastTime} 提交至云端私库（提交 ${lastCommit}），当前已是最新，无需重复上传。`

        this.advanceStep(2, 'done', `与上次提交一致（${lastTime}）`)
        this.advanceStep(3, 'done', '本地无改动，跳过加密')
        this.advanceStep(4, 'done', `远端已有提交（${lastCommit}）`)
        this.advanceStep(5, 'done', '已与私库保持最新')
        this.finishProgress('completed', undefined, noticeMsg)

        const run: WorkbenchSyncRun = {
          at: new Date().toISOString(),
          action: 'upload',
          status: 'skipped',
          commit: file.settings.lastUploadedCommit,
          durationMs: Date.now() - started,
        }
        await this.recordRun(run)
        return run
      }
      this.advanceStep(2, 'done', '数据已更新，准备加密上传')

      // Step 4: encrypt
      this.advanceStep(3, 'running', '使用 scrypt + AES-256-GCM 加密中...')
      const encryptedPackage = await encryptSyncPayload(payload, passphrase, {
        vaultRecords: vaultCount,
        memoryEntries: memoryCount,
        skillFiles: skillsCount,
        feedEntities: feedEntityCount,
      })
      const packageBytes = Buffer.byteLength(encryptedPackage, 'utf8')
      this.advanceStep(3, 'done', `加密完成（压缩包体积: ${(packageBytes / 1024).toFixed(1)} KB）`)

      // Step 5: upload
      this.advanceStep(4, 'running', '正在上传到 GitHub Contents API...')
      // 复用已探查到的远端文件 sha（如果步骤3中没取到再查一次）
      if (existingSha === '') {
        const checkResp = await ghFetch(
          token,
          `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(WORKBENCH_SYNC_BLOB_PATH)}?ref=${encodeURIComponent(branch)}`,
        )
        if (checkResp.ok) {
          const checkBody = await checkResp.json() as { sha?: unknown }
          if (typeof checkBody.sha === 'string') existingSha = checkBody.sha
        }
      }

      const uploadBody: Record<string, unknown> = {
        message: `workbench backup ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} (${packageBytes} bytes)`,
        content: Buffer.from(encryptedPackage, 'utf8').toString('base64'),
        branch,
      }
      if (existingSha !== '') uploadBody.sha = existingSha

      const putResp = await ghFetch(
        token,
        `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(WORKBENCH_SYNC_BLOB_PATH)}`,
        { method: 'PUT', body: JSON.stringify(uploadBody) },
      )
      if (!putResp.ok) {
        const errText = await putResp.text().catch(() => '')
        throw new Error(`上传失败（HTTP ${putResp.status}）：${errText.slice(0, 200)}`)
      }
      const putResult = await putResp.json() as { commit?: { sha?: unknown } }
      const commitSha = typeof putResult.commit?.sha === 'string' ? putResult.commit.sha : ''
      this.advanceStep(4, 'done', `上传成功（提交 ${commitSha.slice(0, 7)}）`)

      // Step 6: complete
      this.advanceStep(5, 'done', '同步完成！')
      this.finishProgress('completed')

      const now = new Date().toISOString()
      const nextSettings: WorkbenchSyncSettings = {
        ...file.settings,
        lastUploadedAt: now,
        lastUploadedCommit: commitSha,
        lastUploadedBytes: packageBytes,
      }
      const run: WorkbenchSyncRun = {
        at: now,
        action: 'upload',
        status: 'ok',
        bytes: packageBytes,
        commit: commitSha,
        durationMs: Date.now() - started,
      }
      await this.persist({
        ...file,
        settings: nextSettings,
        lastDataHash: currentHash,
      })
      await this.recordRun(run)
      return run
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.finishProgress('failed', msg)
      const run: WorkbenchSyncRun = {
        at: new Date().toISOString(),
        action: 'upload',
        status: 'error',
        error: msg,
        durationMs: Date.now() - started,
      }
      await this.recordRun(run)
      throw error
    }
  }

  /* ────────────────── 一键同步拉取恢复（Pull） ────────────────── */

  async pullNow(): Promise<WorkbenchSyncRun> {
    if (this.runningPromise !== null) return this.runningPromise
    this.runningPromise = this.doPull()
    try {
      return await this.runningPromise
    } finally {
      this.runningPromise = null
    }
  }

  private async doPull(): Promise<WorkbenchSyncRun> {
    const started = Date.now()
    const file = await this.ensureLoaded()
    const repo = file.settings.repo
    if (!repo) throw new Error('未配置 GitHub 私库地址')
    const passphrase = await this.resolvePassphrase()
    if (passphrase.length < WORKBENCH_SYNC_MIN_PASSPHRASE) {
      throw new Error('未设置同步口令，无法解密云端备份包')
    }
    const { token } = await this.resolveToken()
    if (!token) throw new Error('未获取到有效的 GitHub 令牌')

    const steps = [
      { id: 'verify', name: '验证 GitHub 私库连接与备份文件' },
      { id: 'download', name: '下载云端最新加密备份包' },
      { id: 'decrypt', name: '使用同步口令校验与解密' },
      { id: 'restore', name: '恢复档案、记忆、技能与动态设置数据' },
      { id: 'reload', name: '工作台数据重载并就绪' },
    ]
    this.setProgress('pull', steps)

    try {
      // Step 1: verify
      this.advanceStep(0, 'running', '正在检查仓库状态...')
      const { private: isPrivate, branch } = await this.probeRepo(token, repo)
      if (!isPrivate) {
        throw new Error('安全拦截：目标仓库是公开仓库！拒绝同步。')
      }
      this.advanceStep(0, 'done', `私库验证通过（分支: ${branch}）`)

      // Step 2: download
      this.advanceStep(1, 'running', '正在从 GitHub 获取备份包内容...')
      // 使用 application/vnd.github.raw 直接流式拉取完整文件，不受 Contents API 默认 1MB base64 截断限制
      const getResp = await ghFetch(
        token,
        `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(WORKBENCH_SYNC_BLOB_PATH)}?ref=${encodeURIComponent(branch)}`,
        { headers: { 'Accept': 'application/vnd.github.raw' } },
      )
      if (getResp.status === 404) {
        throw new Error('云端私库中尚未发现备份文件（可能尚未执行过上传备份）')
      }
      if (!getResp.ok) {
        throw new Error(`下载备份文件失败（HTTP ${getResp.status}）`)
      }
      const rawEncryptedText = await getResp.text()
      const sizeBytes = Buffer.byteLength(rawEncryptedText, 'utf8')
      const commitSha = getResp.headers.get('etag')?.replace(/"/g, '') ?? ''
      this.advanceStep(1, 'done', `下载完成（包大小: ${(sizeBytes / 1024).toFixed(1)} KB）`)

      // Step 3: decrypt
      this.advanceStep(2, 'running', '使用口令解密与校验完整性...')
      const { data: payload } = await decryptSyncPayload<GatheredWorkbenchPayload>(rawEncryptedText, passphrase)
      this.advanceStep(2, 'done', '解密校验通过！')

      // Step 4: restore
      this.advanceStep(3, 'running', '正在写入本地档案、记忆、技能与动态设置文件...')
      let restoredVault = 0
      let restoredMemory = 0
      let restoredSkills = 0

      if (payload.vault && file.settings.includeVault) {
        const vRes = await restoreVault(payload.vault, this.vaultStore)
        restoredVault = vRes.records
      }
      if (payload.memory && file.settings.includeMemory) {
        const mRes = await restoreMemory(payload.memory)
        restoredMemory = mRes.entries
      }
      let removedSkills = 0
      if (payload.skills && file.settings.includeSkills) {
        const sRes = await restoreSkills(payload.skills)
        restoredSkills = sRes.files
        removedSkills = sRes.removedSkills
      }
      let restoredFeedEntities = 0
      let restoredFeedConfig = false
      if (payload.feed && file.settings.includeFeed) {
        const fRes = await restoreFeed(payload.feed)
        restoredFeedEntities = fRes.entities
        restoredFeedConfig = fRes.config
      }
      const removedText = removedSkills > 0 ? ` (已同步清理 ${removedSkills} 个已删技能)` : ''
      const feedText = payload.feed && file.settings.includeFeed && (restoredFeedConfig || restoredFeedEntities > 0)
        ? `, 动态设置(${restoredFeedConfig ? '提示词与模型已恢复' : '无配置'}${restoredFeedEntities > 0 ? ` / 关注对象 ${restoredFeedEntities} 个` : ''})`
        : ''
      this.advanceStep(3, 'done', `已还原: 档案 ${restoredVault} 条, 记忆 ${restoredMemory} 条, 技能文件 ${restoredSkills} 个${removedText}${feedText}`)

      // Step 5: reload
      this.advanceStep(4, 'done', '所有资产已就绪并生效！')
      this.finishProgress('completed')

      const now = new Date().toISOString()
      const nextSettings: WorkbenchSyncSettings = {
        ...file.settings,
        lastPulledAt: now,
        lastPulledCommit: commitSha,
      }
      const run: WorkbenchSyncRun = {
        at: now,
        action: 'pull',
        status: 'ok',
        bytes: sizeBytes,
        commit: commitSha,
        durationMs: Date.now() - started,
      }
      await this.persist({
        ...file,
        settings: nextSettings,
        lastDataHash: hashData({
          vault: payload.vault,
          memory: payload.memory,
          skills: payload.skills,
          feed: payload.feed,
        }),
      })
      await this.recordRun(run)
      return run
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.finishProgress('failed', msg)
      const run: WorkbenchSyncRun = {
        at: new Date().toISOString(),
        action: 'pull',
        status: 'error',
        error: msg,
        durationMs: Date.now() - started,
      }
      await this.recordRun(run)
      throw error
    }
  }

  /* ────────────────── 保存设置 ────────────────── */

  async save(patch: WorkbenchSyncPatch): Promise<WorkbenchSyncPublic> {
    const file = await this.ensureLoaded()
    const nextSettings: WorkbenchSyncSettings = { ...file.settings }
    let secrets = { ...(file.secrets ?? {}) }

    if (typeof patch.repo === 'string') {
      const normalized = normalizeGithubRepo(patch.repo)
      nextSettings.repo = normalized
      nextSettings.repoInput = patch.repo.trim()
    }
    if (typeof patch.autoUpload === 'boolean') nextSettings.autoUpload = patch.autoUpload
    if (typeof patch.autoSync === 'boolean') nextSettings.autoSync = patch.autoSync
    if (patch.syncPriority === 'local' || patch.syncPriority === 'cloud' || patch.syncPriority === 'balanced') {
      nextSettings.syncPriority = patch.syncPriority
    }
    if (typeof patch.everyHours === 'number') nextSettings.everyHours = Math.max(1, Math.min(patch.everyHours, 24))
    if (typeof patch.includeVault === 'boolean') nextSettings.includeVault = patch.includeVault
    if (typeof patch.includeMemory === 'boolean') nextSettings.includeMemory = patch.includeMemory
    if (typeof patch.includeSkills === 'boolean') nextSettings.includeSkills = patch.includeSkills
    if (typeof patch.includeFeed === 'boolean') nextSettings.includeFeed = patch.includeFeed

    if (patch.clearToken === true) delete secrets.token
    else if (typeof patch.token === 'string' && patch.token.trim() !== '') {
      secrets.token = this.seal(patch.token.trim())
    }

    if (patch.clearPassphrase === true) delete secrets.passphrase
    else if (typeof patch.passphrase === 'string' && patch.passphrase.trim() !== '') {
      secrets.passphrase = this.seal(patch.passphrase.trim())
    }

    await this.persist({
      ...file,
      settings: nextSettings,
      secrets,
    })

    return this.publicView()
  }

  /* ────────────────── 记录历史 ────────────────── */

  private async recordRun(run: WorkbenchSyncRun): Promise<void> {
    const file = await this.ensureLoaded()
    const history = [run, ...file.settings.history].slice(0, HISTORY_LIMIT)
    await this.persist({
      ...file,
      settings: { ...file.settings, history },
    }).catch(() => undefined)
  }

  /* ────────────────── 公开状态视图 ────────────────── */

  async publicView(): Promise<WorkbenchSyncPublic> {
    const file = await this.ensureLoaded()
    const { token, source: tokenSource } = await this.resolveToken()
    const passphrase = await this.resolvePassphrase()
    const sizes = await getWorkbenchSizes()

    const lastRun = file.settings.history[0]
    const lastStatus = !lastRun ? 'idle' : lastRun.status === 'ok' || lastRun.status === 'skipped' ? 'ok' : 'error'
    const lastError = lastRun?.error ?? ''

    let nextUploadAt = ''
    let nextSyncAt = ''
    const lastActiveTime = Math.max(
      file.settings.lastUploadedAt ? new Date(file.settings.lastUploadedAt).getTime() : 0,
      file.settings.lastPulledAt ? new Date(file.settings.lastPulledAt).getTime() : 0,
    )
    if (file.settings.autoUpload && file.settings.lastUploadedAt) {
      const nextTime = new Date(file.settings.lastUploadedAt).getTime() + file.settings.everyHours * 3600 * 1000
      nextUploadAt = new Date(nextTime).toISOString()
    }
    if (file.settings.autoSync && lastActiveTime > 0) {
      nextSyncAt = new Date(lastActiveTime + file.settings.everyHours * 3600 * 1000).toISOString()
    }

    return {
      repo: file.settings.repo,
      repoInput: file.settings.repoInput || (file.settings.repo ? githubRepoUrl(file.settings.repo) : ''),
      repoUrl: githubRepoUrl(file.settings.repo),
      repoPrivate: file.probe?.private ?? null,
      autoUpload: file.settings.autoUpload,
      autoSync: file.settings.autoSync ?? true,
      syncPriority: file.settings.syncPriority ?? 'balanced',
      everyHours: file.settings.everyHours,
      nextSyncAt,
      includeVault: file.settings.includeVault,
      includeMemory: file.settings.includeMemory,
      includeSkills: file.settings.includeSkills,
      includeFeed: file.settings.includeFeed,
      nextUploadAt,
      lastUploadedAt: file.settings.lastUploadedAt ?? '',
      lastUploadedCommit: file.settings.lastUploadedCommit ?? '',
      lastUploadedBytes: file.settings.lastUploadedBytes ?? 0,
      lastPulledAt: file.settings.lastPulledAt ?? '',
      lastPulledCommit: file.settings.lastPulledCommit ?? '',
      localTotalBytes: sizes.totalBytes,
      localVaultBytes: sizes.vaultBytes,
      localMemoryBytes: sizes.memoryBytes,
      localSkillsBytes: sizes.skillsBytes,
      localFeedBytes: sizes.feedBytes,
      passphraseSet: passphrase.length >= WORKBENCH_SYNC_MIN_PASSPHRASE,
      tokenSet: token.length > 0,
      tokenSource,
      tokenTail: token.length > 4 ? token.slice(-4) : '',
      running: this.runningPromise !== null,
      lastStatus,
      lastError,
      history: file.settings.history,
      progress: this.currentProgress,
    }
  }

  /* ────────────────── 定时自动化 ────────────────── */

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      this.checkAutoSync().catch(() => undefined)
    }, TICK_MS)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 双向自动同步：根据本地为主/云端为主/智能双向策略自动决策流转。 */
  async syncNow(trigger: 'manual' | 'auto' = 'manual'): Promise<WorkbenchSyncRun> {
    const file = await this.ensureLoaded()
    const priority = file.settings.syncPriority ?? 'balanced'

    if (priority === 'cloud') {
      // 云端为主：优先从私库拉取最新备份
      try {
        return await this.pullNow()
      } catch (err) {
        // 若云端尚无备份包，则退回上传
        return await this.uploadNow(trigger)
      }
    }

    if (priority === 'local') {
      // 本地为主：优先将本地数据推到私库（若未变动 uploadNow 内部会自动跳过并提示）
      return await this.uploadNow(trigger)
    }

    // 平衡模式：先比对本地与远端，本地未改动时尝试拉取云端，否则上传
    const { token } = await this.resolveToken()
    if (token && file.settings.repo) {
      try {
        const { branch } = await this.probeRepo(token, file.settings.repo)
        const checkResp = await ghFetch(
          token,
          `${GITHUB_API}/repos/${file.settings.repo}/contents/${encodeURIComponent(WORKBENCH_SYNC_BLOB_PATH)}?ref=${encodeURIComponent(branch)}`,
        )
        if (checkResp.ok) {
          const checkBody = await checkResp.json() as { sha?: unknown }
          const remoteSha = typeof checkBody.sha === 'string' ? checkBody.sha : ''
          // 如果远端有了新提交而本地还停在旧版本，则拉取
          if (remoteSha !== '' && remoteSha !== file.settings.lastPulledCommit && remoteSha !== file.settings.lastUploadedCommit) {
            return await this.pullNow()
          }
        }
      } catch {}
    }

    return await this.uploadNow(trigger)
  }

  private async checkAutoSync(): Promise<void> {
    const file = await this.ensureLoaded()
    const isAuto = file.settings.autoSync || file.settings.autoUpload
    if (!isAuto || !file.settings.repo) return
    const passphrase = await this.resolvePassphrase()
    if (passphrase.length < WORKBENCH_SYNC_MIN_PASSPHRASE) return

    const lastTime = Math.max(
      file.settings.lastUploadedAt ? new Date(file.settings.lastUploadedAt).getTime() : 0,
      file.settings.lastPulledAt ? new Date(file.settings.lastPulledAt).getTime() : 0,
    )
    const dueTime = lastTime + file.settings.everyHours * 3600 * 1000
    if (Date.now() >= dueTime && this.runningPromise === null) {
      this.logger.info?.('[workbench-sync] 触发自动定时双向同步')
      await this.syncNow('auto').catch((err) => {
        this.logger.warn?.(`[workbench-sync] 自动同步失败: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
  }
}
