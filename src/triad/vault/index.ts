/**
 * dsh-vault 插件入口（host half）：结构化个人档案库。
 *
 * 挂载：
 *  - agent/pre-step       → 档案索引注入（prepend，跑在记忆库两道闸门之前）
 *  - session/event        → turn/end 捕获本轮对话 → 关键词预筛 → LLM 抽取 → 入库
 *  - agent/disposed / compaction → 清会话级注入状态（压缩后重新注入）
 *  - tools                → vault_search / vault_get / vault_remember
 *  - webServer            → /api/dsh-vault/*（页面数据 + 明文查看 + 导入导出）
 *  - 定时维护             → 每日快照 + 孤儿清理 + 配额淘汰
 *
 * ── 与记忆库的三条刻意差异 ──────────────────────────────────────────
 *  1. **不受工作区开关管辖**。记忆库有 autoMemory / injectExcluded 两道闸门，
 *     档案有自己的一套（autoRecord / autoInject），默认全开。用户明确要求
 *     「不管工作区是否关闭自动记忆与注入记忆，都会自动记录并自动注入」。
 *  2. **敏感值加密落盘、绝不进上下文**。见 types.ts 的模块头。
 *  3. **字段级就地更新**而不是追加句子。「密码从 A 变成 B」在档案里是一次
 *     patchField + 一行历史，不是一个新条目。
 *
 * ── 装配隔离 ────────────────────────────────────────────────────────
 * 整块包 try/catch，且每个子模块（注入 / 抽取 / 工具 / 路由 / 维护）各自独立：
 * 档案面挂了只该「档案不可用」，绝不能把对话本身带走。
 */

import { mountVaultRoutes } from './api.js'
import { VaultCipher } from './crypto.js'
import { applyVaultOps, extractVaultOps, transcriptOfEventsVault, type VaultLlmContext } from './extract.js'
import { VaultInjector } from './inject.js'
import { VaultStore, resolveVaultConfig } from './store.js'
import { VaultSync } from './sync.js'
import { registerVaultTools } from './tools.js'
import type { VaultConfig } from './types.js'

/** Stable Cordis plugin name fragment。 */
export const name = 'dsh-vault'

/**
 * 本模块用到的 ctx 面（**刻意收窄**，与 mail/context.ts 同策略）。
 *
 * 理由：`@deepseek-ai/cordis` 的类型垫片对 `agent/pre-step` / `session/event`
 * / `tools` 都没有声明，直接用宽类型 `Context` 会在 typecheck 里报一串假错
 * （记忆库那边就背着这类噪音）。这里只声明真正用到的几样，形状与真实
 * cordis 一致；运行时仍由主插件的 inject 保证这些 service 存在。
 */
interface VaultLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  debug?: (message: string) => void
}

interface VaultHostContext extends VaultLlmContext {
  logger?: VaultLogger
  effect(fn: () => void | (() => void), label?: string): void
  on(event: string, listener: (...args: never[]) => void, options?: { prepend?: boolean }): void
}

/** 一轮对话的事件缓冲（与记忆库同款：只在 turn/start 到 turn/end 之间有内容）。 */
type TurnEvent = { type: string; data: unknown }

/** 最小 agent 面。 */
interface LiveAgent {
  readonly id: string
  readonly options: { provider?: string; model?: string }
  readonly session: {
    readonly id: string
    readonly header?: { cwd?: string }
  }
}

/**
 * 装配档案模块。
 * @param ctx 主插件上下文（已合并 inject）。
 * @param input cordis.patch.yml 传入的配置覆盖（可缺省）。
 */
export async function applyVault(ctx: VaultHostContext, input?: Partial<VaultConfig>): Promise<void> {
  // 密钥与 store 必须一起建：store 的构造要 cipher，而 cipher 的路径来自 store
  // 的 keyFile。这里先算出根目录再建 cipher，最后把 cipher 交给 store。
  const probe = new VaultStore(null)
  const cipher = await VaultCipher.load(probe.keyFile)
  if (cipher === null) {
    ctx.logger?.warn?.('[dsh-vault] 密钥不可用，敏感字段将以明文落盘（仅本次运行）')
  }
  const store = new VaultStore(cipher)
  // 配置优先级：默认值 < config.json（面板改的）< cordis.patch.yml（代码级）。
  const persisted = await store.readConfigOverride()
  const config = resolveVaultConfig(input, persisted)
  const log = (stage: string, error: unknown): void => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    ctx.logger?.warn?.(`[dsh-vault] ${stage}: ${message}`)
  }

  // ── 注入（prepend：必须跑在记忆库两道闸门之前）──────────────────────
  const injector = new VaultInjector(store, config, ctx.logger)
  try {
    ctx.on('agent/pre-step', ((
      payload: { agent: LiveAgent; messages: unknown[]; signal: AbortSignal },
      next: () => Promise<{ kind: 'enter'; messages: unknown[] } | { kind: 'reject' }>,
    ) => injector.preStepListener(payload, next)) as never, { prepend: true })
    ctx.on('agent/disposed', ({ agent }: { agent: LiveAgent }) => {
      injector.disposeSession(agent.session.id)
    })
  } catch (error) {
    log('inject mount', error)
  }

  // ── 模型工具 ─────────────────────────────────────────────────────────
  try {
    const toolsDispose = registerVaultTools(ctx as never, store, config)
    ctx.effect(() => toolsDispose, 'dsh-vault: tools')
  } catch (error) {
    log('tools mount', error)
  }

  // ── 云端同步（每 N 小时把加密包推到 GitHub 私库）──────────────────────
  //
  // 没有 cipher 时**不建** sync：它要加密保存访问令牌与口令，而「没有密钥就
  // 落明文」这条捷径在这里绝对不能走。此时路由回 503，页面显示不可用。
  let sync: VaultSync | null = null
  try {
    if (cipher !== null) {
      sync = new VaultSync(store, cipher, ctx.logger ?? {})
      sync.start()
      ctx.effect(() => () => { sync?.stop() }, 'dsh-vault: sync timer')
    } else {
      ctx.logger?.warn?.('[dsh-vault] 无加密密钥，云端同步不可用')
    }
  } catch (error) {
    log('sync mount', error)
  }

  // ── HTTP 路由 ────────────────────────────────────────────────────────
  try {
    const routesDispose = mountVaultRoutes(ctx as never, store, config, sync)
    ctx.effect(() => routesDispose, 'dsh-vault: routes')
  } catch (error) {
    log('routes mount', error)
  }

  // ── turn/end 捕获 → 抽取 ─────────────────────────────────────────────
  const turnBuffers = new Map<string, TurnEvent[]>()
  /** 串行队列：抽取与写库互斥，避免两轮同时写入把 vault.json 覆盖。 */
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error) => log('extract queue', error))
  }
  try {
    ctx.on('session/event', (session: { id: string }, event: TurnEvent) => {
      if (event.type === 'turn/start') {
        turnBuffers.set(session.id, [])
        return
      }
      if (event.type === 'compaction/summary' || event.type === 'compaction/end') {
        // 压缩会把注入的那条 user message 一并摘要掉：清掉会话状态，让压缩后的
        // 下一步重新注入（与记忆库同款处理）。
        injector.disposeSession(session.id)
        return
      }
      if (event.type === 'turn/end') {
        const buffer = turnBuffers.get(session.id) ?? []
        turnBuffers.delete(session.id)
        const turnNumber = (event.data as { turn?: number }).turn ?? 0
        const agents = (ctx.get as (name: string) => unknown)('agents') as { get?: (id: string) => unknown } | undefined
        const agent = agents?.get?.(session.id) as LiveAgent | undefined
        if (agent === undefined) return
        enqueue(async () => {
          await extractTurn(ctx, store, config, agent, buffer, turnNumber)
        })
        return
      }
      if (event.type === 'user/message' || event.type === 'assistant/message') {
        const buffer = turnBuffers.get(session.id)
        if (buffer === undefined) return
        buffer.push({ type: event.type, data: event.data })
      }
    })
  } catch (error) {
    log('session/event mount', error)
  }

  // ── 定时维护（每日快照 + 孤儿清理 + 配额淘汰）────────────────────────
  try {
    const timer = setInterval(() => {
      void (async () => {
        await store.writeDailySnapshot()
        await store.blobs.sweepOrphans()
        const result = await store.enforceQuota(config.quotaBytes)
        if (result.evicted > 0) {
          ctx.logger?.info?.('[dsh-vault] 配额淘汰 ' + String(result.evicted) + ' 档，释放 '
            + String(Math.round(result.freedBytes / 1024)) + ' KB')
        }
      })().catch((error) => log('maintenance', error))
    }, MAINTENANCE_INTERVAL_MS)
    // unref：定时器不能拖住宿主进程退出（否则 DSH 关不掉）。
    ;(timer as unknown as { unref?: () => void }).unref?.()
    ctx.effect(() => () => { clearInterval(timer) }, 'dsh-vault: maintenance')
  } catch (error) {
    log('maintenance mount', error)
  }

  // ── 退出前回刷 ───────────────────────────────────────────────────────
  ctx.effect(
    () => () => { void store.flush().catch((error) => log('flush on dispose', error)) },
    'dsh-vault: flush on dispose',
  )

  ctx.logger?.info?.('[dsh-vault] vault engine mounted')
}

/** 维护间隔：10 分钟（快照自身按日去重，所以高频调用只是空转几次 stat）。 */
const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000

/**
 * 一轮的抽取与入库。
 *
 * 顺序刻意如此：预筛（纯字符串）→ 读库（决定要不要真的花 token）→ 抽取 → 应用。
 * 预筛在**读库之前**做一次粗判（extractVaultOps 内部还会再判一次），是为了让
 * 「这一轮没提任何账号信息」这条最常见的路径连 vault.json 都不用读。
 */
async function extractTurn(
  ctx: VaultHostContext,
  store: VaultStore,
  config: VaultConfig,
  agent: LiveAgent,
  buffer: TurnEvent[],
  turnNumber: number,
): Promise<void> {
  if (config.autoRecord !== true) return
  if (config.extractEveryTurns > 1 && turnNumber % config.extractEveryTurns !== 0) return
  const transcript = transcriptOfEventsVault(buffer)
  if (transcript.trim() === '') return
  const records = await store.listRecordsRevealed()
  const scenes = await store.listScenes()
  const result = await extractVaultOps(ctx, agent, transcript, records, scenes, config, {
    appendVaultLog: async (message: string) => {
      ctx.logger?.debug?.('[dsh-vault] extract ' + message)
    },
  })
  if (result.ops.length === 0) {
    if (result.outcome !== 'ok' && result.outcome !== 'ok-empty') {
      ctx.logger?.debug?.('[dsh-vault] extract outcome=' + result.outcome + ' ' + String(result.error ?? ''))
    }
    return
  }
  // 不传 config：applyVaultOps 只在「要不要挂 pending」时需要配置，
  // 待确认机制退役后它不再读任何配置项。
  const applied = await applyVaultOps(store, result.ops, {
    scenes,
    sessionId: agent.session.id,
    turn: turnNumber,
  })
  // 只报「新建 / 更新」两种：v2 退役待确认机制后，抽取结果一律直接生效，
  // 没有第三类「挂成待确认」的计数可报（原先这里还会拼一段「待确认 N 条」）。
  if (applied.created + applied.updated > 0) {
    ctx.logger?.info?.('[dsh-vault] 新建 ' + String(applied.created) + ' 条、更新 ' + String(applied.updated) + ' 条')
    // 配额在写入后立刻校一次：照片是唯一能吃满磁盘的东西，等定时任务太晚。
    void store.enforceQuota(config.quotaBytes).catch((error) => log2(ctx, 'quota', error))
  }
}

/** extractTurn 里的日志口（模块级函数拿不到 applyVault 的闭包 log）。 */
function log2(ctx: VaultHostContext, stage: string, error: unknown): void {
  ctx.logger?.warn?.('[dsh-vault] ' + stage + ': ' + (error instanceof Error ? error.message : String(error)))
}