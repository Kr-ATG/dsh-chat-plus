/**
 * dsh-chat-plus — 等官方 `documentPreviews` 服务就绪（client 半身）。
 *
 * ## 这个文件为什存在（2026-10-19 实机定位）
 *
 * 本插件有两个「侧边栏文档渲染器」：`sidebar-doc`（pdf / Office 接管）与
 * `sidebar-media`（音视频接管）。两者都要在 apply 里同步取一次
 * `ctx.get('documentPreviews')` 拿注册表。而**实机证明那一刻它还是空的**：
 *
 *   · 页面已经加载完、`window.__dshClientCtx__.get('documentPreviews')` 在控制台里
 *     是个 object（服务确实存在）；
 *   · 但插件 apply 时那一次取值拿到 undefined，于是 `dataset.dshSdpRegistry` 被写成
 *     `no-registry`，两个渲染器**一次都没注册成功**。
 *
 * 根因是**客户端插件 apply 顺序**：`dsh-web-app` 的 bundle 排在本插件之前只决定
 * 宿主侧装配顺序；浏览器侧每个 client 插件各自 `apply(ctx)`，本插件先跑完，官方
 * `ui-sidebar-documentpreview` 的 `ctx.reflect.provide('documentPreviews', …)` 才落地。
 *
 * 后果不是"少一个可选项"，而是两条**主链路**集体失效：
 *   · pdf / ppt / word 走官方 pdf.js → 带 `/ID` 的 PDF 必崩（n.toHex is not a
 *     function，见 sidebar-doc 头注释）；
 *   · 「产出物 / 画廊全部用官方侧栏查看」收口之后，音视频会退化成「不支持预览」。
 *
 * 所以注册不能只试一次：**轮询到服务出现为止**（上限 8 秒，超时静默放弃 ——
 * 老宿主永远不会有这个服务，重试到一个上限就该停，不能留一个永不结束的定时器）。
 *
 * ## 为什么要给一个"重试"而不是用 ctx.inject
 *
 * `ctx.inject(['documentPreviews'], cb)` 看起来更正统，但 `sidebar-doc` 已经实机踩过
 * 一次：cordis 的 ctx 对「未在 inject 白名单声明的属性」读一次就抛，而这里拿的是
 * **根 ctx**（插件 apply 的入参），它的 inject scope 与官方包 provide 的服务不在同一层，
 * 回调里读不到 —— 表现是整块静默不挂、连水痕都没有。轮询 `ctx.get()` 是唯一
 * 实测可靠的观测点，而它只是一次 cheap 的 Map 取值。
 */

/** 官方 documentPreviews 注册表的最小面。 */
export interface DocumentPreviewsLike {
  register?: (definition: Record<string, unknown>) => () => void
}

/** 轮询间隔（毫秒）。三次一档，肉眼是"立刻"。 */
const RETRY_INTERVAL_MS = 120
/** 上限次数：120ms × 66 ≈ 8s，覆盖慢机器上官方包懒加载的最坏情况。 */
const MAX_ATTEMPTS = 66

/**
 * 等 `documentPreviews` 就绪后执行一次回调。
 *
 * @param read - 取服务的最小读法（调用方负责包住 cordis Proxy 的抛错）。
 * @param run - 服务就绪时执行一次（失败方自己 try/catch，这里不吞异常语义）。
 * @param onGiveUp - 超时仍未就绪时的回调（用于写诊断水痕）。
 */
export function whenDocumentPreviews(
  read: () => DocumentPreviewsLike | undefined,
  run: (registry: DocumentPreviewsLike & { register: NonNullable<DocumentPreviewsLike['register']> }) => void,
  onGiveUp?: () => void,
): void {
  let attempt = 0
  const tick = (): void => {
    let candidate: DocumentPreviewsLike | undefined
    try {
      candidate = read()
    } catch {
      candidate = undefined
    }
    if (candidate !== undefined && typeof candidate.register === 'function') {
      run(candidate as DocumentPreviewsLike & { register: NonNullable<DocumentPreviewsLike['register']> })
      return
    }
    attempt += 1
    if (attempt >= MAX_ATTEMPTS) {
      onGiveUp?.()
      return
    }
    setTimeout(tick, RETRY_INTERVAL_MS)
  }
  tick()
}
