/**
 * dsh-vault 存储层：vault.json 的读写、记录 CRUD、变更历史、配额淘汰。
 *
 * ── 落盘布局 ────────────────────────────────────────────────────────
 *   <root>/vault.json          记录 + 场景（纯文本，几 KB 到几百 KB）
 *   <root>/store/config.json   运行时配置覆盖（面板改的配置写这里）
 *   <root>/key                 AES-256 密钥（0600）
 *   <root>/blobs/<2位>/<sha>   图片与文件字节（见 blobs.ts）
 *   <root>/blobs/index.json    blob 索引与引用计数
 *   <root>/revisions/<日期>.json 变更快照（换证、改密码的前后值）
 *   <root>/audit.jsonl         敏感字段明文查看审计
 *
 * ── 为什么记录与场景分开存、但放在同一个文件 ────────────────────────
 * 场景只有几条、记录可能几千条，但两者每次都要一起用（页面渲染必须知道
 * 场景名）。分文件就要两次读 + 两次原子写 + 两次可能的不一致；一个文件
 * 一次 rename 就同时生效，简单可靠。图片字节才必须分开（体积差三个数量级）。
 *
 * ── 内存态 + 节流回刷 ──────────────────────────────────────────────
 * 和记忆库同款：内存里是权威副本，写操作标记 dirty 后节流回刷磁盘，避免
 * 每个字段编辑都完整重写 JSON。退出时 flush。
 *
 * ── 三条不变量（改这个文件时不要破坏）──────────────────────────────
 *  1. **敏感字段落盘必加密**：写入路径统一过 encodeFieldValue，读出路径统一
 *     过 decodeFieldValue。任何绕过这两处的写入都会让明文躺到磁盘上。
 *  2. **变更历史里不出现敏感明文**：before/after 一律过 redactForHistory。
 *  3. **删除记录必须释放附件引用**：removeRecord 先摘照片与文件的 blob 引用再删记录，
 *     否则那张照片 / 那个文件会永远占着磁盘（引用计数永远不归零）。
 */

import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { BlobStore } from './blobs.js'
import type { VaultCipher } from './crypto.js'
import {
  DEFAULT_SCENES,
  DEFAULT_VAULT_CONFIG,
  MAX_CHANGES_PER_RECORD,
  MAX_FILES_PER_RECORD,
  VAULT_HOME_DIR,
  normalizeCategory,
  VAULT_MASK,
  VAULT_SCHEMA_VERSION,
  isFieldSensitive,
  isMaskedValue,
  type VaultChange,
  type VaultChangeSource,
  type VaultConfig,
  type VaultData,
  type VaultField,
  type VaultFile,
  type VaultPhoto,
  type VaultRecord,
  type VaultScene,
  type VaultStats,
} from './types.js'

/** 数据根目录（<DSH_HOME>/memories/dsh-chat-vault，与 dsh-memory 并列）。 */
export function vaultHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'memories', VAULT_HOME_DIR)
}

/** ISO 时间。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 本地日期 YYYY-MM-DD（revisions 文件名）。 */
export function localDate(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

/** 新记录 id。 */
export function newRecordId(): string {
  return 'rec_' + randomBytes(8).toString('hex')
}

/** 新照片 id。 */
export function newPhotoId(): string {
  return 'photo_' + randomBytes(8).toString('hex')
}

/** 新文件附件 id。 */
export function newFileId(): string {
  return 'file_' + randomBytes(8).toString('hex')
}

/**
 * 历史里脱敏。
 *
 * 为什么历史也要脱敏：变更历史会被**注入上下文**（「这个账户的密码上个月
 * 改过」是有用信息，密码本身不是）。历史里留明文等于绕过了「敏感值不进
 * 上下文」这条硬规矩，而且是最容易漏的一处。
 */
export function redactForHistory(field: Pick<VaultField, 'type' | 'sensitive'>, value: string): string {
  if (isFieldSensitive(field)) return value === '' ? '（空）' : '（已加密）'
  if (value.length > 80) return value.slice(0, 80) + '…'
  return value
}

/** 记录的「认人」签名：场景 + 归一化标题（自动抽取的合并判据）。 */
export function recordKeyOf(scene: string, title: string): string {
  return scene + '\u0000' + normalizeTitle(title)
}

/** 标题归一化：去空白、去常见分隔符、全角转半角、小写。 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[\s·•|/\\_\-—–~!@#$%^&*()+=[\]{};:'",.<>?]+/g, '')
    .toLowerCase()
    .trim()
}

/**
 * 档案存储。
 *
 * 生命周期：构造时**不读盘**（构造函数不能是 async，而读盘失败不该让插件
 * 挂不上）；首次访问由 ensureLoaded 惰性读。
 */
export class VaultStore {
  readonly root: string
  readonly blobs: BlobStore
  private data: VaultData | null = null
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private loading: Promise<VaultData> | null = null
  /** 构造时加载失败的说明（空串=正常）。 */
  loadWarning = ''
  /** true = 磁盘上是更新版本的 schema，本次运行只读。 */
  readOnly = false

  /** 回刷 debounce。 */
  private static readonly FLUSH_DEBOUNCE_MS = 400

  constructor(
    private cipher: VaultCipher | null,
    root = vaultHome(),
  ) {
    this.root = root
    this.blobs = new BlobStore(root)
  }

  /** 当前是否具备加密能力（页面「未加密」横幅与启动自检用）。 */
  get encrypted(): boolean {
    return this.cipher !== null
  }

  /**
   * 导出密钥字节副本（**只给备份模块用**）。
   *
   * 没有密钥（降级运行）时返回 null，让备份流程明确报「本机没有可用密钥」，
   * 而不是打出一个「看着成功、恢复后全是空串」的假备份。
   */
  exportKeyBytes(): Buffer | null {
    return this.cipher === null ? null : this.cipher.exportKey()
  }

  /**
   * 热替换密钥（恢复备份之后）。
   *
   * 恢复的备份里带着**它那台机器的密钥**，如果只是把 vault.json 覆盖过来而
   * 不换密钥，所有敏感字段都会解成空串——数据看着到了，一个都用不了。
   * 换完之后把 key 文件也落到本机，下次启动才能继续解。
   * @returns 是否换成功（备份里的密钥字节非法时 false）。
   */
  async replaceCipher(next: VaultCipher | null): Promise<boolean> {
    if (next === null) return false
    this.cipher = next
    try {
      await mkdir(this.root, { recursive: true })
      await writeFile(this.keyFile, next.exportKey(), { mode: 0o600 })
    } catch (error) {
      // 写不进密钥文件时仍然保留内存里的密码器：本次运行可用，重启后需重恢复。
      console.warn('[dsh-vault] 恢复后写入密钥文件失败：', error instanceof Error ? error.message : String(error))
    }
    return true
  }

  /** vault.json 路径。 */
  get dataFile(): string {
    return join(this.root, 'vault.json')
  }

  /** 配置覆盖文件路径。 */
  get configFile(): string {
    return join(this.root, 'store', 'config.json')
  }

  /** 审计日志路径。 */
  get auditFile(): string {
    return join(this.root, 'audit.jsonl')
  }

  /** 密钥文件路径。 */
  get keyFile(): string {
    return join(this.root, 'key')
  }

  /** 读运行时配置覆盖（缺失返回空）。 */
  async readConfigOverride(): Promise<Partial<VaultConfig>> {
    try {
      const raw = await readFile(this.configFile, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return parsed !== null && typeof parsed === 'object' ? parsed as Partial<VaultConfig> : {}
    } catch {
      return {}
    }
  }

  /** 写运行时配置覆盖。 */
  async writeConfigOverride(patch: Partial<VaultConfig>): Promise<void> {
    const current = await this.readConfigOverride()
    const next = { ...current, ...patch }
    await mkdir(join(this.root, 'store'), { recursive: true })
    await atomicWriteText(this.configFile, JSON.stringify(next, null, 2))
  }

  /* ────────────────── 加载与迁移 ────────────────── */

  /** 惰性加载（并发安全：同时只跑一次）。 */
  private async ensureLoaded(): Promise<VaultData> {
    if (this.data !== null) return this.data
    if (this.loading !== null) return this.loading
    this.loading = this.loadNow()
    try {
      this.data = await this.loading
      return this.data
    } finally {
      this.loading = null
    }
  }

  private async loadNow(): Promise<VaultData> {
    let raw: string
    try {
      raw = await readFile(this.dataFile, 'utf8')
    } catch {
      // 首次运行：写一份内置场景的空库。
      const fresh: VaultData = {
        schemaVersion: VAULT_SCHEMA_VERSION,
        records: [],
        scenes: DEFAULT_SCENES.map((scene) => ({ ...scene })),
      }
      await this.persist(fresh)
      return fresh
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // 坏文件**不覆盖**：改名留证，以空库启动并大声报错。这与记忆库
      // entries.json 的处理一致——宁可让用户看见「档案空了」，也不能
      // 用空库把可能还能救的数据覆盖掉。
      const backup = this.dataFile + '.corrupt-' + Date.now()
      await rename(this.dataFile, backup).catch(() => undefined)
      this.loadWarning = 'vault.json 无法解析，已备份为 ' + backup + '，本次以空库启动'
      const fresh: VaultData = {
        schemaVersion: VAULT_SCHEMA_VERSION,
        records: [],
        scenes: DEFAULT_SCENES.map((scene) => ({ ...scene })),
      }
      await this.persist(fresh)
      return fresh
    }
    const data = parsed as Partial<VaultData>
    const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
    if (version > VAULT_SCHEMA_VERSION) {
      // 用户降级了插件：只读，绝不写回。用不认识的形状覆盖新数据会静默丢字段。
      this.readOnly = true
      this.loadWarning = '数据结构版本 ' + String(version) + ' 高于本插件支持的 ' + String(VAULT_SCHEMA_VERSION) + '，本次只读'
      return {
        schemaVersion: version,
        records: Array.isArray(data.records) ? data.records as VaultRecord[] : [],
        scenes: Array.isArray(data.scenes) && data.scenes.length > 0 ? data.scenes as VaultScene[] : DEFAULT_SCENES.map((scene) => ({ ...scene })),
      }
    }
    const migrated = migrate({
      schemaVersion: version,
      records: Array.isArray(data.records) ? (data.records as VaultRecord[]) : [],
      scenes: Array.isArray(data.scenes) && data.scenes.length > 0
        ? (data.scenes as VaultScene[])
        : DEFAULT_SCENES.map((scene) => ({ ...scene })),
    })
    // 迁移后立刻落盘：否则每次启动都要重跑一遍迁移。
    if (migrated.schemaVersion !== version) await this.persist(migrated)
    return migrated
  }

  /** 原子写 vault.json。 */
  private async persist(data: VaultData): Promise<void> {
    if (this.readOnly) return
    await mkdir(this.root, { recursive: true })
    await atomicWriteText(this.dataFile, JSON.stringify(data))
  }

  /** 标记脏并安排回刷。 */
  private touch(): void {
    if (this.readOnly) return
    this.dirty = true
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush().catch((error) => {
        console.warn('[dsh-vault] 回刷失败：', error instanceof Error ? error.message : String(error))
      })
    }, VaultStore.FLUSH_DEBOUNCE_MS)
  }

  /** 立即回刷（退出、改动后的显式落盘）。 */
  async flush(): Promise<void> {
    if (!this.dirty || this.data === null) return
    this.dirty = false
    await this.persist(this.data)
  }

  /**
   * 直接落盘（不受 debounce 影响，供写操作确保持久化）。
   *
   * ⚠ 这里必须直接调 persist，**不能转手调 flush()**：flush 的第一行是
   * `if (!this.dirty) return`，而本方法刚把 dirty 清掉——转手就等于「清掉
   * 脏标记然后什么都不写」。曾因此让所有写操作都只停在内存里、磁盘上一直
   * 是最初那份空库（重启即全丢，且不报错，最难查的一类 bug）。
   */
  private async persistNow(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.dirty = false
    if (this.data === null) return
    await this.persist(this.data)
  }

  /* ────────────────── 加解密包装 ────────────────── */

  /**
   * 字段值 → 磁盘形态。
   *
   * 唯一入口。敏感字段在这里加密；非敏感字段原样。**缓存明文判断必须放在
   * 加密之前**——先判 isEncryptedValue 再加密，避免把已加密的值再套一层
   * （store 的 patch 路径可能把读出来的值写回去）。
   */
  private encodeFieldValue(field: Pick<VaultField, 'type' | 'sensitive'>, value: string): string {
    if (!isFieldSensitive(field)) return value
    if (this.cipher === null) return value
    return this.cipher.encrypt(value)
  }

  /** 磁盘形态 → 明文（页面/HTTP 用）。解密失败返回空串，页面据此标「无法解密」。 */
  private decodeFieldValue(field: Pick<VaultField, 'type' | 'sensitive'>, value: string): string {
    if (!isFieldSensitive(field)) return value
    if (this.cipher === null) return value
    return this.cipher.decrypt(value)
  }

  /**
   * 把一条记录转成「明文内存态」（HTTP 响应与页面用）。
   *
   * 敏感字段在这里被换成掩码 VAULT_MASK，**明文不出 store 边界**。
   * 需要真正的明文只有两条路：页面点「显示」走 /reveal 单字段取一次，
   * 或者内部（抽取、注入、导出）走明文专用方法。这样「把整库 JSON 塞进
   * 浏览器内存」这件事不再等于「明文密码全在浏览器里」。
   */
  toPlainRecord(record: VaultRecord): VaultRecord {
    return {
      ...record,
      fields: record.fields.map((field) => ({
        ...field,
        value: isFieldSensitive(field) ? VAULT_MASK : this.decodeFieldValue(field, field.value),
      })),
      photos: record.photos.map((photo) => ({ ...photo })),
      files: (record.files ?? []).map((file) => ({ ...file })),
      changes: record.changes.map((change) => ({ ...change })),
      tags: [...record.tags],
    }
  }

  /** 把一条（明文）记录转成落盘形态。 */
  private toStoredRecord(record: VaultRecord): VaultRecord {
    return {
      ...record,
      fields: record.fields.map((field) => ({
        ...field,
        value: this.encodeFieldValue(field, field.value),
      })),
    }
  }

  /* ────────────────── 读 ────────────────── */

  /** 全量明文记录（未归档优先，按 updatedAt 降序）。 */
  async listRecords(options: { includeArchived?: boolean } = {}): Promise<VaultRecord[]> {
    const data = await this.ensureLoaded()
    const subset = options.includeArchived === true
      ? data.records
      : data.records.filter((record) => record.archived !== true)
    return subset
      .map((record) => this.toPlainRecord(record))
      .sort((a, b) => {
        // 手动 order 优先，其次最近更新。
        if (a.order !== undefined || b.order !== undefined) {
          const oa = a.order ?? Number.MAX_SAFE_INTEGER
          const ob = b.order ?? Number.MAX_SAFE_INTEGER
          if (oa !== ob) return oa - ob
        }
        return b.updatedAt.localeCompare(a.updatedAt)
      })
  }

  /** 单条（明文；敏感字段已掩码）。 */
  async getRecord(id: string): Promise<VaultRecord | undefined> {
    const data = await this.ensureLoaded()
    const found = data.records.find((record) => record.id === id)
    return found === undefined ? undefined : this.toPlainRecord(found)
  }

  /**
   * 全量**真正明文**记录（敏感字段已解密）。
   *
   * 只有三个调用方该用它：抽取（要比对新旧值才知该不该写）、注入的字段摘要
   * （走 fieldSummaryOf，敏感字段照旧不输出值）、单字段 reveal。绝不要在 HTTP
   * 列表响应里用它——那等于把掩码白做了。
   */
  async listRecordsRevealed(options: { includeArchived?: boolean } = {}): Promise<VaultRecord[]> {
    const data = await this.ensureLoaded()
    const subset = options.includeArchived === true
      ? data.records
      : data.records.filter((record) => record.archived !== true)
    return subset
      .map((record) => this.toRevealedRecord(record))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** 单条真正明文（reveal 路由用）。 */
  async getRecordRevealed(id: string): Promise<VaultRecord | undefined> {
    const data = await this.ensureLoaded()
    const found = data.records.find((record) => record.id === id)
    return found === undefined ? undefined : this.toRevealedRecord(found)
  }

  /** 解密全部字段（**内部专用**，与 toPlainRecord 的差别只在不掩码）。 */
  private toRevealedRecord(record: VaultRecord): VaultRecord {
    return {
      ...record,
      fields: record.fields.map((field) => ({
        ...field,
        value: this.decodeFieldValue(field, field.value),
      })),
      photos: record.photos.map((photo) => ({ ...photo })),
      files: (record.files ?? []).map((file) => ({ ...file })),
      changes: record.changes.map((change) => ({ ...change })),
      tags: [...record.tags],
    }
  }

  /** 场景清单（保证内置场景始终存在）。 */
  async listScenes(): Promise<VaultScene[]> {
    const data = await this.ensureLoaded()
    return [...data.scenes].sort((a, b) => a.order - b.order)
  }

  /* ────────────────── 写 ────────────────── */

  /**
   * 新建或整体替换一条记录。
   *
   * 调用方给的是**明文**记录；本方法负责加密与写历史。给 id 就替换
   * （保留 createdAt 与 changes），不给就新建。
   */
  async upsertRecord(input: {
    id?: string
    scene: string
    title: string
    subtitle?: string
    /** 用途分类（缺省＝不动已有值；新建时为未分类）。 */
    category?: string
    fields: VaultField[]
    tags?: string[]
    note?: string
    source: VaultChangeSource
    /**
     * 抽取可信度（人工录入恒 1）。
     *
     * v2 起它只是溯源信息，不影响可见性：原来「低可信度挂 pending 等确认」
     * 的那层含义随待确认机制一起删了。
     */
    confidence?: number
    provenance?: { sessionId?: string; turn?: number }
  }): Promise<VaultRecord> {
    const data = await this.ensureLoaded()
    const now = nowIso()
    const existing = input.id === undefined ? undefined : data.records.find((record) => record.id === input.id)
    if (existing === undefined) {
      const record: VaultRecord = {
        id: input.id ?? newRecordId(),
        scene: input.scene,
        title: input.title.trim(),
        subtitle: input.subtitle,
        ...(normalizeCategory(input.category) !== '' ? { category: normalizeCategory(input.category) } : {}),
        fields: input.fields.map((field) => this.prepareField(field, now, true)),
        photos: [],
        files: [],
        tags: input.tags ?? [],
        note: input.note,
        createdAt: now,
        updatedAt: now,
        source: input.source,
        confidence: input.confidence ?? (input.source === 'manual' ? 1 : 0.7),
        version: 1,
        changes: [{
          at: now,
          action: 'create',
          source: input.source,
          after: input.title,
        }],
        provenance: input.provenance,
      }
      data.records.push(this.toStoredRecord(record))
      this.touch()
      await this.persistNow()
      return this.toPlainRecord(record)
    }
    // 替换路径：字段级差异写历史（这是「自动更新」的主战场）。
    // diff 必须拿**真正明文**比：toPlainRecord 出去的是掩码，拿它比会让每个
    // 敏感字段都被判成「变了」，每次保存都平白记一堆假变更。
    const revealed = this.toRevealedRecord(existing)
    // 掩码还原：页面拿到的敏感值是 VAULT_MASK，用户没改就原样提交回来。
    // 不还原会把一串星号写成新密码（而且不可逆——真实值被覆盖掉了）。
    const resolved = this.restoreMaskedFields(revealed, input.fields)
    const changes = diffFields(revealed, { fields: resolved }, now, input.source)
  // 分类变化单独记一条：它不在 fields 里，走不到 diffFields。用 'scene-move' 之外
  // 的动作名会污染历史枚举，所以复用 'title-update' 的形状不成立——这里新增的是
  // 一个纯元数据变更，用 'field-update' 会让人以为多了个字段。直接复用
  // 'scene-move' 的语义（都属于「这条记录归到哪儿」）并带上 before/after。
  const nextCategory = input.category === undefined
    ? normalizeCategory(existing.category)
    : normalizeCategory(input.category)
  const beforeCategory = normalizeCategory(existing.category)
  if (nextCategory !== beforeCategory) {
    changes.push({
      at: now,
      action: 'scene-move',
      before: beforeCategory,
      after: nextCategory,
      source: input.source,
    })
  }
    const updated: VaultRecord = {
      ...existing,
      scene: input.scene,
      title: input.title.trim(),
      subtitle: input.subtitle,
      // 缺省（undefined）= 这次调用没提分类 → 保留原值，不要清空。
      // 显式传空串才等于「取消分类」。
      ...(input.category === undefined
        ? {}
        : { category: normalizeCategory(input.category) }),
      fields: resolved.map((field) => this.prepareField(field, now, false)),
      tags: input.tags ?? existing.tags,
      note: input.note ?? existing.note,
      updatedAt: now,
      source: input.source,
      confidence: input.confidence ?? existing.confidence,
      version: existing.version + 1,
      changes: appendChanges(existing.changes, changes),
    }
    data.records[data.records.indexOf(existing)] = this.toStoredRecord(updated)
    this.touch()
    await this.persistNow()
    return this.toPlainRecord(updated)
  }

  /**
   * 就地更新单个字段（**自动更新的最小操作单元**）。
   *
   * 为什么单独开一个方法而不是走 upsertRecord：模型报「密码变了」时只该改
   * 那一个字段，其余字段（尤其是它没提到的）必须原样保留。走整体替换等于
   * 把「模型这次没提到」的字段当成「用户要删掉」，这是数据事故。
   */
  async patchField(input: {
    id: string
    key: string
    value: string
    label?: string
    type?: VaultField['type']
    sensitive?: boolean
    source?: VaultChangeSource
  }): Promise<VaultRecord | undefined> {
    const data = await this.ensureLoaded()
    const record = data.records.find((item) => item.id === input.id)
    if (record === undefined) return undefined
    // 变更历史里的 before 必须是**真正明文**（脱敏在 redactForHistory 里做），
    // 否则非敏感字段的历史会记成掩码串，等于把历史写坏了。
    const plain = this.toRevealedRecord(record)
    const now = nowIso()
    const index = record.fields.findIndex((field) => field.key === input.key)
    const source = input.source ?? 'manual'
    // 掩码＝未改动：单字段更新若收到掩码，说明调用方（页面表单）没动它，
    // 直接返回原值，不要拿一串星号覆盖真实密码。
    if (isMaskedValue(input.value) && index !== -1) {
      return this.toPlainRecord(record)
    }
    let change: VaultChange
    if (index === -1) {
      const field = this.prepareField({
        key: input.key,
        label: input.label ?? input.key,
        type: input.type ?? 'text',
        sensitive: input.sensitive,
        value: input.value,
        updatedAt: now,
      }, now, true)
      record.fields.push(field)
      change = { at: now, action: 'field-add', fieldKey: input.key, after: redactForHistory(field, input.value), source }
    } else {
      const stored = record.fields[index]
      const beforePlain = plain.fields[index]
      const label = input.label ?? stored.label
      const type = input.type ?? stored.type
      const sensitive = input.sensitive ?? stored.sensitive
      record.fields[index] = {
        ...stored,
        label,
        type,
        sensitive,
        value: this.encodeFieldValue({ type, sensitive }, input.value),
        updatedAt: now,
      }
      change = {
        at: now,
        action: 'field-update',
        fieldKey: input.key,
        before: redactForHistory(beforePlain, beforePlain.value),
        after: redactForHistory({ type, sensitive }, input.value),
        source,
      }
    }
    record.updatedAt = now
    record.version += 1
    record.changes = appendChanges(record.changes, [change])
    // 这里原先有一个空 if（source === 'extract' 时什么都不做，只留一句注释说
    // 「挂不挂 pending 由 extract 层决定」，配一个 soft 形参用来压掉它）。待确认
    // 机制退役后这个空壳连壳都没意义了：store 只负责把事实写下来，
    // 「改了要不要人确认」已经不是一个问题。soft 形参一并删掉（没有任何调用方
    // 传过它）。
    this.touch()
    await this.persistNow()
    return this.toPlainRecord(record)
  }

  /**
   * 把提交上来的掩码字段还原成既有明文。
   *
   * 只对**既有记录里同 key 且原值非空**的字段生效：新字段带掩码没有原值可
   * 还原，交给 prepareField 正常编码（等于用户清空了它）。
   */
  private restoreMaskedFields(existing: VaultRecord, fields: VaultField[]): VaultField[] {
    const before = new Map(existing.fields.map((field) => [field.key, field]))
    return fields.map((field) => {
      if (!isMaskedValue(field.value)) return field
      const original = before.get(field.key)
      if (original === undefined) return { ...field, value: '' }
      return { ...field, value: original.value }
    })
  }

  /** 字段准备：补默认值、加时间戳、把值编码成落盘形态。 */
  private prepareField(field: VaultField, now: string, isNew: boolean): VaultField {
    const type = field.type ?? 'text'
    const sensitive = field.sensitive
    return {
      key: field.key.trim(),
      label: (field.label ?? field.key).trim() || field.key,
      type,
      ...(sensitive === true ? { sensitive: true as const } : {}),
      value: this.encodeFieldValue({ type, sensitive }, field.value ?? ''),
      updatedAt: field.updatedAt ?? now,
      ...(field.unit !== undefined ? { unit: field.unit } : {}),
      ...(field.inSummary !== undefined ? { inSummary: field.inSummary } : {}),
      ...(isNew ? {} : {}),
    }
  }

  /** 删除一条记录（**先释放图片引用**）。 */
  async removeRecord(id: string): Promise<boolean> {
    const data = await this.ensureLoaded()
    const index = data.records.findIndex((record) => record.id === id)
    if (index === -1) return false
    const record = data.records[index]
    for (const photo of record.photos) {
      await this.releasePhotoBlobs(photo)
    }
    for (const file of record.files ?? []) {
      await this.blobs.release(file.sha256, file.id).catch(() => false)
    }
    data.records.splice(index, 1)
    this.touch()
    await this.persistNow()
    return true
  }

  /** 归档 / 恢复（软删，保留数据与历史）。 */
  async setArchived(id: string, archived: boolean): Promise<VaultRecord | undefined> {
    const data = await this.ensureLoaded()
    const record = data.records.find((item) => item.id === id)
    if (record === undefined) return undefined
    record.archived = archived
    record.updatedAt = nowIso()
    record.version += 1
    record.changes = appendChanges(record.changes, [{
      at: record.updatedAt,
      action: archived ? 'archive' : 'restore',
      source: 'manual',
    }])
    this.touch()
    await this.persistNow()
    return this.toPlainRecord(record)
  }

  // 这里原有 setPending(id, pending)（确认 = 清标记，驳回 = 删记录，路由
  // POST /confirm 调它）。用户 2026-10-27 明确要求档案不需要确认，抽取结果直接
  // 生效，于是「确认」这个动作整体不存在了，方法连同路由一起删。老库里残留的
  // pending 标记由 migrate 的 v1→v2 清掉（见文件末尾 migrate）。

  /** 记录一次「打开过」（配额淘汰的 LRU 依据）。 */
  async markOpened(id: string): Promise<void> {
    const data = await this.ensureLoaded()
    const record = data.records.find((item) => item.id === id)
    if (record === undefined) return
    record.lastOpenedAt = nowIso()
    this.touch()
  }

  /* ────────────────── 照片 ────────────────── */

  /**
   * 把照片各档的引用计数登记到本照片名下。
   *
   * 为什么需要这一步：上传流程是「先按 sha 存字节（此时还没有 photoId）→
   * 再生成 photoId 挂到记录上」。put 用的是首次写入方的 id，同字节复用时
   * 第二个引用方必须补登，否则它删掉自己的照片时会把别人还在用的 blob
   * 减到 0 引用删掉。所以这里对每一档都显式 claim 一次（claim 内部判重）。
   */
  private async claimBlobRefs(photo: VaultPhoto): Promise<void> {
    for (const variant of ['thumb', 'display', 'original'] as const) {
      const ref = photo.blobs[variant]
      if (ref === undefined) continue
      await this.blobs.claim(ref.sha256, photo.id).catch(() => false)
    }
  }

  /**
   * 一步式上传：存字节 + 建照片（**路由层唯一该调的方法**）。
   *
   * 分两步（先 put 再 addPhoto）会让路由层自己拼 photoId，而 put 需要的
   * photoId 与最终照片的 photoId 必须是同一个——否则引用计数从第一天起就
   * 是错的，删记录时照片永远删不掉。所以把两件事收在一个方法里。
   * @returns 更新后的记录；照片全档都存失败（比如不是图片）时返回 null。
   */
  async attachPhoto(input: {
    recordId: string
    role: string
    label: string
    fieldKey?: string
    variants: Array<{ variant: 'thumb' | 'display' | 'original'; data: Buffer; width: number; height: number }>
    source?: VaultChangeSource
  }): Promise<VaultRecord | null> {
    const data = await this.ensureLoaded()
    const record = data.records.find((item) => item.id === input.recordId)
    if (record === undefined) return null
    const photoId = newPhotoId()
    const blobs: VaultPhoto['blobs'] = { display: { sha256: '', mediaType: 'image/jpeg', width: 0, height: 0, bytes: 0 } }
    let stored = 0
    for (const item of input.variants) {
      const ref = await this.blobs.put(item.data, {
        width: item.width,
        height: item.height,
        name: input.label,
        photoId,
      })
      if (ref === null) continue
      blobs[item.variant] = ref
      stored += 1
    }
    // display 是必有档：一档都没存成（不是图片/超限）就不建照片。
    if (stored === 0 || blobs.display.sha256 === '') {
      // 清掉可能已写入的 thumb/original 引用，别留下无主的字节。
      for (const variant of ['thumb', 'display', 'original'] as const) {
        const ref = blobs[variant]
        if (ref !== undefined && ref.sha256 !== '') await this.blobs.release(ref.sha256, photoId).catch(() => false)
      }
      return null
    }
    const now = nowIso()
    const photo: VaultPhoto = {
      id: photoId,
      role: input.role,
      label: input.label,
      ...(input.fieldKey !== undefined ? { fieldKey: input.fieldKey } : {}),
      blobs,
      createdAt: now,
    }
    record.photos.push(photo)
    record.updatedAt = now
    record.version += 1
    record.changes = appendChanges(record.changes, [{
      at: now,
      action: 'photo-add',
      source: input.source ?? 'manual',
      after: photo.label,
    }])
    this.touch()
    await this.persistNow()
    return this.toPlainRecord(record)
  }

  /** 删除一张照片并释放引用。 */
  async removePhoto(id: string, photoId: string): Promise<VaultRecord | undefined> {
    const data = await this.ensureLoaded()
    const record = data.records.find((item) => item.id === id)
    if (record === undefined) return undefined
    const index = record.photos.findIndex((photo) => photo.id === photoId)
    if (index === -1) return undefined
    const photo = record.photos[index]
    await this.releasePhotoBlobs(photo)
    record.photos.splice(index, 1)
    record.updatedAt = nowIso()
    record.version += 1
    record.changes = appendChanges(record.changes, [{
      at: record.updatedAt,
      action: 'photo-remove',
      source: 'manual',
      before: photo.label,
    }])
    this.touch()
    await this.persistNow()
    return this.toPlainRecord(record)
  }

  /** 释放一张照片各档的 blob 引用（引用归零时删文件）。 */
  private async releasePhotoBlobs(photo: VaultPhoto): Promise<void> {
    const seen = new Set<string>()
    for (const variant of ['thumb', 'display', 'original'] as const) {
      const ref = photo.blobs[variant]
      if (ref === undefined) continue
      if (seen.has(ref.sha256)) continue
      seen.add(ref.sha256)
      await this.blobs.release(ref.sha256, photo.id).catch(() => false)
    }
  }

  /* ────────────────── 文件附件 ────────────────── */

  /**
   * 挂一个文件附件到记录上（**路由层唯一该调的方法**）。
   *
   * 与照片一样是「一步式」：先按 sha 存字节，再用同一个 fileId 登记引用。
   * 分两步会让 put 里的 refId 与最终 file.id 不一致，删文件时引用永远清不掉。
   * @returns 更新后的记录；文件为空 / 超限 / 记录不存在时返回 null。
   */
  async attachFile(input: {
    recordId: string
    name: string
    mimeType: string
    data: Buffer
    label?: string
    source?: VaultChangeSource
  }): Promise<VaultRecord | null> {
    const data = await this.ensureLoaded()
    const record = data.records.find((item) => item.id === input.recordId)
    if (record === undefined) return null
    if (!Array.isArray(record.files)) record.files = []
    if (record.files.length >= MAX_FILES_PER_RECORD) return null
    const fileId = newFileId()
    const ref = await this.blobs.putRaw(input.data, {
      mediaType: input.mimeType,
      name: input.name,
      refId: fileId,
    })
    if (ref === null) return null
    const now = nowIso()
    const file: VaultFile = {
      id: fileId,
      name: input.name,
      mimeType: ref.mediaType,
      bytes: ref.bytes,
      sha256: ref.sha256,
      createdAt: now,
      ...(input.label !== undefined && input.label.trim() !== '' ? { label: input.label.trim() } : {}),
    }
    record.files.push(file)
    record.updatedAt = now
    record.version += 1
    record.changes = appendChanges(record.changes, [{
      at: now,
      action: 'file-add',
      source: input.source ?? 'manual',
      after: file.name,
    }])
    this.touch()
    await this.persistNow()
    return this.toPlainRecord(record)
  }

  /** 删除一个文件附件并释放 blob 引用。 */
  async removeFile(id: string, fileId: string): Promise<VaultRecord | undefined> {
    const data = await this.ensureLoaded()
    const record = data.records.find((item) => item.id === id)
    if (record === undefined) return undefined
    if (!Array.isArray(record.files)) record.files = []
    const index = record.files.findIndex((file) => file.id === fileId)
    if (index === -1) return undefined
    const file = record.files[index]
    await this.blobs.release(file.sha256, file.id).catch(() => false)
    record.files.splice(index, 1)
    record.updatedAt = nowIso()
    record.version += 1
    record.changes = appendChanges(record.changes, [{
      at: record.updatedAt,
      action: 'file-remove',
      source: 'manual',
      before: file.name,
    }])
    this.touch()
    await this.persistNow()
    return this.toPlainRecord(record)
  }

  /* ────────────────── 统计与配额 ────────────────── */

  /** 占用统计。 */
  async stats(): Promise<VaultStats> {
    const data = await this.ensureLoaded()
    const snapshot = await this.blobs.snapshot()
    const byVariant: VaultStats['byVariant'] = {
      thumb: { count: 0, bytes: 0 },
      display: { count: 0, bytes: 0 },
      original: { count: 0, bytes: 0 },
    }
    let photos = 0
    let files = 0
    let fileBytes = 0
    const seenSha = new Set<string>()
    const seenFileSha = new Set<string>()
    for (const record of data.records) {
      for (const photo of record.photos) {
        photos += 1
        for (const variant of ['thumb', 'display', 'original'] as const) {
          const ref = photo.blobs[variant]
          if (ref === undefined) continue
          // 去重统计：同一个 sha 在多张照片里复用时只算一次（真实磁盘占用）。
          if (seenSha.has(ref.sha256)) {
            byVariant[variant].count += 1
            continue
          }
          seenSha.add(ref.sha256)
          byVariant[variant].count += 1
          byVariant[variant].bytes += ref.bytes
        }
      }
      for (const file of record.files ?? []) {
        files += 1
        if (seenFileSha.has(file.sha256)) continue
        seenFileSha.add(file.sha256)
        fileBytes += file.bytes
      }
    }
    return {
      records: data.records.length,
      photos,
      files,
      blobBytes: snapshot.reduce((sum, item) => sum + item.bytes, 0),
      fileBytes,
      byVariant,
      computedAt: nowIso(),
    }
  }

  /**
   * 配额淘汰：超限时按 original → display → thumb 的顺序删图片字节。
   *
   * **绝不删记录文本**：行与字段是用户真实数据，图片只是佐证。为了腾
   * 几十 MB 删掉一条档案是数据事故。
   * @param quotaBytes 配额（0 = 不淘汰）。
   * @returns 淘汰结果。
   */
  async enforceQuota(quotaBytes: number): Promise<{ evicted: number; freedBytes: number }> {
    const data = await this.ensureLoaded()
    if (quotaBytes <= 0) return { evicted: 0, freedBytes: 0 }
    const snapshot = await this.blobs.snapshot()
    let total = snapshot.reduce((sum, item) => sum + item.bytes, 0)
    if (total <= quotaBytes) return { evicted: 0, freedBytes: 0 }
    // 候选：把所有照片的档位摊平，按淘汰优先级 + 最近读取时间排序。
    interface Candidate { recordIndex: number; photoIndex: number; variant: 'thumb' | 'display' | 'original'; sha256: string; bytes: number; lastReadAt: string }
    const candidates: Candidate[] = []
    const readAt = new Map(snapshot.map((item) => [item.sha256, item.lastReadAt ?? '']))
    for (let ri = 0; ri < data.records.length; ri += 1) {
      for (let pi = 0; pi < data.records[ri].photos.length; pi += 1) {
        const photo = data.records[ri].photos[pi]
        for (const variant of ['original', 'display', 'thumb'] as const) {
          const ref = photo.blobs[variant]
          if (ref === undefined) continue
          candidates.push({
            recordIndex: ri,
            photoIndex: pi,
            variant,
            sha256: ref.sha256,
            bytes: ref.bytes,
            lastReadAt: readAt.get(ref.sha256) ?? '',
          })
        }
      }
    }
    candidates.sort((a, b) => {
      const rank = variantRank(a.variant) - variantRank(b.variant)
      if (rank !== 0) return rank
      // 同一档位内：最久没读过的先走（LRU），空串（从未读）最优先。
      return a.lastReadAt.localeCompare(b.lastReadAt)
    })
    let evicted = 0
    let freedBytes = 0
    const droppedSha = new Set<string>()
    for (const candidate of candidates) {
      if (total <= quotaBytes) break
      // 缩略图留着：删掉缩略图后列表行就没图了，视觉代价远大于它省下的几十 KB。
      // 所以最后兜底只删到 display 为止；真连 display 都删完还超配额，说明
      // 配额设得离谱小，此时保留最后一张缩略图并停止（不为了配额把页面弄空）。
      const photo = data.records[candidate.recordIndex].photos[candidate.photoIndex]
      if (candidate.variant === 'original') {
        delete photo.blobs.original
      } else if (candidate.variant === 'display') {
        // display 是详情页看大图用的；删它意味着这张照片只剩缩略图。
        // 只有原图与所有 display 都淘汰完还超配额才走到这里。
        // display 在类型上是必填档，所以用「指向空 sha」表达已淘汰（而不是
        // delete 掉字段）——页面按 sha 为空来判断「大图不可用」。
        photo.blobs.display = { sha256: '', mediaType: 'image/jpeg', width: 0, height: 0, bytes: 0 }
      } else {
        // 缩略图是最后防线：到这里就停，不再继续删。
        continue
      }
      if (!droppedSha.has(candidate.sha256)) {
        droppedSha.add(candidate.sha256)
        // 同一 sha 可能被多条记录引用：只有引用全清才真删文件。
        const stillReferenced = data.records.some((record) =>
          record.photos.some((p) => p.blobs.thumb?.sha256 === candidate.sha256
            || p.blobs.display?.sha256 === candidate.sha256
            || p.blobs.original?.sha256 === candidate.sha256))
        if (!stillReferenced) await this.blobs.drop(candidate.sha256).catch(() => undefined)
      }
      evicted += 1
      freedBytes += candidate.bytes
      total -= candidate.bytes
    }
    if (evicted > 0) {
      this.touch()
      await this.persistNow()
    }
    return { evicted, freedBytes }
  }

  /* ────────────────── 审计 ────────────────── */

  /** 记一条明文查看审计（谁在什么时候看了哪个字段）。 */
  async appendAudit(entry: { recordId: string; fieldKey: string; via: string }): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true })
      const line = JSON.stringify({ at: nowIso(), ...entry }) + '\n'
      await appendFile(this.auditFile, line, 'utf8')
    } catch {
      // 审计写不进去不影响查看（否则一次磁盘故障就让用户看不到自己的密码）。
    }
  }

  /** 读审计（最近 N 条）。 */
  async readAudit(limit = 100): Promise<Array<{ at: string; recordId: string; fieldKey: string; via: string }>> {
    try {
      const raw = await readFile(this.auditFile, 'utf8')
      const lines = raw.split('\n').filter((line) => line.trim() !== '')
      return lines.slice(-Math.max(1, limit)).reverse().map((line) => {
        try {
          return JSON.parse(line) as { at: string; recordId: string; fieldKey: string; via: string }
        } catch {
          return null
        }
      }).filter((item): item is { at: string; recordId: string; fieldKey: string; via: string } => item !== null)
    } catch {
      return []
    }
  }

  /* ────────────────── 场景 CRUD ────────────────── */

  /** 新建或更新场景（内置场景只允许改名/改描述/改顺序）。 */
  async upsertScene(scene: VaultScene): Promise<VaultScene[]> {
    const data = await this.ensureLoaded()
    const index = data.scenes.findIndex((item) => item.id === scene.id)
    if (index === -1) {
      data.scenes.push({ ...scene, builtin: false })
    } else {
      const existing = data.scenes[index]
      data.scenes[index] = {
        ...existing,
        label: scene.label.trim() || existing.label,
        desc: scene.desc ?? existing.desc,
        order: scene.order ?? existing.order,
        // 内置场景的 id 与 builtin 标记不可改（删掉会让抽取归集失去落点）。
        fieldTemplate: existing.builtin ? existing.fieldTemplate : (scene.fieldTemplate ?? existing.fieldTemplate),
        ...(scene.photoFirst !== undefined ? { photoFirst: scene.photoFirst } : {}),
      }
    }
    this.touch()
    await this.persistNow()
    return this.listScenes()
  }

  /** 删除自定义场景（内置不可删；场景下还有记录时拒绝）。 */
  async removeScene(id: string): Promise<{ ok: boolean; error?: string; scenes?: VaultScene[] }> {
    const data = await this.ensureLoaded()
    const scene = data.scenes.find((item) => item.id === id)
    if (scene === undefined) return { ok: false, error: '场景不存在' }
    if (scene.builtin) return { ok: false, error: '内置场景不能删除，只能改名' }
    const count = data.records.filter((record) => record.scene === id).length
    if (count > 0) return { ok: false, error: '该场景下还有 ' + String(count) + ' 条记录，请先移走或删除' }
    data.scenes = data.scenes.filter((item) => item.id !== id)
    this.touch()
    await this.persistNow()
    return { ok: true, scenes: await this.listScenes() }
  }

  /* ────────────────── 变更快照 ────────────────── */

  /** 写一份当日快照（每天最多一份，覆盖写；用于「回到昨天」）。 */
  async writeDailySnapshot(): Promise<void> {
    if (this.readOnly) return
    const data = await this.ensureLoaded()
    try {
      await mkdir(join(this.root, 'revisions'), { recursive: true })
      const file = join(this.root, 'revisions', localDate() + '.json')
      await atomicWriteText(file, JSON.stringify({ schemaVersion: data.schemaVersion, records: data.records, scenes: data.scenes }))
    } catch (error) {
      console.warn('[dsh-vault] 快照写入失败：', error instanceof Error ? error.message : String(error))
    }
  }

  /** 已有快照日期（新到旧）。 */
  async listSnapshots(): Promise<string[]> {
    try {
      const { readdir } = await import('node:fs/promises')
      const files = await readdir(join(this.root, 'revisions'))
      return files.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort().reverse()
    } catch {
      return []
    }
  }

  /* ────────────────── 备份导出 / 导入 ────────────────── */

  /**
   * 导出**落盘形态**的全库（敏感字段仍是密文）。
   *
   * 刻意不导出明文：导出的文件是给用户丢进网盘/移动硬盘的备份，明文备份
   * 等于把加密白做了。密钥在 <root>/key，另行保管（丢了密钥这份备份读不出
   * 密码，但记录标题与普通字段仍然可读，不会变成一堆废数据）。
   */
  async exportRaw(): Promise<string> {
    const data = await this.ensureLoaded()
    return JSON.stringify({
      schemaVersion: data.schemaVersion,
      exportedAt: nowIso(),
      records: data.records,
      scenes: data.scenes,
    }, null, 2)
  }

  /**
   * 用外部数据整体替换（导入备份）。
   *
   * 传入的字段值先过 encodeFieldValue：密文形态幂等（encryptSecret 见到
   * secret:v1: 前缀原样返回），明文形态被正常加密。于是「手改过的 JSON 导出
   * 文件」导入回来也不会把明文写进磁盘。
   * @returns 导入后的条数统计。
   */
  async replaceAll(input: { records: VaultRecord[]; scenes?: VaultScene[] }): Promise<{ records: number; scenes: number }> {
    if (this.readOnly) throw new Error('当前为只读模式（数据结构版本过新），无法导入')
    const data = await this.ensureLoaded()
    // 备份可能来自 v1 时代（记录上带着 pending、也没有 files）。先清标记、补
    // 文件数组再落盘：这里之后 schemaVersion 会被直接写成当前版本，migrate
    // 不会再有机会补默认值。
    const records = input.records.map((record) => {
      const stored = this.toStoredRecord(record)
      if (!Array.isArray(stored.files)) stored.files = []
      return stored
    })
    stripPendingFlag(records)
    const scenes = Array.isArray(input.scenes) && input.scenes.length > 0
      ? input.scenes.map((scene) => ({ ...scene }))
      : DEFAULT_SCENES.map((scene) => ({ ...scene }))
    // 保留内置场景：备份文件里缺了内置场景时补回来（否则抽取归集没有落点）。
    for (const builtin of DEFAULT_SCENES) {
      if (!scenes.some((scene) => scene.id === builtin.id)) scenes.push({ ...builtin })
    }
    data.records = records
    data.scenes = scenes
    data.schemaVersion = VAULT_SCHEMA_VERSION
    this.touch()
    await this.persistNow()
    return { records: data.records.length, scenes: data.scenes.length }
  }
}

/** 变体淘汰优先级。 */
function variantRank(variant: 'thumb' | 'display' | 'original'): number {
  if (variant === 'original') return 0
  if (variant === 'display') return 1
  return 2
}

/** 字段级差异（upsert 替换路径写历史用）。 */
function diffFields(
  existing: VaultRecord,
  input: { fields: VaultField[] },
  now: string,
  source: VaultChangeSource,
): VaultChange[] {
  const changes: VaultChange[] = []
  const existingByKey = new Map(existing.fields.map((field) => [field.key, field]))
  for (const field of input.fields) {
    const before = existingByKey.get(field.key)
    if (before === undefined) {
      changes.push({ at: now, action: 'field-add', fieldKey: field.key, after: redactForHistory(field, field.value), source })
      continue
    }
    if (before.value !== field.value) {
      changes.push({
        at: now,
        action: 'field-update',
        fieldKey: field.key,
        before: redactForHistory(before, before.value),
        after: redactForHistory(field, field.value),
        source,
      })
    }
  }
  const inputKeys = new Set(input.fields.map((field) => field.key))
  for (const field of existing.fields) {
    if (!inputKeys.has(field.key)) {
      changes.push({ at: now, action: 'field-remove', fieldKey: field.key, before: redactForHistory(field, field.value), source })
    }
  }
  return changes
}

/** 追加变更并截断到上限。 */
function appendChanges(current: VaultChange[], next: VaultChange[]): VaultChange[] {
  const merged = [...current, ...next]
  return merged.length <= MAX_CHANGES_PER_RECORD
    ? merged
    : merged.slice(merged.length - MAX_CHANGES_PER_RECORD)
}

/**
 * 清掉 v1 时代遗留的 pending 标记（v2 起记录上根本没有这个字段）。
 *
 * 两个入口都要它，少一个就会漏：
 *  1. migrate 的 v1→v2 一级 —— 老库升级时清理；
 *  2. replaceAll（导入备份）—— 备份文件可能来自 v1 时代的机器，里面每条挂过
 *     待确认的记录都带着 pending。而 replaceAll 会把 schemaVersion 直接写成当前
 *     版本，于是下次启动 migrate 认为「已经是 v2、无需迁移」，标记就永久留在库里
 *     了（任何代码都不再读它，但导出的 JSON 与备份里会一直带着这个僵尸字段）。
 *
 * 用 'pending' in record 判一次再删：老库里绝大多数记录本来就没有这个键，
 * 无脑 delete 也能工作，但这个判断让「真的删掉了什么」在调试与测试里可观测。
 */
function stripPendingFlag(records: VaultRecord[]): void {
  for (const record of records) {
    if ('pending' in record) delete (record as unknown as { pending?: boolean }).pending
  }
}

/** 逐级迁移（老数据 → 当前版本）。 */
export function migrate(data: VaultData): VaultData {
  const next: VaultData = {
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 1,
    records: Array.isArray(data.records) ? data.records : [],
    scenes: Array.isArray(data.scenes) && data.scenes.length > 0 ? data.scenes : DEFAULT_SCENES.map((scene) => ({ ...scene })),
  }
  // 逐级迁移：以后加版本时在这里补 if (from < N) { ... } 并把 schemaVersion 抬到 N。
  // 顺序是「先按版本改形状，再统一补默认值」（下面那个循环对新老数据都适用）。
  const from = next.schemaVersion
  //
  // v1 → v2（2026-10-27）：退役「待确认（pending）」机制。
  // 必须**主动删掉记录上的 pending 字段**，不能只是从此不再写它：老库里已经挂
  // 着的记录会永远带着这个标记，而页面上的确认入口已经整块拆掉——用户看到一条
  // 「待确认」却没有任何地方能确认，那就是个永久挂着的假状态。删标记＝把它当作
  // 已生效，这正是用户要的语义（自动抽取的结果直接生效，历史上抽的同样算数）。
  if (from < 2) {
    stripPendingFlag(next.records)
    next.schemaVersion = 2
  }
  //
  // v2 → v3（2026-10-27）：记录新增 category（用途分类）。
  // **只补默认值、不猜内容**：分类是用户语义，从标题里猜「阿里云」属于哪个用途
  // 会猜错，而猜错的分类比没有分类更误导（用户会照着错的标签去找东西）。所以
  // 老记录一律落成「未分类」，由用户或模型下一次写入时补上。
  if (from < 3) {
    for (const record of next.records) {
      if (typeof record.category !== 'string') record.category = ''
    }
    next.schemaVersion = 3
  }
  //
  // v3 → v4（2026-10-29）：记录新增 files（任意文件附件）。
  // 只补空数组：文件字节在 blobs 树里，记录只引用；老记录没有附件，不做猜测。
  if (from < 4) {
    for (const record of next.records) {
      if (!Array.isArray(record.files)) record.files = []
    }
    next.schemaVersion = 4
  }
  for (const record of next.records) {
    // 防御性补齐老数据可能缺的字段（不会丢内容，只是补默认）。
    if (!Array.isArray(record.fields)) record.fields = []
    if (!Array.isArray(record.photos)) record.photos = []
    if (!Array.isArray(record.files)) record.files = []
    if (!Array.isArray(record.tags)) record.tags = []
    if (!Array.isArray(record.changes)) record.changes = []
    if (typeof record.version !== 'number') record.version = 1
    if (typeof record.confidence !== 'number') record.confidence = 1
    if (typeof record.source !== 'string') record.source = 'manual'
    // 分类的归一化兜底：手改过的 vault.json 里可能带换行或超长值。
    if (typeof record.category !== 'string') record.category = ''
    else record.category = normalizeCategory(record.category)
  }
  // 内置场景补齐：升级后新增的内置场景要出现在老库里。
  const ids = new Set(next.scenes.map((scene) => scene.id))
  for (const scene of DEFAULT_SCENES) {
    if (!ids.has(scene.id)) next.scenes.push({ ...scene })
  }
  // 已有内置场景补齐**新增字段**（categories 等）：上面那个循环只处理「场景不存在」，
  // 而老库里的 accounts / email 早就存在了，于是它们身上永远缺 categories——页面下拉
  // 是空的、抽取也不知道该复用哪些词。字段级补齐必须按「这条内置场景已存在但缺这个键」
  // 再走一遍，而不是只按 id 判存在。
  //
  // 只补**缺的键**，不覆盖用户改过的值：用户可以把「账号密码」改名为「登录凭据」，
  // 那不该被每一次启动都冲回去。label / desc / order 同理。
  const builtinById = new Map(DEFAULT_SCENES.map((scene) => [scene.id, scene]))
  for (const scene of next.scenes) {
    const builtin = builtinById.get(scene.id)
    if (builtin === undefined) continue
    if (!Array.isArray(scene.categories)) scene.categories = [...(builtin.categories ?? [])]
    if (!Array.isArray(scene.fieldTemplate)) scene.fieldTemplate = builtin.fieldTemplate.map((item) => ({ ...item }))
  }
  next.schemaVersion = VAULT_SCHEMA_VERSION
  return next
}

/** 原子写文本（tmp + rename）。 */
export async function atomicWriteText(file: string, content: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

/**
 * 默认配置合并（读 config.json 覆盖 + cordis 配置，后者优先）。
 *
 * 注意这里按**键名**照搬 persisted 里的每一项，所以老机器上的 config.json 里若还
 * 残留着 v1 时代的 trustAutoUpdates，它仍会被搬进内存配置对象。这不算问题：v2 起
 * 没有任何读取方会去读那个键（抽取不再看配置），面板侧的 publicVaultConfig 也按
 * 白名单逐项取值、不会把它回吐给页面，下一次保存配置时它自然被覆盖掉。
 * 刻意不在这里做「删未知键」的清洗——清洗会掩盖将来真正的配置键拼写错误。
 */
export function resolveVaultConfig(
  input: Partial<VaultConfig> | undefined,
  persisted: Partial<VaultConfig> | undefined,
): VaultConfig {
  const config: VaultConfig = { ...DEFAULT_VAULT_CONFIG }
  if (persisted !== undefined) {
    for (const key of Object.keys(persisted) as Array<keyof VaultConfig>) {
      const value = persisted[key]
      if (value !== undefined) (config as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (input !== undefined) {
    for (const key of Object.keys(input) as Array<keyof VaultConfig>) {
      const value = input[key]
      if (value !== undefined) (config as unknown as Record<string, unknown>)[key] = value
    }
  }
  return config
}
