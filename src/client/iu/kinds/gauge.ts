/**
 * iu kind: **gauge**（仪表盘 / 进度环，可多指标）。
 *
 * 结构照抄 slider.ts 范本：本文件是**纯逻辑半边**（零 React、零 DOM），
 * React 体在 gauge.body.tsx。几何计算（弧路径、dasharray/dashoffset、指针
 * 角度）全部在本文件导出，Body 与 snapshot **共用同一个 gaugeGeometry()**——
 * SVG 坐标绝不允许两边各算各的，否则截图与对话流的弧长不一致。
 *
 * 动画纪律（同 chart 的「可见性不依赖动画」）：
 *  · 值弧的真实进度写在 `stroke-dashoffset` 属性上（= 目标值，唯一真相）；
 *  · CSS 入场动画只有一个 `from { stroke-dashoffset: var(--g-full) }`
 *    （满偏移），隐式 to 帧就是属性目标值——动画被关（reduced-motion /
 *    截图）时弧直接停在目标值，不会消失或停错位置；
 *  · 指针：角度经 CSS 变量 `--g-rot` 传入 `transform: rotate(var(--g-rot))`，
 *    配合 CSS transform-origin(60,64)=圆心；入场动画 from 帧固定 -90°（min 侧），
 *    隐式 to 帧 = 变量角度。快照内联 animation:none 定格在目标角度。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { STATE_COLORS, esc, escAttr, formatNum, num, oneOf, pickAll, seriesColor, str, strOr } from './core.ts'

/** 仪表形状：arc=半圆仪表带指针，ring=整圆进度环。 */
export type GaugeShape = 'arc' | 'ring'

export const GAUGE_SHAPES = ['arc', 'ring'] as const

/** 阈值（可选）：按 value 落区变色。默认「越高越坏」；若 bad < warn 视为「越低越坏」（如电量）。 */
export interface GaugeThresholds {
  readonly warn: number
  readonly bad: number
}

/** 单个仪表指标。 */
export interface IuGaugeItem {
  readonly label: string
  /** 已钳进 [min, max] 的当前值。 */
  readonly value: number
  readonly min: number
  readonly max: number
  readonly unit: string
  readonly thresholds?: GaugeThresholds | undefined
}

export interface IuGaugeSpec extends IuSpecBase {
  readonly kind: 'gauge'
  readonly title: string
  readonly desc: string
  readonly shape: GaugeShape
  /** 1–4 个仪表，横向排列，点击切换 active。 */
  readonly gauges: readonly IuGaugeItem[]
}

/** gauge 的本地状态（持久化）：当前聚焦（放大高亮）的仪表下标。 */
export interface GaugeState extends IuState {
  readonly active: number
}

/* ------------------------------------------------------------------ */
/* 几何（纯函数；Body 与 snapshot 共用，禁止在别处重算）                  */
/* ------------------------------------------------------------------ */

/** arc 形状：半圆（180°），圆心在底部中点，viewBox 固定 120×76。 */
export const GAUGE_ARC_VIEWBOX = '0 0 120 76'
const ARC_CX = 60
const ARC_CY = 64
const ARC_R = 48
/** 指针是贴着弧带外侧扫过的短刻度棒（不穿圆心，避免盖住中心读数）。 */
const ARC_NEEDLE_OUTER = 57
const ARC_NEEDLE_INNER = 53
/** 中心读数基线（略高于圆心，落在半圆腹腔里）。 */
const ARC_TEXT_Y = 57

/** ring 形状：整圆，viewBox 固定 100×100，起点在 12 点方向、顺时针。 */
export const GAUGE_RING_VIEWBOX = '0 0 100 100'
const RING_CX = 50
const RING_CY = 50
const RING_R = 40

/** 两位小数（序列化进 SVG 属性，避免超长浮点尾巴）。 */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 指针几何（仅 arc）：竖直线段 + 绕圆心的旋转角（CSS/属性共用同一角度）。 */
export interface GaugeNeedleGeom {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  /** 旋转角（deg）：t=0 → -90（指向 min 侧），t=1 → +90（指向 max 侧）。 */
  readonly rotDeg: number
}

/** 一个仪表的全部绘制参数（Body 与 snapshot 逐字段消费同一份）。 */
export interface GaugeGeometry {
  readonly viewBox: string
  /** 背景弧路径。 */
  readonly trackD: string
  /** 值弧路径（与 track 同路径，靠 dasharray/dashoffset 截出进度）。 */
  readonly barD: string
  /** 整条弧长 = stroke-dasharray；也是入场动画的起点偏移（--g-full）。 */
  readonly dashLen: number
  /** 目标偏移 = dashLen × (1 − t)；这是静态真相，动画终点即此值。 */
  readonly dashOffset: number
  /** 值弧 / 指针 / 读数的颜色（thresholds 落区色或系列色）。 */
  readonly color: string
  /** arc 专有指针；ring 为 undefined。 */
  readonly needle: GaugeNeedleGeom | undefined
  /** 中心读数 text 的锚点与基线。 */
  readonly textX: number
  readonly textY: number
  readonly textBaseline: 'auto' | 'middle'
  /** 值在 [min,max] 里的归一化比例（已钳位）。 */
  readonly ratio: number
}

/** 值 → [0,1] 线性映射（钳到 [min,max]；span 非法时回 0）。 */
export function gaugeRatio(g: IuGaugeItem): number {
  const span = g.max - g.min
  if (!(span > 0) || !Number.isFinite(g.value)) return 0
  return Math.min(1, Math.max(0, (g.value - g.min) / span))
}

/**
 * 颜色：有 thresholds 时按 value 落区选 STATE_COLORS.ok/warn/bad
 * （bad ≥ warn 为「越高越坏」，反之为「越低越坏」）；否则 seriesColor(index)。
 */
export function gaugeColor(g: IuGaugeItem, index: number): string {
  const th = g.thresholds
  if (th === undefined) return seriesColor(index)
  const v = g.value
  if (th.bad >= th.warn) {
    if (v >= th.bad) return STATE_COLORS.bad
    if (v >= th.warn) return STATE_COLORS.warn
    return STATE_COLORS.ok
  }
  if (v <= th.bad) return STATE_COLORS.bad
  if (v <= th.warn) return STATE_COLORS.warn
  return STATE_COLORS.ok
}

/**
 * 唯一的几何入口：Body 与 snapshot 都从这里拿路径 / dash / 指针 / 读数位置。
 *
 * arc：半圆弧 `M (cx−R) cy A R R 0 0 1 (cx+R) cy`（sweep=1 走顶部），
 *      弧长 πR；指针画成竖直短线（贴弧带外侧），旋转角 t×180°−90°，
 *      旋转角经 CSS 变量 --g-rot 传入，配合 CSS transform-origin(60,64)=圆心
 *      绕圆心转；from/to 全在 CSS transform 空间，摆动顺滑且截图能定格。
 * ring：整圆路径从 12 点方向起、两段半圆顺时针闭合，周长 2πR，
 *      dashoffset 从路径起点（顶部）顺时针截出进度，无需 rotate。
 */
export function gaugeGeometry(g: IuGaugeItem, index: number, shape: GaugeShape): GaugeGeometry {
  const t = gaugeRatio(g)
  const color = gaugeColor(g, index)
  if (shape === 'ring') {
    const d = `M ${RING_CX} ${RING_CY - RING_R} A ${RING_R} ${RING_R} 0 0 1 ${RING_CX} ${RING_CY + RING_R}`
      + ` A ${RING_R} ${RING_R} 0 0 1 ${RING_CX} ${RING_CY - RING_R}`
    const len = 2 * Math.PI * RING_R
    return {
      viewBox: GAUGE_RING_VIEWBOX,
      trackD: d, barD: d,
      dashLen: r2(len), dashOffset: r2(len * (1 - t)),
      color,
      needle: undefined,
      textX: RING_CX, textY: RING_CY, textBaseline: 'middle',
      ratio: t,
    }
  }
  const d = `M ${ARC_CX - ARC_R} ${ARC_CY} A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_CX + ARC_R} ${ARC_CY}`
  const len = Math.PI * ARC_R
  return {
    viewBox: GAUGE_ARC_VIEWBOX,
    trackD: d, barD: d,
    dashLen: r2(len), dashOffset: r2(len * (1 - t)),
    color,
    needle: {
      x1: ARC_CX, y1: ARC_CY - ARC_NEEDLE_OUTER,
      x2: ARC_CX, y2: ARC_CY - ARC_NEEDLE_INNER,
      rotDeg: r2(t * 180 - 90),
    },
    textX: ARC_CX, textY: ARC_TEXT_Y, textBaseline: 'auto',
    ratio: t,
  }
}

/* ------------------------------------------------------------------ */
/* kind 模块                                                            */
/* ------------------------------------------------------------------ */

function parseThresholds(v: unknown): GaugeThresholds | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  const warn = o.warn
  const bad = o.bad
  if (typeof warn !== 'number' || !Number.isFinite(warn)) return undefined
  if (typeof bad !== 'number' || !Number.isFinite(bad)) return undefined
  return { warn, bad }
}

function parse(raw: Record<string, unknown>): IuGaugeSpec | undefined {
  const shape = oneOf<GaugeShape>(raw.shape, GAUGE_SHAPES, 'arc')
  const gauges = pickAll<IuGaugeItem>(raw.gauges, 4, (it) => {
    const min = num(it.min, -1000000000, 1000000000, 0)
    let max = num(it.max, -1000000000, 1000000000, 100)
    if (!(max > min)) max = min + 1
    const value = Math.min(max, Math.max(min, num(it.value, -1000000000, 1000000000, min)))
    return {
      label: strOr(it.label, 16, '指标'),
      value, min, max,
      unit: str(it.unit, 8),
      thresholds: parseThresholds(it.thresholds),
    }
  })
  if (gauges.length === 0) return undefined
  return {
    kind: 'gauge',
    title: strOr(raw.title, 40, '仪表'),
    desc: str(raw.desc, 80),
    shape,
    gauges,
  }
}

function initState(_spec: IuGaugeSpec): GaugeState {
  return { active: 0 }
}

/** 回填文本必须含真实数值：各 gauge 拼 label+值+unit，「、」连接。 */
function fillText(spec: IuGaugeSpec, _state: GaugeState): string {
  const bits = spec.gauges.map(g => `${g.label}${formatNum(g.value)}${g.unit}`)
  return `${spec.title}：${bits.join('、')}`
}

/**
 * 单个仪表的静态 SVG + 标签（snapshot 专用拼串；结构必须与
 * gauge.body.tsx 逐字对齐：class、层级、顺序、几何字段全同）。
 */
function gaugeHtml(g: IuGaugeItem, index: number, shape: GaugeShape, active: boolean): string {
  const geo = gaugeGeometry(g, index, shape)
  const color = escAttr(geo.color)
  // 截图是定格：给值弧 / 指针内联 animation:none（特异性最高，覆盖 CSS 入场动画），
  // 让它们直接停在属性上的目标值；对话流 Body 不加这行，描边/摆动动画照常。
  const needle = geo.needle !== undefined
    ? `<line class="dtt-iu__gneedle" x1="${geo.needle.x1}" y1="${geo.needle.y1}" x2="${geo.needle.x2}" y2="${geo.needle.y2}" stroke="${color}" style="--g-rot:${geo.needle.rotDeg}deg;animation:none"/>`
    : ''
  const baseline = geo.textBaseline === 'middle' ? ' dominant-baseline="middle"' : ''
  const unit = g.unit !== '' ? `<span class="dtt-iu__gunit">${esc(g.unit)}</span>` : ''
  return `<div class="dtt-iu__gauge" data-active="${active ? 'true' : 'false'}" data-shape="${shape}">`
    + `<svg class="dtt-iu__gsvg" viewBox="${geo.viewBox}" style="color:${color}">`
    + `<path class="dtt-iu__gtrack" d="${geo.trackD}"/>`
    + `<path class="dtt-iu__gbar" d="${geo.barD}" stroke="${color}" stroke-dasharray="${geo.dashLen}" stroke-dashoffset="${geo.dashOffset}" style="--g-full:${geo.dashLen};animation:none"/>`
    + needle
    + `<text class="dtt-iu__gval" x="${geo.textX}" y="${geo.textY}"${baseline}>${esc(formatNum(g.value))}</text>`
    + `</svg>`
    + `<div class="dtt-iu__glabel"><span class="dtt-iu__gname">${esc(g.label)}</span>`
    + `<b class="dtt-iu__gread" style="color:${color}">${esc(formatNum(g.value))}${unit}</b></div>`
    + `</div>`
}

/** 静态快照：按初始状态（active=0）定格，值弧直接停在目标值。 */
function snapshot(spec: IuGaugeSpec): string {
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const items = spec.gauges.map((g, i) => gaugeHtml(g, i, spec.shape, i === 0)).join('')
  return `${desc}<div class="dtt-iu__gauges">${items}</div>`
}

const CSS = [
  '/* gauge：仪表盘/进度环（arc 半圆带指针 / ring 整圆），多仪表横排、点击聚焦。',
  '   动画纪律：进度真相写在 stroke-dashoffset / transform 属性上，keyframes 只有 from 帧',
  '   （满偏移 / -90°），隐式 to 帧 = 属性目标值——所以入场动画从满偏移描到真实值。',
  '   截图定格：snapshot() 给 gbar/gneedle 内联 animation:none（特异性最高），弧直接停在',
  '   目标值；对话流 Body 不加这行，动画照常。reduced-motion 下也关掉动画（同样停在目标值）。',
  '   ⚠ .dtt-iu__gtrack/.gbar 的 stroke-width(9/11) 与 gauge.ts 指针半径(53~57)联动，改一处要改另一处。 */',
  '.dtt-iu__gauges { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; align-items: flex-end; }',
  '/* 仪表单元：**不再是「一张小卡」**。',
  ' *',
  ' * 融合第二版（2026-10-19）：原先每个 gauge 自带底色 + 投影 + hover 上浮 + 蓝色光晕，',
  ' * 一排三个就是三张小卡并排（暗色下尤其像三块屏）。现在单元是透明的布局盒，',
  ' * 唯一的「面」只出现在聚焦态（正在看的那一个），悬停只提亮数值、不位移。',
  ' * ⚠ 别把 hover 位移加回来：仪表排成一行时，单个上浮会让整排跟着晃。 */',
  '/* 宽屏利用：仪表从「一排小表各自撑宽」改成「一行一条，读数在左、弧图在右」。',
  ' *',
  ' * 原来 max-width: 240px + flex: 1 1 104px，在 1100px 的对话流里三个仪表各占 256px，',
  ' * 但每个格子里的弧图只有 ~100px 宽，右侧留下 24% 的死空白 —— 空间全花在「格子」上，',
  ' * 信息却没有变多。改成横向一行一条之后：',
  ' *   · 数值回到主视线（左对齐、和正文同一条左基线，不再居中漂浮）；',
  ' *   · 弧图缩成 96px 的辅助图形，不再抢占列宽；',
  ' *   · 窄屏（<560px）自动退回原来的居中竖排，小屏不吃亏。 */',
  '/* 宽屏利用：**横排均分，不设 max-width**。',
  ' *',
  ' * 原来 max-width: 240px + flex: 1 1 104px：三个仪表各占 256px 就顶到上限，',
  ' * 1100px 的对话流里右侧留下 246px（24%）死白，而每个格子里的弧图只有 ~100px 宽。',
  ' * 空间花在「格子」上，信息却没变多。现在去掉上限、让它们真正均分整行：',
  ' *   · 每格约 340px，弧图跟着放大到 200px（SVG 是 viewBox 缩放，放大不糊）；',
  ' *   · 卡片宽度被用满，不再有大片右侧空白；',
  ' *   · 窄屏（<560px）仍会自然挤压，不会溢出。 */',
  '.dtt-iu__gauges { flex-direction: row; align-items: flex-end; gap: 12px; }',
  '.dtt-iu__gauge { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;',
  '  align-items: center; gap: 2px; padding: 6px 4px 4px; border-radius: var(--iu-r-md, 8px); cursor: pointer;',
  '  background: transparent;',
  '  transition: background-color .18s ease; }',
  '/* hover / 聚焦**不铺整行底色**：仪表已改成一行占满整宽，铺底就是一条横贯的通栏色带',
  '   （与表格斑马纹、看板列底是同一个错误）。反馈改走文字提亮 + 左侧一条 2px 竖线。 */',
  '.dtt-iu__gauge:hover .dtt-iu__gname { color: var(--dsw-alias-label-secondary, currentColor); }',
  '.dtt-iu__gauge:hover .dtt-iu__gread { opacity: 1; }',
  '.dtt-iu__gauge:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);',
  '  outline-offset: 2px; }',
  '/* 聚焦态不再画一圈描边（那是「选中的控件」）：只提亮底色 + 数值放大到 8%，',
  '   与 hover 之间靠「更亮一点 + 数值更大」区分，视觉上仍是正文里的一列读数。 */',
  '.dtt-iu__gauge[data-active="true"] { background: transparent; }',
  '.dtt-iu__gauge[data-active="true"] .dtt-iu__gname { color: var(--dsw-alias-label-secondary, currentColor); }',
  '.dtt-iu__gauge[data-active="true"] .dtt-iu__gread { opacity: 1; }',
  '.dtt-iu__gsvg { display: block; width: 100%; max-width: 200px; height: auto; overflow: visible; }',
  '.dtt-iu__gtrack { fill: none; stroke: rgba(127,127,127,.22); stroke-width: 9; } /* 轨道固定中性灰：纯装饰背景，不跟主题 token，保证截图与对话流一致 */',
  '.dtt-iu__gbar { fill: none; stroke-width: 9; stroke-linecap: round;',
  '  transition: opacity .18s ease;',
  '  animation: dtt-iu-gbar-in .9s cubic-bezier(.25,.8,.35,1); }',
  '@keyframes dtt-iu-gbar-in { from { stroke-dashoffset: var(--g-full, 0); } }',
  '.dtt-iu__gauge[data-active="true"] .dtt-iu__gbar { stroke-width: 11; }',
  '.dtt-iu__gneedle { stroke-width: 3.5; stroke-linecap: round; transform-box: view-box;',
  '  transform-origin: 60px 64px; /* 旋转中心 = ARC_CX/ARC_CY(60,64)，与 gauge.ts 常量对齐 */',
  '  transform: rotate(var(--g-rot, -90deg)); transition: opacity .18s ease;',
  '  animation: dtt-iu-gneedle-in 1s cubic-bezier(.34,1.15,.4,1) .06s backwards; }',
  '@keyframes dtt-iu-gneedle-in { from { transform: rotate(-90deg); } }',
  '.dtt-iu__gval { font-size: calc(15px * var(--iu-text-scale, 1)); font-weight: 700; text-anchor: middle; fill: currentColor;',
  '  font-variant-numeric: tabular-nums; letter-spacing: -.01em; transform-box: fill-box; transform-origin: center;',
  '  transition: transform .18s ease, opacity .18s ease; }',
  '.dtt-iu__gauge[data-active="true"] .dtt-iu__gval { transform: scale(1.08); }',
  '/* 读数主列：名字（小字灰）+ 数值（大字等宽）。左对齐是「一行数据」的读法；',
  '   居中会让每个数值各占一条中轴，宽屏下满屏都是浮在中间的数字。 */',
  '/* DOM 里 svg 在前、读数在后（snapshot 与 Body 共用同一顺序），grid 会把 svg 排进',
  '   第一列。order 把读数提回左侧主位：一行读作「CPU 72% ▁▂▃ 弧图」。 */',
  '.dtt-iu__glabel { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; max-width: 100%; }',
  '.dtt-iu__gname { font-size: calc(11.5px * var(--iu-text-scale, 1)); color: var(--dsw-alias-label-tertiary, currentColor); max-width: 100%;',
  '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '/* 弧图中心已经把数值放大画在圆心（19px/600 等宽），下面再写一遍「72%」是纯重复。',
  '   宽屏下这里只留名字，数值交给圆心；窄屏（弧图缩到 64px）圆心字太小，再把读数放回来。 */',
  '.dtt-iu__gread { display: none; font-size: calc(19px * var(--iu-text-scale, 1)); font-weight: 600; font-variant-numeric: tabular-nums;',
  '  line-height: 1.25; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
  '  transition: opacity .18s ease; }',
  '.dtt-iu__gunit { font-size: calc(11px * var(--iu-text-scale, 1)); font-weight: 400; opacity: .6; margin-left: 2px; }',
  '/* 窄屏：回到「一排小表、居中堆叠」的老形态（宽度不够时一行一条反而拥挤）。 */',
  '/* 窄屏：并排会挤爆，改成「左读数 + 右迷你弧」的一行一条。 */',
  '@media (max-width: 560px) {',
  '  .dtt-iu__gauges { flex-direction: column; align-items: stretch; gap: 2px; }',
  '  .dtt-iu__gauge { display: grid; grid-template-columns: 1fr 64px; align-items: center;',
  '    gap: 10px; padding: 3px 4px; }',
  '  .dtt-iu__glabel { order: -1; align-items: flex-start; }',
  '  .dtt-iu__gread { display: block; font-size: calc(17px * var(--iu-text-scale, 1)); }',
  '  .dtt-iu__gsvg { max-width: 64px; }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__gbar, .dtt-iu__gneedle { animation: none; }',
  '  .dtt-iu__gauge, .dtt-iu__gval { transition: background-color .18s ease, box-shadow .18s ease, opacity .18s ease; }',
  '  .dtt-iu__gbar, .dtt-iu__gread { transition: opacity .18s ease; }',
  '  .dtt-iu__gauge:hover, .dtt-iu__gauge[data-active="true"], .dtt-iu__gauge[data-active="true"]:hover,',
  '  .dtt-iu__gauge[data-active="true"] .dtt-iu__gval { transform: none; }',
  '}',
].join('\n')

export const gaugeKind: IuKind<GaugeState, IuGaugeSpec> = {
  kind: 'gauge',
  label: '仪表',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · gauge 仪表：{"kind":"gauge","title":"这台机器快满了","shape":"arc","desc":"实时负载","gauges":[{"label":"CPU","value":72,"unit":"%","thresholds":{"warn":70,"bad":90}},{"label":"内存","value":45,"unit":"%"},{"label":"磁盘","value":88,"unit":"%","min":0,"max":100}]}（约束：gauges≤4、shape=arc|ring（arc=半圆带指针，默认；ring=整圆进度环）、每项 value 钳到 [min,max]（默认 0–100）、可选 thresholds={warn,bad} 按值变色 ok/warn/bad；点击某个仪表可聚焦放大）。',
}
