/**
 * dsh-chat-plus — 「动态」页的进度估算与小工具（纯函数，零副作用）。
 *
 * 为什么单独一个文件而不是塞在 FeedPanel.tsx 里：
 *
 *  1. 这些函数是「预计什么时候更新完成」的**唯一真相**，也是最容易悄悄变成
 *     「假装知道进度」的地方（编百分比、编剩余秒数）。放在单独模块里，它们能被
 *     冒烟直接 import 跑真值断言 —— 塞在组件里则会被 esbuild 内联进 JSX，外部
 *     根本拿不到，只能靠读源码写正则，那挡不住逻辑错误（比如中位数算成平均值）。
 *  2. 组件文件已经很长（卡片渲染 + 浮层 + 轮询 + 设置面板），把「算什么」和
 *     「怎么画」分开之后，两边都能一眼读完。
 *
 * 本文件里每个函数都**不读时钟、不碰 DOM、不发请求**：时间一律由调用方传入，
 * 所以行为可以在任意时间点对拍，不受运行时刻影响。
 *
 * @module
 */

import { FALLBACK_ETA_MAX_MS, FALLBACK_ETA_MIN_MS, RUN_STEPS } from './constants.js'
import type { FeedModelCatalog, FeedPost, FeedRunStatsView, FeedRunView, FeedSource, FeedStatus } from './api.js'

/* ───────────────────────── 更新进度：纯函数 ───────────────────────── */

/**
 * 一轮生成在界面上要显示的全部内容（进度弹卡的唯一真相）。
 *
 * 抽成纯函数不是为了洁癖：这一整块最容易变成「假装知道进度」的地方 ——
 * 编一个百分比、写一个假的剩余时间，用户第一次发现它不准就再也不看它了。
 * 抽出来之后每一条口径都写在下面，冒烟与阅读代码的人看到的是同一份。
 */
export interface RunProgress {
  /** 当前阶段（人类可读，不带省略号以外的修饰）。 */
  readonly phase: string
  /** 阶段序号 0~4（对应 {@link RUN_STEPS}，决定进度条的视觉位置）。 */
  readonly step: number
  /** 是否已经跑完（含失败、含「没有新内容」）。 */
  readonly done: boolean
  /** 是否失败。⚠ 「没有新内容」**不是**失败，这一格对它恒为 false。 */
  readonly failed: boolean
  /**
   * 是否「跑完了、没出错、只是没有新内容」（host 的 status='skipped'）。
   *
   * 单独一格而不是复用 failed/ok：这三种结局在界面上是三种颜色、三句话，
   * 混进任何一格都会让用户读错（把正常态看成故障，或把 0 条产出看成已完成）。
   */
  readonly skipped: boolean
  /** 结局色调（界面据此上色；ok 绿 / skipped 中性灰 / failed 红 / running 强调）。 */
  readonly tone: RunTone
  /** 「没有新内容」的一句话结论（host 的 noNewContentReason）；空串 = 没有。 */
  readonly noteText: string
  /** 模型判重的逐条理由（host 的 modelSkipNotes，已截断到展示上限）。 */
  readonly skipNotes: readonly string[]
  /**
   * 本轮模型一共跳过了多少条（host 的 modelSkipped）。
   *
   * 与 skipNotes.length 是**两个数**：理由只存前 10 条（见 writer.ts 的
   * slice(0, 10)），而实际可能跳过 11 条。把它们混成一个数会让标题写成
   * 「共 10 条理由」—— 用户对着 run.stats 一核就发现少了一条，
   * 从此不再相信这张卡上的任何数字。
   */
  readonly skippedTotal: number
  /** 失败原因（**原样**来自 host run.error；没有就是空串）。 */
  readonly errorText: string
  /** 本轮开始时刻（毫秒；0 = 不知道）。 */
  readonly startedAt: number
  /** 已用时间（毫秒）。 */
  readonly elapsedMs: number
  /** 预计总耗时（毫秒；null = 没有历史，给不出单值）。 */
  readonly expectedMs: number | null
  /** 预计完成的文案（人话，已经包含「约」之类的措辞）。 */
  readonly etaText: string
  /** 本轮产出条数（跑完才有；null = 还不知道）。 */
  readonly postsCreated: number | null
  /** host 报的降级说明（如「web 检索不可用」），空串 = 没有。 */
  readonly degraded: string
}

/**
 * 一轮结局的色调（界面唯一的着色依据）。
 *
 * 为什么要有这个枚举而不是让组件自己 if/else：**「没有新内容」被画成红色**是
 * 这次要修的原始缺陷。着色判据散在各处时，总有一处会写成
 * `failed = status !== 'ok'`，于是正常态又被染红。收成一个纯函数（并让冒烟
 * 真值断言它）之后，「skipped 不是红」这条就有了唯一出口。
 */
export type RunTone = 'idle' | 'running' | 'ok' | 'skipped' | 'failed'

/** 模型判重理由在弹卡里默认展开几条（其余折叠，点「展开全部」再看）。 */
export const MAX_SKIP_NOTES_SHOWN = 3

/**
 * outcome 字符串 → 色调（host 的 run.status 直接喂进来）。
 *
 * 认不出来的字符串（老 host / 手改数据）一律落 'ok'：
 * 那一轮的产出已经在列表里，把它染成红色只会制造恐慌；而真正失败的一轮
 * 一定有 status='failed' 或非空 error，那两条路各自单独判（见 runProgressOf）。
 */
export function runToneOf(status: string, running: boolean): RunTone {
  if (running) return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'skipped') return 'skipped'
  if (status === 'ok') return 'ok'
  return 'ok'
}

/**
 * 把判重理由切成「默认显示的 N 条」与「其余折叠的」。
 *
 * 用户要看到模型判重的**具体理由**（这是整个功能最有说服力的展示），
 * 但 11 条理由一次全摊开会把弹卡撑成一整屏、把「再更新一轮」按钮推出视野。
 * 所以默认 3 条，其余折进一条「还有 N 条」。
 */
export function splitSkipNotes(
  notes: readonly string[] | undefined,
  limit: number = MAX_SKIP_NOTES_SHOWN,
): { shown: string[]; rest: string[] } {
  const clean = Array.isArray(notes)
    ? notes.filter((note): note is string => typeof note === 'string' && note.trim() !== '')
    : []
  const cut = Math.max(0, Math.floor(limit))
  return { shown: clean.slice(0, cut), rest: clean.slice(cut) }
}

/** 估算用的历史样本：跑完且耗时可算的那些轮。 */
export function runDurationsOf(runs: readonly FeedRunView[] | undefined): number[] {
  const out: number[] = []
  if (!Array.isArray(runs)) return out
  for (const run of runs) {
    if (run.startedAt <= 0) continue
    if (run.status === 'running') continue
    if (run.finishedAt <= run.startedAt) continue
    out.push(run.finishedAt - run.startedAt)
  }
  return out
}

/**
 * 依据 host 的过程计数推断当前阶段。
 *
 * 为什么以 stats 为第一优先：host 的 writer 是**按顺序**写这几格的
 * （queries → sourcesOpen → rawChars → postsCreated），所以「哪一格已经有值」
 * 就是真实的执行位置，比任何时间估算都准。
 *
 * ⚠ 但实测有个坑：stats 是**跑完才落进 run 的**，生成中读到的往往是空对象。
 * 所以调用方必须准备两条路 —— 有 stats 用这里，没有就用
 * {@link phaseByClock} 按时间推进。
 */
function phaseByStats(stats: FeedRunStatsView | null): { phase: string; step: number } | null {
  if (stats === null) return null
  const created = stats.postsCreated ?? 0
  const raw = stats.rawChars ?? 0
  const open = stats.sourcesOpen ?? 0
  const limited = stats.sourcesLimited ?? 0
  const queries = stats.queries ?? 0
  if (created > 0) {
    return { phase: '正在静默上架 · 已生成 ' + String(created) + ' 条', step: 4 }
  }
  if (raw > 0) {
    return { phase: '正在撰写内容 · 已收到模型 ' + String(raw) + ' 字符', step: 3 }
  }
  if (open > 0 || limited > 0) {
    return { phase: '正在校验来源 · 可用 ' + String(open) + ' 个，平台查看 ' + String(limited) + ' 个', step: 2 }
  }
  if (queries > 0) {
    return { phase: '正在检索资料 · 已发 ' + String(queries) + ' 条检索', step: 1 }
  }
  /*
   * 五格全零有两种可能，**不要混为一谈**：
   *   · 刚开始跑（都还没写）→ 正常，按「读取提示词」显示；
   *   · 跑完了但五格都是 0 → 那一轮什么也没做出来，必须直说，否则用户会一直
   *     盯着「正在检索资料…」等一个永远不会来的结果。
   */
  return { phase: RUN_STEPS[0], step: 0 }
}

/**
 * 没有 stats 时按时间推进阶段。
 *
 * @param ratio - 已用时间 / 预计总耗时（null = 连预计都没有）。
 *
 * 切分点不是均分：真实流水线里「检索 + 验活」占大头，「上架」是一瞬间。
 * 均分会让人总觉得卡在中间那一段。
 */
function phaseByClock(ratio: number | null): { phase: string; step: number } {
  if (ratio === null) return { phase: RUN_STEPS[1], step: 1 }
  if (ratio < 0.08) return { phase: RUN_STEPS[0], step: 0 }
  if (ratio < 0.42) return { phase: RUN_STEPS[1], step: 1 }
  if (ratio < 0.66) return { phase: RUN_STEPS[2], step: 2 }
  if (ratio < 0.94) return { phase: RUN_STEPS[3], step: 3 }
  return { phase: RUN_STEPS[4], step: 4 }
}

/** 本轮的统计格（只取进度卡要用的那几项，缺的落 undefined）。 */

/** 找出「正在跑的」那一轮（host 说 running 时状态里那条记录）。 */
export function activeRunOf(status: FeedStatus | null, localStartedAt: number): FeedRunView | null {
  if (status === null) return null
  /*
   * ⚠ runs 必须**自己兜底成空数组**，不能假设它一定在。
   *
   * client 与 host 是各自独立部署的两半：刷新页面 client 立即生效，host 要
   * 重启服务才换新。这段窗口里旧 host 的 /status 可能压根没有 runs 字段 ——
   * 直接 .filter 会抛 TypeError，而它发生在 render 期间，整页白屏。
   * 实测就是这么发现的（本地验证脚本第一次跑就崩在这里）。
   */
  const runs = Array.isArray(status.runs) ? status.runs : []
  const mine = runs.filter((run) => run.status === 'running')
  if (mine.length > 0) {
    let best = mine[0]
    for (const run of mine) if (run.startedAt > best.startedAt) best = run
    return best
  }
  /*
   * host 还没把这一轮写进 runs（点下更新后的头 1~2 秒就是这样），但本地知道
   * 自己是几点点的。造一个**只用于计时**的占位记录，startedAt 用本地时刻 ——
   * 界面上「已用时间」能立刻开始跳，而不是先空几秒。stats 必须给空对象：
   * 那是「还没有任何过程数据」的正确表示，不是 0。
   */
  if (status.running && localStartedAt > 0) {
    return {
      id: 'local',
      trigger: 'manual',
      status: 'running',
      startedAt: localStartedAt,
      finishedAt: 0,
      modelUsed: '',
      stats: {},
      error: '',
      blockedBy: '',
    }
  }
  return null
}

/**
 * 算出进度弹卡要显示的全部内容。
 *
 * @param status - host 的 /status（可能为 null：还没拉到 / 老 host 没这路由）
 * @param now - 当前时刻（每秒由调用方推进，所以已用时间是活的）
 * @param localStartedAt - 本地点「更新」的时刻（0 = 这次不是本地发起的）
 *
 * 口径三条，逐条都能对上用户的话：
 *  1. 「目前正在更新的进度情况」→ phase + step（不编百分比，见弹卡里的不定态条）
 *  2. 「预计什么时候更新完成」→ 历史中位数；没有历史就 30~60 秒的区间
 *  3. 失败时必须能看出**为什么**（run.error 原样透出，不做任何美化）
 */
export function runProgressOf(
  status: FeedStatus | null,
  now: number,
  localStartedAt: number,
): RunProgress {
  const active = activeRunOf(status, localStartedAt)
  const historical = runDurationsOf(status?.runs ?? []).filter((ms) => ms > 0)
  const expectedMs = medianOf(historical)

  if (active !== null) {
    const elapsedMs = Math.max(0, now - active.startedAt)
    const ratio = expectedMs !== null && expectedMs > 0 ? elapsedMs / expectedMs : null
    const byStats = phaseByStats(Object.keys(active.stats).length === 0 ? null : active.stats)
    const picked = byStats ?? phaseByClock(ratio)
    return {
      phase: picked.phase,
      step: picked.step,
      done: false,
      failed: false,
      skipped: false,
      tone: 'running',
      noteText: '',
      skipNotes: [],
      skippedTotal: 0,
      errorText: '',
      startedAt: active.startedAt,
      elapsedMs,
      expectedMs,
      etaText: etaTextOf(elapsedMs, expectedMs, now),
      postsCreated: active.stats.postsCreated ?? null,
      degraded: active.stats.degraded ?? '',
    }
  }

  /*
   * 没有在跑的轮次：显示**上一轮**的结局。这一格是「点开弹卡至少有点东西
   * 可看」的兜底 —— 用户随时可能点它，而大多数时候页面是空闲的。
   */
  const latest = latestRunViewOf(status)
  if (latest === null) {
    return {
      phase: '空闲 · 还没有跑过一轮',
      step: 0,
      done: true,
      failed: false,
      skipped: false,
      tone: 'idle',
      noteText: '',
      skipNotes: [],
      skippedTotal: 0,
      errorText: '',
      startedAt: 0,
      elapsedMs: 0,
      expectedMs,
      etaText: '',
      postsCreated: null,
      degraded: '',
    }
  }
  const took = latest.finishedAt > latest.startedAt ? latest.finishedAt - latest.startedAt : 0
  /*
   * ⚠ 判据必须是「error 有内容」，不能写 latest.error !== ''。
   *
   * 实测（2026-10-27 真实服务）：host 的 FeedRun **成功时压根没有 error 这个键**
   * （runs[0] 的字段是 id/trigger/modelUsed/startedAt/status/finishedAt/stats）。
   * 于是 latest.error 是 undefined，而 undefined !== '' 恒为 true —— 每一轮成功
   * 都会被判成失败，弹卡顶部写着「上一轮失败」，还会把「失败原因」那一块拉出来
   * 显示一句空话。只判 status 与 error 的真值，缺失一律当没有错误。
   */
  /*
   * stats 自己兜底成空对象。
   *
   * 与 runs 同一类风险：这个函数跑在 render 期间，一次 TypeError 就是整页白屏。
   * 类型上 FeedRunView.stats 是必填，但 host 是另一半独立部署的（老 host 没有
   * 那几格，手写测试态也可能漏），下面每一处 latest.stats.xxx 都会在缺失时抛。
   * 兜一层比在每个属性前写 ?. 更不容易漏。
   */
  const stats = (latest.stats ?? {}) as FeedRunStatsView
  const errorOf = typeof latest.error === 'string' ? latest.error : ''
  /*
   * 「没有新内容」先于失败判定 —— 这次修的原始缺陷就在这里：
   *
   * 用户实测那一轮 host 报的是 status='failed' + error「模型判断本轮没有新内容
   * 可写，主动跳过了 11 条」。判据只看 error 非空的话，即使 host 改成 skipped，
   * 残留的 error 也会把它重新染成红色。所以：
   *   · status === 'skipped' 或 stats.noNewContent === true → 一定不是失败；
   *   · 否则再看 error 非空。
   *
   * 历史数据（旧 host 记的 failed + 那段 error）不迁移，它们仍然显示为失败 ——
   * 那是当时的判定口径，改它等于篡改历史；新版跑出来的轮次才会是 skipped。
   */
  const noNewContent = latest.status === 'skipped' || stats.noNewContent === true
  const failed = !noNewContent && (latest.status === 'failed' || errorOf !== '')
  const tone: RunTone = failed ? 'failed' : noNewContent ? 'skipped' : runToneOf(latest.status, false)
  return {
    phase: failed
      ? '上一轮失败'
      : latest.status === 'running'
        ? RUN_STEPS[3]
        : noNewContent
          ? '没有新内容'
          : '上一轮已完成',
    step: failed ? 0 : 4,
    done: latest.status !== 'running',
    failed,
    /*
     * 「没有新内容」与「全都过了一遍但被挡下」都是同一件事：跑完了、没出错、
     * 这一轮没有可上架的新东西。两者都已并进 noNewContent（status='skipped'
     * 或 stats.noNewContent），所以这里只需再与 failed 互斥一次。
     */
    skipped: !failed && noNewContent,
    tone,
    noteText: typeof stats.noNewContentReason === 'string' ? stats.noNewContentReason : '',
    skipNotes: Array.isArray(stats.modelSkipNotes) ? stats.modelSkipNotes : [],
    // 没有 modelSkipped 时退回理由条数：老数据里没有那个计数，硬写 0 会说成「一条没跳」。
    skippedTotal: typeof stats.modelSkipped === 'number' && stats.modelSkipped > 0
      ? stats.modelSkipped
      : (Array.isArray(stats.modelSkipNotes) ? stats.modelSkipNotes.length : 0),
    errorText: errorOf,
    startedAt: latest.startedAt,
    elapsedMs: took,
    expectedMs,
    etaText: '',
    postsCreated: stats.postsCreated ?? null,
    degraded: stats.degraded ?? '',
  }
}

/** 最近一轮（按 startedAt 取最大，不赌数组顺序）。 */
function latestRunViewOf(status: FeedStatus | null): FeedRunView | null {
  if (status === null) return null
  // 同 activeRunOf：老 host 可能没有 runs 字段，这里也必须自己兜底。
  const runs = Array.isArray(status.runs) ? status.runs : []
  let best: FeedRunView | null = null
  for (const run of runs) {
    if (best === null || run.startedAt > best.startedAt) best = run
  }
  return best
}

/**
 * 「预计完成」的文案。
 *
 * 三档，从最有信息量到最保守：
 *  1. 有历史中位数且时间还够 → 「预计还需约 20 秒 · 14:35 完成」（既给相对又给绝对）
 *  2. 已经超过中位数（这轮特别慢）→ 不说「还需 -3 秒」，改说「比往常慢，仍在进行」
 *  3. 没有历史 → 「预计 30-60 秒」（**区间**，不伪装成精确值）
 */
function etaTextOf(elapsedMs: number, expectedMs: number | null, now: number): string {
  if (expectedMs === null) {
    return '预计 ' + String(Math.round(FALLBACK_ETA_MIN_MS / 1000)) + '-'
      + String(Math.round(FALLBACK_ETA_MAX_MS / 1000)) + ' 秒'
  }
  const left = expectedMs - elapsedMs
  if (left <= 0) return '比往常慢一些，仍在进行'
  const leftText = left < 10000
    ? '约 ' + String(Math.max(5, Math.round(left / 1000 / 5) * 5)) + ' 秒'
    : elapsedText(left)
  return '预计还需 ' + leftText + ' · ' + clockText(now + left) + ' 完成'
}

/**
 * 右上角状态指示的文案（纯函数，供渲染与冒烟共用一份口径）。
 *
 * 空闲时**必须给完整年月日**：用户原话是「显示出来年月日」，那一格不能只有
 * 「5 小时前」。「上次更新 · 2026年10月27日 14:32」是能被核对的事实。
 */
export function statusLabelOf(status: FeedStatus | null, running: boolean, now: number): string {
  if (running) return '更新中'
  const lastRunAt = status?.lastRunAt ?? 0
  if (lastRunAt > 0) return '上次更新 · ' + fullDateText(lastRunAt)
  // host 有 runs 但没有 lastRunAt（老数据）：从最近一轮的 startedAt 兜底。
  const latest = latestRunViewOf(status)
  if (latest !== null && latest.startedAt > 0) {
    return '上次更新 · ' + fullDateText(latest.startedAt)
  }
  void now
  return '尚未更新'
}

/**
 * 右上角状态胶囊里的**结局短语**（进行中 / 从未跑过时返回空串）。
 *
 * 与 {@link statusLabelOf} 分工：那个回答「上次更新是几点」（时间事实，永远
 * 带完整年月日），这个回答「上一轮结果怎么样」（结局，决定颜色与措辞）。
 * 两件事拆开是因为它们的刷新频率与出错后果完全不同 —— 时间错一个字用户
 * 就对不上账，结局错一个字用户就把正常态读成故障。
 *
 * ⚠ 「没有新内容」这一档**不许出现「失败」「错误」「异常」任何字样**：
 * 那是模型按「宁可少写不要重复」正常工作后的结果，不是故障。用户实测里
 * 它被报成「更新失败」，正是这次要修的原始缺陷。
 */
export function outcomeLabelOf(status: FeedStatus | null): string {
  const latest = latestRunViewOf(status)
  if (latest === null) return ''
  if (latest.status === 'running') return ''
  const noNewContent = latest.status === 'skipped' || (latest.stats ?? {}).noNewContent === true
  if (noNewContent) return '没有新内容'
  const errorOf = typeof latest.error === 'string' ? latest.error : ''
  if (latest.status === 'failed' || errorOf !== '') return '上一轮失败'
  return '已完成'
}

/* ───────────────────────── 日期 / 时长 / 中位数 ───────────────────────── */
/** 两位补零（不用 padStart：老构建目标里它偶尔被 polyfill 掉，这里保持最朴素的写法）。 */
export function pad2(value: number): string {
  return ('0' + String(value)).slice(-2)
}

/**
 * 「N 分钟前 / N 小时前 / N 天前」——现在是**辅助信息**。
 *
 * 用户原话：「每一条要显示出来年月日」。所以卡片主显示换成 {@link fullDateText}
 * 的完整年月日，相对时间降级成紧跟其后的小字 + hover title：它回答的是「多久
 * 以前」这个不同的问题，两个都要，但主次要分清。
 */
export function agoText(ms: number, now: number): string {
  const minutes = Math.max(0, (now - ms) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return Math.round(minutes) + ' 分钟前'
  const hours = minutes / 60
  if (hours < 24) return Math.round(hours) + ' 小时前'
  return Math.round(hours / 24) + ' 天前'
}

/** 完整年月日 + 时分：2026年10月27日 14:32（每条动态的主时间显示）。 */
export function fullDateText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  return String(d.getFullYear()) + '年' + String(d.getMonth() + 1) + '月'
    + String(d.getDate()) + '日 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 只要日期：2026年10月27日（按天分组的组标题用）。 */
export function dateOnlyText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  return String(d.getFullYear()) + '年' + String(d.getMonth() + 1) + '月' + String(d.getDate()) + '日'
}

/**
 * 紧凑日期：2026/9/30（左侧条目列表那一行用）。
 *
 * 为什么不复用 {@link fullDateText}：列表里一条只占一行、旁边还有缩略图，
 * 「2026年9月30日 14:32」会把标题挤成两行。参考界面里那一行就是 2026/9/30。
 *
 * 与 fullDateText 同一套「0 = 无时间」哨兵口径：返回空串，绝不渲染 1970 年。
 * 年份不补零、月日不补零（截图就是 2026/9/30 而不是 2026/09/30）。
 */
export function shortDateText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  return String(d.getFullYear()) + '/' + String(d.getMonth() + 1) + '/' + String(d.getDate())
}

/** 时分（讨论区的时间戳 / 预计完成时刻）。 */
export function clockText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/**
 * 时长文案（进度弹卡的「已用时间」）。
 *
 * 秒级的要真的显示秒：这个数字每秒跳一格，正因为它在跳，用户才相信页面在跑。
 * 一小时以上就不要再显示秒了，那时候精确到秒只是噪音。
 */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return String(total) + ' 秒'
  if (total < 3600) {
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return seconds === 0 ? String(minutes) + ' 分' : String(minutes) + ' 分 ' + String(seconds) + ' 秒'
  }
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return minutes === 0 ? String(hours) + ' 小时' : String(hours) + ' 小时 ' + String(minutes) + ' 分'
}

/**
 * 中位数（预计完成的唯一依据）。
 *
 * 为什么是中位数不是平均值：一轮如果赶上网络抖动 / 模型排队，耗时可能翻几倍，
 * 平均值会被这**一个**离群点拖高，于是「预计还需 3 分钟」次次不准。中位数对
 * 离群点稳健，历史样本少时也不会离谱。样本不足 2 个时返回 null —— 一个样本
 * 撑不起「预计」，界面那时改说保守区间。
 */
export function medianOf(values: readonly number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (usable.length < 2) return null
  const mid = Math.floor(usable.length / 2)
  return usable.length % 2 === 1 ? usable[mid] : (usable[mid - 1] + usable[mid]) / 2
}

/** 某时刻属于哪一天（本地时区），形如 2026-10-27。分组 key 用它。 */
export function dateKeyOf(ms: number): string {
  const d = new Date(ms)
  return String(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/**
 * 按天分组的组标题：今天 / 昨天 带完整年月日，更早的直接就是日期。
 *
 * 用户要求组标题也要有年月日（"2026年10月20日"这种），而不是只有「今天 / 昨天」：
 * 只写「今天」的话，隔天再看历史时整列标题都没有日期，得靠卡片自己带。
 * createdAt 不可用（0 / 老 host 没给）时返回「更早」，绝不按 1970 年算日期。
 */
export function dayHeadingText(createdAt: number, now: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return '更早'
  const todayKey = dateKeyOf(now)
  const yesterdayKey = dateKeyOf(now - 86400000)
  const key = dateKeyOf(createdAt)
  const date = dateOnlyText(createdAt)
  if (key === todayKey) return '今天 · ' + date
  if (key === yesterdayKey) return '昨天 · ' + date
  return date
}

/* ───────────────────────── 来源名 ───────────────────────── */

/**
 * 域名 → 站点中文名。
 *
 * 用途：卡片头那一位原来写死「苏墨」（作者名），用户要求改成「动态来源的名字」，
 * 而且要能点。裸域名（ithome.com）摆在那个位置读起来像调试信息，所以常见站点
 * 给中文名，映射不到就回落成**去 www 的域名**（那是真实值，不是编的）。
 *
 * 匹配规则是「后缀命中」：key 写成不带 www 的注册域，m.ithome.com /
 * www.ithome.com.cn 这类都能命中（详见 prettySiteName）。
 */
const SITE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['ithome.com', 'IT之家'],
  ['36kr.com', '36氪'],
  ['jiqizhixin.com', '机器之心'],
  ['sina.com.cn', '新浪'],
  ['sina.cn', '新浪'],
  ['weibo.com', '微博'],
  ['zhihu.com', '知乎'],
  ['juejin.cn', '掘金'],
  ['csdn.net', 'CSDN'],
  ['github.com', 'GitHub'],
  ['twitter.com', 'X'],
  ['x.com', 'X'],
  ['mp.weixin.qq.com', '微信公众号'],
  ['deepseek.com', 'DeepSeek 官方'],
  ['openai.com', 'OpenAI'],
  ['anthropic.com', 'Anthropic'],
  ['huggingface.co', 'Hugging Face'],
  ['arxiv.org', 'arXiv'],
  ['sspai.com', '少数派'],
  ['ifanr.com', '爱范儿'],
  ['leiphone.com', '雷峰网'],
  ['qbitai.com', '量子位'],
  ['thepaper.cn', '澎湃新闻'],
  ['caixin.com', '财新'],
  ['yicai.com', '第一财经'],
  ['cls.cn', '财联社'],
  ['eastmoney.com', '东方财富'],
  ['wallstreetcn.com', '华尔街见闻'],
  ['bbc.com', 'BBC'],
  ['bbc.co.uk', 'BBC'],
  ['reuters.com', '路透社'],
  ['bloomberg.com', '彭博社'],
  ['techcrunch.com', 'TechCrunch'],
  ['theverge.com', 'The Verge'],
  ['wired.com', 'Wired'],
  ['nytimes.com', '纽约时报'],
  ['wsj.com', '华尔街日报'],
  ['ft.com', '金融时报'],
  ['economist.com', '经济学人'],
  ['nature.com', 'Nature'],
  ['science.org', 'Science'],
  ['news.ycombinator.com', 'Hacker News'],
  ['reddit.com', 'Reddit'],
  ['youtube.com', 'YouTube'],
  ['bilibili.com', '哔哩哔哩'],
  ['douyin.com', '抖音'],
  ['xiaohongshu.com', '小红书'],
  ['toutiao.com', '今日头条'],
  ['baidu.com', '百度'],
  ['qq.com', '腾讯'],
  ['163.com', '网易'],
  ['sohu.com', '搜狐'],
  ['ifeng.com', '凤凰网'],
  ['guancha.cn', '观察者网'],
  ['people.com.cn', '人民网'],
  ['xinhuanet.com', '新华网'],
  ['gov.cn', '中国政府网'],
  ['jianshu.com', '简书'],
  ['cnblogs.com', '博客园'],
  ['infoq.cn', 'InfoQ'],
  ['oschina.net', '开源中国'],
  ['segmentfault.com', '思否'],
  /* 以下来自 2026-10-27 真实服务下发的来源（法律 / 合规 / 科技媒体），
     都是实测出现过的域名，不是凭印象编的。 */
  ['jtn.com', '天同律师事务所'],
  ['kingandwood.com', '金杜律师事务所'],
  ['junhe.com', '君合'],
  ['legal500.com', 'Legal 500'],
  ['lexology.com', 'Lexology'],
  ['hairunlawyer.com', '海润天睿'],
  ['zhonglun.com', '中伦律师事务所'],
  ['fangdalaw.com', '方达律师事务所'],
  ['hankun.com', '汉坤律师事务所'],
  ['mergersight.com', 'MergerSight'],
  ['chinalawtranslate.com', '中国法律翻译'],
  ['lawinfochina.com', '北大法律信息网'],
  ['pkulaw.com', '北大法宝'],
  ['wipo.int', 'WIPO'],
  ['europa.eu', '欧盟官网'],
  ['commerce.gov', '美国商务部'],
  ['bis.gov', '美国 BIS'],
  ['ustr.gov', '美国贸易代表办公室'],
  ['ftc.gov', '美国 FTC'],
  ['sec.gov', '美国 SEC'],
  ['nist.gov', '美国 NIST'],
  ['courtlistener.com', 'CourtListener'],
  ['law.cornell.edu', '康奈尔法学院'],
]

/** 去掉协议 / 路径 / www. 之后的裸域名（失败返回空串）。 */
function bareDomainOf(source: FeedSource): string {
  const raw = source.domain !== '' ? source.domain : source.url
  const stripped = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '')
  return stripped.toLowerCase()
}

/**
 * 一条来源 → 界面上显示的名字。
 *
 * 三级回退，每一级都是**真实数据**：
 *  1. 域名命中 SITE_NAMES → 中文名（IT之家）；
 *  2. 没命中但 host 给了 sources[].title → 用它（host 抓到的页面标题就是真实来源名）；
 *  3. 都没有 → 去 www 的裸域名。
 * 绝不返回空串：卡片头那一位空着会让整行看起来错位。
 */
export function prettySiteName(source: FeedSource): string {
  const domain = bareDomainOf(source)
  if (domain !== '') {
    for (const [key, label] of SITE_NAMES) {
      // 后缀命中：m.ithome.com / ithome.com.cn 都算命中 ithome.com
      if (domain === key || domain.endsWith('.' + key) || domain.startsWith(key + '.')) return label
    }
  }
  /*
   * 域名映射不到 → **直接用裸域名**，绝不拿 sources[].title 顶上。
   *
   * ── 这是真实服务实测出来的坑（2026-10-27）─────────────────────────────
   * 原来这里会回落到 title，而真实数据里 title 是**整篇文章标题**：
   *   domain="jtn.com"  title="技术出口目录修订（上篇）：同一AI模型，四种出海四种结论"
   * 于是卡片头那一位（原来是「苏墨」两个字的位置）显示成一长串文章标题，
   * 把整行撑成两三行、把后面的年月日挤到看不见的地方。
   *
   * 位置决定口径：那一位要的是**来源名**（IT之家 / jtn.com），不是内容标题。
   * 域名是短、稳定、真实的标识；文章标题不是「来源」。所以：
   *   · 命中映射表 → 中文站名
   *   · 没命中     → 裸域名（jtn.com），真实且短
   *   · 连域名都没有 → 取 title 的站点段（此时没有更好的信息了），再不行「网络」
   */
  if (domain !== '') return domain
  const title = source.title.trim()
  if (title !== '' && title !== source.url) {
    // 只在这种情况下才用 title，且仍然只取「站点段」那一段并限长。
    const tail = title.split(/\s[-|·—]\s|\s[-|·—]|[-|·—]\s/).filter((part) => part.trim() !== '')
    const pick = (tail.length > 1 ? tail[tail.length - 1] : title).trim()
    if (pick !== '') return pick.length > 20 ? pick.slice(0, 20) + '…' : pick
  }
  return '网络'
}

/**
 * 一条动态的「来源名」（卡片头那一位的主显示）。
 *
 * 用户原话：「这个变更为动态来源的名字，点击就是跟原文点击一样的效果」。
 * 多来源时说「XX 等 N 个来源」—— 直接列 N 个名字会把那一行挤爆，而「等 N 个」
 * 已经把「还有别的」这件事说清楚了，点开浮层就是完整清单。
 */
export function sourceLabelOf(post: FeedPost): string {
  const sources = post.sources
  if (sources.length === 0) return '网络'
  const first = prettySiteName(sources[0])
  if (sources.length === 1) return first
  return first + ' 等 ' + String(sources.length) + ' 个来源'
}

/**
 * 从一条 X 来源里抠出**作者账号**（形如 `@claudeai`）。
 *
 * 依据是 host 侧 `tweetToSource` 的标题格式：`@<handle> · <昵称>`
 * （见 src/feed/sources.ts）。不是这个格式（网页来源）就返回 null。
 */
function xAuthorOf(source: { url: string; title: string }): string | null {
  if (!/^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(source.url)) return null
  const title = source.title.trim()
  if (!title.startsWith('@')) return null
  const handle = title.split(' · ')[0]?.trim() ?? ''
  return handle.length > 1 ? handle : null
}

/**
 * 卡头第一位的显示名（用户 2026-10-28：「作者账号放第一位置」）。
 *
 * 优先级：
 *   1. **X 推文的作者账号**（`@claudeai`）—— 用户关注的是人，不是平台；
 *   2. 没有账号信息（网页来源）时退回站点名（`ithome.com`）；
 *   3. 多来源时在账号后面补「等 N 个来源」。
 *
 * 为什么作者账号优先于站点名：一条来自 @claudeai 的动态，用户想知道的是
 * 「谁说的」；显示「x.com」等于只说了「在哪说的」，信息量为零。
 */
/**
 * 这条动态该显示**哪个时间**（用户 2026-10-28：「时间应该是账号或者信息渠道
 * 来源他们发布的时间，而不是我们更新的时间」）。
 *
 * 数据依据：
 *   · X 来源的 `fetchedAt` **就是推文的发布时间** —— host 侧 `tweetToSource`
 *     写的是 `fetchedAt: tweet.createdAt`（见 src/feed/sources.ts），不是抓取时刻；
 *   · 网页来源的 `fetchedAt` 是**抓取时刻**，拿它当发布时间会撒谎
 *     （一篇 3 年前的文章会显示成「今天」），所以只对 X 来源取这一格。
 *
 * 兜底链：X 来源发布时间 → post.createdAt（我们这一轮生成它的时间）。
 * 兜底不是「更好看」，而是**老帖子/网页帖子必须有个时间可显示**，
 * 否则卡头会空一格。
 */
export function publishedAtOf(post: FeedPost): number {
  const first = post.sources[0]
  // fetchedAt 在客户端投影里是可选字段（老 host 可能不下发），缺了就回落 createdAt。
  const publishedAt = first === undefined ? undefined : first.fetchedAt
  if (first !== undefined && xAuthorOf(first) !== null && publishedAt !== undefined && publishedAt > 0) {
    return publishedAt
  }
  return post.createdAt
}

/**
 * 这个时间是不是「对方发布的时间」（而不是我们生成的时间）。
 * 界面据此决定要不要在悬停提示里注明来源，避免用户以为时间错了。
 */
export function isPublishedTime(post: FeedPost): boolean {
  return publishedAtOf(post) !== post.createdAt
}

export function authorLabelOf(post: FeedPost): string {
  const sources = post.sources
  if (sources.length === 0) return '网络'
  const author = xAuthorOf(sources[0])
  const base = author ?? prettySiteName(sources[0])
  if (sources.length === 1) return base
  return base + ' 等 ' + String(sources.length) + ' 个来源'
}

/* ───────────────────────── 正文拆段 ───────────────────────── */

/**
 * 正文按空行 / 换行拆成段落（阅读器里每段一个 p）。
 *
 * 为什么必须在客户端拆：host 下发的 body 是模型现写的一段纯文本，换行在
 * 文本里是真实存在的结构（列表、分点、转折），而 HTML 会把它们全压成空格。
 * 直接塞进一个 <p> 里，用户看到的是「一整坨没有段落的长文」—— 那正是
 * 参考界面里要避免的阅读体验。
 *
 * 三条规则：
 *   1. **空行是强分隔**：连续两个及以上换行 → 一定断段；
 *   2. **单换行也断段**（模型写分点时常常只用一个 \n），这是这一页的取舍：
 *      正文都是短段，宁可多一段也不要糊成一坨；
 *   3. 空段丢掉（行首尾的空白行不该在页面上占一个空 <p>）。
 *
 * 返回值**永远非空**：正文为空串时给 ['']，渲染层据此仍画一个空段落占位
 * （比什么都不画更稳定 —— 布局不会因为一条空正文而跳动）。
 */
export function splitParagraphs(body: string): string[] {
  if (typeof body !== 'string') return ['']
  const parts = body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n|\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return parts.length === 0 ? [''] : parts
}

/* ───────────────────────── 媒体 ───────────────────────── */

/**
 * 一条媒体在列表里显示的角标（null = 不显示角标）。
 *
 * 「有没有媒体」这件事必须在**左栏条目行**就能看出来（缩略图本身已经表达了
 * 一半），但视频与 GIF 需要额外一个可播放的信号 —— 用户扫列表时要能区分
 * 「这是一张图」与「这是一段能播的视频」。
 */
export function mediaBadgeOf(type: string): string | null {
  if (type === 'video') return '视频'
  if (type === 'animated_gif') return 'GIF'
  return null
}

/**
 * 媒体项的显示宽高比（CSS aspect-ratio 的取值；拿不到尺寸时返回 null）。
 *
 * 为什么需要它：外链图加载是异步的，没有占位比例时图片一到就会把下面的正文
 * **整体顶下去**（CLS，读着读着跳行）。有宽高就先把盒子按比例占好。
 * 两个值都必须是正数才可用 —— 只有宽度没有高度算不出比例。
 */
export function mediaAspectOf(media: { width?: number; height?: number }): string | null {
  const w = media.width ?? 0
  const h = media.height ?? 0
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return String(w) + ' / ' + String(h)
}

/**
 * 把缩放倍数夹到允许区间（lightbox 的滚轮缩放用）。
 *
 * 抽成纯函数是因为**边界条件错了不会报错**：夹错只会让用户「滚到某个倍数
 * 就再也滚不动」，或者一路缩到看不见。这类问题只能靠真值断言钉住。
 *
 * 非有限数（NaN / Infinity）一律回落到 1x：那说明调用方的 delta 算崩了，
 * 停在原始比例比停在一个随机倍数安全。
 */
export function clampScale(value: number, min = 0.5, max = 5): number {
  if (!Number.isFinite(value)) return 1
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * 滚轮增量 → 新的缩放倍数（指数曲线，锚点由调用方处理）。
 *
 * 用指数而不是线性加法的理由：缩放是**乘法语义**（1x → 2x 与 2x → 4x 应该是
 * 同样「一格」的手感），线性加法在 1x 附近太灵敏、在 4x 附近几乎没反应。
 * deltaMode 三种（像素 / 行 / 页）都要折算，否则 Firefox 的行模式滚轮几乎不动。
 */
export function wheelScaleOf(current: number, deltaY: number, deltaMode = 0, gain = 0.0016): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1
  const safeDelta = Number.isFinite(deltaY) ? deltaY : 0
  return clampScale(current * Math.exp(-safeDelta * unit * gain))
}

/**
 * 视频类媒体是否有可播放的直链。
 *
 * ⚠ 「有封面」不等于「能播」：X 的 syndication 数据里大量视频不给 mp4 直链，
 * 只有封面。渲染层据此决定放 <video> 还是「封面图 + 角标」—— 放一个 src 为空
 * 的 <video> 会得到一个永远转圈、点了没反应的播放器，比只显示封面糟得多。
 */
export function isPlayable(media: { type: string; videoUrl?: string }): boolean {
  if (media.type !== 'video' && media.type !== 'animated_gif') return false
  return typeof media.videoUrl === 'string' && media.videoUrl.trim() !== ''
}

/* ───────────────────────── 模型名精简 ───────────────────────── */

/**
 * 把模型路由 id 精简成**人能读的短名**（顶部副标题与弹卡都用它）。
 *
 * ── 为什么必须精简（用户原话：「太长了，把 provider 前缀暴露出来了」）──────
 * host 给的 modelUsed 是完整路由，实测形如
 *   alymagpie/auto/deepseek-v4.1-flash
 * 而同一份 /status 里还有个 modelResolved.label = 「WB-Deepseek-Flash」——
 * 那才是**供应商配的显示名**。用户要看的是「谁在写」，不是路由串。
 *
 * 三级取值，逐级更保守：
 *  1. 目录里能查到（host /models 下发的 label）→ 用 label，这是唯一「官方名字」；
 *  2. 查不到 → 去掉 provider 前缀（第一个 / 之前那段）与 `auto/` 之类的路由段，
 *     只留最后一段模型名（deepseek-v4.1-flash）；
 *  3. 连最后一段都没有 → 原样返回，宁可不精简也不编名字。
 *
 * ⚠ 精简只用于**显示**：完整 id 必须留在 title 属性里，用户 hover 能看到真值 ——
 * 否则「名字对不上路由」时无从核对。
 */
export function shortModelName(raw: string, catalog?: FeedModelCatalog | null): string {
  const id = raw.trim()
  if (id === '') return ''
  // ① 目录里有 → 用官方 label（同名的已带供应商，由 api.ts 拼好）
  const hit = catalog?.models.find((option) => option.id === id)
  if (hit !== undefined && hit.label !== '') return hit.label
  // ② 去掉路由前缀，只留最后一段模型名
  const parts = id.split('/').filter((part) => part !== '')
  const tail = parts.length === 0 ? '' : parts[parts.length - 1]
  return tail === '' ? id : tail
}

/* ───────────────────────── 左栏频道筛选 ───────────────────────── */

/** 左栏最多显示多少个主题频道（不含「全部动态」「我的动态」两项固定频道）。 */
export const MAX_TOPIC_CHANNELS = 6

/**
 * 主题频道的一个候选项（host 从 topics 里长出来的，数量不可控）。
 */
export interface TopicChannel {
  readonly id: string
  readonly name: string
  readonly count: number
}

/**
 * 从全部主题里挑出**左栏该显示的那几个**。
 *
 * ── 为什么必须挑（用户截图实测：13+ 个频道把左栏变成一长串标签）──────
 * topics 是模型每轮现写的（出海 / 监管 / ai / 合规 / 开源 / 许可证 / 美国 /
 * 商业 / 投资 / 融资 / 开源许可 / tech / 大模型 …），数量随轮次增加、上限不可控。
 * 全摊在左栏的直接后果是：频道列表比动态本身还长，滚动条一屏都是标签，
 * 而且大量频道只有 1 条动态（点进去就是孤零零一条）。
 *
 * 判据两条，按优先级：
 *  1. **只留 ≥2 条的**：1 条的主题不值得占一个导航位（点进去没有「频道感」）；
 *  2. **最多 MAX_TOPIC_CHANNELS 个**，按动态数降序（多的在前，那是真正的主线）。
 *
 * ⚠ 有一个必须兜住的例外：**当前选中的频道即使不满足上面两条也要保留**。
 * 否则用户点进一个只有 1 条的主题后，那个频道突然从左栏消失 —— 选中态悬空，
 * 看起来像「点了却被踢回全部」，而且再也切不回去。
 *
 * @param topics - 全部主题（含 count），顺序不敏感
 * @param active - 当前选中的频道 id（不在主题里就传空串）
 */
export function pickTopicChannels(
  topics: readonly TopicChannel[],
  active: string,
): TopicChannel[] {
  const byCount = [...topics].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const picked = byCount.filter((item) => item.count >= 2).slice(0, MAX_TOPIC_CHANNELS)
  // 当前选中的那个必须留在列表里（哪怕只有 1 条、哪怕被挤出前 N 个）
  if (active !== '' && !picked.some((item) => item.id === active)) {
    const hit = byCount.find((item) => item.id === active)
    if (hit !== undefined) picked.push(hit)
  }
  return picked
}
