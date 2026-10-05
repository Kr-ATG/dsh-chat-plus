/**
 * dsh-chat-plus — 记忆第四层「Soul（灵魂）」的共享类型与默认模板。
 *
 * 为什么单独抽一层：现有三层（pinned / 全局身份偏好 / 项目事实）都是「检索出来
 * 的内容」，模型对它们的采纳是概率性的；而「你是谁、用什么语气、守哪些底线」这类
 * 顶层身份契约不该跟事实条目抢 importance 排序，也不该被主注入开关或项目排除闸门
 * 顺带掐掉。所以它与内置通道 zh（中文偏好）/ diagram（流程图规范）完全同构：
 * 独立 user message、每会话只注首步、全局单值开关、位置在两道闸门之前、
 * 失败绝不影响主注入。
 *
 * 这里全部是纯 JSON 可序列化结构：host 与 client 独立部署、只经 HTTP 交换这些
 * 形状、不共享代码，因此字段名即对外契约，改名等于破坏兼容。
 *
 * schema v2（卡片化）：灵魂从「一整段 soul.md」升级为「可逐项编辑的卡片集合」。
 * cards.json 成为权威层，soul.md 退化为由卡片拼出的全文视图（写入时同步回写，
 * 磁盘布局与旧版本完全兼容）。为什么要做这一层：一整段 markdown 里混着身份、
 * 语气、准则、边界，用户想「只关掉其中一条」或「换个预设只覆盖语气」时无从下手；
 * 拆成卡片后每张卡可独立开关、排序、按 kind 覆盖，注入也变成可预算的装配过程。
 */
import { createHash } from 'node:crypto'

/** 结构化身份：灵魂的「可读字段」形态，与 soul.md 正文互补（正文给人看，字段给面板排版）。 */
export interface SoulIdentity {
  /** 名字（模型自称/用户称呼）。空串 = 未设置。 */
  name: string
  /** 一句话角色（如「严谨的资深全栈工程师」）。 */
  role: string
  /** 语气（如「直接、简洁、不客套」）。 */
  tone: string
  /** 语言（如「简体中文」）。 */
  language: string
  /** 行为准则条目（有序，面板按列表渲染）。 */
  principles: string[]
}

/** 灵魂的对外视图（GET /soul 的 soul 字段）。 */
export interface SoulView {
  /** 灵魂正文（markdown）。默认层未落盘时回落到 DEFAULT_SOUL_TEMPLATE。 */
  content: string
  /** 结构化身份。 */
  identity: SoulIdentity
  /** 当前激活的档案 id；null = 用默认层（soul.md）。 */
  profileId: string | null
  /** 版本号（每次写入 +1）。 */
  version: number
  /** 最近更新时间 ISO；从未写过为 null。 */
  updatedAt: string | null
  /** 来源：manual=用户手写/面板保存；distill=由记忆库蒸馏草案应用而来。 */
  source: 'manual' | 'distill'
  /**
   * 视图来源层（schema v2 新增，纯诊断口径）：
   *   'cards'    = content 由卡片装配得出（cards.json 存在，权威层是卡片）
   *   'soul.md'  = content 直接来自 soul.md（尚未迁移出卡片的旧库）
   * 面板据此显示「卡片装配」还是「整段文本」，也让人一眼看出迁移有没有跑过。
   */
  soulSource: 'cards' | 'soul.md'
}

/** 蒸馏草案（POST /soul/distill 的 draft；**不落盘**，等用户确认后走 /soul/apply）。 */
export interface SoulDraft {
  /** 草案正文。 */
  content: string
  /** 草案身份字段。 */
  identity: SoulIdentity
  /** 生成说明（模型给出的取舍备注，可缺省）。 */
  notes?: string
  /**
   * 草案的卡片形态（可选）。
   *
   * 面板要拿它做「草案 vs 当前灵魂」的逐卡对比；同时 /soul/apply 会用它同步
   * cards.json——否则蒸馏完灵魂变了、卡片还是旧的，面板与注入直接对不上。
   * 缺省时由 host 用 cardsFromDraft() 从 content + identity 现拆（老 client 兼容）。
   */
  cards?: SoulCard[]
}

/** 档案列表项（profiles[]）。 */
export interface ProfileView {
  id: string
  /** 显示名（取 identity.name，未设置时回落 id）。 */
  name: string
  /** 是否为当前激活档案。 */
  active: boolean
  updatedAt: string | null
}

/** 落盘的档案完整结构（profiles/<id>.json）。 */
export interface SoulProfile {
  id: string
  name: string
  content: string
  identity: SoulIdentity
  version: number
  updatedAt: string | null
  source: 'manual' | 'distill'
  /**
   * 档案层的卡片快照（schema v2 新增，可缺省）。
   *
   * 为什么卡片要跟着档案走：档案是「一整份备用人格」，激活它时注入的必须是
   * 这份人格。若卡片只有全局一份，激活档案后卡片面板显示的还是默认层卡片，
   * 用户改了卡片却改不到当前生效的人设——那比没有卡片更让人困惑。
   * 缺省（老档案）= 尚未卡片化，由 store 从 content + identity 迁移一次。
   */
  cards?: SoulCard[]
}

/** 默认层的版本元信息（存在 active.json 的 base 字段里，避免为它单开一个文件）。 */
export interface SoulBaseMeta {
  version: number
  updatedAt: string | null
  source: 'manual' | 'distill'
}

/** active.json：当前激活档案 + 默认层元信息。 */
export interface SoulActiveFile {
  /** 当前激活的档案 id；null = 用默认层 soul.md。 */
  profileId: string | null
  /** 默认层（soul.md + identity.json）的版本信息。 */
  base: SoulBaseMeta
}

/**
 * 蒸馏统计（面板展示「扫了多少条、用了多少条、花了多久」）。
 *
 * entries/chars/provider/model 四个字段是给 client 面板的扁平口径：面板只关心
 * 「投了几条、多大、哪个模型」，不需要知道 host 内部还有 scanned（库里总共多少）
 * 与 route（拼好的 "provider/model" 字符串）。两套字段同时存在是刻意的——
 * scanned/route 是 host 的诊断口径，entries/chars 是展示口径，互不替代。
 */
export interface SoulDistillStats {
  /** 命中选择条件的条目总数。 */
  scanned: number
  /** 实际送入模型的条数（按 importance/新近度截断后）。 */
  used: number
  /** 耗时毫秒。 */
  ms: number
  /** 实际使用的模型路由（provider/model，诊断口径）。 */
  route?: string
  /** 实际送入模型的条数（展示口径，= used）。 */
  entries: number
  /** 送入模型的 prompt 字符数（展示口径）。 */
  chars: number
  /** 实际使用的模型 provider（展示口径）。 */
  provider: string
  /** 实际使用的模型 id（展示口径）。 */
  model: string
}

/**
 * 默认灵魂模板。
 *
 * 为什么给模板而不是空串：面板首次打开要有个可编辑的起点，否则用户面对空白
 * 不知道「灵魂」该写什么粒度。但**模板不落盘**——只有用户真的保存了，soul.md
 * 才会出现在磁盘上、才会被注入。这样「soul.md 不存在 → 不注入」这条规则同时
 * 保证了「未编辑过的模板不会冒充用户人设进上下文」。
 *
 * 首行刻意写成引导语而非注释：它随正文一起注入，等于顺带告诉模型这一段属于
 * 哪一层（顶层身份契约），比藏在 HTML 注释里被渲染器吃掉更有用。
 */
export const DEFAULT_SOUL_TEMPLATE = [
  '> 这是「灵魂」默认模板：编辑并保存后，本文件会作为顶层身份契约，注入到每个新会话的首步。',
  '',
  '# 灵魂契约',
  '',
  '## 身份',
  '- 名字：Seeker',
  '- 角色：严谨、务实的工程搭档',
  '- 语气：直接、简洁，不客套、不铺垫',
  '- 语言：简体中文',
  '',
  '## 行为准则',
  '1. 先给结论与取舍，再给依据；不写无信息量的自我铺垫。',
  '2. 不确定就说不确定，不编造事实、引用或验证结果。',
  '3. 改动前先读现状；改动后自己验证并贴真实输出。',
  '4. 与项目 AGENTS.md / 系统提示冲突时，以项目指令为准。',
].join('\n')

/**
 * 默认身份字段。
 *
 * language 刻意给「简体中文」而不是空串：本插件已内置 zh 通道且默认开启，
 * 说明该用户的语言契约本就是中文；这里给同一个默认值不构成额外假设。
 * 其余字段留空——编造一个名字/角色等于替用户决定人设。
 */
export const DEFAULT_SOUL_IDENTITY: SoulIdentity = {
  name: '',
  role: '',
  tone: '',
  language: '简体中文',
  principles: [],
}

/** 单条准则的最大长度与条数（防止面板与注入被单条超长文本拖垮）。 */
const MAX_PRINCIPLE_CHARS = 200
const MAX_PRINCIPLES = 20

/** 容错归一化身份字段（HTTP body / 磁盘 JSON 都可能缺字段或类型不对）。 */
export function normalizeIdentity(value: unknown): SoulIdentity {
  if (value === null || typeof value !== 'object') return { ...DEFAULT_SOUL_IDENTITY, principles: [] }
  const raw = value as Record<string, unknown>
  const text = (key: keyof SoulIdentity): string =>
    typeof raw[key] === 'string' ? (raw[key] as string).trim() : ''
  const principles = Array.isArray(raw.principles)
    ? raw.principles
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => item !== '')
      .slice(0, MAX_PRINCIPLES)
      .map(item => item.slice(0, MAX_PRINCIPLE_CHARS))
    : []
  return {
    name: text('name').slice(0, 80),
    role: text('role').slice(0, 200),
    tone: text('tone').slice(0, 200),
    language: text('language').slice(0, 40),
    principles,
  }
}

// ── schema v2：灵魂卡片（cards.json）与预设库（presets.json） ────────────

/**
 * 卡片种类。
 *
 * 六种是**封闭集合**而不是自由标签：kind 决定三件事——面板的分组与图标、
 * 注入时的段标题、以及「应用预设」时的覆盖语义（同 kind 覆盖、custom 追加）。
 * 允许自由 kind 会让预设合并退化成「全量追加」，用户点一次合并就得到一份
 * 互相矛盾的人格。
 */
export type SoulCardKind = 'identity' | 'tone' | 'principles' | 'boundaries' | 'style' | 'custom'

/** 卡片种类的合法值（HTTP body 与磁盘 JSON 的归一化闸门）。 */
export const SOUL_CARD_KINDS: readonly SoulCardKind[] = ['identity', 'tone', 'principles', 'boundaries', 'style', 'custom']

/**
 * 每种 kind 在注入文本里的段标题。
 *
 * 与面板分组标题同源，刻意放在 types 里而不是 inject.ts：注入装配与预设 UI
 * 都依赖这套标题，两处各写一份必然漂移（面板改了「语气与语言」，注入里还是
 * 「语气」，用户对不上号）。
 */
export const SOUL_CARD_SECTION_TITLES: Record<SoulCardKind, string> = {
  identity: '身份',
  tone: '语气与语言',
  principles: '行为准则',
  boundaries: '边界',
  style: '风格',
  custom: '自定义',
}

/** 单张灵魂卡片（cards.json 的元素，也是对外契约形状）。 */
export interface SoulCard {
  /** 稳定 id：c_<sha1(kind+title).slice(0,12)>；缺 id 的新卡片由 host 生成。 */
  id: string
  /** 卡片种类（决定图标/分组/注入段标题/预设覆盖语义）。 */
  kind: SoulCardKind
  /** 卡片标题（用户可改，≤40 字）。 */
  title: string
  /** 卡片内容（自由文本，≤1200 字）。 */
  body: string
  /** false = 保留在面板但不参与注入。 */
  enabled: boolean
  /** 注入与展示顺序（升序）。 */
  order: number
  /** 来自哪个预设（用户手写 = null）。 */
  presetId: string | null
  /** 最近更新时间 ISO。 */
  updatedAt: string
}

/** 灵魂预设（presets.json 的元素；内置预设只读）。 */
export interface SoulPreset {
  /** 'builtin:engineer' | 'builtin:writer' | … | 'user:<sha1>'。 */
  id: string
  /** 预设名（≤40 字）。 */
  name: string
  /** 一句话说明（≤120 字）。 */
  desc: string
  /** true = 内置只读（不可删/不可改），false = 用户自定义。 */
  builtin: boolean
  /** 该预设包含的卡片（应用时按 kind 覆盖同种卡片，custom 追加）。 */
  cards: SoulCard[]
  /** 创建时间 ISO。 */
  createdAt: string
}

/** cards.json 的落盘结构。 */
export interface SoulCardsFile {
  version: 1
  cards: SoulCard[]
}

/** presets.json 的落盘结构（只存用户自定义预设；内置预设是代码常量）。 */
export interface SoulPresetsFile {
  version: 1
  presets: SoulPreset[]
}

/** 卡片字段上限（防止面板与注入被单张超长文本拖垮）。 */
export const CARD_TITLE_MAX = 40
export const CARD_BODY_MAX = 1200
export const PRESET_NAME_MAX = 40
export const PRESET_DESC_MAX = 120

/** 稳定卡片 id：c_<sha1(kind+title).slice(0,12)>（同 kind 同标题 = 同一张卡）。 */
export function cardIdOf(kind: SoulCardKind, title: string): string {
  const key = `${kind}\u0000${title.trim()}`
  return `c_${createHash('sha1').update(key).digest('hex').slice(0, 12)}`
}

/** 自定义预设 id：user:<sha1(name|createdAt)>（稳定、可读、不会与内置撞车）。 */
export function presetIdOf(name: string, createdAt: string): string {
  return `user:${createHash('sha1').update(`${name}\u0000${createdAt}`).digest('hex').slice(0, 12)}`
}

/** 归一化卡片种类（未知值一律落到 custom，不丢卡片内容）。 */
export function normalizeCardKind(value: unknown): SoulCardKind {
  return typeof value === 'string' && (SOUL_CARD_KINDS as readonly string[]).includes(value)
    ? value as SoulCardKind
    : 'custom'
}

/** 当前时间 ISO（本地小函数，避免 types → engine/store 的反向依赖）。 */
function nowIsoLocal(): string {
  return new Date().toISOString()
}

/**
 * 容错归一化单张卡片（HTTP body / 磁盘 JSON / 预设常量三条来源共用）。
 *
 * 缺 id 时**由 host 生成**而不是拒绝：面板「新增卡片」与预设导入都会走这条路，
 * 让调用方先算 sha1 等于把 id 规则泄漏给 client（client 与 host 独立部署，
 * 规则漂移就是两张同种同名的卡片各持一个 id）。
 */
export function normalizeCard(value: unknown, fallbackOrder = 0): SoulCard | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const kind = normalizeCardKind(raw.kind)
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, CARD_TITLE_MAX) : ''
  const body = typeof raw.body === 'string' ? raw.body.trim().slice(0, CARD_BODY_MAX) : ''
  // 标题与正文都空 = 一张什么都没说的卡，留着只会在面板与注入里各占一行。
  if (title === '' && body === '') return null
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : cardIdOf(kind, title)
  return {
    id,
    kind,
    title: title === '' ? SOUL_CARD_SECTION_TITLES[kind] : title,
    body,
    enabled: raw.enabled !== false,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? Math.round(raw.order) : fallbackOrder,
    presetId: typeof raw.presetId === 'string' && raw.presetId.trim() !== '' ? raw.presetId.trim() : null,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() !== '' ? raw.updatedAt : nowIsoLocal(),
  }
}

/** 归一化卡片数组：逐张容错 + 按 order 升序稳定排序。 */
export function normalizeCards(value: unknown): SoulCard[] {
  if (!Array.isArray(value)) return []
  const out: SoulCard[] = []
  value.forEach((item, index) => {
    const card = normalizeCard(item, index)
    if (card !== null) out.push(card)
  })
  return sortCards(out)
}

/** 按 order 升序排序（order 相同时保持传入顺序，稳定）。 */
export function sortCards(cards: SoulCard[]): SoulCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (a.card.order - b.card.order) || (a.index - b.index))
    .map(item => item.card)
}

/** 归一化预设（磁盘里的用户自定义预设；内置预设是代码常量、不走这里）。 */
export function normalizePreset(value: unknown): SoulPreset | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, PRESET_NAME_MAX) : ''
  if (name === '') return null
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim() !== '' ? raw.createdAt.trim() : nowIsoLocal()
  const id = typeof raw.id === 'string' && raw.id.startsWith('user:') ? raw.id.trim() : presetIdOf(name, createdAt)
  return {
    id,
    name,
    desc: typeof raw.desc === 'string' ? raw.desc.trim().slice(0, PRESET_DESC_MAX) : '',
    // 磁盘里的一律视为用户自定义：内置预设是代码常量，永远不会从文件读回。
    builtin: false,
    cards: normalizeCards(raw.cards),
    createdAt,
  }
}
