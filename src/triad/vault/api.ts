/**
 * dsh-vault HTTP API（loopback-only）：/api/dsh-vault/*。
 *
 * ── 这一层是唯一的「明文出站口」────────────────────────────────────
 * store 的列表/单条读取都只给掩码（VAULT_MASK），真正的明文只有两个出口：
 *   1. POST /reveal —— 单字段、按次、写审计，供用户在页面上点「显示」；
 *   2. GET /export  —— 导出的是**密文**，不是明文。
 * 除此之外任何响应里都不该出现敏感值。这条纪律的意义是：把「整库明文
 * 一次性塞进浏览器内存」这件事从默认行为里删掉。
 *
 * ── 为什么路由自己写 loopback + 跨站两道闸门 ────────────────────────
 * DSH 的 webServer 是 longest-prefix-wins 派发，插件前缀比官方 /api 长，
 * 官方 handler 里的来源校验根本不执行（见 shared/csrf.ts 的详细说明）。
 * 而档案路由能读**用户真实密码**，是全插件里最需要闸门的一条。
 *
 * ── 写操作的三条硬约束 ──────────────────────────────────────────────
 *  1. /field 收到掩码＝用户没动这一行 → 原值保留（store.patchField 内部处理）；
 *  2. /record 整体替换时同样还原掩码（store.upsertRecord 内部处理），
 *     否则一次保存就把密码写成六个星号；
 *  3. /delete 与 /archive 必须回成功与否，前端据此后刷新列表（静默失败
 *     会让用户以为删掉了，其实还在）。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { rejectCrossSite } from '../../shared/csrf.ts'
import { MIN_BACKUP_PASSWORD, createBackupPackage, keyFingerprint, readBackupPackage } from './backup.js'
import { detectMediaType } from './blobs.js'
import { VaultCipher } from './crypto.js'
import { generatePassword } from './passgen.js'
import { listVaultReminders } from './reminders.js'
import type { VaultStore } from './store.js'
import { generateTotp, parseTotpSecret } from './totp.js'
import {
  DEFAULT_VAULT_CONFIG,
  applyVaultConfigOverrides,
  isFieldSensitive,
  publicVaultConfig,
  type VaultConfig,
  type VaultField,
  type VaultImageVariant,
  type VaultRecord,
  type VaultScene,
} from './types.js'

/** Minimal webServer service view（与记忆库 / skill-toggles 同款契约）。 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void
      }): () => void
    }
  }
}

/** 路由前缀。 */
const ROUTE_PREFIX = '/api/dsh-vault'

/**
 * 请求体上限。
 *
 * 定 48MB 的理由：照片上传走 base64 JSON（体积 ×1.34），而最坏情况是
 * keepOriginal 打开时的一张 20MB 原图 + 展示图 + 缩略图，base64 后约 28MB。
 * 再留一档余量。超过这个量的请求一律拒——不拒会让一个手滑的请求把宿主
 * 进程的内存吃穿。
 */
const MAX_BODY_BYTES = 48 * 1024 * 1024

/** blob sha256 的合法形状（**只允许内容寻址名**，杜绝路径穿越）。 */
const SHA_PATTERN = /^[a-f0-9]{64}$/

/* ───────────────────────── 挂载 ───────────────────────── */

/** 挂载全部路由（返回 disposer，交给 ctx.effect）。 */
export function mountVaultRoutes(
  ctx: Context,
  store: VaultStore,
  config: VaultConfig,
): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      void handle(ctx, store, config, req, res)
    },
  })
}

/* ───────────────────────── 分派 ───────────────────────── */

async function handle(
  ctx: Context,
  store: VaultStore,
  config: VaultConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // ① loopback：只接受本机来源（远程访问靠 DSH 自己的鉴权，插件路由不吃那份）。
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: '仅允许本机访问' })
    return
  }
  // ② 跨站：浏览器跨站请求 IP 与 Host 都满足 loopback，必须另判来源。
  if (rejectCrossSite(req.headers as Record<string, unknown>, (status, payload) => {
    json(res, status, payload)
  })) return
  let url: URL
  let rest: string
  let method: string
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
    rest = url.pathname.slice(ROUTE_PREFIX.length)
    method = req.method ?? 'GET'
  } catch {
    json(res, 400, { ok: false, error: '请求地址无法解析' })
    return
  }
  try {
    // ── 读取面 ────────────────────────────────────────────────────────
    if (method === 'GET' && rest === '/list') {
      json(res, 200, {
        ok: true,
        records: await store.listRecords({ includeArchived: url.searchParams.get('archived') === '1' }),
        scenes: await store.listScenes(),
        stats: await store.stats(),
        config: publicVaultConfig(config),
        // 只读模式（数据结构版本比插件新）必须让页面知道：此时所有写操作都会失败，
        // 页面据此整页只读，而不是让用户点十次删不掉。
        readOnly: store.readOnly,
        warning: store.loadWarning,
      })
      return
    }
    if (method === 'GET' && rest === '/stats') {
      json(res, 200, { ok: true, stats: await store.stats() })
      return
    }
    if (method === 'GET' && rest === '/search') {
      const keyword = (url.searchParams.get('q') ?? '').trim()
      const records = await store.listRecords()
      json(res, 200, { ok: true, records: keyword === '' ? records : filterRecords(records, keyword) })
      return
    }
    if (method === 'GET' && rest === '/audit') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50')
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.round(limitRaw))) : 50
      json(res, 200, { ok: true, entries: await store.readAudit(limit) })
      return
    }
    if (method === 'GET' && rest === '/image') {
      await serveImage(store, url, res)
      return
    }
    if (method === 'GET' && rest === '/file') {
      await serveFile(store, url, res)
      return
    }
    if (method === 'GET' && rest === '/export') {
      await serveExport(store, res)
      return
    }
    // ── 到期提醒（只看日期字段）──────────────────────────────────────
    //
    // 这里刻意用**掩码版** listRecords 而不是 listRecordsRevealed：日期字段
    // （证件有效期、银行卡到期）不是敏感字段，提醒清单根本不需要解密任何东西。
    // 原来那条 /health 审计必须拿全库明文（弱口令要按字符串比），是这个模块
    // 里唯一一处「整库明文进入路由」的地方；审计删掉之后，它也随之消失。
    if (method === 'GET' && rest === '/reminders') {
      const records = await store.listRecords({ includeArchived: false })
      json(res, 200, { ok: true, report: listVaultReminders(records) })
      return
    }
    // ── 密钥指纹（备份页要显示「这是哪一把密钥」）────────────────────
    if (method === 'GET' && rest === '/key-info') {
      const bytes = store.exportKeyBytes()
      json(res, 200, {
        ok: true,
        info: bytes === null
          ? { exists: false, fingerprint: '' }
          : { exists: true, fingerprint: keyFingerprint(bytes) },
      })
      return
    }

    // ── 配置 ──────────────────────────────────────────────────────────
    if (method === 'GET' && rest === '/config') {
      json(res, 200, { ok: true, config: publicVaultConfig(config) })
      return
    }
    if (method === 'POST' && rest === '/config') {
      const body = await readBody(req)
      if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
      const patch = body as Record<string, unknown>
      const applied = patch.reset === true
        ? applyVaultConfigOverrides(config, defaultConfigOf())
        : applyVaultConfigOverrides(config, patch)
      // 合并写：只写本次补丁会冲掉之前改过的字段（与记忆库同款教训）。
      const persisted = await store.readConfigOverride()
      await store.writeConfigOverride({ ...persisted, ...applied })
      json(res, 200, { ok: true, config: publicVaultConfig(config) })
      return
    }

    // ── 写操作 ────────────────────────────────────────────────────────
    if (method === 'POST' && rest === '/record') {
      await handleRecord(store, req, res)
      return
    }
    if (method === 'POST' && rest === '/field') {
      await handleField(store, req, res)
      return
    }
    if (method === 'POST' && rest === '/delete') {
      const body = await readBody(req)
      if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
      const id = requireString(body, 'id')
      const gone = await store.removeRecord(id)
      json(res, gone ? 200 : 404, gone ? { ok: true } : { ok: false, error: '记录不存在' })
      return
    }
    if (method === 'POST' && rest === '/archive') {
      const body = await readBody(req)
      if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
      const id = requireString(body, 'id')
      const record = await store.setArchived(id, body.archived === true)
      json(res, record === undefined ? 404 : 200, record === undefined
        ? { ok: false, error: '记录不存在' }
        : { ok: true, record })
      return
    }
    // 这里原有 POST /confirm（accept=true → 清 pending 标记；accept=false → 驳回
    // ＝直接删记录）。用户 2026-10-27 明确要求档案不需要确认，抽取结果直接生效，
    // 于是「确认/驳回」这个动作整体不存在了，路由连同 store.setPending 一起删。
    // 老库里残留的 pending 标记由 store.migrate 的 v1→v2 清掉——注意别以「反正
    // 页面不用了」为由留着这条路由：留着它就等于留着一个能远程删记录的口子，
    // 而它保护的那个状态已经不存在了。
    if (method === 'POST' && rest === '/reveal') {
      await handleReveal(store, req, res)
      return
    }
    if (method === 'POST' && rest === '/scene') {
      await handleScene(store, req, res)
      return
    }
    if (method === 'POST' && rest === '/photo') {
      await handlePhoto(store, req, res)
      return
    }
    if (method === 'POST' && rest === '/photo-delete') {
      const body = await readBody(req)
      if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
      const id = requireString(body, 'id')
      const photoId = requireString(body, 'photoId')
      const record = await store.removePhoto(id, photoId)
      json(res, record === undefined ? 404 : 200, record === undefined
        ? { ok: false, error: '照片或记录不存在' }
        : { ok: true, record })
      return
    }
    if (method === 'POST' && rest === '/file') {
      await handleFileUpload(store, req, res)
      return
    }
    if (method === 'POST' && rest === '/file-delete') {
      const body = await readBody(req)
      if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
      const id = requireString(body, 'id')
      const fileId = requireString(body, 'fileId')
      const record = await store.removeFile(id, fileId)
      json(res, record === undefined ? 404 : 200, record === undefined
        ? { ok: false, error: '文件或记录不存在' }
        : { ok: true, record })
      return
    }
    if (method === 'POST' && rest === '/maintenance') {
      const swept = await store.blobs.sweepOrphans()
      const evicted = await store.enforceQuota(config.quotaBytes)
      json(res, 200, {
        ok: true,
        swept: swept.removed,
        evicted: evicted.evicted,
        freedBytes: swept.freedBytes + evicted.freedBytes,
        stats: await store.stats(),
      })
      return
    }
    if (method === 'POST' && rest === '/import') {
      await handleImport(store, req, res)
      return
    }
    // ── 带口令的加密备份 / 恢复（换机救命通道）──────────────────────
    if (method === 'POST' && rest === '/backup') {
      await handleBackup(store, req, res)
      return
    }
    if (method === 'POST' && rest === '/restore') {
      await handleRestore(store, req, res)
      return
    }
    // ── TOTP 动态验证码（只在请求内算，不缓存）──────────────────────
    if (method === 'POST' && rest === '/totp') {
      await handleTotp(store, req, res)
      return
    }
    // ── 强口令生成（服务端 crypto.randomInt，绝不用 Math.random）────
    if (method === 'POST' && rest === '/password') {
      const body = await readBody(req)
      if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
      const generated = generatePassword({
        ...(typeof body.length === 'number' ? { length: body.length } : {}),
        symbols: body.symbols !== false,
        ambiguous: body.ambiguous === true,
      })
      // no-store：刚生成的密码绝不能被任何中间层缓存。
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, generated }))
      return
    }
    json(res, 404, { ok: false, error: '未知的档案接口：' + method + ' ' + rest })
  } catch (error) {
    // 任何异常都以 { ok:false, error } 回，绝不把堆栈吐给页面（堆栈里有路径）。
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger?.warn?.(`[dsh-vault] ${method} ${rest} failed: ${message}`)
    json(res, 500, { ok: false, error: message })
  }
}
/* ───────────────────────── 写操作实现 ───────────────────────── */

/** 新建 / 整体替换一条记录。 */
async function handleRecord(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const scene = typeof body.scene === 'string' ? body.scene.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (scene === '' || title === '') {
    json(res, 400, { ok: false, error: '场景与标题都不能为空' })
    return
  }
  const fields = normalizeFields(body.fields)
  if (fields.length === 0) {
    json(res, 400, { ok: false, error: '至少需要一个字段' })
    return
  }
  const record = await store.upsertRecord({
    ...(typeof body.id === 'string' && body.id !== '' ? { id: body.id } : {}),
    scene,
    title,
    ...(typeof body.subtitle === 'string' && body.subtitle.trim() !== '' ? { subtitle: body.subtitle.trim() } : {}),
    // 分类：**显式传空串＝取消分类**，所以这里不能学 subtitle 那样「空就省略」——
    // 省略在 upsert 里的语义是「没提这件事，保留原值」，那样用户就永远删不掉一个
    // 填错的分类。只有 body 里根本没有这个键（老客户端）才省略。
    ...(typeof body.category === 'string' ? { category: body.category } : {}),
    fields,
    ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
    ...(typeof body.note === 'string' ? { note: body.note } : {}),
    // 页面上的保存一律 manual：可信度由 upsertRecord 按 source 给成 1。
    // （原来这里还写着「不挂 pending」——pending 这个概念在 v2 已经整体没了。）
    source: 'manual',
  })
  json(res, 200, { ok: true, record })
}

/** 就地改单个字段。 */
async function handleField(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const id = requireString(body, 'id')
  const key = requireString(body, 'key')
  if (typeof body.value !== 'string') {
    json(res, 400, { ok: false, error: 'value 必须是字符串' })
    return
  }
  const record = await store.patchField({
    id,
    key,
    value: body.value,
    ...(typeof body.label === 'string' && body.label !== '' ? { label: body.label } : {}),
    ...(isFieldType(body.type) ? { type: body.type } : {}),
    ...(typeof body.sensitive === 'boolean' ? { sensitive: body.sensitive } : {}),
    source: 'manual',
  })
  json(res, record === undefined ? 404 : 200, record === undefined
    ? { ok: false, error: '记录不存在' }
    : { ok: true, record })
}

/**
 * 取单个敏感字段的明文。
 *
 * 三条纪律：
 *  1. **只对敏感字段生效**？不——非敏感字段也允许，但页面用不到；不做区分反而
 *     少一个分支少一处漏判。
 *  2. 每次调用写一条审计：明文出站这件事必须留痕，否则「谁在我不知道的时候
 *     看了我的密码」永远查不出来。
 *  3. via 只允许页面传一个短标识（不落 URI、不落 header 原文），避免审计文件
 *     变成一个记录用户行为轨迹的日志。
 */
async function handleReveal(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const id = requireString(body, 'id')
  const key = requireString(body, 'key')
  const record = await store.getRecordRevealed(id)
  if (record === undefined) {
    json(res, 404, { ok: false, error: '记录不存在' })
    return
  }
  const field = record.fields.find((item) => item.key === key)
  if (field === undefined) {
    json(res, 404, { ok: false, error: '字段不存在' })
    return
  }
  await store.appendAudit({
    recordId: id,
    fieldKey: key,
    via: typeof body.via === 'string' && body.via !== '' ? body.via.slice(0, 32) : 'panel',
  })
  // no-store：明文响应绝不能被任何中间层缓存下来。
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify({ ok: true, value: field.value }))
}

/** 场景新建 / 改名 / 删除。 */
async function handleScene(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  if (body.remove === true) {
    const id = requireString(body, 'id')
    const result = await store.removeScene(id)
    json(res, result.ok ? 200 : 400, result.ok
      ? { ok: true, scenes: result.scenes }
      : { ok: false, error: result.error ?? '删除失败' })
    return
  }
  const raw = body.scene
  if (raw === null || typeof raw !== 'object') {
    json(res, 400, { ok: false, error: '缺少 scene 对象' })
    return
  }
  const candidate = raw as Record<string, unknown>
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
  if (label === '') {
    json(res, 400, { ok: false, error: '场景名称不能为空' })
    return
  }
  const existing = await store.listScenes()
  const id = typeof candidate.id === 'string' && candidate.id !== ''
    ? candidate.id
    : newSceneId(label, existing)
  const scene: VaultScene = {
    id,
    label,
    desc: typeof candidate.desc === 'string' ? candidate.desc : '',
    order: typeof candidate.order === 'number' && Number.isFinite(candidate.order) ? candidate.order : 100,
    builtin: false,
    fieldTemplate: Array.isArray(candidate.fieldTemplate)
      ? candidate.fieldTemplate as VaultScene['fieldTemplate']
      : [],
    // 分类建议清单必须一起保留：页面只改了个场景名，不能顺手把下拉候选清空。
    // 老客户端不传这个键 → 回落成空数组（而不是报错），页面照样能自由输入。
    categories: Array.isArray(candidate.categories) ? candidate.categories.filter((item): item is string => typeof item === 'string') : [],
    ...(candidate.photoFirst === true ? { photoFirst: true } : {}),
  }
  const scenes = await store.upsertScene(scene)
  json(res, 200, { ok: true, scenes })
}

/** 上传一张照片（各档字节由浏览器压好后 base64 传上来）。 */
async function handlePhoto(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const id = requireString(body, 'id')
  const role = typeof body.role === 'string' && body.role !== '' ? body.role : 'extra'
  const label = typeof body.label === 'string' && body.label !== '' ? body.label : '照片'
  const rawVariants = Array.isArray(body.variants) ? body.variants : []
  const variants: Array<{ variant: VaultImageVariant; data: Buffer; width: number; height: number }> = []
  for (const item of rawVariants) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const variant = isImageVariant(entry.variant) ? entry.variant : 'display'
    if (typeof entry.data !== 'string' || entry.data === '') continue
    // 只收纯 base64：带 data: 前缀的会让 Buffer.from 解出垃圾字节。
    const base64 = entry.data.includes(',') ? entry.data.slice(entry.data.indexOf(',') + 1) : entry.data
    let bytes: Buffer
    try {
      bytes = Buffer.from(base64, 'base64')
    } catch {
      continue
    }
    if (bytes.length === 0) continue
    variants.push({
      variant,
      data: bytes,
      width: toPositiveInt(entry.width),
      height: toPositiveInt(entry.height),
    })
  }
  if (variants.length === 0) {
    json(res, 400, { ok: false, error: '没有可用的图片数据' })
    return
  }
  const record = await store.attachPhoto({
    recordId: id,
    role,
    label,
    ...(typeof body.fieldKey === 'string' && body.fieldKey !== '' ? { fieldKey: body.fieldKey } : {}),
    variants,
    source: 'manual',
  })
  if (record === null) {
    json(res, 400, { ok: false, error: '图片无效或超过单张上限（20MB）' })
    return
  }
  // 回整条记录 + 新增的那张照片：页面既要用照片做局部更新，也要用记录刷新历史。
  const photo = record.photos[record.photos.length - 1]
  json(res, 200, { ok: true, photo, record })
}

/** 上传一个任意文件附件（配置文件 / 订阅 / 证书等，base64 传字节）。 */
async function handleFileUpload(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const id = requireString(body, 'id')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '') { json(res, 400, { ok: false, error: '文件名不能为空' }); return }
  if (name.length > 255) { json(res, 400, { ok: false, error: '文件名过长（最多 255 字符）' }); return }
  const mimeType = typeof body.mimeType === 'string' && body.mimeType.trim() !== ''
    ? body.mimeType.trim()
    : 'application/octet-stream'
  const raw = typeof body.data === 'string' ? body.data : ''
  if (raw === '') { json(res, 400, { ok: false, error: '没有收到文件数据' }); return }
  // 只收纯 base64：带 data: 前缀的会让 Buffer.from 解出垃圾字节。
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    json(res, 400, { ok: false, error: '文件数据不是合法 base64' })
    return
  }
  if (bytes.length === 0) { json(res, 400, { ok: false, error: '文件内容为空' }); return }
  const record = await store.attachFile({
    recordId: id,
    name,
    mimeType,
    data: bytes,
    ...(typeof body.label === 'string' && body.label.trim() !== '' ? { label: body.label } : {}),
  })
  if (record === null) {
    json(res, 400, { ok: false, error: '文件无效、超过单文件上限（20MB）或已达到单条记录文件数上限' })
    return
  }
  const file = record.files[record.files.length - 1]
  json(res, 200, { ok: true, file, record })
}

/** 导入备份（合并语义：按 id 覆盖、按「场景+标题」去重、其余追加）。 */
async function handleImport(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const data = body.data
  if (data === null || typeof data !== 'object') {
    json(res, 400, { ok: false, error: '导入内容不是对象' })
    return
  }
  const parsed = data as { records?: unknown; scenes?: unknown }
  const incoming = Array.isArray(parsed.records) ? parsed.records : []
  if (incoming.length === 0) {
    json(res, 400, { ok: false, error: '导入内容里没有记录' })
    return
  }
  const current = await store.listRecordsRevealed({ includeArchived: true })
  const byId = new Map(current.map((record) => [record.id, record]))
  let imported = 0
  for (const raw of incoming) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as VaultRecord
    if (typeof record.id !== 'string' || typeof record.title !== 'string') continue
    const fields = normalizeFields(record.fields)
    if (fields.length === 0) continue
    const scene = typeof record.scene === 'string' && record.scene !== '' ? record.scene : 'other'
    // 导入保留原 id（幂等：同一份备份导两次不会翻倍）。
    await store.upsertRecord({
      id: byId.has(record.id) ? record.id : undefined,
      scene,
      title: record.title,
      ...(typeof record.subtitle === 'string' ? { subtitle: record.subtitle } : {}),
      ...(typeof record.category === 'string' ? { category: record.category } : {}),
      fields,
      ...(Array.isArray(record.tags) ? { tags: record.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
      ...(typeof record.note === 'string' ? { note: record.note } : {}),
      source: 'manual',
    })
    imported += 1
  }
  json(res, 200, { ok: true, imported })
}
/**
 * 生成加密备份包并以文件形式下发。
 *
 * 三条纪律：
 *  1. 口令只在本函数栈上存在，**不进审计、不进日志、不回响应**；
 *  2. 包里带密钥（用户口令加密），这是「换机能不能救回密码」的唯一通道；
 *  3. 打包本身是低频操作，但 scrypt 会吃 32MB 内存，所以要 await 而不是同步跑。
 */
async function handleBackup(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < MIN_BACKUP_PASSWORD) {
    json(res, 400, { ok: false, error: '备份口令至少 ' + String(MIN_BACKUP_PASSWORD) + ' 位' })
    return
  }
  const key = store.exportKeyBytes()
  if (key === null) {
    // 没有密钥就打不出能救回密码的包：明确拒绝，而不是给一个假成功的文件。
    json(res, 400, { ok: false, error: '本机没有可用的加密密钥，无法生成可恢复的备份' })
    return
  }
  const vaultJson = await store.exportRaw()
  const records = await store.listRecords({ includeArchived: true })
  const scenes = await store.listScenes()
  const photoCount = records.reduce((sum, record) => sum + record.photos.length, 0)
  // 图片与文件默认不进包（一张证件两三张图、配置文件也可能几十 MB，
  // 大多数用户的诉求是「先把密码救回来」）。要附件就显式传 includePhotos。
  let blobs: Array<{ sha256: string; bytes: Buffer }> | undefined
  if (body.includePhotos === true) {
    const snapshot = await store.blobs.snapshot()
    const collected: Array<{ sha256: string; bytes: Buffer }> = []
    for (const item of snapshot) {
      const bytes = await store.blobs.get(item.sha256)
      if (bytes !== null) collected.push({ sha256: item.sha256, bytes })
    }
    blobs = collected
  }
  const text = await createBackupPackage({
    key,
    vaultJson,
    ...(blobs !== undefined ? { blobs } : {}),
    password,
    summary: { records: records.length, photos: photoCount, scenes: scenes.length },
  })
  const stamp = new Date().toISOString().slice(0, 10)
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': 'attachment; filename="dsh-vault-backup-' + stamp + '.dshvault"' ,
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * 从加密备份包恢复。
 *
 * 顺序刻意如此：**先解包校验，再换密钥，最后覆盖数据**。
 * 反过来的话，口令打错一次就会把现有密钥覆盖掉，用户原本能用的数据
 * 当场全部解不开 —— 这是本模块唯一「错一次就不可逆」的操作点。
 */
async function handleRestore(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const password = typeof body.password === 'string' ? body.password : ''
  const text = typeof body.package === 'string' ? body.package : ''
  if (text.trim() === '') {
    json(res, 400, { ok: false, error: '没有收到备份文件内容' })
    return
  }
  let payload
  try {
    payload = await readBackupPackage(text, password)
  } catch (error) {
    json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  let parsed: { records?: unknown; scenes?: unknown }
  try {
    parsed = JSON.parse(payload.vaultJson) as { records?: unknown; scenes?: unknown }
  } catch {
    json(res, 400, { ok: false, error: '备份里的档案数据无法解析' })
    return
  }
  const records = Array.isArray(parsed.records) ? parsed.records as VaultRecord[] : []
  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes as VaultScene[] : undefined
  if (records.length === 0) {
    json(res, 400, { ok: false, error: '备份里没有记录' })
    return
  }
  // ① 换密钥（备份里带着它那台机器的密钥）。
  const cipher = VaultCipher.fromKey(payload.key)
  const swapped = await store.replaceCipher(cipher)
  if (!swapped) {
    json(res, 400, { ok: false, error: '备份里的密钥长度异常，未做任何修改' })
    return
  }
  // ② 覆盖数据。
  const result = await store.replaceAll({
    records,
    ...(scenes !== undefined ? { scenes } : {}),
  })
  // ③ 附件（图片 + 文件）按内容寻址逐个落盘。
  //
  // 只调 putRaw、不 claim：引用集合由记录里的 photo.blobs / file.sha256 决定，
  // 恢复后第一次 sweepOrphans 会按记录重新对齐。这里额外 claim 会造出一个指向
  // 备份机器的 refId（那个 id 恢复后可能已被用户改过），永远清不掉还占配额。
  // putRaw 不校验图片魔数，所以配置文件这类文本字节也能原样回来。
  let restoredPhotos = 0
  for (const item of payload.blobs) {
    if (item.bytes.length === 0) continue
    try {
      const ref = await store.blobs.putRaw(item.bytes, {
        mediaType: detectMediaType(item.bytes) ?? 'application/octet-stream',
        refId: 'restore:' + item.sha256.slice(0, 12),
      })
      if (ref !== null) restoredPhotos += 1
    } catch {
      // 单个附件写不进去不该让整个恢复失败：记录已经回来才是主要的。
    }
  }
  json(res, 200, {
    ok: true,
    result: {
      records: result.records,
      scenes: result.scenes,
      photos: restoredPhotos,
      replaced: true,
      createdAt: payload.createdAt,
    },
  })
}

/**
 * 算一次 TOTP 验证码。
 *
 * 明文种子只在这个函数里活一次：从 store 取明文 → 解析 → 算码 → 立刻丢弃。
 * 不写审计（用户不是「查看密码」，是「要一个 30 秒后作废的码」），
 * 但**必须 no-store**，否则代理/浏览器缓存会把一个用过即废的码留下来。
 */
async function handleTotp(store: VaultStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === null) { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return }
  const id = requireString(body, 'id')
  const key = requireString(body, 'key')
  const record = await store.getRecordRevealed(id)
  if (record === undefined) {
    json(res, 404, { ok: false, error: '记录不存在' })
    return
  }
  const field = record.fields.find((item) => item.key === key)
  if (field === undefined) {
    json(res, 404, { ok: false, error: '字段不存在' })
    return
  }
  if (field.value === '') {
    json(res, 400, { ok: false, error: '这个字段读不出内容（可能密钥不匹配）' })
    return
  }
  const params = parseTotpSecret(field.value)
  if (params === null) {
    json(res, 400, { ok: false, error: '这个字段不是有效的验证码密钥' })
    return
  }
  const code = generateTotp(params)
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify({ ok: true, totp: code }))
}
/* ───────────────────────── 图片与导出 ───────────────────────── */

/**
 * 图片字节直链。
 *
 * 安全要点：**只服务索引里登记过的 sha**。不校验就会变成任意文件读取——
 * `?sha=../../../../etc/passwd` 只要拼进 path.join 就出去了。索引校验顺带还
 * 挡住了「猜到一个不存在的 sha 就 500」的噪音。
 */
async function serveImage(store: VaultStore, url: URL, res: ServerResponse): Promise<void> {
  const sha = (url.searchParams.get('sha') ?? '').trim().toLowerCase()
  if (!SHA_PATTERN.test(sha)) {
    json(res, 400, { ok: false, error: 'sha 形状不合法' })
    return
  }
  const snapshot = await store.blobs.snapshot()
  const known = snapshot.find((item) => item.sha256 === sha)
  if (known === undefined) {
    json(res, 404, { ok: false, error: '图片不存在或已被清理' })
    return
  }
  const bytes = await store.blobs.get(sha)
  if (bytes === null) {
    json(res, 404, { ok: false, error: '图片文件已丢失' })
    return
  }
  res.writeHead(200, {
    'content-type': mediaTypeOf(bytes),
    'content-length': String(bytes.length),
    // 内容寻址：同一 sha 的字节永不改变，可以长缓存。
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}

/**
 * 文件附件下载。
 *
 * 与图片直链同一道安全闸门：**只服务索引里登记过的 sha**，不接受任何路径参数。
 * 文件名只用于 Content-Disposition（下载后的文件名），不参与读盘路径。
 */
async function serveFile(store: VaultStore, url: URL, res: ServerResponse): Promise<void> {
  const sha = (url.searchParams.get('sha') ?? '').trim().toLowerCase()
  if (!SHA_PATTERN.test(sha)) {
    json(res, 400, { ok: false, error: 'sha 形状不合法' })
    return
  }
  const info = await store.blobs.info(sha)
  if (info === null) {
    json(res, 404, { ok: false, error: '文件不存在或已被清理' })
    return
  }
  const bytes = await store.blobs.get(sha)
  if (bytes === null) {
    json(res, 404, { ok: false, error: '文件已丢失或校验失败' })
    return
  }
  const name = (url.searchParams.get('name') ?? '').trim().slice(0, 255) || 'download'
  res.writeHead(200, {
    'content-type': info.mediaType || 'application/octet-stream',
    'content-length': String(bytes.length),
    'content-disposition': contentDispositionOf(name),
    // 内容寻址：同一 sha 的字节永不改变，可以长缓存。
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}

/**
 * 生成 Content-Disposition。
 *
 * filename 用 ASCII 兜底、filename* 带 UTF-8 原名：中文文件名在旧浏览器里
 * 也能落到一个可读的扩展名，而不会被当成头注入。CR/LF 必须先清掉——否则
 * 一个带换行的文件名就能伪造响应头。
 */
function contentDispositionOf(name: string): string {
  const clean = name.replace(/[\r\n]/g, ' ').trim() || 'download'
  const fallback = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase())
  return 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + encoded
}

/**
 * 导出备份（**密文**）。
 *
 * 这是本模块唯一「整库出站」的地方，因此必须保持密文形态：导出的文件
 * 用户会丢进网盘 / 移动硬盘 / 发给未来的自己，明文备份等于把加密白做了。
 * 密钥在 <root>/key，同一台机器上导入才能解出密码；换机器时连 key 一起带走
 * 即可（页面有「导出密钥」提示）。
 */
async function serveExport(store: VaultStore, res: ServerResponse): Promise<void> {
  const payload = await store.exportRaw()
  const stamp = new Date().toISOString().slice(0, 10)
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': 'attachment; filename="dsh-vault-' + stamp + '.json"',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/* ───────────────────────── 辅助 ───────────────────────── */

/** 关键词筛选（标题 / 副标题 / 标签 / 字段标签 / 非敏感字段值）。 */
function filterRecords(records: VaultRecord[], keyword: string): VaultRecord[] {
  const needle = keyword.toLowerCase()
  return records.filter((record) => {
    if (record.title.toLowerCase().includes(needle)) return true
    if ((record.subtitle ?? '').toLowerCase().includes(needle)) return true
    if (record.tags.some((tag) => tag.toLowerCase().includes(needle))) return true
    if (typeof record.category === 'string' && record.category.toLowerCase().includes(needle)) return true
    return record.fields.some((field) => {
      if (field.label.toLowerCase().includes(needle)) return true
      // 敏感字段的值是掩码，本来就搜不到；非敏感字段可以被搜。
      return !isFieldSensitive(field) && field.value.toLowerCase().includes(needle)
    })
  })
}

/** 字段数组规范化（丢掉没有 key 的、补默认类型）。 */
function normalizeFields(raw: unknown): VaultField[] {
  if (!Array.isArray(raw)) return []
  const out: VaultField[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      label: typeof entry.label === 'string' && entry.label !== '' ? entry.label : key,
      type: isFieldType(entry.type) ? entry.type : 'text',
      ...(typeof entry.sensitive === 'boolean' ? { sensitive: entry.sensitive } : {}),
      value: typeof entry.value === 'string' ? entry.value : '',
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
      ...(typeof entry.unit === 'string' ? { unit: entry.unit } : {}),
    })
  }
  return out
}

/** 字段类型守卫。 */
function isFieldType(value: unknown): value is VaultField['type'] {
  return value === 'text' || value === 'secret' || value === 'email' || value === 'phone'
    || value === 'url' || value === 'date' || value === 'number' || value === 'note'
}

/** 图片档位守卫。 */
function isImageVariant(value: unknown): value is VaultImageVariant {
  return value === 'thumb' || value === 'display' || value === 'original'
}

/** 正整数钳制（宽高）。 */
function toPositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

/** 按魔数判媒体类型（不信客户端声明，也不信文件名）。 */
function mediaTypeOf(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return 'application/octet-stream'
}

/** 新场景 id：ASCII 短横线，与内置场景同风格；重名加后缀。 */
function newSceneId(label: string, existing: VaultScene[]): string {
  const base = label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'scene'
  const taken = new Set(existing.map((scene) => scene.id))
  if (!taken.has(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const candidate = base + '-' + String(index)
    if (!taken.has(candidate)) return candidate
  }
  return base + '-' + String(Date.now())
}

/** 默认配置（reset 用；延迟取避免与 types 的循环依赖猜想）。 */
function defaultConfigOf(): VaultConfig {
  return { ...DEFAULT_VAULT_CONFIG }
}

/** 取一个必填字符串字段。 */
function requireString(body: Record<string, unknown>, name: string): string {
  const value = body[name]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(name + ' 不能为空')
  return value.trim()
}

/* ───────────────────────── HTTP plumbing ───────────────────────── */

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const value = address.toLowerCase()
  if (value === '::1') return true
  const ipv4 = value.startsWith('::ffff:') ? value.slice(7) : value
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
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
  if (res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(value))
}

/** 读请求体（上限 MAX_BODY_BYTES；解析失败返回 null 而不是抛）。 */
function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体超过 ' + String(Math.round(MAX_BODY_BYTES / 1024 / 1024)) + 'MB 上限'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolvePromise({}); return }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        resolvePromise(parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null)
      } catch {
        resolvePromise(null)
      }
    })
    req.on('error', reject)
  })
}