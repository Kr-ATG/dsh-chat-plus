/**
 * dsh-chat-plus — 「在文件管理器中打开」修复（host 半身）。
 *
 * 背景：官方 open-in-app 的文件管理器类（Windows 的 `explorer`、macOS 的
 * `finder`）走 `shell-open` 启动，最终调到
 * `@deepseek-ai/dsh-native-command` 的 `runNativeCommand`，而它把
 * `windowsHide: true` 写死在 `execFile` 选项里：
 *
 *     execFile(cmd, args, { encoding, signal, windowsHide: true }, cb)
 *
 * 于是 explorer 进程被正常拉起、正常把请求委托给桌面 shell 后以 exit 1
 * 退出（官方把 exit 1 当作「已委托」并 resolve），但它开出的文件夹窗口
 * 被隐藏了 —— 表现为「点了没反应」，服务端还返回 `ok: true`。
 * argv 类应用（VSCode、Chrome…）走 `launchDetachedApp`，windowsHide 由各自
 * catalog 条目决定，普遍不隐藏，所以只有文件管理器受影响。
 *
 * 本模块不碰上游包（改 node_modules 会在引擎升级时被覆盖），改为自建一条
 * 同义路由，**唯一的差别是不隐藏窗口**：直接以 explorer/open/xdg-open
 * 打开目录，并把 explorer 的委托退出码 1 视为成功。客户端侧
 * `client/open-path-fix.ts` 只把 explorer 这一类请求改道到这里，
 * 其余 app 仍走官方链路。
 *
 * 安全边界（这条路由等价于本机「打开文件夹」能力，不能变成任意程序入口）：
 *  - 只接受**已存在的目录**，文件与可执行路径一律拒绝；
 *  - 必须是绝对路径，避免相对路径依赖服务端 cwd；
 *  - 沿用 connection 的请求鉴权（与官方 open-in-app 同一道信任栅栏）。
 *
 * 约束（与 build.mjs assertHostExternals 一致）：零 @deepseek-ai 运行时导入。
 */

import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rejectCrossSite } from '../shared/csrf.ts'

/** 本插件路由前缀（与既有 /api/chat-flow/* 家族一致）。 */
const ROUTE_PATH = '/api/chat-flow/open-path'

/** 请求体上限：只有一个路径，1 KiB 足够。 */
const MAX_BODY_BYTES = 1024

function json(res: any, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 读请求体；超过上限直接掐断并返回 null。 */
function readBody(req: any): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        req.resume()
        resolvePromise(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolvePromise(Buffer.concat(chunks, size).toString('utf8')) })
    req.on('error', () => { resolvePromise(null) })
  })
}

/**
 * 校验目标确实是存在的目录。
 * @param target - 待打开的绝对路径。
 * @returns true 表示可以交给系统文件管理器。
 */
function isOpenableDirectory(target: string): boolean {
  if (!isAbsolute(target)) return false
  try {
    return statSync(target).isDirectory()
  } catch {
    // 路径不存在 / 无权限 / 是断开的链接：都不是「打开目录」的目标。
    return false
  }
}

/**
 * 打开目录：Windows 用 explorer，macOS 用 open，其余用 xdg-open。
 *
 * 与上游唯一的差异就是**不传 windowsHide**，否则窗口会被隐藏。
 * explorer 把请求委托给已运行的桌面 shell 后以 1 退出，这个 1 是成功。
 */
function openDirectory(target: string): Promise<{ ok: boolean; code?: number | null; message?: string }> {
  const [command, args] = process.platform === 'win32'
    // explorer 收 file URL 是官方既有的做法（对含空格/非 ASCII 的路径更稳）
    ? ['explorer.exe', [pathToFileURL(target).href]] as const
    : process.platform === 'darwin'
      ? ['open', [target]] as const
      : ['xdg-open', [target]] as const

  return new Promise((resolvePromise) => {
    execFile(command, [...args], { encoding: 'utf8' }, (error: any) => {
      if (!error) {
        resolvePromise({ ok: true })
        return
      }
      // explorer 的委托退出码：请求已交给桌面进程，窗口由它负责。
      if (command === 'explorer.exe' && error.code === 1) {
        resolvePromise({ ok: true })
        return
      }
      resolvePromise({ ok: false, code: error.code ?? null, message: error.message })
    })
  })
}

/**
 * 取 connection 服务（认证用）。
 *
 * cordis 的 ctx 是 Proxy：未在 `inject` 里声明的属性**一读就抛**
 * `cannot get property "connection" without inject`。本模块由只注入了
 * `webServer` 的子上下文调用，所以必须走 Reflect + try/catch 静默降级
 * （官方 open-in-app 读它用的是同一手法）。
 */
function connectionOf(ctx: Record<string, any>): any {
  try {
    return Reflect.get(ctx, 'connection')
  } catch {
    return undefined
  }
}

/**
 * 注册修复路由（在已注入 webServer 的子上下文中调用）：
 *   POST /api/chat-flow/open-path  { "path": "D:\\AI\\Dsh" } → { ok, path? }
 * @param webCtx - webServer 已就绪的插件上下文。
 */
export function applyOpenPathRoutes(webCtx: Record<string, any>): void {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req: any, res: any): Promise<void> => {
      try {
        /*
         * 跨站闸门（2026-10-17 安全审计）。
         *
         * 下面那道 connection.requestRejection 是**恒不生效**的：本模块由只注入
         * 了 webServer 的子上下文调用，connectionOf() 的 Reflect.get 必然抛错、
         * catch 后返回 undefined，于是整段校验被静默跳过（实测跨站 POST 直接
         * 返回 200 并真的弹出资源管理器）。所以这里补一道真正会执行的自有判据。
         */
        if (rejectCrossSite(req.headers as Record<string, unknown>, (status, payload) => {
          json(res, status, payload)
        })) return
        // 认证：与官方 open-in-app 同一道 connection 信任栅栏（服务缺失时不做判断）。
        const connection = connectionOf(webCtx)
        if (connection && typeof connection.requestRejection === 'function') {
          const rejection = connection.requestRejection(req)
          if (rejection !== undefined) {
            json(res, rejection, { ok: false, error: 'unauthorized' })
            return
          }
        }
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const text = await readBody(req)
        if (text === null) {
          json(res, 413, { ok: false, error: 'payload too large' })
          return
        }
        let parsed: any
        try {
          parsed = JSON.parse(text)
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const target = typeof parsed?.path === 'string' ? parsed.path : ''
        if (target === '' || !isOpenableDirectory(target)) {
          json(res, 400, { ok: false, error: 'not an existing directory' })
          return
        }
        const outcome = await openDirectory(target)
        if (!outcome.ok) {
          json(res, 502, { ok: false, error: outcome.message ?? 'launch failed' })
          return
        }
        json(res, 200, { ok: true, path: target })
      } catch {
        json(res, 500, { ok: false, error: 'internal error' })
      }
    },
  }), 'dsh-chat-plus: open-path route')
}
