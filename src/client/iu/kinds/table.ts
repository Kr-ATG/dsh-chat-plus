/**
 * iu kind: **table**（可排序数据表）。
 *
 * 结构照抄 slider.ts（纯逻辑半边）：parse / initState / fillText / snapshot /
 * css / doc + export const tableKind；React 体在 table.body.tsx。
 *
 * 排序比较器（sortTableRows）也放在本文件导出给 Body 用——排序语义必须单一
 * 来源，两边各写一份就会漂移（与 chart 的几何共用 geometry.ts 同理）。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, boolOrFalse, boolOrTrue, esc, escAttr, formatNum, oneOf, pickAll, str, strOr } from './core.ts'

/** 列类型：text 按 localeCompare 排、num 按数值排（且右对齐 + tabular-nums）。 */
export type IuTableColType = 'text' | 'num'

/** 列对齐（parse 时已把缺省解析成具体值：num→right、text→left）。 */
export type IuTableAlign = 'left' | 'right' | 'center'

/** 一列的定义。 */
export interface IuTableColumn {
  /** 列标识（排序状态引用它；parse 保证非空且全表唯一）。 */
  readonly key: string
  /** 表头文案（≤16 字）。 */
  readonly label: string
  readonly type: IuTableColType
  readonly align: IuTableAlign
}

/** 单元格值：字符串或数字（JSON 里就这两种；其余类型 parse 成空串）。 */
export type IuTableCell = string | number

export interface IuTableSpec extends IuSpecBase {
  readonly kind: 'table'
  readonly title: string
  readonly columns: readonly IuTableColumn[]
  /** 每行长度恒等于 columns.length（parse 补齐/截断，缺失补空串）。 */
  readonly rows: readonly (readonly IuTableCell[])[]
  /** 紧凑行高（默认 false）。 */
  readonly dense: boolean
  /** 斑马纹（默认 true）。 */
  readonly zebra: boolean
}

/** table 的本地状态（持久化）：当前按哪列、什么方向排。 */
export interface TableState extends IuState {
  readonly sortKey: string | null
  readonly sortDir: 'asc' | 'desc'
}

/** 列数上限。 */
const MAX_COLS = 8
/** 行数上限。 */
const MAX_ROWS = 100
/** 单元格文本上限（列 label ≤16、标题 ≤40，单元格给宽一点放长名称）。 */
const MAX_CELL = 60
/** 快照最多渲染前几行（结构完整即可，截图不必画满百行）。 */
const SNAPSHOT_ROWS = 8

function parse(raw: Record<string, unknown>): IuTableSpec | undefined {
  const cols = pickAll<IuTableColumn>(raw.columns, MAX_COLS, (it) => {
    const key = str(it.key, 16)
    const label = str(it.label, 16)
    // key 与 label 全空 = 这列没法用也没法排，跳过（不占额度）；
    // 只有一个时互相兜底——钳位修复而不是拒绝整卡。
    if (key === '' && label === '') return undefined
    const type = oneOf(it.type, ['text', 'num'], 'text')
    const align = oneOf(it.align, ['left', 'right', 'center'], type === 'num' ? 'right' : 'left')
    return { key, label: label !== '' ? label : key, type, align }
  })
  if (cols.length === 0) return undefined
  // key 补全与去重：排序状态按 key 引用列，空 key / 重复 key 会让排序张冠李戴。
  const seen = new Set<string>()
  const columns = cols.map((c, i) => {
    if (c.key !== '' && !seen.has(c.key)) {
      seen.add(c.key)
      return c
    }
    let key = c.key !== '' ? c.key : `col${i}`
    while (seen.has(key)) key += '~'
    seen.add(key)
    return { ...c, key }
  })
  const rows: (readonly IuTableCell[])[] = []
  for (const rawRow of arr(raw.rows)) {
    if (rows.length >= MAX_ROWS) break
    if (!Array.isArray(rawRow)) continue
    // 每行补齐/截断到 columns.length：缺的补空串，多的丢掉（结构恒整齐，
    // Body 与 snapshot 都不需要再做越界防御）。
    const cells: IuTableCell[] = []
    for (let j = 0; j < columns.length; j += 1) {
      const cell: unknown = rawRow[j]
      // JSON 能表达 1e400 这种解析成 Infinity 的数，非有限值一律当坏数据成空串。
      cells.push(typeof cell === 'number' && Number.isFinite(cell) ? cell : str(cell, MAX_CELL))
    }
    rows.push(cells)
  }
  if (rows.length === 0) return undefined
  return {
    kind: 'table',
    title: strOr(raw.title, 40, '数据表'),
    columns,
    rows,
    dense: boolOrFalse(raw.dense),
    zebra: boolOrTrue(raw.zebra),
  }
}

function initState(): TableState {
  return { sortKey: null, sortDir: 'asc' }
}

/**
 * 单元格 → 排序用文本（text 列；数字走 formatNum，与渲染形态一致）。
 */
function cellText(v: IuTableCell): string {
  return typeof v === 'number' ? formatNum(v) : v
}

/**
 * 单元格 → 排序用数值（num 列）。
 * 字符串尝试解析；空串与解析失败给 NaN（Number('') === 0 是陷阱，先挡空串）。
 */
function cellNumber(v: IuTableCell): number {
  if (typeof v === 'number') return v
  if (v.trim() === '') return Number.NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * 按列排序 rows（纯函数：返回副本，绝不改入参——spec.rows 是持久 spec）。
 *
 * num 列按数值比（非数值单元格恒沉底、不随方向翻转）；text 列按 localeCompare。
 * sortKey 不在 columns 里（例如持久化层读出旧版本脏数据）时原样返回。
 * 导出给 table.body.tsx 消费，保证排序语义只有一份。
 */
export function sortTableRows(
  rows: readonly (readonly IuTableCell[])[],
  columns: readonly IuTableColumn[],
  sortKey: string | null,
  sortDir: 'asc' | 'desc',
): readonly (readonly IuTableCell[])[] {
  if (sortKey === null) return rows
  const idx = columns.findIndex(c => c.key === sortKey)
  if (idx < 0) return rows
  const numeric = columns[idx].type === 'num'
  const dir = sortDir === 'desc' ? -1 : 1
  return rows.slice().sort((a, b) => {
    const av = a[idx] ?? ''
    const bv = b[idx] ?? ''
    if (numeric) {
      const an = cellNumber(av)
      const bn = cellNumber(bv)
      if (Number.isNaN(an) || Number.isNaN(bn)) {
        if (Number.isNaN(an) && Number.isNaN(bn)) return 0
        return Number.isNaN(an) ? 1 : -1
      }
      return an === bn ? 0 : (an < bn ? -1 : 1) * dir
    }
    const cmp = cellText(av).localeCompare(cellText(bv))
    return cmp === 0 ? 0 : (cmp < 0 ? -1 : 1) * dir
  })
}

/** 回填文本：规模 + 当前排序状态（真实值，不写占位话术）。 */
function fillText(spec: IuTableSpec, state: TableState): string {
  const base = `${spec.title}：${spec.rows.length} 行 × ${spec.columns.length} 列`
  // state 可能来自 localStorage 的脏数据：find 不中就当作没排序。
  const col = spec.columns.find(c => c.key === state.sortKey)
  if (col === undefined) return base
  return `${base}，按「${col.label}」${state.sortDir === 'desc' ? '降序' : '升序'}`
}

/**
 * 静态快照（截图用）。DOM 结构与 table.body.tsx **逐字对齐**：
 * wrap → table → thead(tr>th) → tbody(tr>td)，按初始无排序定格
 * （aria-sort="none"、无 data-active / data-dir，箭头节点在但透明度 0）。
 * 所有模型文本走 esc，进属性的走 escAttr（type/align 虽已钳成白名单枚举，
 * 也一律过转义，不给「以后有人放宽校验」留雷）。
 */
function snapshot(spec: IuTableSpec): string {
  const head = spec.columns.map(col =>
    `<th class="dtt-iu__th" role="button" tabindex="0" aria-sort="none"`
    + ` data-align="${escAttr(col.align)}">${esc(col.label)}`
    + `<span class="dtt-iu__arrow" aria-hidden="true">▼</span></th>`,
  ).join('')
  const body = spec.rows.slice(0, SNAPSHOT_ROWS).map(row =>
    `<tr class="dtt-iu__tr">${spec.columns.map((col, j) => {
      const cell = row[j] ?? ''
      const text = typeof cell === 'number' ? formatNum(cell) : cell
      return `<td class="dtt-iu__td" data-type="${escAttr(col.type)}" data-align="${escAttr(col.align)}">${esc(text)}</td>`
    }).join('')}</tr>`,
  ).join('')
  const dense = spec.dense ? ' data-dense="1"' : ''
  const zebra = spec.zebra ? ' data-zebra="1"' : ''
  return `<div class="dtt-iu__table-wrap"><table class="dtt-iu__table"${dense}${zebra}>`
    + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

const CSS = [
  '/* table：可排序数据表 —— 表头即排序按钮，wrap 负责窄屏横向滚动；',
  '   没有入场动画，数据可见性天然不依赖动效（与 chart 那条纪律一致）。 */',
  '.dtt-iu__table-wrap { overflow: hidden; overflow-x: auto; margin: calc(8px * var(--iu-text-scale, 1)) 0 calc(8px * var(--iu-text-scale, 1)); padding-bottom: 2px; -webkit-overflow-scrolling: touch;',
  '  border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16)); border-radius: 12px; }',
  '.dtt-iu__table { width: 100%; border-collapse: collapse;',
  '  font-size: calc(12.5px * var(--iu-text-scale, 1)); }',
  '/* 表头：hover / 激活 / 键盘聚焦都有过渡反馈（button 语义在元素上） */',
  '.dtt-iu__th { text-align: left; font-weight: 600; white-space: nowrap; cursor: pointer; letter-spacing: .01em;',
  '  user-select: none; padding: 8px 10px; font-size: calc(12.5px * var(--iu-text-scale, 1));',
  '  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.28));',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));',
  '  transition: background-color .18s ease, box-shadow .18s ease; }',
  '.dtt-iu__th:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.16));',
  '  color: var(--dsw-alias-state-business-primary, #4176e6); }',
  '.dtt-iu__th:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);',
  '  outline-offset: -2px; }',
  '.dtt-iu__th[data-active="1"] { color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent); }',
  '.dtt-iu__th[data-active="1"]:hover {',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 18%, transparent); }',
  '/* 排序箭头：节点恒在、常态透明，激活列点亮；字形恒为 ▼，升序旋转 180°——',
  '   方向切换走 transform 过渡（翻转动画），不靠换文本、不靠重挂载。 */',
  '.dtt-iu__arrow { display: inline-block; margin-left: 4px; opacity: 0; transform: rotate(180deg);',
  '  font-size: calc(9px * var(--iu-text-scale, 1));',
  '  transition: opacity .18s ease, transform .2s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-iu__th[data-active="1"] .dtt-iu__arrow { opacity: .85; }',
  '.dtt-iu__th[data-active="1"][data-dir="asc"] .dtt-iu__arrow { transform: rotate(180deg); }',
  '.dtt-iu__th[data-active="1"][data-dir="desc"] .dtt-iu__arrow { transform: rotate(0deg); }',
  '/* 行与单元格：斑马纹画在 tr、hover 画在 td —— td 背景永远盖住 tr 背景，',
  '   两条规则不必抢 specificity；行 hover 有 background-color 过渡。 */',
  '.dtt-iu__td { padding: 6px 10px; white-space: nowrap;',
  '  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.14));',
  '  transition: background-color .18s ease; }',
  '.dtt-iu__tr:last-child .dtt-iu__td { border-bottom: 0; }',
  '.dtt-iu__table[data-zebra="1"] .dtt-iu__tr:nth-child(even) { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); }',
  '.dtt-iu__th:first-child, .dtt-iu__td:first-child { padding-left: calc(12px * var(--iu-text-scale, 1)); }',
  '.dtt-iu__tr:hover .dtt-iu__td {',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 8%, transparent); }',
  '/* 对齐与数字：align 在 parse 已解析成具体值（num 默认右、text 默认左），',
  '   CSS 只认 data-align；num 列追加 tabular-nums 让数位对齐。 */',
  '.dtt-iu__th[data-align="right"], .dtt-iu__td[data-align="right"] { text-align: right; }',
  '.dtt-iu__th[data-align="center"], .dtt-iu__td[data-align="center"] { text-align: center; }',
  '.dtt-iu__td[data-type="num"] { font-variant-numeric: tabular-nums; }',
  '/* dense：紧凑行高 */',
  '.dtt-iu__table[data-dense="1"] .dtt-iu__th { padding: 4px 8px; }',
  '.dtt-iu__table[data-dense="1"] .dtt-iu__td { padding: 3px 8px; }',
  '/* 无障碍：以上全部是状态过渡，reduced-motion 直接关掉即可，不影响可读性。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__th, .dtt-iu__td { transition: background-color .18s ease, opacity .18s ease; }',
  '  .dtt-iu__arrow { transition: opacity .18s ease; }',
  '}',
].join('\n')

export const tableKind: IuKind<TableState, IuTableSpec> = {
  kind: 'table',
  label: '表格',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · table 数据表：{"kind":"table","title":"季度销售","columns":[{"key":"region","label":"区域"},{"key":"sales","label":"销售额","type":"num"},{"key":"rate","label":"增长率%","type":"num"}],"rows":[["华东",1280,12],["华北",960,-3],["华南",1105,8],["西南",742,5]],"dense":false,"zebra":true}（columns ≤8：key/label ≤16 字，type=text|num 默认 text、num 右对齐且数字等宽，align=left|right|center 可显式覆盖；rows ≤100 行、每行与 columns 等长，单元格=字符串|数字，缺失补空串；点表头按列排序、再点切换升/降序，num 列按数值、text 列按字典序；dense=紧凑行高默认 false，zebra=斑马纹默认 true）。',
}
