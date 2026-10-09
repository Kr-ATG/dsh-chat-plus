/**
 * dsh-chat-plus — iu 围栏解析（对话流内嵌原生交互卡片）。
 *
 * 与 diagram / proto-tabs 同通道：正文 markdown 里的 iu 代码围栏 → IuCard。
 * 语义差异：diagram 是静态 SVG，iu 是带本地状态的原生 React 组件，主题与
 * 动效跟随宿主，不走 iframe 沙箱。
 *
 * ## kind 的解析走注册表（不再在本文件里逐个 case）
 *
 * 老实现把每个 kind 的 spec 接口、asXxx 校验函数、asSpec 的 switch 全写在
 * 这里，加一个 kind 就要动 parse.ts / IuCard.tsx / shot/card.ts / inject.ts
 * 四处。现在 kind 的校验与类型各自收敛到 kinds/<kind>.ts，本文件只负责
 * 「切分围栏 + 把 JSON 交给注册表解析」，**新增 kind 不再碰这里**。
 *
 * 四个关键取舍（与 html-embed/parse.ts 同构，冒烟逐条钉住）：
 *  1. 语言标记必须精确是 iu（iu-preview 这类不吞），大小写不敏感。
 *  2. 非法 JSON / 结构不对 / 未知 kind → 当普通 markdown 原样渲染，绝不抛错。
 *  3. 流式期未闭合围栏 → pending 占位（只占位，不按半截 JSON 渲染）。
 *  4. 超长一律回退原文。
 */

import type { IuSpecBase } from './kinds/contract.ts'
import type { IuSpec } from './kinds/types.ts'
import { parseIuSpec, IU_KIND_NAMES } from './kinds/registry.ts'

// ── 向后兼容的类型 re-export ────────────────────────────────────────────
// 历史上有模块 `from './iu/parse.ts'` 引这些名字（shot/card.ts、client/index.ts），
// 现在类型定义迁到了各 kind 模块，这里原样转出，调用方零改动。
export type { IuSpec } from './kinds/types.ts'
export type { IuSliderSpec, IuSliderOutput } from './kinds/slider.ts'
export type { IuChartSpec, IuChartSeries } from './kinds/chart.ts'
export type { IuChecklistSpec, IuCheckItem } from './kinds/checklist.ts'
export type { IuTabsSpec, IuTabsTab } from './kinds/tabs.ts'
export type { IuPianoSpec, IuPianoWave } from './kinds/piano.ts'

/** kind 名联合（从注册表派生；老代码用它做类型收窄）。 */
export type IuKind = typeof IU_KIND_NAMES[number] | string

export type IuPart =
  | { readonly kind: 'md'; readonly text: string }
  | { readonly kind: 'iu'; readonly spec: IuSpecBase; readonly pending: false }
  | { readonly kind: 'iu'; readonly pending: true; readonly bytes: number }

/** 单个 iu 围栏的内容上限（字符）。JSON 配参数很小，超了多半是贴错了东西。 */
const MAX_IU_CHARS = 20_000

const TICK = String.fromCharCode(96)
/**
 * 围栏正则：iu + 行尾 + 任意内容 + 收尾反引号。
 *
 * 语言标记后必须直接换行（只允许行尾空白），因此 iu-preview、
 * ius 这类标记不会被误吞；i 标志容忍模型写成 IU。
 * 只匹配闭合围栏；流式期半截围栏由 findOpenFence 走 pending 那条路。
 */
const FENCE = new RegExp(
  TICK.repeat(3) + 'iu' + '[ \\t]*\\r?\\n([\\s\\S]*?)' + TICK.repeat(3),
  'gi',
)

/**
 * 找出文本里最后一个未闭合的代码围栏（与 html-embed/parse.ts 同算法）。
 *
 * 逐行 toggle：遇到围栏标记行就在围栏内外翻转，扫完仍在围栏内的那个就是
 * 没闭合的。这里只处理半截输入，正则匹配不了它，只能逐行扫描。
 */
function findOpenFence(text: string): { lang: string; fenceStart: number; bodyStart: number } | undefined {
  let open: { lang: string; fenceStart: number; bodyStart: number } | undefined
  let cursor = 0
  for (const line of text.split('\n')) {
    const lineStart = cursor
    cursor += line.length + 1
    const fence = /^\s{0,3}(?:`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/.exec(line)
    if (fence === null) continue
    if (open === undefined) {
      open = { lang: (fence[1] ?? '').toLowerCase(), fenceStart: lineStart, bodyStart: cursor }
    } else {
      open = undefined
    }
  }
  return open
}

/**
 * 廉价预判：正文里是否可能存在 iu 围栏。
 *
 * 只做一次正则（调用方在正文渲染热路径上用它决定要不要走切分）。
 * 后瞻排除 iu-preview / ius 这类更长的标记，免得每次都白跑一遍切分。
 */
export function looksLikeIuFence(text: string): boolean {
  return text.indexOf(TICK.repeat(3)) >= 0 && /`{3}\s*iu(?![A-Za-z0-9_-])/i.test(text)
}

/**
 * 把 text 切成 markdown 片段与 iu 卡片；无围栏时返回整段 md。
 *
 * @param streaming 是否处于流式输出中。true 时末尾未闭合的 iu 围栏会产出一个
 *   pending 占位卡片；false（已定稿）时未闭合围栏原样当代码块显示。
 */
export function splitIu(text: string, streaming = false): readonly IuPart[] {
  if (!looksLikeIuFence(text)) return [{ kind: 'md', text }]
  const parts: IuPart[] = []
  let cursor = 0
  FENCE.lastIndex = 0
  for (;;) {
    const match = FENCE.exec(text)
    if (match === null) break
    const head = text.slice(cursor, match.index)
    if (head !== '') parts.push({ kind: 'md', text: head })
    const body = (match[1] ?? '').trim()
    let spec: IuSpecBase | undefined
    if (body !== '' && body.length <= MAX_IU_CHARS && body.charAt(0) === '{') {
      try {
        // 解析与校验全部委派给注册表（parseIuSpec 按 kind 字段路由）。
        spec = parseIuSpec(JSON.parse(body))
      } catch {
        spec = undefined
      }
    }
    if (spec === undefined) {
      parts.push({ kind: 'md', text: match[0] as string })
    } else {
      parts.push({ kind: 'iu', spec, pending: false })
    }
    cursor = match.index + (match[0] as string).length
  }
  let tail = text.slice(cursor)

  // 未闭合围栏：流式期换成占位卡；定稿态回退原文（被截断的历史消息不该
  // 永远停在等待态）。
  if (streaming && tail !== '') {
    const open = findOpenFence(tail)
    if (open !== undefined && open.lang === 'iu') {
      const head = tail.slice(0, open.fenceStart)
      if (head !== '') parts.push({ kind: 'md', text: head })
      const partial = tail.slice(open.bodyStart)
      parts.push({ kind: 'iu', pending: true, bytes: partial.length })
      tail = ''
    }
  }

  if (tail !== '') parts.push({ kind: 'md', text: tail })
  return parts.length > 0 ? parts : [{ kind: 'md', text }]
}
