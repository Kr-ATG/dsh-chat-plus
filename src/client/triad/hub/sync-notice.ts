/**
 * 工作台同步/上传状态小字通知管理器。
 *
 * 当发生同步或上传时，在侧栏「操作间」菜单文字后展示小字（如「已上传」/「已同步」），
 * 精准停留 1 分钟（60 秒）后自动淡出消失。刷新页面在有效期内依然能够继续保持。
 */

import { useEffect, useState } from 'react'

export const SYNC_NOTICE_EVENT = 'dsh-workbench-sync-notice-event'
export const SYNC_NOTICE_STORE = 'dsh-workbench-sync-notice-store'
export const SYNC_NOTICE_DURATION = 60 * 1000 // 1 分钟 (60 秒)

interface StoredNotice {
  text: string
  expiresAt: number
}

/** 广播一条同步/上传小字通知（停留 1 分钟）。 */
export function emitSyncNotice(text: string): void {
  if (typeof window === 'undefined') return
  const expiresAt = Date.now() + SYNC_NOTICE_DURATION
  const payload: StoredNotice = { text, expiresAt }
  try {
    localStorage.setItem(SYNC_NOTICE_STORE, JSON.stringify(payload))
  } catch {}
  window.dispatchEvent(new CustomEvent<StoredNotice>(SYNC_NOTICE_EVENT, { detail: payload }))
}

/** 读取当前有效的小字通知（过期返回 null）。 */
export function readCurrentSyncNotice(): { text: string; remainingMs: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SYNC_NOTICE_STORE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredNotice
    if (!parsed || typeof parsed.expiresAt !== 'number' || typeof parsed.text !== 'string') return null
    const remaining = parsed.expiresAt - Date.now()
    if (remaining > 0) {
      return { text: parsed.text, remainingMs: remaining }
    }
    // 已过期
    localStorage.removeItem(SYNC_NOTICE_STORE)
  } catch {}
  return null
}

/** Hook：监听并驱动小字通知在「操作间」菜单文字后显示，精确停留 1 分钟。 */
export function useSyncNotice(): string | null {
  const [notice, setNotice] = useState<string | null>(() => {
    const cur = readCurrentSyncNotice()
    return cur ? cur.text : null
  })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleClear = (remainingMs: number): void => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        setNotice(null)
        try { localStorage.removeItem(SYNC_NOTICE_STORE) } catch {}
      }, remainingMs)
    }

    // 初始检查
    const initial = readCurrentSyncNotice()
    if (initial) {
      scheduleClear(initial.remainingMs)
    }

    // 监听本地事件派发
    const onNotice = (event: Event): void => {
      const detail = (event as CustomEvent<StoredNotice>).detail
      if (detail && typeof detail.text === 'string') {
        setNotice(detail.text)
        scheduleClear(detail.expiresAt - Date.now())
      }
    }

    window.addEventListener(SYNC_NOTICE_EVENT, onNotice)

    // 定期轮询后台同步状态（针对后台自动双向同步完成的情况）
    const pollStatus = async (): Promise<void> => {
      try {
        const resp = await fetch('/api/triad/workbench-sync/status')
        if (!resp.ok) return
        const body = await resp.json() as { ok: boolean; status?: { lastUploadedAt?: string; lastPulledAt?: string } }
        if (!body.ok || !body.status) return
        const now = Date.now()
        const uploadDiff = body.status.lastUploadedAt ? now - new Date(body.status.lastUploadedAt).getTime() : Infinity
        const pullDiff = body.status.lastPulledAt ? now - new Date(body.status.lastPulledAt).getTime() : Infinity

        if (uploadDiff < SYNC_NOTICE_DURATION && uploadDiff < pullDiff) {
          const cur = readCurrentSyncNotice()
          if (!cur) {
            emitSyncNotice('已上传')
          }
        } else if (pullDiff < SYNC_NOTICE_DURATION) {
          const cur = readCurrentSyncNotice()
          if (!cur) {
            emitSyncNotice('已同步')
          }
        }
      } catch {}
    }

    const pollTimer = setInterval(pollStatus, 15_000)

    return () => {
      if (timer !== null) clearTimeout(timer)
      clearInterval(pollTimer)
      window.removeEventListener(SYNC_NOTICE_EVENT, onNotice)
    }
  }, [])

  return notice
}
