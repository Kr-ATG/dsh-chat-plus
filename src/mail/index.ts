/**
 * dsh-mail — 邮箱工作台 host 半身（装配入口）。
 *
 * 挂在 dsh-chat-plus 里，与记忆/用量/技能三个工作台并列，路由前缀
 * `/api/dsh-mail/*`（不占用任何已有前缀）。
 *
 * 装配顺序与降级：
 *  1. store 先 load（待确认操作要能续上）；
 *  2. 解析配置（默认 → config.json → cordis.patch.yml 的 mail 段）；
 *  3. enabled: false 时**只**挂最少的诊断路由（让面板能把它打开回来），
 *     工具与 pre-step 注入都不注册；
 *  4. 其余模块各自 try/catch：一个挂不上不影响插件其它能力。
 *
 * 依赖的 ctx service：webServer（路由）、tools（模型工具）。
 * `agent/pre-step` 与 `session/event` 是事件，不需要 inject 声明。
 */

import { MailService } from './service.js'
import { MailStore } from './store.js'
import { MailWatcher } from './watch.js'
import { mountMailRoutes } from './api.js'
import { registerMailTools } from './tools.js'
import { createMailInjector } from './inject.js'
import type { MailHostContext } from './context.js'
import type { MailConfig } from './types.js'

/** 邮箱工作台配置（cordis.patch.yml 的 mail 段）。 */
export interface MailHostConfig extends Partial<MailConfig> {}

/** 已挂载的邮箱工作台句柄（供主插件诊断/测试）。 */
export interface MailHostHandle {
  service: MailService
  store: MailStore
  watcher: MailWatcher
  config: MailConfig
}

/**
 * 装配邮箱工作台。ctx 必须已注入 webServer 与 tools。
 * @returns 句柄（供 smoke / 诊断读取），失败时抛错由调用方 warn。
 */
export async function applyMailHost(ctx: MailHostContext, input: MailHostConfig = {}): Promise<MailHostHandle> {
  const store = new MailStore()
  await store.load()
  const config = await store.resolveConfig(input)
  const service = new MailService(store, config, input)
  const watcher = new MailWatcher(store, ctx.logger)

  // ── 路由（诊断面恒挂：关掉总开关后用户还得靠面板把它打开） ──────────
  const routesDispose = mountMailRoutes(ctx, service, store, watcher)
  ctx.effect(() => routesDispose, 'dsh-mail: routes')

  if (config.enabled) {
    // ── 新邮件监听（常驻 watch，配置可关） ─────────────────────────────
    if (config.watchEnabled) {
      try {
        watcher.start()
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-mail] watcher failed to start: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // ── 模型工具 ──────────────────────────────────────────────────────
    try {
      const toolsDispose = registerMailTools(ctx, service)
      ctx.effect(() => toolsDispose, 'dsh-mail: tools')
      ctx.logger?.info?.('[dsh-mail] tools registered')
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-mail] tools failed to register: ${error instanceof Error ? error.message : String(error)}`)
    }

    // ── 对话注入（每会话首步一次） ────────────────────────────────────
    if (config.injectEnabled) {
      try {
        const injector = createMailInjector(service, ctx.logger)
        ctx.on('agent/pre-step', ((
          payload: { agent: { id: string; session: { id: string } }; messages: unknown[]; signal: AbortSignal },
          next: () => Promise<{ kind: 'enter'; messages: unknown[] } | { kind: 'reject' }>,
        ) => injector.preStepListener(payload, next)) as never, { prepend: true })
        ctx.on('agent/disposed', ({ agent }: { agent: { session: { id: string } } }) => {
          injector.disposeSession(agent.session.id)
        })
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-mail] injector failed to mount: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } else {
    ctx.logger?.info?.('[dsh-mail] disabled by config: tools + injection skipped')
  }

  // ── 卸载时收掉常驻 watch 进程 ───────────────────────────────────────
  ctx.effect(() => () => { watcher.stop() }, 'dsh-mail: watch cleanup')

  ctx.logger?.info?.(`[dsh-mail] mailbox workbench mounted (enabled=${String(config.enabled)})`)
  return { service, store, watcher, config }
}
