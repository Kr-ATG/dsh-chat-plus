/**
 * dsh-provider-hub — 凭据密钥环（host 半身）。
 *
 * 解决「换 key 就把旧 key 冲掉」的问题：替换不再是覆盖，而是**入环**——
 * 旧值被存档，之后随时可以一键切回来，也可以给某个存档起名、删掉。
 *
 * 为什么必须落在 host：浏览器侧的 `credentials.describe` 只回
 * `{configured, source, writable}`，**永远不回值**（秘密单向过境，见
 * dsh-api-settings-controller 的 credentials.ts）。所以「读旧值 → 存到别处」
 * 这一步只能在 host 做，客户端连旧 key 的一个字符都拿不到。
 *
 * 存档值仍然走官方凭据缝（`ctx.credentials.set/unset/resolve`），落到同一份
 * owner-only 的凭据文档里，不引入第二套明文存储：每个被管理的引用 `R`
 * （如 `OPENROUTER_API_KEY`）配 MAX_SLOTS 个存档引用 `R__KEY_1 … R__KEY_n`。
 * 非秘密的元数据（用户起的名字、存档时间）另存
 * `~/.dsh/provider-hub-keyring.json`——那里不放密钥。
 *
 * 「切换」是**交换**而不是搬移：当前值进槽位、槽位值坐上活动位，两边都不丢，
 * 于是可以在两把钥匙之间来回切。槽位用满后rotate 淘汰最旧的那个。
 *
 * HTTP API（回环围栏，与 proxy / capabilities 同款）：
 *   GET  /state?ref=R            → 活动位 + 全部槽位（含名字与指纹，不回值）
 *   POST /rotate  { ref, value, label? } → 旧值入环，新值上位（可同时起名）
 *   POST /switch  { ref, slot }  → 与指定槽位交换（名字跟着钥匙一起换位）
 *   POST /forget  { ref, slot }  → 删除某个存档
 *   POST /label   { ref, slot, label } → 起名 / 清名（slot=0 表示活动位）
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '../vendor/credential-ref.ts'
import type { CredentialRef } from '../vendor/credential-ref.ts'

/** HTTP API 前缀（长于内核 /api 围栏前缀，最长前缀匹配优先 → 浏览器免鉴权可达）。 */
export const KEYRING_ROUTE_PREFIX = '/api/provider-hub-keys'

/** 每个引用最多保留几个存档（淘汰最旧的）。 */
export const KEYRING_MAX_SLOTS = 4

/** 非秘密元数据文件（标签 / 存档时间），落在 DSH home 下。 */
const LABELS_FILE = 'provider-hub-keyring.json'

/** 请求体上限：一次只带一把 key，64K 足够。 */
const MAX_BODY_BYTES = 64 * 1024

/** 本模块用到的凭据缝面（最小集；只以 ctx.get 防御式获取）。 */
interface CredentialSeam {
  resolve(ref: CredentialRef): Promise<{ value: string; source: string } | undefined>
  describe(ref: CredentialRef): Promise<{ configured: boolean; source?: string; writable: boolean }>
  set(ref: CredentialRef, value: string): Promise<void>
  unset(ref: CredentialRef): Promise<void>
}

/** 活动位在页面上的投影（含名字与指纹，绝不含值）。 */
export interface KeyActiveView {
  configured: boolean
  writable: boolean
  source: string | null
  fingerprint: string | null
  /** 用户起的名字；未起名为 null。 */
  label: string | null
}

/** 一个存档槽位在页面上的投影（含名字与指纹，绝不含值）。 */
export interface KeySlotView {
  slot: number
  /** 存档引用名（`R__KEY_n`）。 */
  ref: string
  configured: boolean
  /** 值的短指纹（sha256 前 6 位）；未配置为 null。 */
  fingerprint: string | null
  /** 用户起的名字；未起名为 null（客户端回退到存档时间）。 */
  label: string | null
  /** 入环时间（ISO）；未配置为 null。 */
  archivedAt: string | null
}

/** 一个引用的密钥环状态。 */
export interface KeyringView {
  ok: true
  ref: string
  maxSlots: number
  active: KeyActiveView
  slots: readonly KeySlotView[]
}

/** 非秘密元数据：名字跟着钥匙走，所以按「位置」存，切换时与值一起换位。 */
interface KeyLabels {
  /** 活动位的名字。 */
  active?: { label?: string }
  /** 各槽位的名字与入环时间。 */
  slots?: Record<string, { label?: string; archivedAt?: string }>
}

type LabelBook = Record<string, KeyLabels>

/** 存档引用名：一条引用配 n 个，sidestep 官方引用表（值只能是字符串）。 */
function archiveRefOf(ref: string, slot: number): string {
  return `${ref}__KEY_${String(slot)}`
}

/** 短指纹：不可逆，撞车率 1/1670万，够用来分辨两把钥匙是谁。 */
function fingerprintOf(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 6)
}

function dshHome(): string {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return join(homedir(), '.dsh')
}

/** 标签文件的绝对路径。 */
function labelsPath(): string {
  return join(dshHome(), LABELS_FILE)
}

/**
 * 读元数据。结构：`{ [ref]: { active?: {label?}, slots?: { [n]: {label?, archivedAt?} } } }`。
 * 文件损坏/不可读时按空处理——元数据丢了不碍事，密钥本身在凭据文档里。
 */
function loadLabels(): LabelBook {
  try {
    const path = labelsPath()
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as LabelBook
  } catch {
    return {}
  }
}

/** 一个位置上用户起的名字（没有/空串都算未起名）。 */
function labelOf(meta: { label?: string } | undefined): string | null {
  return typeof meta?.label === 'string' && meta.label.length > 0 ? meta.label : null
}

function saveLabels(data: LabelBook): void {
  try {
    const path = labelsPath()
    mkdirSync(dshHome(), { recursive: true })
    // 0o600：与凭据文档同级的谨慎。这里没有密钥，但不该让别人顺手读到布局。
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch { /* 元数据写失败不影响密钥操作本身 */ }
}

// ── 回环围栏（与 proxy-host / capabilities-host 同款；三处各自内联，模块互不依赖）──

function isLoopbackAddress(address: string): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function loopbackAllowed(req: { socket?: { remoteAddress?: string }; headers: Record<string, unknown> }): boolean {
  if (!isLoopbackAddress(String(req.socket?.remoteAddress ?? ''))) return false
  const host = String(req.headers.host ?? '').trim().toLowerCase()
  return host === 'localhost' || host.startsWith('localhost:')
    || host === '127.0.0.1' || host.startsWith('127.0.0.1:')
}

function json(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readBody(req: {
  on(event: 'data', listener: (chunk: unknown) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: unknown) => void): void
  destroy(): void
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: unknown[] = []
    let size = 0
    req.on('data', (chunk) => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : ((chunk as { length?: number }).length ?? 0)
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try {
        resolve(JSON.parse(Buffer.concat(chunks as Buffer[]).toString('utf8')))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

/** 一个字符串字段；非字符串或缺席返回 undefined。 */
function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** 一个 0..maxSlots 的整数字段；0 = 活动位。 */
function slotField(body: unknown, max: number): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const raw = (body as Record<string, unknown>).slot
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > max) return undefined
  return value
}

/**
 * 挂载密钥环。凭据服务缺席时仍注册路由——每个请求各自报错，
 * 比整块不挂载更容易诊断（"这个部署没挂 credential provider"）。
 */
export function applyCredentialKeyring(ctx: Context): void {
  const seamOf = (): CredentialSeam | undefined => {
    const seam = (ctx as unknown as { get?(name: string): unknown }).get?.('credentials')
    if (seam === undefined || seam === null) return undefined
    return seam as CredentialSeam
  }

  /** 拼一个引用的当前密钥环状态。 */
  const stateOf = async (ref: CredentialRef): Promise<KeyringView> => {
    const seam = seamOf()
    const meta = loadLabels()[ref] ?? {}
    const active = seam === undefined
      ? { configured: false, writable: false, source: null, fingerprint: null }
      : await seam.describe(ref)
    const activeValue = seam === undefined ? undefined : await seam.resolve(ref)
    const slots: KeySlotView[] = []
    for (let slot = 1; slot <= KEYRING_MAX_SLOTS; slot += 1) {
      const slotRef = credentialRef(archiveRefOf(ref, slot))
      const info = seam === undefined ? undefined : await seam.describe(slotRef)
      const value = seam === undefined ? undefined : await seam.resolve(slotRef)
      const slotMeta = meta.slots?.[String(slot)] ?? {}
      slots.push({
        slot,
        ref: slotRef,
        configured: info?.configured === true,
        fingerprint: value === undefined ? null : fingerprintOf(value.value),
        label: labelOf(slotMeta),
        archivedAt: typeof slotMeta.archivedAt === 'string' && slotMeta.archivedAt.length > 0 ? slotMeta.archivedAt : null,
      })
    }
    return {
      ok: true,
      ref,
      maxSlots: KEYRING_MAX_SLOTS,
      active: {
        configured: active.configured === true,
        writable: active.writable === true,
        source: typeof active.source === 'string' ? active.source : null,
        fingerprint: activeValue === undefined ? null : fingerprintOf(activeValue.value),
        label: labelOf(meta.active),
      },
      slots,
    }
  }

  /**
   * 入环：旧值（连它的名字一起）进一个槽位，新值坐上活动位。
   * @param label - 给新钥匙起的名字；空串 = 不起名。
   */
  const rotate = async (ref: CredentialRef, value: string, label: string): Promise<KeyringView> => {
    const seam = seamOf()
    if (seam === undefined) throw new Error('凭据服务缺席：这个部署没有挂 credential provider')
    const current = await seam.resolve(ref)
    // 同一把钥匙重复提交：什么都不做（否则会把它自己入环，纯粹添乱）。
    if (current !== undefined && current.value === value) return stateOf(ref)
    if (current !== undefined && value.length > 0) {
      const labels = loadLabels()
      const meta = labels[ref] ?? {}
      const bySlot = meta.slots ?? {}
      // 先找空槽；全满则淘汰最旧（按入环时间，时间缺失的按槽位号兜底）。
      let target: number | undefined
      for (let slot = 1; slot <= KEYRING_MAX_SLOTS; slot += 1) {
        const info = await seam.describe(credentialRef(archiveRefOf(ref, slot)))
        if (info.configured !== true) { target = slot; break }
      }
      if (target === undefined) {
        const ordered = Object.entries(bySlot)
          .map(([slot, slotMeta]) => ({
            slot: Number(slot),
            at: typeof slotMeta?.archivedAt === 'string' ? slotMeta.archivedAt : '',
          }))
          .filter(entry => Number.isInteger(entry.slot) && entry.slot >= 1 && entry.slot <= KEYRING_MAX_SLOTS)
          .sort((a, b) => (a.at === b.at ? a.slot - b.slot : (a.at < b.at ? -1 : 1)))
        target = ordered[0]?.slot ?? 1
      }
      await seam.set(credentialRef(archiveRefOf(ref, target)), current.value)
      // 名字跟着钥匙走：活动位原来的名字挪到它落脚的槽位，入环时间另记。
      bySlot[String(target)] = {
        ...(labelOf(meta.active) === null ? {} : { label: labelOf(meta.active) as string }),
        archivedAt: new Date().toISOString(),
      }
      meta.slots = bySlot
      // 新钥匙的名字：不给就清干净，免得沿用上一把的。
      if (label.length === 0) delete meta.active
      else meta.active = { label }
      labels[ref] = meta
      saveLabels(labels)
    } else if (label.length > 0) {
      // 之前没有旧值可入环（首次配置）：只记新钥匙的名字。
      const labels = loadLabels()
      const meta = labels[ref] ?? {}
      meta.active = { label }
      labels[ref] = meta
      saveLabels(labels)
    }
    await seam.set(ref, value)
    return stateOf(ref)
  }

  /**
   * 切换：当前值与槽位值交换，**名字也跟着交换**——名字描述的是钥匙而不是
   * 位置，跟着走才不会出现「点的是 A 的名字，上位的是 B 的钥匙」。
   *
   * 顺序上把「活动位上位」放在最前面：先写 `R`、再写 `R__KEY_n`。反过来
   * 的话，一旦第二步被凭据缝拒绝（典型：`R` 被启动环境只读遮蔽），第一步已经
   * 把存档值用活动值盖掉了——**存档的密钥就此丢失**。现在最坏情况只是
   * 「没换成」，两把钥匙都还在。
   */
  const switchTo = async (ref: CredentialRef, slot: number): Promise<KeyringView> => {
    const seam = seamOf()
    if (seam === undefined) throw new Error('凭据服务缺席：这个部署没有挂 credential provider')
    const slotRef = credentialRef(archiveRefOf(ref, slot))
    const archived = await seam.resolve(slotRef)
    if (archived === undefined) throw new Error(`槽位 ${String(slot)} 没有已保存的密钥`)
    const current = await seam.resolve(ref)
    // 先上位：失败即中止，存档与活动位都不受影响。
    await seam.set(ref, archived.value)
    if (current !== undefined) await seam.set(slotRef, current.value)
    else await seam.unset(slotRef)

    const labels = loadLabels()
    const meta = labels[ref] ?? {}
    const bySlot = meta.slots ?? {}
    const slotMeta = bySlot[String(slot)] ?? {}
    const activeMeta = meta.active ?? {}
    // 槽位的入环时间留在原处（记录这把钥匙当初是什么时候被换下来的），
    // 名字则与活动位的帽子互换。
    bySlot[String(slot)] = {
      ...(labelOf(activeMeta) === null ? {} : { label: labelOf(activeMeta) as string }),
      ...(typeof slotMeta.archivedAt === 'string' ? { archivedAt: slotMeta.archivedAt } : {}),
    }
    if (labelOf(slotMeta) === null) delete meta.active
    else meta.active = { label: labelOf(slotMeta) as string }
    meta.slots = bySlot
    labels[ref] = meta
    saveLabels(labels)

    return stateOf(ref)
  }

  /** 删除一个存档（活动位不动）。 */
  const forget = async (ref: CredentialRef, slot: number): Promise<KeyringView> => {
    const seam = seamOf()
    if (seam === undefined) throw new Error('凭据服务缺席：这个部署没有挂 credential provider')
    await seam.unset(credentialRef(archiveRefOf(ref, slot)))
    const labels = loadLabels()
    const meta = labels[ref]
    if (meta?.slots !== undefined) {
      delete meta.slots[String(slot)]
      if (Object.keys(meta.slots).length === 0) delete meta.slots
      labels[ref] = meta
      saveLabels(labels)
    }
    return stateOf(ref)
  }

  /**
   * 起名 / 清名。`slot = 0` 表示活动位（给当前正在用的钥匙改名）。
   * @param label - 空串 = 清名，回退到按指纹/时间显示。
   */
  const setLabel = async (ref: CredentialRef, slot: number, label: string): Promise<KeyringView> => {
    const labels = loadLabels()
    const meta = labels[ref] ?? {}
    const trimmed = label.slice(0, 40)
    if (slot === 0) {
      if (trimmed.length === 0) delete meta.active
      else meta.active = { label: trimmed }
    } else {
      const bySlot = meta.slots ?? {}
      const slotMeta = bySlot[String(slot)] ?? {}
      if (trimmed.length === 0) delete slotMeta.label
      else slotMeta.label = trimmed
      bySlot[String(slot)] = slotMeta
      meta.slots = bySlot
    }
    labels[ref] = meta
    saveLabels(labels)
    return stateOf(ref)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: KEYRING_ROUTE_PREFIX,
    handler: (req: unknown, res: unknown) => { void route(req, res) },
  }), 'dsh-provider-hub: credential keyring http routes')

  async function route(req: unknown, res: unknown): Promise<void> {
    const request = req as {
      method?: string
      url?: string
      socket?: { remoteAddress?: string }
      headers: Record<string, unknown>
    }
    const response = res as {
      writeHead(status: number, headers: Record<string, string>): void
      end(body: string): void
    }
    try {
      if (!loopbackAllowed(request)) {
        json(response, 403, { ok: false, message: 'loopback only' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const rest = url.pathname.slice(KEYRING_ROUTE_PREFIX.length) || '/'
      const method = String(request.method ?? 'GET').toUpperCase()
      const queryRef = url.searchParams.get('ref')
      const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req as never)
      const rawRef = queryRef ?? stringField(body, 'ref')
      if (rawRef === undefined || rawRef.length === 0) {
        json(response, 400, { ok: false, message: 'missing ref' })
        return
      }
      let ref: CredentialRef
      try {
        ref = credentialRef(rawRef)
      } catch {
        json(response, 400, { ok: false, message: 'invalid ref name' })
        return
      }

      if (rest === '/state' && method === 'GET') {
        json(response, 200, await stateOf(ref))
        return
      }

      if (rest === '/rotate' && method === 'POST') {
        const value = stringField(body, 'value')
        if (value === undefined || value.length === 0) {
          json(response, 400, { ok: false, message: 'missing value' })
          return
        }
        // label 缺省即不起名（允许只换 key 不命名）。
        json(response, 200, await rotate(ref, value, (stringField(body, 'label') ?? '').trim()))
        return
      }

      if (rest === '/switch' && method === 'POST') {
        const slot = slotField(body, KEYRING_MAX_SLOTS)
        if (slot === undefined || slot < 1) {
          json(response, 400, { ok: false, message: `missing slot (1..${String(KEYRING_MAX_SLOTS)})` })
          return
        }
        json(response, 200, await switchTo(ref, slot))
        return
      }

      if (rest === '/forget' && method === 'POST') {
        const slot = slotField(body, KEYRING_MAX_SLOTS)
        if (slot === undefined || slot < 1) {
          json(response, 400, { ok: false, message: `missing slot (1..${String(KEYRING_MAX_SLOTS)})` })
          return
        }
        json(response, 200, await forget(ref, slot))
        return
      }

      if (rest === '/label' && method === 'POST') {
        // slot=0 表示给活动位（当前正在用的钥匙）改名。
        const slot = slotField(body, KEYRING_MAX_SLOTS)
        if (slot === undefined) {
          json(response, 400, { ok: false, message: `missing slot (0=活动位, 1..${String(KEYRING_MAX_SLOTS)}=存档)` })
          return
        }
        json(response, 200, await setLabel(ref, slot, (stringField(body, 'label') ?? '').trim()))
        return
      }

      json(response, 404, { ok: false, message: `unknown keyring route ${rest}` })
    } catch (error) {
      // 缝自己的拒绝（env 遮蔽、provider 缺席）原样带给页面：那句话正是用户
      // 需要看到的诊断，包一层反而失真。
      json(response, 200, { ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }
}
