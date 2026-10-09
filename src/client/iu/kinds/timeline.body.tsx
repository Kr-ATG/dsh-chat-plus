/**
 * iu kind **timeline** 的 React 体（client 专用）。
 *
 * 结构照抄范本 slider.body.tsx。Body 契约（见 bodies.ts / contract.ts）：
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不自己画 Head / FillRow，
 *    也不额外包 div 外壳；
 *  · DOM 与 timeline.ts 的 `snapshot()` **逐字对齐**：desc → .dtt-iu__timeline
 *    [data-orient] → 每项 .dtt-iu__tl-item[data-status][data-expanded] →
 *    .dtt-iu__tl-node + .dtt-iu__tl-content（date? + label + body?）。
 *    连接线是 CSS ::before 伪元素，两侧都不出现在 DOM 里；
 *  · 状态走 props 的 state / setState（外壳统一持久化），**不**自己 useState。
 *    setState 用补丁对象 { expanded }。
 *
 * 交互：竖向视图下每项是可点的 accordion 头（点一下展开 body、再点收起；
 * 换项则换展开），键盘 Enter/Space 等价；横向视图不提供展开（窄列里塞正文
 * 没有可读性），expandedOf 恒回 null，且不下发 role/tabIndex/handlers。
 */

import { memo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuTimelineSpec, TimelineState } from './timeline.ts'
import { expandedOf } from './timeline.ts'

export const TimelineBody = memo(function TimelineBody(
  { spec, state, setState }: IuBodyProps<TimelineState, IuTimelineSpec>,
): JSX.Element {
  const vertical = spec.orientation === 'vertical'
  const expanded = expandedOf(spec, state)
  const toggle = (i: number): void => {
    setState({ expanded: expanded === i ? null : i })
  }
  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__timeline" data-orient={spec.orientation}>
        {spec.items.map((it, i) => {
          const open = expanded === i
          return (
            <div
              key={i}
              className="dtt-iu__tl-item"
              data-status={it.status}
              data-expanded={open ? '1' : '0'}
              role={vertical ? 'button' : undefined}
              tabIndex={vertical ? 0 : undefined}
              aria-expanded={vertical ? open : undefined}
              aria-label={vertical ? it.label : undefined}
              onClick={vertical ? () => { toggle(i) } : undefined}
              onKeyDown={vertical
                ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggle(i)
                  }
                }
                : undefined}
            >
              <span className="dtt-iu__tl-node" aria-hidden>
                {it.icon !== ''
                  ? it.icon
                  : (it.status === 'done' ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.8 5.2 4 7.4 8.2 2.6" />
                    </svg>
                  ) : null)}
              </span>
              <div className="dtt-iu__tl-content">
                {it.date !== '' && <span className="dtt-iu__tl-date">{it.date}</span>}
                <span className="dtt-iu__tl-label">{it.label}</span>
                {it.body !== '' && <div className="dtt-iu__tl-body">{it.body}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
})
