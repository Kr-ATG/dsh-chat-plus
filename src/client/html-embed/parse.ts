/**
 * dsh-chat-plus — html 围栏解析（对话流内嵌可交互 HTML 卡片）。
 *
 * 与 proto-tabs / diagram 同通道：正文 markdown 里的 ```html 围栏 → HtmlCard。
 * 语义对齐官方 MCP Apps 的 widget（tool 返回 ui:// 资源、宿主内联渲染 iframe），
 * 只是把「资源声明」换成了「围栏标记」——DSH 没有 Apps SDK 那套宿主协议，
 * 模型能用来自我表达的最短路径就是代码围栏。
 *
 * 四个关键设计取舍：
 *
 *  1. **```html 直接渲染，不再要求额外标记**。官方 widget 靠 tool 元数据区分
 *     「要渲染」和「只是数据」，围栏做不到——用户让模型「给我一段 HTML」时
 *     模型也会写 ```html。这里的选择是渲染优先，把「看源码」做成卡片上的一个
 *     按钮（源码视图 + 复制）。反过来（默认显示代码、要特殊标记才渲染）会让
 *     这个能力几乎永远不会被触发，等于没做。
 *
 *  2. **流式期一出现 ```html 就换成占位卡**（pending）。HTML 卡片正文动辄几百行，
 *     围栏闭合前交给 markdown 渲染器就是「代码逐字往外冒」——既没法读，也把
 *     对话流撑得老长。所以未闭合围栏一律折叠成一张「预渲染中」占位卡，闭合后
 *     **原位**变成真卡片（同一个 part 序号 → 同一个 React key → 复用同一个
 *     组件实例，不是卸载再挂载）。
 *
 *  3. **pending 只在流式期产生**。历史消息里若有个被截断的未闭合围栏（模型输出
 *     中断），不该永远停在「预渲染中」——非流式期一律回退成代码块，让人看到
 *     真实的半截内容。
 *
 *  4. **超长一律回退代码块**。iframe 是独立文档，一次挂载的代价远高于一张 SVG
 *     卡片；80KB 以上的内容多半是模型把整站贴进来了，渲染出来也没法看。非法/
 *     超长输入静默回退原文，绝不抛错（渲染期异常会卸载整棵 React 树）。
 */

/** 单个 html 围栏的内容上限（字符）。超出回退成代码块。 */
const MAX_HTML_CHARS = 80_000

/** 从 HTML 里抠标题：优先 <title>，其次第一个 h1 文本，都没有就用兜底名。 */
function titleOf(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (title !== null) {
    const text = (title[1] ?? '').trim().replace(/\s+/g, ' ')
    if (text !== '') return text.slice(0, 60)
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (h1 !== null) {
    // 去掉 h1 里可能的内联标签，只留文字。
    const text = (h1[1] ?? '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ')
    if (text !== '') return text.slice(0, 60)
  }
  return 'HTML 卡片'
}

export interface HtmlSpec {
  /** 原始 HTML 正文（渲染时由 bridge 包成完整文档）。 */
  readonly html: string
  /** 卡片标题（<title> / <h1> 提取，失败给兜底名）。 */
  readonly title: string
  /** 源码字符数，卡片上标出来让用户知道这不是个小片段。 */
  readonly bytes: number
}

export type HtmlPart =
  | { readonly kind: 'md'; readonly text: string }
  /**
   * HTML 卡片。
   *
   * `pending` 区分「流式期还在写」与「已写完」：
   *  · pending=true  → 围栏未闭合，只渲染占位（预渲染中），不挂 iframe；
   *  · pending=false → 围栏已闭合，渲染真正的沙箱卡片。
   *
   * 两种状态刻意共用同一个 part kind 与同一个组件：切分结果里 subIndex 不变，
   * 调用方给出的 React key 也就不变，React 会复用同一个 HtmlCard 实例——
   * 闭合那一刻是「同一张卡从占位变成真身」，而不是卸载一个再挂一个。
   */
  | { readonly kind: 'html'; readonly spec: HtmlSpec; readonly pending: boolean }

const TICK = String.fromCharCode(96)
/**
 * 围栏正则：```html + 行尾 + 任意内容 + 收尾反引号。
 *
 * 语言标记后必须直接换行（只允许行尾空白），因此 ```html-preview、
 * ```html5 这类标记不会被误吞；`i` 标志容忍模型写成 ```HTML。
 *
 * 只匹配**闭合**围栏；流式期半截的围栏由 findOpenFence 走 pending 那条路。
 */
const FENCE = new RegExp(
  TICK.repeat(3) + 'html' + '[ \\t]*\\r?\\n([\\s\\S]*?)' + TICK.repeat(3),
  'gi',
)

/**
 * 找出文本里**最后一个未闭合**的代码围栏。
 *
 * 逐行 toggle：遇到围栏标记行就在「围栏内 / 围栏外」之间翻转，扫完仍在围栏内的
 * 那个就是没闭合的。返回语言标记、标记行起点、正文起点。
 *
 * 逐行扫描而不是正则：这里要处理的正是「正则匹配不了」的输入（半截围栏），
 * 用正则会退化成贪婪匹配，把后面所有正文一起吞掉。
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
 * 廉价预判：正文里是否**可能**存在 html 围栏。
 *
 * 只做一次字符串包含，不做完整正则 —— 调用方在正文渲染的每帧热路径上用它
 * 决定要不要走切分。因此判据必须比 `includes('html')` 严：正文里写「HTML
 * 卡片」这种普通措辞太常见，那种误判会让每段正文都白跑一遍完整切分。
 */
export function looksLikeHtmlFence(text: string): boolean {
  return text.indexOf(TICK + TICK + TICK) >= 0 && /html/i.test(text)
}

/**
 * 正文里是否有**能产生可见内容**的标签。
 *
 * 原来的判据是 `/<[a-z!/]/i` —— 它把注释起始的 `<!` 也算成标签，于是
 * 「只写一行注释」的围栏会被判成合法卡片，渲染出来是一张**空白框**：
 * 实测事故（2026-10-08）模型写了
 * `<!-- 完整单文件…内容较长，此处省略 -->`，用户看到的就是空白卡片 +
 * 角落一个 `55 B`，完全猜不到那是「模型没贴内容」。
 *
 * 现在先剥掉注释再判：只有注释 = 没有内容 → 回退成代码块，用户一眼能看见
 * 模型当时到底写了什么（这才是有用的失败态，空白框不是）。
 * 声明/处理指令（`<!DOCTYPE html>`、`<?xml …?>`）单独放行——它们是真实文档的开头。
 */
function hasVisibleTag(html: string): boolean {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '')
  if (/<[a-z]/i.test(withoutComments)) return true
  return /<!(?:doctype|\[CDATA\[)|\<\?/i.test(withoutComments)
}

/**
 * 把 text 切成 markdown 片段与 html 卡片；无围栏时返回整段 md。
 *
 * @param streaming 是否处于流式输出中。true 时末尾未闭合的 ```html 会产出一个
 *   `pending: true` 的占位卡片；false（已定稿）时未闭合围栏原样当代码块显示——
 *   被截断的历史消息不该永远停在「预渲染中」。
 */
export function splitHtml(text: string, streaming = false): readonly HtmlPart[] {
  if (!looksLikeHtmlFence(text)) return [{ kind: 'md', text }]
  const parts: HtmlPart[] = []
  let cursor = 0
  FENCE.lastIndex = 0
  for (;;) {
    const match = FENCE.exec(text)
    if (match === null) break
    const head = text.slice(cursor, match.index)
    if (head !== '') parts.push({ kind: 'md', text: head })
    const body = (match[1] ?? '').trim()
    // 空内容 / 超长 / 无可渲染标签（含「只有注释」）→ 回退原文（当普通代码块显示）。
    if (body === '' || body.length > MAX_HTML_CHARS || !hasVisibleTag(body)) {
      parts.push({ kind: 'md', text: match[0] as string })
    } else {
      parts.push({
        kind: 'html',
        spec: { html: body, title: titleOf(body), bytes: body.length },
        pending: false,
      })
    }
    cursor = match.index + (match[0] as string).length
  }
  let tail = text.slice(cursor)

  // 未闭合围栏：流式期换成占位卡，让「模型正在写 HTML」的整个过程都收在一张卡里，
  // 而不是几百行代码逐字往外冒。
  if (streaming && tail !== '') {
    const open = findOpenFence(tail)
    if (open !== undefined && open.lang === 'html') {
      const head = tail.slice(0, open.fenceStart)
      if (head !== '') parts.push({ kind: 'md', text: head })
      const partial = tail.slice(open.bodyStart)
      parts.push({
        kind: 'html',
        // 标题在写完前抠不出来（<title>/<h1> 可能还没出现），交给组件显示
        // 「预渲染中」；字节数实时更新，让用户看得出确实在长。
        spec: { html: partial, title: 'HTML 卡片', bytes: partial.length },
        pending: true,
      })
      tail = ''
    }
  }

  if (tail !== '') parts.push({ kind: 'md', text: tail })
  return parts.length > 0 ? parts : [{ kind: 'md', text }]
}
