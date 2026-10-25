/**
 * dsh-chat-plus — 多媒体画廊样式（注入式，DSH 原生 token，暗/亮主题自适应）。
 *
 * 视觉骨架沿用工作台既有语言（与记忆 / 邮箱面板同一套 token 与圆角节奏），
 * 动效按「渐进式微调」原则加：卡片入场级联上浮、hover 提亮浮起、骨架屏微光
 * 扫动、类别徽标下滑浮现、时间轴竖轨自上而下生长 + 日期节点弹出 + 分组逐段
 * 浮入、时间筛选弹层缩放淡入。全部动画尊重 prefers-reduced-motion（只关动画，
 * 不动布局）。
 *
 * 2026-10-19：插件自己的 Lightbox（tg-lb__* / tg-paged__*）整块删除 —— 预览
 * 一律交官方右侧栏（用户点名「全部用官方的侧边栏查看」）。那一族样式没有别的
 * 使用者，留着只会让后来的人以为还有第二个弹窗。
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

/* ── 类别胶囊条已整条删除（2026-10-25）───────────────────────────────
   这里曾经是「图片 / 网页 / 视频 / PDF…」那一排类别胶囊（.tg-dock / .tg-kind），
   上面挂着每个类别的实时计数与「一次清空整个分类」的批量删除键。

   现在两件事都不在页内了：
    ① 类别入口搬进侧栏二级菜单（操作间 → 画廊 → 8 个类别）；
    ② 用户点名「画廊页面的这些不需要了删除掉」，胶囊栏连同它的批量删除一起
       下线（当时明确选了「一起删掉，彻底干净」，不是收进某个图标按钮里）。

   所以下面直接从工具条的搜索框开始 —— 中间那段空白是刻意的，不要再把类别
   胶囊加回来：侧栏已经是类别的唯一入口，页内再来一排只会让人不知道该点哪。 */
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
/* 方格变体的徽标 / 快捷点尺寸统一在下面「时间轴视图」段落里定义（2026-10-24 归一），
   这里不再各写一份，改尺寸只改一处。 */
/* 「就地预览」快捷点（2026-10-20）。
   卡片的主语义换成了「用默认应用打开」，但浏览时不该被迫为每张图开一个外部窗口 ——
   这枚眼睛只负责「在这里看看」。hover / focus-within 浮现，平时不占视觉；
   缩略图角落铺一层模糊底，压在任意颜色的图上都读得清。 */
.tg-card__peek{position:absolute;right:40px;bottom:8px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;color:#fff;background:rgba(15,17,23,.72);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);opacity:0;transform:translateY(4px) scale(.94);transition:opacity 180ms ease,transform 220ms cubic-bezier(.2,.8,.2,1),background 160ms ease;cursor:pointer;z-index:2}
.tg-card:hover .tg-card__peek,.tg-card:focus-within .tg-card__peek{opacity:1;transform:translateY(0) scale(1)}
.tg-card__peek:hover{background:rgba(15,17,23,.9);border-color:rgba(255,255,255,.32)}
.tg-card__peek:active{transform:scale(.92)}
.tg-card__peek svg{pointer-events:none}
.tg-card__meta{display:flex;flex-direction:column;gap:2px;padding:8px 10px 10px;min-width:0}
.tg-card__name{font-size:12px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-primary,#111827);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__sub{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#888);display:flex;align-items:center;gap:6px;min-width:0}
.tg-card__sub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.tg-card__play svg{filter:drop-shadow(0 2px 8px rgba(0,0,0,.5));opacity:.92;transition:transform 200ms cubic-bezier(.2,.8,.2,1)}
.tg-card:hover .tg-card__play svg{transform:scale(1.12)}

/* ── 分类删除的卡片退场（2026-10-16）──────────────────────────────
   分类级删除是「整批一起走」，所以逐条淡出 + 轻微下沉缩放，靠内联的
   animation-delay 错峰（见 GalleryPanel 的 delStaggerMs），读起来是「一条条
   被抹掉」而不是整块闪没 —— 与 kr-chat 一键删记忆的 kr-memory-row-out 同款手感，
   只是这里的卡片更大、位移收得更小（网格里横向抖一下会很晃）。
   animation-fill-mode:both 保证 delay 期间也是首帧（opacity 1），不会提前消失。 */
.tg-card--out{animation:tg-card-out 260ms cubic-bezier(.4,0,1,1) both;pointer-events:none}
@keyframes tg-card-out{
  from{opacity:1;transform:translateY(0) scale(1)}
  to{opacity:0;transform:translateY(6px) scale(.94)}
}

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

/* ── 删除失败提示行（2026-10-16）──────────────────────────────────
   落在工具条下方、筛选条上方：删除是工具条上的动作，结果就近显示在同一视野里。
   与 .tg-stale 同高同内距（前后不跳版），但用告警色区分「只是慢」与「真出了事」。
   文案必须带条数与首条原因 —— 失败条目仍留在清单里，这行是它们的解释。 */
.tg-del-error{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:11.5px;
  color:var(--dsw-alias-label-primary,#111827);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 8%,transparent);
  border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 24%,transparent);
  animation:tg-fade-in 180ms ease}
.tg-del-error__icon{display:flex;flex:none;color:var(--dsw-alias-state-error-primary,#dc2626)}
.tg-del-error__text{flex:1;min-width:0;word-break:break-word}
.tg-del-error__close{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 26%,transparent);
  background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-family:inherit;font-size:11px;cursor:pointer;
  transition:background 140ms ease,color 140ms ease}
.tg-del-error__close:hover{color:var(--dsw-alias-label-primary,#111827);background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 8%,transparent)}

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

/* ── 时间轴视图（极简现代质感，支持单日折叠与整组折叠）─────────────── */
/* 不用 content-visibility:auto：滚动时分组进出视口会触发整组重布局 + 组内
   lazy 图集中加载，实测掉到 43fps 且伴随 longtask 卡顿；去掉后 280+fps。
   屏外成本改由 img loading=lazy 单独承担。 */
.tg-day{position:relative;padding-left:26px;margin-bottom:26px;transition:margin-bottom 180ms ease;animation:tg-day-in 340ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 45ms)}
.tg-day[data-collapsed="true"]{margin-bottom:8px}
@keyframes tg-day-in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
/* 竖轨：极简细线，自上而下生长 */
.tg-day::before{content:"";position:absolute;left:7px;top:15px;bottom:-26px;width:1.5px;border-radius:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.14));transform-origin:top;animation:tg-rail-grow 480ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 45ms)}
.tg-day:last-child::before{bottom:auto;height:14px}
.tg-day[data-collapsed="true"]::before{bottom:-8px}
.tg-day:last-child[data-collapsed="true"]::before{bottom:auto;height:14px}
@keyframes tg-rail-grow{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}
/* 日期头：整行作为收起/展开按钮，悬浮微底色，干净极简 */
.tg-day__head{position:relative;display:inline-flex;align-items:center;gap:6px;padding:3px 8px 3px 4px;margin-bottom:12px;border-radius:8px;border:none;background:transparent;color:inherit;cursor:pointer;font-family:inherit;text-align:left;user-select:none;transition:background 140ms ease,transform 120ms ease;animation:tg-fade-in 240ms ease backwards;animation-delay:calc(var(--tg-day-i,0) * 45ms)}
.tg-day__head:hover{background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent))}
.tg-day__head:active{transform:scale(.985)}
.tg-day__head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:1px}
/* 时间轴节点：安静质感空心圆，hover 或折叠时柔和响应 */
.tg-day__dot{position:absolute;left:-22px;top:50%;width:7px;height:7px;margin-top:-3.5px;border-radius:50%;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));border:1.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.38));box-sizing:border-box;transition:transform 160ms cubic-bezier(.2,.8,.2,1),border-color 160ms ease,background 160ms ease,box-shadow 160ms ease;animation:tg-dot-pop 340ms cubic-bezier(.2,1.5,.4,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 45ms + 50ms)}
@keyframes tg-dot-pop{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
.tg-day__head:hover .tg-day__dot{border-color:var(--dsw-alias-state-business-primary,#3b82f6);background:var(--dsw-alias-state-business-primary,#3b82f6);transform:scale(1.25);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 20%,transparent)}
.tg-day[data-collapsed="true"] .tg-day__dot{border-color:var(--dsw-alias-label-tertiary,#888);background:var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
/* 折叠箭头 */
.tg-day__chevron{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,#888);transition:transform 200ms cubic-bezier(.2,.8,.2,1),color 140ms ease;flex:none}
.tg-day__head:hover .tg-day__chevron{color:var(--dsw-alias-label-primary,#111827)}
.tg-day[data-collapsed="true"] .tg-day__chevron{transform:rotate(-90deg)}
/* 日期与星期 */
.tg-day__label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#111827);letter-spacing:.005em;line-height:1.2}
.tg-day__weekday{font-size:11.5px;font-weight:400;color:var(--dsw-alias-label-tertiary,#888);margin-left:1px;line-height:1.2}
/* 数量胶囊：简约扁平 */
.tg-day__count{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:9px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary,#888);background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.1));font-variant-numeric:tabular-nums;line-height:1;margin-left:3px;transition:color 140ms ease,background 140ms ease,border-color 140ms ease}
.tg-day[data-collapsed="true"] .tg-day__count{color:var(--dsw-alias-state-business-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 20%,transparent);font-weight:600}
/* 网格 */
.tg-day__tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(182px,1fr));gap:14px 14px}
.tg-day[data-collapsed="true"] .tg-day__tiles{display:none}
@media (max-width:640px){.tg-day__tiles{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px 10px}.tg-day{padding-left:20px}.tg-day::before{left:5px}.tg-day__dot{left:-18px}}

/* 方格卡片：无内边距、微边框定义、无下缘 meta，名字沉到 hover 浮层 */
.tg-card--tile{border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));animation-duration:220ms;animation-delay:calc(var(--tg-i,0) * 14ms);transition:transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms ease,border-color 180ms ease}
.tg-card--tile:hover{transform:translateY(-3px);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.28));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary,#000) 12%,transparent);z-index:2}
.tg-tile__thumb{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;border-radius:12px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));display:flex;align-items:center;justify-content:center}
.tg-tile__thumb .tg-card__img{border-radius:12px}
.tg-tile__thumb .tg-card__icon svg{width:36px;height:36px}
.tg-tile__thumb .tg-card__play svg{width:38px;height:38px}
/* 方格右上角**不显示类型徽标**（2026-10-24 用户点名：右上角不用显示标识）。
   分类已经在工具条上选定了，每格再挂一枚「图片 / 网页 / 音频」纯属噪声 ——
   整块下掉，连 hover 也不放行（不是 opacity:0，直接不参与布局）。 */
.tg-card--tile .tg-card__kind-dot{display:none}
.tg-card--tile .tg-card__count{opacity:1;transform:none;top:7px;left:7px;height:17px;padding:0 8px;font-size:10px}
/* 徽标撤走后快捷点回到角上（原 top:30px 是为了给它让位） */
.tg-card--tile .tg-card__peek{right:37px;bottom:auto;top:7px;width:24px;height:24px;border-radius:8px}
/* 单卡删除钮（2026-10-24）：hover / 聚焦浮现。
   网格视图里预览眼在左（right:40px），删除钮在右角（right:8px）；方格视图里
   两枚并排挂在缩略图顶部：预览眼在左（right:37px），删除钮在右角（right:7px）。
   第一次点变成红底「删除?」，再点一次才真删 —— 所以确认态必须有足够宽度，
   向左撑开时已隐藏预览眼避免遮挡。 */
.tg-card__del{position:absolute;right:8px;bottom:8px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border-radius:8px;color:#fff;background:rgba(15,17,23,.72);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);opacity:0;transform:translateY(4px) scale(.94);transition:opacity 180ms ease,transform 220ms cubic-bezier(.2,.8,.2,1),background 160ms ease,border-color 160ms ease,width 180ms cubic-bezier(.2,.8,.2,1);cursor:pointer;z-index:3;font-family:inherit}
.tg-card:hover .tg-card__del,.tg-card:focus-within .tg-card__del{opacity:1;transform:translateY(0) scale(1)}
.tg-card__del:hover{background:rgba(220,60,60,.9);border-color:rgba(255,255,255,.36)}
.tg-card__del:active{transform:scale(.92)}
.tg-card__del[data-armed="true"]{width:auto;min-width:52px;padding:0 9px;background:rgba(214,48,48,.96);border-color:rgba(255,255,255,.5);box-shadow:0 0 0 2px rgba(214,48,48,.22)}
.tg-card__del-text{font-size:11px;font-weight:600;line-height:1;white-space:nowrap;letter-spacing:.02em}
.tg-card__del svg{pointer-events:none}
/* 方格里：两枚按钮并排挂在缩略图顶部：预览眼在左（37px），删除在右（7px）。 */
.tg-card--tile .tg-card__del{right:7px;bottom:auto;top:7px;width:24px;height:24px;border-radius:8px}
.tg-card--tile .tg-card__del[data-armed="true"]{min-width:50px;padding:0 8px}
/* 文件名与时间：**不再常驻在缩略图下方**（2026-10-25 用户要求）——
   默认整块隐去，格子就是一个干净的正方形缩略图；鼠标移上来（或键盘聚焦）时
   以浮层形式淡入在缩略图**内部的下缘**，压在图上。
   好处是同一屏能多放一整行内容：名字是"我要找的那一张吗"的确认信息，扫视时
   靠图就够，需要确认时鼠标一停就有。
   浮层自带自下而上的渐变底，压在任何亮度的图上都读得清（不用 backdrop-filter：
   时间轴动辄上百个格子，各建 backdrop root 会让滚动掉帧，见上面徽标那段的实测）。 */
.tg-tile__meta{position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;flex-direction:column;gap:1px;
  padding:22px 10px 9px;min-width:0;pointer-events:none;
  background:linear-gradient(to top,rgba(10,11,15,.88) 0%,rgba(10,11,15,.66) 46%,rgba(10,11,15,0) 100%);
  opacity:0;transform:translateY(6px);
  transition:opacity 180ms ease,transform 220ms cubic-bezier(.2,.8,.2,1)}
.tg-card:hover .tg-tile__meta,.tg-card:focus-within .tg-tile__meta{opacity:1;transform:translateY(0)}
.tg-tile__name{font-size:12px;font-weight:500;line-height:17px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.tg-tile__sub{font-size:10.5px;line-height:14px;color:rgba(255,255,255,.74);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.5)}

/* ══ 预览弹窗（2026-10-19 重做）═════════════════════════════════════════
 *
 * 旧版的问题不是配色，是**没有容器**：关闭钮与全屏钮挂在图片外右上角（负偏移，
 * 像贴纸）、文件名与元信息散在图片下方一行、图片和遮罩之间没有边界 —— 整块
 * 看起来就是「一张图浮在暗背景上」。
 *
 * 现在是一张完整的浮动面板：头部一条（类型图标 + 文件名 + 元信息 + 图标按钮组）、
 * 内容区自己持有边界、面板本体有 1px 内描边 + 双层投影。跟浏览器窗口是两张
 * 明确的层，不是贴纸。
 *
 * 尺寸用 clamp 而不是固定 px：1470 宽的屏上给 92vw/86vh，笔记本上用 min() 收敛，
 * 小屏退化成贴边全屏（<720px 时圆角归零、遮罩不留边）。
 *
 * 配色一律取官方 dsw-alias token；面板本身刻意是「深色玻璃」而不跟主题变白 ——
 * 看图的时候周围越暗越好，这是所有看图器件的共同约定（浅色面板会把图片边缘
 * 的白底照得发灰）。
 */

.glb{position:fixed;inset:0;z-index:1300;display:flex;align-items:center;justify-content:center;
  padding:clamp(12px,3vh,40px);
  background:color-mix(in srgb, #06070a 78%, transparent);
  backdrop-filter:blur(14px) saturate(.9);-webkit-backdrop-filter:blur(14px) saturate(.9);
  animation:glb-veil-in 200ms cubic-bezier(.32,.72,0,1);
  font-family:inherit;-webkit-font-smoothing:antialiased}
.glb[data-closing="true"]{animation:glb-veil-out 170ms ease forwards}
@keyframes glb-veil-in{from{opacity:0;backdrop-filter:blur(0) saturate(1)}to{opacity:1}}
@keyframes glb-veil-out{from{opacity:1}to{opacity:0}}

/* 面板：深色玻璃 + 双层投影（近距离一圈定义轮廓，远距离一层托出层次）。 */
.glb-panel{position:relative;display:flex;flex-direction:column;
  width:min(92vw,1480px);max-height:min(88vh,940px);
  border-radius:18px;overflow:hidden;
  background:color-mix(in srgb, #14161c 96%, transparent);
  border:1px solid rgba(255,255,255,.09);
  box-shadow:0 0 0 1px rgba(0,0,0,.5),0 32px 80px -12px rgba(0,0,0,.7),0 8px 24px -8px rgba(0,0,0,.5);
  animation:glb-panel-in 340ms cubic-bezier(.16,1,.3,1)}
.glb[data-closing="true"] .glb-panel{animation:glb-panel-out 170ms cubic-bezier(.4,0,1,1) forwards}
@keyframes glb-panel-in{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:none}}
@keyframes glb-panel-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(.98) translateY(4px)}}

/* ── 头部：52px，一条发丝线分隔 ─────────────────────────────────────── */
.glb-head{flex:none;display:flex;align-items:center;gap:9px;height:52px;padding:0 10px 0 16px;
  border-bottom:1px solid rgba(255,255,255,.07);
  background:color-mix(in srgb, #191c23 92%, transparent);
  animation:glb-fade 240ms ease 60ms backwards}
.glb-head__glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;border-radius:8px;
  background:rgba(255,255,255,.06);color:rgba(255,255,255,.72)}
.glb-head__title{flex:0 1 auto;min-width:0;font-size:13px;font-weight:600;line-height:1.35;
  color:#eceef2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.005em}
.glb-head__dims{flex:none;font-size:11.5px;color:rgba(255,255,255,.42);
  font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:2px}
.glb-head__sep{width:1px;height:16px;margin:0 2px;background:rgba(255,255,255,.12)}
/* 动作区贴右：图标按钮统一 30px 圆角方，hover 才亮起来（静止时只有 55% 明度）。 */
.glb-head__actions{display:flex;align-items:center;gap:2px;margin-left:auto;flex:none}
.glb-btn{display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;border:0;border-radius:9px;background:transparent;
  color:rgba(255,255,255,.55);cursor:pointer;
  transition:background 140ms ease,color 140ms ease,transform 140ms cubic-bezier(.16,1,.3,1)}
.glb-btn:hover{background:rgba(255,255,255,.1);color:#fff}
.glb-btn:active{transform:scale(.92)}
.glb-btn:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:-2px}
.glb-btn[data-active="true"]{color:#fff;background:rgba(255,255,255,.14)}
.glb-btn--close:hover{background:rgba(235,87,87,.9);color:#fff}

/* ── 内容区：自己持有边界；有内边距（图片类留白），无（iframe 撑满）─────
 *
 * 必须用 grid 而不是 flex 居中：flex 容器里 max-height 百分比的参考高度在
 * 「父级高度由 flex 决定」时会解析失败，图片按宽度撑满后高度溢出容器（实测
 * 面板 882 高、图片被撑到 963 高，底部被裁出一条白边）。grid 的网格区域高度
 * 是确定的，item 的 max-height:100% 才真正生效。 */
.glb-body{position:relative;flex:1 1 auto;min-height:0;
  display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);
  place-items:center;padding:18px;overflow:hidden;
  background:
    radial-gradient(120% 120% at 50% 0%,rgba(255,255,255,.045),transparent 62%),
    #0d0f13;
  animation:glb-fade 260ms ease 80ms backwards}

/*
 * 两类内容区的尺寸策略，必须分开 —— 这是旧版没做、新面板才定下的一条：
 *
 *  · **原生内容**（图片 / 视频 / 音频 / 生图）：面板高度由内容决定（一张小图
 *    不该被撑成整屏高、然后在四周包一圈空气）。所以 body 只给 grid 居中 +
 *    内容自己 max-width/height:100%，panel 保持 max-height 的弹性约束。
 *  · **承载式内容**（html / pdf / office 页图）：iframe 自己的固有高度是 150px
 *    （HTML 规范默认值），内容驱动高度会让它被压成一条 —— 实测 1480×150 的
 *    一条缝。所以这一类让 panel 拿到**确定高度**，body 的 grid 行用 1fr 填满。
 */
.glb-panel[data-fill="true"]{height:min(88vh,940px)}
.glb-body[data-fill="true"]{padding:0}
.glb-body[data-fill="true"] > *{width:100%;height:100%;min-height:0}

.glb-media{display:block;max-width:100%;max-height:100%;min-height:0;min-width:0;
  width:auto;height:auto;object-fit:contain;border-radius:10px;
  background:transparent;box-shadow:0 12px 40px -10px rgba(0,0,0,.65);
  animation:glb-media-in 320ms cubic-bezier(.16,1,.3,1) 40ms backwards}
.glb-media--video{background:#000}
@keyframes glb-media-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}

.glb-frame{width:100%;height:100%;border:0;background:#fff;display:block}

/* 音频：居中一张小卡（方头 + 播放器），没有画面就别铺满整块空区。 */
.glb-audio{display:flex;flex-direction:column;align-items:center;gap:22px;
  padding:40px 48px;border-radius:16px;
  background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);
  max-width:100%}
.glb-audio__glyph{display:inline-flex;align-items:center;justify-content:center;
  width:64px;height:64px;border-radius:50%;
  background:rgba(255,255,255,.06);color:rgba(255,255,255,.7)}
.glb-audio__glyph svg{width:30px;height:30px;stroke-width:1.5}
.glb-audio audio{width:min(460px,62vw);height:34px}

/* 生图多张：并排一列，超出滚动。 */
.glb-genrow{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center;
  max-width:100%;max-height:100%;min-height:0;overflow:auto;padding:2px}
.glb-genrow .glb-media{max-height:100%;width:auto;flex:0 0 auto}

/* 加载 / 空态提示。 */
.glb-note{display:flex;flex-direction:column;align-items:center;gap:12px;
  max-width:46ch;text-align:center;line-height:1.7;
  font-size:12.5px;color:rgba(255,255,255,.55)}
.glb-note svg{width:60px;height:60px;stroke-width:1.2;opacity:.5}
.glb-spin-inline{display:inline-flex;animation:glb-spin 900ms linear infinite}
.glb-spin{position:absolute;display:inline-flex;align-items:center;justify-content:center;
  width:38px;height:38px;border-radius:50%;background:rgba(12,14,18,.72);
  color:rgba(255,255,255,.85);animation:glb-spin 900ms linear infinite;pointer-events:none}
@keyframes glb-spin{to{transform:rotate(360deg)}}

/* ── 页图预览（PPT / Word / Excel）──────────────────────────────────── */
.glb-paged{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  padding:18px 18px 64px;overflow:auto}
.glb-paged__img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;
  background:#fff;box-shadow:0 12px 40px -10px rgba(0,0,0,.6);
  opacity:0;transition:opacity 260ms ease}
.glb-paged__img[data-loaded="true"]{opacity:1}
.glb-paged__bar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:4px;padding:4px;border-radius:11px;
  background:rgba(20,22,28,.92);border:1px solid rgba(255,255,255,.1);
  box-shadow:0 8px 24px -6px rgba(0,0,0,.6);
  animation:glb-fade 220ms ease 120ms backwards}
.glb-paged__step{height:28px;padding:0 12px;border:0;border-radius:8px;background:transparent;
  color:rgba(255,255,255,.78);font-family:inherit;font-size:12px;cursor:pointer;
  transition:background 140ms ease,color 140ms ease}
.glb-paged__step:hover:not(:disabled){background:rgba(255,255,255,.1);color:#fff}
.glb-paged__step:disabled{opacity:.32;cursor:default}
.glb-paged__pos{padding:0 8px;font-size:11.5px;color:rgba(255,255,255,.6);
  font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── 左右翻页：贴内容区两侧，半透明底，hover 才完全显形 ─────────────── */
.glb-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;
  display:flex;align-items:center;justify-content:center;
  width:38px;height:62px;border:1px solid rgba(255,255,255,.1);border-radius:11px;
  background:rgba(18,20,26,.72);color:rgba(255,255,255,.72);cursor:pointer;
  opacity:.55;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  transition:opacity 160ms ease,background 160ms ease,transform 160ms cubic-bezier(.16,1,.3,1)}
.glb-nav:hover{opacity:1;background:rgba(34,38,48,.92);color:#fff}
.glb-nav--prev{left:12px}
.glb-nav--next{right:12px}
.glb-nav--prev:active{transform:translateY(-50%) translateX(-2px) scale(.96)}
.glb-nav--next:active{transform:translateY(-50%) translateX(2px) scale(.96)}

/* ── 底栏：左计数 · 右缩放胶囊 ──────────────────────────────────────── */
.glb-foot{flex:none;position:relative;display:flex;align-items:center;justify-content:center;height:34px;
  padding:0 12px;
  border-top:1px solid rgba(255,255,255,.06);
  background:color-mix(in srgb, #191c23 92%, transparent)}
.glb-foot__count{position:absolute;left:0;right:0;text-align:center;
  font-size:11px;color:rgba(255,255,255,.42);font-variant-numeric:tabular-nums;letter-spacing:.02em;
  pointer-events:none}
.glb-zoom{margin-left:auto;display:flex;align-items:center;gap:6px;z-index:1;min-width:0}
/* 未缩放：一枚极淡的操作提示（提示 Ctrl+滚轮，同时说明这里能放大）。
   刻意压到 30% 明度：它不是按钮，只是说明，不该跟计数抢注意力。 */
.glb-zoom__hint{display:inline-flex;align-items:center;gap:5px;
  font-size:10.5px;color:rgba(255,255,255,.3);white-space:nowrap;
  transition:color 160ms ease}
.glb-body:hover ~ .glb-foot .glb-zoom__hint{color:rgba(255,255,255,.52)}
/* 已缩放：百分比 + 复位钮（亮起来，因为它现在是有信息量的状态）。 */
.glb-zoom[data-active="true"]{padding:2px 2px 2px 9px;border-radius:8px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);
  animation:glb-zoom-in 220ms cubic-bezier(.16,1,.3,1)}
@keyframes glb-zoom-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
.glb-zoom__pct{font-size:11px;font-weight:600;color:rgba(255,255,255,.86);
  font-variant-numeric:tabular-nums;min-width:3.2em;text-align:right}
.glb-zoom__reset{display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;
  color:rgba(255,255,255,.6);cursor:pointer;
  transition:background 140ms ease,color 140ms ease,transform 140ms cubic-bezier(.16,1,.3,1)}
.glb-zoom__reset:hover{background:rgba(255,255,255,.12);color:#fff}
.glb-zoom__reset:active{transform:rotate(-40deg) scale(.9)}
.glb-zoom__reset:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:-2px}

/* 缩放中：裁掉溢出（放大后的图不该盖住头部与底栏）。 */
.glb-body[data-zoomed="true"]{overflow:hidden}

/* Ctrl 遮罩：只在承载式内容（iframe）上出现，见 media-lightbox 里的说明。
   透明、满铺、吃掉所有指针事件 —— 它的唯一职责是把 wheel 接回宿主，
   好让 Ctrl+滚轮 不落到浏览器自己的页面缩放上。 */
.glb-shield{position:absolute;inset:0;z-index:5;background:transparent;cursor:zoom-in}
/* 可缩放目标的公共约束：transform 由 JS 贴，这里只保证合成层与缩放原点。 */
.glb-media,.glb-paged__img,.glb-genrow{transform-origin:center center;backface-visibility:hidden}

/* ── 全屏态：面板铺满、头部浮在内容上、圆角归零 ─────────────────────── */
.glb[data-full="true"]{padding:0;background:#08090c}
.glb[data-full="true"] .glb-panel{width:100vw;height:100vh;max-width:100vw;max-height:100vh;
  border-radius:0;border:0;background:#08090c;box-shadow:none}
/* 全屏下两类都填满（全屏语义就是「占满」）。 */
.glb[data-full="true"] .glb-body[data-fill="true"]{padding:0}
.glb[data-full="true"] .glb-head{position:absolute;top:0;left:0;right:0;z-index:3;
  border-bottom:0;background:linear-gradient(to bottom,rgba(8,9,12,.9),transparent);
  animation:glb-fade 200ms ease}
.glb[data-full="true"] .glb-body{padding:0;background:#08090c}
/* 头部是全屏态里的浮动渐变条（52px 压在内容上），图片给它让出这一条，
   否则顶部会被标题遮住一截。 */
.glb[data-full="true"] .glb-media{border-radius:0;box-shadow:none;max-height:calc(100vh - 52px)}
.glb[data-full="true"] .glb-paged{padding:56px 0 0}
.glb[data-full="true"] .glb-paged__img{max-height:calc(100vh - 56px);border-radius:0}
.glb[data-full="true"] .glb-foot{display:none}
.glb[data-full="true"] .glb-nav{width:44px;height:76px}
.glb[data-full="true"] .glb-nav--prev{left:16px}
.glb[data-full="true"] .glb-nav--next{right:16px}

@keyframes glb-fade{from{opacity:0}to{opacity:1}}

/* 窄屏：面板贴边，圆角收掉（小屏留白只会压缩内容）。 */
@media (max-width:720px){
  .glb{padding:0}
  .glb-panel{width:100vw;height:100vh;max-width:100vw;max-height:100vh;border-radius:0;border:0}
  .glb-body{padding:10px}
  .glb-nav{display:none}
  .glb-head__dims{display:none}
  /* 窄屏只留百分比（提示文案太占位，且手机上没有滚轮）。 */
  .glb-zoom__hint{display:none}
}

@media (prefers-reduced-motion:reduce){
  .tg-card,.tg-skel,.tg-empty,.tg-stale,.tg-session-bar{animation:none!important}
  .tg-card,.tg-card:hover,.tg-icon-btn,.tg-card__img,.tg-card__icon,.tg-card__kind-dot,.tg-card__peek,.tg-card__del{transition:none!important}
  /* 减弱动效下预览眼直接常显（否则要 hover 才有反应）。
     单卡删除钮**刻意不跟进**：一屏一百多张卡片各挂一枚常显的垃圾桶是纯噪声，
     而它的键盘路径已经由卡片上的 Delete 键承担，不依赖这枚按钮可见。 */
  .tg-card__peek{opacity:1!important;transform:none!important}
  .tg-skel__thumb::after,.tg-skel__line::after{animation:none!important}
  .tg-empty__icon,.tg-stale__dot,.tg-icon-btn[data-spinning="true"] svg{animation:none!important}
  .glb,.glb-panel,.glb-head,.glb-body,.glb-media,.glb-note,.glb-paged__bar,.glb-zoom{animation:none!important}
  .glb-btn,.glb-nav,.glb-paged__step,.glb-paged__img,.glb-zoom__hint,.glb-zoom__reset{transition:none!important}
  .tg-day,.tg-day::before,.tg-day__head,.tg-day__dot,.tg-time-pop,.tg-search__time-tag,.tg-time-bar{animation:none!important}
  .tg-day__chevron,.tg-day__dot,.tg-day__head{transition:none!important}
  /* 时间轴格子的名称浮层（2026-10-25）：只关过渡，**不动 opacity / display** ——
     hover 该浮现还是浮现，只是没有过渡帧。 */
  .tg-tile__meta{transition:none!important}
  .tg-time-pop__preset,.tg-time-pop__apply,.tg-view__btn{transition:none!important}
  .tg-time-bar__icon{animation:none!important}
  /* 单卡删除（2026-10-24）的退场动画：只关动画与位移，**不动布局与可见性规则**
     —— 卡片该退场还是退场、错误行该出现还是出现，只是不再有过渡帧。注意这里
     刻意**不写** visibility / display：写了就等于让"看不看得见"取决于这段媒体
     查询是否命中。
     （2026-10-25：分类批量删除的确认态/busy 脉冲随胶囊栏一起删除，这里原本
     点名它们的几行一并去掉。） */
  .tg-card--out,.tg-del-error{animation:none!important}
  .tg-del-error__close{transition:opacity 120ms linear,background 120ms linear,color 120ms linear}
  /* 刻意**不**在减弱动效下把退场卡片设成 opacity:0：动画关掉后它仍要等请求
     回来才从数据里摘掉，这期间让它保持原样（kr-chat 一键删记忆同款口径），
     否则会先"闪没"再等几百毫秒才真正消失。 */
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
