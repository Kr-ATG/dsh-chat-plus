/**
 * dsh-mail — 邮件 HTML 正文净化（client 半身）。
 *
 * 邮件正文是**外部不可信输入**（任何陌生人给你发的邮件都会进这里），所以
 * 不能直接 `dangerouslySetInnerHTML`。渲染策略是两道：
 *
 *  1. 本模块做字符串级净化：剔脚本类标签、剥事件属性、URL 协议白名单、
 *     消毒 style 值；**保留 `<style>` 块**——邮件排版九成靠它，剔掉整封邮件
 *     就散架了，而它在本模块的第二道防线里是安全的；
 *  2. 渲染进 `<iframe sandbox="allow-same-origin">`（**不给 allow-scripts**）：
 *     即使净化漏了某个向量，iframe 里的脚本也执行不了，且样式与页面完全隔离
 *     （邮件爱怎么写 body 背景都不会污染面板）。
 *
 * 为什么不复用 shared/sanitize-html.ts：那份是给 markdown 片段用的，把
 * `<style>` 与 `<link>` 整块剔除（对话流里确实该剔）；邮件场景需要保留样式，
 * 判据不同就不硬套，避免改坏截图管线那条链。
 */

/** 连同内容整块剔除的标签（iframe 里也绝不放过）。 */
const DROP_PAIR_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base',
  'template', 'applet', 'frame', 'frameset', 'noscript', 'audio', 'video',
  'source', 'svg', 'math', 'canvas',
])

/** 只删标签保留内容的标签。 */
const STRIP_TAGS = new Set([
  'button', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'legend',
  'dialog', 'datalist', 'output', 'param', 'track', 'label', 'progress',
  'meter', 'map', 'area', 'input',
])

/** HTML void 元素。 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

/** style 值里的危险模式（命中即整属性丢弃）。 */
const DANGEROUS_STYLE_RE = /(javascript:|vbscript:|expression\s*\(|behavior\s*:|-moz-binding)/i

/** 属性值转义。 */
function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** URL 白名单：http/https/mailto；图片额外允许 data:image 与 cid:。 */
function safeUrl(value: string, context: 'href' | 'src'): string {
  const url = value.trim()
  if (url === '') return ''
  try {
    const protocol = new URL(url).protocol.toLowerCase()
    if (protocol === 'http:' || protocol === 'https:') return url
    if (protocol === 'mailto:' && context === 'href') return url
    if (context === 'src' && /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);/i.test(url)) return url
    return ''
  } catch {
    // 相对路径 / 锚点原样放行（iframe 里没有 base，实际请求会打到本机，无害）。
    if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return url
    return ''
  }
}

/** 单个属性消毒。 */
function cleanAttr(name: string, value: string, tagName: string): string | null {
  const lower = name.toLowerCase()
  if (lower === '' || !/^[a-zA-Z_:][\w:.-]*$/.test(name)) return null
  if (/^on/i.test(lower)) return null
  if (lower === 'srcdoc' || lower === 'ping') return null
  if (lower === 'style') {
    return DANGEROUS_STYLE_RE.test(value) ? null : ` style="${escapeAttr(value)}"`
  }
  if (lower === 'href' || lower === 'xlink:href') {
    const url = safeUrl(value, 'href')
    return url === '' ? null : ` ${name}="${escapeAttr(url)}"`
  }
  if (lower === 'action' || lower === 'formaction' || lower === 'srcset') return null
  if (lower === 'src' || lower === 'poster') {
    const url = safeUrl(value, 'src')
    return url === '' ? null : ` ${name}="${escapeAttr(url)}"`
  }
  if (lower === 'target' && tagName === 'a') return ' target="_blank"'
  if (lower === 'rel' && tagName === 'a') return ' rel="noopener noreferrer"'
  return ` ${name}="${escapeAttr(value)}"`
}

/**
 * 净化邮件 HTML 正文。
 *
 * 与 shared 版的差异：`<style>` 保留（内容按同样规则消毒——剥 @import 与
 * javascript: url），`<link>` 仍剔除（外链 CSS 会打网络且可能带追踪像素）。
 * 其余标签一律属性逐个消毒后重建。
 */
export function sanitizeMailHtml(html: string): string {
  let out = ''
  let pos = 0
  const dropStack: string[] = []
  const stripStack: string[] = []
  const dropping = (): boolean => dropStack.length > 0
  while (pos < html.length) {
    const lt = html.indexOf('<', pos)
    if (lt === -1) {
      if (!dropping()) out += html.slice(pos)
      break
    }
    if (lt > pos && !dropping()) out += html.slice(pos, lt)
    // 注释直接跳过（条件注释里的脚本是经典绕过向量）。
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      pos = end === -1 ? html.length : end + 3
      continue
    }
    // <style>：整块抄出来，按 CSS 规则消毒后原样保留。
    if (/^<style[\s>]/i.test(html.slice(lt, lt + 8))) {
      const close = html.toLowerCase().indexOf('</style>', lt)
      const cssEnd = close === -1 ? html.length : close
      const css = html.slice(html.indexOf('>', lt) + 1, cssEnd)
      if (!dropping()) out += `<style>${sanitizeCss(css)}</style>`
      pos = close === -1 ? html.length : close + '</style>'.length
      continue
    }
    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) { if (!dropping()) out += html.slice(lt); break }
    const raw = html.slice(lt + 1, gt)
    const isClosing = raw.startsWith('/')
    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9_-]*)/.exec(raw)
    pos = gt + 1
    if (nameMatch === null) {
      if (!dropping()) out += html.slice(lt, gt + 1)
      continue
    }
    const tagName = nameMatch[1].toLowerCase()
    const selfClosing = raw.trimEnd().endsWith('/') || VOID_TAGS.has(tagName)
    if (dropping()) {
      if (isClosing && tagName === dropStack[dropStack.length - 1]) dropStack.pop()
      else if (!isClosing && !selfClosing && DROP_PAIR_TAGS.has(tagName)) dropStack.push(tagName)
      continue
    }
    if (DROP_PAIR_TAGS.has(tagName)) {
      if (!isClosing && !selfClosing) dropStack.push(tagName)
      continue
    }
    if (STRIP_TAGS.has(tagName)) {
      if (isClosing) { if (stripStack[stripStack.length - 1] === tagName) stripStack.pop(); continue }
      if (selfClosing) continue
      stripStack.push(tagName)
      continue
    }
    if (isClosing) { out += `</${tagName}>`; continue }
    const attrs: string[] = []
    const attrSource = raw.replace(/^\/?\s*[a-zA-Z][a-zA-Z0-9_-]*/, '')
    const attrRe = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(attrSource)) !== null) {
      const cleaned = cleanAttr(m[1], m[2] ?? m[3] ?? m[4] ?? '', tagName)
      if (cleaned !== null) attrs.push(cleaned)
    }
    out += selfClosing ? `<${tagName}${attrs.join('')} />` : `<${tagName}${attrs.join('')}>`
  }
  return out
}

/** CSS 消毒：剥 @import、expression、javascript: url（其余原样，保排版）。 */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:[^)]*\)/gi, 'none')
    .replace(/behavior\s*:[^;]*;?/gi, '')
    .replace(/-moz-binding\s*:[^;]*;?/gi, '')
}

/** 把邮件 HTML 包成一个完整文档（iframe srcdoc 用）。 */
export function wrapMailHtml(body: string, dark: boolean): string {
  const bg = dark ? '#1b1d21' : '#ffffff'
  const fg = dark ? '#e6e6e6' : '#1a1a1a'
  const link = dark ? '#7cb0ff' : '#0e70df'
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>',
    `html,body{margin:0;padding:0;background:${bg};color:${fg};`,
    "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei UI','Microsoft YaHei',Helvetica,Arial,sans-serif;",
    'font-size:14px;line-height:1.7;word-break:break-word;overflow-wrap:anywhere}',
    `a{color:${link}}`,
    'img{max-width:100%!important;height:auto!important}',
    'table{max-width:100%!important}',
    'pre{white-space:pre-wrap;word-break:break-word}',
    'body{padding:2px 2px 8px}',
    '::-webkit-scrollbar{width:8px;height:8px}',
    '::-webkit-scrollbar-thumb{border-radius:4px;background:rgba(128,128,128,.35)}',
    '</style></head><body>',
    sanitizeMailHtml(body),
    '</body></html>',
  ].join('')
}
