/**
 * dsh-memory browser half：侧边栏导航行入口（sidebar-nav memory 槽位，
 * 「自动化」菜单下方）与 composer 输入框左端的两枚注入开关
 * （conversation.input.left：记忆注入 / 内置提示词通道）。
 * 全部数据走 host 的 /api/dsh-memory/* HTTP 路由（纯 fetch——无 typert、
 * 无 DSH 源码改动）。
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MemoryNavApp } from './Entry.js'
import { BuiltinToggle, MemoryToggle } from './Toggle.js'
import { createMemoryApi, type MemoryApi } from './api.js'
import { en, NS, zh, type MemoryLocaleKey } from './locales.js'
import { ensureNavMount } from '../sidebar-nav.js'

export type { MemoryToggleProps } from './Toggle.js'
export type { MemoryPanelProps, MemoryTab } from './Panel.js'
export type { MemoryLocaleKey } from './locales.js'
export type { MemoryApi, MemoryEntryView, MemoryKind, ProjectView, ChangeView } from './api.js'

export { changeActionLabel } from './Panel.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh-memory sidebar entry and panel copy. */
    dshMemory: MemoryLocaleKey
  }
}

/** Contribute the nav-row entry wired to the dsh-memory HTTP API. */
export function applyMemoryClient(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory: dictionaries')

  // 导航行入口：DOM 注入 + portal（与 usage/skills 入口同一 host、固定槽位顺序）。
  ctx.effect(() => {
    ensureNavMount()
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(createElement(MemoryNavApp))
    return () => { root.unmount() }
  }, 'dsh-memory: nav entry')

  // composer 输入框工具行左端的两枚注入开关（resident chrome 之后，浏览器开关之前）。
  // 记忆注入与内置提示词通道各占一枚、各弹一张卡：两种不同的东西挤一张卡里，
  // 标题总有一半对不上。order 98（提示符）在 99（大脑）左侧，记忆按钮紧邻其右，
  // 位置与原来那枚大脑按钮完全一致，不动用户已有的肌肉记忆。
  //
  // api 用单例：slots inject 每次渲染都会调用 inject 函数，若每次返回新对象，
  // 组件的 useEffect 依赖 api 就会随渲染重发 /inject-state（api.log 实测过
  // 一分钟 498 次的请求风暴）。createMemoryApi 是无状态 fetch 包装，单例安全。
  const panelApi = createMemoryApi()

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-memory-builtin-toggle',
    order: 98,
    locale: NS,
    inject: () => panelApi,
  }, BuiltinToggle))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-memory-inject-toggle',
    order: 99,
    locale: NS,
    inject: () => panelApi,
  }, MemoryToggle))
}
