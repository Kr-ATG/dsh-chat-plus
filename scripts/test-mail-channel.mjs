/**
 * dsh-chat-plus — Agent 邮箱通道端到端测试。
 *
 * 真跑 `lib/index.js` 的 `applyMailHost`（不是扫源码字符串），验证这条通道
 * 的四个行为面：
 *
 *   ① enabled=false 时工具不注册、声明不注入，但诊断路由仍在
 *      （关掉后用户还得靠面板把它打开回来）；
 *   ② **运行中**拨开 enabled → 工具立刻注册、闸门立刻放行（不用重启 DSH）；
 *   ③ 拨回 false → 工具立刻注销（不会留下模型还能调的 mail_*）；
 *   ④ injectEnabled 与 enabled 是两道独立的闸门。
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

/** 11 个 mail_* wire 工具（与 tools.ts 一致）。 */
const MAIL_TOOLS = [
  'mail_account', 'mail_list', 'mail_search', 'mail_read', 'mail_send', 'mail_reply',
  'mail_forward', 'mail_trash', 'mail_delete', 'mail_download_attachment', 'mail_wait_code',
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
  return messages.some(message => JSON.stringify(message).includes('Agent 邮箱 · 内置通道'))
}

const mailToolCount = (state) => state.tools.filter(name => MAIL_TOOLS.includes(name)).length
const settle = () => new Promise(r => setTimeout(r, 200))

// ── 起步：enabled=false（正是用户当时的配置）───────────────────────────
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

if (mailToolCount(state) !== 0) fail(`enabled=false 时不该注册 mail_* 工具（实得 ${mailToolCount(state)} 个）`)
else pass('enabled=false：mail_* 工具不注册')

if (await runPreStep(state, 's1')) fail('enabled=false 时不该注入邮箱声明（声明与能力必须同生共死）')
else pass('enabled=false：不注入邮箱声明')

if (!state.routes.has('/api/dsh-mail')) fail('路由必须恒挂（关掉后用户还要靠面板把它打开回来）')
else pass('enabled=false：诊断路由仍在（面板能把它打开回来）')

// ── 运行中拨开 enabled（本次修复的核心：不用重启）─────────────────────
await handle.service.updateConfig({ enabled: true })
await settle()
if (mailToolCount(state) !== MAIL_TOOLS.length) {
  fail(`运行中拨开 enabled 后应立即注册全部 ${MAIL_TOOLS.length} 个 mail_* 工具（实得 ${mailToolCount(state)}）`)
} else {
  pass(`运行中拨开 enabled：${MAIL_TOOLS.length} 个 mail_* 工具立即注册（不用重启 DSH）`)
}

// ── 拨回 false ─────────────────────────────────────────────────────────
await handle.service.updateConfig({ enabled: false })
await settle()
if (mailToolCount(state) !== 0) fail(`拨回 false 后应注销全部工具（实得还剩 ${mailToolCount(state)} 个）`)
else pass('运行中拨回 enabled=false：工具立即注销（不会留下模型还能调的 mail_*）')

// ── 两道闸门独立 ───────────────────────────────────────────────────────
await handle.service.updateConfig({ enabled: true, injectEnabled: false })
await settle()
if (mailToolCount(state) !== MAIL_TOOLS.length) {
  fail(`injectEnabled=false 不该影响工具注册（实得 ${mailToolCount(state)} 个）`)
} else {
  pass('injectEnabled=false：工具照常注册（两道闸门各管各的）')
}
if (await runPreStep(state, 's4')) fail('injectEnabled=false 时不该注入声明')
else pass('injectEnabled=false：不注入（声明开关独立生效）')

const finalConfig = handle.service.getConfig()
if (finalConfig.enabled !== true || finalConfig.injectEnabled !== false) {
  fail(`配置回读不符：${JSON.stringify(finalConfig)}`)
} else {
  pass('配置回读一致（enabled=true, injectEnabled=false）')
}

// ── 状态槽位（记忆卡片读它）────────────────────────────────────────────
{
  const { getMailStatusSource } = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
    .then(() => import('../src/mail/registry.js')).catch(() => ({ getMailStatusSource: null }))
  if (getMailStatusSource === null) {
    // 源码 TS 不能直接 import（Node 不认 .ts），跳过而不是失败：槽位的行为
    // 由 smoke-triad-host 的端点断言覆盖（它走 HTTP 路由读同一份数据）。
    pass('状态槽位：源码态跳过（行为由 smoke-triad-host 的 /mail-inject-state 断言覆盖）')
  } else {
    const snapshot = getMailStatusSource()?.snapshot()
    if (snapshot === undefined || snapshot === null) fail('状态槽位应已写入')
    else pass(`状态槽位已写入（workbenchEnabled=${String(snapshot.workbenchEnabled)}）`)
  }
}

rmSync(SMOKE_HOME, { recursive: true, force: true })
console.log(process.exitCode
  ? '\nMAIL CHANNEL TEST FAILED'
  : '\nMAIL CHANNEL TEST PASSED — 闸门现读 + 工具动态挂卸 + 两道闸门独立')
