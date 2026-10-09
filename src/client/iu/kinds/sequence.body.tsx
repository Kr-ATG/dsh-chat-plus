/**
 * iu kind **sequence** 的 React 体（client 专用）。
 *
 * ## Body 契约（见 bodies.ts / contract.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不画 Head / FillRow、不额外包 div；
 *  · DOM 结构与 sequence.ts 的 `snapshot()` **逐字对齐**（class、层级、顺序、
 *    marker id、几何属性），且 SVG 坐标**全部来自 sequence.ts 导出的
 *    layoutSequence()**——列 x / 消息 y / 箭头路径 / 标签位绝不在此重算，
 *    截图与对话流共用同一份布局；
 *  · 持久化状态走 props 的 state / setState（补丁 `{ step?: number }`），不自己 useState。
 *
 * ## step 播放与 data-hidden 对齐手法
 *
 * 消息元素**恒在 DOM**：step>0 时只给未播到的消息打 data-hidden="1"（CSS
 * opacity:0 + pointer-events:none），绝不条件渲染删节点——任何 step 下 Body 的
 * 结构都与 snapshot（step=0，data-hidden 不出现）一致。入场动画在 CSS 里只对
 * :not([data-hidden="1"]) 挂（见 sequence.ts），解除隐藏的刹那动画重启 = 新消息
 * 淡入滑下；可见性本身不依赖动画（opacity 终值立即生效）。
 *
 * ## 两处瞬态用本地 useState（不进持久化，同 piano 的 held）
 *  · `litIds`：hover 某条消息时点亮它两端的头盒。CSS 无法「按被 hover 消息的
 *    data-act 值匹配同值 data-id 的头盒」（属性值不可参数化），所以联动由 JS 在
 *    onMouseEnter/Leave 时加/去 `.dtt-iu__seq-head--lit`。snapshot 无 hover，恒不带 --lit。
 *
 * ## 与 snapshot 的唯一刻意差异
 *  · 入场动画：snapshot 给每条消息内联 animation:none 定格；Body 走 CSS 的 --i
 *    逐条错峰。这是内联样式差异，不是 DOM 结构差异，class / 层级完全一致。
 */

import { memo, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuSequenceSpec, SequenceState, SeqMsgLayout, SeqPill } from './sequence.ts'
import { layoutSequence, seqCountText, seqToolbar, stepOf } from './sequence.ts'

/** marker id 固定字面量，与 snapshot 逐字相同（对齐优先于同页多卡的 id 唯一——
 *  两份 marker 定义逐字一致，撞 id 时 url(#…) 解析到第一个，渲染无差别）。 */
const SOLID_MARKER = 'dsh-seq-a'
const OPEN_MARKER = 'dsh-seq-o'

export const SequenceBody = memo(function SequenceBody(
  { spec, state, setState }: IuBodyProps<SequenceState, IuSequenceSpec>,
): JSX.Element {
  // 几何只依赖 spec（内容不变就不重算），step / hover 是渲染态。
  const L = useMemo(() => layoutSequence(spec), [spec])
  const total = spec.messages.length
  // 持久化的 step 可能越界 / 脏数据，渲染前钳一次（与 fillText 同一个 stepOf）。
  const step = stepOf(spec, state)
  const pills = useMemo(() => seqToolbar(step), [step])

  // hover 联动的瞬态：当前点亮的头盒 id 集合（不持久化）。
  const [litIds, setLitIds] = useState<ReadonlySet<string>>(() => new Set())

  const onPill = (id: SeqPill['id']): void => {
    if (id === 'all') setState({ step: 0 })
    else if (id === 'next') setState({ step: step === 0 ? 1 : Math.min(total, step + 1) })
    else setState({ step: step <= 1 ? 0 : step - 1 })
  }

  /** 一条消息（与 snapshot 的 msgHtml 逐字对齐；多了 data-hidden 裁剪与 --i 错峰）。 */
  const renderMsg = (m: SeqMsgLayout): JSX.Element => {
    const hidden = step > 0 && m.index >= step
    const hasAct = m.actX !== undefined && m.actY !== undefined && m.actH !== undefined
    const hasLabel = m.text !== '' && m.labelW !== undefined && m.labelH !== undefined
    // 底块 x：非 self 居中（labelX − w/2）；self 是 start 对齐，底块从 labelX−6 起
    // （与 sequence.ts 的 bgX 完全一致；text-anchor 由 CSS 的 [data-self="1"] 规则给）。
    const bgX = m.self ? m.labelX - 6 : m.labelX - (m.labelW as number) / 2
    return (
      <g
        key={m.index}
        className="dtt-iu__seq-msg"
        data-ret={m.ret ? '1' : '0'}
        data-self={m.self ? '1' : '0'}
        data-act={`${m.from} ${m.to}`}
        data-hidden={hidden ? '1' : undefined}
        // --i 喂给 CSS 的 animation-delay 逐条错峰；snapshot 那边内联 animation:none 定格。
        style={{ '--i': m.index } as CSSProperties}
        onMouseEnter={() => { setLitIds(new Set([m.from, m.to])) }}
        onMouseLeave={() => { setLitIds(prev => (prev.size === 0 ? prev : new Set())) }}
      >
        {hasAct && (
          <rect className="dtt-iu__seq-act" x={m.actX} y={m.actY} width={8} height={m.actH} rx={2} />
        )}
        <path
          className="dtt-iu__seq-arrow"
          d={m.path}
          strokeDasharray={m.ret ? '5 4' : undefined}
          markerEnd={`url(#${m.ret ? OPEN_MARKER : SOLID_MARKER})`}
        />
        {hasLabel && (
          <g className="dtt-iu__seq-label">
            <rect
              className="dtt-iu__seq-lbg"
              x={Math.round(bgX * 100) / 100}
              y={m.labelY - 11}
              width={m.labelW}
              height={m.labelH}
            />
            <text className="dtt-iu__seq-ltext" x={m.labelX} y={m.labelY}>{m.text}</text>
          </g>
        )}
      </g>
    )
  }

  const headClass = (id: string, foot: boolean): string => {
    const lit = litIds.has(id) ? ' dtt-iu__seq-head--lit' : ''
    return foot ? `dtt-iu__seq-head dtt-iu__seq-head--foot${lit}` : `dtt-iu__seq-head${lit}`
  }

  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__seq-tools">
        {pills.map(p => (
          <button
            key={p.id}
            type="button"
            className="dtt-iu__seq-pill"
            data-active={p.active ? '1' : undefined}
            aria-pressed={p.active}
            aria-label={p.id === 'prev' ? '上一步' : p.id === 'next' ? '下一步' : '显示全部'}
            onClick={() => { onPill(p.id) }}
          >
            {p.label}
          </button>
        ))}
        <span className="dtt-iu__seq-count">{seqCountText(step, total)}</span>
      </div>
      <div className="dtt-iu__seq-wrap">
        <svg className="dtt-iu__seq" viewBox={L.viewBox} role="img" aria-label={spec.title}>
          <defs>
            <marker id={SOLID_MARKER} markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
              <polygon points="0 0.6, 8 4, 0 7.4" fill="#4f5d75" />
            </marker>
            <marker id={OPEN_MARKER} markerWidth="10" markerHeight="9" refX="9" refY="4.5" orient="auto">
              <polygon points="0 1, 9 4.5, 0 8" fill="#ffffff" stroke="#4f5d75" strokeWidth="1.2" />
            </marker>
          </defs>
          <g className="dtt-iu__seq-lives">
            {L.actors.map(a => (
              <line key={a.id} className="dtt-iu__seq-life" x1={a.x} y1={L.lifeY1} x2={a.x} y2={L.lifeY2} />
            ))}
          </g>
          <g className="dtt-iu__seq-heads">
            {L.actors.map(a => (
              <g key={a.id} className={headClass(a.id, false)} data-tone={a.tone} data-id={a.id}>
                <rect x={Math.round((a.x - a.headW / 2) * 100) / 100} y={L.headY} width={a.headW} height={L.headH} rx={7} />
                <text x={a.x} y={L.headTextY}>{a.label}</text>
              </g>
            ))}
          </g>
          <g className="dtt-iu__seq-msgs">
            {L.msgs.map(renderMsg)}
          </g>
          {L.foot && (
            <g className="dtt-iu__seq-heads--foot">
              {L.actors.map(a => (
                <g key={a.id} className={headClass(a.id, true)} data-tone={a.tone} data-id={a.id}>
                  <rect x={Math.round((a.x - a.headW / 2) * 100) / 100} y={L.footY} width={a.headW} height={L.headH} rx={7} />
                  <text x={a.x} y={Math.round((L.footY + L.headTextY) * 100) / 100}>{a.label}</text>
                </g>
              ))}
            </g>
          )}
        </svg>
      </div>
    </>
  )
})
