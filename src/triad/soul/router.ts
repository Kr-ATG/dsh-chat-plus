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
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { MemoryConfig, MemoryEntry } from '../memory/types.js'
import type { MemoryStore } from '../memory/engine/store.js'
import { cardsFromDraft } from './cards.js'
import { distillSoul } from './distill.js'
import { isBuiltinPresetId } from './presets.js'
import { selectDistillEntries } from './prompt.js'
import { isValidProfileId, SoulStore } from './store.js'
import { normalizeCards, normalizeIdentity, type SoulDraft } from './types.js'

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
  try {
    rest = new URL(req.url ?? '/', 'http://localhost').pathname.slice(SOUL_ROUTE_PREFIX.length)
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
      // 显式切回默认层（profileId: null 且没有内容写入）。
      if (body.profileId === null && body.content === undefined && body.identity === undefined) {
        const soul = await deps.soul.activate(null)
        json(res, 200, { ok: true, soul, profiles: await deps.soul.profileViews() })
        return
      }
      const content = typeof body.content === 'string' ? body.content : undefined
      const identity = body.identity === undefined ? undefined : normalizeIdentity(body.identity)
      if (content === undefined && identity === undefined) {
        json(res, 400, { ok: false, error: 'nothing to save（content 与 identity 至少给一个）' })
        return
      }
      const profileId = typeof body.profileId === 'string' ? body.profileId : null
      const source = body.source === 'distill' ? 'distill' as const : 'manual' as const
      // 档案显示名（client 契约外扩展）：新建时作为 ProfileView.name 落盘，
      // 已有档案改名也走这里；缺省时 store 回退用 id 当名字。
      const name = typeof body.name === 'string' && body.name.trim() !== ''
        ? body.name.trim().slice(0, 64)
        : undefined
      if (profileId !== null) {
        if (!isValidProfileId(profileId)) {
          json(res, 400, { ok: false, error: `档案 id 非法（仅允许小写字母/数字/短横/下划线）：${profileId}` })
          return
        }
        const existing = await deps.soul.readProfile(profileId)
        const nextContent = content ?? existing?.content ?? ''
        const nextIdentity = identity ?? existing?.identity ?? normalizeIdentity(null)
        await deps.soul.writeProfile(profileId, nextContent, nextIdentity, source, name)
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
      )
      json(res, 200, { ok: true, soul, profiles: await deps.soul.profileViews() })
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

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024 * 1024) {
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
