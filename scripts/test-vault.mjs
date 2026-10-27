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

/*
 * extract 也打进来（v2 起）：待确认机制退役的核心证据之一是「applyVaultOps 写出来
 * 的记录上不再有 pending 字段」，而那只有把应用层一起 import 才断言得到。它 import
 * 了 ../../vendor/dsh-llm（createUserMessage / BlockAssembler），是仓库内的 vendored
 * 叶子模块、没有外部依赖，实测能正常打进这个 ESM 包——所以不退回「只断言 store/inject」
 * 的降级方案。
 */
const sources = ['types', 'crypto', 'blobs', 'store', 'inject', 'reminders', 'totp', 'backup', 'extract']
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
  DEFAULT_VAULT_CONFIG, listVaultReminders, nearestExpiryOf, expiryNoteOf, EXPIRY_NOTE_DAYS,
  parseTotpSecret, generateTotp, looksLikeTotpField,
  createBackupPackage, readBackupPackage, keyFingerprint,
  // 注入引导语：模型「看得见」的那段文案，下面有断言钉住它的关键纪律。
  VAULT_INJECTION_RULE,
  // v2 起（待确认机制退役）用来钉住迁移与应用层的行为。
  VAULT_SCHEMA_VERSION, migrate, applyVaultOps,
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

/*
 * 4b. 注入引导语必须教会模型「自己写」（2026-10-26 用户要求「我就是想主 agent
 *     会话中自己写」）。
 *
 * 这几条断言防的是**规则文本被悄悄改回旧行为**：原来的第 5 条明说「正常对话即可，
 * 回合结束会自动抽取入库」——那句话与「主 agent 主动写」直接冲突，模型读到它就会
 * 放弃调 vault_remember。文案类的东西没有类型检查兜底，只能靠冒烟钉住。
 */
assert(VAULT_INJECTION_RULE.includes('vault_remember'),
  'the injection rule names vault_remember so the model knows the write tool')
assert(/该记就当场写|当场调/.test(VAULT_INJECTION_RULE),
  'the injection rule tells the model to write immediately instead of waiting for extraction')
// 旧口径必须消失：留着「回合结束会自动抽出」模型就不写。
assert(!/正常对话即可/.test(VAULT_INJECTION_RULE),
  'the injection rule no longer tells the model to just chat and let extraction handle it')
// 防复述：参数里传一次是必须的，正文里再写一遍等于同一份明文存两份。
assert(/不要在回复正文里复述|不要在回复里复述/.test(VAULT_INJECTION_RULE),
  'the injection rule forbids repeating the secret in the reply body')
// 防编造：用户没给的值不许拿旧值/示例值填。
assert(/必须是用户刚给出的/.test(VAULT_INJECTION_RULE),
  'the injection rule forbids inventing values the user never gave')
// 四条纪律的原文必须在场（防止后续精简时被顺手删掉）。
// 注意判据要取规则里**真正连续出现**的词：比如「没有明文」在原文里是
// 「只有字段名，没有密码 / 卡号 / 证件号的明文」，中间被括注打断，不能直接 includes。
// 这里原先还有一项 '待确认'（对应「标了「待确认」的记录来自自动抽取，可能有误」
// 那条纪律）。2026-10-27 用户要求档案不需要确认，该纪律整条删除、其余六条重排，
// 所以这一项从 mustKeep 里拿掉，改由下面的 mustDrop 反过来钉住它不许回来。
for (const mustKeep of ['只有字段名', '非敏感字段', '索引里没有的账户']) {
  assert(VAULT_INJECTION_RULE.includes(mustKeep), 'the injection rule keeps the "' + mustKeep + '" clause')
}

/*
 * 待确认机制退役后，规则文本里**不能再出现**任何指向「确认」的话。
 *
 * 这不是洁癖：规则每步都进上下文，留着「标了「待确认」的记录…引用之前先跟用户
 * 确认一句」就等于让模型去找一个已经不存在的标记，或者把每一条正常记录（现在
 * 自动抽取的结果和人手录的完全一样）都当成可疑数据。文案没有类型检查兜底，
 * 只能靠这两条否向断言钉住。
 */
for (const mustDrop of ['待确认', '跟用户确认一句']) {
  assert(!VAULT_INJECTION_RULE.includes(mustDrop),
    'the injection rule no longer mentions "' + mustDrop + '" (the pending mechanism was retired in v2)')
}
// 规则本身绝不含任何敏感明文（它每步都进上下文）。
assert(!VAULT_INJECTION_RULE.includes(SECRET), 'the rule text itself carries no secret')

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


// ── 13. 到期提醒（原「密码健康审计」已按用户要求删除）────────────────
/*
 * 这一节原来断言的是健康审计：弱口令 / 复用 / 健康分 / 报告里不出现明文。
 * 用户 2026-10-27 要求把那一整套删掉，只保留「会自己变坏」的日期提醒，
 * 所以这里改成钉住提醒引擎的三条纪律：
 *   1. 只报日期，且每条记录只看**最近**的那个日期（同一记录两个日期不重复报）；
 *   2. 已过期的永远报，未到期的只在 90 天内报；
 *   3. 清单里绝不出现任何敏感值——提醒用的是掩码版 listRecords，本来就不该有明文。
 */
const expired = await store.upsertRecord({
  scene: 'document',
  title: '驾驶证 · 张三',
  fields: [
    { key: 'expiry', label: '有效期', type: 'date', value: '2020-01-01', updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
const soonMs = Date.now() + 10 * 24 * 60 * 60 * 1000
const soon = await store.upsertRecord({
  scene: 'document',
  title: '护照 · 张三',
  fields: [
    { key: 'expiry', label: '到期日', type: 'date', value: new Date(soonMs).toISOString().slice(0, 10), updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
const farMs = Date.now() + 400 * 24 * 60 * 60 * 1000
const far = await store.upsertRecord({
  scene: 'document',
  title: '房产证 · 张三',
  fields: [
    { key: 'expiry', label: '有效期', type: 'date', value: new Date(farMs).toISOString().slice(0, 10), updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
// 提醒只读掩码版（不需要任何明文）：这本身就是一条纪律，写进测试钉住。
const maskedAll = await store.listRecords()
const remindReport = listVaultReminders(maskedAll)
assert(remindReport.reminders.some((item) => item.recordId === expired.id && item.days < 0),
  'the reminder list flags the expired document')
assert(remindReport.reminders.some((item) => item.recordId === soon.id && item.days > 0),
  'the reminder list flags the document expiring in 10 days')
assert(!remindReport.reminders.some((item) => item.recordId === far.id),
  'a document expiring in 400 days is NOT listed (threshold is 90 days)')
assert(!JSON.stringify(remindReport).includes(NEW_SECRET),
  'the reminder list never carries a secret value')
assert(!JSON.stringify(remindReport).includes('123456'),
  'the reminder list never echoes the weak password either')
// 排序：已过期最久的最前（days 最小）。
assert(remindReport.reminders.every((item, index, list) => index === 0 || list[index - 1].days <= item.days),
  'the reminder list is sorted by urgency (most overdue first)')
// 一条记录只看最近的那个日期：同一条记录再加一个更远的日期字段，清单里仍然只有一条。
await store.upsertRecord({
  id: expired.id,
  scene: 'document',
  title: '驾驶证 · 张三',
  fields: [
    { key: 'expiry', label: '有效期', type: 'date', value: '2020-01-01', updatedAt: new Date().toISOString() },
    { key: 'issued', label: '签发日期', type: 'date', value: '2014-01-01', updatedAt: new Date().toISOString() },
  ],
  source: 'manual',
})
const maskedAgain = await store.listRecords()
const singleRecordReminders = listVaultReminders(maskedAgain).reminders.filter((item) => item.recordId === expired.id)
assert(singleRecordReminders.length === 1, 'one record yields at most one reminder (nearest date only)')
assert(singleRecordReminders[0].fieldKey === 'issued',
  'the nearest of several date fields wins (2014 is further in the past than 2020)')
// 归档的记录不进清单：归档的语义就是「平时不用看见」。
await store.setArchived(soon.id, true)
const archivedReport = listVaultReminders(await store.listRecords())
assert(!archivedReport.reminders.some((item) => item.recordId === soon.id),
  'archived records are excluded from the reminder list')
await store.setArchived(soon.id, false)
// 注入行尾那句提示与提醒清单必须同源（同一个 nearestExpiryOf）。
const expiredRecord = (await store.listRecords()).find((item) => item.id === expired.id)
assert(expiryNoteOf(expiredRecord).includes('已过期'),
  'the injection note says 已过期 for an expired date')
assert(nearestExpiryOf(expiredRecord) !== null && nearestExpiryOf(expiredRecord).days < 0,
  'nearestExpiryOf agrees with the injection note')
assert(EXPIRY_NOTE_DAYS === 90, 'the expiry window stays at 90 days')

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
  summary: { records: maskedAll.length, photos: 0, scenes: 3 },
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
// ── 17. 待确认（pending）机制退役（v2，2026-10-27 用户要求「档案不需要确认」）───
/*
 * 这一节钉的是「待确认机制整块消失了」这件事本身。
 *
 * 为什么必须在冒烟里钉：状态退役是**减法**，减法的失败模式不是报错，而是
 * 「以为删干净了、其实还留着一半」——比如迁移不主动清标记，老库里那些挂过
 * 待确认的记录就永远带着一个再没人读的僵尸字段；比如应用层还偷偷写
 * pending: true，新抽出来的记录又会挂上而页面上已经没有确认入口。这些都
 * 不会崩，只会静默错，所以只能靠断言。
 */
assert(VAULT_SCHEMA_VERSION === 3, 'the vault schema version is 3 (v2 retired pending, v3 added the purpose category)')

// ① 确认动作的写入口整体没了：store 上不该再有 setPending。
assert(typeof store.setPending !== 'function',
  'the store no longer exposes setPending (that was the only way to touch the old pending flag)')

/*
 * ② migrate 的 v1→v2 一级：老库里挂着的 pending 必须被**主动删掉**。
 *
 * 不能只是「从此不再写它」：老库已经挂着的记录会一直带着这个标记，而页面上的
 * 确认入口已经整块拆掉——用户看到一条「待确认」却没有任何地方能确认，那就是
 * 个永久挂着的假状态。删标记＝把它当作已生效，这正是用户要的语义。
 */
const v1Data = {
  schemaVersion: 1,
  records: [
    {
      id: 'rec_v1_pending',
      scene: 'accounts',
      title: 'v1 时代挂过待确认的记录',
      fields: [{ key: 'username', label: '用户名', type: 'text', value: 'legacy-user', updatedAt: '2026-09-01T00:00:00.000Z' }],
      photos: [],
      tags: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      source: 'extract',
      confidence: 0.42,
      version: 7,
      changes: [],
      // 这就是 v1 带过来的待确认标记（以及当时顺手记下的低可信度）。
      pending: true,
    },
    {
      id: 'rec_v1_plain',
      scene: 'accounts',
      title: 'v1 时代没挂过待确认的记录',
      fields: [{ key: 'username', label: '用户名', type: 'text', value: 'plain-user', updatedAt: '2026-09-02T00:00:00.000Z' }],
      photos: [],
      tags: [],
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      source: 'manual',
      confidence: 1,
      version: 1,
      changes: [],
    },
  ],
  scenes: [],
}
const migratedFromV1 = migrate(v1Data)
const migratedPending = migratedFromV1.records.find((record) => record.id === 'rec_v1_pending')
assert(migratedFromV1.schemaVersion === 3, 'migrate bumps a v1 store all the way to schema version 3')
assert(migratedPending !== undefined && !('pending' in migratedPending),
  'migrate deletes the legacy pending flag instead of just no longer writing it')
assert(migratedFromV1.records.length === 2, 'migrate keeps every record (the flag goes, the data stays)')
assert(migratedFromV1.records.every((record) => !('pending' in record)),
  'migrate leaves no record carrying a pending flag (including ones that never had it)')
// 迁移只该动「待确认」这一件事：溯源与版本号必须原样带过去，否则「改了什么」无从追查。
assert(migratedPending.confidence === 0.42, 'migrate preserves confidence (it is provenance, not a pending marker)')
assert(migratedPending.version === 7, 'migrate preserves the record version counter')
assert(migratedPending.source === 'extract', 'migrate preserves the record source')

/*
 * ③ 应用层：applyVaultOps 写出来的记录上**没有** pending 字段。
 *
 * 这是整条链上最容易漏的一环——迁移把老标记清了，但应用层要是还在 create 路径
 * 写 pending: true，新抽出来的记录又会挂上去。所以这里真跑一次 create + 一次
 * update，然后到 store 里读回来验。
 */
const extractScenes = await store.listScenes()
const applyResult = await applyVaultOps(store, [
  {
    action: 'create',
    scene: 'accounts',
    title: 'Smoke · 抽取直接生效',
    fields: [
      { key: 'username', label: '用户名', type: 'text', value: 'smoke-extract-user' },
      { key: 'password', label: '密码', type: 'secret', value: 'smoke-extract-pw', sensitive: true },
    ],
    confidence: 0.66,
  },
], { scenes: extractScenes })
assert(applyResult.created === 1 && applyResult.updated === 0 && applyResult.skipped === 0,
  'applyVaultOps reports exactly created=1 (the result shape no longer has pending counters)')
const extractedRecord = (await store.listRecords()).find((record) => record.title === 'Smoke · 抽取直接生效')
assert(extractedRecord !== undefined, 'the extracted record is in the store right away (no confirmation step)')
assert(!('pending' in extractedRecord),
  'a record created by applyVaultOps carries no pending flag (extraction results take effect immediately)')
// confidence 仍然要写：它只是溯源信息，不是「等人确认」的意思。
assert(extractedRecord.confidence === 0.66, 'applyVaultOps still records confidence as provenance')

// update 路径同样不该挂任何标记（原来会按配置把整条记录标成 pending）。
const applyUpdate = await applyVaultOps(store, [
  { action: 'update', recordId: extractedRecord.id, fields: [{ key: 'username', label: '用户名', type: 'text', value: 'smoke-extract-user-2' }] },
], { scenes: extractScenes })
assert(applyUpdate.updated === 1, 'applyVaultOps applies the update instead of parking it for confirmation')
const afterExtractUpdate = await store.getRecord(extractedRecord.id)
assert(!('pending' in afterExtractUpdate),
  'an extracted update leaves no pending flag behind either')
assert(afterExtractUpdate.fields.find((field) => field.key === 'username').value === 'smoke-extract-user-2',
  'the extracted value is live immediately (the next turn already sees it)')

// ④ 注入正文（记录行）里也不该再出现待确认字样：原来 formatRecordLine 会加
//    「·（自动记录，待确认）」后缀，标注一个已经不存在的状态。
const injectionAfterExtract = injector.buildInjectionText(await store.listRecordsRevealed(), await store.listScenes())
assert(!injectionAfterExtract.includes('待确认'), 'the injection body no longer annotates records as pending')
assert(!injectionAfterExtract.includes('自动记录'), 'the injection body no longer marks auto-extracted records at all')

/*
 * ⑤ 路由面：/confirm 必须连路由一起删掉。
 *
 * 只删页面不算完——留着那条路由就等于留着一个「能远程删记录」的口子
 * （原来 accept=false 的语义是直接删记录），而它保护的那个状态已经不存在了。
 * 判据要匹配**路由注册**的形态（rest === '/confirm'）而不是简单 includes：
 * 源码里刻意留了一段解释「这里原有 POST /confirm」的注释，那是给后来人看的。
 */
const hostApiSource = readFileSync(resolve(ROOT, 'src/triad/vault/api.ts'), 'utf8')
assert(!/rest\s*===\s*'\/confirm'/.test(hostApiSource),
  'the host no longer registers a /confirm route (it would still be able to delete records)')
const clientApiSource = readFileSync(resolve(ROOT, 'src/client/triad/vault/api.ts'), 'utf8')
assert(!/['"]\/confirm['"]/.test(clientApiSource),
  'the client api no longer wraps a /confirm call')
const clientPanelSource = readFileSync(resolve(ROOT, 'src/client/triad/vault/Panel.tsx'), 'utf8')
  + readFileSync(resolve(ROOT, 'src/client/triad/vault/DetailDrawer.tsx'), 'utf8')
assert(!/\bpending\b|badgePending|confirmVaultRecord/.test(clientPanelSource),
  'the vault panel and detail drawer no longer reference pending / badgePending / confirmVaultRecord')

// ── 收尾 ────────────────────────────────────────────────────────────────
await store.flush()
try { rmSync(SMOKE_HOME, { recursive: true, force: true }) } catch { /* 忽略 */ }
try { rmSync(OUT_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }

if (process.exitCode !== undefined && process.exitCode !== 0) {
  console.error('\ndsh-vault smoke FAILED')
} else {
  console.log('\ndsh-vault smoke passed')
}
