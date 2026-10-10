/**
 * webui — 截图卡片 HTML 组装（host 端）。
 *
 * 输入一条或多条消息（user / assistant），输出可直接喂给无头浏览器的完整
 * HTML 文档：顶部导轨 + 徽标页头 + 标题 + 正文（assistant 走 Markdown 管线、
 * user 走纯文本）+ 页脚署名。多条消息按段落堆叠，段间有角色标签与细线。
 *
 * 正文里的 mermaid 围栏会真的画成图：命中图表围栏时在文档末尾追加
 * `<script src="mermaid.min.js">` + 引导脚本（引擎文件由 renderer.ts 投放到同
 * 目录），并把「渲染完成」暴露成 window.__shotMermaid 供渲染器等待。
 */
import { escapeHtml, hasDiagramFence, renderMarkdown } from './markdown.ts'
import { escapeAttr } from '../shared/sanitize-html.ts'
import { buildCardCss, mermaidConfigJson, baseOf, type ShotTheme } from './theme.ts'
import { deriveTitle } from '../shared/title.ts'
import { assembleHtmlDocument } from '../client/html-embed/bridge.ts'
import { splitHtml } from '../client/html-embed/parse.ts'
import { splitIu } from '../client/iu/parse.ts'
import { iuKindOf } from '../client/iu/kinds/registry.ts'
import { IU_CSS } from '../client/iu/styles.ts'
export { deriveTitle } from '../shared/title.ts'

/** 单条待渲染消息。 */
export interface ShotMessage {
  role: 'user' | 'assistant'
  text: string
}

/** 一条内嵌的本地 HTML 预览（host 侧已探测过高度）。 */
export interface ShotEmbed {
  /** 消息里出现的原文（用来定位 <code>…</code> 落点）。 */
  readonly raw: string
  /** 解析后的绝对路径。 */
  readonly abs: string
  /** iframe 的 file:// 地址（卡片页本身也是 file://，相对资源能解析）。 */
  readonly fileUrl: string
  /** iframe 高度（CSS px，按卡片内容宽排版量出来的）。 */
  readonly height: number
}

/**
 * 一条正文里的 ```html 围栏（与对话流同一份内容，截图里同样要「跑起来」）。
 */
export interface ShotHtmlFence {
  /** 围栏正文（模型原始 HTML）。 */
  readonly html: string
  /** 标题（<title>/<h1> 提取，失败给兜底名），用于 figure 的 aria-label。 */
  readonly title: string
}

/** 卡片组装参数。 */
export interface ShotCardInput {
  messages: readonly ShotMessage[]
  theme: ShotTheme
  /** 卡片宽度（CSS px）。 */
  width: number
  /** 卡片最小高度（CSS px），短消息保底版面。 */
  minHeight: number
  /** 卡片大标题；一般传会话标题，留空时从首条消息正文推导。 */
  title?: string
  /** 页头徽章文案（如「这一轮问答」），留空按消息数与角色生成。 */
  label?: string
  /** 正文提到的本地 HTML：以 iframe 内嵌进截图（只要页面本身，不带对话里那圈工具条）。 */
  embeds?: readonly ShotEmbed[]
  /**
   * 内容缩放档位（与对话流里的持久化缩放同源，缺省 1）。
   *
   * 截图必须跟着用户在对话流里选的档位走，否则「所见」与「所得」不一致：
   * 用户在 150% 下看着正好，截出来却是 100% 的小字。
   */
  zoom?: number
}

/** 单条消息文本上限，超出截断（避免超长图与内存尖峰）。 */
const MAX_TEXT_LEN = 80000

// ── DeepSeek 鲸鱼 logo（官方 FishLogo 的 path）─────────────────────────────

const FISH_LOGO_PATH =
  'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6' +
  '716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988Z' +
  'M15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

/** 内联鲸鱼 SVG（品牌徽标 + 页脚署名共用）。 */
function whale(width: number, height: number): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="${FISH_LOGO_PATH}" fill="currentColor"/></svg>`
}



/** 时间戳（本地时区，分钟精度）。 */
function stampNow(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 超长正文截断（保留提示尾注）。 */
function clamp(text: string): string {
  return text.length <= MAX_TEXT_LEN ? text : `${text.slice(0, MAX_TEXT_LEN)}\n\n…（内容过长已截断）`
}

/**
 * mermaid 引擎文件名（renderer.ts 把解压后的引擎投放到临时页面同目录，
 * 页面用相对路径加载 —— file:// 页面无网络，必须同目录）。
 */
export const MERMAID_FILE = 'mermaid.min.js'

/**
 * 页面里「图表是否已渲染完」的全局钩子名。renderer.ts 用它决定要不要等图，
 * 也用它判断本次渲染需不需要投放引擎文件。
 */
export const MERMAID_HOOK = '__shotMermaid'

/**
 * 图表引导脚本：加载引擎 → 逐个围栏渲染 → 失败的围栏回退成源码文本。
 *
 * 逐个 run 而非一次性 run 全部：mermaid 的 runThrowsErrors 在循环末尾抛出第一个
 * 错误，但已 setAttribute('data-processed') 的节点不会重试 —— 一个语法错误会让
 * 后面的好图一起变成裸源码。逐个跑则互不影响。
 */
function mermaidBoot(theme: ShotTheme): string {
  return `<script src="${MERMAID_FILE}"></script>
<script>
window.${MERMAID_HOOK} = (async () => {
  var nodes = Array.prototype.slice.call(document.querySelectorAll('pre.mermaid'));
  if (nodes.length === 0) return 'empty';
  if (!window.mermaid || typeof window.mermaid.run !== 'function') return 'engine-missing';
  try { window.mermaid.initialize(${mermaidConfigJson(theme)}); } catch (error) { return 'init-failed'; }
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    // mermaidAPI.render 会先清空容器再解析（r.innerHTML=""），语法错误抛出时
    // 源码已经没了 —— 必须先存原文，失败时还原成源码块，绝不吞内容。
    var source = node.textContent;
    try { await window.mermaid.run({ nodes: [node], suppressErrors: true }); } catch (error) { /* 单张失败不影响其它 */ }
    if (node.querySelector('svg') === null) {
      node.removeAttribute('data-processed');
      node.textContent = source;
    }
  }
  return 'done';
})();
</script>`
}

/** 渲染单条消息的正文 HTML（assistant 走 Markdown，user 保留换行的纯文本）。 */
async function bodyOf(message: ShotMessage, theme: ShotTheme): Promise<string> {
  const source = clamp(message.text)
  if (message.role === 'user') {
    return `<div class="content plain">${escapeHtml(source)}</div>`
  }
  return `<div class="content">${await renderMarkdown(source, theme)}</div>`
}

/** 卡片组装结果。 */
export interface ShotCardOutput {
  /** 可直接写入临时 file:// 页面的完整 HTML。 */
  html: string
  /** 正文含图表围栏：渲染器需要投放 mermaid 引擎并等待图画完。 */
  needsMermaid: boolean
  /** 正文含 ```html 围栏内嵌：渲染器需要等高度桥上报稳定后再量总高。 */
  hasFenceEmbed: boolean
}

/**
 * 一张内嵌预览的 figure（页面 + 底部一行文件名，不放对话里那套工具条）。
 *
 * `src` 与 `title` 一律走 escapeAttr（转义引号/反引号），**不能**用只转义
 * `& < >` 的 escapeHtml：本地 HTML 的路径与文件名都来自模型正文，POSIX 允许
 * 文件名里带 `"`，一个裸引号就会闭合属性、把事件处理器注入进 <iframe> 标签。
 * 而这张卡片页是用带 --disable-web-security --allow-file-access-from-files 的
 * 无头 Chrome 打开的，注入的处理器有读本地文件的能力。
 */
function figureOf(embed: ShotEmbed): string {
  const name = embed.abs.split(/[\\/]+/).pop() ?? embed.abs
  const title = escapeAttr(name)
  return `<figure class="htmlshot"><iframe src="${escapeAttr(embed.fileUrl)}" title="${title}" scrolling="no" loading="eager" style="height:${embed.height}px"></iframe><figcaption>${escapeHtml(name)} · 本地 HTML</figcaption></figure>`
}

/** 块级收尾标签（内嵌预览要插到它后面，而不是把句子劈开）。 */
const BLOCK_END = /<\/(?:p|li|h[1-4]|blockquote|td|th|dd|dt)>/

/**
 * 一条 ```html 围栏的 figure（与对话流同款的沙箱文档，srcdoc 内联）。
 *
 * 与本地 HTML 内嵌（figureOf）的区别：内容不是文件而是模型正文，走
 * assembleHtmlDocument 包成带高度桥的完整文档后 srcdoc 内联——截图页与
 * iframe 同为 file:// 且引擎带 --allow-file-access-from-files，srcdoc 的
 * about:srcdoc 能正常加载并回传高度。
 *
 * 安全：srcdoc 属性值走 escapeAttr（引号/反引号全转义）——模型正文里的 `"`
 * 若裸着会闭合属性，而这张卡片页是在带 --disable-web-security 的无头 Chrome
 * 里打开的，注入的事件处理器有读本地文件的能力。
 */
function fenceFigureOf(fence: ShotHtmlFence, index: number): string {
  // fid 写进 bridge 上报 + figure 的 data-fid：截图页按 id 配对，不靠 contentWindow
  // 比对（无头 Chrome 里 srcdoc iframe 的窗口引用比对实测不可靠）。
  const fid = 'f' + index
  const doc = assembleHtmlDocument(fence.html, fid)
  const title = escapeAttr(fence.title)
  return `<figure class="htmlfence" data-fid="${fid}"><iframe srcdoc="${escapeAttr(doc)}" title="${title}" scrolling="no" loading="eager" sandbox="allow-scripts allow-popups allow-forms allow-modals allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" style="height:320px"></iframe></figure>`
}

/**
 * iu 卡片在截图页里的 CSS：宿主变量映射 + 复用 IU_CSS 原文。
 *
 * 两个要点：
 *  1. **映射 `--dsw-alias-*` 到截图卡片的调色板变量**。IU_CSS 是给宿主写的，
 *     用的是 DSH 的 alias 变量；截图页是另一套 `--card / --border / --accent`，
 *     不映射的话所有 `var()` 都落到兜底值（中性灰），暗色主题下尤其难看。
 *  2. **复用同一份 IU_CSS 原文**（从 client 半身 import），不重抄。抄一份就
 *     等于给自己留了一个「改了组件样式、截图没跟上」的漂移口子。
 */
function iuCssFor(theme: ShotTheme, zoom = 1): string {
  const dark = baseOf(theme) === 'dark'
  const vars = [
    `--dsw-alias-bg-layer-1:${dark ? 'rgba(255,255,255,.04)' : 'rgba(127,127,127,.04)'}`,
    '--dsw-alias-bg-layer-2:var(--card2, rgba(127,127,127,.10))',
    '--dsw-alias-border-l3:var(--border2)',
    '--dsw-alias-state-business-primary:var(--accent)',
  ].join(';')
  /*
   * 缩放档位写在 .dtt-iu 上（基座的 --iu-text-scale 会乘上它）。
   *
   * 钳到 [0.5, 3] 是防御：这个值来自请求体，脏数据不该把截图撑成一屏一个字。
   * 只对 iu 卡片生效 —— html 卡片在截图里是静态快照，模型自己写的页面尺寸
   * 由它自己的 CSS 决定，我们不改它（改了反而与对话流不一致）。
   */
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? Math.min(3, Math.max(0.5, zoom)) : 1
  const zoomRule = safeZoom === 1 ? '' : `\n.dtt-iu{--iu-zoom:${safeZoom}}`
  // 截图是定格：关掉入场动效，避免「抓第一帧抓到半透明」。
  return `.card{${vars}}\n${IU_CSS}${zoomRule}\n.dtt-iu{animation:none}`
}

/**
 * 把 ```html 围栏的 figure 插进正文：shiki 把 html 围栏渲染成
 * `<pre class="shiki …" …><code>…</code></pre>`，整块替换成 figure——
 * 与对话流一致，围栏就是卡片本身，不保留源码块。
 *
 * 定位用 `<pre class="shiki` + `language-html` 双特征：pre 的属性顺序由 shiki
 * 决定（class 在前），language-html 出现在 class 里；找不到就放弃该条（宁可
 * 少一张图，不劈句子）。
 */
function injectFences(body: string, fences: readonly ShotHtmlFence[]): string {
  if (fences.length === 0) return body
  let out = body
  fences.forEach((fence, index) => {
    // 顺序扫描剩余的 shiki 块，找第一个语言为 html 的（即本条围栏的落点）。
    let at = -1
    let cursor = 0
    for (;;) {
      const hit = out.indexOf('<pre class="shiki', cursor)
      if (hit < 0) break
      const tagEnd = out.indexOf('>', hit)
      if (tagEnd < 0) break
      if (out.slice(hit, tagEnd).indexOf('language-html') >= 0) { at = hit; break }
      cursor = tagEnd + 1
    }
    if (at < 0) return
    const tagEnd = out.indexOf('>', at)
    const preEnd = out.indexOf('</pre>', tagEnd)
    if (preEnd < 0) return
    out = out.slice(0, at) + fenceFigureOf(fence, index) + out.slice(preEnd + '</pre>'.length)
  })
  return out
}

/**
 * 截图页引导脚本：两件事。
 *
 *  1. 主题应答：内嵌围栏文档里的桥脚本就绪后会发 ready 要主题（与对话流同一
 *     握手），这里按截图主题回推 dark/light——不回的话暗色截图里围栏画布永远
 *     是白纸板。
 *  2. 高度落地：等每个内嵌 iframe 的高度桥上报，把 figure 撑到真实高度。按桥
 *     上报里的 fid 与 figure 的 data-fid 配对（**不**用 contentWindow 比对——
 *     无头 Chrome 里 srcdoc iframe 的窗口引用比对实测不可靠，高度永远停在兜底）；
 *     钳到 [40, 2400] 后写行内高度；首帧 320px 兜底，量不到就保持兜底，绝不让
 *     整张截图失败。
 */
function embedBoot(theme: ShotTheme): string {
  const dark = baseOf(theme) === 'dark'
  return `<script>
(function () {
  var DARK = ${dark ? 'true' : 'false'};
  var figures = Array.prototype.slice.call(document.querySelectorAll('figure.htmlfence'));
  var last = {};
  addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object' || data.source !== 'dsh-html-card') return;
    if (data.kind === 'ready') {
      try { event.source.postMessage({ source: 'dsh-html-card-host', kind: 'theme', dark: DARK }, '*'); } catch (e) {}
      return;
    }
    if (data.kind !== 'height') return;
    var h = data.height;
    if (typeof h !== 'number' || !isFinite(h) || typeof data.id !== 'string') return;
    h = Math.max(40, Math.min(2400, Math.round(h)));
    if (last[data.id] === h) return;
    last[data.id] = h;
    for (var i = 0; i < figures.length; i += 1) {
      if (figures[i].getAttribute('data-fid') === data.id) {
        var frame = figures[i].querySelector('iframe');
        if (frame) frame.style.height = h + 'px';
        break;
      }
    }
  });
})();
</script>`
}

/**
 * 把内嵌预览插进正文：定位到那条行内代码（<code>路径</code>）后，插到它所在
 * 块的收尾标签之后——句子保持完整，预览整块出现在段落下方。找不到收尾标签
 * 就就地替换；正文里根本没有这条路径的（裸路径写在句子里等），统一挂到正文
 * 末尾，图总比没有强。
 */
function injectEmbeds(body: string, embeds: readonly ShotEmbed[]): string {
  if (embeds.length === 0) return body
  let out = body
  const rest: ShotEmbed[] = []
  for (const embed of embeds) {
    const needle = `<code>${escapeHtml(embed.raw)}</code>`
    const at = out.indexOf(needle)
    if (at < 0) {
      rest.push(embed)
      continue
    }
    const tail = out.slice(at + needle.length)
    const close = BLOCK_END.exec(tail)
    const insertAt = close !== null && close.index >= 0 && close.index < 4000
      ? at + needle.length + close.index + close[0].length
      : at
    const inline = insertAt === at
    // 就地替换时把行内代码本身拿掉（预览就是它的内容）；插到块后就保留原句不动。
    out = out.slice(0, inline ? at : insertAt)
      + figureOf(embed)
      + out.slice(inline ? at + needle.length : insertAt)
  }
  return rest.length === 0 ? out : out + rest.map(figureOf).join('')
}

/**
 * 一条 iu 围栏的静态快照（截图管线用）。
 *
 * 对话流里它是可交互的原生卡片；截图页没有 React 运行时，只能按当前值定格。
 * **但 DOM 结构与 class 必须与 IuCard 逐字一致**——内联同一份 IU_CSS 后，
 * 截图里长出来的就是真卡片的样子，而不是另画一套简化版（那样两处必然漂移：
 * 截图里的柱子和对话流里的不一样高、配色不一样、清单少了勾选框）。
 */
export interface ShotIuFence {
  readonly title: string
  readonly tag: string
  readonly body: string
}

/** 与 IuCard 的 Head 同构（class 对齐，才能吃到 IU_CSS）。 */
function iuFigureOf(fence: ShotIuFence): string {
  return `<figure class="dtt-iu"><div class="dtt-iu__head"><span class="dtt-iu__dot"></span>`
    + `<span class="dtt-iu__title">${escapeHtml(fence.title)}</span>`
    + `<span class="dtt-iu__tag">${escapeHtml(fence.tag)}</span></div>`
    + `<div>${fence.body}</div></figure>`
}

function injectIu(body: string, fences: readonly ShotIuFence[]): string {
  if (fences.length === 0) return body
  let out = body
  const rest: ShotIuFence[] = []
  for (const fence of fences) {
    let at = -1
    let cursor = 0
    for (;;) {
      const hit = out.indexOf('<pre class="shiki', cursor)
      if (hit < 0) break
      const tagEnd = out.indexOf('>', hit)
      if (tagEnd < 0) break
      if (out.slice(hit, tagEnd).indexOf('language-iu') >= 0) { at = hit; break }
      cursor = tagEnd + 1
    }
    if (at < 0) {
      rest.push(fence)
      continue
    }
    const tagEnd = out.indexOf('>', at)
    const preEnd = out.indexOf('</pre>', tagEnd)
    if (preEnd < 0) continue
    out = out.slice(0, at) + iuFigureOf(fence) + out.slice(preEnd + '</pre>'.length)
  }
  return rest.length === 0 ? out : out + rest.map(iuFigureOf).join('')
}

/**
 * 组装完整截图 HTML 文档。
 * @param input - 消息、主题、尺寸与文案。
 * @returns HTML 文本与「是否需要 mermaid 引擎」标记。
 */
export async function buildCardHtml(input: ShotCardInput): Promise<ShotCardOutput> {
  const { messages, theme, width, minHeight } = input
  const embeds = input.embeds ?? []
  const first = messages[0]
  if (first === undefined) throw new Error('没有可渲染的消息')
  const title = (input.title ?? '').trim() !== ''
    ? (input.title as string).trim()
    : deriveTitle(first.text, first.role)
  const multi = messages.length > 1
  const chars = messages.reduce((sum, message) => sum + message.text.length, 0)
  const chip = (input.label ?? '').trim() !== ''
    ? (input.label as string).trim()
    : multi ? `${messages.length} 条消息` : (first.role === 'user' ? '提问' : 'AI 回复')
  const sections: string[] = []
  let hasFenceEmbed = false
  let hasIuFence = false
  for (const message of messages) {
    let body = injectEmbeds(await bodyOf(message, theme), embeds)
    // ```html / ```iu 围栏与对话流同源切分（streaming=false：未闭合/超长一律
    // 回退代码块，与对话流定稿态语义一致）。只有 assistant 正文走 Markdown 管线，
    // user 的围栏不会成 pre，切了也无处替换。
    // filter 必须写成**类型谓词**：普通箭头函数只做布尔收窄，`.map` 那侧
    // 拿到的仍是联合类型（HtmlPart），`part.spec` 直接编译不过。
    const fences: ShotHtmlFence[] = message.role === 'assistant'
      ? splitHtml(clamp(message.text))
        .filter((part): part is Extract<typeof part, { kind: 'html' }> => part.kind === 'html' && part.pending === false)
        .map(part => ({ html: part.spec.html, title: part.spec.title }))
      : []
    if (fences.length > 0) {
      body = injectFences(body, fences)
      hasFenceEmbed = true
    }
    // iu 快照：静态定格（无 JS、无交互），多张照单全收——A 的混排在截图里同样混排。
    //
    // 快照正文与角标**全部委派给 kind 注册表**（kinds/registry.ts）：每个 kind
    // 自带 snapshot() 与 label，这里不再有手写的 kind 分支。历史上这段是 150 行
    // 手写镜像（iuBodyOf），出过两次漂移事故：钢琴卡被标成「对比」（三元链兜底）、
    // 琴键少两层容器变成阶梯（DOM 重排）。现在镜像逻辑就在 kind 模块自己身上，
    // 与对话流共用同一份几何/布局函数，漏改会编译不过。
    if (message.role === 'assistant') {
      const iuFences: ShotIuFence[] = []
      for (const part of splitIu(clamp(message.text), false)) {
        if (part.kind !== 'iu' || part.pending !== false) continue
        const mod = iuKindOf(part.spec.kind)
        // 注册表查不到的 kind 理论上不存在（splitIu 只放行注册过的 kind），
        // 防御性跳过：截图是定格降级，不认识的结构宁可不画也不崩整张卡。
        if (mod === undefined) continue
        iuFences.push({
          title: part.spec.title !== '' ? part.spec.title : '交互卡片',
          tag: mod.label,
          body: mod.snapshot(part.spec as never),
        })
      }
      if (iuFences.length > 0) {
        body = injectIu(body, iuFences)
        hasIuFence = true
      }
    }
    sections.push(multi
      ? `<section class="seg"><div class="seg-role">${message.role === 'user' ? '我' : 'AI'}</div>${body}</section>`
      : body)
  }
  const note = `${multi ? `${messages.length} 条消息 · ` : ''}${chars.toLocaleString('zh-CN')} 字`
  // 只有 assistant 正文走 Markdown 管线，user 是纯文本（围栏不会成图）。
  const needsMermaid = messages.some(m => m.role === 'assistant' && hasDiagramFence(clamp(m.text)))
  // 多条消息时段与段之间加细线与角色标签（单条不需要额外分隔）。
  const segCss = multi
    ? `.seg{border-top:1px solid var(--border2)}
.seg:first-child{border-top:none}
.seg-role{padding:calc(var(--pad) * .5) var(--pad) 0;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--fg3)}
.seg .content{padding-top:calc(var(--pad) * .3)}`
    : ''
  const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=${width}">
<style>${buildCardCss(theme, width, minHeight)}
${segCss}
${hasIuFence ? iuCssFor(theme, input.zoom) : ''}</style></head>
<body><div class="card">
<div class="rail"></div>
<header class="head">
  <span class="mark">${whale(20, 15)}</span>
  <span class="brand">DeepSeek Harness</span>
  <span class="chip">${escapeHtml(chip)}</span>
  <span class="stamp">${stampNow()}</span>
</header>
<h1 class="title">${escapeHtml(title)}</h1>
${sections.join('\n')}
<footer class="foot">
  <span class="whale">${whale(18, 13)}</span>
  <span class="sign">DeepSeek Harness</span>
  <span class="right">${note}</span>
</footer>
</div>${needsMermaid ? `\n${mermaidBoot(theme)}` : ''}${hasFenceEmbed ? `\n${embedBoot(theme)}` : ''}</body></html>`
  return { html, needsMermaid, hasFenceEmbed }
}
