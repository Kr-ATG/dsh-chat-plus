/**
 * dsh-chat-plus — 「用默认浏览器 / 默认应用打开文件」的客户端入口（2026-10-21）。
 *
 * ## 为什么在 open-default-app.ts 之外再加一层
 *
 * open-default-app.ts 走的是官方 remote.session.openWorkspacePath。那条链对
 * **绝对路径**、**文件真实存在**、**关联是浏览器** 这三种情况都工作正常，
 * 但它有三个对产出物卡致命的前提（实测见 host 半身 src/open-file/index.ts 头注释）：
 *
 *  1. 相对路径按 **host 进程 cwd** 解析，而产出物卡里 present 交付的是
 *     **相对会话工作区**的路径 —— 于是解析成 dsh-runtime\deliverables\…（不存在）；
 *  2. 官方校验不 stat 文件本体，explorer 收到不存在的 file URL 也不报错，
 *     只弹出「文档」文件夹 —— 界面上一片安静，用户以为点了没反应；
 *  3. Windows 上官方 opener **从不**把 .html 交给浏览器（openInBrowser 在 win32
 *     直接 return false），只认文件关联。
 *
 * 所以这里改走本插件的 POST /api/chat-flow/open-file：host 侧先按**会话工作区**
 * 绝对化、stat 文件本体，再把浏览器文档直接交给系统默认浏览器。
 *
 * ## 降级口径（与 open-default-app 的三态一致）
 *
 *  · 'opened'      —— 已交给系统，调用方直接返回；
 *  · 'unavailable' —— 路由没就绪（老版本插件 / 宿主降级）或这台机器没有桌面。
 *                     调用方应退回**官方链路**，再退不回就退回内置预览；
 *  · 'failed'      —— 路由明确拒绝（文件不存在 / 可执行类型 / 无会话工作区）。
 *                     这不是环境问题而是目标问题，调用方**不应**再拿官方链路撞一次
 *                     （它对不存在的路径同样静默成功，只会把「文件夹弹窗」再演一遍）。
 *
 * 全部路径**不抛**：鉴权失败、网络抖动、非 2xx 都收敛成三态之一。
 */

import { resolveWorkspacePath } from './open-preview.ts'

/** 本插件 host 路由。 */
const OPEN_FILE_ROUTE = '/api/chat-flow/open-file'

/** 一次打开尝试的结论（语义见文件头「降级口径」）。 */
export type OpenInBrowserResult = 'opened' | 'unavailable' | 'failed'

/**
 * 用系统默认浏览器（浏览器文档）或默认应用（其余类型）打开一个文件。
 *
 * @param path - 绝对路径，或**相对会话工作区**的路径（后者必须同时给 cwd）。
 * @param options.cwd - 会话工作区根；相对路径的解析基准，缺省时只能是绝对路径。
 * @returns 三态结论，永不抛。
 */
export async function openWithDefaultBrowser(path: string, options?: {
  readonly cwd?: string | null | undefined
}): Promise<OpenInBrowserResult> {
  const target = typeof path === 'string' ? path.trim() : ''
  if (target === '') return 'failed'
  const cwd = typeof options?.cwd === 'string' && options.cwd.trim() !== ''
    ? options.cwd.trim()
    : undefined
  // 相对路径 + 没有工作区：交给 host 也会被拒，这里直接定成 failed（省一次往返）。
  if (cwd === undefined && !isAbsolutePath(target)) return 'failed'

  let response: Response
  try {
    response = await fetch(OPEN_FILE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target, ...(cwd === undefined ? {} : { cwd }) }),
      credentials: 'same-origin',
    })
  } catch {
    // 网络层失败（宿主不可达）：当作路由没就绪，让调用方退回官方链路。
    return 'unavailable'
  }
  if (response.status === 404) return 'unavailable'
  if (!response.ok) return 'failed'
  try {
    const payload = (await response.json()) as { ok?: unknown }
    return payload?.ok === true ? 'opened' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Windows 盘符 / UNC / Unix 根的绝对路径判定（与 open-preview.ts 同判据，不引它以免循环依赖口径漂移）。 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
}

/**
 * 打开一个产出物条目（相对路径自动按会话工作区补全）。
 *
 * 与 {@link openWithDefaultBrowser} 的唯一差别：**先补全成绝对路径再发**。
 * 这样做的好处是 host 端能看到一条绝对路径，日志/诊断里能直接看出打开的是哪个
 * 文件；而相对路径形态在 host 侧要靠请求里的 cwd 才解析得动，多一道依赖。
 * @param path - 可能是相对路径的条目路径。
 * @param options.cwd - 会话工作区根。
 * @returns 三态结论，永不抛。
 */
export async function openOutputFile(path: string, options?: {
  readonly cwd?: string | null | undefined
}): Promise<OpenInBrowserResult> {
  const cwd = typeof options?.cwd === 'string' && options.cwd.trim() !== ''
    ? options.cwd.trim()
    : undefined
  if (cwd === undefined) return openWithDefaultBrowser(path, { cwd })
  const absolute = resolveWorkspacePath(cwd, path)
  return openWithDefaultBrowser(absolute, { cwd })
}
