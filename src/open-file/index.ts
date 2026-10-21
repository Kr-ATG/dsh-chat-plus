/**
 * dsh-chat-plus — 「用默认浏览器 / 系统默认应用打开一个文件」（host 半身，2026-10-21）。
 *
 * ## 它修的是什么
 *
 * 产出物卡、画廊、弹窗里的「用默认应用打开」原来都走官方
 * remote.session.openWorkspacePath（细节见 client/open-default-app.ts 的长注释）。
 * 那条链有两个对产出物卡致命的前提，而它一个都不满足：
 *
 *  1. **路径必须能被 host 就地解析成绝对路径**。host 的 verifyDesktopPath
 *     用 resolve(path) —— 基准是 **host 进程的 cwd**（本机是
 *     D:\AI\Dsh\dsh-runtime），不是会话工作区（D:\AI\Dsh）。而产出物卡里
 *     present 交付的路径是**相对会话工作区**的（deliverables/x.html），
 *     于是被解析成 dsh-runtime\deliverables\x.html —— 文件根本不在那儿。
 *     实测（2026-10-21）：这条路径**照样通过官方校验**（verifyDesktopPath
 *     只核对「Host 文件系统能映射并原地解析回来」，不 stat 文件本体），
 *     explorer 收到一个不存在的 file URL **不报错**，而是弹出「文档」文件夹
 *     再以 exit 1 退出 —— 官方把 exit 1 当「已转交」，界面上一片安静。
 *     用户看到的就是「点产出物里的 html，什么都没发生（或莫名弹个文件夹）」。
 *
 *  2. **HTML 在 Windows 上不会被当作浏览器文档**。官方 path-opener 的
 *     openInBrowser 在 win32 分支直接 return false（它不愿读 UserChoice
 *     注册表），于是 .html 和 .txt 一样交给文件关联；association 意图更是
 *     **从设计上**跳过浏览器判定。用户的 .html 关联一旦被某个编辑器或某个
 *     不像浏览器的壳抢走，点开就不是浏览器。
 *
 * 本模块补的正是这两条：**先按会话工作区绝对化并 stat 文件本体**，再把浏览器
 * 文档（.html/.htm/.xhtml/.svg/.mht/.mhtml）**直接交给系统默认浏览器** ——
 * 默认浏览器从 UrlAssociations\https\UserChoice 读，那是 Windows 自己记录
 * 「谁是默认浏览器」的唯一权威位置（FileExts\.html\UserChoice 作为次选兜底）。
 *
 * ## 为什么不改宿主里的官方实现
 *
 * 改 node_modules 会在引擎升级时被覆盖，且本项目铁律是只通过插件扩展。
 *
 * ## 安全边界
 *
 * 这条路由等价于「让本机打开一个存在的文件」，比 /open-path（只认目录）更宽，
 * 所以三道闸门缺一不可：
 *  1. rejectCrossSite —— 任意网页一个 CORS 简单请求不能盲调；
 *  2. 必须是**已存在的普通文件**（目录、断链、不存在的路径一律拒绝）；
 *  3. **可执行类扩展名整类拒绝**（.exe/.bat/.ps1/.lnk …）：这条路由是
 *     「打开给用户看」，不是「执行任意程序」的入口。
 *
 * 约束（与 build.mjs 的 assertHostExternals 一致）：零 @deepseek-ai 运行时导入。
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rejectCrossSite } from '../shared/csrf.ts'

/** 本插件路由前缀（与既有 /api/chat-flow/* 家族一致）。 */
const ROUTE_PATH = '/api/chat-flow/open-file'

/** 请求体上限：绝对路径 + 可选的会话工作区，4 KiB 足够。 */
const MAX_BODY_BYTES = 4096

/** 浏览器能渲染的文档：这些交给默认浏览器，而不是「文件关联」。 */
const BROWSER_DOCUMENTS = new Set(['.html', '.htm', '.xhtml', '.svg', '.mht', '.mhtml'])

/**
 * 拒绝打开的扩展名：双击它们等于**执行**。
 *
 * 产出物卡本来就只列成品（源码类整类不进卡），所以这份名单不会误伤正常使用；
 * 它挡的是「拿这条路由当任意程序启动器」的用法。
 */
const EXECUTABLE_EXT = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.msi', '.msp', '.scr', '.cpl', '.hta', '.pif', '.scf', '.msc',
  '.reg', '.jar', '.dll', '.ocx', '.sys', '.lnk',
])

function json(res: any, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 读请求体；超过上限直接掐断并返回 null。 */
function readBody(req: any): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        req.resume()
        resolvePromise(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolvePromise(Buffer.concat(chunks, size).toString('utf8')) })
    req.on('error', () => { resolvePromise(null) })
  })
}

/**
 * 把一个 Windows 路径编码成 Explorer 能整块收到的目标。
 *
 * 逐字来自官方 dsh-native-command/path-opener 的 explorerTarget（照抄而不是
 * 引包，是因为 host 产物不允许 @deepseek-ai 运行时导入，见 build.mjs）：
 * Explorer 自己解析命令行，逗号与等号会被当字段分隔符，导致它**静默打开别的东西**；
 * 而 percent-encoded 的非 ASCII 会让它退回「文档」文件夹，所以非 ASCII 的转义
 * 要还原成字面字符，只有 ASCII 转义保留。
 * @param target - 已经过 stat 的绝对路径。
 * @returns 交给 explorer.exe 的单个 argv。
 */
function explorerTarget(target: string): string {
  const href = pathToFileURL(target, { windows: true }).href
  return href
    .replace(/(?:%[89A-F][0-9A-F])+/gi, (escaped) => decodeURIComponent(escaped))
    .replaceAll(',', '%2C')
    .replaceAll('=', '%3D')
}

/**
 * 真正拉起进程的动作。
 *
 * 这是**唯一的副作用出口**，被抽成变量是为了让冒烟能把它换成本地记录器 ——
 * 否则断言「点了 html 会用浏览器打开」就得真的在弹出的浏览器窗口里验证，
 * 那是无法自动化的。生产路径上它恒等于 launchDetached。
 */
let launchDetachedImpl: (command: string, args: readonly string[]) => Promise<void> = launchDetached

/** 启动一个 detached 进程，只等「已 spawn」这一件事（不等它退出）。 */
function launchDetached(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: 'ignore',
      // 浏览器/资源管理器要自己的窗口，不能被吞（官方 runNativeCommand 的
      // windowsHide: true 正是「在文件管理器中打开」当时点了没反应的原因）。
      windowsHide: false,
    })
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
    child.once('error', (error) => { rejectPromise(error) })
  })
}

/**
 * 解 reg.exe 的输出。
 *
 * 中文 Windows 的 reg 输出是 GBK，而 chcp 65001 下是 UTF-8。判定办法是
 * 「UTF-8 严格解码能不能过」：纯 ASCII 两种解码结果一样，含中文时只有正确的那一个
 * 不会抛。
 * @param buffer - reg.exe 的原始 stdout。
 * @returns 文本。
 */
function decodeRegOutput(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer)
    } catch {
      return buffer.toString('latin1')
    }
  }
}

/**
 * 查一个注册表值。
 * @param key - 完整键路径（HKCU\... / HKCR\...）。
 * @param valueName - 值名；省略表示查默认值（/ve）。
 * @returns 字符串值，或 null（键/值不存在、reg 不可用、超时）。
 */
function regQuery(key: string, valueName?: string): Promise<string | null> {
  const args = ['query', key, ...(valueName === undefined ? ['/ve'] : ['/v', valueName])]
  return new Promise((resolvePromise) => {
    execFile('reg.exe', args, { encoding: 'buffer', windowsHide: true, timeout: 4000 }, (error, stdout) => {
      if (error || stdout === undefined || stdout === null) {
        resolvePromise(null)
        return
      }
      const text = decodeRegOutput(Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout)))
      const match = /REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/m.exec(text)
      resolvePromise(match === null ? null : match[1].trim())
    })
  })
}

/**
 * 把一条 shell open 命令拆成「可执行文件 + 参数」。
 *
 * 只处理注册表里实际出现的两种形态：带引号的 exe（"C:\Program Files\a\b.exe" --x %1）
 * 与不带引号的裸路径。参数按空白切 —— 浏览器/壳的 open 命令没有引号内空格的形式。
 * @param command - 注册表里的命令模板。
 * @returns 拆分结果，或 null（空/无法解析）。
 */
function parseCommand(command: string): { exe: string; args: string[] } | null {
  const text = command.trim()
  if (text === '') return null
  let exe: string
  let rest: string
  if (text.startsWith('"')) {
    const close = text.indexOf('"', 1)
    if (close <= 1) return null
    exe = text.slice(1, close)
    rest = text.slice(close + 1)
  } else {
    const space = text.indexOf(' ')
    exe = space === -1 ? text : text.slice(0, space)
    rest = space === -1 ? '' : text.slice(space + 1)
  }
  if (exe === '') return null
  const trimmed = rest.trim()
  return { exe, args: trimmed === '' ? [] : trimmed.split(/\s+/) }
}

/** 默认浏览器的解析结果缓存（改默认浏览器后最多 5 分钟内跟上）。 */
const BROWSER_TTL_MS = 5 * 60_000
let browserCache: { at: number; launch: { exe: string; args: string[] } | null } | null = null

/**
 * 取系统默认浏览器的启动命令（仅 Windows 有意义）。
 *
 * 判据顺序就是 Windows 自己的记录层级：https 的 UserChoice（浏览器就是这个）
 * → http 的 UserChoice → .html 的 UserChoice → HKCR\.html 的默认值。
 * 每一条都要求最终解析出的 exe **真实存在**，否则继续往下试 —— 注册表里留着一个
 * 已卸载程序的 ProgId 是常见状态。
 * @returns 启动命令，或 null。
 */
async function defaultBrowserLaunch(): Promise<{ exe: string; args: string[] } | null> {
  if (process.platform !== 'win32') return null
  const now = Date.now()
  if (browserCache !== null && now - browserCache.at < BROWSER_TTL_MS) return browserCache.launch

  const userChoice = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations'
  const progIds = [
    await regQuery(userChoice + '\\https\\UserChoice', 'ProgId'),
    await regQuery(userChoice + '\\http\\UserChoice', 'ProgId'),
    await regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.html\\UserChoice', 'ProgId'),
    await regQuery('HKCR\\.html'),
  ]

  let launch: { exe: string; args: string[] } | null = null
  for (const progId of progIds) {
    if (progId === null || progId === '') continue
    const command = await regQuery('HKCR\\' + progId + '\\shell\\open\\command')
    if (command === null) continue
    const parsed = parseCommand(command)
    if (parsed === null) continue
    if (!existsSync(parsed.exe)) continue
    launch = parsed
    break
  }
  // 解析失败不缓存：那多半是注册表暂时读不到，下次点击该重新试。
  browserCache = launch === null ? null : { at: now, launch }
  return launch
}

/**
 * 用默认浏览器打开一个浏览器文档。
 * @param target - 已 stat 过的绝对路径。
 * @returns opened 表示浏览器进程已拉起；unavailable 表示这台机器没解析出浏览器。
 */
async function openInDefaultBrowser(target: string): Promise<'opened' | 'unavailable'> {
  if (process.platform !== 'win32') {
    // macOS / Linux 的 open / xdg-open 本身就是「默认浏览器」语义，不必自己挑。
    const [command, args] = process.platform === 'darwin'
      ? ['open', [target]] as const
      : ['xdg-open', [target]] as const
    await launchDetachedImpl(command, [...args])
    return 'opened'
  }

  const launch = await defaultBrowserLaunch()
  if (launch === null) return 'unavailable'

  const url = pathToFileURL(target).href
  let replaced = false
  const args = launch.args.map((arg) => {
    if (arg === '%1' || arg === '%L' || arg === '%l') {
      replaced = true
      return url
    }
    return arg
  })
  // 命令模板里没有占位符时，URL 作为末尾参数追加（Chrome / Edge / Firefox
  // 与 Electron 壳的 open 命令都接受这种形态）。
  if (!replaced) args.push(url)
  await launchDetachedImpl(launch.exe, args)
  return 'opened'
}

/**
 * 用文件类型关联打开（= 双击语义），Windows 交给 Explorer。
 * @param target - 已 stat 过的绝对路径。
 */
async function openWithAssociation(target: string): Promise<void> {
  if (process.platform === 'win32') {
    await launchDetachedImpl('explorer.exe', [explorerTarget(target)])
    return
  }
  const [command, args] = process.platform === 'darwin'
    ? ['open', [target]] as const
    : ['xdg-open', [target]] as const
  await launchDetachedImpl(command, [...args])
}

/**
 * 取 connection 服务（认证用）。
 *
 * cordis 的 ctx 是 Proxy：未在 inject 里声明的属性**一读就抛**
 * cannot get property "connection" without inject。本模块由只注入了
 * webServer 的子上下文调用，所以必须走 Reflect + try/catch 静默降级
 * （官方 open-in-app 与本插件的 open-path 用的是同一手法）。
 */
function connectionOf(ctx: Record<string, any>): any {
  try {
    return Reflect.get(ctx, 'connection')
  } catch {
    return undefined
  }
}

/** 一次「打开」请求的解析结果。 */
type Resolved =
  | { readonly kind: 'ok'; readonly target: string }
  | { readonly kind: 'bad'; readonly reason: string }

/**
 * 把请求里的路径解析成「已确认存在的绝对路径」。
 *
 * 相对路径**只按请求带上来的会话工作区**解析 —— 绝不退回 host 进程的 cwd，
 * 那正是本次修复要干掉的那个 bug（host cwd 是 dsh-runtime，不是会话工作区）。
 * @param rawPath - 请求里的 path。
 * @param rawCwd - 请求里的会话工作区（可选）。
 * @returns 解析结果。
 */
function resolveTarget(rawPath: unknown, rawCwd: unknown): Resolved {
  const path = typeof rawPath === 'string' ? rawPath.trim() : ''
  if (path === '') return { kind: 'bad', reason: 'empty path' }

  let absolute = path
  if (!isAbsolute(absolute)) {
    const cwd = typeof rawCwd === 'string' ? rawCwd.trim() : ''
    if (cwd === '' || !isAbsolute(cwd)) {
      // 相对路径却没有可信基准：宁可失败，也不能猜（猜错就会打开不相干的东西）。
      return { kind: 'bad', reason: 'relative path without session workspace' }
    }
    absolute = resolve(cwd, absolute)
  }

  /*
   * 归一化：客户端拼出来的路径常是「D:\AI\Dsh/deliverables/x.html」这种混用分隔符的
   * 形态（会话 cwd 是反斜杠、产出物条目里的相对路径是正斜杠，见 open-preview.ts 的
   * resolveWorkspacePath）。Windows 认这种路径，但 stat 与 file URL 都以干净形态为佳，
   * 也让回给客户端的 path 与磁盘上的真实写法一致。
   */
  absolute = resolve(absolute)

  const ext = extname(absolute).toLowerCase()
  if (EXECUTABLE_EXT.has(ext)) return { kind: 'bad', reason: 'refusing to open executable type ' + ext }

  try {
    if (!statSync(absolute).isFile()) return { kind: 'bad', reason: 'not a regular file' }
  } catch {
    return { kind: 'bad', reason: 'file not found' }
  }
  return { kind: 'ok', target: absolute }
}

/**
 * 注册「用默认浏览器 / 默认应用打开文件」路由（在已注入 webServer 的子上下文中调用）：
 *   POST /api/chat-flow/open-file  { "path": "...", "cwd": "..." } → { ok, via, path }
 * @param webCtx - webServer 已就绪的插件上下文。
 */
export function applyOpenFileRoutes(webCtx: Record<string, any>): void {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req: any, res: any): Promise<void> => {
      try {
        // 跨站闸门必须在最前面：这条路由会让本机真的打开文件。
        if (rejectCrossSite(req.headers as Record<string, unknown>, (status, payload) => {
          json(res, status, payload)
        })) return
        // 认证：与官方 open-in-app 同一道 connection 信任栅栏（服务缺失时不做判断）。
        const connection = connectionOf(webCtx)
        if (connection && typeof connection.requestRejection === 'function') {
          const rejection = connection.requestRejection(req)
          if (rejection !== undefined) {
            json(res, rejection, { ok: false, error: 'unauthorized' })
            return
          }
        }
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const text = await readBody(req)
        if (text === null) {
          json(res, 413, { ok: false, error: 'payload too large' })
          return
        }
        let parsed: any
        try {
          parsed = JSON.parse(text)
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' })
          return
        }

        const resolvedTarget = resolveTarget(parsed?.path, parsed?.cwd)
        if (resolvedTarget.kind === 'bad') {
          json(res, 400, { ok: false, error: resolvedTarget.reason })
          return
        }
        const target = resolvedTarget.target

        /*
         * 浏览器文档优先交给默认浏览器；解析不出浏览器时退回文件关联 ——
         * 「用关联打开的，也是浏览器」这种情况（.html 关联本身就是浏览器）
         * 因此不会退化成「什么都没发生」。
         */
        if (BROWSER_DOCUMENTS.has(extname(target).toLowerCase())) {
          const viaBrowser = await openInDefaultBrowser(target)
          if (viaBrowser === 'opened') {
            json(res, 200, { ok: true, via: 'browser', path: target })
            return
          }
        }
        await openWithAssociation(target)
        json(res, 200, { ok: true, via: 'association', path: target })
      } catch {
        json(res, 500, { ok: false, error: 'internal error' })
      }
    },
  }), 'dsh-chat-plus: open-file route')
}

/* ── 测试面（导出给 scripts/smoke-host.mjs）──────────────────────────── */

/**
 * 供冒烟替换「拉起进程」这一副作用，并直接调用纯判定函数。
 *
 * 生产路径不会用到任何一项；它们存在的唯一理由是：这几条判据（相对路径的解析
 * 基准 / 可执行类型拒绝 / 浏览器命令解析 / 浏览器文档分派）判错了**都不会抛错**，
 * 只会表现为「点了没反应」或「打开了不相干的东西」，必须能离线断言。
 */
export const __test = {
  /**
   * 换掉真的进程启动器。
   * @param next - 记录器；传 undefined 恢复真实实现。
   */
  setLauncher(next: ((command: string, args: readonly string[]) => Promise<void>) | undefined): void {
    launchDetachedImpl = next ?? launchDetached
  },
  resolveTarget,
  parseCommand,
  explorerTarget,
  defaultBrowserLaunch,
  BROWSER_DOCUMENTS,
  EXECUTABLE_EXT,
  /** 清空默认浏览器缓存（改注册表后立即重读）。 */
  resetBrowserCache(): void { browserCache = null },
}
