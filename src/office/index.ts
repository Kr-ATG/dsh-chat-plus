/**
 * dsh-chat-plus — Office / PDF 页图与 PDF 渲染（host 半身）。
 *
 * 回答一个问题：**点开一个 ppt / word / pdf 产出物，怎么在不依赖系统应用的前提下
 * 就地看见它。**
 *
 * ## 为什么自己渲染，而不是用官方那套
 *
 * 官方「侧边栏文档预览」对 ppt/word 走 `officeToPdf.render()` → LibreOffice 转
 * PDF → PDF.js 呈现。这条路本身没问题（本模块也复用它出 PDF），但有两个缺口：
 *
 *  1. **画廊缩略图没有出口**：官方只出整份 PDF，不出页图；画廊要给 ppt/word 画
 *     缩略图，必须有「第 1 页位图」。自己再截一次 PDF 反而绕。
 *  2. **弹窗（Lightbox）里塞 PDF.js 是另一个 7MB chunk**：官方那条链路的 pdf
 *     viewer 是懒加载的独立 chunk，复用它意味着把整套 PDF.js 拖进弹窗。这里改成
 *     服务端出页图 PNG —— 客户端就是一个 `<img>`，零新依赖、首帧快得多。
 *
 * ## 引擎与降级
 *
 * 转换引擎是**随官方 DSH 一起装好的** `@deepseek-ai/libreoffice-kit`
 * （`dsh-office-to-pdf` 的依赖，win32-x64 原生 LibreOffice + PDFium）。
 * 本插件不 vendor 它（原始 lib 里有约 1900 行纯 Node 逻辑 + 一个 178MB 的可执行
 * 文件，随包分发毫无意义），而是**运行时解析**：
 *
 *   · 沿 `process.argv[1]`（DSH 自己的 bin.js）向上找 `node_modules/@deepseek-ai/libreoffice-kit`；
 *   · 找不到（旧宿主 / 非 win32 / 没装 org 引擎）→ 本路由一律返回
 *     `{ ok:false, error:'engine-unavailable' }`，客户端据此退回到下载按钮。
 *
 * 解析走 `import(pathToFileURL(...))` 而不是裸 `import('@deepseek-ai/...')`：
 * host 产物必须自包含（build.mjs 的 assertHostExternals 会拦裸 specifier），
 * 而这里拿到的是**绝对路径**，不触发解析面。
 *
 * ## 目录问题（见 ../office/scratch.ts 的长注释）
 *
 * LibreOffice 写盘要求 TEMP 落在「带沙箱写 ACE」的目录里，否则本机实测
 * 100% 报 `impl_store failed 0x507/0xc10`。挂载时先经 `ensureOfficeScratch()`
 * 校正 `process.env.TEMP`（进程级 —— 官方 provider 读的是同一个变量，因此
 * 侧边栏那条路一并被修好）。
 *
 * ## 路由
 *
 *   GET  /api/chat-flow/office/info?path=…          — 探测可否渲染 + 页数（画廊用它决定画不画缩略图）
 *   GET  /api/chat-flow/office/page?path=…&page=1   — 第 N 页 PNG（磁盘缓存）
 *   GET  /api/chat-flow/office/pdf?path=…           — 整份 PDF（弹窗内嵌 / 侧边栏接管用）
 *
 * 准入：只认**本插件已索引过的产出物路径**（画廊索引 ∪ 会话产出清单），与
 * gallery/raw 同一口径 —— 这条路由族等于「读本机任意文件」，不能开成自由读。
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { admitPreviewPath, readGalleryDeps } from './admit.ts'
import { ensureOfficeScratch, refreshOfficeScratch } from './scratch.ts'
import { renderFileThumbnail } from '../shot/renderer.ts'

const ROUTE = '/api/chat-flow/office'

/**
 * 可渲染扩展名。
 *
 * 与 `libreoffice-kit` 的 `IMAGE_FORMATS` **逐字对齐**（doc/docx/odt/xls/xlsx/
 * ods/ppt/pptx/odp/pdf）。刻意不含 rtf / csv / tsv —— 它们既不在 kit 的图片
 * 渲染表里、也不在转换表里，收进来只会让请求跑到一半才报「不支持」，白等几秒。
 * 客户端用同一张表（api.ts 的 OFFICE_RENDERABLE_EXT）提前判断，两边别漂。
 */
const RENDERABLE_EXT = new Set([
  '.pdf', '.ppt', '.pptx', '.odp', '.doc', '.docx', '.odt',
  '.xls', '.xlsx', '.ods',
])

/** 工作表类（Calc）：kit 禁止对它们用「页号」，只能按工作表 + A1 区域渲染。 */
const SHEET_EXT = new Set(['.xls', '.xlsx', '.ods'])

/** 单文件上限（与官方 provider 的 maxInputBytes 同量级）。 */
const MAX_SOURCE_BYTES = 64 * 1024 * 1024

/** 页图 PNG 上限（超限不返回，避免往浏览器推巨图）。 */
const MAX_PAGE_BYTES = 12 * 1024 * 1024

/** 一次最多渲染几页（画廊只要第 1 页；弹窗翻页给到 12 页上限）。 */
const MAX_PAGES = 12

/** 页图 DPI（96 足够屏显；再高 PNG 体积涨得快）。 */
const PAGE_DPI = 110

/** 同一路径的转换并发上限（LibreOffice 原生后端本身是串行的，排队反而更稳）。 */
const MAX_CONCURRENT = 2

/** 页图缓存目录（落盘，跨重启复用）。 */
function cacheRoot(): string {
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh')
  return join(home, 'storages', 'dsh-office-preview')
}

/* ── 引擎解析 ────────────────────────────────────────────────────────── */

interface KitConverter {
  backend: 'native' | 'wasm'
  renderImages: (request: Record<string, unknown>, signal?: AbortSignal) => Promise<{
    readonly images: readonly { readonly page?: number; readonly path: string; readonly width: number; readonly height: number }[]
    readonly pageCount: number
    readonly rasterEngine: string
  }>
  convert: (request: { inputPath: string; outputPath: string }, signal?: AbortSignal) => Promise<unknown>
  dispose: () => Promise<void>
}

interface KitModule {
  createConverter: (options?: Record<string, unknown>) => Promise<KitConverter>
}

let kitPromise: Promise<KitModule | null> | null = null

/**
 * 定位随 DSH 安装的 libreoffice-kit。
 *
 * 三条路依次试，任何一条命中即用（顺序 = 判据强度）：
 *  1. 从 DSH 的启动入口（`process.argv[1]`，即 `.../@deepseek-ai/dsh/lib/bin.js`）
 *     向上找 node_modules —— 正常运行时的主路；
 *  2. 从模块自身位置向上找（已安装位置下 profile 的 node_modules 是软链，可能
 *     直接解析得到）；
 *  3. `createRequire` 按标准解析（宿主开了 tsconfig paths 或做了 hoisting 时命中）。
 *
 * @param startDirs - 起始目录（缺省取真实运行时的三个锚点；冒烟会显式传入以
 *   在源码目录下也能对拍这条向上查找逻辑）。
 * @returns 包的绝对入口路径；找不到返回 null。
 */
function locateKit(startDirs?: readonly string[]): string | null {
  const dirs: string[] = []
  const pushDir = (value: string): void => {
    if (value === '' || !isAbsolute(value)) return
    let dir = value
    // 文件 → 用它所在目录起步。
    try {
      if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir)
    } catch { /* 读不到就当目录用 */ }
    if (!dirs.includes(dir)) dirs.push(dir)
  }
  if (startDirs === undefined) {
    pushDir(process.argv[1] ?? '')
    pushDir(fileURLToPath(import.meta.url))
    pushDir(process.execPath)
  } else {
    for (const dir of startDirs) pushDir(dir)
  }

  for (const start of dirs) {
    let dir = start
    for (let depth = 0; depth < 8; depth++) {
      const candidate = join(dir, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js')
      if (existsSync(candidate)) return candidate
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  // 兜底：走标准解析（宿主可能已经把包挂进插件可见的 node_modules —— 已安装
  // 位置下 profile 的 node_modules 就在本模块上方两层）。以**模块自身路径**为
  // 基准而不是 argv[1]：前者在任何加载方式下都指向真实文件。
  try {
    const require = createRequire(fileURLToPath(import.meta.url))
    return require.resolve('@deepseek-ai/libreoffice-kit')
  } catch {
    return null
  }
}

/** 懒加载引擎（只 import 一次；失败后缓存 null，不再反复撞）。 */
function loadKit(): Promise<KitModule | null> {
  if (kitPromise !== null) return kitPromise
  kitPromise = (async () => {
    const entry = locateKit()
    if (entry === null) return null
    try {
      const mod = await import(pathToFileURL(entry).href) as unknown as KitModule
      return typeof mod.createConverter === 'function' ? mod : null
    } catch {
      return null
    }
  })()
  return kitPromise
}

/** 引擎是否可用（供 info 路由与诊断回显）。 */
export async function officeEngineAvailable(): Promise<boolean> {
  return (await loadKit()) !== null
}

/** 页图缓存根目录（冒烟用它确认产物落盘位置）。 */
export function officeCacheRoot(): string {
  return cacheRoot()
}

/* ── 串行队列 ────────────────────────────────────────────────────────── */

let running = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) { running += 1; return }
  await new Promise<void>((resolvePromise) => { waiting.push(resolvePromise) })
  running += 1
}

function release(): void {
  running -= 1
  const next = waiting.shift()
  if (next !== undefined) next()
}

/* ── 准入（与 gallery/raw 同口径：只认索引过的产出物）────────────────── */

/** 准入一个路径（判据与会话作用域兜底见 ./admit.ts）。 */
async function admit(ctx: Context, raw: string, sessionId: string): Promise<string | null> {
  return admitPreviewPath(ctx, raw, sessionId)
}

function readDeps(ctx: Context): ReturnType<typeof readGalleryDeps> {
  return readGalleryDeps(ctx)
}

/* ── 渲染核心 ────────────────────────────────────────────────────────── */

/** 源文件身份（路径 + mtime + 大小）→ 缓存键。文件一变，缓存自动失效。 */
function cacheKeyOf(path: string): string {
  const info = statSync(path)
  return createHash('sha1')
    .update(`${path}|${info.mtimeMs}|${info.size}`)
    .digest('hex')
    .slice(0, 24)
}

let sharedConverter: KitConverter | null = null

/** 取（或建）共享转换器；LibreOffice 原生后端一个进程一个足够。 */
async function converter(): Promise<KitConverter | null> {
  const kit = await loadKit()
  if (kit === null) return null
  if (sharedConverter !== null) return sharedConverter
  // 每次转换前校正工作目录：workspace 可能换了，scratch 可能被清掉。
  refreshOfficeScratch()
  try {
    sharedConverter = await kit.createConverter({ timeoutMs: 120_000 })
    return sharedConverter
  } catch {
    return null
  }
}

/** 一次渲染的产物描述。 */
export interface RenderedOffice {
  readonly key: string
  readonly pageCount: number
  readonly rasterEngine: string
  /** 已落盘的页图路径（按页序）。 */
  readonly pages: readonly { readonly page: number; readonly file: string; readonly width: number; readonly height: number }[]
}

/**
 * 渲染一个文档的首 N 页为 PNG（结果落盘缓存，重复请求直接复用）。
 *
 * @param path - 已准入的绝对路径。
 * @param pages - 需要的页码（1 起算），空数组表示只探页数。
 * @returns 渲染产物；失败抛错（调用方翻成 HTTP 状态）。
 */
export async function renderOfficePages(path: string, pages: readonly number[]): Promise<RenderedOffice> {
  const ext = extname(path).toLowerCase()
  if (!RENDERABLE_EXT.has(ext)) throw new Error('unsupported-format')
  const info = await stat(path)
  if (!info.isFile() || info.size <= 0) throw new Error('not-found')
  if (info.size > MAX_SOURCE_BYTES) throw new Error('input-too-large')

  const key = cacheKeyOf(path)
  const dir = join(cacheRoot(), key)
  const manifestFile = join(dir, 'manifest.json')

  // 缓存命中：只补渲染缺失的页。
  let manifest: RenderedOffice | null = null
  if (existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as RenderedOffice
      const ok = manifest.pages.every((entry) => existsSync(entry.file))
      if (!ok) manifest = null
    } catch {
      manifest = null
    }
  }

  const missing = pages.filter((page) => manifest === null || !manifest.pages.some((entry) => entry.page === page))
  if (manifest !== null && missing.length === 0) return manifest

  const kit = await loadKit()
  if (kit === null) throw new Error('engine-unavailable')

  await acquire()
  try {
    refreshOfficeScratch()
    const instance = await converter()
    if (instance === null) throw new Error('engine-unavailable')
    /*
     * 输出目录必须**独占且全新**：kit 的 renderImages 用 `mkdir(dir, {mode})`
     * 建它，已存在直接 EEXIST 抛错（不是「复用已有目录」）。所以每次都用带
     * 随机段的新目录，渲染完再整块删掉 —— 缓存键在上一层的 `dir`（按源文件
     * mtime + size），页图已经拷进那里，batch 目录纯属中转。
     */
    const outDir = join(
      cacheRoot(),
      `batch-${key}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    )
    let result: Awaited<ReturnType<KitConverter['renderImages']>>
    // 工作表（xls/xlsx/ods）**禁止**传 pages：kit 的入参校验会直接抛
    // `Worksheets use sheet and A1 range, not printed page numbers.`。退一步
    // 是「所有可见工作表的已用区域」——对缩略图/首页预览正好是想要的画面。
    const sheet = SHEET_EXT.has(ext)
    try {
      result = await instance.renderImages({
        inputPath: path,
        outputDir: outDir,
        ...(sheet || pages.length === 0 ? {} : { pages }),
        dpi: PAGE_DPI,
        maxPages: Math.max(MAX_PAGES, pages.length),
        maxDimension: 4096,
        maxPixels: 16_000_000,
      })
    } catch (error) {
      await rm(outDir, { recursive: true, force: true }).catch(() => {})
      sharedConverter = null
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`render-failed: ${message}`)
    }

    mkdirSync(dir, { recursive: true })
    const merged = new Map<number, { page: number; file: string; width: number; height: number }>()
    for (const entry of manifest?.pages ?? []) merged.set(entry.page, entry)
    // 引擎回传的是绝对路径；拷进自己的缓存目录，这样 batch 目录可以整块删。
    let index = 0
    for (const image of result.images) {
      index += 1
      const page = image.page ?? pages[index - 1] ?? index
      const bytes = await readFile(image.path)
      if (bytes.byteLength > MAX_PAGE_BYTES) continue
      const target = join(dir, `page-${page}.png`)
      const tmpTarget = `${target}.tmp-${Date.now().toString(36)}`
      await writeFile(tmpTarget, bytes)
      renameSync(tmpTarget, target)
      merged.set(page, { page, file: target, width: image.width, height: image.height })
    }
    await rm(outDir, { recursive: true, force: true }).catch(() => {})

    if (merged.size === 0) throw new Error('render-failed: no pages')
    const next: RenderedOffice = {
      key,
      pageCount: result.pageCount,
      rasterEngine: result.rasterEngine,
      pages: [...merged.values()].sort((a, b) => a.page - b.page),
    }
    const tmpManifest = `${manifestFile}.tmp-${Date.now().toString(36)}`
    await writeFile(tmpManifest, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmpManifest, manifestFile)
    return next
  } finally {
    release()
  }
}

/**
 * 转换整份文档为 PDF（弹窗内嵌 + 侧边栏接管共用）。
 *
 * 与页图走同一条引擎，只是输出格式不同；结果同样落盘缓存。
 *
 * @param path - 已准入的绝对路径。
 * @returns PDF 的绝对路径。
 */
export async function renderOfficePdf(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (!RENDERABLE_EXT.has(ext)) throw new Error('unsupported-format')
  if (ext === '.pdf') return path

  const key = cacheKeyOf(path)
  const dir = join(cacheRoot(), key)
  const target = join(dir, 'document.pdf')
  if (existsSync(target)) return target

  await acquire()
  try {
    refreshOfficeScratch()
    const instance = await converter()
    if (instance === null) throw new Error('engine-unavailable')
    mkdirSync(dir, { recursive: true })
    /*
     * 临时输出名必须**保留 .pdf 后缀**：kit 的 convert 按 `--output-path` 的
     * 扩展名选转换过滤器，名字以 `.tmp-xxx` 结尾会直接报
     * `Unsupported conversion: pptx → tmp-xxx`。
     */
    const tmpTarget = join(dir, `document.${Date.now().toString(36)}.pdf`)
    try {
      await instance.convert({ inputPath: path, outputPath: tmpTarget })
      renameSync(tmpTarget, target)
      return target
    } catch (error) {
      await rm(tmpTarget, { force: true }).catch(() => {})
      sharedConverter = null
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`convert-failed: ${message}`)
    }
  } finally {
    release()
  }
}

/* ── HTTP ────────────────────────────────────────────────────────────── */

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

/** 错误 → HTTP 状态 + 人话。 */
function fail(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'engine-unavailable') {
    json(res, 503, { ok: false, error: 'engine-unavailable', message: '未找到绑定的 LibreOffice 引擎（随 DSH 安装）。' })
    return
  }
  if (message === 'unsupported-format') { json(res, 415, { ok: false, error: 'unsupported-format' }); return }
  if (message === 'not-found') { json(res, 404, { ok: false, error: 'not-found' }); return }
  if (message === 'input-too-large') { json(res, 413, { ok: false, error: 'input-too-large' }); return }
  json(res, 500, { ok: false, error: 'render-failed', message: message.slice(0, 400) })
}

async function handleInfo(ctx: Context, url: URL, res: ServerResponse): Promise<void> {
  const path = await admit(ctx, url.searchParams.get('path') ?? '', url.searchParams.get('session') ?? '')
  if (path === null) { json(res, 403, { ok: false, error: 'forbidden' }); return }
  const ext = extname(path).toLowerCase()
  if (!RENDERABLE_EXT.has(ext)) {
    json(res, 200, { ok: true, renderable: false, scratch: refreshOfficeScratch() })
    return
  }
  /*
   * pdf 不需要引擎：/office/pdf 对 .pdf 是原样转发（浏览器内置查看器渲染），
   * 引擎只服务 Office → PDF 的转换。所以 pdf 的 renderable 恒真 —— 否则
   * 「没装引擎的机器上连 PDF 都预览不了」，比官方原状还差。
   */
  if (ext === '.pdf') {
    json(res, 200, { ok: true, renderable: true, engine: true, scratch: refreshOfficeScratch(), path })
    return
  }
  const engine = await officeEngineAvailable()
  json(res, 200, {
    ok: true,
    renderable: engine,
    engine,
    // 回显工作目录：这条路由同时是排查「转换失败」的诊断入口。
    scratch: refreshOfficeScratch(),
    path,
  })
}

async function handlePage(ctx: Context, url: URL, res: ServerResponse): Promise<void> {
  const path = await admit(ctx, url.searchParams.get('path') ?? '', url.searchParams.get('session') ?? '')
  if (path === null) { json(res, 403, { ok: false, error: 'forbidden' }); return }
  const page = Math.max(1, Math.min(MAX_PAGES, Number(url.searchParams.get('page') ?? '1') || 1))
  try {
    const rendered = await renderOfficePages(path, [page])
    const entry = rendered.pages.find((candidate) => candidate.page === page) ?? rendered.pages[0]
    if (entry === undefined) { json(res, 404, { ok: false, error: 'page-not-found', pageCount: rendered.pageCount }); return }
    const bytes = await readFile(entry.file)
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      // 页数 / 引擎随头部回传，客户端不必再单独探一次 info。
      'x-dsh-page': String(entry.page),
      'x-dsh-page-count': String(rendered.pageCount),
      'x-dsh-raster': rendered.rasterEngine,
      'access-control-expose-headers': 'x-dsh-page,x-dsh-page-count,x-dsh-raster',
    })
    res.end(bytes)
  } catch (error) {
    fail(res, error)
  }
}

async function handlePdf(ctx: Context, url: URL, res: ServerResponse): Promise<void> {
  const path = await admit(ctx, url.searchParams.get('path') ?? '', url.searchParams.get('session') ?? '')
  if (path === null) { json(res, 403, { ok: false, error: 'forbidden' }); return }
  try {
    const file = await renderOfficePdf(path)
    const bytes = await readFile(file)
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    })
    res.end(bytes)
  } catch (error) {
    fail(res, error)
  }
}

/* ── 缩略图（画廊卡片用：html 成品的首屏截图 / pdf 与 Office 的首页位图）── */

/** 缩略图宽度（CSS px）；按卡片比例给，不读真实内容高度。 */
const THUMB_WIDTH = 480
/** 缩略图高度（CSS px）：4:3，与画廊卡片的 aspect-ratio 对齐。 */
const THUMB_HEIGHT = 360
/** 缩略图输出缩放（2x 供高分屏；480×360×2 的 PNG 通常一两百 KB）。 */
const THUMB_SCALE = 2
/** 缩略图字节上限（超限不返回，客户端回落类型图标）。 */
const MAX_THUMB_BYTES = 3 * 1024 * 1024

/** HTML 成品缩略图的缓存目录（与 Office 页图分开，键也不同）。 */
function thumbDir(key: string): string {
  return join(cacheRoot(), 'thumbs', key)
}

/** HTML 成品：用常驻无头浏览器截首屏。 */
async function renderHtmlThumb(path: string): Promise<string> {
  const key = cacheKeyOf(path)
  const dir = thumbDir(key)
  const target = join(dir, 'thumb.png')
  if (existsSync(target) && statSync(target).size > 0) return target
  const fileUrl = `file:///${path.replaceAll('\\', '/')}`
  const base64 = await renderFileThumbnail(fileUrl, THUMB_WIDTH, THUMB_HEIGHT, THUMB_SCALE)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength > MAX_THUMB_BYTES) throw new Error('thumb-too-large')
  mkdirSync(dir, { recursive: true })
  const tmp = `${target}.tmp-${Date.now().toString(36)}`
  await writeFile(tmp, bytes)
  renameSync(tmp, target)
  return target
}

/**
 * 缩略图路由：按扩展名分流到「无头浏览器截首屏」或「LibreOffice 首页位图」。
 *
 * 存在的理由：画廊里 html / ppt / word 三类卡片此前只有一枚类型图标，一整屏
 * 长得一样的占位图，用户根本认不出哪张是哪张。这两条链路各修一处就能都补上，
 * 而且客户端只要一个 `<img src>`。
 */
async function handleThumb(ctx: Context, url: URL, res: ServerResponse): Promise<void> {
  const path = await admit(ctx, url.searchParams.get('path') ?? '', url.searchParams.get('session') ?? '')
  if (path === null) { json(res, 403, { ok: false, error: 'forbidden' }); return }
  const ext = extname(path).toLowerCase()
  try {
    let file: string
    if (ext === '.html' || ext === '.htm' || ext === '.xhtml') {
      file = await renderHtmlThumb(path)
    } else {
      const rendered = await renderOfficePages(path, [1])
      const entry = rendered.pages[0]
      if (entry === undefined) { json(res, 404, { ok: false, error: 'no-pages' }); return }
      file = entry.file
    }
    const bytes = await readFile(file)
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    })
    res.end(bytes)
  } catch (error) {
    fail(res, error)
  }
}

/** 导出给冒烟：可测面（引擎解析 / 准入登记 / 扩展名表）。 */
export const __test = {
  locateKit,
  RENDERABLE_EXT,
  cacheRoot,
  resolveRoute: (tail: string): string | null => {
    if (tail === '/info' || tail === '/info/') return 'info'
    if (tail === '/page' || tail === '/page/') return 'page'
    if (tail === '/pdf' || tail === '/pdf/') return 'pdf'
    if (tail === '/thumb' || tail === '/thumb/') return 'thumb'
    return null
  },
}

/**
 * 挂载 Office 预览路由（webServer 已就绪的子上下文里调用）。
 * @param webCtx - webServer 可用的插件上下文。
 */
export function applyOfficePreview(webCtx: Context): void {
  // 挂载时先校正一次工作目录。这一步必须在**插件挂载最早**发生：官方
  // office-to-pdf provider 与我们在同一进程里，它读的就是 process.env.TEMP，
  // 因此这一次校正顺带把「官方侧边栏的 ppt/word 预览」一并修好。
  ensureOfficeScratch(readDeps(webCtx).sessions)
  const webServer = (webCtx as unknown as {
    webServer: { register: (route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => () => void }
  }).webServer
  webCtx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const tail = url.pathname.slice(ROUTE.length)
      if (tail === '/info' || tail === '/info/') { void handleInfo(webCtx, url, res); return }
      if (tail === '/page' || tail === '/page/') { void handlePage(webCtx, url, res); return }
      if (tail === '/pdf' || tail === '/pdf/') { void handlePdf(webCtx, url, res); return }
      if (tail === '/thumb' || tail === '/thumb/') { void handleThumb(webCtx, url, res); return }
      json(res, 404, { ok: false, error: 'unknown office endpoint' })
    },
  }), 'dsh-chat-plus: office preview routes')
}
