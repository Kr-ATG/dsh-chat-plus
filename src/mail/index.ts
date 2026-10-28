/**
 * dsh-mail — 邮箱工作台 host 半身（装配入口）。
 *
 * 挂在 dsh-chat-plus 里，与记忆/用量/技能三个工作台并列，路由前缀
 * `/api/dsh-mail/*`（不占用任何已有前缀）。
 *
 * 装配顺序与降级：
 *  1. store 先 load（待确认操作要能续上）；
 *  2. 解析配置（默认 → config.json → cordis.patch.yml 的 mail 段）；
 *  3. 路由恒挂（诊断面：关掉总开关后用户还得靠面板把它打开）；
 *  4. **工具随 `enabled` 动态挂/卸**——面板上拨开关立即生效，
 *     不需要重启 DSH（历史缺陷：`enabled` 是启动期装配开关，拨了界面显示
 *     已启用、运行中的进程毫无变化，用户只能靠重启，且看不到任何提示）；
 *  5. 其余模块各自 try/catch：一个挂不上不影响插件其它能力。
 *
 * 依赖的 ctx service：webServer（路由）、tools（模型工具）。
 * `agent/pre-step` 与 `session/event` 是事件，不需要 inject 声明。
 */

import { MailService } from './service.js'
import { MailStore } from './store.js'
import { mountMailRoutes } from './api.js'
import { registerMailTools } from './tools.js'
import { createMailInjector } from './inject.js'
import { clearMailStatusSource, setMailStatusSource } from './registry.js'
import type { MailHostContext } from './context.js'
import type { MailConfig } from './types.js'
import { hostFeatureEnabled } from '../features/store.ts'

/** 邮箱工作台配置（cordis.patch.yml 的 mail 段）。 */
export interface MailHostConfig extends Partial<MailConfig> {}

/** 已挂载的邮箱工作台句柄（供主插件诊断/测试）。 */
export interface MailHostHandle {
  service: MailService
  store: MailStore
  config: MailConfig
  /** 当前是否已挂工具（诊断用：面板据此显示真实生效状态）。 */
  toolsMounted: () => boolean
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

  // ── 路由（诊断面恒挂：关掉总开关后用户还得靠面板把它打开） ──────────
  const routesDispose = mountMailRoutes(ctx, service, store)
  ctx.effect(() => routesDispose, 'dsh-mail: routes')

  /*
   * ── 工具的动态挂/卸 ──────────────────────────────────────────────
   *
   * `enabled` 的语义是「模型能不能用邮箱」，它必须**运行时**可改：
   * 面板上那个开关点了就生效，而不是「写进配置、等下次重启」。历史上它被
   * 当成启动期装配开关，后果是用户把开关拨来拨去、界面一直显示已启用，
   * 而进程里什么都没发生 —— 用户唯一的出路是重启 DSH，且无从判断自己
   * 到底成功没有。
   *
   * 这里订阅 service 的配置变更：打开就注册工具，关掉就卸工具。装配期的
   * 第一次同步调用让「启动时就是开/关」与「运行中拨动」走同一条代码路径
   * （两条路径分开写必然有一边漏测）。
   */
  let toolsDispose: (() => void) | null = null
  let mountedEnabled: boolean | null = null

  const syncEnabled = (next: MailConfig): void => {
    if (mountedEnabled === next.enabled) return
    mountedEnabled = next.enabled
    if (next.enabled) {
      // 模型工具
      try {
        toolsDispose = registerMailTools(ctx, service)
        /*
         * 注意这层多出来的箭头：`ctx.effect(cb)` 是**立即执行** cb、把它的
         * 返回值当 disposer。写成 `ctx.effect(() => { toolsDispose?.(); ... })`
         * 会在注册的下一行就把刚挂上的工具全注销掉（cb 立刻跑），而且是静默的
         * —— 模型看不见 mail_*，路由却一切正常。必须包一层：外层立即执行、
         * 返回内层函数作为真正的 disposer。
         */
        ctx.effect(() => () => { toolsDispose?.(); toolsDispose = null }, 'dsh-mail: tools')
        ctx.logger?.info?.('[dsh-mail] tools registered')
      } catch (error) {
        toolsDispose = null
        ctx.logger?.warn?.(`[dsh-mail] tools failed to register: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      try {
        toolsDispose?.()
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-mail] tools failed to unregister: ${error instanceof Error ? error.message : String(error)}`)
      }
      toolsDispose = null
      ctx.logger?.info?.('[dsh-mail] disabled by config: tools unregistered')
    }
  }

  syncEnabled(config)
  const unsubscribeConfig = service.onConfigChange(syncEnabled)
  ctx.effect(() => unsubscribeConfig, 'dsh-mail: config subscription')

  /*
   * ── 对话注入（每会话首步一次，常驻注册）────────────────────────────
   *
   * 注入器**恒注册**，闸门在每次 pre-step 现读（见 inject.ts 的 MailInjectGate）。
   * 两个理由：
   *
   *  1. 注册/注销监听器有时序成本，而闸门只是一次布尔读；
   *  2. 更要紧的是**声明与工具解耦**：`injectEnabled` 开着就注入，哪怕邮箱
   *     工作台总开关（`enabled`）关着、`mail_*` 工具没注册 —— 那时文本改走
   *     `agently-cli` 命令行。所以注入器的注册**不能**挂在 `enabled` 之下，
   *     否则工作台一关，模型连「自己有邮箱」都不知道了。
   */
  try {
    const injector = createMailInjector(service, ctx.logger, {
      // 只看声明开关（injectEnabled）：与工具面无关。
      isEnabled: () => hostFeatureEnabled('prompt.mail') && service.getConfig().injectEnabled,
      // 工具在不在，决定注入文本走工具还是走命令行。
      toolsAvailable: () => toolsDispose !== null,
    })
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

  /*
   * ── 跨模块状态槽位（供记忆侧的「内置提示词通道」卡片读）─────────────
   *
   * 那张卡片是 /api/dsh-memory/* 的路由，而邮箱状态住在这里。两个模块同属
   * 一个插件但装配顺序固定（triad 在前、mail 在后），记忆侧装配时拿不到本
   * 实例，只能运行时经槽位取。
   *
   * `snapshot` 必须**同步且不打 CLI**：卡片每 hover 一次就要读一次状态，
   * 在里面 await 账号探测等于把每次 hover 变成一次子进程调用。授权状态由
   * `refresh` 在后台更新（10 分钟节流），读到的永远是上一次的结论。
   */
  let authorized: boolean | null = null
  let address: string | null = null
  let refreshing: Promise<void> | null = null
  let lastRefreshAt = 0

  const refresh = async (): Promise<void> => {
    // 节流：10 分钟内已探测过就不再打 CLI（与注入器的 accountCache 同口径）。
    if (Date.now() - lastRefreshAt < 10 * 60_000) return
    if (refreshing !== null) return refreshing
    refreshing = (async () => {
      try {
        const account = await service.account()
        authorized = account.me !== null
        address = account.me === null ? null : (account.primary?.email ?? null)
      } catch {
        // 探测失败**不改**已有结论：CLI 超时/未登录都不该把「已授权」翻成
        // 「未授权」，那会让卡片在偶发抖动时显示错误的红字。
        authorized = authorized ?? null
      } finally {
        lastRefreshAt = Date.now()
        refreshing = null
      }
    })()
    return refreshing
  }

  setMailStatusSource({
    snapshot: () => ({
      workbenchEnabled: service.getConfig().enabled,
      injectEnabled: service.getConfig().injectEnabled,
      toolsMounted: toolsDispose !== null,
      authorized,
      address,
    }),
    refresh,
    updateConfig: async (patch) => {
      await service.updateConfig(patch)
      // 打开开关后立刻把授权状态探出来，卡片上那一行才能马上从「未知」变成真值。
      if (patch.enabled === true) await refresh()
    },
  })
  // 首次探测不阻塞装配：授权状态晚几百毫秒到不影响任何功能。
  void refresh().catch(() => undefined)
  ctx.effect(() => () => { clearMailStatusSource() }, 'dsh-mail: status slot')

  ctx.logger?.info?.(`[dsh-mail] mailbox workbench mounted (enabled=${String(config.enabled)})`)
  return {
    service,
    store,
    config,
    toolsMounted: () => toolsDispose !== null,
  }
}
