/**
 * webui — 截图用 Markdown 渲染管线（host 端）。
 *
 * markdown-it（CommonMark + GFM 表格/删除线/linkify）+ shiki 语法高亮 + emoji
 * 短码（Unicode 字符，非表情包图片库）+ 任务清单 + 图片（http/https 白名单）。
 * 输出的是 HTML 片段，卡片骨架与主题在 card.ts / theme.ts。
 *
 * 图表围栏（mermaid / flowchart / sequenceDiagram …）**不走 shiki**：输出
 * `<pre class="mermaid">` 占位，由截图页里注入的 mermaid 引擎在无头浏览器内画成
 * SVG（见 card.ts 的引导脚本 + renderer.ts 的资源投放与等待）。引擎缺失或语法
 * 错误时占位保持源码文本，不吞内容。
 */
import MarkdownIt from 'markdown-it'
import { escapeAttr } from '../shared/sanitize-html.ts'
// full 预设才带完整 emoji 短码表：light 只收录极少数条目，:rocket: 之类常见
// 短码会原样输出（旧实现用的就是 light，短码渲染不出来）。
import { full as markdownItEmoji } from 'markdown-it-emoji'
import markdownItTaskLists from 'markdown-it-task-lists'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { baseOf, type ShotTheme } from './theme.ts'
import { sanitizeHtmlFragment } from '../shared/sanitize-html.ts'

/**
 * 预加载的 shiki 语言（与 client 端 markdown/shiki.ts 对齐）。
 *
 * fine-grained 显式 import：只把用到的 34 个 grammar 与 2 个主题打进产物。
 * 之前从 shiki 主入口 createHighlighter，esbuild 会把全量 ~220 种语法（约
 * 10MB）内联进来，而其中未注册的那些本来也用不到（codeToHtml 外面套着
 * try/catch，未注册语言一律回落纯文本）—— 纯属死重量。
 */
import langBash from 'shiki/langs/bash.mjs'
import langC from 'shiki/langs/c.mjs'
import langCpp from 'shiki/langs/cpp.mjs'
import langCsharp from 'shiki/langs/csharp.mjs'
import langCss from 'shiki/langs/css.mjs'
import langDart from 'shiki/langs/dart.mjs'
import langDockerfile from 'shiki/langs/dockerfile.mjs'
import langGo from 'shiki/langs/go.mjs'
import langHtml from 'shiki/langs/html.mjs'
import langJava from 'shiki/langs/java.mjs'
import langJavascript from 'shiki/langs/javascript.mjs'
import langJson from 'shiki/langs/json.mjs'
import langJsx from 'shiki/langs/jsx.mjs'
import langKotlin from 'shiki/langs/kotlin.mjs'
import langLua from 'shiki/langs/lua.mjs'
import langMarkdown from 'shiki/langs/markdown.mjs'
import langObjectiveC from 'shiki/langs/objective-c.mjs'
import langObjectiveCpp from 'shiki/langs/objective-cpp.mjs'
import langPhp from 'shiki/langs/php.mjs'
import langPowershell from 'shiki/langs/powershell.mjs'
import langPython from 'shiki/langs/python.mjs'
import langRuby from 'shiki/langs/ruby.mjs'
import langRust from 'shiki/langs/rust.mjs'
import langScala from 'shiki/langs/scala.mjs'
import langShellscript from 'shiki/langs/shellscript.mjs'
import langSql from 'shiki/langs/sql.mjs'
import langSvelte from 'shiki/langs/svelte.mjs'
import langSwift from 'shiki/langs/swift.mjs'
import langToml from 'shiki/langs/toml.mjs'
import langTsx from 'shiki/langs/tsx.mjs'
import langTypescript from 'shiki/langs/typescript.mjs'
import langVue from 'shiki/langs/vue.mjs'
import langXml from 'shiki/langs/xml.mjs'
import langYaml from 'shiki/langs/yaml.mjs'
import themeGithubLight from 'shiki/themes/github-light.mjs'
import themeGithubDark from 'shiki/themes/github-dark.mjs'

const SHIKI_LANGS = [langBash, langC, langCpp, langCsharp, langCss, langDart, langDockerfile, langGo, langHtml, langJava, langJavascript, langJson, langJsx, langKotlin, langLua, langMarkdown, langObjectiveC, langObjectiveCpp, langPhp, langPowershell, langPython, langRuby, langRust, langScala, langShellscript, langSql, langSvelte, langSwift, langToml, langTsx, langTypescript, langVue, langXml, langYaml]

/**
 * 被识别为「图」的围栏语言（与 client 端 markdown/diagram.tsx 的 DIAGRAM_LANGS
 * 保持一致：mermaid 之外，各图种关键字直接当围栏语言写也认）。
 */
const DIAGRAM_LANGS = new Set([
  'mermaid', 'flowchart', 'graph', 'sequencediagram', 'statediagram', 'statediagram-v2',
  'classdiagram', 'erdiagram', 'gantt', 'journey', 'mindmap', 'timeline', 'quadrantchart',
  'gitgraph', 'sankey', 'xychart', 'block-beta', 'architecture-beta',
])

/**
 * 源码里是否含图表围栏（host 用它决定是否给截图页注入 mermaid 引擎 —— 没有图的
 * 截图不该付 3.4MB 解压 + 引擎解析的代价）。
 * @param md - Markdown 源码。
 */
export function hasDiagramFence(md: string): boolean {
  let fence: string | null = null
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (fence !== null) {
      if (line.startsWith(fence)) fence = null
      continue
    }
    const match = /^(`{3,}|~{3,})\s*([^\s`~]*)/.exec(line)
    if (match === null) continue
    fence = match[1]!.slice(0, 3)
    if (DIAGRAM_LANGS.has((match[2] ?? '').toLowerCase())) return true
  }
  return false
}

let highlighterPromise: Promise<HighlighterCore> | null = null

/** shiki 单例（首次调用初始化，后续复用）。 */
function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighterCore({
      themes: [themeGithubLight, themeGithubDark],
      langs: SHIKI_LANGS,
      // 纯 JS 正则引擎：不依赖 oniguruma wasm，产物依旧自包含，也就没有
      // 「打成单文件后 wasm 在已安装位置找不到」这类路径坑。代价是比 wasm
      // 慢一些；截图只处理消息里那几个代码块，可以接受。
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

/** HTML 转义（纯文本消息 + 卡片标题共用）。 */
export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 链接白名单（http/https/mailto），与 client renderer 的 safeLink 对齐。 */
function safeHref(url: string): string {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? url : ''
  } catch {
    return ''
  }
}

/** 图片白名单（http/https），与 client renderer 的 remoteImage 对齐。 */
function safeSrc(url: string): string {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' ? url : ''
  } catch {
    return ''
  }
}

/** markdown-it 15 的 attrGet 返回 string | number | null，这里规整为 string。 */
function attrStr(value: string | number | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 把 Markdown 源码渲染为 HTML 片段（不含卡片骨架）。
 * @param md - Markdown 源码。
 * @param theme - 截图主题（决定 shiki 配色）。
 * @returns HTML 片段字符串。
 */
export async function renderMarkdown(md: string, theme: ShotTheme): Promise<string> {
  const highlighter = await getHighlighter()
  const shikiTheme = baseOf(theme) === 'dark' ? 'github-dark' : 'github-light'

  const it = new MarkdownIt({
    html: true,
    linkify: true,
    highlight(code, lang) {
      // 图表围栏：交给页面内的 mermaid 引擎（textContent 即源码，引擎会就地
      // 替换成 SVG）。不能走 shiki —— 一旦被高亮成带 span 的 HTML，mermaid 读到
      // 的 textContent 虽仍是源码，但失败时留下的就是花花绿绿的半成品。
      if (DIAGRAM_LANGS.has(lang.trim().toLowerCase())) {
        // data-lang 走 escapeAttr 而不是 escapeHtml：info string 是模型可控的
        // 围栏尾巴，```` ```diagr" onload="… ```` 这种写法在只转义 & < > 的
        // escapeHtml 下会闭合属性并注入事件处理器，而卡片页正好在无头浏览器里
        // 以 disable-web-security 打开。
        return `<pre class="mermaid" data-lang="${escapeAttr(lang.trim())}">${escapeHtml(code.trim())}</pre>`
      }
      if (lang !== '') {
        try {
          return highlighter.codeToHtml(code, { lang, theme: shikiTheme })
        } catch {
          // 未知/未加载语言 → 降级为无高亮代码块
        }
      }
      return `<pre class="shiki plain"><code>${escapeHtml(code)}</code></pre>`
    },
  })

  // 原始 HTML（html: true 后模型输出的 HTML 会原样进入页面）：
  // 净化后再输出——剔除危险标签与事件属性、URL 协议白名单、style 值消毒，
  // 与 client 端「模型 HTML 直接渲染」的策略保持一致（safe-trusted 折中）。
  it.renderer.rules.html_block = (tokens, idx) => sanitizeHtmlFragment(tokens[idx]!.content)
  it.renderer.rules.html_inline = (tokens, idx) => sanitizeHtmlFragment(tokens[idx]!.content)

  // 链接：白名单 + 新窗口 + noopener；非法 URL 置空 href（不可点击）。
  it.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]!
    token.attrSet('href', safeHref(attrStr(token.attrGet('href'))))
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
    return self.renderToken(tokens, idx, options)
  }

  // 图片：白名单 https + no-referrer；非法 URL 降级为 alt 占位文本。
  it.renderer.rules.image = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]!
    const src = safeSrc(attrStr(token.attrGet('src')))
    if (src === '') {
      return `<span class="md-img-alt">${escapeHtml(attrStr(token.attrGet('alt')) || '图片')}</span>`
    }
    token.attrSet('src', src)
    token.attrSet('referrerpolicy', 'no-referrer')
    return self.renderToken(tokens, idx, options)
  }

  // emoji 短码 → Unicode 字符（关闭 :)、:( 等 shortcuts，避免误伤普通文本）。
  it.use(markdownItEmoji, { shortcuts: {} })
  // 任务清单（checkbox 默认 disabled，截图静态展示）。
  it.use(markdownItTaskLists)

  return it.render(md)
}
