/**
 * 工作台资产云端同步单元与冒烟测试。
 */

import assert from 'node:assert/strict'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const SMOKE_HOME = resolve(ROOT, '_tmp', 'test-workbench-sync-dsh-home')
try { rmSync(SMOKE_HOME, { recursive: true, force: true }) } catch {}
mkdirSync(SMOKE_HOME, { recursive: true })
process.env.DSH_HOME = SMOKE_HOME

const bundleOut = resolve(ROOT, '_tmp', 'workbench-sync-bundle.mjs')
await build({
  entryPoints: [resolve(ROOT, 'src/triad/workbench-sync/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: bundleOut,
  external: ['@deepseek-ai/*', 'undici'],
})

// 导入测试工具模块
const helperOut = resolve(ROOT, '_tmp', 'workbench-sync-helper.mjs')
await build({
  stdin: {
    contents: `
      export * from './src/triad/workbench-sync/types.ts';
      export * from './src/triad/workbench-sync/crypto.ts';
      export * from './src/triad/workbench-sync/gather.ts';
      export * from './src/triad/workbench-sync/engine.ts';
      export * from './src/triad/vault/store.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: helperOut,
  external: ['@deepseek-ai/*', 'undici'],
})

const mod = await import(pathToFileURL(helperOut).href)

console.log('--- 1. 测试 URL 规范化 ---')
assert.equal(mod.normalizeGithubRepo('https://github.com/my-test-user/my-private-repo'), 'my-test-user/my-private-repo')
assert.equal(mod.normalizeGithubRepo('my-test-user/my-private-repo.git'), 'my-test-user/my-private-repo')
assert.equal(mod.normalizeGithubRepo('   foo/bar   '), 'foo/bar')
assert.equal(mod.normalizeGithubRepo('invalid-repo'), '')
assert.equal(mod.githubRepoUrl('foo/bar'), 'https://github.com/foo/bar')
console.log('✓ URL 规范化测试通过')

console.log('--- 2. 测试端侧 scrypt + AES-256-GCM 加解密 ---')
const sampleData = {
  format: 'dsh-workbench-sync',
  version: 1,
  createdAt: new Date().toISOString(),
  vault: {
    key: Buffer.from('12345678901234567890123456789012').toString('base64'),
    vaultJson: JSON.stringify({ records: [{ id: 'rec-1', title: 'VPS 服务器' }] }),
  },
  memory: {
    entriesJson: JSON.stringify({ entries: [{ id: 'mem-1', content: '这是一条重要的记忆' }] }),
  },
  skills: {
    files: { 'my-custom-skill/SKILL.md': Buffer.from('# Custom Skill').toString('base64') },
  },
}

const password = 'my-super-secret-passphrase-888'
const encrypted = await mod.encryptSyncPayload(sampleData, password, {
  vaultRecords: 1,
  memoryEntries: 1,
  skillFiles: 1,
})

assert.ok(typeof encrypted === 'string' && encrypted.length > 50)
const parsedEnv = JSON.parse(encrypted)
assert.equal(parsedEnv.format, 'dsh-workbench-sync')
assert.equal(parsedEnv.kdf.name, 'scrypt')
assert.equal(parsedEnv.cipher.name, 'aes-256-gcm')
assert.equal(parsedEnv.summary.vaultRecords, 1)

// 正常解密
const { data: decrypted } = await mod.decryptSyncPayload(encrypted, password)
assert.deepEqual(decrypted, sampleData, '解密后数据应与原始数据完全一致')
console.log('✓ 加解密无损还原通过')

// 密码错误拦截
let failedPass = false
try {
  await mod.decryptSyncPayload(encrypted, 'wrong-password-999')
} catch (err) {
  failedPass = true
  assert.match(err.message, /口令错误/)
}
assert.ok(failedPass, '错误口令必须被正确拦截并报错')
console.log('✓ 错误口令拒绝通过')

// 篡改密文拦截
let failedTamper = false
try {
  const tamperedEnv = { ...parsedEnv, payload: Buffer.from('tampered').toString('base64') }
  await mod.decryptSyncPayload(JSON.stringify(tamperedEnv), password)
} catch {
  failedTamper = true
}
assert.ok(failedTamper, '篡改密文必须被 GCM 认证拦截')
console.log('✓ 密文篡改拦截通过')


console.log('--- 3. 动态设置（config + 关注对象）收集与还原 ---')
const feedRoot = join(SMOKE_HOME, 'feed', 'dsh-chat-plus')
mkdirSync(feedRoot, { recursive: true })

// 云端机器的数据：config 是设置、gate/runs/xSync 是运行态（后者不该被带走）
const cloudState = {
  version: 1,
  config: {
    prompt: '云端提示词：盯住 AI 与开源',
    model: 'auto/deepseek-v4.1-flash',
    cron: '0 9,18 * * *',
    xHandles: ['openai'],
  },
  gate: { status: 'running', runId: 'run-cloud', leaseUntil: Date.now() + 600000, queued: false, queuedTrigger: null, blockedCount: 0 },
  runs: [{ id: 'run-cloud', trigger: 'manual', modelUsed: 'x', startedAt: 1, status: 'running' }],
  xSync: { openai: { handle: 'openai', lastFetchedAt: 1, cooldownUntil: 0, consecutiveFailures: 0, seenTweetIds: { t1: 1 } } },
  lastSyncAt: 1,
  lastRunAt: 1,
}
writeFileSync(join(feedRoot, 'state.json'), JSON.stringify(cloudState, null, 2))
writeFileSync(join(feedRoot, 'entities.json'), JSON.stringify({
  version: 1,
  entities: [
    { id: 'fe_1', name: 'OpenAI', kind: 'company', aliases: ['开放人工智能'], createdAt: 1, xHandle: 'openai' },
  ],
}, null, 2))

const feedPayload = await mod.gatherWorkbenchAssets({
  includeVault: false,
  includeMemory: false,
  includeSkills: false,
  includeFeed: true,
  vaultStore: /** @type {any} */ ({}),
})
assert.ok(feedPayload.feed, 'includeFeed=true 时 payload.feed 必须存在')
const gatheredConfig = JSON.parse(feedPayload.feed.configJson)
assert.equal(gatheredConfig.prompt, '云端提示词：盯住 AI 与开源')
assert.deepEqual(gatheredConfig.xHandles, ['openai'])
// 运行态绝不能混进配置段
assert.ok(!('gate' in gatheredConfig), 'config 段不得包含 gate')
assert.ok(!('runs' in gatheredConfig), 'config 段不得包含 runs')
assert.ok(!('xSync' in gatheredConfig), 'config 段不得包含 xSync')
assert.ok(!feedPayload.feed.configJson.includes('run-cloud'), '配置段不得带上云端轮次 id')
assert.equal(JSON.parse(feedPayload.feed.entitiesJson).entities.length, 1)

const noFeedPayload = await mod.gatherWorkbenchAssets({
  includeVault: false,
  includeMemory: false,
  includeSkills: false,
  includeFeed: false,
  vaultStore: /** @type {any} */ ({}),
})
assert.equal(noFeedPayload.feed, undefined, 'includeFeed=false 时不得收集动态设置')

// 本机已有自己的运行态：恢复时必须保留 gate / runs / xSync，只换 config 与 entities
const localState = {
  version: 1,
  config: { prompt: '本机旧提示词', model: 'default', cron: '0 12,18 * * *', xHandles: [] },
  gate: { status: 'idle', runId: null, leaseUntil: 0, queued: false, queuedTrigger: null, blockedCount: 3 },
  runs: [{ id: 'run-local', trigger: 'manual', modelUsed: 'y', startedAt: 2, status: 'ok' }],
  xSync: { local: { handle: 'local', lastFetchedAt: 2, cooldownUntil: 0, consecutiveFailures: 0, seenTweetIds: {} } },
  lastSyncAt: 2,
  lastRunAt: 2,
}
writeFileSync(join(feedRoot, 'state.json'), JSON.stringify(localState, null, 2))
writeFileSync(join(feedRoot, 'entities.json'), JSON.stringify({ version: 1, entities: [] }))

const restoredFeed = await mod.restoreFeed(feedPayload.feed)
assert.equal(restoredFeed.config, true, '配置段必须被恢复')
assert.equal(restoredFeed.entities, 1, '关注对象数量应回传')

const mergedState = JSON.parse(readFileSync(join(feedRoot, 'state.json'), 'utf8'))
assert.equal(mergedState.config.prompt, '云端提示词：盯住 AI 与开源', 'config 必须来自云端')
assert.equal(mergedState.gate.status, 'idle', '本机 gate 运行态必须原样保留')
assert.equal(mergedState.gate.blockedCount, 3)
assert.equal(mergedState.runs[0].id, 'run-local', '本机轮次历史必须原样保留')
assert.ok(mergedState.xSync.local, '本机 X 去重状态必须原样保留')
assert.ok(existsSync(join(feedRoot, 'state.json.bak-before-sync')), '覆盖前必须留本地快照')
const mergedEntities = JSON.parse(readFileSync(join(feedRoot, 'entities.json'), 'utf8'))
assert.equal(mergedEntities.entities[0].name, 'OpenAI', '关注对象必须来自云端')
assert.ok(existsSync(join(feedRoot, 'entities.json.bak-before-sync')), '关注对象覆盖前必须留快照')

const sizes = await mod.getWorkbenchSizes()
assert.ok(sizes.feedBytes > 0, '动态设置体积必须计入统计')
assert.ok(sizes.totalBytes >= sizes.feedBytes, '总体积不得小于动态设置体积')

assert.equal(mod.DEFAULT_WORKBENCH_SYNC_SETTINGS.includeFeed, true, '默认必须包含动态设置')
console.log('✓ 动态设置收集 / 还原 / 运行态保留通过')

console.log('--- 4. 同步引擎：includeFeed 的保存与公开状态 ---')
const vaultStore = new mod.VaultStore(null)
const engine = new mod.WorkbenchSyncEngine(vaultStore, null, {})
await engine.save({ includeFeed: false })
const persistedFile = JSON.parse(readFileSync(engine.filePath, 'utf8'))
assert.equal(persistedFile.settings.includeFeed, false, 'save 必须把 includeFeed 落盘')
assert.equal(persistedFile.settings.includeVault, true, 'save 只改点名的开关，其它范围保持默认')
assert.equal(persistedFile.settings.includeMemory, true)
assert.equal(persistedFile.settings.includeSkills, true)
const view = await engine.publicView()
assert.equal(view.includeFeed, false, 'publicView 必须回传 includeFeed')
assert.ok(typeof view.localFeedBytes === 'number' && view.localFeedBytes >= 0, 'publicView 必须回传动态设置体积')
console.log('✓ 同步引擎的 includeFeed 保存与状态视图通过')

console.log('--- 5. 检查安全规范（零私密硬编码） ---')
const rawEngineCode = await (await import('node:fs/promises')).readFile(resolve(ROOT, 'src/triad/workbench-sync/engine.ts'), 'utf8')
assert.ok(!rawEngineCode.includes('Kr-ATG'), '代码中不得出现具体用户名')
assert.ok(!rawEngineCode.includes('kratgone'), '代码中不得出现具体邮箱')
assert.ok(!rawEngineCode.includes('ghp_'), '代码中不得硬编码任何个人 Token')
console.log('✓ 安全规范检查通过：零个人私库/Token 硬编码')

console.log('\n>>> ALL WORKBENCH SYNC TESTS PASSED! <<<')
