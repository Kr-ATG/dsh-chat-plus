/**
 * iu kind **diff** 的 React 体（client 专用）。
 *
 * ## Body 契约（见 bodies.ts / contract.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不自己画 Head / FillRow，也不额外包 div 外壳；
 *  · DOM 结构必须与 diff.ts 里的 `snapshot()` **逐字对齐**（class、层级、顺序），否则截图长歪；
 *  · 本地状态一律走 props 的 `state` / `setState`（外壳统一持久化，刷新不丢），不自己 useState。
 *
 * ## 与 snapshot 共用同一份 diff 结果
 *
 * rows 来自 diff.ts 的 `computeDiffRows`，视图排布来自 `buildDiffView`，工具条来自
 * `diffToolbar` —— 与 snapshot **同一批函数**。对话流里看到的高亮行 / 行号 / split 对齐，
 * 和截图里定格的是同一份计算结果，不会漂移。这里不重复实现任何 diff 逻辑。
 */

import { memo, useMemo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuDiffSpec, DiffState, DiffPill, SplitCell, UnifiedLine } from './diff.ts'
import { buildDiffView, computeDiffRows, diffCounts, diffToolbar } from './diff.ts'

/** unified 单行：两个行号槽 + 标记 + 文本（与 snapUnifiedLine 逐字对齐）。 */
function renderUnified(l: UnifiedLine, i: number): JSX.Element {
  return (
    <div className="dtt-iu__dline" data-type={l.type} key={i}>
      <span className="dtt-iu__dno">{l.beforeNo ?? ''}</span>
      <span className="dtt-iu__dno">{l.afterNo ?? ''}</span>
      <span className="dtt-iu__dmark">{l.mark}</span>
      <span className="dtt-iu__dtext">{l.text}</span>
    </div>
  )
}

/** split 单格：一个行号槽 + 标记 + 文本（与 snapSplitCell 逐字对齐；gap 也走同一形状）。 */
function renderSplit(c: SplitCell, i: number): JSX.Element {
  return (
    <div className="dtt-iu__dline" data-type={c.type} key={i}>
      <span className="dtt-iu__dno">{c.no ?? ''}</span>
      <span className="dtt-iu__dmark">{c.mark}</span>
      <span className="dtt-iu__dtext">{c.text}</span>
    </div>
  )
}

/** pill 的 id → 它要对 state 打的补丁。视图两颗动 unified，展开两颗动 expand。 */
const PILL_PATCH: Readonly<Record<DiffPill['id'], Partial<DiffState>>> = {
  unified: { unified: true },
  split: { unified: false },
  changed: { expand: false },
  all: { expand: true },
}

export const DiffBody = memo(function DiffBody(
  { spec, state, setState }: IuBodyProps<DiffState, IuDiffSpec>,
): JSX.Element {
  // rows 只依赖 before/after（内容不变就不重算 DP 表）；view 再随 unified/expand 排布。
  const rows = useMemo(() => computeDiffRows(spec.before, spec.after), [spec.before, spec.after])
  const counts = useMemo(() => diffCounts(rows), [rows])
  const view = useMemo(
    () => buildDiffView(rows, state.unified, state.expand),
    [rows, state.unified, state.expand],
  )
  const pills = useMemo(() => diffToolbar(state), [state])

  return (
    <>
      <div className="dtt-iu__diff-tools">
        {pills.map(p => (
          <button
            key={p.id}
            type="button"
            className="dtt-iu__diff-pill"
            data-active={p.active ? '1' : undefined}
            aria-pressed={p.active}
            onClick={() => { setState(PILL_PATCH[p.id]) }}
          >
            {p.label}
          </button>
        ))}
        <span className="dtt-iu__diff-stat">{`+${counts.add} \u2212${counts.del} 行`}</span>
        {spec.lang !== '' && <span className="dtt-iu__diff-lang">{spec.lang}</span>}
      </div>
      {view.unified ? (
        <div className="dtt-iu__diff">
          {view.lines.map(renderUnified)}
        </div>
      ) : (
        <div className="dtt-iu__diff--split">
          <div className="dtt-iu__dcol">{view.left.map(renderSplit)}</div>
          <div className="dtt-iu__dcol">{view.right.map(renderSplit)}</div>
        </div>
      )}
    </>
  )
})
