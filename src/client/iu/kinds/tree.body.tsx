/**
 * iu kind **tree** 的 React 体（client 专用）。
 *
 * ## Body 契约（见 bodies.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不自己画 Head / FillRow、不额外包外壳；
 *  · DOM 结构与 tree.ts 的 `snapshot()` **逐字对齐**——两侧共用 tree.ts 导出的
 *    `treeGroups()`（flattenTree + groupTreeRows）这同一份可见性与层级判定，
 *    Body 里绝不另写一套树遍历；
 *  · 本地状态一律走 props 的 `state` / `setState`（补丁对象），**不要** useState。
 */

import { memo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuTreeGroup, IuTreeSpec, TreeState } from './tree.ts'
import { readCollapsed, treeGroups } from './tree.ts'

/** 一次折叠切换：toggle 目标 id 在 collapsed 里的存在，其余原样保留。 */
function toggleCollapsed(prev: readonly string[], id: string): string[] {
  return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
}

interface GroupListProps {
  readonly groups: readonly IuTreeGroup[]
  readonly onToggle: (id: string) => void
}

/**
 * 内部递归组件：把 IuTreeGroup 映射成 tnode → trow + tkids 的 DOM。
 *
 * 层级由数据（groupTreeRows 的栈算法）决定，组件只做同构渲染——与
 * snapshot 的 groupsHtml() 一一对应（class、顺序、data-* 属性全同）。
 */
const GroupList = memo(function GroupList({ groups, onToggle }: GroupListProps): JSX.Element {
  return (
    <>
      {groups.map((g) => {
        const { node, hasKids, collapsed } = g.row
        const kids = g.kids.length > 0
          ? <div className="dtt-iu__tkids"><GroupList groups={g.kids} onToggle={onToggle} /></div>
          : null
        return (
          <div
            key={node.id}
            className="dtt-iu__tnode"
            data-depth={g.row.depth}
            data-leaf={hasKids ? '0' : '1'}
            data-collapsed={collapsed ? '1' : '0'}
          >
            <div
              className="dtt-iu__trow"
              role={hasKids ? 'button' : undefined}
              tabIndex={hasKids ? 0 : undefined}
              aria-expanded={hasKids ? !collapsed : undefined}
              onClick={hasKids ? () => { onToggle(node.id) } : undefined}
              onKeyDown={hasKids
                ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault()
                    onToggle(node.id)
                  }
                }
                : undefined}
            >
              {/* 叶子也渲染空 twist 占位，保证各行 label 起始位置对齐 */}
              <span className="dtt-iu__twist" aria-hidden>{hasKids ? '▸' : ''}</span>
              {node.icon !== '' && <span className="dtt-iu__ticon">{node.icon}</span>}
              <span className="dtt-iu__tlabel">{node.label}</span>
              {node.note !== '' && <span className="dtt-iu__tnote">{node.note}</span>}
            </div>
            {kids}
          </div>
        )
      })}
    </>
  )
})

export const TreeBody = memo(function TreeBody(
  { spec, state, setState }: IuBodyProps<TreeState, IuTreeSpec>,
): JSX.Element {
  // 折叠集合每次渲染现算（≤200 节点，成本可忽略）；readCollapsed 同时兜住
  // localStorage 里的脏数据（非字符串项、重复项）。
  const groups = treeGroups(spec.root, new Set(readCollapsed(state.collapsed)))
  // 函数式补丁：基于外壳的真实 prev 计算，快速连点不同节点也不会丢更新。
  const onToggle = (id: string): void => {
    setState(prev => ({ collapsed: toggleCollapsed(readCollapsed(prev.collapsed), id) }))
  }
  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__tree">
        <GroupList groups={groups} onToggle={onToggle} />
      </div>
    </>
  )
})
