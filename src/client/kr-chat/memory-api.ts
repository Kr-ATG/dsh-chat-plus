/**
 * dsh-chat-plus — 记忆数据面最小 HTTP 客户端（KR 右栏「记忆」卡片专用）。
 *
 * 纯 fetch、同源：host 半身把 dsh-triad 的记忆路由挂在 `/api/dsh-memory/*` 下，
 * 这里只镜像 KR 大盘用得到的几个。
 *
 * 之所以不走 `ctx.get('memory')` 这类注入面：KR 右栏是 kr-chat-controller.tsx
 * 用 createRoot 单独挂的一棵树，不在任何 slot 作用域里，拿不到槽位 props；
 * 而 HTTP 路由不挑调用方，任何地方都能用，坏处只是多一次同源请求。
 *
 * **不 import dsh-triad 的任何代码**（那边是独立 git 仓库、独立打包）：跨仓库
 * import 会把对面整棵树拖进本插件的 bundle。这里只契约对齐：字段与
 * `dsh-triad/src/client/memory/api.ts` 的 toView 镜像保持一致。
 */

/** 记忆路由前缀（host 半身注册处，见 dsh-triad 的 ROUTE_PREFIX）。 */
export const MEMORY_API_BASE = '/api/dsh-memory'

/** 记忆归属范围。 */
export type MemoryScope = 'global' | 'project'

/** 记忆类型（host MemoryKind 镜像）。 */
export type MemoryKind = 'identity' | 'preference' | 'fact' | 'decision' | 'gotcha' | 'session-summary'

/** 记忆条目视图（host toView 镜像；字段全部按「可能是旧 host」兜底读取）。 */
export interface MemoryEntryView {
  id: string
  content: string
  scope: MemoryScope
  projectHash: string | null
  tags: string[]
  pinned: boolean
  /** true = 已禁用（保留但不参与注入/编译）。 */
  disabled: boolean
  /** true = 已软废弃（retire / revise，落在回收站）。 */
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
  /** 溯源：产生/最近更新该条目的会话（KR 卡「本会话新增」判定用；旧 host 缺省）。 */
  provenance?: { sessionId?: string; turn?: number; snippet?: string }
}

/** 项目视图（hash + 路径是大盘把 cwd 映射到 projectHash 的唯一依据）。 */
export interface ProjectView {
  hash: string
  path: string
  alias: string | null
  locked: boolean
  autoMemory: boolean
  entryCount: number
  pinnedCount: number
  /** 工作区文件夹是否还在（旧 host 不回 → undefined，按「还在」处理）。 */
  pathMissing?: boolean
  /** true = 只存在于 DSH 工作区注册表、记忆库没有档案。 */
  fromRegistry?: boolean
}

/** 列表响应。 */
export interface MemoryListResponse {
  entries: MemoryEntryView[]
  projects: ProjectView[]
}

/** 批量删除响应。 */
export interface MemoryDeleteBatchResponse {
  ok: boolean
  deleted: number
  missing: number
}

/** 置顶响应。 */
export interface MemoryPinResponse {
  ok: boolean
  entry: MemoryEntryView
}

/** kind 合法值（规范化兜底用）。 */
const KIND_VALUES: readonly MemoryKind[] = ['identity', 'preference', 'fact', 'decision', 'gotcha', 'session-summary']

/** 记忆类型的中文短标签（徽章用；未知类型不显示，避免出现英文噪音）。 */
const KIND_LABELS: Partial<Record<MemoryKind, string>> = {
  identity: '身份',
  preference: '偏好',
  decision: '决策',
  gotcha: '踩坑',
  'session-summary': '会话总结',
}

/** 记忆类型中文标签（未知/普通事实返回空串，由调用方决定是否渲染徽章）。 */
export function memoryKindLabel(kind: MemoryKind): string {
  return KIND_LABELS[kind] ?? ''
}

/**
 * 规范化单条记忆。
 *
 * host 与 client 是各自独立部署的两半：用户更新插件后 client 刷新页面即生效，
 * host 要重启 DSH 才换新。这段窗口里旧 host 不返回 version / confidence / kind /
 * lastHitAt / tags，直接渲染会出现「vundefined」「NaN%」、空白徽章和
 * `tags.map` 炸掉整张卡。因此**任何字段都按最坏情况兜底**，卡片永不因数据
 * 形状变化而崩。
 */
export function normalizeEntry(entry: MemoryEntryView): MemoryEntryView {
  const raw = (entry ?? {}) as Partial<MemoryEntryView>
  const scope: MemoryScope = raw.scope === 'global' ? 'global' : 'project'
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : ''
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    scope,
    projectHash: typeof raw.projectHash === 'string' ? raw.projectHash : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    pinned: raw.pinned === true,
    disabled: raw.disabled === true,
    deprecated: raw.deprecated === true,
    importance: Number.isFinite(raw.importance) ? (raw.importance as number) : 0,
    layer: raw.layer === 'long' ? 'long' : 'short',
    source: raw.source === 'manual' ? 'manual' : 'extract',
    createdAt,
    // updatedAt 缺省时退到 createdAt：大盘按更新时间倒序，没有它就等于排到队尾
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt !== '' ? raw.updatedAt : createdAt,
    version: Number.isFinite(raw.version) ? (raw.version as number) : 1,
    confidence: Number.isFinite(raw.confidence) ? (raw.confidence as number) : (raw.source === 'manual' ? 1 : 0.6),
    verified: raw.verified === true,
    kind: KIND_VALUES.includes(raw.kind as MemoryKind) ? (raw.kind as MemoryKind) : 'fact',
    lastHitAt: typeof raw.lastHitAt === 'string' ? raw.lastHitAt : null,
    // 溯源整体透传：旧 host 不返回时保持 undefined，判定逻辑自行兜底。
    provenance: raw.provenance !== null && typeof raw.provenance === 'object' ? raw.provenance : undefined,
  }
}

/** 从错误响应体里读 host 给的中文错误文案；读不到返回 null。 */
function readError(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' && error !== '' ? error : null
}

/**
 * 统一请求面：JSON 解析失败不当异常抛（404 的 HTML / 空体都要能走同一个 catch），
 * 非 2xx 一律抛 `Error(body.error ?? request failed (status))`。
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${MEMORY_API_BASE}${path}`, {
    headers: { accept: 'application/json' },
    ...init,
  })
  const raw = await response.text().catch(() => '')
  let body: unknown = null
  if (raw !== '') {
    try {
      body = JSON.parse(raw) as unknown
    } catch {
      // 非 JSON 体（路由不存在时的 HTML 404、代理错误页）——按空体处理，
      // 由下面的状态码分支抛错，调用方统一显示「记忆模块未就绪」。
      body = null
    }
  }
  if (!response.ok) {
    throw new Error(readError(body) ?? `request failed (${String(response.status)})`)
  }
  return (body ?? {}) as T
}

/** POST helper（JSON body）。 */
function send<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 列表参数（不带参数 = 全部，返回体里同时带 projects 注册表）。 */
export interface MemoryListParams {
  scope?: MemoryScope
  project?: string
}

/**
 * 拉取记忆列表。
 *
 * 大盘一次拿全量（不传 scope/project），本地再切成「工作区 / 全局」两个分区：
 * 这样只需要一次请求，且 host 即便不支持 scope 参数也能正常出数据。
 */
export async function listMemory(params: MemoryListParams = {}): Promise<MemoryListResponse> {
  const query = new URLSearchParams()
  if (params.scope !== undefined && params.scope !== '') query.set('scope', params.scope)
  if (params.project !== undefined && params.project !== '') query.set('project', params.project)
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`
  const response = await request<MemoryListResponse>(`/list${suffix}`)
  return {
    entries: Array.isArray(response.entries) ? response.entries.map(normalizeEntry) : [],
    projects: Array.isArray(response.projects) ? response.projects : [],
  }
}

/** 项目注册表（hash ↔ 路径的唯一映射来源；旧 host 的 /list 可能不带 projects）。 */
export async function listProjects(): Promise<ProjectView[]> {
  const response = await request<{ projects?: ProjectView[] }>('/projects')
  return Array.isArray(response.projects) ? response.projects : []
}

/** 批量删除（host 侧一次事务 + 一次编译）。entryIds 为空时直接跳过请求。 */
export async function deleteMemoryBatch(entryIds: readonly string[]): Promise<MemoryDeleteBatchResponse> {
  if (entryIds.length === 0) return { ok: true, deleted: 0, missing: 0 }
  return send<MemoryDeleteBatchResponse>('/delete-batch', { entryIds: [...entryIds] })
}

/** 置顶 / 取消置顶（可选能力：host 不支持时按钮位置会报错，由调用方兜底）。 */
export async function pinMemoryEntry(entryId: string, pinned: boolean): Promise<MemoryPinResponse> {
  return send<MemoryPinResponse>('/pin', { entryId, pinned })
}
