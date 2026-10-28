/**
 * dsh-chat-plus — 个人动态（Feed）· 排序与筛选（host 半身，纯函数）。
 *
 * 两步走（2026-10-27 按用户要求简化）：
 *
 *  **第一步：按天分组**（今天 / 昨天 / 更早），组间顺序固定；
 *  **第二步：组内按 createdAt 倒序**（新的在上）。
 *
 * ── 组内排序为什么只剩「时间倒序」────────────────────────────────
 *
 * 用户原话：「**按时间排序即可**」。
 *
 * 这里曾经是三级优先级（过期沉底 → 未读优先 → 截止临近 → 时间倒序），并在真实
 * 数据上暴露了一个明确缺陷：第 ③ 级用 `dueAt` 绝对值、无截止用 `Infinity`，
 * 于是「有没有截止」比「时间新旧」更强 —— 任何带截止的帖子都无条件压过没有
 * 截止的，哪怕它更旧。用户看到的就是「刚生成的新动态排到了旧内容下面」，
 * 违反「新动态出现在列表顶部」。
 *
 * 中间试过插一级「新鲜度分桶」来修，但用户的要求更简单彻底：**只按时间**。
 * 这也是更好的默认：列表是**动态流**，用户的第一需求永远是「最新发生了什么」；
 * 过期 / 未读 / 截止都是「我觉得你该先看哪个」的猜测，把猜测混进排序键，
 * 任何权重给错都会让新内容沉底 —— 那是最难被容忍的一类错误。
 *
 * 需要「先看过期/未读」的场景走**筛选胶囊**（filter=due / unread / exp），
 * 而不是靠排序把它们顶上来：筛选是用户明确表达的意图，排序是我们替他猜。
 *
 * ── 为什么「按天分组」必须保留且独立 ────────────────────────────────
 *
 * 直接全局时间倒序本身不会穿插，但分天是**界面需求**（要插「今天 / 昨天」
 * 日期标题）。两者分开实现：分组决定「这条属于哪一天」，排序决定「同一天内
 * 谁在前」。冒烟里有一条断言钉死「组间顺序单调、绝不回头」。
 *
 * 全部是**纯函数**：不读时钟、不碰磁盘，`now` 一律由调用方传入。所以
 * 排序正确性可以在冒烟里用任意时间点直接对拍，不受运行时刻影响。
 *
 * @module
 */

import type { FeedPost } from './types.ts'

/** 三个天分组（顺序即展示顺序，§6.1）。 */
export type FeedDayKey = 'today' | 'yesterday' | 'older'

/** 天分组的中文标签。 */
export const FEED_DAY_LABELS: Record<FeedDayKey, string> = {
  today: '今天',
  yesterday: '昨天',
  older: '更早',
}

/** 天分组的展示顺序（渲染与断言共用同一份，避免两处写死两个顺序）。 */
export const FEED_DAY_ORDER: FeedDayKey[] = ['today', 'yesterday', 'older']

/** 筛选胶囊（原型：全部 / 未读 / 临近截止 / 已过期）。 */
export type FeedFilterKey = 'all' | 'unread' | 'due' | 'exp'

/** 一天的长度（毫秒）——只用于「更早」的粗粒度展示，不参与天判定。 */
const DAY_MS = 24 * 60 * 60 * 1000

/* ─────────────────────────── 状态判定 ─────────────────────────── */

/**
 * 是否已过期（§6.1 的 isExpired）。
 *
 * `dueAt === 0` 是「无截止」哨兵（§3），**不是** 1970 年过期。这里把它
 * 排在第一个判断里，是为了让「忘了判 0」这类错误只可能出现在本函数一处。
 */
export function isExpired(post: FeedPost, now: number): boolean {
  return post.dueAt > 0 && post.dueAt < now
}

/**
 * 是否未读（§6.3：`!readAt && !isExpired`）。
 *
 * 过期帖一律算「已读」——它们沉底且不该继续制造「你有 N 条未读」的压力。
 */
export function isUnread(post: FeedPost, now: number): boolean {
  if (isExpired(post, now)) return false
  return post.readAt === undefined || post.readAt === 0
}

/** 是否已软删（列表一律过滤掉）。 */
export function isDeleted(post: FeedPost): boolean {
  return post.deletedAt !== undefined && post.deletedAt > 0
}

/** 本地日历日的起点（毫秒）——天分组按**本地**日算，不按 UTC。 */
function startOfLocalDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 一条动态属于哪个天分组。
 *
 * 按**本地日历日**判定（不是「距今 24 小时」）：凌晨 2 点发的帖子，到当晚
 * 23:59 仍是「今天」，而不是被算成「距今 21 小时所以还是今天、25 小时就变昨天」。
 * 日历日才符合用户对「今天 / 昨天」的直觉。
 */
export function dayKeyOf(createdAt: number, now: number): FeedDayKey {
  const today = startOfLocalDay(now)
  const yesterday = today - DAY_MS
  // 未来时间（时钟回拨 / 生成时用了服务器的未来时间）一律算今天，不倒推到「更早」。
  if (createdAt >= today) return 'today'
  if (createdAt >= yesterday) return 'yesterday'
  return 'older'
}

/* ─────────────────────────── 组内排序 ─────────────────────────── */

/**
 * **已废弃**：旧的组内优先级键，2026-10-27 起不再参与排序。
 *
 * 保留导出而不是删掉，理由有两条：
 *  1. 它是 `src/host.ts` 的 re-export 面的一部分（另一个人的作用域，本模块不该
 *     单方面改）；直接删会让那条 re-export 变成 undefined —— esbuild 静默放行，
 *     构建绿，调用时才炸 "is not a function"，报错点离根因很远。
 *  2. 它的返回值仍然是一个有意义的**描述**（这条过期了 / 未读了 / 什么时候到期），
 *     外部若有人拿它做别的事（比如渲染角标），不该被这次排序口径变更带走。
 *
 * ⚠ **不要再把它接回 comparePosts**。优先级排序在真实数据上出过一个明确的
 * 缺陷：第 ③ 级用 dueAt 绝对值、无截止用 Infinity，于是「有没有截止」被提升成
 * 比「时间新旧」更强的因素 —— 任何带截止的帖子都无条件压过没有截止的，
 * 哪怕它更旧。用户在列表上看到的就是「刚生成的新动态排到了旧内容下面」。
 *
 * 中间试过插一级「新鲜度分桶」来修，最终用户的要求更简单直接：
 * 「按时间排序即可」。所以排序键只剩 createdAt 倒序。
 *
 * @deprecated 仅用于描述，不要参与排序。
 */
export function priorityKey(post: FeedPost, now: number): [number, number, number] {
  return [
    isExpired(post, now) ? 2 : 1,                              // ① 过期沉底（仅描述）
    isUnread(post, now) ? 0 : 1,                               // ② 未读优先（仅描述）
    post.dueAt > 0 && !isExpired(post, now) ? post.dueAt : Number.POSITIVE_INFINITY, // ③ 截止（仅描述）
  ]
}

/**
 * 组内比较器：**唯一排序键是 createdAt 倒序**（新的在上）。
 *
 * 用户原话：「按时间排序即可」。这条口径是刻意的、也是最稳的：
 *
 *  - **不看过期 / 未读 / 截止**：那三个都是「我觉得你应该先看哪个」的猜测，
 *    而列表是**动态流**，用户的第一需求永远是「最新发生了什么」。把猜测混进
 *    排序键，任何一个权重给错都会让新内容沉底 —— 而这是最难被用户容忍的错误。
 *  - **未被这几个字段干扰也是一条可断言的属性**：冒烟可以构造 dueAt / readAt
 *    全混在一起的输入，断言输出严格按 createdAt 倒序。旧实现做不到这一点。
 *
 * 同一毫秒生成的多条用 id 兜底：它们的 createdAt 完全相同，此时顺序至少要是
 * **确定的**（Array.prototype.sort 在 V8 里稳定，但稳定只保证「相同的保持输入
 * 顺序」，而输入顺序来自磁盘，不可依赖）。
 */
export function comparePosts(a: FeedPost, b: FeedPost, _now: number): number {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/* ─────────────────────────── 排序主入口 ─────────────────────────── */

/** 一个天分组。 */
export interface FeedDayGroup {
  key: FeedDayKey
  label: string
  posts: FeedPost[]
}

/**
 * 先分天、再组内排序（§6.1 的完整实现）。
 *
 * @param posts - 任意顺序的帖子（已删除的会被过滤掉）。
 * @param now - 当前时刻（毫秒），由调用方传入以保持纯函数。
 * @returns 按「今天 → 昨天 → 更早」排列、每组内部已排好序的分组数组；
 *          空组也会返回（客户端据此决定是否显示该组标题）。
 */
export function groupFeedPosts(posts: readonly FeedPost[], now: number): FeedDayGroup[] {
  const buckets: Record<FeedDayKey, FeedPost[]> = { today: [], yesterday: [], older: [] }
  for (const post of posts) {
    if (isDeleted(post)) continue
    buckets[dayKeyOf(post.createdAt, now)].push(post)
  }
  return FEED_DAY_ORDER.map(key => ({
    key,
    label: FEED_DAY_LABELS[key],
    posts: buckets[key].slice().sort((a, b) => comparePosts(a, b, now)),
  }))
}

/**
 * 扁平化排序结果（服务端下发给客户端的顺序，§8「客户端不再排」）。
 *
 * 刻意**返回扁平数组**而不是分组：客户端要的是「一条动态 + 它上面该不该插
 * 一个日期标题」。把 day 挂在每条帖子上（route 层补 `day` 字段）后，客户端
 * 「当前条的 day 与上一条不同就插标题」即可，比让前端复述分组结构更省事，
 * 也不给前端留出「自己再排一次」的余地。
 */
export function sortFeedPosts(posts: readonly FeedPost[], now: number): FeedPost[] {
  return groupFeedPosts(posts, now).flatMap(group => group.posts)
}

/* ─────────────────────────── 筛选 ─────────────────────────── */

/** 频道匹配（左栏）：'all' 聚合全部、'mine' 只含贴目标的那部分、其余按 topic。 */
export function matchTopic(post: FeedPost, topic: string | undefined): boolean {
  if (topic === undefined || topic === '' || topic === 'all') return true
  return post.topics.includes(topic)
}

/** 筛选胶囊匹配。 */
export function matchFilter(post: FeedPost, filter: FeedFilterKey | undefined, now: number): boolean {
  if (filter === undefined || filter === 'all') return true
  if (filter === 'unread') return isUnread(post, now)
  if (filter === 'due') return post.dueAt > 0 && !isExpired(post, now)
  if (filter === 'exp') return isExpired(post, now)
  return true
}

/**
 * 搜索命中（原型 hit() 的同款口径：标题 + 正文 + 来源标题/域名 + 标签）。
 *
 * 大小写不敏感；空查询视为命中（调用方据此跳过）。
 */
export function postMatchesQuery(post: FeedPost, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const haystack = [
    post.title,
    post.body,
    post.dueLabel,
    ...post.topics,
    ...post.sources.map(s => `${s.title} ${s.domain} ${s.url}`),
  ].join(' ').toLowerCase()
  return haystack.includes(q)
}

/** 列表查询条件（GET /posts 的 query string 解出来的那一份）。 */
export interface FeedListQuery {
  topic?: string
  filter?: FeedFilterKey
  q?: string
  /** 只返回 createdAt >= since（毫秒）的帖子。 */
  since?: number
  /** 返回条数上限（<=0 或 undefined 表示不限）。 */
  limit?: number
}

/**
 * 列表主入口：过滤（删除 / 频道 / 胶囊 / 搜索 / since）→ 分天排序 → 截断。
 *
 * ⚠ 截断在排序**之后**：先截断再排序会让「今天最新那条」因为磁盘顺序靠后
 * 而被 limit 切掉，表现为列表里少一条但没有任何报错。
 */
export function queryFeedPosts(
  posts: readonly FeedPost[],
  query: FeedListQuery,
  now: number,
): FeedPost[] {
  const filtered = posts.filter(post => {
    if (isDeleted(post)) return false
    if (!matchTopic(post, query.topic)) return false
    if (!matchFilter(post, query.filter, now)) return false
    if (query.since !== undefined && query.since > 0 && post.createdAt < query.since) return false
    if (!postMatchesQuery(post, query.q ?? '')) return false
    return true
  })
  const sorted = sortFeedPosts(filtered, now)
  const limit = query.limit
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return sorted
  return sorted.slice(0, Math.floor(limit))
}

/**
 * 给每条帖子补一个 day 字段（客户端据此插入日期标题）。
 *
 * 放在这里而不是 route 层：这是一条**纯投影**，冒烟可以直接对拍，
 * 也能保证 API 返回的 day 与排序用的分组永远是同一份判定。
 */
export function attachDayKeys<T extends FeedPost>(posts: readonly T[], now: number): (T & { day: FeedDayKey })[] {
  return posts.map(post => ({ ...post, day: dayKeyOf(post.createdAt, now) }))
}

/** 导出给冒烟对拍。 */
export const __test = { startOfLocalDay, DAY_MS }
