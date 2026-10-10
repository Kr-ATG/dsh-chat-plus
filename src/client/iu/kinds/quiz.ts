/**
 * iu kind: **quiz**（选择题/自测卡：可多题，答题后揭示对错与解析）。
 *
 * 结构照抄范本 slider.ts（纯逻辑半边）+ slider.body.tsx（React 半边）。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 *   React 体一律写在 quiz.body.tsx 里。
 *
 * ## 确定性 shuffle（关键纪律）
 * `shuffle: true` 时选项顺序在 **parse 阶段**就打乱并定格进 spec：seed 取
 * 题干文本的 FNV-1a 哈希，喂给 mulberry32 伪随机做 Fisher-Yates。同一份围栏
 * JSON 永远得到同一顺序——snapshot（host 截图）与 Body（client 渲染）消费
 * 的是同一个 parse 产物，两处天然一致。绝不能用 Math.random()：那会让每次
 * 渲染顺序不同，截图与对话流当场漂移。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, boolOrFalse, esc, int, nums, pickAll, str, strOr, STATE_COLORS } from './core.ts'

/** 一道题（parse 后的定格形态：shuffle 已应用，answer 已重映射到显示顺序）。 */
export interface IuQuizQuestion {
  /** 题干（≤120 字）。 */
  readonly q: string
  /** 选项文本（2–6 项，每项 ≤60 字；shuffle 时已是打乱后的显示顺序）。 */
  readonly options: readonly string[]
  /** 正确项下标（0-based，钳进 [0, options.length-1]，指向显示顺序）。 */
  readonly answer: number
  /** 解析（≤160 字，可空）。 */
  readonly explain: string
  /** 是否多选交互（默认 false；多选需点「确认」才揭示）。 */
  readonly multi: boolean
}

export interface IuQuizSpec extends IuSpecBase {
  readonly kind: 'quiz'
  readonly title: string
  readonly desc: string
  readonly questions: readonly IuQuizQuestion[]
  readonly shuffle: boolean
}

/** quiz 的本地状态（持久化）。picked 的 key 是题号字符串（JSON 安全）。 */
export interface QuizState extends IuState {
  /** 题号 → 选中的选项下标数组。 */
  readonly picked: Readonly<Record<string, readonly number[]>>
  /** 每题是否已揭示答案（长度 = questions.length）。 */
  readonly revealed: readonly boolean[]
  /** 是否展开总分明细。 */
  readonly showResult: boolean
}

/** 归一化后的状态（Body 与 fillText 共用，防持久化脏数据）。 */
export interface QuizStateNorm {
  readonly picked: Readonly<Record<string, readonly number[]>>
  readonly revealed: readonly boolean[]
  readonly showResult: boolean
}

/** 选项字母标（options ≤6）。 */
export const QUIZ_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

/* ------------------------------------------------------------------ */
/* 确定性伪随机（同 seed 同序列，与渲染次数无关）                        */
/* ------------------------------------------------------------------ */

/** FNV-1a 32bit 文本哈希：题干 → seed。 */
function hashText(text: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** mulberry32：小巧的确定性 PRNG（纯整数运算，跨平台稳定）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成 0..count-1 的确定性排列：返回值 perm 满足「新位置 k 上是原下标 perm[k]」。
 * Fisher-Yates + mulberry32，同 seed 永远同排列。
 */
function shuffledIndices(count: number, seed: number): number[] {
  const perm: number[] = Array.from({ length: count }, (_, i) => i)
  const rand = mulberry32(seed)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = perm[i] as number
    perm[i] = perm[j] as number
    perm[j] = tmp
  }
  return perm
}

/* ------------------------------------------------------------------ */
/* parse / initState / 归一化                                          */
/* ------------------------------------------------------------------ */

function parseQuestion(raw: Record<string, unknown>, shuffle: boolean): IuQuizQuestion | undefined {
  const q = str(raw.q, 120)
  if (q === '') return undefined
  // 选项是字符串数组，pickAll 只收对象项，这里手工遍历（同样「只数合格项」）。
  const options: string[] = []
  for (const item of arr(raw.options)) {
    if (options.length >= 6) break
    const text = str(item, 60)
    if (text !== '') options.push(text)
  }
  if (options.length < 2) return undefined
  let answer = int(raw.answer, 0, options.length - 1, 0)
  let shown: readonly string[] = options
  if (shuffle) {
    const perm = shuffledIndices(options.length, hashText(q))
    shown = perm.map(i => options[i] as string)
    answer = perm.indexOf(answer)
    if (answer < 0) answer = 0
  }
  return { q, options: shown, answer, explain: str(raw.explain, 160), multi: boolOrFalse(raw.multi) }
}

function parse(raw: Record<string, unknown>): IuQuizSpec | undefined {
  const shuffle = boolOrFalse(raw.shuffle)
  const questions = pickAll<IuQuizQuestion>(raw.questions, 10, it => parseQuestion(it, shuffle))
  if (questions.length === 0) return undefined
  return {
    kind: 'quiz',
    title: strOr(raw.title, 40, '自测'),
    desc: str(raw.desc, 80),
    questions,
    shuffle,
  }
}

function initState(spec: IuQuizSpec): QuizState {
  return {
    picked: {},
    revealed: spec.questions.map(() => false),
    showResult: false,
  }
}

/**
 * 状态归一化：持久化层还回来的 JSON 可能缺字段、长度不对、混进脏值
 * （spec 改版后题数变化等），这里一律钳回合法形状，Body 与 fillText 共用。
 */
export function normalizeQuizState(spec: IuQuizSpec, state: QuizState): QuizStateNorm {
  const n = spec.questions.length
  const revRaw: readonly unknown[] = Array.isArray(state.revealed) ? state.revealed : []
  const revealed: boolean[] = []
  for (let i = 0; i < n; i++) revealed.push(revRaw[i] === true)
  const pickedRaw: Record<string, unknown> =
    typeof state.picked === 'object' && state.picked !== null
      ? state.picked as Record<string, unknown>
      : {}
  const picked: Record<string, readonly number[]> = {}
  for (let i = 0; i < n; i++) {
    const q = spec.questions[i]
    if (q === undefined) continue
    const list = pickedRaw[String(i)]
    if (!Array.isArray(list)) continue
    const cleaned = [...new Set(
      nums(list, 8).map(v => Math.round(v)).filter(v => v >= 0 && v < q.options.length),
    )]
    if (cleaned.length > 0) picked[String(i)] = cleaned
  }
  return { picked, revealed, showResult: state.showResult === true }
}

/**
 * 判对：选中集合**恰好只有正确项**（单选多选同一标准；multi 只改交互——
 * 可勾多个、要点确认——answer 按 spec 是单个下标）。
 */
export function quizQuestionCorrect(q: IuQuizQuestion, picked: readonly number[] | undefined): boolean {
  return picked !== undefined && picked.length === 1 && picked[0] === q.answer
}

/* ------------------------------------------------------------------ */
/* fillText / snapshot                                                 */
/* ------------------------------------------------------------------ */

function fillText(spec: IuQuizSpec, state: QuizState): string {
  const s = normalizeQuizState(spec, state)
  let correct = 0
  let unanswered = 0
  spec.questions.forEach((q, i) => {
    if (s.revealed[i] !== true) {
      unanswered += 1
      return
    }
    if (quizQuestionCorrect(q, s.picked[String(i)])) correct += 1
  })
  const base = `${spec.title}：答对 ${correct}/${spec.questions.length}`
  return unanswered > 0 ? `${base}，还有 ${unanswered} 题未答` : base
}

/**
 * 静态快照（截图用）。DOM 结构与 quiz.body.tsx **逐字对齐**（见 contract.ts
 * 头注释）：按初始 state 定格——全部未答、未揭示，选项静态 disabled；
 * 不显示解析、确认/重做按钮与得分条（那些都是答后才出现的节点，Body 在
 * 初始态同样不渲染它们，两侧结构因此一致）。
 * 所有模型文本走 esc；属性值全部是写死的 class/常量，无模型文本入属性。
 */
function snapshot(spec: IuQuizSpec): string {
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const qs = spec.questions.map((q, i) => {
    const stem = `<div class="dtt-iu__q-stem"><b class="dtt-iu__q-no">Q${i + 1}</b>`
      + `<span class="dtt-iu__q-stem-text">${esc(q.q)}</span>`
      + (q.multi ? `<span class="dtt-iu__q-multi">多选</span>` : '')
      + `</div>`
    const opts = q.options.map((o, oi) =>
      `<button type="button" class="dtt-iu__q-opt" disabled>`
      + `<span class="dtt-iu__q-key">${esc(QUIZ_LETTERS[oi] ?? String(oi + 1))}</span>`
      + `<span class="dtt-iu__q-opt-text">${esc(o)}</span>`
      + `</button>`).join('')
    return `<div class="dtt-iu__q">${stem}<div class="dtt-iu__q-opts">${opts}</div></div>`
  }).join('')
  return `${desc}<div class="dtt-iu__quiz">${qs}</div>`
}

/* ------------------------------------------------------------------ */
/* CSS                                                                 */
/* ------------------------------------------------------------------ */

const CSS = [
  '/* quiz：题干 + 选项卡 + 解析滑出 + 得分条（对错色一律走 STATE_COLORS） */',
  '.dtt-iu__quiz { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }',
  '.dtt-iu__q { display: flex; flex-direction: column; gap: 6px; }',
  '.dtt-iu__q-stem { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap;',
  '  font-size: calc(13px * var(--iu-text-scale, 1)); font-weight: 600; line-height: 1.55; }',
  `.dtt-iu__q-no { flex: none; font-size: calc(10.5px * var(--iu-text-scale, 1)); font-weight: 700;`,
  `  color: ${STATE_COLORS.brand}; background: color-mix(in srgb, ${STATE_COLORS.brand} 12%, transparent);`,
  '  border-radius: 8px; padding: 1px 7px; line-height: 1.7; }',
  '.dtt-iu__q-stem-text { min-width: 0; }',
  `.dtt-iu__q-multi { flex: none; font-size: calc(10px * var(--iu-text-scale, 1)); font-weight: 500;`,
  `  color: ${STATE_COLORS.warn}; border: 1px solid color-mix(in srgb, ${STATE_COLORS.warn} 45%, transparent);`,
  '  border-radius: 8px; padding: 0 6px; line-height: 1.8; }',
  /* 选项：宽屏 auto-fill 卡片，窄屏满宽纵排（见下方 media） */
  '.dtt-iu__q-opts { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }',
  '.dtt-iu__q-opt { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;',
  '  font: inherit; font-size: calc(12.5px * var(--iu-text-scale, 1)); color: inherit; cursor: pointer;',
  '  border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.22)); border-radius: 10px;',
  '  padding: 6px 10px; background: transparent;',
  '  transition: border-color .18s ease, background-color .18s ease, transform .18s ease,',
  '    box-shadow .18s ease, color .18s ease; }',
  `.dtt-iu__q-opt:hover:not(:disabled) { transform: translateY(-1px);`,
  `  border-color: color-mix(in srgb, ${STATE_COLORS.brand} 55%, transparent);`,
  `  background: color-mix(in srgb, ${STATE_COLORS.brand} 7%, transparent); }`,
  '.dtt-iu__q-opt:active:not(:disabled) { transform: translateY(0) scale(.985); }',
  '.dtt-iu__q-opt:disabled { cursor: default; }',
  '.dtt-iu__q-key { flex: none; width: 19px; height: 19px; border-radius: 50%;',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  font-size: calc(10.5px * var(--iu-text-scale, 1)); font-weight: 700;',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));',
  '  transition: background-color .18s ease, color .18s ease, transform .18s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-iu__q-opt-text { min-width: 0; }',
  '.dtt-iu__q-mark { margin-left: auto; flex: none; font-weight: 700;',
  '  font-size: calc(12px * var(--iu-text-scale, 1)); }',
  /* 选中（未揭示）：品牌色 */
  `.dtt-iu__q-opt[data-picked="1"] { border-color: ${STATE_COLORS.brand};`,
  `  background: color-mix(in srgb, ${STATE_COLORS.brand} 12%, transparent); }`,
  `.dtt-iu__q-opt[data-picked="1"] .dtt-iu__q-key { background: ${STATE_COLORS.brand}; color: #fff;`,
  '  transform: scale(1.06); }',
  /* 揭示后：正确绿 / 错选红（写在 picked 之后，同权重后来居上） */
  '.dtt-iu__q-opt:focus-visible, .dtt-iu__q-confirm:focus-visible, .dtt-iu__q-retry:focus-visible,',
  '  .dtt-iu__quiz-score-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }',
  `.dtt-iu__q-opt[data-right="1"] { border-color: ${STATE_COLORS.ok}; font-weight: 600;`,
  `  background: color-mix(in srgb, ${STATE_COLORS.ok} 14%, transparent);`,
  '  animation: dtt-iu-quiz-pop .3s cubic-bezier(.2,.8,.25,1) both; }',
  `.dtt-iu__q-opt[data-right="1"] .dtt-iu__q-key { background: ${STATE_COLORS.ok}; color: #fff; }`,
  `.dtt-iu__q-opt[data-right="1"] .dtt-iu__q-mark { color: ${STATE_COLORS.ok}; }`,
  `.dtt-iu__q-opt[data-wrong="1"] { border-color: ${STATE_COLORS.bad}; font-weight: 600;`,
  `  background: color-mix(in srgb, ${STATE_COLORS.bad} 12%, transparent);`,
  '  animation: dtt-iu-quiz-shake .32s ease both; }',
  `.dtt-iu__q-opt[data-wrong="1"] .dtt-iu__q-key { background: ${STATE_COLORS.bad}; color: #fff; }`,
  `.dtt-iu__q-opt[data-wrong="1"] .dtt-iu__q-mark { color: ${STATE_COLORS.bad}; }`,
  '/* 可见性不依赖动画（基座纪律，见 styles.ts）：pop 起点 opacity .55、',
  '   shake 只横移 2px——动画没跑或停在首帧时选项照样完整可读。 */',
  '@keyframes dtt-iu-quiz-pop { from { opacity: .55; transform: scale(.98) } to { opacity: 1; transform: none } }',
  '@keyframes dtt-iu-quiz-shake { 0%, 100% { transform: none } 30% { transform: translateX(-2px) } 60% { transform: translateX(2px) } }',
  /* 确认 / 重做按钮 */
  '.dtt-iu__q-acts { display: flex; gap: 6px; }',
  '.dtt-iu__q-confirm, .dtt-iu__q-retry { font: inherit; cursor: pointer;',
  '  font-size: calc(11.5px * var(--iu-text-scale, 1)); border-radius: 8px; padding: 3px 12px;',
  '  transition: transform .18s ease, background-color .18s ease, opacity .18s ease, box-shadow .18s ease; }',
  '.dtt-iu__q-confirm:hover, .dtt-iu__q-retry:hover { transform: translateY(-1px); }',
  '.dtt-iu__q-confirm:active, .dtt-iu__q-retry:active { transform: translateY(0) scale(.96); }',
  `.dtt-iu__q-confirm { border: 1px solid ${STATE_COLORS.brand}; color: #fff; background: ${STATE_COLORS.brand}; }`,
  `.dtt-iu__q-confirm:hover { box-shadow: 0 2px 10px color-mix(in srgb, ${STATE_COLORS.brand} 35%, transparent); }`,
  '.dtt-iu__q-retry { border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.25));',
  '  background: transparent; color: inherit; opacity: .65; }',
  '.dtt-iu__q-retry:hover { opacity: 1; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); }',
  /* 解析：揭示后挂载即滑出（条件渲染 + 入场动画，起点不是 opacity 0） */
  '.dtt-iu__q-explain { display: flex; gap: 7px; align-items: baseline;',
  '  font-size: calc(12px * var(--iu-text-scale, 1)); line-height: 1.65; border-radius: 8px; padding: 6px 9px;',
  `  border-left: 2px solid color-mix(in srgb, ${STATE_COLORS.brand} 55%, transparent);`,
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));',
  '  animation: dtt-iu-quiz-in .3s cubic-bezier(.2,.8,.25,1) both; }',
  '@keyframes dtt-iu-quiz-in { from { opacity: .4; transform: translateY(-4px) } to { opacity: 1; transform: none } }',
  `.dtt-iu__q-explain b { flex: none; color: ${STATE_COLORS.brand};`,
  '  font-size: calc(11px * var(--iu-text-scale, 1)); }',
  /* 得分条 */
  '.dtt-iu__quiz-score { display: flex; flex-direction: column; gap: 6px; margin-top: 2px;',
  '  padding-top: 9px; border-top: 1px dashed var(--dsw-alias-border-l3, rgba(127,127,127,.25));',
  '  animation: dtt-iu-quiz-in .3s cubic-bezier(.2,.8,.25,1) both; }',
  '.dtt-iu__quiz-score-main { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; row-gap: 6px; }',
  '.dtt-iu__quiz-score-num { font-size: calc(13px * var(--iu-text-scale, 1)); font-weight: 700;',
  '  font-variant-numeric: tabular-nums; white-space: nowrap; }',
  '.dtt-iu__quiz-score-bar { flex: 1; height: 4px; border-radius: 999px; overflow: hidden;',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14)); }',
  '.dtt-iu__quiz-score-bar i { display: block; height: 100%; border-radius: 999px;',
  `  background: ${STATE_COLORS.ok}; transition: width .35s cubic-bezier(.2,.8,.25,1); }`,
  '.dtt-iu__quiz-score-btn { font: inherit; cursor: pointer; white-space: nowrap;',
  '  font-size: calc(11.5px * var(--iu-text-scale, 1)); border-radius: 8px; padding: 3px 12px;',
  `  border: 1px solid color-mix(in srgb, ${STATE_COLORS.brand} 50%, transparent);`,
  `  color: ${STATE_COLORS.brand}; background: transparent;`,
  '  transition: transform .18s ease, background-color .18s ease; }',
  `.dtt-iu__quiz-score-btn:hover { transform: translateY(-1px);`,
  `  background: color-mix(in srgb, ${STATE_COLORS.brand} 9%, transparent); }`,
  '.dtt-iu__quiz-score-detail { display: flex; flex-wrap: wrap; gap: 5px;',
  '  animation: dtt-iu-quiz-in .25s ease both; }',
  '.dtt-iu__quiz-score-chip { font-size: calc(10.5px * var(--iu-text-scale, 1)); border-radius: 8px;',
  '  padding: 1px 8px; font-variant-numeric: tabular-nums;',
  `  background: color-mix(in srgb, ${STATE_COLORS.bad} 12%, transparent); color: ${STATE_COLORS.bad}; }`,
  `.dtt-iu__quiz-score-chip[data-ok="1"] { background: color-mix(in srgb, ${STATE_COLORS.ok} 13%, transparent);`,
  `  color: ${STATE_COLORS.ok}; }`,
  /* 窄屏：选项满宽纵排 */
  '@media (max-width: 560px) {',
  '  .dtt-iu__q-opts { grid-template-columns: 1fr; }',
  '}',
  /* 无障碍：关动画但**保留状态色与最终态**——对错反馈靠颜色/符号本身，不靠动效 */
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__q-opt, .dtt-iu__q-key, .dtt-iu__q-confirm, .dtt-iu__q-retry,',
  '  .dtt-iu__quiz-score-bar i, .dtt-iu__quiz-score-btn { transition: none; }',
  '  .dtt-iu__q-opt[data-right="1"], .dtt-iu__q-opt[data-wrong="1"],',
  '  .dtt-iu__q-explain, .dtt-iu__quiz-score, .dtt-iu__quiz-score-detail { animation: none; }',
  '  .dtt-iu__q-opt:hover:not(:disabled), .dtt-iu__q-confirm:hover, .dtt-iu__q-retry:hover,',
  '  .dtt-iu__quiz-score-btn:hover { transform: none; }',
  '}',
].join('\n')

export const quizKind: IuKind<QuizState, IuQuizSpec> = {
  kind: 'quiz',
  label: '自测',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · quiz 自测：{"kind":"quiz","title":"小测","desc":"两题热身","questions":[{"q":"1 + 1 等于几？","options":["1","2","3"],"answer":1,"explain":"十进制加法。"},{"q":"下列哪个是 iu 卡片 kind？","options":["quiz","Excel","记事本","计算器"],"answer":0,"multi":true,"explain":"quiz 是自测卡；multi 题可勾多项、点确认揭示。"}],"shuffle":false}（约束：questions≤10；每题 options 2–6 项、每项≤60 字；answer 是正确项的 0-based 下标；multi 可选=多选交互；explain 可选=解析；shuffle 可选=确定性打乱选项；单选点选即揭示判分，全部揭示后底部给「答对 X/N」）。',
}
