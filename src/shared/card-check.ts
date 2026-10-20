/**
 * dsh-chat-plus — 卡片发前校验（纯逻辑，零 DOM / 零 React / 零 IO）。
 *
 * ## 为什么要有这一层
 *
 * 提示词里写着十几条「写卡片时必须遵守的事实」：别引 CDN、别写 height:100vh、
 * 别铺整页底色、别只贴占位注释、宽度别写死……这些规则此前**只有提示词**在说，
 * 没有任何东西在查。模型的遵守率取决于它当时读得多仔细，而违规的后果全都是
 * 「静默失效」——卡片能显示，只是白屏 / 有滚动条 / 是一块色差板子，用户以为
 * 是 bug，模型自己看不到，下一轮它还会这么写。
 *
 * 这一层把那些规则变成**可机检的判据**，并通过 validate_html_card 工具在
 * 模型发卡**之前**告诉它哪里不对。关键取舍来自 dsh-genui 的同类实现：
 *
 *  1. **只报告、不改写**。检查项全部是「确定能指出位置」的硬判据，不做
 *     「猜测意图后自动修改」——自动改模型的设计意图比让它自己改更危险。
 *  2. **命中即给可执行修法**，而不是只骂一句。每条 issue 带 `fix` 字段写清
 *     该怎么改（照抄规则原文里那句人话）。
 *  3. **返回稳定协议文本**而不是散文：`[card-check]\nstatus=...`，
 *     模型能可靠解析，冒烟也能直接断言。
 *  4. **告警与错误分开**：error 会真的坏掉（空白卡、白屏、被 CSP 拦），
 *     warn 只是不好看（色差板子、宽窄不合适），后者不该拦住发送。
 *
 * ## 与渲染期的关系
 *
 * 这里是**软约束**：校验不过，卡片照常渲染。真正的硬约束在渲染侧
 * （CSP 拦外链、parse 层拦空内容、bridge 钳高度）。两层不能互相替代：
 * 渲染侧拦不住「卡片能出但很难看」，校验侧也不该重复实现渲染侧的拦截。
 */

/** 单条检查结果。 */
export interface CardCheckIssue {
  /** 严重度：error = 卡片会真的坏；warn = 能显示但效果差。 */
  readonly level: 'error' | 'warn'
  /** 稳定的问题编码（模型可据此判断要不要改、冒烟可直接断言）。 */
  readonly code: string
  /** 问题说明（人话，指出在哪）。 */
  readonly message: string
  /** 该怎么改（可执行的一句话，不是「请修正」这种空话）。 */
  readonly fix: string
}

/** 一次校验的完整结果。 */
export interface CardCheckResult {
  readonly issues: readonly CardCheckIssue[]
  /** 是否可以直接发（没有 error）。 */
  readonly ok: boolean
}

/** 卡片正文的字符上限：不是性能闸门，超过这个数基本等于贴了整站。 */
const MAX_HTML_CHARS = 200_000

/** 外链的正则：协议开头的资源引用（CSP 会拦，这里提前告诉模型）。 */
const EXTERNAL_URL_RE = /(?:src|href|action)\s*=\s*["']?\s*(https?:)?\/\//i
/** 会被 CSP connect-src 拦掉的网络调用。 */
const NETWORK_CALL_RE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.sendBeacon)\b/
/** 动态代码求值：CSP 下 'unsafe-inline' 允许内联脚本，但 eval 仍被拦。 */
const EVAL_RE = /\b(?:eval|new\s+Function)\s*\(/
/** 整页高度写死：宿主按上报高度给框，写死就会出现内部滚动条或大片空白。 */
const VIEWPORT_HEIGHT_RE = /(?:height|min-height)\s*:\s*(?:100vh|100dvh|100%\s*;?\s*height\s*:\s*100%)/i
/** 整页底色：会盖掉宿主按主题兜的那层底，卡片在对话流里变成一块色差板子。 */
const PAGE_BACKGROUND_RE = /\b(?:html|body)\s*\{[^}]*background(?:-color)?\s*:/i
/** 只贴占位注释：会被当成合法卡片渲染成一张空白框。 */
const PLACEHOLDER_ONLY_RE = /^\s*<!--[\s\S]*?-->\s*$/

/**
 * 是否有**能产生可见内容**的标签。
 *
 * 与 html-embed/parse.ts 的 hasVisibleTag 同一判据（那边是渲染侧的硬拦截，
 * 这里是校验侧的提前告知）。两份判断必须一致：渲染侧拦了、校验侧说没问题，
 * 模型就会反复收到「已通过」然后卡片不出——那是最糟的一种不一致。
 */
function hasVisibleTag(html: string): boolean {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '')
  if (/<[a-z]/i.test(withoutComments)) return true
  return /<!(?:doctype|\[CDATA\[)|<\?/i.test(withoutComments)
}

/**
 * 校验一段将要写进 ```html 围栏的正文。
 *
 * @param html - 围栏正文（不含围栏标记本身）。
 * @returns 全部问题 + 是否可以直接发。
 */
export function checkHtmlCard(html: string): CardCheckResult {
  const issues: CardCheckIssue[] = []
  const body = typeof html === 'string' ? html : ''

  // ── error 级：这些会让卡片真的坏掉 ──────────────────────────────
  if (body.trim() === '') {
    issues.push({
      level: 'error',
      code: 'empty',
      message: '围栏正文是空的。',
      fix: '补上完整可运行的 HTML；真没有内容就不要发卡片。',
    })
  } else if (PLACEHOLDER_ONLY_RE.test(body)) {
    issues.push({
      level: 'error',
      code: 'placeholder-only',
      message: '正文只有一个 HTML 注释，没有可渲染的标签。',
      fix: '贴完整的 HTML，不要用「内容较长，此处省略」这类注释代替——渲染出来是一张空白框。',
    })
  } else if (!hasVisibleTag(body)) {
    issues.push({
      level: 'error',
      code: 'no-visible-tag',
      message: '正文里没有任何可见标签（只有纯文本或只有注释）。',
      fix: '至少给一个标签（div / p / svg 等）；纯文本请直接用普通回答正文。',
    })
  }

  if (EXTERNAL_URL_RE.test(body)) {
    issues.push({
      level: 'error',
      code: 'external-asset',
      message: '有 http(s) / 协议相对地址的外链资源（src / href / action）。',
      fix: '卡片文档带 CSP（default-src none），外链一律加载失败。图片改 data: URL，样式与脚本全部内联。',
    })
  }
  if (NETWORK_CALL_RE.test(body)) {
    issues.push({
      level: 'error',
      code: 'network-call',
      message: '正文里有 fetch / XHR / WebSocket 之类的网络调用。',
      fix: 'CSP connect-src 是 none，这类调用会直接失败。卡片要展示的数据请直接写死在 HTML 里。',
    })
  }
  if (EVAL_RE.test(body)) {
    issues.push({
      level: 'error',
      code: 'eval',
      message: '正文用了 eval 或 new Function。',
      fix: 'CSP 不允许动态求值。把这个表达式的结果直接算好写进 HTML。',
    })
  }

  // ── warn 级：能显示，但效果会明显变差 ────────────────────────────
  if (VIEWPORT_HEIGHT_RE.test(body)) {
    issues.push({
      level: 'warn',
      code: 'viewport-height',
      message: '写了 100vh / 100dvh 这类视口高度。',
      fix: '宿主按内容真实高度给框，写死视口高会出现内部滚动条或大片空白。删掉 height，让内容自己决定高度。',
    })
  }
  if (PAGE_BACKGROUND_RE.test(body)) {
    issues.push({
      level: 'warn',
      code: 'page-background',
      message: '给 html / body 铺了整页底色。',
      fix: '宿主会按主题给画布兜一层底色，你这一层会把它盖掉，卡片在对话流里会变成一块明显色差的板子。需要分组边界就用留白和发丝线。',
    })
  }
  if (body.length > MAX_HTML_CHARS) {
    issues.push({
      level: 'warn',
      code: 'too-large',
      message: `正文 ${body.length} 字符，超过 ${MAX_HTML_CHARS}。`,
      fix: '卡片是对话流里的一块正文，不是交付网站。整站骨架、多路由请落盘后用文字给路径。',
    })
  }

  return { issues, ok: issues.every(issue => issue.level !== 'error') }
}

/**
 * 把校验结果拼成给模型看的协议文本。
 *
 * 协议而不是散文，理由和 genui 的 `[genui-validation]` 一样：模型能稳定
 * 解析，冒烟能直接断言，人读也不费劲。
 *
 * @param result - checkHtmlCard 的返回值。
 * @returns 稳定的多行文本。
 */
export function formatCardCheck(result: CardCheckResult): string {
  if (result.issues.length === 0) {
    return ['[card-check]', 'status=ok', 'issues=0'].join('\n')
  }
  const lines = [
    '[card-check]',
    `status=${result.ok ? 'warn' : 'invalid'}`,
    `issues=${result.issues.length}`,
    `errors=${result.issues.filter(i => i.level === 'error').length}`,
    `warnings=${result.issues.filter(i => i.level === 'warn').length}`,
  ]
  for (const issue of result.issues) {
    lines.push(`- [${issue.level}] ${issue.code}: ${issue.message}`)
    lines.push(`  fix: ${issue.fix}`)
  }
  lines.push(result.ok ? 'next=emit_fence' : 'next=fix_and_recheck')
  return lines.join('\n')
}
