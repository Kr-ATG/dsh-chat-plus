/**
 * dsh-chat-plus — 「系统提示词」页面数据层（浏览器半身）。
 *
 * ── 这一页在回答什么问题 ──────────────────────────────────────────────
 * 「我发一句话出去的时候，模型到底先被交代了什么？」—— 不是「DSH 有什么功能」，
 * 而是**这一次、这个会话、这一步**真实带上的那一段 system 文本。
 *
 * ── 数据从哪来 ────────────────────────────────────────────────────────
 * 只从宿主那条只读路由取（/api/chat-flow/system-prompt）：提示词在浏览器侧
 * 根本不存在，它是宿主每个 step 现组装出来的，还要经过本插件工具闸门那一层
 * 出口过滤。前端不做任何推断、不缓存成第二份真相 —— 拿不到就如实说拿不到。
 *
 * ── 为什么类型全部 type-only 引宿主侧 ─────────────────────────────────
 * 快照形状（PromptSnapshot / PromptSectionView）是这个页面的核心契约，前端另
 * 写一份迟早漂移（宿主加一个字段 → 页面静默渲染 undefined）。所以直接复用
 * src/system-prompt/index.ts 的类型。⚠ 那边只有 type 与纯常量，没有 node:
 * 运行时导入，esbuild 会把它们原地擦掉，不会把宿主代码拖进浏览器产物。
 *
 * @module
 */

import type {
  PromptRouteResponse,
  PromptSnapshot,
  PromptSectionView,
  PromptSessionSummary,
} from '../../../system-prompt/index.js'

/** 只读路由（与宿主 SYSTEM_PROMPT_ROUTE 逐字一致）。 */
export const SYSTEM_PROMPT_API = '/api/chat-flow/system-prompt'

export type { PromptRouteResponse, PromptSnapshot, PromptSectionView, PromptSessionSummary }

/** 一次查询的结果（页面只认这三种状态，别的都归到 error）。 */
export interface PromptFetchResult {
  readonly ok: boolean
  /** 快照（null = 没取到，原因在 reason 里）。 */
  readonly prompt: PromptSnapshot | null
  /** 宿主内存里有哪些会话的快照（用于下拉选择）。 */
  readonly sessions: readonly PromptSessionSummary[]
  /** 这次实际返回的是哪个会话。 */
  readonly active: string | null
  /** 没取到时的人话原因（宿主直接给的中文句子）。 */
  readonly reason: string
}

/**
 * 拉一次快照。
 *
 * @param sessionId - 目标会话；空串 = 让宿主回「最近一次组装」的那份。
 * @param options.fresh - true = 跳过宿主的缓存、按当前开关重新组装一份
 *   （「刷新」按钮用；首屏用 false，命中缓存更快）。
 * @returns 统一形状的结果（**永不抛**：页面把它当状态渲染，不当作异常）。
 */
export async function fetchSystemPrompt(
  sessionId: string,
  options: { fresh?: boolean } = {},
): Promise<PromptFetchResult> {
  const params: string[] = []
  if (sessionId !== '') params.push('session=' + encodeURIComponent(sessionId))
  if (options.fresh === true) params.push('fresh=1')
  const query = params.length === 0 ? '' : '?' + params.join('&')
  try {
    const response = await fetch(SYSTEM_PROMPT_API + query, { cache: 'no-store' })
    if (!response.ok) {
      return {
        ok: false,
        prompt: null,
        sessions: [],
        active: null,
        reason: '宿主路由返回 ' + response.status + '（插件可能还没重启，或版本不匹配）',
      }
    }
    const body = (await response.json()) as PromptRouteResponse | null
    if (body === null || typeof body !== 'object') {
      return { ok: false, prompt: null, sessions: [], active: null, reason: '宿主返回的不是 JSON' }
    }
    return {
      ok: body.prompt !== null,
      prompt: body.prompt ?? null,
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
      active: body.active ?? null,
      reason: typeof body.reason === 'string' ? body.reason : '',
    }
  } catch (error) {
    return {
      ok: false,
      prompt: null,
      sessions: [],
      active: null,
      reason: '连不上宿主路由：' + (error instanceof Error ? error.message : String(error)),
    }
  }
}

/**
 * 会话 id → 给人看的短名。
 *
 * 会话 id 本身是一长串 hex，直接铺在页面上没人读得懂；而**真正的会话标题**在
 * 客户端侧没有一条稳定通道（不同版本分别叫 sessionTitle / rename / snapshot
 * 字段），硬猜会得到一个「有时候有、有时候没有」的标题。所以这里只做一件事：
 * 取末 6 位当标识，让用户能把它跟侧栏里那条对上，不假装知道标题。
 *
 * @param sessionId - 完整会话 id。
 * @returns 短标识。
 */
export function shortSessionId(sessionId: string): string {
  const trimmed = sessionId.trim()
  if (trimmed === '') return '（无）'
  return trimmed.length <= 8 ? trimmed : trimmed.slice(-6)
}

/** 时间戳 → 「刚刚 / N 分钟前 / HH:MM」。 */
export function formatPromptTime(at: number, now = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const delta = Math.max(0, now - at)
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return Math.round(delta / 60_000) + ' 分钟前'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  if (delta < 86_400_000) return pad(date.getHours()) + ':' + pad(date.getMinutes())
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 '
    + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 千分位（字符数 / token 数都要读起来不费劲）。 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('en-US')
}

/**
 * 段名 → 中文标签。
 *
 * 官方段名是「命名空间:名字」的形式（harness:identity / tool:pwsh /
 * deployment:persona-prefix…）。页面给**原文段名**（它是唯一能拿去 grep 的
 * 标识），同时在旁边补一句中文说明，让不懂这套命名的人也能看懂这一行是什么。
 * 只覆盖本机实际会出现的那批；未知段名原样显示，不硬猜。
 */
const SECTION_LABELS: Readonly<Record<string, string>> = {
  'harness:identity': '身份声明',
  'deployment:persona-prefix': '部署人设（前）',
  'deployment:persona-suffix': '部署人设（后）',
  'harness:source': '源码位置',
  'web:surface': '网页界面',
  'file-reference': '文件引用规则',
  'plan:policy': '计划模式',
  'team:policy': '团队协作',
  'ptc:only': 'PTC 约束',
  'tools-gate:offline': '关闭的能力',
}

/** 段名里的前缀（tool:pwsh 的 tool: 那一段）对应的一句人话。 */
const SECTION_PREFIX_LABELS: Readonly<Record<string, string>> = {
  'tool:': '工具说明',
  'mcp:': 'MCP 服务',
  'computer-use:': '电脑操作',
  'skill:': '技能',
}

/**
 * 段名 → 中文说明（未知段名返回空串，页面就不显示那半句）。
 *
 * @param name - 官方注册名。
 * @returns 中文说明。
 */
export function sectionLabelOf(name: string): string {
  const exact = SECTION_LABELS[name]
  if (exact !== undefined) return exact
  const colon = name.indexOf(':')
  if (colon > 0) {
    const prefix = name.slice(0, colon + 1)
    const label = SECTION_PREFIX_LABELS[prefix]
    if (label !== undefined) return label
  }
  return ''
}

/* ───────────────────────── 分段分类（「详细」tab 用） ───────────────────────── */

/** 一个分类的 id（顺序即页面上的展示顺序）。 */
export type SectionGroupId = 'identity' | 'tools' | 'context' | 'ui' | 'other'

/** 分类定义。 */
export interface SectionGroup {
  readonly id: SectionGroupId
  /** 分类名（页面上的小标题）。 */
  readonly label: string
  /** 一句说明：这一类在提示词里干什么活。 */
  readonly desc: string
  /** 这一类的段（按原组装顺序）。 */
  readonly sections: readonly PromptSectionView[]
  /** 这一类的总字符数（分类头右侧显示）。 */
  readonly chars: number
}

/**
 * 分类的展示顺序与文案。
 *
 * 为什么按「身份 → 工具 → 上下文 → 界面 → 其它」而不是按组装顺序：组装顺序是
 * 官方的实现细节（段名带命名空间前缀、按 order 数值排），用户拿它当导航会看
 * 到「team:policy 夹在 persona 和工具之间」这种彼此无关的相邻关系。分类回答的
 * 是「这一段属于哪一类交代」，与顺序无关；每类内部仍保持原始顺序，所以真要
 * 对照模型收到的先后，切到「全文」tab 就是原文。
 */
export const SECTION_GROUPS: readonly { readonly id: SectionGroupId; readonly label: string; readonly desc: string }[] = [
  { id: 'identity', label: '身份与人设', desc: '模型以什么身份开工：身份声明、部署人设、团队协作、计划与 PTC 约束。' },
  { id: 'tools', label: '工具说明', desc: '每个工具该怎么用、什么场合用。工具 schema 本身在页面底部的工具清单里。' },
  { id: 'context', label: '文件与上下文', desc: '引用文件、会话查询、工作目录这类「读什么、按什么路径读」的交代。' },
  { id: 'ui', label: '界面与交付', desc: '当前界面形态、交付物引用、源码位置这些与环境相关的说明。' },
  { id: 'other', label: '其它', desc: '上面几类都没收录的段（官方或别的插件新加的段会落在这里）。' },
]

/**
 * 段名 → 分类。
 *
 * 判据只用**段名前缀**与少量精确名，不看正文：段正文会随开关、模型、工作目录
 * 变化，拿它分类会让同一段在两次刷新之间跳来跳去。前缀是官方注册时写死的，
 * 稳定。
 *
 * @param name - 官方注册名。
 * @returns 分类 id。
 */
export function sectionGroupOf(name: string): SectionGroupId {
  // 工具说明：官方每个工具一段（tool:pwsh / tool:read…），MCP 服务同理。
  if (name.startsWith('tool:') || name.startsWith('tool.') || name.startsWith('mcp:')) return 'tools'
  if (name === 'tools:sdk' || name === 'tools:ptc-only' || name === 'tools-gate:offline') {
    // tools:sdk 是「有哪些工具」的清单式交代，与「每个工具怎么用」并列在工具类；
    // tools-gate:offline 是「这些工具当前关着」的提示，同属工具话题。
    return 'tools'
  }
  // 文件与上下文
  if (name.startsWith('context:') || name.startsWith('session:') || name.startsWith('working-directory:')) return 'context'
  if (name === 'file-reference' || name === 'session-reference') return 'context'
  // 界面与交付
  if (name.startsWith('ui:') || name.startsWith('app:') || name.startsWith('web:')) return 'ui'
  if (name === 'harness:source') return 'ui'
  // 身份与人设
  if (name.startsWith('harness:') || name.startsWith('deployment:') || name.startsWith('team:')) return 'identity'
  if (name === 'plan:policy' || name === 'ptc:only') return 'identity'
  return 'other'
}

/**
 * 把分段按类别分组（空类不出现）。
 *
 * @param sections - 快照里的分段（原始顺序）。
 * @returns 按 SECTION_GROUPS 顺序排好的分类，每类内部保持原顺序。
 */
export function groupSections(sections: readonly PromptSectionView[]): SectionGroup[] {
  const buckets = new Map<SectionGroupId, PromptSectionView[]>()
  for (const section of sections) {
    const id = sectionGroupOf(section.name)
    const bucket = buckets.get(id)
    if (bucket === undefined) buckets.set(id, [section])
    else bucket.push(section)
  }
  const groups: SectionGroup[] = []
  for (const meta of SECTION_GROUPS) {
    const list = buckets.get(meta.id)
    if (list === undefined || list.length === 0) continue
    groups.push({
      ...meta,
      sections: list,
      chars: list.reduce((sum, section) => sum + section.chars, 0),
    })
  }
  return groups
}

/**
 * 一段正文 → 预览片段（列表折叠态那一行）。
 *
 * 换行压成空格、连续空白压成一个：折叠态只该有一行，带着原始缩进会让那一行
 * 看起来像缩进坏了。
 *
 * @param text - 段正文。
 * @param limit - 最多多少字。
 * @returns 单行片段。
 */
export function previewOf(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit) + '…'
}

/** 复制到剪贴板（失败静默返回 false，由页面给一句提示）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 落到下面的兜底 */ }
  try {
    if (typeof document === 'undefined') return false
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** 把整份快照导成可读文本（复制 / 下载都用它，只有一份真相）。 */
export function snapshotToText(snapshot: PromptSnapshot): string {
  const LF = String.fromCharCode(10)
  const lines: string[] = []
  lines.push('# 系统提示词快照')
  lines.push('')
  lines.push('会话：' + snapshot.sessionId)
  if (snapshot.cwd !== null) lines.push('工作目录：' + snapshot.cwd)
  lines.push('抓取时间：' + new Date(snapshot.at).toLocaleString('zh-CN'))
  lines.push('来源：' + (snapshot.source === 'live' ? '现场组装（活会话）' : '真实请求出口'))
  lines.push('规模：' + formatCount(snapshot.chars) + ' 字符 · 约 ' + formatCount(snapshot.tokens) + ' token')
  lines.push('工具：' + formatCount(snapshot.tools.count) + ' 个 · 约 ' + formatCount(snapshot.tools.tokens) + ' token')
  lines.push('')
  lines.push('## 提示词正文（' + snapshot.sections.length + ' 段）')
  lines.push('')
  lines.push(snapshot.text)
  if (snapshot.contextText !== '') {
    lines.push('')
    lines.push('## 运行时上下文（作为 user 消息注入，不是 system 的一部分）')
    lines.push('')
    lines.push(snapshot.contextText)
  }
  if (snapshot.tools.names.length > 0) {
    lines.push('')
    lines.push('## 工具清单（' + snapshot.tools.count + ' 个）')
    lines.push('')
    lines.push(snapshot.tools.names.join(', '))
  }
  return lines.join(LF)
}
