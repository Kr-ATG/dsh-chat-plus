/**
 * 两阶段确认的真实链路测试（直连 agently-cli，不经 HTTP）。
 *
 * 这个脚本存在的理由：`trash()` 只收形参不往下传 token 这类 bug，靠读源码的
 * smoke 断言很难抓住（正则容易写歪），而它在真实调用里一眼就露馅 —— 返回
 * pending 而不是 done。所以这里直接打真链路。
 *
 * 用法：node scripts/test-mail-two-phase.mjs [--send]
 *   默认只测「移入回收站」（可逆、安全）；
 *   --send 额外测发信（会真的发一封到自己邮箱）。
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const fail = (m) => { console.error(`FAIL  ${m}`); process.exitCode = 1 }
const pass = (m) => console.log(`ok    ${m}`)

const mod = await import(pathToFileURL(resolve(ROOT, 'lib/index.js')).href)

// 直接构造 service（绕过 HTTP 与 cordis），用真实 CLI。
const { MailStore } = await import(pathToFileURL(resolve(ROOT, 'src/mail/store.ts')).href).catch(() => ({}))
// src 是 TS，node 跑不了 —— 改从产物里取。applyMailHost 会建实例，这里用一个
// 极简 stub ctx 把它装配起来。
const routes = new Map()
const tools = []
const effects = []
const ctx = {
  logger: { info: () => {}, warn: (m) => console.log('   warn:', m), debug: () => {} },
  webServer: { register: (r) => { routes.set(r.path, r); return () => {} } },
  tools: { register: (d) => { tools.push(d.name); return () => {} } },
  effect: (fn) => { const d = fn(); effects.push(d); return () => {} },
  on: () => () => {},
}
const handle = await mod.applyMailHost(ctx, { watchEnabled: false })
const service = handle.service

pass(`mail service 装配完成（tools=${tools.length}）`)

// ── 1. 找一封收件箱邮件 ────────────────────────────────────────────────
const page = await service.list({ dir: 'inbox', limit: 5 })
if (page.messages.length === 0) {
  console.log('info  收件箱为空，跳过（先给邮箱发一封邮件再跑）')
  process.exit(process.exitCode ?? 0)
}
const target = page.messages[0]
console.log(`   目标邮件：${target.subject}  ${target.message_id}`)

// ── 2. 移入回收站：一次调用必须直接 done ───────────────────────────────
/** 找一封还没进回收站的收件箱邮件（跑第二遍时用）。 */
async function pickAnother() {
  const fresh = await service.list({ dir: 'inbox', limit: 5 })
  if (fresh.messages.length === 0) {
    console.log('info  收件箱已空，跳过第二次校验')
    return null
  }
  return fresh.messages[0].message_id
}

const outcome = await service.trashNow(target.message_id)
if (outcome.status !== 'done') {
  fail(`trashNow 应直接 done，实际 ${outcome.status}（说明第二阶段的 token 没传下去）`)
} else {
  pass('移入回收站：一次调用走完两阶段（status=done，不残留待确认）')
}

// ── 3. 确认真的进了回收站 ──────────────────────────────────────────────
await new Promise(r => setTimeout(r, 2500))
const trash = await service.list({ dir: 'trash', limit: 10 })
if (trash.messages.some(m => m.message_id === target.message_id)) {
  pass('邮件确实出现在回收站')
} else {
  fail('邮件没进回收站（trashNow 报了 done 但实际没生效）')
}

// ── 4. 待确认队列不该**新增**残留 ──────────────────────────────────────
// 只比对本轮之前就存在的令牌：队列里可能有历史残留（上一轮失败尝试留下的
// 旧 ctk，5 分钟 TTL 未到），那不是本次点击造成的，不该算失败。
const staleBefore = new Set((await service.pending()).map(p => p.token))
const second = await pickAnother()
if (second === null) {
  pass(`待确认队列无新增残留（收件箱已空，跳过第二次校验）`)
} else {
  const outcome2 = await service.trashNow(second)
  const afterTokens = (await service.pending()).map(p => p.token)
  const leaked = afterTokens.filter(t => !staleBefore.has(t))
  if (leaked.length > 0) {
    fail(`一次点击留下了新的待确认记录（${leaked.length} 条）—— 第二阶段的 token 没传下去`)
  } else {
    pass(`待确认队列无新增残留（忽略 ${staleBefore.size} 条历史旧令牌）`)
  }
  if (outcome2.status !== 'done') fail(`第二次 trashNow 也应直接 done，实际 ${outcome2.status}`)
}

// ── 5. 可选：发信两阶段 ────────────────────────────────────────────────
if (process.argv.includes('--send')) {
  const me = (await service.account()).primary?.email
  const first = await service.send({
    recipients: { to: [me] },
    subject: '两阶段链路自测',
    body: '这条来自 scripts/test-mail-two-phase.mjs。',
    format: 'plain',
  })
  if (first.status !== 'pending') {
    fail(`send 第一阶段应 pending，实际 ${first.status}`)
  } else {
    pass('send 第一阶段：拿到确认令牌')
    const second = await service.confirmPending(first.token)
    if (second.status !== 'done') fail(`confirmPending 应 done，实际 ${second.status}`)
    else pass('send 第二阶段：带令牌执行成功（replay 参数完整）')
  }
}

console.log(`\n${process.exitCode ? 'TWO-PHASE TEST FAILED' : 'TWO-PHASE TEST PASSED'}`)
process.exit(process.exitCode ?? 0)
