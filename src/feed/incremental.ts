/**
 * dsh-chat-plus — 个人动态（Feed）· 增量时间窗 + 确定性兜底去重（host 半身，纯函数）。
 *
 * 用户原话：「只更新上次时间节点到当前时间节点，并且不要重复」。
 *
 * ── 本文件只做两件事，而且都必须是「确定性、不依赖模型」的那部分 ──────
 *
 *  **A. 增量时间窗**：把「上次成功生成的时点」当水位线，只关心水位线到现在
 *     这段时间里的新进展。水位线读不到时不能崩，回落到 7 天前并标注
 *     fallback=true（用户能看出这轮为什么翻了这么久的历史）。
 *
 *  **B. 兜底去重**：落盘前的最后一道拦截。
 *
 * ── 一条重要的分工原则（2026-10-27 用户明确要求）────────────────────
 *
 * 用户说「让模型自己去判断去重」。所以「语义重复」这件事 —— 同一件事换个
 * 说法、同一批资料的另一个角度 —— **交给模型判**（见 writer.ts 的
 * formatKnownPostsBlock：把已有内容的标题 + 主题 + 来源摆给模型，并要求它
 * 在输出里用 skipped[] 显式回报自己的判断）。理由是字符串相似度算不准语义：
 * 「欧盟 AI 法案」与「美国出口管制」都是 AI 监管，却不该互相当重复；而
 * 「模型权重层算不算技术出口」与「开源加条款：披露、阈值、迁移限制」用
 * Jaccard 算出来的分数很低，人一眼就知道是同一件事。
 *
 * 本文件因此**只留两条零歧义的硬规则**（不是主力，是模型失误时的兜底）：
 *
 *   1. 标题归一化后**字符级完全相同** → 丢（模型把同一条又写了一遍）；
 *   2. 一条帖子的**来源 URL 集合与已发内容完全相同**（非空）→ 丢
 *      （同一批资料一字不差地又写了一遍）。
 *
 * 阈值型相似度（Jaccard / URL 重合率）**刻意不做** —— 那是「看起来能防重复、
 * 实际会误杀」的典型：误杀之后用户看到的是「更新了但没内容」，而原因无处可查。
 *
 * ── 一个反直觉的取舍：publishedAt 缺失时**保留** ───────────────────
 *
 * 检索 provider 给的 publishedAt 实测经常缺失（有的干脆不给，有的只给日期）。
 * 如果「早于 sinceAt 就丢」一刀切，缺时间的候选会被连带丢掉 —— 表现为
 * 「这轮检索到了内容却一条来源都没有」，而根因是字段缺失，从现象上完全看不出。
 * 所以判据是三态：明确早于水位线 → 丢（计入 droppedStale）；明确在窗口内 → 留；
 * **缺时间 → 留，但打上 timeUnknown 标记**，由提示词如实告诉模型
 * 「这条发布时间未知」，而不是假装它是新的。
 *
 * @module
 */

import type { FeedRun } from './types.ts'

/* ═══════════════════════ A. 增量时间窗 ═══════════════════════ */

/**
 * 水位线读不到时的兜底窗口：7 天。
 *
 * 为什么不是 24 小时：首次运行（或 state.json 被清）时没有水位线，用 24 小时
 * 窗口会在「上次生成是三天前」这种常见场景下一条都检索不到，表现为
 * 「更新了但没内容」—— 而用户其实只是隔了几天才点一次。
 */
export const FEED_SINCE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000

/** 水位线是怎么定下来的（写进 stats，排查时能回答「这轮为什么从这么早算起」）。 */
export type SinceSource = 'last-ok-run' | 'last-run-at' | 'fallback'

/** 本轮实际使用的时间窗。 */
export interface SinceWindow {
  /** 时间窗起点（毫秒，含）。 */
  sinceAt: number
  /** true = 不是从真实水位线读到的（首次运行 / state 被清 / 时钟回拨）。 */
  fallback: boolean
  /** 水位线是怎么定下来的。 */
  source: SinceSource
}

/** 正整数化（0 / NaN / 负数 / 非数字一律 0）。 */
function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 从轮次历史里取「上次**成功**生成的时点」。
 *
 * 为什么不能只用 state.lastRunAt：那个字段是 upsertRun 写的 startedAt，
 * **失败的一轮也会写**。于是「上一轮写作用了 3 秒就挂了」→ 下一轮的时间窗只有
 * 3 秒 → 什么都检索不到。所以优先找最近一条 status=ok 的轮次的 finishedAt
 * （用结束时刻而不是开始时刻，还能顺手避免与上一轮的内容重叠）。
 *
 * @returns 毫秒时间戳；没有成功轮次时返回 0。
 */
export function lastOkRunAtOf(
  runs: ReadonlyArray<Pick<FeedRun, 'status' | 'finishedAt' | 'startedAt'>> | undefined,
): number {
  if (!Array.isArray(runs)) return 0
  // 磁盘顺序通常是「最新在前」（store.upsertRun 用 unshift），但不能假设 ——
  // 手改 state.json 就能打乱它。这里自己按 finishedAt/startedAt 取最大。
  let best = 0
  for (const run of runs) {
    if (run === null || typeof run !== 'object') continue
    if (run.status !== 'ok') continue
    const at = positiveNumber(run.finishedAt) || positiveNumber(run.startedAt)
    if (at > best) best = at
  }
  return best
}

/**
 * 定出本轮的时间窗起点。
 *
 * 优先级：上次成功生成时点 → state.lastRunAt → 7 天前（fallback）。
 *
 * 两条防御（都不会抛，只会回落到兜底并标注）：
 *  - 水位线**晚于现在**：时钟回拨，或者手改过 state.json。用它会把窗口算成空的
 *    （sinceAt > now），于是每一轮都检索不到任何东西。回落。
 *  - 水位线是 0 / NaN / 负数：没有可用水位线。回落。
 */
export function resolveSinceWindow(input: {
  now: number
  lastOkRunAt?: number
  lastRunAt?: number
}): SinceWindow {
  const now = positiveNumber(input.now) || Date.now()
  const floor = now - FEED_SINCE_FALLBACK_MS
  const ok = positiveNumber(input.lastOkRunAt)
  if (ok > 0 && ok <= now) return { sinceAt: ok, fallback: false, source: 'last-ok-run' }
  const last = positiveNumber(input.lastRunAt)
  if (last > 0 && last <= now) return { sinceAt: last, fallback: false, source: 'last-run-at' }
  return { sinceAt: floor, fallback: true, source: 'fallback' }
}

/** 2026年10月27日（提示词里的自然表达）。 */
export function formatDayCn(at: number): string {
  const date = new Date(at)
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日'
}

/** 2026年10月27日 20:00（时间窗两端用这个，时分很重要）。 */
export function formatMomentCn(at: number): string {
  const date = new Date(at)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return formatDayCn(at) + ' ' + hh + ':' + mm
}

/**
 * 2026-10-27（**本地**日期）。
 *
 * 不能用 toISOString()：它按 UTC 算，在东八区的 00:00-08:00 之间会退到前一天，
 * 于是检索 query 里的日期限定把最新内容切在窗口外。
 */
export function isoDateOf(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

/** 两个时刻是否落在同一个本地日历日（跨天时检索才需要加日期限定）。 */
export function sameLocalDay(a: number, b: number): boolean {
  const left = new Date(a)
  const right = new Date(b)
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

/**
 * 解析 provider 给的 publishedAt（字符串或毫秒数）。
 *
 * 解析不出来一律返回 0（= 时间未知），**绝不抛**：provider 的字段格式实测五花八门
 * （ISO 8601 / 带时区 / 只有日期 / 偶尔是毫秒数），一个坏字段不该让整轮写作挂掉。
 */
export function parsePublishedAt(value: unknown): number {
  if (typeof value === 'number') return positiveNumber(value)
  if (typeof value !== 'string') return 0
  const text = value.trim()
  if (text === '') return 0
  const ms = Date.parse(text)
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** 带时间信息的候选（检索结果 / X 推文都长这样）。 */
export interface TimedCandidate {
  publishedAt?: string | number
  /** 已解析的毫秒时间（有就优先用，避免重复解析）。 */
  publishedAtMs?: number
  /** 出参标记：缺 publishedAt，时间是未知的。 */
  timeUnknown?: boolean
}

/** 时间窗过滤的结果。 */
export interface SinceFilterResult<T> {
  /** 保留下来的候选（缺时间的已打上 timeUnknown）。 */
  kept: T[]
  /** 因为明确早于 sinceAt 而丢弃的条数。 */
  droppedStale: number
  /** 保留但时间未知的条数。 */
  unknown: number
}

/**
 * 按时间窗过滤候选来源（缺时间的保留并标注，见文件头的取舍说明）。
 *
 * @param candidates - 候选（检索结果，可能带 publishedAt）。
 * @param sinceAt - 时间窗起点；<= 0 表示不启用窗口（全部保留）。
 */
export function applySinceWindow<T extends TimedCandidate>(
  candidates: readonly T[],
  sinceAt: number,
): SinceFilterResult<T> {
  const floor = positiveNumber(sinceAt)
  if (floor <= 0) return { kept: [...candidates], droppedStale: 0, unknown: 0 }

  const kept: T[] = []
  let droppedStale = 0
  let unknown = 0
  for (const candidate of candidates) {
    const ms = positiveNumber(candidate.publishedAtMs) || parsePublishedAt(candidate.publishedAt)
    if (ms <= 0) {
      // 缺时间：保留 + 标注（一刀切丢弃会让「provider 不给时间」变成「本轮没来源」）。
      unknown += 1
      kept.push({ ...candidate, timeUnknown: true })
      continue
    }
    if (ms < floor) { droppedStale += 1; continue }
    kept.push({ ...candidate, publishedAtMs: ms, timeUnknown: false })
  }
  return { kept, droppedStale, unknown }
}

/**
 * 组装「本轮只写这段时间」的提示词段落（放进 system，见 writer.ts）。
 *
 * 为什么时间范围要写进 **system** 而标题清单在 user 里：system 是模型的长期
 * 约束、user 是这一轮的具体任务 + 数据。时间窗属于「本次任务的边界」，放 system
 * 更不容易被后面那一长串来源清单与历史标题冲淡。
 */
export function formatWindowInstruction(sinceAt: number, now: number): string {
  const floor = positiveNumber(sinceAt) || positiveNumber(now) || Date.now()
  const to = positiveNumber(now) || Date.now()
  const sameDay = sameLocalDay(floor, to)
  return [
    '本轮的时间范围：从 ' + formatMomentCn(floor) + ' 到现在（' + formatMomentCn(to) + '）'
      + (sameDay ? '，即今天这一段时间' : '') + '。',
    '只写这个范围内新发生的进展。范围之外的事情（哪怕来源清单里有）只能当背景，不要写成今天的新闻。',
    '如果来源里没有这段时间内的新内容，宁可少写或不写，也不要拿旧内容凑数。',
    /*
     * ⚠ **例外：用户主动关注的账号**（2026-10-27 实测修正）。
     *
     * 上面三条对「新闻检索」是对的，但对「关注的人最近说了什么」是错的 ——
     * 实测：抓到的 21 条关注账号推文**全部落在时间窗之外**（最晚的也是前一天），
     * 模型严格执行「范围外只能当背景」，于是把每一条都判成「不构成本轮可写的
     * 进展」，最后交了 0 条 + skipped。用户点开看到的是一页空白。
     *
     * 用户要的是「这几个账号的动态」，不是「这几个账号在时间窗内的新闻」。
     * 关注账号的发言本身就是内容 —— 只要标明它是什么时候说的，就不是「拿旧内容
     * 凑数」。所以给一个明确例外，避免模型在两条规则之间选错。
     */
    '例外：来源清单里以「@账号名 · 昵称」开头、域名是 x.com 的条目，是**用户主动关注的'
      + '账号本人的发言**。这类内容不受上面的时间范围限制 —— 无论它发于何时，都可以写，'
      + '只要在正文里如实说明它是什么时候说的（例如「他在 10 月 26 日提到…」）。'
      + '这类条目是本轮的主要内容，请优先写它们。',
  ].join('\n')
}

/* ═══════════════════════ B. 兜底去重 ═══════════════════════ */

/**
 * 标题比较时要剥掉的「噪声」字符：空白、中英文标点、常见装饰符号。
 *
 * 归一化的目的不是美化，而是让「同一个标题的两种写法」在比较时相等 ——
 * 模型重写同一件事时最爱干的就是换标点、加空格、把全角改成半角。
 * NFKC 先把全角字母/数字折成半角（全角 AI 两字 → 半角 AI），再统一小写。
 */
const TITLE_NOISE = /[\s\u3000，。；、！？,.;!?:：\u201c\u201d\u2018\u2019"'()（）【】\[\]《》〈〉<>…—\-–~～/\\|·•+*=_#@&^%]+/g

/** 标题归一化（去空白/标点/大小写 + 全角折半角）。 */
export function normalizeTitle(title: unknown): string {
  if (typeof title !== 'string') return ''
  return title.normalize('NFKC').replace(TITLE_NOISE, '').toLowerCase()
}

/**
 * URL 判重键（去 fragment、去末尾斜杠、host 小写）。
 *
 * 与 writer.ts 的 mergeSearchResults 共用同一份实现 —— 两处各写一份必然分叉，
 * 而分叉的表现是「检索阶段认为两条不同、去重阶段认为相同」，很难查。
 * 解析失败时返回原串（宁可判重失败，也不要把所有坏 URL 当成同一个）。
 */
export function urlKeyOf(url: unknown): string {
  if (typeof url !== 'string') return ''
  const text = url.trim()
  if (text === '') return ''
  try {
    const parsed = new URL(text)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.replace(/\/+$/, '')
    return host + path + parsed.search
  } catch {
    return text
  }
}

/** 给模型看的「已经写过」的条数上限（任务要求从 12 扩到 30）。 */
export const MAX_KNOWN_POSTS_FOR_PROMPT = 30

/** 去重丢弃的原因分类（写进 run.stats 的 dropReasons）。 */
export type DedupeReason = 'dup-title' | 'dup-source'

/** 参与去重的帖子最小形状（FeedPost 与 CleanDraft 都满足）。 */
export interface DedupePostLike {
  title: string
  sources?: ReadonlyArray<{ url?: string } | null | undefined> | undefined
  /** 有值时会按「最近的 N 条」筛池（降序）。 */
  createdAt?: number
}

/** 一条被丢弃的候选。 */
export interface DedupeDropped<T> {
  candidate: T
  reason: DedupeReason
  /** 命中原因的人话说明（写日志与 run 里给人看）。 */
  detail: string
}

/** 去重统计（直接并进 run.stats）。 */
export interface DedupeCounts {
  /** 参与判定的候选总数。 */
  total: number
  /** 保留数。 */
  kept: number
  /** 标题完全相同丢了几条。 */
  'dup-title': number
  /** 来源 URL 集合完全相同丢了几条。 */
  'dup-source': number
}

/** 去重结果。 */
export interface DedupeResult<T> {
  kept: T[]
  dropped: DedupeDropped<T>[]
  counts: DedupeCounts
}

/**
 * 已有帖池的默认上限（任务点名的 50 条）。
 *
 * 为什么不比全部历史：越老的标题越可能是「同一个长期话题的又一次进展」，
 * 一律拦下会把正常更新也挡掉；最近 50 条（一天两三条 ≈ 三周产出）正好覆盖
 * 「模型短期内会重复的那批内容」。
 */
export const MAX_DEDUPE_EXISTING = 50

/** 取一条帖子的 URL 键集合（空 URL 过滤掉）。 */
function urlKeysOf(post: DedupePostLike): string[] {
  const out: string[] = []
  for (const source of post.sources ?? []) {
    const key = urlKeyOf(source?.url)
    if (key !== '') out.push(key)
  }
  return out
}

/** URL 集合的比较键（排序后拼起来，用于「一字不差」判定）。 */
function urlSetKey(keys: readonly string[]): string {
  return [...new Set(keys)].sort().join('\u0001')
}

/**
 * **落盘前的兜底去重**（确定性代码，零歧义）。
 *
 * 只有两条规则，其余全交给模型（见文件头的分工原则）：
 *
 *  1. 标题归一化后字符级完全相同 → 丢（dup-title）；
 *  2. 来源 URL 集合与「已有内容」或「本轮已保留的帖子」完全相同（且非空）
 *     → 丢（dup-source）。
 *
 * 三个刻意的细节：
 *  - **同批内部也互相判重**：保留一条后会把它并进索引，所以同一轮里模型产两条
 *    一模一样的标题时只留第一条（否则「不重复」在两轮之间成立、轮内又破了）。
 *  - **sources 为空不算 dup-source**：空集合的 every() 恒为真，不显式排除的话
 *    「无来源的降级帖」会被全部丢掉。
 *  - **标题优先记 dup-title**：一条帖可能同时命中标题与来源，理由记更具体的那个，
 *    统计上更能反映模型的真实问题。
 *
 * @param candidates - 本轮待落盘的帖子（已过 sanitizeDraft）。
 * @param existing - 已有帖子（调用方传未删除的，带 createdAt 时按倒序取最近 N 条）。
 * @param options - 池大小覆盖（测试用）。
 */
export function dedupePosts<T extends DedupePostLike>(
  candidates: readonly T[],
  existing: readonly DedupePostLike[],
  options: { existingLimit?: number } = {},
): DedupeResult<T> {
  const limit = Math.max(1, Math.floor(positiveNumber(options.existingLimit) || MAX_DEDUPE_EXISTING))

  // 最近的 N 条：全部带 createdAt 时按倒序取，否则按调用方给的顺序取前 N 条
  // （顺序由调用方负责 —— 这一层不读磁盘，也就无法自己去排序）。
  const pool = [...existing]
  if (pool.length > 0 && pool.every(item => typeof item.createdAt === 'number')) {
    pool.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  }

  const titleSet = new Set<string>()
  const usedUrlSets = new Set<string>()
  const usedUrls = new Set<string>()
  for (const post of pool.slice(0, limit)) {
    const normalized = normalizeTitle(post.title)
    if (normalized !== '') titleSet.add(normalized)
    const keys = urlKeysOf(post)
    if (keys.length > 0) { usedUrlSets.add(urlSetKey(keys)); for (const key of keys) usedUrls.add(key) }
  }

  const kept: T[] = []
  const dropped: DedupeDropped<T>[] = []
  const counts: DedupeCounts = { total: candidates.length, kept: 0, 'dup-title': 0, 'dup-source': 0 }

  for (const candidate of candidates) {
    const normalized = normalizeTitle(candidate.title)

    // ① 归一化后完全相同（同轮内已保留的也在这个集合里）。
    if (normalized !== '' && titleSet.has(normalized)) {
      dropped.push({
        candidate,
        reason: 'dup-title',
        detail: '标题与已发内容完全相同：' + candidate.title,
      })
      counts['dup-title'] += 1
      continue
    }

    /*
     * ② 来源 URL **全部**都已出现过（非空）→ 同一批资料反复写。
     *
     * 判据刻意用「全部出现过」而不是「集合完全相同」：前者更贴用户语义
     * （同一批律所网站被反复使用），而且部分重复、只要有一条新 URL 就保留 ——
     * 那正是「同一话题的新进展」，用户要的就是它。
     *
     * 不按「重合率 ≥ 50%」这类阈值判定：用户明确要求「让模型自己去判断去重」，
     * 阈值型规则会把「同一批资料的新进展」误杀掉，而误杀的表现是
     * 「更新了但没内容」—— 原因无处可查。
     */
    const keys = urlKeysOf(candidate)
    const urlKey = keys.length > 0 ? urlSetKey(keys) : ''
    if (keys.length > 0 && keys.every(key => usedUrls.has(key))) {
      dropped.push({
        candidate,
        reason: 'dup-source',
        detail: '引用的 ' + keys.length + ' 条来源全部/完全相同地已在已发内容里出现过',
      })
      counts['dup-source'] += 1
      continue
    }

    kept.push(candidate)
    counts.kept += 1
    // 同批内部互相去重：留下来的也要进索引。
    if (normalized !== '') titleSet.add(normalized)
    if (urlKey !== '') { usedUrlSets.add(urlKey); for (const key of keys) usedUrls.add(key) }
  }

  return { kept, dropped, counts }
}

/** 导出给冒烟对拍。 */
export const __test = {
  TITLE_NOISE,
  urlKeysOf,
  urlSetKey,
}
