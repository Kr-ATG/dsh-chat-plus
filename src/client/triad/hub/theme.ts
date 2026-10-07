/**
 * theme.ts — 工作台「深空指挥舱」主题层（2026-10 全新设计落地）。
 *
 * ── 这一层是什么 ──────────────────────────────────────────────────────
 * 效果图（_tmp/workbench-redesign.html）定稿的视觉语言，落到插件里的唯一
 * 入口。做三件事：
 *  1. 在 .wb-root 作用域把官方 --dsw-alias-* token 重映射成效果图那套
 *     「深空」色阶，六个子面板几百处 var() 引用一次性换肤，不逐页改色；
 *  2. 提供 .wb2-* 共享组件样式（页头 / 双层卡 / 胶囊 / 按钮 / 段控 / 开关 /
 *     图标钮 / 搜索框），新写的视图层直接用这套类；
 *  3. 把 soul 面板旧三区骨架（上预设 / 左预览 / 右修改）重排成效果图的
 *     Editorial Split（左人格核心 / 右卡片 Bento + 预设轨）。
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

  /* 官方 token 重映射：子面板几百处 var() 一次性换肤 */
  --dsw-alias-bg-base: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 2%, var(--dsw-alias-bg-module-platform, #fff));
  --dsw-alias-bg-layer-1: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 5%, transparent);
  --dsw-alias-bg-layer-2: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 4%, transparent);
  --dsw-alias-bg-layer-3: color-mix(in srgb, var(--dsw-alias-label-primary, #111) 8%, transparent);
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
.wb-root { background: var(--wb2-bg); color: var(--wb2-t1); }

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
.wb2-title { margin: 0; font-size: 28px; font-weight: 680; letter-spacing: -.028em; line-height: 1.12; color: var(--wb2-t1); }
.wb2-title em { font-style: normal; color: var(--wb2-t3); font-weight: 400; }
.wb2-sub { margin: 6px 0 0; font-size: 12.5px; color: var(--wb2-t3); max-width: 58ch; }
.wb2-head-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

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

/* ══════════ 3 · 悬浮 Dock 导航 ══════════ */
.wb2-dock-wrap { position: sticky; top: 0; z-index: 30; display: flex; justify-content: center;
  padding: 12px 16px 10px; pointer-events: none;
  background: linear-gradient(var(--wb2-bg) 62%, transparent); }
.wb2-dock { pointer-events: auto; display: flex; align-items: center; gap: 3px; padding: 5px; border-radius: 999px;
  background: color-mix(in srgb, var(--wb2-s2) 78%, transparent);
  border: 1px solid var(--wb2-line2);
  backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%);
  box-shadow: var(--wb2-inset), var(--dsw-shadow-lv3, 0 14px 44px rgba(0,0,0,.3));
  animation: wb2-dock-in 620ms var(--wb2-ease) both; }
@keyframes wb2-dock-in { from { opacity: 0; transform: translateY(-16px) scale(.94); } to { opacity: 1; transform: none; } }
.wb2-dock-brand { display: flex; align-items: center; gap: 7px; padding: 0 12px 0 9px; margin-right: 3px;
  border-right: 1px solid var(--wb2-line); height: 26px; }
.wb2-dock-brand svg { width: 18px; height: 13px; color: var(--wb2-t1); }
.wb2-dock-brand b { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--wb2-t1); }
.wb2-dock-btn { position: relative; display: flex; align-items: center; gap: 6px; padding: 7px 13px;
  border: none; border-radius: 999px; background: transparent; color: var(--wb2-t3);
  font-family: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: color 240ms var(--wb2-ease), background 240ms var(--wb2-ease), transform 240ms var(--wb2-ease); }
.wb2-dock-btn svg { width: 14px; height: 14px; flex: none; transition: transform 340ms var(--wb2-ease); }
.wb2-dock-btn:hover { color: var(--wb2-t2); background: color-mix(in srgb, var(--wb2-t1) 6%, transparent); }
.wb2-dock-btn:hover svg { transform: translateY(-1px) scale(1.08); }
.wb2-dock-btn:active { transform: scale(.96); }
.wb2-dock-btn[data-on] { color: #fff; background: linear-gradient(180deg, var(--wb2-accent-hi), var(--wb2-accent));
  box-shadow: 0 3px 14px var(--wb2-a3), inset 0 1px 0 rgba(255,255,255,.26); }
.wb2-dock-btn[data-on]::after { content: ""; position: absolute; inset: -3px; border-radius: 999px;
  border: 1px solid var(--wb2-a3); animation: wb2-halo 2.6s var(--wb2-ease-soft) infinite; }
@keyframes wb2-halo { 0%,100% { opacity:.3; transform: scale(1); } 50% { opacity:.8; transform: scale(1.035); } }
.wb2-dock-close { margin-left: 4px; width: 30px; height: 30px; padding: 0; border-radius: 999px;
  border: 1px solid var(--wb2-line); background: color-mix(in srgb, var(--wb2-t1) 3%, transparent);
  color: var(--wb2-t3); cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 260ms var(--wb2-ease); }
.wb2-dock-close:hover { color: var(--dsw-alias-state-error-primary, #F2685C);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #F2685C) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #F2685C) 10%, transparent);
  transform: rotate(90deg); }
.wb2-dock-close svg { width: 13px; height: 13px; }

/* ══════════ 4 · 灵魂页重排：Editorial Split ══════════
   旧三区（上预设 / 左预览 / 右修改）→ 左人格核心 / 右卡片 Bento + 预设轨
   + 深改区（整段正文 / 身份铭牌 / 档案，低频入口沉到右列底部）。
   全部靠类名重排，不动 SoulPanel 的 JSX 与状态机：
   .dsh-soul-root 直接当 grid 容器，work / stage 两层 display:contents
   打平，五个块（header / notice / draft / preview / presets / edit）
   显式落格。 */
.wb-root .dsh-soul-root {
  display: grid !important;
  grid-template-columns: minmax(280px, .8fr) 1.5fr;
  gap: 16px; align-items: start;
  max-width: none !important; width: 100% !important; padding: 0 22px 26px !important;
}
@media (max-width: 1020px) { .wb-root .dsh-soul-root { grid-template-columns: 1fr; } }
/* 左列人格核心：SoulPanel 渲染的 .wb2-persona 卡（大鲸鱼 + 名字 + 定位 + 铭牌）；
   旧头部（小鲸鱼 + 标题行）在工作台内隐藏——核心卡已承担门面，composer 浮层仍显示 */
.wb-root .dsh-soul-header { display: none !important; }
.wb2-persona {
  grid-column: 1; grid-row: 1 / span 5;
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 28px 22px 24px; border: 1px solid var(--wb2-line); border-radius: var(--wb2-r-lg);
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 52%);
  box-shadow: var(--wb2-inset), var(--wb2-drop);
}
.wb2-persona .dsh-soul-whale { width: 104px !important; height: 78px !important; margin-bottom: 14px; }
.wb2-persona-name { margin: 0 0 3px; font-size: 26px; font-weight: 680; letter-spacing: -.024em; color: var(--wb2-t1); }
.wb2-persona-role { margin: 0 0 14px; font-size: 12.5px; font-weight: 500; color: var(--wb2-accent); }
.wb2-persona-quote { margin: 0 0 18px; font-size: 12px; color: var(--wb2-t3); line-height: 1.72; max-width: 34ch; }
.wb2-persona-plates { display: flex; flex-direction: column; gap: 1px; width: 100%;
  border-radius: var(--wb2-r-sm); overflow: hidden; border: 1px solid var(--wb2-line); background: var(--wb2-line); }
.wb2-persona-plate { display: flex; align-items: baseline; gap: 10px; padding: 8px 12px;
  background: var(--wb2-s1); transition: background 280ms var(--wb2-ease); }
.wb2-persona-plate:hover { background: var(--wb2-s2); }
.wb2-persona-plate-k { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--wb2-t4); font-weight: 600; flex: none; width: 34px; text-align: left; }
.wb2-persona-plate-v { font-size: 11.5px; color: var(--wb2-t2); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 右列：通知 / 草案 / 卡片 Bento / 预设轨 / 深改区 依次落格 */
.wb-root .dsh-soul-notice { grid-column: 2; grid-row: 1; }
.wb-root .dsh-soul-draft { grid-column: 2; grid-row: 2; }
.wb-root .dsh-soul-work, .wb-root .dsh-soul-stage { display: contents; }
.wb-root .dsh-soul-pane-preview { grid-column: 2; grid-row: 3; }
.wb-root .dsh-soul-presets-top { grid-column: 2; grid-row: 4; }
.wb-root .dsh-soul-pane-edit { grid-column: 2; grid-row: 5; }
@media (max-width: 1020px) {
  .wb2-persona, .wb-root .dsh-soul-notice, .wb-root .dsh-soul-draft,
  .wb-root .dsh-soul-pane-preview, .wb-root .dsh-soul-presets-top, .wb-root .dsh-soul-pane-edit {
    grid-column: 1; grid-row: auto;
  }
}
.wb-root .dsh-soul-presets-top[data-empty="1"] { display: none; }
.wb-root .dsh-soul-presets-top .dsh-soul-card { background: transparent !important; border: none !important;
  box-shadow: none !important; padding: 0 !important; }
.wb-root .dsh-soul-preset-list { display: flex !important; gap: 9px; overflow-x: auto; padding: 3px 2px 8px; }
.wb-root .dsh-soul-preset-row { flex: none !important; width: 186px; padding: 11px 12px !important;
  border-radius: var(--wb2-r-sm) !important; border: 1px solid var(--wb2-line) !important;
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1)) !important;
  position: relative; overflow: hidden; transition: all 380ms var(--wb2-ease) !important; }
.wb-root .dsh-soul-preset-row::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
  background: linear-gradient(90deg, var(--wb2-accent), var(--wb2-accent-hi));
  transform: scaleX(0); transform-origin: left; transition: transform 420ms var(--wb2-ease); }
.wb-root .dsh-soul-preset-row:hover { transform: translateY(-3px); border-color: var(--wb2-line2) !important;
  box-shadow: var(--wb2-drop) !important; }
.wb-root .dsh-soul-preset-row:hover::after { transform: scaleX(1); }
/* 卡片区改 Bento：卡片行变网格磁贴 */
.wb-root .dsh-soul-pane-preview .dsh-soul-card { background: transparent !important; border: none !important;
  box-shadow: none !important; padding: 0 !important; }
.wb-root .dsh-soul-card-list { display: grid !important; grid-template-columns: repeat(6, 1fr); gap: 11px; }
.wb-root .dsh-soul-card-row { grid-column: span 2; padding: 13px 14px !important; border-radius: var(--wb2-r-md) !important;
  border: 1px solid var(--wb2-line) !important;
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%) !important;
  transition: transform 420ms var(--wb2-ease), border-color 420ms var(--wb2-ease), box-shadow 420ms var(--wb2-ease) !important; }
.wb-root .dsh-soul-card-row:hover { transform: translateY(-2px); border-color: var(--wb2-line2) !important;
  box-shadow: var(--wb2-drop) !important; }
@media (max-width: 900px) {
  .wb-root .dsh-soul-card-list { grid-template-columns: repeat(2, 1fr); }
  .wb-root .dsh-soul-card-row { grid-column: span 1; }
}
/* 卡片种类图标：统一强调色微底（单色纪律，不吃 kind 彩） */
.wb-root .dsh-soul-card-kind { background: var(--wb2-a1) !important; border: 1px solid var(--wb2-a3) !important;
  color: var(--wb2-accent) !important; border-radius: 8px !important;
  transition: transform 340ms var(--wb2-ease), box-shadow 340ms var(--wb2-ease) !important; }
.wb-root .dsh-soul-card-row:hover .dsh-soul-card-kind { transform: rotate(-7deg) scale(1.09);
  box-shadow: 0 0 16px var(--wb2-a3); }
/* 磁贴内显示正文摘要两行（效果图磁贴有正文，旧行式只有标题+元信息） */
.wb-root .dsh-soul-card-row .dsh-soul-card-body-excerpt {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 11.5px; color: var(--wb2-t3); line-height: 1.7; margin-top: 7px;
  padding-top: 7px; border-top: 1px solid var(--wb2-line); white-space: pre-line; }
/* 磁贴头部动作区：开关常驻，其余 hover 显形（降噪） */
.wb-root .dsh-soul-card-row-actions { opacity: .55; transition: opacity 300ms var(--wb2-ease); }
.wb-root .dsh-soul-card-row:hover .dsh-soul-card-row-actions { opacity: 1; }
/* 深改区沉到右列底部，收成可折叠 details（低频入口不抢首屏；grid 落格见上） */
.wb-root .dsh-soul-legacy-details { border: 1px solid var(--wb2-line); border-radius: var(--wb2-r-md);
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%); overflow: hidden; }
.wb-root .dsh-soul-legacy-details > summary { cursor: pointer; list-style: none; padding: 12px 15px;
  display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 620; color: var(--wb2-t1);
  transition: background 260ms var(--wb2-ease); }
.wb-root .dsh-soul-legacy-details > summary::-webkit-details-marker { display: none; }
.wb-root .dsh-soul-legacy-details > summary:hover { background: color-mix(in srgb, var(--wb2-t1) 4%, transparent); }
.wb-root .dsh-soul-legacy-details > summary::after { content: ""; margin-left: auto; width: 8px; height: 8px;
  border-right: 1.6px solid var(--wb2-t3); border-bottom: 1.6px solid var(--wb2-t3);
  transform: rotate(45deg) translateY(-2px); transition: transform 320ms var(--wb2-ease); }
.wb-root .dsh-soul-legacy-details[open] > summary::after { transform: rotate(-135deg) translateY(-2px); }
.wb-root .dsh-soul-legacy-details .dsh-soul-legacy { padding: 4px 15px 15px; }
.wb-root .dsh-soul-legacy-details .dsh-soul-card { background: transparent !important; border: none !important;
  box-shadow: none !important; padding: 0 !important; }

/* ══════════ 4b · 用量页英雄区（效果图第 4 页） ══════════ */
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

/* ══════════ 6 · 记忆 / 能力 / 画廊 / 邮件：版式向效果图靠拢 ══════════
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
/* 顶栏段控 → 左图标轨：视图 tab 竖排成 58px 轨，文字隐藏只留图标+徽标；
   项目/分类下拉保留在二级筛选行（真数据入口不丢） */
.wb-root .dsh-memory-top-bar { display: grid !important; grid-template-columns: 58px 1fr;
  grid-template-rows: auto auto; gap: 8px 14px; padding: 0 22px 12px !important; border-bottom: none !important; }
.wb-root .dsh-memory-view-row { display: contents; }
.wb-root .dsh-memory-view-tabs { grid-column: 1; grid-row: 1 / span 2; flex-direction: column !important; gap: 3px !important;
  width: 58px; padding: 8px 6px !important; border-radius: var(--wb2-r-md) !important;
  background: color-mix(in srgb, var(--wb2-t1) 3%, transparent) !important;
  border: 1px solid var(--wb2-line) !important; }
.wb-root .dsh-memory-view-tab { position: relative; width: 100%; aspect-ratio: 1; padding: 0 !important;
  justify-content: center; border-radius: var(--wb2-r-xs) !important;
  transition: all 300ms var(--wb2-ease) !important; }
.wb-root .dsh-memory-view-tab > span:not(.dsh-memory-nav-icon) { display: none; }
.wb-root .dsh-memory-view-tab .dsh-memory-nav-count,
.wb-root .dsh-memory-view-tab .dsh-memory-nav-count-inline {
  display: inline-flex !important; position: absolute; top: 2px; right: 1px; }
.wb-root .dsh-memory-view-tab[data-active="true"] { background: var(--wb2-a1) !important; color: var(--wb2-accent) !important; }
.wb-root .dsh-memory-view-tab[data-active="true"]::before { content: ""; position: absolute; left: -6px; top: 50%;
  transform: translateY(-50%); width: 3px; height: 17px; border-radius: 0 3px 3px 0;
  background: var(--wb2-accent); box-shadow: 0 0 10px var(--wb2-a3); }
/* 统计与操作区占满剩余宽度（grid 第 1 行第 2 列），二级筛选行落第 2 行第 2 列 */
.wb-root .dsh-memory-view-actions { grid-column: 2; grid-row: 1; min-width: 0; display: flex; align-items: center; }
.wb-root .dsh-memory-subfilter-row { grid-column: 2; grid-row: 2; min-width: 0; }
.wb-root .dsh-memory-cols { padding-left: 22px !important; padding-right: 22px !important; }
/* 时间河流：竖线挂在列表容器上（条目都在 .dsh-memory-card-list 里），
   日期头行（.dsh-memory-group-section）左缘落圆点 */
.wb-root .dsh-memory-card-list { position: relative; padding-left: 20px !important; }
.wb-root .dsh-memory-card-list::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px;
  width: 1px; background: linear-gradient(180deg, transparent, var(--wb2-line2) 8%, var(--wb2-line2) 92%, transparent); }
.wb-root .dsh-memory-group-section { position: relative; padding-left: 18px !important; }
.wb-root .dsh-memory-group-section::before { content: ""; position: absolute; left: -15px; top: 12px;
  width: 9px; height: 9px; border-radius: 50%; background: var(--wb2-bg); border: 2px solid var(--wb2-t4);
  transition: all 340ms var(--wb2-ease); }
.wb-root .dsh-memory-group-section:hover::before { border-color: var(--wb2-accent); box-shadow: 0 0 0 4px var(--wb2-a1); }
/* 条目卡 → 紧凑行：选中描边 + hover 右移 */
.wb-root .dsh-memory-entry-card { padding: 9px 11px !important; border-radius: var(--wb2-r-sm) !important;
  transition: all 300ms var(--wb2-ease) !important; }
.wb-root .dsh-memory-entry-card:hover { transform: translateX(2px) !important; }
.wb-root .dsh-memory-entry-card-sel { border-color: var(--wb2-a3) !important; background: var(--wb2-a1) !important; }
/* 右栏详情 → 抽屉卡质感 */
.wb-root .dsh-memory-detail-col { border-radius: var(--wb2-r-lg) !important;
  border: 1px solid var(--wb2-line) !important; overflow: hidden;
  background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%) !important;
  box-shadow: var(--wb2-inset), var(--wb2-drop) !important; }
.wb-root .dsh-memory-detail-head { background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1)) !important; }
/* 顶栏搜索胶囊化 */
.wb-root .dsh-memory-top-input, .wb-root .dsh-mail-top-input { border-radius: 999px !important; }

/* ── 能力：主区 7/5 分栏（左技能包 / 右 MCP），MCP 列表改双列磁贴 ── */
.wb-root .skm-main-scroll { grid-template-columns: 1.4fr 1fr !important; max-width: 1400px !important;
  margin: 0 auto !important; padding: 4px 22px 26px !important; }
@media (max-width: 1080px) { .wb-root .skm-main-scroll { grid-template-columns: 1fr !important; } }
.wb-root .skm-bundle-row-outer { position: relative; overflow: hidden; border-radius: var(--wb2-r-md) !important; }
.wb-root .skm-bundle-row-outer::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--wb2-accent); transform: scaleY(0); transform-origin: top; transition: transform 460ms var(--wb2-ease); }
.wb-root .skm-bundle-row-outer:hover::before { transform: scaleY(1); }
.wb-root .skm-mcp-list { display: grid !important; grid-template-columns: 1fr 1fr; gap: 9px; }
@media (max-width: 640px) { .wb-root .skm-mcp-list { grid-template-columns: 1fr; } }
.wb-root .skm-mcp-list > li { border-radius: var(--wb2-r-sm) !important;
  border: 1px solid var(--wb2-line) !important; background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1)) !important;
  transition: all 380ms var(--wb2-ease) !important; }
.wb-root .skm-mcp-list > li:hover { transform: translateY(-3px); border-color: var(--wb2-line2) !important;
  box-shadow: var(--wb2-drop) !important; }

/* ── 画廊：网格改瀑布流 + 类别 Dock 从底部悬浮改工具条下横排 chips ── */
.wb-root .tg-root { display: flex; flex-direction: column; }
.wb-root .tg-toolbar { order: 0; }
.wb-root .tg-dock { order: 1; position: static; transform: none; align-self: flex-start;
  flex-direction: row; align-items: center;
  margin: 10px 22px 0; padding: 0; background: transparent; border: none; box-shadow: none;
  backdrop-filter: none; -webkit-backdrop-filter: none; gap: 6px; max-width: none; overflow: visible; }
.wb-root .tg-body { order: 2; }
.wb-root .tg-grid { display: block !important; column-count: 4; column-gap: 11px; }
@media (max-width: 1240px) { .wb-root .tg-grid { column-count: 3; } }
@media (max-width: 880px) { .wb-root .tg-grid { column-count: 2; } }
.wb-root .tg-card { break-inside: avoid; margin-bottom: 11px; border-radius: var(--wb2-r-md) !important;
  transition: all 440ms var(--wb2-ease) !important; }
.wb-root .tg-card:hover { transform: translateY(-4px) !important; border-color: var(--wb2-line2) !important;
  box-shadow: var(--wb2-drop) !important; }
.wb-root .tg-card__kind-dot { top: 9px !important; left: 9px !important; right: auto !important; bottom: auto !important;
  padding: 2.5px 8px !important; border-radius: 999px !important;
  background: color-mix(in srgb, var(--wb2-bg) 74%, transparent) !important;
  border: 1px solid var(--wb2-line2) !important; backdrop-filter: blur(9px);
  font-size: 9.5px !important; font-weight: 600; color: var(--wb2-t2) !important; }
.wb-root .tg-dock__item { flex-direction: row; align-items: center; gap: 6px;
  border-radius: 999px !important; padding: 5px 12px !important;
  border: 1px solid var(--wb2-line) !important; background: color-mix(in srgb, var(--wb2-t1) 4%, transparent) !important;
  transition: all 280ms var(--wb2-ease) !important; }
.wb-root .tg-dock__item[data-active="true"] { background: var(--wb2-a1) !important;
  border-color: var(--wb2-a3) !important; color: var(--wb2-accent) !important; }
.wb-root .tg-dock__item[data-active="true"] .tg-dock__icon-wrap { background: transparent !important;
  color: var(--wb2-accent) !important; box-shadow: none !important; }

/* ── 邮件：左栏图标轨 + 会话行左蓝旗 + 阅读区抽屉卡 ── */
.wb-root .dsh-mail-sidebar { width: 58px !important; min-width: 58px !important; flex: none !important;
  padding: 8px 6px !important; border-radius: var(--wb2-r-md) !important;
  background: color-mix(in srgb, var(--wb2-t1) 3%, transparent) !important;
  border: 1px solid var(--wb2-line) !important; overflow: hidden; }
.wb-root .dsh-mail-nav-item { position: relative; width: 100%; aspect-ratio: 1; justify-content: center;
  border-radius: var(--wb2-r-xs) !important; padding: 0 !important; transition: all 300ms var(--wb2-ease) !important; }
.wb-root .dsh-mail-nav-item > span:not(.dsh-mail-nav-icon) { display: none; }
.wb-root .dsh-mail-nav-item .dsh-mail-nav-count { display: inline-flex !important; position: absolute; top: 2px; right: 1px; }
.wb-root .dsh-mail-nav-item-active { background: var(--wb2-a1) !important; color: var(--wb2-accent) !important; }
.wb-root .dsh-mail-nav-item-active::before { content: ""; position: absolute; left: -6px; top: 50%;
  transform: translateY(-50%); width: 3px; height: 17px; border-radius: 0 3px 3px 0;
  background: var(--wb2-accent); box-shadow: 0 0 10px var(--wb2-a3); }
.wb-root .dsh-mail-row { position: relative; border-radius: var(--wb2-r-sm) !important;
  transition: all 300ms var(--wb2-ease) !important; }
.wb-root .dsh-mail-row::before { content: ""; position: absolute; left: 0; top: 11px; bottom: 11px; width: 2px;
  border-radius: 2px; background: var(--wb2-accent); transform: scaleY(0); transition: transform 380ms var(--wb2-ease); }
.wb-root .dsh-mail-row-unread::before, .wb-root .dsh-mail-row-active::before { transform: scaleY(1); }
.wb-root .dsh-mail-row:hover { transform: translateX(2px) !important; }
.wb-root .dsh-mail-detail-col { border-radius: var(--wb2-r-lg) !important; border: 1px solid var(--wb2-line) !important;
  overflow: hidden; background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1) 46%) !important;
  box-shadow: var(--wb2-inset), var(--wb2-drop) !important; }
.wb-root .dsh-mail-detail-head { background: linear-gradient(168deg, var(--wb2-s2), var(--wb2-s1)) !important; }

/* ── 画廊 Coverflow 焦点轮播（效果图第 5 页顶部） ──
   数据是真条目（visible 前 5 条），位移/旋转/景深全 CSS transform；
   点击侧卡 = 打开该条 Lightbox（GalleryPanel 里接 onOpen）。 */
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

/* ══════════ 7 · 子面板杂项换肤（单色纪律收尾） ══════════ */
/* soul 的 --s-card-bg 取 static token（恒白），暗色下卡片会亮成白板；
   收到深空表面一阶。开关旋钮反色：打开态白旋钮落深轨才看得见。 */
.wb-root .dsh-soul-card { --s-card-bg: var(--wb2-s1); }
.wb-root .dsh-soul-switch[aria-checked='true']::after { background: var(--wb2-bg); }
/* soul 的派生强调色 --s-persona（蓝混粉）违反单色纪律，收纯蓝阶 */
.wb-root .dsh-soul-root {
  --s-persona: var(--wb2-accent);
  --s-persona-soft: var(--wb2-a1);
  --s-persona-line: var(--wb2-a3);
}
/* 技能统计图标四色 → 强调色明度阶 */
.wb-root .skm-stat-icon[data-tone='blue']   { color: var(--wb2-accent) !important; background: var(--wb2-a1) !important; }
.wb-root .skm-stat-icon[data-tone='green']  { color: var(--wb2-accent-hi) !important; background: var(--wb2-a1) !important; }
.wb-root .skm-stat-icon[data-tone='violet'] { color: var(--wb2-a4) !important; background: var(--wb2-a1) !important; }
.wb-root .skm-stat-icon[data-tone='orange'] { color: var(--wb2-a3) !important; background: var(--wb2-a1) !important; }
/* 记忆开关圆点反色修正（暗色下白点落白轨） */
.wb-root .dsh-memory-switch[aria-checked='true']::after { background: var(--wb2-bg); }

/* 动效一票否决 */
@media (prefers-reduced-motion: reduce) {
  .wb2-rise, .wb2-dock, .wb2-dock-btn[data-on]::after, .wb2-eyebrow i, .wb2-dot-ok { animation: none !important; }
  .wb2-card, .wb2-btn, .wb2-ibtn, .wb2-dock-btn, .wb2-sw, .wb2-sw::after { transition: none !important; }
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
