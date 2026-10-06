/**
 * dsh-chat-plus — spill 读取准入（host 半身，纯判定 + root 发现）。
 *
 * ## 为什么需要它（2026-10-06 修「画廊里的生图格子全空」）
 *
 * `generate_image` 的结果是一段大 JSON（含 base64 图），超过 spill 阈值后被
 * `dsh-spill-local` 落成文件，事件里只留 locator。画廊要显示这些图，就得经
 * 插件的 `/api/chat-flow/generated-images` 把文件读回来、解析出图片 URL。
 *
 * 原来的准入判据是「目标必须落在 **当前进程** 的 `spillStore.root` 之内」。而
 * `dsh-spill-local` 在没配置 root 时用
 * `mkdtempSync(join(tmpdir(), 'dsh-spill-'))` 建目录 —— **每启动一次进程就换一个
 * 新名字**，历史会话的 spill 文件躺在之前若干次启动留下的 root 里。于是画廊
 * （跨会话清单）列出的 14 张生图**全部 403**，界面上就是 14 个点开什么都没有的
 * 空白格子 —— 用户看到的就是「这些文件不存在」。实测 14/14 都在磁盘上
 * （2.2~2.7MB、内容可解析），只是不在当前 root。
 *
 * 判据与官方 `dsh-spill-local` 的启动清理面**同一套**：它扫 OS tmpdir 找出
 * `^dsh-spill-[A-Za-z0-9]{6}$` 形状的历史 root 去清过期文件，这里用同一份形状
 * 判据扩准入面 —— 语义就变成「这台机器上由本后端创建过的 spill root 都可读」。
 *
 * ## base 目录不能只信 `tmpdir()`（同轮第二个坑）
 *
 * 本插件为了修官方侧边栏的 Office 预览，会在挂载时把 `process.env.TEMP` 指到
 * workspace 下的 scratch（见 office/scratch.ts）—— 官方 provider 与本插件同进程，
 * 读的是同一个变量。副作用是**此后 `os.tmpdir()` 不再指向系统 Temp**，而官方
 * 创建 spill root 用的是**它自己启动那一刻**的 tmpdir（系统 Temp）。若 root 扫描
 * 只信当前 tmpdir，就会扫 scratch 这个空目录、一个历史 root 都找不到 —— 准入
 * 全拒，等于把刚修好的生图又关掉。
 *
 * 所以 base 取**并集**：插件启动时记住的原始 tmpdir（`rememberOriginalTmpdir`，
 * 必须在任何 TEMP 改写之前调）+ 当前 tmpdir + 平台惯例位置。多扫两个空目录的
 * 代价是一次 readdir，换来「TEMP 被谁改过都不影响发现」。
 *
 * ## 安全面
 *
 * 比原来的「在 root 内任意深度」**更严**：
 *  1. 目标必须严格是 `<可信 root>/session-<12 位小写 hex>/<文件名>.txt`；
 *  2. root 集合由「扫描 base 里符合精确命名的真实目录」得出，用户无法用任意路径
 *     构造一个通过判据的目标；
 *  3. 文件名逐段校验（拒绝 `..`、分隔符、控制字符）。
 */

import { readdirSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'

/**
 * 官方后端生成的默认 root 名（`dsh-spill-` + `mkdtemp` 追加的 6 位）。
 * 与 `dsh-spill-local` 的 `DEFAULT_ROOT_RE` 逐字对齐：只认精确形状，
 * 不认同前缀的目录（避免把别人的 `dsh-spill-test-*` 当成可信 root）。
 */
export const DEFAULT_ROOT_RE = /^dsh-spill-[A-Za-z0-9]{6}$/

/** 官方后端生成的会话目录名（`session-` + `sha256(sessionId)` 前 12 位小写 hex）。 */
export const SESSION_DIR_RE = /^session-[0-9a-f]{12}$/

/** spill 文件后缀白名单（只服务 `.txt`，与路由契约一致）。 */
const ALLOWED_EXT = new Set(['.txt'])

/** 插件启动时的原始 tmpdir（必须在任何 TEMP 改写之前由 apply 顶层记录）。 */
let originalTmp: string | null = null

/*
 * 模块加载即记录：本模块在 host.ts 的 import 列表里，加载时机早于任何延迟注入
 * 回调（office 模块改 TEMP 发生在那里）。放在模块顶层而不是 apply 里，是为了
 * 连「apply 被晚调用」这种顺序变化也免疫 —— 记错 base 的代价是整批生图 403。
 */
rememberOriginalTmpdir()

/**
 * 记下「启动那一刻」的 tmpdir。幂等：只认第一次。
 *
 * 为什么必须显式记：office 模块挂载时会改 `process.env.TEMP`（修官方 Office
 * 预览），改完 `os.tmpdir()` 就不再是 spill root 的出生地了。apply 顶层先于
 * 所有延迟注入回调执行，所以在这里读到的就是原始值。
 */
export function rememberOriginalTmpdir(): void {
  if (originalTmp === null) originalTmp = tmpdir()
}

/** 归一化路径（realpath + 小写 + 正斜杠 + 去尾分隔符），用于集合比较。 */
function canonical(value: string): string {
  let out = resolve(value)
  try { out = realpathSync(out) } catch { /* 不存在按字面 */ }
  return out.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase()
}

/**
 * spill root 的扫描基准目录（并集，去重）。
 * @returns 绝对路径列表。
 */
export function spillBases(): readonly string[] {
  const bases: string[] = []
  const push = (value: string | null | undefined): void => {
    if (typeof value !== 'string' || value === '' || !isAbsolute(value)) return
    const norm = canonical(value)
    if (!bases.includes(norm)) bases.push(norm)
  }
  push(originalTmp)
  push(tmpdir())
  // 平台惯例兜底：官方 privateRoot 用 tmpdir()，而 tmpdir 在 win32 上来自
  // USERPROFILE 下的 AppData\Local\Temp（用户没改过环境时）。TEMP 被改过、
  // 又没记住原始值的老进程里，这条是最后的发现途径。
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE
    if (typeof profile === 'string' && profile !== '') push(join(profile, 'AppData', 'Local', 'Temp'))
  } else {
    push('/tmp')
  }
  return bases
}

/**
 * 发现可信 spill root：当前进程的活动 root + 各 base 下所有符合官方命名形状的
 * 历史 root。
 *
 * @param activeRoot - 当前进程的活动 root（可为空；空表示 store 未就绪）。
 * @returns 去重、归一化后的可信 root 绝对路径。
 */
export function spillRoots(activeRoot: string | null | undefined): readonly string[] {
  const roots: string[] = []
  const push = (value: string | null | undefined): void => {
    if (typeof value !== 'string' || value === '' || !isAbsolute(value)) return
    const norm = canonical(value)
    if (!roots.includes(norm)) roots.push(norm)
  }
  push(activeRoot)
  for (const base of spillBases()) {
    let entries: string[]
    try { entries = readdirSync(base) } catch { continue }
    for (const name of entries) {
      if (!DEFAULT_ROOT_RE.test(name)) continue
      const candidate = join(base, name)
      try {
        if (!statSync(candidate).isDirectory()) continue
      } catch { continue }
      push(candidate)
    }
  }
  return roots
}

/** 准入结论：通过给出解析后的绝对路径，否则给出原因。 */
export type SpillVerdict =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: 'not-a-spill-path' | 'outside-roots' | 'bad-extension' }

/**
 * 判定一个 spill 路径能否读取（纯函数，不碰文件内容）。
 *
 * 判据（全部满足才通过）：绝对路径；文件名干净；后缀白名单；父目录是
 * `session-<12hex>`；祖父目录 ∈ 可信 root。
 *
 * @param raw - query 里的 file 参数。
 * @param roots - 可信 root 列表（{@link spillRoots}，已归一化）。
 * @returns 准入结论。
 */
export function admitSpillPath(raw: string, roots: readonly string[]): SpillVerdict {
  if (typeof raw !== 'string' || raw === '' || !isAbsolute(raw)) return { ok: false, reason: 'not-a-spill-path' }
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, reason: 'not-a-spill-path' }

  const target = resolve(raw)
  const name = basename(target)
  if (name === '' || name === '.' || name === '..' || name.includes('\\') || name.includes('/')) {
    return { ok: false, reason: 'not-a-spill-path' }
  }
  if (!ALLOWED_EXT.has(extname(target).toLowerCase())) return { ok: false, reason: 'bad-extension' }

  const sessionDir = dirname(target)
  if (!SESSION_DIR_RE.test(basename(sessionDir))) return { ok: false, reason: 'not-a-spill-path' }
  const rootDir = canonical(dirname(sessionDir))
  if (!roots.includes(rootDir)) return { ok: false, reason: 'outside-roots' }
  return { ok: true, path: target }
}

/** 导出给冒烟对拍的内部面。 */
export const __test = { canonical, spillBases, ALLOWED_EXT }
