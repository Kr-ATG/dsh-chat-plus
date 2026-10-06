/**
 * dsh-chat-plus — Office 预览：LibreOffice 工作目录（scratch）解析（host 半身）。
 *
 * ## 为什么需要这个模块（2026-10-06 实测定位的真根因）
 *
 * 本机 `@deepseek-ai/dsh-office-to-pdf`（官方 provider，侧边栏 PPT / Word 预览
 * 走的就是它）**每一步都在转换阶段失败**：
 *
 *   LibreOffice native conversion failed:
 *   SfxBaseModel::impl_store <...> failed: 0x507(Io Class:Access Code:7)
 *                                  / 0xc10(Io Class:Write Code:16)
 *
 * 起初看着像「引擎装坏了」——但逐项排除后，真实判据是**输出/临时目录所在位置**：
 * 同一个 pptx、同一个 helper、同一份环境变量，只有把 `TEMP` 指向
 * `D:\AI\Dsh`（当前 workspace）之下时才成功，指到 `C:\...\Temp`、
 * `D:\` 根或 `D:\AI\DeepseekHarness` 一律失败。对比 ACL 即可看出差别：
 *
 *   D:\AI\Dsh   → 含 `S-1-4-697522640-...:(OI)(CI)(W,D,DC)`（沙箱给 workspace
 *                 授的 AppContainer 写权限），子目录 OI/CI 继承 → LibreOffice
 *                 能写；
 *   其余目录    → 无该 ACE → LibreOffice 核心拿不到写权限。
 *
 * 而 `libreoffice-kit` 的 scratch 来自 `mkdtemp(join(tmpdir(), ...))`，
 * Windows 上 Node 的 `os.tmpdir()` 直接读 `process.env.TEMP`。于是链路是：
 *
 *   TEMP 落在「没有沙箱写 ACE」的目录 → kit 的 scratch / profile 也在那里
 *   → LibreOffice 存盘被拒 → 官方 provider 报「转换失败」
 *   → 侧边栏对 ppt / doc / docx 永远显示「无法预览此 Office 文件」。
 *
 * ## 修法
 *
 * 把 `process.env.TEMP` 指向一个**确实带了该 ACE 的目录**。必须是进程级
 * （而不是只在自家转换里临时改）：官方 provider 与我们在同一个宿主进程里，
 * 它读的是同一个 `process.env.TEMP` —— 只改自己的作用域修不了侧边栏。
 *
 * 三个克制点：
 *  1. **只在原 TEMP 不可用时才动**：若 `os.tmpdir()` 本身已经有该 ACE，原样
 *     不动（多数环境如此，本模块等于 no-op）。
 *  2. **判据来自实测**：用 `icacls` 读该目录的 ACE 里有没有 `S-1-4-*` 的写权限，
 *     而不是猜「C 盘不行 / D 盘行」。实测过 `D:\` 根同样不行。
 *  3. **候选按就近到远**：DSH 服务启动目录 → 活跃会话工作区 → DSH_HOME →
 *     系统 temp。选中结果落盘缓存，后续启动不再重复探测。
 *
 * 判定不出来（非 Windows / 没有 icacls / 全部候选都不合格）时**原样不改**：
 * 让行为退回到插件引入本模块之前的样子，绝不把环境改得更糟。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/**
 * 工作目录名（放在候选根之下）。
 *
 * 刻意放 `_tmp/` 里而不是工作区根：那是本插件（以及 DSH 清理器）约定的临时产物
 * 目录，scratch 被清理掉没有损失 —— 下次转换前会原地重建。工作区根多出一个
 * 点开头的目录则会被 git status 和文件树看见，属于噪声。
 */
const SCRATCH_DIR_NAME = join('_tmp', '.dsh-office-scratch')

/** 缓存文件：选定的工作目录（避免每次启动都跑 icacls）。 */
function cacheFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-office-scratch.json')
}

/** `icacls` 在哪。 */
const ICACLS = 'icacls.exe'

/**
 * 目录是否带沙箱写权限（ACE 里含 `S-1-4-*` 且权限位含写）。
 *
 * 为什么用 ACE 而不是「试着写一个文件」：`probe-write` 实测过 —— 用 node 往
 * `C:\` / `D:\` 写文件**全都成功**（宿主自己的令牌权限足够），失败只发生在
 * LibreOffice 核心那种受限执行体上。所以「能不能写」不能作为判据，ACE 才是。
 *
 * @param dir - 待检目录（必须已存在）。
 * @returns 是否含沙箱写 ACE。
 */
export function hasSandboxWriteAce(dir: string): boolean {
  if (process.platform !== 'win32') return true
  let out = ''
  try {
    const result = spawnSync(ICACLS, [dir], { windowsHide: true, encoding: 'utf8', timeout: 8000 })
    out = `${result.stdout ?? ''}${result.stderr ?? ''}`
  } catch {
    return false
  }
  if (out === '') return false
  return parseAceLines(out)
}

/** 已经选定的工作目录（进程内缓存）。 */
let chosen: string | null = null
/** 是否已经探测过。 */
let probed = false
/** 已解析的 sessions 服务面（refresh 时复用）。 */
let sessionsRef: SessionsLike | undefined

/** 会话列表的最小面（只读 header.cwd）。 */
interface SessionsLike {
  list?: () => Iterable<Record<string, any>>
}

/**
 * 候选工作目录（就近到远、去重）。
 *
 * @param sessions - 可选的 sessions 服务面；给出时把活跃会话工作区也算进候选
 *   —— workspace 是会变的（用户换工作区后沙箱会在新 workspace 上重新授权），
 *   跟着会话走比只认进程 cwd 更能自愈。
 * @returns 绝对路径候选列表。
 */
function candidates(sessions?: SessionsLike): readonly string[] {
  const roots: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string' || value === '' || !isAbsolute(value)) return
    if (!roots.includes(value)) roots.push(value)
  }
  push(process.cwd())
  if (sessions !== undefined && typeof sessions.list === 'function') {
    try {
      for (const session of sessions.list()) {
        push(session?.header?.cwd)
        if (roots.length >= 6) break
      }
    } catch { /* 服务面异常：跳过这一档候选 */ }
  }
  push(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages'))
  push(tmpdir())
  return roots.map((root) => join(root, SCRATCH_DIR_NAME))
}

/** 读缓存里的选定目录（存在且合格才用）。 */
function readCached(dir: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(cacheFile(), 'utf8')) as { scratch?: unknown }
    if (typeof raw.scratch !== 'string' || raw.scratch !== dir) return false
    return existsSync(dir)
  } catch {
    return false
  }
}

/** 缓存里记录的目录（不校验 ACE，只校验存在）。 */
function cachedDir(): string | null {
  try {
    const raw = JSON.parse(readFileSync(cacheFile(), 'utf8')) as { scratch?: unknown }
    if (typeof raw.scratch !== 'string' || raw.scratch === '') return null
    return existsSync(raw.scratch) ? raw.scratch : null
  } catch {
    return null
  }
}

/** 写选定目录缓存（失败不影响功能）。 */
function writeCache(dir: string): void {
  try {
    const file = cacheFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ scratch: dir, at: Date.now() }, null, 2)}\n`, 'utf8')
  } catch { /* 缓存写不进去只是下次重探，不影响本次 */ }
}

/**
 * 确认（必要时安装）Office 转换的工作目录。
 *
 * 幂等：同一进程只真正探测一次。返回选定的目录，或 null（表示保持原样）。
 *
 * @param sessions - 会话服务面（可选，用于把活跃工作区纳入候选）。
 * @returns 选定并已写入 `process.env.TEMP` 的目录；未改动时为 null。
 */
export function ensureOfficeScratch(sessions?: SessionsLike): string | null {
  if (sessions !== undefined) sessionsRef = sessions
  if (probed) return chosen
  probed = true
  if (process.platform !== 'win32') return null

  // 原 TEMP 就带沙箱写权限 → 一个字节都不改（绝大多数机器走这条）。
  const current = tmpdir()
  if (existsSync(current) && hasSandboxWriteAce(current)) {
    // 记一条缓存：官方 provider 与本模块读的是同一个 TEMP，缓存让后续诊断
    // 与重启后的快路径都能立刻给出结论，不必再跑 icacls。
    writeCache(current)
    return null
  }

  // 上次选定的目录还在（重启后也是）→ 直接沿用，不重跑 icacls。
  const cached = cachedDir()
  if (cached !== null && hasSandboxWriteAce(cached)) {
    applyScratch(cached)
    return chosen
  }
  for (const candidate of candidates(sessionsRef)) {
    try {
      mkdirSync(candidate, { recursive: true })
    } catch {
      continue
    }
    if (!hasSandboxWriteAce(candidate)) continue
    applyScratch(candidate)
    return chosen
  }
  return null
}

/**
 * 把选定目录写进进程环境。
 *
 * 必须是**进程级**（而不是只在自家转换里临时改）：官方 office-to-pdf provider
 * 与我们在同一个宿主进程里，它读的就是 `process.env.TEMP` —— 只改自己的作用域
 * 修不了侧边栏。TMP/TMPDIR 一并对齐：Node 在 win32 上只认 TEMP，但别的运行时
 * （以及 LibreOffice 自己的 TMPDIR 约定）看的是这两个。
 */
function applyScratch(dir: string): void {
  process.env.TEMP = dir
  process.env.TMP = dir
  process.env.TMPDIR = dir
  chosen = dir
  writeCache(dir)
}

/**
 * 重新解析一次（会话换工作区 / 目录被清掉后自愈）。
 *
 * 与 `ensureOfficeScratch` 的区别：无视「已探测」标记，且**当前生效目录仍合格
 * 就原地不动** —— 避免每次转换都重跑 icacls。仅在它失效时才回退重探。
 *
 * @returns 当前生效的目录（可能仍是原来那个）。
 */
export function refreshOfficeScratch(): string {
  if (process.platform !== 'win32') return tmpdir()
  const current = chosen ?? tmpdir()
  if (existsSync(current) && hasSandboxWriteAce(current)) {
    applyScratch(current)
    return current
  }
  probed = false
  chosen = null
  ensureOfficeScratch(sessionsRef)
  return chosen ?? tmpdir()
}

/**
 * 读一次落盘缓存，用作**快速路径**（省掉首次的 icacls 往返）。
 * @returns 缓存里记录的目录（存在时）。
 */
export function cachedOfficeScratch(): string | null {
  return cachedDir()
}

/** 当前生效的工作目录（供诊断路由回显）。 */
export function currentOfficeScratch(): string {
  return chosen ?? cachedDir() ?? tmpdir()
}

/** 导出给冒烟对拍的内部面。 */
export const __test = { candidates, hasSandboxWriteAce, SCRATCH_DIR_NAME, parseAceLines }

/**
 * ACE 文本 → 是否含沙箱写权限（纯函数，导出给冒烟对拍）。
 *
 * 判据：任一含 `S-1-4-<数字>` 的行，其权限括号里出现 W / M / F 之一。
 * 拆成纯函数是因为这条判据错了不会报错 —— 只会静默选中一个写不了的目录，
 * 然后 ppt/word 预览继续失败，看起来像「修复没生效」。
 *
 * @param output - `icacls <dir>` 的输出。
 * @returns 是否可写。
 */
export function parseAceLines(output: string): boolean {
  for (const line of output.split(/\r?\n/)) {
    if (!/S-1-4-\d/.test(line)) continue
    const rights = /\(([^)]*)\)\s*$/.exec(line.trim())?.[1] ?? ''
    if (/[WMF]/.test(rights)) return true
  }
  return false
}
