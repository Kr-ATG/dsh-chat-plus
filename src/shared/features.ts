/**
 * dsh-chat-plus — 功能开关目录（host / client 共用的唯一真相）。
 *
 * 每一个用户可见的细粒度能力，都必须先在这里登记一行；它是内部实现视角，
 * 不是用户看到的开关粒度 —— 用户在插件页面看到的是 src/shared/components.ts
 * 里的 15 个「包含的组件」行，每项功能通过 FEATURE_COMPONENT 归到某一行。
 * 三处消费同一份表，不允许各自另写一张：
 *
 *   1. host 半身：src/features/host.ts 用它生成默认值与 /api/chat-flow/features 回包；
 *   2. client 半身：src/client/features/store.ts 用它做首帧默认值与归一化；
 *   3. 插件页面板：src/client/features/panel.tsx 按 group 渲染开关列表。
 *
 * 新增功能时只做两件事：在这里加一行；在挂载点用 featureEnabledNow(id) /
 * hostFeatureEnabled(id) 包一层。**默认值必须等于「升级前的现状」**——升级本身
 * 不该改变任何人的界面，开关只服务于「想关的时候关」。
 *
 * 命名约定：
 *   · view.*    Seeker 视图与右栏 / 对话流里的常驻卡
 *   · card.*    正文围栏渲染器与消息操作行
 *   · input.*   输入区工具栏与模型可见工具
 *   · work.*    操作间的工作台页面
 *   · prompt.*  每会话首步注入的提示词通道（与大盘设置里的同名开关叠加）
 *   · host.*    宿主侧支撑能力（路由 / 采集器 / 渲染引擎，改完需重启 DSH）
 *
 * apply 字段只描述「拨动之后什么时候生效」，不是权限：
 *   · live   —— 组件内部订阅开关，拨完立刻生效；
 *   · reload —— 在插件 apply 时决定要不要挂，拨完刷新页面后生效；
 *   · host   —— 宿主侧能力，拨完重启 DSH 后生效。
 */

/** 功能所属分组。 */
export type FeatureGroupId = 'view' | 'cards' | 'input' | 'workbench' | 'prompt' | 'host'

/** 生效时机。 */
export type FeatureApply = 'live' | 'reload' | 'host'

/** 一条功能定义。 */
export interface FeatureDef {
  /** 稳定 id（点分命名，组件映射与冒烟断言都按它引用，不要改名）。 */
  readonly id: string
  /** 分组。 */
  readonly group: FeatureGroupId
  /** 开关行标题（尽量短，一句话说清是什么）。 */
  readonly label: string
  /** 一行说明（「关掉会怎样」，不是功能介绍）。 */
  readonly desc: string
  /** 默认值：必须等于升级前的现状。 */
  readonly default: boolean
  /** 生效时机。 */
  readonly apply: FeatureApply
}

/** 分组定义（顺序即面板里的渲染顺序）。 */
export const FEATURE_GROUPS: ReadonlyArray<{
  readonly id: FeatureGroupId
  readonly label: string
  readonly desc: string
}> = [
  { id: 'view', label: '对话视图与右栏', desc: 'Seeker 双栏大盘、右栏卡片与对话流里的常驻卡' },
  { id: 'cards', label: '正文卡片', desc: '围栏渲染器与消息操作行' },
  { id: 'input', label: '输入区与工具栏', desc: '输入框上方的座位、工具闸门与模型可见工具' },
  { id: 'workbench', label: '操作间工作台', desc: '侧栏「操作间」里的七个页面' },
  { id: 'prompt', label: '提示词通道', desc: '每会话首步注入一次；与 Seeker 大盘设置里的同名开关叠加，任一关闭即关闭' },
  { id: 'host', label: '宿主支撑能力', desc: '路由、采集器与渲染引擎；拨完需要重启 DSH 才生效' },
]

/**
 * 全部功能。顺序在组内即展示顺序。
 *
 * ⚠ 默认值与现状的对应关系（改之前先看一眼）：
 *   · view.panel-header 现状是隐藏（enabled.ts 的 KR_PANEL_HEADER_VISIBLE = false）；
 *   · 其余全部默认开。
 */
export const FEATURES: ReadonlyArray<FeatureDef> = [
  // ── 对话视图与右栏 ────────────────────────────────────────────────────
  { id: 'view.seeker', group: 'view', label: 'Seeker 双栏视图', desc: '关闭后只剩官方单栏对话：不注入 Seeker 标签、不挂右栏大盘与专属样式。', default: true, apply: 'reload' },
  { id: 'view.panel-live', group: 'view', label: '操作面板卡', desc: '右栏把工具调用翻成中文人话的实时时间线；关掉后右栏少一张卡。', default: true, apply: 'live' },
  { id: 'view.panel-subagents', group: 'view', label: '子智能体卡', desc: '右栏列出本场会话派出的子智能体，点一行跳到子会话。', default: true, apply: 'live' },
  { id: 'view.panel-tasks', group: 'view', label: '任务卡', desc: '右栏展示本轮任务清单（todo_write）；关掉后清单只留在模型侧。', default: true, apply: 'live' },
  { id: 'view.panel-outputs', group: 'view', label: '产出物卡', desc: '右栏汇总本次对话做出来的文件，可点开预览。', default: true, apply: 'live' },
  { id: 'view.panel-memory', group: 'view', label: '记忆卡', desc: '右栏底部钉住的本会话新增记忆；关掉后记忆仍在工作台里。', default: true, apply: 'live' },
  { id: 'view.panel-tool-calls', group: 'view', label: '工具调用卡', desc: '右栏技术视角的工具调用台账；关掉后工具细节只留在操作面板的折叠里。', default: true, apply: 'live' },
  { id: 'view.panel-ask', group: 'view', label: '提问与回答卡', desc: '对话流里展示模型问了什么、你答了什么；关掉后问答不再单独成卡。', default: true, apply: 'live' },
  { id: 'view.thinking', group: 'view', label: '思考过程卡', desc: '对话流里贴在助手行上的思考过程；关掉后思考交回官方折叠行。', default: true, apply: 'live' },
  { id: 'view.panel-header', group: 'view', label: '大盘顶栏', desc: '右栏顶部的头像 + 标题 + 统计 + 截图按钮；默认不显示。', default: false, apply: 'live' },
  { id: 'view.task-motion', group: 'view', label: '任务动画', desc: '卡头那 9 段按状态切换的透明底人物动画；关掉后显示静态首帧。', default: true, apply: 'live' },
  { id: 'view.hero-head', group: 'view', label: '新对话页卡头', desc: '空白新对话页上方的 Seeker 卡头；发出首条消息后本来就会自动摘掉。', default: true, apply: 'live' },
  { id: 'view.git-status', group: 'view', label: '卡头 Git 状态', desc: '操作面板卡头的 Git 徽章与一键提交 / Git 大盘入口。', default: true, apply: 'live' },
  { id: 'view.mail', group: 'view', label: '邮箱按钮', desc: '卡头右上角的信封按钮与未读角标；关掉后邮箱工作台仍可从操作间进入。', default: true, apply: 'live' },
  { id: 'view.browser-flag', group: 'view', label: '浏览器操作标志', desc: '该会话正在操作浏览器时亮起的呼吸小图标（可点击拉窗口到前台）。', default: true, apply: 'live' },
  { id: 'view.done-pill', group: 'view', label: '对话完成胶囊', desc: '回合完成提醒小横条 / 顶部悬浮胶囊（含录屏与待机机器人）。', default: true, apply: 'live' },
  { id: 'view.stats-ttft', group: 'view', label: '首 token 平铺', desc: '输入框下状态栏显示首 token 平均耗时；关掉后只在官方统计卡里看。', default: true, apply: 'live' },

  // ── 正文卡片 ──────────────────────────────────────────────────────────
  { id: 'card.html', group: 'cards', label: 'HTML 沙箱卡片', desc: '把 ```html 围栏渲染成独立 iframe 里真正能跑的页面。', default: true, apply: 'live' },
  { id: 'card.iu', group: 'cards', label: 'iu 原生交互卡片', desc: '把 ```iu 围栏渲染成滑块 / 表格 / 看板 / 测验等原生卡片。', default: true, apply: 'live' },
  { id: 'card.diagram', group: 'cards', label: 'diagram 卡片', desc: '把 ```diagram 围栏渲染成流程图 / 架构图（历史兼容通道）。', default: true, apply: 'live' },
  { id: 'card.proto-tabs', group: 'cards', label: 'proto-tabs 卡片', desc: '把 ```proto 围栏渲染成可切换的原型标签页。', default: true, apply: 'live' },
  { id: 'card.download', group: 'cards', label: '下载进度卡片', desc: 'download 工具调用行的实时进度 / 速度 / ETA 卡片。', default: true, apply: 'live' },
  { id: 'card.screenshot', group: 'cards', label: '对话截图', desc: '助手消息操作栏的相机按钮与截图面板。', default: true, apply: 'live' },
  { id: 'card.generated-images', group: 'cards', label: '生图实时卡与画廊', desc: '生图时按图片比例与张数演点阵动画，出图就在对话流显示；多图收成一条横向画廊。', default: true, apply: 'live' },
  { id: 'card.path-linkify', group: 'cards', label: '裸路径转链接', desc: '正文里的文件路径自动变成可点链接，单张图片路径直接渲染成图。', default: true, apply: 'live' },
  { id: 'card.sidebar-doc', group: 'cards', label: 'PDF / Office 侧栏预览', desc: '接管官方 PDF / Word / PPT 预览（官方内嵌 pdf.js 对带 /ID 的 PDF 会崩）。', default: true, apply: 'live' },
  { id: 'card.sidebar-media', group: 'cards', label: '音视频侧栏预览', desc: '接管 mp4 / webm / mov / mp3 / wav 的原生播放（官方此前显示「不支持预览」）。', default: true, apply: 'live' },

  // ── 输入区与工具栏 ────────────────────────────────────────────────────
  { id: 'input.model-seats', group: 'input', label: '供应商 / 模型座位', desc: '输入框上方的供应商标签、模型选择器与推理强度滑杆。', default: true, apply: 'live' },
  { id: 'input.prompt-optimize', group: 'input', label: '提示词优化', desc: '输入框右侧的 ✨ 图标：用当前模型把草稿改写成更清晰的提示词。', default: true, apply: 'live' },
  { id: 'input.tools-gate', group: 'input', label: '工具闸门', desc: '输入框左侧的 computer-use / browser-use 按需开关胶囊。', default: true, apply: 'live' },
  { id: 'input.running-apps', group: 'input', label: '@ 运行中的程序', desc: '输入 @ 时在候选最上面列出此刻真开着的窗口。', default: true, apply: 'live' },
  { id: 'input.at-guard', group: 'input', label: '@ 非路径守卫', desc: '防止「@的时候」这类普通中文被误渲染成不存在的文件芯片。', default: true, apply: 'live' },
  { id: 'input.ui-font', group: 'input', label: '界面字体', desc: '整站字体两档切换（微软雅黑 / 霞鹜新致宋）。', default: true, apply: 'live' },
  { id: 'input.download-tool', group: 'input', label: 'download 工具', desc: '让模型可以把文件下载给你的内置工具。', default: true, apply: 'host' },
  { id: 'input.validate-card-tool', group: 'input', label: 'validate_html_card 工具', desc: '发卡前自检 HTML 卡片规则（外链 / 100vh / 整页底色等）。', default: true, apply: 'host' },

  // ── 操作间工作台 ──────────────────────────────────────────────────────
  { id: 'work.memory', group: 'workbench', label: '记忆', desc: '长期记忆工作台（自动沉淀、检索、置顶与按项目分层）。', default: true, apply: 'live' },
  { id: 'work.skills', group: 'workbench', label: 'SKILL', desc: '技能管理工作台（安装 / 停用 / 分类 / 查看说明）。', default: true, apply: 'live' },
  { id: 'work.usage', group: 'workbench', label: '观测 / 用量', desc: 'Token、请求、缓存与速度的观测大盘。', default: true, apply: 'live' },
  { id: 'work.gallery', group: 'workbench', label: '画廊', desc: '跨会话的图片 / 网页 / 视频 / 文档产出物索引。', default: true, apply: 'live' },
  { id: 'work.vault', group: 'workbench', label: '档案', desc: '账号密码 / 支付方式 / 联系方式 / 证件的加密档案。', default: true, apply: 'live' },
  { id: 'work.prompt', group: 'workbench', label: '系统提示词', desc: '查看本次会话真正发送给模型的系统提示词快照。', default: true, apply: 'live' },
  { id: 'work.sync', group: 'workbench', label: '同步设置', desc: '工作台配置的导入导出 / 同步页面。', default: true, apply: 'live' },

  // ── 提示词通道（与 Seeker 大盘设置叠加）──────────────────────────────
  { id: 'prompt.zh', group: 'prompt', label: '中文优先', desc: '每会话首步注入：中文思考与输出（代码 / 路径 / 报错保持原文）。', default: true, apply: 'live' },
  { id: 'prompt.iu', group: 'prompt', label: '对话内交互卡片', desc: '每会话首步注入 ```iu 与 ```html 的能力说明。', default: true, apply: 'live' },
  { id: 'prompt.team', group: 'prompt', label: '团队协作', desc: '每会话首步注入：什么时候该派子智能体、多代理怎么分工。', default: true, apply: 'live' },
  { id: 'prompt.mail', group: 'prompt', label: 'Agent 邮箱', desc: '每会话首步注入：本 Agent 有专属邮箱，注册 / 验证码场景直接用。', default: true, apply: 'live' },
  { id: 'prompt.todo-rule', group: 'prompt', label: '任务清单纪律', desc: '每会话首步注入：清单怎么列、怎么推进、怎么收尾。', default: true, apply: 'live' },
  { id: 'prompt.auto-close', group: 'prompt', label: '回合结束自动收口', desc: '回合收口时把残留的「进行中」清单项降级为「待办」（不进提示词）。', default: true, apply: 'live' },

  // ── 宿主支撑能力（需重启 DSH）────────────────────────────────────────
  { id: 'host.generated-images', group: 'host', label: '生图读取 / 落盘', desc: '把 spill 里的生图结果读出来并落成真实文件，供画廊与侧栏使用。', default: true, apply: 'host' },
  { id: 'host.screenshot-engine', group: 'host', label: '截图渲染引擎', desc: '常驻无头浏览器，把消息卡片渲染成 PNG。', default: true, apply: 'host' },
  { id: 'host.download', group: 'host', label: '下载进度路由', desc: 'download 工具的实时进度查询路由。', default: true, apply: 'host' },
  { id: 'host.open-path', group: 'host', label: '资源管理器打开修复', desc: '修官方在 Windows 上被 windowsHide 吞掉窗口的问题。', default: true, apply: 'host' },
  { id: 'host.open-file', group: 'host', label: '系统默认应用打开', desc: '产出物 / 画廊 / 弹窗里点一下用系统默认应用打开。', default: true, apply: 'host' },
  { id: 'host.fonts', group: 'host', label: '字体资产', desc: '/api/chat-flow/fonts/*：霞鹜新致宋 woff2 与许可原文。', default: true, apply: 'host' },
  { id: 'host.motion', group: 'host', label: '任务动画资产', desc: '/api/chat-flow/motion/*：9 段 WebM 与首帧海报。', default: true, apply: 'host' },
  { id: 'host.done-pill-media', group: 'host', label: '胶囊录屏 / 音效', desc: '录屏窗口枚举、逐帧抓取与提示音静态资源。', default: true, apply: 'host' },
  { id: 'host.office-preview', group: 'host', label: 'Office / PDF 预览', desc: 'ppt/word/pdf 的页图渲染与侧栏接管。', default: true, apply: 'host' },
  { id: 'host.running-apps', group: 'host', label: '运行中程序采集器', desc: '常驻 PowerShell 子进程，枚举可见窗口（@ 菜单与浏览器窗口激活共用）。', default: true, apply: 'host' },
  { id: 'host.browser-activity', group: 'host', label: '浏览器活动观测', desc: '包装 tools/execute 记录哪些会话正在跑浏览器操作。', default: true, apply: 'host' },
  { id: 'host.browser-on-demand', group: 'host', label: '浏览器按需拉起', desc: '命中浏览器工具时才拉起 9222 的 Chrome，空闲 5 分钟关掉。', default: true, apply: 'host' },
  { id: 'host.mail', group: 'host', label: 'Agent Mail 宿主', desc: '/api/dsh-mail/* 与 mail_* 工具。', default: true, apply: 'host' },
  { id: 'host.git-status', group: 'host', label: 'Git 状态路由', desc: '/api/chat-flow/git-status 与 Git 大盘数据。', default: true, apply: 'host' },
  { id: 'host.system-prompt', group: 'host', label: '系统提示词观测', desc: '抓每步真正组装出来的系统提示词快照。', default: true, apply: 'host' },
  { id: 'host.provider-hub', group: 'host', label: '供应商中心', desc: '网络代理、模型能力、生图 / 识图 / 生视频、AnySearch 与凭据密钥环。', default: true, apply: 'host' },
]

/** 默认值表（id → 布尔）。 */
export const DEFAULT_FEATURES: Readonly<Record<string, boolean>> = Object.freeze(
  Object.fromEntries(FEATURES.map(feature => [feature.id, feature.default])),
)

/** 合法 id 集合。 */
const FEATURE_IDS = new Set(FEATURES.map(feature => feature.id))

/** 分组 id 集合。 */
const GROUP_IDS = new Set(FEATURE_GROUPS.map(group => group.id))

/** 是否是已知功能 id。 */
export function isFeatureId(id: string): boolean {
  return FEATURE_IDS.has(id)
}

/**
 * 把任意来源（JSON 文件 / localStorage / HTTP 回包）的开关值收敛成完整表：
 *   · 只认已知 id；
 *   · 只认显式 boolean；
 *   · 缺的 / 脏的一律回落到该功能的默认值（升级新增功能自动获得默认值）。
 */
export function normalizeFeatures(raw: unknown): Record<string, boolean> {
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const out: Record<string, boolean> = {}
  for (const feature of FEATURES) {
    const value = source[feature.id]
    out[feature.id] = typeof value === 'boolean' ? value : feature.default
  }
  return out
}

/** 读一个开关的当前值（未知 id 返回 false，不抛）。 */
export function featureEnabled(values: Record<string, boolean> | undefined, id: string): boolean {
  if (values !== undefined && typeof values[id] === 'boolean') return values[id] as boolean
  return DEFAULT_FEATURES[id] === true
}

/** 统计开启数量（面板摘要用）。 */
export function enabledFeatureCount(values: Record<string, boolean>): number {
  let count = 0
  for (const feature of FEATURES) if (values[feature.id] === true) count += 1
  return count
}

/** 按分组取功能（面板渲染用）。 */
export function featuresOfGroup(group: FeatureGroupId): FeatureDef[] {
  return FEATURES.filter(feature => feature.group === group)
}

/** 分组是否合法（防御外部 JSON）。 */
export function isFeatureGroupId(id: string): id is FeatureGroupId {
  return GROUP_IDS.has(id as FeatureGroupId)
}
