/**
 * dsh-memory 编译引擎：把 entries 渲染成分层 md 产物并组装注入文本。
 * - 注入文本（热路径）：identity + memory + pinned + facts 组装为带来源的 user message，
 *   全程在内存里现算，不依赖任何磁盘产物
 * - 落盘 md 产物：memory.md / facts.md / pinned.md / identity.md **不再自动生成**，
 *   只在显式调用 writeExportArtifacts 时导出（全仓零读取方，见该函数注释）
 * - 每日：daily/<date>.md（openhanako 同款格式，跨项目）
 */

import type { MemoryConfig, MemoryEntry } from '../types.js'
import { isInjectionEligible, injectionRank, shouldPromote } from './scoring.js'
import { localDate, projectHashOf, type MemoryStore } from './store.js'

/** 身份/偏好类标签。 */
const IDENTITY_TAGS = ['身份', 'identity', '偏好', 'preference', '风格', 'style', '人格', 'persona', '习惯', 'habit']

/** 事实类标签。 */
const FACT_TAGS = ['事实', 'fact', '信息', 'info', '要点', 'key', '背景', 'context']

/** 分组标题（时间线）。 */
export type TimeGroup = 'today' | 'week' | 'earlier' | 'longterm'

/** 按时间把条目分组。 */
export function groupEntries(entries: MemoryEntry[], now = new Date()): Record<TimeGroup, MemoryEntry[]> {
  const groups: Record<TimeGroup, MemoryEntry[]> = {
    today: [],
    week: [],
    earlier: [],
    longterm: [],
  }
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const entry of entries) {
    if (entry.layer === 'long') {
      groups.longterm.push(entry)
      continue
    }
    const time = Date.parse(entry.updatedAt)
    if (Number.isNaN(time)) {
      groups.earlier.push(entry)
      continue
    }
    const days = Math.floor((startOfDay - time) / 86_400_000)
    if (days <= 0) groups.today.push(entry)
    else if (days < 7) groups.week.push(entry)
    else groups.earlier.push(entry)
  }
  return groups
}

/** 单条 md 行。 */
function entryLine(entry: MemoryEntry): string {
  const tagText = entry.tags.length > 0 ? ` \`${entry.tags.join('` `')}\`` : ''
  const score = entry.importance >= 10 ? '' : ` [${entry.importance}]`
  return `- ${entry.content.replace(/\n/g, ' ')}${score}${tagText}`
}

/** 渲染 timeline（短期分组 + 长期沉淀）。 */
export function renderTimeline(entries: MemoryEntry[]): string {
  const groups = groupEntries(entries)
  const lines: string[] = ['# 记忆时间线']
  const pushGroup = (title: string, list: MemoryEntry[]): void => {
    if (list.length === 0) return
    lines.push(`\n## ${title}`)
    for (const entry of list) lines.push(entryLine(entry))
  }
  pushGroup('今天', groups.today)
  pushGroup('本周', groups.week)
  pushGroup('更早', groups.earlier)
  pushGroup('长期沉淀', groups.longterm)
  return lines.join('\n')
}

/** 渲染 identity（全局层身份/偏好条目）。空集返回空串（不留只有标题的孤儿产物）。 */
export function renderIdentity(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['# 用户身份与偏好']
  for (const entry of entries) {
    lines.push(entryLine(entry))
  }
  return lines.join('\n')
}

/** 渲染 facts。 */
export function renderFacts(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['# 事实']
  for (const entry of entries) lines.push(entryLine(entry))
  return lines.join('\n')
}

/** 渲染 pinned。 */
export function renderPinned(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['# 置顶']
  for (const entry of entries) lines.push(entryLine(entry))
  return lines.join('\n')
}

/** 身份/偏好判定（显式 kind 优先，回退标签匹配）。 */
export function isIdentityEntry(entry: MemoryEntry): boolean {
  if (entry.scope !== 'global') return false
  if (entry.kind === 'identity' || entry.kind === 'preference') return true
  return entry.tags.some(tag => IDENTITY_TAGS.includes(tag.toLowerCase()))
}

/**
 * 事实判定：优先看显式 kind（schema v2），其次事实标签，最后才回退重要性。
 * 旧实现只看 `importance >= 8`——初始 importance 就是 10，等于「几乎所有条目
 * 都是事实」，facts.md 与 memory.md 内容重复。
 */
export function isFactEntry(entry: MemoryEntry): boolean {
  if (entry.pinned) return false
  if (entry.kind === 'identity' || entry.kind === 'preference') return false
  if (entry.kind === 'fact' || entry.kind === 'decision' || entry.kind === 'gotcha') return true
  if (entry.tags.some(tag => FACT_TAGS.includes(tag.toLowerCase()))) return true
  return entry.importance >= 8
}

/** 全局层编译产物。 */
export function compileGlobalArtifacts(entries: MemoryEntry[]): { identity: string; facts: string; pinned: string } {
  const identity = entries.filter(isIdentityEntry)
  const facts = entries.filter(entry => entry.scope === 'global' && !isIdentityEntry(entry) && isFactEntry(entry))
  const pinned = entries.filter(entry => entry.scope === 'global' && entry.pinned)
  return {
    identity: renderIdentity(identity),
    facts: renderFacts(facts),
    pinned: renderPinned(pinned),
  }
}

/** 项目层编译产物。 */
export function compileProjectArtifacts(entries: MemoryEntry[]): { memory: string; facts: string; pinned: string } {
  const facts = entries.filter(entry => isFactEntry(entry) && !entry.pinned)
  const pinned = entries.filter(entry => entry.pinned)
  return {
    memory: renderTimeline(entries),
    facts: renderFacts(facts),
    pinned: renderPinned(pinned),
  }
}

/** 每日日志（跨项目全局；openhanako 同款格式）。 */
export function renderDaily(date: string, changes: Array<{ action: string; summary: string; scope: string }>): string {
  const lines: string[] = [`# ${date} 记忆日志`, '']
  if (changes.length === 0) {
    lines.push('（无新记忆）')
  } else {
    for (const change of changes) {
      const badge = change.action === 'add' ? '新增' : change.action === 'promote' ? '沉淀' : '更新'
      const scope = change.scope === 'global' ? '全局' : '项目'
      lines.push(`- [${badge}][${scope}] ${change.summary}`)
    }
  }
  return lines.join('\n')
}

/** 注入产物组装（design §5.4：全局 identity + 项目 memory + pinned + facts，带 token 截断）。 */
export interface InjectionSections {
  identity: string
  memory: string
  pinned: string
  facts: string
}

/**
 * 组装注入文本与 sections。
 *
 * 预算分两段：pinned 先吃，但**有上限**（config.injectPinnedBudgetRatio，默认 40%）；
 * 装不下的置顶不丢弃，退回普通候选池按 importance 抢剩余预算——旧实现让 pinned
 * 全额先扣，实测本机 6 条置顶吃掉 3000 预算里的 2130（71%），identity 段被挤到
 * 只剩 1 条、检索 top-k 一条都进不去，置顶从「强调重点」退化成「把其它记忆饿死」。
 *
 * 普通池（不是"每段只取一条"）按归属分入 identity / memory / facts 三段，按重要性
 * 降序逐条累积直到 token 预算耗尽。段头（[记忆·xxx]）本身也计入预算。
 *
 * @param entries - 注入可见条目（pinned + 检索命中）。
 * @param config - 注入预算与 pinned 占比上限。
 */
export function buildInjectionText(
  entries: MemoryEntry[],
  config: MemoryConfig,
): { text: string; sections: Array<{ name: string; text: string }> } {
  const budget = Math.max(1000, config.injectTokenBudget)
  const buckets: Record<keyof InjectionSections, string[]> = { identity: [], memory: [], pinned: [], facts: [] }
  const pinned = entries.filter(entry => entry.pinned)
  // 缺字段时回退 0.4 而不是 1：手拼的 config 或旧 config.json 里没有这个字段时，
  // 绝不能静默退回「pinned 全额先扣」那个已经被实测证明会饿死其它记忆的旧行为。
  const pinnedRatio = Number.isFinite(config.injectPinnedBudgetRatio) ? config.injectPinnedBudgetRatio : 0.4
  const pinnedQuota = Math.max(0, Math.floor(budget * pinnedRatio))
  // 置顶区块不带「# 置顶」二级标题：[记忆·置顶] 分组头已标识归属，
  // 双重标志对模型纯冗余（renderPinned 的带标题版本仅供显式导出使用）。
  //
  // 额度是硬上限：占满后剩下的置顶退回普通池参与竞争，而不是直接丢弃——
  // 「置顶」表达的是用户想强调，不等于它比别的高价值记忆更重要，被额度挤下来的
  // 那几条仍有资格按 importance 去抢剩下的预算。
  let used = 0
  const demoted: MemoryEntry[] = []
  for (const entry of [...pinned].sort((a, b) => injectionRank(b) - injectionRank(a))) {
    const line = entryLine(entry)
    if (used + line.length + 1 > pinnedQuota) {
      demoted.push(entry)
      continue
    }
    used += line.length + 1
    buckets.pinned.push(line)
  }

  // 其余按重要性降序（含被置顶额度挤下来的），逐条计入预算。
  const rest = entries
    .filter(entry => !entry.pinned)
    .concat(demoted)
    .sort((a, b) => injectionRank(b) - injectionRank(a))
  for (const entry of rest) {
    const section: keyof InjectionSections = entry.scope === 'global'
      ? (isIdentityEntry(entry) ? 'identity' : 'facts')
      : 'memory'
    const line = entryLine(entry)
    // 该段首次落内容时，段头也要算进预算。
    const headerCost = buckets[section].length === 0 ? sectionHeader(section).length + 3 : 0
    if (used + line.length + 1 + headerCost > budget) continue
    used += line.length + 1 + headerCost
    buckets[section].push(line)
  }

  const sections: InjectionSections = {
    identity: buckets.identity.join('\n'),
    memory: buckets.memory.join('\n'),
    pinned: buckets.pinned.join('\n'),
    facts: buckets.facts.join('\n'),
  }
  const order: Array<keyof InjectionSections> = ['identity', 'memory', 'pinned', 'facts']
  const outSections = order
    .filter(name => sections[name] !== '')
    .map(name => ({ name: sectionHeader(name), text: sections[name] }))
  const text = outSections.map(section => `[${section.name}]\n${section.text}`).join('\n\n')
  return { text, sections: outSections }
}

function sectionHeader(section: keyof InjectionSections): string {
  switch (section) {
    case 'identity': return '记忆·身份偏好'
    case 'memory': return '记忆·项目'
    case 'pinned': return '记忆·置顶'
    case 'facts': return '记忆·事实'
  }
}

/**
 * 全量编译入口：**不再写任何 md 产物**（2026-10-18 起）。
 *
 * 为什么停写：memory.md / facts.md / pinned.md / identity.md 这 6 个产物
 * （项目层 3 个 + 全局层 3 个）全仓零读取方——注入走 buildInjectionText 在内存里
 * 现算，面板走 API 直接读 entries.json，没有任何代码或界面读过这些文件。而
 * compileAll 有 27 个调用点（每次提取、每轮 ticker、面板每次置顶/启用/编辑、整理、
 * 每日编译），每个都把全部条目重新渲染成 1.7MB 文本再原子写盘：纯 IO 与 CPU
 * 开销，收益为零。
 *
 * 为什么保留成空函数而不是删掉调用点：调用点分属 api / ticker / tools /
 * consolidate / index，它们并不关心「产物是否落盘」，改签名只会制造一堆无关改动。
 * 真要落盘时走 writeExportArtifacts（显式导出）。
 *
 * 注意：磁盘上可能还留着上一版产物文件（陈旧内容）。它们不会被自动更新，也不会
 * 被读取；需要一份准确的快照就调 writeExportArtifacts 覆盖。
 */
export async function compileAll(_store: MemoryStore, _config: MemoryConfig): Promise<void> {
  // 空实现是刻意的：27 个调用点分属 api / ticker / tools / consolidate / index，
  // 改签名会让它们全部报错，而它们本来也不该关心「产物是否落盘」。
  // 保留成一个立即返回的 async 函数，调用点零改动，开销归零。
}

/**
 * 显式导出 md 产物（按需生成，不再挂在 compileAll 上）。
 *
 * 用途：用户/调试需要一份人类可读的记忆快照时（导出、离线查看、手工比对）。
 * 日常运行路径**不调用**它——理由见 compileAll 注释。
 *
 * disabled / deprecated 条目一律不导出（与注入口径一致）。这条口径从 compileAll
 * 迁到这里：它是唯一真正落盘的路径，规则必须跟着写盘走，不能留在空函数里当摆设。
 *
 * 第二个形参与 compileAll 保持一致，方便调用方在两者之间替换；当前实现不需要它。
 */
export async function writeExportArtifacts(store: MemoryStore, _config: MemoryConfig): Promise<void> {
  const all = await store.readEntries()
  const entries = all.filter(entry => entry.disabled !== true && entry.deprecated !== true)
  const byProject = new Map<string, MemoryEntry[]>()
  for (const entry of entries) {
    if (entry.scope !== 'project' || entry.projectHash === null) continue
    const list = byProject.get(entry.projectHash) ?? []
    list.push(entry)
    byProject.set(entry.projectHash, list)
  }
  for (const [hash, owned] of byProject) {
    await store.writeProjectArtifacts(hash, compileProjectArtifacts(owned))
  }
  // 条目被删光 / 全部废弃的项目：把上一版产物抹成空文件。
  // 旧实现只写「还有活跃条目」的项目，于是删干净的项目磁盘上永远留着
  // memory.md / facts.md —— 已删除的记忆在产物里阴魂不散。
  const emptied = (await store.listProjectHashes()).filter(hash => !byProject.has(hash))
  for (const hash of emptied) {
    await store.writeProjectArtifacts(hash, { memory: '', facts: '', pinned: '' })
  }
  const global = entries.filter(entry => entry.scope === 'global')
  await store.writeGlobalArtifacts(compileGlobalArtifacts(global))
}

/** 从 entries 中选注入可见条目（short 层按阈值过滤 + 排序）。 */
export function selectInjectionEntries(entries: MemoryEntry[], threshold: number): MemoryEntry[] {
  return entries
    .filter(entry => isInjectionEligible(entry, threshold))
    .sort((a, b) => injectionRank(b) - injectionRank(a))
}
/**
 * CJK 表意文字判定：基本区 + 扩展 A + 兼容表意文字。
 * 只认汉字，不认假名/谚文——「中文记忆」要的是中文写的那条，不是「含任一
 * 东亚文字就算数」。
 */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/**
 * 该条目是否属于「中文记忆」。
 *
 * 判定＝**类型 + 文字**双条件：kind 必须是 preference/identity（用户偏好与
 * 身份），且正文含汉字。只按文字判会把满库的 fact/gotcha（104 条里 97 条都是
 * 中文）全捞进来，那就不是「只注入中文记忆」而是「全量注入」；只按 kind 判
 * 又会漏掉用英文写的偏好条目。两者取交集才是「中文偏好记忆」这个语义。
 *
 * 纯函数，无 IO，面板与注入共用。
 */
export function isChineseMemoryEntry(entry: MemoryEntry): boolean {
  if (entry.kind !== 'preference' && entry.kind !== 'identity') return false
  return CJK_RE.test(entry.content)
}

/**
 * 选出注入可见范围内的中文记忆条目（按 importance 降序）。
 *
 * 与主注入的可见性口径一致：disabled / deprecated 一律排除；scope 只取
 * global 与当前工作区（别的项目的项目层记忆不该出现在这里）。唯一区别是
 * **不看项目排除设置**——中文通道按设计就该无视它。
 */
export function selectChineseEntries(
  entries: MemoryEntry[],
  projectHash: string | null,
): MemoryEntry[] {
  return entries
    .filter(entry => entry.disabled !== true && entry.deprecated !== true)
    .filter(entry => entry.scope === 'global' || (entry.scope === 'project' && entry.projectHash === projectHash))
    .filter(isChineseMemoryEntry)
    .sort((a, b) => injectionRank(b) - injectionRank(a))
}

/**
 * 渲染中文记忆注入文本。
 *
 * 不用 buildInjectionText：那一套按 identity/memory/pinned/facts 四段分桶，
 * 段头是「记忆·身份偏好」这类通用措辞；中文通道要的是一眼可辨的独立区块，
 * 混进主注入的四段里会让模型分不清哪块是强制中文偏好。故独立成段。
 *
 * 超预算时按 importance 降序**保留靠前的**（continue 而非 break，与主注入
 * 同款：不因一条超长就丢掉后面所有条目）。
 */
export function buildChineseInjectionText(entries: MemoryEntry[], budget: number): string {
  const head = '[中文偏好记忆 · 内置通道]'
  let used = head.length + 1
  const lines: string[] = []
  for (const entry of entries) {
    const line = `- ${entry.content.trim()}`
    if (used + line.length + 1 > budget) continue
    used += line.length + 1
    lines.push(line)
  }
  if (lines.length === 0) return ''
  return `${head}\n${lines.join('\n')}`
}

/** 当前工作区项目 hash（会话 cwd 判定；取不到返回 null → 调用方回退 global）。 */
export function workspaceHashOf(header: { cwd?: string } | undefined): string | null {
  const cwd = header?.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  return projectHashOf(cwd)
}

/** 今日变更的 md 日志文本（写 daily）。 */
export async function writeDailyLog(store: MemoryStore, date = localDate()): Promise<void> {
  const changes = await store.readChanges(date)
  const summary = changes.map(change => ({
    action: change.action,
    summary: change.summary,
    scope: change.scope,
  }))
  await store.writeArtifact(`daily/${date}.md`, renderDaily(date, summary))
}

/** 促进短期条目到长期层（每日编译时调用）。 */
export function promoteEntries(entries: MemoryEntry[], threshold: number): { promoted: MemoryEntry[]; remaining: MemoryEntry[] } {
  const promoted: MemoryEntry[] = []
  const remaining: MemoryEntry[] = []
  for (const entry of entries) {
    if (shouldPromote(entry, threshold)) {
      promoted.push({ ...entry, layer: 'long' })
    } else {
      remaining.push(entry)
    }
  }
  return { promoted, remaining }
}
