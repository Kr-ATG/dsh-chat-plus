/**
 * dsh-vault 密码生成器：改密码时一键生成一个真随机的强口令。
 *
 * ── 为什么这件小事值得单独一个模块 ──────────────────────────────────
 * 让用户「自己想一个强密码」在现实中一定会退化成 abc123456：人记不住
 * 20 位随机串，于是所有站都退回同一个弱口令。生成器把这步变成一次点击，
 * 剩下的记忆负担本来就该由档案承担（它把密码存下来了）。
 * 密码管理器如果没有生成器，用户就只会用它存弱密码。
 *
 * ── 安全约束 ────────────────────────────────────────────────────────
 *  1. 必须用 crypto.randomInt，绝不能用 Math.random（后者是可预测的
 *     PRNG，用它生成的密码等于没有密码）；
 *  2. 用**拒绝了取模偏差**的采样：randomInt 自带 unbiased 语义，
 *     而 bytes[i] % 90 这类写法会让前 46 个字符出现概率高一个量级；
 *  3. 保证每类字符至少出现一个（有些老系统强制要求「必须包含数字」），
 *     但不能因此破坏随机性：先每类塞一个，再随机填满，最后洗牌。
 *  4. 生成发生在**服务端**：前端生成会被浏览器插件/表单记录看到，
 *     而且前端拿到的「随机」在用户机器上。
 */

import { randomInt } from 'node:crypto'

/** 小写字母（去掉了 l，避免与 1 / I 混淆）。 */
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
/** 大写字母（去掉了 O，避免与 0 混淆）。 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
/** 数字（去掉了 0/1）。 */
const DIGITS = '23456789'
/** 符号（刻意避开引号、反斜杠、尖括号：它们在这类输入框里常被转义或拒绝）。 */
const SYMBOLS = '!#$%&*+-=?@^_'

/** 生成选项。 */
export interface PasswordOptions {
  /** 总长度（12-128）。 */
  length?: number
  /** 是否允许符号（默认允许）。 */
  symbols?: boolean
  /** 是否允许易混淆字符（默认不允许）。 */
  ambiguous?: boolean
}

/** 生成结果的附带信息（页面用来显示「这个密码有多强」）。 */
export interface GeneratedPassword {
  password: string
  length: number
  /** 估计熵（比特）。 = 长度 × log2(字符集大小)。 */
  entropyBits: number
  /** 用到的字符类别数量。 */
  categories: number
}

/**
 * 生成一个密码。
 *
 * @param options 长度与字符集。
 * @returns 密码与它的熵。
 */
export function generatePassword(options: PasswordOptions = {}): GeneratedPassword {
  const length = clampLength(options.length)
  const useSymbols = options.symbols !== false
  const allowAmbiguous = options.ambiguous === true
  const lower = allowAmbiguous ? LOWER + 'l' : LOWER
  const upper = allowAmbiguous ? UPPER + 'O' : UPPER
  const digits = allowAmbiguous ? DIGITS + '01' : DIGITS
  const symbols = useSymbols ? SYMBOLS : ''
  // 必含字符类别：小写 + 大写 + 数字是底线；符号可选。
  const required = [lower, upper, digits, ...(useSymbols ? [symbols] : [])]
  const pool = required.join('')
  const chars: string[] = []
  // ① 每类先塞一个，保证「必须包含数字」这类站点规则能过。
  for (const group of required) chars.push(group[randomInt(0, group.length)])
  // ② 剩余位随机填满。
  while (chars.length < length) chars.push(pool[randomInt(0, pool.length)])
  // ③ Fisher-Yates 洗牌，把「前四位正好是四类各一个」这个规律打散。
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1)
    const swap = chars[i]
    chars[i] = chars[j]
    chars[j] = swap
  }
  const password = chars.join('')
  const entropyBits = Math.round(length * Math.log2(pool.length))
  return { password, length, entropyBits, categories: required.length }
}

/** 长度钳制：太短没有意义，太长有些站点直接拒收。 */
function clampLength(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 20
  return Math.max(12, Math.min(128, Math.round(raw)))
}
