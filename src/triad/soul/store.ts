/**
 * dsh-chat-plus — Soul 存储层：数据根沿用 memoryHome()，落在 <root>/soul/ 下。
 *
 * 目录布局与理由：
 *   cards.json         默认层**卡片集合**（schema v2 起的权威层，见下）
 *   presets.json       用户自定义灵魂预设（内置预设是代码常量，见 presets.ts）
 *   soul.md            默认层全文视图（由卡片拼出，写入时同步回写；不存在 = 未设置）
 *   identity.json      默认层结构化身份
 *   profiles/<id>.json 可切换的备用人格（整份快照，不拆两个文件——
 *                      档案是「一份人格」，正文、字段与卡片必须同生共死，
 *                      拆开会出现「正文是 A、字段是 B、卡片是 C」的半写状态）
 *   active.json        当前激活档案 id + 默认层版本元信息
 *
 * schema v2（卡片化）的权威关系：
 *   卡片是权威，soul.md 是它的全文投影。迁移只在 cards.json 不存在且磁盘上确实
 *   有用户内容（soul.md 或 identity.json 存在）时跑一次：从旧文本拆出初始卡片。
 *   此后每次写卡片都顺手重算 soul.md，保证「旧版面板读 soul.md」与「新版面板读
 *   卡片」看到的是同一个人格；否则升级后旧入口显示的人设会与注入内容不一致。
 *   注：默认身份模板里 language 默认「简体中文」，所以迁移必须用「文件是否存在」
 *   而不是「字段是否为空」做判据——否则一个从没设置过灵魂的用户会被凭空塞进
 *   一张「语言：简体中文」的语气卡，从此每会话都注入一段他没写过的人设。
 *
 * 所有写入一律走 store.ts 的 atomicWriteText / atomicWriteJson：面板保存与
 * 「蒸馏后应用」是两条独立入口，同一文件并发写是常态（用户连点两次保存），
 * 非原子写会留下半截 JSON，下次读回就是「灵魂凭空消失」。
 *
 * 与 MemoryStore 的关系：这里**不**复用 MemoryStore 实例。Soul 是独立的顶层
 * 契约层，不参与条目检索/打分/编译，也不该被 entries.json 的回刷节流牵连；
 * 唯一共享的是数据根与原子写工具（import 而非继承）。
 */

import { join } from 'node:path'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { atomicWriteJson, atomicWriteText, memoryHome, nowIso, readJson } from '../memory/engine/store.js'
import {
  assembleInjection,
  applyPresetCards,
  cardsFromDraft,
  composeSoulText,
  dedupeCards,
  identityFromCards,
  renumber,
  seedCardsFromText,
} from './cards.js'
import { BUILTIN_SOUL_PRESETS, isBuiltinPresetId } from './presets.js'
import {
  applyUserVars,
  AVATAR_BASE_ID,
  AVATAR_USER_ID,
  buildUserSection,
  DEFAULT_SOUL_TEMPLATE,
  isUserEmpty,
  isValidAvatarName,
  normalizeCard,
  normalizeCards,
  normalizeIdentity,
  normalizePreset,
  normalizeUser,
  presetIdOf,
  PROFILE_DESC_MAX,
  PROFILE_TAG_MAX,
  SOUL_MIN_PERSONA_BUDGET,
  sortCards,
  type ProfileView,
  type SoulActiveFile,
  type SoulBaseMeta,
  type SoulCard,
  type SoulCardsFile,
  type SoulDraft,
  type SoulIdentity,
  type SoulPreset,
  type SoulPresetsFile,
  type SoulProfile,
  type SoulUser,
  type SoulView,
} from './types.js'

/**
 * 注入预算（字符）。与 zh 通道同口径：够写完整人设，又不至于每会话白烧上下文。
 *
 * 这是**人格段 + 用户段**的总预算（用户段从里面预留，见 injectionContent）。
 */
export const SOUL_INJECT_BUDGET = 2000

/** 档案 id 白名单：只允许小写字母/数字/短横/下划线，杜绝路径穿越。 */
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** 校验档案 id（HTTP body 里来的 id 直接当文件名用，必须先过这道闸）。 */
export function isValidProfileId(id: string): boolean {
  return PROFILE_ID_RE.test(id)
}

/** 由显示名派生一个合法 id（中文名会退化成时间戳 id，仍可用）。 */
export function profileIdFrom(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (slug !== '' && PROFILE_ID_RE.test(slug)) return slug
  return `soul-${Date.now().toString(36)}`
}

/**
 * 身份字段 → 卡片：把 identity 四件套刷进对应 kind 的卡片（正文未变、只改字段时用）。
 *
 * 两条刻意的保守规则：
 *  1. **字段为空时不动那张卡**。用户可能在身份卡里手写过一句比「名字：X」更完整的
 *     自我介绍，字段留空不等于要把这段抹掉。
 *  2. **不新增空卡**。没有值就不建卡，否则面板会多出一张点开什么都没有的空卡。
 * 其它 kind 的卡片（含 custom）一律原样保留——这条路径的语义是「改字段」，
 * 不是「重设人格」。
 */
function syncIdentityCards(cards: SoulCard[], identity: SoulIdentity): SoulCard[] {
  const now = nowIso()
  const upsert = (kind: 'identity' | 'tone' | 'principles', body: string): void => {
    if (body.trim() === '') return
    const index = cards.findIndex(card => card.kind === kind)
    if (index === -1) {
      const card = normalizeCard({ kind, title: kind === 'principles' ? '行为准则' : kind === 'identity' ? '身份' : '语气与语言', body, enabled: true, order: cards.length })
      if (card !== null) cards.push(card)
      return
    }
    cards[index] = { ...cards[index]!, body, updatedAt: now }
  }
  const idLines: string[] = []
  if (identity.name !== '') idLines.push(`名字：${identity.name}`)
  if (identity.role !== '') idLines.push(`角色：${identity.role}`)
  upsert('identity', idLines.join('\n'))
  const toneLines: string[] = []
  if (identity.tone !== '') toneLines.push(`语气：${identity.tone}`)
  if (identity.language !== '') toneLines.push(`语言：${identity.language}`)
  upsert('tone', toneLines.join('\n'))
  upsert('principles', identity.principles.join('\n'))
  return dedupeCards(cards)
}

/** Soul 存储（无内存态：每次读盘，写入频率极低、文件极小）。 */
export class SoulStore {
  readonly root: string

  constructor(root = memoryHome()) {
    this.root = root
  }

  // ── 路径 ────────────────────────────────────────────────────────────

  soulDir(): string { return join(this.root, 'soul') }
  soulFile(): string { return join(this.soulDir(), 'soul.md') }
  identityFile(): string { return join(this.soulDir(), 'identity.json') }
  activeFile(): string { return join(this.soulDir(), 'active.json') }
  cardsFile(): string { return join(this.soulDir(), 'cards.json') }
  presetsFile(): string { return join(this.soulDir(), 'presets.json') }
  profilesDir(): string { return join(this.soulDir(), 'profiles') }
  profileFile(id: string): string { return join(this.profilesDir(), `${id}.json`) }
  /** 用户自己的资料（名字 + 个人档案）。与 soul.md 分开，见 types.SoulUser 注释。 */
  userFile(): string { return join(this.soulDir(), 'user.json') }
  /** 头像实体目录（文件名为 `<档案 id>.<扩展名>`）。 */
  avatarsDir(): string { return join(this.soulDir(), 'avatars') }
  /** 头像索引：`{ "<档案 id>": "<扩展名>" }`，与实体文件同生共死。 */
  avatarIndexFile(): string { return join(this.soulDir(), 'avatars.json') }
  /** 主档没有 profile id，用固定占位串当头像 id（见 types.AVATAR_BASE_ID）。 */
  avatarIdFor(profileId: string | null): string { return profileId ?? AVATAR_BASE_ID }
  avatarFile(name: string): string { return join(this.avatarsDir(), name) }

  // ── 读 ──────────────────────────────────────────────────────────────

  /** 默认层正文；文件缺失返回 null（**不回落模板**，模板回落只在视图层做）。 */
  async readBaseContent(): Promise<string | null> {
    try {
      return await readFile(this.soulFile(), 'utf8')
    } catch {
      return null
    }
  }

  async readBaseIdentity(): Promise<SoulIdentity> {
    return normalizeIdentity(await readJson<unknown>(this.identityFile(), null))
  }

  // ── 我的资料（用户侧，与人格完全解耦） ──────────────────────────────

  /** 读用户资料（缺失/损坏 → 空）。 */
  async readUser(): Promise<SoulUser> {
    return normalizeUser(await readJson<unknown>(this.userFile(), null))
  }

  /**
   * 写用户资料（整份覆盖，不做局部合并）。
   *
   * 面板把 name + profile 一起提交（它本来就是同一块表单），局部合并反而要处理
   * 「只想清空档案、名字不动」与「只改名字」两种意图的区分——那需要额外的
   * 「字段是否出现」协议，而这个表单不存在部分提交的场景。
   */
  async writeUser(user: SoulUser): Promise<SoulUser> {
    const next = normalizeUser(user)
    // 两个字段都空 = 用户清空了整块资料。此时**删文件**而不是落一份空 JSON：
    // 「文件不存在」是注入侧「没有用户资料」的判据，留一份空对象会让判据多一条分支。
    if (isUserEmpty(next)) {
      try { await unlink(this.userFile()) } catch { /* 本来就没有 */ }
      return next
    }
    await atomicWriteJson(this.userFile(), next)
    return next
  }

  /** 用户头像文件名；未上传返回 null。走与人格头像同一套索引与命名。 */
  async userAvatarName(): Promise<string | null> {
    return this.avatarNameFor(AVATAR_USER_ID)
  }

  async readActive(): Promise<SoulActiveFile> {
    const raw = await readJson<Partial<SoulActiveFile> | null>(this.activeFile(), null)
    const profileId = typeof raw?.profileId === 'string' && isValidProfileId(raw.profileId)
      ? raw.profileId
      : null
    const base = raw?.base
    return {
      profileId,
      base: {
        version: typeof base?.version === 'number' && Number.isFinite(base.version) ? base.version : 0,
        updatedAt: typeof base?.updatedAt === 'string' ? base.updatedAt : null,
        source: base?.source === 'distill' ? 'distill' : 'manual',
        ...(typeof base?.desc === 'string' ? { desc: base.desc } : {}),
        ...(typeof base?.tag === 'string' ? { tag: base.tag } : {}),
      },
    }
  }

  /** 读单个档案；不存在/损坏返回 null。 */
  async readProfile(id: string): Promise<SoulProfile | null> {
    if (!isValidProfileId(id)) return null
    const raw = await readJson<Partial<SoulProfile> | null>(this.profileFile(id), null)
    if (raw === null || typeof raw.content !== 'string') return null
    return {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : id,
      content: raw.content,
      identity: normalizeIdentity(raw.identity),
      version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      source: raw.source === 'distill' ? 'distill' : 'manual',
      desc: typeof raw.desc === 'string' ? raw.desc.trim().slice(0, PROFILE_DESC_MAX) : '',
      tag: typeof raw.tag === 'string' ? raw.tag.trim().slice(0, PROFILE_TAG_MAX) : '',
      // 老档案没有 cards 字段：这里**不**做迁移（读路径必须无副作用，
      // 面板每渲染一次就写一次盘是不可接受的）。缺省交给调用方按需迁移。
      ...(Array.isArray(raw.cards) ? { cards: normalizeCards(raw.cards) } : {}),
    }
  }

  /** 档案列表（按名字排序，读盘失败只跳过单条）。 */
  async listProfiles(): Promise<SoulProfile[]> {
    let ids: string[]
    try {
      ids = (await readdir(this.profilesDir(), { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name.slice(0, -'.json'.length))
    } catch {
      return []
    }
    const out: SoulProfile[] = []
    for (const id of ids) {
      const profile = await this.readProfile(id)
      if (profile !== null) out.push(profile)
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  /**
   * 当前灵魂的对外视图。
   *
   * 默认层**未落盘**时 content 回落模板、version=0、updatedAt=null：
   * 面板因此能区分「从没设置过」与「用户保存过一份内容」——回落发生在视图层，
   * 磁盘上依然没有 soul.md，注入侧读到的仍是「无灵魂」。
   */
  async view(): Promise<SoulView> {
    const active = await this.readActive()
    // 用户资料与「当前是哪份人格」无关，所以两个分支都要带上；读一次复用。
    const user = await this.readUser()
    const userAvatar = await this.userAvatarName()
    if (active.profileId !== null) {
      const profile = await this.readProfile(active.profileId)
      if (profile !== null) {
        return {
          content: profile.content,
          identity: profile.identity,
          profileId: profile.id,
          version: profile.version,
          updatedAt: profile.updatedAt,
          source: profile.source,
          avatar: await this.avatarNameFor(profile.id),
          desc: profile.desc,
          tag: profile.tag,
          user,
          userAvatar,
          soulSource: profile.cards !== undefined ? 'cards' : 'soul.md',
        }
      }
      // 激活档案被删/损坏：静默回落默认层，不抛（面板拿到的是可用视图，
      // active.json 会在下次写入时被纠正）。
    }
    const content = await this.readBaseContent()
    const identity = await this.readBaseIdentity()
    return {
      content: content ?? DEFAULT_SOUL_TEMPLATE,
      identity,
      profileId: null,
      version: active.base.version,
      updatedAt: active.base.updatedAt,
      source: active.base.source,
      avatar: await this.avatarNameFor(null),
      desc: active.base.desc ?? '',
      tag: active.base.tag ?? '',
      user,
      userAvatar,
      // 面板据此区分「卡片装配」与「整段文本」。未落盘时也报 soul.md：
      // 此时 content 是模板，卡片层根本不存在。
      soulSource: content === null ? 'soul.md' : (await this.readCards()) !== null ? 'cards' : 'soul.md',
    }
  }

  /** 档案列表视图（标记 active）。 */
  async profileViews(): Promise<ProfileView[]> {
    const active = await this.readActive()
    const profiles = await this.listProfiles()
    // 头像索引一次读出来配给每份档案：N 份档案读 N 次索引文件毫无意义，
    // 而索引缺失时全部回 null（没传过头像）正是想要的语义。
    const avatars = await this.readAvatarIndex()
    return profiles.map(profile => {
      // 索引里存的是**扩展名**（见 writeAvatar），对外契约要的是**文件名**：
      // 直接回扩展名会让面板拿到一个 "png" 当头像标识，看着像有图、实际拼不出路径。
      const ext = avatars[profile.id]
      return {
        id: profile.id,
        name: profile.name,
        active: profile.id === active.profileId,
        updatedAt: profile.updatedAt,
        desc: profile.desc,
        tag: profile.tag,
        avatar: ext === undefined ? null : `${profile.id}.${ext}`,
      }
    })
  }

  // ── 档案头像（展示件：只影响面板卡片，不参与注入） ──────────────────

  /** 读头像索引（缺失/损坏 → {}，不抛）。 */
  async readAvatarIndex(): Promise<Record<string, string>> {
    const raw = await readJson<Record<string, unknown> | null>(this.avatarIndexFile(), null)
    if (raw === null || typeof raw !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [id, ext] of Object.entries(raw)) {
      // 索引里出现白名单外的值 = 手工改坏了：跳过而不是回一个会被当路径用的串。
      if (typeof ext === 'string' && isValidAvatarName(`${id}.${ext}`)) out[id] = ext
    }
    return out
  }

  /** 某个「人格」（档案 id 或主档占位）的头像文件名；未设置返回 null。 */
  async avatarNameFor(profileId: string | null): Promise<string | null> {
    const index = await this.readAvatarIndex()
    const ext = index[this.avatarIdFor(profileId)]
    return ext === undefined ? null : `${this.avatarIdFor(profileId)}.${ext}`
  }

  /**
   * 写入头像。
   *
   * 两个刻意的处理：
   *  1. **换扩展名时删旧文件**（png → jpg 是同一份人格换图，不是两份图）。否则
   *     目录里会攒下一堆永远读不到的孤儿文件，而索引只指向最后一张。
   *  2. 索引与实体分两步写。先写实体再写索引：中途失败留下的是一个没人引用的
   *     文件（无害），反过来则是一个指向不存在文件的索引（面板每次开都破图）。
   */
  async writeAvatar(profileId: string | null, ext: string, bytes: Buffer): Promise<string> {
    const id = this.avatarIdFor(profileId)
    if (!isValidAvatarName(`${id}.${ext}`)) throw new Error(`头像 id 非法：${id}`)
    const name = `${id}.${ext}`
    await mkdir(this.avatarsDir(), { recursive: true })
    // 原子替换：先写临时文件再 rename，避免面板刷新到半张图。
    const temp = `${this.avatarFile(name)}.${process.pid}.tmp`
    try {
      await writeFile(temp, bytes)
      await rename(temp, this.avatarFile(name))
    } catch (error) {
      // 写一半失败别把 tmp 留在盘上（与 atomicWriteText 同一条纪律）。
      try { await unlink(temp) } catch { /* 已被 rename 走或从不存在 */ }
      throw error
    }
    const index = await this.readAvatarIndex()
    const previous = index[id]
    index[id] = ext
    await atomicWriteJson(this.avatarIndexFile(), index)
    if (previous !== undefined && previous !== ext) {
      try { await unlink(this.avatarFile(`${id}.${previous}`)) } catch { /* 已被删或从不存在 */ }
    }
    return name
  }

  /**
   * 删除头像。返回是否真的删掉了（false = 本来就没有）。
   *
   * 索引先删、实体后删：即使实体删除失败，用户看到的也是「头像没了」；
   * 反过来（先删实体）则会留下一段时间的破图。
   */
  async removeAvatar(profileId: string | null): Promise<boolean> {
    const id = this.avatarIdFor(profileId)
    const index = await this.readAvatarIndex()
    const ext = index[id]
    if (ext === undefined) return false
    delete index[id]
    await atomicWriteJson(this.avatarIndexFile(), index)
    try { await unlink(this.avatarFile(`${id}.${ext}`)) } catch { /* 从不存在 */ }
    return true
  }

  // ── 卡片（schema v2 权威层） ────────────────────────────────────────

  /** 读默认层卡片；cards.json 不存在返回 null（**不落盘**，只读）。 */
  async readCards(): Promise<SoulCard[] | null> {
    const raw = await readJson<Partial<SoulCardsFile> | null>(this.cardsFile(), null)
    if (raw === null || !Array.isArray(raw.cards)) return null
    return normalizeCards(raw.cards)
  }

  /**
   * 当前生效层的卡片（唯一对外读入口）。
   *
   * 档案有卡片就返回档案的；档案没卡片（老档案）就地用档案正文迁移一份并
   * **写回档案**——写回是刻意的：不写回的话每次读都要重算一遍，用户改过的
   * 卡片顺序永远存不下来。
   */
  async cards(): Promise<SoulCard[]> {
    const active = await this.readActive()
    if (active.profileId !== null) {
      const profile = await this.readProfile(active.profileId)
      if (profile !== null) {
        if (profile.cards !== undefined) return sortCards(profile.cards)
        const seeded = seedCardsFromText(profile.content, profile.identity)
        await atomicWriteJson(this.profileFile(profile.id), { ...profile, cards: seeded })
        return seeded
      }
    }
    const existing = await this.readCards()
    if (existing !== null) return existing
    // 默认层迁移：只在磁盘上确实有用户内容时跑（见文件头对 language 默认值的说明）。
    const content = await this.readBaseContent()
    const hasIdentityFile = (await readJson<unknown>(this.identityFile(), null)) !== null
    if (content === null && !hasIdentityFile) return []
    const identity = await this.readBaseIdentity()
    const seeded = seedCardsFromText(content, identity)
    if (seeded.length === 0) return []
    await this.writeCards(seeded, { syncText: false })
    return seeded
  }

  /**
   * 写**当前生效层**的卡片，并同步重算该层的全文与身份字段。
   *
   * 为什么是「生效层」而不是「默认层」：卡片面板展示的是生效层的卡片（见 cards()），
   * 用户在激活备用档案时改一张卡，预期改的是「我现在这个人格」。若固定写默认层，
   * 会出现「面板改完显示成功、注入的人设纹丝不动」——与 soul_set 工具早先踩过的
   * 是同一个坑（工具注释里记着那次修复）。激活档案时写档案，否则写默认层。
   *
   * 三处一起写（卡片 + 全文 + 身份）同样是刻意的：卡片是权威，但全文是旧面板与
   * 「全文视图」的读入口，身份字段是 soul_show 工具与面板表单的读入口。只写
   * cards.json 会让三个读入口各说一套，用户看到的与注入进去的不是同一个人格。
   * syncText=false 只用于迁移路径（迁移时正文已经在盘上，回写等于把用户的
   * 原始 markdown 改写成我们拼的格式，属于无谓的信息损失）。
   */
  async writeCards(cards: SoulCard[], options: { syncText?: boolean } = {}): Promise<SoulCard[]> {
    const next = dedupeCards(cards)
    const active = await this.readActive()
    if (active.profileId !== null) {
      const profile = await this.readProfile(active.profileId)
      if (profile !== null) {
        if (options.syncText === false) {
          await atomicWriteJson(this.profileFile(profile.id), { ...profile, cards: next })
          return next
        }
        const text = composeSoulText(next)
        await atomicWriteJson(this.profileFile(profile.id), {
          ...profile,
          cards: next,
          // 空装配结果（卡片全禁用/全空）不回写正文：那会把档案正文清空，
          // 用户只是想临时停用注入，不该顺手丢掉写好的文本。
          content: text === '' ? profile.content : text,
          identity: identityFromCards(next),
          version: profile.version + 1,
          updatedAt: nowIso(),
        })
        return next
      }
    }
    await atomicWriteJson(this.cardsFile(), { version: 1, cards: next } satisfies SoulCardsFile)
    if (options.syncText !== false) {
      const text = composeSoulText(next)
      const identity = identityFromCards(next)
      const meta = { version: active.base.version + 1, updatedAt: nowIso(), source: active.base.source }
      await atomicWriteText(this.soulFile(), text)
      await atomicWriteJson(this.identityFile(), identity)
      await atomicWriteJson(this.activeFile(), { profileId: active.profileId, base: meta })
    }
    return next
  }

  /**
   * 卡片增量写入：upsert / remove / reorder 一次落盘。
   *
   * 三者合并成一次写而不是三个端点：面板一次交互（拖拽排序后顺手改了一张卡的
   * 开关）会连发几个请求，分端点写会互相覆盖 order，最后落盘的是「中间态」。
   * 这里的处理顺序固定为 upsert → remove → reorder，reorder 永远最后生效。
   */
  async mutateCards(patch: { upsert?: unknown[]; remove?: string[]; reorder?: string[] }): Promise<SoulCard[]> {
    const current = await this.cards()
    const byId = new Map(current.map(card => [card.id, card]))
    for (const raw of patch.upsert ?? []) {
      // 归一化必须在**这一层**做，且 order 的缺省判定要能看到调用方原始输入：
      // 早先在 router 里先 normalizeCard 一次，缺 order 被钉成 0（默认 fallback），
      // 到了这里「order 是数字 0」与「调用方显式指定 order=0」再也分不开——于是
      // 每张新卡的 order 都是 0，排序退化成「靠稳定排序碰运气」，reorder 也永远
      // 不生效（旧 order 全是 0，重排后又被 sortCards 按 0 拉回原序）。
      const card = normalizeCard(raw, byId.size)
      if (card === null) continue
      const existing = byId.get(card.id)
      // order 缺省时：已有卡沿用旧值（面板「只改正文」的请求不带 order，按 fallback
      // 落成数组长度会让每保存一次正文卡片就往后挪一位），新卡排到最后。
      const explicitOrder = (raw as { order?: unknown } | null)?.order
      const order = typeof explicitOrder === 'number'
        ? card.order
        : (existing !== undefined ? existing.order : byId.size)
      byId.set(card.id, { ...card, order })
    }
    for (const id of patch.remove ?? []) byId.delete(id)
    let next = renumber([...byId.values()])
    if (patch.reorder !== undefined && patch.reorder.length > 0) {
      const rank = new Map<string, number>()
      patch.reorder.forEach((id, index) => rank.set(id, index))
      // 未出现在 reorder 数组里的卡片排在其后（保持原有相对顺序），不丢卡。
      const ranked = next.map((card, index) => ({ card, key: rank.has(card.id) ? rank.get(card.id)! : patch.reorder!.length + index }))
      // 这里**不能**再走 renumber：它按卡片上的旧 order 重排，会把刚算好的新顺序
      // 原样打回（这正是「reorder 请求 200 但顺序没变」的成因）。直接按新顺序赋号。
      next = ranked.sort((a, b) => a.key - b.key).map((item, index) => ({ ...item.card, order: index }))
    }
    return this.writeCards(next)
  }

  /** 应用预设：replace = 整套采用；merge = 同 kind 覆盖、custom 追加、其它保留。 */
  async applyPreset(presetId: string, mode: 'replace' | 'merge'): Promise<SoulCard[]> {
    const preset = await this.findPreset(presetId)
    if (preset === null) throw new Error(`灵魂预设不存在：${presetId}`)
    const current = await this.cards()
    return this.writeCards(applyPresetCards(current, preset.cards, mode, preset.id))
  }

  // ── 预设库 ──────────────────────────────────────────────────────────

  /** 读用户自定义预设（presets.json；缺失/损坏返回 []）。 */
  async readPresets(): Promise<SoulPreset[]> {
    const raw = await readJson<Partial<SoulPresetsFile> | null>(this.presetsFile(), null)
    if (raw === null || !Array.isArray(raw.presets)) return []
    const out: SoulPreset[] = []
    for (const item of raw.presets) {
      const preset = normalizePreset(item)
      if (preset !== null) out.push(preset)
    }
    return out
  }

  /** 全量预设列表：内置常量在前（只读），用户自定义在后（按创建时间倒序）。 */
  async listPresets(): Promise<SoulPreset[]> {
    const custom = await this.readPresets()
    custom.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return [...BUILTIN_SOUL_PRESETS.map(preset => ({ ...preset, cards: preset.cards.map(card => ({ ...card })) })), ...custom]
  }

  /** 按 id 找预设（内置 + 自定义）。 */
  async findPreset(id: string): Promise<SoulPreset | null> {
    const presets = await this.listPresets()
    return presets.find(preset => preset.id === id) ?? null
  }

  /** 新建自定义预设（id 由 host 生成 'user:<sha1>'）。 */
  async createPreset(input: { name: string; desc?: string; cards: SoulCard[] }): Promise<SoulPreset> {
    const createdAt = nowIso()
    const preset = normalizePreset({
      id: presetIdOf(input.name, createdAt),
      name: input.name,
      desc: input.desc ?? '',
      cards: input.cards,
      createdAt,
    })
    if (preset === null) throw new Error('预设名为空')
    const existing = await this.readPresets()
    // 同名预设覆盖而不是并列：用户重复点「存为预设」的预期是更新那一份，
    // 不是攒出五份名字一样的预设让他自己认。
    const next = [...existing.filter(item => item.name !== preset.name), preset]
    await atomicWriteJson(this.presetsFile(), { version: 1, presets: next } satisfies SoulPresetsFile)
    return preset
  }

  /**
   * 删除自定义预设。
   *
   * 内置预设**一律拒绝**（返回 false），由 router 翻成 400：内置预设是代码常量，
   * 磁盘上根本没有它，删不掉；返回 false 而不是静默 true 是为了让「面板隐藏删除
   * 按钮」与「后端真的拒绝」两件事都成立——只靠前端隐藏，一次手写请求就能试出来。
   */
  async removePreset(id: string): Promise<boolean> {
    if (isBuiltinPresetId(id)) return false
    const existing = await this.readPresets()
    const next = existing.filter(preset => preset.id !== id)
    if (next.length === existing.length) return false
    await atomicWriteJson(this.presetsFile(), { version: 1, presets: next } satisfies SoulPresetsFile)
    return true
  }

  // ── 写 ──────────────────────────────────────────────────────────────

  /**
   * 写默认层（正文 + 身份 + 元信息，整体一次落三处），并把卡片层同步到同一人格。
   *
   * 卡片同步规则（reconcileCards）：整段正文被改写 → 按新正文重新拆卡；正文没变、
   * 只改了身份字段 → 保留用户现有的卡片（含自定义卡与禁用状态），只把身份/语气/
   * 准则三张对应卡的内容刷成新字段值。不区分这两种情况的话，「改一下名字」会把
   * 用户攒的自定义卡全部拍平成「自定义」小节。
   */
  async writeBase(
    content: string,
    identity: SoulIdentity,
    source: 'manual' | 'distill',
    cardMeta?: { desc?: string; tag?: string },
  ): Promise<SoulView> {
    const active = await this.readActive()
    // 展示件缺省沿用现值：面板「只改正文」时不该把用户写好的卡片说明清空
    // （与 writeProfile 的 name/desc/tag 同一条取舍）。
    const desc = cardMeta?.desc !== undefined ? cardMeta.desc.trim().slice(0, PROFILE_DESC_MAX) : (active.base.desc ?? '')
    const tag = cardMeta?.tag !== undefined ? cardMeta.tag.trim().slice(0, PROFILE_TAG_MAX) : (active.base.tag ?? '')
    const meta = {
      version: active.base.version + 1,
      updatedAt: nowIso(),
      source,
      ...(desc === '' ? {} : { desc }),
      ...(tag === '' ? {} : { tag }),
    }
    // 先按传入的正文/字段算卡片，再由卡片**拼回** soul.md：
    //   - 卡片是权威层，soul.md 是它的全文投影（任务口径）。若这里保留用户原文，
    //     同一个灵魂会有两份文本（原文含 `# 标题`，卡片装配含段标题），面板「全文
    //     视图」与注入内容对不上，用户改完看不出到底生效了哪一份。
    //   - identity.json 刻意用**传入的字段**而不是 identityFromCards()：面板表单是
    //     字段的权威来源，从卡片正文反推只在「直写卡片」那条路径上做（writeCards）。
    const nextCards = await this.reconcileCards(content, identity)
    const text = composeSoulText(nextCards)
    await atomicWriteText(this.soulFile(), text)
    await atomicWriteJson(this.identityFile(), identity)
    await atomicWriteJson(this.activeFile(), { profileId: active.profileId, base: meta })
    await atomicWriteJson(this.cardsFile(), { version: 1, cards: nextCards } satisfies SoulCardsFile)
    return {
      content: text,
      identity,
      profileId: active.profileId,
      version: meta.version,
      updatedAt: meta.updatedAt,
      source: meta.source,
      avatar: await this.avatarNameFor(active.profileId),
      desc,
      tag,
      user: await this.readUser(),
      userAvatar: await this.userAvatarName(),
      soulSource: 'cards',
    }
  }

  /**
   * 只改主档的角色卡展示件（不动正文、不动卡片、不 bump 版本）。
   *
   * 为什么要单开一条路径而不是复用 writeBase：writeBase 会重算卡片与 soul.md
   * 并把版本号 +1。改一句卡片定位属于纯展示编辑，让它顺带重写人设正文等于
   * 「调个标签却动了注入内容」——用户无从预期。
   */
  async setBaseCardMeta(meta: { desc?: string; tag?: string }): Promise<SoulView> {
    const active = await this.readActive()
    const desc = meta.desc !== undefined ? meta.desc.trim().slice(0, PROFILE_DESC_MAX) : (active.base.desc ?? '')
    const tag = meta.tag !== undefined ? meta.tag.trim().slice(0, PROFILE_TAG_MAX) : (active.base.tag ?? '')
    // 空串 = 清掉这个字段（而不是留一个空串在盘上）：active.json 是给人看的，
    // 一个 `"desc": ""` 会让人分不清「没设过」和「设成了空」。
    const base: SoulBaseMeta = { version: active.base.version, updatedAt: active.base.updatedAt, source: active.base.source }
    if (desc !== '') base.desc = desc
    if (tag !== '') base.tag = tag
    await atomicWriteJson(this.activeFile(), { profileId: active.profileId, base })
    return this.view()
  }

  /**
   * 正文/身份直写后，把卡片层对齐（详见 writeBase 注释）。
   * 返回值一定会落盘到 cards.json，调用方不必再写一次。
   */
  private async reconcileCards(content: string, identity: SoulIdentity): Promise<SoulCard[]> {
    const existing = await this.readCards()
    // 判据「传入正文 == 现有卡片的装配结果」意味着用户只改了身份字段（面板保存时
    // 带的 content 就是上一次装配出来的全文），此时保留用户攒下的卡片结构与自定义卡；
    // 不相等则说明整段正文被改写（soul_set / 面板全文编辑），按新正文重拆。
    if (existing !== null && composeSoulText(existing) === `${content.trim()}\n`) {
      return syncIdentityCards(existing, identity)
    }
    return seedCardsFromText(content, identity)
  }

  /**
   * 保存档案。已存在的档案版本号 +1；新建从 1 起。
   * 保存档案**不动** active.json —— 「保存」与「切换」是两件事，
   * 顺手激活会让「我在改备用人格」变成「我的会话人设被偷偷换了」。
   */
  async writeProfile(
    id: string,
    content: string,
    identity: SoulIdentity,
    source: 'manual' | 'distill',
    name?: string,
    cards?: SoulCard[],
    meta?: { desc?: string; tag?: string },
  ): Promise<SoulProfile> {
    const existing = await this.readProfile(id)
    // 名字优先级：显式 name > 已存在档案的名字 > 身份里的名字 > id。
    // 「已存在档案的名字」排在 identity.name 之前是刻意的：改正文时不该把
    // 用户手动命名的档案名悄悄覆盖成身份字段里的另一个名字。
    const resolvedName = name !== undefined && name.trim() !== ''
      ? name.trim()
      : (existing?.name !== undefined && existing.name !== '' ? existing.name : (identity.name !== '' ? identity.name : id))
    // 卡片随档案一起落盘：档案是「一整份人格」，正文、字段与卡片必须同生共死。
    // 显式给了 cards 就用它；否则按正文是否被改写决定「重拆」还是「保留 + 刷身份卡」。
    const nextCards = cards ?? (existing?.cards !== undefined && existing.content === content
      ? syncIdentityCards(existing.cards, identity)
      : seedCardsFromText(content, identity))
    // content 同样由卡片拼回（与 writeBase 同口径）：档案正文是卡片装配的投影，
    // 否则同一份档案会存在「用户原文」与「注入用的卡片装配」两个版本。
    const text = composeSoulText(nextCards)
    const profile: SoulProfile = {
      id,
      name: resolvedName,
      content: text === '' ? content : text,
      identity,
      version: (existing?.version ?? 0) + 1,
      updatedAt: nowIso(),
      source,
      cards: nextCards,
      // 副标题/小标签是纯展示件：缺省沿用档案里已有的值，避免「只改正文」把
      // 用户写好的卡片说明清空（与 name 的取舍同一条理由）。
      desc: meta?.desc !== undefined ? meta.desc.trim().slice(0, PROFILE_DESC_MAX) : (existing?.desc ?? ''),
      tag: meta?.tag !== undefined ? meta.tag.trim().slice(0, PROFILE_TAG_MAX) : (existing?.tag ?? ''),
    }
    await atomicWriteJson(this.profileFile(id), profile)
    return profile
  }

  /**
   * 删除档案。
   *
   * 两个刻意的语义：
   *  1. **幂等**：文件不存在也算成功（返回 false 表示「本来就没有」，调用方
   *     不必区分）。面板连点两次删除、或两个标签页同时删，都不该报错。
   *  2. **被删的是当前激活档案时清空 active.json**：否则 active 指向一个不存在的
   *     文件，每次 view() 都要走一遍「档案读不到 → 回落默认层」的兜底路径。
   *     显式清空让磁盘状态自洽，回落从异常路径变成正常路径。
   */
  async removeProfile(id: string): Promise<boolean> {
    if (!isValidProfileId(id)) return false
    let existed = true
    try {
      await unlink(this.profileFile(id))
    } catch {
      existed = false
    }
    // 头像跟着档案一起删：档案没了、头像还在目录里，就是一个永远读不到的孤儿
    // （面板不会再渲染它，索引却仍指向它）。失败不抛——档案已删是主结果。
    try { await this.removeAvatar(id) } catch { /* 头像删除失败不影响档案删除 */ }
    const active = await this.readActive()
    if (active.profileId === id) {
      await atomicWriteJson(this.activeFile(), { profileId: null, base: active.base })
    }
    return existed
  }

  /** 切换激活档案（null = 回到默认层）。返回切换后的视图。 */
  async activate(id: string | null): Promise<SoulView> {
    const active = await this.readActive()
    if (id !== null) {
      if (!isValidProfileId(id)) throw new Error(`档案 id 非法：${id}`)
      const profile = await this.readProfile(id)
      if (profile === null) throw new Error(`灵魂档案不存在：${id}`)
    }
    await atomicWriteJson(this.activeFile(), { profileId: id, base: active.base })
    return this.view()
  }

  /**
   * 应用蒸馏草案：写默认层并清除激活档案（草案就是「新的默认人格」）。
   *
   * 卡片层**必须一起换**：否则蒸馏完灵魂变了、卡片还是旧的，面板显示的是旧人格、
   * 注入的是新人格（注入读卡片），用户会看到「面板说我改了，模型行为没变」。
   * 草案自带 cards 时直接采用（面板可能让用户在应用前编辑过卡片），否则现拆。
   */
  async applyDraft(draft: SoulDraft): Promise<SoulView> {
    const active = await this.readActive()
    // 草案是「新的默认人格」：展示件跟着清掉（沿用旧主档的说明会变成
    // 「蒸馏出来的新人格挂着上一份人设的定位」），头像同理不继承。
    const meta = { version: active.base.version + 1, updatedAt: nowIso(), source: 'distill' as const }
    await atomicWriteText(this.soulFile(), draft.content)
    await atomicWriteJson(this.identityFile(), draft.identity)
    await atomicWriteJson(this.activeFile(), { profileId: null, base: meta })
    const cards = draft.cards !== undefined && draft.cards.length > 0
      ? dedupeCards(draft.cards)
      : cardsFromDraft(draft)
    await atomicWriteJson(this.cardsFile(), { version: 1, cards } satisfies SoulCardsFile)
    return {
      content: draft.content,
      identity: draft.identity,
      profileId: null,
      version: meta.version,
      updatedAt: meta.updatedAt,
      source: 'distill',
      avatar: await this.avatarNameFor(null),
      desc: '',
      tag: '',
      // 蒸馏换的是「agent 人设」，用户自己的资料不该被它动（包括头像）。
      user: await this.readUser(),
      userAvatar: await this.userAvatarName(),
      soulSource: 'cards',
    }
  }

  /**
   * 注入用的灵魂正文（唯一读入口，schema v2 起改为**卡片装配**）。
   *
   * 对外签名刻意不变（inject.ts 一个字都不用改）：注入引擎只问一句「现在要注入
   * 什么」，不该知道内容是来自一段 markdown 还是十张卡片。
   *
   * 空/纯空白一律返回 ''：注入侧据此跳过，不产生一条「标题下面什么都没有」的
   * 空消息。**不回落默认模板**——模板是面板的编辑起点，不是用户的人设；
   * 把模板当人设注入等于每个用户都被塞一份我们编的准则。
   * 卡片全禁用（或全是空正文）时装配结果同样是 ''，通道静默跳过。
   *
   * 2026-10-07 起两件事在这里发生（顺序不能换）：
   *   1. **变量替换**：卡片正文里的 `{{userName}}` / `{{userProfile}}` 换成用户
   *      资料的真值。必须发生在装配**之后**（按段替换整段文本），理由见下。
   *   2. **追加用户段**：`## 用户` + 称呼 + 档案，让人格段里的「你」有具体所指。
   *
   * 为什么替换放在装配后而不是逐卡替换：预算按**装配后的真实长度**算才对。若先替换
   * 再装配，用户档案越长、装配文本越短，超预算时被丢掉的卡片会随用户资料的填写
   * 情况而变化——同一份人设因为「用户改了自己的档案」而少注入一张卡，无法解释。
   */
  async injectionContent(): Promise<string> {
    const cards = await this.cards()
    const user = await this.readUser()
    // 用户段先算出来，它要占的预算从人格预算里**预留**掉：否则一段 800 字的用户
    // 档案会把人格段挤出 2000 字预算（人格才是这个通道的主体，不能被补充说明挤没）。
    const userSection = buildUserSection(user)
    const personaBudget = Math.max(
      SOUL_MIN_PERSONA_BUDGET,
      SOUL_INJECT_BUDGET - (userSection === '' ? 0 : userSection.length + 2),
    )
    const persona = applyUserVars(assembleInjection(cards, personaBudget), user).trim()
    const sections = [persona, userSection].filter(section => section !== '')
    return sections.join('\n\n')
  }
}
