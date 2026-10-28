/**
 * dsh-chat-plus — 「包含的组件」原生行开关回归测试（纯 Node ESM）。
 *
 * 分四层：
 *   1. 组件目录 src/shared/components.ts：16 个组件、id / rowId 唯一、默认值齐全；
 *   2. 功能映射：src/shared/features.ts 的每一项都能映射到某个组件，且映射目标存在；
 *   3. 打包契约：cordis.patch.yml 的 insert 行与 COMPONENTS 逐一对齐、
 *      packages/<id>/ 有可解析的 host-only 入口与 locale/zh.json、package.json
 *      的 exports 暴露这些子路径；
 *   4. 产物层：lib/index.js 含 /api/chat-flow/components、lib/client.js 含
 *      dsh.chat_plus.components.v1 与组件 store 的关键字。
 *
 * 为什么不再测 features.json：组件开关的真相是 cordis loader 的行状态（官方
 * 原生「运行中」开关），本插件不再维护自己的配置文件。
 *
 * Usage: node scripts/test-feature-switches.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

let failed = 0
const check = (condition, message) => {
  if (condition) console.log('ok    ' + message)
  else {
    failed += 1
    console.error('FAIL  ' + message)
  }
}
const readText = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/** 子进程加载 TS 源并返回最后一行 JSON。 */
function runTsProbe(label, code) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', code], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env },
  })
  if (result.error !== undefined) throw new Error(label + ' 子进程启动失败：' + result.error.message)
  if (result.status !== 0) throw new Error(label + ' 子进程退出码 ' + String(result.status) + '\n--- stderr ---\n' + result.stderr + '\n--- stdout ---\n' + result.stdout)
  const lines = String(result.stdout).split(/\r?\n/).filter((line) => line.trim() !== '')
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

/** components.ts + features.ts 的联合探针。 */
async function catalogProbe(componentsUrl, featuresUrl) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const components = await import(componentsUrl)
  const features = await import(featuresUrl)
  const list = components.COMPONENTS
  check(Array.isArray(list) && list.length === 16, 'COMPONENTS 恰好 16 项（实际 ' + list.length + '）')
  const ids = new Set()
  const rows = new Set()
  for (const component of list) {
    if (ids.has(component.id)) failures.push('组件 id 重复：' + component.id)
    if (rows.has(component.rowId)) failures.push('组件 rowId 重复：' + component.rowId)
    ids.add(component.id)
    rows.add(component.rowId)
    if (typeof component.title !== 'string' || component.title.trim() === '') failures.push('组件 ' + component.id + ' 缺 title')
    if (typeof component.description !== 'string' || component.description.trim() === '') failures.push('组件 ' + component.id + ' 缺 description')
    if (typeof component.defaultEnabled !== 'boolean') failures.push('组件 ' + component.id + ' 缺 defaultEnabled')
  }
  check(list[0].id === 'core' && list[0].rowId === 'dsh-chat-plus', '第一个组件是主入口 core / dsh-chat-plus')
  for (const feature of features.FEATURES) {
    const component = components.componentOfFeature(feature.id)
    if (!ids.has(component)) failures.push('功能 ' + feature.id + ' 映射到不存在的组件 ' + component)
  }
  const mapped = Object.keys(components.FEATURE_COMPONENT)
  const featureIds = new Set(features.FEATURES.map((feature) => feature.id))
  for (const id of mapped) if (!featureIds.has(id)) failures.push('FEATURE_COMPONENT 含未知功能 id：' + id)
  const unmapped = features.FEATURES.filter((feature) => !(feature.id in components.FEATURE_COMPONENT))
  check(unmapped.length === 0, '全部功能都有组件映射' + (unmapped.length === 0 ? '' : '：' + unmapped.map((feature) => feature.id).join(', ')))
  check(components.isComponentId('cards') === true, 'isComponentId 认已知组件')
  check(components.isComponentId('nope') === false, 'isComponentId 拒未知组件')
  console.log(JSON.stringify({ ok: failures.length === 0, failures, components: list.length, features: features.FEATURES.length }))
}

/** 宿主 store 探针：用假 loader 验证 disabled 行 → 组件关闭。 */
async function hostStoreProbe(storeUrl) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const store = await import(storeUrl)
  check(store.COMPONENTS_ROUTE === '/api/chat-flow/components', 'COMPONENTS_ROUTE 正确')
  const entries = [
    { options: { id: 'dsh-chat-plus' }, disabled: false },
    { options: { id: 'dsh-chat-plus-cards' }, disabled: true },
    { options: { id: 'dsh-chat-plus-memory' }, disabled: false },
  ]
  store.initializeFeatures({ root: { loader: { entries: () => entries } } })
  const states = store.readComponentStates()
  check(states.core === true, '未禁用的主入口 = true')
  check(states.cards === false, 'disabled 的 cards 行 = false')
  check(states.memory === true, '未禁用的 memory 行 = true')
  check(states.seeker === true, 'loader 里没有的行按默认 true（不会误关）')
  check(store.hostFeatureEnabled('card.html') === false, 'hostFeatureEnabled 按组件映射（card.html → cards）')
  check(store.hostFeatureEnabled('view.panel-memory') === true, 'hostFeatureEnabled 按组件映射（view.panel-memory → seeker）')
  const snap = store.snapshot()
  check(snap.ok === true && typeof snap.values === 'object', 'snapshot() 返回 { ok, values }')
  check(snap.values.cards === false, 'snapshot 反映行状态')
  console.log(JSON.stringify({ ok: failures.length === 0, failures }))
}

// ── 1. 目录与映射 ───────────────────────────────────────────────────────────
console.log('\n── 组件目录与功能映射 ──')
try {
  const result = runTsProbe('catalog', '(' + catalogProbe.toString() + ')(' + JSON.stringify(pathToFileURL(join(ROOT, 'src/shared/components.ts')).href) + ',' + JSON.stringify(pathToFileURL(join(ROOT, 'src/shared/features.ts')).href) + ')')
  if (result.ok === true) check(true, '组件目录 + 功能映射全部通过（' + result.components + ' 组件 / ' + result.features + ' 功能）')
  else for (const message of result.failures) check(false, '目录断言：' + message)
} catch (error) {
  failed += 1
  console.error('FAIL  组件目录探针无法执行：' + error.message)
}

// ── 2. 宿主 store ───────────────────────────────────────────────────────────
console.log('\n── 宿主 store src/features/store.ts ──')
const storeSrc = readText('src/features/store.ts')
check(storeSrc.includes("export const COMPONENTS_ROUTE = '/api/chat-flow/components'"), "store.ts 声明 COMPONENTS_ROUTE = '/api/chat-flow/components'")
check(/export function readComponentStates\s*\(/.test(storeSrc), '导出 readComponentStates')
check(/export function hostFeatureEnabled\s*\(/.test(storeSrc), '导出 hostFeatureEnabled')
check(/export function hostComponentEnabled\s*\(/.test(storeSrc), '导出 hostComponentEnabled')
check(storeSrc.includes('ctx.webServer.register'), 'applyFeatureRoutes 走 ctx.webServer.register')
check(storeSrc.includes('loader.entries()'), '组件状态来自 loader.entries()（原生行开关）')
try {
  const result = runTsProbe('host-store', '(' + hostStoreProbe.toString() + ')(' + JSON.stringify(pathToFileURL(join(ROOT, 'src/features/store.ts')).href) + ')')
  if (result.ok === true) check(true, '宿主 store 行为断言全部通过')
  else for (const message of result.failures) check(false, '宿主 store 断言：' + message)
} catch (error) {
  failed += 1
  console.error('FAIL  宿主 store 探针无法执行：' + error.message)
}

// ── 3. 打包契约：patch / packages / exports ─────────────────────────────────
console.log('\n── 打包契约 ──')
const patch = readText('cordis.patch.yml')
const pkg = JSON.parse(readText('package.json'))
const componentSrc = readText('src/shared/components.ts')
const rowIds = [...componentSrc.matchAll(/rowId: '([^']+)'/g)].map((match) => match[1])
check(rowIds.length === 16, 'components.ts 声明 16 个 rowId（实际 ' + rowIds.length + '）')
for (const rowId of rowIds) {
  check(patch.includes('id: ' + rowId), 'cordis.patch.yml 含行 ' + rowId)
}
check(patch.includes('name: dsh-chat-plus/packages/cards'), 'patch 行 name 指向 packages/cards 子模块')
check(pkg.exports['./packages/*'] === './packages/*/index.js', 'package.json 暴露 ./packages/* 子路径')
check(pkg.exports['./packages/*/locale/zh.json'] === './packages/*/locale/zh.json', 'package.json 暴露组件 zh 本地化')
check(pkg.files.includes('packages'), 'package.json files 包含 packages（发布时随包）')
const componentDirs = ['cards','seeker','done-pill','memory','skills','usage','gallery','vault','prompt','feed','sync','provider','mail','input','host']
for (const id of componentDirs) {
  const entry = join(ROOT, 'packages', id, 'index.js')
  const zh = join(ROOT, 'packages', id, 'locale', 'zh.json')
  check(existsSync(entry), 'packages/' + id + '/index.js 存在')
  check(existsSync(zh), 'packages/' + id + '/locale/zh.json 存在')
  if (existsSync(zh)) {
    const meta = JSON.parse(readFileSync(zh, 'utf8')).meta ?? {}
    check(typeof meta.title === 'string' && meta.title.trim() !== '', 'packages/' + id + ' 有中文行标题（' + meta.title + '）')
    check(typeof meta.description === 'string' && meta.description.trim() !== '', 'packages/' + id + ' 有中文行说明')
  }
}

// ── 4. 构建产物 ─────────────────────────────────────────────────────────────
console.log('\n── 构建产物 ──')
const clientBundle = readText('lib/client.js')
const hostBundle = readText('lib/index.js')
check(clientBundle.includes('dsh.chat_plus.components.v1'), 'lib/client.js 含组件状态缓存键')
check(clientBundle.includes('/api/chat-flow/components'), 'lib/client.js 含组件状态路由')
check(hostBundle.includes('/api/chat-flow/components'), 'lib/index.js 含组件状态路由')
check(hostBundle.includes('readComponentStates'), 'lib/index.js 含 readComponentStates')
check(!clientBundle.includes('plugins.bundle.config'), '客户端不再注册自绘插件页配置面板（66 项面板已撤回）')

console.log(failed === 0 ? '\nPASSED' : '\nFAILED (' + failed + ')')
process.exit(failed === 0 ? 0 : 1)
