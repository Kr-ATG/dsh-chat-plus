/**
 * dsh-vault 抽取层：从一轮对话里识别「账户/证件信息」并落到记录上。
 *
 * ── 与记忆库的抽取有什么不同（三个关键差异）──────────────────────────
 *  1. **输出是「实体 + 字段」而不是句子**。记忆库让模型输出陈述句（「用户
 *     偏好 pnpm」），档案让模型输出「往哪个记录、改哪个字段、改成什么」。
 *     这样「密码变了」才是就地改字段，而不是追加第二句话。
 *  2. **必须把现有档案索引喂进去**。模型要判断「这是新账户还是已有账户
 *     的新密码」，就必须看见已有记录的 scene + title + 字段 key。**索引里
 *     不含任何敏感值**（密码/卡号一律不进 prompt）——模型只需要知道「这个
 *     账户有 password 字段」，不需要知道它是什么。
 *  3. **关键词预筛省掉大半调用**。绝大多数轮次与账户信息无关，先看有没有
 *     「密码 / 账号 / 邮箱 / 身份证 / 卡号」这类词；一个都没有就直接返回，
 *     不花一次 LLM 调用。实测记忆库的抽取是本机主要 token 消耗之一。
 *
 * ── 安全边界（这些字符串绝不能出现在 prompt 里）──────────────────────
 *  · 任何 field.value（无论敏感与否）——只喂 key/label/type
 *  · 任何历史变更的 before/after 原文
 *  · 用户的图片字节（只告诉模型「本轮附了 N 张图」，不含内容）
 */

import { createUserMessage, BlockAssembler } from '../../vendor/dsh-llm/index.js'
import { normalizeTitle, recordKeyOf, type VaultStore } from './store.js'
import {
  isFieldSensitive,
  type VaultConfig,
  type VaultField,
  type VaultFieldType,
  type VaultRecord,
  type VaultScene,
} from './types.js'

/**
 * 抽取只用到 ctx 的两件事：取 llm 服务、取 agentDefaultModel。
 * 刻意收窄成最小面（与 inject / index 同策略），避免依赖 cordis 类型垫片——
 * 那套垫片对 `ctx.get` 的返回类型约束很松，宽类型反而会在别处制造假错。
 */
export interface VaultLlmContext {
  get(name: 'llm'): VaultLlmService | undefined
  get(name: 'agentDefaultModel'): VaultDefaultModel | undefined
}

/** llm 服务的最小面（只用到 stream）。 */
interface VaultLlmService {
  stream(options: unknown): AsyncIterable<unknown>
}

/** 默认模型选择的最小面。 */
interface VaultDefaultModel {
  currentSelection(): { provider?: string; model?: string }
}

/** 抽取超时（毫秒）。 */
const EXTRACT_TIMEOUT_MS = 30_000

/** 换行符（避免源码里出现转义序列）。 */
const LF = String.fromCharCode(10)

/**
 * 关键词预筛词表。
 *
 * 设计原则：**宁可放过、不要漏掉**（这道筛子的目的是省调用，不是准入审查）。
 * 所以同一概念给了多种写法（中英文、口语与书面），并包含「改 / 换 / 变」这类
 * 变更词——「密码改了」与「密码是 xxx」都要能进来。
 */
export const EXTRACT_HINTS: readonly string[] = [
  // 账户与密码
  '密码', '口令', 'password', 'passwd', 'pwd', '登录', 'login', 'signin', 'sign in',
  '账号', '帐户', '账户', 'account', '用户名', 'username', 'user name',
  '注册', 'register', '验证码', '二次验证', '两步验证', '2fa', 'mfa', 'totp',
  // 邮箱与联系方式
  '邮箱', 'email', 'mail', '收件箱', '电话', '手机号', '手机号码', '联系方式',
  '地址', '住址', '快递地址', '微信', 'qq', 'telegram', 'telegram', 'whatsapp',
  // 支付
  '银行卡', '信用卡', '储蓄卡', '借记卡', '卡号', '卡号', 'cvv', '安全码', 'cvc',
  '有效期', '到期', '支付宝', '微信支付', 'paypal', '会员卡', '银行卡号',
  // 证件
  '身份证', '证件', '驾驶证', '驾照', '行驶证', '护照', '通行证', '社保卡',
  '营业执照', '学生证', '工牌', '户口', '签证',
  // 变更动词（与上面任一组合时提高命中率）
  '改成', '改为', '换成', '换了', '变了', '更新为', '重置', '过期', '到期',
  'id card', 'passport', 'driver', 'license', 'licence',
]

/**
 * 本轮对话是否值得花一次 LLM 调用。
 *
 * 命中判据：任一词出现即可（大小写不敏感）。包含「变更动词」也算命中是因为
 * 「邮箱改了」这类话本身就应该触发抽取，哪怕没提具体账户。
 * @param transcript 本轮对话文本。
 * @returns true = 值得抽取。
 */
export function shouldAttemptExtract(transcript: string): boolean {
  if (transcript.trim() === '') return false
  const lower = transcript.toLowerCase()
  for (const hint of EXTRACT_HINTS) {
    if (lower.includes(hint.toLowerCase())) return true
  }
  return false
}

/** 抽取动作类型。 */
type ExtractAction = 'create' | 'update'

/** 模型输出的一个字段候选。 */
interface ExtractFieldCandidate {
  key: string
  label?: string
  type?: VaultFieldType
  value: string
  sensitive?: boolean
}

/** 模型输出的一个动作。 */
interface ExtractOp {
  action: ExtractAction
  /** update 时必填：目标记录 id（必须来自索引）。 */
  recordId?: string
  /** create 时必填。 */
  scene?: string
  title?: string
  subtitle?: string
  /** 要写入的字段（create 全量；update 只给变化的）。 */
  fields: ExtractFieldCandidate[]
  /** 记录级备注（可选）。 */
  note?: string
  tags?: string[]
  /** 可信度 0-1（模型自评）。 */
  confidence?: number
  /** 模型给出的理由（落日志，不上屏）。 */
  reason?: string
}

/** 抽取结果（四态，与记忆库同款语义）。 */
export type VaultExtractOutcome = 'ok' | 'ok-empty' | 'parse-fail' | 'llm-error'

/** 抽取结果。 */
export interface VaultExtractResult {
  ops: ExtractOp[]
  outcome: VaultExtractOutcome
  error?: string
}

/** 日志口（只要一个写日志的能力，避免与 store 形成双向依赖）。 */
export interface VaultLogSink {
  appendVaultLog(message: string): Promise<void>
}

/**
 * 系统提示词。
 *
 * 三条纪律必须写死在 prompt 里，否则模型会按记忆库的习惯输出陈述句：
 *   · 只能输出「对某个记录的动作」，不能输出散句；
 *   · update 的 recordId 必须来自索引，不许自己编；
 *   · 敏感值可以出现在字段值里（这是档案的根本用途），但**不许写进 reason**。
 */
export function vaultExtractSystemPrompt(): string {
  return [
    'You maintain a structured personal vault (like a password manager) for an AI assistant user.',
    'Read the conversation and output ONLY a JSON object describing vault changes:',
    '{"ops":[{"action":"create"|"update","recordId":"...","scene":"...","title":"...","fields":[{"key":"...","label":"...","type":"...","value":"...","sensitive":true}],"note":"...","tags":["..."],"confidence":0.9,"reason":"..."}]}',
    '',
    'Rules:',
    '- Output ops ONLY when the conversation reveals a durable fact about a real account, card, or document: credentials, account numbers, emails, phone numbers, ID/licence/passport numbers, expiry dates.',
    '- NEVER output ops for generic discussion, examples, code samples, or hypotheticals. If the user is talking about "a password" in the abstract, output {"ops":[]}.',
    '- action:"update" REQUIRES recordId taken verbatim from the provided vault index. NEVER invent a recordId.',
    '- action:"create" REQUIRES scene from the provided scene list, and a title in the form "Platform · Account" or "DocumentType · PersonName".',
    '- field.key must be short lowercase ASCII (password, username, email, expiry, number). Reuse an existing field key from the index when updating — do not invent a synonym (password vs passwd vs login_password would split one field into three).',
    '- field.type: text | secret | email | phone | url | date | number | note. Use "secret" for passwords, API keys, CVV, TOTP seeds.',
    '- Put the ACTUAL VALUE in field.value when the user states it. This vault exists precisely to store such values; the harness encrypts them at rest and never sends them to you later.',
    '- NEVER put a password, key, card number, or ID number into "reason", "note", or "title". Those fields get read by other systems.',
    '- confidence: 0-1. Use < 0.6 when the account identity is ambiguous or the value might be a placeholder like "xxx".',
    '- If the user merely corrects a value ("no, it is 1234"), output update with the same recordId and only the changed field.',
    '- Output the empty list when nothing durable was revealed.',
  ].join('\n')
}

/**
 * 组装 vault 索引（**喂给模型的那一份**）。
 *
 * 这里是全模块唯一「把记录写进 prompt」的地方，因此**只写 key/label/type，
 * 绝不写 value**。敏感或非敏感一律不写值——模型判断是否需要更新，靠的是
 * 「这个账户有哪些字段」，不是「字段里现在是什么」。
 * @param records 现有记录（明文内存态，但本函数不会读它的 value）。
 * @param scenes 场景清单。
 * @param budget 索引字符预算（超出截断，优先保留最近更新的）。
 */
export function buildVaultIndex(records: VaultRecord[], scenes: VaultScene[], budget = 3000): string {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))
  const lines: string[] = []
  lines.push('SCENES (id | label):')
  for (const scene of scenes) {
    lines.push('- ' + scene.id + ' | ' + scene.label + ' | ' + scene.desc)
  }
  lines.push('')
  lines.push('EXISTING RECORDS (recordId | scene | title | field keys):')
  const active = records
    .filter((record) => record.archived !== true)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  let used = lines.join('\n').length
  for (const record of active) {
    const sceneLabel = sceneById.get(record.scene)?.label ?? record.scene
    // 只报 key 与 label，不带值。敏感字段额外标 [secret]，让模型知道别指望能读到。
    const keys = record.fields
      .map((field) => field.key + (isFieldSensitive(field) ? '[secret]' : ''))
      .join(',')
    const line = '- ' + record.id + ' | ' + sceneLabel + ' | ' + record.title + ' | ' + keys
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/** 解析模型输出（失败返回 undefined，空结果返回 []）。 */
export function parseVaultExtractOutput(raw: string): ExtractOp[] | undefined {
  let text = raw.trim()
  const fence = /^`(?:json)?\s*([\s\S]*?)\s*`$/i.exec(text)
  if (fence !== null) text = fence[1]!.trim()
  text = text.replace(/^\uFEFF/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const ops = (parsed as { ops?: unknown }).ops
  if (!Array.isArray(ops)) return undefined
  const out: ExtractOp[] = []
  for (const item of ops) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const action = record.action === 'update' ? 'update' : record.action === 'create' ? 'create' : null
    if (action === null) continue
    const fields: ExtractFieldCandidate[] = []
    if (Array.isArray(record.fields)) {
      for (const rawField of record.fields) {
        if (typeof rawField !== 'object' || rawField === null) continue
        const entry = rawField as Record<string, unknown>
        const key = typeof entry.key === 'string' ? entry.key.trim().toLowerCase() : ''
        const value = typeof entry.value === 'string' ? entry.value : ''
        if (key === '' || value === '') continue
        fields.push({
          key: normalizeFieldKey(key),
          ...(typeof entry.label === 'string' ? { label: entry.label.trim() } : {}),
          ...(isVaultFieldType(entry.type) ? { type: entry.type } : {}),
          value,
          ...(typeof entry.sensitive === 'boolean' ? { sensitive: entry.sensitive } : {}),
        })
      }
    }
    if (fields.length === 0) continue
    out.push({
      action,
      ...(typeof record.recordId === 'string' ? { recordId: record.recordId.trim() } : {}),
      ...(typeof record.scene === 'string' ? { scene: record.scene.trim() } : {}),
      ...(typeof record.title === 'string' ? { title: record.title.trim() } : {}),
      ...(typeof record.subtitle === 'string' ? { subtitle: record.subtitle.trim() } : {}),
      fields,
      ...(typeof record.note === 'string' ? { note: record.note.trim() } : {}),
      ...(Array.isArray(record.tags) ? { tags: record.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 6) } : {}),
      ...(typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? { confidence: Math.max(0, Math.min(1, record.confidence)) }
        : {}),
      ...(typeof record.reason === 'string' ? { reason: record.reason.slice(0, 200) } : {}),
    })
  }
  return out
}

/** 字段 key 归一化（模型可能给 Password / login-password）。 */
export function normalizeFieldKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'field'
}

/** 类型守卫。 */
function isVaultFieldType(value: unknown): value is VaultFieldType {
  return value === 'text' || value === 'secret' || value === 'email' || value === 'phone'
    || value === 'url' || value === 'date' || value === 'number' || value === 'note'
}

/** 最小 agent 面。 */
interface MinimalAgent {
  readonly id: string
  readonly options: { provider?: string; model?: string }
  readonly session: { readonly id: string; readonly header?: { cwd?: string } }
}

/** 解析 LLM 路由（与记忆库同一套策略：会话模型优先，回退默认）。 */
async function resolveRoute(ctx: VaultLlmContext, agent: MinimalAgent, config: VaultConfig): Promise<{ provider: string; model: string } | undefined> {
  if (config.extractProvider !== undefined && config.extractProvider !== ''
    && config.extractModel !== undefined && config.extractModel !== '') {
    return { provider: config.extractProvider, model: config.extractModel }
  }
  if (agent.options.provider !== undefined && agent.options.model !== undefined
    && agent.options.provider !== '' && agent.options.model !== '') {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  const defaultModel = ctx.get('agentDefaultModel')
  if (defaultModel !== undefined) {
    try {
      const selection = defaultModel.currentSelection() as { provider?: string; model?: string }
      if (selection.provider !== undefined && selection.model !== undefined) {
        return { provider: selection.provider, model: selection.model }
      }
    } catch {
      /* 回退失败就当没有路由 */
    }
  }
  return undefined
}

/**
 * 调用模型抽取。
 *
 * 失败一律不抛（抽取是尽力而为的副产物，绝不能阻塞对话），但把失败原因
 * 如实回传：调用方据此区分「没啥可记」与「LLM 挂了」。
 */
export async function extractVaultOps(
  ctx: VaultLlmContext,
  agent: MinimalAgent,
  transcript: string,
  records: VaultRecord[],
  scenes: VaultScene[],
  config: VaultConfig,
  log?: VaultLogSink,
): Promise<VaultExtractResult> {
  const fail = (outcome: VaultExtractOutcome, detail: string): VaultExtractResult => {
    if (log !== undefined) {
      try {
        void log.appendVaultLog(outcome + ': ' + detail).catch(() => undefined)
      } catch { /* 日志写不进去不影响抽取 */ }
    }
    return { ops: [], outcome, error: detail }
  }
  if (transcript.trim() === '') return { ops: [], outcome: 'ok-empty' }
  // 预筛在最前面：没命中关键词就不必解析路由、不必读 LLM 服务。
  if (config.prefilter && !shouldAttemptExtract(transcript)) {
    return { ops: [], outcome: 'ok-empty' }
  }
  const llm = ctx.get('llm')
  if (llm === undefined) return fail('llm-error', 'llm service not available')
  const route = await resolveRoute(ctx, agent, config)
  if (route === undefined) return fail('llm-error', 'no LLM route')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(5000, config.extractTimeoutMs || EXTRACT_TIMEOUT_MS))
  try {
    const index = buildVaultIndex(records, scenes)
    const userPrompt = [
      index,
      '',
      'CONVERSATION TRANSCRIPT (JSON string):',
      JSON.stringify(transcript.slice(0, 6000)),
      '',
      'Output the JSON object with "ops" describing vault changes revealed by this conversation.',
    ].join('\n')
    // 先装进一个具名常量再传给 llm.stream：直接内联对象字面量时 TS 会把
    // source.kind 收窄成字符串字面量而不是联合类型的成员，类型检查会报
    // 「不可赋值给 MessageSource」。记忆库的抽取走同一写法。
    const options = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: userPrompt }],
        source: { kind: 'plugin:dsh-vault', plugin: 'dsh-vault' },
      })],
      system: vaultExtractSystemPrompt(),
      maxTokens: 2048,
      signal: controller.signal,
    }
    // 与记忆库抽取同款写法 + 一次显式断言：DSH 官方 llm 的类型与本地
    // vendor/dsh-llm 的 StreamChunk 是两份独立声明（同一份运行时形状），
    // 直接传会被判为不兼容。记忆库那边留的是同样的类型噪音，这里收干净。
    const assembler = new BlockAssembler()
    const stream = llm.stream(options as never) as unknown as AsyncIterable<Parameters<BlockAssembler['push']>[0]>
    for await (const chunk of stream) {
      assembler.push(chunk)
    }
    if (assembler.finish.kind !== 'stop') return fail('llm-error', 'finish=' + assembler.finish.kind)
    const text = assembler.blocks()
      .filter((block) => block.type === 'text' || block.type === 'reasoning')
      .map((block) => (block as { text?: string }).text ?? '')
      .join(' ')
    const parsed = parseVaultExtractOutput(text)
    if (parsed === undefined) return fail('parse-fail', 'unparsable (' + String(text.length) + ' chars)')
    return parsed.length === 0 ? { ops: [], outcome: 'ok-empty' } : { ops: parsed, outcome: 'ok' }
  } catch (error) {
    return fail('llm-error', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
  }
}

/* ────────────────── 应用抽取结果 ────────────────── */

/** 应用结果统计。 */
export interface ApplyOpsResult {
  created: number
  updated: number
  pendingCreated: number
  pendingUpdated: number
  skipped: number
  /** 需要用户确认的改动（页面提示用）。 */
  needsConfirm: Array<{ recordId: string; title: string; fieldKey: string }>
}

/**
 * 把抽取动作应用到 store。
 *
 * 三条与「别把好数据改坏」直接相关的策略：
 *  1. **update 只改模型明确给出的字段**，绝不整体替换（没提到的字段原样保留）。
 *  2. **create 先查重**：同场景 + 归一化标题相同则退化为 update（模型有时
 *     会把「改密码」说成「新建一个账户」）。
 *  3. **已有记录的修改默认挂 pending**（除非 config.trustAutoUpdates），
 *     因为覆盖别人的密码比漏记严重得多。
 */
export async function applyVaultOps(
  store: VaultStore,
  ops: ExtractOp[],
  options: {
    config: VaultConfig
    scenes: VaultScene[]
    sessionId?: string
    turn?: number
  },
): Promise<ApplyOpsResult> {
  const result: ApplyOpsResult = {
    created: 0, updated: 0, pendingCreated: 0, pendingUpdated: 0, skipped: 0, needsConfirm: [],
  }
  const records = await store.listRecords()
  const sceneIds = new Set(options.scenes.map((scene) => scene.id))
  const byId = new Map(records.map((record) => [record.id, record]))
  const byKey = new Map(records.map((record) => [recordKeyOf(record.scene, record.title), record]))
  for (const op of ops) {
    const confidence = op.confidence ?? 0.7
    if (op.action === 'update') {
      const target = op.recordId !== undefined ? byId.get(op.recordId) : undefined
      if (target === undefined) {
        // 模型编了一个不存在的 recordId：不猜，直接跳过（猜错就是往别的
        // 账户里写密码）。
        result.skipped += 1
        continue
      }
      const needsConfirm = options.config.trustAutoUpdates !== true
      for (const field of op.fields) {
        const existing = target.fields.find((item) => item.key === field.key)
        // 值没变就不写（避免每次抽取都刷一遍 updatedAt 与历史）。
        if (existing !== undefined && existing.value === field.value) continue
        await store.patchField({
          id: target.id,
          key: field.key,
          value: field.value,
          ...(field.label !== undefined ? { label: field.label } : {}),
          ...(field.type !== undefined ? { type: field.type } : {}),
          ...(field.sensitive !== undefined ? { sensitive: field.sensitive } : {}),
          source: 'extract',
        })
        if (needsConfirm) {
          result.needsConfirm.push({ recordId: target.id, title: target.title, fieldKey: field.key })
        }
      }
      if (needsConfirm) {
        await store.setPending(target.id, true)
        result.pendingUpdated += 1
      }
      result.updated += 1
      continue
    }
    // create 路径
    const scene = op.scene !== undefined && sceneIds.has(op.scene) ? op.scene : 'other'
    const title = (op.title ?? '').trim()
    if (title === '') {
      result.skipped += 1
      continue
    }
    const existing = byKey.get(recordKeyOf(scene, title))
    if (existing !== undefined) {
      // 同一实体：退化为字段更新，不要建第二条。
      for (const field of op.fields) {
        const before = existing.fields.find((item) => item.key === field.key)
        if (before !== undefined && before.value === field.value) continue
        await store.patchField({
          id: existing.id,
          key: field.key,
          value: field.value,
          ...(field.label !== undefined ? { label: field.label } : {}),
          ...(field.type !== undefined ? { type: field.type } : {}),
          source: 'extract',
        })
      }
      result.updated += 1
      continue
    }
    const fields: VaultField[] = op.fields.map((field) => ({
      key: field.key,
      label: field.label ?? field.key,
      type: field.type ?? (field.sensitive === true ? 'secret' : 'text'),
      ...(field.sensitive === true ? { sensitive: true as const } : {}),
      value: field.value,
      updatedAt: new Date().toISOString(),
    }))
    const created = await store.upsertRecord({
      scene,
      title,
      subtitle: op.subtitle,
      fields,
      tags: op.tags,
      note: op.note,
      source: 'extract',
      confidence,
      // 低可信度直接挂 pending；高可信度也挂——自动抽取的「新记录」本来就要
      // 用户过一眼，除非用户在页面里关掉了 pending（当前版本一律挂）。
      pending: true,
      provenance: { sessionId: options.sessionId, turn: options.turn },
    })
    byId.set(created.id, created)
    byKey.set(recordKeyOf(created.scene, created.title), created)
    result.created += 1
    result.pendingCreated += 1
  }
  return result
}

/* ────────────────── 对话文本拼装（抽取输入） ────────────────── */

/**
 * 从本轮事件缓冲里拼出「用户 / 助手」对话文本。
 *
 * 与记忆库的 transcriptFromEvents 有**一个刻意的差异**：这里保留插件注入的
 * 消息之外的一切，但跳过压缩摘要（compact-checkpoint）与技能目录。理由：
 * 档案抽取要的是「用户说了自己的账号」，而插件注入块（记忆、档案索引本身、
 * HTML 卡片规范）里也**含有账户名与字段名**——把它们喂回抽取，模型会把
 * 「档案里已经有 GitHub 账号」当成「用户刚告诉我一个新账号」，凭空造记录。
 */
export function transcriptOfEventsVault(events: Array<{ type: string; data: unknown }>): string {
  const lines: string[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const message = event.data as { content?: unknown; source?: { kind?: string } }
      const kind = typeof message.source?.kind === 'string' ? message.source.kind : ''
      if (kind !== '' && (kind.startsWith('plugin') || SKIP_SOURCE_KINDS.includes(kind))) continue
      const text = textOf(message.content)
      if (text !== '') lines.push('User: ' + text)
      continue
    }
    if (event.type === 'assistant/message') {
      const data = event.data as { message?: { content?: unknown } }
      const text = textOf(data.message?.content)
      if (text !== '') lines.push('Assistant: ' + text)
    }
  }
  return lines.join(LF)
}

/** 需要跳过的注入来源（压缩摘要 / 项目指令 / 技能目录 / 技能调用）。 */
const SKIP_SOURCE_KINDS: readonly string[] = [
  'agent-instructions', 'skill-catalog', 'skill-invocation', 'compact-checkpoint',
]

/** ContentBlock[] 或字符串 → 纯文本。 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join(LF).trim()
}