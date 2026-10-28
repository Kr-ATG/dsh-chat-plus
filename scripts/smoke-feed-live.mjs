#!/usr/bin/env node
/**
 * dsh-chat-plus — 动态页 X 抓取的**真网络**冒烟（可选，不打进默认 smoke）。
 *
 * ── 为什么不进默认 smoke ──────────────────────────────────────────────
 * 它会真的请求 X 的 syndication 端点。那条通道有实测确认的限流（见
 * docs/2026-10-27-x-feed-availability.md §3.1：连续 10 个账号 → 前 5 成功、
 * 后 5 全 429；等待 60 秒后仍全 429；本机 2026-10-27 复测主通道直接
 * HTTP=429 + 20 字节 "Rate limit exceeded"）。放进 npm run smoke 就等于
 * 每次跑测试都烧一次额度，还可能把开发机 IP 打进长冷却。
 *
 * ── 什么时候跑 ────────────────────────────────────────────────────────
 *   · 改了 src/feed/sources.ts 的解析 / 排序 / 去重逻辑；
 *   · 怀疑 syndication 通道改版（parse-fail 突然变多）；
 *   · 用户报「动态页里没有 X 的内容」。
 *
 * 用法：
 *   node scripts/smoke-feed-live.mjs                 # 默认 2 个账号（推荐）
 *   node scripts/smoke-feed-live.mjs elonmusk        # 指定账号
 *   node scripts/smoke-feed-live.mjs --max 5         # 最多 5 个（硬上限，调不高）
 *
 * 退出码：0 = 通过（含「全部被限流」这一如实结果）；1 = 真的有问题。
 *
 * ── 判据（哪些算 FAIL，哪些只是如实情况）──────────────────────────────
 *  · 429 → **不是 FAIL**。那是真实的平台限流，脚本照实报告并验证「限流被
 *    正确识别 + 记了 cooldown」——这恰恰是 sources.ts 最该测对的一条；
 *  · 解析层判错（应该解析出来却 parse-fail）、排序没重排、字段缺失、
 *    limited 边界破了 → **FAIL**；
 *  · 网络完全不通（DNS/TLS）→ FAIL（那是环境坏了，不是限流）。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/*
 * ⚠ Windows 上 import 绝对路径必须走 file:// URL。
 * 直接 import('D:\\AI\\...\\sources.ts') 会报
 *   Only URLs with a scheme in: file, data, and node are supported
 *   ... Received protocol 'd:'
 * —— 这条只在 Windows 出现，Linux/macOS 上是合法的绝对路径。
 */
const fileUrl = path => pathToFileURL(path).href

/*
 * 直接 import 源码（不另抄一份逻辑）。
 *
 * 为什么不照抄：第一版验证脚本把 normalize / 排序逻辑抄进脚本里跑，结果
 * 验证的是**副本**而不是源码 —— 源码里改了、脚本还绿着。这类"测副本"的
 * 假阳性在本次任务里真实发生过（见 api.ts 的 requestAt envelope 注释）。
 *
 * 运行方式靠 Node 22 的类型剥离（--experimental-strip-types）。
 */
let src
try {
  src = await import(fileUrl(resolve(ROOT, 'src/feed/sources.ts')))
} catch (error) {
  console.error('[smoke-feed-live] 无法加载 src/feed/sources.ts：' + error.message)
  console.error('  需要 Node 22.6+ 并带 --experimental-strip-types。')
  process.exit(1)
}

/* ───────────────────────── 参数 ───────────────────────── */

const argv = process.argv.slice(2)
let handles = argv.filter(arg => !arg.startsWith('--'))
// --max N：单轮账号数上限。**钳死在 X_MAX_HANDLES_PER_ROUND**，不做成可调项 ——
// 那个 5 是实测出来的安全上限，调高就是把开发机 IP 打进长冷却。
const maxArg = argv.indexOf('--max')
if (maxArg >= 0) {
  const requested = Number.parseInt(argv[maxArg + 1] ?? '', 10)
  const cap = src.X_MAX_HANDLES_PER_ROUND
  if (Number.isInteger(requested) && requested > 0) {
    handles = (handles.length > 0 ? handles : ['elonmusk', 'sama', 'OpenAI']).slice(0, Math.min(requested, cap))
  }
}
if (handles.length === 0) handles = ['elonmusk', 'sama']

let failed = 0
const pass = msg => { console.log('  ok    ' + msg) }
const fail = msg => { console.log('  FAIL  ' + msg); failed += 1 }
const info = msg => { console.log('        ' + msg) }

console.log('═══ 动态页 X 抓取 · 真网络冒烟 ═══')
console.log('账号 ' + handles.join(', ') + '（单轮上限 ' + src.X_MAX_HANDLES_PER_ROUND + '）')
console.log('间隔 ' + src.X_HANDLE_GAP_MS + 'ms · 429 冷却 ' + Math.round(src.X_COOLDOWN_MS / 60000) + ' 分钟'
  + ' · 单账号最多 ' + src.X_MAX_ATTEMPTS + ' 次（第 2 次前 sleep ' + src.X_RETRY_DELAY_MS + 'ms）')
console.log('')

/* ══════ ① 单账号：真实抓取 + 结局识别 ══════ */
console.log('[1] 单账号抓取（' + handles[0] + '）')
const singleStart = Date.now()
const single = await src.fetchWithRetry(handles[0])
const singleMs = Date.now() - singleStart
info('outcome=' + single.outcome + ' · ' + single.tweets.length + ' 条 · ' + singleMs + 'ms · ' + single.message)

const KNOWN = new Set(['ok', 'empty', 'rate-limit', 'timeout', 'network', 'http-error', 'parse-fail', 'cooldown'])
if (!KNOWN.has(single.outcome)) {
  fail('outcome 必须是 8 种机器可读值之一，实得「' + single.outcome + '」')
} else {
  pass('结局可识别（' + single.outcome + '），不是笼统的 failed')
}

if (single.outcome === 'rate-limit') {
  /*
   * 限流 = 真实结果，不是脚本失败。要验的是「限流有没有被**认出来**」：
   * 认错成 parse-fail / network 的后果是「下次照样立刻重试」→ 越重试封得越久。
   */
  pass('429 被正确识别为 rate-limit（不是 parse-fail / network）')
  if (single.tweets.length === 0) pass('限流时不返回任何推文（不伪造内容）')
  else fail('限流时不该有推文，实得 ' + single.tweets.length + ' 条')
} else if (single.outcome === 'ok') {
  const tweets = single.tweets
  const newest = tweets[0]
  pass('抓到 ' + tweets.length + ' 条真实推文')
  info('最新一条 @' + newest.handle + ' · ' + new Date(newest.createdAt).toISOString())
  info('正文前 70 字：' + newest.text.replace(/\s+/g, ' ').slice(0, 70))
  info('链接：' + newest.url)

  /* 字段完整性：少任何一个，卡片就是坏的（点不开 / 显示 1970 年）。 */
  const missing = tweets.filter(t => !t.id || !t.createdAt || !t.text || !t.url || !t.handle)
  if (missing.length === 0) pass('全部 ' + tweets.length + ' 条字段完整（id / createdAt / text / url / author）')
  else fail(missing.length + ' 条字段不全')

  if (newest.handle.toLowerCase() === handles[0].replace(/^@/, '').toLowerCase()) pass('author 与请求账号一致')
  else fail('author 对不上：请求 ' + handles[0] + '，实得 ' + newest.handle)

  if (/^https:\/\/x\.com\//.test(newest.url)) pass('url 是可跳转的 x.com 链接')
  else fail('url 不是 x.com 链接：' + newest.url)

  /* ══════ ② 混合顺序 → 按 createdAt 重排 ══════
   * 实测（报告 §2）：syndication 返回的 entries 是**混合顺序** —— elonmusk
   * 前五条 id 分别是 2026-10-21 / 2022-04-28 / 2024-07-13…，entries[0]
   * 完全可能是几年前的老推文。所以解析层必须自己按时间倒序重排。 */
  console.log('[2] 混合顺序 → 按 createdAt 重排')
  let inversions = 0
  for (let i = 1; i < tweets.length; i++) if (tweets[i].createdAt > tweets[i - 1].createdAt) inversions += 1
  if (inversions === 0) pass(tweets.length + ' 条已按时间倒序（逆序对 0）')
  else fail('有 ' + inversions + ' 处逆序 —— 应重排却没重排')

  if (tweets.length > 1) {
    const spanDays = (tweets[0].createdAt - tweets[tweets.length - 1].createdAt) / 86400000
    info('时间跨度 ' + spanDays.toFixed(0) + ' 天（跨度大 = 原始顺序确实是混的）')
  }

  /* ══════ ③ 去重闸门 ══════ */
  console.log('[3] 去重闸门（已见 id 集合，不靠 id 大小）')
  const firstPass = src.selectNewTweets(tweets, {})
  if (firstPass.length === tweets.length) pass('空 seen 时全算新（' + firstPass.length + ' 条）')
  else fail('空 seen 时应全算新，实得 ' + firstPass.length + '/' + tweets.length)

  const seen = src.mergeSeenTweets({}, tweets, Date.now())
  const secondPass = src.selectNewTweets(tweets, seen)
  if (secondPass.length === 0) pass('同一批再跑全部去重（0 条新）')
  else fail('重复抓取仍有 ' + secondPass.length + ' 条被判新（会重复上架）')

  /* ══════ ④ limited 法律边界 ══════ */
  console.log('[4] 推文 → 来源（limited 不复制正文）')
  const source = src.tweetToSource(newest)
  if (source.access === 'limited') pass('access = limited（显式给，漏了会退化成 open）')
  else fail('access 必须是 limited，实得 ' + source.access)
  if (source.snippet === undefined) pass('不带 snippet（不复制正文）')
  else fail('limited 来源不该带 snippet')
  if (typeof source.excerpt === 'string' && source.excerpt.length <= 200) pass('excerpt ≤200 字符（话题线索）')
  else fail('excerpt 缺失或超长')
  if (source.domain === 'x.com') pass('domain = x.com')
  else fail('domain 应为 x.com，实得 ' + source.domain)
} else {
  // timeout / network / http-error / parse-fail / empty
  const envFailures = new Set(['timeout', 'network', 'http-error'])
  if (envFailures.has(single.outcome)) {
    fail('抓取失败于环境层（' + single.outcome + '）—— 检查网络与代理，这不是限流')
  } else if (single.outcome === 'parse-fail') {
    fail('parse-fail：解析不出条目 —— syndication 通道可能已改版，需要更新 parseTweetsFromNextData')
  } else {
    pass('结局为 ' + single.outcome + '（账号无内容 / 已在冷却），属正常情况')
  }
}

/* ══════ ⑤ 一轮多账号：串行间隔 + 429 立即中止 ══════
 *
 * ⚠ 上一轮**限流时反而更该跑这一段**：「遇 429 立即停 + 记 cooldown」正是
 * 限流场景下唯一有意义的行为，只在成功时测等于漏掉最重要的一条。
 *
 * 代价可控：runXSyncRound 内部遇 429 **立即 break**，所以即使传 2 个账号，
 * 实际只发 1 次请求（不是 2 次）——这本身就验证了「立即停」。而且此时 IP 已
 * 在冷却期，多撞一次的边际代价远低于漏测这条的风险。
 *
 * 只有环境层失败（network / timeout / parse-fail）才跳过：那种情况下
 * 「429 立即停」根本无从谈起。 */
const canRunRound = handles.length > 1 && (single.outcome === 'ok' || single.outcome === 'rate-limit')
if (canRunRound) {
  console.log('[5] 一轮多账号：间隔 + 遇 429 立即中止')
  const roundStart = Date.now()
  const round = await src.runXSyncRound(handles, {}, {}, (state, result) => {
    console.log('        ' + result.handle + ' → ' + result.outcome + '（新 ' + result.fresh.length + ' 条）')
  })
  const roundMs = Date.now() - roundStart
  info('合计 ' + roundMs + 'ms · ' + round.summary)

  if (round.results.length <= src.X_MAX_HANDLES_PER_ROUND) pass('单轮账号数 ≤ ' + src.X_MAX_HANDLES_PER_ROUND)
  else fail('单轮账号数超上限：' + round.results.length)

  if (round.results.length > 1) {
    const floor = (round.results.length - 1) * src.X_HANDLE_GAP_MS
    if (roundMs >= floor) pass('账号间隔生效（' + roundMs + 'ms ≥ ' + floor + 'ms）')
    else fail('账号之间没有拉开间隔（' + roundMs + 'ms < ' + floor + 'ms）→ 会被限流')
  }

  const rateLimited = round.results.filter(r => r.outcome === 'rate-limit')
  if (rateLimited.length > 0) {
    info('本轮 ' + rateLimited.length + ' 个账号被限流（真实情况，如实记录）')
    if (round.aborted || round.results.length === 1) pass('遇 429 立即停本轮剩余账号')
    else fail('遇到 429 却没有中止剩余账号（aborted=' + round.aborted + '）')
    if (round.cooldownUntil > Date.now()) pass('记了 cooldownUntil（' + Math.round(src.X_COOLDOWN_MS / 60000) + ' 分钟后重试）')
    else fail('429 后没有记 cooldownUntil → 下一轮会立刻再撞')
  } else {
    pass('本轮无 429')
  }

  /* ══════ ⑥ 冷却期账号必须被跳过 ══════ */
  console.log('[6] 冷却期账号被跳过')
  const nowTs = Date.now()
  const coolingState = {
    [handles[0].toLowerCase()]: {
      handle: handles[0].toLowerCase(), lastFetchedAt: 0, cooldownUntil: nowTs + src.X_COOLDOWN_MS,
      consecutiveFailures: 1, seenTweetIds: {}, lastOutcome: 'rate-limit',
    },
  }
  const picked = src.pickHandlesForRound(handles, coolingState, nowTs)
  if (!picked.picked.includes(handles[0].toLowerCase())) pass('冷却中的账号被排除出本轮')
  else fail('冷却中的账号仍被选进本轮 → 白白撞限流')
  if (picked.cooling.includes(handles[0].toLowerCase())) pass('冷却账号记进 cooling 清单（界面能显示原因）')
  else fail('冷却账号没记进 cooling')
}

/* ══════ ⑦ 主通道被限流时的兜底：用备用通道的真实推文验解析链路 ══════
 *
 * 为什么必须有这一段：主通道（syndication/srv/timeline-profile）一旦限流，
 * 上面 [1]–[4] 全部跳过 —— 等于「改了 parseTweetsFromNextData 也没人验」。
 * 而解析层恰恰是最该被真数据验证的一段（重排 / 去重 / limited 边界）。
 *
 * 备用通道：cdn.syndication.twimg.com/tweet-result?id=<id>
 *   —— 与主通道不同域名，实测限流状态下仍 200 + 真实 JSON（报告 §2.2）。
 *   字段与主通道同源同形，喂给 sources.ts 的**真实函数**是有效验证。
 *
 * 只在主通道没拿到推文（rate-limit / empty / 失败）时才跑：主通道有真数据时
 * 上面已经用真数据验过同一批判据了，不必重复请求。 */
if (single.outcome !== 'ok') {
  console.log('[7] 备用通道真实数据 → 解析链路（主通道限流时的替代验证）')
  // 报告 §2.1 记录的真实推文 ID
  const REAL_IDS = ['2112931457786081428']
  const rows = []
  for (const id of REAL_IDS) {
    try {
      const res = await fetch('https://cdn.syndication.twimg.com/tweet-result?id=' + id + '&lang=en&token=a',
        { headers: { accept: 'application/json' } })
      if (!res.ok) continue
      const json = await res.json()
      if (json !== null && typeof json.id_str === 'string') rows.push(json)
    } catch {
      // 备用通道也不通：下面的断言会报 FAIL，如实反映「两条路都验证不了」
    }
  }

  if (rows.length === 0) {
    fail('备用通道也拿不到真实推文 —— 本轮无法验证解析链路（网络或该通道也不可用）')
  } else {
    pass('备用通道拿到 ' + rows.length + ' 条真实推文')
    const sample = rows[0]
    const T0 = src.parseTweetTime(sample.created_at)
    const day = 86400000

    /*
     * 用同一条真实推文造多个不同时间的条目来验重排。
     *
     * 为什么可以这样造：只拿到 1 条真实推文时，没法天然得到「混合顺序」；
     * 但重排逻辑只看 created_at，用真实字段 + 真实时间戳偏移构造出的条目
     * 与真实抓取到的条目**同形**（同一账号连续推文本来就是这种形态）。
     * 造的是数据形态，不是编造结论 —— 判据（逆序对为 0）仍然是被真函数算出来的。
     */
    const entryOf = (offsetDays, idSuffix) => ({
      type: 'tweet',
      content: {
        tweet: {
          id_str: sample.id_str + idSuffix,
          created_at: new Date(T0 - offsetDays * day).toUTCString(),
          full_text: sample.text ?? '',
          permalink: '/' + sample.user.screen_name + '/status/' + sample.id_str + idSuffix,
          favorite_count: sample.favorite_count ?? 0,
          user: {
            screen_name: sample.user.screen_name,
            name: sample.user.name,
            profile_image_url_https: sample.user.profile_image_url_https ?? '',
          },
        },
      },
    })
    // 喂入顺序故意打乱：中 / 最新 / 最旧 / 次新
    const mixed = [entryOf(10, '01'), entryOf(0, '02'), entryOf(30, '03'), entryOf(2, '04')]
    const parsed = src.parseTweetsFromNextData(
      JSON.stringify({ props: { pageProps: { timeline: { entries: mixed } } } }),
    )

    if (parsed === null || parsed.length !== 4) {
      fail('解析出 ' + (parsed === null ? 'null' : parsed.length) + ' 条，期望 4 条')
    } else {
      let inv = 0
      for (let i = 1; i < parsed.length; i++) if (parsed[i].createdAt > parsed[i - 1].createdAt) inv += 1
      if (inv === 0) pass('按 createdAt 重排生效（乱序喂入 → 倒序输出，逆序对 0）')
      else fail('重排没生效：' + inv + ' 处逆序')

      if (parsed[0].createdAt > parsed[parsed.length - 1].createdAt) pass('首条是最新的（entries[0] 不是最新）')
      else fail('首条不是最新 → 解析层没重排')

      /* 去重：部分已见时只能丢掉见过的那一条 */
      const partial = src.mergeSeenTweets({}, [parsed[0]], Date.now())
      const remaining = src.selectNewTweets(parsed, partial)
      if (remaining.length === parsed.length - 1) pass('部分去重正确（只丢见过的那条，其余仍算新）')
      else fail('部分去重错：应剩 ' + (parsed.length - 1) + ' 条，实得 ' + remaining.length)

      /* limited 边界 */
      const source = src.tweetToSource(parsed[0])
      if (source.access === 'limited' && source.snippet === undefined) pass('limited 边界：access=limited 且不带 snippet')
      else fail('limited 边界破了（access=' + source.access + '）')
    }
  }
}

console.log('')
if (failed === 0) {
  console.log('[smoke-feed-live] PASS — ' + (single.outcome === 'rate-limit'
    ? '被限流，但限流识别与冷却记账正确（这是真实结果，不是失败）'
    : '真实抓取链路正常'))
} else {
  console.log('[smoke-feed-live] FAIL — ' + failed + ' 条断言未通过')
  process.exitCode = 1
}
/*
 * ⚠ 结尾用 process.exitCode 而不是 process.exit()：Node 22 的
 * --experimental-strip-types 在 Windows 下，带 pending 的 fetch/timer 时
 * 调 process.exit() 会命中 libuv 的
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
 * 退出码仍然正确，但会多打一行崩溃信息，看起来像脚本挂了。
 */
