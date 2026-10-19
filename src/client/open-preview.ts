/**
 * dsh-chat-plus — 打开 DSH 右侧「工作区文件预览」（open-preview）。
 *
 * 解决什么问题：KR 对话里模型产出的文件与截图，用户在对话流里既看不到图、
 * 也点不开。官方只对「本回合写过、且回合已收口」的行内代码做文件提及，
 * 裸路径、运行中的产出、以及右栏操作面板里的文件名全都点不动。
 *
 * 本模块把「点一个路径 → 右栏拉起对应预览」这件事收敛成一个函数：
 *   · 走官方公开面 `ctx.sidebarRight.openResource(address)`，
 *     与对话流里官方文件链接、文件树、deliverable 卡片是同一条链路；
 *   · 地址用官方文法 `dsh-resource://file/session/<sid>/<path>`
 *     （相对路径相对会话工作区解析，绝对路径原样带走）；
 *   · 文本 / 图片 / PDF / Office / Excel 的呈现由官方 document preview
 *     按扩展名自行分派，本模块不关心，也绝不自己造预览 UI。
 *
 * 全部接口**不抛**：拿不到服务、地址非法、会话未知时静默返回 false，
 * 调用方据此决定是否保留原生行为（比如让 <a> 继续走默认跳转）。
 */

import { getService } from './client-ctx.ts'

/** 官方地址前缀（与 @deepseek-ai/dsh-util-workspace-path 同字面量）。 */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** Windows 盘符或 UNC 开头；与官方 isAbsoluteWorkspacePath 同判据。 */
function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
}

/** 单段编码：保留盘符里的 `:`（官方 encodeSegment 同做法）。 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/**
 * 拼一个会话作用域的文件地址。
 * @param sessionId - 会话 id。
 * @param path - 绝对路径或会话工作区相对路径（反斜杠会被归一化）。
 * @returns `dsh-resource://file/session/<sessionId>/<path>`。
 */
function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const encoded = normalized.split('/').map(encodeSegment).join('/')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encoded}`
}

/**
 * 把一个路径变成会话作用域地址；工作区内的绝对路径会被相对化，
 * 与官方 fileAddressFor 行为一致（右栏标题因此只显示文件名/相对段）。
 * @param sessionId - 会话 id。
 * @param cwd - 会话工作区根目录，未知时传 undefined。
 * @param path - 目标路径。
 * @returns 文件地址。
 */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized)
  const root = cwd === undefined ? '' : cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '')
  if (root !== '' && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1))
  }
  return sessionFileAddress(sessionId, normalized)
}

/** 右栏服务的最小面（打开资源 + 观察「屏幕上是谁」）。 */
interface SidebarRightLike {
  openResource?: (address: string, options?: unknown) => void
  /**
   * 屏幕上那个会话（官方契约：只有「会话填满主列」时才有值）。
   *
   * 之所以要它：`openResource` 内部写的是**那个会话的布局 store**，没有屏幕会话
   * 就直接抛 `no session surface is mounted`。全局面板（工作台 / 设置）占着主列
   * 时它必然是空的 —— 画廊正是在那种状态下点开文件的。
   *
   * 「值是目标会话」还不够：那个会话的布局 store 是 slot 运行时**下一拍**才 mint
   * 出来的（实测 mounted 已切换、store 还没到，同一 tick 调 openResource 仍抛）。
   * 所以打开动作要能重试，判据是官方那句错误原文。
   */
  mounted?: { getSnapshot?: () => unknown }
}

/** 官方「这个会话还没有可写的右栏 store」的错误原文前缀。 */
const SURFACE_NOT_READY = 'no session surface is mounted'

/** 就绪重试的节奏：60ms 一次，最多等 4s（实测切换会话后约 90ms 就绪）。 */
const SURFACE_RETRY_MS = 60
const SURFACE_RETRY_MAX_MS = 4000

/**
 * 调一次 openResource。
 *
 * @returns 成功返回 null；失败返回官方错误原文（调用方据此判断「只是没就绪」
 * 还是「真出错了」——前者重试，后者必须停，否则会空转四秒）。
 */
function attemptOpen(
  sidebar: SidebarRightLike,
  address: string,
  line: number | undefined,
): string | null {
  try {
    if (line === undefined) sidebar.openResource!(address)
    else sidebar.openResource!(address, { params: { line: line } })
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

/**
 * 等右栏 store 就绪后打开（关面板 → 轮询 → 打开）。
 *
 * 为什么必须轮询而不是等一帧：`mounted` 的切换与布局 store 的 mint 不在同一步
 * （见 {@link SidebarRightLike.mounted} 的说明），实测两者相差约 90ms，中间任何
 * 一次 openResource 都会抛。而官方没有暴露「store 已就绪」的观察面，能观测的
 * 只有这一次调用的成功与否 —— 所以用「试一次、失败就等下一拍」。
 *
 * 每次重试前都重新确认「主列不在全局面板里」：用户在等待窗口里可能又点开了
 * 工作台（那会把右栏 DOM 重新 hidden 掉），发现就再关一次。
 *
 * @param sidebar - 右栏服务。
 * @param address - 已拼好的文件地址。
 * @param line - 源码行号。
 * @param giveUp - 超时仍打不开时回调（调用方据此给一句提示，而不是静默）。
 */
function openWhenSurfaceReady(
  sidebar: SidebarRightLike,
  address: string,
  line: number | undefined,
  giveUp?: () => void,
): void {
  const startedAt = Date.now()
  const tick = (): void => {
    leaveGlobalPanel()
    const failure = attemptOpen(sidebar, address, line)
    if (failure === null) return
    // 只有「store 还没 mint」值得重试；地址没类型认领这类接线错误重试一万次也一样。
    if (!failure.startsWith(SURFACE_NOT_READY)) return
    if (Date.now() - startedAt >= SURFACE_RETRY_MAX_MS) {
      giveUp?.()
      return
    }
    setTimeout(tick, SURFACE_RETRY_MS)
  }
  tick()
}

/* ── 路径存在性探测 ───────────────────────────────────────────────────── */

/**
 * 一次存在性探测的结论。
 *
 * 三态是刻意的：`unknown` 与 `missing` 必须分开。把「服务不可用 / 网络抖动 /
 * 权限拒绝」也当成 missing，会让整张产出物卡在宿主降级时集体置灰 —— 用户看到
 * 的是「我的文件全没了」，而实际只是探测没跑成。
 */
export type ProbeResult = 'exists' | 'missing' | 'unknown'

/** Host 明确回答「这里没有这个文件」的错误码。 */
const NOT_FOUND_CODES = new Set(['workspace-file/not-found', 'workspace-file/not-regular-file'])

/** workspaceFiles 服务的最小面（只用到 stat）。 */
interface WorkspaceFilesLike {
  stat?: (scope: string, path: string, signal?: AbortSignal) => Promise<unknown>
}

/**
 * 取官方 `workspaceFiles` 客户端服务。
 *
 * 两条路都要试：Gateway 把每个 Remote 命名空间注册成独立 Service（键名
 * `remote.<namespace>`），而根 `remote` 服务本身也可能挂着同名命名空间属性。
 * 只在其中一条上找，宿主版本一变就整个失效。
 *
 * ⚠ 每条路都必须单独 try/catch：cordis 的 ctx 是 Proxy，**读一个未在 inject
 * 白名单里声明的属性会直接抛** `cannot get property "x" without inject`。
 * 实测（2026-10-01，headless Chrome 连真实宿主）：`ctx.get('remote')` 本身成功，
 * 但紧接着读 `remote.workspaceFiles` 就抛这个错 —— 不包住的话，第一条路一旦
 * 失效，异常会从探测函数里穿出去，整张卡挂载时炸掉。
 * @returns 服务，或 undefined。
 */
function workspaceFilesService(): WorkspaceFilesLike | undefined {
  for (const name of ['remote.workspaceFiles', 'remote']) {
    let candidate: Record<string, unknown> | undefined
    try {
      candidate = getService<Record<string, unknown>>(name)
    } catch {
      continue
    }
    if (candidate === undefined || candidate === null) continue
    try {
      if (typeof candidate.stat === 'function') return candidate as WorkspaceFilesLike
      const nested = candidate.workspaceFiles
      if (typeof nested === 'object' && nested !== null && typeof (nested as WorkspaceFilesLike).stat === 'function') {
        return nested as WorkspaceFilesLike
      }
    } catch {
      // 未 inject 的属性读了就抛：这条跳过，试下一条。
      continue
    }
  }
  return undefined
}

/**
 * 探测一个路径当前是否真的存在（走官方 `workspaceFiles.stat`）。
 *
 * 为什么要探测：产出物卡里的路径是**从工具输出里推断**出来的，不是模型显式
 * 声明的交付。推断会错（URL 路径段、命令当时的工作目录、`_tmp/` 中转已清理），
 * 而官方右栏对不存在的路径只会打开一个空白 tab、路径行显示原始字符串 —— 用户
 * 会以为「打开的位置不对」，实际是那个文件根本不在那儿。
 *
 * 全部失败路径都收敛成 `unknown`（绝不抛，也绝不误判成 missing）：探测只是
 * 锦上添花，拿不到结论时按「可以点」处理，把决定权交回给右栏。
 *
 * @param path - 绝对路径或会话工作区相对路径。
 * @param options.sessionId - 会话 id；缺省时不探测。
 * @returns 探测结论。
 */
export async function probeWorkspaceFile(path: string, options?: {
  readonly sessionId?: string | null | undefined
}): Promise<ProbeResult> {
  const target = typeof path === 'string' ? path.trim() : ''
  const sessionId = typeof options?.sessionId === 'string' ? options.sessionId : ''
  if (target === '' || sessionId === '') return 'unknown'

  const files = workspaceFilesService()
  if (files === undefined || typeof files.stat !== 'function') return 'unknown'

  try {
    const result = await files.stat(sessionId, target) as {
      ok?: boolean
      error?: { code?: string } | null
    } | undefined
    if (result === undefined || result === null || typeof result !== 'object') return 'unknown'
    if (result.ok === true) return 'exists'
    const code = result.error?.code
    if (typeof code === 'string' && NOT_FOUND_CODES.has(code)) return 'missing'
    // 其余错误（未知工作区、超限、载体中断…）都不是「文件没了」的证据。
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 批量探测：并发跑，逐个降级。用于卡片挂载后给可见条目做一次体检。 */
export async function probeWorkspaceFiles(paths: readonly string[], options?: {
  readonly sessionId?: string | null | undefined
}): Promise<ReadonlyMap<string, ProbeResult>> {
  const out = new Map<string, ProbeResult>()
  await Promise.all(paths.map(async (path) => {
    out.set(path, await probeWorkspaceFile(path, options))
  }))
  return out
}

/** 一次打开的结果，供调用方决定是否降级。 */
export interface OpenPreviewResult {
  /** 是否已交给右栏。 */
  readonly ok: boolean
  /** 实际使用的地址（便于调试/断言）。 */
  readonly address?: string
  /** 未打开的原因（ok 为 false 时有值）。 */
  readonly reason?: 'no-service' | 'no-session' | 'empty-path' | 'threw'
}

/* ── 屏幕会话与「先回到会话」──────────────────────────────────────────── */

/** 官方 layout 服务的最小面（切面板用）。 */
interface LayoutLike {
  selectPanel?: (id: string | null) => void
  panelInfo?: { getSnapshot?: () => { activePanelId?: string | null } | undefined }
}

/**
 * 读官方 layout 服务（读不到返回 undefined，调用方各自降级）。
 *
 * 为什么连它也要读：右栏 `openResource` 只对**屏幕上那个会话**生效，而工作台 /
 * 设置这类全局面板一占住主列，屏幕会话就是空的（官方把它定义成「会话填满主列
 * 时才有值」）。收藏夹式的画廊页恰恰总在这种状态下被点开。
 */
function layoutService(): LayoutLike | undefined {
  try {
    return getService<LayoutLike>('layout')
  } catch {
    return undefined
  }
}

/** 当前占着主列的全局面板 id（没有面板 / 读不到返回 null）。 */
function activePanelId(): string | null {
  try {
    const value = layoutService()?.panelInfo?.getSnapshot?.()?.activePanelId
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/**
 * 屏幕上当前的会话 id（供调用方判断「现在右栏到底有没有落点」）。
 *
 * @returns 会话 id；全局面板占着主列、或服务不可用时返回 null。
 */
export function onScreenSession(): string | null {
  const sidebar = getService<SidebarRightLike>('sidebarRight')
  try {
    const value = sidebar?.mounted?.getSnapshot?.()
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/**
 * 把主列切回会话 —— 官方右栏唯一的落点。
 *
 * 只在「现在是个全局面板」时才切；已经在会话里就什么都不做（切会话是用户的
 * 导航动作，不该被一次预览点击偷偷改掉）。
 *
 * @returns 是否调用过 selectPanel。
 */
function leaveGlobalPanel(): boolean {
  const panel = activePanelId()
  if (panel === null) return false
  try {
    layoutService()?.selectPanel?.(null)
    return true
  } catch {
    return false
  }
}

/**
 * 在 DSH 右侧栏打开一个文件的预览。
 *
 * 四条与官方实现绑定的既定事实决定了它长这样：
 *  1. `openResource` 作用于**屏幕上那个会话**的布局 store，没有屏幕会话直接抛
 *     `no session surface is mounted`（不是静默失败）；
 *  2. 地址里的 `sessionId` 只决定文件按哪个工作区解析，**不会**让右栏切会话；
 *  3. 全局面板（工作台 / 设置）占着主列时，右栏 DOM 被整个 `hidden` —— 官方
 *     RightbarRoot 的 `visible = activePanelId === null`，面板页上没有任何办法
 *     把侧栏叫出来。所以从画廊点开文件**必然要离开面板页**，这不是插件多做
 *     的动作，是官方布局的定义；
 *  4. 会话的布局 store 是下一拍才 mint 的，紧跟切会话的那次调用仍会抛同样的
 *     错误，所以打开动作要能重试（见 {@link openWhenSurfaceReady}）。
 *
 * **只关面板，不切会话。** 上一版在这里犯了两个方向的错，都实测留着记录：
 *  · 先只关面板、地址沿用条目会话 —— tab 落进**当前会话**的右栏，一换会话就
 *    消失（实测 `openSession(别的) → active() === null`）；
 *  · 改成「切到条目所属会话再开」—— 更糟：用户在工作台看全局画廊，点一张老图
 *    就被拽到那个几天前的会话里去，正是「点一下乱跳」的来源。
 *
 * 现在的口径：**用户在哪就在哪看**。屏幕会话只用来决定「把 tab 开在谁的右栏」，
 * 地址里的会话决定「文件按谁的工作区解析」—— 两者本就互相独立，一个从画廊点开
 * 的历史图片不需要为此把对话切走。切会话是用户的导航动作，不该被一次预览点击
 * 代理。
 *
 * @param path - 绝对路径或会话工作区相对路径。
 * @param options.sessionId - 文件所属会话（画廊 / 产出物条目都自带），用于拼地址。
 * @param options.cwd - 会话工作区根目录；缺省时去 sessions 服务现读。
 * @param options.line - 打开后定位到的行号（文本预览支持）。
 * @returns 打开结果；`ok: false` 时调用方应保留自身降级行为。
 */
export function openWorkspacePreview(path: string, options?: {
  readonly sessionId?: string | null | undefined
  readonly cwd?: string | undefined
  readonly line?: number | undefined
}): OpenPreviewResult {
  const target = typeof path === 'string' ? path.trim() : ''
  if (target === '') return { ok: false, reason: 'empty-path' }

  const sidebar = getService<SidebarRightLike>('sidebarRight')
  if (sidebar === undefined || sidebar === null || typeof sidebar.openResource !== 'function') {
    return { ok: false, reason: 'no-service' }
  }

  /*
   * 会话 id 只有一个用途：拼进地址，决定文件按哪个工作区解析。
   * 屏幕会话与它无关 —— tab 开在屏幕会话的右栏，路径按地址里的会话解析。
   */
  let addressSession = typeof options?.sessionId === 'string' && options.sessionId !== ''
    ? options.sessionId
    : ''
  if (addressSession === '') {
    const mounted = onScreenSession()
    if (mounted !== null) addressSession = mounted
  }
  if (addressSession === '') return { ok: false, reason: 'no-session' }

  const address = fileAddressFor(addressSession, options?.cwd, target)

  /*
   * 先关面板（右栏 DOM 才会从 hidden 里出来），再同步试一次。
   * 绝大多数点击到这里就成功了，用户看到的是「面板关上 + 右栏直接显示这个文件」。
   */
  leaveGlobalPanel()
  const failure = attemptOpen(sidebar, address, options?.line)
  if (failure === null) return { ok: true, address }
  if (!failure.startsWith(SURFACE_NOT_READY)) return { ok: false, address, reason: 'threw' }

  // 只有一个会话都没有（刚启动还没选会话）时才会走到这里：等它 mint 完再开。
  openWhenSurfaceReady(sidebar, address, options?.line)
  return { ok: true, address }
}

/**
 * 把本地绝对路径变成浏览器可直接显示的图片地址（官方 `/api/file` 路由）。
 *
 * 与官方 fileMediaUrl 同一实现：只接受 http(s) 或 dsh-app 基址下的绝对路径，
 * 反斜杠统一成正斜杠交给服务端。
 * @param path - 绝对本地路径。
 * @returns 可显示的 URL，或 undefined（相对路径 / 非法路径 / 非 http 基址）。
 */
export function localFileMediaUrl(path: string): string | undefined {
  if (typeof path !== 'string' || path === '') return undefined
  const normalized = path.replace(/\\/g, '/')
  if (!isAbsoluteWorkspacePath(normalized)) return undefined
  if (/^\/{2}/.test(normalized)) return undefined
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return undefined
  try {
    const base = document.baseURI
    if (!/^https?:/u.test(base) && !base.startsWith('dsh-app://app/')) return undefined
    return new URL(`api/file?path=${encodeURIComponent(normalized)}`, base).href
  } catch {
    return undefined
  }
}

/**
 * 相对路径 → 绝对路径（拼会话工作区）。已经是绝对路径时原样返回。
 * @param cwd - 会话工作区根目录。
 * @param path - 可能相对的路径。
 * @returns 绝对路径（cwd 未知且 path 相对时原样返回相对路径）。
 */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (isAbsoluteWorkspacePath(path)) return path
  if (cwd === undefined || cwd === '') return path
  const separator = /^[A-Za-z]:[/\\]/.test(cwd) && cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[/\\]+$/, '')}${separator}${path.replace(/^[/\\]+/, '')}`
}

/** 常见图片扩展名（判断「这个路径能不能当图看」）。 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i

/** 是否是图片路径（按扩展名）。 */
export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path.split(/[?#]/)[0] ?? '')
}

/** 常见文本/代码扩展名之外，右栏文档预览还认这些；此处只用于「是否值得做成链接」。 */
const TEXTUAL_EXT = /\.(md|markdown|txt|log|json|jsonc|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|cxx|h|hh|hpp|cs|php|sh|bash|zsh|ps1|bat|cmd|sql|xml|svg|srt|vtt|env|gitignore|dockerfile|makefile)$/i

/** 是否是「值得做成可点文件」的路径（有扩展名，且不是明显的 URL）。 */
export function looksLikeFilePath(path: string): boolean {
  if (typeof path !== 'string' || path === '') return false
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return false
  const clean = path.split(/[?#]/)[0] ?? ''
  if (clean.length === 0 || clean.length > 400) return false
  const base = clean.split(/[/\\]/).filter(Boolean).at(-1) ?? ''
  if (base === '') return false
  // 必须带扩展名（无扩展名的目录名一律不当文件）。
  return /\.[A-Za-z0-9]{1,12}$/.test(base)
}

/** 文本类扩展名判定（用于决定「预览链接」是否值得上屏）。 */
export function isTextualPath(path: string): boolean {
  return TEXTUAL_EXT.test(path.split(/[?#]/)[0] ?? '')
}

/**
 * 打开预览的「用户手势」包装：成功则返回 true（调用方应 preventDefault）。
 *
 * 与 openWorkspacePreview 分开是因为渲染层常需要「先试右栏、失败再走原行为」
 * 这个二选一，包装成布尔更好读。
 * @param path - 目标路径。
 * @param options - 会话与行号。
 * @returns 是否已由右栏承接。
 */
export function tryOpenInSidebar(path: string, options?: {
  readonly sessionId?: string | null | undefined
  readonly cwd?: string | undefined
  readonly line?: number | undefined
}): boolean {
  return openWorkspacePreview(path, options).ok
}
