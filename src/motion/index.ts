/**
 * dsh-chat-plus — 「任务动画」的宿主侧路由。
 *
 * 只做一件事：把随包分发的 9 段透明底 WebM（+ 首帧 WebP 海报）以正确的 MIME 与
 * 缓存头吐给浏览器。
 *
 * 为什么动画要走 host 路由而不是内联进 client 产物：
 *  1. 9 段动画合计约 2.57MB。base64 内联进 client.js 会让**每一个**用户
 *     （包括关掉动画的、以及从不打开大盘的）冷启动多下载 3.4MB 并解析一份巨型
 *     JS 字符串；
 *  2. 走独立路由后是浏览器原生媒体加载：只拉当前在播的那一段，切换片段靠 HTTP
 *     缓存命中，不碰 JS 主包；
 *  3. 内联的 base64 还会让 client.js 的 sourcemap 膨胀到不可读。
 *
 * 为什么不放官方静态目录：DSH 没有给插件放静态资产的公共目录，本插件的
 * assets/ 只随包分发（与字体、mermaid 同一套形态），必须自己开路由。
 *
 * ## 为什么是 WebM(VP9 + 透明通道) 而不是 GIF
 *
 * 原素材是 9 个 320x640 的 GIF，全部**在近白底上完全不透明**。直接贴进深色右栏
 * 就是一块白板，所以先按边沿洪泛抠掉白底、再编码成 yuva420p 的 VP9 —— 浏览器
 * 原生支持带 alpha 的 WebM，且体积只有等价 GIF 的几十分之一。
 *
 * 安全面：路径**不是**从请求里取的，而是模块内按包位置解析后写死的常量表，
 * 因此不存在路径穿越的可能——请求路径必须精确命中 MOTION_FILES 的键。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 路由前缀：与插件其它路由同族（/api/chat-flow/*）。 */
export const MOTION_ROUTE = '/api/chat-flow/motion'

/**
 * 片段 id 表：**客户端也有一份**（src/client/kr-chat/motion-clips.ts 的
 * MOTION_CLIP_IDS）。两边必须一致 —— 对不上时的失败形态是「某个状态永远显示
 * 首帧海报」，界面上不报错，只能靠冒烟断言钉住。
 *
 * 每个 id 两个文件：.webm（动画本体）与 .webp（首帧海报，video 的 poster）。
 * 海报不是可选项：preload 期间、以及「减少动态效果」下不播放时，看到的就是它。
 */
const MOTION_FILES: Record<string, { rel: string; mime: string }> = {
  'thinking.webm': { rel: 'assets/motion/thinking.webm', mime: 'video/webm' },
  'thinking.webp': { rel: 'assets/motion/thinking.webp', mime: 'image/webp' },
  'start-op.webm': { rel: 'assets/motion/start-op.webm', mime: 'video/webm' },
  'start-op.webp': { rel: 'assets/motion/start-op.webp', mime: 'image/webp' },
  'working.webm': { rel: 'assets/motion/working.webm', mime: 'video/webm' },
  'working.webp': { rel: 'assets/motion/working.webp', mime: 'image/webp' },
  'photo.webm': { rel: 'assets/motion/photo.webm', mime: 'video/webm' },
  'photo.webp': { rel: 'assets/motion/photo.webp', mime: 'image/webp' },
  'end-op.webm': { rel: 'assets/motion/end-op.webm', mime: 'video/webm' },
  'end-op.webp': { rel: 'assets/motion/end-op.webp', mime: 'image/webp' },
  'done.webm': { rel: 'assets/motion/done.webm', mime: 'video/webm' },
  'done.webp': { rel: 'assets/motion/done.webp', mime: 'image/webp' },
  'meal.webm': { rel: 'assets/motion/meal.webm', mime: 'video/webm' },
  'meal.webp': { rel: 'assets/motion/meal.webp', mime: 'image/webp' },
  'moon.webm': { rel: 'assets/motion/moon.webm', mime: 'video/webm' },
  'moon.webp': { rel: 'assets/motion/moon.webp', mime: 'image/webp' },
  'nap.webm': { rel: 'assets/motion/nap.webm', mime: 'video/webm' },
  'nap.webp': { rel: 'assets/motion/nap.webp', mime: 'image/webp' },
}

/**
 * 解析包根目录下的资产绝对路径。
 *
 * 兼容两种产物形态（与 src/fonts/index.ts、src/shot/renderer.ts 同一套约定）：
 * esbuild 打成单文件 lib/index.js 时 .. 即包根；tsc 保留目录结构 lib/xxx.js 时
 * ../.. 才是包根。
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
  if (!resolved.has(name)) resolved.set(name, resolveAsset(MOTION_FILES[name]!.rel))
  return resolved.get(name) ?? null
}

/**
 * 注册动画资产路由（在已注入 webServer 的子上下文中调用）。
 *
 * 用 kind: 'prefix' 一次挂住整个前缀，内部按精确文件名分发；未知文件名一律 404，
 * 绝不回落到「读任意路径」。
 * @param webCtx - webServer 服务已就绪的插件上下文。
 */
export function applyMotionRoutes(webCtx: Record<string, any>): void {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'prefix',
    path: MOTION_ROUTE,
    handler: (req: any, res: any) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const name = decodeURIComponent(url.pathname.slice(MOTION_ROUTE.length).replace(/^\/+/, ''))
      const entry = MOTION_FILES[name]
      if (entry === undefined) {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'unknown motion asset' }))
        return
      }
      const path = assetPath(name)
      if (path === null) {
        // 资产缺失（打包漏了 files 字段、或装在裁剪过的产物里）：明确报错，
        // 不要静默 200 空体——那会让 video 永远停在首帧、看起来只是"不动"。
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'motion asset missing from package' }))
        return
      }
      let size: number
      try {
        size = statSync(path).size
      } catch {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'motion asset unreadable' }))
        return
      }
      /*
       * 缓存策略：片段内容随版本固定，用 immutable + 一年。
       * 换素材时文件名会带版本（与字体同一套约定），所以不必担心
       * 「更新了插件但浏览器还在用旧动画」。
       *
       * 用 Range 兜住：video 元素在部分浏览器里会带 Range 探测，而我们不做分片
       * （片段最大 567KB，一次给完更简单），所以显式声明 accept-ranges: none，
       * 让浏览器别反复发 Range 请求再收到 200 全量。
       */
      res.writeHead(200, {
        'content-type': entry.mime,
        'content-length': String(size),
        'accept-ranges': 'none',
        'cache-control': 'public, max-age=31536000, immutable',
      })
      if (req.method === 'HEAD') { res.end(); return }
      const stream = createReadStream(path)
      stream.on('error', () => { try { res.destroy() } catch { /* 已经断了 */ } })
      stream.pipe(res)
    },
  }), 'dsh-chat-plus: motion asset route')
}
