/**
 * dsh-chat-plus — 对话截图面板样式（自 dsh-webui 移植；class 前缀 tsh-）（client 端，运行时注入 <style>）。
 *
 * 规格对齐官方 ModelsSection：输入框/下拉 32px、行内小按钮胶囊 28px、
 * 主按钮胶囊 36px、行卡片圆角 12px、填充面用 bg-module-platform。
 * 颜色一律走 --dsw-* 令牌（强调色用 state-business-primary，绝不用
 * brand-primary——它在浅色下是黑、深色下是白）。对话流截图入口保持透明无框；
 * 面板与预览台使用 static 表面令牌，确保玻璃模式下仍是不透明实色。
 */

const STYLE_ID = 'dsh-chat-flow-shot-styles'

/** 类名表（前缀 tsh- = webui screenshot）。 */
export const cls = {
  btn: 'tsh-btn',
  btnBusy: 'tsh-btn-busy',
  mask: 'tsh-mask',
  panel: 'tsh-panel',
  head: 'tsh-head',
  title: 'tsh-title',
  close: 'tsh-close',
  bar: 'tsh-bar',
  group: 'tsh-group',
  label: 'tsh-label',
  seg: 'tsh-seg',
  segItem: 'tsh-seg-item',
  segItemOn: 'tsh-seg-item-on',
  widthBox: 'tsh-width-box',
  widthInput: 'tsh-width-input',
  unit: 'tsh-unit',
  select: 'tsh-select',
  input: 'tsh-input',
  stage: 'tsh-stage',
  canvas: 'tsh-canvas',
  img: 'tsh-img',
  spinner: 'tsh-spinner',
  hint: 'tsh-hint',
  error: 'tsh-error',
  editBar: 'tsh-edit-bar',
  editHint: 'tsh-edit-hint',
  editCount: 'tsh-edit-count',
  editSpacer: 'tsh-edit-spacer',
  frame: 'tsh-frame',
  foot: 'tsh-foot',
  meta: 'tsh-meta',
  actions: 'tsh-actions',
  action: 'tsh-action',
  primary: 'tsh-primary',
  toast: 'tsh-toast',
} as const

const SHEET = `
:root{--tsh-control-surface:var(--dsw-static-neutral-bluish-50,#f9fafb);--tsh-panel-surface:var(--dsw-static-neutral-bluish-00,#fff);--tsh-stage-surface:var(--dsw-static-neutral-bluish-100,#ebeef2)}
body[data-ds-dark-theme]{--tsh-control-surface:var(--dsw-static-neutral-bluish-850,#212123);--tsh-panel-surface:var(--dsw-static-neutral-bluish-850,#212123);--tsh-stage-surface:var(--dsw-static-neutral-bluish-900,#0f1115)}
/* ── 对话流截图入口：透明无框，悬停仅提亮图标 ── */
.tsh-btn{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:color .12s,background .12s}
.tsh-btn:hover{background:transparent;color:var(--dsw-alias-label-primary,#eee)}
.tsh-btn-busy{color:var(--dsw-alias-state-business-primary,#4176e6);cursor:default;pointer-events:none}

/* ── 遮罩 + 面板 ── */
.tsh-mask{position:fixed;inset:0;z-index:1399;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.tsh-panel{position:fixed;z-index:1400;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;box-sizing:border-box;width:min(calc(100vw - 48px),2160px);height:min(calc(100vh - 40px),1720px);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--tsh-panel-surface);box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
html[data-dsh-glass] .tsh-panel{background:var(--tsh-panel-surface);backdrop-filter:none;-webkit-backdrop-filter:none}
/* 居中面板的开合动画自带 translate(-50%,-50%)，不能复用通用滑入类（会覆盖定位）。 */
.tsh-panel[data-anim='in']{animation:tsh-panel-in 240ms cubic-bezier(.2,.8,.2,1)}
.tsh-panel[data-anim='out']{animation:tsh-panel-out 240ms cubic-bezier(.4,0,.2,1) both}
@keyframes tsh-panel-in{from{opacity:0;transform:translate(-50%,calc(-50% + 18px))}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes tsh-panel-out{from{opacity:1;transform:translate(-50%,-50%)}to{opacity:0;transform:translate(-50%,calc(-50% + 18px))}}

/* ── 头部 ── */
.tsh-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.tsh-title{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.tsh-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer}
.tsh-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}

/* ── 选项条 ── */
.tsh-bar{flex:none;display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.tsh-group{display:flex;align-items:center;gap:8px;min-width:0}
.tsh-label{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}
/* 分段选择：整体一枚 32px 高的胶囊，选中项走品牌蓝底 */
.tsh-seg{display:inline-flex;align-items:center;height:32px;padding:2px;gap:2px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;background:var(--tsh-control-surface)}
.tsh-seg-item{display:inline-flex;align-items:center;height:26px;padding:0 12px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:13px;line-height:1;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s}
.tsh-seg-item:hover{color:var(--dsw-alias-label-primary,#eee)}
.tsh-seg-item-on{background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}
.tsh-seg-item-on:hover{color:#fff}
/* 自定义宽度输入框：高度 32px，内嵌 px 单位 */
.tsh-width-box{display:inline-flex;align-items:center;height:32px;padding:0 8px 0 10px;gap:4px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;background:var(--tsh-control-surface);transition:border-color .12s}
.tsh-width-box:focus-within{border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.tsh-width-input{width:46px;height:24px;border:none;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-weight:500;text-align:right;padding:0;outline:none;-moz-appearance:textfield}
.tsh-width-input::-webkit-outer-spin-button,.tsh-width-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.tsh-unit{font-size:12px;color:var(--dsw-alias-label-tertiary,#888);user-select:none}
/* 文本输入（标题/徽章可编辑）：官方输入框规格 32px / 圆角 8 */
.tsh-input{height:32px;padding:0 10px;font-size:14px;line-height:22px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#333);background-color:var(--tsh-control-surface);color:var(--dsw-alias-label-primary,#eee);min-width:0}
.tsh-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.tsh-input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.tsh-group .tsh-input{width:190px}
.tsh-select{height:32px;padding:0 32px 0 10px;font-size:14px;line-height:22px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#333);background-color:var(--tsh-control-surface);color:var(--dsw-alias-label-primary,#eee);max-width:200px;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%2381858C' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;cursor:pointer}

/* ── 预览台 ── */
.tsh-stage{flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:18px;background:var(--tsh-stage-surface);scrollbar-width:thin}
.tsh-stage::-webkit-scrollbar{width:8px;height:8px}
.tsh-stage::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#333);border-radius:4px}
.tsh-canvas{display:flex;align-items:center;justify-content:center;min-height:100%;width:100%}
.tsh-img{max-width:100%;height:auto;display:block;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.28);margin:auto}
.tsh-spinner{width:26px;height:26px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,#333);border-top-color:var(--dsw-alias-state-business-primary,#4176e6);animation:tsh-spin .8s linear infinite}
@keyframes tsh-spin{to{transform:rotate(360deg)}}
.tsh-hint{display:flex;flex-direction:column;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-tertiary,#888)}
.tsh-error{max-width:520px;font-size:13px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#e5484d);text-align:center;word-break:break-word}

/* ── 元素删除编辑模式 ── */
/* 编辑中：选项条整体减淡并禁止交互（改了选项会脱离编辑，需要先退出重渲染）。 */
.tsh-panel[data-editing] .tsh-bar{opacity:.55;pointer-events:none}
/* 编辑工具条：位于选项条下方、预览台上方，滑入动画。 */
.tsh-edit-bar{flex:none;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:12px;padding:9px 16px;background:var(--tsh-panel-surface);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));animation:tsh-editbar-in 180ms ease}
@keyframes tsh-editbar-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.tsh-edit-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#bbb);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tsh-edit-count{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.tsh-edit-count[data-n]{color:var(--dsw-alias-state-error-primary,#e5484d);font-weight:600}
.tsh-edit-spacer{flex:1}
/* 编辑画布：iframe 与普通预览图保持完全相同的尺寸、阴影、圆角与居中排版。 */
.tsh-frame{display:block;box-sizing:border-box;border:none;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.28);background:transparent;margin:auto;flex:none}
.tsh-frame:focus{outline:none}

/* ── 底栏 ── */
.tsh-foot{flex:none;display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.tsh-meta{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tsh-actions{flex:none;display:flex;align-items:center;gap:8px}
.tsh-action{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:14px;cursor:pointer;transition:border-color .12s,color .12s,opacity .12s;text-decoration:none}
.tsh-action:hover{border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-state-business-primary,#4176e6)}
.tsh-primary{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 18px;border:1px solid transparent;border-radius:18px;background:var(--dsw-alias-button-primary-fill,#111);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:14px;font-weight:600;cursor:pointer;transition:opacity .12s}
.tsh-primary:hover{opacity:.86}
.tsh-action:disabled,.tsh-primary:disabled{opacity:.45;cursor:default;pointer-events:none}
/* 保存/复制结果提示（底栏左侧原地替换 meta 文案，避免额外浮层） */
.tsh-toast{color:var(--dsw-alias-state-success-primary,#3fb950)}
@media (prefers-reduced-motion:reduce){
  .tsh-panel{animation:none!important}
  .tsh-spinner{animation:none}
  .tsh-edit-bar{animation:none}
}
`

/** 注入面板样式（幂等）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-chat-plus'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
