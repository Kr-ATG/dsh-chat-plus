/**
 * dsh-chat-plus — Soul 的提示词面：注入头部 + 蒸馏 prompt。
 *
 * 为什么把提示词单独成文件而不是散在引擎里：Soul 有两个方向完全不同的提示词——
 * 一条是「注入给主模型」的身份契约头部（极短、每会话常驻、措辞影响优先级语义），
 * 一条是「蒸馏时给整理模型」的抽取指令（长、一次性、措辞影响输出 JSON 的稳定性）。
 * 两者的调优节奏完全不同，混在注入引擎里改一个必然误伤另一个。
 */

import type { MemoryEntry } from '../memory/types.js'

/**
 * 灵魂通道的注入头部。
 *
 * 措辞里显式声明与项目指令的优先关系，理由与 zh 通道逐字同源：灵魂是**用户自己
 * 写的**顶层契约，它有权覆盖「模型默认人格」，但无权覆盖项目 AGENTS.md —— 项目
 * 指令是本工作区的硬约束，一个跨会话恒定的全局人设不该把某个仓库的规范顶掉。
 * 不写这句，模型在「灵魂说用英文、项目说用中文」时只能靠猜。
 */
export const SOUL_INJECTION_HEADER = [
  '【灵魂 · 内置通道】以下是用户的顶层身份契约（名字/角色/语气/语言/行为准则），跨会话恒定，优先于模型的默认人格设定。',
  '（若与当前项目的 AGENTS.md / 项目指令或系统提示冲突，一律以项目指令为准。）',
].join('\n')

/** 蒸馏超时（毫秒）。60s：输入最多几十条短文本，慢模型也够；再长用户已经走开了。 */
export const SOUL_DISTILL_TIMEOUT_MS = 60_000

/** 蒸馏输入上限（条数）。条目再多也只取最相关的一批，避免 prompt 膨胀到超时。 */
export const SOUL_DISTILL_MAX_ENTRIES = 40

/**
 * 蒸馏候选筛选：只取「高价值身份/偏好」。
 *
 * 条件刻意收紧到 kind ∈ {identity, preference} 且 layer=long：
 * 灵魂是**身份契约**，不是项目事实的合集；把 fact/decision/gotcha 也喂进去，
 * 模型会产出「本仓库用 pnpm」这类事实性人设——那不是灵魂，是项目记忆，
 * 而且会随项目切换而过时。
 *
 * importance 下限取 8 而非 config.minImportance（默认 7）：提取 prompt 里
 * 「低于 8 视为会话级噪音」是同一口径，两个数字必须对齐，否则会拿一批
 * 模型自己都判定为噪音的条目去蒸馏人格。
 *
 * projectHash 给定时只保留「global + 该项目」的条目（与注入可见性同口径）；
 * 不给（面板未指定项目）时全部纳入。
 */
export function selectDistillEntries(
  entries: MemoryEntry[],
  options: { projectHash?: string | null; minImportance?: number; max?: number } = {},
): MemoryEntry[] {
  const minImportance = options.minImportance ?? 8
  const max = options.max ?? SOUL_DISTILL_MAX_ENTRIES
  const visible = entries.filter(entry =>
    entry.deprecated !== true
    && entry.disabled !== true
    && entry.importance >= minImportance
    && (entry.kind === 'identity' || entry.kind === 'preference')
    && entry.layer === 'long'
    && (entry.scope === 'global'
      || options.projectHash === undefined || options.projectHash === null
      || entry.projectHash === options.projectHash))
  // 排序：置顶优先 → 重要度降序 → 新近度降序。稳定序保证同一库两次蒸馏
  // 拿到同一批输入（否则用户会看到「同样的记忆蒸馏出不同的灵魂」）。
  return [...visible].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (b.importance !== a.importance) return b.importance - a.importance
    return b.updatedAt.localeCompare(a.updatedAt)
  }).slice(0, max)
}

/** 蒸馏 system prompt：只依据给定条目、不得虚构、输出严格 JSON。 */
export function soulDistillSystemPrompt(): string {
  return [
    'You distill a compact "soul contract" (identity + behavioral principles) for an AI assistant from a list of the user\'s long-term memory entries.',
    'Return ONLY a JSON object in this exact shape (no markdown fence, no commentary):',
    '{"content":"...","identity":{"name":"...","role":"...","tone":"...","language":"...","principles":["..."]},"notes":"..."}',
    'Hard rules:',
    '- Base EVERY statement on the provided entries ONLY. Never invent facts, names, tools, employers, projects, or preferences that the entries do not state.',
    '- If the entries do not support a field, leave that field as an empty string (or an empty array for principles). An empty field is correct; a guessed field is a defect.',
    '- content: a short markdown persona contract in the SAME LANGUAGE as the entries (usually Chinese), 5-15 lines. It must be directly usable as a system-level identity: who the assistant is, how it speaks, and which behavioral rules it follows.',
    '- identity.name: only fill it when the entries actually give a name the user wants to be called or the assistant to use; otherwise empty string.',
    '- identity.principles: 3-8 imperative one-line rules derived from the entries (e.g. "先给结论再给依据"), ordered by importance.',
    '- notes: one short sentence (same language) describing what you dropped or could not infer. Optional.',
    '- Do NOT include project-specific facts (dependency choices, repo layout, one-off debugging results) unless they express a durable preference.',
  ].join('\n')
}

/** 蒸馏 user prompt：把候选条目以 JSON 包裹传入（防条目内容破坏结构）。 */
export function soulDistillUserPrompt(entries: MemoryEntry[]): string {
  const payload = entries.map(entry => ({
    content: entry.content,
    kind: entry.kind,
    scope: entry.scope,
    importance: entry.importance,
    pinned: entry.pinned,
    tags: entry.tags,
  }))
  return [
    `Distill a soul contract from these ${payload.length} memory entries (JSON array):`,
    JSON.stringify(payload, null, 2),
  ].join('\n')
}
