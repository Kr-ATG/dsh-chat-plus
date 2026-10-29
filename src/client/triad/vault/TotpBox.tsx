/**
 * TOTP 动态验证码 —— 密码字段旁边那枚「生成验证码」。
 *
 * ── 为什么不复用 /reveal ────────────────────────────────────────────
 * 用户看密码和用户要一枚 30 秒后过期的码，是两件不同的事。用 /reveal 拿到
 * base32 密钥再在页面上算 HMAC，等于把「长期密钥」放进了浏览器；而 /totp
 * 让宿主在内部解一次、只回 6 位数字——泄露面小一个量级。所以这两个入口刻意
 * 分开：眼睛出明文，这枚按钮出一次性码，互不替代。
 *
 * ── 为什么倒计时自己走 ──────────────────────────────────────────────
 * 宿主回的是「这一枚还剩几秒」的快照。页面必须自己每秒减一（否则那圈环永远
 * 停在初次渲染的位置），余量归零时再拉一枚新的。自己不走进度条的界面在用户
 * 眼里就是「卡住了」。
 *
 * ── 为什么到期自动刷新而不是让用户点 ────────────────────────────────
 * 这个组件的使用场景是「正在登录、站在两步验证页面上」。此时用户的手在键盘
 * 上、眼睛在别处，让他在码失效的瞬间回来点一下「刷新」，等于把这个功能变成
 * 一个还需要人盯着的半成品。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { fetchVaultTotp } from './api.js'
import type { VaultTotpCode } from './api.js'
import { css } from './styles.js'
import { ClockIcon, CopyIcon, KeyIcon } from './icons.js'

/** 倒计时环（纯 SVG，一圈＝一个周期）。 */
function CountdownRing({ remaining, period }: { remaining: number; period: number }): JSX.Element {
  const radius = 11
  const circumference = 2 * Math.PI * radius
  const ratio = period > 0 ? Math.max(0, Math.min(1, remaining / period)) : 0
  // 快到期时换成警示色：这是页面上唯一需要「看一眼就知道快没了」的信息。
  const color = ratio <= 0.2 ? 'var(--v-warn)' : 'var(--v-accent)'
  return (
    <div className={css.totpRing}>
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
        <circle cx="14" cy="14" r={radius} fill="none" stroke="var(--v-border-2)" strokeWidth="2.6" />
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeDasharray={circumference + ' ' + circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className={css.totpLeft}>{String(Math.max(0, remaining))}</span>
    </div>
  )
}

/** 验证码组件属性。 */
export interface VaultTotpBoxProps {
  /** 记录 id（新建态为空串——那时还没有可算的记录，按钮不渲染）。 */
  recordId: string
  /** 字段 key。 */
  fieldKey: string
  /** 错误上报（抽屉里统一一行中文）。 */
  onError: (message: string) => void
}

export function VaultTotpBox({ recordId, fieldKey, onError }: VaultTotpBoxProps): JSX.Element {
  const [totp, setTotp] = useState<VaultTotpCode | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const [open, setOpen] = useState<boolean>(false)
  const copiedTimer = useRef<number | undefined>(undefined)

  /** 拉一枚新码。 */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setTotp(await fetchVaultTotp(recordId, fieldKey))
    } catch (reason) {
      // 失败时把上次的码清掉：一个已经过期/来源可疑的码留在屏幕上比空着更危险
      // （用户会照抄它，然后登不进去还以为是客户端的问题）。
      setTotp(null)
      onError('取验证码失败：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setLoading(false)
    }
  }, [recordId, fieldKey, onError])

  /**
   * 每秒走一格；走到 0 立刻换一枚。
   *
   * 用「递减本地状态」而不是每秒请求一次：后者会在一分钟里给宿主发 60 个请求，
   * 而且是一枚码只用一个周期的情况下。
   */
  useEffect(() => {
    if (!open) return undefined
    if (totp === null) return undefined
    if (totp.remaining > 0) {
      const timer = window.setTimeout(() => {
        setTotp((previous) => previous === null ? previous : { ...previous, remaining: previous.remaining - 1 })
      }, 1000)
      return () => { window.clearTimeout(timer) }
    }
    void load()
    return undefined
  }, [open, totp, load])

  // 关掉时把码清掉：明文数字不该在抽屉里留到下次打开。
  useEffect(() => {
    if (open) return
    setTotp(null)
    setCopied(false)
  }, [open])

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
  }, [])

  const onCopy = (): void => {
    if (totp === null) return
    void navigator.clipboard.writeText(totp.code).then(
      () => {
        setCopied(true)
        if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
        copiedTimer.current = window.setTimeout(() => { setCopied(false) }, 2000)
      },
      () => {
        // 剪贴板被拒（非安全上下文 / 无权限）不是错误，用户手动选中复制也可以。
        onError('复制没成功，请手动选中这 6 位数字复制')
      },
    )
  }

  if (recordId === '') return <></>

  if (!open) {
    return (
      <button
        type="button"
        className={css.totpBtn}
        data-role="totp-trigger"
        title="用这个字段的密钥生成 6 位动态验证码"
        onClick={() => { setOpen(true); void load() }}
      >
        <KeyIcon size={12} /> 生成验证码
      </button>
    )
  }

  return (
    <div className={css.totpBox} data-role="totp-box">
      <span style={{ display: 'inline-flex', flex: 'none', color: 'var(--v-text-3)' }}><ClockIcon size={14} /></span>
      {totp === null ? (
        <span className={css.backupHint} style={{ flex: 1 }}>
          {loading ? '正在生成…' : '没有取到验证码'}
        </span>
      ) : (
        <>
          {/* issuer / account 只在字段值是 otpauth:// 链接时存在。有一枚「我是谁的码」
              标签很重要：用户抽屉里可能同时开着好几个账号的密码。 */}
          {(totp.issuer !== undefined || totp.account !== undefined) && (
            <span className={css.backupHint} style={{ flex: 'none', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[totp.issuer, totp.account].filter((part) => part !== undefined && part !== '').join(' · ')}
            </span>
          )}
          {/* 位数由宿主给（通常 6，也有 7/8 位的）。超过 6 位时收窄字距，
              否则 8 位码会把这一行撑破、把倒计时环挤到下一行。 */}
          <span
            className={css.totpCode}
            style={totp.digits > 6 ? { letterSpacing: '1px', fontSize: 17 } : undefined}
            title="点击复制"
            onClick={onCopy}
          >
            {totp.code}
          </span>
          <CountdownRing remaining={totp.remaining} period={totp.period} />
          <button
            type="button"
            className={css.btn + ' ' + css.btnGhost}
            style={{ height: 24, padding: '0 8px' }}
            onClick={onCopy}
          >
            <CopyIcon size={12} /> {copied ? '已复制' : '复制'}
          </button>
        </>
      )}
      <button
        type="button"
        className={css.btn + ' ' + css.btnGhost}
        style={{ height: 24, padding: '0 8px', marginLeft: 'auto' }}
        onClick={() => { setOpen(false) }}
      >
        收起
      </button>
    </div>
  )
}
