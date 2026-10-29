/**
 * dsh-chat-plus — 浏览器活动观测（browser-activity）行为测试。
 *
 * ## 为什么需要真跑
 *
 * 这个模块的三块主行为错了**都不会抛错**，只会静默给出错的图标：
 *   1. 工具名判据漏判 → 该亮的会话不亮；误判 → 普通 MCP 工具也亮浏览器图标；
 *   2. 状态机（并发计数 / 去重 / 尾迹窗）→ 图标频闪，或者调用早结束了还挂着；
 *   3. 路由形状 → 客户端读不到字段就整块不显示，且没有任何报错。
 *
 * 所以这里对**构建产物** lib/index.js 注入假时钟，把状态机真跑一遍，再用
 * 「假 ctx 挂路由 + node:http 真请求」验证线上响应形状（照 scripts/smoke-host.mjs
 * 的写法）。不依赖真实 cordis、不真等 1.5 秒。
 *
 * Usage: node scripts/test-browser-activity.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const HOST = resolve(ROOT, 'lib/index.js')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)
const need = (cond, msg) => (cond ? pass(msg) : fail(msg))

if (!existsSync(HOST)) {
  fail('lib/index.js 不存在，先跑 node build.mjs')
  process.exit(1)
}

const mod = await import(new URL(`file://${HOST.replace(/\\/g, '/')}`))
const {
  BrowserActivityTracker,
  isBrowserToolName,
  parseBrowserToolName,
  sessionIdOfAgent,
  sessionIdOfExecution,
  sessionSourceOfExecution,
  handleBrowserActivityRoute,
  backgroundJobIdOf,
  SESSION_SOURCES,
  BROWSER_ACTIVITY_ROUTE,
  BROWSER_ACTIVITY_LINGER_MS,
  BROWSER_ACTIVITY_DEBUG_LIMIT,
  BROWSER_ACTIVITY_JOB_WATCH_MAX_MS,
  isShellToolName,
  browserCliOfCommand,
  browserCliInvocationOf,
  browserActivityLabelOf,
  BROWSER_CLI_NAMES,
  SHELL_TOOL_NAMES,
  browserActivityTest,
} = mod

for (const [name, value] of Object.entries({
  BrowserActivityTracker, isBrowserToolName, parseBrowserToolName, sessionIdOfExecution,
  sessionSourceOfExecution, handleBrowserActivityRoute, SESSION_SOURCES,
  BROWSER_ACTIVITY_ROUTE, BROWSER_ACTIVITY_LINGER_MS, BROWSER_ACTIVITY_DEBUG_LIMIT,
  browserActivityTest,
})) {
  if (value === undefined) { fail(`lib/index.js 未导出 ${name}`); process.exit(1) }
}

// ── 1. 契约常量 ───────────────────────────────────────────────────────────
need(BROWSER_ACTIVITY_ROUTE === '/api/chat-flow/browser-activity',
  `路由常量与客户端一致：${BROWSER_ACTIVITY_ROUTE}`)
need(BROWSER_ACTIVITY_LINGER_MS === 4000, `尾迹窗口 4000ms（实得 ${BROWSER_ACTIVITY_LINGER_MS}）`)
need(BROWSER_ACTIVITY_DEBUG_LIMIT === 20, `诊断缓冲上限 20（实得 ${BROWSER_ACTIVITY_DEBUG_LIMIT}）`)

// 来源常量必须与契约里的四条路径逐字一致（客户端/文档都按这几个字符串沟通）
need(JSON.stringify(SESSION_SOURCES) === JSON.stringify([
  'agent.session.id', 'agent.id', 'arguments.sessionId', 'none',
]), `SESSION_SOURCES 与契约一致（实得 ${JSON.stringify(SESSION_SOURCES)}）`)

// ── 2. isBrowserToolName：正例 / 反例 / 非 mcp 工具 ───────────────────────
{
  const positives = [
    ['mcp__playwright-mcp__browser_click', '经典 playwright-mcp 工具'],
    ['mcp__playwright__browser_navigate', 'service 命中 playwright'],
    ['mcp__chrome-devtools__take_snapshot', 'service 命中 chrome 与 devtools'],
    ['mcp__puppeteer__navigate', 'service 命中 puppeteer'],
    ['mcp__stagehand__act', 'service 命中 stagehand'],
    ['mcp__ego-browser__open', 'service 里 ego / browser 两个词元'],
    ['mcp__selenium__click', 'service 命中 selenium'],
    ['mcp__foo__cdp_domains', 'tool 命中 cdp'],
    ['mcp__foo__openBrowserTab', 'camelCase 工具名也能切出 browser 词元'],
    ['mcp__playwright-mcp__anything_at_all', '保留前缀无条件命中'],
    ['mcp__browseros_neo__navigate', 'BrowserOS 的复合词（browseros 以 browser 开头）'],
    ['mcp__browseros_neo__snapshot', 'BrowserOS 二十个工具都该亮'],
    ['mcp__browserbase__open', 'Browserbase 的复合词'],
  ]
  const bad = positives.filter(([name]) => !isBrowserToolName(name))
  need(bad.length === 0, `isBrowserToolName 正例全部命中（漏判 ${JSON.stringify(bad.map(b => b[0]))}）`)

  const negatives = [
    ['pwsh', '普通内置工具'],
    ['read', '普通内置工具'],
    ['mcp__context7__resolve-library-id', '非浏览器 MCP 工具'],
    ['mcp__memory__create_entities', '非浏览器 MCP 工具'],
    // 下面两条是「裸子串匹配会误判」的靶子：categories 里有 ego，escape 里有 cdp 之外的干扰
    ['mcp__x__list_categories', 'categories 里藏着 ego（不得裸子串命中）'],
    ['mcp__github__search_code', '普通 MCP 工具'],
    ['mcp__filesystem__read_file', '普通 MCP 工具'],
    ['mcp__', '不完整前缀'],
    ['mcp__onlyservice', '缺 tool 段'],
    ['cua_driver_native__screenshot', '电脑操作不是浏览器操作'],
    // 复合词前缀匹配只对够长的 hint 生效（阈值 6）：短词后面接东西不算命中。
    ['mcp__foo__egosystem', 'ego(3) 太短，不做前缀匹配（否则 egosystem 会误判）'],
    ['mcp__foo__cdpdriver', 'cdp(3) 太短，不做前缀匹配'],
    ['', '空串'],
  ]
  const wrong = negatives.filter(([name]) => isBrowserToolName(name))
  need(wrong.length === 0, `isBrowserToolName 反例全部不命中（误判 ${JSON.stringify(wrong.map(w => w[0]))}）`)
  need(!isBrowserToolName(undefined) && !isBrowserToolName(null) && !isBrowserToolName(42),
    'isBrowserToolName 对非字符串返回 false')
}

// ── 2b. 浏览器 CLI（ego-browser 这类不是 MCP 工具）─────────────────────────
/*
 * 为什么要单独一组：ego-browser 是用 pwsh 跑的命令行程序，工具名永远是 pwsh。
 * 只按 MCP 工具名判断的话，用户在 ego 里点了一整页，界面上毫无反应 —— 那正是
 * 这次要修的「看不出在操作浏览器」。
 *
 * 判据必须是「可执行位置上出现了 CLI」，而不是「文本里出现过这个词」：
 * grep / echo / Get-Content 提到它只是在谈论它，亮图标只会让人困惑。
 */
{
  need(SHELL_TOOL_NAMES.includes('pwsh') && SHELL_TOOL_NAMES.includes('bash'),
    `SHELL_TOOL_NAMES 含 pwsh 与 bash（实得 ${JSON.stringify(SHELL_TOOL_NAMES)}）`)
  need(BROWSER_CLI_NAMES.includes('ego-browser'), 'BROWSER_CLI_NAMES 含 ego-browser')
  need(isShellToolName('pwsh') && isShellToolName('bash') && !isShellToolName('read'),
    'isShellToolName 只认命令行工具')

  const cliCases = [
    ['ego-browser nodejs -e "x"', 'ego-browser', '最朴素写法'],
    ['& "C:\\Users\\x\\ego-browser.exe" nodejs', 'ego-browser', '带调用运算符与引号路径'],
    ['cd D:\\AI; ego-browser nodejs -e "x"', 'ego-browser', '分号后的命令段'],
    ['npm run x | ego-browser nodejs', 'ego-browser', '管道右侧'],
    ['ego-browser.exe nodejs', 'ego-browser', '带 .exe 后缀'],
    ['EGO-BROWSER nodejs', 'ego-browser', '大小写不敏感'],
    ['grep ego-browser README.md', null, '只是在搜索这个词'],
    ['echo "ego-browser"', null, '只是在打印这个词'],
    ['Get-Content ego-browser.md', null, '只是在读同名文件'],
    ['# ego-browser nodejs\r\nls', null, '出现在注释里'],
    ['ls', null, '普通命令'],
    ['', null, '空命令'],
  ]
  const cliWrong = cliCases.filter(([cmd, want]) => browserCliOfCommand(cmd) !== want)
  need(cliWrong.length === 0,
    `browserCliOfCommand 逐条正确（${cliCases.length} 个样本`
    + (cliWrong.length === 0 ? '）' : `，不符：${JSON.stringify(cliWrong.map(c => c[0]))}）`))

  const invocation = browserCliInvocationOf('ego-browser nodejs -e "code"')
  need(invocation?.cli === 'ego-browser' && invocation?.subcommand === 'nodejs',
    `CLI 调用解析出 cli + 子命令（实得 ${JSON.stringify(invocation)}）`)
  need(browserCliInvocationOf('ego-browser --help')?.subcommand === '',
    '只有开关没有子命令时 subcommand 为空串')

  const byMcp = browserActivityLabelOf('mcp__browseros_neo__navigate', {})
  need(byMcp?.service === 'browseros_neo' && byMcp?.tool === 'navigate',
    `MCP 工具的展示标签来自工具名（实得 ${JSON.stringify(byMcp)}）`)
  /*
   * nodejs / run / exec 这类通用子命令对用户没有信息量：胶囊写成「浏览器操作中 ·
   * nodejs」读不出这是浏览器操作。所以命中通用表时 tool 留空，客户端退回显示
   * CLI 名（「浏览器操作中 · ego-browser」）。
   */
  const byCli = browserActivityLabelOf('pwsh', { arguments: { command: 'ego-browser nodejs -e "x"' } })
  need(byCli?.service === 'ego-browser' && byCli?.tool === '',
    `通用子命令留空（实得 ${JSON.stringify(byCli)}）`)
  const byCliNamed = browserActivityLabelOf('pwsh', { arguments: { command: 'ego-browser screenshot --url x' } })
  need(byCliNamed?.service === 'ego-browser' && byCliNamed?.tool === 'screenshot',
    `有意义的子命令照常显示（实得 ${JSON.stringify(byCliNamed)}）`)
  need(browserActivityLabelOf('pwsh', { arguments: { command: 'ls' } }) === null,
    '普通命令不算浏览器操作')
  need(browserActivityLabelOf('read', { arguments: { command: 'ego-browser nodejs' } }) === null,
    '非 shell 工具即使参数里有 CLI 字样也不算（判据先看工具名）')
  need(browserActivityLabelOf(undefined, undefined) === null, '空工具名返回 null')
}

// ── 3. parseBrowserToolName：service / tool 切分 ──────────────────────────
{
  const a = parseBrowserToolName('mcp__playwright-mcp__browser_click')
  need(a?.service === 'playwright-mcp' && a?.tool === 'browser_click',
    `service = 第二段、tool = 第三段（实得 ${JSON.stringify(a)}）`)
  const b = parseBrowserToolName('mcp__foo__a__b')
  need(b?.service === 'foo' && b?.tool === 'a__b',
    `tool 里自带 __ 时原样保留（实得 ${JSON.stringify(b)}）`)
  need(parseBrowserToolName('pwsh') === null, '非 mcp 名解析为 null')
  need(parseBrowserToolName('mcp__svc') === null, '缺 tool 段解析为 null')
  need(parseBrowserToolName(undefined) === null && parseBrowserToolName('') === null,
    '空值解析为 null')
}

// ── 4. 会话归属取值顺序 ───────────────────────────────────────────────────
{
  const bySession = sessionIdOfExecution({ agent: { session: { id: 'S-1' }, id: 'A-1' } })
  need(bySession === 'S-1', 'sessionId 优先取 agent.session.id')

  const byAgent = sessionIdOfExecution({ agent: { id: 'A-2' } })
  need(byAgent === 'A-2', 'agent.session.id 缺失时退化到 agent.id')

  const byArgs = sessionIdOfExecution({ arguments: { sessionId: 'S-3' } })
  need(byArgs === 'S-3', 'agent 缺失时退化到 arguments.sessionId')

  const none = sessionIdOfExecution({ arguments: {} })
  need(none === '', '三条都拿不到时返回空串（调用方必须跳过，不得算到别的会话）')

  // cordis 的 ctx 是 Proxy：读属性抛错不能冒出去
  const throwing = { get agent() { throw new Error('cannot get property "agent" without inject') } }
  need(sessionIdOfExecution(throwing) === '', '读 agent 抛错时静默返回空串（不冒泡）')

  /*
   * 来源（via）必须与取值结果严格对应 —— 这是诊断路由的全部价值所在：
   * 真实运行时若取不到 sessionId，只看「空串」无法区分「字段改名了」还是
   * 「这次调用本来就没有 agent」，而 via 直接指认是哪条路径断的。
   */
  const sources = [
    [{ agent: { session: { id: 'S-1' }, id: 'A-1' } }, 'agent.session.id', 'S-1'],
    [{ agent: { id: 'A-2' } }, 'agent.id', 'A-2'],
    [{ agent: {}, arguments: { sessionId: 'S-3' } }, 'arguments.sessionId', 'S-3'],
    [{ arguments: {} }, 'none', ''],
    [{}, 'none', ''],
  ]
  const badSource = sources.filter(([exec, wantVia, wantId]) => {
    const got = sessionSourceOfExecution(exec)
    return got.via !== wantVia || got.sessionId !== wantId
  })
  need(badSource.length === 0,
    `sessionSourceOfExecution 的来源与值一一对应（错项 ${JSON.stringify(badSource.map(b => b[1]))}）`)
  need(sessionSourceOfExecution(throwing).via === 'none', '读 agent 抛错时 via = none')

  // 老签名不许被破坏：sessionIdOfExecution 与带来源版本必须永远同值
  const sameAcross = sources.every(([exec]) =>
    sessionIdOfExecution(exec) === sessionSourceOfExecution(exec).sessionId)
  need(sameAcross, 'sessionIdOfExecution 与 sessionSourceOfExecution 结果逐项一致（老签名未破）')
  need(sessionIdOfAgent(null) === '' && sessionIdOfAgent(undefined) === '', '空 agent 返回空串')
}

// ── 测试脚手架：假时钟 ────────────────────────────────────────────────────
/** 造一个受控 tracker 与可推进的假时钟。 */
function harness(options = {}) {
  const clock = { at: 1_000_000 }
  const tracker = new BrowserActivityTracker({
    now: () => clock.at,
    ...options,
  })
  return {
    tracker, clock,
    /** 推进假时钟（毫秒）。 */
    advance(ms) { clock.at += ms },
    /** 只取某会话在快照里的那一行。 */
    row(sessionId, filter) {
      const snap = tracker.snapshot(filter)
      return snap.sessions.find(row => row.sessionId === sessionId)
    },
  }
}

// ── 5. 状态机：begin / active 计数 / 去重 ─────────────────────────────────
{
  const h = harness()
  h.tracker.begin('S-1', 'call-a', 'mcp__playwright-mcp__browser_navigate')
  const first = h.row('S-1')
  need(first !== undefined && first.active === 1 && first.lingering === false,
    `begin 后 active=1 且非尾迹（实得 ${JSON.stringify(first)}）`)
  need(first.service === 'playwright-mcp' && first.tool === 'browser_navigate',
    'service / tool 按工具名解析')
  need(first.since === 1_000_000 && first.lastAt === 1_000_000,
    '单个调用时 since 与 lastAt 同值')

  // 并发：同一会话两个不同 callId
  h.advance(120)
  h.tracker.begin('S-1', 'call-b', 'mcp__playwright-mcp__browser_snapshot')
  const second = h.row('S-1')
  need(second.active === 2, `并发调用 active=2（实得 ${second?.active}）`)
  need(second.since === 1_000_000, 'since 取最早那次调用（不是最近一次）')
  need(second.lastAt === 1_000_120, 'lastAt 取最近一次调用')
  need(second.tool === 'browser_snapshot', 'service/tool 取最近开始的那一次（正在做什么）')

  // 去重：同一 callId 重复 begin 不重复计数、不刷新时间
  h.tracker.begin('S-1', 'call-b', 'mcp__playwright-mcp__browser_snapshot')
  const dedup = h.row('S-1')
  need(dedup.active === 2, `同一 callId 重复 begin 不重复计数（实得 ${dedup?.active}）`)
  need(dedup.lastAt === 1_000_120, '重复 begin 不刷新 lastAt')

  // end 一个：还剩一个，仍算活跃
  h.tracker.end('S-1', 'call-a')
  const afterOne = h.row('S-1')
  need(afterOne.active === 1 && afterOne.lingering === false,
    `结束一个后仍活跃（实得 ${JSON.stringify(afterOne)}）`)
  need(afterOne.since === 1_000_120, 'since 重算到仍在进行的那一次')

  // end 不存在的 callKey：不得把会话弄成「零调用却非尾迹」的怪状态
  h.tracker.end('S-1', 'not-exist')
  need(h.row('S-1')?.active === 1, 'end 未配对的 callKey 静默无事')

  /*
   * 交错场景：先起的调用还在跑，后起的那个已经结束。
   *
   * lastAt 的契约是「最近一次调用的开始时间」，那一次完全可能已经结束了 ——
   * 只从「进行中的调用」里取最大值会把 lastAt 算回最早的这次，客户端拿它算
   * 「刚才那一下有多近」就会得出错的相对时间。since 则必须只从进行中的里面取。
   */
  const h2 = harness()
  h2.tracker.begin('S-9', 'k1', 'mcp__playwright-mcp__browser_a')
  h2.advance(200)
  h2.tracker.begin('S-9', 'k2', 'mcp__playwright-mcp__browser_b')
  h2.advance(200)
  h2.tracker.end('S-9', 'k2') // 后起的先结束，早起的还在跑
  const interleaved = h2.row('S-9')
  need(interleaved.active === 1, `交错场景下只剩一个进行中的调用（实得 ${interleaved?.active}）`)
  need(interleaved.since === 1_000_000, `since 只算进行中那一次（实得 ${interleaved?.since}）`)
  need(interleaved.lastAt === 1_000_200, `lastAt 含已结束的那次（最近一次开始时间，实得 ${interleaved?.lastAt}）`)
  need(interleaved.lingering === false, '还有一个调用在跑时不进尾迹')
}

// ── 6. 尾迹：LINGER 内仍可见，超过后消失 ──────────────────────────────────
{
  const h = harness()
  h.tracker.begin('S-1', 'call-a', 'mcp__playwright-mcp__browser_click')
  h.advance(400)
  h.tracker.end('S-1', 'call-a')

  const inTrail = h.row('S-1')
  need(inTrail !== undefined && inTrail.lingering === true && inTrail.active === 0,
    `结束后立刻进入尾迹（实得 ${JSON.stringify(inTrail)}）`)
  need(inTrail.since === 1_000_000 && inTrail.lastAt === 1_000_000,
    '尾迹期的 since/lastAt = 那一次调用的开始时间')
  need(inTrail.service === 'playwright-mcp' && inTrail.tool === 'browser_click',
    '尾迹期保留最后一次的 service/tool（图标 tooltip 还能说明刚做了什么）')

  h.advance(BROWSER_ACTIVITY_LINGER_MS - 1)
  need(h.row('S-1') !== undefined, `尾迹 ${BROWSER_ACTIVITY_LINGER_MS - 1}ms 仍可见（上限内不掉）`)

  h.advance(1) // 累计到 LINGER
  need(h.row('S-1')?.lingering === true, `恰好 ${BROWSER_ACTIVITY_LINGER_MS}ms 边界仍可见（<= 而非 <）`)

  h.advance(1) // 超界 1ms
  need(h.row('S-1') === undefined, `超过 ${BROWSER_ACTIVITY_LINGER_MS}ms 后消失`)
  need(h.tracker.size === 0, '过期会话被惰性清出 Map（不留下只写不删的表）')
}

// ── 7. 尾迹被新调用打断：重新变活跃 ───────────────────────────────────────
{
  const h = harness()
  h.tracker.begin('S-1', 'call-a', 'mcp__playwright-mcp__browser_click')
  h.tracker.end('S-1', 'call-a')
  h.advance(800)
  need(h.row('S-1')?.lingering === true, '连续调用之间处于尾迹期')

  h.tracker.begin('S-1', 'call-b', 'mcp__playwright-mcp__browser_type')
  const again = h.row('S-1')
  need(again.lingering === false && again.active === 1,
    `新调用把尾迹转回活跃（实得 ${JSON.stringify(again)}）`)
  need(again.since === 1_000_800, '新一段操作的 since 是这次调用的开始时间')
}

// ── 7b. 真实序列：一串连续调用之间，图标不得灭一下 ────────────────────────
// 这是尾迹窗存在的**唯一理由**：playwright 一次网页操作就是 navigate → snapshot
// → click → type 这样一串工具调用，模型在两次调用之间还要想几百毫秒。没有尾迹
// 窗，用户看到的就是一个频闪的图标 —— 反而比不显示更像故障。
{
  const h = harness()
  // 每次调用间隔 600ms（模型在两步之间思考的典型量级），每次都短于尾迹窗。
  const sequence = ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_snapshot']
  let visibleThroughout = true
  for (let i = 0; i < sequence.length; i += 1) {
    h.tracker.begin('S-live', 'seq-' + String(i), 'mcp__playwright-mcp__' + sequence[i])
    // 调用进行中必然可见
    if (h.row('S-live') === undefined) visibleThroughout = false
    h.advance(150)
    h.tracker.end('S-live', 'seq-' + String(i))
    // 结束后立刻看：尾迹期内必须仍可见
    if (h.row('S-live') === undefined) visibleThroughout = false
    h.advance(450) // 合计 600ms 的调用间隔
    if (h.row('S-live') === undefined) visibleThroughout = false
  }
  need(visibleThroughout, `连续 5 次调用全程可见（间隔 600ms < 尾迹 ${BROWSER_ACTIVITY_LINGER_MS}ms，不得闪烁）`)

  // 序列真结束：等过尾迹窗就必须灭
  h.advance(BROWSER_ACTIVITY_LINGER_MS)
  need(h.row('S-live') === undefined, '序列结束后超过尾迹窗，图标熄灭')
}

// ── 8. 多会话隔离 + ?session= 过滤 ────────────────────────────────────────
{
  const h = harness()
  h.tracker.begin('S-1', 'call-a', 'mcp__playwright-mcp__browser_click')
  h.tracker.begin('S-2', 'call-b', 'mcp__chrome-devtools__take_snapshot')
  h.tracker.begin('S-3', 'call-c', 'pwsh') // 调用方不该传进来，但传了也不能亮

  const all = h.tracker.snapshot()
  need(all.sessions.length === 3, `快照包含全部有记录的会话（实得 ${all.sessions.length}）`)

  const only = h.tracker.snapshot('S-2')
  need(only.sessions.length === 1 && only.sessions[0].sessionId === 'S-2',
    `?session= 只回该会话（实得 ${JSON.stringify(only.sessions.map(s => s.sessionId))}）`)

  const unknown = h.tracker.snapshot('S-nope')
  need(unknown.sessions.length === 0, '未知会话过滤后为空')

  // 空串等价于不过滤
  need(h.tracker.snapshot('').sessions.length === 3, '空串 session 参数等价于不过滤')

  // forget：会话销毁后立刻消失
  h.tracker.forget('S-1')
  need(h.tracker.snapshot('S-1').sessions.length === 0, 'forget 后该会话立刻消失')
  need(h.tracker.snapshot().sessions.length === 2, 'forget 不影响其它会话')
}

// ── 9. dispose：清空全部状态 ──────────────────────────────────────────────
{
  const h = harness()
  h.tracker.begin('S-1', 'call-a', 'mcp__playwright-mcp__browser_click')
  h.tracker.dispose()
  need(h.tracker.size === 0, 'dispose 清空会话表（插件卸载不留残留）')
  // dispose 后再 begin 不得复活（卸载后的 tracker 是死的）
  h.tracker.begin('S-1', 'call-b', 'mcp__playwright-mcp__browser_click')
  need(h.tracker.size === 0, 'dispose 后 begin 无效（已卸载的 tracker 不复活）')
}

// ── 10. applyBrowserActivity 接线：只拦浏览器工具 + 会话归属 ──────────────
{
  const clock = { at: 5_000_000 }
  const listeners = []
  const effects = []
  const injections = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    on(event, listener) { listeners.push({ event, listener }) },
    inject(names, callback) { injections.push({ names, callback }) },
    effect(fn, label) { effects.push(label); fn() },
  }
  const handle = mod.applyBrowserActivity(ctx, { now: () => clock.at })
  need(handle !== null, 'applyBrowserActivity 返回句柄')
  need(handle.tracking === true, 'tracking = true（ctx.on 可用）')
  // 两处延迟注入：webServer（挂路由）与 jobs（跟踪转后台的调用）。
  // 都不能在 apply 同步路径上直接读 —— 那两个属性是 Proxy，未 inject 时一读就抛。
  need(injections.some(i => i.names.includes('webServer')),
    '延迟注入 webServer（不在 apply 同步路径读 ctx.webServer）')
  need(injections.some(i => i.names.includes('jobs')),
    '延迟注入 jobs（转后台的浏览器调用靠它的结算事件收尾）')
  need(listeners.some(l => l.event === 'tools/execute'), '注册了 tools/execute 观测')

  const execute = listeners.find(l => l.event === 'tools/execute').listener
  const call = (exec, next = async () => 'done') => execute(exec, next)

  // 普通工具：原样透传，不产生任何记录
  let nextCalls = 0
  const plain = await call({ name: 'pwsh', callId: 'c1', agent: { session: { id: 'S-1' } } },
    async () => { nextCalls += 1; return 'r' })
  need(plain === 'r' && nextCalls === 1, '普通工具调用原样透传')
  need(handle.snapshot().sessions.length === 0, '普通工具不产生活动记录')

  // 浏览器工具：调用期间可见，结束后进尾迹
  let duringCall = null
  await call({ name: 'mcp__playwright-mcp__browser_click', callId: 'c2', agent: { session: { id: 'S-1' } } },
    async () => { duringCall = handle.snapshot('S-1').sessions[0] ?? null; return 'ok' })
  need(duringCall !== null && duringCall.active === 1 && duringCall.lingering === false,
    `浏览器调用进行中 active=1（实得 ${JSON.stringify(duringCall)}）`)
  const afterCall = handle.snapshot('S-1').sessions[0]
  need(afterCall?.lingering === true, '调用结束后进入尾迹（图标不立刻黑掉）')

  // 拿不到会话：跳过观测，不得算到任何会话上
  await call({ name: 'mcp__playwright-mcp__browser_click', callId: 'c3' })
  need(handle.snapshot().sessions.length === 1,
    '拿不到 sessionId 的调用被跳过（不会在无关会话上点亮图标）')

  // next() 抛错：end 仍要执行（finally），不得让条目永久挂着
  const beforeThrow = handle.snapshot().sessions.length
  let threw = false
  try {
    await call({ name: 'mcp__playwright-mcp__browser_snapshot', callId: 'c4', agent: { session: { id: 'S-2' } } },
      async () => { throw new Error('tool boom') })
  } catch { threw = true }
  need(threw, 'next() 抛错照常向上冒（观测器不吞工具错误）')
  const afterThrow = handle.snapshot()
  const s2 = afterThrow.sessions.find(row => row.sessionId === 'S-2')
  need(s2 !== undefined && s2.active === 0 && s2.lingering === true,
    `调用失败也走 end（实得 ${JSON.stringify(s2)}）`)
  need(afterThrow.sessions.length === beforeThrow + 1, '失败调用只留下尾迹，不留下永久活跃条目')

  /*
   * 端到端：同一条观测器里，pwsh 跑 ego-browser 也必须登记成一段浏览器活动，
   * 且展示标签是 ego-browser / nodejs（而不是笼统的 pwsh）—— 这是「用 ego 点
   * 网页时界面上看得出」的唯一判据。
   */
  {
    let duringEgo = null
    await call({
      name: 'pwsh',
      callId: 'c-ego',
      agent: { session: { id: 'S-ego' } },
      arguments: { command: 'ego-browser nodejs -e "await page.click(\'a\')"', description: 'click link' },
    }, async () => {
      duringEgo = handle.snapshot('S-ego').sessions[0] ?? null
      return 'ok'
    })
    need(duringEgo !== null && duringEgo.active === 1,
      `pwsh 跑 ego-browser 时登记为浏览器活动（实得 ${JSON.stringify(duringEgo)}）`)
    need(duringEgo?.service === 'ego-browser' && duringEgo?.tool === '',
      `ego 的展示标签 = ego-browser（tool 留空，不显示 nodejs；实得 ${JSON.stringify(duringEgo)}）`)
    need(duringEgo?.sessionId === 'S-ego', 'ego 的活动记在发起它的那个会话上')

    // 反向：普通 pwsh 命令不得登记
    await call({
      name: 'pwsh',
      callId: 'c-plain',
      agent: { session: { id: 'S-plain' } },
      arguments: { command: 'Get-ChildItem D:\\AI', description: 'list files' },
    })
    need(handle.snapshot('S-plain').sessions.length === 0,
      '普通 pwsh 命令不登记为浏览器活动（不误伤）')

    // 反向：grep 提到 ego-browser 也只是「谈论」，不登记
    await call({
      name: 'pwsh',
      callId: 'c-grep',
      agent: { session: { id: 'S-grep' } },
      arguments: { command: 'grep ego-browser README.md', description: 'search docs' },
    })
    need(handle.snapshot('S-grep').sessions.length === 0,
      'grep ego-browser 不登记（判的是可执行位置，不是文本包含）')

    handle.tracker.forget('S-ego')
  }

  // agent/disposed：会话销毁即清
  const disposed = listeners.find(l => l.event === 'agent/disposed')
  need(disposed !== undefined, '注册了 agent/disposed 清理')
  disposed.listener({ agent: { session: { id: 'S-2' } } })
  need(handle.snapshot('S-2').sessions.length === 0, 'agent/disposed 清掉该会话')

  // enabled:false：不装配
  const off = mod.applyBrowserActivity({ on: () => {}, logger: {} }, { enabled: false })
  need(off === null, 'enabled:false 时不装配')

  // ctx.on 缺失：不抛错，返回句柄但 tracking=false（路由照挂）
  const noOnListeners = []
  const noOn = mod.applyBrowserActivity({
    logger: {},
    inject(names, callback) { noOnListeners.push({ names, callback }) },
  }, {})
  need(noOn !== null && noOn.tracking === false, 'ctx.on 缺失时静默降级（tracking=false 不抛错）')
  need(noOnListeners.length === 2, 'ctx.on 缺失时路由与 jobs 订阅仍然注入')

  handle.dispose()
}

// ── 11. 路由：假 ctx 挂路由 + 真 HTTP 请求 ────────────────────────────────
{
  const clock = { at: 7_000_000 }
  const registrations = []
  const fakeWebCtx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    get: () => undefined,
    webServer: { register(spec) { registrations.push(spec); return () => {} } },
  }
  // 假 ctx.get('agents')：路由不依赖它，但宿主 ctx 上确实有这个服务面
  const fakeListeners = []
  const fakeCtx = {
    logger: fakeWebCtx.logger,
    on(event, listener) { fakeListeners.push({ event, listener }) },
    effect: fakeWebCtx.effect,
    get: (name) => (name === 'agents' ? { get: () => undefined } : undefined),
    inject(names, callback) {
      if (names.includes('webServer')) callback(fakeWebCtx)
    },
  }

  const handle = mod.applyBrowserActivity(fakeCtx, { now: () => clock.at })
  const route = registrations.find(spec => spec?.path === BROWSER_ACTIVITY_ROUTE)
  need(route !== undefined, `注册了 ${BROWSER_ACTIVITY_ROUTE} 路由`)
  need(route?.kind === 'exact', `路由是 exact（实得 ${route?.kind}）`)
  need(typeof route?.handler === 'function', '路由带 handler')

  if (route !== undefined && typeof route.handler === 'function') {
    const server = http.createServer((req, res) => route.handler(req, res))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const port = server.address().port
    const get = (path) => new Promise((done) => {
      const req = http.get({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          let payload = null
          try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { payload = null }
          done({ status: res.statusCode, headers: res.headers, payload })
        })
      })
      req.on('error', () => done({ status: 0, headers: {}, payload: null }))
    })

    try {
      // 11a) 无活动：200 + ok:true + 空数组（不是 404，客户端要能区分「没活动」）
      const empty = await get(BROWSER_ACTIVITY_ROUTE)
      need(empty.status === 200 && empty.payload?.ok === true && Array.isArray(empty.payload?.sessions),
        `无活动时 200 + ok:true + sessions:[]（实得 ${empty.status} ${JSON.stringify(empty.payload)}）`)
      need(empty.payload.sessions.length === 0, '无活动时 sessions 为空数组')
      need(typeof empty.payload.now === 'number', '响应带 now（客户端据此算相对时间）')
      need(String(empty.headers['cache-control'] ?? '').includes('no-store'),
        'Cache-Control: no-store（轮询不能命中缓存）')

      // 11b) 有活动：形状逐字段对齐契约
      handle.tracker.begin('S-http', 'call-h', 'mcp__playwright-mcp__browser_click')
      const live = await get(BROWSER_ACTIVITY_ROUTE)
      const row = live.payload?.sessions?.find(s => s.sessionId === 'S-http')
      need(live.status === 200 && live.payload?.ok === true, '有活动时 200 + ok:true')
      need(row !== undefined, '响应里出现活动会话')
      if (row !== undefined) {
        const keys = Object.keys(row).sort()
        const want = ['active', 'lastAt', 'lingering', 'service', 'sessionId', 'since', 'tool'].sort()
        need(JSON.stringify(keys) === JSON.stringify(want),
          `条目字段与契约逐字一致（实得 ${JSON.stringify(keys)}）`)
        need(row.active === 1 && row.lingering === false, '进行中的条目 active=1、lingering=false')
        need(row.service === 'playwright-mcp' && row.tool === 'browser_click', 'service/tool 解析正确')
        need(row.since === 7_000_000 && row.lastAt === 7_000_000, 'since/lastAt 是毫秒时间戳')
      }

      // 11c) ?session= 过滤
      handle.tracker.begin('S-other', 'call-o', 'mcp__playwright-mcp__browser_type')
      const filtered = await get(BROWSER_ACTIVITY_ROUTE + '?session=S-http')
      need(filtered.payload?.sessions?.length === 1
        && filtered.payload.sessions[0].sessionId === 'S-http',
        `?session= 只回该会话（实得 ${JSON.stringify(filtered.payload?.sessions?.map(s => s.sessionId))}）`)
      const none = await get(BROWSER_ACTIVITY_ROUTE + '?session=S-nope')
      need(none.status === 200 && none.payload?.ok === true && none.payload.sessions.length === 0,
        `未知 session 过滤 → 200 + 空数组（实得 ${none.status}）`)

      // 11d) 非 GET：仍然 200 + ok:false（只读路由不制造 4xx/5xx）
      const posted = await new Promise((done) => {
        const req = http.request({
          host: '127.0.0.1', port, path: BROWSER_ACTIVITY_ROUTE, method: 'POST',
          headers: { host: `127.0.0.1:${port}`, 'content-length': '0' },
        }, (res) => {
          const chunks = []
          res.on('data', c => chunks.push(c))
          res.on('end', () => {
            let payload = null
            try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { payload = null }
            done({ status: res.statusCode, payload })
          })
        })
        req.on('error', () => done({ status: 0, payload: null }))
        req.end()
      })
      need(posted.status === 200 && posted.payload?.ok === false,
        `非 GET 请求 200 + ok:false（实得 ${posted.status} ${JSON.stringify(posted.payload)}）`)
      need(Array.isArray(posted.payload?.sessions) && posted.payload.sessions.length === 0,
        'ok:false 时 sessions 是空数组（客户端可无条件读该字段）')

      // 11e) 快照内部抛错：绝不 5xx，一律 200 + ok:false + 空数组
      const broken = { snapshot() { throw new Error('snapshot boom') } }
      const brokenServer = http.createServer((req, res) => handleBrowserActivityRoute(req, res, broken))
      await new Promise(done => brokenServer.listen(0, '127.0.0.1', done))
      const brokenPort = brokenServer.address().port
      const brokenRes = await new Promise((done) => {
        const req = http.get({ host: '127.0.0.1', port: brokenPort, path: BROWSER_ACTIVITY_ROUTE,
          headers: { host: `127.0.0.1:${brokenPort}` } }, (res) => {
          const chunks = []
          res.on('data', c => chunks.push(c))
          res.on('end', () => {
            let payload = null
            try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { payload = null }
            done({ status: res.statusCode, payload })
          })
        })
        req.on('error', () => done({ status: 0, payload: null }))
      })
      await new Promise(done => brokenServer.close(done))
      need(brokenRes.status === 200 && brokenRes.payload?.ok === false,
        `内部异常时 200 + ok:false（实得 ${brokenRes.status} ${JSON.stringify(brokenRes.payload)}）`)
      need(Array.isArray(brokenRes.payload?.sessions) && brokenRes.payload.sessions.length === 0,
        '异常降级时 sessions 是空数组')

      // 11f) 畸形 URL 也不炸（URL 解析失败走同一降级分支）
      const weird = await get(BROWSER_ACTIVITY_ROUTE + '?session=%E0%A4%A')
      need(weird.status === 200 && (weird.payload?.ok === true || weird.payload?.ok === false),
        `畸形查询串仍返回 200 JSON（实得 ${weird.status}）`)

      /*
       * 11g) ?debug=1：接缝自证。
       *
       * 走真的 tools/execute 观测器（不是直推内部缓冲），因为要验的正是「观测器
       * 在真实 exec 形状下记了什么」。假 exec 里塞了密码与页面文本当靶子 —— 那份
       * 摘要必须是纯标量，一旦有人图省事把 exec.arguments 整个塞进去，这里立刻红。
       */
      const execute = fakeListeners.find(l => l.event === 'tools/execute')?.listener
      need(typeof execute === 'function', '路由用例里能拿到 tools/execute 观测器')

      const SECRET = 'hunter2-SECRET-DO-NOT-LEAK'
      const poisonArgs = {
        sessionId: 'ignored-because-agent-wins',
        password: SECRET,
        text: '登录密码 ' + SECRET,
        url: 'https://example.com/private',
        cookies: [{ name: 'sess', value: SECRET }],
      }
      if (typeof execute === 'function') {
        const next = async () => 'ok'
        // ① 正常：agent.session.id
        await execute({ name: 'mcp__playwright-mcp__browser_type', callId: 'dbg-1',
          agent: { session: { id: 'S-dbg' } }, arguments: poisonArgs }, next)
        // ② agent 在但只有 id
        await execute({ name: 'mcp__playwright-mcp__browser_click', callId: 'dbg-2',
          agent: { id: 'S-dbg-by-agent-id' }, arguments: {} }, next)
        // ③ 没有 agent：退化到 arguments.sessionId
        await execute({ name: 'mcp__chrome-devtools__take_snapshot',
          arguments: { sessionId: 'S-dbg-by-args' } }, next)
        // ④ 一条都取不到：via = none（这才是最需要被看见的情形）
        await execute({ name: 'mcp__playwright-mcp__browser_snapshot',
          arguments: { url: 'https://example.com/private', password: SECRET } }, next)
        // ⑤ 非浏览器工具：不进缓冲
        await execute({ name: 'pwsh', callId: 'dbg-plain',
          agent: { session: { id: 'S-dbg' } }, arguments: { command: 'echo ' + SECRET } }, next)

        const debugRes = await get(BROWSER_ACTIVITY_ROUTE + '?debug=1')
        const entries = debugRes.payload?.debug
        need(debugRes.status === 200 && debugRes.payload?.ok === true, '?debug=1 仍 200 + ok:true')
        need(Array.isArray(entries) && entries.length === 4,
          `?debug=1 回 4 条摘要（非浏览器工具不入缓冲，实得 ${Array.isArray(entries) ? entries.length : 'null'}）`)

        if (Array.isArray(entries)) {
          const keys = Object.keys(entries[0] ?? {}).sort()
          need(JSON.stringify(keys) === JSON.stringify(['at', 'hasCallId', 'name', 'resolvedVia', 'sessionIdResolved']),
            `摘要字段恰为五个约定键（实得 ${JSON.stringify(keys)}）`)

          const byName = new Map(entries.map(entry => [entry.name, entry]))
          const first = byName.get('mcp__playwright-mcp__browser_type')
          need(first?.resolvedVia === 'agent.session.id' && first?.sessionIdResolved === 'S-dbg',
            `agent.session.id 路径被认出（实得 ${JSON.stringify(first)}）`)
          need(first?.hasCallId === true, 'hasCallId=true（这次执行带了 callId）')

          const second = byName.get('mcp__playwright-mcp__browser_click')
          need(second?.resolvedVia === 'agent.id' && second?.sessionIdResolved === 'S-dbg-by-agent-id',
            `agent.id 退化路径被认出（实得 ${JSON.stringify(second)}）`)

          const third = byName.get('mcp__chrome-devtools__take_snapshot')
          need(third?.resolvedVia === 'arguments.sessionId' && third?.sessionIdResolved === 'S-dbg-by-args',
            `arguments.sessionId 退化路径被认出（实得 ${JSON.stringify(third)}）`)
          need(third?.hasCallId === false, 'hasCallId=false（这次执行没有 callId，去重退化成合成键）')

          const fourth = byName.get('mcp__playwright-mcp__browser_snapshot')
          need(fourth?.resolvedVia === 'none' && fourth?.sessionIdResolved === '',
            `三条都取不到时 via=none（接缝断点可见，实得 ${JSON.stringify(fourth)}）`)

          // 隐私硬约束：整份摘要里不得出现任何参数内容
          const serialized = JSON.stringify(entries)
          need(!serialized.includes(SECRET), '摘要里绝不出现参数里的密码原文')
          need(!serialized.includes('password') && !serialized.includes('cookies')
            && !serialized.includes('/private'),
            '摘要里不出现参数键名与参数值（只留工具名与来源标量）')
        }

        // 环形上限：推满 20 条之后只留最新的 20 条
        for (let i = 0; i < 25; i += 1) {
          await execute({ name: 'mcp__playwright-mcp__ring_' + String(i), callId: 'ring-' + String(i),
            agent: { session: { id: 'S-ring' } }, arguments: {} }, next)
        }
        const ringRes = await get(BROWSER_ACTIVITY_ROUTE + '?debug=1')
        need(ringRes.payload?.debug?.length === BROWSER_ACTIVITY_DEBUG_LIMIT,
          `环形缓冲上限 ${BROWSER_ACTIVITY_DEBUG_LIMIT}（实得 ${ringRes.payload?.debug?.length}）`)
        need(ringRes.payload.debug.at(-1)?.name === 'mcp__playwright-mcp__ring_24',
          '环形缓冲保留最新的一条（挤掉最旧的）')
        need(!ringRes.payload.debug.some(entry => entry.name === 'mcp__playwright-mcp__ring_0'),
          '最早的一条已被挤掉')

        // 11h) 默认形状不受 debug 影响：不带参数时顶层与条目都没有额外键
        const plainRes = await get(BROWSER_ACTIVITY_ROUTE)
        need(!('debug' in (plainRes.payload ?? {})), '不带 ?debug 时响应里没有 debug 键（主契约形状不变）')
        need(JSON.stringify(Object.keys(plainRes.payload ?? {}).sort())
          === JSON.stringify(['now', 'ok', 'sessions']),
          `顶层键恰为 ok/now/sessions（实得 ${JSON.stringify(Object.keys(plainRes.payload ?? {}))}）`)

        // ?debug=0 / 其它值都算关（只认显式 1/true，避免歧义）
        const offRes = await get(BROWSER_ACTIVITY_ROUTE + '?debug=0')
        need(!('debug' in (offRes.payload ?? {})), '?debug=0 不返回 debug（只认 1/true）')

        /*
         * debug 与 session 组合：sessions 按会话过滤，debug 仍是全量。
         *
         * 是刻意的 —— 诊断要回答的是「接缝整体是否还对得上」，而不是「这个会话
         * 有没有对得上」。若 debug 也过滤，排查「为什么这个会话不亮」时反而会
         * 看不到别的会话里那些成功的样本，失去对照。
         */
        const combined = await get(BROWSER_ACTIVITY_ROUTE + '?debug=1&session=S-http')
        need(combined.payload?.debug?.length === BROWSER_ACTIVITY_DEBUG_LIMIT,
          `debug 不受 ?session= 过滤（诊断是接缝级的，实得 ${combined.payload?.debug?.length}）`)
        need(combined.payload?.sessions?.every(row => row.sessionId === 'S-http'),
          'sessions 仍按 ?session= 过滤（两者互不影响）')
      }
    } finally {
      await new Promise(done => server.close(done))
      handle.dispose()
    }
  }
}

// ── 11a. backgroundJobIdOf：只认 promoted / background 两种规范形状 ────────
{
  need(backgroundJobIdOf({ value: { kind: 'promoted', jobId: 'j-1' } }) === 'j-1',
    'promoted 结果取出 jobId')
  need(backgroundJobIdOf({ value: { kind: 'background', jobId: 'j-2' } }) === 'j-2',
    'background 结果取出 jobId')
  need(backgroundJobIdOf({ kind: 'promoted', jobId: 'j-3' }) === 'j-3',
    '直接传 canonical value 也认（不强制包在 ToolExecutionResult 里）')
  need(backgroundJobIdOf({ value: { kind: 'foreground', jobId: 'x' } }) === '',
    'foreground 结果不算后台（jobId 存在也不行）')
  need(backgroundJobIdOf({ value: { kind: 'promoted' } }) === '',
    'promoted 但缺 jobId → 空串（退回普通收尾，绝不静默丢条目）')
  need(backgroundJobIdOf({ value: { jobId: 'x' } }) === '',
    '有 jobId 但没 kind → 空串（job_output 之类回显 jobId 的工具不得被误判）')
  need(backgroundJobIdOf(null) === '' && backgroundJobIdOf(undefined) === '',
    'null / undefined 返回空串且不抛')
  need(backgroundJobIdOf('promoted') === '', '字符串结果不该被当成后台句柄')
}

// ── 11a2. tracker 级的 transferToJob / settleJob / 兜底看护 ────────────────
{
  const h = harness()
  h.tracker.begin('S-t', 'call-1', 'pwsh', { service: 'ego-browser', tool: '' })
  need(h.row('S-t')?.active === 1, 'begin 后活跃')
  need(h.tracker.transferToJob('S-t', 'call-1', 'job-x') === true, 'transferToJob 成功')
  // 转后台后：条目不许因 idleSince 被尾迹扫掉
  h.advance(60_000)
  need(h.row('S-t')?.active === 1, '转后台后 60s 仍活跃（尾迹不适用）')
  need(h.tracker.settleJob('job-x') === true, 'settleJob 收掉该条目')
  need(h.row('S-t')?.active === 0 && h.row('S-t')?.lingering === true, '结算后进尾迹')
  need(h.tracker.settleJob('job-x') === false, '重复 settleJob 幂等（第二次返回 false）')
  need(h.tracker.settleJob('job-unknown') === false, '未知 jobId 静默返回 false')
  need(h.tracker.settleJob('') === false && h.tracker.settleJob(null) === false,
    '空 / null jobId 返回 false 且不抛')

  // transferToJob 的前置条件不满足时返回 false（调用方据此退回普通 end）
  need(h.tracker.transferToJob('S-missing', 'c', 'job-y') === false, '会话不存在时 transferToJob 返回 false')
  h.tracker.begin('S-t2', 'call-2', 'pwsh', { service: 'ego-browser', tool: '' })
  need(h.tracker.transferToJob('S-t2', 'unknown-call', 'job-z') === false,
    'callKey 不存在时 transferToJob 返回 false')
  need(h.tracker.transferToJob('S-t2', 'call-2', '') === false, '空 jobId 返回 false')

  // forget 要把该会话名下的 job 映射一起摘掉（否则结算时反查到幽灵会话）
  h.tracker.forget('S-t2')
  need(h.tracker.settleJob('job-z') === false, 'forget 后的 job 映射已清（settleJob 返回 false）')

  // 兜底看护：常量是 6 小时，且必须是「远大于任何人类操作」的量级
  need(mod.BROWSER_ACTIVITY_JOB_WATCH_MAX_MS === 6 * 60 * 60 * 1000,
    '后台 job 看护上限 6 小时（只在 settled 事件丢失时兜底）')
}

// ── 11b. 转后台的调用：进程还在跑，标志就不能灭 ───────────────────────────
/*
 * 用户实测反馈的故障：浏览器操作没中止，但左侧列表里的标志先没了。
 *
 * 根因是 `pwsh` 的两条后台路径：前台等待超时会转后台并立刻返回
 * （`kind: promoted`），显式 `run_in_background` 更是从一开始就只回 jobId
 * （`kind: background`）。两种情况下 `tools/execute` 都已经结束、但浏览器进程
 * 还在跑 —— 观测器照着「调用结束就 end」的旧规则收尾，图标就提前灭了。
 */
{
  const clock = { at: 9_000_000 }
  const listeners = []
  const injections = []
  let jobListener = null
  const unsubscribed = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    on(event, listener) { listeners.push({ event, listener }) },
    inject(names, callback) {
      injections.push({ names, callback })
      // jobs 注入：给一个真实的订阅面，把监听器抓出来手动喂事件。
      if (names.includes('jobs') && !names.includes('webServer')) {
        callback({
          jobs: {
            events: {
              subscribe(filter, listener) {
                if (filter.owners !== 'all') throw new Error('应订阅全部 owner')
                jobListener = listener
                return () => { unsubscribed.push(filter.owners) }
              },
            },
          },
        })
      }
    },
    effect(fn, label) { fn() },
  }
  const handle = mod.applyBrowserActivity(ctx, { now: () => clock.at })
  const execute = listeners.find(l => l.event === 'tools/execute').listener
  need(jobListener !== null, '注入了 jobs.events 订阅（owners: all）')

  // 1) promoted：前台超时转后台 —— 调用结束后仍必须亮着
  await execute({ name: 'pwsh', callId: 'p-1', agent: { session: { id: 'S-job' } },
    arguments: { command: 'ego-browser nodejs task.mjs', description: 'run task' } },
    async () => ({ isError: false, value: { kind: 'promoted', jobId: 'pwsh-aaa', cwd: 'D:/x', timeoutMs: 800, output: '' }, content: [] }))
  const promotedRow = handle.snapshot('S-job').sessions[0]
  need(promotedRow !== undefined && promotedRow.active === 1 && promotedRow.lingering === false,
    `转后台后仍算活跃（实得 ${JSON.stringify(promotedRow)}）`)
  need(promotedRow.service === 'ego-browser', '转后台后展示标签仍是 ego-browser')

  // 2) 时钟推很久也不灭：这是「没做尾迹倒计时」的直接证据
  clock.at += 60_000
  need(handle.snapshot('S-job').sessions[0]?.active === 1,
    '转后台的调用不会因时间流逝被当成结束（60s 后仍亮）')

  // 3) settled 事件到达：此时才收尾，进尾迹
  jobListener({ type: 'settled', job: { id: 'pwsh-aaa' }, cause: 'producer', awaited: false })
  const settledRow = handle.snapshot('S-job').sessions[0]
  need(settledRow !== undefined && settledRow.active === 0 && settledRow.lingering === true,
    `job 结算后才进尾迹（实得 ${JSON.stringify(settledRow)}）`)

  // 4) 重复的 settled 幂等（事件可能因重连/重复投递来两次）
  jobListener({ type: 'settled', job: { id: 'pwsh-aaa' } })
  need(handle.snapshot('S-job').sessions[0]?.active === 0, '重复 settled 幂等（不把 active 算成负的）')

  // 5) background：显式后台执行，同样不能在 tools/execute 结束时收尾
  await execute({ name: 'pwsh', callId: 'p-2', agent: { session: { id: 'S-bg' } },
    arguments: { command: 'ego-browser nodejs long.mjs', description: 'run long' } },
    async () => ({ isError: false, value: { kind: 'background', jobId: 'pwsh-bbb', cwd: 'D:/x' }, content: [] }))
  need(handle.snapshot('S-bg').sessions[0]?.active === 1, '显式后台的调用同样保持活跃')

  // 6) removed 也收尾（调用方自己消费完终态后 remove）
  jobListener({ type: 'removed', job: { id: 'pwsh-bbb' } })
  need(handle.snapshot('S-bg').sessions[0]?.active === 0, 'job removed 同样收尾')

  // 7) 不是浏览器调用、但结果里带 jobId：不得凭空亮灯
  await execute({ name: 'pwsh', callId: 'p-3', agent: { session: { id: 'S-plain-bg' } },
    arguments: { command: 'Get-ChildItem D:/AI', description: 'list' } },
    async () => ({ isError: false, value: { kind: 'promoted', jobId: 'pwsh-ccc', cwd: 'D:/x', timeoutMs: 1, output: '' }, content: [] }))
  need(handle.snapshot('S-plain-bg').sessions.length === 0,
    '普通命令转后台不登记（判据仍是命令行，不是结果形状）')

  // 8) 后台 job 的浏览器调用，其 job 结算事件只影响它自己的会话
  await execute({ name: 'pwsh', callId: 'p-4', agent: { session: { id: 'S-iso' } },
    arguments: { command: 'ego-browser nodejs a.mjs', description: 'a' } },
    async () => ({ isError: false, value: { kind: 'promoted', jobId: 'pwsh-ddd', cwd: 'D:/x', timeoutMs: 1, output: '' }, content: [] }))
  need(handle.snapshot('S-iso').sessions[0]?.active === 1, '第二个会话的后台调用也是活跃的')
  jobListener({ type: 'settled', job: { id: 'pwsh-unknown' } })
  need(handle.snapshot('S-iso').sessions[0]?.active === 1,
    '不认识的 jobId 结算不影响任何会话（不做「收到 settled 就清空」的粗暴处理）')

  // 9) settled 之后再看 agent/disposed：清理仍然正常
  const disposed = listeners.find(l => l.event === 'agent/disposed')
  disposed.listener({ agent: { session: { id: 'S-job' } } })
  need(handle.snapshot('S-job').sessions.length === 0, 'job 结算后的会话仍能被 agent/disposed 清掉')

  handle.dispose()
}

// ── 12. 构建产物仍是自包含的（本模块不引入 @deepseek-ai/* 运行时依赖）────
{
  const source = readFileSync(HOST, 'utf8')
  const specs = [...source.matchAll(/(?:^|[;\n])\s*(?:import|export)[^\n]*?from\s*["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(s => !s.startsWith('node:') && s !== 'undici')
  need(specs.length === 0, `host 产物仍零外部依赖（实际 ${JSON.stringify(specs)}）`)
}

if (process.exitCode === 1) console.error('\n[browser-activity] 有用例失败')
else console.log('\n[browser-activity] 全部通过')
