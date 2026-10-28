/**
 * dsh-chat-plus — 个人动态（Feed）host 半身冒烟。
 *
 * 覆盖四块（对应 task-1 的完成标准 2）：
 *   1. **排序**：分天不穿插 + 组内**纯 createdAt 倒序**（用户要求「按时间排序即可」）；
 *   2. **单飞锁**：并发请求只跑 1 轮，其余 queued×1 + rejected×4；租约过期可回收；
 *   3. **删除**：软删后列表不出现、撤销后恢复、重启（新 store 实例）后仍不出现；
 *   4. **X 429 退避**：限流 → cooldownUntil = now+10min、本轮剩余账号跳过、
 *      解析（混合顺序重排 / id 集合去重 / 72 小时新鲜度切分）逐项对拍。
 *
 * 另有两组「不抛错但会错」的断言：HTTP 路由的两道闸门（loopback + 跨站）、
 * 以及路由必须真的挂在 /api/dsh-feed 前缀下并能返回 days 分组。
 *
 * 另外（2026-10-27 起）新增两组与「真实写作流水线」相关的断言：
 *   5. **真实 writer 的纯逻辑**：检索意图规划、来源清单（只有下标没有 URL）、
 *      JSON 容错解析、闸 2 的下标校验、URL 剥离 —— 全部不碰网络也不碰模型；
 *   6. **写作失败绝不产占位内容**：writer 抛错或返回 0 条时，本轮必须
 *      0 条帖子 + status='failed' + error 说明原因。
 *
 * 全部用**注入的假 fetch / 假时钟 / 0 延迟 sleep / 假 writer**：不打真实网络、
 * 不 sleep、不依赖运行时刻，所以在 CI 里也能跑。真实 writer 本身也支持注入
 * 假 web + 假 llm（见第 9 段），所以"整条流水线"同样能在无网络下测到。
 *
 * Usage: node scripts/smoke-feed.mjs
 */

import { createServer, request as httpRequest } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const fail = (msg) => { console.error('FAIL  ' + msg); process.exitCode = 1 }
const pass = (msg) => console.log('ok    ' + msg)
const assert = (cond, msg) => { if (cond) pass(msg); else fail(msg) }

/* ─────────────────────── 打包被测模块（用源码，不走 lib/index.js） ───────────────────────
 * 直接打 src/feed/*.ts：这样断言失败能指到源码行，而且不需要先跑 build.mjs。
 * 打成一个 entry（index.ts）就够了 —— 其余模块都由它传递导出？不够：
 * store/rank/sources/trigger/api 各自有大量纯函数要给冒烟直接调，
 * 所以逐个作为 entryPoint 打，各自产出 .mjs 后分别 import。
 */
const OUT_DIR = resolve(ROOT, '_tmp', 'smoke-feed-bundle')
try { rmSync(OUT_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }
mkdirSync(OUT_DIR, { recursive: true })

const ENTRIES = ['types', 'store', 'rank', 'sources', 'trigger', 'api', 'index', 'writer', 'models', 'incremental', 'entities']
await build({
  entryPoints: ENTRIES.map(name => resolve(ROOT, 'src/feed', name + '.ts')),
  outdir: OUT_DIR,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outExtension: { '.js': '.mjs' },
  logLevel: 'silent',
  // 每个 entry 打成自包含（互相之间会重复内联一份），避免跨 entry 的相对 import 解析失败。
  splitting: false,
})

const load = async (name) => await import(pathToFileURL(join(OUT_DIR, name + '.mjs')).href)
const types = await load('types')
const rank = await load('rank')
const sources = await load('sources')
const trigger = await load('trigger')
const writerMod = await load('writer')
const modelsMod = await load('models')
const incMod = await load('incremental')

/* 每个测试组用独立的 DSH_HOME，绝不碰用户真实数据。 */
const HOME_A = resolve(ROOT, '_tmp', 'smoke-feed-home-a')
const HOME_B = resolve(ROOT, '_tmp', 'smoke-feed-home-b')
for (const home of [HOME_A, HOME_B]) {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(home, { recursive: true })
}
process.env.DSH_HOME = HOME_A

console.log('\n=== 1. 排序：先分天、组内纯 createdAt 倒序 ===');

/* 固定时钟：2026-10-27 20:00 本地时间。用本地时间构造，避免时区把「今天」推走。 */
const NOW = new Date(2026, 9, 27, 20, 0, 0).getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** 造一条帖子（只填排序关心的字段）。 */
function post(over) {
  return {
    id: over.id,
    createdAt: over.createdAt ?? NOW,
    topics: over.topics ?? ['mine'],
    title: over.title ?? over.id,
    body: 'body',
    sources: [],
    dueAt: over.dueAt ?? 0,
    dueLabel: '',
    likes: 0,
    comments: [],
    runId: 'r_1',
    promptHash: 'h',
    ...(over.readAt !== undefined ? { readAt: over.readAt } : {}),
    ...(over.deletedAt !== undefined ? { deletedAt: over.deletedAt } : {}),
  }
}
/* ── 1.1 分天不穿插：分组与排序是两件事，混在一起就会穿插 ──
 * 构造一个「昨天的截止更近」的输入：如果按「组内排序结果直接拼起来」，
 * 昨天那条会插到今天两条中间；分天之后它必须整块待在昨天组里。
 * （2026-10-27 排序改成纯时间倒序后这条依然成立 —— 它测的是**分组**，
 *  与组内排序键无关；保留它是因为分组逻辑本身没变、也不能变。）
 */
{
  const yesterdayDue = post({ id: 'y_due', createdAt: NOW - 1.2 * DAY, dueAt: NOW + 1 * HOUR })
  const todayOld = post({ id: 't_old', createdAt: NOW - 2 * HOUR })
  const todayNew = post({ id: 't_new', createdAt: NOW - 1 * HOUR })
  const sorted = rank.sortFeedPosts([yesterdayDue, todayOld, todayNew], NOW)
  const ids = sorted.map(item => item.id)
  // 要点不在今天那两条谁先（都是纯时间倒序的结果），而在**昨天那条必须
  // 整块排在后面**（哪怕它截止更近）。
  assert(JSON.stringify(ids) === JSON.stringify(['t_new', 't_old', 'y_due']),
    '分天不穿插：今天的两条全部排在昨天那条之前（哪怕昨天那条截止更近），实得 ' + JSON.stringify(ids))

  const groups = rank.groupFeedPosts([yesterdayDue, todayOld, todayNew], NOW)
  assert(groups.length === 3, '分组恒为 3 组（today / yesterday / older，空组也返回）')
  assert(groups[0].key === 'today' && groups[0].posts.length === 2, '第一组是「今天」且含 2 条')
  assert(groups[1].key === 'yesterday' && groups[1].posts.length === 1, '第二组是「昨天」且含 1 条')
  assert(groups[2].key === 'older' && groups[2].posts.length === 0, '第三组是「更早」且为空')

  // 三组之间的顺序绝不能因为组内排序而变（组间顺序由 FEED_DAY_ORDER 固定）。
  const many = [
    post({ id: 'o1', createdAt: NOW - 10 * DAY, dueAt: 0 }),
    post({ id: 't1', createdAt: NOW - 1 * HOUR, dueAt: 0 }),
    post({ id: 'y1', createdAt: NOW - 1.5 * DAY, dueAt: 0 }),
    post({ id: 't2', createdAt: NOW - 3 * HOUR, dueAt: NOW + 5 * HOUR }),
  ]
  const daySeq = rank.sortFeedPosts(many, NOW).map(item => rank.dayKeyOf(item.createdAt, NOW))
  const compact = daySeq.join(',')
  const okSeq = compact === 'today,today,yesterday,older'
  assert(okSeq, '天分组序列单调（today → yesterday → older，绝不回头），实得 ' + compact)
}

/* ── 1.2 组内排序：**纯 createdAt 倒序**（用户要求「按时间排序即可」）── */
{
  /*
   * ⚠ 这一组在 2026-10-27 被**整段重写**。原来是三级优先级断言（过期沉底 /
   * 未读优先 / 截止临近升序），那三组断言断言的是一种**已被否决**的行为：
   *
   *   真实数据上的缺陷 —— 第 ③ 级用 dueAt 绝对值、无截止用 Infinity，
   *   于是任何带截止的帖子都无条件压过没有截止的，哪怕它更旧。
   *   用户看到的是「刚生成的新动态排到了旧内容下面」。
   *
   * 现在排序键只剩 createdAt。所以这里断言的是**排序与 dueAt / readAt 无关**，
   * 而这恰恰是旧实现做不到、也最容易在重构时被无意带回来的一条属性。
   */

  // ① 纯时间倒序：两条都无截止、都未读时，新的在前（基线）。
  const older = post({ id: 'o', createdAt: NOW - 8 * HOUR })
  const newer = post({ id: 'n', createdAt: NOW - 2 * HOUR })
  const order4 = rank.sortFeedPosts([older, newer], NOW).map(item => item.id)
  assert(JSON.stringify(order4) === JSON.stringify(['n', 'o']),
    '纯时间倒序：新的在上，实得 ' + JSON.stringify(order4))

  // ② 过期 ≠ 沉底：过期但**更新**的那条仍然在前。
  const expired = post({ id: 'expired', createdAt: NOW - 1 * HOUR, dueAt: NOW - 30 * 60000 })
  const normal = post({ id: 'normal', createdAt: NOW - 5 * HOUR })
  const order = rank.sortFeedPosts([expired, normal], NOW).map(item => item.id)
  assert(JSON.stringify(order) === JSON.stringify(['expired', 'normal']),
    '过期不沉底：排序只看时间，过期但更新的那条仍在前面，实得 ' + JSON.stringify(order))

  // ③ 已读 ≠ 沉底：已读但**更新**的那条仍然在前。
  const read = post({ id: 'read', createdAt: NOW - 1 * HOUR, readAt: NOW - 30 * 60000 })
  const unread = post({ id: 'unread', createdAt: NOW - 6 * HOUR })
  const order2 = rank.sortFeedPosts([read, unread], NOW).map(item => item.id)
  assert(JSON.stringify(order2) === JSON.stringify(['read', 'unread']),
    '已读不沉底：排序只看时间，已读但更新的那条仍在前面，实得 ' + JSON.stringify(order2))

  /*
   * ④ ⭐ 本次缺陷的回归断言：**旧帖带 dueAt + 新帖无 dueAt → 新帖必须在前**。
   *
   * 这正是真实服务上复现的那个 bug（Lead 实测的 17 条数据里位置 0/1 就是它）：
   * 旧帖有截止、新帖没有，旧优先级实现把 dueAt=0 当成 Infinity 排到最后，
   * 于是旧帖压过了刚生成的新帖。
   */
  const oldWithDue = post({ id: 'old_due', createdAt: NOW - 10 * HOUR, dueAt: NOW + 2 * HOUR })
  const freshNoDue = post({ id: 'fresh_no_due', createdAt: NOW - 5 * 60000 })
  const regression = rank.sortFeedPosts([oldWithDue, freshNoDue], NOW).map(item => item.id)
  assert(JSON.stringify(regression) === JSON.stringify(['fresh_no_due', 'old_due']),
    '⚠ 回归：旧帖有截止 + 新帖无截止 → 新帖仍排在前面（截止不得压过时间），实得 '
    + JSON.stringify(regression))

  // ⑤ 截止临近也不再是排序因素：同样新鲜时，due 早的那条不会因此插到前面。
  const dueLate = post({ id: 'due_7h', createdAt: NOW - 1 * HOUR, dueAt: NOW + 7 * HOUR })
  const dueSoon = post({ id: 'due_1h', createdAt: NOW - 2 * HOUR, dueAt: NOW + 1 * HOUR })
  const order3 = rank.sortFeedPosts([dueLate, dueSoon], NOW).map(item => item.id)
  assert(JSON.stringify(order3) === JSON.stringify(['due_7h', 'due_1h']),
    '截止临近不影响排序：更晚到期但更新的那条仍在前，实得 ' + JSON.stringify(order3))

  /*
   * ⑥ 综合：各种 dueAt / readAt / 过期状态混在一起的乱序输入，
   *    输出必须**严格按 createdAt 倒序**。
   *
   *    这是「与 dueAt / readAt 无关」最有力的形态：逐对检查相邻元素，
   *    任何一条优先级混进来都会打破单调性。
   */
  const mixed = [
    post({ id: 'm1', createdAt: NOW - 9 * HOUR, dueAt: NOW + 1 * HOUR }),
    post({ id: 'm2', createdAt: NOW - 3 * HOUR, readAt: NOW - 1 * HOUR }),
    post({ id: 'm3', createdAt: NOW - 7 * HOUR, dueAt: NOW - 1 * HOUR }),
    post({ id: 'm4', createdAt: NOW - 1 * HOUR, dueAt: NOW + 20 * HOUR }),
    post({ id: 'm5', createdAt: NOW - 5 * HOUR, readAt: NOW - 4 * HOUR, dueAt: NOW + 3 * HOUR }),
    post({ id: 'm6', createdAt: NOW - 11 * HOUR }),
  ]
  const mixedOrder = rank.sortFeedPosts(mixed, NOW).map(item => item.id)
  assert(JSON.stringify(mixedOrder) === JSON.stringify(['m4', 'm2', 'm5', 'm3', 'm1', 'm6']),
    '⚠ 乱序混合输入（不同 dueAt / readAt / 过期状态）输出严格按 createdAt 倒序，实得 '
    + JSON.stringify(mixedOrder))
  const strictlyDescending = rank.sortFeedPosts(mixed, NOW).every((item, index, list) =>
    index === 0 || list[index - 1].createdAt >= item.createdAt)
  assert(strictlyDescending, '输出逐对满足 createdAt 单调不增（没有任何优先级维度插进来）')

  // ⑦ dueAt === 0 仍然是「无截止」哨兵，不是 1970 年过期（§3）。
  const noDue = post({ id: 'nodue', createdAt: NOW - 1 * HOUR, dueAt: 0 })
  assert(rank.isExpired(noDue, NOW) === false, 'dueAt=0 不算过期（无截止哨兵，不是 1970 年）')
  assert(rank.isUnread(noDue, NOW) === true, 'dueAt=0 且无 readAt 时是未读')
}

/* ── 1.3 已删除的不进任何列表 ── */
{
  const live = post({ id: 'live', createdAt: NOW - 1 * HOUR })
  const gone = post({ id: 'gone', createdAt: NOW - 2 * HOUR, deletedAt: NOW - HOUR })
  const sorted = rank.sortFeedPosts([live, gone], NOW).map(item => item.id)
  assert(JSON.stringify(sorted) === JSON.stringify(['live']), '软删的帖子不进排序结果')
  const queried = rank.queryFeedPosts([live, gone], {}, NOW).map(item => item.id)
  assert(JSON.stringify(queried) === JSON.stringify(['live']), 'queryFeedPosts 也过滤掉软删的')
}

/* ── 1.4 筛选胶囊与频道 ── */
{
  const a = post({ id: 'a', createdAt: NOW - 1 * HOUR, dueAt: NOW + HOUR, topics: ['fit', 'mine'] })
  const b = post({ id: 'b', createdAt: NOW - 2 * HOUR, dueAt: NOW - HOUR, topics: ['tech'] })
  const c = post({ id: 'c', createdAt: NOW - 3 * HOUR, readAt: NOW - HOUR, topics: ['tech'] })

  const dueIds = rank.queryFeedPosts([a, b, c], { filter: 'due' }, NOW).map(item => item.id)
  assert(JSON.stringify(dueIds) === JSON.stringify(['a']), '胶囊「临近截止」只留未过期且有截止的，实得 ' + JSON.stringify(dueIds))

  const expIds = rank.queryFeedPosts([a, b, c], { filter: 'exp' }, NOW).map(item => item.id)
  assert(JSON.stringify(expIds) === JSON.stringify(['b']), '胶囊「已过期」只留过期的，实得 ' + JSON.stringify(expIds))

  const unreadIds = rank.queryFeedPosts([a, b, c], { filter: 'unread' }, NOW).map(item => item.id)
  assert(JSON.stringify(unreadIds) === JSON.stringify(['a']), '胶囊「未读」不含已过期与已读的，实得 ' + JSON.stringify(unreadIds))

  const mineIds = rank.queryFeedPosts([a, b, c], { topic: 'mine' }, NOW).map(item => item.id)
  assert(JSON.stringify(mineIds) === JSON.stringify(['a']), '频道 mine 只留带 mine 主题的，实得 ' + JSON.stringify(mineIds))

  const allIds = rank.queryFeedPosts([a, b, c], { topic: 'all' }, NOW).map(item => item.id)
  assert(allIds.length === 3, '频道 all 聚合全部（含过期与已读）')

  /*
   * 搜索：三条的 body 都是 'body'（含字母 b），所以不能用单字母做判据 ——
   * 用一个**只出现在其中一条 title 里**的词。这里给 b 一个独有的话题词。
   */
  const bMarked = post({ id: 'target_only', createdAt: NOW - 2 * HOUR, title: '独有话题词xyz' })
  const searchIds = rank.queryFeedPosts([a, bMarked, c], { q: 'XYZ' }, NOW).map(item => item.id)
  assert(JSON.stringify(searchIds) === JSON.stringify(['target_only']),
    '搜索大小写不敏感（q=XYZ 命中 title 里的小写 xyz），实得 ' + JSON.stringify(searchIds))
  const noHit = rank.queryFeedPosts([a, b, c], { q: 'zzz不存在' }, NOW).map(item => item.id)
  assert(noHit.length === 0, '搜不到时返回空数组')
}

/* ── 1.5 截断发生在排序之后 ── */
{
  const list = [
    post({ id: 'old', createdAt: NOW - 5 * HOUR }),
    post({ id: 'mid', createdAt: NOW - 3 * HOUR }),
    post({ id: 'newest', createdAt: NOW - 1 * HOUR }),
  ]
  const limited = rank.queryFeedPosts(list, { limit: 2 }, NOW).map(item => item.id)
  assert(JSON.stringify(limited) === JSON.stringify(['newest', 'mid']),
    'limit 截断发生在排序之后（最高优先的两条），实得 ' + JSON.stringify(limited))
}
console.log('\n=== 2. 单飞锁：连续点只跑 1 轮 ===');

const store = await (await load('store')).FeedStore;
const storeA = new store()
await storeA.load()

/** 可控时钟。 */
let clock = NOW
const nowFn = () => clock

/* ── 2.1 并发 6 次 requestRun：**Promise.all 并发**，必须只跑 1 轮 ──
 *
 * ⚠ 这一条必须用并发而不是串行 await（2026-10-27 修的就是它）。
 *
 * 串行 await 时每次请求都能读到上一次的写入，闸门看起来完全正确；
 * 而真实前端是「用户狂点更新按钮」→ 6 个 HTTP 请求几乎同时到达 host →
 * Node 并发处理 → 所有调用都先 await getGate() 拿到同一份「idle」旧快照，
 * 于是 6 次全部 started、真跑 6 轮。闸门的「读-判-写」之间有 await，
 * 这就是竞态窗口。线上必然复现，只有并发测试能钉住它。
 */
{
  let runsStarted = 0
  let releaseRun = null
  const gateDeps = {
    store: storeA,
    now: nowFn,
    run: async () => {
      runsStarted += 1
      // 挂住不返回，模拟「一轮还在跑」（真实生成要几十秒）。
      await new Promise(resolve => { releaseRun = resolve })
    },
  }
  // 并发发起 6 次（不是 for-await 串行！）
  const results = await Promise.all(
    Array.from({ length: 6 }, () => trigger.requestRun(gateDeps, 'manual')),
  )
  const tally = results.reduce((acc, item) => { acc[item] = (acc[item] ?? 0) + 1; return acc }, {})
  assert(tally.started === 1, '并发 6 次只有 1 次 started（验收 2 的核心），实得 ' + JSON.stringify(tally))
  assert(tally.queued === 1, '并发时第 2 次排队（queued），实得 ' + JSON.stringify(tally))
  assert(tally.rejected === 4, '其余 4 次直接丢弃（rejected×4），实得 ' + JSON.stringify(tally))
  assert(runsStarted === 1, '真正执行的轮次恰好 1 次（不是 6 次），实得 ' + runsStarted)

  const gate = await storeA.getGate()
  assert(gate.status === 'running', '闸门落盘为 running')
  assert(gate.queued === true, 'queued 标记已落盘（合并语义）')
  assert(gate.blockedCount === 5, '被拦下计数 = 5（1 排队 + 4 丢弃），实得 ' + gate.blockedCount)
  assert(gate.leaseUntil === NOW + trigger.LEASE_MS, '租约 = now + LEASE_MS（10 分钟），实得 ' + (gate.leaseUntil - NOW))

  // 收敛：清标记 + 收回 idle。
  const lease = trigger.startLeaseRenewal(gateDeps, gate.runId)
  await lease.stop()
  const gate2 = await storeA.getGate()
  assert(gate2.status === 'idle' && gate2.queued === false, '收敛后闸门回到 idle 且 queued 已清')
  if (releaseRun !== null) releaseRun()

  // 场景 B：这一轮跑完之后再点 1 次 → 必须能再起一轮（锁能释放，不永久卡死）。
  let secondRunRan = 0
  const after = await trigger.requestRun({
    store: storeA, now: nowFn, run: async () => { secondRunRan += 1 },
  }, 'manual')
  assert(after === 'started', '上一轮收敛后再点必须能 started（锁已释放、不永久卡死），实得 ' + after)
  assert(secondRunRan === 1, '收敛后确实又跑了一轮，实得 ' + secondRunRan)
  const gate3 = await storeA.getGate()
  const lease3 = trigger.startLeaseRenewal({ store: storeA, now: nowFn, run: async () => {} }, gate3.runId)
  await lease3.stop()
}

/* ── 2.1b 场景 C：串行快速连点也只跑 1 轮 ── */
{
  let runsStarted = 0
  let releaseRun = null
  const gateDeps = {
    store: storeA,
    now: nowFn,
    run: async () => {
      runsStarted += 1
      await new Promise(resolve => { releaseRun = resolve })
    },
  }
  const results = []
  for (let index = 0; index < 6; index++) results.push(await trigger.requestRun(gateDeps, 'manual'))
  const tally = results.reduce((acc, item) => { acc[item] = (acc[item] ?? 0) + 1; return acc }, {})
  assert(tally.started === 1, '串行连点 6 次也只 started 1 次，实得 ' + JSON.stringify(tally))
  assert(tally.queued === 1 && tally.rejected === 4,
    '串行连点：1 次 queued + 4 次 rejected，实得 ' + JSON.stringify(tally))
  assert(runsStarted === 1, '串行连点真正执行的轮次也是 1，实得 ' + runsStarted)
  const gate = await storeA.getGate()
  const lease = trigger.startLeaseRenewal(gateDeps, gate.runId)
  await lease.stop()
  if (releaseRun !== null) releaseRun()
}

/* ── 2.1c 并发混合触发源：也只有一个 started ── */
{
  let runsStarted = 0
  let releaseRun = null
  const gateDeps = {
    store: storeA,
    now: nowFn,
    run: async () => {
      runsStarted += 1
      await new Promise(resolve => { releaseRun = resolve })
    },
  }
  // 三种触发源同时打进来（手动 / 提示词 / 定时各 2 个）。
  const results = await Promise.all([
    trigger.requestRun(gateDeps, 'manual'),
    trigger.requestRun(gateDeps, 'prompt'),
    trigger.requestRun(gateDeps, 'schedule'),
    trigger.requestRun(gateDeps, 'manual'),
    trigger.requestRun(gateDeps, 'prompt'),
    trigger.requestRun(gateDeps, 'schedule'),
  ])
  const startedCount = results.filter(item => item === 'started').length
  assert(startedCount === 1, '三种触发源并发打进来也只有 1 个 started，实得 ' + startedCount + ' / ' + JSON.stringify(results))
  assert(runsStarted === 1, '混合触发源并发时真正执行 1 轮，实得 ' + runsStarted)
  const gate = await storeA.getGate()
  const lease = trigger.startLeaseRenewal(gateDeps, gate.runId)
  await lease.stop()
  if (releaseRun !== null) releaseRun()
}

/* ── 2.2 queued 不立刻再跑（否则「点 5 次跑 2 轮」）── */
{
  let runsStarted = 0
  let releaseRun = null
  const gateDeps = {
    store: storeA,
    now: nowFn,
    run: async () => {
      runsStarted += 1
      await new Promise(resolve => { releaseRun = resolve })
    },
  }
  await trigger.requestRun(gateDeps, 'manual')
  const second = await trigger.requestRun(gateDeps, 'prompt')
  assert(second === 'queued', '第二条请求进入 queued')
  const gate = await storeA.getGate()
  const lease = trigger.startLeaseRenewal(gateDeps, gate.runId)
  await lease.stop()
  // 给可能的「立刻再跑」一点机会（若实现错误会在这里多跑一轮）。
  await new Promise(resolve => setTimeout(resolve, 30))
  assert(runsStarted === 1, '收敛后不会立刻再跑一轮（queued 是合并，不是排第二轮），实得 ' + runsStarted)
  if (releaseRun !== null) releaseRun()
}

/* ── 2.3 租约过期 → 死锁可回收，僵尸 run 标 failed ── */
{
  const zombieRunId = 'r_zombie'
  await storeA.upsertRun({
    id: zombieRunId, trigger: 'manual', modelUsed: 'default',
    startedAt: NOW - trigger.LEASE_MS - 60000, status: 'running',
  })
  await storeA.setGate({
    status: 'running', runId: zombieRunId,
    leaseUntil: NOW - 1000, // 已过期
    queued: false, queuedTrigger: null, blockedCount: 0,
  })
  let ranAgain = 0
  const result = await trigger.requestRun({ store: storeA, now: nowFn, run: async () => { ranAgain += 1 } }, 'manual')
  assert(result === 'started', '租约过期后可以起新一轮（不会被死锁永久卡住）')
  const runs = await storeA.listRuns()
  const zombie = runs.find(item => item.id === zombieRunId)
  assert(zombie !== undefined && zombie.status === 'failed',
    '僵尸 run 被回收并标记 failed，实得 ' + (zombie === undefined ? 'missing' : zombie.status))
  assert(zombie !== undefined && zombie.error === 'lease expired', '僵尸 run 的 error 是 lease expired')
  const gate = await storeA.getGate()
  const lease = trigger.startLeaseRenewal({ store: storeA, now: nowFn, run: async () => {} }, gate.runId)
  await lease.stop()
  assert(ranAgain === 1, '回收同时确实起了一轮')
}

/* ── 2.4 闸门状态跨进程重启有效（新 store 实例读到同一份）── */
{
  await storeA.setGate({
    status: 'running', runId: 'r_cross', leaseUntil: NOW + trigger.LEASE_MS,
    queued: false, queuedTrigger: null, blockedCount: 0,
  })
  const storeFresh = new store()
  await storeFresh.load()
  const gate = await storeFresh.getGate()
  assert(gate.status === 'running' && gate.runId === 'r_cross',
    '闸门落盘：另一个 store 实例（模拟进程重启）读到同一份 running')
  const blocked = await trigger.requestRun({
    store: storeFresh, now: nowFn, run: async () => { throw new Error('不该跑') },
  }, 'manual')
  assert(blocked === 'queued', '重启后连点仍然被拦下（不会跑第二轮），实得 ' + blocked)
  await storeFresh.setGate({ status: 'idle', runId: null, leaseUntil: 0, queued: false, queuedTrigger: null, blockedCount: 0 })
}

/* ── 2.5 续租：长任务不会被误判成死锁 ── */
{
  const runId = 'r_long'
  await storeA.setGate({
    status: 'running', runId, leaseUntil: NOW + trigger.LEASE_MS,
    queued: false, queuedTrigger: null, blockedCount: 0,
  })
  const lease = trigger.startLeaseRenewal({ store: storeA, now: nowFn, run: async () => {} }, runId)
  clock = NOW + 9 * 60 * 1000 // 过了 9 分钟：若没有续租，租约还剩 1 分钟
  await lease.stop()
  const gate = await storeA.getGate()
  assert(gate.status === 'idle', 'stop() 把闸门收回 idle')
  // 续租本身：手动驱动一次 setGate 的时间推进，验证 leaseUntil 会被推后。
  await storeA.setGate({
    status: 'running', runId: 'r_renew', leaseUntil: NOW + trigger.LEASE_MS,
    queued: false, queuedTrigger: null, blockedCount: 0,
  })
  const lease2 = trigger.startLeaseRenewal({ store: storeA, now: () => NOW + 5 * 60 * 1000, run: async () => {} }, 'r_renew')
  await new Promise(resolve => setTimeout(resolve, 20))
  await lease2.stop()
  assert(trigger.LEASE_RENEW_MS === 60000, '续租间隔是 60 秒（§5.2 点名）')
  assert(trigger.LEASE_MS === 10 * 60 * 1000, '租约时长是 10 分钟（§5.2 点名）')
  clock = NOW
}

/* ── 2.6 提示词「实质」改动判定（§5.3）── */
{
  assert(trigger.promptChanged('盯住健身与睡眠', '盯住健身与睡眠。') === false,
    '只加句号不算实质改动（不触发）')
  assert(trigger.promptChanged('盯住 健身', '盯住健身') === false,
    '只改空白不算实质改动（不触发）')
  assert(trigger.promptChanged('盯住健身', '盯住睡眠') === true,
    '改了内容算实质改动（触发）')
  assert(trigger.promptChanged('A，B', 'A,B') === false,
    '全角逗号换半角逗号不算实质改动（归一化后一致）')
}
console.log('\n=== 3. 删除：软删 + 撤销 + 重启后仍不出现 ===');

/* ── 3.1 完整的「生成 → 删除 → 撤销」链路（用假 writer，不需要真实 LLM）── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const storeB = new StoreClass()
  await storeB.load()

  /*
   * 用**显式注入的假 writer** 跑一轮（原本用的是已删除的占位 writer）。
   *
   * 这一段测的是排序 / 删除 / 撤销 / 重启这些**流水线逻辑**，与内容从哪来
   * 无关 —— 所以假 writer 返回什么不重要，重要是它必须走完整的
   * executeRun 链路（校验 → 落盘 → 排序）。
   *
   * 不配 X 账号 → 不发任何网络请求。
   */
  const runner = trigger.createFeedRunner({
    store: storeB,
    writer: async () => [{
      title: '假 writer 产出的一条动态',
      body: '这条内容来自冒烟里注入的 writer，用于验证排序、删除与单飞锁链路。',
      topics: ['mine'],
      dueAt: 0,
      dueLabel: '',
      sourceRefs: [],
      mine: true,
    }],
    now: () => NOW,
    syncX: false,
  })
  const config = { prompt: '盯住健身与睡眠', model: 'default', cron: '0 12,18 * * *', xHandles: [] }
  await storeB.setConfig(config)

  const started = await runner.requestRun('manual')
  await runner.idle()
  assert(started === 'started', '手动触发返回 started')

  const postsAfterRun = await storeB.listPosts()
  assert(postsAfterRun.length === 1, '一轮生成产出 1 条（注入的假 writer 产 1 条），实得 ' + postsAfterRun.length)
  const target = postsAfterRun[0]

  // 验收 4：新动态出现在列表顶部。
  const listed = rank.queryFeedPosts(await storeB.listPosts(), {}, NOW)
  assert(listed[0]?.id === target.id, '新生成的动态出现在列表顶部（验收 4）')
  assert(listed[0]?.runId !== undefined, '新动态带本轮 runId（可溯源）')

  // 验收 3：删除后不出现。
  await storeB.patchPost(target.id, item => { item.deletedAt = NOW })
  const afterDelete = rank.queryFeedPosts(await storeB.listPosts(), {}, NOW)
  assert(afterDelete.every(item => item.id !== target.id), '删除后列表里不再出现该动态（验收 3）')

  // 各筛选逐一查（验收 3 要求「各筛选逐一查」）。
  for (const filter of ['all', 'unread', 'due', 'exp']) {
    const filtered = rank.queryFeedPosts(await storeB.listPosts(), { filter }, NOW)
    assert(filtered.every(item => item.id !== target.id), '删除后筛选「' + filter + '」也不含该动态')
  }
  for (const topic of ['all', 'mine']) {
    const filtered = rank.queryFeedPosts(await storeB.listPosts(), { topic }, NOW)
    assert(filtered.every(item => item.id !== target.id), '删除后频道「' + topic + '」也不含该动态')
  }

  // 撤销删除后恢复出现。
  await storeB.patchPost(target.id, item => { delete item.deletedAt })
  const afterRestore = rank.queryFeedPosts(await storeB.listPosts(), {}, NOW)
  assert(afterRestore.some(item => item.id === target.id), '撤销删除后该动态恢复出现')

  // 重启（新 store 实例读同一份磁盘）：已删的仍然不出现。
  await storeB.patchPost(target.id, item => { item.deletedAt = NOW })
  const storeReloaded = new StoreClass()
  await storeReloaded.load()
  const afterRestart = rank.queryFeedPosts(await storeReloaded.listPosts(), {}, NOW)
  assert(afterRestart.every(item => item.id !== target.id), '重启进程后（新实例重新读盘）已删动态仍不出现')
  const rawOnDisk = await storeReloaded.getPost(target.id)
  assert(rawOnDisk !== undefined && rawOnDisk.deletedAt > 0,
    '软删而非硬删：磁盘上记录还在且带 deletedAt（撤销才有依据）')
}

/* ── 3.2 点赞 / 讨论 / 已读的落盘往返 ── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeC = resolve(ROOT, '_tmp', 'smoke-feed-home-c')
  try { rmSync(homeC, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeC, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeC
  // feedDataDir 在构造时读 env，所以这个新实例指向 homeC。
  const storeC = new StoreClass()
  await storeC.load()
  process.env.DSH_HOME = prevHome

  await storeC.addPosts([post({ id: 'p_like', createdAt: NOW - HOUR })])
  await storeC.patchPost('p_like', item => { item.liked = true })
  const liked = await storeC.getPost('p_like')
  assert(liked?.liked === true, '点赞状态落盘')

  await storeC.patchPost('p_like', item => {
    item.comments = [...item.comments, { id: 'c_1', by: 'user', text: '这条有用', at: NOW }]
  })
  const commented = await storeC.getPost('p_like')
  assert(commented?.comments.length === 1, '讨论落盘')

  await storeC.patchPost('p_like', item => { item.readAt = NOW })
  const read = await storeC.getPost('p_like')
  assert(read?.readAt === NOW, '已读时刻落盘')
  assert(rank.isUnread(read, NOW) === false, '标记已读后不再是未读')
}
console.log('\n=== 4. X 抓取：429 退避 + 解析 + 去重 + 新鲜度 ===');

/* 造一个真实的 __NEXT_DATA__ 页面（结构照实测报告 §2.1 的原文摘抄）。
 *
 * 关键：entries 顺序是**混合的**（最新 → 2022 年 → 2024 年），这正是 Lead
 * 实测发现的形态。解析后必须按 created_at 重排，绝不能依赖返回顺序。
 */
function tweetEntry(over) {
  return {
    type: 'tweet',
    entry_id: 'tweet-' + over.id,
    content: {
      tweet: {
        created_at: over.createdAt ?? 'Wed Oct 21 15:38:10 +0000 2026',
        full_text: over.text ?? 'text ' + over.id,
        id_str: over.id,
        permalink: over.permalink === undefined ? '/elonmusk/status/' + over.id : over.permalink,
        favorite_count: over.likes ?? 10,
        retweet_count: 3,
        reply_count: 2,
        lang: 'en',
        user: {
          name: over.name ?? 'Elon Musk',
          screen_name: over.handle ?? 'elonmusk',
          profile_image_url_https: 'https://pbs.twimg.com/profile_images/x.jpg',
          followers_count: 100,
        },
        entities: over.media === undefined ? { media: null } : { media: over.media },
      },
    },
  }
}

/** 把 entries 包成完整的 syndication 页面 HTML。 */
function pageOf(entries, extra = '') {
  const json = JSON.stringify({ props: { pageProps: { timeline: { entries } } } })
  return '<!doctype html><html><body>' + extra
    + '<script id="__NEXT_DATA__" type="application/json">' + json + '</script></body></html>'
}

/* ── 4.1 解析：混合顺序必须按 created_at 重排 ── */
{
  const entries = [
    tweetEntry({ id: '2112931457786081428', createdAt: 'Wed Oct 21 15:38:10 +0000 2026' }),
    tweetEntry({ id: '1519480761749016577', createdAt: 'Thu Apr 28 06:00:00 +0000 2022' }),
    tweetEntry({ id: '1812258574049157405', createdAt: 'Sat Jul 13 12:00:00 +0000 2024' }),
    tweetEntry({ id: '1969897602524328440', createdAt: 'Sun Sep 21 09:00:00 +0000 2025' }),
  ]
  const tweets = sources.parseTweetsFromNextData(
    JSON.stringify({ props: { pageProps: { timeline: { entries } } } }))
  assert(tweets !== null && tweets.length === 4, '解析出 4 条推文，实得 ' + (tweets === null ? 'null' : tweets.length))
  const ids = tweets.map(item => item.id)
  assert(JSON.stringify(ids) === JSON.stringify([
    '2112931457786081428', '1969897602524328440', '1812258574049157405', '1519480761749016577',
  ]), '解析后按 created_at 倒序重排（2026 → 2025 → 2024 → 2022），实得 ' + JSON.stringify(ids))
  assert(tweets[0].url === 'https://x.com/elonmusk/status/2112931457786081428',
    'permalink 拼成完整可跳转 URL，实得 ' + tweets[0].url)
  assert(tweets[0].handle === 'elonmusk' && tweets[0].name === 'Elon Musk', '作者字段解析正确')
  assert(tweets[0].likes === 10 && tweets[0].retweets === 3 && tweets[0].replies === 2, '互动数据解析正确')

  // type !== 'tweet' 的条目必须被跳过。
  const mixed = [
    tweetEntry({ id: '111', createdAt: 'Wed Oct 21 15:38:10 +0000 2026' }),
    { type: 'profile-conversation', entry_id: 'x', content: {} },
    { type: 'tweet', entry_id: 'y', content: { tweet: { id_str: '222' } } }, // 缺 created_at
  ]
  const filtered = sources.parseTweetsFromNextData(
    JSON.stringify({ props: { pageProps: { timeline: { entries: mixed } } } }))
  assert(filtered !== null && filtered.length === 1,
    '非 tweet 条目与时间解析失败的单条都被跳过（脏数据不毁整批），实得 ' + (filtered === null ? 'null' : filtered.length))

  // permalink 缺失时用 /i/status/<id> 兜底。
  const noPermalink = sources.tweetUrlOf(null, 'nasa', '999')
  assert(noPermalink === 'https://x.com/i/status/999', 'permalink 缺失时用 /i/status/<id> 兜底，实得 ' + noPermalink)

  // entities.media 为 null 不能炸。
  const nullMedia = sources.parseTweetsFromNextData(JSON.stringify({
    props: { pageProps: { timeline: { entries: [tweetEntry({ id: '333', media: null })] } } },
  }))
  assert(nullMedia !== null && nullMedia.length === 1 && nullMedia[0].media.length === 0,
    'entities.media 为 null 时不抛错且媒体为空数组')

  // 有媒体时 type 要如实保留（video 的直链不在 media_url_https）。
  const withMedia = sources.parseTweetsFromNextData(JSON.stringify({
    props: {
      pageProps: {
        timeline: {
          entries: [tweetEntry({ id: '444', media: [
            { media_url_https: 'https://pbs.twimg.com/media/a.jpg', type: 'photo' },
            { media_url_https: 'https://pbs.twimg.com/media/b.jpg', type: 'video' },
          ] })],
        },
      },
    },
  }))
  assert(withMedia !== null && withMedia[0].media.length === 2, '带媒体的推文解析出 2 个媒体项')
  assert(withMedia[0].media[1].type === 'video', '媒体 type 如实保留（不会把封面当视频地址）')

  // JSON 坏了返回 null（而不是抛）。
  assert(sources.parseTweetsFromNextData('{not json') === null, 'JSON 解析失败返回 null，不抛异常')

  // extractNextData 正则。
  const extraction = sources.extractNextData(pageOf([tweetEntry({ id: '555' })]))
  assert(extraction !== null && extraction.startsWith('{'), 'extractNextData 能从 HTML 里抠出 JSON')
  assert(sources.extractNextData('<html>no data</html>') === null, '没有 __NEXT_DATA__ 时返回 null')
}

/* ── 4.2 推文去重口径（2026-10-27 二次修正：这一层不再过滤）──
 *
 * 原断言钉的是「selectNewTweets 只返回没见过的 id」。实测发现那条口径对
 * 「关注账号」场景是**错的**：关注账号发文频率低，第一轮抓完全进 seen 集合，
 * 第二轮起恒返回空 → 模型看不到任何 X 线索 → 交 0 条 → 页面永远空。
 * 去重的职责上移到 writer（knownTitles + 兜底去重），这一层只负责「把抓到的
 * 都交上去」。断言相应改成钉住新口径。
 */
{
  const tweets = [
    { id: '100', createdAt: NOW - HOUR },
    { id: '50', createdAt: NOW - 2 * HOUR },
    { id: '200', createdAt: NOW - 3 * HOUR },
  ]
  const seen = { 100: NOW - DAY }
  const fresh = sources.selectNewTweets(tweets, seen).map(item => item.id)
  assert(JSON.stringify(fresh) === JSON.stringify(['100', '50', '200']),
    '关注账号场景：已见过的推文也要交上去（去重不在这层做，否则页面永远空），实得 ' + JSON.stringify(fresh))

  const merged = sources.mergeSeenTweets(seen, tweets, NOW)
  assert(merged['100'] === NOW - DAY, '已见 id 的首次见到时间不被覆盖（合并幂等）')
  assert(merged['50'] === NOW && merged['200'] === NOW, '新见到的 id 并进集合')

  // 裁剪：只保留最近见到的那批，且刚并进来的一定还在。
  const smallLimit = sources.mergeSeenTweets({ a: 1, b: 2, c: 3 }, [{ id: 'd', createdAt: NOW }], NOW, 2)
  const keys = Object.keys(smallLimit).sort()
  assert(keys.length === 2 && keys.includes('d'), '已见集合按上限裁剪，刚并进来的 id 一定保留，实得 ' + JSON.stringify(keys))
}

/* ── 4.3 新鲜度：72 小时窗口（缓存滞后 → 不能都把历史当今天）── */
{
  const fresh = { id: 'f', createdAt: NOW - 1 * HOUR }
  const old = { id: 'o', createdAt: NOW - 30 * DAY }
  const split = sources.splitTweetsByFreshness([fresh, old], NOW)
  assert(split.fresh.length === 1 && split.fresh[0].id === 'f', '72 小时内的算「今天的新事件」')
  assert(split.stale.length === 1 && split.stale[0].id === 'o', '更早的只能作背景上下文（不当新闻）')
  assert(types.FEED_FRESH_WINDOW_MS === 72 * 60 * 60 * 1000, '新鲜度窗口是 72 小时')
}
/* ── 4.4 429 退避：冷却 10 分钟 + 本轮剩余账号全部跳过 + 节流间隔 ── */
{
  const sleeps = []
  let calls = 0
  // 分通道计数：主通道（timeline-profile）与备用通道（x.com 主页 / 单条详情）。
  // 429 之后会走一次备用通道，所以「总请求数」不再是「账号数」。
  let timelineCalls = 0
  let fallbackCalls = 0
  const handlesCalled = []
  const fakeFetch = async (url) => {
    calls += 1
    const u = String(url)
    if (u.includes('syndication.twitter.com/srv/timeline-profile')) {
      timelineCalls += 1
      const handle = decodeURIComponent(u.split('/screen-name/')[1] ?? '')
      handlesCalled.push(handle)
      // 第 1 个账号成功，第 2 个 429，第 3 个**不该被请求**。
      if (handle === 'alpha') {
        return {
          status: 200,
          ok: true,
          text: async () => pageOf([tweetEntry({ id: '900', handle: 'alpha', createdAt: 'Mon Oct 26 10:00:00 +0000 2026' })]),
        }
      }
      return { status: 429, ok: false, text: async () => 'Rate limit exceeded ' }
    }
    // 备用通道：主页 / 单条详情。这里一律返回失败，让「限流」这条主路径
    // 保持可断言（备用通道有自己的一组用例）。
    fallbackCalls += 1
    return { status: 500, ok: false, text: async () => '' }
  }
  const round = await sources.runXSyncRound(
    ['alpha', 'beta', 'gamma'],
    {},
    {
      fetchImpl: fakeFetch,
      sleep: async ms => { sleeps.push(ms) },
      now: () => NOW,
    },
  )
  assert(round.results.length === 2, '429 之后本轮剩余账号不再请求（只处理了 2 个），实得 ' + round.results.length)
  assert(round.results[0].outcome === 'ok', '第 1 个账号成功')
  assert(round.results[1].outcome === 'rate-limit', '第 2 个账号命中限流（429）')
  assert(round.aborted === true, '429 触发本轮中止标记')
  assert(round.cooldownUntil === NOW + sources.X_COOLDOWN_MS,
    '429 → cooldownUntil = now + 10 分钟，实得 ' + (round.cooldownUntil - NOW) + 'ms')
  assert(sources.X_COOLDOWN_MS === 10 * 60 * 1000, '冷却时长常量是 10 分钟')
  assert(handlesCalled.includes('gamma') === false, '被中止后第 3 个账号（gamma）一次请求都没发')
  /*
   * 429 不该**重试主通道**（重试只会把封禁拖更长）。
   *
   * 2026-10-27 起，主通道 429 后会再试一次**备用通道**（x.com 主页拿推文 ID →
   * cdn.syndication 单条详情），所以总请求数不再等于「账号数」。断言改成钉住
   * 真正要紧的那条：**主通道时间线端点只被请求一次**（alpha 1 次 + beta 1 次 = 2），
   * 备用通道的请求单独计数。
   */
  assert(timelineCalls === 2, '主通道（timeline-profile）只请求了 2 次、429 后不重试，实得 ' + timelineCalls)
  assert(fallbackCalls > 0, '主通道 429 后确实尝试了备用通道，实得 ' + fallbackCalls + ' 次')
  assert(sleeps.includes(sources.X_HANDLE_GAP_MS),
    '账号之间有 >=1500ms 间隔（实测要求串行 + 节流），实得 ' + JSON.stringify(sleeps))
  assert(sleeps[0] === 1500, '账号间隔是 1500ms，实得 ' + sleeps[0])
  assert(round.summary.includes('限流'), 'summary 里给出一句人话（含「限流」），实得 ' + round.summary)
}

/* ── 4.5 冷却期内的账号直接跳过（不发请求）── */
{
  let calls = 0
  const fakeFetch = async () => { calls += 1; return { status: 429, ok: false, text: async () => '' } }
  const syncState = {
    alpha: { handle: 'alpha', lastFetchedAt: 0, cooldownUntil: NOW + 5 * 60000, consecutiveFailures: 1, seenTweetIds: {} },
  }
  const round = await sources.runXSyncRound(
    ['alpha'], syncState, { fetchImpl: fakeFetch, sleep: async () => {}, now: () => NOW })
  assert(calls === 0, '处于冷却期的账号一次请求都不发，实得 ' + calls)
  assert(round.results.length === 0, '冷却期账号不进入结果列表')
  assert(round.summary.includes('冷却'), 'summary 说明有账号仍在冷却期，实得 ' + round.summary)
}

/* ── 4.6 单轮抓取上限 16 个；按 lastFetchedAt 升序轮转 ──
 *
 * 2026-10-28 口径变了：用户要求「所有账号而不是有上限」，上限从 5 提到 16。
 * 原来那个 5 是**主通道**的安全上限，而主通道现在长期 429、实际走备用通道
 * （主页 + 单条详情），没有「一次抓几个」的硬限制。
 * 不改的后果实测过：关注 6 个账号时第 6 个每轮被跳过，那个账号永远是 0 条动态。
 */
{
  /* 每个账号**全部**给显式状态：没给 state 的账号 lastFetchedAt 也是 0，
   * 会跟「从未抓过」的混在一起占满名额，断言就看不出「最久没抓优先」了。 */
  const mkState = (handle, lastFetchedAt) => ({
    handle, lastFetchedAt, cooldownUntil: 0, consecutiveFailures: 0, seenTweetIds: {},
  })
  // 用户实际场景：6 个 X 账号必须**一轮全部抓到**（这是这次改动的核心）。
  const six = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']
  const sixState = Object.fromEntries(six.map((h, i) => [h, mkState(h, NOW - (6 - i) * HOUR)]))
  const allSix = sources.pickHandlesForRound(six, sixState, NOW)
  assert(allSix.picked.length === 6,
    '6 个账号一轮全部抓完（不能有账号被永久跳过），实得 ' + JSON.stringify(allSix.picked))

  // 极端情况才截断：20 个账号时只取上限那么多，且按最久没抓优先。
  const many = Array.from({ length: 20 }, (_, i) => 'b' + String(i + 1))
  const manyState = Object.fromEntries(many.map((h, i) => [h, mkState(h, NOW - (20 - i) * HOUR)]))
  const picked = sources.pickHandlesForRound(many, manyState, NOW)
  assert(picked.picked.length === sources.X_MAX_HANDLES_PER_ROUND,
    '账号特别多时按上限截断，实得 ' + picked.picked.length)
  assert(picked.picked[0] === 'b1',
    '按 lastFetchedAt 升序取最久没抓的（b1 最久），实得 ' + picked.picked[0])
  // 从没抓过（无状态）的账号优先级最高。
  const neverFetched = { a9: { handle: 'a9', lastFetchedAt: 0, cooldownUntil: 0, consecutiveFailures: 0, seenTweetIds: {} } }
  const withNewbie = sources.pickHandlesForRound(['u1', 'a9'], { u1: sixState.u1, ...neverFetched }, NOW)
  assert(withNewbie.picked[0] === 'a9', '从未抓过的账号排最前，实得 ' + JSON.stringify(withNewbie.picked))
  assert(sources.X_MAX_HANDLES_PER_ROUND === 16, '每轮上限常量是 16（覆盖正常关注数），实得 ' + sources.X_MAX_HANDLES_PER_ROUND)
  // 冷却的不进候选。
  const cooling = sources.pickHandlesForRound(six, {
    ...sixState,
    u4: { handle: 'u4', lastFetchedAt: 0, cooldownUntil: NOW + HOUR, consecutiveFailures: 1, seenTweetIds: {} },
  }, NOW)
  assert(cooling.cooling.includes('u4'), '冷却期的账号被记进 cooling 列表而不是候选')
  assert(cooling.picked.includes('u4') === false, '冷却期的账号不在候选里')
}

/* ── 4.7 超时 / 网络错 / 解析失败 / 空账号：各归各位，绝不抛 ── */
{
  const timeoutFetch = async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  }
  const r1 = await sources.fetchOnce('x', { fetchImpl: timeoutFetch })
  assert(r1.outcome === 'timeout', 'AbortError 归类为 timeout（不是笼统的 network），实得 ' + r1.outcome)

  const networkFetch = async () => { throw new Error('ECONNREFUSED') }
  const r2 = await sources.fetchOnce('x', { fetchImpl: networkFetch })
  assert(r2.outcome === 'network', '连接失败归类为 network，实得 ' + r2.outcome)

  // 不存在的账号：200 + 空 entries（实测，不是 404）。
  const emptyFetch = async () => ({
    status: 200,
    ok: true,
    text: async () => pageOf([]),
  })
  const r3 = await sources.fetchOnce('nobody', { fetchImpl: emptyFetch })
  assert(r3.outcome === 'empty', 'entries 为空按「无数据」处理（不是错误），实得 ' + r3.outcome)

  // 200 但正文是 20 字节的 "Rate limit exceeded "（实测形态）→ 必须识别为限流，
  // 不能拿去当 HTML 解析（那会得到 parse-fail 而永远不冷却）。
  const shortRateLimit = async () => ({
    status: 200,
    ok: true,
    text: async () => 'Rate limit exceeded ',
  })
  const r4 = await sources.fetchOnce('x', { fetchImpl: shortRateLimit })
  assert(r4.outcome === 'rate-limit', '200 + 20 字节 "Rate limit exceeded" 也识别为限流，实得 ' + r4.outcome)

  const brokenFetch = async () => ({ status: 200, ok: true, text: async () => '<html>' + 'x'.repeat(300) + '</html>' })
  const r5 = await sources.fetchOnce('x', { fetchImpl: brokenFetch })
  assert(r5.outcome === 'parse-fail', '没有 __NEXT_DATA__ 时归类为 parse-fail，实得 ' + r5.outcome)

  const http500 = async () => ({ status: 500, ok: false, text: async () => 'boom' })
  const r6 = await sources.fetchOnce('x', { fetchImpl: http500 })
  assert(r6.outcome === 'http-error', '5xx 归类为 http-error，实得 ' + r6.outcome)

  // 这些结局都必须有一句中文解释（设置页直接展示）。
  for (const outcome of ['timeout', 'network', 'rate-limit', 'parse-fail', 'empty', 'ok', 'cooldown', 'http-error']) {
    const text = sources.describeOutcome(outcome)
    assert(typeof text === 'string' && text.length > 2 && /[\u4e00-\u9fa5]/.test(text),
      '结局「' + outcome + '」有中文说明：' + text)
  }
}

/* ── 4.8 单账号最多 2 次尝试，第 2 次前 sleep 3000ms ── */
{
  let attempts = 0
  const sleeps = []
  const alwaysNetwork = async () => { attempts += 1; throw new Error('ECONNRESET') }
  const result = await sources.fetchWithRetry('x', {
    fetchImpl: alwaysNetwork,
    sleep: async ms => { sleeps.push(ms) },
  })
  assert(attempts === 2, '可重试失败最多尝试 2 次（绝不重试到底），实得 ' + attempts)
  assert(result.outcome === 'network', '2 次都失败后返回最后一次的结局')
  assert(sleeps.length === 1 && sleeps[0] === 3000, '第 2 次尝试前 sleep 3000ms，实得 ' + JSON.stringify(sleeps))
  assert(sources.X_RETRY_DELAY_MS === 3000 && sources.X_MAX_ATTEMPTS === 2,
    '常量 X_MAX_ATTEMPTS=2 / X_RETRY_DELAY_MS=3000')
}
console.log('\n=== 5. 来源可用性判定（§7）+ 摘要字段语义 ===');

{
  assert(sources.classifySource('https://x.com/a/status/1', null) === 'limited',
    'X 直接判 limited（不发请求）')
  assert(sources.classifySource('https://mp.weixin.qq.com/s/abc', null) === 'limited',
    '公众号判 limited')
  assert(sources.classifySource('https://example.com/a', null) === 'open',
    '普通域名在没抓取结果时给乐观判定 open')
  assert(sources.classifySource('https://example.com/a', { statusCode: 403, text: 'x'.repeat(500) }) === 'limited',
    '403 → limited')
  assert(sources.classifySource('https://example.com/a', { statusCode: 402, text: 'x'.repeat(500) }) === 'blocked',
    '402 → blocked（付费墙，整条丢弃）')
  assert(sources.classifySource('https://example.com/a', { statusCode: 451, text: 'x'.repeat(500) }) === 'blocked',
    '451 → blocked（法律限制）')
  assert(sources.classifySource('https://example.com/a', { statusCode: 200, text: '请登录后查看全文' + 'x'.repeat(300) }) === 'limited',
    '正文含登录墙特征 → limited')
  assert(sources.classifySource('https://example.com/a', { statusCode: 200, text: '订阅后阅读' + 'x'.repeat(300) }) === 'blocked',
    '正文含付费墙特征 → blocked')
  assert(sources.classifySource('https://example.com/a', { statusCode: 200, text: 'short' }) === 'blocked',
    '空壳页（正文 <200）→ blocked')
  assert(sources.classifySource('https://example.com/a', { statusCode: 200, text: 'x'.repeat(400) }) === 'open',
    '正常长正文 → open')

  // limited 来源：清正文摘要、只留话题线索摘要（≤200 字符）。
  const limited = sources.tightenSource({
    url: 'https://x.com/a/status/1', domain: 'x.com', title: 't',
    access: 'limited', snippet: '这段正文摘要必须被清空', excerpt: 'y'.repeat(300), fetchedAt: NOW,
  })
  assert(limited.snippet === undefined, 'limited 来源的正文摘要（snippet）被清空（§7.3 法律边界）')
  /*
   * 2026-10-28 用户要求「X账号相关的动态不要压缩原文内容」：excerpt 不再截到 200，
   * 上限改成 MAX_EXCERPT_CHARS（4000）。snippet 仍然必须清空 —— 那条法律边界没变，
   * 变的只是「用户关注账号本人的推文原文」这一格能存多长。
   */
  assert(limited.excerpt !== undefined && limited.excerpt.length === 300,
    'limited 来源的线索摘要不再压到 200（输入 300 字符完整保留），实得 '
      + (limited.excerpt?.length ?? 'undefined'))

  // open 来源：反过来，不带线索摘要。
  const open = sources.tightenSource({
    url: 'https://e.com/a', domain: 'e.com', title: 't',
    access: 'open', snippet: '合法摘要', excerpt: '不该有', fetchedAt: NOW,
  })
  assert(open.snippet === '合法摘要', 'open 来源保留正文摘要')
  assert(open.excerpt === undefined, 'open 来源不带线索摘要（两个字段语义不混）')

  // 推文转来源：按 limited 处理。
  const src = sources.tweetToSource({
    id: '1', handle: 'nasa', name: 'NASA', avatar: '', text: 'a'.repeat(500),
    createdAt: NOW, url: 'https://x.com/nasa/status/1', likes: 1, retweets: 1, replies: 1, lang: 'en', media: [],
  })
  assert(src.access === 'limited', '推文转来源按 limited 处理（实测报告 §4.3）')
  assert(src.snippet === undefined, '推文来源不带正文摘要')
  assert(src.excerpt !== undefined && src.excerpt.length === 500,
    '推文原文**完整保留**（500 字符不被压缩），实得 ' + (src.excerpt?.length ?? 'undefined'))
  assert(src.domain === 'x.com', '推文来源域名是 x.com')
}

console.log('\n=== 6. HTTP 路由：两道闸门 + days 分组契约 ===');

/* 把真 handler 挂到裸 http server 上，用真请求打一遍。
 * 只有闸门/body 解析/状态码/投影这一层需要真 HTTP —— 纯逻辑已经在上面的组里测过。
 */
{
  const api = await load('api')
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeD = resolve(ROOT, '_tmp', 'smoke-feed-home-d')
  try { rmSync(homeD, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeD, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeD
  const storeD = new StoreClass()
  await storeD.load()
  process.env.DSH_HOME = prevHome

  await storeD.addPosts([
    post({ id: 'today_new', createdAt: NOW - HOUR }),
    post({ id: 'today_old', createdAt: NOW - 3 * HOUR, readAt: NOW - HOUR }),
    post({ id: 'yesterday_x', createdAt: NOW - 1.4 * DAY }),
    post({ id: 'older_x', createdAt: NOW - 8 * DAY }),
    post({ id: 'deleted_x', createdAt: NOW - 2 * HOUR, deletedAt: NOW - HOUR }),
  ])

  const runner = {
    requestRun: async () => 'started',
    idle: async () => {},
  }
  const routes = []
  const fakeCtx = {
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    logger: { warn: () => {}, info: () => {} },
  }
  api.mountFeedRoutes(fakeCtx, { store: storeD, runner, now: () => NOW })
  assert(routes.length === 1 && routes[0].kind === 'prefix' && routes[0].path === '/api/dsh-feed',
    '路由注册为 prefix /api/dsh-feed，实得 ' + JSON.stringify(routes.map(item => [item.kind, item.path])))
  assert(typeof routes[0].handler === 'function', '路由有 handler')

  const handler = routes[0].handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port + '/api/dsh-feed'

  /** 发一个请求，返回 {status, json, text}。 */
  async function call(path, options = {}) {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    return await new Promise((ok, bad) => {
      const req = httpRequest(base + path, {
        method: options.method ?? 'GET',
        headers: {
          host: '127.0.0.1:' + port,
          ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
          ...(options.headers ?? {}),
        },
      }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = null
          try { parsed = JSON.parse(text) } catch { /* 非 JSON */ }
          ok({ status: res.statusCode, json: parsed, text })
        })
      })
      req.on('error', bad)
      if (body !== undefined) req.write(body)
      req.end()
    })
  }

  // ── 契约：GET /posts 返回 days 分组，组内已排序，含 read 布尔字段 ──
  const list = await call('/posts')
  assert(list.status === 200 && list.json?.ok === true, 'GET /posts 回 200 + ok:true')
  assert(Array.isArray(list.json?.days), 'GET /posts 返回 days 数组（客户端契约）')
  const dayKeys = list.json.days.map(day => day.date)
  assert(JSON.stringify(dayKeys) === JSON.stringify(['today', 'yesterday', 'older']),
    'days 按 today → yesterday → older 排列，实得 ' + JSON.stringify(dayKeys))
  assert(list.json.days[0].label === '今天', 'days[].label 是中文标签，实得 ' + list.json.days[0].label)
  const todayIds = list.json.days[0].items.map(item => item.id)
  assert(JSON.stringify(todayIds) === JSON.stringify(['today_new', 'today_old']),
    '今天组内：未读在前、已读在后，实得 ' + JSON.stringify(todayIds))
  assert(list.json.days[0].items[0].read === false, 'items[].read 是布尔（未读 false）')
  assert(list.json.days[0].items[1].read === true, 'items[].read 是布尔（已读 true）')

  // 契约最小集逐字段核对（少一个或改名，客户端就渲染不出来）。
  const sample = list.json.days[0].items[0]
  for (const field of ['id', 'createdAt', 'topics', 'title', 'body', 'sources', 'dueAt', 'dueLabel',
    'likes', 'liked', 'comments', 'read', 'runId']) {
    assert(field in sample, 'Post 字段存在：' + field)
  }
  assert(Array.isArray(sample.topics) && Array.isArray(sample.sources) && Array.isArray(sample.comments),
    'Post 的 topics / sources / comments 都是数组')
  const allIds = list.json.days.flatMap(day => day.items.map(item => item.id))
  assert(allIds.includes('deleted_x') === false, '软删的帖子不出现在 days 里')

  // ── 业务错误是 200 + ok:false（不用 4xx 表达业务失败）──
  const notFound = await call('/posts/nope/like', { method: 'POST', body: {} })
  assert(notFound.status === 200 && notFound.json?.ok === false,
    '业务失败回 200 + ok:false（不是 404），实得 status=' + notFound.status)
  const noRoute = await call('/nope')
  assert(noRoute.status === 200 && noRoute.json?.ok === false, '未知路由回 200 + ok:false')

  // ── 闸门一：非 loopback 的 Host 头 → 403 ──
  const badHost = await call('/posts', { headers: { host: 'evil.example.com' } })
  assert(badHost.status === 403, 'Host 头不是 loopback → 403，实得 ' + badHost.status)
  assert(badHost.json?.error === 'loopback-only', '403 的 error 是 loopback-only')

  // ── 闸门二：跨站（sec-fetch-site: cross-site）→ 403 ──
  const crossSite = await call('/posts', { headers: { 'sec-fetch-site': 'cross-site' } })
  assert(crossSite.status === 403, 'sec-fetch-site: cross-site → 403，实得 ' + crossSite.status)
  assert(crossSite.json?.error === 'forbidden', '跨站的 error 是 forbidden')

  const crossDelete = await call('/posts/today_new', { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } })
  assert(crossDelete.status === 403, '跨站的 DELETE 也被挡（403），实得 ' + crossDelete.status)
  const stillThere = await storeD.getPost('today_new')
  assert(stillThere !== undefined && stillThere.deletedAt === undefined, '被挡的跨站删除没有生效')

  // ── 点赞 / 讨论 / 已读 / 删除 / 撤销 全链路（RESTful 形态）──
  const likeR = await call('/posts/today_new/like', { method: 'POST', body: { liked: true } })
  assert(likeR.json?.ok === true && likeR.json?.liked === true, 'RESTful POST /posts/:id/like 成功')
  const likeAgainR = await call('/posts/today_new/like', { method: 'POST', body: { liked: true } })
  assert(likeAgainR.json?.liked === true, '点赞幂等（再点一次仍是 true）')
  const unlikeR = await call('/posts/today_new/like', { method: 'POST', body: { liked: false } })
  assert(unlikeR.json?.liked === false, '取消点赞')

  const commentR = await call('/posts/today_new/comments', { method: 'POST', body: { text: '这条有用' } })
  assert(commentR.json?.ok === true && commentR.json?.comments.length === 1, 'RESTful POST /posts/:id/comments 发讨论成功')
  const emptyCommentR = await call('/posts/today_new/comments', { method: 'POST', body: { text: '  ' } })
  assert(emptyCommentR.json?.ok === false, '空讨论被拒绝（ok:false）')

  const readMark = await call('/posts/today_new/read', { method: 'POST', body: {} })
  assert(readMark.json?.ok === true, 'POST /read 标记已读成功')

  const removed = await call('/posts/today_new', { method: 'DELETE' })
  assert(removed.json?.ok === true, 'RESTful DELETE /posts/:id 删除成功')
  const afterDel = await call('/posts')
  const afterDelIds = afterDel.json.days.flatMap(day => day.items.map(item => item.id))
  assert(afterDelIds.includes('today_new') === false, '删除后 GET /posts 不再包含该 id（验收 3）')

  const restored = await call('/posts/today_new/restore', { method: 'POST', body: {} })
  assert(restored.json?.ok === true, 'POST /restore 撤销删除成功')
  const afterRestore = await call('/posts')
  const afterRestoreIds = afterRestore.json.days.flatMap(day => day.items.map(item => item.id))
  assert(afterRestoreIds.includes('today_new') === true, '撤销后该动态恢复出现')

  // ── 配置：提示词实质改动才触发 ──
  let triggers = 0
  const runnerCounting = { requestRun: async () => { triggers += 1; return 'started' }, idle: async () => {} }
  const routes2 = []
  api.mountFeedRoutes({ webServer: { register: (route) => { routes2.push(route); return () => {} } } },
    { store: storeD, runner: runnerCounting, now: () => NOW })
  const server2 = createServer((req, res) => routes2[0].handler(req, res))
  await new Promise(ok => server2.listen(0, '127.0.0.1', ok))
  const port2 = server2.address().port
  const call2 = (path, options = {}) => new Promise((ok, bad) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const req = httpRequest('http://127.0.0.1:' + port2 + '/api/dsh-feed' + path, {
      method: options.method ?? 'GET',
      headers: { host: '127.0.0.1:' + port2, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }) },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => { let parsed = null; try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* */ } ok({ status: res.statusCode, json: parsed }) })
    })
    req.on('error', bad)
    if (body !== undefined) req.write(body)
    req.end()
  })

  const cfg0 = await call2('/config')
  const basePrompt = cfg0.json.config.prompt
  const cfg1 = await call2('/config', { method: 'PUT', body: { prompt: basePrompt + '。' } })
  assert(cfg1.json?.promptChanged === false && triggers === 0,
    '只加句号：promptChanged=false 且不触发（§5.3），实得 triggers=' + triggers)
  const cfg2 = await call2('/config', { method: 'PUT', body: { prompt: basePrompt + '另外加上睡眠' } })
  assert(cfg2.json?.promptChanged === true && triggers === 1,
    '实质改动提示词：promptChanged=true 且触发一轮（验收 1），实得 triggers=' + triggers)
  const cfg3 = await call2('/config', { method: 'PUT', body: { model: 'deepseek-chat' } })
  assert(cfg3.json?.promptChanged === false && triggers === 1,
    '只改模型不触发（§5.4 静默保存，下轮生效），实得 triggers=' + triggers)
  assert(cfg3.json?.config.model === 'deepseek-chat', '模型配置已保存')

  // ── 状态路由给出可读的 X 同步信息 ──
  await storeD.setXSync({
    handle: 'alpha', lastFetchedAt: NOW - HOUR, cooldownUntil: NOW + 5 * 60000,
    consecutiveFailures: 1, seenTweetIds: {}, lastOutcome: 'rate-limit', lastErrorText: '被限流，10 分钟后重试',
  })
  const statusMain = await call2('/status')
  assert(statusMain.json?.ok === true, 'GET /status 回 ok:true')
  assert(Array.isArray(statusMain.json?.xSync) && statusMain.json.xSync.length === 1, 'status 带 xSync 列表')
  const xStatus = statusMain.json.xSync[0]
  assert(xStatus.cooling === true && xStatus.coolingLeftMs === 5 * 60000,
    'status 给出冷却剩余时间（供设置页显示倒计时），实得 ' + xStatus.coolingLeftMs)
  assert(typeof xStatus.message === 'string' && xStatus.message.includes('限流'),
    'status 给出中文可读状态（不是笼统的 failed），实得 ' + xStatus.message)
  assert(statusMain.json.cooldownMs === sources.X_COOLDOWN_MS, 'status 下发冷却时长常量（客户端不重复写死）')

  const run1 = await call2('/run', { method: 'POST', body: {} })
  assert(run1.json?.ok === true && run1.json?.result === 'started', 'POST /run 返回闸门结论')
  assert(typeof run1.json?.message === 'string' && run1.json.message.length > 0, 'POST /run 给出一句人话')

  const runsMain = await call2('/runs?limit=5')
  assert(runsMain.json?.ok === true && Array.isArray(runsMain.json.runs), 'GET /runs 返回轮次历史')

  await new Promise(ok => server.close(ok))
  await new Promise(ok => server2.close(ok))
}

console.log('\n=== 6b. 客户端契约的扁平形态（body 传 id）===');

/*
 * 这一组是 2026-10-27 集成阶段补的，钉住一个**只有集成才会暴露**的坑：
 *
 *   客户端 src/client/triad/feed/api.ts 调的是 body 传 id 的扁平形态
 *   POST /like {id} / POST /comment {id,text} / DELETE /post {id}
 *
 *   而 host 最初只实现了 RESTful 形态 /posts/:id/like 等。
 *   两边各自的冒烟都绿（各测各的形态），合起来 404 —— 真机上三个核心操作全废。
 *
 * 所以这里**两种形态都要断言**：任何一种断了都要红。同时还核对客户端真正
 * 读的响应字段（post / state / running / nextRunAt / promptHash），
 * 因为「路由通了但字段名不对」在界面上同样表现为「点了没反应」。
 */
{
  const api = await load('api')
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeF = resolve(ROOT, '_tmp', 'smoke-feed-home-f')
  try { rmSync(homeF, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeF, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeF
  const storeF = new StoreClass()
  await storeF.load()
  process.env.DSH_HOME = prevHome

  await storeF.addPosts([
    post({ id: 'p_flat', createdAt: NOW - HOUR }),
    post({ id: 'p_rest', createdAt: NOW - 2 * HOUR }),
  ])

  const runner = { requestRun: async () => 'queued', idle: async () => {} }
  const routes = []
  api.mountFeedRoutes({ webServer: { register: (route) => { routes.push(route); return () => {} } } },
    { store: storeF, runner, now: () => NOW })
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const call = (path, options = {}) => new Promise((ok, bad) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const req = httpRequest('http://127.0.0.1:' + port + '/api/dsh-feed' + path, {
      method: options.method ?? 'GET',
      headers: {
        host: '127.0.0.1:' + port,
        ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
      },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* 非 JSON */ }
        ok({ status: res.statusCode, json: parsed })
      })
    })
    req.on('error', bad)
    if (body !== undefined) req.write(body)
    req.end()
  })

  /* ── 扁平形态：POST /like { id } → { ok, post } ── */
  const like = await call('/like', { method: 'POST', body: { id: 'p_flat' } })
  assert(like.json?.ok === true, '扁平 POST /like {id} 成功（客户端契约，不是 404）')
  assert(like.json?.post !== undefined && like.json.post.id === 'p_flat',
    '扁平 /like 回完整 post 对象（客户端读的是 post 字段）')
  assert(like.json.post.liked === true, '扁平 /like 后 post.liked=true')
  const likeAgain = await call('/like', { method: 'POST', body: { id: 'p_flat' } })
  assert(likeAgain.json?.post?.liked === false, '扁平 /like 幂等翻转（再点一次取消）')
  const likeMissing = await call('/like', { method: 'POST', body: {} })
  assert(likeMissing.json?.ok === false && likeMissing.json.error === 'id required',
    '扁平 /like 缺 id 时回 200+ok:false 的 id required')

  /* ── 扁平形态：POST /comment { id, text } → { ok, post } ── */
  const comment = await call('/comment', { method: 'POST', body: { id: 'p_flat', text: '这条不错' } })
  assert(comment.json?.ok === true, '扁平 POST /comment {id,text} 成功（客户端契约）')
  assert(comment.json?.post?.comments?.length === 1, '扁平 /comment 后 post.comments 有一条')
  const firstComment = comment.json.post.comments[0]
  assert(typeof firstComment.id === 'string' && firstComment.id !== '', '评论带 id（客户端据此做 key）')
  assert(firstComment.by === 'user', '评论的 by 是 user/agent 二值，实得 ' + firstComment.by)
  assert(firstComment.text === '这条不错', '评论 text 原样回传')
  assert(firstComment.at === NOW, '评论时间字段是 at（客户端 normalizeComment 读 item.at），实得 ' + firstComment.at)
  assert(!('w' in firstComment) && !('t' in firstComment), '评论不是原型的老形状（w/t），而是 host 契约形状')

  /* ── 扁平形态：DELETE /post { id } → { ok } ── */
  const del = await call('/post', { method: 'DELETE', body: { id: 'p_flat' } })
  assert(del.json?.ok === true, '扁平 DELETE /post {id} 成功（客户端契约）')
  const listAfter = await call('/posts')
  const idsAfter = listAfter.json.days.flatMap(day => day.items.map(item => item.id))
  assert(idsAfter.includes('p_flat') === false, '验收3：扁平 DELETE 后该动态不再出现')
  const rawAfter = await storeF.getPost('p_flat')
  assert(rawAfter !== undefined && rawAfter.deletedAt > 0, '扁平 DELETE 是软删（记录还在、带 deletedAt）')

  /* ── RESTful 形态继续可用（两种并存，谁也不必改）── */
  const restLike = await call('/posts/p_rest/like', { method: 'POST', body: { liked: true } })
  assert(restLike.json?.ok === true && restLike.json.liked === true,
    'RESTful POST /posts/:id/like 仍然可用（与新形态并存）')
  const restComment = await call('/posts/p_rest/comments', { method: 'POST', body: { text: '也走老形态' } })
  assert(restComment.json?.ok === true, 'RESTful POST /posts/:id/comments 仍然可用')

  /* ── 两种形态走同一段逻辑（不能各写一份，否则迟早漂移）──
   *
   * ⚠ 这里必须**立刻取标量值**，不能把两次 getPost 的返回值存下来再比。
   * store.patchPost / getPost 返回的是内存里**同一个对象引用**（store 是唯一
   * 事实源，不做防御性拷贝），所以第二次翻转会连第一次拿到的那个对象一起改掉，
   * 两个变量都读到最终值 —— 断言会以「两边都是 false」这种假象失败，
   * 看起来像功能坏了，实际是测试自己的引用陷阱。
   */
  await storeF.addPosts([post({ id: 'p_same', createdAt: NOW - 3 * HOUR })])
  await call('/like', { method: 'POST', body: { id: 'p_same' } })
  const likedAfterFlat = (await storeF.getPost('p_same'))?.liked
  await call('/posts/p_same/like', { method: 'POST', body: {} })
  const likedAfterRest = (await storeF.getPost('p_same'))?.liked
  assert(likedAfterFlat === true && likedAfterRest === false,
    '两种形态作用在**同一份状态**上（扁平点赞=true，RESTful 再点=取消），实得 '
    + likedAfterFlat + ' / ' + likedAfterRest)

  /* ── /refresh 的 state 字段（客户端 refreshFeed 读它）── */
  const refresh = await call('/refresh', { method: 'POST', body: {} })
  assert(refresh.json?.ok === true, 'POST /refresh 成功')
  assert(refresh.json?.state === 'queued', 'POST /refresh 回 state 字段（客户端读 state，不是 result），实得 ' + refresh.json?.state)
  assert(refresh.json?.result === refresh.json?.state, 'result 与 state 同值（内部冒烟用 result，契约用 state）')

  /* ── /status 的平铺字段（客户端靠 running 决定要不要继续轮询）── */
  const status = await call('/status')
  for (const field of ['running', 'lastRunAt', 'nextRunAt', 'promptHash', 'model']) {
    assert(field in (status.json ?? {}), 'GET /status 平铺字段存在：' + field)
  }
  assert(typeof status.json.running === 'boolean', 'status.running 是布尔（客户端据此轮询），实得 ' + typeof status.json.running)
  assert(typeof status.json.nextRunAt === 'number', 'status.nextRunAt 是数字')
  assert(typeof status.json.promptHash === 'string' && status.json.promptHash.length > 0, 'status.promptHash 非空')

  /* ── /config 与 /posts 的字段名（客户端 normalize 后不报错）── */
  const cfg = await call('/config')
  assert(typeof cfg.json?.config?.prompt === 'string', 'GET /config 回 config.prompt（客户端 fetchFeedConfig 读它）')
  assert(typeof cfg.json?.config?.model === 'string', 'GET /config 回 config.model')
  const posts = await call('/posts?channel=all')
  assert(Array.isArray(posts.json?.days), 'GET /posts?channel=all 回 days（客户端 fetchFeedPosts 读它）')
  const firstPost = posts.json.days[0].items[0]
  for (const field of ['id', 'createdAt', 'topics', 'title', 'body', 'sources', 'dueAt',
    'dueLabel', 'likes', 'liked', 'comments', 'read', 'runId']) {
    assert(field in firstPost, '客户端 FeedPost 镜像字段存在：' + field)
  }
  assert(typeof firstPost.read === 'boolean' && typeof firstPost.liked === 'boolean',
    'read / liked 都是布尔（客户端 normalizePost 用 item.read === true 判）')

  await new Promise(ok => server.close(ok))
}


console.log('\n=== 9. 真实 writer：纯逻辑（不碰网络、不碰模型）===');

/* 这一组全部是**纯函数**：检索意图规划、来源清单、JSON 容错、闸 2 校验。
 * 它们决定了「模型能不能编造来源」与「模型胡说时会不会落地」，是本轮改动
 * 里最该被钉死的部分 —— 而且完全可以在无网络环境下测。 */

/* ── 9.1 检索意图规划：从提示词拆 2-3 条 query ── */
{
  const queries = writerMod.planQueries('盯住健身与睡眠，只收一手来源，每天两三条就够', NOW)
  assert(queries.length >= 2 && queries.length <= 3,
    '检索意图拆成 2-3 条（多了慢且容易被限），实得 ' + queries.length + '：' + JSON.stringify(queries))

  // 动作词（盯住/只收/每天两三条）不该进主题词 —— 拿它们去搜召回全是垃圾。
  const keywords = writerMod.extractKeywords('盯住健身与睡眠，只收一手来源，每天两三条就够')
  assert(keywords.includes('健身') && keywords.includes('睡眠'),
    '主题词抽出了「健身 / 睡眠」，实得 ' + JSON.stringify(keywords))
  assert(keywords.includes('盯住') === false, '动作词「盯住」不作为检索词，实得 ' + JSON.stringify(keywords))
  assert(keywords.includes('一手') === false && keywords.includes('来源') === false,
    '虚词（一手 / 来源）不作为检索词，实得 ' + JSON.stringify(keywords))

  // 第 3 条 query 带日期：纯语义 query 容易召回旧文章。
  const today = writerMod.formatTodayCn(NOW)
  assert(queries.some(query => query.includes(today)),
    '至少一条 query 带今天日期（让检索落在「最近」上），实得 ' + JSON.stringify(queries))

  // 提示词是空串时不该崩，也不该产出空 query。
  const emptyQueries = writerMod.planQueries('   ', NOW)
  assert(emptyQueries.length === 0, '空提示词不产 query（不崩），实得 ' + JSON.stringify(emptyQueries))

  // 只差空格/标点的两条 query 不该各搜一次（白白多花一次检索额度）。
  const dupQueries = writerMod.planQueries('健身', NOW)
  const norm = dupQueries.map(q => q.replace(/\s+/g, '').toLowerCase())
  assert(new Set(norm).size === norm.length, '规划出的 query 归一化后互不重复，实得 ' + JSON.stringify(dupQueries))
}

/* ── 9.1b 每轮条数由「账号数」推导（用户 2026-10-28：「所有账号而不是有上限」）── */
{
  /*
   * 这条断言钉的是**语义**：关注的账号越多，这一轮该写的条数越多 ——
   * 而不是像前两版那样固定 5 / 12 条，导致「关注 7 个账号总有 2 个没动态」。
   */
  assert(writerMod.postsAskedFor(1) === 3, '只有 1 个账号时也至少写 3 条，实得 ' + writerMod.postsAskedFor(1))
  assert(writerMod.postsAskedFor(6) === 12, '6 个账号 → 12 条（每账号 2 条余量），实得 ' + writerMod.postsAskedFor(6))
  /*
   * 2026-10-28 用户要求「去掉名额限制」：条数**不再有上限**，完全跟着账号数走。
   * 前几版都栽在同一个地方 —— 任何固定上限（5 / 12 / 40）都意味着
   * 「关注更多账号时，总有几个写不出来」。
   */
  assert(writerMod.postsAskedFor(20) === 40,
    '20 个账号 → 40 条（不再封顶），实得 ' + writerMod.postsAskedFor(20))
  assert(writerMod.postsAskedFor(50) === 100,
    '50 个账号 → 100 条（上限已去掉，完全按账号数算），实得 ' + writerMod.postsAskedFor(50))
  assert(writerMod.postsAskedFor(0) === 3, '没有 X 账号时也写 3 条（网页来源照常），实得 ' + writerMod.postsAskedFor(0))
  assert(writerMod.postsAskedFor(6) > writerMod.postsAskedFor(3),
    '账号越多条数越多（不是固定值），6→' + writerMod.postsAskedFor(6) + ' / 3→' + writerMod.postsAskedFor(3))

  // 账号数只数 X 来源，且按 @handle 去重（同一个账号的多条推文算 1 个）。
  const count = writerMod.countDistinctXAccounts([
    { url: 'https://x.com/a/status/1', title: '@a · A' },
    { url: 'https://x.com/a/status/2', title: '@a · A' },
    { url: 'https://x.com/b/status/3', title: '@b · B' },
    { url: 'https://news.example/x', title: '普通网页' },
  ])
  assert(count === 2, '只数 X 来源并按 handle 去重（a 的两条算 1 个），实得 ' + count)
}

/* ── 9.2 检索结果合并：URL 去重 + 只认 http(s) ── */
{
  const merged = writerMod.mergeSearchResults([
    { queryIndex: 0, sources: [
      { url: 'https://example.com/a', title: 'A' },
      { url: 'https://example.com/a#frag', title: 'A 重复（只差 fragment）' },
      { url: 'mailto:someone@example.com' },
      { url: 'not-a-url' },
    ] },
    { queryIndex: 1, sources: [
      { url: 'https://example.com/a/', title: 'A 重复（只差末尾斜杠）' },
      { url: 'https://example.org/b', title: 'B' },
    ] },
  ])
  assert(merged.length === 2, 'URL 去重后只剩 2 条（fragment / 末尾斜杠视为同一条），实得 '
    + merged.length + '：' + JSON.stringify(merged.map(item => item.url)))
  assert(merged.every(item => /^https?:\/\//.test(item.url)), '非 http(s) 来源被丢弃（既不能验活也不能展示）')

  const capped = writerMod.mergeSearchResults([
    { queryIndex: 0, sources: Array.from({ length: 20 }, (_, index) => ({ url: 'https://e.com/' + index })) },
  ], 5)
  assert(capped.length === 5, '候选 URL 数量受上限约束，实得 ' + capped.length)
}

/* ── 9.3 来源清单：模型只能看到下标，看不到 URL（闸 2 的结构保证）── */
{
  const sources = [
    { index: 0, url: 'https://real-site.example/secret-path/123', domain: 'real-site.example',
      title: '真实来源一', access: 'open', body: '正文摘要一', clue: '', fetchedAt: NOW },
    { index: 1, url: 'https://limited.example/x', domain: 'limited.example',
      title: '不开放来源', access: 'limited', body: '', clue: '只有话题线索', fetchedAt: NOW },
  ]
  const text = writerMod.formatSourceListForPrompt(sources)
  assert(text.includes('[0]') && text.includes('[1]'), '清单带下标（模型引用它们），实得：' + text.slice(0, 80))
  /*
   * 域名**可以**出现在清单里：模型需要它判断来源类型（媒体 / 官方文档 / 博客），
   * 而且"域名 + 没有路径"拼不出一个可访问的地址。真正必须挡住的是
   * **协议头与路径** —— 那才构成一个完整 URL，模型才能照抄或改写。
   */
  assert(text.includes('http://') === false && text.includes('https://') === false,
    '⚠ 清单里**不出现协议头**（否则模型能直接抄一个 URL）')
  assert(text.includes('/secret-path/123') === false, '⚠ 清单里**不出现 URL 路径**（闸 2 的结构保证：只有域名拼不出地址）')
  assert(text.includes('正文摘要一'), 'open 来源的正文摘录进清单（给模型当上下文）')
  assert(text.includes('只有话题线索'), 'limited 来源只给话题线索')
  assert(text.includes('不开放抓取'), 'limited 来源被明确标注（模型据此知道没有正文可抄）')

  // 一条来源都没有时，明确告诉模型别编链接。
  const emptyText = writerMod.formatSourceListForPrompt([])
  assert(emptyText.includes('不要编造'), '无来源时提示模型不要编造链接，实得：' + emptyText.slice(0, 60))
}

/* ── 9.4 JSON 解析：围栏 / 前后说明 / 裸数组 / 单对象都要认 ── */
{
  const canonical = writerMod.parseWriterOutput('{"posts":[{"title":"T","body":"B","sourceIds":[0],"topics":["tech"]}]}')
  assert(canonical !== null && canonical.posts.length === 1, '标准形态解析成功')
  assert(canonical.posts[0].sourceIds[0] === 0, 'sourceIds 解析为数字数组')

  // 围栏里的换行必须用转义写（源码里放真换行会让字符串字面量断行）。
  const fence = '\u0060\u0060\u0060'
  const fenced = writerMod.parseWriterOutput(fence + 'json\n'
    + '{"posts":[{"title":"T","body":"B"}]}' + '\n' + fence)
  assert(fenced !== null && fenced.posts.length === 1, 'markdown 围栏包着的 JSON 也能解析')

  const chatty = writerMod.parseWriterOutput('好的，我给你写了这些：\n'
    + '{"posts":[{"title":"T","body":"B"}]}' + '\n希望你喜欢！')
  assert(chatty !== null && chatty.posts.length === 1, '前后夹带解释文字也能抠出 JSON')

  const bare = writerMod.parseWriterOutput('[{"title":"T","body":"B"}]')
  assert(bare !== null && bare.posts.length === 1, '裸数组形态也能解析')

  const single = writerMod.parseWriterOutput('{"title":"T","body":"B"}')
  assert(single !== null && single.posts.length === 1, '只给一个对象（没包数组）也能解析')

  const missing = writerMod.parseWriterOutput('模型今天不想干活，什么也没给。')
  assert(missing === null, '完全没有 JSON 结构时返回 null（调用方据此重试）')

  // 截断的 JSON（max-tokens 常见形态）也要能抠出一部分。
  const truncated = writerMod.parseWriterOutput('{"posts":[{"title":"T","body":"B"}]')
  assert(truncated !== null && truncated.posts.length === 1, '被截断的 JSON（缺收尾括号）也能解析')

  // 字段容错：编号写成字符串、缺字段、多字段都不该炸。
  const loose = writerMod.parseWriterOutput(JSON.stringify({
    posts: [
      { title: 'T1', body: 'B1', sourceIds: ['0', 1] },
      { title: '', body: '' },
      null,
    ],
  }))
  assert(loose !== null && loose.posts.length === 1, '畸形条目被跳过，好条目留下')
  assert(JSON.stringify(loose.posts[0].sourceIds) === JSON.stringify([0, 1]),
    'sourceIds 里的字符串编号被转成数字，实得 ' + JSON.stringify(loose.posts[0].sourceIds))
  assert(loose.malformed === 2, '畸形条目计数正确，实得 ' + loose.malformed)
}

/* ── 9.5 闸 2：sourceIds 越界必须整帖丢弃 ── */
{
  const sources = [
    { index: 0, url: 'https://a.example/1', domain: 'a.example', title: 'A', access: 'open', body: 'x', clue: '', fetchedAt: NOW },
    { index: 1, url: 'https://b.example/2', domain: 'b.example', title: 'B', access: 'open', body: 'y', clue: '', fetchedAt: NOW },
  ]
  const ok = writerMod.validateModelPosts(
    [{ title: '好帖', body: '这是一段足够长的正常正文内容。', sourceIds: [0, 1], topics: ['tech'], dueInHours: 0 }],
    sources, NOW)
  assert(ok.accepted.length === 1 && ok.dropped === 0, '合法 sourceIds 的帖子通过校验')

  const outOfRange = writerMod.validateModelPosts(
    [{ title: '编造帖', body: '这是一段足够长的正文内容。', sourceIds: [0, 5], topics: [], dueInHours: 0 }],
    sources, NOW)
  assert(outOfRange.accepted.length === 0 && outOfRange.dropped === 1,
    '⚠ 闸 2：sourceIds 越界（引用不存在的第 5 条）→ 整帖丢弃，实得 accepted='
    + outOfRange.accepted.length + ' dropped=' + outOfRange.dropped)
  assert(outOfRange.reasons[0].includes('不存在的来源编号'),
    '丢弃原因写明了是编号越界，实得：' + outOfRange.reasons[0])

  const noRef = writerMod.validateModelPosts(
    [{ title: '无出处帖', body: '这是一段足够长的正文内容。', sourceIds: [], topics: [], dueInHours: 0 }],
    sources, NOW)
  assert(noRef.accepted.length === 0,
    '⚠ 有可用来源却一条都不引用 → 丢弃（无出处的「新闻」不可信），实得 accepted=' + noRef.accepted.length)

  const emptyBody = writerMod.validateModelPosts(
    [{ title: '标题', body: '   ', sourceIds: [0], topics: [], dueInHours: 0 }],
    sources, NOW)
  assert(emptyBody.accepted.length === 0, '空正文丢弃（空帖进列表就是一行空白）')

  // 模型「回忆」出来的链接必须被剥掉（清单里根本没有 URL 可抄）。
  const withUrl = writerMod.validateModelPosts(
    [{ title: '标题', body: '详见 https://fake-url.example/news/123 这篇报道，值得一读。', sourceIds: [0], topics: [], dueInHours: 0 }],
    sources, NOW)
  assert(withUrl.accepted.length === 1, '正文带链接的帖子仍然通过（只是链接被剥掉）')
  assert(withUrl.accepted[0].body.includes('fake-url') === false,
    '⚠ 模型编造的 URL 被剥离（清单里没有 URL 可抄，出现的都是编的），实得：' + withUrl.accepted[0].body)

  // 无来源时允许零引用（降级场景），不该被这条规则挡掉。
  const noSourcesAtAll = writerMod.validateModelPosts(
    [{ title: '无检索帖', body: '这是一段足够长的正常正文内容。', sourceIds: [], topics: [], dueInHours: 0 }],
    [], NOW)
  assert(noSourcesAtAll.accepted.length === 1,
    '本轮完全没有来源时，零引用帖子允许通过（降级路径，不能连降级都堵死）')

  /*
   * 一条动态只能有一个「原文」（2026-10-28 用户报障）。
   *
   * 用户截图原话：「一条动态怎么可能有两个原文，而且两个原文的动态都是不一样的」。
   * 实测那条帖把 lauren 的两条推文（晒新域名 / 招 grok bot）揉进同一段正文，
   * sourceIds 同时引用了两个 x.com 编号 → 来源浮层出现两条互不相干的推文。
   * 兜底口径：x.com 来源只保留第一个（= 界面那个「原文」块对应的那条），
   * 网页来源不受影响（它们没有「原文」这层语义）。
   */
  const tweetSources = [
    { index: 0, url: 'https://x.com/poteto/status/1', domain: 'x.com', title: '@poteto · lauren', access: 'limited', body: '', clue: '买了新域名', fetchedAt: NOW },
    { index: 1, url: 'https://x.com/poteto/status/2', domain: 'x.com', title: '@poteto · lauren', access: 'limited', body: '', clue: '招 grok bot', fetchedAt: NOW },
    { index: 2, url: 'https://news.example/a', domain: 'news.example', title: 'A', access: 'open', body: 'x', clue: '', fetchedAt: NOW },
  ]
  const twoTweets = writerMod.validateModelPosts(
    [{ title: '两条推文', body: '这是一段足够长的正常正文内容。', sourceIds: [0, 1, 2], topics: [], dueInHours: 0 }],
    tweetSources, NOW)
  assert(twoTweets.accepted.length === 1, '引用两条推文的动态仍然通过（不整帖丢弃）')
  const keptTweets = twoTweets.accepted[0].sources.filter(s => s.domain === 'x.com')
  assert(keptTweets.length === 1,
    '⚠ 一条动态只保留一条 X 推文来源（第二个推文被丢弃），实得 ' + keptTweets.length)
  assert(keptTweets[0].url === 'https://x.com/poteto/status/1',
    '保留的是 sourceIds 里第一个推文，实得 ' + keptTweets[0].url)
  assert(twoTweets.accepted[0].sources.filter(s => s.domain === 'news.example').length === 1,
    '网页来源不受影响（一条动态可以引用多篇网页）')
}

/* ── 9.6 dueLabel / 输出预算 ── */
{
  assert(writerMod.dueLabelOf(0, NOW) === '', '无截止时 dueLabel 为空串')
  const dueToday = writerMod.dueLabelOf(NOW + 2 * HOUR, NOW)
  assert(dueToday.startsWith('今天'), '当天截止的文案以「今天」开头，实得 ' + dueToday)
  // ⚠ 时钟是 20:00，所以「明天」只能用 <4 小时之后的小时数：+5h = 次日 01:00，
  // 而 +30h 会落到后天（那天既不是今天也不是明天，按 M/D 显示）。
  const dueTomorrow = writerMod.dueLabelOf(NOW + 5 * HOUR, NOW)
  assert(dueTomorrow.startsWith('明天'), '次日截止的文案以「明天」开头，实得 ' + dueTomorrow)
  const dueLater = writerMod.dueLabelOf(NOW + 3 * DAY, NOW)
  assert(/^\d+\/\d+ /.test(dueLater), '更远的截止按 月/日 显示，实得 ' + dueLater)

  assert(writerMod.outputBudget(undefined) === 16384,
    '拿不到模型声明时用 16384 的输出预算（reasoningEffort=max 时思考链很长），实得 ' + writerMod.outputBudget(undefined))
  assert(writerMod.outputBudget(4096) === 4096, '模型声明的上限优先（4096 就按 4096）')
  assert(writerMod.outputBudget(128000) === 16384, '声明很大时不盲目放大（16384 够写几条动态），实得 ' + writerMod.outputBudget(128000))
}


console.log('\n=== 10. 真实 writer：完整流水线（注入假 web / 假 llm，不碰网络）===');

/* 这一组测的是**整条链路**：检索 → 验活 → 组装清单 → 模型写作 → 解析 → 校验。
 *
 * 关键：全部通过注入假服务完成 —— 假 web 返回假搜索结果、假 fetch 返回假正文，
 * 假 llm 返回一段我写死的"模型输出"。所以它既能验证"链路真的走通了"，
 * 又不需要网络、不需要真模型、不花一分钱 token。
 *
 * 假 llm 还顺手当**探针**：它记录收到的请求（provider / model / system / user），
 * 断言据此确认「路由解析对不对」「来源清单是不是只有下标」。 */

/** 造一个假 llm：按给定的输出流式吐字，并记录收到的请求。 */
function fakeLlm(options) {
  const calls = []
  const output = options.output ?? ''
  const failure = options.failure ?? null
  return {
    calls,
    listProviders: () => [{ id: 'fake-provider', name: '假供应商' }],
    listModels: async () => [{ id: 'fake-model-a', name: '假模型 A' }, { id: 'fake-model-b', name: '假模型 B' }],
    resolveModelInfo: async () => ({ defaultMaxTokens: 128000 }),
    stream: (request) => {
      calls.push(request)
      return (async function* () {
        // 分块吐字，验证 text-delta 的累积逻辑（真实适配器就是这么发）
        for (let index = 0; index < output.length; index += 40) {
          yield { type: 'text-delta', index: 0, text: output.slice(index, index + 40) }
        }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 200 } }
        yield failure === null
          ? { type: 'finish', reason: { kind: 'stop' } }
          : { type: 'finish', reason: { kind: 'error', failure: { message: failure, code: 'ERR' } } }
      })()
    },
  }
}

/** 造一个假 launcher：拿一个假的 agentDefaultModel（模拟用户当前在用的模型）。 */
function fakeServices(extra = {}) {
  const services = {
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'fake-provider', model: 'fake-model-a', reasoningEffort: 'max' }),
    },
    ...extra,
  }
  return (name) => services[name]
}

/** 造一个假 web：搜索返回固定 sources，fetch 返回固定正文。 */
function fakeWeb(over = {}) {
  const searched = []
  const fetched = []
  return {
    searched,
    fetched,
    search: async (request) => {
      searched.push(request.query)
      if (over.searchThrows === true) throw new Error('fake search exploded')
      return {
        sources: [
          { url: 'https://news.example/ai-1', title: 'AI 进展' },
          { url: 'https://blog.example/post-2', title: '技术博客' },
          { url: 'https://paywall.example/x', title: '付费墙文章' },
          { url: 'https://x.com/someone/status/1', title: 'X 上的推文' },
        ],
        truncated: false,
      }
    },
    fetch: async (request) => {
      fetched.push(request.url)
      if (request.url === 'https://paywall.example/x') {
        return { url: request.url, statusCode: 200, body: { kind: 'html', content: '<html><body>订阅后阅读' + 'x'.repeat(400) + '</body></html>' } }
      }
      return {
        url: request.url,
        statusCode: 200,
        body: { kind: 'html', content: '<html><body><p>' + '这是一篇真实来源的正文内容。'.repeat(40) + '</p></body></html>' },
      }
    },
  }
}

/* ── 10.1 主链路：一条完整的「检索 → 写作 → 校验 → 落地」── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeG = resolve(ROOT, '_tmp', 'smoke-feed-home-g')
  try { rmSync(homeG, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeG, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeG
  const storeG = new StoreClass()
  await storeG.load()
  process.env.DSH_HOME = prevHome

  await storeG.setConfig({ prompt: '盯住 AI 与开源模型', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  const llm = fakeLlm({
    output: JSON.stringify({ posts: [{
      title: '开源模型又有新进展',
      body: '今天公开的一份报告显示，开源模型的推理能力已经接近闭源产品。对长期跟踪这一领域的人来说，值得留意它的实测数据。',
      sourceIds: [0, 1],
      topics: ['tech'],
      dueInHours: 0,
    }] }),
  })
  const web = fakeWeb()
  const realWriter = writerMod.createRealWriter({
    getService: fakeServices(),
    llm,
    web,
    now: () => NOW,
  })
  const runner = trigger.createFeedRunner({ store: storeG, writer: realWriter, now: () => NOW, syncX: false })
  await runner.requestRun('manual')
  await runner.idle()

  const posts = await storeG.listPosts()
  assert(posts.length === 1, '完整流水线产出了 1 条动态，实得 ' + posts.length)
  const post = posts[0]
  assert(post.title === '开源模型又有新进展', '标题来自模型输出（不是模板拼的），实得 ' + post.title)
  assert(post.body.includes('开源模型'), '正文来自模型输出，实得 ' + post.body.slice(0, 40))
  assert(post.body.includes('占位') === false, '⚠ 正文里没有任何「占位」字样（不许再有占位内容）')

  // 来源必须是**真实验活过的那几条**，其中付费墙那条要被丢弃。
  assert(post.sources.length === 2, '落地 2 条来源（对应 sourceIds [0,1]），实得 ' + post.sources.length)
  assert(post.sources[0].url === 'https://news.example/ai-1',
    '来源 URL 是**清单里的真实 URL**（模型只给了下标 0），实得 ' + post.sources[0].url)
  assert(post.sources.every(item => item.url.includes('paywall') === false),
    '付费墙来源被判 blocked 后整条丢弃，没有出现在落地结果里')

  // 假 llm 当探针：确认路由解析与提示词组装都对。
  assert(llm.calls.length === 1, '模型只被调用 1 次（没有多余重试），实得 ' + llm.calls.length)
  const request = llm.calls[0]
  assert(request.provider === 'fake-provider' && request.model === 'fake-model-a',
    'config.model="default" 解析成了 agentDefaultModel 的当前模型，实得 ' + request.provider + '/' + request.model)
  assert(request.reasoningEffort === 'max',
    '⚠ reasoningEffort 从 currentSelection 原样透传（不传会让模型行为与会话里不一致），实得 ' + request.reasoningEffort)
  assert(typeof request.system === 'string' && request.system.includes('绝不输出任何网址'),
    'system 提示词明确禁止输出网址（闸 2 的措辞层）')
  const userText = request.messages[0].content[0].text
  assert(userText.includes('[0]') && userText.includes('[1]'), '给模型的是带下标的来源清单，实得：' + userText.slice(0, 60))
  assert(userText.includes('https://news.example/ai-1') === false,
    '⚠ 提示词里**没有 URL**（模型连抄的机会都没有），实得片段：' + userText.slice(0, 120))

  // run.stats 必须能证明链路真的走到每一步（用户/Lead 的验收依据）。
  const runs = await storeG.listRuns()
  const run = runs[0]
  assert(run.status === 'ok', 'run.status 是 ok，实得 ' + run.status)
  assert(run.stats.queries >= 1, 'stats.queries 记录了检索条数，实得 ' + run.stats.queries)
  assert(run.stats.sourcesOpen >= 1, 'stats.sourcesOpen 记录了 open 来源数，实得 ' + run.stats.sourcesOpen)
  assert(run.stats.sourcesBlocked >= 1, 'stats.sourcesBlocked 记录了被丢弃的付费墙来源，实得 ' + run.stats.sourcesBlocked)
  assert(run.stats.rawChars > 0, 'stats.rawChars 记录了模型返回的字符数，实得 ' + run.stats.rawChars)
  /*
   * ⚠ 这条断言是本轮改动里最关键的一条（Lead 明确点名的验收判据）：
   * 配置里存的是 'default'，如果原样记下来，用户在界面上看到的就是
   * 「上轮模型：default」—— 一句没有信息量的鬼话。必须是真实路由
   * provider/model，才能回答"用的确实是这个模型吗"。
   */
  assert(run.stats.modelUsed === 'fake-provider/fake-model-a',
    '⚠ stats.modelUsed 是真实路由 provider/model（不是配置值 default），实得 ' + run.stats.modelUsed)
  assert(run.modelUsed === 'fake-provider/fake-model-a',
    '⚠ run.modelUsed（这一轮的记录）也是真实路由，实得 ' + run.modelUsed)
  assert(run.stats.modelLabel === '假模型 A',
    'stats.modelLabel 记人类可读名（界面展示用），实得 ' + run.stats.modelLabel)
  assert(run.stats.modelResolution === 'agentDefaultModel',
    'stats.modelResolution 如实标注解析路径（agentDefaultModel = 真的当前模型），实得 ' + run.stats.modelResolution)

  /*
   * ── 重启后过程计数不丢 ──
   *
   * normalizeRun 漏一个字段的后果比"字段本身缺失"严重得多：用户点更新看到
   * 「模型 alymagpie/... 写了 2400 字符」→ 刷新/重启 → 那几个数全空，看起来
   * 像"那轮根本没跑"。所以这里用**同一个数据目录**造一个新 store 实例
   * （模拟进程重启）再读一遍。
   */
  // 复用块顶部的 prevHome（同作用域不能再声明一次）。
  process.env.DSH_HOME = homeG
  const storeReloaded = new StoreClass()
  await storeReloaded.load()
  process.env.DSH_HOME = prevHome
  const reloadedRun = (await storeReloaded.listRuns())[0]
  assert(reloadedRun !== undefined, '重启后仍能读到上一轮的 run 记录')
  assert(reloadedRun.stats.queries > 0,
    '重启后 stats.queries 还在（归一化没有漏字段），实得 ' + reloadedRun.stats.queries)
  assert(reloadedRun.stats.rawChars > 0, '重启后 stats.rawChars 还在，实得 ' + reloadedRun.stats.rawChars)
  assert(reloadedRun.stats.modelUsed === 'fake-provider/fake-model-a',
    '重启后 stats.modelUsed 仍是真实路由（不是 default、也没被洗成空），实得 ' + reloadedRun.stats.modelUsed)
  assert(reloadedRun.stats.modelResolution === 'agentDefaultModel',
    '重启后 stats.modelResolution 还在，实得 ' + reloadedRun.stats.modelResolution)
}

/* ── 10.2 web 不可用 → 降级成「本轮无检索」，但仍然让模型写 ── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeH = resolve(ROOT, '_tmp', 'smoke-feed-home-h')
  try { rmSync(homeH, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeH, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeH
  const storeH = new StoreClass()
  await storeH.load()
  process.env.DSH_HOME = prevHome
  await storeH.setConfig({ prompt: '盯住 AI', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  const llm = fakeLlm({
    output: JSON.stringify({ posts: [{ title: '无检索也能写', body: '本次没有检索到外部来源，这条内容完全基于关注点撰写。', sourceIds: [], topics: ['mine'], dueInHours: 0 }] }),
  })
  const realWriter = writerMod.createRealWriter({
    getService: fakeServices(),
    llm,
    web: null, // ← web 服务不可用
    now: () => NOW,
  })
  const runner = trigger.createFeedRunner({ store: storeH, writer: realWriter, now: () => NOW, syncX: false })
  await runner.requestRun('manual')
  await runner.idle()

  const posts = await storeH.listPosts()
  assert(posts.length === 1, '⚠ web 不可用时**仍然产出内容**（降级不阻断写作），实得 ' + posts.length)
  assert(posts[0].sources.length === 0, '降级产出的帖子标注为无来源（不假装有出处）')
  const run = (await storeH.listRuns())[0]
  assert(run.status === 'ok', '降级路径的 run 状态是 ok（不是 failed）')
  assert(String(run.stats.degraded ?? '').includes('检索不可用'),
    'stats.degraded 如实记录降级原因，实得：' + run.stats.degraded)
}

/* ── 10.3 ⚠ 写作失败 ⇒ 0 条 + failed，**绝不产占位内容** ── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeI = resolve(ROOT, '_tmp', 'smoke-feed-home-i')
  try { rmSync(homeI, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeI, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeI
  const storeI = new StoreClass()
  await storeI.load()
  process.env.DSH_HOME = prevHome
  await storeI.setConfig({ prompt: '盯住 AI', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  /* ① 模型调用报错 */
  const failingWriter = writerMod.createRealWriter({
    getService: fakeServices(),
    llm: fakeLlm({ output: '', failure: '配额用尽' }),
    web: fakeWeb(),
    now: () => NOW,
  })
  const runner1 = trigger.createFeedRunner({ store: storeI, writer: failingWriter, now: () => NOW, syncX: false })
  await runner1.requestRun('manual')
  await runner1.idle()
  let posts = await storeI.listPosts()
  assert(posts.length === 0, '⚠⚠ 模型调用失败 → **0 条帖子**（断言：不许产占位内容），实得 ' + posts.length)
  let run = (await storeI.listRuns())[0]
  assert(run.status === 'failed', '⚠ 模型调用失败 → run.status = failed，实得 ' + run.status)
  assert(String(run.error).includes('配额用尽'), 'run.error 写明失败原因，实得 ' + run.error)
  // ⑤ 场景的反向判据：真故障绝不许带「没有新内容」标记（带了就会被画成中性灰）。
  assert(run.stats.noNewContent !== true,
    '⚠⚠ ⑤ 模型调用报错必须仍是 failed 且**不带** noNewContent 标记（不许把故障伪装成判重），实得 '
    + run.stats.noNewContent)

  /* ② 模型返回一堆非 JSON 的废话（重试一次后仍然解析不了） */
  const garbageWriter = writerMod.createRealWriter({
    getService: fakeServices(),
    llm: fakeLlm({ output: '我今天不想写 JSON，给你写一首诗吧。春眠不觉晓，处处闻啼鸟。' }),
    web: fakeWeb(),
    now: () => NOW,
  })
  const runner2 = trigger.createFeedRunner({ store: storeI, writer: garbageWriter, now: () => NOW, syncX: false })
  await runner2.requestRun('manual')
  await runner2.idle()
  posts = await storeI.listPosts()
  assert(posts.length === 0, '⚠⚠ 模型返回非 JSON → 仍然 0 条（重试 1 次后放弃，不产占位）')
  run = (await storeI.listRuns())[0]
  assert(run.status === 'failed', '非 JSON 输出 → run.status = failed，实得 ' + run.status)
  assert(String(run.error).includes('JSON'), 'run.error 指明是 JSON 解析失败，实得 ' + run.error)
  assert(run.stats.noNewContent !== true,
    '⚠⚠ ④ JSON 解析失败必须仍是 failed 且不带 noNewContent 标记，实得 ' + run.stats.noNewContent)

  /* ③ 模型编造了不存在的来源编号（闸 2 必须挡下来） */
  const fabricateWriter = writerMod.createRealWriter({
    getService: fakeServices(),
    llm: fakeLlm({ output: JSON.stringify({ posts: [{ title: '编造帖', body: '这条引用了不存在的第 99 条来源。', sourceIds: [99], topics: [], dueInHours: 0 }] }) }),
    web: fakeWeb(),
    now: () => NOW,
  })
  const runner3 = trigger.createFeedRunner({ store: storeI, writer: fabricateWriter, now: () => NOW, syncX: false })
  await runner3.requestRun('manual')
  await runner3.idle()
  posts = await storeI.listPosts()
  assert(posts.length === 0, '⚠⚠ 模型编造来源编号 → 整帖丢弃，0 条落地')
  run = (await storeI.listRuns())[0]
  assert(run.status === 'failed', '全部帖被闸 2 拦下 → run.status = failed，实得 ' + run.status)
  assert(String(run.error).includes('不存在的来源编号'), 'run.error 说明是编号越界，实得 ' + run.error)
  assert(run.stats.noNewContent !== true,
    '⚠⚠ ③ 有产出但全部校验失败必须仍是 failed 且不带 noNewContent 标记，实得 ' + run.stats.noNewContent)

  /* ④ writer 返回空数组（模型说"今天没什么可写的"） */
  const emptyRunner = trigger.createFeedRunner({
    store: storeI,
    writer: async () => [],
    now: () => NOW,
    syncX: false,
  })
  await emptyRunner.requestRun('manual')
  await emptyRunner.idle()
  posts = await storeI.listPosts()
  assert(posts.length === 0, 'writer 返回空数组 → 0 条（不补占位）')
  run = (await storeI.listRuns())[0]
  assert(run.status === 'failed' && String(run.error).includes('0 条草稿'),
    'writer 返回空数组 → failed 且说明原因，实得 status=' + run.status + ' error=' + run.error)
  assert(run.stats.noNewContent !== true,
    '⚠⚠ 裸 writer 返回空数组（没有判重标记）必须仍是 failed —— 只有「模型明说跳过了 N 条」才算 skipped')
  assert(storeI !== undefined, '（store 引用保持）')
}

/* ── 10.4 ⚠ 全仓库不许再有占位 writer 的落地实现 ── */
{
  /*
   * ⚠ 占位 writer 的判据是「**产不出任何内容**」，不是「符号不存在」。
   *
   * 它仍然被 src/host.ts re-export（另一个人的作用域），直接删符号会让那条
   * re-export 变成 undefined —— 而 esbuild 对此静默放行，构建绿、产物能
   * import，调用时才炸 "is not a function"。所以保留函数名、把行为改成抛错：
   * 语义上没有任何人还能拿到占位内容，导出面也不断裂。
   */
  assert(typeof trigger.createPlaceholderWriter === 'function',
    'createPlaceholderWriter 函数名保留（避免 host.ts 的 re-export 变成 undefined）')
  let placeholderThrew = null
  try {
    await trigger.createPlaceholderWriter()({
      runId: 'r_t', trigger: 'manual',
      config: { prompt: 'p', model: 'default', cron: '0 12,18 * * *', xHandles: [] },
      promptHash: 'h', freshTweets: [], staleTweets: [], sync: null, now: NOW,
    })
  } catch (error) { placeholderThrew = error }
  assert(placeholderThrew !== null,
    '⚠⚠ 调用 createPlaceholderWriter **必抛错**（没有任何人能拿到占位内容），实得 ' + placeholderThrew)
  assert(String(placeholderThrew?.message ?? '').includes('占位'),
    '抛错信息点明「占位 writer 已停用」，实得：' + placeholderThrew?.message)

  assert(typeof trigger.createFailingWriter === 'function',
    '保留一个显式失败 writer（兜底路径要能给出人话错误，而不是 TypeError）')
  const failing = trigger.createFailingWriter('测试用失败原因')
  let threw = null
  try { await failing({}) } catch (error) { threw = error }
  assert(threw !== null && String(threw.message).includes('测试用失败原因'),
    '显式失败 writer 抛出的错误带原因（写进 run.error 用户能看懂）')
}

/* ── 10.5 /api/dsh-feed/models：当前模型与可选模型 ── */
{
  const api = await load('api')
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeJ = resolve(ROOT, '_tmp', 'smoke-feed-home-j')
  try { rmSync(homeJ, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeJ, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeJ
  const storeJ = new StoreClass()
  await storeJ.load()
  process.env.DSH_HOME = prevHome
  await storeJ.setConfig({ prompt: 'p', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  modelsMod.clearModelCatalogCache()
  const routes = []
  api.mountFeedRoutes(
    { webServer: { register: (route) => { routes.push(route); return () => {} } } },
    { store: storeJ, runner: { requestRun: async () => 'started', idle: async () => {} },
      now: () => NOW, getService: fakeServices({ llm: fakeLlm({ output: '' }) }) },
  )
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const call = (path) => new Promise((ok, bad) => {
    const req = httpRequest('http://127.0.0.1:' + port + '/api/dsh-feed' + path, {
      method: 'GET', headers: { host: '127.0.0.1:' + port },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* 非 JSON */ }
        ok({ status: res.statusCode, json: parsed })
      })
    })
    req.on('error', bad)
    req.end()
  })

  const modelsRes = await call('/models')
  assert(modelsRes.status === 200 && modelsRes.json?.ok === true, 'GET /models 回 200 + ok:true')
  assert(modelsRes.json.resolved === true, 'GET /models 报告 current 解析成功，实得 resolved=' + modelsRes.json.resolved)
  assert(modelsRes.json.currentModel === 'fake-model-a',
    '⚠ currentModel 是 agentDefaultModel 里的当前模型（用户要的「选中我们现在的这个模型」），实得 ' + modelsRes.json.currentModel)
  assert(modelsRes.json.resolution === 'agentDefaultModel',
    'resolution 如实标注来自 agentDefaultModel（不是兜底猜的），实得 ' + modelsRes.json.resolution)
  assert(Array.isArray(modelsRes.json.models) && modelsRes.json.models.length === 2,
    'models 列出了真实可用模型，实得 ' + (modelsRes.json.models ?? []).length)
  const firstModel = modelsRes.json.models[0]
  for (const field of ['id', 'label', 'provider', 'providerName', 'modelId']) {
    assert(field in firstModel, 'models[] 字段存在：' + field)
  }
  assert(firstModel.label === '假模型 A', 'label 用模型自报的名字（不是让用户读内部 id），实得 ' + firstModel.label)
  assert(modelsRes.json.default === 'fake-model-a',
    'default 指向 models[] 里能直接选中的那一项，实得 ' + modelsRes.json.default)

  // /status 要能看出「实际生效」的模型与上一轮统计。
  const statusRes = await call('/status')
  assert(statusRes.json?.modelResolved?.ok === true, '/status 带 modelResolved（实际解析到的路由）')
  assert(statusRes.json.modelResolved.model === 'fake-model-a',
    '/status.modelResolved.model 是真实模型 id，实得 ' + statusRes.json.modelResolved.model)
  assert('lastRunStats' in statusRes.json && 'lastRunModel' in statusRes.json,
    '/status 带上一轮实际用的模型与过程计数（可验证「内容真的来自模型」）')

  // llm 服务缺失时必须**明确报错**，不能静默给一个空目录假装成功。
  modelsMod.clearModelCatalogCache()
  const routes2 = []
  api.mountFeedRoutes(
    { webServer: { register: (route) => { routes2.push(route); return () => {} } } },
    { store: storeJ, runner: { requestRun: async () => 'started', idle: async () => {} },
      now: () => NOW + modelsMod.MODEL_CACHE_TTL_MS + 1000, getService: () => undefined },
  )
  const server2 = createServer((req, res) => routes2[0].handler(req, res))
  await new Promise(ok => server2.listen(0, '127.0.0.1', ok))
  const port2 = server2.address().port
  const call2 = (path) => new Promise((ok, bad) => {
    const req = httpRequest('http://127.0.0.1:' + port2 + '/api/dsh-feed' + path, {
      method: 'GET', headers: { host: '127.0.0.1:' + port2 },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* 非 JSON */ }
        ok({ status: res.statusCode, json: parsed })
      })
    })
    req.on('error', bad)
    req.end()
  })
  const noLlm = await call2('/models')
  assert(noLlm.json.resolved === false, '⚠ llm 服务缺失时 resolved=false（不假装有模型）')
  assert(typeof noLlm.json.error === 'string' && noLlm.json.error.includes('无法解析当前模型') === false,
    'llm 缺失时给出明确的 error 文案，实得：' + noLlm.json.error)
  assert(noLlm.json.error.includes('llm'), 'error 文案点明是 llm 服务不可用，实得：' + noLlm.json.error)

  await new Promise(ok => server.close(ok))
  await new Promise(ok => server2.close(ok))
}

console.log('\n=== 11. 增量时间窗：只取「上次更新到现在」===');

/*
 * 用户原话：「只更新上次时间节点到当前时间节点」。
 *
 * 这一组全部是 incremental.ts 的纯函数对拍 —— 不读磁盘、不读时钟，
 * 所以可以构造任意水位线，不受运行时刻影响（时间相关逻辑最难测的就是
 * 「跑的时候恰好是几点」）。
 */

/* ── 11.1 水位线：优先「上次成功」，失败轮不算 ── */
{
  const runs = [
    // 最新一轮是失败的（它不该把水位线拉到它自己身上）。
    { status: 'failed', startedAt: NOW - 1 * HOUR, finishedAt: NOW - 1 * HOUR + 3000 },
    { status: 'ok', startedAt: NOW - 5 * HOUR, finishedAt: NOW - 5 * HOUR + 40000 },
    { status: 'ok', startedAt: NOW - 20 * HOUR, finishedAt: NOW - 20 * HOUR + 40000 },
  ]
  const okAt = incMod.lastOkRunAtOf(runs)
  assert(okAt === NOW - 5 * HOUR + 40000,
    '⚠ 水位线取最近一条 status=ok 的 finishedAt（失败轮不参与），实得 ' + (okAt - NOW) + 'ms')
  assert(incMod.lastOkRunAtOf([]) === 0, '没有轮次历史时返回 0（调用方据此回落）')
  assert(incMod.lastOkRunAtOf(undefined) === 0, '轮次历史缺失（老 state.json）时返回 0，不抛')

  // 顺序被打乱也要取最大的那条（state.json 可手改）。
  const shuffled = [
    { status: 'ok', startedAt: NOW - 30 * HOUR, finishedAt: NOW - 29 * HOUR },
    { status: 'ok', startedAt: NOW - 2 * HOUR, finishedAt: NOW - 2 * HOUR + 1000 },
    { status: 'ok', startedAt: NOW - 10 * HOUR, finishedAt: NOW - 10 * HOUR },
  ]
  assert(incMod.lastOkRunAtOf(shuffled) === NOW - 2 * HOUR + 1000,
    '轮次顺序被打乱时取最大的时点（不依赖磁盘顺序）')

  // 只有 startedAt、没有 finishedAt（正在跑的那条）也要能取。
  assert(incMod.lastOkRunAtOf([{ status: 'ok', startedAt: NOW - 3 * HOUR }]) === NOW - 3 * HOUR,
    'finishedAt 缺失时回落到 startedAt')
}

/* ── 11.2 resolveSinceWindow：三级回落 + 两条防御 ── */
{
  const w1 = incMod.resolveSinceWindow({ now: NOW, lastOkRunAt: NOW - 3 * HOUR, lastRunAt: NOW - 1 * HOUR })
  assert(w1.sinceAt === NOW - 3 * HOUR && w1.fallback === false && w1.source === 'last-ok-run',
    '有成功轮次时用它（优先于 lastRunAt 这个「每轮都写」的粗水位线），实得 ' + JSON.stringify(w1))

  const w2 = incMod.resolveSinceWindow({ now: NOW, lastRunAt: NOW - 2 * HOUR })
  assert(w2.sinceAt === NOW - 2 * HOUR && w2.fallback === false && w2.source === 'last-run-at',
    '没有成功轮次但有 lastRunAt 时用它，实得 ' + JSON.stringify(w2))

  // ⚠ 首次运行：不能崩，必须回落 7 天前并**标注**。
  const w3 = incMod.resolveSinceWindow({ now: NOW })
  assert(w3.sinceAt === NOW - incMod.FEED_SINCE_FALLBACK_MS && w3.fallback === true && w3.source === 'fallback',
    '⚠ 水位线读不到 → 回落 7 天前并标 fallback=true（不崩、不静默），实得 ' + JSON.stringify(w3))
  assert(incMod.FEED_SINCE_FALLBACK_MS === 7 * 24 * HOUR,
    '兜底窗口是 7 天（不是 24 小时：隔几天才点一次是常见场景）')

  // 防御一：水位线晚于现在（时钟回拨 / 手改了 state.json）。
  const w4 = incMod.resolveSinceWindow({ now: NOW, lastOkRunAt: NOW + 5 * HOUR })
  assert(w4.fallback === true && w4.sinceAt === NOW - incMod.FEED_SINCE_FALLBACK_MS,
    '⚠ 水位线在未来（时钟回拨）→ 回落兜底并标注（否则每一轮都检索不到任何东西），实得 ' + JSON.stringify(w4))

  // 防御二：水位线是脏值。
  for (const dirty of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const w = incMod.resolveSinceWindow({ now: NOW, lastOkRunAt: dirty, lastRunAt: dirty })
    assert(w.fallback === true, '水位线是脏值 ' + String(dirty) + ' 时回落兜底（不崩）')
  }
}

/* ── 11.3 时间窗过滤：早于 sinceAt 的丢弃，**缺时间的保留并标注** ── */
{
  const sinceAt = NOW - 3 * HOUR
  const result = incMod.applySinceWindow([
    { url: 'https://a.example/1', publishedAt: new Date(NOW - 1 * HOUR).toISOString() },  // 窗口内
    { url: 'https://a.example/2', publishedAt: new Date(NOW - 10 * HOUR).toISOString() }, // 太旧
    { url: 'https://a.example/3' },                                                        // 缺时间
    { url: 'https://a.example/4', publishedAt: 'not-a-date' },                              // 坏值 = 缺时间
    { url: 'https://a.example/5', publishedAtMs: NOW - 30 * 60000 },                        // 已解析的毫秒
  ], sinceAt)
  const keptUrls = result.kept.map(item => item.url)
  assert(keptUrls.includes('https://a.example/1'), '窗口内的候选保留')
  assert(keptUrls.includes('https://a.example/2') === false,
    '⚠ 早于 sinceAt 的候选被丢弃，实得 ' + JSON.stringify(keptUrls))
  assert(result.droppedStale === 1, 'droppedStale 计数是 1，实得 ' + result.droppedStale)
  assert(keptUrls.includes('https://a.example/3'),
    '⚠ publishedAt 缺失时**保留**（一刀切丢弃会让「本轮没来源」）')
  assert(keptUrls.includes('https://a.example/4'), 'publishedAt 解析失败按「缺失」处理，保留')
  assert(keptUrls.includes('https://a.example/5'), 'publishedAtMs 已解析时优先用它（不再重复解析）')

  const unknownOne = result.kept.find(item => item.url === 'https://a.example/3')
  assert(unknownOne.timeUnknown === true,
    '⚠ 缺时间的候选被标注 timeUnknown=true（提示词据此如实说「发布时间未知」，不假装是新的）')
  const knownOne = result.kept.find(item => item.url === 'https://a.example/1')
  assert(knownOne.timeUnknown === false, '有时间的候选标 timeUnknown=false')
  assert(result.unknown === 2, 'unknown 计数 = 2（缺时间与坏值各一条），实得 ' + result.unknown)

  // sinceAt <= 0 表示不启用窗口。
  const off = incMod.applySinceWindow([{ url: 'x' }], 0)
  assert(off.kept.length === 1 && off.droppedStale === 0, 'sinceAt<=0 时不启用窗口（全部保留）')
}

/* ── 11.4 时间窗进提示词 + 进检索 query ── */
{
  const sinceAt = NOW - 3 * HOUR
  const instruction = incMod.formatWindowInstruction(sinceAt, NOW)
  assert(instruction.includes('本轮的时间范围'), '时间窗提示词有明确标题，实得：' + instruction.slice(0, 40))
  assert(instruction.includes('从现在') === false && instruction.includes('到现在'),
    '时间窗提示词写到「到现在」这个终点')
  assert(instruction.includes(incMod.formatMomentCn(sinceAt)),
    '时间窗提示词含起点时刻（含时分），实得：' + incMod.formatMomentCn(sinceAt))
  assert(instruction.includes('只写这个范围内') || instruction.includes('只写这段时间'),
    '时间窗提示词明确要求「只写这个范围内」')
  assert(instruction.includes('宁可少写') || instruction.includes('不要拿旧内容凑数'),
    '时间窗提示词说明「没有新内容就不要凑数」')

  // 同一天：第 3 条 query 用中文日期（沿用老行为）。
  const sameDayHint = writerMod.timeHintOf(NOW, NOW - 3 * HOUR)
  assert(sameDayHint === writerMod.formatTodayCn(NOW),
    '同一天的时间尾巴是中文日期，实得 ' + sameDayHint)

  // 跨天：用 after:YYYY-MM-DD（多数检索器认这个前缀）。
  const yesterday = NOW - 26 * HOUR
  const crossDayHint = writerMod.timeHintOf(NOW, yesterday)
  assert(crossDayHint === 'after:' + incMod.isoDateOf(yesterday),
    '⚠ 跨天时第 3 条 query 带 after:YYYY-MM-DD 限定，实得 ' + crossDayHint)
  assert(/^after:\d{4}-\d{2}-\d{2}$/.test(crossDayHint), 'after: 后面是纯本地日期（不是 ISO 带时区的串）')

  // planQueries 把时间尾巴真的拼进 query。
  const crossQueries = writerMod.planQueries('盯住 AI 与开源模型', NOW, yesterday)
  assert(crossQueries.some(query => query.includes('after:' + incMod.isoDateOf(yesterday))),
    '⚠ planQueries 把 after: 限定拼进 query，实得 ' + JSON.stringify(crossQueries))
  const sameQueries = writerMod.planQueries('盯住 AI 与开源模型', NOW, NOW - 3 * HOUR)
  assert(sameQueries.some(query => query.includes(writerMod.formatTodayCn(NOW))),
    '同一天时 planQueries 仍用中文日期（老行为不破）')
  assert(writerMod.planQueries('   ', NOW, yesterday).length === 0, '空提示词仍然不产 query（带 sinceAt 也不崩）')

  // isoDateOf 必须按本地日期算（UTC 会在东八区凌晨退到前一天）。
  const midnightish = new Date(2026, 9, 27, 0, 30, 0).getTime()
  assert(incMod.isoDateOf(midnightish) === '2026-10-27',
    '⚠ isoDateOf 用本地日期（UTC 会把凌晨算成前一天，把最新内容切在窗口外），实得 ' + incMod.isoDateOf(midnightish))
}

console.log('\n=== 12. 硬去重：兜底只拦「零歧义」的两条 ===');

/*
 * 用户要求「让模型自己去判断去重」，所以阈值型相似度（Jaccard）**不做**。
 * 代码层只留两条零歧义的兜底，这一组钉死它们的**边界**：
 *  - 什么时候必须丢；
 *  - 更重要的是**什么时候不能丢**（误杀的表现是「更新了但没内容」，最难查）。
 */

/** 造一条待去重的候选。 */
function cand(over) {
  return {
    title: over.title,
    body: over.body ?? '正文',
    sources: over.sources ?? [],
    ...(over.createdAt !== undefined ? { createdAt: over.createdAt } : {}),
  }
}

/* ── 12.1 标题：归一化后完全相同 → 丢 ── */
{
  const existing = [{ title: '开源模型的推理能力接近闭源', createdAt: NOW - DAY }]
  const result = incMod.dedupePosts([
    cand({ title: '开源模型的推理能力接近闭源' }),            // 完全相同
    cand({ title: '开源模型的推理能力，接近闭源。' }),        // 只差标点
    cand({ title: '  开源模型的推理能力接近闭源  ' }),        // 只差空白
    cand({ title: '开源模型的推理能力接近闭源！' }),          // 只差标点
  ], existing)
  assert(result.kept.length === 0,
    '⚠ 归一化后相同（只差标点/空白）的标题全部丢弃，实得 kept=' + result.kept.length)
  assert(result.counts['dup-title'] === 4, "dup-title 计数是 4，实得 " + result.counts['dup-title'])
  assert(result.dropped[0].reason === 'dup-title', '丢弃原因记为 dup-title')

  // 归一化本身：全角折半角、大小写、各种标点。
  assert(incMod.normalizeTitle('ＡＩ 工程师：你好！') === incMod.normalizeTitle('ai工程师你好'),
    '⚠ 归一化：全角折半角 + 去标点 + 小写，实得 ' + incMod.normalizeTitle('ＡＩ 工程师：你好！'))
}

/* ── 12.2 标题只是**字面相近但不同事** → 必须保留（不误杀）── */
{
  const existing = [{ title: '欧盟公布 AI 法案实施细则', createdAt: NOW - DAY }]
  const result = incMod.dedupePosts([
    cand({ title: '美国收紧 AI 芯片出口管制' }),
    cand({ title: '欧盟公布 AI 法案实施细则之后，美国也出手了' }), // 相关但确是新进展
    cand({ title: '日本发布自己的 AI 监管框架' }),
  ], existing)
  assert(result.kept.length === 3,
    '⚠ 不误杀：只是字面相近、事件不同的标题必须保留（误杀的表现是「更新了但没内容」），实得 kept=' + result.kept.length)
  assert(result.counts['dup-title'] === 0, '没有标题被判重')
}

/* ── 12.3 来源：**全部**重复才丢，部分重复不丢（任务点名的验收）── */
{
  const existing = [{
    title: '旧内容',
    sources: [{ url: 'https://a.example/1' }, { url: 'https://b.example/2' }],
    createdAt: NOW - DAY,
  }]

  // ⚠ 全部重复 → 丢。
  const allDup = incMod.dedupePosts([
    cand({ title: '换了个标题但同一批来源', sources: [{ url: 'https://a.example/1' }, { url: 'https://b.example/2' }] }),
  ], existing)
  assert(allDup.kept.length === 0,
    '⚠ 来源 URL 全部重复 → 丢弃（同一批资料一字不差又写一遍），实得 kept=' + allDup.kept.length)
  assert(allDup.counts['dup-source'] === 1, "dup-source 计数是 1，实得 " + allDup.counts['dup-source'])
  assert(allDup.dropped[0].reason === 'dup-source', '丢弃原因记为 dup-source')

  // ⚠ 部分重复 + 有新 URL → 保留（这正是「同一话题的新进展」，用户要的就是它）。
  const partial = incMod.dedupePosts([
    cand({ title: '同一话题的新进展', sources: [{ url: 'https://a.example/1' }, { url: 'https://c.example/3' }] }),
  ], existing)
  assert(partial.kept.length === 1,
    '⚠ 部分重复且有新 URL → 保留（新进展不是重复），实得 kept=' + partial.kept.length)

  // 一条新 URL 就够（哪怕旧 URL 占多数）。
  const mostlyOld = incMod.dedupePosts([
    cand({ title: '大部分旧来源加一条新的', sources: [
      { url: 'https://a.example/1' }, { url: 'https://b.example/2' }, { url: 'https://d.example/4' },
    ] }),
  ], existing)
  assert(mostlyOld.kept.length === 1, '只要有 1 条新 URL 就保留（不做「重合率」阈值判断）')

  // 完全无来源的帖子不能被 dup-source 误杀（空集合不算重复）。
  const noSources = incMod.dedupePosts([cand({ title: '无来源的降级帖' })], existing)
  assert(noSources.kept.length === 1,
    '⚠ 无来源的帖子不参与来源去重（空集合不算「全部重复」，否则降级帖会被全部丢掉）')

  // 空 existing 时什么都不该丢（首次运行）。
  const emptyExisting = incMod.dedupePosts([cand({ title: 'T', sources: [{ url: 'https://e.example/9' }] })], [])
  assert(emptyExisting.kept.length === 1, '没有已有内容时首轮全部保留')
}

/* ── 12.4 URL 判重键：fragment / 末尾斜杠 / host 大小写视为同一条 ── */
{
  const key = incMod.urlKeyOf('https://Example.COM/a/b/?q=1#frag')
  assert(key === incMod.urlKeyOf('https://example.com/a/b/?q=1'),
    '⚠ URL 键忽略 fragment、host 大小写，实得 ' + key)
  assert(incMod.urlKeyOf('') === '' && incMod.urlKeyOf(null) === '', '空 URL / 非字符串返回空键（不抛）')
  assert(incMod.urlKeyOf('not-a-url') === 'not-a-url', '解析失败的 URL 返回原串（宁可判重失败，也不要把坏 URL 都当成同一个）')
  // 与 writer 侧的 urlKeyOf 必须是**同一份实现**（两处分叉会导致检索与去重口径不一致）。
  assert(writerMod.urlKeyOf('https://Example.COM/a/b/?q=1#frag') === key,
    '⚠ writer 与 incremental 的 urlKeyOf 是同一份实现（口径不分叉）')
}

/* ── 12.5 同轮内部也互相判重（轮内重复同样不能落盘）── */
{
  const result = incMod.dedupePosts([
    cand({ title: '同一条被模型写了两次' }),
    cand({ title: '同一条被模型写了两次。' }),
    cand({ title: '另一条', sources: [{ url: 'https://same.example/x' }] }),
    cand({ title: '又一条但同来源', sources: [{ url: 'https://same.example/x' }] }),
  ], [])
  assert(result.kept.length === 2,
    '⚠ 同轮内部也判重：重复标题与重复来源各只留第一条，实得 kept=' + result.kept.length
    + '（' + JSON.stringify(result.kept.map(item => item.title)) + '）')
  assert(result.counts['dup-title'] === 1 && result.counts['dup-source'] === 1,
    '轮内 dup-title / dup-source 各 1，实得 ' + JSON.stringify(result.counts))
}

/* ── 12.6 已有帖池按「最近 N 条」取（越老的越可能只是同一长期话题）── */
{
  // 造 60 条历史，标题各不相同；最早的那条与候选重复。
  const many = Array.from({ length: 60 }, (_, index) => ({
    title: '历史标题 ' + index,
    createdAt: NOW - (index + 1) * HOUR,
  }))
  const result = incMod.dedupePosts([cand({ title: '历史标题 59' })], many, { existingLimit: 50 })
  assert(result.kept.length === 1,
    '池只取最近 50 条：第 60 条（最老）不在池里，所以同标题的候选不被拦（避免误杀长期话题）')
  const inside = incMod.dedupePosts([cand({ title: '历史标题 10' })], many, { existingLimit: 50 })
  assert(inside.kept.length === 0, '池内（最近 50 条）的同标题候选被拦下')
}

console.log('\n=== 13. 让模型自己判断去重：提示词 + skipped[] 回报 ===');

/*
 * 用户要求：「**让模型自己去判断去重**」。
 *
 * 所以这一组断言的是三件事：
 *  1. 提示词里确实把「标题 + 主题 + 来源」三要素摆给了模型；
 *  2. 提示词里是**让模型判断**的指令，不是阈值（正文明示、不出现数字阈值）；
 *  3. 模型回报的 skipped[] 被正确解析并记进 run.stats。
 */

/* ── 13.1 提示词：已有内容的三要素齐备 ── */
{
  const knownPosts = [
    { title: '模型权重层算不算技术出口', topics: ['law', 'ai'], domains: ['kingandwood.com', 'junhe.com'], createdAt: NOW - 3 * HOUR },
    { title: '开源加条款：披露、阈值、迁移限制', topics: ['opensource'], domains: ['jtn.com'], createdAt: NOW - 8 * HOUR },
  ]
  const text = writerMod.buildWriterUserText({
    prompt: '盯住 AI 出海合规',
    now: NOW,
    sources: [{ index: 0, url: 'https://news.example/x', domain: 'news.example', title: '来源一', access: 'open', body: '正文', clue: '', fetchedAt: NOW }],
    knownTitles: knownPosts.map(item => item.title),
    knownPosts,
    sinceAt: NOW - 5 * HOUR,
  })

  assert(text.includes('模型权重层算不算技术出口') && text.includes('开源加条款：披露、阈值、迁移限制'),
    '⚠ 提示词含已有内容的**标题**（照抄原文）')
  assert(text.includes('law') && text.includes('ai'),
    '⚠ 提示词含已有内容的**主题**（topics）')
  assert(text.includes('kingandwood.com') && text.includes('junhe.com'),
    '⚠ 提示词含已有内容的**来源域名**（「同一批资料的另一个角度」唯一可靠的线索）')
  assert(text.includes('请你自己判断'),
    '⚠ 提示词明确**让模型自己判断**（不是让代码算相似度），实得片段：'
    + text.slice(text.indexOf('【已经发过的内容'), text.indexOf('【已经发过的内容') + 80))
  assert(text.includes('同一件事') && text.includes('同一批资料'),
    '提示词说明「同一件事 / 同一批资料 / 同一个角度」都算重复')
  assert(text.includes('可以写'), '提示词同时说明「话题大类相同但事件不同」可以写（不误杀）')
  assert(text.includes('宁可少写'), '提示词要求「宁可少写，不要写重复的」')

  // ⚠ 关键：不许出现阈值型判据（那样就把判断权从模型手里拿走了）。
  assert(/\bJaccard\b|相似度阈值|0\.6|0\.65|0\.8|重合率/.test(text) === false,
    '⚠ 提示词里**没有**任何阈值型判据（判断权归模型，不靠数字门限）')

  // 时间范围也在提示词里（user 里再强调一次）。
  assert(text.includes('之后的新进展'), '提示词里有时间窗的 user 侧强调')
}

/* ── 13.2 提示词：没有历史时不出现「已经发过」段（不冒充）── */
{
  const text = writerMod.buildWriterUserText({
    prompt: '盯住 AI', now: NOW,
    sources: [], knownTitles: [], knownPosts: [],
  })
  assert(text.includes('【已经发过的内容') === false, '没有历史内容时不出现「已经发过」段落')
  assert(writerMod.buildWriterUserText({
    prompt: 'p', now: NOW, sources: [], knownTitles: ['老标题一条'],
  }).includes('已经发过、这次不要再重复的标题'),
    '老契约：只给 knownTitles 时回落到旧的标题清单（不破第三方注入实现）')
}

/* ── 13.3 system 提示词：时间范围 + 「不要重复」的指令 ── */
{
  const sys = writerMod.writerSystemPrompt(NOW - 3 * HOUR, NOW)
  assert(sys.includes('本轮的时间范围'), '⚠ system 里写明本轮时间范围（长期约束，最不易被冲淡）')
  assert(sys.includes('只挑最有信息增量的'), 'system 要求「同一批资料只挑 1-2 个角度写」（治「同一件事写 12 遍」）')
  assert(sys.includes('直接不写') && sys.includes('宁可少写'),
    'system 要求「与已发内容是同一件事就直接不写，宁可少写」')
  assert(sys.includes('skipped'), 'system 要求模型回报 skipped[]（判断可追溯）')
  assert(sys.includes('绝不输出任何网址'), '闸 2 的措辞层没有被这次改动带走')

  const noWindow = writerMod.writerSystemPrompt()
  assert(noWindow.includes('本轮的时间范围') === false,
    '不传 sinceAt 时不写时间范围段（兼容老调用方），但仍含其余硬规则')
  assert(noWindow.includes('绝不输出任何网址'), '不传 sinceAt 时其余硬规则照旧')
}

/* ── 13.4 skipped[] 解析：三种形态都认 ── */
{
  const canonical = writerMod.readModelSkipped({
    skipped: [
      { ofTitle: '模型权重层算不算技术出口', why: '与已发内容同属技术出口这件事' },
      { reason: 'duplicate', why: '同一批律所资料' }, // 字段名换了
      '只给了一句话',
      { ofTitle: '', why: '' },                        // 空条目跳过
    ],
  })
  assert(canonical.length === 3, 'skipped 解析出 3 条（空条目被跳过），实得 ' + canonical.length)
  assert(canonical[0].ofTitle === '模型权重层算不算技术出口', 'ofTitle 原样保留')
  assert(canonical[0].why.includes('技术出口'), 'why 原样保留')
  assert(canonical[1].why === '同一批律所资料', '字段名换成 reason/why 也认')
  assert(canonical[2].why === '只给了一句话', '只给字符串的形态也认（放进 why）')

  assert(writerMod.readModelSkipped({}).length === 0, '没有 skipped 字段时返回空数组')
  assert(writerMod.readModelSkipped({ skipped: 'not-an-array' }).length === 0, 'skipped 不是数组时返回空数组（不抛）')
  assert(writerMod.readModelSkipped(null).length === 0, 'null 输入返回空数组（不抛）')
  assert(writerMod.readModelSkipped({ skipped: Array.from({ length: 50 }, () => ({ why: 'x' })) }).length === 20,
    'skipped 有上限（最多 20 条，防止模型刷屏）')
}

/* ── 13.5 parseWriterOutput 把 skipped 一起带出来 ── */
{
  const parsed = writerMod.parseWriterOutput(JSON.stringify({
    posts: [{ title: 'T', body: 'B', sourceIds: [0] }],
    skipped: [{ ofTitle: '老标题', why: '同一件事' }],
  }))
  assert(parsed !== null && parsed.posts.length === 1, '正常解析 posts')
  assert(parsed.skipped.length === 1 && parsed.skipped[0].ofTitle === '老标题',
    '⚠ parseWriterOutput 把模型自报的 skipped 一并解析出来（判断可追溯）')

  const noSkip = writerMod.parseWriterOutput(JSON.stringify({ posts: [{ title: 'T', body: 'B' }] }))
  assert(noSkip !== null && noSkip.skipped.length === 0, '模型不给 skipped 时是空数组（不是 undefined，调用方不用判空）')
}

/* ── 13.6 端到端：模型自报重复 → run.stats.modelSkipped 落地 ── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeK = resolve(ROOT, '_tmp', 'smoke-feed-home-k')
  try { rmSync(homeK, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeK, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeK
  const storeK = new StoreClass()
  await storeK.load()
  process.env.DSH_HOME = prevHome
  await storeK.setConfig({ prompt: '盯住 AI 出海合规', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  const llm = fakeLlm({
    output: JSON.stringify({
      posts: [{
        title: '欧盟把模型权重写进出口清单',
        body: '欧盟委员会本周把模型权重纳入两用物项清单，对做海外发行的人来说，这是一条新的合规线。',
        sourceIds: [0],
        topics: ['law'],
        dueInHours: 0,
      }],
      skipped: [
        { ofTitle: '模型权重层算不算技术出口', why: '与已发内容是同一件事，只是换了说法' },
        { ofTitle: '开源加条款：披露、阈值、迁移限制', why: '同一批律所资料的另一个角度' },
      ],
    }),
  })
  const realWriter = writerMod.createRealWriter({
    getService: fakeServices(), llm, web: fakeWeb(), now: () => NOW,
  })
  const runner = trigger.createFeedRunner({ store: storeK, writer: realWriter, now: () => NOW, syncX: false })
  await runner.requestRun('manual')
  await runner.idle()

  const posts = await storeK.listPosts()
  assert(posts.length === 1, '模型只写了 1 条（另 2 条它自己判为重复跳过了），实得 ' + posts.length)

  const run = (await storeK.listRuns())[0]
  assert(run.status === 'ok', 'run.status = ok，实得 ' + run.status)
  assert(run.stats.modelSkipped === 2,
    '⚠ run.stats.modelSkipped 记录了模型自己跳过的条数（=2），实得 ' + run.stats.modelSkipped)
  assert(Array.isArray(run.stats.modelSkipNotes) && run.stats.modelSkipNotes.length === 2,
    '⚠ modelSkipNotes 记录了模型给的理由（可追溯），实得 ' + JSON.stringify(run.stats.modelSkipNotes))
  assert(String(run.stats.modelSkipNotes[0]).includes('模型权重层算不算技术出口'),
    '理由里带「与哪条已发内容重复」的标题，实得：' + run.stats.modelSkipNotes[0])

  // 时间窗也落进 stats（「只更新上次时间节点到现在」的可核对证据）。
  assert(typeof run.stats.sinceAt === 'number' && run.stats.sinceAt > 0,
    'run.stats.sinceAt 记录了本轮实际使用的时间窗起点，实得 ' + run.stats.sinceAt)
  assert(run.stats.sinceFallback === true,
    '首次运行（无水位线）时 sinceFallback=true 如实标注，实得 ' + run.stats.sinceFallback)
  assert(run.stats.sinceSource === 'fallback', "sinceSource 标注为 fallback，实得 " + run.stats.sinceSource)
  assert(run.stats.sinceAt === NOW - incMod.FEED_SINCE_FALLBACK_MS,
    '首次运行回落 7 天前（与 resolveSinceWindow 同口径）')

  // ⚠ 重启后这几格不丢（normalizeRun 漏字段的后果见 store.ts 的注释）。
  process.env.DSH_HOME = homeK
  const storeReloaded = new StoreClass()
  await storeReloaded.load()
  process.env.DSH_HOME = prevHome
  const reloaded = (await storeReloaded.listRuns())[0]
  assert(reloaded.stats.modelSkipped === 2, '⚠ 重启后 modelSkipped 还在（归一化没漏字段），实得 ' + reloaded.stats.modelSkipped)
  assert(reloaded.stats.sinceAt === NOW - incMod.FEED_SINCE_FALLBACK_MS,
    '⚠ 重启后 sinceAt 还在，实得 ' + reloaded.stats.sinceAt)
  assert(reloaded.stats.sinceFallback === true, '⚠ 重启后 sinceFallback 还在')
}

/* ═══════════════ 13.7 「模型全判重复」≠「更新失败」（task-11）═══════════════
 *
 * 真实服务实测（用户的原始缺陷报告）：一轮跑完后 run.status='failed'，
 * run.error 写着「模型判断本轮没有新内容可写，主动跳过了 11 条」——
 * 而模型**做得完全正确**：它逐条比对了 30 条已发内容，认定候选全是重复，
 * 于是全部跳过。那正是用户要的「让模型自己去判断去重」完美工作的证据。
 *
 * 系统的错在于把「正常态」当成了「故障」：一条 throw 经 catch 变成 failed，
 * 界面因此显示红色「更新失败」。用户看到以为坏了，实际是「确实没有新内容」。
 *
 * ── 判定边界（下面五条断言逐条钉住，多一条都不许含糊）──────────────────
 *
 * | 场景                                  | status    |
 * |---------------------------------------|-----------|
 * | ① posts=[] 但 skipped>0（模型主动判重）| skipped   |
 * | ② posts=[] 且 skipped=[]（JSON 真没条目）| failed  |
 * | ③ posts>0 但全部校验失败                | failed    |
 * | ④ JSON 解析失败                        | failed    |
 * | ⑤ 模型调用报错                          | failed    |
 *
 * ⚠ ②③④⑤ 四条**必须仍然是 failed**。这条反向断言是本段最重要的部分：
 *   为了把①变绿而顺手把真故障一起吞掉，会让「模型什么都没给」从此伪装成
 *   「模型判断没有新内容」，再也没人能从界面上发现真实故障。
 */
{ /* ── ① 模型一条都不写，但报了 skipped（判重成功）→ skipped ── */
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeL = resolve(ROOT, '_tmp', 'smoke-feed-home-l')
  try { rmSync(homeL, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeL, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeL
  const storeL = new StoreClass()
  await storeL.load()
  process.env.DSH_HOME = prevHome
  await storeL.setConfig({ prompt: '盯住 AI', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  const llm = fakeLlm({
    output: JSON.stringify({
      posts: [],
      skipped: [
        { ofTitle: '旧标题', why: '这一轮检索到的都是同一件事' },
        { ofTitle: '另一篇', why: '同一批律所资料的另一个角度' },
      ],
    }),
  })
  const realWriter = writerMod.createRealWriter({ getService: fakeServices(), llm, web: fakeWeb(), now: () => NOW })
  const runner = trigger.createFeedRunner({ store: storeL, writer: realWriter, now: () => NOW, syncX: false })
  await runner.requestRun('manual')
  await runner.idle()

  const posts = await storeL.listPosts()
  assert(posts.length === 0, '① 模型主动跳过全部候选 → 0 条落地（不补占位）')
  const run = (await storeL.listRuns())[0]
  assert(run.status === 'skipped',
    '⚠⚠ ① 模型全判重复 → status=skipped（不是 failed！这正是本次修的误报），实得 ' + run.status)
  assert(run.error === undefined || run.error === '',
    '⚠ ① skipped 是正常态，run.error 不许有「失败」字样，实得 ' + JSON.stringify(run.error))
  assert(run.stats.modelSkipped === 2, '① modelSkipped 如实记录（=2），实得 ' + run.stats.modelSkipped)
  assert(run.stats.noNewContent === true,
    '① stats.noNewContent 标记为 true（界面据此用中性色而不是红色），实得 ' + run.stats.noNewContent)
  assert(typeof run.stats.noNewContentReason === 'string'
    && run.stats.noNewContentReason.includes('2 条')
    && !run.stats.noNewContentReason.includes('失败'),
  '① noNewContentReason 是一句人话且不含「失败」字样，实得 ' + run.stats.noNewContentReason)
  assert(Array.isArray(run.stats.modelSkipNotes) && run.stats.modelSkipNotes.length === 2,
    '① modelSkipNotes 带上了模型给的具体理由（界面要给用户看），实得 '
    + JSON.stringify(run.stats.modelSkipNotes))

  /* ⚠ 重启后这几格不丢：漏洗字段会让弹卡刷新后退回「0 条」，看起来像那轮什么都没干。 */
  process.env.DSH_HOME = homeL
  const storeReloadedL = new StoreClass()
  await storeReloadedL.load()
  process.env.DSH_HOME = prevHome
  const reloadedL = (await storeReloadedL.listRuns())[0]
  assert(reloadedL.status === 'skipped', '⚠ ① 重启后状态仍是 skipped，实得 ' + reloadedL.status)
  assert(reloadedL.stats.noNewContent === true, '⚠ ① 重启后 noNewContent 还在')
  assert(reloadedL.stats.noNewContentReason === run.stats.noNewContentReason,
    '⚠ ① 重启后 noNewContentReason 还在')
  assert(Array.isArray(reloadedL.stats.modelSkipNotes) && reloadedL.stats.modelSkipNotes.length === 2,
    '⚠ ① 重启后 modelSkipNotes 还在（normalizeRun 没漏字段）')
}

{ /* ── ①b 真实规模：11 条全判重复（理由只存 10 条，计数必须是 11）── */
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeL11 = resolve(ROOT, '_tmp', 'smoke-feed-home-l11')
  try { rmSync(homeL11, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeL11, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeL11
  const storeL11 = new StoreClass()
  await storeL11.load()
  process.env.DSH_HOME = prevHome
  await storeL11.setConfig({ prompt: '盯住 AI', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  // 与真实服务那次同形：11 条候选，每条都有具体理由。
  const elevenSkipped = Array.from({ length: 11 }, (_, i) => ({
    ofTitle: i % 2 === 0 ? '非标许可证加的不只是披露' : '1亿MAU触发披露，开源许可加条件',
    why: i % 2 === 0
      ? '[0] 仍是同一篇金杜关于开源许可证"非标化"的文章，只是换了标题'
      : '[0] 讲的是同一件事：1亿 MAU 门槛触发披露',
  }))
  const llm11 = fakeLlm({ output: JSON.stringify({ posts: [], skipped: elevenSkipped }) })
  const writer11 = writerMod.createRealWriter({ getService: fakeServices(), llm: llm11, web: fakeWeb(), now: () => NOW })
  const runner11 = trigger.createFeedRunner({ store: storeL11, writer: writer11, now: () => NOW, syncX: false })
  await runner11.requestRun('manual')
  await runner11.idle()

  const run11 = (await storeL11.listRuns())[0]
  assert(run11.status === 'skipped', '①b 真实规模（11 条全判重复）status=skipped，实得 ' + run11.status)
  assert(run11.stats.modelSkipped === 11,
    '⚠⚠ ①b modelSkipped 必须是全量 11（界面标题写「本轮跳过 11 条」），实得 ' + run11.stats.modelSkipped)
  assert(run11.stats.modelSkipNotes.length === 10,
    '①b 理由只存前 10 条（slice(0,10) 的既有上限），实得 ' + run11.stats.modelSkipNotes.length)
  assert(String(run11.stats.noNewContentReason).includes('11'),
    '⚠ ①b 结论里要带真实条数 11（不是理由条数 10），实得 ' + run11.stats.noNewContentReason)
  assert(!String(run11.stats.noNewContentReason).includes('失败'),
    '⚠ ①b 结论里不许出现「失败」字样，实得 ' + run11.stats.noNewContentReason)
}

{ /* ── ② posts=[] 且 skipped=[]（JSON 里真没条目）→ 必须仍是 failed ── */
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeL2 = resolve(ROOT, '_tmp', 'smoke-feed-home-l2')
  try { rmSync(homeL2, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeL2, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeL2
  const storeL2 = new StoreClass()
  await storeL2.load()
  process.env.DSH_HOME = prevHome
  await storeL2.setConfig({ prompt: '盯住 AI', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  // 模型给了合法 JSON，但里面既没帖子、也没说跳过了什么 —— 异常，不是判重。
  const llm = fakeLlm({ output: JSON.stringify({ posts: [], skipped: [] }) })
  const realWriter = writerMod.createRealWriter({ getService: fakeServices(), llm, web: fakeWeb(), now: () => NOW })
  const runner = trigger.createFeedRunner({ store: storeL2, writer: realWriter, now: () => NOW, syncX: false })
  await runner.requestRun('manual')
  await runner.idle()

  const run = (await storeL2.listRuns())[0]
  assert(run.status === 'failed',
    '⚠⚠ ② posts=[] 且 skipped=[] → 必须仍是 failed（JSON 里真没条目是异常，不许被 skipped 吞掉），实得 '
    + run.status)
  assert(String(run.error).includes('没有任何动态条目'),
    '② run.error 指明「JSON 里没有任何动态条目」，实得 ' + run.error)
  assert(run.stats.noNewContent !== true,
    '② 真故障不许打 noNewContent 标记，实得 ' + run.stats.noNewContent)
}

/* ── 13.8 端到端：两轮连续生成，第二轮不产出与第一轮同标题的帖子 ── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeM = resolve(ROOT, '_tmp', 'smoke-feed-home-m')
  try { rmSync(homeM, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeM, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeM
  const storeM = new StoreClass()
  await storeM.load()
  process.env.DSH_HOME = prevHome
  await storeM.setConfig({ prompt: '盯住 AI 出海合规', model: 'default', cron: '0 12,18 * * *', xHandles: [] })

  const firstPost = {
    title: '欧盟把模型权重写进出口清单',
    body: '欧盟委员会本周把模型权重纳入两用物项清单，做海外发行的人多了一条合规线要盯。',
    sourceIds: [0],
    topics: ['law'],
    dueInHours: 0,
  }
  const firstLlm = fakeLlm({ output: JSON.stringify({ posts: [firstPost] }) })

  // ⚠ 时钟要往前推：第二轮的时间窗必须落在第一轮之后，否则「没有新内容」是时间窗导致的，
  // 就分不清「去重生效」和「窗口过滤生效」了。
  let clock = NOW
  const runnerM = trigger.createFeedRunner({
    store: storeM,
    writer: writerMod.createRealWriter({
      getService: fakeServices(), llm: firstLlm, web: fakeWeb(), now: () => clock,
    }),
    now: () => clock,
    syncX: false,
  })
  await runnerM.requestRun('manual')
  await runnerM.idle()
  const round1 = await storeM.listPosts()
  assert(round1.length === 1, '第一轮产出 1 条，实得 ' + round1.length)
  const firstTitle = round1[0].title
  const firstRun = (await storeM.listRuns())[0]
  const firstSince = firstRun.stats.sinceAt

  // 第二轮：模型"偷懒"又把同一条写了一遍（模型没判出来，兜底必须拦住）。
  clock = NOW + 2 * HOUR
  const repeatLlm = fakeLlm({
    output: JSON.stringify({
      posts: [
        { ...firstPost },                                    // 完全相同
        { ...firstPost, title: '欧盟把模型权重，写进出口清单。' }, // 只差标点
      ],
    }),
  })
  const runnerM2 = trigger.createFeedRunner({
    store: storeM,
    writer: writerMod.createRealWriter({
      getService: fakeServices(), llm: repeatLlm, web: fakeWeb(), now: () => clock,
    }),
    now: () => clock,
    syncX: false,
  })
  await runnerM2.requestRun('manual')
  await runnerM2.idle()

  const afterSecond = await storeM.listPosts()
  assert(afterSecond.length === 1,
    '⚠ 第二轮不产出与第一轮同标题的帖子（兜底去重生效），实得总数 ' + afterSecond.length
    + '：' + JSON.stringify(afterSecond.map(item => item.title)))
  const titlesNow = afterSecond.map(item => item.title)
  assert(new Set(titlesNow).size === titlesNow.length, '⚠ 列表里没有同标题的两条')

  const secondRun = (await storeM.listRuns())[0]
  assert(secondRun.stats['dropReasons'] !== undefined,
    '⚠ 第二轮 dropReasons 有值（去重丢弃被计数），实得 ' + JSON.stringify(secondRun.stats.dropReasons))
  assert(secondRun.stats.dropReasons['dup-title'] === 2,
    '⚠ 两条都被判 dup-title，实得 ' + JSON.stringify(secondRun.stats.dropReasons))
  assert(secondRun.stats.dropped >= 2, 'stats.dropped 把去重丢弃算进去了，实得 ' + secondRun.stats.dropped)
  assert(secondRun.status === 'skipped',
    '全部被去重挡下 → status=skipped（本轮确实写了一轮，只是没有可上架的新内容），实得 ' + secondRun.status)

  // ⚠ 时间窗递进：第二轮的水位线必须是第一轮的完成时刻，而不是「7 天前」。
  assert(typeof secondRun.stats.sinceAt === 'number' && secondRun.stats.sinceAt > firstSince,
    '⚠ 第二轮的时间窗起点晚于第一轮（水位线递进，不是每次都回落 7 天），实得 '
    + (secondRun.stats.sinceAt - firstSince) + 'ms 的差')
  assert(secondRun.stats.sinceSource === 'last-ok-run',
    "第二轮的水位线来源是 last-ok-run（上一轮成功生成时刻），实得 " + secondRun.stats.sinceSource)
  assert(secondRun.stats.sinceFallback === undefined,
    '第二轮不再标 sinceFallback（水位线读到了）')
}

/* ── 13.9 /status 暴露 sinceAt（界面能核对时间窗）── */
{
  const api = await load('api')
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeN = resolve(ROOT, '_tmp', 'smoke-feed-home-n')
  try { rmSync(homeN, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeN, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeN
  const storeN = new StoreClass()
  await storeN.load()
  process.env.DSH_HOME = prevHome

  // 造一条「上次成功」的轮次，让水位线可算。
  await storeN.upsertRun({
    id: 'r_ok_prev', trigger: 'manual', modelUsed: 'm',
    startedAt: NOW - 5 * HOUR, finishedAt: NOW - 5 * HOUR + 30000, status: 'ok',
  })

  const routes = []
  api.mountFeedRoutes(
    { webServer: { register: (route) => { routes.push(route); return () => {} } } },
    { store: storeN, runner: { requestRun: async () => 'started', idle: async () => {} }, now: () => NOW,
      getService: fakeServices({ llm: fakeLlm({ output: '' }) }) },
  )
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const statusJson = await new Promise((ok, bad) => {
    const req = httpRequest('http://127.0.0.1:' + port + '/api/dsh-feed/status', {
      method: 'GET', headers: { host: '127.0.0.1:' + port },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { bad(error) }
      })
    })
    req.on('error', bad)
    req.end()
  })

  assert(typeof statusJson.sinceAt === 'number' && statusJson.sinceAt > 0,
    '⚠ GET /status 暴露 sinceAt（本轮/下一轮实际使用的时间窗起点），实得 ' + statusJson.sinceAt)
  assert(statusJson.sinceAt === NOW - 5 * HOUR + 30000,
    '/status.sinceAt 与 executeRun 用同一个 resolveSinceWindow 算出（水位线 = 上次成功轮次的完成时刻），实得 '
    + (statusJson.sinceAt - NOW) + 'ms')
  assert(statusJson.sinceSource === 'last-ok-run', 'status.sinceSource = last-ok-run，实得 ' + statusJson.sinceSource)
  assert(statusJson.sinceFallback === false, 'status.sinceFallback = false（水位线读到了）')
  assert('lastSinceAt' in statusJson, 'status 另带 lastSinceAt（上一轮实际用过的起点）')

  await new Promise(ok => server.close(ok))
}

console.log('\n=== 7. 定时表达式骨架（P3）===');
{
  const index = await load('index')
  assert(index.parseCronIntervalMs('0 12,18 * * *') === 12 * 60 * 60 * 1000,
    '默认 cron（一天两次）折成 12 小时间隔')
  assert(index.parseCronIntervalMs('0 * * * *') === 60 * 60 * 1000, '每小时一次 → 1 小时间隔')
  assert(index.parseCronIntervalMs('bogus') === null, '解析不了的表达式返回 null（不抛，定时失效但手动更新照常）')
  assert(index.parseCronIntervalMs('0 12 * * 1') === null, '带星期限定的表达式返回 null（交给官方 schedule bundle）')
}

console.log('\n=== 8. 降级：X 抓取失败不影响整轮生成 ===');
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeE = resolve(ROOT, '_tmp', 'smoke-feed-home-e')
  try { rmSync(homeE, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeE, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeE
  const storeE = new StoreClass()
  await storeE.load()
  process.env.DSH_HOME = prevHome

  await storeE.setConfig({ prompt: 'p', model: 'default', cron: '0 12,18 * * *', xHandles: ['alpha', 'beta'] })
  const always429 = async () => ({ status: 429, ok: false, text: async () => 'Rate limit exceeded ' })
  /*
   * 这一段的核心命题是「**X 抓取失败不拖垮整轮生成**」。
   *
   * 假 writer 在这里的作用是把变量隔离掉：X 全 429 是本段唯一变量，
   * 写作本身必须成功，否则就分不清"X 挂了导致的 0 条"和"写作挂了导致的
   * 0 条"。（真实 writer 在没有 llm 的环境里必然失败 —— 那是正确行为，
   * 见第 9 段。）
   */
  const runner = trigger.createFeedRunner({
    store: storeE,
    writer: async () => [{
      title: 'X 全挂时仍然写出来的一条',
      body: '这条用于验证 X 抓取失败不会拖垮整轮生成，写作阶段照常执行。',
      topics: ['mine'],
      dueAt: 0,
      dueLabel: '',
      sourceRefs: [],
      mine: true,
    }],
    now: () => NOW,
    xDeps: { fetchImpl: always429, sleep: async () => {}, now: () => NOW },
  })
  await runner.requestRun('manual')
  await runner.idle()
  const posts = await storeE.listPosts()
  assert(posts.length === 1, 'X 全部失败时本轮仍产出内容（抓取失败不拖垮生成），实得 ' + posts.length)
  const runsList = await storeE.listRuns()
  assert(runsList[0].status === 'ok', '本轮 run 状态是 ok（不是 failed），实得 ' + runsList[0].status)
  const syncState = await storeE.getXSync('alpha')
  assert(syncState.cooldownUntil === NOW + sources.X_COOLDOWN_MS, '失败账号的冷却已落盘（下一轮直接跳过）')
  assert(syncState.lastOutcome === 'rate-limit', '失败原因按机器可读值落盘，实得 ' + syncState.lastOutcome)

  const brokenRunner = trigger.createFeedRunner({
    store: storeE,
    writer: async () => { throw new Error('writer exploded') },
    now: () => NOW,
    syncX: false,
  })
  await brokenRunner.requestRun('manual')
  await brokenRunner.idle()
  const runsAfterBreak = await storeE.listRuns()
  assert(runsAfterBreak[0].status === 'failed', 'writer 抛错 → 本轮记 failed，实得 ' + runsAfterBreak[0].status)
  assert(String(runsAfterBreak[0].error ?? '').includes('writer exploded'), 'run.error 保留了失败原因')
  const gateAfterBreak = await storeE.getGate()
  assert(gateAfterBreak.status === 'idle', '失败一轮后闸门仍回到 idle（不会永久卡在 running）')

  /*
   * lease **都没建立**的那条路径（2026-10-28 修「刷新机制」）：
   *
   * getConfig() 一抛，startLeaseRenewal 根本还没执行 —— 如果收尾只认
   * lease.stop()，闸门会永远停在 running，用户得等 10 分钟租约过期才能再点
   * 「更新」，界面上就是「更新按钮失灵 / 一直显示生成中」。
   */
  const brokenConfigStore = new Proxy(storeE, {
    get(target, prop) {
      if (prop === 'getConfig') return async () => { throw new Error('config read failed') }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const noConfigRunner = trigger.createFeedRunner({
    store: brokenConfigStore,
    writer: async () => [],
    now: () => NOW,
    syncX: false,
  })
  const startedNoConfig = await noConfigRunner.requestRun('manual')
  await noConfigRunner.idle()
  const gateAfterNoConfig = await storeE.getGate()
  assert(startedNoConfig === 'started', 'config 读盘失败时请求仍被接住（先 started）')
  assert(gateAfterNoConfig.status === 'idle',
    '⚠ config 读盘失败（lease 没建立）时闸门也必须收回 idle，实得 ' + gateAfterNoConfig.status)

  const recover = await brokenRunner.requestRun('manual')
  assert(recover === 'started', '失败之后仍然能起新一轮，实得 ' + recover)
  await brokenRunner.idle()
}

console.log('\n=== 14. 关注对象：存储 / 归属判定 / HTTP 路由（右侧悬浮球的后端） ===');

/*
 * 这一组覆盖 task-10「右侧悬浮球」的**后端三件事** —— 它们判错了都不会抛错：
 *
 *   1. 存储：entities.json 的增删改查必须落盘，重启（新实例）后还在；
 *   2. 归属判定：先看帖子的 entityIds，再看名字/别名的兜底子串匹配；
 *   3. 路由：GET/POST/PUT/DELETE /entities 与 GET /posts?entity=<id>。
 *
 * 第 2 条是本次最容易「看起来正常其实全空」的一块：模型不标 entityIds 时，
 * 用户加了关注对象、点开悬浮球看到的是一片「还没有关于 XXX 的动态」。所以
 * 兜底匹配必须有专门的断言 —— 而且必须断言它**不误命中**（单字、词内子串）。
 */
{
  const entitiesMod = await load('entities')
  const apiMod = await load('api')
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeG = resolve(ROOT, '_tmp', 'smoke-feed-home-g')
  try { rmSync(homeG, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeG, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeG
  const entityStore = new entitiesMod.EntityStore()
  await entityStore.load()
  const feedStoreG = new StoreClass()
  await feedStoreG.load()
  /*
   * ⚠ DSH_HOME 必须**整个 block 都保持指向 homeG**，不能在这里就恢复：
   * EntityStore / FeedStore 的 root 是在**构造时**读 env 算出来的，
   * 下面那个「重启后还在」的断言会再 new 一个 EntityStore —— 若此时 env
   * 已经恢复成真实 home，新实例读的是用户真目录，断言必然 0 条（而且
   * 差一点就去读用户真实数据了）。恢复放在 block 末尾。
   */

  /* ── 14.1 存储：增 / 判重 / 改 / 删 / 重启后还在 ── */
  const created = await entityStore.create({
    name: '黄仁勋',
    kind: 'person',
    xHandle: '@JensenHuang',
    aliases: 'Jensen Huang, 黄仁勋 , jensen huang',
  })
  assert(created.ok === true, '创建一个关注对象成功')
  const jensen = created.ok ? created.entity : null
  assert(jensen !== null && jensen.id.startsWith('fe_'), 'id 形如 fe_<uuid>，实得 ' + (jensen === null ? 'null' : jensen.id))
  assert(jensen !== null && jensen.xHandle === 'jensenhuang',
    'X 账号归一化成小写不带 @（@JensenHuang → jensenhuang），实得 ' + (jensen === null ? '' : String(jensen.xHandle)))
  assert(jensen !== null && jensen.aliases.length === 2,
    '别名大小写不敏感去重（Jensen Huang 与 jensen huang 只留一个），实得 ' + JSON.stringify(jensen === null ? [] : jensen.aliases))

  const dup = await entityStore.create({ name: '黄仁勋', kind: 'person' })
  assert(dup.ok === false && String(dup.error).includes('同名'), '同名同类判重时拒绝，实得 ' + JSON.stringify(dup))
  const emptyName = await entityStore.create({ name: '   ' })
  assert(emptyName.ok === false, '名字为空时拒绝（没名字的球既没首字也没 tooltip）')

  const openai = await entityStore.create({ name: 'OpenAI', kind: 'company', aliases: ['ChatGPT', 'Open AI'] })
  assert(openai.ok === true, '创建公司类关注对象成功')

  // 重启：新实例读同一份磁盘。
  const reloaded = new entitiesMod.EntityStore()
  await reloaded.load()
  const afterRestart = await reloaded.list()
  assert(afterRestart.length === 2, '重启（新实例重新读盘）后关注对象还在，实得 ' + afterRestart.length)
  assert(afterRestart[0].name === '黄仁勋', '列表按 createdAt 升序（先加的在前），实得 ' + afterRestart[0].name)

  // 局部更新：只改点名的字段，其余保持。
  const patched = await entityStore.update(jensen === null ? '' : jensen.id, { aliases: ['Jensen Huang', 'NVIDIA CEO'] })
  assert(patched.ok === true, 'update 成功')
  assert(patched.ok && patched.entity.xHandle === 'jensenhuang', 'update 只改点名的字段：没传的 xHandle 保持原值')
  assert(patched.ok && patched.entity.aliases.length === 2 && patched.entity.aliases.includes('NVIDIA CEO'),
    'update 把别名换成新的那份')
  const missing = await entityStore.update('fe_not_exist', { name: 'x' })
  assert(missing.ok === false, 'update 不存在的 id 返回 ok:false（不是静默成功）')

  /* ── 14.2 归属判定：entityIds 优先，别名兜底 ── */
  const list = await entityStore.list()
  const matcher = entitiesMod.createEntityMatcher(list)
  const jensenId = list[0].id
  const openaiId = list[1].id

  const tagged = post({ id: 'tagged', title: '和这条标题无关', body: '内容也没提名字' })
  tagged.entityIds = [openaiId]
  assert(JSON.stringify(matcher.idsOf(tagged)) === JSON.stringify([openaiId]),
    'entityIds 命中时直接归属（不看正文），实得 ' + JSON.stringify(matcher.idsOf(tagged)))
  assert(matcher.matchKindOf(tagged) === 'tagged', 'matchKindOf 报 tagged')

  const byName = post({ id: 'by_name', title: '黄仁勋在发布会上说了三件事', body: '...' })
  assert(matcher.idsOf(byName).includes(jensenId), '⚠ 兜底：正文出现名字就归属（模型没标时全靠它）')
  assert(matcher.matchKindOf(byName) === 'alias', 'matchKindOf 报 alias（兜底路径）')

  const byAlias = post({ id: 'by_alias', title: 'Jensen Huang 谈下一代 GPU', body: '...' })
  assert(matcher.idsOf(byAlias).includes(jensenId), '别名（大小写不敏感）也能归属')
  const byAlias2 = post({ id: 'by_alias2', title: 'NVIDIA CEO 表示', body: '...' })
  assert(matcher.idsOf(byAlias2).includes(jensenId), '后补的别名（NVIDIA CEO）也能归属')

  const unrelated = post({ id: 'unrelated', title: '今天天气不错', body: '出去走走' })
  assert(matcher.idsOf(unrelated).length === 0, '无关内容不归属任何人')

  /*
   * 误命中的三道防线，逐条断言（这三条是「一堆动态被莫名其妙归给同一个人」
   * 的唯一拦路石，写错任何一条都不会抛错，只会让归属结果变得没法解释）：
   */
  const single = await entityStore.create({ name: '李', kind: 'person' })
  assert(single.ok === true, '单字名字本身允许创建')
  const singleMatcher = entitiesMod.createEntityMatcher(await entityStore.list())
  assert(singleMatcher.idsOf(post({ id: 'x1', title: '李雷和韩梅梅', body: '' })).includes(single.entity.id) === false,
    '⚠ 单字关键词不参与匹配（否则几乎每条动态都会归给它）')
  await entityStore.remove(single.entity.id)

  const ascii = post({ id: 'x2', title: 'openailab 发布了新东西', body: '' })
  assert(matcher.idsOf(ascii).includes(openaiId) === false,
    '⚠ ASCII 关键词走词边界：OpenAI 不在 openailab 里命中')
  const withPunct = post({ id: 'x3', title: 'OpenAI，发布了新模型', body: '' })
  assert(matcher.idsOf(withPunct).includes(openaiId) === true,
    'ASCII 关键词后面跟中文标点算命中（词边界不误伤正常写法）')

  // 已标归属的帖子不因为正文提到别人就再挂一个人。
  const mixedPost = post({ id: 'x4', title: 'OpenAI 回应黄仁勋', body: '' })
  mixedPost.entityIds = [openaiId]
  assert(JSON.stringify(matcher.idsOf(mixedPost)) === JSON.stringify([openaiId]),
    '⚠ 已标 entityIds 的帖子不再走别名兜底（OpenAI 回应英伟达 → 只归 OpenAI），实得 ' + JSON.stringify(matcher.idsOf(mixedPost)))

  // 删掉实体后，老帖子上残留的 id 不再算数。
  const stale = post({ id: 'x5', title: 't', body: '' })
  stale.entityIds = ['fe_deleted_entity']
  assert(matcher.idsOf(stale).length === 0, '已删除实体残留的 entityIds 被过滤掉（不会让帖子凭空消失）')

  // 计数（悬浮球角标）。
  const counts = matcher.countByEntity([tagged, byName, byAlias, unrelated,
    post({ id: 'x6', title: 'OpenAI 新模型', body: '', deletedAt: NOW })])
  assert(counts[jensenId] === 2, '黄仁勋名下 2 条（byName + byAlias），实得 ' + counts[jensenId])
  assert(counts[openaiId] === 1, 'OpenAI 名下 1 条（软删的不算），实得 ' + counts[openaiId])

  // withResolvedEntities 补出来的 id 与 matcher 同源。
  const resolved = entitiesMod.withResolvedEntities([byName, unrelated], matcher)
  assert(JSON.stringify(resolved[0].entityIds) === JSON.stringify([jensenId]), 'withResolvedEntities 给列表补 entityIds')
  assert(resolved[1].entityIds === undefined, '不属于任何实体的帖子不塞空数组（保持 undefined）')

  /* ── 14.3 派生：xHandles 与实体对齐 ── */
  assert(JSON.stringify(entitiesMod.xHandlesOf(await entityStore.list())) === JSON.stringify(['jensenhuang']),
    'xHandlesOf 只收实体上真的有的 handle')
  const writerEntities = entitiesMod.writerEntitiesOf(await entityStore.list())
  assert(writerEntities.length === 2 && writerEntities[0].name !== undefined,
    'writerEntitiesOf 投影出名字/类型/别名')
  assert(!JSON.stringify(writerEntities).includes('fe_'), '⚠ 给 writer 的投影里**不含 id**（模型抄错 id 会静默丢归属）')

  /* ── 14.4 首字球 ── */
  assert(entitiesMod.initialOf('openai') === 'O', '首字球：英文名取首字母大写，实得 ' + entitiesMod.initialOf('openai'))
  assert(entitiesMod.initialOf('黄仁勋') === '黄', '首字球：中文取首字')
  assert(entitiesMod.initialOf('🔷DeepSeek') === 'D', '首字球：跳过 emoji 取字母，实得 ' + entitiesMod.initialOf('🔷DeepSeek'))
  assert(entitiesMod.initialOf('   ') === '?', '首字球：空名字给问号（永远有字，不出现空球）')

  /* ── 14.5 HTTP 路由 ── */
  await feedStoreG.addPosts([
    post({ id: 'p_jensen', createdAt: NOW - HOUR, title: '黄仁勋：AI 工厂是下一波', body: '正文' }),
    post({ id: 'p_openai', createdAt: NOW - 2 * HOUR, title: 'OpenAI 发布新模型', body: '正文' }),
    post({ id: 'p_none', createdAt: NOW - 3 * HOUR, title: '无关的一条', body: '正文' }),
  ])
  const routes = []
  apiMod.mountFeedRoutes({ webServer: { register: (route) => { routes.push(route); return () => {} } } },
    { store: feedStoreG, runner: { requestRun: async () => 'started', idle: async () => {} }, now: () => NOW, entityStore })
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const call = (path, options = {}) => new Promise((ok, bad) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const req = httpRequest('http://127.0.0.1:' + port + '/api/dsh-feed' + path, {
      method: options.method ?? 'GET',
      headers: {
        host: '127.0.0.1:' + port,
        ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
      },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* 非 JSON */ }
        ok({ status: res.statusCode, json: parsed })
      })
    })
    req.on('error', bad)
    if (body !== undefined) req.write(body)
    req.end()
  })

  const gotList = await call('/entities')
  assert(gotList.json?.ok === true && Array.isArray(gotList.json.entities), 'GET /entities 回 ok + entities 数组')
  assert(gotList.json.entities.length === 2, 'GET /entities 返回 2 个，实得 ' + gotList.json.entities.length)
  const view = gotList.json.entities[0]
  assert(typeof view.initial === 'string' && view.initial !== '', '实体视图带服务端算好的首字（客户端不重复实现三条规则）')
  assert(typeof view.postCount === 'number', '实体视图带 postCount（悬浮球角标 / 设置面板）')
  assert(view.name === '黄仁勋' && view.postCount === 1, '黄仁勋名下 1 条（按名字兜底匹配到 p_jensen），实得 ' + view.postCount)

  const scoped = await call('/posts?entity=' + encodeURIComponent(jensenId))
  assert(scoped.json?.ok === true, 'GET /posts?entity=<id> 成功')
  const scopedIds = scoped.json.days.flatMap(day => day.items.map(item => item.id))
  assert(JSON.stringify(scopedIds) === JSON.stringify(['p_jensen']),
    '⚠ entity 筛选只留该实体名下的动态，实得 ' + JSON.stringify(scopedIds))
  assert(scoped.json.entity !== null && scoped.json.entity.id === jensenId, '带 entity 时回包里附上该实体（浮层标题直接用）')
  assert(scoped.json.counts.total === 1, '带 entity 时计数也只算该实体名下（球上条数与点开列表必须一致）')

  const allWithEntities = await call('/posts')
  const jensenPost = allWithEntities.json.days.flatMap(d => d.items).find(item => item.id === 'p_jensen')
  assert(Array.isArray(jensenPost.entityIds) && jensenPost.entityIds.includes(jensenId),
    'GET /posts 的响应里补上了实时算出来的 entityIds（别名兜底也算）')
  const nonePost = allWithEntities.json.days.flatMap(d => d.items).find(item => item.id === 'p_none')
  assert(nonePost.entityIds === undefined, '不属于任何实体的帖子不带 entityIds 字段（不塞空数组）')

  const created2 = await call('/entities', { method: 'POST', body: { name: 'DeepSeek', kind: 'company', aliases: '深度求索' } })
  assert(created2.json?.ok === true && created2.json.entity.name === 'DeepSeek', 'POST /entities 新建成功')
  const postDup = await call('/entities', { method: 'POST', body: { name: 'DeepSeek', kind: 'company' } })
  assert(postDup.json?.ok === false, 'POST 同名同类 → 200 + ok:false（业务失败不用 4xx）')
  assert(postDup.status === 200, '业务失败仍是 HTTP 200（客户端按 payload.ok 判），实得 ' + postDup.status)
  const postEmpty = await call('/entities', { method: 'POST', body: {} })
  assert(postEmpty.json?.ok === false && String(postEmpty.json.error).includes('名字'), 'POST 缺名字 → ok:false 且有中文原因')

  const updated2 = await call('/entities', {
    method: 'PUT',
    body: { id: created2.json.entity.id, aliases: ['深度求索', 'DeepSeek V4'] },
  })
  assert(updated2.json?.ok === true && updated2.json.entity.aliases.length === 2, 'PUT /entities 改别名成功')
  assert(updated2.json.entity.name === 'DeepSeek', 'PUT 没传 name 时保持原值（局部更新）')

  const removed2 = await call('/entities', { method: 'DELETE', body: { id: created2.json.entity.id } })
  assert(removed2.json?.ok === true, 'DELETE /entities 成功')
  const removedAgain = await call('/entities', { method: 'DELETE', body: { id: created2.json.entity.id } })
  assert(removedAgain.json?.ok === true, 'DELETE 幂等：删已不存在的 id 也回 ok（连点两次不该弹错）')
  const afterDelete = await call('/entities')
  assert(afterDelete.json.entities.length === 2, '删除后列表回到 2 个，实得 ' + afterDelete.json.entities.length)

  // 实体上的 handle 要派生回 config.xHandles（X 抓取链路读的是它）。
  const configAfter = await call('/config')
  assert(Array.isArray(configAfter.json.config.xHandles) && configAfter.json.config.xHandles.includes('jensenhuang'),
    '实体上的 X 账号已派生进 config.xHandles（抓取链路读的是它），实得 ' + JSON.stringify(configAfter.json.config.xHandles))


  /* ── 14.6 给 writer 的注入：只注入数据，不做判断 ── */
  const writerMod = await load('writer')
  const entBlock = writerMod.formatFollowedEntitiesBlock([
    { name: '黄仁勋', kind: 'person', aliases: ['Jensen Huang'] },
    { name: 'OpenAI', kind: 'company' },
  ])
  const entText = entBlock.join('\n')
  assert(entText.includes('本轮关注的对象'), '给 writer 的段落有标题「本轮关注的对象」')
  assert(entText.includes('黄仁勋（人物）') && entText.includes('OpenAI（公司）'),
    '段落里逐个列出名字 + 类型')
  assert(entText.includes('别名：Jensen Huang'), '段落里带上别名（判重与覆盖都靠它）')
  assert(entText.includes('"entities": ["OpenAI"]'), '段落里要求模型在输出 JSON 里标注归属（用名字）')
  assert(writerMod.formatFollowedEntitiesBlock([]).length === 0, '没有关注对象时整段不出现')
  assert(writerMod.formatFollowedEntitiesBlock([{ name: '  ', kind: 'person' }]).length === 0,
    '空名字的实体不会出现在提示词里')
  // 注入的是**数据**：不能出现任何 id（模型抄错 id 会静默丢归属）。
  assert(!entText.includes('fe_'), '⚠ 注入段里不含任何实体 id（只给名字）')

  const fullUser = writerMod.buildWriterUserText({
    prompt: '盯住 AI',
    now: NOW,
    sources: [],
    knownTitles: [],
    followedEntities: [{ name: '黄仁勋', kind: 'person' }],
  })
  assert(fullUser.includes('本轮关注的对象') && fullUser.includes('黄仁勋'),
    'buildWriterUserText 里真的拼进了关注对象段')
  const noEntityUser = writerMod.buildWriterUserText({
    prompt: '盯住 AI',
    now: NOW,
    sources: [],
    knownTitles: [],
  })
  assert(!noEntityUser.includes('本轮关注的对象'), '不传 followedEntities 时该段完全不出现（老调用方零影响）')
  // 顺序：关注对象必须排在来源清单**之前**（详见 buildWriterUserText 里的说明）。
  assert(fullUser.indexOf('本轮关注的对象') < fullUser.indexOf('本轮已验活的来源清单'),
    '关注对象段排在来源清单之前（先说明该盯谁，再给资料）')

  /* ── 14.7 模型标注的名字 → 实体 id 的换算 ── */
  const table = await entityStore.list()
  assert(JSON.stringify(entitiesMod.resolveEntityIds(['黄仁勋'], table)) === JSON.stringify([jensenId]),
    '名字完全相等 → 换回 id')
  assert(JSON.stringify(entitiesMod.resolveEntityIds(['  openai  '], table)) === JSON.stringify([openaiId]),
    '名字匹配忽略大小写与首尾空白')
  assert(JSON.stringify(entitiesMod.resolveEntityIds(['ChatGPT'], table)) === JSON.stringify([openaiId]),
    '模型用别名代替正名也能换回 id（ChatGPT → OpenAI）')
  assert(JSON.stringify(entitiesMod.resolveEntityIds(['OpenAI Inc.'], table)) === JSON.stringify([openaiId]),
    '模型写全称（正名是它的一部分）也能匹配上：OpenAI Inc. → OpenAI')
  /*
   * ⚠ 反向断言：**匹配不上时必须返回空**，不能乱猜。
   *
   * 'NVIDIA Corporation' 与这个实体的正名（黄仁勋）和别名（Jensen Huang /
   * NVIDIA CEO）都不是子串关系 —— 正确的行为是**不归属**，留给 GET /posts 的
   * 别名兜底去判定。这里如果「猜」成黄仁勋，用户看到的会是「黄仁勋名下有一堆
   * 其实他只是被提及的动态」，而那比空着更难排查。
   */
  assert(entitiesMod.resolveEntityIds(['NVIDIA Corporation'], table).length === 0,
    '全称与正名/别名无子串关系时不归属（不猜，留给别名兜底）')
  assert(entitiesMod.resolveEntityIds(['不存在的人'], table).length === 0,
    '匹配不上就返回空（不猜：留给别名兜底，比乱归更安全）')
  assert(entitiesMod.resolveEntityIds(['黄仁勋', '黄仁勋'], table).length === 1, '重复标注去重')
  assert(entitiesMod.resolveEntityIds([null, 42, '黄仁勋'], table).length === 1,
    '脏数据（null / 数字）被跳过，不影响其余项')
  await new Promise(ok => server.close(ok))
  // DSH_HOME 在 block 末尾恢复：上面「重启后还在」要再 new 一个 EntityStore，
  // 它的 root 也是构造时读 env 算的（见 block 开头那段注释）。
  process.env.DSH_HOME = prevHome
}


console.log('\n=== 15. 媒体（图片 / 视频）：解析 → 归属 → 落盘 → API 投影 ===');

/*
 * 用户原话（2026-10-28）：「他们的动态有图片或视频就把链接放上来，渲染出来，
 * 可播放可查看」。
 *
 * 这一组钉住的是「数据里有真实的媒体 URL」这条链路的**每一段**：
 *
 *   1. 解析：两条通道（主通道 entities.media / 备用通道 mediaDetails）都要能
 *      解析出图片直链与视频 mp4 直链；
 *   2. 归属：动态只能带**它自己引用的那条推文**的媒体（不能串到别人的图上）；
 *   3. 落盘：空数组不写、上限 4 条、脏 URL 被洗掉；
 *   4. 投影：API 出参里 media 恒为数组（客户端可以直接 map）。
 *
 * 全部用假数据：不联网、不碰真模型、不依赖运行时刻。
 */

/* ── 15.1 纯函数：图片 / 视频 / 多图 / 无媒体 / HLS-only ── */
{
  const photo = sources.parseMediaItem({
    type: 'photo',
    media_url_https: 'https://pbs.twimg.com/media/HVQqxxFWMAA8mDb.jpg',
    original_info: { width: 1200, height: 675 },
  })
  assert(photo !== null, '图片能解析出来（实得 null 说明 media_url_https 没被认）')
  assert(photo.url === 'https://pbs.twimg.com/media/HVQqxxFWMAA8mDb.jpg',
    'photo 的 url 就是图片直链（不是页面地址），实得 ' + photo.url)
  assert(photo.type === 'photo', 'photo 的 type 是 photo，实得 ' + photo.type)
  assert(photo.width === 1200 && photo.height === 675,
    'photo 带上 original_info 的宽高（渲染时防跳动），实得 ' + photo.width + 'x' + photo.height)
  assert(photo.videoUrl === undefined, '图片没有 videoUrl（有的话界面会去渲染一个不存在的视频）')

  /*
   * 视频：三个 variants 里必须挑**最高码率的 mp4**，且绝不选 HLS。
   *
   * 取第一个 mp4 会拿到 640x360（832000），那在桌面端看起来就是糊的；
   * 而选 HLS（application/x-mpegURL）浏览器 video 标签直接放不了（要 hls.js）。
   */
  const video = sources.parseMediaItem({
    type: 'video',
    media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/123/img/cover.jpg',
    original_info: { width: 1280, height: 720 },
    video_info: {
      duration_millis: 45000,
      variants: [
        { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x/playlist.m3u8' },
        { content_type: 'video/mp4', url: 'https://video.twimg.com/x/640x360/low.mp4', bitrate: 832000 },
        { content_type: 'video/mp4', url: 'https://video.twimg.com/x/1280x720/high.mp4', bitrate: 2176000 },
      ],
    },
  })
  assert(video !== null, '视频能解析出来')
  assert(video.videoUrl === 'https://video.twimg.com/x/1280x720/high.mp4',
    '视频直链取最高码率的 mp4（不是第一个、也不是 HLS），实得 ' + video.videoUrl)
  assert(video.url === 'https://pbs.twimg.com/amplify_video_thumb/123/img/cover.jpg',
    '视频的 url 仍是封面图（当 poster 用），实得 ' + video.url)
  assert(video.type === 'video', '视频的 type 是 video，实得 ' + video.type)
  assert(video.durationSec === 45,
    'duration_millis 换成秒（45000 变成 45），实得 ' + video.durationSec)

  // animated_gif 是视频的一种（X 的动图实际是 mp4），不能被当成静态图。
  const gif = sources.parseMediaItem({
    type: 'animated_gif',
    media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg',
    video_info: { variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/g.mp4', bitrate: 0 }] },
  })
  assert(gif !== null && gif.type === 'animated_gif' && gif.videoUrl === 'https://video.twimg.com/g.mp4',
    'animated_gif 也带 videoUrl（X 的动图就是 mp4，只给封面等于不能动）')

  /*
   * 只有 HLS、没有 mp4：type 仍是 video、封面仍可用，但不给 videoUrl。
   *
   * 这是刻意的：给一个 .m3u8 让 video 标签去播，结果是黑屏 + 控制台报错，
   * 比「显示封面图 + 引导去原推看」差得多。
   */
  const hlsOnly = sources.parseMediaItem({
    type: 'video',
    media_url_https: 'https://pbs.twimg.com/cover.jpg',
    video_info: { variants: [{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/p.m3u8' }] },
  })
  assert(hlsOnly !== null && hlsOnly.videoUrl === undefined,
    '只有 HLS 时不给 videoUrl（.m3u8 浏览器 video 标签放不了，宁可不给）')

  // 无 URL / 脏数据 → null（宁可不显示，也不落一个空 src 变成破图）。
  assert(sources.parseMediaItem({ type: 'photo' }) === null, '缺 media_url_https 的媒体项返回 null')
  assert(sources.parseMediaItem(null) === null && sources.parseMediaItem('x') === null,
    '非对象媒体项返回 null，不抛')

  // 多图：顺序必须与推文里一致（第一张是主图）。
  const multi = sources.parseMediaList([
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/1.jpg' },
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/2.jpg' },
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/3.jpg' },
  ])
  assert(multi.length === 3, '多图解析出 3 项，实得 ' + multi.length)
  assert(multi[0].url.endsWith('/1.jpg') && multi[2].url.endsWith('/3.jpg'), '多图保持原顺序（第一张是主图）')

  // 无媒体：null / 空数组 / 非数组都得到空数组，绝不抛。
  assert(JSON.stringify(sources.parseMediaList(null)) === '[]', 'media 为 null → 空数组')
  assert(JSON.stringify(sources.parseMediaList([])) === '[]', 'media 为空数组 → 空数组')
  assert(JSON.stringify(sources.parseMediaList({})) === '[]', 'media 不是数组 → 空数组（脏数据不抛）')

  // 单个脏条目不影响同批的其它条目。
  const mixedList = sources.parseMediaList([
    { type: 'photo' },
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/ok.jpg' },
  ])
  assert(mixedList.length === 1 && mixedList[0].url.includes('ok.jpg'),
    '单个脏媒体项被跳过，同批其余项照常解析')
}


/* ── 15.2 主通道：entities.media 里的图片与视频都要解析出来 ── */
{
  const tweets = sources.parseTweetsFromNextData(JSON.stringify({
    props: {
      pageProps: {
        timeline: {
          entries: [
            tweetEntry({
              id: '5001',
              handle: 'picuser',
              createdAt: 'Wed Oct 21 15:38:10 +0000 2026',
              media: [
                {
                  type: 'photo',
                  media_url_https: 'https://pbs.twimg.com/media/HVQqxxFWMAA8mDb.jpg',
                  original_info: { width: 1200, height: 675 },
                },
                {
                  type: 'video',
                  media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/9/img/c.jpg',
                  video_info: {
                    duration_millis: 12000,
                    variants: [
                      { content_type: 'video/mp4', url: 'https://video.twimg.com/lo.mp4', bitrate: 100 },
                      { content_type: 'video/mp4', url: 'https://video.twimg.com/hi.mp4', bitrate: 900 },
                    ],
                  },
                },
              ],
            }),
          ],
        },
      },
    },
  }))
  assert(tweets !== null && tweets.length === 1, '主通道解析出 1 条推文')
  const media = tweets[0].media
  assert(media.length === 2, '主通道解析出 2 个媒体项，实得 ' + media.length)
  assert(media[0].type === 'photo' && media[0].url.includes('pbs.twimg.com/media/'),
    '主通道的图片直链在 pbs.twimg.com，实得 ' + media[0].url)
  assert(media[1].type === 'video' && media[1].videoUrl === 'https://video.twimg.com/hi.mp4',
    '主通道的视频也解析出最高码率 mp4，实得 ' + media[1].videoUrl)
  assert(media[1].durationSec === 12, '主通道的视频时长换算正确，实得 ' + media[1].durationSec)

  // 没带媒体的推文：media 是空数组（不是 undefined —— 下游会 .length）。
  const plain = sources.parseTweetsFromNextData(JSON.stringify({
    props: { pageProps: { timeline: { entries: [tweetEntry({ id: '5002', media: null })] } } },
  }))
  assert(Array.isArray(plain[0].media) && plain[0].media.length === 0,
    '无媒体推文的 media 是空数组（不是 undefined）')
}

/* ── 15.3 备用通道：mediaDetails 里的图片与视频 ── */
{
  /*
   * 备用通道 = 主页 HTML 拿推文 ID → cdn.syndication.twimg.com/tweet-result 取详情。
   * 实测这条通道的媒体字段叫 mediaDetails（不是 entities.media），
   * 而且媒体信息最全（图片带 original_info、视频带完整 variants）。
   */
  const detail = {
    text: 'a tweet with media',
    created_at: '2026-10-21T15:38:10.000Z',
    favorite_count: 7,
    conversation_count: 2,
    lang: 'en',
    user: { screen_name: 'picuser', name: 'Pic User', profile_image_url_https: 'https://pbs.twimg.com/p.jpg' },
    mediaDetails: [
      {
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/media/AAA.jpg',
        original_info: { width: 1200, height: 675 },
      },
      {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/7/img/t.jpg',
        video_info: {
          duration_millis: 45000,
          variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/p.m3u8' },
            { content_type: 'video/mp4', url: 'https://video.twimg.com/640.mp4', bitrate: 832000 },
            { content_type: 'video/mp4', url: 'https://video.twimg.com/1280.mp4', bitrate: 2176000 },
          ],
        },
      },
    ],
  }
  const fakeFetch = async (url) => {
    const u = String(url)
    if (u.includes('syndication.twitter.com/srv/timeline-profile')) {
      // 主通道 429 → 触发备用通道。
      return { status: 429, ok: false, text: async () => 'Rate limit exceeded ' }
    }
    if (u === 'https://x.com/picuser') {
      return { status: 200, ok: true, text: async () => '<html><a href="/picuser/status/9001">t</a></html>' }
    }
    if (u.includes('/tweet-result')) {
      return { status: 200, ok: true, text: async () => JSON.stringify(detail) }
    }
    return { status: 500, ok: false, text: async () => '' }
  }
  const result = await sources.fetchOnce('picuser', { fetchImpl: fakeFetch })
  assert(result.outcome === 'ok', '主通道 429 后备用通道拿到数据，实得 ' + result.outcome)
  assert(result.tweets.length === 1, '备用通道解析出 1 条推文，实得 ' + result.tweets.length)
  const media = result.tweets[0].media
  assert(media.length === 2, 'mediaDetails 解析出 2 个媒体项（旧代码这里恒为空数组），实得 ' + media.length)
  assert(media[0].type === 'photo' && media[0].url === 'https://pbs.twimg.com/media/AAA.jpg',
    'mediaDetails 的图片直链正确，实得 ' + media[0].url)
  assert(media[0].width === 1200, 'mediaDetails 的图片尺寸带过来了，实得 ' + media[0].width)
  assert(media[1].videoUrl === 'https://video.twimg.com/1280.mp4',
    'mediaDetails 的视频取最高码率 mp4（实测可直接播放），实得 ' + media[1].videoUrl)
  assert(media[1].durationSec === 45, 'mediaDetails 的视频时长 = 45 秒，实得 ' + media[1].durationSec)
}


/* ── 15.4 归属：只带「这条动态引用的那条推文」的媒体，最多 4 条 ── */
{
  /** 造一条带媒体的 X 推文。 */
  const tweetOf = (id, media) => ({
    id,
    handle: 'picuser',
    name: 'Pic User',
    avatar: '',
    text: 't' + id,
    createdAt: NOW,
    url: 'https://x.com/picuser/status/' + id,
    likes: 0,
    retweets: 0,
    replies: 0,
    lang: 'en',
    media,
  })
  const photoOf = (n) => ({ url: 'https://pbs.twimg.com/media/' + n + '.jpg', type: 'photo', width: 100, height: 100 })
  const sourceOf = (tweet) => ({
    index: 0,
    url: tweet.url,
    domain: 'x.com',
    title: '@picuser',
    access: 'limited',
    body: '',
    clue: '',
    fetchedAt: NOW,
  })

  const withPhoto = tweetOf('6001', [photoOf('a'), photoOf('b')])
  const noMedia = tweetOf('6002', [])
  const other = tweetOf('6003', [photoOf('other')])

  // 引用带图的那条 → 带出它自己的图。
  const fromPhoto = writerMod.collectDraftMedia([sourceOf(withPhoto)], [withPhoto, noMedia, other])
  assert(fromPhoto.length === 2, '引用带图推文 → 带出 2 个媒体项，实得 ' + fromPhoto.length)
  assert(fromPhoto[0].url === 'https://pbs.twimg.com/media/a.jpg', '媒体 URL 原样带过来，实得 ' + fromPhoto[0].url)
  assert(fromPhoto[0].sourceUrl === 'https://x.com/picuser/status/6001',
    '媒体带 sourceUrl（溯源用：这张图是哪条推文带来的），实得 ' + fromPhoto[0].sourceUrl)

  /*
   * 归属判据是 URL **全等**，不是子串/前缀。
   *
   * 用子串匹配的话 .../status/600 会命中 .../status/6001，把别人的图挂到
   * 这条动态上 —— 那种错误在界面上完全看不出来（图能显示，只是不是这条的）。
   */
  const wrongId = { ...sourceOf(withPhoto), url: 'https://x.com/picuser/status/600' }
  assert(writerMod.collectDraftMedia([wrongId], [withPhoto]).length === 0,
    '推文 id 前缀相同但不等 → 不串图（全等匹配，不是子串匹配）')

  // 引用没带媒体的推文 → 空数组（不是「借用别人的」）。
  assert(writerMod.collectDraftMedia([sourceOf(noMedia)], [withPhoto, noMedia]).length === 0,
    '引用无媒体推文 → 空数组（不借用同批其它推文的媒体）')

  // 引用非 X 来源（网页）→ 空数组。
  const webSource = { ...sourceOf(withPhoto), url: 'https://news.example/a' }
  assert(writerMod.collectDraftMedia([webSource], [withPhoto]).length === 0,
    '引用网页来源 → 空数组（媒体只从 X 推文来）')

  // 同一条推文被引用两次（模型常这么干）→ 不重复。
  const dupSources = [sourceOf(withPhoto), sourceOf(withPhoto)]
  assert(writerMod.collectDraftMedia(dupSources, [withPhoto]).length === 2,
    '同一条推文被引用两次 → 媒体不重复（2 项，不是 4 项）')

  // 上限 4 条（X 单条推文上限就是 4，多出来的只会撑爆卡片）。
  const many = tweetOf('6004', [photoOf('1'), photoOf('2'), photoOf('3'), photoOf('4'), photoOf('5'), photoOf('6')])
  const capped = writerMod.collectDraftMedia([sourceOf(many)], [many])
  assert(capped.length === types.MAX_FEED_MEDIA,
    '媒体最多 4 条（MAX_FEED_MEDIA），实得 ' + capped.length)
  assert(types.MAX_FEED_MEDIA === 4, 'MAX_FEED_MEDIA 常量是 4')

  // 多条推文一起引用：按来源顺序拼接，仍受 4 条上限。
  const twoTweets = writerMod.collectDraftMedia(
    [sourceOf(withPhoto), sourceOf(other)], [withPhoto, other])
  assert(twoTweets.length === 3, '两条推文各带媒体 → 合起来 3 项，实得 ' + twoTweets.length)

  // 空输入不抛。
  assert(writerMod.collectDraftMedia([], [withPhoto]).length === 0, '没有来源 → 空数组')
  assert(writerMod.collectDraftMedia([sourceOf(withPhoto)], []).length === 0, '没有推文 → 空数组')
}


/* ── 15.5 落盘前的清洗：脏 URL 洗掉、空数组不落盘 ── */
{
  const media = [
    { url: 'https://pbs.twimg.com/media/a.jpg', type: 'photo', width: 1200, height: 675, sourceUrl: 'https://x.com/u/status/1' },
    { url: 'javascript:alert(1)', type: 'photo', sourceUrl: 'https://x.com/u/status/1' },
    { url: 'https://pbs.twimg.com/media/b.jpg', type: 'photo', sourceUrl: 'not-a-url' },
    { url: 'https://video.twimg.com/v.mp4', type: 'video', videoUrl: 'https://video.twimg.com/v.mp4', sourceUrl: 'https://x.com/u/status/2' },
    { url: 'https://pbs.twimg.com/media/c.jpg', type: 'photo', sourceUrl: 'https://x.com/u/status/3' },
    { url: 'https://pbs.twimg.com/media/d.jpg', type: 'photo', sourceUrl: 'https://x.com/u/status/4' },
    { url: 'https://pbs.twimg.com/media/e.jpg', type: 'photo', sourceUrl: 'https://x.com/u/status/5' },
  ]
  const clean = trigger.sanitizeDraft({
    title: 't', body: 'b', topics: ['tech'], sourceRefs: [], media,
  })
  assert(clean !== null, '带媒体的草稿能通过校验')
  assert(clean.media.length === types.MAX_FEED_MEDIA,
    '清洗后最多 4 条（多余的被截断），实得 ' + clean.media.length)
  assert(clean.media.every(item => /^https?:\/\//i.test(item.url)),
    '非 http(s) 的 url 被洗掉（javascript: 这类既不能显示也不能点）')
  assert(clean.media.every(item => /^https?:\/\//i.test(item.sourceUrl)),
    'sourceUrl 也必须是 http(s)（否则溯源链接点不动）')
  assert(clean.media[1].videoUrl === 'https://video.twimg.com/v.mp4',
    '视频的 videoUrl 被保留，实得 ' + clean.media[1].videoUrl)

  // 没有 media 字段的草稿（老调用方）→ 空数组，不抛。
  const noMedia = trigger.sanitizeDraft({ title: 't', body: 'b', topics: ['tech'], sourceRefs: [] })
  assert(noMedia !== null && Array.isArray(noMedia.media) && noMedia.media.length === 0,
    '不带 media 的草稿 → media 是空数组（老调用方零影响）')

  /*
   * 读盘侧再洗一遍：posts.json 是可手改的纯文本，而媒体直接进 img 标签。
   * 图片带着 videoUrl（脏数据）时必须丢掉 —— 否则界面会去渲染一个不存在的视频。
   */
  const storeMod = await load('store')
  const normalized = storeMod.__test.normalizeMedia([
    { url: 'https://pbs.twimg.com/media/a.jpg', type: 'photo', videoUrl: 'https://video.twimg.com/x.mp4', sourceUrl: 'https://x.com/u/status/1' },
    { url: 'https://pbs.twimg.com/media/b.jpg', type: 'weird', sourceUrl: 'https://x.com/u/status/2' },
    { url: '', type: 'photo', sourceUrl: 'https://x.com/u/status/3' },
    { url: 'https://pbs.twimg.com/media/c.jpg', type: 'photo' },
  ])
  assert(normalized.length === 2, '读盘时脏媒体项被丢掉（空 url / 缺 sourceUrl），实得 ' + normalized.length)
  assert(normalized[0].videoUrl === undefined, '图片上的 videoUrl 被丢掉（否则界面会渲染不存在的视频）')
  assert(normalized[1].type === 'photo', '不认识的 type 降级成 photo，实得 ' + normalized[1].type)

  // 上限在读盘时也生效。
  const overLimit = storeMod.__test.normalizeMedia(
    Array.from({ length: 9 }, (_, index) => ({
      url: 'https://pbs.twimg.com/media/' + index + '.jpg', type: 'photo', sourceUrl: 'https://x.com/u/status/1',
    })))
  assert(overLimit.length === types.MAX_FEED_MEDIA, '读盘时也按 4 条截断，实得 ' + overLimit.length)
}

/* ── 15.6 API 投影：media 恒为数组（客户端可以直接 map） ── */
{
  const apiMod = await load('api')
  const base = {
    id: 'p_media', createdAt: NOW, topics: ['tech'], title: 't', body: 'b',
    sources: [], dueAt: 0, dueLabel: '', likes: 0, comments: [], runId: 'r_1', promptHash: 'h',
  }
  const withMedia = apiMod.toPostView({
    ...base,
    media: [{ url: 'https://pbs.twimg.com/media/a.jpg', type: 'photo', width: 1200, height: 675, sourceUrl: 'https://x.com/u/status/1' }],
  }, NOW)
  assert(Array.isArray(withMedia.media) && withMedia.media.length === 1,
    'toPostView 带上 media（客户端直接 map 渲染），实得 ' + JSON.stringify(withMedia.media))
  assert(withMedia.media[0].url.includes('pbs.twimg.com'), '媒体 URL 原样出现在 API 出参里')

  /*
   * 没有媒体的帖子，出参里必须是**空数组**而不是 undefined。
   *
   * 客户端拿它直接 .map()；一个可能缺失的字段会让每一处消费点都要先判空，
   * 而漏判的表现是「这条动态白屏」—— 那种错误不会在类型检查里露出来
   * （客户端是独立构建的）。
   */
  const noMediaView = apiMod.toPostView(base, NOW)
  assert(Array.isArray(noMediaView.media) && noMediaView.media.length === 0,
    '没有媒体的帖子，出参 media 是空数组（不是 undefined），实得 ' + JSON.stringify(noMediaView.media))

  // days 分组里也要带上（客户端渲染走的是 days[].items[]，不是单条接口）。
  const days = apiMod.toDayViews([{ ...base, media: withMedia.media }], NOW)
  assert(days.length === 1 && days[0].items[0].media.length === 1,
    'days 分组里的每条也带 media（列表渲染走这条路）')
}


/* ── 15.7 全链路：真 writer + 带图推文 → posts.json 里真有媒体 URL ── */
{
  const StoreClass = await load('store').then(mod => mod.FeedStore)
  const homeM = resolve(ROOT, '_tmp', 'smoke-feed-home-m')
  try { rmSync(homeM, { recursive: true, force: true }) } catch { /* 忽略 */ }
  mkdirSync(homeM, { recursive: true })
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeM
  const storeM = new StoreClass()
  await storeM.load()
  process.env.DSH_HOME = prevHome

  await storeM.setConfig({ prompt: '盯住 AI', model: 'default', cron: '0 12,18 * * *', xHandles: ['picuser'] })

  /*
   * X 抓取注入：主通道返回一条**带图 + 带视频**的推文。
   *
   * 这条推文会经 appendTweetsAsSources 追加到已验活清单末尾 ——
   * 假 web 给出 4 条来源，其中付费墙那条被判 blocked 丢弃，所以 X 那条的下标是 3。
   */
  const mediaTweet = tweetEntry({
    id: '7001',
    handle: 'picuser',
    // permalink 显式给：tweetEntry 的默认值是 elonmusk，而这条的作者是 picuser
    // （URL 与 author 不一致时，媒体归属与 sourceUrl 会指向别人的推文）。
    permalink: '/picuser/status/7001',
    createdAt: 'Wed Oct 21 15:38:10 +0000 2026',
    media: [
      {
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/media/HVQqxxFWMAA8mDb.jpg',
        original_info: { width: 1200, height: 675 },
      },
      {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/7/img/t.jpg',
        video_info: {
          duration_millis: 45000,
          variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/p.m3u8' },
            { content_type: 'video/mp4', url: 'https://video.twimg.com/640.mp4', bitrate: 832000 },
            { content_type: 'video/mp4', url: 'https://video.twimg.com/1280.mp4', bitrate: 2176000 },
          ],
        },
      },
    ],
  })
  const xFetch = async (url) => {
    const u = String(url)
    if (u.includes('syndication.twitter.com/srv/timeline-profile')) {
      return { status: 200, ok: true, text: async () => pageOf([mediaTweet]) }
    }
    return { status: 500, ok: false, text: async () => '' }
  }

  const llm = fakeLlm({
    output: JSON.stringify({ posts: [{
      title: '这条推文带了图和视频',
      body: '一条带媒体的推文被写成了动态，用来验证媒体 URL 真的落进了 posts.json。',
      // X 线索现在排在清单**最前面**（见 appendTweetsAsSources 的说明），
      // 所以这条推文是 [0] 而不是原来的 [3]。
      sourceIds: [0],
      topics: ['tech'],
      dueInHours: 0,
    }] }),
  })
  const realWriter = writerMod.createRealWriter({
    getService: fakeServices(),
    llm,
    web: fakeWeb(),
    now: () => NOW,
  })
  const runner = trigger.createFeedRunner({
    store: storeM,
    writer: realWriter,
    now: () => NOW,
    xDeps: { fetchImpl: xFetch, sleep: async () => {}, now: () => NOW },
  })
  await runner.requestRun('manual')
  await runner.idle()

  const posts = await storeM.listPosts()
  assert(posts.length === 1, '全链路产出 1 条动态，实得 ' + posts.length)
  const post = posts[0]
  assert(Array.isArray(post.media) && post.media.length === 2,
    'posts.json 里真有 2 个媒体项（用户要的「把链接放上来」），实得 '
      + (Array.isArray(post.media) ? post.media.length : String(post.media)))
  assert(post.media[0].url === 'https://pbs.twimg.com/media/HVQqxxFWMAA8mDb.jpg',
    '图片是**真实直链**，实得 ' + post.media[0].url)
  assert(post.media[1].videoUrl === 'https://video.twimg.com/1280.mp4',
    '视频是**可播放的 mp4 直链**（不是封面、不是 HLS），实得 ' + post.media[1].videoUrl)
  assert(post.media[1].sourceUrl === 'https://x.com/picuser/status/7001',
    '每个媒体都带 sourceUrl（能跳回原推核对），实得 ' + post.media[1].sourceUrl)

  /*
   * 重启后媒体还在：normalizePost 漏洗 media 的后果是「刷新一下图就没了」，
   * 而那种现象看起来像「同步没抓到图」，根本查不到根因。
   */
  process.env.DSH_HOME = homeM
  const reloaded = new StoreClass()
  await reloaded.load()
  process.env.DSH_HOME = prevHome
  const reloadedPost = (await reloaded.listPosts())[0]
  assert(reloadedPost.media !== undefined && reloadedPost.media.length === 2,
    '重启后媒体还在（normalizePost 没有漏字段），实得 '
      + (reloadedPost.media === undefined ? 'undefined' : reloadedPost.media.length))
  assert(reloadedPost.media[1].videoUrl === 'https://video.twimg.com/1280.mp4',
    '重启后视频直链还在，实得 ' + reloadedPost.media[1].videoUrl)

  /*
   * 原文也要能扛过重启（2026-10-28 用户报障连锁发现）。
   *
   * normalizePost 此前没有投影 originalText / originalLang —— 表现为「刚生成
   * 那一轮能看到『原文』块，重启 DSH 后原文就没了」，而 posts.json 里字段明明在。
   * 原文与媒体是同一条链路，任何一格漏洗都会让用户以为「抓取没抓到」。
   */
  assert(typeof reloadedPost.originalText === 'string' && reloadedPost.originalText !== '',
    '重启后原文还在（normalizePost 必须投影 originalText），实得 '
      + (typeof reloadedPost.originalText === 'string' ? '有' : 'undefined'))
  assert(typeof reloadedPost.originalLang === 'string' && reloadedPost.originalLang !== '',
    '重启后原文语言还在（客户端据此决定显示「原文」还是「原文（译）」）')

  // 落到 API：客户端拿到的就是这条帖子（列表走 days[]）。
  const apiMod = await load('api')
  const view = apiMod.toPostView(reloadedPost, NOW)
  assert(view.media.length === 2 && view.media[1].videoUrl !== undefined,
    'API 出参里媒体完整（客户端可直接渲染 video 标签）')

  /*
   * 反向断言：**没有媒体时不能凭空造一个**。
   * 模型引用的是网页来源（sourceIds [0]），那条推文的媒体不该出现在这条动态上。
   */
  const plainWriter = writerMod.createRealWriter({
    getService: fakeServices(),
    llm: fakeLlm({
      output: JSON.stringify({ posts: [{
        title: '这条只引用了网页',
        body: '引用的是一条网页来源，所以这条动态不该带任何媒体。',
        sourceIds: [0],
        topics: ['tech'],
        dueInHours: 0,
      }] }),
    }),
    web: fakeWeb(),
    now: () => NOW,
  })
  const storePlain = new StoreClass()
  process.env.DSH_HOME = homeM
  await storePlain.load()
  process.env.DSH_HOME = prevHome
  const plainRunner = trigger.createFeedRunner({
    store: storePlain,
    writer: plainWriter,
    now: () => NOW + 1000,
    xDeps: { fetchImpl: xFetch, sleep: async () => {}, now: () => NOW + 1000 },
  })
  await plainRunner.requestRun('manual')
  await plainRunner.idle()
  const plainPosts = (await storePlain.listPosts()).filter(item => item.title === '这条只引用了网页')
  assert(plainPosts.length === 1, '第二条动态也产出了，实得 ' + plainPosts.length)
  assert(plainPosts[0].media === undefined,
    '引用网页来源的动态**没有** media 字段（不凭空造媒体），实得 ' + JSON.stringify(plainPosts[0].media))
}

/* 清理本次冒烟创建的临时数据（成功时才清；失败时保留现场便于查）。 */
if (process.exitCode !== 1) {
  for (const dir of [HOME_A, HOME_B,
    resolve(ROOT, '_tmp', 'smoke-feed-home-c'),
    resolve(ROOT, '_tmp', 'smoke-feed-home-d'),
    resolve(ROOT, '_tmp', 'smoke-feed-home-e'),
    resolve(ROOT, '_tmp', 'smoke-feed-home-f'),
    resolve(ROOT, '_tmp', 'smoke-feed-home-g'),
    OUT_DIR]) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

console.log('')
if (process.exitCode === 1) console.error('SMOKE-FEED FAILED')
else console.log('SMOKE-FEED OK')
