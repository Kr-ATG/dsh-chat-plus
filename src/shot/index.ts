/**
 * dsh-chat-plus — 对话截图（host 半身，自 dsh-webui 移植，重做版）。
 *
 * 数据流：消息操作栏相机按钮 → 面板选范围/主题/宽度 → POST /render（渲染，
 * 结果只进内存缓存，不落盘）→ 面板里看预览 → POST /save 才写文件到
 * ~/.dsh/storages/dsh-chat-flow-screenshot，POST /reveal 在文件管理器里定位。
 *
 * 与旧实现的差异：
 *  - 渲染走常驻无头浏览器（renderer.ts），不再每张图冷启动一个 Edge/Chrome；
 *  - 支持多条消息（单条回复 / 一轮问答 / 整段会话）与三档宽度；
 *  - 预览不落盘：不保存就不会在 storages 里堆垃圾。
 *
 * 与 dsh-webui 的差异：路由前缀换成 /api/chat-flow/screenshot、保存目录独立
 * （storages/dsh-chat-flow-screenshot），其余渲染/缓存/编辑模式行为一致。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { findLocalHtmlPaths } from '../shared/html-paths.ts'
import { buildCardHtml, deriveTitle, type ShotEmbed, type ShotMessage } from './card.ts'
import { resolveShotPreset, shotAspectRatio, shotPreset } from './presets.ts'
import { configureRenderer, probePageHeight, renderPng, shutdownRenderer, diagnoseEngine } from './renderer.ts'
import { canvasPad, canvasPadY, cardContentWidth, type ShotTheme } from './theme.ts'

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServerService
  }
}

const ROUTE = '/api/chat-flow/screenshot'
/** 单次请求最多渲染的消息条数（整段会话截图的上限）。 */
const MAX_MESSAGES = 60
/** 请求体上限（8MB：整段会话的文本可能不小）。 */
const MAX_BODY = 8 * 1024 * 1024
/** 预览缓存条数（LRU 淘汰最旧）。 */
const CACHE_LIMIT = 8

/** 单次截图最多内嵌几张本地 HTML（每张要多导航一次）。 */
const MAX_EMBEDS = 3
/** 内嵌页面的大小上限。 */
const MAX_EMBED_BYTES = 4 * 1024 * 1024

/** 把消息里的路径解析成绝对路径（相对路径按会话 cwd，缺省按进程 cwd）。 */
function resolveLocal(raw: string, cwd: string | undefined): string | null {
  let p = raw.trim()
  if (p === '' || /[*?]/.test(p)) return null
  if (/^file:/i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname)
      if (p.charCodeAt(0) === 47 && /[A-Za-z]:/.test(p.slice(1, 4))) p = p.slice(1)
    } catch {
      return null
    }
  }
  if (p === '~' || p.startsWith('~/')) p = join(homedir(), p.slice(1).replace(/^[\\/]+/, ''))
  return isAbsolute(p) ? resolve(p) : resolve(cwd ?? process.cwd(), p)
}

/**
 * 收集正文里提到的本地 HTML 并探测高度，得到可注入截图卡片的内嵌项。
 *
 * 抽取规则见 src/shared/html-paths.ts。任何一条探测失败都只是少一张
 * 图，不影响整张截图。
 *
 * **同时回报被丢弃的张数**：超过 MAX_EMBEDS / MAX_EMBED_BYTES、或文件读不到的，
 * 都不进截图。以前这些是静默的——用户看到正文里写着 4 个产物路径、图里只有 3 张，
 * 无从知道少的那张是「被上限截掉」还是「本来就不存在」。张数交给卡片页脚说明。
 * @param messages - 待截图的消息。
 * @param cwd - 会话工作目录（相对路径基准）。
 * @param contentWidth - 卡片正文内容盒宽度（iframe 与量高用同一个宽度）。
 */
async function collectEmbeds(
  messages: readonly ShotMessage[],
  cwd: string | undefined,
  contentWidth: number,
): Promise<{ embeds: ShotEmbed[]; omitted: number }> {
  const picked = new Map<string, { abs: string; raw: string }>()
  let omitted = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const hit of findLocalHtmlPaths(message.text)) {
      const abs = resolveLocal(hit.path, cwd)
      if (abs === null || !/\.html?$/i.test(abs)) continue
      const key = abs.toLowerCase()
      // 同一个文件被重复提到只算一次，不算「被丢弃」。
      if (picked.has(key)) continue
      if (picked.size >= MAX_EMBEDS) {
        omitted += 1
        continue
      }
      picked.set(key, { abs, raw: hit.path })
    }
  }
  const embeds = await toEmbeds([...picked.values()], contentWidth)
  // 进了候选但没量成（文件不存在 / 过大 / 读不到）的，同样计入「未内嵌」。
  omitted += picked.size - embeds.length
  return { embeds, omitted }
}

/** 逐个校验可读性并量高度（串行，复用常驻引擎）。 */
async function toEmbeds(picked: readonly { abs: string; raw: string }[], contentWidth: number): Promise<ShotEmbed[]> {
  const out: ShotEmbed[] = []
  for (const { abs, raw } of picked) {
    try {
      const info = await stat(abs)
      if (!info.isFile() || info.size <= 0 || info.size > MAX_EMBED_BYTES) continue
      if (!/\.html?$/i.test(extname(abs))) continue
      const fileUrl = 'file:///' + abs.replaceAll('\\', '/')
      const probed = await probePageHeight(fileUrl, contentWidth)
      out.push({ raw, abs, fileUrl, height: probed.height, trusted: probed.trusted })
    } catch {
      // 文件不存在 / 读不到：截图里就不出现，不报错（张数已计入 omitted）。
    }
  }
  return out
}

/** 截图保存目录。 */
export function screenshotHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'storages', 'dsh-chat-flow-screenshot')
}

/** 渲染引擎工作目录（profile + 临时页面，与成品图分开）。 */
function engineHome(): string {
  return join(screenshotHome(), '.engine')
}

// ── 预览缓存（渲染结果先留在内存，用户点保存才落盘）────────────────────────

interface CacheEntry {
  png: Buffer
  width: number
  height: number
  title: string
  at: number
}

const cache = new Map<string, CacheEntry>()

/** 写入缓存并淘汰最旧条目。 */
function cachePut(id: string, entry: CacheEntry): void {
  cache.set(id, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
}

/** 读 PNG 头部的像素宽高（IHDR 固定在第 16~24 字节）。 */
function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24) return { width: 0, height: 0 }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

// ── HTTP 工具 ───────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolvePromise({}); return }
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** 规整请求里的消息数组（丢弃空文本与非法角色，超量截断）。
 *  同时回报被丢弃的条数，供卡片页脚如实说明（截断不能静默）。 */
function parseMessages(input: unknown): { messages: ShotMessage[]; omitted: number } {
  if (!Array.isArray(input)) return { messages: [], omitted: 0 }
  const out: ShotMessage[] = []
  let omitted = 0
  for (const item of input) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const role = record.role === 'user' || record.role === 'assistant' ? record.role : null
    const text = typeof record.text === 'string' ? record.text : ''
    if (role === null || text.trim() === '') continue
    if (out.length >= MAX_MESSAGES) {
      omitted += 1
      continue
    }
    out.push({ role, text })
  }
  return { messages: out, omitted }
}

/** 规整主题（未知值回退浅色）。 */
function parseTheme(input: unknown): ShotTheme {
  return input === 'dark' || input === 'glass' || input === 'glass-dark' || input === 'reader' ? input : 'light'
}

/**
 * 规整内容缩放档位（缺省 1）。
 *
 * 钳到 [0.5, 3]：这个值来自请求体，脏数据不该把截图撑成一屏一个字。
 * 与 client 端 prefs.ts 的档位表是「宽松校验」关系——那边保证只发合法档位，
 * 这边不假设请求一定来自自家前端（路由是公开的）。
 */
function parseZoom(input: unknown): number {
  const value = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(3, Math.max(0.5, value))
}

/** 文件名安全化（用标题做文件名，去掉路径与非法字符）。 */
function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
  return cleaned === '' ? 'screenshot' : cleaned
}

// ── 路由处理 ────────────────────────────────────────────────────────────────

/**
 * POST /render：渲染并放入预览缓存（不落盘）。
 * body.html 存在时视为「编辑后的完整 HTML 文档」（跳过 buildCardHtml），
 * 供面板的「元素删除」编辑模式把改好的页面重新渲染成 PNG。
 */
async function handleRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, unknown>
  try {
    body = await readBody(req)
  } catch (error) {
    json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  const editedHtml = typeof body.html === 'string' && body.html.trim() !== '' ? body.html : null
  const { messages, omitted } = parseMessages(body.messages)
  if (editedHtml === null && messages.length === 0) {
    json(res, 400, { ok: false, error: '没有可截图的消息内容' })
    return
  }
  const theme = parseTheme(body.theme)
  // 支持直接指定数值宽度（360 ~ 2560），未指定时按旧版 device 回退
  const widthInput = typeof body.width === 'number' ? body.width : body.device
  const preset = resolveShotPreset(widthInput, body.quality)
  const viewportWidth = preset.cssWidth + canvasPad(preset.cssWidth) * 2
  // 相对路径的基准（会话工作目录）；客户端没带就退回进程 cwd。
  const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : undefined
  // 画幅比例（16:9、4:3、1:1、9:16、3:4 等，null 为跟随内容的自适应长图）
  const ratio = shotAspectRatio(body.aspect)
  const cardMinHeight = ratio !== null ? 160 : Math.min(preset.minHeight, 320)
  try {
    // 编辑模式：直接用前端传来的 HTML（已由面板删除过元素）；否则组装卡片。
    // 正文提到的本地 HTML 先探测高度再内嵌（每张要多导航一次）。
    const collected = editedHtml === null
      ? await collectEmbeds(messages, cwd, cardContentWidth(preset.cssWidth))
      : { embeds: [] as ShotEmbed[], omitted: 0 }
    const card = editedHtml !== null
      ? null
      : await buildCardHtml({
        messages, theme, width: preset.cssWidth, minHeight: cardMinHeight, embeds: collected.embeds,
        // 两条截断分开上报：消息条数被截 vs 本地 HTML 预览没内嵌，用户要做的
        // 处置不同（换截图范围 / 检查路径与体积）。
        omitted,
        omittedEmbeds: collected.omitted,
        title: typeof body.title === 'string' && body.title.trim() !== ''
          ? body.title.trim()
          : deriveTitle(messages[0]!.text, messages[0]!.role),
        label: typeof body.label === 'string' ? body.label : '',
        zoom: parseZoom(body.zoom),
      })
    const html = card !== null ? card.html : (editedHtml as string)
    const rendered = await renderPng({
      html,
      width: viewportWidth,
      height: preset.minHeight,
      aspectRatio: ratio,
      scale: preset.scale,
      needsMermaid: card !== null ? card.needsMermaid : html.includes('class="mermaid"'),
      needsFenceWait: card !== null ? card.hasFenceEmbed : html.includes('figure class="htmlfence"'),
    })
    const png = Buffer.from(rendered.base64, 'base64')
    const size = pngSize(png)
    const id = `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    cachePut(id, { png, ...size, title: typeof body.title === 'string' ? body.title : '', at: Date.now() })
    const actualRatio = size.width / size.height
    const aspectLocked = ratio === null ? true : Math.abs(actualRatio - ratio) / ratio < 0.05
    json(res, 200, {
      ok: true,
      id,
      imageUrl: `${ROUTE}/image?id=${encodeURIComponent(id)}`,
      bytes: png.length,
      aspectLocked,
      /*
       * 长图是否被输出预算截断（底部缺失）。
       *
       * 与 aspectLocked 分开：后者只在**固定画幅**模式下有意义（自适应长图恒为
       * true），而预算截断在任何模式下都会发生（4K 档约 5208 CSS px 就触发）。
       * 前端据此给出提示——不提示的话用户拿到一张少了尾巴的图却毫无察觉。
       */
      truncated: rendered.truncated,
      /** 截断前的原始内容高度（CSS px），供提示文案说明「本来有多长」。 */
      contentHeight: rendered.contentHeight,
      // 回传本次渲染用的完整 HTML，面板的「元素删除」编辑模式从这里取页面。
      html,
      ...size,
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** POST /save：把缓存里的预览写到 storages 目录。 */
async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, unknown>
  try {
    body = await readBody(req)
  } catch (error) {
    json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const entry = cache.get(id)
  if (entry === undefined) {
    json(res, 404, { ok: false, error: '预览已过期，请重新渲染' })
    return
  }
  try {
    const dir = screenshotHome()
    await mkdir(dir, { recursive: true })
    const stamp = new Date(entry.at).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = join(dir, `${stamp}_${safeFileName(entry.title)}.png`)
    await writeFile(file, entry.png)
    json(res, 200, { ok: true, path: file, dir })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** POST /reveal：在系统文件管理器里定位截图目录（win/mac/linux）。 */
async function handleReveal(res: ServerResponse): Promise<void> {
  const dir = screenshotHome()
  try {
    await mkdir(dir, { recursive: true })
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(command, [dir], { detached: true, stdio: 'ignore' }).unref()
    json(res, 200, { ok: true, dir })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /diagnose：引擎健康诊断——实例是否存在、CDP 是否可探活、重启后
 *  版本信息。排查「CDP 连接已关闭」不再靠猜。 */
async function handleDiagnose(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const report = await diagnoseEngine()
    json(res, 200, { ok: true, at: new Date().toISOString(), ...report })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /image：回读预览（?id=）或已保存文件（?file=）。 */
async function handleImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const id = url.searchParams.get('id') ?? ''
    if (id !== '') {
      const entry = cache.get(id)
      if (entry === undefined) { json(res, 404, { ok: false, error: '预览已过期' }); return }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
      res.end(entry.png)
      return
    }
    const file = url.searchParams.get('file') ?? ''
    const base = basename(file)
    if (base !== file || base === '') { json(res, 400, { ok: false, error: '文件名非法' }); return }
    const filePath = join(screenshotHome(), base)
    if (!existsSync(filePath)) { json(res, 404, { ok: false, error: '截图不存在' }); return }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
    res.end(await readFile(filePath))
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

/**
 * 挂载对话截图路由（在已注入 webServer 的子上下文中调用）。
 *
 * 注意：不能直接 `ctx.get('webServer')`——cordis 的 ctx 是 Proxy，未在
 * `inject` 中声明的属性一读就抛（见 host.ts 的踩坑注释）。调用方（host.ts）
 * 通过 `ctx.inject(['webServer'], webCtx => ...)` 延迟注入，本函数收到的是
 * webServer 已就绪的 webCtx，内部只用 effect 注册路由与渲染器回收。
 * @param webCtx - webServer 服务已就绪的插件上下文。
 */
export function applyScreenshot(webCtx: Context): void {
  const webServer = webCtx.webServer as WebServerService
  configureRenderer(engineHome)
  webCtx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const tail = url.pathname.slice(ROUTE.length)
      if (req.method === 'POST' && (tail === '/render' || tail === '' || tail === '/')) { void handleRender(req, res); return }
      if (req.method === 'POST' && tail === '/save') { void handleSave(req, res); return }
      if (req.method === 'POST' && tail === '/reveal') { void handleReveal(res); return }
      if (req.method === 'GET' && tail === '/image') { void handleImage(req, res); return }
      if (req.method === 'GET' && tail === '/diagnose') { void handleDiagnose(req, res); return }
      json(res, 404, { ok: false, error: '未知的截图接口' })
    },
  }), 'dsh-chat-plus: screenshot routes')
  // 插件卸载/重载时关掉常驻渲染实例，别留孤儿进程。
  webCtx.effect(() => () => { void shutdownRenderer() }, 'dsh-chat-plus: screenshot renderer shutdown')
}
