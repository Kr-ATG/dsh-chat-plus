/**
 * dsh-chat-plus — iu 原生交互卡片（iu 围栏的渲染器）。
 *
 * 与 HtmlCard 的差异只在载体：这里是原生 React 组件（无 iframe、无沙箱），
 * 状态全在本地（滑块值 / 图例开关 / 勾选 / 活动 Tab），主题与动效跟随宿主。
 * 安全上没有新边界：所有渲染都是宿主自己的 DOM，不执行模型给的代码。
 *
 * 回写（C）：右下角「填入输入框」把当前状态拼成一句话交给父组件，
 * 父组件用 session 标准套件的 inputActions.setDraft 写进草稿。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IuChartSpec, IuChecklistSpec, IuPianoSpec, IuSliderSpec, IuSpec, IuTabsSpec } from './parse.ts'
import { CHART_COLORS, chartLayout, formatNum, midiToFreq, noteToJianpu, pianoLayout } from './geometry.ts'

/** 填入输入框的回调（父组件用 inputActions.setDraft 实现，拿不到时回退剪贴板）。 */
export type IuFillFn = (text: string) => boolean

/** 数字显示（与截图快照同源，见 geometry.ts）。 */
const formatValue = formatNum

export function sliderFillText(spec: IuSliderSpec, value: number): string {
  const bits = spec.outputs.map(o => `${o.label}${formatValue(value * o.per)}${o.unit}`)
  const tail = bits.length > 0 ? `，${bits.join('、')}` : ''
  return `${spec.title}：取 ${formatValue(value)}${spec.unit}${tail}`
}

export function checklistFillText(spec: IuChecklistSpec, checked: ReadonlySet<number>): string {
  const picked = [...checked].sort((a, b) => a - b)
    .map(i => spec.items[i]?.label)
    .filter((s): s is string => typeof s === 'string' && s !== '')
  if (picked.length === 0) return `${spec.title}：还没勾选`
  return `${spec.title}：已选 ${picked.length}/${spec.items.length}——${picked.join('、')}`
}

export function chartFillText(spec: IuChartSpec, hidden: ReadonlySet<number>): string {
  const vis = spec.series.filter((_, i) => !hidden.has(i))
  const names = vis.map(s => s.name).join('、') || '（图例全关）'
  return `${spec.title}：${spec.labels.join('、')}｜${names}`
}

export function tabsFillText(spec: IuTabsSpec, active: number): string {
  const tab = spec.tabs[active]
  if (tab === undefined) return spec.title
  const body = tab.body !== '' ? `——${tab.body.slice(0, 80)}` : tab.heading
  return `${spec.title}·${tab.label}：${body}`
}

/**
 * 钢琴回写：把弹过的音拼成音名 + 简谱两行。
 *
 * 只记**弹奏顺序**（不去重、不排序）——那正是用户弹出来的旋律。
 * 空手弹时给一句可读提示，不返回空串（否则按钮点了像没反应）。
 */
export function pianoFillText(spec: IuPianoSpec, played: readonly string[]): string {
  if (played.length === 0) return `${spec.title}：还没弹`
  const names = played.join(' ')
  const jianpu = played.map(noteToJianpu).join(' ')
  return `${spec.title}：${names}（简谱 ${jianpu}）`
}

function Head({ title, tag }: { readonly title: string; readonly tag: string }): JSX.Element {
  return (
    <div className="dtt-iu__head">
      <span className="dtt-iu__dot" aria-hidden />
      <span className="dtt-iu__title">{title}</span>
      <span className="dtt-iu__tag">{tag}</span>
    </div>
  )
}

function FillRow({ onFill, text }: { readonly onFill?: IuFillFn | undefined; readonly text: () => string }): JSX.Element | null {
  const [done, setDone] = useState(false)
  if (onFill === undefined) return null
  return (
    <div className="dtt-iu__foot">
      <button
        type="button"
        className={done ? 'dtt-iu__fill dtt-iu__fill--done' : 'dtt-iu__fill'}
        onClick={() => {
          const ok = onFill(text())
          if (ok) {
            setDone(true)
            window.setTimeout(() => { setDone(false) }, 1600)
          }
        }}
      >
        {done ? '已填入 ✓' : '填入输入框'}
      </button>
    </div>
  )
}

function SliderBody({ spec, onFill }: { readonly spec: IuSliderSpec; readonly onFill?: IuFillFn | undefined }): JSX.Element {
  const [value, setValue] = useState(spec.value)
  return (
    <div>
      <Head title={spec.title} tag="滑块" />
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__slider-top">
        <span className="dtt-iu__slider-val">{formatValue(value)}</span>
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
        onChange={(e) => { setValue(Number(e.currentTarget.value)) }}
      />
      {spec.outputs.length > 0 && (
        <div className="dtt-iu__outs">
          {spec.outputs.map((o, i) => (
            <div className="dtt-iu__out" key={i}>
              <b>{formatValue(value * o.per)}{o.unit}</b>
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      )}
      <FillRow onFill={onFill} text={() => sliderFillText(spec, value)} />
    </div>
  )
}

function ChartBody({ spec, onFill }: { readonly spec: IuChartSpec; readonly onFill?: IuFillFn | undefined }): JSX.Element {
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())
  const toggle = (i: number): void => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  // 几何全部来自 geometry.ts —— 截图页消费同一份算法，两处不会漂移。
  const geo = useMemo(() => chartLayout(spec, hidden), [spec, hidden])
  const visCount = spec.series.length - hidden.size
  return (
    <div>
      <Head title={spec.title} tag="图表" />
      <div className="dtt-iu__legend">
        {spec.series.map((s, i) => (
          <button
            key={i}
            type="button"
            className={hidden.has(i) ? 'dtt-iu__chip dtt-iu__chip--off' : 'dtt-iu__chip'}
            aria-pressed={!hidden.has(i)}
            onClick={() => { toggle(i) }}
          >
            <span className="dtt-iu__swatch" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {s.name}
          </button>
        ))}
      </div>
      <svg className="dtt-iu__chart" data-i={String(visCount)} viewBox={`0 0 ${geo.w} ${geo.h}`} role="img" aria-label={spec.title}>
        {geo.gridYs.map((y, i) => (
          <line key={i} className="dtt-iu__grid" x1={8} x2={geo.w - 8} y1={y} y2={y} />
        ))}
        <line className="dtt-iu__axis" x1={8} x2={geo.w - 8} y1={geo.axisY} y2={geo.axisY} />
        {spec.chart === 'bar' ? (
          <g>
            {geo.bars.map((bar, i) => (
              <g key={i}>
                <rect className="dtt-iu__bar" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={3} fill={bar.color} />
                {bar.h > 14 && (
                  <text className="dtt-iu__barval" x={bar.x + bar.w / 2} y={bar.y + 11} textAnchor="middle" fill="#fff" opacity={.9}>
                    {formatValue(bar.value)}
                  </text>
                )}
              </g>
            ))}
            {geo.ticks.map((tick, i) => (
              <text key={i} className="dtt-iu__tick" x={tick.x} y={geo.h - 6} textAnchor="middle">{tick.text}</text>
            ))}
          </g>
        ) : (
          <g>
            {geo.lines.map((line, i) => (
              <g key={i}>
                <polyline className="dtt-iu__line" points={line.points} stroke={line.color} />
                {line.dots.map((dot, j) => (
                  <circle key={j} className="dtt-iu__dot-svg" cx={dot.x} cy={dot.y} r={3} fill={line.color} />
                ))}
              </g>
            ))}
            {geo.ticks.map((tick, i) => (
              <text key={i} className="dtt-iu__tick" x={tick.x} y={geo.h - 6} textAnchor="middle">{tick.text}</text>
            ))}
          </g>
        )}
      </svg>
      <FillRow onFill={onFill} text={() => chartFillText(spec, hidden)} />
    </div>
  )
}

function ChecklistBody({ spec, onFill }: { readonly spec: IuChecklistSpec; readonly onFill?: IuFillFn | undefined }): JSX.Element {
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set())
  const toggle = (i: number): void => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  return (
    <div>
      <Head title={spec.title} tag="清单" />
      <div className="dtt-iu__progress" aria-hidden>
        <i style={{ width: `${spec.items.length === 0 ? 0 : (checked.size / spec.items.length) * 100}%` }} />
      </div>
      <div className="dtt-iu__count">{checked.size}/{spec.items.length} 已完成</div>
      <div>
        {spec.items.map((item, i) => (
          <button
            key={i}
            type="button"
            className="dtt-iu__check"
            data-on={checked.has(i) ? '1' : undefined}
            aria-pressed={checked.has(i)}
            onClick={() => { toggle(i) }}
          >
            <span className="dtt-iu__box" aria-hidden>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.8 5.2 4 7.4 8.2 2.6" />
              </svg>
            </span>
            <span>
              <b>{item.label}</b>
              {item.desc !== '' && <small>{item.desc}</small>}
            </span>
          </button>
        ))}
      </div>
      <FillRow onFill={onFill} text={() => checklistFillText(spec, checked)} />
    </div>
  )
}

function TabsBody({ spec, onFill }: { readonly spec: IuTabsSpec; readonly onFill?: IuFillFn | undefined }): JSX.Element {
  const [active, setActive] = useState(0)
  const safe = active < spec.tabs.length ? active : 0
  const tab = spec.tabs[safe]
  return (
    <div>
      <Head title={spec.title} tag="对比" />
      <div className="dtt-iu__tabs" role="tablist">
        {spec.tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === safe}
            className={i === safe ? 'dtt-iu__tab dtt-iu__tab--active' : 'dtt-iu__tab'}
            onClick={() => { setActive(i) }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab !== undefined && (
        <div className="dtt-iu__panel" key={safe}>
          {tab.heading !== '' && <h4>{tab.heading}</h4>}
          {tab.body !== '' && <p>{tab.body}</p>}
        </div>
      )}
      <FillRow onFill={onFill} text={() => tabsFillText(spec, safe)} />
    </div>
  )
}

/**
 * 电脑键盘 → 音名映射（一排键盘覆盖一个八度的 12 个半音，再加右侧高音 C）。
 *
 * 用 `event.code` 而不是 `event.key`：key 受输入法与大小写影响（中文输入法下
 * key 可能是「Process」），code 是物理键位，稳定。
 */
const KEYBOARD_MAP: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4,
  KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
}

/**
 * 钢琴键盘卡片。
 *
 * 发声走 Web Audio 的**一次性振荡器**（每个音一个 OscillatorNode + 指数衰减
 * 包络），而不是预加载音频文件——沙箱里不能引外部资源，合成音则零依赖、
 * 且音色可控（spec.wave）。
 *
 * 三条实现约束（都是「不写就会坏、但不报错」的那类）：
 *  1. **AudioContext 必须懒创建**：浏览器要求首次发声在用户手势里，
 *     提前 new 会得到 suspended 状态的 context，之后弹琴全程无声。
 *  2. **包络必须指数衰减到极小值再停**：直接 stop() 会「啪」一声爆音
 *     （波形被硬切）；用 setTargetAtTime 收到 0.0001 再停才干净。
 *  3. **多指同按要各自独立**：每个音持有自己的 oscillator，松手只停自己那个，
 *     不能共用一个全局节点。
 */
function PianoBody({ spec, onFill }: { readonly spec: IuPianoSpec; readonly onFill?: IuFillFn | undefined }): JSX.Element {
  const keys = useMemo(() => pianoLayout(spec.octave, spec.octaves), [spec.octave, spec.octaves])
  /** 正在响的琴键（按下的高亮；支持多指）。 */
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set())
  /** 弹奏顺序（回写用；只留最近 64 个音，长按不无限增长）。 */
  const [played, setPlayed] = useState<readonly string[]>([])
  /** AudioContext 懒创建：见上面约束 ①。 */
  const ctxRef = useRef<AudioContext | null>(null)
  /** 每个正在响的音自己的振荡器（约束 ③）。 */
  const voicesRef = useRef<Map<number, { osc: OscillatorNode; gain: GainNode }>>(new Map())

  const ensureCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current !== null) {
      // 被浏览器自动挂起（切标签页等）时补一次 resume。
      if (ctxRef.current.state === 'suspended') void ctxRef.current.resume().catch(() => undefined)
      return ctxRef.current
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctor === undefined) return null
      ctxRef.current = new Ctor()
      return ctxRef.current
    } catch {
      return null
    }
  }, [])

  const noteOn = useCallback((midi: number, name: string): void => {
    const ctx = ensureCtx()
    // 同一个音已经在响：不叠加第二个振荡器（长按拖动会重复触发）。
    if (ctx === null || voicesRef.current.has(midi)) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = spec.wave
      osc.frequency.value = midiToFreq(midi)
      const t = ctx.currentTime
      // 快起慢落：4ms 冲到峰值（避免咔哒），再指数衰减到听不见。
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      // 约束 ②：先衰减到极小值再停，别硬切。
      osc.stop(t + 1.2)
      osc.onended = () => { voicesRef.current.delete(midi) }
      voicesRef.current.set(midi, { osc, gain })
    } catch { /* 发声失败不该影响界面 */ }
    setHeld(prev => {
      if (prev.has(midi)) return prev
      const next = new Set(prev)
      next.add(midi)
      return next
    })
    setPlayed(prev => (prev.length >= 64 ? [...prev.slice(-63), name] : [...prev, name]))
  }, [ensureCtx, spec.wave])

  const noteOff = useCallback((midi: number): void => {
    const voice = voicesRef.current.get(midi)
    const ctx = ctxRef.current
    if (voice !== undefined && ctx !== null) {
      try {
        const t = ctx.currentTime
        // 松手不硬切：30ms 收到极小值再停（约束 ②）。
        voice.gain.gain.cancelScheduledValues(t)
        voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t)
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
        voice.osc.stop(t + 0.08)
      } catch { /* 已停过就算了 */ }
      voicesRef.current.delete(midi)
    }
    setHeld(prev => {
      if (!prev.has(midi)) return prev
      const next = new Set(prev)
      next.delete(midi)
      return next
    })
  }, [])

  // 电脑键盘演奏：只在**鼠标悬停在琴上**时接管，避免抢走对话输入框的按键。
  const hoverRef = useRef(false)
  useEffect(() => {
    const byCode = new Map<string, number>()
    for (const [code, offset] of Object.entries(KEYBOARD_MAP)) {
      const key = keys[offset]
      if (key !== undefined) byCode.set(code, key.midi)
    }
    const onDown = (e: KeyboardEvent): void => {
      if (!hoverRef.current || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const midi = byCode.get(e.code)
      if (midi === undefined) return
      e.preventDefault()
      const key = keys.find(k => k.midi === midi)
      if (key !== undefined) noteOn(midi, key.name)
    }
    const onUp = (e: KeyboardEvent): void => {
      const midi = byCode.get(e.code)
      if (midi !== undefined) noteOff(midi)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [keys, noteOn, noteOff])

  // 卸载：把所有在响的音停掉并关闭 context，别在切会话后留一路还在响的音频。
  useEffect(() => () => {
    for (const [, voice] of voicesRef.current) {
      try { voice.osc.stop() } catch { /* ignore */ }
    }
    voicesRef.current.clear()
    try { void ctxRef.current?.close() } catch { /* ignore */ }
    ctxRef.current = null
  }, [])

  const whiteKeys = keys.filter(k => !k.black)
  const blackKeys = keys.filter(k => k.black)
  return (
    <div>
      <Head title={spec.title} tag="钢琴" />
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div
        className="dtt-iu__piano"
        role="group"
        aria-label={spec.title}
        onMouseEnter={() => { hoverRef.current = true }}
        onMouseLeave={() => {
          hoverRef.current = false
          // 鼠标移出时把所有还按着的音收掉，避免「卡住一直响」。
          for (const midi of [...voicesRef.current.keys()]) noteOff(midi)
        }}
      >
        {/* 白键层走 flex 等分，黑键层绝对定位叠上去 —— 与真钢琴的层叠一致。
            黑键的 left/width 来自 pianoLayout（相对键盘区百分比）。 */}
        <div className="dtt-iu__pwhite">
          {whiteKeys.map(key => (
            <button
              key={key.midi}
              type="button"
              className="dtt-iu__pkey"
              data-on={held.has(key.midi) ? '1' : undefined}
              aria-label={key.name}
              aria-pressed={held.has(key.midi)}
              onPointerDown={(e) => { e.preventDefault(); noteOn(key.midi, key.name) }}
              onPointerUp={() => { noteOff(key.midi) }}
              onPointerLeave={() => { if (held.has(key.midi)) noteOff(key.midi) }}
            >
              {spec.showNotes && key.name.startsWith('C') && <span className="dtt-iu__plabel">{key.name}</span>}
            </button>
          ))}
        </div>
        <div className="dtt-iu__pblack">
          {blackKeys.map(key => (
            <button
              key={key.midi}
              type="button"
              className="dtt-iu__pkey"
              data-on={held.has(key.midi) ? '1' : undefined}
              style={{ left: `${key.leftPct}%`, width: `${key.widthPct}%` }}
              aria-label={key.name}
              aria-pressed={held.has(key.midi)}
              onPointerDown={(e) => { e.preventDefault(); noteOn(key.midi, key.name) }}
              onPointerUp={() => { noteOff(key.midi) }}
              onPointerLeave={() => { if (held.has(key.midi)) noteOff(key.midi) }}
            />
          ))}
        </div>
      </div>
      <div className="dtt-iu__phint">
        <span>点键或用电脑键盘 A W S E D F T G Y H U J K 演奏</span>
        <span className="dtt-iu__pcount">{played.length > 0 ? `已弹 ${played.length} 个音` : ''}</span>
      </div>
      <FillRow onFill={onFill} text={() => pianoFillText(spec, played)} />
    </div>
  )
}

function pendingStage(bytes: number): JSX.Element {
  return (
    <div className="dtt-iu__stage--pending" aria-busy="true" aria-live="polite">
      <div className="dtt-iu__pending">
        <span className="dtt-iu__pending-dot" />
        <span className="dtt-iu__pending-text">正在生成交互卡片…</span>
      </div>
      <div className="dtt-iu__pending-track"><span className="dtt-iu__pending-bar" /></div>
      <span className="dtt-iu__pending-text">{bytes} 字</span>
    </div>
  )
}

/**
 * iu 原生交互卡片。
 *
 * pending 只在流式期出现（半截 JSON 不渲染）；非法 spec 由 parse 层挡掉，
 * 这里收到的一定是合法结构。
 */
export const IuCard = memo(function IuCard({ spec, pending = false, bytes = 0, onFill }: {
  readonly spec?: IuSpec | undefined
  readonly pending?: boolean
  readonly bytes?: number
  readonly onFill?: IuFillFn | undefined
}): JSX.Element | null {
  if (pending || spec === undefined) {
    return (
      <figure className="dtt-iu dtt-iu--pending">
        {pendingStage(bytes)}
      </figure>
    )
  }
  return (
    <figure className="dtt-iu">
      {spec.kind === 'slider' && <SliderBody spec={spec} onFill={onFill} />}
      {spec.kind === 'chart' && <ChartBody spec={spec} onFill={onFill} />}
      {spec.kind === 'checklist' && <ChecklistBody spec={spec} onFill={onFill} />}
      {spec.kind === 'tabs' && <TabsBody spec={spec} onFill={onFill} />}
      {spec.kind === 'piano' && <PianoBody spec={spec} onFill={onFill} />}
    </figure>
  )
})
