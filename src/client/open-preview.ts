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

/** 右栏服务的最小面（只用到打开资源这一个方法）。 */
interface SidebarRightLike {
  openResource?: (address: string, options?: unknown) => void
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

/**
 * 在 DSH 右侧栏打开一个文件的预览。
 *
 * @param path - 绝对路径或会话工作区相对路径。
 * @param options.sessionId - 会话 id；缺省时用右栏当前挂载的会话。
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

  // 会话 id 取三路：调用方显式传入 → 右栏当前挂载会话 → 都没有则放弃。
  let sessionId = typeof options?.sessionId === 'string' && options.sessionId !== ''
    ? options.sessionId
    : ''
  if (sessionId === '') {
    try {
      const mounted = (sidebar as unknown as { mounted?: { getSnapshot?: () => unknown } }).mounted
      const value = mounted?.getSnapshot?.()
      if (typeof value === 'string' && value !== '') sessionId = value
    } catch { /* 取不到就走失败分支 */ }
  }
  if (sessionId === '') return { ok: false, reason: 'no-session' }

  const address = fileAddressFor(sessionId, options?.cwd, target)
  try {
    if (options?.line === undefined) sidebar.openResource(address)
    else sidebar.openResource(address, { params: { line: options.line } })
    return { ok: true, address }
  } catch {
    return { ok: false, address, reason: 'threw' }
  }
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
