/**
 * iu kind **tabs** 的 React 体（client 专用）。
 *
 * 活动页下标走 props 的 state/setState（外壳统一持久化——刷新回到用户最后看
 * 的那页，老实现是组件内 useState，刷新回第 0 页）。DOM 与 tabs.ts 的
 * snapshot() 对齐：tabs 胶囊条 → panel（heading + body）。
 */

import { memo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuTabsSpec, TabsState } from './tabs.ts'

export const TabsBody = memo(function TabsBody(
  { spec, state, setState }: IuBodyProps<TabsState, IuTabsSpec>,
): JSX.Element {
  const safe = state.active < spec.tabs.length ? state.active : 0
  const tab = spec.tabs[safe]
  return (
    <>
      <div className="dtt-iu__tabs" role="tablist">
        {spec.tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === safe}
            className={i === safe ? 'dtt-iu__tab dtt-iu__tab--active' : 'dtt-iu__tab'}
            onClick={() => { setState({ active: i }) }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab !== undefined && (
        // key 绑定 safe：切页时 React 重建 panel，触发淡入动画。
        <div className="dtt-iu__panel" key={safe}>
          {tab.heading !== '' && <h4>{tab.heading}</h4>}
          {tab.body !== '' && <p>{tab.body}</p>}
        </div>
      )}
    </>
  )
})
