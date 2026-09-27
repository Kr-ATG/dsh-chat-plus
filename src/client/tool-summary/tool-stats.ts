/**
 * Pure derivations for the tool-group summary card: call counting, per-tool
 * distribution, error/running tallies, and file-path extraction from args.
 */

import type { RunningToolCall, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * callView 是 0.1.1 webui 时代的工具卡片视图字段，0.1.2 已被 ui-tool 的
 * 纯模型推导取代（ToolResultNode 上不再有该属性）。运行时对两种 DSH 都要
 * 安全：取不到回 null（等价旧代码里 callView === null 的跳过分支），绝不
 * 把 undefined 直插 null 比较（undefined !== null 恒真会炸掉 view.card）。
 */
export interface ToolCallViewLike {
  readonly card?: string | undefined
  readonly kind?: string | undefined
  readonly title?: string | undefined
}

export function callViewOf(block: ToolCallBlock): ToolCallViewLike | null {
  const view = (block as { callView?: unknown }).callView
  if (view === null || view === undefined) return null
  return typeof view === 'object' ? (view as ToolCallViewLike) : null
}

/** Tools whose calls are pure reads — hidden from the list by default. */
export const READONLY_TOOLS = new Set([
  'read', 'grep', 'glob', 'web_search', 'web_fetch', 'search', 'ls', 'find', 'list',
])

/** Wire name of one running-or-settled call. */
export function callName(block: ToolCallBlock): string {
  return 'kind' in block ? (block.call?.name ?? '') : block.name
}

/** Is this call still running (no final result yet)? */
export function isRunning(block: ToolCallBlock): block is RunningToolCall {
  return !('kind' in block)
}

/** Extract a display/actionable path from tool args (read/edit/write/etc). */
export function argsPath(argsRaw: string): string | undefined {
  if (argsRaw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    for (const key of [
      'TargetFile', 'target_file', 'targetFile',
      'file_path', 'filePath', 'path',
      'AbsolutePath', 'absolute_path',
      'dir', 'url',
    ]) {
      const value = record[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Flatten the text of one settled result's content blocks. */
export function resultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts: string[] = []
  for (const content of block.content) {
    const c = content as { type?: string; text?: string }
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
  }
  return parts.join('\n')
}

export interface ToolStat {
  readonly name: string
  readonly count: number
}

export interface ToolStats {
  /** Total calls in the group (roots only, subcalls not re-counted). */
  readonly total: number
  /** Calls still running. */
  readonly running: number
  /** Settled calls that failed. */
  readonly errors: number
  /** Per-tool distribution, descending by count. */
  readonly byTool: readonly ToolStat[]
  /** Distinct actionable paths (files/urls) mentioned by call args. */
  readonly files: readonly string[]
  /** Calls whose tool is in the read-only set. */
  readonly readOnly: number
}

/** Collapse one group's roots into summary statistics. */
export function computeStats(blocks: readonly ToolCallBlock[]): ToolStats {
  const counts = new Map<string, number>()
  const files = new Set<string>()
  let total = 0
  let running = 0
  let errors = 0
  let readOnly = 0
  for (const block of blocks) {
    const name = callName(block)
    total += 1
    counts.set(name, (counts.get(name) ?? 0) + 1)
    if (isRunning(block)) running += 1
    else if (block.isError) errors += 1
    if (READONLY_TOOLS.has(name)) readOnly += 1
    const path = argsPath('kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw)
    if (path !== undefined) files.add(path)
  }
  const byTool = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return { total, running, errors, byTool, files: [...files], readOnly }
}
/** Shorten a path against the session cwd (display only). */
export function shortenPath(path: string, cwd: string | undefined): string {
  if (cwd !== undefined && cwd !== '') {
    const normPath = path.replace(/\\/g, '/')
    const normCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    if (normPath.toLowerCase().startsWith(normCwd.toLowerCase())) {
      const rest = normPath.slice(normCwd.length).replace(/^\/+/, '')
      return rest === '' ? path : rest
    }
  }
  return path
}

/** Is this summary entry a web URL (web_fetch / browser args)? */
export function isUrlEntry(entry: string): boolean {
  return /^https?:\/\//i.test(entry)
}

/**
 * 摘要 pill 的显示文本：URL 去协议、去查询串（percent 编码的搜索参数整段
 * 丢掉，完整值留在 title），路径仍按 cwd 缩短。配合 CSS ellipsis 兜底。
 */
export function shortenEntry(entry: string, cwd: string | undefined): string {
  if (isUrlEntry(entry)) {
    try {
      const url = new URL(entry)
      const host = url.hostname.replace(/^www\./i, '')
      const pathname = url.pathname.replace(/^\/+|\/+$/g, '')
      return pathname === '' ? host : `${host}/${pathname}`
    } catch {
      // 解析失败原样交给 ellipsis。
    }
  }
  return shortenPath(entry, cwd)
}

/** Format an elapsed millisecond duration for compact display. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--'
  const seconds = ms / 1000
  if (seconds < 1) return `${Math.round(ms)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return `${minutes}m ${rest.toString().padStart(2, '0')}s`
}

/** Elapsed duration of one tool call: live for running, settled span otherwise. */
export function callDurationMs(block: ToolCallBlock, now?: number): number | undefined {
  if (isRunning(block)) return Math.max(0, (now ?? Date.now()) - block.time)
  if (block.callTime === null) return undefined
  return Math.max(0, block.time - block.callTime)
}

/** Long-running activity a call represents, used for live status labels. */
export type ToolActivity = 'download' | 'command' | 'other'

/** shell 侧下载习惯用法（curl/wget/aria2c + PowerShell iwr/WebClient/BITS）。 */
const SHELL_DOWNLOAD_RE = /(?:^|[\s('"])(?:curl(?:\.exe)?|wget|aria2c)\b|Invoke-WebRequest|\biwr\b|Start-BitsTransfer|\bbitsadmin\b|WebClient|DownloadFile\s*\(/i

/** Classify one call into a coarse live-activity bucket. */
export function classifyActivity(block: ToolCallBlock): ToolActivity {
  const name = callName(block)
  const raw = 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  // 下载：显式下载工具，或 shell 命令里在抓取文件。
  if (/download/i.test(name)) return 'download'
  if (SHELL_DOWNLOAD_RE.test(raw)) return 'download'
  const view = callViewOf(block)
  if (view !== null && view.card === 'terminal') return 'command'
  if (view !== null && view.card === 'generic' && view.kind === 'execute') return 'command'
  if (/^(bash|sh|pwsh|powershell|cmd|zsh)$/i.test(name)) return 'command'
  return 'other'
}

/** 一个下载调用的展示信息：来源 URL + 保存路径。 */
export interface DownloadInfo {
  readonly url: string
  readonly output: string
}

/** 递归收集一个调用树里所有仍在运行的调用（root + subCalls）。 */
export function collectRunningCalls(block: ToolCallBlock): RunningToolCall[] {
  const out: RunningToolCall[] = []
  const walk = (current: ToolCallBlock): void => {
    if (isRunning(current)) out.push(current)
    for (const child of current.subCalls) walk(child)
  }
  walk(block)
  return out
}

/** 从 shell 下载命令参数解析下载 URL 与保存路径（都拿不到返回 undefined）。 */
export function parseDownload(block: ToolCallBlock): DownloadInfo | undefined {
  const raw = 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  if (raw === '') return undefined
  // 先闸门：不是下载工具、命令里也没有抓取动作（curl/wget/iwr/BITS/WebClient），
  // 就一律不当下载看。否则 esbuild 的 --outfile=、PowerShell 的 Select-Object
  // 这类参数会被误认成下载目标，跑个构建也挂出一张「下载中」卡。
  if (!/download/i.test(callName(block)) && !SHELL_DOWNLOAD_RE.test(raw)) return undefined
  let output = ''
  // curl -o/--output，wget -O/--output-document（支持引号包裹）。
  const out = /(?<![\w-])(?:--output-document|--output|-o|-O)(?![\w-])[=\s]+(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(raw)
  if (out !== null) output = out[1] ?? out[2] ?? out[3] ?? ''
  if (output === '') {
    // PowerShell：Invoke-WebRequest/-OutFile、iwr -OutFile；aria2c -d dir -o file。
    const psOut = /(?<![\w-])-OutFile(?![\w-])[=\s]+(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(raw)
      ?? /-d[=\s]+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:--out|-o)[=\s]+(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(raw)
    if (psOut !== null) {
      const first = psOut[1] ?? psOut[2] ?? psOut[3]
      const second = psOut[4] ?? psOut[5] ?? psOut[6]
      const dir = first !== undefined && psOut[0].startsWith('-d') ? first : ''
      const file = psOut[0].startsWith('-d') ? second : first
      output = dir !== '' && file !== undefined ? joinDisplay(dir, file) : (file ?? first ?? '')
    }
  }
  if (output === '') {
    // .NET WebClient.DownloadFile(url, path) 的第二参。
    const df = /DownloadFile\s*\(\s*[^,()]+,\s*(?:"([^"]+)"|'([^']+)'|([\w.:\\\/-]+))/i.exec(raw)
    if (df !== null) output = df[1] ?? df[2] ?? df[3] ?? ''
  }
  // 下载地址：最后一个 http(s):// 参数。
  let url = ''
  const urls = raw.match(/https?:\/\/[^\s"']+/gi)
  if (urls !== null && urls.length > 0) url = urls[urls.length - 1] ?? ''
  if (url === '' && output === '') return undefined
  return { url, output }
}

/** 纯展示用路径拼接（不触碰文件系统）。 */
function joinDisplay(dir: string, file: string): string {
  return dir.replace(/[\\/]+$/, '') + '\\' + file
}

