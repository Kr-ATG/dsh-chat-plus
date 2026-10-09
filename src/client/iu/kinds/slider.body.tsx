/**
 * iu kind **slider** 的 React 体（client 专用）。
 *
 * 这是所有 .body.tsx 的**范本**：新增 kind 请照抄本文件的结构。
 *
 * ## Body 契约（务必遵守，见 bodies.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不要自己画 Head / FillRow；
 *  · DOM 结构必须与同名 .ts 里的 `snapshot()` **逐字对齐**（class、层级、顺序），
 *    否则截图会长歪；
 *  · 本地状态一律走 props 的 `state` / `setState`，**不要**自己 useState——
 *    状态由外壳统一持久化（刷新不丢）。setState 支持补丁对象或函数式补丁。
 */

import { memo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuSliderSpec, SliderState } from './slider.ts'
import { formatNum } from './core.ts'

export const SliderBody = memo(function SliderBody(
  { spec, state, setState }: IuBodyProps<SliderState, IuSliderSpec>,
): JSX.Element {
  const value = state.value
  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__slider-top">
        <span className="dtt-iu__slider-val">{formatNum(value)}</span>
        {spec.unit !== '' && <span className="dtt-iu__slider-unit">{spec.unit}</span>}
      </div>
      <input
        type="range"
        className="dtt-iu__range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        aria-label={spec.title}
        onChange={(e) => { setState({ value: Number(e.currentTarget.value) }) }}
      />
      {spec.outputs.length > 0 && (
        <div className="dtt-iu__outs">
          {spec.outputs.map((o, i) => (
            <div className="dtt-iu__out" key={i}>
              <b>{formatNum(value * o.per)}{o.unit}</b>
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
})
