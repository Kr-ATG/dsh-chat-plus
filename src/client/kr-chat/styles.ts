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

/* 隐藏旧的折叠行与折叠 chip，以及在 KR 模式下左侧隐藏原生工具树与紧凑控制行（详情收敛至右侧大盘）。
   ⚠ [data-turn-process] **不在这张表里**（2026-10-05）：它就是官方那条
   「已完成，用时 13分14秒」的回合过程行 —— 用户点名要的正是官方这个读数，
   而它的官方位置本来就在总结卡正上方。它只渲染那一行按钮，整轮过程内容在
   [data-step-process] 里（仍在隐藏名单中），放行它不会把工具树带回左侧。 */
body[data-dsh-kr-chat="true"] .dts__process,
body[data-dsh-kr-chat="true"] .dts__entry,
body[data-dsh-kr-chat="true"] .dtt__chip,
body[data-dsh-kr-chat="true"] [data-chat-call-id],
body[data-dsh-kr-chat="true"] [data-chat-anchor-key^="call:"],
body[data-dsh-kr-chat="true"] [data-step-process],
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

/*
 * 例外：**含思考过程卡的那条过程链必须放行**。
 *
 * 上面那条规则是为了去掉与答案投影重复的过程正文，代价是把思考卡一起藏了 ——
 * 思考卡（assistant-step 座位上的 KrReasoningCard inline 形态）**只渲染在过程
 * 投影里**：回合进行中官方还没有答案投影（实测 answer 行数 = 0），过程投影是
 * 卡片唯一的 DOM 落点，整块 display:none 就是「KR 对话里看不到思考过程卡」。
 *
 * 放行范围精确到「确实含卡片」的那一条链（顺带命中它的两个祖先容器），一个回合
 * 至多一行 —— 卡片挂在首个带思考的 step 上（见 ThinkingStepNodeView）。其余过程
 * 行（tool-call、别的 step）照旧隐藏，不会把过程正文放回来。
 *
 * ⚠ **不放行 [data-turn-process] 容器本身**。实测过：那条容器是官方整轮的折叠行
 * （标题就是「执行了命令，已读取文件，已搜索代码等」），放行它会把折叠标题一起
 * 露到左侧对话流里 —— 用户看到的第一句话就是「这条怎么又出来了」。卡片所需的
 * 祖先只有下面两个，turn-process 那一层不在卡片链上（卡片在 step 分组里）。
 *
 * 祖先两级缺一不可，实测：
 *   [data-step-process]        每个 step 的过程分组根（.O_Ebla_root），display:none
 *   [data-turn-process-member] 该 step 的投影行（flowItem），display:none
 * 只放成员行、不放分组根，卡片量出来仍是 0×0。
 */
body[data-dsh-kr-chat="true"] [data-step-process]:has(.kr-card--reasoning),
body[data-dsh-kr-chat="true"] [data-turn-process-member]:has(.kr-card--reasoning),
body[data-dsh-kr-chat="true"] [hidden="until-found"]:has(.kr-card--reasoning) {
  display: block !important;
}

/*
 * 例外 2：**含问答卡的那条链也必须放行**。
 *
 * 问答卡（.kr-card--ask）挂在 ask_user_question 的 tool-call 节点上，而 KR 对
 * 工具明细是整类隐藏（上面 [data-chat-call-id] / [data-chat-anchor-key^="call:"]
 * 一条不落）。不放行就等于「模型问了一句、用户答了一句，对话流里什么都没留下」
 * —— 而问答不是工具明细，它是对话本身的一半。
 *
 * 祖先链与思考卡同构（实测一条 tool-call 行的祖先）：
 *   [data-chat-call-id]              调用行本身，KR 隐藏它
 *   [data-turn-process-member]       该 step 的投影行（flowItem）
 *   [hidden="until-found"]           O_Ebla_body（content-visibility:hidden）
 *   [data-step-process]              O_Ebla_root（整块 display:none）
 * 四层缺一不可：少放行任何一层，卡片有盒模型但量出来仍是 0×0。
 */
body[data-dsh-kr-chat="true"] [data-step-process]:has(.kr-card--ask),
body[data-dsh-kr-chat="true"] [data-turn-process-member]:has(.kr-card--ask),
body[data-dsh-kr-chat="true"] [hidden="until-found"]:has(.kr-card--ask),
body[data-dsh-kr-chat="true"] [data-chat-call-id]:has(.kr-card--ask),
body[data-dsh-kr-chat="true"] [data-chat-anchor-key^="call:"]:has(.kr-card--ask) {
  display: block !important;
}

/*
 * 含卡片的那条折叠链：**解除官方的折叠窗限制**。
 *
 * 这里一次解决两件事，因为它们作用在同一个元素上（官方的折叠体 .O_Ebla_body），
 * 分两条规则写只会让"到底在改什么"更难看清。
 *
 * ── 一、content-visibility（"放行了却还是不显示"）──────────────────────────
 * 官方对折叠过程内容用的是 hidden="until-found"，它在 Chromium 里的实现是
 * **content-visibility: hidden**（不是 display:none）——只放行 display 会命中
 * 一个仍被「跳过绘制」的子树：卡片有盒模型但宽高为 0，入场动画停在 0% 帧
 * （kr-card-in 的 both 填充）。
 *
 * ── 二、max-height / overflow（"执行中点开是在内部展开"）───────────────────
 * 官方给折叠体定死了两条：
 *     max-height: min(400px, 50vh)
 *     overflow-y: auto
 * 那是给「一大段过程内容」准备的折叠窗（官方自己的过程行就在里面滚）。但本插件
 * 的卡片是**按回合常驻的内容**，不是可折叠的过程摘要：
 *
 *   进行中 —— 卡片挂在**过程投影**里（官方的答案投影那时还没生成），于是它落在
 *             这个 400px 的滚动窗内。卡片一长（问答卡三四个选项就 240px+、
 *             思考卡 16 行视口 300px+）就超出可视区，用户看到的是「卡片在一个
 *             小框里被截断、要在这个框里滚动」。
 *   收口后 —— 卡片改挂**答案投影**，那条链上**没有**这个折叠容器，所以显示正常。
 *             这正是用户报的"执行过程中在内部展开、结束后就正常了"，两者是同一
 *             个根因的两面。
 *
 * 修法：只给「确实含卡片」的那个折叠体解除限制。**不能全局改 .O_Ebla_body** ——
 * 官方自己的过程内容（工具树、思考摘要）仍需要那个 400px 折叠窗，放开会把整轮
 * 过程正文全部摊到对话流里，那正是 KR 一直避免的事。
 *
 * 官方自己也有这个需求：它的展开态变体就是 max-height:none 加 overflow:visible。
 * 这里等于把含卡片的那个容器按展开态处理，只是不改类名（改类名会与 React 的
 * 调和打架），改用 CSS 覆盖同一组属性。
 *
 * 选择器不认类名（那是「构建 hash + _body」，每次构建都会变），改认两条**稳定
 * 且唯一**的特征，两者必须同时成立：
 *   1. 它是那个带 hidden 折叠标记的折叠体（官方对折叠过程内容一律这么标）；
 *   2. 它里面确实有卡片。
 * 官方自己的折叠体里没有卡片（卡片是插件渲染的），所以这条规则的作用面精确等于
 * 「含卡片的那一个容器」。官方原生的折叠行为（点标题展开/收起、hidden 切换）
 * 一概不动，只是不再在高度上二次裁剪。
 */
body[data-dsh-kr-chat="true"] [hidden="until-found"]:has(.kr-card--reasoning),
body[data-dsh-kr-chat="true"] [hidden="until-found"]:has(.kr-card--ask) {
  content-visibility: visible !important;
  max-height: none !important;
  overflow: visible !important;
  /* 解除限制后不再需要给滚动条留位，留着会让卡片右侧多出一道空白。 */
  scrollbar-gutter: auto !important;
}

/*
 * 放行容器时**只留卡片那一条链**。
 *
 * [data-step-process] 根下面除了卡片所在的 body，官方还挂着一个过程摘要位
 * （实测渲染出「正在分析请求 · 一切明确」这类文案；用户截图里那条
 * 「执行了命令，已读取文件，已搜索代码等」同源）。容器一放行，它就跟着露到
 * 左侧对话流里 —— 收起的分组摘要本来该由插件自己的活动卡与右栏操作面板承接。
 * 所以把不含卡片的直接子元素压回去，容器里只剩卡片行。
 *
 * 两条 :not 都要写：同一 step 里思考卡与问答卡分处不同的直接子元素（思考在
 * assistant-step 上、问答在 tool-call 上），只认一种会把另一种的整条链压掉。
 */
body[data-dsh-kr-chat="true"] [data-step-process]:has(.kr-card--reasoning) > *:not(:has(.kr-card--reasoning)):not(:has(.kr-card--ask)),
body[data-dsh-kr-chat="true"] [data-step-process]:has(.kr-card--ask) > *:not(:has(.kr-card--reasoning)):not(:has(.kr-card--ask)) {
  display: none !important;
}

/*
 * 排重不做样式兜底，全部交给组件侧的 groupPart 判定（进行中只认 reasoning、
 * 收口后只认 response）。
 *
 * 这里曾有一条 [data-chat-group-part="response"] .kr-card--reasoning
 * { display: none } 用来压掉答案投影里的重复卡片。它是错的：**收口后官方
 * 只渲染 response 投影**（历史轮次实测 group part 全是 response，reasoning
 * 一条都没有），那条规则会把历史轮次的思考卡一并删掉 —— 正是「总结完了怎么
 * 查看」看不到的原因。官方的答案行本来就是可见的，不需要额外放行。
 */

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

/* ══ KR 模式下左侧对话流交互（无染色视觉）═════════════════════════════════
   只有**用户自己发的那条消息**是可点入口（点它把右栏大盘切到该轮），所以手掌
   光标也只给它 —— 2026-10-05 用户明确「只有我发送的对话内容才可以点击出来 agent
   大盘，其他不要受到影响，现在总结老是出来一个手掌看着烦人」。
   原来的规则写在 [data-chat-turn] 上（= 整条轮次都可点），于是助手正文、思考卡、
   过程行、总结卡整片都是手掌。现在收窄到 flowKind=user 那一条，并在它内部把文字
   恢复成常规光标（提问里的字仍然可以正常选中复制）。
   [data-chat-flow-kind] 是官方 ChatView 自己注入的（routedNode.kind），不是插件
   造的类名，没有 hash 漂移问题。 */
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-flow-kind="user"] {
  cursor: pointer;
}

body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-flow-kind="user"] p,
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-flow-kind="user"] pre,
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-flow-kind="user"] code,
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-flow-kind="user"] a {
  cursor: text;
}

/* 其余区域一律显式回到默认光标：不依赖「没被规则命中」的隐式结果，
   免得将来有人再加一条宽规则时手掌又铺满整条对话流。 */
body[data-dsh-kr-chat="true"] [data-conversation-scroll] [data-chat-turn]:not([data-chat-flow-kind="user"]) {
  cursor: auto;
}

/* ══ 头部 KR 对话分类标签（与官方原生标签保持完全一致的块级排版与基线） ════════ */
/* padding 与 styles.ts 里 header [role=tablist] > [class*='_tab'] 的覆盖值对齐
   （2px 上 / 8px 下，line-height 16 → 总高 26），三者基线才会真正齐平；
   hover 的 -1px 抬升也跟着官方那两个标签同步，一个动效口径。 */
.kr-tab-btn {
  display: block;
  padding: 2px 0 8px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  cursor: pointer;
  position: relative;
  transition: color .18s ease, transform .18s cubic-bezier(.2, .8, .2, 1);
  color: var(--dsw-alias-label-tertiary);
  outline: none;
  user-select: none;
}

.kr-tab-btn::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 2px;
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
  transform: translateY(-1px);
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

@media (prefers-reduced-motion: reduce) {
  .kr-tab-btn, .kr-tab-btn::after { transition: none; }
  .kr-tab-btn:hover { transform: none; }
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
  /*
   * 三个状态色都走 DSH 的 state-* token，不再写死。
   *
   * 写死有两个问题：一是深色主题下不跟随（深底上该用更亮的绿/红，写死值在
   * 两套主题里都是同一档，亮色主题够亮的那一档到深色就偏暗）；二是对比度不再
   * 由主题系统兜底 —— #10b981 压在 #fff 上约 2.4:1，状态点作为图形没过 AA 的 3:1。
   * 走 token 后这两件事都由 DSH 主题负责，我们只给 fallback。
   * （对话流里那张状态卡早就是 var(--dsw-alias-state-success-primary, #22c55e)，
   * 这里只是对齐同一口径。）
   */
  --kr-success: var(--dsw-alias-state-success-primary, #22c55e);
  --kr-warning: var(--dsw-alias-state-warning-primary, #f59e0b);
  --kr-error: var(--dsw-alias-state-error-primary, #ef4444);
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
  /*
   * 简约滚动条（大盘内所有滚动区共用）。
   *
   * 基底沿用 --dsw-alias-scrollbar-bg-l2（大盘原本就在用它，token 确实存在），
   * 常态压到 52% 不透明：白底上约 #E4E4E4，一根淡灰细线，不跟卡片标题抢
   * 注意力。指针移上去提到 82%（而不是全不透明）——全不透明在 6px 宽的条上
   * 会一下子变成一根黑线，跳变太猛；82% 只够「看清能拖」，且带 180ms 过渡。
   */
  --kr-scrollbar-thumb: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, .4)) 52%, transparent);
  --kr-scrollbar-thumb-hover: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, .4)) 82%, transparent);
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
  /* 深色底上滚动条要更实一点才看得见（浅色那套 52% 在黑底上等于没有）。 */
  --kr-scrollbar-thumb: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, .4)) 66%, transparent);
  --kr-scrollbar-thumb-hover: color-mix(in srgb, var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, .4)) 92%, transparent);
}

.kr-split {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  overflow: hidden;
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

/* 左边缘拖拽手柄：9px 命中区。分隔线去掉后它是右栏唯一剩下的边界线索，
   所以常态透明、悬停/拖拽才亮一条竖线 —— 平时干净，需要时又找得到。
   absolute 覆盖在容器左边缘上（容器 overflow:hidden 已裁剪），不参与 flex。
   命中区从 7px 放宽到 9px：7px 在高 DPI 与触屏上偏窄，「按不中」本身就会
   被当成拖不动。竖线仍然是 1px、仍然落在容器左缘，视觉零变化。 */
.kr-panel__resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 9px;
  cursor: col-resize;
  z-index: 60;
  touch-action: none;
}
/* 全屏态下面板铺满整栏，宽度由 .kr-split__side--fullscreen 的 !important 决定，
   拖拽改不动任何东西 —— 光标与 tab 焦点都收掉，别给一个无效的手柄留诱饵。 */
.kr-split__side--fullscreen .kr-panel__resize-handle {
  display: none;
}
/* 悬停/拖拽时亮一条竖线，提示「这里可以拖」。 */
.kr-panel__resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: transparent;
  opacity: 0;
  transform: scaleY(0.4);
  transform-origin: 50% 50%;
  transition: background 0.18s ease, opacity 0.18s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.kr-panel__resize-handle:hover::before,
.kr-panel__resize-handle:focus-visible::before,
.kr-split__side[data-dragging="true"] .kr-panel__resize-handle::before {
  background: var(--kr-accent);
  opacity: 1;
  transform: scaleY(1);
}

/* 拖拽中的实时宽度读数。
 *
   贴在手柄右侧一点，跟着面板一起动：splitter 的经典反馈 —— 宽度是个「撑出去
   多少」的概念，光看边缘看不出来到底拖到多少，撞上空间上限时更是完全没提示。
   显隐走 [data-dragging] 纯 CSS（不占一次 setState），入场带一点 overshoot 的
   缩放 + 淡入，抬手时反向淡出，跟手柄那条橙线是同一次呼吸。 */
.kr-panel__resize-badge {
  position: absolute;
  top: 50%;
  left: 20px;
  transform: translate(-50%, -50%) scale(0.86);
  z-index: 61;
  pointer-events: none;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.2px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: #fff;
  background: var(--kr-accent);
  box-shadow: 0 6px 18px -6px color-mix(in srgb, var(--kr-accent) 72%, transparent);
  opacity: 0;
  transition: opacity 0.18s ease, transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}
.kr-split__side[data-dragging="true"] .kr-panel__resize-badge {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
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
  /* 10px 12px（原先 12px 14px）：右栏是纵向堆叠的内距敏感区，每张卡上下各
     省的 2px × 三张卡叠起来是一眼能看出的紧凑度。不影响任何可点区域——点击
     热区是整张卡，不依赖 padding。 */
  padding: 10px 12px;
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
  /* 6px（原先 8px）：标题行一行的宽度预算在窄栏下很紧，图标/标题/徽标/
     状态开关这几件东西都靠这个 gap 排开。 */
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

/* 一键删除请求在飞：整行不可折叠（点了也不该把正在退场的列表收起来），
   指针同步退回箭头，避免「能点」的假承诺。 */
.kr-card__header[data-busy="true"] {
  cursor: default;
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

/*
 * 记忆卡标题行的「一键删除」占掉了标题右侧原本由「N 条」独占的位置，窄栏下
 * 标题 + 条数 + 按钮三件东西会挤：让标题可收缩（min-width: 0）并允许省略号，
 * 把空间优先留给两枚固定短文本。这条只对记忆卡生效，其余卡片的标题行没有第三件。
 */
.kr-card--memory .kr-card__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 操作面板的标题不再需要「不占满剩余宽度」这条覆盖（已删）。
 *
 * 原来 .kr-card__title 的 flex:1 是为「标题 + 右侧那件东西」准备的：标题行右边
 * 曾跟着折叠态那行动作文字，标题要是不让出弹性空间，那句话只能被挤到换行或省略。
 * 标题行右侧的内容（那句人话、「N 步」徽标、「技术细节」开关）现已全部删除，
 * 标题独占一行，flex:1 与其余卡片完全一致——这条覆盖连同它的理由一起删干净，
 * 留着只会让人以为这里还有右侧元素。
 */

/*
 * 标题行右侧的补充说明（任务概览的进度、记忆卡的条数）：**纯文字**，无底色。
 *
 * 原来是一枚带底色的胶囊徽标。三张卡各挂一枚，右栏从上到下就是一列色块——
 * 每张卡都在标题右侧挂一枚东西，扫读时先看到的是那列色块而不是标题。信息
 * 本身（3/5 完成、3 条）弱一级字色就够读，不需要底色来喊。
 *
 * flex: none + nowrap 的理由与被它替代的徽标一致：固定短文本不参与收缩，
 * 否则窄栏里「2 步」会被压成一个字宽（min-width:auto → min-content）而竖排。
 * 省略交给旁边可压缩的标题或动作名。
 */
.kr-card__meta {
  flex: none;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  transition: color .18s ease;
}

.kr-card__header:hover .kr-card__meta {
  color: var(--dsw-alias-label-secondary);
}

/*
 * 展开/收起箭头（.kr-card__chevron）已整块删除：DOM 节点与其样式一起不再渲染。
 *
 * 它常驻在每张卡标题行的最右端，五张卡一列下来就是一排同样的灰 V；而它传达的
 * 信息只有「这行能点」，等指针落到卡片上，整卡上浮 1px + 阴影加深 + 指针变手型
 * 三个反馈已经同时出现。先试过「常态隐藏、hover 才淡入」，仍被嫌碍眼 —— 索性连
 * 元素一起删干净，标题行只剩内容本身。
 *
 * 折叠 / 展开能力一点没少：点击热区从来都是整行 .kr-card__header（cursor: pointer
 * + onClick 切换），箭头只是装饰。记忆卡另有文字提示（「N 条」徽标），
 * 其余卡片靠整卡上浮提示可点。
 */

/* ══ 任务概览卡片（单卡片原生极简设计）═════════════════════════════════════ */
/* 任务概览：内距与 .kr-card 对齐即可，这条曾经单开 12px 14px，
   在「空态只留一行头」之后它已无额外内容要容纳。 */
.kr-card--task {
  padding: 10px 12px;
}

/*
 * 折叠热区的键盘焦点环。头部本就是 cursor:pointer 的整行热区（role=button），
 * 补上 :focus-visible 才满足键盘可达——与大盘拖拽手柄的 WCAG 口径一致。
 * outline 画在头部行内（负偏移），不随 .kr-card:hover 的 transform 漂移。
 */
.kr-card--task .kr-card__header:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
  border-radius: 6px;
}

/*
 * 口径小标「会话清单」：只在回溯到会话最近清单时出现。
 * 刻意比 .kr-card__meta 更弱——它是解释性信息，不是数据本身；描边式胶囊
 * 无底色，避免标题行右侧又长出一列色块（徽标教训见 .kr-card__meta 注释）。
 */
.kr-task-scope {
  flex: none;
  white-space: nowrap;
  /* 口径小标：字级跟随官方字号轴（见「字号轴」段）。行高随之缩放：
     基准 10px 字配 14px 行高（比例 1.4）。 */
  font-size: var(--kr-fs-10, 10px);
  font-weight: 500;
  line-height: calc(14px + var(--dsh-content-font-delta, 0px) * 1.4);
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid var(--kr-card-border);
  color: var(--dsw-alias-label-tertiary);
}

/* 极简细平滑进度条（2.5px，轻量雅致，不割裂界面）。
   三态配色（data-running / data-done 挂在轨道上）：
   · 静止推进中 → 灰（旧默认，中性）；
   · 轮次运行中 → 品牌蓝 + 循环流光 sheen，一眼区分「还在跑」；
   · 全部完成   → 品牌蓝静止，与完成态的对勾同色系呼应。
   颜色过渡走 background-color .3s，运行/停止切换不硬闪。 */
.kr-task-progress-line {
  position: relative;
  height: 2.5px;
  background: var(--kr-fill-bg);
  border-radius: 999px;
  overflow: hidden;
  margin: 4px 0 6px;
}

.kr-task-progress-line__fill {
  position: relative;
  height: 100%;
  background: var(--dsw-alias-label-secondary, #61666b);
  border-radius: 999px;
  overflow: hidden;
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1),
              background-color 0.3s ease;
}

.kr-task-progress-line[data-running="true"] .kr-task-progress-line__fill,
.kr-task-progress-line[data-done="true"] .kr-task-progress-line__fill {
  background: var(--dsw-alias-state-business-primary, #4176e6);
}

/*
 * 流光 sheen：一段高光从左到右循环扫过填充条，仅运行中显示。
 * 2.5px 高的轨道上流光是「一丝光在走」，不是探照灯——透明度压低、周期 1.6s。
 * 常驻子元素 + 轨道上的 data-running 控制显隐：避免 React 挂/摘节点时
 * 动画从第一帧重启造成的节奏跳变。
 */
.kr-task-progress-line__sheen {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    100deg,
    transparent 20%,
    rgba(255, 255, 255, 0.55) 50%,
    transparent 80%
  );
  transform: translateX(-100%);
  opacity: 0;
  pointer-events: none;
}

.kr-task-progress-line[data-running="true"] .kr-task-progress-line__sheen {
  opacity: 1;
  animation: kr-task-sheen 1.6s linear infinite;
}

@keyframes kr-task-sheen {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}

/*
 * 全部完成的一次性光脉冲：allDone 跳变时组件挂 data-flash 900ms。
 * 用 box-shadow 扩散而不是 scale——2.5px 的轨道 scaleY 会失真，
 * 阴影脉冲在细条上是「亮了一下」的自然读感。
 */
.kr-task-progress-line[data-flash="true"] {
  animation: kr-task-done-pulse 0.9s cubic-bezier(0.16, 1, 0.3, 1) 1;
}

@keyframes kr-task-done-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 45%, transparent); }
  60% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 22%, transparent); }
  100% { box-shadow: 0 0 0 5px transparent; }
}

/* 任务列表 */
.kr-task-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/*
 * 空态文案行已删：徽标现在直接说「本轮还没有任务」，正文再写一遍
 * 「本轮还没有任务清单」是同一句话占两行。空态只剩一行头，位置依然稳定
 * （卡片不整张消失），信息也依然在。规则留着备用：将来若要恢复独立空态
 * （比如给一行引导操作），把 .kr-task-empty 挂回列表区即可。
 */
/* 空态：进度说明（纯文字）弱一档，不必再单独压暗。 */

/* 任务行落位：首条 34ms、逐条错峰，读作「步骤在铺开」而不是整张卡突然出现。
   position:relative + isolation 是给两个覆盖层准备的：完成淡闪（__flash）与
   进行中呼吸（::before/::after）都画在行内、不占布局，也不动行自身的
   animation 声明——class 切换会重置行的动画列表，把入场动画重播一遍。 */
.kr-task-item {
  position: relative;
  isolation: isolate;
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

/*
 * 进行中行的呼吸强调：左侧 2px 品牌色竖条 + 底色缓慢脉动。
 * 两层都是伪元素覆盖层（z-index:-1 垫在内容之下、行内 isolation 兜底），
 * hover 的 background 仍然正常叠显，互不打架。
 * 竖条用 transform:scaleY 从中心展开，行高变化时不拉伸变形。
 */
.kr-task-item--in_progress::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-state-business-primary, #4176e6);
  transform: scaleY(1);
  animation: kr-task-bar-in .28s cubic-bezier(.16, 1, .3, 1) both;
  z-index: -1;
}

@keyframes kr-task-bar-in {
  from { transform: scaleY(0); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}

.kr-task-item--in_progress::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 7%, transparent);
  animation: kr-task-breathe 2.2s ease-in-out infinite;
  z-index: -1;
  pointer-events: none;
}

@keyframes kr-task-breathe {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

/* 停滞行（轮次已停仍挂「进行中」）：整体退一档，无呼吸无竖条——
   它是待收口的残留事实，不是活体。灰化但不划掉：任务本身还没做完。 */
.kr-task-item--stalled .kr-task-item__content {
  color: var(--dsw-alias-label-tertiary);
}

/* 完成瞬间的一次性底色淡闪：品牌色底 0→亮→0，播完由组件摘除节点。
   与对勾 pop 同一时刻发生，读作「这条刚打勾」。 */
.kr-task-item__flash {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 14%, transparent);
  animation: kr-task-flash .45s ease-out 1 both;
  pointer-events: none;
  z-index: -1;
}

@keyframes kr-task-flash {
  0% { opacity: 0; }
  30% { opacity: 1; }
  100% { opacity: 0; }
}

.kr-task-item__icon {
  /* 状态圆圈：尺寸随官方字号轴放大（见「字号轴」段）。StatusIcon 的
     width/height 是 JSX 呈现属性，CSS 声明优先，直接覆盖即可——
     不必把比例透传进那个小组件。 */
  width: calc(14px + var(--dsh-content-font-delta, 0px));
  height: calc(14px + var(--dsh-content-font-delta, 0px));
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary);
}

.kr-task-item__icon svg {
  width: 100%;
  height: 100%;
}

/* 对勾 pop：完成那一帧图标从小到大弹出（overshoot 回弹），与底色淡闪同拍。
   动画挂在图标容器而不是 svg，StatusIcon 内部实现变更不受影响。 */
.kr-task-item__icon--pop {
  animation: kr-task-check-pop .4s cubic-bezier(.34, 1.56, .64, 1) 1 both;
}

@keyframes kr-task-check-pop {
  0% { transform: scale(0.4); }
  60% { transform: scale(1.18); }
  100% { transform: scale(1); }
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
  /* 任务正文：字级跟随官方字号轴；行高是比例值（1.45），自动随字级缩放。 */
  font-size: var(--kr-fs-body, 12.5px);
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  word-break: break-word;
  transition: color .2s ease;
}

.kr-task-item--completed .kr-task-item__content {
  color: var(--dsw-alias-label-secondary);
}

.kr-task-item__tag {
  /* 状态标签：字级跟随官方字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11, 11px);
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  flex: none;
  margin-top: 1px;
  white-space: nowrap;
}

.kr-task-item__tag--running {
  color: var(--dsw-alias-state-business-primary, #4176e6);
  background: color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);
}

/* 停滞标签：中性灰描边，与「进行中」同形不同色——状态退化一眼可读。 */
.kr-task-item__tag--stalled {
  color: var(--dsw-alias-label-tertiary);
  background: transparent;
  border: 1px solid var(--kr-card-border);
  padding: 0 5px;
}

/*
 * 进度数字翻滚（RollNum 组件）：inline-grid 双层叠放，旧值滚出新值滚入。
 * 容器宽随较宽者 + tabular-nums（继承 .kr-card__meta），翻滚过程不抖行。
 * up = 数字变大（旧值上滚出、新值从下进），down 反之。
 */
.kr-num-roll {
  display: inline-grid;
  vertical-align: bottom;
  overflow: hidden;
}

.kr-num-roll > * {
  grid-area: 1 / 1;
}

.kr-num-roll--up .kr-num-roll__old {
  animation: kr-num-out-up .32s cubic-bezier(.16, 1, .3, 1) both;
}

.kr-num-roll--up .kr-num-roll__new {
  animation: kr-num-in-up .32s cubic-bezier(.16, 1, .3, 1) both;
}

.kr-num-roll--down .kr-num-roll__old {
  animation: kr-num-out-down .32s cubic-bezier(.16, 1, .3, 1) both;
}

.kr-num-roll--down .kr-num-roll__new {
  animation: kr-num-in-down .32s cubic-bezier(.16, 1, .3, 1) both;
}

@keyframes kr-num-out-up {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(-90%); opacity: 0; }
}

@keyframes kr-num-in-up {
  from { transform: translateY(90%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes kr-num-out-down {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(90%); opacity: 0; }
}

@keyframes kr-num-in-down {
  from { transform: translateY(-90%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* 无障碍兜底：本卡全部装饰性动效一键关。呼吸、流光、翻滚、pop、错峰入场
   都是增强项，信息本身（状态、进度、文案）不依赖动画传达。 */
@media (prefers-reduced-motion: reduce) {
  .kr-task-item,
  .kr-task-item--in_progress::before,
  .kr-task-item--in_progress::after,
  .kr-task-item__flash,
  .kr-task-item__icon--pop,
  .kr-task-progress-line[data-running="true"] .kr-task-progress-line__sheen,
  .kr-task-progress-line[data-flash="true"],
  .kr-num-roll > * {
    animation: none !important;
    transition: none !important;
  }
  .kr-task-progress-line__fill {
    transition: none;
  }
  .kr-task-progress-line[data-running="true"] .kr-task-progress-line__sheen {
    opacity: 0.5;
  }
}

/* ══ 思考过程卡片 ══════════════════════════════════════════════════════════ */
.kr-reasoning-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 基类字级也走字号轴：这张卡现在只以「贴进对话流」的内联形态存在
     （右栏那份 2026-09-28 已移出，见下条内联规则），写死 12px 会让整卡的
     字级在字号设置变化时脱队——内联态虽然另有覆盖，两处口径也该一致。 */
  font-size: var(--kr-fs-body, 12.5px);
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

/*
 * 有界视口：行数上限由组件传入的 --kr-reasoning-rows 驱动
 * （见 KrReasoningCard 的 REASONING_MAX_ROWS）。
 *
 * 行高必须**从当前字级算**（1.6 倍，与 .kr-reasoning-list 的 line-height 同一个
 * 系数），不能写死：字级现在跟随官方字号轴（见「字号轴」段），写死 19.2px 会与
 * 真实行高脱钩——字号调大后每行变高、视口却按旧行高算 max-height，卡片要么被
 * 撑破要么显示不全，超出部分还在视口里滚。
 *
 * 字号 14 时求值是 20px（12.5 × 1.6），与原先写死的 19.2px 只差 0.8px：
 * 一个 16 行视口从 307px 变成 320px，多出的 13px 落在正常波动内。左值（17.6px）
 * 只在小字档生效 —— 那是正文被 --kr-fs-body 的下限压在 11px 的时候。
 * 超出部分在视口内滚动，卡片不再被思考内容撑成长条。
 * 上下缘按滚动位置渐隐，与左侧实时轨道同一套做法（data-edges）。
 */
.kr-reasoning-view {
  --kr-reasoning-line: max(17.6px, calc(var(--kr-fs-body, 12.5px) * 1.6));
  --kr-reasoning-rows: 25;
  max-height: calc(var(--kr-reasoning-line) * var(--kr-reasoning-rows));
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scroll-behavior: auto;
  overflow-anchor: none;
  padding-right: 2px;
  /* 滚动条样式走大盘统一那套（见文件末尾「大盘统一简约滚动条」）。 */
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

@media (forced-colors: active) {
  .kr-reasoning-view { -webkit-mask-image: none !important; mask-image: none !important; }
}

/* 「向上翻看更早的行」入口：它是窗口边界，不做成一枚按钮控件的样子。 */
.kr-reasoning-more {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 4px 6px;
  margin-bottom: 2px;
  border-radius: 6px;
  font: inherit;
  /* 翻页入口比正文低两档半，跟着官方字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11-5, 11.5px);
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color .16s ease, color .16s ease;
}

.kr-reasoning-more:hover {
  background: var(--kr-hover-bg);
  color: var(--dsw-alias-label-secondary);
}

.kr-reasoning-more:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .kr-reasoning-more { transition: none; }
}

/* ══ 字号轴：对话流两张内联卡 + 右栏四张卡跟随官方「设置 → 字号」═════════
 *
 * 官方把正文字号发布成 body 上的行内变量 --dsh-content-font-size（10..22，
 * 默认 14），并派生 --dsh-content-font-delta。这两组卡片（对话流里的思考过程
 * 卡与提问与回答卡，右栏大盘里的任务概览 / 操作面板 / 子智能体 / 产出物）
 * 字号都必须跟着这条轴走——否则用户把字号调到 20，正文变大了，卡片还钉在
 * 12.5px，读起来像另一套界面。
 *
 * 七个档位一律写成「相对正文档平移 + 下限」，三条理由：
 *  1. **默认档逐一还原**：字号 14 时每一档都精确等于改造前的硬编码值
 *     （13 / 12.5 / 12 / 11.5 / 11 / 10.5 / 10），默认外观一个像素没动；
 *  2. **不设上限**：官方上限 22，最大档 20.5px 仍在正常阅读区间，不需要截断；
 *  3. **设下限**：小字档压在 9.5 ~ 12px。官方自己的次级档在小字号区间也是停止
 *     跟随的（--dsh-content-font-size-secondary 在 ≤16px 时锁死 13px），这里只是
 *     把同一条口径按各卡的实际字级平移下来，免得字号调到 10 时正文掉到 8.5px。
 *
 * **不复用官方 --dsh-content-font-size-secondary**：它在 ≤16px 区间恒定 13px，
 * 而用户从默认 14 调到 15、16 恰恰是最常见的一段，那段完全不跟随等于没做。
 *
 * 档位与基准值的对应（右栏四张卡的正文取 body、小字取后四档）：
 *   --kr-fs-title 13   标题行 / --kr-fs-body 12.5 正文
 *   --kr-fs-12    12   / --kr-fs-11-5 11.5 / --kr-fs-11 11
 *   --kr-fs-10-5  10.5 / --kr-fs-10 10
 *
 * 作用域挂在**六个卡根类**上（右侧四张卡 + 左侧两张内联卡）：变量对该卡整棵
 * 子树生效，规则里引用时仍带 fallback，任何一处单独改动都不会让整条 font-size
 * 失效。右栏四张卡与对话流那两张的档位不同源（窄栏一套、内容区一套），
 * 但都从同一个官方变量派生，所以共用这一段声明。
 */
.kr-card--reasoning,
.kr-card--ask,
.kr-card--task,
.kr-card--plain,
.kr-card--subs,
.kr-card--outputs {
  --kr-fs-body: max(11px, calc(var(--dsh-content-font-size, 14px) - 1.5px));
  --kr-fs-title: max(12px, calc(var(--dsh-content-font-size, 14px) - 1px));
  --kr-fs-12: max(11px, calc(var(--dsh-content-font-size, 14px) - 2px));
  --kr-fs-11-5: max(10.5px, calc(var(--dsh-content-font-size, 14px) - 2.5px));
  --kr-fs-11: max(10px, calc(var(--dsh-content-font-size, 14px) - 3px));
  --kr-fs-10-5: max(9.5px, calc(var(--dsh-content-font-size, 14px) - 3.5px));
  --kr-fs-10: max(9.5px, calc(var(--dsh-content-font-size, 14px) - 4px));
}

/*
 * 标题行与图标：覆盖**全部六张卡**。
 *
 * .kr-card__title / .kr-card__meta / .kr-card__icon 是各类卡片共用的基类。
 * 左栏两张（思考 / 问答）与右栏四张（任务概览 / 操作面板 / 子智能体 / 产出物）
 * 现在一起跟随字号轴；右栏余下那张「记忆」卡是 footer 里的钉底卡、高度与
 * 折叠口径自成一套，本次不动（它的标题仍吃基类的 13px）。
 *
 * 图标按官方 leading icon 的口径跟随（width / height 用 calc(基线 + delta)），
 * 不是写死：字号 22 时 16px 图标配 20.5px 正文会显得缩了一号，反之亦然。
 * SVG 的 width / height 是呈现属性，CSS 声明优先，直接覆盖即可。
 */
.kr-card--reasoning .kr-card__title,
.kr-card--ask .kr-card__title,
.kr-card--task .kr-card__title,
.kr-card--plain .kr-card__title,
.kr-card--subs .kr-card__title,
.kr-card--outputs .kr-card__title {
  font-size: var(--kr-fs-title, 13px);
}

/*
 * 标题行右侧的读数（「3/5 完成」「N 条」「2 个 · 1 个进行中」）：
 * 基类是写死的 11px / 16px 行高，一起换成档位变量。
 * 行高按基准比例缩放（11px 字配 16px 行高 → 比例 16/11 ≈ 1.4545）。
 */
.kr-card--task .kr-card__meta,
.kr-card--plain .kr-card__meta,
.kr-card--subs .kr-card__meta,
.kr-card--outputs .kr-card__meta {
  font-size: var(--kr-fs-11, 11px);
  line-height: calc(16px + var(--dsh-content-font-delta, 0px) * 1.4545);
}

.kr-card--reasoning .kr-card__icon,
.kr-card--ask .kr-card__icon,
.kr-card--task .kr-card__icon,
.kr-card--plain .kr-card__icon,
.kr-card--subs .kr-card__icon,
.kr-card--outputs .kr-card__icon {
  /* flex:none：图标现在随字号变宽（字号 22 时 26px），不锁住的话它会被标题
     挤成椭圆而不是保持方形。 */
  flex: none;
  width: calc(18px + var(--dsh-content-font-delta, 0px));
  height: calc(18px + var(--dsh-content-font-delta, 0px));
}

.kr-card--reasoning .kr-card__icon svg {
  width: calc(16px + var(--dsh-content-font-delta, 0px));
  height: calc(16px + var(--dsh-content-font-delta, 0px));
}

.kr-card--ask .kr-card__icon svg {
  width: calc(15px + var(--dsh-content-font-delta, 0px));
  height: calc(15px + var(--dsh-content-font-delta, 0px));
}

/* 右栏四张卡的标题图标基准都是 14–15px，统一按 15px 起算。 */
.kr-card--task .kr-card__icon svg,
.kr-card--plain .kr-card__icon svg,
.kr-card--subs .kr-card__icon svg,
.kr-card--outputs .kr-card__icon svg {
  width: calc(15px + var(--dsh-content-font-delta, 0px));
  height: calc(15px + var(--dsh-content-font-delta, 0px));
}

.kr-card--ask .kr-ask-chevron svg {
  width: calc(12px + var(--dsh-content-font-delta, 0px));
  height: calc(12px + var(--dsh-content-font-delta, 0px));
}

/* 标题行右端的跟随状态（跟随中 / 已暂停）：与标题同一档，跟着字级走。 */
.kr-card--reasoning .kr-card__follow {
  font-size: var(--kr-fs-11, 11px);
}

/* ══ 思考过程卡：贴在 KR 对话流里的内联形态 ═══════════════════════════════
   这张卡原先住在右栏大盘（滚动区三张卡之一），2026-09-28 按用户要求整体搬进
   对话流，改由 assistant-step 座位挂在每回合第一条助手节点上（见
   ThinkingStepNodeView）。下面这一段是它离开右栏后新增的：变量作用域、尺寸
   口径、折叠态与收起动效。 */

/*
 * 变量重声明。
 *
 * 右栏里那张卡能直接吃 :root / .kr-split 上那套 --kr-*，因为它在
 * .kr-split__side 子树里；搬进对话流后它在**主区**，--kr-card-bg 之类
 * 在 :root 上声明时求值不到 body 上的 --dsw-alias-*（html 上没有这些 token），
 * 会静默走 fallback —— 深色下卡片照样纯白，不报任何错。因此这里在卡自己
 * 身上重声明一次（与 .kr-agent-mini-shell 同一处理，理由见那里的注释）。
 */
.kr-card--reasoning[data-inline] {
  --kr-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --kr-card-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --kr-card-border: var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
  --kr-card-hover: var(--dsw-alias-border-l2, rgba(0, 0, 0, .16));
  --kr-hover-bg: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  /*
   * 阴影：**这张卡不再用阴影**（2026-09-29 按用户要求改成左竖线）。
   *
   * 曾试过把浅色阴影加深一档（贴地 .04→.10），但白底上的投影无论怎么加，
   * 都会让思考卡读成「另一张浮起来的白卡」，与下方总结卡抢同一层级；而浅色
   * 主题下对话区底色与卡片底色本来就是同一个纯白（--dsw-alias-bg-base 与
   * --dsw-alias-bg-layer-1 都指向 --dsw-static-neutral-bluish-00），靠投影
   * 分层本身就是错的路子。改由**左边缘一条竖线**承担边界（见下一条规则）。
   *
   * 变量本身保留原口径：.kr-card 基类仍读它，内联态在下面显式压成 none，
   * 万一以后要退回浮起卡形态，这里不用再翻一遍历史。
   */
  --kr-card-shadow: var(--kr-float-shadow, 0 1px 2px rgba(15, 17, 21, .04), 0 8px 24px -18px rgba(15, 17, 21, .28));
  --kr-card-shadow-hover: 0 2px 4px rgba(15, 17, 21, .06), 0 12px 22px -14px rgba(15, 17, 21, .26);
  font-family: var(--dsw-font-family, inherit);
  /* 宽度口径与总结卡（.dtt__card--reply）一致：**占满整列，不随内容自适应**。
     原来是 align-self:flex-start + width:auto（宽度收缩到内容），短思考时卡片
     只有半行宽、长思考时又跳成整行，与下方总结卡左右缘对不齐；按用户要求统一
     成「和总结卡一样的宽度」。
     只写 stretch 不写 width:100%：卡片是 content-box（实测 padding 12px×2 +
     边框会外溢 26px），stretch 由 flex 分配 margin box，含内距刚好等于列宽。 */
  align-self: stretch;
  max-width: 100%;
  /* 折叠态只剩标题一行时的横向内距：右栏那张 10px/12px 是给三张卡纵向堆叠
     用的省空间口径，内联卡独占一行，上下留够呼吸。 */
  padding: 8px 12px;
  gap: 6px;
}

/*
 * 内联态：**左侧一条竖线，无投影、无描边、无底色**（2026-09-29 按用户要求）。
 *
 * 这是这张卡在对话流里的最终形态：它不再是「一张浮在白底上的卡」，而是
 * 「一段被竖线圈起来的思考」。做法与同一对话流里的 .dtt__card--step 同源
 * （左侧 2px 竖线），保持同一条消息列里的语言一致；也回到项目既有的那条
 * 口径——对话流卡片去全部底色，只留文字、线条与动效。
 *
 * 三个决定：
 * 1. **竖线用 border-left 而不是伪元素**。卡片是 content-box，border-left
 *    会随卡片高度整条拉满（含折叠态），不需要额外的 absolute 定位与高度同步。
 * 2. **底色透明**。浅色主题下卡片底色与对话区底色本来就是同一个纯白
 *    （--dsw-alias-bg-base 与 --dsw-alias-bg-layer-1 都指向
 *    --dsw-static-neutral-bluish-00），铺任何底色都是在白底上再铺一层白；
 *    边界交给竖线，层级交给字号与留白。
 * 3. **圆角只留右侧**（0 12px 12px 0）。左边是竖线，四角全圆会让竖线两端
 *    各露出一道缺口；右圆左直是「附着在竖线上的一块内容」的正确画法。
 */
.kr-card--reasoning[data-inline] {
  --kr-reasoning-rail: var(--dsw-alias-border-l2, rgba(0, 0, 0, .10));
  box-shadow: none;
  border: none;
  border-left: 2px solid var(--kr-reasoning-rail);
  border-radius: 0 12px 12px 0;
  background: transparent;
  /* 基类的 transition 管 border-color / box-shadow / transform；这里补上
     底色与竖线色的过渡，hover 的反馈才是「渐次加深」而不是「啪一下换色」。 */
  transition:
    background-color .18s ease,
    border-left-color .18s ease,
    box-shadow .22s cubic-bezier(.16, 1, .3, 1),
    transform .22s cubic-bezier(.16, 1, .3, 1);
}

/*
 * hover：**只加深竖线 + 极淡底色**，卡片不上浮也不加投影。
 *
 * 没有投影时再写 translateY 只会让它显得在抖；竖线由 10% 提到 22%（浅色下
 * 是更实的一道灰、深色下是更亮的一道白），配合 4% 的底色，给出「这一块能点
 * （点标题折叠/展开）」的反馈。底色用文字色的中性纱，两个主题自动反相。
 */
.kr-card--reasoning[data-inline]:hover {
  box-shadow: none;
  transform: none;
  border-left-color: color-mix(in srgb, var(--dsw-alias-label-primary, #000) 22%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #000) 4%, transparent);
}

/*
 * 折叠态：只留标题行 + 一枚 chevron。
 *
 * 只收上下内距，**左右保持与展开态完全一致**（12px）：竖线是 border-left，
 * 落在 padding box 之外，所以两态的正文左缘都等于「容器左 + 2px 竖线 +
 * 12px 内距」。这里若顺手把左内距也加 2px 去「补竖线」，标题会在展开/折叠
 * 之间横向跳一格——展开动画正跑到一半时最明显。
 */
.kr-card--reasoning[data-inline]:not([data-open]) {
  padding-top: 4px;
  padding-bottom: 4px;
}

/* 内联态的字级跟着正文走：右栏 12px 是窄栏里塞更多行的取舍，对话流里
   思考与回答同列，差一级会读成两种东西。

   字级改成**跟随官方字号轴**（字号 14 时仍解析成原来的 12.5px）：这张卡与
   正文同列，用户把字号调大、正文跟着变大而它还钉在原地，两段文字就分成了
   两种东西——正是上面那句话要避免的情形。 */
.kr-card--reasoning[data-inline] .kr-reasoning-list {
  font-size: var(--kr-fs-body, 12.5px);
  line-height: 1.6;
}

/* 深色分支不需要单独写竖线与底色：两者都引用带主题感知的 --dsw-alias-*
   token（border-l2 深色下是 12% 白，label-primary 是近白）。这里只把圆角
   再声明一次，避免继承基类的 10px。 */
body[data-ds-dark-theme] .kr-card--reasoning[data-inline] {
  border-radius: 0 12px 12px 0;
}

@media (prefers-reduced-motion: reduce) {
  .kr-card--reasoning[data-inline] { transition: none; }
}

/* 折叠 chevron 已删（2026-10-05 用户要求）：标题行右侧不再有箭头。
   折叠功能本身不受影响 —— 整行仍是 role=button + aria-expanded，点了照旧收放。 */

/*
 * 折叠体的高度补间由 useHeightAnimation 用 WAAPI 直接改 inline height，
 * 这里只需要给一个起点：折叠时内容仍在 DOM（present 期间）但不可见，
 * overflow:hidden + height 由 hook 写死，这里不重复声明，免得两边各写一份
 * 互相覆盖。data-open 供样式钩子与调试查看当前态。
 */
.kr-card--reasoning[data-inline] .kr-reasoning-list:not([data-open]) {
  opacity: 0;
  transition: opacity .18s ease;
}

.kr-card--reasoning[data-inline] .kr-reasoning-list[data-open] {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .kr-reasoning-chevron { transition: none; }
  .kr-card--reasoning[data-inline] .kr-reasoning-list { transition: none; }
}

/* 跟随状态提示（只在截停时出现，给用户明确反馈）。
   2026-10-05 按用户要求**去掉胶囊底色**：这块底色在标题行右端是一枚孤立色块，
   比它要传达的状态本身更抢眼。只留这行 11px 小字，靠字色区分两态
   （跟随中 = 次级灰，已暂停 = 三级更淡），信息一个不少、噪声清零。 */
.kr-card__follow {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.kr-card__follow[data-following="false"] {
  color: var(--dsw-alias-label-tertiary);
}

.kr-reasoning-row {
  display: flex;
  gap: 6px;
  white-space: pre-wrap;
  word-break: break-word;
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

/* 原「执行结果卡片」的两条规则（.kr-result-content / .kr-result-icon）已删：
   对应的 KrExecutionResultCard 组件是死代码（无人渲染），样式留着只是让人
   以为还有一张结果卡。 */

/* ══ 「操作面板」卡（人话行动时间线）═════════════════════════════════
   大盘的操作面板卡，读者是**不会编程的普通用户**：整张卡
   不出现工具函数名、参数名、原始命令行、完整路径，只出现「打开携程 · 机票」
   这类中文人话。技术细节压在每条末尾的「技术细节」折叠里，需要的人自己点。 */

.kr-card--plain {
  padding-bottom: 11px;
}

/* 原 .kr-card--plain[data-empty] .kr-card__badge 规则已删：徽标整体取消，
   空态下不再有任何底色需要中和。 */

/* 展开体：高度补间由 useHeightAnimation 的 WAAPI 接管（写内联 height +
   overflow），这里只排版，**绝不写 height**，否则和内联样式打架。 */
.kr-plain-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

/* ── 详细 / 简要 切换（卡头右上角） ─────────────────────────────────────
   两枚并列的小按钮，各带一枚图形：等宽三横线=详细，递减两横线=简要。图形直接把
   "档位"画出来（行多/行少），用户不用先读懂"详细/简要"这两个词。

   为什么不是滑块：滑块在 440px 宽的右栏里要占 66px，且"滑块停在哪"在扫读时得盯
   一眼才读得出；两枚按钮各写清自己的名字，扫读零成本，宽度还省一半。

   激活态 = 主文字色 + 卡片底色实块（不是描边、不是品牌色）。这张卡通体是弱一档
   的灰字 + 彩色角标，标题行右侧这块实心块刚好够标出"当前是哪档"，不抢戏。 */
.kr-plain-view {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 1px;
  border-radius: 7px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .1));
}

.kr-plain-view__btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  /* 详细/简要切换：字号与高度都跟随官方字号轴（见「字号轴」段）——
     高度必须一起改，否则大字档下按钮会把文字夹住。 */
  height: calc(19px + var(--dsh-content-font-delta, 0px));
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: var(--kr-fs-11, 11px);
  line-height: 1;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: color .16s ease, background-color .16s ease;
}

.kr-plain-view__btn svg {
  flex: none;
  opacity: .8;
  /* 激活时轻微放大一点：档位切换时"有什么东西动了"，而不只是颜色跳变 */
  transition: opacity .16s ease, transform .24s cubic-bezier(.34, 1.35, .5, 1);
}

.kr-plain-view__btn:hover {
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, .12));
}

.kr-plain-view__btn:hover svg {
  opacity: 1;
}

/* 激活档：主文字色 + 卡片底色实块，把外层那层托底色盖住，整块读作一枚浮起的标签。 */
.kr-plain-view__btn[data-active="true"] {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  background: var(--kr-card-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .16);
}

.kr-plain-view__btn[data-active="true"] svg {
  opacity: 1;
  transform: scale(1.08);
}

.kr-plain-view__btn:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--kr-accent) 55%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .kr-plain-view__btn,
  .kr-plain-view__btn svg { transition: none; }
}

/* 「接下来」预告行（.kr-plain-intent 整族）已删除：那张卡只讲"已经发生了什么"，
   一行尚未兑现的承诺混在事实流水里只会让人分不清做没做；而且它八成与当前正在跑
   的那一行说的是同一件事，白占一行高度。模型侧的播报约定也于 2026-10-01 整条
   下掉（注入规则 + composer 开关 + extractIntent / nowLabel 一并移除）。 */
.kr-plain-empty {
  font-size: var(--kr-fs-12, 12px);
  color: var(--dsw-alias-label-tertiary);
  padding: 2px 0;
}

/* ── 时间线列表（有界视口 + 内部滚动） ───────────────────────────────── */
/*
 * ⚠ 行高是**视口高度**的计算基准：max-height = 行数 × 行高 + 6px。
 * （写法见下一条规则；这里刻意不写反引号 —— 注入式 CSS 的模板字符串里
 * 反引号会让整段提前闭合，本文件头部有红线说明。）
 *
 * 写死 22px 的后果只在放大档显形：字号跟到 20px 时每行实际约 30px，而视口仍按
 * 22px 算，卡片会把内容切掉一半；反过来小字档会留一大片空白。所以它必须与
 * 点 kr-plain-step 的真实行高（min-height 与 12px 正文行高）一起缩放。
 */
.kr-plain-list {
  --kr-plain-row-h: calc(22px + var(--dsh-content-font-delta, 0px) * 1.3);
  max-height: calc(var(--kr-plain-rows, 13) * var(--kr-plain-row-h) + 6px);
  overflow-y: auto;
  /* 纵向可滚、横向钳死：卡片里没有任何需要横向滚动的内容，出现横条只可能是
     某个子项把宽度顶破了（窄栏最易发生），那属于 bug 而不是功能。 */
  overflow-x: hidden;
  overscroll-behavior: contain;
  /* 滚动条走大盘统一那套（见文件末尾「大盘统一简约滚动条」）。 */
  padding-right: 2px;
}

/*
 * 上下缘按滚动位置渐隐。
 *
 * 之前这张列表是**硬切**的：内容超出 max-height 就被矩形裁掉，顶部留下一行被
 * 切掉上半截的字（用户截图里就是这么个效果）。思考卡早就处理过这个问题，名单
 * 独漏了。渐隐让「上面还有内容」变成一种柔和的暗示，而不是一道生硬的切口。
 */
.kr-plain-list[data-edges="both"] {
  -webkit-mask-image: linear-gradient(transparent 0, black 16px, black calc(100% - 16px), transparent 100%);
  mask-image: linear-gradient(transparent 0, black 16px, black calc(100% - 16px), transparent 100%);
}

.kr-plain-list[data-edges="top"] {
  -webkit-mask-image: linear-gradient(transparent 0, black 16px, black 100%);
  mask-image: linear-gradient(transparent 0, black 16px, black 100%);
}

.kr-plain-list[data-edges="bottom"] {
  -webkit-mask-image: linear-gradient(black 0, black calc(100% - 16px), transparent 100%);
  mask-image: linear-gradient(black 0, black calc(100% - 16px), transparent 100%);
}

@media (forced-colors: active) {
  .kr-plain-list { -webkit-mask-image: none !important; mask-image: none !important; }
}

/* 卡片级「技术细节」开关已整块删除（按用户要求）：开关与它打开时那层蓝底
   （data-on 的 accent 描边 + 11% 底色）一起没了，KrPlainTimelineCard 里的
   showTech 状态与 kr-plain-step__tech 渲染点同样删除。这张卡从此只讲人话，
   技术视角完全交给对话流里官方那条工具折叠行。 */

/* ── 单条步骤 ───────────────────────────────────────────────────────────
   行内间距、圆角、悬停底色与 .kr-task-item 对齐：右栏这两张卡是同一份信息的两面
   （任务 = 打算做什么，步骤 = 已经做了什么），行长得不一样时上下扫过去像两个产品。 */
.kr-plain-step {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  /* 9px 与 .kr-task-item 的 gap 一致：两张卡现在行首都是「一枚 14px 图标 + 文字」，
     gap 不对齐的话两卡的文字起点会差 1px，竖着扫过去像两张不同的表。 */
  gap: 9px;
  /* 窄栏下 flex 子项默认的 min-width:auto 会让长标题把整行顶宽，列表随即冒出
     一条横向滚动条；置 0 后标题上已有的 text-overflow 才真正生效。 */
  min-width: 0;
  /* 行高与上面 --kr-plain-row-h 同一系数（22px 基准 + delta×1.3）：
     两处必须一起改，否则视口高度与实际行高脱钩（原因见那处的注释）。 */
  min-height: calc(22px + var(--dsh-content-font-delta, 0px) * 1.3);
  /* 左内距 12px（原先 8px）：给进行中那行左侧的 2px 活动竖线留出站位，否则竖线
     会压在行首 14px 图标上。所有行统一加，整列文字左缘才对齐。 */
  padding: 4px 8px 4px 12px;
  border-radius: 6px;
  font-size: var(--kr-fs-12, 12px);
  color: var(--dsw-alias-label-secondary);
  animation: kr-plain-step-in .26s cubic-bezier(.16, 1, .3, 1) both;
  transition: background-color .12s ease;
}

.kr-plain-step:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.07));
}

@keyframes kr-plain-step-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/*
 * 类别图标：14px 单色描边，线宽 1.3，颜色跟着状态走。
 *
 * 行首**只有这一枚**。原先左边还有一列 14px 的状态槽（.kr-plain-step__status），
 * 而「已经做了什么」这一列里 99% 的行都是空盒——整列空白只为等那一条红叉，
 * 白占掉一列缩进还会让文字起点比卡片边缘低一截。现在失败由这枚图标自己说：
 *  常态：灰色类别图标（看 / 改 / 建 / 删各自不同，见 Icon 的注释）；
 *  失败：图标转红 + 右上角叠一枚小红叉角标（不占额外布局宽度）。
 */
.kr-plain-step__icon {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
}

.kr-plain-step[data-status="failed"] .kr-plain-step__icon {
  color: var(--dsw-alias-state-error-primary, #ef4444);
}

/*
 * 失败角标：6px 红点压在图标右上角外沿，是这一列里唯一的反例信号。
 *
 * 用绝对定位而不是另起一列：它只在失败时出现，正常行宽度完全不变，整列左边界
 * 因此齐整。入场给一点弹性缩放（红点从 0 长出来），失败这件事才被"看见"发生
 * 了，而不只是列表里静态多了一颗点。
 */
.kr-plain-step__icon[data-failed="true"]::after {
  content: '';
  position: absolute;
  top: -1px;
  right: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-state-error-primary, #ef4444);
  box-shadow: 0 0 0 1.5px var(--kr-card-bg);
  animation: kr-plain-bad-pop .34s cubic-bezier(.34, 1.56, .64, 1) both;
}

@keyframes kr-plain-bad-pop {
  from { transform: scale(0); }
  to { transform: scale(1); }
}

.kr-plain-step__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

/*
 * 简要（纪要）模式：**不画图标，文字从卡缘直接起**。
 *
 * 那一列已经只剩三五条里程碑与一条报错，图标在这个密度下是纯噪声：用户读的是
 * 「改了什么 / 出了什么事」，不是「这属于哪类工具」。省掉的一列让每行成为一整句
 * （「修改 plain-language.ts · 共 19 次」），而不是「图标 + 半个词」。
 *
 * 失败行靠左侧一道 2px 红条指认：图标拿掉了，但"这一行是坏事"必须一眼可见——它是
 * 纪要里唯一需要被立刻注意到的那条。不用红底：整行铺红会把右栏整片染红，太重。
 *
 * **文字颜色与字重不再单独覆盖，两档走同一条规则链**（2026-10-02 按用户要求）。
 *
 * 这里曾有一条 data-brief="true" 的 title 规则，把 title 提为 primary + 500，
 * 理由是"纪要行数少、可以更实"。但代价是**切档时整列文字由灰转黑**（实测
 * secondary #61666b → primary #0f1115），读起来像换了一张卡，而不是同一份内容
 * 的两种密度——这正是用户报的"简要的字体颜色要与详细保持一致"。
 *
 * 现在颜色只由两处决定，且两档共用：
 *   常态 → 基类 .kr-plain-step 的 secondary；
 *   进行中 → 下面 data-status="running" 那条提到 primary + 500。
 * 简要档因此只剩"行数与图标"的差别，色阶与详细完全同源。
 */

/*
 * 简报行的三段层次。
 *
 * 曾经动词、对象、次数是同一串字（形如「修改 triad-modal-animation.ts ·
 * 共 7 次」），看上去前半截亮、后半截暗 —— 那不是配色做的层次，而是 CJK
 * 笔画密与拉丁字形细的天然视觉重量差，字号字重完全一致却让文件名和次数被
 * 顺带压到读不清。层次得排出来，不能靠字体撞出来。
 *
 * 但**层次只能用字重与尺寸排，不能用颜色**（2026-10-02 按用户要求收紧）：
 * 两档的 title 色阶必须同源（都是基类的 secondary），切档时整列文字不能变色。
 * 动词与对象同色、只差字重；次数是唯一的彩色元素（折叠产物，归到和子智能体
 * 计数同一套语言里）。药丸沿用 fresh-wipe 入场，减弱动效时一并关掉。
 *
 * 动词与对象之间的字重差从 600/400 收到 500/400：原来那个 600 是照着"动词最重"
 * 写的，但简要档整行本来就是 400，一个 600 的动词在 12px 下会把 CJK 笔画糊成
 * 一团，读起来比对象更"脏"而不是更"重"。500 是"看得出来是它、但不像加粗"的那一档。
 *
 * 本段注释内不得出现反引号：整张表是模板字符串的正文，一个反引号就会把
 * 模板提前闭合，剩下的 CSS 变成 JS 表达式被求值，整张表在运行时静默失效。
 */
.kr-plain-step__verb {
  font-weight: 500;
}

.kr-plain-step__object {
  font-weight: 400;
  margin-left: 0.4em;
}

.kr-plain-step__count {
  flex: none;
  margin-left: 0.45em;
  padding: 0 6px;
  border-radius: 8px;
  /* 计数徽标：字号与行高一起跟随字号轴（见「字号轴」段）。
     行高按基准比例缩放（11px 字配 15px 行高 → 15/11 ≈ 1.3636）。 */
  font-size: var(--kr-fs-11, 11px);
  line-height: calc(15px + var(--dsh-content-font-delta, 0px) * 1.3636);
  font-weight: 500;
  color: var(--kr-accent);
  background: color-mix(in srgb, var(--kr-accent) 18%, transparent);
  font-variant-numeric: tabular-nums;
  animation: kr-fresh-wipe .28s ease both;
}

.kr-plain-step[data-brief="true"][data-status="failed"] {
  padding-left: 10px;
  box-shadow: inset 2px 0 0 var(--kr-error);
}

/*
 * 进行中：**文字完全静止**，活动信号交给行左侧一道 2px 竖线。
 *
 * 这里换掉的是原先的「文字渐变扫光」（background-clip:text + 2.2s 无限位移）。
 * 那套的问题不在性能（一行 30 字的重绘代价确实可以接受），而在**它动的是文字
 * 本身**：
 *   · 渐变裁切让整行字在大部分时间比邻居更暗（暗端取的是 tertiary），读者先
 *     看到的是"这行有点灰"、然后才是"它还在跑"，信息层级正好是反的；
 *   · 一道光 2.2s 一轮无限来回，想读那一行时正好被光带打断——读一句话要等光
 *     扫过去，这就是"反人类"的来源；
 *   · background-clip:text 会改变文字的抗锯齿与字重观感（同一字重下比普通
 *     渲染更细更虚），中文笔画密，虚一点就糊。
 *
 * 现在的分工是：**文字负责"是什么"，竖线负责"还在跑"**。竖线只动 transform 与
 * opacity（合成器属性），不重绘文字；文字保持正常颜色与字重，随时可读。
 *
 * 竖线语言与右栏其它卡一致（思考卡、问答卡都是左竖线），但这里表达的是"活动"
 * 而不是"分类"：只在进行中的那一行出现，且自带一次自上而下的脉冲。同时行底
 * 铺一层 5% 品牌蓝、行首图标转蓝——三重信号都很克制，谁也不抢文字。
 *
 * ⚠ 竖线占的是**行内距**：整行 padding-left 从 8px 提到 12px，竖线才有位置站在
 * 图标左边。不改内距而直接 left:0 的话，2px 竖线会压在 14px 图标左缘上（实测
 * 截图里那枚图标被切掉一道边）。非进行中的行也一并加内距——只有进行中的行缩进
 * 更深会让整列文字左缘随状态跳动。
 */
.kr-plain-step[data-status="running"] {
  position: relative;
  background: color-mix(in srgb, var(--kr-accent) 5%, transparent);
}

.kr-plain-step[data-status="running"]::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 5px;
  bottom: 5px;
  width: 2px;
  border-radius: 1px;
  background: var(--kr-accent);
  transform-origin: center top;
  animation: kr-plain-active 1.7s cubic-bezier(.45, 0, .25, 1) infinite;
}

@keyframes kr-plain-active {
  0%, 100% { transform: scaleY(.4); opacity: .5; }
  50% { transform: scaleY(1); opacity: 1; }
}

/* 行首类别图标转品牌蓝：详细模式下这一列是"哪类动作"，进行中时它顺带说"就是
   这一类在跑"。简要模式没有图标，信号由竖线与底色承担。 */
.kr-plain-step[data-status="running"] .kr-plain-step__icon {
  color: var(--kr-accent);
}

.kr-plain-step[data-status="running"] .kr-plain-step__title {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.kr-plain-step[data-status="failed"] .kr-plain-step__title {
  color: var(--kr-error);
}

.kr-plain-step__time {
  flex: none;
  /* 实时耗时读数：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-10-5, 10.5px);
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

/*
 * 失败原因（人话那句）：一行标题右边的补充，不与主文案并列。
 *
 * 排在一枚淡红底的小药丸里而不是裸文字，是为了让它一眼归到"这行出事了"名下，
 * 而不是被读成第二个动作对象（"查看文件" + "找不到文件或页面" 连在一起很容易被
 * 理解成两件事）。药丸只用 error 色 12% 混底，够指认、不抢戏。
 */
.kr-plain-step__issue {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 8px;
  /* 失败原因小药丸：字号与行高一起跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-10-5, 10.5px);
  line-height: calc(15px + var(--dsh-content-font-delta, 0px) * 1.4286);
  color: var(--kr-error);
  background: color-mix(in srgb, var(--kr-error) 12%, transparent);
  animation: kr-plain-issue-in .26s cubic-bezier(.16, 1, .3, 1) both;
}

@keyframes kr-plain-issue-in {
  from { opacity: 0; transform: translateX(-4px); }
  to { opacity: 1; transform: none; }
}

/*
 * 「预览」入口（产出行右侧的一枚小按钮）。
 *
 * 默认**半隐身**：一列动作里大多数行都没有产出物，按钮常亮会把整列读成
 * 「一堆按钮」，而它真正要服务的只是那几行有产出的。所以静止时压到很低的
 * 对比度，鼠标扫过这一行（或键盘 Tab 到它）才完全显形 —— 存在感按需给。
 *
 * 动效分三层，都走合成器友好的属性：
 *  · 入场：跟同列其它元素一套的 kr-fresh-wipe（新行出现时横向擦出）；
 *  · hover：背景色淡入 + 图标轻微右上位移（"跳出去看"的方向感，与图标本身
 *    的 ↗ 语义一致）；
 *  · 按下：scale 回弹，给一次触觉式确认。
 * 减弱动效时只保留颜色变化。
 */
.kr-plain-step__open {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  padding: 1px 7px 1px 6px;
  border: 1px solid color-mix(in srgb, var(--kr-accent) 26%, transparent);
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--kr-accent) 62%, var(--dsw-alias-label-tertiary));
  font-family: inherit;
  /* 「打开文件」入口：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-10-5, 10.5px);
  line-height: calc(15px + var(--dsh-content-font-delta, 0px) * 1.4286);
  cursor: pointer;
  opacity: .62;
  transition: opacity .18s ease, color .18s ease, background-color .18s ease,
              border-color .18s ease, transform .12s cubic-bezier(.2, .8, .2, 1);
  animation: kr-fresh-wipe .28s ease both;
}

.kr-plain-step__open svg {
  transition: transform .2s cubic-bezier(.2, .8, .2, 1);
}

.kr-plain-step:hover .kr-plain-step__open,
.kr-plain-step__open:focus-visible {
  opacity: 1;
  color: var(--kr-accent);
  border-color: color-mix(in srgb, var(--kr-accent) 48%, transparent);
  background: color-mix(in srgb, var(--kr-accent) 10%, transparent);
}

.kr-plain-step__open:hover {
  border-color: var(--kr-accent);
  background: color-mix(in srgb, var(--kr-accent) 16%, transparent);
}

.kr-plain-step__open:hover svg {
  transform: translate(1px, -1px);
}

.kr-plain-step__open:active {
  transform: scale(.94);
}

.kr-plain-step__open:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .kr-plain-step__open,
  .kr-plain-step__open svg { transition: none; animation: none; }
  .kr-plain-step__open:hover svg { transform: none; }
  .kr-plain-step__open:active { transform: none; }
}

/* @keyframes kr-plain-tech-in 已删：唯一使用它的 .kr-plain-step__tech 整块移除。 */

/* ── 子智能体区块（挂在「派生子任务」那一步下面） ───────────────────────
   子智能体是独立会话，父调用对它们内部在做什么一无所知。这里只列拿得到的
   事实：名字 / 跑没跑 / 有没有下级。缩进挂在父行之下，用一条竖线表达
   「这些是从上面那一步派生出来的」，而不是并列的同级动作。 */
.kr-plain-step[data-nested="true"] {
  flex-wrap: wrap;
}

.kr-plain-step__subcount {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  /* 派生计数徽标（挂在「派生子任务」那一步下方）：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-10-5, 10.5px);
  line-height: calc(15px + var(--dsh-content-font-delta, 0px) * 1.4286);
  color: var(--kr-accent);
  background: color-mix(in srgb, var(--kr-accent) 10%, transparent);
  font-variant-numeric: tabular-nums;
  animation: kr-fresh-wipe .28s ease both;
}

/* ══ 「子智能体」卡（这次对话派出去几个独立干活的）═════════════════════════
   读者是普通用户，这张卡只回答两件事：**有几个、谁还在跑**，以及**点进去看**。

   形态上刻意与另外三张卡拉开距离：任务概览是横向清单、操作面板是一列文字流水、
   产出物是一列带缩略图的文件。这张卡是**一列可点的会话行**（状态点 + 名字 +
   运行读数 + 悬停浮现的跳转箭头），一行对应一个真实会话 —— 因为它的每一样东西
   都指向"那边还有一个正在干活的会话"，点一下就该跳过去。

   2026-10-08 之前它挂在操作面板某一步下面当一个缩进小块，那套样式连同子块
   与逐行样式一并删除：同一份信息不该有两套排版，而独立成卡之后那个位置的
   唯一职责只剩一枚计数徽标（.kr-plain-step__subcount，仍在）。 */

.kr-card--subs {
  padding-bottom: 10px;
}

/* 展开体：高度补间由 useHeightAnimation 的 WAAPI 接管（写内联 height +
   overflow），这里只排版，绝不写 height，否则和内联样式打架。 */
.kr-subs-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.kr-subs-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.kr-subs-row {
  min-width: 0;
  border-radius: 6px;
  /* 错峰入场：与操作面板 / 产出物同一套节奏（新行从下方 6px 淡入），
     三张卡「有东西出现」读起来是一件事。 */
  animation: kr-subs-row-in .3s cubic-bezier(.16, 1, .3, 1) both;
  transition: background-color .12s ease;
}

@keyframes kr-subs-row-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

.kr-subs-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.07));
}

/*
 * 行主体 = 整行一个真按钮。
 *
 * 这一行唯一能做的事就是"跳过去看它"，所以"点这一行"和"点一个跳转按钮"是同一
 * 件事 —— 多挂一枚按钮只是把同一句话说了两遍。做成 button 还顺手解决了键盘与
 * 触屏：Tab 一次就到，回车即跳，触屏有 :active 反馈。
 *
 * UA 按钮样式全部抹掉（灰底、内边距、居中文本、系统字体在这里全是错的），
 * 因为它现在承载的是一行列表项。
 */
.kr-subs-row__main {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  /* 行高随官方字号轴一起缩放（见「字号轴」段）：写死 28px 时放大档会把两行
     文字夹住。min-height 与行高同一系数。 */
  min-height: calc(28px + var(--dsh-content-font-delta, 0px) * 1.3333);
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
  font-size: var(--kr-fs-12, 12px);
  line-height: calc(16px + var(--dsh-content-font-delta, 0px) * 1.3333);
  text-align: left;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* 键盘焦点环：整行可点，焦点必须看得见（WCAG 2.4.7）。 */
.kr-subs-row__main:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
}

/*
 * 状态点：5px，跑着的用主色 + 脉冲，结束的压成淡灰。
 *
 * 颜色 + 脉冲两重线索，且**形状不承担状态** —— 色弱用户与灰度截图下靠脉冲与
 * 那枚文字状态（「进行中」/「已结束」）依然读得出。文字状态在窄栏里会被挤掉，
 * 所以它排在标签之后、读数之前，优先级最低，但绝不是唯一线索。
 */
.kr-subs-row__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption);
  opacity: .5;
}

.kr-subs-row[data-running="true"] .kr-subs-row__dot {
  background: var(--kr-accent);
  opacity: 1;
  animation: kr-pulse 1.4s ease-in-out infinite;
}

/* 名字是这一行的主体：主文字色 + 500 字重，长了省略（完整名字在 title 里）。 */
.kr-subs-row__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.kr-subs-row[data-running="true"] .kr-subs-row__label {
  color: var(--dsw-alias-label-primary);
}

/* 标签：描边式胶囊、无底色（徽标教训见 .kr-card__meta 注释）。 */
.kr-subs-row__tag {
  flex: none;
  padding: 0 5px;
  border-radius: 7px;
  /* 续接标签（「可续接」「还有下级」）：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-10, 10px);
  line-height: calc(14px + var(--dsh-content-font-delta, 0px) * 1.4);
  color: var(--dsw-alias-label-caption);
  border: 1px solid var(--kr-card-border);
}

/* 时长 / token：tabular-nums，走秒时行宽不抖。 */
.kr-subs-row__time {
  flex: none;
  /* 读数小字：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-10-5, 10.5px);
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}

.kr-subs-row__state {
  flex: none;
  /* 「进行中 / 已结束」文字状态：与上面那枚读数同一档。 */
  font-size: var(--kr-fs-10-5, 10.5px);
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}

/*
 * 跳转箭头：**悬停/聚焦才浮现**，常态宽度也占住（opacity 而不是 display），
 * 否则指针移到行上时整行文字会向右挪 12px —— 那是"列表在抖"，不是反馈。
 *
 * aria-hidden：它只是"这里能点"的视觉提示，读屏用户听到的是整行的 aria-label。
 */
.kr-subs-row__go {
  flex: none;
  display: grid;
  place-items: center;
  /* 跳转箭头容器：与里面的 svg 一起跟随字号轴（见「字号轴」段）。 */
  width: calc(14px + var(--dsh-content-font-delta, 0px));
  height: calc(14px + var(--dsh-content-font-delta, 0px));
  color: var(--kr-accent);
  opacity: 0;
  transform: translateX(-3px);
  transition: opacity .16s ease, transform .16s cubic-bezier(.16, 1, .3, 1);
}

.kr-subs-row:hover .kr-subs-row__go,
.kr-subs-row__main:focus-visible .kr-subs-row__go {
  opacity: 1;
  transform: none;
}

.kr-subs-row__main:active .kr-subs-row__go {
  transform: translateX(1px);
}

/* 空态 / 读取中：一行低对比度说明，不占多余高度。 */
.kr-subs-empty {
  padding: 2px 8px;
  /* 空态说明：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11-5, 11.5px);
  color: var(--dsw-alias-label-caption);
}

/* 「展开其余 N 个」：与产出物卡同款（那张卡也是这么收敛长列表的）。 */
.kr-subs-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
  /* 「展开其余 N 个」：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11-5, 11.5px);
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}

.kr-subs-more:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.07));
  color: var(--dsw-alias-label-secondary);
}

.kr-subs-more:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
}

/* 跳转失败（旧宿主没有 uiWorkspace）时的一枚提示：说清事实，而不是"点了没反应"。
   字号比 .kr-card__meta 更小、字色更弱 —— 它是异常说明，不该跟读数抢。 */
.kr-subs-blocked {
  flex: none;
  /* 异常提示小字：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-10-5, 10.5px);
  color: var(--kr-warning);
  animation: kr-subs-blocked-in .24s ease both;
}

@keyframes kr-subs-blocked-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  /* 计数药丸的擦除入场关掉（操作面板里那个缩进子块的样式已随独立成卡整块删除，
     针对它的三条减弱动效规则一并从这里摘掉）。 */
  .kr-plain-step__count,
  .kr-plain-step__subcount {
    animation: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* .kr-plain-dot--* 相关的三条规则随之删除：状态圆圈改由 StatusIcon 组件渲染
     （SVG 内联 animation 属性），统一在组件里处理减弱动效。 */
  .kr-plain-step {
    animation: none;
  }

  /* 失败角标的弹性缩放一并关掉。 */
  .kr-plain-step__icon[data-failed="true"]::after {
    animation: none;
  }

  .kr-plain-step__issue {
    animation: none;
  }

  /* 竖线脉冲关掉后，进行中的信号只剩"底色 + 图标转蓝"这两条静态线索——
     底色是 background-color（不参与动画），所以文字与状态都还在。 */
  .kr-plain-step[data-status="running"]::before {
    animation: none;
    opacity: 1;
    transform: none;
  }

  /* 子智能体卡：入场位移、状态点脉冲、跳转箭头的滑入一并关掉。
     脉冲关掉后"进行中"仍有两重静态线索（主色点 + 「进行中」文字），
     箭头则是常态隐藏的装饰，关掉动画后依然在 hover 时浮现（只是不做位移）。 */
  .kr-subs-row,
  .kr-subs-blocked,
  .kr-subs-row[data-running="true"] .kr-subs-row__dot {
    animation: none;
  }

  .kr-subs-row__go {
    transition: opacity .12s linear;
    transform: none;
  }

  .kr-subs-row__main:active .kr-subs-row__go {
    transform: none;
  }
}

/* ══ 「产出物」卡（本次会话做出来的文件）═════════════════════════════════
   读者仍是普通用户，这张卡只回答一件事：**这次对话一共做出来了哪些东西。**

   形态上刻意与「操作面板」拉开距离：那张卡是一列文字流水（行首 14px 图标 +
   一行文案），这张卡是一列**带缩略图的文件**（28px 缩略图 + 文件名 + 悬停箭头）。
   两者并排时不会读成同一种东西，而它们本来就不同 —— 一个是过程，一个是结果。 */

.kr-card--outputs {
  padding-bottom: 10px;
}

/* 展开体：高度补间由 useHeightAnimation 的 WAAPI 接管（写内联 height +
   overflow），这里只排版，绝不写 height，否则和内联样式打架。 */
.kr-out-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.kr-out-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

/*
 * 一行产出物 = 一个整行按钮。
 *
 * 为什么是 button 而不是 div：这一行**就是**打开预览的入口（不另挂小按钮），
 * 所以它必须天然可聚焦、可回车、可被读屏认出。做成 div + onClick 的话键盘
 * 用户到不了，触屏上也没有 :active 反馈。
 *
 * 按钮的默认样式要全部抹掉：浏览器给 button 的 UA 样式（灰底、内边距、
 * 居中文本、系统字体）在这里全是错的，而它现在承载的是一行列表项。
 */
.kr-out-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  min-width: 0;
  /* 行高随官方字号轴缩放（见「字号轴」段）：36px 是给 28px 缩略图定的，
     两处一起改，放大档才不会把缩略图或文字夹住。 */
  min-height: calc(36px + var(--dsh-content-font-delta, 0px) * 2);
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
  font-size: var(--kr-fs-12, 12px);
  line-height: calc(16px + var(--dsh-content-font-delta, 0px) * 1.3333);
  text-align: left;
  color: var(--dsw-alias-label-secondary);
  -webkit-tap-highlight-color: transparent;
  transition: background-color .12s ease, opacity .18s ease;
  /* 错峰入场：与操作面板同一套节奏（新行从下方 6px 淡入），
     两张卡的「有东西出现」读起来是一件事。 */
  animation: kr-out-row-in .3s cubic-bezier(.16, 1, .3, 1) both;
}

@keyframes kr-out-row-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

.kr-out-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.07));
}

/*
 * 行主体（2026-10-04 拆双交互）：缩略图 + 文件名一枚真 button，点开画廊式
 * Lightbox；行尾另一枚真 button 维持原来的侧栏打开。行本身降级为布局容器
 * （div）—— 一行两个不同动作，键盘 Tab 两站，语义比「整行一个按钮 + 视觉
 * 箭头」更准。UA 按钮样式全抹（灰底/内边距/居中/系统字体在这里全是错的）。
 */
.kr-out-row__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* 键盘焦点环：主体可点，焦点必须看得见（WCAG 2.4.7）。 */
.kr-out-row__main:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
}

/*
 * 缩略图。
 *
 * **不是真实文件预览，是按类型画的 SVG**（见 KrOutputsCard 的 Thumb）。
 * 理由：28px 见方读不出画面内容，而为每一行发一次文件请求的代价与收益完全
 * 不成比例 —— 一屏 6 行就是 6 次读盘，换来的只是一个看不清的小方块。
 *
 * 底色按 data-kind 分档：同一类文件永远同一个底色，于是扫一列时"哪些是图、
 * 哪些是代码"是靠色块与形状**双重**传达的，色弱用户与灰度截图下也读得出。
 */
.kr-out-row__thumb {
  flex: none;
  display: grid;
  place-items: center;
  /* 类型缩略图：随字号轴放大（1.4 倍系数，与行高同比例），
     里面的 svg 高度已经是 52%（见下），跟着容器走。 */
  width: calc(28px + var(--dsh-content-font-delta, 0px) * 2);
  height: calc(28px + var(--dsh-content-font-delta, 0px) * 2);
  border-radius: 6px;
  border: 1px solid var(--kr-card-border);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .08));
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  transition: transform .24s cubic-bezier(.34, 1.35, .5, 1), border-color .18s ease;
}

/* 悬停时缩略图轻微放大：一行里"有东西在回应指针"，但只有这一个元素动，
   整行不位移 —— 列表行位移会让下面的行跟着抖。 */
.kr-out-row:hover .kr-out-row__thumb {
  transform: scale(1.06);
  border-color: var(--kr-card-hover);
}

/* 类型底色：只染缩略图的底，不染整行 —— 整行染色会让六行变成六块色斑。 */
.kr-out-row[data-kind="image"] .kr-out-row__thumb,
.kr-out-row[data-kind="video"] .kr-out-row__thumb {
  background: color-mix(in srgb, var(--kr-accent) 12%, transparent);
  color: color-mix(in srgb, var(--kr-accent) 76%, var(--dsw-alias-label-secondary));
}

.kr-out-row[data-kind="model3d"] .kr-out-row__thumb,
.kr-out-row[data-kind="slide"] .kr-out-row__thumb {
  background: color-mix(in srgb, var(--kr-warning) 15%, transparent);
  color: color-mix(in srgb, var(--kr-warning) 72%, var(--dsw-alias-label-secondary));
}

.kr-out-row[data-kind="audio"] .kr-out-row__thumb,
.kr-out-row[data-kind="sheet"] .kr-out-row__thumb {
  background: color-mix(in srgb, var(--kr-success) 14%, transparent);
  color: color-mix(in srgb, var(--kr-success) 68%, var(--dsw-alias-label-secondary));
}

.kr-out-row[data-kind="pdf"] .kr-out-row__thumb,
.kr-out-row[data-kind="archive"] .kr-out-row__thumb {
  background: color-mix(in srgb, var(--kr-error) 12%, transparent);
  color: color-mix(in srgb, var(--kr-error) 66%, var(--dsw-alias-label-secondary));
}

/* 可打开的页面：与 code 共用中性档但走 accent 一脉 —— 扫一列时"哪些是能打开的
   页面、哪些只是源文件"一眼分得开（页面是成果，源码是材料）。 */
.kr-out-row[data-kind="page"] .kr-out-row__thumb {
  background: color-mix(in srgb, var(--kr-accent) 10%, transparent);
  color: color-mix(in srgb, var(--kr-accent) 70%, var(--dsw-alias-label-secondary));
}

/* 文件名：主文字色 + 500 字重，是这一行的主体。 */
.kr-out-row__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

/*
 * 行尾「在侧栏打开」真按钮（2026-10-04 从 aria-hidden 视觉箭头升级而来）。
 *
 * 静止时**完全隐藏**（不是半透明）：六行各挂一枚常亮图标就是一列噪声 ——
 * 提示该在指针落到哪一行时只出现在那一行。键盘 Tab 到它、或焦点落在行内任一
 * 控件（:focus-within）时浮现；浮现带 2px 位移回位 + 180ms 淡入（旧箭头同款
 * 节奏）。hover 加一层浅底、按下图标缩 12% —— 它现在是真按钮，得有真反馈。
 */
.kr-out-row__open {
  flex: none;
  display: grid;
  place-items: center;
  /* 悬停浮现的预览按钮：随字号轴放大，否则它在大字行里小得点不准。 */
  width: calc(22px + var(--dsh-content-font-delta, 0px) * 1.5);
  height: calc(22px + var(--dsh-content-font-delta, 0px) * 1.5);
  margin-left: 6px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--kr-accent);
  cursor: pointer;
  opacity: 0;
  transform: translate(-2px, 2px);
  transition: opacity .18s ease, transform .2s cubic-bezier(.2, .8, .2, 1), background-color .14s ease;
}

.kr-out-row:hover .kr-out-row__open,
.kr-out-row:focus-within .kr-out-row__open {
  opacity: 1;
  transform: none;
}

.kr-out-row__open:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
}

.kr-out-row__open:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
}

.kr-out-row__open:active svg {
  transform: scale(.88);
}

/*
 * 「核对中」的行（挂载后已上屏、还没问过磁盘）。
 *
 * 只有一点点低对比度，**不是**灰掉、更不是红色警告：绝大多数文件是活的，这一
 * 瞬间的待定态不该看起来像出了事。核对结论为「不存在」的行根本不会渲染到这里
 * —— 它已被从清单里剔除（见 KrOutputsCard 的 gonePaths）。
 *
 * 用 opacity 而不是改颜色：这一行的缩略图有按 data-kind 分的底色，逐个改色值
 * 要维护九套；整体压一点点对所有类型一视同仁，深色主题下也不会变成一坨。
 */
.kr-out-row[data-pending="true"] {
  opacity: .72;
}

/* 核对完成（确认存在）后回满：给它一个 180ms 的回归，读起来是「确认过了」，
   而不是「刚才怎么灰了一下」。opacity 的过渡合并在 .kr-out-row 的 transition 里。 */

/*
 * 代码文件折行。
 *
 * 一次编码任务改十几个源文件，逐条占行会把「做出来了什么」整个淹掉 ——
 * 折成一行「另有 N 个代码文件」，要看的人自己展开。
 */
.kr-out-code {
  min-width: 0;
}

.kr-out-code__toggle {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  /* 代码文件折行：与产出物行同比例跟随字号轴（见「字号轴」段）。 */
  min-height: calc(30px + var(--dsh-content-font-delta, 0px) * 2);
  padding: 3px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
  font-size: var(--kr-fs-11-5, 11.5px);
  line-height: calc(16px + var(--dsh-content-font-delta, 0px) * 1.3913);
  text-align: left;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}

.kr-out-code__toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.07));
  color: var(--dsw-alias-label-secondary);
}

.kr-out-code__toggle:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
}

/* 折行的缩略图与正式行同尺寸同位置：展开后两段的行首对齐，读起来是一列。 */
.kr-out-code__thumb {
  flex: none;
  display: grid;
  place-items: center;
  width: calc(28px + var(--dsh-content-font-delta, 0px) * 2);
  height: calc(28px + var(--dsh-content-font-delta, 0px) * 2);
  border-radius: 6px;
  border: 1px dashed var(--kr-card-border);
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
}

.kr-out-code__text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kr-out-code__action {
  flex: none;
  /* 折行内的「预览」动作字：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11, 11px);
  color: var(--kr-accent);
  opacity: .82;
}

.kr-out-code__chevron {
  flex: none;
  transition: transform .22s cubic-bezier(.2, .8, .2, 1);
}

.kr-out-code[data-open="true"] .kr-out-code__chevron {
  transform: rotate(180deg);
}

/* 展开后的代码清单：缩进一级（28px 缩略图 + 9px gap），表明它们属于上面那一行。 */
.kr-out-list--code {
  margin-left: 37px;
  padding-left: 4px;
  border-left: 1px solid var(--kr-hairline);
  animation: kr-out-code-in .26s cubic-bezier(.16, 1, .3, 1) both;
}

@keyframes kr-out-code-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}

/*
 * 「展开其余 N 条」。
 *
 * 一条上发丝线 + 居中一行小字：它是列表的**出口**，不是列表的一行，所以
 * 与上面各行拉开一道分隔，且没有缩略图列（不参与"文件行"的对齐）。
 */
.kr-out-more {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  margin-top: 2px;
  padding: 5px 0 2px;
  border: 0;
  border-top: 1px solid var(--kr-hairline);
  background: transparent;
  font-family: inherit;
  /* 「展开其余 N 条」：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11, 11px);
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: color .16s ease;
}

.kr-out-more:hover {
  color: var(--kr-accent);
}

.kr-out-more:focus-visible {
  outline: 2px solid var(--kr-accent);
  outline-offset: -2px;
  border-radius: 6px;
}

.kr-out-more svg {
  transition: transform .2s cubic-bezier(.2, .8, .2, 1);
}

.kr-out-more:hover svg {
  transform: translateY(1px);
}

/* 空态：常驻一行低对比度说明，卡片不整张消失（与任务概览同一口径）。 */
.kr-out-empty {
  padding: 2px 8px 3px;
  /* 空态说明：跟随字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11-5, 11.5px);
  line-height: calc(16px + var(--dsh-content-font-delta, 0px) * 1.3913);
  color: var(--dsw-alias-label-tertiary);
}

@media (prefers-reduced-motion: reduce) {
  .kr-out-row,
  .kr-out-list--code {
    animation: none;
  }
  .kr-out-row:hover .kr-out-row__thumb { transform: none; }
  .kr-out-row__open,
  .kr-out-code__chevron,
  .kr-out-more svg { transition: none; }
  .kr-out-row__open { transform: none; }
  .kr-out-row__open:active svg { transform: none; }
  .kr-out-more:hover svg { transform: none; }
}

/* ══ 大盘统一简约滚动条 ══════════════════════════════════════════════════
   大盘里有四个滚动区，此前各写各的：主滚动区完全没样式（用系统默认，宽且带
   端帽）、思考卡 4px、记忆卡只有 Firefox 写法、新卡更是把发丝级描边色
   --kr-card-border 当滑块色（4% 黑，在白底上等于没画）。同栏里出现四种
   观感，比任何一种单独不好看都更糟。

   现在合成一套：**6px 槽 + 2px 胶囊滑块**（靠 2px 透明边框 + content-box
   实现，滑块本身比槽窄一截，这才是「细」）、轨道全透明（画出来的方块轨道
   是系统默认样式里最吵的部分）、常态 55% 不透明、指针移上去才提到全不透明
   并给 180ms 过渡。

   刻意不做「滚动时才显形」：那要么靠 JS 监听 scroll 做显隐（每个滚动区一份
   计时器），要么靠 scroll-driven animation（Chromium 支持面还不够）。半透明
   常驻 + hover 提亮是同等克制、零 JS 的做法。 */

/* ══ 大盘统一简约滚动条 ══════════════════════════════════════════════════
   目标形态：白底上一根淡灰细长圆头条，没有轨道、没有端帽、没有方块底。

   ── 为什么上一版「统一了却还是丑」────────────────────────────────────
   上一版把 scrollbar-width / scrollbar-color 和 ::-webkit-scrollbar 写在了
   同一批选择器上，以为「两条路径各服务各的浏览器」。**这是错的**：Blink 121
   起实现了标准滚动条属性，只要 scrollbar-width / scrollbar-color 取值不是
   auto，同作用域下的 ::-webkit-scrollbar-* 伪元素就被**整体忽略**。

   也就是说那份 6px 圆角规则一条都没生效，屏幕上是 Windows 原生滚动条
   （宽、带轨道端帽）——正是用户嫌丑的那根。四个滚动区虽然各自写法不同，
   却都踩了同一个坑，所以「统一」统一到了不生效的同一条路上。

   ── 正确的做法：两边只能选一条路 ────────────────────────────────────
   · Chromium / WebKit：**只写** ::-webkit-scrollbar，一个标准属性都不碰，
     宽度、圆角、颜色完全可控；
   · Firefox：用 @supports not selector(::-webkit-scrollbar) 单独兜。
     Gecko 不认伪元素，而这条 @supports 在 Blink 里恒为假，所以不会反过来
     踩到上面那条「写了标准属性就废掉伪元素」的规则。

   ── 形态 ────────────────────────────────────────────────────────────
   6px 槽、槽本身就是滑块宽度，border-radius 999px 出半圆端头（半径 3px
   正好等于半个槽宽）；轨道与 corner 全透明——画出来的方块轨道是系统默认
   样式里最吵的部分。常态淡、指针移上去才提亮并给 180ms 过渡。

   刻意不做「滚动时才显形」：那要么给每个滚动区挂一份 scroll 计时器，要么
   依赖 scroll-driven animation（支持面还不够）。淡色常驻 + hover 提亮是同等
   克制、零 JS 的做法。 */

/* Chromium / WebKit */
.kr-panel__scroll::-webkit-scrollbar,
.kr-reasoning-view::-webkit-scrollbar,
.kr-plain-list::-webkit-scrollbar,
.kr-memory__list::-webkit-scrollbar,
  width: 6px;
  height: 6px;
}

.kr-panel__scroll::-webkit-scrollbar-track,
.kr-reasoning-view::-webkit-scrollbar-track,
.kr-plain-list::-webkit-scrollbar-track,
.kr-memory__list::-webkit-scrollbar-track,
  background: transparent;
}

.kr-panel__scroll::-webkit-scrollbar-thumb,
.kr-reasoning-view::-webkit-scrollbar-thumb,
.kr-plain-list::-webkit-scrollbar-thumb,
.kr-memory__list::-webkit-scrollbar-thumb,
  background-color: var(--kr-scrollbar-thumb);
  /*
   * 这里**不能**再叠 border + background-clip: content-box 去「把 6px 槽收成
   * 2px 细线」：滚动条的绘制走浏览器内部路径，不吃普通盒模型的 border 与
   * background-clip，写了也不生效，只留下「注释说细线、实际是 6px 方条」的
   * 落差。想要更细就直接把上面的 width 调小。
   */
  border-radius: 999px;
  transition: background-color .18s ease;
}

.kr-panel__scroll::-webkit-scrollbar-thumb:hover,
.kr-reasoning-view::-webkit-scrollbar-thumb:hover,
.kr-plain-list::-webkit-scrollbar-thumb:hover,
.kr-memory__list::-webkit-scrollbar-thumb:hover,
  background-color: var(--kr-scrollbar-thumb-hover);
}

.kr-panel__scroll::-webkit-scrollbar-corner,
.kr-reasoning-view::-webkit-scrollbar-corner,
.kr-plain-list::-webkit-scrollbar-corner,
.kr-memory__list::-webkit-scrollbar-corner,
  background: transparent;
}

/*
 * Firefox 单独兜：Gecko 不认伪元素，只能用标准属性。
 *
 * 必须包在 @supports not selector(::-webkit-scrollbar) 里——Blink 121+ 一旦在
 * 同作用域看到 scrollbar-width / scrollbar-color（非 auto）就会反过来忽略
 * 伪元素，两条路同时写等于两条都不生效。
 */
@supports not selector(::-webkit-scrollbar) {
  .kr-panel__scroll,
  .kr-reasoning-view,
  .kr-plain-list,
  .kr-memory__list,
    scrollbar-width: thin;
    scrollbar-color: var(--kr-scrollbar-thumb) transparent;
  }
}

/* Windows 高对比度：color-mix 派生的半透明滑块会被系统接管成不可见，
   显式给回系统文本色，保证至少「看得见能拖」。 */
@media (forced-colors: active) {
  .kr-panel__scroll::-webkit-scrollbar-thumb,
  .kr-reasoning-view::-webkit-scrollbar-thumb,
  .kr-plain-list::-webkit-scrollbar-thumb,
  .kr-memory__list::-webkit-scrollbar-thumb,
    background-color: CanvasText;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kr-panel__scroll::-webkit-scrollbar-thumb,
  .kr-reasoning-view::-webkit-scrollbar-thumb,
  .kr-plain-list::-webkit-scrollbar-thumb,
  .kr-memory__list::-webkit-scrollbar-thumb,
    transition: none;
  }
}

/* ══ 标签行最右侧的「Agent 轨迹大盘」开关 ══════════════════════════════════
   整块已删除：大盘改为在 KR 对话里常态常驻，不需要"要不要它"的开关。
   （它此前是 header [role="tablist"] 的最后一个子节点，margin-left:auto 顶到
   最右端；更早一版是 absolute + 阴影 + backdrop-filter 的浮动胶囊，压正文。）
   连带删除的还有：store.panelOpen 状态、KrAgentPanel 顶栏的「收起大盘 ×」。
   —— 标签组如今也不再靠 margin-left:auto 顶右端了（见 styles.ts：标签排到
   「在应用中打开」分体按钮左侧，靠 order 定序、间距交给 header 的 gap）。 */

@keyframes kr-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ══ 记忆卡片停靠区（固定右栏底部）═══════════════════════════════════════
   记忆卡不再是 .kr-panel__scroll 的子节点，而是滚动区之下的独立 flex footer：
   滚动区（flex:1 1 0）高度自动让位，记忆卡永远钉在右栏最下方——无论内容
   多少、无论滚动位置。旧方案是滚动区内的 sticky bottom:0，内容少时卡片
   跟在其它卡后面悬在中间，做不到「永远在下方」，已废弃。

   footer 现在只服务记忆卡一块（用时已搬去对话流里那张「Seeker 正在…」活动卡，
   工具调用卡整块移除），所以它与滚动区是「内容 / 常驻区」的分工。 */
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
  /* 滚动条走大盘统一那套（见文件末尾「大盘统一简约滚动条」）。 */
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

/*
 * 标题行最右端的一键删除（删本会话新增全集）。
 *
 * 常态**隐藏**，指针落到卡片上或键盘聚焦时才浮现：它删的是整批记忆，属于破坏性
 * 操作，不该在标题行常驻跟「N 条」抢注意力。浮现方式与行尾那枚垃圾桶同款
 * （淡入 + 3px 右移归位），这样「同一种删除」在两处的手感是一致的。
 */
.kr-memory__clear {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.kr-memory__clear-act {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  opacity: 0;
  transform: translateX(3px);
  transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.15s ease, color 0.15s ease;
}

.kr-card:hover .kr-memory__clear-act,
.kr-memory__clear-act:focus-visible {
  opacity: 1;
  transform: translateX(0);
}

.kr-memory__clear-act:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.16));
  color: var(--dsw-alias-label-primary);
}

/* 触屏没有 hover，一键删除常显（否则永远点不到） */
@media (hover: none) {
  .kr-memory__clear-act {
    opacity: 1;
    transform: none;
  }
}

/* 请求中：一枚不可点的文字，替掉那枚垃圾桶——让「正在删」这件事在标题行上可见 */
.kr-memory__clear-busy {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}

/*
 * 行内错误（分区级「删除失败」与标题行级「一键删除失败」共用一套外观）。
 * 以前这条 div 一直没有样式，靠继承的行高裸着；既然现在折叠态下也可能出现
 * （一键删除失败），给它一个明确的两行内距与断行规则。
 */
.kr-memory__err {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 1px 2px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  word-break: break-word;
}

.kr-memory__err > span {
  flex: 1;
  min-width: 0;
}

/*
 * 一键删除的错峰退场：整行淡出 + 轻微右移，删多条时读起来是「一条条被抹掉」，
 * 而不是整块闪没。animation-delay 由行索引现算（见 KrMemoryCard 的 staggerDelay），
 * 内联在 style 上；这里的 animation 覆盖 .kr-memory__row 的入场动画。
 */
.kr-memory__row[data-leaving="true"] {
  animation: kr-memory-row-out 0.22s cubic-bezier(0.4, 0, 1, 1) both;
  pointer-events: none;
}

@keyframes kr-memory-row-out {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(10px); }
}

/*
 * 一键删除成功后卡片自身的收拢退场。
 *
 * 删完最后一条时本会话新增归零，卡片本来就该整张消失（.kr-panel__memory-dock:empty
 * 会连带把 footer 的 padding 收掉）。直接卸载的话是「啪一下没了」；这里让它先
 * 淡出并轻微下沉 260ms 再卸载，与上面那批行的退场接成一条完整的收尾动作。
 */
.kr-card--memory[data-collapsing="true"] {
  animation: kr-memory-card-out 0.26s cubic-bezier(0.4, 0, 1, 1) both;
  pointer-events: none;
}

@keyframes kr-memory-card-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(6px) scale(0.985); }
}

  color: var(--dsw-alias-label-primary);
}

@media (prefers-reduced-motion: reduce) {
  .kr-memory__row { animation: none; transition: background-color 0.12s linear; }
  .kr-memory__act { transition: opacity 0.12s linear; transform: none; }
  .kr-memory__flag:active { transform: none; }
  .kr-memory__more { transition: color 0.12s linear, background-color 0.12s linear; }
  /* 一键删除的两段退场（行错峰淡出 + 卡片收拢）在减弱动效下不播位移与淡出：
     行的卸载与卡片的卸载照旧发生，只是不再有过渡帧。 */
  .kr-memory__row[data-leaving="true"] { animation: none; }
  .kr-card--memory[data-collapsing="true"] { animation: none; }
  .kr-memory__clear-act { transition: opacity 0.12s linear; transform: none; }
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
   * 英文缩写、数字、年份括号出现两种字形，右栏大盘几张卡也因为没声明而吃正文栈
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
  /*
   * 浮层卡在对话流里是唯一的「浮起」层，投影要真能把它从正文里托起来：
   * 贴地一层 0.5px 接触影 + 中层 6px 柔影 + 底层 28px 大范围落影，三层叠出高度。
   *
   * 这段以前落在规则外（上一行那个右花括号提前闭合了 .kr-agent-mini-shell），
   * 于是整块声明被解析器连同末尾的花括号一起丢弃——页面靠 :root 那份
   * --kr-float-shadow 兜住，看起来一直有影子，注释承诺的「三层」却从没生效。
   * 现在放回规则内，两套阴影的分工也才真正成立：:root 那份给大盘卡片用，
   * 这份更厚的只给对话流里那张浮起卡用。
   */
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


/* ══ 提问与回答卡（对话流内联） ═════════════════════════════════════════════
 *
 * 与思考卡同一套内联语言：**左侧一条竖线，无投影、无描边、无底色**
 * （完整理由见 .kr-card--reasoning[data-inline] 那段注释）。两张卡在对话流里
 * 紧挨着出现（思考在上、问答在下），用同一种画法才读得作"同一列里的两块内容"，
 * 而不是"两种不同层级的浮层"。
 *
 * 唯一的差别是**竖线的颜色**：思考卡是中性灰，问答卡是品牌蓝 —— 问句是这一轮
 * 里唯一"等着你"的东西，该比思考更显眼一档。等待回答时整条竖线呼吸，回答落定
 * 后转回中性色，颜色本身承担了状态。
 *
 * 变量重声明与思考卡同理（理由见 .kr-card--reasoning[data-inline] 的注释）：
 * 卡片在主区，:root 上的 --kr-* 求值不到 body 上的 --dsw-alias-*，不重声明会
 * 静默走 fallback（深色下照样纯白）。
 */
.kr-card--ask[data-inline] {
  --kr-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --kr-card-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --kr-card-border: var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
  --kr-card-hover: var(--dsw-alias-border-l2, rgba(0, 0, 0, .16));
  --kr-hover-bg: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  --kr-ask-rail: var(--dsw-alias-border-l2, rgba(0, 0, 0, .10));
  font-family: var(--dsw-font-family, inherit);
  /* 宽度口径与思考卡、总结卡一致：**占满整列，不随内容自适应**。
     只写 stretch 不写 width:100%：卡片是 content-box（padding + 边框会外溢），
     stretch 由 flex 分配 margin box，含内距刚好等于列宽。 */
  align-self: stretch;
  max-width: 100%;
  box-shadow: none;
  border: none;
  border-left: 2px solid var(--kr-ask-rail);
  border-radius: 0 12px 12px 0;
  background: transparent;
  padding: 8px 12px;
  gap: 6px;
  transition:
    background-color .18s ease,
    border-left-color .18s ease,
    box-shadow .22s cubic-bezier(.16, 1, .3, 1),
    transform .22s cubic-bezier(.16, 1, .3, 1);
}

/*
 * 等待回答：竖线是品牌蓝，并且**呼吸**。
 *
 * ⚠ 呼吸动的是 ::after 伪元素的 opacity，**不是 border-left-color**。
 *
 * 上一版把呼吸写成 border-left-color 的颜色插值（42% ↔ 100%）。那是这张卡
 * 卡顿的主因：border 颜色变化会**每帧重绘整张卡的边框**，而这张卡带着 12px 圆角、
 * 多层嵌套（group / row / options / opt）、以及一行行文字 —— 一个 2.4s 的无限
 * 循环每帧触发一次整卡 paint，叠加高度补间就是用户报的"展开卡卡的"。
 *
 * 现在：竖线本体是静态的 border-left（只画一次），呼吸交给一个绝对定位的
 * ::after 覆盖条，只动 opacity —— 纯合成器属性，零重绘、零重排。
 */
.kr-card--ask[data-inline][data-state="waiting"] {
  --kr-ask-rail: var(--kr-accent);
  position: relative;
}

.kr-card--ask[data-inline][data-state="waiting"]::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 0 12px 12px 0;
  background: var(--kr-accent);
  pointer-events: none;
  animation: kr-ask-breathe 2.4s ease-in-out infinite;
}

@keyframes kr-ask-breathe {
  0%, 100% { opacity: .42; }
  50% { opacity: 1; }
}

/* hover：只加深竖线 + 极淡底色，卡片不上浮也不加投影（同思考卡）。 */
.kr-card--ask[data-inline]:hover {
  box-shadow: none;
  transform: none;
  border-left-color: color-mix(in srgb, var(--dsw-alias-label-primary, #000) 22%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #000) 4%, transparent);
}

/* 折叠态只收上下内距，左右与展开态完全一致（同思考卡：左右一变标题会横向跳）。 */
.kr-card--ask[data-inline]:not([data-open]) {
  padding-top: 4px;
  padding-bottom: 4px;
}

/* ── 卡头右侧的状态读数：等待时前面挂三点跳动 ─────────────────────────── */
.kr-card--ask[data-inline] .kr-card__meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  /* 状态读数（等待回答 / 3/5 已回答）跟着官方字号轴走，见「字号轴」段。 */
  font-size: var(--kr-fs-11-5, 11.5px);
  color: var(--dsw-alias-label-tertiary);
}

.kr-card--ask[data-inline][data-state="waiting"] .kr-card__meta {
  color: var(--kr-accent);
}

/*
 * 三点跳动。三颗必须是三个独立元素（靠伪元素只能凑两颗，且 opacity 打在同一个
 * 元素上三颗会一起亮，错峰就没了）——同 .kr-agent-dots 的处理。
 */
.kr-ask-dots {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.kr-ask-dots > i {
  /*
   * 三点随字级放大。写死 3px 的话，字号轴推到 22px 时标题行右侧的「已回答」已涨到
   * 19.5px，三点还是 3px —— 等待态的信号相对缩成一颗几乎看不见的芝麻，而这三点
   * 正是「模型在等你回答」的唯一动效线索。
   *
   * 写成「基线 + delta × 比例」而不是 calc(var(--kr-fs-11-5) * 3 / 11.5)：
   * 后者在默认档会被浏览器的 calc 除法算出 2.99536px（浮点误差），而 delta 在
   * 默认档恰好是 0，前一种写法在默认档**精确**回到 3px（实测过两种写法）。
   * 比例 0.26 使字号 22 时三点约 5.08px，与字级同比例。
   * 下限 2px 兜住最小档（字号 10 时三点不再继续缩小）。
   */
  width: max(2px, calc(3px + var(--dsh-content-font-delta, 0px) * 0.26));
  height: max(2px, calc(3px + var(--dsh-content-font-delta, 0px) * 0.26));
  border-radius: 50%;
  background: currentColor;
  animation: kr-ask-dot 1.05s ease-in-out infinite;
}

.kr-ask-dots > i:nth-child(2) { animation-delay: .14s; }
.kr-ask-dots > i:nth-child(3) { animation-delay: .28s; }

@keyframes kr-ask-dot {
  0%, 60%, 100% { opacity: .28; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}

/* 展开箭头：与思考卡那枚同款（内联卡收口后只剩标题一行，没有它用户不知道
   点标题还能展开），跟着 data-open 转 180°。 */
.kr-ask-chevron {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
  transition: transform .22s cubic-bezier(.16, 1, .3, 1), color .18s ease;
}

.kr-card--ask[data-open] .kr-ask-chevron {
  transform: rotate(180deg);
}

.kr-card__header:hover .kr-ask-chevron {
  color: var(--dsw-alias-label-secondary);
}

/* ── 正文 ─────────────────────────────────────────────────────────────── */
.kr-ask-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* 同一次调用的多条问答之间比不同调用之间更紧一档。 */
.kr-ask-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.kr-ask-group + .kr-ask-group {
  padding-top: 10px;
  border-top: 1px solid var(--kr-hairline);
}

/*
 * 逐题**不再各自播入场动画**（2026-10-02 按用户反馈"展开有点卡卡的"）。
 *
 * 原先每一行（.kr-ask-row）和每个被选中的选项（.kr-ask-opt[data-picked]）
 * 都各跑一个 translateY / scale 动画，且带 animationDelay 错峰。展开的那一刻
 * 同时起跑的动画是三层叠加：
 *    kr-card-in（整卡 320ms）+ kr-ask-row-in（每行 340ms）
 *    + kr-ask-pick-in（选中项 360ms）
 * 而行/项是**同一帧内全部挂载**的，十几个元素各自触发一次合成层提升与位移，
 * 再加上高度补间同时在改 height（每帧重排整卡）—— 读起来就是"卡一下"。
 *
 * 现在只留**一次**整体过渡：卡片自己的 kr-card-in（入场）与高度补间（展开/收起）。
 * 行与选项只做静态呈现，不再有各自的动画。
 */
.kr-ask-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.kr-ask-row__tag {
  align-self: flex-start;
  /* 问题分组小标：字级跟随官方字号轴（见「字号轴」段）。 */
  font-size: var(--kr-fs-11, 11px);
  /*
   * 行高也必须跟着字级走，不能写死 16px。
   *
   * 写死的后果只在放大档才看得出来：字号轴推到 22px 时这枚小标是 19px，
   * 行高却仍是 16px —— 行距小于字高，上下两行文字会贴到一起。
   * 写成「基线 + delta × 比例」是为了默认档**精确**落在 16px：delta 在默认档
   * 为 0，而用 calc(字级 * 16 / 11) 会被浏览器的分式求值引入浮点尾数。
   * 比例 1.4545 来自改造前「11px 字号配 16px 行高」那一档（16/11）。
   */
  line-height: calc(16px + var(--dsh-content-font-delta, 0px) * 1.4545);
  color: var(--dsw-alias-label-tertiary);
}

/* 问句字号与思考卡正文同档（对话流里两块内容同列，差一级会读成两种东西），
   两处引用同一个变量，字号轴一变两卡一起变。 */
.kr-ask-row__q {
  font-size: var(--kr-fs-body, 12.5px);
  line-height: 1.6;
  color: var(--dsw-alias-label-primary);
}

.kr-ask-row__detail {
  font-size: var(--kr-fs-12, 12px);
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
}

.kr-ask-row__skip {
  font-size: var(--kr-fs-11-5, 11.5px);
  color: var(--dsw-alias-label-tertiary);
}

/* ── 答案：只显示用户**实际选了什么** ─────────────────────────────────
 *
 * 这张卡是**已经发生过的事实的记录**，不是一份可以重新选择的问卷。读者要看的是
 * 「当时问了什么、我答了什么」—— 把三个候选项全铺出来，答案就淹在另外两个没被选
 * 的里，每次都要在三条里找哪条是亮的，而"没被选的那两条"对读者是零信息。
 *
 * 想回看完整候选（含当时没选的），走卡片头上官方那行的「查看回答」面板。
 *
 * 呈现上：答案比问句**重一档**（主文字色 + 500），与上面那句问句形成"问-答"的
 * 层级；多条答案（多选、或"选了某项 + 又补了一句"）各占一行。
 */
.kr-ask-row__answer {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.kr-ask-pick {
  display: block;
  /* 答案行与问句同档（同一变量），字号轴一变整卡同步。 */
  font-size: var(--kr-fs-body, 12.5px);
  line-height: 1.6;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  overflow-wrap: anywhere;
}

.kr-ask-fallback {
  font-size: var(--kr-fs-12, 12px);
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

@media (prefers-reduced-motion: reduce) {
  /* 卡片入场与等待呼吸关掉后，状态由静态竖线色承担（底色不参与动画）。 */
  .kr-card--ask[data-inline],
  .kr-card--ask[data-inline][data-state="waiting"],
  .kr-ask-dots > i {
    animation: none !important;
  }
  .kr-card--ask[data-inline],
  .kr-ask-chevron {
    transition: none;
  }
  /* 三点不跳时保持常态不透明度（同 .kr-agent-dots：静止的点仍是"这里有活动"
     的信号，整组抹掉反而丢信息）。 */
  .kr-ask-dots > i { opacity: .55; }
  .kr-card--ask[data-inline][data-state="waiting"] { border-left-color: var(--kr-accent); }
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
