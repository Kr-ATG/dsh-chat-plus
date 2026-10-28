/**
 * dsh-chat-plus — tool-summary/activity-view-model.ts
 *
 * 弹窗内工具卡片的纯展示推导：阶段、分类、标题、摘要、台账。
 * 展示语言参考 github:aa2246740/dsh-better-display（MIT）的 ToolActivity
 *（图标 + 变体标题 + 一行摘要 + 阶段徽标，展开后是台账 + 结果/输入/
 * 原始数据页签）；实现按本仓库的 ToolCallBlock 形状重写。
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { callName, isRunning } from './tool-stats.ts'

export type ViewPhase = 'running' | 'returned' | 'succeeded' | 'failed' | 'interrupted'
export type ViewCategory = 'write' | 'read' | 'terminal' | 'search' | 'web' | 'other'

export const PHASE_LABEL: Record<ViewPhase, string> = {
  running: '执行中', returned: '已返回', succeeded: '已完成',
  failed: '失败', interrupted: '已中断',
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(record: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  if (record === null) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** 顶层 JSON 字符串字段；流式截断导致 parse 失败时回空对象（摘要再回退原文）。 */
export function argFields(raw: string): Record<string, unknown> {
  try {
    return recordOf(JSON.parse(raw)) ?? {}
  } catch {
    return {}
  }
}

export function toolArgsRaw(block: ToolCallBlock): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}

export function classifyCategory(name: string): ViewCategory {
  // dsh-ops（2026-10-27 补）：它的 ops_* 工具在 Standard/Cordis 模式下顶替官方
  // read/glob/grep/write/edit，在全部 Windows 模式下顶替 pwsh。这里按同一分类
  // 归类，否则装了插件之后整条工具行会掉进 'other'、标题退化成原始工具名。
  if (/^(write|edit|apply_patch|patch|str_replace_editor|ops_write_file|ops_edit_file|ops_replace|ops_copy|ops_move)$/.test(name)) return 'write'
  if (/^(read|read_file|ops_read_files|ops_inspect_local_file)$/.test(name)) return 'read'
  if (/^(bash|shell|terminal|terminal_send|exec_command|pwsh|ops_bash)$/.test(name)) return 'terminal'
  if (/^(grep|glob|find|search|ops_grep|ops_glob)$/.test(name)) return 'search'
  if (/^(web_search|web_fetch|web_open)$/.test(name)) return 'web'
  return 'other'
}

/** 变体标题：write/edit 复用 Write/Edit，其余按分类。 */
export function rowTitle(name: string, category: ViewCategory): string {
  if (name === 'skill') return 'Skill'
  if (name === 'edit') return 'Edit'
  if (name === 'pwsh') return 'Pwsh'
  if (category === 'other') return name === '' ? 'Tool call' : name
  return category === 'write' ? 'Write'
    : category === 'read' ? 'Read'
    : category === 'terminal' ? 'Bash'
    : category === 'search' ? 'Search'
    : 'Tool call'
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/** 一行摘要：文件/命令/查询优先，其余回退原文首行。 */
export function rowSummary(name: string, category: ViewCategory, args: Record<string, unknown>, raw: string): string {
  const file = str(args, 'file_path', 'path', 'filename', 'filePath')?.split(/[/\\]/).at(-1)
  const command = str(args, 'command', 'cmd', 'script')
  const description = str(args, 'description')
  const query = str(args, 'query', 'pattern', 'url')
  switch (category) {
    case 'write': return file !== undefined ? `${name === 'write' ? '写入' : '修改'} ${file}` : (name === 'apply_patch' ? '代码补丁' : name)
    case 'read': return file !== undefined ? `读取 ${file}` : (query ?? name)
    case 'terminal': return description ?? command ?? name
    case 'search': return name === 'glob' ? '查找文件' : (query ?? name)
    case 'web': return name === 'web_search' ? '搜索网页' : (query ?? '读取网页')
    default: {
      if (name === 'skill') {
        const skill = str(args, 'name') ?? raw
        return firstLine(skill)
      }
      const picked = str(args, 'file_path', 'path', 'command', 'url', 'query', 'pattern')
      // 无可摘字段时只给原文首行，不再拼一遍工具名（标题已经是它，避免重复）。
      if (picked !== undefined) return `${name} · ${firstLine(picked)}`
      if (raw !== '') return firstLine(raw).slice(0, 80)
      return name === '' ? '工具调用' : name
    }
  }
}

/** 退出码 / 信号：meta 优先，文本尾 `[exit code: N]` 兜底。 */
export function executionFacts(block: ToolCallBlock): { exitCode?: number; signal?: string } {
  if (!('kind' in block)) return {}
  const meta = recordOf(block.meta)
  const code = meta?.exitCode ?? meta?.exit_code
  const text = block.content.length === 1 && typeof (block.content[0] as { text?: unknown })?.text === 'string'
    ? (block.content[0] as { text: string }).text
    : ''
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  const parsed = exit?.[1] === undefined ? undefined : Number(exit[1])
  return {
    exitCode: typeof code === 'number' && Number.isFinite(code) ? code : parsed,
    signal: str(meta, 'signal') ?? signal?.[1],
  }
}

export function viewPhase(block: ToolCallBlock): ViewPhase {
  if (isRunning(block)) return 'running'
  if (block.error?.code === 'ABORTED' || block.error?.code === 'interrupted') return 'interrupted'
  const facts = executionFacts(block)
  if (block.isError || facts.signal !== undefined || (facts.exitCode !== undefined && facts.exitCode !== 0)) return 'failed'
  if (facts.exitCode === 0) return 'succeeded'
  return 'returned'
}

/** 结果文本块（text 类型拼接；无文本回空串）。 */
export function resultParagraphs(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts: string[] = []
  for (const content of block.content) {
    const c = content as { type?: string; text?: string }
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
  }
  return parts.join('\n')
}

/** 结果里的非文本载荷（图片/扩展）数量。 */
export function resultExtraCount(block: ToolCallBlock): number {
  if (!('kind' in block)) return 0
  let count = 0
  for (const content of block.content) {
    if ((content as { type?: string }).type !== 'text') count += 1
  }
  return count
}

/** 完整结果 JSON（原始数据页签用，只读）。 */
export function rawResultJson(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  try {
    return JSON.stringify({ content: block.content, isError: block.isError, meta: block.meta }, null, 2)
  } catch {
    return ''
  }
}

export interface ReadWindow { readonly path: string; readonly lang?: string; readonly lines: readonly { number: number; text: string }[]; readonly totalLines: number }
export interface DiffHunkView { readonly path: string; readonly oldText: string | null; readonly newText: string }

function readWindowLines(value: unknown): { number: number; text: string }[] | null {
  if (!Array.isArray(value)) return null
  const lines: { number: number; text: string }[] = []
  for (const item of value) {
    const row = recordOf(item)
    if (typeof row?.number !== 'number' || !Number.isInteger(row.number) || typeof row.text !== 'string') return null
    lines.push({ number: row.number, text: row.text })
  }
  return lines
}

/** read 类结果：meta.lines 窗口。 */
export function readWindowOf(block: ToolCallBlock): ReadWindow | null {
  if (!('kind' in block)) return null
  const meta = recordOf(block.meta)
  const lines = readWindowLines(meta?.lines)
  if (typeof meta?.path !== 'string' || typeof meta.totalLines !== 'number' || lines === null) return null
  return {
    path: meta.path,
    lang: typeof meta.lang === 'string' ? meta.lang : undefined,
    lines, totalLines: meta.totalLines,
  }
}

/** write 类结果：meta.diffs。 */
export function diffHunksOf(block: ToolCallBlock): DiffHunkView[] | null {
  if (!('kind' in block)) return null
  const value = recordOf(block.meta)?.diffs
  if (!Array.isArray(value) || value.length === 0) return null
  const diffs: DiffHunkView[] = []
  for (const item of value) {
    const row = recordOf(item)
    if (typeof row?.path !== 'string'
      || (row.oldText !== null && typeof row.oldText !== 'string')
      || typeof row.newText !== 'string') return null
    diffs.push({ path: row.path, oldText: row.oldText, newText: row.newText })
  }
  return diffs
}

export interface SearchPathsView { readonly shape: 'paths'; readonly paths: string[]; readonly total: number; readonly truncated: boolean }
export interface SearchMatchesView {
  readonly shape: 'matches'
  readonly files: { path: string; matches: { lineNumber: number; line: string }[] }[]
  readonly total: number
  readonly truncated: boolean
}

/** search 类结果：paths / matches 两形态。 */
export function searchViewOf(block: ToolCallBlock): SearchPathsView | SearchMatchesView | null {
  if (!('kind' in block)) return null
  const meta = recordOf(block.meta)
  if (typeof meta?.total !== 'number' || typeof meta.truncated !== 'boolean') return null
  if (meta.shape === 'paths' && Array.isArray(meta.paths)
    && meta.paths.every((path): path is string => typeof path === 'string')) {
    return { shape: 'paths', paths: meta.paths, total: meta.total, truncated: meta.truncated }
  }
  if (meta.shape === 'matches' && Array.isArray(meta.files)) {
    const files: { path: string; matches: { lineNumber: number; line: string }[] }[] = []
    for (const item of meta.files) {
      const row = recordOf(item)
      if (typeof row?.path !== 'string' || !Array.isArray(row.matches)) return null
      const matches: { lineNumber: number; line: string }[] = []
      for (const m of row.matches) {
        const match = recordOf(m)
        if (typeof match?.lineNumber !== 'number' || !Number.isInteger(match.lineNumber) || typeof match.line !== 'string') return null
        matches.push({ lineNumber: match.lineNumber, line: match.line })
      }
      files.push({ path: row.path, matches })
    }
    return { shape: 'matches', files, total: meta.total, truncated: meta.truncated }
  }
  return null
}

export interface WebFetchView { readonly shape: 'fetch'; readonly url: string; readonly statusCode: number; readonly truncated: boolean }
export interface WebSearchView {
  readonly shape: 'search'
  readonly sources: { url: string; title?: string; snippet?: string; publishedAt?: string }[]
  readonly answer?: string
  readonly truncated: boolean
}

/** web 类结果：fetch / search 两形态。 */
export function webViewOf(name: string, block: ToolCallBlock): WebFetchView | WebSearchView | null {
  if (!('kind' in block)) return null
  const meta = recordOf(block.meta)
  if (typeof meta?.truncated !== 'boolean') return null
  if (name === 'web_fetch' && typeof meta.url === 'string' && typeof meta.statusCode === 'number') {
    return { shape: 'fetch', url: meta.url, statusCode: meta.statusCode, truncated: meta.truncated }
  }
  if (name === 'web_search' && Array.isArray(meta.sources)) {
    const sources: { url: string; title?: string; snippet?: string; publishedAt?: string }[] = []
    for (const item of meta.sources) {
      const source = recordOf(item)
      if (typeof source?.url !== 'string') return null
      sources.push({
        url: source.url,
        ...(typeof source.title === 'string' ? { title: source.title } : {}),
        ...(typeof source.snippet === 'string' ? { snippet: source.snippet } : {}),
        ...(typeof source.publishedAt === 'string' ? { publishedAt: source.publishedAt } : {}),
      })
    }
    return {
      shape: 'search', sources, truncated: meta.truncated,
      ...(typeof meta.answer === 'string' ? { answer: meta.answer } : {}),
    }
  }
  return null
}
