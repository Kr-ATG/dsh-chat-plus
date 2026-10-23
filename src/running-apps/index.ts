/**
 * dsh-chat-plus — 「运行中的程序」路由（host 半身）。
 *
 *   GET /api/chat-flow/running-apps[?force=1]
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
import { collectRunningApps, disposeRunningApps } from './collect.ts'
import { RUNNING_APPS_ROUTE } from './types.ts'

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

  let force = false
  try {
    const url = new URL((req as { url?: string })?.url ?? '/', 'http://x')
    force = url.searchParams.get('force') === '1'
  } catch {
    force = false
  }

  void collectRunningApps(force)
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
      const register = (): (() => void) => webServer.register({
        kind: 'exact',
        path: RUNNING_APPS_ROUTE,
        handler: (req: unknown, res: unknown) => handleRunningAppsRoute(req, res),
      })
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

export { RUNNING_APPS_ROUTE }
export type { RunningAppsSnapshot, RunningAppWindow } from './types.ts'
/**
 * 采集器的纯判据（窗口归一化 / 排序 / 采集脚本正文）。
 *
 * 这些判据错了不会报错：归一化歪了会静默丢条目，排序歪了前台窗口排在后面，
 * 采集脚本漏一条过滤就多出「翻译此页？」「输入体验」这类噪声窗口。
 * 所以从模块边界一路透出到 host 入口，冒烟可直接对拍。
 */
export { __test, collectRunningApps, disposeRunningApps } from './collect.ts'
