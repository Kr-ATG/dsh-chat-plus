/**
 * EffortSeat — 推理等级滑动式弹出，接管 composer 的模型座位
 * （`conversation.input.model`，位于模型名右侧）。
 *
 * 透明无框的悬停按钮弹出实色面板：面板内的滑杆本身没有轨道长条底色，只有
 * 画布上的光尘，从左端漂向当前档位并被吸收（深浅主题各自配色）。档位由刻度点
 * 与档位名标识，滑块是一颗带呼吸光环的主色圆点。拖动 / 点击刻度 / 点击档位名
 * 即可切换，色相随等级在品牌蓝 → 靛紫间漂移，切换瞬间在滑块处散开一圈火星。
 * 选择与模型座位、`/model` 弹窗共享同一 ModelDirectory。
 */
import {
  useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelSeatInjected } from './types'
import { ParticleField, type ParticleFieldHandle } from './ParticleField'
import { css, effortHue, ensureStyles, hueColor } from './styles'

interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

export type EffortSeatProps = ModelSeatInjected & { locked?: boolean }

/**
 * 渲染推理等级入口 + 滑动式弹出。
 * 注册在 `conversation.input.model`（接管模型座位），位于模型名右侧。
 */
export function EffortSeat({ available, directory, load, select, locked }: EffortSeatProps) {
  ensureStyles()
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  // 关闭动画态：先播下沉淡出（.13s），结束后再真正卸载面板
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  // hover 移出后的延迟关闭定时器（悬停交互，与提示词优化卡片一致）
  const hoverLeaveTimer = useRef<number | null>(null)
  // 键盘调节后的「复位预览态」定时器：连按方向键时前一个必须先取消，
  // 否则它会在用户已经移到下一档时把预览态清掉（滑块自己跳回去）。
  const previewResetTimer = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // 档位切换被 host 拒绝时的说明（此前完全静默）。
  const [switchError, setSwitchError] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sliderRef = useRef<HTMLDivElement | null>(null)
  const particleRef = useRef<ParticleFieldHandle | null>(null)
  // 上一次迸发火花对应的档位（避免打开面板时立刻放一次多余的火花）。
  const lastBurstIndex = useRef<number | null>(null)

  /** 带滑出动画的关闭：closing 期间重复调用被守卫忽略。 */
  const closePanel = (): void => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setClosing(false)
      setOpen(false)
    }, 130)
  }

  /** 取消「移出后延迟关闭」的定时器。 */
  const cancelHoverHide = (): void => {
    if (hoverLeaveTimer.current !== null) {
      window.clearTimeout(hoverLeaveTimer.current)
      hoverLeaveTimer.current = null
    }
  }

  /** hover 进入按钮/面板：立即显示并取消延迟关闭；关闭动画中则中断恢复。 */
  const showPanel = (): void => {
    cancelHoverHide()
    if (closing) {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      closeTimer.current = null
      // 复位 closing，否则面板带着 sink 动画的 both 填充态常驻 → 内容不可见。
      setClosing(false)
    }
    setOpen(true)
  }

  /** hover 移出：延迟 0.08 秒再关闭，给用户时间从按钮移入面板拖动滑杆。 */
  const scheduleHide = (): void => {
    cancelHoverHide()
    hoverLeaveTimer.current = window.setTimeout(() => {
      hoverLeaveTimer.current = null
      closePanel()
    }, 80)
  }

  // 卸载清理关闭/延迟隐藏/键盘预览复位三个定时器。
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current)
    if (previewResetTimer.current !== null) window.clearTimeout(previewResetTimer.current)
  }, [])

  // 当前模型（含其 reasoning 元数据）。目录外模型无法确定等级列表 → 隐藏入口。
  const currentModel = useMemo(() => {
    const current = state.current
    if (current === null) return undefined
    for (const group of state.groups) {
      if (group.id !== current.provider) continue
      const found = group.models.find(m => m.id === current.model)
      if (found !== undefined) return found
    }
    return undefined
  }, [state.groups, state.current])

  const reasoning = currentModel?.reasoning

  // 等级档位：仅具体 effort 档，不再提供「默认」（无参）档。
  const effortChoices = useMemo<readonly EffortChoice[]>(() => {
    if (reasoning === undefined) return []
    return reasoning.efforts.map(effort => ({
      key: `effort:${effort.id}`,
      effort: effort.id,
      label: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    }))
  }, [reasoning])

  const n = effortChoices.length
  // 无明确选择时落到具体档（优先 provider 默认，否则最高档），不再回落「默认」。
  const effectiveEffort = state.current?.reasoningEffort
    ?? reasoning?.defaultEffort
    ?? reasoning?.efforts[reasoning.efforts.length - 1]?.id
  const rawIndex = effortChoices.findIndex(c => c.effort === effectiveEffort)
  const currentIndex = rawIndex >= 0 ? rawIndex : n - 1
  const activeIndex = dragIndex ?? currentIndex
  const activeHue = effortHue(activeIndex, n)
  const activeColor = hueColor(activeHue)
  const activeChoice = effortChoices[activeIndex]
  // 当前档位的归一化位置（用于渐变填充宽度 / thumb 定位）。
  const activeT = n <= 1 ? 0.5 : (activeIndex >= 0 ? activeIndex : 0) / (n - 1)
  // 动效强度：等级越高，能量流越密越快、呼吸光环越急。
  const intensity = 0.25 + activeT * 0.75
  // 呼吸光环周期：低等级 1.9s → 高等级 1.0s。
  const pulseMs = Math.round(1900 - activeT * 900)

  useEffect(() => {
    if (available) load()
  }, [available, load])

  // 面板关闭后重置火花基准，下次打开不会立刻迸发。
  useEffect(() => {
    if (!open) lastBurstIndex.current = null
  }, [open])

  // 打开面板期间持续流动：光点沿轨道从左流向滑块并被吸收，关闭时停止。
  useEffect(() => {
    if (!open) {
      particleRef.current?.stop()
      return
    }
    particleRef.current?.flow({ end: activeT, intensity, hue: activeHue })
  }, [open, activeT, intensity, activeHue])

  // 档位变化（含提交生效）→ 在滑块处迸发一次火花，给出「已切换」的触感反馈。
  useEffect(() => {
    if (!open) return
    if (lastBurstIndex.current === activeIndex) return
    const first = lastBurstIndex.current === null
    lastBurstIndex.current = activeIndex
    if (first) return
    particleRef.current?.burst({ end: activeT, intensity, hue: activeHue })
  }, [open, activeIndex, activeT, intensity, activeHue])

  if (!available || reasoning === undefined || effortChoices.length === 0) return null

  // 滑块半径 = 轨道左右内边距：滑块中心在两端正好落在填充起止点上。
  const THUMB_PAD = 20

  // 档位 → thumb 水平百分比（对齐 track 的 20px 左右内边距）。
  const posPct = (index: number): string => {
    const t = n <= 1 ? 0.5 : index / (n - 1)
    return `calc(${THUMB_PAD}px + (100% - ${THUMB_PAD * 2}px) * ${t})`
  }

  // 已填充宽度（与 posPct 同一公式，保证滑块与填充右缘重合）。
  const fillWidth = posPct(activeIndex >= 0 ? activeIndex : 0)

  const indexFromClientX = (clientX: number): number => {
    const slider = sliderRef.current
    if (slider === null || n <= 1) return 0
    const rect = slider.getBoundingClientRect()
    const pad = THUMB_PAD
    const inner = rect.width - pad * 2
    const x = clamp(clientX - rect.left - pad, 0, inner)
    const t = inner <= 0 ? 0 : x / inner
    return clamp(Math.round(t * (n - 1)), 0, n - 1)
  }

  const commit = (index: number): void => {
    const choice = effortChoices[index]
    if (choice === undefined || state.current === null) return
    if (choice.effort === effectiveEffort) return
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort }),
    }
    // select 的契约是 Promise<boolean>（ModelSeat 正确地检查了 accepted 并弹
    // Toast）。此前这里 `void select(...)` 把结果整个丢掉，host 拒绝该档位时
    // 滑块跳回却零提示——用户以为切成功了。改成失败即说出原因。
    setSwitchError('')
    void select(selection).then((accepted) => {
      if (accepted) return
      const reason = directory.getSnapshot().error
      setSwitchError(reason !== undefined && reason !== null && reason !== ''
        ? reason
        : `切换到「${choice.label}」被拒绝：模型或会话不支持该推理档位`)
    }).catch((error: unknown) => {
      setSwitchError(error instanceof Error ? error.message : String(error))
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (state.status === 'selecting') return
    const index = indexFromClientX(event.clientX)
    setDragIndex(index)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragIndex === null) return
    const index = indexFromClientX(event.clientX)
    if (index !== dragIndex) setDragIndex(index)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragIndex === null) return
    commit(dragIndex)
    setDragIndex(null)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 忽略 */ }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const current = activeIndex >= 0 ? activeIndex : 0
    let next = current
    if (event.key === 'ArrowLeft') next = clamp(current - 1, 0, n - 1)
    if (event.key === 'ArrowRight') next = clamp(current + 1, 0, n - 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = n - 1
    if (next === current) return
    setDragIndex(next)
    commit(next)
    // 短暂展示选中后复位预览态；先取消上一个，否则连按时它会在用户已经
    // 移到下一档时把预览态清掉（滑块自己跳回去），卸载后也会悬挂。
    if (previewResetTimer.current !== null) window.clearTimeout(previewResetTimer.current)
    previewResetTimer.current = window.setTimeout(() => {
      previewResetTimer.current = null
      setDragIndex(null)
    }, 160)
  }

  /** 面板级 CSS 变量：强调色 + 呼吸周期，供轨道 / 滑块 / 刻度共享。 */
  const accentStyle = {
    '--eff-accent': activeColor,
    '--eff-pulse': `${pulseMs}ms`,
  } as CSSProperties
  const activeDescription = activeChoice?.description

  return (
    <div ref={rootRef} className={css.effRoot}>
      <button
        type="button"
        className={css.effTrigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`推理等级：${activeChoice?.label ?? effortChoices[n - 1]?.label ?? ''}`}
        disabled={locked === true || state.status === 'selecting'}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleHide}
      >
        <span className={css.effLabel}>{activeChoice?.label ?? effortChoices[n - 1]?.label ?? ''}</span>
      </button>

      {open && (
        <div
          className={`${css.effPanel} ${closing ? css.effPanelOut : ''}`}
          style={accentStyle}
          role="dialog"
          aria-label="修改推理等级"
          onMouseEnter={showPanel}
          onMouseLeave={scheduleHide}
        >
          <div className={css.effPanelHead}>
            <span className={css.effPanelTitle}>推理等级</span>
            <span key={activeChoice?.key ?? 'none'} className={css.effPanelValue}>
              {activeChoice?.label ?? effortChoices[n - 1]?.label ?? ''}
            </span>
          </div>

          <div
            ref={sliderRef}
            className={dragIndex === null ? css.effSlider : `${css.effSlider} ${css.effSliderDrag}`}
            role="slider"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={n - 1}
            aria-valuenow={activeIndex >= 0 ? activeIndex : 0}
            aria-valuetext={activeChoice?.label}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { setDragIndex(null) }}
            onKeyDown={onKeyDown}
          >
            {/* 实色圆角轨道 + 左浅右深的渐变填充（宽度 = 滑块位置）。 */}
            <div className={css.effTrack}>
              <div className={css.effFill} style={{ width: fillWidth }} />
            </div>
            <ParticleField ref={particleRef} className={css.effCanvas} />
            {/* 刻度点：展示全部档位；已越过的点亮起，滑块所在的点隐藏（避免与滑块重叠）。 */}
            <div className={css.effTicks}>
              {effortChoices.map((choice, index) => {
                const tickClasses: string[] = [css.effTick]
                if (index <= activeIndex) tickClasses.push(css.effTickOn)
                if (index === activeIndex) tickClasses.push(css.effTickAt)
                return (
                  <span
                    key={choice.key}
                    className={tickClasses.join(' ')}
                    style={{ left: n <= 1 ? '50%' : `${(index / (n - 1)) * 100}%` }}
                  />
                )
              })}
            </div>
            <div className={css.effThumb} style={{ left: posPct(activeIndex >= 0 ? activeIndex : 0) }}>
              <span className={css.effThumbGlow} />
              <span className={css.effThumbRing} />
              <span className={css.effThumbCore} />
            </div>
          </div>

          <div className={css.effLabels}>
            {effortChoices.map((choice, index) => (
              <span
                key={choice.key}
                className={index === activeIndex ? `${css.effLabelsItem} ${css.effLabelsItemOn}` : css.effLabelsItem}
                title={choice.description}
                onClick={() => { commit(index) }}
              >
                {choice.label}
              </span>
            ))}
          </div>

          {activeDescription !== undefined && (
            <div key={activeChoice?.key ?? 'none'} className={css.effEmpty}>{activeDescription}</div>
          )}

          {switchError !== '' ? (
            <div className={css.effEmpty} role="status" aria-live="polite" style={{ color: 'var(--dsw-alias-state-error-primary, #d93026)' }}>
              {switchError}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
