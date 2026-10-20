/**
 * dsh-memory 检索引擎（本地 hybrid + 可选 semantic）。
 *
 * 背景：DSH 的 llm 服务当前只暴露 stream()（chat completion），无 embedding 接口，
 * 因此「embedding 语义检索」由本插件的 embedding.ts 提供（http / local 两种模式，
 * 参考 opencontext 的做法）。未配置 embedding 时 semantic 回退 hybrid，行为与旧版
 * 完全一致（零依赖兜底）。
 *
 * 检索模式：
 *  - keyword：query 各词全部子串命中（AND，精确）。
 *  - hybrid（默认）：字符 n-gram Jaccard 相似度 + 精确命中加成 + 元数据加权
 *    （verified / confidence / importance）。
 *  - semantic：query 与条目的向量余弦（embedding 缓存）+ n-gram 加权融合；
 *    embedding 不可用时回退 hybrid。
 *
 * 软废弃（schema v3）：deprecated 条目默认不参与检索（除非 includeDeprecated）。
 */

import type { MemoryEntry } from '../types.js'
import { type EmbeddingProvider, normalizedCosine } from './embedding.js'

export type RetrievalMode = 'hybrid' | 'keyword' | 'semantic'

export interface RetrievalMatch {
  entry: MemoryEntry
  score: number
}

/** 归一化：小写 + 折叠空白。 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ')
}

/** 字符 n-gram（2/3-gram），语言无关、无需分词器。 */
function ngrams(text: string): Set<string> {
  const s = normalize(text).replace(/\s+/g, '')
  const out = new Set<string>()
  for (let n = 2; n <= 3; n += 1) {
    for (let i = 0; i + n <= s.length; i += 1) {
      out.add(s.slice(i, i + n))
    }
  }
  return out
}

/** Jaccard 相似度（0-1）。 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

/** 关键词精确命中：query 每个非空词都是 content/tags 的子串。 */
export function keywordHit(query: string, entry: MemoryEntry): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = normalize(`${entry.content} ${entry.tags.join(' ')}`)
  return terms.every(term => hay.includes(term))
}

/**
 * 元数据加权系数（**只做微调**，不主导排序）。
 *
 * 旧实现是 `(0.5 + confidence*0.5) * (0.5 + importance/20)`：
 *   · importance=20 → 系数 1.5，importance=6 → 0.8，接近 2 倍 —— 足以让
 *     「高分但完全不相关」的条目压过「低分但正好相关」的，检索结果被分数绑架；
 *   · confidence 实测恒为 0.6（抽取侧）或 1（手动），是常数项，零区分度却
 *     在公式里占了一个乘法因子，等于给所有条目乘同一个数。
 * 现在压缩到 ±10% 以内：让相似度决定排序，元数据只在同分附近打破平局。
 */
function metaWeight(entry: MemoryEntry): number {
  let w = 1
  if (entry.verified) w *= 1.05
  const importance = Number.isFinite(entry.importance) ? entry.importance : 10
  w *= 0.95 + Math.min(10, Math.max(0, importance)) / 100
  return w
}

/**
 * 综合评分：n-gram 相似度 + 精确命中加成 + 元数据微调。
 *
 * 相似度用「query 覆盖度」与 Jaccard 的加权，而不是纯 Jaccard：
 * Jaccard 的分母是两边并集，**长条目的分母天然更大**，于是短条目被系统性抬高
 * ——实测库里 60 字的条目比 600 字的条目更容易命中，哪怕后者才真正回答了问题。
 * 覆盖度 `|q∩h| / |q|` 不受内容长度影响，能把这个偏置拉平。
 */
function hybridScore(query: string, entry: MemoryEntry): number {
  const q = normalize(query)
  if (q.trim() === '') return metaWeight(entry)
  const qGrams = ngrams(q)
  const hay = normalize(`${entry.content} ${entry.tags.join(' ')}`)
  const hGrams = ngrams(hay)
  let inter = 0
  for (const gram of qGrams) if (hGrams.has(gram)) inter += 1
  const coverage = qGrams.size === 0 ? 0 : inter / qGrams.size
  const jac = jaccard(qGrams, hGrams)
  let score = coverage * 0.6 + jac * 0.4
  if (keywordHit(query, entry)) score = Math.max(score, 0.5) + 0.3
  return score * metaWeight(entry)
}

/** semantic 融合分：向量余弦与 n-gram 加权（语义为主，字面为辅）。 */
function semanticScore(query: string, entry: MemoryEntry, queryVec: number[] | null): number {
  const ngram = hybridScore(query, entry)
  if (queryVec === null || !Array.isArray(entry.embedding) || entry.embedding.length === 0) {
    return ngram
  }
  const cos = normalizedCosine(queryVec, entry.embedding) * metaWeight(entry)
  // 语义 75% + 字面 25%：纯向量可能漏掉精确术语命中，混合更稳。
  return cos * 0.75 + ngram * 0.25
}

/** 同步检索（无 embedding）：keyword / hybrid；semantic 回退 hybrid。 */
export function searchEntries(
  query: string,
  entries: MemoryEntry[],
  mode: RetrievalMode,
  options: { includeDeprecated?: boolean } = {},
): RetrievalMatch[] {
  // pending 与 deprecated 是两个正交的可见性闸门：
  //   includeDeprecated 只放开「软废弃」，**绝不能顺带放开「待确认」**——
  //   前者是「曾经生效过、现在退役」，后者是「从未生效过」。把未确认的内容
  //   通过一个「要不要看废弃条目」的开关放出来，等于绕过了确认制本身。
  const active = entries
    .filter(entry => entry.pending !== true)
    .filter(entry => options.includeDeprecated === true || entry.deprecated !== true)
  const matches: RetrievalMatch[] = []
  for (const entry of active) {
    if (mode === 'keyword' && !keywordHit(query, entry)) continue
    matches.push({ entry, score: hybridScore(query, entry) })
  }
  return matches.sort((a, b) => b.score - a.score)
}

/**
 * 异步语义检索：semantic 模式真正用向量（embedding 缓存 + 缺失现场补算）。
 * provider 为 null / 调用失败 / 向量缺失时逐项回退 hybrid，绝不抛错。
 * 注意：会原地改写 entry.embedding（补算缓存），调用方需自行决定是否落盘。
 */
export async function searchEntriesSemantic(
  query: string,
  entries: MemoryEntry[],
  provider: EmbeddingProvider | null,
  options: { includeDeprecated?: boolean } = {},
): Promise<RetrievalMatch[]> {
  // 同 searchEntries：pending 恒定排除，includeDeprecated 只对 deprecated 生效。
  const active = entries
    .filter(entry => entry.pending !== true)
    .filter(entry => options.includeDeprecated === true || entry.deprecated !== true)
  if (active.length === 0) return []

  let queryVec: number[] | null = null
  if (provider !== null) {
    try {
      const vectors = await provider.embed([query])
      queryVec = vectors[0] ?? null
    } catch {
      queryVec = null
    }
  }

  // 条目向量：已缓存直接用；缺失的批量补算（含去重文本避免重复请求）。
  const missing: MemoryEntry[] = []
  for (const entry of active) {
    if (!Array.isArray(entry.embedding) || entry.embedding.length === 0) missing.push(entry)
  }
  if (provider !== null && missing.length > 0) {
    try {
      const vectors = await provider.embed(missing.map(entry => entry.content))
      for (let i = 0; i < missing.length; i += 1) {
        missing[i].embedding = vectors[i] ?? undefined
      }
    } catch {
      // 补算失败：保持缺失，对应条目回退 hybrid。
    }
  }

  const matches: RetrievalMatch[] = active.map(entry => ({
    entry,
    score: semanticScore(query, entry, queryVec),
  }))
  return matches.sort((a, b) => b.score - a.score)
}

/** 两段文本的 n-gram 相似度（提取语义去重用）。 */
export function semanticSimilarity(a: string, b: string): number {
  return jaccard(ngrams(a), ngrams(b))
}
