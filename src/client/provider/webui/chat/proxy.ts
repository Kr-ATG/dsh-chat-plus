/**
 * 供应商页代理共享通道（client 侧）。
 *
 * 数据仍走宿主 `/api/dsh-proxy/*`（`network-proxy` 命名空间，沿用旧配置）：
 * 通用设置卡只管总开关 + 代理地址，每家供应商卡片右侧的「代理」开关管自己
 * 是否进名单（`providers`），`all` 模式下关掉某家时自动迁移成 `selected`
 *（全集减自己）。变更后广播 {@link PROXY_CHANGED}，列表 P 标、详情开关、
 * 通用卡各自刷新。
 */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

/** 代理变更广播（window CustomEvent 名）。 */
export const PROXY_CHANGED = 'dsh-provider-hub:proxy-changed'

/** `/api/dsh-proxy/state|set` 的视图投影。 */
export interface ProxySnapshot {
  enabled: boolean
  url: string
  active: boolean
  mode: 'all' | 'selected'
  /** 名单里的 route key（可能含已失效的，见 stale）。 */
  providers: string[]
  /**
   * 名单里**解析不出域名**的 key（供应商被删 / 改名后留下的死条目）。
   * 这些 key 静默不代理——界面必须把它们排除出「N 家走代理」的计数，
   * 否则会出现「明明只勾了两家、标签却写 5 家」这种对不上的数字。
   */
  stale: string[]
  /** 名单里真实解析出的 hostname（实际生效的域名）。 */
  hosts: string[]
}

const BASE = '/api/dsh-proxy'

function toSnapshot(payload: any): ProxySnapshot | null {
  if (payload === null || typeof payload !== 'object') return null
  return {
    enabled: payload.enabled === true,
    url: typeof payload.url === 'string' ? payload.url : '',
    active: payload.active === true,
    mode: payload.mode === 'selected' ? 'selected' : 'all',
    providers: Array.isArray(payload.providers)
      ? payload.providers.filter((p: unknown): p is string => typeof p === 'string')
      : [],
    stale: Array.isArray(payload.stale)
      ? payload.stale.filter((p: unknown): p is string => typeof p === 'string')
      : [],
    hosts: Array.isArray(payload.hosts)
      ? payload.hosts.filter((p: unknown): p is string => typeof p === 'string')
      : [],
  }
}

/** 读代理快照；接口不可用返回 null。 */
export async function loadProxySnapshot(): Promise<ProxySnapshot | null> {
  try {
    const r = await fetch(BASE + '/state', { cache: 'no-store' })
    const d: any = await r.json()
    if (d === null || typeof d !== 'object' || d.ok !== true) return null
    return toSnapshot(d)
  } catch {
    return null
  }
}

/** llm-pi-ai 下全部厂商 route key（`all`→`selected` 迁移时做全集用）；失败返回 null。 */
export async function loadProxyProviderKeys(): Promise<string[] | null> {
  try {
    const r = await fetch(BASE + '/providers', { cache: 'no-store' })
    const d: any = await r.json()
    if (d === null || typeof d !== 'object' || !Array.isArray(d.providers)) return null
    return d.providers
      .map((p: any) => p?.key)
      .filter((k: unknown): k is string => typeof k === 'string' && k.length > 0)
  } catch {
    return null
  }
}

/** POST /set（缺席字段服务端沿用当前值）；成功广播并返回新快照。 */
export async function saveProxy(patch: {
  enabled?: boolean
  url?: string
  mode?: 'all' | 'selected'
  providers?: string[]
}): Promise<{ ok: true; snapshot: ProxySnapshot } | { ok: false; message: string }> {
  try {
    const r = await fetch(BASE + '/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const d: any = await r.json()
    if (d === null || typeof d !== 'object' || d.ok !== true) {
      return { ok: false, message: String(d?.message ?? d?.error ?? '设置失败') }
    }
    const snapshot = toSnapshot(d)
    if (snapshot === null) return { ok: false, message: '设置失败' }
    emitProxyChanged()
    return { ok: true, snapshot }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** 广播代理变更。 */
export function emitProxyChanged(): void {
  window.dispatchEvent(new CustomEvent(PROXY_CHANGED))
}

/** React hook：实时订阅代理状态快照。 */
export function useProxySnapshot(): ProxySnapshot | null {
  const [snapshot, setSnapshot] = useState<ProxySnapshot | null>(null)
  useEffect(() => {
    let unmounted = false
    const refresh = () => {
      loadProxySnapshot().then((s) => {
        if (!unmounted && s) setSnapshot(s)
      })
    }
    refresh()
    window.addEventListener(PROXY_CHANGED, refresh)
    return () => {
      unmounted = true
      window.removeEventListener(PROXY_CHANGED, refresh)
    }
  }, [])
  return snapshot
}

/** 该供应商是否实际走代理（总开关开 + 全局模式或名单命中）。 */
export function isProxied(snapshot: ProxySnapshot | null, key: string | undefined): boolean {
  if (snapshot === null || key === undefined || !snapshot.enabled) return false
  return snapshot.mode === 'all' || snapshot.providers.includes(key)
}

/** 名单成员（是否被勾选为走代理；不受总开关是否开启影响）。 */
export function isProxyMember(snapshot: ProxySnapshot | null, key: string | undefined): boolean {
  if (snapshot === null || key === undefined) return false
  return snapshot.mode === 'all' || snapshot.providers.includes(key)
}

/**
 * 代理键：宿主只按 `llm-pi-ai` 设置 `providers` 表解析域名，只有 pi-ai
 * 路由可挂代理（`settingsPath = ['providers', route]`，正是宿主查的那把 key）。
 */
export function proxyKeyOf(target: {
  settingsNs: string
  settingsPath: readonly unknown[]
  provider: string
}): string | undefined {
  if (target.settingsNs !== 'llm-pi-ai') return undefined
  const path = target.settingsPath
  if (path.length >= 2 && path[0] === 'providers' && typeof path[1] === 'string' && path[1].length > 0) {
    return path[1]
  }
  return target.provider.length > 0 ? target.provider : undefined
}

/**
 * 供应商卡片右侧开关：host 侧 `/api/dsh-proxy/member` 做读-改-写。
 *
 * 此前是这里 GET 快照 → 本地改 → POST 整份名单：两个卡片同时切换时后一次拿
 * 自己那份过期快照整份覆盖，前一次的改动凭空消失。现在语义（加入名单 / all
 * 模式迁移成全集减自己）整个搬进 host，客户端只发「这一家开或关」。
 */
export async function setProviderProxied(
  key: string,
  on: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const r = await fetch(BASE + '/member', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, on }),
    })
    const d: any = await r.json()
    if (d === null || typeof d !== 'object' || d.ok !== true) {
      return { ok: false, message: String(d?.message ?? d?.error ?? '设置失败') }
    }
    emitProxyChanged()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** P 标签徽标样式：鲜明品牌蓝徽标，圆角矩形，加粗居中。 */
export const proxyTagStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 16,
  minWidth: 16,
  padding: '0 4px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
  color: '#fff',
  background: 'var(--dsw-alias-state-business-primary, #3370ff)',
  flexShrink: 0,
  userSelect: 'none',
}

