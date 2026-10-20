/**
 * dsh-chat-plus — diagram 围栏解析（对话流内嵌 SVG 流程图）。
 *
 * 与 proto-tabs 同通道：正文 markdown 里的 diagram 代码围栏 → DiagramCard。
 * 首批只实现 flowchart（起止 oval / 步骤 rect / 判断 diamond，正交圆角连线）。
 * 坐标由写围栏的模型直接给出（/4 网格），解析只做校验 + 钳制 + 截断，
 * 绝不抛错：非法结构一律回退原文。
 *
 * JSON 格式：
 * {type: 'flowchart', title, desc,
 *  nodes: [{id, shape: 'oval'|'rect'|'diamond', x, y, w, h, name, sub, focal}],
 *  edges: [{from, to, label, accent, pts: [[x,y], ...]}]}
 */

import { openFenceTail } from '../../shared/fence-scan.ts'

export type DiagramShape = 'oval' | 'rect' | 'diamond'

export interface DiagramNode {
  readonly id: string
  readonly shape: DiagramShape
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly name: string
  readonly sub: string
  readonly focal: boolean
}

export interface DiagramEdge {
  readonly from: string
  readonly to: string
  readonly label: string
  readonly accent: boolean
  readonly pts: ReadonlyArray<readonly [number, number]>
}

export interface DiagramSpec {
  readonly title: string
  readonly desc: string
  readonly size: 'full' | 'compact'
  readonly nodes: readonly DiagramNode[]
  readonly edges: readonly DiagramEdge[]
}

export type DiagramPart =
  | { readonly kind: 'md'; readonly text: string }
  /**
   * 流程图卡片。
   *
   * `pending` 区分「流式期还在写」与「已写完」，与 html / iu 同一套语义：
   *  · pending=true  → 围栏未闭合，只渲染占位，不解析半截 JSON；
   *  · pending=false → 围栏已闭合，渲染真正的 SVG。
   *
   * 两种状态共用同一个 part kind，调用方的 React key 因此在闭合那一刻保持不变，
   * 卡片是「从占位原地变成真身」而不是卸载重建。
   */
  | { readonly kind: 'diagram'; readonly spec?: DiagramSpec; readonly pending: boolean; readonly bytes?: number }

const TICK = String.fromCharCode(96)
const FENCE = new RegExp(TICK.repeat(3) + 'diagram' + '\\s*\\n([\\s\\S]*?)' + TICK.repeat(3), 'g')

const MAX_NODES = 9
const MAX_EDGES = 12
const VW = 800
const VH = 1000

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  return t.length > max ? t.slice(0, max) : t
}

function asSpec(raw: unknown): DiagramSpec | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  if (obj.type !== 'flowchart') return undefined
  const rawNodes = obj.nodes
  const rawEdges = obj.edges
  if (!Array.isArray(rawNodes) || rawNodes.length === 0 || rawNodes.length > MAX_NODES) return undefined
  if (!Array.isArray(rawEdges) || rawEdges.length > MAX_EDGES) return undefined
  const nodes: DiagramNode[] = []
  const ids = new Set<string>()
  for (const item of rawNodes) {
    if (typeof item !== 'object' || item === null) return undefined
    const it = item as Record<string, unknown>
    if (typeof it.id !== 'string' || it.id === '' || ids.has(it.id)) return undefined
    if (it.shape !== 'oval' && it.shape !== 'rect' && it.shape !== 'diamond') return undefined
    ids.add(it.id)
    nodes.push({
      id: it.id,
      shape: it.shape,
      x: num(it.x, 0, VW, 0),
      y: num(it.y, 0, VH, 0),
      w: num(it.w, 40, 400, 160),
      h: num(it.h, 32, 200, 56),
      name: str(it.name, 14),
      sub: str(it.sub, 24),
      focal: it.focal === true,
    })
  }
  const edges: DiagramEdge[] = []
  for (const item of rawEdges) {
    if (typeof item !== 'object' || item === null) return undefined
    const it = item as Record<string, unknown>
    if (typeof it.from !== 'string' || typeof it.to !== 'string') return undefined
    if (!ids.has(it.from) || !ids.has(it.to)) return undefined
    const pts: Array<readonly [number, number]> = []
    if (Array.isArray(it.pts)) {
      for (const p of it.pts) {
        if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return undefined
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return undefined
        pts.push([Math.min(VW, Math.max(0, p[0])), Math.min(VH, Math.max(0, p[1]))])
      }
    }
    if (pts.length < 2 || pts.length > 8) return undefined
    edges.push({
      from: it.from,
      to: it.to,
      label: str(it.label, 8),
      accent: it.accent === true,
      pts,
    })
  }
  return {
    title: str(obj.title, 40) || '流程图',
    desc: str(obj.desc, 80),
    size: obj.size === 'compact' ? 'compact' : 'full',
    nodes,
    edges,
  }
}

/**
 * 把 text 切成 markdown 片段与 diagram 卡片；无围栏返回整段 md。
 *
 * @param streaming 是否处于流式输出中。true 时末尾未闭合的 ```diagram 会产出一个
 *   pending 占位卡片；false（已定稿）时未闭合围栏原样当代码块显示——被截断的
 *   历史消息不该永远停在「正在绘制」。
 */
export function splitDiagram(text: string, streaming = false): readonly DiagramPart[] {
  if (!text.includes('diagram')) return [{ kind: 'md', text }]
  const parts: DiagramPart[] = []
  let cursor = 0
  FENCE.lastIndex = 0
  for (;;) {
    const match = FENCE.exec(text)
    if (match === null) break
    const head = text.slice(cursor, match.index)
    if (head !== '') parts.push({ kind: 'md', text: head })
    let spec: DiagramSpec | undefined
    try {
      spec = asSpec(JSON.parse(match[1] as string))
    } catch {
      spec = undefined
    }
    if (spec === undefined) {
      parts.push({ kind: 'md', text: match[0] as string })
    } else {
      parts.push({ kind: 'diagram', spec, pending: false })
    }
    cursor = match.index + (match[0] as string).length
  }
  let tail = text.slice(cursor)

  // 未闭合围栏：流式期换成占位卡。此前 diagram 完全没有流式态，半截 JSON 会
  // 以代码块逐字外冒——而它的正文正是模型最容易写长的一类。
  if (streaming) {
    const open = openFenceTail(tail, 'diagram')
    if (open !== undefined) {
      if (open.before !== '') parts.push({ kind: 'md', text: open.before })
      parts.push({ kind: 'diagram', pending: true, bytes: open.partial.length })
      tail = ''
    }
  }

  if (tail !== '') parts.push({ kind: 'md', text: tail })
  return parts.length > 0 ? parts : [{ kind: 'md', text }]
}
