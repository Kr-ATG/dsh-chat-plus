/**
 * dsh-chat-plus — 个人动态（Feed）· 关注对象存储 + 归属判定（host 半身）。
 *
 * 用户原话（2026-10-27）：「右侧增加悬浮球，鼠标移动上去后显示多个球每个关注的
 * 人物或公司头像与名称，点击后弹出该公司或人物的动态，在设置里可添加人物与公司」。
 *
 * 这个文件负责两件互相独立、但必须共用一份数据的事：
 *
 *  1. **存储**：entities.json 的读写（增 / 删 / 改 / 查），带脏数据兜底；
 *  2. **归属判定**：一条生成出来的动态，到底算谁的（createEntityMatcher）。
 *
 * ── 为什么落地在独立文件 entities.json ───────────────────────────────
 *
 * state.json 每 60 秒被闸门续租整体重写一次，posts.json 只在增删改时写。
 * 关注清单是**第三类**数据：写得极少（用户偶尔加一个人），但读得极频繁
 * （每次 GET /posts 都要拿它做归属判定）。混进 state.json 就等于每 60 秒
 * 重写一遍这份清单；混进 posts.json 就更糟 —— 它会被软删与迁移逻辑牵连。
 * 独立文件 + 独立版本号，是本模块唯一不需要跟别人对齐迁移的地方。
 *
 * ── 归属判定为什么是「两段」而不是一段 ───────────────────────────────
 *
 * 第一段看 FeedPost.entityIds（生成时模型标的，最准）；第二段用实体的
 * name + aliases 在 title/body 里做兜底匹配。
 *
 * **兜底不是可选项**：writer 是否真的为每条动态标了 entities 取决于模型
 * 听不听话，而这功能一上来就要能用 —— 若只信第一段，用户加完关注对象、
 * 点开悬浮球，看到的是一片「还没有关于 XXX 的动态」，会直接判定功能坏了。
 * 反过来也不能只靠第二段（字符串匹配判不出「这条其实是关于他的」的语义）。
 * 所以两段都要，且**第一段优先、第二段只填空**。
 *
 * @module
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite, feedDataDir } from './store.ts'
import {
  ENTITIES_SCHEMA_VERSION,
  MAX_ENTITIES,
  MAX_ENTITY_ALIASES,
  MAX_ENTITY_ALIAS_LENGTH,
  newEntityId,
  type FeedEntitiesFile,
  type FeedPost,
  type FollowedEntity,
} from './types.ts'

/* ───────────────────────── 归一化（脏数据兜底） ───────────────────────── */

/** 取字符串（非字符串一律空串）。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 压平空白 + 去首尾 + 截断（用户从网页复制名字常带换行与连续空格）。 */
function cleanText(value: unknown, max: number): string {
  return str(value).replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * 归一化 X 账号：接受 @elonmusk / elonmusk / https://x.com/elonmusk 三种写法。
 *
 * 三种都收的理由：用户是从各种地方复制来的，让他自己知道「这里只填 handle」
 * 是把我们的实现细节推给用户。归一化之后统一成**小写、不含 @** —— 与
 * FeedConfig.xHandles 的口径完全一致（sources.ts 抓取时直接拿它拼 URL）。
 *
 * @returns 合法 handle；不像 handle 的返回 undefined（**不报错**，静默丢弃：
 *   一个填错的账号不该让整个「添加关注对象」失败）。
 */
export function normalizeXHandle(value: unknown): string | undefined {
  let raw = cleanText(value, 200).toLowerCase()
  if (raw === '') return undefined
  raw = raw.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//, '')
  raw = raw.replace(/^@+/, '')
  raw = raw.replace(/[/?#].*$/, '')
  if (!/^[a-z0-9_]{1,15}$/.test(raw)) return undefined
  return raw
}

/**
 * 归一化 URL：只收 http/https。
 *
 * 只收这两种的理由：javascript: / data: 会被原样塞进 img src 或 a href，
 * 那是 XSS 的经典入口。这份数据虽然是本机用户自己填的，但它同时会经 HTTP
 * 下发给浏览器，边界处必须挡一道 —— 挡在这里比挡在渲染层可靠（渲染层有三处）。
 */
export function normalizeUrl(value: unknown): string | undefined {
  const raw = cleanText(value, 2000)
  if (raw === '') return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

/**
 * 归一化别名列表。
 *
 * 同时接受数组与「逗号分隔的字符串」：设置面板那边是让用户填一行逗号分隔的文本
 * （比一堆小输入框好用），但接口的另一个调用方（将来的头像回填、导入）会直接
 * 塞数组。两种都在这里收口，免得客户端与服务端各拆一遍、拆法还不一样。
 */
export function normalizeAliases(value: unknown): string[] {
  const raw: string[] = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? value.split(/[,，、;；\n]/)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const text = cleanText(item, MAX_ENTITY_ALIAS_LENGTH)
    if (text === '') continue
    // 大小写不敏感去重：同一个别名写两遍（OpenAI / openai）没有意义，
    // 而且会让匹配计划里多一条永远撞车的关键词。
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= MAX_ENTITY_ALIASES) break
  }
  return out
}

/** 归一化 kind（不认识的一律按 company —— 悬浮球只是换个标签颜色）。 */
function normalizeKind(value: unknown): FollowedEntity['kind'] {
  return value === 'person' ? 'person' : 'company'
}

/**
 * 把磁盘上的一条关注对象洗成合法的 FollowedEntity；洗不出来返回 null。
 *
 * 逐字段洗的理由与 store.ts 的 normalizePost 同源：entities.json 是纯文本、
 * 可以被用户手改。少洗一个字段的症状往往落在渲染层 —— 例如 aliases 不是数组
 * 会让客户端的 entity.aliases.join() 抛错，整个悬浮球白屏，而接口一切 200。
 */
export function normalizeEntity(raw: unknown): FollowedEntity | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const name = cleanText(r['name'], 60)
  if (name === '') return null
  const id = cleanText(r['id'], 80)
  const entity: FollowedEntity = {
    id: id === '' ? newEntityId() : id,
    name,
    kind: normalizeKind(r['kind']),
    aliases: normalizeAliases(r['aliases']),
    createdAt: typeof r['createdAt'] === 'number' && Number.isFinite(r['createdAt']) && r['createdAt'] > 0
      ? r['createdAt']
      : Date.now(),
  }
  const xHandle = normalizeXHandle(r['xHandle'])
  if (xHandle !== undefined) entity.xHandle = xHandle
  const homeUrl = normalizeUrl(r['homeUrl'])
  if (homeUrl !== undefined) entity.homeUrl = homeUrl
  const avatarUrl = normalizeUrl(r['avatarUrl'])
  if (avatarUrl !== undefined) entity.avatarUrl = avatarUrl
  if (typeof r['weight'] === 'number' && Number.isFinite(r['weight'])) entity.weight = r['weight']
  return entity
}

/* ───────────────────────── 名字首字（服务端算一次） ───────────────────────── */

/**
 * 首字球的字：客户端**永远**会渲染它（有头像时叠在下面，头像加载失败就露出来）。
 *
 * 放服务端算的理由：英文名要取首字母大写（openai → O）、跳过 emoji 与
 * 装饰字符（🔷DeepSeek → D）、东亚文字取首字 —— 这三条规则客户端再写一遍
 * 就等着两边不一致。而且它是**纯函数**，冒烟可以直接对拍。
 */
export function initialOf(name: string): string {
  const text = name.trim()
  if (text === '') return '?'
  // 取第一个「有意义的」字符：跳过空白、标点、符号（含 emoji）。
  for (const char of text) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      // 拉丁字母统一大写；CJK 没有大小写，toUpperCase 是恒等变换。
      return char.toUpperCase()
    }
  }
  return text.slice(0, 1).toUpperCase()
}

/* ───────────────────────── 归属判定 ───────────────────────── */

/** 一条动态归属的判据之一：entityIds 里点了名（tagged）还是别名撞上的（alias）。 */
export type EntityMatchKind = 'tagged' | 'alias'

/**
 * 一个关键词的匹配计划。
 *
 * regex 为 null 表示「没通过长度/形态门槛，永远不参与匹配」。
 * 把编译好的正则留在计划里（而不是每次现编）是因为这条路径每次 GET /posts
 * 都会跑「实体数 × 帖子数」遍，现编正则会把它变成明显的卡顿。
 */
interface MatchRule {
  readonly regex: RegExp | null
}

/** 转义正则元字符（关键词是用户输入的，里面出现 . ( + 都很正常）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 判断一个关键词该不该参与匹配；该参与时返回它的匹配正则。
 *
 * ── 判据（每条都对应一种实测会出现的误命中）────────────────────────
 *
 * 1. **长度 < 2 一律不参与**：单字（李 / X）在任何一篇中文/英文正文里都能
 *    撞上，命中率接近 100%，等于把所有动态都归给这个人。
 * 2. **纯 ASCII 关键词走词边界**：OpenAI 不该在 openailab 里命中，
 *    更不能让 AI 命中 email / said / maintain。边界用 [^a-z0-9] 而不是
 *    正则的单词边界 —— 下划线在词字符眼里算字母，而 deepseek_v3 这种写法
 *    应当算命中。
 * 3. **含中文 / 全角 / 标点的关键词走子串**：中文没有词边界，
 *    黄仁勋 出现在「黄仁勋今天表示」里就是命中，加边界反而全漏。
 */
function buildRule(keyword: string): MatchRule {
  const text = keyword.trim()
  if (text.length < 2) return { regex: null }
  // 只含 ASCII 可打印字符 → 用词边界；否则（中文/日文/全角/emoji）→ 子串。
  if (!/^[\x20-\x7e]+$/.test(text)) {
    return { regex: new RegExp(escapeRegExp(text), 'i') }
  }
  return { regex: new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(text) + '(?:$|[^a-z0-9])', 'i') }
}

/**
 * 「像个关注对象」的最小形状：只包含归属判定与提示词注入真正读的几格。
 *
 * 为什么不用完整的 FollowedEntity 做参数类型：这两个函数的调用方之一是
 * trigger.ts 的 runDeps.entityStore —— 那是**可注入**的读取面（冒烟会塞自己的
 * 实现），它不该被要求提供 weight / createdAt / avatarUrl 这些纯展示字段。
 * 参数放宽到结构形状后，注入方只要给得出这几格就能用，而 EntityStore 天然满足。
 */
export interface EntityLike {
  readonly id?: string
  readonly name: string
  readonly kind?: 'person' | 'company'
  readonly aliases?: readonly string[]
  readonly weight?: number
  readonly createdAt?: number
}

/**
 * 一个实体参与匹配的全部关键词（**名字本身也算**）。
 *
 * 名字必须算的理由：用户最常见的用法就是「名字填黄仁勋、别名留空」。
 * 若只匹配 aliases，这种最常见的填法一条动态都归属不上 —— 会直接被当成
 * 功能坏了。别名只是**补充**（英文名、旧称、产品名）。
 */
export function matchKeywordsOf(entity: FollowedEntity): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const keyword of [entity.name, ...entity.aliases]) {
    const text = keyword.trim()
    if (text === '') continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

/** 匹配计划（每个实体一份，含 entityIds 直通判据）。 */
interface EntityPlan {
  readonly entity: FollowedEntity
  readonly rules: readonly MatchRule[]
}

/**
 * 归属判定器：把「实体表」编译成可复用的一组匹配计划。
 *
 * 为什么是一个工厂而不是几个独立函数：GET /posts 一次要给几十上百条动态
 * 算归属，若每条都重新编译正则，24 个实体会被编译成上千个 RegExp 对象。
 * 一次编译、多次匹配，是把这件事从「明显卡顿」拉回「忽略不计」的关键。
 */
export interface EntityMatcher {
  /** 参与判定的实体（顺序即实体表顺序）。 */
  readonly entities: readonly FollowedEntity[]
  /**
   * 一条动态归属的实体 id（**先 entityIds，后别名兜底**，已去重）。
   * 空数组 = 不属于任何关注对象。
   */
  idsOf(post: FeedPost): string[]
  /** 一条动态是否归属这个实体（等价于 idsOf 里含它，但不构建整个数组）。 */
  belongsTo(post: FeedPost, entityId: string): boolean
  /** 一条动态是怎么归属的（给界面与排查用）；不属于任何实体返回 null。 */
  matchKindOf(post: FeedPost): EntityMatchKind | null
  /** 每个实体名下有多少条动态（悬浮球角标用）。 */
  countByEntity(posts: readonly FeedPost[]): Record<string, number>
}

/**
 * 给一条动态算出需要扫描的正文（**只扫 title + body**）。
 *
 * 刻意**不扫 sources**：来源标题是别人写的（「英伟达发布…」里出现 OpenAI 的名字
 * 很常见），把它算进归属会让「关于某人」变成「顺带提过某人」。
 */
function haystackOf(post: FeedPost): string {
  return (post.title + ' ' + post.body).toLowerCase()
}

/**
 * 编译归属判定器。
 *
 * @param entities - 实体表（调用方已归一化，这里再兜一层：坏项跳过）。
 */
export function createEntityMatcher(entities: readonly FollowedEntity[]): EntityMatcher {
  const plans: EntityPlan[] = []
  for (const entity of entities) {
    const rules = matchKeywordsOf(entity).map(buildRule).filter(rule => rule.regex !== null)
    plans.push({ entity, rules })
  }
  const ids = new Set(plans.map(plan => plan.entity.id))

  /**
   * entityIds 里那些**仍然存在**的实体 id。
   *
   * 过滤掉不存在的：用户删掉一个关注对象之后，老帖子上残留的 fe_xxx
   * 不该继续被当成「已归属」——否则那条动态会从此不属于任何人、也不出现在
   * 「全部」之外任何地方，看起来像凭空消失。
   */
  const taggedIdsOf = (post: FeedPost): string[] => {
    if (!Array.isArray(post.entityIds)) return []
    const out: string[] = []
    for (const id of post.entityIds) {
      if (typeof id === 'string' && ids.has(id) && !out.includes(id)) out.push(id)
    }
    return out
  }

  const aliasIdsOf = (post: FeedPost): string[] => {
    const haystack = haystackOf(post)
    const out: string[] = []
    for (const plan of plans) {
      if (plan.rules.some(rule => rule.regex !== null && rule.regex.test(haystack))) {
        out.push(plan.entity.id)
      }
    }
    return out
  }

  const matcher: EntityMatcher = {
    entities: plans.map(plan => plan.entity),
    idsOf(post: FeedPost): string[] {
      const tagged = taggedIdsOf(post)
      const out = [...tagged]
      // 兜底只填**空位**：已经标了归属的帖子不因为正文里提到别人就再挂一个人
      // （「OpenAI 回应英伟达」这条应当归属 OpenAI，不该同时归属英伟达）。
      if (tagged.length === 0) {
        for (const id of aliasIdsOf(post)) if (!out.includes(id)) out.push(id)
      }
      return out
    },
    belongsTo(post: FeedPost, entityId: string): boolean {
      const tagged = taggedIdsOf(post)
      if (tagged.includes(entityId)) return true
      if (tagged.length > 0) return false
      const plan = plans.find(item => item.entity.id === entityId)
      if (plan === undefined) return false
      const haystack = haystackOf(post)
      return plan.rules.some(rule => rule.regex !== null && rule.regex.test(haystack))
    },
    matchKindOf(post: FeedPost): EntityMatchKind | null {
      if (taggedIdsOf(post).length > 0) return 'tagged'
      if (aliasIdsOf(post).length > 0) return 'alias'
      return null
    },
    countByEntity(posts: readonly FeedPost[]): Record<string, number> {
      const counts: Record<string, number> = {}
      for (const entity of plans) counts[entity.entity.id] = 0
      for (const post of posts) {
        // 软删的不计数（列表里看不到它，角标却加一，是最难解释的那种不一致）。
        if (post.deletedAt !== undefined && post.deletedAt > 0) continue
        for (const id of matcher.idsOf(post)) {
          if (counts[id] !== undefined) counts[id] += 1
        }
      }
      return counts
    },
  }
  return matcher
}

/**
 * 给一批动态补上**实时算出来**的 entityIds（不落盘）。
 *
 * 为什么不落盘就够：writer 那边的标注（模型给 entities: ["OpenAI"]）是
 * 「生成时」一次成型的，而别名兜底依赖的是**当前**的实体表 —— 用户随时会
 * 加一个别名，落盘的归属不会跟着变。所以归属在**读**的时候算，实体表一改
 * 立刻生效。代价是每次列表请求多一点 CPU（可忽略），换来的是「加完别名
 * 马上能看到动态归过去」。
 *
 * 没有任何实体时原样返回（**不塞空数组**）：响应里多一个恒为空的字段，
 * 只会让客户端去猜「是没归属还是没渲染」。
 */
export function withResolvedEntities<T extends FeedPost>(posts: readonly T[], matcher: EntityMatcher): T[] {
  if (matcher.entities.length === 0) return posts as T[]
  return posts.map(post => {
    const ids = matcher.idsOf(post)
    const current = Array.isArray(post.entityIds) ? post.entityIds : []
    if (current.length === ids.length && current.every((id, index) => id === ids[index])) return post as T
    return { ...post, entityIds: ids } as T
  })
}

/* ───────────────────────── 落盘存储 ───────────────────────── */

/** 写操作的结果（与 api.ts 的 200 + ok:false 约定同形）。 */
export type EntityWriteResult =
  | { readonly ok: true; readonly entity: FollowedEntity }
  | { readonly ok: false; readonly error: string }

/** create 的输入（**全部可选字段都在这里收口**，路由层不再各自洗一遍）。 */
export interface EntityInput {
  readonly name?: unknown
  readonly kind?: unknown
  readonly xHandle?: unknown
  readonly homeUrl?: unknown
  readonly avatarUrl?: unknown
  readonly aliases?: unknown
  readonly weight?: unknown
}

/** update 的输入：**只改点名的字段**（没给的保持原值）。 */
export interface EntityPatch extends EntityInput {
  /** 显式清空可选字段：传 true 表示把这个格删掉（传 null 也一样）。 */
  readonly clearXHandle?: unknown
  readonly clearHomeUrl?: unknown
  readonly clearAvatarUrl?: unknown
}

/**
 * 关注对象的落盘存储（进程内单例）。
 *
 * 写法与 FeedStore 一致：**内存态权威 + 返回前真正刷盘 + 串行写**。
 * 关注清单的写频率极低（人手点的），所以不做批处理、不做缓存失效 ——
 * 每次写都整份落盘，几百字节，简单即可靠。
 */
export class EntityStore {
  /** 数据根（与 FeedStore 同一个目录，便于用户一眼看到全部 feed 数据）。 */
  readonly root: string = feedDataDir()

  private entities: FollowedEntity[] = []
  private loaded = false
  /** 串行化写盘：并发写同一文件时后一次会覆盖前一次，必须排队。 */
  private writeChain: Promise<void> = Promise.resolve()

  private get file(): string { return join(this.root, 'entities.json') }

  /** 首次读取落盘状态（幂等）。损坏 / 不存在都当空表，绝不让悬浮球把页面弄崩。 */
  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    let raw: Partial<FeedEntitiesFile> = {}
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(text) as unknown
      if (typeof parsed === 'object' && parsed !== null) raw = parsed as Partial<FeedEntitiesFile>
    } catch {
      // 不存在 / 读不出 / 不是 JSON —— 一律当空表。用户看到的是「还没关注任何
      // 人」，而不是一个报错弹窗；他再添加一次就恢复正常。
      raw = {}
    }
    const list = Array.isArray(raw.entities) ? raw.entities : []
    this.entities = list
      .map(normalizeEntity)
      .filter((entity): entity is FollowedEntity => entity !== null)
      // 同一份文件里出现重复 id 时只留第一个（手改文件最容易犯的错）。
      .filter((entity, index, all) => all.findIndex(item => item.id === entity.id) === index)
      .slice(0, MAX_ENTITIES)
  }

  /** 全部关注对象（按 createdAt 升序：先加的在前，顺序稳定不跳）。 */
  async list(): Promise<FollowedEntity[]> {
    await this.load()
    return [...this.entities].sort((a, b) => a.createdAt - b.createdAt)
  }

  /** 按 id 取一个。 */
  async get(id: string): Promise<FollowedEntity | undefined> {
    await this.load()
    return this.entities.find(entity => entity.id === id)
  }

  /**
   * 重新从磁盘读取（云同步恢复关注对象后调用）。
   *
   * 与 FeedStore.reload 同一手法：先排空写队列，再把内存态清成空表重读，
   * 避免「恢复进来的 entities.json」被上一次的旧内存态覆盖。
   */
  async reload(): Promise<void> {
    await this.writeChain.catch(() => undefined)
    this.loaded = false
    this.entities = []
    await this.load()
  }

  /** 串行写入。 */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task, task)
    this.writeChain = next.catch(() => undefined)
    return next
  }

  /** 写 entities.json（原子写：唯一临时名 + rename）。 */
  private async persist(): Promise<void> {
    const payload: FeedEntitiesFile = { version: ENTITIES_SCHEMA_VERSION, entities: this.entities }
    const text = JSON.stringify(payload, null, 2)
    await this.enqueue(async () => { await atomicWrite(this.file, text) })
  }

  /**
   * 新增一个关注对象。
   *
   * 护栏三条（都对应一次真实的误用）：
   *  1. 名字必填 —— 没名字的球既没首字也没 tooltip，只是个灰点；
   *  2. 同名同类判重 —— 用户连点两次「添加」不该出现两颗一模一样的球；
   *  3. 数量上限 —— 悬浮球展开要能一屏放下（见 MAX_ENTITIES）。
   */
  async create(input: EntityInput): Promise<EntityWriteResult> {
    await this.load()
    const name = cleanText(input.name, 60)
    if (name === '') return { ok: false, error: '名字必填' }
    const kind = normalizeKind(input.kind)
    if (this.entities.some(entity => entity.name.toLowerCase() === name.toLowerCase() && entity.kind === kind)) {
      return { ok: false, error: '已经关注过同名对象了' }
    }
    if (this.entities.length >= MAX_ENTITIES) {
      return { ok: false, error: '最多关注 ' + String(MAX_ENTITIES) + ' 个对象' }
    }
    const entity: FollowedEntity = {
      id: newEntityId(),
      name,
      kind,
      aliases: normalizeAliases(input.aliases),
      createdAt: Date.now(),
    }
    const xHandle = normalizeXHandle(input.xHandle)
    if (xHandle !== undefined) entity.xHandle = xHandle
    const homeUrl = normalizeUrl(input.homeUrl)
    if (homeUrl !== undefined) entity.homeUrl = homeUrl
    const avatarUrl = normalizeUrl(input.avatarUrl)
    if (avatarUrl !== undefined) entity.avatarUrl = avatarUrl
    if (typeof input.weight === 'number' && Number.isFinite(input.weight)) entity.weight = input.weight
    this.entities.push(entity)
    await this.persist()
    return { ok: true, entity }
  }

  /**
   * 局部更新（**只改点名的字段**）。
   *
   * 这条护栏的来历与 vault 的 update 同源：整体覆盖会让「只想加一个别名」
   * 顺手把没传的头像清空 —— 而用户完全看不出是自己哪一步弄丢的。
   * 清空可选字段要**显式**说（传 null 或 clearXxx: true）。
   */
  async update(id: string, patch: EntityPatch): Promise<EntityWriteResult> {
    await this.load()
    const index = this.entities.findIndex(entity => entity.id === id)
    if (index < 0) return { ok: false, error: '没有这个关注对象' }
    const current = this.entities[index] as FollowedEntity
    const next: FollowedEntity = { ...current, aliases: [...current.aliases] }

    if (patch.name !== undefined) {
      const name = cleanText(patch.name, 60)
      if (name === '') return { ok: false, error: '名字不能为空' }
      next.name = name
    }
    if (patch.kind !== undefined) next.kind = normalizeKind(patch.kind)
    if (patch.aliases !== undefined) next.aliases = normalizeAliases(patch.aliases)
    if (typeof patch.weight === 'number' && Number.isFinite(patch.weight)) next.weight = patch.weight

    const assignOptional = (
      key: 'xHandle' | 'homeUrl' | 'avatarUrl',
      value: unknown,
      cleared: boolean,
    ): void => {
      if (cleared || value === null) { delete next[key]; return }
      if (value === undefined) return
      const normalized = key === 'xHandle' ? normalizeXHandle(value) : normalizeUrl(value)
      if (normalized === undefined) { delete next[key]; return }
      next[key] = normalized
    }
    assignOptional('xHandle', patch.xHandle, patch.clearXHandle === true)
    assignOptional('homeUrl', patch.homeUrl, patch.clearHomeUrl === true)
    assignOptional('avatarUrl', patch.avatarUrl, patch.clearAvatarUrl === true)

    this.entities[index] = next
    await this.persist()
    return { ok: true, entity: next }
  }

  /** 删除一个关注对象。删除不存在的 id 也返回成功（幂等，删两次不会报错）。 */
  async remove(id: string): Promise<{ ok: true; removed: boolean }> {
    await this.load()
    const before = this.entities.length
    this.entities = this.entities.filter(entity => entity.id !== id)
    const removed = this.entities.length !== before
    if (removed) await this.persist()
    return { ok: true, removed }
  }
}

/** 进程内单例（懒建：路由层没注入 store 时自己建一个，指向同一个目录即可）。 */
let sharedStore: EntityStore | null = null

/** 取共享的 EntityStore（幂等）。 */
export function sharedEntityStore(): EntityStore {
  if (sharedStore === null) sharedStore = new EntityStore()
  return sharedStore
}

/* ───────────────────────── 派生：与 FeedConfig.xHandles 对齐 ───────────────────────── */

/**
 * 关注对象的 xHandle 合集 —— FeedConfig.xHandles 的唯一真相。
 *
 * 为什么仍然维护 xHandles：X 抓取链路（sources.ts / trigger.ts）读的是
 * config.xHandles，而那两个文件不归这次改动管。所以这里做**单向派生**：
 * 实体表变 → 顺手把 xHandles 写成「所有实体的 handle 合集」。
 *
 * 反过来不做（xHandles → entities）：老版本留下的纯 handle 列表无法反推出
 * 显示名与头像，硬造一堆「名字就是 handle」的球比没有更难看。用户自己再加一次
 * 就好了 —— 界面上加一个人只要填个名字。
 */
export function xHandlesOf(entities: readonly FollowedEntity[]): string[] {
  const out: string[] = []
  for (const entity of entities) {
    if (entity.xHandle === undefined || entity.xHandle === '') continue
    if (!out.includes(entity.xHandle)) out.push(entity.xHandle)
  }
  return out
}

/* ───────────────────────── 给 writer 的投影 ───────────────────────── */

/** writer 注入用的最小实体形状（**只给名字/类型/别名**，不给 id 与头像）。 */
export interface WriterEntity {
  readonly name: string
  readonly kind: 'person' | 'company'
  readonly aliases: readonly string[]
}

/**
 * 把实体表投影成提示词里要用的那一份。
 *
 * 只投影名字 / 类型 / 别名三个字段，理由：
 *  - **id 不能给**模型：它会照着 id 编 entities: ["fe_3f2a…"]，而落盘时
 *    要按名字换回 id，模型给的 id 一旦抄错就静默丢失归属；
 *  - **头像 / URL 不该进提示词**：它们对写内容没有帮助，只会白占 token。
 *
 * 按 weight 降序、再按 createdAt 升序稳定排序：weight 大的人排前面，模型读
 * 提示词时先看到的名字更容易被覆盖到（这是「影响生成时优先关注谁」的落点）。
 */
export function writerEntitiesOf(entities: readonly EntityLike[], limit = MAX_ENTITIES): WriterEntity[] {
  return [...entities]
    // 缺 weight / createdAt 时给中性默认值：注入实现不提供这两格也不该影响排序稳定性。
    .sort((a, b) => {
      const weightDiff = (b.weight ?? 1) - (a.weight ?? 1)
      if (weightDiff !== 0) return weightDiff
      return (a.createdAt ?? 0) - (b.createdAt ?? 0)
    })
    .slice(0, limit)
    .map(entity => ({
      name: entity.name,
      kind: entity.kind === 'person' ? 'person' : 'company',
      aliases: entity.aliases ?? [],
    }))
}

/* ───────────────────────── 模型标注的名字 → 实体 id ───────────────────────── */

/**
 * 把模型标的「实体名字」换回实体 id（生成落盘时用）。
 *
 * 提示词里明确要求模型用**名字**（不是 id、不是别名）标注：`entities: ["OpenAI"]`。
 * 用名字而不是 id 是刻意的 —— 模型抄 id 几乎必错，而抄错时**不会有任何报错**，
 * 只会让那条动态静默失去归属（用户看到的现象是「关于 OpenAI 的那条不在 OpenAI 里」）。
 * 名字错了至少能靠下面的宽松匹配救回来一半。
 *
 * 匹配顺序（宽松 → 严格，靠前优先）：
 *  1. 名字完全相等（忽略大小写与首尾空白）—— 正常路径；
 *  2. 名字命中某个别名 —— 模型偶尔会用别名代替正名（「英伟达」而不是「NVIDIA」）；
 *  3. 实体名是给定名字的子串，或反之 —— 模型会写「NVIDIA Corporation」这种全称。
 *
 * 第 3 条必须加**长度门槛**（≥2）：单字名字（「李」）做子串匹配会把随便一个名字
 * 都吸过去，等于把归属搞乱 —— 这比没归属更糟，因为用户看不出是错的。
 *
 * @param names - 模型给的名字列表（脏数据容忍：非字符串一律跳过）
 * @param entities - 实体表
 * @returns 去重后的实体 id；实在匹配不上就是空数组（**不猜**，留给别名兜底）
 */
export function resolveEntityIds(
  names: readonly unknown[],
  entities: readonly EntityLike[],
): string[] {
  if (!Array.isArray(names) || names.length === 0 || entities.length === 0) return []
  // 没有 id 的项参与不了「换 id」，直接跳过（而不是让整个函数退化成空）。
  const withId = entities.filter((entity): entity is EntityLike & { id: string } => typeof entity.id === 'string' && entity.id !== '')
  if (withId.length === 0) return []
  const out: string[] = []
  for (const raw of names) {
    if (typeof raw !== 'string') continue
    const name = raw.trim().toLowerCase()
    if (name === '') continue
    let hit = withId.find(entity => entity.name.toLowerCase() === name)
    if (hit === undefined) {
      hit = withId.find(entity => (entity.aliases ?? []).some(alias => alias.toLowerCase() === name))
    }
    if (hit === undefined && name.length >= 2) {
      hit = withId.find(entity => {
        const canonical = entity.name.toLowerCase()
        if (canonical.length < 2) return false
        return name.includes(canonical) || canonical.includes(name)
      })
    }
    if (hit !== undefined && !out.includes(hit.id)) out.push(hit.id)
  }
  return out
}

/* ───────────────────────── 导出给冒烟对拍 ───────────────────────── */

export const __test = {
  cleanText,
  normalizeKind,
  haystackOf,
  buildRule,
  escapeRegExp,
}
