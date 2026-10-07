/**
 * dsh-chat-plus — 多媒体画廊样式（注入式，DSH 原生 token，暗/亮主题自适应）。
 *
 * 视觉骨架沿用工作台既有语言（与记忆 / 邮箱面板同一套 token 与圆角节奏），
 * 动效按「渐进式微调」原则加：卡片入场级联上浮、hover 提亮浮起、骨架屏微光
 * 扫动、Lightbox 缩放入场、类别徽标下滑浮现、时间轴竖轨自上而下生长 +
 * 日期节点弹出 + 分组逐段浮入、时间筛选弹层缩放淡入。全部动画尊重
 * prefers-reduced-motion（只关动画，不动布局）。
 *
 * ⚠ 注入式 CSS 的正文与注释里都不能出现反引号（模板字面量会提前闭合，
 * 整张表静默变 false —— build.mjs 的 assertInjectedCssStrings 会拦，别去撞它）。
 */

const STYLE_ID = 'dsh-triad-gallery-styles'

const SHEET = `
.tg-root{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;position:relative}

/* ── 工具条右侧工具组（时间 / 视图 / 分类 / 数量 / 刷新）────────────
   整组 margin-left:auto 贴右；组内自带 flex-wrap + justify-content:flex-end，
   窄屏折行时后续行也贴右（原先各元素散在工具条里，折行后会被甩到左边）。
   顺序即 DOM 顺序：分类在前、数量与刷新在后（用户 2026-10 要求）。 */
.tg-tools{flex:none;display:flex;align-items:center;justify-content:flex-end;
  gap:10px;flex-wrap:wrap;margin-left:auto;min-width:0}

/* ── 工具条：搜索 + 时间筛选 + 视图切换 + 数量 + 刷新 ───────────── */
.tg-toolbar{flex:none;display:flex;align-items:center;gap:10px;padding:8px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));background:transparent;flex-wrap:wrap}

/* ── 类别筛选 chips（2026-10 简化：图标 + 文字 + 数字，仅此三样）─────
   基础形态就是一枚素胶囊；工作台作用域（hub/theme.ts）再覆写配色。
   简化时一并删掉了三个已不再渲染的装饰层：图标盒（圆角方底 + 描边）、
   悬浮计数角标、选中态圆点；它们的样式与 reduced-motion 引用都已清理干净。
   也删掉了原「底部悬浮 Dock」的绝对定位（absolute / bottom / 50% / 毛玻璃底 /
   阴影 / 入场动画）——它现在就是工具条里的一个普通 flex 子项。 */
.tg-dock{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px}
.tg-dock__item,.tg-kind{display:inline-flex;align-items:center;justify-content:center;gap:5px;
  padding:4px 10px;border-radius:999px;border:none;background:transparent;
  color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;user-select:none;outline:none;
  font-family:inherit;font-size:12px;line-height:18px;
  transition:background 280ms cubic-bezier(.32,.72,0,1),color 280ms cubic-bezier(.32,.72,0,1)}
.tg-dock__item:hover,.tg-kind:hover{color:var(--dsw-alias-label-primary,#111827)}
.tg-dock__item:active,.tg-kind:active{transform:scale(.97)}
.tg-dock__item:focus-visible,.tg-kind:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px}

.tg-dock__item[data-active="true"],.tg-kind[data-active="true"]{color:var(--dsw-alias-label-primary,#111827);font-weight:600}

.tg-dock__label{font-size:11px;line-height:14px;font-weight:500;white-space:nowrap;letter-spacing:.01em}
.tg-dock__item[data-active="true"] .tg-dock__label,.tg-kind[data-active="true"] .tg-dock__label{font-weight:600}
/* 计数：文字后面的一个淡数字（2026-10 简化：原先是悬浮在图标盒角上的徽标，
   叠了四层装饰；现在就是行内一个 tabular-nums 数字）。 */
.tg-dock__num{font-size:10.5px;line-height:14px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#888)}

.tg-search{position:relative;flex:1;min-width:140px;max-width:400px;margin-left:0}
.tg-search__icon{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary,#888);pointer-events:none;display:flex}
.tg-search__input{width:100%;box-sizing:border-box;height:30px;padding:0 10px 0 28px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:transparent;color:var(--dsw-alias-label-primary,#111827);font-size:12px;font-family:inherit;outline:none;transition:border-color 140ms ease,box-shadow 140ms ease}
.tg-search__input:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 20%,transparent)}
.tg-search__input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.tg-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:8px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:color 140ms ease,background 140ms ease}
.tg-icon-btn:hover{color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent))}
.tg-icon-btn[data-spinning="true"] svg{animation:tg-spin 800ms linear infinite}
@keyframes tg-spin{to{transform:rotate(360deg)}}
.tg-count{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── 会话筛选行（选了某个会话时出现）───────────────────────────── */
.tg-session-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));animation:tg-fade-in 180ms ease}
.tg-session-bar__name{color:var(--dsw-alias-label-primary,#111827);font-weight:600;max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-session-clear{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:11px;border:none;background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent));color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px;font-family:inherit;cursor:pointer;transition:background 140ms ease,color 140ms ease}
.tg-session-clear:hover{background:var(--dsw-alias-bg-layer-3,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 12%,transparent));color:var(--dsw-alias-label-primary,#111827)}

/* ── 主体：滚动区 + 网格 ───────────────────────────────────────── */
.tg-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px 18px 96px;scrollbar-width:thin}
.tg-scroll::-webkit-scrollbar{width:8px}
.tg-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:4px}
.tg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
@media (max-width:640px){.tg-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}}

/* ── 卡片 ──────────────────────────────────────────────────────── */
.tg-card{position:relative;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));cursor:pointer;overflow:hidden;padding:0;text-align:left;font-family:inherit;color:inherit;transition:transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms ease,border-color 180ms ease;animation:tg-card-in 320ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-i,0) * 22ms)}
.tg-card:hover{transform:translateY(-3px);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.28));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary,#000) 12%,transparent)}
.tg-card:active{transform:translateY(-1px) scale(.985)}
.tg-card:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px}
@keyframes tg-card-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.tg-card__thumb{position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent));display:flex;align-items:center;justify-content:center}
.tg-card__img{width:100%;height:100%;object-fit:cover;transition:transform 320ms cubic-bezier(.2,.8,.2,1),opacity 240ms ease;opacity:0}
.tg-card__img[data-loaded="true"]{opacity:1}
.tg-card:hover .tg-card__img{transform:scale(1.045)}
.tg-card__icon{color:var(--dsw-alias-label-tertiary,#888);transition:transform 220ms cubic-bezier(.2,.8,.2,1),color 220ms ease}
.tg-card:hover .tg-card__icon{transform:scale(1.08);color:var(--dsw-alias-label-secondary,#6b7280)}
/* 不用 backdrop-filter：时间轴 80+ 徽标各建 backdrop root，滚动时整页重采样掉帧；
   实底半透明 + 细边在缩略图上观感等价。 */
.tg-card__kind-dot{position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:9px;font-size:10px;font-weight:600;letter-spacing:.02em;color:#fff;background:rgba(15,17,23,.76);border:1px solid rgba(255,255,255,.16);opacity:0;transform:translateY(-3px);transition:opacity 180ms ease,transform 180ms ease;pointer-events:none}
.tg-card:hover .tg-card__kind-dot{opacity:1;transform:translateY(0)}
/* 「N 张」计数徽标：留在**左上角**（类型标签已挪到右上角，两者不再撞车）。
   计数是「这张卡里有几张」的量词，属于附加信息；类型才是主信息，占右上主位。 */
.tg-card__count{position:absolute;top:8px;left:8px;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:9px;font-size:10px;font-weight:600;letter-spacing:.02em;color:#fff;background:rgba(15,17,23,.76);border:1px solid rgba(255,255,255,.16);opacity:0;transform:translateY(-3px);transition:opacity 180ms ease,transform 180ms ease;pointer-events:none}
.tg-card:hover .tg-card__count{opacity:1;transform:translateY(0)}
.tg-card--tile .tg-card__count{opacity:1;transform:none;top:6px;left:6px;height:16px;font-size:9.5px}
.tg-card__meta{display:flex;flex-direction:column;gap:2px;padding:8px 10px 10px;min-width:0}
.tg-card__name{font-size:12px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-primary,#111827);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__sub{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#888);display:flex;align-items:center;gap:6px;min-width:0}
.tg-card__sub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.tg-card__play svg{filter:drop-shadow(0 2px 8px rgba(0,0,0,.5));opacity:.92;transition:transform 200ms cubic-bezier(.2,.8,.2,1)}
.tg-card:hover .tg-card__play svg{transform:scale(1.12)}

/* ── 骨架屏（加载态）────────────────────────────────────────────── */
.tg-skel{border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));overflow:hidden;animation:tg-card-in 260ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-i,0) * 30ms)}
.tg-skel__thumb{width:100%;aspect-ratio:4/3;position:relative;overflow:hidden;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent))}
.tg-skel__thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent) 45%,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 7%,transparent) 55%,transparent 80%);transform:translateX(-100%);animation:tg-shimmer 1.4s ease-in-out infinite}
@keyframes tg-shimmer{to{transform:translateX(100%)}}
.tg-skel__line{height:10px;margin:10px;border-radius:5px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent));position:relative;overflow:hidden}
.tg-skel__line::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent) 50%,transparent 80%);transform:translateX(-100%);animation:tg-shimmer 1.4s ease-in-out infinite}
.tg-skel__line--short{width:55%}

/* ── 空态 / 错误态 ─────────────────────────────────────────────── */
.tg-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 24px;color:var(--dsw-alias-label-tertiary,#888);animation:tg-fade-in 240ms ease}
.tg-empty__icon{opacity:.5;animation:tg-float 3.2s ease-in-out infinite}
@keyframes tg-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.tg-empty__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280)}
.tg-empty__hint{font-size:12px;text-align:center;max-width:42ch;line-height:1.7}
@keyframes tg-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

/* ── stale 提示条 ───────────────────────────────────────────────── */
.tg-stale{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));animation:tg-fade-in 200ms ease}
.tg-stale__dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#888);animation:tg-pulse 1.4s ease-in-out infinite;flex:none}
@keyframes tg-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}

/* ── 时间筛选钮 + 预设弹层 ──────────────────────────────────────── */
/* 注意：这里**不再**用 margin-left:auto —— 贴右已由外层 .tg-tools 承担；
   留在组内会把时间钮之后的分类/数量/刷新推到组外，顺序就散了。 */
.tg-time{position:relative;display:flex;align-items:center;flex:none}
.tg-time__btn{display:inline-flex;align-items:center;justify-content:center;height:28px;width:auto;padding:0 9px;gap:6px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;transition:color 140ms ease,background 140ms ease,border-color 140ms ease}
.tg-time__btn:hover{color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent))}
.tg-time__btn[data-active="true"]{color:var(--dsw-alias-state-business-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 24%,transparent);font-weight:600}
.tg-time__badge{font-size:11px;font-weight:600;white-space:nowrap;max-width:14ch;overflow:hidden;text-overflow:ellipsis}
.tg-time-pop{position:absolute;top:calc(100% + 8px);left:0;z-index:40;width:296px;padding:12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));box-shadow:0 12px 36px color-mix(in srgb,var(--dsw-alias-label-primary,#000) 18%,transparent),0 2px 8px rgba(0,0,0,.06);transform-origin:top left;animation:tg-pop-in 170ms cubic-bezier(.2,.8,.2,1)}
@keyframes tg-pop-in{from{opacity:0;transform:translateY(-6px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
.tg-time-pop__presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.tg-time-pop__preset{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;font-family:inherit;cursor:pointer;text-align:left;transition:color 140ms ease,background 140ms ease,border-color 140ms ease,transform 120ms cubic-bezier(.2,.8,.2,1)}
.tg-time-pop__preset:hover{color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent));transform:translateY(-1px)}
.tg-time-pop__preset:active{transform:translateY(0) scale(.97)}
.tg-time-pop__preset[data-active="true"]{color:var(--dsw-alias-state-business-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 30%,transparent);font-weight:600}
.tg-time-pop__custom{margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));display:flex;flex-direction:column;gap:7px}
.tg-time-pop__custom-label{font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary,#888)}
.tg-time-pop__custom-row{display:flex;align-items:center;gap:6px}
.tg-time-pop__date{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent));color:var(--dsw-alias-label-primary,#111827);font-size:11.5px;font-family:inherit;outline:none;transition:border-color 140ms ease,box-shadow 140ms ease}
.tg-time-pop__date:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 24%,transparent)}
.tg-time-pop__sep{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);flex:none}
.tg-time-pop__apply{flex:none;height:28px;padding:0 12px;border-radius:8px;border:none;background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:filter 140ms ease,transform 120ms cubic-bezier(.2,.8,.2,1)}
.tg-time-pop__apply:hover{filter:brightness(1.1);transform:translateY(-1px)}
.tg-time-pop__apply:active{transform:translateY(0) scale(.97)}

/* ── 搜索框内的时间命中标记 ─────────────────────────────────────── */
.tg-search__input[data-time-hit="true"]{padding-right:104px;border-color:var(--dsw-alias-state-business-primary,#3b82f6)}
.tg-search__time-tag{position:absolute;right:7px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;gap:4px;height:19px;padding:0 7px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 24%,transparent);color:var(--dsw-alias-state-business-primary,#3b82f6);font-size:10.5px;font-weight:600;white-space:nowrap;pointer-events:none;animation:tg-tag-in 200ms cubic-bezier(.2,.8,.2,1)}
@keyframes tg-tag-in{from{opacity:0;transform:translateY(-50%) translateX(6px) scale(.9)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}

/* ── 视图切换（网格 ⇄ 时间轴，对齐分段控制样式）─────────────────── */
.tg-view{flex:none;display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));box-sizing:border-box;position:relative}
.tg-view__btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:color 150ms ease,background 180ms cubic-bezier(.2,.8,.2,1),transform 150ms cubic-bezier(.2,.8,.2,1),box-shadow 150ms ease}
.tg-view__btn:hover{color:var(--dsw-alias-label-primary,#111827)}
.tg-view__btn:active{transform:scale(.92)}
.tg-view__btn[data-active="true"]{color:var(--dsw-alias-state-business-primary,#3b82f6);background:var(--dsw-alias-bg-layer-1,#fff);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary,#000) 10%,transparent)}

/* ── 时间筛选条 ─────────────────────────────────────────────────── */
.tg-time-bar{flex:none;display:flex;align-items:center;gap:8px;padding:7px 18px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 4%,transparent);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));animation:tg-fade-in 200ms ease}
.tg-time-bar__icon{display:flex;color:var(--dsw-alias-state-business-primary,#3b82f6);animation:tg-clock-sway 3.6s ease-in-out infinite}
@keyframes tg-clock-sway{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-9deg)}75%{transform:rotate(9deg)}}
.tg-time-bar__name{color:var(--dsw-alias-label-primary,#111827);font-weight:600;max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── 时间轴视图 ─────────────────────────────────────────────────── */
/* 不用 content-visibility:auto：滚动时分组进出视口会触发整组重布局 + 组内
   lazy 图集中加载，实测掉到 43fps 且伴随 longtask 卡顿；去掉后 280+fps。
   屏外成本改由 img loading=lazy 单独承担。 */
.tg-day{position:relative;padding-left:22px;margin-bottom:14px;animation:tg-day-in 340ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms)}
@keyframes tg-day-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
/* 竖轨：自上而下生长 */
.tg-day::before{content:"";position:absolute;left:5px;top:4px;bottom:-14px;width:2px;border-radius:1px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.18));transform-origin:top;animation:tg-rail-grow 520ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms)}
.tg-day:last-child::before{bottom:auto;height:22px}
@keyframes tg-rail-grow{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}
/* 日期头：钉住 + 节点 */
/* 不 sticky：sticky 头在滚动期每帧参与合成重绘（实测掉 6fps）；日期头随内容滚走，
   分组感由竖轨节点承担。 */
.tg-day__head{position:relative;display:flex;align-items:center;gap:7px;padding:5px 10px 5px 0;margin-bottom:7px;animation:tg-fade-in 260ms ease backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms)}
.tg-day__dot{position:absolute;left:-20px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 3px var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));animation:tg-dot-pop 380ms cubic-bezier(.2,1.5,.4,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms + 60ms)}
@keyframes tg-dot-pop{from{opacity:0;transform:scale(0)}60%{opacity:1;transform:scale(1.35)}to{opacity:1;transform:scale(1)}}
.tg-day__label{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#111827);letter-spacing:.01em}
.tg-day__weekday{font-size:10.5px;font-weight:500;color:var(--dsw-alias-label-tertiary,#888);padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}
.tg-day__count{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums}
.tg-day__rule{flex:1;height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.12));transform-origin:left;animation:tg-rule-in 420ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms + 90ms)}
@keyframes tg-rule-in{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
/* 手机相册式高密度方格：正方形缩略图铺满，间距 4px */
.tg-day__tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px 10px}
@media (max-width:640px){.tg-day__tiles{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px 8px}.tg-day{padding-left:18px}.tg-day::before{left:4px}.tg-day__dot{left:-17px}}

/* 方格卡片：无内边距、无下缘 meta，名字沉到 hover 浮层 */
.tg-card--tile{border-radius:10px;border-color:transparent;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));animation-duration:220ms;animation-delay:calc(var(--tg-i,0) * 14ms)}
.tg-card--tile:hover{transform:translateY(-2px);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.2));box-shadow:0 6px 18px rgba(0,0,0,.34);z-index:2}
.tg-tile__thumb{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));display:flex;align-items:center;justify-content:center}
.tg-tile__thumb .tg-card__img{border-radius:10px}
.tg-tile__thumb .tg-card__icon svg{width:30px;height:30px}
.tg-tile__thumb .tg-card__play svg{width:32px;height:32px}
/* 方格里类别徽标常显（不 hover 也要知道是啥类型） */
.tg-card--tile .tg-card__kind-dot{opacity:1;transform:none;top:6px;right:6px;height:16px;font-size:9.5px}
/* 文件名常驻缩略图下方（不 hover 也看得见） */
.tg-tile__meta{display:flex;flex-direction:column;gap:1px;padding:6px 2px 2px;min-width:0}
.tg-tile__name{font-size:11px;font-weight:500;line-height:15px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-tile__sub{font-size:10px;line-height:13px;color:var(--dsw-alias-label-tertiary,#7c828c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Lightbox ──────────────────────────────────────────────────── */
.tg-lb{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(8,9,13,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);animation:tg-lb-in 200ms ease}
.tg-lb[data-closing="true"]{animation:tg-lb-out 160ms ease forwards}
@keyframes tg-lb-in{from{opacity:0}to{opacity:1}}
@keyframes tg-lb-out{from{opacity:1}to{opacity:0}}
.tg-lb__stage{position:relative;max-width:min(92vw,1480px);max-height:92vh;display:flex;flex-direction:column;align-items:center;gap:10px;animation:tg-stage-in 240ms cubic-bezier(.2,.8,.2,1)}
.tg-lb[data-closing="true"] .tg-lb__stage{animation:tg-stage-out 150ms ease forwards}
@keyframes tg-stage-in{from{opacity:0;transform:scale(.94) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes tg-stage-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.96) translateY(6px)}}
.tg-lb__close{position:absolute;top:-14px;right:-14px;z-index:3;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(24,26,33,.9);color:#e5e7eb;cursor:pointer;transition:transform 200ms cubic-bezier(.2,.8,.2,1),background 160ms ease;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.tg-lb__close:hover{background:rgba(50,54,66,.95);transform:rotate(90deg) scale(1.06)}
/* 全屏切换钮：贴在关闭钮左下侧成一列；进入全屏后图标换成收拢形并常驻高亮。
   hover 轻微上浮 + 底色提亮，与关闭钮同一套手感。 */
.tg-lb__fullbtn{position:absolute;top:24px;right:-14px;z-index:3;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(24,26,33,.9);color:#e5e7eb;cursor:pointer;transition:transform 160ms cubic-bezier(.2,.8,.2,1),background 160ms ease,color 160ms ease;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.tg-lb__fullbtn:hover{background:rgba(50,54,66,.95);transform:translateY(-2px)}
.tg-lb__fullbtn:active{transform:translateY(0) scale(.94)}
.tg-lb__fullbtn[data-full="true"]{color:#fff;background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent}
/* ── 全屏态：预览体铺满视口，元信息沉底成渐变浮层 ─────────────────── */
.tg-lb[data-full="true"] .tg-lb__stage{max-width:100vw;max-height:100vh;width:100vw;height:100vh;gap:0;animation:tg-full-in 260ms cubic-bezier(.2,.8,.2,1)}
@keyframes tg-full-in{from{opacity:.4;transform:scale(.985)}to{opacity:1;transform:scale(1)}}
.tg-lb[data-full="true"] .tg-lb__img{max-width:100vw;max-height:100vh;width:100vw;height:100vh;object-fit:contain;border-radius:0;box-shadow:none}
.tg-lb[data-full="true"] .tg-lb__video{max-width:100vw;max-height:100vh;width:100vw;height:100vh;border-radius:0}
.tg-lb[data-full="true"] .tg-lb__frame{width:100vw;height:100vh;border-radius:0;border:none}
.tg-lb[data-full="true"] .tg-lb__genrow{width:100vw;height:100vh;max-height:100vh}
.tg-lb[data-full="true"] .tg-lb__genrow .tg-lb__img{width:auto;height:auto;max-width:100vw;max-height:100vh;object-fit:contain}
.tg-lb[data-full="true"] .tg-lb__meta{position:absolute;left:0;right:0;bottom:0;max-width:100vw;padding:34px 20px 14px;background:linear-gradient(to top,rgba(6,7,10,.86),rgba(6,7,10,0));animation:tg-fade-in 220ms ease}
.tg-lb[data-full="true"] .tg-lb__nav--prev{left:14px}
.tg-lb[data-full="true"] .tg-lb__nav--next{right:14px}
.tg-lb[data-full="true"] .tg-lb__close{top:14px;right:14px}
.tg-lb[data-full="true"] .tg-lb__fullbtn{top:52px;right:14px}
.tg-lb__img{max-width:min(92vw,1480px);max-height:76vh;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.55);background:#0b0c10;animation:tg-img-in 300ms cubic-bezier(.2,.8,.2,1)}
@keyframes tg-img-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.tg-lb__video{max-width:min(92vw,1280px);max-height:76vh;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.55);background:#000}
.tg-lb__frame{width:min(92vw,1280px);height:min(76vh,860px);border-radius:12px;border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 60px rgba(0,0,0,.55);background:#fff}
.tg-lb__meta{display:flex;align-items:center;gap:12px;max-width:min(92vw,1480px);color:#c7ccd4;font-size:12px;animation:tg-fade-in 260ms ease 80ms backwards;min-width:0}
.tg-lb__name{font-weight:600;color:#f3f4f6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52ch}
.tg-lb__dim{opacity:.7;white-space:nowrap}
.tg-lb__actions{display:flex;align-items:center;gap:6px;margin-left:auto;flex:none}
.tg-lb__btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#e5e7eb;font-size:12px;font-family:inherit;cursor:pointer;transition:background 150ms ease,transform 150ms cubic-bezier(.2,.8,.2,1);white-space:nowrap}
.tg-lb__btn:hover{background:rgba(255,255,255,.16);transform:translateY(-1px)}
.tg-lb__btn:active{transform:translateY(0) scale(.97)}
.tg-lb__nav{position:absolute;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;width:40px;height:56px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(20,22,28,.72);color:#e5e7eb;cursor:pointer;transition:background 150ms ease,transform 150ms cubic-bezier(.2,.8,.2,1);z-index:2}
.tg-lb__nav:hover{background:rgba(46,50,62,.9)}
.tg-lb__nav--prev{left:-56px}
.tg-lb__nav--next{right:-56px}
.tg-lb__nav--prev:hover{transform:translateY(-50%) translateX(-2px)}
.tg-lb__nav--next:hover{transform:translateY(-50%) translateX(2px)}
@media (max-width:1100px){.tg-lb__nav--prev{left:6px}.tg-lb__nav--next{right:6px}}
.tg-lb__hint{color:#8b9099;font-size:11px;animation:tg-fade-in 300ms ease 160ms backwards}
.tg-lb__genrow{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;max-height:76vh;overflow:auto}
.tg-lb__genrow .tg-lb__img{max-height:64vh}
/* ── 页图预览（PPT / Word / Excel）──────────────────────────────── */
.tg-paged{position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:min(92vw,1480px);max-height:76vh}
.tg-paged__img{margin:0 auto;max-width:min(92vw,1480px);max-height:70vh;object-fit:contain;background:#fff}
.tg-paged[data-full="true"] .tg-paged__img{max-width:100vw;max-height:calc(100vh - 96px)}
.tg-paged__spin{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:rgba(15,17,23,.62);color:#e5e7eb;pointer-events:none;animation:tg-fade-in 140ms ease}
.tg-paged__spin svg{animation:tg-spin 900ms linear infinite}
.tg-paged__bar{display:flex;align-items:center;gap:10px;padding:4px 10px;border-radius:12px;background:rgba(15,17,23,.72);border:1px solid rgba(255,255,255,.12);animation:tg-fade-in 200ms ease}
.tg-paged__step{height:26px;padding:0 12px}
.tg-paged__step:disabled{opacity:.4;cursor:not-allowed;transform:none}
.tg-paged__pos{font-size:12px;color:#d7dbe2;font-variant-numeric:tabular-nums;white-space:nowrap}
.tg-lb__loading--col{flex-direction:column;gap:12px;max-width:44ch;text-align:center;line-height:1.7;color:#9ca3af}
.tg-lb__loading{color:#c7ccd4;font-size:12.5px;display:flex;align-items:center;gap:8px}
.tg-lb__loading svg{animation:tg-spin 900ms linear infinite}

@media (prefers-reduced-motion:reduce){
  .tg-card,.tg-skel,.tg-empty,.tg-stale,.tg-lb,.tg-lb__stage,.tg-lb__img,.tg-lb__meta,.tg-lb__hint,.tg-session-bar,.tg-dock{animation:none!important}
  .tg-card,.tg-card:hover,.tg-icon-btn,.tg-lb__close,.tg-lb__fullbtn,.tg-lb__btn,.tg-lb__nav,.tg-kind,.tg-dock__item,.tg-card__img,.tg-card__icon,.tg-card__kind-dot{transition:none!important}
  .tg-lb[data-full="true"] .tg-lb__stage{animation:none!important}
  .tg-skel__thumb::after,.tg-skel__line::after{animation:none!important}
  .tg-empty__icon,.tg-stale__dot,.tg-icon-btn[data-spinning="true"] svg,.tg-lb__loading svg{animation:none!important}
  .tg-paged__spin,.tg-paged__spin svg,.tg-paged__bar{animation:none!important}
  .tg-day,.tg-day::before,.tg-day__head,.tg-day__dot,.tg-day__rule,.tg-time-pop,.tg-search__time-tag,.tg-time-bar{animation:none!important}
  .tg-time-pop__preset,.tg-time-pop__apply,.tg-view__btn{transition:none!important}
  .tg-time-bar__icon{animation:none!important}
}
`

/** 注入画廊样式（幂等）。 */
export function ensureGalleryStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) {
    if (existing.textContent !== SHEET) {
      existing.textContent = SHEET
    }
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
