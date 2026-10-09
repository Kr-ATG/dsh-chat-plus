/**
 * iu kind **quiz** 的 React 体（client 专用）。
 *
 * 结构照抄范本 slider.body.tsx：
 *  · 只渲染「Head 之后、FillRow 之前」的正文，不自己画 Head / FillRow；
 *  · DOM 与 quiz.ts 的 `snapshot()` **逐字对齐**——snapshot 按初始 state 定格
 *    （全未答、未揭示），所以 Body 在初始态渲染出的节点集合与 snapshot 完全
 *    相同；解析 / 确认 / 重做 / 得分条都是揭示后才出现的条件节点（初始态
 *    两侧同样没有）；
 *  · 状态一律走 props 的 `state` / `setState`（外壳统一持久化），**不** useState。
 *    setState 接受补丁对象或函数式补丁：`{ picked?, revealed?, showResult? }`。
 *
 * ## 交互
 *  · 单选：点选项即选中并自动揭示该题（判对错、滑出解析）；
 *  · 多选（multi）：点选项 toggle 选中，勾了至少一项后出现「确认」按钮，
 *    点了才揭示；
 *  · 揭示后选项 disabled（防止改答案刷分），出现「重做」清空该题；
 *  · 全部题揭示后底部出现得分条「答对 X/N」+ 进度条，「查看结果」按钮
 *    切 showResult 展开逐题对错明细。
 */

import { memo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import { normalizeQuizState, quizQuestionCorrect, QUIZ_LETTERS, type IuQuizSpec, type QuizState } from './quiz.ts'

export const QuizBody = memo(function QuizBody(
  { spec, state, setState }: IuBodyProps<QuizState, IuQuizSpec>,
): JSX.Element {
  // 持久化层还回来的可能是脏数据（旧版本 / spec 改版），先归一化再渲染。
  const s = normalizeQuizState(spec, state)
  const total = spec.questions.length

  let correct = 0
  const perQuestion: boolean[] = []
  spec.questions.forEach((q, i) => {
    const ok = quizQuestionCorrect(q, s.picked[String(i)])
    perQuestion.push(ok)
    if (ok) correct += 1
  })
  const allRevealed = s.revealed.every(r => r === true)

  /** 点选项：单选=选中并揭示；多选=toggle（揭示由「确认」触发）。 */
  const pick = (qi: number, oi: number): void => {
    const q = spec.questions[qi]
    if (q === undefined) return
    setState((prev) => {
      const cur = normalizeQuizState(spec, prev)
      if (cur.revealed[qi] === true) return {}
      const key = String(qi)
      const list = [...(cur.picked[key] ?? [])]
      if (q.multi) {
        const at = list.indexOf(oi)
        if (at >= 0) list.splice(at, 1)
        else list.push(oi)
        const picked: Record<string, readonly number[]> = { ...cur.picked }
        if (list.length > 0) picked[key] = list
        else delete picked[key]
        return { picked }
      }
      const revealed = [...cur.revealed]
      revealed[qi] = true
      return { picked: { ...cur.picked, [key]: [oi] }, revealed }
    })
  }

  /** 多选题「确认」：揭示该题（保持当前勾选）。 */
  const confirm = (qi: number): void => {
    setState((prev) => {
      const cur = normalizeQuizState(spec, prev)
      if (cur.revealed[qi] === true) return {}
      const revealed = [...cur.revealed]
      revealed[qi] = true
      return { revealed }
    })
  }

  /** 「重做」：清空该题的勾选与揭示；得分明细一并收起（数据已过期）。 */
  const retry = (qi: number): void => {
    setState((prev) => {
      const cur = normalizeQuizState(spec, prev)
      const picked: Record<string, readonly number[]> = { ...cur.picked }
      delete picked[String(qi)]
      const revealed = [...cur.revealed]
      revealed[qi] = false
      return { picked, revealed, showResult: false }
    })
  }

  const toggleResult = (): void => {
    setState(prev => ({ showResult: !normalizeQuizState(spec, prev).showResult }))
  }

  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__quiz">
        {spec.questions.map((q, i) => {
          const revealed = s.revealed[i] === true
          const pickedList = s.picked[String(i)] ?? []
          const isCorrect = quizQuestionCorrect(q, s.picked[String(i)])
          const canConfirm = q.multi && !revealed && pickedList.length > 0
          return (
            <div
              className="dtt-iu__q"
              key={i}
              data-revealed={revealed ? '1' : undefined}
              data-correct={revealed && isCorrect ? '1' : undefined}
            >
              <div className="dtt-iu__q-stem">
                <b className="dtt-iu__q-no">Q{i + 1}</b>
                <span className="dtt-iu__q-stem-text">{q.q}</span>
                {q.multi && <span className="dtt-iu__q-multi">多选</span>}
              </div>
              <div className="dtt-iu__q-opts">
                {q.options.map((o, oi) => {
                  const isPicked = pickedList.includes(oi)
                  const right = revealed && oi === q.answer
                  const wrong = revealed && isPicked && oi !== q.answer
                  return (
                    <button
                      type="button"
                      className="dtt-iu__q-opt"
                      key={oi}
                      data-picked={isPicked ? '1' : undefined}
                      data-right={right ? '1' : undefined}
                      data-wrong={wrong ? '1' : undefined}
                      aria-pressed={isPicked}
                      disabled={revealed}
                      onClick={() => { pick(i, oi) }}
                    >
                      <span className="dtt-iu__q-key">{QUIZ_LETTERS[oi] ?? String(oi + 1)}</span>
                      <span className="dtt-iu__q-opt-text">{o}</span>
                      {revealed && (right || wrong) && (
                        <span className="dtt-iu__q-mark" aria-hidden>{right ? '✓' : '✗'}</span>
                      )}
                    </button>
                  )
                })}
              </div>
              {(canConfirm || revealed) && (
                <div className="dtt-iu__q-acts">
                  {canConfirm && (
                    <button type="button" className="dtt-iu__q-confirm" onClick={() => { confirm(i) }}>
                      确认
                    </button>
                  )}
                  {revealed && (
                    <button type="button" className="dtt-iu__q-retry" onClick={() => { retry(i) }}>
                      重做
                    </button>
                  )}
                </div>
              )}
              {revealed && q.explain !== '' && (
                <div className="dtt-iu__q-explain">
                  <b>解析</b>
                  <span>{q.explain}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {allRevealed && (
        <div className="dtt-iu__quiz-score">
          <div className="dtt-iu__quiz-score-main">
            <span className="dtt-iu__quiz-score-num">答对 {correct}/{total}</span>
            <span className="dtt-iu__quiz-score-bar" aria-hidden>
              <i style={{ width: `${total === 0 ? 0 : (correct / total) * 100}%` }} />
            </span>
            <button
              type="button"
              className="dtt-iu__quiz-score-btn"
              aria-expanded={s.showResult}
              onClick={toggleResult}
            >
              {s.showResult ? '收起明细' : '查看结果'}
            </button>
          </div>
          {s.showResult && (
            <div className="dtt-iu__quiz-score-detail">
              {perQuestion.map((ok, i) => (
                <span className="dtt-iu__quiz-score-chip" key={i} data-ok={ok ? '1' : undefined}>
                  Q{i + 1} {ok ? '✓' : '✗'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
})
