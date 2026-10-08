/**
 * dsh-chat-plus — KR 对话功能总开关。
 *
 * 控制「Seeker」（内部代号 KR 对话）这个视图分类 + 右侧 Agent 实时轨迹大盘（KrAgentPanel）。
 *
 * ⚠ 这是**隐藏开关，不是删除**：kr-chat/ 下的全部代码、样式、座位装配都原样
 * 保留，把这里改回 false 重新 build 即可完整回到 KR 之前的单栏形态。
 *
 * false 时的行为 = 回到 KR 之前的形态：
 *  1. 不注入「Seeker」标签、不挂右侧大盘、不注入 KR 专属样式（见 index.ts）；
 *  2. store 初始 activeTab 直接是 'chat'，于是 isKrMode 全链路为 false：
 *     - 不再往 body 写 data-dsh-kr-chat → 「KR 模式下隐藏左侧工具树 / 折叠条」
 *       那套 CSS 不生效。这点很关键：那套规则是「详情收敛到右侧大盘」的前提，
 *       没有大盘还隐藏工具行，工具调用就彻底看不见了；
 *     - ThinkingStepNodeView 普通「对话」路径把 thinking block 交回官方
 *       AssistantNodeView 自行渲染；KR 视图由本回合首步挂的思考过程卡
 *       （inline 模式，贴在对话流里）与 turn-process 活动卡呈现思考。
 *  3. 截图按钮回到「对话」里常驻（不再要求 KR 模式）。
 */
export const KR_CHAT_ENABLED = true

/**
 * KR 右侧大盘「顶部 Header」显隐开关。
 *
 * 大盘顶栏 = 机器人头像 + 标题（当前对话提问）+ 副标题（`N/M 项任务已完成` 等
 * 统计行）+ 右侧「生成对话截图」一枚按钮。
 *
 * ⚠ 同样是**隐藏开关，不是删除**：KrAgentPanel 里的整块 JSX、`kr-panel__header`
 * 那一套样式（头像/标题行/副标题/按钮）全部原样保留，改回 true 重新 build 即完整
 * 恢复顶栏。
 *
 * false（默认）= 右栏只剩「任务 / 思考 / 操作面板」三张卡（用户明确要的形态）。
 * 功能零损失：对话截图另有常驻入口 —— assistant 消息操作栏的相机按钮
 * （见 shot/index.tsx），与顶栏那枚按钮走同一个 ShotPanel。
 *
 * 注：顶栏原先还有一枚「收起大盘 ×」，已随大盘常驻化（标签行那枚
 * 「Agent 轨迹大盘」开关一并删除）整块删除，恢复顶栏时无需补回。
 */
export const KR_PANEL_HEADER_VISIBLE = false

/**
 * KR 右侧大盘「记忆」卡片显隐开关（钉在右栏最下方）。
 *
 * 卡片常驻右栏底部：工作区记忆 + 全局记忆两个分区，支持多选批量删除。
 * 它一常驻就必然与其它卡片争高度，因此同时触发右栏挤压判定
 * （见 use-adaptive-rows.ts）——滚动区放不下时操作面板与记忆卡各缩一档。
 *
 * ⚠ 同为**隐藏开关，不是删除**：KrMemoryCard 组件、memory-api.ts 客户端与
 * 那一套 `.kr-card--memory` / `.kr-memory__*` 样式全部原样保留，改回 true
 * 重新 build 即完整恢复。
 *
 * false 时右栏只剩「任务 / 操作面板」两张卡，不再有挤压自适应。
 */
export const KR_MEMORY_CARD_VISIBLE = true

/**
 * KR 右侧大盘「操作面板」卡显隐开关（滚动区的最后一张卡）。
 *
 * 这张卡把本轮的工具调用翻译成**中文人话时间线**（「打开携程 · 机票」而不是
 * `browser_navigate(url)`），并显示模型自己播报的「接下来准备做什么」。它的读者
 * 是不会编程的普通用户，是大盘里唯一一张「讲人话」的卡。
 *
 * 依赖三块纯逻辑：`plain-language.ts`（工具名 → 人话）、`plain-timeline.ts`
 * （思考播报 + 工具事实 → 时间线）、`KrPlainTimelineCard.tsx`（呈现）。
 * 三者互不依赖组件，单独拿去做别的面板也成立。
 *
 * ⚠ 同样是**隐藏开关，不是删除**：组件与 `.kr-card--plain` / `.kr-plain-*` 那一套
 * 样式全部原样保留，改回 true 重新 build 即完整恢复。
 *
 * false 时右栏只剩「任务」一张卡 + 记忆卡，行为与开关打开前完全一致。
 */
export const KR_PLAIN_TIMELINE_CARD_VISIBLE = true

/**
 * KR 右侧大盘「产出物」卡显隐开关（滚动区的最后一张卡，操作面板之下）。
 *
 * 这张卡回答的是「**这次对话一共做出来了哪些文件**」——与操作面板讲的过程
 * 不同，它是结果：图片 / 视频 / 3D 模型 / 文档 / 表格 / 压缩包各带一枚按类型
 * 画的 SVG 缩略图，**整行可点**，点一下即在 DSH 右侧栏打开该文件的预览。
 * 代码文件（.ts/.py/.css…）默认折成一行「另有 N 个代码文件」，可展开。
 *
 * 依赖两块纯逻辑：`outputs.ts`（工具调用 → 产出物清单，含按节点缓存）与
 * `KrOutputsCard.tsx`（呈现）。前者不依赖 React，可单独拿去别处用。
 *
 * ⚠ 同为**隐藏开关，不是删除**：组件与 `.kr-card--outputs` / `.kr-out-*`
 * 那一套样式全部原样保留，改回 true 重新 build 即完整恢复。
 *
 * false 时右栏只剩「任务 / 操作面板」两张卡 + 记忆卡。
 */
export const KR_OUTPUTS_CARD_VISIBLE = true

/**
 * KR 右侧大盘「子智能体」卡显隐开关（操作面板之下、产出物之上）。
 *
 * 这张卡回答的是「**这次对话派出去几个独立干活的，各自跑完了没有**」。子智能体
 * 在 DSH 里是独立会话，父调用一概不知道它们的存在；原先这份清单以缩进小块的
 * 形态挂在操作面板某一步下面（读起来像"这一步的内部细节"，还会把一列按时间读
 * 的流水截断），2026-10-08 起按用户要求独立成卡：有几个就几行，**点一行即跳到
 * 那个子会话**（官方 uiWorkspace.openSession）。
 *
 * 依赖两块：`subagent-catalog.ts`（读官方子智能体目录投影 + 跳转动作）与
 * `KrSubagentsCard.tsx`（呈现）。前者不依赖 React 组件，可单独拿去别处用。
 *
 * ⚠ 同为**隐藏开关，不是删除**：组件与 `.kr-card--subs` / `.kr-subs-*` 那一套
 * 样式全部原样保留，改回 false 重新 build 即完整关闭（关闭后子智能体在界面上
 * 只剩操作面板那枚计数徽标，跳转入口也随之消失 —— 这是刻意的，它只该由这个
 * 开关决定）。
 */
export const KR_SUBAGENTS_CARD_VISIBLE = true

/**
 * KR「提问与回答」卡显隐开关。
 *
 * 这张卡回答的是「**模型问了什么、用户答了什么**」。它存在的唯一理由是：
 * KR 对话流只保留答案投影、工具明细整类隐藏，而 ask_user_question 走的是
 * tool-call 节点 —— 于是问答整段从对话流里消失，用户看不到自己答过什么。
 * 问答不是工具明细，是对话本身的一半，所以必须有地方显示。
 *
 * 位置：**贴在 KR 对话流里，紧跟思考过程卡下方**（挂在同一个 assistant-step
 * 锚点上，见 ThinkingStepNodeView）。理由与思考卡当年从右栏搬进对话流一样：
 * 思考、提问、回答是同一件事的几段，分两栏摆就得来回对照才读得完整。
 *
 * ⚠ 隐藏开关，不是删除：KrAskCard 组件、ask-parse.ts 解析层与 `.kr-card--ask`
 * / `.kr-ask-*` 那一套样式全部原样保留，改回 false 重新 build 即完整关闭
 * （关掉后问答在界面上没有任何出口，这是刻意的——它只该由这个开关决定）。
 */
export const KR_ASK_CARD_VISIBLE = true

/**
 * KR 界面上「这个正在干活的家伙」叫什么。
 *
 * 对话流那张活动卡（KrLiveActivityCard）与右侧大盘的进行中标题都用它拼文案：
 * 原来是硬编码的「Agent 正在分析」「Agent 执行中」，现按用户要求统一显示
 * **Seeker**（与顶栏那枚视图标签同名，同一套 UI 里不该有两个自称）。
 *
 * 只改这一处即整条链生效——文案全部由此常量拼出，不再散落字面量。
 */
export const AGENT_DISPLAY_NAME = 'Seeker'
