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
const VaultStore = storeModule.VaultStore
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
mountVaultRoutes(fakeCtx, store, config)
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

// ── 3. 健康审计 ─────────────────────────────────────────────────────────
const health0 = await call('/health')
assert(health0.status === 200 && health0.json.ok === true, 'GET /health answers ok')
assert(health0.json.report.score === 100, 'an empty vault scores 100')

await call('/record', { method: 'POST', body: {
  scene: 'accounts', title: '路由测试 · 弱口令',
  fields: [{ key: 'password', label: '密码', type: 'secret', value: '123456' }],
} })
const health1 = await call('/health')
assert(health1.json.report.issues.some((i) => i.kind === 'weak-password'),
  'GET /health flags the weak password that was just saved')
assert(!health1.text.includes('123456'), 'the health response never carries the password itself')

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
// ── 10. 批量换密：审计 → 一键修的闭环 ──────────────────────────────────
const mk = async (title, pw) => {
  const r = await call('/record', { method: 'POST', body: { scene: 'accounts', title, fields: [{ key: 'password', label: '密码', type: 'secret', value: pw }] } })
  return r.json.record.id
}
const rotateA = await mk('复用站点 A', 'same-password-123')
const rotateB = await mk('复用站点 B', 'same-password-123')
const rot = await call('/rotate', { method: 'POST', body: { ids: [rotateA, rotateB] } })
assert(rot.status === 200 && rot.json.ok === true, 'POST /rotate succeeds')
assert(rot.json.rotated.length === 2, 'both records were rotated')
assert(rot.json.rotated[0].password !== rot.json.rotated[1].password, 'each record gets its OWN new password')
assert(rot.json.rotated.every((item) => item.password !== 'same-password-123'), 'the reused password is really gone')
assert((rot.headers.get('cache-control') ?? '') === 'no-store', 'the rotated passwords are never cached')
assert(rot.json.rotated.every((item) => item.password.length >= 12), 'rotated passwords are long enough')
/*
 * 换完之后健康报告里那条复用问题必须消失 —— 这是整条闭环唯一的验收标准。
 */
const healthAfterRotate = await call('/health')
const stillReused = healthAfterRotate.json.report.issues.filter((i) => i.kind === 'reused-password')
assert(stillReused.length === 0, 'the reuse issue disappears from the health report after rotating')
const rotatedStay = await call('/reveal', { method: 'POST', body: { id: rotateA, key: 'password' } })
assert(rotatedStay.json.value === rot.json.rotated.find((i) => i.id === rotateA).password, 'the rotated password is the one actually stored')
const noIds = await call('/rotate', { method: 'POST', body: {} })
assert(noIds.status === 400, 'rotate without ids is refused')
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
