/**
 * iu kind **arch** 的 React 体（client 专用）。
 *
 * 结构照抄范本 slider.body.tsx / timeline.body.tsx。Body 契约（见 bodies.ts /
 * contract.ts）：
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不自己画 Head / FillRow，
 *    也不额外包 div 外壳；
 *  · DOM 与 arch.ts 的 `snapshot()` **逐字对齐**：desc? → .dtt-iu__arch →
 *    每层 .dtt-iu__alayer[data-tone][data-expanded] > .dtt-iu__alabel
 *    （span.dtt-iu__abar + 层名）+ .dtt-iu__aboxes > .dtt-iu__abox[data-dim]
 *    （b.dtt-iu__abox-name + small.dtt-iu__abox-note?）；fromLayer 命中的层后
 *    跟 .dtt-iu__alink（span.dtt-iu__alink-label?）。竖线本体是 ::before
 *    伪元素，两侧都不在 DOM 里。**note 非空即恒渲染**（收起是 CSS 态，
 *    不是条件渲染）——snapshot 无交互，这样两侧结构永远一致；
 *  · 状态走 props 的 state / setState（外壳统一持久化），**不**自己 useState。
 *    setState 用补丁对象 { expanded }。
 *
 * 交互：整条层带是可点的 accordion 头（点一下「钉住」展开该层全部 note、
 * 再点收起；换层则换钉住），键盘 Enter/Space 等价；hover 单盒临时显 note
 * 是纯 CSS，与钉住并存（见 arch.ts 的 CSS）。
 */

import { Fragment, memo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuArchSpec, ArchState } from './arch.ts'
import { expandedOf } from './arch.ts'

export const ArchBody = memo(function ArchBody(
  { spec, state, setState }: IuBodyProps<ArchState, IuArchSpec>,
): JSX.Element {
  const expanded = expandedOf(spec, state)
  const toggle = (i: number): void => {
    setState({ expanded: expanded === i ? null : i })
  }
  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__arch">
        {spec.layers.map((layer, i) => {
          const open = expanded === i
          // 层带与紧随其后的层间连线是一个整体（与 snapshot 的 parts 顺序一致）
          return (
            <Fragment key={i}>
              <div
                className="dtt-iu__alayer"
                data-tone={layer.tone}
                data-expanded={open ? '1' : '0'}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                aria-label={layer.label}
                onClick={() => { toggle(i) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggle(i)
                  }
                }}
              >
                <div className="dtt-iu__alabel">
                  <span className="dtt-iu__abar" aria-hidden />
                  {layer.label}
                </div>
                <div className="dtt-iu__aboxes">
                  {layer.boxes.map((b, j) => (
                    <div className="dtt-iu__abox" data-dim={b.dim ? '1' : '0'} key={j}>
                      <b className="dtt-iu__abox-name">{b.label}</b>
                      {b.note !== '' && <small className="dtt-iu__abox-note">{b.note}</small>}
                    </div>
                  ))}
                </div>
              </div>
              {spec.links
                .filter(link => link.fromLayer === i)
                .map((link, k) => (
                  <div className="dtt-iu__alink" aria-hidden key={k}>
                    {link.label !== '' && <span className="dtt-iu__alink-label">{link.label}</span>}
                  </div>
                ))}
            </Fragment>
          )
        })}
      </div>
    </>
  )
})
