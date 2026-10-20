/**
 * dsh-chat-plus — 可交互原型卡片（proto-tabs 围栏的渲染器）。
 *
 * 三种 pill 形态：pill（信息分层）/ expand（可展开卡片）/ glow（AI 流光）。
 * 纯展示组件：解析失败由 parse 层挡掉，这里不抛错；动效尊重
 * prefers-reduced-motion（见 proto/styles.ts）。
 */
import { memo, useState } from 'react'
import type { ProtoSpec, ProtoTab } from './parse.ts'

function variantOf(tab: ProtoTab): 'pill' | 'expand' | 'glow' {
  if (tab.variant !== undefined) return tab.variant
  return 'pill'
}

function Minis({ tab }: { readonly tab: ProtoTab }): JSX.Element | null {
  if (tab.minis.length === 0) return null
  return (
    <div className="dtt-proto__minis">
      {tab.minis.map((m, i) => (
        <div className="dtt-proto__mini" key={i}>
          <b>{m.t}</b>
          <span>{m.d}</span>
        </div>
      ))}
    </div>
  )
}

/** 流式占位（与 iu / html / diagram 同构）。普通函数而非组件：闭合时复用同一 <div>。 */
function pendingStage(bytes: number): JSX.Element {
  return (
    <div className="dtt-pt-stage--pending" aria-busy="true" aria-live="polite">
      <span className="dtt-pt-pending-dot" />
      <span className="dtt-pt-pending-text">正在整理…</span>
      <span className="dtt-pt-pending-bytes">{bytes} 字</span>
    </div>
  )
}

export const ProtoTabsCard = memo(function ProtoTabsCard({ spec, pending = false, bytes = 0 }: {
  readonly spec?: ProtoSpec | undefined
  /** 流式期围栏未闭合 → 只渲染占位，不解析半截 JSON。 */
  readonly pending?: boolean
  readonly bytes?: number
}): JSX.Element | null {
  if (pending || spec === undefined) return <div className="dtt-proto">{pendingStage(bytes)}</div>
  return <ProtoTabsLive spec={spec} />
})

const ProtoTabsLive = memo(function ProtoTabsLive({ spec }: {
  readonly spec: ProtoSpec
}): JSX.Element | null {
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const safeActive = active < spec.tabs.length ? active : 0
  const tab = spec.tabs[safeActive]
  if (tab === undefined) return null
  const variant = variantOf(tab)
  const pick = (i: number): void => {
    setActive(i)
    setOpen(false)
  }
  return (
    <div className="dtt-proto">
      <div className="dtt-proto__head">
        <div className="dtt-proto__title">
          <span className="dtt-proto__dot" aria-hidden />
          <span>{spec.title}</span>
        </div>
        <div className="dtt-proto__tabs" role="tablist">
          {spec.tabs.map((t, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === safeActive}
              className={i === safeActive ? 'dtt-proto__tab dtt-proto__tab--active' : 'dtt-proto__tab'}
              onClick={() => { pick(i) }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="dtt-proto__panel" key={safeActive}>
        <div className="dtt-proto__heading">{tab.heading}</div>
        {variant === 'pill' && (
          <div>
            <div
              className={open ? 'dtt-proto__pill dtt-proto__pill--open' : 'dtt-proto__pill'}
              onClick={() => { setOpen(!open) }}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
            >
              <span className="dtt-proto__bulb" aria-hidden />
              <span className="dtt-proto__tag">{tab.pill.tag}</span>
              <span className="dtt-proto__desc">{tab.pill.desc}</span>
              <span className="dtt-proto__arrow" aria-hidden>›</span>
            </div>
            {open && <div className="dtt-proto__detail">{tab.pill.detail}</div>}
          </div>
        )}
        {variant === 'expand' && (
          <div className="dtt-proto__expand">
            <div
              className="dtt-proto__expand-head"
              onClick={() => { setOpen(!open) }}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
            >
              <span className="dtt-proto__bulb" aria-hidden />
              <span className="dtt-proto__tag">{tab.pill.tag}</span>
              <span className="dtt-proto__desc">{tab.pill.desc}</span>
              <span className={open ? 'dtt-proto__arrow dtt-proto__arrow--open' : 'dtt-proto__arrow'} aria-hidden>›</span>
            </div>
            {open && <div className="dtt-proto__expand-body">{tab.pill.detail}</div>}
          </div>
        )}
        {variant === 'glow' && (
          <div>
            <div
              className="dtt-proto__glow"
              onClick={() => { setOpen(!open) }}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
            >
              <div className="dtt-proto__glow-inner">
                <span className="dtt-proto__spark" aria-hidden>✦</span>
                <span className="dtt-proto__tag dtt-proto__tag--dark">{tab.pill.tag}</span>
                <span className="dtt-proto__desc dtt-proto__desc--dark">{tab.pill.desc}</span>
                <span className="dtt-proto__arrow dtt-proto__arrow--dark" aria-hidden>›</span>
              </div>
            </div>
            {open && <div className="dtt-proto__detail">{tab.pill.detail}</div>}
          </div>
        )}
        <Minis tab={tab} />
      </div>
      <div className="dtt-proto__hint">Tab / 卡片都可以直接点击体验</div>
    </div>
  )
})
