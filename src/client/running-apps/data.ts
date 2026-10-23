/**
 * dsh-chat-plus — 「@ 运行中的程序」客户端半身：数据层。
 *
 * ## 这个功能是什么
 *
 * 用户打 @ 时，除了官方给的文件 / 会话候选，再给出一组**此刻真的开着的东西**：
 * 浏览器窗口、聊天窗口、编辑器、播放器……每行带进程图标 + 窗口标题 +
 * 右侧的进程名。选中后往草稿里插一枚引用芯片，模型收到的是一段结构化的
 * 上下文（见 serializeAppRef）。
 *
 * 用户的原话：「想要跟 CODEX 一样输入 @ 可以显示出来目前正在运行的程序，
 * 目的是为了网页标签页不需要输入网址或某一个程序想解决什么事情不需要输入
 * 程序名等等操作」。
 *
 * ## 为什么数据层独立成文件
 *
 * 这里全是**判据**，判错了不会报错，只会静默显示错的东西：
 *  · 过滤（该不该出现在候选里）；
 *  · 排序（前台的、匹配得好的在前）；
 *  · 副标题拼装（右侧那行灰字该写进程名还是路径）；
 *  · 序列化（模型收到什么）。
 * 所以全部导出成纯函数，冒烟可以直接对拍，不用起浏览器。
 *
 * @module
 */

import {
  RUNNING_APPS_ROUTE,
  type RunningAppsSnapshot,
  type RunningAppWindow,
} from '../../running-apps/types.ts'

export { RUNNING_APPS_ROUTE }
export type { RunningAppsSnapshot, RunningAppWindow }

/** 本功能在引用契约里的 source 名（与 onPick 的 insert.source 一致）。 */
export const RUNNING_APPS_SOURCE = 'running-apps'

/** 草稿里那枚芯片的显示前缀（clipboardText 也用它，用户看到的就是它）。 */
export const RUNNING_APPS_MENTION_PREFIX = '@app:'

/**
 * 拉一次路由。失败（网络 / 404 / 非 ok / 回包坏）一律返回 null ——
 * 调用方据此静默降级成「没有程序候选」，不影响文件/会话候选。
 */
export async function fetchRunningApps(
  fetchImpl?: typeof fetch,
  force = false,
): Promise<RunningAppWindow[] | null> {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
  if (doFetch === undefined) return null
  try {
    const url = force ? RUNNING_APPS_ROUTE + '?force=1' : RUNNING_APPS_ROUTE
    const res = await doFetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (res === undefined || res === null || res.ok !== true) return null
    return parseRunningApps(await res.json())
  } catch {
    return null
  }
}

/** 把路由回包解析成窗口数组。形状不对的条目直接丢弃，整体坏掉返回 null。 */
export function parseRunningApps(payload: unknown): RunningAppWindow[] | null {
  if (typeof payload !== 'object' || payload === null) return null
  const snapshot = payload as Partial<RunningAppsSnapshot>
  if (snapshot.ok !== true) return null
  if (!Array.isArray(snapshot.apps)) return null
  const out: RunningAppWindow[] = []
  for (const raw of snapshot.apps) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (title === '') continue
    out.push({
      pid: typeof item.pid === 'number' ? item.pid : 0,
      process: typeof item.process === 'string' ? item.process : '',
      title,
      exe: typeof item.exe === 'string' && item.exe !== '' ? item.exe : null,
      focused: item.focused === true,
      minimized: item.minimized === true,
      icon: typeof item.icon === 'string' && item.icon !== '' ? item.icon : null,
    })
  }
  return out
}

/**
 * 模糊匹配打分（不匹配返回 -1）。
 *
 * 口径刻意简单，但三条都是实测定过的：
 *  1. **标题优先于进程名**：用户看到的、能想起来的是标题，不是进程名；
 *  2. **前缀命中 > 子串命中**：打 ch 时 ChatGPT 该排在 Chrome 帮助 前面；
 *  3. **大小写不敏感、中文按原文子串**：中文没有大小写，也不需要分词。
 *
 * @param query - 查询串（内部会 trim + 转小写；空串表示不过滤）。
 * @param app - 候选窗口。
 * @returns 分数（越大越靠前），-1 表示不匹配。
 */
export function scoreApp(query: string, app: RunningAppWindow): number {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  const title = app.title.toLowerCase()
  const processName = app.process.toLowerCase()
  const titleIndex = title.indexOf(q)
  const processIndex = processName.indexOf(q)
  if (titleIndex < 0 && processIndex < 0) return -1
  let score = 0
  if (titleIndex === 0) score += 100
  else if (titleIndex > 0) score += 40
  if (processIndex === 0) score += 60
  else if (processIndex > 0) score += 20
  // 标题里命中永远比只在进程名里命中更相关。
  if (titleIndex >= 0) score += 10
  // 前台窗口加成：用户此刻正在看它。
  if (app.focused) score += 30
  return score
}

/**
 * 过滤 + 排序 + 截断，得到最终候选顺序。
 *
 * @param apps - 原始窗口列表。
 * @param query - 触发词之后的查询串（按整串匹配）。
 * @param limit - 最多返回几条（菜单高度有限）。
 */
export function rankApps(
  apps: readonly RunningAppWindow[],
  query: string,
  limit = 8,
): RunningAppWindow[] {
  const q = query.trim().toLowerCase()
  const scored: { app: RunningAppWindow; score: number; index: number }[] = []
  apps.forEach((app, index) => {
    const score = scoreApp(q, app)
    if (score < 0) return
    scored.push({ app, score, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map(entry => entry.app)
}

/**
 * 浏览器窗口标题的后缀（Chromium / Firefox 都会把浏览器名缀在标题末尾）。
 *
 * 为什么要剥：用户看到的应该是**页面标题**（Example Domain），不是
 * 「Example Domain - Google Chrome」。剥下来的浏览器名正好当右侧那行灰字用，
 * 于是这一行就有了 Edge 地址栏联想那种「标题 + 右侧元信息」的形状。
 */
const BROWSER_SUFFIXES: readonly { suffix: string; label: string }[] = [
  { suffix: ' - Google Chrome', label: 'Chrome' },
  { suffix: ' - Microsoft​ Edge', label: 'Edge' },
  { suffix: ' - Microsoft Edge', label: 'Edge' },
  { suffix: ' - Chromium', label: 'Chromium' },
  { suffix: ' — Mozilla Firefox', label: 'Firefox' },
  { suffix: ' - Mozilla Firefox', label: 'Firefox' },
  { suffix: ' - Brave', label: 'Brave' },
  { suffix: ' - Vivaldi', label: 'Vivaldi' },
  { suffix: ' - Opera', label: 'Opera' },
]

/**
 * 清洗窗口标题：剥掉浏览器名后缀。
 *
 * @param title - 原始窗口标题。
 * @returns 去掉后缀的标题与识别出的浏览器名（没有则为空串）。
 */
export function cleanWindowTitle(title: string): { title: string; browser: string } {
  const raw = title.trim()
  for (const entry of BROWSER_SUFFIXES) {
    if (raw.endsWith(entry.suffix)) {
      const stripped = raw.slice(0, raw.length - entry.suffix.length).trim()
      // 剥完什么都不剩就不剥（某些窗口标题就是「Google Chrome」本身）。
      if (stripped !== '') return { title: stripped, browser: entry.label }
    }
  }
  return { title: raw, browser: '' }
}

/**
 * 候选行右侧那行灰字。
 *
 * 口径：**进程名优先，进程名已出现在标题里时不重复显示**。
 * 例：标题「哔哩哔哩 - Google Chrome」+ 进程 chrome → chrome；
 *     标题「DeepSeek Harness」+ 进程 DeepSeek Harness → 空（重复无意义）。
 */
export function appSubtitle(app: RunningAppWindow): string {
  const { browser } = cleanWindowTitle(app.title)
  // ① 浏览器窗口：右侧写浏览器名（标题里的后缀已剥掉，这里补回来）。
  if (browser !== '') return browser
  // ② 没有进程名：直接写可执行文件名（比绝对路径短，也比空着有用）。
  if (app.process.trim() === '') {
    if (app.exe !== null) {
      const base = app.exe.split(/[\\/]/).pop() ?? ''
      if (base !== '') return base
    }
    return ''
  }
  // ③ 进程名还没在标题里出现过：写进程名。
  const processName = app.process.trim()
  if (processName !== '' && !app.title.toLowerCase().includes(processName.toLowerCase())) return processName
  // ④ 进程名重复：退回可执行文件名（比绝对路径短，比空着有用）。
  //    例：标题与进程名都是 DeepSeek Harness，右侧写 DeepSeek Harness.exe。
  if (app.exe !== null) {
    const base = app.exe.split(/[\\/]/).pop() ?? ''
    if (base !== '' && base.toLowerCase() !== (processName + '.exe').toLowerCase()) return base
    return base
  }
  // ⑤ 既没有可执行文件名也没有进程名：留空（这一行只剩标题）。
  return ''
}

/** 候选行的标题（窗口标题太长时截断）。 */
export function appLabel(app: RunningAppWindow, maxLength = 60): string {
  const title = cleanWindowTitle(app.title).title
  if (title.length <= maxLength) return title
  return title.slice(0, maxLength - 1) + '…'
}

/**
 * 引用 id：pid + 窗口标题。
 *
 * 为什么把标题也编进去：pid 单独不够——同一个 Chrome 进程可能开着多个窗口。
 * 把标题带进来，用户点了哪一条就是哪一条。
 */
export function appRef(app: RunningAppWindow): string {
  return app.pid + ':' + app.title
}

/** 从引用 id 反解出 PID 与标题（形状不对返回 null）。 */
export function parseAppRef(ref: string): { pid: number; title: string } | null {
  const idx = ref.indexOf(':')
  if (idx <= 0) return null
  const pid = Number(ref.slice(0, idx))
  if (!Number.isFinite(pid)) return null
  const title = ref.slice(idx + 1)
  if (title === '') return null
  return { pid, title }
}

/**
 * 模型收到的序列化形式。
 *
 * 为什么要序列化成一段可读文本而不是只丢个 id：模型没有本地进程表，
 * 它只能看见我们给它的东西。给足「程序名 + 窗口标题 + 可执行文件路径」，
 * 它才能判断「这是个浏览器」「这是播放器」，进而决定怎么帮用户。
 *
 * @param ref - {@link appRef} 产生的引用 id。
 * @param apps - 当前窗口列表（用来补全进程名与路径）。
 * @returns 一行结构化文本；找不到对应窗口时退化成裸引用。
 */
export function serializeAppRef(ref: string, apps: readonly RunningAppWindow[]): string {
  const parsed = parseAppRef(ref)
  if (parsed === null) return ref
  const app = apps.find(item => item.pid === parsed.pid && item.title === parsed.title)
  if (app === undefined) return '[运行中的程序] ' + parsed.title + ' (pid ' + parsed.pid + ')'
  const parts = [
    '程序：' + (app.process === '' ? '(未知)' : app.process),
    '窗口标题：' + app.title,
  ]
  if (app.exe !== null) parts.push('路径：' + app.exe)
  if (app.focused) parts.push('状态：当前前台窗口')
  else if (app.minimized) parts.push('状态：已最小化')
  return '[运行中的程序] ' + parts.join('；')
}

/** 导出给冒烟直接对拍（判据错了不会报错，只会静默排错序 / 显示错副标题）。 */
export const __test = {
  cleanWindowTitle,
  parseRunningApps,
  scoreApp,
  rankApps,
  appSubtitle,
  appLabel,
  appRef,
  parseAppRef,
  serializeAppRef,
}
