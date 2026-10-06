/**
 * dsh-chat-plus — 多媒体画廊：会话事件 → 产出物条目（host 侧提取核心，纯函数）。
 *
 * 与 client 侧 `kr-chat/outputs.ts` 回答同一个问题（「这次对话做出来了哪些
 * 文件」），但输入形状不同：那边吃的是浏览器运行时的 `ToolCallBlock` 节点，
 * 这边吃的是**持久化会话事件**（`tool/call` + `tool/result`，按 callId 配对）。
 *
 * 提取规则不重写第二遍 —— 全部复用 outputs.ts 导出的纯函数与常量
 * （ARG_PATH_TOOLS / RESULT_PATH_TOOLS / pathsFromResult / argPaths /
 * isTransientOutputPath …），两条链路的口径由同一份源码钉死：那边修一个
 * 误报，这边同步生效。
 *
 * 画廊专属的两处收窄（对 outputs.ts 的**展示层**差异，不是提取差异）：
 *  1. **只收可视/可听/可打开的类别**：code / archive / model3d 不进画廊 ——
 *     「多媒体画廊」列的是图片、页面、文档、演示、表格、音视频；源码与压缩包
 *     在产出物卡里有它们的位置，在这里只会把图淹掉。
 *  2. **doc 只收 Word 家族**（doc/docx/odt/rtf）：md/txt 是笔记与说明文本，
 *     一次编码会话能写几十个，进画廊等于噪声；用户点名的「word」是 Office 文档。
 *
 * 输入通道有**两条**，缺一不可（2026-10-05 补第二条）：
 *  1. `tool/call` + `tool/result`（按 callId 配对）—— 直接工具调用；
 *  2. `tool/ptc-dispatch` —— **PTC 沙箱里的子调用**（run_code 的代码体内部调
 *     todo_write / present / generate_image / pwsh…）。这类调用**没有**独立的
 *     tool/call 与 tool/result 事件：参数与结果都挂在这一条事件上，callId 是
 *     `<rootCallId>:ptc:<n>`。只认第一条通道时，模型在 run_code 里交付的
 *     present 路径永远进不了索引 —— 产出物卡里那行看得见、点开却 403（用户
 *     2026-10-05 报的「点图片加载不出来，点侧栏按钮却能加载」）。
 *
 * 另有一类**磁盘上没有路径的产出**：generate_image / generate_video 的结果是
 * b64 JSON，超阈值后被 DSH spill-policy 落成临时 .txt（30 天保留），事件文本里
 * 只剩 locator。这类条目记为 source='generated'，携带 spill 文件路径，由客户端
 * 经既有的 /api/chat-flow/generated-images 路由解析成图片 —— 生图是「对话生成
 * 的图片」里最大的一块，画廊不能没有它。
 *
 * 约束（与 build.mjs assertHostExternals 一致）：本文件可 import client 目录的
 * **纯函数模块**（无 DOM、无 React 运行时依赖，esbuild 打进 host 产物），
 * 但零 @deepseek-ai 运行时导入。
 */

import { isAbsolute, resolve } from 'node:path'
import {
  ARG_PATH_TOOLS,
  DELETING_TOOLS,
  MAX_PER_CALL,
  RESULT_PATH_TOOLS,
  SPILL_PATH_RE,
  TRANSIENT_MEDIA_EXEMPT,
  argPaths,
  isTransientOutputPath,
  normalizeOutputPath,
  normalizeToolName,
  outputNameOf,
  pathsFromResult,
} from '../../client/kr-chat/outputs.ts'
import { argFields } from '../../client/tool-summary/activity-view-model.ts'
import { findSpillLocator } from '../../client/generated-images/parse.ts'

/** 画廊条目的展示类别（比 outputs.ts 的 OutputKind 更贴「多媒体」语义）。 */
export type GalleryKind =
  | 'image' | 'video' | 'audio' | 'page' | 'pdf' | 'slide' | 'sheet' | 'doc'

/**
 * 画廊收录的扩展名 → 展示类别。
 *
 * 与 outputs.ts 的 KIND_BY_EXT 刻意**不完全一致**的两处：
 *  · gif 归 image（画廊里 <img> 直接播动图，比归 video 更符合直觉）；
 *  · md/txt 不收录（见文件头「doc 只收 Word 家族」）。
 */
const GALLERY_KIND_BY_EXT: Readonly<Record<string, GalleryKind>> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  bmp: 'image', avif: 'image', svg: 'image', ico: 'image', tif: 'image',
  tiff: 'image', heic: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio',
  html: 'page', htm: 'page', xhtml: 'page',
  pdf: 'pdf',
  ppt: 'slide', pptx: 'slide', odp: 'slide',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc',
}

/** 路径里的扩展名（小写、不带点）；没有则空串。 */
function extOf(path: string): string {
  const base = path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 路径 → 画廊类别；不在收录表内返回 null（不进画廊）。 */
export function galleryKindOf(path: string): GalleryKind | null {
  return GALLERY_KIND_BY_EXT[extOf(path)] ?? null
}

/** 一条画廊条目（提取层产物，尚未 stat 核对）。 */
export interface GalleryRawItem {
  /** 绝对路径（磁盘条目）或 spill 文件路径（generated 条目）。 */
  readonly path: string
  /** 文件名（上屏文案）。 */
  readonly name: string
  readonly kind: GalleryKind
  /** file = 磁盘上的成品；generated = 生图/生视频结果（spill 文件）。 */
  readonly source: 'file' | 'generated'
  /** 事件时间（毫秒）。 */
  readonly time: number
}

/** tool/call 事件的最小形状（按 callId 与 result 配对）。 */
export interface ToolCallEvent {
  readonly type: 'tool/call'
  readonly time: number
  readonly data: { readonly callId?: string; readonly name?: string; readonly arguments?: string }
}

/** tool/result 事件的最小形状。 */
export interface ToolResultEvent {
  readonly type: 'tool/result'
  readonly time: number
  readonly data: {
    readonly message?: {
      readonly toolCallId?: string
      readonly content?: ReadonlyArray<{ type?: string; text?: string }>
      readonly isError?: boolean
    }
  }
}

/** 结果消息里全部 text 块拼接（与 client resultText 同口径）。 */
function resultTextOf(event: ToolResultEvent): string {
  const parts: string[] = []
  for (const block of event.data?.message?.content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** 一次提取的上下文：会话工作区（相对路径基准）。 */
export interface ExtractContext {
  /** 会话 cwd（header.cwd / sessions 快照）；未知时相对路径条目被丢弃。 */
  readonly cwd: string | null
}

/** 去重键：分隔符与大小写归一（Windows 盘符大小写不敏感）。 */
export function galleryDedupeKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * 一对 tool/call + tool/result → 画廊条目（可能 0 条）。
 *
 * 与 outputs.ts 的 extractFromBlock 逐条同构（同样的白名单、同样的 spill /
 * _tmp 排除、同样的交付优先语义），差别只有三处：输入是事件对而不是
 * ToolCallBlock；相对路径按会话 cwd 解析成绝对路径（stat 与 raw 路由都需要）；
 * 类别按画廊口径收窄。
 *
 * @param call - tool/call 事件。
 * @param result - 配对的 tool/result 事件（null = 还没有结果，不收）。
 * @param context - 会话上下文（cwd）。
 * @returns 画廊条目（未去重、未核对存在性）。
 */
export function extractFromEventPair(
  call: ToolCallEvent,
  result: ToolResultEvent | null,
  context: ExtractContext,
): readonly GalleryRawItem[] {
  const rawName = typeof call.data?.name === 'string' ? call.data.name : ''
  const name = normalizeToolName(rawName)
  if (name === '' || DELETING_TOOLS.has(name)) return []
  if (result === null) return []
  // 失败的调用不产出成品（与 client 侧 isRunning/isError 跳过同口径）。
  if (result.data?.message?.isError === true) return []

  const delivered = name === 'present'
  const argsRaw = typeof call.data?.arguments === 'string' ? call.data.arguments : ''
  const args = argFields(argsRaw)
  const text = resultTextOf(result)
  const time = typeof result.time === 'number' ? result.time : (call.time ?? Date.now())

  const out: GalleryRawItem[] = []
  const seen = new Set<string>()

  const push = (path: string, source: 'file' | 'generated', kindOverride?: GalleryKind): void => {
    if (out.length >= MAX_PER_CALL) return
    const normalized = normalizeOutputPath(path)
    if (normalized === '') return
    // spill 临时文件不是磁盘成品；generated 条目单独走 locator 通道，不进这里。
    if (source === 'file' && SPILL_PATH_RE.test(normalized)) return
    // 相对路径按会话 cwd 解析；cwd 未知时丢弃（stat 不了的条目没有价值）。
    const abs = isAbsolute(normalized)
      ? resolve(normalized)
      : (context.cwd !== null && context.cwd !== '' ? resolve(context.cwd, normalized) : '')
    if (abs === '') return
    const kind = kindOverride ?? galleryKindOf(abs)
    if (kind === null) return
    // _tmp/ 中转：媒体成品豁免（与 client 侧 TRANSIENT_MEDIA_EXEMPT 同一取舍），
    // 其余类别不列 —— 清理器会把它清掉，列出来就是注定点不开。
    if (!delivered && source === 'file' && isTransientOutputPath(abs) && !TRANSIENT_MEDIA_EXEMPT.has(kind)) return
    const key = galleryDedupeKey(abs)
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      path: abs,
      name: outputNameOf(abs),
      kind,
      source,
      time,
    })
  }

  // 生图 / 生视频：结果被 spill 时记 locator 条目（磁盘上没有成品路径，
  // b64 在 spill 文件里，由客户端经 generated-images 路由解析）。
  if (name === 'generate_image' || name === 'generate_video') {
    const locator = findSpillLocator(text)
    if (locator !== undefined) {
      const kind: GalleryKind = name === 'generate_video' ? 'video' : 'image'
      push(locator, 'generated', kind)
    }
    return out
  }

  const paths: string[] = []

  // 路 1：参数里声明的目标路径（write/edit/download/present，最准）。
  if (ARG_PATH_TOOLS.has(name)) {
    for (const item of argPaths(args, 'file_path', 'filePath', 'path', 'paths', 'files', 'output', 'dest')) {
      paths.push(item)
    }
  }

  // 路 2：结果文本里带正向证据的成品路径（脚本落盘的唯一来源）。
  // 命令原文 = args.command（命令行工具）或 args.code（run_code），
  // 与 client 侧 extractFromBlock 的取法逐字一致。
  if (RESULT_PATH_TOOLS.has(name)) {
    const command = typeof args.command === 'string'
      ? args.command
      : (typeof args.code === 'string' ? args.code : '')
    for (const item of pathsFromResult(text, command)) paths.push(item)
  }

  for (const item of paths) push(item, 'file')
  return out
}

/** `tool/ptc-dispatch` 事件的最小形状（PTC 沙箱子调用）。 */
export interface PtcDispatchEvent {
  readonly type: 'tool/ptc-dispatch'
  readonly time: number
  readonly data: {
    readonly rootCallId?: string
    readonly subCallId?: string
    readonly name?: string
    /** 子调用参数：**已经是对象**（与 tool/call 的 JSON 字符串不同）。 */
    readonly arguments?: unknown
    readonly isError?: boolean
    readonly content?: ReadonlyArray<{ type?: string; text?: string }>
  }
}

/**
 * 一条 `tool/ptc-dispatch` 事件 → 画廊条目（可能 0 条）。
 *
 * 为什么要单独一条通道：run_code（PTC 沙箱）里 `await tools.present({...})` /
 * `tools.generate_image(...)` 这类子调用**不产生** tool/call 与 tool/result
 * 事件，只有这一条 dispatch 事件同时带着参数与结果。不认它，模型在代码体里
 * 显式交付的文件（present 的 path）就永远不在 `/raw` 的准入名单里 —— 产出物卡
 * 照常列出那一行（client 侧的产出物卡读的是同一批事件，能看见），点开却 403。
 *
 * 提取规则**不分叉**：把事件掰成 `tool/call` + `tool/result` 的形状，喂给
 * extractFromEventPair —— 白名单、落盘证据、_tmp 排除、交付优先全部同一份源码。
 *
 * `tool/ptc-dispatch-start`（子调用开始、还没有结果）刻意不认：那时结果为空，
 * 任何提取都是无源之水，只有最终态的 dispatch 是权威。
 *
 * @param event - tool/ptc-dispatch 事件。
 * @param context - 会话上下文（cwd）。
 * @returns 画廊条目（未去重、未核对存在性）。
 */
export function extractFromPtcDispatch(
  event: PtcDispatchEvent,
  context: ExtractContext,
): readonly GalleryRawItem[] {
  const data = event.data ?? {}
  const name = typeof data.name === 'string' ? data.name : ''
  if (name === '') return []
  const subCallId = typeof data.subCallId === 'string' && data.subCallId !== '' ? data.subCallId : ''
  const rootCallId = typeof data.rootCallId === 'string' ? data.rootCallId : ''
  const callId = subCallId !== '' ? subCallId : rootCallId
  // arguments 在事件里是对象：序列化回字符串走同一条通道（argFields 只吃 JSON 文本）。
  let rawArgs = ''
  try { rawArgs = JSON.stringify(data.arguments ?? {}) } catch { rawArgs = '' }
  return extractFromEventPair(
    { type: 'tool/call', time: event.time, data: { callId, name, arguments: rawArgs } },
    {
      type: 'tool/result',
      time: event.time,
      data: {
        message: {
          toolCallId: callId,
          content: data.content,
          // 失败的子调用不产出成品（与 tool/result 的 isError 同口径）。
          isError: data.isError === true,
        },
      },
    },
    context,
  )
}
