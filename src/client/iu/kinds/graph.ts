/**
 * iu kind: **graph**（流程图，坐标全自动布局）。
 *
 * 与旧 ```diagram 围栏的本质区别：模型只写**拓扑**（nodes + edges），分层 / 排序 /
 * 坐标 / 折线路径全部由本文件的 `layoutGraph()` 自动算出——布局算法是本 kind 的价值所在，
 * 也是唯一真相：Body（graph.body.tsx）与 snapshot() 共用同一份输出，
 * 两侧绝不允许各算各的坐标（同 gauge.ts 的 gaugeGeometry 纪律）。
 *
 * 算法（Sugiyama 风格的极简四步）：
 *  1. **分层**：Kahn 拓扑排序做最长路径分层（layer[v] = max(layer[u])+1）。
 *     防环：队列空了还有未处理节点（全在环里）时，按出现顺序强制入队一个继续松弛——
 *     每轮至少消化一个节点，必然终止、不死循环。孤立节点无入边 → layer 0（自成一列）。
 *  2. **层内排序**：初始按出现顺序，然后 3 轮重心迭代（barycenter：down-sweep 用前驱
 *     均值、up-sweep 用后继均值，稳定排序）减少边交叉；只统计相邻层之间的前向边，
 *     无相邻层邻居的节点重心 = 当前位置（保持不动）。
 *  3. **坐标**：节点尺寸固定（label ≤6 字宽 120 / 否则 160；高 44，diamond 56），
 *     层间距 TB 72 / LR 120，同层间距 32，每层对最宽层居中。
 *  4. **边路径**：正交折线 + 圆角（r=8；roundedPath 的纯函数版在本文件同源复刻，
 *     不 import DiagramCard.tsx——那是 React 文件，host 半身碰不得）。同一层对之间的
 *     多条边按「通道」错开水平段高度（比例 0.35~0.67），既减少线重叠也避免 label 压在一起；
 *     回边（to 的层 ≤ from 的层，环造成）从节点侧边出发、绕图形外侧走廊走，不穿任何节点。
 *     最后把所有点（含边 label 底色块）归一化进 viewBox，四周留 PAD，
 *     保证输出坐标全部落在 `0 0 vbW vbH` 内。
 *
 * ⚠ 本文件零 React、零 DOM（host 半身的截图管线要 import 它）。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { arr, boolOrFalse, esc, escAttr, oneOf, str, strOr } from './core.ts'

/* ------------------------------------------------------------------ */
/* 类型与常量                                                           */
/* ------------------------------------------------------------------ */

export type GraphDir = 'TB' | 'LR'
export type GraphShape = 'oval' | 'rect' | 'diamond'

export const GRAPH_DIRS = ['TB', 'LR'] as const
export const GRAPH_SHAPES = ['oval', 'rect', 'diamond'] as const

export interface IuGraphNode {
  readonly id: string
  readonly label: string
  readonly sub: string
  readonly shape: GraphShape
  readonly focal: boolean
}

export interface IuGraphEdge {
  readonly from: string
  readonly to: string
  readonly label: string
  readonly accent: boolean
  readonly dashed: boolean
}

export interface IuGraphSpec extends IuSpecBase {
  readonly kind: 'graph'
  readonly title: string
  readonly desc: string
  readonly dir: GraphDir
  readonly nodes: readonly IuGraphNode[]
  readonly edges: readonly IuGraphEdge[]
}

/** graph 的本地状态（持久化）：显示模式 + 点选的节点 id（可无）。 */
export interface GraphState extends IuState {
  readonly mode: 'fit' | 'large'
  readonly selected?: string | null | undefined
}

/** 视觉语言与 DiagramCard 同源（用户认可的骨架），focal/accent 走品牌橙。 */
const INK = 'var(--dsw-alias-label-primary, #2d3142)'
const MUTED = 'var(--dsw-alias-label-secondary, #4f5d75)'
const SOFT = 'var(--dsw-alias-label-tertiary, #7a8399)'
const PAPER = 'var(--dsw-alias-bg-layer-1, #ffffff)'
const STROKE = 'var(--dsw-alias-border-l2, rgba(127,127,127,.35))'
const BORDER = 'var(--dsw-alias-border-l3, rgba(127,127,127,.18))'
const BRAND = 'var(--dsw-alias-state-business-primary, #4176e6)'
const ACCENT = '#eb6c36'
const ACCENT_TINT = 'rgba(235,108,54,.10)'
const MONO = "'Geist Mono','PingFang SC','Microsoft YaHei',monospace"
const SANS = "'Geist','PingFang SC','Microsoft YaHei',sans-serif"

/** 布局常量（改这里 = 改整张图的节奏，Body / snapshot 自动跟随）。 */
const NODE_W_SHORT = 120
const NODE_W_LONG = 160
const NODE_H = 44
const NODE_H_DIAMOND = 56
const SIB_GAP = 32
const LAYER_GAP_TB = 72
const LAYER_GAP_LR = 120
/** 回边绕行走廊与图形内容边界的基准距离。 */
const DETOUR = 26
/** 回边多条时走廊的递进间距。 */
const DETOUR_STEP = 14
/** viewBox 四周留白（容纳箭头 marker、描边与边 label 底色块）。 */
const PAD = 18
/** 重心迭代轮数（2–4 轮足够小图收敛）。 */
const BARY_ROUNDS = 3
/** 同一层对之间的边最多错开几条通道。 */
const CHANNELS = 5
/** fit 模式允许的最小缩放比例（再窄就横向滚动，不让文字缩到不可读）。 */
const FIT_MIN_SCALE = 0.62

/* ------------------------------------------------------------------ */
/* 布局输出结构（Body 与 snapshot 逐字段消费同一份）                       */
/* ------------------------------------------------------------------ */

export interface GraphLayoutNode {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly cx: number
  readonly cy: number
  readonly shape: GraphShape
  readonly focal: boolean
  readonly label: string
  readonly sub: string
}

export interface GraphLayoutEdge {
  /** 已倒圆角的正交折线 path d。 */
  readonly path: string
  readonly label: string
  /** label 底色块的中心（label === '' 时无意义）。 */
  readonly labelX: number
  readonly labelY: number
  readonly accent: boolean
  readonly dashed: boolean
  /** 两端节点 id：Body 的 hover 联动（data-linked）要用，snapshot 同样带上保持结构一致。 */
  readonly from: string
  readonly to: string
}

export interface GraphLayout {
  readonly vbW: number
  readonly vbH: number
  readonly nodes: readonly GraphLayoutNode[]
  readonly edges: readonly GraphLayoutEdge[]
}

/** 一位小数（序列化进 SVG 属性，避免超长浮点尾巴）。 */
function r1(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * 折线倒圆角（r=8）：与 DiagramCard 的 roundedPath 同一算法的纯函数版
 * （那边住在 .tsx 里，本文件在 host 依赖链上不能 import，只能同源复刻）。
 */
export function graphRoundedPath(pts: ReadonlyArray<readonly [number, number]>, r: number): string {
  if (pts.length < 2) return ''
  const first = pts[0] as readonly [number, number]
  let d = 'M ' + first[0] + ' ' + first[1]
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1] as readonly [number, number]
    const cur = pts[i] as readonly [number, number]
    const next = pts[i + 1] as readonly [number, number]
    const v1x = cur[0] - prev[0]
    const v1y = cur[1] - prev[1]
    const v2x = next[0] - cur[0]
    const v2y = next[1] - cur[1]
    const l1 = Math.hypot(v1x, v1y) || 1
    const l2 = Math.hypot(v2x, v2y) || 1
    const rr = Math.min(r, l1 / 2, l2 / 2)
    const p1x = cur[0] - (v1x / l1) * rr
    const p1y = cur[1] - (v1y / l1) * rr
    const p2x = cur[0] + (v2x / l2) * rr
    const p2y = cur[1] + (v2y / l2) * rr
    d += ' L ' + p1x.toFixed(1) + ' ' + p1y.toFixed(1)
      + ' Q ' + cur[0] + ' ' + cur[1] + ' ' + p2x.toFixed(1) + ' ' + p2y.toFixed(1)
  }
  const last = pts[pts.length - 1] as readonly [number, number]
  return d + ' L ' + last[0] + ' ' + last[1]
}

/** 边 label 底色块的尺寸（Body 与 snapshot 共用，两侧块一样大）。 */
export function graphTagBox(label: string): { readonly w: number; readonly h: number } {
  return { w: Math.max(30, label.length * 11 + 12), h: 16 }
}

/**
 * 边 label 的底色块矩形 + 文字基线（Body 与 snapshot 共用同一份计算，两侧逐字一致）。
 * tx/ty 是 text 的 x 与基线 y（ty 在块中心略下方，视觉垂直居中）。
 */
export function graphTagRect(e: { readonly labelX: number; readonly labelY: number; readonly label: string }): {
  readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly tx: number; readonly ty: number
} {
  const box = graphTagBox(e.label)
  return {
    x: r1(e.labelX - box.w / 2), y: r1(e.labelY - box.h / 2), w: box.w, h: box.h,
    tx: r1(e.labelX), ty: r1(e.labelY + 3.5),
  }
}

/** diamond 四顶点（上→右→下→左）。 */
export function graphDiamondPoints(nd: GraphLayoutNode): string {
  return `${nd.cx},${nd.y} ${nd.x + nd.w},${nd.cy} ${nd.cx},${nd.y + nd.h} ${nd.x},${nd.cy}`
}

/** rect / oval 的圆角半径。 */
export function graphNodeRx(nd: GraphLayoutNode): number {
  return nd.shape === 'oval' ? Math.min(20, nd.h / 2) : 6
}

/**
 * 节点文字的基线位置。有 sub 时主标签上移、副标签落下方；
 * diamond 不画 sub（对角线腹腔放不下两行，与 DiagramCard 同规则）。
 */
export function graphTextYs(nd: GraphLayoutNode): { readonly labelY: number; readonly subY: number | undefined } {
  if (nd.sub !== '' && nd.shape !== 'diamond') {
    return { labelY: r1(nd.cy - 4), subY: r1(nd.cy + 11) }
  }
  return { labelY: r1(nd.cy + 4.5), subY: undefined }
}

export interface GraphLegendItem {
  readonly kind: 'oval' | 'diamond' | 'focal'
  readonly label: string
}

/** LEGEND 条目：只有图里真的出现 oval / diamond / focal 才画（参照 DiagramCard）。 */
export function graphLegendItems(spec: IuGraphSpec): GraphLegendItem[] {
  const items: GraphLegendItem[] = []
  const shapes = new Set(spec.nodes.map(nd => nd.shape))
  if (shapes.has('oval')) items.push({ kind: 'oval', label: 'START/END' })
  if (shapes.has('diamond')) items.push({ kind: 'diamond', label: 'DECIDE' })
  if (spec.nodes.some(nd => nd.focal)) items.push({ kind: 'focal', label: 'FOCAL' })
  return items
}

/**
 * svg 的内联尺寸样式（Body 与 snapshot 共用同一份计算）。
 *
 * fit：贴卡宽但不放大超过 1:1（max-width = vbW），也不缩到不可读
 *      （min-width = vbW × FIT_MIN_SCALE，比容器窄时由 wrap 横向滚动）；
 * large：由高度驱动放大，横向滚动看图。
 */
export function graphSvgStyle(lay: GraphLayout, mode: 'fit' | 'large'): { readonly maxWidth: string; readonly minWidth: string } {
  if (mode === 'large') return { maxWidth: 'none', minWidth: '0' }
  return { maxWidth: `${lay.vbW}px`, minWidth: `${Math.ceil(lay.vbW * FIT_MIN_SCALE)}px` }
}

/* ------------------------------------------------------------------ */
/* 自动布局（本 kind 的灵魂；纯函数，Body 与 snapshot 共用）                */
/* ------------------------------------------------------------------ */

type Pt = readonly [number, number]

interface RawEdge {
  readonly fi: number
  readonly ti: number
  readonly label: string
  readonly accent: boolean
  readonly dashed: boolean
}

interface EdgeGeom {
  readonly pts: Pt[]
  readonly labelX: number
  readonly labelY: number
}

export function layoutGraph(spec: IuGraphSpec): GraphLayout {
  const nodes = spec.nodes
  const n = nodes.length
  const lr = spec.dir === 'LR'

  const idxOf = new Map<string, number>()
  for (let i = 0; i < n; i += 1) idxOf.set(nodes[i].id, i)

  const W: number[] = []
  const H: number[] = []
  for (const nd of nodes) {
    W.push(nd.label.length <= 6 ? NODE_W_SHORT : NODE_W_LONG)
    H.push(nd.shape === 'diamond' ? NODE_H_DIAMOND : NODE_H)
  }

  // 防御：自环（from===to）与指向不存在节点的边在 parse 已丢弃，这里再滤一次——
  // layoutGraph 是导出函数，不能假设调用方一定走过 parse。
  const redges: RawEdge[] = []
  for (const e of spec.edges) {
    const fi = idxOf.get(e.from)
    const ti = idxOf.get(e.to)
    if (fi === undefined || ti === undefined || fi === ti) continue
    redges.push({ fi, ti, label: e.label, accent: e.accent, dashed: e.dashed })
  }

  /* ---- 1. 分层：Kahn 拓扑 + 最长路径松弛 ---- */
  const layer = new Array<number>(n).fill(0)
  const indeg = new Array<number>(n).fill(0)
  const outs: number[][] = Array.from({ length: n }, () => [])
  for (const e of redges) {
    outs[e.fi].push(e.ti)
    indeg[e.ti] += 1
  }
  const done = new Array<boolean>(n).fill(false)
  const queue: number[] = []
  for (let i = 0; i < n; i += 1) if (indeg[i] === 0) queue.push(i)
  let remaining = n
  while (remaining > 0) {
    if (queue.length === 0) {
      // 环：剩余节点的 indeg 永远减不到 0。按出现顺序强制入队一个（它的 layer 已被
      // 环外前驱松弛过，没有就是 0），继续处理它的出边。每轮至少消化一个节点 → 必然终止。
      let pick = -1
      for (let i = 0; i < n; i += 1) if (!done[i]) { pick = i; break }
      if (pick < 0) break
      queue.push(pick)
    }
    const u = queue.shift() as number
    if (done[u]) continue
    done[u] = true
    remaining -= 1
    for (const v of outs[u]) {
      if (!done[v] && layer[v] < layer[u] + 1) layer[v] = layer[u] + 1
      indeg[v] -= 1
      if (indeg[v] <= 0 && !done[v]) queue.push(v)
    }
  }

  /* ---- 2. 层内排序：出现顺序打底 + 重心迭代减交叉 ---- */
  const layerCount = layer.reduce((m, l) => Math.max(m, l), 0) + 1
  const layers: number[][] = []
  for (let L = 0; L < layerCount; L += 1) layers.push([])
  for (let i = 0; i < n; i += 1) layers[layer[i]].push(i)

  const pos = new Array<number>(n).fill(0)
  const refresh = (L: number): void => {
    layers[L].forEach((ni, k) => { pos[ni] = k })
  }
  for (let L = 0; L < layerCount; L += 1) refresh(L)

  // 重心只看「相邻层之间的前向边」：跨层长边与回边不提供排序信号。
  const preds: number[][] = Array.from({ length: n }, () => [])
  const succs: number[][] = Array.from({ length: n }, () => [])
  for (const e of redges) {
    if (layer[e.ti] === layer[e.fi] + 1) {
      succs[e.fi].push(e.ti)
      preds[e.ti].push(e.fi)
    }
  }
  const sortByBary = (L: number, use: 'preds' | 'succs'): void => {
    const row = layers[L]
    if (row.length < 2) return
    const adj = use === 'preds' ? preds : succs
    const target = use === 'preds' ? L - 1 : L + 1
    const keyed = row.map((ni, k) => {
      const ns = adj[ni].filter(a => layer[a] === target)
      // 无相邻层邻居（孤立节点 / 只连回边）：重心 = 当前位置，保持不动。
      const bc = ns.length > 0 ? ns.reduce((s, a) => s + pos[a], 0) / ns.length : pos[ni]
      return { ni, bc, k }
    })
    keyed.sort((a, b) => (a.bc - b.bc) || (a.k - b.k))
    layers[L] = keyed.map(it => it.ni)
    refresh(L)
  }
  for (let round = 0; round < BARY_ROUNDS; round += 1) {
    for (let L = 1; L < layerCount; L += 1) sortByBary(L, 'preds')
    for (let L = layerCount - 2; L >= 0; L -= 1) sortByBary(L, 'succs')
  }

  /* ---- 3. 坐标：主轴 = 层方向，交叉轴 = 层内铺开、整体居中 ---- */
  const xs = new Array<number>(n).fill(0)
  const ys = new Array<number>(n).fill(0)
  const layerGap = lr ? LAYER_GAP_LR : LAYER_GAP_TB
  if (!lr) {
    const rowW = layers.map(row =>
      row.reduce((s, ni) => s + W[ni], 0) + SIB_GAP * Math.max(0, row.length - 1))
    const totalW = rowW.reduce((m, w) => Math.max(m, w), 0)
    let cursor = 0
    for (let L = 0; L < layerCount; L += 1) {
      const row = layers[L]
      const rowH = row.reduce((m, ni) => Math.max(m, H[ni]), 0)
      let x0 = (totalW - rowW[L]) / 2
      for (const ni of row) {
        xs[ni] = x0
        ys[ni] = cursor + (rowH - H[ni]) / 2
        x0 += W[ni] + SIB_GAP
      }
      cursor += rowH + layerGap
    }
  } else {
    const colH = layers.map(row =>
      row.reduce((s, ni) => s + H[ni], 0) + SIB_GAP * Math.max(0, row.length - 1))
    const totalH = colH.reduce((m, h) => Math.max(m, h), 0)
    let cursor = 0
    for (let L = 0; L < layerCount; L += 1) {
      const row = layers[L]
      const colW = row.reduce((m, ni) => Math.max(m, W[ni]), 0)
      let y0 = (totalH - colH[L]) / 2
      for (const ni of row) {
        ys[ni] = y0
        xs[ni] = cursor + (colW - W[ni]) / 2
        y0 += H[ni] + SIB_GAP
      }
      cursor += colW + layerGap
    }
  }

  /* ---- 4. 边折线（局部坐标）+ 全局 bbox ---- */
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const eat = (px: number, py: number): void => {
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  for (let i = 0; i < n; i += 1) {
    eat(xs[i], ys[i])
    eat(xs[i] + W[i], ys[i] + H[i])
  }
  const nodesRight = maxX
  const nodesBottom = maxY

  // 通道分配：同一「层对」/同一「回边组」内的第 k 条边错开走线，减少线重叠与 label 压线。
  const channelCount = new Map<string, number>()
  const geoms: EdgeGeom[] = []
  for (const e of redges) {
    const s = e.fi
    const t = e.ti
    const scx = xs[s] + W[s] / 2
    const scy = ys[s] + H[s] / 2
    const tcx = xs[t] + W[t] / 2
    const tcy = ys[t] + H[t] / 2
    const back = layer[t] <= layer[s]
    const key = back ? 'back' : `${layer[s]}>${layer[t]}`
    const ch = (channelCount.get(key) ?? 0) % CHANNELS
    channelCount.set(key, (channelCount.get(key) ?? 0) + 1)
    const box = e.label !== '' ? graphTagBox(e.label) : undefined
    let pts: Pt[]
    let labelX = 0
    let labelY = 0
    if (!lr) {
      if (!back) {
        const sy = ys[s] + H[s]
        const ty = ys[t]
        const gap = Math.max(24, ty - sy)
        const midY = sy + gap * (0.36 + ch * 0.07)
        if (Math.abs(scx - tcx) < 0.5) {
          // 同列直落
          pts = [[scx, sy], [tcx, ty]]
          labelX = scx + (box !== undefined ? box.w / 2 + 8 : 0)
          labelY = midY
        } else {
          // 底边中点 ↓ 层间通道 → 平移到目标列 ↓ 顶边中点
          pts = [[scx, sy], [scx, midY], [tcx, midY], [tcx, ty]]
          labelX = (scx + tcx) / 2
          labelY = midY - 11
        }
      } else {
        // 回边：从源右侧出发，绕图形右外侧走廊，水平进目标右侧
        const routeX = nodesRight + DETOUR + ch * DETOUR_STEP
        const sxr = xs[s] + W[s]
        const txr = xs[t] + W[t]
        pts = [[sxr, scy], [routeX, scy], [routeX, tcy], [txr, tcy]]
        labelX = (sxr + routeX) / 2
        labelY = scy - 11
      }
    } else if (!back) {
      const sx = xs[s] + W[s]
      const tx = xs[t]
      const gap = Math.max(24, tx - sx)
      const midX = sx + gap * (0.36 + ch * 0.07)
      if (Math.abs(scy - tcy) < 0.5) {
        pts = [[sx, scy], [tx, tcy]]
        labelX = midX
        labelY = scy - 11
      } else {
        pts = [[sx, scy], [midX, scy], [midX, tcy], [tx, tcy]]
        labelX = midX + (box !== undefined ? box.w / 2 + 6 : 0)
        labelY = (scy + tcy) / 2
      }
    } else {
      // LR 回边：绕图形下外侧走廊
      const routeY = nodesBottom + DETOUR + ch * DETOUR_STEP
      const syb = ys[s] + H[s]
      const tyb = ys[t] + H[t]
      pts = [[scx, syb], [scx, routeY], [tcx, routeY], [tcx, tyb]]
      labelX = (scx + tcx) / 2
      labelY = routeY + 11
    }
    for (const p of pts) eat(p[0], p[1])
    if (box !== undefined) {
      eat(labelX - box.w / 2, labelY - box.h / 2)
      eat(labelX + box.w / 2, labelY + box.h / 2)
    }
    geoms.push({ pts, labelX, labelY })
  }

  /* ---- 5. 归一化进 viewBox：整体平移到 (PAD, PAD) 起点 ---- */
  const dx = PAD - minX
  const dy = PAD - minY
  const vbW = Math.max(1, r1(maxX - minX + PAD * 2))
  const vbH = Math.max(1, r1(maxY - minY + PAD * 2))

  const outNodes: GraphLayoutNode[] = nodes.map((nd, i) => {
    const x = r1(xs[i] + dx)
    const y = r1(ys[i] + dy)
    const w = W[i]
    const h = H[i]
    return {
      id: nd.id, x, y, w, h,
      cx: r1(x + w / 2), cy: r1(y + h / 2),
      shape: nd.shape, focal: nd.focal, label: nd.label, sub: nd.sub,
    }
  })
  const outEdges: GraphLayoutEdge[] = redges.map((e, i) => {
    const g = geoms[i] as EdgeGeom
    const pts = g.pts.map(p => [r1(p[0] + dx), r1(p[1] + dy)] as [number, number])
    return {
      path: graphRoundedPath(pts, 8),
      label: e.label,
      labelX: r1(g.labelX + dx),
      labelY: r1(g.labelY + dy),
      accent: e.accent,
      dashed: e.dashed,
      from: nodes[e.fi].id,
      to: nodes[e.ti].id,
    }
  })
  return { vbW, vbH, nodes: outNodes, edges: outEdges }
}

/* ------------------------------------------------------------------ */
/* kind 模块                                                            */
/* ------------------------------------------------------------------ */

function parse(raw: Record<string, unknown>): IuGraphSpec | undefined {
  const dir = oneOf<GraphDir>(raw.dir, GRAPH_DIRS, 'TB')

  // 节点：id 唯一（重复自动加后缀 -2/-3…；后缀前先截断，保证总长 ≤16，不会死循环）
  const nodes: IuGraphNode[] = []
  const ids = new Set<string>()
  for (const item of arr(raw.nodes)) {
    if (nodes.length >= 16) break
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    let id = str(o.id, 16)
    if (id === '') id = `n${nodes.length + 1}`
    let uid = id
    for (let k = 2; ids.has(uid); k += 1) uid = `${id.slice(0, 12)}-${k}`
    ids.add(uid)
    nodes.push({
      id: uid,
      label: strOr(o.label, 14, uid.slice(0, 14)),
      sub: str(o.sub, 24),
      shape: oneOf<GraphShape>(o.shape, GRAPH_SHAPES, 'rect'),
      focal: boolOrFalse(o.focal),
    })
  }
  // 只有 0/1 个节点 → 画不出「流程」，整卡不合格回退代码块
  if (nodes.length < 2) return undefined

  // 边：from/to 必须指向存在的节点；自环（from===to）与重复边丢弃
  const edges: IuGraphEdge[] = []
  const seen = new Set<string>()
  let hadRaw = false
  let resolvable = 0
  for (const item of arr(raw.edges)) {
    if (typeof item !== 'object' || item === null) continue
    hadRaw = true
    const o = item as Record<string, unknown>
    const from = str(o.from, 16)
    const to = str(o.to, 16)
    if (!ids.has(from) || !ids.has(to)) continue
    resolvable += 1
    if (edges.length >= 24 || from === to) continue
    const key = `${from}\u0000${to}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({
      from, to,
      label: str(o.label, 8),
      accent: boolOrFalse(o.accent),
      dashed: boolOrFalse(o.dashed),
    })
  }
  // 模型写了边但引用**全部**无效 → 说明拓扑是坏的，整卡不合格（回退代码块）。
  // 注意：全是自环 / 全是重复边不算坏（resolvable > 0），只是这些边被丢弃。
  if (hadRaw && resolvable === 0) return undefined

  return {
    kind: 'graph',
    title: strOr(raw.title, 40, '流程图'),
    desc: str(raw.desc, 80),
    dir,
    nodes,
    edges,
  }
}

function initState(_spec: IuGraphSpec): GraphState {
  return { mode: 'fit' }
}

function fillText(spec: IuGraphSpec, _state: GraphState): string {
  const focal = spec.nodes.find(nd => nd.focal)
  return `${spec.title}：${spec.nodes.length} 个节点、${spec.edges.length} 条边`
    + (focal !== undefined ? `，重点「${focal.label}」` : '')
}

/* ------------------------------------------------------------------ */
/* 静态快照（结构与 graph.body.tsx 逐字对齐：desc → tools → wrap(svg) → legend） */
/* ------------------------------------------------------------------ */

const SNAP_MARKER = 'iu-g-arr'
const SNAP_MARKER_A = 'iu-g-arr-a'

function snapEdge(e: GraphLayoutEdge): string {
  const marker = e.accent ? SNAP_MARKER_A : SNAP_MARKER
  const path = `<path class="dtt-iu__gedge" d="${escAttr(e.path)}"`
    + (e.accent ? ' data-accent="1"' : '')
    + (e.dashed ? ' data-dashed="1"' : '')
    + ` data-from="${escAttr(e.from)}" data-to="${escAttr(e.to)}"`
    + ` marker-end="url(#${marker})"/>`
  if (e.label === '') return path
  const box = graphTagBox(e.label)
  return path
    + `<g class="dtt-iu__gedgelabel">`
    + `<rect class="dtt-iu__gtagbg" x="${r1(e.labelX - box.w / 2)}" y="${r1(e.labelY - box.h / 2)}" width="${box.w}" height="${box.h}" rx="3"/>`
    + `<text class="dtt-iu__gtag" x="${e.labelX}" y="${r1(e.labelY + 4)}">${esc(e.label)}</text>`
    + `</g>`
}

function snapNode(nd: GraphLayoutNode): string {
  const ty = graphTextYs(nd)
  const shape = nd.shape === 'diamond'
    ? `<polygon points="${graphDiamondPoints(nd)}"/>`
    : `<rect x="${nd.x}" y="${nd.y}" width="${nd.w}" height="${nd.h}" rx="${graphNodeRx(nd)}"/>`
  const sub = ty.subY !== undefined
    ? `<text class="dtt-iu__gsub" x="${nd.cx}" y="${ty.subY}">${esc(nd.sub)}</text>`
    : ''
  return `<g class="dtt-iu__gnode" data-id="${escAttr(nd.id)}" data-shape="${nd.shape}"`
    + ` data-focal="${nd.focal ? '1' : '0'}" data-selected="0" tabindex="0" role="button"`
    + ` aria-label="${escAttr(nd.label)}">`
    + shape
    + `<text class="dtt-iu__glabel" x="${nd.cx}" y="${ty.labelY}">${esc(nd.label)}</text>`
    + sub
    + `</g>`
}

function snapLegendItem(it: GraphLegendItem): string {
  const shape = it.kind === 'diamond'
    ? `<polygon class="dtt-iu__glegshape" points="20,2 37,10 20,18 3,10"/>`
    : `<rect class="dtt-iu__glegshape"${it.kind === 'focal' ? ' data-focal="1"' : ''}`
      + ` x="3" y="3" width="34" height="14" rx="${it.kind === 'oval' ? 7 : 4}"/>`
  return `<span class="dtt-iu__gleg"><svg viewBox="0 0 40 20" aria-hidden="true">${shape}</svg>`
    + `<i>${esc(it.label)}</i></span>`
}

/** 初始状态定格：mode=fit、无 selected、无 hover（所以不带 data-hover / data-linked）。 */
function snapshot(spec: IuGraphSpec): string {
  const lay = layoutGraph(spec)
  const style = graphSvgStyle(lay, 'fit')
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  const tools = `<div class="dtt-iu__graph-tools">`
    + `<button type="button" class="dtt-iu__graph-pill" data-active="1">适应</button>`
    + `<button type="button" class="dtt-iu__graph-pill">放大</button>`
    + `</div>`
  const defs = `<defs>`
    + `<marker id="${SNAP_MARKER}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">`
    + `<polygon class="dtt-iu__garrow" points="0 0, 8 3, 0 6"/></marker>`
    + `<marker id="${SNAP_MARKER_A}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">`
    + `<polygon class="dtt-iu__garrow-a" points="0 0, 8 3, 0 6"/></marker>`
    + `</defs>`
  const body = `<g class="dtt-iu__gedges">${lay.edges.map(snapEdge).join('')}</g>`
    + `<g class="dtt-iu__gnodes">${lay.nodes.map(snapNode).join('')}</g>`
  const wrap = `<div class="dtt-iu__graph-wrap">`
    + `<svg class="dtt-iu__graph" data-mode="fit" viewBox="0 0 ${lay.vbW} ${lay.vbH}"`
    + ` style="max-width:${style.maxWidth};min-width:${style.minWidth}"`
    + ` role="img" aria-label="${escAttr(spec.title)}">${defs}${body}</svg></div>`
  const items = graphLegendItems(spec)
  const legend = items.length > 0
    ? `<div class="dtt-iu__graph-legend">${items.map(snapLegendItem).join('')}</div>`
    : ''
  return desc + tools + wrap + legend
}

const CSS = [
  '/* graph：流程图（坐标由 graph.ts 的 layoutGraph 全自动算出）。',
  '   结构：desc → tools（fit/large pill）→ wrap（滚动容器）> svg → legend。',
  '   动画纪律：入场 keyframes 只有 from 帧（opacity .5 + 位移 5px），隐式 to = 默认可见态，',
  '   所以动画被关（reduced-motion / 无头截图）时内容照常完整可见。 */',
  '.dtt-iu__graph-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 6px 0 8px; }',
  '.dtt-iu__graph-pill { border: 1px solid ' + BORDER + '; background: transparent; color: inherit;',
  '  font: inherit; font-size: calc(11.5px * var(--iu-text-scale, 1)); border-radius: 999px;',
  '  padding: 2px 11px; cursor: pointer; opacity: .58; line-height: 1.7; white-space: nowrap;',
  '  transition: opacity .18s ease, background-color .18s ease, transform .18s ease, border-color .18s ease, color .18s ease; }',
  '.dtt-iu__graph-pill:hover { opacity: 1; transform: translateY(-1px); }',
  '.dtt-iu__graph-pill:active { transform: translateY(0) scale(.95); }',
  '.dtt-iu__graph-pill[data-active] { opacity: 1; font-weight: 600; color: ' + BRAND + ';',
  '  border-color: color-mix(in srgb, ' + BRAND + ' 55%, transparent);',
  '  background: color-mix(in srgb, ' + BRAND + ' 12%, transparent); }',

  /* 容器与两种显示模式：fit 贴卡宽（max/min-width 由 graphSvgStyle 内联给出，过窄时
     wrap 横向滚动）；large 由高度驱动放大、横向滚动看图。 */
  '.dtt-iu__graph-wrap { overflow-x: auto; overflow-y: hidden; border: 1px solid ' + BORDER + ';',
  '  border-radius: 10px; padding: 6px; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.02)); }',
  '.dtt-iu__graph { display: block; width: 100%; height: auto; margin: 0 auto; }',
  '.dtt-iu__graph[data-mode="large"] { width: auto; height: min(72vh, 560px); }',

  /* 边 */
  '.dtt-iu__gedge { fill: none; stroke: ' + MUTED + '; stroke-width: 1.3; stroke-linecap: round;',
  '  transition: opacity .18s ease, stroke-width .18s ease, stroke .18s ease; }',
  '.dtt-iu__gedge[data-accent] { stroke: ' + ACCENT + '; stroke-width: 1.7; }',
  '.dtt-iu__gedge[data-dashed] { stroke-dasharray: 5 4; }',
  '.dtt-iu__garrow { fill: ' + MUTED + '; }',
  '.dtt-iu__garrow-a { fill: ' + ACCENT + '; }',
  '.dtt-iu__gedgelabel { transition: opacity .18s ease; filter: drop-shadow(0 1px 2px rgba(0,0,0,.08)); }',
  '.dtt-iu__gtagbg { fill: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); stroke: var(--dsw-alias-border-l3, rgba(127,127,127,.18)); stroke-width: .6; }',
  '.dtt-iu__gtag { font-family: ' + MONO + '; font-size: calc(10px * var(--iu-text-scale, 1));',
  '  fill: ' + SOFT + '; text-anchor: middle; }',

  /* 节点 */
  '.dtt-iu__gnode { cursor: pointer; transition: opacity .18s ease, transform .18s ease; }',
  '.dtt-iu__gnode > rect, .dtt-iu__gnode > polygon { fill: ' + PAPER + '; stroke: ' + STROKE + ';',
  '  stroke-width: 1; transition: stroke .2s ease, fill .2s ease, stroke-width .2s ease; }',
  '.dtt-iu__gnode[data-focal="1"] > rect, .dtt-iu__gnode[data-focal="1"] > polygon {',
  '  fill: ' + ACCENT_TINT + '; stroke: ' + ACCENT + '; stroke-width: 1.6; }',
  '.dtt-iu__gnode[data-selected="1"] > rect, .dtt-iu__gnode[data-selected="1"] > polygon {',
  '  stroke: ' + BRAND + '; stroke-width: 2; }',
  '.dtt-iu__gnode:hover { transform: translateY(-1.5px);',
  '  filter: drop-shadow(0 3px 6px color-mix(in srgb, var(--dsw-alias-label-primary, #2d3142) 18%, transparent)); }',
  '.dtt-iu__gnode:hover > rect, .dtt-iu__gnode:hover > polygon { stroke: ' + BRAND + '; }',
  '.dtt-iu__gnode:focus-visible { outline: none; }',
  '.dtt-iu__gnode:focus-visible > rect, .dtt-iu__gnode:focus-visible > polygon {',
  '  stroke: ' + BRAND + '; stroke-width: 2; stroke-dasharray: 4 3; }',
  '.dtt-iu__glabel { font-family: ' + SANS + '; font-size: calc(12.5px * var(--iu-text-scale, 1)); letter-spacing: -.01em;',
  '  font-weight: 600; fill: ' + INK + '; text-anchor: middle; }',
  '.dtt-iu__gsub { font-family: ' + MONO + '; font-size: calc(9.5px * var(--iu-text-scale, 1)); opacity: .85;',
  '  fill: ' + SOFT + '; text-anchor: middle; }',

  /* hover 联动：Body 给相连的节点/边打 data-linked，其余淡出（纯属性选择器，实现简单可靠） */
  '.dtt-iu__graph[data-hover="1"] .dtt-iu__gnode:not([data-linked="1"]) { opacity: .28; }',
  '.dtt-iu__graph[data-hover="1"] .dtt-iu__gedge:not([data-linked="1"]),',
  '.dtt-iu__graph[data-hover="1"] .dtt-iu__gedgelabel:not([data-linked="1"]) { opacity: .12; }',
  '.dtt-iu__gedge[data-linked="1"] { stroke-width: 2.2; }',

  /* LEGEND */
  '.dtt-iu__graph-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 12px;',
  '  margin-top: 8px; padding: 0 2px; }',
  '.dtt-iu__gleg { display: inline-flex; align-items: center; gap: 6px; opacity: .62;',
  '  font-size: calc(10px * var(--iu-text-scale, 1)); letter-spacing: .08em;',
  '  transition: opacity .2s ease; }',
  '.dtt-iu__gleg:hover { opacity: 1; }',
  '.dtt-iu__gleg svg { display: block; width: 26px; height: 13px; }',
  '.dtt-iu__gleg i { font-style: normal; font-family: ' + MONO + '; }',
  '.dtt-iu__glegshape { fill: ' + PAPER + '; stroke: ' + STROKE + '; stroke-width: 1.4; }',
  '.dtt-iu__glegshape[data-focal="1"] { fill: ' + ACCENT_TINT + '; stroke: ' + ACCENT + '; stroke-width: 2; }',

  /* 入场淡入：from 帧起点 opacity .5，终态 = 默认可见（可见性不依赖动画） */
  '@keyframes dtt-iu-graph-in { from { opacity: .5; transform: translateY(5px); } }',
  '.dtt-iu__gnode { animation: dtt-iu-graph-in .45s cubic-bezier(.25,.8,.35,1) backwards; }',
  '.dtt-iu__gedge, .dtt-iu__gedgelabel { animation: dtt-iu-graph-in .5s ease .1s backwards; }',

  /* 深色主题：focal 淡橙底加深一点、label 底色块跟层 2 底色 */
  'body[data-ds-dark-theme] .dtt-iu__gnode[data-focal="1"] > rect,',
  'body[data-ds-dark-theme] .dtt-iu__gnode[data-focal="1"] > polygon { fill: rgba(235,108,54,.18); }',
  'body[data-ds-dark-theme] .dtt-iu__gtagbg { fill: var(--dsw-alias-bg-layer-2, #2b2e38); }',
  'body[data-ds-dark-theme] .dtt-iu__glegshape[data-focal="1"] { fill: rgba(235,108,54,.18); }',

  /* 无障碍：关掉动画与位移；高亮/淡出是属性态（非动画），关掉后照样生效 */
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__gnode, .dtt-iu__gedge, .dtt-iu__gedgelabel { animation: none; }',
  '  .dtt-iu__graph-pill, .dtt-iu__gnode, .dtt-iu__gedge, .dtt-iu__gedgelabel, .dtt-iu__gleg,',
  '  .dtt-iu__gnode > rect, .dtt-iu__gnode > polygon { transition: none; }',
  '  .dtt-iu__gnode:hover { transform: none; }',
  '  .dtt-iu__graph-pill:hover, .dtt-iu__graph-pill:active { transform: none; }',
  '}',
].join('\n')

export const graphKind: IuKind<GraphState, IuGraphSpec> = {
  kind: 'graph',
  label: '流程图',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · graph 流程图：{"kind":"graph","title":"订单处理","desc":"从下单到发货","dir":"TB","nodes":[{"id":"start","label":"下单","shape":"oval"},{"id":"check","label":"库存检查","shape":"diamond"},{"id":"pay","label":"等待支付","sub":"超时30分钟自动取消"},{"id":"ship","label":"发货","focal":true},{"id":"oos","label":"缺货登记"},{"id":"done","label":"完成","shape":"oval"}],"edges":[{"from":"start","to":"check"},{"from":"check","to":"pay","label":"有货"},{"from":"check","to":"oos","label":"缺货","dashed":true},{"from":"pay","to":"ship","label":"已支付","accent":true},{"from":"oos","to":"ship"},{"from":"ship","to":"done"}]}（约束：nodes≤16、edges≤24、dir=TB|LR、shape=oval|rect|diamond、focal 高亮、**坐标全自动不用给**；边可选 label≤8字 / accent 橙线 / dashed 虚线，判断分支务必标 label）。',
}
