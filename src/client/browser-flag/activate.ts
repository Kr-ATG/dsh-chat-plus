/**
 * dsh-chat-plus — 点浏览器标志时把那个窗口拉到前台（client 半身）。
 *
 * ## 它做什么
 *
 * 操作面板卡头那枚浏览器标志表达的是「这个会话正在操作浏览器」。用户的原话是
 * 「点击浏览器图标自动进入到ego那个工作空间」—— 他想从 DSH 一步跳回那个正在
 * 被操作的浏览器窗口，而不是自己去任务栏里翻。
 *
 * ## 为什么由 host 做
 *
 * 浏览器窗口是**独立桌面应用**（ego / Chrome），不是 DSH 的页面或会话 —— client
 * 侧没有任何官方 API 能切过去。host 侧已经有一个常驻 PowerShell 采集器（@ 运行中
 * 的程序在用），它本来就会 EnumWindows；加一条 ACTIVATE 命令顺带做窗口激活，
 * 不必再拉一个常驻进程。
 *
 * ## 失败姿态
 *
 * 任何失败（路由 404 / host 未装 / 找不到窗口 / 网络断）都只返回 false，
 * **绝不抛、绝不弹错**：这枚图标只是个便利入口，点一下没反应比弹一个
 * 「窗口激活失败」的错误好。
 *
 * @module
 */

/** 激活路由（与 host 半身 RUNNING_APPS_ACTIVATE_ROUTE 逐字一致）。 */
const ACTIVATE_ROUTE = '/api/chat-flow/activate-window'

/**
 * 请求把某个程序的窗口拉到前台。
 *
 * @param names - 候选进程名（不含 .exe，按序试，第一个成功的赢）。
 * @returns 是否成功激活了某个窗口。
 */
export async function activateBrowserWindow(names: readonly string[]): Promise<boolean> {
  const processes = names.map((name) => name.trim()).filter((name) => name !== '')
  if (processes.length === 0) return false
  if (typeof fetch !== 'function') return false
  try {
    const res = await fetch(ACTIVATE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      // 关掉 HTTP 缓存：这条是副作用操作，被缓存就变成"没点也跳"。
      cache: 'no-store',
      body: JSON.stringify({ processes }),
    })
    if (res === undefined || res === null || res.ok !== true) return false
    const payload = (await res.json()) as { ok?: unknown } | null
    return payload?.ok === true
  } catch {
    return false
  }
}

/** 路由常量（冒烟断言用）。 */
export const ACTIVATE_WINDOW_ROUTE = ACTIVATE_ROUTE
