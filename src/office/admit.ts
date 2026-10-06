/**
 * dsh-chat-plus — 产出物路径准入（host 半身，纯判定 + 名单登记）。
 *
 * 回答一个问题：**插件自己的只读路由，凭什么允许读这个本地文件。**
 *
 * 插件的 `/api/triad/gallery/raw`、`/api/chat-flow/office/*`、
 * `/api/chat-flow/screenshot/page` 三条路由族等价于「读本机任意文件」的能力，
 * 必须收窄成同一个口径：**只服务被某个对话真正产出过的路径**。
 *
 * 两级判据（从快到慢）：
 *  1. **全局名单**：画廊 `/media` 聚合（或 `/raw` 的会话作用域兜底）登记进来的
 *     绝对路径集合。这是主路，也是「画廊索引即白名单」这条既有安全契约的实现；
 *  2. **会话作用域**：带 `session` 时现折该会话的产出清单，相对路径按**该会话
 *     cwd** 折绝对。用户可能从没开过画廊（全局名单为空），产出物卡那条路就靠它。
 *
 * 为什么把名单做成模块级的：三条路由分开各折一次会话 = 三套会漂的状态。实测过
 * 这种漂移的后果 —— 产出物卡里明明有这张图、点开却是裂图（名单没跟上）。一份名单
 * 三处共用，漂移在结构上就不存在。
 */

import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { sessionContextFor, type SessionContext } from '../triad/gallery/store.ts'

/** 归一化路径键（分隔符与大小写归一，Windows 盘符不敏感）。 */
export function previewPathKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/** 已登记的绝对路径（全局名单）。 */
let admitted: Set<string> | null = null

/**
 * 登记一批产出物路径（画廊聚合与会话折卷都会调用，幂等）。
 * @param paths - 绝对路径。
 */
export function rememberOfficePaths(paths: Iterable<string>): void {
  if (admitted === null) admitted = new Set()
  for (const path of paths) admitted.add(previewPathKey(path))
}

/** 全局名单当前规模（诊断用；未建时为 -1）。 */
export function admittedCount(): number {
  return admitted === null ? -1 : admitted.size
}

/** 从插件上下文读画廊折卷需要的两个服务（缺了也能跑，只是会话作用域那条会拒）。 */
export function readGalleryDeps(ctx: Context): {
  sessions?: { list: () => Iterable<Record<string, any>> }
  persistence?: Record<string, any>
  logger?: { warn?: (msg: string) => void }
} {
  const get = (name: string): unknown => {
    try { return (ctx as unknown as { get?: (n: string) => unknown }).get?.(name) } catch { return undefined }
  }
  return {
    sessions: get('sessions') as { list: () => Iterable<Record<string, any>> } | undefined,
    persistence: get('sessionPersistence') as Record<string, any> | undefined,
    logger: (ctx as unknown as { logger?: { warn?: (msg: string) => void } }).logger,
  }
}

/**
 * 准入一个路径。
 *
 * @param ctx - 插件上下文。
 * @param raw - query 里的 path（绝对或相对）。
 * @param sessionId - query 里的 session。
 * @returns 准入过的绝对路径；不通过返回 null（调用方回 403）。
 */
export async function admitPreviewPath(ctx: Context, raw: string, sessionId: string): Promise<string | null> {
  if (raw === '') return null
  const absolute = isAbsolute(raw) ? resolve(raw) : null
  // 快路：绝对路径命中全局名单（画廊与产出物卡的主路）。
  if (absolute !== null && admitted !== null && admitted.has(previewPathKey(absolute))) return absolute
  // 没带 session 又没命中名单：没有第二条判据，拒绝。
  if (sessionId === '') return null
  let context: SessionContext
  try {
    context = await sessionContextFor(readGalleryDeps(ctx), sessionId)
  } catch {
    return null
  }
  // 顺带登记：这次会话折卷的结果对后续请求（与其他路由）同样有效。
  rememberOfficePaths(context.items.map((item) => item.path))
  /*
   * 会话工作区兜底（2026-10-06 补）：官方侧边栏的文档 tab 能打开**工作区内任意
   * 文件**（官方 workspaceFiles 的授权模型就是「会话工作区之内」），而不只是
   * 「本会话产出过的文件」。插件接管 pdf / office 预览后若只认产出名单，用户在
   * 文件树里点开一个没被对话产出过的 docx 就会 403 —— 比官方原来的表现更差。
   * 所以这里把授权面对齐官方：解析后的绝对路径落在该会话 cwd 之内即放行；
   * 越出工作区的一律拒绝（与官方 workspaceFiles 同口径）。
   */
  const cwdKey = context.cwd === null || context.cwd === '' ? '' : previewPathKey(context.cwd).replace(/\/+$/, '')
  const withinCwd = (target: string): boolean =>
    cwdKey !== '' && previewPathKey(target).replace(/\/+$/, '').startsWith(cwdKey + '/')
  if (absolute !== null) {
    if (context.items.some((item) => previewPathKey(item.path) === previewPathKey(absolute))) return absolute
    return withinCwd(absolute) ? absolute : null
  }
  // 相对路径：基准必须取**该会话自己的 cwd**（拿 host 进程 cwd 当基准会指到 DSH
  // 安装目录去），取不到就拒绝。
  if (context.cwd === null || context.cwd === '') return null
  const target = resolve(context.cwd, raw)
  if (context.items.some((item) => previewPathKey(item.path) === previewPathKey(target))) return target
  return withinCwd(target) ? target : null
}

/** 导出给冒烟对拍的内部面。 */
export const __test = { previewPathKey }
