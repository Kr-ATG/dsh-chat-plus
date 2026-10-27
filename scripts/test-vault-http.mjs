/**
 * 档案路由的进程内集成测试：把真实 HTTP handler 挂到裸 http server 上，
 * 用真请求打一遍。冒烟里已经测了 store/inject/health 这些纯逻辑，但
 * 路由层是另一套代码（loopback 闸门、反跨站、body 解析、状态码、
 * content-disposition），它出错的方式和引擎完全不同，必须单独验。
 */
import { createServer, request as httpRequest } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SMOKE_HOME = resolve(ROOT, '_tmp', 'test-vault-http-home')
try { rmSync(SMOKE_HOME, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.env.DSH_HOME = SMOKE_HOME

const fail = (msg) => { console.error('FAIL  ' + msg); process.exitCode = 1 }
const pass = (msg) => console.log('ok    ' + msg)
const assert = (cond, msg) => { if (cond) pass(msg); else fail(msg) }

const OUT_DIR = resolve(ROOT, '_tmp', 'test-vault-http-bundle')
try { rmSync(OUT_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }
mkdirSync(OUT_DIR, { recursive: true })

/*
 * 打两个包：
 *   api.mjs    —— 路由层（要测的就是它里面的 handler）
 *   store.mjs / crypto.mjs / types.mjs —— 造数据与断言用
 * api.ts 不重导出 store，所以必须分开打，不能只打一个包。
 */
const ENGINE_SOURCES = [
  ['api', 'api.ts'],
  ['store', 'store.ts'],
  ['crypto', 'crypto.ts'],
  ['types', 'types.ts'],
  /* sync.ts 一起打：路由层要测 /sync*，而它要一个真的 VaultSync 实例。
   * 用假的会让「保存设置时加密落盘」这条最关键的纪律逃出测试范围。 */
  ['sync', 'sync.ts'],
  ['sync-types', 'sync-types.ts'],
]
await build({
  entryPoints: ENGINE_SOURCES.map(([, file]) => resolve(ROOT, 'src/triad/vault', file)),
  outdir: OUT_DIR,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outExtension: { '.js': '.mjs' },
  logLevel: 'silent',
})
const api = await import(pathToFileURL(join(OUT_DIR, 'api.mjs')).href)
const storeModule = await import(pathToFileURL(join(OUT_DIR, 'store.mjs')).href)
const types = await import(pathToFileURL(join(OUT_DIR, 'types.mjs')).href)
const VaultCipher = (await import(pathToFileURL(join(OUT_DIR, 'crypto.mjs')).href)).VaultCipher
const syncModule = await import(pathToFileURL(join(OUT_DIR, 'sync.mjs')).href)
const VaultStore = storeModule.VaultStore
const VaultSync = syncModule.VaultSync
const DEFAULT_VAULT_CONFIG = types.DEFAULT_VAULT_CONFIG
const { mountVaultRoutes } = api

const probe = new VaultStore(null)
const cipher = await VaultCipher.load(probe.keyFile)
assert(cipher !== null, 'cipher loaded for the route test')
const store = new VaultStore(cipher)

/*
 * 用真的 mountVaultRoutes：它内部调 ctx.webServer.register。给一个最小假
 * webServer 把 handler 抓出来挂到裸 server 上，这样打的是真 handler。
 */
let handler = null
const fakeCtx = {
  webServer: { register: (route) => { handler = route.handler; return () => { handler = null } } },
  logger: { warn: () => {}, info: () => {}, debug: () => {} },
}
const config = { ...DEFAULT_VAULT_CONFIG }
const vaultSync = new VaultSync(store, cipher, { info: () => {}, warn: () => {}, debug: () => {} })
mountVaultRoutes(fakeCtx, store, config, vaultSync)
assert(typeof handler === 'function', 'mountVaultRoutes registers a handler')

const server = createServer((req, res) => handler(req, res))
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const port = server.address().port
const base = 'http://127.0.0.1:' + port + '/api/dsh-vault'

/** 发一个请求，返回 { status, headers, text, json }。 */
async function call(path, options = {}) {
  const init = { method: options.method ?? 'GET' }
  if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }
    init.body = JSON.stringify(options.body)
  } else if (options.headers !== undefined) {
    init.headers = options.headers
  }
  const response = await fetch(base + path, init)
  const text = await response.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* 非 JSON（下载响应） */ }
  return { status: response.status, headers: response.headers, text, json: parsed }
}

// ── 1. 鉴权闸门 ─────────────────────────────────────────────────────────
/*
 * loopback 闸门要看 Host 头，而 fetch（undici）不允许改 Host —— 传了会被
 * 静默忽略，于是断言「永远是 200」而看不到真结果。这里必须用 http.request
 * 直接发，才真的能伪造 Host。
 */
function rawStatus(path, hostHeader) {
  return new Promise((ok, bad) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: '/api/dsh-vault' + path, method: 'GET', headers: { host: hostHeader }, setHost: false }, (response) => {
      response.resume()
      ok(response.statusCode)
    })
    request.on('error', bad)
    request.end()
  })
}
assert(await rawStatus('/list', 'evil.example.com') === 403, 'a non-loopback Host header is rejected (403)')
assert(await rawStatus('/list', '127.0.0.1:' + port) === 200, 'a loopback Host header passes the gate')

// 反跨站：带外站 Origin 的 POST 必须 403。
const crossSite = await call('/record', { method: 'POST', body: { scene: 'other', title: 'x' }, headers: { origin: 'https://evil.example.com' } })
assert(crossSite.status === 403, 'a cross-site POST is rejected (403)')

// ── 2. 未知路径 ─────────────────────────────────────────────────────────
const unknown = await call('/nope')
assert(unknown.status === 404 && unknown.json !== null && unknown.json.ok === false,
  'an unknown path returns 404 with ok:false')
assert(typeof unknown.json.error === 'string' && unknown.json.error.includes('/nope'),
  'the 404 names the path it could not route')

// ── 3. 到期提醒 ─────────────────────────────────────────────────────────
/* 原来这里是 /health 审计路由（弱口令 / 复用 / 分数）。用户 2026-10-27 要求删掉
 * 那一整套，只留「会自己变坏」的日期提醒，于是路由改成 /reminders，断言也换成
 * 日期语义：空库没有提醒、90 天内会报、已过期会报、响应里不出现任何明文。 */
const remind0 = await call('/reminders')
assert(remind0.status === 200 && remind0.json.ok === true, 'GET /reminders answers ok')
assert(Array.isArray(remind0.json.report.reminders) && remind0.json.report.reminders.length === 0,
  'an empty vault has no reminders')

const soonDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const soonRecord = await call('/record', { method: 'POST', body: {
  scene: 'document', title: '路由测试 · 护照',
  fields: [{ key: 'expiry', label: '到期日', type: 'date', value: soonDate }],
} })
const remind1 = await call('/reminders')
assert(remind1.json.report.reminders.some((item) => item.recordId === soonRecord.json.record.id),
  'GET /reminders lists the document expiring in 10 days')
const remindItem = remind1.json.report.reminders.find((item) => item.recordId === soonRecord.json.record.id)
assert(remindItem.days > 0 && remindItem.days <= 90, 'the reminder carries the remaining days')
assert(remindItem.fieldLabel === '到期日' && remindItem.due === soonDate,
  'the reminder carries the field label and the exact date so the user can verify it')
assert(remindItem.expired === false, 'a future date is not marked expired')

// 密码类记录绝不出现在提醒里：那一整套审计已经不在了，别再借道提醒复活它。
await call('/record', { method: 'POST', body: {
  scene: 'accounts', title: '路由测试 · 弱口令',
  fields: [{ key: 'password', label: '密码', type: 'secret', value: '123456' }],
} })
const remind2 = await call('/reminders')
assert(!remind2.json.report.reminders.some((item) => item.title === '路由测试 · 弱口令'),
  'a record with no date field never shows up in the reminder list')
assert(!remind2.text.includes('123456'), 'the reminder response never carries a secret value')
// 已删掉的那几条路由必须真的不存在（否则等于留着半套旧功能）。
for (const gone of ['/health', '/rotate']) {
  const response = await call(gone)
  assert(response.status === 404, 'the retired route ' + gone + ' is really gone')
}

// ── 4. 密钥指纹 ─────────────────────────────────────────────────────────
const keyInfo = await call('/key-info')
assert(keyInfo.status === 200 && keyInfo.json.info.exists === true, 'GET /key-info reports the key exists')
assert(/^[a-f0-9]{16}$/.test(keyInfo.json.info.fingerprint), 'the fingerprint is 16 hex chars')
assert(typeof keyInfo.json.info.createdAt === 'undefined', 'key-info does not invent a createdAt it does not know')

// ── 5. 加密备份 / 恢复 ──────────────────────────────────────────────────
const shortPwd = await call('/backup', { method: 'POST', body: { password: '123' } })
assert(shortPwd.status === 400 && shortPwd.json.ok === false, 'a too-short backup password is refused (400)')

const backup = await call('/backup', { method: 'POST', body: { password: 'route-test-passphrase' } })
assert(backup.status === 200, 'POST /backup succeeds')
assert((backup.headers.get('content-disposition') ?? '').includes('dsh-vault-backup-'),
  'the backup is served as a download with the expected filename')
assert((backup.headers.get('cache-control') ?? '') === 'no-store', 'the backup is never cached')
assert(backup.json !== null && backup.json.format === 'dsh-vault-backup', 'the backup body is the backup envelope')
assert(!backup.text.includes('123456'), 'the backup never carries the password in clear')

const badRestore = await call('/restore', { method: 'POST', body: { password: 'nope-nope-nope', package: backup.text } })
assert(badRestore.status === 400 && badRestore.json.ok === false, 'a wrong restore password is refused (400)')
assert(typeof badRestore.json.error === 'string' && badRestore.json.error.length > 0,
  'the restore failure carries a human-readable Chinese reason')

const emptyRestore = await call('/restore', { method: 'POST', body: { password: 'route-test-passphrase' } })
assert(emptyRestore.status === 400, 'restore without a package is refused (400)')

const goodRestore = await call('/restore', { method: 'POST', body: { password: 'route-test-passphrase', package: backup.text } })
assert(goodRestore.status === 200 && goodRestore.json.ok === true, 'restoring the backup succeeds')
assert(goodRestore.json.result.records >= 1, 'the restore reports how many records came back')
assert(goodRestore.json.result.replaced === true, 'the restore reports that it replaced the vault')

// 恢复之后密码仍然能解开：这是「换机救命」这条链路唯一的验收标准。
const afterRestore = await call('/reveal', { method: 'POST', body: { id: (await call('/list')).json.records[0].id, key: 'password' } })
assert(afterRestore.status === 200 && afterRestore.json.value === '123456',
  'after a restore the password still decrypts (the key travelled with the backup)')
assert((afterRestore.headers.get('cache-control') ?? '') === 'no-store', 'a revealed value is never cached')

// ── 6. TOTP 路由 ───────────────────────────────────────────────────────
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const listNow = await call('/list')
const totpRecord = listNow.json.records.find((r) => r.title.includes('路由测试'))

// 先给那条记录加一个 totp 字段（走真实的 /field 路由）。
const addTotp = await call('/field', { method: 'POST', body: { id: totpRecord.id, key: 'totp', label: '二次验证', type: 'secret', value: SEED } })
assert(addTotp.status === 200 && addTotp.json.ok === true, 'POST /field saves a totp seed')
assert(addTotp.json.record.fields.find((f) => f.key === 'totp').value === '********',
  'the totp seed comes back masked, like every other secret')

const totpOk = await call('/totp', { method: 'POST', body: { id: totpRecord.id, key: 'totp' } })
assert(totpOk.status === 200 && totpOk.json.ok === true, 'POST /totp returns a code')
assert(/^[0-9]{6}$/.test(totpOk.json.totp.code), 'the code is six digits')
assert(totpOk.json.totp.remaining > 0 && totpOk.json.totp.remaining <= 30, 'the code comes with a countdown')
assert((totpOk.headers.get('cache-control') ?? '') === 'no-store', 'the totp response is never cached')
assert(!totpOk.text.includes(SEED), 'the totp response never echoes the seed')

const totpBadField = await call('/totp', { method: 'POST', body: { id: totpRecord.id, key: 'password' } })
assert(totpBadField.status === 400, 'a non-TOTP field is refused with 400')
const totpBadRecord = await call('/totp', { method: 'POST', body: { id: 'rec_nope', key: 'totp' } })
assert(totpBadRecord.status === 404, 'an unknown record is 404')

// ── 7. 掩码不会被写成新密码（端到端）───────────────────────────────────
const beforeMask = await call('/reveal', { method: 'POST', body: { id: totpRecord.id, key: 'totp' } })
await call('/field', { method: 'POST', body: { id: totpRecord.id, key: 'totp', value: '********' } })
const afterMask = await call('/reveal', { method: 'POST', body: { id: totpRecord.id, key: 'totp' } })
assert(afterMask.json.value === beforeMask.json.value,
  'submitting the mask back over HTTP keeps the real value (end to end)')

// ── 8. 坏 JSON 与超限 ──────────────────────────────────────────────────
const badJson = await fetch(base + '/record', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{ this is not json',
})
assert(badJson.status === 400, 'a malformed JSON body is 400, not 500')

// ── 9. 强口令生成 ──────────────────────────────────────────────────────
const pwd1 = await call('/password', { method: 'POST', body: {} })
assert(pwd1.status === 200 && pwd1.json.ok === true, 'POST /password returns a generated password')
assert(pwd1.json.generated.length === 20, 'the default length is 20')
assert(/[a-z]/.test(pwd1.json.generated.password) && /[A-Z]/.test(pwd1.json.generated.password)
  && /[0-9]/.test(pwd1.json.generated.password), 'the password always contains lower, upper and digit')
assert((pwd1.headers.get('cache-control') ?? '') === 'no-store', 'a generated password is never cached')
const pwd2 = await call('/password', { method: 'POST', body: {} })
assert(pwd1.json.generated.password !== pwd2.json.generated.password, 'two calls never return the same password')
const pwdShort = await call('/password', { method: 'POST', body: { length: 4 } })
assert(pwdShort.json.generated.length === 12, 'a too-short request is clamped up to 12')
const pwdLong = await call('/password', { method: 'POST', body: { length: 999 } })
assert(pwdLong.json.generated.length === 128, 'a too-long request is clamped down to 128')
const pwdNoSym = await call('/password', { method: 'POST', body: { symbols: false, length: 40 } })
assert(!/[!#$%&*+\-=?@^_]/.test(pwdNoSym.json.generated.password), 'symbols:false really removes every symbol')
assert(pwd1.json.generated.entropyBits > 80, 'the reported entropy is high enough to be meaningful')
// ── 10. 批量换密已随健康审计一起删除 ──────────────────────────────────
/*
 * /rotate 的唯一用途是「审计发现一组复用密码 → 一键换成互不相同的强口令」。
 * 审计按用户要求删掉之后，这条路由就没有入口了；留着它等于留一个「一次改写
 * 最多 50 条记录密码」的口子，而页面上没有任何东西能触发它。
 * 所以这里反过来断言它**不存在**，防止将来有人照着旧文档把它加回来。
 */
const rotGone = await call('/rotate', { method: 'POST', body: { ids: ['x'] } })
assert(rotGone.status === 404, 'POST /rotate is gone with the health audit it served')
// ── 云端同步路由（/sync 系列）───────────────────────────────────────────
/* 这一组路由是**唯一会主动向插件外部发请求**的地方，所以除了「通不通」，还要
 * 验三件在真实使用里会出事的东西：
 *   1. 响应里绝不能出现令牌 / 口令明文（它是页面能拿到的东西）；
 *   2. 地址解析失败要回 400（用户输入问题），而不是 500（看起来像插件坏了）；
 *   3. 同步失败要以 200 + run.status='error' 回，页面才拿得到中文原因。 */
const emptySync = await call('/sync')
assert(emptySync.status === 200 && emptySync.json.ok === true, 'GET /sync answers ok')
assert(emptySync.json.sync.needsSetup === true, 'a fresh install reports needsSetup=true (so the UI can prompt)')
assert((emptySync.headers.get('cache-control') ?? '') === 'no-store', 'the sync status is never cached')

const SYNC_TOKEN = 'ghp_' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8'
const SYNC_PASS = ['route', 'smoke', 'B2'].join('-')
const savedSync = await call('/sync', {
  method: 'POST',
  body: { repo: 'https://github.com/kr-route-test/vault-db', token: SYNC_TOKEN, passphrase: SYNC_PASS },
})
assert(savedSync.status === 200 && savedSync.json.ok === true, 'POST /sync saves the settings')
assert(savedSync.json.sync.repo === 'kr-route-test/vault-db', 'the repo is normalized to owner/repo')
assert(savedSync.json.sync.needsSetup === false, 'fully configured => needsSetup=false')
const syncText = JSON.stringify(savedSync.json)
assert(!syncText.includes(SYNC_TOKEN), 'the save response never carries the token')
assert(!syncText.includes(SYNC_PASS), 'the save response never carries the passphrase')
assert(savedSync.json.sync.tokenTail === SYNC_TOKEN.slice(-4), 'only the token tail is exposed')

const badRepo = await call('/sync', { method: 'POST', body: { repo: 'https://gitlab.com/a/b' } })
assert(badRepo.status === 400 && badRepo.json.ok === false, 'a non-github repo is refused with 400 (user input, not a server bug)')
assert(typeof badRepo.json.error === 'string' && badRepo.json.error.includes('GitHub'), 'the 400 carries a readable reason')

const badPass = await call('/sync', { method: 'POST', body: { passphrase: 'short' } })
assert(badPass.status === 400, 'a too-short passphrase is refused with 400')

/* 同步到不可达的仓库：请求本身成功（200），失败写在 run 里。
 * 这样页面能显示 host 给的中文原因，而不必解析 5xx 的响应体。 */
const failedRun = await call('/sync-now', { method: 'POST', body: {} })
assert(failedRun.status === 200 && failedRun.json.ok === true, '/sync-now answers 200 even when the sync fails')
assert(failedRun.json.run.status === 'error', 'the failed run is reported in run.status')
assert(typeof failedRun.json.run.error === 'string' && failedRun.json.run.error.length > 0, 'the failed run carries a reason')
assert((failedRun.headers.get('cache-control') ?? '') === 'no-store', 'the sync result is never cached')
const afterFailed = await call('/sync')
assert(afterFailed.json.sync.lastStatus === 'error', 'the failure is persisted for the next page load')

const badVerify = await call('/sync-verify', { method: 'POST', body: {} })
assert(badVerify.status === 400 && badVerify.json.ok === false, '/sync-verify reports an unreachable repo as 400')

/*
 * 清除令牌：存着的令牌必须消失。
 *
 * ⚠ 这里**不能断言 tokenSource==='none'**：清掉用户填的令牌后，引擎会按设计
 * 回退到本机 gh 登录态（这台机器装了 gh 且已登录，所以会变成 'gh'）。那正是
 * 「少一步配置」的预期行为，不是 bug——写死 'none' 的断言在开发机上必挂，
 * 在没装 gh 的 CI 上才会过，属于那种"换台机器就翻"的假测试。
 * 要验的是「存的那一份没了」，所以断言 tokenSource 不再是 'stored'。
 */
const cleared = await call('/sync', { method: 'POST', body: { token: '' } })
assert(cleared.status === 200, 'clearing the token succeeds')
assert(cleared.json.sync.tokenSource !== 'stored', 'the stored token is really gone (falls back to gh or none)')

// 没有 sync 实例时（降级环境：cipher 不可用）必须 503 而不是崩。
const degradedHandler = (() => {
  let captured = null
  mountVaultRoutes({
    webServer: { register: (route) => { captured = route.handler; return () => { captured = null } } },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
  }, store, config, null)
  return captured
})()
const degraded = await new Promise((ok) => {
  const server2 = createServer((req, res) => degradedHandler(req, res))
  server2.listen(0, '127.0.0.1', () => {
    fetch('http://127.0.0.1:' + String(server2.address().port) + '/api/dsh-vault/sync')
      .then(async (response) => ok({ status: response.status, json: await response.json() }))
      .catch(() => ok({ status: 0, json: null }))
      .finally(() => server2.close())
  })
})
assert(degraded.status === 503, 'without a sync engine the route answers 503 (not a crash)')
assert(degraded.json !== null && degraded.json.ok === false, 'the 503 body is a normal { ok:false, error }')

// ── 收尾 ────────────────────────────────────────────────────────────────
await store.flush()
await new Promise((ok) => server.close(ok))
try { rmSync(SMOKE_HOME, { recursive: true, force: true }) } catch { /* 忽略 */ }
try { rmSync(OUT_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }

if (process.exitCode !== undefined && process.exitCode !== 0) {
  console.error('\ndsh-vault http test FAILED')
} else {
  console.log('\ndsh-vault http test passed')
}
