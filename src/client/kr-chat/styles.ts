/**
 * dsh-chat-plus — KR 对话双栏布局与执行大盘独立样式表。
 */

export const KR_STYLES = `
/* ══ 当处于 KR 对话模式时，外层 conversation-content 成为双栏 row 布局 ══════ */
body[data-dsh-kr-chat="true"] [data-conversation-content] {
  flex-direction: row !important;
  display: flex !important;
  width: 100% !important;
  height: 100% !important;
  position: relative !important;
  overflow: hidden !important;
}

body[data-dsh-kr-chat="true"] [data-conversation-scroll] {
  flex: 1 1 0 !important;
  min-width: 0 !important;
  height: 100% !important;
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
}

/* 隐藏旧的折叠行与折叠 chip，以及在 KR 模式下左侧隐藏原生工具树与紧凑控制行（详情收敛至右侧大盘） */
body[data-dsh-kr-chat="true"] .dts__process,
body[data-dsh-kr-chat="true"] .dts__entry,
body[data-dsh-kr-chat="true"] .dtt__chip,
body[data-dsh-kr-chat="true"] [data-chat-call-id],
body[data-dsh-kr-chat="true"] [data-chat-anchor-key^="call:"],
body[data-dsh-kr-chat="true"] [data-step-process],
body[data-dsh-kr-chat="true"] [data-turn-process],
/*
 * 官方把「同一个 assistant-step 节点」投影成两份 DOM：
 *   [data-turn-process-member] 过程投影（groupPart=reasoning）
 *   [data-turn-process-answer] 答案投影（groupPart=response）
 * 本插件注册在 conversation.chat.node / assistant-step 上，不区分投影，
 * 于是思考卡与总结卡在两份里各渲染一次。
 *
 * 官方只在折叠态隐藏过程投影（processHidden = foldable && processMember && !processOpen），
 * 所以一旦展开（processOpen=true，包括 processMember 时自动 setOpen(true)），
 * 两份同时可见 → 左侧每张卡都重复一遍（用户报的「点开思考到总结时出现两个」）。
 *
 * KR 模式下左侧只该留答案投影：过程内容由本插件自己的思考卡承接，工具明细收敛
 * 到右侧大盘，所以把过程投影整个隐掉。实测每轮可见块数正好减半，且过程投影的
 * 每一块在答案投影里都有同文副本（唯一内容丢失 0 条）。
 */
body[data-dsh-kr-chat="true"] [data-turn-process-member] {
  display: none !important;
}

/* 实时活动卡借用 turn-process 的 per-turn 座位，但KR 模式要让它可见。
   :has 只命中含新卡的那一个过程投影，不把官方过程内容/重复节点放回来。 */
body[data-dsh-kr-chat="true"] [data-turn-process]:has(.kr-agent-mini-shell),
body[data-dsh-kr-chat="true"] [data-turn-process-member]:has(.kr-agent-mini-shell) {
  display: block !important;
}

/* response group 是最终答案投影：即使 DSH 尚未把 live turn 切到 answer
   状态，也先让它的可见正文显示出来；reasoning group 仍隐藏，由活动卡承接。 */
body[data-dsh-kr-chat="true"] [data-turn-process-member][data-chat-group-part="response"] {
  display: block !important;
}

/* ══ KR 模式下左侧对话流交互（无染色视觉，点击即可直接选中联动大盘） ═════════ */
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-turn] {
  cursor: pointer;
}

body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-turn] p,
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-turn] pre,
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-turn] code,
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-turn] a {
  cursor: text;
}

/* ══ 头部 KR 对话分类标签（与官方原生标签保持完全一致的块级排版与基线） ════════ */
.kr-tab-btn {
  display: block;
  padding: 0 0 9px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  cursor: pointer;
  position: relative;
  transition: color .18s ease;
  color: var(--dsw-alias-label-tertiary);
  outline: none;
  user-select: none;
}

.kr-tab-btn::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 2px;
  background: transparent;
  transform: scaleX(0);
  transform-origin: 50% 100%;
  transition: transform .22s cubic-bezier(.2, .8, .2, 1), background-color .18s ease;
}

.kr-tab-btn:hover {
  color: var(--dsw-alias-label-primary);
}

.kr-tab-btn:hover::after {
  background: var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  transform: scaleX(1);
}

.kr-tab-btn--active {
  color: var(--dsw-alias-state-business-primary, #4176e6) !important;
  font-weight: 500 !important;
}

.kr-tab-btn--active::after {
  background: var(--dsw-alias-state-business-primary, #4176e6) !important;
  transform: scaleX(1) !important;
}

/* 当处于 KR 模式时，原生的“对话”与“轨迹”按钮不要显示激活高亮与下划线 */
body[data-dsh-kr-chat="true"] header [role="tablist"] > button[role="tab"]:not(#kr-chat-tab-btn)::after {
  transform: scaleX(0) !important;
  background: transparent !important;
}
body[data-dsh-kr-chat="true"] header [role="tablist"] > button[role="tab"]:not(#kr-chat-tab-btn) {
  color: var(--dsw-alias-label-tertiary) !important;
  font-weight: 500 !important;
}
body[data-dsh-kr-chat="true"] header [role="tablist"] > button[role="tab"]:not(#kr-chat-tab-btn):hover {
  color: var(--dsw-alias-label-primary) !important;
}
body[data-dsh-kr-chat="true"] header [role="tablist"] #kr-chat-tab-btn {
  color: var(--dsw-alias-state-business-primary, #4176e6) !important;
  font-weight: 500 !important;
}
body[data-dsh-kr-chat="true"] header [role="tablist"] #kr-chat-tab-btn::after {
  transform: scaleX(1) !important;
  background: var(--dsw-alias-state-business-primary, #4176e6) !important;
}

:root,
body[data-dsh-kr-chat="true"],
.kr-split,
.kr-split__side {
  --kr-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --kr-success: #10b981;
  --kr-warning: #f59e0b;
  --kr-error: #ef4444;
  /*
   * 表面策略：**大盘不铺底色，卡片常态投影浮起**。
   *
   * 右栏不再刷一层自己的底色（--kr-canvas-bg = transparent），底色直接透出
   * 下方主对话区，等于这层 chrome 从「一块色板」退回「一层透明容器」；
   * 于是卡片之间的空隙、头部、footer 露出的都是主区底色，卡片靠自身投影
   * 浮在这层底色上，层级一眼可读。分隔线仍保留一根发丝，标出这是独立栏位。
   *
   * 投影用「近距贴地 + 远距极淡」两层，模糊半径刻意收在滚动区 12px padding
   * 之内（.kr-panel__scroll 是滚动容器，左右多一像素都会被裁掉），
   * 保证滚动时卡片四周的影子不会被切边。
   */
  --kr-card-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --kr-surface-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  /* 去掉大盘背景色：transparent 让右侧直接透出主对话区底色。 */
  --kr-canvas-bg: transparent;
  /* 描边退到发丝级：浅色 4% 黑 / 深色 6% 白（l1 自带主题感知）。
     投影负责「浮起」，描边只负责「边界」，两者分工不重复。 */
  --kr-card-border: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
  --kr-card-hover: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16));
  --kr-hairline: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
  --kr-hover-bg: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  --kr-fill-bg: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.1));
  /* 常态投影：一层贴地定边、一层远距托底，卡片于是浮在大盘底色之上。 */
  --kr-card-shadow: 0 1px 2px rgba(15, 17, 21, .05), 0 6px 14px -8px rgba(15, 17, 21, .18);
  /* hover 再抬一档，同时卡片整体上浮 1px（见 .kr-card:hover）。 */
  --kr-card-shadow-hover: 0 2px 4px rgba(15, 17, 21, .06), 0 12px 20px -12px rgba(15, 17, 21, .24);
  /* 对话流里那张 Agent 状态卡是浮在消息底上的（不贴大盘），必须留投影；
     深浅两套阴影都在 --kr-float-shadow 里给出，避免把 #FFFFFF 之类写死在规则里。 */
  --kr-float-shadow: 0 1px 2px rgba(15, 17, 21, .04), 0 8px 24px -18px rgba(15, 17, 21, .28);
}

/* 深色主题：底色透出主对话区后，卡片(layer-1)与底色只差几级亮度，
   分层几乎全交给投影 —— 所以深色下的影要比浅色更黑、铺得更开，
   否则白卡片贴在深底上还是「浮不动」。 */
body[data-ds-dark-theme],
body[data-ds-dark-theme] .kr-split__side {
  --kr-card-border: rgba(255, 255, 255, 0.07);
  --kr-card-shadow: 0 1px 2px rgba(0, 0, 0, .42), 0 6px 16px -8px rgba(0, 0, 0, .72);
  --kr-card-shadow-hover: 0 2px 6px rgba(0, 0, 0, .5), 0 14px 24px -14px rgba(0, 0, 0, .85);
  /* 浮层卡在深色下靠描边 + 更黑的落影分层，不能沿用浅色的暖灰阴影。 */
  --kr-float-shadow: 0 1px 2px rgba(0, 0, 0, .45), 0 10px 28px -18px rgba(0, 0, 0, .78);
}

.kr-split {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* 左侧主对话流 */
.kr-split__main {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  transition: flex 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 右侧 Agent 轨迹大盘 */
.kr-split__side {
  width: 440px;
  min-width: 360px;
  max-width: 520px;
  flex: none;
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 大盘不再刷自己的底色（--kr-canvas-bg = transparent）：底色透出主对话区，
     卡片靠自身投影浮在这层底色上。左边缘的分隔线也一并去掉 —— 底色既然透出，
     那根线就成了唯一还把右栏「框住」的东西，卡片阴影已经足够声明栏位；
     留着它反而是「透明层 + 一条框线」这种自相矛盾的画法。
     栏位边界改由两件事承担：卡片自身的投影，以及 hover 才亮起来的拖拽手柄。 */
  background: var(--kr-canvas-bg);
  position: relative;
  z-index: 10;
  transition: width 0.26s cubic-bezier(0.16, 1, 0.3, 1), transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

/* 拖拽中：关掉宽度过渡（过渡会跟手打架，拖起来一顿一顿的），全局换 col-resize。 */
.kr-split__side[data-dragging="true"] {
  transition: none;
}
body[data-kr-resizing="true"] {
  cursor: col-resize !important;
  user-select: none !important;
}
body[data-kr-resizing="true"] * {
  cursor: col-resize !important;
}

/* 左边缘拖拽手柄：宽 7px 的命中区。分隔线去掉后它是右栏唯一剩下的边界线索，
   所以常态透明、悬停/拖拽才亮一条竖线 —— 平时干净，需要时又找得到。
   absolute 覆盖在容器左边缘上（容器 overflow:hidden 已裁剪），不参与 flex。 */
.kr-panel__resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 7px;
  cursor: col-resize;
  z-index: 60;
  touch-action: none;
}
/* 悬停/拖拽时亮一条竖线，提示「这里可以拖」。 */
.kr-panel__resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: transparent;
  opacity: 0;
  transform: scaleY(0.4);
  transform-origin: 50% 50%;
  transition: background 0.18s ease, opacity 0.18s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.kr-panel__resize-handle:hover::before,
.kr-split__side[data-dragging="true"] .kr-panel__resize-handle::before {
  background: var(--kr-accent);
  opacity: 1;
  transform: scaleY(1);
}

/* 全屏态铺满整个 split：无投影，此规则保留作显式声明，
   防止将来有人给基础态加投影时漏掉这一态。 */
.kr-split__side--fullscreen {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100% !important;
  max-width: none !important;
  z-index: 50;
  box-shadow: none;
}

/* ══ 右栏顶部 Header ═══════════════════════════════════════════════════════ */
.kr-panel__header {
  height: 60px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--kr-hairline);
  flex: none;
  /* 顶栏随大盘一起退成透明层：它横贯整栏，刷任何底色都会在「大盘无底色、
     卡片全靠投影浮起」的新策略下显得突兀（一道比卡片还实的色带）。
     下方分隔线继续承担「这是面板级 chrome」的边界声明。 */
  background: var(--kr-canvas-bg);
}

.kr-panel__close-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  flex: none;
}

.kr-panel__close-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.15));
  color: var(--dsw-alias-label-primary);
}

.kr-panel__avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--kr-fill-bg);
  border: none;
  color: var(--dsw-alias-label-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.kr-panel__avatar svg {
  width: 18px;
  height: 18px;
}

/* ══ 空态：本次对话尚无内容（新会话空白期） ══════════════════════════════ */
.kr-panel__empty {
  flex: 1 1 auto;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 24px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
}

.kr-panel__empty-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--kr-surface-bg);
  border: 1px solid var(--kr-card-border);
  color: var(--dsw-alias-label-tertiary);
  margin-bottom: 2px;
}

.kr-panel__empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}

.kr-panel__empty-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
  max-width: 240px;
}

.kr-panel__titles {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kr-panel__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.kr-panel__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  flex: none;
}

.kr-panel__status-dot--running {
  background: var(--dsw-alias-label-primary);
  animation: kr-pulse 1.8s infinite;
}

@keyframes kr-pulse {
  0% { transform: scale(0.9); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.8; }
}

.kr-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.kr-panel__subtitle {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kr-panel__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.kr-panel__action-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.kr-panel__action-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.15));
  color: var(--dsw-alias-label-primary);
}

.kr-panel__action-btn--active {
  color: var(--kr-accent);
  background: var(--kr-fill-bg);
}

.kr-panel__subtitle--clickable {
  cursor: pointer;
  transition: color 0.15s;
}

.kr-panel__subtitle--clickable:hover {
  color: var(--dsw-alias-label-primary);
}

/* ══ 右栏内容滚动区 ════════════════════════════════════════════════════════ */
.kr-panel__scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  /* 左右 12px 的 padding 同时是卡片的「让影空间」：滚动容器会把溢出
     padding box 的部分裁掉，投影的横向扩散必须收在这 12px 之内。 */
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 随大盘退成透明：卡片之间的空隙直接露出主对话区底色。 */
  background: var(--kr-canvas-bg);
}

/* ══ 历史轮次提示胶囊已移除 ════════════════════════════════════════════════
   「已选对话：xxx / 返回最新对话」那条整条删掉：它常驻在大盘顶部，与下面的卡片
   标题叠在一起既占位又抢注意力，而「返回最新对话」本身也是多余动作——点击对话
   流里任意一条消息即可切到那一轮。相关样式随之删除。 */

/* ══ 统计指标药丸已移除 ════════════════════════════════════════════════════
   顶部「查看执行统计指标」按钮与它展开的药丸行（第 N 轮 / N 次工具调用 /
   N 次失败 / 耗时）按用户要求整体去掉，相关样式随之删除。
   @keyframes kr-fade-in 仍被工具详情面板使用，保留在文件下方定义处。 */

/* ══ 通用卡片容器（透明大盘上的悬浮卡片） ══════════════════════════════════ */
.kr-card {
  background: var(--kr-card-bg);
  border: 1px solid var(--kr-card-border);
  border-radius: 10px;
  box-shadow: var(--kr-card-shadow);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 投影 + 位移 + 描边同步过渡：悬浮感是「渐次浮起」而不是「啪一下换图」，
     阴影走 .22s 的缓出曲线，和面板宽度/展开动画同一套节奏。 */
  transition: border-color 0.18s ease, box-shadow 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  /* 挂载时轻微上浮淡入：内容回流（新一轮任务/思考落盘）时卡片是重新挂载的，
     入场动画正好替代了原来「贴平无感」的突兀出现。 */
  animation: kr-card-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* hover：抬升 1px + 阴影再开一档，让「可交互」和「可折叠」被看见。 */
.kr-card:hover {
  border-color: var(--kr-card-hover);
  box-shadow: var(--kr-card-shadow-hover);
  transform: translateY(-1px);
}

@keyframes kr-card-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .kr-card {
    transition: border-color 0.15s linear;
    animation: none;
  }
  .kr-card:hover {
    transform: none;
  }
}

.kr-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.kr-card__icon {
  width: 18px;
  height: 18px;
  color: var(--dsw-alias-label-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.kr-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  flex: 1;
}

/* 工具调用卡标题行右端的「展开 N 次调用」提示：与标题同在一行，
   次要色弱化（展开动作的主角是整行头部点击区）。 */
.kr-tools-expand-hint {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}

.kr-card__badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.kr-card__badge--running {
  background: var(--kr-fill-bg);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--kr-card-border);
}

.kr-card__badge--done {
  background: var(--kr-hover-bg);
  color: var(--dsw-alias-label-tertiary);
}

.kr-card__chevron {
  color: var(--dsw-alias-label-caption);
  transition: transform 0.2s ease;
}

.kr-card__chevron[data-collapsed="true"] {
  transform: rotate(180deg);
}

/* ══ 任务概览卡片（单卡片原生极简设计）═════════════════════════════════════ */
.kr-card--task {
  padding: 12px 14px;
}

/* 极简细平滑进度条（2.5px，轻量雅致，不割裂界面） */
.kr-task-progress-line {
  height: 2.5px;
  background: var(--kr-fill-bg);
  border-radius: 999px;
  overflow: hidden;
  margin: 4px 0 6px;
}

.kr-task-progress-line__fill {
  height: 100%;
  background: var(--dsw-alias-label-secondary, #61666b);
  border-radius: 999px;
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 任务列表 */
.kr-task-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/*
 * 空态常驻：卡片不再因为「这轮还没有 todo」整张消失，右栏第一张卡的位置永远
 * 稳定。压低对比度让它退成背景，不与真有任务时抢注意力。
 */
.kr-task-empty {
  padding: 7px 8px 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  opacity: .72;
}

.kr-card--task[data-empty] .kr-card__badge {
  opacity: .6;
}

/* 任务行落位：首条 34ms、逐条错峰，读作「步骤在铺开」而不是整张卡突然出现。 */
.kr-task-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 6px;
  animation: kr-task-item-in .3s cubic-bezier(.16, 1, .3, 1) both;
  transition: background-color 0.12s ease;
}

@keyframes kr-task-item-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}

.kr-task-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.07));
}

.kr-task-item__icon {
  width: 14px;
  height: 14px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary);
}

.kr-task-item--completed .kr-task-item__icon {
  color: var(--dsw-alias-label-secondary);
}

.kr-task-item--in_progress .kr-task-item__icon {
  color: var(--dsw-alias-state-business-primary, #4176e6);
}

.kr-task-item__content {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  word-break: break-word;
}

.kr-task-item--completed .kr-task-item__content {
  color: var(--dsw-alias-label-secondary);
}

.kr-task-item__tag {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  flex: none;
  margin-top: 1px;
  white-space: nowrap;
}

.kr-task-item__tag--running {
  color: var(--dsw-alias-state-business-primary, #4176e6);
  background: rgba(65, 118, 230, 0.1);
}

/* ══ 思考过程卡片 ══════════════════════════════════════════════════════════ */
.kr-reasoning-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

/*
 * 有界视口：行数上限由组件传入的 --kr-reasoning-rows 驱动
 * （见 KrReasoningCard 的 REASONING_MAX_ROWS），行高 12px × 1.6 = 19.2px。
 * 超出部分在视口内滚动，卡片不再被思考内容撑成长条。
 * 上下缘按滚动位置渐隐，与左侧实时轨道同一套做法（data-edges）。
 */
.kr-reasoning-view {
  --kr-reasoning-line: 19.2px;
  --kr-reasoning-rows: 25;
  max-height: calc(var(--kr-reasoning-line) * var(--kr-reasoning-rows));
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scroll-behavior: auto;
  overflow-anchor: none;
  padding-right: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, .4)) transparent;
}

.kr-reasoning-inner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.kr-reasoning-view[data-edges="both"] {
  -webkit-mask-image: linear-gradient(transparent 0, black 18px, black calc(100% - 18px), transparent 100%);
  mask-image: linear-gradient(transparent 0, black 18px, black calc(100% - 18px), transparent 100%);
}

.kr-reasoning-view[data-edges="top"] {
  -webkit-mask-image: linear-gradient(transparent 0, black 18px, black 100%);
  mask-image: linear-gradient(transparent 0, black 18px, black 100%);
}

.kr-reasoning-view[data-edges="bottom"] {
  -webkit-mask-image: linear-gradient(black 0, black calc(100% - 18px), transparent 100%);
  mask-image: linear-gradient(black 0, black calc(100% - 18px), transparent 100%);
}

.kr-reasoning-view:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
}

.kr-reasoning-view::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.kr-reasoning-view::-webkit-scrollbar-track {
  background: transparent;
}

.kr-reasoning-view::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, .4));
  border-radius: 2px;
}

@media (forced-colors: active) {
  .kr-reasoning-view { -webkit-mask-image: none !important; mask-image: none !important; }
}

/* 跟随状态提示（只在截停时出现，给用户明确反馈） */
.kr-card__follow {
  flex: none;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--kr-hover-bg);
  white-space: nowrap;
}

.kr-reasoning-row {
  display: flex;
  gap: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}

.kr-reasoning-num {
  color: var(--kr-accent);
  font-weight: 600;
  flex: none;
}

.kr-expand-btn {
  background: transparent;
  border: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  transition: color 0.15s ease;
}

.kr-expand-btn:hover {
  color: var(--dsw-alias-label-primary);
  text-decoration: none;
}

/* ══ 工具调用卡片与点击展开交互 ═════════════════════════════════════════════ */
.kr-tools-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}

.kr-tool-card-item {
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  overflow: hidden;
  transition: all 0.15s ease;
}

.kr-tool-card-item:hover {
  background: var(--kr-hover-bg);
}

.kr-tool-card-item--expanded {
  background: var(--kr-surface-bg);
  border: 1px solid var(--kr-card-border);
  /* 展开态是卡片内部的一块高亮区，用描边区分即可；
     再投一层阴影就会在卡片里叠出第三层「悬浮」。 */
  box-shadow: none;
  margin: 2px 0;
  border-radius: 8px;
}

.kr-tool-card-item--failed {
  border-color: rgba(239, 68, 68, 0.25);
}

/* 概览行：整体可点击 */
.kr-tool-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.kr-tool-icon {
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-tertiary);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kr-tool-name {
  font-weight: 500;
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
  flex: none;
}

.kr-tool-detail {
  flex: 1;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kr-tool-time {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.kr-tool-status {
  width: 14px;
  height: 14px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
}

.kr-tool-status--done {
  color: var(--dsw-alias-label-secondary);
}

.kr-tool-status--fail {
  color: var(--dsw-alias-label-primary);
}

.kr-tool-row__chevron {
  color: var(--dsw-alias-label-caption);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.kr-tool-row__chevron--open {
  transform: rotate(180deg);
}

/* 展开的详情面板 */
.kr-tool-detail-panel {
  padding: 10px 12px;
  border-top: 1px solid var(--kr-card-border);
  background: var(--dsw-alias-bg-module-platform, rgba(0, 0, 0, 0.1));
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: kr-fade-in 0.2s ease-out;
}

/* 台账信息标签 */
.kr-tool-detail__ledger {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.kr-tool-detail__badge {
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--kr-surface-bg);
  border: 1px solid var(--kr-card-border);
  color: var(--dsw-alias-label-secondary);
}

.kr-tool-detail__badge--err {
  background: var(--kr-hover-bg);
  border-color: var(--kr-card-border);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

/* 页签栏 */
.kr-tool-detail__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--kr-card-border);
  padding-bottom: 4px;
}

.kr-tool-detail__tab {
  background: transparent;
  border: none;
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-weight: 500;
  transition: all 0.15s ease;
}

.kr-tool-detail__tab:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.kr-tool-detail__tab--active {
  color: var(--dsw-alias-label-primary) !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)) !important;
}

/* 页签内容 */
.kr-tool-detail__content {
  display: flex;
  flex-direction: column;
}

.kr-tool-detail__section {
  display: flex;
  flex-direction: column;
}

/* 代码/文本框 */
.kr-tool-code-box {
  border-radius: 7px;
  border: 1px solid var(--kr-card-border);
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.2));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.kr-tool-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--kr-hover-bg);
  border-bottom: 1px solid var(--kr-card-border);
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

.kr-tool-copy-btn {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  cursor: pointer;
  padding: 1px 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s;
}

.kr-tool-copy-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.15));
  color: var(--dsw-alias-label-primary);
  border-color: var(--kr-card-border);
}

.kr-tool-code-pre {
  margin: 0;
  padding: 8px 10px;
  font-size: 11.5px;
  line-height: 1.5;
  font-family: var(--ds-font-family-code, monospace);
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}

.kr-tool-path-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11.5px;
}

.kr-tool-path-label {
  color: var(--dsw-alias-label-tertiary);
}

.kr-tool-path-code {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--kr-surface-bg);
  border: 1px solid var(--kr-card-border);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  word-break: break-all;
}

.kr-tool-empty-note {
  padding: 8px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
}

/* 底部操作条 */
.kr-tool-detail__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--kr-card-border) 60%, transparent);
}

.kr-tool-footer-btn {
  background: var(--kr-surface-bg);
  border: 1px solid var(--kr-card-border);
  color: var(--dsw-alias-label-secondary);
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}

.kr-tool-footer-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.15));
  color: var(--dsw-alias-label-primary);
  border-color: var(--kr-card-hover);
}

.kr-tool-footer-btn--link {
  color: var(--dsw-alias-label-secondary);
  border-color: var(--kr-card-border);
  background: var(--kr-surface-bg);
}

.kr-tool-footer-btn--link:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.15));
  color: var(--dsw-alias-label-primary);
  border-color: var(--kr-card-hover);
}

/* 失败提示条（只陈述失败原因，不提供重试动作） */
.kr-fail-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--kr-hover-bg);
  border: 1px solid var(--kr-card-border);
  display: flex;
  align-items: center;
  gap: 10px;
}

.kr-fail-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

/* ══ 执行结果卡片 ══════════════════════════════════════════════════════════ */
.kr-result-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.kr-result-icon {
  color: var(--dsw-alias-label-secondary);
  flex: none;
}

/* ══ 标签行最右侧的「Agent 轨迹大盘」开关 ══════════════════════════════════
   座位是 header [role="tablist"] 的最后一个子节点：margin-left:auto 把它顶到
   KR对话 / 对话 / 轨迹 这一行的最右端，与三个 tab 同行、同基线。
   （旧版 .kr-expand-capsule 是 position:absolute + 阴影 + backdrop-filter 的
   浮动胶囊，浮在正文右上角压内容；这里改为行内座位，不再悬浮。）

   常态一律中性灰、无底色：开/关不靠颜色区分（用户明确不要这里出现颜色），
   大盘在不在屏幕上本身就是状态指示，开关只提供 hover 反馈与 tooltip 文案。 */
.kr-panel-toggle {
  margin-left: auto;
  align-self: center;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: color .18s ease, background-color .18s ease, border-color .18s ease;
}

.kr-panel-toggle svg {
  width: 15px;
  height: 15px;
  flex: none;
  color: currentColor;
}

.kr-panel-toggle:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .12));
}

.kr-panel-toggle:focus-visible {
  border-color: var(--kr-accent);
}

@media (prefers-reduced-motion: reduce) {
  .kr-panel-toggle { transition: none; }
}

@keyframes kr-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ══ 记忆卡片停靠区（固定右栏底部）═══════════════════════════════════════
   记忆卡不再是 .kr-panel__scroll 的子节点，而是滚动区之下的独立 flex footer：
   滚动区（flex:1 1 0）高度自动让位，记忆卡永远钉在右栏最下方——无论内容
   多少、无论滚动位置。旧方案是滚动区内的 sticky bottom:0，内容少时卡片
   跟在三张卡后面悬在中间，做不到「永远在下方」，已废弃。 */
.kr-panel__memory-dock {
  flex: none;
  padding: 0 12px 12px;
  /* 同样透明：footer 只是把记忆卡钉在下方，不该自己带一块底色。 */
  background: var(--kr-canvas-bg);
  display: flex;
  flex-direction: column;
}

/* 记忆卡「没有本会话新增就整卡不渲染」时，dock 里一个子节点都不剩。
   用 :empty 收掉 footer 的 padding —— 不必让父级再存一份「记忆卡可见吗」的
   状态来回同步（那会让父级成为子组件的镜像，早一帧晚一帧都闪）。 */
.kr-panel__memory-dock:empty {
  display: none;
}

.kr-memory__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kr-memory__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.kr-memory__section + .kr-memory__section {
  border-top: 1px solid var(--kr-hairline);
  padding-top: 8px;
}

/* 分区行：只做说明，不再承担交互（原来的「展开其余 / 选择」两枚按钮分别
   下沉到列表底部与行尾操作区）。小圆点是唯一的分区标识，比一条分割线轻。 */
.kr-memory__section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-left: 2px;
}

.kr-memory__section-head::before {
  content: '';
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  /* var() 必须自带 fallback：color-mix() 的第一个分量一旦求值失败，整条
     background 就作废（不是回落成 transparent，而是什么都不画），圆点会
     悄无声息地消失。 */
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8b8f96) 55%, transparent);
}

.kr-memory__section-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kr-memory__count {
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary);
}

/* 工作区别名的副标题（目录名/项目别名），超出省略 */
.kr-memory__scope {
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 文字按钮（行内确认的「确认 / 取消」） */
.kr-memory__link {
  flex: none;
  background: transparent;
  border: none;
  border-radius: 4px;
  padding: 1px 5px;
  font-family: inherit;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.kr-memory__link:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
}

/* 删除/确认：主操作，但刻意不做成红色实心——大盘整体是中性灰，
   破坏性操作靠「二次确认」而不是靠颜色吓人。 */
.kr-memory__link--danger {
  color: var(--dsw-alias-label-primary);
  background: var(--kr-fill-bg);
  border: 1px solid var(--kr-card-border);
}

.kr-memory__link:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 「删除？」提示：确认态里给用户看清楚即将发生什么 */
.kr-memory__ask {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}

/* 列表底部居中的「展开其余 N 条 / 收起」 */
.kr-memory__more {
  align-self: center;
  margin-top: 2px;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.kr-memory__more:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.kr-memory__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  /* 兜底封顶：展开「其余 N 条」后也不允许把右栏顶穿，超出在内部滚动。
     与 SECTION_PREVIEW_COUNT 成对维护（6 条 ≈ 半屏）—— 记忆卡常驻钉在
     右栏底部，给到 92vh 时它会自己吃掉整个右栏、思考卡被挤到最小档。 */
  max-height: 40vh;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, 0.4)) transparent;
}

/* 挤压态：思考卡已被压到最小档、右栏仍然装不下时，记忆卡自己再让一档，
   绝不上涨把思考卡彻底顶没（用户要的是「都能看见」而不是「记忆卡看全」）。 */
.kr-card--memory[data-squeezed="true"] .kr-memory__list {
  max-height: 26vh;
}

/*
 * 单条记忆行：正文列 + 行尾操作列两段。
 *
 * 原来行首那条永远空着的 11px 置顶槽已经删掉——置顶收进属性行后，未置顶的行
 * 左侧不再留一个「为了对齐而存在」的空位，正文可以真正贴齐左边缘。
 */
.kr-memory__row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 6px 6px 5px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.12s ease, box-shadow 0.18s ease;
  animation: kr-memory-row-in 0.26s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.kr-memory__row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.07));
}

/* 确认删除态：只有这一行亮起来（描边 + 极淡填充），其余行保持原样——
   一次只确认一条，界面上「正在删什么」必须一眼可见。 */
.kr-memory__row[data-confirming="true"] {
  background: var(--kr-fill-bg);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-secondary, #6b6f76) 22%, transparent);
}

@keyframes kr-memory-row-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 行尾操作列：时间常态在，删除键 hover/聚焦才浮现（带一点右移，读起来像
   「从行边滑出来」而不是突然出现）。 */
.kr-memory__side {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  align-self: center;
  min-height: 20px;
}

.kr-memory__act {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  opacity: 0;
  transform: translateX(3px);
  transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.15s ease, color 0.15s ease;
}

.kr-memory__row:hover .kr-memory__act,
.kr-memory__act:focus-visible {
  opacity: 1;
  transform: translateX(0);
}

.kr-memory__act:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.16));
  color: var(--dsw-alias-label-primary);
}

/* 触屏没有 hover，删除键常显（否则永远点不到） */
@media (hover: none) {
  .kr-memory__act {
    opacity: 1;
    transform: none;
  }
}

.kr-memory__body-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* 单条默认 1-2 行 + 省略号：默认全展开会把大盘撑爆，全文点条目再看 */
.kr-memory__text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
  word-break: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.kr-memory__text[data-open="true"] {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}

.kr-memory__meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

/* 相对时间推到行尾：徽章（类型/标签）靠左，时间靠右，一行两端各有归属，
   不再挤成一坨灰色小字。 */
/* 时间已移到行尾操作列（.kr-memory__time--side），这里只保留基础字号色 */
.kr-memory__time {
  flex: none;
  font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* 置顶星标：属性行里一枚可点小星（点一下取消置顶）。置顶的完整入口在 triad
   记忆面板，右栏只做「看见 + 撤销」。 */
.kr-memory__flag {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}

.kr-memory__flag:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary);
}

.kr-memory__flag:active {
  transform: scale(0.9);
}

.kr-memory__tag {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--kr-hover-bg);
  color: var(--dsw-alias-label-tertiary);
}

.kr-memory__note {
  padding: 4px 2px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
}

/* 行内错误（删除失败等）：不动用模态弹窗，也不打断阅读 */
.kr-memory__err {
  padding: 2px 6px 3px;
  font-size: 11px;
  color: var(--dsw-alias-label-primary);
}

@media (prefers-reduced-motion: reduce) {
  .kr-memory__row { animation: none; transition: background-color 0.12s linear; }
  .kr-memory__act { transition: opacity 0.12s linear; transform: none; }
  .kr-memory__flag:active { transform: none; }
  .kr-memory__more { transition: color 0.12s linear, background-color 0.12s linear; }
}

/* ══ KR 极简 Agent 状态卡：只显示一句当前动作 + 可配置头像 ═══════════════ */

/*
 * 这张卡整体浮在对话流里，不在右栏大盘的变量作用域内，所以变量要在壳子根上
 * **重声明一次**，不能直接吃 :root 那套。
 *
 * 原因是一个很容易静默翻车的求值位置问题：:root 是 html，而 DSH 的设计 token
 * （--dsw-alias-*）定义在 body 上。写在 :root 的 --kr-card-bg 引用
 * --dsw-alias-bg-layer-1 时，在 html 上求值根本找不到那个 token，于是走 fallback
 * —— 深色下卡片照样纯白，看不出任何报错，只是主题「没同步」。
 * 壳子是 body 后代，body 上的 token 一律可见，在这里重声明才能拿到真值。
 */
.kr-agent-mini-shell {
  --kr-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --kr-success: var(--dsw-alias-state-success-primary, #22c55e);
  --kr-card-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --kr-card-border: var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
  --kr-hover-bg: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  /*
   * 两张卡的文字跟随 DSH 正文字体栈，不另起炉灶。
   *
   * 这里曾经写死微软雅黑（"Microsoft YaHei UI" 优先），理由是 11–13px 下笔画更
   * 均匀。代价是这两张卡被从正文里割了出去：正文栈在 Windows 上第一命中是
   * Segoe UI（只覆盖西文/数字/半角标点，中文才回落到微软雅黑），于是同一屏里
   * 英文缩写、数字、年份括号出现两种字形，右栏大盘四张卡也因为没声明而吃正文栈
   * ——同一功能里三套字体，割裂感比"笔画粗细不均"明显得多。
   *
   * 统一到 var(--dsw-font-family) 后：卡片、左栏正文、右栏大盘全走同一个栈，
   * 且 DSH 主题若调整正文字体，卡片自动跟随，不需要在这里二次维护。
   *
   * 变量本身保留、子节点仍各自声明一次（不再只靠继承），是为了跟 DSH 正文选择器
   * 的具体度解耦——万一官方给 [data-chat-turn] 下的元素加过 font-family，
   * 显式声明能保证卡片不被盖回去。
   */
  --kr-card-font: var(--dsw-font-family);
  font-family: var(--kr-card-font);
}
  /* 浮层卡在对话流里是唯一的「浮起」层，投影要真能把它从正文里托起来：
     贴地一层 0.5px 接触影 + 中层 6px 柔影 + 底层 28px 大范围落影，三层叠出高度。 */
  --kr-float-shadow:
    0 1px 2px rgba(15, 17, 21, .05),
    0 3px 8px -2px rgba(15, 17, 21, .12),
    0 14px 30px -14px rgba(15, 17, 21, .32);
}

body[data-ds-dark-theme] .kr-agent-mini-shell {
  --kr-card-border: rgba(255, 255, 255, 0.07);
  /* 深色下靠更黑的落影分层，浅色那套暖灰在黑底上等于没有影子。 */
  --kr-float-shadow:
    0 1px 2px rgba(0, 0, 0, .55),
    0 3px 10px -2px rgba(0, 0, 0, .5),
    0 16px 34px -16px rgba(0, 0, 0, .9);
}

/*
 * 只剩状态卡一张了，壳子退化成单列 grid：宽度仍锁 500px，justify-self 让卡片
 * 贴左，不跟文字长度走。原来给「状态卡 + 展开进度卡」预留的 490px 高度预算
 * 一并去掉——单行 50px 的卡永远碰不到它，留着只是误导下一个人。
 */
.kr-agent-mini-shell {
  position: relative;
  display: grid;
  grid-template-rows: 1fr;
  grid-template-columns: minmax(0, auto);
  justify-content: start;
  width: 100%;
  min-width: 0;
  max-width: min(100%, 500px);
  margin: -4px 0;
  overflow: visible;
}

.kr-agent-mini-card {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  /*
   * 状态卡恒定 500px：不跟文字长度走，也不跟字号档走。任何一处变化都会让它在
   * 对话流里抽一下，比宽度本身更难受。
   * 只保留 min() 是为了窄容器（小于 500px 的分栏/手机宽度）不横向溢出。
   */
  justify-self: start;
  width: min(500px, 100%);
  /*
   * 高度也锁死，不写 min-height：min-height 会被内容顶高，长动作名或放大字号就能
   * 把卡片撑高一格——那正是「卡片一直变」的另一半。定高 + overflow hidden 让它
   * 永远就是 50px，文字多长都在里面裁掉。
   */
  height: 50px;
  overflow: hidden;
  padding: 7px 14px 7px 7px;
  border: 1px solid var(--kr-card-border);
  border-radius: 14px;
  background: var(--kr-card-bg);
  box-shadow: var(--kr-float-shadow);
  transform-origin: 0 50%;
  animation: kr-agent-mini-in .38s cubic-bezier(.16, 1, .3, 1) both;
}

/*
 * 刻意没有 :hover 规则。
 *
 * 这张卡在对话流里长时间停留，任何随指针变化的视觉（边框变色、底色、阴影）
 * 都会被读成「卡片一直在变」。它也不再是可点的：原先点击展开的那张执行进度卡
 * 已经移除，内容全部由右栏大盘承接，展开交互连同 chevron 一起删干净。
 * 要变的只有里面的文字——动作名与那道扫过去的灰光。
 */

/*
 * 收口态只降透明度，不位移：位移会让整张卡在对话流里滑动，是「卡片在变」最
 * 刺眼的一种。透明度是这条生命周期里唯一保留的反馈。
 */
.kr-agent-mini-shell[data-closing="true"]:not([data-committed="true"]) .kr-agent-mini-card {
  opacity: .42;
}

.kr-agent-mini-shell[data-closing="true"][data-committed="true"] {
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  overflow: hidden;
  pointer-events: none;
  animation: kr-agent-mini-exit 980ms cubic-bezier(.22, 1, .36, 1) both;
}

.kr-agent-mini-avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  overflow: visible;
  border: 1px solid color-mix(in srgb, var(--kr-accent) 18%, var(--kr-card-border));
  border-radius: 50%;
  padding: 0;
  background: color-mix(in srgb, var(--kr-accent) 7%, var(--dsw-alias-bg-layer-1));
  color: var(--kr-accent);
  cursor: pointer;
  transition: border-color .16s ease, transform .16s ease;
}

.kr-agent-mini-avatar:hover {
  border-color: color-mix(in srgb, var(--kr-accent) 42%, var(--kr-card-border));
}

.kr-agent-mini-avatar:active {
  transform: scale(.96);
}

.kr-agent-mini-avatar:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--kr-accent) 52%, transparent);
  outline-offset: 2px;
}

.kr-agent-mini-avatar > img,
.kr-agent-mini-avatar__default {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.kr-agent-mini-avatar > img {
  display: block;
  object-fit: cover;
}

.kr-agent-mini-avatar__default {
  display: grid;
  place-items: center;
}

.kr-agent-mini-avatar__default svg {
  width: 23px;
  height: 23px;
}

.kr-agent-mini-avatar__status {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
  border-radius: 50%;
  background: var(--kr-accent);
  animation: kr-agent-mini-pulse 1.6s ease-in-out infinite;
}

/*
 * 动作名与末尾三点同一行。必须 flex：动作名是 display:block + max-content，
 * 块级盒会吃满整行宽度，三点就被挤到下一行去（overflow:hidden 再一裁，整组直接
 * 看不见）。改成 flex row 后动作名按内容宽度收缩、三点跟在后面。
 */
.kr-agent-mini-copy {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

/*
 * 状态卡动作文字的运行信号，拆成互不重叠的两层：
 *
 *   1. **换字时交叉淡入淡出**（kr-agent-action-in / -out）
 *      动作名一变，旧层保留着向上淡出、新层同时向下淡入，两层叠在同一个 grid
 *      格里，任何一帧都有字——这就是「平滑」。此前是靠 key={action} 重建节点 +
 *      一次性入场动画，那条路做不到平滑：旧节点先被卸载（瞬间消失），新节点再
 *      淡入，中间必然空一帧，读起来是「闪了一下」。
 *      早先更早一版是 background-clip: text 的光带扫过整行，那条路必须 paint：
 *      background-position 走不了合成器，每一帧都要真重绘一行文字。
 *
 *   2. **等待时末尾三点加载器**（kr-agent-dots，只在 data-running 时）
 *      三颗 3.5px 圆点依次亮起再依次暗下去，周期 1.2s，每颗错开 1/3 周期。
 *      只动 opacity、合成器属性、零 paint；渐变往返而不是硬切（硬切是信号灯，
 *      渐变才像"还在动"）。这是 Notion / Ant Design / Apple 那一套最通用的语汇，
 *      语义直给——"还有内容要出来"。
 *
 * 两层都只提交合成器属性，不碰文字栅格化；页面隐藏时插件的全局节流会全部暂停。
 * 要彻底不要常驻动效的话，删掉第 2 层即可，第 1 层不依赖它。
 */

/*
 * 叠放容器。grid 而不是绝对定位：绝对定位的退场层会脱离布局、交叠期容器宽度
 * 只由新层决定，退场中的长文字会被新层的窄宽度裁出一道断口。grid 下各层共同
 * 参与固有宽度计算，容器取最宽的一层，交叉期间谁都完整。
 *
 * flex item 给 0 1 auto：按内容收缩（右侧不留空），空间不足时可压缩。
 */
.kr-agent-mini-action-stack {
  display: inline-grid;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  flex: 0 1 auto;
}

.kr-agent-mini-action {
  font-family: var(--kr-card-font);
  /* 所有层占同一格，才是叠放而不是排列。 */
  grid-area: 1 / 1;
  /*
   * grid item 默认 min-width:auto，会拒绝收缩到内容宽度以下，长动作名把三点挤出
   * 容器。这里给 min-width:0 + overflow:hidden，让文字在需要时正常裁掉，
   * 三点始终留在可见范围内——它才是"还在跑"的信号，不能被长文本挤没。
   */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary);
  font-size: calc(13px * var(--kr-text-scale, 1));
  /* 550 → 500：非标准字重在 Segoe UI / 雅黑 上没有对应字面，浏览器只能合成或
     就近取整，跨字体栈时粗细还不一样（跟随正文栈后这条更明显）。落到 500 后
     全卡与右栏大盘同一档粗细。 */
  font-weight: 500;
  line-height: calc(20px * var(--kr-text-scale, 1));
  white-space: nowrap;
}

/*
 * 进场：新字从下 2px 升上来并淡入，延迟 70ms 才开始——让旧字先走一点，两段
 * 交叠，中间不空。位移只走 2px，够读出「新内容落位」又不晃眼。
 */
.kr-agent-mini-action[data-phase="in"] {
  animation: kr-agent-action-in 180ms cubic-bezier(.22, 1, .36, 1) 70ms both;
}

/* 出场：旧字往上 2px 淡出，交给 JS 在 250ms 时卸载。 */
.kr-agent-mini-action[data-phase="out"] {
  animation: kr-agent-action-out 200ms cubic-bezier(.4, 0, .2, 1) both;
  /* 退场层不接收指针，也不该被复制/选中。 */
  pointer-events: none;
  user-select: none;
}

@keyframes kr-agent-action-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}

@keyframes kr-agent-action-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(-2px); }
}

/*
 * 末尾三点。必须是三个独立元素：opacity 动画打在同一个元素上时三颗会一起亮，
 * 错峰就没了。用 ::after 伪元素只能凑出两颗，所以这三颗由 TSX 显式渲染。
 *
 * 尺寸 3.5px、间距 .34em（约 1.2px）：三颗之间留得住缝才不会糊成一横，整体
 * 又不超过一个汉字的宽度，不至于把动作名挤到换行。
 *
 * 整组只在 data-running 时挂动画：停下来的卡上不留任何动画，也就不存在
 * "页面静止时还在空转"这件事。
 */
.kr-agent-dots {
  display: inline-flex;
  align-items: center;
  gap: .34em;
  /* 文字与点之间留一道呼吸，比紧贴更像"后面还有"而不是"文字的一部分"。 */
  margin-left: .38em;
  flex: none;
  transform: translateY(.08em);
}

.kr-agent-dots > i {
  width: 3.5px;
  height: 3.5px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, currentColor);
  will-change: opacity;
}

.kr-agent-mini-copy[data-running="true"] .kr-agent-dots > i {
  animation: kr-agent-dots 1.2s ease-in-out infinite;
}

.kr-agent-mini-copy[data-running="true"] .kr-agent-dots > i:nth-child(2) { animation-delay: .4s; }
.kr-agent-mini-copy[data-running="true"] .kr-agent-dots > i:nth-child(3) { animation-delay: .8s; }

/*
 * 三点共用一条关键帧，亮 → 暗 → 亮一轮 1.2s。
 *
 * opacity 区间压到 .3–1 而不是 0–1：到 0 会让点"消失"再"出现"，读起来是闪烁
 * 而非呼吸；.3 保留存在感，低调又不抢动作名。三颗靠 0.4s（= 1/3 周期）错开，
 * 形成一道波从左滚到右。
 *
 * 只动 opacity，合成器属性、零 paint；页面隐藏时全局节流会暂停它。
 */
@keyframes kr-agent-dots {
  0%, 100% { opacity: .3; }
  50% { opacity: 1; }
}

/* ══ 流式文本的平滑显影 ═══════════════════════════════════════════════════
 *
 * 思考流是按块到达的，一整行字常在同一次更新里凭空出现。KrFreshText 把文本
 * 切成「已稳定前缀 + 本次新增段」，只让新增段显影一次，旧内容不重播。
 *
 * 新增段是**一个** span 配一道自左向右的擦除 mask，不逐字拆 span：逐字 span 会
 * 把每个字符切成独立文本 run，中文的标点挤压 / 字距调整 / 连字全被边界打断，
 * 「，」「。」后面拖出一截全角空隙，整段读起来字体很别扭。节点数也同时从几千
 * 降到 2。
 */
.kr-fresh-run {
  display: inline;
  /*
   * 显影用「遮罩层宽度从 0 长到 100%」实现，而不是在 linear-gradient 的色标
   * 里写 calc(var(--kr-wipe) - 4%)：自定义属性在色标位置接不上（实测 computed
   * 解析成 calc(-4%)，色标顺序非法，整条 gradient 失效，文字整段不可见）。
   * mask-size 是标准可插值属性，0% -> 100% 干净利落，语义一样——黑色遮罩铺
   * 过去，内容就自左向右被写出来。
   */
  -webkit-mask-image: linear-gradient(90deg, #000 0 100%);
  mask-image: linear-gradient(90deg, #000 0 100%);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 0% 100%;
  mask-size: 0% 100%;
  animation: kr-fresh-wipe .38s cubic-bezier(.33, .66, .36, 1) both;
}

@keyframes kr-fresh-wipe {
  from {
    -webkit-mask-size: 0% 100%;
    mask-size: 0% 100%;
  }
  to {
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
  }
}

.kr-fresh-stable {
  display: inline;
}

/* 官方 turn-process 行是固定高度且 overflow:hidden；菜单必须 portal 到 body，
   再用 fixed + 动态 left/top 定位，否则整块菜单会被对话行裁掉。 */
.kr-agent-avatar-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1300;
  display: grid;
  gap: 3px;
  width: 188px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  box-sizing: border-box;
  /* 菜单 portal 到 body，不在 .kr-agent-mini-shell 里，拿不到壳子上那套 --kr-*，
     所以直接引 DSH 的语义 token（body 作用域，两套主题都拿得到真值）。 */
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
  border-radius: 9px;
  padding: 8px;
  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
  box-shadow: 0 10px 28px rgba(15, 17, 21, .10);
  transform-origin: 0 0;
  animation: kr-agent-avatar-menu-in .14s cubic-bezier(.2, .8, .2, 1);
}

body[data-ds-dark-theme] .kr-agent-avatar-menu {
  box-shadow: 0 10px 28px rgba(0, 0, 0, .55);
}

.kr-agent-avatar-menu__title {
  padding: 2px 4px 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
}

.kr-agent-avatar-menu__action {
  width: 100%;
  border: 0;
  border-radius: 5px;
  padding: 7px 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.kr-agent-avatar-menu__action:hover:not(:disabled) {
  /* 菜单 portal 到 body，拿不到壳子上的 --kr-hover-bg；直接用 DSH 的中性交互色，
     两套主题都拿得到真值，hover 反馈不会再静默失效。 */
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  color: var(--dsw-alias-label-primary);
}

.kr-agent-avatar-menu__action:disabled {
  opacity: .42;
  cursor: default;
}

.kr-agent-avatar-menu__action:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--kr-accent) 48%, transparent);
  outline-offset: -1px;
}

.kr-agent-avatar-menu__hint,
.kr-agent-avatar-menu__error {
  padding: 4px 4px 1px;
  font-size: 10px;
  line-height: 14px;
}

/* 分节：头像操作之后接字号档位，一眼能看出这是两件事。 */
.kr-agent-avatar-menu__sep {
  height: 1px;
  margin: 5px 2px 7px;
  background: var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
}

.kr-agent-avatar-menu__label {
  padding: 0 4px 5px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
  line-height: 14px;
  font-weight: 600;
  letter-spacing: .02em;
}

/* 字号档位：四档分段。选中态是 accent 描边 + 淡底 + 字重，切换有 0.16s 过渡。 */
.kr-agent-avatar-menu__scaleRow {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
}

.kr-agent-avatar-menu__scale {
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  transition: background-color .16s ease, color .16s ease, border-color .16s ease, transform .16s cubic-bezier(.16, 1, .3, 1);
}

.kr-agent-avatar-menu__scale:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  color: var(--dsw-alias-label-secondary);
}

.kr-agent-avatar-menu__scale:active {
  transform: scale(.94);
}

.kr-agent-avatar-menu__scale[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 42%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 13%, transparent);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.kr-agent-avatar-menu__scale:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 48%, transparent);
  outline-offset: -1px;
}

.kr-agent-avatar-menu__hint {
  color: var(--dsw-alias-label-tertiary);
}

.kr-agent-avatar-menu__error {
  color: var(--kr-error);
}

.kr-agent-avatar-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 仍被 KR 任务卡 / 执行结果卡的行内 spinner 复用。 */
@keyframes kr-spin {
  to { transform: rotate(360deg); }
}

@keyframes kr-agent-avatar-menu-in {
  from { opacity: 0; transform: translateY(-4px) scale(.98); }
  to { opacity: 1; transform: none; }
}

@keyframes kr-agent-mini-in {
  from { opacity: 0; transform: translateY(7px) scale(.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes kr-agent-mini-exit {
  0% { max-height: calc(490px * var(--kr-text-scale, 1)); margin-top: -4px; margin-bottom: -4px; opacity: 1; transform: translateY(0) scale(1); }
  65% { max-height: calc(390px * var(--kr-text-scale, 1)); margin-top: -2px; margin-bottom: -2px; opacity: .92; transform: translateY(-12px) scale(.992); }
  100% { max-height: 0; margin-top: 0; margin-bottom: 0; opacity: 0; transform: translateY(-28px) scale(.985); }
}

@keyframes kr-agent-mini-pulse {
  0%, 100% { opacity: .55; }
  50% { opacity: 1; }
}

@media (max-width: 520px) {
  .kr-agent-mini-shell {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kr-agent-mini-card,
  .kr-agent-mini-action,
  .kr-agent-dots > i,
  .kr-fresh-run,
  .kr-agent-mini-shell[data-closing="true"][data-committed="true"],
  .kr-agent-avatar-menu,
  .kr-agent-mini-avatar__status {
    animation: none !important;
  }
  /*
   * 三点不跳就保持常态不透明度，而不是整组 display: none —— 三个静止的灰点仍然
   * 说明"这里有活动"，和头像右下角那个状态点同属一套语汇；整个抹掉反而丢信息。
   */
  /*
   * 退场层直接不画。正常路径下 useCrossfadeText 在减少动态效果时只产出一层，
   * 根本不会有退场层；但如果用户在交叉过渡进行到一半时才切系统偏好，动画被
   * 上面那条 none 掐掉后，退场层会永远停在 opacity 1，和新层叠成两行重影。
   * 这条是那个时间窗的兜底。
   */
  .kr-agent-mini-action[data-phase="out"] {
    display: none;
  }
}

/* ══ 隐藏原生 DSH 任务列表/Plan卡片（KR模式下收敛至右侧大盘） ═══════════════ */
body[data-dsh-kr-chat="true"] [data-testid="todo-panel"],
body[data-dsh-kr-chat="true"] [data-plan-artifacts="true"],
body[data-dsh-kr-chat="true"] [data-plan-card],
body[data-dsh-kr-chat="true"] [data-chat-flow-kind="plan"] {
  display: none !important;
}
`

/**
 * 注入 KR 对话样式表。
 *
 * 幂等但「可刷新」：DSH 的 client HMR（patchReload: live）会重新执行 apply()，
 * 此时 KR_STYLES 常量可能已经变了；旧实现只认「标签已存在就返回」，新规则永远
 * 进不来，页面上会一直挂着上一版 CSS（表现为新座位完全没有样式）。因此这里
 * 在内容不一致时原地刷新 textContent。
 */
export function injectKrStyles(): void {
  const STYLE_ID = 'dsh-kr-chat-styles'
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing) {
    if (existing.textContent !== KR_STYLES) existing.textContent = KR_STYLES
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = KR_STYLES
  document.head.appendChild(tag)
}
