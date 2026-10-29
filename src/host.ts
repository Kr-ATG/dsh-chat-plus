/**
 * dsh-chat-plus — 思考与工具调用聚合（host 半身）。
 *
 * 两条 host 路由，都在浏览器侧消费：
 *
 *  1. 生图画廊 spill 读取 + 落盘物化（见下方说明）；
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
 * 官方右侧 Sidebar 的文档预览只认**真实文件**，data URL 不是文件，所以另有一条
 * 落盘路由（实现见 src/spill/materialize.ts，注册紧跟在读图路由之后）：
 *
 *   GET  /api/chat-flow/generated-images/materialize?file=<spill 绝对路径>
 *   POST /api/chat-flow/generated-images/materialize   （body: { file })
 *
 * 它把 spill 文本里的图片解码/下载成真实文件（`<DSH_HOME>/storages/
 * dsh-chat-plus-generated/<sha1 前 16 位>/img-N.png`），返回绝对路径给客户端。
 *
 * 安全约束（只做必要最小暴露）：
 *  - 两条路由共用同一套准入：`admitSpillPath(file, spillRoots(active))`（见
 *    src/spill/index.ts，可信 root = 历史 root ∪ 当前 root），路径穿越一律 403；
 *  - 只接受后缀 `.txt` 且大小 ≤ 24MB（当前生图模型最高 2720×1536，
 *    base64 约 9MB，护栏防呆不拦正常结果）；
 *  - 读图路由只返回解析出的图片 URL 列表（data: 或 http(s)），绝不回传文件原文；
 *    解析失败返回 ok:false，绝不 500 泄出错误细节；
 *  - 落盘路由会写盘，所以 GET/POST 都过 `rejectCrossSite`（跨站写必须挡）。
 */

import { readFileSync, statSync } from 'node:fs'
import { resolve, sep, extname } from 'node:path'
import { applyScreenshot } from './shot/index.ts'
import { admitSpillPath, spillRoots } from './spill/index.ts'
import { MATERIALIZE_ROUTE, handleMaterialize, parseGeneratedResult } from './spill/materialize.ts'
import { applyDownloadRoutes, applyDownloadTool } from './download/index.ts'
import { validateHtmlCardTool } from './validate-card/index.ts'
import { applyOpenPathRoutes } from './open-path/index.ts'
import { applyOpenFileRoutes } from './open-file/index.ts'
import { applyOfficePreview } from './office/index.ts'
import { applyFontRoutes } from './fonts/index.ts'
import { applyMotionRoutes } from './motion/index.ts'
import { applyTriadHost } from './triad/host.ts'
import { applyProviderHub, providerHubServices } from './provider/index.ts'
import { applyMailHost } from './mail/index.ts'
import { applyToolsGate } from './tools-gate/index.ts'
import { applyBrowserOnDemand } from './browser-on-demand/index.ts'
import { applyBrowserActivity } from './browser-activity/index.ts'
import { applyRunningApps } from './running-apps/index.ts'
import { applyDonePillHost } from './host/done-pill/index.ts'
import { applyRecWindows } from './host/done-pill/rec-windows.js'
import { applyRecCapture } from './host/done-pill/rec-capture.js'
import { applySfxRoutes } from './host/done-pill/sfx.ts'
// 「系统提示词」观测（2026-10-27）：assemble 出口抓最终快照 + 只读路由，
// 供操作间「系统提示词」页查看「这次发送会话会带上的提示词」。
import { applySystemPromptInspector } from './system-prompt/index.ts'
import { applyGitStatusRoutes, GIT_STATUS_ROUTE, collectGitStatus, handleGitStatusRoute } from './git-status/index.ts'
import { applyFeatureRoutes, hostFeatureEnabled, initializeFeatures } from './features/store.ts'
export { applyDownloadRoutes, downloadTool, readDownloadState, watchShellDownload } from './download/index.ts'
export { applyFontRoutes, FONT_ROUTE } from './fonts/index.ts'
// 「任务动画」资产（/api/chat-flow/motion/*）：9 段透明底 WebM + 首帧海报。
export { applyMotionRoutes, MOTION_ROUTE } from './motion/index.ts'
// 「用默认浏览器 / 默认应用打开文件」（2026-10-21）：纯判定面导出给冒烟。
// 这三条（路径绝对化基准 / 可执行类型拒绝 / 浏览器命令解析）判错了都不会抛错，
// 只会表现为「点了没反应」或「打开了不相干的东西」，只能断言。
export { applyOpenFileRoutes, __test as openFileTest } from './open-file/index.ts'
export { applyMailHost } from './mail/index.ts'
export type { MailHostConfig, MailHostHandle } from './mail/index.ts'
// 工具闸门（computer-use / browser-use 按需注入）：纯函数与分组表导出给 smoke，
// 钉住「默认全关 → 每轮省掉那 80 个工具的 schema」这条主回归。
export { applyToolsGate, __test as toolsGateTest, DEFAULT_GATE_GROUPS } from './tools-gate/index.ts'
export type { GateConfig, GateGroup } from './tools-gate/index.ts'
// 浏览器按需拉起：纯函数与状态机导出给 smoke（等待/去重/空闲关停/归属认领
// 这四条错了都不会抛错，只会表现为「Chrome 没起来」或「常驻不关」）。
export {
  applyBrowserOnDemand,
  OnDemandBrowser,
  isBrowserTool,
  waitForCdp,
  resolveBrowserOnDemandConfig,
  DEFAULT_ATTACH_PORT,
  DEFAULT_IDLE_MS,
  BROWSER_TOOL_PREFIX,
  __test as browserOnDemandTest,
} from './browser-on-demand/index.ts'
export type { BrowserOnDemandConfig, OwnershipMarker } from './browser-on-demand/index.ts'
// 浏览器活动观测：纯函数（工具名判据 / MCP 名解析 / 会话归属取值）、状态机与路由
// handler 一并导出给冒烟。这几块错了都不会抛错 —— 漏判只是「该亮的不亮」，
// 误判是「普通工具也亮浏览器图标」，尾迹窗错了是「图标频闪或不灭」，只能断言。
// 接缝诊断（SESSION_SOURCES / sessionSourceOfExecution / DebugBuffer）也一并导出：
// 真实运行时若取不到 sessionId，症状是「图标永远不亮且毫无报错」，这几项是唯一
// 能直接指认接缝断在哪条路径上的手段。
export {
  applyRunningApps,
  collectRunningApps,
  disposeRunningApps,
  handleRunningAppsRoute,
  RUNNING_APPS_ROUTE,
  __test as runningAppsTest,
} from './running-apps/index.ts'
export type { RunningAppsSnapshot, RunningAppWindow } from './running-apps/types.ts'
export {
  applyBrowserActivity,
  BrowserActivityTracker,
  BrowserActivityDebugBuffer,
  isBrowserToolName,
  isShellToolName,
  browserCliOfCommand,
  browserCliInvocationOf,
  browserActivityLabelOf,
  parseBrowserToolName,
  sessionIdOfAgent,
  sessionIdOfExecution,
  shellCommandOfExecution,
  sessionSourceOfExecution,
  hasCallIdOfExecution,
  handleBrowserActivityRoute,
  backgroundJobIdOf,
  SESSION_SOURCES,
  BROWSER_ACTIVITY_ROUTE,
  BROWSER_ACTIVITY_LINGER_MS,
  BROWSER_ACTIVITY_DEBUG_LIMIT,
  BROWSER_ACTIVITY_JOB_WATCH_MAX_MS,
  BROWSER_ACTIVITY_HINTS,
  BROWSER_ACTIVITY_PREFIX,
  BROWSER_CLI_NAMES,
  SHELL_TOOL_NAMES,
  __test as browserActivityTest,
} from './browser-activity/index.ts'
export type {
  BrowserActivityConfig,
  BrowserActivityDebugEntry,
  BrowserActivitySession,
  BrowserActivitySnapshot,
  BrowserActivityLabel,
  BrowserCliInvocation,
  SessionResolution,
  SessionSource,
} from './browser-activity/index.ts'
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
// 生图 spill 落盘（materialize）：解析器已从本文件搬去 spill/materialize.ts 并 export，
// 两条路由共用同一份（搬走时行为逐字未变）。纯函数（目录键 / 扩展名 / data URL 解码 /
// magic number 判据）与路由常量一并导出给 smoke —— 它们写错了都不会抛错，只会静默
// 落出一批裂图，或者把每次点击都变成一次重复解码。
export { parseGeneratedResult }
export {
  MATERIALIZE_ROUTE, materializeRoot, materializeCacheDir, materializeImages,
  extensionFor, decodeDataUrl, looksLikeImage, reusable, fetchImageBytes,
  __test as materializeTest,
} from './spill/materialize.ts'
// 跨站闸门的可测面：判据写歪不会抛错，只会静默放行（或静默误伤正常请求），
// 所以必须能被冒烟直接对拍。见 shared/csrf.ts 头注释与 smoke-host 的判据断言组。
export { __test as csrfTest, isCrossSiteRequest, rejectCrossSite, hostNameOf } from './shared/csrf.ts'
// 「系统提示词」观测的可测面：插值 / 渲染 / 快照折叠 / 内存表 / 路由 handler
// 全是纯函数或假实现可驱动的形态，冒烟直接对拍「页面显示的就是模型收到的」。
export {
  applySystemPromptInspector,
  SYSTEM_PROMPT_ROUTE,
  __test as systemPromptTest,
} from './system-prompt/index.ts'
// 工作区 Git 状态路由与工具函数
export {
  applyGitStatusRoutes,
  GIT_STATUS_ROUTE,
  GIT_ROSTER_ROUTE,
  GIT_COMMIT_MESSAGE_ROUTE,
  GIT_COMMIT_ROUTE,
  collectGitStatus,
  collectGitRoster,
  generateCommitMessage,
  executeGitCommit,
  handleGitStatusRoute,
  formatRelativeTime,
} from './git-status/index.ts'
/** Stable Cordis plugin name. */
export const name = 'dsh-chat-plus'

/**
 * 生图结果 spill 文件（纯文本 JSON）大小上限：2720×1536 PNG base64 约 9MB，留余量到 24MB。
 * 解析器（parseGeneratedResult）已搬到 src/spill/materialize.ts 并 export：落盘路由与
 * 本文件的读图路由必须共用同一份解析，否则会出现「画廊显示 3 张、落盘只有 2 张」。
 */
const MAX_SPILL_BYTES = 24 * 1024 * 1024

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
export function apply(ctx: Record<string, any>, config?: { mail?: Record<string, unknown>; toolsGate?: Record<string, unknown>; browserOnDemand?: Record<string, unknown>; browserActivity?: Record<string, unknown> }): void {
  // 组件开关：登记宿主 context（host 各模块在 apply 期用 hostFeatureEnabled
  // 读 loader 行状态），再注册 /api/chat-flow/components 只读路由。
  initializeFeatures(ctx)
  ctx.inject(['webServer'], (webCtx: any) => {
    applyFeatureRoutes(webCtx)
    // 生图画廊：spill 结果读取（exact 路由）。
    if (hostFeatureEnabled('host.generated-images')) {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path: '/api/chat-flow/generated-images',
        handler: (req: any, res: any) => handleGeneratedImages(webCtx, req, res),
      }), 'dsh-chat-plus: generated-images route')
    }
    /*
     * 生图画廊「落盘」（exact，紧跟读图路由之后）：把只存在于 spill 文本里的
     * 图片解码/下载成真实文件，好让官方右侧 Sidebar 能像打开普通文件一样打开
     * 它们（Sidebar 的文档预览只认真实文件，data URL 不是文件）。
     *
     * 必须注册成 exact 而不是把读图路由改成 prefix：webServer 是 longest-prefix-
     * wins 且精确表优先，两条 exact 各自成立、互不遮蔽——把老路由改成 prefix 会
     * 让 /generated-images 这条现存契约的路由形状变化（客户端与冒烟都按 exact 断言过）。
     *
     * handler 自己带跨站闸门（GET/POST 都挡）：这条会往磁盘写文件，不是只读。
     */
    if (hostFeatureEnabled('host.generated-images')) {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path: MATERIALIZE_ROUTE,
        handler: (req: any, res: any) => handleMaterialize(webCtx, req, res),
      }), 'dsh-chat-plus: generated-images materialize route')
    }
    // 对话截图：常驻无头浏览器渲染 + render/save/reveal/image/diagnose
    // （prefix 路由；applyScreenshot 内部自己挂 effect 与回收）。
    if (hostFeatureEnabled('host.screenshot-engine')) applyScreenshot(webCtx)
    // 下载工具的实时进度路由（GET /api/chat-flow/download/progress）。
    if (hostFeatureEnabled('host.download')) applyDownloadRoutes(webCtx)
    // 「用文件资源管理器打开」修复：官方那条被 windowsHide 吞了窗口。
    if (hostFeatureEnabled('host.open-path')) applyOpenPathRoutes(webCtx)
    // 「用默认应用打开文件」修复（2026-10-21）：见 src/open-file/index.ts。
    if (hostFeatureEnabled('host.open-file')) applyOpenFileRoutes(webCtx)
    // 界面字体资产（/api/chat-flow/fonts/*）：把随包的霞鹜新致宋 woff2 与许可
    // 原文吐给浏览器。字体不内联进 client 产物——5.0MB 的资产若内联，从不切字体
    // 的用户也要白下载一次。
    //
    // 2026-10-14 曾随「界面字体」整块下线，2026-10-25 按用户要求装回来。
    if (hostFeatureEnabled('host.fonts')) applyFontRoutes(webCtx)
    // 对话完成胶囊的辅助路由（2026-10-28 自 dsh-companion 移植）：
    //   · 录屏窗口枚举 / 逐帧抓取（Win32 PrintWindow，免遮挡、支持子窗口）；
    //   · 提示音静态资源（胶囊通知的提示音，壳页面与本页共用一个 URL）。
    // 三块彼此独立、各自 try/catch：缺 WebServer 之外的服务也不会拖垮其它路由。
    try {
      if (hostFeatureEnabled('host.done-pill-media')) {
        applyRecWindows(webCtx)
        applyRecCapture(webCtx)
        applySfxRoutes(webCtx)
      }
    } catch (error) {
      try {
        webCtx.logger?.warn?.(`[dsh-chat-plus] done-pill media routes failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      } catch { /* 日志不可用也不炸 */ }
    }
    // 「任务动画」资产（/api/chat-flow/motion/*，2026-10-26）：操作面板卡头那 9 段
    // 透明底 WebM（思考 / 开始操作 / 操作中 / 查看照片 / 操作结束 / 完成 / 吃饭 /
    // 观月 / 小憩）与各自的首帧海报。与字体同一条理由：2.57MB 的动画若内联进
    // client.js，关掉动画的人也要白下载一次；走路由后只拉当前在播的那一段。
    if (hostFeatureEnabled('host.motion')) applyMotionRoutes(webCtx)
    // 当前工作区 Git 状态与一键提交流路由
    if (hostFeatureEnabled('host.git-status')) applyGitStatusRoutes(webCtx, ctx)
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
      if (hostFeatureEnabled('host.office-preview')) applyOfficePreview(webCtx)
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
  // validate_html_card 同批注册：把提示词里那十几条卡片规则变成发前可机检的
  // 诊断（外链会被 CSP 拦、100vh 会出滚动条、整页底色会变成色差板子……）。
  // 两件事共用同一个 tools 依赖，任一失败都不该连累另一个，所以分开 try。
  ctx.inject(['tools'], (toolsCtx: any) => {
    if (hostFeatureEnabled('input.download-tool')) applyDownloadTool(toolsCtx)
    try {
      if (hostFeatureEnabled('input.validate-card-tool')) {
        toolsCtx.effect(
          () => toolsCtx.tools.register(validateHtmlCardTool),
          'dsh-chat-plus: validate_html_card tool',
        )
      }
    } catch (error) {
      try {
        toolsCtx.logger?.warn?.(('[dsh-chat-plus] validate_html_card 注册失败：'
          + (error instanceof Error ? error.message : String(error))))
      } catch { /* 拿不到 logger 时静默：不为了记日志再抛一次 */ }
    }
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
      if (hostFeatureEnabled('host.provider-hub')) applyProviderHub(providerCtx)
    },
  )

  // ── 邮箱工作台（Agent Mail）────────────────────────────────────────────
  // 与三个工作台并列的独立能力：模型工具（mail_*）+ /api/dsh-mail/* 路由 +
  // 每会话首步的「本 Agent 有专属邮箱」能力注入（浏览器自动化注册第三方服务
  // 时不再需要问用户要邮箱）。只依赖 webServer + tools，任一缺失则整块不挂，
  // 其余能力照常（延迟注入的天然降级）。
  ctx.inject(['webServer', 'tools'], (mailCtx: any) => {
    if (!hostFeatureEnabled('host.mail')) return
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
    if (hostFeatureEnabled('input.tools-gate')) applyToolsGate(ctx as never, (config?.toolsGate ?? {}) as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] tools gate failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

  // ── 浏览器按需拉起（browser-use 的 attach 目标）────────────────────────
  // 取代原先「Windows 计划任务常驻 Chrome」的做法：命中浏览器工具调用时
  // 才拉起 9222 实例，空闲 5 分钟关掉自己拉起的那个。见
  // src/browser-on-demand/index.ts 的实测依据（MCP 懒连接 + 自愈）。
  //
  // 与闸门同理：延迟注入回调里抛错会从 apply 冒出去、中断后面所有 inject，
  // 所以这里单独兜底，任何意外都只让「按需拉起」失效（退回手动启动 Chrome）。
  try {
    if (hostFeatureEnabled('host.browser-on-demand')) applyBrowserOnDemand(ctx as never, (config?.browserOnDemand ?? {}) as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] browser-on-demand failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

  // ── 浏览器活动观测（会话行 / 标题栏的浏览器标志）──────────────────────
  // 包装 tools/execute 记录「哪些会话此刻有浏览器调用在进行」，暴露只读路由
  // GET /api/chat-flow/browser-activity 给客户端轮询。与按需拉起共用同一个
  // 接缝，但两者互不依赖：拉起挂了不影响观测，观测挂了也不影响拉起。
  //
  // 同样是延迟注入 + 单独兜底：观测器在 waterfall 里运行，任何未捕获异常都会
  // 毁掉真实的工具调用 —— 模块内部已全程 try/catch，这里再加一层，最坏结果
  // 只是「图标不亮」。
  try {
    if (hostFeatureEnabled('host.browser-activity')) applyBrowserActivity(ctx as never, (config?.browserActivity ?? {}) as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] browser-activity failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }


  // ── 「@ 运行中的程序」采集（2026-10-23）─────────────────────────────────
  // 枚举可见顶层窗口（标题 / 进程 / 图标），暴露只读路由
  // GET /api/chat-flow/running-apps 给客户端 @ 菜单用。
  //
  // 采集走一个**常驻 PowerShell 子进程**：每次新 spawn 要 ~1000ms（其中
  // 600~700ms 是 PowerShell 冷启动），常驻后一次往返只要 2~4ms。用户打 @
  // 时菜单必须立刻有东西。卸载时由模块内部 effect 把子进程 kill 掉。
  //
  // 同样单独兜底：延迟注入回调里抛错会从 apply 冒出去、中断后面所有 inject。
  try {
    if (hostFeatureEnabled('host.running-apps')) applyRunningApps(ctx as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] running-apps failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

  // ── 「系统提示词」观测（2026-10-27）────────────────────────────────────
  // 在 system-prompt/assemble 的**出口**（prepend 注册、await next() 之后再读）
  // 抓一份最终组装结果留在内存，页面经 GET /api/chat-flow/system-prompt 取。
  //
  // 为什么必须在 host：提示词是每个 step 由 dsh-system-prompt 现组装出来的，
  // 浏览器侧根本不存在这份中间态；而且本插件的工具闸门就在这条 waterfall 上
  // 删工具 / 删段 / 追加「哪些能力关着」的说明 —— 只有出口才是**模型真正收到
  // 的那一份**。客户端读会话事件里的 system/message 拿到的是历史回放，既没有
  // 分段，也看不到「关掉工具组之后剩什么」。
  //
  // 同样单独兜底：延迟注入回调里抛错会从 apply 冒出去、中断后面所有 inject。
  try {
    if (hostFeatureEnabled('host.system-prompt')) applySystemPromptInspector(ctx as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] system-prompt inspector failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

  // ── 对话完成胶囊（2026-10-28 自 dsh-companion 移植）──────────────────────
  // 全局监听 session/event（含后台会话）：回合结束提取问题与回复全文，存内存
  // 完成列表；GET /api/dsh-done-pill 供前端增量轮询，另有 /shell-hot、
  // /notify、/notify-click 三条辅助路由（内部自己 ctx.inject(['webServer'])，
  // 缺服务时静默不挂路由，不影响前面已装配的其它能力）。
  try {
    if (hostFeatureEnabled('view.done-pill')) applyDonePillHost(ctx as never)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] done-pill host failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
}
