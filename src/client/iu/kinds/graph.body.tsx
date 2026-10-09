/**
 * iu kind **graph** 的 React 体（client 专用）。
 *
 * ## Body 契约（见 bodies.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不画 Head / FillRow、不额外包 div；
 *  · DOM 结构与 graph.ts 的 `snapshot()` **逐字对齐**（desc → tools → wrap>svg(defs+edges+nodes) → legend）；
 *  · SVG 几何**全部来自 graph.ts 的 layoutGraph()**——分层/坐标/折线路径绝不在此重算，
 *    截图与对话流共用同一份布局输出（同 gauge.body.tsx 消费 gaugeGeometry 的纪律）；
 *  · 持久化状态走 props 的 state / setState（补丁 `{ mode?, selected? }`），不自己 useState；
 *    hover 是瞬态高亮（不持久化），用本地 useState 即可，snapshot 无 hover 所以两边仍对齐。
 *
 * 交互：
 *  · 工具条两颗 pill 切 fit / large（参照 diff.body.tsx 的 data-active 手法）；
 *  · 节点 hover / 选中 → 给相连的边与对端节点打 `data-linked="1"`、svg 打 `data-hover="1"`，
 *    CSS 据此把无关元素淡出、相连边加粗（纯属性选择器，不用 :has，实现简单可靠）；
 *  · 点击节点切换 selected（视觉强调），键盘 Enter/Space 等价，焦点环走 :focus-visible。
 */

import { memo, useId, useMemo, useState } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { GraphState, IuGraphSpec } from './graph.ts'
import {
  graphDiamondPoints, graphLegendItems, graphNodeRx, graphSvgStyle, graphTagRect, graphTextYs, layoutGraph,
} from './graph.ts'
import type { GraphLayoutEdge, GraphLayoutNode } from './graph.ts'

/**
 * 一条边 = path + 可选 label 组，两者是 `.dtt-iu__gedges` 下的**兄弟**（与 snapshot 结构一致，
 * 不额外包 g）。data-linked 直接打在 path 与 label 组上——CSS 的淡出/加粗选择器正是按这两个
 * class 上的 [data-linked] 写的。返回 Fragment 以产出两个兄弟节点。
 */
function EdgeView({ e, marker, markerA, linked }: {
  readonly e: GraphLayoutEdge
  readonly marker: string
  readonly markerA: string
  readonly linked: boolean
}): JSX.Element {
  const tag = e.label !== '' ? graphTagRect(e) : undefined
  const linkedAttr = linked ? '1' : undefined
  return (
    <>
      <path
        className="dtt-iu__gedge"
        d={e.path}
        data-accent={e.accent ? '1' : undefined}
        data-dashed={e.dashed ? '1' : undefined}
        data-from={e.from}
        data-to={e.to}
        data-linked={linkedAttr}
        markerEnd={`url(#${e.accent ? markerA : marker})`}
      />
      {tag !== undefined && (
        <g className="dtt-iu__gedgelabel" data-linked={linkedAttr}>
          <rect className="dtt-iu__gtagbg" x={tag.x} y={tag.y} width={tag.w} height={tag.h} rx={3} />
          <text className="dtt-iu__gtag" x={tag.tx} y={tag.ty}>{e.label}</text>
        </g>
      )}
    </>
  )
}

function NodeView({ nd, selected, linked, onEnter, onSelect }: {
  readonly nd: GraphLayoutNode
  readonly selected: boolean
  readonly linked: boolean
  readonly onEnter: () => void
  readonly onSelect: () => void
}): JSX.Element {
  const ty = graphTextYs(nd)
  return (
    <g
      className="dtt-iu__gnode"
      data-id={nd.id}
      data-shape={nd.shape}
      data-focal={nd.focal ? '1' : '0'}
      data-selected={selected ? '1' : '0'}
      data-linked={linked ? '1' : undefined}
      tabIndex={0}
      role="button"
      aria-label={nd.label}
      aria-pressed={selected}
      onMouseEnter={onEnter}
      onClick={onSelect}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          onSelect()
        }
      }}
    >
      {nd.shape === 'diamond' ? (
        <polygon points={graphDiamondPoints(nd)} />
      ) : (
        <rect x={nd.x} y={nd.y} width={nd.w} height={nd.h} rx={graphNodeRx(nd)} />
      )}
      <text className="dtt-iu__glabel" x={nd.cx} y={ty.labelY}>{nd.label}</text>
      {ty.subY !== undefined && <text className="dtt-iu__gsub" x={nd.cx} y={ty.subY}>{nd.sub}</text>}
    </g>
  )
}

export const GraphBody = memo(function GraphBody(
  { spec, state, setState }: IuBodyProps<GraphState, IuGraphSpec>,
): JSX.Element {
  const uid = useId().replace(/:/g, '')
  const marker = 'ig-arr-' + uid
  const markerA = 'ig-arr-a-' + uid

  // 布局是纯函数、只依赖 spec：用 useMemo 缓存，Body 与 snapshot 拿到的是同一份算法输出。
  const lay = useMemo(() => layoutGraph(spec), [spec])

  const mode = state.mode === 'large' ? 'large' : 'fit'
  const selected = typeof state.selected === 'string' ? state.selected : null
  const [hover, setHover] = useState<string | null>(null)

  // hover 优先，其次 selected；两者都空 → 不高亮任何元素（data-hover 缺省）。
  const active = hover ?? selected
  const linkedSet = useMemo(() => {
    const set = new Set<string>()
    if (active === null) return set
    set.add(active)
    for (const e of lay.edges) {
      if (e.from === active) set.add(e.to)
      else if (e.to === active) set.add(e.from)
    }
    return set
  }, [active, lay.edges])

  const items = useMemo(() => graphLegendItems(spec), [spec])
  const style = graphSvgStyle(lay, mode)

  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__graph-tools">
        {([['fit', '适应'], ['large', '放大']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="dtt-iu__graph-pill"
            data-active={mode === value ? '1' : undefined}
            aria-pressed={mode === value}
            onClick={() => { setState({ mode: value }) }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dtt-iu__graph-wrap">
        <svg
          className="dtt-iu__graph"
          data-mode={mode}
          viewBox={`0 0 ${lay.vbW} ${lay.vbH}`}
          style={style}
          data-hover={active !== null ? '1' : undefined}
          role="img"
          aria-label={spec.title}
          onMouseLeave={() => { setHover(null) }}
        >
          <defs>
            <marker id={marker} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" className="dtt-iu__garrow" />
            </marker>
            <marker id={markerA} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" className="dtt-iu__garrow-a" />
            </marker>
          </defs>
          <g className="dtt-iu__gedges">
            {lay.edges.map((e, i) => (
              <EdgeView
                key={i}
                e={e}
                marker={marker}
                markerA={markerA}
                linked={active !== null && (e.from === active || e.to === active)}
              />
            ))}
          </g>
          <g className="dtt-iu__gnodes">
            {lay.nodes.map(nd => (
              <NodeView
                key={nd.id}
                nd={nd}
                selected={selected === nd.id}
                linked={linkedSet.has(nd.id)}
                onEnter={() => { setHover(nd.id) }}
                onSelect={() => { setState(prev => ({ selected: prev.selected === nd.id ? null : nd.id })) }}
              />
            ))}
          </g>
        </svg>
      </div>
      {items.length > 0 && (
        <div className="dtt-iu__graph-legend">
          {items.map(it => (
            <span className="dtt-iu__gleg" key={it.kind}>
              <svg viewBox="0 0 40 20" aria-hidden="true">
                {it.kind === 'diamond'
                  ? <polygon className="dtt-iu__glegshape" points="20,2 37,10 20,18 3,10" />
                  : <rect
                      className="dtt-iu__glegshape"
                      data-focal={it.kind === 'focal' ? '1' : undefined}
                      x={3} y={3} width={34} height={14}
                      rx={it.kind === 'oval' ? 7 : 4}
                    />}
              </svg>
              <i>{it.label}</i>
            </span>
          ))}
        </div>
      )}
    </>
  )
})
