/**
 * dsh-chat-plus — html 卡片宿主侧装配（iframe 文档拼装 + 沙箱桥）。
 *
 * 对齐官方 MCP Apps widget 的做法，三件事一一对应：
 *
 *   · **资源**：官方是 tool 返回 `ui://widget/x.html`（`text/html;profile=mcp-app`），
 *     这里是围栏正文 → srcDoc 内联文档，不落盘、不占 URL。
 *   · **沙箱**：官方 widget 跑在 opaque origin 里，脚本能跑但拿不到宿主。
 *     这里给 `sandbox="allow-scripts"` 而**不给** `allow-same-origin`——
 *     这是本文件唯一的硬安全约束。内容来自模型输出，一旦带上 allow-same-origin
 *     就能读宿主 DOM、拿会话数据；两者同时给等于没有沙箱（浏览器也会告警）。
 *     代价是宿主读不到 iframe 内部 DOM，高度必须靠 postMessage 上报。
 *   · **动态高度**：官方 `notifyIntrinsicHeight()`，这里注入一小段 bridge 脚本，
 *     用 ResizeObserver + MutationObserver 观察文档尺寸并回报宿主。
 *
 * 宿主侧对收到的消息做三重校验（来源窗口 / source 标记 / 数值范围），
 * 不信任任何来自 iframe 的内容——它只被允许改变一件事：自己的显示高度。
 */

/** 桥消息命名空间：iframe → 宿主。 */
export const BRIDGE_TO_HOST = 'dsh-html-card'

/** 桥消息命名空间：宿主 → iframe（主题同步）。 */
export const BRIDGE_TO_FRAME = 'dsh-html-card-host'

/** 高度硬上限（px）：模型可以画很高的页面，但不能把对话流撑爆。 */
export const MAX_FRAME_HEIGHT = 4000

/** 高度下限（px）：内容极少时也留出可读的一屏，避免塌成一条线。 */
export const MIN_FRAME_HEIGHT = 40

/**
 * 注入进 iframe 的 bridge 脚本（iframe 内运行，opaque origin）。
 *
 * 刻意写成 ES5 风格 + 全 try/catch：模型给的页面可能自带严格的 CSP meta
 * 或改写原型，任何一处抛错都不能让高度上报整条链路失效（那会让卡片永远
 * 停在初始高度）。
 *
 * 为什么同时挂 ResizeObserver 与 MutationObserver：前者只在元素尺寸变化时
 * 触发，而「内容变多但根元素尺寸由样式固定」的页面（flex + overflow）只
 * 会有后者命中；反过来纯 canvas 重绘只会有前者命中。两条都挂，去重交给
 * 宿主的差值判断。
 */
const BRIDGE_SOURCE = [
  '(function () {',
  '  var NS = ' + JSON.stringify(BRIDGE_TO_HOST) + ';',
  '  var HOST = ' + JSON.stringify(BRIDGE_TO_FRAME) + ';',
  '  var last = -1;',
  '  function measure() {',
  '    try {',
  '      var d = document.documentElement;',
  '      var b = document.body;',
  '      var h = Math.max(',
  '        d ? d.scrollHeight : 0,',
  '        d ? d.offsetHeight : 0,',
  '        b ? b.scrollHeight : 0,',
  '        b ? b.offsetHeight : 0',
  '      );',
  '      if (!(h > 0)) return;',
  '      h = Math.ceil(h);',
  '      if (Math.abs(h - last) < 2) return;',
  '      last = h;',
  '      parent.postMessage({ source: NS, kind: "height", height: h }, "*");',
  '    } catch (e) {}',
  '  }',
  '  var queued = false;',
  '  function schedule() {',
  '    if (queued) return;',
  '    queued = true;',
  '    requestAnimationFrame(function () { queued = false; measure(); });',
  '  }',
  '  function start() {',
  '    measure();',
  '    try {',
  '      if (typeof ResizeObserver === "function") {',
  '        var ro = new ResizeObserver(schedule);',
  '        if (document.documentElement) ro.observe(document.documentElement);',
  '        if (document.body) ro.observe(document.body);',
  '      }',
  '    } catch (e) {}',
  '    try {',
  '      if (typeof MutationObserver === "function") {',
  '        new MutationObserver(schedule).observe(document.documentElement || document, {',
  '          childList: true, subtree: true, attributes: true, characterData: true',
  '        });',
  '      }',
  '    } catch (e) {}',
  '    try {',
  '      addEventListener("load", measure);',
  '      addEventListener("resize", schedule);',
  '      // 字体晚到会把文字撑高，这条是高度上报最常漏的一次变化。',
  '      if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);',
  '    } catch (e) {}',
  '    // 起步阶段连打几帧：图片/字体在头几百毫秒里陆续落地，只测一次必然偏矮。',
  '    var ticks = 0;',
  '    var timer = setInterval(function () {',
  '      measure();',
  '      ticks += 1;',
  '      if (ticks > 12) clearInterval(timer);',
  '    }, 250);',
  '  }',
  '  addEventListener("message", function (event) {',
  '    var data = event && event.data;',
  '    if (!data || data.source !== HOST) return;',
  '    try {',
  '      if (data.kind === "theme") {',
  '        applyTheme(!!data.dark);',
  '        schedule();',
  '      } else if (data.kind === "ping") {',
  '        measure();',
  '      }',
  '    } catch (e) {}',
  '  });',
  '  function applyTheme(dark) {',
  '    var root = document.documentElement;',
  '    if (!root) return;',
  '    // 关键：亮色必须**移除属性**而不是设成 "false"。',
  '    // CSS 选择器 html[data-ds-dark-theme] 只看属性在不在，写 "false" 一样命中，',
  '    // 于是模型写的两套配色在亮色下也会走暗色那套（实测踩过）。',
  '    if (dark) root.setAttribute("data-ds-dark-theme", "");',
  '    else root.removeAttribute("data-ds-dark-theme");',
  '    root.style.colorScheme = dark ? "dark" : "light";',
  '  }',
  '  /**',
  '   * 主动向宿主要主题。',
  '   *',
  '   * 不能只等宿主推：srcDoc 是异步解析的，宿主挂载 iframe 那一刻发的那条',
  '   * postMessage 往往早于本脚本注册监听，消息直接丢掉（表现为卡片永远是亮色）。',
  '   * 由 iframe 侧在就绪后发 ready，宿主收到再回推，握手才可靠。',
  '   */',
  '  function requestTheme() {',
  '    try { parent.postMessage({ source: NS, kind: "ready" }, "*"); } catch (e) {}',
  '  }',
  '  if (document.readyState === "loading") {',
  '    addEventListener("DOMContentLoaded", function () { requestTheme(); start(); });',
  '  } else {',
  '    requestTheme();',
  '    start();',
  '  }',
  '})();',
].join('\n')

/**
 * iframe 文档的基础样式。
 *
 * 只做三件必要的事，绝不「美化」模型给的页面：
 *  1. 干掉默认 margin —— 否则任何页面下方都会多出 8px，高度上报跟着虚高。
 *  2. `overflow: hidden` —— 高度由宿主给，页面自己不该出现滚动条。
 *  3. `color-scheme` —— 让原生控件（滚动条、表单）跟随主题，不写就永远是亮色。
 *
 * 两条都是低优先级的兜底：`html` 不带 !important，且按「片段」路径时插在
 * `<head>` 开头、按「完整文档」路径时插在 body 末尾——后者是刻意的，模型若
 * 自己写了 `body{margin:16px}`，那是它的设计意图，不该被兜底样式压掉。
 */
const BASE_STYLE = [
  'html,body{margin:0;padding:0;}',
  'html{overflow:hidden;}',
  'html{color-scheme:light;}',
  'html[data-ds-dark-theme]{color-scheme:dark;}',
].join('')

/**
 * 把围栏正文拼成完整 iframe 文档。
 *
 * 分支处理：
 *  · 已含 `<html`（完整文档）→ base 与兜底样式插进 `<head>`（尽量靠前，让模型的
 *    样式能覆盖它们），bridge 插在 `</body>` 之前；
 *  · 片段（只有 div / svg / script）→ 用最小骨架包一层。
 *
 * 插入位置是**功能性的**，不是洁癖：兜底样式若插在 body 末尾，会盖掉模型自己
 * 写的 `body{margin:...}`——那是它的设计意图，不该被我们的兜底压掉。而 bridge
 * 必须在 body 末尾，否则 `document.body` 还不存在，第一帧量不到高度。
 *
 * `<base target="_blank">` 是刻意加的：opaque origin 下页面内点击链接会尝试在
 * iframe 自身导航，用户点一下就永久失去卡片内容且回不去。target=_blank 把导航
 * 交给宿主浏览器的新标签页（需要 sandbox 的 allow-popups）。
 */
export function assembleHtmlDocument(html: string): string {
  const base = '<base target="_blank">'
  const style = '<style>' + BASE_STYLE + '</style>'
  const script = '<script>' + BRIDGE_SOURCE + '<\/script>'
  const head = base + style

  if (/<html[\s>]/i.test(html)) {
    // head 里插兜底（靠前，可被模型样式覆盖）；没有 head 就退到 <html> 之后。
    let out = html
    if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (match) => match + head)
    else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (match) => match + head)
    else out = head + out
    // bridge 放 body 末尾，拿不到 body 就放 </html> 前，再不行直接追加。
    if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, script + '</body>')
    if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, script + '</html>')
    return out + script
  }
  return '<!doctype html><html><head><meta charset="utf-8">' + head
    + '</head><body>' + html + script + '</body></html>'
}
