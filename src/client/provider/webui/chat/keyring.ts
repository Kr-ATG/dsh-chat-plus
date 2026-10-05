/**
 * 供应商页 · 凭据密钥环（client 侧）。
 *
 * 与 proxy.ts 同构：数据走宿主 `/api/provider-hub-keys/*`（host 半身
 * modules/credential-keyring.ts），这里只负责 fetch、React 订阅与类型。
 *
 * 关键约束：**任何响应里都不出现密钥值**。host 只回configured/writable/
 * source 与一个 6 位短指纹（sha256 前 6 位，不可逆）——足够分辨「这是哪把
 * 钥匙」，又不会把秘密送到浏览器。所以页面展示与选择都基于指纹 + 用户起的
 * 名字，不基于值。
 *
 * 「切换」是 host 侧的交换：当前值进槽位、槽位值坐活动位，两边都不丢，
 * 于是可以在两把钥匙之间来回切，不会出现「切过去就回不来」。
 */

import { useEffect, useState } from 'react'

/** 密钥环 HTTP API 前缀。 */
const KEYRING_API = '/api/provider-hub-keys'

/** 一个存档槽位（视图：无值）。 */
export interface KeySlot {
  slot: number
  ref: string
  configured: boolean
  fingerprint: string | null
  label: string | null
  archivedAt: string | null
}

/** 一个引用的密钥环状态。 */
export interface KeyringState {
  ok: boolean
  ref: string
  maxSlots: number
  active: {
    configured: boolean
    writable: boolean
    source: string | null
    fingerprint: string | null
    label: string | null
  }
  slots: KeySlot[]
  message?: string
}

async function call(path: string, body?: unknown): Promise<KeyringState> {
  const response = await fetch(KEYRING_API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })
  const data: unknown = await response.json().catch(() => undefined)
  if (typeof data !== 'object' || data === null) {
    return { ok: false, ref: '', maxSlots: 0, active: { configured: false, writable: false, source: null, fingerprint: null }, slots: [], message: '密钥环接口无响应' }
  }
  return data as KeyringState
}

export const loadKeyring = (ref: string): Promise<KeyringState> =>
  call(`/state?ref=${encodeURIComponent(ref)}`)

/** 换新 key：旧值（连名字一起）入环，新值上位；`label` 是给新钥匙起的名字。 */
export const rotateKey = (ref: string, value: string, label = ''): Promise<KeyringState> =>
  call('/rotate', { ref, value, label })

/** 切到某个存档（交换语义：名字跟着钥匙一起换位）。 */
export const switchKey = (ref: string, slot: number): Promise<KeyringState> =>
  call('/switch', { ref, slot })

/** 删除某个存档。 */
export const forgetKey = (ref: string, slot: number): Promise<KeyringState> =>
  call('/forget', { ref, slot })

/** 起名 / 清名（空串清名）；`slot = 0` 表示当前正在用的钥匙。 */
export const labelKey = (ref: string, slot: number, label: string): Promise<KeyringState> =>
  call('/label', { ref, slot, label })

/** 槽位的展示名：用户起的名字 → 入环时间 → 槽位号。 */
export function slotTitle(slot: KeySlot): string {
  if (slot.label !== null && slot.label.length > 0) return slot.label
  if (slot.archivedAt !== null) {
    const date = new Date(slot.archivedAt)
    if (!Number.isNaN(date.getTime())) {
      return `${String(date.getMonth() + 1)}月${String(date.getDate())}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
  }
  return `存档 ${String(slot.slot)}`
}

/** 指纹的展示形态（无值时给占位）。 */
export function fingerprintText(value: string | null): string {
  return value === null ? '未配置' : `#${value}`
}

/**
 * 订阅一个引用的密钥环；ref 变化时重拉。
 * @param ref - 要管理的凭据引用名。
 * @returns 状态、错误与五个动作（都不返回密钥值）。
 */
export function useKeyring(ref: string | undefined): {
  state: KeyringState | null
  busy: boolean
  error: string | null
  reload: () => Promise<void>
  rotate: (value: string, label: string) => Promise<boolean>
  switchTo: (slot: number) => Promise<boolean>
  forget: (slot: number) => Promise<boolean>
  label: (slot: number, label: string) => Promise<boolean>
} {
  const [state, setState] = useState<KeyringState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ref === undefined) { setState(null); return }
    let stale = false
    setState(null)
    setError(null)
    void loadKeyring(ref).then(
      (next) => { if (!stale) setState(next) },
      (failure: unknown) => {
        if (stale) return
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
    return () => { stale = true }
  }, [ref])

  /** 跑一个写动作：统一处理 busy / 错误 / 状态回填，返回是否成功。 */
  const run = async (action: (ref: string) => Promise<KeyringState>): Promise<boolean> => {
    if (ref === undefined) return false
    setBusy(true)
    setError(null)
    try {
      const next = await action(ref)
      setState(next)
      if (next.ok !== true) { setError(next.message ?? '操作失败'); return false }
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    state,
    busy,
    error,
    reload: async () => {
      if (ref === undefined) return
      setState(await loadKeyring(ref))
    },
    rotate: (value: string, label: string) => run((r) => rotateKey(r, value, label)),
    switchTo: (slot: number) => run((r) => switchKey(r, slot)),
    forget: (slot: number) => run((r) => forgetKey(r, slot)),
    label: (slot: number, label: string) => run((r) => labelKey(r, slot, label)),
  }
}
