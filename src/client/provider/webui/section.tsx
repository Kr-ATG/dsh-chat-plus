/**
 * dsh-chat-plus — 「供应商」工作台页面（原 dsh-provider-hub 的独立设置页，
 * 2026-10-05 融合进 dsh-chat-plus 并迁进工作台 Tab）。
 *
 * 左导航（ChatProviderList：已配置/目录预设/添加自定义）+ 右详情
 * （ChatProviderDetail：API Key、Base URL、协议、模型列表 + 获取可用模型 +
 * 🔍 检测推理等级）。底部含辅助视觉（含自动降级开关）/ 生图 / 生视频三块。
 *
 * 与旧「设置 → 供应商」整页的差别只有两处：
 *   1. 座位从 `settings.section` 换成工作台 Tab（由 WorkbenchPanel 渲染，
 *      `embedded` 形态：不自己画头部、不自己撑满 main）；
 *   2. 官方「模型」设置页**不再被隐藏**（原 hideOfficialModelsNav 已删除）。
 *
 * 推理检测走本插件新版 `/api/detect-capability`：默认先测 max，网关拒绝且
 * 错误里带合法值表时直接按表填入并自动落盘（含 OpenAI 系 off:'none'）。
 * createElement 风格（不转 JSX，由 esbuild 处理）。
 */
import { createElement as h, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { ChatProviderList } from './chat/ChatProviderList.tsx'
import { ChatProviderDetail } from './chat/ChatProviderDetail.tsx'
import type { ChatProviderMode, ChatProviderTarget } from './chat/ChatProviderDetail.tsx'
import { ModelsSettingsStore, deriveKeyRef } from './chat/store.ts'
import type { ModelsSettingsState, ProviderRow } from './chat/store.ts'
import { injectStyles } from './styles.ts'
import { VisionModelBlock } from './vision/VisionModelBlock.tsx'
import { ImageModelBlock } from './image/ImageModelBlock.tsx'
import { VideoModelBlock } from './video/VideoModelBlock.tsx'
import { createLegacyApi } from './api-adapter.ts'
import { getClientCtx, getService } from '../../client-ctx.js'

/** 供应商页需要的依赖（工作台面板构造后经 props 传入）。 */
export interface SupplierInjected {
  controller: ModelsSettingsStore
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
}

/**
 * 构造供应商页依赖（wire 面 + 快照 store + 三处远程事件订阅）。
 *
 * 必须在 React 里用 `useMemo` 调一次：旧实现挂在 `ctx.effect` 上随插件
 * 生命周期建 store，现在页面随 Tab 切换挂载/卸载，store 跟着页面走，
 * 订阅由调用方的 useEffect 负责回收。
 * @param ctx - client root context。
 * @returns 依赖对象与订阅清理函数。
 */
export function createSupplierInjected(ctx: ClientContext): { injected: SupplierInjected; dispose: () => void } {
  // wire 面经适配器装进旧信封（connection.api 已不存在，见 api-adapter）。
  //
  // 取服务必须用 `ctx.get('remote.llm')` 这种**完整子服务名**逐个读：cordis 的
  // ctx 对 `remote.llm` / `remote.settings` / `remote.credentials` 各自做
  // inject 检查，先取 `remote` 再点 `.llm` 会抛
  // `cannot get property "remote.llm" without inject`（页面实测）。
  const api = createLegacyApi({
    remote: {
      settings: getService('remote.settings'),
      credentials: getService('remote.credentials'),
      llm: getService('remote.llm'),
      $on: remoteOn(),
    },
    configForms: getService('configForms'),
    settingsScope: getService('settingsScope'),
  } as any)
  const controller = new ModelsSettingsStore(api)
  const refresh = (): void => {
    if (controller.store.getSnapshot().status === 'idle') return
    void controller.load()
  }
  const on = remoteOn()
  const disposers = [
    on?.('settings/document-updated', refresh),
    on?.('credentials/reference-updated', refresh),
    on?.('llm/adapters-updated', refresh),
  ]
  return {
    injected: { controller, api },
    dispose: () => { for (const dispose of disposers) { try { dispose?.() } catch { /* 忽略 */ } } },
  }
}

/**
 * 取 `remote.$on`（事件订阅面）。
 *
 * `$on` 是 remote 服务自身的方法而不是子服务，但在它的对象上做属性访问仍可能
 * 撞上 cordis 的 inject 代理，所以单独包一层 try/catch；取不到时页面只是不再
 * 自动刷新，仍可手动重试。
 * @returns 事件订阅函数，或 undefined。
 */
function remoteOn(): ((event: string, fn: () => void) => () => void) | undefined {
  try {
    const remote = getService<any>('remote')
    return typeof remote?.$on === 'function' ? remote.$on.bind(remote) : undefined
  } catch {
    return undefined
  }
}

/** uSES 桥：把 snapshot store 订阅成 React 状态。 */
function useSnapshot<T>(store: { subscribe(fn: () => void): () => void; getSnapshot(): T }): T {
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getSnapshot(),
  )
}

/** 从 ProviderRow 构造详情目标（credentialRef 仅页面惯例引用下可写才带上）。 */
function targetOf(row: ProviderRow, mode: ChatProviderMode): ChatProviderTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef && row.credential?.configured === true && row.credential.writable ? managedRef : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...(credentialRef === undefined ? {} : { credentialRef }),
    ...(row.entry.declared === true ? { declared: true } : {}),
    mode,
  }
}

/** 自定义提供方目标：route id 由卡片内输入，写入 pi-ai 命名空间。 */
const CUSTOM_TARGET: ChatProviderTarget = {
  provider: '',
  displayName: '',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers'],
  mode: 'custom',
}

/** 左导航宽度：展开 232 / 收窄 52（滑动过渡由 .phub-nav 的 transition 承担）。 */
const NAV_WIDTH = 232
const NAV_WIDTH_COLLAPSED = 52

const hubLayoutStyle: Record<string, string | number> = {
  display: 'flex', alignItems: 'stretch', gap: 16, minWidth: 0, width: '100%',
}

const detailColStyle: Record<string, string | number> = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
}

const detailPanelStyle: Record<string, string | number> = {
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)', borderRadius: 12,
  padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: 1,
}

/* 右侧面板工具条：关闭按钮右对齐一行（不占视觉噪音）。 */
const panelToolbarStyle: Record<string, string | number> = {
  display: 'flex', justifyContent: 'flex-end', marginBottom: -6,
}

/* 右侧面板关闭按钮：28×28 图标钮。 */
const panelCloseBtnStyle: Record<string, string | number> = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, padding: 0,
  border: 'none', borderRadius: 6, background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
  fontSize: 14, lineHeight: '20px', cursor: 'pointer', flex: 'none',
}

const placeholderStyle: Record<string, string | number> = {
  flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 4, border: '1px dashed var(--dsw-alias-border-l3, #c9cdd4)',
  borderRadius: 12, color: 'var(--dsw-alias-label-tertiary, #8f959e)', textAlign: 'center', padding: 24,
}

/**
 * 渲染「供应商」工作台页面（embedded 形态）。
 *
 * `ctx` 缺省时从 window 全局取（工作台面板不持有 ctx，见 client-ctx.ts）。
 * 依赖建好前先渲染一个轻量骨架，避免闪一次空白。
 * @param props - client root context（可选）。
 * @returns 供应商页面。
 */
export function SupplierSection(props: { ctx?: ClientContext } = {}): unknown {
  // ctx 来源：props 显式传入 → 插件入口登记的根 ctx（client-ctx.ts）。
  // 工作台面板不持有 ctx，走后者；读不到就渲染 null（不炸整页）。
  const ctx = props.ctx ?? (getClientCtx() as unknown as ClientContext | null) ?? undefined
  const built = useMemo(() => (ctx === undefined ? undefined : createSupplierInjected(ctx)), [ctx])
  useEffect(() => {
    injectStyles()
  }, [])
  useEffect(() => () => { built?.dispose() }, [built])
  if (built === undefined) return null
  return h(Loaded, { injected: built.injected })
}

function Loaded({ injected }: { injected: SupplierInjected }): unknown {
  const { controller, api } = injected
  const state: ModelsSettingsState = useSnapshot(controller.store)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [addingCustom, setAddingCustom] = useState(false)
  // 左栏收窄态：选中供应商后自动收窄为纯图标，右侧模型列表变宽；关闭详情时还原。
  const [navCollapsed, setNavCollapsed] = useState(false)
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])
  const closeDetail = (changed: boolean): void => {
    setSelected(undefined)
    setAddingCustom(false)
    setNavCollapsed(false)
    if (changed) void controller.load()
  }
  const selectedRow = selected !== undefined ? state.rows.find(r => r.entry.provider === selected) : undefined
  let detail: unknown
  if (addingCustom) {
    detail = h(ChatProviderDetail, { key: 'custom', state, target: CUSTOM_TARGET, api, onClose: closeDetail })
  } else if (selectedRow !== undefined) {
    detail = h(ChatProviderDetail, {
      key: selectedRow.entry.provider, state,
      target: targetOf(selectedRow, selectedRow.configured ? 'edit' : 'adopt'),
      api, onClose: closeDetail,
    })
  } else {
    detail = h('div', { style: placeholderStyle }, [
      h('p', { key: 'a', style: { margin: 0, fontSize: 13, fontWeight: 500 } }, '从左侧选择一个提供方'),
      h('p', { key: 'b', style: { margin: 0, fontSize: 12 } }, '查看或编辑 API Key、Base URL 与模型列表'),
    ])
  }
  const hasDetail = addingCustom || selectedRow !== undefined
  // 详情滑入：key 随目标变化重播 phub-slide-in（打开/切换/关闭回占位都滑一次）。
  const animKey = addingCustom ? 'custom' : (selected ?? 'placeholder')
  const animDetail = h('div', { key: `anim:${animKey}`, className: 'phub-detail-in' }, [detail])
  const panelBody = hasDetail
    ? [
      h('div', { key: 'toolbar', style: panelToolbarStyle }, [
        h('button', {
          key: 'close', type: 'button', title: '关闭', 'aria-label': '关闭',
          style: panelCloseBtnStyle, onClick: () => { closeDetail(false) },
        }, '✕'),
      ]),
      animDetail,
    ]
    : [animDetail]
  // 左栏宽度：工作台里不再受设置弹窗宽度约束，展开 232 / 收窄 52。
  const navStyle: Record<string, string | number> = {
    flex: `0 0 ${navCollapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH}px`,
    width: navCollapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH,
  }
  return h('div', { className: 'phub-host' }, [
    h('div', { key: 'hub', style: hubLayoutStyle }, [
      h('div', { key: 'navWrap', className: 'phub-nav', style: navStyle }, [
        h(ChatProviderList, {
          key: 'nav', state, selected,
          collapsed: navCollapsed,
          onToggleCollapse: () => { setNavCollapsed(v => !v) },
          onSelect: (p: string) => { setSelected(p); setAddingCustom(false); setNavCollapsed(true) },
          onAddCustom: () => { setAddingCustom(true); setNavCollapsed(true) },
          onRetry: () => { void controller.load() },
        }),
      ]),
      h('div', { key: 'detail', style: detailColStyle }, [
        h('div', { key: 'panel', style: detailPanelStyle }, panelBody),
      ]),
    ]),
    h(VisionModelBlock, { key: 'vision' }),
    h(ImageModelBlock, { key: 'image' }),
    h(VideoModelBlock, { key: 'video' }),
  ])
}
