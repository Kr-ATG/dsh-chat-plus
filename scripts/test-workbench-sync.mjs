/**
 * 工作台资产云端同步单元与冒烟测试。
 */

import assert from 'node:assert/strict'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rmSync, mkdirSync } from 'node:fs'
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

console.log('--- 3. 检查安全规范（零私密硬编码） ---')
const rawEngineCode = await (await import('node:fs/promises')).readFile(resolve(ROOT, 'src/triad/workbench-sync/engine.ts'), 'utf8')
assert.ok(!rawEngineCode.includes('Kr-ATG'), '代码中不得出现具体用户名')
assert.ok(!rawEngineCode.includes('kratgone'), '代码中不得出现具体邮箱')
assert.ok(!rawEngineCode.includes('ghp_'), '代码中不得硬编码任何个人 Token')
console.log('✓ 安全规范检查通过：零个人私库/Token 硬编码')

console.log('\n>>> ALL WORKBENCH SYNC TESTS PASSED! <<<')
