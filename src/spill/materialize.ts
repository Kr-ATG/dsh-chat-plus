/**
 * dsh-chat-plus — 生图 spill 结果的「落盘物化」（host 半身）。
 *
 * ## 为什么需要它（2026-10-19）
 *
 * 画廊里的生图条目来自 `generate_image` 的工具结果。结果 JSON 很大（含 base64
 * 图，2~9MB），超过 DSH spill 阈值后被 `dsh-spill-local` 落成
 * `<spillRoot>/session-<12hex>/<hash>-generate_image.txt`，事件里只剩 locator。
 * 画廊靠 `GET /api/chat-flow/generated-images` 把图片 URL 读回来显示 —— 那条路
 * 只解决「看得见」，没解决「点得开」。
 *
 * 官方右侧 Sidebar 的文档预览只能打开**真实文件**（它走的是工作区文件树 /
 * 文件地址那条链路，见 src/client/sidebar-doc/）。spill 文本里的 data URL 不是
 * 文件，于是用户点生图格子只能弹插件自己的 lightbox，没法像普通产出物那样在
 * 侧栏里预览、下载、复制路径。
 *
 * 所以这里把「只存在于 spill 文本里的图片」解码/下载成真实图片文件，落在
 * `<DSH_HOME>/storages/dsh-chat-plus-generated/<key>/img-N.<ext>`，再把绝对路径
 * 交给浏览器 —— 之后它与任何普通文件没有区别。
 *
 * ## 为什么按 spill 路径的 sha1 分目录
 *
 * 一条 spill 文本 = 一次 `generate_image` 调用 = 一组图。用 spill 绝对路径的
 * sha1 前 16 位当目录名，得到三条性质：
 *  - **稳定**：同一张图重复点击（或换了浏览器、重启进程）都落到同一个目录，
 *    可以直接复用已有文件（幂等，不重复解码 / 不重复下载）；
 *  - **无冲突**：不同 spill 文件的图片互不覆盖；
 *  - **不泄露**：目录名与文件名无关，spill 路径不会被编码进可读的 URL 片段。
 *
 * ## 准入（安全面）
 *
 * 与 `handleGeneratedImages` **逐字同一口径**：`admitSpillPath(file, spillRoots(active))`。
 * 尤其不能退化成「只认当前进程 root」—— spill root 每次启动都换名字，那样历史
 * 会话的生图会整批 403（2026-10-06 已经踩过一次，详见 src/spill/index.ts）。
 *
 * 写盘是新增能力（原路由只读），所以还多一道：GET/POST 都过跨站闸门
 * （`rejectCrossSite`）。否则任意网页一个 CORS 简单请求就能反复往磁盘写文件。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rejectCrossSite } from '../shared/csrf.ts'
import { admitSpillPath, spillRoots } from './index.ts'

/** 路由（exact）。客户端与冒烟照这个常量对拍，避免两处各写一遍字面量。 */
export const MATERIALIZE_ROUTE = '/api/chat-flow/generated-images/materialize'

/** spill 文本上限：与 host.ts 原路由同口径（2720×1536 PNG base64 约 9MB，留余量到 24MB）。 */
const MAX_SPILL_BYTES = 24 * 1024 * 1024

/** 单张图片上限：超过就跳过这一张而不是整批失败（一张坏图不该毁掉整组）。 */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024

/** http(s) 图片下载超时。 */
const FETCH_TIMEOUT_MS = 30_000

/** data URL 的 base64 前缀（MIME 允许为空：data:;base64,... 也合法）。 */
const DATA_URL_RE = /^data:([^;,]*);base64,/i

/** MIME → 扩展名。未知一律 png（契约如此；浏览器按内容嗅探也能显示）。 */
const MIME_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 落盘结果（顺序 = 图片顺序）。 */
export interface MaterializedFile {
  /** 落盘文件的绝对路径（Sidebar 直接拿它当普通文件打开）。 */
  readonly path: string
  /** 文件名（img-1.png 这类；侧栏显示用）。 */
  readonly name: string
}

/** 从 OpenAI 兼容响应体提取图片 URL（b64_json → data URL，其次 url）。 */
function collectImageUrls(data: unknown): string[] {
  const urls: string[] = []
  if (!Array.isArray(data)) return urls
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { b64_json?: unknown; url?: unknown }
    let url: string | null = null
    if (typeof record.b64_json === 'string' && record.b64_json !== '') {
      url = 'data:image/png;base64,' + record.b64_json.replace(/\s+/g, '')
    } else if (typeof record.url === 'string' && record.url !== '') {
      url = record.url
    }
    if (url !== null && !urls.includes(url)) urls.push(url)
  }
  return urls
}

/**
 * 解析生图结果 JSON 文本，提取 { ok, urls, model }（对齐客户端 parse.ts）。
 *
 * 从 host.ts 原样搬来这里并 export：读图与落盘两条路由必须共用同一份解析，
 * 否则会出现「画廊显示 3 张、落盘只有 2 张」这种两套真相的漂移。host.ts 反向
 * import 本函数，行为与原私有实现逐字一致。
 *
 * @param text - spill 文件全文（JSON 文本）。
 * @returns ok = 解析出至少一张图；urls 保持结果里的原始顺序。
 */
export function parseGeneratedResult(text: string): { ok: boolean; urls: string[]; model: string | null } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, urls: [], model: null }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, urls: [], model: null }
  const record = parsed as Record<string, unknown>
  if (record.ok !== true) return { ok: false, urls: [], model: null }
  const data = record.data as { data?: unknown } | undefined
  let urls = collectImageUrls(data?.data)
  if (urls.length === 0 && Array.isArray(record.imageUrls)) {
    urls = record.imageUrls.filter((item): item is string => typeof item === 'string' && item !== '')
  }
  if (urls.length === 0) {
    for (const key of ['imageUrl', 'imageDataUrl'] as const) {
      const value = record[key]
      if (typeof value === 'string' && value !== '') urls.push(value)
    }
  }
  const model = typeof record.model === 'string' && record.model !== '' ? record.model : null
  return { ok: urls.length > 0, urls, model }
}

/**
 * 落盘根目录：`<DSH_HOME>/storages/dsh-chat-plus-generated`。
 *
 * `DSH_HOME` 的取法与 `src/office/index.ts` 的 `cacheRoot()` **逐字一致**：官方
 * 在部分环境里不设这个变量，此时退回 `~/.dsh`。两处口径若漂移，插件会静默进入
 * 「一半产物在 A 目录、一半在 B 目录」的状态。
 */
export function materializeRoot(): string {
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh')
  return join(home, 'storages', 'dsh-chat-plus-generated')
}

/**
 * 一条 spill 路径对应的落盘目录（纯函数，稳定可对拍）。
 *
 * 用 sha1(绝对路径) 前 16 位 hex：同一路径恒等、不同路径极难碰撞、长度固定
 * （16 字符），且目录名不携带原路径信息。
 *
 * @param spillPath - spill 文本的绝对路径（准入通过后的那个）。
 * @returns 该 spill 对应的绝对目录路径。
 */
export function materializeCacheDir(spillPath: string): string {
  const key = createHash('sha1').update(spillPath).digest('hex').slice(0, 16)
  return join(materializeRoot(), key)
}

/**
 * 判定一张图片 URL 该落成什么扩展名。
 *
 * data URL 读 MIME；http(s) 与其它形态一律 png。**刻意不嗅探下载回来的
 * content-type**：契约要求「未知一律 png」，而嗅探会让同一张图在两次请求里
 * 得到不同扩展名，破坏幂等复用。
 *
 * @param url - 已解析出的一条图片 URL。
 * @returns 扩展名（不带点）。
 */
export function extensionFor(url: string): string {
  const match = DATA_URL_RE.exec(url)
  if (match === null) return 'png'
  const mime = match[1].trim().toLowerCase()
  return MIME_EXT[mime] ?? 'png'
}

/**
 * data URL → 原始字节。
 *
 * @param url - data URL（`data:<mime>;base64,<payload>`）。
 * @returns 解码后的 Buffer；解不出来返回 null（调用方跳过这张）。
 */
export function decodeDataUrl(url: string): Buffer | null {
  const match = DATA_URL_RE.exec(url)
  if (match === null) return null
  const payload = url.slice(match[0].length).replace(/\s+/g, '')
  if (payload === '') return null
  try {
    const bytes = Buffer.from(payload, 'base64')
    return bytes.byteLength > 0 ? bytes : null
  } catch {
    return null
  }
}

/**
 * 「这段字节像个图片吗」的最小判据（magic number）。
 *
 * 为什么需要：Buffer 的 base64 解码对**任何**字符串都不抛错（它只是丢掉非法
 * 字符），所以被截断 / 被污染的 payload 会成功解出一坨垃圾字节，落成 img-1.png
 * 后侧栏打开就是裂图 —— 而日志里一切正常。宁可少落一张，也不落一张坏图。
 *
 * @param bytes - 待落盘的字节。
 * @returns true = 头部像 PNG / JPEG / GIF / WebP 之一。
 */
export function looksLikeImage(bytes: Buffer): boolean {
  if (bytes.byteLength < 12) return false
  // PNG：89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true
  // JPEG：FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  // GIF：GIF87a / GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true
  // WebP：RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true
  return false
}

/**
 * 原子写盘：先写同目录临时文件，成功再 rename。
 *
 * 为什么不直接 writeFileSync 到目标名：Sidebar 的预览器可能在写入途中就来打开
 * 这个文件，半截 PNG 会被浏览器图片缓存记成坏图，之后即使补全也一直显示裂图。
 * rename 在同一文件系统内是原子的 —— 读者要么看不到，要么看到完整文件。
 *
 * 临时名带 pid + 随机段：同一张图被连点两次时两个请求会并发写，固定名会互相
 * 截断（与 download/index.ts、memory/engine/store.ts 同一个坑、同一个修法）。
 *
 * @param target - 目标绝对路径。
 * @param bytes - 完整内容。
 */
function writeAtomic(target: string, bytes: Buffer): void {
  const tmp = target + '.tmp-' + String(process.pid) + '-' + Math.random().toString(36).slice(2, 8)
  writeFileSync(tmp, bytes)
  try {
    renameSync(tmp, target)
  } catch (error) {
    // rename 失败时临时文件必须删掉：留在缓存目录里会被用户（和 Sidebar 列表）
    // 当成一个正经产物看见，而它多半是半截或空文件。删不掉也不能掩盖原始错误。
    try { rmSync(tmp, { force: true }) } catch { /* 尽力而为 */ }
    throw error
  }
}

/**
 * 目标文件可复用判定（幂等）。
 *
 * 判据是「存在且大小 > 0」，**不比对内容**：内容比对意味着每次点击都要把整张图
 * 读一遍（9MB × N），而 spill 文本不可变、同一序号的内容必然相同；大小 > 0 只是
 * 排除「上次写到一半进程被杀」留下的空壳文件。
 *
 * @param target - 目标绝对路径。
 * @returns true = 已经落过盘，直接复用。
 */
export function reusable(target: string): boolean {
  if (!existsSync(target)) return false
  try {
    return statSync(target).size > 0
  } catch {
    return false
  }
}

/**
 * http(s) 图片 → 字节。失败（网络错误 / 超时 / 超限 / 非 2xx）一律返回 null。
 *
 * @param url - 图片地址。
 * @returns 图片字节；任何异常都吞掉并返回 null（调用方跳过这张，不整批失败）。
 */
export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) return null
    // 先看 content-length：超限的图根本不下载（省带宽，也避免拉满 24MB 才丢）。
    const declared = response.headers.get('content-length')
    if (declared !== null && declared !== '' && Number(declared) > MAX_IMAGE_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null
    return bytes
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把一条 spill 文本里的图片全部落盘。
 *
 * 逐张独立成败：某一张解码失败 / 下载超时 / 超限 / 不是图片，就跳过它继续下一
 * 张（契约要求「超限跳过该张而不是整批失败」「失败也跳过不抛」）。因此返回列表
 * 可能比图片数量少 —— 调用方按返回结果展示，不要拿 urls.length 对账。
 *
 * @param spillText - spill 文件全文。
 * @param outDir - 落盘目录（不存在时由本函数创建）。
 * @returns 成功落盘的文件列表（顺序 = 图片顺序）。
 */
export async function materializeImages(spillText: string, outDir: string): Promise<MaterializedFile[]> {
  const parsed = parseGeneratedResult(spillText)
  if (!parsed.ok) return []
  mkdirSync(outDir, { recursive: true })
  const files: MaterializedFile[] = []
  for (let index = 0; index < parsed.urls.length; index++) {
    const url = parsed.urls[index]
    const name = 'img-' + String(index + 1) + '.' + extensionFor(url)
    const target = join(outDir, name)
    // 幂等：已经落过盘就直接复用，不重复解码 base64（每张约 9MB，代价很实在）。
    if (reusable(target)) {
      files.push({ path: target, name })
      continue
    }
    const bytes = url.startsWith('data:')
      ? decodeDataUrl(url)
      : /^https?:\/\//i.test(url) ? await fetchImageBytes(url) : null
    if (bytes === null || !looksLikeImage(bytes)) continue
    try {
      writeAtomic(target, bytes)
      files.push({ path: target, name })
    } catch {
      // 单张写盘失败（磁盘满 / 权限）不毁整批：其余图片照常落。
    }
  }
  return files
}

/** 路由的失败面：状态码与文案由这里定，异常细节一律不外泄。 */
type Failure = { readonly status: 403 | 404 | 422; readonly error: string }

/**
 * 路由主体：准入 → 读 spill → 解析 → 落盘。
 *
 * @param ctx - webServer 所在上下文（用来 `ctx.get('spillStore')` 取活动 root）。
 * @param file - query / body 里的 spill 绝对路径。
 * @returns 落盘成功的文件列表，或一个带状态码的失败。
 */
async function run(
  ctx: Record<string, any>,
  file: string,
): Promise<{ ok: true; files: MaterializedFile[] } | ({ ok: false } & Failure)> {
  const store: any = ctx.get?.('spillStore')
  const active = typeof store?.root === 'string' && store.root !== '' ? store.root : undefined
  const verdict = admitSpillPath(file, spillRoots(active))
  if (!verdict.ok) return { ok: false, status: 403, error: 'forbidden' }

  const target = verdict.path
  let size: number
  try {
    size = statSync(target).size
  } catch {
    // 真的不在了（超过 spill 保留期 / 被清理）—— 与准入失败分开报，客户端可以
    // 据此把这条从画廊里剔掉，而不是当成「没权限」无限重试。
    return { ok: false, status: 404, error: 'spill file not found' }
  }
  if (size <= 0) return { ok: false, status: 404, error: 'spill file not found' }
  /*
   * 超大 spill（>24MB）按 422 而不是读图路由的 413 报：契约里这条路由只有四种
   * 失败形状（403/404/422/500），没有 413。语义上也说得通 —— 这么大的一份 spill
   * 不可能是本插件认识的那种生图结果。
   */
  if (size > MAX_SPILL_BYTES) return { ok: false, status: 422, error: 'spill content is not a generated-image result' }

  let text: string
  try {
    text = readFileSync(target, 'utf8')
  } catch {
    return { ok: false, status: 404, error: 'spill file not found' }
  }
  if (!parseGeneratedResult(text).ok) {
    return { ok: false, status: 422, error: 'spill content is not a generated-image result' }
  }

  const outDir = materializeCacheDir(target)
  let files: MaterializedFile[]
  try {
    files = await materializeImages(text, outDir)
  } catch {
    // 连 mkdir 都失败（磁盘满 / 权限 / DSH_HOME 指向只读盘）：整批失败，500。
    throw new Error('materialize-failed')
  }
  /*
   * 解析得出生图、但一张都没落成：这是「全部写盘失败」（下载超时 / 字节不是图片 /
   * 磁盘写不进），按契约回 500 materialize failed，**不要**报成 422 —— 422 的语义
   * 是「这条 spill 根本不是生图结果」，客户端会据此把条目从画廊里永久剔掉；而落盘
   * 失败往往是临时的（网络抖一下、磁盘满），重试就能好。两者混用会让用户丢条目。
   */
  if (files.length === 0) throw new Error('materialize-failed')
  return { ok: true, files }
}

/**
 * 读请求体里的 `{ file }`（POST）。非法 / 超长 / 空体一律给空串，交给准入判 403。
 *
 * 为什么要限长：body 只需要一个路径字符串，不设上限时一个请求就能推几百 MB
 * 把内存吃光。8KB 足够容纳任何 Windows 绝对路径。
 *
 * @param req - node IncomingMessage 形状。
 * @returns body 里的 file 字段（可能为空串）。
 */
function readBodyFile(req: any): Promise<string> {
  return new Promise((resolvePromise) => {
    if (typeof req?.on !== 'function') { resolvePromise(''); return }
    let text = ''
    let settled = false
    const finish = (value: string): void => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    req.on('data', (chunk: unknown) => {
      if (settled) return
      text += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      if (text.length > 8192) finish('')
    })
    req.on('end', () => {
      if (settled) return
      try {
        const parsed = JSON.parse(text) as { file?: unknown }
        finish(typeof parsed?.file === 'string' ? parsed.file : '')
      } catch {
        finish('')
      }
    })
    req.on('error', () => finish(''))
  })
}

/**
 * 路由 handler（exact）。GET 与 POST 同一入口、同一语义。
 *
 * 响应契约（客户端并行实现，形状不可改）：
 *
 *   200 `{ ok: true, files: [{ path, name }] }`
 *   403 `{ ok: false, error: 'forbidden' }`
 *   404 `{ ok: false, error: 'spill file not found' }`
 *   422 `{ ok: false, error: 'spill content is not a generated-image result' }`
 *   500 `{ ok: false, error: 'materialize failed' }`（不回传任何异常细节）
 *
 * @param ctx - webServer 所在上下文。
 * @param req - IncomingMessage。
 * @param res - ServerResponse。
 */
export function handleMaterialize(ctx: Record<string, any>, req: any, res: any): void {
  const json = (status: number, payload: Record<string, unknown>): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  void (async () => {
    try {
      /*
       * 跨站闸门放最前面：这条路由会**写盘**（原 generated-images 只读，没有这道
       * 闸门）。不挡的话任意网页一个 no-cors POST 就能反复触发解码与下载，把
       * `<DSH_HOME>/storages/` 灌满 —— 拿本地磁盘换安全。
       *
       * GET 也必须挡：它语义相同、同样写盘，只是方便调试；判定口径与 POST 完全
       * 一致（同源 / 无 Origin 的本机脚本与 curl 照常放行，跨站一律 403）。
       *
       * 注意这里**不再转发 rejectCrossSite 的原始 payload**：它固定会多带一个
       * `reason: 'cross-site request'`，而本路由对客户端承诺的形状只有
       * `{ ok, error }`。形状多一个字段本身无害，但客户端按契约做穷举/快照断言时
       * 会把它当成意外形态 —— 这里收敛成契约形状，跨站细节只留在服务端。
       */
      const crossSite = rejectCrossSite(req?.headers as Record<string, unknown> | undefined, (status, payload) => {
        json(status, { ok: false, error: typeof payload.error === 'string' ? payload.error : 'forbidden' })
      })
      if (crossSite) return

      const url = new URL(req?.url ?? '/', 'http://x')
      let file = ''
      if (String(req?.method ?? 'GET').toUpperCase() === 'POST') {
        file = await readBodyFile(req)
        // body 没给就退回 query：前端两种写法都能通（契约只要求 POST 用 body）。
        if (file === '') file = url.searchParams.get('file') ?? ''
      } else {
        file = url.searchParams.get('file') ?? ''
      }

      const result = await run(ctx, file)
      if (!result.ok) {
        json(result.status, { ok: false, error: result.error })
        return
      }
      json(200, { ok: true, files: result.files })
    } catch {
      // 任何未预期异常都收敛成这一条：不把堆栈 / 路径泄给浏览器。
      json(500, { ok: false, error: 'materialize failed' })
    }
  })()
}

/** 导出给冒烟对拍的内部面。 */
export const __test = {
  MAX_SPILL_BYTES,
  MAX_IMAGE_BYTES,
  FETCH_TIMEOUT_MS,
  MIME_EXT,
  DATA_URL_RE,
  materializeRoot,
  collectImageUrls,
}
