/**
 * dsh-chat-plus — 客户端功能门（apply 时判断 + React 渲染期判断）。
 *
 * 两种使用方式，对应两类功能：
 *
 *   featureMount(ctx, 'card.html', 'HTML 卡片', () => { ...挂载... })
 *     —— 在插件 apply 时决定要不要执行这段挂载。适合「注册一个 slot / 装一个
 *        全局监听」这种一次性动作；拨完开关需要刷新页面（面板上会标「刷新页面」）。
 *
 *   <FeatureGate feature="view.panel-memory">...</FeatureGate>
 *     —— 组件内部判断，订阅 store；用户拨完立刻生效，不需要刷新。
 *        适合右栏卡片、按钮、对话流里的常驻卡这种每次渲染都会重新求值的界面。
 *
 * 第三种情况（纯 DOM / 非 React 的全局副作用）用 onFeatureChange 自己处理：
 * 关闭时摘掉属性 / 断开轮询，打开时恢复。见 ui-font 与 browser-flag。
 *
 * @module
 */

import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { featureEnabledNow, subscribeFeatures, useFeature } from './store.ts'

/** React 渲染期门：关掉时返回 null。 */
export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }): JSX.Element | null {
  const enabled = useFeature(feature)
  return enabled ? <>{children}</> : null
}

/**
 * apply 期门：只有开关开着才执行挂载函数。
 *
 * @param ctx - client 上下文（用于登记 effect 回收）。
 * @param feature - 功能 id。
 * @param label - 失败日志里的模块名。
 * @param mount - 真正的挂载动作。
 */
export function featureMount(ctx: ClientContext, feature: string, label: string, mount: () => void): void {
  if (!featureEnabledNow(feature)) return
  try {
    mount()
  } catch (error) {
    console.warn(`[dsh-chat-plus] ${label} 挂载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 监听「某个开关」的变化（非 React 副作用用）。
 *
 * @param feature - 功能 id。
 * @param listener - 值变化时回调（首次订阅不回调）。
 * @returns 取消订阅。
 */
export function onFeatureChange(feature: string, listener: (enabled: boolean) => void): () => void {
  let previous = featureEnabledNow(feature)
  return subscribeFeatures(() => {
    const next = featureEnabledNow(feature)
    if (next === previous) return
    previous = next
    try {
      listener(next)
    } catch (error) {
      console.error(`[dsh-chat-plus] feature listener ${feature} failed:`, error)
    }
  })
}

export { featureEnabledNow, useFeature }
