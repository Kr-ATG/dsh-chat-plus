/**
 * dsh-memory 共享类型：记忆条目、变更记录、ticker 状态与插件配置。
 * 全部为纯 JSON 可序列化结构（schema v1）。
 */

/** 记忆条目（~/.dsh/memories/dsh-memory/store/entries.json, schema v1）。 */
export interface MemoryEntry {
  /** mem_<sha1>，由 content+scope+projectHash 稳定推导（同内容合并）。 */
  id: string
  /** 记忆内容文本。 */
  content: string
  /** global=全局层（身份/偏好）；project=项目层（随工作区）。 */
  scope: 'global' | 'project'
  /** scope=project 时必填：workspace 路径的 sha1。 */
  projectHash: string | null
  /** 自定义标签（灵活分类手段）。 */
  tags: string[]
  /** 置顶标记（全局与项目各自独立）。 */
  pinned: boolean
  /** 已禁用（缺省/undefined = 启用）：条目保留在面板与检索中，但不参与会话注入与产物编译。 */
  disabled?: boolean
  /** 创建时间 ISO。 */
  createdAt: string
  /** 最近更新时间 ISO。 */
  updatedAt: string
  /** 初始 10；随 hit 增加、随天衰减。 */
  importance: number
  /** 被注入命中时刷新衰减起点。 */
  lastHitAt: string | null
  /** 当前所在层：short=短期时间线；long=长期沉淀。 */
  layer: 'short' | 'long'
  /** extract=自动提取；manual=用户手写。 */
  source: 'extract' | 'manual'

  // ── schema v2（MemCube 元数据：识别 / 控制 / 进化）─────────────────
  /** 条目级版本号（每次内容变更 +1；迁移自 v1 时补 1）。 */
  version: number
  /** 置信度 0-1：manual=1；extract 由 LLM 输出或默认 0.6。 */
  confidence: number
  /** 是否已被用户显式确认（手动记忆/手动编辑/裁决保留即置 true）。 */
  verified: boolean
  /** 显式记忆类型（替代靠标签猜 identity/fact）。 */
  kind: MemoryKind
  /** 溯源：产生该条目的会话 / 轮次 / 原始片段（截断，可缺省）。 */
  provenance?: { sessionId?: string; turn?: number; snippet?: string }
  /** 嵌入向量（Retrieval 层缓存；未算则缺省）。 */
  embedding?: number[]

  // ── schema v3（软废弃链 / revise-retire 支持）────────────────────
  /** 软废弃标记（true = 已废弃，默认不检索/不注入/不编译）。 */
  deprecated?: boolean
  /** 软废弃时间 ISO。 */
  deprecatedAt?: string
  /** 软废弃原因。 */
  deprecatedReason?: string
  /** 后继条目 id（revise 时指向新条目）。 */
  supersededBy?: string
}

/** 显式记忆类型（compile 按此分组，不再靠标签硬猜）。 */
export type MemoryKind = 'identity' | 'preference' | 'fact' | 'decision' | 'gotcha' | 'session-summary'

/** 变更流记录（changes/<date>.jsonl，驱动通知与裁决）。 */
export interface ChangeRecord {
  /** 变更记录自身 id（时间戳+随机）。 */
  id: string
  /** add=新增；update=更新；promote=升长期；delete=删除；revise=软废弃+后继；retire=软废弃；consolidate=整理汇总。 */
  action: 'add' | 'update' | 'promote' | 'delete' | 'revise' | 'retire' | 'consolidate'
  /** 关联记忆条目 id（consolidate 汇总记录为空串）。 */
  entryId: string
  scope: 'global' | 'project'
  projectHash: string | null
  /** 摘要（截断 80 字）。 */
  summary: string
  /** 变更前内容（update/delete 时的旧内容，供面板前后对比）。 */
  before?: string
  /** 变更后内容（add/update 时的新内容，供面板前后对比）。 */
  after?: string
  /** ISO 时间。 */
  at: string
}

/** ticker 调度状态（store/state.json）。 */
export interface StoreState {
  /** 数据结构版本。 */
  schemaVersion: 1
  /** 每个会话的轮数计数。 */
  perSession: Record<string, SessionTickerState>
  /** 上次每日编译日期（YYYY-MM-DD）。 */
  lastDailyDate: string | null
  /** 记忆注入被显式关闭的会话 id 列表。 */
  injectDisabled?: string[]
  /**
   * 记忆注入被显式开启的会话 id 列表（injectDefaultEnabled=false 时的白名单）。
   * 两个列表都不含该会话 = 未单独设置 = 跟随 config.injectDefaultEnabled。
   */
  injectForced?: string[]
  /**
   * 中文记忆独立注入开关（全局单值，三态缺省）。
   * 该能力内置于插件、无卸载路径：主注入开关关闭、或所在项目被设为「不注入」
   * 时，中文偏好记忆仍会单独注入。缺省 = 跟随 config.zhInjectDefaultEnabled。
   */
  zhInjectEnabled?: boolean
  /**
   * 对话内流程图（diagram 围栏）能力规范注入开关（全局单值，三态缺省）。
   * 与 zh 通道同一范式：主注入关闭、项目被设为「不注入」时仍单独注入。
   * 缺省 = 跟随 config.diagramInjectDefaultEnabled（默认关——它是锦上添花的
   * 呈现能力，不是语言契约，不该每个会话白烧一份常驻 token）。
   */
  diagramInjectEnabled?: boolean
}

/** 单个会话的 ticker 状态。 */
export interface SessionTickerState {
  /** 累计 turn 数。 */
  turnCount: number
  /** 上次注入的 step 数。 */
  lastInjectedStep: number
  /** 连续提取失败（0 候选/LLM 错误）次数，用于退避降频。 */
  extractFailStreak?: number
}

/** 项目元数据（projects/<hash>/meta.json）。 */
export interface ProjectMeta {
  /** 会话创建时的 workspace 路径。 */
  path: string
  /** 显示别名（面板可改）。 */
  alias: string | null
  /** 用户手动改过归属则锁定（不再自动跟随工作区）。 */
  locked: boolean
  /** 是否自动记忆（自动提取）。默认 true；false = 该工作区关闭自动提取。 */
  autoMemory?: boolean
  /**
   * 是否把该工作区排除出记忆注入。默认 false（不排除）；
   * true = 在该工作区的会话里，agent/pre-step 不再注入记忆条目
   * （自动提取、手动记忆、检索、面板展示都不受影响）。
   */
  injectExcluded?: boolean
}

/** 插件配置（cordis.patch.yml 可覆盖）。 */
export interface MemoryConfig {
  /** 每 N 轮提取一次（turn/end 触发；1=每次）。 */
  extractEveryTurns: number
  /** 每 N 轮增量编译 timeline。 */
  compileEveryTurns: number
  /** 低于该 importance 的短期条目不进入注入产物。 */
  compileThreshold: number
  /** 每天衰减系数（importance *= 1 - λ 的 λ）。 */
  decayLambda: number
  /** 被注入命中时的加分。 */
  hitBonus: number
  /** 注入 token 预算（按字符近似）。 */
  injectTokenBudget: number
  /**
   * 每 N 个 step 刷新一次记忆注入（会话内）。
   * @deprecated 当前注入按设计只在会话首步进行一次（避免置顶内容多轮重复），
   * 该字段无读取方；保留仅为兼容既有 config.json，面板不再暴露。
   */
  injectRefreshSteps: number
  /** 是否启用每日编译（可关，保留轮数增量）。 */
  dailyCompileEnabled: boolean
  /** 提取窗口最大字符数。 */
  extractMaxChars: number
  /** 低于该 importance 的候选直接丢弃。 */
  minImportance: number
  /** 是否启用每日 LLM 语义整理（Memory Dream，openhanako 同款）。 */
  consolidateEnabled: boolean
  /** 单次整理最大条目数（token 保护；超过则只取短期层 + 最近更新）。 */
  consolidateMaxEntries: number
  /** 整理 LLM 调用超时（毫秒）。 */
  consolidateTimeoutMs: number
  /**
   * 整理专用模型 provider（留空=跟随默认模型 agentDefaultModel）。
   * 背景：整理任务要求模型输出较长推理再给 JSON 决策，慢模型（如 vision 系）
   * 20 条就要 4 分钟、200 条必超时；指定纯文本快模型可显著提速。
   */
  consolidateProvider?: string
  /** 整理专用模型 id（与 consolidateProvider 成对；只填一个视为未配置）。 */
  consolidateModel?: string
  /** 是否记录 API 请求日志（默认 false；防 api.log 被面板轮询请求灌满）。 */
  logApiRequests: boolean
  /**
   * 记忆注入默认开关（对话框左端大脑按钮的初始态）：
   * true = 新会话默认注入；false = 新会话默认不注入。
   * 用户在具体会话里手动开/过关，会写入会话级覆盖（state.json），
   * 覆盖优先于本默认值（见 store.isInjectEnabled）。
   */
  injectDefaultEnabled: boolean
  /**
   * 中文记忆独立注入默认开关（内置能力，默认开）。
   *
   * 与 injectDefaultEnabled 完全解耦：主注入整体关闭时，中文偏好记忆
   * （kind=preference/identity 且正文含中文）仍单独注入一条独立 user
   * message。该能力硬编码在插件内，不提供卸载/移除入口——只有这个开关。
   */
  zhInjectDefaultEnabled: boolean
  /**
   * 对话内流程图能力规范注入默认开关（内置能力，默认关）。
   *
   * 与 zhInjectDefaultEnabled 同构：内置于插件、无卸载路径，只有这一个开关。
   * 打开后每个会话首步注入一条内置 user message，告诉模型本客户端的
   * `diagram` 围栏 JSON 规范（flowchart 语法与全部硬限制），使模型能自动
   * 在对话里画出 SVG 流程图卡片。关着时模型完全不知道这个围栏存在。
   *
   * 默认关的理由：它只影响「要不要额外渲染一张图」，不影响任务正确性；
   * 而规则文本约 1KB，每会话常驻首轮，开销换不回对等收益。
   */
  diagramInjectDefaultEnabled: boolean
  /** 注入检索 top-k（当前任务相关记忆注入条数；identity/pinned/长期常驻不占此预算）。 */
  injectTopK: number
  /** 全局条目数上限（超限按 importance + recency 淘汰低分条目）。 */
  entryLimit: number
  /**
   * 闲置自动清理（天）：自动提取条目按「最后活跃时间」清理——最后命中时间
   * （从未命中则用创建时间）距今满 N 天的条目在每日编译时删除。置顶 / 已确认 /
   * 手动 / 禁用豁免（用户显式意图或价值确认）。0 = 关闭。
   */
  pruneNeverHitDays: number

  // ── schema v3：语义检索（embedding）配置 ────────────────────────────
  /**
   * 语义检索后端：off=关闭（hybrid 回退）；http=OpenAI 兼容 embedding API；
   * local=本地 ONNX 模型（@xenova/transformers，需先安装该依赖）。
   * 默认 off——DSH 无 embedding 接口，纯本地 n-gram 已够用；需要更强语义时开启。
   */
  embeddingProvider: 'off' | 'http' | 'local'
  /** embedding API 地址（OpenAI 兼容，如 https://api.openai.com/v1）。 */
  embeddingBaseUrl: string
  /** embedding 模型名（http：如 text-embedding-3-small；local：如 Xenova/all-MiniLM-L6-v2）。 */
  embeddingModel: string
  /** embedding API 密钥（http 模式；也可用环境变量 DSH_MEMORY_EMBEDDING_API_KEY）。 */
  embeddingApiKey: string
  /** embedding 向量维度（http 模式必须与模型一致；local 自动检测）。 */
  embeddingDimensions: number
}

/** 默认配置。 */
export const DEFAULT_CONFIG: MemoryConfig = {
  extractEveryTurns: 1,
  compileEveryTurns: 10,
  compileThreshold: 4.5,
  decayLambda: 0.02,
  hitBonus: 2,
  injectTokenBudget: 6000,
  injectRefreshSteps: 8,
  dailyCompileEnabled: true,
  extractMaxChars: 6000,
  minImportance: 7,
  consolidateEnabled: true,
  // 增量演进模式：一次只整理「最近更新」的 20 条（对齐 ReMe auto_dream 的小撮
  // 单元策略）。20 条约 3-5K 字符：慢模型实测 ~230s 可完成（<300s 超时），
  // 快模型十几秒；不做全库 200 条大输入（4 万字符必超时）。
  consolidateMaxEntries: 20,
  // 300s：60s 默认对 200 条输入（3-4 万字符）远不够——实测 bai/vision 系
  // 模型连 70 条都会 60s 超时，导致整理永远失败且被误报「无需整理」。
  consolidateTimeoutMs: 300_000,
  logApiRequests: false,
  injectDefaultEnabled: true,
  zhInjectDefaultEnabled: true,
  diagramInjectDefaultEnabled: false,
  injectTopK: 8,
  entryLimit: 500,
  pruneNeverHitDays: 21,
  embeddingProvider: 'off',
  embeddingBaseUrl: '',
  embeddingModel: 'text-embedding-3-small',
  embeddingApiKey: '',
  embeddingDimensions: 0,
}

/** LLM 整理操作（consolidate.ts 的 LLM 输出结构）。 */
export interface ConsolidateOp {
  /** merge=合并多条为一条；rewrite=重写单条；drop=删除；promote=升长期。 */
  type: 'merge' | 'rewrite' | 'drop' | 'promote'
  /** 参与该操作的条目 id（merge/drop/promote 可多条；rewrite 单条）。 */
  ids: string[]
  /** merge/rewrite 的新内容（不含原条目中不存在的虚构信息）。 */
  content?: string
  /** merge/rewrite 的新标签。 */
  tags?: string[]
}

/** 整理统计结果（供面板/工具返回）。 */
export interface ConsolidateResult {
  /** 本次整理的 scope：global | project:<hash> | all。 */
  scope: string
  /** 合并条数（源条目被合并后数量减少）。 */
  merged: number
  /** 重写条数。 */
  rewritten: number
  /** 删除条数。 */
  dropped: number
  /** 提升长期条数。 */
  promoted: number
  /** 整理产生的条目变动总数（merge 按源条目数 + 1 计）。 */
  changed: number
  /**
   * 本次整理未完成的原因（跳过/超时/LLM 异常等），undefined=正常结束
   * （「无需整理」也属正常结束：LLM 判定 0 ops）。面板据此区分
   * 「整理失败」与「记忆已是最佳状态」，不再把失败误报成无需整理。
   */
  failed?: string
}

/** 修订版本元数据（revisions/<id>.json）。 */
export interface RevisionMeta {
  /** 修订 id（时间戳 + 随机）。 */
  id: string
  /** 快照时间 ISO。 */
  at: string
  /** 快照内条目数。 */
  entryCount: number
  /** 触发范围（global | project:<hash> | all）。 */
  scope: string
  /** 触发动机：daily=每日自动；manual=手动/工具触发。 */
  trigger: 'daily' | 'manual'
}

/** LLM 提取候选（extract.ts 的 LLM 输出结构）。 */
export interface ExtractCandidate {
  content: string
  scope: 'global' | 'project'
  tags: string[]
  importance: number
}

// ── 配置覆盖与公开视图（cordis.patch.yml 与 config.json 共用） ────────

/** 数值字段的取值域（面板输入越界时钳制而非丢弃；integer 字段四舍五入取整）。 */
export const CONFIG_NUMBER_BOUNDS = {
  extractEveryTurns: { min: 1, max: 100, int: true, step: 1 },
  compileEveryTurns: { min: 1, max: 500, int: true, step: 1 },
  compileThreshold: { min: 0, max: 20, int: false, step: 0.5 },
  decayLambda: { min: 0, max: 0.5, int: false, step: 0.01 },
  hitBonus: { min: 0, max: 10, int: false, step: 0.5 },
  injectTokenBudget: { min: 1000, max: 60_000, int: true, step: 500 },
  injectRefreshSteps: { min: 1, max: 200, int: true, step: 1 },
  extractMaxChars: { min: 500, max: 60_000, int: true, step: 500 },
  minImportance: { min: 1, max: 10, int: false, step: 0.5 },
  consolidateMaxEntries: { min: 10, max: 2000, int: true, step: 10 },
  consolidateTimeoutMs: { min: 5000, max: 600_000, int: true, step: 5000 },
  injectTopK: { min: 1, max: 50, int: true, step: 1 },
  entryLimit: { min: 50, max: 100_000, int: true, step: 50 },
  pruneNeverHitDays: { min: 0, max: 3650, int: true, step: 1 },
} as const satisfies Record<string, { min: number; max: number; int: boolean; step: number }>

/** 可调数值字段名。 */
export type ConfigNumberKey = keyof typeof CONFIG_NUMBER_BOUNDS

const CONFIG_NUMBER_KEYS = Object.keys(CONFIG_NUMBER_BOUNDS) as ConfigNumberKey[]

const CONFIG_BOOLEAN_KEYS = ['dailyCompileEnabled', 'consolidateEnabled', 'logApiRequests', 'injectDefaultEnabled', 'zhInjectDefaultEnabled', 'diagramInjectDefaultEnabled'] as const

/** 可调布尔字段名。 */
export type ConfigBooleanKey = (typeof CONFIG_BOOLEAN_KEYS)[number]

/** 可选字符串配置字段（embedding 连接信息 / 整理模型，留空=未配置/跟随默认）。 */
export type ConfigStringKey =
  | 'embeddingBaseUrl'
  | 'embeddingModel'
  | 'embeddingApiKey'
  | 'consolidateProvider'
  | 'consolidateModel'

/** 可调 embedding provider 值。 */
export type EmbeddingProviderMode = MemoryConfig['embeddingProvider']

/**
 * 应用配置覆盖（原地更新 config；返回实际应用的字段子集，供持久化）。
 * 数值按 CONFIG_NUMBER_BOUNDS 钳制到合法域（越界钳制而非静默丢弃——
 * 旧实现要求 value > 0，导致 decayLambda=0 / compileThreshold=0 等
 * 合法的"关闭衰减/不设阈值"写不进去，面板上看似保存成功实则被丢弃）。
 */
export function applyConfigOverrides(config: MemoryConfig, candidate: unknown): Partial<MemoryConfig> {
  const applied: Partial<MemoryConfig> = {}
  if (candidate === null || typeof candidate !== 'object') return applied
  const raw = candidate as Record<string, unknown>
  for (const key of CONFIG_NUMBER_KEYS) {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const bounds = CONFIG_NUMBER_BOUNDS[key]
    let next = Math.min(bounds.max, Math.max(bounds.min, value))
    if (bounds.int) next = Math.round(next)
    else next = Math.round(next * 100) / 100
    ;(config as unknown as Record<string, unknown>)[key] = next
    ;(applied as unknown as Record<string, unknown>)[key] = next
  }
  for (const key of CONFIG_BOOLEAN_KEYS) {
    const value = raw[key]
    if (typeof value === 'boolean') {
      ;(config as unknown as Record<string, unknown>)[key] = value
      ;(applied as unknown as Record<string, unknown>)[key] = value
    }
  }
  // 字符串配置（embedding 连接信息）：仅在明确传入字符串时覆盖，空串=清空。
  for (const key of CONFIG_STRING_KEYS) {
    if (typeof raw[key] === 'string') {
      ;(config as unknown as Record<string, unknown>)[key] = raw[key]
      ;(applied as unknown as Record<string, unknown>)[key] = raw[key]
    }
  }
  // embedding provider 枚举：非法值忽略。
  const provider = raw.embeddingProvider
  if (provider === 'off' || provider === 'http' || provider === 'local') {
    ;(config as unknown as Record<string, unknown>).embeddingProvider = provider
    ;(applied as unknown as Record<string, unknown>).embeddingProvider = provider
  }
  // embeddingDimensions：0 或正整数。
  const dims = raw.embeddingDimensions
  if (typeof dims === 'number' && Number.isFinite(dims) && dims >= 0) {
    const rounded = Math.round(dims)
    ;(config as unknown as Record<string, unknown>).embeddingDimensions = rounded
    ;(applied as unknown as Record<string, unknown>).embeddingDimensions = rounded
  }
  return applied
}

/** 面板可展示的公开配置视图（只暴露可调字段）。 */
export function publicConfig(config: MemoryConfig): Partial<MemoryConfig> {
  const out: Record<string, unknown> = {}
  for (const key of CONFIG_NUMBER_KEYS) out[key] = config[key]
  for (const key of CONFIG_BOOLEAN_KEYS) out[key] = config[key]
  for (const key of CONFIG_STRING_KEYS) out[key] = config[key]
  out.embeddingProvider = config.embeddingProvider
  out.embeddingDimensions = config.embeddingDimensions
  return out as Partial<MemoryConfig>
}

/** 可覆盖的字符串配置字段列表。 */
const CONFIG_STRING_KEYS = ['embeddingBaseUrl', 'embeddingModel', 'embeddingApiKey'] as const satisfies readonly ConfigStringKey[]
