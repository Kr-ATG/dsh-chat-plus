/**
 * dsh-chat-plus — 会话产出物收集（纯函数，无 React / 无 DOM）。
 *
 * 回答一个问题：**这次对话一共做出来了哪些文件。**
 *
 * 客户端只有一路数据：工具调用。在这一路里分两条：
 *  · **权威路** —— 工具**参数**里声明的目标路径（write / edit / download / present…）。
 *    与「操作面板」行内那枚预览入口同源，最准。
 *  · **结果路** —— 工具**返回文本**里出现的成品路径。模型跑脚本产出文件时
 *    （Blender 渲染、Python 画图、ffmpeg 导出），路径只出现在命令的输出里，
 *    参数里什么都没有 —— 这一路是这类产出的唯一来源。
 *
 * 三条刻意的取舍：
 *  1. **只认本地文件**：生图工具返回的 b64 / 远程 URL 不列。这张卡的全部价值是
 *     「点一下就看见」，点不开的条目只是在凑数；生图结果本来就有对话流里的画廊
 *     在展示（见 generated-images/）。
 *  2. **只列成品**：代码文件（.ts/.py/.css…）折成一行计数，不逐条占行 ——
 *     一次编码任务改十几个源文件，逐条列出来会把「做出来了什么」整个淹掉。
 *  3. **只扫会产出东西的工具**：read / grep / glob / web_fetch 的结果里出现的
 *     路径是「看到的东西」，不是「做出来的东西」，一概不算。
 *
 * 纯函数、无副作用（内部那张按节点缓存是幂等的，只为避开流式期每帧重扫正则），
 * 可直接在 smoke 里 import 断言。
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { callName, isRunning, resultText } from '../tool-summary/tool-stats.ts'
import { argFields, toolArgsRaw } from '../tool-summary/activity-view-model.ts'

/** 产出物的类别。决定行首那枚 SVG 缩略图长什么样。 */
export type OutputKind =
  | 'image' | 'video' | 'audio' | 'model3d'
  | 'doc' | 'pdf' | 'sheet' | 'slide' | 'archive'
  | 'code' | 'other'

export interface OutputItem {
  /**
   * 完整路径（打开预览用）。
   *
   * 相对路径原样保留，由打开时按会话工作区根解析（与操作面板那枚入口同一套
   * 约定，见 open-preview.ts 的 fileAddressFor）。
   */
  readonly path: string
  /** 文件名（上屏文案，只留最后一段）。 */
  readonly name: string
  readonly kind: OutputKind
}

export interface OutputsView {
  /** 成品，首见顺序（同一路径只出现一次）。 */
  readonly items: readonly OutputItem[]
  /** 代码文件路径，首见顺序；默认折成一行计数，用户点开才逐条列。 */
  readonly code: readonly string[]
}

const EMPTY_VIEW: OutputsView = { items: [], code: [] }

/* ── 扩展名 → 类别 ─────────────────────────────────────────────────────── */

/**
 * 扩展名总表（小写、不带点）。
 *
 * 两个判断值得说明：
 *  · **gif 归 video**：它是「会动的」，给一枚播放符号比给山峰更贴它的语义。
 *    截图里那两个 `talos-*-motion.gif` 正是运镜动画。
 *  · **svg 归 image**：它同时也是 XML，但对用户来说那就是一张图。
 *  · **html 归 code**：对用户它是一个能打开的页面，但产出物这张卡的「成品」
 *    口径是「媒体与文档」，一个 .html 演示页在语义上仍是源码。宁可少列。
 *
 * 不在表内的扩展名一律 `other`，**不列也不计数** —— 认不出来就不占行。
 */
const KIND_BY_EXT: Readonly<Record<string, OutputKind>> = {
  // 图片
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image',
  avif: 'image', svg: 'image', ico: 'image', tif: 'image', tiff: 'image', heic: 'image',
  // 视频 / 动图
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video',
  avi: 'video', gif: 'video',
  // 音频
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio',
  // 3D / 建模
  blend: 'model3d', obj: 'model3d', fbx: 'model3d', stl: 'model3d', glb: 'model3d',
  gltf: 'model3d', dae: 'model3d', ply: 'model3d', '3ds': 'model3d',
  // 文档
  md: 'doc', markdown: 'doc', txt: 'doc', rtf: 'doc', doc: 'doc', docx: 'doc', odt: 'doc',
  pdf: 'pdf',
  // 表格 / 演示
  csv: 'sheet', tsv: 'sheet', xls: 'sheet', xlsx: 'sheet', ods: 'sheet',
  ppt: 'slide', pptx: 'slide', odp: 'slide',
  // 压缩包
  zip: 'archive', '7z': 'archive', rar: 'archive', tar: 'archive',
  gz: 'archive', bz2: 'archive', xz: 'archive',
  // 代码（折一行计数）
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code',
  json: 'code', jsonl: 'code', py: 'code', rb: 'code', go: 'code', rs: 'code',
  java: 'code', kt: 'code', kts: 'code', swift: 'code', c: 'code', cc: 'code',
  cpp: 'code', cxx: 'code', h: 'code', hh: 'code', hpp: 'code', cs: 'code',
  php: 'code', sh: 'code', bash: 'code', zsh: 'code', ps1: 'code', bat: 'code',
  cmd: 'code', sql: 'code', xml: 'code', yaml: 'code', yml: 'code', toml: 'code',
  ini: 'code', cfg: 'code', conf: 'code', css: 'code', scss: 'code', less: 'code',
  html: 'code', htm: 'code', vue: 'code', svelte: 'code', astro: 'code',
  lua: 'code', r: 'code', dart: 'code', scala: 'code', clj: 'code', ex: 'code',
  exs: 'code', erl: 'code', hs: 'code', ml: 'code', nim: 'code', zig: 'code',
  ipynb: 'code',
}

/** 扩展名判定用的候选串（长的排前面，避免短扩展名抢在长扩展名前命中）。 */
const EXT_ALTERNATION = Object.keys(KIND_BY_EXT)
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .map((ext) => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

/**
 * 结果文本里的成品路径。
 *
 * 前缀必须是**盘符或分隔符**（`D:\`、`/`、`./`、`../`）：裸文件名不算 ——
 * 结果里到处是 `report.md` 这种引用，认了就会把正文当产出。
 * 尾部的 `\b` 保证 `.png` 不会被 `.png1` / `.png_old` 骗过。
 */
const RESULT_PATH_RE = new RegExp(
  '(?:[A-Za-z]:[\\\\/]|\\.{0,2}[\\\\/])'
  + '[^\\s"\'`,;，。；、）)\\]}>|*?\u0060]+?'
  + '\\.(?:' + EXT_ALTERNATION + ')\\b',
  'gi',
)

/**
 * DSH 自己的 **spill 目录**（`%TEMP%/dsh-spill-<6 位>/session-<12 位 hex>/`）。
 *
 * 工具结果超过阈值时，DSH 把完整结果落到这里，正文只留「preview + 定位路径」。
 * 这条路径**必然**出现在结果文本里，而它既不是用户要的东西、点开也没有意义
 * （一串哈希文件名的临时文件），必须整类排除。
 *
 * 目录形态是 DSH 的固定契约（见 @deepseek-ai/dsh-spill-local 的
 * DEFAULT_ROOT_PREFIX 与 SESSION_DIR_RE），所以按前缀认是可靠的。
 */
const SPILL_PATH_RE = /[/\\]dsh-spill-[^/\\]*[/\\]/i

/**
 * 「落盘动词」：结果文本里出现它，才说明**紧跟的路径是被写出来的**。
 *
 * 这条闸门是给命令行工具（pwsh / bash / exec_command…）用的，也是这个模块最
 * 重要的一道过滤。原因：命令的输出里出现路径的场景**绝大多数不是产出** ——
 * `Get-ChildItem`、`ls -R`、`git status`、`dir`、`grep` 都会把一堆已有文件
 * 列出来，其中还包括**别的会话生成的文件**。无差别扫描等于把"看到的"当成
 * "做出来的"，用户看到的就是「产出物里出现了我没生成过的文件」。
 *
 * 真正需要靠结果文本才能拿到路径的场景只有一类：**脚本自己落盘**
 * （Blender 渲染、Python 画图、ffmpeg 导出）—— 这类输出必然带一句落盘说明
 * （`Saved: '…'`、`已保存到 …`）。所以认这句说明就够，且不会误伤列表输出。
 */
const SAVE_VERB_RE = /(?:保存(?:到|至|成|在|为)|已保存|写入(?:到|至|了)?|已写入|输出(?:到|至|了)|已输出|导出(?:到|至|了)?|已导出|生成(?:到|至|了)|已生成|落盘|下载到|另存为|\bsaved\b|\bwritten\b|\bexported\b|\bwrote\b|\boutput\s+file\b|\bgenerated\b|\bstored\s+at\b)/i

/**
 * 落盘说明所在的**行**才允许取路径；命中后连同**下一行**一起看。
 *
 * 为什么带一行：`ffmpeg`、`blender` 这类工具常把说明与路径分行打印
 * （`Saved:` 换行后才是文件名）。多带一行能兜住，而"整份文本只要含动词就全取"
 * 又太松（列表输出里只要有一行提到"保存"就全放行了）。
 */
function pathsInSaveContext(text: string): string[] {
  const lines = text.split('\n')
  const picked: string[] = []
  for (const [index, line] of lines.entries()) {
    if (!SAVE_VERB_RE.test(line)) continue
    picked.push(line)
    const next = lines[index + 1]
    if (next !== undefined) picked.push(next)
  }
  return picked
}

/**
 * 从命令原文里取**被显式写出的文件名**（basename 集合）。
 *
 * 这是给命令行产出用的第二道正向证据。有些命令的落盘路径是**变量拼出来的**
 * （`$out = Join-Path $dir '验收图.png'; $bmp.Save($out, ...)`），结果里只有
 * `FullName : D:\...\验收图.png` 这样的字段，一句落盘说明都没有 —— 只认落盘
 * 说明会把这类真产出整批漏掉（实测：生成测试图那一轮就是这么丢的）。
 *
 * 但文件名只要**在命令里被写出**，就说明模型确实指定了这个产物；而
 * `Get-ChildItem` / `ls -R` / `git status` 这类列表命令里，被列出来的文件名
 * （尤其是**别的会话生成的文件**）绝不会出现在命令原文里 —— 这正是用户报的
 * 「产出物里出现不是我这次生成的文件」的根因。
 *
 * 只取带扩展名的 token：`*.png` 这种通配符天然匹配不上具体文件名，是刻意的
 * 保守取舍（宁可漏，不可误报）。
 */
function namesInCommand(command: string): ReadonlySet<string> {
  const names = new Set<string>()
  if (command === '') return names
  for (const match of command.matchAll(/[^\s"'`,;，。；、）)\]}>|/\\]+/g)) {
    const token = match[0]
    const dot = token.lastIndexOf('.')
    if (dot <= 0 || dot === token.length - 1) continue
    names.add(token.toLowerCase())
  }
  return names
}

/** 路径里的扩展名（小写、不带点）；没有则空串。 */
function extOf(path: string): string {
  const base = path.split(/[/\\]/).filter(Boolean).at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 路径 → 类别。认不出来返回 'other'（调用方据此丢弃）。 */
export function classifyOutput(path: string): OutputKind {
  return KIND_BY_EXT[extOf(path)] ?? 'other'
}

/** 路径最后一段（上屏用的文件名）。 */
export function outputNameOf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
}

/* ── 路径归一化与去重键 ───────────────────────────────────────────────── */

/**
 * 归一化一条从文本里捞出来的路径。
 *
 * 主要处理一件事：工具结果常是 JSON 编码的，路径里的分隔符被转义成了
 * `\\`（`"D:\\a\\b.png"`）。不折叠的话同一条路径会因为写法不同去重失败，
 * 点开预览也会拿到一个带双反斜杠的非法地址。
 *
 * UNC 前缀（`\\server\share`）在这种折叠下会被压成 `\server\share`。这是已知的
 * 取舍：这张卡的实际产出几乎全是盘符路径，为它单独开一条分支不划算。
 */
export function normalizeOutputPath(raw: string): string {
  const trimmed = raw.trim().replace(/[.。]+$/, '')
  if (!trimmed.includes('\\\\')) return trimmed
  return trimmed.replace(/\\{2,}/g, '\\')
}

/** 去重键：分隔符与大小写都归一（Windows 盘符大小写不敏感）。 */
function dedupeKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/* ── 工具白名单 ───────────────────────────────────────────────────────── */

/**
 * **参数里声明的路径**可以算产出的工具（路 1，最准）。
 *
 * 判据是「这个参数写的就是**这次要做出来的东西**」：
 *  · write / edit / apply_patch / str_replace_editor —— 参数就是要写的目标文件；
 *  · download —— output / dest 是落盘位置；
 *  · present —— 参数就是要交付给用户的那几个文件。
 *
 * 刻意不在内：
 *  · **上传类**（browser_set_input_files / file_upload）—— 它的 paths 参数是
 *    **源文件**（用户本来就有的东西），把它当产出物等于把"用户给我的"说成
 *    "我做出来的"。
 *  · **命令行类**（pwsh / bash / exec_command…）—— 参数是命令原文，里面出现
 *    的路径多半是**输入**（`python script.py`、`ffmpeg -i in.mp4`），认了就会
 *    把源文件当产出。命令行真正的产出走结果路的「落盘说明」。
 */
const ARG_PATH_TOOLS = new Set([
  'write', 'edit', 'apply_patch', 'str_replace_editor',
  'download', 'present',
])

/**
 * **结果文本里**出现的成品路径可以算产出的工具（路 2）。
 *
 * 命令行类在这一路里，但只认「落盘说明」那几行（见 pathsFromResult）：
 * 脚本自己落盘（Blender 渲染、Python 画图、ffmpeg 导出）是这一类工具产出文件的
 * 唯一线索 —— 它的路径不会出现在参数里。
 *
 * read / grep / glob / web_* / browser_* 刻意不在内：它们的结果里出现的路径是
 * 「看到的东西」，不是「做出来的东西」。
 */
const RESULT_PATH_TOOLS = new Set([
  'write', 'edit', 'apply_patch', 'str_replace_editor',
  'download', 'present',
  'generate_image', 'generate_video',
  'bash', 'pwsh', 'exec_command', 'shell', 'terminal', 'terminal_send',
])

/** 删除类：它确实动了文件，但产出物卡讲的是「做出来了什么」，删掉的不算。 */
const DELETING_TOOLS = new Set(['delete_file', 'rm', 'unlink', 'remove'])

/** 单条调用最多收多少条路径：防住 `dir D:\images` 这种把整个目录刷上屏。 */
const MAX_PER_CALL = 8

/** 工具名归一：剥掉命名空间前缀与大小写差异。 */
function normalizeToolName(name: string): string {
  const lower = name.trim().toLowerCase()
  const tail = lower.split(/[.:/]/).filter(Boolean).at(-1)
  return tail ?? lower
}

/* ── 按节点缓存 ───────────────────────────────────────────────────────── */

/**
 * 单个工具节点的提取结果。
 *
 * 快照发布的频率在流式期很高（每个 delta 一次），而扫结果文本是这条链路上
 * 最贵的一步（正则逐条跑）。节点对象在 React 不可变更新下引用稳定，所以按
 * 对象缓存是安全的：只有新增或真的变了的节点会被重算。
 */
const perNodeCache = new WeakMap<object, readonly OutputItem[]>()

/* ── 提取 ─────────────────────────────────────────────────────────────── */

/** 递归收集一个调用树的全部调用（root + subCalls）。 */
function collectBlocks(root: ToolCallBlock): ToolCallBlock[] {
  const out: ToolCallBlock[] = [root]
  for (const child of root.subCalls) out.push(...collectBlocks(child))
  return out
}

/** 从参数里取字符串（单个或数组的第一项）。 */
function argString(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Array.isArray(value)) {
      const picked = value.find((item): item is string => typeof item === 'string' && item.trim() !== '')
      if (picked !== undefined) return picked.trim()
    }
  }
  return undefined
}

/** 参数里所有字符串路径（数组全取，用于 present 的多文件形态）。 */
function argPaths(args: Record<string, unknown>, ...keys: string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim())
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim() !== '') out.push(item.trim())
      }
    }
  }
  return out
}

/**
 * 结果文本里所有成品路径（按出现顺序，去重）。
 *
 * **两道正向证据，满足其一才收**：
 *  1. **落盘说明**（`Saved:` / `已保存到` / `Exported to`…）所在行及其下一行 ——
 *     脚本自己落盘时必然会打印这类说明；
 *  2. **文件名在命令原文里被显式写出** —— 兜住"路径由变量拼出来、结果里只剩
 *     `FullName : …` 字段"的那类命令（实测生成测试图那一轮就是这样）。
 *
 * 两条合起来，`Get-ChildItem` / `ls -R` / `git status` 这类**列表命令**就完全
 * 进不来了：它们的输出里全是已有文件（其中还包括别的会话生成的），而命令原文
 * 里一个具体文件名都没有 —— 这正是用户报的 BUG 的根因。
 *
 * spill 临时目录的排除不在这里做：两条路（参数 / 结果文本）都会经过
 * extractFromBlock 末尾那一处统一过滤，只在那边挡一次。
 *
 * @param text - 工具结果文本。
 * @param command - 该调用的命令原文（命令行工具才有；用于第二道证据）。
 * @returns 成品路径（已归一化、已去重）。
 */
function pathsFromResult(text: string, command = ''): string[] {
  if (text === '') return []
  // URL 先抹成等长空白：正则里的分隔符前缀会把 https://cdn/a.png 从 //cdn 起
  // 匹配出一个看着像相对路径、点开必然 404 的片段。
  const scrubbed = text.replace(
    /[a-z][a-z\d+.-]*:\/\/[^\s"'`,;，。；、）)\]}>]*/gi,
    (match) => ' '.repeat(match.length),
  )
  const declaredNames = namesInCommand(command)
  const found: string[] = []
  const seen = new Set<string>()

  const take = (source: string): void => {
    for (const match of source.matchAll(RESULT_PATH_RE)) {
      const path = normalizeOutputPath(match[0])
      if (path === '') continue
      const key = dedupeKey(path)
      if (seen.has(key)) continue
      seen.add(key)
      found.push(path)
    }
  }

  // 证据 1：落盘说明所在的上下文行。
  for (const line of pathsInSaveContext(scrubbed)) take(line)

  // 证据 2：结果里出现的路径，其**文件名**在命令原文里被显式写过。
  if (declaredNames.size > 0) {
    for (const match of scrubbed.matchAll(RESULT_PATH_RE)) {
      const path = normalizeOutputPath(match[0])
      if (path === '') continue
      const base = (path.split(/[/\\]/).filter(Boolean).at(-1) ?? '').toLowerCase()
      if (base === '' || !declaredNames.has(base)) continue
      const key = dedupeKey(path)
      if (seen.has(key)) continue
      seen.add(key)
      found.push(path)
    }
  }

  return found
}

/** 一条调用 → 产出物条目（可能 0 条）。 */
function extractFromBlock(block: ToolCallBlock): readonly OutputItem[] {
  if (isRunning(block)) return []
  if (block.isError) return []
  const raw = callName(block)
  const name = normalizeToolName(raw)
  if (name === '' || DELETING_TOOLS.has(name)) return []

  const paths: string[] = []
  const args = argFields(toolArgsRaw(block))

  // 路 1：参数里声明的目标路径（最准，优先）。
  if (ARG_PATH_TOOLS.has(name)) {
    // present 的多文件形态：path / paths / files 都可能是路径。
    const declared = argPaths(args, 'file_path', 'filePath', 'path', 'paths', 'files', 'output', 'dest')
    for (const item of declared) paths.push(item)
  }

  // 路 2：结果文本里带正向证据的成品路径（脚本产出的唯一来源）。
  if (RESULT_PATH_TOOLS.has(name)) {
    // 命令原文只在命令行工具上取：它是「文件名被显式写出」这道证据的来源。
    const command = typeof args.command === 'string' ? args.command : ''
    for (const item of pathsFromResult(resultText(block), command)) paths.push(item)
  }

  const out: OutputItem[] = []
  const seen = new Set<string>()
  for (const item of paths) {
    const path = normalizeOutputPath(item)
    if (path === '') continue
    // spill 临时文件既不是产出、也没有查看价值：两条路都统一在这里挡掉。
    if (SPILL_PATH_RE.test(path)) continue
    const kind = classifyOutput(path)
    if (kind === 'other') continue
    const key = dedupeKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, name: outputNameOf(path), kind })
    if (out.length >= MAX_PER_CALL) break
  }
  return out
}

/** 一个工具节点 → 产出物条目（带缓存）。 */
function extractFromNode(tool: unknown): readonly OutputItem[] {
  if (typeof tool !== 'object' || tool === null) return []
  const cached = perNodeCache.get(tool)
  if (cached !== undefined) return cached
  const root = (tool as { data?: { root?: ToolCallBlock } }).data?.root
  let result: readonly OutputItem[] = []
  if (root !== undefined) {
    try {
      const out: OutputItem[] = []
      for (const block of collectBlocks(root)) {
        for (const item of extractFromBlock(block)) out.push(item)
      }
      result = out
    } catch {
      // 未知节点形状不该让整张卡消失：这一条按「没有产出」处理。
      result = []
    }
  }
  perNodeCache.set(tool, result)
  return result
}

/* ── 主入口 ───────────────────────────────────────────────────────────── */

/**
 * 收集会话产出物。
 *
 * @param toolNodes - 会话里的 tool-call 节点（顺序即首见顺序，调用方按
 *   anchorSeq 升序给；见 collectSessionToolNodes）。
 * @returns 成品与代码文件两份清单。
 */
export function collectOutputs(toolNodes: readonly unknown[]): OutputsView {
  if (toolNodes.length === 0) return EMPTY_VIEW
  const items: OutputItem[] = []
  const code: string[] = []
  const seenItem = new Set<string>()
  const seenCode = new Set<string>()

  for (const tool of toolNodes) {
    for (const entry of extractFromNode(tool)) {
      const key = dedupeKey(entry.path)
      if (entry.kind === 'code') {
        if (seenCode.has(key)) continue
        seenCode.add(key)
        code.push(entry.path)
        continue
      }
      if (seenItem.has(key)) continue
      seenItem.add(key)
      items.push(entry)
    }
  }
  return { items, code }
}

/**
 * 从会话快照里取全部 tool-call 节点，按 anchorSeq 升序。
 *
 * 两条路都走（nodes.values + order）：与 collectTurnNodes 同样的理由 ——
 * 收口 / compact 之后官方会把一部分节点从 order 里摘掉，只扫 order 会漏。
 * 节点对象身份去重，同一个节点不会被收两次。
 */
export function collectSessionToolNodes(snapshot: unknown): readonly unknown[] {
  if (snapshot === null || snapshot === undefined) return []
  const snap = snapshot as {
    nodes?: { values?: () => Iterable<unknown>; get?: (key: string) => unknown }
    order?: unknown
  }
  const collected: { seq: number; node: unknown }[] = []
  const push = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    if ((node as { kind?: unknown }).kind !== 'tool-call') return
    const seq = (node as { anchorSeq?: unknown }).anchorSeq
    collected.push({ seq: typeof seq === 'number' ? seq : Number.MAX_SAFE_INTEGER, node })
  }

  try {
    if (typeof snap.nodes?.values === 'function') {
      for (const node of snap.nodes.values()) push(node)
    }
  } catch { /* 形状未知时退到 order 那条路 */ }
  try {
    if (Array.isArray(snap.order)) {
      for (const key of snap.order) {
        if (typeof key === 'string') push(snap.nodes?.get?.(key))
      }
    }
  } catch { /* ignore */ }

  collected.sort((a, b) => a.seq - b.seq)
  const seen = new Set<unknown>()
  const out: unknown[] = []
  for (const entry of collected) {
    if (seen.has(entry.node)) continue
    seen.add(entry.node)
    out.push(entry.node)
  }
  return out
}

/** 内容指纹：给调用方做引用稳定化，避免下游 memo 每帧被击穿。 */
export function outputsFingerprint(view: OutputsView): string {
  return `${view.items.map((item) => item.path).join('|')}#${view.code.join('|')}`
}
