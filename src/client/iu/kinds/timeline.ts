/**
 * iu kind: **timeline**（时间线 / 里程碑）。
 *
 * 结构照抄范本 slider.ts：纯逻辑半边（零 React、零 DOM，host 截图管线可
 * import），React 体在同名 timeline.body.tsx 里。
 *
 * 设计要点：
 *  · 竖 / 横两套主轴（spec.orientation），窄屏 horizontal 由 CSS 降级为竖向；
 *  · 节点三态：done=实心绿（默认白对勾，可用 icon 覆盖）、active=品牌色
 *    脉冲呼吸、todo=空心灰；
 *  · 连接线走 item 的 ::before 伪元素（零额外 DOM，snapshot 与 Body 天然
 *    对齐）：从当前节点中心连到下一节点中心，done 段实线绿、其余虚线灰，
 *    末项不画；
 *  · 交互只有一个：竖向视图下点击某项展开/收起 body（accordion，
 *    max-height 过渡），状态持久化在 { expanded: number|null }。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { esc, escAttr, oneOf, pickAll, str, strOr } from './core.ts'

/** 节点状态白名单。 */
export const TL_STATUSES = ['done', 'active', 'todo'] as const
export type TlStatus = (typeof TL_STATUSES)[number]

/** 主轴方向白名单。 */
export const TL_ORIENTS = ['vertical', 'horizontal'] as const
export type TlOrientation = (typeof TL_ORIENTS)[number]

/** 一个时间线节点。 */
export interface IuTimelineItem {
  readonly label: string
  /** 显示用日期 / 阶段文字（可空）。 */
  readonly date: string
  /** 展开后的正文（可空；空则点了也没内容，Body 不渲染该元素）。 */
  readonly body: string
  readonly status: TlStatus
  /** 节点圆点里的 emoji 或短字（≤4；空则 done 显示对勾 svg、其余空圆点）。 */
  readonly icon: string
}

export interface IuTimelineSpec extends IuSpecBase {
  readonly kind: 'timeline'
  readonly title: string
  readonly desc: string
  readonly items: readonly IuTimelineItem[]
  readonly orientation: TlOrientation
}

/** timeline 的本地状态（持久化）：当前展开的项下标，null=全收起。 */
export interface TimelineState extends IuState {
  readonly expanded: number | null
}

/**
 * 校验并归一「当前展开项」（fillText 与 Body 共用，两侧永远一致）：
 * 持久化里可能是脏数据 / 越界下标，一律回 null；横向视图不提供展开
 * （窄列里塞正文没有可读性），同样回 null。
 */
export function expandedOf(spec: IuTimelineSpec, state: TimelineState): number | null {
  if (spec.orientation !== 'vertical') return null
  const v = state.expanded
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= spec.items.length) return null
  return v
}

function parse(raw: Record<string, unknown>): IuTimelineSpec | undefined {
  const items = pickAll<IuTimelineItem>(raw.items, 16, (it) => {
    const label = str(it.label, 40)
    if (label === '') return undefined
    return {
      label,
      date: str(it.date, 24),
      body: str(it.body, 120),
      status: oneOf<TlStatus>(it.status, TL_STATUSES, 'todo'),
      icon: str(it.icon, 4),
    }
  })
  return {
    kind: 'timeline',
    title: strOr(raw.title, 40, '时间线'),
    desc: str(raw.desc, 80),
    items,
    orientation: oneOf<TlOrientation>(raw.orientation, TL_ORIENTS, 'vertical'),
  }
}

function initState(_spec: IuTimelineSpec): TimelineState {
  return { expanded: null }
}

function fillText(spec: IuTimelineSpec, state: TimelineState): string {
  const doneCount = spec.items.reduce((n, it) => (it.status === 'done' ? n + 1 : n), 0)
  const idx = expandedOf(spec, state)
  const cur = idx !== null ? spec.items[idx] : undefined
  const tail = cur !== undefined ? `，当前看「${cur.label}」` : ''
  return `${spec.title}：${spec.items.length} 个节点，已完成 ${doneCount}${tail}`
}

/** 节点圆点内容：icon 优先，其次 done 的对勾 svg，否则空（与 Body 同序同条件）。 */
const CHECK_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff"'
  + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 5.2 4 7.4 8.2 2.6"/></svg>'

/**
 * 静态快照（截图用）。DOM 结构与 timeline.body.tsx **逐字对齐**：
 * desc → .dtt-iu__timeline[data-orient] → 每项 .dtt-iu__tl-item[data-status][data-expanded]
 * → .dtt-iu__tl-node + .dtt-iu__tl-content（date? + label + body?）。
 * 按初始 state 定格：全部收起（data-expanded="0"）。连接线是 ::before
 * 伪元素，不在 DOM 里。所有模型文本走 esc / escAttr。
 */
function snapshot(spec: IuTimelineSpec): string {
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const vertical = spec.orientation === 'vertical'
  const items = spec.items.map((it) => {
    const nodeInner = it.icon !== '' ? esc(it.icon) : (it.status === 'done' ? CHECK_SVG : '')
    const date = it.date !== '' ? `<span class="dtt-iu__tl-date">${esc(it.date)}</span>` : ''
    const body = it.body !== '' ? `<div class="dtt-iu__tl-body">${esc(it.body)}</div>` : ''
    // 竖向每项是可点的 accordion 头；横向不可点，不给 role（与 Body 同条件）。
    // 初始态全收起 → aria-expanded="false"；aria-label 与 Body 一致（tabIndex
    // 是交互专用、静态截图无 tab 序，故略）。
    const a11y = vertical ? ` role="button" aria-expanded="false" aria-label="${escAttr(it.label)}"` : ''
    return `<div class="dtt-iu__tl-item" data-status="${escAttr(it.status)}" data-expanded="0"${a11y}>`
      + `<span class="dtt-iu__tl-node" aria-hidden="true">${nodeInner}</span>`
      + `<div class="dtt-iu__tl-content">${date}<span class="dtt-iu__tl-label">${esc(it.label)}</span>${body}</div>`
      + '</div>'
  }).join('')
  return `${desc}<div class="dtt-iu__timeline" data-orient="${escAttr(spec.orientation)}">${items}</div>`
}

const CSS = [
  '/* timeline：竖/横双主轴时间线。节点三态（done=实心绿、active=品牌色脉冲、',
  '   todo=空心灰），连接线 done 段实线、其余虚线。纪律（同 slider/chart 那条）：',
  '   节点与文字的可见性永远不依赖动画——脉冲光环、展开过渡、hover 位移只是',
  '   增强；reduced-motion / 无头截图 / 全局节流把动画停掉后，节点仍靠描边与',
  '   填充色区分三态，展开中的 body 直接以最终 max-height 可见。 */',
  '.dtt-iu__timeline { position: relative; margin: 8px 0 2px; }',
  '/* 主轴：竖向 */',
  '.dtt-iu__timeline[data-orient="vertical"] { display: flex; flex-direction: column; }',
  '/* 主轴：横向（窄屏在下方 media 里降级为竖向） */',
  '.dtt-iu__timeline[data-orient="horizontal"] { display: flex; align-items: flex-start;',
  '  overflow-x: auto; padding-bottom: 4px; }',
  '/* 项：竖向 = 一行（节点在左、文字在右） */',
  '.dtt-iu__tl-item { position: relative; display: flex; gap: 10px; align-items: flex-start;',
  '  padding: 6px 8px; border-radius: 10px; cursor: pointer;',
  '  transition: background-color .18s ease, transform .18s ease, box-shadow .18s ease, opacity .18s ease; }',
  '.dtt-iu__tl-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); transform: translateX(1px); }',
  '.dtt-iu__tl-item:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 1px; }',
  '/* 项：横向 = 一列（节点在上、文字在下），flex 等分——等宽是连接线 width:100%',
  '   正好连到下一节点中心的前提 */',
  '.dtt-iu__timeline[data-orient="horizontal"] .dtt-iu__tl-item { flex: 1 1 0; min-width: 88px;',
  '  flex-direction: column; align-items: center; text-align: center; gap: 6px;',
  '  padding: 6px 4px; cursor: default; }',
  '.dtt-iu__timeline[data-orient="horizontal"] .dtt-iu__tl-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); transform: translateY(-1px); }',
  '/* 连接线：::before 伪元素（零额外 DOM，snapshot 与 Body 天然对齐）。',
  '   从当前节点中心连到下一节点中心，节点的不透明背景盖住穿过圆点的那段；',
  '   末项不画。默认虚线灰（todo/active 段）。 */',
  '.dtt-iu__tl-item::before { content: ""; position: absolute; z-index: 0;',
  '  border: 0 dashed var(--dsw-alias-label-tertiary, rgba(127,127,127,.5)); }',
  '.dtt-iu__tl-item:last-child::before { content: none; }',
  '/* 竖向几何：left=节点中心 x（padding 8 + 半径 10 - 线宽 1），top/bottom=节点',
  '   中心 y（padding 6 + 半径 10）到下一项同位置 */',
  '.dtt-iu__timeline[data-orient="vertical"] .dtt-iu__tl-item::before { left: calc(18px * var(--iu-text-scale, 1) - 1px); top: calc(16px * var(--iu-text-scale, 1)); bottom: calc(-16px * var(--iu-text-scale, 1)); border-left-width: 2px; }',
  '/* 横向几何：top=节点中心 y（padding 6 + 半径 10 - 线宽 1），从自身 50% 横跨',
  '   一个等分项宽到达下一节点中心 */',
  '.dtt-iu__timeline[data-orient="horizontal"] .dtt-iu__tl-item::before { left: 50%; top: calc(16px * var(--iu-text-scale, 1) - 1px); width: 100%; border-top-width: 2px; }',
  '/* done 段：实线绿（border-style 设四边、但其余边 width 为 0 不可见） */',
  '.dtt-iu__tl-item[data-status="done"]::before { border-style: solid;',
  '  border-color: var(--dsw-alias-state-success-primary, #27ae60); }',
  '/* 节点圆点：三态共用底座。背景不透明（盖住穿过的连接线）；',
  '   z-index 高于 ::before */',
  '.dtt-iu__tl-node { position: relative; z-index: 1; flex: none; width: 20px; height: 20px;',
  '  border-radius: 50%; box-sizing: border-box; display: inline-flex; align-items: center;',
  '  justify-content: center; font-size: calc(11px * var(--iu-text-scale, 1)); line-height: 1;',
  '  border: 2px solid var(--dsw-alias-label-tertiary, rgba(127,127,127,.55));',
  '  background: var(--dsw-alias-bg-layer-1, #fff);',
  '  transition: border-color .2s ease, background-color .2s ease, transform .2s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-iu__tl-item:hover .dtt-iu__tl-node { transform: scale(1.1); }',
  '/* done：实心绿 + 白色对勾（icon 非空时显示 icon） */',
  '.dtt-iu__tl-item[data-status="done"] .dtt-iu__tl-node {',
  '  background: var(--dsw-alias-state-success-primary, #27ae60);',
  '  border-color: var(--dsw-alias-state-success-primary, #27ae60); color: #fff; }',
  '/* active：品牌色描边 + 脉冲呼吸（光环扩散 + 轻微缩放；节点本体始终可见，',
  '   动画只是增强）。active 的 hover 缩放让位给 animation（动画优先级更高）。 */',
  '.dtt-iu__tl-item[data-status="active"] {',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 7%, transparent); }',
  '.dtt-iu__tl-item[data-status="active"]:hover {',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 7%, transparent);',
  '  box-shadow: 0 2px 8px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 22%, transparent); }',
  '.dtt-iu__tl-item[data-status="active"] .dtt-iu__tl-node {',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  color: var(--dsw-alias-state-business-primary, #4176e6); font-weight: 700;',
  '  animation: dtt-iu-tl-pulse 1.8s ease-in-out infinite; }',
  '@keyframes dtt-iu-tl-pulse {',
  '  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 42%, transparent); }',
  '  50% { transform: scale(1.08); box-shadow: 0 0 0 6px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 0%, transparent); }',
  '}',
  '/* 文字列 */',
  '.dtt-iu__tl-content { min-width: 0; flex: 1; }',
  '.dtt-iu__tl-date { display: block; font-size: calc(11px * var(--iu-text-scale, 1));',
  '  opacity: .55; font-variant-numeric: tabular-nums; letter-spacing: .02em; }',
  '.dtt-iu__tl-label { display: block; font-size: calc(13px * var(--iu-text-scale, 1));',
  '  font-weight: 600; line-height: calc(20px * var(--iu-text-scale, 1)); text-wrap: balance; }',
  '.dtt-iu__tl-item[data-status="todo"] .dtt-iu__tl-label { font-weight: 500; opacity: .72; }',
  '/* 展开 body：max-height + opacity 过渡（accordion 手感）。横向视图 Body 侧',
  '   永远 data-expanded="0"，这里不用再加横向特例 */',
  '.dtt-iu__tl-body { max-height: 0; opacity: 0; overflow: hidden;',
  '  font-size: calc(12px * var(--iu-text-scale, 1)); line-height: 1.6;',
  '  transition: max-height .32s cubic-bezier(.2,.8,.25,1), opacity .2s ease; }',
  '.dtt-iu__tl-item[data-expanded="1"] .dtt-iu__tl-body {',
  '  max-height: calc(220px * var(--iu-text-scale, 1)); opacity: .85; }',
  '/* 窄屏：horizontal 降级为竖向（item 几何、连接线几何整套切回竖线） */',
  '@media (max-width: 640px) {',
  '  .dtt-iu__timeline[data-orient="horizontal"] { flex-direction: column; overflow-x: visible; }',
  '  .dtt-iu__timeline[data-orient="horizontal"] .dtt-iu__tl-item { flex-direction: row;',
  '    align-items: flex-start; text-align: left; gap: 10px; min-width: 0; padding: 6px 8px; }',
  '  .dtt-iu__timeline[data-orient="horizontal"] .dtt-iu__tl-item:hover { transform: translateX(1px); }',
  '  .dtt-iu__timeline[data-orient="horizontal"] .dtt-iu__tl-item::before { left: calc(18px * var(--iu-text-scale, 1) - 1px); top: calc(16px * var(--iu-text-scale, 1));',
  '    bottom: calc(-16px * var(--iu-text-scale, 1)); width: auto; border-top-width: 0; border-left-width: 2px; }',
  '}',
  '/* 无障碍：关脉冲与全部过渡。active 态改用静态品牌色光环区分（不依赖动画），',
  '   展开中的 body 因 transition:none 直接以最终 max-height 呈现——节点与内容',
  '   可见性零损失。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__tl-item[data-status="active"] .dtt-iu__tl-node { animation: none;',
  '    box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 25%, transparent); }',
  '  .dtt-iu__tl-item, .dtt-iu__tl-node, .dtt-iu__tl-body { transition: none; }',
  '  .dtt-iu__tl-item:hover, .dtt-iu__tl-item:hover .dtt-iu__tl-node { transform: none; }',
  '}',
].join('\n')

export const timelineKind: IuKind<TimelineState, IuTimelineSpec> = {
  kind: 'timeline',
  label: '时间线',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · timeline 时间线：{"kind":"timeline","title":"发布计划","desc":"Q2 三步走","orientation":"vertical","items":[{"label":"需求冻结","date":"3月1日","status":"done"},{"label":"灰度上线","date":"4月中","status":"active","icon":"🚀","body":"内部 10% 流量，盯崩溃率与留存"},{"label":"全量发布","date":"5月1日","status":"todo"}]}（约束：items≤16、label 必填≤40，date≤24、body≤120、icon≤4 可选；status 三选一 done|active|todo 默认 todo；orientation 可选 vertical|horizontal 默认 vertical；竖向点节点展开 body，状态会记住）。',
}
