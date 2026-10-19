/**
 * iu kind: **slider**（拖动取值 → 联动换算输出）。
 *
 * 这是所有 kind 的**范本文件**：新增 kind 请照抄本文件的结构（纯逻辑半边），
 * 以及 slider.body.tsx（React 半边）。一个 kind = 这两个文件 + registry/bodies
 * 各一行注册，不需要改任何其它文件。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 *   React 体一律写在同名 .body.tsx 里。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { esc, formatNum, num, pickAll, str } from './core.ts'

/** 一条换算输出。 */
export interface IuSliderOutput {
  readonly label: string
  /** 每单位主值对应多少（outputs 值 = 主值 × per）。 */
  readonly per: number
  readonly unit: string
}

export interface IuSliderSpec extends IuSpecBase {
  readonly kind: 'slider'
  readonly title: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly unit: string
  readonly desc: string
  readonly outputs: readonly IuSliderOutput[]
}

/** slider 的本地状态（持久化）。 */
export interface SliderState extends IuState {
  readonly value: number
}

function parse(raw: Record<string, unknown>): IuSliderSpec | undefined {
  let min = num(raw.min, -1000000, 1000000, 1)
  let max = num(raw.max, -1000000, 1000000, 10)
  if (!(max > min)) max = min + 1
  const stepRaw = num(raw.step, 0, 1000000, 1)
  const step = stepRaw > 0 ? stepRaw : 1
  const value = Math.min(max, Math.max(min, num(raw.value, min, max, min)))
  const outputs = pickAll<IuSliderOutput>(raw.outputs, 8, (it) => {
    const label = str(it.label, 16)
    if (label === '') return undefined
    return { label, per: num(it.per, 0, 1000000000, 0), unit: str(it.unit, 8) }
  })
  return {
    kind: 'slider',
    title: str(raw.title, 40) || '取值',
    min, max, step, value,
    unit: str(raw.unit, 8),
    desc: str(raw.desc, 80),
    outputs,
  }
}

function initState(spec: IuSliderSpec): SliderState {
  return { value: spec.value }
}

/** 回填文本必须含真实数值（老 chartFillText 只回 labels 是反例）。 */
function fillText(spec: IuSliderSpec, state: SliderState): string {
  const value = num(state.value, spec.min, spec.max, spec.value)
  const bits = spec.outputs.map(o => `${o.label}${formatNum(value * o.per)}${o.unit}`)
  const tail = bits.length > 0 ? `，${bits.join('、')}` : ''
  return `${spec.title}：取 ${formatNum(value)}${spec.unit}${tail}`
}

/**
 * 静态快照（截图用）。DOM 结构与 slider.body.tsx **逐字对齐**：
 * 共用同一份 CSS 就必须共用结构，否则截图会长歪（见 contract.ts 头注释）。
 * 约定：desc 紧跟 Head（正文最前），其后 slider-top → range → outs。
 */
function snapshot(spec: IuSliderSpec): string {
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const outs = spec.outputs.length > 0
    ? `<div class="dtt-iu__outs">${spec.outputs.map(o =>
      `<div class="dtt-iu__out"><b>${formatNum(spec.value * o.per)}${esc(o.unit)}</b><span>${esc(o.label)}</span></div>`,
    ).join('')}</div>`
    : ''
  return `${desc}<div class="dtt-iu__slider-top"><span class="dtt-iu__slider-val">${formatNum(spec.value)}</span>`
    + (spec.unit !== '' ? `<span class="dtt-iu__slider-unit">${esc(spec.unit)}</span>` : '')
    + `</div>`
    + `<input type="range" class="dtt-iu__range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" disabled>`
    + outs
}

const CSS = [
  '/* slider：读数行 + 原生 range + 换算输出 */',
  '/* 读数行：22px 品牌蓝大数字 + 左侧 3px 蓝竖条 = 仪表盘/KPI 的语言，正文里太响。',
  '   现在读数仍是最重的一笔（17px/600 等宽数字），但换成正文色，只比正文大一号。 */',
  '.dtt-iu__slider-top { display: flex; align-items: baseline; gap: 8px; margin: 6px 0 8px; }',
  '.dtt-iu__slider-val { font-size: calc(17px * var(--iu-text-scale, 1)); font-weight: 600;',
  '  font-variant-numeric: tabular-nums; color: inherit;',
  '  letter-spacing: -.01em; transition: opacity .18s ease; }',
  '.dtt-iu__slider-unit { font-size: calc(11px * var(--iu-text-scale, 1)); opacity: .55;',
  '  font-variant-numeric: tabular-nums; }',
  '.dtt-iu input[type=range].dtt-iu__range { width: 100%; margin: 8px 0 6px;',
  '  accent-color: var(--dsw-alias-state-business-primary, #4176e6); cursor: pointer; }',
  '.dtt-iu__slider-top + .dtt-iu__range { margin-bottom: 10px; }',
  '/* 换算输出：**不画成小卡**。',
  ' *',
  ' * 融合第二版（2026-10-19）：原先是「每项一块带投影的小方块，hover 上浮 + 蓝光」——',
  ' * 一张滑块卡里再嵌 N 张卡，且 hover 的位移让数值块像可点的按钮（其实不可点）。',
  ' * 现在输出是纯排版：极淡底色 + 无投影 + 无位移，hover 只提亮底色；',
  ' * 视觉重心交给数值本身（13px/700 tabular-nums）。 */',
  '/* auto-fit：换算输出只有一两项时，auto-fill 会让它们挤在左边、右边空一半',
  '   （实测 1100px 下 2 项占 244px、右侧空 651px）。auto-fit 让现有项均分整行。 */',
  '.dtt-iu__outs { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));',
  '  gap: 8px; margin-top: 10px; align-items: start; }',
  '.dtt-iu__out { border-radius: 8px; padding: 8px 10px;',
  '  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);',
  '  transition: background-color .18s ease; }',
  '.dtt-iu__out:first-child { grid-column: span 2; }',
  '.dtt-iu__out:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }',
  '.dtt-iu__out b { display: block; font-size: calc(13px * var(--iu-text-scale, 1)); font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.35; }',
  '.dtt-iu__out span { display: block; font-size: calc(11px * var(--iu-text-scale, 1)); opacity: .55;',
  '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '.dtt-iu input[type=range].dtt-iu__range:focus-visible { outline: 2px solid',
  '  var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__out, .dtt-iu__slider-val { transition: background-color .18s ease, box-shadow .18s ease, opacity .18s ease; }',
  '  .dtt-iu__out:hover { transform: none; }',
  '}',
].join('\n')

export const sliderKind: IuKind<SliderState, IuSliderSpec> = {
  kind: 'slider',
  label: '滑块',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · slider 取值：{"kind":"slider","title":"标题","min":1,"max":10,"step":1,"value":4,"unit":"人","desc":"一句话","outputs":[{"label":"面粉","per":120,"unit":"g"}]}（outputs 最多 8 项，per=每单位用量；拖动即时联动换算，值会记住）。',
}
