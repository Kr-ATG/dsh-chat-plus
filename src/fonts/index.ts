/**
 * dsh-chat-plus — 「界面字体」的宿主侧路由。
 *
 * 只做一件事：把随包分发的 woff2 以正确的 MIME 与缓存头吐给浏览器。
 *
 * 为什么字体要走 host 路由而不是内联进 client 产物：
 *  1. 字体约 5MB，base64 内联进 client.js 会让**每个**用户（包括从不切字体的
 *     绝大多数）冷启动多下载 6.6MB 且解析一份巨大的 JS 字符串；
 *  2. 走独立路由后是浏览器原生字体加载：默认档（微软雅黑）一个字节都不下载，
 *     只有用户主动选中「霞鹜新致宋」才拉这一次，之后靠 immutable 缓存命中。
 *
 * 为什么不放官方静态目录：DSH 没有给插件放静态资产的公共目录，本插件的
 * `assets/` 只随包分发（与 mermaid 同一套形态），必须自己开路由。
 *
 * 安全面：路径**不是**从请求里取的，而是模块内按包位置解析后写死的常量，
 * 因此不存在路径穿越的可能——不接收任何查询参数或路径段。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 路由前缀：与插件其它路由同族（/api/chat-flow/*）。 */
export const FONT_ROUTE = '/api/chat-flow/fonts'

/**
 * 随包分发的字体文件表：对外名 → 包内相对路径。
 *
 * 只列已知的两个文件，不接受任意文件名——请求路径必须精确命中这张表。
 */
const FONT_FILES: Record<string, { rel: string; mime: string }> = {
  'lxgw-neozhisong-screen.woff2': { rel: 'assets/fonts/lxgw-neozhisong-screen.woff2', mime: 'font/woff2' },
  'IPA-Font-License-1.0.md': { rel: 'assets/fonts/IPA-Font-License-1.0.md', mime: 'text/markdown; charset=utf-8' },
}

/**
 * 解析包根目录下的资产绝对路径。
 *
 * 兼容两种产物形态（与 src/shot/renderer.ts 的 mermaid 资产同一套约定）：
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
  if (!resolved.has(name)) resolved.set(name, resolveAsset(FONT_FILES[name]!.rel))
  return resolved.get(name) ?? null
}

/**
 * 注册字体路由（在已注入 webServer 的子上下文中调用）。
 *
 * 用 `kind: 'prefix'` 一次挂住整个前缀，内部按精确文件名分发；未知文件名一律
 * 404，绝不回落到「读任意路径」。
 * @param webCtx - webServer 服务已就绪的插件上下文。
 */
export function applyFontRoutes(webCtx: Record<string, any>): void {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'prefix',
    path: FONT_ROUTE,
    handler: (req: any, res: any) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const name = decodeURIComponent(url.pathname.slice(FONT_ROUTE.length).replace(/^\/+/, ''))
      const entry = FONT_FILES[name]
      if (entry === undefined) {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'unknown font asset' }))
        return
      }
      const path = assetPath(name)
      if (path === null) {
        // 资产缺失（打包漏了 files 字段、或装在裁剪过的产物里）：明确报错，
        // 不要静默 200 空体——那会让浏览器把「字体加载失败」显示成排版错乱。
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'font asset missing from package' }))
        return
      }
      let size: number
      try {
        size = statSync(path).size
      } catch {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'font asset unreadable' }))
        return
      }
      /*
       * 缓存策略：字体内容随版本固定，用 immutable + 一年。
       * 换版本时文件名会带版本号（见 FONT_FILES 的对外名约定），所以不必担心
       * 「更新了插件但浏览器还在用旧字体」。许可文件同样缓存，它不会变。
       */
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
  }), 'dsh-chat-plus: font asset route')
}
