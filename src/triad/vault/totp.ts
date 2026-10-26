/**
 * dsh-vault TOTP：把已经存好的「二次验证」字段变成真的能用的动态验证码。
 *
 * ── 为什么这个功能必须做 ────────────────────────────────────────────
 * 档案里存 totp 字段的本来目的就是「以后要用」。只存不用等于存了一串
 * 自己看不懂的 base32：用户真到登录那天，还是要打开手机找那个 App。
 * 本机算一次 HMAC 就能出码，让「档案」从**记录本**变成**可用工具**。
 *
 * ── 安全边界（改这个文件时不要破坏）────────────────────────────────
 *  1. 明文种子只在**本进程内存**里存在，算完即弃，绝不缓存、绝不落盘；
 *  2. 生成的 6 位码也不缓存：TOTP 码 30 秒就过期，缓存只会让用户拿到
 *     一个已经作废的码（比不给更糟）；
 *  3. 本模块不 import 任何 store / fs：调用方负责把密文解密成明文再传进来，
 *     于是「TOTP 这条路径读不读得到明文」这件事只在 api.ts 一处决定。
 *
 * ── 为什么手写 base32 而不是装包 ────────────────────────────────────
 * RFC 4648 的 base32 解码只要 30 行；装一个包换来的是一份第三方代码
 * 要跟着审查（这文件碰到的是用户的二次验证密钥，供应链风险要压到最低）。
 */

import { createHmac } from 'node:crypto'

/** RFC 4648 base32 字母表（大写，无数字 0/1/8/9，避免与 O/I/B 混淆）。 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** TOTP 默认周期（RFC 6238 推荐 30 秒，几乎所有服务都用这个）。 */
const DEFAULT_PERIOD = 30
/** 默认位数（RFC 6238 允许 6/8，现实中 99% 是 6）。 */
const DEFAULT_DIGITS = 6

/** 解析出来的 TOTP 参数。 */
export interface TotpParams {
  /** base32 种子（已去分隔符、已转大写）。 */
  secret: string
  /** 周期秒数。 */
  period: number
  /** 位数。 */
  digits: number
  /** otpauth 里的发行方（展示用，可缺省）。 */
  issuer?: string
  /** otpauth 里的账户名（展示用，可缺省）。 */
  account?: string
}

/** 一次生成的结果。 */
export interface TotpCode {
  /** 固定位数的十进制码（前导零补齐）。 */
  code: string
  /** 当前周期还剩多少秒（1..period）。 */
  remaining: number
  /** 周期秒数。 */
  period: number
  /** 位数。 */
  digits: number
  /** 发行方 / 账户（若种子里带了 otpauth 元信息）。 */
  issuer?: string
  account?: string
}

/**
 * 把字段值解析成 TOTP 参数。
 *
 * 支持三种现实里都会遇到的写法：
 *   1. otpauth 链接（otpauth://totp/GitHub:kr?secret=后面跟种子）
 *      —— 手机扫码后复制出来的原始链接（<种子> 换成真串），用户常常整条粘进来；
 *   2. 裸种子：App 里「手动输入」看到的那串大写字母数字；
 *   3. jbsw y3dp ehpk 3pxp / JBSW-Y3DP-EHPK-3PXP —— 带空格或短横线的分组写法。
 *
 * @returns 合法则返回参数；不合法返回 null（调用方据此报「不是有效的验证码密钥」）。
 */
export function parseTotpSecret(value: string): TotpParams | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed === "") return null
  // ① otpauth 链接形态：把 query 参数一并吃下来。
  if (/^otpauth:\/\//i.test(trimmed)) {
    return parseOtpAuthUri(trimmed)
  }
  // ② / ③ 裸种子：去掉一切非 base32 字符（空格、短横线、下划线）。
  const normalized = normalizeBase32(trimmed)
  if (!isValidBase32(normalized)) return null
  return { secret: normalized, period: DEFAULT_PERIOD, digits: DEFAULT_DIGITS }
}

/** 解析 otpauth 链接（只认 query 里的 secret）。 */
function parseOtpAuthUri(uri: string): TotpParams | null {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  if (parsed.protocol !== "otpauth:") return null
  const secret = parsed.searchParams.get("secret")
  if (secret === null) return null
  const normalized = normalizeBase32(secret)
  if (!isValidBase32(normalized)) return null
  const period = toBoundedInt(parsed.searchParams.get("period"), DEFAULT_PERIOD, 1, 300)
  const digits = toBoundedInt(parsed.searchParams.get("digits"), DEFAULT_DIGITS, 6, 8)
  // 发行方可能在 query，也可能在 path 前缀（GitHub:kr 的 GitHub）。
  const label = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""))
  const colon = label.indexOf(":")
  const issuer = parsed.searchParams.get("issuer") ?? (colon > 0 ? label.slice(0, colon).trim() : undefined)
  const account = colon > 0 ? label.slice(colon + 1).trim() : (label === "" ? undefined : label)
  return {
    secret: normalized,
    period,
    digits,
    ...(issuer !== undefined && issuer !== "" ? { issuer } : {}),
    ...(account !== undefined && account !== "" ? { account } : {}),
  }
}

/** 去掉分隔符并转大写。 */
function normalizeBase32(raw: string): string {
  return raw.replace(/[\s\-_]/g, "").toUpperCase()
}

/** 是否是可用的 base32 串（长度够长、字符都在表内）。 */
function isValidBase32(value: string): boolean {
  // 少于 16 个字符（=10 字节）的种子在现实中不存在，基本是用户粘错了。
  if (value.length < 16) return false
  for (const ch of value) {
    if (BASE32_ALPHABET.indexOf(ch) === -1) return false
  }
  return true
}

/** 读一个有界整数参数（非法值回落默认）。 */
function toBoundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < min || value > max) return fallback
  return value
}

/**
 * RFC 4648 base32 解码。
 *
 * 逐字符累加比特而不是「每 8 个字符切一刀」，因为种子长度不一定是 8 的倍数
 * （不带 padding 的真实种子几乎都不是）。
 */
export function base32Decode(encoded: string): Buffer {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of encoded) {
    const index = BASE32_ALPHABET.indexOf(ch)
    if (index === -1) continue
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >>> bits) & 0xff)
    }
  }
  return Buffer.from(out)
}

/**
 * 算当前时间窗里的 TOTP 码。
 *
 * @param params parseTotpSecret 的结果。
 * @param at 毫秒时间戳（缺省现在；测试注入用）。
 */
export function generateTotp(params: TotpParams, at = Date.now()): TotpCode {
  const period = params.period > 0 ? params.period : DEFAULT_PERIOD
  const digits = params.digits >= 6 && params.digits <= 8 ? params.digits : DEFAULT_DIGITS
  const seconds = Math.floor(at / 1000)
  const counter = Math.floor(seconds / period)
  const key = base32Decode(params.secret)
  // 计数器是 64 位大端整数（RFC 4226 5.2）。用 BigInt 避免双精度丢位。
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac("sha1", key).update(message).digest()
  // 动态截断（RFC 4226 5.4）：取最后一字节低 4 位当偏移。
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  const code = String(binary % 10 ** digits).padStart(digits, "0")
  const remaining = period - (seconds % period)
  return {
    code,
    remaining,
    period,
    digits,
    ...(params.issuer !== undefined ? { issuer: params.issuer } : {}),
    ...(params.account !== undefined ? { account: params.account } : {}),
  }
}

/**
 * 字段是否「看起来是二次验证密钥」（页面据此决定要不要显示「生成验证码」）。
 *
 * 判据故意宽松但**不看值**：只看 key / label / type。原因是判定发生在
 * 掩码态的记录上（页面拿不到明文），不能靠「值像不像 base32」来判断。
 */
export function looksLikeTotpField(field: { key: string; label?: string; type?: string }): boolean {
  if (field.type !== "secret") return false
  const key = field.key.toLowerCase()
  if (/(totp|otp|otpauth|authenticator|2fa|mfa)/.test(key)) return true
  const label = (field.label ?? "").toLowerCase()
  return /(二次验证|两步验证|动态码|验证码|令牌|otp|2fa|mfa|totp)/.test(label)
}
