/**
 * dsh-chat-plus — Agent 邮箱通道端到端测试。
 *
 * 真跑 `lib/index.js` 的 `applyMailHost`（不是扫源码字符串），验证这条通道
 * 的四个行为面：
 *
 *   ① 工作台关着时工具不注册，但诊断路由仍在（关掉后用户还得靠面板打开回来）；
 *   ② **运行中**拨开工作台 → 工具立刻注册（不用重启 DSH）；
 *   ③ 拨回关 → 工具立刻注销（不会留下模型还能调的 mail_*）；
 *   ④ **声明与工具解耦**（用户明确要求）：工作台关着、只要声明开关开着，
 *      pre-step 闸门就放行——关掉工作台往往只是想省下那些 mail_* 工具每轮占的
 *      schema，不该因此让模型忘掉自己有个邮箱（那样每次注册又要用户提醒）。
 *
 * 为什么必须有这个测试：这条通道出过一个「两个开关套在一起、用户开的那个被
 * 吞掉」的静默失效 —— `enabled` 曾是启动期装配开关，用户在面板上拨它，界面
 * 显示已启用、运行中的进程毫无变化，只能重启 DSH 才生效，而且全程没有任何
 * 提示。用户的感受是「每次注册都要我自己提醒你用邮箱」。扫源码的断言抓不到
 * 这一类缺陷（代码里每个符号都在），只有真跑装配 + 真拨开关才抓得到。
 *
 * 隔离：DSH_HOME 指向 _tmp 下的临时目录，绝不碰用户真实的
 * `~/.dsh/mail/dsh-mail/store/config.json`（那个文件里存着用户自己的开关）。
 *
 * Usage: node scripts/test-mail-channel.mjs
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

/*
 * DSH_HOME 必须在**插件模块求值之前**设置：store 的路径是调用时读环境变量
 * （`mailDataDir()` 里 `process.env['DSH_HOME'] ?? homedir()`），所以这段放在
 * 所有 import 之后、`await import(插件)` 之前是有效的。
 */
const SMOKE_HOME = mkdtempSync(join(tmpdir(), 'dsh-mail-channel-'))
process.env.DSH_HOME = SMOKE_HOME
mkdirSync(join(SMOKE_HOME, 'mail', 'dsh-mail', 'store'), { recursive: true })

let mod
try {
  mod = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
} catch (error) {
  fail(`cannot import lib/index.js: ${error?.stack ?? error}`)
  process.exit(1)
}

/** 6 个 mail_* wire 工具（与 tools.ts 一致；写类 5 个已整块下线）。 */
const MAIL_TOOLS = [
  'mail_account', 'mail_list', 'mail_search', 'mail_read',
  'mail_download_attachment', 'mail_wait_code',
]

/** 造一个足够 applyMailHost 跑起来的桩 ctx。 */
function makeCtx() {
  const state = { tools: [], listeners: new Map(), routes: new Map() }
  const ctx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    webServer: {
      register(route) {
        state.routes.set(route.path, route)
        return () => state.routes.delete(route.path)
      },
    },
    tools: {
      register(definition) {
        if (typeof definition.name !== 'string') throw new Error('tool without name')
        state.tools.push(definition.name)
        return () => {
          const i = state.tools.indexOf(definition.name)
          if (i >= 0) state.tools.splice(i, 1)
        }
      },
      schemas: () => [],
    },
    on(event, handler) {
      if (!state.listeners.has(event)) state.listeners.set(event, [])
      state.listeners.get(event).push(handler)
      return () => {}
    },
    // 与真实 cordis 同语义：**立即执行** cb，返回值当 disposer。
    // 写成 `effect(fn) { fn() }` 而不登记 disposer 的话，本次抓到过的那个
    // 「注册下一行就把工具全注销」的 bug 会在这里逃逸。
    effect(fn) {
      const dispose = fn?.()
      state.effects ??= []
      state.effects.push(typeof dispose === 'function' ? dispose : () => {})
      return () => {}
    },
  }
  return { ctx, state }
}

/** 跑一次 pre-step，返回是否注入了邮箱声明。 */
async function runPreStep(state, sessionId) {
  let messages = []
  for (const listener of state.listeners.get('agent/pre-step') ?? []) {
    const out = await listener(
      { agent: { id: sessionId, session: { id: sessionId } }, messages: [], signal: { aborted: false } },
      async () => ({ kind: 'enter', messages: [] }),
    )
    if (out?.kind === 'enter') messages = out.messages
  }
  const text = JSON.stringify(messages)
  return {
    injected: text.includes('Agent 邮箱 · 内置通道'),
    // 工具缺席时应走 CLI 版本（点名 agently-cli），有工具时应点名 mail_*。
    cliVariant: text.includes('agently-cli message +list'),
  }
}

const mailToolCount = (state) => state.tools.filter(name => MAIL_TOOLS.includes(name)).length
const settle = () => new Promise(r => setTimeout(r, 200))

// ── 起步：工作台关着、声明开着（正是用户要的那个组合）──────────────────
writeFileSync(
  join(SMOKE_HOME, 'mail', 'dsh-mail', 'store', 'config.json'),
  JSON.stringify({ enabled: false, injectEnabled: true }),
)
const { ctx, state } = makeCtx()
let handle
try {
  handle = await mod.applyMailHost(ctx, {})
} catch (error) {
  fail(`applyMailHost threw: ${error?.stack ?? error}`)
  rmSync(SMOKE_HOME, { recursive: true, force: true })
  process.exit(1)
}
await settle()

if (mailToolCount(state) !== 0) fail(`工作台关着时不该注册 mail_* 工具（实得 ${mailToolCount(state)} 个）`)
else pass('工作台关着：mail_* 工具不注册')

/*
 * ④ 解耦的**核心断言**：工作台关着、声明开着 → 闸门必须放行。
 *
 * 本环境（隔离的 DSH_HOME）没有真实凭据，账号探测会失败，注入器按设计跳过
 * 正文（「把你有邮箱说成假的比不说更糟」）。所以这里**不能**断言「一定注入了
 * 正文」——那会把「未授权跳过」误判成缺陷。改成断言闸门确实走到了探测那一步：
 * 用一个假的 account 结果把授权补上，再验文本形态。
 */
if (!state.listeners.has('agent/pre-step')) {
  fail('注入器必须常驻注册（挂在 enabled 之下的话，工作台一关模型就不知道有邮箱了）')
} else {
  pass('工作台关着：注入器仍常驻注册（声明与工具解耦的前提）')
}

if (!state.routes.has('/api/dsh-mail')) fail('路由必须恒挂（关掉后用户还要靠面板把它打开回来）')
else pass('工作台关着：诊断路由仍在（面板能把它打开回来）')

// ── 运行中拨开工作台（不用重启）───────────────────────────────────────
await handle.service.updateConfig({ enabled: true })
await settle()
if (mailToolCount(state) !== MAIL_TOOLS.length) {
  fail(`运行中拨开工作台后应立即注册全部 ${MAIL_TOOLS.length} 个 mail_* 工具（实得 ${mailToolCount(state)}）`)
} else {
  pass(`运行中拨开工作台：${MAIL_TOOLS.length} 个 mail_* 工具立即注册（不用重启 DSH）`)
}

// ── 拨回关 ─────────────────────────────────────────────────────────────
await handle.service.updateConfig({ enabled: false })
await settle()
if (mailToolCount(state) !== 0) fail(`拨回关后应注销全部工具（实得还剩 ${mailToolCount(state)} 个）`)
else pass('运行中拨回工作台关：工具立即注销（不会留下模型还能调的 mail_*）')

// ── 声明开关独立：关掉它才是真的不注入 ────────────────────────────────
await handle.service.updateConfig({ enabled: true, injectEnabled: false })
await settle()
if (mailToolCount(state) !== MAIL_TOOLS.length) {
  fail(`声明开关关掉不该影响工具注册（实得 ${mailToolCount(state)} 个）`)
} else {
  pass('声明开关关：工具照常注册（两道开关各管各的）')
}
{
  const r = await runPreStep(state, 's4')
  if (r.injected) fail('声明开关关掉时不该注入（它才是这条通道的总闸）')
  else pass('声明开关关：不注入（它才是声明这条通道的闸门）')
}

// ── 解耦的行为证据：工作台关、声明开 → 文本走 CLI 版 ──────────────────
/*
 * 这是本次最关键的断言：**工具缺席时注入文本必须换一份**（点名 agently-cli），
 * 否则声明「你有邮箱」却让模型去调不存在的 mail_*，等于把用户支到 UNKNOWN_TOOL。
 *
 * 实现方式：注入器不从 lib/index.js 拿（那是打好的产物，内部函数取不到），而是
 * 让**真实装配**来跑 —— 把 account 探测打桩成「已授权」，然后走上面那个真
 * applyMailHost 注册的 pre-step 监听器。工具开着 / 关着各跑一次，比对文本形态。
 *
 * 只断言「注入了」是不够的：那样「工具缺席却写着 mail_*」的缺陷会溜过去。
 */
{
  /*
   * 打桩点：`MailService.account()` 会调 CLI，而隔离的 DSH_HOME 里没有凭据。
   * 直接替换实例方法（原型上打补丁会污染其它用例，实例级最干净）。
   */
  const realAccount = handle.service.account.bind(handle.service)
  handle.service.account = async () => ({
    auth: { logged_in: true, status: 'logged_in', token_status: 'valid' },
    me: {
      aliases: [{ alias_id: 'a1', email: 'probe@agent.qq.com', name: 'probe', is_primary: true }],
      scopes: ['mail'],
      constraints: { max_attachment_count: 10, max_attachment_size_bytes: '20971520', max_total_attachments_size_bytes: '20971520' },
      rate_limits: { daily_send_quota: 50, requests_per_hour: 200, requests_per_minute: 10 },
    },
    primary: { alias_id: 'a1', email: 'probe@agent.qq.com', name: 'probe', is_primary: true },
    error: null,
  })

  // 工具**在**：文本应点名 mail_* 工具。
  await handle.service.updateConfig({ enabled: true, injectEnabled: true })
  await settle()
  const withTools = await runPreStep(state, 'probe-with-tools')
  if (!withTools.injected) fail('工具在时应当注入声明（闸门放行 + 已授权）')
  else if (!withTools.cliVariant === false) fail('工具在时不该走 CLI 版文本')
  else pass('文本形态：工具在 → 注入工具版（不点名 agently-cli）')

  // 工具**不在**（工作台关、声明开）：文本必须改走 CLI 版。
  await handle.service.updateConfig({ enabled: false, injectEnabled: true })
  await settle()
  if (mailToolCount(state) !== 0) fail('这一步的前提是工具已注销')
  const withoutTools = await runPreStep(state, 'probe-without-tools')
  if (!withoutTools.injected) {
    fail('工作台关着、声明开着时**仍应注入**（这正是用户要的解耦：关工作台只是想省工具 schema，不是想让模型忘掉邮箱）')
  } else if (!withoutTools.cliVariant) {
    fail('工具缺席时注入文本必须走 agently-cli 命令行版（写成 mail_* 会让模型去调不存在的工具）')
  } else {
    pass('文本形态：工具不在（工作台关、声明开）→ 改走 agently-cli 命令行（解耦生效）')
  }

  handle.service.account = realAccount
}

const finalConfig = handle.service.getConfig()
// 上一步刻意把状态停在「工作台关、声明开」——那正是用户要的组合，也是本条
// 通道最该被记住的状态。配置回读据此断言，别写成两者都 true。
if (finalConfig.enabled !== false || finalConfig.injectEnabled !== true) {
  fail(`配置回读不符（期望 enabled=false, injectEnabled=true）：${JSON.stringify(finalConfig)}`)
} else {
  pass('配置回读一致（enabled=false, injectEnabled=true —— 用户要的那个组合）')
}

rmSync(SMOKE_HOME, { recursive: true, force: true })
console.log(process.exitCode
  ? '\nMAIL CHANNEL TEST FAILED'
  : '\nMAIL CHANNEL TEST PASSED — 声明与工具解耦 + 闸门现读 + 工具动态挂卸')
