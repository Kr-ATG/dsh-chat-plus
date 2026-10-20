/**
 * dsh-chat-plus — 「用系统默认应用打开」（client 半身，2026-10-20）。
 *
 * ## 为什么走官方 Remote，而不是自建一条 host 路由
 *
 * 「双击一个文件」在 Windows 上等于把路径交给 Explorer，由 shell 按扩展名
 * 关联决定用哪个程序 —— 这正是官方 `open-in-app` 的 `shell-open` 语义：
 *
 *   · 客户端 `OpenInAppPathController.openPath(path, 'open')`
 *     → `remote.session.openWorkspacePath({ path })`（不带 action / application）
 *     → host `openNativeAssociatedPath` → `openWindowsPath`
 *     → `runExplorer([fileURL])`，注释写得很直白：
 *       「the shell that owns the default-application resolution a double-click uses」。
 *
 * 这条链有三个别人给不了的东西，所以不自建：
 *   1. **它本来就有**。自建一条同义路由等于把「打开本机任意文件」这个能力
 *      再开一个口子 —— 本插件已经有 `/api/chat-flow/open-path`（只认目录）
 *      与两条只读路由，能少一条就少一条；
 *   2. **窗口不会被吞**。`runExplorer` 传给 runner 的是 `'visible'`，
 *      与文件管理器那条（被 `windowsHide` 吞掉窗口）不是同一条路径，无需修复；
 *   3. **路径有官方校验**。host 的 `verifyDesktopPath` 要求路径能经 Host
 *      文件系统映射并原地解析回来，插件不必自己再判一遍。
 *
 * 我们这边只做三件事：**找服务、判可用、把失败收敛成枚举**（绝不抛）。
 *
 * ## 为什么失败要分三态
 *
 * `unavailable` 与 `failed` 的处置完全不同：
 *   · `unavailable`（手机远程访问、宿主没有桌面、服务没装）—— 调用方应**原样
 *     退回**自己的内置预览，这是环境限制不是错误；
 *   · `failed`（路径被官方校验拒了 / 文件不在了）—— 同样退回内置预览，
 *     但那多半意味着路径本身有问题，调用方可以顺带把它从清单里剔掉。
 * 把两者合成一个 boolean，调用方就没法区分「这台机器开不了」和「这个文件开不了」。
 */

import { getService } from './client-ctx.ts'

/** 官方 Remote 的返回信封（只关心 ok 与 value）。 */
interface RemoteReply<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly code?: string; readonly message?: string } | null
}

/** `remote.session` 的最小面（只用到默认应用打开与可用性判断）。 */
interface SessionRemoteLike {
  canOpenWorkspacePath?: (signal?: AbortSignal) => Promise<RemoteReply<boolean>>
  openWorkspacePath?: (
    request: { readonly path: string; readonly action?: 'reveal'; readonly application?: string },
    signal?: AbortSignal,
  ) => Promise<RemoteReply<unknown>>
}

/**
 * 取官方 `remote.session` 命名空间。
 *
 * 两条路都要试（与 open-preview.ts 的 `workspaceFilesService` 同款）：Gateway 把
 * 每个 Remote 命名空间注册成独立 Service（键名 `remote.<namespace>`），而根
 * `remote` 服务也可能挂着同名命名空间属性 —— 只认其中一条，宿主版本一变就整个失效。
 *
 * ⚠ 每条路单独 try/catch：cordis 的 ctx 是 Proxy，读一个未在 inject 白名单里
 * 声明的属性会直接抛 `cannot get property "x" without inject`。本模块拿到的是
 * 根 ctx，不参与插件 inject，但服务本身也可能不存在 —— 读不到就当没有。
 *
 * @returns 命名空间，或 undefined。
 */
function sessionRemote(): SessionRemoteLike | undefined {
  for (const name of ['remote.session', 'remote']) {
    let candidate: Record<string, unknown> | undefined
    try {
      candidate = getService<Record<string, unknown>>(name)
    } catch {
      continue
    }
    if (candidate === undefined || candidate === null) continue
    try {
      if (typeof candidate.openWorkspacePath === 'function') return candidate as unknown as SessionRemoteLike
      const nested = candidate.session
      if (typeof nested === 'object' && nested !== null
        && typeof (nested as SessionRemoteLike).openWorkspacePath === 'function') {
        return nested as SessionRemoteLike
      }
    } catch {
      // 未 inject 的属性读了就抛：这条跳过，试下一条。
      continue
    }
  }
  return undefined
}

/**
 * 桌面可用性缓存。
 *
 * 一个页面生命周期里问一次就够（官方 `OpenInAppPathController.load()` 也是这个
 * 口径）；但它**不是永久结论** —— 服务暂时没就绪时读到 false 会让整页都开不了，
 * 所以只有「明确回答」才缓存，抛错/无服务的结论留空以便下次重试。
 */
let availability: Promise<boolean> | null = null

/** 清掉可用性缓存（冒烟与调试用；正常路径不需要手动调）。 */
export function resetDesktopAvailability(): void {
  availability = null
}

/**
 * 这台宿主此刻能不能用桌面默认应用打开文件。
 *
 * @returns true / false；读不到结论时按 false 处理（调用方退回内置预览）。
 */
export function desktopOpeningAvailable(): Promise<boolean> {
  if (availability !== null) return availability
  const remote = sessionRemote()
  if (remote === undefined || typeof remote.canOpenWorkspacePath !== 'function') {
    // 服务不在：这不是「暂时不知道」，是确定没有 —— 缓存 false 免得每次点击都查。
    availability = Promise.resolve(false)
    return availability
  }
  const pending = (async (): Promise<boolean> => {
    try {
      const reply = await remote.canOpenWorkspacePath!()
      if (reply?.ok === true) return reply.value === true
    } catch {
      // 读失败：不缓存结论，交给下一次重试。
    }
    availability = null
    return false
  })()
  availability = pending
  return pending
}

/**
 * 一次「用默认应用打开」的结论。
 *
 *  · `opened` —— 宿主已接收（外部程序是否真的弹出来不在我们可观测范围内，
 *    与官方 open-in-app 的判定口径一致）；
 *  · `unavailable` —— 这台宿主没有桌面（手机远程、纯服务端部署），调用方应
 *    **原样退回**内置预览；
 *  · `failed` —— 有桌面但这次调用被拒（路径映射不过 / 服务抛错）。
 *
 * ⚠ **`failed` 不等于「文件不存在」**（2026-10-20 实测）：host 的
 * `verifyDesktopPath` 只校验「路径能经 Host 文件系统映射并原地解析回来」，
 * 不 stat 文件本体；Windows 的 Explorer 收到一个不存在的 file URL 也只是把
 * 请求委托给桌面进程后以 exit 1 退出，而官方把 exit 1 当成功。实测一个不存在的
 * 路径同样返回 `ok: true`。所以调用方**不能**用 `failed` 判定文件失效，更不该
 * 据此把条目从清单里剔掉 —— 它的真实含义只是「这一跳没能交给系统」。
 */
export type DefaultAppResult = 'opened' | 'unavailable' | 'failed'

/**
 * 用系统默认应用打开一个**宿主上的绝对路径**。
 *
 * 不做路径合法性预判（那是官方 host 的活）—— 只把结果收敛成三态，永不抛。
 *
 * @param path - 宿主文件系统路径（绝对路径最稳；相对路径由 host 按会话工作区解析）。
 * @returns 三态结论。
 */
export async function openWithDefaultApp(path: string): Promise<DefaultAppResult> {
  const target = typeof path === 'string' ? path.trim() : ''
  if (target === '') return 'failed'
  const remote = sessionRemote()
  if (remote === undefined || typeof remote.openWorkspacePath !== 'function') return 'unavailable'
  if (!(await desktopOpeningAvailable())) return 'unavailable'
  try {
    // 不传 action / application：官方契约里「都省略」才是默认应用。
    const reply = await remote.openWorkspacePath({ path: target })
    return reply?.ok === true ? 'opened' : 'failed'
  } catch {
    return 'failed'
  }
}
