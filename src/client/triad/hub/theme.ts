/**
 * theme.ts — 工作台「深空指挥舱」主题层（2026-10 全新设计落地）。
 *
 * ── 这一层是什么 ──────────────────────────────────────────────────────
 * 效果图（_tmp/workbench-redesign.html）定稿的视觉语言，落到插件里的唯一
 * 入口。做三件事：
 *  1. 在 .wb-root 作用域把官方 --dsw-alias-* token 重映射成效果图那套
 *     「深空」色阶，四个子面板几百处 var() 引用一次性换肤，不逐页改色；
 *  2. 提供 .wb2-* 共享组件样式（页头 / 双层卡 / 胶囊 / 按钮 / 段控 / 开关 /
 *     图标钮 / 搜索框），新写的视图层直接用这套类；
 *
 * ── 主题同步（用户点名要求）──────────────────────────────────────────
 * 不写死任何绝对色。所有色值都是「官方 token → 深空表达」的映射：
 *  - 暗色：body[data-ds-dark-theme] 命中时走 OLED 深底 + 白字阶；
 *  - 亮色：缺省分支走纸白底 + 墨字阶，同一套 --wb2-* 短名；
 *  - 官方切主题只改 body 属性，本表两套分支自动换，零 JS 监听。
 * 强调色两态都取官方 business-primary（暗 #5B8CF0 / 亮 #4176E6），
 * 语义色（成功/警告/危险）原样透传官方 token，不做装饰。
 *
 * ── 单色纪律 ─────────────────────────────────────────────────────────
 * 用户二审反馈「色条花里胡哨」：装饰性彩色一律收进强调色的明度阶
 * （--wb2-a1..a5 五档），语义色只允许出现在真状态点/危险操作上。
 *
 * ── 动效 ─────────────────────────────────────────────────────────────
 * 全 CSS：入场级联（blur+上浮）、hover 浮起、边框流光、开关拨动、
 * 卡片图标微旋。统一 --wb2-ease 自定义曲线；prefers-reduced-motion
 * 一票否决（本表唯一一处媒体查询收口）。
 */

const STYLE_ID = 'dsh-workbench-theme-v2'

const SHEET = `
/* ══════════ 1 · token 重映射：官方 alias → 深空表达 ══════════ */
.wb-root {
  /* 强调色阶：装饰只用这五档明度，不引入第二色相 */
  --wb2-a1: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176E6) 14%, transparent);
  --wb2-a2: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176E6) 30%, transparent);
  --wb2-a3: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176E6) 52%, transparent);
  --wb2-a4: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176E6) 76%, transparent);
  --wb2-a5: var(--dsw-alias-state-business-primary, #4176E6);
  --wb2-accent: var(--dsw-alias-state-business-primary, #4176E6);
  --wb2-accent-hi: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176E6) 82%, #fff);

  /* 表面三阶 + 发丝线三阶（亮色纸白 / 暗色 OLED，各取官方底） */
  --wb2-bg: var(--dsw-alias-bg-base, #fff);
  --wb2-s1: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 3%, var(--wb2-bg));
  --wb2-s2: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 5%, var(--wb2-bg));
  --wb2-s3: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 9%, var(--wb2-bg));
  --wb2-line: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 8%, transparent);
  --wb2-line2: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 14%, transparent);
  --wb2-line3: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 22%, transparent);
  --wb2-t1: var(--dsw-alias-label-primary, #111);
  --wb2-t2: var(--dsw-alias-label-secondary, #555);
  --wb2-t3: var(--dsw-alias-label-tertiary, #777);
  --wb2-t4: var(--dsw-alias-label-quaternary, #999);
  --wb2-inset: inset 0 1px 0 color-mix(in srgb, var(--wb2-bg) 60%, transparent);
  --wb2-drop: 0 12px 34px color-mix(in srgb, var(--dsw-alias-label-primary, #111) 12%, transparent);
  --wb2-ease: cubic-bezier(.32,.72,0,1);
  --wb2-ease-soft: cubic-bezier(.22,.68,.24,1);
  --wb2-r-lg: 20px; --wb2-r-md: 15px; --wb2-r-sm: 10px; --wb2-r-xs: 8px;
  --wb2-mono: "SF Mono","Cascadia Mono","JetBrains Mono",ui-monospace,Consolas,monospace;

  /* 官方 token 重映射：子面板几百处 var() 一次性换肤。
     **底色/层底不在这里重映射**（2026-10 修正）：原先浅色分支把 bg-base 混成
     「主文字色 2% + module-platform(#f5f6f7)」≈ #F0F1F2 —— 一层灰，把官方
     纸白底压成灰面，用户看到的就是「页面背景不跟主题」（#EFF1F1 就是这个混算
     出来的值，源码里搜不到字面量）。现在这四档**原样继承官方 token**：
     浅色=官方纸白/官方层底，深色=官方深底；暗色分支另有显式覆写（见下）。
     其余档位（描边/交互底/填充）本就是半透明发丝线，明暗两态都成立，保持重映射。 */
  --dsw-alias-border-l1: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 9%, transparent);
  --dsw-alias-border-l2: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 15%, transparent);
  --dsw-alias-border-l3: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 24%, transparent);
  --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 7%, transparent);
  --dsw-alias-fill-l2: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 6%, transparent);
  --dsw-alias-state-business-primary: #4176E6;
  --dsw-alias-state-info-primary: #4176E6;
  --dsw-alias-state-violet-primary: color-mix(in srgb, #4176E6 70%, #fff);
  --dsw-shadow-lv1: 0 2px 10px color-mix(in srgb, var(--dsw-alias-label-primary, #111) 10%, transparent);
  --dsw-shadow-lv2: 0 8px 26px color-mix(in srgb, var(--dsw-alias-label-primary, #111) 14%, transparent);
  --dsw-shadow-lv3: 0 14px 44px color-mix(in srgb, var(--dsw-alias-label-primary, #111) 20%, transparent);
}
/* 暗色态：OLED 深底 + 提亮强调色 + 白字阶（官方切主题只改 body 属性） */
body[data-ds-dark-theme] .wb-root {
  --wb2-bg: #07080B;
  --wb2-s1: #10131A;
  --wb2-s2: #161A23;
  --wb2-s3: #1C212C;
  --wb2-line: rgba(255,255,255,.065);
  --wb2-line2: rgba(255,255,255,.11);
  --wb2-line3: rgba(255,255,255,.18);
  --wb2-t1: #E9EBF1; --wb2-t2: #9AA1B1; --wb2-t3: #5F6675; --wb2-t4: #454B58;
  --wb2-inset: inset 0 1px 0 rgba(255,255,255,.05);
  --wb2-drop: 0 12px 34px rgba(0,0,0,.34);
  --wb2-accent: #5B8CF0;
  --wb2-accent-hi: #7EA6F4;

  --dsw-alias-bg-base: #07080B;
  --dsw-alias-bg-layer-1: rgba(255,255,255,.045);
  --dsw-alias-bg-layer-2: rgba(255,255,255,.03);
  --dsw-alias-bg-layer-3: rgba(255,255,255,.07);
  --dsw-alias-bg-module-platform: #0B0D12;
  --dsw-alias-border-l1: rgba(255,255,255,.065);
  --dsw-alias-border-l2: rgba(255,255,255,.11);
  --dsw-alias-border-l3: rgba(255,255,255,.18);
  --dsw-alias-interactive-bg-hover: rgba(255,255,255,.06);
  --dsw-alias-fill-l2: rgba(255,255,255,.05);
  --dsw-alias-label-primary: #E9EBF1;
  --dsw-alias-label-secondary: #9AA1B1;
  --dsw-alias-label-tertiary: #5F6675;
  --dsw-alias-label-quaternary: #454B58;
  --dsw-alias-label-caption: #5F6675;
  --dsw-alias-state-business-primary: #5B8CF0;
  --dsw-alias-state-info-primary: #5B8CF0;
  --dsw-alias-state-violet-primary: #7EA6F4;
  --dsw-alias-markdown-code-block: #10131A;
  --dsw-alias-markdown-code-block-banner: #161A23;
  --dsw-alias-scrollbar-bg-l2: rgba(255,255,255,.1);
  --dsw-alias-scrollbar-hover-l2: rgba(255,255,255,.2);
  --dsw-shadow-lv1: 0 2px 10px rgba(0,0,0,.4);
  --dsw-shadow-lv2: 0 8px 26px rgba(0,0,0,.5);
  --dsw-shadow-lv3: 0 14px 44px rgba(0,0,0,.6);
}
/* 工作台根：纯色底。用户点名「不需要背景色」——不铺任何氛围光/径向渐变，
   层次只靠表面三阶（--wb2-s1/s2/s3）与发丝线表达。 */
.wb-root { background: var(--wb2-bg); color: var(--wb2-t1); isolation: isolate; }

/* ── 全局细节（v4 打磨）：选区 / 焦点环 / 滚动条 ─────────────────────
   三条都限定在 .wb-root 内，不改官方会话区与侧栏的观感。 */
.wb-root ::selection { background: var(--wb2-a3); color: #fff; }
/* 键盘可达性：焦点环只在键盘导航时出现（:focus-visible），鼠标点击不画环 */
.wb-root :focus-visible { outline: 2px solid var(--wb2-accent); outline-offset: 2px; border-radius: 6px; }
/* 滚动条：细、圆、hover 才亮；与官方深空底同族 */
.wb-root *::-webkit-scrollbar { width: 10px; height: 10px; }
.wb-root *::-webkit-scrollbar-thumb { background: var(--wb2-line2); border-radius: 99px;
  border: 2px solid transparent; background-clip: content-box; }
.wb-root *::-webkit-scrollbar-thumb:hover { background: var(--wb2-line3);
  border: 2px solid transparent; background-clip: content-box; }
.wb-root *::-webkit-scrollbar-track { background: transparent; }
.wb-root * { scrollbar-width: thin; scrollbar-color: var(--wb2-line2) transparent; }

/* ══════════ 2 · 共享组件（.wb2-*） ══════════ */
/* 页头：左巨型标题 / 右操作条，不对称 */
.wb2-head { display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; padding: 20px 22px 16px; }
.wb2-head-l { flex: 1 1 360px; min-width: 0; }
.wb2-eyebrow {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
  background: var(--wb2-a1); border: 1px solid var(--wb2-a3);
  font-size: 10px; font-weight: 600; letter-spacing: .13em; text-transform: uppercase;
  color: var(--wb2-accent); margin-bottom: 10px;
}
.wb2-eyebrow i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; font-style: normal;
  animation: wb2-blip 2s var(--wb2-ease-soft) infinite; }
@keyframes wb2-blip { 0%,100% { opacity:.4; transform:scale(.8); } 50% { opacity:1; transform:scale(1.25); } }
/* v4：标题提到 30px、字距收紧，与效果图的「巨型标题」一致 */
.wb2-title { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: -.028em; line-height: 1.1; color: var(--wb2-t1); }
.wb2-title em { font-style: normal; color: var(--wb2-t3); font-weight: 400; font-size: 15px; }
.wb2-sub { margin: 6px 0 0; font-size: 12.5px; color: var(--wb2-t3); max-width: 58ch; }
.wb2-head-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }

/* 双层卡：外壳发丝线 + 内核 inset 高光（效果图的「玻璃板嵌金属托盘」） */
.wb2-bezel { background: color-mix(in srgb, var(--wb2-t1) 3%, transparent); border: 1px solid var(--wb2-line);
  border-radius: var(--wb2-r-lg); padding: 5px; }
.wb2-core { background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%);
  border: 1px solid var(--wb2-line); border-radius: calc(var(--wb2-r-lg) - 5px);
  box-shadow: var(--wb2-inset), var(--wb2-drop); position: relative; overflow: hidden; }
.wb2-card { background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%);
  border: 1px solid var(--wb2-line); border-radius: var(--wb2-r-md); padding: 13px 14px;
  position: relative; overflow: hidden;
  transition: transform 420ms var(--wb2-ease), border-color 420ms var(--wb2-ease), box-shadow 420ms var(--wb2-ease); }
.wb2-card:hover { transform: translateY(-2px); border-color: var(--wb2-line2); box-shadow: var(--wb2-drop); }

/* 重点卡（v4）：1px 渐变描边流光 + 右上径向光晕。
   position:relative 必须有——hero 类会被加在 grid 项上（原 .wb2-persona 已删，
   现在挂在用量页 hero 上），没有定位上下文时 ::before 会逃到 .wb-root 去铺满整页。
   isolation:isolate 把伪元素的层叠收在本卡内；::after 用 z-index:-1 落在
   本卡背景之上、内容之下（负 z-index 在隔离上下文里的正确层级）。 */
.wb2-card-hero { position: relative; isolation: isolate; }
.wb2-card-hero::before { content: ""; position: absolute; inset: -1px; border-radius: inherit; padding: 1px;
  background: linear-gradient(135deg, var(--wb2-a4), transparent 32%, transparent 68%, var(--wb2-a3));
  background-size: 220% 220%;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none; animation: wb2-borderflow 5s linear infinite; }
@keyframes wb2-borderflow {
  0% { background-position: 0% 0%; } 50% { background-position: 100% 100%; } 100% { background-position: 0% 0%; } }
.wb2-card-hero::after { content: ""; position: absolute; top: -70px; right: -50px; width: 230px; height: 170px;
  border-radius: 50%; background: radial-gradient(circle, var(--wb2-a2), transparent 68%);
  filter: blur(22px); pointer-events: none; z-index: -1; }

/* 胶片颗粒（v4）：只铺工作台这一页，不碰侧栏与会话区。
   absolute 而非 fixed —— .wb-root 自己就是定位上下文且 overflow:hidden，
   inset:0 正好等于本页可视区；fixed 会一路盖到侧栏和对话上（越界）。
   isolation:isolate 把颗粒收在本页的层叠上下文里：页内浮层（下拉/时间弹层）
   可能被它压住，但 4% 不透明度下看不出，且 pointer-events:none 不吃点击；
   真正需要盖在最上的弹窗是 portal 到 body 的，不受本页上下文影响。 */
.wb-root { isolation: isolate; }
.wb-root::after { content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: .04;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E"); }

/* 胶囊 chip */
.wb2-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
  background: color-mix(in srgb, var(--wb2-t1) 5%, transparent); border: 1px solid var(--wb2-line);
  font-size: 11px; color: var(--wb2-t2); white-space: nowrap; transition: all 260ms var(--wb2-ease); }
.wb2-chip:hover { background: color-mix(in srgb, var(--wb2-t1) 9%, transparent); border-color: var(--wb2-line2); color: var(--wb2-t1); }
.wb2-chip[data-on] { background: var(--wb2-a1); border-color: var(--wb2-a3); color: var(--wb2-accent); }
.wb2-chip b { font-weight: 650; color: var(--wb2-t1); font-variant-numeric: tabular-nums; }
.wb2-chip[data-on] b { color: var(--wb2-accent); }

/* 按钮：次级描边 / 主级渐变 + 内嵌圆钮 */
.wb2-btn { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 999px;
  border: 1px solid var(--wb2-line2); background: color-mix(in srgb, var(--wb2-t1) 5%, transparent);
  color: var(--wb2-t1); font-family: inherit; font-size: 12px; font-weight: 550; cursor: pointer;
  transition: all 300ms var(--wb2-ease); }
.wb2-btn:hover { background: color-mix(in srgb, var(--wb2-t1) 10%, transparent); border-color: var(--wb2-line3); transform: translateY(-1px); }
.wb2-btn:active { transform: scale(.97); }
.wb2-btn svg { width: 13px; height: 13px; }
.wb2-btn-pri { background: linear-gradient(180deg, var(--wb2-accent-hi), var(--wb2-accent)); border-color: transparent;
  color: #fff; box-shadow: 0 4px 16px var(--wb2-a3), inset 0 1px 0 rgba(255,255,255,.24); padding-right: 6px; }
.wb2-btn-pri:hover { background: linear-gradient(180deg, var(--wb2-accent-hi), var(--wb2-accent)); filter: brightness(1.08);
  box-shadow: 0 7px 24px var(--wb2-a4); }
.wb2-btn-pri .wb2-nest { width: 24px; height: 24px; border-radius: 50%; background: rgba(255,255,255,.19);
  display: inline-flex; align-items: center; justify-content: center; transition: transform 380ms var(--wb2-ease); }
.wb2-btn-pri:hover .wb2-nest { transform: translate(2px,-2px) scale(1.09); }
.wb2-btn-pri .wb2-nest svg { width: 12px; height: 12px; }

/* 图标钮 */
.wb2-ibtn { width: 28px; height: 28px; padding: 0; border-radius: var(--wb2-r-xs); border: 1px solid transparent;
  background: transparent; color: var(--wb2-t3); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; transition: all 260ms var(--wb2-ease); }
.wb2-ibtn:hover { background: color-mix(in srgb, var(--wb2-t1) 8%, transparent); border-color: var(--wb2-line); color: var(--wb2-t1); }
.wb2-ibtn:active { transform: scale(.9); }
.wb2-ibtn svg { width: 14px; height: 14px; }

/* 段控 */
.wb2-seg { display: inline-flex; padding: 3px; border-radius: 999px; gap: 2px;
  background: color-mix(in srgb, var(--wb2-t1) 4%, transparent); border: 1px solid var(--wb2-line); }
.wb2-seg button { padding: 5px 12px; border: none; border-radius: 999px; background: transparent;
  color: var(--wb2-t3); font-family: inherit; font-size: 11.5px; font-weight: 550; cursor: pointer;
  transition: all 280ms var(--wb2-ease); white-space: nowrap; }
.wb2-seg button:hover { color: var(--wb2-t2); }
.wb2-seg button[data-on] { background: var(--wb2-s3); color: var(--wb2-t1);
  box-shadow: 0 2px 9px color-mix(in srgb, var(--wb2-t1) 12%, transparent), var(--wb2-inset); }

/* 搜索框 */
.wb2-search { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px;
  background: color-mix(in srgb, var(--wb2-t1) 4%, transparent); border: 1px solid var(--wb2-line);
  min-width: 200px; transition: all 300ms var(--wb2-ease); }
.wb2-search:focus-within { border-color: var(--wb2-a3); background: var(--wb2-a1);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wb2-accent) 12%, transparent); }
.wb2-search svg { width: 13px; height: 13px; color: var(--wb2-t4); flex: none; }
.wb2-search input { flex: 1; min-width: 0; border: none; background: transparent; color: var(--wb2-t1);
  font-family: inherit; font-size: 12px; outline: none; }
.wb2-search input::placeholder { color: var(--wb2-t4); }
.wb2-search kbd { padding: 1px 5px; border-radius: 5px; background: color-mix(in srgb, var(--wb2-t1) 7%, transparent);
  border: 1px solid var(--wb2-line); font-family: var(--wb2-mono); font-size: 9.5px; color: var(--wb2-t3); }

/* 状态点：语义色只在这里出现 */
.wb2-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--wb2-t4); }
.wb2-dot-ok { background: var(--dsw-alias-state-success-primary, #3DD68C);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #3DD68C) 16%, transparent);
  animation: wb2-pulse 2.4s var(--wb2-ease-soft) infinite; }
.wb2-dot-warn { background: var(--dsw-alias-state-warn-primary, #F5B544);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary, #F5B544) 16%, transparent); }
@keyframes wb2-pulse {
  0%,100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #3DD68C) 16%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--dsw-alias-state-success-primary, #3DD68C) 4%, transparent); }
}

/* 开关 */
.wb2-sw { width: 32px; height: 18px; border-radius: 999px; border: 1px solid var(--wb2-line2);
  background: color-mix(in srgb, var(--wb2-t1) 10%, transparent); position: relative; cursor: pointer; flex: none;
  transition: all 320ms var(--wb2-ease); }
.wb2-sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--wb2-t3); transition: all 340ms var(--wb2-ease); }
.wb2-sw[data-on] { background: linear-gradient(180deg, var(--wb2-accent-hi), var(--wb2-accent)); border-color: transparent;
  box-shadow: 0 0 12px var(--wb2-a3); }
.wb2-sw[data-on]::after { left: 16px; background: #fff; transform: scale(1.06); }

/* 小标签 / 分区头 / 数字 */
.wb2-tag { padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--wb2-t1) 6%, transparent);
  border: 1px solid var(--wb2-line); font-size: 9.5px; color: var(--wb2-t3); white-space: nowrap; }
.wb2-sech { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.wb2-sech i { flex: 1; height: 1px; background: var(--wb2-line); font-style: normal; }
.wb2-lbl { font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--wb2-t4); font-weight: 600; }
.wb2-num { font-variant-numeric: tabular-nums; font-family: var(--wb2-mono); }

/* 入场级联：.wb2-rise 按 --d 错峰淡入上浮（切页时随 key 重播） */
.wb2-rise { animation: wb2-rise 620ms var(--wb2-ease) both; animation-delay: var(--d, 0ms); }
@keyframes wb2-rise {
  from { opacity: 0; transform: translateY(18px); filter: blur(6px); }
  to { opacity: 1; transform: none; filter: blur(0); }
}

/* ══════════ 3 · 页内导航已移除（2026-10 v4） ══════════
   悬浮胶囊 Dock（.wb2-dock-*）整块删除：分类切换只在侧栏那一行横滑条上
   （./strip.tsx），页内不再有任何切换器。Dock 的样式与组件一并清掉，
   不留在表里当死代码。 */

/* ══════════ 4 · 用量页英雄区（效果图第 4 页） ══════════ */
.wb2-us-hero { display: grid; grid-template-columns: 1.28fr 1fr 1fr .94fr; gap: 12px; margin-bottom: 12px; }
@media (max-width: 1180px) { .wb2-us-hero { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px) { .wb2-us-hero { grid-template-columns: 1fr; } }
.wb2-us-main { padding: 20px 22px; position: relative; overflow: hidden;
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 54%); }
.wb2-us-big { font-size: 44px; font-weight: 700; letter-spacing: -.042em; line-height: 1.1; color: var(--wb2-t1);
  font-variant-numeric: tabular-nums; font-family: var(--wb2-mono); margin: 6px 0 6px;
  text-shadow: 0 0 34px var(--wb2-a3); }
.wb2-us-spark { margin-top: 12px; height: 40px; }
.wb2-us-spark svg { width: 100%; height: 100%; overflow: visible; }
.wb2-us-spark-line { fill: none; stroke: var(--wb2-accent); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 900; stroke-dashoffset: 900; animation: wb2-draw 1.9s var(--wb2-ease) .25s forwards;
  filter: drop-shadow(0 0 5px var(--wb2-a3)); }
@keyframes wb2-draw { to { stroke-dashoffset: 0; } }
.wb2-us-spark-fill { fill: var(--wb2-a1); opacity: 0; animation: wb2-fadein 900ms var(--wb2-ease) 1.15s forwards; }
@keyframes wb2-fadein { to { opacity: 1; } }
.wb2-us-metric { padding: 15px 16px; display: flex; flex-direction: column; gap: 2px; min-height: 128px; }
.wb2-us-metric-v { font-size: 23px; font-weight: 680; color: var(--wb2-t1); letter-spacing: -.026em; line-height: 1.2;
  font-variant-numeric: tabular-nums; font-family: var(--wb2-mono); margin-top: 5px; }
.wb2-us-metric-s { font-size: 10.5px; color: var(--wb2-t4); margin-top: 3px; }
.wb2-us-bar { height: 3px; border-radius: 3px; background: color-mix(in srgb, var(--wb2-t1) 8%, transparent);
  overflow: hidden; margin-top: auto; }
.wb2-us-bar i { display: block; height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, var(--wb2-accent), var(--wb2-accent-hi));
  transform-origin: left; animation: wb2-grow 1.15s var(--wb2-ease) both; box-shadow: 0 0 9px var(--wb2-a3); }
@keyframes wb2-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.wb2-us-gauge-wrap { display: flex; align-items: center; gap: 12px; margin-top: auto; }
.wb2-us-gauge { position: relative; width: 58px; height: 58px; flex: none; }
.wb2-us-gauge svg { transform: rotate(-90deg); }
.wb2-us-gauge-arc { stroke: var(--wb2-accent); stroke-dasharray: 163; stroke-dashoffset: 163;
  animation: wb2-gdash 1.5s var(--wb2-ease) .35s forwards; filter: drop-shadow(0 0 5px var(--wb2-a3)); }
@keyframes wb2-gdash { to { stroke-dashoffset: var(--go, 40); } }
.wb2-us-gauge b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; }
.wb2-us-gauge b i { font-style: normal; font-size: 14px; font-weight: 700; color: var(--wb2-t1); font-family: var(--wb2-mono); line-height: 1; }
.wb2-us-gauge b u { text-decoration: none; font-size: 8px; color: var(--wb2-t4); margin-top: 2px; }
.wb2-us-bottom { display: grid; grid-template-columns: 1.34fr 1fr; gap: 12px; margin-top: 12px; }
@media (max-width: 980px) { .wb2-us-bottom { grid-template-columns: 1fr; } }
.wb2-us-rank-i { display: flex; align-items: center; gap: 11px; padding: 8px 0; }
.wb2-us-rank-i + .wb2-us-rank-i { border-top: 1px solid var(--wb2-line); }
.wb2-us-rank-n { flex: none; width: 16px; font-size: 10.5px; color: var(--wb2-t4); font-weight: 600; }
.wb2-us-rank-c { flex: 1; min-width: 0; }
.wb2-us-rank-t { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
.wb2-us-rank-name { font-size: 11.5px; color: var(--wb2-t1); font-weight: 520; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb2-us-rank-v { margin-left: auto; font-size: 11px; color: var(--wb2-t2); font-family: var(--wb2-mono); font-weight: 600; flex: none; }
.wb2-us-rank-bar { height: 4px; border-radius: 4px; background: color-mix(in srgb, var(--wb2-t1) 6%, transparent); overflow: hidden; }
.wb2-us-rank-bar i { display: block; height: 100%; border-radius: 4px; transform-origin: left;
  background: linear-gradient(90deg, var(--wb2-a4), var(--wb2-accent));
  animation: wb2-grow 1.05s var(--wb2-ease) both; animation-delay: var(--d, 0ms); }
.wb2-us-pie-wrap { display: flex; align-items: center; gap: 16px; padding-top: 6px; }
.wb2-us-pie { width: 96px; height: 96px; flex: none; transform: rotate(-90deg); }
.wb2-us-pie circle { fill: none; stroke-width: 11; stroke-dasharray: 264; animation: wb2-piespin 1.35s var(--wb2-ease) both; }
@keyframes wb2-piespin { from { stroke-dashoffset: 264; } }
.wb2-us-pie-lg { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.wb2-us-pie-i { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--wb2-t2); }
.wb2-us-pie-i i { width: 8px; height: 8px; border-radius: 2.5px; flex: none; font-style: normal; }
.wb2-us-pie-i .wb2-num { margin-left: 4px; color: var(--wb2-t3); }
.wb2-us-pie-i b { margin-left: auto; font-family: var(--wb2-mono); color: var(--wb2-t1); font-weight: 600; font-size: 11px; }
/* 工作台内热力格放大到效果图尺寸（compact 小卡片保持原紧凑格） */
.wb-root .usm-uc { --dsh-activity-cell: 11px; --dsh-activity-radius: 3px; max-width: 1400px !important;
  padding: 0 !important; gap: 12px !important; margin: 0 auto !important; }
.wb-root .usm-uc-card { border-radius: var(--wb2-r-lg) !important; border: 1px solid var(--wb2-line) !important;
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%) !important;
  box-shadow: var(--wb2-inset), var(--wb2-drop) !important; padding: 15px 17px !important; }
.wb-root .usm-uc-stat { border-radius: var(--wb2-r-md) !important; border: 1px solid var(--wb2-line) !important;
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%) !important; }

/* 分类页包裹层：页头 + 面板主体纵向排布，撑满 wb-body */
.wb2-page-wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.wb2-page-wrap > *:last-child { flex: 1 1 auto; min-height: 0; }

/* ══════════ 5 · 记忆 / 能力 / 画廊 / 邮件：版式向效果图靠拢 ══════════
   原则：只动版式与质感，不动各面板的 JSX 与状态机；做不到的交互形态
   （如画廊 Coverflow 轮播需要 JS 状态）不硬凑，留真数据视图。 */

/* ── 记忆：顶栏段控 + 统计迷你卡 + 中栏时间河流 + 右栏抽屉卡 ──
   记忆页的视图导航是顶栏段控（首页/全部/变更/修订/回收/设置），不是侧栏，
   所以这里走「段控胶囊 + 统计迷你卡」而不是图标轨。 */
.wb-root .dsh-memory-view-tabs { padding: 3px !important; border-radius: 999px !important; gap: 2px !important;
  background: color-mix(in srgb, var(--wb2-t1) 4%, transparent) !important;
  border: 1px solid var(--wb2-line) !important; }
.wb-root .dsh-memory-view-tab { border-radius: 999px !important; padding: 5px 12px !important;
  transition: all 280ms var(--wb2-ease) !important; }
.wb-root .dsh-memory-view-tab[data-active="true"] { background: var(--wb2-s3) !important;
  color: var(--wb2-t1) !important; box-shadow: var(--wb2-inset) !important; }
.wb-root .dsh-memory-top-stat { padding: 4px 10px !important; border-radius: var(--wb2-r-xs) !important;
  background: color-mix(in srgb, var(--wb2-t1) 4%, transparent) !important;
  border: 1px solid var(--wb2-line) !important; }
.wb-root .dsh-memory-top-stat-val { font-family: var(--wb2-mono); font-weight: 680; color: var(--wb2-t1); }
/* 顶栏段控 → 左侧栏导航列表：面板改三行 grid（统计行 / 筛选行 / 内容行），
   导航列跨满三行通高；首页视图没有筛选行时该行 auto 塌成 0，不留空白带。
   项目/分类下拉保留在二级筛选行（真数据入口不丢）。 */

/* ── 记忆面板（2026-10 第二轮重做后）──
   历史：这里曾用 display:grid!important 把面板强行摊成三行网格，
   靠 display:contents 把 .dsh-memory-top-bar / .dsh-memory-view-row 拆开，
   再把 6 个 view-tab 塞进第 1 列当侧栏 —— 那是给「顶部 tab 行」的旧 DOM 打的补丁。

   现在面板自己就有真侧栏（.dsh-memory-sidebar-nav）+ 内容列（.dsh-memory-content-col），
   两栏 flex 布局写在插件自己的样式表里。换肤层**不能再动布局**，只做配色微调：
   一旦这里还写 grid!important，就会把插件的 flex-row 覆盖掉，
   表现为「面板挤成两条、内容掉到下面」——这正是重做后实测到的破版。

   所以本块只剩两件事：
     ① 把换肤层的配色变量接进记忆面板（保持工作台里视觉统一）；
     ② 窄屏下让侧栏收成横排（宽度不够时竖栏会把正文压死）。 */
.wb-root .dsh-memory-sidebar-nav {
  background: color-mix(in srgb, var(--wb2-t1) 4%, transparent) !important;
  border-right-color: var(--wb2-line) !important;
}
.wb-root .dsh-memory-sidebar-brand-text { color: var(--wb2-t1) !important; }
.wb-root .dsh-memory-sidebar-item { transition: background 300ms var(--wb2-ease), color 300ms var(--wb2-ease) !important; }
.wb-root .dsh-memory-sidebar-item:hover { background: color-mix(in srgb, var(--wb2-t1) 6%, transparent) !important; }
.wb-root .dsh-memory-sidebar-item-active,
.wb-root .dsh-memory-sidebar-item-active:hover {
  background: var(--wb2-a1) !important;
  color: var(--wb2-accent) !important;
}
.wb-root .dsh-memory-sidebar-item-active .dsh-memory-sidebar-item-count { color: var(--wb2-accent) !important; }
/* 顶栏：保持一条横排，只换底色与描边。 */
.wb-root .dsh-memory-top-bar {
  background: transparent !important;
  border-bottom-color: var(--wb2-line) !important;
}
.wb-root .dsh-memory-search-wrap {
  background: color-mix(in srgb, var(--wb2-t1) 4%, transparent) !important;
  border-color: var(--wb2-line) !important;
}
.wb-root .dsh-memory-search-wrap:focus-within {
  border-color: var(--wb2-accent) !important;
  box-shadow: 0 0 0 3px var(--wb2-a3) !important;
}
.wb-root .dsh-memory-primary-add { transition: all 300ms var(--wb2-ease) !important; }
/* 卡片与详情：跟随换肤层圆角与描边，不覆盖任何布局属性。 */
.wb-root .dsh-memory-entry-card { border-color: var(--wb2-line) !important; }
.wb-root .dsh-memory-detail-col {
  background: color-mix(in srgb, var(--wb2-t1) 2%, transparent) !important;
  border-left-color: var(--wb2-line) !important;
}

/* 窄屏降级：212px 竖栏 + 正文在 900px 以下会挤死正文。
   导航改横排一行（保持可读，不退化成图标轨——那条路已经证明认不出来）。 */
@media (max-width: 900px) {
  .wb-root .dsh-memory-panel { flex-direction: column !important; }
  .wb-root .dsh-memory-sidebar-nav {
    width: 100% !important; max-height: 128px;
    flex-direction: row !important; flex-wrap: wrap; gap: 4px !important;
    border-right: none !important; border-bottom: 1px solid var(--wb2-line) !important;
    padding: 8px !important;
  }
  .wb-root .dsh-memory-sidebar-brand { display: none !important; }
  .wb-root .dsh-memory-sidebar-section {
    flex-direction: row !important; flex-wrap: wrap; gap: 4px !important;
    margin-top: 0 !important;
  }
  .wb-root .dsh-memory-sidebar-section-title { display: none !important; }
  .wb-root .dsh-memory-sidebar-item { width: auto !important; }
  /* 详情栏的窄屏形态由插件样式表决定（浮层覆盖），这里不再覆盖 width，
     否则 !important 会把浮层规则打死，详情又变回挤压列表的占满块。 */
}
/* ── 记忆首页大盘换肤（MemoryHome）──
   用户点名「不需要背景色」：hero 卡那两团模糊装饰圆删掉；分类/类型/行图标
   的多彩（KIND_META 彩色 inline 色）统一收进强调色微底。 */
.wb-root .hm-hero::before, .wb-root .hm-hero::after { display: none !important; }
.wb-root .dsh-memory-home .hm-card, .wb-root .dsh-memory-home .hm-hero {
  border-radius: var(--wb2-r-md) !important; border: 1px solid var(--wb2-line) !important;
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%) !important;
  box-shadow: var(--wb2-inset) !important; }
.wb-root .dsh-memory-home .hm-mem-card { border-radius: var(--wb2-r-sm) !important;
  border: 1px solid var(--wb2-line) !important; background: var(--wb2-s1) !important;
  transition: transform 420ms var(--wb2-ease), border-color 420ms var(--wb2-ease) !important; }
.wb-root .dsh-memory-home .hm-mem-card:hover { transform: translateY(-3px); border-color: var(--wb2-line2) !important; }
/* 行内多彩图标（inline style 的 background）收强调色微底：
   属性选择器提权压 inline */
.wb-root .dsh-memory-home span[style*="background"] {
  background: var(--wb2-a1) !important; color: var(--wb2-accent) !important; }
.wb-root .dsh-memory-home .hm-tab.hm-tab-active { background: var(--wb2-accent) !important; color: #fff !important; }
/* 趋势图/环图描边吃强调色（SVG stroke 走 CSS 变量） */
.wb-root .dsh-memory-home .hm-line { stroke: var(--wb2-accent) !important; }
.wb-root .dsh-memory-home .hm-dot { fill: var(--wb2-accent) !important; }
/* 类型分布环：多彩分段收强调色明度五档（stroke 是 presentation attribute，CSS 可压） */
.wb-root .dsh-memory-home .hm-seg:nth-of-type(2) { stroke: var(--wb2-accent) !important; }
.wb-root .dsh-memory-home .hm-seg:nth-of-type(3) { stroke: var(--wb2-accent-hi) !important; }
.wb-root .dsh-memory-home .hm-seg:nth-of-type(4) { stroke: var(--wb2-a4) !important; }
.wb-root .dsh-memory-home .hm-seg:nth-of-type(5) { stroke: var(--wb2-a3) !important; }
.wb-root .dsh-memory-home .hm-seg:nth-of-type(6) { stroke: var(--wb2-a2) !important; }
.wb-root .dsh-memory-home .hm-legend-dot { background: var(--wb2-a3) !important; }
.wb-root .dsh-memory-home .hm-legend-row:nth-of-type(1) .hm-legend-dot { background: var(--wb2-accent) !important; }
.wb-root .dsh-memory-home .hm-legend-row:nth-of-type(2) .hm-legend-dot { background: var(--wb2-accent-hi) !important; }
.wb-root .dsh-memory-home .hm-legend-row:nth-of-type(3) .hm-legend-dot { background: var(--wb2-a4) !important; }
.wb-root .dsh-memory-home .hm-legend-row:nth-of-type(4) .hm-legend-dot { background: var(--wb2-a3) !important; }
.wb-root .dsh-memory-home .hm-legend-row:nth-of-type(5) .hm-legend-dot { background: var(--wb2-a2) !important; }

/* 时间河流 / 条目卡 padding：2026-10 第二轮重做后整块移除。
   这套规则的前提是「左栏导航 + 中间卡片列表」的旧布局，
   而新面板的卡片自带左轨（类型点 + 命中热力条），
   再叠 padding:9px 11px!important 会把左轨压到正文上——
   实测症状：正文首字被裁掉（「三个固定时点」只剩「个固定时点」）。
   现在卡片的间距与圆角全部由插件自己的样式表决定，换肤层只接配色。 */
/* 顶栏搜索胶囊化 */
.wb-root .dsh-memory-top-input { border-radius: 999px !important; }

/* ── 能力：单列整宽列表（与官方自动化任务页同构），技能包行带左侧主色滑入条 ── */
.wb-root .skm-main-scroll { max-width: none !important; margin: 0 !important; padding: 4px 22px 26px !important; }
.wb-root .skm-bundle-row-outer { position: relative; overflow: hidden; border-radius: var(--wb2-r-md) !important; }
.wb-root .skm-bundle-row-outer::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--wb2-accent); transform: scaleY(0); transform-origin: top; transition: transform 460ms var(--wb2-ease); }
.wb-root .skm-bundle-row-outer:hover::before { transform: scaleY(1); }

/* ── 画廊：网格改瀑布流 + 类别筛选进工具条 ── */
.wb-root .tg-root { display: flex; flex-direction: column; }
.wb-root .tg-toolbar { order: 0; }
/* 类别筛选：**工具条内的最后一段**（刷新钮之后，用户 2026-10 要求）。
   不再是底部悬浮 Dock，也不再靠 order 单独占一行——它就是工具条里的一个
   flex 子项，跟着工具条一起换行。 */
.wb-root .tg-dock { position: static !important; transform: none !important;
  flex: 0 1 auto; flex-wrap: wrap; flex-direction: row; align-items: center;
  margin: 0 0 0 2px; padding: 0; background: transparent; border: none; box-shadow: none;
  backdrop-filter: none; -webkit-backdrop-filter: none; gap: 6px;
  max-width: none; overflow: visible; animation: none; }
.wb-root .tg-body { order: 1; }
.wb-root .tg-grid { display: block !important; column-count: 4; column-gap: 11px; }
@media (max-width: 1240px) { .wb-root .tg-grid { column-count: 3; } }
@media (max-width: 880px) { .wb-root .tg-grid { column-count: 2; } }
.wb-root .tg-card { break-inside: avoid; margin-bottom: 11px; border-radius: var(--wb2-r-md) !important;
  transition: all 440ms var(--wb2-ease) !important; }
.wb-root .tg-card:hover { transform: translateY(-4px) !important; border-color: var(--wb2-line2) !important;
  box-shadow: var(--wb2-drop) !important; }
/* v4：缩略图 hover 缓推（放大在图上、不外溢）+ 类别徽标下滑浮现 */
.wb-root .tg-card__thumb { overflow: hidden; }
.wb-root .tg-card__img { transition: transform 620ms var(--wb2-ease) !important; }
.wb-root .tg-card:hover .tg-card__img { transform: scale(1.045); }
.wb-root .tg-card__kind-dot { transform: translateY(-4px); opacity: .82;
  transition: transform 420ms var(--wb2-ease), opacity 420ms var(--wb2-ease) !important; }
.wb-root .tg-card:hover .tg-card__kind-dot { transform: translateY(0); opacity: 1; }
/* 类型标签：挪到缩略图**右上角**（用户 2026-10 要求）。
   左下角原本是「图片/网页」这类标签，和左上角常见的播放/勾选徽标挤在同一侧；
   右上角是缩略图里最空的角，且与右下角的时长/大小信息形成对角，读起来更稳。 */
.wb-root .tg-card__kind-dot { top: 9px !important; right: 9px !important; left: auto !important; bottom: auto !important;
  padding: 2.5px 8px !important; border-radius: 999px !important;
  background: color-mix(in srgb, var(--wb2-bg) 74%, transparent) !important;
  border: 1px solid var(--wb2-line2) !important; backdrop-filter: blur(9px);
  font-size: 9.5px !important; font-weight: 600; color: var(--wb2-t2) !important; }
/* 类别筛选 chip（2026-10 简化定稿）：**一枚素净的胶囊**——
   图标 + 文字 + 数字，仅此三样。去掉的东西：图标盒（圆角方底 + 描边 + 阴影）、
   悬浮在角上的计数徽标、选中态的小圆点。原先一枚 chip 里叠四层装饰，
   扫视时反而读不出「这是哪一类、有几项」。
   选中态只靠底色 + 文字色区分，不再给图标单独上色块。 */
.wb-root .tg-dock__item { flex-direction: row; align-items: center; gap: 5px;
  border-radius: 999px !important; padding: 4px 10px !important;
  border: 1px solid transparent !important; background: transparent !important;
  color: var(--wb2-t3) !important;
  transition: background 280ms var(--wb2-ease), color 280ms var(--wb2-ease) !important; }
.wb-root .tg-dock__item:hover { background: color-mix(in srgb, var(--wb2-t1) 6%, transparent) !important;
  color: var(--wb2-t1) !important; transform: none !important; }
.wb-root .tg-dock__item:active { transform: scale(.97) !important; }
.wb-root .tg-dock__item svg { flex: none; }
.wb-root .tg-dock__label { font-size: 12px !important; line-height: 18px !important; font-weight: 500 !important; }
/* 计数：不再是悬浮角标，就是文字后面一个淡淡的数字 */
.wb-root .tg-dock__num { font-size: 11px !important; line-height: 18px !important;
  color: var(--wb2-t4) !important; font-variant-numeric: tabular-nums;
  transition: color 280ms var(--wb2-ease) !important; }
/* 选中：极淡底 + 主文字色，与工具条其它控件的选中语言一致 */
.wb-root .tg-dock__item[data-active="true"] { background: color-mix(in srgb, var(--wb2-t1) 9%, transparent) !important;
  border-color: var(--wb2-line) !important; color: var(--wb2-t1) !important; }
.wb-root .tg-dock__item[data-active="true"] .tg-dock__label { font-weight: 600 !important; }
.wb-root .tg-dock__item[data-active="true"] .tg-dock__num { color: var(--wb2-t2) !important; }

/* ── 画廊 Coverflow 焦点轮播（效果图第 5 页顶部） ──
   数据是真条目（visible 前 5 条），位移/旋转/景深全 CSS transform；
   点击侧卡 = 在官方右栏打开该条（GalleryPanel 的 openItem，与网格同一入口）。 */
.wb2-cover { position: relative; height: 240px; margin: 0 22px 14px; perspective: 1200px; overflow: hidden;
  border-radius: var(--wb2-r-lg); border: 1px solid var(--wb2-line); background: color-mix(in srgb, var(--wb2-t1) 3%, transparent); }
.wb2-cover-track { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  transform-style: preserve-3d; }
.wb2-cv { position: absolute; width: 288px; height: 186px; border-radius: var(--wb2-r-md); overflow: hidden;
  border: 1px solid var(--wb2-line2); background: var(--wb2-s1); cursor: pointer; padding: 0;
  box-shadow: 0 22px 56px color-mix(in srgb, var(--wb2-t1) 30%, transparent);
  transition: all 720ms var(--wb2-ease); }
.wb2-cv .tg-card__thumb { position: absolute; inset: 0; width: 100%; height: 100%; }
.wb2-cv .tg-card__img { width: 100%; height: 100%; object-fit: cover; }
.wb2-cv-meta { position: absolute; left: 0; right: 0; bottom: 0; padding: 24px 12px 10px; text-align: left;
  display: flex; flex-direction: column; gap: 2px;
  background: linear-gradient(transparent, color-mix(in srgb, var(--wb2-bg) 94%, transparent)); }
.wb2-cv-n { display: block; font-size: 11.5px; font-weight: 600; color: var(--wb2-t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb2-cv-s { display: block; font-size: 9.5px; color: var(--wb2-t3); }
.wb2-cv[data-c="1"] { transform: translateX(0) scale(1.055); z-index: 5;
  border-color: var(--wb2-a3); box-shadow: 0 26px 66px color-mix(in srgb, var(--wb2-t1) 40%, transparent), 0 0 46px var(--wb2-a2); }
.wb2-cv[data-p="1"] { transform: translateX(-268px) scale(.85) rotateY(20deg); z-index: 3; opacity: .52; filter: saturate(.62); }
.wb2-cv[data-p="2"] { transform: translateX(-478px) scale(.72) rotateY(28deg); z-index: 1; opacity: .24; filter: saturate(.4) blur(1px); }
.wb2-cv[data-n="1"] { transform: translateX(268px) scale(.85) rotateY(-20deg); z-index: 3; opacity: .52; filter: saturate(.62); }
.wb2-cv[data-n="2"] { transform: translateX(478px) scale(.72) rotateY(-28deg); z-index: 1; opacity: .24; filter: saturate(.4) blur(1px); }
.wb2-cv:hover { z-index: 9; opacity: 1; filter: none; }
@media (max-width: 900px) { .wb2-cover { display: none; } }

/* ══════════ 6 · 子面板杂项换肤（单色纪律收尾） ══════════ */
/* 记忆开关圆点反色修正（暗色下白点落白轨） */
.wb-root .dsh-memory-switch[aria-checked='true']::after { background: var(--wb2-bg); }

/* 动效一票否决（Dock 已删，选择器同步清理，不留死类名）。 */
@media (prefers-reduced-motion: reduce) {
  .wb2-rise, .wb2-eyebrow i, .wb2-dot-ok, .wb2-card-hero::before,
  .wb2-us-spark-line, .wb2-us-gauge-arc, .wb2-us-pie circle { animation: none !important; }
  .wb2-card, .wb2-btn, .wb2-ibtn, .wb2-sw, .wb2-sw::after,
  .wb2-us-bar i, .wb2-us-rank-bar i { transition: none !important; }
}
`

export function ensureWorkbenchTheme(): void {
  if (typeof document === 'undefined') return
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-chat-plus'
    tag.textContent = SHEET
    document.head.appendChild(tag)
    return
  }
  if (tag.textContent !== SHEET) tag.textContent = SHEET
}
