/**
 * dsh-memory browser half：官方 `main` 工作台页 + 侧边栏「全局面板」菜单行
 * （`sidebar.panellist`），以及 composer 输入框左端的两枚注入开关
 * （conversation.input.left：记忆注入 / 内置提示词通道）。
 * 全部数据走 host 的 /api/dsh-memory/* HTTP 路由（纯 fetch——无 typert、
 * 无 DSH 源码改动）。
 *
 * 入口 2026-10-04 改版：原先那条自绘的 `.dsh-nav-btn` 导航行（手工插进
 * sidebar.workspaces 上方的裸节点 + portal）已删除，改用官方菜单行——行本体、
 * 图标槽、hover / 选中态、rail 折叠态全由官方 SidebarRoot 渲染，点击走
 * `ctx.layout.selectPanel`，页面渲染在 `[data-slot="main"]` 里，与官方
 * 「自动化任务」页完全同座位。详见 `../panel-seat.tsx`。
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MemoryPanel, BrainIcon } from './Panel.js'
import { BuiltinToggle, MemoryToggle } from './Toggle.js'
import { createMemoryApi, type MemoryApi } from './api.js'
import { en, NS, zh, type MemoryLocaleKey } from './locales.js'
import { registerPanelSeat } from '../panel-seat.js'

export type { MemoryToggleProps } from './Toggle.js'
export type { MemoryPanelProps, MemoryTab } from './Panel.js'
export type { MemoryLocaleKey } from './locales.js'
export type { MemoryApi, MemoryEntryView, MemoryKind, ProjectView, ChangeView } from './api.js'

export { changeActionLabel } from './Panel.js'
export { BrainIcon } from './Panel.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh-memory sidebar entry and panel copy. */
    dshMemory: MemoryLocaleKey
  }
}

/** 座位 id：main 的 key 与 sidebar.panellist 的 id（官方「自动化任务」是 schedules）。 */
export const MEMORY_PANEL_ID = 'memory'

/** Contribute the workbench page (main seat + sidebar panel row) and composer toggles. */
export function applyMemoryClient(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory: dictionaries')
  // 菜单行文案走官方 locale：`resolveSlotLabel` 每次读取都重跑 thunk，
  // 语言切换后行文案自动跟随（bind 的引用按命名空间稳定）。
  const t = ctx.locale.bind(NS)

  /*
   * api 用单例：slots inject 每次渲染都会调用 inject 函数，若每次返回新对象，
   * 组件的 useEffect 依赖 api 就会随渲染重发请求（api.log 实测过一分钟 498 次
   * 的请求风暴）。createMemoryApi 是无状态 fetch 包装，单例安全。
   */
  const panelApi: MemoryApi = createMemoryApi()

  // 工作台页面：main（keyed）里的页面本体 + sidebar.panellist 的菜单行。
  ctx.effect(() => registerPanelSeat(ctx, {
    id: MEMORY_PANEL_ID,
    label: () => t('entry'),
    icon: BrainIcon,
    order: 20,
    render: (close) => createElement(MemoryPanel, { ...panelApi, onClose: close }),
  }), 'dsh-memory: main page + sidebar row')

  // composer 输入框工具行左端的两枚注入开关（resident chrome 之后，浏览器开关之前）。
  // 记忆注入与内置提示词通道各占一枚、各弹一张卡：两种不同的东西挤一张卡里，
  // 标题总有一半对不上。order 98（提示符）在 99（大脑）左侧，记忆按钮紧邻其右，
  // 位置与原来那枚大脑按钮完全一致，不动用户已有的肌肉记忆。
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
