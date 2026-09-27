/**
 * automation — Cron 调度器（参考 openhanako cron-scheduler）。
 *
 * 确定性代码层：每分钟检查一次到期任务，到期时回调执行。
 * 调度逻辑不涉及 LLM，只有执行回调才会发起模型调用——调度器与执行解耦。
 *
 * 行为契约：
 *  - tick 间隔 60s；`checking` 防重入；
 *  - 逐任务派发前重新读取该 job，让批次进行期间的删除/停用/改期立即生效；
 *  - schemaVersion 高于本实现的 job 跳过并落一条 skipped 记录（前向兼容）；
 *  - **同一任务不并发**（inflight 表按 jobId 去重），**不同任务并发派发**——
 *    一个 20 分钟的长任务不会把同批次其他任务堵到下一轮；
 *  - 单次执行超时（默认 20 分钟）触发 abortJob 并按失败处理；
 *  - 调度触发：成功/失败都经 markRun 推进 nextRunAt（失败含退避）并落历史；
 *  - 手动触发（runNow）：立即执行、不推进调度游标、不计连续失败，
 *    历史记录标 trigger:'manual'；停用中的任务也可手动跑一次。
 */

import { AUTOMATION_SCHEMA_VERSION, type CronJob, type RunRecord } from './types.js'
import type { CronStore } from './store.js'

/** 单次任务执行超时。 */
export const DEFAULT_CRON_EXECUTION_TIMEOUT_MS = 20 * 60 * 1000

/** 一次运行的触发来源。 */
export type RunTrigger = 'schedule' | 'manual'

export interface CronSchedulerOptions {
  store: CronStore
  /** 执行回调（由 executor 提供）：解析即视为成功，抛错即失败。 */
  executeJob: (job: CronJob) => Promise<Record<string, unknown> | void>
  /** 超时时中断正在执行的任务。 */
  abortJob?: (job: CronJob) => void
  /** 执行完成通知（无论成败/skip 都会回调）。 */
  onJobDone?: (job: CronJob, result: Record<string, unknown>) => void
  /** 单次执行超时毫秒。 */
  executionTimeoutMs?: number
}

export interface CronScheduler {
  start: () => void
  stop: () => Promise<void>
  checkJobs: () => Promise<void>
  /** 立即执行一次（手动触发）；返回运行结果记录。 */
  runNow: (id: string) => Promise<Record<string, unknown>>
  /** 该任务当前是否正在执行。 */
  isRunning: (id: string) => boolean
  /** 正在执行的任务 id 列表。 */
  runningIds: () => string[]
  /** 中止正在执行的任务（未在执行返回 false）。 */
  cancel: (id: string) => boolean
}

/** 任务正在执行时再次触发抛该错（路由层转 409）。 */
export class JobBusyError extends Error {
  readonly code = 'job_busy'
  constructor(id: string) {
    super(`任务 ${id} 正在执行中，请等它结束`)
    this.name = 'JobBusyError'
  }
}

function formatTimeoutMs(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}min`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

/**
 * 执行记录与调度游标的写入守卫。
 *
 * 这些写入本来和执行体在同一个 try 里，于是**存储 I/O 一失败，整个执行就被
 * catch 记成 error**：模型明明跑完了，用户看到「任务失败」并进入退避；如果
 * 失败的是 logRun 之后的 onJobDone（事件推送），同一次执行会先写一条 success
 * 再写一条 error，前端弹两个 toast，every/cron 游标还被二次 markRun 推快一个
 * 周期。这里把「执行失败」和「记录失败」彻底分开：记录写不进去只丢一条控制台
 * 警告，绝不改变这次执行的真实结论。
 */
function guardStore<T>(write: () => T, fallback: T): T {
  try {
    return write()
  } catch (error) {
    console.warn('[dsh-chat-plus] automation: 写执行记录失败（不影响本次执行结论）', error)
    return fallback
  }
}

/** 完成回调守卫：订阅方抛错不该反噬执行记录。 */
function guardNotify(notify: () => void): void {
  try {
    notify()
  } catch (error) {
    console.warn('[dsh-chat-plus] automation: onJobDone 回调失败', error)
  }
}

/** 创建 Cron 调度器。 */
export function createCronScheduler({
  store,
  executeJob,
  abortJob,
  onJobDone,
  executionTimeoutMs = DEFAULT_CRON_EXECUTION_TIMEOUT_MS,
}: CronSchedulerOptions): CronScheduler {
  const CHECK_INTERVAL = 60_000
  if (!Number.isFinite(executionTimeoutMs) || executionTimeoutMs <= 0) {
    throw new Error('executionTimeoutMs must be a positive finite number')
  }
  let timer: ReturnType<typeof setInterval> | null = null
  let checking = false
  let checkPromise: Promise<void> | null = null
  let stopped = false
  /** 正在执行的任务：jobId → 该次执行的 promise（并发去重 + stop 时排空）。 */
  const inflight = new Map<string, Promise<Record<string, unknown>>>()

  async function checkJobs(): Promise<void> {
    if (checking) return
    checking = true
    const p = doCheck().finally(() => { checking = false })
    checkPromise = p
    await p
  }

  /** 执行一次任务并落历史；不抛错（失败也落一条 error 记录）。 */
  function dispatch(job: CronJob, trigger: RunTrigger): Promise<Record<string, unknown>> {
    const existing = inflight.get(job.id)
    if (existing !== undefined) return existing

    const startedAt = new Date().toISOString()
    const run = (async (): Promise<Record<string, unknown>> => {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined
      try {
        let executionResult: Record<string, unknown> | void
        try {
          executionResult = await Promise.race([
            Promise.resolve(executeJob(job)),
            new Promise<never>((_, reject) => {
              timeoutTimer = setTimeout(() => {
                abortJob?.(job)
                reject(new Error(`execution timeout (${formatTimeoutMs(executionTimeoutMs)})`))
              }, executionTimeoutMs)
            }),
          ])
        } finally {
          clearTimeout(timeoutTimer)
        }
        const finishedAt = new Date().toISOString()
        const extra = isRecord(executionResult) ? executionResult : {}
        // 手动触发不动调度游标：用户点「立即运行」不该让下一次定时提前/推后。
        const cursorAdvanced = trigger === 'schedule'
          ? guardStore(() => store.markRun(job.id, { success: true, expectedConfigRevision: job.configRevision }), true)
          : true
        const record: Omit<RunRecord, 'timestamp'> = {
          ...extra,
          status: 'success',
          startedAt,
          finishedAt,
          trigger,
          ...(cursorAdvanced === false ? { staleConfigRevision: true } : {}),
        }
        guardStore(() => store.logRun(job.id, record), true)
        const result: Record<string, unknown> = { ...record }
        guardNotify(() => onJobDone?.(job, result))
        return result
      } catch (error) {
        const finishedAt = new Date().toISOString()
        const message = error instanceof Error ? error.message : String(error)
        if (isSkippedError(error)) {
          const record: Omit<RunRecord, 'timestamp'> = { status: 'skipped', startedAt, finishedAt, reason: message, trigger }
          guardStore(() => store.logRun(job.id, record), true)
          const result: Record<string, unknown> = { ...record }
          guardNotify(() => onJobDone?.(job, result))
          return result
        }
        const cursorAdvanced = trigger === 'schedule'
          ? guardStore(() => store.markRun(job.id, { success: false, expectedConfigRevision: job.configRevision }), true)
          : true
        const record: Omit<RunRecord, 'timestamp'> = {
          status: 'error',
          startedAt,
          finishedAt,
          error: message,
          trigger,
          ...(cursorAdvanced === false ? { staleConfigRevision: true } : {}),
        }
        guardStore(() => store.logRun(job.id, record), true)
        const result: Record<string, unknown> = { ...record }
        guardNotify(() => onJobDone?.(job, result))
        return result
      }
    })().finally(() => {
      inflight.delete(job.id)
    })

    inflight.set(job.id, run)
    return run
  }

  async function doCheck(): Promise<void> {
    try {
      const jobs = store.listJobs()
      for (const listedJob of jobs) {
        if (stopped) return
        // 长任务可能耗时数分钟；派发前重读，让编辑/删除立即生效。
        const job = store.getJob(listedJob.id)
        if (job === null || !job.enabled || job.nextRunAt === null) continue
        // 同一任务上一轮还在跑：本轮跳过且不推进游标（下一 tick 再试）。
        if (inflight.has(job.id)) continue

        const nextRunTime = new Date(job.nextRunAt).getTime()
        if (!Number.isFinite(nextRunTime) || Date.now() < nextRunTime) continue

        // 新版本写入的字段本运行时不认识：跳过执行但记录原因。
        if (Number.isInteger(job.schemaVersion) && job.schemaVersion !== AUTOMATION_SCHEMA_VERSION) {
          const skippedAt = new Date().toISOString()
          store.logRun(job.id, {
            status: 'skipped',
            startedAt: skippedAt,
            finishedAt: skippedAt,
            reason: 'unsupported_automation_schema',
            schemaVersion: job.schemaVersion,
            trigger: 'schedule',
          })
          onJobDone?.(job, { status: 'skipped', reason: 'unsupported_automation_schema' })
          continue
        }

        // 并发派发：不 await，长任务不阻塞同批次其他任务（stop 时统一排空）。
        void dispatch(job, 'schedule').catch(() => {})
      }
    } catch {
      // 单轮检查的整体异常吞掉即可，下轮 tick 继续。
    }
  }

  /** 手动立即执行：绕过 nextRunAt，停用任务也能跑；正在执行则抛 JobBusyError。 */
  async function runNow(id: string): Promise<Record<string, unknown>> {
    const job = store.getJob(id)
    if (job === null) throw new Error(`找不到任务 ${id}`)
    if (inflight.has(id)) throw new JobBusyError(id)
    if (typeof job.prompt !== 'string' || job.prompt.trim() === '') {
      throw new Error('这条自动化还没有执行内容，先写下想让助手做什么')
    }
    return dispatch(job, 'manual')
  }

  function start(): void {
    if (timer !== null) return
    stopped = false
    timer = setInterval(() => { void checkJobs() }, CHECK_INTERVAL)
    // 启动即补一次：服务停机期间错过的到期任务立刻补跑，不必再等一个
    // 完整 tick（原实现最长空等 60s）。延后一拍，让宿主装配先完成。
    setTimeout(() => { if (!stopped) void checkJobs() }, 1_000).unref?.()
  }

  async function stop(): Promise<void> {
    stopped = true
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (checkPromise !== null) {
      await checkPromise.catch(() => {})
      checkPromise = null
    }
    // 中止在飞的执行再排空。
    //
    // 只排空不中止的话，插件卸载 / 配置重载 / profile 切换时，正在跑的模型
    // 调用会一路挂到 DEFAULT_CRON_EXECUTION_TIMEOUT_MS（20 分钟）才结束：
    // HTTP 连接与超时定时器继续占着事件循环，进程退不干净。
    for (const job of inflight.values()) {
      try { abortJob?.(job) } catch { /* 中止失败也不能卡住卸载 */ }
    }
    await Promise.allSettled([...inflight.values()])
    inflight.clear()
  }

  /** 中止在飞的执行：执行体的 signal 被 abort，落一条 error 记录。 */
  function cancel(id: string): boolean {
    if (!inflight.has(id)) return false
    const job = store.getJob(id)
    if (job === null) return false
    abortJob?.(job)
    return true
  }

  return {
    start,
    stop,
    checkJobs,
    runNow,
    isRunning: (id: string) => inflight.has(id),
    runningIds: () => [...inflight.keys()],
    cancel,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSkippedError(error: unknown): boolean {
  return isRecord(error) && (error as { skipped?: unknown }).skipped === true
}
