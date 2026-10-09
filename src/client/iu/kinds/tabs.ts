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
  '/* tabs：胶囊切换 + 面板淡入 */',
  '.dtt-iu__tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0;',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1));',
  '  border-radius: 999px; padding: 3px; width: fit-content; max-width: 100%; }',
  '.dtt-iu__tab { border: 0; background: transparent; color: inherit; font: inherit;',
  '  font-size: calc(12px * var(--iu-text-scale, 1)); border-radius: 999px; padding: 4px 13px;',
  '  cursor: pointer; opacity: .6; transition: opacity .18s ease, background-color .18s ease, transform .18s ease; }',
  '.dtt-iu__tab:hover { opacity: 1; transform: translateY(-1px); }',
  '.dtt-iu__tab--active { background: var(--dsw-alias-bg-layer-1, #fff); opacity: 1;',
  '  font-weight: 600; box-shadow: 0 1px 6px rgba(20,40,90,.18); }',
  'body[data-ds-dark-theme] .dtt-iu__tab--active { background: rgba(255,255,255,.12); }',
  '.dtt-iu__panel { animation: dtt-iu-fade .25s ease both; }',
  '.dtt-iu__panel h4 { margin: 6px 0 4px; font-size: calc(13px * var(--iu-text-scale, 1)); }',
  '.dtt-iu__panel p { margin: 0 0 4px; font-size: calc(12.5px * var(--iu-text-scale, 1));',
  '  line-height: 1.65; opacity: .85; white-space: pre-wrap; }',
].join('\n')

export const tabsKind: IuKind<TabsState, IuTabsSpec> = {
  kind: 'tabs',
  label: '对比',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · tabs 对比：{"kind":"tabs","title":"标题","tabs":[{"label":"页签","heading":"小标题","body":"说明"}]}（tabs ≤6；当前页会记住）。',
}
