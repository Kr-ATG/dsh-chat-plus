/**
 * dsh-chat-plus — 对话完成提示音资产路由（done-pill 模块）。
 *
 * 只做一件事：把随包分发的 task-done.wav 以正确的 MIME 与缓存头吐给浏览器。
 *
 * 为什么走 host 路由而不是内联进 client 产物：提示音是二进制音频，base64 内联
 * 会让每个用户（包括关掉提示音的人）在 client.js 里多背一份音频体积；走独立
 * 路由后只在真正要播的时候拉一次，之后靠 immutable 缓存命中。
 *
 * 安全面：路径不是从请求里取的，而是模块内按包位置解析后写死的常量；文件名
 * 必须精确命中白名单，因此不存在路径穿越的可能。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 路由前缀：与插件其它路由同族（/api/chat-flow/*）。 */
export const SFX_ROUTE = '/api/chat-flow/sfx'

/** 随包分发的提示音文件表：对外名 → 包内相对路径。 */
const SFX_FILES: Record<string, { rel: string; mime: string }> = {
  'task-done.wav': { rel: 'assets/sfx/task-done.wav', mime: 'audio/wav' },
}

/**
 * 解析包根目录下的资产绝对路径。
 *
 * 兼容两种产物形态（与 src/fonts/index.ts 的 resolveAsset 同一套约定）：
 * esbuild 打成单文件 `lib/index.js` 时 `..` 即包根；tsc 保留目录结构
 * `lib/xxx.js` 时 `../..` 才是包根。
 * @param rel - 包内相对路径（posix 分隔）。
 * @returns 命中的绝对路径；两处都不存在时返回 null。
 */
function resolveAsset(rel: string): string | null {
  const candidates = [
    join(fileURLToPath(new URL('..', import.meta.url)), ...rel.split('/')),
    join(fileURLToPath(new URL('../..', import.meta.url)), ...rel.split('/')),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

/** 已解析过的资产路径缓存（进程内不变，避免每请求两次 existsSync）。 */
const resolved = new Map<string, string | null>()

function assetPath(name: string): string | null {
  if (!resolved.has(name)) resolved.set(name, resolveAsset(SFX_FILES[name]!.rel))
  return resolved.get(name) ?? null
}

/**
 * 注册提示音路由（在已注入 webServer 的子上下文中调用）。
 *
 * 用 `kind: 'prefix'` 一次挂住整个前缀，内部按精确文件名分发；未知文件名一律
 * 404，绝不回落到「读任意路径」。提示音内容随版本固定，用 immutable + 一年缓存。
 * @param webCtx - webServer 服务已就绪的插件上下文。
 */
export function applySfxRoutes(webCtx: Record<string, any>): void {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'prefix',
    path: SFX_ROUTE,
    handler: (req: any, res: any) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      let name = ''
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        name = decodeURIComponent(url.pathname.slice(SFX_ROUTE.length).replace(/^\/+/, ''))
      } catch {
        // 非法百分号编码：按键名未知处理，绝不让异常冒出 handler。
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'unknown sfx asset' }))
        return
      }
      const entry = SFX_FILES[name]
      if (entry === undefined) {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'unknown sfx asset' }))
        return
      }
      const path = assetPath(name)
      if (path === null) {
        // 资产缺失（打包漏了 files 字段、或装在裁剪过的产物里）：明确报错，
        // 不要静默 200 空体——那会让前端把「提示音加载失败」表现成无声。
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'sfx asset missing from package' }))
        return
      }
      let size: number
      try {
        size = statSync(path).size
      } catch {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'sfx asset unreadable' }))
        return
      }
      res.writeHead(200, {
        'content-type': entry.mime,
        'content-length': String(size),
        'cache-control': 'public, max-age=31536000, immutable',
      })
      if (req.method === 'HEAD') { res.end(); return }
      const stream = createReadStream(path)
      stream.on('error', () => { try { res.destroy() } catch { /* 已经断了 */ } })
      stream.pipe(res)
    },
  }), 'dsh-chat-plus: done-pill sfx route')
}
