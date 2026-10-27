/**
 * dsh-chat-plus — 「系统提示词」观测冒烟（纯判据 + 假实现驱动路由）。
 *
 * 这一组断言盯的全是「错了也不抛错」的地方，所以必须能对拍：
 *  1. 渲染必须与官方 renderPrompt 同口径（逐段插值 → 丢空 → 两换行拼接），
 *     差一两个空行不会报错，但页面显示的就与模型收到的不是同一份；
 *  2. 变量插值遇到坏引用必须原样保留并登记名字（官方会抛错，观测不能抛）；
 *  3. 运行时上下文是 user 消息、不是 system 的一部分，两段必须分开；
 *  4. 内存表按「最久未更新」淘汰，且会话数有上限（否则开几百个会话就吃满内存）；
 *  5. 路由：有缓存回缓存、没缓存问现场组装、都不行如实给原因；跨站必须 403；
 *  6. 工具体积按整份 schema 算（只算名字会把「工具占多少上下文」说小一个数量级）。
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/*
 * host 产物是普通 ESM，直接 import；观测模块的纯函数与 handler 都从 __test 出。
 * 这样跑的是构建后真正会装进运行时的那份代码，不是源码副本。
 */
const toUrl = (rel) => new URL(rel, 'file:///' + ROOT.replace(/\\/g, '/') + '/').href
const host = await import(toUrl('lib/index.js'))

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

const test = host.systemPromptTest
if (test === undefined) {
  console.log('FAIL  host 未导出 systemPromptTest（可测面缺失）')
  process.exit(1)
}

console.log('[system-prompt] 渲染与官方 renderPrompt 同口径')
{
  const rendered = test.renderPromptEntries(
    [
      { name: 'a', text: 'first' },
      { name: 'b', text: '' },
      { name: 'c', text: 'second' },
      { name: 'd', text: 'literal', interpolate: false },
    ],
    {},
  )
  // 官方判据是「渲染后 length === 0 才丢弃」，不是「空白就丢弃」——空白段在
  // 真实请求里同样会留下那两个换行，观测若自作聪明 trim 掉，页面看到的段数
  // 就会与模型收到的不一致。
  check('空串段被丢弃（不是渲染成空行）', rendered.sections.length === 3, JSON.stringify(rendered.sections.map((s) => s.name)))
  check('段之间用两个换行拼接', rendered.text === 'first\n\nsecond\n\nliteral', JSON.stringify(rendered.text))
  check('interpolate:false 的段原样保留', rendered.sections[2].interpolated === false)

  const undef = test.renderPromptEntries([{ name: 'x', text: undefined }], {})
  check('text 不是字符串时按空段丢弃（不抛）', undef.sections.length === 0)
}

console.log('[system-prompt] 变量插值')
{
  const ok = test.interpolatePromptText('model is {{model}} / {{provider}}', { model: 'm1', provider: 'p1' })
  check('已注册变量被替换', ok.text === 'model is m1 / p1', ok.text)
  check('全部解析成功时没有未解析项', ok.unresolved.length === 0)

  const bad = test.interpolatePromptText('a {{missing}} b {{ALLCAPS}} c {{ }} d', {})
  check('未注册变量原样保留（不抛、不吞）', bad.text.includes('{{missing}}'), bad.text)
  check('未解析变量名被登记', bad.unresolved.includes('missing'), JSON.stringify(bad.unresolved))
  check('不合法的引用形态不动（大写 / 空格不算变量）', bad.text.includes('{{ALLCAPS}}') && bad.text.includes('{{ }}'))

  const undefVal = test.interpolatePromptText('{{model}}', { model: undefined })
  check('变量存在但值为 undefined 时也算未解析', undefVal.unresolved.includes('model') && undefVal.text === '{{model}}')
}

console.log('[system-prompt] 运行时上下文与 system 分开')
{
  const ctx = test.renderContextSnapshot([{ name: 'cwd', text: 'cwd is D:/x', interpolate: false }], {})
  check('上下文带官方那行前言', ctx.text.startsWith('Current runtime context.'), ctx.text.slice(0, 40))
  check('上下文正文在两行之后', ctx.text.includes('cwd is D:/x'))
  const empty = test.renderContextSnapshot([], {})
  check('没有上下文时为空串（不写前言）', empty.text === '')
}

console.log('[system-prompt] 快照折叠')
{
  const snapshot = test.snapshotOf(
    {
      sections: [{ name: 'harness:identity', text: 'You are an agent.' }],
      contexts: [{ name: 'cwd', text: 'cwd D:/x', interpolate: false }],
      tools: [{ name: 'pwsh', description: 'shell', parameters: { type: 'object' } }],
      variables: { provider: 'magpie', model: 'm1', ignored: 42 },
    },
    { sessionId: 's1', cwd: 'D:/x', source: 'assemble' },
  )
  check('会话身份与来源落进快照', snapshot.sessionId === 's1' && snapshot.source === 'assemble')
  check('正文就是渲染后的 system 文本', snapshot.text === 'You are an agent.', snapshot.text)
  check('字符数与正文长度一致', snapshot.chars === snapshot.text.length)
  check('估算 token 为正整数', Number.isInteger(snapshot.tokens) && snapshot.tokens > 0)
  check('运行时上下文单独一份', snapshot.contextText.includes('cwd D:/x'))
  check('非字符串变量被过滤', snapshot.variables.length === 2, JSON.stringify(snapshot.variables))
  check('工具个数与名字齐全', snapshot.tools.count === 1 && snapshot.tools.names[0] === 'pwsh')
  const nameOnly = test.utf8Bytes('pwsh')
  check('工具体积按整份 schema 计（远大于名字）', snapshot.tools.bytes > nameOnly * 3, String(snapshot.tools.bytes))

  const emptySnap = test.snapshotOf(undefined, { sessionId: 's2', cwd: null, source: 'live' })
  check('空组装不抛、给出空正文', emptySnap.text === '' && emptySnap.sections.length === 0)
  check('空组装的工具数为 0', emptySnap.tools.count === 0)
}

console.log('[system-prompt] 会话 id 取值')
{
  check('优先取 session.id', test.sessionIdOfAgent({ id: 'a', session: { id: 'b' } }) === 'b')
  check('没有 session.id 时回落 agent.id', test.sessionIdOfAgent({ id: 'a' }) === 'a')
  check('两者都没有时返回 null（不编一个 id）', test.sessionIdOfAgent({}) === null)
  check('非对象返回 null', test.sessionIdOfAgent(null) === null && test.sessionIdOfAgent(undefined) === null)
}

console.log('[system-prompt] 内存表淘汰')
{
  test.resetSnapshotsForTests()
  const make = (id, at) => ({
    sessionId: id, cwd: null, at, source: 'assemble', text: 'x', chars: 1, tokens: 1,
    sections: [], contextText: '', contexts: [], variables: [],
    tools: { count: 0, bytes: 0, tokens: 0, names: [] }, truncated: false,
  })
  test.recordSnapshot(make('a', 1))
  test.recordSnapshot(make('b', 2))
  test.recordSnapshot(make('a', 3))
  const order = test.listSnapshotSummaries().map((s) => s.sessionId)
  check('更新过的会话排到最前（最近优先）', order.join(',') === 'a,b', order.join(','))
  check('重复写不会产生第二条', test.listSnapshotSummaries().length === 2)
  for (let i = 0; i < test.MAX_SESSIONS + 5; i += 1) test.recordSnapshot(make('s' + i, 10 + i))
  check('会话数封顶在 MAX_SESSIONS', test.listSnapshotSummaries().length === test.MAX_SESSIONS, String(test.listSnapshotSummaries().length))
  check('被淘汰的是最久未更新的那批', test.readSnapshot('a') === undefined && test.readSnapshot('b') === undefined)
  check('最新一条还在', test.readSnapshot('s' + (test.MAX_SESSIONS + 4)) !== undefined)
  test.resetSnapshotsForTests()
}

console.log('[system-prompt] 路由（假实现驱动）')
{
  const snap = {
    sessionId: 'live-1', cwd: 'D:/y', at: 1, source: 'live', text: 'T', chars: 1, tokens: 1,
    sections: [], contextText: '', contexts: [], variables: [],
    tools: { count: 0, bytes: 0, tokens: 0, names: [] }, truncated: false,
  }
  const makeRes = () => {
    const out = { status: 0, body: null }
    return {
      out,
      writeHead(status) { out.status = status },
      end(body) { out.body = JSON.parse(body) },
    }
  }
  const call = async (url, deps, headers = { host: '127.0.0.1:3080' }) => {
    const res = makeRes()
    test.handleSystemPromptRoute({ url, headers }, res, deps)
    // handler 内部是异步的（现场组装那条分支），让出一个宏任务再读。
    await new Promise((r) => setTimeout(r, 0))
    return res.out
  }

  const deps = {
    list: () => [{ sessionId: 'cached-1', cwd: null, at: 5, chars: 3, tools: 0, source: 'assemble' }],
    read: (id) => (id === 'cached-1' ? { ...snap, sessionId: 'cached-1', source: 'assemble' } : undefined),
    assemble: async (id) => ({ snapshot: id === 'live-1' ? snap : null, reason: id === 'live-1' ? undefined : '不是活会话' }),
  }

  const cached = await call('/api/chat-flow/system-prompt?session=cached-1', deps)
  check('有缓存时直接回缓存（不问现场组装）', cached.body.ok === true && cached.body.prompt.sessionId === 'cached-1')

  const live = await call('/api/chat-flow/system-prompt?session=live-1', deps)
  check('没缓存时现场组装', live.body.ok === true && live.body.prompt.source === 'live')

  const missing = await call('/api/chat-flow/system-prompt?session=gone', deps)
  check('查不到时 ok:false 且给出中文原因', missing.body.ok === false && typeof missing.body.reason === 'string' && missing.body.reason.length > 0)
  check('查不到时 prompt 为 null（不编一份假提示词）', missing.body.prompt === null)

  const latest = await call('/api/chat-flow/system-prompt', deps)
  check('不带 session 时回最近一次组装的那份', latest.body.ok === true && latest.body.prompt.sessionId === 'cached-1')
  check('会话列表随响应下发（供页面下拉）', Array.isArray(latest.body.sessions) && latest.body.sessions.length === 1)

  // fresh=1：跳过缓存直接现场组装。这是「刷新」按钮的语义——不带它的话，
  // 刷新对已有缓存的会话是一次空操作（用户看到时间戳没变，以为按钮坏了）。
  // 让假组装对 cached-1 也回一份 live 快照（真实宿主里活会话都能现场组装）。
  const freshDeps = { ...deps, assemble: async (id) => ({ snapshot: id === 'cached-1' ? { ...snap, sessionId: 'cached-1' } : null }) }
  const freshCall = await call('/api/chat-flow/system-prompt?session=cached-1&fresh=1', freshDeps)
  check('fresh=1 跳过缓存、现场组装（刷新真的会重算）', freshCall.body.ok === true && freshCall.body.prompt.source === 'live')

  // fresh 但活会话已不在本进程 → 回落缓存，而不是把页面清空。
  const staleDeps = { ...deps, assemble: async () => ({ snapshot: null, reason: '不是活会话' }) }
  const freshFallback = await call('/api/chat-flow/system-prompt?session=cached-1&fresh=1', staleDeps)
  check('fresh 组装不出来时回落缓存（不清空页面）', freshFallback.body.ok === true && freshFallback.body.prompt.sessionId === 'cached-1')

  const crossSite = await call('/api/chat-flow/system-prompt', deps, { host: '127.0.0.1:3080', origin: 'https://evil.example' })
  check('跨站请求 403（不让任意网页触发组装）', crossSite.status === 403 && crossSite.body.ok === false, String(crossSite.status))

  const throwing = { list: () => [], read: () => undefined, assemble: async () => { throw new Error('boom') } }
  const failed = await call('/api/chat-flow/system-prompt?session=x', throwing)
  check('现场组装抛错时不 500（如实回 ok:false）', failed.status === 200 && failed.body.ok === false)
}

console.log('[system-prompt] 分段分类（「详细」tab 的分组）')
{
  // 分类逻辑住在客户端 api.ts（纯逻辑、零 DOM），直接从源码 import 对拍 ——
  // 它判错了不会抛错，只会让「详细」页把某段归到「其它」或归错类。
  const clientApi = await import(toUrl('src/client/triad/system-prompt/api.ts'))

  const cases = [
    ['harness:identity', 'identity'],
    ['deployment:persona-prefix', 'identity'],
    ['team:policy', 'identity'],
    ['tools:ptc-only', 'tools'],
    ['tool:pwsh', 'tools'],
    ['tool:read', 'tools'],
    ['mcp:playwright-mcp', 'tools'],
    ['tools:sdk', 'tools'],
    ['tools-gate:offline', 'tools'],
    ['context:file-reference', 'context'],
    ['working-directory:current', 'context'],
    ['file-reference', 'context'],
    ['ui:deliverable-file-references', 'ui'],
    ['app:web-surface', 'ui'],
    ['harness:source', 'ui'],
    ['some:unknown-thing', 'other'],
  ]
  const wrong = cases.filter(([name, want]) => clientApi.sectionGroupOf(name) !== want)
  check('段名前缀 → 分类全部命中', wrong.length === 0, JSON.stringify(wrong))

  const mk = (name, chars) => ({ name, chars, text: 'x', interpolated: true, unresolved: [] })
  const grouped = clientApi.groupSections([
    mk('harness:identity', 48),
    mk('tool:pwsh', 259),
    mk('tool:read', 126),
    mk('ui:deliverable-file-references', 1304),
    mk('weird:segment', 10),
  ])
  check('分类按固定顺序出现（身份→工具→…→其它）', grouped.map((g) => g.id).join(',') === 'identity,tools,ui,other', grouped.map((g) => g.id).join(','))
  check('同类段被合并进一组', grouped[1].sections.length === 2, String(grouped[1].sections.length))
  check('分类字符数等于组内之和', grouped[1].chars === 385, String(grouped[1].chars))
  check('空类不出现（没有 context 段就没有 context 组）', !grouped.some((g) => g.id === 'context'))
  check('未知段名落进「其它」', grouped[3].sections[0].name === 'weird:segment')
  check('组内保持原始顺序', grouped[1].sections.map((s) => s.name).join(',') === 'tool:pwsh,tool:read')
}

console.log('[system-prompt] 路由常量与体积口径')
{
  check('路由常量与客户端一致', host.SYSTEM_PROMPT_ROUTE === '/api/chat-flow/system-prompt', host.SYSTEM_PROMPT_ROUTE)
  check('utf8Bytes 对多字节字符按字节计', test.utf8Bytes('中文') === 6, String(test.utf8Bytes('中文')))
  check('token 估算按 3.5 字节一个', test.estimateTokens(35) === 10, String(test.estimateTokens(35)))
}

if (failures > 0) {
  console.log('\nSYSTEM-PROMPT SMOKE FAILED — ' + failures + ' 项')
  process.exit(1)
}
console.log('\nSYSTEM-PROMPT SMOKE PASSED')
