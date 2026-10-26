/**
 * dsh-vault 健康审计：把「存了一堆账号」变成「知道哪里该动手了」。
 *
 * ── 为什么档案需要审计 ──────────────────────────────────────────────
 * 密码管理器的价值一半在「存」，一半在「发现」：同一个密码用在七个站、
 * 三年前的弱口令一直没改、证件下个月过期——这些事用户不会主动去数。
 * 审计把它们算成一份清单，页面上是一条一条能点开的待办。
 *
 * ── 三条硬约束 ──────────────────────────────────────────────────────
 *  1. 报告里绝不出现明文值：连长度都不给（长度本身能缩小暴力空间）。
 *     复用密码只报「哪几条用了同一个」，用不可逆的组 id 表达。
 *  2. 不猜、不误伤：判据全部可解释（太短 / 纯数字 / 命中常见口令表），
 *     拿不准的一律不报——满屏假警报的审计等于没有审计。
 *  3. 纯函数，不读盘不写盘：吃一份明文记录数组，吐一份报告。
 *     这样它可以被单测直接打，也保证审计过程不会顺手把明文写到别处。
 */

import { createHash } from 'node:crypto'
import { isFieldSensitive, type VaultRecord, type VaultScene } from './types.js'

/** 问题类别（页面按它分组、按它出文案；新增类别要同步页面）。 */
export type VaultIssueKind =
  | 'reused-password'
  | 'weak-password'
  | 'stale-password'
  | 'plaintext-secret'
  | 'expired'
  | 'expiring'
  | 'no-password'
  | 'duplicate-record'

/** 严重度（页面用它排先后与配色）。 */
export type VaultIssueSeverity = 'high' | 'medium' | 'low'

/** 一条待处理问题。 */
export interface VaultIssue {
  kind: VaultIssueKind
  severity: VaultIssueSeverity
  recordId: string
  title: string
  scene: string
  fieldKey?: string
  /** 同一组问题的标识（复用密码的同一组共享同一个 groupId）。 */
  groupId?: string
  /** 给人看的一句话，不含明文值。 */
  message: string
  /** 可选的补充说明（剩余天数等）。 */
  detail?: string
}

/** 审计报告。 */
export interface VaultHealthReport {
  generatedAt: string
  /** 0-100：100 = 没有任何问题。 */
  score: number
  totalRecords: number
  /** 敏感字段总数（分母）。 */
  sensitiveFields: number
  /** 按类别计数。 */
  counts: Record<string, number>
  issues: VaultIssue[]
}

/** 临期判定的天数阈值。 */
const EXPIRING_DAYS = 90
/** 「太久没改」阈值（365 天）。 */
const STALE_DAYS = 365
/** 一天的毫秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000
/**
 * 常见弱口令表。
 *
 * 不引完整字典（几万条会拖慢每次审计，而且本模块是同步跑在路由里的）。
 * 这里只收「用户真的会这么设」的那一小撮，命中即报；不在表里不等于安全，
 * 所以弱口令还有「太短 / 纯数字 / 单字符重复」三条结构判据兜底。
 */
const WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  '123456', '12345678', '123456789', '1234567890', '111111', '000000',
  'password', 'passw0rd', 'p@ssw0rd', 'qwerty', 'qwerty123', 'abc123',
  'admin', 'administrator', 'root', 'letmein', 'welcome', 'monkey',
  'iloveyou', 'sunshine', 'princess', 'dragon', 'football', 'baseball',
  'aa123456', 'a123456', '123qwe', '1qaz2wsx', 'zxcvbnm', 'asdfgh',
  'woaini', 'woaini1314', '5201314', '1314520', '88888888', '666666',
  'test', 'test123', 'guest', 'changeme', 'secret',
])

/** 判定一串密码是否弱（只看结构，不与其它记录比）。 */
export function isWeakPassword(plain: string): boolean {
  if (plain === '') return false
  const lower = plain.toLowerCase()
  if (WEAK_PASSWORDS.has(lower)) return true
  // 太短：6 位以下在任何场景都不合格。
  if (plain.length < 6) return true
  // 纯数字：暴力秒破，且多半是生日或手机号尾段。
  if (/^[0-9]+$/.test(plain)) return true
  // 单一字符重复（aaaaaaaaaaaaaaaa）。用反向引用整串匹配。
  if (/^(.)\1+$/.test(plain)) return true
  return false
}

/**
 * 算一个密码的不可逆指纹（复用判定用）。
 *
 * 用 sha256 的十六进制前 16 位。它只在本进程内比对、绝不外泄：
 * 报告里给出的是这个指纹的前 6 位当 groupId，本身就是不可逆的。
 */
function passwordFingerprint(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex').slice(0, 16)
}

/** 一条记录里的「登录口令」类字段（用于复用 / 弱口令 / 太久没改判定）。 */
function passwordFieldsOf(record: VaultRecord): Array<{ key: string; label: string; value: string; updatedAt: string }> {
  const out: Array<{ key: string; label: string; value: string; updatedAt: string }> = []
  for (const field of record.fields) {
    if (!isFieldSensitive(field)) continue
    if (field.type !== 'secret') continue
    const key = field.key.toLowerCase()
    // 只把「登录口令」类算进来：二次验证种子不是密码，不参与复用与弱口令。
    if (/(totp|otp|2fa|mfa|authenticator)/.test(key)) continue
    const looksLikePassword = /(password|passwd|pwd|pass|mima)/.test(key)
      || /(密码|口令)/.test(field.label)
    if (!looksLikePassword) continue
    out.push({ key: field.key, label: field.label, value: field.value, updatedAt: field.updatedAt })
  }
  return out
}

/** 解析 ISO 时间成毫秒（失败返回 NaN）。 */
function parseIso(value: string): number {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : NaN
}

/** 距今天数（正数=未来，负数=已过期）。 */
function daysFromNow(iso: string, now: number): number {
  const ms = parseIso(iso)
  if (!Number.isFinite(ms)) return NaN
  return Math.round((ms - now) / DAY_MS)
}
/**
 * 跑一次审计。
 *
 * @param records 明文记录（调用方负责用 listRecordsRevealed 取）。
 * @param scenes 场景表（只为把 scene id 换成中文名放进 message）。
 * @param now 毫秒时间戳（测试注入）。
 */
export function auditVault(
  records: readonly VaultRecord[],
  scenes: readonly VaultScene[],
  now = Date.now(),
): VaultHealthReport {
  const sceneLabel = new Map(scenes.map((scene) => [scene.id, scene.label]))
  const issues: VaultIssue[] = []
  const live = records.filter((record) => record.archived !== true)
  // 复用判定：指纹 -> 用过它的记录列表。
  const byFingerprint = new Map<string, Array<{ recordId: string; title: string; scene: string; fieldKey: string }>>()
  let sensitiveFields = 0

  for (const record of live) {
    const sceneName = sceneLabel.get(record.scene) ?? record.scene
    for (const field of record.fields) {
      if (!isFieldSensitive(field)) continue
      sensitiveFields += 1
      // 该加密却是明文：密钥缺失过，或历史数据来自不加密的版本。
      if (field.value !== '' && !field.value.startsWith('secret:v1:')) {
        issues.push({
          kind: 'plaintext-secret',
          severity: 'high',
          recordId: record.id,
          title: record.title,
          scene: record.scene,
          fieldKey: field.key,
          message: '「' + field.label + '」没有加密就存到了磁盘上',
          detail: sceneName,
        })
      }
    }

    // 过期 / 临期：所有 date 字段（证件有效期、银行卡有效期）。
    for (const field of record.fields) {
      if (field.type !== 'date') continue
      const days = daysFromNow(field.value, now)
      if (!Number.isFinite(days)) continue
      if (days < 0) {
        issues.push({
          kind: 'expired',
          severity: 'high',
          recordId: record.id,
          title: record.title,
          scene: record.scene,
          fieldKey: field.key,
          message: '「' + field.label + '」已经过期 ' + String(-days) + ' 天',
          detail: String(days),
        })
      } else if (days <= EXPIRING_DAYS) {
        issues.push({
          kind: 'expiring',
          severity: days <= 30 ? 'medium' : 'low',
          recordId: record.id,
          title: record.title,
          scene: record.scene,
          fieldKey: field.key,
          message: '「' + field.label + '」还有 ' + String(days) + ' 天到期',
          detail: String(days),
        })
      }
    }

    // 密码字段：弱口令 / 太久没改 / 复用。
    const passwords = passwordFieldsOf(record)
    for (const item of passwords) {
      if (isWeakPassword(item.value)) {
        issues.push({
          kind: 'weak-password',
          severity: 'high',
          recordId: record.id,
          title: record.title,
          scene: record.scene,
          fieldKey: item.key,
          message: '「' + item.label + '」太弱（太短、纯数字或常见口令）',
          detail: sceneName,
        })
      }
      const changedAt = parseIso(item.updatedAt)
      if (Number.isFinite(changedAt)) {
        const ageDays = Math.floor((now - changedAt) / DAY_MS)
        if (ageDays > STALE_DAYS) {
          const years = Math.max(1, Math.floor(ageDays / 365))
          issues.push({
            kind: 'stale-password',
            severity: 'low',
            recordId: record.id,
            title: record.title,
            scene: record.scene,
            fieldKey: item.key,
            message: '「' + item.label + '」已经 ' + String(years) + ' 年没改过',
            detail: String(ageDays),
          })
        }
      }
      if (item.value !== '') {
        const fp = passwordFingerprint(item.value)
        const bucket = byFingerprint.get(fp) ?? []
        bucket.push({ recordId: record.id, title: record.title, scene: record.scene, fieldKey: item.key })
        byFingerprint.set(fp, bucket)
      }
    }

    // 账号类记录还没有密码：提醒补全（low，不值得打扰）。
    if (record.scene === 'accounts' && passwords.length === 0) {
      issues.push({
        kind: 'no-password',
        severity: 'low',
        recordId: record.id,
        title: record.title,
        scene: record.scene,
        message: '账号记录里还没有密码',
        detail: sceneName,
      })
    }
  }

  // 复用：同一个指纹出现 2 次以上才算。
  for (const [fp, bucket] of byFingerprint) {
    if (bucket.length < 2) continue
    const groupId = fp.slice(0, 6)
    const extra = bucket.length - 1
    for (const item of bucket) {
      issues.push({
        kind: 'reused-password',
        severity: 'high',
        recordId: item.recordId,
        title: item.title,
        scene: item.scene,
        fieldKey: item.fieldKey,
        groupId,
        message: '这个密码还被另外 ' + String(extra) + ' 条记录使用',
        detail: String(bucket.length),
      })
    }
  }

  // 同场景下标题归一化后重复（抽取与手录各建了一条同一个账号）。
  const seenTitle = new Map<string, string[]>()
  for (const record of live) {
    const normalized = record.title
      .normalize('NFKC')
      .replace(/[\s·•|/\\_\-—–]+/g, '')
      .toLowerCase()
    const key = record.scene + '\u0000' + normalized
    const list = seenTitle.get(key) ?? []
    list.push(record.id)
    seenTitle.set(key, list)
  }
  for (const [, ids] of seenTitle) {
    if (ids.length < 2) continue
    for (const id of ids) {
      const record = live.find((item) => item.id === id)
      if (record === undefined) continue
      issues.push({
        kind: 'duplicate-record',
        severity: 'medium',
        recordId: record.id,
        title: record.title,
        scene: record.scene,
        message: '同一分组下有 ' + String(ids.length) + ' 条同名记录，可能重复了',
        detail: String(ids.length),
      })
    }
  }

  // 排序：high -> medium -> low，同级按 kind 聚在一起（页面直接渲染即可）。
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  issues.sort((a, b) => {
    const bySeverity = (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
    if (bySeverity !== 0) return bySeverity
    return a.kind.localeCompare(b.kind)
  })

  const counts: Record<string, number> = {}
  for (const issue of issues) counts[issue.kind] = (counts[issue.kind] ?? 0) + 1

  return {
    generatedAt: new Date(now).toISOString(),
    score: scoreOf(issues, live.length, sensitiveFields),
    totalRecords: live.length,
    sensitiveFields,
    counts,
    issues,
  }
}

/**
 * 打分（0-100）。
 *
 * 不用「问题数 / 记录数」直接相减：一条记录上挂 5 个 low 不该比 1 个 high
 * 扣得多。这里按严重度加权，再按记录数归一到每条的密度，最后压到 0-100。
 */
function scoreOf(issues: readonly VaultIssue[], recordCount: number, sensitiveFields: number): number {
  if (recordCount === 0) return 100
  const weight: Record<string, number> = { high: 12, medium: 5, low: 2 }
  let penalty = 0
  const counted = new Set<string>()
  for (const issue of issues) {
    // 同一条记录同类问题只扣一次（复用密码会在每组三条记录上各报一次）。
    const dedupeKey = issue.recordId + '\u0000' + issue.kind
    if (counted.has(dedupeKey)) continue
    counted.add(dedupeKey)
    penalty += weight[issue.severity] ?? 2
  }
  // 分母取「记录数」与「敏感字段数」的较大者，避免空库或全明文库算出畸形分。
  const scale = Math.max(recordCount, Math.min(sensitiveFields, recordCount * 4), 1)
  const density = penalty / scale
  const score = Math.round(100 - Math.min(100, density * 55))
  return Math.max(0, Math.min(100, score))
}
