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
 * 内容缩放范围（宿主下发，iframe 内应用）。
 *
 * 为什么缩放必须作用在 **iframe 内部**而不是外层容器：高度桥上报的是 iframe
 * 内部的内容高度（px），外层再用 transform/zoom 放大，报上去的 px 就与实际
 * 占用不符 —— 放大会溢出被裁、缩小会留一大片空白。在内部缩放时，内部布局
 * 尺寸随缩放一起变，上报的高度天然是对的。
 *
 * 下限 0.5 / 上限 3 是防御：这个值经 postMessage 过来，模型页面理论上也能伪造
 * （虽然它拿不到我们的命名空间，但钳住更稳）。
 */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3

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
  // 帧 id：由 assembleHtmlDocument 注入（截图页靠它在多条内嵌围栏里定位上报来源；
  // 对话流单帧场景为空串，宿主侧忽略该字段）。实测无头 Chrome 里 sandbox iframe 的
  // contentWindow 与 event.source 比对不可靠，id 是确定性的匹配键。
  '  var FID = __DSH_FRAME_ID__;',
  '  var last = -1;',
  '  function measure() {',
  '    try {',
  '      var d = document.documentElement;',
  '      var b = document.body;',
  '      // 只量 body 的内容高度：**不取 documentElement 的 offset/scrollHeight**——',
  '      // html 是 overflow:hidden，它的 scroll/offsetHeight 永远 ≥ 视口高度，宿主',
  '      // 首帧给兜底高度时这里会把兜底值原样报回去，矮内容被永久锁在兜底高度',
  '      // （截图页 320px 兜底实测踩中）。body 高度 auto 时这两个值就是内容真高。',
  '      var h = Math.max(',
  '        b ? b.scrollHeight : 0,',
  '        b ? b.offsetHeight : 0',
  '      );',
  '      if (!(h > 0) && d) h = Math.max(d.scrollHeight, d.offsetHeight);',
  '      if (!(h > 0)) return;',
  '      /*',
  '       * 内容缩放修正（实测踩中）：CSS zoom 下 scrollHeight / offsetHeight 返回的',
  '       * 是**未缩放**的布局值，而元素实际占用的是缩放后的高度。不上报修正值的话，',
  '       * 宿主按未缩放高度给框，放大后内容会被裁掉、缩小后留一大片空白。',
  '       * 用 getBoundingClientRect()（返回**缩放后**的视觉尺寸）兜底，两者取大。',
  '       */',
  '      try {',
  '        if (b && b.getBoundingClientRect) {',
  '          var rectH = b.getBoundingClientRect().height;',
  '          if (rectH > h) h = rectH;',
  '        }',
  '      } catch (e) {}',
  '      h = Math.ceil(h);',
  '      if (Math.abs(h - last) < 2) return;',
  '      last = h;',
  '      parent.postMessage({ source: NS, kind: "height", height: h, id: FID }, "*");',
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
  '      } else if (data.kind === "zoom") {',
  '        applyZoom(data.zoom);',
  '        schedule();',
  '      } else if (data.kind === "ping") {',
  '        measure();',
  '      }',
  '    } catch (e) {}',
  '  });',
  '  /**',
  '   * 应用内容缩放（宿主下发的档位）。',
  '   *',
  '   * 用 CSS `zoom` 而不是 transform: scale：zoom 会真正参与布局，元素占位随',
  '   * 缩放一起变，高度桥量到的就是缩放后的真实高度（transform 不改布局，量出来',
  '   * 还是原尺寸，宿主给的框会与视觉不符）。',
  '   *',
  '   * 挂在 body 上而不是 html：html 上有 overflow:hidden 与背景，缩放 html 会让',
  '   * 背景与视口对不齐；body 缩放时 html 仍是满视口，背景正常铺满。',
  '   *',
  '   * 钳到 [ZOOM_MIN, ZOOM_MAX]：这个值来自 postMessage，不能无条件信。',
  '   * 非数字（NaN / 字符串 / 负数）一律**归 1**而不是忽略：忽略会让画面停在',
  '   * 上一个档位，用户点「缩小」却没反应；归 1 至少回到可读的常态。',
  '   */',
  '  function applyZoom(value) {',
  '    var b = document.body;',
  '    if (!b) return;',
  '    var z = Number(value);',
  '    if (!isFinite(z) || z <= 0) z = 1;',
  '    z = Math.min(' + ZOOM_MAX + ', Math.max(' + ZOOM_MIN + ', z));',
  '    if (z === 1) b.style.zoom = "";',
  '    else b.style.zoom = String(z);',
  '  }',
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
  '   * 卡片内主动回写输入草稿（Intelligent UI 式回写）。',
  '   *',
  '   * 模型在页面里放一个按钮，点一下就把当前结果（如计算器得数、份量换算）',
  '   * 推给宿主写进输入草稿，由用户检查后发送。宿主只接受 text 一个字段',
  '   * （≤2000 字），写草稿前不执行任何内容——推过去的只是输入框里的文字。',
  '   */',
  '  function requestFill(text) {',
  '    try {',
  '      if (typeof text !== "string") return false;',
  '      var clean = text.trim().slice(0, 2000);',
  '      if (clean === "") return false;',
  '      parent.postMessage({ source: NS, kind: "fill", text: clean, id: FID }, "*");',
  '      return true;',
  '    } catch (e) { return false; }',
  '  }',
  '  try { window.__dshFill = requestFill; } catch (e) {}',
  '  /**',
  '   * 主动向宿主要主题。',
  '   *',
  '   * 不能只等宿主推：srcDoc 是异步解析的，宿主挂载 iframe 那一刻发的那条',
  '   * postMessage 往往早于本脚本注册监听，消息直接丢掉（表现为卡片永远是亮色）。',
  '   * 由 iframe 侧在就绪后发 ready，宿主收到再回推，握手才可靠。',
  '   */',
  '  function requestTheme() {',
  '    try { parent.postMessage({ source: NS, kind: "ready", id: FID }, "*"); } catch (e) {}',
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
  // 背景跟主题：模型页面（尤其片段）常常不自带 body 背景，iframe 画布默认纯白，
  // 暗色主题下等于在总结卡里贴一块白纸板。这里补一层与宿主对齐的中性底色，
  // 暗色值与官方 --dsw-static-neutral-bluish-1000 同值（iframe 内拿不到宿主变量，
  // 只能写死）；transition 让主题切换时底色渐变而不是硬跳。
  // 优先级刻意最低（无 !important、插在 head 最前）：模型自己写了背景照样盖掉它。
  'html{background:#fff;transition:background-color .25s ease;}',
  'html{color-scheme:light;}',
  'html[data-ds-dark-theme]{background:#16181d;color-scheme:dark;}',
].join('')

/**
 * 截图定格样式：把 CSS 动画与过渡一次性推到终态。
 *
 * **为什么需要**：截图管线只等字体与图片（见 `src/shot/renderer.ts` 的 settleJs），
 * **不等动画**。卡片正文里但凡有入场动画（`opacity:0` + `animation-delay`），抓帧时
 * 元素还停在起始帧，截出来就是「内容缺了一大半」——实测一张五段入场动画的卡片只
 * 出现第一段，其余四段连同图形整块消失，而且没有任何报错（管线只关心字体与图片）。
 *
 * **为什么不是 `animation:none`**：那会让 `opacity:0` 的元素**永久不可见**——动画
 * 正是唯一让它显现的机制，砍掉动画等于把「暂时的透明」变成「永久的透明」，比原问题
 * 更严重。正确做法是让动画**立刻跑完**：delay 归零 + duration 压到 1ms + 只跑一遍 +
 * forwards 停在终态，最终视觉状态与用户在对话流里看到的一致，只是省掉了时间轴。
 *
 * `iteration-count:1` 用来收住 `infinite` 的装饰动画（呼吸点、流光）：不限的话 1ms
 * 周期会疯狂闪烁，抓帧落在哪一帧全看运气；限制后停在终态，画面是静止的。
 * `transition-duration:0s` 同理——过渡中途的半透明也是一种「没渲染完」。
 *
 * 必须带 `!important`：模型自己的样式表通常写在 body 里，位置比这里靠前；不带
 * `!important` 会被同 specificity 的后者压回去，定格就失效了。
 */
const SETTLE_STYLE = [
  '*,*::before,*::after{',
  'animation-delay:0s !important;',
  'animation-duration:1ms !important;',
  'animation-iteration-count:1 !important;',
  'animation-fill-mode:forwards !important;',
  'transition-duration:0s !important;',
  'transition-delay:0s !important;',
  '}',
].join('')

/** `assembleHtmlDocument` 的装配选项。 */
export interface AssembleOptions {
  /**
   * 截图定格模式：把 CSS 动画/过渡一次性推到终态，保证抓帧时内容已全部可见。
   *
   * 只有截图管线该传 true —— 对话流里的卡片是活的，动效必须原样保留。
   */
  readonly settleAnimations?: boolean
}

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
 * 定格样式（`settleAnimations`）是唯一的例外，它**刻意**排在文档最后（与 bridge
 * 同位置）：它的职责就是压过模型样式，位置靠后 + `!important` 双保险。
 *
 * `<base target="_blank">` 是刻意加的：opaque origin 下页面内点击链接会尝试在
 * iframe 自身导航，用户点一下就永久失去卡片内容且回不去。target=_blank 把导航
 * 交给宿主浏览器的新标签页（需要 sandbox 的 allow-popups）。
 *
 * @param fid 帧 id：写进 bridge 的高度/ready 上报，供多内嵌宿主（截图页）按 id
 *   定位来源。对话流单帧传空串即可；**必须**替换占位符，否则 bridge 直接语法错。
 * @param options 装配选项（截图定格见 `AssembleOptions`）。
 */
export function assembleHtmlDocument(html: string, fid = '', options: AssembleOptions = {}): string {
  const base = '<base target="_blank">'
  const style = '<style>' + BASE_STYLE + '</style>'
  const script = '<script>' + BRIDGE_SOURCE.replace('__DSH_FRAME_ID__', JSON.stringify(fid)) + '<\/script>'
  // 定格样式与 bridge 一起放文档最后：bridge 需要在 body 末尾，定格需要压过模型样式。
  const settle = options.settleAnimations === true ? '<style>' + SETTLE_STYLE + '</style>' : ''
  const head = base + style
  const tail = settle + script

  if (/<html[\s>]/i.test(html)) {
    // head 里插兜底（靠前，可被模型样式覆盖）；没有 head 就退到 <html> 之后。
    let out = html
    if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (match) => match + head)
    else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (match) => match + head)
    else out = head + out
    // tail 放 body 末尾，拿不到 body 就放 </html> 前，再不行直接追加。
    // 一律用函数式替换：tail 里若出现 `$&` 之类的字符，字符串形式会被当成替换模式。
    if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, () => tail + '</body>')
    if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, () => tail + '</html>')
    return out + tail
  }
  return '<!doctype html><html><head><meta charset="utf-8">' + head
    + '</head><body>' + html + tail + '</body></html>'
}
