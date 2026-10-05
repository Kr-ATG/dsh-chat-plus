/**
 * dsh-provider-effort — 样式（运行时幂等注入 <style>）。
 *
 * 三个入口：
 *  - `.peff-provider-badge-*`：供应商标签（官方品牌图标 + 品牌蓝渐染 chip）。
 *  - `.peff-ms-*`：纯模型选择器（接管 `conversation.input.model` 座位）。
 *  - `.peff-eff-*`：推理等级滑动式弹出（含渐变轨道 + 粒子 canvas）。
 *
 * 视觉语言（紧凑、透明底、不发光）：composer 里三枚入口均为透明无框样式，
 * hover / 打开只提亮文字；品牌蓝淡染只出现在弹出层内部的选中态与文字色上。
 * 弹出层使用静态实色面板，并保留统一 rise/sink 动效与标准层级投影。单一强调色
 * `--peff-accent` 走 DSH 品牌令牌，深浅主题自动适配；全部动效在
 * prefers-reduced-motion 下降级。
 *
 * 全部类名带 `peff-` 前缀，与 dsh-webui 的 `webui-*`（可重装共存）隔离。
 */

export const css = {
  // 供应商标签
  providerBadge: 'peff-provider-badge',
  providerBadgeIcon: 'peff-provider-badge-icon',
  // 模型座位
  msRoot: 'peff-ms-root',
  msTrigger: 'peff-ms-trigger',
  msTriggerOpen: 'peff-ms-trigger-open',
  msTriggerLabel: 'peff-ms-trigger-label',
  msChevron: 'peff-ms-chevron',
  msChevronOpen: 'peff-ms-chevron-open',
  msMenu: 'peff-ms-menu',
  msMenuOut: 'peff-ms-menu-out',
  msHead: 'peff-ms-head',
  msHeadTitle: 'peff-ms-head-title',
  msHeadRight: 'peff-ms-head-right',
  msCount: 'peff-ms-count',
  msRefresh: 'peff-ms-refresh',
  msRefreshSpin: 'peff-ms-refresh-spin',
  msStatus: 'peff-ms-status',
  msEmpty: 'peff-ms-empty',
  msError: 'peff-ms-error',
  msWarning: 'peff-ms-warning',
  msRetry: 'peff-ms-retry',
  msGroups: 'peff-ms-groups',
  msGroup: 'peff-ms-group',
  msGroupTitle: 'peff-ms-group-title',
  msBody: 'peff-ms-body',
  msProviders: 'peff-ms-providers',
  msProvider: 'peff-ms-provider',
  msProviderActive: 'peff-ms-provider-active',
  msProviderIcon: 'peff-ms-provider-icon',
  msModels: 'peff-ms-models',
  msOption: 'peff-ms-option',
  msSelected: 'peff-ms-selected',
  msOptionCopy: 'peff-ms-option-copy',
  msOptionTop: 'peff-ms-option-top',
  msModelName: 'peff-ms-model-name',
  msDescription: 'peff-ms-description',
  msCheck: 'peff-ms-check',
  // 推理等级座位
  effRoot: 'peff-eff-root',
  effTrigger: 'peff-eff-trigger',
  effLabel: 'peff-eff-label',
  effPanel: 'peff-eff-panel',
  effPanelOut: 'peff-eff-panel-out',
  effPanelHead: 'peff-eff-panel-head',
  effPanelTitle: 'peff-eff-panel-title',
  effPanelValue: 'peff-eff-panel-value',
  effSlider: 'peff-eff-slider',
  effSliderDrag: 'peff-eff-slider-drag',
  effTrack: 'peff-eff-track',
  effFill: 'peff-eff-fill',
  effTicks: 'peff-eff-ticks',
  effTick: 'peff-eff-tick',
  effTickOn: 'peff-eff-tick-on',
  effTickAt: 'peff-eff-tick-at',
  effThumb: 'peff-eff-thumb',
  effThumbCore: 'peff-eff-thumb-core',
  effThumbRing: 'peff-eff-thumb-ring',
  effThumbGlow: 'peff-eff-thumb-glow',
  effCanvas: 'peff-eff-canvas',
  effLabels: 'peff-eff-labels',
  effLabelsItem: 'peff-eff-labels-item',
  effLabelsItemOn: 'peff-eff-labels-item-on',
  effEmpty: 'peff-eff-empty',
  effBusy: 'peff-eff-busy',
} as const

const STYLE_ID = 'dsh-provider-effort-styles'

const SHEET = `
/* 单一强调色：品牌蓝（DSH 主题令牌，深浅主题自适应；缺失时回退官方 #4D6BFE）。 */
/* 弹层刻意使用 static 令牌：即使外观层把 alias 表面改成半透明，面板仍保持实色。 */
:root{
  --peff-accent:var(--dsw-alias-brand-primary,#4d6bfe);
  --peff-menu-surface:var(--dsw-static-neutral-bluish-00,#fff)
}
body[data-ds-dark-theme]{
  --peff-menu-surface:var(--dsw-static-neutral-bluish-850,#212123)
}

/* ---- 供应商标签（品牌图标 + 名，无框） ---- */
.peff-provider-badge{display:inline-flex;align-items:center;gap:5px;padding:0 2px;color:color-mix(in srgb,var(--peff-accent) 60%,var(--dsw-alias-label-secondary,#bbb));font-size:12px;font-weight:500;line-height:1;white-space:nowrap;transition:color 160ms ease}
.peff-provider-badge:hover{color:var(--dsw-alias-label-primary,#eee)}
.peff-provider-badge-icon{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;font-size:15px;flex:0 0 auto}

/* ---- 纯模型选择器（接管 model 座位，不含推理等级） ---- */
.peff-ms-root{position:relative;min-width:0}
/* 触发按钮：透明无框；只提亮文字，不显示底色或可见边框。 */
.peff-ms-trigger{box-sizing:border-box;display:flex;align-items:center;gap:5px;min-width:0;max-width:220px;height:28px;padding:0 8px;border:1px solid transparent;border-radius:14px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer;transition:color 160ms ease}
.peff-ms-trigger:hover:not(:disabled){background:transparent;border-color:transparent;color:var(--dsw-alias-label-primary)}
.peff-ms-trigger:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--peff-accent) 40%,transparent)}
.peff-ms-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.peff-ms-trigger-open{background:transparent;border-color:transparent;color:var(--dsw-alias-label-primary)}
.peff-ms-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.peff-ms-chevron{flex:0 0 auto;color:var(--dsw-alias-label-caption);transition:transform 140ms cubic-bezier(.2,.9,.25,1),color 140ms ease}
.peff-ms-trigger:hover .peff-ms-chevron{color:var(--dsw-alias-label-secondary)}
.peff-ms-chevron-open{transform:rotate(180deg);color:var(--peff-accent)}
/* 弹出层：rise/sink 动效 + 标准层级投影；::before 桥接 hover 间隙。 */
.peff-ms-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(440px,calc(100vw - 32px));max-height:min(440px,calc(100vh - 96px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-l2,#2a2d35);border-radius:14px;background:var(--peff-menu-surface);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);animation:peff-ms-rise 170ms cubic-bezier(.2,.9,.25,1);transform-origin:100% 100%;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.peff-ms-menu::before{content:'';position:absolute;left:0;right:0;bottom:-8px;height:8px}
.peff-ms-menu-out{animation:peff-ms-sink 130ms cubic-bezier(.2,.9,.25,1) both}
@keyframes peff-ms-rise{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes peff-ms-sink{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(.97)}}
.peff-ms-status,.peff-ms-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.peff-ms-error,.peff-ms-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.peff-ms-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.peff-ms-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.peff-ms-groups{min-height:0;overflow-y:auto}
/* 头部行：当前供应商（图标+名）| 模型数 + 刷新 */
.peff-ms-head{display:flex;align-items:center;gap:8px;padding:6px 9px 7px;margin-bottom:2px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l3,#2a2d35) 70%,transparent)}
.peff-ms-head-title{display:inline-flex;align-items:center;gap:7px;min-width:0;font-size:12.5px;font-weight:600;letter-spacing:.01em;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.peff-ms-head-right{display:inline-flex;align-items:center;gap:8px;margin-left:auto;flex:0 0 auto}
.peff-ms-count{font-size:11px;line-height:16px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);padding:0 2px}
.peff-ms-refresh{display:grid;place-items:center;width:22px;height:22px;padding:0;border:none;border-radius:7px;outline:none;background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer;transition:color 140ms ease,background-color 140ms ease,transform 140ms ease}
.peff-ms-refresh:hover{color:var(--peff-accent);background:var(--dsw-alias-interactive-bg-hover)}
.peff-ms-refresh:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--peff-accent) 35%,transparent)}
.peff-ms-refresh:active{transform:scale(.92)}
.peff-ms-refresh-spin{animation:peff-ms-spin 800ms linear infinite;color:var(--peff-accent)}
@keyframes peff-ms-spin{to{transform:rotate(360deg)}}
/* 两栏：左供应商图标栏 / 右模型列表 */
.peff-ms-body{flex:1;min-height:0;display:flex;overflow:hidden}
.peff-ms-providers{flex:0 0 148px;min-height:0;overflow-y:auto;padding:4px;border-right:1px solid color-mix(in srgb,var(--dsw-alias-border-l3,#2a2d35) 70%,transparent)}
.peff-ms-provider{position:relative;display:flex;align-items:center;gap:7px;width:100%;padding:7px 9px;border:none;border-radius:9px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:13px;line-height:18px;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:background-color 140ms ease,color 140ms ease}
.peff-ms-provider:hover,.peff-ms-provider:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 选中项：仅左侧实心强调条 + 文字加重（无底色填充）。 */
.peff-ms-provider-active{color:var(--dsw-alias-label-primary,#eee);font-weight:600}
.peff-ms-provider-active::before{content:'';position:absolute;left:1px;top:50%;transform:translateY(-50%);width:2.5px;height:14px;border-radius:2px;background:var(--peff-accent)}
.peff-ms-provider-icon{display:inline-flex;align-items:center;flex:0 0 15px;width:15px;height:15px;font-size:15px}
.peff-ms-models{flex:1;min-width:0;min-height:0;overflow-y:auto;padding:4px}
.peff-ms-option{position:relative;display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:7px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer;transition:background-color 140ms ease,transform 140ms cubic-bezier(.2,.9,.25,1)}
.peff-ms-option:hover:not(:disabled),.peff-ms-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.peff-ms-option:not(:disabled):hover{transform:translateX(2px)}
.peff-ms-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.peff-ms-option-copy{display:flex;flex:1;flex-direction:column;min-width:0}
.peff-ms-option-top{display:flex;align-items:center;gap:6px;min-width:0}
.peff-ms-model-name{min-width:0;overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
/* 支持推理档位的模型不再在行内挂徽标（推理等级由 EffortSeat 单独表达）。 */
.peff-ms-description{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.peff-ms-check{display:grid;place-items:center;flex:0 0 18px;height:18px;border-radius:50%;color:var(--dsw-alias-label-primary)}
/* 选中行：仅主色名 + 实心勾（无底色填充；hover 落回通用 neutral 染面）。 */
.peff-ms-selected .peff-ms-model-name{color:color-mix(in srgb,var(--peff-accent) 70%,var(--dsw-alias-label-primary,#eee));font-weight:600}
.peff-ms-selected .peff-ms-check{background:var(--peff-accent);color:var(--dsw-alias-label-primary-foreground,#fff)}

/* ---- 推理等级滑动式弹出 ----
 * 视觉：实色圆角轨道 + 左浅右深的蓝色渐变填充 + 竖条点阵粒子 + 白色大圆滑块
 * （对齐用户提供的参考图）。点阵铺满已填充区，能量波从左向右扫过并被滑块吸收；
 * 档位靠刻度点 + 档位名标识，滑块是一颗带呼吸光环的白色圆钮。
 * 色相随档位在品牌蓝 → 靛紫间漂移，切换瞬间在滑块处散开一圈方形火星。
 * 动效在 prefers-reduced-motion 下降级（点阵静态、过渡取消）。
 *
 * ⚠️ corner-shape：DSH 主题全局设了 --dsw-corner-shape: superellipse(1.5)，
 * 会把 border-radius:50% 渲染成「超椭圆方块」而不是正圆。本插件所有需要真圆的
 * 元素（滑块三件套、圆角轨道）都显式声明 corner-shape:round 覆盖回来。 */
.peff-eff-root{position:relative;min-width:0}
.peff-eff-trigger{box-sizing:border-box;display:inline-flex;align-items:center;height:28px;padding:0 8px;border:1px solid transparent;border-radius:14px;background:transparent;color:var(--dsw-alias-label-caption,#9aa0a8);font-size:12px;font-weight:500;line-height:20px;white-space:nowrap;cursor:pointer;transition:color 140ms ease}
.peff-eff-trigger:hover:not(:disabled){color:var(--dsw-alias-label-primary,#ddd);background:transparent;border-color:transparent}
.peff-eff-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--peff-accent) 35%,transparent)}
.peff-eff-trigger[aria-expanded="true"]{color:var(--dsw-alias-label-primary,#ddd);background:transparent;border-color:transparent}
.peff-eff-trigger:disabled{opacity:.5;cursor:default}
.peff-eff-label{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.peff-eff-panel{position:absolute;right:0;bottom:calc(100% + 10px);z-index:20;width:min(340px,calc(100vw - 32px));padding:12px 14px 10px;border:1px solid var(--dsw-alias-border-l2,#2a2d35);border-radius:14px;background:var(--peff-menu-surface);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);animation:peff-eff-rise 160ms cubic-bezier(.2,.9,.25,1);transform-origin:100% 100%}
/* 玻璃外观只能影响背景墙，不能把这些插件卡片再打成透明。 */
html[data-dsh-glass] .peff-ms-menu,html[data-dsh-glass] .peff-eff-panel{background:var(--peff-menu-surface);backdrop-filter:none;-webkit-backdrop-filter:none}
.peff-eff-panel-out{animation:peff-eff-sink 130ms cubic-bezier(.2,.9,.25,1) both}
/* 透明桥接：覆盖面板与按钮之间的间隙，鼠标从按钮移入面板时不中断 hover。 */
.peff-eff-panel::before{content:'';position:absolute;left:0;right:0;bottom:-10px;height:10px}
@keyframes peff-eff-rise{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes peff-eff-sink{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(.97)}}
.peff-eff-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:2px}
.peff-eff-panel-title{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#bbb)}
.peff-eff-panel-value{font-size:12px;font-weight:600;color:var(--eff-accent,var(--dsw-alias-state-business-primary));animation:peff-eff-value-in 200ms cubic-bezier(.2,.9,.25,1)}
@keyframes peff-eff-value-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}

/* 滑杆：实色圆角轨道 + 渐变填充 + 点阵画布 + 白色大圆滑块（对齐参考图）。 */
.peff-eff-slider{position:relative;height:46px;display:flex;align-items:center;cursor:pointer;touch-action:none;user-select:none;border-radius:23px;corner-shape:round;background:transparent;transition:transform 180ms cubic-bezier(.2,.9,.25,1)}
.peff-eff-slider:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--eff-accent,#679efe) 35%,transparent)}
.peff-eff-slider-drag{transform:scale(1.012)}
/* 轨道底：浅色=淡蓝面；深色=深灰蓝面。overflow 裁掉渐变与点阵的方角。 */
.peff-eff-track{position:absolute;inset:0;border-radius:23px;corner-shape:round;overflow:hidden;background:linear-gradient(90deg,#d6e5fa,#dceafd)}
body[data-ds-dark-theme] .peff-eff-track{background:linear-gradient(90deg,#232833,#282e3a)}
/* 已填充区：左浅右深的蓝色渐变（对齐参考图的冷白 → 品牌蓝）。方角由
 * .peff-eff-track 的 overflow 裁成圆角，这里不再自带圆角，窄档位下才不会变形。 */
.peff-eff-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#fbfdff 0%,#cfe3f9 18%,#9cc4f3 46%,#71a9ef 74%,#5b9be6 100%);transition:width 300ms cubic-bezier(.22,1.2,.36,1)}
body[data-ds-dark-theme] .peff-eff-fill{background:linear-gradient(90deg,#2b3644 0%,#33507e 26%,#3f6bc0 60%,#4d6bfe 100%)}
.peff-eff-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}

/* 刻度点：极细小的方点标记档位，已越过的点跟随主色亮起。 */
.peff-eff-ticks{position:absolute;left:20px;right:20px;top:50%;height:0;pointer-events:none}
.peff-eff-tick{position:absolute;top:0;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:1px;corner-shape:round;background:color-mix(in srgb,var(--eff-accent,#679efe) 30%,#fff);transition:background-color 220ms ease,transform 220ms cubic-bezier(.22,1.2,.36,1),opacity 220ms ease;opacity:.6}
body[data-ds-dark-theme] .peff-eff-tick{background:color-mix(in srgb,var(--eff-accent,#679efe) 40%,#4a5160)}
.peff-eff-tick-on{background:var(--eff-accent,#679efe);opacity:1;box-shadow:0 0 6px color-mix(in srgb,var(--eff-accent,#679efe) 50%,transparent)}
.peff-eff-tick-at{opacity:0}

/* 滑块 = 一颗白色大圆钮：白色实心 + 主色柔晕 + 呼吸光环（--eff-pulse 由 JS 给周期）。
 * 滑块半径 = 轨道左右内边距，中心压在填充起止点上；白圆盖住轨道端部圆角，
 * 两端档位下也不会「漏」出半截圆角。 */
.peff-eff-thumb{position:absolute;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;corner-shape:round;pointer-events:none;transition:left 300ms cubic-bezier(.22,1.2,.36,1),transform 180ms cubic-bezier(.22,1.2,.36,1)}
.peff-eff-slider-drag .peff-eff-thumb{transform:scale(1.08)}
.peff-eff-thumb-core{position:absolute;inset:0;border-radius:50%;corner-shape:round;background:#fff;box-shadow:0 0 0 1px rgba(120,160,220,.22),0 2px 6px rgba(70,110,170,.22)}
body[data-ds-dark-theme] .peff-eff-thumb-core{box-shadow:0 0 0 1px rgba(130,160,220,.3),0 2px 8px rgba(0,0,0,.45)}
/* 呼吸光环：从白圆边缘向外扩一圈后消散（1.0 → 1.32），幅度收在轨道高度内。 */
.peff-eff-thumb-ring{position:absolute;inset:0;border-radius:50%;corner-shape:round;border:1.5px solid color-mix(in srgb,var(--eff-accent,#679efe) 55%,transparent);animation:peff-eff-pulse var(--eff-pulse,1.6s) ease-out infinite}
@keyframes peff-eff-pulse{0%{transform:scale(1);opacity:.5}70%{transform:scale(1.32);opacity:0}100%{transform:scale(1.32);opacity:0}}
.peff-eff-thumb-glow{position:absolute;inset:-6px;border-radius:50%;corner-shape:round;background:radial-gradient(circle,color-mix(in srgb,var(--eff-accent,#679efe) 38%,transparent),transparent 72%)}

.peff-eff-labels{display:flex;justify-content:space-between;gap:4px;margin-top:0}
.peff-eff-labels-item{flex:1;min-width:0;text-align:center;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color 200ms ease,transform 200ms cubic-bezier(.22,1.2,.36,1);cursor:pointer}
.peff-eff-labels-item:hover{color:var(--dsw-alias-label-secondary,#bbb)}
.peff-eff-labels-item-on{color:var(--dsw-alias-label-primary,#eee);font-weight:600;transform:scale(1.04)}
.peff-eff-empty{margin-top:4px;padding:6px 2px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:center;animation:peff-eff-value-in 220ms cubic-bezier(.2,.9,.25,1)}
.peff-eff-busy{opacity:.55;pointer-events:none}

@media (prefers-reduced-motion: reduce){
  .peff-ms-menu,.peff-ms-menu-out,.peff-ms-refresh-spin{animation:none}
  .peff-ms-trigger,.peff-ms-option,.peff-ms-provider,.peff-ms-chevron,.peff-ms-refresh,.peff-provider-badge{transition:none}
  .peff-ms-option:hover:not(:disabled){transform:none}
  .peff-eff-panel,.peff-eff-panel-out,.peff-eff-panel-value,.peff-eff-empty{animation:none}
  .peff-eff-thumb-ring{animation:none}
  .peff-eff-thumb,.peff-eff-tick,.peff-eff-labels-item,.peff-eff-slider{transition:none}
}
`

let injected = false

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-provider-effort'
  tag.dataset.pluginCss = 'provider-effort/model-selection'
  tag.textContent = SHEET
  document.head.appendChild(tag)
  injected = true
}

/**
 * 档位色相：品牌蓝 → 靛紫（deepseek 品牌色家族内的窄带，等级差异可辨，
 * 又不会跳出 DSH 主题；柔光雾沿轨道从 212° 渐变到当前档位色）。
 * @param i - 档位序号。
 * @param n - 档位总数。
 */
export function effortHue(i: number, n: number): number {
  if (n <= 1) return 212
  const t = Math.min(1, Math.max(0, i / (n - 1)))
  return Math.round(212 + t * 54) // 212(品牌蓝) → 266(靛紫)
}

/** 色相 → 强调色（滑块 / 填充带 / 光点共用）。 */
export function hueColor(hue: number): string {
  return `hsl(${hue} 88% 60%)`
}
