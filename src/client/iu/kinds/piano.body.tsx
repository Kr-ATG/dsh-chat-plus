/**
 * iu kind **piano** 的 React 体（client 专用）。
 *
 * 发声逻辑整块沿用老 IuCard 的实现（那部分踩过很多坑，见下方三条约束），
 * 唯一改动：弹过的音（played）从组件 useState 改走 props 的 state/setState
 * （外壳统一持久化）。音频句柄（AudioContext / oscillator）仍是命令式的，
 * 留在 ref 里——它们不可序列化，恢复的只是「弹过哪些音」这份记录。
 *
 * 三条实现约束（都是「不写就会坏、但不报错」的那类）：
 *  1. **AudioContext 必须懒创建**：浏览器要求首次发声在用户手势里，
 *     提前 new 会得到 suspended 状态的 context，之后弹琴全程无声。
 *  2. **包络必须指数衰减到极小值再停**：直接 stop() 会「啪」一声爆音
 *     （波形被硬切）；用 setTargetAtTime 收到 0.0001 再停才干净。
 *  3. **多指同按要各自独立**：每个音持有自己的 oscillator，松手只停自己那个，
 *     不能共用一个全局节点。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuPianoSpec, PianoState } from './piano.ts'
import { midiToFreq, pianoLayout } from '../geometry.ts'

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

export const PianoBody = memo(function PianoBody(
  { spec, state, setState }: IuBodyProps<PianoState, IuPianoSpec>,
): JSX.Element {
  const keys = useMemo(() => pianoLayout(spec.octave, spec.octaves), [spec.octave, spec.octaves])
  /** 正在响的琴键（按下的高亮；支持多指）。纯视觉瞬态，不进持久化。 */
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set())
  /** AudioContext 懒创建：见约束 ①。 */
  const ctxRef = useRef<AudioContext | null>(null)
  /** 每个正在响的音自己的振荡器（约束 ③）。 */
  const voicesRef = useRef<Map<number, { osc: OscillatorNode; gain: GainNode }>>(new Map())

  const ensureCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current !== null) {
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
    setHeld((prev) => {
      if (prev.has(midi)) return prev
      const next = new Set(prev)
      next.add(midi)
      return next
    })
    // played 进持久化 state（只留最近 64 个音，长按不无限增长）。
    setState((prev) => ({ played: prev.played.length >= 64 ? [...prev.played.slice(-63), name] : [...prev.played, name] }))
  }, [ensureCtx, spec.wave, setHeld, setState])

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
    setHeld((prev) => {
      if (!prev.has(midi)) return prev
      const next = new Set(prev)
      next.delete(midi)
      return next
    })
  }, [setHeld])

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
  const played = state.played
  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div
        className="dtt-iu__piano"
        role="group"
        aria-label={spec.title}
        onMouseEnter={() => { hoverRef.current = true }}
        onMouseLeave={() => {
          hoverRef.current = false
          for (const midi of [...voicesRef.current.keys()]) noteOff(midi)
        }}
      >
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
    </>
  )
})
