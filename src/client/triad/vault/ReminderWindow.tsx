/**
 * 到期提醒窗口 —— 一个独立的弹窗，只回答「接下来哪几样东西会过期」。
 *
 * ── 为什么从「密码健康」改成这个 ────────────────────────────────────
 * 这一屏原来是一份密码健康审计：0-100 的分数、弱口令 / 复用 / 明文落盘 / 同名
 * 重复四类问题、以及一个「一键批量换密」。用户 2026-10-27 明确说「这个健康可以
 * 删掉，不需要，提醒可以做一个单独的窗口」。
 *
 * 删得掉的底气在于：那一整套里**只有日期会自己变坏**。弱口令和复用是用户自己
 * 造出来的状态，报出来只是替他数落一遍，而每一条都得他去各个站点手动改密——
 * 大多数人看到那一屏就关掉了。日期不一样：过了那个日子，那张证 / 那张卡就真的
 * 不能用了，而没有任何人会在那之前提醒你。所以「提醒」值得一个自己的窗口。
 *
 * ── 三档，不是四类 ──────────────────────────────────────────────────
 * 分组只按**紧急度**分，不按「证件 / 银行卡」这类类型分：
 *   · 已经过期 —— 红。这一档永远排最前，因为它已经出事了。
 *   · 30 天内  —— 黄。这才是「要动手」的那一批。
 *   · 90 天内  —— 灰。看得见，但不催。
 * 判据（90 天阈值、每条记录只看最近的那个日期、已过期永远报）全部来自宿主侧
 * reminders.ts，与每轮对话注入行尾那句「还剩 N 天」是同一个函数——两处各算一遍
 * 迟早会打架。
 *
 * ── 点一行干什么 ────────────────────────────────────────────────────
 * 点开那条记录（父级负责关窗口 + 原地展开），用户在那里能看到完整的日期、
 * 也能直接改。这一屏是只读的：它没有任何写操作，所以也不需要二次确认。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { fetchVaultReminders, formatReminderDays, formatVaultStamp } from './api.js'
import type { VaultReminder, VaultReminderReport } from './api.js'
import { css } from './styles.js'
import { AlertIcon, CheckIcon, CloseIcon, ClockIcon, RefreshIcon } from './icons.js'

/**
 * 紧急度档位。
 *
 * 30 天这个分界刻意与注入侧「还剩 N 天」的语感对齐：一个月内到期的东西才值得
 * 标黄，再远了标黄只会让人对黄色麻木。
 */
type Level = 'expired' | 'soon' | 'later'

const LEVELS: { key: Level; label: string }[] = [
  { key: 'expired', label: '已经过期' },
  { key: 'soon', label: '30 天内到期' },
  { key: 'later', label: '90 天内到期' },
]

/** 30 天以内算「马上要到」。 */
const SOON_DAYS = 30

/**
 * 一条提醒落在哪一档。
 *
 * 判据只有 days 一个数（宿主已经算好并下发），页面不再看 expired 字段——
 * 两个判据并存时，「今天到期」这种边界值必然在某一处被算进另一档。
 */
function levelOf(reminder: VaultReminder): Level {
  if (reminder.days < 0) return 'expired'
  if (reminder.days <= SOON_DAYS) return 'soon'
  return 'later'
}

export interface VaultReminderWindowProps {
  /** 点某一条 → 跳到那条记录（父级负责关窗口并原地展开那条记录）。 */
  onOpenRecord: (recordId: string) => void
  /** 关闭窗口。 */
  onClose: () => void
}

/** 一条提醒（可点，跳到记录）。 */
function ReminderItem({ reminder, onOpenRecord }: { reminder: VaultReminder; onOpenRecord: (recordId: string) => void }): JSX.Element {
  const level = levelOf(reminder)
  return (
    <button
      type="button"
      className={css.remindItem}
      onClick={() => { onOpenRecord(reminder.recordId) }}
    >
      <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1, color: 'var(--v-text-3)' }}>
        {level === 'expired' ? <AlertIcon size={14} /> : <ClockIcon size={14} />}
      </span>
      <span className={css.remindItemMain}>
        <span className={css.remindItemTitle}>
          {reminder.title === '' ? '（未命名）' : reminder.title}
        </span>
        <span className={css.remindItemMeta}>{reminder.fieldLabel}</span>
        {/* 具体日期必须露出来：用户要核对的正是「是不是这一天」，
            只给「还剩 3 天」他没法确认档案里存的日子对不对。 */}
        {reminder.due !== '' && <span className={css.remindDue}>{reminder.due}</span>}
      </span>
      <span className={css.remindItemDays} data-level={level}>
        {formatReminderDays(reminder.days)}
      </span>
    </button>
  )
}

export function VaultReminderWindow({ onOpenRecord, onClose }: VaultReminderWindowProps): JSX.Element {
  const [report, setReport] = useState<VaultReminderReport | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')

  /**
   * 拉清单。
   *
   * 首次失败 → 整块错误态（此时空白窗口没有别的内容可看）；
   * 已有数据再刷新失败 → 只出一行提示，保留上次的清单（把用户正在看的东西
   * 换成红屏是最差的选择）。
   */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setReport(await fetchVaultReminders())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Esc 关闭。Panel 那边也有一份同样的监听（它要按层叠顺序裁决关哪一层），
  // 两处都调 onClose 是幂等的：谁先跑都只是把同一个 state 置回关闭。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  /** 按紧急度分组（组内保持宿主给的顺序：它已经按剩余天数排好了）。 */
  const groups = useMemo(() => {
    const reminders = report?.reminders ?? []
    return LEVELS.map((level) => ({
      ...level,
      items: reminders.filter((reminder) => levelOf(reminder) === level.key),
    })).filter((group) => group.items.length > 0)
  }, [report])

  const total = report?.reminders.length ?? 0
  const expiredCount = useMemo(
    () => (report?.reminders ?? []).filter((reminder) => reminder.days < 0).length,
    [report],
  )
  const soonCount = useMemo(
    () => (report?.reminders ?? []).filter((reminder) => levelOf(reminder) === 'soon').length,
    [report],
  )

  const body = loading && report === null
    ? (
      <div className={css.panelBody}>
        {[0, 1, 2].map((index) => (
          <div key={index} className={css.skeleton} style={{ height: 60 }} />
        ))}
      </div>
    )
    : error !== '' && report === null
      ? (
        <div className={css.panelBody}>
          <div className={css.error}>
            <span style={{ display: 'inline-flex', flex: 'none' }}><AlertIcon size={15} /></span>
            <div className={css.errorText}>读取提醒失败：{error}</div>
            <button type="button" className={css.errorRetry} onClick={() => { void load() }}>
              重试
            </button>
          </div>
          <div className={css.emptyText} style={{ color: 'var(--v-text-3)', fontSize: 12 }}>
            这一项只读日期字段，失败不影响你的档案数据。
          </div>
        </div>
      )
      : (
        <div className={css.panelBody}>
          {error !== '' && (
            <div className={css.error}>
              <span style={{ display: 'inline-flex', flex: 'none' }}><AlertIcon size={15} /></span>
              <div className={css.errorText}>刷新失败：{error}（下面是上次的结果）</div>
            </div>
          )}

          {report !== null && (
            <>
              {/* 顶部一句话结论 + 三个数。这一屏没有分数：分数需要一套打分口径，
                  而「有几件事要办」本身就是全部结论。 */}
              <div className={css.remindHead}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '19px' }}>
                    {total === 0 ? '没有要到期的东西' : '有 ' + String(total) + ' 项要到期了'}
                  </div>
                  <div className={css.remindFacts}>
                    <span className={css.remindFact}>
                      <span className={css.remindFactNum}>{String(expiredCount)}</span> 项已过期
                    </span>
                    <span className={css.remindFact}>
                      <span className={css.remindFactNum}>{String(soonCount)}</span> 项 30 天内
                    </span>
                    <span className={css.remindFact}>
                      共 <span className={css.remindFactNum}>{String(report.totalRecords)}</span> 条记录
                    </span>
                  </div>
                  {report.generatedAt !== '' && (
                    <div className={css.backupHint}>检查于 {formatVaultStamp(report.generatedAt)}</div>
                  )}
                </div>
              </div>

              {total === 0 && (
                <div className={css.empty}>
                  <span className={css.emptyIcon}><CheckIcon size={15} /></span>
                  <span className={css.emptyText}>
                    90 天内没有要到期的东西。
                    <span className={css.emptyHint}>
                      证件、银行卡这类有「有效期」字段的记录，到期前 90 天会出现在这里。
                    </span>
                  </span>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.key} className={css.remindGroup}>
                  <div className={css.remindGroupHead}>
                    <span className={css.remindLevel} data-level={group.key}>{group.label}</span>
                    <span style={{ fontWeight: 500 }}>{String(group.items.length)}</span>
                  </div>
                  {group.items.map((reminder) => (
                    <ReminderItem
                      key={reminder.recordId + ':' + reminder.fieldKey}
                      reminder={reminder}
                      onOpenRecord={onOpenRecord}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )

  // 外壳（居中弹窗）由 Panel 的 VaultModal 提供，这里只出头部 + 内容。
  return (
    <>
      <div className={css.panelHead}>
        <span style={{ display: 'inline-flex', color: 'var(--v-text-2)' }}><ClockIcon size={16} /></span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' }}>
          到期提醒
        </div>
        <button
          type="button"
          className={css.panelClose}
          title="重新检查"
          aria-label="重新检查"
          disabled={loading}
          onClick={() => { void load() }}
        >
          <RefreshIcon size={14} />
        </button>
        <button type="button" className={css.panelClose} aria-label="关闭到期提醒" title="关闭（Esc）" onClick={onClose}>
          <CloseIcon size={15} />
        </button>
      </div>
      {body}
    </>
  )
}

/**
 * 给头部入口用的「待处理条数」。
 *
 * 单独导出一个纯函数而不是让 Panel 自己算：条数的口径（过期 + 30 天内 + 90 天
 * 内全算）是这份清单的一部分，散到调用方去加起来，两处迟早不一致。
 */
export function reminderCount(report: VaultReminderReport | null): number {
  if (report === null) return 0
  return report.reminders.length
}

/**
 * 最紧急的档位（决定头部按钮配色）。
 *
 * 返回的是**配色档位**而不是 Level，调用方不必再映射一次：
 * 有已过期的 → bad，只有 30 天内的 → warn，只有 90 天内的 → low，空清单 → good。
 */
export function reminderTone(report: VaultReminderReport | null): 'good' | 'warn' | 'bad' | 'low' {
  if (report === null || report.reminders.length === 0) return 'good'
  if (report.reminders.some((reminder) => reminder.days < 0)) return 'bad'
  if (report.reminders.some((reminder) => reminder.days <= SOON_DAYS)) return 'warn'
  return 'low'
}
