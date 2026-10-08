/**
 * dsh-chat-plus — 子智能体目录读法回归测试（test-subagent-catalog.mjs）。
 *
 * ## 为什么要这个测试
 *
 * 2026-10-08 之前，`subagent-catalog.ts` 读的是 `snapshot.items` 与
 * `snapshot.subagentsByParent` —— **这两个键在实际快照里都不存在**：
 *   · `items` 是 SessionManager 内部 `buildListSnapshot()` 的入参形状，
 *     而 `ISessions.list` 对外发布的是 `{ ids, byId, phase, projectionsBySession }`；
 *   · `subagentsByParent` / `refreshSubagents` 这套 API 在当前 DSH 版本里根本没有。
 *
 * 后果不是报错，而是**静默的永远读不到**：`rowsFromItems` 恒返回空数组、
 * `subagentsByParent` 恒 undefined，于是目录永远停在「未加载」。用户截图里
 * 「派出子任务 · 子智能体徽标」下面紧跟一句「子智能体清单未加载」就是这么来的。
 *
 * 这类 bug 的可怕之处在于：代码能跑、类型能过、smoke 里"样式族存在"的断言也全绿，
 * 只有真的拿一份快照喂进去才看得出来。所以这个测试**喂真快照**。
 *
 * ## 怎么跑
 *
 * `subagent-catalog.ts` 顶部 import 了 react（给 hook 用），而纯函数
 * `readSubagentCatalog` 不需要 react 的任何东西。这里用 esbuild 把它打成一个
 * 独立 bundle，react 用桩顶掉 —— 于是测的是**真源码**，不是复制粘贴的副本。
 *
 * Usage: node scripts/test-subagent-catalog.mjs
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

let failed = 0
function check(name, ok, detail) {
  if (ok) {
    console.log(`ok    ${name}`)
  } else {
    failed += 1
    console.error(`FAIL  ${name}${detail === undefined ? '' : `\n      ${detail}`}`)
  }
}

/* ── 把真源码打成可 import 的 bundle（react 用桩顶掉） ─────────────────── */

const scratch = mkdtempSync(join(tmpdir(), 'dsh-chat-plus-subs-'))
const stubPath = join(scratch, 'react-stub.mjs')
writeFileSync(stubPath, `
export const useEffect = () => {}
export const useMemo = (fn) => fn()
export const useRef = (value) => ({ current: value })
export const useState = (value) => [typeof value === 'function' ? value() : value, () => {}]
`)
const outPath = join(scratch, 'subagent-catalog.mjs')

const { build } = await import(pathToFileURL(resolve(ROOT, 'node_modules/esbuild/lib/main.js')).href)
await build({
  entryPoints: [resolve(ROOT, 'src/client/kr-chat/subagent-catalog.ts')],
  outfile: outPath,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  // client-ctx.ts 只用到 window/globalThis 防御式读，neutral 下原样留着即可。
  alias: { react: stubPath },
  logLevel: 'silent',
})

const { readSubagentCatalog, openSubagentSession } = await import(pathToFileURL(outPath).href)

/* ── 快照构造器：形状严格照 ISessions.list 的真实发布面 ───────────────── */

/**
 * @param options.parentId - 父会话 id。
 * @param options.catalog - 投影里的 `values.subagentCatalog`；`undefined` = 键存在但没这个值。
 * @param options.cellState - 投影 cell 的生命周期。
 * @param options.listRows - byId 里的行（用来验证「列表路」兜底）。
 */
function snapshot({ parentId = 'parent-1', catalog, cellState = 'idle', listRows = {} } = {}) {
  const byId = {
    [parentId]: { id: parentId, displayTitle: '父会话', running: true },
    ...listRows,
  }
  const cell = { state: cellState, error: null, values: {} }
  if (catalog !== undefined) cell.values.subagentCatalog = catalog
  return { ids: [parentId], byId, phase: 'ready', projectionsBySession: { [parentId]: cell } }
}

/* ── 1. 主路径：投影里有目录 → ready，且逐字段读对 ─────────────────────── */

{
  const snap = snapshot({
    catalog: [
      { id: 'child-a', createdAt: 1, mode: 'continuable', label: '独立核查通道替换完整性' },
      { id: 'child-b', createdAt: 2, mode: 'one-shot' },
      { id: 'child-c', createdAt: 3, mode: 'one-shot', label: '跑冒烟' },
    ],
    listRows: {
      // 官方 projectList() 会把目录里的 child 补进 byId，运行态只有这里有。
      'child-a': { id: 'child-a', parentId: 'parent-1', origin: 'subagent', running: true, displayTitle: '独立核查通道替换完整性' },
      'child-b': { id: 'child-b', parentId: 'parent-1', origin: 'subagent', running: false, displayTitle: '跑冒烟' },
      'child-c': { id: 'child-c', parentId: 'parent-1', origin: 'subagent', running: false, displayTitle: '跑冒烟' },
    },
  })
  const view = readSubagentCatalog(snap, 'parent-1')
  check('投影目录 → state=ready', view.state === 'ready', `got ${view.state}`)
  check('有几个就几行（3 条）', view.rows.length === 3, `got ${view.rows.length}`)
  check('running 从 byId 取（1 个在跑）', view.runningCount === 1, `got ${view.runningCount}`)
  check('doneCount = 总数 - 在跑', view.doneCount === 2, `got ${view.doneCount}`)
  check('label 取到了模型给的名字', view.rows[0].label === '独立核查通道替换完整性', view.rows[0].label)
  check('没 label 时回落到 id 前 8 位', view.rows[1].label === 'child-b', view.rows[1].label)
  check('mode 原样带出（continuable）', view.rows[0].mode === 'continuable', view.rows[0].mode)
  check('mode 原样带出（one-shot）', view.rows[1].mode === 'one-shot', view.rows[1].mode)
  check('parentSessionId 带上（跳转要用）', view.rows[0].parentSessionId === 'parent-1')
}

/* ── 2. 未加载 ≠ 确实为空（本轮修的核心语义） ──────────────────────────── */

{
  const unloaded = readSubagentCatalog(snapshot({ cellState: 'idle' }), 'parent-1')
  check('投影还没读过 → 不是 ready（旧版这里会一直装成"未加载"）', unloaded.state !== 'ready', unloaded.state)
  check('未读过 → rows 为空但不是 empty 结论', unloaded.rows.length === 0 && unloaded.state !== 'empty', unloaded.state)

  const loading = readSubagentCatalog(snapshot({ cellState: 'loading' }), 'parent-1')
  check('正在读 → state=loading', loading.state === 'loading', loading.state)

  const empty = readSubagentCatalog(snapshot({ catalog: [], cellState: 'ready' }), 'parent-1')
  check('读完了确实没有 → state=empty（这才是可以下结论的那种）', empty.state === 'empty', empty.state)

  const failed = readSubagentCatalog(snapshot({ cellState: 'error' }), 'parent-1')
  check('读取失败 → state=error（不当成"没有"）', failed.state === 'error', failed.state)
}

/* ── 3. 兜底路：投影没落地，但 byId 里已经有 origin=subagent 的行 ───────── */

{
  const snap = snapshot({
    cellState: 'idle',
    listRows: {
      'child-x': { id: 'child-x', parentId: 'parent-1', origin: 'subagent', running: true, displayTitle: '兜底路' },
      // 不是子智能体：fork 出来的子会话也有 parentId，靠 origin 排除。
      'fork-y': { id: 'fork-y', parentId: 'parent-1', origin: undefined, running: true, displayTitle: 'fork 出来的' },
      // 别人的孩子：parentId 不同。
      'other-z': { id: 'other-z', parentId: 'parent-9', origin: 'subagent', running: true, displayTitle: '别人的' },
    },
  })
  const view = readSubagentCatalog(snap, 'parent-1')
  check('投影未落地时用 byId 兜底 → ready', view.state === 'ready', view.state)
  check('兜底路只收本父会话的 origin=subagent', view.rows.length === 1 && view.rows[0].id === 'child-x',
    view.rows.map((r) => r.id).join(','))
  check('兜底路也能给出运行态', view.runningCount === 1, `got ${view.runningCount}`)
}

/* ── 4. 两路并存时按 id 去重（同一条子智能体不能出现两次） ─────────────── */

{
  const snap = snapshot({
    catalog: [{ id: 'child-a', createdAt: 1, mode: 'continuable', label: '投影里的' }],
    cellState: 'ready',
    listRows: {
      'child-a': { id: 'child-a', parentId: 'parent-1', origin: 'subagent', running: true, displayTitle: '列表里的' },
      'child-b': { id: 'child-b', parentId: 'parent-1', origin: 'subagent', running: false, displayTitle: '只在列表里' },
    },
  })
  const view = readSubagentCatalog(snap, 'parent-1')
  check('两路合并后按 id 去重（2 条，不是 3 条）', view.rows.length === 2, view.rows.map((r) => r.id).join(','))
  check('重复的那条以投影为准（label 来自 catalog）', view.rows.find((r) => r.id === 'child-a')?.label === '投影里的')
  check('只在列表里的那条也补上了', view.rows.some((r) => r.id === 'child-b'))
}

/* ── 5. 时长 / token：有投影就算，没有就不编 ───────────────────────────── */

{
  const now = 10_000
  const snap = snapshot({
    catalog: [{ id: 'child-a', createdAt: 1, mode: 'continuable', label: '在跑的' }],
    cellState: 'ready',
    listRows: {
      'child-a': {
        id: 'child-a', parentId: 'parent-1', origin: 'subagent', running: true, displayTitle: '在跑的',
        projectionValues: {
          subagentTiming: { settledMs: 1000, active: { since: 4000, through: 9000 } },
          tokenUsage: { uncachedInputTokens: 100, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 400 },
        },
      },
    },
  })
  const row = readSubagentCatalog(snap, 'parent-1', now).rows[0]
  check('时长 = settledMs + 本轮已跑（1000 + 6000）', row.elapsedMs === 7000, String(row.elapsedMs))
  check('token = 四个桶求和（1000）', row.tokens === 1000, String(row.tokens))

  const bare = readSubagentCatalog(
    snapshot({
      catalog: [{ id: 'child-a', createdAt: 1, mode: 'one-shot', label: 'x' }],
      cellState: 'ready',
    }),
    'parent-1',
    now,
  ).rows[0]
  check('没有投影就不编时长（undefined）', bare.elapsedMs === undefined, String(bare.elapsedMs))
  check('没有投影就不编 token（undefined）', bare.tokens === undefined, String(bare.tokens))
}

/* ── 6. 边界：没有父会话 id / 快照为空 / 形状不对，一律不抛 ─────────────── */

{
  for (const [name, snap, pid] of [
    ['父会话 id 为 null', snapshot({ catalog: [] }), null],
    ['父会话 id 为空串', snapshot({ catalog: [] }), ''],
    ['快照为 null', null, 'parent-1'],
    ['快照为 undefined', undefined, 'parent-1'],
    ['快照是空对象（旧宿主）', {}, 'parent-1'],
    ['byId 不是对象', { byId: 'oops', projectionsBySession: {} }, 'parent-1'],
    ['catalog 是字符串（形状漂了）', snapshot({ catalog: 'oops', cellState: 'ready' }), 'parent-1'],
  ]) {
    let view
    let threw = null
    try {
      view = readSubagentCatalog(snap, pid)
    } catch (error) {
      threw = error
    }
    check(`边界不抛：${name}`, threw === null && view !== null && view !== undefined && Array.isArray(view.rows),
      threw === null ? 'returned bad shape' : String(threw))
  }
}

/* ── 7. 跳转动作：拿不到 uiWorkspace 时返回 false，而不是假装成功 ───────── */

{
  const opened = []
  /*
   * client-ctx 读的是 `globalThis.__dshClientCtx__` —— 浏览器里 `globalThis` 就是
   * `window`，两者同一个对象；Node 里不是，所以这里**必须挂到 globalThis 上**，
   * 只挂 window 的话服务读不到，测出来的"跳转失败"是测试自己的问题。
   */
  globalThis.__dshClientCtx__ = {
    get(name) {
      if (name === 'uiWorkspace') return { openSession: (target) => { opened.push(target) } }
      if (name === 'sessions') return { subagentAddress: () => undefined }
      return undefined
    },
  }
  const row = { id: 'child-a', parentSessionId: 'parent-1', label: 'x', running: true, hasChildren: false, mode: 'continuable' }
  check('有 uiWorkspace 时跳转返回 true', openSubagentSession(row) === true)
  check('跳转带上了 durable address（父 + 子 + mode）',
    opened.length === 1 && opened[0].parentSessionId === 'parent-1'
    && opened[0].childSessionId === 'child-a' && opened[0].mode === 'continuable',
    JSON.stringify(opened))

  // 官方 subagentAddress 能解析时优先用它（它带的信息比我们拼的更权威）。
  const fromOfficial = []
  globalThis.__dshClientCtx__ = {
    get(name) {
      if (name === 'uiWorkspace') return { openSession: (target) => { fromOfficial.push(target) } }
      if (name === 'sessions') return { subagentAddress: () => ({ parentSessionId: 'official-parent', childSessionId: 'child-a', mode: 'one-shot' }) }
      return undefined
    },
  }
  openSubagentSession(row)
  check('官方地址可用时优先用官方解析结果',
    fromOfficial.length === 1 && fromOfficial[0].parentSessionId === 'official-parent',
    JSON.stringify(fromOfficial))

  globalThis.__dshClientCtx__ = { get: () => undefined }
  check('没有 uiWorkspace 时返回 false（不假装成功）', openSubagentSession(row) === false)
  delete globalThis.__dshClientCtx__
}

rmSync(scratch, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\nSUBAGENT CATALOG TEST FAILED — ${failed} 项`)
  process.exit(1)
}
console.log('\nSUBAGENT CATALOG TEST PASSED — 子智能体目录读法（真快照）')
