/**
 * dsh-vault 共享类型：档案记录、字段、照片、场景与配置。
 *
 * ── 这个模块是什么（以及为什么它不是记忆库）──────────────────────────
 * 「档案」记的是**结构化事实**：某个账户的用户名/密码/邮箱、某张证件的
 * 号码/有效期/正反面照片、某张卡的卡号/有效期。它与记忆库是两套东西：
 *
 *   · 记忆库存**陈述句**（「用户偏好中文」），适合模糊检索与语义去重，但
 *     装不下「字段」——「某账户密码从 A 变成 B」在句子里只能再加一句，
 *     两个版本同时躺在上下文里，模型无从判断谁有效。
 *   · 档案存**实体 + 字段**。同一账户再来一次「密码是 xxx」，是就地改字段
 *     并留一行历史，不是追加一条记录。这是本模块存在的根本理由。
 *
 * ── 三条与记忆库刻意相反的取舍（用户明确要求）────────────────────────
 *  1. 不受工作区开关影响。记忆库有「本工作区关自动记忆→不抽取」「本工作区
 *     排除注入→不进上下文」两道闸门；档案一律不受其管辖，有自己的开关
 *     （VaultConfig.autoRecord / autoInject），默认全开。物理上也不共享代码
 *     路径：本模块的抽取与注入都不读记忆库的 store。
 *  2. 敏感值加密落盘。密码/密钥/卡号在 records.json 里是
 *     "secret:v1:<base64(iv|tag|密文)>"，密钥在 vault/key（0600）。
 *  3. 敏感值绝不进模型上下文。注入只写「这个账户有密码字段，值已加密」。
 *     要看明文只有人能看（页面点「显示」）。注入内容会发给模型厂商。
 *
 * ── schema 版本与迁移 ────────────────────────────────────────────────
 * vault.json 带 schemaVersion。读到更老版本由 store.migrate 逐级升级；
 * 读到**更新**版本（用户降级了插件）一律只读，绝不写回——用不认识的形状
 * 覆盖新数据，丢字段是静默的。
 */

/** 当前数据结构版本。加字段/改语义时 +1，并补一级 migrate。 */
export const VAULT_SCHEMA_VERSION = 1

/**
 * 敏感字段在 HTTP 响应里的掩码（**客户端与 host 必须用同一个字面量**）。
 *
 * 页面拿到的记录里，敏感字段的 value 一律是这个掩码而不是明文——明文只有
 * 用户点「显示」时才经 /reveal 单独取一次。这样做的两个理由：
 *  1. 明文不必在浏览器里长期驻留（列表一次几千条时，明文全在内存里没有好处）；
 *  2. 提交回来的表单若还带着掩码，host 侧能明确识别出「用户没改这个字段」，
 *     从而保留原值——而不是把一串星号写成新密码。
 */
export const VAULT_MASK = '********'

/** 判断一个字段值是否为「未改动」的掩码。 */
export function isMaskedValue(value: string): boolean {
  return value === VAULT_MASK
}

/** 数据根目录名（位于 <DSH_HOME>/memories/ 下，与 dsh-memory 并列不同前缀）。 */
export const VAULT_HOME_DIR = 'dsh-chat-vault'

/* ───────────────────────────── 字段 ───────────────────────────── */

/** 字段显示类型：决定页面用什么控件、怎么渲染（与 sensitive 正交）。 */
export type VaultFieldType =
  /** 普通文本（用户名、账户名）。 */
  | 'text'
  /** 密码/密钥：页面用密码框，且必然 sensitive。 */
  | 'secret'
  | 'email'
  | 'phone'
  | 'url'
  /** ISO 日期（有效期）：页面用日期控件，注入时按剩余天数提示。 */
  | 'date'
  /** 纯数字（金额、末四位）。 */
  | 'number'
  /** 多行备注（某个字段的补充说明）。 */
  | 'note'

/** 一个字段。 */
export interface VaultField {
  /**
   * 字段稳定标识（password / username / expiry）。
   *
   * **自动更新的锚点**：模型报「密码变成 xxx」时靠 key 找到同一行同名字段
   * 就地改；靠 label 匹配会因为「密码 / 登录密码 / Password」三种写法漂移，
   * 同一个字段长出三条，历史就断了。所以 key 一律小写 ASCII 短横线，
   * label 才是给人看的。
   */
  key: string
  /** 显示名（中文优先）。 */
  label: string
  /** 显示与输入类型。 */
  type: VaultFieldType
  /**
   * 落盘是否加密、注入是否屏蔽。
   *
   * 缺省规则见 isFieldSensitive：type='secret' 一律 true，其余缺省 false。
   * 用户把卡号/证件号标成敏感也走这条，于是落盘加密、注入只报「有值」。
   */
  sensitive?: boolean
  /**
   * 字段值。磁盘上是编码后的字符串（敏感字段为 secret:v1:...）；内存态由
   * store 解密后交给页面。**明文只在内存与 HTTP 响应里存在，绝不进上下文**。
   */
  value: string
  /** 该字段最后变化时间 ISO。 */
  updatedAt: string
  /** 单位/后缀（纯展示）。 */
  unit?: string
  /** 是否在列表摘要行显示（缺省：敏感不显示，其余显示）。 */
  inSummary?: boolean
}

/* ───────────────────────────── 照片 ───────────────────────────── */

/**
 * 三档图片尺寸（**「减小占用」的主手段**）。
 *
 * 本机实测（三张最大的真实图片，JPEG q75）：
 *   1561×993 / 2.1MB → 1600 长边 270KB（12%）→ 512 长边 36KB（1.7%）
 *   1280×1920 / 1.85MB → 1600 长边 184KB（10%）→ 512 长边 30KB（1.6%）
 * 所以展示图档按 1600 长边压，体积约原图 10%；列表只用缩略图。
 */
export type VaultImageVariant = 'thumb' | 'display' | 'original'

/** 单档图片的字节引用（内容寻址：同字节只落一份）。 */
export interface VaultBlobRef {
  /** 字节的 sha256（十六进制）；blobs/<sha256> 即文件路径。 */
  sha256: string
  /** 实际媒体类型（host 侧校验魔数）。 */
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  /** 编码宽高（像素）。 */
  width: number
  height: number
  /** 字节数（配额统计与页面提示用）。 */
  bytes: number
  /** 原始文件名（去路径；仅展示）。 */
  name?: string
}

/**
 * 一张照片 = 一个逻辑单位（证件正面/背面、支付码）+ 最多三档字节。
 *
 * 为什么一张照片挂三档而不是三条记录：页面要的是「这张图」，档位只是同一张
 * 图的不同分辨率。拆成三条后「删掉这张图」要同时删三条并保持 sha 一致，
 * 引用计数反而更容易算错。
 */
export interface VaultPhoto {
  /** photo_<16 位十六进制>。 */
  id: string
  /** 角色：front / back / extra / 或关联字段 key。 */
  role: string
  /** 显示名（「身份证正面」）。 */
  label: string
  /** 关联的字段 key（纯展示提示）。 */
  fieldKey?: string
  /** 各档字节：display 必有；thumb / original 可缺省。 */
  blobs: {
    thumb?: VaultBlobRef
    display: VaultBlobRef
    original?: VaultBlobRef
  }
  createdAt: string
}

/* ───────────────────────────── 变更历史 ───────────────────────────── */

/** 变更来源。 */
export type VaultChangeSource = 'extract' | 'manual'

/** 一条变更记录（挂在记录上，全量快照另存 revisions/）。 */
export interface VaultChange {
  at: string
  action:
    | 'create'
    | 'field-add'
    | 'field-update'
    | 'field-remove'
    | 'photo-add'
    | 'photo-remove'
    | 'scene-move'
    | 'title-update'
    | 'archive'
    | 'restore'
  /** 涉及字段 key（field-* 时必填）。 */
  fieldKey?: string
  /** 变更前（敏感字段**不写明文**，写「已加密」）。 */
  before?: string
  /** 变更后（同上）。 */
  after?: string
  source: VaultChangeSource
}

/** 单条记录保留的变更条数（超出丢最老；全量在 revisions/）。 */
export const MAX_CHANGES_PER_RECORD = 60

/* ───────────────────────────── 记录 ───────────────────────────── */

/** 一条档案记录 = 一个实体（账户 / 证件 / 卡 / 联系人）。 */
export interface VaultRecord {
  /** rec_<16 位十六进制>。 */
  id: string
  /** 所属场景 id（记录只引用 id，不引用 label——改名不动记录）。 */
  scene: string
  /**
   * 主标题，人与模型都靠它认这一行。账户类建议「平台 · 账号」
   * （GitHub · Kr-ATG），证件类建议「驾驶证 · 张三」。
   */
  title: string
  /** 副标题（手机号后四位、卡组织；可缺省）。 */
  subtitle?: string
  /** 字段列表（顺序 = 页面显示顺序）。 */
  fields: VaultField[]
  /** 照片。 */
  photos: VaultPhoto[]
  /** 自由标签（跨场景检索）。 */
  tags: string[]
  /** 记录级备注。 */
  note?: string
  createdAt: string
  updatedAt: string
  /** 最近一次在页面打开的时间（配额淘汰与「最近用过」排序）。 */
  lastOpenedAt?: string
  /** 来源。 */
  source: 'extract' | 'manual'
  /**
   * 抽取可信度 0-1（人工录入恒 1）。
   *
   * 自动抽取的低可信度结果挂 pending 等确认——尤其「改已有字段」这种破坏性
   * 操作，宁可先挂着也不要静默覆盖掉正确值。
   */
  confidence: number
  /** true = 自动抽取未确认（页面单列一栏；仍注入但标注「未确认」）。 */
  pending?: boolean
  /** true = 已归档（软删，保留数据与历史，不注入）。 */
  archived?: boolean
  /** 条目版本号（每次内容变更 +1）。 */
  version: number
  /** 手动排序偏置（缺省按 updatedAt 降序）。 */
  order?: number
  /** 变更历史（最近 MAX_CHANGES_PER_RECORD 条）。 */
  changes: VaultChange[]
  /** 溯源：产生该记录的会话/轮次。 */
  provenance?: { sessionId?: string; turn?: number }
}

/* ───────────────────────────── 场景 ───────────────────────────── */

/**
 * 一个场景（= 页面上的分组卡 = 侧栏二级菜单的一行）。
 *
 * 内置 6 类对齐用户给的截图（Chrome 密码管理器那种分组）。场景定义与记录
 * 分开存（scenes 在 vault.json 里，改名不动记录）。
 */
export interface VaultScene {
  /** 稳定 id（accounts / email / payment / contact / document / other）。 */
  id: string
  /** 显示名（可改）。 */
  label: string
  /** 一句话定位（可改）。 */
  desc: string
  order: number
  /** 内置场景只允许改名，不允许删除（抽取归集需要落点）。 */
  builtin: boolean
  /** 字段模板（新建记录时预填，用户可增删）。 */
  fieldTemplate: Array<Pick<VaultField, 'key' | 'label' | 'type' | 'sensitive'>>
  /** 是否以照片为主（证件类 true，只影响页面按钮提示）。 */
  photoFirst?: boolean
}

/** 内置场景（首次运行写入）。 */
export const DEFAULT_SCENES: readonly VaultScene[] = [
  {
    id: 'accounts',
    label: '账号密码',
    desc: '网站的账户与密码',
    order: 10,
    builtin: true,
    fieldTemplate: [
      { key: 'username', label: '用户名', type: 'text' },
      { key: 'password', label: '密码', type: 'secret' },
      { key: 'email', label: '绑定邮箱', type: 'email' },
      { key: 'url', label: '站点', type: 'url' },
    ],
  },
  {
    id: 'email',
    label: '邮箱与登录',
    desc: '邮箱账户、二次验证',
    order: 20,
    builtin: true,
    fieldTemplate: [
      { key: 'address', label: '邮箱地址', type: 'email' },
      { key: 'password', label: '密码', type: 'secret' },
      { key: 'recovery', label: '恢复邮箱', type: 'email' },
      { key: 'totp', label: '二次验证', type: 'secret' },
    ],
  },
  {
    id: 'payment',
    label: '支付方式',
    desc: '银行卡、信用卡、会员卡',
    order: 30,
    builtin: true,
    fieldTemplate: [
      { key: 'number', label: '卡号', type: 'text', sensitive: true },
      { key: 'holder', label: '持卡人', type: 'text' },
      { key: 'expiry', label: '有效期', type: 'date' },
      { key: 'cvv', label: '安全码', type: 'secret' },
    ],
  },
  {
    id: 'contact',
    label: '联系方式',
    desc: '电话、地址、社交账号',
    order: 40,
    builtin: true,
    fieldTemplate: [
      { key: 'phone', label: '电话', type: 'phone' },
      { key: 'address', label: '地址', type: 'text' },
      { key: 'im', label: '社交账号', type: 'text' },
    ],
  },
  {
    id: 'document',
    label: '证件',
    desc: '身份证、驾驶证、护照（含照片）',
    order: 50,
    builtin: true,
    photoFirst: true,
    fieldTemplate: [
      { key: 'number', label: '证件号码', type: 'text', sensitive: true },
      { key: 'name', label: '姓名', type: 'text' },
      { key: 'expiry', label: '有效期至', type: 'date' },
      { key: 'issuer', label: '签发机关', type: 'text' },
    ],
  },
  {
    id: 'other',
    label: '其它',
    desc: '不属于以上分类的记录',
    order: 90,
    builtin: true,
    fieldTemplate: [],
  },
]

/* ───────────────────────────── 存储与配置 ───────────────────────────── */

/** 顶层落盘结构（vault.json）。 */
export interface VaultData {
  schemaVersion: number
  records: VaultRecord[]
  scenes: VaultScene[]
  /** 上次配额统计（仅展示，不参与判定）。 */
  lastStats?: VaultStats
}

/** 占用统计（面板展示 + 配额判定）。 */
export interface VaultStats {
  records: number
  photos: number
  /** 全部 blob 字节数（去重后）。 */
  blobBytes: number
  /** 各档分布（让用户看懂「原图占了多少」）。 */
  byVariant: Record<VaultImageVariant, { count: number; bytes: number }>
  computedAt: string
}

/** 插件配置（cordis.patch.yml 可覆盖，页面可改其中一部分）。 */
export interface VaultConfig {
  /** 自动记录总开关（默认开）。与记忆库的 autoMemory 互不影响。 */
  autoRecord: boolean
  /** 自动注入总开关（默认开）。与记忆库的 injectDefaultEnabled 无关。 */
  autoInject: boolean
  /** 每 N 轮抽取一次。 */
  extractEveryTurns: number
  /** 抽取模型（留空跟随会话默认模型）。 */
  extractProvider?: string
  extractModel?: string
  /** 抽取超时毫秒。 */
  extractTimeoutMs: number
  /**
   * 关键词预筛（**省成本的关键**）。
   *
   * 抽取前先看本轮对话有没有账号/密码/邮箱/证件这类词；一次没出现就跳过
   * LLM 调用。绝大多数轮次与「账户信息」无关，这道筛子省掉大半调用。
   */
  prefilter: boolean
  /** 注入 token 预算（按字符近似）。 */
  injectBudget: number
  /** 注入最多带多少条记录（超出按最近更新优先）。 */
  injectMaxRecords: number
  /**
   * 自动抽取的字段修改是否直接生效。
   *
   * false（默认）= 新记录直接生效，但对**已有记录的字段修改**挂 pending 等
   * 确认——覆盖别人的密码比漏记严重得多。
   */
  trustAutoUpdates: boolean
  /** 展示图长边。 */
  displayMaxEdge: number
  /** 缩略图长边。 */
  thumbMaxEdge: number
  /** JPEG 质量 0-1。 */
  imageQuality: number
  /** 是否保存原图（默认 false——原图是唯一能吃满磁盘的档位）。 */
  keepOriginal: boolean
  /** 总配额字节（默认 512MB）。超出按「先删原图、再删展示图」淘汰。 */
  quotaBytes: number
  /** 单条记录最多照片数。 */
  maxPhotosPerRecord: number
  /** 归档照片保留天数（0 = 永不清理）。 */
  photoRetentionDays: number
  /** 是否加密落盘（默认 true；关掉仅供排障）。 */
  encryptSecrets: boolean
}

/** 默认配置。 */
export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  autoRecord: true,
  autoInject: true,
  extractEveryTurns: 1,
  extractTimeoutMs: 30_000,
  prefilter: true,
  injectBudget: 4000,
  injectMaxRecords: 40,
  trustAutoUpdates: false,
  displayMaxEdge: 1600,
  thumbMaxEdge: 512,
  imageQuality: 0.75,
  keepOriginal: false,
  quotaBytes: 512 * 1024 * 1024,
  maxPhotosPerRecord: 12,
  photoRetentionDays: 0,
  encryptSecrets: true,
}

/** 数值字段取值域（越界钳制而非丢弃）。 */
export const VAULT_NUMBER_BOUNDS = {
  extractEveryTurns: { min: 1, max: 100, int: true, step: 1 },
  extractTimeoutMs: { min: 5000, max: 300_000, int: true, step: 5000 },
  injectBudget: { min: 500, max: 60_000, int: true, step: 500 },
  injectMaxRecords: { min: 1, max: 500, int: true, step: 5 },
  displayMaxEdge: { min: 512, max: 4096, int: true, step: 128 },
  thumbMaxEdge: { min: 128, max: 1024, int: true, step: 64 },
  imageQuality: { min: 0.4, max: 1, int: false, step: 0.05 },
  quotaBytes: { min: 32 * 1024 * 1024, max: 32 * 1024 * 1024 * 1024, int: true, step: 33554432 },
  maxPhotosPerRecord: { min: 1, max: 60, int: true, step: 1 },
  photoRetentionDays: { min: 0, max: 3650, int: true, step: 30 },
} as const satisfies Record<string, { min: number; max: number; int: boolean; step: number }>

/** 可调布尔字段名。 */
export type VaultBooleanKey = 'autoRecord' | 'autoInject' | 'prefilter' | 'trustAutoUpdates' | 'keepOriginal' | 'encryptSecrets'

/** 可调布尔字段（顺序 = 面板顺序）。 */
export const VAULT_BOOLEAN_KEYS: readonly VaultBooleanKey[] = [
  'autoRecord', 'autoInject', 'prefilter', 'trustAutoUpdates', 'keepOriginal', 'encryptSecrets',
]

/** 可调数值字段名。 */
export type VaultNumberKey = keyof typeof VAULT_NUMBER_BOUNDS

/** 应用配置覆盖（钳制越界值；返回实际生效的子集）。 */
export function applyVaultConfigOverrides(config: VaultConfig, candidate: unknown): Partial<VaultConfig> {
  const applied: Partial<VaultConfig> = {}
  if (candidate === null || typeof candidate !== 'object') return applied
  const raw = candidate as Record<string, unknown>
  for (const key of Object.keys(VAULT_NUMBER_BOUNDS) as VaultNumberKey[]) {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const bounds = VAULT_NUMBER_BOUNDS[key]
    let next = Math.min(bounds.max, Math.max(bounds.min, value))
    next = bounds.int ? Math.round(next) : Math.round(next * 100) / 100
    ;(config as unknown as Record<string, unknown>)[key] = next
    ;(applied as unknown as Record<string, unknown>)[key] = next
  }
  for (const key of VAULT_BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') {
      ;(config as unknown as Record<string, unknown>)[key] = raw[key]
      ;(applied as unknown as Record<string, unknown>)[key] = raw[key]
    }
  }
  for (const key of ['extractProvider', 'extractModel'] as const) {
    if (typeof raw[key] === 'string') {
      ;(config as unknown as Record<string, unknown>)[key] = raw[key]
      ;(applied as unknown as Record<string, unknown>)[key] = raw[key]
    }
  }
  return applied
}

/** 面板公开视图（只暴露可调字段）。 */
export function publicVaultConfig(config: VaultConfig): Partial<VaultConfig> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(VAULT_NUMBER_BOUNDS)) out[key] = config[key as VaultNumberKey]
  for (const key of VAULT_BOOLEAN_KEYS) out[key] = config[key]
  out.extractProvider = config.extractProvider ?? ''
  out.extractModel = config.extractModel ?? ''
  return out as Partial<VaultConfig>
}

/* ───────────────────────────── 工具函数 ───────────────────────────── */

/**
 * 字段是否按敏感处理。
 *
 * 唯一判定入口：type='secret' 一律敏感，其余看显式 sensitive。
 * **不要在各处各写一遍**——漏一处就是明文落盘。
 */
export function isFieldSensitive(field: Pick<VaultField, 'type' | 'sensitive'>): boolean {
  return field.type === 'secret' || field.sensitive === true
}

/** 记录里是否有敏感字段（注入时提示「有加密字段」用）。 */
export function hasSensitiveField(record: VaultRecord): boolean {
  return record.fields.some((field) => isFieldSensitive(field))
}

/**
 * 生成可注入的字段摘要（**非敏感字段才带值**）。
 *
 * 这是全模块唯一的注入口径，任何调用方都走这里，杜绝某处图省事把
 * field.value 直接拼进上下文。敏感字段连长度都不报——长度对猜密码有用。
 */
export function fieldSummaryOf(record: VaultRecord, budget = 180): string {
  const parts: string[] = []
  for (const field of record.fields) {
    if (isFieldSensitive(field)) {
      parts.push(field.label + '：已加密')
      continue
    }
    const value = field.value.trim()
    if (value === '') continue
    parts.push(field.label + '：' + (value.length > 60 ? value.slice(0, 60) + '…' : value))
  }
  const text = parts.join(' · ')
  return text.length > budget ? text.slice(0, budget) + '…' : text
}
