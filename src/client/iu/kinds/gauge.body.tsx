/**
 * iu kind **gauge** 的 React 体（client 专用）。
 *
 * ## Body 契约（见 bodies.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不画 Head / FillRow、不额外包 div；
 *  · DOM 结构与 gauge.ts 的 `snapshot()` **逐字对齐**（class、层级、顺序），
 *    且 SVG 几何**全部来自 gauge.ts 导出的 gaugeGeometry()**——路径 / dash /
 *    指针角度绝不在此重算，截图与对话流共用同一份坐标；
 *  · 状态走 props 的 state / setState（补丁 `{ active?: number }`），不自己 useState。
 *
 * 交互：多仪表横排（≤4），点击某个 → setState({ active: i })，active 项放大高亮
 * （data-active="true" + CSS scale/描边）。值弧与指针的入场动画在 CSS 里
 * （keyframes 只有 from 帧，终点 = 真实目标值），本文件只把目标值写进
 * stroke-dashoffset 属性与 --g-full / --g-rot 变量，不算坐标、不写动画。
 */

import { memo } from 'react'
import type { CSSProperties } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { GaugeState, IuGaugeSpec } from './gauge.ts'
import { gaugeGeometry } from './gauge.ts'
import { formatNum, num } from './core.ts'

export const GaugeBody = memo(function GaugeBody(
  { spec, state, setState }: IuBodyProps<GaugeState, IuGaugeSpec>,
): JSX.Element {
  const count = spec.gauges.length
  // 持久化的 active 可能越界（比如老消息里仪表更多），渲染前钳一次。
  const active = num(state.active, 0, count - 1, 0)
  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__gauges">
        {spec.gauges.map((g, i) => {
          const geo = gaugeGeometry(g, i, spec.shape)
          const isActive = i === active
          const needle = geo.needle !== undefined ? (
            <line
              className="dtt-iu__gneedle"
              x1={geo.needle.x1}
              y1={geo.needle.y1}
              x2={geo.needle.x2}
              y2={geo.needle.y2}
              stroke={geo.color}
              // 角度走 CSS 变量（.gneedle 的 transform: rotate(var(--g-rot))），与入场
              // 动画同处 CSS transform 空间，摆动顺滑；快照内联 animation:none 定格。
              style={{ '--g-rot': `${geo.needle.rotDeg}deg` } as CSSProperties}
            />
          ) : null
          return (
            <div
              className="dtt-iu__gauge"
              key={i}
              data-active={isActive ? 'true' : 'false'}
              data-shape={spec.shape}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              aria-label={`${g.label} ${formatNum(g.value)}${g.unit}`}
              onClick={() => { setState({ active: i }) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setState({ active: i })
                }
              }}
            >
              {/* svg 上带 color：中心读数 text 用 fill: currentColor 取它（snapshot 同）。 */}
              <svg className="dtt-iu__gsvg" viewBox={geo.viewBox} style={{ color: geo.color }}>
                <path className="dtt-iu__gtrack" d={geo.trackD} />
                <path
                  className="dtt-iu__gbar"
                  d={geo.barD}
                  stroke={geo.color}
                  strokeDasharray={geo.dashLen}
                  strokeDashoffset={geo.dashOffset}
                  // 入场动画的起点（满偏移）通过 CSS 变量喂给 @keyframes 的 from 帧。
                  style={{ '--g-full': geo.dashLen } as CSSProperties}
                />
                {needle}
                <text
                  className="dtt-iu__gval"
                  x={geo.textX}
                  y={geo.textY}
                  dominantBaseline={geo.textBaseline === 'middle' ? 'middle' : undefined}
                >
                  {formatNum(g.value)}
                </text>
              </svg>
              <div className="dtt-iu__glabel">
                <span className="dtt-iu__gname">{g.label}</span>
                <b className="dtt-iu__gread" style={{ color: geo.color }}>
                  {formatNum(g.value)}
                  {g.unit !== '' && <span className="dtt-iu__gunit">{g.unit}</span>}
                </b>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
})
