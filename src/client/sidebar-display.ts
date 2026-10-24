/**
 * dsh-chat-plus — 「这个文件能不能在官方右侧栏里**正常展示**」的判据
 * （client 半身，2026-10-22）。
 *
 * ## 它回答什么
 *
 * 用户 2026-10-22 的口径：**产出物里，官方侧边栏能正常展示的类型就用侧栏看，
 * 展示不了的类型才交给系统默认应用**。这条判据就是那句话的可执行版本。
 *
 * 在那之前的口径是反过来的（2026-10-20 起「整行即交给系统默认应用」，侧栏只当
 * 降级）—— 结果是「图 / 文档 / 视频」这类明明侧栏看得很好的东西，点一下就把
 * 用户的 PowerPoint / 播放器整个拉起来；而 3D 模型、压缩包这些侧栏根本展示不了
 * 的，点一下只得到一句「不支持预览」。
 *
 * ## 「正常展示」的判据（2026-10-22 逐扩展名核验过）
 *
 * 只认**真渲染**：用户点开看到的是成品形态（图、播放器、排版后的文档、渲染后的
 * 页面、可交互的表格）。以下三档**不算**，一律交系统默认应用：
 *
 *  1. **只能看源码**：官方会用纯文本兜底或代码高亮把它们当文本读出来，能读，
 *     但不是"这份文件该有的样子"——rtf 看到 `{\rtf1\ansi…}`、obj/gltf/dae 看到
 *     一堆顶点坐标、xhtml 看到 HTML 源码。对用户来说这就是"打不开"。
 *  2. **空态**：官方 `UNVIEWABLE_BINARY_EXTENSIONS` 里的已知二进制容器（7 种
 *     压缩包、avif/tif/tiff/heic、ods），打开就是「该格式文件暂时无法预览」。
 *  3. **not-text**：既没注册、也不在 UNVIEWABLE 的二进制（blend/glb/3ds 必现，
 *     fbx/stl/ply 视编码），会落到纯文本兜底后在读页时报 `workspace-file/not-text`。
 *  4. **容器浏览器解不了**（2026-10-24 用真实 Chromium 逐个灌文件实测）：avi
 *     （Video for Windows）与 wma（Windows Media Audio）—— 播放器会挂出来、UI 一切
 *     正常，但一帧都解不出，只在控制台留一句 SRC_NOT_SUPPORTED。用户看到的是
 *     「黑的 + 播不了」，比直接交给系统默认应用差得多。判据见
 *     `BROWSER_UNDECODABLE_MEDIA_EXT`。
 *
 * ## 为什么是**静态表**而不是读官方 registry
 *
 * 直觉上应该问 `documentPreviews.candidates(path)`，但那条判据会把上面第 1 档
 * 也算成"能看"——官方注册的 code 高亮渲染器认 xhtml，它命中的是"显示源码"。
 * 而用户要的是"正常展示"。所以这里维护一张**只列真渲染**的表，代价是宿主升级
 * 加了新渲染器时要跟着补；收益是判据与用户看到的东西严格一致，不会把一份 3D
 * 模型送进一个满屏顶点坐标的文本页。
 *
 * 表里三组来源必须与实现同步（冒烟有一条断言专门钉这件事）：
 *  · 官方内置：markdown / html / image / pdf / office / excel（逐条抄自
 *    `dsh-client-ui-sidebar-documentpreview/lib/client.js` 的 `extensions`）；
 *  · 本插件 `sidebar-doc`：pdf / Office / ods（LibreOffice 转 PDF → 浏览器查看器）；
 *  · 本插件 `sidebar-media`：原生 `<video>` / `<audio>`。
 *
 * 全部函数**不抛**：拿不到期望值就收敛成 `false`（交系统默认应用），绝不把异常
 * 抛进点击链路。
 */

/** 一次判定的落点。 */
export type SidebarDisplay = 'sidebar' | 'external'

/** 官方 documentPreviews 注册表的最小面（只用到 candidates）。 */
export interface PreviewRegistryLike {
  candidates?: (path: string) => readonly unknown[] | undefined
}

/**
 * 官方内置渲染器**真渲染**的扩展名。
 *
 * 逐条抄自 `dsh-client-ui-sidebar-documentpreview/lib/client.js`（2026-10-22 对过）：
 *   · markdown → md / markdown            （1674 行，text-pages 渲染）
 *   · html     → html / htm               （4500 行，bytes-complete 沙箱 iframe）
 *   · image    → png jpg jpeg gif webp bmp ico svg（5220-5228，<img>）
 *   · pdf      → pdf                      （5371 行）
 *   · office   → doc docx ppt pptx        （6039-6044，转 PDF）
 *   · excel    → xlsx xls csv tsv         （6260-6265，浏览器内表格）
 *
 * 刻意不收：`txt` 单独在 TEXT_RENDERED_EXT 里（它走纯文本兜底，但文本文件显示
 * 文本就是它的正常形态）；`xhtml` 不在 html 组（官方只认 html/htm），会被 code
 * 高亮接住显示源码 —— 按"只能看源码"归外部。
 */
const OFFICIAL_RENDERED_EXT: ReadonlySet<string> = new Set([
  // markdown
  'md', 'markdown',
  // html 成品（渲染后的页面）
  'html', 'htm',
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg',
  // pdf
  'pdf',
  // office（host 转 PDF）
  'doc', 'docx', 'ppt', 'pptx',
  // excel（浏览器内表格）
  'xlsx', 'xls', 'csv', 'tsv',
])

/**
 * 本插件侧栏渲染器接管的扩展名。
 *
 * 与 `sidebar-doc/index.tsx` 的 CLAIMED_EXTENSIONS 和 `sidebar-media/index.tsx`
 * 的 CLAIMED_EXTENSIONS **逐字一致**（冒烟断言钉住三处不漂）。
 *
 * `ods` 在这里是因为 2026-10-22 一并把它接进了 sidebar-doc：host 的 LibreOffice
 * 引擎本来就支持它（src/office/index.ts 的 RENDERABLE_EXT 含 .ods），只是客户端
 * 之前没注册，官方又把它列进 UNVIEWABLE —— 结果"引擎能转、侧栏不认"。接管后
 * 它和 xls/xlsx 走不同的路（转 PDF 看，而非浏览器表格），但至少能看了。
 */
export const PLUGIN_RENDERED_EXT: ReadonlySet<string> = new Set([
  // sidebar-doc：pdf / Office / ods（LibreOffice 转 PDF → 浏览器内置查看器）
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'odt', 'odp', 'ods',
  // sidebar-media：原生 <video> / <audio> 里**浏览器真能解码**的那一族。
  //
  // ⚠ 这份名单不能用「渲染器接管了哪些后缀」直接顶替 —— 接管只代表侧栏会挂出
  // 一个播放器，不代表播放器能出画面。2026-10-24 用真实 Chromium（154）灌真实
  // 文件逐个实测，两个后缀被剔出去：
  //  · **avi**：Video for Windows 容器，三种 MIME 声明（x-msvideo / mp4 /
  //    octet-stream）全部 SRC_NOT_SUPPORTED —— 容器不在解码面里。
  //  · **wma**：Windows Media Audio，同样三种声明全失败。
  // 这两个交系统默认应用才是「点开就看见」；留在侧栏只会得到一个黑播放器
  // 加一句报错，正是用户 2026-10-22 说的「点开只有一句不支持预览」。
  //
  // 保留的 mov / mkv / opus 都是实测**能播**的（细节见 sidebar-media 的
  // MIME_BY_EXT：mov 必须声明成 video/mp4，opus 必须声明成 audio/ogg）。
  'mp4', 'webm', 'mov', 'mkv', 'm4v',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus',
])

/**
 * 浏览器**解不了**的媒体容器（2026-10-24 实测，见文件头第 4 档）。
 *
 * 这张表与 PLUGIN_RENDERED_EXT 是互补关系而不是重复：
 *  · PLUGIN_RENDERED_EXT 说「侧栏有渲染器接管」；
 *  · 本表说「接管了也播不出来」。
 *
 * 分开写的理由：`sidebar-media` 的 CLAIMED_EXTENSIONS 必须覆盖这些后缀 ——
 * 官方把它们列进 UNVIEWABLE，不接管的话用户从**文件树**点开时连播放器都没有；
 * 接管之后至少有一个能重试的界面。但**产出物卡的分流判据**不该把它们送进侧栏，
 * 那里有更好的选择（系统默认应用）。
 *
 * 实测依据（Chromium 154.0.8037.44，真实文件 + 三种 MIME 声明）：avi 与 wma
 * 全部 `error: SRC_NOT_SUPPORTED`。
 */
export const BROWSER_UNDECODABLE_MEDIA_EXT: ReadonlySet<string> = new Set(['avi', 'wma'])

/**
 * 官方纯文本兜底里**确实能读、且读出来就是它本来样子**的扩展名。
 *
 * 只有 `txt` / `log`：纯文本文件的内容就是文本，分页读出来不算降级。
 * `rtf` 刻意不在：它是带控制字的富文本，读出来是一屏 `{\rtf1\ansi…}`。
 */
export const TEXT_RENDERED_EXT: ReadonlySet<string> = new Set(['txt', 'log'])

/** 路径里的扩展名（小写、不含点）；没有则空串。 */
export function extensionOf(path: string): string {
  const base = path.split(/[/\\]/).filter(Boolean).at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * 这个文件能不能交给官方右侧栏**正常展示**。
 *
 * @param path - 绝对路径或会话工作区相对路径（只看扩展名）。
 * @param options.previews - 官方注册表（可选）。只在**冒烟与诊断**里用：它不是
 *   判据来源（理由见文件头），保留这个口子是为了让测试能显式演示「registry 命中
 *   也不代表能正常展示」这条边界。
 * @returns true = 走官方侧栏；false = 该交给系统默认应用。
 */
export function canShowInSidebar(
  path: string,
  options?: { readonly previews?: PreviewRegistryLike | null | undefined },
): boolean {
  void options
  const target = typeof path === 'string' ? path.trim() : ''
  if (target === '') return false
  const ext = extensionOf(target)
  if (ext === '') return false
  // 「有渲染器接管」不等于「能正常展示」：先剔掉浏览器解不了的容器
  // （avi / wma），再问有没有人接管。顺序不能反 —— 反了就会把它们判成 sidebar。
  if (BROWSER_UNDECODABLE_MEDIA_EXT.has(ext)) return false
  return OFFICIAL_RENDERED_EXT.has(ext)
    || PLUGIN_RENDERED_EXT.has(ext)
    || TEXT_RENDERED_EXT.has(ext)
}

/**
 * 判定的落点标签，给 UI 直接用（读屏文案 / 行尾图标按它分派）。
 * @param path - 目标路径。
 * @returns 'sidebar' 或 'external'。
 */
export function sidebarDisplayOf(path: string): SidebarDisplay {
  return canShowInSidebar(path) ? 'sidebar' : 'external'
}

/** 诊断用：当前登记的「能展示」扩展名（排序后，供冒烟与设置页展示）。 */
export function sidebarRenderedExtensions(): string[] {
  return [...new Set([
    ...OFFICIAL_RENDERED_EXT,
    ...PLUGIN_RENDERED_EXT,
    ...TEXT_RENDERED_EXT,
  ])].filter((ext) => !BROWSER_UNDECODABLE_MEDIA_EXT.has(ext)).sort()
}
