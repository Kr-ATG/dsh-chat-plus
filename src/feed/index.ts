/**
 * dsh-chat-plus — 个人动态（Feed）· 装配入口（host 半身）。
 *
 * 挂在 dsh-chat-plus 里，与记忆 / 用量 / 技能 / 画廊 / 档案 / 邮箱并列，
 * 路由前缀 `/api/dsh-feed/*`（方案 §8；不占用任何已有前缀）。
 *
 * ── 装配顺序与降级 ──────────────────────────────────────────────────
 *
 *  1. store 先 load（闸门与配置要能续上；跨进程重启的单飞锁全靠这一步）；
 *  2. 建 runner（闸门 + 执行）；
 *  3. 路由恒挂 —— 即使生成能力整体不可用，诊断/列表/删除这些也必须在
 *     （否则用户连「为什么没内容」都看不到）；
 *  4. 各子模块**独立 try/catch**：X 抓取、写作、定时任何一块挂掉都只失效
 *     那一块，不影响其余部分与插件其它能力。
 *
 * ── 写作：真实流水线（2026-10-27 接上）────────────────────────────
 *
 * 默认 writer 是 {@link createRealWriter}（writer.ts）：检索 → 验活 →
 * 模型写作 → 校验。它的依赖全部从 cordis 服务取：
 *
 *  - `ctx.get('llm')`          —— 写作用哪个模型（models.ts 负责解析）
 *  - `ctx.get('agentDefaultModel')` —— `config.model === 'default'` 时
 *    "当前主模型"的**唯一事实源**
 *  - `ctx.get('web')`          —— 检索与验活
 *
 * **占位 writer 已整块删除**：它曾产「本轮动态（占位）」并真的写进
 * posts.json，接上真实流水线之后只剩下"让用户看到假内容"这一个作用。
 * 现在写作失败就是 0 条 + `run.status='failed'` + `run.error`。
 *
 * writer 仍然可注入（`config.writer`）：冒烟用假 writer 测流水线逻辑
 * （排序 / 锁 / 删除），不碰网络也不碰真模型。
 *
 * ── 定时（P3）──────────────────────────────────────────────────────
 *
 * 这里只提供 `startFeedScheduler()` 的纯函数式骨架（`computeNextRunAt`），
 * 真正的常驻定时器由装配时按 `config.cron` 挂、卸载时清 —— 见
 * `applyFeedHost` 末尾。解析不了的 cron **不抛**，只是不挂定时器（手动手动
 * 更新照常可用），并在 status 里如实说明。
 *
 * @module
 */

import { mountFeedRoutes } from './api.ts'
import { FeedStore } from './store.ts'
import { createFeedRunner, type FeedRunDeps, type FeedRunner, type FeedWriter } from './trigger.ts'
import { DEFAULT_FEED_CONFIG, type FeedConfig, type FeedTriggerKind } from './types.ts'
import type { XFetchDeps } from './sources.ts'
import { createRealWriter } from './writer.ts'
import { loadModelCatalog, type ServiceGetter } from './models.ts'
import { EntityStore } from './entities.ts'
import { clearActiveFeedStores, setActiveFeedStores } from './store-singleton.ts'

/** 装配配置（cordis.patch.yml 的 feed 段）。 */
export interface FeedHostConfig {
  /** 是否启用定时触发（默认 true；没配 cron 时自然不跑）。 */
  schedule?: boolean
  /** 覆盖写入时的注入面（测试用）。 */
  xDeps?: XFetchDeps
  /** 覆盖写作函数（P2 接 ctx.llm 时由外层传入）。 */
  writer?: FeedWriter
  /** 覆盖时钟（测试用）。 */
  now?: () => number
}

/** 装配后的句柄（供冒烟 / 诊断读）。 */
export interface FeedHostHandle {
  store: FeedStore
  /** 关注对象存储（右侧悬浮球 / 设置面板的数据源）。 */
  entityStore: EntityStore
  runner: FeedRunner
  /** 手动触发一次（冒烟与内部定时共用）。 */
  trigger: (kind: FeedTriggerKind) => ReturnType<FeedRunner['requestRun']>
  /** 停止定时器（卸载时自动调用；句柄上也给一份便于测试）。 */
  dispose: () => void
}

/** 最小 ctx 面（与 mail/context.ts 同款：只声明真正用到的那几样）。 */
export interface FeedHostContext {
  logger?: { info?: (message: string) => void; warn?: (message: string) => void; debug?: (message: string) => void }
  effect(fn: () => void | (() => void), label?: string): void
  webServer: { register(route: unknown): () => void }
  /**
   * 读 cordis 服务（cordis 的 Context.get）。
   *
   * 用它而不是注入式 `ctx.inject(['llm'], ...)`：
   *  1. 注入会抛 `cannot get property "llm" without inject` —— 本模块要求
   *     "模型不可用时降级但整体不挂"，不能因为这个原因让插件装配失败；
   *  2. `get` 拿不到就是 undefined，正是这里需要的语义（→ 明确报错）。
   */
  get?: (name: string) => unknown
}

/**
 * 装配个人动态模块。
 *
 * ⚠ **必须是同步函数**（2026-10-27 修）：路由与 effect 的注册不能跨过 await。
 *
 * 两个理由，任一条都足以让「先 await 再 register」变成 bug：
 *
 *  1. **cordis 的 effect 有 fiber 归属**：`webCtx.effect(fn)` 把 fn 挂到**调用那一刻**
 *     的 fiber 上。await 之后上下文可能已经切换（甚至插件已卸载），此时注册的
 *     effect 会挂错作用域、或者根本不会被执行 —— 表现为「路由没注册上」，而
 *     代码里找不到任何错误。
 *  2. **冒烟是同步驱动的**：`scripts/smoke-host.mjs` 用最小桩同步跑一遍 apply，
 *     断言注册了几条路由。异步注册在这条链路上必然来不及跑完，于是计数断言
 *     直接 FAIL —— 它报的是「路由少了」，根因却在时序。
 *
 * 所以：**先同步把路由与 effect 挂好**，store 的读盘（load 内部幂等）与定时器
 * 启动都放到路由挂好之后。handler 里第一次用到 store 时它自己会 await load()，
 * 不需要装配阶段等它。
 *
 * @param ctx - 已注入 webServer 的上下文。
 * @param config - 装配配置。
 * @returns 句柄（供 smoke / 诊断）。
 */
export function applyFeedHost(ctx: FeedHostContext, config: FeedHostConfig = {}): FeedHostHandle {
  const logger = ctx.logger
  const store = new FeedStore()

  const now = config.now ?? (() => Date.now())
  /*
   * 服务读取面：把 ctx.get 包成一个只读函数交给下层。
   *
   * 为什么要包一层而不是直接把 ctx 传下去：下层（models.ts / writer.ts）
   * 只需要"按名字取服务"这一个能力，传整个 ctx 会让它们顺手用到别的
   * （logger / effect / events），依赖面就再也说不清了。而包一层还有个
   * 实际好处 —— 拿不到 ctx.get（如冒烟的裸桩）时行为是确定的
   * （返回 undefined → 明确报错），不是 TypeError。
   */
  const getService: ServiceGetter = (name) => {
    if (typeof ctx.get !== 'function') return undefined
    try {
      return ctx.get(name)
    } catch {
      // cordis 的 Proxy 在某些情况下会抛（fiber 未激活 / 名字不在 inject 白名单）。
      // 这里一律当作"没有这个服务"，让上层走降级分支。
      return undefined
    }
  }

  /*
   * 默认 writer：**真实流水线**。
   *
   * 三个前置条件缺一不可（缺了 writer 会自己抛错并写进 run.error，
   * 绝不产占位内容）：
   *  1. llm 服务在 —— 没有模型就没有内容；
   *  2. 能解析出写作路由 —— config.model='default' 时要能从
   *     agentDefaultModel 读到当前主模型；
   *  3. web 服务可选 —— 不可用时降级成"本轮无检索"，仍让模型基于提示词写。
   *
   * 注意这里**不预检** llm 是否存在：预检会把"装的时候模型还没好"钉成
   * 永久失败（cordis 的服务是异步装配的），而不预检的话每一轮都会重新读
   * 一次服务 —— 用户配好 provider 之后点更新立刻就能用。
   */
  const writer: FeedWriter = config.writer
    ?? createRealWriter({ getService, now, logger })

  /*
   * 关注对象（2026-10-27「右侧悬浮球」）：独立的一份落盘（entities.json）。
   *
   * 自己建实例而不是让路由层懒建单例：**三处**都要用它 ——
   *  1. 路由（GET/POST/PUT/DELETE /entities）；
   *  2. 生成（把「本轮该盯谁」注入提示词，并把模型标的归属换成 id）；
   *  3. 将来的头像回填。
   * 一个实例三处共享，才不会有「设置面板加完人、生成时读不到」这类次序问题。
   */
  const entityStore = new EntityStore()

  /*
   * 登记「当前活跃 store」：工作台云同步恢复动态设置后要拿这两个实例做
   * reload()，否则内存态仍是旧配置（详见 store-singleton.ts 的说明）。
   * 卸载时清空槽位：同一实例才清，不会误伤重新装配的新实例。
   */
  setActiveFeedStores({ feed: store, entities: entityStore })
  ctx.effect(() => () => { clearActiveFeedStores({ feed: store, entities: entityStore }) }, 'dsh-feed: active store slot')

  const runDeps: FeedRunDeps = {
    store,
    writer,
    now,
    xDeps: config.xDeps,
    logger,
    /*
     * 生成时读它：提示词注入「本轮关注的对象」+ 落盘时把名字换成 entityIds
     * + 抓完 X 顺手回填头像。
     *
     * 这里包一层而不是直接传 EntityStore：FollowedEntitySource 只声明了
     * 生成侧真正需要的能力（list / updateAvatar），EntityStore 的 update
     * 收的是通用 patch —— 直接传会让「回填头像」变成一个可以改任何字段的
     * 后门，而生成侧不该有那个权限。
     */
    entityStore: {
      list: () => entityStore.list(),
      updateAvatar: async (id: string, avatarUrl: string): Promise<void> => {
        await entityStore.update(id, { avatarUrl })
      },
    },
  }
  const runner = createFeedRunner(runDeps)

  // ── 路由：**同步**注册（诊断面恒挂，不因生成能力挂掉而消失）────────
  const disposeRoutes = mountFeedRoutes(ctx, {
    store,
    runner,
    now,
    logger,
    entityStore,
    // /models 要现算目录（客户端下拉靠它列出真实可用模型）。
    getService,
  })
  ctx.effect(() => disposeRoutes, 'dsh-feed: routes')

  // ── 定时触发（P3 骨架）────────────────────────────────────────────
  let timer: ReturnType<typeof setInterval> | null = null
  const dispose = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const armScheduler = (cron: string): void => {
    if (config.schedule === false) return
    dispose()
    const intervalMs = parseCronIntervalMs(cron)
    if (intervalMs === null) {
      // 解析不了**不抛**：定时失效，手动更新照常可用，status 里如实说明。
      logger?.info?.('[dsh-feed] cron expression not understood, scheduler disabled (manual update still works)')
      return
    }
    // 用 setInterval 而不是 cron 库：本模块只需要「大致按点跑一次」，精确到秒
    // 没有意义（生成本身要几十秒）。间隔见 parseCronIntervalMs。
    timer = setInterval(() => {
      void runner.requestRun('schedule').catch((error: unknown) => {
        logger?.warn?.('[dsh-feed] scheduled run failed: '
          + (error instanceof Error ? error.message : String(error)))
      })
    }, intervalMs)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    logger?.info?.('[dsh-feed] scheduler armed, every ' + Math.round(intervalMs / 60000) + ' min')
  }

  // effect 也同步注册（dispose 用闭包变量，拿到的永远是最新那个 timer）。
  ctx.effect(() => dispose, 'dsh-feed: scheduler')

  // 先用默认 cron 挂上（同步、不阻塞装配），读盘完成后按真实配置重挂一次。
  armScheduler(DEFAULT_FEED_CONFIG.cron)
  void store.load()
    .then(async () => {
      // 启动自愈：宿主进程刚启动，检查并回收上一进程异常退出留下的僵尸 running 锁，防止死锁 10 分钟
      try {
        const gate = await store.getGate()
        if (gate.status === 'running') {
          logger?.info?.('[dsh-feed] clearing stale running gate from previous process on host mount')
          if (gate.runId !== null) {
            try {
              const runs = await store.listRuns()
              const zombie = runs.find(r => r.id === gate.runId)
              if (zombie !== undefined && zombie.status === 'running') {
                await store.upsertRun({ ...zombie, status: 'failed', finishedAt: now(), error: 'interrupted by host restart' })
              }
            } catch {}
          }
          await store.setGate({
            status: 'idle',
            runId: null,
            leaseUntil: 0,
            queued: false,
            queuedTrigger: null,
            blockedCount: gate.blockedCount,
          })
        }
      } catch (err) {
        logger?.warn?.('[dsh-feed] gate recovery check failed: ' + String(err))
      }

      const feedConfig = await store.getConfig()
      if (config.schedule !== false) armScheduler(feedConfig.cron)
    })
    .catch((error: unknown) => {
      // 读盘失败只让定时用默认间隔继续；路由与手动更新不受影响。
      logger?.warn?.('[dsh-feed] config preload failed: '
        + (error instanceof Error ? error.message : String(error)))
    })

  logger?.info?.('[dsh-feed] feed workbench mounted (routes /api/dsh-feed)')

  return {
    store,
    entityStore,
    runner,
    trigger: kind => runner.requestRun(kind),
    dispose,
  }
}

/* ───────────────────────── 定时表达式（P3 骨架） ───────────────────────── */

/**
 * 把一个简单的 cron 表达式折成「大致多久跑一次」（毫秒）；解析不了返回 null。
 *
 * 刻意**只支持** `M H,H,H * * *` 这一种形态（就是默认的 `0 12,18 * * *`）：
 * 完整的 cron 解析需要 200 行与一堆边界情形，而本模块对定时的要求只是
 * 「一天大致跑一两次」。折成等间隔（默认两次/天 → 12 小时）会有一点偏差
 * （12:00 与 18:00 实际间隔 6 小时 / 18 小时），但它带来的后果只是生成时刻
 * 不那么齐整，不是功能错误。
 *
 * 真正的 cron 精确调度应当交给官方 schedule bundle —— 那才是它存在的意义。
 *
 * @param expression - cron 表达式（5 段）。
 * @returns 间隔毫秒；不认识的形态返回 null。
 */
export function parseCronIntervalMs(expression: string): number | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  if (dom !== '*' || month !== '*' || dow !== '*') return null
  if (!/^\d{1,2}$/.test(minute)) return null
  const hourField = hour.trim()
  let hours: number[]
  if (hourField === '*') {
    hours = Array.from({ length: 24 }, (_, index) => index)
  } else if (/^\d{1,2}(,\d{1,2})*$/.test(hourField)) {
    hours = hourField.split(',').map(value => Number(value))
  } else {
    return null
  }
  if (hours.length === 0) return null
  if (hours.some(value => !Number.isInteger(value) || value < 0 || value > 23)) return null
  // 按「一天跑 N 次」折成等间隔。
  const perDay = Math.max(1, hours.length)
  return Math.round((24 * 60 * 60 * 1000) / perDay)
}

/** 导出给冒烟对拍。 */
export const __test = { parseCronIntervalMs }