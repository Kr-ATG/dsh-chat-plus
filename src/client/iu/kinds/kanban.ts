/**
 * iu kind: **kanban**（可拖拽看板 → 多列卡片，拖动重排 / 跨列移动，布局持久化）。
 *
 * ## 数据模型：内容与布局分离
 *  · `spec.columns` 只描述「有哪些卡片」（静态内容，模型给）；
 *  · `state.layout` 只存「每列有哪些卡片 id、什么顺序」（动态归属，用户拖出来）。
 * 卡片文本永远按 id 回 spec 查——layout 不复制文本，围栏措辞与布局互不污染。
 *
 * ## 两套交互（见 kanban.body.tsx）
 *  1. HTML5 拖拽（桌面）：卡片 draggable，列 body 是 drop zone，落点按鼠标 Y 插位；
 *  2. 点击降级（触摸 / 键盘）：点卡片选中（state.selected），点目标列头
 *     「移到这里」按钮把卡片移到该列末尾。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 *   React 体一律写在 kanban.body.tsx 里。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { esc, escAttr, pickAll, str } from './core.ts'

/** 一张看板卡片。desc / tag 为空串 = 模型没给（不渲染对应节点）。 */
export interface IuKanbanCard {
  readonly id: string
  readonly text: string
  readonly desc: string
  readonly tag: string
}

/** 一个看板列。 */
export interface IuKanbanColumn {
  readonly id: string
  readonly label: string
  readonly cards: readonly IuKanbanCard[]
}

export interface IuKanbanSpec extends IuSpecBase {
  readonly kind: 'kanban'
  readonly title: string
  readonly columns: readonly IuKanbanColumn[]
}

/** layout：列 id → 该列的卡片 id 顺序（只存顺序与归属，不存文本）。 */
export type KanbanLayout = Readonly<Record<string, readonly string[]>>

/** kanban 的本地状态（持久化）。selected = 点击降级选中的卡片 id，null = 无。 */
export interface KanbanState extends IuState {
  readonly layout: KanbanLayout
  readonly selected: string | null
}

function parse(raw: Record<string, unknown>): IuKanbanSpec | undefined {
  /**
   * 全局 id 去重池（列 id 与卡片 id 共用）：撞了就加 `-2`、`-3` 后缀。
   * 加后缀比丢卡片好——layout 以 id 为键，重复 id 会让两列共享同一张卡。
   */
  const used = new Set<string>()
  const take = (want: string, fallback: string): string => {
    const base = want !== '' ? want : fallback
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    let n = 2
    while (used.has(`${base}-${n}`)) n += 1
    const unique = `${base}-${n}`
    used.add(unique)
    return unique
  }
  let colSeq = 0
  let cardSeq = 0
  const columns = pickAll<IuKanbanColumn>(raw.columns, 5, (it) => {
    colSeq += 1
    const cards = pickAll<IuKanbanCard>(it.cards, 20, (c) => {
      const text = str(c.text, 60)
      if (text === '') return undefined
      cardSeq += 1
      return {
        id: take(str(c.id, 16), `k${cardSeq}`),
        text,
        desc: str(c.desc, 80),
        tag: str(c.tag, 12),
      }
    })
    return {
      id: take(str(it.id, 16), `c${colSeq}`),
      label: str(it.label, 16) || '列',
      cards,
    }
  })
  // 一列都没有 = 空看板没有意义，整条围栏回退成代码块。
  if (columns.length === 0) return undefined
  return {
    kind: 'kanban',
    title: str(raw.title, 40) || '看板',
    columns,
  }
}

/** 初始 layout：每列按 spec 里的卡片原始顺序。 */
export function initialLayout(spec: IuKanbanSpec): KanbanLayout {
  const out: Record<string, string[]> = {}
  for (const col of spec.columns) out[col.id] = col.cards.map(c => c.id)
  return out
}

/** 卡片 id → 卡片（Body 渲染与 drop 校验共用；卡片文本永远从这里查）。 */
export function kanbanCardMap(spec: IuKanbanSpec): ReadonlyMap<string, IuKanbanCard> {
  const map = new Map<string, IuKanbanCard>()
  for (const col of spec.columns) {
    for (const card of col.cards) map.set(card.id, card)
  }
  return map
}

/**
 * 把持久化读回来的 layout 洗成可信形状（localStorage 里可能是任何脏数据）：
 *  · 过滤不存在的卡片 id、跨列重复出现的 id；
 *  · layout 里缺失的卡片（脏数据丢失 / 新卡）回它的初始列，保持初始相对顺序；
 *  · raw 根本不是对象时整体回初始 layout。
 * 保证不变量：**每列的 id 互不重叠，且全部卡片恰好出现一次**。
 */
export function resolveLayout(spec: IuKanbanSpec, raw: unknown): KanbanLayout {
  const initial = initialLayout(spec)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return initial
  const obj = raw as Record<string, unknown>
  const all = new Set<string>()
  for (const col of spec.columns) {
    for (const card of col.cards) all.add(card.id)
  }
  const out: Record<string, string[]> = {}
  for (const col of spec.columns) out[col.id] = []
  const placed = new Set<string>()
  for (const col of spec.columns) {
    const bucket = out[col.id]
    const rawList = obj[col.id]
    if (bucket === undefined || !Array.isArray(rawList)) continue
    for (const id of rawList) {
      if (typeof id !== 'string' || !all.has(id) || placed.has(id)) continue
      placed.add(id)
      bucket.push(id)
    }
  }
  for (const col of spec.columns) {
    const bucket = out[col.id]
    if (bucket === undefined) continue
    for (const id of initial[col.id] ?? []) {
      if (placed.has(id)) continue
      placed.add(id)
      bucket.push(id)
    }
  }
  return out
}

/**
 * 把卡片移到目标列的 index 处（不可变更新，返回新 layout）。
 *
 * index 的语义是「**从原列摘掉该卡之后**的目标列插入位」——Body 计算落点时
 * 会跳过拖动中的卡片本身，两边语义一致。index 缺省 = 移到该列末尾。
 * 卡片不存在或目标列不存在时原样返回（drop 到无效位置不该丢卡）。
 */
export function moveCard(layout: KanbanLayout, cardId: string, toCol: string, index?: number): KanbanLayout {
  const next: Record<string, string[]> = {}
  for (const colId of Object.keys(layout)) next[colId] = [...(layout[colId] ?? [])]
  const to = next[toCol]
  if (to === undefined) return layout
  let from: string[] | undefined
  for (const colId of Object.keys(next)) {
    const list = next[colId]
    if (list !== undefined && list.includes(cardId)) {
      from = list
      break
    }
  }
  if (from === undefined) return layout
  from.splice(from.indexOf(cardId), 1)
  const at = index === undefined ? to.length : Math.max(0, Math.min(to.length, Math.round(index)))
  to.splice(at, 0, cardId)
  return next
}

function initState(spec: IuKanbanSpec): KanbanState {
  return { layout: initialLayout(spec), selected: null }
}

/** 回填文本：标题 + 各列「label(当前卡片数)」，数量按持久化 layout 算。 */
function fillText(spec: IuKanbanSpec, state: KanbanState): string {
  const layout = resolveLayout(spec, state.layout)
  const parts = spec.columns.map((col) => {
    const n = (layout[col.id] ?? []).length
    return `${col.label}(${n})`
  })
  return `${spec.title}：${parts.join('、')}`
}

/**
 * 静态快照（截图用）。DOM 结构与 kanban.body.tsx **逐字对齐**：
 * kanban > kcol(head[b + kcount + kmove(hidden)] + kcol-body > kcard[text+desc?+tag?])。
 * 「移到这里」按钮在快照里恒 hidden——Body 初始 selected=null 时也是 hidden，
 * 两侧子节点数量与顺序完全一致。按初始 layout 定格，无拖拽态。
 */
function snapshot(spec: IuKanbanSpec): string {
  const layout = initialLayout(spec)
  const byId = kanbanCardMap(spec)
  const cols = spec.columns.map((col) => {
    const ids = layout[col.id] ?? []
    const cards = ids.map((id) => {
      const c = byId.get(id)
      if (c === undefined) return ''
      return `<div class="dtt-iu__kcard">`
        + `<span class="dtt-iu__kcard-text">${esc(c.text)}</span>`
        + (c.desc !== '' ? `<span class="dtt-iu__kcard-desc">${esc(c.desc)}</span>` : '')
        + (c.tag !== '' ? `<span class="dtt-iu__kcard-tag">${esc(c.tag)}</span>` : '')
        + `</div>`
    }).join('')
    return `<div class="dtt-iu__kcol" role="group" aria-label="${escAttr(col.label)}">`
      + `<div class="dtt-iu__kcol-head"><b>${esc(col.label)}</b>`
      + `<span class="dtt-iu__kcount">${ids.length}</span>`
      + `<button type="button" class="dtt-iu__kmove" hidden>移到这里</button></div>`
      + `<div class="dtt-iu__kcol-body">${cards}</div>`
      + `</div>`
  }).join('')
  return `<div class="dtt-iu__kanban">${cols}</div>`
}

const CSS = [
  '/* kanban：横向滚动多列看板 + 可拖拽卡片（HTML5 拖拽 + 点击移动两套交互） */',
  '.dtt-iu__kanban { display: flex; gap: 8px; align-items: flex-start;',
  '  overflow-x: auto; padding: 2px 2px 8px; margin-top: 6px; scrollbar-width: thin; }',
  '.dtt-iu__kcol { flex: 1 0 170px; min-width: 170px; max-width: 280px;',
  '  display: flex; flex-direction: column; border-radius: 10px;',
  '  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));',
  '  outline: 2px dashed transparent; outline-offset: -2px;',
  '  transition: background-color .18s ease, outline-color .18s ease; }',
  '.dtt-iu__kcol[data-dragover] { background: rgba(65,118,230,.10);',
  '  outline-color: var(--dsw-alias-state-business-primary, #4176e6); }',
  '.dtt-iu__kcol-head { display: flex; align-items: center; gap: 6px; padding: 7px 8px 5px; }',
  '.dtt-iu__kcol-head b { flex: 1; min-width: 0; font-size: calc(12px * var(--iu-text-scale, 1));',
  '  font-weight: 600; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.dtt-iu__kcount { font-size: calc(10px * var(--iu-text-scale, 1)); font-variant-numeric: tabular-nums;',
  '  padding: 1px 7px; border-radius: 999px; background: rgba(127,127,127,.16); opacity: .8;',
  '  transition: background-color .18s ease, color .18s ease, opacity .18s ease; }',
  '.dtt-iu__kcol[data-dragover] .dtt-iu__kcount { background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  color: #fff; opacity: 1; }',
  '.dtt-iu__kmove { border: 0; cursor: pointer; border-radius: 999px; padding: 2px 8px;',
  '  font-size: calc(10px * var(--iu-text-scale, 1)); font-weight: 600; color: #fff; flex: none;',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  transition: transform .15s ease, filter .15s ease; }',
  '.dtt-iu__kmove[hidden] { display: none; }',
  '.dtt-iu__kmove:hover { transform: translateY(-1px); filter: brightness(1.08); }',
  '.dtt-iu__kmove:active { transform: translateY(0); }',
  '.dtt-iu__kcol-body { display: flex; flex-direction: column; gap: 6px; padding: 4px 6px 8px; min-height: 44px; }',
  '.dtt-iu__kcol-body:empty::after { content: "空列 · 拖卡片进来"; text-align: center; padding: 10px 2px;',
  '  font-size: calc(11px * var(--iu-text-scale, 1)); opacity: .35; }',
  '.dtt-iu__kcard { border-radius: 8px; padding: 6px 9px; cursor: grab; user-select: none;',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));',
  '  box-shadow: 0 1px 2px rgba(0,0,0,.06);',
  '  outline: 2px solid transparent; outline-offset: 1px;',
  '  transition: transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease,',
  '    background-color .18s ease, outline-color .18s ease, opacity .18s ease; }',
  '.dtt-iu__kcard:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,.12); }',
  '.dtt-iu__kcard:active { cursor: grabbing; }',
  '.dtt-iu__kcard:focus-visible { outline-color: var(--dsw-alias-state-business-primary, #4176e6); }',
  '.dtt-iu__kcard[data-dragging] { opacity: .35; transform: scale(.97); box-shadow: none; }',
  '.dtt-iu__kcard[data-selected] { outline-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: rgba(65,118,230,.14); }',
  '.dtt-iu__kcard-text { display: block; font-size: calc(13px * var(--iu-text-scale, 1)); font-weight: 600; line-height: 1.35; }',
  '.dtt-iu__kcard-desc { display: block; margin-top: 2px; font-size: calc(11px * var(--iu-text-scale, 1)); opacity: .6; line-height: 1.4; }',
  '.dtt-iu__kcard-tag { display: inline-block; margin-top: 5px; padding: 1px 7px; border-radius: 999px;',
  '  font-size: calc(10px * var(--iu-text-scale, 1)); font-weight: 600;',
  '  color: var(--dsw-alias-state-business-primary, #4176e6); background: rgba(65,118,230,.14); }',
  '@keyframes dtt-iu-kmove-in { from { opacity: 0; transform: translateY(-3px) scale(.85); } to { opacity: 1; transform: none; } }',
  '.dtt-iu__kmove:not([hidden]) { animation: dtt-iu-kmove-in .22s cubic-bezier(.2,.7,.3,1); }',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__kanban *, .dtt-iu__kanban *::before, .dtt-iu__kanban *::after {',
  '    transition: none !important; animation: none !important; }',
  '}',
].join('\n')

export const kanbanKind: IuKind<KanbanState, IuKanbanSpec> = {
  kind: 'kanban',
  label: '看板',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · kanban 看板：{"kind":"kanban","title":"发布看板","columns":[{"id":"todo","label":"待办","cards":[{"id":"t1","text":"补齐单测","tag":"P0"},{"id":"t2","text":"写发布说明","desc":"中英双语"}]},{"id":"doing","label":"进行中","cards":[{"id":"d1","text":"灰度 5%"}]},{"id":"done","label":"完成","cards":[{"id":"n1","text":"过评审"}]}]}（最多 5 列、每列最多 20 张卡；卡片 id≤16 且全局唯一、text≤60、desc≤80 可省、tag≤12 可省；拖动卡片跨列/重排，布局会记住；触摸设备点卡片再点「移到这里」）。',
}
