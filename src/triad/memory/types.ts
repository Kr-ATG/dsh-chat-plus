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

  // ── schema v5（待确认制）────────────────────────────────────────
  /**
   * 待确认标记（true = 自动抽取但用户尚未确认）。
   *
   * 为什么需要：自动抽取与用户手写原本平起平坐——两者入库即参与注入。
   * 实测近 20 天自动抽取 2464 条、用户手动删除 2472 条（其中 1781 次是
   * 「删除：」/「删除今日：」），净增约等于零：抽取管线本身没问题，问题是
   * 生成物大量不是用户想要的，而唯一的质量闸门是人事后翻面板去删。
   *
   * pending 把这道闸从「事后删」挪到「事前确认」：自动抽取默认挂 pending，
   * 不参与检索 / 注入 / 编译，用户在面板或对话里确认后才生效。
   *
   * 与 verified 的区别：verified 是「用户确认过这条内容」，语义上是可信度标记，
   * 不改可见性；pending 是可见性闸门。两者正交——pending 条目确认后同时置
   * verified=true，但 verified 可以独立于 pending 存在（老数据都没有 pending 字段）。
   *
   * 缺省/undefined = 已生效（老数据与手动记忆都是这个语义，无需迁移）。
   */
  pending?: boolean
  /** 进入待确认状态的时间 ISO（仅 pending=true 时有值，供面板按时间排序）。 */
  pendingAt?: string

  // ── schema v3（软废弃链 / revise-retire 支持）────────────────────
  /** 软废弃标记（true = 已废弃，默认不检索/不注入/不编译）。 */
  deprecated?: boolean
  /** 软废弃时间 ISO。 */
  deprecatedAt?: string
  /** 软废弃原因。 */
  deprecatedReason?: string
  /** 后继条目 id（revise 时指向新条目）。 */
  supersededBy?: string

  // ── schema v4（整理轮转）─────────────────────────────────────────
  /**
   * 上次被 LLM 整理（consolidate）处理的时间 ISO。
   *
   * 为什么需要它：整理集合原本按 updatedAt 降序取前 N 条，而整理自己产出的
   * 合并条目、晋升条目都会刷新 updatedAt —— 于是「刚被整理过的」永远排在最前，
   * 老条目永远轮不到（饥饿）。改用本字段升序选取（null 最优先）后，
   * 每个条目都能被均匀轮转，不会出现「20 条被反复咀嚼、其余永不处理」。
   */
  lastConsolidatedAt?: string
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
   * 对话内 HTML 卡片（html 围栏）能力规范注入开关（全局单值，三态缺省）。
   * 与 zh 通道同一范式：主注入关闭、项目被设为「不注入」时仍单独注入。
   * iu kind（含 graph/arch/sequence 图形卡）的能力文档随本通道一起注入。
   * 缺省 = 跟随 config.htmlInjectDefaultEnabled（默认关——它是呈现能力而非
   * 语言契约，规范文本约 1KB，不该每个会话白烧）。
   *
   * 历史注记：曾有 diagramInjectEnabled（对话内流程图通道，默认关），2026-10-09
   * 随图形 kind 上线整体移除；旧状态文件里残留的该字段无人读取，无害。
   */
  htmlInjectEnabled?: boolean
  /**
   * 团队协作（Agent Teams / 子代理委派）规范注入开关（全局单值，三态缺省）。
   * 与 html 同一范式：硬编码在插件内、无卸载路径，主注入关闭或项目被
   * 排除时仍单独注入。投的是一段静态规范文本（分档判据 + 组队硬规矩 + 反模式），
   * 不读条目、不做检索、不参与命中加分。
   * 缺省 = 跟随 config.teamInjectDefaultEnabled（默认开）。
   */
  teamInjectEnabled?: boolean
  /**
   * 回合结束自动收口开关（全局单值，三态缺省）。
   *
   * 与上面三条注入通道不同：它不往上下文里投文本，而是在 `agent/turn-stopping`
   * 把清单里残留的 in_progress 项改写为 pending——右栏「任务概览」卡在回合结束
   * 后不该还挂着一条「进行中」，那既不是真实状态（回合都结束了），也会让卡片
   * 永远显示成「卡住了」。仍然是全局单值：清单收口与否是流程纪律，逐会话开关
   * 只会制造「这个会话收、下个不收」的不可预期。
   * 缺省 = 跟随 config.todoClosureDefaultEnabled（见 store.isTodoClosureEnabled）。
   */
  todoClosureEnabled?: boolean
}

/** 单个会话的 ticker 状态。 */
export interface SessionTickerState {
  /** 累计 turn 数。 */
  turnCount: number
  /**
   * 连续**真失败**（LLM 抛错 / 超时 / finish≠stop / 解析不出 JSON）次数，用于退避降频。
   *
   * 与 extractEmptyStreak 分开统计是刻意的：模型返回 {"memories":[]} 是
   * 「本会话确实没啥值得记」，属于正常且被 prompt 鼓励的克制行为，不该触发降频
   * （旧实现合并计数，导致 55% 的正常空结果把会话打成降频态，覆盖率被系统性压低）。
   */
  extractFailStreak?: number
  /**
   * 连续**正常空结果**次数（模型明确返回空列表）。
   *
   * 只用来省成本：连续空说明这个会话不太产记忆，可以降频调用；一旦有候选立刻清零。
   * 不参与「失败」语义，也不与 extractFailStreak 互相影响。
   */
  extractEmptyStreak?: number
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
   * 置顶条目在注入预算里的占比上限（0-1，默认 0.4）。
   *
   * 旧实现让 pinned 无条件全量先进预算（注释还写着「不占预算」，与实现相反）：
   * 实测本机 6 条置顶吃掉 3000 预算里的 2130（71%），把 identity 段挤到只剩 1 条、
   * 检索 top-k 一条都进不去——置顶反而成了「把其它记忆全部饿死」的机制。
   * 超限时按 importance 降序保留，其余置顶退到普通候选池参与正常竞争。
   */
  injectPinnedBudgetRatio: number
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
   * 对话内 HTML 卡片能力规范注入默认开关（内置能力，**默认开**）。
   *
   * HTML 卡片是**交付形态本身**（可交互的小工具、可视化、演示页），不注入
   * 规范模型就永远不会想到用它，等于这个能力不存在。渲染器虽然无条件生效
   * （用户明确说「给我个 HTML 计算器」时照样会渲染），但「模型会主动用它」
   * 才是这个能力真正的价值所在。iu kind（13+3 种原生卡，含 graph/arch/sequence
   * 图形卡）的能力文档也随本通道注入——它们同属「呈现能力声明」，共用一个开关。
   * 文本约 2KB、每会话首步一次，换一个能被主动使用的交付形态，划算。
   *
   * 历史注记：曾有 diagramInjectDefaultEnabled（对话内流程图，默认关），2026-10-09
   * 移除——手工坐标的 ```diagram 围栏被自动布局的 graph kind 取代，后者随本通道
   * 默认开，能力从「常年闲置」变为「默认可用」。
   */
  htmlInjectDefaultEnabled: boolean
  /**
   * 团队协作（Agent Teams / 子代理委派）规范注入默认开关（内置能力，**默认开**）。
   *
   * 与 htmlInjectDefaultEnabled 同构：投的是一段静态规范文本，每会话首步一次。
   * 默认开的理由：模型默认单线程串完，不注入就不会主动并行委派与组队；
   * 文本自带分档判据（小事自己做），所以「默认开」不会退化成事事组队。
   * 与 diagram 默认关相反——diagram 只影响「要不要多画一张图」，不影响任务组织方式。
   */
  teamInjectDefaultEnabled: boolean
  /**
   * 回合结束自动收口默认开关（内置能力，**默认开**）。
   *
   * 与上面三条注入通道并列的第四条内置通道，但投的不是文本而是**行为**：
   * 回合收口时把残留的 in_progress 任务项改写成 pending（见 engine/todo-closure.ts）。
   * 默认开的理由：`todo` 投影是 last-write-wins 的整表快照，模型漏收尾时
   * in_progress 会一直挂在右栏任务卡上——这是纯展示层噪音，自动清掉没有副作用；
   * 用户真想在回合间保留「进行中」语义时，关掉即可。
   */
  todoClosureDefaultEnabled: boolean
  /** 注入检索 top-k（当前任务相关记忆注入条数；identity/pinned/长期常驻不占此预算）。 */
  injectTopK: number
  /**
   * 自动抽取是否走待确认制（pending）。
   *
   * true  = 抽取结果挂 pending，不检索/不注入/不编译，用户确认后才生效；
   * false = 抽取结果直接生效（旧行为）。
   *
   * 默认 **false**（保持旧行为）而不是 true——改成 true 意味着升级后所有自动
   * 记忆都不再进上下文，用户会突然觉得「它忘了我记住的东西」。这是产品决策，
   * 不该由升级悄悄替用户做。用户在面板打开后才切换。
   */
  extractRequireConfirm: boolean
  /**
   * pending 条目保留天数：超期未确认的自动抽取条目由每日编译清理。
   *
   * 为什么要有上限：pending 不注入，但会占条目配额、拖慢全量扫描、把面板的
   * 「待确认」页签堆成垃圾场。0 = 不自动清理（全部留待人工处置）。
   * 默认 14 天：两周都没被确认的自动产物，基本可以判定为噪声。
   */
  pendingRetentionDays: number
  /** 全局条目数上限（超限按 importance + recency 淘汰低分条目）。 */
  entryLimit: number
  /**
   * 闲置自动清理（天）：自动提取条目按「最后活跃时间」清理——最后命中时间
   * （从未命中则用创建时间）距今满 N 天的条目在每日编译时删除。置顶 / 已确认 /
   * 手动 / 禁用豁免（用户显式意图或价值确认）。0 = 关闭。
   *
   * 注意：本规则**不再单独生效**——它还要过 minImportanceForPrune 的分数门槛，
   * 见该字段。
   */
  pruneNeverHitDays: number
  /**
   * 闲置清理的分数门槛：importance >= 该值的条目不参与按天清理（默认 7）。
   *
   * 为什么必须加这道闸：闲置清理原本只看「多久没被命中」，不看分数。
   * 而注入每会话只做一次、top-k 实测 6 条，绝大多数条目在 N 天内根本不可能被命中
   * ——等于按概率删记忆，而不是按价值删。加上分数门槛后，高价值条目只有
   * shouldEvict（60 天 + 分数双阈值）才能滚出，两条规则的严格程度才回到同一量级。
   */
  minImportanceForPrune: number
  /**
   * 回收站保留天数：软废弃（retire / consolidate-drop）条目在 deprecatedAt
   * 满 N 天后由每日编译**硬删**。0 = 永不自动清。
   *
   * 为什么需要它：软废弃的设计意图是「保留数据但不再参与检索/注入/编译」，
   * 可它同时被 ticker 的全部规则跳过（不衰减/不晋升/不滚出/不清理），
   * entryLimit 淘汰也显式排除它 —— 结果是「回收站只进不出」，只能手动
   * memory_forget 逐条清。实测 27/134 条（20%）卡在回收站里永久占位。
   *
   * pinned 不豁免：pin 的语义是「这条活跃记忆很重要」，而软废弃已经宣告它
   * 退出活跃集，历史 pin 标记不该变成永久居留权。实测回收站里 7 条是 pinned
   * 的旧版本（todo 纪律/效率约束的历次修订），它们既占置顶预算又是重复内容。
   */
  deprecatedRetentionDays: number
  /**
   * **已被后继取代**的条目的保留天数（默认 7 天，0 = 跟随
   * deprecatedRetentionDays）。
   *
   * 为什么要比普通回收站短得多：这类条目的内容已经被后继条目完整继承
   * （supersededBy 指向它，而那条就在活跃库里）。保留它的唯一价值是「万一
   * revise 改错了，能把旧文本翻出来对照」——这个需求是小时级的，不是月级的。
   * 实测 27 条回收站里有 18 条带 supersededBy，它们纯粹是重复占位。
   *
   * 短保留期还给了一个额外好处：面板上「回收站」不再混着「已被新版本取代」
   * 和「用户主动删掉」两类语义完全不同的条目。
   */
  supersededRetentionDays: number

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
  // 置顶最多吃掉 40% 预算：剩下的 60% 留给 identity/长期沉淀/检索 top-k。
  // 旧行为是「置顶全额先扣」（实测 71%），identity 段被挤到 1 条、top-k 全灭。
  injectPinnedBudgetRatio: 0.4,
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
  // 默认开：HTML 卡片是交付形态本身（见字段注释），不注入模型就不会主动用。
  // iu 的 13+3 种 kind 文档（含图形三件套）也随本通道注入。
  htmlInjectDefaultEnabled: true,
  // 默认开：模型默认单线程串完，不注入就不会主动并行委派与组队（见字段注释）。
  teamInjectDefaultEnabled: true,
  // 默认开：回合结束后的残留 in_progress 是纯展示层噪音，自动改写为 pending 无副作用。
  todoClosureDefaultEnabled: true,
  injectTopK: 8,
  // 默认 false：升级不改既有可见性（见 extractRequireConfirm 注释）。
  extractRequireConfirm: false,
  pendingRetentionDays: 14,
  entryLimit: 500,
  pruneNeverHitDays: 21,
  // 闲置清理的分数门槛：>= 该分的条目不参与按天清理，交给 shouldEvict 的
  // 「60 天 + 分数双阈值」判定。与提取 prompt 的「低于 8 视为噪音」同口径取 7，
  // 比 compileThreshold(4.5) 高，确保中高分记忆不会被「没人读到」这种随机理由删掉。
  minImportanceForPrune: 7,
  // 回收站保留 30 天：软废弃条目不是「删除」而是「待确认删除」，给它一个
  // 明确的出清期限，否则回收站只进不出（实测 20% 的库卡在这里）。
  // 30 天而非 90 天：实测最老的软废弃条目只有 43 天，90 天等于「今天一条都不清」，
  // 规则形同虚设；30 天能覆盖当前积压里最老的一批，又留足反悔窗口。
  deprecatedRetentionDays: 30,
  // 已被后继取代的条目 7 天就清：内容已完整继承到活跃条目里，留着的唯一
  // 意义是「revise 改错了能翻回旧文本对照」，这是小时级需求不是月级。
  supersededRetentionDays: 7,
  embeddingProvider: 'off',
  embeddingBaseUrl: '',
  embeddingModel: 'text-embedding-3-small',
  embeddingApiKey: '',
  embeddingDimensions: 0,
}

/** LLM 整理操作（consolidate.ts 的 LLM 输出结构）。 */
export interface ConsolidateOp {
  /**
   * merge=合并多条为一条；rewrite=重写单条；drop=删除；promote=升长期；
   * conflict=两条互相矛盾——保留较新的、软废弃较旧的（**不合并**）。
   *
   * 为什么需要 conflict 而不是让模型 merge 掉：两条互相矛盾的事实（「用 A 方案」
   * vs 「改用 B 方案」）被 merge 成一句话后，两个说法都留在同一段文字里，
   * 下游模型读到的是一段自相矛盾的记忆，而它无从判断哪条有效。
   * 显式表达冲突，才能把旧的那条标成 deprecated 并记下 supersededBy。
   */
  type: 'merge' | 'rewrite' | 'drop' | 'promote' | 'conflict'
  /** 参与该操作的条目 id（merge/drop/promote/conflict 可多条；rewrite 单条）。 */
  ids: string[]
  /** merge/rewrite 的新内容（不含原条目中不存在的虚构信息）。 */
  content?: string
  /** merge/rewrite 的新标签。 */
  tags?: string[]
  /**
   * conflict 专用：哪一条是「较新、该保留」的。取值为 ids 中的某一项。
   * 缺省时退化为「按 updatedAt 较新者胜」，绝不因为模型漏填就误删两条。
   */
  keepId?: string
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
  injectPinnedBudgetRatio: { min: 0, max: 1, int: false, step: 0.05 },
  injectRefreshSteps: { min: 1, max: 200, int: true, step: 1 },
  extractMaxChars: { min: 500, max: 60_000, int: true, step: 500 },
  minImportance: { min: 1, max: 10, int: false, step: 0.5 },
  consolidateMaxEntries: { min: 10, max: 2000, int: true, step: 10 },
  consolidateTimeoutMs: { min: 5000, max: 600_000, int: true, step: 5000 },
  injectTopK: { min: 1, max: 50, int: true, step: 1 },
  entryLimit: { min: 50, max: 100_000, int: true, step: 50 },
  pruneNeverHitDays: { min: 0, max: 3650, int: true, step: 1 },
  minImportanceForPrune: { min: 1, max: 10, int: false, step: 0.5 },
  deprecatedRetentionDays: { min: 0, max: 3650, int: true, step: 30 },
  supersededRetentionDays: { min: 0, max: 3650, int: true, step: 1 },
} as const satisfies Record<string, { min: number; max: number; int: boolean; step: number }>

/** 可调数值字段名。 */
export type ConfigNumberKey = keyof typeof CONFIG_NUMBER_BOUNDS

const CONFIG_NUMBER_KEYS = Object.keys(CONFIG_NUMBER_BOUNDS) as ConfigNumberKey[]

const CONFIG_BOOLEAN_KEYS = ['dailyCompileEnabled', 'consolidateEnabled', 'logApiRequests', 'injectDefaultEnabled', 'zhInjectDefaultEnabled', 'htmlInjectDefaultEnabled', 'teamInjectDefaultEnabled', 'todoClosureDefaultEnabled'] as const

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
