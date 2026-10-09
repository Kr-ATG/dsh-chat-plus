/**
 * iu kind: **arch**（分层架构图：系统架构 / 技术栈的横向层带堆叠）。
 *
 * 结构照抄范本 slider.ts：纯逻辑半边（零 React、零 DOM，host 截图管线可
 * import），React 体在同名 arch.body.tsx 里。
 *
 * 设计要点：
 *  · 每层一个横向带：左侧层名标签（tone 语义色条 + 语义色文字），右侧盒子
 *    flex wrap；纯声明式，无坐标；
 *  · tone 五色一律走 core.ts 的 STATE_COLORS（brand/ok/warn/bad/idle），层带
 *    底色与描边用 color-mix 淡化，不自己挑颜色；
 *  · links 是「层到层」语义：按层下标引用，渲染成 fromLayer 层带**之后**的
 *    一条居中竖线 + label 小胶囊（不做跨列精确锚点——分层图的连线语义就是
 *    层到层，居中竖线简单可靠）。越界 / 自环的 link 在 parse 里直接丢弃；
 *  · note（组件说明）**恒在 DOM**，只是 CSS 收起（max-height:0 + opacity:0）：
 *    hover 单盒临时显、点击层带「钉住」展开整层（state.expanded）。两侧
 *    （snapshot 与 Body）结构因此永远一致——这是钢琴阶梯事故的教训，
 *    绝不按交互态条件渲染结构节点；
 *  · dim 盒子 = 外部 / 可选组件：半透明 + 虚线描边。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 *   React 体一律写在 arch.body.tsx 里。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { STATE_COLORS, boolOrFalse, esc, escAttr, oneOf, pickAll, str, strOr } from './core.ts'

/** 层语义色白名单（值直接映射 core.ts 的 STATE_COLORS，不自己挑颜色）。 */
export const ARCH_TONES = ['brand', 'ok', 'warn', 'bad', 'idle'] as const
export type ArchTone = (typeof ARCH_TONES)[number]

/** 层内一个组件盒子。note 为空串 = 模型没给（不渲染 note 节点，两侧同条件）。 */
export interface IuArchBox {
  readonly label: string
  readonly note: string
  readonly dim: boolean
}

/** 一个横向层带。空 boxes 的层**保留不过滤**：links 按层下标引用，
 *  过滤会让后面的层索引错位、连线指错层。 */
export interface IuArchLayer {
  readonly label: string
  readonly tone: ArchTone
  readonly boxes: readonly IuArchBox[]
}

/** 一条层间连线（按层下标引用；parse 已保证下标有效且 from ≠ to）。 */
export interface IuArchLink {
  readonly fromLayer: number
  readonly toLayer: number
  readonly label: string
}

export interface IuArchSpec extends IuSpecBase {
  readonly kind: 'arch'
  readonly title: string
  readonly desc: string
  readonly layers: readonly IuArchLayer[]
  readonly links: readonly IuArchLink[]
}

/** arch 的本地状态（持久化）：钉住展开的层下标，null = 全收起。 */
export interface ArchState extends IuState {
  readonly expanded: number | null
}

/**
 * 校验并归一「钉住展开层」（fillText 与 Body 共用，两侧永远一致）：
 * 持久化里可能是脏数据 / 越界下标，一律回 null。
 */
export function expandedOf(spec: IuArchSpec, state: ArchState): number | null {
  const v = state.expanded
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= spec.layers.length) return null
  return v
}

function parse(raw: Record<string, unknown>): IuArchSpec | undefined {
  const layers = pickAll<IuArchLayer>(raw.layers, 8, (it) => {
    const boxes = pickAll<IuArchBox>(it.boxes, 8, (b) => {
      const label = str(b.label, 20)
      if (label === '') return undefined
      return { label, note: str(b.note, 40), dim: boolOrFalse(b.dim) }
    })
    return {
      label: strOr(it.label, 12, '层'),
      tone: oneOf<ArchTone>(it.tone, ARCH_TONES, 'brand'),
      boxes,
    }
  })
  // 一层都没有、或所有层都空 = 这张图没有信息量，整条围栏回退成代码块。
  if (layers.length === 0) return undefined
  if (layers.every(l => l.boxes.length === 0)) return undefined
  // links 按层下标引用：越界 / 非整数 / 自环（from === to）一律丢弃。
  const links = pickAll<IuArchLink>(raw.links, 8, (l) => {
    const from = l.fromLayer
    const to = l.toLayer
    if (typeof from !== 'number' || typeof to !== 'number') return undefined
    if (!Number.isInteger(from) || !Number.isInteger(to)) return undefined
    if (from < 0 || from >= layers.length || to < 0 || to >= layers.length) return undefined
    if (from === to) return undefined
    return { fromLayer: from, toLayer: to, label: str(l.label, 12) }
  })
  return {
    kind: 'arch',
    title: strOr(raw.title, 40, '架构图'),
    desc: str(raw.desc, 80),
    layers,
    links,
  }
}

function initState(_spec: IuArchSpec): ArchState {
  return { expanded: null }
}

function fillText(spec: IuArchSpec, state: ArchState): string {
  const total = spec.layers.reduce((n, l) => n + l.boxes.length, 0)
  const idx = expandedOf(spec, state)
  const cur = idx !== null ? spec.layers[idx] : undefined
  const tail = cur !== undefined ? `，正看「${cur.label}」` : ''
  return `${spec.title}：${spec.layers.length} 层 ${total} 个组件${tail}`
}

/**
 * 静态快照（截图用）。DOM 结构与 arch.body.tsx **逐字对齐**：
 * desc? → .dtt-iu__arch → 每层 .dtt-iu__alayer[data-tone][data-expanded]
 * （.dtt-iu__alabel > span.dtt-iu__abar + 层名文本；.dtt-iu__aboxes >
 * .dtt-iu__abox[data-dim] > b.dtt-iu__abox-name + small.dtt-iu__abox-note?）
 * → fromLayer 命中的层后跟 .dtt-iu__alink（> span.dtt-iu__alink-label?）。
 * 按初始 state 定格：全部收起（data-expanded="0"，note 节点在 DOM 里、
 * CSS 收起）。连线本体是 ::before 伪元素，不在 DOM 里。
 * 所有模型文本走 esc / escAttr。
 */
function snapshot(spec: IuArchSpec): string {
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const parts: string[] = []
  spec.layers.forEach((layer, i) => {
    const boxes = layer.boxes.map((b) => {
      // note 恒在 DOM（非空即渲染），收起与否只由 CSS/属性决定——两侧结构一致。
      const note = b.note !== '' ? `<small class="dtt-iu__abox-note">${esc(b.note)}</small>` : ''
      return `<div class="dtt-iu__abox" data-dim="${b.dim ? '1' : '0'}">`
        + `<b class="dtt-iu__abox-name">${esc(b.label)}</b>${note}`
        + '</div>'
    }).join('')
    // 初始态全收起 → aria-expanded="false"；tabIndex 是交互专用、静态截图
    // 无 tab 序，故略（与 timeline 快照同一手法）。
    parts.push(
      `<div class="dtt-iu__alayer" data-tone="${escAttr(layer.tone)}" data-expanded="0"`
      + ` role="button" aria-expanded="false" aria-label="${escAttr(layer.label)}">`
      + `<div class="dtt-iu__alabel"><span class="dtt-iu__abar" aria-hidden="true"></span>${esc(layer.label)}</div>`
      + `<div class="dtt-iu__aboxes">${boxes}</div>`
      + '</div>',
    )
    // 连线挂在自己 fromLayer 的层带之后（层与层的空隙里）；Body 侧同一过滤同一顺序。
    for (const link of spec.links) {
      if (link.fromLayer !== i) continue
      const label = link.label !== '' ? `<span class="dtt-iu__alink-label">${esc(link.label)}</span>` : ''
      parts.push(`<div class="dtt-iu__alink" aria-hidden="true">${label}</div>`)
    }
  })
  return `${desc}<div class="dtt-iu__arch">${parts.join('')}</div>`
}

/**
 * tone → CSS 变量：五个 tone 各一条变量定义，后续规则统一引用
 * var(--iu-arch-tone)，color-mix 淡化出层带底色 / 描边 / 发光。
 */
const TONE_VAR_CSS = ARCH_TONES
  .map(tone => `.dtt-iu__alayer[data-tone="${tone}"] { --iu-arch-tone: ${STATE_COLORS[tone]}; }`)
  .join('\n')

const CSS = [
  '/* arch：分层架构图。层带纵向堆叠，左侧层名标签（tone 色条 + 语义色文字），',
  '   右侧盒子 flex wrap。links 是「层到层」语义：fromLayer 层带之后画一条居中',
  '   竖线 + label 胶囊（::before 伪元素，零额外结构节点）。纪律（同 timeline',
  '   那条）：层与盒子的可见性永远不依赖动画——note 是恒在 DOM 的节点，靠',
  '   max-height/opacity 收起，reduced-motion 把过渡停掉后 hover/钉住展开仍然',
  '   直接呈现最终状态；连线流动动画只是增强。主题深浅全部走 --dsw-alias-*',
  '   变量（带兜底），自动跟随宿主。 */',
  TONE_VAR_CSS,
  '.dtt-iu__arch { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 2px; }',
  '/* 层带：横向 flex（层名 + 盒子区），整带可点（钉住展开 note） */',
  '.dtt-iu__alayer { display: flex; align-items: stretch; gap: 8px; padding: 7px 9px;',
  '  border-radius: 10px; border: 1px solid color-mix(in srgb, var(--iu-arch-tone) 18%, transparent);',
  '  background: color-mix(in srgb, var(--iu-arch-tone) 5%, transparent);',
  '  cursor: pointer; user-select: none;',
  '  transition: background-color .18s ease, border-color .18s ease; }',
  '.dtt-iu__alayer:hover { background: color-mix(in srgb, var(--iu-arch-tone) 9%, transparent);',
  '  border-color: color-mix(in srgb, var(--iu-arch-tone) 30%, transparent); }',
  '.dtt-iu__alayer:focus-visible { outline: 2px solid var(--iu-arch-tone); outline-offset: 1px; }',
  '.dtt-iu__alayer[data-expanded="1"] { background: color-mix(in srgb, var(--iu-arch-tone) 10%, transparent);',
  '  border-color: color-mix(in srgb, var(--iu-arch-tone) 45%, transparent); }',
  '/* 层名标签：固定宽、竖色条 + 语义色文字，超长省略号 */',
  '.dtt-iu__alabel { position: relative; flex: none; align-self: center; box-sizing: border-box;',
  '  width: calc(88px * var(--iu-text-scale, 1)); padding-left: 10px;',
  '  font-size: calc(12px * var(--iu-text-scale, 1)); font-weight: 700; line-height: 1.4;',
  '  color: var(--iu-arch-tone); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.dtt-iu__abar { position: absolute; left: 0; top: 1px; bottom: 1px; width: 4px; border-radius: 2px;',
  '  background: var(--iu-arch-tone);',
  '  box-shadow: 0 0 6px color-mix(in srgb, var(--iu-arch-tone) 35%, transparent);',
  '  transition: box-shadow .22s ease; }',
  '.dtt-iu__alayer[data-expanded="1"] .dtt-iu__abar {',
  '  box-shadow: 0 0 10px color-mix(in srgb, var(--iu-arch-tone) 60%, transparent); }',
  '/* 盒子区：flex wrap */',
  '.dtt-iu__aboxes { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px;',
  '  align-items: flex-start; align-content: flex-start; }',
  '/* 组件盒子：hover 抬起 + 描边亮起；note 恒在 DOM，收起态 max-height:0 */',
  '.dtt-iu__abox { min-width: 0; max-width: 100%; border-radius: 8px; padding: 5px 9px;',
  '  border: 1px solid transparent; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));',
  '  box-shadow: 0 1px 2px rgba(0,0,0,.06); cursor: default;',
  '  transition: transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease,',
  '    border-color .18s ease, background-color .18s ease, opacity .18s ease; }',
  '.dtt-iu__abox:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,.14);',
  '  border-color: color-mix(in srgb, var(--iu-arch-tone) 35%, transparent); }',
  '/* dim：外部 / 可选组件，半透明 + 虚线描边 */',
  '.dtt-iu__abox[data-dim="1"] { opacity: .55; background: transparent; box-shadow: none;',
  '  border: 1px dashed var(--dsw-alias-label-tertiary, rgba(127,127,127,.5)); }',
  '.dtt-iu__abox-name { display: block; font-size: calc(12px * var(--iu-text-scale, 1));',
  '  font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }',
  '/* note：收起只是 CSS 态（节点恒在），hover 单盒或钉住整层都展开 */',
  '.dtt-iu__abox-note { display: block; max-height: 0; opacity: 0; overflow: hidden; margin-top: 0;',
  '  font-size: calc(11px * var(--iu-text-scale, 1)); line-height: 1.5;',
  '  transition: max-height .28s cubic-bezier(.2,.8,.25,1), opacity .22s ease, margin-top .28s ease; }',
  '.dtt-iu__abox:hover .dtt-iu__abox-note,',
  '.dtt-iu__alayer[data-expanded="1"] .dtt-iu__abox-note {',
  '  max-height: calc(120px * var(--iu-text-scale, 1)); opacity: .72; margin-top: 3px; }',
  '/* 层间连线：居中竖线（::before 伪元素）+ label 胶囊；虚线缓慢下移 = 数据流向 */',
  '.dtt-iu__alink { position: relative; flex: none; height: 18px; overflow: hidden;',
  '  display: flex; align-items: center; justify-content: center; }',
  '.dtt-iu__alink::before { content: ""; position: absolute; left: 50%; top: -8px; bottom: -8px;',
  '  margin-left: -1px; border-left: 2px dashed var(--dsw-alias-label-tertiary, rgba(127,127,127,.5));',
  '  opacity: .65; animation: dtt-iu-arch-flow 1.6s linear infinite; }',
  '@keyframes dtt-iu-arch-flow { from { transform: translateY(0); } to { transform: translateY(8px); } }',
  '.dtt-iu__alink-label { position: relative; z-index: 1; padding: 1px 8px; border-radius: 999px;',
  '  font-size: calc(10px * var(--iu-text-scale, 1)); line-height: 1.5; white-space: nowrap;',
  '  opacity: .85; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.16)); }',
  '/* 窄屏：层名改横排，放在盒子行上方 */',
  '@media (max-width: 560px) {',
  '  .dtt-iu__alayer { flex-direction: column; align-items: stretch; gap: 6px; }',
  '  .dtt-iu__alabel { width: auto; max-width: 100%; align-self: flex-start; }',
  '}',
  '/* 无障碍：停掉全部过渡与流动动画。note 的展开/收起是状态切换不是可见性',
  '   依赖——transition:none 后 hover / 钉住展开直接以最终 max-height 呈现。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__alayer, .dtt-iu__abar, .dtt-iu__abox, .dtt-iu__abox-note { transition: none; }',
  '  .dtt-iu__alink::before { animation: none; }',
  '  .dtt-iu__abox:hover { transform: none; }',
  '}',
].join('\n')

export const archKind: IuKind<ArchState, IuArchSpec> = {
  kind: 'arch',
  label: '架构图',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · arch 架构图：{"kind":"arch","title":"电商系统架构","desc":"三层 Web 架构","layers":[{"label":"接入层","boxes":[{"label":"CDN","note":"静态资源加速"},{"label":"Nginx 网关","note":"负载均衡 + TLS 终结"}]},{"label":"服务层","tone":"ok","boxes":[{"label":"用户服务"},{"label":"订单服务"},{"label":"第三方支付","dim":true,"note":"外部依赖，走回调"}]},{"label":"数据层","tone":"warn","boxes":[{"label":"MySQL","note":"主从复制"},{"label":"Redis 缓存"}]}],"links":[{"fromLayer":0,"toLayer":1,"label":"HTTP/RPC"},{"fromLayer":1,"toLayer":2,"label":"读写"}]}（约束：layers≤8、每层 boxes≤8、tone 五选一 brand|ok|warn|bad|idle 默认 brand、links≤8 按层下标引用且越界丢弃；层名≤12、组件名≤20、note≤40 可省、dim=true 灰显外部/可选组件；hover 盒子临时显说明，点层带钉住展开整层，状态会记住）。',
}
