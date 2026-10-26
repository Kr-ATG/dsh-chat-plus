/**
 * dsh-vault 冒烟：档案引擎（加密 / 掩码 / 注入不泄漏 / 图片去重 / 配额 / 场景守卫）。
 *
 * ── 这个脚本防的是什么 ──────────────────────────────────────────────
 * 档案模块装的是**用户真实密码**。它有四条只要破坏一次就不可逆的不变量，
 * 每一条在这里都有一条断言：
 *
 *  1. 敏感值落盘必须是密文（明文躺盘 = 任何备份/同步都等于泄露）；
 *  2. 敏感值绝不能出现在注入文本里（注入内容会发给模型厂商）；
 *  3. 列表响应里敏感值是掩码（明文不整库进浏览器内存）；
 *  4. 提交回来的掩码不能被当成新密码写进去（一次保存就把密码写成星号）。
 *
 * 另外断言三件容易写错的地方：内容寻址去重与引用计数、配额淘汰不删记录文本、
 * 内置场景不可删。
 *
 * ── 为什么用 esbuild 现场打包 ────────────────────────────────────────
 * 源码是 .ts、`lib/index.js` 是整插件单文件，两者都不能按模块 import。这里用
 * esbuild（本仓库 devDependency，构建脚本本来就用它）把 vault 引擎打成一个
 * 临时 ESM 包再 import。这样断言的是**真正会跑的那份源码**，不是复制品。
 *
 * Usage: node scripts/test-vault.mjs
 */

import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/*
 * DSH_HOME 隔离：必须在引擎模块求值之前设置（store 的根目录是调用时读环境变量）。
 * 不隔离的话，本脚本会往**用户真实的** ~/.dsh/memories/dsh-chat-vault/ 写测试
 * 记录（含假密码与假证件号）。隔离到工作区 _tmp/ 之后随便写，跑完删掉。
 */
const SMOKE_HOME = resolve(ROOT, '_tmp', 'test-vault-dsh-home')
try { rmSync(SMOKE_HOME, { recursive: true, force: true }) } catch { /* 被占用就覆盖写 */ }
process.env.DSH_HOME = SMOKE_HOME

const fail = (msg) => { console.error('FAIL  ' + msg); process.exitCode = 1 }
const pass = (msg) => console.log('ok    ' + msg)
const assert = (cond, msg) => { if (cond) pass(msg); else fail(msg) }

/** Windows 路径 → import URL 可用的正斜杠形式。 */
const slash = (p) => p.replace(/[\\]/g, '/')

// ── 1. 现场打包 vault 引擎 ───────────────────────────────────────────────
const OUT_DIR = resolve(ROOT, '_tmp', 'test-vault-bundle')
try { rmSync(OUT_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }
mkdirSync(OUT_DIR, { recursive: true })

const sources = ['types', 'crypto', 'blobs', 'store', 'inject', 'health', 'totp', 'backup']
  .map((name) => "export * from '" + slash(resolve(ROOT, 'src/triad/vault', name + '.ts')) + "'")
  .join('\n')
const entryFile = join(OUT_DIR, 'entry.ts')
writeFileSync(entryFile, sources + '\n', 'utf8')

const bundleFile = join(OUT_DIR, 'vault.mjs')
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
  pass('vault engine bundled')
} catch (error) {
  fail('cannot bundle vault engine: ' + (error?.message ?? error))
  process.exit(1)
}

let vault
try {
  vault = await import(pathToFileURL(bundleFile).href)
  pass('vault engine imported')
} catch (error) {
  fail('cannot import bundled vault engine: ' + (error?.stack ?? error))
  process.exit(1)
}

const {
  VaultCipher, VaultStore, VaultInjector, findLeakedSecrets, isEncryptedValue, VAULT_MASK,
  DEFAULT_VAULT_CONFIG, auditVault, isWeakPassword,
  parseTotpSecret, generateTotp, looksLikeTotpField,
  createBackupPackage, readBackupPackage, keyFingerprint,
} = vault

// ── 2. 建库（隔离目录 + 真密钥）─────────────────────────────────────────
const probe = new VaultStore(null)
const cipher = await VaultCipher.load(probe.keyFile)
assert(cipher !== null, 'cipher loaded (key file created)')
const store = new VaultStore(cipher)

const SECRET = ['vault', 'smoke', 'A1', 'pw'].join('-')
const DOC_NUMBER = '110101199001011234'
const created = await store.upsertRecord({
  scene: 'accounts',
  title: 'GitHub · Kr-ATG',
  subtitle: '开发账号',
  fields: [
    { key: 'username', label: '用户名', type: 'text', value: 'Kr-ATG', updatedAt: new Date().toISOString() },
    { key: 'password', label: '密码', type: 'secret', value: SECRET, updatedAt: new Date().toISOString() },
    { key: 'email', label: '绑定邮箱', type: 'email', value: 'kr@example.com', updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
assert(created.id.startsWith('rec_'), 'record created with rec_ id')
assert(SECRET.length >= 8, 'smoke credential is long enough for the leak assertions to be meaningful')
assert(created.fields[1].value === VAULT_MASK, 'list/return path masks the secret')

// ── 3. 不变量①：磁盘上是密文 ────────────────────────────────────────────
const rawDisk = readFileSync(join(SMOKE_HOME, 'memories', 'dsh-chat-vault', 'vault.json'), 'utf8')
assert(!rawDisk.includes(SECRET), 'secret plaintext is NOT on disk')
assert(rawDisk.includes('secret:v1:'), 'secret is stored with the secret:v1: envelope')

// ── 4. 不变量②：注入文本不含任何敏感明文 ────────────────────────────────
const injector = new VaultInjector(store, { ...DEFAULT_VAULT_CONFIG }, undefined)
const revealed = await store.listRecordsRevealed()
const scenes = await store.listScenes()
const injectionText = injector.buildInjectionText(revealed, scenes)
assert(injectionText.includes('GitHub'), 'injection text lists the record title')
assert(injectionText.includes('已加密'), 'injection text marks encrypted fields')
assert(injectionText.includes('Kr-ATG'), 'injection text may carry non-sensitive values')
assert(!injectionText.includes(SECRET), 'injection text does NOT contain the secret value')
assert(findLeakedSecrets(injectionText, revealed).length === 0, 'findLeakedSecrets() reports zero leaks')
// 敏感字段连长度都不该泄露：值只有掩码与「已加密」两种呈现
assert(!injectionText.includes(String(SECRET.length)), 'injection text does not leak the secret length')

// ── 5. 不变量④：掩码回写不覆盖真实密码 ──────────────────────────────────
await store.upsertRecord({
  id: created.id,
  scene: 'accounts',
  title: 'GitHub · Kr-ATG',
  subtitle: '开发账号',
  fields: created.fields.map((field) => ({ ...field })),
  source: 'manual',
})
const afterMaskRoundTrip = await store.getRecordRevealed(created.id)
assert(afterMaskRoundTrip.fields.find((f) => f.key === 'password').value === SECRET,
  'submitting the mask back keeps the real secret (no stars written over it)')

// patchField 单字段路径同样不受掩码影响
await store.patchField({ id: created.id, key: 'password', value: VAULT_MASK, source: 'manual' })
const afterPatchMask = await store.getRecordRevealed(created.id)
assert(afterPatchMask.fields.find((f) => f.key === 'password').value === SECRET,
  'patchField with a masked value is a no-op')

// 真实改密码要能生效，并且历史里不留明文
const NEW_SECRET = ['vault', 'smoke', 'B2', 'pw'].join('-')
await store.patchField({ id: created.id, key: 'password', value: NEW_SECRET, source: 'extract' })
const afterRotate = await store.getRecordRevealed(created.id)
assert(afterRotate.fields.find((f) => f.key === 'password').value === NEW_SECRET,
  'a real secret change is applied')
const historyRaw = readFileSync(join(SMOKE_HOME, 'memories', 'dsh-chat-vault', 'vault.json'), 'utf8')
assert(!historyRaw.includes(SECRET) && !historyRaw.includes(NEW_SECRET),
  'change history keeps no plaintext of either secret')
assert(historyRaw.includes('（已加密）'), 'change history records the redacted marker instead')

// ── 6. 证件：photoFirst 场景 + 敏感号码 ─────────────────────────────────
const doc = await store.upsertRecord({
  scene: 'document',
  title: '身份证 · 张三',
  fields: [
    { key: 'number', label: '证件号码', type: 'text', sensitive: true, value: DOC_NUMBER, updatedAt: new Date().toISOString() },
    { key: 'name', label: '姓名', type: 'text', value: '张三', updatedAt: new Date().toISOString() },
    { key: 'expiry', label: '有效期至', type: 'date', value: '2031-05-20', updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
const docRaw = readFileSync(join(SMOKE_HOME, 'memories', 'dsh-chat-vault', 'vault.json'), 'utf8')
assert(!docRaw.includes(DOC_NUMBER), 'ID number is encrypted at rest even though type is text')
const docRevealed = await store.getRecordRevealed(doc.id)
const docInjection = injector.buildInjectionText(await store.listRecordsRevealed(), await store.listScenes())
assert(!docInjection.includes(DOC_NUMBER), 'ID number never reaches the injection text')
assert(docInjection.indexOf('身份证') < docInjection.indexOf('GitHub'),
  'records with a date field are ranked first (expiry drives action)')

// ── 7. 图片：内容寻址去重 + 引用计数 ────────────────────────────────────
// 造一张最小合法 PNG（1×1），两张照片用同一份字节 → 只该落一份文件。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)
const photoVariants = [{ variant: 'display', data: PNG, width: 1, height: 1 }]
const withPhoto = await store.attachPhoto({ recordId: created.id, role: 'front', label: '截图', variants: photoVariants })
assert(withPhoto !== null && withPhoto.photos.length === 1, 'photo attached to the record')
const second = await store.attachPhoto({ recordId: doc.id, role: 'front', label: '身份证正面', variants: photoVariants })
assert(second !== null && second.photos.length === 1, 'second record got the photo too')
const blobStats = await store.blobs.stats()
assert(blobStats.count === 1, 'identical bytes are stored once (content-addressed dedupe)')
const blobSnapshot = await store.blobs.snapshot()
assert(blobSnapshot[0].refs.length === 2, 'both photos are registered as references to the same blob')

// 删掉一张照片：字节必须还在（另一条记录还在引用）
const docPhotoId = second.photos[0].id
await store.removePhoto(doc.id, docPhotoId)
assert(await store.blobs.has(blobSnapshot[0].sha256), 'blob survives while another photo references it')
const afterRemoveAll = await store.removePhoto(created.id, withPhoto.photos[0].id)
assert(afterRemoveAll !== undefined, 'removing the last photo succeeds')
assert((await store.blobs.stats()).count === 0, 'blob file is dropped once the last reference is gone')

// ── 8. 配额淘汰：只删图片，不删记录文本 ──────────────────────────────────
// 造两张不同的图（改一个字节即可改变 sha），把配额设到极小逼它淘汰。
const PNG2 = Buffer.from(PNG)
PNG2[PNG2.length - 1] = PNG2[PNG2.length - 1] ^ 0x01
await store.attachPhoto({ recordId: created.id, role: 'extra', label: 'A', variants: [{ variant: 'display', data: PNG, width: 1, height: 1 }] })
await store.attachPhoto({ recordId: created.id, role: 'extra', label: 'B', variants: [{ variant: 'display', data: PNG2, width: 1, height: 1 }] })
const beforeQuota = (await store.stats())
assert(beforeQuota.photos === 2, 'two photos present before quota enforcement')
const quota = await store.enforceQuota(1)
assert(quota.evicted > 0, 'quota enforcement evicted image variants')
const afterQuotaRecords = await store.listRecords()
assert(afterQuotaRecords.length === 2, 'quota eviction NEVER deletes records')
assert(afterQuotaRecords.every((r) => r.fields.length > 0), 'quota eviction NEVER deletes record fields')

// ── 9. 场景守卫：内置不可删、有记录不可删、自定义可增删 ─────────────────
const builtinRemove = await store.removeScene('accounts')
assert(builtinRemove.ok === false, 'builtin scene cannot be deleted')
const custom = await store.upsertScene({
  id: 'wifi',
  label: '家里 Wi-Fi',
  desc: '路由器与访客网络',
  order: 200,
  builtin: false,
  fieldTemplate: [],
})
assert(custom.some((scene) => scene.id === 'wifi'), 'custom scene created')
await store.upsertRecord({
  scene: 'wifi',
  title: '主路由',
  fields: [{ key: 'password', label: '密码', type: 'secret', value: 'wifi-pass-1234', updatedAt: new Date().toISOString() }],
  source: 'manual',
})
const busyRemove = await store.removeScene('wifi')
assert(busyRemove.ok === false, 'a scene holding records cannot be deleted')

// 场景改名不动记录（记录只引用 id）
await store.upsertScene({ id: 'accounts', label: '网站账号', desc: '改过的描述', order: 10, builtin: true, fieldTemplate: [] })
const renamedScenes = await store.listScenes()
assert(renamedScenes.find((s) => s.id === 'accounts').label === '网站账号', 'builtin scene can be renamed')
const stillThere = await store.getRecord(created.id)
assert(stillThere.scene === 'accounts', 'renaming a scene does not touch its records')

// ── 10. 导出保持密文；导入幂等 ──────────────────────────────────────────
const exported = await store.exportRaw()
assert(!exported.includes(NEW_SECRET), 'export keeps secrets encrypted')
assert(exported.includes('secret:v1:'), 'export carries the ciphertext envelope')
const parsedExport = JSON.parse(exported)
const beforeImport = (await store.listRecords({ includeArchived: true })).length
await store.replaceAll({ records: parsedExport.records, scenes: parsedExport.scenes })
const afterImport = (await store.listRecords({ includeArchived: true })).length
assert(beforeImport === afterImport, 're-importing the same backup does not duplicate records')
const afterImportRevealed = await store.listRecordsRevealed()
const importedSecret = afterImportRevealed
  .find((r) => r.id === created.id).fields.find((f) => f.key === 'password').value
assert(importedSecret === NEW_SECRET, 'imported ciphertext still decrypts with the same key')

// ── 11. 注入预算与条数上限 ──────────────────────────────────────────────
const tinyInjector = new VaultInjector(store, { ...DEFAULT_VAULT_CONFIG, injectMaxRecords: 1, injectBudget: 500 }, undefined)
const tinyText = tinyInjector.buildInjectionText(await store.listRecordsRevealed(), await store.listScenes())
const lineCount = tinyText.split('\n').filter((line) => line.startsWith('- ')).length
assert(lineCount <= 1, 'injectMaxRecords caps how many records are listed')
assert(tinyText.includes('另有'), 'the text tells the model more records exist')

const zeroBudgetInjector = new VaultInjector(store, { ...DEFAULT_VAULT_CONFIG, injectBudget: 200 }, undefined)
const zeroText = zeroBudgetInjector.buildInjectionText(await store.listRecordsRevealed(), await store.listScenes())
assert(zeroText.length <= 400 || zeroText === '', 'a tiny budget still yields a bounded text')

// ── 12. 审计留痕 ───────────────────────────────────────────────────────
await store.appendAudit({ recordId: created.id, fieldKey: 'password', via: 'panel' })
const audit = await store.readAudit(10)
assert(audit.length === 1 && audit[0].fieldKey === 'password', 'reveal writes an audit line')
assert(!JSON.stringify(audit).includes(NEW_SECRET), 'audit lines never carry the value')


// ── 13. 健康审计 ────────────────────────────────────────────────────────
const weak = await store.upsertRecord({
  scene: 'accounts',
  title: 'Weak · 弱口令站',
  fields: [
    { key: 'username', label: '用户名', type: 'text', value: 'weakuser', updatedAt: new Date().toISOString() },
    { key: 'password', label: '密码', type: 'secret', value: '123456', updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
const reused = await store.upsertRecord({
  scene: 'email',
  title: 'Reused · 复用同一密码',
  fields: [
    { key: 'address', label: '邮箱地址', type: 'email', value: 'r@example.com', updatedAt: new Date().toISOString() },
    { key: 'password', label: '密码', type: 'secret', value: '123456', updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
const expired = await store.upsertRecord({
  scene: 'document',
  title: '驾驶证 · 张三',
  fields: [
    { key: 'expiry', label: '有效期', type: 'date', value: '2020-01-01', updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
const revealedAll = await store.listRecordsRevealed()
const healthReport = auditVault(revealedAll, await store.listScenes())
assert(healthReport.issues.some((i) => i.kind === 'weak-password' && i.recordId === weak.id),
  'audit flags the weak password')
assert(healthReport.issues.some((i) => i.kind === 'reused-password' && i.recordId === reused.id),
  'audit flags the reused password')
const reuseIssues = healthReport.issues.filter((i) => i.kind === 'reused-password')
assert(reuseIssues.length >= 2 && reuseIssues.every((i) => i.groupId !== undefined),
  'reuse issues carry a shared group id')
assert(healthReport.issues.some((i) => i.kind === 'expired' && i.recordId === expired.id),
  'audit flags the expired document')
assert(!JSON.stringify(healthReport).includes(NEW_SECRET),
  'the health report never carries a secret value')
assert(!JSON.stringify(healthReport).includes('123456'),
  'the health report never echoes the weak password either')
assert(typeof healthReport.score === 'number' && healthReport.score >= 0 && healthReport.score <= 100,
  'the health score stays inside 0-100')
assert(isWeakPassword('password') && isWeakPassword('111111') && isWeakPassword('abcd'),
  'isWeakPassword flags table hits, pure digits and short strings')
assert(!isWeakPassword('Xk9$mQ2pLw'),
  'isWeakPassword does not flag a strong password')

// ── 14. TOTP：RFC 6238 测试向量 ────────────────────────────────────────
/*
 * 用 RFC 6238 附录 B 的官方向量。种子 ASCII "12345678901234567890"
 * 的 base32 形态是 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ。
 * 取 T=59s（counter=1）时 8 位码应为 94287082，我们取后 6 位 = 287082。
 */
const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const totpParams = parseTotpSecret(RFC_SEED)
assert(totpParams !== null, 'a bare base32 seed parses')
const totpAt59 = generateTotp({ ...totpParams, digits: 8 }, 59 * 1000)
assert(totpAt59.code === '94287082', 'TOTP matches the RFC 6238 vector at T=59')
const totpAt1111111109 = generateTotp({ ...totpParams, digits: 8 }, 1111111109 * 1000)
assert(totpAt1111111109.code === '07081804', 'TOTP matches the RFC 6238 vector at T=1111111109')
assert(totpAt59.period === 30 && totpAt59.remaining > 0 && totpAt59.remaining <= 30,
  'TOTP reports a sane period and countdown')
const otpauth = parseTotpSecret('otpauth://totp/GitHub:kr-ATG?secret=' + RFC_SEED + '&period=60&digits=8')
assert(otpauth !== null && otpauth.period === 60 && otpauth.digits === 8,
  'an otpauth link carries period and digits')
assert(otpauth !== null && otpauth.issuer === 'GitHub' && otpauth.account === 'kr-ATG',
  'an otpauth link carries issuer and account')
assert(parseTotpSecret('not-a-secret') === null, 'garbage is rejected as a TOTP seed')
assert(parseTotpSecret('') === null, 'an empty value is rejected as a TOTP seed')
assert(looksLikeTotpField({ key: 'totp', label: '二次验证', type: 'secret' }),
  'a totp field is recognised by key')
assert(!looksLikeTotpField({ key: 'password', label: '密码', type: 'secret' }),
  'a password field is not mistaken for a TOTP field')

// ── 15. 带口令的加密备份：换机救回全部密文 ─────────────────────────────
const backupKey = store.exportKeyBytes()
assert(backupKey !== null && backupKey.length === 32, 'the store exposes its key bytes for backup')
assert(/^[a-f0-9]{16}$/.test(keyFingerprint(backupKey)), 'the key fingerprint is a short hex digest')
const backupPwd = 'correct horse battery staple'
const vaultJsonForBackup = await store.exportRaw()
const backupText = await createBackupPackage({
  key: backupKey,
  vaultJson: vaultJsonForBackup,
  password: backupPwd,
  summary: { records: revealedAll.length, photos: 0, scenes: 3 },
})
assert(!backupText.includes(backupKey.toString('base64')), 'the backup does not carry the raw key in clear')
assert(!backupText.includes(NEW_SECRET), 'the backup does not carry any secret in clear')
const restored = await readBackupPackage(backupText, backupPwd)
assert(restored.key.equals(backupKey), 'the backup round-trips the exact key')
assert(restored.vaultJson === vaultJsonForBackup, 'the backup round-trips the vault json')
let wrongPwdRejected = false
try {
  await readBackupPackage(backupText, 'wrong password here')
} catch {
  wrongPwdRejected = true
}
assert(wrongPwdRejected, 'a wrong backup password is rejected instead of silently producing garbage')
let tamperedRejected = false
try {
  const tampered = JSON.parse(backupText)
  tampered.payload = Buffer.from('ffffffff', 'hex').toString('base64')
  await readBackupPackage(JSON.stringify(tampered), backupPwd)
} catch {
  tamperedRejected = true
}
assert(tamperedRejected, 'a tampered backup is rejected (GCM auth tag works)')
let shortPwdRejected = false
try {
  await createBackupPackage({ key: backupKey, vaultJson: '{}', password: '123', summary: { records: 0, photos: 0, scenes: 0 } })
} catch {
  shortPwdRejected = true
}
assert(shortPwdRejected, 'a too-short backup password is refused')

// ── 16. 恢复流程的核心：换密钥后旧密文仍能解 ───────────────────────────
const restoredCipher = VaultCipher.fromKey(restored.key)
assert(restoredCipher !== null, 'a cipher can be rebuilt from the backup key bytes')
const ciphertextOnDisk = JSON.parse(vaultJsonForBackup).records
  .find((r) => r.id === created.id).fields
  .find((f) => f.key === 'password').value
assert(ciphertextOnDisk.startsWith('secret:v1:'), 'the on-disk password is still ciphertext')
assert(restoredCipher.decrypt(ciphertextOnDisk) === NEW_SECRET,
  'the rebuilt cipher decrypts the stored ciphertext back to the real password')
assert(VaultCipher.fromKey(Buffer.alloc(16)) === null, 'a wrong-length key is refused instead of half-working')
// ── 收尾 ────────────────────────────────────────────────────────────────
await store.flush()
try { rmSync(SMOKE_HOME, { recursive: true, force: true }) } catch { /* 忽略 */ }
try { rmSync(OUT_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }

if (process.exitCode !== undefined && process.exitCode !== 0) {
  console.error('\ndsh-vault smoke FAILED')
} else {
  console.log('\ndsh-vault smoke passed')
}
