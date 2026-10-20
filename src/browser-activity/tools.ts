/**
 * dsh-chat-plus — 浏览器工具判据（host 半身，纯函数）。
 *
 * 单独成文件是为了能被冒烟直接对拍：这套判据写歪**不会抛错**，只会表现为
 * 「该亮的会话不亮」（漏判）或「普通工具也亮浏览器图标」（误判），两种都只能
 * 靠断言发现。
 */

/** 命中即视为浏览器工具的关键词（全小写比较）。 */
export const BROWSER_ACTIVITY_HINTS: readonly string[] = [
  'playwright', 'browser', 'chrome', 'devtools', 'stagehand', 'ego', 'puppeteer', 'selenium', 'cdp',
  'browseros', 'browserbase',
]

/**
 * 复合词前缀匹配的最短词长。
 *
 * 为什么需要这条：真实世界里浏览器后端的名字经常是「关键词 + 后缀」拼起来的
 * 一个单词 —— BrowserOS 的 MCP server 叫 `browseros_neo`，Browserbase 叫
 * `browserbase`。词元精确匹配认不出它们（`browseros` 不等于 `browser`），
 * 于是那批工具全都不亮，而用户完全没有线索。
 *
 * 为什么阈值是 6：hints 里 `cdp`(3)、`ego`(3)、`chrome`(6) 这类短词一旦允许
 * 前缀匹配就会误伤（`cdpx`、`egos`、`chromeless` 全是普通单词的开头）。
 * 6 是「足够长、不至于撞上别的词根」的下限（browser 7 / playwright 10 /
 * puppeteer 9 / selenium 8 / devtools 8 / stagehand 10 都在线上，正好覆盖
 * browseros 与 browserbase，同时把 ego / cdp 挡在门外）。
 */
export const BROWSER_ACTIVITY_COMPOUND_MIN = 6

/**
 * 保留的前缀判据：`mcp__playwright-mcp__*` 无条件算浏览器工具。
 *
 * 为什么前缀之外还要关键词表：本机既有配置只挂了 playwright-mcp，但 MCP server
 * 的注册名由 profile 决定（`chrome-devtools`、`puppeteer`、`stagehand` 都是
 * 常见命名）。只认前缀的话，用户换一个 MCP server 就得改插件源码。
 */
export const BROWSER_ACTIVITY_PREFIX = 'mcp__playwright-mcp__'

/** `mcp__<service>__<tool>` 的解析结果。 */
export interface BrowserToolName {
  service: string
  tool: string
}

/**
 * 展示用的 service/tool 标签。
 *
 * 与 {@link BrowserToolName} 同形状但语义不同：这里的 service 可以是 MCP server 名，
 * 也可以是 shell 里调用的浏览器 CLI 名（`ego-browser`），tool 则可能是 CLI 子命令
 * （通用子命令如 `exec` 留空，只亮「在跑浏览器」这件事）。
 */
export interface BrowserActivityLabel {
  service: string
  tool: string
}

/**
 * 把 MCP 工具名拆成 service / tool（非 MCP 形状返回 null）。
 *
 * @param name 工具名，形如 `mcp__playwright-mcp__browser_click`。
 * @returns service = 第二段；tool = 第三段起（工具名自身含 `__` 时原样保留）。
 */
export function parseBrowserToolName(name: unknown): BrowserToolName | null {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null
  const parts = name.split('__')
  // ['mcp', service, ...tool]：少于三段就不是 `mcp__<service>__<tool>` 形状。
  if (parts.length < 3) return null
  const service = parts[1].trim()
  const tool = parts.slice(2).join('__').trim()
  if (service === '' || tool === '') return null
  return { service, tool }
}

/**
 * 把一段文本切成小写词元（`playwright-mcp` → [playwright, mcp]）。
 *
 * 按分隔符切开之外还切 camelCase：MCP 工具名两种风格都常见
 * （`browser_click` / `openBrowserTab`）。
 */
function tokensOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '')
}

/**
 * 该工具名是否属于浏览器操作（纯函数）。
 *
 * 为什么按**词元精确匹配**而不是裸 `includes`：关键词表里有 `ego`、`cdp`
 * 这类短词，裸子串匹配会把 `mcp__x__list_categories`（categories 里藏着
 * 「ego」）判成浏览器工具 —— 那会让普通 MCP 工具在会话行上点亮浏览器图标，
 * 且用户完全无从理解。词元匹配保留「service 或 tool 命中关键词」的语义，
 * 同时不会命中一个更长单词的内部。
 */
export function isBrowserToolName(name: unknown): boolean {
  if (typeof name !== 'string' || name === '') return false
  if (name.startsWith(BROWSER_ACTIVITY_PREFIX)) return true
  const parsed = parseBrowserToolName(name)
  if (parsed === null) return false
  const tokens = new Set([...tokensOf(parsed.service), ...tokensOf(parsed.tool)])
  return BROWSER_ACTIVITY_HINTS.some((hint) => tokens.has(hint) || tokenIsCompoundOf(tokens, hint))
}

/**
 * `tokens` 里是否有某个词元是 hint 的复合词（以 hint 开头且更长）。
 *
 * 只对够长的 hint 生效（见 BROWSER_ACTIVITY_COMPOUND_MIN）。
 */
function tokenIsCompoundOf(tokens: ReadonlySet<string>, hint: string): boolean {
  if (hint.length < BROWSER_ACTIVITY_COMPOUND_MIN) return false
  for (const token of tokens) {
    if (token.length > hint.length && token.startsWith(hint)) return true
  }
  return false
}

/**
 * 会话 id 的四种来源（含「一条都没取到」）。
 *
 * 为什么把来源做成数据而不是日志文案：真实运行时 `exec.agent` 的形状一旦变了，
 * 症状是「图标永远不亮且毫无报错」—— 没有任何异常可抓。来源字符串让诊断路由
 * 能直接回答「这次调用到底是从哪条路径认出会话的」，一眼看出接缝是否还对得上。
 */
export type SessionSource = 'agent.session.id' | 'agent.id' | 'arguments.sessionId' | 'none'

/** 全部来源取值（冒烟对拍用；顺序即优先级顺序）。 */
export const SESSION_SOURCES: readonly SessionSource[] = [
  'agent.session.id',
  'agent.id',
  'arguments.sessionId',
  'none',
]

/** 带来源的会话解析结果。 */
export interface SessionResolution {
  /** 解析到的会话 id；拿不到时是空串。 */
  sessionId: string
  /** 从哪条路径拿到的；`none` 表示三条都没命中。 */
  via: SessionSource
}

/**
 * 解析 agent 对象上的会话（带来源）。
 *
 * cordis 的 ctx/agent 可能是 Proxy：未声明属性一读就抛，所以逐段 try —— 抛错
 * 等价于「这条路径拿不到」，继续走下一条。
 */
function resolveAgentSession(agent: unknown): SessionResolution {
  try {
    const record = agent as { session?: { id?: unknown }; id?: unknown } | null | undefined
    const fromSession = record?.session?.id
    if (typeof fromSession === 'string' && fromSession !== '') {
      return { sessionId: fromSession, via: 'agent.session.id' }
    }
    const direct = record?.id
    if (typeof direct === 'string' && direct !== '') {
      return { sessionId: direct, via: 'agent.id' }
    }
  } catch {
    /* 代理读属性抛错：当作读不到 */
  }
  return { sessionId: '', via: 'none' }
}

/**
 * 会执行命令行脚本的工具名（命令文本在 `arguments.command`）。
 *
 * 官方 `dsh-tool-pwsh` 与 `dsh-tool-bash` 注册名就是这两个；`shell` / `terminal`
 * 是同一族在别的发行版的叫法，一并认下 —— 多认一个不存在的名字没有任何代价，
 * 漏认一个的代价是「换平台后标志永远不亮」。
 */
export const SHELL_TOOL_NAMES: readonly string[] = ['pwsh', 'bash', 'shell', 'terminal', 'powershell']

/**
 * 浏览器自动化 CLI 的可执行名（段首命令，全小写比较、去目录前缀与扩展名）。
 *
 * 为什么需要这一条：ego-browser 这类工具**不是 MCP 工具**，而是用 `pwsh` 跑一个
 * 命令行程序。只按 MCP 工具名判断的话，用户在 ego 里点了一整页，界面上却毫无
 * 反应 —— 那正是这次要修的「看不出在操作浏览器」。
 *
 * 为什么名单这么短：只收**明确的浏览器自动化 CLI**。刻意不收 `chrome` /
 * `chromium` —— 用命令行启动浏览器不等于在操作浏览器，而且那几个名字常出现在
 * 路径与参数里，误判成本（亮一枚说不清来源的图标）比漏判更高。
 */
export const BROWSER_CLI_NAMES: readonly string[] = [
  'ego-browser', 'ego', 'playwright', 'stagehand', 'puppeteer', 'selenium',
]

/**
 * 把一段命令切成「词」，去掉引号与 PowerShell 的调用前缀。
 *
 * 为什么自己做而不是正则抠第一个词：真实写法里命令前面常挂着调用运算符与
 * 括号（`& "C:\\tools\\ego-browser.exe" nodejs`、`(Get-Item x)`），路径又可能
 * 带空格与引号。统一走「先去前缀 → 再按空白切词、引号内的空白不断词」，比逐个
 * 正则特判可靠得多。
 *
 * @param segment 一段命令（已按 `;` `&&` `|` 换行切过）。
 * @returns 词数组（引号已剥离）；空段返回空数组。
 */
export function commandWords(segment: string): string[] {
  let rest = segment.trim()
  // 剥离开头的调用运算符/括号/分隔符：& . ( { } | ; 以及空白。
  for (;;) {
    const next = rest.replace(/^[\s&|(){}.]+/, '')
    if (next === rest) break
    rest = next
  }
  if (rest === '') return []
  const words: string[] = []
  let current = ''
  let quote = ''
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i]
    if (quote !== '') {
      if (ch === quote) quote = ''
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (/\s/.test(ch)) {
      if (current !== '') { words.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (current !== '') words.push(current)
  return words
}

/** 词 → 可执行名：去目录前缀与 Windows 扩展名，小写（C:\\x\\ego-browser.exe → ego-browser）。 */
export function executableNameOf(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word
  return base.replace(/\.(exe|cmd|bat|ps1|mjs|js)$/i, '').toLowerCase()
}

/**
 * 从一段命令行文本里认出浏览器自动化 CLI（纯函数）。
 *
 * 判据是「**可执行位置**上出现了浏览器 CLI」，而不是「文本里出现过这个词」：
 * `grep ego-browser`、`echo "ego-browser"`、`Get-Content ego-browser.md` 都只是
 * 在谈论它，不是在使用它 —— 那类命令亮起图标只会让人困惑。
 *
 * 做法：先按 shell 的命令分隔符切成段（`;` `&&` `||` `|` `&` 换行），每段只
 * 看第一个词；带引号或目录前缀的写法（`& "C:\\tools\\ego-browser.exe"`）也认。
 *
 * @param command 命令行文本（pwsh/bash 工具的 `arguments.command`）。
 * @returns 命中的 CLI 名，未命中返回 null。
 */
export function browserCliOfCommand(command: unknown): string | null {
  const hit = browserCliInvocationOf(command)
  return hit === null ? null : hit.cli
}

/** 一次 CLI 调用的解析结果：CLI 名 + 紧随其后的第一个子命令（可能是空串）。 */
export interface BrowserCliInvocation {
  cli: string
  subcommand: string
}

/**
 * 解析一次命令行里对浏览器 CLI 的调用（纯函数）。
 *
 * @param command 命令行文本。
 * @returns 命中时给出 CLI 名与子命令；未命中返回 null。
 */
export function browserCliInvocationOf(command: unknown): BrowserCliInvocation | null {
  if (typeof command !== 'string' || command === '') return null
  /*
   * 去掉行注释（PowerShell 与 bash 都用 #）：注释里提到 CLI 不该点亮图标。
   * 逐行切而不是全局切，是为了不误伤 http:// 这类 URL 里的 #（真实命令里
   * 极少出现在行首命令位置，而注释一定在行内）。
   */
  const cleaned = command
    .split(/\r?\n/)
    .map((line) => {
      const hash = line.indexOf('#')
      return hash >= 0 ? line.slice(0, hash) : line
    })
    .join('\n')
  // 顺序切成命令段：多字符分隔符先切，再切单字符。
  for (const segment of cleaned.split(/&&|\|\||[;&|\n]+/)) {
    const words = commandWords(segment)
    if (words.length === 0) continue
    const cli = executableNameOf(words[0])
    if (!BROWSER_CLI_NAMES.includes(cli)) continue
    // 子命令：CLI 之后第一个不以 - 开头的词（`ego-browser nodejs -e ...` → nodejs）。
    let subcommand = ''
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i]
      if (word === '' || word.startsWith('-')) continue
      subcommand = executableNameOf(word)
      break
    }
    return { cli, subcommand }
  }
  return null
}

// 兼容旧名：`browserCliOfCommand` 只要名称，内部走同一份解析。
/** 从执行对象里读命令行文本（shell 类工具才有）；读不到返回空串。 */
export function shellCommandOfExecution(exec: unknown): string {
  try {
    const args = (exec as { arguments?: unknown } | null | undefined)?.arguments
    if (args === null || typeof args !== 'object') return ''
    const command = (args as { command?: unknown }).command
    return typeof command === 'string' ? command : ''
  } catch {
    return ''
  }
}

/** 该工具名是否是执行命令行的工具（pwsh / bash 等）。 */
export function isShellToolName(name: unknown): boolean {
  return typeof name === 'string' && SHELL_TOOL_NAMES.includes(name)
}

/**
 * 「只是跑脚本」的子命令名：它们对用户没有信息量。
 *
 * `ego-browser nodejs -e "..."` 里真正有意义的是 ego-browser 本身，把 nodejs 当
 * 工具名显示出来只会让胶囊写成「浏览器操作中 · nodejs」—— 读的人无从判断这是
 * 浏览器操作还是普通脚本。命中这张表时 tool 留空，客户端退回显示 CLI 名。
 */
export const BROWSER_CLI_GENERIC_SUBCOMMANDS: readonly string[] = [
  'nodejs', 'node', 'run', 'exec', 'eval', 'sh', 'bash', 'python', 'py', 'deno', 'bun',
]

/**
 * 一次执行是否是「浏览器操作」，是则返回展示用的 service/tool。
 *
 * 两条判据：MCP 工具名命中关键词（`isBrowserToolName`），或 shell 工具的命令文本
 * 在可执行位置调用了浏览器 CLI（`browserCliOfCommand`）。
 *
 * @param name 工具名。
 * @param exec 执行对象（shell 工具要从中读 command）。
 * @returns 展示标签，非浏览器操作返回 null。
 */
export function browserActivityLabelOf(name: unknown, exec: unknown): BrowserActivityLabel | null {
  if (isBrowserToolName(name)) {
    const parsed = parseBrowserToolName(name)
    if (parsed !== null) return parsed
    // 前缀命中但形状不规整（理论上不会发生）：退化成整个工具名。
    return { service: 'mcp', tool: typeof name === 'string' ? name : '' }
  }
  if (!isShellToolName(name)) return null
  const invocation = browserCliInvocationOf(shellCommandOfExecution(exec))
  if (invocation === null) return null
  const generic = BROWSER_CLI_GENERIC_SUBCOMMANDS.includes(invocation.subcommand)
  return { service: invocation.cli, tool: generic ? '' : invocation.subcommand }
}

/** 从 agent 对象（或其 `agent/disposed` 事件载荷）读 session id；读不到返回空串。 */
export function sessionIdOfAgent(agent: unknown): string {
  return resolveAgentSession(agent).sessionId
}

/**
 * 一次工具执行属于哪个会话（带来源）。
 *
 * 取值顺序（与客户端契约一致）：`exec.agent.session.id` → `exec.agent.id` →
 * `exec.arguments.sessionId`。三条都拿不到时 `via === 'none'`，调用方必须
 * **跳过**这次观测，绝不能把它算到某个默认会话上（那会在无关会话上点亮图标）。
 */
export function sessionSourceOfExecution(exec: unknown): SessionResolution {
  try {
    const record = exec as { agent?: unknown; arguments?: unknown } | null | undefined
    const fromAgent = resolveAgentSession(record?.agent)
    if (fromAgent.sessionId !== '') return fromAgent
    const args = record?.arguments as { sessionId?: unknown } | null | undefined
    const fromArgs = args?.sessionId
    if (typeof fromArgs === 'string' && fromArgs !== '') {
      return { sessionId: fromArgs, via: 'arguments.sessionId' }
    }
  } catch {
    /* 同上：代理读属性抛错时退回「拿不到」 */
  }
  return { sessionId: '', via: 'none' }
}

/**
 * 一次工具执行属于哪个会话。
 *
 * 与 {@link sessionSourceOfExecution} 同一份判定，只是丢掉来源 —— 保留这个签名
 * 是为了不惊动既有调用点与冒烟断言。
 */
export function sessionIdOfExecution(exec: unknown): string {
  return sessionSourceOfExecution(exec).sessionId
}

/** 这次执行有没有 `callId`（诊断用：没有就说明去重退化成了合成键）。 */
export function hasCallIdOfExecution(exec: unknown): boolean {
  try {
    const callId = (exec as { callId?: unknown } | null | undefined)?.callId
    return typeof callId === 'string' && callId !== ''
  } catch {
    return false
  }
}

/** 合成 callKey 的自增序号（模块级：跨 tracker 共享也无害，只需在本进程内唯一）。 */
let syntheticCallSeq = 0

/**
 * 状态机里一次调用的去重键。
 *
 * 优先 `exec.callId`（同一 callId 重复 begin 视为同一次调用，不重复计数）；
 * 缺失时退化成进程内唯一的合成键 —— begin/end 用的是同一个返回值，配对天然成立。
 */
export function callKeyOfExecution(exec: unknown): string {
  try {
    const callId = (exec as { callId?: unknown } | null | undefined)?.callId
    if (typeof callId === 'string' && callId !== '') return callId
  } catch {
    /* 读不到就退化 */
  }
  syntheticCallSeq += 1
  return '#synthetic:' + String(syntheticCallSeq)
}
