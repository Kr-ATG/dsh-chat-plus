/**
 * dsh-chat-plus — 人话翻译层（plain-language）。
 *
 * 目标读者是**不会编程的普通用户**：他们要看的不是 `browser_navigate(url)`、
 * `browser_click(ref=e12)`、`read(file_path=D:\a\b.ts)`，而是「打开携程」「点击出发地」
 * 「查看文件 KrAgentPanel.tsx」。本模块把一次工具调用（名字 + 参数 + 状态）翻成
 * `{ 图标, 动词, 细节 }` 三元组，供右栏「操作面板」卡渲染。
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

/**
 * 单色描边图标键（由组件映射成 SVG，与既有工具行图标同一风格）。
 *
 * 文件族刻意拆成四枚而不是共用一个「文档」：这张卡的读者靠图标一眼分辨**在看 /
 * 在改 / 在建 / 在删**，四者共用一枚图标时，一列扫下来全是同一个形状，等于
 * 什么也没说。四枚共用同一份文件轮廓（缩到左侧、右下角让出位置），叠不同的
 * 动作符号——既在视觉上成一家，又不撞形。
 */
export type PlainIconKey =
  | 'globe' | 'cursor' | 'keyboard' | 'eye' | 'scroll' | 'arrow'
  | 'file' | 'fileView' | 'fileEdit' | 'fileNew' | 'trash'
  | 'folder' | 'search' | 'terminal' | 'image' | 'download'
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
  /**
   * 这一步是**读**还是**写**（对用户可见世界的影响）。
   *
   * 「简要」模式下只留 `write`：普通用户不关心模型翻了多少个文件、点了几次屏幕，
   * 但「改了哪个文件」「出了什么事」必须一条不漏地看到。这个判定不能靠 icon 猜
   * （同一个 file 图标既能是读也能是写），只能由规则表显式声明。
   */
  readonly impact?: PlainImpact
  /**
   * 失败时的人话原因，如「文件不存在」「没权限」「连不上」。
   *
   * 失败是这个卡上**最该被看见**的一件事，而一枚红叉只说了"有件事没成"，
   * 没说"什么事"。用户点开技术细节去翻 `ENOENT: no such file or directory` 是
   * 不现实的——那不是他该读的东西。取不到人话原因时退回 undefined（宁可空着，
   * 也不把一句英文报错原样糊到普通用户脸上）。
   */
  readonly issue?: string
  /** 该调用派生独立子智能体会话（subagent / workflow…），需要挂子智能体区块。 */
  readonly spawnsSubagents?: boolean
  /** 二级技术信息：用户点开这一条时才需要看到。 */
  readonly tech?: { readonly name: string; readonly args?: string; readonly error?: string }
}

/**
 * 一步动作对用户的影响面。
 *
 *  · `write` —— 改变了什么：写了/改了/删了文件、下载/生成/上传了东西、派了子任务、
 *    记了记忆。简要模式下一律保留。
 *  · `read`  —— 只是看了看：翻文件、浏览网页、点链接、滚动、截图、查配置。普通用户
 *    完全不在意，简要模式下折叠掉（同一段连续读只留最后一条，免得"翻了 12 个文件"
 *    变成一行废话）。
 *  · undefined —— 没声明。规则表漏了某条工具时按 `read` 处理（少显示好过刷屏）。
 */
export type PlainImpact = 'read' | 'write'

export interface PlainStepInput {
  readonly id?: string
  readonly toolName: string
  readonly args?: Record<string, unknown>
  /** 原始入参 JSON（技术细节用）。流式未成形时可能为空串。 */
  readonly argsRaw?: string
  /**
   * 工具返回文本（可选）。只为一条规则服务：浏览器导航要靠它认出「被重定向到
   * 别处了」——请求 URL 和落地 URL 不一致时，用户看到「打开 A → 落到 B」才知道
   * 事情没成。没有它就退化成只显示请求站点，功能不残。
   */
  readonly resultText?: string
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

/**
 * 把 JSON 里的 \uXXXX 转义还原成字符。
 *
 * 工具的 description / 参数里经常带转义序列（注入词条、schema 描述都是
 * JSON 编出来的），原样透到卡片上就成了「搜索内容 · 正在做什么（\u66e3）」——
 * 用户看到的是一串机器码，不是内容。只解 \uXXXX 一种，别的转义原样保留
 * （路径里的 `\\` 就该保持原样）。
 */
function unescapeUnicode(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => {
    const code = Number.parseInt(hex, 16)
    return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : _match
  })
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
 *
 * 入参防御：非字符串一律按空名处理。这不是洁癖——`callName()` 的「无 kind」
 * 分支返回的是 `block.name`，块缺这个字段时就是 undefined，于是
 * `isMetaTool()` → `plainToolName()` 会在一个畸形节点上抛 TypeError，
 * 整条人话时间线一起消失。宁可把它显示成「执行操作」，也不能因为一条脏数据
 * 让整张卡空白。
 */
export function plainToolName(toolName: string | undefined | null): string {
  if (typeof toolName !== 'string') return ''
  const name = toolName.trim()
  if (name === '') return ''
  const parts = name.split('__')
  return (parts.at(-1) ?? name).toLowerCase()
}

/* ── 规则表 ───────────────────────────────────────────────────────────── */

/** 滚动方向：工具给的是英文枚举，卡片上不该出现「down」。 */
const SCROLL_DIRECTION: Readonly<Record<string, string>> = {
  down: '向下', up: '向上', left: '向左', right: '向右',
  top: '到顶部', bottom: '到底部',
}

/**
 * 表单填写内容：`browser_fill_form` 的 `fields: [{ text }, …]`。
 * 只取每个字段的文本值 join 起来（「北京、上海」），字段名/ref 是技术标识，不上屏。
 */
function fillFormFields(args: Record<string, unknown>): string | undefined {
  const fields = args.fields
  if (!Array.isArray(fields)) return undefined
  const texts = fields
    .map((field) => (typeof field === 'object' && field !== null
      ? str(field as Record<string, unknown>, 'text', 'value', 'label')
      : undefined))
    .filter((value): value is string => value !== undefined && value.trim() !== '')
  return texts.length === 0 ? undefined : clip(texts.join('、'), MAX_DETAIL)
}

/**
 * 工具结果里的**最终落地 URL**。
 *
 * 浏览器工具的返回文本会带一行 `Page URL: …`，那是导航真正落到的地址，不是模型
 * 请求的那个。两者不一致 = 发生了重定向，而这恰恰是「我要的东西拿到了吗」最
 * 关键的一条事实：实测 `https://flights.ctrip.com/online/list/oneway-ctrip?dcity=bjs&acity=sha`
 * 会被携程打回 `/online/channel` 首页 —— 只显示「打开网页 · 携程 · 机票」的话，
 * 用户会以为搜索已经成功，实际上页面根本没进去。
 *
 * 抓不到就返回 undefined：没有这行、或换了别的工具格式，都不该让正常展示退化。
 */
function landedUrlOf(resultText: string | undefined): string | undefined {
  if (resultText === undefined) return undefined
  const match = /Page URL:\s*(https?:\/\/[^\s\n]+)/.exec(resultText)
  return match?.[1]
}

/** 归一化到 origin + path（query/hash 不参与「是不是同一页」的判断）。 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

/** 请求 URL 是否带了查询参数。 */
function hasQuery(url: string): boolean {
  try {
    return new URL(url).search.length > 1
  } catch {
    return url.includes('?')
  }
}

/**
 * 「目标信息被丢掉」：请求带了 query，落地却一个参数都没剩。
 *
 * 这是最该被说出来的一种——实测 `flights.ctrip.com/online/list/oneway-ctrip?dcity=bjs&acity=sha`
 * 会被携程打回 `/online/channel`，目的地、日期全丢，页面停在首页。用户若只看到
 * 「打开网页 · 携程 · 机票」，会以为北京→上海的搜索已经跑完了。
 */
function intentDropped(requested: string, landed: string): boolean {
  if (!hasQuery(requested)) return false
  try {
    const wanted = [...new URL(requested).searchParams.keys()]
    if (wanted.length === 0) return false
    const got = new URL(landed).searchParams
    return wanted.some((key) => !got.has(key))
  } catch {
    return false
  }
}

/** 根路径跳到站内子路径 = 站点自己的默认落地，不算「没跳到要去的地方」。 */
function isDefaultLanding(requested: string): boolean {
  try {
    const parsed = new URL(requested)
    return parsed.pathname === '/' && parsed.search.length <= 1
  } catch {
    return false
  }
}

/**
 * 打开网页的细节：站点友好名 + （跳转发生时）跳到哪。
 *
 * 四种说法，按信息量选：
 *  · 落在同一页 → `携程 · 机票`
 *  · 跳去了**别的站** → `携程 · 机票 → 去哪儿`（站点名已不同，补路径是噪音）
 *  · 跳去同站、但**请求里的查询参数被丢掉** → `携程 · 机票 · 目标信息已被忽略`
 *  · 跳去同站别处（其余情况）→ `携程 · 机票 · 被重定向`
 *
 * 「根路径跳到站内子路径」不算跳转：携程首页就会自动落到 /online/channel/domestic，
 * 那是站点自己的默认落地，把它报成「被重定向」等于天天误报。
 */
function navigateDetail(args: Record<string, unknown>, resultText?: string): string | undefined {
  const requested = str(args, 'url')
  const site = siteOf(requested) ?? (requested === undefined ? undefined : clip(requested, MAX_SHORT))
  const landed = landedUrlOf(resultText)
  if (landed === undefined || requested === undefined) return site
  if (normalizeUrl(landed) === normalizeUrl(requested)) return site
  const landedSite = siteOf(landed)
  if (landedSite !== undefined && site !== undefined && landedSite !== site) return `${site} → ${landedSite}`
  if (site === undefined) return undefined
  if (isDefaultLanding(requested)) return site
  if (intentDropped(requested, landed)) return `${site} · 目标信息已被忽略`
  return `${site} · 被重定向`
}

/** 归一名 → { 动词, 图标, 取细节 }。 */
interface Rule {
  readonly verb: string
  readonly icon: PlainIconKey
  /**
   * 这一步是读还是写。**不写就按 read 处理**（少显示好过刷屏），
   * 所以只有"改变了什么"的那几条需要显式声明 `impact: 'write'`。
   */
  readonly impact?: PlainImpact
  readonly detail?: (args: Record<string, unknown>, resultText?: string) => string | undefined
}

/**
 * 完整名精确匹配。key 一律是 `plainToolName()` 之后的归一名。
 * 顺序即优先级，先命中先返回。
 */
const EXACT: Readonly<Record<string, Rule>> = {
  // ── 浏览器控制 ──────────────────────────────────────────────────────
  browser_navigate: { verb: '打开网页', icon: 'globe', impact: 'write', detail: navigateDetail },
  browser_open: { verb: '打开网页', icon: 'globe', impact: 'write', detail: navigateDetail },
  /*
   * playwright-mcp 的两个高频工具原先都掉进 /^browser_/ 兜底，只得到一句干巴巴的
   * 「操作浏览器」——而它们恰恰是信息量最大的两个：fill_form 装着「这次要往哪些
   * 字段里填什么」，evaluate 多半装着「在页面上做了什么 / 读到了什么」。
   */
  browser_fill_form: { verb: '填写表单', icon: 'keyboard', impact: 'write', detail: (a) => fillFormFields(a) },
  browser_evaluate: { verb: '操作页面', icon: 'cursor', impact: 'write' },
  browser_click: { verb: '点击网页', icon: 'cursor', impact: 'write', detail: (a) => clip(str(a, 'element', 'description', 'text') ?? str(a, 'ref') ?? '', MAX_DETAIL) },
  click: { verb: '点击屏幕', icon: 'cursor', impact: 'write', detail: (a) => clip(str(a, 'element', 'description', 'text') ?? str(a, 'ref') ?? '', MAX_DETAIL) },

  // ── 桌面控制（cua-driver）：命名空间前缀被剥掉后剩下的都是通用短名，
  //    既匹配不上 /^cua_/ 兜底、也看不出是干什么的，只能落到「执行 X」。
  //    实机验收时右栏一屏都是「执行 get_window_state」「执行 zoom」。
  get_window_state: { verb: '查看窗口内容', icon: 'eye' },
  list_windows: { verb: '列出窗口', icon: 'eye' },
  get_list_windows: { verb: '列出窗口', icon: 'eye' },
  get_accessibility_tree: { verb: '读取界面元素', icon: 'eye' },
  get_screen_size: { verb: '查看屏幕尺寸', icon: 'eye' },
  get_cursor_position: { verb: '查看鼠标位置', icon: 'cursor' },
  get_agent_cursor_state: { verb: '查看光标状态', icon: 'cursor' },
  move_cursor: { verb: '移动鼠标', icon: 'cursor' },
  bring_to_front: { verb: '激活窗口', icon: 'arrow' },
  list_apps: { verb: '列出应用', icon: 'folder' },
  launch_app: { verb: '启动应用', icon: 'bolt', impact: 'write' },
  kill_app: { verb: '关闭应用', icon: 'bolt', impact: 'write' },
  double_click: { verb: '双击屏幕', icon: 'cursor', impact: 'write' },
  right_click: { verb: '右键点击', icon: 'cursor', impact: 'write' },
  drag: { verb: '拖拽', icon: 'cursor', impact: 'write' },
  scroll: { verb: '滚动', icon: 'scroll' },
  press_key: { verb: '按下按键', icon: 'keyboard', impact: 'write', detail: (a) => clip(str(a, 'key', 'keys') ?? '', MAX_SHORT) },
  type_text: { verb: '输入文字', icon: 'keyboard', impact: 'write' },
  type: { verb: '输入文字', icon: 'keyboard', impact: 'write' },
  paste: { verb: '粘贴', icon: 'keyboard', impact: 'write' },
  zoom: { verb: '放大查看局部', icon: 'eye' },
  clipboard_read: { verb: '读取剪贴板', icon: 'file' },
  clipboard_write: { verb: '写入剪贴板', icon: 'file', impact: 'write' },
  verify_state: { verb: '验证界面状态', icon: 'task' },
  health_report: { verb: '检查驱动状态', icon: 'task' },
  get_config: { verb: '读取驱动配置', icon: 'task' },
  set_config: { verb: '修改驱动配置', icon: 'task', impact: 'write' },
  browser_type: { verb: '在输入框里填写', icon: 'keyboard', impact: 'write', detail: (a) => clip(str(a, 'text', 'value') ?? '', MAX_DETAIL) },
  insert_text: { verb: '在输入框里填写', icon: 'keyboard', impact: 'write', detail: (a) => clip(str(a, 'text', 'value') ?? '', MAX_DETAIL) },
  type_keystrokes: { verb: '在输入框里填写', icon: 'keyboard', impact: 'write', detail: (a) => clip(str(a, 'text', 'value') ?? '', MAX_DETAIL) },
  browser_press_key: { verb: '按下按键', icon: 'keyboard', impact: 'write', detail: (a) => clip(str(a, 'key', 'keys') ?? '', MAX_SHORT) },
  hotkey: { verb: '按下快捷键', icon: 'keyboard', impact: 'write', detail: (a) => clip(str(a, 'keys', 'key') ?? '', MAX_SHORT) },
  browser_snapshot: { verb: '查看当前页面', icon: 'eye' },
  get_browser_state: { verb: '查看当前页面', icon: 'eye' },
  browser_find: { verb: '在页面上查找', icon: 'search', detail: (a) => clip(str(a, 'text', 'query') ?? '', MAX_SHORT) },
  browser_scroll: { verb: '滚动页面', icon: 'scroll', detail: (a) => SCROLL_DIRECTION[str(a, 'direction') ?? ''] },
  browser_back: { verb: '返回上一页', icon: 'arrow' },
  browser_forward: { verb: '前进一页', icon: 'arrow' },
  browser_download: { verb: '下载文件', icon: 'download', impact: 'write' },
  browser_set_input_files: { verb: '上传文件', icon: 'download', impact: 'write', detail: (a) => fileNameOf(str(a, 'paths', 'files')) },
  file_upload: { verb: '上传文件', icon: 'download', impact: 'write', detail: (a) => fileNameOf(str(a, 'paths', 'files')) },
  browser_console_messages: { verb: '查看控制台输出', icon: 'terminal' },
  browser_network_requests: { verb: '查看网络请求', icon: 'cloud' },
  browser_dialog: { verb: '处理页面弹窗', icon: 'eye' },
  browser_tab_select: { verb: '切换标签页', icon: 'arrow' },
  browser_wait_for: { verb: '等待页面加载', icon: 'scroll' },

  // ── 网络 ───────────────────────────────────────────────────────────
  // 搜索/抓取网页只是"看了看"（read），生成图片与下载文件才是"做出了什么"。
  web_search: { verb: '搜索网络', icon: 'search', detail: (a) => clip(str(a, 'query', 'queries') ?? '', MAX_DETAIL) },
  web_fetch: { verb: '读取网页', icon: 'globe', detail: (a) => siteOf(str(a, 'url')) },
  download: { verb: '下载文件', icon: 'download', impact: 'write', detail: (a) => fileNameOf(str(a, 'output', 'path', 'dest')) },
  generate_image: { verb: '生成图片', icon: 'image', impact: 'write', detail: (a) => clip(str(a, 'prompt') ?? '', MAX_SHORT) },
  vision_describe: { verb: '查看图片内容', icon: 'image' },

  // ── 文件 ───────────────────────────────────────────────────────────
  // 读 / 写 / 改 / 删各有自己的图标：读者是靠形状扫列的，四条都画成「文档」时
  // 一列扫过去完全分不出在干什么，而这三件事恰恰是这一列里最需要被一眼认出的。
  //
  // impact：只有真正改了东西的四条（写/改/删 + 交付）标 write，其余全是 read。
  read: { verb: '查看文件', icon: 'fileView', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  read_file: { verb: '查看文件', icon: 'fileView', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  view: { verb: '查看文件', icon: 'fileView', detail: (a) => fileNameOf(str(a, 'file_path', 'path')) },
  open_file: { verb: '打开文件', icon: 'fileView', detail: (a) => fileNameOf(str(a, 'file_path', 'path')) },
  write: { verb: '新建文件', icon: 'fileNew', impact: 'write', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  edit: { verb: '修改文件', icon: 'fileEdit', impact: 'write', detail: (a) => fileNameOf(str(a, 'file_path', 'path', 'filePath')) },
  apply_patch: { verb: '修改文件', icon: 'fileEdit', impact: 'write' },
  str_replace_editor: { verb: '修改文件', icon: 'fileEdit', impact: 'write' },
  delete_file: { verb: '删除文件', icon: 'trash', impact: 'write', detail: (a) => fileNameOf(str(a, 'file_path', 'path')) },
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
  // 这一段几乎全是"改变了什么"：派子任务、记记忆、交付文件、改清单，用户都得知道。
  todo_write: { verb: '更新任务清单', icon: 'task', impact: 'write' },
  skill: { verb: '加载技能', icon: 'spark', impact: 'write', detail: (a) => clip(str(a, 'name') ?? '', MAX_DETAIL) },
  present: { verb: '交付文件', icon: 'file', impact: 'write' },
  subagent: { verb: '派出子任务', icon: 'spark', impact: 'write', detail: (a) => clip(str(a, 'description', 'prompt') ?? '', MAX_DETAIL) },
  subagent_fork: { verb: '派出子任务', icon: 'spark', impact: 'write', detail: (a) => clip(str(a, 'description', 'prompt') ?? '', MAX_DETAIL) },
  automation: { verb: '安排定时任务', icon: 'bolt', impact: 'write' },
  workflow: { verb: '执行 workflow', icon: 'spark', impact: 'write', detail: (a) => clip(str(a, 'name', 'description') ?? '', MAX_DETAIL) },
  ralph: { verb: '执行 workflow', icon: 'spark', impact: 'write', detail: (a) => clip(str(a, 'name', 'description') ?? '', MAX_DETAIL) },
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
  [/^memory_(remember|add|write|create)/, { verb: '记录记忆', icon: 'bolt', impact: 'write', detail: (a) => clip(str(a, 'content', 'text') ?? '', MAX_SHORT) }],
  [/^memory_(search|query|get|read|list)/, { verb: '检索记忆', icon: 'search' }],
  [/^browser_/, { verb: '操作浏览器', icon: 'globe' }],
  [/^cua_/, { verb: '操作电脑', icon: 'cursor' }],
  // 剥掉命名空间后剩下的通用短名：按特征词兜一层，免得只得到「执行 X」。
  [/window|cursor|screen|clipboard|desktop/, { verb: '操作电脑', icon: 'cursor' }],
  [/app$|^app_|launch|kill_/, { verb: '操作应用', icon: 'folder', impact: 'write' }],
  [/read|view|inspect/, { verb: '查看文件', icon: 'fileView' }],
  [/write|edit|patch|replace/, { verb: '修改文件', icon: 'fileEdit', impact: 'write' }],
  [/delete|remove|unlink|rm$/, { verb: '删除文件', icon: 'trash', impact: 'write' }],
  [/search|grep|find|query/, { verb: '搜索', icon: 'search' }],
  [/shell|bash|exec|command|pwsh|run_code/, { verb: '在终端执行命令', icon: 'terminal' }],
  [/download|fetch|curl|wget/, { verb: '下载文件', icon: 'download', impact: 'write' }],
  [/image|picture|draw|render/, { verb: '生成图片', icon: 'image', impact: 'write' }],
]

/** 兜底：从参数里挑第一个像「人能读懂」的值（描述 > 文本 > 其余）。 */
const FALLBACK_DETAIL_KEYS: readonly string[] = ['description', 'text', 'name', 'title', 'query', 'url', 'path', 'file_path', 'prompt']

/* ── 失败原因：把技术报错翻成人话 ─────────────────────────────────────── */

/**
 * 报错 → 人话。**先匹配到的赢**，所以顺序按"具体 → 笼统"排。
 *
 * 这一层是给"失败了怎么办"用的：用户在这张卡上最需要知道的就是「出了什么事」，
 * 而原始报错对他全是噪音（`ENOENT: no such file or directory, open 'D:\a\b.ts'`）。
 * 认出类别就给一句他能据此判断的话；认不出就返回 undefined —— 把一句英文报错原样
 * 糊到普通用户脸上，比不显示更糟（他会以为是自己看错了）。
 */
const ISSUES: ReadonlyArray<readonly [RegExp, string]> = [
  [/enoent|no such file|not found|404|找不到/i, '找不到文件或页面'],
  [/eacces|eperm|permission|forbidden|403|unauthor|权限/i, '没有权限'],
  [/etimedout|timeout|timed out|超时/i, '等太久没响应'],
  [/econnrefused|connection refused|无法连接|连不上/i, '连不上对方'],
  [/enotfound|getaddrinfo|dns|域名/i, '连不上这个地址'],
  [/ehostunreach|network is unreachable|网络/i, '网络不通'],
  [/enospc|no space left|磁盘|空间不足/i, '磁盘空间不够'],
  [/ealreadyexists|file exists|已存在/i, '东西已经在那儿了'],
  [/eisdir|is a directory|not a directory/i, '那不是一个文件'],
  [/429|too many requests|rate limit|频率/i, '请求太频繁，被限流'],
  [/5\d\d|internal server|server error|服务端/i, '对方服务出错'],
  [/certificate|ssl|tls|证书/i, '连接不安全（证书问题）'],
  [/aborted|cancelled|取消|中断|interrupted/i, '被中断了'],
  [/invalid|malformed|parse|unexpected token|格式|解析/i, '内容格式不对，读不出来'],
  [/empty|为空|空文件/i, '内容是空的'],
]

/**
 * 原始错误文本 → 一句人话。认不出类别时返回 undefined（见 ISSUES 的说明）。
 *
 * 纯函数、只做匹配不做 IO，smoke 里可直接断言。
 */
export function humanIssue(errorText: string | undefined): string | undefined {
  if (errorText === undefined || errorText.trim() === '') return undefined
  const hit = ISSUES.find(([pattern]) => pattern.test(errorText))
  return hit?.[1]
}

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

  let detail = rule?.detail?.(args, input.resultText)
  if (detail === undefined || detail.trim() === '') {
    if (name === '') detail = undefined
    else {
      const picked = str(args, ...FALLBACK_DETAIL_KEYS)
      detail = picked === undefined ? undefined : clip(picked, MAX_SHORT)
    }
  }
  // 收尾统一解一遍 JSON 转义：规则的 detail 与兜底取值都可能来自工具描述
  // （那是 JSON 编出来的），漏网的话卡片上会出现一串 \uXXXX。
  if (detail !== undefined) detail = unescapeUnicode(detail)

  // 技术细节 = 工具名 + 原始入参。原始入参是「想看细节的人」唯一的凭据：
  // 主文案刻意抹掉了命令原文、完整路径与参数名，抹掉的东西得在这里还回去。
  const argsRaw = input.argsRaw?.trim() ?? ''
  const tech: PlainStep['tech'] = {
    name: toolName,
    ...(argsRaw !== '' ? { args: clip(argsRaw, 600) } : {}),
    ...(input.errorText !== undefined && input.errorText !== '' ? { error: clip(input.errorText, 200) } : {}),
  }

  const issue = input.status === 'failed' ? humanIssue(input.errorText) : undefined

  return {
    id: input.id ?? `${name}:${verb}`,
    icon,
    verb,
    ...(detail !== undefined && detail !== '' ? { detail } : {}),
    // 规则表漏声明的一律当 read（少显示好过刷屏）：简要模式下宁可少几条，
    // 也不能把"新建文件"这种真动作藏起来 —— 所以默认值取的是保守的那一端。
    impact: rule?.impact ?? 'read',
    status: input.status,
    ...(issue !== undefined ? { issue } : {}),
    ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
    ...(spawnsSubagents(toolName) ? { spawnsSubagents: true } : {}),
    tech,
  }
}

/** 工具名是否属于「一次性元信息」，需要从流程主线里挪到末尾。 */
export function isMetaTool(toolName: string): boolean {
  return plainToolName(toolName) === 'todo_write'
}
