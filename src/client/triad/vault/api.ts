/**
 * dsh-vault 客户端 API 包装（浏览器半身）。
 *
 * ── 这一层负责什么 ───────────────────────────────────────────────────
 * 只做三件事：拼 URL、解析 { ok, ... } / { ok:false, error } 响应、把网络层
 * 的英文异常翻译成一句中文。**不做任何解密**：宿主在 /list 里就把敏感字段的值
 * 换成了掩码 VAULT_MASK（src/triad/vault/types.ts），明文只能经 POST /reveal
 * 单字段、按次取——那是全系统唯一的明文出站口，宿主每次都会写一条审计。
 *
 * ── 为什么类型全部从宿主侧的 types.ts 复用 ──────────────────────────
 * 记录 / 字段 / 照片的形状是这个模块最核心的契约，前端另写一份迟早漂移
 * （改一个字段名 → 页面静默渲染 undefined）。所以这里直接 type-only 引用
 * src/triad/vault/types.ts，一个字段都不重新定义。
 *
 * isFieldSensitive / DEFAULT_SCENES / DEFAULT_VAULT_CONFIG 是**值导入**，
 * 理由同上：isFieldSensitive 是「敏感与否」的唯一判定入口（宿主侧注释写死了
 * 这条纪律），前端自己再写一份就是第二个入口，漏改一处就是明文上屏。这三个
 * 符号都是纯常量 / 纯函数、零依赖零副作用，esbuild 会把它们原地打进 client
 * 产物，不会把宿主侧的 node 运行时拖进浏览器。
 * ⚠ 因此 types.ts 里**不允许**出现任何 node: 或 @deepseek-ai/* 的运行时导入。
 *
 * ── 敏感值只有一条路：点眼睛 → /reveal ───────────────────────────────
 * /list 下发的敏感字段值是掩码 VAULT_MASK，**不是明文**。所以前端没有「本地
 * 已有一份明文可用」这种退路可走：
 *   · 取不到（空串 / 报错 / 返回的又是掩码）→ 保持圆点 + 提示用户重试，
 *     绝不把掩码或旧值当密码显示出来；
 *   · 提交表单时敏感字段留空 / 带掩码 → 视为「没改」，宿主侧
 *     isMaskedValue + restoreMaskedFields 会保留原值（这条约定两边必须一致，
 *     否则一次保存就把真密码写成六个星号，且不可逆）；
 *   · 明文只在 DOM 里停留 30 秒（抽屉那边管定时器），不进任何列表 / 摘要。
 * 这么设计的意义：把「整库明文一次性塞进浏览器内存」从默认行为里删掉，密码
 * 也不会在页面加载那一瞬间全铺在 DevTools 的 Elements 面板里。
 */

import {
  DEFAULT_SCENES,
  DEFAULT_VAULT_CONFIG,
  isFieldSensitive,
  type VaultConfig,
  type VaultField,
  type VaultFieldType,
  type VaultImageVariant,
  type VaultPhoto,
  type VaultRecord,
  type VaultScene,
  type VaultStats,
} from '../../../triad/vault/types.js'
import {
  DEFAULT_VAULT_SYNC,
  parseGithubRepo,
  type VaultSyncPatch,
  type VaultSyncPublic,
  type VaultSyncRun,
} from '../../../triad/vault/sync-types.js'

/** 路由前缀（宿主半身按此前缀挂路由）。 */
export const VAULT_API_BASE = '/api/dsh-vault'

/**
 * 页面上「这个值已隐藏」的视觉符号（圆点）。
 *
 * ⚠ 它**不是**线上协议里的掩码：协议掩码是 VAULT_MASK（六个星号，定义在宿主侧
 * types.ts，客户端与 host 必须用同一个字面量）。两者绝不能混用——
 *   · SECRET_DOTS 只用于渲染：列表摘要、抽屉里未显形的敏感字段；
 *   · VAULT_MASK 只用于识别：判断一个值是「没改过」而不是真值。
 * 把 VAULT_MASK 直接渲染出来等于告诉用户「你的密码是 ********」，反过来把
 * 圆点当成掩码去比较则永远匹配不上。
 *
 * 固定长度而不是按真实值长度生成：长度本身对猜密码有用（宿主侧
 * fieldSummaryOf 的注释也强调过这一点），所以这里连长度都不泄露。
 */
export const SECRET_DOTS = '●●●●●●'

/* ───────────────────────── 响应形状 ───────────────────────── */

/** /list 的响应。 */
export interface VaultListResponse {
  ok: boolean
  records: VaultRecord[]
  scenes: VaultScene[]
  stats: VaultStats | null
  config: Partial<VaultConfig>
}

/** 单条记录的响应（新建 / 改字段 / 改标题 / 归档都回这个形状）。 */
export interface VaultRecordResponse {
  ok: boolean
  record: VaultRecord
}

/** 场景清单的响应（新建 / 改名 / 删除场景都回这个形状）。 */
export interface VaultSceneResponse {
  ok: boolean
  scenes: VaultScene[]
}

/** 维护动作的结果（清孤儿 + 配额淘汰）。 */
export interface VaultMaintenanceResult {
  ok: boolean
  swept: number
  evicted: number
  freedBytes: number
  stats: VaultStats | null
}

/**
 * 一条记录的整体提交体。
 *
 * 与宿主 store.upsertRecord 的入参同形：给 id 是整体替换（保留 createdAt 与
 * 变更历史），不给是新建。**不接受只传部分字段**——整体替换的语义就是「这
 * 就是这条记录的全部」，少传的字段会被当成删除。
 */
export interface VaultRecordDraft {
  id?: string
  scene: string
  title: string
  subtitle?: string
  fields: VaultField[]
  tags?: string[]
  note?: string
}

/** 照片上传时的单档载荷（data 是**纯 base64**，不带 data: 前缀）。 */
export interface VaultPhotoVariantPayload {
  variant: VaultImageVariant
  data: string
  width: number
  height: number
}

/** 明文查看审计的一条记录。 */
export interface VaultAuditEntry {
  at: string
  recordId: string
  fieldKey: string
  via: string
}

/* ───────────────────────── 传输层 ───────────────────────── */

/** 把异常说成一句人话（fetch 抛的原文是英文 TypeError，直接上屏看不懂）。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 解析响应体。
 *
 * 三条判据按顺序：body.ok === false（服务端明确拒绝，HTTP 状态可能是 200）→
 * HTTP 非 2xx → body 不是 JSON 对象。最后一条是「路由没挂上」的典型症状：
 * 官方 404 页是 HTML，JSON.parse 直接炸，报出来的错与真正原因无关。
 */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const shaped = (body !== null && typeof body === 'object' ? body : null) as
    { ok?: boolean; error?: unknown } | null
  if (shaped !== null && shaped.ok === false) {
    const reason = typeof shaped.error === 'string' && shaped.error !== ''
      ? shaped.error
      : '服务端拒绝了这次请求'
    throw new Error(reason)
  }
  if (!response.ok) {
    const reason = shaped !== null && typeof shaped.error === 'string' && shaped.error !== ''
      ? shaped.error
      : '请求失败（HTTP ' + String(response.status) + '）'
    throw new Error(reason)
  }
  if (shaped === null) {
    throw new Error('档案服务没有返回可解析的 JSON —— 宿主半身可能还没实现 /api/dsh-vault 路由')
  }
  return shaped as unknown as T
}

/** 统一请求入口（GET 无 body / POST 带 JSON body）。 */
async function request<T>(path: string, payload?: unknown): Promise<T> {
  const init: RequestInit = payload === undefined
    ? { method: 'GET', headers: { accept: 'application/json' } }
    : {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }
  let response: Response
  try {
    response = await fetch(VAULT_API_BASE + path, init)
  } catch (error) {
    // 走不到这里的最常见原因：DSH 服务没起 / 插件 host 半身崩了被复原。
    throw new Error('连不上档案服务：' + describeError(error))
  }
  return readJson<T>(response)
}

/* ───────────────────────── 读取面 ───────────────────────── */

/**
 * 规范化一条记录。
 *
 * 存在的理由不是「防御性编程」而是**版本错位**：client 刷新页面就生效，host
 * 要重启 DSH 才换新，这段窗口里旧 host 可能不返回 changes / photos / tags。
 * 直接渲染会得到「记录有 0 条历史」，或者在 undefined 上 .map 崩掉。
 */
function normalizeRecord(record: VaultRecord): VaultRecord {
  return {
    ...record,
    fields: Array.isArray(record.fields) ? record.fields : [],
    photos: Array.isArray(record.photos) ? record.photos : [],
    tags: Array.isArray(record.tags) ? record.tags : [],
    changes: Array.isArray(record.changes) ? record.changes : [],
    version: Number.isFinite(record.version) ? record.version : 1,
    confidence: Number.isFinite(record.confidence) ? record.confidence : 1,
  }
}

/** 规范化场景（内置场景永远在，哪怕 host 一个都没回）。 */
function normalizeScenes(scenes: VaultScene[] | undefined): VaultScene[] {
  const list = Array.isArray(scenes) && scenes.length > 0 ? scenes : [...DEFAULT_SCENES]
  return list
    .filter((scene) => scene !== null && typeof scene === 'object' && typeof scene.id === 'string')
    .map((scene) => ({
      ...scene,
      label: typeof scene.label === 'string' && scene.label !== '' ? scene.label : scene.id,
      desc: typeof scene.desc === 'string' ? scene.desc : '',
      order: Number.isFinite(scene.order) ? scene.order : 100,
      builtin: scene.builtin === true,
      fieldTemplate: Array.isArray(scene.fieldTemplate) ? scene.fieldTemplate : [],
    }))
    .sort((a, b) => a.order - b.order)
}

/** 拉全量（记录 + 场景 + 统计 + 配置）：页面首屏的唯一一次请求。 */
export async function listVault(): Promise<VaultListResponse> {
  const response = await request<VaultListResponse>('/list')
  return {
    ok: response.ok !== false,
    records: (Array.isArray(response.records) ? response.records : []).map(normalizeRecord),
    scenes: normalizeScenes(response.scenes),
    stats: response.stats ?? null,
    config: response.config ?? {},
  }
}

/** 读配置（只暴露可调字段）。 */
export async function getVaultConfig(): Promise<Partial<VaultConfig>> {
  const response = await request<{ ok: boolean; config: Partial<VaultConfig> }>('/config')
  return response.config ?? {}
}

/** 写配置（部分字段；宿主负责钳制越界值）。 */
export async function setVaultConfig(patch: Partial<VaultConfig>): Promise<Partial<VaultConfig>> {
  const response = await request<{ ok: boolean; config: Partial<VaultConfig> }>('/config', patch)
  return response.config ?? {}
}

/** 读占用统计。 */
export async function getVaultStats(): Promise<VaultStats | null> {
  const response = await request<{ ok: boolean; stats: VaultStats }>('/stats')
  return response.stats ?? null
}

/** 关键词检索（服务端侧）。 */
export async function searchVaultRecords(keyword: string): Promise<VaultRecord[]> {
  const suffix = keyword === '' ? '' : '?q=' + encodeURIComponent(keyword)
  const response = await request<{ ok: boolean; records: VaultRecord[] }>('/search' + suffix)
  return (Array.isArray(response.records) ? response.records : []).map(normalizeRecord)
}

/** 明文查看审计（谁在什么时候看了哪个敏感字段）。 */
export async function listVaultAudit(limit = 50): Promise<VaultAuditEntry[]> {
  const response = await request<{ ok: boolean; entries: VaultAuditEntry[] }>(
    '/audit?limit=' + String(limit),
  )
  return Array.isArray(response.entries) ? response.entries : []
}

/* ───────────────────────── 写入面 ───────────────────────── */

/** 新建或整体更新一条记录。 */
export async function saveVaultRecord(draft: VaultRecordDraft): Promise<VaultRecord> {
  // source 固定 manual：页面上的动作都是人做的。抽取侧走的是另一条路径。
  const response = await request<VaultRecordResponse>('/record', { ...draft, source: 'manual' })
  if (response.record === undefined) throw new Error('服务端没有返回保存后的记录')
  return normalizeRecord(response.record)
}

/**
 * 就地改单个字段（自动更新的最小操作单元，页面上用于字段行内编辑）。
 *
 * 为什么页面上还要用这个而不是整体 /record：只改一行时整体提交的语义是「其余
 * 字段按我提交的来」，而界面上的草稿可能只碰了一个输入框；用 /field 提交就
 * 天然只影响那一行，即使别处刚被模型改过也不会被这次保存覆盖。
 */
export async function patchVaultField(input: {
  id: string
  key: string
  value: string
  label?: string
  type?: VaultFieldType
  sensitive?: boolean
}): Promise<VaultRecord> {
  const response = await request<VaultRecordResponse>('/field', input)
  if (response.record === undefined) throw new Error('服务端没有返回更新后的记录')
  return normalizeRecord(response.record)
}

/** 删除记录（连同照片引用）。 */
export async function deleteVaultRecord(id: string): Promise<void> {
  await request<{ ok: boolean }>('/delete', { id })
}

/** 归档 / 恢复。 */
export async function archiveVaultRecord(id: string, archived: boolean): Promise<VaultRecord> {
  const response = await request<VaultRecordResponse>('/archive', { id, archived })
  if (response.record === undefined) throw new Error('服务端没有返回归档后的记录')
  return normalizeRecord(response.record)
}

/**
 * 取单个敏感字段的明文。
 *
 * 返回空串而不是抛错：抛错在这里没有信息量——调用方无论失败原因是什么都只能做
 * 同一件事（保持圆点 + 提示重试）。注意空串同时也意味着「宿主没有这个字段」，
 * 所以拿到的空串**绝不能**当成「密码是空的」渲染出来。
 */
export async function revealVaultField(id: string, key: string): Promise<string> {
  const response = await request<{ ok: boolean; value: string }>('/reveal', { id, key })
  return typeof response.value === 'string' ? response.value : ''
}

/** 新建或更新场景（传完整场景对象即更新，宿主按 id 判别）。 */
export async function saveVaultScene(scene: VaultScene): Promise<VaultScene[]> {
  const response = await request<VaultSceneResponse>('/scene', { scene })
  return normalizeScenes(response.scenes)
}

/** 删除自定义场景（内置场景宿主会拒绝）。 */
export async function deleteVaultScene(id: string): Promise<VaultScene[]> {
  const response = await request<VaultSceneResponse>('/scene', { id, remove: true })
  return normalizeScenes(response.scenes)
}

/**
 * 上传一张照片，并把宿主回的**整条记录**一起带回来。
 *
 * 宿主 /photo 的响应是 { ok, photo, record }。record 不是为了省一次 /list，
 * 而是为了一致性：本地上传后如果只往 photos 数组里塞一张，抽屉底部的「变更
 * 历史」不会有这次 photo-add（历史是宿主算的），用户会看到「照片加上了、
 * but 历史里没有」，刷新一次又出现。用宿主回的 record 覆盖，两边天然同步。
 * 旧宿主不带 record 时退回 null，调用方自己拼本地副本。
 */
export async function uploadVaultPhotoDetailed(input: {
  id: string
  role: string
  label: string
  fieldKey?: string
  variants: VaultPhotoVariantPayload[]
}): Promise<{ photo: VaultPhoto; record: VaultRecord | null }> {
  const response = await request<{ ok: boolean; photo: VaultPhoto; record?: VaultRecord }>('/photo', input)
  if (response.photo === undefined) throw new Error('服务端没有返回上传后的照片')
  return {
    photo: response.photo,
    record: response.record === undefined ? null : normalizeRecord(response.record),
  }
}

/** 上传一张照片（三档字节由调用方压缩好）。只要照片本身时用这个。 */
export async function uploadVaultPhoto(input: {
  id: string
  role: string
  label: string
  fieldKey?: string
  variants: VaultPhotoVariantPayload[]
}): Promise<VaultPhoto> {
  const result = await uploadVaultPhotoDetailed(input)
  return result.photo
}

/** 删除一张照片（回整条记录：照片引用挂在记录上）。 */
export async function deleteVaultPhoto(id: string, photoId: string): Promise<VaultRecord> {
  const response = await request<VaultRecordResponse>('/photo-delete', { id, photoId })
  if (response.record === undefined) throw new Error('服务端没有返回更新后的记录')
  return normalizeRecord(response.record)
}

/**
 * 清孤儿 + 配额淘汰。
 *
 * swept 是本次扫掉的孤儿 blob（引用计数为 0），evicted 是按配额淘汰掉的照片。
 * 两个数字分开报是因为它们的用户语义完全不同：前者用户什么都没做，后者用户
 * 该知道自己被删了图。
 */
export async function maintainVault(): Promise<VaultMaintenanceResult> {
  return request<VaultMaintenanceResult>('/maintenance', {})
}

/** 导入（合并，不是覆盖）。返回实际导入的条数。 */
export async function importVaultData(data: unknown): Promise<number> {
  const response = await request<{ ok: boolean; imported: number }>('/import', { data })
  return Number.isFinite(response.imported) ? response.imported : 0
}

/* ═════════════════ 密码健康审计 ═════════════════
 *
 * 这一层只负责「拿报告、把枚举翻成中文」。**判定逻辑一律在宿主侧**：哪条算弱
 * 口令、哪些算重复，需要看全部记录的明文——浏览器里没有（也不该有）那份数据，
 * 客户端拿到的只有掩码。所以这里不存在任何「本地再算一遍」的余地，也不要加。
 */

/** 问题严重度（与宿主枚举一一对应）。 */
export type VaultIssueSeverity = 'high' | 'medium' | 'low'

/**
 * 问题种类（固定枚举，宿主只会下发这 8 种）。
 *
 * 这里刻意**没有** undecryptable：宿主侧解密失败会折成空串，与「用户主动清空」
 * 无法区分，报出来会是满屏假警报，所以那条检查在宿主侧就砍掉了。前端不留这个
 * 分支，免得将来有人照着旧契约把它加回来又得到一个永远不触发的死枚举值。
 */
export type VaultIssueKind =
  | 'reused-password'
  | 'weak-password'
  | 'stale-password'
  | 'plaintext-secret'
  | 'expired'
  | 'expiring'
  | 'no-password'
  | 'duplicate-record'

/** 一条健康问题。message 是宿主写好的中文，**不含任何明文值**。 */
export interface VaultIssue {
  kind: VaultIssueKind
  severity: VaultIssueSeverity
  recordId: string
  title: string
  scene: string
  fieldKey?: string
  /** 同一组重复密码共用的标识（reused-password 用，页面按它分组显示）。 */
  groupId?: string
  message: string
  /**
   * 可选补充。**语义随 kind 变**（宿主约定）：
   *   · expired / expiring —— 剩余天数（expired 为负数，表示已经过期几天）；
   *   · reused-password   —— 这一组里有多少条记录；
   * 所以它不能当自由文本直接渲染，页面要过 formatIssueDetail 翻成人话。
   */
  detail?: string
}

/** 健康报告。 */
export interface VaultHealthReport {
  generatedAt: string
  /** 0-100，越高越好（宿主算的，页面只展示）。 */
  score: number
  totalRecords: number
  sensitiveFields: number
  /** 按 kind 计数（只包含实际出现过的问题种类）。 */
  counts: Partial<Record<VaultIssueKind, number>>
  issues: VaultIssue[]
}

/**
 * 拉一次健康报告。
 *
 * 每次打开健康抽屉都重新算（不缓存）：这份报告的价值就在于「现在」——
 * 用户刚改完密码再打开，看到的必须是最新结论，而不是上次的快照。
 */
export async function fetchVaultHealth(): Promise<VaultHealthReport> {
  const response = await request<{ ok: boolean; report: VaultHealthReport }>('/health')
  const report = response.report
  if (report === undefined || report === null) throw new Error('服务端没有返回健康报告')
  return {
    generatedAt: typeof report.generatedAt === 'string' ? report.generatedAt : new Date().toISOString(),
    score: Number.isFinite(report.score) ? report.score : 100,
    totalRecords: Number.isFinite(report.totalRecords) ? report.totalRecords : 0,
    sensitiveFields: Number.isFinite(report.sensitiveFields) ? report.sensitiveFields : 0,
    counts: report.counts !== null && typeof report.counts === 'object' ? report.counts : {},
    // 旧宿主可能不返回 issues；少这一层防护会让整个抽屉在 .map 上炸掉。
    issues: Array.isArray(report.issues) ? report.issues.filter((issue) => issue !== null && typeof issue === 'object') : [],
  }
}

/* ═════════════════ 密钥备份与恢复 ═════════════════
 *
 * 这是**换机救命通道**：档案里的敏感值用本机密钥加密，密钥丢了等于那批密码
 * 永久损坏。所以备份包必须能把密钥本身带走（再用用户给的口令加密），而不是
 * 只导出 vault.json——后者换一台机器就是一堆解不开的密文。
 *
 * 三处刻意的设计：
 *   1. 下载用 <a download> + Blob，不用 fetch 取字符串：备份包是二进制/大文件，
 *      存进 JS 字符串会先 UTF-8 解码一次（图省事的写法），图片字节当场损坏；
 *   2. 口令**不落任何地方**：只出现在这一次请求体里，不进 localStorage、不进
 *      组件外的作用域，也不写进日志（错口令要能重试）；
 *   3. 恢复是覆盖语义，页面必须先二次确认——这不是「合并导入」。
 */

/**
 * 本机密钥的公开信息（指纹可贴给别人核对，密钥本身永不出站）。
 *
 * 只有这两个字段：密钥文件不存创建时间，宿主的 /key-info 也就不返回 createdAt。
 * 前端不要「顺手补一个」——读一个不存在的字段只会得到 undefined，然后页面上
 * 出现一行空的「创建于 」。
 */
export interface VaultKeyInfo {
  exists: boolean
  /** sha256 前 16 位十六进制；没有密钥时是空串。 */
  fingerprint: string
}

/** 取密钥信息（有没有密钥、指纹）。 */
export async function fetchVaultKeyInfo(): Promise<VaultKeyInfo> {
  const response = await request<{ ok: boolean; info: VaultKeyInfo }>('/key-info')
  const info = response.info
  if (info === undefined || info === null) throw new Error('服务端没有返回密钥信息')
  return {
    exists: info.exists === true,
    fingerprint: typeof info.fingerprint === 'string' ? info.fingerprint : '',
  }
}

/** 从 Content-Disposition 里抠文件名（支持 filename*=UTF-8''中文名）。 */
function filenameFromDisposition(header: string | null): string {
  if (header === null || header === '') return ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star !== null) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // 编码坏了就退回下面的普通 filename，别让下载因为文件名失败。
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain === null ? '' : plain[1].trim()
}

/** 默认文件名：服务端没给 Content-Disposition 时也能存下来。 */
function defaultBackupName(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return 'dsh-vault-backup-' + String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
    + '-' + pad(now.getHours()) + pad(now.getMinutes()) + '.dshvault'
}

/**
 * 把一段二进制存成文件（不经过任何字符串转换）。
 *
 * 先挂到 body 再点：Firefox 里游离的 a 元素点击不会触发下载，而这段代码可能
 * 在任何浏览器里跑。objectURL 延迟回收——立刻 revoke 在部分实现里会让下载
 * 拿到一个已失效的地址。
 */
function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 2000)
}

/**
 * 导出备份包并直接下载。
 *
 * 返回文件名与实际字节数，供页面说一句「已导出 xxx（12.3 MB）」——没有任何
 * 反馈的下载按钮在没有下载栏的环境里看起来像没生效。
 */
export async function downloadVaultBackup(
  password: string,
  includePhotos = false,
): Promise<{ filename: string; bytes: number }> {
  let response: Response
  try {
    response = await fetch(VAULT_API_BASE + '/backup', {
      method: 'POST',
      headers: { accept: 'application/octet-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ password, includePhotos }),
    })
  } catch (error) {
    throw new Error('连不上档案服务：' + describeError(error))
  }
  if (!response.ok) {
    // 失败时宿主回的是 { ok:false, error }（JSON），不是文件——交给 readJson 抛中文原因。
    await readJson<unknown>(response)
    throw new Error('导出失败（HTTP ' + String(response.status) + '）')
  }
  const blob = await response.blob()
  if (blob.size === 0) throw new Error('导出失败：服务端返回了空文件')
  const filename = filenameFromDisposition(response.headers.get('content-disposition')) || defaultBackupName()
  saveBlobAsFile(blob, filename)
  return { filename, bytes: blob.size }
}

/** 恢复结果（人读的一句话由页面拼，这里只报事实）。 */
export interface VaultRestoreResult {
  records: number
  photos: number
  scenes: number
  /** true = 覆盖了现有数据（而不是恢复进一个空库）。 */
  replaced: boolean
  /** 备份包生成时间（能显示「你恢复的是一份几月几号的备份」）。 */
  createdAt?: string
}

/**
 * 从备份包恢复（**覆盖**当前库）。
 *
 * packageText 是备份包全文：调用方用 File.text() 读，别自己 decode 两次。
 * 失败原因（口令错 / 包损坏 / 版本不支持）由宿主写在 error 里，原样抛给页面
 * ——这三条对用户是三种不同的处置，不能压成一句「恢复失败」。
 */
export async function restoreVaultBackup(password: string, packageText: string): Promise<VaultRestoreResult> {
  const response = await request<{ ok: boolean; result: VaultRestoreResult }>('/restore', {
    password,
    package: packageText,
  })
  const result = response.result
  if (result === undefined || result === null) throw new Error('服务端没有返回恢复结果')
  return {
    records: Number.isFinite(result.records) ? result.records : 0,
    photos: Number.isFinite(result.photos) ? result.photos : 0,
    scenes: Number.isFinite(result.scenes) ? result.scenes : 0,
    replaced: result.replaced === true,
    ...(typeof result.createdAt === 'string' && result.createdAt !== '' ? { createdAt: result.createdAt } : {}),
  }
}

/* ───────────────────────── 云端同步（GitHub 私库）───────────────────────── */

/**
 * 读同步状态。
 *
 * 返回的 VaultSyncPublic 里**没有令牌与口令明文**（宿主只回后四位与「有没有」）。
 * 这条纪律在类型上就写死了：前端拿不到能直接用的凭据，也就没有「顺手把它渲染
 * 出来」的机会。
 */
export async function getVaultSync(): Promise<VaultSyncPublic> {
  const response = await request<{ ok: boolean; sync: VaultSyncPublic }>('/sync')
  return normalizeSync(response.sync)
}

/** 保存同步设置（仓库地址 / 令牌 / 口令 / 开关 / 间隔）。 */
export async function saveVaultSync(patch: VaultSyncPatch): Promise<VaultSyncPublic> {
  const response = await request<{ ok: boolean; sync: VaultSyncPublic }>('/sync', patch)
  return normalizeSync(response.sync)
}

/**
 * 立即同步一次。
 *
 * **同步失败不是抛错**：宿主把失败原因放在 run.error 里（中文一句话），页面
 * 据此显示在状态行上。抛错只用于「请求本身没送达」——那两种情况的处置完全
 * 不同（一个去改仓库配置，一个去重启 DSH）。
 */
export async function syncVaultNow(): Promise<{ run: VaultSyncRun; sync: VaultSyncPublic }> {
  const response = await request<{ ok: boolean; run: VaultSyncRun; sync: VaultSyncPublic }>('/sync-now')
  if (response.run === undefined || response.run === null) throw new Error('档案服务没有返回同步结果')
  return { run: response.run, sync: normalizeSync(response.sync) }
}

/** 只校验仓库（是否可达、是否私有），不上传。 */
export async function verifyVaultSyncRepo(): Promise<{
  probe: { private: boolean; branch: string; repo: string; tokenSource: string }
  sync: VaultSyncPublic
}> {
  const response = await request<{
    ok: boolean
    probe: { private: boolean; branch: string; repo: string; tokenSource: string }
    sync: VaultSyncPublic
  }>('/sync-verify')
  if (response.probe === undefined || response.probe === null) throw new Error('档案服务没有返回仓库校验结果')
  return { probe: response.probe, sync: normalizeSync(response.sync) }
}

/**
 * 规范化同步状态（版本错位窗口的防御）。
 *
 * 与 normalizeRecord 同一个理由：client 刷新即生效、host 要重启 DSH 才换，
 * 这段窗口里旧 host 可能根本没有 /sync 路由（请求会以 503 + 中文错误失败），
 * 也可能回了缺字段的对象。缺什么补什么，页面就不会在 undefined 上崩。
 */
function normalizeSync(raw: VaultSyncPublic | undefined): VaultSyncPublic {
  const fallback = DEFAULT_VAULT_SYNC
  if (raw === undefined || raw === null) {
    throw new Error('档案服务没有返回同步状态')
  }
  return {
    repo: typeof raw.repo === 'string' ? raw.repo : '',
    repoInput: typeof raw.repoInput === 'string' ? raw.repoInput : '',
    repoValid: raw.repoValid === true,
    repoUrl: typeof raw.repoUrl === 'string' ? raw.repoUrl : '',
    tokenSet: raw.tokenSet === true,
    tokenTail: typeof raw.tokenTail === 'string' ? raw.tokenTail : '',
    tokenSource: raw.tokenSource === 'gh' || raw.tokenSource === 'stored' ? raw.tokenSource : 'none',
    passphraseSet: raw.passphraseSet === true,
    enabled: raw.enabled !== false,
    everyHours: Number.isFinite(raw.everyHours) ? raw.everyHours : fallback.everyHours,
    includePhotos: raw.includePhotos === true,
    lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : '',
    lastStatus: raw.lastStatus === 'ok' || raw.lastStatus === 'error' ? raw.lastStatus : 'never',
    lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
    lastBytes: Number.isFinite(raw.lastBytes) ? raw.lastBytes : 0,
    lastSha: typeof raw.lastSha === 'string' ? raw.lastSha : '',
    lastCommit: typeof raw.lastCommit === 'string' ? raw.lastCommit : '',
    running: raw.running === true,
    nextAt: typeof raw.nextAt === 'string' ? raw.nextAt : '',
    repoPrivate: raw.repoPrivate === true ? true : raw.repoPrivate === false ? false : 'unknown',
    repoReachable: raw.repoReachable === true ? true : raw.repoReachable === false ? false : 'unknown',
    needsSetup: raw.needsSetup === true,
    suggestedRepo: typeof raw.suggestedRepo === 'string' ? raw.suggestedRepo : '',
    history: (Array.isArray(raw.history) ? raw.history : [])
      .filter((item) => item !== null && typeof item === 'object'),
  }
}

/** 前端预校验：地址能不能解析成 owner/repo（与宿主同一个函数，口径不会漂）。 */
export function describeGithubRepo(input: string): { valid: boolean; fullName: string; url: string; hint: string } {
  const parsed = parseGithubRepo(input)
  if (parsed === null) {
    return {
      valid: false,
      fullName: '',
      url: '',
      hint: input.trim() === '' ? '' : '看不懂这个地址：形如 https://github.com/用户名/仓库名，或直接写 用户名/仓库名',
    }
  }
  return { valid: true, fullName: parsed.fullName, url: parsed.htmlUrl, hint: '' }
}

/**
 * 把 issue.detail 翻成人话。
 *
 * 宿主的 detail 是**按 kind 变语义的裸数据**（过期项是剩余天数、重复项是组内条数），
 * 直接渲染会得到一行「-12」这种东西。翻成中文放在这一层而不是各组件里：口径只有
 * 一份，将来宿主改了语义也只需要改这里。
 *
 * 返回空串表示这条没有可读的 detail（调用方跳过那一行）。
 */
export function formatIssueDetail(issue: VaultIssue): string {
  const raw = issue.detail ?? ''
  if (raw === '') return ''
  const days = Number(raw)
  switch (issue.kind) {
    case 'expired':
      // 负数＝已经过期这么多天。用户关心的是「过期多久了」，不是「-12」。
      return Number.isFinite(days) && days < 0
        ? '已经过期 ' + String(Math.abs(days)) + ' 天'
        : (Number.isFinite(days) && days > 0 ? '还有 ' + String(days) + ' 天到期' : '')
    case 'expiring':
      return Number.isFinite(days) ? '还有 ' + String(days) + ' 天到期' : ''
    case 'reused-password':
      return Number.isFinite(days) ? '这一组共 ' + String(days) + ' 条记录' : ''
    default:
      // 其它 kind 的 detail 是真·补充说明（不是数字），原样显示。
      return raw
  }
}

/* ═════════════════ TOTP 动态验证码 ═════════════════ */

/**
 * 一次性验证码。
 *
 * remaining 是「这一枚还能用多久」（秒），period 通常是 30；倒计时从 remaining
 * 起算，不是从 period 起算（用户点开的时刻可能正好在一枚码的第 20 秒）。
 * issuer / account 只有字段值写成 otpauth:// 链接时才存在，裸种子形态下没有
 * 这两个键——所以它们是可选的，渲染前必须判空。
 */
export interface VaultTotpCode {
  code: string
  remaining: number
  period: number
  /** 位数（通常 6）。宿主没回时按 6 处理。 */
  digits: number
  issuer?: string
  account?: string
}

/**
 * 取一枚当前的 TOTP 码。
 *
 * 为什么由宿主算而不是在页面上算：计算要用到**明文密钥**（base32 secret），
 * 而页面拿到的敏感值是掩码，取明文得走 /reveal 并且会写审计。让宿主在内部
 * 解一次、只回 6 位码，页面就完全不需要接触密钥本身——泄露面小一个量级。
 * 字段值支持 otpauth://totp/...?secret=XXX 形态由宿主解析。
 */
export async function fetchVaultTotp(id: string, key: string): Promise<VaultTotpCode> {
  const response = await request<{ ok: boolean; totp: VaultTotpCode }>('/totp', { id, key })
  const totp = response.totp
  if (totp === undefined || totp === null || typeof totp.code !== 'string') {
    throw new Error('服务端没有返回验证码')
  }
  return {
    code: totp.code,
    remaining: Number.isFinite(totp.remaining) ? Math.max(0, Math.round(totp.remaining)) : 30,
    period: Number.isFinite(totp.period) && totp.period > 0 ? Math.round(totp.period) : 30,
    digits: Number.isFinite(totp.digits) && totp.digits > 0 ? Math.round(totp.digits) : 6,
    ...(typeof totp.issuer === 'string' && totp.issuer !== '' ? { issuer: totp.issuer } : {}),
    ...(typeof totp.account === 'string' && totp.account !== '' ? { account: totp.account } : {}),
  }
}

/**
 * 字段 key / 标签是否像 TOTP 密钥。
 *
 * 判据必须是「敏感 + 名字像」，而不是「值像 otpauth://」：值在列表里是掩码，
 * 只有 /reveal 之后才看得到，拿它做判定等于「点开才决定给不给按钮」。
 * 边界用 [-_ ] 与首尾，避免 hotpot / protoplasm 这类词误命中。
 */
const TOTP_KEY_HINT = /(^|[-_ ])(totp|otp|2fa|mfa|authenticator|onetime)([-_ ]|$)/
/* 标签用词：中文里这一栏常见的写法是「动态码 / 验证码 / 谷歌验证器 / 二次验证」。
   收「验证器」而不只是「身份验证器」——「谷歌验证器」是最常见的叫法之一，漏掉
   它就等于给最需要这枚按钮的用户把按钮藏了。 */
const TOTP_LABEL_HINT = /(动态码|验证码|验证器|一次性|令牌|二次验证|两步验证|口令器)/

/** 是不是 TOTP 字段（决定要不要给「生成验证码」入口）。 */
export function isTotpField(field: Pick<VaultField, 'key' | 'label' | 'type' | 'sensitive'>): boolean {
  if (!isFieldSensitive(field)) return false
  const key = field.key.toLowerCase()
  const label = field.label.toLowerCase()
  return TOTP_KEY_HINT.test(key) || TOTP_KEY_HINT.test(label) || TOTP_LABEL_HINT.test(field.label)
}

/* ═════════════════ 强口令生成 / 批量轮换 ═════════════════
 *
 * 这两条路由是「审计 → 立刻动手」链上的最后一环：健康报告告诉你「这三条用了
 * 同一个密码」，用户的第一反应是「那怎么办」——如果页面只能告诉他问题、却要
 * 他自己去想三个强密码再逐条手改，这条路就断在最后一步。
 *
 * ── 为什么生成在宿主侧而不是浏览器 ──────────────────────────────────
 * Math.random / crypto.getRandomValues 都能生成密码，但「多少位熵」「字符集怎么
 * 组合」这类口径必须与宿主一致（审计那边判弱口令用的就是同一套阈值）。两处各
 * 写一份，就会出现「页面说他生成的密码很强、审计说它太弱」这种自相矛盾的场面。
 */

/** 生成参数。全部可省，宿主有默认值（20 位、含符号、去掉易混字符）。 */
export interface VaultPasswordOptions {
  /** 长度，宿主钳到 12..128。 */
  length?: number
  /** 是否含符号（缺省 true）。 */
  symbols?: boolean
  /** 是否去掉 l/O/0/1 这类易混字符（缺省 false＝不去掉）。 */
  ambiguous?: boolean
}

/** 生成结果。entropyBits 是宿主按字符集与长度算的，页面只展示。 */
export interface VaultGeneratedPassword {
  password: string
  length: number
  entropyBits: number
  /** 命中的字符类别（小写 / 大写 / 数字 / 符号），宿主已翻成中文或英文标识。 */
  categories: string[]
}

/**
 * 生成一个强口令。
 *
 * 只生成、不落库：填入输入框之后仍要用户点「保存」才写进去——网页上任何
 * 「点一下就覆盖了密码」的行为都该是用户明确同意的。
 */
export async function generateVaultPassword(options: VaultPasswordOptions = {}): Promise<VaultGeneratedPassword> {
  const response = await request<{ ok: boolean; generated: VaultGeneratedPassword }>('/password', options)
  const generated = response.generated
  if (generated === undefined || generated === null || typeof generated.password !== 'string') {
    throw new Error('服务端没有返回生成结果')
  }
  return {
    password: generated.password,
    length: Number.isFinite(generated.length) ? generated.length : generated.password.length,
    entropyBits: Number.isFinite(generated.entropyBits) ? generated.entropyBits : 0,
    categories: Array.isArray(generated.categories) ? generated.categories : [],
  }
}

/** /rotate 成功的一条：新明文密码**只此一次返回**。 */
export interface VaultRotatedEntry {
  id: string
  title: string
  key: string
  /** 明文。页面必须展示出来让用户去各站粘贴——用户拿不到就等于白改。 */
  password: string
}

/** /rotate 跳过的一条（没有登录口令字段之类）。reason 是宿主写好的中文。 */
export interface VaultRotateSkipped {
  id: string
  reason: string
}

/** /rotate 结果。 */
export interface VaultRotateResult {
  rotated: VaultRotatedEntry[]
  skipped: VaultRotateSkipped[]
}

/**
 * 批量把若干记录的密码换成**互不相同**的强口令，并立即写库。
 *
 * 三个必须记住的性质：
 *   1. 立即生效 —— 这一步就落盘了，旧密码当场被覆盖、无法恢复。所以调用方
 *      必须在调用前拿到用户对「你确认能在这些站点上改密吗」的明确确认；
 *   2. 互不相同 —— 宿主保证这批新密码两两不同（否则换完还是复用，等于没修）；
 *   3. 明文只回这一次 —— 响应不缓存，页面也必须把它展示出来，不能静默丢弃。
 *
 * 上限 50 条由宿主强制；页面这边只按「同一组重复」的数量给按钮，天然在上限内。
 */
export async function rotateVaultPasswords(
  ids: string[],
  options: { key?: string; length?: number } = {},
): Promise<VaultRotateResult> {
  const response = await request<{ ok: boolean; rotated: VaultRotatedEntry[]; skipped: VaultRotateSkipped[] }>(
    '/rotate',
    { ids, ...options },
  )
  return {
    rotated: Array.isArray(response.rotated)
      ? response.rotated.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.password === 'string')
      : [],
    skipped: Array.isArray(response.skipped)
      ? response.skipped.filter((entry) => entry !== null && typeof entry === 'object')
      : [],
  }
}

/**
 * 「这是登录口令字段」的判据（决定要不要给「生成」按钮）。
 *
 * 与 isTotpField 互补且**互斥**：totp 字段也是 type=secret，但给它生成随机口令
 * 毫无意义（那是一个 base32 种子，换掉就等于把两步验证弄废）。所以这里必须先
 * 排掉 totp/otp/2fa/mfa，再看名字像不像口令。
 *
 * 只认 type=secret：非敏感字段可能是「安全问题答案」之类，给它塞 20 位随机串
 * 不但没用，还可能把用户原本记得住的答案弄丢。
 */
const PASSWORD_KEY_HINT = /(password|passwd|pwd|pass)/
const PASSWORD_LABEL_HINT = /(密码|口令)/

/** 是不是登录口令字段（可以「生成」一个随机强口令填进去）。 */
export function isPasswordSecretField(
  field: Pick<VaultField, 'key' | 'label' | 'type' | 'sensitive'>,
): boolean {
  if (field.type !== 'secret') return false
  if (isTotpField(field)) return false
  const key = field.key.toLowerCase()
  return PASSWORD_KEY_HINT.test(key) || PASSWORD_LABEL_HINT.test(field.label)
}

/**
 * 熵值 → 一句人读的评语。
 *
 * 只做分档，不重算：entropyBits 是宿主给的，页面没有资格改它的数值，但「132 位
 * 熵」对普通用户没有意义，得配一句「非常强」。
 */
export function describeEntropy(bits: number): string {
  if (!Number.isFinite(bits) || bits <= 0) return ''
  if (bits >= 100) return '非常强'
  if (bits >= 70) return '强'
  if (bits >= 50) return '够用'
  return '偏弱'
}

/* ───────────────────────── URL 面 ───────────────────────── */

/**
 * 图片字节的直链（同源，可直接塞进 img src）。
 *
 * 内容寻址：同一个 sha 永远指向同一份字节，所以浏览器缓存天然复用到死，
 * 不需要在 URL 上挂版本号或时间戳。
 */
export function vaultImageUrl(sha256: string): string {
  return VAULT_API_BASE + '/image?sha=' + encodeURIComponent(sha256)
}

/** 导出文件的下载直链（敏感值仍是密文，换机器导入要靠同一把密钥）。 */
export function vaultExportUrl(): string {
  return VAULT_API_BASE + '/export'
}

/* ───────────────────────── 读图压图 ───────────────────────── */

/** 压缩参数（默认取宿主配置的默认值，页面拿到 config 后覆盖）。 */
export type VaultCompressOptions = Pick<
  VaultConfig,
  'displayMaxEdge' | 'thumbMaxEdge' | 'imageQuality' | 'keepOriginal'
>

/** 从配置里摘出压缩参数（缺字段就用默认配置兜底）。 */
export function compressOptionsOf(config: Partial<VaultConfig>): VaultCompressOptions {
  return {
    displayMaxEdge: typeof config.displayMaxEdge === 'number'
      ? config.displayMaxEdge
      : DEFAULT_VAULT_CONFIG.displayMaxEdge,
    thumbMaxEdge: typeof config.thumbMaxEdge === 'number'
      ? config.thumbMaxEdge
      : DEFAULT_VAULT_CONFIG.thumbMaxEdge,
    imageQuality: typeof config.imageQuality === 'number'
      ? config.imageQuality
      : DEFAULT_VAULT_CONFIG.imageQuality,
    keepOriginal: config.keepOriginal === true,
  }
}

/** 读出来的一张图（source 交给 drawImage，release 释放 objectURL）。 */
interface LoadedImage {
  source: HTMLImageElement
  width: number
  height: number
  release: () => void
}

/**
 * 把 File 读成可绘制的图片。
 *
 * 不用 createImageBitmap：它在部分浏览器里对 webp / 带 EXIF 方向的 JPEG 行为
 * 不一致（方向不修正），而 Image 元素走的是浏览器统一的「按 EXIF 摆正」路径。
 */
async function loadImageSource(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('这张图片浏览器解不开（格式不支持，或文件已损坏）'))
      element.src = url
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/** 按长边等比缩放画一档，返回纯 base64（不含 data: 前缀）。 */
function drawVariant(
  image: LoadedImage,
  maxEdge: number,
  quality: number,
): { data: string; width: number; height: number } {
  const longest = Math.max(image.width, image.height)
  // 只缩不放：小图放大只会变大变糊，没有任何收益。
  const scale = longest > maxEdge && longest > 0 ? maxEdge / longest : 1
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('浏览器没有给出 canvas 2d 上下文，无法压缩图片')
  // 先铺白底：PNG / WebP 的透明区域转成 JPEG 会变纯黑，证件照片上出现黑块
  // 比模糊更糟（看起来像被涂改过）。
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image.source, 0, 0, width, height)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('图片编码失败（canvas 没有产出可用的 JPEG）')
  return { data: dataUrl.slice(comma + 1), width, height }
}

/** 原始字节转纯 base64（分块，避免一次性展开几 MB 触发参数个数上限）。 */
async function readOriginalBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const CHUNK = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/**
 * 客户端压缩：一档 display + 一档 thumb，配置允许时才额外带原图。
 *
 * 为什么压缩放在客户端而不是宿主：原图动辄 2MB，先上传再在服务端缩图等于把
 * 带宽和内存峰值都付两遍；浏览器里就有 canvas，本机实测 2.1MB 的图缩到 1600
 * 长边约 270KB（12%），再缩到 512 长边约 36KB（1.7%）。
 * 默认不传 original —— 原图是唯一能吃满磁盘的档位，而「看清楚」这个需求
 * display 档（1600 长边）已经完全满足。
 */
export async function compressPhotoVariants(
  file: File,
  options: VaultCompressOptions,
): Promise<VaultPhotoVariantPayload[]> {
  const image = await loadImageSource(file)
  try {
    if (image.width === 0 || image.height === 0) {
      throw new Error('这张图片的尺寸是 0，可能不是图片文件')
    }
    const variants: VaultPhotoVariantPayload[] = []
    const display = drawVariant(image, options.displayMaxEdge, options.imageQuality)
    variants.push({ variant: 'display', ...display })
    const thumb = drawVariant(image, options.thumbMaxEdge, options.imageQuality)
    variants.push({ variant: 'thumb', ...thumb })
    if (options.keepOriginal) {
      variants.push({
        variant: 'original',
        data: await readOriginalBase64(file),
        width: image.width,
        height: image.height,
      })
    }
    return variants
  } finally {
    image.release()
  }
}

/* ───────────────────────── 展示辅助 ───────────────────────── */

/**
 * 列表行的摘要（敏感字段只出圆点）。
 *
 * 思路照 fieldSummaryOf（同一批字段、同一个顺序、同样受 inSummary 约束），
 * 但输出目标不同：注入给人看的是「已加密」四个字，列表要的是一眼能扫过去的
 * 一行，所以这里是圆点而不是文字。两者不能合并成一份实现——合并之后必然会
 * 有人把 value 拼进注入侧。
 */
export function vaultRowSummary(record: VaultRecord, budget = 110): string {
  const parts: string[] = []
  for (const field of record.fields) {
    if (field.inSummary === false) continue
    if (isFieldSensitive(field)) {
      parts.push(field.label + '：' + SECRET_DOTS)
      continue
    }
    const value = field.value.trim()
    if (value === '') continue
    parts.push(field.label + '：' + (value.length > 32 ? value.slice(0, 32) + '…' : value))
  }
  if (parts.length === 0 && typeof record.subtitle === 'string' && record.subtitle !== '') {
    return record.subtitle
  }
  const text = parts.join(' · ')
  return text.length > budget ? text.slice(0, budget) + '…' : text
}

/** 字节数 → 人读的大小（与画廊同一档口径）。 */
export function formatVaultBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return String(Math.round(bytes)) + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

/** 时间戳 → 绝对时间（年-月-日 时:分）。 */
export function formatVaultStamp(iso: string | undefined): string {
  if (typeof iso !== 'string' || iso === '') return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return String(at.getFullYear()) + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate())
    + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes())
}

/** 时间戳 → 相对时间（「3 分钟前」）；解析不了就原样回显。 */
export function formatVaultTime(iso: string | undefined): string {
  if (typeof iso !== 'string' || iso === '') return ''
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return iso
  const delta = Date.now() - at
  if (delta < 0) return '刚刚'
  const minute = 60_000
  if (delta < minute) return '刚刚'
  if (delta < 60 * minute) return String(Math.floor(delta / minute)) + ' 分钟前'
  if (delta < 24 * 60 * minute) return String(Math.floor(delta / (60 * minute))) + ' 小时前'
  if (delta < 30 * 24 * 60 * minute) return String(Math.floor(delta / (24 * 60 * minute))) + ' 天前'
  return formatVaultStamp(iso)
}

/* ───────────────── 侧栏二级菜单（给 nav-sections 用）─────────────────
 *
 * 侧栏与页面是两个互不相邻的 React 根，没有共同祖先、没有共享 context，
 * 所以「侧栏点某个场景 → 页面切到那个场景」只能走一条独立通道：
 *   · localStorage —— 页面还没挂载时，挂载时回填；
 *   · window 自定义事件 —— 页面已经挂载时原地切换，不必重开。
 * 这套模式和 hub/workbench-intent.ts 的 readMemoryScope / requestMemoryScope
 * 完全同构（那边管记忆页的工作区、画廊页的类别，这边管档案页的场景）。
 * **刻意不复用那一个模块**：那边的事件名与意图类型是「工作台分类」的语义，
 * 把档案场景塞进去会让两个模块的开关互相覆写。
 */

/** 场景选中意图的广播事件名。 */
export const VAULT_SCENE_EVENT = 'dsh-vault-scene'

/** 场景选中意图的持久化键（侧栏与页面共用同一把键）。 */
export const VAULT_SCENE_STORE = 'dsh-workbench-vault-scene'

/** 读当前选中的场景 id（没有任何记忆时返回 null = 看全部分组）。 */
export function readVaultScene(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(VAULT_SCENE_STORE)
    return value === null || value === '' ? null : value
  } catch {
    // 无痕模式 / 隐私策略拦了 localStorage：只是不记住偏好，不影响其它功能。
    return null
  }
}

/** 请求档案页切到某个场景（写持久化 + 广播）。 */
export function requestVaultScene(sceneId: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(VAULT_SCENE_STORE, sceneId)
  } catch { /* 忽略写入失败 */ }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<string>(VAULT_SCENE_EVENT, { detail: sceneId }))
    }
  } catch { /* 忽略广播失败 */ }
}

/** 清掉场景选中（回到「全部分组」，对应侧栏里那条没有场景的行）。 */
export function clearVaultScene(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(VAULT_SCENE_STORE)
  } catch { /* 忽略 */ }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<string>(VAULT_SCENE_EVENT, { detail: '' }))
    }
  } catch { /* 忽略 */ }
}

/**
 * 订阅场景切换（页面侧唯一入口）。
 * @param listener - 场景变化时调用；空串表示「回到全部」。
 * @returns 取消订阅函数。
 */
export function subscribeVaultScene(listener: (sceneId: string) => void): () => void {
  if (typeof window === 'undefined') return () => { /* 无 window：没有可订阅的东西 */ }
  const onScene = (event: Event): void => {
    const detail = (event as CustomEvent<string>).detail
    try {
      listener(typeof detail === 'string' ? detail : '')
    } catch (error) {
      console.error('[dsh-chat-plus] 档案场景监听器抛错：', error)
    }
  }
  window.addEventListener(VAULT_SCENE_EVENT, onScene)
  return () => {
    try {
      window.removeEventListener(VAULT_SCENE_EVENT, onScene)
    } catch { /* 忽略移除失败 */ }
  }
}

/**
 * 侧栏二级菜单的子项数据源：每个场景一行 + 该场景的记录数。
 *
 * 直接复用 /list 而不是给侧栏另开一个计数端点：侧栏与页面打开的是同一份
 * 快照，多开一个端点只会让「侧栏显示 3 条、页面里 4 条」这种错位变成可能。
 * 失败时**抛错**而不是返回空数组——调用方（侧栏）需要区分「真的没有场景」
 * 与「这次没拉到」，前者应显示内置场景，后者该保留上一次的结果。
 */
export async function fetchVaultSceneChildren(): Promise<
  Array<{ id: string; label: string; count: number }>
> {
  const response = await listVault()
  const counts = new Map<string, number>()
  for (const record of response.records) {
    counts.set(record.scene, (counts.get(record.scene) ?? 0) + 1)
  }
  return response.scenes.map((scene) => ({
    id: scene.id,
    label: scene.label,
    count: counts.get(scene.id) ?? 0,
  }))
}
