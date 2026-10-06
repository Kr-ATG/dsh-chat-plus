/**
 * dsh-soul — 轻量 markdown 渲染（左栏「全文」预览用）。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 * 灵魂正文（soul.md）本来就是 markdown：`# 灵魂契约` / `## 身份` / `- 名字：…`。
 * 之前预览是把原文当纯文本 `white-space:pre-wrap` 直接铺出来，用户看到的是
 * `## 身份`、`- 名字：执行者` 这种带记号的裸文本——「非要做技术的才看得懂」。
 * 预览的意义就是「不读源码也知道现在生效的是什么」，所以必须渲染成富文本。
 *
 * ── 设计取舍 ──────────────────────────────────────────────────────────
 * 1. **移植 memory 面板那份解析器，不引 webui 全量渲染器**。上游渲染器会拖进
 *    shiki + mermaid + katex（数 MB），而这里只有一段几十行的静态人设文本。
 *    子集够了：围栏代码 · ATX 标题 · 有序/无序列表 · 引用 · 分隔线；
 *    行内 `code` / **粗体** / *斜体* / ~~删除线~~ / [链接](url)。
 * 2. **类名前缀换成 dsh-soul-md**。memory 那份挂在 `dsh-triad-md` 与 `--m-*`
 *    变量作用域里（只在记忆面板 ensureStyles 后存在），灵魂面板取不到那些变量；
 *    直接复用会让预览在灵魂页裸奔。样式就近写在本目录 styles.ts，取 `--s-*`。
 * 3. **纯 React 元素输出，不用 dangerouslySetInnerHTML**。正文是用户/模型写的，
 *    不能有注入面。
 * 4. **标题降两级**（h1→h3）。面板自身已有「预览」区头，正文的 `#` 不该和它同级。
 */

import { memo, type ReactNode } from 'react'

/** Markdown 预览属性。 */
export interface SoulMarkdownProps {
  readonly text: string
}

/** 把一段行内文本切成 React 节点（行内语法一次扫描）。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // 一次扫完行内语法；`` ` `` 优先于强调，反引号里的星号保持字面量。
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]*\]\([^)\s]+\))/g
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${String(index)}`
    index += 1

    if (token.startsWith('`')) {
      nodes.push(<code key={key} className="dsh-soul-md__code">{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      nodes.push(
        <a key={key} href={token.slice(split + 2, -1)} target="_blank" rel="noreferrer noopener" className="dsh-soul-md__link">
          {token.slice(1, split)}
        </a>,
      )
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    cursor = match.index + token.length
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/** 把一个列表块渲染成 <ul> / <ol>。 */
function renderList(lines: string[], ordered: boolean, key: string): ReactNode {
  const items = lines.map((line, itemIndex) => {
    const body = ordered ? line.replace(/^\s*\d+[.)]\s+/, '') : line.replace(/^\s*[-*+]\s+/, '')
    return <li key={`${key}-l${String(itemIndex)}`}>{renderInline(body, `${key}-l${String(itemIndex)}`)}</li>
  })
  return ordered
    ? <ol key={key} className="dsh-soul-md__list">{items}</ol>
    : <ul key={key} className="dsh-soul-md__list">{items}</ul>
}

/** 把 markdown 文档解析成 React 节点。 */
function parse(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // 围栏代码块：消费到闭合围栏。
    if (/^\s*```/.test(line)) {
      const start = i + 1
      let end = start
      while (end < lines.length && !/^\s*```/.test(lines[end] ?? '')) end += 1
      out.push(
        <pre key={`b${String(i)}`} className="dsh-soul-md__pre">
          <code>{lines.slice(start, end).join('\n')}</code>
        </pre>,
      )
      i = end + 1
      continue
    }

    if (line.trim() === '') { i += 1; continue }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={`b${String(i)}`} className="dsh-soul-md__hr" />)
      i += 1
      continue
    }

    // ATX 标题：降两级，正文的 `#` 不与面板区头抢层级。
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = Math.min(6, (heading[1]?.length ?? 1) + 2)
      const Tag = `h${String(level)}` as 'h3' | 'h4' | 'h5' | 'h6'
      out.push(
        <Tag key={`b${String(i)}`} className="dsh-soul-md__h" data-level={level}>
          {renderInline(heading[2] ?? '', `b${String(i)}`)}
        </Tag>,
      )
      i += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const start = i
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) i += 1
      const body = lines.slice(start, i).map(item => (item ?? '').replace(/^\s*>\s?/, '')).join(' ')
      out.push(
        <blockquote key={`b${String(start)}`} className="dsh-soul-md__quote">
          {renderInline(body, `b${String(start)}`)}
        </blockquote>,
      )
      continue
    }

    // 列表：把连续同类行收成一个 <ul>/<ol>。
    const isBullet = (value: string): boolean => /^\s*[-*+]\s+/.test(value)
    const isOrdered = (value: string): boolean => /^\s*\d+[.)]\s+/.test(value)
    if (isBullet(line) || isOrdered(line)) {
      const ordered = isOrdered(line)
      const start = i
      while (i < lines.length && (ordered ? isOrdered(lines[i] ?? '') : isBullet(lines[i] ?? ''))) i += 1
      out.push(renderList(lines.slice(start, i), ordered, `b${String(start)}`))
      continue
    }

    // 段落：一直收集到空行或下一个块的起始。
    const start = i
    while (
      i < lines.length
      && (lines[i] ?? '').trim() !== ''
      && !/^\s*```/.test(lines[i] ?? '')
      && !/^(#{1,6})\s+/.test(lines[i] ?? '')
      && !/^\s*>/.test(lines[i] ?? '')
      && !isBullet(lines[i] ?? '')
      && !isOrdered(lines[i] ?? '')
    ) i += 1
    out.push(
      <p key={`b${String(start)}`} className="dsh-soul-md__p">
        {renderInline(lines.slice(start, i).join(' '), `b${String(start)}`)}
      </p>,
    )
  }

  return out
}

/** 灵魂「全文」预览的富文本渲染。 */
export const SoulMarkdown = memo(function SoulMarkdown({ text }: SoulMarkdownProps) {
  return <div className="dsh-soul-md">{parse(text ?? '')}</div>
})
