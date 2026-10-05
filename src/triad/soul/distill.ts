/**
 * dsh-chat-plus — Soul 蒸馏引擎：把记忆库里高价值的身份/偏好条目，交给 LLM 提炼
 * 成一份「灵魂草案」。
 *
 * 三条设计取舍（都是刻意的，改动前先读）：
 *
 *  1. **不落盘**。distill 只返回 draft，真正的写入在 /soul/apply。理由：LLM 产出的
 *     人格契约一旦自动生效，用户会在毫无察觉的情况下发现「模型说话方式变了」，
 *     而且没有撤销点。草案先给用户看、点了才生效，是这条链路唯一的可逆性保障。
 *
 *  2. **失败绝不抛**。返回 { ok:false, failed }，由路由原样回给面板。灵魂是锦上
 *     添花的能力，任何一次 LLM 抖动都不该让「记忆面板」整页报错。
 *
 *  3. **prompt 显式禁止虚构**。记忆条目里没有的名字/角色，模型非常乐意「补全」
 *     一个像样的（这是它最擅长的模式补全）。所以 system prompt 里把「字段没有
 *     依据就留空」写成硬规则，并在解析层对空字段原样保留——不替模型补默认值。
 */

import { BlockAssembler, createUserMessage } from '../../vendor/dsh-llm/index.js'
import type { Context } from '@deepseek-ai/cordis'
import { resolveRoute, type MinimalAgent } from '../memory/engine/extract.js'
import type { MemoryEntry } from '../memory/types.js'
import {
  soulDistillSystemPrompt,
  soulDistillUserPrompt,
  SOUL_DISTILL_TIMEOUT_MS,
} from './prompt.js'
import { normalizeIdentity, type SoulDistillStats, type SoulDraft } from './types.js'

/** 蒸馏用伪 agent：无显式 provider/model 时回退默认模型（与 consolidate 同款）。 */
const DISTILL_AGENT: MinimalAgent = {
  id: 'dsh-soul-distill',
  options: {},
  session: { id: '', header: undefined },
}

/** 蒸馏结果（路由直接回给面板）。 */
export type DistillOutcome =
  | { ok: true; draft: SoulDraft; stats: SoulDistillStats }
  | { ok: false; failed: string }

/**
 * 解析 LLM 输出为草案（容错：剥 fence / 去 BOM / 取最外层对象）。
 *
 * 解析失败返回 null 而不是抛错：调用方要把它变成「诚实失败」回给面板，
 * 抛错会让整条路由 500，用户只看到「请求失败」，看不出是模型没按格式输出。
 */
export function parseSoulDraft(raw: string): SoulDraft | null {
  let text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fence !== null) text = fence[1]!.trim()
  text = text.replace(/^\uFEFF/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const content = typeof record.content === 'string' ? record.content.trim() : ''
  // 正文是灵魂的唯一必需项：没有正文的草案应用后等于「灵魂清空」，
  // 与其让用户误点，不如判定为解析失败。
  if (content === '') return null
  const notes = typeof record.notes === 'string' && record.notes.trim() !== ''
    ? record.notes.trim().slice(0, 400)
    : undefined
  return {
    content,
    identity: normalizeIdentity(record.identity),
    ...(notes !== undefined ? { notes } : {}),
  }
}

/**
 * 执行蒸馏。
 *
 * @param entries 已筛选好的候选条目（筛选在 prompt.ts 的 selectDistillEntries）。
 * @param routeOverride 面板显式指定的模型路由（provider/model 成对才生效）。
 * @param scanned 库里参与扫描的条目总数（stats 用；面板要能区分「库里没料」
 *                与「有料但都被筛掉了」这两种完全不同的失败原因）。
 */
export async function distillSoul(
  ctx: Context,
  entries: MemoryEntry[],
  routeOverride?: { provider?: string; model?: string },
  scanned = entries.length,
): Promise<DistillOutcome> {
  const startedAt = Date.now()
  const emptyStats: SoulDistillStats = { scanned, used: 0, ms: 0, entries: 0, chars: 0, provider: '', model: '' }
  // 失败码用**稳定字面量**而不是自然语言：client 面板按码翻译成中文人话
  // （empty / no-model 有专门文案），其余原因原样展示。用中文长句当码，面板
  // 就只能整句照贴，改一次文案等于两边同时改。
  if (entries.length === 0) return { ok: false, failed: 'empty' }
  // LLM 面刻意收窄成「一个 stream 方法」：宿主 Context 的 llm 声明与
  // vendor/dsh-llm 的 GenerateOptions/StreamChunk 是两套同名不同源的类型
  // （extract.ts / consolidate.ts 里那两条既有 TS2345 就是同一成因），
  // Soul 是新增文件，不该把既有类型债复制成新增错误。运行时调用形状与
  // 既有两条通道逐字一致。
  const llm = ctx.get('llm') as { stream(options: unknown): AsyncIterable<unknown> } | undefined
  if (llm === undefined) return { ok: false, failed: 'no-model' }
  let route: { provider: string; model: string } | undefined
  if (routeOverride?.provider !== undefined && routeOverride.model !== undefined
    && routeOverride.provider !== '' && routeOverride.model !== '') {
    route = { provider: routeOverride.provider, model: routeOverride.model }
  } else {
    route = await resolveRoute(ctx, DISTILL_AGENT)
  }
  if (route === undefined) return { ok: false, failed: 'no-model' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SOUL_DISTILL_TIMEOUT_MS)
  try {
    const userPrompt = soulDistillUserPrompt(entries)
    const options = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: userPrompt }],
        source: { kind: 'plugin:dsh-memory', plugin: 'dsh-memory' },
      })],
      system: soulDistillSystemPrompt(),
      // 推理模型先出 reasoning 再出 JSON：4096 给正文+字段+思考留余量。
      maxTokens: 4096,
      signal: controller.signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) {
      // as never：宿主 llm.stream 的 chunk 与 vendor 的 StreamChunk 是同形状、
      // 不同源的类型（宿主那份 ContentBlockMap 多了 'file'）。运行时字段完全一致，
      // 既有 extract.ts / consolidate.ts 面对同一处类型债（它们选择让它报错）。
      assembler.push(chunk as never)
    }
    const finish = assembler.finish
    if (finish.kind !== 'stop') {
      return { ok: false, failed: `model interrupted (finish=${finish.kind})` }
    }
    // 同时聚合 text 与 reasoning：部分推理模型在低 token 预算下只产出 reasoning。
    const text = assembler.blocks()
      .filter(block => block.type === 'text' || block.type === 'reasoning')
      .map(block => (block as { text?: string }).text ?? '')
      .join(' ')
    const draft = parseSoulDraft(text)
    if (draft === null) {
      return { ok: false, failed: 'unparsable draft (expected JSON: content + identity)' }
    }
    return {
      ok: true,
      draft,
      stats: {
        scanned,
        used: entries.length,
        ms: Date.now() - startedAt,
        route: `${route.provider}/${route.model}`,
        entries: entries.length,
        chars: userPrompt.length,
        provider: route.provider,
        model: route.model,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      failed: controller.signal.aborted ? `timeout (${SOUL_DISTILL_TIMEOUT_MS / 1000}s)` : message,
    }
  } finally {
    clearTimeout(timer)
  }
}
