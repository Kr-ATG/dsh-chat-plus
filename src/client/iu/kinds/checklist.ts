/**
 * iu kind: **checklist**（待办清单，勾选进度条 + 持久化）。
 *
 * ⚠ 本文件零 React、零 DOM。React 体见 checklist.body.tsx。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, esc, pickAll, str, strOr } from './core.ts'

export interface IuCheckItem {
  readonly label: string
  readonly desc: string
}

export interface IuChecklistSpec extends IuSpecBase {
  readonly kind: 'checklist'
  readonly title: string
  readonly items: readonly IuCheckItem[]
}

/** checklist 的本地状态：已勾选的下标集合（持久化——老实现刷新即丢）。 */
export interface ChecklistState extends IuState {
  readonly checked: readonly number[]
}

function parse(raw: Record<string, unknown>): IuChecklistSpec | undefined {
  const items = pickAll<IuCheckItem>(raw.items, 12, (it) => {
    const label = str(it.label, 40)
    if (label === '') return undefined
    return { label, desc: str(it.desc, 80) }
  })
  if (items.length === 0) return undefined
  return { kind: 'checklist', title: strOr(raw.title, 40, '清单'), items }
}

function initState(_spec: IuChecklistSpec): ChecklistState {
  return { checked: [] }
}

function fillText(spec: IuChecklistSpec, state: ChecklistState): string {
  const checked = new Set(state.checked)
  const picked = [...checked].sort((a, b) => a - b)
    .map(i => spec.items[i]?.label)
    .filter((s): s is string => typeof s === 'string' && s !== '')
  if (picked.length === 0) return `${spec.title}：还没勾选`
  return `${spec.title}：已选 ${picked.length}/${spec.items.length}——${picked.join('、')}`
}

/**
 * 静态快照（截图用）。DOM 与 checklist.body.tsx 逐字对齐：
 * progress → count → 每行 check（box + label/desc）。截图定格在「全未勾」。
 */
function snapshot(spec: IuChecklistSpec): string {
  const rows = spec.items.map(it =>
    `<div class="dtt-iu__check"><span class="dtt-iu__box"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 5.2 4 7.4 8.2 2.6"></path></svg></span>`
    + `<span><b>${esc(it.label)}</b>`
    + (it.desc !== '' ? `<small>${esc(it.desc)}</small>` : '')
    + `</span></div>`).join('')
  return `<div class="dtt-iu__progress"><i style="width:0%"></i></div>`
    + `<div class="dtt-iu__count">0/${spec.items.length} 已完成</div><div>${rows}</div>`
}

const CSS = [
  '/* checklist：一根细进度线 + 可点行。',
  ' *',
  ' * 融合第二版（2026-10-19）：进度条此前是 6px 通栏纯蓝 + 外发光 —— 那是仪表盘语言（「进度管理」），',
  ' * 不是正文语言。实测它在整段回答里比任何文字都抢眼，且发光让一根装饰条变成了「有状态的控件」。',
  ' * 现在：2px、无发光、颜色是 label 的 45%（中性），只有**未完成比例**这一条信息，不宣示存在感。',
  ' * ⚠ 高度别再调回去：≥4px 就重新变成「进度条组件」。 */',
  '.dtt-iu__progress { height: 2px; border-radius: 999px; overflow: hidden; margin: 9px 0 6px;',
  '  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }',
  '.dtt-iu__progress i { display: block; height: 100%; border-radius: 999px;',
  '  background: color-mix(in srgb, var(--dsw-alias-label-primary) 45%, transparent);',
  '  transition: width .3s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-iu__check { display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left;',
  '  border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;',
  '  /* 横向 padding 归零、去掉负 margin：外壳已与正文同宽（.dtt-iu 横向 padding 为 0），',
  '     旧的 padding:8px 10px + margin:0 -10px 是靠「外层有 10px padding」互相抵消的，',
  '     外壳一改就把行外溢出去、和正文左右边缘对不齐。勾选框与文字用 gap 拉开。 */',
  '  border-radius: var(--iu-r-md, 8px); padding: 8px 0; margin: 0;',
  '  transition: background-color .18s ease, transform .18s ease, box-shadow .18s ease; }',
  /* 悬停只换底色，不做横向位移：卡片已融进正文，整行左右挪 2px 会像在抖。 */
  '.dtt-iu__check:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }',
  '.dtt-iu__check:active { transform: scale(.99); }',
  '.dtt-iu__check:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);',
  '  outline-offset: 2px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); }',
  '/* 选中态**不再给整行铺底色 + 描边**：那张满宽色块在没有外框的卡片里就是一条横向',
  '   色带，两张勾选行并排时整屏都是色条（实测截图里非常抢眼）。',
  '   勾选这件事本来就由勾选框 + 删除线两个信号表达完整，行底色是多余的第二层强调。 */',
  '.dtt-iu__check[data-on="1"] { background: transparent; }',
  '.dtt-iu__box { width: 16px; height: 16px; border-radius: 5px; flex: none; margin-top: 1px;',
  '  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 28%, transparent);',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  transition: background-color .2s ease, border-color .2s ease, transform .2s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-iu__check[data-on="1"] .dtt-iu__box {',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6); transform: scale(1.06); }',
  '.dtt-iu__box svg { opacity: 0; transform: scale(.5); transition: opacity .18s ease, transform .2s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-iu__check[data-on="1"] .dtt-iu__box svg { opacity: 1; transform: none; }',
  '.dtt-iu__check b { display: block; font-size: calc(13px * var(--iu-text-scale, 1)); font-weight: 500; line-height: 1.55; }',
  '/* 文字层级走 label-* 令牌而不是 opacity：opacity 混出来的是非法定中间色，暗色下发灰。 */',
  '  .dtt-iu__check[data-on="1"] b { color: var(--dsw-alias-label-tertiary, currentColor); text-decoration: line-through; }',
  '  .dtt-iu__check small { display: block; font-size: calc(11.5px * var(--iu-text-scale, 1)); color: var(--dsw-alias-label-tertiary, currentColor); line-height: 1.6; margin-top: 1px; }',
  '  .dtt-iu__count { font-size: calc(11px * var(--iu-text-scale, 1)); color: var(--dsw-alias-label-tertiary, currentColor); font-variant-numeric: tabular-nums; }',
].join('\n')

export const checklistKind: IuKind<ChecklistState, IuChecklistSpec> = {
  kind: 'checklist',
  label: '清单',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · checklist 清单：{"kind":"checklist","title":"上线前还差三件","items":[{"label":"事项","desc":"说明"}]}（items ≤12；勾选进度会记住，刷新不丢）。',
}
