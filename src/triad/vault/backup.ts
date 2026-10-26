/**
 * dsh-vault 备份与恢复：让「换一台机器」不再等于「档案全丢」。
 *
 * ── 为什么这是整个模块最要命的一处 ──────────────────────────────────
 * 敏感字段是用 <root>/key 加密的。那份 key 只存在于这台机器上：
 *   · 用户重装系统 / 换电脑 / 改了 DSH_HOME → key 不见了，
 *     所有密码类字段解出来都是空串（数据还在，但一个都用不了）；
 *   · 用户把 vault.json 传给别人 → 对方也读不出（这是加密本来要的），
 *     但用户自己以为「备份过了」。
 * 所以必须有一条不依赖本机文件的导出通道：把 key 用用户口令加密后
 * 打包进备份文件里。口令只在内存里，不落盘、不进日志。
 *
 * ── 包格式（刻意分层，便于将来兼容）────────────────────────────────
 *   JSON 外层：format / version / createdAt / summary / kdf / cipher / payload
 *   kdf    = scrypt 参数（name / salt / N / r / p / keyLen）
 *   cipher = aes-256-gcm 参数（name / iv / tag）
 *   payload= base64( AES-GCM( gzip( JSON 明文体 ) ) )
 * 外层是明文 JSON 而不是二进制：用户能一眼看出这是什么东西，
 * 文件损坏时也能读出 createdAt 与 version 来决定怎么办。
 *
 * ── 为什么用 scrypt 而不是 PBKDF2 ───────────────────────────────────
 * node 自带 scrypt，且它对内存硬（N=2^15 时约 32MB），对 GPU 暴力
 * 比 PBKDF2 强得多。代价是单次派生约 100ms——打包/恢复是低频操作，
 * 这点延迟完全无所谓。
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt, createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'

/** 备份包格式标记（文件头里也能看到，便于用户辨认）。 */
export const BACKUP_FORMAT = 'dsh-vault-backup'
/** 备份包结构版本。加字段不改语义时不升版本；改语义/换算法才升。 */
export const BACKUP_VERSION = 1

/** scrypt 参数（N=32768 约 32MB 内存，单次约 100ms）。 */
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32
/** 口令最短长度。太短的备份包等于没加密（离线暴力几小时就开）。 */
export const MIN_BACKUP_PASSWORD = 8

/** 备份包外层结构。 */
export interface VaultBackupEnvelope {
  format: string
  version: number
  createdAt: string
  /** 打这个包时的记录 / 照片 / 场景数量（恢复前给用户看，避免装错包）。 */
  summary: { records: number; photos: number; scenes: number }
  kdf: { name: string; salt: string; N: number; r: number; p: number; keyLen: number }
  cipher: { name: string; iv: string; tag: string }
  /** base64(AES-GCM(gzip(JSON payload)))。 */
  payload: string
}

/** 包里装的东西（加密之前的明文结构）。 */
export interface VaultBackupPayload {
  /** 密钥的 base64（32 字节）。这是「换机能不能救回密码」的关键。 */
  key: string
  /** vault.json 的原文（敏感字段仍是密文，与本机磁盘形态一致）。 */
  vault: string
  /** 可选：blobs 里每张图的 { sha256, base64 }。 */
  blobs?: Array<{ sha256: string; base64: string }>
}

/** 恢复结果。 */
export interface VaultRestorePayload {
  key: Buffer
  vaultJson: string
  blobs: Array<{ sha256: string; bytes: Buffer }>
  createdAt: string
  summary: { records: number; photos: number; scenes: number }
}

/** scrypt 派生（Promise 化，避免堵事件循环）。 */
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error !== null) reject(error)
      else resolve(derived)
    })
  })
}

/** 密钥指纹（sha256 前 16 位十六进制）。只暴露指纹，不暴露密钥。 */
export function keyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/**
 * 生成备份包。
 *
 * @param input.key 32 字节密钥。
 * @param input.vaultJson vault.json 原文。
 * @param input.blobs 可选图片字节。
 * @param input.password 用户口令（至少 MIN_BACKUP_PASSWORD 位）。
 * @returns 备份包 JSON 文本（可直接写文件）。
 */
export async function createBackupPackage(input: {
  key: Buffer
  vaultJson: string
  blobs?: Array<{ sha256: string; bytes: Buffer }>
  password: string
  summary: { records: number; photos: number; scenes: number }
  now?: Date
}): Promise<string> {
  if (typeof input.password !== 'string' || input.password.length < MIN_BACKUP_PASSWORD) {
    throw new Error('备份口令至少 ' + String(MIN_BACKUP_PASSWORD) + ' 位')
  }
  if (input.key.length !== 32) {
    throw new Error('密钥长度异常，无法打包')
  }
  const payload: VaultBackupPayload = {
    key: input.key.toString('base64'),
    vault: input.vaultJson,
    ...(input.blobs !== undefined
      ? { blobs: input.blobs.map((item) => ({ sha256: item.sha256, base64: item.bytes.toString('base64') })) }
      : {}),
  }
  const plain = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const derived = await deriveKey(input.password, salt)
  const cipher = createCipheriv('aes-256-gcm', derived, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  const envelope: VaultBackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    summary: input.summary,
    kdf: {
      name: 'scrypt',
      salt: salt.toString('base64'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      keyLen: SCRYPT_KEYLEN,
    },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    payload: body.toString('base64'),
  }
  return JSON.stringify(envelope, null, 2)
}

/**
 * 解析并解密备份包。
 *
 * 失败一律抛带中文原因的 Error（调用方直接把 message 回给页面——
 * 这里没有需要隐藏的内部细节，而「密码错了」和「文件坏了」必须能区分，
 * 否则用户会一直重试同一个口令）。
 */
export async function readBackupPackage(text: string, password: string): Promise<VaultRestorePayload> {
  let envelope: VaultBackupEnvelope
  try {
    envelope = JSON.parse(text) as VaultBackupEnvelope
  } catch {
    throw new Error('备份文件不是有效的 JSON，可能已损坏')
  }
  if (envelope === null || typeof envelope !== 'object') {
    throw new Error('备份文件格式不正确')
  }
  if (envelope.format !== BACKUP_FORMAT) {
    throw new Error('这不是 dsh-vault 的备份文件')
  }
  if (typeof envelope.version !== 'number' || envelope.version > BACKUP_VERSION) {
    throw new Error('备份文件来自更新版本的插件（' + String(envelope.version) + '），请先升级')
  }
  if (envelope.kdf?.name !== 'scrypt' || envelope.cipher?.name !== 'aes-256-gcm') {
    throw new Error('备份文件使用了不支持的加密算法')
  }
  if (typeof envelope.payload !== 'string' || envelope.payload === '') {
    throw new Error('备份文件内容为空')
  }
  const salt = Buffer.from(envelope.kdf.salt ?? '', 'base64')
  const iv = Buffer.from(envelope.cipher.iv ?? '', 'base64')
  const tag = Buffer.from(envelope.cipher.tag ?? '', 'base64')
  if (salt.length < 8 || iv.length !== 12 || tag.length !== 16) {
    throw new Error('备份文件头部参数损坏')
  }
  const derived = await deriveKey(password, salt)
  let plain: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', derived, iv)
    decipher.setAuthTag(tag)
    plain = gunzipSync(Buffer.concat([decipher.update(Buffer.from(envelope.payload, 'base64')), decipher.final()]))
  } catch {
    // GCM 认证失败 = 口令错或内容被改过。两者对用户是同一句提示。
    throw new Error('口令不正确，或备份文件已被修改')
  }
  let payload: VaultBackupPayload
  try {
    payload = JSON.parse(plain.toString('utf8')) as VaultBackupPayload
  } catch {
    throw new Error('备份内容无法解析')
  }
  const key = Buffer.from(payload.key ?? '', 'base64')
  if (key.length !== 32) {
    throw new Error('备份里的密钥长度异常')
  }
  if (typeof payload.vault !== 'string' || payload.vault === '') {
    throw new Error('备份里没有档案数据')
  }
  const blobs = Array.isArray(payload.blobs)
    ? payload.blobs.map((item) => ({ sha256: String(item.sha256), bytes: Buffer.from(String(item.base64), 'base64') }))
    : []
  return {
    key,
    vaultJson: payload.vault,
    blobs,
    createdAt: typeof envelope.createdAt === 'string' ? envelope.createdAt : '',
    summary: envelope.summary ?? { records: 0, photos: 0, scenes: 0 },
  }
}
