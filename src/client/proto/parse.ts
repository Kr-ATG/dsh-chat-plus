/**
 * dsh-chat-plus — proto-tabs 围栏块解析。
 *
 * 模型写法（正文 markdown 里放一个 proto-tabs 代码围栏，JSON 内容）：
 * {title, tabs: [{label, heading, variant, pill: {tag, desc, detail}, minis: [{t, d}]}]}
 * variant 可选 pill | expand | glow，缺省为 pill（方案A）。
 *
 * 容错：JSON 解析失败 / 结构不对 → 当普通 markdown 原样渲染，绝不抛错
 * （渲染期异常会卸载整个 React 树）。
 */

import { openFenceTail } from '../../shared/fence-scan.ts'

export interface ProtoMini {
  readonly t: string
  readonly d: string
}

export interface ProtoTab {
  readonly label: string
  readonly heading: string
  readonly variant?: 'pill' | 'expand' | 'glow' | undefined
  readonly pill: { readonly tag: string; readonly desc: string; readonly detail: string }
  readonly minis: readonly ProtoMini[]
}

export interface ProtoSpec {
  readonly title: string
  readonly tabs: readonly ProtoTab[]
}

export type ProtoPart =
  | { readonly kind: 'md'; readonly text: string }
  /** 原型对比卡片。pending 语义与 html / iu / diagram 一致：流式期只占位，不解析半截 JSON。 */
  | { readonly kind: 'card'; readonly spec?: ProtoSpec; readonly pending: boolean; readonly bytes?: number }

const TICK = String.fromCharCode(96)
const FENCE = new RegExp(TICK.repeat(3) + 'proto-tabs' + '\\s*\\n([\\s\\S]*?)' + TICK.repeat(3), 'g')

function asSpec(raw: unknown): ProtoSpec | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  const tabs = obj.tabs
  if (!Array.isArray(tabs) || tabs.length === 0 || tabs.length > 4) return undefined
  const clean: ProtoTab[] = []
  for (const item of tabs) {
    if (typeof item !== 'object' || item === null) return undefined
    const it = item as Record<string, unknown>
    const pill = it.pill as Record<string, unknown> | undefined
    if (typeof it.label !== 'string' || typeof it.heading !== 'string') return undefined
    if (typeof pill !== 'object' || pill === null) return undefined
    if (typeof pill.tag !== 'string' || typeof pill.desc !== 'string' || typeof pill.detail !== 'string') return undefined
    const minis = Array.isArray(it.minis) ? it.minis : []
    if (minis.length > 4) return undefined
    const minisClean: ProtoMini[] = []
    for (const m of minis) {
      if (typeof m !== 'object' || m === null) return undefined
      const mm = m as Record<string, unknown>
      if (typeof mm.t !== 'string' || typeof mm.d !== 'string') return undefined
      minisClean.push({ t: mm.t, d: mm.d })
    }
    const variant = it.variant
    clean.push({
      label: it.label,
      heading: it.heading,
      variant: variant === 'pill' || variant === 'expand' || variant === 'glow' ? variant : undefined,
      pill: { tag: pill.tag, desc: pill.desc, detail: pill.detail },
      minis: minisClean,
    })
  }
  return {
    title: typeof obj.title === 'string' && obj.title !== '' ? obj.title : '交互式原型',
    tabs: clean,
  }
}

/**
 * 把 text 切成 markdown 片段与卡片；无围栏时返回整段 md。
 *
 * @param streaming 是否处于流式输出中。true 时末尾未闭合的 ```proto-tabs 会产出
 *   pending 占位卡片；false（已定稿）时未闭合围栏原样当代码块显示。
 */
export function splitProtoTabs(text: string, streaming = false): readonly ProtoPart[] {
  if (!text.includes('proto-tabs')) return [{ kind: 'md', text }]
  const parts: ProtoPart[] = []
  let cursor = 0
  FENCE.lastIndex = 0
  for (;;) {
    const match = FENCE.exec(text)
    if (match === null) break
    const head = text.slice(cursor, match.index)
    if (head !== '') parts.push({ kind: 'md', text: head })
    let spec: ProtoSpec | undefined
    try {
      spec = asSpec(JSON.parse(match[1] as string))
    } catch {
      spec = undefined
    }
    if (spec === undefined) {
      parts.push({ kind: 'md', text: match[0] as string })
    } else {
      parts.push({ kind: 'card', spec, pending: false })
    }
    cursor = match.index + (match[0] as string).length
  }
  let tail = text.slice(cursor)

  // 未闭合围栏：流式期换成占位卡。此前 proto-tabs 与 diagram 一样没有流式态，
  // 半截 JSON 会以代码块逐字外冒。
  if (streaming) {
    const open = openFenceTail(tail, 'proto-tabs')
    if (open !== undefined) {
      if (open.before !== '') parts.push({ kind: 'md', text: open.before })
      parts.push({ kind: 'card', pending: true, bytes: open.partial.length })
      tail = ''
    }
  }

  if (tail !== '') parts.push({ kind: 'md', text: tail })
  return parts.length > 0 ? parts : [{ kind: 'md', text }]
}
