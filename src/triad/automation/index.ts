/**
 * automation — host 半身装配入口（从 dsh-webui 提取，归属 dsh-triad）。
 *
 * 组成：
 *  - CronStore：任务持久化（${DSH_HOME}/automation/dsh-triad/，旧 dsh-webui 数据首次启动自动迁移）
 *  - CronScheduler：服务进程内 60s tick 调度（GUI 关闭也照常触发）
 *  - 执行器：到期任务经 ctx.llm 以绑定模型真实执行
 *  - automation 工具：Agent 可 list / 建议 create / 建议 update / 立即运行
 *  - HTTP 路由：UI 的 CRUD、建议确认、运行历史、完成事件流
 *
 * 「立即运行」由调度器同步派发（不再靠拨 nextRunAt 等下一个 tick），
 * 因此路由层需要拿到 scheduler——装配顺序为 store → scheduler → routes。
 *
 * 移植适配（相对 webui 原版）：
 *  - settings 不再走 ctx.settings 命名空间（@deepseek-ai/dsh-settings +
 *    schemastery 在已安装位置解析不到），改存自动化目录 settings.json；
 *  - createUserMessage / defineTool 改走 vendor 内联（见 vendor/README.md）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CronStore, automationDataRoot, migrateLegacyAutomationData } from './store.js'
import { AutomationSuggestionStore } from './suggestions.js'
import { createCronScheduler, type CronScheduler } from './scheduler.js'
import { executeJob as runJob, type LlmLike } from './executor.js'
import { registerAutomationTool } from './tool.js'
import {
  ROUTE_PREFIX,
  createAutomationEventBuffer,
  registerAutomationRoutes,
} from './routes.js'

/** 最小 webServer 契约（与插件其余模块同款）。 */
interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
}

interface WebServerLike {
  register(route: WebServerRoute): () => void
}

interface LlmStreamChunk {
  type: string
  text?: string
  reason?: { kind: string, failure?: { message?: string } }
}

interface LlmServiceLike extends LlmLike {
  stream(opts: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<LlmStreamChunk>
}

function settingsPath(): string {
  return join(automationDataRoot(), 'settings.json')
}

function readAutoApprove(): boolean {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    const data = JSON.parse(raw) as { autoApprove?: unknown }
    return data.autoApprove === true
  } catch {
    return false
  }
}

async function writeAutoApprove(patch: { autoApprove?: boolean }): Promise<void> {
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Record<string, unknown>
  } catch {
    current = {}
  }
  if (patch.autoApprove !== undefined) current.autoApprove = patch.autoApprove === true
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(current, null, 2) + '\n', 'utf-8')
  void existsSync
}

/** 挂载自动化模块：store + 调度器 + 工具 + 路由（triad 组合调用）。 */
export function applyAutomationHost(ctx: Context): void {
  const webServer = (ctx.get('webServer') as WebServerLike | undefined)
    ?? (ctx as unknown as { webServer?: WebServerLike }).webServer
  if (webServer === undefined) return

  migrateLegacyAutomationData()
  const store = new CronStore()
  const suggestions = new AutomationSuggestionStore()
  const events = createAutomationEventBuffer()

  // ── 调度器（先于路由：run_now 需要它同步派发执行）──
  const llm = (ctx.get('llm') as LlmServiceLike | undefined)
    ?? (ctx as unknown as { llm?: LlmServiceLike }).llm
  const executing = new Map<string, AbortController>()
  let scheduler: CronScheduler | null = null

  if (llm !== undefined) {
    scheduler = createCronScheduler({
      store,
      executeJob: (job) => {
        const ac = new AbortController()
        executing.set(job.id, ac)
        return runJob(ctx, llm, job, ac.signal).finally(() => {
          /*
           * 只删**自己放进去的那一个**。
           *
           * scheduler 的 dispatch 是 Promise.race([executeJob, 超时])：超时后
           * race 立即 reject 并把任务从 inflight 摘掉，但 executeJob 返回的那个
           * promise 并没有结束（provider 没响应 abort 时它会一直挂着）。这期间
           * 同一任务可以被再次派发，新一轮 executing.set(job.id, ac2)；等旧
           * promise 终于 settle，按 id 无条件 delete 会把 ac2 一起抹掉。此后再
           * abortJob 就永远拿到 undefined——「取消」路由照样回 200（它只看
           * inflight），执行体却收不到 abort，只能干等到超时。
           */
          if (executing.get(job.id) === ac) executing.delete(job.id)
        })
      },
      abortJob: (job) => {
        executing.get(job.id)?.abort()
      },
      onJobDone: (job, result) => {
        events.push(job, result)
        const status = typeof result.status === 'string' ? result.status : 'skipped'
        if (status === 'error') {
          ctx.logger?.warn?.('[triad-automation] 任务失败 ' + job.label + ' (' + job.id + '): ' + String(result.error ?? ''))
        } else if (status === 'success') {
          ctx.logger?.info?.('[triad-automation] 任务完成 ' + job.label + ' (' + job.id + ')')
        }
      },
    })
    scheduler.start()
  } else {
    ctx.logger?.warn?.('[triad-automation] llm 服务不可用，调度器未启动（CRUD 与建议仍可用）')
  }

  // ── HTTP 路由 ──
  const disposeRoutes = registerAutomationRoutes({
    ctx,
    webServer,
    store,
    suggestions,
    events,
    scheduler: () => scheduler,
    settings: {
      read: () => ({ autoApprove: readAutoApprove() }),
      write: async (patch) => {
        await writeAutoApprove(patch)
      },
    },
  })

  // ── Agent 工具 ──
  let disposeTool: (() => void) | null = null
  try {
    disposeTool = registerAutomationTool({
      ctx,
      store,
      suggestions,
      scheduler: () => scheduler,
      isAutoApprove: () => readAutoApprove(),
    })
  } catch {
    // tools 服务不可达时仅降级 UI/HTTP 能力，不影响调度执行。
  }

  ctx.effect(() => () => {
    void scheduler?.stop()
    scheduler = null
    disposeTool?.()
    disposeTool = null
    disposeRoutes()
  }, 'triad: automation host')
}

export { ROUTE_PREFIX }
