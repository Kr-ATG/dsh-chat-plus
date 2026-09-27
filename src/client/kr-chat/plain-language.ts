/**
 * dsh-chat-plus — 人话翻译层（plain-language）。
 *
 * 目标读者是**不会编程的普通用户**：他们要看的不是 `browser_navigate(url)`、
 * `browser_click(ref=e12)`、`read(file_path=D:\a\b.ts)`，而是「打开携程」「点击出发地」
 * 「查看文件 KrAgentPanel.tsx」。本模块把一次工具调用（名字 + 参数 + 状态）翻成
 * `{ 图标, 动词, 细节 }` 三元组，供右栏「正在做什么」卡渲染。
 *
 * 三条硬纪律：
 *  1. **主文案绝不出现技术标识符**：函数名、参数名、完整文件路径、原始命令行
 *     一律不上屏。命令原文只进 `tech`，由用户在展开某条时主动去看。
 *  2. **细节要可读**：站点给中文友好名（携程 / 淘宝 / GitHub），路径只留文件名。
 *  3. **认不出来不猜**：未知工具统一走「执行 X」兜底，宁可笼统也不编造含义。
 *
 * 纯函数、无 React / 无 DOM 依赖，可直接在 smoke 里 import 断言。
 */

export type PlainStatus = 'running' | 'done' | 'failed'

/** 单色描边图标键（由组件映射成 SVG，与既有工具行图标同一风格）。 */
export type PlainIconKey =
  | 'globe' | 'cursor' | 'keyboard' | 'eye' | 'scroll' | 'arrow'
  | 'file' | 'folder' | 'search' | 'terminal' | 'image' | 'download'
  | 'cloud' | 'bolt' | 'task' | 'spark'

export interface PlainStep {
  readonly id: string
  readonly icon: PlainIconKey
  /** 动作短语，如「打开网页」「查看文件」。 */
  readonly verb: string
  /** 关键细节，如「携程 · 机票」「KrAgentPanel.tsx」。 */
  readonly detail?: string
  readonly status: PlainStatus
  readonly durationMs?: number
  /** 该调用派生独立子智能体会话（subagent / workflow…），需要挂子智能体区块。 */
  readonly spawnsSubagents?: boolean
  /** 二级技术信息：用户点开这一条时才需要看到。 */
  readonly tech?: { readonly name: string; readonly args?: string; readonly error?: string }
}

export interface PlainStepInput {
  readonly id?: string
  readonly toolName: string
  readonly args?: Record<string, unknown>
  /** 原始入参 JSON（技术细节用）。流式未成形时可能为空串。 */
  readonly argsRaw?: string
  readonly status: PlainStatus
  readonly durationMs?: number
  readonly errorText?: string
}

const MAX_DETAIL = 40
const MAX_SHORT = 20

/* ── 基础取值 ─────────────────────────────────────────────────────────── */

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 取第一个非空字符串字段。 */
function str(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Array.isArray(value)) {
      const picked = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      if (picked.length > 0) return picked.join('、')
    }
  }
  return undefined
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * 路径只留最后一段文件名：`D:\a\KrAgentPanel.tsx` → `KrAgentPanel.tsx`。
 * 顿号一并当分隔符：`str()` 会把数组 join 成「a.png、b.png」，此时取最后一项。
 */
function fileNameOf(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const tail = path.split(/[/\\、]/).filter(Boolean).at(-1)
  const name = tail ?? path
  return name.trim() === '' ? undefined : clip(name, MAX_DETAIL)
}

/* ── 站点友好名 ───────────────────────────────────────────────────────── */

/**
 * 域名 → 中文名。命中不了就退到主机名（去 www.），**绝不显示完整 URL**：
 * 带一长串 query 的链接对普通用户零信息量，还把一行撑爆。
 */
const SITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ctrip\.com|ly\.com/, '携程'],
  [/fliggy\.com/, '飞猪'],
  [/qunar\.com/, '去哪儿'],
  [/taobao\.com/, '淘宝'],
  [/tmall\.com/, '天猫'],
  [/jd\.com/, '京东'],
  [/meituan\.com/, '美团'],
  [/dianping\.com/, '大众点评'],
  [/bilibili\.com/, '哔哩哔哩'],
  [/zhihu\.com/, '知乎'],
  [/weibo\.com|(^|\W)x\.com/, '微博'],
  [/douyin\.com/, '抖音'],
  [/xiaohongshu\.com/, '小红书'],
  [/12306\.cn/, '铁路12306'],
  [/github\.com/, 'GitHub'],
  [/gitee\.com/, 'Gitee'],
  [/npmjs\.(com|org)/, 'npm'],
  [/pypi\.org/, 'PyPI'],
  [/bing\.com/, '必应'],
  [/baidu\.com/, '百度'],
  [/google\.[a-z.]+/, '谷歌'],
  [/youtube\.com|youtu\.be/, 'YouTube'],
  [/booking\.com/, 'Booking'],
  [/airbnb\./, 'Airbnb'],
  [/notion\.(so|site)/, 'Notion'],
  [/figma\.com/, 'Figma'],
]

/**
 * 业务意图后缀：host + pathname 里出现这些词，就在站点名后面补一个业务标签。
 * 只看 pathname 是不够的——携程的机票搜索页常年挂在 `flights.ctrip.com` 上，
 * 路径反倒是 `/online/list/oneway-ctrip`，词在主机名里。
 */
const URL_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\/flight|flightlist|\/trip|\/ticket|flights?\./i, '机票'],
  [/hotel/i, '酒店'],
  [/\/train|12306/i, '火车票'],
  [/\/movie|cinema/i, '电影'],
]

/**
 * URL → 站点中文名 + 业务后缀，如「携程 · 机票」。
 * 解析失败（相对路径、脏值）时返回 undefined，由调用方回退到别处取值。
 */
export function siteOf(url: string | undefined): string | undefined {
  if (url === undefined || url.trim() === '') return undefined
  let host = ''
  let pathname = ''
  try {
    const parsed = new URL(url.trim())
    host = parsed.hostname.replace(/^www\./i, '')
    pathname = parsed.pathname
  } catch {
    // 裸主机名（用户可能只写了 flights.ctrip.com）
    const bare = url.trim().replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? ''
    host = bare.replace(/^www\./i, '')
  }
  if (host === '') return undefined
  const site = SITES.find(([pattern]) => pattern.test(host))?.[1] ?? host
  const haystack = `${host}${pathname}`
  const hint = URL_HINTS.find(([pattern]) => pattern.test(haystack))?.[1]
  return hint === undefined ? site : `${site} · ${hint}`
}

/* ── 工具名归一 ───────────────────────────────────────────────────────── */

/**
 * 剥掉 MCP / 插件命名空间前缀，取最后一段。
 * `mcp__playwright-mcp__browser_click` → `browser_click`
 * `cua_driver_native__click` → `click`
 * 命名空间前缀由服务注册时决定，规则表不该跟着它变。
 */
export function plainToolName(toolName: string): string {
  const name = toolName.trim()
  if (name === '') return ''
  const parts = name.split('__')
  return (parts.at(-1) ?? name).toLowerCase()
}

/* ── 规则表 ───────────────────────────────────────────────────────────── */

/** 归一名 → { 动词, 图标, 取细节 }。 */
interface Rule {
  readonly verb: string
  readonly icon: PlainIconKey
  readonly detail?: (args: Record<string, unknown>) => string | undefined
}

/**
 * 完整名精确匹配。key 一律是 `plainToolName()` 之后的归一名。
 * 顺序即优先级，先命中先返回。
 */
const EXACT: Readonly<Record<string, Rule>> = {
  // ── 浏览器控制 ──────────────────────────────────────────────────────
  browser_navigate: { verb: '打开网页', icon: 'globe', detail: (a) => siteOf(str(a, 'url')) ?? clip(str(a, 'url') ?? '', MAX_SHORT) },
  browser_open: { verb: '打开网页', icon: 'globe', detail: (a) => siteOf(str(a, 'url')) ?? clip(str(a, 'url') ?? '', MAX_SHORT) },
  browser_click: { verb: '点击网页', icon: 'cursor', detail: (a) => clip(str(a, 'element', 'description', 'text') ?? str(a, 'ref') ?? '', MAX_DETAIL) },
  click: { verb: '点击网页', icon: 'cursor', detail: (a) => clip(str(a, 'element', 'description', 'text') ?? str(a, 'ref') ?? '', MAX_DETAIL) },
  browser_type: { verb: '在输入框里填写', icon: 'keyboard', detail: (a) => clip(str(a, 'text', 'value') ?? '', MAX_DETAIL) },
  insert_text: { verb: '在输入框里填写', icon: 'keyboard', detail: (a) => clip(str(a, 'text', 'value') ?? '', MAX_DETAIL) },
  type_keystrokes: { verb: '在输入框里填写', icon: 'keyboard', detail: (a) => clip(str(a, 'text', 'value') ?? '', MAX_DETAIL) },
  browser_press_key: { verb: '按下按键', icon: 'keyboard', detail: (a) => clip(str(a, 'key', 'keys') ?? '', MAX_SHORT) },
  hotkey: { verb: '按下快捷键', icon: 'keyboard', detail: (a) => clip(str(a, 'keys', 'key') ?? '', MAX_SHORT) },
  browser_snapshot: { verb: '查看当前页面', icon: 'eye' },
  get_browser_state: { verb: '查看当前页面', icon: 'eye' },
  browser_find: { verb: '在页面上查找', icon: 'search', detail: (a) => clip(str(a, 'text', 'query') ?? '', MAX_SHORT) },
  browser_scroll: { verb: '滚动页面', icon: 'scroll', detail: (a) => str(a, 'direction') },
  browser_back: { verb: '返回上一页', icon: 'arrow' },
  browser_forward: { verb: '前进一页', icon: 'arrow' },
  browser_download: { verb: '下载文件', icon: 'download' },
  browser_set_input_files: { verb: '上传文件', icon: 'download', detail: (a) => fileNameOf(str(a, 'paths', 'files')) },
  file_upload: { verb: '上传文件', icon: 'download', detail: (a) => fileNameOf(str(a, 'paths', 'files')) },
  browser_console_messages: { verb: '查看控制台输出', icon: 'terminal' },
  browser_network_requests: { verb: '查看网络请求', icon: 'cloud' },
  browser_dialog: { verb: '处理页面弹窗', icon: 'eye' },
  browser_tab_select: { verb: '切换标签页', icon: 'arrow' },
  browser_wait_for: { verb: '等待页面加载', icon: 'scroll' },

  // ── 网络 ───────────────────────────────────────────────────────────
  web_search: { verb: '搜索网络', icon: 'search', detail: (a) => clip(str(a, 'query', 'queries') ?? '', MAX_DETAIL) },
  web_fetch: { verb: '读取网页', icon: 'globe', detail: (a) => siteOf(str(a, 'url')) },
  download: { verb: '下载文件', icon: 'download', detail: (a) => fileNameOf(str(a, 'output', 'path', 'dest')) },
  generate_image: { verb: '生成图片', icon: 'image', detail: (a) => clip(str(a, 'prompt') ?? '', MAX_SHORT) },
  vision_describe: { verb: '查看图片内容', icon: 'image' },

  // ── 文件 ───────────────────────────────────────────────────────────
  read: { verb: '查看文件', icon: 'file', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  read_file: { verb: '查看文件', icon: 'file', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  view: { verb: '查看文件', icon: 'file', detail: (a) => fileNameOf(str(a, 'file_path', 'path')) },
  open_file: { verb: '打开文件', icon: 'file', detail: (a) => fileNameOf(str(a, 'file_path', 'path')) },
  write: { verb: '新建文件', icon: 'file', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  edit: { verb: '修改文件', icon: 'file', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  apply_patch: { verb: '修改文件', icon: 'file' },
  str_replace_editor: { verb: '修改文件', icon: 'file' },
  glob: { verb: '查找文件', icon: 'folder', detail: (a) => clip(str(a, 'pattern') ?? '', MAX_DETAIL) },
  find: { verb: '查找文件', icon: 'folder', detail: (a) => clip(str(a, 'pattern', 'query') ?? '', MAX_DETAIL) },
  grep: { verb: '搜索内容', icon: 'search', detail: (a) => clip(str(a, 'pattern', 'query') ?? '', MAX_DETAIL) },
  search: { verb: '搜索内容', icon: 'search', detail: (a) => clip(str(a, 'query', 'pattern') ?? '', MAX_DETAIL) },

  // ── 终端 ───────────────────────────────────────────────────────────
  // 刻意不取 command：命令行原文不是「人话」，只进 tech 由用户主动展开看。
  pwsh: { verb: '在终端执行命令', icon: 'terminal', detail: (a) => clip(str(a, 'description') ?? '', MAX_DETAIL) },
  bash: { verb: '在终端执行命令', icon: 'terminal', detail: (a) => clip(str(a, 'description') ?? '', MAX_DETAIL) },
  exec_command: { verb: '在终端执行命令', icon: 'terminal', detail: (a) => clip(str(a, 'description') ?? '', MAX_DETAIL) },

  // ── 元信息 / 协作 ──────────────────────────────────────────────────
  todo_write: { verb: '更新任务清单', icon: 'task' },
  skill: { verb: '加载技能', icon: 'spark', detail: (a) => clip(str(a, 'name') ?? '', MAX_DETAIL) },
  present: { verb: '交付文件', icon: 'file' },
  subagent: { verb: '派出子任务', icon: 'spark', detail: (a) => clip(str(a, 'description', 'prompt') ?? '', MAX_DETAIL) },
  subagent_fork: { verb: '派出子任务', icon: 'spark', detail: (a) => clip(str(a, 'description', 'prompt') ?? '', MAX_DETAIL) },
  automation: { verb: '安排定时任务', icon: 'bolt' },
  workflow: { verb: '执行 workflow', icon: 'spark', detail: (a) => clip(str(a, 'name', 'description') ?? '', MAX_DETAIL) },
  ralph: { verb: '执行 workflow', icon: 'spark', detail: (a) => clip(str(a, 'name', 'description') ?? '', MAX_DETAIL) },
}

/**
 * 会**派生独立子智能体会话**的工具。
 *
 * 这类调用有个特别之处：它派出去的子智能体不是它的 subCalls（subCalls 是
 * Code Dispatch「工具里再调工具」那条通道），而是各自独立的 session。所以在
 * 时间线上它是一条孤零零的「执行 workflow」，用户完全看不到底下有几个子智能体、
 * 各自在干什么——只能自己跑去顶栏的子智能体目录里翻。标记出这类步骤后，
 * 卡片会给它挂一个子智能体区块（见 subagent-catalog.ts）。
 */
const SPAWNING_TOOLS = new Set(['subagent', 'subagent_fork', 'workflow', 'ralph', 'subagent_control'])

/** 该工具是否会派生独立子智能体会话。 */
export function spawnsSubagents(toolName: string): boolean {
  return SPAWNING_TOOLS.has(plainToolName(toolName))
}

/**
 * 正则兜底（在 EXACT 之后按序匹配）。用于前缀族（`memory_*`、`browser_*`）
 * 与内置工具的变体名。
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, Rule]> = [
  [/^memory_(remember|add|write|create)/, { verb: '记录记忆', icon: 'bolt', detail: (a) => clip(str(a, 'content', 'text') ?? '', MAX_SHORT) }],
  [/^memory_(search|query|get|read|list)/, { verb: '检索记忆', icon: 'search' }],
  [/^browser_/, { verb: '操作浏览器', icon: 'globe' }],
  [/^cua_|^click$|^type_text$|^press_key$/, { verb: '操作电脑', icon: 'cursor' }],
  [/read|view|inspect/, { verb: '查看文件', icon: 'file' }],
  [/write|edit|patch|replace/, { verb: '修改文件', icon: 'file' }],
  [/search|grep|find|query/, { verb: '搜索', icon: 'search' }],
  [/shell|bash|exec|command|pwsh|run_code/, { verb: '在终端执行命令', icon: 'terminal' }],
  [/download|fetch|curl|wget/, { verb: '下载文件', icon: 'download' }],
  [/image|picture|draw|render/, { verb: '生成图片', icon: 'image' }],
]

/** 兜底：从参数里挑第一个像「人能读懂」的值（描述 > 文本 > 其余）。 */
const FALLBACK_DETAIL_KEYS: readonly string[] = ['description', 'text', 'name', 'title', 'query', 'url', 'path', 'file_path', 'prompt']

/* ── 主入口 ───────────────────────────────────────────────────────────── */

/**
 * 一次工具调用 → 人话步骤。
 *
 * 契约：不抛。任何畸形参数（null、数组、截断的流式 JSON）都走兜底分支，
 * 返回一个能显示的步骤——时间线里绝不能因为一条脏数据整卡空白。
 */
export function toPlainStep(input: PlainStepInput): PlainStep {
  const toolName = input.toolName ?? ''
  const name = plainToolName(toolName)
  const args = recordOf(input.args)

  const rule = EXACT[name]
    ?? PATTERNS.find(([pattern]) => pattern.test(name))?.[1]
  const verb = rule?.verb ?? (name === '' ? '执行操作' : `执行 ${name}`)
  const icon: PlainIconKey = rule?.icon ?? 'bolt'

  let detail = rule?.detail?.(args)
  if (detail === undefined || detail.trim() === '') {
    if (name === '') detail = undefined
    else {
      const picked = str(args, ...FALLBACK_DETAIL_KEYS)
      detail = picked === undefined ? undefined : clip(picked, MAX_SHORT)
    }
  }

  // 技术细节 = 工具名 + 原始入参。原始入参是「想看细节的人」唯一的凭据：
  // 主文案刻意抹掉了命令原文、完整路径与参数名，抹掉的东西得在这里还回去。
  const argsRaw = input.argsRaw?.trim() ?? ''
  const tech: PlainStep['tech'] = {
    name: toolName,
    ...(argsRaw !== '' ? { args: clip(argsRaw, 600) } : {}),
    ...(input.errorText !== undefined && input.errorText !== '' ? { error: clip(input.errorText, 200) } : {}),
  }

  return {
    id: input.id ?? `${name}:${verb}`,
    icon,
    verb,
    ...(detail !== undefined && detail !== '' ? { detail } : {}),
    status: input.status,
    ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
    ...(spawnsSubagents(toolName) ? { spawnsSubagents: true } : {}),
    tech,
  }
}

/** 工具名是否属于「一次性元信息」，需要从流程主线里挪到末尾。 */
export function isMetaTool(toolName: string): boolean {
  return plainToolName(toolName) === 'todo_write'
}
