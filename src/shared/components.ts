/**
 * dsh-chat-plus — 插件「包含的组件」目录（原生行开关的唯一真相）。
 *
 * 用户在插件页面要看到的不是 66 个细项，而是**组件级**的一行一开关：
 *
 *   包含的组件  共 N 个 · N 运行中
 *   ├ 对话增强        [运行中 ●—]
 *   ├ 正文卡片        [运行中 ●—]
 *   ├ Seeker 双栏大盘 [运行中 ●—]
 *   └ ...
 *
 * DSH 插件管理器的「包含的组件」列表来自 **bundle patch 里的每一条 insert**。
 * 所以这里每登记一个组件，就对应 cordis.patch.yml 里一条 insert（name 指向
 * dsh-chat-plus/packages/<id> 的 host-only 子模块），插件页面就会自动出现
 * 一行带「运行中」开关的组件。**行开关是官方原生的**，不经过本插件自绘面板。
 *
 * 细粒度功能（src/shared/features.ts 的 66 项）仍然保留，但它们只是**内部
 * 实现视角**：每项映射到下面某一个组件，组件行关掉时该组件的全部 UI / 宿主
 * 行为一起停。这样既满足「组件级开关」，又不用把 66 个开关塞给用户。
 *
 * ⚠ 新增组件 = 三件事：这里加一行、cordis.patch.yml 加一条 insert、
 * packages/<id>/ 下放一个空的 host-only 插件与 locale/zh.json（行标题与说明
 * 从 locale 读，见 DSH 的 readPluginMeta）。
 *
 * @module
 */

/** 组件 id（= cordis.patch.yml 的 row id 后缀；主入口固定为 core）。 */
export type ComponentId =
  | 'core'
  | 'cards'
  | 'seeker'
  | 'done-pill'
  | 'memory'
  | 'skills'
  | 'usage'
  | 'gallery'
  | 'vault'
  | 'prompt'
  | 'feed'
  | 'sync'
  | 'provider'
  | 'mail'
  | 'input'
  | 'host'

/** 一个组件。 */
export interface ComponentDef {
  /** 组件 id。 */
  readonly id: ComponentId
  /** plugin manager 里的 row id（bundle patch insert 的 id）。 */
  readonly rowId: string
  /** 行标题（与 packages/<id>/locale/zh.json 的 meta.title 保持一致）。 */
  readonly title: string
  /** 一行说明（与 locale 的 meta.description 一致）。 */
  readonly description: string
  /** 默认是否开启（升级前的现状全部为开；主入口 core 恒为开）。 */
  readonly defaultEnabled: boolean
}

/** 全部组件（顺序 = 插件页面「包含的组件」里的展示顺序）。 */
export const COMPONENTS: ReadonlyArray<ComponentDef> = [
  { id: 'core', rowId: 'dsh-chat-plus', title: '对话增强', description: '思考过程、工具调用聚合、正文路径链接与每会话首步的提示词通道。', defaultEnabled: true },
  { id: 'cards', rowId: 'dsh-chat-plus-cards', title: '正文卡片', description: '把 html / iu / diagram / proto 围栏渲染成能点的卡片，外加下载进度、对话截图、生图画廊与侧栏预览。', defaultEnabled: true },
  { id: 'seeker', rowId: 'dsh-chat-plus-seeker', title: 'Seeker 双栏大盘', description: '会话里的 Seeker 视图：右栏子智能体 / 操作面板 / 任务 / 产出物 / 记忆卡，左栏思考过程与提问卡。', defaultEnabled: true },
  { id: 'done-pill', rowId: 'dsh-chat-plus-done-pill', title: '对话完成胶囊', description: '回合完成提醒：左下角小横条 / 顶部悬浮胶囊、录屏、待机机器人与健康提醒。', defaultEnabled: true },
  { id: 'memory', rowId: 'dsh-chat-plus-memory', title: '记忆工作台', description: '自动沉淀的长期记忆：按项目 / 全局分层、检索、置顶与按工作区开关。', defaultEnabled: true },
  { id: 'skills', rowId: 'dsh-chat-plus-skills', title: 'SKILL 工作台', description: '技能（Skill）安装、停用、分类、查看说明与技能包管理。', defaultEnabled: true },
  { id: 'usage', rowId: 'dsh-chat-plus-usage', title: '用量工作台', description: 'Token / 请求 / 缓存 / 输出速度的观测大盘与 52 周活动热力。', defaultEnabled: true },
  { id: 'gallery', rowId: 'dsh-chat-plus-gallery', title: '画廊', description: '跨会话的图片 / 网页 / 视频 / 文档 / 表格产出物索引。', defaultEnabled: true },
  { id: 'vault', rowId: 'dsh-chat-plus-vault', title: '档案', description: '账号密码 / 支付方式 / 联系方式 / 证件的加密档案与到期提醒。', defaultEnabled: true },
  { id: 'prompt', rowId: 'dsh-chat-plus-prompt', title: '系统提示词', description: '查看本次会话真正发送给模型的系统提示词快照。', defaultEnabled: true },
  { id: 'feed', rowId: 'dsh-chat-plus-feed', title: '动态', description: '按提示词在后台生成的个人资讯流与 X 同步。', defaultEnabled: true },
  { id: 'sync', rowId: 'dsh-chat-plus-sync', title: '同步设置', description: '工作台资产（档案 / 记忆 / 技能）的云端双向同步。', defaultEnabled: true },
  { id: 'provider', rowId: 'dsh-chat-plus-provider', title: '供应商中心', description: '官方设置里的供应商页：API Key、网络代理、模型能力、生图 / 识图 / 生视频与 AnySearch。', defaultEnabled: true },
  { id: 'mail', rowId: 'dsh-chat-plus-mail', title: 'Agent 邮箱', description: '本 Agent 的专属邮箱：收件箱 / 读信 / 附件保存与每会话首步的能力声明。', defaultEnabled: true },
  { id: 'input', rowId: 'dsh-chat-plus-input', title: '输入区增强', description: '供应商 / 模型选择器、推理强度、提示词优化、工具闸门、界面字体与 @ 运行中的程序。', defaultEnabled: true },
  { id: 'host', rowId: 'dsh-chat-plus-host', title: '宿主支撑能力', description: '截图渲染引擎、Office / PDF 预览、字体与动画资产、文件打开、运行中程序采集等后台能力。', defaultEnabled: true },
]

/** 组件 id 集合。 */
const IDS = new Set<string>(COMPONENTS.map(component => component.id))

/** 是否是合法组件 id。 */
export function isComponentId(id: string): id is ComponentId {
  return IDS.has(id)
}

/** 按 id 找组件。 */
export function componentOf(id: string): ComponentDef | undefined {
  return COMPONENTS.find(component => component.id === id)
}

/**
 * 细粒度功能 → 组件。
 *
 * 这张表是「用户看到的组件开关」与「代码里逐个 useFeature(id)」之间的桥：
 * 组件行被关掉时，下面列出的所有功能 id 一起返回 false。
 */
export const FEATURE_COMPONENT: Readonly<Record<string, ComponentId>> = {
  // ── 对话增强（core）────────────────────────────────────────────────
  'view.thinking': 'core',
  'view.stats-ttft': 'core',
  'card.path-linkify': 'core',
  'prompt.zh': 'core',
  'prompt.iu': 'core',
  'prompt.team': 'core',
  'prompt.todo-rule': 'core',
  'prompt.auto-close': 'core',

  // ── 正文卡片（cards）───────────────────────────────────────────────
  'card.html': 'cards',
  'card.iu': 'cards',
  'card.diagram': 'cards',
  'card.proto-tabs': 'cards',
  'card.download': 'cards',
  'card.screenshot': 'cards',
  'card.generated-images': 'cards',
  'card.sidebar-doc': 'cards',
  'card.sidebar-media': 'cards',

  // ── Seeker 双栏大盘（seeker）────────────────────────────────────────
  'view.seeker': 'seeker',
  'view.panel-live': 'seeker',
  'view.panel-subagents': 'seeker',
  'view.panel-tasks': 'seeker',
  'view.panel-outputs': 'seeker',
  'view.panel-memory': 'seeker',
  'view.panel-tool-calls': 'seeker',
  'view.panel-ask': 'seeker',
  'view.panel-header': 'seeker',
  'view.task-motion': 'seeker',
  'view.hero-head': 'seeker',
  'view.git-status': 'seeker',
  'view.browser-flag': 'seeker',
  'host.git-status': 'seeker',

  // ── 对话完成胶囊（done-pill）────────────────────────────────────────
  'view.done-pill': 'done-pill',
  'host.done-pill-media': 'done-pill',

  // ── 工作台（八个独立行）────────────────────────────────────────────
  'work.memory': 'memory',
  'work.skills': 'skills',
  'work.usage': 'usage',
  'work.gallery': 'gallery',
  'work.vault': 'vault',
  'work.prompt': 'prompt',
  'work.feed': 'feed',
  'work.sync': 'sync',
  'host.feed': 'feed',
  'host.system-prompt': 'prompt',

  // ── 供应商中心（provider）───────────────────────────────────────────
  'host.provider-hub': 'provider',

  // ── Agent 邮箱（mail）───────────────────────────────────────────────
  'view.mail': 'mail',
  'prompt.mail': 'mail',
  'host.mail': 'mail',

  // ── 输入区增强（input）──────────────────────────────────────────────
  'input.model-seats': 'input',
  'input.prompt-optimize': 'input',
  'input.tools-gate': 'input',
  'input.running-apps': 'input',
  'input.at-guard': 'input',
  'input.ui-font': 'input',
  'input.download-tool': 'input',
  'input.validate-card-tool': 'input',
  'host.running-apps': 'input',

  // ── 宿主支撑能力（host）────────────────────────────────────────────
  'host.generated-images': 'host',
  'host.screenshot-engine': 'host',
  'host.download': 'host',
  'host.open-path': 'host',
  'host.open-file': 'host',
  'host.fonts': 'host',
  'host.motion': 'host',
  'host.office-preview': 'host',
  'host.browser-activity': 'host',
  'host.browser-on-demand': 'host',
}

/** 查某个细粒度功能属于哪个组件；未登记时回落到 host（最保守）。 */
export function componentOfFeature(featureId: string): ComponentId {
  return FEATURE_COMPONENT[featureId] ?? 'host'
}
