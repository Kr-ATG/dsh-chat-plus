/**
 * dsh-chat-plus — 注入式样式（思考 chip + 对话流卡片）。
 *
 * 命名空间 `dtt__`（dsh-chat-plus），与 webui 的 dsh-better-markdown__/
 * dsh-reply-card__ 不冲突；工具聚合的 dts__ 样式在 tool-summary/styles.ts。
 *
 * ⚠ 注入式 CSS 注释红线：注释内部严禁出现「星号紧跟正斜杠」的两字符闭合序列
 * （包括 token 名里混写星号再跟正斜杠的写法），否则注释提前闭合，
 * 残骸文本会把下一条规则拖成非法选择器整条丢弃。
 *
 * ⚠ 这段样式必须待在**函数体内**、由 injectStyles() 在调用时才求值。早先它是
 * 模块级的顶层常量，esbuild 把它降成 bundle 里的一个 var。
 *
 * ⚠⚠ 模板字符串里**绝对不能出现反引号**——包括写在 CSS 注释里的。esbuild
 * 不会把注释里的反引号转义，它会让整段模板在该处提前闭合，剩余正文被当成 JS
 * 表达式求值，return 的值变成布尔 false。现场症状极具迷惑性：页面里那张
 * style#dsh-chat-flow-styles 确实建出来了，textContent 却是字符串 "false"，
 * 整张表（对话流卡片 + 头部标签排版）静默全失，而元素与选择器都挑不出毛病，
 * 肉眼看就是「改了没反应」。同仓 tool-summary/styles.ts 写法相同却一直正常，
 * 差别只在于那份正文里没出现过反引号。注释一律改用「直接子级」等文字表述。 */

/** 注入用的主样式表文本（调用时求值，见文件头说明）。 */
function buildCss(): string {
  return `
/* 空白槽位折叠：聚合后工具/思考节点留下的空 [data-slot] 不再产生空白条。 */
[data-chat-flow-key]:has(> [data-slot]:empty) {
  display: none;
}

/* ── 助手正文容器：与官方 AssistantMarkdown 同一套字级与节奏 ────────────
   官方 MarkdownText 自带排版，这里只补容器层（字号轴 + 块间 gap + 宽表外溢）。 */
.dtt__assistant {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
}

.dtt__assistant-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* 宽表外溢（与官方 .body :global(.md-table-wide) 同规则） */
.dtt__assistant-body :global(.md-table-wide) {
  --dsh-table-spare: max(0px, calc((100cqw - var(--dsh-chat-content-width)) / 2));
  --dsh-table-lead: calc(var(--dsh-table-spare) + min(var(--dsh-chat-content-width), 100cqw) - 100%);
  box-sizing: border-box;
  width: calc(100% + var(--dsh-table-lead) + var(--dsh-table-spare));
  max-width: none;
  margin-left: calc(-1 * var(--dsh-table-lead));
  padding-left: var(--dsh-table-lead);
}

/* 中断回合的收尾标记（官方 .stopped 同款静默小签）。 */
.dtt__stopped {
  align-self: flex-start;
  border-radius: 6px;
  padding: 0 6px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
}

/* ══ 对话流卡片（自 webui flow-card 移植；回合结束后才出现）══════════════
   --step：回合中间的已完成片段。左侧一条竖线 + 极淡纱，圈出「一步」。
   --reply：回合最终回复（总结卡）。描边 + 顶部高光 + 纯正文外壳。
   共同规则：跟随文字色的中性半透明纱（浅色=淡黑、深色=淡白，一条规则通吃
   两个主题）。⚠ 不加 backdrop-filter：消息流里每条回复都是一张卡，长会话
   下大面积模糊会拖垮滚动性能。 */
.dtt__card {
  min-width: 0;
  border-radius: 14px;
  animation: dtt-card-in .48s cubic-bezier(.22, 1, .36, 1) both;
}

/* 中间步骤：轻量竖线卡 */
.dtt__card--step {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-left: 2px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 0 12px 12px 0;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, transparent);
}

/* 最终回复：总结卡 */
.dtt__card--reply {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
  padding: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 26%, transparent), transparent 42%),
    var(--dsh-flow-veil, color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent));
  box-shadow: 0 1px 2px rgba(15, 17, 21, .04), 0 8px 24px -18px rgba(15, 17, 21, .28);
}

/* 顶边一条品牌蓝渐隐细线：只在总结卡出现，作为「本轮收尾」的视觉锚点。 */
.dtt__card--reply::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-business-primary, #4176e6) 0%,
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 35%, transparent) 42%,
    transparent 100%
  );
  opacity: .75;
  pointer-events: none;
}

.dtt__card--reply[data-interrupted]::before {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-state-warn-primary, #f59e0b) 0%,
    transparent 100%
  );
}

/* 总结卡头部统计行（完成徽章 + 用时/步骤/Git chip）已随组件一起移除，
   只留正文外壳。 */

.dtt__card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 16px;
}

@keyframes dtt-card-in {
  from { opacity: 0; transform: translateY(20px) scale(.99); filter: blur(2px); }
  to { opacity: 1; transform: none; filter: none; }
}

/* ── 回合过程行（官方 turn-process 行同款，见 .dtt__process）──────────────
   整宽文字按钮 + 底部发丝线 + 左指 chevron（data-open 时转下来）。
   --dtt-rea-accent 只在本组件根上声明一次，子元素继承。 */
.dtt__reasoning {
  --dtt-rea-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --dtt-rea-fill: var(--dsh-flow-veil, color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  max-width: 100%;
}

/* 与官方 TurnProcessNodeView.module.css 逐项一致（类名换前缀），同 dts__process。 */
.dtt__process {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 33px;
  margin: 0;
  /* 与 dts__process 同步的上下平衡修正：官方 padding: 0 0 8px 让文字贴行上沿
     （实测上 6px / 下到发丝线 14px）。这里归零，行盒在 32.5px 内容区居中
     （上下各 ~10px）；行总高与 margin-bottom 不变，占位与虚拟列表都不受影响。 */
  padding: 0;
  border: none;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
  background: 0 0;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  text-align: left;
  margin-bottom: 8px;
}

.dtt__process:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dtt-rea-accent) 55%, transparent);
  outline-offset: 2px;
}

.dtt__process-label {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dtt__process[data-running="true"] .dtt__process-label {
  color: var(--dtt-rea-accent);
  font-variant-numeric: tabular-nums;
}

.dtt__process-chevron {
  flex: none;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  color: var(--dsw-alias-label-tertiary);
  transform: rotate(-90deg);
  transition: transform .1s;
}

.dtt__process[data-open] .dtt__process-chevron {
  transform: rotate(0);
}
/* 实时预览轨道：左侧一条竖条 + 右侧单视口文本流（无卡片铬）。
 * 全部思考段共用一个有界视口，新内容在底部长出来、视口分步跟随滚动，
 * 旧行从顶部逐行顶出裁掉——“出来一行顶一行”，不再有整卡消散/卸载。 */
.dtt__reasoning-live-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  min-width: 0;
  align-self: stretch;
}

/* 回收槽位：整轨高度合拢（grid 0fr/1fr 过渡），内轨负责淡出上收。 */
.dtt__live-slot {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  min-width: 0;
  margin-bottom: 8px;
}

.dtt__live-slot:last-child {
  margin-bottom: 0;
}

.dtt__live-slot > .dtt__reasoning-live-rail {
  min-height: 0;
}

/* 新轨展开：挂载先塌着，下一帧张开（JS 切 data-open），高度 .45s。 */
.dtt__live-slot[data-anim="enter"][data-open="false"] {
  grid-template-rows: 0fr;
  opacity: 0;
  margin-bottom: 0;
}

.dtt__live-slot[data-anim="enter"][data-open="true"] {
  grid-template-rows: 1fr;
  opacity: 1;
  transition: grid-template-rows .45s cubic-bezier(.22, 1, .36, 1), opacity .38s ease, margin-bottom .45s ease;
}

/* 整轨回收合拢：挂载先撑着，下一帧塌掉；margin 也收到 0。 */
.dtt__live-slot[data-anim="collapse"][data-open="true"] {
  grid-template-rows: 1fr;
  opacity: 1;
}

.dtt__live-slot[data-anim="collapse"][data-open="false"] {
  grid-template-rows: 0fr;
  opacity: 0;
  margin-bottom: 0;
  transition: grid-template-rows .35s cubic-bezier(.22, 1, .36, 1), opacity .3s ease, margin-bottom .35s ease;
}

/* 实时预览轨道本体：左竖条 + 右文本流，无描边卡片底色。 */
.dtt__reasoning-live-rail {
  display: flex;
  align-items: stretch;
  gap: 10px;
  min-width: 0;
  align-self: stretch;
}

.dtt__reasoning-live-rail-bar {
  flex: none;
  width: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, var(--dsw-alias-border-l2, rgba(127,127,127,.22)));
  opacity: .85;
}

/* 运行中竖条呼吸（只动透明度，不占布局）。 */
.dtt__reasoning-live-rail[data-running="true"] .dtt__reasoning-live-rail-bar {
  animation: dtt-rail-pulse 1.8s ease-in-out infinite;
}

@keyframes dtt-rail-pulse {
  0%, 100% { opacity: .55; }
  50% { opacity: 1; }
}

/* 新段淡入：挂载即播（同 key 的流式追加不重挂、不重播）。 */
.dtt__reasoning-live-seg {
  animation: dtt-seg-in .3s cubic-bezier(.22, 1, .36, 1) both;
}

@keyframes dtt-seg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

/* 对话结束开始总结：ticker 式逐行滑出——视口高度钉住不动，内层匀速上移，
   每行依次经过视口再从顶部裁掉（时长行内按段数给，保证每行露脸）；
   滑完后槽位再合拢空盒（transition-delay 与滑出同拍，见 live-stack.tsx）。 */
.dtt__reasoning-live-rail[data-closing="true"] {
  pointer-events: none;
}

.dtt__reasoning-live-rail-view[data-reclaim="true"] {
  overflow: hidden;
  -webkit-mask-image: linear-gradient(transparent 0, black 28px, black calc(100% - 28px), transparent 100%);
  mask-image: linear-gradient(transparent 0, black 28px, black calc(100% - 28px), transparent 100%);
}

.dtt__reasoning-live-rail-inner[data-reclaim="true"] {
  animation-name: dtt-rail-scroll-out;
  animation-timing-function: linear;
  animation-fill-mode: both;
}

@keyframes dtt-rail-scroll-out {
  from { opacity: 1; transform: translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-100%); }
}

/* 回收落点：轨道滑完冲着 chip 行去，行在落地时轻跳一下“接住”
  （transform 不占布局，只动视觉；时长 1.2s，dip 落在滑出尾段附近）。 */
.dtt__reasoning[data-reclaim="true"] .dtt__process,
.dts__entry-wrap[data-reclaim="true"] .dts__process {
  animation: dtt-chip-catch 1.2s cubic-bezier(.22, 1, .36, 1);
}

@keyframes dtt-chip-catch {
  0%, 78% { transform: translateY(0); }
  88% { transform: translateY(-4px); }
  100% { transform: translateY(0); }
}

/* ── 重试行影子（官方 model-retry 行同款，类名换前缀）────────────────────
   流式期原样显示；出总结卡（回合 closed）时影子组件直接返回 null，
   空槽位由既有折叠规则收掉，不留空白条。 */
.dtt__retry-row {
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}

.dtt__retry-summary {
  width: fit-content;
  color: inherit;
  cursor: pointer;
  user-select: none;
  border-radius: 3px;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
  list-style: none;
  display: inline-flex;
}

.dtt__retry-summary::-webkit-details-marker {
  display: none;
}

.dtt__retry-summary::after {
  content: "";
  opacity: .8;
  border-bottom: 1.5px solid;
  border-right: 1.5px solid;
  width: 6px;
  height: 6px;
  transition: transform .12s;
  transform: rotate(-45deg);
}

.dtt__retry-summary:hover {
  color: var(--dsw-alias-label-secondary);
}

.dtt__retry-summary:focus-visible {
  outline: 1.5px solid var(--dsw-alias-button-info-fill);
  outline-offset: 2px;
}

.dtt__retry-text {
  color: inherit;
}

.dtt__retry-row[data-active] .dtt__retry-text {
  background: linear-gradient(90deg, var(--dsw-alias-label-tertiary) 0%, var(--dsw-alias-label-tertiary) 40%, var(--dsw-alias-label-secondary) 50%, var(--dsw-alias-label-tertiary) 60%, var(--dsw-alias-label-tertiary) 100%);
  color: transparent;
  background-position: 100% 0;
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  animation: dtt-retry-shimmer 1.6s ease-in-out infinite;
}

@keyframes dtt-retry-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

.dtt__retry-row[open] .dtt__retry-summary::after {
  transform: rotate(45deg);
}

.dtt__retry-details {
  overflow-wrap: anywhere;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(18px + var(--dsh-content-font-delta-secondary, 0px));
  gap: 2px;
  margin-top: 3px;
  padding-left: 14px;
  display: grid;
}

.dtt__retry-detail-label {
  color: var(--dsw-alias-label-secondary);
}

/* 已完成的旧段略收淡。段头是 11px 静默小字（思考 + 数字标签 · 进行中/已完成）。 */
.dtt__reasoning-live-seg[data-running="false"] .dtt__reasoning-live-seg-text {
  opacity: .88;
}

.dtt__reasoning-live-seg-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  white-space: nowrap;
}

.dtt__reasoning-live-seg-meta > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 段序号标签：小 pill，跑着的那段用主题色提亮。 */
.dtt__reasoning-live-seg-tag {
  flex: none;
  box-sizing: border-box;
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #888) 16%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.dtt__reasoning-live-seg[data-running="true"] .dtt__reasoning-live-seg-tag {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 16%, transparent);
  color: var(--dsw-alias-state-business-primary, #4176e6);
}

/* 段间分隔：无卡片，用发丝虚线区分第 N 次思考。 */
.dtt__reasoning-live-seg + .dtt__reasoning-live-seg {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.22));
}

/* 悬浮轨道（紧凑模式 fixed 容器）收紧视口，不至于撑满屏。 */
.dtt__reasoning-live-stack[data-compact] .dtt__reasoning-live-rail-view {
  max-height: 220px;
}

/* 单视口：平时 352px（约两段思考），超高后内部滚动上顶；
   上下缘按滚动位置渐隐。 */
.dtt__reasoning-live-rail-view {
  flex: 1;
  min-width: 0;
  position: relative;
  max-height: 352px;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scroll-behavior: auto;
  overflow-anchor: none;
  border: 0;
  border-radius: 0;
  padding: 2px 4px 6px 0;
  background: transparent;
  /* 滚动条样式见本文件下方的「实时思考轨道」段：Chromium 侧只走伪元素，
     写了 scrollbar-width 会反过来让伪元素失效（Blink 121+）。 */
}

.dtt__reasoning-live-rail-inner {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dtt__reasoning-live-seg-text {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
}

.dtt__reasoning-live-rail-view[data-edges="both"],
.dtt__reasoning-live-rail[data-following][data-overflow] .dtt__reasoning-live-rail-view {
  -webkit-mask-image: linear-gradient(transparent 0, black 28px, black calc(100% - 28px), transparent 100%);
  mask-image: linear-gradient(transparent 0, black 28px, black calc(100% - 28px), transparent 100%);
}

.dtt__reasoning-live-rail-view[data-edges="top"] {
  -webkit-mask-image: linear-gradient(transparent 0, black 28px, black 100%);
  mask-image: linear-gradient(transparent 0, black 28px, black 100%);
}

.dtt__reasoning-live-rail-view[data-edges="bottom"] {
  -webkit-mask-image: linear-gradient(black 0, black calc(100% - 28px), transparent 100%);
  mask-image: linear-gradient(black 0, black calc(100% - 28px), transparent 100%);
}

.dtt__reasoning-live-rail-view:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: -2px;
}

@media (forced-colors: active) {
  .dtt__reasoning-live-rail-view { -webkit-mask-image: none !important; mask-image: none !important; }
}

/* 兼容别名：旧单卡类名已不再渲染，残留 DOM（HMR 间隙）按无铬文本兜底。 */
.dtt__reasoning-live,
.dtt__reasoning-live-card {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

/* 抽屉的流式悬浮预览（紧凑模式 control 行下方浮层）：轨道本身无底，
   浮层底由外层容器给，与视口解耦。 */
.dtt__reasoning-live-rail.dts__preview {
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 8px 24px rgba(15, 17, 21, .18);
  padding: 10px 14px;
  z-index: 9991;
}

/* 悬浮堆叠容器（fixed 定位由行内 style 给 top/left，这里只管纵向堆 + 层级 + 宽度）。
   pointer-events:none：悬浮层盖在正文行之上，必须点透，否则会吃掉下面
   「思考 / 工具调用」行的点击（点了没弹窗）。代价是悬浮卡不可滚动，
   要看全文点行进抽屉——悬浮只是 transient 预览，可接受。 */
.dts__preview-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 9991;
  max-width: min(520px, calc(100vw - 32px));
  min-width: min(320px, calc(100vw - 32px));
  pointer-events: none;
}
.dts__preview-stack .dtt__reasoning-live-rail {
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 8px 24px rgba(15, 17, 21, .18);
  border-radius: 12px;
  padding: 10px 14px 10px 12px;
}

/*
 * 实时思考轨道（左侧对话流）。形态与右栏大盘那套一致：6px 槽、槽即滑块宽、
 * 999px 半圆端头、轨道与 corner 全透明。
 *
 * 同样**刻意不写** scrollbar-width / scrollbar-color：Blink 121 起同作用域
 * 出现这两个标准属性（非 auto）就会让下面的伪元素整体忽略，规则从未生效。
 * 两条路只能选一套，Chromium 要自定义就必须走伪元素。
 */
.dtt__reasoning-live-rail-view::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.dtt__reasoning-live-rail-view::-webkit-scrollbar-track {
  background: transparent;
}

.dtt__reasoning-live-rail-view::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4)) 52%, transparent);
  border-radius: 999px;
  transition: background-color .18s ease;
}

.dtt__reasoning-live-rail-view::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4)) 82%, transparent);
}

.dtt__reasoning-live-rail-view::-webkit-scrollbar-corner {
  background: transparent;
}

/* Firefox 兜底（必须包在 @supports 里，理由同上）。 */
@supports not selector(::-webkit-scrollbar) {
  .dtt__reasoning-live-rail-view {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4)) 52%, transparent) transparent;
  }
}

/* ══ 移植动效（github:aa2246740/dsh-better-display，MIT）════════════════
   1) 新文字淡入：流式期新挂载块 opacity + blur 柔和显现（上游 word-motion
      的块级近似——上游逐字形做 motion，这里官方 MarkdownText 整块渲染，
      只能做到新挂载块淡入；已显示的旧节点绝不动）。
   2) 忙碌标签微光：运行中文案 2s 高光带扫过（上游 think shimmer 的单层
      等价：底色常驻 + 光带；数字仍等宽）。 */
.dtt__fresh[data-fresh] {
  display: block;
  animation: dtt-fresh-in .3s cubic-bezier(.22, 1, .36, 1);
}

@keyframes dtt-fresh-in {
  from { opacity: .15; filter: blur(2px); }
  to { opacity: 1; filter: none; }
}

@supports (background-clip: text) or (-webkit-background-clip: text) {
  .dtt__process[data-running="true"] .dtt__process-label {
    background-image: linear-gradient(90deg, var(--dtt-rea-accent, #4176e6) 0%, var(--dtt-rea-accent, #4176e6) 40%, var(--dsw-alias-label-primary) 50%, var(--dtt-rea-accent, #4176e6) 60%, var(--dtt-rea-accent, #4176e6) 100%);
    background-size: 400% 100%;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    animation: dtt-think-shimmer 2s linear infinite;
  }
}

@keyframes dtt-think-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0% 0; }
}

.dtt__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* 尊重系统「减少动态效果」偏好 */
@media (prefers-reduced-motion: reduce) {
  .dtt__card { animation: none; }
  .dtt__live-slot[data-anim][data-open] { transition: none; }
  .dtt__process-chevron {
    animation: none;
    transition: none;
  }
  .dtt__fresh[data-fresh] { animation: none; }
  .dtt__reasoning-live-seg,
  .dtt__reasoning-live-rail-inner[data-reclaim="true"],
  .dtt__reasoning-live-rail[data-running="true"] .dtt__reasoning-live-rail-bar { animation: none; }
  .dtt__reasoning[data-reclaim="true"] .dtt__process,
  .dts__entry-wrap[data-reclaim="true"] .dts__process { animation: none; }
  .dtt__retry-row[data-active] .dtt__retry-text {
    animation: none;
    color: inherit;
    background: none;
    -webkit-text-fill-color: currentcolor;
  }
  .dtt__process[data-running="true"] .dtt__process-label {
    animation: none;
    color: var(--dtt-rea-accent);
    -webkit-text-fill-color: currentcolor;
  }
}

@media (forced-colors: active) {
  .dtt__process[data-running="true"] .dtt__process-label {
    animation: none;
    color: CanvasText;
    -webkit-text-fill-color: currentcolor;
  }
}

/* ── 生图画廊条（dgi__：SummaryCard 正文区，generate_image 结果）────────
   默认单图（保持原比例、≤360px）；strip--multi 时并排缩略图（4:3 裁剪、
   序号角标）。点击弹全屏 Lightbox（z-index 1200 为会话级遮罩统一值）。 */
.dgi__strip {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
  min-width: 0;
}

.dgi__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.dgi__item {
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
  position: relative;
  display: block;
  flex: 0 0 auto;
  width: auto;
  height: auto;
  max-width: 360px;
  border-radius: 8px;
  overflow: hidden;
  line-height: 0;
}

/* 多图并排：弹性缩略图（放不下自动换行） */
.dgi__strip--multi .dgi__item {
  flex: 1 1 0;
  min-width: 96px;
  max-width: 220px;
  aspect-ratio: 4 / 3;
}

.dgi__thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  transition: transform .15s ease, filter .15s ease;
}

.dgi__strip--multi .dgi__thumb {
  object-fit: cover;
}

.dgi__item:hover .dgi__thumb {
  transform: scale(1.02);
  filter: brightness(1.04);
}

.dgi__item:focus-visible {
  outline: 2px solid var(--dsw-alias-accent, #7aa2f7);
  outline-offset: 2px;
}

.dgi__badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  /* 不用 backdrop-filter：全插件去高斯模糊，底色加深保证可读。 */
  background: rgba(10, 12, 16, .85);
  color: rgba(255, 255, 255, .92);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}

.dgi__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 10, 14, .92);
  animation: dgi-fade-in .18s ease;
}

.dgi__stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 92vw;
  max-height: 88vh;
  color: rgba(255, 255, 255, .92);
}

.dgi__full {
  display: block;
  max-width: 92vw;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, .5);
  animation: dgi-zoom-in .2s ease;
}

.dgi__save-button {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, .18);
  border-radius: 999px;
  /* 不用 backdrop-filter：全插件去高斯模糊，底色加深保证可读。 */
  background: rgba(20, 24, 32, .92);
  color: rgba(255, 255, 255, .92);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}

.dgi__save-button:hover {
  background: rgba(32, 38, 50, .88);
  border-color: rgba(255, 255, 255, .32);
}

.dgi__save-button:disabled {
  opacity: .6;
  cursor: default;
}

.dgi__save-icon { display: block; }

.dgi__broken {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 200px;
  min-height: 160px;
  border-radius: 8px;
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .72);
  font-size: 13px;
}

.dgi__meta-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, .8);
}

.dgi__model {
  opacity: .75;
  font-family: var(--dsh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}

.dgi__hint-line {
  margin-top: 4px;
  font-size: 11px;
  line-height: 16px;
  color: rgba(255, 255, 255, .5);
}

@keyframes dgi-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes dgi-zoom-in {
  from { transform: scale(.96); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .dgi__backdrop,
  .dgi__full,
  .dgi__thumb { animation: none; transition: none; }
  .dgi__item:hover .dgi__thumb { transform: none; }
}

/* 用户要求：对话流卡片去全部底色无边框（只留阴影/文字/动效；hover 反馈保留）。 */
.dtt__card--step, .dtt__card--reply { background: transparent !important; }
/* 超细边条：1px 发丝描边（浅色 l3 / 深色白 10%），阴影回到 v0.4.7 的轻档。 */
.dtt__card--reply { border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16)) !important; }
.dtt__card--reply::before, .dtt__card--reply[data-interrupted]::before { display: none !important; }
.dtt__card--step { border: none !important; }
body[data-ds-dark-theme] .dtt__card--reply { box-shadow: 0 12px 32px rgba(0,0,0,.55) !important; border-color: rgba(255,255,255,.10) !important; }

/* ══ 会话头部视图标签（KR对话 / 对话 / 轨迹）排版 ═══════════════════════
   0.1.5-rc.2 的 header 实测是 display:grid、两行共 77px：
     header
       ├─ .headerLeading            （空的，0 宽）
       └─ div（官方已设 display:contents）—— 注意是 DOM 里的真实包裹层
            ├─ .titleRow > (.titleCluster, .headerUtilities, .headerCorner)
            └─ .tabs[role=tablist]
   标签组挪到「在应用中打开」分体按钮（坐在 .headerUtilities 里）的左侧，
   header 同时收回 44px 单行，省下的 33px 全还给正文。

   ⚠ 这套选择器全部是**后代**而不是「直接子级」组合子：官方把 titleRow 与
   tablist 又包了一层 div（且已设 display:contents）。布局上它们等价于 header
   的直接 item，但 CSS 的直接子级组合子匹配的是 DOM 父子 —— 早先那版全用直接
   子级，在 0.1.5-rc.2 上一条都没命中，标签仍在第二行左侧（新版已多出
   .headerLeading 包裹层，唯独 _titleRow / _tab 这些后缀仍是稳定钩子）。
   单行统一高度 44px + 垂直居中，与桌面壳窗口控制按钮中心线（y=22px）精准平齐。 */
header:has([class*='_titleRow']) {
  display: flex;
  align-items: center;
  gap: 0;
  min-height: 44px;
  height: 44px;
  padding-top: 0;
  padding-bottom: 0;
  box-sizing: border-box;
}

/* 视图标签插到「在应用中打开」分体按钮左侧。跨父级搬 DOM 不可行：官方按
   tabs.length > 1 增删 tablist，React 记的 host parent 恒定，搬走后它卸载时
   removeChild 会 NotFoundError 把整棵 header 树带崩。所以改用 display:contents
   把 .titleRow 摊平（它没有伪元素），三个子块直接参与 header 的 flex，再按
   order 把 tablist 插到 .titleCluster 之后、.headerUtilities 之前。
   零 DOM 改动、零 React 风险；单视图（无 tablist）时整组规则不生效。
   间距不用 header 的 gap —— .headerLeading 那个 0 宽的占位 item 也会吃到 gap
   把整行右推；改成各块自带 margin，间距只落在真正相邻的两段之间。 */
header:has([role='tablist']) [class*='_titleRow'] {
  display: contents;
}

header:has([role='tablist']) [class*='_titleRow'] > [class*='_titleCluster'] {
  order: 1;
  flex: 1 1 auto;
  min-width: 0;
  margin-right: 18px;
}

header:has([role='tablist']) [role='tablist'] {
  order: 2;
  flex: none;
  gap: 22px;
  margin: 0 18px 0 0;
  padding-left: 0;
  animation: dsh-header-tabs-in .3s cubic-bezier(.2, .8, .2, 1) both;
}

header:has([role='tablist']) [class*='_titleRow'] > [class*='_headerUtilities'] {
  order: 3;
  /* 官方的 20px 是「标签独占第二行」时期的右侧留白；标签插进来后由 tablist 的
     margin-right 统一给出 18px，标题—标签—工具区三段才等距。 */
  margin-left: 0;
}

header:has([role='tablist']) [class*='_titleRow'] > [class*='_headerCorner'] {
  order: 4;
}

@keyframes dsh-header-tabs-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
}

/* 标签本体：下划线收回到贴着文字（官方 11px 底衬是给整行贴边用的），
   hover 提色 + 下划线从中心展开，选中态常驻蓝色下划线。 */
header [role='tablist'] > [class*='_tab'] {
  padding: 2px 0 8px;
  /* 微浮起与提色同步走，抬升 1px 刚好压在下划线上沿之外，不糊掉指示条。 */
  transition: color .18s ease, transform .18s cubic-bezier(.2, .8, .2, 1);
}

header [role='tablist'] > [class*='_tab']:hover {
  color: var(--dsw-alias-label-primary);
  transform: translateY(-1px);
}

header [role='tablist'] > [class*='_tab']::after {
  right: 0;
  bottom: 2px;
  left: 0;
  transform: scaleX(0);
  transform-origin: 50% 100%;
  transition: transform .22s cubic-bezier(.2, .8, .2, 1), background-color .18s ease;
}

header [role='tablist'] > [class*='_tab']:hover::after {
  background: var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  transform: scaleX(1);
}

header [role='tablist'] > [class*='_tab'][class*='_tabActive']::after {
  background: var(--dsw-alias-state-business-primary, #4176e6);
  transform: scaleX(1);
}

@media (prefers-reduced-motion: reduce) {
  header [role='tablist'] > [class*='_tab'],
  header [role='tablist'] > [class*='_tab']::after { transition: none; }
  header [role='tablist'] > [class*='_tab']:hover { transform: none; }
  header:has([role='tablist']) [role='tablist'] { animation: none; }
}

/* ══ 壳窗口控制：全视口原样呈现（不再为右上角保留留位空档） ═════════════════ */
`
}

/** Inject the stylesheet once. */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  const id = 'dsh-chat-flow-styles'
  const existing = document.getElementById(id)
  const sheet = buildCss()
  if (existing !== null) {
    // 幂等注入的例外：同名节点存在但内容不是本表（历史版本写坏过，或被别的
    // 代码抢先占位），就地换成正确内容，而不是 return 之后让整表静默缺席。
    if ((existing.textContent ?? '').length > 1000) return
    existing.textContent = sheet
    return
  }
  const style = document.createElement('style')
  style.id = id
  style.textContent = sheet
  document.head.appendChild(style)
}

/** 生图画廊样式：与主样式同模板，幂等注入（别名，供组件内部调用）。 */
export const injectGalleryStyles = injectStyles
