/**
 * dsh-memory 记忆巩固引擎（Memory Dream，openhanako 同款）：
 * 每天（或手动触发）用 LLM 对某一 scope 的记忆做「语义化整理」——
 * 合并近重复/强相关条目、精炼重写、删除过时/低价值、提升长期。
 * 与现有每日「规则化」衰减/折叠/滚出（ticker.runDailyCompile）正交叠加：
 * 规则处理「分数」，本引擎处理「语义」。
 *
 * 安全设计：
 * - 输入排除 pinned（保护用户明确标记的条目），apply 时再按 id 锚定防误删；
 * - 整理前写入 revisions 快照，支持一键回滚；
 * - LLM 失败/超时/解析失败一律空结果，绝不阻塞每日编译。
 */

import { BlockAssembler, createUserMessage } from '../../../vendor/dsh-llm/index.js'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ChangeRecord,
  ConsolidateOp,
  ConsolidateResult,
  MemoryConfig,
  MemoryEntry,
} from '../types.js'
import { compileAll, writeDailyLog } from './compile.js'
import { isSensitiveContent, resolveRoute, type MinimalAgent } from './extract.js'
import { entryIdOf, nowIso, summarize, type MemoryStore } from './store.js'

/** 整理用伪 agent：无显式 provider/model，resolveRoute 回退默认模型。 */
const CONSOLIDATE_AGENT: MinimalAgent = {
  id: 'dsh-memory-consolidate',
  options: {},
  session: { id: '', header: undefined },
}

/**
 * 整理操作类型：权威定义在 types.ts（含 conflict / keepId），此处只做转出。
 *
 * 曾经在本文件重复定义过一份（并行改动时避免跨组改同一文件）。两份定义一旦
 * 漂移，就会出现「parse 产出带 conflict 的对象、消费方按旧联合类型处理」的
 * 静默错配，所以收归一处。
 */
export type { ConsolidateOp } from '../types.js'

/** 整理范围：global 层，或某个 project。 */
export type ConsolidateScope = 'global' | { projectHash: string }

/** 范围显示标签（revision / 结果用）。 */
function scopeLabel(scope: ConsolidateScope): string {
  return scope === 'global' ? 'global' : `project:${scope.projectHash}`
}

/** 整理统计（内部）。 */
interface ConsolidateStats {
  merged: number
  rewritten: number
  dropped: number
  promoted: number
}

/**
 * 单个 scope 的整理：读 → 选集合 → LLM 决策 → 备份 → 应用 → 重编译。
 * @returns 统计结果；无变更/失败时 changed=0。
 *
 * 诊断：每个早退路径都会落盘一行到 log/consolidate.log（appendConsolidateLog）。
 * 此前这些路径全部静默返回——「LLM 判定无需整理」与「拿不到模型路由」在
 * 磁盘上完全无法区分，只能靠猜。日志为 fire-and-forget，绝不影响主流程。
 */
export async function consolidateScope(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
  scope: ConsolidateScope,
  trigger: 'daily' | 'manual',
): Promise<ConsolidateResult> {
  const label = scopeLabel(scope)
  const empty: ConsolidateResult = { scope: label, merged: 0, rewritten: 0, dropped: 0, promoted: 0, changed: 0 }
  const log = (message: string): void => {
    void store.appendConsolidateLog(`[${trigger}] ${label}: ${message}`).catch(() => undefined)
  }
  if (!config.consolidateEnabled) {
    log('skip (consolidate disabled in config)')
    return empty
  }

  const all = await store.readEntries()
  let owned = all.filter(entry => scope === 'global'
    ? entry.scope === 'global'
    : entry.scope === 'project' && entry.projectHash === scope.projectHash)
  // 排除 pinned 与 disabled：用户明确标记的条目绝不被自动合并/删除/重写；
  // 禁用条目处于「冻结」状态（不注入、不编译、不参与整理），同样跳过。
  // deprecated 条目（软废弃）已退出活跃生命周期，不参与整理。
  // pending 条目（待确认）同理：它还没被用户认可，自动整理器没有资格替它做
  // 合并/重写/删除——那等于让机器替用户决定他还没看过的内容。
  owned = owned.filter(entry => !entry.pinned && entry.disabled !== true && entry.deprecated !== true && entry.pending !== true)
  owned = selectConsolidationSet(owned, config.consolidateMaxEntries)
  // 至少 2 条才有语义整理空间（单条重写/提升由规则层处理）。
  if (owned.length < 2) {
    log(`skip (owned=${owned.length} after pinned/disabled/deprecated filter, need >= 2)`)
    return empty
  }

  const llm = ctx.get('llm')
  if (llm === undefined) {
    log('skip (llm service not available on context)')
    return { ...empty, failed: 'LLM 服务不可用' }
  }
  // 整理专用模型优先（config.consolidateProvider/Model 成对配置时）；
  // 未配置则回退默认模型（agentDefaultModel）。
  let route: { provider: string; model: string } | undefined
  if (config.consolidateProvider !== undefined && config.consolidateModel !== undefined
    && config.consolidateProvider !== '' && config.consolidateModel !== '') {
    route = { provider: config.consolidateProvider, model: config.consolidateModel }
    log(`use dedicated model ${route.provider}/${route.model}`)
  } else {
    route = await resolveRoute(ctx, CONSOLIDATE_AGENT)
  }
  if (route === undefined) {
    log('skip (no LLM route: agentDefaultModel.currentSelection() returned empty; agent options are unset)')
    return { ...empty, failed: '未配置默认模型（agentDefaultModel 无选择）' }
  }
  log(`start owned=${owned.length} route=${route.provider}/${route.model}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.consolidateTimeoutMs)
  try {
    const options = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: consolidateUserPrompt(owned) }],
        source: { kind: 'plugin:dsh-memory', plugin: 'dsh-memory' },
      })],
      system: consolidateSystemPrompt(),
      // 4096 对「20 条输入 + 逐条推理再给 JSON」偏紧：推理模型的 reasoning 也吃
      // 这份预算，截断后 JSON 不完整，整轮整理会白跑并报「无需整理」。翻倍到 8192。
      maxTokens: 8192,
      signal: controller.signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind !== 'stop') {
      log(`abort (finish=${finish.kind})`)
      return { ...empty, failed: `模型输出异常中断（finish=${finish.kind}），可能是超时或输出截断` }
    }
    const text = assembler.blocks()
      .filter(block => block.type === 'text' || block.type === 'reasoning')
      .map(block => (block as { text?: string }).text ?? '')
      .join(' ')
    const ops = parseConsolidateOutput(text)
    if (ops.length === 0) {
      log('noop (llm returned 0 valid ops)')
      return empty
    }

    // 整理前备份（回滚锚点）。
    await store.writeRevision({ entries: all, scope: label, trigger })

    // 按 id 锚定应用（走 store 写串行队列，防并发覆盖）。
    let stats: ConsolidateStats = { merged: 0, rewritten: 0, dropped: 0, promoted: 0 }
    let events: Array<Omit<ChangeRecord, 'id' | 'at'>> = []
    /** 本轮真正被整理「碰过」的条目 id（含合并源、改写目标、废弃、晋升）。 */
    let touchedIds: string[] = []
    await store.replaceEntries(current => {
      const result = applyOps(current, ops)
      stats = result.stats
      events = result.events
      touchedIds = result.touchedIds
      return result.next
    })
    // 记录轮转时间戳：选集合按 lastConsolidatedAt 升序取（见 selectConsolidationSet），
    // 不打这个戳的话，刚整理过的条目会永远排在最前，老条目一辈子轮不到。
    // 合并源条目已被移除、写入会被忽略，这里一并传进去无害；日志写不进去也不影响整理结果。
    if (touchedIds.length > 0) {
      await store.markConsolidated(touchedIds).catch((error: unknown) => {
        log(`markConsolidated failed (rotation timestamps not persisted): ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    // 变更流（驱动面板「变更」tab 与 daily 日志）。
    for (const event of events) await store.appendChange(event)
    // 整理汇总记录：变更 Tab 里一条「整理」徽标即可看到本次结果
    //（合并/改写/废弃/提升数量 + 范围），无需逐条翻合并事件。
    await store.appendChange({
      action: 'consolidate',
      entryId: '',
      scope: scope === 'global' ? 'global' : 'project',
      projectHash: scope === 'global' ? null : scope.projectHash,
      summary: `整理完成：合并 ${stats.merged} / 改写 ${stats.rewritten} / 废弃 ${stats.dropped} / 提升 ${stats.promoted}`,
    })
    await compileAll(store, config)
    await writeDailyLog(store)

    const changed = stats.merged + stats.rewritten + stats.dropped + stats.promoted
    log(`done (merged=${stats.merged}, rewritten=${stats.rewritten}, dropped=${stats.dropped}, promoted=${stats.promoted}, changed=${changed})`)
    ctx.logger?.debug?.(`[dsh-memory] consolidate ${label} done (merged=${stats.merged}, rewritten=${stats.rewritten}, dropped=${stats.dropped}, promoted=${stats.promoted})`)
    return { scope: label, ...stats, changed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`failed: ${message}`)
    ctx.logger?.debug?.(`[dsh-memory] consolidate ${label} failed: ${message}`)
    return { ...empty, failed: message }
  } finally {
    clearTimeout(timer)
  }
}

/** 整理全部 scope（global + 每个 project）。返回有变更的 scope 结果。 */
export async function consolidateAll(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
  trigger: 'daily' | 'manual',
): Promise<ConsolidateResult[]> {
  if (!config.consolidateEnabled) return []
  const entries = await store.readEntries()
  const hashes = new Set<string>()
  for (const entry of entries) {
    if (entry.scope === 'project' && entry.projectHash !== null) hashes.add(entry.projectHash)
  }
  const results: ConsolidateResult[] = []
  const globalResult = await consolidateScope(ctx, store, config, 'global', trigger)
  if (globalResult.changed > 0 || globalResult.failed !== undefined) results.push(globalResult)
  for (const hash of hashes) {
    const result = await consolidateScope(ctx, store, config, { projectHash: hash }, trigger)
    if (result.changed > 0 || result.failed !== undefined) results.push(result)
  }
  return results
}

/**
 * 应用 LLM 决策。fn 内收到的 current 是「最新」条目快照；
 * 按 id 锚定：LLM 期间新增的条目不在 ops 中，天然不受影响。
 */
function applyOps(
  entries: MemoryEntry[],
  ops: ConsolidateOp[],
): {
  next: MemoryEntry[]
  stats: ConsolidateStats
  events: Array<Omit<ChangeRecord, 'id' | 'at'>>
  /** 本轮被整理碰过的条目 id（调用方据此写 lastConsolidatedAt，驱动轮转）。 */
  touchedIds: string[]
} {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const stats: ConsolidateStats = { merged: 0, rewritten: 0, dropped: 0, promoted: 0 }
  const events: Array<Omit<ChangeRecord, 'id' | 'at'>> = []
  const removeIds = new Set<string>()
  /** 记录「整理过哪些条目」：合并产物也要记，否则新条目每轮都排最前被反复咀嚼。 */
  const touchedIds = new Set<string>()
  /** 待删条目的对象身份（配合 removeIds 兜住 rewrite 换 id 的情况）。 */
  const removeObjects = new Set<MemoryEntry>()
  const additions: MemoryEntry[] = []

  for (const op of ops) {
    switch (op.type) {
      case 'merge': {
        const sources = op.ids
          .map(id => byId.get(id))
          .filter((entry): entry is MemoryEntry => entry !== undefined)
        if (sources.length < 2) break
        const content = sanitizeContent(op.content)
        if (content === '' || isSensitiveContent(content)) break
        const scope = sources[0].scope
        const projectHash = sources[0].projectHash
        // 字段合成必须尊重源条目已有的事实，不能一律取第一条或写死默认值：
        // 旧实现写死 verified=false、source=sources[0].source、createdAt=now，
        // 把用户手写并确认过的记忆合并成「未确认的自动提取」，创建时间还被刷新成
        // 今天——合并越频繁，时间线与可信度失真越严重。
        const merged: MemoryEntry = {
          id: entryIdOf(content, scope, projectHash),
          content,
          scope,
          projectHash: scope === 'project' ? projectHash : null,
          tags: sanitizeTags(op.tags),
          pinned: false,
          // 合并条目代表这组事实最早被记录的时间点。
          createdAt: earliestIso(sources.map(source => source.createdAt)),
          updatedAt: nowIso(),
          importance: Math.max(...sources.map(source => source.importance)),
          lastHitAt: null,
          layer: sources.some(source => source.layer === 'long') ? 'long' : 'short',
          // 只要有一条是用户手写，结果就继承 manual：人工来源不该因为被自动整理
          // 碰过一次就降级成 extract。
          source: sources.some(source => source.source === 'manual') ? 'manual' : 'extract',
          version: 1,
          confidence: Math.max(...sources.map(source => source.confidence)),
          // 同理，任一条被确认过就算确认过（合并只做去重，不做降级）。
          verified: sources.some(source => source.verified),
          // 跨 kind 合并后语义已无法归入单一类型，降级为 fact；沿用第一条会把
          // preference 混进 identity 之类的分组，compile 的分段就错了。
          kind: sameKind(sources) ? sources[0].kind : 'fact',
          provenance: undefined,
          embedding: undefined,
        }
        // 合并结果与库中既有条目撞 id 时不再新增（否则出现重复 id 条目），
        // 仍然删除源条目——目标内容已经在库里。
        const clash = byId.get(merged.id)
        // 撞上的正是 sources 里某一条：LLM 把合并内容写成了源条目 A 的逐字副本。
        // 这是最常见的输出（A 已经覆盖 B 时直接照抄 A 最省事），也正是原来
        // 最危险的分支——下面两个条件都不成立，merged 既不入库、A 又被加进
        // removeIds，末尾 filter 把它一并滤掉：**两条记忆凭空消失**，变更流
        // 只留下一条指向不存在条目的「合并为」记录。
        // 正确处理：让 merged 进 additions。源条目会先被 filter 掉，末尾的
        // 「additions 按 seen 补回」再把同 id 的 merged 放回原位——内容不变，
        // 只是换成了合并后的元信息。
        const clashIsSource = clash !== undefined && sources.some(source => source.id === clash.id)
        if (clash !== undefined && clash.deprecated === true) {
          // 撞上的是被软废弃的同内容条目：复活它（内容回到活跃生命周期）。
          clash.deprecated = undefined
          clash.deprecatedAt = undefined
          clash.deprecatedReason = undefined
          clash.supersededBy = undefined
          clash.updatedAt = nowIso()
          clash.version += 1
        } else if (clash === undefined || removeIds.has(merged.id) || clashIsSource) {
          additions.push(merged)
        }
        // 合并产物同样打轮转戳：否则它带着全新的 lastConsolidatedAt=undefined，
        // 下一轮又排在最前面被反复咀嚼，正是饥饿的另一半来源。
        touchedIds.add(merged.id)
        for (const source of sources) {
          removeIds.add(source.id)
          removeObjects.add(source)
          events.push({
            action: 'delete',
            entryId: source.id,
            scope: source.scope,
            projectHash: source.projectHash,
            summary: `合并：${summarize(source.content)}`,
            before: source.content,
          })
        }
        events.push({
          action: 'add',
          entryId: merged.id,
          scope: merged.scope,
          projectHash: merged.projectHash,
          summary: `合并为：${summarize(merged.content)}`,
          after: merged.content,
        })
        stats.merged += sources.length
        break
      }
      case 'rewrite': {
        const entry = byId.get(op.ids[0])
        if (entry === undefined || entry.pinned) break
        const content = sanitizeContent(op.content)
        if (content === '' || isSensitiveContent(content) || content === entry.content) break
        // id 由 content+scope+projectHash 派生：改内容必须换 id，否则 id 与内容脱钩，
        // 后续 upsertEntry 会把同一条记忆再插一遍。撞上已有同内容条目则跳过本次改写
        // （目标内容已经存在，改写没有信息增量）。
        const nextId = entryIdOf(content, entry.scope, entry.projectHash)
        if (nextId !== entry.id && byId.has(nextId)) break
        const before = entry.content
        entry.id = nextId
        entry.content = content
        entry.tags = sanitizeTags(op.tags)
        entry.updatedAt = nowIso()
        entry.version += 1
        byId.delete(op.ids[0])
        byId.set(nextId, entry)
        events.push({
          action: 'update',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: `整理改写：${summarize(content)}`,
          before,
          after: content,
        })
        touchedIds.add(entry.id)
        touchedIds.add(op.ids[0])
        stats.rewritten += 1
        break
      }
      case 'drop': {
        // 软废弃而非硬删除（参考 opencontext：consolidate 走 soft-deprecate，
        // 数据保留可回溯；被废弃条目退出检索/注入/编译，revise 链可恢复）。
        // 不加入 removeIds/removeObjects：条目留在数组中（仅标 deprecated），
        // 只有 merge 的源条目才真正移除。
        for (const id of op.ids) {
          const entry = byId.get(id)
          if (entry === undefined || entry.pinned) continue
          if (entry.deprecated === true) continue
          entry.deprecated = true
          entry.deprecatedAt = nowIso()
          entry.deprecatedReason = 'consolidate-drop'
          entry.updatedAt = nowIso()
          entry.version += 1
          events.push({
            action: 'retire',
            entryId: entry.id,
            scope: entry.scope,
            projectHash: entry.projectHash,
            summary: `整理废弃：${summarize(entry.content)}`,
            before: entry.content,
          })
          touchedIds.add(entry.id)
          stats.dropped += 1
        }
        break
      }
      case 'promote': {
        for (const id of op.ids) {
          const entry = byId.get(id)
          if (entry === undefined || entry.layer === 'long') continue
          entry.layer = 'long'
          entry.updatedAt = nowIso()
          events.push({
            action: 'promote',
            entryId: entry.id,
            scope: entry.scope,
            projectHash: entry.projectHash,
            summary: summarize(entry.content),
          })
          touchedIds.add(entry.id)
          stats.promoted += 1
        }
        break
      }
      case 'conflict': {
        // 两条记忆内容互相矛盾时，merge 只会产出一段自相矛盾的缝合怪，
        // 后续注入时模型看到「A 对」和「A 错」同时存在，反而更容易选错。
        // 正确处理：保留较新的一条，把较旧的软废弃，并在保留者内容里追加时间线，
        // 让「曾经是 X，后来改成 Y」这段演进信息不丢失。
        const candidates = op.ids
          .map(id => byId.get(id))
          .filter((entry): entry is MemoryEntry => entry !== undefined && entry.pinned !== true)
        if (candidates.length < 2) break
        // keepId 优先（模型显式指定）；缺省按 updatedAt 较新者胜——这是「用户后来说的
        // 才算数」的保守解释，比按 importance 猜更贴近事实。updatedAt 相同则按
        // createdAt，再相同就取数组里靠后的一条（LLM 输出顺序通常旧在前）。
        const ranked = [...candidates].sort((a, b) => {
          const byUpdated = a.updatedAt.localeCompare(b.updatedAt)
          if (byUpdated !== 0) return byUpdated
          return a.createdAt.localeCompare(b.createdAt)
        })
        const keeper = candidates.find(entry => entry.id === op.keepId) ?? ranked[ranked.length - 1]!
        const losers = candidates.filter(entry => entry !== keeper && entry.deprecated !== true)
        if (losers.length === 0) break
        const keeperBefore = keeper.content
        // 时间线只追加一次：重复整理同一对矛盾条目时不再叠一层「此前记录」。
        if (!keeper.content.includes('（此前记录：')) {
          const timeline = losers
            .map(loser => `（此前记录：${loser.content}；${loser.updatedAt.slice(0, 10)} 已被更新）`)
            .join('')
          const nextContent = `${keeper.content}${timeline}`
          // 内容变了 id 必须跟着变（id 由 content 派生），否则 id 与内容脱钩，
          // 后续 upsertEntry 会把同一条记忆再插一遍。目标 id 已被别人占用时
          // 宁可不追加时间线（裁决保留/废弃已经生效），也不制造 id 与内容不一致。
          const nextId = entryIdOf(nextContent, keeper.scope, keeper.projectHash)
          if (!byId.has(nextId)) {
            byId.delete(keeper.id)
            keeper.content = nextContent
            keeper.id = nextId
            byId.set(nextId, keeper)
            keeper.updatedAt = nowIso()
            keeper.version += 1
          }
        }
        for (const loser of losers) {
          loser.deprecated = true
          loser.deprecatedAt = nowIso()
          loser.deprecatedReason = 'consolidate-conflict'
          loser.supersededBy = keeper.id
          loser.updatedAt = nowIso()
          loser.version += 1
          touchedIds.add(loser.id)
          events.push({
            action: 'retire',
            entryId: loser.id,
            scope: loser.scope,
            projectHash: loser.projectHash,
            summary: `冲突废弃（保留较新条目）：${summarize(loser.content)}`,
            before: loser.content,
          })
          stats.dropped += 1
        }
        touchedIds.add(keeper.id)
        events.push({
          action: 'update',
          entryId: keeper.id,
          scope: keeper.scope,
          projectHash: keeper.projectHash,
          summary: `冲突裁决（保留本条，时间线已并入）：${summarize(keeper.content)}`,
          before: keeperBefore,
          after: keeper.content,
        })
        break
      }
    }
  }

  // 删除按对象身份判定，而不是按 id：rewrite 会就地换 id，若后续 drop 引用旧 id，
  // 按 id 过滤会漏删（条目已改名）或误删（新 id 撞上别人）。additions 之间也要去重
  // （两次 merge 可能产出相同内容）。
  // 注意：drop 已改为软废弃（deprecated 标记 + 保留在库中），只有 merge 的
  // 源条目才真正从数组移除（其内容已并入后继条目）。
  const next = entries.filter(entry => !removeIds.has(entry.id) && !removeObjects.has(entry))
  const seen = new Set(next.map(entry => entry.id))
  for (const addition of additions) {
    if (seen.has(addition.id)) continue
    seen.add(addition.id)
    next.push(addition)
  }
  return { next, stats, events, touchedIds: [...touchedIds] }
}

/**
 * 从未被整理过的条目统一用这个时间戳兜底排序：1970 早于任何真实时间戳，
 * 于是「新入库、还没被整理过」的条目永远排在最前，先被消化。
 */
const NEVER_CONSOLIDATED_AT = '1970-01-01'

/**
 * 选整理集合：按「上次被整理的时间」升序轮转（最久没整理的最优先）。
 *
 * 为什么不能按 updatedAt 降序（旧实现）：整理自己产出的合并条目、改写条目、
 * 晋升条目都会刷新 updatedAt，于是「刚被整理过的」永远排在最前、每轮反复咀嚼，
 * 而 500 条里的老条目一辈子轮不到——整理看着在跑，实际只在那 20 条里打转。
 * 换成 lastConsolidatedAt 升序后，每个条目都会被均匀轮转一次。
 * 单轮仍然只处理 max 条（token 保护）；旧条目的过期治理仍由规则层 daily compile 负责。
 */
function selectConsolidationSet(entries: MemoryEntry[], max: number): MemoryEntry[] {
  return entries
    .sort((a, b) =>
      (a.lastConsolidatedAt ?? NEVER_CONSOLIDATED_AT).localeCompare(b.lastConsolidatedAt ?? NEVER_CONSOLIDATED_AT))
    .slice(0, max)
}

/** 整理系统 prompt：只输出结构化 ops，绝不虚构、绝不越界。 */
function consolidateSystemPrompt(): string {
  return [
    'You are a memory consolidator for an AI assistant\'s long-term memory. You receive a set of existing memory entries (each with a stable id) and reorganize them into a cleaner, less redundant set — like the brain consolidating memories during sleep.',
    'Return ONLY a JSON object in this exact shape (no markdown, no commentary):',
    '{"ops":[{"type":"merge","ids":["..."],"content":"...","tags":["..."]},{"type":"rewrite","id":"...","content":"...","tags":["..."]},{"type":"drop","ids":["..."]},{"type":"promote","ids":["..."]},{"type":"conflict","ids":["..."],"keepId":"..."}]}',
    'Rules:',
    '- "merge": combine 2+ near-duplicate or strongly-related entries into ONE concise entry. content must preserve all non-redundant facts; NEVER invent information not present in the inputs.',
    '- "rewrite": rewrite a single entry to be clearer, better worded, or better tagged. Only when it is genuinely ambiguous/redundant/poorly worded.',
    '- "drop": delete entries that are obsolete, fully superseded by a merge, or have no lasting value.',
    '- "promote": mark durable, frequently-relevant entries as long-term (ids only, no content).',
    '- "conflict": use this INSTEAD of "merge" when two entries CONTRADICT each other (same subject, mutually exclusive claims — e.g. "uses pnpm" vs "uses npm", "prefers X" vs "dislikes X"). Do NOT merge contradictions: a merged entry would assert both sides and the reader cannot tell which one still holds.',
    '  For a conflict: keep the NEWER entry (the one reflecting the user\'s later statement or later update), and list every superseded entry in ids. Set keepId to the id of the entry being kept. The pipeline soft-retires the older ones and appends a "（此前记录：…）" timeline note to the kept entry, so the evolution is not lost.',
    '- Never merge/drop/rewrite/conflict-keep across clearly different topics.',
    '- Only reference ids that appear in the input. Omit untouched entries from ops entirely (they are kept as-is by default).',
    '- Write content in the original language of the entries.',
    '- If nothing needs reorganizing, return {"ops":[]}.',
  ].join('\n')
}

/** 整理输入：只传决策所需字段，省 token。 */
function consolidateUserPrompt(entries: MemoryEntry[]): string {
  const view = entries.map(entry => ({
    id: entry.id,
    content: entry.content,
    tags: entry.tags,
    importance: entry.importance,
    layer: entry.layer,
    // 冲突条款要求「保留较新的一条」，没有时间字段模型就只能瞎猜谁新。
    // 只给到日期（10 字符）而不是完整 ISO：判断新旧够用，又不浪费 token。
    updatedAt: entry.updatedAt.slice(0, 10),
  }))
  return `Reorganize these memory entries (JSON array of {id, content, tags, importance, layer, updatedAt}):\n${JSON.stringify(view)}`
}

/** 解析 LLM 输出为 ops（容错：剥 fence / 找最外层对象 / 逐条校验）。 */
export function parseConsolidateOutput(raw: string): ConsolidateOp[] {
  let text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fence !== null) text = fence[1].trim()
  text = text.replace(/^\uFEFF/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const ops = (parsed as { ops?: unknown }).ops
  if (!Array.isArray(ops)) return []
  const out: ConsolidateOp[] = []
  for (const item of ops) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const type = record.type
    if (type !== 'merge' && type !== 'rewrite' && type !== 'drop' && type !== 'promote' && type !== 'conflict') continue
    const ids = Array.isArray(record.ids)
      ? record.ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim())
      : (typeof record.id === 'string' ? [record.id.trim()] : [])
    if (ids.length === 0) continue
    const op: ConsolidateOp = { type, ids: [...new Set(ids)] }
    if (type === 'merge' || type === 'rewrite') {
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      if (content === '') continue
      op.content = content
      op.tags = sanitizeTags(record.tags)
    }
    if (type === 'conflict') {
      // keepId 是可选的：模型没给时 applyOps 会按 updatedAt 兜底裁决，
      // 但给了就必须是 ids 里的成员，否则丢弃（防模型编造 id 造成越界）。
      const keepId = typeof record.keepId === 'string' ? record.keepId.trim() : ''
      if (keepId !== '' && op.ids.includes(keepId)) op.keepId = keepId
    }
    out.push(op)
  }
  return out
}

function sanitizeContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
    : []
}

/** 取一组 ISO 时间戳里最早的一个（合并条目沿用这组事实最初的记录时间）。 */
function earliestIso(stamps: string[]): string {
  let earliest = ''
  let earliestMs = Number.POSITIVE_INFINITY
  for (const stamp of stamps) {
    if (typeof stamp !== 'string' || stamp === '') continue
    // 按解析后的时间比较而不是字符串比较：历史数据里可能混有带本地时区偏移的
    // ISO 串，字符串序会把 +08:00 的早时刻排到 Z 结尾的晚时刻之后。
    const ms = Date.parse(stamp)
    if (!Number.isFinite(ms)) continue
    if (ms < earliestMs) {
      earliestMs = ms
      earliest = stamp
    }
  }
  return earliest === '' ? nowIso() : earliest
}

/** 所有源条目 kind 是否一致（跨类型合并要降级为 fact）。 */
function sameKind(sources: MemoryEntry[]): boolean {
  const first = sources[0]?.kind
  return sources.every(source => source.kind === first)
}
