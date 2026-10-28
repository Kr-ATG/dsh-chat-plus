/**
 * 工作台资产打包与加解密引擎：端侧零知识加密。
 *
 * 算法标准：
 *   · KDF: scrypt (N=32768, r=8, p=1, keyLen=32, maxmem=64MB)
 *   · 对称加密: AES-256-GCM (12 字节随机 IV, 16 字节 Auth Tag)
 *   · 压缩: gzip
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { WORKBENCH_SYNC_MIN_PASSPHRASE } from './types.js'

export const ENVELOPE_FORMAT = 'dsh-workbench-sync'
export const ENVELOPE_VERSION = 1

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

export interface SyncEnvelope {
  format: string
  version: number
  createdAt: string
  summary: {
    vaultRecords?: number
    memoryEntries?: number
    skillFiles?: number
    /** 动态设置里的关注对象个数（提示词与模型是否包含由 configJson 是否存在决定）。 */
    feedEntities?: number
  }
  kdf: {
    name: string
    salt: string
    N: number
    r: number
    p: number
    keyLen: number
  }
  cipher: {
    name: string
    iv: string
    tag: string
  }
  payload: string
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (err, derived) => {
      if (err !== null) reject(err)
      else resolve(derived)
    })
  })
}

/** 加密工作台数据包。 */
export async function encryptSyncPayload(
  payload: object,
  password: string,
  summary: SyncEnvelope['summary'] = {},
): Promise<string> {
  if (typeof password !== 'string' || password.length < WORKBENCH_SYNC_MIN_PASSPHRASE) {
    throw new Error(`同步口令至少 ${WORKBENCH_SYNC_MIN_PASSPHRASE} 位`)
  }
  const plain = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const derived = await deriveKey(password, salt)
  const cipher = createCipheriv('aes-256-gcm', derived, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()

  const envelope: SyncEnvelope = {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    createdAt: new Date().toISOString(),
    summary,
    kdf: {
      name: 'scrypt',
      salt: salt.toString('base64'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      keyLen: SCRYPT_KEYLEN,
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    },
    payload: body.toString('base64'),
  }
  return JSON.stringify(envelope, null, 2)
}

/** 解密工作台数据包。 */
export async function decryptSyncPayload<T>(text: string, password: string): Promise<{ data: T; envelope: SyncEnvelope }> {
  let envelope: SyncEnvelope
  try {
    envelope = JSON.parse(text) as SyncEnvelope
  } catch {
    throw new Error('备份文件损坏：无法解析为 JSON')
  }
  if (!envelope || typeof envelope !== 'object' || envelope.format !== ENVELOPE_FORMAT) {
    throw new Error('备份文件格式不匹配（非 dsh-workbench-sync）')
  }
  if (typeof envelope.version !== 'number' || envelope.version > ENVELOPE_VERSION) {
    throw new Error(`备份包版本高于当前插件支持版本（包版本 ${envelope.version}），请先升级插件`)
  }
  if (envelope.kdf?.name !== 'scrypt' || envelope.cipher?.name !== 'aes-256-gcm') {
    throw new Error('备份文件使用了未知的加密算法')
  }
  const salt = Buffer.from(envelope.kdf.salt ?? '', 'base64')
  const iv = Buffer.from(envelope.cipher.iv ?? '', 'base64')
  const tag = Buffer.from(envelope.cipher.tag ?? '', 'base64')
  if (salt.length < 8 || iv.length !== 12 || tag.length !== 16) {
    throw new Error('备份文件加密头部参数异常')
  }

  const derived = await deriveKey(password, salt)
  let plain: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', derived, iv)
    decipher.setAuthTag(tag)
    plain = gunzipSync(Buffer.concat([decipher.update(Buffer.from(envelope.payload, 'base64')), decipher.final()]))
  } catch {
    throw new Error('同步口令错误，或备份文件已被篡改')
  }

  try {
    const data = JSON.parse(plain.toString('utf8')) as T
    return { data, envelope }
  } catch {
    throw new Error('解密成功但数据载荷解析失败')
  }
}

/** 规范化计算明文数据指纹（用于判断是否内容发生真实变更）。 */
export function hashData(data: unknown): string {
  const json = JSON.stringify(data)
  return createHash('sha256').update(json).digest('hex')
}

/** 计算与 GitHub Contents API 兼容的 blob sha1。 */
export function gitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\u0000`, 'utf8')
  return createHash('sha1').update(header).update(content).digest('hex')
}
