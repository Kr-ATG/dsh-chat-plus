/**
 * dsh-vault 加密层：敏感字段落盘加密（AES-256-GCM）。
 *
 * ── 为什么必须加密 ──────────────────────────────────────────────────
 * 档案里存的是**用户真实的密码**。records.json 若是明文，那么任何能读
 * ~/.dsh 的进程、任何一次「把配置目录打个包发给我看」、任何一次被同步盘
 * 顺走的备份，都等于明文泄露。这不是「最好加密」，是「不加密就不能做」。
 *
 * ── 密钥放哪、为什么不进门禁 ─────────────────────────────────────────
 * 密钥是 <root>/key 下的 32 字节随机数，权限 0o600（仅当前用户可读）。
 * 刻意不做「用户口令派生」，三个理由：
 *   1. 本插件没有解锁界面，也没有一个合理的「何时该解锁」时机——每次会话
 *      首步都要解密，让用户每次开会话输一遍主密码是灾难；
 *   2. 真正的威胁模型是**别的进程/别的机器**（备份、同步、误打包、临时目录
 *      里的残留），不是「本机上另一个进程用同一账户身份读我的文件」——后者
 *      在操作系统层面本来就挡不住；
 *   3. 密钥与数据分文件，用户仍可主动把 key 导出到密码管理器另行保管。
 * 所以这里防的是「数据流出去了」，不是「本机被拿到 root」。
 *
 * ── 格式 ────────────────────────────────────────────────────────────
 *   secret:v1:<base64(iv[12] || tag[16] || ciphertext)>
 * 前缀里带版本号，将来换算法（v2）时老数据仍能解出来。
 *
 * ── 绝不抛穿 ────────────────────────────────────────────────────────
 * 解密失败（密钥被换、文件被截断）一律返回**空串**并记一条 warn，绝不抛错。
 * 理由：档案页在一次解密失败时整体崩掉，会让用户以为数据全没了；而实际
 * 上只有那一个字段读不出来。空串 + 页面标「无法解密」比白屏有用得多。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 加密值前缀（带算法版本）。 */
export const SECRET_PREFIX = 'secret:v1:'

/** AES-256-GCM 密钥长度。 */
const KEY_BYTES = 32
/** GCM nonce 长度（96 位是唯一被广泛推荐的取值）。 */
const IV_BYTES = 12
/** GCM 认证标签长度。 */
const TAG_BYTES = 16

/** 这个值是否已是加密形态（用来做幂等判断：重复加密会嵌套）。 */
export function isEncryptedValue(value: string): boolean {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX)
}

/**
 * 加密一个明文值。
 * @param plain 明文。
 * @param key 32 字节密钥。
 * @returns 带前缀的编码串；加密失败时**原样返回明文**（见下方注释）。
 */
export function encryptSecret(plain: string, key: Buffer): string {
  if (typeof plain !== 'string' || plain === '') return ''
  // 已加密的不再套一层：store 的 patch 路径可能把读出来的值再写回去。
  if (isEncryptedValue(plain)) return plain
  try {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return SECRET_PREFIX + Buffer.concat([iv, tag, body]).toString('base64')
  } catch (error) {
    /*
     * 加密失败**返回明文**而不是抛错，是一个有意的降级：
     *   · 抛错会让「自动记录」在字段写盘这一步失败，用户看到的症状是
     *     「它不记我的密码了」，比明文落盘更难诊断；
     *   · 真正的兜底是 index.ts 里那条启动自检（密钥可用性）+ 页面上的
     *     「未加密」标记，而不是让功能直接不可用。
     * 失败一定伴随一条 warn，绝静默。
     */
    console.warn('[dsh-vault] 敏感值加密失败，将以明文保存：', error instanceof Error ? error.message : String(error))
    return plain
  }
}

/**
 * 解密一个加密值。
 * @param encoded 带前缀的编码串（或已经是明文的老数据）。
 * @param key 32 字节密钥。
 * @returns 明文；解密失败返回**空串**（不抛）。
 */
export function decryptSecret(encoded: string, key: Buffer): string {
  if (typeof encoded !== 'string' || encoded === '') return ''
  // 老数据/未加密数据：原样返回。迁移期必须容忍混合形态。
  if (!isEncryptedValue(encoded)) return encoded
  try {
    const raw = Buffer.from(encoded.slice(SECRET_PREFIX.length), 'base64')
    if (raw.length <= IV_BYTES + TAG_BYTES) return ''
    const iv = raw.subarray(0, IV_BYTES)
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const body = raw.subarray(IV_BYTES + TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    // 密钥不匹配 / 密文损坏：返回空串，由调用方决定怎么提示。
    return ''
  }
}

/**
 * 密钥持有者。
 *
 * 一个实例对应一个 vault 根目录。首次使用时若 key 文件不存在就生成一个，
 * 并尽力把权限收到 0600（Windows 上 chmod 是近似语义，不报错即可）。
 */
export class VaultCipher {
  private constructor(private readonly key: Buffer) {}

  /**
   * 读密钥；不存在则生成。
   * @param keyPath - key 文件绝对路径。
   * @returns 密码器实例；无法读写密钥时返回 null（调用方降级为不加密）。
   */
  static async load(keyPath: string): Promise<VaultCipher | null> {
    try {
      let bytes: Buffer
      try {
        bytes = await readFile(keyPath)
      } catch {
        await mkdir(dirname(keyPath), { recursive: true })
        bytes = randomBytes(KEY_BYTES)
        await writeFile(keyPath, bytes)
        // 权限收紧失败不算错误（Windows 语义不同），只是尽力。
        await chmod(keyPath, 0o600).catch(() => undefined)
      }
      if (bytes.length !== KEY_BYTES) {
        // 长度不对=文件被截断或不是我们写的密钥。**不覆盖**（覆盖等于丢光
        // 所有已加密字段），本次运行降级为不加密，由启动日志喊出来。
        console.warn('[dsh-vault] 密钥文件长度异常（' + String(bytes.length) + ' 字节），本次运行不加密敏感字段')
        return null
      }
      return new VaultCipher(bytes)
    } catch (error) {
      console.warn('[dsh-vault] 密钥不可用，本次运行不加密敏感字段：', error instanceof Error ? error.message : String(error))
      return null
    }
  }

  /** 加密（密钥不可用时不该走到这里；仍返回原值兜底）。 */
  encrypt(plain: string): string {
    return encryptSecret(plain, this.key)
  }

  /** 解密。 */
  decrypt(encoded: string): string {
    return decryptSecret(encoded, this.key)
  }

  /** 是否能把某个值解出来（页面「无法解密」标记用）。 */
  canDecrypt(encoded: string): boolean {
    if (!isEncryptedValue(encoded)) return true
    return this.decrypt(encoded) !== ''
  }

  /**
   * 导出密钥字节的**副本**（备份打包用）。
   *
   * 只给备份模块用一次，调用方必须立刻把它放进加密容器里，
   * 绝不允许写进日志、响应体或明文落盘。返回副本而不是内部引用，
   * 避免调用方误改掉进程里的那把密钥。
   */
  exportKey(): Buffer {
    return Buffer.from(this.key)
  }

  /**
   * 用一份已解出的密钥字节重建密码器（恢复备份后热替换）。
   *
   * 长度不对一律返回 null 而**不抛错**：恢复流程里「备份里的密钥是坏的」
   * 和「备份文件坏了」要给出同一类中文原因，不该让异常穿透到路由层变成 500。
   */
  static fromKey(bytes: Buffer): VaultCipher | null {
    if (!Buffer.isBuffer(bytes) || bytes.length !== KEY_BYTES) return null
    return new VaultCipher(Buffer.from(bytes))
  }
}
