/**
 * iu kind: **sequence**（UML 时序图：参与者竖线 + 按时间自上而下的消息箭头）。
 *
 * 结构照抄范本 slider.ts / gauge.ts：纯逻辑半边（零 React、零 DOM，host 截图
 * 管线可 import），React 体在同名 sequence.body.tsx 里。
 *
 * 设计要点：
 *  · 实线 + 实心箭头 = 调用/请求；虚线 + 空心箭头 = 返回/响应（ret:true）；
 *    self 消息（from === to）画右侧小回环（右出 40 → 下 16 → 回线，箭头朝左）；
 *  · 全部坐标由 layoutSequence() 算出并导出——Body 与 snapshot **共用同一份**，
 *    绝不允许两边各算各的（gauge.ts 的同一条纪律）；
 *  · 分步播放：state.step（0=全部显示；>0=只显示前 step 条）。step 裁剪走
 *    data-hidden="1" + CSS opacity，**元素恒在 DOM**——Body 在任何 step 下与
 *    snapshot 的结构都逐字一致（钢琴阶梯事故的教训：绝不按交互态条件渲染结构节点）；
 *  · 每条实线消息给 to 列画激活条（短竖 rect，到下一条指向它的消息或 +30）；
 *  · 消息 >6 条时在底部重复一排头盒，方便对照生命线归属。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 *   React 体一律写在 sequence.body.tsx 里。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { boolOrFalse, esc, escAttr, int, oneOf, pickAll, str, strOr } from './core.ts'

/** 参与者头盒配色白名单（映射 core.ts 的 STATE_COLORS，不自己挑颜色）。 */
export const SEQ_TONES = ['brand', 'ok', 'warn', 'idle'] as const
export type SeqTone = (typeof SEQ_TONES)[number]

/** 一个参与者（id 已去重，messages 按它引用）。 */
export interface IuSeqActor {
  readonly id: string
  readonly label: string
  readonly tone: SeqTone
}

/** 一条消息（from/to 已保证是存在的 actor id；from === to 一律归一为 self）。 */
export interface IuSeqMsg {
  readonly from: string
  readonly to: string
  readonly text: string
  /** true = 虚线 + 空心箭头（返回/响应）。 */
  readonly ret: boolean
  /** true = 自环消息（右侧小回环）。 */
  readonly self: boolean
}

export interface IuSequenceSpec extends IuSpecBase {
  readonly kind: 'sequence'
  readonly title: string
  readonly desc: string
  readonly actors: readonly IuSeqActor[]
  readonly messages: readonly IuSeqMsg[]
}

/** sequence 的本地状态（持久化）：分步播放进度。0 = 全部显示；k>0 = 只显示前 k 条。 */
export interface SequenceState extends IuState {
  readonly step: number
}

/**
 * 校验并归一 step（fillText / snapshot / Body 共用，两侧永远一致）：
 * 持久化里可能是脏数据 / 越界，一律钳进 [0, messages.length]。
 */
export function stepOf(spec: IuSequenceSpec, state: SequenceState): number {
  return int(state.step, 0, spec.messages.length, 0)
}

/* ------------------------------------------------------------------ */
/* 几何（纯函数；Body 与 snapshot 共用，禁止在别处重算）                  */
/* ------------------------------------------------------------------ */

/** 头盒：高 / 文本基线 / 底部 y。 */
const HEAD_H = 26
const HEAD_TEXT_Y = 18
const HEAD_BOTTOM = 26
/** 首条消息线的 y（标签基线 55 落在头盒之下、线之上）。 */
const FIRST_MSG_Y = 62
/** 普通消息行距 / self 消息行距（回环 16 + 标签两行余量）。 */
const ROW_GAP = 44
const SELF_GAP = 56
/** self 回环：右出宽度 / 下探深度。 */
const SELF_W = 40
const SELF_DROP = 16
/** 列间距下限；头盒宽（label ≤6 字 90，否则 120）。 */
const MIN_PITCH = 140
const HEAD_W_SHORT = 90
const HEAD_W_LONG = 120
/** 消息标签字号 / 每字符宽估算（CJK 全宽、其余 0.58em）。 */
const LABEL_FS = 11
/** 消息线左右内缩（箭头 marker 尖端对齐线端，不与生命线/激活条糊在一起）。 */
const ARROW_INSET = 5
/** 激活条半宽与默认高度。 */
const ACT_HALF = 4
const ACT_H = 30
/** 底部重复头盒触发阈值 / 内容底边距 / 底盒占高。 */
const FOOT_MIN_MSGS = 7
const BOTTOM_MARGIN = 16
const FOOT_H = 26

/** 两位小数（序列化进 SVG 属性，避免超长浮点尾巴；同 gauge.ts 的 r2）。 */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 文本宽度估算：CJK（含全角标点）按全宽，其余按 0.58em。 */
function estTextWidth(text: string, fontSize: number): number {
  let units = 0
  for (const ch of text) {
    units += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 1 : 0.58
  }
  return units * fontSize
}

/** 头盒宽：label ≤6 字 90，否则 120（列 x 等距分布的列宽来源）。 */
export function seqHeadW(label: string): number {
  return label.length <= 6 ? HEAD_W_SHORT : HEAD_W_LONG
}

/** 布局后的一个参与者列。 */
export interface SeqActorLayout {
  readonly id: string
  /** 列中心 x（生命线 / 消息线端点 / 头盒中心全用它）。 */
  readonly x: number
  readonly label: string
  readonly tone: SeqTone
  readonly headW: number
}

/** 布局后的一条消息（Body 与 snapshot 逐字段消费同一份）。 */
export interface SeqMsgLayout {
  readonly index: number
  readonly from: string
  readonly to: string
  readonly text: string
  readonly ret: boolean
  readonly self: boolean
  /** from 列 x（self 时同 x）。 */
  readonly x1: number
  /** to 列 x（self 时 = x1）。 */
  readonly x2: number
  readonly y: number
  /** 箭头路径（直线或三段折线；已内缩，marker 尖端落在线端）。 */
  readonly path: string
  /** 标签锚点：非 self = 线上方居中；self = 回环右上外侧（start 对齐）。 */
  readonly labelX: number
  readonly labelY: number
  /** 标签底色小块（防压线；text === '' 时为 undefined，两侧同条件不渲染）。 */
  readonly labelW: number | undefined
  readonly labelH: number | undefined
  /** 激活条（仅非 self 的实线消息给 to 列画；ret 不画）。 */
  readonly actX: number | undefined
  readonly actY: number | undefined
  readonly actH: number | undefined
}

/** 整图布局结果。 */
export interface SeqLayout {
  readonly vbW: number
  readonly vbH: number
  /** viewBox 字符串（Body 的 <svg> 与 snapshot 共用）。 */
  readonly viewBox: string
  readonly actors: readonly SeqActorLayout[]
  readonly msgs: readonly SeqMsgLayout[]
  /** 生命线（顶 y = 头盒底，底 y = 底盒顶或内容底）。 */
  readonly lifeY1: number
  readonly lifeY2: number
  /** 是否画底部重复头盒（消息 >6 条）。 */
  readonly foot: boolean
  /** 底盒顶 y（foot=false 时无意义）。 */
  readonly footY: number
  /** 头盒 rect 的 y / 高 / 文本基线（顶底两排共用）。 */
  readonly headY: number
  readonly headH: number
  readonly headTextY: number
}

/**
 * 唯一的几何入口：Body 与 snapshot 都从这里拿坐标 / 路径 / 标签位。
 *
 * 列 x：等距分布，x(i) = margin + pitch/2 + i*pitch；
 *   pitch = max(140, 最长**非 self** 标签半宽 + 24)——标签居中画在两列之间，
 *   半宽不越列即不压相邻生命线；
 *   边距 margin = max(56, 最大头盒半宽 + 12)——首末列头盒不出画布；
 *   self 标签画在回环右侧（start 对齐），末列 self 的溢出单独抬 vbW。
 * 消息 y：从 62 起，普通 +44、self +56（回环两行）。
 * self 回环：M x,y H x+40 V y+16 H x+6（marker orient=auto，末段向左 → 箭头朝左回）。
 * 激活条：非 ret、非 self 的消息给 to 列画 rect（x±4，y → 下一条指向它的消息或 +30）。
 */
export function layoutSequence(spec: IuSequenceSpec): SeqLayout {
  const actors = spec.actors
  const msgs = spec.messages
  const n = actors.length

  const headWs = actors.map(a => seqHeadW(a.label))
  const maxHeadW = headWs.reduce((m, w) => Math.max(m, w), HEAD_W_SHORT)
  const margin = Math.max(56, maxHeadW / 2 + 12)

  let pitch = MIN_PITCH
  for (const m of msgs) {
    if (m.self || m.text === '') continue
    const half = estTextWidth(m.text, LABEL_FS) / 2
    if (half + 24 > pitch) pitch = half + 24
  }
  pitch = Math.ceil(pitch)

  const xs = actors.map((_, i) => r2(margin + pitch / 2 + i * pitch))

  // 逐条消息：y 递增；激活条终点 = 下一条指向同列的消息 y（否则 +30）。
  const laid: SeqMsgLayout[] = []
  let y = FIRST_MSG_Y
  let selfRight = 0
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i]
    const fi = actors.findIndex(a => a.id === m.from)
    const ti = actors.findIndex(a => a.id === m.to)
    // parse 已保证 from/to 存在；?? 0 是防御（layoutSequence 是导出函数，
    // 不让任何调用方拿到 NaN 坐标）。
    const x1 = xs[fi] ?? 0
    const x2 = xs[ti] ?? 0
    let path: string
    let labelX: number
    let labelY: number
    let labelW: number | undefined
    if (m.self) {
      path = `M ${x1} ${y} H ${x1 + SELF_W} V ${y + SELF_DROP} H ${x1 + 6}`
      labelX = x1 + SELF_W + 8
      labelY = y - 5
      if (m.text !== '') {
        labelW = Math.ceil(estTextWidth(m.text, LABEL_FS)) + 12
        // self 标签 start 对齐（画在回环右侧），底块从 labelX-6 起向右铺。
        selfRight = Math.max(selfRight, labelX + labelW)
      }
    } else {
      // 内缩：左端离开 from 生命线/激活条，右端让箭头尖端正好触到 to 列。
      const sx = x1 < x2 ? x1 + ARROW_INSET : x1 - ARROW_INSET
      const ex = x1 < x2 ? x2 - ARROW_INSET : x2 + ARROW_INSET
      path = `M ${sx} ${y} H ${ex}`
      labelX = (x1 + x2) / 2
      labelY = y - 7
      if (m.text !== '') labelW = Math.ceil(estTextWidth(m.text, LABEL_FS)) + 12
    }
    laid.push({
      index: i,
      from: m.from, to: m.to, text: m.text, ret: m.ret, self: m.self,
      x1, x2, y,
      path,
      labelX: r2(labelX), labelY,
      labelW, labelH: m.text === '' ? undefined : 16,
      actX: undefined, actY: undefined, actH: undefined,
    })
    y += m.self ? SELF_GAP : ROW_GAP
  }
  // 激活条：向后找下一条 to 相同的消息（普通 = 线 y；self = 回环底 y+16），否则 +30。
  for (let i = 0; i < laid.length; i += 1) {
    const cur = laid[i]
    if (cur.ret || cur.self) continue
    let end = cur.y + ACT_H
    for (let j = i + 1; j < laid.length; j += 1) {
      const nx = laid[j]
      if (nx.to !== cur.to) continue
      end = nx.self ? nx.y + SELF_DROP : nx.y
      break
    }
    const h = Math.max(8, end - cur.y)
    laid[i] = { ...cur, actX: cur.x2 - ACT_HALF, actY: cur.y, actH: r2(h) }
  }

  // 内容底 = 所有消息探出的最大下缘（self 回环底 y+16 / 激活条底 y+actH）+ 边距，
  // 保证 vbH 罩住每个元素（激活条默认 30 > 行距余量，单靠 lastY+margin 会被裁）。
  let bottom = FIRST_MSG_Y
  for (const m of laid) {
    const drop = m.actH !== undefined ? m.actH : m.self ? SELF_DROP : 0
    if (m.y + drop > bottom) bottom = m.y + drop
  }
  const contentBottom = bottom + BOTTOM_MARGIN
  const foot = msgs.length >= FOOT_MIN_MSGS
  const footY = foot ? contentBottom + 8 : contentBottom
  const lifeY2 = foot ? footY : contentBottom
  const vbW = Math.ceil(Math.max(n * pitch + 2 * margin, selfRight + 16))
  const vbH = Math.ceil(foot ? footY + FOOT_H + 8 : contentBottom + 8)

  return {
    vbW, vbH,
    viewBox: `0 0 ${vbW} ${vbH}`,
    actors: actors.map((a, i) => ({ id: a.id, x: xs[i], label: a.label, tone: a.tone, headW: headWs[i] })),
    msgs: laid,
    lifeY1: HEAD_BOTTOM,
    lifeY2: r2(lifeY2),
    foot,
    footY: r2(footY),
    headY: 0,
    headH: HEAD_H,
    headTextY: HEAD_TEXT_Y,
  }
}

/* ------------------------------------------------------------------ */
/* 工具条视图模型（Body 与 snapshot 共用；手法同 diffToolbar）            */
/* ------------------------------------------------------------------ */

/** 工具条 pill 的动作 id（Body 据此打补丁）。 */
export type SeqToolId = 'prev' | 'next' | 'all'

/** 工具条上的一个 pill。 */
export interface SeqPill {
  readonly id: SeqToolId
  readonly label: string
  readonly active: boolean
}

/** 工具条三颗 pill：上一条 / 下一条 / 全部（step=0 时「全部」高亮）。 */
export function seqToolbar(step: number): readonly SeqPill[] {
  return [
    { id: 'prev', label: '◀', active: false },
    { id: 'next', label: '▶', active: false },
    { id: 'all', label: '全部', active: step === 0 },
  ]
}

/** 工具条计数文案：step=0 → 「共 N 条」；k>0 → 「第 k/N 步」。 */
export function seqCountText(step: number, total: number): string {
  return step === 0 ? `共 ${total} 条` : `第 ${step}/${total} 步`
}

/* ------------------------------------------------------------------ */
/* kind 契约实现                                                        */
/* ------------------------------------------------------------------ */

function parse(raw: Record<string, unknown>): IuSequenceSpec | undefined {
  // actors：id ≤16 唯一（重复加后缀 2/3/…；后缀也撞了就丢弃该项），label 缺省「参与者N」。
  const actors: IuSeqActor[] = []
  const used = new Set<string>()
  for (const item of Array.isArray(raw.actors) ? raw.actors : []) {
    if (actors.length >= 8) break
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const label = strOr(o.label, 12, `参与者${actors.length + 1}`)
    let id = str(o.id, 16)
    if (id === '') id = `a${actors.length + 1}`
    if (used.has(id)) {
      let k = 2
      while (used.has(`${id}${k}`) && k < 50) k += 1
      if (used.has(`${id}${k}`)) continue
      id = `${id}${k}`
    }
    used.add(id)
    actors.push({ id, label, tone: oneOf<SeqTone>(o.tone, SEQ_TONES, 'brand') })
  }
  // messages：from/to 必须是已声明 actor id（引用不存在 → 该条丢弃）；
  //   from === to 一律归一为 self（spec 的 self 字段仅作显式声明用）。
  const messages = pickAll<IuSeqMsg>(raw.messages, 24, (m) => {
    const from = str(m.from, 16)
    const to = str(m.to, 16)
    if (!used.has(from) || !used.has(to)) return undefined
    return {
      from, to,
      text: str(m.text, 40),
      ret: boolOrFalse(m.ret),
      self: from === to || boolOrFalse(m.self),
    }
  })
  // 全部消息被丢弃（或压根没给）→ 画不出时序，整条围栏回退成代码块。
  if (messages.length === 0) return undefined
  // actors < 2 且 messages 无 self → 只有一根竖线也没有回环，同样画不出。
  if (actors.length < 2 && !messages.some(m => m.self)) return undefined
  return {
    kind: 'sequence',
    title: strOr(raw.title, 40, '时序图'),
    desc: str(raw.desc, 80),
    actors,
    messages,
  }
}

function initState(_spec: IuSequenceSpec): SequenceState {
  return { step: 0 }
}

/** 回填文本必须含真实数值：参与者/消息计数；step>0 追加当前步。 */
function fillText(spec: IuSequenceSpec, state: SequenceState): string {
  const step = stepOf(spec, state)
  const tail = step > 0 ? `，当前第 ${step} 步` : ''
  return `${spec.title}：${spec.actors.length} 个参与者、${spec.messages.length} 条消息${tail}`
}

/** 单条消息的静态 SVG（与 Body 的 msgGroup 逐字对齐；快照定格 = 内联 animation:none，同 gauge）。 */
function msgHtml(m: SeqMsgLayout, index: number): string {
  const act = m.actX !== undefined && m.actY !== undefined && m.actH !== undefined
    ? `<rect class="dtt-iu__seq-act" x="${m.actX}" y="${m.actY}" width="${ACT_HALF * 2}" height="${m.actH}" rx="2"/>`
    : ''
  const dash = m.ret ? ' stroke-dasharray="5 4"' : ''
  // 箭头必须真的挂上去：实线消息用实心 marker（dsh-seq-a），返回消息用空心
  // （dsh-seq-o）。defs 里定义了 marker 却没人引用的话箭头就画不出来，SVG 还不报错。
  const marker = m.ret ? 'dsh-seq-o' : 'dsh-seq-a'
  // 底块 x：非 self 居中（labelX − w/2）；self 是 start 对齐，底块从 labelX−6 起。
  const bgX = m.self ? m.labelX - 6 : m.labelX - (m.labelW ?? 0) / 2
  const label = m.text !== '' && m.labelW !== undefined
    ? `<g class="dtt-iu__seq-label"><rect class="dtt-iu__seq-lbg" x="${r2(bgX)}" y="${m.labelY - 11}" width="${m.labelW}" height="${m.labelH}"/>`
      + `<text class="dtt-iu__seq-ltext" x="${m.labelX}" y="${m.labelY}">${esc(m.text)}</text></g>`
    : ''
  // data-act：两端 actor id（空格分隔），供 Body 的 hover 联动查询两端头盒。
  // 入场错峰动画的 --i 变量恒写（Body 同款）；animation:none 只在快照定格用。
  return `<g class="dtt-iu__seq-msg" data-ret="${m.ret ? '1' : '0'}" data-self="${m.self ? '1' : '0'}"`
    + ` data-act="${escAttr(m.from)} ${escAttr(m.to)}" style="--i:${index};animation:none">`
    + act
    + `<path class="dtt-iu__seq-arrow" d="${escAttr(m.path)}"${dash} marker-end="url(#${marker})"/>`
    + label
    + `</g>`
}

/**
 * 静态快照（截图用）：按初始 state（step=0，全部显示）定格。
 *
 * DOM 结构与 sequence.body.tsx **逐字对齐**：
 * desc? → .dtt-iu__seq-tools（3 pill + count）→ .dtt-iu__seq-wrap >
 * svg.dtt-iu__seq > defs(markers) + g 生命线 + g 头盒(顶) + g 消息 + g 头盒(底)?。
 * step=0 → data-hidden 不出现；消息组的入场动画内联 animation:none 定格（同 gauge）。
 * 所有模型文本走 esc / escAttr。
 */
function snapshot(spec: IuSequenceSpec): string {
  const L = layoutSequence(spec)
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const total = spec.messages.length
  const pills = seqToolbar(0)
    .map(p => `<button type="button" class="dtt-iu__seq-pill"${p.active ? ' data-active="1"' : ''}>${esc(p.label)}</button>`)
    .join('')
  const tools = `<div class="dtt-iu__seq-tools">${pills}`
    + `<span class="dtt-iu__seq-count">${esc(seqCountText(0, total))}</span></div>`

  const lives = L.actors
    .map(a => `<line class="dtt-iu__seq-life" x1="${a.x}" y1="${L.lifeY1}" x2="${a.x}" y2="${L.lifeY2}"/>`)
    .join('')
  const headTop = L.actors
    .map(a => `<g class="dtt-iu__seq-head" data-tone="${escAttr(a.tone)}" data-id="${escAttr(a.id)}">`
      + `<rect x="${r2(a.x - a.headW / 2)}" y="0" width="${a.headW}" height="${HEAD_H}" rx="7"/>`
      + `<text x="${a.x}" y="${HEAD_TEXT_Y}">${esc(a.label)}</text></g>`)
    .join('')
  const headFoot = L.foot
    ? `<g class="dtt-iu__seq-heads--foot">${L.actors
      .map(a => `<g class="dtt-iu__seq-head dtt-iu__seq-head--foot" data-tone="${escAttr(a.tone)}" data-id="${escAttr(a.id)}">`
        + `<rect x="${r2(a.x - a.headW / 2)}" y="${L.footY}" width="${a.headW}" height="${HEAD_H}" rx="7"/>`
        + `<text x="${a.x}" y="${r2(L.footY + HEAD_TEXT_Y)}">${esc(a.label)}</text></g>`)
      .join('')}</g>`
    : ''
  const msgs = L.msgs.map((m, i) => msgHtml(m, i)).join('')

  return `${desc}${tools}<div class="dtt-iu__seq-wrap">`
    + `<svg class="dtt-iu__seq" viewBox="${L.viewBox}" role="img" aria-label="${escAttr(spec.title)}">`
    + `<defs>`
    + `<marker id="dsh-seq-a" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">`
    + `<polygon points="0 0.6, 8 4, 0 7.4" fill="#4f5d75"/></marker>`
    + `<marker id="dsh-seq-o" markerWidth="10" markerHeight="9" refX="9" refY="4.5" orient="auto">`
    + `<polygon points="0 1, 9 4.5, 0 8" fill="#ffffff" stroke="#4f5d75" stroke-width="1.2"/></marker>`
    + `</defs>`
    + `<g class="dtt-iu__seq-lives">${lives}</g>`
    + `<g class="dtt-iu__seq-heads">${headTop}</g>`
    + `<g class="dtt-iu__seq-msgs">${msgs}</g>`
    + headFoot
    + `</svg></div>`
}

const INK2 = 'var(--dsw-alias-label-secondary, #4f5d75)'
const PAPER = 'var(--dsw-alias-bg-layer-1, #ffffff)'
const BORDER = 'var(--dsw-alias-border-l3, rgba(127,127,127,.18))'
const BRAND = 'var(--dsw-alias-state-business-primary, #4176e6)'

/**
 * tone → CSS 变量（同 arch.ts 的 TONE_VAR_CSS 手法）：头盒描边 / 文字 / 底色
 * 统一引用 var(--iu-seq-tone)，color-mix 淡化，不自己挑颜色。
 */
const TONE_VAR_CSS = SEQ_TONES
  .map(tone => `.dtt-iu__seq-head[data-tone="${tone}"] { --iu-seq-tone: ${
    tone === 'brand' ? BRAND
    : tone === 'ok' ? 'var(--dsw-alias-state-success-primary, #27ae60)'
    : tone === 'warn' ? 'var(--dsw-alias-state-warning-primary, #e67e22)'
    : 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.6))'
  }; }`)
  .join('\n')

const CSS = [
  '/* sequence：UML 时序图。工具条（pill 分步播放）+ 横向滚动 SVG 画布。',
  '   纪律（同 gauge/arch）：几何真相全在属性上（layoutSequence 导出，Body 与',
  '   snapshot 共用）；step 裁剪走 data-hidden + opacity，元素恒在 DOM——任何',
  '   step 下结构与快照一致；入场动画 keyframes 起点 opacity .55（可见性不',
  '   依赖动画），快照内联 animation:none 定格。hover：消息自身高亮纯 CSS；',
  '   两端头盒联动由 Body 加/去 .dtt-iu__seq-head--lit（CSS 属性值不可参数化）。 */',
  TONE_VAR_CSS,
  /* 工具条：pill 手法与 diff 一致 */
  '.dtt-iu__seq-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 6px 0 8px; }',
  '.dtt-iu__seq-pill { border: 1px solid ' + BORDER + '; background: transparent; color: inherit;',
  '  font: inherit; font-size: calc(11.5px * var(--iu-text-scale, 1)); border-radius: 999px;',
  '  padding: 2px 11px; cursor: pointer; opacity: .58; line-height: 1.7; white-space: nowrap;',
  '  transition: opacity .18s ease, background-color .18s ease, transform .18s ease, border-color .18s ease, color .18s ease; }',
  '.dtt-iu__seq-pill:hover { opacity: 1; transform: translateY(-1px); }',
  '.dtt-iu__seq-pill:active { transform: translateY(0) scale(.95); }',
  '.dtt-iu__seq-pill[data-active] { opacity: 1; font-weight: 600; color: ' + BRAND + ';',
  '  border-color: color-mix(in srgb, ' + BRAND + ' 55%, transparent);',
  '  background: color-mix(in srgb, ' + BRAND + ' 12%, transparent); }',
  '.dtt-iu__seq-count { margin-left: auto; font-size: calc(11px * var(--iu-text-scale, 1));',
  '  font-variant-numeric: tabular-nums; opacity: .6; white-space: nowrap; padding-left: 6px; }',
  /* 画布：时序图常宽，wrap 横向滚动 */
  '.dtt-iu__seq-wrap { overflow-x: auto; overflow-y: hidden; margin: 2px 0 4px;',
  '  border: 1px solid ' + BORDER + '; border-radius: 10px; padding: 8px 10px;',
  '  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.03)); }',
  '.dtt-iu__seq { display: block; width: 100%; min-width: 420px; height: auto; }',
  /* 生命线：竖直虚线 */
  '.dtt-iu__seq-life { stroke: ' + INK2 + '; stroke-width: 1; stroke-dasharray: 4 4; opacity: .32; }',
  /* 头盒：tone 四色（描边/文字语义色，底色 color-mix 淡化） */
  '.dtt-iu__seq-head rect { fill: ' + PAPER + '; stroke: var(--iu-seq-tone); stroke-width: 1.4; rx: 7;',
  '  transition: filter .2s ease, stroke-width .2s ease; }',
  '.dtt-iu__seq-head text { fill: var(--iu-seq-tone); font-weight: 600; text-anchor: middle;',
  '  font-size: calc(12px * var(--iu-text-scale, 1)); }',
  '.dtt-iu__seq-head--foot rect { opacity: .85; }',
  /* 消息组：step 播放的淡入靠 opacity transition；入场错峰动画（--i）只对
     未隐藏的消息挂——若对 data-hidden="1" 的元素也跑动画，animation 的合成
     优先级高于普通声明，隐藏消息会在入场窗口内以 opacity .55→1 闪现。
     隐藏时 animation:none；解除隐藏的刹那动画重新启动 = 新消息淡入滑下。 */
  '.dtt-iu__seq-msg { transition: opacity .28s ease; }',
  '.dtt-iu__seq-msg:not([data-hidden="1"]) { animation: dtt-iu-seq-in .45s ease backwards;',
  '  animation-delay: calc(var(--i, 0) * 55ms); }',
  '@keyframes dtt-iu-seq-in { from { opacity: .55; transform: translateY(-4px); } }',
  '.dtt-iu__seq-msg[data-hidden="1"] { opacity: 0; pointer-events: none; animation: none; }',
  /* 消息线：实线=调用（实心箭头 marker），虚线=返回（空心箭头 marker）。
     ⚠ marker 里的 polygon 用的是字面 #4f5d75（marker 内部不继承元素 stroke，
     context-stroke 兼容面太窄）；与 INK2 的兜底色同源，深色主题下箭头略暗
     但可见——截图与对话流一致优先。 */
  '.dtt-iu__seq-arrow { fill: none; stroke: ' + INK2 + '; stroke-width: 1.4; stroke-linecap: round;',
  '  transition: stroke .18s ease, stroke-width .18s ease; }',
  '.dtt-iu__seq-msg[data-ret="1"] .dtt-iu__seq-arrow { opacity: .88; }',
  /* 标签：底色小块防压线 + 文本（SVG text 字号同样乘 --iu-text-scale） */
  '.dtt-iu__seq-lbg { fill: ' + PAPER + '; stroke: ' + BORDER + '; stroke-width: .8; rx: 4;',
  '  transition: fill .18s ease, stroke .18s ease; }',
  '.dtt-iu__seq-ltext { fill: ' + INK2 + '; text-anchor: middle;',
  '  font-size: calc(11px * var(--iu-text-scale, 1)); transition: fill .18s ease; }',
  '.dtt-iu__seq-msg[data-self="1"] .dtt-iu__seq-ltext { text-anchor: start; }',
  /* 激活条 */
  '.dtt-iu__seq-act { fill: ' + INK2 + '; fill-opacity: .16; stroke: ' + INK2 + '; stroke-opacity: .5; stroke-width: 1; }',
  /* hover：消息自身（线 / 标签 / 底块）高亮，纯 CSS */
  '.dtt-iu__seq-msg:hover .dtt-iu__seq-arrow { stroke: ' + BRAND + '; stroke-width: 2; }',
  '.dtt-iu__seq-msg:hover .dtt-iu__seq-ltext { fill: ' + BRAND + '; }',
  '.dtt-iu__seq-msg:hover .dtt-iu__seq-lbg { fill: color-mix(in srgb, ' + BRAND + ' 10%, ' + PAPER + ');',
  '  stroke: color-mix(in srgb, ' + BRAND + ' 40%, transparent); }',
  /* 两端头盒的 hover 联动不能用纯 CSS：选择器无法「按被 hover 消息的 data-act
     值去匹配同值 data-id 的头盒」（属性值不可参数化，:has 里的字面量 id 是死
     规则）。由 Body 在消息 onMouseEnter/Leave 时给两端头盒加/去 --lit（瞬态
     视觉 class，不持久化、不进 state；snapshot 无 hover，恒不带 --lit）。 */
  '.dtt-iu__seq-head--lit rect { stroke-width: 2.4; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--iu-seq-tone) 45%, transparent)); }',
  /* 深色主题：标签底色改用宿主 layer-2，避免亮色底块刺眼 */
  'body[data-ds-dark-theme] .dtt-iu__seq-lbg { fill: var(--dsw-alias-bg-layer-2, rgba(30,32,38,.92)); }',
  'body[data-ds-dark-theme] .dtt-iu__seq-head rect { fill: var(--dsw-alias-bg-layer-2, rgba(30,32,38,.92)); }',
  /* 无障碍：停掉过渡与入场动画——data-hidden 的显隐是状态切换（opacity 终值',
  '   立即生效），可见性从不依赖动画；hover 高亮是颜色变化，同样不依赖。 */
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__seq-msg { animation: none; transition: none; }',
  '  .dtt-iu__seq-pill { transition: none; }',
  '  .dtt-iu__seq-pill:hover, .dtt-iu__seq-pill:active { transform: none; }',
  '  .dtt-iu__seq-arrow, .dtt-iu__seq-lbg, .dtt-iu__seq-ltext, .dtt-iu__seq-head rect { transition: none; }',
  '}',
].join('\n')

export const sequenceKind: IuKind<SequenceState, IuSequenceSpec> = {
  kind: 'sequence',
  label: '时序图',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · sequence 时序图：{"kind":"sequence","title":"登录流程","desc":"从点击登录到拿到令牌","actors":[{"id":"u","label":"用户"},{"id":"fe","label":"前端","tone":"ok"},{"id":"be","label":"后端","tone":"warn"},{"id":"db","label":"数据库","tone":"idle"}],"messages":[{"from":"u","to":"fe","text":"点击登录"},{"from":"fe","to":"be","text":"POST /login"},{"from":"be","to":"db","text":"查询用户"},{"from":"db","to":"be","text":"返回记录","ret":true}]}（约束：actors≤8（id≤16 唯一、label≤12、tone=brand|ok|warn|idle 默认 brand）、messages≤24（text≤40、ret=虚线返回、self=自环（from===to 自动视为 self）、from/to 引用不存在的 actor 该条丢弃）、actors<2 且无 self 消息整卡作废、坐标全自动；卡内「◀ ▶ 全部」分步播放，状态会记住）。',
}
