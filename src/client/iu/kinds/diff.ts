/**
 * iu kind: **diff**（文本 / 代码前后对比）。
 *
 * 纯逻辑半边：label / parse / snapshot / css / doc / fillText / initState，
 * 外加**行级 diff 算法**（LCS 动态规划）与**视图模型**（unified / split 排布）。
 *
 * ⚠ 本文件零 React、零 DOM —— host 半身的截图管线（shot/card.ts）要 import 它，
 *   一旦拖进 React，host 产物会内联第二份 React（体积爆炸 + assertHostExternals 失败）。
 *   React 体一律写在同名 diff.body.tsx 里。
 *
 * ## 为什么 diff 算法与视图模型都放在这里
 *
 * 对话流（Body）与截图（snapshot）**必须画出同一份 diff**：同样的高亮行、同样的
 * 行号、同样的 split 对齐。唯一可靠的办法是两边共用这里的 `computeDiffRows` 与
 * `buildDiffView` —— Body 直接 import，snapshot 拼串时调用同一函数。各算各的必然漂移
 * （见 contract.ts 头注释里钢琴卡的血泪教训：共用样式表就必须共用结构）。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { boolOrTrue, esc, str } from './core.ts'

/** before / after 各自的最大字符数（超出静默截断，不整卡作废）。 */
const MAX_TEXT = 8000

/**
 * 参与 LCS 动态规划的最大行数（单侧）。
 *
 * DP 表是 O(n·m)：200×200 = 4 万格，毫秒级、内存可忽略。超过就退化成
 * 「全 del + 全 add」——宁可对比粗一点，也不让主线程 / 截图页被 200×2000
 * 这种量级的表卡死。
 */
const MAX_DIFF_LINES = 200

/** diff 的一行结果（行级）。 */
export interface DiffRow {
  /** same=两侧都有；add=仅 after 有（新增）；del=仅 before 有（删除）。 */
  readonly type: 'same' | 'add' | 'del'
  /** before 侧行号（1 基）；add 行为 undefined。 */
  readonly beforeNo?: number
  /** after 侧行号（1 基）；del 行为 undefined。 */
  readonly afterNo?: number
  /** 行文本（原样，不转义；转义在渲染层做）。 */
  readonly text: string
}

export interface IuDiffSpec extends IuSpecBase {
  readonly kind: 'diff'
  readonly title: string
  readonly before: string
  readonly after: string
  /** 语言标注，仅显示用（不做语法高亮）。 */
  readonly lang: string
  /** true=统一 diff 视图；false=并排 split 视图。 */
  readonly unified: boolean
}

/** diff 的本地状态（持久化）。 */
export interface DiffState extends IuState {
  /** 统一 / 并排视图。 */
  readonly unified: boolean
  /** false=仅看变更行；true=显示全部上下文。 */
  readonly expand: boolean
}

/* ------------------------------------------------------------------ *
 * 视图模型（Body 与 snapshot 共用；把 rows 排成可直接渲染的形状）
 * ------------------------------------------------------------------ */

/** unified 视图的一行：两个行号槽（before / after，缺失的一侧为空）。 */
export interface UnifiedLine {
  readonly type: 'same' | 'add' | 'del'
  readonly beforeNo: number | undefined
  readonly afterNo: number | undefined
  readonly mark: string
  readonly text: string
}

/** split 视图的一格：单个行号槽；gap 是对齐用的空占位。 */
export interface SplitCell {
  readonly type: 'same' | 'add' | 'del' | 'gap'
  readonly no: number | undefined
  readonly mark: string
  readonly text: string
}

/** 判别联合：unified 给一份行列表，split 给左右两栏。 */
export type DiffView =
  | { readonly unified: true; readonly lines: readonly UnifiedLine[] }
  | { readonly unified: false; readonly left: readonly SplitCell[]; readonly right: readonly SplitCell[] }

/** 工具条上的一个 pill（Body 据 id 挂 onClick，snapshot 据 active 定格）。 */
export interface DiffPill {
  readonly id: 'unified' | 'split' | 'changed' | 'all'
  readonly label: string
  readonly active: boolean
}

/* ------------------------------------------------------------------ *
 * diff 算法（LCS 动态规划，行级）
 * ------------------------------------------------------------------ */

/** 按 \n 拆行；空串视作零行（不是一个空行）。不 trim —— 代码缩进 / 尾换行都是内容。 */
function splitLines(s: string): string[] {
  return s === '' ? [] : s.split('\n')
}

/**
 * 最简 LCS 行级 diff。
 *
 * 复杂度：时间 O(n·m)、空间 O(n·m)（n/m 为两侧行数，均 ≤ MAX_DIFF_LINES）。
 * 用「后缀 LCS 长度」DP 表 + 回溯：相等则记 same 并双双前进；不等则朝
 * dp 更大的一侧走 —— 相等时**优先删（del）**，于是变更块自然聚成
 * 「先若干 del、再若干 add」，与 git diff 的分组直觉一致，split 对齐也干净。
 */
function lcsDiff(a: readonly string[], b: readonly string[]): DiffRow[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let beforeNo = 1
  let afterNo = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', beforeNo: beforeNo, afterNo, text: a[i] })
      beforeNo += 1
      afterNo += 1
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', beforeNo, text: a[i] })
      beforeNo += 1
      i += 1
    } else {
      rows.push({ type: 'add', afterNo, text: b[j] })
      afterNo += 1
      j += 1
    }
  }
  while (i < n) {
    rows.push({ type: 'del', beforeNo, text: a[i] })
    beforeNo += 1
    i += 1
  }
  while (j < m) {
    rows.push({ type: 'add', afterNo, text: b[j] })
    afterNo += 1
    j += 1
  }
  return rows
}

/**
 * 计算行级 diff。
 *
 * 任一侧行数超过 MAX_DIFF_LINES 时退化为「全 del + 全 add」，避免 DP 表爆炸。
 * Body 与 snapshot 都调它 —— 同一份输入必得同一份 rows。
 */
export function computeDiffRows(before: string, after: string): DiffRow[] {
  const a = splitLines(before)
  const b = splitLines(after)
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    const rows: DiffRow[] = []
    for (let k = 0; k < a.length; k += 1) rows.push({ type: 'del', beforeNo: k + 1, text: a[k] })
    for (let k = 0; k < b.length; k += 1) rows.push({ type: 'add', afterNo: k + 1, text: b[k] })
    return rows
  }
  return lcsDiff(a, b)
}

/** 统计新增 / 删除行数（fillText 与工具条徽标共用；按完整 rows 数，不受 expand 影响）。 */
export function diffCounts(rows: readonly DiffRow[]): { readonly add: number; readonly del: number } {
  let add = 0
  let del = 0
  for (const r of rows) {
    if (r.type === 'add') add += 1
    else if (r.type === 'del') del += 1
  }
  return { add, del }
}

function markOf(type: DiffRow['type']): string {
  return type === 'add' ? '+' : type === 'del' ? '-' : ' '
}

/** 一段同性质（变更 / 上下文）的连续行。 */
interface DiffSegment {
  readonly changed: boolean
  readonly rows: DiffRow[]
}

/**
 * 把 rows 切成「变更块 / 上下文块」交替的段。
 *
 * 为什么要分段而不是简单 filter 掉 same：split 的左右对齐必须在**每个变更块内独立**
 * 进行。若直接把 same 全滤掉，相邻两个变更块会粘成一块 —— 当两块增删数量不对称
 * （如前块 del2/add1、后块 del1/add2）时，del 与 add 会跨块错位配对。分段后块边界
 * 天然保留，对齐才正确。
 */
function segmentRows(rows: readonly DiffRow[]): DiffSegment[] {
  const segs: DiffSegment[] = []
  for (const r of rows) {
    const changed = r.type !== 'same'
    if (segs.length > 0 && segs[segs.length - 1].changed === changed) {
      segs[segs.length - 1].rows.push(r)
    } else {
      segs.push({ changed, rows: [r] })
    }
  }
  return segs
}

/**
 * expand=false 只保留变更块（跳过上下文段）；但若一处变更都没有，回退成全部段，
 * 免得卡片空白（before === after 时仍有内容可读）。
 */
function visibleSegments(rows: readonly DiffRow[], expand: boolean): DiffSegment[] {
  const segs = segmentRows(rows)
  if (expand) return segs
  const changed = segs.filter(s => s.changed)
  return changed.length > 0 ? changed : segs
}

/**
 * 把 rows 排成可直接渲染的视图模型。
 *
 * unified：可见行逐行原样（保留两侧行号）。
 * split：左栏 = before 侧（same + del），右栏 = after 侧（same + add）；
 *   每个变更块内把 del 与 add 逐对并排，多出来的一侧用 gap 空占位补齐，保证左右行对齐。
 */
export function buildDiffView(rows: readonly DiffRow[], unified: boolean, expand: boolean): DiffView {
  const segs = visibleSegments(rows, expand)
  if (unified) {
    const lines: UnifiedLine[] = []
    for (const seg of segs) {
      for (const r of seg.rows) {
        lines.push({ type: r.type, beforeNo: r.beforeNo, afterNo: r.afterNo, mark: markOf(r.type), text: r.text })
      }
    }
    return { unified: true, lines }
  }
  const left: SplitCell[] = []
  const right: SplitCell[] = []
  for (const seg of segs) {
    if (!seg.changed) {
      for (const r of seg.rows) {
        left.push({ type: 'same', no: r.beforeNo, mark: ' ', text: r.text })
        right.push({ type: 'same', no: r.afterNo, mark: ' ', text: r.text })
      }
      continue
    }
    const dels = seg.rows.filter(r => r.type === 'del')
    const adds = seg.rows.filter(r => r.type === 'add')
    const len = Math.max(dels.length, adds.length)
    for (let k = 0; k < len; k += 1) {
      const d = k < dels.length ? dels[k] : undefined
      const ad = k < adds.length ? adds[k] : undefined
      left.push(d !== undefined
        ? { type: 'del', no: d.beforeNo, mark: '-', text: d.text }
        : { type: 'gap', no: undefined, mark: '', text: '' })
      right.push(ad !== undefined
        ? { type: 'add', no: ad.afterNo, mark: '+', text: ad.text }
        : { type: 'gap', no: undefined, mark: '', text: '' })
    }
  }
  return { unified: false, left, right }
}

/** 工具条的四个 pill（视图 2 个 + 展开 2 个）；顺序固定，Body 按 id 挂动作。 */
export function diffToolbar(state: DiffState): readonly DiffPill[] {
  return [
    { id: 'unified', label: '统一', active: state.unified },
    { id: 'split', label: '并排', active: !state.unified },
    { id: 'changed', label: '仅变更', active: !state.expand },
    { id: 'all', label: '全部', active: state.expand },
  ]
}

/* ------------------------------------------------------------------ *
 * kind 契约实现
 * ------------------------------------------------------------------ */

/** before/after 专用取值：不 trim（缩进 / 尾换行是代码内容），仅按长度截断。 */
function rawText(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) : v
}

function parse(raw: Record<string, unknown>): IuDiffSpec | undefined {
  // 两侧都不是字符串 = 根本不是 diff，整条围栏回退成代码块。
  if (typeof raw.before !== 'string' && typeof raw.after !== 'string') return undefined
  return {
    kind: 'diff',
    title: str(raw.title, 40) || '对比',
    before: rawText(raw.before),
    after: rawText(raw.after),
    lang: str(raw.lang, 12),
    unified: boolOrTrue(raw.unified),
  }
}

function initState(spec: IuDiffSpec): DiffState {
  return { unified: spec.unified, expand: false }
}

/** 回填文本必须含真实数值：这里给增删行数统计。 */
function fillText(spec: IuDiffSpec, _state: DiffState): string {
  const { add, del } = diffCounts(computeDiffRows(spec.before, spec.after))
  return `${spec.title}：+${add} \u2212${del} 行`
}

/** 单行 unified 的静态 HTML（与 Body 的 renderUnified 逐字对齐）。 */
function snapUnifiedLine(l: UnifiedLine): string {
  return `<div class="dtt-iu__dline" data-type="${l.type}">`
    + `<span class="dtt-iu__dno">${l.beforeNo ?? ''}</span>`
    + `<span class="dtt-iu__dno">${l.afterNo ?? ''}</span>`
    + `<span class="dtt-iu__dmark">${esc(l.mark)}</span>`
    + `<span class="dtt-iu__dtext">${esc(l.text)}</span>`
    + `</div>`
}

/** 单格 split 的静态 HTML（与 Body 的 renderSplit 逐字对齐）。 */
function snapSplitCell(c: SplitCell): string {
  return `<div class="dtt-iu__dline" data-type="${c.type}">`
    + `<span class="dtt-iu__dno">${c.no ?? ''}</span>`
    + `<span class="dtt-iu__dmark">${esc(c.mark)}</span>`
    + `<span class="dtt-iu__dtext">${esc(c.text)}</span>`
    + `</div>`
}

/**
 * 静态快照（截图用）：按**初始 state**（unified=spec.unified, expand=false）定格。
 *
 * DOM 结构与 diff.body.tsx 逐字对齐：工具条 → diff 容器 → 行 / 两栏。
 * 所有模型文本（尤其 before/after 是代码，可能含 < > &）一律走 esc。
 */
function snapshot(spec: IuDiffSpec): string {
  const state = initState(spec)
  const rows = computeDiffRows(spec.before, spec.after)
  const { add, del } = diffCounts(rows)
  const view = buildDiffView(rows, state.unified, state.expand)

  const pills = diffToolbar(state)
    .map(p => `<button type="button" class="dtt-iu__diff-pill"${p.active ? ' data-active="1"' : ''}>${esc(p.label)}</button>`)
    .join('')
  const lang = spec.lang !== '' ? `<span class="dtt-iu__diff-lang">${esc(spec.lang)}</span>` : ''
  const tools = `<div class="dtt-iu__diff-tools">${pills}`
    + `<span class="dtt-iu__diff-stat">+${add} \u2212${del} 行</span>${lang}</div>`

  const body = view.unified
    ? `<div class="dtt-iu__diff">${view.lines.map(snapUnifiedLine).join('')}</div>`
    : `<div class="dtt-iu__diff--split">`
      + `<div class="dtt-iu__dcol">${view.left.map(snapSplitCell).join('')}</div>`
      + `<div class="dtt-iu__dcol">${view.right.map(snapSplitCell).join('')}</div>`
      + `</div>`

  return tools + body
}

const MONO = 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace)'
const SUCCESS = 'var(--dsw-alias-state-success-primary, #27ae60)'
const ERROR = 'var(--dsw-alias-state-error-primary, #e8503a)'
const BRAND = 'var(--dsw-alias-state-business-primary, #4176e6)'
const BORDER = 'var(--dsw-alias-border-l3, rgba(127,127,127,.18))'
const LAYER2 = 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))'

const CSS = [
  '/* diff：工具条（pill 切换）+ 等宽行级对比 + split 两栏 */',
  '.dtt-iu__diff-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 6px 0 8px; }',
  '.dtt-iu__diff-pill { border: 1px solid ' + BORDER + '; background: transparent; color: inherit;',
  '  font: inherit; font-size: calc(11.5px * var(--iu-text-scale, 1)); border-radius: 8px;',
  '  padding: 2px 11px; cursor: pointer; opacity: .58; line-height: 1.7; white-space: nowrap;',
  '  transition: opacity .18s ease, background-color .18s ease, transform .18s ease, border-color .18s ease, color .18s ease; }',
  '.dtt-iu__diff-pill:hover { opacity: 1; transform: translateY(-1px); }',
  '.dtt-iu__diff-pill:active { transform: translateY(0) scale(.95); }',
  '.dtt-iu__diff-pill[data-active] { opacity: 1; font-weight: 600; color: ' + BRAND + ';',
  '  border-color: color-mix(in srgb, ' + BRAND + ' 55%, transparent);',
  '  background: color-mix(in srgb, ' + BRAND + ' 12%, transparent); }',
  '.dtt-iu__diff-stat { margin-left: auto; font-size: calc(11px * var(--iu-text-scale, 1));',
  '  font-variant-numeric: tabular-nums; opacity: .6; white-space: nowrap; padding-left: 6px; }',
  '.dtt-iu__diff-lang { font-size: calc(10.5px * var(--iu-text-scale, 1)); opacity: .5;',
  '  border: 1px solid currentColor; border-radius: 8px; padding: 0 7px; line-height: 16px; white-space: nowrap; }',

  '/* 对比容器：等宽字体，行铺满；unified 与 split 共用同一套边框 / 圆角 / 字号。 */',
  '.dtt-iu__diff, .dtt-iu__diff--split { border: 1px solid ' + BORDER + '; border-radius: 8px;',
  '  overflow: hidden; font-family: ' + MONO + '; font-size: calc(12px * var(--iu-text-scale, 1));',
  '  line-height: 1.55; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.03)); }',
  '.dtt-iu__diff--split { display: flex; align-items: stretch; }',
  '.dtt-iu__dcol { flex: 1 1 0; min-width: 0; }',
  '.dtt-iu__dcol + .dtt-iu__dcol { border-left: 1px solid ' + BORDER + '; }',

  '/* 一行：行号槽（fixed）+ 标记（fixed）+ 文本（占余下、可换行）。 */',
  '.dtt-iu__dline { display: flex; align-items: flex-start; padding: 0 8px;',
  '  transition: background-color .15s ease; }',
  '.dtt-iu__dno { flex: none; min-width: 2.4ch; text-align: right; padding-right: 8px;',
  '  opacity: .38; user-select: none; font-variant-numeric: tabular-nums; }',
  '.dtt-iu__dmark { flex: none; width: 1.1em; text-align: center; white-space: pre;',
  '  user-select: none; font-weight: 700; opacity: .8; }',
  '.dtt-iu__dtext { flex: 1 1 auto; min-width: 0; white-space: pre-wrap; word-break: break-word;',
  '  min-height: 1.55em; }',

  '/* 变更着色：add 绿底、del 红底（color-mix 淡化，浮在卡片底色上）。 */',
  '.dtt-iu__dline[data-type="add"] { background: color-mix(in srgb, ' + SUCCESS + ' 15%, transparent); }',
  '.dtt-iu__dline[data-type="del"] { background: color-mix(in srgb, ' + ERROR + ' 15%, transparent); }',
  '.dtt-iu__dline[data-type="add"] .dtt-iu__dmark { color: ' + SUCCESS + '; }',
  '.dtt-iu__dline[data-type="del"] .dtt-iu__dmark { color: ' + ERROR + '; }',
  '/* gap：split 里为对齐补的空位，斜纹弱化，表示「另一侧无对应行」。 */',
  '.dtt-iu__dline[data-type="gap"] { background-image: repeating-linear-gradient(45deg,',
  '  rgba(127,127,127,.07) 0 4px, transparent 4px 9px); }',

  '/* hover：仅加深底色，不动几何 —— 文本可见性永不依赖动效。 */',
  '.dtt-iu__dline[data-type="same"]:hover { background: ' + LAYER2 + '; }',
  '.dtt-iu__dline[data-type="add"]:hover { background: color-mix(in srgb, ' + SUCCESS + ' 24%, transparent); }',
  '.dtt-iu__dline[data-type="del"]:hover { background: color-mix(in srgb, ' + ERROR + ' 24%, transparent); }',

  '/* 深色主题：变更底色加深一点，保证在深底上依然分得清。 */',
  'body[data-ds-dark-theme] .dtt-iu__dline[data-type="add"] { background: color-mix(in srgb, ' + SUCCESS + ' 22%, transparent); }',
  'body[data-ds-dark-theme] .dtt-iu__dline[data-type="del"] { background: color-mix(in srgb, ' + ERROR + ' 22%, transparent); }',
  'body[data-ds-dark-theme] .dtt-iu__dline[data-type="add"]:hover { background: color-mix(in srgb, ' + SUCCESS + ' 32%, transparent); }',
  'body[data-ds-dark-theme] .dtt-iu__dline[data-type="del"]:hover { background: color-mix(in srgb, ' + ERROR + ' 32%, transparent); }',

  '/* 窄屏：split 自动降级 —— 两栏改上下堆叠，各占满宽（单栏可读，等价于回到统一流）。 */',
  '@media (max-width: 640px) {',
  '  .dtt-iu__diff--split { flex-direction: column; }',
  '  .dtt-iu__dcol + .dtt-iu__dcol { border-left: 0; border-top: 1px solid ' + BORDER + '; }',
  '}',

  '/* 无障碍：关掉全部过渡与位移；变更着色是背景色（非动画），关掉后照样完整可读。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__diff-pill { transition: none; }',
  '  .dtt-iu__diff-pill:hover, .dtt-iu__diff-pill:active { transform: none; }',
  '  .dtt-iu__dline { transition: none; }',
  '}',
].join('\n')

export const diffKind: IuKind<DiffState, IuDiffSpec> = {
  kind: 'diff',
  label: '对比',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · diff 对比：{"kind":"diff","title":"标题","before":"旧文本第一行\\n旧文本第二行","after":"旧文本第一行\\n新文本第二行","lang":"text","unified":true}（约束：before/after 各≤8000 字符、按 \\n 拆行做行级对比，unified 可选，true=统一视图 / false=并排；卡内可切「统一/并排」「仅变更/全部」）。',
}
