/**
 * dsh-chat-plus — 跨会话隔离行为测试。
 *
 * ## 为什么需要这个测试
 *
 * 2026-10-10 修「新对话还显示上个对话的任务概览」时，冒烟里加的断言全是
 * 「源码里有没有某个串」。变异测试证明它们判别力不足：把读取口的归属校验换成
 * `return liveTodos`（删掉校验、保留同名变量）后，所有正则断言照样全绿，而 bug
 * 原样复现。这类「删掉行为、保留形状」的缺陷只有真跑才能抓到。
 *
 * ## 为什么是「抽源码 + 求值」而不是「复刻一份模型」
 *
 * 第一版写的是复刻模型（把逻辑照抄进测试文件），结果**测的是模型不是源码** ——
 * 变异掉源码里的 todos 发布拦截后，模型里的拦截还在，测试照样通过（复刻漂移）。
 * 现在改成：从 `.ts` 源码里**抽出函数体**、剥掉类型注解，在 vm 里对着一组共享
 * 状态求值执行。测的就是源码本身，源码怎么改、测试就怎么跑。
 *
 * 抽取方式对格式敏感（依赖函数签名形态），所以最后有一组断言钉住「抽到的函数体
 * 里确实含关键判定式」，抽取失败会立刻报错而不是静默跳过。
 *
 * Usage: node scripts/test-session-isolation.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)
const need = (cond, msg) => (cond ? pass(msg) : fail(msg))

const shadowSrc = readFileSync(resolve(ROOT, 'src/client/tool-summary/TurnProcessShadowView.tsx'), 'utf8')
const bridgeSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/kr-todo-bridge.ts'), 'utf8')
const panelSrc = readFileSync(resolve(ROOT, 'src/client/kr-chat/KrAgentPanel.tsx'), 'utf8')

/**
 * 剥掉 TS 类型注解（只处理被测函数用到的几种形态）。
 *
 * **刻意不剥泛型** `<...>`：那个正则（`<[^<>()]*>`）会误伤比较运算符
 * （`changed < 0`、`a <= b`），把代码改成语义完全不同的东西——比类型残留更危险。
 * 被测的这几个函数不含泛型调用，真遇到就让它报错，比悄悄改坏强。
 */
function stripTypes(code) {
  return code
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/export /g, '')
    .replace(/readonly /g, '')
    // 可选参数/属性：`sessionId?: string | null` → 先吃掉 `?`
    .replace(/([A-Za-z_$][\w$]*)\?\s*:/g, '$1:')
    // 参数/返回处的类型注解：`id: string | null`、`todos: X[]`、`: void`
    .replace(/:\s*[A-Za-z_$][\w$.]*(?:\s*(?:\||&)\s*(?:[A-Za-z_$][\w$.]*|null|undefined|'[^']*'))*(?:\[\])?(?=\s*[,)=;{])/g, '')
    .replace(/\s+as\s+(?:const|unknown|any|string|number)/g, '')
}

/** 从源码里抽出一个具名函数（含函数体），失败返回 null。 */
function extractFn(src, name) {
  const re = new RegExp(`(?:export )?function ${name}\\s*\\([^)]*\\)[^{]*\\{`)
  const m = re.exec(src)
  if (m === null) return null
  let depth = 0
  let i = m.index + m[0].length - 1
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return stripTypes(src.slice(m.index, i + 1))
}

/** 从源码里抽出一个 const 箭头函数/赋值（用于 const X = (…) => …）。 */
function extractConstFn(src, name) {
  const re = new RegExp(`(?:export )?const ${name}\\s*=\\s*`)
  const m = re.exec(src)
  if (m === null) return null
  const rest = src.slice(m.index)
  const end = rest.indexOf('\n}\n')
  if (end < 0) return null
  return stripTypes(rest.slice(0, end + 2))
}

/*
 * ── 构造一个只含「源码抽出的函数 + 共享状态」的沙箱 ──────────────────────
 *
 * 状态变量（latestChatSnapshot / latestChatSnapshotOwner / latestChatSessionId /
 * liveTodos / liveTodosOwner）按源码里的语义声明在沙箱顶层，抽出的函数直接读写
 * 它们 —— 与真实模块的模块级变量行为一致。
 */
function makeSandbox() {
  const state = {
    latestChatSnapshot: null,
    latestChatSnapshotOwner: null,
    latestChatSessionId: null,
    liveTodos: [],
    liveTodosOwner: null,
    listeners: new Set(),
    notifyCount: 0,
  }
  const listeners = new Set()
  /*
   * `context` 由 createContext 返回，而下面的替身要回调它 —— 用 let 先声明再赋值，
   * 避免在对象字面量里引用尚未初始化的 const（TDZ）。
   */
  let context
  const syncClearToSandbox = () => {
    try {
      vm.runInContext('liveTodos = __state.liveTodos; liveTodosOwner = __state.liveTodosOwner', context)
    } catch { /* 沙箱尚未就绪（构造期）时忽略 */ }
  }
  context = vm.createContext({
    console,
    Set,
    Array,
    Object,
    JSON,
    __state: state,
    __listeners: listeners,
    /*
     * resetSessionCaches 替身：真实源码里它清 liveTodos / activityStore / 选中轮次。
     *
     * 它跑在 vm 外，改不了 vm 内的模块级变量，所以清完 __state 后把沙箱变量同步
     * 过来。注意不能用 `typeof __applyClear === 'function'` 探测沙箱内函数 ——
     * vm 内 function 声明在脚本作用域，外部 context 对象上看不到（实测恒 false，
     * 于是清空静默失效、断言假失败）。
     */
    scheduleNotify: () => { state.notifyCount += 1 },
    resetSessionCaches: () => {
      state.liveTodos = []
      state.liveTodosOwner = null
      syncClearToSandbox()
    },
    clearLiveDshTodos: () => {
      state.liveTodos = []
      state.liveTodosOwner = null
      syncClearToSandbox()
    },
    getLatestChatSessionId: () => state.latestChatSessionId,
  })

  /*
   * `getLatestChatSessionId` **必须在这里**，不能只靠 context 上的同名替身。
   *
   * 沙箱变量与 `__state` 是两份副本：沙箱内的 `latestChatSessionId` 只在 `__sync()`
   * （即每次 read()）时才回写 `__state`。而 context 替身读的是 `state.latestChatSessionId`
   * ——陈旧值。`setLiveDshTodos` 里 `liveTodosOwner = getLatestChatSessionId()` 若走到
   * 替身，就会把 owner 记成「上一次 sync 时的会话」，于是紧随其后的读取口归属校验
   * 判成跨会话、返回空数组：场景 4「切到 B2 后读 B2 的 todos」就是这么假失败的
   * （源码行为正确，测试却报红）。
   *
   * 抽出来放进来后，函数声明覆盖 context 属性，沙箱内调用读的就是沙箱变量本身 ——
   * 与真实模块里「同一份模块级变量」的语义一致。
   */
  const shadowFns = [
    extractFn(shadowSrc, 'setLatestChatSessionId'),
    extractFn(shadowSrc, 'getLatestChatSessionId'),
    extractFn(shadowSrc, 'clearLatestChatSnapshot'),
    extractFn(shadowSrc, 'getCurrentChatSnapshot'),
    extractFn(shadowSrc, 'leaveCurrentChatSession'),
    extractFn(shadowSrc, 'setLatestChatSnapshot'),
  ]
  const bridgeFns = [
    extractFn(bridgeSrc, 'getLiveDshTodos'),
    extractFn(bridgeSrc, 'setLiveDshTodos'),
    extractFn(bridgeSrc, 'clearLiveDshTodos'),
  ]
  if (shadowFns.some(f => f === null)) return { error: `TurnProcessShadowView 抽取失败：${shadowFns.map((f, i) => f === null ? i : null).filter(v => v !== null)}` }
  if (bridgeFns.some(f => f === null)) return { error: 'kr-todo-bridge 抽取失败' }

  /*
   * 沙箱顶层变量即源码里的模块级变量；`__sync()` 把它们写回 __state 供断言读取，
   * `__pull()` 把 __state 的值拉回沙箱变量（供 resetSessionCaches 替身清空后生效）。
   */
  const source = `
    var latestChatSnapshot = __state.latestChatSnapshot
    var latestChatSnapshotOwner = __state.latestChatSnapshotOwner
    var latestChatSessionId = __state.latestChatSessionId
    var liveTodos = __state.liveTodos
    var liveTodosOwner = __state.liveTodosOwner
    var listeners = __listeners
    ${shadowFns.join('\n')}
    ${bridgeFns.join('\n')}
    function __sync() {
      __state.latestChatSnapshot = latestChatSnapshot
      __state.latestChatSnapshotOwner = latestChatSnapshotOwner
      __state.latestChatSessionId = latestChatSessionId
      __state.liveTodos = liveTodos
      __state.liveTodosOwner = liveTodosOwner
    }
    function __pull() {
      liveTodos = __state.liveTodos
      liveTodosOwner = __state.liveTodosOwner
    }
    /*
     * 反向同步：外部替身（resetSessionCaches / clearLiveDshTodos）清空了 __state 后，
     * 把清空结果推进沙箱变量 —— 它们改不了 vm 内的模块级变量。
     */
    function __applyClear() {
      liveTodos = []
      liveTodosOwner = null
    }
    /*
     * __read 走**真实的读取函数**（getCurrentChatSnapshot / getLiveDshTodos），
     * 而不是直接看内部变量。
     *
     * 这一点很关键：写入被拦截时内部变量不会更新，直接读它会得出与用户实际所见
     * 不一致的结论（实测踩过：源码行为完全正确，测试却报失败，因为断言读的是
     * 内部变量而非读取口）。用户看到的就是读取口的返回值。
     */
    function __read() {
      __sync()
      var __vis = getCurrentChatSnapshot()
      var __live = getLiveDshTodos()
      return {
        visibleSnapshot: __vis,
        liveCount: __live.length,
        liveFirst: __live.length > 0 ? __live[0].content : null,
        snapshot: latestChatSnapshot,
        owner: latestChatSnapshotOwner,
        sessionId: latestChatSessionId,
        liveTodos: liveTodos,
        liveOwner: liveTodosOwner,
      }
    }
  `
  try {
    vm.runInContext(source, context)
  } catch (error) {
    return { error: `沙箱求值失败：${error.message}` }
  }
  return { context, state }
}

const built = makeSandbox()
if (built.error !== undefined) {
  fail(`无法从源码抽取被测函数：${built.error}`)
  console.log('\nSESSION ISOLATION TEST FAILED — 抽取失败（测试本身失效，不是功能问题）')
  process.exit(1)
}

const run = (expr) => vm.runInContext(expr, built.context)
const read = () => run('__read()')

/**
 * 场景间重置全部模块级状态。
 *
 * 必须显式重置：这些变量是**模块级**的，跨场景会互相污染 —— 实测踩过，
 * 前一个场景留下的 liveTodosOwner 会让后一个场景的「owner 尚未确立」判断失效，
 * 断言假失败（而且失败原因看起来像功能缺陷，极难排查）。
 */
function resetAll() {
  run(`
    latestChatSnapshot = null
    latestChatSnapshotOwner = null
    latestChatSessionId = null
    liveTodos = []
    liveTodosOwner = null
    __sync()
  `)
}

/**
 * 复刻 KrTodoBridge 三个 effect 的判定（含发布指纹）。
 *
 * 这是用户实际遇到误发的那条路径：切会话时 effect 用**旧引用 + 新 id** 重跑。
 * 两条发布路径**各记各的会话 id**（snapSessionId / todosSessionId）—— 共用一份
 * 会让先跑的 effect 把后跑的判据污染掉（源码注释里有说明）。
 */
function publish(snapExpr, todosExpr, sid) {
  run(`
    if (__state.__last === undefined) __state.__last = null
    var __sid = ${JSON.stringify(sid)}
    var __snap = ${snapExpr}
    var __todos = ${todosExpr}
    var __L = __state.__last

    // effect([snap, sessionId])
    if (__snap !== undefined && __snap !== null) {
      var __skipSnap = __L !== null && __L.snapSessionId !== __sid && __L.snap === __snap
      if (__skipSnap) {
        __state.__last = { sessionId: __sid, snap: __L.snap, todos: __L.todos, snapSessionId: __sid, todosSessionId: __L.todosSessionId }
      } else {
        __state.__last = {
          sessionId: __sid, snap: __snap,
          todos: __L !== null ? __L.todos : null,
          snapSessionId: __sid,
          todosSessionId: __L !== null ? __L.todosSessionId : null
        }
        setLatestChatSnapshot(__snap, __sid)
      }
    }

    // effect([todos, sessionId])
    var __L2 = __state.__last
    var __skipTodos = __L2 !== null && __L2.todosSessionId !== __sid && __L2.todos === __todos
    if (__skipTodos) {
      __state.__last = { sessionId: __sid, snap: __L2.snap, todos: __todos, snapSessionId: __L2.snapSessionId, todosSessionId: __sid }
    } else {
      __state.__last = {
        sessionId: __sid,
        snap: __L2 !== null ? __L2.snap : null,
        todos: __todos,
        snapSessionId: __L2 !== null ? __L2.snapSessionId : null,
        todosSessionId: __sid
      }
      setLiveDshTodos(__todos, __sid)
    }
  `)
}

console.log('── 0. 抽取有效性（测试必须真的在跑源码，不是复刻）──')
{
  /*
   * 注意：不能拿 `typeof fn` 判存在 —— vm 里函数声明在脚本作用域，跨 runInContext
   * 调用时 typeof 查不到（实测全部 false，而函数其实都在）。改成「能不能真的调用
   * 并产生预期副作用」，这才是有效判据。
   */
  run(`__probe = (function () {
    try {
      setLatestChatSessionId('__probe__')
      var ok1 = latestChatSessionId === '__probe__'
      setLatestChatSessionId(null)
      return { ok: ok1, kind: typeof setLatestChatSnapshot }
    } catch (e) { return { ok: false, err: String(e) } }
  })()`)
  const probe = run('__probe')
  need(probe.ok === true, `setLatestChatSessionId 可调用并生效（${JSON.stringify(probe)}）`)
  need(probe.kind === 'function', 'setLatestChatSnapshot 是函数')

  // 逐个真调一次，确认抽到的都是可用函数（不是空壳）
  const callable = run(`__probe2 = (function () {
    try {
      var names = []
      if (typeof getCurrentChatSnapshot === 'function') names.push('getCurrentChatSnapshot')
      if (typeof leaveCurrentChatSession === 'function') names.push('leaveCurrentChatSession')
      if (typeof getLiveDshTodos === 'function') names.push('getLiveDshTodos')
      if (typeof setLiveDshTodos === 'function') names.push('setLiveDshTodos')
      if (typeof clearLiveDshTodos === 'function') names.push('clearLiveDshTodos')
      return names.join(',')
    } catch (e) { return 'ERR:' + String(e) }
  })()`)
  const got = String(callable).split(',').filter(Boolean)
  for (const n of ['getCurrentChatSnapshot', 'leaveCurrentChatSession', 'getLiveDshTodos', 'setLiveDshTodos', 'clearLiveDshTodos']) {
    need(got.includes(n), `从源码抽到并可调用 ${n}（真跑源码，非复刻）`)
  }

  // 钉住关键判定式确实在抽到的函数体里
  const snapFnBody = String(run('String(setLatestChatSnapshot)'))
  need(/latestChatSnapshotOwner\s*=\s*latestChatSessionId/.test(snapFnBody),
    '★ 抽到的 setLatestChatSnapshot 里 owner 记「已登记身份」')
  const liveFnBody = String(run('String(setLiveDshTodos)'))
  need(/liveTodosOwner\s*=\s*getLatestChatSessionId\(\)/.test(liveFnBody),
    '★ 抽到的 setLiveDshTodos 里 owner 记「已登记身份」')
  const getSnapBody = String(run('String(getCurrentChatSnapshot)'))
  need(/latestChatSnapshotOwner\s*===\s*latestChatSessionId/.test(getSnapBody),
    '★ 抽到的 getCurrentChatSnapshot 含归属比对')
  const getLiveBody = String(run('String(getLiveDshTodos)'))
  need(/liveTodosOwner\s*===\s*current/.test(getLiveBody),
    '★ 抽到的 getLiveDshTodos 含归属比对')
}

console.log('\n── 1. 用户报的 bug：新会话不该显示上一会话的任务概览 ──')
{
  resetAll()
  /*
   * 走**真实发布链路**（含发布指纹）：这是用户实际遇到的路径 —— 切会话时
   * KrTodoBridge 的两个 effect 用旧引用 + 新 id 重跑。
   *
   * 发布指纹是主防线：owner 兜底无法识别这种误发（旧数据贴新 id 与「新会话
   * 自己的第一份数据」形状相同，见源码注释）。
   */
  run(`setLatestChatSessionId('A')`)
  run(`__state.__snapA = ${JSON.stringify({ turn: 1, nodes: ['A的节点'] })}`)
  run(`__state.__todosA = [{ content: 'A 的任务', status: 'in_progress' }]`)

  publish('__state.__snapA', '__state.__todosA', 'A')
  need(read().visibleSnapshot === run('__state.__snapA'), '会话 A 内正常读到自己的快照')
  need(read().liveCount === 1, '会话 A 内正常读到自己的 liveTodos')

  // 切到 B：两个 effect 都用旧引用 + 新 id 重跑 —— 这就是误发时刻
  run(`setLatestChatSessionId('B')`)
  need(read().visibleSnapshot === null, '切到 B 后快照已清空')
  publish('__state.__snapA', '__state.__todosA', 'B')
  need(read().visibleSnapshot === null,
    '★ A 的旧快照以 B 的 id 误发被拦下（新会话不显示上一会话内容）')
  need(read().liveCount === 0,
    '★ A 的旧 todos 以 B 的 id 误发被拦下（任务概览不显示上个对话的清单）')

  // B 有了自己的数据（引用变化）→ 必须正常显示
  run(`__state.__snapB = ${JSON.stringify({ turn: 1, nodes: ['B的节点'] })}`)
  run(`__state.__todosB = [{ content: 'B 的任务', status: 'in_progress' }]`)
  publish('__state.__snapB', '__state.__todosB', 'B')
  need(read().visibleSnapshot === run('__state.__snapB'), '★ B 自己的快照正常显示（拦截不误杀合法发布）')
  need(read().liveCount === 1 && read().liveFirst === 'B 的任务', '★ B 自己的 todos 正常显示')
}

console.log('\n── 2. 读取口兜底：无身份时不得放行 ──')
{
  resetAll()
  /*
   * owner 能挡的是**这一种**：身份已注销（离开会话 / 尚无会话）却还在读数据。
   *
   * 它**不能**挡「身份切了但数据没清干净」—— 那种状态与「新会话自己的第一份
   * 数据」形状完全相同，拦了会把后者一起拒掉，表现为新会话永远空白（比原 bug
   * 更严重，实测踩过）。跨会话误发的识别归发布点，由场景 1 覆盖。
   */
  run(`setLatestChatSessionId('A9')`)
  run(`__state.__s9 = { who: 'A9' }`)
  run(`__state.__t9 = [{ content: 'A9 的任务', status: 'in_progress' }]`)
  publish('__state.__s9', '__state.__t9', 'A9')
  need(read().visibleSnapshot === run('__state.__s9'), 'A9 会话内正常读到数据')
  need(read().liveCount === 1, 'A9 会话内正常读到 todos')

  // 注销身份（离开会话）：此后不得再读到任何数据
  run(`leaveCurrentChatSession()`)
  need(read().visibleSnapshot === null, '★ 身份注销后读不到快照（无身份不放行）')
  need(read().liveCount === 0, '★ 身份注销后读不到 todos')
}

console.log('\n── 3. 同会话内正常更新不受影响 ──')
{
  resetAll()
  run(`setLatestChatSessionId('S')`)
  run(`__state.__s1 = { v: 1 }; __state.__s2 = { v: 2 }; __state.__s3 = { v: 3 }`)
  run(`setLatestChatSnapshot(__state.__s1, 'S')`)
  run(`setLatestChatSnapshot(__state.__s2, 'S')`)
  run(`setLatestChatSnapshot(__state.__s3, 'S')`)
  need(read().visibleSnapshot === run('__state.__s3'), '同会话连续更新全部生效')
}

console.log('\n── 4. 切回历史会话能正常读到内容 ──')
{
  resetAll()
  run(`setLatestChatSessionId('A2')`)
  run(`__state.__sa = { who: 'A2' }`)
  run(`__state.__ta2 = [{ content: 'A2 的任务', status: 'pending' }]`)
  publish('__state.__sa', '__state.__ta2', 'A2')
  need(read().liveFirst === 'A2 的任务', 'A2 会话内读到自己的 todos')

  run(`setLatestChatSessionId('B2')`)
  run(`__state.__sb = { who: 'B2' }`)
  run(`__state.__tb2 = [{ content: 'B2 的任务', status: 'pending' }]`)
  publish('__state.__sb', '__state.__tb2', 'B2')
  need(read().visibleSnapshot === run('__state.__sb'), '切到 B2 后读到 B2 的内容')
  need(read().liveFirst === 'B2 的任务', '切到 B2 后读到 B2 的 todos')

  // 切回 A2：useChat/useProjection 会给出 A2 的对象（引用变化）
  run(`setLatestChatSessionId('A2')`)
  publish('__state.__sa', '__state.__ta2', 'A2')
  need(read().visibleSnapshot === run('__state.__sa'), '切回 A2 后读到 A2 的快照')
  need(read().liveFirst === 'A2 的任务', '切回 A2 后读到 A2 的 liveTodos')
}

console.log('\n── 5. 点「新会话」（统一离开口）清干净 ──')
{
  resetAll()
  // 先在 C 会话里产生数据（建立发布指纹）
  run(`setLatestChatSessionId('C')`)
  run(`__state.__snapC = { who: 'C' }`)
  run(`__state.__todosC = [{ content: 'C 的任务', status: 'in_progress' }]`)
  publish('__state.__snapC', '__state.__todosC', 'C')
  need(read().liveCount === 1, 'C 会话内正常读到自己的 todos')

  // 点「新会话」→ 统一离开口
  run(`leaveCurrentChatSession()`)
  const s = read()
  need(s.snapshot === null, '离开后快照为空')
  need(s.liveTodos.length === 0, '离开后 liveTodos 为空')
  need(s.sessionId === null, '离开后会话身份为 null')

  // 离开后紧接着的误发：走真实发布链路（含发布指纹），旧引用 + 新 id
  run(`setLatestChatSessionId('NEW')`)
  publish('__state.__snapC', '__state.__todosC', 'NEW')
  need(read().visibleSnapshot === null, '★ 离开后旧快照以新会话 id 误发被拦下')
  need(read().liveCount === 0, '★ 离开后旧 todos 以新会话 id 误发被拦下')
}

console.log('\n── 6. 无参发布（截图/思考视图）──')
{
  resetAll()
  run(`setLatestChatSessionId('N1')`)
  run(`__state.__n1 = { v: 1 }; __state.__n2 = { v: 2 }`)
  run(`setLatestChatSnapshot(__state.__n1, 'N1')`)
  run(`setLatestChatSnapshot(__state.__n2)`)
  need(read().visibleSnapshot === run('__state.__n2'), '无参发布在同会话内正常生效（不误杀）')
}

console.log('\n── 7. 源码一致性（防抽取漂移 / 防消费方绕道）──')
{
  need(/export function getCurrentChatSnapshot/.test(shadowSrc), '源码导出带归属校验的快照读取口')
  need(/export function leaveCurrentChatSession/.test(shadowSrc), '源码提供统一离开口')
  /*
   * 字段名与分隔符必须与源码逐字一致：TS 类型字面量里字段是**换行分隔、不带分号**的，
   * 早先这里按 `snapSessionId: string | null;` 匹配（带分号）——源码改成双指纹后
   * 这条正则再也匹配不上，于是「行为对、断言红」地卡住构建。
   */
  need(/const lastPublishRef = useRef<\{[\s\S]{0,200}snapSessionId: string \| null[\s\S]{0,80}todosSessionId: string \| null[\s\S]{0,40}\} \| null>\(null\)/.test(bridgeSrc),
    '源码含发布指纹 ref（两条路径各记各的 sessionId + 数据引用）')
  need(/prev\.snapSessionId !== sessionId && prev\.snap === snap/.test(bridgeSrc),
    '源码快照发布点按「该路 sessionId 变 + 引用未变」拦截')
  need(/prev\.todosSessionId !== sessionId && prev\.todos === todos/.test(bridgeSrc),
    '源码 todos 发布点按「该路 sessionId 变 + 引用未变」拦截（共用一份指纹会互相污染）')
  need(/prev\.todosSessionId !== sessionId && prev\.todos === todosRef\.current/.test(bridgeSrc),
    '源码身份登记回填也做同样拦截')
  need(/if \(getLatestChatSessionId\(\) === sessionId\) leaveCurrentChatSession\(\)/.test(bridgeSrc),
    '源码座位 cleanup 走统一离开口')

  // 消费方不得绕道：既不裸读全局变量，也不读 window 诊断镜像
  const windowMirrorReads = (panelSrc.match(/__dshLatestChatSnapshot__/g) ?? []).length
  need(windowMirrorReads === 0, `KrAgentPanel 不读 window.__dshLatestChatSnapshot__（实得 ${windowMirrorReads} 处）`)
  const directReads = (panelSrc.match(/=\s*latestChatSnapshot\b/g) ?? []).length
  need(directReads === 0, `KrAgentPanel 不把 latestChatSnapshot 直接赋值使用（实得 ${directReads} 处）`)
  need(/getCurrentChatSnapshot\(\)/.test(panelSrc), 'KrAgentPanel 走带归属校验的快照读取口')
  need(/if \(latestChatSessionId === null\) return EMPTY_TURN_DATA/.test(panelSrc),
    'KrAgentPanel 无会话身份时不回退 actStore')
}

console.log(`\n${process.exitCode ? 'SESSION ISOLATION TEST FAILED' : 'SESSION ISOLATION TEST PASSED'} — 跨会话数据不得串台`)
process.exit(process.exitCode ?? 0)
