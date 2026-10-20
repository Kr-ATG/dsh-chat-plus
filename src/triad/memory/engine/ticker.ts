/**
 * dsh-memory 调度器：三个触发点（design §5.3）。
 * 1. 每 N 轮（默认 10）增量编译 timeline；
 * 2. 会话结束（turn/end 后 debounce 静默期）final 编译；
 * 3. 每日一次：全量衰减 → 短期折叠进长期 → 低分滚出 → daily 日志落盘 → 产物重编译。
 * 并发安全：所有写入经同一个串行队列（内存锁）执行。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryConfig } from '../types.js'
import { compileAll, promoteEntries, writeDailyLog } from './compile.js'
import { consolidateAll } from './consolidate.js'
import { decayImportance, daysSince, shouldEvict } from './scoring.js'
import {
  localDate,
  summarize,
  type MemoryStore,
} from './store.js'

/** 会话结束判定静默期（毫秒）。 */
const SESSION_END_DEBOUNCE_MS = 15_000

/** 每日检查定时器间隔（毫秒，仅兜底；正常由 turn/end 驱动）。 */
const DAILY_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * 每日编译失败后的重试退避（毫秒）。
 *
 * 为什么需要：lastDailyDate 改成「全部成功后记账」之后，失败的当天会在**每次**
 * turn/end 重新触发整轮每日编译（其中 LLM 整理最长 300s）。若整理持续失败
 * （模型超时/路由拿不到模型），每个回合结束都会把串行写队列堵上几分钟，会话
 * 表现为卡死——比原来的「当天不重试」更糟。退避 10 分钟既保住「当天还能重试」，
 * 又不会让失败变成风暴（一小时兜底检查仍会再来一次）。
 */
const DAILY_RETRY_BACKOFF_MS = 10 * 60 * 1000

/** 从 store 读的 Agent 最小面（id 即可，供调度去重）。 */
export interface TickerAgent {
  readonly id: string
}

/**
 * 创建 ticker。返回 { onTurnEnd, enqueue, dispose }。
 * onTurnEnd 由 session/event 的 turn/end 分支调用；enqueue 供提取等写操作
 * 共用同一条串行队列（内存锁：避免 ticker 与捕获并发读写同一 store）。
 */
export function createTicker(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
): { onTurnEnd: (sessionId: string, agent: TickerAgent) => Promise<void>; enqueue: <T>(task: () => Promise<T>) => Promise<T>; dispose: () => void } {
  // 串行写队列（内存锁：ticker 与 turn/end 捕获共用同一 store 实例，串行化避免同日多写竞争）。
  let queue: Promise<void> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  /**
   * 后台任务的统一失败出口。stage 用于在 error.log 里定位来源（daily-check / final-compile）。
   *
   * 必须同时落盘：enqueueSafe 的任务全部由定时器触发，没有任何调用方在等结果，
   * 而 DSH 控制台的 warn 只进内存不落盘——只 warn 等于静默失败（实测 error.log
   * 只有 610B，而 consolidate.log 22KB，异步故障全被吞了）。落盘自身失败不能再抛，
   * 否则会在 catch 里制造新的未处理 rejection。
   */
  const enqueueSafe = (task: () => Promise<void>, stage = 'ticker'): void => {
    enqueue(task).catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.(`[dsh-memory] ${stage} failed: ${message}`)
      void store.appendErrorLog(stage, message).catch(() => undefined)
    })
  }

  /** 每会话的 final 编译 debounce 计时器。 */
  const sessionEndTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** 每日编译失败后的重试截止时间戳（0 = 无退避）。 */
  let dailyRetryNotBefore = 0

  /**
   * 每日编译（幂等：同日重复调用直接返回）。
   *
   * 记账顺序：lastDailyDate 只在**全部步骤成功后**才写（见函数末尾）。
   * 旧实现开工前就把今天写进 state，于是任何一步抛错（LLM 超时 / 磁盘 EPERM /
   * 产物写失败）都会让当天彻底不再重试——表现就是「记忆一整天不更新」，要等
   * 第二天才自愈。改成失败不记账后，下一次 turn/end 或整点兜底检查会自动重跑。
   */
  async function runDailyCompile(): Promise<void> {
    const today = localDate()
    const state = await store.readState()
    const last = state.lastDailyDate
    // 幂等闸门必须留在最前面：衰减是乘法的，同一天跑两遍等于多衰减一天。
    if (last === today) return
    // 失败退避窗口内不重跑（理由见 DAILY_RETRY_BACKOFF_MS）。
    if (Date.now() < dailyRetryNotBefore) return

    const days = last === null ? 1 : Math.max(1, Math.floor((Date.parse(today) - Date.parse(last)) / 86_400_000))

    try {
      // 1-4) 衰减 → 折叠 → 滚出 → 闲置清理 → 原子写回（走 store 写队列，
      // 避免与提取/裁决并发覆盖）。deprecated 条目（软废弃）不参与生命周期规则：
      // 不衰减、不晋升、不滚出、不按天清理（保留数据与状态）——但它会参与
      // entryLimit 的预算淘汰，见下方「预算治理」处的说明。
      let promoted: Array<import('../types.ts').MemoryEntry> = []
      let evicted: Array<import('../types.ts').MemoryEntry> = []
      let pruned: Array<import('../types.ts').MemoryEntry> = []
      /** 回收站满保留期被硬删的条目（变更流单独记一条，面板可追溯）。 */
      let purged: Array<import('../types.ts').MemoryEntry> = []
      await store.replaceEntries(entries => {
        const live: Array<import('../types.ts').MemoryEntry> = []
        // frozen（回收站）必须可变：满保留期的条目要从中移出并硬删。
        let frozen: Array<import('../types.ts').MemoryEntry> = []
        // 待确认（pending）单独一桶，与回收站同等待遇：不衰减、不晋升、不按价值
        // 滚出、不按闲置清理。理由是它从未生效过——用生命周期规则去处理「还没有
        // 开始生命周期」的东西，只会让用户刚看到待确认列表就发现它已经被自动删了。
        // 它有自己的出路：超期清理（pendingRetentionDays）与预算淘汰。
        const pendingBucket: Array<import('../types.ts').MemoryEntry> = []
        for (const entry of entries) {
          if (entry.deprecated === true) frozen.push(entry)
          else if (entry.pending === true) pendingBucket.push(entry)
          else live.push(entry)
        }
        const decayed = live.map(entry => ({
          ...entry,
          importance: decayImportance(entry.importance, days, config.decayLambda),
        }))
        const result = promoteEntries(decayed, config.compileThreshold)
        promoted = result.promoted
        const kept: typeof result.remaining = []
        evicted = []
        for (const entry of result.remaining) {
          // 门槛用 minImportanceForPrune（闲置清理的同一门槛）而不是 compileThreshold：
          // compileThreshold/2 = 2.25 时，初始 8 分的条目衰减 60 天还有 2.39，永远滚不出去，
          // 这条「按价值删」的规则等于空转。与闲置清理共用门槛，两条规则才在同一量级。
          if (shouldEvict(entry, config.compileThreshold, config.minImportanceForPrune)) evicted.push(entry)
          else kept.push(entry)
        }
        // 闲置清理：自动提取条目按「最后活跃时间」清理——最后命中时间（从未
        // 命中则用创建时间）距今满 N 天即删除。这样「命中过一次就永远躺着」的
        // 条目也会被清；置顶 / 已确认 / 手动 / 禁用豁免（用户显式意图、价值确认、
        // 主动创建、显式冻结），不参与自动清理。
        pruned = []
        if (config.pruneNeverHitDays > 0) {
          pruned = kept.filter(entry => {
            if (entry.source !== 'extract') return false
            if (entry.pinned === true || entry.verified === true || entry.disabled === true) return false
            // 分数门槛：注入每会话只做一次、top-k 实测 6 条，绝大多数条目在 N 天内
            // 根本没机会被命中——只看「多久没命中」等于按概率删记忆。高价值条目
            // 交给 shouldEvict（60 天 + 分数双阈值）判定，两条规则的严格程度才对齐。
            if (entry.importance >= config.minImportanceForPrune) return false
            // 长期层是「经时间检验」的沉淀，不该因为最近没人读到就被按天清掉。
            if (entry.layer === 'long') return false
            const idleSince = entry.lastHitAt ?? entry.createdAt
            return daysSince(idleSince) >= config.pruneNeverHitDays
          })
        }
        // 回收站出清：软废弃条目满 deprecatedRetentionDays 天后硬删。
        //
        // 为什么不能只靠 entryLimit：它是压力驱动的（只在超过 entryLimit 时动手），
        // 而实测库只有 134 条 —— 回收站会「只进不出」永久占位（27 条 / 20%）。
        // 也不该因为「曾经 pin 过」永久豁免：pin 的语义是「这条活跃记忆很重要」，
        // 软废弃已经宣告它退出活跃集，历史 pin 标记不该变成永久居留权。
        //
        // 与 entryLimit 淘汰的分工：这里按「时间」出清（无论库多大都生效），
        // entryLimit 按「压力」出清（库紧张时优先牺牲回收站）。两者互补。
        if (config.deprecatedRetentionDays > 0) {
          // 已被后继取代的条目用更短的保留期：内容已完整继承到活跃条目
          // （supersededBy 指向的那条就在库里），留着只为「revise 改错了能
          // 翻回旧文本」，那是小时级需求。实测回收站 27 条里 18 条属于这类。
          const supersededKeep = config.supersededRetentionDays > 0
            ? config.supersededRetentionDays
            : config.deprecatedRetentionDays
          const dead = new Set<string>()
          for (const entry of frozen) {
            // 缺 deprecatedAt 的老数据用 updatedAt 兜底：软废弃时 store 会刷
            // updatedAt，拿不到时间就按「刚废弃」算 —— 宁可晚清也不要误删。
            const age = daysSince(entry.deprecatedAt ?? entry.updatedAt)
            const keepDays = entry.supersededBy !== undefined ? supersededKeep : config.deprecatedRetentionDays
            if (age >= keepDays) dead.add(entry.id)
          }
          if (dead.size > 0) {
            for (const entry of frozen) {
              if (dead.has(entry.id)) purged.push(entry)
            }
            frozen = frozen.filter(entry => !dead.has(entry.id))
          }
        }
        // 待确认超期清理：自动抽取挂 pending 后用户一直没处置 → 硬删。
        // pending 不注入也不检索，但它占条目配额、拖慢全量扫描、把「待确认」页签
        // 堆成垃圾场。0 = 不自动清理（全部留待人工），默认 14 天。
        if (config.pendingRetentionDays > 0) {
          const expiredIds = new Set<string>()
          for (const entry of pendingBucket) {
            // pendingAt 缺省用 updatedAt 兜底：老数据或手工构造的条目可能没有它。
            const age = daysSince(entry.pendingAt ?? entry.updatedAt)
            if (age >= config.pendingRetentionDays) expiredIds.add(entry.id)
          }
          if (expiredIds.size > 0) {
            for (const entry of pendingBucket) {
              if (expiredIds.has(entry.id)) purged.push(entry)
            }
            for (let i = pendingBucket.length - 1; i >= 0; i -= 1) {
              if (expiredIds.has(pendingBucket[i].id)) pendingBucket.splice(i, 1)
            }
          }
        }
        const prunedIds = new Set(pruned.map(entry => entry.id))
        const survivor = [...promoted, ...kept.filter(entry => !prunedIds.has(entry.id)), ...pendingBucket, ...frozen]
        // 预算治理：条目数超上限时淘汰低分条目（pinned 豁免，用户显式置顶）。
        //
        // deprecated 条目在这里**参与淘汰**（旧实现把它整体排除，于是回收站
        // 在 entryLimit 这一层也永远不出去）。淘汰顺序让它最先出局：它在注入 /
        // 检索 / 产物编译里已被全链路排除，只剩「可恢复性」一个价值，而
        // entryLimit 是压力驱动的预算治理 —— 库紧张时先牺牲回收站最合理。
        //
        // 注意它与上面「回收站出清」的分工：那条按时间（满 deprecatedRetentionDays
        // 天硬删，无论库多大都生效），这条按压力（超 entryLimit 时优先出局）。
        // 只有这条的话，库不超限就永远不清；只有那条的话，库爆了也要等满天数。
        let finalSurvivor = survivor
        if (finalSurvivor.length > config.entryLimit) {
          const overflow = finalSurvivor
            .filter(entry => !entry.pinned)
            .sort((a, b) => {
              // 出局优先级：回收站 → 待确认 → 其余。
              // 待确认排在回收站之后、活跃条目之前：它从未进过任何上下文，留着只占
              // 配额；但它比回收站多一个可能性（用户还没看过），所以排在回收站后面。
              const rank = (entry: import('../types.ts').MemoryEntry): number => {
                if (entry.deprecated === true) return 0
                if (entry.pending === true) return 1
                return 2
              }
              if (rank(a) !== rank(b)) return rank(a) - rank(b)
              return (a.importance - b.importance) || a.updatedAt.localeCompare(b.updatedAt)
            })
            .slice(0, finalSurvivor.length - config.entryLimit)
          const overflowIds = new Set(overflow.map(entry => entry.id))
          evicted.push(...overflow)
          finalSurvivor = finalSurvivor.filter(entry => !overflowIds.has(entry.id))
        }
        return finalSurvivor
      })

      // 4) 变更流。
      for (const entry of purged) {
        await store.appendChange({
          action: 'delete',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: entry.pending === true
            ? `待确认超 ${config.pendingRetentionDays} 天未处置清出：${summarize(entry.content)}`
            : entry.supersededBy !== undefined
              ? `已被后继取代满 ${config.supersededRetentionDays} 天出清：${summarize(entry.content)}`
              : `回收站满 ${config.deprecatedRetentionDays} 天出清：${summarize(entry.content)}`,
        })
      }
      for (const entry of promoted) {
        await store.appendChange({
          action: 'promote',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: summarize(entry.content),
        })
      }
      for (const entry of evicted) {
        await store.appendChange({
          action: 'delete',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: entry.deprecated === true
            ? `回收站条目超出条目上限清出：${summarize(entry.content)}`
            : `低分条目滚出：${summarize(entry.content)}`,
        })
      }
      for (const entry of pruned) {
        await store.appendChange({
          action: 'delete',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: `闲置 ${config.pruneNeverHitDays} 天自动清理：${summarize(entry.content)}`,
        })
      }

      // 5) 产物重编译 + daily 日志。
      await compileAll(store, config)
      await writeDailyLog(store)
      ctx.logger?.debug?.(`[dsh-memory] daily compile done (promoted=${promoted.length}, evicted=${evicted.length}, pruned=${pruned.length})`)

      // 6) LLM 语义整理（Memory Dream）：合并去重 / 精炼重写 / 删除 / 提升长期。
      //    与规则整理正交：规则处理「分数」，本步处理「语义」。失败不阻塞（内部吞错）。
      if (config.consolidateEnabled) {
        const results = await consolidateAll(ctx, store, config, 'daily')
        const changed = results.reduce((sum, result) => sum + result.changed, 0)
        if (changed > 0) {
          ctx.logger?.debug?.(`[dsh-memory] daily consolidate done (scopes=${results.length}, changed=${changed})`)
        }
      }

      // 7) 全部步骤成功后才记账。重新读一次 state 而不是复用开头的副本：中间隔着
      //    若干 await（LLM 整理可能跑几分钟），期间 turn/end 会写 perSession 轮数，
      //    用旧副本整份写回会把这些计数覆盖回去。
      const done = await store.readState()
      done.lastDailyDate = today
      await store.writeState(done)
    } catch (error) {
      // 失败不记账（当天可重试），但要开退避窗口，避免每个 turn/end 都重跑一次
      // 几分钟的整理把会话堵死。
      dailyRetryNotBefore = Date.now() + DAILY_RETRY_BACKOFF_MS
      throw error
    }
  }

  /** 每 N 轮增量编译（timeline 重写）。 */
  async function runTurnCompile(sessionId: string, turnCount: number): Promise<void> {
    if (turnCount % config.compileEveryTurns !== 0) return
    await compileAll(store, config)
    ctx.logger?.debug?.(`[dsh-memory] incremental compile (session=${sessionId}, turns=${turnCount})`)
  }

  /** 会话结束 final 编译（debounce）。 */
  function scheduleSessionEnd(sessionId: string): void {
    const existing = sessionEndTimers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      sessionEndTimers.delete(sessionId)
      enqueueSafe(async () => {
        await compileAll(store, config)
        await writeDailyLog(store)
        ctx.logger?.debug?.(`[dsh-memory] final compile (session=${sessionId})`)
      }, 'final-compile')
    }, SESSION_END_DEBOUNCE_MS)
    sessionEndTimers.set(sessionId, timer)
  }

  /** turn/end 统一入口（返回排队任务的 promise，供调用方串行衔接）。 */
  function onTurnEnd(sessionId: string, _agent: TickerAgent): Promise<void> {
    const result = enqueue(async () => {
      const state = await store.readState()
      // 只补 turnCount：SessionTickerState 的其它字段（extractFailStreak /
      // extractEmptyStreak）都是可选，缺省由读取方按 0 处理。
      const per = state.perSession[sessionId] ?? { turnCount: 0 }
      per.turnCount += 1
      state.perSession[sessionId] = per

      // 日期切换 → 每日编译。
      const today = localDate()
      if (state.lastDailyDate !== today) {
        await store.writeState(state)
        if (config.dailyCompileEnabled) await runDailyCompile()
      } else {
        await store.writeState(state)
      }

      // 每 N 轮增量编译。
      await runTurnCompile(sessionId, per.turnCount)
    })
    scheduleSessionEnd(sessionId)
    return result
  }

  // 兜底每日检查（每小时；正常情况 turn/end 已驱动）。
  const timerService = ctx.get('timer')
  const checkInterval = timerService?.interval(() => {
    enqueueSafe(async () => {
      const state = await store.readState()
      const today = localDate()
      if (state.lastDailyDate !== today && config.dailyCompileEnabled) {
        await runDailyCompile()
      }
    }, 'daily-check')
  }, DAILY_CHECK_INTERVAL_MS)

  function dispose(): void {
    if (typeof checkInterval === 'function') checkInterval()
    for (const timer of sessionEndTimers.values()) clearTimeout(timer)
    sessionEndTimers.clear()
  }

  return { onTurnEnd, enqueue, dispose }
}
