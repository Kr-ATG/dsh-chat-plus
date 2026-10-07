/**
 * dsh-soul client API：镜像 host 的 /api/dsh-memory/soul/* 路由。
 *
 * 为什么不并进 memory/api.ts：
 *  - 灵魂是「记忆库之上的身份契约层」，有自己的读写面（正文 / 结构化身份 /
 *    档案 / 蒸馏 / 注入开关）。并进那个已经 400 行的文件只会让它继续膨胀，
 *    而两者唯一的真实耦合是同一个 HTTP 前缀。
 *  - client 与 host 各自独立部署：插件更新后浏览器刷新即生效，host 要重启
 *    DSH 才换新。这段窗口里旧 host 根本没有 /soul 路由——**必须**把「路由
 *    不存在」与「真的出错了」分开：前者是「请重启 DSH」的诚实空态，后者才是
 *    错误。判断封在本文件（SoulHostStaleError + isHostStale），面板只消费结论。
 *
 * 全部请求纯 fetch、零第三方依赖，与 memory/api.ts 同款。
 */

const API_BASE = '/api/dsh-memory/soul'

/** 结构化身份（host SoulIdentity 镜像）。 */
export interface SoulIdentity {
  name: string
  role: string
  tone: string
  language: string
  principles: string[]
}

/**
 * 「我的资料」——面板上关于**用户自己**的那份身份描述（host SoulUser 镜像）。
 *
 * 与灵魂（agent 人设）分开存：soul 描述「你是谁、怎么说话」（属于模型），
 * user 描述「我是谁」（属于用户，不随人格切换）。
 */
export interface SoulUser {
  /** 用户希望被怎么称呼。空串 = 未设置（此时 {{userName}} 保持字面量）。 */
  name: string
  /** 个人档案：职业、习惯、在意的事、想要什么帮助。 */
  profile: string
}

/** 空用户资料（面板初始态）。 */
export const EMPTY_SOUL_USER: SoulUser = { name: '', profile: '' }

/** 用户资料字段上限（与 host 一致，用于面板字数提示与输入限制）。 */
export const USER_NAME_MAX = 40
export const USER_PROFILE_MAX = 2000

/**
 * 用户头像的保留 id（host AVATAR_USER_ID 镜像）。
 *
 * 头像是同一套端点，用这一个 id 表达「用户的那张」。它与档案 id 空间重叠，但 host
 * 建档案时拒掉 `base` / `user` 两个保留字，所以索引里 key 为 `user` 的只可能是用户头像。
 */
export const AVATAR_USER_ID = 'user'

/** 灵魂视图（host SoulView 镜像）。 */
export interface SoulView {
  /** soul.md 正文（用户可编辑的 markdown 人设）。 */
  content: string
  identity: SoulIdentity
  /** 当前激活的档案 id；null = 用主档 soul.md。 */
  profileId: string | null
  /** 每次内容变更 +1（host 侧维护）。 */
  version: number
  updatedAt: string | null
  /** 内容来源：手动编辑 / 蒸馏草案采用。 */
  source: 'manual' | 'distill'
  /**
   * 当前人格的头像文件名；null = 未上传。
   *
   * 面板左列那枚头像跟着**当前生效人格**走（切换档案后立刻换脸），所以它由 host
   * 在视图里给，而不是让 client 从 profiles 里反查——同一份状态维护两遍必然漂移。
   */
  avatar: string | null
  /** 当前人格的卡片副标题（主档存在 active.json，档案存在档案 JSON 里）。 */
  desc: string
  /** 当前人格的卡片小标签。 */
  tag: string
  /** 用户自己的资料（与当前是哪份人格无关，随视图一起回避免二次往返）。 */
  user: SoulUser
  /** 用户头像文件名；null = 未上传。 */
  userAvatar: string | null
}

/** 灵魂草案（蒸馏产物，未落盘）。 */
export interface SoulDraft {
  content: string
  identity: SoulIdentity
  /** 模型对本次蒸馏的说明（可选）。 */
  notes?: string
}

/** 灵魂档案视图。 */
export interface ProfileView {
  id: string
  name: string
  /** 是否当前激活。 */
  active: boolean
  updatedAt: string | null
  /** 卡片副标题：一句定位（如「均衡的助手」）。空串 = 未设置。 */
  desc: string
  /** 卡片底部小标签（如 MOOD / 沉思）。空串 = 未设置。 */
  tag: string
  /** 头像文件名；null = 未上传。取图走 avatarUrl()。 */
  avatar: string | null
}

/** GET /soul 回包。 */
export interface SoulSnapshotResponse {
  soul: SoulView
  profiles: ProfileView[]
  /** 恒为 true：灵魂能力内置于插件。旧 host 缺字段时按 true 兜底。 */
  builtin?: boolean
}

/** GET /soul/state 回包。 */
export interface SoulStateView {
  enabled: boolean
  builtin?: boolean
}

/** 蒸馏统计（host 侧字段可缺，面板按缺省隐藏）。 */
export interface SoulDistillStats {
  /** 本次参与蒸馏的记忆条数。 */
  entries?: number
  /** 实际投喂的字符数。 */
  chars?: number
  provider?: string
  model?: string
}

/** 蒸馏结果：业务失败（无模型 / 无可用条目 / 超时）走 ok:false，不抛异常。 */
export type SoulDistillResult =
  | { ok: true; draft: SoulDraft; stats?: SoulDistillStats }
  | { ok: false; failed: string }

/** 写入灵魂的补丁（POST /soul 的 body）。 */
export interface SoulPatch {
  content?: string
  identity?: Partial<SoulIdentity>
  /** 保存目标档案；null = 主档 soul.md。 */
  profileId?: string | null
  /** 切换激活的档案 id；空串 = 回到主档。 */
  activate?: string
  /**
   * 档案名（配合 profileId 新建档案时使用）。
   *
   * 与 remove 一样属于契约外可选扩展：POST /soul 的 body 里没有档案名这一项，
   * 而「新建一份命名人格」是这个面板的核心动作。host 认它就落名，不认就忽略
   * （面板以回包 profiles 为准渲染，不会本地编一个名字出来）。
   */
  name?: string
  /**
   * 删除指定档案（配合 profileId 使用）。
   *
   * 这一条是本 client 与 host 约定的**契约外可选扩展**：host 若不认这个字段，
   * 它会原样忽略，回包里的 profiles 仍包含该档案——面板以 host 回包为准渲染，
   * 不会本地假装删掉。契约里没有删除端点，而「档案」这一层没有删除就没有意义，
   * 故以此方式表达，待 host 支持后自动生效。
   */
  remove?: boolean
  /**
   * 角色卡副标题：一句定位（如「均衡的助手」）。
   *
   * 与 name 同类的契约外可选扩展（2026-10-07）：缺省时 host 沿用档案里已有的值，
   * 所以面板只在用户真的改过它时才带上来——否则「只改正文」会顺手把卡片说明清空。
   */
  desc?: string
  /** 角色卡底部小标签（如 MOOD / 沉思）。语义同 desc。 */
  tag?: string
}

/**
 * 写入类回包。
 *
 * profiles 为 null 表示**这版 host 根本没回这个字段**（旧进程 / 尚未实现），
 * 与「回了空数组」（真的一个档案都没有）是两回事：前者面板保留旧列表，后者
 * 清空。把两者混成一个 [] 会让一次保存就把用户看得见的档案列表抹掉。
 */
export interface SoulWriteResponse {
  ok: boolean
  soul: SoulView
  profiles: ProfileView[] | null
}

/**
 * 卡片种类（host SoulCardKind 镜像，逐字一致）。
 *
 * kind 决定三件事：面板上的图标与分组、注入时的段标题、预设应用时的覆盖粒度。
 * 因此它是**契约**而不是装饰：加一个 kind 就要在 host 的注入器里给它一个段标题，
 * 否则那张卡会掉进 custom 段里。
 */
export type SoulCardKind = 'identity' | 'tone' | 'principles' | 'boundaries' | 'style' | 'custom'

/** 全部 kind（面板的选择器与排序分组共用；顺序 = 界面展示顺序）。 */
export const SOUL_CARD_KINDS: readonly SoulCardKind[] = [
  'identity', 'tone', 'principles', 'boundaries', 'style', 'custom',
]

/**
 * 灵魂卡片（host SoulCard 镜像，字段名即对外契约）。
 *
 * 卡片是「灵魂」的权威形态：一张卡 = 一段可单独开关的注入内容。soul.md 正文
 * 退化成由卡片拼出来的只读全文视图——这样用户既能逐项调，也保留了整段编辑的入口。
 */
export interface SoulCard {
  /** 稳定 id：c_ + sha1(kind+title) 前 12 位。空串表示「交给 host 生成」（新建卡片时用）。 */
  id: string
  kind: SoulCardKind
  /** 卡片标题（用户可改，≤40 字）。 */
  title: string
  /** 卡片内容（自由文本，≤1200 字）。 */
  body: string
  /** false = 保留在面板但不参与注入。 */
  enabled: boolean
  /** 注入与展示顺序（升序）。 */
  order: number
  /** 来自哪个预设；用户手写 = null。 */
  presetId: string | null
  updatedAt: string
}

/** 灵魂预设（host SoulPreset 镜像）：一套可整体套用的卡片组合。 */
export interface SoulPreset {
  /** 'builtin:engineer' 这类内置 id，或 'user:<sha1>'。 */
  id: string
  name: string
  desc: string
  /** true = 内置只读（不可删、不可改；host 对删除请求回 400）。 */
  builtin: boolean
  cards: SoulCard[]
  createdAt: string
}

/** GET /soul/cards 回包。 */
export interface SoulCardsResponse {
  ok: boolean
  cards: SoulCard[]
  /**
   * host 重算后的灵魂视图（正文由卡片拼出来）。
   *
   * null 表示这版 host 没回这个字段——面板据此保留旧正文，而不是把正文清空。
   * 与「回了空对象」是两回事。
   */
  soul: SoulView | null
}

/** POST /soul/presets 回包。 */
export interface SoulPresetCreateResponse {
  ok: boolean
  /** null = host 没回预设（旧 host 不认这条路由时不会走到这里，属于真失败）。 */
  preset: SoulPreset | null
}

/** POST /soul/cards 的 body。 */
export interface SoulCardsPatch {
  /** 新增或更新（id 为空串时由 host 生成 id）。 */
  upsert?: SoulCard[]
  /** 删除指定 id。 */
  remove?: string[]
  /** 按数组顺序重写 order（只含 id）。 */
  reorder?: string[]
}

/** 预设应用模式：replace = 整套采用；merge = 同 kind 覆盖、custom 追加、其它保留。 */
export type SoulPresetApplyMode = 'replace' | 'merge'

/** 灵魂 API 面（Lead 用 useMemo 固定引用后传给 SoulPanel）。 */
export interface SoulApi {
  /** 读取灵魂 + 档案列表。 */
  load: () => Promise<SoulSnapshotResponse>
  /** 写入灵魂（正文 / 身份 / 档案 / 激活）。 */
  save: (patch: SoulPatch) => Promise<SoulWriteResponse>
  /** 灵魂注入开关（全局单值，与记忆主开关无联动）。 */
  getState: () => Promise<SoulStateView>
  setState: (enabled: boolean) => Promise<SoulStateView & { ok: boolean }>
  /** 从记忆库蒸馏一份灵魂草案（不落盘）。 */
  distill: (input?: { provider?: string; model?: string; projectHash?: string }) => Promise<SoulDistillResult>
  /** 采用草案（落盘）。 */
  apply: (draft: SoulDraft) => Promise<{ ok: boolean; soul: SoulView }>
  /** 新建档案：以当前灵魂为种子，写到新 id 下。 */
  createProfile: (name: string, seed?: { content?: string; identity?: SoulIdentity }) => Promise<SoulWriteResponse>
  /** 删除档案（依赖 host 支持 remove 字段，见 SoulPatch.remove）。 */
  removeProfile: (profileId: string) => Promise<SoulWriteResponse>
  /** 切换激活档案；null = 回到主档 soul.md。 */
  activateProfile: (profileId: string | null) => Promise<SoulWriteResponse>

  // ── 我的资料（用户侧身份，与人格解耦） ──
  /** 读用户资料 + 头像。 */
  loadUser: () => Promise<{ user: SoulUser; avatar: string | null }>
  /** 写用户资料（整份覆盖：空串 = 清掉该字段）。 */
  saveUser: (user: SoulUser) => Promise<{ ok: boolean; user: SoulUser; avatar: string | null }>

  // ── 档案头像（展示件：只影响面板卡片，不参与注入） ──
  /**
   * 头像图片的 URL（直接塞进 <img src>）。
   *
   * 带 cache-busting 参数：换头像后路径不变，浏览器会拿缓存里的旧脸；面板换图后
   * 用新的 bust 值重取即可（bust 由调用方给，通常是上传成功的时间戳）。
   */
  avatarUrl: (profileId: string | null, bust?: string | number) => string
  /** 上传/替换头像。dataUrl 必须是 data:image/*;base64 形式。 */
  uploadAvatar: (profileId: string | null, dataUrl: string) => Promise<{ ok: boolean; avatar: string | null }>
  /** 删除头像（幂等：本来就没有也回 ok）。 */
  removeAvatar: (profileId: string | null) => Promise<{ ok: boolean; avatar: string | null }>

  // ── 卡片（灵魂的权威形态） ──
  /** 读取卡片列表。 */
  loadCards: () => Promise<SoulCardsResponse>
  /** 卡片增删改序（一次请求里可混合三种动作，host 回包即权威）。 */
  saveCards: (patch: SoulCardsPatch) => Promise<SoulCardsResponse>

  // ── 预设库 ──
  /** 读取全部预设（含内置）。 */
  loadPresets: () => Promise<SoulPreset[]>
  /** 把当前卡片存成一个自定义预设。 */
  createPreset: (input: { name: string; desc?: string; cards: SoulCard[] }) => Promise<SoulPresetCreateResponse>
  /** 应用预设：replace 整套采用 / merge 同 kind 覆盖。 */
  applyPreset: (presetId: string, mode: SoulPresetApplyMode) => Promise<SoulCardsResponse>
  /** 删除自定义预设（内置预设 host 会回 400，前端不展示删除入口）。 */
  deletePreset: (presetId: string) => Promise<SoulPreset[]>

  /** 该错误是否表示「host 半身未更新、/soul 路由不存在」。 */
  isHostStale: (error: unknown) => boolean
}

/**
 * host 未更新（/soul 路由不存在）时抛出的错误。
 *
 * 单独一个类而不是靠字符串判断：面板要据此渲染「请重启 DSH」的空态，用错误
 * 文案做匹配会在 host 换文案时静默失效。
 */
export class SoulHostStaleError extends Error {
  readonly stale = true

  constructor(detail: string) {
    super(detail)
    this.name = 'SoulHostStaleError'
  }
}

/** 空身份（缺字段兜底 / 清空档案用）。 */
export const EMPTY_IDENTITY: SoulIdentity = { name: '', role: '', tone: '', language: '', principles: [] }

/** 空灵魂（面板初始态；host 不可达时不显示假数据）。 */
export const EMPTY_SOUL: SoulView = {
  content: '', identity: EMPTY_IDENTITY, profileId: null, version: 0, updatedAt: null, source: 'manual',
  avatar: null, desc: '', tag: '', user: EMPTY_SOUL_USER, userAvatar: null,
}

/** 取字符串字段（非字符串一律空串，不把 undefined 渲染进 UI）。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 规范化身份：缺字段补空、principles 过滤掉空白项。 */
function normalizeIdentity(raw: unknown): SoulIdentity {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const principles = Array.isArray(src.principles)
    ? src.principles.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  return {
    name: str(src.name),
    role: str(src.role),
    tone: str(src.tone),
    language: str(src.language),
    principles,
  }
}

/** 规范化用户资料（缺字段补空串）。 */
function normalizeUser(raw: unknown): SoulUser {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return { name: str(src.name), profile: str(src.profile) }
}

/** 规范化灵魂视图。 */
function normalizeSoul(raw: unknown): SoulView {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const profileId = typeof src.profileId === 'string' && src.profileId !== '' ? src.profileId : null
  return {
    content: str(src.content),
    identity: normalizeIdentity(src.identity),
    profileId,
    version: typeof src.version === 'number' && Number.isFinite(src.version) ? src.version : 0,
    updatedAt: typeof src.updatedAt === 'string' && src.updatedAt !== '' ? src.updatedAt : null,
    source: src.source === 'distill' ? 'distill' : 'manual',
    avatar: typeof src.avatar === 'string' && src.avatar !== '' ? src.avatar : null,
    desc: str(src.desc),
    tag: str(src.tag),
    // 旧 host 不回这两个字段：退化成空资料 + 无头像（面板照常渲染，只是那块空着）。
    user: normalizeUser(src.user),
    userAvatar: typeof src.userAvatar === 'string' && src.userAvatar !== '' ? src.userAvatar : null,
  }
}

/** 规范化档案视图（id 缺失时按序号兜底，避免 React key 为 undefined）。 */
function normalizeProfile(raw: unknown, index: number): ProfileView {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const id = typeof src.id === 'string' && src.id !== '' ? src.id : `profile-${String(index)}`
  return {
    id,
    name: typeof src.name === 'string' && src.name !== '' ? src.name : id,
    active: src.active === true,
    updatedAt: typeof src.updatedAt === 'string' && src.updatedAt !== '' ? src.updatedAt : null,
    // desc / tag / avatar 是 2026-10-07 新增的展示字段：旧 host 不回，一律退化成
    // 空/未上传（卡片照样渲染，只是没有副标题与脸）。
    desc: str(src.desc),
    tag: str(src.tag),
    avatar: typeof src.avatar === 'string' && src.avatar !== '' ? src.avatar : null,
  }
}

/** 规范化档案数组。 */
function normalizeProfiles(raw: unknown): ProfileView[] {
  return Array.isArray(raw) ? raw.map(normalizeProfile) : []
}

/** kind 白名单校验：host 回了未知 kind（版本错配）时归入 custom，而不是渲染出没有图标/段标题的孤儿卡。 */
function normalizeKind(raw: unknown): SoulCardKind {
  return typeof raw === 'string' && (SOUL_CARD_KINDS as readonly string[]).includes(raw)
    ? (raw as SoulCardKind)
    : 'custom'
}

/**
 * 规范化卡片。
 *
 * id 缺失时**保留空串**而不是编一个：空串在契约里正是「请 host 生成 id」的语义
 * （新增卡片走的就是这条路）。若在这里编一个客户端 id，保存时 host 会把同一张卡
 * 当成新卡再生成一次，面板上就会出现两张一样的卡。
 */
function normalizeCard(raw: unknown): SoulCard {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    id: str(src.id),
    kind: normalizeKind(src.kind),
    title: str(src.title),
    body: str(src.body),
    // 缺字段按 true：卡片默认参与注入，只有显式 false 才禁用。
    enabled: src.enabled !== false,
    order: typeof src.order === 'number' && Number.isFinite(src.order) ? src.order : 0,
    presetId: typeof src.presetId === 'string' && src.presetId !== '' ? src.presetId : null,
    updatedAt: str(src.updatedAt),
  }
}

/** 规范化卡片数组，并按 order 升序（host 已排序，这里兜底防手改文件乱序）。 */
function normalizeCards(raw: unknown): SoulCard[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeCard).sort((a, b) => a.order - b.order)
}

/** 规范化预设。 */
function normalizePreset(raw: unknown, index: number): SoulPreset {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const id = typeof src.id === 'string' && src.id !== '' ? src.id : `preset-${String(index)}`
  return {
    id,
    name: typeof src.name === 'string' && src.name !== '' ? src.name : id,
    desc: str(src.desc),
    builtin: src.builtin === true,
    cards: normalizeCards(src.cards),
    createdAt: str(src.createdAt),
  }
}

/** 规范化预设数组。 */
function normalizePresets(raw: unknown): SoulPreset[] {
  return Array.isArray(raw) ? raw.map(normalizePreset) : []
}

/** 卡片类回包（含 host 重算后的灵魂视图；soul 缺字段 → null = 保留旧正文）。 */
function toCards(body: Record<string, unknown>): SoulCardsResponse {
  return {
    ok: body.ok !== false,
    cards: normalizeCards(body.cards),
    soul: typeof body.soul === 'object' && body.soul !== null ? normalizeSoul(body.soul) : null,
  }
}

/**
 * 读响应体。
 *
 * 优先 text() 再自行 JSON.parse：旧 host（或 DSH 的 SPA 回退）对未知路径可能回
 * 一个 HTML 页面，直接 json() 会抛 SyntaxError，那样就没法把「路由不存在」与
 * 「host 报错」区分开。返回 { __raw } 哨兵表示「不是 JSON」。
 */
async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    if (typeof response.text === 'function') {
      const raw = await response.text()
      if (raw.trim() === '') return {}
      try {
        const parsed: unknown = JSON.parse(raw)
        return (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
      } catch {
        return { __raw: raw }
      }
    }
    const parsed: unknown = await response.json()
    return (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
  } catch {
    return { __raw: '' }
  }
}

/** 统一的请求入口：把 HTTP 层的一切翻译成两种错误（host 未更新 / 真失败）。 */
async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'application/json', ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...init,
    })
  } catch (error) {
    // 网络层失败（host 没起、被代理拦掉）：这不是「host 未更新」，如实抛出。
    throw new Error(error instanceof Error ? error.message : String(error))
  }
  const body = await readBody(response)
  if (!response.ok) {
    // 404 / 405 / 501 = 这条路由在跑着的 host 里根本不存在 → 需要重启 DSH。
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new SoulHostStaleError(`soul route missing (HTTP ${String(response.status)})`)
    }
    throw new Error(typeof body.error === 'string' ? body.error : `request failed (${String(response.status)})`)
  }
  // 200 但回的不是 JSON：DSH 的 SPA 回退页。同样是「这条路由不存在」。
  if (body.__raw !== undefined) throw new SoulHostStaleError('soul route returned non-JSON')
  return body
}

/** GET 请求。 */
async function getJson(path: string): Promise<Record<string, unknown>> {
  return request(path)
}

/** POST 请求。 */
async function sendJson(path: string, payload: unknown): Promise<Record<string, unknown>> {
  return request(path, { method: 'POST', body: JSON.stringify(payload) })
}

/**
 * 把写入类回包收敛成统一形状。
 *
 * profiles 缺字段 → null（面板据此保留旧列表）；回了数组（哪怕是空的）→ 原样采用。
 */
function toSnapshot(body: Record<string, unknown>): SoulWriteResponse {
  return {
    ok: body.ok !== false,
    soul: normalizeSoul(body.soul),
    profiles: Array.isArray(body.profiles) ? normalizeProfiles(body.profiles) : null,
  }
}

/** 生成档案 id：时间戳 + 随机后缀（同一毫秒内连点两次也不会撞）。 */
function newProfileId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 构造灵魂 API 面（无状态纯 fetch 包装，可安全单例）。 */
export function createSoulApi(): SoulApi {
  return {
    load: async () => {
      const body = await getJson('')
      return {
        soul: normalizeSoul(body.soul),
        profiles: normalizeProfiles(body.profiles),
        // 缺字段按 true：灵魂是内置能力，旧 host 只是还没有这条路由，
        // 一旦有就一定是内置的。
        builtin: body.builtin !== false,
      }
    },
    save: async (patch) => toSnapshot(await sendJson('', patch)),
    getState: async () => {
      const body = await getJson('/state')
      return { enabled: body.enabled !== false, builtin: body.builtin !== false }
    },
    setState: async (enabled) => {
      const body = await sendJson('/state', { enabled })
      return { ok: body.ok !== false, enabled: body.enabled !== false, builtin: body.builtin !== false }
    },
    distill: async (input = {}) => {
      const body = await sendJson('/distill', input)
      if (body.ok === false) {
        return { ok: false, failed: typeof body.failed === 'string' && body.failed !== '' ? body.failed : 'unknown' }
      }
      const stats = (typeof body.stats === 'object' && body.stats !== null ? body.stats : {}) as Record<string, unknown>
      return {
        ok: true,
        draft: { content: str((body.draft as Record<string, unknown> | undefined)?.content), identity: normalizeIdentity((body.draft as Record<string, unknown> | undefined)?.identity), notes: typeof (body.draft as Record<string, unknown> | undefined)?.notes === 'string' ? String((body.draft as Record<string, unknown>).notes) : undefined },
        stats: {
          entries: typeof stats.entries === 'number' ? stats.entries : undefined,
          chars: typeof stats.chars === 'number' ? stats.chars : undefined,
          provider: typeof stats.provider === 'string' ? stats.provider : undefined,
          model: typeof stats.model === 'string' ? stats.model : undefined,
        },
      }
    },
    apply: async (draft) => {
      const body = await sendJson('/apply', { draft })
      return { ok: body.ok !== false, soul: normalizeSoul(body.soul) }
    },
    // 新建档案 = 往一个全新的 profileId 写入内容（host 对未知 id 应新建）。
    // 同时带上 name 供 host 命名；不认这个字段的 host 会忽略它，档案名退化成 id。
    createProfile: async (name, seed = {}) => toSnapshot(await sendJson('', {
      profileId: newProfileId(),
      name,
      ...seed,
    } satisfies SoulPatch)),
    removeProfile: async (profileId) => toSnapshot(await sendJson('', { profileId, remove: true })),
    activateProfile: async (profileId) => toSnapshot(await sendJson('', { activate: profileId ?? '' })),

    // 头像：GET 直接给 <img src> 用（不经 fetch），上传/删除走 POST。
    // 主档（profileId === null）不传参数，host 缺省即主档占位 id。
    avatarUrl: (profileId, bust) => {
      const query = new URLSearchParams()
      if (profileId !== null && profileId !== '') query.set('profileId', profileId)
      // bust 只影响缓存：换图后路径不变，不加它浏览器会一直显示旧脸。
      if (bust !== undefined) query.set('v', String(bust))
      const suffix = query.toString()
      return `${API_BASE}/avatar${suffix === '' ? '' : `?${suffix}`}`
    },
    loadUser: async () => {
      const body = await getJson('/user')
      return {
        user: normalizeUser(body.user),
        avatar: typeof body.avatar === 'string' && body.avatar !== '' ? body.avatar : null,
      }
    },
    saveUser: async (user) => {
      const body = await sendJson('/user', user)
      return {
        ok: body.ok !== false,
        user: normalizeUser(body.user),
        avatar: typeof body.avatar === 'string' && body.avatar !== '' ? body.avatar : null,
      }
    },    uploadAvatar: async (profileId, dataUrl) => {
      const body = await sendJson('/avatar', { ...(profileId === null ? {} : { profileId }), dataUrl })
      return { ok: body.ok !== false, avatar: typeof body.avatar === 'string' && body.avatar !== '' ? body.avatar : null }
    },
    removeAvatar: async (profileId) => {
      const body = await sendJson('/avatar/remove', profileId === null ? {} : { profileId })
      return { ok: body.ok !== false, avatar: null }
    },

    loadCards: async () => toCards(await getJson('/cards')),
    // 卡片写入是「一次请求里可混合增删序」的：面板做一次拖拽排序 + 一次开关，
    // 若拆成多个请求，中途失败会让面板与磁盘处于半新半旧的状态。合并成一次，
    // host 回包即权威，面板直接采用（不做本地乐观合并，避免两边分叉）。
    saveCards: async (patch) => toCards(await sendJson('/cards', patch)),

    loadPresets: async () => normalizePresets((await getJson('/presets')).presets),
    createPreset: async (input) => {
      const body = await sendJson('/presets', input)
      return {
        ok: body.ok !== false,
        preset: typeof body.preset === 'object' && body.preset !== null ? normalizePreset(body.preset, 0) : null,
      }
    },
    applyPreset: async (presetId, mode) => toCards(await sendJson('/presets/apply', { presetId, mode })),
    // 删除回包给的是「删完之后的预设列表」，直接采用它当权威，避免本地 filter
    // 与 host 的过滤规则（比如内置预设不可删）不一致。
    deletePreset: async (presetId) => normalizePresets((await sendJson('/presets/delete', { presetId })).presets),

    isHostStale: (error) => error instanceof SoulHostStaleError,
  }
}
