# dsh-chat-plus — DSH 对话体验增强套件

把 dsh-webui 全家桶里的对话体验拆成独立插件（webui 卸载后补回），并融合原
`dsh-triad` 的四个工作台，零 DSH 源码改动、纯插件注入。能力分六组：

- **回合呈现**：思考行 / 工具行（官方 turn-process 同款，实时走秒 + 分步跟随滚动）· 对话流卡片
  （步骤卡 / 总结卡，回合收口才出现）· 共享活动抽屉（思考语义分组 + 工具调用树）
- **动效**（移植自 `aa2246740/dsh-better-display`，MIT）：思考两行步进跟随（840ms 停顿 /
  500ms 走两行，上翻即停）· 流式新文字淡入（只动新挂载块，旧文不动）· 忙碌标签 2s 微光 ·
  工具行 / 气泡展开收起过渡（260ms / 200ms，播完再卸载）
- **正文增强**：proto-tabs 可交互卡片（pill / expand / glow）· diagram 流程图围栏
  （JSON → SVG）· 生图画廊条 · 重试行影子
- **界面与工具**：会话头部「对话 / 轨迹」标签上移到右上角 · 桌面壳窗口控制留位与主题同步 ·
  对话截图（无头浏览器出图，可内嵌本地 HTML）· download 下载工具（wire 工具 + 实时进度条）
- **KR 对话双栏大盘**：右栏是**任务 / 思考 / 操作面板**三张卡的滚动区 + 记忆卡钉底 footer。顶栏（机器人头像
  + 标题 + 统计副标题 + 截图 / 收起按钮）默认隐藏，由 `KR_PANEL_HEADER_VISIBLE` 单独门控；
  技术视角的「工具调用」卡已整块移除（工具细节只留在操作面板每条的「技术细节」折叠里）；
  **「操作面板」卡**把本轮工具调用翻成
  **中文人话时间线**（给不会编程的普通用户看），并显示模型自己播报的「接下来准备做什么」；记忆卡常驻
  footer 钉在右栏最下方，分区**有本会话新增才显示**（按条目溯源 `provenance.sessionId` 等值判定），
  无新增的分区整个不出现，支持多选批量删除；
  右栏被挤压时思考卡视口行数逐档自动缩小（25→18→12→8→5）
- **四工作台（原 dsh-triad，已融合）**：自动沉淀的长期记忆 · 定时自动化 · 用量（52 周热力 +
  token 消耗查询）· 技能与 MCP Server 管理。`dsh-triad` 自此退役，其座位（slot id / order /
  locale namespace）、8 组 HTTP 路由前缀、数据与配置目录全部原样保留，用户零迁移

产物约 **5.4 MB**（host 3.9 MB + 浏览器半身 448 KB + mermaid 资源 968 KB），浏览器侧只加载
448 KB。随包另分发**内置技能 2.79 MB**（`assets/skills/`，只落在磁盘、由 host 读文件，
不进 bundle、不进浏览器）——npm 包总大小约 8.2 MB。


| 能力 | 说明 |
|---|---|
| **思考呈现** | 普通「对话」不显示思考折叠/思考弹窗，官方 AssistantNodeView 也不会收到 thinking block；KR 对话仍保留右侧「思考」卡与实时活动投影。 |
| **工具调用呈现** | 普通「对话」不再折叠工具调用，也不打开活动弹窗；KR 对话的工具调用收敛进右侧「操作面板」卡（中文人话时间线，每条末尾留「技术细节」折叠），技术视角的那张「工具调用」卡已整块移除。 |
| **对话流卡片** | 总结卡头部 chip 含 Git 操作计数（本轮 git 调用次数，悬停看动词摘要）；头部单色分层（标签弱化 + 数值加强 + 状态圆点，仅对勾留一笔语义绿，hover 上浮）；全卡片去底色（1px 超细发丝边条 + 轻阴影，深浅主题各配色） | 回合中间的已完成片段 = 轻量步骤卡（无框）；回合最终回复 = 总结卡（「本轮完成」徽章 + 用时/步骤/工具/思考统计 chip；中断回合变琥珀色「已中断」）。**卡片只在回合结束后出现**，流式期间一律平铺，流式输出不被卡片吞掉 |
| **共享活动抽屉** | 浏览器侧居中对话框（dim 遮罩 + 面板，z-index 9990/9991，截图面板同款框架；打开底部上滑进入、关闭淡出，播完再卸载），头部分区页签（思考 N / 工具 N，两边都有内容时可切，行点击只决定初始分区），思考按语义分类成组（实施编写/原因排查/验证确认/规划方案/决策权衡/总结汇报/探索分析），工具调用按树展开（行展开/收起 260ms 高度补间）；Esc/点遮罩关闭 |
| **可交互卡片** | 正文里的 proto-tabs 围栏渲染成可点击的 Tab 卡片（信息分层 pill / 可展开卡片 / AI 流光三种形态，缺省 pill）；解析失败自动回退原文，绝不崩卡 |
| **对话截图** | assistant 消息操作栏相机按钮 → 截图面板（范围本条回复/这一轮/整段会话 × 版式电脑/手机 × 画质 1080P/2K/4K × 画幅 × 五套主题（浅/深/玻璃/玻璃深/阅读版）；标题/徽章可编辑；预览后保存/复制/下载/打开目录；「元素删除」编辑模式点击页面删元素再重新生成）。正文里提到的本地 HTML 会自动内嵌进截图（走 file:// iframe，同目录样式图片照常加载，只嵌页面本身，最多 3 张）；host 端常驻无头浏览器渲染卡片（markdown-it + shiki + mermaid 真图），保存目录 `~/.dsh/storages/dsh-chat-flow-screenshot` |
| **会话头部视图标签** | 官方把「对话 / 轨迹」两个视图标签独占标题下方一整行（header 76px）；本插件把 header 改成单行 flex，标签钉到右上角与标题同行（header 收回 45px，省下的 31px 还给正文），下划线贴字、hover 从中心展开、选中常驻蓝条。纯 CSS 注入，选择器只用 `header` / `role=tablist` / CSS Module 的 `_titleRow`、`_tab` 后缀，不依赖构建 hash 前缀；单视图（无 tablist）时 `:has` 不匹配，零影响。桌面壳（Electron 无边框窗口）右上角自绘 最小化/最大化·还原/关闭：与壳走 `dsh:shell-hello` → `dsh:shell-chrome` 能力握手，收到应答才给 `<html>` 挂 `dsh-in-shell`（旧壳不应答 = 行为不变，不留空档），header 右 padding 28px→128px，右侧控制簇（工作区按钮/更多/侧栏展开/对话·轨迹）整体左移 100px 留位；同时监听 `<body data-ds-dark-theme>` 把主题以 `dsh:theme` postMessage 给壳，壳按钮颜色随界面深浅同步。浏览器直开两者零影响 |
| **KR 对话双栏大盘** | 左栏官方 ChatView 原样保留（只有一行状态卡，明细全在右栏），右栏是全高执行大盘，分**滚动区**与**钉底 footer**两段。滚动区自上而下：**任务**（来自本轮 `todo_write` / 官方 todos 实时投影，有真实任务才出现）→ **思考**（有界视口 + 实时跟随滚动，**完整保留不摘要**，默认 25 行封顶）→ **操作面板**（人话行动流，见下条）。footer 钉底只剩**记忆**（默认折叠，见下条）；**用时已搬去左栏那张「Agent 正在…」活动卡**（裸数字跟在三点后，见下段）。技术视角的**「工具调用」卡已按用户要求整块移除**（组件 `KrToolCallsCard.tsx` 与整套 `kr-tool*` 样式一并删除，smoke-client 留了断言防复活）：它和操作面板讲的是同一批事件，工具名、参数、退出码、原始返回现在只出现在操作面板每条末尾的「技术细节」折叠里。开关都在 `src/client/kr-chat/enabled.ts`：`KR_CHAT_ENABLED`（整套 KR 视图）、`KR_PANEL_HEADER_VISIBLE`（顶栏，默认 false）、`KR_PLAIN_TIMELINE_CARD_VISIBLE`（操作面板卡，默认 true）、`KR_MEMORY_CARD_VISIBLE`（记忆卡，默认 true）——全是**隐藏而非删除**，改回 true 即恢复。顶栏隐藏后能力不丢：收起 / 展开走标签行最右端的「Agent 轨迹大盘」开关（`#kr-panel-toggle-btn`），截图走 assistant 消息操作栏相机按钮。**挤压自适应**：`use-adaptive-rows.ts` 用 ResizeObserver 监视 `.kr-panel__scroll`，溢出时把思考卡视口行数逐档下调（25→18→12→8→5），空间恢复即回升，只在档位真正变化时 setState（不进 ResizeObserver 自激循环） |
| **「操作面板」卡（人话行动流）** | 滚动区第三张，读者定位是**不会编程的普通用户**；卡片头是「一串按时间发生的动作」图标（竖线 + 三个节点 + 递减短线，与任务清单/灯泡/扳手/大脑都不撞形）。三块纯逻辑：`src/client/kr-chat/plain-language.ts`（工具名 → `{图标, 动词, 细节}`）、`plain-timeline.ts`（思考播报 + 工具事实 → 时间线）、`KrPlainTimelineCard.tsx`（呈现）。**「已经做了什么」**来自工具调用事实：先剥命名空间前缀（`mcp__playwright-mcp__browser_click` → `browser_click`，provider 前缀由注册决定，规则表不跟着它变），再走规则表 + 站点友好名表（携程/淘宝/GitHub…，携程机票页给「携程 · 机票」），`read` 只出文件名、`pwsh` 只出 description，**命令原文 / 完整路径 / 参数名一律不上屏**——压在卡片头部那枚「技术细节」总开关下面统一展开（tool 名 + 原始入参 JSON + 错误原文），需要的人自己点。未知工具 / 未知 MCP 统一兜底「执行 X」，不崩不空；CUA 桌面控制（`cua_driver_native__*` 剥掉前缀后只剩 `get_window_state` 这类通用短名，匹配不上任何前缀兜底）另有 20 来条专门规则，否则整屏都是「执行 get_window_state」。细节里的 `\uXXXX` 转义统一解回字符（工具描述是 JSON 编出来的，原样透上去就是一串机器码），但路径里的 `\\` 保持原样。**「准备做什么」**来自新增的第 4 条内置注入通道 `PLAIN_PROGRESS_RULE`（`src/triad/memory/engine/inject.ts`）：约定模型每次动手前在**思考里**单起一行写「下一步：<不超过 30 字的中文说明>」，客户端 `extractIntent()` 取**最后一条**匹配（流式重述天然去重），行首严格匹配失败再退到行内匹配。选思考块而不是正文，是因为思考在 KR 模式下不流进对话流（由右栏思考卡承接），不会把正式回复搞脏。导航落地按信息量分四档：默认落地只报站点名、**查询参数被整个丢掉**时明说「目标信息已被忽略」（实测携程的 `/online/list/oneway-ctrip?dcity=bjs&acity=sha` 会被打回首页）、同站跳别处报「被重定向」、跨站报两个站名。**保留每一次调用**（browser_click 点 20 次就是 20 条，不聚合计数——「点了 20 次」本身就是事实），但 `todo_write` 整轮只出**一行汇总**并钉在它**首次出现**的位置（说清「改了几次 / 完成几项」）——模型每改一次任务状态就重写一次清单，按时间逐条排会得到「更新清单 → 做A → 更新清单 → 做B」这种反复穿插，而甩到最后又破坏了时间线的时间语义（模型列计划往往发生在**开头**）；任务状态本身已有上面那张「任务概览」卡实时显示，这里逐条重复纯属冗余；不算百分比，只给进行中 / 已完成 / 失败三个计数。列表有界滚动（默认 6 行，被挤压降到 3 行）并接进 `heightFingerprint`，新步骤贴底自动跟随、用户上滚即截停、收口回顶（内容定格后停在底部，开头几步反而看不见）。**派生子智能体的步骤**（`subagent` / `workflow` / `ralph`）下方挂一个缩进区块，列出子智能体的名字与运行状态 —— 子智能体在 DSH 里是**独立会话**、不是父调用的 `subCalls`（那条通道是 Code Dispatch「工具里再调工具」），父调用对它们内部在做什么一无所知，不挂这个区块就只剩一句干巴巴的「执行 workflow」。开关：composer 记忆注入悬浮卡里新增「过程播报」一行（`state.plainEnabled` / `config.plainInjectDefaultEnabled`，**默认开**——与 diagram 通道默认关相反，这条通道是「准备做什么」的唯一来源，关掉卡片不空但只剩一半） |
| **记忆卡（KR 右栏）** | 数据面走 host 的 `/api/dsh-memory/*`（纯 fetch，无 typert）。**常态折叠**：钉在右栏最下方，但**默认收起**，标题行留一枚「N 条」徽标说清这次对话记了几条，要看由用户点开——默认展开时模型每记一条右栏就自己长高一截、把用户正在读的思考卡顶走一截，而位置还是他没动过的，观感上就是「界面在抖」；顺带让 footer 常态只占一行，思考卡多拿回几行视口。切会话**不重置**折叠态：用户手动点过一次就说明他想看。**口径 = 本会话新增，有新增才显示**：分区只列**这个会话写下 / 更新过**的条目——按条目溯源 `provenance.sessionId` 等值判定（host 在自动提取、memory_remember / memory_revise 写入时落盘），**不按时间**：时钟偏差、刷新、切会话都不影响结果；本会话更新过的记忆（upsert 撞已有条目）同样刷新溯源算本会话。没有新增的分区**整个不渲染**（无占位行），两个分区都无新增时卡体收成一行头部；不再提供「全部 N」历史逃生口（全量历史走侧边栏记忆工作台）。工作区分区再叠加当前 cwd → projectHash 限定（path 匹配，不自己复刻 sha1）。**删除**：点行尾垃圾桶 → 行内「删除？确认 取消」，`POST /delete-batch`，乐观摘除、失败整份回滚。记忆模块不可用时整卡降级成一行「记忆模块未就绪」，不崩其余卡片 |
| **四工作台（原 dsh-triad）** | 2026-09-24 融合：`dsh-triad` 的 host / client 两半身整体搬进 `src/triad/` 与 `src/client/triad/`（host 45 文件 + client 74 文件，SHA256 逐一比对零差异），`dsh-triad` 从 profile bundles 摘除。**侧边栏四入口**：自动化（首行）/ 记忆 / 能力 / 用量。**8 组路由前缀**与工具名一字未改：`/api/dsh-memory/*`（面板数据 + 裁决操作）、`/api/triad-automation/*`、`/api/usage-stats/*`、`/api/skill-manager/*`、`/api/skill-toggles/*`、`/api/skill-health`、`/api/mcp-recommended`、`/api/triad/mcp-status|mcp-config`；工具 `memory_search` / `memory_remember` / `memory_pin` / `memory_tag` / `memory_forget` / `memory_revise` / `memory_retire` / `memory_consolidate` 与 `automation` 照旧。**记忆引擎**仍挂 `agent/pre-step` 注入（prepend，绝不写 system prompt）与 `session/event` 的 turn/end 捕获 → LLM 提取 → ticker 增量编译。装配按「每模块一个 try/catch」，一个工作台挂不起来不影响其他三个，也不影响上面的对话增强 |

**正文链路保持官方**：text 块用官方 `MarkdownText`（ui-primitives）、图片走官方
`renderMessageImages` 槽——不引入 markstream / shiki / katex（截图渲染是 host
端独立管线，不受影响），流式渲染与内置 UI 完全一致，性能零负担（不做常驻
轮询，统计全部来自已有会话投影）。截图引擎空闲 5 分钟自动回收，卸载即关。

## 流程图卡片（diagram，flowchart）

diagram 围栏放 JSON（坐标 /4 网格，节点 ≤9、边 ≤12，非法结构自动回退原文）：

```diagram
{"type": "flowchart", "title": "标题", "desc": "一句话", "nodes": [{"id": "a", "shape": "oval", "x": 280, "y": 24, "w": 160, "h": 48, "name": "开始", "sub": "start"}], "edges": [{"from": "a", "to": "b", "label": "是", "accent": false, "pts": [[360,72],[360,120]]}]}
```

shape 三选一 oval / rect / diamond，pts 为完整折线点（含起终点，圆角自动倒）。size 缺省 full，紧凑版设 "size": "compact"（去副标签和图例，矮四成）。卡片右上角另有“紧 / 标 / 大”切换，看图的人可随时改比例（放大横向滚动）。视口自动贴合内容宽度，窄图不留两侧空白。

**模型怎么知道这个围栏**：靠记忆注入的第三条内置通道 `DIAGRAM_INJECTION_RULE`，与「中文偏好记忆」同构（独立 user message、走 `agent/pre-step`、位置刻意在「项目排除 + 主注入开关」两道闸门之前、每会话只注首步）。开关在 composer 记忆注入悬浮卡片里「中文优先」下方一行「对话内流程图」，标「内置」，**默认关**——它是锦上添花的呈现能力而非语言契约，不该每个会话白烧约 1KB 常驻 token。关着时模型完全不知道这个围栏存在。

配置面：`state.diagramInjectEnabled`（面板落盘）/ `config.diagramInjectDefaultEnabled`（`cordis.patch.yml` 覆盖）。路由 `GET|POST /api/dsh-memory/diagram-inject-state`，状态随 `/inject-state` 回包顺带返回（不新开 GET 端点，避免放大 composer 的既有轮询量）。

> 卡片只在 **「KR对话」视图**渲染，普通「对话」视图里同一个围栏会原样显示成代码块（`pluginRenders = !KR_CHAT_ENABLED || isKrMode`）。

## 内置技能：diagram-design（不可删除）

`assets/skills/diagram-design/`（212 文件 / 2.79 MB）随包分发，启动时由
`src/triad/bundled-skills.ts` **物化**到 `~/.dsh/skills/diagram-design/`。这条 root 在
`dsh-skill-filesystem` 里的 source 是 `user-dsh`，是用户级技能的正统位置——不落盘 DSH 就
看不见它（官方的 `bundledSkillDir` 需要在 profile 里填插件绝对路径，机器绑定、装一次废一次）。

**为什么物化而不是 `bundledSkillDir`**：插件安装路径是动态的，而 `skill-filesystem` 的 config 是
静态 JSON，写不了解析式路径；让用户手改 profile 配置则重装/换机即失效。物化是唯一自足的方案。

**「不可删除」的三条语义**（启动时校验，`applyTriadHost` 最先行执行，早于技能面板列目录）：

| 场景 | 行为 | 判据 |
|---|---|---|
| 目录被删 | 下次启动原样装回 | 目录不存在 |
| 内容被改（含删单个文件） | 下次启动覆盖回随包版本 | **重算目标目录实际内容**的 hash ≠ stamp 记录 |
| 内容未动 | 跳过，不重写 2.79 MB | 目标实况 hash == 随包 hash |

第二条不能省：只读 stamp 等于用户改坏了也永远发现不了（stamp 不会自己变）。代价是每次启动要
hash 212 个文件（几十毫秒）。

**安全阀**：目标目录存在但没有本插件写的 stamp（`.dsh-chat-plus-bundled.json`）→ 那是用户自己
放的同名技能，**绝不覆盖**，只告警。误毁用户资产比「内置这次没装上」严重得多。

**换装不用目录 rename**：曾用「rename 旧目录到 `.retired-` → rename 暂存到正式名」，语义更原子，
但 Windows 上必挂 `EPERM`——刚被 rename 走的目录句柄尚未释放，紧接着往同一路径 rename 就失败
（Linux/macOS 无此问题）。改成「原目录保留 + 清空内容 + 整体铺入」，零 rename。半成品窗口由
stamp 收口：stamp 在复制全部完成后才出现在目标目录，中途崩溃留下的残缺目录下次必然重装。

**面板表现**：`能力` 工作台里该技能带「内置」徽章，删除按钮置灰禁用（hover 文案改为「内置技能，
随 dsh-chat-plus 分发，不可删除」），host 侧 `deleteSkill` 也会对带 stamp 的技能直接拒绝。

> 与围栏仍是两套输出格式：`diagram-design` 产独立 HTML（走对话截图内嵌），`diagram` 围栏产对话内
> SVG 卡片。两者都在包里，但没打通。

## 可交互卡片（proto-tabs）

总结时想放可点卡片，正文里加一个围栏（JSON，tabs 最多 4 个，minis 每 Tab 最多 4 条）：

```proto-tabs
{"title": "胶囊组件重构设计提案", "tabs": [{"label": "方案 A：信息分层", "variant": "pill", "heading": "高可读性重构", "pill": {"tag": "Embedding 向量嵌入", "desc": "把文字映射为多数值向量", "detail": "点击展开的详情"}, "minis": [{"t": "1. 视觉锚点", "d": "专有名词打 Tag"}]}]}
```

variant 可选 pill / expand / glow，缺省 pill（方案A）。未闭合围栏（流式中）与非法 JSON 都按原文显示。

> host 半身改动要重启 DSH 服务才生效（托盘「重启服务与程序」）；client 半身刷新页面即可。

## KR 对话双栏大盘

在 header 的 tablist 里注入第三个视图分类「KR对话」，与官方「对话 / 轨迹」并列。
底层仍是官方 ChatView（多轮历史、虚拟滚动、Markdown 渲染、底部输入框全部保留），
右侧多一栏全高执行大盘：

> **分工口径**：左栏对话流只留**一行**状态卡（头像 + 「Agent 正在…」+ 末尾三点），
> 任务 / 思考 / 工具调用三项明细**只由右栏大盘承担**。曾经左栏还挂一张可展开的
> 「执行进度」卡，与右栏「任务概览」是同一份内容的两个副本，已删除——同一件事在
> 两处各抄一份只会让人读到两遍。明细要看就去右栏，左栏保持干净。

```
┌─ 左栏（官方 ChatView，100% 原生）──┬─ 右栏 KrAgentPanel ──────────┐
│                                    │ ┌ 任务 ────────────────────┐ │
│   [user]  …                        │ │ todo_write / 官方 todos  │ │
│   [assistant] …                    │ └──────────────────────────┘ │
│   (Agent 正在读取文件 ··· 12s)      │ ┌ 思考 ────────────────────┐ │
│   …（左栏只有这一行状态卡）          │ │ 完整文本，25 行封顶      │ │
│                                    │ │ 挤压时逐档缩到 5 行      │ │
│                                    │ └──────────────────────────┘ │
│                                    │ ┌ 操作面板 ─────────────┐ │
│                                    │ │ 人话行动流，默认展开    │ │
│                                    │ │ 折叠时只留当前动作一行  │ │
│                                    │ └──────────────────────────┘ │
│                                    │ ┌ 记忆 ───────────────────┐ │
│                                    │ │ sticky 常驻底部         │ │
│                                    │ │ 默认折叠，只留「N 条」  │ │
│                                    │ │ 展开后只列本会话新增    │ │
│                                    │ └──────────────────────────┘ │
└────────────────────────────────────┴──────────────────────────────┘
```

> **用时挂在左栏那张「Agent 正在…」活动卡上**（`KrLiveActivityCard.tsx` 的
> `.kr-elapsed`），跟在动作名与三点之后，就是一行裸数字：`··· 1m 23s`。
> 它换过两个位置都不对：原先在大盘 footer 顶部（记忆卡正上方）被读成记忆卡的
> 副标题，试过大盘滚动区顶部 sticky 又变成右栏里一块没来由的常驻条——右栏讲的是
> 「这一轮做了什么」，用时讲的是「这一轮跑了多久」，两件事挤在同一栏里，读数必然
> 被当成某张卡的附属说明。跟着动作走，所见即所测。
> 形制上只留数字：胶囊底色与时钟图标都试过，被判定不好看。数字等宽（tabular-nums）
> 且不做显影动画——每秒播一次淡入等于每秒喊一次「变了」；运行中只把字色提一档
> （0.2s 过渡），回合结束定格。窄卡片时动作名可以省略，用时读数 `flex: none` 永远
> 完整。它只显示**真实测到**的用时：拿不到轮次生命周期起点（`turnStart`）就整枚不
> 渲染，绝不用「工具数 × 800ms」那种兜底猜测冒充。同时 `aria-hidden`——整张活动卡
> 是 `aria-live="polite"` 的 live region，读数每秒变，留在里面就是每秒播报一次时长。

四个开关（`src/client/kr-chat/enabled.ts`）都是**隐藏而非删除**：

| 开关 | 默认 | 控制 |
|---|---|---|
| `KR_CHAT_ENABLED` | true | 整套 KR 视图（「KR对话」标签 + 右栏 + KR 专属 CSS） |
| `KR_PANEL_HEADER_VISIBLE` | false | 右栏顶栏：机器人头像 + 标题 + 统计副标题 + 截图 / 收起按钮 |
| `KR_PLAIN_TIMELINE_CARD_VISIBLE` | true | 「操作面板」卡（人话行动流） |
| `KR_MEMORY_CARD_VISIBLE` | true | 「记忆」卡片 |

改回 true 重新 build（client 半身刷新页面即可）就恢复。

### 状态卡：字体、层级与动效

左栏状态卡是全屏唯一带自定义排版的 chrome，三件事刻意收在同一条基线上：

| 面 | 做法 | 为什么 |
|---|---|---|
| **字体** | `--kr-card-font: var(--dsw-font-family)` | 曾写死微软雅黑栈，结果正文（Windows 上西文归 Segoe UI）与卡片（西文归雅黑）出现两种西文字形，右栏大盘几张卡又因无声明而吃正文栈——同一功能三套字体。改跟随正文后全屏一套，且 DSH 调整正文字体时自动跟上 |
| **层级** | current 步骤 `label-secondary` + 500；状态卡动作名 500 | 曾是 `label-primary` + 600 / 550，是全屏最黑最粗的字，而它承载的只是「当前在干什么」这种辅助信息，压过了主内容。550 还是非标准字重，Segoe UI 与雅黑都没有对应字面，跨字体栈时浏览器只能合成或就近取整 |
| **动效** | 动作名变化时 220ms 显影一次 + 等待时末尾三点 | **只动 `opacity` / `transform`**，合成器属性、零 paint。原先是 `background-clip: text` 的光带扫过整行——`background-position` 走不了合成器，每一帧都要真重绘一行文字。点数选三点而非单点：语义最通用（Notion / Ant Design / Apple 一套），且不贴字尾像漏了个标点 |

三层各司其职：显影由内容变化驱动（`key={action}`，动作一变节点重建、动画自动重播），
静置时零开销；三点只在 `data-running` 时挂动画，停下来的卡上不留任何动画；
`prefers-reduced-motion` 下三点保持静止灰点而不整组抹掉——静止的点仍说明「这里有活动」。

`scripts/smoke-client.mjs` 对这套有断言，并明确禁止已被否掉的方案
（`kr-agent-text-sweep` 扫光、`kr-agent-caret` 光标、`kr-agent-mini-dot` 单点）复活。

### 记忆卡的本会话口径

「本会话新增」的判定基准是**条目溯源**，不按时间：host 在写入/更新条目时把
`provenance.sessionId` 一并落盘（自动提取、memory_remember / memory_revise 都填），
前端拿当前 sessionId 做纯等值比较。

- 与时间无关：时钟偏差、刷新时机、切会话都不影响结果；条目属于哪个会话由写它
  的那次调用说了算，不再用「进入会话的时间基线」猜（旧实现的 localStorage 基线 +
  5 分钟时钟冗余已移除）
- 更新也算：upsert 撞上已有条目时同样刷新溯源，本会话更新过的记忆照样出现在
  本会话口径里
- 旧 host 过渡窗口：host 半身要重启 DSH 才生效，旧 host 不返回 provenance 时
  本会话口径显示「暂无」——宁可少显示，也不把别的会话的记忆混进来

### 挤压自适应

`use-adaptive-rows.ts` 用 ResizeObserver 监视 `.kr-panel__scroll`：

1. 判定挤压 = `scrollHeight > clientHeight + 1`
2. 从默认 25 行逐档下调（25→18→12→8→5），每档重新测量
3. 只在**档位真正变化**时 setState——ResizeObserver → setState → 高度变化 → 再次触发
   这条链最容易写成死循环，档位比较是唯一的刹车
4. 不再溢出且当前低于默认档时回升一档（带回退，避免在阈值上抖动）

## 四工作台（原 dsh-triad 融合）

2026-09-24 把 `dsh-triad` 整体并入本插件，`dsh-triad` 从 profile bundles 摘除：
侧边栏的自动化 / 记忆 / 能力 / 用量四个入口与各自的面板，现在都来自这一个插件。

**为什么整包搬而不是各自调用**：dsh-triad 的 client 半身本来就是「纯 fetch + 同源
路由」的形态（`createMemoryApi()` 就是 fetch 包装），host 半身的路由与工具在 DSH 的
service 图上是一等公民。只调它的 API 会让两插件之间形成隐式的加载顺序依赖（谁先挂载、
对方没装怎么办），而整包搬之后四工作台的装配仍按「每模块一个 try/catch」，一个挂不起来
不影响其他三个。

**融合时守住的三条**：

1. **座位与命名空间原样保留** —— slot id / order / locale namespace / 8 组路由前缀 /
   工具名 / 数据与配置目录一字未改，用户侧零迁移
2. **相对路径同构** —— dsh-triad 的 `vendor/` 实际在仓库根（不是 `src/vendor/`），
   所以搬到 `src/vendor/`，让 `src/triad/host.ts` 的 `../vendor/...` 与
   `memory/engine` 的 `../../../vendor/...` 一个字符都不用改；86 条相对 import 逐一
   验证可解析
3. **重名不覆盖** —— `modal-animation.ts` 两版内容不等价（triad 版多 drawer
   keyframes，且 STYLE_ID 刻意加 `dsh-triad-` 前缀防样式表互相吞并），改名
   `triad-modal-animation.ts`；`error-boundary.tsx` 经 diff 确认等价，直接共用

### 用量入口瘦身（2026-09-25）

侧边栏「用量」原本是**铺满会话主区的四 tab 工作台**（明细 / 趋势 / 信号 / 余额·配额），
这一轮按「只要热力图 + token 消耗查询」的诉求砍到一张小卡片：

- **形态**：从 drawer 变 compact —— 不再盖住整个主区，而是贴入口弹出 **648×560** 的浮层
  （`PopoverShell` 新增 `variant="compact"`，宽高内联并按视口夹紧，窄屏仍回退全屏 sheet）。
  技能面板 / 记忆面板继续走原 drawer 形态，行为不变。
- **内容**：只留 52 周 Token 活动热力（每周 / 累计口径 + 指标下拉，点格子看当日模型明细）
  与范围胶囊查询（今日 … 自定义）联动的四格汇总：合计 / 输入 / 输出 / 缓存。范围只作用于
  汇总，热力图恒为全量 52 周总览。
- **连带删除**（客户端 26 个文件）：`Workbench` / `UsageTab` / `TrendTab` / `SignalTab` /
  `AccountsTab`、整套 `charts/*`（11）与 `primitives/*`（8）、`dash.tsx` / `theme.ts`；
  `range.ts` 只留预设解析与区间过滤，`aggregate.ts` 只留 `sumTokens` 与
  `averageCacheHitRate`，`api.ts` 只留 `usage()`。
- **没动 host**：8 组路由前缀一字未改，`/api/usage-stats/*` 的 signal / providers /
  account / subscriptions / budget / day-sessions 仍照常注册并对外可用（只是前端不再消费），
  换回完整工作台不需要恢复任何服务端能力。
- 热力图格子改为可配尺寸（紧凑档 9px + 单字星期标签），52 周正好一行放进 648px 卡片。

### 用量：修 compact 打不开 + 聚合 47s，加供应商/模型筛选（2026-09-26）

瘦身那一版有两处必须记下来的坑，都属于「点了没反应 / 等到失去耐心」：

- **compact 卡片点了完全没动静**：`PopoverShell` 的 props 解构里漏了 `anchor`，而函数体
  里 compact 分支要拿它算定位 → `ReferenceError: anchor is not defined` → 面板被
  `ErrorBoundary`（`fallback={null}`）静默吞掉，入口按钮还在、控制台才有痕迹。
  **教训**：compact 这类「贴在入口旁」的浮层，定位参数一旦漏解构就是纯静默失败；
  新增浮层形态后要单独点一遍，不能只靠「面板在不在」判断挂载成功。
- **聚合要 47 秒**：`collectUsage` 把「没有新事件的会话」（delta 为空）判成
  「日志被截断」，于是**每个安静会话每轮都从头重读自己的完整日志**。本机 1194 个
  persisted 会话 → 每轮全量重读。空 delta 不携带截断信息，真正的截断能从
  「有新事件但 seq 接不上」认出来。修完冷聚合 **47.11s → 0.79s**。

在此之上把聚合彻底移出请求路径：**stale-while-revalidate**（有旧快照就立刻返回，
刷新丢后台；只有 `?refresh=1` 才同步等）+ 一个自paced后台循环（启动预热，间隔
`clamp(2 × 上一轮耗时, 30s, 5min)`——语料便宜就保持新鲜，贵就自己退避而不是排队）。
面板打开因此恒为毫秒级（实测 **0.007s**）。

同时补上查询维度：

- **供应商 / 模型级联下拉**（`ScopeFilter`）：供应商取 model id 第一段斜杠前的部分
  （`provider/model`，且 provider 段内还可能有斜杠，如 `openrouter/stealth/ox-alpha`）；
  选项按 token 降序、带搜索框与滚动，浮层 portal 到 body 以避开卡片 `overflow:hidden`
  的裁切。筛选贯穿四格汇总、52 周热力与当日明细；`cacheHitRate` 按 host 口径重算
  （`cacheRead / (input + cacheRead + cacheWrite)`，一位小数），否则筛出来的值和
  全量对不上会被当成 bug。
- **筛选态下摘掉「调用次数」指标**：host 的 models 项不带调用次数，按模型拆不出来，
  归零后热力图会是一片全空的格子。
- 刷新按钮真正走 `?refresh=1`（之前只是重新拉一次，拿到的是同一份旧快照）；
  卡片高度改两档定值（414 / 560），消掉下半截约 200px 空白与内容溢出。

### 一个被实测证伪的假设

原以为 `@deepseek-ai/dsh-util-crypto` 可以像 dsh-triad 那样留在 allowlist 里（它有
`lib/index.js` 且自身零导入）。实测证伪：**profile 的 node_modules 里根本没有这个
包**，DSH 自己靠 tsx 的 `tsconfig.base.json` paths 才跑得起来，而 tsx 的 paths 只对
不在 node_modules 里的 importer 生效。装进 profile 的插件拿到的是裸 node 解析 →
`ERR_MODULE_NOT_FOUND`。所以一并 vendor 化到 `src/vendor/dsh-util-crypto/`，现在 host
产物对 `@deepseek-ai/*` **零运行时依赖**，`assertHostExternals()` 的空 allowlist 就是
这条约束的守门人。

### 冒烟（四套）

```powershell
node scripts/smoke-client.mjs       # 对话增强：7 座位 / 9 样式表 / KR 开关同源自适应
node scripts/smoke-host.mjs         # 本插件 host：3 路由 + download 工具
node scripts/smoke-triad-host.mjs   # 四工作台 host：8 组路由 + 记忆 8 工具 + 自动化 + agent 钩子，路由零撞车
node scripts/smoke-triad-client.mjs # 四工作台 client：Token 活动 52 周热力模型等纯逻辑
```

`smoke-triad-host.mjs` 从已安装位置加载 host 半身（`@deepseek-ai/*` 在 profile 里才
可解析），并显式等一拍让**被 await 的异步挂载**（usage / skills / skill-toggles）跑完
——同步 `ctx.inject` 回调里 await 的挂载在 apply 返回时还没落地，不等这一拍会误判成
「路由没注册」。

## 一句话安装（DSH）

```bash
dsh plugin --profile web add github:Kr-ATG/dsh-chat-plus
```

重启 DeepSeek Harness 即可。本包在 package.json 声明了 `dsh.bundle.patch`，
`dsh plugin add` 完成后自动加入 profile 的 bundles 层，无需手动改 patch。

本地开发安装（junction，与 dsh-done-pill 同款）：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-chat-plus" -Target D:\AI\Dsh\dsh-chat-plus
```

并在 `~/.dsh/profiles/web/cordis.patch.yml` 追加（同 id 条目按 last-write-wins 合并）：

```yaml
- insert:
    - id: dsh-chat-plus
      name: dsh-chat-plus
```

## 卸载

```bash
dsh plugin --profile web remove dsh-chat-plus
```

本地 junction 安装：删除 junction 与 profile patch 里的 insert 条目，重启 DSH。

## dsh-webui

dsh-webui 已从工作区删除，不再参与 profile 加载或运行时共存。对话增强、工具聚合、思考弹窗隔离均由本插件独立负责。

## 与 dsh-triad 的关系

**已融合，dsh-triad 退役。** 2026-09-24 起 dsh-triad 的 host / client 两半身整体并入
本插件（`src/triad/` + `src/client/triad/`），并已从 profile 的 bundles 摘除。若你的
环境里还挂着 `dsh-triad`，请去掉——两套同时挂会因为 slot id 相同（`automation-notifier`、
`dsh-memory-inject-toggle`、`tool.call.toolview` key `skill`）与路由前缀相同
（`/api/dsh-memory/*` 等 8 组）而重复注册。

融合保留的是「座位与命名空间原样」：slot id / order / locale namespace / 8 组路由前缀 /
12 个工具名 / 记忆与自动化的数据目录（`<DSH_HOME>/storages`、`<DSH_HOME>/automation/dsh-triad/`）
都没动，所以原本装在 dsh-triad 上的记忆条目、定时任务、用量统计在融合后继续可用，
不需要迁移任何数据。

## 产物体积

发布内容约 **5.4 MB**：`lib/index.js` 3.9 MB（host 半身，含融合进来的四工作台）+
`lib/client.js` 448 KB（浏览器半身，另带 822 KB 的 map 给 DevTools 断点用）+
`assets/` 968 KB（mermaid 引擎预压缩）+ 构建脚本零头。两处刻意省下来的：

- **host 半身不出 source map**：Node 只有带 `--enable-source-maps` 才读它，DSH 服务没开，十几 MB 的 map 纯属占地方（也占 git 历史）。`build.mjs` 里 host 是 `sourcemap: false`，client 保留。
- **shiki 走 fine-grained**：`shiki/core` + `shiki/engine/javascript` + 显式 import 的 34 个 grammar 与 2 个主题。之前从 `shiki` 主入口 `createHighlighter`，esbuild 会把全量 ~220 种语法（约 10 MB）内联进来，而其中未注册的那些本来也用不到（`codeToHtml` 外面套着 try/catch，未注册语言回落纯文本）。用纯 JS 正则引擎而不是 oniguruma wasm，是为了不引 wasm 文件路径依赖 —— 产物仍是单文件自包含，装到 profile 的 node_modules 里也不会找不到 wasm。代价是首次高亮慢一些（三个代码块含引擎初始化约 550ms，截图整体 1.4s 内），加语言要在 `src/shot/markdown.ts` 的 import 列表里补一行。

> 融合 dsh-triad 后 host 半身从 3.45 MB 涨到 3.9 MB（记忆引擎 + 自动化 store + usage/skills host + vendored 的 DSH 叶子模块），浏览器半身从 258 KB 涨到 448 KB（四个工作台的面板）。这部分体积换来的是一整套侧边栏工作台，且 host 侧对 `@deepseek-ai/*` 仍是零运行时依赖。

## 构建（Windows）

```powershell
node build.mjs    # esbuild 双 bundle：lib/index.js(host) + lib/client.js(browser)
```

- host 半身运行时导入仅 node: 内置 —— markdown-it / shiki / CDP 客户端 / **融合进来的
  四工作台及其 vendored DSH 叶子模块**全部内联，产物自包含。构建末尾的
  `assertHostExternals()` 拿一份**空 allowlist** 逐个扫 `lib/index.js` 里留给运行时
  解析的裸 import，命中任何一个 `@deepseek-ai/*` 就直接让构建失败（这条守卫真实拦过
  一次：`@deepseek-ai/dsh-util-crypto` 在源码 checkout 里解析得到、装进 profile 后
   ERR_MODULE_NOT_FOUND，见「一个被实测证伪的假设」）；mermaid 引擎
  （assets/vendor/mermaid.min.js.gz）随包分发，运行时由截图引擎按需解压进临时页面；
- client 半身 external react 家族 + `@deepseek-ai/*`（DSH client 模块表
  运行时提供实例），CJS 工厂包 `window.__ModuleLoader__.load` 契约。`dsh.client.inject`
  是**模块表白名单**：不在表里的 `@deepseek-ai/dsh-client-*` 会在运行时直接
  "missed the module table"，所以融合后取的是两套 inject 的并集（7 项）；
- esbuild 解析顺序：本地 node_modules → DSH checkout pnpm store（可设
  `DSH_CHECKOUT` 环境变量）。

类型检查（借用 DSH checkout 的 typescript，paths 已指向同一 checkout）：

```powershell
node <DSH>/node_modules/.pnpm/typescript@*/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

## 冒烟测试

```powershell
node scripts/smoke-client.mjs        # 对话增强：7 座位 / 9 样式表 / KR 开关同源自适应
node scripts/smoke-host.mjs          # 本插件 host：3 路由 + download 工具
node scripts/smoke-triad-host.mjs    # 四工作台 host：8 组路由 + 记忆 8 工具 + agent 钩子，路由零撞车
node scripts/smoke-triad-client.mjs  # 四工作台 client：Token 活动 52 周热力模型等纯逻辑
node scripts/test-skill-manager.mjs && node scripts/test-skill-toggles.mjs   # 技能纯逻辑
```

`smoke-*.mjs` 用 `node:vm` 假出 `window.__ModuleLoader__` + DOM + React 跑真正的
`lib/client.js`，或用桩 ctx 驱动 `lib/index.js` 的 `apply()`。几个值得知道的桩细节：

- client 桩必须给全 `slots` / `locale` / `inputTriggers` / `sessions` 四类服务——
  融合后 apply 同时装配对话增强和四工作台，少给一个，对应工作台的 try/catch 会静默
  吃掉它，座位数断言就分不清「真没注册」与「桩不够」
- `smoke-triad-host.mjs` 从**已安装位置**加载 host 半身（`@deepseek-ai/*` 在 profile 里
  才可解析），并且要显式等一拍（`setImmediate`）让被 `await` 的异步挂载跑完——同步
  `ctx.inject` 回调里 await 的挂载在 apply 返回时还没落地，不等会误判成「路由没注册」
- host 桩的 `ctx.inject` 必须真的把回调跑起来，且 scope 得是「ctx 超集 + `effect`」：
  四工作台的模块一进去就调 `webCtx.effect(fn, 'dsh-memory: routes')` 做资源回收登记，
  scope 少了 `effect` 会 TypeError，而且这个异常会从 apply 冒出去、把后面所有
  `ctx.inject` 全中断（表现为 routes / tools / listeners 全 0）

## 结构

```
src/
├── host.ts                          — host 半身：spill 图片读取 + 截图路由接入
├── shims.d.ts                       — markdown-it 插件的无官方类型声明
├── browser/                         — 零依赖 CDP 客户端 + 系统 Chrome/Edge 启动
├── shared/
│   ├── html-paths.ts              — 本地 HTML 路径抽取（截图内嵌用）
│   └── sanitize-html.ts             — 模型原始 HTML 净化（截图 markdown 管线用）
├── shot/                            — 截图 host 半身（自 webui/screenshot 移植）
│   ├── index.ts                     — /api/chat-flow/screenshot 路由（render/save/reveal/image/diagnose）
│   ├── card.ts                      — 卡片 HTML 组装（页头/标题/正文/页脚/鲸鱼署名）
│   ├── markdown.ts                  — markdown-it + shiki + mermaid 围栏识别
│   ├── theme.ts                     — 五套主题 CSS 编译（浅/深/玻璃/玻璃深/阅读版）
│   ├── presets.ts                   — 设备×画质档位（host/client 共用纯数据）
│   ├── renderer.ts                  — 常驻无头浏览器 + 串行渲染队列 + 长图分段拼接
│   └── stitch.ts                    — PNG 拼接（零依赖手写 filter/CRC32）
└── client/
    ├── index.ts                     — client 入口：样式 + 抽屉 + 三座注册
    ├── styles.ts                    — 思考 chip + 对话流卡片样式（dtt__ 命名空间）
    ├── flow-card.tsx                — 步骤卡 / 总结卡（ReplyCardMeta 统计）
    ├── modal-animation.ts           — 弹窗开合动画（截图面板共用）
    ├── thinking/
    │   └── ThinkingStepNodeView.tsx — assistant-step 替换：回合聚合思考 chip +
    │                                  卡片门控（回合结束才出卡）+ 官方正文渲染
    ├── shot/                        — 截图 client 半身（自 webui/screenshot 移植）
    │   ├── index.tsx                — assistant-actions 相机按钮（useChat 快照 ref）
    │   ├── Panel.tsx                — 截图面板（范围/版式/画质/画幅/主题 + 元素删除）
    │   ├── collect.ts               — ChatSnapshot 消息抽取（0.1.2 扁平节点形状）
    │   ├── api.ts                   — /render /save /reveal API 客户端
    │   └── styles.ts                — 面板样式（tsh__ 命名空间）
    └── tool-summary/                — 工具聚合（自 webui/dsh-tool-summary 移植）
        ├── ToolGroupNodeView.tsx    — 每回合一枚工具 chip + 抽屉入口
        ├── activity-drawer.tsx      — 共享活动抽屉（window 总线 + 居中弹窗）
        ├── tool-stats.ts            — 统计/耗时/下载解析纯函数（callView 防御式读取）
        ├── activity-kind.ts         — 调用分类徽标（git push/构建/测试…）
        ├── reasoning-classify.ts    — 思考语义分类（关键词打分）
        ├── icons.tsx                — kind 徽标 SVG 字形
        ├── use-now.ts               — 走秒时钟
        └── styles.ts                — 工具聚合样式（dts__ 命名空间）
    └── kr-chat/                     — KR 对话双栏大盘（右栏三张卡 + 底部记忆卡）
        ├── enabled.ts               — 四个「隐藏不删除」开关（KR / PANEL_HEADER / PLAIN_TIMELINE_CARD / MEMORY_CARD）
        ├── KrAgentPanel.tsx         — 右栏容器：卡片编排 + 用时计算（副标题统计用）+ 自适应行数下发
        ├── KrTaskOverviewCard.tsx   — 任务卡（todo_write / 官方 todos 投影）
        ├── KrReasoningCard.tsx      — 思考卡（有界视口 + 实时跟随滚动 + maxRows 自适应）
        ├── plain-language.ts        — 工具名 → 中文人话（站点友好名 / 只出文件名 / 命令行不上屏 / spawnsSubagents 标记）
        ├── plain-timeline.ts        — 思考播报 + 工具事实 → 人话行动时间线（纯函数，todo 折叠成一行）
        ├── subagent-catalog.ts      — 子智能体清单（ctx.sessions 的 subagentsByParent，零 RPC）
        ├── KrPlainTimelineCard.tsx  — 「操作面板」卡（人话行动流，默认展开，含子智能体区块）
        ├── KrLiveActivityCard.tsx   — 左栏「Agent 正在…」活动卡（动作名交叉淡入 + 三点 + **用时读数**）
        ├── KrMemoryCard.tsx         — 记忆卡（本会话口径、默认折叠、无新增整卡不渲染）
        ├── memory-api.ts            — /api/dsh-memory/* 最小 fetch 客户端（零依赖）
        ├── use-adaptive-rows.ts     — 挤压自适应 hook（ResizeObserver + 档位刹车）
        ├── kr-chat-store.ts         — panelOpen / selectedTurn 状态（含 localStorage）
        ├── kr-chat-controller.tsx   — 「KR对话」标签 + 「Agent 轨迹大盘」开关注入
        ├── kr-todo-bridge.ts        — 官方 todos 实时投影（同时是会话身份登记点）
        ├── KrLiveActivityCard.tsx   — 左栏对话流那张瞬态状态卡
        └── styles.ts                — KR 专属 CSS（含统一简约滚动条）
    └── triad/                       — 原 dsh-triad 四工作台 client 半身（整体搬迁）
        ├── index.ts                 — applyTriadClient（四模块各 try/catch）
        ├── memory/                  — 记忆面板 + composer 注入开关（纯 fetch）
        ├── automation/              — 定时任务面板 + notifier
        ├── usage/                   — 用量卡片（热力图 + token 消耗查询）+ 技能面板
        ├── skill-source/            — 技能面板 + `/` slash source
        ├── sidebar-nav.tsx          — 侧边栏导航行（四入口）
        ├── popover-shell.tsx        — 面板外壳（drawer / compact 两种形态）
        ├── responsive.ts            — 响应式
        └── triad-modal-animation.ts —  triad 版弹窗动画（与主插件那版不等价，故改名）
src/triad/                           — 原 dsh-triad 四工作台 host 半身
├── host.ts                          — applyTriadHost（七模块各 try/catch）
├── memory/                          — 记忆引擎：store / tools / api / engine/（extract|compile|inject|retrieval|scoring|embedding|consolidate|ticker）
├── automation/                      — 定时任务：store / scheduler / executor / routes / tool / suggestions
├── skill-toggles.ts                 — /api/skill-toggles/*
├── skill-health.ts                  — /api/skill-health
├── mcp-recommended.ts               — /api/mcp-recommended
├── mcp-status.ts                    — /api/triad/mcp-status
└── memory-store-singleton.ts        — MemoryStore 共享单例
src/vendor/                          — 内联的 DSH 叶子模块（构建时打包，零运行时 @deepseek-ai/* 依赖）
├── dsh-llm/                         — BlockAssembler / createMessage / MessageId / HarnessError …
├── dsh-tools/                       — defineTool / JSON Schema 编译校验
├── dsh-session/json.ts              — isJsonValue
├── dsh-util-crypto/index.ts         — randomUUID（原 allowlist 项，实测不可解析后 vendor 化）
└── usage-skill/                     — usage + skills host（JS，vendored）
assets/
└── vendor/
    └── mermaid.min.js.gz            — mermaid 引擎（截图带图围栏时解压使用）
scripts/
├── smoke-host.mjs                   — 本插件 host：3 路由 + download 工具
├── smoke-client.mjs                 — 对话增强：7 座位 / 9 样式表 / KR 开关自适应
├── smoke-triad-host.mjs             — 四工作台 host：8 组路由 + 工具 + agent 钩子
├── smoke-triad-client.mjs           — 四工作台 client：热力模型纯逻辑
├── test-skill-manager.mjs           — 技能管理纯逻辑
└── test-skill-toggles.mjs           — 技能开关纯逻辑
```

## 许可

MIT
