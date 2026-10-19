/**
 * dsh-chat-plus — 对话流内嵌 SVG 流程图（diagram 围栏的渲染器）。
 *
 * 按 diagram-design 技能的 flowchart 语法绘制：oval 起止 / rect 步骤 /
 * diamond 判断，正交圆角连线（r=8），底部横向 legend。纯展示组件，
 * 非法输入由 parse 层挡掉，这里不抛错。配色用 DSH 主题 token，
 * 深浅主题自适应（focal 橙走固定品牌色，与技能默认皮肤同源）。
 */
import { memo, useId, useMemo, useState } from 'react'
import type { DiagramEdge, DiagramNode, DiagramSpec } from './parse.ts'

const INK = 'var(--dsw-alias-label-primary, #2d3142)'
const MUTED = 'var(--dsw-alias-label-secondary, #4f5d75)'
const SOFT = 'var(--dsw-alias-label-tertiary, #7a8399)'
const PAPER = 'var(--dsw-alias-bg-layer-1, #ffffff)'
const STROKE = 'var(--dsw-alias-border-l2, rgba(127,127,127,.35))'
const ACCENT = '#eb6c36'
const ACCENT_TINT = 'rgba(235,108,54,.10)'
const SANS = "'Geist','PingFang SC','Microsoft YaHei',sans-serif"
const MONO = "'Geist Mono','PingFang SC','Microsoft YaHei',monospace"

/** 折线倒圆角（r=8），首尾段保留直线以便箭头/起笔干净。 */
export function roundedPath(pts: ReadonlyArray<readonly [number, number]>, r: number): string {
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
    d += ' L ' + p1x.toFixed(1) + ' ' + p1y.toFixed(1) + ' Q ' + cur[0] + ' ' + cur[1] + ' ' + p2x.toFixed(1) + ' ' + p2y.toFixed(1)
  }
  const last = pts[pts.length - 1] as readonly [number, number]
  return d + ' L ' + last[0] + ' ' + last[1]
}

function EdgeView({ edge, marker }: { readonly edge: DiagramEdge; readonly marker: string }): JSX.Element {
  const d = useMemo(() => roundedPath(edge.pts, 8), [edge])
  const mid = edge.pts[Math.floor(edge.pts.length / 2)] as readonly [number, number]
  const horizontal = edge.pts.length === 2
    ? Math.abs((edge.pts[0] as readonly [number, number])[1] - (edge.pts[1] as readonly [number, number])[1]) < 1
    : true
  const color = edge.accent ? ACCENT : undefined
  return (
    <g>
      <path d={d} fill="none" stroke={color ?? MUTED} strokeWidth={edge.accent ? 1.4 : 1.2} markerEnd={'url(#' + marker + ')'} />
      {edge.label !== '' && horizontal && (
        <g>
          <rect x={mid[0] - 18} y={mid[1] - 20} width={36} height={12} rx={2} fill={PAPER} />
          <text x={mid[0]} y={mid[1] - 11} fill={SOFT} fontSize={8} fontFamily={MONO} textAnchor="middle">{edge.label}</text>
        </g>
      )}
    </g>
  )
}

function NodeView({ node, compact }: { readonly node: DiagramNode; readonly compact: boolean }): JSX.Element {
  const fill = node.focal ? ACCENT_TINT : PAPER
  const stroke = node.focal ? ACCENT : STROKE
  const sw = node.focal ? 1.6 : 1
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  return (
    <g>
      {node.shape === 'diamond' ? (
        <g>
          <polygon points={cx + ',' + node.y + ' ' + (node.x + node.w) + ',' + cy + ' ' + cx + ',' + (node.y + node.h) + ' ' + node.x + ',' + cy} fill={PAPER} />
          <polygon points={cx + ',' + node.y + ' ' + (node.x + node.w) + ',' + cy + ' ' + cx + ',' + (node.y + node.h) + ' ' + node.x + ',' + cy} fill={fill} stroke={stroke} strokeWidth={sw} />
        </g>
      ) : (
        <g>
          <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={node.shape === 'oval' ? Math.min(20, node.h / 2) : 6} fill={PAPER} />
          <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={node.shape === 'oval' ? Math.min(20, node.h / 2) : 6} fill={fill} stroke={stroke} strokeWidth={sw} />
        </g>
      )}
      <text x={cx} y={node.shape === 'diamond' ? cy + 4 : cy + 2} fill={INK} fontSize={12} fontWeight={600} fontFamily={SANS} textAnchor="middle">{node.name}</text>
      {!compact && node.shape !== 'diamond' && node.sub !== '' && (
        <text x={cx} y={cy + 18} fill={MUTED} fontSize={9} fontFamily={MONO} textAnchor="middle">{node.sub}</text>
      )}
    </g>
  )
}

export const DiagramCard = memo(function DiagramCard({ spec }: {
  readonly spec: DiagramSpec
}): JSX.Element {
  const uid = useId().replace(/:/g, '')
  const marker = 'dg-arr-' + uid
  const markerA = 'dg-arrA-' + uid
  // 右上角渲染比例：看图的人随时切换，初始值沿用围栏 size。
  const [mode, setMode] = useState<'compact' | 'full' | 'large'>(spec.size === 'compact' ? 'compact' : 'full')
  const compact = mode === 'compact'
  let minX = Infinity
  let minY = Infinity
  let maxX = 0
  let maxY = 0
  const eat = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const n of spec.nodes) {
    eat(n.x, n.y)
    eat(n.x + n.w, n.y + n.h)
  }
  for (const e of spec.edges) for (const p of e.pts) eat(p[0], p[1])
  const legendY = maxY + 40
  const shapes = new Set(spec.nodes.map(n => n.shape))
  const items: Array<{ readonly kind: string; readonly label: string }> = []
  if (shapes.has('oval')) items.push({ kind: 'oval', label: 'START/END' })
  if (shapes.has('rect')) items.push({ kind: 'rect', label: 'STEP' })
  if (shapes.has('diamond')) items.push({ kind: 'diamond', label: 'DECIDE' })
  if (spec.nodes.some(n => n.focal)) items.push({ kind: 'focal', label: 'FOCAL' })
  // 视口贴合内容：图多宽卡多宽，窄图不再撑满 800 宽留白。
  const legendContent = 204 + items.length * 160
  const contentW = maxX - minX + 48
  const vbW = Math.ceil(compact ? contentW : Math.max(contentW, legendContent))
  const vx = Math.floor(minX - (vbW - (maxX - minX)) / 2)
  const vy = minY - 16
  const vbH = Math.min(1200, Math.ceil((compact ? maxY + 24 : legendY + 48) - vy))
  return (
    <figure className={'dtt-diagram' + (mode === 'large' ? ' dtt-diagram--large' : '')}>
      {/* 图注行：标题 + 比例切换。与 iu / html 卡的图注同一分量——
         控件（比例）不再绝对定位压在图右上角，那会让图看起来像「一块可配置的面板」。 */}
      <div className="dtt-dg-bar">
        <span className="dtt-dg-title">{spec.title}</span>
        <div className="dtt-dg-scale" role="group" aria-label="渲染比例">
        {([['compact', '紧', '紧凑'], ['full', '标', '标准'], ['large', '大', '放大']] as const).map(([value, short, tip]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            title={tip}
            onClick={() => { setMode(value) }}
            className={mode === value ? 'dtt-dg-scale-btn dtt-dg-scale-btn--active' : 'dtt-dg-scale-btn'}
          >
            {short}
          </button>
        ))}
        </div>
      </div>
      <svg viewBox={vx + ' ' + vy + ' ' + vbW + ' ' + vbH} style={mode === 'large' ? { width: '100%', minWidth: 1000 } : { maxWidth: Math.round(vbW * 1.45) }} role="img" aria-labelledby={uid + '-t ' + uid + '-d'}>
        <title id={uid + '-t'}>{spec.title}</title>
        <desc id={uid + '-d'}>{spec.desc !== '' ? spec.desc : spec.title}</desc>
        <defs>
          <marker id={marker} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={MUTED} />
          </marker>
          <marker id={markerA} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={ACCENT} />
          </marker>
        </defs>
        {spec.edges.map((e, i) => (
          <EdgeView key={i} edge={e} marker={e.accent ? markerA : marker} />
        ))}
        {spec.nodes.map(n => (
          <NodeView key={n.id} node={n} compact={compact} />
        ))}
        {!compact && (
        <g>
        <line x1={vx + 24} y1={legendY} x2={vx + vbW - 24} y2={legendY} stroke={STROKE} strokeWidth={0.8} />
        <text x={vx + 24} y={legendY + 20} fill={SOFT} fontSize={8} fontFamily={MONO} letterSpacing="0.14em">LEGEND</text>
        {items.map((it, i) => (
          <g key={it.kind} transform={'translate(' + (vx + 120 + i * 160) + ',' + (legendY + 8) + ')'}>
            {it.kind === 'diamond' ? (
              <polygon points="20,0 32,10 20,20 8,10" fill={PAPER} stroke={STROKE} />
            ) : (
              <rect x="0" y="0" width="40" height="20" rx={it.kind === 'oval' ? 10 : 6} fill={it.kind === 'focal' ? ACCENT_TINT : PAPER} stroke={it.kind === 'focal' ? ACCENT : STROKE} strokeWidth={it.kind === 'focal' ? 1.6 : 1} />
            )}
            <text x="48" y="14" fill={SOFT} fontSize={8} fontFamily={MONO}>{it.label}</text>
          </g>
        ))}
        </g>
        )}
      </svg>
    </figure>
  )
})
