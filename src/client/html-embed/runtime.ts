/**
 * dsh-chat-plus — HTML 卡片的共享运行时（P2）。
 *
 * 三个小能力，共同点是：**模型自己写十次有九次写不对，写好了一次也只是重复劳动**。
 *
 *   · tooltip —— `data-tooltip="…"` 属性，零 JS、零 DOM 结构。
 *   · tabs    —— `.nav[role="tablist"]` 自动接管点击与方向键。
 *   · state   —— `__dshState.set({…})` 把交互状态回传给宿主持久化。
 *
 * ## 三条硬约束（改这段前先读）
 *
 *  1. **不引任何外部库**。ZCode 那套靠 floating-ui / lucide 的 CDN，DSH 沙箱是
 *     opaque origin + 可能离线，一个 `<script src>` 都引不进来。所以定位全靠
 *     `getBoundingClientRect` 手算，图标一律让模型用内联 SVG 或字符。
 *  2. **按需注入**。三个能力各判各的：正文里没有 `data-tooltip` 就不带 tooltip，
 *     没有 `role="tablist"` 就不带 tabs。全量注入会让每张卡多背 5KB。
 *  3. **失败必须静默**。这里任何一段抛错都不能影响高度上报链路（那会让卡片
 *     永远停在初始高度）。所以每段外层都包 try/catch。
 *
 * 运行环境是 opaque origin 的 iframe：拿不到宿主 DOM、localStorage 可用但
 * 不跨源共享、postMessage 的 targetOrigin 只能是 "*"。
 */

/**
 * tooltip 运行时。
 *
 * 交互口径（对齐桌面端常见行为，不是随便定的）：
 *  · hover 延迟 700ms 才出 —— 鼠标划过大片区域时不该一路冒泡；
 *  · 已经在显示时划到下一个目标**立即**切换（skipDelay），否则连续查看要等死人；
 *  · 移出延迟关闭 120ms —— 给「从触发区移进 tooltip」留余量；
 *  · 键盘 focus-visible 立即显示（无障碍要求，不能只支持鼠标）；
 *  · 触摸点按显示、点别处关闭（桌面 hover 语义在触屏上不成立）；
 *  · Escape 关闭，滚动/窗口变化时关闭（固定定位的元素跟着滚会飘）。
 *
 * 定位用 `position:fixed` + 手算：优先上方，放不下翻下方，左右钳进视口。
 * 不用 `position:absolute` 是因为卡片内部可能有 `overflow:hidden` 的祖先。
 */
const TOOLTIP_JS = `
(function () {
  try {
    var SHOW_DELAY = 700, HIDE_DELAY = 120, GAP = 6, EDGE = 8;
    var tip = null, active = null, showTimer = 0, hideTimer = 0, skipShow = false;

    function ensureTip() {
      if (tip !== null) return tip;
      tip = document.createElement("div");
      tip.className = "dsh-tip";
      tip.setAttribute("role", "tooltip");
      var s = tip.style;
      s.position = "fixed"; s.left = "0"; s.top = "0";
      s.zIndex = "2147483647"; s.maxWidth = "min(320px, calc(100vw - 16px))";
      s.padding = "6px 10px"; s.borderRadius = "7px";
      s.font = "400 12.5px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
      s.pointerEvents = "none"; s.opacity = "0";
      /*
       * 淡入动效给「有这个偏好的人」看，但必须尊重减弱动效偏好——
       * 前庭功能敏感的用户开这个不是为了看淡入。不写这条时，系统级设置
       * 在本卡片里完全失效（iframe 里没有别的样式会兜这个）。
       */
      try {
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
          s.transition = "opacity .12s ease";
        }
      } catch (e) {}
      s.background = "light-dark(#1f2126,#f2f3f5)";
      s.color = "light-dark(#f2f3f5,#16181d)";
      s.boxShadow = "0 4px 16px rgba(0,0,0,.18)";
      s.whiteSpace = "normal"; s.wordBreak = "break-word";
      document.body.appendChild(tip);
      return tip;
    }

    function place(trigger) {
      var el = ensureTip();
      var r = trigger.getBoundingClientRect();
      var w = el.offsetWidth, h = el.offsetHeight;
      var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      var x = r.left + r.width / 2 - w / 2;
      x = Math.max(EDGE, Math.min(x, vw - w - EDGE));
      var y = r.top - h - GAP;
      if (y < EDGE) y = r.bottom + GAP;
      if (y + h > vh - EDGE) y = Math.max(EDGE, vh - h - EDGE);
      el.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }

    function show(trigger) {
      var text = trigger.getAttribute("data-tooltip");
      if (text === null) return;
      text = text.trim();
      if (text === "") return;
      var el = ensureTip();
      el.textContent = text;
      el.style.opacity = "0";
      // 先放上去量尺寸（opacity 0 仍占位、可测量），再定位再淡入。
      el.style.transform = "translate(-9999px,-9999px)";
      place(trigger);
      el.style.opacity = "1";
      active = trigger;
    }

    function hide() {
      clearTimeout(showTimer); clearTimeout(hideTimer);
      if (active !== null && tip !== null) tip.style.opacity = "0";
      active = null;
    }

    function scheduleShow(trigger) {
      clearTimeout(showTimer); clearTimeout(hideTimer);
      if (active === trigger) return;
      if (active !== null || skipShow) { show(trigger); skipShow = false; return; }
      showTimer = setTimeout(function () { show(trigger); }, SHOW_DELAY);
    }

    function scheduleHide() {
      clearTimeout(showTimer);
      if (active === null) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { hide(); skipShow = true; }, HIDE_DELAY);
    }

    function triggerOf(e) {
      var n = e.target;
      while (n !== null && n !== undefined && n.nodeType === 1) {
        if (n.hasAttribute && n.hasAttribute("data-tooltip")) return n;
        n = n.parentNode;
      }
      return null;
    }

    document.addEventListener("pointerover", function (e) {
      if (e.pointerType === "touch") return;
      var t = triggerOf(e);
      if (t === null || (active !== null && active.contains(e.relatedTarget))) return;
      scheduleShow(t);
    }, true);
    document.addEventListener("pointerout", function (e) {
      if (e.pointerType === "touch") return;
      var t = triggerOf(e);
      if (t === null || (active !== null && active.contains(e.relatedTarget))) return;
      scheduleHide();
    }, true);
    document.addEventListener("focusin", function (e) {
      var t = triggerOf(e);
      if (t !== null && t.matches(":focus-visible")) { skipShow = true; scheduleShow(t); }
    }, true);
    document.addEventListener("focusout", function () { scheduleHide(); }, true);
    document.addEventListener("click", function (e) {
      var t = triggerOf(e);
      if (t === null) { hide(); return; }
      if (active === t) { hide(); return; }
      skipShow = true; scheduleShow(t);
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hide();
    }, true);
    addEventListener("scroll", hide, true);
    addEventListener("resize", hide);
  } catch (e) {}
})();
`;

/**
 * tabs 运行时。
 *
 * 只认「WAI-ARIA 标准写法」：`.nav[role="tablist"]` 里放 `[role="tab"]`，
 * 每个 tab 用 `aria-controls` 指向对应 `[role="tabpanel"]`。
 *
 * 为什么不让模型自己写 JS：一是重复劳动，二是**绝大多数模型实现都漏掉方向键**
 * （ARIA APG 的 tabs 模式要求 ArrowLeft/Right + Home/End），键盘用户直接卡死。
 *
 * 全选口径：`aria-selected` 与 `.active` 同时维护——前者给读屏，后者给样式。
 */
const TABS_JS = `
(function () {
  try {
    var LIST = '[role="tablist"]', TAB = '[role="tab"]';

    function panelOf(tab) {
      var id = tab.getAttribute("aria-controls");
      return id === null ? null : document.getElementById(id);
    }

    function select(list, tab) {
      var tabs = list.querySelectorAll(TAB);
      var target = panelOf(tab);
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i], on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
        var p = panelOf(t);
        if (p !== null) {
          p.hidden = !on;
          if (on && tab.id) p.setAttribute("aria-labelledby", tab.id);
        }
      }
      if (target !== null) target.hidden = false;
    }

    function listOf(node) {
      var n = node;
      while (n !== null && n !== undefined && n.nodeType === 1) {
        if (n.matches && n.matches(LIST)) return n;
        n = n.parentNode;
      }
      return null;
    }

    function init() {
      var lists = document.querySelectorAll(LIST);
      for (var i = 0; i < lists.length; i++) {
        var list = lists[i];
        if (list.getAttribute("data-dsh-tabs") === "1") continue;
        list.setAttribute("data-dsh-tabs", "1");
        var tabs = list.querySelectorAll(TAB);
        var current = null;
        for (var j = 0; j < tabs.length; j++) {
          if (tabs[j].getAttribute("aria-selected") === "true") { current = tabs[j]; break; }
        }
        if (current === null && tabs.length > 0) current = tabs[0];
        if (current !== null) select(list, current);
      }
    }

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t === null || t === undefined || !t.closest) return;
      var tab = t.closest(TAB);
      if (tab === null) return;
      var list = listOf(tab);
      if (list === null || tab.disabled || tab.getAttribute("aria-disabled") === "true") return;
      select(list, tab);
    }, true);

    document.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t === null || t === undefined || !t.closest) return;
      var tab = t.closest(TAB);
      if (tab === null) return;
      var list = listOf(tab);
      if (list === null) return;
      var all = list.querySelectorAll(TAB), usable = [];
      for (var i = 0; i < all.length; i++) {
        if (!all[i].disabled && all[i].getAttribute("aria-disabled") !== "true") usable.push(all[i]);
      }
      if (usable.length === 0) return;
      var at = usable.indexOf(tab), next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = usable[(at + 1) % usable.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = usable[(at + usable.length - 1) % usable.length];
      else if (e.key === "Home") next = usable[0];
      else if (e.key === "End") next = usable[usable.length - 1];
      else return;
      e.preventDefault();
      next.focus();
      select(list, next);
    }, true);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else init();
  } catch (e) {}
})();
`;

/**
 * 状态回传运行时。
 *
 * 语义与 ZCode 的 `widgetState` 一致，但**只保留最必要的一层**：一个 JSON 对象，
 * 宿主替模型存，刷新后自动推回来。
 *
 * 为什么不直接给 iframe 开 localStorage：可以开（opaque origin 下 localStorage
 * 是可用的），但那样状态只活在这一张卡片的这个 iframe 实例里，卡片重挂载/换
 * 会话就丢。走宿主存才能跨挂载恢复。
 *
 * 安全口径与 fill 通道完全一致：宿主只接受一个 JSON 对象，序列化后 ≤16 KiB，
 * 其余一律丢弃。**状态里不该放任何敏感数据**——它会原样留在宿主存储里。
 */
const STATE_JS = `
(function () {
  try {
    var NS = "dsh-html-card";
    var current = null;
    var waiters = [];

    function notify() {
      var list = waiters; waiters = [];
      for (var i = 0; i < list.length; i++) {
        try { list[i](current); } catch (e) {}
      }
      try {
        document.dispatchEvent(new CustomEvent("dsh:state", { detail: { state: current } }));
      } catch (e) {}
    }

    function apply(v) {
      current = v === null || typeof v !== "object" ? null : v;
    }

    addEventListener("message", function (e) {
      var d = e && e.data;
      if (!d || d.source !== "dsh-html-card-host") return;
      if (d.kind !== "state") return;
      apply(d.state);
      notify();
    });

    var api = {
      get: function () { return current; },
      ready: function (fn) {
        if (typeof fn !== "function") return;
        if (current !== null) { try { fn(current); } catch (e) {} return; }
        waiters.push(fn);
      },
      set: function (patch) {
        var next = {};
        var base = current || {};
        var k;
        for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
        for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
        try {
          var encoded = JSON.stringify(next);
          if (encoded.length > 16384) return false;
          current = JSON.parse(encoded);
        } catch (e) { return false; }
        try {
          parent.postMessage({ source: NS, kind: "state", state: current }, "*");
        } catch (e) {}
        notify();
        return true;
      }
    };

    try { window.__dshState = api; } catch (e) {}
  } catch (e) {}
})();
`;

/**
 * 判断正文需要哪些运行时块。
 *
 * 判定刻意**只看结构性标记**（属性名 / role），不做启发式：
 *  · `data-tooltip` 出现在正文里 —— 模型想用提示；
 *  · `role="tablist"` —— 想用标签页；
 *  · `__dshState` —— 想存状态。
 *
 * 不用 `includes('tooltip')` 这种松判据：正文里写一句「这个 tooltip 说明…」
 * 就会误触发，把 3KB 白送进去。
 */
export function needsRuntime(html: string): { tooltip: boolean; tabs: boolean; state: boolean } {
  return {
    tooltip: /\bdata-tooltip\b/.test(html),
    tabs: /role\s*=\s*["']tablist["']/.test(html),
    state: /__dshState\b/.test(html),
  }
}

/**
 * 按需拼出运行时脚本块（可能为空串）。
 *
 * 顺序是 tooltip → tabs → state，三者互不依赖，这个顺序只是阅读顺序。
 * 全部包在单独的 `<script>` 里：某一段语法错不该连累其它段。
 */
export function buildRuntime(html: string): string {
  const need = needsRuntime(html)
  const parts: string[] = []
  if (need.tooltip) parts.push(TOOLTIP_JS)
  if (need.tabs) parts.push(TABS_JS)
  if (need.state) parts.push(STATE_JS)
  if (parts.length === 0) return ''
  return '<script data-dsh-runtime>' + parts.join('\n') + '<\/script>'
}

/** 供冒烟断言用的运行时体积与能力清单。 */
export const RUNTIME_PARTS = { tooltip: TOOLTIP_JS, tabs: TABS_JS, state: STATE_JS } as const
