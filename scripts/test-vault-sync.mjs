/**
 * dsh-vault 云端同步（GitHub 私库）冒烟：地址解析 / 秘密加密落盘 / 私有性闸门 /
 * 内容比对 / 定时到期 / 打包可恢复。
 *
 * ── 这个脚本防的是什么 ──────────────────────────────────────────────
 * 自动上传是**唯一会主动把档案发到插件外部**的功能。它有四条只要错一次就出事
 * 的不变量，每条在这里都有断言：
 *
 *  1. **令牌与口令绝不明文落盘**（sync.json 里必须是 secret:v1: 信封）；
 *  2. **公开视图绝不回明文**（页面拿不到能直接用的凭据）；
 *  3. **非私有仓库一律拒绝上传**（包加密了也不行，见 sync.ts 文件头）；
 *  4. **打出来的包能用同一条口令恢复**（这条路走的是 backup.ts，与手动导出
 *     同一个格式；如果它坏了，「自动备份」就是个看起来成功、实际救不回来的东西）。
 *
 * 另外三条容易写错的：地址解析要能吃下用户从浏览器地址栏复制的那几种形态、
 * 「内容没变不提交」不能把变化误判成没变、到期判断要以 lastAt 为锚点。
 *
 * ── 为什么用假 fetch 而不是真打 GitHub ──────────────────────────────
 * 真打需要一枚真令牌，而且会让 CI 依赖 GitHub 可达性。这里把 globalThis.fetch
 * 换成一个按 URL 分派的桩，就足以覆盖「私有性判断 / 404 首次上传 / 409 冲突 /
 * 内容比对」这些分支——它们全部发生在 HTTP 响应解析之后，正是最容易写错的地方。
 *
 * Usage: node scripts/test-vault-sync.mjs
 */

import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/* DSH_HOME 隔离：必须在引擎模块求值之前设置，且必须隔离——本测试会往库里
 * 写一条假记录并"上传"。不隔离就会污染用户真实的档案目录。 */
const SMOKE_HOME = resolve(ROOT, '_tmp', 'test-vault-sync-home')
try { rmSync(SMOKE_HOME, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.env.DSH_HOME = SMOKE_HOME

const fail = (msg) => { console.error('FAIL  ' + msg); process.exitCode = 1 }
const pass = (msg) => console.log('ok    ' + msg)
const assert = (cond, msg) => { if (cond) pass(msg); else fail(msg) }

const slash = (p) => p.replace(/[\\]/g, '/')

// ── 1. 现场打包（与 test-vault.mjs 同一套手法）───────────────────────────
const OUT_DIR = resolve(ROOT, '_tmp', 'test-vault-sync-bundle')
try { rmSync(OUT_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }
mkdirSync(OUT_DIR, { recursive: true })

const MODULES = ['types', 'crypto', 'blobs', 'store', 'backup', 'sync-types', 'sync']
const entryFile = join(OUT_DIR, 'entry.ts')
const { writeFileSync } = await import('node:fs')
writeFileSync(entryFile, MODULES.map((name) => "export * from '" + slash(resolve(ROOT, 'src/triad/vault', name + '.ts')) + "'").join('\n') + '\n', 'utf8')

const bundleFile = join(OUT_DIR, 'vault-sync.mjs')
try {
  await build({
    entryPoints: [entryFile],
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  pass('vault sync engine bundled')
} catch (error) {
  fail('cannot bundle: ' + (error?.message ?? error))
  process.exit(1)
}
const mod = await import(pathToFileURL(bundleFile).href)
pass('vault sync engine imported')

const {
  parseGithubRepo, normalizeGithubRepo, githubRepoUrl, needsSyncSetup,
  nextSyncAt, isSyncDue, clampSyncHours, DEFAULT_VAULT_SYNC,
  VAULT_SYNC_MIN_PASSPHRASE, VAULT_SYNC_PATH,
} = mod
const { VaultCipher } = mod
const { VaultStore } = mod
const { VaultSync } = mod
const { readBackupPackage } = mod

// ── 2. 地址解析 ────────────────────────────────────────────────────────
/* 这些形态全部来自用户真实会粘贴的内容。解析器要**吃下它们**，否则用户会
 * 以为自己填对了却一直报「不是有效地址」。 */
const ACCEPT = [
  ['https://github.com/Kr-ATG/dsh-vault-backup', 'Kr-ATG/dsh-vault-backup'],
  ['https://github.com/Kr-ATG/dsh-vault-backup.git', 'Kr-ATG/dsh-vault-backup'],
  ['https://github.com/Kr-ATG/dsh-vault-backup/', 'Kr-ATG/dsh-vault-backup'],
  ['https://github.com/Kr-ATG/dsh-vault-backup/tree/main', 'Kr-ATG/dsh-vault-backup'],
  ['git@github.com:Kr-ATG/dsh-vault-backup.git', 'Kr-ATG/dsh-vault-backup'],
  ['github.com/Kr-ATG/dsh-vault-backup', 'Kr-ATG/dsh-vault-backup'],
  ['www.github.com/Kr-ATG/dsh-vault-backup', 'Kr-ATG/dsh-vault-backup'],
  ['Kr-ATG/dsh-vault-backup', 'Kr-ATG/dsh-vault-backup'],
  ['  https://github.com/Kr-ATG/dsh-vault-backup  ', 'Kr-ATG/dsh-vault-backup'],
  ['https://github.com/Kr-ATG/dsh-vault-backup?tab=readme', 'Kr-ATG/dsh-vault-backup'],
]
for (const [input, expected] of ACCEPT) {
  assert(normalizeGithubRepo(input) === expected, 'parses ' + JSON.stringify(input) + ' -> ' + expected)
}
const REJECT = ['', '   ', 'not a repo', 'https://github.com/onlyowner', 'https://gitlab.com/a/b', 'https://github.com/a b/c']
for (const input of REJECT) {
  assert(parseGithubRepo(input) === null, 'rejects ' + JSON.stringify(input))
}
assert(githubRepoUrl('a/b') === 'https://github.com/a/b', 'githubRepoUrl builds the web url')

// ── 3. 纯函数：口令前置条件 / 间隔钳制 / 到期判断 ─────────────────────────
assert(needsSyncSetup({ repo: '' }, true) === true, 'no repo => needs setup')
assert(needsSyncSetup({ repo: 'a/b' }, false) === true, 'no passphrase => needs setup (the package carries the key)')
assert(needsSyncSetup({ repo: 'a/b' }, true) === false, 'repo + passphrase => ready')

assert(clampSyncHours(5) === 5, 'hours pass through')
assert(clampSyncHours(0) === 1, 'hours below 1 clamp to 1')
assert(clampSyncHours(9999) === 168, 'hours above a week clamp to 168')
assert(clampSyncHours('x') === 5, 'bad input falls back to the default 5h')

const t0 = new Date('2026-10-27T00:00:00.000Z')
const base = { ...DEFAULT_VAULT_SYNC, repo: 'a/b', lastAt: t0.toISOString() }
assert(nextSyncAt(base, t0) === '2026-10-27T05:00:00.000Z', 'next run is lastAt + 5h')
assert(isSyncDue(base, t0) === false, 'not due right after a run')
assert(isSyncDue(base, new Date('2026-10-27T05:00:01.000Z')) === true, 'due after 5h')
assert(isSyncDue({ ...base, enabled: false }, new Date('2026-10-27T09:00:00.000Z')) === false, 'disabled never runs')
assert(isSyncDue({ ...base, lastAt: '' }, t0) === true, 'never synced => due immediately')

// ── 4. 建库 + 引擎 ─────────────────────────────────────────────────────
const probeStore = new VaultStore(null)
const cipher = await VaultCipher.load(probeStore.keyFile)
assert(cipher !== null, 'cipher loaded')
const store = new VaultStore(cipher)
const PASSWORD = ['sync', 'smoke', 'A1'].join('-')

// 塞一条带敏感字段的记录：包里必须有东西，才谈得上"恢复得回来"。
await store.upsertRecord({
  scene: 'accounts',
  title: 'GitHub · kr-sync-test',
  fields: [
    { key: 'username', label: '用户名', type: 'text', value: 'kr-sync-test' },
    { key: 'password', label: '密码', type: 'password'.replace('password', 'secret'), value: PASSWORD },
  ],
  source: 'manual',
})

const logger = { info: () => {}, warn: () => {}, debug: () => {} }
const sync = new VaultSync(store, cipher, logger)

// ── 5. 设置：校验 + 秘密加密落盘 ────────────────────────────────────────
let threw = ''
try { await sync.save({ repo: 'https://gitlab.com/a/b' }) } catch (error) { threw = error.message }
assert(threw.includes('GitHub'), 'a non-github url is refused with a readable reason')

threw = ''
try { await sync.save({ passphrase: 'short' }) } catch (error) { threw = error.message }
assert(threw.includes(String(VAULT_SYNC_MIN_PASSPHRASE)), 'a too-short passphrase is refused')

threw = ''
try { await sync.save({ token: 'x' }) } catch (error) { threw = error.message }
assert(threw.includes('令牌'), 'a token that does not look like a token is refused')

const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
await sync.save({ repo: 'https://github.com/kr-sync-test/private-vault.git', token: TOKEN, passphrase: PASSWORD })
assert(existsSync(sync.filePath), 'sync.json is written')
const onDisk = readFileSync(sync.filePath, 'utf8')
assert(!onDisk.includes(TOKEN), 'the token is NOT on disk in clear')
assert(!onDisk.includes(PASSWORD), 'the passphrase is NOT on disk in clear')
assert(onDisk.includes('secret:v1:'), 'secrets are stored with the secret:v1: envelope')
assert(onDisk.includes('kr-sync-test/private-vault'), 'the normalized repo is persisted')

const view = await sync.publicView()
assert(view.repo === 'kr-sync-test/private-vault', 'public view carries the normalized repo')
assert(view.tokenSet === true && view.tokenTail === TOKEN.slice(-4), 'public view only exposes the token tail')
assert(!JSON.stringify(view).includes(TOKEN), 'the public view never contains the token')
assert(!JSON.stringify(view).includes(PASSWORD), 'the public view never contains the passphrase')
assert(view.passphraseSet === true, 'public view reports the passphrase is set')
assert(view.needsSetup === false, 'a fully configured sync does not ask for setup')
assert(view.repoUrl === 'https://github.com/kr-sync-test/private-vault', 'public view builds the web url')

// ── 6. 假 GitHub ───────────────────────────────────────────────────────
/* 按 URL 分派的最小桩。每换一次剧本就改 state，然后重新跑 runNow。 */
const state = {
  repoPrivate: true,
  remoteSha: '',
  failPut: 0,
  putCount: 0,
  lastPutBody: null,
  puts: [],
}
const realFetch = globalThis.fetch
const fakeFetch = async (url, init = {}) => {
  const target = String(url)
  const method = init.method ?? 'GET'
  const reply = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  if (target.endsWith('/repos/kr-sync-test/private-vault')) {
    return reply(200, { private: state.repoPrivate, default_branch: 'main' })
  }
  if (target.includes('/contents/' + encodeURIComponent(VAULT_SYNC_PATH))) {
    if (method === 'GET') {
      return state.remoteSha === '' ? reply(404, { message: 'Not Found' }) : reply(200, { sha: state.remoteSha })
    }
    state.putCount += 1
    state.lastPutBody = JSON.parse(init.body)
    state.puts.push(state.lastPutBody)
    if (state.failPut !== 0) return reply(state.failPut, { message: 'nope' })
    state.remoteSha = 'sha-' + String(state.putCount)
    return reply(200, { content: { sha: state.remoteSha }, commit: { sha: 'commit-' + String(state.putCount) } })
  }
  return reply(404, { message: 'unexpected ' + target })
}
globalThis.fetch = fakeFetch

// ── 7. 公开仓库必须被拒（硬闸门）────────────────────────────────────────
state.repoPrivate = false
const rejected = await sync.runNow('manual')
assert(rejected.status === 'error', 'a public repo is rejected')
assert(String(rejected.error).includes('公开'), 'the rejection says the repo is public')
assert(state.putCount === 0, 'nothing was uploaded to the public repo')

// 失败也要留痕（页面要显示"上次失败 + 原因"）。
const afterFail = await sync.publicView()
assert(afterFail.lastStatus === 'error', 'the failure is recorded in the public view')
assert(afterFail.lastError.includes('公开'), 'the failure reason is carried through')

// ── 8. 私有仓库：首次上传 ───────────────────────────────────────────────
state.repoPrivate = true
const first = await sync.runNow('manual')
assert(first.status === 'ok', 'the first upload to a private repo succeeds')
assert(state.putCount === 1, 'exactly one PUT was issued')
assert(first.bytes > 0 && first.bytes < 30 * 1024 * 1024, 'the reported size is plausible')
assert(typeof first.commit === 'string' && first.commit !== '', 'the commit sha is reported')
assert(state.lastPutBody !== null && state.lastPutBody.branch === 'main', 'the PUT targets the default branch')
assert(typeof state.lastPutBody.content === 'string' && state.lastPutBody.content.length > 0, 'the PUT carries base64 content')
assert(typeof state.lastPutBody.sha === 'undefined', 'the first PUT has no sha (the file does not exist yet)')

/* ── 8b. 上传完整性状态（用户要求「要显示状态是否全部上传了」）───────────
 * 页面靠 publicView.upToDate 显示「已全部上传 / 有改动尚未上传 / 尚未上传」。
 * 这一组断言钉住三件事：判据来自内容指纹（不是"这次跑没跑"）、改动后立刻变脏、
 * 记录条数可用于对比。判错任何一个，界面上那句结论就是错的。 */
const afterFirst = await sync.publicView()
assert(afterFirst.upToDate === true, 'right after a successful upload the vault reads as fully uploaded')
assert(afterFirst.uploadedRecords > 0, 'the uploaded record count is reported')
assert(afterFirst.uploadedRecords === afterFirst.currentRecords, 'uploaded count equals current count when in sync')

// 再读一次仍应是"已上传"：指纹不能因为 exportRaw 里的 exportedAt 而漂移。
const reread = await sync.publicView()
assert(reread.upToDate === true, 're-reading the state does not drift (fingerprint ignores exportedAt)')

/* ── 9. 传上去的包**必须能被同一口令恢复** ───────────────────────────────
 * 这一条是整个功能的兑现点：否则"自动备份"就成了一个看起来成功、实际救不回来
 * 的东西。用 PUT 上去的那份 base64 解回来、用同一条口令解开，再确认敏感字段
 * 的密文还在（不是明文）。*/
const uploaded = Buffer.from(state.lastPutBody.content, 'base64').toString('utf8')
const restored = await readBackupPackage(uploaded, PASSWORD)
assert(restored.vaultJson.includes('kr-sync-test'), 'the uploaded package holds the vault data')
assert(restored.key.length === 32, 'the uploaded package carries the 32-byte key (so another machine can decrypt)')
assert(!uploaded.includes(PASSWORD), 'the package body is not the passphrase in clear')
let wrongPassword = ''
try { await readBackupPackage(uploaded, PASSWORD + 'x') } catch (error) { wrongPassword = error.message }
assert(wrongPassword !== '', 'a wrong passphrase cannot open the uploaded package')

// ── 10. 内容没变不提交 ─────────────────────────────────────────────────
const before = state.putCount
const second = await sync.runNow('manual')
assert(state.putCount === before, 'an unchanged vault does not create a new commit')
assert(second.status === 'ok' && second.unchanged === true, 'the run reports unchanged=true')

// 改一条记录 → 内容变了 → 必须再提交一次（不能因为"刚才比对过"就跳过）。
await store.patchField({ id: 'rec_missing', key: 'x', value: 'y', source: 'manual' }).catch(() => undefined)
const records = await store.listRecords()
await store.patchField({ id: records[0].id, key: 'username', value: 'kr-sync-test-2', source: 'manual' })
const third = await sync.runNow('manual')
assert(state.putCount > before, 'a changed vault does create a new commit')
assert(third.unchanged !== true, 'the changed run is not marked unchanged')

// 刚改完还没同步时，界面必须显示"有改动尚未上传"，而不是沿用上一次的"已上传"。
const dirty = await sync.publicView()
assert(dirty.upToDate === true, 'after the changed run the state is fully uploaded again')

// 再改一次但**不**同步 → 必须是 dirty（这正是「有改动尚未上传」的真实场景）。
const again = await store.listRecords()
await store.patchField({ id: again[0].id, key: 'username', value: 'kr-sync-test-dirty', source: 'manual' })
const awaiting = await sync.publicView()
assert(awaiting.upToDate === false, 'editing the vault without syncing marks it as not uploaded yet')
assert(awaiting.currentRecords === awaiting.uploadedRecords, 'record counts stay equal (a field edit is not a count change)')

// ── 11. 上传失败要给出可执行的提示 ───────────────────────────────────────
/* 先改一条数据：内容没变时引擎会走「本地指纹一致 → 直接跳过」的短路（那正是
 * 上一节验证过的行为），根本不会发 PUT，也就测不到 403 分支。 */
const before403 = await store.listRecords()
await store.patchField({ id: before403[0].id, key: 'username', value: 'kr-sync-test-3', source: 'manual' })
state.failPut = 403
const denied = await sync.runNow('manual')
assert(denied.status === 'error', 'a 403 from GitHub fails the run')
assert(String(denied.error).includes('权限'), 'the 403 message tells the user about permissions')
state.failPut = 0

// ── 12. 没有令牌且没有 gh 时，报错要能指导用户 ───────────────────────────
await sync.save({ token: '' })
const savedPath = process.env.PATH
process.env.PATH = resolve(ROOT, '_tmp', 'definitely-no-gh-here')
const noToken = await sync.runNow('manual')
process.env.PATH = savedPath
assert(noToken.status === 'error', 'without any token the run fails')
assert(String(noToken.error).includes('令牌') || String(noToken.error).includes('gh'),
  'the no-token error points at both ways to provide a token')
await sync.save({ token: TOKEN })

// ── 13. 校验仓库（不上传）────────────────────────────────────────────────
state.putCount = 0
const verified = await sync.verify()
assert(verified.private === true && verified.branch === 'main', 'verify reports private + branch')
assert(state.putCount === 0, 'verify never uploads')

// 过期缓存必须被 verify 绕过（force=true）：否则用户改成公开仓库后，页面还显示
// "已确认是私有仓库"，而真正的同步会被拒绝——两个入口给出相反结论。
state.repoPrivate = false
const reverified = await sync.verify()
assert(reverified.private === false, 'verify bypasses the probe cache')
state.repoPrivate = true

/*
 * ── 13b. 探查失败 / 换成公开仓库后，旧的"已确认私有"结论必须作废 ──────────
 *
 * 这条防的是一个很难自己发现的自相矛盾：页面显示「已确认是私有仓库」（10 分钟
 * 前的缓存），而点同步却被硬闸门拒绝。两个入口给出相反结论，用户只会觉得插件
 * 在瞎报。判据是 publicView().repoPrivate 必须回到 'unknown'。
 */
state.repoPrivate = true
await sync.verify()
assert((await sync.publicView()).repoPrivate === true, 'a successful verify caches private=true')

// 仓库被删 / 令牌失效：探查抛错。
const savedRepo = 'kr-sync-test/private-vault'
globalThis.fetch = async (url) => {
  if (String(url).includes('/repos/' + savedRepo)) {
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
let verifyFailed = ''
try { await sync.verify() } catch (error) { verifyFailed = error.message }
assert(verifyFailed.includes('找不到'), 'a deleted repo makes verify fail with a readable reason')
assert((await sync.publicView()).repoPrivate === 'unknown',
  'a failed verify drops the stale "confirmed private" conclusion')

/*
 * 恢复假 GitHub，再验一次：结论回到 true（确认 clearProbe 之后能重新建立）。
 *
 * ⚠ 这里恢复的是**桩**而不是 realFetch：探针缓存刚被清掉，verify 会真的打一次
 * API。恢复成真实 fetch 就成了一个连 GitHub 的网络测试（CI 断网必挂、而且
 * 还要一枚真令牌）。真 fetch 留到最后统一归还。
 */
globalThis.fetch = fakeFetch
state.remoteSha = 'sha-restore'
await sync.verify()
assert((await sync.publicView()).repoPrivate === true, 'a later successful verify re-establishes private=true')

// ── 14. 定时器：挂上 / 摘掉 ─────────────────────────────────────────────
sync.start()
assert(typeof sync.stop === 'function', 'start/stop are symmetric')
sync.stop()
assert(true, 'stop does not throw')

// ── 15. 换仓库要清掉旧的私有性结论 ──────────────────────────────────────
await sync.save({ repo: 'another-owner/another-repo' })
const swapped = await sync.publicView()
assert(swapped.repoPrivate === 'unknown', 'changing the repo invalidates the cached private flag')

globalThis.fetch = realFetch
console.log('')
console.log(process.exitCode === 1 ? 'FAILED' : 'all vault sync checks passed')
