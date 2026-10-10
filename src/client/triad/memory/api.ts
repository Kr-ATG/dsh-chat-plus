/**
 * dsh-memory client API：镜像 host 的 /api/dsh-memory/* 路由。
 * 纯 fetch（无 typert、无 DSH 源码改动），与 skill-manager 同款模式。
 */

const API_BASE = '/api/dsh-memory'

/** 记忆条目视图（host toView 镜像）。 */
export interface MemoryEntryView {
  id: string
  content: string
  scope: 'global' | 'project'
  projectHash: string | null
  tags: string[]
  pinned: boolean
  /** true = 已禁用（保留但不参与注入/编译）。 */
  disabled: boolean
  /** true = 已软废弃（retire / revise）。 */
  deprecated?: boolean
  importance: number
  layer: 'short' | 'long'
  source: 'extract' | 'manual'
  createdAt: string
  updatedAt: string
  /** 条目级版本号（每次内容变更 +1）。 */
  version: number
  /** 置信度 0-1（手动记忆=1）。 */
  confidence: number
  /** 用户是否已显式确认。 */
  verified: boolean
  /** 记忆类型。 */
  kind: MemoryKind
  /** 上次注入命中时间（null=从未命中）。 */
  lastHitAt: string | null
}

/** 记忆类型（host MemoryKind 镜像）。 */
export type MemoryKind = 'identity' | 'preference' | 'fact' | 'decision' | 'gotcha' | 'session-summary'

/** 项目视图。 */
export interface ProjectView {
  hash: string
  path: string
  alias: string | null
  locked: boolean
  autoMemory: boolean
  /** 该项目是否被排除出记忆注入（旧 host 不回该字段 → undefined，按 false 处理）。 */
  injectExcluded?: boolean
  entryCount: number
  pinnedCount: number
}

/** 变更记录。 */
export interface ChangeView {
  id: string
  action: 'add' | 'update' | 'promote' | 'delete' | 'revise' | 'retire' | 'consolidate'
  entryId: string
  scope: 'global' | 'project'
  projectHash: string | null
  summary: string
  before?: string
  after?: string
  at: string
}

/** 面板列表响应。 */
export interface MemoryListResponse {
  entries: MemoryEntryView[]
  projects: ProjectView[]
}

/** 概览响应。 */
export interface MemorySummaryResponse {
  today: string
  entryCount: number
  projectCount: number
  todayChanges: number
  /** 全部变更总数（左栏「变更」导航计数；旧 host 缺失时由面板按 todayChanges 兜底）。 */
  changeCount?: number
  /**
   * 以下计数由较新的 host 提供。client 与 host 分别部署——插件更新后 client
   * 刷新页面即生效，host 要重启 DSH 才换新；这段窗口里字段缺失，面板据 undefined
   * 隐藏对应指标（补 0 会显示「全局 0」之类的假数据）。
   */
  pinnedCount?: number
  disabledCount?: number
  deprecatedCount?: number
  longtermCount?: number
  globalCount?: number
  revisionCount?: number
}

/** 变更响应。 */
export interface MemoryChangesResponse {
  date: string
  changes: ChangeView[]
}

/** 标签聚合。 */
export interface MemoryTagsResponse {
  tags: Array<{ tag: string; count: number }>
}

/** 整理结果（host ConsolidateResult 镜像）。 */
export interface ConsolidateResultView {
  scope: string
  merged: number
  rewritten: number
  dropped: number
  promoted: number
  changed: number
  /** 整理未完成的原因（超时/无模型等）；undefined=正常结束（含「无需整理」）。 */
  failed?: string
}

/** 修订版本（host RevisionMeta 镜像）。 */
export interface RevisionView {
  id: string
  at: string
  entryCount: number
  scope: string
  trigger: 'daily' | 'manual'
}

/** 运行时配置视图（host publicConfig 镜像，字段均可缺省）。 */
export interface MemoryConfigView {
  extractEveryTurns?: number
  compileEveryTurns?: number
  compileThreshold?: number
  decayLambda?: number
  hitBonus?: number
  injectTokenBudget?: number
  injectRefreshSteps?: number
  extractMaxChars?: number
  minImportance?: number
  consolidateMaxEntries?: number
  consolidateTimeoutMs?: number
  /** 整理专用模型 provider（留空=跟随默认模型）。 */
  consolidateProvider?: string
  /** 整理专用模型 id（与 consolidateProvider 成对）。 */
  consolidateModel?: string
  injectTopK?: number
  entryLimit?: number
  /** 从未命中自动清理（天）0=关闭；面板设置「编译与衰减」组。 */
  pruneNeverHitDays?: number
  dailyCompileEnabled?: boolean
  consolidateEnabled?: boolean
  logApiRequests?: boolean
  /** 新会话是否默认注入记忆（对话框开关的初始态；会话级覆盖优先）。 */
  injectDefaultEnabled?: boolean
  /** 语义检索后端（schema v3）。 */
  embeddingProvider?: 'off' | 'http' | 'local'
  embeddingBaseUrl?: string
  embeddingModel?: string
  embeddingApiKey?: string
  embeddingDimensions?: number
}

/** 注入开关状态（会话级 + 全局默认；面板/对话框开关共用）。 */
export interface InjectStateView {
  /** 该会话当前是否注入（显式覆盖 ?? 默认值）。 */
  enabled: boolean
  /** config.injectDefaultEnabled：新会话与未单独设置的会话是否注入。 */
  defaultEnabled?: boolean
  /** 该会话是否单独设置过（false/null = 跟随默认）。 */
  explicit?: boolean | null
  /**
   * 中文记忆内置通道是否开启。
   *
   * 由 /inject-state 顺带回传而非另开 GET 端点：该接口在 composer 里被
   * hover 反复触发，独立端点会成倍放大既有轮询量。旧 host 不回此字段时
   * 按 true 兜底——能力内置，默认就该是开的。
   */
  zhEnabled?: boolean
  /**
   * 对话内 HTML 卡片规范内置通道是否开启（iu kind 文档随它注入）。
   *
   * 同样由 /inject-state 顺带回传。旧 host 不回此字段时按 false 兜底——缺字段
   * 意味着这版 host 根本没这个能力，显示为「关」比显示为「开」更不误导。
   */
  htmlEnabled?: boolean
  /**
   * 灵魂（Soul）内置通道是否开启。
   *
   * 与 zh 同口径：缺字段按 true 兜底。它是记忆库之上的第四层身份契约，
   * 默认就该生效；真正决定「注不注得进去」的是 soul.md 有没有内容——
   * 空灵魂不注入，这一条由 host 的注入器负责，开关只表达用户意图。
   */
  soulEnabled?: boolean
  /**
   * 团队协作内置通道是否开启。
   *
   * 同样由 /inject-state 顺带回传。旧 host 不回此字段时按 false 兜底——与
   * diagram / html 完全同口径：它是新增能力，缺字段意味着这版 host 根本没有，
   * 显示「开」是假阳性（开着却注不进去最误导）。config 默认开只决定新 host
   * 的真实值，不改变缺字段兜底口径。
   */
  teamEnabled?: boolean
  /**
   * 回合结束自动收口内置通道是否开启（残留 in_progress 改写为 pending）。
   *
   * 与 team 刻意不同口径：它是**默认开**的通道（host 侧
   * config.todoClosureDefaultEnabled 默认 true），缺字段兜底照 zh / soul 的
   * `!== false`。若照 html / team 的 `=== true` 兜底，client 已更新、host 还没
   * 重启的那段窗口里开关会显示成「关」，host 一重启又变「开」——同一个用户
   * 什么都没做，看到开关自己跳了一下。
   */
  todoClosureEnabled?: boolean
}

/**
 * 中文记忆独立注入开关状态（内置能力，全局单值）。
 *
 * 与 InjectStateView 刻意分开成两个接口：主开关是会话级三态（显式/跟随默认），
 * 中文开关是全局两态。合成一个对象会逼调用方去处理"这个 enabled 到底受不受
 * defaultEnabled 影响"这种本不该存在的问题。
 */
export interface ZhInjectStateView {
  /** 中文偏好记忆是否独立注入。 */
  enabled: boolean
  /** 恒为 true：该能力内置于插件，无卸载入口。旧 host 缺字段时按 true 兜底。 */
  builtin?: boolean
}

interface ApiError {
  error?: string
}

/** 模型目录项（某一 provider 及其可用模型 id 列表）。 */
export interface ModelCatalogView {
  provider: string
  providerName: string
  models: string[]
}

/** 记忆类型合法值（规范化用）。 */
const KIND_VALUES: readonly MemoryKind[] = ['identity', 'preference', 'fact', 'decision', 'gotcha', 'session-summary']

/**
 * 规范化条目视图：补齐 schema v2 字段的缺省值。
 *
 * host 与 client 是各自独立部署的两半——用户更新插件后 client 立刻生效（刷新页面），
 * 但 host 要重启 DSH 才换新。这段窗口里旧 host 不返回 version/confidence/kind/lastHitAt，
 * 若直接渲染会出现「版本 vundefined」「置信度 NaN%」和空白徽章。
 */
function normalizeEntry(entry: MemoryEntryView): MemoryEntryView {
  return {
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    disabled: entry.disabled === true,
    deprecated: entry.deprecated === true,
    pinned: entry.pinned === true,
    importance: Number.isFinite(entry.importance) ? entry.importance : 0,
    version: Number.isFinite(entry.version) ? entry.version : 1,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : (entry.source === 'manual' ? 1 : 0.6),
    verified: entry.verified === true,
    kind: KIND_VALUES.includes(entry.kind) ? entry.kind : 'fact',
    lastHitAt: typeof entry.lastHitAt === 'string' ? entry.lastHitAt : null,
  }
}

/** 规范化概览：基础计数缺省按 0；新增计数缺省保持 undefined（面板隐藏）。 */
function normalizeSummary(summary: MemorySummaryResponse): MemorySummaryResponse {
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const opt = (value: unknown): number | undefined =>
    (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  return {
    today: typeof summary.today === 'string' ? summary.today : '',
    entryCount: num(summary.entryCount),
    projectCount: num(summary.projectCount),
    todayChanges: num(summary.todayChanges),
    changeCount: opt(summary.changeCount),
    pinnedCount: opt(summary.pinnedCount),
    disabledCount: opt(summary.disabledCount),
    // 回收站计数：早先这里漏了透传，host 明明返回了 deprecatedCount，
    // 面板拿到的永远是 undefined → 「回收站」后面光秃秃不显示数字。
    deprecatedCount: opt(summary.deprecatedCount),
    longtermCount: opt(summary.longtermCount),
    globalCount: opt(summary.globalCount),
    revisionCount: opt(summary.revisionCount),
  }
}

/** 规范化响应里的单个 entry 字段（pin/enable/update/move/remember 共用）。 */
function withEntry<T extends { entry: MemoryEntryView }>(response: T): T {
  return { ...response, entry: normalizeEntry(response.entry) }
}

/** GET helper with JSON parsing and error surfacing. */
async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } })
  const body = await response.json() as T & ApiError
  if (!response.ok) throw new Error(body.error ?? `request failed (${String(response.status)})`)
  return body
}

/** POST helper with JSON body. */
async function sendJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as T & ApiError
  if (!response.ok) throw new Error(body.error ?? `request failed (${String(response.status)})`)
  return body
}

/** 面板 API 面（slots inject 提供）。 */
export interface MemoryApi {
  list: (params?: { scope?: string; project?: string; q?: string; tag?: string; includeDeprecated?: boolean }) => Promise<MemoryListResponse>
  projects: () => Promise<{ projects: ProjectView[] }>
  tags: () => Promise<MemoryTagsResponse>
  changes: (date?: string) => Promise<MemoryChangesResponse>
  summary: () => Promise<MemorySummaryResponse>
  /** 相关记忆（详情面板）：以条目内容检索 top-N 相似条目（不含自身/已废弃）。 */
  related: (entryId: string, limit?: number) => Promise<{ entries: MemoryEntryView[] }>
  pin: (entryId: string, pinned: boolean) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  enable: (entryId: string, enabled: boolean) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  update: (entryId: string, patch: {
    content?: string
    tags?: string[]
    importance?: number
    pinned?: boolean
    kind?: MemoryKind
    layer?: 'short' | 'long'
  }) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  move: (entryId: string, target: { scope?: string; projectHash?: string; path?: string }) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  deleteEntry: (entryId: string) => Promise<{ ok: boolean }>
  /** 批量删除（一次事务 + 一次编译，替代 N 次 deleteEntry）。 */
  deleteBatch: (entryIds: string[]) => Promise<{ ok: boolean; deleted: number; missing: number }>
  deleteProject: (projectHash: string) => Promise<{ ok: boolean; deleted: number }>
  /** 一键删除今日记忆（更新/创建于本地今天；置顶与已废弃跳过）。 */
  deleteToday: (target?: { scope?: 'global' | 'project'; projectHash?: string }) => Promise<{ ok: boolean; deleted: number }>
  meta: (projectHash: string, patch: { alias?: string; locked?: boolean; path?: string; autoMemory?: boolean; injectExcluded?: boolean }) => Promise<{ ok: boolean; meta: ProjectView }>
  remember: (input: {
    content: string
    scope?: 'global' | 'project'
    projectHash?: string
    path?: string
    tags?: string[]
    pinned?: boolean
    importance?: number
  }) => Promise<{ ok: boolean; created: boolean; entry: MemoryEntryView }>
  getInjectState: (sessionId: string) => Promise<InjectStateView>
  /** enabled=null → 清除本会话覆盖，回到默认值。 */
  setInjectState: (sessionId: string, enabled: boolean | null) => Promise<InjectStateView & { ok: boolean }>
  /** 中文记忆内置通道开关（全局单值，与主开关无联动）。 */
  getZhInjectState: () => Promise<ZhInjectStateView>
  setZhInjectState: (enabled: boolean) => Promise<ZhInjectStateView & { ok: boolean }>
  // 历史注记：曾有 getDiagramInjectState / setDiagramInjectState（对话内流程图
  // 通道），2026-10-09 随通道移除——图形能力改由 iu kind（graph/arch/sequence）
  // 承接，注入文档随 html 通道走。
  /** 对话内 HTML 卡片内置通道开关（全局单值，与主开关无联动）。 */
  getHtmlInjectState: () => Promise<ZhInjectStateView>
  setHtmlInjectState: (enabled: boolean) => Promise<ZhInjectStateView & { ok: boolean }>
  /**
   * 灵魂（Soul）内置通道开关（全局单值，与主开关无联动）。
   *
   * 独立端点而非并进 /inject-state：灵魂面板自己要读这个状态（它不是只在
   * composer 的 hover 浮层里出现），而 /inject-state 需要 sessionId、
   * 语义是「本会话注不注入」，两件事不该互相借用。
   */
  getSoulInjectState: () => Promise<ZhInjectStateView>
  setSoulInjectState: (enabled: boolean) => Promise<ZhInjectStateView & { ok: boolean }>
  /** 团队协作内置通道开关（全局单值，与主开关无联动）。 */
  getTeamInjectState: () => Promise<ZhInjectStateView>
  setTeamInjectState: (enabled: boolean) => Promise<ZhInjectStateView & { ok: boolean }>
  /**
   * 回合结束自动收口开关（全局单值，与主开关无联动）。
   *
   * 它不改提示词、也不属于「内置提示词通道」那一族，只是被放在同一张卡里
   * 顺手管理；默认开，回包缺字段时按开兜底（见 InjectStateView.todoClosureEnabled）。
   */
  getTodoClosureState: () => Promise<ZhInjectStateView>
  setTodoClosureState: (enabled: boolean) => Promise<ZhInjectStateView & { ok: boolean }>
  consolidate: (scope?: 'all' | 'global' | 'project', projectHash?: string) => Promise<{ ok: boolean; results: ConsolidateResultView[] }>
  revisions: () => Promise<{ revisions: RevisionView[] }>
  rollback: (revisionId: string) => Promise<{ ok: boolean }>
  getConfig: () => Promise<{ config: MemoryConfigView }>
  setConfig: (patch: Partial<MemoryConfigView>) => Promise<{ ok: boolean; config: MemoryConfigView }>
  /** 恢复引擎默认配置（清空 config.json 覆盖层）。 */
  resetConfig: () => Promise<{ ok: boolean; config: MemoryConfigView }>
  /** 可用模型目录（整理模型下拉候选）。 */
  listModels: () => Promise<{ models: ModelCatalogView[] }>
  /** 修订记忆：软废弃旧条目 + 写入后继条目。 */
  revise: (entryId: string, input: { content: string; reason?: string; tags?: string[]; importance?: number }) => Promise<{ ok: boolean; deprecatedId: string; newId: string; entry: MemoryEntryView }>
  /** 软废弃记忆（数据保留，退出检索/注入）。 */
  retire: (entryId: string, reason?: string) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  /** 复活已废弃记忆。 */
  restore: (entryId: string) => Promise<{ ok: boolean; entry: MemoryEntryView }>
}

/** 构造面板 API 面。 */
export function createMemoryApi(): MemoryApi {
  return {
    list: (params = {}) => {
      const query = new URLSearchParams()
      if (params.scope !== undefined && params.scope !== '') query.set('scope', params.scope)
      if (params.project !== undefined && params.project !== '') query.set('project', params.project)
      if (params.q !== undefined && params.q !== '') query.set('q', params.q)
      if (params.tag !== undefined && params.tag !== '') query.set('tag', params.tag)
      if (params.includeDeprecated === true) query.set('includeDeprecated', '1')
      const suffix = query.toString() === '' ? '' : `?${query.toString()}`
      return getJson<MemoryListResponse>(`/list${suffix}`).then(response => ({
        ...response,
        entries: (response.entries ?? []).map(normalizeEntry),
        projects: response.projects ?? [],
      }))
    },
    projects: () => getJson<{ projects: ProjectView[] }>('/projects'),
    tags: () => getJson<MemoryTagsResponse>('/tags'),
    changes: (date) => getJson<MemoryChangesResponse>(`/changes${date !== undefined ? `?date=${encodeURIComponent(date)}` : ''}`),
    summary: () => getJson<MemorySummaryResponse>('/summary').then(normalizeSummary),
    related: (entryId, limit) => getJson<{ entries: MemoryEntryView[] }>(
      `/related?entryId=${encodeURIComponent(entryId)}${limit !== undefined ? `&limit=${limit}` : ''}`,
    ).then(response => ({ entries: (response.entries ?? []).map(normalizeEntry) })),
    pin: (entryId, pinned) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/pin', { entryId, pinned }).then(withEntry),
    enable: (entryId, enabled) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/enable', { entryId, enabled }).then(withEntry),
    update: (entryId, patch) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/update', { entryId, ...patch }).then(withEntry),
    move: (entryId, target) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/move', { entryId, ...target }).then(withEntry),
    deleteEntry: (entryId) => sendJson<{ ok: boolean }>('/delete', { entryId }),
    deleteBatch: (entryIds) => sendJson<{ ok: boolean; deleted: number; missing: number }>('/delete-batch', { entryIds }),
    deleteProject: (projectHash) => sendJson<{ ok: boolean; deleted: number }>('/delete-project', { projectHash }),
    deleteToday: (target = {}) => sendJson<{ ok: boolean; deleted: number }>('/delete-today', target),
    meta: (projectHash, patch) => sendJson<{ ok: boolean; meta: ProjectView }>('/meta', { projectHash, ...patch }),
    remember: (input) => sendJson<{ ok: boolean; created: boolean; entry: MemoryEntryView }>('/remember', input).then(withEntry),
    getInjectState: (sessionId) => getJson<InjectStateView>(`/inject-state?sessionId=${encodeURIComponent(sessionId)}`),
    setInjectState: (sessionId, enabled) => sendJson<InjectStateView & { ok: boolean }>('/inject-state', { sessionId, enabled }),
    getZhInjectState: () => getJson<ZhInjectStateView>('/zh-inject-state'),
    setZhInjectState: (enabled) => sendJson<ZhInjectStateView & { ok: boolean }>('/zh-inject-state', { enabled }),
    getHtmlInjectState: () => getJson<ZhInjectStateView>('/html-inject-state'),
    setHtmlInjectState: (enabled) => sendJson<ZhInjectStateView & { ok: boolean }>('/html-inject-state', { enabled }),
    getSoulInjectState: () => getJson<ZhInjectStateView>('/soul/state'),
    setSoulInjectState: (enabled) => sendJson<ZhInjectStateView & { ok: boolean }>('/soul/state', { enabled }),
    getTeamInjectState: () => getJson<ZhInjectStateView>('/team-inject-state'),
    setTeamInjectState: (enabled) => sendJson<ZhInjectStateView & { ok: boolean }>('/team-inject-state', { enabled }),
    getTodoClosureState: () => getJson<ZhInjectStateView>('/todo-closure-state'),
    setTodoClosureState: (enabled) => sendJson<ZhInjectStateView & { ok: boolean }>('/todo-closure-state', { enabled }),
    consolidate: (scope = 'all', projectHash) => sendJson<{ ok: boolean; results: ConsolidateResultView[] }>('/consolidate', { scope, projectHash }),
    revisions: () => getJson<{ revisions: RevisionView[] }>('/revisions'),
    rollback: (revisionId) => sendJson<{ ok: boolean }>('/rollback', { revisionId }),
    getConfig: () => getJson<{ config: MemoryConfigView }>('/config'),
    setConfig: (patch) => sendJson<{ ok: boolean; config: MemoryConfigView }>('/config', patch),
    resetConfig: () => sendJson<{ ok: boolean; config: MemoryConfigView }>('/config', { reset: true }),
    listModels: () => getJson<{ models: ModelCatalogView[] }>('/models'),
    revise: (entryId, input) => sendJson<{ ok: boolean; deprecatedId: string; newId: string; entry: MemoryEntryView }>('/revise', { entryId, ...input }).then(withEntry) as Promise<{ ok: boolean; deprecatedId: string; newId: string; entry: MemoryEntryView }>,
    retire: (entryId, reason) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/retire', { entryId, reason }).then(withEntry),
    restore: (entryId) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/restore', { entryId }).then(withEntry),
  }
}
