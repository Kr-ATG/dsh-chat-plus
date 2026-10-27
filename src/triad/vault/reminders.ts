/**
 * dsh-vault 到期提醒：把「什么时候该动手」算成一张清单。
 *
 * ── 为什么这里只剩日期 ──────────────────────────────────────────────
 * 这一层原来是一整套「密码健康审计」：弱口令、密码复用、本该加密却明文落盘、
 * 同名重复记录、太久没改，再加一个 0-100 的分数和一个「一键批量换密」。
 * 用户 2026-10-27 明确要求把它删掉（「这个健康可以删掉，不需要，提醒可以做一
 * 个单独的窗口」）。
 *
 * 留下的恰好是那一整套里**唯一会随时间自己变坏**的东西：日期字段（证件有效
 * 期、银行卡到期、证书续期）。其余几类的共同点是「用户自己造出来的状态」——
 * 报出来只是替他数落一遍，而每一条都得他去各个站点改密，多数人看到就关掉了。
 * 日期不一样：过了那个日子，那张证 / 那张卡就真的不能用了，而没有任何人会在
 * 那之前提醒你。所以「提醒」值得一个自己的窗口，「健康分」不值得。
 *
 * ⚠ 别把这套审计加回来：它需要读全库明文（弱口令得比字符串），而提醒不需要
 * ——日期字段是非敏感字段，`store.listRecords()` 的掩码版就够。少读一次明文，
 * 这个窗口就少一个「明文出站口」。
 *
 * ── 与注入必须是同一句话 ────────────────────────────────────────────
 * 每轮对话注入的索引行尾本来就带着「有效期还剩 89 天」。那个提示和这个窗口
 * 必须永远说同一件事：阈值 90 天、已过期永远报、每条记录只看最近的那一个日期。
 * 所以判据收敛在本文件的 nearestExpiryOf 与 expiryNoteOf，inject.ts 直接复用
 * 它们——两处各算一遍，迟早会出现「窗口里没有、但模型被提示了」或者反过来。
 */

import type { VaultRecord } from './types.js'

/**
 * 临期提醒的阈值：90 天内到期才进清单。
 *
 * 再远了提示没有意义：一张三年后才到期的证件出现在列表里，只会稀释真正要紧
 * 的那几条。已过期的**永远**进（那个没有阈值可言）。
 */
export const EXPIRY_NOTE_DAYS = 90

/** 一天的毫秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 一条记录里最近的那个到期点。 */
export interface VaultExpiry {
  /** 日期字段的 key（点进记录要定位到这一行）。 */
  fieldKey: string
  /** 日期字段的显示名（「有效期」「到期日」……）。 */
  fieldLabel: string
  /** 距今天数：负数 = 已过期 |days| 天，0 = 今天到期。 */
  days: number
  /** 原始日期文本（用户要核对的就是它，不要只给人看「还剩 3 天」）。 */
  due: string
}

/** 一条到期提醒 = 一条记录 + 它最近的那个日期字段。 */
export interface VaultReminder extends VaultExpiry {
  recordId: string
  title: string
  /** 场景 id（客户端用自己那份 scenes 表翻中文名，宿主不重复维护一张表）。 */
  scene: string
  /** 是否已经过期。客户端据它分组，不必自己再判一次（免得 0 天落在哪边两处不一致）。 */
  expired: boolean
}

/** 提醒清单。 */
export interface VaultReminderReport {
  generatedAt: string
  /** 参与统计的活跃记录数（归档的不算）。 */
  totalRecords: number
  /** 已按紧急度排好：过期最久的最前，同一天按标题。 */
  reminders: VaultReminder[]
}

/**
 * 一条记录里最近的那个日期字段（没有 date 字段、或值解析不出来 → null）。
 *
 * 刻意**只取最近一个**而不是把每个临期字段都列出来：同一个记录挂两条提醒（「签
 * 发日期」「到期日期」都临期）在列表里看起来像两条不同的东西，而用户要动的手
 * 只有一处——去把那张证换掉。注入那边也只能报一句，两边口径必须一样。
 */
export function nearestExpiryOf(record: VaultRecord, now = Date.now()): VaultExpiry | null {
  let best: VaultExpiry | null = null
  for (const field of record.fields) {
    if (field.type !== 'date') continue
    const ms = Date.parse(field.value)
    // 解析不出来就跳过：老数据里可能存着「长期」「无」这类占位文本，
    // 报出来的 NaN 会污染整份清单的排序。
    if (!Number.isFinite(ms)) continue
    const days = Math.round((ms - now) / DAY_MS)
    if (best === null || days < best.days) {
      best = { fieldKey: field.key, fieldLabel: field.label, days, due: field.value }
    }
  }
  return best
}

/**
 * 生成提醒清单。
 *
 * @param records 记录（**掩码版即可**：日期字段不敏感，不需要 listRecordsRevealed）。
 * @param now 毫秒时间戳（测试注入）。
 */
export function listVaultReminders(
  records: readonly VaultRecord[],
  now = Date.now(),
): VaultReminderReport {
  const reminders: VaultReminder[] = []
  let totalRecords = 0
  for (const record of records) {
    if (record.archived === true) continue
    totalRecords += 1
    const expiry = nearestExpiryOf(record, now)
    if (expiry === null) continue
    // 已过期的永远报；未到期的只在阈值内报。
    if (expiry.days > EXPIRY_NOTE_DAYS) continue
    reminders.push({
      recordId: record.id,
      title: record.title,
      scene: record.scene,
      expired: expiry.days < 0,
      ...expiry,
    })
  }
  // 排序：已过期最久的最前（days 最小的），其次是剩余天数最少的。
  // 同一天的两条按标题，纯粹是为了让顺序稳定——否则同一份数据两次刷新会换位置。
  reminders.sort((left, right) => {
    if (left.days !== right.days) return left.days - right.days
    return left.title.localeCompare(right.title)
  })
  return {
    generatedAt: new Date(now).toISOString(),
    totalRecords,
    reminders,
  }
}

/**
 * 注入行尾的那句提示（没有 date 字段或还早 → 空串）。
 *
 * 只报「还剩 N 天 / 已过期 N 天」，不报具体日期：剩余天数是行动依据，日期是
 * 噪音。inject.ts 复用它，提醒窗口走 listVaultReminders——两条路算出来的天数
 * 来自同一个 nearestExpiryOf，不会出现「列表说 3 天、模型说 4 天」。
 */
export function expiryNoteOf(record: VaultRecord, now = Date.now()): string {
  const expiry = nearestExpiryOf(record, now)
  if (expiry === null) return ''
  if (expiry.days < 0) return expiry.fieldLabel + '已过期 ' + String(-expiry.days) + ' 天'
  if (expiry.days <= EXPIRY_NOTE_DAYS) return expiry.fieldLabel + '还剩 ' + String(expiry.days) + ' 天'
  return ''
}
