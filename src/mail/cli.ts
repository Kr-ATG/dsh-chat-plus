/**
 * dsh-mail — agently-cli 进程封装（host 半身）。
 *
 * Agent Mail 没有公开的 HTTP API 给第三方直连：官方接入方式就是 CLI
 * （`@tencent-qqmail/agently-cli`，OAuth 凭据存 Windows DPAPI / macOS
 * Keychain）。所以本模块是**唯一**与邮箱交互的出口，上层（工具、路由、
 * 面板）一律走它，不各自拼命令。
 *
 * 四条硬约束（都是从实测踩出来的）：
 *
 *  1. **不要走 `.cmd` 垫片**：npm 全局装出来的是 `agently-cli.cmd`，它内部
 *     `execFileSync(exe, argv, { stdio: 'inherit' })` —— stdio 是继承的，
 *     我们用管道接不到 stdout。所以直接定位平台二进制（win32 是
 *     `.../@tencent-qqmail/agently-cli-win32-x64/bin/agently-cli.exe`），
 *     spawn 它、自己接管道。
 *  2. **JSON 在 stdout，tip 在 stderr**：成功时 stdout 是一整个 JSON
 *     envelope `{ok, data}`，人读提示（`tip: ...`）走 stderr。绝不能用
 *     `2>&1` 合并——提示行会插进 JSON 中间把它弄坏。失败时错误也是 stdout
 *     的 JSON（`{ok:false, error:{type,message,...}}`），exit code 另给语义。
 *  3. **附件与正文文件必须相对路径**：CLI 会硬拒绝对路径
 *     （`--file must be a relative path`），且相对的是**子进程 cwd**。
 *     所以调用方要先把 cwd 定在附件所在目录（见 withAttachmentCwd）。
 *  4. **正文格式要显式给**：`--body-format` 缺省时 CLI 会「自动检测
 *     Markdown」，而检测是**有门槛的**——正文只要含一点像 Markdown 的东西
 *     但结构不达标（如「这是一封自测邮件。」这种单句），它会直接报
 *     `markdown body does not contain recognizable Markdown structure` 并
 *     exit 1。发信是写操作，不能靠猜，故一律由调用方显式指定。
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** CLI 退出码语义（官方 skill 的错误处理表）。 */
export const EXIT_OK = 0
export const EXIT_SERVER = 1
export const EXIT_ARGS = 2
export const EXIT_AUTH = 3
export const EXIT_NETWORK = 4
export const EXIT_REJECTED = 6
export const EXIT_RATE_LIMIT = 7
export const EXIT_NEED_CONFIRM = 8

/** 一次 CLI 调用的结果（已解析）。 */
export interface CliResult<T = unknown> {
  ok: boolean
  /** envelope 的 data 段（失败时为 undefined）。 */
  data?: T
  /** 失败时的错误对象（type / message / code / request_id）。 */
  error?: { type?: string; message?: string; code?: number; request_id?: string }
  /** 进程退出码。 */
  code: number
  /** stderr 原文（人读提示，如 `tip: ...`）。 */
  tip: string
}

/** CLI 调用异常：把退出码语义翻译成人话，上层不必再认数字。 */
export class MailCliError extends Error {
  readonly code: number
  readonly type: string
  readonly requestId: string | undefined

  constructor(code: number, type: string, message: string, requestId?: string) {
    super(message)
    this.name = 'MailCliError'
    this.code = code
    this.type = type
    this.requestId = requestId
  }

  /** 授权失效（需要用户重新走 OAuth）。 */
  get needsAuth(): boolean {
    return this.code === EXIT_AUTH
  }

  /** 需要用户显式确认（两阶段确认的第二阶段还没走）。 */
  get needsConfirmation(): boolean {
    return this.code === EXIT_NEED_CONFIRM
  }
}

/* ── CLI 定位 ─────────────────────────────────────────────────────────── */

/** 平台二进制相对 npm 包根的路径。 */
function platformBinary(platform: NodeJS.Platform, arch: string): string[] {
  const suffix = platform === 'win32' ? '.exe' : ''
  const key = `${platform}-${arch}`
  const pkg = `@tencent-qqmail/agently-cli-${key}`
  return [
    join('node_modules', '@tencent-qqmail', 'agently-cli', 'node_modules', ...pkg.split('/'), 'bin', `agently-cli${suffix}`),
    join('node_modules', ...pkg.split('/'), 'bin', `agently-cli${suffix}`),
  ]
}

/**
 * 定位 CLI 可执行文件（绝对路径）。
 *
 * 顺序：显式环境变量 → npm 全局根（APPDATA/npm、/usr/local、/opt/homebrew、
 * ~/.npm-global 等常见前缀）→ PATH 上的 `agently-cli`。
 * 找到 `.exe`/无扩展名的原生二进制优先，`.cmd` 垫片只在实在没有原生二进制时
 * 兜底（那时会带 shell: true，stdio 仍能接住，只是多一层进程）。
 */
export function resolveCliPath(): { path: string; needsShell: boolean } | null {
  const fromEnv = process.env['AGENTLY_CLI_PATH']
  if (fromEnv !== undefined && fromEnv.trim() !== '' && existsSync(fromEnv.trim())) {
    return { path: fromEnv.trim(), needsShell: /\.(cmd|bat)$/i.test(fromEnv.trim()) }
  }
  const home = homedir()
  const prefixes = [
    process.env['APPDATA'] !== undefined ? join(process.env['APPDATA'], 'npm') : '',
    process.env['npm_config_prefix'] ?? '',
    process.env['NPM_CONFIG_PREFIX'] ?? '',
    join(home, '.npm-global'),
    join(home, 'AppData', 'Roaming', 'npm'),
    '/usr/local',
    '/usr',
    '/opt/homebrew',
    join(home, '.local'),
    join(home, '.bun'),
  ].filter(prefix => prefix !== '')

  for (const prefix of prefixes) {
    for (const rel of platformBinary(process.platform, process.arch)) {
      const candidate = join(prefix, rel)
      if (existsSync(candidate)) return { path: candidate, needsShell: false }
    }
  }
  // PATH 兜底：shell 解析（cmd 垫片/软链都吃得下）。
  return { path: process.platform === 'win32' ? 'agently-cli.cmd' : 'agently-cli', needsShell: true }
}

/* ── 单次调用 ─────────────────────────────────────────────────────────── */

/** 一次调用的选项。 */
export interface RunOptions {
  /** 子进程 cwd（附件/正文相对路径的基准；缺省取进程 cwd）。 */
  cwd?: string
  /** 超时（毫秒）；超时后杀进程并抛错。 */
  timeoutMs?: number
  /** 外部取消信号。 */
  signal?: AbortSignal
  /** 环境变量覆盖。 */
  env?: Record<string, string>
}

/** 从 stdout 里挑出 JSON envelope（容忍前置空行/提示行，取最后一个完整对象）。 */
function parseEnvelope(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim()
  if (text === '') return null
  try {
    const parsed = JSON.parse(text) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    /* 落下去按行找 */
  }
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
    } catch {
      /* 继续往上找 */
    }
  }
  return null
}

/**
 * CLI 英文报错 → 人话。
 *
 * Agent Mail 的错误文案全是英文服务端原文（`Message does not exist or is not
 * in trash` 这种），直接抛给用户等于没说清「我该怎么做」。这里按**原文特征**
 * 映射成人话，并保留原文附在后面 —— 翻译可能覆盖不全，原文永远是对的。
 *
 * 匹配用宽松的关键词而不是精确全等：服务端文案会随版本微调，全等匹配一次
 * 升级就全部失效，那还不如不翻。
 */
const ERROR_TRANSLATIONS: ReadonlyArray<{ match: RegExp; zh: (raw: string) => string }> = [
  {
    // 服务端按「邮件当前所在文件夹」判定能否删除：已经在回收站里的邮件不能再
    // 移入回收站（那一步要用 +delete 永久删除）。这条与下面的 not in trash
    // **方向相反**，绝不能合并：一个是「你要删的还在外面」，一个是「你要移的
    // 已经在里面」，给错的下一步提示等于把用户支到另一个错误上。
    match: /cannot delete message from this directory/i,
    zh: () => '这封邮件已经不在原文件夹里了（多半已进回收站）。请到左侧「回收站」打开它，用「永久删除」。',
  },
  {
    match: /not in trash|does not exist or is not in trash/i,
    zh: () => '这封邮件不在回收站里，无法永久删除。请先「移入回收站」，再在回收站里删除。',
  },
  {
    match: /resource not found|message not found|not found/i,
    zh: () => '找不到这封邮件（可能已被删除，或邮件 ID 已失效）。刷新列表看看。',
  },
  {
    // ⚠️ 别写成「过期了就要重新扫码」：access token 过期是**常态**，CLI 每次
    // 调用都走 GetValidAccessToken（内部 auto_refresh + refresh.lock），用
    // refresh token 自动续期，用户根本感知不到。只有 refresh token 本身也失效
    // （被撤销 / 长期未用 / 换了机器）才会真的走到这里 —— 那时才需要重新扫码。
    // 实测：`agently-cli auth refresh` 无需扫码即可续期（expires_at 前移）。
    match: /authorization required|unauthorized|not logged in|token expired|invalid token|invalid_grant/i,
    zh: () => '邮箱授权已失效（自动续期也没成功，通常是授权被撤销或长期未使用）。请在本机终端执行 agently-cli auth login，用微信扫码重新授权。',
  },
  {
    match: /rate limit|too many requests|quota exceeded|throttl/i,
    zh: () => '请求太频繁或已达额度上限（每天 50 封 / 每小时 200 次 / 每分钟 10 次）。等一会儿再试。',
  },
  {
    match: /attachment.*(too large|size)|exceeds.*size|file too large/i,
    zh: () => '附件太大。单个附件上限 20MB，单封邮件附件合计也上限 20MB。',
  },
  {
    match: /unsafe attachment path|must be a relative path/i,
    zh: () => '附件路径不合法（插件内部错误：路径必须是相对路径）。请把问题反馈给插件作者。',
  },
  {
    match: /markdown body does not contain/i,
    zh: () => '正文按 Markdown 发送但结构不达标。请改用纯文本格式（format: plain）。',
  },
  {
    match: /blacklist|unsubscribed|rejected|blocked/i,
    zh: () => '收件方拒收（已退订 / 拉黑 / 地址不存在）。换一个收件地址。',
  },
  {
    match: /network|timeout|connection|dial tcp|EOF/i,
    zh: () => '网络不通或请求超时。检查网络后重试。',
  },
]

/** 把 CLI 原始错误文案翻成人话（保留原文在括号里）。 */
export function humanizeCliError(raw: string): string {
  const text = raw.trim()
  if (text === '') return raw
  for (const rule of ERROR_TRANSLATIONS) {
    if (!rule.match.test(text)) continue
    const zh = rule.zh(text)
    // 已经含中文的（本地自己抛的）不再叠一层原文，避免重复。
    if (/[\u4e00-\u9fff]/.test(text)) return text
    return `${zh}（原文：${text}）`
  }
  return text
}

/** 把 CLI 的退出码 + envelope 翻译成 MailCliError（调用方按需 catch）。 */
function toError(result: CliResult): MailCliError {
  const type = result.error?.type ?? 'unknown'
  const raw = result.error?.message
  const message = typeof raw === 'string' && raw !== '' ? humanizeCliError(raw) : `agently-cli 退出码 ${result.code}`
  return new MailCliError(result.code, type, message, result.error?.request_id)
}

/**
 * 跑一次 CLI 并解析 envelope。**不抛错**——失败也返回 CliResult，
 * 让调用方自己决定（有些失败是流程的一部分，比如两阶段确认的第一步）。
 */
export function runCli(args: string[], options: RunOptions = {}): Promise<CliResult> {
  const cli = resolveCliPath()
  if (cli === null) {
    return Promise.resolve({
      ok: false,
      code: EXIT_ARGS,
      tip: '',
      error: { type: 'cli_missing', message: '找不到 agently-cli，请先执行 npm install -g @tencent-qqmail/agently-cli' },
    })
  }
  const timeoutMs = options.timeoutMs ?? 60_000
  return new Promise<CliResult>((resolvePromise) => {
    let settled = false
    const finish = (result: CliResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolvePromise(result)
    }
    const child = execFile(
      cli.path,
      args,
      {
        cwd: options.cwd ?? process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        shell: cli.needsShell,
        env: { ...process.env, ...options.env },
      },
      (error, stdout, stderr) => {
        const tip = typeof stderr === 'string' ? stderr.trim() : ''
        const envelope = parseEnvelope(typeof stdout === 'string' ? stdout : '')
        const rawCode = (error as { code?: unknown } | null)?.code
        const code = typeof rawCode === 'number'
          ? rawCode
          : error === null ? EXIT_OK : EXIT_SERVER
        if (envelope === null) {
          const timedOut = (error as { killed?: boolean } | null)?.killed === true
          finish({
            ok: false,
            code: timedOut ? EXIT_NETWORK : code,
            tip,
            error: {
              type: timedOut ? 'timeout' : 'cli_output',
              message: timedOut
                ? `agently-cli 超时（${timeoutMs}ms）：${args.join(' ')}`
                : (error?.message ?? 'agently-cli 未返回 JSON 输出'),
            },
          })
          return
        }
        const ok = envelope['ok'] === true
        const rawError = envelope['error']
        finish({
          ok,
          code,
          tip,
          ...(envelope['data'] !== undefined ? { data: envelope['data'] } : {}),
          ...(typeof rawError === 'object' && rawError !== null ? { error: rawError as CliResult['error'] } : {}),
        })
      },
    )
    const onAbort = (): void => { child.kill() }
    const timer = setTimeout(() => { child.kill() }, timeoutMs + 1_000)
    if (options.signal !== undefined) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/** 跑一次 CLI，失败即抛（读操作与「已确认」的写操作走它）。 */
export async function runCliOrThrow<T>(args: string[], options: RunOptions = {}): Promise<T> {
  const result = await runCli(args, options)
  if (!result.ok) throw toError(result)
  return result.data as T
}

/* ── 相对路径 cwd 规划 ────────────────────────────────────────────────── */

/**
 * 计算一组文件路径的公共父目录（用于把绝对路径变成 CLI 肯收的相对路径）。
 * 跨盘符（Windows）时返回 null——那时只能 staging 复制。
 */
export function commonDirOf(paths: readonly string[]): string | null {
  const abs = paths.filter(path => path !== '').map(path => resolve(path))
  if (abs.length === 0) return null
  const split = (path: string): string[] => resolve(path).split(sep)
  let common = split(dirname(abs[0]))
  for (const path of abs.slice(1)) {
    const parts = split(dirname(path))
    // Windows 盘符大小写可能不同，比较时统一小写。
    let i = 0
    while (i < common.length && i < parts.length
      && common[i].toLowerCase() === parts[i].toLowerCase()) i += 1
    common = common.slice(0, i)
    if (common.length === 0) return null
  }
  const joined = common.join(sep)
  if (joined === '') return null
  return joined.length <= 2 && joined.endsWith(':') ? `${joined}${sep}` : joined
}

/**
 * 把绝对路径换算成相对 cwd 的形式，并保证 CLI 认。
 * 相对路径统一用正斜杠（Windows 上反斜杠会被 CLI 当成转义）。
 */
export function toCliRelative(base: string, target: string): string {
  const rel = relative(base, resolve(target))
  return (rel === '' ? '.' : rel).split(sep).join('/')
}

/** 该路径是否本来就是「CLI 认可的相对路径」（非绝对、非盘符开头）。 */
export function isCliRelative(path: string): boolean {
  if (path.trim() === '') return false
  if (isAbsolute(path)) return false
  return !/^[a-zA-Z]:/.test(path)
}

/* ── 流式监听（新邮件提醒） ───────────────────────────────────────────── */

/** 新邮件事件（`message +watch --msg-format event` 的 NDJSON 行）。 */
export interface WatchEvent {
  dir?: string
  message_id?: string
  occurred_at?: string
}

/**
 * 起一个 `message +watch` 常驻进程，按行回调事件。
 * 返回停止函数（杀进程 + 清监听）。同一进程里只应存在一个（见 watch.ts）。
 */
export function startWatch(
  onEvent: (event: WatchEvent) => void,
  onExit: (code: number | null, stderr: string) => void,
): { stop: () => void; child: ChildProcess | null } {
  const cli = resolveCliPath()
  if (cli === null) {
    onExit(null, 'agently-cli not found')
    return { stop: () => {}, child: null }
  }
  const child = spawn(cli.path, ['message', '+watch', '--msg-format', 'event'], {
    cwd: process.cwd(),
    windowsHide: true,
    shell: cli.needsShell,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buffer = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.startsWith('{')) {
        try {
          const parsed = JSON.parse(line) as WatchEvent
          if (typeof parsed === 'object' && parsed !== null) onEvent(parsed)
        } catch {
          /* 半行/坏行忽略 */
        }
      }
      index = buffer.indexOf('\n')
    }
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000) })
  child.on('exit', (code) => { onExit(code, stderr.trim()) })
  child.on('error', () => { onExit(null, stderr.trim() || 'spawn failed') })
  return { stop: () => { try { child.kill() } catch { /* 已退出 */ } }, child }
}

/* ── 诊断 ─────────────────────────────────────────────────────────────── */

/** 探测 CLI 版本（`--version`，不读 envelope，直接读 stdout 文本）。 */
export async function probeCliVersion(): Promise<string | null> {
  const cli = resolveCliPath()
  if (cli === null) return null
  return new Promise<string | null>((resolvePromise) => {
    execFile(cli.path, ['--version'], { timeout: 15_000, windowsHide: true, shell: cli.needsShell }, (error, stdout) => {
      if (error !== null) { resolvePromise(null); return }
      const match = /(\d+\.\d+\.\d+)/.exec(String(stdout))
      resolvePromise(match?.[1] ?? null)
    })
  })
}
