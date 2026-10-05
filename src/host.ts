/**
 * dsh-chat-plus — 思考与工具调用聚合（host 半身）。
 *
 * 两条 host 路由，都在浏览器侧消费：
 *
 *  1. 生图画廊 spill 读取（见下方说明）；
 *  2. 对话截图渲染（自 dsh-webui 移植，见 src/shot/index.ts）：
 *     POST /api/chat-flow/screenshot/render|save|reveal +
 *     GET /api/chat-flow/screenshot/image|diagnose，
 *     常驻无头浏览器把消息卡片渲染成 PNG（保存目录
 *     ~/.dsh/storages/dsh-chat-flow-screenshot）。
 *
 * generate_image 的工具结果（含 base64 大图，约 2MB）超过 DSH
 * `dsh-spill-policy` 的 maxInlineBytes 后，完整 JSON 被存入
 * `LocalSpillStore` 的私有文件（默认 OS tmp 下 `dsh-spill-<随机>/session-*`，
 * 30 天保留），工具结果文本只剩「preview + locator」。浏览器无法读本地
 * 文件，客户端画廊需要完整图片数据，于是通过本路由读取：
 *
 *   GET /api/chat-flow/generated-images?file=<spill 绝对路径>
 *
 * 安全约束（只做必要最小暴露）：
 *  - 只允许读取 `ctx.spillStore` 的 root 之内的文件（路径穿越一律 403）；
 *  - 只接受后缀 `.txt` 且大小 ≤ 24MB（当前生图模型最高 2720×1536，
 *    base64 约 9MB，护栏防呆不拦正常结果）；
 *  - 只返回从文件里解析出的图片 URL 列表（data: 或 http(s)），绝不回传
 *    文件原文；解析失败返回 ok:false，绝不 500 泄出错误细节。
 */

import { readFileSync, statSync } from 'node:fs'
import { resolve, sep, extname } from 'node:path'
import { applyScreenshot } from './shot/index.ts'
import { applyDownloadRoutes, applyDownloadTool } from './download/index.ts'
import { applyOpenPathRoutes } from './open-path/index.ts'
import { applyTriadHost } from './triad/host.ts'
import { applyProviderHub, providerHubServices } from './provider/index.ts'
import { applyMailHost } from './mail/index.ts'
export { applyDownloadRoutes, downloadTool, readDownloadState, watchShellDownload } from './download/index.ts'
export { applyMailHost } from './mail/index.ts'
export type { MailHostConfig, MailHostHandle } from './mail/index.ts'
// 纯函数再导出：供 smoke 直接断言「CLI 英文报错翻成人话」的映射表。
export { humanizeCliError } from './mail/cli.ts'
// 画廊的可测面（索引准入 / raw 路径解析纯函数）：供 smoke 对拍「相对路径按会话
// cwd 解析」这条回归 —— 它正是「产出物卡点图片 403、侧栏却正常」的根因所在。
export { __test as galleryTest } from './triad/gallery/index.ts'
// 内置灵魂预设的可测面：预设是代码常量，某套被改坏或某张卡被 normalizeCard 过滤掉
// 都不会抛错，只会让面板静默少一行。导出给 smoke 钉住 id 集合与卡片数。
export { BUILTIN_SOUL_PRESETS, builtinPreset } from './triad/soul/presets.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-chat-plus'

/** 生图结果 spill 文件（纯文本 JSON）大小上限：2720×1536 PNG base64 约 9MB，留余量到 24MB。 */
const MAX_SPILL_BYTES = 24 * 1024 * 1024

/** 从 OpenAI 兼容响应体提取图片 URL（b64_json → data URL，其次 url）。 */
function collectImageUrls(data: unknown): string[] {
  const urls: string[] = []
  if (!Array.isArray(data)) return urls
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { b64_json?: unknown; url?: unknown }
    let url: string | null = null
    if (typeof record.b64_json === 'string' && record.b64_json !== '') {
      url = `data:image/png;base64,${record.b64_json.replace(/\s+/g, '')}`
    } else if (typeof record.url === 'string' && record.url !== '') {
      url = record.url
    }
    if (url !== null && !urls.includes(url)) urls.push(url)
  }
  return urls
}

/** 解析生图结果 JSON 文本，提取 { ok, urls, model }（对齐客户端 parse.ts）。 */
function parseGeneratedResult(text: string): { ok: boolean; urls: string[]; model: string | null } {
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

/** 路由：读 spill 文件 → 解析提取图片 URL（仅 root 内 .txt，≤8MB）。 */
function handleGeneratedImages(ctx: Record<string, any>, req: any, res: any): void {
  const json = (status: number, payload: Record<string, unknown>): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const file = url.searchParams.get('file') ?? ''
    const store: any = ctx.get('spillStore')
    const root = typeof store?.root === 'string' && store.root !== '' ? store.root : undefined
    if (root === undefined) {
      json(404, { ok: false, error: 'spill store unavailable' })
      return
    }
    const target = resolve(file)
    // 路径穿越护栏：目标必须是 root 之内（root 自身或 root\sep 前缀）。
    if (target !== root && !target.startsWith(root + sep)) {
      json(403, { ok: false, error: 'forbidden' })
      return
    }
    if (extname(target).toLowerCase() !== '.txt') {
      json(403, { ok: false, error: 'forbidden' })
      return
    }
    let size: number
    try {
      size = statSync(target).size
    } catch {
      json(404, { ok: false, error: 'spill file not found' })
      return
    }
    if (size <= 0 || size > MAX_SPILL_BYTES) {
      json(413, { ok: false, error: 'spill file too large' })
      return
    }
    const text = readFileSync(target, 'utf8')
    const result = parseGeneratedResult(text)
    if (!result.ok) {
      json(422, { ok: false, error: 'spill content is not a generated-image result' })
      return
    }
    json(200, { ok: true, urls: result.urls, model: result.model })
  } catch {
    json(500, { ok: false, error: 'internal error' })
  }
}

/**
 * 注册 host 路由（webServer 缺失时静默跳过）。
 *
 * 注意：cordis 的 ctx 是 Proxy，未在 `inject` 中声明的属性**一读就抛**
 * `cannot get property "webServer" without inject`。所以「先判断
 * `ctx.webServer === undefined` 再跳过」这种防御写法是自欺欺人的——
 * 判断本身就会炸，而且发生在 apply 同步路径上，会连累整棵插件树 boot 失败
 * （表现为 3080 起不来）。
 *
 * 正确做法是延迟注入：webServer 未就绪时回调根本不会执行，天然静默跳过，
 * 且服务销毁时 webCtx.effect 注册的路由自动回收。与 packages/api/gateway
 * 的写法一致。
 */
export function apply(ctx: Record<string, any>, config?: { mail?: Record<string, unknown> }): void {
  ctx.inject(['webServer'], (webCtx: any) => {
    // 生图画廊：spill 结果读取（exact 路由）。
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/api/chat-flow/generated-images',
      handler: (req: any, res: any) => handleGeneratedImages(webCtx, req, res),
    }), 'dsh-chat-plus: generated-images route')
    // 对话截图：常驻无头浏览器渲染 + render/save/reveal/image/diagnose
    // （prefix 路由；applyScreenshot 内部自己挂 effect 与回收）。
    applyScreenshot(webCtx)
    // 下载工具的实时进度路由（GET /api/chat-flow/download/progress）。
    applyDownloadRoutes(webCtx)
    // 「用文件资源管理器打开」修复：官方那条被 windowsHide 吞了窗口。
    applyOpenPathRoutes(webCtx)
  })
  // download 工具：注册进 host 工具注册表（模型可见，GUI 实时进度条）。
  // tools 服务缺失时回调不执行，其余能力不受影响（延迟注入的天然降级）。
  ctx.inject(['tools'], (toolsCtx: any) => {
    applyDownloadTool(toolsCtx)
  })
  // ── 融合的原 dsh-triad 工作台（记忆引擎 / 用量+技能 / MCP）────────────
  // 路由前缀与座位一仍其旧（/api/dsh-memory/* 等），用户零迁移；dsh-triad
  // 自此退役，数据与配置目录也不动。定时自动化已交给官方 schedule bundle。
  //
  // 七个 service 与原 dsh-triad 顶层 inject 一致。任一缺失则回调不执行
  // （工作台整体不挂载，但本插件的截图/下载/generated-images 照常）——
  // 与 dsh-triad 原本的硬依赖语义相同，不额外放宽。
  ctx.inject(
    ['webServer', 'tools', 'credentials', 'sessions', 'sessionPersistence', 'settings', 'llm'],
    (triadCtx: any) => {
      applyTriadHost(triadCtx)
    },
  )

  // ── 融合的原 dsh-provider-hub（供应商中心）────────────────────────────
  // 六个模块：网络代理 / 模型能力改写（含 generate_image + generate_video 工具）
  // / 辅助视觉（vision_describe）/ 提示词优化 / AnySearch 网页搜索 / 凭据密钥环。
  // 路由前缀（/api/dsh-proxy、/api/model-capabilities、/api/vision-helper、
  // /api/dsh-prompt-optimize、/api/provider-hub-keys）与 settings 命名空间
  // 一律不变，用户零迁移。
  //
  // 八个 service 由 providerHubServices 给出；任一缺失则回调不执行（供应商
  // 相关能力整体不挂，但本插件的截图/下载/工作台照常）——与旧插件 inject
  // 的硬依赖语义相同，不额外放宽。
  ctx.inject(
    [...providerHubServices],
    (providerCtx: any) => {
      applyProviderHub(providerCtx)
    },
  )

  // ── 邮箱工作台（Agent Mail）────────────────────────────────────────────
  // 与三个工作台并列的独立能力：模型工具（mail_*）+ /api/dsh-mail/* 路由 +
  // 每会话首步的「本 Agent 有专属邮箱」能力注入（浏览器自动化注册第三方服务
  // 时不再需要问用户要邮箱）。只依赖 webServer + tools，任一缺失则整块不挂，
  // 其余能力照常（延迟注入的天然降级）。
  ctx.inject(['webServer', 'tools'], (mailCtx: any) => {
    void applyMailHost(mailCtx, (config?.mail ?? {}) as never).catch((error: unknown) => {
      mailCtx.logger?.warn?.(
        `[dsh-chat-plus] mail workbench failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      )
    })
  })
}
