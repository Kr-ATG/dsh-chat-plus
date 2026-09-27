/**
 * dsh-chat-plus — KR 对话功能总开关。
 *
 * 控制「KR对话」这个视图分类 + 右侧 Agent 实时轨迹大盘（KrAgentPanel）。
 *
 * ⚠ 这是**隐藏开关，不是删除**：kr-chat/ 下的全部代码、样式、座位装配都原样
 * 保留，把这里改回 true 重新 build 即可完整恢复 KR 双栏形态（含「KR对话」标签、
 * 右侧大盘、收起胶囊、KR 专属 CSS 与截图按钮的 KR 门控）。
 *
 * false 时的行为 = 回到 KR 之前的形态：
 *  1. 不注入「KR对话」标签、不挂右侧大盘、不注入 KR 专属样式（见 index.ts）；
 *  2. store 初始 activeTab 直接是 'chat'，于是 isKrMode 全链路为 false：
 *     - 不再往 body 写 data-dsh-kr-chat → 「KR 模式下隐藏左侧工具树 / 折叠条」
 *       那套 CSS 不生效。这点很关键：那套规则是「详情收敛到右侧大盘」的前提，
 *       没有大盘还隐藏工具行，工具调用就彻底看不见了；
 *     - ThinkingStepNodeView 普通「对话」路径会过滤 thinking block，且不显示旧思考 chip；
 *       KR 视图仍由 turn-process 活动卡与右侧大盘呈现思考。
 *  3. 截图按钮回到「对话」里常驻（不再要求 KR 模式）。
 */
export const KR_CHAT_ENABLED = true

/**
 * KR 右侧大盘「顶部 Header」显隐开关。
 *
 * 大盘顶栏 = 机器人头像 + 标题（当前对话提问）+ 副标题（`N/M 项任务已完成` 等
 * 统计行）+ 右侧「生成对话截图」「收起大盘 ×」两枚按钮。
 *
 * ⚠ 同样是**隐藏开关，不是删除**：KrAgentPanel 里的整块 JSX、`kr-panel__header`
 * 那一套样式（头像/标题行/副标题/按钮）全部原样保留，改回 true 重新 build 即完整
 * 恢复顶栏。
 *
 * false（默认）= 右栏只剩「任务 / 思考 / 操作面板」三张卡（用户明确要的形态）。
 * 功能零损失，因为两个入口都另有归属：
 *  1. 收起/展开大盘 —— 顶部标签行最右端常驻的「Agent 轨迹大盘」开关
 *     （#kr-panel-toggle-btn，见 kr-chat-controller.tsx 的 syncKrPanelToggle）；
 *  2. 对话截图 —— assistant 消息操作栏的相机按钮常驻（见 shot/index.tsx），
 *     与顶栏那枚按钮走同一个 ShotPanel。
 */
export const KR_PANEL_HEADER_VISIBLE = false

/**
 * KR 右侧大盘「记忆」卡片显隐开关（钉在右栏最下方）。
 *
 * 卡片常驻右栏底部：工作区记忆 + 全局记忆两个分区，支持多选批量删除。
 * 它一常驻就必然与其它卡片争高度，因此同时触发「思考卡行数挤压自适应」
 * （见 use-adaptive-rows.ts）——空间不够时思考卡自动减小视口行数。
 *
 * ⚠ 同为**隐藏开关，不是删除**：KrMemoryCard 组件、memory-api.ts 客户端与
 * 那一套 `.kr-card--memory` / `.kr-memory__*` 样式全部原样保留，改回 true
 * 重新 build 即完整恢复。
 *
 * false 时右栏回到「任务 / 思考 / 操作面板」三张卡，思考卡固定默认行数
 * （REASONING_MAX_ROWS），不再有挤压自适应。
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
 * false 时右栏回到「任务 / 思考」两张卡 + 记忆卡，行为与开关打开前
 * 完全一致。
 */
export const KR_PLAIN_TIMELINE_CARD_VISIBLE = true
