/**
 * ProviderBadge — 供应商标签：在模型选择器旁显示当前供应商（品牌图标 + 名）。
 *
 * 数据来自 ui-model-selection 的共享 ModelDirectory（`ctx.modelDirectories`），
 * 与模型选择器/`/model` 弹窗同源：`state.current.provider` 是当前供应商 id，
 * 从 `state.groups` 反查显示名；目录未加载或没有供应商时渲染空（不占位）。
 * 图标复用 webui 的内置官方供应商标（未收录的网关自动降级为首字母圆标）。
 */
import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { ProviderIcon } from '../webui/provider-icons'
import { isProxyMember, proxyTagStyle, useProxySnapshot } from '../webui/chat/proxy'
import { css } from './styles'

/** Injected business face: the session's shared model directory store. */
export interface ProviderBadgeInjected {
  directory: SnapshotStore<ModelDirectoryState>
}

/**
 * 渲染当前供应商无框标签（图标 + 名 + 走代理P标签）。
 * @param props - injected face（directory store）。
 * @returns 品牌图标 + 供应商名标签 + P 徽标，或 null（未加载/无供应商）。
 */
export function ProviderBadge({ directory }: ProviderBadgeInjected) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const proxySnapshot = useProxySnapshot()
  const providerId = state.current?.provider ?? null
  if (providerId === null) return null
  const name = state.groups.find(group => group.id === providerId)?.name ?? providerId
  const proxied = isProxyMember(proxySnapshot, providerId)
  return (
    <span className={css.providerBadge} title={`供应商：${name}${proxied ? '（走代理）' : ''}`}>
      <span className={css.providerBadgeIcon}>
        <ProviderIcon provider={providerId} name={name} size={15} />
      </span>
      {name}
      {proxied ? <span style={{ ...proxyTagStyle, marginLeft: 2 }} title="走代理">P</span> : null}
    </span>
  )
}

