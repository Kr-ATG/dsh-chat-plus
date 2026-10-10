/**
 * iu kind: **form**（多字段表单 → 拼成文本回写输入框）。
 *
 * 纯逻辑半边：零 React、零 DOM（host 半身的截图管线要 import 它）。
 * React 体一律写在同名 form.body.tsx 里。
 *
 * 「提交」语义 = 把填好的表单拼成一段文本，通过外壳 FillRow 回写进用户
 * 输入框，由用户检查后自行发送——**本卡片不做任何网络请求**。
 * submitLabel 是那个提交按钮的文案；按钮本体由外壳 FillRow 统一渲染，
 * Body 不自己画（见 bodies.ts 契约）。
 *
 * ⚠ snapshot 的 DOM 结构必须与 form.body.tsx **逐字对齐**（class、层级、
 *   顺序），两者共用同一份 CSS，否则截图会长歪（见 contract.ts 头注释）。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, boolOrFalse, esc, escAttr, oneOf, pickAll, str, strOr } from './core.ts'

/** 表单字段类型（五选一）。 */
export type IuFormFieldType = 'text' | 'number' | 'select' | 'checkbox' | 'textarea'

/** 字段类型白名单（oneOf 钳位用）。 */
const FIELD_TYPES: readonly IuFormFieldType[] = ['text', 'number', 'select', 'checkbox', 'textarea']

/** 单个表单字段。 */
export interface IuFormField {
  /** 字段标识（≤16，唯一；重复时 parse 自动加后缀）。 */
  readonly id: string
  /** 字段名（≤24，显示在 .dtt-iu__label）。 */
  readonly label: string
  readonly type: IuFormFieldType
  /** select 的选项（≤12 项；其它类型为空数组）。 */
  readonly options: readonly string[]
  /** 占位提示（≤40；select 兼作占位 option 文案，checkbox 不用）。 */
  readonly placeholder: string
  /** 是否必填（缺省 false）。 */
  readonly required: boolean
}

export interface IuFormSpec extends IuSpecBase {
  readonly kind: 'form'
  readonly title: string
  readonly desc: string
  readonly submitLabel: string
  readonly fields: readonly IuFormField[]
}

/** form 的本地状态（持久化）。 */
export interface FormState extends IuState {
  /** fieldId → 当前值（checkbox 为布尔，其余为字符串）。 */
  readonly values: Readonly<Record<string, string | boolean>>
  /** 已失焦/交互过的 fieldId；只有 touched 里的字段才显示校验错误（不一上来就报红）。 */
  readonly touched: readonly string[]
}

/** 模型漏写 label 时按类型兜底，避免整字段被丢弃。 */
function fallbackLabel(type: IuFormFieldType): string {
  switch (type) {
    case 'number': return '数字'
    case 'select': return '选择'
    case 'checkbox': return '勾选项'
    case 'textarea': return '多行文本'
    default: return '文本'
  }
}

function parse(raw: Record<string, unknown>): IuFormSpec | undefined {
  const title = strOr(raw.title, 40, '表单')
  const desc = str(raw.desc, 80)
  const submitLabel = strOr(raw.submitLabel, 12, '提交')
  /** 已占用的 field id（去重用）。 */
  const used = new Set<string>()
  /** 模型没给 id 时的自动编号计数。 */
  let autoId = 0
  const fields = pickAll<IuFormField>(raw.fields, 10, (it) => {
    const type = oneOf<IuFormFieldType>(it.type, FIELD_TYPES, 'text')
    // id：≤16；空则自动编号；重复自动加 -2 / -3 后缀（仍钳到 16 字符）。
    let id = str(it.id, 16)
    if (id === '') {
      autoId += 1
      id = `f${autoId}`
    }
    let unique = id
    let n = 2
    while (used.has(unique)) {
      // 后缀优先：先裁基底再拼后缀，保证结果 ≤16 且**一定带后缀**
      // （若直接 `${id}-${n}`.slice(0,16)，16 字符满长 id 会把后缀裁掉 → 死循环）。
      const suffix = `-${n}`
      unique = `${id.slice(0, 16 - suffix.length)}${suffix}`
      n += 1
    }
    used.add(unique)
    const label = str(it.label, 24) || fallbackLabel(type)
    // select 才读 options（≤12 项，逐项截断、滤空）；其它类型一律空数组。
    const options = type === 'select'
      ? arr(it.options).slice(0, 12).map(o => str(o, 40)).filter(s => s !== '')
      : []
    return {
      id: unique,
      label,
      type,
      options,
      placeholder: str(it.placeholder, 40),
      required: boolOrFalse(it.required),
    }
  })
  // 没有任何合格字段的表单没有意义：整卡回退成代码块。
  if (fields.length === 0) return undefined
  return { kind: 'form', title, desc, submitLabel, fields }
}

function initState(spec: IuFormSpec): FormState {
  const values: Record<string, string | boolean> = {}
  for (const f of spec.fields) values[f.id] = f.type === 'checkbox' ? false : ''
  return { values, touched: [] }
}

/**
 * 字段是否为空（required 校验与 fillText 共用同一判据，两处不会漂移）。
 *
 * checkbox 的「空」= 未勾选（false / undefined）；其余类型 = 去空白后为空串。
 */
export function isFieldEmpty(field: IuFormField, value: string | boolean | undefined): boolean {
  if (field.type === 'checkbox') return value !== true
  const s = typeof value === 'string' ? value.trim() : ''
  return s === ''
}

/**
 * 脏 state 防御：持久化层读回的可能是任何旧版本写的形状（state.ts 约束 2），
 * values 不是对象就当空表——直接 `state.values[id]` 会 TypeError 崩掉渲染。
 */
export function safeValues(state: FormState): Readonly<Record<string, string | boolean>> {
  return typeof state.values === 'object' && state.values !== null ? state.values : {}
}

/** 脏 state 防御：touched 不是数组就当没人交互过。 */
export function safeTouched(state: FormState): readonly string[] {
  return Array.isArray(state.touched) ? (state.touched as readonly string[]) : []
}

/**
 * 回写文本：把非空字段拼成 `${label}: ${value}`，换行连接，前缀 `${title}：`。
 *
 * checkbox 总是输出「是/否」（未勾选也是一个明确回答）；其余类型为空则跳过。
 * 全部字段都空时给 `${title}：（未填写）`，避免按钮点了像没反应。
 */
function fillText(spec: IuFormSpec, state: FormState): string {
  const values = safeValues(state)
  const lines: string[] = []
  for (const f of spec.fields) {
    const v = values[f.id]
    if (f.type === 'checkbox') {
      // checkbox 总是输出「是/否」：未勾选也是一个明确回答（如「同意条款: 否」）。
      lines.push(`${f.label}: ${v === true ? '是' : '否'}`)
    } else if (!isFieldEmpty(f, v)) {
      lines.push(`${f.label}: ${typeof v === 'string' ? v.trim() : ''}`)
    }
  }
  if (lines.length === 0) return `${spec.title}：（未填写）`
  return `${spec.title}：\n${lines.join('\n')}`
}

/**
 * 勾选框里的对勾 SVG。**与 form.body.tsx 的 <CheckMark> 同一份路径**，
 * 两边必须一致，否则截图里的勾和对话流里的勾长得不一样。
 */
const CHECK_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M1.8 5.2 4 7.4 8.2 2.6"></path></svg>'

/** 单个控件的静态 HTML（snapshot 用；全部 disabled，文本走 esc/escAttr）。 */
function controlHtml(f: IuFormField): string {
  switch (f.type) {
    case 'text':
    case 'number':
      return `<input class="dtt-iu__input" type="${f.type}" value="" placeholder="${escAttr(f.placeholder)}" disabled>`
    case 'textarea':
      return `<textarea class="dtt-iu__textarea" rows="2" placeholder="${escAttr(f.placeholder)}" disabled></textarea>`
    case 'select': {
      const ph = f.placeholder !== '' ? f.placeholder : '请选择'
      const opts = f.options.map(o => `<option value="${escAttr(o)}">${esc(o)}</option>`).join('')
      return `<select class="dtt-iu__select" disabled><option value="">${esc(ph)}</option>${opts}</select>`
    }
    case 'checkbox':
      // 快照按初始状态定格：未勾选（data-on="0"、文案「否」）。
      return '<button type="button" class="dtt-iu__checkbox" data-on="0" aria-pressed="false" disabled>'
        + `<span class="dtt-iu__box" aria-hidden>${CHECK_SVG}</span>`
        + '<span class="dtt-iu__checkbox-text">否</span></button>'
    default:
      return `<input class="dtt-iu__input" type="text" value="" placeholder="${escAttr(f.placeholder)}" disabled>`
  }
}

/** 单个字段行的静态 HTML（结构与 form.body.tsx 的 FieldRow 逐字对齐）。 */
function fieldHtml(f: IuFormField): string {
  const req = f.required ? '<span class="dtt-iu__req">*</span>' : ''
  // 快照按初始状态定格：touched 为空 → 没有字段处于校验失败态，
  // 因此不出现 data-invalid，也不出现 .dtt-iu__form-err（与 Body 初始态一致）。
  return `<div class="dtt-iu__field" data-type="${f.type}" data-required="${f.required ? '1' : '0'}">`
    + `<label class="dtt-iu__label">${esc(f.label)}${req}</label>`
    + controlHtml(f)
    + '</div>'
}

/**
 * 静态快照（截图用）。DOM 结构与 form.body.tsx **逐字对齐**：
 * desc（可选）紧跟 Head，其后 .dtt-iu__form 容器包住全部 .dtt-iu__field。
 * 所有模型文本走 esc / escAttr（截图页跑在 --disable-web-security 的无头
 * Chrome 里，文本逃出标签上下文就等于任意脚本）。
 */
function snapshot(spec: IuFormSpec): string {
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const fields = spec.fields.map(fieldHtml).join('')
  return `${desc}<div class="dtt-iu__form">${fields}</div>`
}

const CSS = [
  '/* form：多字段表单（纵向布局 + 聚焦高亮 + 错误态 + 必填星号） */',
  '.dtt-iu__form { display: flex; flex-direction: column; gap: 12px; margin: 6px 0 2px; }',
  '.dtt-iu__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }',
  '.dtt-iu__label { font-size: calc(12px * var(--iu-text-scale, 1)); font-weight: 600; line-height: 1.5;',
  '  opacity: .78; display: flex; align-items: center; gap: 3px;',
  '  transition: color .18s ease, opacity .18s ease; }',
  '.dtt-iu__req { color: var(--dsw-alias-state-error-primary, #e8503a); font-weight: 700; line-height: 1; }',
  /* 文本类控件通用外观（input / textarea / select 共用一套描边与过渡） */
  '.dtt-iu__input, .dtt-iu__textarea, .dtt-iu__select {',
  '  width: 100%; box-sizing: border-box; font: inherit; color: inherit;',
  '  font-size: calc(13px * var(--iu-text-scale, 1));',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06));',
  '  border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.25));',
  '  border-radius: 8px; padding: 7px 9px;',
  '  transition: border-color .18s ease, box-shadow .18s ease, background-color .18s ease; }',
  '.dtt-iu__textarea { resize: vertical; min-height: 56px; line-height: 1.55; }',
  '.dtt-iu__select { cursor: pointer; }',
  '.dtt-iu__input:focus-visible, .dtt-iu__textarea:focus-visible, .dtt-iu__select:focus-visible {',
  '  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 1px; }',
  /* 聚焦高亮：品牌色描边 + 一圈光晕；focus-within 顺带点亮该字段的 label */
  '.dtt-iu__input:focus, .dtt-iu__textarea:focus, .dtt-iu__select:focus {',
  '  outline: none; border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: var(--dsw-alias-bg-layer-1, #fff);',
  '  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 18%, transparent); }',
  '.dtt-iu__field:focus-within .dtt-iu__label {',
  '  color: var(--dsw-alias-state-business-primary, #4176e6); opacity: 1; }',
  /* 错误态：红色描边 + 红色 label + 轻量提示（淡入上浮，可见性不依赖动画） */
  '.dtt-iu__field[data-invalid="1"] .dtt-iu__input,',
  '.dtt-iu__field[data-invalid="1"] .dtt-iu__textarea,',
  '.dtt-iu__field[data-invalid="1"] .dtt-iu__select {',
  '  border-color: var(--dsw-alias-state-error-primary, #e8503a); }',
  '.dtt-iu__field[data-invalid="1"] .dtt-iu__input:focus,',
  '.dtt-iu__field[data-invalid="1"] .dtt-iu__textarea:focus,',
  '.dtt-iu__field[data-invalid="1"] .dtt-iu__select:focus {',
  '  border-color: var(--dsw-alias-state-error-primary, #e8503a);',
  '  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary, #e8503a) 18%, transparent); }',
  '.dtt-iu__field[data-invalid="1"] .dtt-iu__label {',
  '  color: var(--dsw-alias-state-error-primary, #e8503a); opacity: 1; }',
  '.dtt-iu__form-err { font-size: calc(11px * var(--iu-text-scale, 1));',
  '  color: var(--dsw-alias-state-error-primary, #e8503a);',
  '  animation: dtt-iu-err-in .22s ease both; }',
  '@keyframes dtt-iu-err-in { from { opacity: .45; transform: translateY(-2px) } to { opacity: 1; transform: none } }',
  /* checkbox 可点行（参照 checklist 手感；.dtt-iu__box 基础样式复用基座 IU_CSS） */
  '.dtt-iu__checkbox { display: inline-flex; align-items: center; gap: 8px;',
  '  width: 100%; max-width: 100%; border: 0; background: transparent;',
  '  color: inherit; font: inherit; cursor: pointer; border-radius: 8px;',
  '  padding: 5px 9px 5px 7px; margin-left: -7px;',
  '  font-size: calc(13px * var(--iu-text-scale, 1));',
  '  transition: background-color .18s ease, transform .12s ease; }',
  '.dtt-iu__checkbox:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); }',
  '.dtt-iu__checkbox:active { transform: scale(.98); }',
  '.dtt-iu__checkbox:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }',
  '.dtt-iu__checkbox-text { font-size: calc(12.5px * var(--iu-text-scale, 1)); opacity: .8;',
  '  transition: opacity .18s ease, font-weight .18s ease; }',
  /* 选中态：基座只给了 .dtt-iu__check 版本，这里补 .dtt-iu__checkbox 版本 */
  '.dtt-iu__checkbox[data-on="1"] .dtt-iu__box {',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6); transform: scale(1.06); }',
  '.dtt-iu__checkbox[data-on="1"] .dtt-iu__box svg { opacity: 1; transform: none; }',
  '.dtt-iu__checkbox[data-on="1"] .dtt-iu__checkbox-text { opacity: 1; font-weight: 600; }',
  '/* 无障碍：关掉全部动效。错误提示与勾选态都停在最终态，关掉后照样完整可读，',
  '   可见性不依赖动画（与图表那条纪律一致）。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__form-err { animation: none; }',
  '  .dtt-iu__input, .dtt-iu__textarea, .dtt-iu__select,',
  '  .dtt-iu__label, .dtt-iu__checkbox, .dtt-iu__checkbox-text,',
  '  .dtt-iu__box, .dtt-iu__box svg { transition: none; }',
  '  .dtt-iu__checkbox:hover, .dtt-iu__checkbox:active { transform: none; }',
  '}',
  /* 窄屏：控件本就 width:100% 满宽；checkbox 行也铺满，扩大点击区 */
  '@media (max-width: 480px) {',
  '  .dtt-iu__form { gap: 9px; }',
  '  .dtt-iu__checkbox { width: 100%; margin-left: 0; }',
  '}',
].join('\n')

export const formKind: IuKind<FormState, IuFormSpec> = {
  kind: 'form',
  label: '表单',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · form 表单：{"kind":"form","title":"报名信息","desc":"请填写以下信息","submitLabel":"提交","fields":[{"id":"name","label":"姓名","type":"text","placeholder":"请输入姓名","required":true},{"id":"age","label":"年龄","type":"number","placeholder":"如 25"},{"id":"city","label":"城市","type":"select","options":["北京","上海","广州"]},{"id":"agree","label":"同意条款","type":"checkbox","required":true},{"id":"note","label":"备注","type":"textarea","placeholder":"选填"}]}（约束：type 五选一 text/number/select/checkbox/textarea、fields≤10、select 必须带 options≤12、field id 唯一≤16；「提交」= 把填好的内容拼成文本回写输入框由用户发送，不发网络请求）。',
}
