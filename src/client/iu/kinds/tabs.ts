/**
 * iu kind: **tabs**（页签式方案对比）。
 *
 * ⚠ 本文件零 React、零 DOM。React 体见 tabs.body.tsx。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, esc, pickAll, str, strOr } from './core.ts'

export interface IuTabsTab {
  readonly label: string
  readonly heading: string
  readonly body: string
}

export interface IuTabsSpec extends IuSpecBase {
  readonly kind: 'tabs'
  readonly title: string
  readonly tabs: readonly IuTabsTab[]
}

/** tabs 的本地状态：活动页签下标（持久化——刷新回到用户最后看的那页）。 */
export interface TabsState extends IuState {
  readonly active: number
}

function parse(raw: Record<string, unknown>): IuTabsSpec | undefined {
  const tabs = pickAll<IuTabsTab>(raw.tabs, 6, (it) => {
    const label = str(it.label, 12)
    if (label === '') return undefined
    const heading = str(it.heading, 60)
    const body = str(it.body, 500)
    if (heading === '' && body === '') return undefined
    return { label, heading, body }
  })
  if (tabs.length === 0) return undefined
  return { kind: 'tabs', title: strOr(raw.title, 40, '对比'), tabs }
}

function initState(_spec: IuTabsSpec): TabsState {
  return { active: 0 }
}

function fillText(spec: IuTabsSpec, state: TabsState): string {
  const active = state.active < spec.tabs.length ? state.active : 0
  const tab = spec.tabs[active]
  if (tab === undefined) return spec.title
  const body = tab.body !== '' ? `——${tab.body.slice(0, 80)}` : tab.heading
  return `${spec.title}·${tab.label}：${body}`
}

/**
 * 静态快照（截图用）。DOM 与 tabs.body.tsx 对齐：tabs 胶囊条 → panel。
 * 截图定格在第 0 页（无 JS 切不了页，只能展示首个 tab）。
 */
function snapshot(spec: IuTabsSpec): string {
  const btns = spec.tabs.map((t, i) =>
    `<span class="${i === 0 ? 'dtt-iu__tab dtt-iu__tab--active' : 'dtt-iu__tab'}">${esc(t.label)}</span>`).join('')
  const first = spec.tabs[0]
  const head = first !== undefined && first.heading !== '' ? `<h4>${esc(first.heading)}</h4>` : ''
  const body = first !== undefined && first.body !== '' ? `<p>${esc(first.body.slice(0, 200))}</p>` : ''
  return `<div class="dtt-iu__tabs">${btns}</div><div class="dtt-iu__panel">${head}${body}</div>`
}

const CSS = [
  '/* tabs：**下划线式分页，不是分段控件**。',
  ' *',
  ' * 融合第二版（2026-10-19）：原来是「灰底胶囊容器 + 白底浮起选中块 + 投影」——',
  ' * 那套 iOS 分段控件（segmented control）的语法在正文里等于一个 App 控件，',
  ' * 暗色下选中块的 rgba(255,255,255,.12) 更是明显的一块白板。',
  ' * 现在改成文档级分页：一条底部分隔线 + 选中项下划一条粗线。',
  ' * ⚠ 不要给容器加回底色/描边/圆角：那正是「控件」感的来源。 */',
  '.dtt-iu__tabs { display: flex; flex-wrap: wrap; gap: 2px; margin: 8px 0 8px;',
  '  background: none; border-bottom: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);',
  '  border-radius: 0; padding: 0; width: 100%; max-width: 100%; }',
  '.dtt-iu__tab { position: relative; border: 0; background: transparent; color: inherit; font: inherit;',
  '  font-size: calc(12.5px * var(--iu-text-scale, 1)); font-weight: 500; border-radius: 0; padding: 5px 10px 7px;',
  '  cursor: pointer; opacity: .55;',
  '  transition: opacity .18s ease, color .18s ease; }',
  '.dtt-iu__tab::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 1.5px;',
  '  border-radius: 2px 2px 0 0; background: currentColor; opacity: 0; transform: scaleX(.4);',
  '  transition: opacity .2s ease, transform .24s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-iu__tab:hover { opacity: .85; }',
  '.dtt-iu__tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: -1px; }',
  '.dtt-iu__tab--active { opacity: 1; font-weight: 600; }',
  '.dtt-iu__tab--active::after { opacity: 1; transform: none; }',
  '/* 面板切页：keyframes 此前**全仓不存在**（写了 animation: dtt-iu-fade 却没有定义），',
  '   所以切页是纯硬切。这里补上真正的定义，并且**起点 opacity .55 而不是 0**：',
  '   可见性不依赖动画（无头截图/节流时停在首帧也要读得见）。 */',
  '.dtt-iu__panel { min-height: 52px; padding-top: 2px; animation: dtt-iu-fade .22s cubic-bezier(.2,.8,.25,1) both; }',
  '@keyframes dtt-iu-fade { from { opacity: .55; transform: translateY(2px) } to { opacity: 1; transform: none } }',
  '.dtt-iu__panel h4 { margin: 6px 0 4px; font-size: calc(13px * var(--iu-text-scale, 1)); }',
  '.dtt-iu__panel p { margin: 0 0 4px; font-size: calc(12.5px * var(--iu-text-scale, 1));',
  '  line-height: 1.65; opacity: .85; white-space: pre-wrap; }',
  '/* 无障碍：tabs 是 12 个 kind 里唯一没有 reduced-motion 块的，这里补齐。',
  '   切页动画本身是装饰，关掉不影响可读性。 */',
  '@media (prefers-reduced-motion: reduce) { .dtt-iu__panel { animation: none; }',
  '  .dtt-iu__tab::after { transition: none; } }',
].join('\n')

export const tabsKind: IuKind<TabsState, IuTabsSpec> = {
  kind: 'tabs',
  label: '对比',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · tabs 对比：{"kind":"tabs","title":"两种接法选哪种","tabs":[{"label":"页签","heading":"小标题","body":"说明"}]}（tabs ≤6；当前页会记住）。',
}
