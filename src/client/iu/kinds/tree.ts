/**
 * iu kind: **tree**（可折叠树形结构）。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 *   React 体一律写在 tree.body.tsx 里。
 *
 * ## Body 与 snapshot 的对齐管线（本 kind 的关键设计）
 *
 *   flattenTree(root, collapsed) → 可见行的扁平数组（带 depth / hasKids / collapsed）
 *   groupTreeRows(rows)          → 嵌套分组（纯数据，决定 tnode / tkids 的 DOM 层级）
 *   treeGroups                   = groupTreeRows ∘ flattenTree
 *
 * tree.body.tsx（JSX）与 snapshot()（拼串）**都只消费 treeGroups 的输出**：
 * 「哪些行可见、每行多深、折叠与否」全部在本文件一次算清，两侧只是把同一份
 * 数据映射成各自的输出形态——不会出现第二套树遍历逻辑（那正是漂移之源，
 * 见 contract.ts 头注释里钢琴卡的血泪教训）。
 *
 * 折叠采用**条件渲染**（被折叠子树的行根本不进 rows），子树出现时由
 * `.dtt-iu__tkids` 的入场动画补顺滑；可见性永远不依赖动画（首帧 opacity .45
 * 而不是 0，与基座图表纪律一致——动画没跑时内容照样完整可见）。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, esc, str, strOr } from './core.ts'

/** 深度上限（根为第 1 层，第 6 层的节点不再解析 children）。 */
const MAX_DEPTH = 6
/** 节点总数上限（超出直接截断，不整卡拒绝——钳位优于消失）。 */
const MAX_NODES = 200

/** 一个树节点（parse 后所有字段均已归一：可选字段缺省为空串/空数组）。 */
export interface IuTreeNode {
  /** 全树唯一。模型没给或给重了时按路径下标自动生成（如 "0-2-1"）。 */
  readonly id: string
  readonly label: string
  readonly note: string
  readonly icon: string
  readonly children: readonly IuTreeNode[]
}

export interface IuTreeSpec extends IuSpecBase {
  readonly kind: 'tree'
  readonly title: string
  readonly desc: string
  readonly root: IuTreeNode
}

/** tree 的本地状态（持久化）：被折叠的节点 id 列表；空数组 = 全展开。 */
export interface TreeState extends IuState {
  readonly collapsed: readonly string[]
}

/** parse 期的共享上下文：已占用 id 集合 + 已收节点计数（预算）。 */
interface ParseCtx {
  readonly used: Set<string>
  count: number
}

/**
 * 定一个全树唯一的 id。
 *
 * 优先级：模型给的 id（≤16 字、未占用）→ 路径下标（"0-2-1" 形态）→
 * 路径下标加递增后缀（模型 id 恰好撞了某条路径的极端情况）。
 * 「先到先得」：同一个 id 出现两次时，第一次出现的节点保住它，
 * 后来的走自动生成——重定向比拒绝友好。
 */
function makeId(rawId: unknown, path: string, ctx: ParseCtx): string {
  const wanted = str(rawId, 16)
  if (wanted !== '' && !ctx.used.has(wanted)) {
    ctx.used.add(wanted)
    return wanted
  }
  if (!ctx.used.has(path)) {
    ctx.used.add(path)
    return path
  }
  let n = 2
  for (;;) {
    const candidate = `${path}~${n}`
    if (!ctx.used.has(candidate)) {
      ctx.used.add(candidate)
      return candidate
    }
    n += 1
  }
}

/** 递归解析一个节点；不合格（非对象 / 无 label / 预算耗尽）返回 undefined。 */
function parseNode(raw: unknown, path: string, depth: number, ctx: ParseCtx): IuTreeNode | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  if (ctx.count >= MAX_NODES) return undefined
  const obj = raw as Record<string, unknown>
  const label = str(obj.label, 40)
  if (label === '') return undefined
  // id 在 label 校验之后才定：跳过的空节点不消耗 id 名额。
  const id = makeId(obj.id, path, ctx)
  ctx.count += 1
  const children: IuTreeNode[] = []
  if (depth < MAX_DEPTH) {
    const rawKids = arr(obj.children)
    for (let i = 0; i < rawKids.length; i += 1) {
      if (ctx.count >= MAX_NODES) break
      const kid = parseNode(rawKids[i], `${path}-${i}`, depth + 1, ctx)
      if (kid !== undefined) children.push(kid)
    }
  }
  return { id, label, note: str(obj.note, 60), icon: str(obj.icon, 4), children }
}

function parse(raw: Record<string, unknown>): IuTreeSpec | undefined {
  const ctx: ParseCtx = { used: new Set<string>(), count: 0 }
  const root = parseNode(raw.root, '0', 1, ctx)
  if (root === undefined) return undefined
  return {
    kind: 'tree',
    title: strOr(raw.title, 40, '结构'),
    desc: str(raw.desc, 80),
    root,
  }
}

/** 默认全展开。 */
function initState(): TreeState {
  return { collapsed: [] }
}

/**
 * 从（可能来自 localStorage 的脏）state 里读出干净的 collapsed 数组：
 * 只留非空字符串并去重。Body、fillText、setState 补丁三处共用。
 */
export function readCollapsed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item === 'string' && item !== '' && !seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

/** flattenTree 的一行：一个**当前可见**的节点 + 渲染它所需的全部判定。 */
export interface IuTreeRow {
  readonly node: IuTreeNode
  /** 根为 0，每深一层 +1。 */
  readonly depth: number
  readonly hasKids: boolean
  /** 该行是否处于折叠态（仅 hasKids 时有意义；叶子恒 false）。 */
  readonly collapsed: boolean
}

/**
 * 前序展平成可见行列表（Body 与 snapshot 共用的**唯一**可见性判定）。
 *
 * 被折叠节点的子树不进结果——条件渲染由数据驱动，两侧天然一致。
 */
export function flattenTree(root: IuTreeNode, collapsed: ReadonlySet<string>): IuTreeRow[] {
  const out: IuTreeRow[] = []
  const walk = (node: IuTreeNode, depth: number): void => {
    const hasKids = node.children.length > 0
    const isCollapsed = hasKids && collapsed.has(node.id)
    out.push({ node, depth, hasKids, collapsed: isCollapsed })
    if (hasKids && !isCollapsed) {
      for (const kid of node.children) walk(kid, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

/** 嵌套分组：一行 + 它当前可见的直接子分组（决定 tnode / tkids 的 DOM 层级）。 */
export interface IuTreeGroup {
  readonly row: IuTreeRow
  readonly kids: readonly IuTreeGroup[]
}

/**
 * 扁平可见行 → 嵌套分组（纯数据，栈算法一次成型）。
 *
 * 前序行序列的性质保证正确性：子行 depth = 父行 depth + 1，回跳时可跨多层。
 * 分组只是「depth 序列 → 层级」的结构映射，不含任何可见性/业务判定。
 */
export function groupTreeRows(rows: readonly IuTreeRow[]): IuTreeGroup[] {
  const roots: IuTreeGroup[] = []
  const stack: { depth: number; kids: IuTreeGroup[] }[] = [{ depth: -1, kids: roots }]
  for (const row of rows) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= row.depth) stack.pop()
    const kids: IuTreeGroup[] = []
    stack[stack.length - 1].kids.push({ row, kids })
    stack.push({ depth: row.depth, kids })
  }
  return roots
}

/** 组合入口：Body 与 snapshot 都从这里拿最终数据。 */
export function treeGroups(root: IuTreeNode, collapsed: ReadonlySet<string>): IuTreeGroup[] {
  return groupTreeRows(flattenTree(root, collapsed))
}

/** 全树节点总数（fillText 用；≤200 个节点，递归无压力）。 */
export function countTreeNodes(root: IuTreeNode): number {
  let n = 1
  for (const kid of root.children) n += countTreeNodes(kid)
  return n
}

/** 回填文本：真实数值（总节点数 + 当前展开的可见行数）。 */
function fillText(spec: IuTreeSpec, state: TreeState): string {
  const visible = flattenTree(spec.root, new Set(readCollapsed(state.collapsed))).length
  return `${spec.title}：共 ${countTreeNodes(spec.root)} 个节点，展开 ${visible}`
}

/** snapshot 用的空折叠集（按初始全展开定格整棵树）。 */
const NO_COLLAPSE: ReadonlySet<string> = new Set<string>()

/**
 * 一行的 HTML（与 tree.body.tsx 的 TGroup 行部分**逐字对齐**：
 * twist → icon? → label → note? 的顺序、class、条件渲染全部一致）。
 * 叶子也输出空 twist 占位，保证 label 起始位置对齐。
 */
function rowHtml(row: IuTreeRow): string {
  const { node, hasKids } = row
  const twist = `<span class="dtt-iu__twist">${hasKids ? '▸' : ''}</span>`
  const icon = node.icon !== '' ? `<span class="dtt-iu__ticon">${esc(node.icon)}</span>` : ''
  const note = node.note !== '' ? `<span class="dtt-iu__tnote">${esc(node.note)}</span>` : ''
  return `<div class="dtt-iu__trow">${twist}${icon}<span class="dtt-iu__tlabel">${esc(node.label)}</span>${note}</div>`
}

/** 分组 → 嵌套 HTML。属性值只有内部数字与 0/1，模型文本全部走 esc 且只出现在文本节点。 */
function groupsHtml(groups: readonly IuTreeGroup[]): string {
  return groups.map((g) => {
    const { depth, hasKids, collapsed } = g.row
    const kids = g.kids.length > 0 ? `<div class="dtt-iu__tkids">${groupsHtml(g.kids)}</div>` : ''
    return `<div class="dtt-iu__tnode" data-depth="${depth}" data-leaf="${hasKids ? '0' : '1'}" data-collapsed="${collapsed ? '1' : '0'}">${rowHtml(g.row)}${kids}</div>`
  }).join('')
}

/** 静态快照（截图用）：初始全展开渲染整棵树，与 Body 共用 treeGroups。 */
function snapshot(spec: IuTreeSpec): string {
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  return `${desc}<div class="dtt-iu__tree">${groupsHtml(treeGroups(spec.root, NO_COLLAPSE))}</div>`
}

const CSS = [
  '/* tree：可折叠树形结构（缩进靠 tkids 嵌套递增，引导线对齐父行箭头中心） */',
  '.dtt-iu__tree { margin: 4px 0 2px; }',
  '.dtt-iu__tnode { min-width: 0; }',
  '.dtt-iu__trow { display: flex; align-items: baseline; gap: 6px; padding: 3px 6px;',
  '  border-radius: 10px; cursor: default;',
  '  transition: background-color .16s ease, transform .16s ease, box-shadow .16s ease, opacity .2s ease; }',
  '.dtt-iu__tnode[data-leaf="0"] > .dtt-iu__trow { cursor: pointer; }',
  '.dtt-iu__trow:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); transform: translateX(1px); }',
  '.dtt-iu__trow:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: -2px; }',
  '/* 箭头：恒为 ▸ 字符，展开态旋转 90° 即成 ▾ —— 旋转有过渡，换字符没有，故选旋转 */',
  '.dtt-iu__twist { flex: none; width: 12px; text-align: center; opacity: .55;',
  '  font-size: calc(10px * var(--iu-text-scale, 1)); transform-origin: 50% 50%;',
  '  transition: transform .22s cubic-bezier(.2,.8,.25,1), opacity .16s ease; }',
  '.dtt-iu__tnode[data-leaf="1"] > .dtt-iu__trow > .dtt-iu__twist { visibility: hidden; }',
  '.dtt-iu__tnode[data-leaf="0"][data-collapsed="0"] > .dtt-iu__trow > .dtt-iu__twist { transform: rotate(90deg); opacity: .85; }',
  '.dtt-iu__ticon { flex: none; font-size: calc(12px * var(--iu-text-scale, 1)); transform: translateY(1px); }',
  '.dtt-iu__tlabel { font-size: calc(12.5px * var(--iu-text-scale, 1)); font-weight: 500;',
  '  min-width: 0; overflow-wrap: anywhere; }',
  '.dtt-iu__tnode[data-leaf="0"] > .dtt-iu__trow > .dtt-iu__tlabel { font-weight: 600; }',
  '.dtt-iu__tnote { font-size: calc(11px * var(--iu-text-scale, 1)); opacity: .55;',
  '  min-width: 0; overflow-wrap: anywhere; }',
  '/* 子容器：子树出现时的轻入场（首帧 opacity .45 而非 0 —— 可见性不依赖动画） */',
  '.dtt-iu__tkids { margin-left: calc(12px * var(--iu-text-scale, 1)); padding-left: calc(10px * var(--iu-text-scale, 1));',
  '  border-left: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));',
  '  animation: dtt-iu-topen .24s ease both; }',
  '@keyframes dtt-iu-topen { from { opacity: .45; transform: translateY(-3px) } to { opacity: 1; transform: none } }',
  '.dtt-iu__tnode[data-depth="2"] > .dtt-iu__trow { opacity: .96; }',
  '.dtt-iu__tnode[data-depth="3"] > .dtt-iu__trow { opacity: .92; }',
  '.dtt-iu__tnode[data-depth="4"] > .dtt-iu__trow { opacity: .88; }',
  '.dtt-iu__tnode > .dtt-iu__trow:hover { opacity: 1; }',
  '/* 窄屏：缩进量减小，行距收紧 */',
  '@media (max-width: 480px) {',
  '  .dtt-iu__tkids { margin-left: calc(9px * var(--iu-text-scale, 1)); padding-left: calc(6px * var(--iu-text-scale, 1)); }',
  '  .dtt-iu__trow { gap: 4px; padding: 3px 4px; }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__tkids { animation: none; }',
  '  .dtt-iu__twist, .dtt-iu__trow { transition: none; }',
  '  .dtt-iu__trow:hover { transform: none; }',
  '}',
].join('\n')

export const treeKind: IuKind<TreeState, IuTreeSpec> = {
  kind: 'tree',
  label: '树形',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · tree 结构树：{"kind":"tree","title":"项目结构","desc":"点箭头折叠/展开","root":{"id":"src","label":"src","icon":"📁","children":[{"label":"client","icon":"📁","children":[{"label":"IuCard.tsx","icon":"📄","note":"卡片渲染器"},{"label":"kinds/","icon":"📄"}]},{"label":"host","icon":"📁","children":[{"label":"shot/","icon":"📄","note":"截图管线"}]},{"label":"package.json","icon":"📄"}]}}（约束：深度≤6、节点≤200、children 递归；id 缺省/重复时按路径下标如「0-2-1」自动唯一；折叠状态会记住）。',
}
