/**
 * dsh-chat-plus — Soul HTTP 路由：前缀 /api/dsh-memory/soul。
 *
 * 为什么挂在 /api/dsh-memory 之下而不是新开 /api/dsh-soul：面板、开关、
 * 记忆条目本来就在同一个 webServer 前缀族里，Soul 是记忆的第四层而不是新工作台；
 * 复用前缀让「loopback fence / 前缀不撞车 / 前端 api base」三件事都零成本继承，
 * 用户升级也不需要多配一条代理规则。
 *
 * 端点与契约（client 半身按此对接，改名等于破坏兼容）：
 *   GET  /soul          → { soul, profiles, builtin: true }
 *   POST /soul          → { content?, identity?, profileId?, name?, activate?, remove? } → { ok, soul, profiles }
 *   GET  /soul/state    → { enabled, builtin: true }
 *   POST /soul/state    → { enabled } → { ok, enabled, builtin: true }
 *   POST /soul/distill  → { provider?, model?, projectHash? } → { ok:true, draft, stats } | { ok:false, failed }
 *   POST /soul/apply    → { draft } → { ok, soul }
 *
 * schema v2（卡片化）新增：
 *   GET  /soul/cards           → { cards }
 *   POST /soul/cards           → { upsert?, remove?, reorder? } → { ok, cards, soul }
 *   GET  /soul/presets         → { presets }
 *   POST /soul/presets         → { name, desc?, cards } → { ok, preset }
 *   POST /soul/presets/apply   → { presetId, mode } → { ok, cards, soul }
 *   POST /soul/presets/delete  → { presetId } → { ok, presets }
 *
 * 角色卡形态（2026-10-07）新增：
 *   POST /soul/avatar   → { profileId?, dataUrl } → { ok, avatar }   （上传/替换）
 *   POST /soul/avatar/remove → { profileId? } → { ok, avatar: null } （删除）
 *   GET  /soul/avatar?profileId=…  → 图片字节（Content-Type 取自白名单）
 *   GET  /soul/user     → { user, avatar }         （我的资料：名字 + 个人档案）
 *   POST /soul/user     → { name?, profile? } → { ok, user, avatar }
 *
 * 用户头像复用同一组 avatar 端点，用 `profileId=user` 表达（AVATAR_USER_ID）：
 * 头像是同一种东西、同一套白名单、同一份索引，为「用户的那张」再开一组端点只会
 * 让白名单与路径校验出现第二份实现。这个 id 走的是档案 id 白名单，不可能与真实
 * 档案撞车（用户不可能建出 id 恰好为 'user' 的档案吗？能——所以 store 的
 * avatarIdFor 对 'user' 有专门的保留语义：档案 id 为 'user' 会与用户头像撞名，
 * 故 isValidProfileId 之外另有一条保留检查，见 router 的 profileId 校验）。
 *
 * 头像为什么走独立的三个端点而不是塞进 POST /soul：
 *   1. 图片是**二进制**，塞进 JSON 会让每次读灵魂都背着几 MB 的 base64；
 *   2. 头像是展示件，与「人设内容」是两条独立写路径——把头像上传绑进保存，
 *      用户换张图就会顺带 bump 灵魂版本号、重算 soul.md 与卡片，纯属误伤。
 *   读路径用 profileId 查询参数（省略 = 主档）而不是拼进路径：档案 id 与主档
 *   占位串共用一套白名单，查询参数比 `/soul/avatar/<id>` 少一层路径拼接。
 *
 * 卡片端点的错误口径（与旧端点一致，但有几处刻意不同）：
 *   - upsert 里的**单张**坏卡不整体 400：面板一次提交多张，其中一张标题为空
 *     不该让整次保存失败（由 store 的 normalizeCard 逐张丢弃）。
 *   - 三个字段全缺才 400（「nothing to write」），因为空写会白白 bump 版本号。
 *   - 内置预设删除 → 400（只读）；自定义预设不存在 → 404（真的没这条）。
 *
 * POST /soul 的分支优先级（写死在下面 handle 里的 if 顺序，改顺序等于改语义）：
 *   remove=true > activate（存在，含空串/null）> profileId=null 且无内容 > 写档案 > 写默认层。
 *   activate 判定必须排在内容写入之前：面板点「切换」时手里可能还攥着未保存的
 *   编辑内容，先写后切会让一次切换顺带把正文灌进目标档案。
 *
 * 安全边界与 api.ts 同款：peer socket 地址 + Host 头双重 loopback 判定；
 * 档案 id 走白名单正则后才允许拼进文件名（否则就是一条任意文件写）。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { MemoryConfig, MemoryEntry } from '../memory/types.js'
import type { MemoryStore } from '../memory/engine/store.js'
import { cardsFromDraft } from './cards.js'
import { distillSoul } from './distill.js'
import { isBuiltinPresetId } from './presets.js'
import { selectDistillEntries } from './prompt.js'
import { isValidProfileId, SoulStore } from './store.js'
import {
  avatarExtOf,
  avatarMimeOf,
  AVATAR_BASE_ID,
  AVATAR_MAX_BYTES,
  AVATAR_USER_ID,
  isValidAvatarName,
  isReservedProfileId,
  normalizeCards,
  normalizeIdentity,
  normalizeUser,
  PROFILE_DESC_MAX,
  PROFILE_TAG_MAX,
  type SoulDraft,
} from './types.js'

/** Soul 路由前缀（挂在记忆前缀之下，见文件头说明）。 */
export const SOUL_ROUTE_PREFIX = '/api/dsh-memory/soul'

/** Soul 路由依赖。 */
export interface SoulRouterDeps {
  readonly ctx: Context
  /** 记忆条目来源（蒸馏输入）。 */
  readonly memory: MemoryStore
  /** 记忆配置（目前用于蒸馏的 importance 口径扩展，保留给后续开关）。 */
  readonly config: MemoryConfig
  /** 灵魂存储（注入侧与路由侧共用同一实例，避免两处各读一份状态）。 */
  readonly soul: SoulStore
}

/** 挂载 Soul 路由，返回 disposer。 */
export function mountSoulRoutes(deps: SoulRouterDeps): () => void {
  return deps.ctx.webServer.register({
    kind: 'prefix',
    path: SOUL_ROUTE_PREFIX,
    handler: (req, res) => {
      void handle(deps, req, res)
    },
  })
}

async function handle(deps: SoulRouterDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { error: 'loopback-only' })
    return
  }
  let rest: string
  let method: string
  let search: URLSearchParams
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    rest = url.pathname.slice(SOUL_ROUTE_PREFIX.length)
    search = url.searchParams
    method = req.method ?? 'GET'
  } catch {
    json(res, 400, { error: 'invalid request url' })
    return
  }
  try {
    // ── 灵魂本体 ──────────────────────────────────────────────────────
    if (method === 'GET' && (rest === '' || rest === '/')) {
      json(res, 200, { soul: await deps.soul.view(), profiles: await deps.soul.profileViews(), builtin: true })
      return
    }
    if (method === 'POST' && (rest === '' || rest === '/')) {
      const body = await readBody(req) as Record<string, unknown>
      // ── 删除档案（client 契约外扩展，见文件头）───────────────────────
      // 幂等：删不存在的档案照样 ok:true。面板的删除按钮没有「先查再删」的
      // 往返，两个标签页同时删同一份是正常操作，不该让其中一个看到报错。
      if (body.remove === true) {
        const target = typeof body.profileId === 'string' ? body.profileId : ''
        if (target === '') {
          json(res, 400, { ok: false, error: 'remove 需要 profileId' })
          return
        }
        if (!isValidProfileId(target)) {
          json(res, 400, { ok: false, error: `档案 id 非法：${target}` })
          return
        }
        // 删除会改 active.json（被删的是激活档案时清空），故删除与随后的读视图
        // 之间不再插入任何写操作。
        await deps.soul.removeProfile(target)
        json(res, 200, { ok: true, soul: await deps.soul.view(), profiles: await deps.soul.profileViews() })
        return
      }
      // activate 优先：它是一次「切换」，不该顺带把 content 写进新档案
      // （面板点「切换」时手里可能还攥着未保存的编辑内容）。
      if (typeof body.activate === 'string' || body.activate === null) {
        // 空串等价于 null（回主档 soul.md）：client 的 activateProfile(null)
        // 序列化出来就是 { activate: '' }，若把空串当非法 id 抛错，
        // 面板「切回主档」按钮会直接 500。
        const raw = typeof body.activate === 'string' ? body.activate.trim() : null
        const target = raw === null || raw === '' ? null : raw
        const soul = await deps.soul.activate(target)
        json(res, 200, { ok: true, soul, profiles: await deps.soul.profileViews() })
        return
      }
      // 显式切回默认层（profileId: null 且没有任何内容/展示件写入）。
      // desc/tag 必须一并排除：面板改主档卡片说明时会带 profileId: null，
      // 让这条分支命中就会把「改一句定位」变成「切回主档」。
      if (
        body.profileId === null && body.content === undefined && body.identity === undefined
        && body.desc === undefined && body.tag === undefined
      ) {
        const soul = await deps.soul.activate(null)
        json(res, 200, { ok: true, soul, profiles: await deps.soul.profileViews() })
        return
      }
      const content = typeof body.content === 'string' ? body.content : undefined
      const identity = body.identity === undefined ? undefined : normalizeIdentity(body.identity)
      const profileId = typeof body.profileId === 'string' ? body.profileId : null
      const source = body.source === 'distill' ? 'distill' as const : 'manual' as const
      // 档案显示名（client 契约外扩展）：新建时作为 ProfileView.name 落盘，
      // 已有档案改名也走这里；缺省时 store 回退用 id 当名字。
      const name = typeof body.name === 'string' && body.name.trim() !== ''
        ? body.name.trim().slice(0, 64)
        : undefined
      // 角色卡的两行展示件（2026-10-07）：与 name 同一条「显式给了才覆盖」的规则，
      // 缺省时 store 沿用档案里已有的值——否则面板保存一次正文就把用户写好的
      // 「均衡的助手 / MOOD」抹成空串。
      const cardMeta = {
        ...(typeof body.desc === 'string' ? { desc: body.desc.slice(0, PROFILE_DESC_MAX) } : {}),
        ...(typeof body.tag === 'string' ? { tag: body.tag.slice(0, PROFILE_TAG_MAX) } : {}),
      }
      // 只改展示件（面板上改一句定位 / 一个小标签）：走独立路径，不重算卡片、
      // 不改正文、不 bump 版本号。放在 content/identity 的 400 判定**之前**——
      // 这条请求本来就不带内容，按「nothing to save」拒掉会让标签永远存不下来。
      const metaOnly = Object.keys(cardMeta).length > 0
      if (content === undefined && identity === undefined) {
        if (metaOnly && profileId === null) {
          json(res, 200, { ok: true, soul: await deps.soul.setBaseCardMeta(cardMeta), profiles: await deps.soul.profileViews() })
          return
        }
        if (!metaOnly) {
          json(res, 400, { ok: false, error: 'nothing to save（content 与 identity 至少给一个）' })
          return
        }
      }
      if (profileId !== null) {
        if (!isValidProfileId(profileId)) {
          json(res, 400, { ok: false, error: `档案 id 非法（仅允许小写字母/数字/短横/下划线）：${profileId}` })
          return
        }
        // 保留字只拦**新建**：`base` / `user` 是主档与用户头像在索引里的占位 key，
        // 建一份同名档案会让「换用户头像」顺手换掉那份人格的脸（见 types 注释）。
        // 已存在的同名档案（手工造的）照常可写，不因为一条新建闸门而变成只读。
        if (isReservedProfileId(profileId) && await deps.soul.readProfile(profileId) === null) {
          json(res, 400, { ok: false, error: `档案 id「${profileId}」是保留字，请换一个名字` })
          return
        }
        const existing = await deps.soul.readProfile(profileId)
        const nextContent = content ?? existing?.content ?? ''
        const nextIdentity = identity ?? existing?.identity ?? normalizeIdentity(null)
        await deps.soul.writeProfile(profileId, nextContent, nextIdentity, source, name, undefined, cardMeta)
        // 保存档案不自动激活（见 store.writeProfile 注释）。
        json(res, 200, { ok: true, soul: await deps.soul.view(), profiles: await deps.soul.profileViews() })
        return
      }
      // 默认层写入：缺字段的用现值补齐，避免「只改正文」把身份字段清空。
      const current = await deps.soul.view()
      const soul = await deps.soul.writeBase(
        content ?? current.content,
        identity ?? current.identity,
        source,
        cardMeta,
      )
      json(res, 200, { ok: true, soul, profiles: await deps.soul.profileViews() })
      return
    }

    // ── 我的资料（用户侧身份，与人格完全解耦） ────────────────────────
    // 为什么单独一对端点而不是塞进 POST /soul：改自己的名字不该 bump 人格版本号、
    // 不该重算 soul.md 与卡片——那是「两个人」的资料，混在一起写必然互相误伤。
    if (method === 'GET' && rest === '/user') {
      json(res, 200, { user: await deps.soul.readUser(), avatar: await deps.soul.userAvatarName() })
      return
    }
    if (method === 'POST' && rest === '/user') {
      const body = await readBody(req) as Record<string, unknown>
      // 缺字段按现值补齐会在「清空名字」时失效（面板提交的就是空串，语义是清掉），
      // 所以这里整份覆盖：面板一次提交 name + profile 两个字段，没有部分提交的场景。
      const user = await deps.soul.writeUser(normalizeUser(body))
      json(res, 200, { ok: true, user, avatar: await deps.soul.userAvatarName() })
      return
    }

    // ── 档案头像（展示件，与灵魂写入完全解耦） ────────────────────────
    if (method === 'GET' && rest === '/avatar') {
      const target = avatarTargetOf(search.get('profileId'))
      if (target === null) {
        json(res, 400, { ok: false, error: 'profileId 非法' })
        return
      }
      const name = await deps.soul.avatarNameFor(target)
      if (name === null) {
        json(res, 404, { ok: false, error: 'no avatar' })
        return
      }
      // 名字再过一次白名单才允许拼路径：它可能来自被手工改坏的 avatars.json，
      // 而这里要把值当文件名用（store 的读路径已过滤，这是第二道闸）。
      if (!isValidAvatarName(name)) {
        json(res, 404, { ok: false, error: 'no avatar' })
        return
      }
      try {
        const bytes = await readFile(deps.soul.avatarFile(name))
        // no-store：换头像后浏览器必须立刻看到新图，缓存住的旧脸会让人以为没生效。
        res.writeHead(200, { 'content-type': avatarMimeOf(name), 'cache-control': 'no-store' })
        res.end(bytes)
      } catch {
        json(res, 404, { ok: false, error: 'no avatar' })
      }
      return
    }
    if (method === 'POST' && rest === '/avatar') {
      // 头像走 base64，体积是原始字节的 4/3；上限按 2MB 原始字节折算再留一点余量，
      // 否则用户传一张刚好合法的 2MB 图会被读体阶段当成超大请求拒掉。
      const body = await readBody(req, Math.ceil(AVATAR_MAX_BYTES * 4 / 3) + 64 * 1024) as Record<string, unknown>
      const target = avatarTargetOf(typeof body.profileId === 'string' ? body.profileId : null)
      if (target === null) {
        json(res, 400, { ok: false, error: 'profileId 非法' })
        return
      }
      if (typeof body.dataUrl !== 'string' || body.dataUrl === '') {
        json(res, 400, { ok: false, error: 'dataUrl 缺失' })
        return
      }
      const decoded = decodeDataUrl(body.dataUrl)
      if (decoded === null) {
        json(res, 400, { ok: false, error: '仅支持 png / jpeg / webp / gif 的 data URL' })
        return
      }
      if (decoded.bytes.length > AVATAR_MAX_BYTES) {
        json(res, 400, { ok: false, error: `头像过大（上限 ${String(Math.round(AVATAR_MAX_BYTES / 1024 / 1024))}MB）` })
        return
      }
      const avatar = await deps.soul.writeAvatar(target, decoded.ext, decoded.bytes)
      json(res, 200, { ok: true, avatar })
      return
    }
    if (method === 'POST' && rest === '/avatar/remove') {
      const body = await readBody(req) as Record<string, unknown>
      const target = avatarTargetOf(typeof body.profileId === 'string' ? body.profileId : null)
      if (target === null) {
        json(res, 400, { ok: false, error: 'profileId 非法' })
        return
      }
      await deps.soul.removeAvatar(target)
      json(res, 200, { ok: true, avatar: null })
      return
    }

    // ── 注入开关（全局单值，与 zh / diagram 通道同范式） ───────────────
    if (method === 'GET' && rest === '/state') {
      json(res, 200, { enabled: await deps.memory.isSoulInjectEnabled(deps.config.soulInjectDefaultEnabled !== false), builtin: true })
      return
    }
    if (method === 'POST' && rest === '/state') {
      const body = await readBody(req) as Record<string, unknown>
      const enabled = body.enabled !== false
      await deps.memory.setSoulInjectEnabled(enabled)
      json(res, 200, { ok: true, enabled, builtin: true })
      return
    }

    // ── 卡片集合（schema v2 权威层） ──────────────────────────────────
    // 一次请求同时吃 upsert / remove / reorder：面板拖拽排序后顺手改开关会并发
    // 发几个请求，分端点写会互相覆盖 order（详见 store.mutateCards 注释）。
    if (method === 'GET' && rest === '/cards') {
      json(res, 200, { cards: await deps.soul.cards() })
      return
    }
    if (method === 'POST' && rest === '/cards') {
      const body = await readBody(req) as Record<string, unknown>
      const upsertRaw = Array.isArray(body.upsert) ? body.upsert : []
      const removeRaw = Array.isArray(body.remove) ? body.remove.filter((id): id is string => typeof id === 'string') : []
      const reorderRaw = Array.isArray(body.reorder) ? body.reorder.filter((id): id is string => typeof id === 'string') : []
      if (upsertRaw.length === 0 && removeRaw.length === 0 && reorderRaw.length === 0) {
        json(res, 400, { ok: false, error: 'nothing to write（upsert / remove / reorder 至少给一个）' })
        return
      }
      // upsert 里的原始对象**原样**交给 store 归一化：只有 store 才知道该卡的
      // 现有 order（缺 order 时沿用旧值、新卡排到最后）。在这里先归一化会把
      // 「缺 order」变成「显式 order=0」，顺序从此不可控（详见 store.mutateCards）。
      const cards = await deps.soul.mutateCards({ upsert: upsertRaw, remove: removeRaw, reorder: reorderRaw })
      // 回包带上 soul：卡片写入会重算 soul.md 与 identity.json，面板需要新视图
      // 才能把「全文视图」与「身份四件套」同步刷新，省掉一次 GET /soul。
      json(res, 200, { ok: true, cards, soul: await deps.soul.view() })
      return
    }

    // ── 预设库 ────────────────────────────────────────────────────────
    if (method === 'GET' && rest === '/presets') {
      json(res, 200, { presets: await deps.soul.listPresets() })
      return
    }
    if (method === 'POST' && rest === '/presets') {
      const body = await readBody(req) as Record<string, unknown>
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '') {
        json(res, 400, { ok: false, error: '预设名不能为空' })
        return
      }
      // 预设内的卡片顺序由数组下标决定（normalizeCards 的 fallbackOrder），
      // 所以这里用 normalizeCards 而不是逐张 normalizeCard——后者会把所有卡
      // 的 order 都钉成 0。
      const cards = normalizeCards(body.cards)
      if (cards.length === 0) {
        json(res, 400, { ok: false, error: '预设至少要有一张非空卡片' })
        return
      }
      const preset = await deps.soul.createPreset({
        name,
        desc: typeof body.desc === 'string' ? body.desc : '',
        cards,
      })
      json(res, 200, { ok: true, preset })
      return
    }
    if (method === 'POST' && rest === '/presets/apply') {
      const body = await readBody(req) as Record<string, unknown>
      const presetId = typeof body.presetId === 'string' ? body.presetId.trim() : ''
      if (presetId === '') {
        json(res, 400, { ok: false, error: 'presetId 缺失' })
        return
      }
      // mode 缺省按 merge：它是幂等且不破坏用户已有卡片的那个方向，
      // 参数写错时宁可少破坏一点。
      const mode = body.mode === 'replace' ? 'replace' as const : 'merge' as const
      const cards = await deps.soul.applyPreset(presetId, mode)
      json(res, 200, { ok: true, cards, soul: await deps.soul.view() })
      return
    }
    if (method === 'POST' && rest === '/presets/delete') {
      const body = await readBody(req) as Record<string, unknown>
      const presetId = typeof body.presetId === 'string' ? body.presetId.trim() : ''
      if (presetId === '') {
        json(res, 400, { ok: false, error: 'presetId 缺失' })
        return
      }
      // 内置预设只读：磁盘上根本没有它，前端隐藏删除按钮只是 UX，后端必须真的拒绝。
      if (isBuiltinPresetId(presetId)) {
        json(res, 400, { ok: false, error: '内置预设只读，不能删除' })
        return
      }
      const removed = await deps.soul.removePreset(presetId)
      if (!removed) {
        json(res, 404, { ok: false, error: `预设不存在：${presetId}` })
        return
      }
      json(res, 200, { ok: true, presets: await deps.soul.listPresets() })
      return
    }

    // ── 蒸馏（只出草案，不落盘） ──────────────────────────────────────
    if (method === 'POST' && rest === '/distill') {
      const body = await readBody(req) as Record<string, unknown>
      const entries: MemoryEntry[] = await deps.memory.readEntries()
      const projectHash = typeof body.projectHash === 'string' && body.projectHash !== '' ? body.projectHash : null
      const selected = selectDistillEntries(entries, { projectHash })
      const outcome = await distillSoul(deps.ctx, selected, {
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
      }, entries.length)
      // 草案的卡片形态在这里补上（而不是塞进 distill.ts）：拆卡是「给面板看」
      // 的展示层工作，蒸馏引擎只管把 LLM 输出解析成 draft。面板拿它做逐卡对比，
      // /soul/apply 也用它同步 cards.json。
      json(res, 200, outcome.ok ? { ...outcome, draft: { ...outcome.draft, cards: cardsFromDraft(outcome.draft) } } : outcome)
      return
    }

    // ── 应用草案（唯一落盘入口） ──────────────────────────────────────
    if (method === 'POST' && rest === '/apply') {
      const body = await readBody(req) as Record<string, unknown>
      const raw = body.draft
      if (raw === null || typeof raw !== 'object') {
        json(res, 400, { ok: false, error: 'draft 缺失或格式错误' })
        return
      }
      const record = raw as Record<string, unknown>
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      if (content === '') {
        json(res, 400, { ok: false, error: 'draft.content 不能为空（空灵魂请直接删除 soul.md）' })
        return
      }
      // 面板可能带着用户编辑过的卡片一起提交；坏卡逐张丢弃，不因一张卡 400。
      // 同样用 normalizeCards（按数组下标定 order），不用逐张 normalizeCard。
      const draftCards = normalizeCards(record.cards)
      const draft: SoulDraft = {
        content,
        identity: normalizeIdentity(record.identity),
        ...(typeof record.notes === 'string' ? { notes: record.notes } : {}),
        ...(draftCards.length > 0 ? { cards: draftCards } : {}),
      }
      // applyDraft 内部会同步 cards.json（否则面板与注入会指向两份人格）。
      const soul = await deps.soul.applyDraft(draft)
      json(res, 200, { ok: true, soul })
      return
    }

    json(res, 404, { ok: false, error: 'unknown soul endpoint' })
  } catch (error) {
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

/** 新建档案 id 的派生（面板/工具建档案时复用同一套规则）。 */
export { profileIdFrom } from './store.js'

// ── HTTP plumbing（与 memory/api.ts 同款，避免跨模块耦合内部函数） ──────

/**
 * 解析头像的目标主体 id。
 *
 * 返回 null 表示「非法，别当文件名用」；返回字符串表示合法目标。三种取值：
 *   - 省略 / 空串 → 主档（AVATAR_BASE_ID）。刻意把「省略」与「空串」都当主档：
 *     面板切回主档时手里可能就是一个空 profileId，让它 400 会把一次正常的
 *     「给主档换头像」变成报错；
 *   - `user` → 用户头像（AVATAR_USER_ID）。与档案 id 空间重叠见下；
 *   - 其它合法档案 id → 该档案的头像。
 *
 * ⚠️ `user` 在这里是**用户头像**，而档案 id 白名单也允许 `user`。两者不会互相
 * 误伤：router 建档案时用 isReservedProfileId 拒掉 `base` / `user` 这两个 id
 * （见 POST /soul 的档案分支），所以索引里 key 为 `user` 的永远只可能是用户头像。
 */
function avatarTargetOf(raw: string | null): string | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return AVATAR_BASE_ID
  if (value === AVATAR_USER_ID) return AVATAR_USER_ID
  return isValidProfileId(value) ? value : null
}

/**
 * 解析 `data:image/png;base64,…` 形式的上传载荷。
 *
 * 只认 base64（不认 percent-encoding 的 `data:…,<raw>`）：面板用 FileReader 的
 * readAsDataURL 产出的一定是 base64，多支持一种编码就多一条要测的路径。
 * MIME 必须过白名单——它决定落盘扩展名与回给浏览器的 Content-Type，
 * 放行 image/svg+xml 等于让上传的 SVG 在同源下执行脚本。
 */
function decodeDataUrl(value: string): { ext: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value.trim())
  if (match === null) return null
  const ext = avatarExtOf(match[1]!)
  if (ext === null) return null
  try {
    const bytes = Buffer.from(match[2]!, 'base64')
    // 空 buffer 说明 base64 段是垃圾（Buffer.from 对坏输入不抛，只回空/截断）：
    // 落一张 0 字节的图比回 400 更糟——面板会显示永久破图。
    if (bytes.length === 0) return null
    return { ext, bytes }
  } catch {
    return null
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return null
  return firstColon === -1 ? host : host.slice(0, firstColon)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = hostNameOf(req.headers.host)
  if (host === null) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}
