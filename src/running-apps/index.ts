/**
 * dsh-chat-plus — 「运行中的程序」路由（host 半身）。
 *
 *   GET /api/chat-flow/running-apps
 *
 * 每次都真采（无缓存）—— 常驻子进程一次往返 2~4ms，比 HTTP 往返还便宜，
 * 所以「关掉程序 → 立刻打 @」看到的必然是关掉之后的状态。
 * 历史遗留的 ?force=1 参数仍被接受但无作用（旧客户端会带）。
 *
 * 只读、同源 GET，返回 {@link RunningAppsSnapshot}。
 *
 * 为什么单独一个模块而不是塞进 host.ts：host.ts 已经 400 行且塞了七条路由，
 * 采集器还带一个常驻子进程的生命周期（卸载要 kill），独立成模块才好让
 * 冒烟直接 import 判据（normalizeWindow / sortWindows）。
 *
 * 任何异常一律 200 + ok:false + 空列表：客户端据此静默降级成「没有候选」，
 * 绝不让 @ 菜单变成错误面板。
 *
 * @module
 */

import { rejectCrossSite } from '../shared/csrf.ts'
import { activateProcessWindow, collectRunningApps, disposeRunningApps } from './collect.ts'
import { RUNNING_APPS_ACTIVATE_ROUTE, RUNNING_APPS_ROUTE } from './types.ts'

/** webServer 的最小面（只用到 register）。 */
interface RunningAppsWebServer {
  register(entry: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: unknown) => void
  }): () => void
}

/** host ctx 的最小面。 */
export interface RunningAppsHostContext {
  inject?: (names: string[], cb: (ctx: never) => void) => void
  effect?: (fn: () => unknown, label?: string) => void
  logger?: { warn?: (message: string) => void; info?: (message: string) => void }
  get?: (name: string) => unknown
}

/** 路由 handler（独立导出，冒烟可直接构造 req/res 对拍）。 */
export function handleRunningAppsRoute(req: unknown, res: unknown): void {
  const respond = (status: number, payload: Record<string, unknown>): void => {
    try {
      const target = res as {
        writeHead?: (status: number, headers: Record<string, string>) => void
        end?: (body: string) => void
        setHeader?: (name: string, value: string) => void
      }
      if (typeof target.writeHead === 'function') {
        target.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
      } else if (typeof target.setHeader === 'function') {
        target.setHeader('content-type', 'application/json; charset=utf-8')
        target.setHeader('cache-control', 'no-store')
      }
      target.end?.(JSON.stringify(payload))
    } catch {
      /* 回包写失败只说明连接断了，无事可做 */
    }
  }

  // 只读路由也过跨站闸门：这条会拉起一个常驻 PowerShell 子进程，
  // 让任意网页能触发本机进程枚举没有道理（见 shared/csrf.ts 的审计说明）。
  if (rejectCrossSite((req as { headers?: Record<string, unknown> })?.headers, (status, payload) => respond(status, payload))) {
    return
  }

  void collectRunningApps()
    .then((snapshot) => respond(200, snapshot as unknown as Record<string, unknown>))
    .catch((error: unknown) => {
      respond(200, {
        ok: false,
        apps: [],
        ms: 0,
        at: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      })
    })
}

/** 激活请求体上限：一个进程名，256 字节足够。 */
const MAX_ACTIVATE_BODY = 256

/**
 * 处理一次「把窗口拉到前台」的请求。
 *
 * ## 为什么需要这条路由
 *
 * 操作面板卡头那枚浏览器标志表达的是「这个会话正在操作浏览器」。用户的原话是
 * 「点击浏览器图标自动进入到ego那个工作空间」—— 他想从 DSH 一步跳回那个正在
 * 被操作的浏览器窗口，而不是自己去任务栏里翻。
 *
 * ## 安全边界（比 GET 那条更严）
 *
 * 这是一条**会产生可见副作用**的路由：它把别的程序拽到前台，等于抢走用户的
 * 焦点。三道闸门：
 *   1. **必须是 POST**：GET 会被预取 / 缓存 / 链接预览触发，那意味着用户还没点
 *      就把 ego 拽到前面；
 *   2. rejectCrossSite：任意网页一个 CORS 简单请求不能盲调；
 *   3. **只认进程名，不认任意命令**：白名单式解析 —— 传进来的字符串只当进程名用，
 *      绝不拼进命令行（ACTIVATE 命令走 stdin，不经过 shell）。
 *
 * ## 失败姿态
 *
 * 找不到窗口 / 采集器不在 / 任何异常，一律 200 + `{ ok: false }`：客户端据此
 * 静默不动（不弹错、不假装成功）。这条路由是**锦上添花**，它挂了不该影响任何
 * 主流程。
 *
 * @param req Node 请求。
 * @param res Node 响应。
 */
export function handleActivateWindowRoute(req: unknown, res: unknown): void {
  const respond = (status: number, payload: Record<string, unknown>): void => {
    try {
      const target = res as {
        writeHead?: (status: number, headers: Record<string, string>) => void
        end?: (body: string) => void
        setHeader?: (name: string, value: string) => void
      }
      if (typeof target.writeHead === 'function') {
        target.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      } else if (typeof target.setHeader === 'function') {
        target.setHeader('content-type', 'application/json; charset=utf-8')
        target.setHeader('cache-control', 'no-store')
      }
      target.end?.(JSON.stringify(payload))
    } catch {
      /* 回包写失败只说明连接断了 */
    }
  }

  if (rejectCrossSite((req as { headers?: Record<string, unknown> })?.headers, (status, payload) => respond(status, payload))) {
    return
  }

  const request = req as { method?: unknown; on?: (event: string, cb: (chunk?: unknown) => void) => void } | null | undefined
  const method = typeof request?.method === 'string' ? request.method.toUpperCase() : ''
  if (method !== 'POST') {
    respond(405, { ok: false, activated: '', error: 'method not allowed' })
    return
  }

  const chunks: Buffer[] = []
  let total = 0
  let aborted = false
  const finish = (): void => {
    if (aborted) return
    aborted = true
    let names: string[] = []
    try {
      const raw = Buffer.concat(chunks).toString('utf8')
      const parsed = JSON.parse(raw) as { process?: unknown; processes?: unknown }
      /*
       * 认两种形状：
       *  · process: 'ego'        —— 单个进程名；
       *  · processes: ['ego', …] —— 候选列表，按序试（客户端不知道 ego-browser
       *    背后到底是 ego 还是别的宿主时用它）。
       */
      const list: unknown[] = Array.isArray(parsed.processes) ? parsed.processes : [parsed.process]
      names = list
        .filter((item): item is string => typeof item === 'string')
        // 进程名只允许字母数字与 - _ . ：挡住路径分隔符与任何 shell 元字符，
        // 也挡住空串（空串会被 PowerShell 侧当成"没有目标"）。
        .map((item) => item.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64))
        .filter((item) => item !== '')
    } catch {
      respond(400, { ok: false, activated: '', error: 'invalid json' })
      return
    }
    if (names.length === 0) {
      respond(400, { ok: false, activated: '', error: 'missing process' })
      return
    }
    void activateProcessWindow(names)
      .then((ok) => respond(200, { ok, activated: ok ? names[0] : '' }))
      .catch((error: unknown) => {
        respond(200, { ok: false, activated: '', error: error instanceof Error ? error.message : String(error) })
      })
  }

  try {
    request?.on?.('data', (chunk?: unknown) => {
      if (chunk === undefined || chunk === null) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      total += buf.length
      if (total > MAX_ACTIVATE_BODY) {
        aborted = true
        respond(413, { ok: false, activated: '', error: 'body too large' })
        return
      }
      chunks.push(buf)
    })
    request?.on?.('end', finish)
    request?.on?.('error', () => {
      aborted = true
      respond(400, { ok: false, activated: '', error: 'request error' })
    })
  } catch {
    respond(400, { ok: false, activated: '', error: 'request unreadable' })
  }
}

/**
 * 挂载路由（webServer 缺失时静默跳过）。
 *
 * 与 host.ts 其余路由同一条纪律：不能在 apply 同步路径上直接读 ctx.webServer
 * （cordis 的 ctx 是 Proxy，未 inject 的属性一读就抛，会连累整棵插件树 boot
 * 失败）。延迟注入天然做到「服务不在就不执行」。
 */
export function applyRunningApps(hostCtx: RunningAppsHostContext): void {
  const log = (level: 'warn' | 'info', message: string): void => {
    try {
      if (level === 'warn') hostCtx.logger?.warn?.(message)
      else hostCtx.logger?.info?.(message)
    } catch {
      /* 拿不到 logger 时静默：不为了记日志再抛一次 */
    }
  }

  // 卸载清理先登记：常驻子进程不 kill 就是孤儿（机器上多一个 pwsh 挂着）。
  try {
    if (typeof hostCtx.effect === 'function') {
      hostCtx.effect(() => () => disposeRunningApps(), 'dsh-chat-plus.running-apps')
    }
  } catch (error) {
    log('warn', '[running-apps] effect failed: ' + describe(error))
  }

  /*
   * 启动即预热。
   *
   * 冷启动一个 pwsh 要 600~700ms（实测），而用户打 @ 时菜单必须立刻有东西。
   * 在这里先跑一次采集，把子进程拉起来、把图标缓存填好，之后每次请求就是
   * 一次 stdin/stdout 往返（2~4ms）。失败无所谓——采集器自己会在下次请求
   * 时重建，这里只是「提前把最贵的那一次做掉」。
   */
  void collectRunningApps(true).catch(() => { /* 预热失败不影响任何功能 */ })

  try {
    hostCtx.inject?.(['webServer'], (webCtx: never) => {
      const webServer = (webCtx as unknown as { webServer?: RunningAppsWebServer }).webServer
      if (webServer === undefined || typeof webServer.register !== 'function') {
        log('warn', '[running-apps] webServer unavailable: 路由未注册')
        return
      }
      const register = (): (() => void) => {
        const offList = webServer.register({
          kind: 'exact',
          path: RUNNING_APPS_ROUTE,
          handler: (req: unknown, res: unknown) => handleRunningAppsRoute(req, res),
        })
        /*
         * 激活路由与采集路由共用同一个常驻子进程（同一个 ACTIVATE 命令通道），
         * 所以必须挂在同一个 webServer 作用域里 —— 拆到别处会让两条路由各拉起
         * 一个 pwsh，白占一份常驻进程。
         */
        const offActivate = webServer.register({
          kind: 'exact',
          path: RUNNING_APPS_ACTIVATE_ROUTE,
          handler: (req: unknown, res: unknown) => handleActivateWindowRoute(req, res),
        })
        return () => {
          try { offList() } catch { /* 已回收 */ }
          try { offActivate() } catch { /* 已回收 */ }
        }
      }
      const scope = webCtx as unknown as { effect?: (fn: () => unknown, label?: string) => void }
      if (typeof scope.effect === 'function') scope.effect(register, 'dsh-chat-plus: running-apps route')
      else register()
    })
  } catch (error) {
    log('warn', '[running-apps] route injection failed: ' + describe(error))
  }
}

/** 统一的错误描述（不依赖 error 是否为 Error 实例）。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { RUNNING_APPS_ACTIVATE_ROUTE, RUNNING_APPS_ROUTE }
export type { RunningAppsSnapshot, RunningAppWindow } from './types.ts'
/**
 * 采集器的纯判据（窗口归一化 / 排序 / 采集脚本正文）。
 *
 * 这些判据错了不会报错：归一化歪了会静默丢条目，排序歪了前台窗口排在后面，
 * 采集脚本漏一条过滤就多出「翻译此页？」「输入体验」这类噪声窗口。
 * 所以从模块边界一路透出到 host 入口，冒烟可直接对拍。
 */
export { __test, collectRunningApps, disposeRunningApps } from './collect.ts'
