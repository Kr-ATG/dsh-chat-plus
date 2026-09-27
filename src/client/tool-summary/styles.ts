/** Injected stylesheet for the tool-group UI (Harness design tokens). */

const CSS = `
/* Collapse flow slots that render nothing (aggregated tool groups + reasoning
   groups leave empty node slots behind; the transcript column's flex gap
   would otherwise turn each into a blank strip). */
[data-chat-flow-key]:has(> [data-slot]:empty) {
  display: none;
}

/* ── 设计基线 ────────────────────────────────────────────────────────────
 * 强调色一律走 --dts-accent（= 官方品牌蓝 state-business-primary）；绝不用
 * --dsw-alias-brand-primary（浅色下是黑、深色下是白的反色 token）。
 * 表面/描边只用 design-platform.css 里真实存在的 token：bg-layer-1/2、
 * bg-module-platform、border-l2/l3、label-*、state-*。
 * 内部填充面统一经 --dts-fill / --dts-fill-strong 间接引用，玻璃质感主题
 * 只需覆盖这两个变量即可整体换成「中性半透明抬升」，不必逐条重写规则。
 * ──────────────────────────────────────────────────────────────────── */

/* ===== 回合过程行容器（官方 turn-process 行同款，见 .dts__process）===== */
.dts__entry-wrap {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --dts-fill: var(--dsh-flow-veil, color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent));
  /* 实时卡片（下载/长命令）表面走变量，玻璃质感只需覆盖它。 */
  --dts-chip-surface: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.05));
  --dts-chip-border: var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  max-width: 100%;
}

/* ===== 回合过程行（与官方 TurnProcessNodeView.module.css 逐项一致）========
 * 类名换前缀（官方 hash 会变，跟类名走必断），声明照抄官方：整宽文字按钮
 * + 底部发丝线 + 左指 chevron（data-open 时转下来）。运行中文字染品牌蓝
 * （官方行在流式期不存在，这里给个活指示）。 */
.dts__process {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 33px;
  margin: 0;
  /* 上下留白平衡：官方是 padding: 0 0 8px，于是 24px 行盒被顶到行上沿
     （实测文字上 6px / 下到发丝线 14px，线像悬着）。改成 0，让行盒在
     32.5px 内容区里居中（上下各 ~10px）。行总高 33px 与 margin-bottom
     8px 都不动 → 整块占位不变，虚拟列表依旧不跳位。 */
  padding: 0;
  border: none;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
  background: 0 0;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  text-align: left;
  /* 常驻 8px：官方是 ：not([data-open]) 才有——高度一变虚拟列表就跳位。 */
  margin-bottom: 8px;
}

/* 思考分段：行内第二个可点热区（点工具段走行本体）。
   line-height 显式对齐 label 的 24px 行盒——两段都是 flex 项、各自按自己的
   行盒居中，不写死就会出现「· 7 次思考」比前面半句高/低半像素的错位。 */
.dts__process-think {
  line-height: 24px;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  transition: color .15s ease;
}

.dts__process-think:hover {
  color: var(--dsw-alias-label-primary);
}

.dts__process-think:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: 1px;
  border-radius: 3px;
}

.dts__process:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: 2px;
}

.dts__process-label {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__process[data-running="true"] .dts__process-label {
  color: var(--dts-accent);
  font-variant-numeric: tabular-nums;
}

.dts__process-chevron {
  flex: none;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  color: var(--dsw-alias-label-tertiary);
  transform: rotate(-90deg);
  transition: transform .1s;
}

.dts__process[data-open] .dts__process-chevron {
  transform: rotate(0);
}

/* control 影子行的 chevron 独立热区：点正文进抽屉、点这里走官方折叠。
   盒子放大到 24px 好点中，光学位置与官方 16px 图标一致（左 2px 偏移
   抵掉半边增量），静止态与官方无差别。 */
.dts__process-chevronbtn {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  margin: -4px -4px -4px 2px;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}

.dts__process-chevronbtn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
}

.dts__process-chevronbtn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: 1px;
}

.dts__process-chevronbtn .dts__process-chevron {
  margin-left: 0;
}



/* ===== 对话流内的实时卡片（下载 / 长命令）============================== */
.dts__entry-live {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 999px;
  background: var(--dts-chip-surface, transparent);
  color: var(--dts-accent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__download-card {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 280px;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 12px;
  background: var(--dts-fill, rgba(127,127,127,.05));
  box-shadow: 0 1px 3px rgba(15,17,21,.05);
}

.dts__download-head {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--dts-accent);
  font-size: 12px;
  font-weight: 600;
}

.dts__download-head > svg {
  flex: none;
}

.dts__download-title {
  font-variant-numeric: tabular-nums;
}

.dts__download-url {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__download-dest {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__download-dest code {
  border-radius: 4px;
  padding: 0 4px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
}

.dts__download-progress {
  margin-top: 2px;
}

.dts__download-progress .dts__progress {
  width: 100%;
}

/* 不定量进度条：淡色轨道 + 两端渐隐的强调色游标（看起来在滑动而非跳动）。 */
.dts__progress {
  position: relative;
  width: 52px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dts-accent, #4176e6) 16%, var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)));
}

.dts__progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 45%;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, var(--dts-accent, #4176e6), transparent);
  animation: dts-progress-slide 1.15s cubic-bezier(.4, 0, .6, 1) infinite;
}

@keyframes dts-progress-slide {
  from { left: -45%; }
  to { left: 100%; }
}

/* ===== 居中活动弹窗（思考 + 工具）：截图面板同款框架 ==================
   以前是贴行锚定的小气泡（480px + JS 实时定位 + 尾巴三角）；现改居中对话框：
   body 级挂载 + 遮罩 + 进出场走共享 modal-animation（dsh-modal-slide/mask），
   定位/尾巴/自救查找代码一并删除。注意居中用 inset + margin:auto，不用
   translate(-50%,-50%)——否则会被滑入滑出动画的 transform 覆盖导致跳位。 */
.dts__dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 9989;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .45));
}

/* 进出场放慢：遮罩与窗口统一 420ms（共享 modal-animation 默认 240ms 太赶，
   只改本弹窗，不动截图面板等其他共用方）。 */
.dts__dialog-mask.dsh-modal-mask-in,
.dts__dialog-mask.dsh-modal-mask-out {
  animation-duration: 420ms;
}

.dts__dialog.dsh-modal-slide-in,
.dts__dialog.dsh-modal-slide-out {
  animation-duration: 420ms;
}

.dts__dialog {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --dts-fill: var(--dsh-flow-veil, color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent));
  --dts-fill-strong: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  position: fixed;
  inset: 0;
  z-index: 9990;
  margin: auto;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(700px, calc(100vw - 48px));
  height: min(780px, calc(100vh - 96px));
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  /* 去外阴影：只留边框定界，遮罩本身已压暗背景。 */
  box-shadow: none;
  overflow: hidden;
}

@media (max-width: 767.98px) {
  .dts__dialog {
    width: calc(100vw - 24px);
    height: calc(100vh - 48px);
  }
}

/* 忙碌标签微光（上游 think shimmer 的单层等价：底色常驻 + 2s 高光带扫过；
   上游是双层实现，这里一层搞定，减弱动态/高对比下回到纯色）。 */
@supports (background-clip: text) or (-webkit-background-clip: text) {
  .dts__process[data-running="true"] .dts__process-label {
    background-image: linear-gradient(90deg, var(--dts-accent, #4176e6) 0%, var(--dts-accent, #4176e6) 40%, var(--dsw-alias-label-primary) 50%, var(--dts-accent, #4176e6) 60%, var(--dts-accent, #4176e6) 100%);
    background-size: 400% 100%;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    animation: dts-think-shimmer 2s linear infinite;
  }
}

@keyframes dts-think-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0% 0; }
}

.dts__modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  row-gap: 8px;
  padding: 13px 14px 13px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
}

.dts__modal-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
}

.dts__modal-title svg {
  color: var(--dts-accent);
}

.dts__modal-close {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  margin: 0;
  border: 0;
  padding: 0;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  transition: background-color .15s ease, color .15s ease;
}

.dts__modal-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-primary);
}

/* 分区页签（思考/工具都有内容时才出现）：无底无框下划线式，选中态一条贴字
   横线 + left/width 过渡，来回点击横线“传递”过去。 */
.dts__tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 2px;
  margin-left: auto;
  margin-right: 8px;
  border: 0;
  padding: 0 2px 5px;
  background: none;
}

.dts__tab {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 5px;
  margin: 0;
  border: 0;
  padding: 2px 10px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 22px;
  white-space: nowrap;
  transition: color .15s ease;
}

.dts__tab:hover {
  color: var(--dsw-alias-label-primary);
}

.dts__tab[data-active="true"] {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dts__tab:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: 1px;
}



.dts__modal-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 22px;
  /*
   * 这里**刻意不写** scrollbar-width / scrollbar-color：Blink 121 起只要同作用域
   * 出现这两个标准属性（非 auto），下面的 ::-webkit-scrollbar-* 伪元素就会被
   * 整体忽略，于是「4px 圆角」那条规则从未生效，屏幕上一直是 Windows 原生
   * 滚动条。两套写法只能选一套，Chromium 侧要自定义就必须走伪元素。
   * Firefox 侧兜在 kr-chat/styles.ts 的 @supports not selector(::-webkit-scrollbar)
   * 之外由本文件同名单独补一份（见文件末尾）。
   */
}

.dts__modal-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.dts__modal-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.dts__modal-scroll::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4)) 52%, transparent);
  border-radius: 999px;
  transition: background-color .18s ease;
}

.dts__modal-scroll::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4)) 82%, transparent);
}

.dts__modal-scroll::-webkit-scrollbar-corner {
  background: transparent;
}

/* Firefox 兜底：Gecko 不认伪元素，且必须包在 @supports 里，否则 Blink 侧会被
   「写了标准属性就废掉伪元素」反向命中。 */
@supports not selector(::-webkit-scrollbar) {
  .dts__modal-scroll {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4)) 52%, transparent) transparent;
  }
}

/* ---- 两个分区：思考 / 工具 ---- */
.dts__modal-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dts__modal-panel + .dts__modal-panel {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
}

.dts__modal-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dts__modal-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dts__modal-panel-title svg {
  color: var(--dts-accent);
}

.dts__modal-panel-count {
  margin-left: auto;
  border-radius: 999px;
  padding: 0 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}

.dts__modal-panel-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  border-radius: 999px;
  padding: 0 9px;
  background: color-mix(in srgb, var(--dts-accent) 12%, transparent);
  color: var(--dts-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 19px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---- 思考正文：按类别成组，每条是独立小卡 ---- */
.dts__modal-reasoning {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dts__modal-reasoning-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dts__modal-reasoning-group-title {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
  border-radius: 999px;
  padding: 0 10px;
  background: var(--dts-fill, rgba(127,127,127,.05));
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}


.dts__modal-reasoning-item {
  border-left: 2px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2));
  border-radius: 0 8px 8px 0;
  padding: 6px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 22px;
  scroll-margin-top: 10px;
  transition: background-color .18s ease, border-color .18s ease;
}

.dts__modal-reasoning-item[data-active="true"] {
  border-left-color: var(--dts-accent);
  background: color-mix(in srgb, var(--dts-accent) 7%, transparent);
}

.dts__modal-reasoning-item[data-running="true"] {
  color: var(--dsw-alias-label-primary);
}

.dts__summary-errors {
  color: var(--dsw-alias-state-error-primary, #e5484d);
}

.dts__modal-reasoning-item-text {
  min-width: 0;
  flex: 1 1 auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- 工具总结卡（填充面，与下方调用列表区分）---- */
.dts__summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--dts-fill-strong, rgba(127,127,127,.07));
}

.dts__summary-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
}

.dts__summary-title svg {
  color: var(--dts-accent);
}

.dts__summary-line {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 20px;
}

.dts__summary-line b {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dts__chips,
.dts__files {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.dts__chip {
  border-radius: 999px;
  padding: 0 9px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 20px;
  white-space: nowrap;
}

/* 涉及文件/URL pill：中性主题色（不再整片品牌蓝），URL 去查询后仍可能长，
   max-width + ellipsis 兜底，绝不越出总结卡。 */
.dts__file {
  box-sizing: border-box;
  margin: 0;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--dts-chip-border, var(--dsw-alias-border-l2, rgba(127,127,127,.22)));
  border-radius: 999px;
  padding: 0 9px;
  background: var(--dts-fill, rgba(127,127,127,.04));
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}

.dts__file:hover {
  border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.34));
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-primary);
}

/* ---- 调用列表 ---- */
.dts__modal-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ===== 弹窗内工具卡片：图标 + 变体标题 + 一行摘要 + 阶段徽标 ============
   标题行点整行展开；展开后是台账 + 结果/输入/原始数据页签；子调用沿左导轨。 */
.dts__tcall {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: 10px;
  color: var(--dsw-alias-label-secondary);
}

.dts__trow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  border: 0;
  border-radius: 10px;
  padding: 9px 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dts__trow:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
}

.dts__trow:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: 1px;
}

.dts__trow-icon {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.dts__tcall[data-state="error"] .dts__trow-icon {
  color: var(--dsw-alias-state-error-primary, #e5484d);
}

.dts__trow-main {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.dts__trow-title {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
}

.dts__trow-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__trow-time {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  white-space: nowrap;
}

.dts__trow-badge {
  flex: none;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}

.dts__trow-badge[data-phase="running"] {
  background: color-mix(in srgb, var(--dts-accent) 14%, transparent);
  color: var(--dts-accent);
}

.dts__trow-badge[data-phase="failed"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
}

.dts__trow-badge[data-phase="interrupted"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
}

.dts__trow-go {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: 0;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  /* 平时隐藏（避免与折叠箭头并排成“双箭头”）：悬停/聚焦/展开时出现，原生行同款。 */
  opacity: 0;
  transition: opacity .15s ease, color .15s ease, background-color .15s ease;
}

.dts__trow:hover .dts__trow-go,
.dts__trow:focus-within .dts__trow-go,
.dts__trow-go:focus-visible,
.dts__tcall[data-expanded] .dts__trow-go {
  opacity: 1;
}

.dts__trow-go:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14));
  color: var(--dts-accent);
}

.dts__trow-go:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: 1px;
}

.dts__trow-chevron {
  flex: none;
  color: var(--dsw-alias-label-caption, #94a3b8);
  transform: rotate(-90deg);
  transition: transform .2s cubic-bezier(.22, 1, .36, 1);
}

.dts__trow-chevron[data-open] {
  transform: rotate(0);
}

.dts__tdetail {
  margin: 2px 0 4px 26px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2));
  border-radius: 10px;
  background: var(--dsw-alias-bg-base, transparent);
  overflow: hidden;
}

.dts__tledger {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding: 10px 14px 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
}

.dts__tengine {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
}

.dts__tprog {
  height: 3px;
  margin: 8px 14px 0;
  border-radius: 2px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14));
  overflow: hidden;
}

.dts__tprog-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--dts-accent);
  transition: width .3s ease;
}

.dts__ttabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 0;
}

.dts__ttabs > button {
  margin: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 7px 10px 5px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  transition: color .15s ease, border-color .15s ease;
}

.dts__ttabs > button:hover {
  color: var(--dsw-alias-label-primary);
}

.dts__ttabs > button[aria-selected="true"] {
  border-bottom-color: var(--dts-accent);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dts__ttabs > button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: -1px;
}

.dts__tpanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px 14px;
  font-size: 13px;
  line-height: 22px;
}

.dts__tpanel:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: -3px;
}

.dts__tnote {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 20px;
}

.dts__tdoc {
  min-width: 0;
  font-size: 13px;
  line-height: 22px;
}

.dts__traw-label {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}

.dts__traw {
  max-height: 320px;
  margin: 0;
  overflow: auto;
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--dts-fill, rgba(127,127,127,.05));
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
}

.dts__tall {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 22px;
}

.dts__tall > summary {
  cursor: pointer;
  padding: 2px 0;
}

.dts__tsub {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 10px 22px;
  border-left: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2));
  padding-left: 12px;
}

.dts__drawer-call {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: 10px;
}

.dts__row-time {
  flex: none;
  color: var(--dsw-alias-label-caption, #94a3b8);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__row-time[data-running="true"] {
  color: var(--dts-accent, #4176e6);
}

/* 运行中的下载/长命令：行内进度条 + 走秒时钟，长任务不会看起来卡死。 */
.dts__row-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--dts-accent, #4176e6);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__empty {
  border-radius: 12px;
  padding: 18px;
  background: var(--dts-fill, rgba(127,127,127,.04));
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  text-align: center;
}

/* 总结区的 chip 继承所属工具的 kind 配色 */
.dts__chip[data-kind] {
  background: color-mix(in srgb, var(--dts-kind-color, #64748b) 13%, transparent);
  color: var(--dts-kind-color, #64748b);
}

/* per-kind 配色（badge + chip 共用同一个 CSS 变量） */
.dts__chip[data-kind="git-push"] { --dts-kind-color: #a855f7; }
.dts__chip[data-kind="git-commit"] { --dts-kind-color: #22c55e; }
.dts__chip[data-kind="git-pull"] { --dts-kind-color: #3b82f6; }
.dts__chip[data-kind="git-clone"] { --dts-kind-color: #0ea5e9; }
.dts__chip[data-kind="git"] { --dts-kind-color: #16a34a; }
.dts__chip[data-kind="gh"] { --dts-kind-color: #8b5cf6; }
.dts__chip[data-kind="install"] { --dts-kind-color: #f97316; }
.dts__chip[data-kind="build"] { --dts-kind-color: #f59e0b; }
.dts__chip[data-kind="test"] { --dts-kind-color: #06b6d4; }
.dts__chip[data-kind="run"] { --dts-kind-color: #6366f1; }
.dts__chip[data-kind="read"] { --dts-kind-color: #64748b; }
.dts__chip[data-kind="write"] { --dts-kind-color: #10b981; }
.dts__chip[data-kind="edit"] { --dts-kind-color: #14b8a6; }
.dts__chip[data-kind="delete"] { --dts-kind-color: #ef4444; }
.dts__chip[data-kind="search"] { --dts-kind-color: #8b5cf6; }
.dts__chip[data-kind="fetch"] { --dts-kind-color: #0ea5e9; }
.dts__chip[data-kind="download"] { --dts-kind-color: #0ea5e9; }
.dts__chip[data-kind="browser"] { --dts-kind-color: #14b8a6; }
.dts__chip[data-kind="image"] { --dts-kind-color: #ec4899; }
.dts__chip[data-kind="vision"] { --dts-kind-color: #d946ef; }
.dts__chip[data-kind="memory"] { --dts-kind-color: #eab308; }
.dts__chip[data-kind="todo"] { --dts-kind-color: #84cc16; }
.dts__chip[data-kind="subagent"] { --dts-kind-color: #0ea5e9; }
.dts__chip[data-kind="question"] { --dts-kind-color: #f43f5e; }
.dts__chip[data-kind="command"] { --dts-kind-color: #94a3b8; }
.dts__chip[data-kind="other"] { --dts-kind-color: #94a3b8; }

/* ---- 兼容保留：非聚合路径的内联工具组（当前未挂载，配色对齐新语言）---- */
.dts__group {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}

.dts__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 12px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}

.dts__head:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
}

.dts__head-icon {
  flex: none;
  font-size: 13px;
  line-height: 1;
}

.dts__head-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__head-running {
  color: var(--dsw-alias-state-business-primary);
}

.dts__head-errors {
  flex: none;
  border-radius: 999px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
  font-size: 11px;
  line-height: 18px;
}

.dts__body {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
}

.dts__tool-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.dts__generic {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 28px;
  padding: 3px 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.dts__generic-name {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dts__generic-args {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__toggle {
  align-self: flex-start;
  margin: 2px 8px 8px;
  border: 0;
  border-radius: 999px;
  padding: 2px 10px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 11px;
  line-height: 20px;
}

.dts__toggle:hover {
  color: var(--dsw-alias-label-primary);
}

/* ── 移动端：活动弹窗全屏、对话流内下载卡片不设最小宽 ─────────── */
@media (max-width: 767.98px) {
  .dts__download-card{min-width:0}
}

/* ── 尊重系统「减少动态效果」：高光/呼吸/滑动动画一律停 ─────────── */
@media (prefers-reduced-motion: reduce) {
  .dts__tab[data-active="true"]::after,
  .dts__process-chevron,
  .dts__progress::after,
  .dts__tprog-fill,
  .dts__trow-chevron,
  .dts__trow-go,
  .dts__dialog,
  .dts__dialog-mask,
  .dts__process[data-running="true"] .dts__process-label {
    animation: none;
    transition: none;
  }
  .dts__process[data-running="true"] .dts__process-label {
    color: var(--dts-accent);
    -webkit-text-fill-color: currentcolor;
  }
}

@media (forced-colors: active) {
  .dts__process[data-running="true"] .dts__process-label {
    animation: none;
    color: CanvasText;
    -webkit-text-fill-color: currentcolor;
  }
}

`

/** Inject the stylesheet (idempotent, self-healing: existing tag gets the fresh CSS). */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById('dsh-tool-summary-styles')
  if (existing !== null) {
    // 热更新/重复 apply 时旧样式表必须跟着换新，否则新标记配旧 CSS 会走样。
    if (existing.textContent !== CSS) existing.textContent = CSS
    return
  }
  const style = document.createElement('style')
  style.id = 'dsh-tool-summary-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}



