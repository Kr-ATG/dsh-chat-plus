/**
 * iu kind **form** 的 React 体（client 专用）。
 *
 * ## Body 契约（务必遵守，见 bodies.ts 头注释）
 *  · 只渲染「Head 之后」的正文，不要自己画 Head；
 *  · **提交按钮由本 Body 自绘**（文案 = spec.submitLabel）。这是唯一一个
 *    自带动作入口的 kind：外壳的 FillRow 已于 2026-09 移除，而表单填完
 *    没有出口就是一张废卡。回写文案统一走 form.ts 的 fillText，不在
 *    这里重算（否则 Body 与截图/冒烟会各说各话）。
 *  · DOM 结构必须与同名 form.ts 里的 `snapshot()` **逐字对齐**（class、层级、
 *    顺序），否则截图会长歪；
 *  · 本地状态一律走 props 的 `state` / `setState`，**不要**自己 useState——
 *    状态由外壳统一持久化（刷新不丢）。setState 支持补丁对象或函数式补丁。
 *
 * 校验：required 字段为空时该行显示轻量错误（.dtt-iu__form-err），但只有
 * 失焦/交互过（touched）之后才显示——不一上来就报红。
 */

import { memo, useCallback, useMemo } from 'react'
import type { IuBodyProps } from './bodies.ts'
import {
  fillText, isFieldEmpty, safeTouched, safeValues,
  type FormState, type IuFormField, type IuFormSpec,
} from './form.ts'

/** 勾选框里的对勾 SVG（与 form.ts 的 CHECK_SVG 同一份路径，两边必须一致）。 */
function CheckMark(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1.8 5.2 4 7.4 8.2 2.6" />
    </svg>
  )
}

/** required 字段为空时的轻量校验文案（按控件类型区分动词）。 */
function errText(field: IuFormField): string {
  switch (field.type) {
    case 'select': return `请选择「${field.label}」`
    case 'checkbox': return `请勾选「${field.label}」`
    default: return `请填写「${field.label}」`
  }
}

export const FormBody = memo(function FormBody(
  { spec, state, setState, onFill }: IuBodyProps<FormState, IuFormSpec>,
): JSX.Element {
  const values = safeValues(state)
  const touched = safeTouched(state)

  /**
   * 必填字段是否还有空的。
   *
   * 提交按钮在有必填项未填时**不禁用**，改为点击后把没填过的字段标成
   * touched（触发一次校验红字）：禁用按钮只会让人不知道还差什么，而
   * 「点一下、红出来」是自解释的。
   */
  const missing = useMemo(
    () => spec.fields.filter((f) => f.required && isFieldEmpty(f, values[f.id])),
    [spec.fields, values],
  )

  /**
   * 提交：把整张表按 fillText 拼成文本，交给外壳的回写通道。
   *
   * 有必填项没填时只标 touched 并返回——**不改变已填内容**，用户补完再点
   * 一次即可（顺手把红字消掉）。全部合规才真的回写。
   */
  const submit = useCallback((): void => {
    if (missing.length > 0) {
      setState((prev) => {
        const t = safeTouched(prev)
        const next = [...t]
        for (const f of missing) if (!next.includes(f.id)) next.push(f.id)
        return next.length === t.length ? {} : { touched: next }
      })
      return
    }
    // 没有回写通道（独立预览 / 截图管线）时什么也不做，不假装成功。
    if (onFill === undefined) return
    onFill(fillText(spec, state))
  }, [missing, onFill, setState, spec, state])

  /** 更新单个字段值（函数式补丁，避免并发/闭包读到旧 state；prev 也过一遍防御）。 */
  const patchValue = useCallback((id: string, v: string | boolean): void => {
    setState(prev => ({ values: { ...safeValues(prev), [id]: v } }))
  }, [setState])

  /** 标记字段已交互（失焦/选择/勾选后），只有 touched 的字段才报校验错误。 */
  const touch = useCallback((id: string): void => {
    setState(prev => {
      const t = safeTouched(prev)
      return t.includes(id) ? {} : { touched: [...t, id] }
    })
  }, [setState])

  /** 同时更新值并标记 touched（select / checkbox 一步到位）。 */
  const patchValueAndTouch = useCallback((id: string, v: string | boolean): void => {
    setState(prev => {
      const t = safeTouched(prev)
      return {
        values: { ...safeValues(prev), [id]: v },
        touched: t.includes(id) ? t : [...t, id],
      }
    })
  }, [setState])

  return (
    <>
      {spec.desc !== '' && <p className="dtt-iu__desc">{spec.desc}</p>}
      <div className="dtt-iu__form">
        {spec.fields.map((f) => {
          const raw = values[f.id]
          const strVal = typeof raw === 'string' ? raw : ''
          const checked = raw === true
          const invalid = f.required && touched.includes(f.id) && isFieldEmpty(f, raw)
          return (
            <div
              className="dtt-iu__field"
              key={f.id}
              data-type={f.type}
              data-required={f.required ? '1' : '0'}
              data-invalid={invalid ? '1' : undefined}
            >
              <label className="dtt-iu__label">
                {f.label}
                {f.required && <span className="dtt-iu__req">*</span>}
              </label>

              {(f.type === 'text' || f.type === 'number') && (
                <input
                  className="dtt-iu__input"
                  type={f.type}
                  value={strVal}
                  placeholder={f.placeholder}
                  aria-label={f.label}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => { patchValue(f.id, e.currentTarget.value) }}
                  onBlur={() => { touch(f.id) }}
                />
              )}

              {f.type === 'textarea' && (
                <textarea
                  className="dtt-iu__textarea"
                  value={strVal}
                  placeholder={f.placeholder}
                  aria-label={f.label}
                  aria-invalid={invalid || undefined}
                  rows={2}
                  onChange={(e) => { patchValue(f.id, e.currentTarget.value) }}
                  onBlur={() => { touch(f.id) }}
                />
              )}

              {f.type === 'select' && (
                <select
                  className="dtt-iu__select"
                  value={strVal}
                  aria-label={f.label}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => { patchValueAndTouch(f.id, e.currentTarget.value) }}
                  onBlur={() => { touch(f.id) }}
                >
                  <option value="">{f.placeholder !== '' ? f.placeholder : '请选择'}</option>
                  {f.options.map((o, i) => (
                    <option value={o} key={i}>{o}</option>
                  ))}
                </select>
              )}

              {f.type === 'checkbox' && (
                <button
                  type="button"
                  className="dtt-iu__checkbox"
                  data-on={checked ? '1' : '0'}
                  aria-pressed={checked}
                  aria-label={f.label}
                  onClick={() => { patchValueAndTouch(f.id, !checked) }}
                >
                  <span className="dtt-iu__box" aria-hidden>
                    <CheckMark />
                  </span>
                  <span className="dtt-iu__checkbox-text">{checked ? '是' : '否'}</span>
                </button>
              )}

              {invalid && <div className="dtt-iu__form-err">{errText(f)}</div>}
            </div>
          )
        })}
      </div>
      {/*
        提交行：只在有回写通道时出现。
        没有 onFill 的场合（独立预览、截图管线）画一个点了没反应的按钮，
        正是我们要消灭的「假按钮」——那种东西比没有按钮更伤。
      */}
      {onFill !== undefined && (
        <div className="dtt-iu__form-submit">
          <button
            type="button"
            className="dtt-iu__form-submit-btn"
            onClick={submit}
          >
            {spec.submitLabel}
          </button>
        </div>
      )}
    </>
  )
})
