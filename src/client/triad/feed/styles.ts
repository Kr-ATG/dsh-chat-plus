/**
 * dsh-chat-plus — 「动态」页面样式表（注入式）。
 *
 * ── 这一张表是什么 ────────────────────────────────────────────────────
 * deliverables/feed-proto/index.html 是用户**已经确认满意**的定稿视觉，本表
 * 就是它的 1:1 落地：布局（284px 左栏 + 主区）、配色（浅色墨阶 / 深色 OLED 阶）、
 * 圆角（胶囊 999 / 面板 14 / 小件 10）、字号（标题 24/800、正文 15/1.78、
 * 胶囊 14/600）、间距（卡片上下 16/15，靠发丝线分隔而不用卡片框）全部照抄，
 * 只做两件必要的转写：
 *
 *  1. **变量收进作用域**。原型把 --ink / --bg 定义在 :root（整个文档），直接用
 *     会污染宿主界面；这里全部改成 --fd- 前缀并挂在 .fd-root 上，一张表不外溢。
 *  2. **滚动落在两列内部**。原型是整页滚动（min-height:100%），而本页面装在
 *     工作台 .wb2-page-wrap 里、高度受限，所以改成 .fd-root 100% 高 + 两列各自
 *     overflow-y:auto。视觉上是同一个东西，只是滚动条换了个容器。
 *
 * ── 深色模式 ──────────────────────────────────────────────────────────
 * 官方切主题只改 body 的 data-ds-dark-theme 属性，所以两套色阶各写一份变量
 * 覆写，零 JS 监听、零重渲染。深色下强调色提亮（#ff5b2e → #ff7a55），这是
 * 原型里就定好的（深底上的橙色需要更高明度才不糊）。
 *
 * ⚠ 注入式 CSS 的正文与注释里都不能出现反引号（模板字面量会提前闭合，整张表
 * 静默变成 false，构建守卫 assertInjectedCssStrings 会拦）——注释里描述类名
 * 请直接写类名，不要用反引号包起来。
 * ⚠ 本表只注入**一个** style 标签（id 见 STYLE_ID）。smoke-client 有一条
 * 「head 里样式标签数量必须精确等于预期表长」的断言，多注入一枚就红。
 */

/** 注入的 style 元素 id（smoke-client.mjs 的 expectedStyles 里同名登记）。 */
export const FEED_STYLE_ID = 'dsh-feed-styles'

const SHEET = `
/* ══════════ 1 · 变量：原型 :root 的 fd- 作用域副本 ══════════
   三个宿主共用一份变量声明：.fd-root 是页面本体，.fd-pop（原文来源浮层）与
   .fd-toasts（提示条）走 createPortal 挂到 body —— 它们脱离了 .fd-root 子树，
   变量必须自己带一份，否则 var(--fd-*) 全落空、浮层变透明半成品。 */
.fd-root, .fd-pop, .fd-toasts{
  /* 文字四阶 */
  --fd-ink:#141414; --fd-ink2:#3f3f3f; --fd-ink3:#8b8b8b; --fd-ink4:#b3b3b3;
  /* 表面四阶 */
  --fd-bg:#ffffff; --fd-bg-soft:#fafafa; --fd-sel:#f1f1f1; --fd-hover:#f6f6f6;
  /* 发丝线两阶（不用卡片框，靠线与留白分隔） */
  --fd-line:#ececec; --fd-line2:#f4f4f4;
  /* 强调：新角标 / 未读数 / 点赞态 */
  --fd-hot:#ff5b2e; --fd-hot-soft:rgba(255,91,46,.09); --fd-hotbg:rgba(255,91,46,.09);
  --fd-warn:#b4700f; --fd-warn-bg:rgba(180,112,15,.09);
  --fd-green:#12a150; --fd-green-glow:rgba(18,161,80,.12);
  --fd-sel-ink:#1f1f1f;
  /* 圆角与阴影 */
  --fd-r-pill:999px; --fd-r-card:14px; --fd-r-sm:10px;
  --fd-sh-soft:0 1px 2px rgba(20,20,20,.03),0 8px 24px -18px rgba(20,20,20,.18);
  /* 动效曲线 */
  --fd-ease:cubic-bezier(.22,.61,.36,1);
  --fd-spring:cubic-bezier(.34,1.56,.64,1);
}
body[data-ds-dark-theme] .fd-root,
body[data-ds-dark-theme] .fd-pop,
body[data-ds-dark-theme] .fd-toasts{
  --fd-ink:#f2f3f4; --fd-ink2:#c8ccd0; --fd-ink3:#868b90; --fd-ink4:#5d6266;
  --fd-bg:#121417; --fd-bg-soft:#16191d; --fd-sel:#23272c; --fd-hover:#1c2025;
  --fd-line:#282c32; --fd-line2:#1f2328;
  --fd-hot:#ff7a55; --fd-hot-soft:rgba(255,122,85,.12); --fd-hotbg:rgba(255,122,85,.12);
  --fd-warn:#e0a45c; --fd-warn-bg:rgba(224,164,92,.11);
  --fd-green:#3ecf8e; --fd-green-glow:rgba(62,207,142,.14);
  --fd-sel-ink:#f2f3f4;
  --fd-sh-soft:0 1px 2px rgba(0,0,0,.3),0 8px 24px -18px rgba(0,0,0,.7);
}

/* ══════════ 2 · 骨架 ══════════
   工作台里高度受限：整页撑满、两列各自滚动（原型是文档流滚动）。 */
.fd-root{
  flex:1 1 auto; min-height:0; display:flex; flex-direction:column;
  position:relative; overflow:hidden;
  background:var(--fd-bg); color:var(--fd-ink);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
  transition:background .3s var(--fd-ease),color .3s var(--fd-ease);
}
/* ⚠ 这四条重置必须是**零特异性**（用 :where 包住 .fd-root）。
   原型把它们写成元素级选择器（button / a / input），特异性 0,0,1，永远输给组件
   自己的 .fd-tb / .fd-ch 等单类规则；照抄成 .fd-root button 会变成 0,1,1，
   反过来把 .fd-tb 的 padding:0 17px 与 border:1px 全部压掉 —— 实测表现是
   胶囊内距归零、「全部/未读」之间的边框消失、左栏频道行矮了 15px。

   ⚠ 2026-10-27 补：作用域必须包含 **.fd-pop 与 .fd-toasts**。
   浮层与提示条都走 createPortal 挂到 document.body，**脱离了 .fd-root 子树**，
   所以只写 :where(.fd-root) 时它们里面的 <button> 会吃浏览器 UA 默认样式 ——
   实测表现是悬浮球浮层右上角那枚关闭按钮变成一块灰色实心圆（UA 的
   background-color:buttonface + 2px outset 边框），点得到但看起来像坏了。
   把宿主一起列进 :where 里，重置对浮层同样生效，而特异性仍是 0。 */
:where(.fd-root,.fd-pop,.fd-toasts) button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;appearance:none}
:where(.fd-root,.fd-pop,.fd-toasts) a{color:inherit;text-decoration:none}
:where(.fd-root,.fd-pop,.fd-toasts) input,:where(.fd-root,.fd-pop,.fd-toasts) textarea,:where(.fd-root,.fd-pop,.fd-toasts) select{font:inherit}
:where(.fd-root,.fd-pop,.fd-toasts) :focus-visible{outline:2px solid var(--fd-ink);outline-offset:2px}
.fd-page{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:284px minmax(0,1fr);gap:0;overflow:hidden}

/* ══════════ 3 · 左栏：频道列表 ══════════ */
.fd-side{
  display:flex;flex-direction:column;gap:2px;min-height:0;
  padding:16px 12px 14px 16px;
  border-right:1px solid var(--fd-line2);
  position:relative;min-width:0;overflow-y:auto;overflow-x:hidden;
}
.fd-side-top{display:flex;align-items:center;gap:8px;padding:0 6px 12px;flex:none}
.fd-side-ttl{flex:1;font-size:13px;font-weight:700;letter-spacing:.4px;color:var(--fd-ink3);
  text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-side-top-actions{display:flex;align-items:center;gap:4px;flex:none}
.fd-side-mag{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;
  color:var(--fd-ink3);transition:background .18s,color .18s;flex:none;cursor:pointer;border:none;background:transparent;padding:0}
.fd-side-mag:hover{background:var(--fd-hover);color:var(--fd-ink)}
.fd-side-mag:disabled{opacity:.6;cursor:default}
.fd-side-mag.fd-spinning svg{animation:fd-spin .7s linear infinite}
.fd-side-search{display:none;margin:0 4px 10px;flex:none}
.fd-side-search[data-on="true"]{display:block}
.fd-side-search input{width:100%;height:36px;border-radius:var(--fd-r-pill);
  border:1px solid var(--fd-line);background:var(--fd-bg-soft);padding:0 14px;
  font-size:13.5px;color:var(--fd-ink);outline:0;
  transition:border-color .18s,background .2s}
.fd-side-search input::placeholder{color:var(--fd-ink4)}
.fd-side-search input:focus{border-color:var(--fd-ink3);background:var(--fd-bg)}

/* 频道行：**纯文字**（头像与未读角标已按用户要求删除），
   所以这里不再有 .fd-ch-ava / .fd-ch-n 两套规则。 */
.fd-ch{display:flex;align-items:center;padding:9px 12px;border-radius:var(--fd-r-card);
  transition:background .18s;text-align:left;width:100%;position:relative;flex:none}
.fd-ch:hover{background:var(--fd-hover)}
.fd-ch[aria-pressed="true"]{background:var(--fd-sel)}
.fd-ch-txt{flex:1;min-width:0}
.fd-ch-name{display:block;font-size:15px;font-weight:700;letter-spacing:-.2px;color:var(--fd-ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 频道描述：**灰色总数文字**（不是红色未读角标 —— 那个已按用户要求删除）。
   主题名是模型现写的（「开源许可」这类长词会出现），所以这里必须靠省略号收敛，
   否则一个长 topic 会把整行撑开、把其它频道挤到看不见。 */
.fd-ch-desc{display:block;margin-top:1px;font-size:12.5px;color:var(--fd-ink3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-side-foot{margin-top:auto;padding:14px 6px 0;flex:none}
.fd-side-foot button{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--fd-ink3);
  padding:7px 6px;border-radius:var(--fd-r-sm);transition:background .18s,color .18s;width:100%}
.fd-side-foot button:hover{background:var(--fd-hover);color:var(--fd-ink)}

/* ── 三档分组 tab + 分组列表（2026-10-28 用户：「左侧加tab分类全部、按账号、按分类」）──
   胶囊 tab 与列表同宽：tab 决定「左栏怎么列」，列表是列出来的东西。 */
.fd-gtabs{display:flex;gap:4px;padding:8px 2px 6px;flex:none}
.fd-gtab{flex:1;height:30px;border-radius:var(--fd-r-pill);border:1px solid transparent;
  font-size:13px;font-weight:600;color:var(--fd-ink3);cursor:pointer;
  transition:background .18s,color .18s,border-color .18s}
.fd-gtab:hover{background:var(--fd-hover);color:var(--fd-ink)}
.fd-gtab[aria-selected="true"]{background:var(--fd-bg-soft);border-color:var(--fd-line);
  color:var(--fd-ink)}
.fd-glist{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-height:0;
  overflow-y:auto;padding:2px 0 8px}
.fd-gitem{display:flex;align-items:center;gap:9px;padding:8px 8px;border-radius:var(--fd-r-sm);
  font-size:13.5px;color:var(--fd-ink2);cursor:pointer;text-align:left;width:100%;
  transition:background .16s,color .16s}
.fd-gitem:hover{background:var(--fd-hover);color:var(--fd-ink)}
.fd-gitem[aria-pressed="true"]{background:var(--fd-bg-soft);color:var(--fd-ink);font-weight:600}
/* 账号首字球（没有头像图时的兜底，与悬浮球同一套视觉语言） */
/* 账号头像：首字球打底 + 外链图叠在上面（用户 2026-10-28：「头像放账号名称左侧，
   头像最好是链接渲染而不是保存下来」）。
   ⚠ 用 position:relative + 绝对定位叠图，而不是替换掉首字球 —— 图片没加载完、
   或 URL 失效（X 换头像后旧链接 404）时，底下永远有一层可见内容，不会出现空洞。 */
.fd-gava{position:relative;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;
  background:var(--fd-bg-soft);border:1px solid var(--fd-line);color:var(--fd-ink2);
  overflow:hidden;line-height:1}
.fd-gava-ch{font-weight:700}
.fd-gava-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  border-radius:50%;display:block}
.fd-gname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-gcount{flex:0 0 auto;font-size:12px;color:var(--fd-ink4);font-variant-numeric:tabular-nums}
.fd-gempty{padding:14px 10px;font-size:12.5px;line-height:1.7;color:var(--fd-ink4)}
/* 账号列表加载失败时的就地重试（2026-10-28）：文字按钮，与列表风格一致，
   不抢主操作视线；hover 才浮底色。 */
.fd-gretry{margin-top:2px;padding:3px 8px;border:1px solid var(--fd-line);border-radius:8px;
  background:transparent;color:var(--fd-ink3);font-size:12px;font-family:inherit;cursor:pointer;
  transition:background .16s,border-color .16s,color .16s}
.fd-gretry:hover{background:var(--fd-hover);border-color:var(--fd-ink4);color:var(--fd-ink)}

/* ── 右下角「更新」悬浮按钮（2026-10-28 用户：「更新放右下角」）────────────────
   fixed 贴内容区右下：动态流再长也不用滚回顶部才能更新。
   bottom/right 留出与滚动条、悬浮球的距离，避免叠在一起。 */
.fd-fab{position:fixed;right:26px;bottom:26px;z-index:55;
  display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 20px;
  border-radius:999px;background:var(--fd-hot);color:#fff;font-size:14px;font-weight:700;
  box-shadow:0 10px 28px -10px rgba(255,91,46,.75);
  transition:transform .18s var(--fd-spring),box-shadow .18s,opacity .18s}
.fd-fab:hover{transform:translateY(-2px);box-shadow:0 14px 34px -10px rgba(255,91,46,.85)}
.fd-fab:active{transform:translateY(0) scale(.98)}
.fd-fab:disabled{opacity:.6;cursor:default;transform:none}
.fd-fab svg{flex:0 0 auto}
@media (max-width:800px){.fd-fab{right:14px;bottom:14px;height:40px;padding:0 16px}}

/* ── 原文块（2026-10-28 用户：「不要压缩原文内容，英文翻译中文原文放里面」）──────
   默认折叠：原文往往比正文长，摊开会把动态流撑成一长条。
   折叠头是一行小字（像脚注），展开后是等宽引文块。 */
.fd-orig{margin-top:10px;border-left:2px solid var(--fd-line);padding-left:11px}
.fd-orig-hd{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--fd-ink3);
  list-style:none;user-select:none}
.fd-orig-hd::-webkit-details-marker{display:none}
.fd-orig-hd::before{content:'▸ ';display:inline-block;transition:transform .16s}
.fd-orig[open] .fd-orig-hd::before{content:'▾ '}
.fd-orig-hd:hover{color:var(--fd-ink)}
.fd-orig-tx{margin:7px 0 0;font-size:13.5px;line-height:1.75;color:var(--fd-ink3);
  white-space:pre-wrap;word-break:break-word;font-style:normal}

/* ── 设置页（2026-10-28 用户：「设置放单独的二级菜单变成设置页面」）──────────────
   整页而不是弹卡：三块内容（提示词 / 模型 / 关注对象）在弹卡里太挤，
   而且改完想对照效果还得先关掉。 */
.fd-setpage{display:flex;flex-direction:column;height:100%;min-height:0;overflow-y:auto}
.fd-setpage-hd{display:flex;align-items:center;gap:14px;padding:20px 26px 14px;flex:none}
.fd-setpage-ttl{margin:0;font-size:22px;font-weight:800;letter-spacing:-.4px}
.fd-setpage-bd{display:flex;flex-direction:column;gap:22px;padding:4px 26px 40px;max-width:720px}
.fd-setpage-sec{display:flex;flex-direction:column;gap:7px}
.fd-setpage-lbl{font-size:13px;font-weight:700;color:var(--fd-ink2)}
.fd-setpage-tip{margin:0;font-size:12.5px;line-height:1.6;color:var(--fd-ink4)}
.fd-setpage-ta{width:100%;min-height:110px;padding:12px 14px;border-radius:var(--fd-r-card);
  border:1px solid var(--fd-line);background:var(--fd-bg-soft);color:var(--fd-ink);
  font-size:14px;line-height:1.7;font-family:inherit;resize:vertical;outline:0;
  transition:border-color .18s}
.fd-setpage-ta:focus{border-color:var(--fd-ink3)}
.fd-setpage-act{display:flex;align-items:center;gap:10px;padding-top:6px;
  border-top:1px solid var(--fd-line2)}
.fd-setpage-act .fd-setpage-tip{flex:1}

/* ── 媒体网格（2026-10-28 用户：「有图片或视频就把链接放上来，渲染出来」）──────────
   ⚠ 尺寸必须**收着给**：推文配图经常是 1500×1500，铺满宽度会把一条动态撑成一屏，
   动态流就没法扫读了。内联只给一个「缩略预览」（最高 420px），
   想看大图点开全屏查看器（.fd-lb-*，支持滚轮缩放）。 */
.fd-mg{display:grid;gap:6px;margin-top:10px;
  grid-template-columns:1fr;max-width:520px}
.fd-mg[data-count="many"]{grid-template-columns:1fr 1fr;max-width:460px}
.fd-mg-item{position:relative;margin:0;overflow:hidden;border-radius:var(--fd-r-card);
  border:1px solid var(--fd-line2);background:var(--fd-bg-soft);
  max-height:420px}
.fd-mg[data-count="many"] .fd-mg-item{max-height:220px}
.fd-mg-item[data-broken="true"]{display:grid;place-items:center;min-height:90px}
.fd-mg-hit{display:block;width:100%;height:100%;padding:0;border:0;background:none;cursor:zoom-in}
.fd-mg-img{display:block;width:100%;height:100%;object-fit:cover;
  max-height:inherit;transition:transform .22s var(--fd-ease)}
.fd-mg-hit:hover .fd-mg-img{transform:scale(1.02)}
/* 视频：内联可播，不自动播放 */
.fd-mg-video{display:block;width:100%;max-height:inherit;background:#000}
.fd-mg-expand{position:absolute;right:8px;bottom:8px;z-index:2;
  display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;
  border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:11.5px;font-weight:600;
  backdrop-filter:blur(4px);cursor:pointer}
.fd-mg-play{position:absolute;inset:0;display:grid;place-items:center;
  font-size:26px;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6);pointer-events:none}
.fd-mg-tag{position:absolute;left:8px;top:8px;padding:2px 7px;border-radius:6px;
  background:rgba(0,0,0,.62);color:#fff;font-size:10.5px;font-weight:700;
  letter-spacing:.2px;pointer-events:none}
.fd-mg-fail{display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:16px;font-size:12px;color:var(--fd-ink4);text-align:center}

/* ── 全屏媒体查看器（滚轮缩放 0.5-5x / 拖动 / 双击 / 左右切换）──────────────────
   整屏黑底 + 悬浮控件：与 .fd-pop 的居中卡片是两套完全不同的浮层骨架，
   复用只会到处写 !important 覆盖。 */
.fd-lb{position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.92);
  display:flex;flex-direction:column;align-items:center;justify-content:center}
.fd-lb-stage{flex:1;width:100%;min-height:0;display:grid;place-items:center;overflow:hidden;
  cursor:grab}
.fd-lb-stage:active{cursor:grabbing}
.fd-lb-media{display:grid;place-items:center;transform-origin:center center;
  will-change:transform;max-width:100%;max-height:100%}
.fd-lb-media[data-drag="true"]{cursor:grabbing}
.fd-lb-img{display:block;max-width:92vw;max-height:82vh;object-fit:contain;
  user-select:none;-webkit-user-drag:none}
.fd-lb-video{display:block;max-width:92vw;max-height:82vh;background:#000}
.fd-lb-fail{display:flex;flex-direction:column;gap:10px;align-items:center;
  color:#d8d8d8;font-size:13px}
.fd-lb-link{color:#ff8a63;text-decoration:underline;font-size:13px}
.fd-lb-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;
  padding:10px 16px 16px;color:#e8e8e8;font-size:12.5px}
.fd-lb-count{font-variant-numeric:tabular-nums;opacity:.75}
.fd-lb-badge{font-style:normal;padding:1px 6px;border-radius:5px;
  background:rgba(255,255,255,.16);font-size:11px}
.fd-lb-zoom{font-variant-numeric:tabular-nums;opacity:.75;min-width:44px;text-align:right}
.fd-lb-btn{height:28px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.22);
  background:rgba(255,255,255,.08);color:#e8e8e8;font-size:12.5px;cursor:pointer;
  transition:background .16s,border-color .16s}
.fd-lb-btn:hover{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.4)}
.fd-lb-nav{position:absolute;top:50%;transform:translateY(-50%);
  width:44px;height:44px;border-radius:50%;display:grid;place-items:center;
  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);
  color:#fff;font-size:20px;cursor:pointer;transition:background .16s}
.fd-lb-nav:hover{background:rgba(255,255,255,.24)}
.fd-lb-nav[data-side="prev"]{left:18px}
.fd-lb-nav[data-side="next"]{right:18px}

/* ══════════ 4 · 主区 ══════════ */
.fd-main{padding:22px 26px 26px;min-width:0;min-height:0;display:flex;flex-direction:column;
  overflow-y:auto;overflow-x:hidden}

/* 标题 + 右上角状态 + 两个胶囊（**没有头像**：用户要求删掉） */
.fd-pf{display:flex;gap:16px;align-items:flex-start;flex:none}
.fd-pf-body{flex:1;min-width:0;padding-top:2px}
.fd-pf-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.fd-pf-name{font-size:24px;font-weight:800;letter-spacing:-.7px;line-height:1.25;margin:0}
.fd-pf-btns{display:flex;gap:7px;margin-left:auto;align-items:center;flex-wrap:wrap}

/* ── 更新状态（常驻，右上角）─────────────────────────────────────────
   空闲：中性文字「上次更新 · 2026年10月27日 14:32」
   进行中：脉冲点 + 「更新中」，整枚换成强调色底
   点它弹进度卡片。视觉上要「看得见但不吵」：空闲态比胶囊按钮轻一档，
   进行中才提亮 —— 常态就抢眼的话，右上角会一直拽走注意力。 */
.fd-status{display:inline-flex;align-items:center;gap:7px;height:31px;padding:0 13px;
  border-radius:var(--fd-r-pill);border:1px solid transparent;background:var(--fd-bg-soft);
  font-size:12.5px;font-weight:600;color:var(--fd-ink3);white-space:nowrap;
  transition:background .18s,color .18s,border-color .18s,transform .16s var(--fd-spring)}
.fd-status:hover{background:var(--fd-hover);color:var(--fd-ink2);border-color:var(--fd-line)}
.fd-status:active{transform:scale(.97)}
.fd-status[data-live="true"]{color:var(--fd-hot);background:var(--fd-hotbg);
  border-color:rgba(255,91,46,.22)}
body[data-ds-dark-theme] .fd-status[data-live="true"]{border-color:rgba(255,122,85,.26)}
.fd-status-tx{font-variant-numeric:tabular-nums}
/* 结局短语（与时间文案并列的第二段）：ok 绿 / skipped 中性灰 / failed 红。
   ⚠ skipped 这一档不红：它是「没有新内容」，不是「更新失败」。 */
.fd-status-outcome{font-weight:700;font-size:12px;letter-spacing:.2px}
.fd-status-outcome[data-tone="ok"]{color:var(--fd-green)}
.fd-status-outcome[data-tone="skipped"]{color:var(--fd-ink3)}
.fd-status-outcome[data-tone="failed"]{color:#c0392b}
body[data-ds-dark-theme] .fd-status-outcome[data-tone="failed"]{color:#e0685a}
/* 胶囊整体也跟着结局走一点点色：失败时那枚按钮自身要能一眼看出不对，
   否则用户只会看见「上次更新 · 某年某月某日」而漏掉后面那三个字。 */
.fd-status[data-tone="failed"]{color:#c0392b}
body[data-ds-dark-theme] .fd-status[data-tone="failed"]{color:#e0685a}
.fd-status[data-tone="skipped"]{color:var(--fd-ink2)}
.fd-status-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto;
  animation:fd-pulse 1.4s ease-in-out infinite}
@keyframes fd-pulse{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.35;transform:scale(.72)}
}
.fd-pill{height:31px;padding:0 15px;border-radius:var(--fd-r-pill);border:1px solid var(--fd-line);
  background:var(--fd-bg);font-size:13.5px;font-weight:600;color:var(--fd-ink2);
  display:inline-flex;align-items:center;gap:6px;white-space:nowrap;
  transition:transform .16s var(--fd-spring),background .18s,color .18s,border-color .18s}
.fd-pill:hover{background:var(--fd-hover);color:var(--fd-ink);border-color:var(--fd-ink4)}
.fd-pill:active{transform:scale(.96)}
.fd-pill[data-solid="true"]{background:var(--fd-sel-ink);color:var(--fd-bg);border-color:var(--fd-sel-ink)}
body[data-ds-dark-theme] .fd-pill[data-solid="true"]{color:#121417}
.fd-pill[data-solid="true"]:hover{opacity:.88;background:var(--fd-sel-ink);color:var(--fd-bg)}
.fd-pill[aria-expanded="true"]{background:var(--fd-hover);border-color:var(--fd-ink4);color:var(--fd-ink)}
.fd-pill[data-busy="true"] svg{animation:fd-spin .8s linear infinite}
@keyframes fd-spin{to{transform:rotate(360deg)}}
.fd-pill[data-shake="true"]{animation:fd-shake .4s var(--fd-ease)}
@keyframes fd-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.fd-pf-bio{margin-top:7px;font-size:14px;color:var(--fd-ink3);
  display:flex;align-items:center;gap:7px;flex-wrap:wrap;line-height:1.6}
.fd-pf-bio .fd-dot{width:6px;height:6px;border-radius:50%;background:var(--fd-green);
  flex:0 0 auto;box-shadow:0 0 0 3px var(--fd-green-glow)}
.fd-pf-bio b{font-weight:600;color:var(--fd-ink2)}

/* ══════════ 5 · 提示词与模型设置（点「设置」展开） ══════════ */
/* 设置已改成**弹出卡片**（用户 2026-10-27），页内不再有展开区 ——
   原来的 .fd-setup / .fd-setup[data-on] 折叠过渡规则已随内嵌块一起删除。
   现在只剩卡片内部的排版规则，骨架复用 .fd-pop（见下方 .fd-setup-sheet）。
   ⚠ 别再把这套 max-height 折叠加回来：它会把动态流整体推下去，
   小屏上还要滚很久才够得着「保存」。 */
.fd-setup-in{padding:13px 14px;background:transparent}
.fd-setup-sec{display:flex;flex-direction:column;gap:5px}
.fd-setup-lbl{font-size:12px;font-weight:700;color:var(--fd-ink3);letter-spacing:.2px}
.fd-setup-in textarea{width:100%;min-height:48px;resize:vertical;border:0;background:transparent;
  padding:0;font-size:14px;line-height:1.65;color:var(--fd-ink);outline:0;font-family:inherit}
.fd-setup-in textarea::placeholder{color:var(--fd-ink4)}
.fd-setup-m{margin-top:10px;padding-top:10px;border-top:1px dashed var(--fd-line);
  display:flex;align-items:center;gap:10px}
.fd-setup-m .fd-setup-lbl{flex:0 0 auto;margin:0}
.fd-m-select{box-sizing:border-box;height:32px;width:100%;max-width:280px;
  padding:0 32px 0 10px;border-radius:var(--dsw-radius-md, 12px);
  border:0.5px solid var(--dsw-alias-border-l4, rgba(255,255,255,.2));
  background-color:var(--dsw-alias-bg-layer-1, #fff);color:var(--dsw-alias-label-primary, #1f2329);
  font-size:14px;line-height:22px;font-family:inherit;outline:none;cursor:pointer;
  transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease;
  -webkit-appearance:none;appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}
.fd-m-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l2, #dcdfe6);
  background-color:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.03))}
.fd-m-select:focus,.fd-m-select:focus-visible{border-color:var(--dsw-alias-state-business-primary, #4176e6);
  box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 15%, transparent);outline:none}
.fd-m-select:disabled{opacity:0.6;cursor:default}
.fd-setup-row{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:10px;
  border-top:1px solid var(--fd-line)}
.fd-setup-tip{flex:1;font-size:12px;color:var(--fd-ink4);line-height:1.5}
.fd-setup-tip b{color:var(--fd-ink3);font-weight:600}

/* ── 动态页崩溃兜底（ErrorBoundary 的 fallback）────────────────────────
   用户报「复制粘贴后整页空白」（2026-10-27）：未捕获的渲染异常会卸载整棵
   子树，界面上只剩一片白、看不出发生了什么。包上边界后崩在这里：说明情况 +
   给一个重新载入的出口，工作台其它部分不受影响。 */
.fd-crash{display:flex;flex-direction:column;gap:8px;align-items:flex-start;
  margin:40px auto;max-width:460px;padding:20px 22px;border-radius:var(--fd-r-card);
  border:1px solid var(--fd-line);background:var(--fd-bg-soft);font-size:13.5px;
  line-height:1.6;color:var(--fd-ink3)}
.fd-crash b{font-size:15px;color:var(--fd-ink)}
.fd-crash .fd-pill{margin-top:4px}

/* ══════════ 6 · 生成状态条 ══════════ */
.fd-gbar{display:flex;align-items:center;gap:9px;margin-top:14px;padding:0 13px;
  border-radius:var(--fd-r-card);background:var(--fd-bg-soft);border:1px solid transparent;
  font-size:13px;color:var(--fd-ink3);opacity:0;max-height:0;overflow:hidden;flex:none;
  transition:opacity .3s,max-height .32s var(--fd-ease),padding .3s,margin .3s,border-color .3s}
.fd-gbar[data-on="true"]{opacity:1;max-height:60px;padding-top:9px;padding-bottom:9px;
  border-color:var(--fd-line2)}
.fd-gbar .fd-sp{width:13px;height:13px;border-radius:50%;border:2px solid var(--fd-line);
  border-top-color:var(--fd-ink2);animation:fd-spin .8s linear infinite;flex:0 0 auto}
.fd-gbar-st{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-gbar-st b{color:var(--fd-ink2);font-weight:600}
.fd-gbar-cnt{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--fd-warn);
  background:var(--fd-warn-bg);padding:1px 8px;border-radius:var(--fd-r-pill);display:none}
.fd-gbar-cnt[data-on="true"]{display:inline-block;animation:fd-pop .4s var(--fd-spring)}
@keyframes fd-pop{0%{transform:scale(.7);opacity:0}70%{transform:scale(1.06)}100%{transform:none;opacity:1}}

/* 筛选胶囊条（全部 / 未读 / 临近截止 / 已过期）**已整块删除**：
   用户原话「不需要显示这些」。列表现在是纯时间倒序，不再需要筛选入口，
   所以 .fd-tabs / .fd-tb 两套规则一并删除。 */

/* ══════════ 8 · 动态列表：按天分组，卡片靠发丝线分隔（无框） ══════════
   ⚠ 这里**不能** flex:1 1 auto。.fd-main 本身就是滚动容器（overflow-y:auto），
   flex:1 会让列表被压缩到视口高度、卡片却继续往下画，底部那条「来源 / 节奏」
   规则说明就被第 4 张卡片压住（实测截图确认的遮挡）。列表照常按内容撑开，
   滚到底自然看到规则条 —— 这才是原型里「文档流滚动」的等价形态。 */
.fd-feed{margin-top:6px;flex:0 0 auto}
.fd-dayhd{display:flex;align-items:center;gap:10px;padding:20px 0 8px}
.fd-dayhd b{font-size:14px;font-weight:700;letter-spacing:-.2px}
.fd-dayhd b[data-today="true"]{color:var(--fd-ink)}
.fd-dayhd span{font-size:12.5px;color:var(--fd-ink4);font-variant-numeric:tabular-nums}
.fd-dayhd .fd-ln{flex:1;height:1px;background:var(--fd-line2)}

.fd-dyn{position:relative;padding:16px 0 15px;border-bottom:1px solid var(--fd-line2);
  transition:opacity .3s var(--fd-ease),transform .3s var(--fd-ease)}
.fd-dyn:last-child{border-bottom:0}
.fd-dyn[data-enter="true"]{animation:fd-din .52s var(--fd-ease) both}
@keyframes fd-din{from{opacity:0;transform:translateY(-9px)}to{opacity:1;transform:none}}
.fd-dyn[data-gone="true"]{opacity:0;transform:translateX(-14px);pointer-events:none}
.fd-dyn[data-expired="true"]{opacity:.6}

/* 卡头：**没有头像、没有未读红点**（用户要求去掉），
   所以 .fd-dh-ava / .fd-ring / .fd-dh-new 三套规则一并删除。 */
.fd-dh{display:flex;align-items:flex-start;gap:11px}
.fd-dh-mid{flex:1;min-width:0;padding-top:1px}
.fd-dh-line{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
/* 来源名（原「苏墨」作者名的位置）：可点，主色 + hover 下划线。
   不做成蓝色链接那样突兀 —— 它读起来仍是一行正文式的元信息。 */
.fd-src{font-size:15.5px;font-weight:700;letter-spacing:-.25px;color:var(--fd-ink);
  border-bottom:1px solid transparent;transition:color .18s,border-color .18s;padding:0}
.fd-src:hover{color:var(--fd-hot);border-bottom-color:currentColor}
.fd-src[data-static="true"]{cursor:default}
.fd-src[data-static="true"]:hover{color:var(--fd-ink);border-bottom-color:transparent}
.fd-dh-tm{font-size:13px;color:var(--fd-ink3);font-variant-numeric:tabular-nums}
/* 相对时间：辅助信息，比完整年月日再轻一档 */
.fd-dh-ago{font-size:12px;color:var(--fd-ink4)}
.fd-dh-note{font-size:12.5px;color:var(--fd-ink3);display:inline-flex;align-items:center;gap:4px;
  padding:1px 8px;border-radius:var(--fd-r-pill);background:var(--fd-bg-soft);
  border:1px solid var(--fd-line2)}
.fd-dh-note svg{opacity:.7;flex:0 0 auto}
/* 「新」红点（.fd-dh-new / fd-newin）已按用户要求删除 —— 未读态不再有视觉标记。 */
.fd-dh-flag{flex:0 0 auto;margin-left:auto;font-size:12px;font-weight:600;padding:2px 9px;
  border-radius:var(--fd-r-pill);white-space:nowrap;color:var(--fd-ink4);background:var(--fd-hover)}

/* 标题行：截止胶囊在**标题左侧**（用户要求「这个时间放到标题左侧」）。
   胶囊 flex:0 0 auto 不参与拉伸、不折行；标题 flex:1 + min-width:0 才能正常折行。
   窄屏（640px 以下）允许整体换行：胶囊先占一行、标题另起一行 —— 挤在同一行
   会把标题压成一两个字一行。 */
.fd-title-row{display:flex;align-items:flex-start;gap:10px;margin-top:9px;flex-wrap:nowrap}
.fd-title-row .fd-due{flex:0 0 auto;margin-top:1px;white-space:nowrap}
.fd-dyn-h{flex:1;min-width:0;margin:0;font-size:17px;font-weight:700;line-height:1.45;
  letter-spacing:-.3px;cursor:pointer;transition:opacity .18s;word-break:break-word}
.fd-dyn-h:hover{opacity:.6}
@media (max-width:640px){
  .fd-title-row{flex-wrap:wrap}
  .fd-title-row .fd-due{margin-top:0}
  .fd-dyn-h{flex:1 1 100%}
}
.fd-dyn-h mark,.fd-dyn-p mark{background:rgba(255,91,46,.16);color:inherit;
  border-radius:3px;padding:0 2px}
.fd-dyn-p{margin:6px 0 0;font-size:15px;line-height:1.78;color:var(--fd-ink2);letter-spacing:.1px}
.fd-dyn-p[data-clamp="true"]{display:-webkit-box;-webkit-line-clamp:3;
  -webkit-box-orient:vertical;overflow:hidden}

/* 截止胶囊（视觉不变：橙色 + 圆角 + 时钟图标；位置改由 .fd-title-row 决定） */
.fd-due{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;
  border-radius:var(--fd-r-pill);font-size:13px;font-weight:600;color:var(--fd-warn);
  background:var(--fd-warn-bg);font-variant-numeric:tabular-nums}

/* ══════════ 9 · 操作行（讨论 / 点赞 / 删除） ══════════
   「原文」按钮已整块删除（用户要求）：打开原文的动作搬到了卡片头的来源名上，
   所以 .fd-act[data-hl] 那一套高亮样式也一并删除。 */
.fd-acts{display:flex;align-items:center;gap:2px;margin-top:12px;margin-left:-9px}
.fd-act{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;
  border-radius:var(--fd-r-pill);font-size:13.5px;color:var(--fd-ink3);
  font-variant-numeric:tabular-nums;transition:background .18s,color .18s;white-space:nowrap}
.fd-act:hover{background:var(--fd-hover);color:var(--fd-ink2)}
.fd-act svg{flex:0 0 auto;transition:transform .3s var(--fd-spring)}
.fd-act[data-liked="true"]{color:var(--fd-hot)}
.fd-act[data-liked="true"] svg{fill:var(--fd-hot);stroke:var(--fd-hot)}
.fd-act[data-pop="true"] svg{animation:fd-hb .48s var(--fd-spring)}
@keyframes fd-hb{0%{transform:scale(1)}36%{transform:scale(1.45)}100%{transform:scale(1)}}
.fd-act[data-pop="true"] .fd-num{animation:fd-np .44s var(--fd-spring)}
@keyframes fd-np{0%{transform:translateY(0);opacity:1}35%{transform:translateY(-6px);opacity:.3}100%{transform:none;opacity:1}}
.fd-act[data-del="true"]:hover{background:rgba(200,60,40,.08);color:#c0392b}
body[data-ds-dark-theme] .fd-act[data-del="true"]:hover{color:#e0685a}
.fd-acts .fd-grow{flex:1}

/* ══════════ 10 · 讨论区 ══════════ */
.fd-disc{margin-top:10px;padding:12px 14px;border-radius:var(--fd-r-card);
  background:var(--fd-bg-soft);border:1px solid var(--fd-line2);display:none}
.fd-disc[data-on="true"]{display:block;animation:fd-oi .3s var(--fd-ease)}
@keyframes fd-oi{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.fd-disc .fd-row{display:flex;gap:8px;font-size:13.5px;padding:4px 0;align-items:flex-start;
  line-height:1.6}
.fd-disc .fd-row .fd-w{flex:0 0 auto;font-weight:700;font-size:13.5px;color:var(--fd-ink)}
.fd-disc .fd-row .fd-w[data-me="true"]{color:var(--fd-hot)}
.fd-disc .fd-row .fd-t{flex:1;min-width:0;color:var(--fd-ink2);word-break:break-word}
.fd-disc .fd-row .fd-h{flex:0 0 auto;font-size:11.5px;color:var(--fd-ink4);
  font-variant-numeric:tabular-nums}
.fd-disc .fd-none{font-size:13.5px;color:var(--fd-ink3);padding:1px 0 6px}
.fd-disc form{display:flex;gap:8px;margin-top:9px}
.fd-disc input{flex:1;min-width:0;height:34px;border-radius:var(--fd-r-pill);
  border:1px solid var(--fd-line);background:var(--fd-bg);padding:0 14px;font-size:13.5px;
  color:var(--fd-ink);outline:0;transition:border-color .18s}
.fd-disc input::placeholder{color:var(--fd-ink4)}
.fd-disc input:focus{border-color:var(--fd-ink3)}
.fd-disc .fd-send{height:34px;padding:0 16px;border-radius:var(--fd-r-pill);
  background:var(--fd-sel-ink);color:#fff;font-size:13.5px;font-weight:600;flex:0 0 auto;
  transition:transform .16s var(--fd-spring),opacity .2s}
body[data-ds-dark-theme] .fd-disc .fd-send{color:#121417}
.fd-disc .fd-send:active{transform:scale(.96)}
.fd-disc .fd-send[disabled]{opacity:.5;cursor:default}

/* ══════════ 11 · 原文来源浮层（≥2 个来源时弹出） ══════════ */
.fd-pop{position:fixed;inset:0;z-index:1200;display:none}
.fd-pop[data-on="true"]{display:block}
.fd-pop-bd{position:absolute;inset:0;background:rgba(0,0,0,.28);opacity:0;
  transition:opacity .22s var(--fd-ease)}
.fd-pop[data-on="true"] .fd-pop-bd{opacity:1}
body[data-ds-dark-theme] .fd-pop-bd{background:rgba(0,0,0,.5)}
.fd-pop-sheet{position:absolute;left:50%;bottom:0;transform:translate(-50%,14px);
  width:min(100%,480px);background:var(--fd-bg);border:1px solid var(--fd-line);
  border-bottom:0;border-radius:18px 18px 0 0;padding:8px 8px 14px;
  box-shadow:0 -12px 40px -18px rgba(0,0,0,.35);opacity:0;
  transition:opacity .24s var(--fd-ease),transform .3s var(--fd-spring)}
.fd-pop[data-on="true"] .fd-pop-sheet{opacity:1;transform:translate(-50%,0)}
.fd-pop-hd{display:flex;align-items:center;gap:8px;padding:8px 10px 10px}
.fd-pop-hd .fd-t{flex:1;font-size:13px;font-weight:700;letter-spacing:-.1px}
.fd-pop-hd .fd-x{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
  color:var(--fd-ink3);transition:.18s;flex:none}
.fd-pop-hd .fd-x:hover{background:var(--fd-hover);color:var(--fd-ink)}
.fd-pop-list{display:flex;flex-direction:column;gap:2px;max-height:56vh;overflow-y:auto}
.fd-pop-item{display:flex;align-items:center;gap:11px;padding:11px;border-radius:12px;
  transition:background .18s}
.fd-pop-item:hover{background:var(--fd-hover)}
.fd-pop-ic{flex:0 0 auto;width:32px;height:32px;border-radius:9px;background:var(--fd-bg-soft);
  border:1px solid var(--fd-line2);display:grid;place-items:center;color:var(--fd-ink3)}
.fd-pop-tx{flex:1;min-width:0}
.fd-pop-n{font-size:14px;font-weight:600;line-height:1.4;letter-spacing:-.1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-pop-d{font-size:12px;color:var(--fd-ink3);display:flex;align-items:center;gap:5px;margin-top:1px}
.fd-pop-d .fd-lk{display:inline-flex;align-items:center;gap:3px}
.fd-pop-go{flex:0 0 auto;color:var(--fd-ink3);opacity:.7}
.fd-pop-item[data-lim="true"] .fd-pop-n{color:var(--fd-ink2);font-weight:500}
@media (min-width:640px){
  .fd-pop-sheet{top:50%;bottom:auto;transform:translate(-50%,-46%);border:1px solid var(--fd-line);
    border-radius:18px;max-width:440px;box-shadow:0 24px 60px -20px rgba(0,0,0,.4)}
  .fd-pop[data-on="true"] .fd-pop-sheet{transform:translate(-50%,-50%)}
}

/* ── 设置弹卡（用户 2026-10-27：「设置变成弹出卡片吧」）──────────────
   原来设置是页内展开区（.fd-setup 的 max-height 过渡），会把下面的动态流
   整体推下去、读到一半的列表跳位，小屏上还要滚很久才够得着「保存」。
   改成浮层后复用 .fd-pop 骨架，这里只定它的宽度与内部滚动。 */
.fd-setup-sheet{
  /* 比来源浮层宽一点：里面有 textarea + select + 关注对象列表，480 太挤 */
  width:min(100%,560px);
  display:flex;flex-direction:column;
  /* 上限跟视口走，内容再多也不把关闭按钮顶出屏幕 */
  max-height:min(86vh,760px);
  padding-bottom:0;
}
@media (min-width:640px){
  .fd-setup-sheet{max-width:560px}
}
/* 中间那块（提示词 / 模型 / 关注对象）自己滚，头尾固定 —— 用户滚到底也能点到保存 */
.fd-setup-sheet .fd-setup-in{
  flex:1 1 auto;min-height:0;overflow-y:auto;
  border:0;border-radius:0;padding:0 12px 4px;
}
/* 底部按钮条固定在卡片底边 */
.fd-setup-sheet .fd-setup-row{
  flex:0 0 auto;margin-top:0;padding:12px;
  border-top:1px solid var(--fd-line);
}


/* ══════════ 17 · 更新进度弹卡（点右上角状态弹出） ══════════
   浮层骨架复用 .fd-pop（遮罩 / 面板 / 头部关闭按钮都是同一套），这里只加
   卡片正文的排版：阶段行 + 不定态进度条 + 元信息 + 产出 + 失败原因 + 底部。
   进度条**只做不定态**（一条色带在轨道里来回扫）：host 在生成过程中拿不到
   「走到第几步」，按时间估出来的百分比会在 99% 停住等 —— 那比不定态更焦虑。 */
.fd-prog{padding:2px 12px 6px;display:flex;flex-direction:column;gap:11px}

/* 阶段行：左「正在…」右「已用 12 秒」 */
.fd-prog-top{display:flex;align-items:center;gap:9px}
.fd-prog-phase{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:1.5;
  color:var(--fd-ink);display:flex;align-items:center;gap:8px;word-break:break-word}
/* 阶段行三色：ok 绿 / skipped 中性灰 / failed 红。
   ⚠ skipped 那一格**绝不能红**：它是模型按「宁可少写不要重复」正常工作后的
   结果，染红会让用户以为更新坏了（这正是这次修的原始缺陷）。 */
.fd-prog-phase[data-tone="failed"]{color:#c0392b}
body[data-ds-dark-theme] .fd-prog-phase[data-tone="failed"]{color:#e0685a}
.fd-prog-phase[data-tone="ok"]{color:var(--fd-green)}
.fd-prog-phase[data-tone="skipped"]{color:var(--fd-ink2)}
/* 进行中的脉冲点：整张卡「活着」的信号，与右上角那枚同款节奏 */
.fd-prog-pulse{width:8px;height:8px;border-radius:50%;background:var(--fd-hot);flex:0 0 auto;
  animation:fd-pulse 1.4s ease-in-out infinite}
.fd-prog-elapsed{flex:0 0 auto;font-size:13px;font-weight:600;color:var(--fd-ink3);
  font-variant-numeric:tabular-nums;letter-spacing:.2px}

/* 进度条：轨道 + 填充。busy = 不定态扫光；done = 满格；fail = 红色满格 */
.fd-prog-track{position:relative;height:6px;border-radius:var(--fd-r-pill);
  background:var(--fd-bg-soft);border:1px solid var(--fd-line2);overflow:hidden}
.fd-prog-fill{position:absolute;inset:0;border-radius:inherit;background:var(--fd-hot);
  transition:transform .4s var(--fd-ease),background .3s}
.fd-prog-track[data-mode="busy"] .fd-prog-fill{width:38%;transform:none;
  animation:fd-indet 1.35s var(--fd-ease) infinite}
.fd-prog-track[data-mode="done"] .fd-prog-fill{width:100%;background:var(--fd-green)}
.fd-prog-track[data-mode="fail"] .fd-prog-fill{width:100%;background:#c0392b}
body[data-ds-dark-theme] .fd-prog-track[data-mode="fail"] .fd-prog-fill{background:#e0685a}
/* skip = 跑完了但没有新内容：满格但走中性灰（不绿也不红）。
   绿色会让用户以为「刚更新到新东西」，红色会让他以为「更新坏了」。 */
.fd-prog-track[data-mode="skip"] .fd-prog-fill{width:100%;background:var(--fd-ink4)}
@keyframes fd-indet{
  0%{transform:translateX(-110%)}
  100%{transform:translateX(265%)}
}

/* 元信息行：预计完成 / 开始时间 / 用时 */
.fd-prog-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  font-size:12.5px;color:var(--fd-ink3);font-variant-numeric:tabular-nums}
.fd-prog-eta{display:inline-flex;align-items:center;gap:5px}
.fd-prog-eta svg{opacity:.7;flex:0 0 auto}
.fd-prog-took{color:var(--fd-ink4)}

/* 键值行：本轮产出 / 降级说明 */
.fd-prog-row{display:flex;gap:10px;font-size:13px;line-height:1.6}
.fd-prog-k{flex:0 0 auto;width:64px;color:var(--fd-ink4);font-size:12.5px}
.fd-prog-v{flex:1;min-width:0;color:var(--fd-ink2);word-break:break-word}
.fd-prog-v[data-warn="true"]{color:var(--fd-warn)}
/* 「本轮产出」在跳过态说「没有新内容（与已发内容重复）」—— 中性灰，
   与上面那块「没有新内容」同色，绝不与下方红色失败区同色。 */
.fd-prog-v[data-tone="skipped"]{color:var(--fd-ink3)}

/* 失败原因：给足空间，不截断 —— 用户要的就是「为什么」 */
.fd-prog-err{margin-top:2px;padding:10px 12px;border-radius:var(--fd-r-sm);
  background:rgba(200,60,40,.07);border:1px solid rgba(200,60,40,.18);
  font-size:12.5px;line-height:1.65;color:#8d2f22;display:flex;flex-direction:column;gap:3px}
body[data-ds-dark-theme] .fd-prog-err{background:rgba(224,104,90,.1);
  border-color:rgba(224,104,90,.22);color:#f0a99e}
.fd-prog-err b{font-size:12px;font-weight:700;letter-spacing:.2px}
.fd-prog-err span{word-break:break-word;white-space:pre-wrap}

/* 「没有新内容」区块：**中性色**，与上面那块红色失败区是对照组。
   为什么必须单独一套而不是复用 .fd-prog-err 换个色：块的主色决定它在这张卡里的
   语义。同一块底色改个色号，下次改版很容易被误改回去；分成两个类名，「跳过
   不是失败」这件事就写死在结构里了。 */
.fd-prog-skip{margin-top:2px;padding:10px 12px;border-radius:var(--fd-r-sm);
  background:var(--fd-bg-soft);border:1px solid var(--fd-line);
  font-size:12.5px;line-height:1.65;color:var(--fd-ink2);display:flex;flex-direction:column;gap:4px}
.fd-prog-skip b{font-size:12px;font-weight:700;letter-spacing:.2px;color:var(--fd-ink)}
.fd-prog-skip > span{word-break:break-word}

/* 判重理由清单：默认 3 条，其余折叠 —— 11 条全摊开会把「再更新一轮」推出视野。 */
.fd-prog-notes{margin-top:4px;padding-top:8px;border-top:1px dashed var(--fd-line);
  display:flex;flex-direction:column;gap:6px}
.fd-prog-notes-hd{display:flex;align-items:center;gap:8px;font-size:11.5px;
  color:var(--fd-ink4);font-weight:600}
.fd-prog-notes-more{margin-left:auto;font-size:11.5px;font-weight:700;
  color:var(--fd-ink3);border-bottom:1px solid var(--fd-line);padding:0 0 1px;
  transition:color .16s,border-color .16s}
.fd-prog-notes-more:hover{color:var(--fd-ink);border-color:var(--fd-ink3)}
.fd-prog-notes-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px}
.fd-prog-notes-list li{position:relative;padding-left:13px;color:var(--fd-ink3);
  font-size:12px;line-height:1.6;word-break:break-word}
.fd-prog-notes-list li::before{content:"";position:absolute;left:2px;top:8px;
  width:4px;height:4px;border-radius:50%;background:var(--fd-ink4)}
.fd-prog-notes-rest{font-size:11.5px;color:var(--fd-ink4)}

/* 底部：说明文字 + 「再更新一轮」 */
.fd-prog-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  margin-top:2px;padding-top:10px;border-top:1px solid var(--fd-line2)}
.fd-prog-hint{flex:1;min-width:0;font-size:11.5px;color:var(--fd-ink4);line-height:1.5}
/* ══════════ 12 · 空态 ══════════ */
.fd-empty{padding:56px 16px;text-align:center}
.fd-empty .fd-ic{width:44px;height:44px;border-radius:50%;background:var(--fd-hover);
  color:var(--fd-ink4);display:grid;place-items:center;margin:0 auto 14px}
.fd-empty h3{margin:0 0 5px;font-size:16px;font-weight:700;letter-spacing:-.2px}
.fd-empty p{margin:0;font-size:14px;color:var(--fd-ink3)}
.fd-empty .fd-hint{margin-top:10px;font-size:12.5px;color:var(--fd-ink4)}

/* ══════════ 13 · 底部规则说明（轻） ══════════ */
.fd-rules{margin-top:22px;padding-top:16px;border-top:1px solid var(--fd-line2);
  font-size:12.5px;line-height:1.85;color:var(--fd-ink4);flex:none}
.fd-rules b{color:var(--fd-ink3);font-weight:600}
.fd-rules .fd-r{display:flex;gap:7px;align-items:flex-start}
.fd-rules .fd-r svg{flex:0 0 auto;margin-top:4px;opacity:.7}
.fd-rules .fd-r + .fd-r{margin-top:4px}

/* ══════════ 14 · Toast ══════════ */
.fd-toasts{position:fixed;left:0;right:0;bottom:16px;display:flex;flex-direction:column;
  align-items:center;gap:7px;z-index:1300;pointer-events:none;padding:0 14px}
.fd-toast{pointer-events:auto;display:flex;align-items:center;gap:9px;max-width:100%;
  padding:10px 16px;border-radius:var(--fd-r-pill);background:#141414;color:#fff;
  font-size:13.5px;font-weight:500;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);
  transform:translateY(14px);opacity:0;
  transition:transform .34s var(--fd-spring),opacity .28s var(--fd-ease)}
body[data-ds-dark-theme] .fd-toast{background:#f2f3f4;color:#141414}
.fd-toast[data-in="true"]{transform:none;opacity:1}
.fd-toast svg{flex:0 0 auto;opacity:.8}
.fd-toast .fd-u{font-weight:700;color:#ff8a63;padding:0 2px;flex:0 0 auto}
body[data-ds-dark-theme] .fd-toast .fd-u{color:#c4401a}

/* ══════════ 15 · 骨架（首屏还没拉到数据） ══════════ */
.fd-skel{display:flex;flex-direction:column;gap:14px;padding:18px 0}
.fd-skel i{display:block;height:14px;border-radius:6px;background:var(--fd-bg-soft);
  border:1px solid var(--fd-line2);animation:fd-breathe 1.2s ease-in-out infinite}
.fd-skel i:nth-child(1){width:38%}
.fd-skel i:nth-child(2){width:76%;height:18px}
.fd-skel i:nth-child(3){width:92%}
.fd-skel i:nth-child(4){width:56%}
@keyframes fd-breathe{0%,100%{opacity:.55}50%{opacity:1}}

/* ══════════ 16 · 窄屏 ══════════ */
@media (max-width:800px){
  .fd-page{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .fd-side{border-right:0;border-bottom:1px solid var(--fd-line2);
    padding:14px 14px 8px;overflow:visible;flex-direction:row;flex-wrap:wrap;
    align-items:center;gap:6px;max-height:none;overflow-y:auto}
  .fd-side-top{width:100%;padding:0 0 6px}
  .fd-side-search{width:100%;margin:0 0 6px}
  .fd-ch{display:none;width:auto;flex:0 0 auto;padding:5px 12px;
    border-radius:var(--fd-r-pill);border:1px solid var(--fd-line)}
  .fd-ch[aria-pressed="true"]{display:flex}
  .fd-ch:hover{display:flex}
  .fd-ch-desc{display:none}
  .fd-ch-name{font-size:13.5px;font-weight:600}
  .fd-side-foot{display:none}
  .fd-main{padding:16px 16px 24px}
  .fd-pf-name{font-size:21px}
  .fd-dyn-h{font-size:16px}
  .fd-dyn-p{font-size:14.5px}
  /* 窄屏下右上角状态让到标题下一行（标题优先），状态文字不换行 */
  .fd-pf-btns{width:100%;margin-left:0}
  .fd-status{max-width:100%}
  .fd-status-tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
@media (max-width:420px){
  .fd-pf-btns{width:100%;margin-left:0;margin-top:8px}
  .fd-pf-row{gap:8px}
}
@media (prefers-reduced-motion:reduce){
  .fd-dyn[data-enter="true"],.fd-gbar-cnt[data-on="true"],
  .fd-act[data-pop="true"] svg,.fd-act[data-pop="true"] .fd-num,
  .fd-disc[data-on="true"],.fd-skel i,.fd-pill[data-shake="true"],
  /* 状态指示的脉冲点与进度条的不定态扫光都要停：它们是无限循环动画， */
  /* 对前庭敏感的读者是持续的干扰源（停掉后进度条仍能靠 label 读出状态）。 */
  .fd-status-dot,.fd-prog-pulse,.fd-prog-track[data-mode="busy"] .fd-prog-fill{animation:none !important}
  .fd-prog-track[data-mode="busy"] .fd-prog-fill{width:38%;transform:none;opacity:.7}
  .fd-root,.fd-ch,.fd-dyn,.fd-pill,.fd-act,.fd-toast,.fd-status,.fd-prog-fill{transition:none !important}
}

/* ══════════ 15 · 关注对象悬浮球（右侧，「悬停展开多个球」） ══════════
   用户原话：「右侧增加悬浮球，鼠标移动上去后显示多个球每个关注的人物或公司
   头像与名称，点击后弹出该公司或人物的动态」。

   三条硬约束决定了下面这套几何：
    1. **不遮主内容** —— 收起态只有右侧贴边一枚 42px 的球（.fd-orbs-handle），
       容器自身 pointer-events:none，只在球本体上恢复 auto。右侧那一条
       看不见的区域因此不会吃掉页面的点击。
    2. **动画全走 CSS** —— .fd-orb 的 opacity/transform 由 data-open 驱动，
       逐枚 transition-delay 错开 40ms。JS 只负责「开/关」这个布尔值
       （原因见 EntityOrbs.tsx 头注释：纯 :hover 会在球间 8px 缝隙上频闪）。
    3. **深色可用** —— 复用本表第 1 节的 --fd-* 变量，不新起一套色阶。
*/
/* ⚠ 容器的**盒模型只有 56×56**（手柄那一格），但展开后的球是用
   bottom:(index+1)*50 绝对定位到**容器外面**的（第二个球在容器上方 100px）。
   于是鼠标从手柄移向球时，一旦离开那 56px 的盒子就触发 onMouseLeave → 球立刻
   收起 → 用户「点不到人物」（2026-10-27 实测复现：移到球的位置时元素已经是
   下面的标题了）。

   修法：用 ::before 铺一块**透明的 hover 桥接区**，向上覆盖到最上面那枚球，
   左右也放宽一点（球展开时 scale(1) 是 42px，收起态 30px，留余量）。
   它必须在容器内（pointer-events:auto），否则 onMouseLeave 仍然会触发。
   桥接区本身不可见、不可点（不接收点击，只承接 hover 路径）。 */
.fd-orbs{position:fixed;right:16px;top:50%;width:56px;height:56px;
  transform:translateY(-50%);z-index:60;pointer-events:none}
/* 展开后的球用绝对定位落在容器盒**外面**（第二个球在容器上方 100px），
   鼠标从手柄移向球时会先离开 56×56 的盒子 → onMouseLeave 立刻触发 → 球在
   指尖前收起，用户点到的其实是下面的标题（2026-10-27 实测：「点不到人物」）。

   修法在 JS（EntityOrbs 的 closeSoon）：mouseleave 后延迟 260ms 才真收起，
   期间鼠标进入任意一枚球就取消。**不用 CSS 伪元素铺桥接区** —— 那会在右侧
   留一条吃点击的透明带（展开态高度 300px+），用户点页面右边会「点空」。 */
.fd-orbs-handle-slot,.fd-orb-slot{position:absolute;right:0;width:42px;height:42px;
  padding:0;pointer-events:auto}
.fd-orbs-handle-slot{bottom:0}
.fd-orbs-handle{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;
  background:var(--fd-bg);color:var(--fd-ink3);border:1px solid var(--fd-line);
  box-shadow:var(--fd-sh-soft);cursor:pointer;transition:color .18s,transform .18s,box-shadow .18s}
.fd-orbs-handle:hover{color:var(--fd-hot);transform:scale(1.06)}
.fd-orbs[data-open="true"] .fd-orbs-handle{color:var(--fd-hot)}

/* 展开的球：收起态缩到 0 且不可见；展开时逐枚错峰淡入。 */
.fd-orb-slot{transform:scale(.72);opacity:0;transition:opacity .18s var(--fd-ease),transform .18s var(--fd-spring);
  pointer-events:none}
.fd-orb-slot[data-open="true"]{transform:scale(1);opacity:1;pointer-events:auto}
.fd-orb{position:relative;display:block;width:42px;height:42px;border-radius:50%;
  border:1px solid var(--fd-line);background:var(--fd-bg);overflow:hidden;cursor:pointer;
  box-shadow:var(--fd-sh-soft);transition:transform .16s var(--fd-spring),border-color .16s}
.fd-orb:hover{transform:scale(1.08);border-color:var(--fd-hot)}
/* 首字球：**永远渲染**，是外链头像加载失败时的兜底层。 */
.fd-orb-initial{position:absolute;inset:0;display:grid;place-items:center;
  color:#fff;font-weight:700;letter-spacing:0;user-select:none}
/* 头像叠在首字球之上；加载失败时 onError 把它藏掉，首字球自然露出来。 */
.fd-orb-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
/* 名下动态条数（小角标）。0 条时不渲染这个元素。 */
.fd-orb-count{position:absolute;right:-2px;bottom:-2px;min-width:15px;height:15px;padding:0 4px;
  border-radius:999px;background:var(--fd-hot);color:#fff;font-size:9.5px;font-weight:700;
  line-height:15px;text-align:center;box-shadow:0 0 0 2px var(--fd-bg)}
/* hover 时从球左侧浮出的名字标签。 */
.fd-orb-name{position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%) translateX(4px);
  white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;
  background:var(--fd-ink);color:var(--fd-bg);font-size:12px;font-weight:600;line-height:1;
  padding:6px 9px;border-radius:8px;opacity:0;pointer-events:none;
  transition:opacity .16s var(--fd-ease),transform .16s var(--fd-ease)}
.fd-orb-slot[data-open="true"] .fd-orb:hover .fd-orb-name{opacity:1;transform:translateY(-50%) translateX(0)}

/* 点开某枚球后的动态浮层（复用 .fd-pop 的遮罩，面板单独一套骨骼）。 */
/*
   定位必须**绝对居中**在 .fd-pop 里（.fd-pop 是 position:fixed;inset:0 的整屏
   定位上下文）。这里曾经写成 position:relative —— 相对定位的块会在正常流里
   从左上角开始排，于是面板贴在视口左上、剩下的区域全被遮罩占着，看起来就是
   「点开了一片空白」。left/top 各 50% + translate(-50%,-50%) 是唯一与
   .fd-pop 的 inset:0 对得上的写法。

   max-height 用 dvh 兜底：移动端地址栏收起/展开时 100vh 会跳动，dvh 不会。
*/
.fd-orb-sheet{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(440px,92vw);max-height:min(72vh,600px);
  display:flex;flex-direction:column;background:var(--fd-bg);color:var(--fd-ink);
  border:1px solid var(--fd-line);border-radius:var(--fd-r-card);
  box-shadow:0 24px 64px -24px rgba(0,0,0,.45),var(--fd-sh-soft);overflow:hidden}
.fd-orb-hd{display:flex;align-items:center;gap:10px;padding:14px 14px 12px;border-bottom:1px solid var(--fd-line2);flex:none}
.fd-orb-hd-ava{position:relative;width:36px;height:36px;border-radius:50%;overflow:hidden;flex:none}
.fd-orb-hd-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.fd-orb-hd-txt b{font-size:15px;font-weight:700;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-orb-hd-txt small{font-size:11.5px;color:var(--fd-ink3)}
.fd-orb-x{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
  color:var(--fd-ink3);cursor:pointer;flex:none;transition:background .16s,color .16s}
.fd-orb-x:hover{background:var(--fd-hover);color:var(--fd-ink)}
.fd-orb-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 0 10px}
.fd-orb-list{list-style:none;margin:0;padding:0}
.fd-orb-item{padding:11px 14px;border-bottom:1px solid var(--fd-line2)}
.fd-orb-item:last-child{border-bottom:0}
.fd-orb-item-t{font-size:13.5px;font-weight:600;color:var(--fd-ink);line-height:1.45}
.fd-orb-item-b{margin-top:3px;font-size:12.5px;line-height:1.6;color:var(--fd-ink2)}
.fd-orb-item-m{margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;font-size:11.5px;color:var(--fd-ink3)}
.fd-orb-empty{padding:26px 18px;text-align:center}
.fd-orb-empty p{margin:0 0 8px;font-size:13px;line-height:1.7;color:var(--fd-ink2)}
.fd-orb-dim{font-size:11.5px !important;color:var(--fd-ink4) !important}
.fd-orb-act{margin-top:6px;height:32px;padding:0 16px;border-radius:999px;cursor:pointer;
  background:var(--fd-hot);color:#fff;font-size:12.5px;font-weight:600;
  transition:filter .16s,transform .16s}
.fd-orb-act:hover{filter:brightness(1.06);transform:translateY(-1px)}

/* 设置面板里的「关注的对象」管理块（EntitySettings.tsx）。 */
.fd-ent{border-top:1px solid var(--fd-line2);margin-top:16px;padding-top:14px}
.fd-ent-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--fd-ink)}
.fd-ent-h small{font-weight:500;font-size:11.5px;color:var(--fd-ink4)}
.fd-ent-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}
.fd-ent-row{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:var(--fd-r-sm);
  transition:background .16s}
.fd-ent-row:hover{background:var(--fd-hover)}
.fd-ent-ava{position:relative;width:28px;height:28px;border-radius:50%;overflow:hidden;flex:none}
.fd-ent-nm{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.fd-ent-nm b{font-size:13px;font-weight:600;color:var(--fd-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-ent-nm small{font-size:11px;color:var(--fd-ink4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fd-ent-tag{font-size:10.5px;padding:1px 6px;border-radius:999px;background:var(--fd-sel);color:var(--fd-ink3);flex:none}
.fd-ent-del{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:var(--fd-ink4);
  cursor:pointer;flex:none;transition:background .16s,color .16s}
.fd-ent-del:hover{background:var(--fd-hot-soft);color:var(--fd-hot)}
.fd-ent-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.fd-ent-form input,.fd-ent-form select{height:34px;border-radius:var(--fd-r-sm);
  border:1px solid var(--fd-line);background:var(--fd-bg-soft);padding:0 10px;
  font-size:12.5px;color:var(--fd-ink);outline:0;min-width:0;transition:border-color .16s,background .16s}
.fd-ent-form input:focus,.fd-ent-form select:focus{border-color:var(--fd-ink3);background:var(--fd-bg)}
.fd-ent-form input::placeholder{color:var(--fd-ink4)}
.fd-ent-wide{grid-column:1 / -1}
.fd-ent-actions{grid-column:1 / -1;display:flex;align-items:center;gap:8px;margin-top:2px}
.fd-ent-btn{height:32px;padding:0 14px;border-radius:999px;cursor:pointer;background:var(--fd-sel);
  color:var(--fd-ink);font-size:12.5px;font-weight:600;transition:filter .16s}
.fd-ent-btn:hover{filter:brightness(.96)}
.fd-ent-btn[data-primary="true"]{background:var(--fd-hot);color:#fff}
.fd-ent-err{font-size:11.5px;color:var(--fd-hot)}
.fd-ent-empty{padding:14px 4px;font-size:12px;line-height:1.7;color:var(--fd-ink4)}
@media (max-width:560px){
  .fd-orbs{right:8px}
  .fd-orb-name{display:none}
  /* 窄屏浮层：占满可用宽度，高度收一点给软键盘留位置。 */
  .fd-orb-sheet{width:calc(100vw - 24px);max-height:min(78vh,560px)}
}
@media (prefers-reduced-motion:reduce){
  .fd-orb-slot,.fd-orb,.fd-orb-name,.fd-orbs-handle{transition:none !important}
}
`

/**
 * 幂等注入样式表。
 *
 * 已存在且**内容不同**时覆盖 —— 插件升级 / 热重载后旧表若继续命中早退分支，
 * 页面会一直吃旧规则，改了半天「没反应」。照 vault/styles.ts 同一写法。
 */
export function ensureFeedStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(FEED_STYLE_ID)
  if (existing !== null) {
    if (existing.textContent !== SHEET) existing.textContent = SHEET
    return
  }
  const tag = document.createElement('style')
  tag.id = FEED_STYLE_ID
  tag.dataset.plugin = 'dsh-chat-plus'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
