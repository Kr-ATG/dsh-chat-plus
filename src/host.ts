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
import { admitSpillPath, spillRoots } from './spill/index.ts'
import { applyDownloadRoutes, applyDownloadTool } from './download/index.ts'
import { applyOpenPathRoutes } from './open-path/index.ts'
import { applyOfficePreview } from './office/index.ts'
import { applyFontRoutes } from './fonts/index.ts'
import { applyTriadHost } from './triad/host.ts'
import { applyProviderHub, providerHubServices } from './provider/index.ts'
import { applyOpencodeFingerprint } from './provider/modules/opencode-free-fingerprint.ts'
// OpenCode Zen 免费层指纹的可测面：session id 派生、命中判据、请求改写纯函数。
// 这三块错了都不会抛错——只会让 exo-free 静默回到 403，或者更糟：把别的厂商
// 请求也改写掉。所以导出给 smoke 直接断言（见 scripts/smoke-host.mjs）。
export {
  sessionIdFor as opencodeSessionIdFor,
  needsFingerprint as opencodeNeedsFingerprint,
  applyFingerprint as opencodeApplyFingerprint,
  __test as opencodeFingerprintTest,
} from './provider/modules/opencode-free-fingerprint.ts'
import { applyMailHost } from './mail/index.ts'
import { applyToolsGate } from './tools-gate/index.ts'
export { applyDownloadRoutes, downloadTool, readDownloadState, watchShellDownload } from './download/index.ts'
export { applyFontRoutes, FONT_ROUTE } from './fonts/index.ts'
export { applyMailHost } from './mail/index.ts'
export type { MailHostConfig, MailHostHandle } from './mail/index.ts'
// 工具闸门（computer-use / browser-use 按需注入）：纯函数与分组表导出给 smoke，
// 钉住「默认全关 → 每轮省掉那 80 个工具的 schema」这条主回归。
export { applyToolsGate, __test as toolsGateTest, DEFAULT_GATE_GROUPS } from './tools-gate/index.ts'
export type { GateConfig, GateGroup } from './tools-gate/index.ts'
// 纯函数再导出：供 smoke 直接断言「CLI 英文报错翻成人话」的映射表。
export { humanizeCliError } from './mail/cli.ts'
// 画廊的可测面（索引准入 / raw 路径解析纯函数）：供 smoke 对拍「相对路径按会话
// cwd 解析」这条回归 —— 它正是「产出物卡点图片 403、侧栏却正常」的根因所在。
export { __test as galleryTest } from './triad/gallery/index.ts'
// Office / PDF 预览的可测面：引擎解析、工作目录判据、路径准入纯函数，以及
// 「用假 ctx 挂路由 + 真 HTTP 请求」这条端到端链路（见 scripts/smoke-host.mjs）。
// 这三块错了都不会抛错 —— 引擎缺了只是退回下载、判据错了只是 403 —— 必须能
// 被冒烟直接断言。
export {
  applyOfficePreview, officeEngineAvailable, officeCacheRoot, renderOfficePages, renderOfficePdf,
  __test as officeTest,
} from './office/index.ts'
export { __test as officeAdmitTest, rememberOfficePaths } from './office/admit.ts'
export { __test as officeScratchTest, ensureOfficeScratch, currentOfficeScratch } from './office/scratch.ts'
// spill 准入的可测面：root 形状判据 + 路径准入纯函数（供 smoke 钉住「历史 root
// 可读、任意路径不可读」这对往返）—— 判错的表现是「画廊里的生图格子全空」。
export { __test as spillTest, DEFAULT_ROOT_RE, SESSION_DIR_RE, admitSpillPath, spillRoots } from './spill/index.ts'
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

/** 路由：读 spill 文件 → 解析提取图片 URL（仅可信 spill root 内的 .txt，≤24MB）。 */
function handleGeneratedImages(ctx: Record<string, any>, req: any, res: any): void {
  const json = (status: number, payload: Record<string, unknown>): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const file = url.searchParams.get('file') ?? ''
    const store: any = ctx.get('spillStore')
    const active = typeof store?.root === 'string' && store.root !== '' ? store.root : undefined
    /*
     * 准入：目标必须落在某个**可信 spill root** 之内。
     *
     * 为什么不是只认当前进程那一个 root（2026-10-06 修「画廊里的生图格子全空」）：
     * `dsh-spill-local` 在没配置 root 时用 `mkdtempSync(join(tmpdir(), 'dsh-spill-'))`
     * 建目录 —— **每启动一次进程就换一个新名字**。而画廊是跨会话的：它列出的生图
     * 条目来自历史会话，那些 spill 文件躺在之前若干次启动留下的 root 里。只认
     * 当前 root 的判据把它们全部判 403，于是 14 张生图在画廊里全成了「点开什么
     * 都没有」的空白格子 —— 用户看到的就是「这些文件不存在」。实测 14/14 都在
     * 磁盘上（2.2~2.7MB、内容可解析），只是不在当前 root。
     *
     * 判据见 src/spill/index.ts：与官方启动清理用的同一份命名形状，安全面反而
     * 更严（多锁一层 `session-<12hex>` 目录命名 + 后缀白名单）。
     */
    const verdict = admitSpillPath(file, spillRoots(active))
    if (!verdict.ok) {
      json(403, { ok: false, error: 'forbidden', reason: verdict.reason })
      return
    }
    const target = verdict.path
    let size: number
    try {
      size = statSync(target).size
    } catch {
      // 文件确实不在了（超过 30 天保留期 / 被清理）—— 这是「真不存在」，与准入失败
      // 分开报，便于客户端把这条从画廊里剔掉而不是显示成空白格子。
      json(404, { ok: false, error: 'spill file not found' })
      return
    }
    if (size <= 0 || size > MAX_SPILL_BYTES) {
      json(size <= 0 ? 404 : 413, { ok: false, error: size <= 0 ? 'spill file empty' : 'spill file too large' })
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
export function apply(ctx: Record<string, any>, config?: { mail?: Record<string, unknown>; toolsGate?: Record<string, unknown> }): void {
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
    // 界面字体资产（/api/chat-flow/fonts/*）：把随包的霞鹜新致宋 woff2
    // 与许可原文吐给浏览器。字体不内联进 client 产物——4.15MB 的资产若内联，
    // 从不切字体的用户也要白下载一次。
    applyFontRoutes(webCtx)
    // 下载工具的实时进度路由（GET /api/chat-flow/download/progress）。
    applyDownloadRoutes(webCtx)
    // 「用文件资源管理器打开」修复：官方那条被 windowsHide 吞了窗口。
    applyOpenPathRoutes(webCtx)
    // Office / PDF 页图与 PDF 渲染（/api/chat-flow/office/*）：画廊 ppt/word 缩略图、
    // 产出物弹窗内联预览、官方侧边栏 ppt/word 接管三处共用。挂载时顺带校正
    // process.env.TEMP —— 官方 office-to-pdf 的 LibreOffice 转换要求 scratch 落在
    // 带沙箱写 ACE 的目录里，否则侧边栏对 ppt/word 永远报「无法预览」（详见
    // src/office/scratch.ts 的根因说明）。
    //
    // logger 也整段包住：cordis 的 ctx 是 Proxy，读未在 inject 白名单里的属性会
    // 抛 `cannot get property "x" without inject` —— 若在 catch 里再读 logger 抛出，
    // 会从 apply 冒出去连累整棵插件树。这里只做「尽力记一笔」。
    try {
      applyOfficePreview(webCtx)
    } catch (error) {
      try {
        webCtx.logger?.warn?.(
          `[dsh-chat-plus] office preview failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        )
      } catch { /* 拿不到 logger 时静默：不为了记日志再抛一次 */ }
    }
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

  // ── OpenCode Zen 免费层指纹（纯出站改写，零服务依赖）────────────────────
  // 为什么**不**放进上面的 providerHubServices 延迟注入：那 8 个服务里含
  // webServer，headless / tui 这类没有 web 服务的 profile 会让整个回调不执行，
  // 于是 exo-free 在这些 profile 里照样 403。本模块只用 ctx.effect + logger，
  // 所以直接挂——任何 profile 都能拿到。
  //
  // 包装的是 globalThis.fetch，属进程级副作用：模块内部走 ctx.effect 注册
  // 卸载，插件被禁用/重载时自动还原，不给下一个实例留一层指向旧闭包的包装。
  try {
    applyOpencodeFingerprint(ctx as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] opencode fingerprint failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

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

  // ── 工具闸门（computer-use / browser-use 按需注入）──────────────────────
  // 默认全关：电脑操作 56 个 + 浏览器操作 24 个工具（实测占全部工具定义
  // 74.7%、约 3.1 万 tok/请求）不再进入每轮请求；`/computer-use on`、
  // `/browser-use on` 按会话打开。见 src/tools-gate/index.ts 的设计说明：
  // 走 system-prompt/assemble 出口过滤而非 tools.restrict，因为 browser-use
  // 的工具由 provider 注册在 agent 自己的作用域层，restrict 只过滤继承层。
  //
  // 这一段**不能**放进 try/catch 之外就算完：延迟注入回调里抛错会从 apply
  // 冒出去，中断本插件后面所有 ctx.inject（triad 工作台全不挂）。模块内部
  // 已对缺失服务逐项自查，这里再加一层兜底，任何意外都只让闸门失效。
  try {
    applyToolsGate(ctx as never, (config?.toolsGate ?? {}) as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] tools gate failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
}
