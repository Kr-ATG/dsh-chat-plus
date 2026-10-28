/**
 * dsh-chat-plus — 个人动态（Feed）· 本地状态存储（host 半身）。
 *
 * 数据根：`${DSH_HOME:-~/.dsh}/feed/dsh-chat-plus/`
 *
 *   posts.json   全部动态（软删过的不删记录，只带 deletedAt）
 *   state.json   配置 + 单飞闸门 + 轮次历史 + X 同步状态
 *
 * 落盘范式照抄 `src/mail/store.ts`：
 *
 *  1. **唯一临时名 + rename**：Windows 上固定 `${file}.tmp` 会让并发写互相
 *     截断（这条坑在记忆引擎里已经吃过一次，同一手法复用）；
 *  2. **读不出来就当空**：缓存/状态损坏绝不让界面打不开 —— 但这个度只给
 *     「可重建的数据」（帖子被截断就退回空列表，用户能理解）；
 *  3. **内存态权威 + 立即刷盘**：闸门与配置是低频写，但**必须**在写操作返回前
 *     真正落盘 —— 单飞锁跨进程重启有效的前提就是「第二个进程读到的是磁盘上
 *     那条 running」，异步补写会让重启后的第二次点击跑出第二轮。
 *
 * ── 为什么闸门和帖子分成两个文件 ────────────────────────────────────
 *
 * 帖子会越来越长（每天几条，一年上千条），而闸门每 60 秒续租一次。放同一个
 * 文件等于每 60 秒把整个帖子库重写一遍。分开之后续租只写几百字节，帖子库
 * 只在真正增删改时写 —— 这也是 §5.2「执行期间每 60s 续租」能便宜实现的前提。
 *
 * @module
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DEFAULT_FEED_CONFIG,
  FEED_SCHEMA_VERSION,
  IDLE_GATE,
  MAX_FEED_MEDIA,
  newCommentId,
  type FeedComment,
  type FeedConfig,
  type FeedMedia,
  type FeedPost,
  type FeedSource,
  type FeedPostsFile,
  type FeedRun,
  type FeedRunStatus,
  type FeedStateFile,
  type XSyncState,
} from './types.ts'

/** 动态数据根（与其它工作台并列，互不冲突）。 */
export function feedDataDir(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'feed', 'dsh-chat-plus')
}

/**
 * 轮次历史最多保留多少条。
 *
 * 50 的原因：验收要看「最近一轮是谁触发的」、排查要看「今早那次为什么 skipped」。
 * 一天两轮 × 25 天足够覆盖；再多只是让 state.json 的读写变慢，
 * 而这些记录的观测价值衰减极快。
 */
const MAX_RUNS = 50

/** 原子写文本：唯一临时名 → rename（与 src/mail/store.ts 同一手法）。 */
export async function atomicWrite(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, file)
}

/** 读 JSON（不存在 / 损坏都返回 fallback，绝不抛）。 */
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as T : fallback
  } catch {
    return fallback
  }
}

/* ───────────────────────── 归一化（脏数据兜底） ───────────────────────── */

/** 取字符串（非字符串一律空串）。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 取有限数（非有限一律 fallback）。 */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 取字符串数组（过滤非字符串与空串）。 */
function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item !== '')
}

/**
 * 归一化一条帖子的媒体数组（读盘时用，见 normalizePost）。
 *
 * 为什么必须逐字段洗：posts.json 是可手改的纯文本，而媒体数组直接进
 * `<img src>` / `<video src>`。一条 `javascript:` 的 url 或一个不存在的
 * type 在界面上不是「显示不出来」，而是**走到没有分支的渲染路径**。
 *
 * 与 trigger.ts 的 sanitizeDraft 同一套判据（写侧洗一遍、读侧再洗一遍）：
 * 写侧防我们自己写错，读侧防磁盘被人改过。
 */
function normalizeMedia(raw: unknown): FeedMedia[] {
  if (!Array.isArray(raw)) return []
  const out: FeedMedia[] = []
  for (const value of raw) {
    if (out.length >= MAX_FEED_MEDIA) break
    if (typeof value !== 'object' || value === null) continue
    const m = value as Record<string, unknown>
    const url = str(m['url'])
    if (url === '' || /^https?:\/\//i.test(url) === false) continue
    const sourceUrl = str(m['sourceUrl'])
    if (sourceUrl === '' || /^https?:\/\//i.test(sourceUrl) === false) continue
    const rawType = m['type']
    const type: FeedMedia['type'] = rawType === 'video' || rawType === 'animated_gif' ? rawType : 'photo'
    const videoUrl = str(m['videoUrl'])
    const width = num(m['width'], 0)
    const height = num(m['height'], 0)
    out.push({
      url,
      type,
      // 图片不该带 videoUrl（脏数据里混进来时丢掉，否则界面会去渲染一个不存在的视频）。
      ...(type !== 'photo' && videoUrl !== '' && /^https?:\/\//i.test(videoUrl) ? { videoUrl } : {}),
      ...(width > 0 ? { width } : {}),
      ...(height > 0 ? { height } : {}),
      sourceUrl,
    })
  }
  return out
}

/**
 * 把磁盘上的一条帖子归一化成合法的 FeedPost。
 *
 * 为什么要逐字段洗：posts.json 是纯文本、可以被用户手改，也可能是上一版插件
 * 写的。少洗一个字段的症状往往很晚才暴露（例如 topics 不是数组 → 客户端
 * `post.topics.includes` 抛错 → 整个列表白屏，而路由一切 200）。
 */
function normalizePost(raw: unknown): FeedPost | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = str(r['id'])
  if (id === '') return null
  const sources: FeedSource[] = Array.isArray(r['sources'])
    ? r['sources'].flatMap((value): FeedSource[] => {
        if (typeof value !== 'object' || value === null) return []
        const s = value as Record<string, unknown>
        const url = str(s['url'])
        if (url === '') return []
        const access: FeedSource['access'] = s['access'] === 'limited' ? 'limited' : 'open'
        // §7.3 的硬边界：limited 来源**不许**带 snippet（正文摘要），只许带 excerpt
        // （话题线索，≤200 字符）。这里在**读盘时**再兜一次 —— 写侧已经拦过，但
        // 磁盘文件是可手改的，而这一条是法律边界不是显示问题。
        const snippet = access === 'open' && typeof s['snippet'] === 'string' ? s['snippet'] : undefined
        const excerpt = access === 'limited' && typeof s['excerpt'] === 'string'
          ? s['excerpt'].slice(0, 200)
          : undefined
        return [{
          url,
          domain: str(s['domain']),
          title: str(s['title']),
          access,
          ...(snippet === undefined ? {} : { snippet }),
          ...(excerpt === undefined ? {} : { excerpt }),
          fetchedAt: num(s['fetchedAt'], 0),
          ...(typeof s['httpStatus'] === 'number' ? { httpStatus: s['httpStatus'] } : {}),
        }]
      })
    : []
  /*
   * 「一条动态只有一个原文」（2026-10-28 用户报障）。
   *
   * 用户截图原话：「一条动态怎么可能有两个原文，而且两个原文的动态都是不一样的」。
   * 历史数据里存在模型把两条推文揉进一条动态、同时引用两个 x.com 来源的记录 ——
   * 界面「原文来源 · 2 个」列出两条互不相干的推文。写入侧已经改成只留第一条
   * （见 writer.ts validateModelPosts），这里在读盘时做同一件事，让**老数据**
   * 也立刻恢复正常，不必等用户重新生成。网页来源不受影响。
   */
  let keptTweetSource = false
  const uniqueSources = sources.filter((source) => {
    const isTweet = source.domain === 'x.com' || source.domain === 'twitter.com'
    if (!isTweet) return true
    if (keptTweetSource) return false
    keptTweetSource = true
    return true
  })
  const comments = Array.isArray(r['comments'])
    ? r['comments'].flatMap(value => {
        if (typeof value !== 'object' || value === null) return []
        const c = value as Record<string, unknown>
        const text = str(c['text'])
        if (text === '') return []
        return [{
          id: str(c['id']) || newCommentId(),
          by: c['by'] === 'agent' ? 'agent' : 'user',
          text,
          at: num(c['at'], 0),
        } satisfies FeedComment]
      })
    : []
  const post: FeedPost = {
    id,
    createdAt: num(r['createdAt'], 0),
    topics: strArray(r['topics']),
    title: str(r['title']),
    body: str(r['body']),
    sources: uniqueSources,
    dueAt: num(r['dueAt'], 0),
    dueLabel: str(r['dueLabel']),
    likes: num(r['likes'], 0),
    comments,
    runId: str(r['runId']),
    promptHash: str(r['promptHash']),
  }
  if (r['liked'] === true) post.liked = true
  if (typeof r['readAt'] === 'number' && r['readAt'] > 0) post.readAt = r['readAt']
  if (typeof r['deletedAt'] === 'number' && r['deletedAt'] > 0) post.deletedAt = r['deletedAt']
  if (typeof r['xFetchedAt'] === 'number' && r['xFetchedAt'] > 0) post.xFetchedAt = r['xFetchedAt']
  // 媒体（图片 / 视频）：空数组不挂（与写入侧同口径，见 trigger.ts 的落盘处）。
  const media = normalizeMedia(r['media'])
  if (media.length > 0) post.media = media
  /*
   * 原文（2026-10-28）：X 推文的原文与语言。
   *
   * ⚠ 这两格此前**没有**在 normalizePost 里投影 —— 表现是「刚生成那一轮能
   * 看到『原文』块，重启 DSH 后就没了」，而 posts.json 里字段明明还在。
   * 洗字段的原则是「读盘要与写入侧同口径」，写入侧带什么读盘就得留什么。
   */
  if (typeof r['originalText'] === 'string' && r['originalText'].trim() !== '') {
    post.originalText = r['originalText'].trim().slice(0, 4000)
  }
  if (typeof r['originalLang'] === 'string' && r['originalLang'].trim() !== '') {
    post.originalLang = r['originalLang'].trim().slice(0, 16)
  }
  return post
}

/** 归一化配置（缺字段用默认，多余字段丢弃）。 */
export function normalizeConfig(raw: unknown): FeedConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const prompt = str(r['prompt'])
  const model = str(r['model'])
  const cron = str(r['cron'])
  const handles = Array.isArray(r['xHandles'])
    ? r['xHandles']
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim().replace(/^@/, '').toLowerCase())
        .filter(item => item !== '')
    : DEFAULT_FEED_CONFIG.xHandles
  return {
    prompt: prompt === '' ? DEFAULT_FEED_CONFIG.prompt : prompt,
    model: model === '' ? DEFAULT_FEED_CONFIG.model : model,
    cron: cron === '' ? DEFAULT_FEED_CONFIG.cron : cron,
    // 去重：同一个账号写两遍不该被当成两个账号（那样每轮会白抓一次并加速限流）。
    xHandles: [...new Set(handles)],
  }
}

/** 归一化闸门（缺字段用空闲值）。 */
function normalizeGate(raw: unknown): FeedStateFile['gate'] {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const status = r['status'] === 'running' ? 'running' : 'idle'
  const runId = str(r['runId'])
  const queuedTrigger: FeedStateFile['gate']['queuedTrigger'] =
    r['queuedTrigger'] === 'schedule' || r['queuedTrigger'] === 'prompt' || r['queuedTrigger'] === 'manual'
      ? r['queuedTrigger']
      : null
  return {
    status,
    runId: runId === '' ? null : runId,
    leaseUntil: num(r['leaseUntil'], 0),
    queued: r['queued'] === true,
    queuedTrigger,
    blockedCount: num(r['blockedCount'], 0),
  }
}

/** 归一化 X 同步状态（每次读盘都洗，避免脏值把整个同步弄停）。 */
function normalizeXSync(raw: unknown): Record<string, XSyncState> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, XSyncState> = {}
  for (const [handle, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    const seenRaw = v['seenTweetIds']
    const seen: Record<string, number> = {}
    if (typeof seenRaw === 'object' && seenRaw !== null) {
      for (const [id, at] of Object.entries(seenRaw as Record<string, unknown>)) {
        if (typeof id === 'string' && id !== '') seen[id] = num(at, 0)
      }
    }
    const state: XSyncState = {
      handle: str(v['handle']) || handle,
      lastFetchedAt: num(v['lastFetchedAt'], 0),
      cooldownUntil: num(v['cooldownUntil'], 0),
      consecutiveFailures: num(v['consecutiveFailures'], 0),
      seenTweetIds: seen,
    }
    const lastTweetId = str(v['lastTweetId'])
    if (lastTweetId !== '') state.lastTweetId = lastTweetId
    if (typeof v['lastOutcome'] === 'string') state.lastOutcome = v['lastOutcome'] as XSyncState['lastOutcome']
    const lastErrorText = str(v['lastErrorText'])
    if (lastErrorText !== '') state.lastErrorText = lastErrorText
    out[handle] = state
  }
  return out
}

/** 归一化轮次记录。 */
function normalizeRun(raw: unknown): FeedRun | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = str(r['id'])
  if (id === '') return null
  const trigger = r['trigger'] === 'schedule' || r['trigger'] === 'prompt' || r['trigger'] === 'manual'
    ? r['trigger']
    : 'manual'
  /*
   * 四态都认（skipped 是 2026-10-27 新增的「跑完了但没有新内容」）。
   *
   * ⚠ **历史数据里的 'failed' 不做迁移**：那些记录当时确实被判成失败，
   *   保留原样才能看出「那时的判定口径」，改写成 skipped 等于篡改历史。
   */
  const status: FeedRunStatus = r['status'] === 'ok' || r['status'] === 'failed' || r['status'] === 'skipped'
    ? r['status']
    : 'running'
  const run: FeedRun = {
    id,
    trigger,
    modelUsed: str(r['modelUsed']),
    startedAt: num(r['startedAt'], 0),
    status,
  }
  if (typeof r['finishedAt'] === 'number') run.finishedAt = r['finishedAt']
  const blockedBy = str(r['blockedBy'])
  if (blockedBy !== '') run.blockedBy = blockedBy
  const error = str(r['error'])
  if (error !== '') run.error = error
  if (typeof r['stats'] === 'object' && r['stats'] !== null) {
    const s = r['stats'] as Record<string, unknown>
    run.stats = {
      searched: num(s['searched'], 0),
      fetched: num(s['fetched'], 0),
      dropped: num(s['dropped'], 0),
      postsCreated: num(s['postsCreated'], 0),
      tokensIn: num(s['tokensIn'], 0),
      tokensOut: num(s['tokensOut'], 0),
      /*
       * 过程计数（2026-10-27 新增）必须一起洗出来，否则**重启后被静默丢掉**：
       * 用户点更新 → 看到「模型 alymagpie/... 写了 2400 字符」→ 刷新页面/重启
       * → 那几个数全空，看起来像"那轮根本没跑"。归一化漏字段的后果比
       * 字段本身缺失严重得多（它让历史记录自相矛盾）。
       */
      ...(typeof s['queries'] === 'number' ? { queries: num(s['queries'], 0) } : {}),
      ...(typeof s['sourcesOpen'] === 'number' ? { sourcesOpen: num(s['sourcesOpen'], 0) } : {}),
      ...(typeof s['sourcesLimited'] === 'number' ? { sourcesLimited: num(s['sourcesLimited'], 0) } : {}),
      ...(typeof s['sourcesBlocked'] === 'number' ? { sourcesBlocked: num(s['sourcesBlocked'], 0) } : {}),
      ...(typeof s['rawChars'] === 'number' ? { rawChars: num(s['rawChars'], 0) } : {}),
      ...(typeof s['modelUsed'] === 'string' && s['modelUsed'] !== '' ? { modelUsed: s['modelUsed'] } : {}),
      ...(typeof s['modelLabel'] === 'string' && s['modelLabel'] !== '' ? { modelLabel: s['modelLabel'] } : {}),
      ...(typeof s['modelResolution'] === 'string' && s['modelResolution'] !== '' ? { modelResolution: s['modelResolution'] } : {}),
      ...(typeof s['degraded'] === 'string' && s['degraded'] !== '' ? { degraded: s['degraded'] } : {}),
      /*
       * 「增量 + 去重」的过程计数（2026-10-27 新增）同样必须洗出来。
       *
       * 漏一个字段的后果见上面那段注释：用户点更新 → 看到「时间窗从 3 小时前
       * 算起、模型跳过 3 条重复」→ 刷新页面 → 这几个数全空，看起来像那轮根本没
       * 做去重。历史记录自相矛盾比字段缺失严重得多。
       */
      ...(typeof s['sinceAt'] === 'number' && s['sinceAt'] > 0 ? { sinceAt: num(s['sinceAt'], 0) } : {}),
      ...(s['sinceFallback'] === true ? { sinceFallback: true } : {}),
      ...(typeof s['sinceSource'] === 'string' && s['sinceSource'] !== '' ? { sinceSource: s['sinceSource'] } : {}),
      ...(typeof s['droppedStale'] === 'number' ? { droppedStale: num(s['droppedStale'], 0) } : {}),
      ...(typeof s['sourcesTimeUnknown'] === 'number' ? { sourcesTimeUnknown: num(s['sourcesTimeUnknown'], 0) } : {}),
      ...(typeof s['modelSkipped'] === 'number' ? { modelSkipped: num(s['modelSkipped'], 0) } : {}),
      ...(Array.isArray(s['modelSkipNotes'])
        ? { modelSkipNotes: (s['modelSkipNotes'] as unknown[]).filter((item): item is string => typeof item === 'string' && item !== '').slice(0, 10) }
        : {}),
      ...(typeof s['dropReasons'] === 'object' && s['dropReasons'] !== null
        ? {
          dropReasons: Object.fromEntries(
            Object.entries(s['dropReasons'] as Record<string, unknown>)
              .filter(([key, value]) => key !== '' && typeof value === 'number' && Number.isFinite(value))
              .map(([key, value]) => [key, value as number]),
          ),
        }
        : {}),
      /*
       * 「本轮没有新内容」两格：只有 true 才写回来（见 types.ts 的说明）。
       *
       * ⚠ 漏洗的后果比字段缺失严重：用户点更新 → 弹卡显示「没有新内容 · 模型
       *   判断 11 条候选重复」→ 刷新页面 → 那两格没了、弹卡退回「上一轮已完成
       *   但 0 条」，看起来像那一轮什么都没干。历史记录自相矛盾比缺字段糟得多。
       */
      ...(s['noNewContent'] === true ? { noNewContent: true } : {}),
      ...(typeof s['noNewContentReason'] === 'string' && s['noNewContentReason'] !== ''
        ? { noNewContentReason: s['noNewContentReason'] }
        : {}),
    }
  }
  return run
}

/* ───────────────────────────── FeedStore ───────────────────────────── */

/** 空 state（新建或损坏时的起点）。 */
function emptyState(): FeedStateFile {
  return {
    version: FEED_SCHEMA_VERSION,
    config: { ...DEFAULT_FEED_CONFIG, xHandles: [...DEFAULT_FEED_CONFIG.xHandles] },
    gate: { ...IDLE_GATE },
    runs: [],
    xSync: {},
    lastSyncAt: 0,
    lastRunAt: 0,
  }
}

/**
 * 动态模块的落盘存储（进程内单例）。
 *
 * 所有写方法都在**返回前**完成落盘 —— 单飞锁与「删除后重启仍在」这两条
 * 验收都依赖「写完就算数」，异步补写会让重启后读到旧状态（§5.2 明确要求
 * 状态落盘，否则「重启后连点两次」会跑两轮）。
 */
export class FeedStore {
  private state: FeedStateFile = emptyState()
  private posts: FeedPost[] = []
  private loaded = false
  /** 串行化写盘：并发写同一文件时后一次覆盖前一次，必须排队。 */
  private writeChain: Promise<void> = Promise.resolve()

  /** 数据根（诊断/面板展示用）。 */
  readonly root: string = feedDataDir()

  private get postsFile(): string { return join(this.root, 'posts.json') }
  private get stateFile(): string { return join(this.root, 'state.json') }

  /** 首次读取落盘状态（幂等）。 */
  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const postsRaw = await readJson<Partial<FeedPostsFile>>(this.postsFile, {})
    const list = Array.isArray(postsRaw.posts) ? postsRaw.posts : []
    this.posts = list.map(normalizePost).filter((post): post is FeedPost => post !== null)

    const stateRaw = await readJson<Partial<FeedStateFile>>(this.stateFile, {})
    const runs = Array.isArray(stateRaw.runs)
      ? stateRaw.runs.map(normalizeRun).filter((run): run is FeedRun => run !== null)
      : []
    this.state = {
      version: FEED_SCHEMA_VERSION,
      config: normalizeConfig(stateRaw.config),
      gate: normalizeGate(stateRaw.gate),
      runs: runs.slice(0, MAX_RUNS),
      xSync: normalizeXSync(stateRaw.xSync),
      lastSyncAt: num(stateRaw.lastSyncAt, 0),
      lastRunAt: num(stateRaw.lastRunAt, 0),
    }
  }

  /**
   * 重新从磁盘读取（云同步恢复动态设置后调用）。
   *
   * 先排空写队列再置位：不然「恢复写入」与「正在落盘的一次写」会互相覆盖，
   * 恢复完的配置可能被上一次的旧内存态又写回去。
   */
  async reload(): Promise<void> {
    await this.writeChain.catch(() => undefined)
    this.loaded = false
    this.posts = []
    this.state = emptyState()
    await this.load()
  }

  /** 串行写入（同一个文件不要并发写）。 */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task, task)
    // 吞掉链上的错误：一个写失败不能让后续所有写都短路（否则一次磁盘抖动
    // 会让闸门永远停在 running）。错误由各自的调用方决定怎么处理。
    this.writeChain = next.catch(() => undefined)
    return next
  }

  /** 写 posts.json。 */
  async persistPosts(): Promise<void> {
    await this.load()
    const payload: FeedPostsFile = { version: FEED_SCHEMA_VERSION, posts: this.posts }
    const text = JSON.stringify(payload)
    await this.enqueue(async () => { await atomicWrite(this.postsFile, text) })
  }

  /** 写 state.json。 */
  async persistState(): Promise<void> {
    await this.load()
    this.state.version = FEED_SCHEMA_VERSION
    const text = JSON.stringify(this.state, null, 2)
    await this.enqueue(async () => { await atomicWrite(this.stateFile, text) })
  }

  /* ── 帖子 ─────────────────────────────────────────────────────── */

  /** 全部帖子（**含**已软删的，调用方自己过滤；排序模块会过滤）。 */
  async listPosts(): Promise<FeedPost[]> {
    await this.load()
    return this.posts
  }

  /** 按 id 取一条（含已删）。 */
  async getPost(id: string): Promise<FeedPost | undefined> {
    await this.load()
    return this.posts.find(post => post.id === id)
  }

  /** 追加一批帖子（生成流水线用）。 */
  async addPosts(posts: readonly FeedPost[]): Promise<void> {
    await this.load()
    if (posts.length === 0) return
    this.posts.push(...posts)
    // 按 createdAt 倒序存盘：磁盘顺序只影响「读出来时的初始顺序」，
    // 排序由 rank.ts 负责；但让它大致有序可以让手工翻 posts.json 时看得懂。
    this.posts.sort((a, b) => b.createdAt - a.createdAt)
    await this.persistPosts()
  }

  /**
   * 局部更新一条帖子（点赞 / 已读 / 讨论 / 软删 / 恢复都走这里）。
   *
   * @returns 更新后的帖子；不存在返回 undefined（路由据此回 404 语义）。
   */
  async patchPost(id: string, patch: (post: FeedPost) => void): Promise<FeedPost | undefined> {
    await this.load()
    const post = this.posts.find(item => item.id === id)
    if (post === undefined) return undefined
    patch(post)
    await this.persistPosts()
    return post
  }

  /* ── 配置 ─────────────────────────────────────────────────────── */

  async getConfig(): Promise<FeedConfig> {
    await this.load()
    return this.state.config
  }

  /** 改配置（落盘后才返回）。 */
  async setConfig(config: FeedConfig): Promise<FeedConfig> {
    await this.load()
    this.state.config = config
    await this.persistState()
    return this.state.config
  }

  /* ── 闸门 ─────────────────────────────────────────────────────── */

  async getGate(): Promise<FeedStateFile['gate']> {
    await this.load()
    return this.state.gate
  }

  /** 写闸门（落盘后才返回 —— 单飞锁的跨进程语义全靠这一条）。 */
  async setGate(gate: FeedStateFile['gate']): Promise<void> {
    await this.load()
    this.state.gate = gate
    await this.persistState()
  }

  /* ── 轮次 ─────────────────────────────────────────────────────── */

  async listRuns(): Promise<FeedRun[]> {
    await this.load()
    return this.state.runs
  }

  /** 追加/替换一条轮次记录（同 id 覆盖）。 */
  async upsertRun(run: FeedRun): Promise<void> {
    await this.load()
    const index = this.state.runs.findIndex(item => item.id === run.id)
    if (index >= 0) this.state.runs[index] = run
    else this.state.runs.unshift(run)
    if (this.state.runs.length > MAX_RUNS) this.state.runs.length = MAX_RUNS
    if (run.startedAt > this.state.lastRunAt) this.state.lastRunAt = run.startedAt
    await this.persistState()
  }

  /* ── X 同步状态 ───────────────────────────────────────────────── */

  async listXSync(): Promise<Record<string, XSyncState>> {
    await this.load()
    return this.state.xSync
  }

  /** 单个账号的同步状态（不存在返回一个全新的零状态）。 */
  async getXSync(handle: string): Promise<XSyncState> {
    await this.load()
    const key = handle.toLowerCase()
    return this.state.xSync[key] ?? {
      handle: key,
      lastFetchedAt: 0,
      cooldownUntil: 0,
      consecutiveFailures: 0,
      seenTweetIds: {},
    }
  }

  /** 写单个账号的同步状态。 */
  async setXSync(state: XSyncState): Promise<void> {
    await this.load()
    this.state.xSync[state.handle.toLowerCase()] = state
    await this.persistState()
  }

  /** 记一次同步完成的时刻。 */
  async touchSync(at: number): Promise<void> {
    await this.load()
    this.state.lastSyncAt = at
    await this.persistState()
  }

  /** 整份状态快照（只读路由用）。 */
  async snapshot(): Promise<FeedStateFile> {
    await this.load()
    return this.state
  }
}

/** 导出给冒烟对拍。 */
export const __test = { normalizePost, normalizeMedia, normalizeConfig, normalizeGate, normalizeXSync, normalizeRun, emptyState, MAX_RUNS }
