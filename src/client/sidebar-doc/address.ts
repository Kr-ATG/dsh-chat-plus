/**
 * dsh-chat-plus — 官方侧边栏地址解析（纯函数）。
 *
 * 右侧栏文档 tab 的地址文法是官方 `dsh-util-workspace-path` 定的：
 * `dsh-resource://file/session/<encodedSid>/<encodedSeg>/<encodedSeg>...`
 * （相对路径相对会话工作区解析；workspace 外的绝对路径原样逐段编码带走）。
 *
 * 这里只做**反向解析**：把地址拆回 `{ sessionId, path }`，供插件自己的文档
 * 渲染器拼预览 URL。官方没有导出 hostFileOf，但文法是公开契约（README 与
 * open-preview.ts 的 fileAddressFor 逐字对齐），自己解比依赖内部函数稳。
 *
 * 解码只走一轮 decodeURIComponent：官方编码时也是一轮 encode（段内的 `%`
 * 会被编成 `%25`，解一轮正好还原），多解一轮会把文件名里字面的 `%20` 之类
 * 二次破坏。
 */

/** 解析结果：会话 id + 请求路径（相对或绝对，保持官方编码前的形态）。 */
export interface SidebarFileAddress {
  readonly sessionId: string
  readonly path: string
}

/**
 * 解析一个 `dsh-resource://file/session/...` 地址。
 *
 * @param address - 官方侧边栏资源地址。
 * @returns 会话与路径；不是 Session 文件地址时返回 null。
 */
export function parseFileAddress(address: string): SidebarFileAddress | null {
  if (typeof address !== 'string' || address === '') return null
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'file') return null
  const segments = url.pathname.split('/').filter((part) => part !== '')
  // ['session', <sid>, ...pathSegs]
  if (segments.length < 3 || segments[0] !== 'session') return null
  const sessionId = safeDecode(segments[1] ?? '')
  const path = segments.slice(2).map(safeDecode).join('/')
  if (sessionId === '' || path === '') return null
  return { sessionId, path }
}

/** 单段解码：坏转义序列原样保留，不抛（地址是外部输入，抛了整块渲染就没了）。 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** 导出给冒烟对拍的内部面。 */
export const __test = { safeDecode }
