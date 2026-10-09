/**
 * iu kind **table** 的 React 体（client 专用），结构照抄 slider.body.tsx。
 *
 * ## Body 契约（见 bodies.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不自己画 Head / FillRow；
 *  · DOM 结构与 table.ts 的 `snapshot()` **逐字对齐**：
 *    wrap → table[data-dense][data-zebra] → thead(tr>th[role=button,
 *    tabindex=0, aria-sort][data-active][data-dir][data-align] + 箭头 span)
 *    → tbody(tr.dtt-iu__tr > td.dtt-iu__td[data-type][data-align])。
 *    快照定格在「初始无排序」态，因此未激活列不输出 data-active / data-dir，
 *    aria-sort="none"，箭头 span 恒在（常态由 CSS 置为透明）；
 *  · 状态一律走 props 的 state / setState（外壳统一持久化），不自己 useState；
 *  · 排序比较器用 table.ts 导出的 sortTableRows（单一来源，与纯逻辑侧不漂移），
 *    它对副本排序，绝不改 spec.rows。
 */

import { memo, useMemo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuTableSpec, TableState } from './table.ts'
import { sortTableRows } from './table.ts'
import { formatNum } from './core.ts'

export const TableBody = memo(function TableBody(
  { spec, state, setState }: IuBodyProps<TableState, IuTableSpec>,
): JSX.Element {
  const rows = useMemo(
    () => sortTableRows(spec.rows, spec.columns, state.sortKey, state.sortDir),
    [spec.rows, spec.columns, state.sortKey, state.sortDir],
  )
  /** 点表头：同列再点切换升/降序，换列从升序起。 */
  const onSort = (key: string): void => {
    if (state.sortKey === key) setState({ sortDir: state.sortDir === 'asc' ? 'desc' : 'asc' })
    else setState({ sortKey: key, sortDir: 'asc' })
  }
  return (
    <div className="dtt-iu__table-wrap">
      <table
        className="dtt-iu__table"
        data-dense={spec.dense ? '1' : undefined}
        data-zebra={spec.zebra ? '1' : undefined}
      >
        <thead>
          <tr>
            {spec.columns.map(col => {
              const active = state.sortKey === col.key
              return (
                <th
                  key={col.key}
                  className="dtt-iu__th"
                  role="button"
                  tabIndex={0}
                  aria-sort={active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  data-active={active ? '1' : undefined}
                  data-dir={active ? state.sortDir : undefined}
                  data-align={col.align}
                  onClick={() => { onSort(col.key) }}
                  onKeyDown={(e) => {
                    // role=button 语义要能被键盘驱动：Enter / Space 等同点击。
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSort(col.key)
                    }
                  }}
                >
                  {col.label}<span className="dtt-iu__arrow" aria-hidden="true">▼</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr className="dtt-iu__tr" key={i}>
              {spec.columns.map((col, j) => {
                const cell = row[j] ?? ''
                return (
                  <td className="dtt-iu__td" key={col.key} data-type={col.type} data-align={col.align}>
                    {typeof cell === 'number' ? formatNum(cell) : cell}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
