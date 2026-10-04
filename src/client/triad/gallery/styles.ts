/**
 * dsh-chat-plus — 多媒体画廊样式（注入式，DSH 原生 token，暗/亮主题自适应）。
 *
 * 视觉骨架沿用工作台既有语言（与记忆 / 邮箱面板同一套 token 与圆角节奏），
 * 动效按「渐进式微调」原则加：卡片入场级联上浮、hover 提亮浮起、骨架屏微光
 * 扫动、Lightbox 缩放入场、类别徽标下滑浮现。全部动画尊重
 * prefers-reduced-motion（只关动画，不动布局）。
 *
 * ⚠ 注入式 CSS 的正文与注释里都不能出现反引号（模板字面量会提前闭合，
 * 整张表静默变 false —— build.mjs 的 assertInjectedCssStrings 会拦，别去撞它）。
 */

const STYLE_ID = 'dsh-triad-gallery-styles'

const SHEET = `
.tg-root{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;position:relative}

/* ── 工具条：筛选 + 搜索 + 刷新 ─────────────────────────────────── */
.tg-toolbar{flex:none;display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.02));flex-wrap:wrap}
.tg-kinds{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.tg-kind{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:color 140ms ease,background 140ms ease,border-color 140ms ease,transform 120ms cubic-bezier(.2,.8,.2,1);user-select:none;white-space:nowrap}
.tg-kind:hover{color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));transform:translateY(-1px)}
.tg-kind:active{transform:translateY(0) scale(.97)}
.tg-kind[data-active="true"]{color:#fff;background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent;box-shadow:0 1px 6px rgba(59,130,246,.35)}
.tg-kind__count{font-size:10.5px;opacity:.75;font-variant-numeric:tabular-nums}
.tg-search{position:relative;flex:1;min-width:120px;max-width:340px;margin-left:auto}
.tg-search__icon{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary,#777);pointer-events:none;display:flex}
.tg-search__input{width:100%;box-sizing:border-box;height:28px;padding:0 10px 0 28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary,#eee);font-size:12px;font-family:inherit;outline:none;transition:border-color 140ms ease,box-shadow 140ms ease}
.tg-search__input:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 2px rgba(59,130,246,.18)}
.tg-search__input::placeholder{color:var(--dsw-alias-label-tertiary,#777)}
.tg-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;transition:color 140ms ease,background 140ms ease}
.tg-icon-btn:hover{color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06))}
.tg-icon-btn[data-spinning="true"] svg{animation:tg-spin 800ms linear infinite}
@keyframes tg-spin{to{transform:rotate(360deg)}}
.tg-count{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#7c828c);font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── 会话筛选行（选了某个会话时出现）───────────────────────────── */
.tg-session-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.05));animation:tg-fade-in 180ms ease}
.tg-session-bar__name{color:var(--dsw-alias-label-primary,#eee);font-weight:500;max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-session-clear{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:11px;border:none;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));color:var(--dsw-alias-label-secondary,#bbb);font-size:11.5px;font-family:inherit;cursor:pointer;transition:background 140ms ease,color 140ms ease}
.tg-session-clear:hover{background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#eee)}

/* ── 主体：滚动区 + 网格 ───────────────────────────────────────── */
.tg-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px 18px 28px;scrollbar-width:thin}
.tg-scroll::-webkit-scrollbar{width:8px}
.tg-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:4px}
.tg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
@media (max-width:640px){.tg-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}}

/* ── 卡片 ──────────────────────────────────────────────────────── */
.tg-card{position:relative;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));cursor:pointer;overflow:hidden;padding:0;text-align:left;font-family:inherit;color:inherit;transition:transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms ease,border-color 180ms ease;animation:tg-card-in 320ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-i,0) * 22ms)}
.tg-card:hover{transform:translateY(-3px);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.18));box-shadow:0 8px 24px rgba(0,0,0,.28)}
.tg-card:active{transform:translateY(-1px) scale(.985)}
.tg-card:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px}
@keyframes tg-card-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.tg-card__thumb{position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));display:flex;align-items:center;justify-content:center}
.tg-card__img{width:100%;height:100%;object-fit:cover;transition:transform 320ms cubic-bezier(.2,.8,.2,1),opacity 240ms ease;opacity:0}
.tg-card__img[data-loaded="true"]{opacity:1}
.tg-card:hover .tg-card__img{transform:scale(1.045)}
.tg-card__icon{color:var(--dsw-alias-label-tertiary,#8a8f98);transition:transform 220ms cubic-bezier(.2,.8,.2,1),color 220ms ease}
.tg-card:hover .tg-card__icon{transform:scale(1.08);color:var(--dsw-alias-label-secondary,#aab)}
.tg-card__kind-dot{position:absolute;top:8px;left:8px;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:9px;font-size:10px;font-weight:600;letter-spacing:.02em;color:#fff;background:rgba(15,17,23,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14);opacity:0;transform:translateY(-3px);transition:opacity 180ms ease,transform 180ms ease;pointer-events:none}
.tg-card:hover .tg-card__kind-dot{opacity:1;transform:translateY(0)}
.tg-card__meta{display:flex;flex-direction:column;gap:2px;padding:8px 10px 10px;min-width:0}
.tg-card__name{font-size:12px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__sub{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#7c828c);display:flex;align-items:center;gap:6px;min-width:0}
.tg-card__sub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.tg-card__play svg{filter:drop-shadow(0 2px 8px rgba(0,0,0,.5));opacity:.92;transition:transform 200ms cubic-bezier(.2,.8,.2,1)}
.tg-card:hover .tg-card__play svg{transform:scale(1.12)}

/* ── 骨架屏（加载态）────────────────────────────────────────────── */
.tg-skel{border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));overflow:hidden;animation:tg-card-in 260ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-i,0) * 30ms)}
.tg-skel__thumb{width:100%;aspect-ratio:4/3;position:relative;overflow:hidden;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05))}
.tg-skel__thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.07) 45%,rgba(255,255,255,.11) 55%,transparent 80%);transform:translateX(-100%);animation:tg-shimmer 1.4s ease-in-out infinite}
@keyframes tg-shimmer{to{transform:translateX(100%)}}
.tg-skel__line{height:10px;margin:10px;border-radius:5px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.06));position:relative;overflow:hidden}
.tg-skel__line::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.06) 50%,transparent 80%);transform:translateX(-100%);animation:tg-shimmer 1.4s ease-in-out infinite}
.tg-skel__line--short{width:55%}

/* ── 空态 / 错误态 ─────────────────────────────────────────────── */
.tg-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 24px;color:var(--dsw-alias-label-tertiary,#7c828c);animation:tg-fade-in 240ms ease}
.tg-empty__icon{opacity:.5;animation:tg-float 3.2s ease-in-out infinite}
@keyframes tg-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.tg-empty__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-secondary,#9ca3af)}
.tg-empty__hint{font-size:12px;text-align:center;max-width:42ch;line-height:1.7}
@keyframes tg-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

/* ── stale 提示条 ───────────────────────────────────────────────── */
.tg-stale{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#aab);background:rgba(59,130,246,.08);border-bottom:1px solid rgba(59,130,246,.16);animation:tg-fade-in 200ms ease}
.tg-stale__dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#3b82f6);animation:tg-pulse 1.4s ease-in-out infinite;flex:none}
@keyframes tg-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}

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
.tg-lb__loading{color:#c7ccd4;font-size:12.5px;display:flex;align-items:center;gap:8px}
.tg-lb__loading svg{animation:tg-spin 900ms linear infinite}

@media (prefers-reduced-motion:reduce){
  .tg-card,.tg-skel,.tg-empty,.tg-stale,.tg-lb,.tg-lb__stage,.tg-lb__img,.tg-lb__meta,.tg-lb__hint,.tg-session-bar{animation:none!important}
  .tg-card,.tg-card:hover,.tg-icon-btn,.tg-lb__close,.tg-lb__fullbtn,.tg-lb__btn,.tg-lb__nav,.tg-kind,.tg-card__img,.tg-card__icon,.tg-card__kind-dot{transition:none!important}
  .tg-lb[data-full="true"] .tg-lb__stage{animation:none!important}
  .tg-skel__thumb::after,.tg-skel__line::after{animation:none!important}
  .tg-empty__icon,.tg-stale__dot,.tg-icon-btn[data-spinning="true"] svg,.tg-lb__loading svg{animation:none!important}
}
`

/** 注入画廊样式（幂等）。 */
export function ensureGalleryStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
