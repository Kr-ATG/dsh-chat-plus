/**
 * dsh-vault 模型工具：AI 在对话中可主动查阅 / 写入档案。
 *
 * ── 写入是「主 agent 自己写」（2026-10-26 用户要求）──────────────────
 * 最初的设计是后台抽取为主（`turn/end` → LLM 复盘 → 入库）、`vault_remember`
 * 只当兜底。用户明确要「主 agent 会话中自己写」，于是分工反转：
 *  · 主 agent 在对话里调 `vault_remember` —— **当轮即时生效**，用户下一句就能用；
 *  · `turn/end` 的抽取降级为兜底 —— 模型漏调时仍能捡到，不会丢数据。
 * 两条路写同一份 store，靠 `recordKeyOf`（场景+归一化标题）去重、`patchField`
 * 的「值没变就不写」避免重复写入产生假变更。所以「模型写了、抽取又捡一遍」
 * 是幂等的，不需要额外的互斥逻辑。
 *
 * ── 为什么还要 `vault_search` / `vault_get`，注入不是够了吗 ──────────
 * 注入给的是**索引**（记录标题 + 字段名），一旦记录多到几十条、或用户问的是
 * 「我那张建行的卡什么时候到期」这种需要看具体某条的场景，索引就不够用了。
 * 工具让模型能按需精确取一条，而不是靠注入把所有非敏感值全铺在上下文里。
 *
 * ── 三条硬边界 ──────────────────────────────────────────────────────
 *  1. **工具返回值里永远没有敏感字段的明文**。模型能看到的只有「密码：已加密」。
 *     要看明文只有人能看（页面点眼睛）。工具返回明文等于把「加密落盘 + 不进
 *     上下文」两条纪律一次性作废。
 *  2. vault_remember 写入的字段一律按 isFieldSensitive 判敏感，敏感字段落盘即
 *     加密；工具本身不决定加密与否。
 *  3. 返回值给人读：中文、字段名、「已加密」标记，不要吐 JSON——模型读 JSON 会
 *     开始复述结构而不是回答问题。
 */

import { defineTool } from '../../vendor/dsh-tools/schema.js'
import type { InferArgs, ParameterSchemaSpec } from '../../vendor/dsh-tools/schema.js'
import type { Context } from '@deepseek-ai/cordis'
import type { VaultStore } from './store.js'
import { isFieldSensitive, type VaultConfig, type VaultField, type VaultRecord } from './types.js'

/** Minimal tools service view（与记忆库 / mail 同款契约：注册返回注销函数）。 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: {
      register(definition: ReturnType<typeof defineTool>): () => void
    }
  }
}

/** 换行符（避免源码里出现转义序列）。 */
const LF = String.fromCharCode(10)

/** 单次工具输出上限（字符，约 1000 token）。 */
const OUTPUT_MAX = 4000

/** 单条记录的文本化（**敏感字段只报「已加密」**）。 */
function renderRecord(record: VaultRecord, sceneLabel: string): string {
  const subtitle = record.subtitle !== undefined && record.subtitle !== '' ? '（' + record.subtitle + '）' : ''
  const parts: string[] = ['【' + sceneLabel + '】' + record.title + subtitle]
  for (const field of record.fields) {
    if (isFieldSensitive(field)) {
      parts.push('  ' + field.label + '：已加密（明文保存在本机，需要时请用户在「操作间 → 档案」页面查看）')
      continue
    }
    const value = field.value.trim()
    parts.push('  ' + field.label + '：' + (value === '' ? '（空）' : value))
  }
  if (record.photos.length > 0) {
    parts.push('  照片：' + String(record.photos.length) + ' 张（本机保存，未随上下文发送）')
  }
  if (record.note !== undefined && record.note.trim() !== '') parts.push('  备注：' + record.note.trim())
  if (record.pending === true) parts.push('  〔自动记录·待用户确认〕')
  if (record.archived === true) parts.push('  〔已归档〕')
  return parts.join(LF)
}

/** 注册档案工具，返回合并 disposer。 */
export function registerVaultTools(ctx: Context, store: VaultStore, config: VaultConfig): () => void {
  const disposers: Array<() => void> = []

  // ── vault_search ──────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'vault_search',
    description: '搜索用户的个人档案（账号密码、支付方式、联系方式、证件）索引。返回字段名与**非敏感**字段值，敏感字段只显示「已加密」。用户问「我那个 XX 账号」「我的身份证」这类问题时用它。',
    parameters: {
      query: { type: 'string', description: '关键词（平台名、账户名、证件类型、标签）。留空列出全部。' },
      scene: { type: 'string', description: '限定场景 id（accounts / email / payment / contact / document / other，或用户自建场景）。' },
      includeArchived: { type: 'boolean', description: '是否包含已归档记录（默认 false）。' },
      limit: { type: 'integer', description: '返回条数上限（默认 10，最大 30）。' },
    },
    async execute(args) {
      const records = await store.listRecords({ includeArchived: args.includeArchived === true })
      const scenes = await store.listScenes()
      const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))
      const needle = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const sceneFilter = typeof args.scene === 'string' && args.scene !== '' ? args.scene : ''
      const matched = records.filter((record) => {
        if (sceneFilter !== '' && record.scene !== sceneFilter) return false
        if (needle === '') return true
        if (record.title.toLowerCase().includes(needle)) return true
        if ((record.subtitle ?? '').toLowerCase().includes(needle)) return true
        if (record.tags.some((tag) => tag.toLowerCase().includes(needle))) return true
        return record.fields.some((field) => field.label.toLowerCase().includes(needle)
          || (!isFieldSensitive(field) && field.value.toLowerCase().includes(needle)))
      })
      if (matched.length === 0) {
        return needle === '' && sceneFilter === ''
          ? '档案里还没有任何记录。'
          : '档案里没有匹配「' + (needle !== '' ? needle : sceneFilter) + '」的记录。'
      }
      const limit = Math.max(1, Math.min(30, typeof args.limit === 'number' ? args.limit : 10))
      const picked = matched.slice(0, limit)
      const lines = picked.map((record) => {
        const sceneLabel = sceneById.get(record.scene)?.label ?? record.scene
        return renderRecord(record, sceneLabel)
      })
      if (matched.length > picked.length) {
        lines.push('（另有 ' + String(matched.length - picked.length) + ' 条未列出，可用更精确的关键词或调大 limit）')
      }
      return capOutput(lines.join(LF + LF))
    },
  })))

  // ── vault_get ─────────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'vault_get',
    description: '按记录 id 取一条档案的完整字段（敏感字段仍只显示「已加密」，不会返回密码明文）。',
    parameters: {
      id: { type: 'string', required: true, description: '记录 id（rec_ 开头），来自 vault_search 的结果。' },
    },
    async execute(args) {
      const id = String(args.id ?? '').trim()
      if (id === '') throw new Error('id 不能为空')
      const record = await store.getRecord(id)
      if (record === undefined) return '没有 id 为 ' + id + ' 的档案记录。'
      const scenes = await store.listScenes()
      const sceneLabel = scenes.find((scene) => scene.id === record.scene)?.label ?? record.scene
      // 变更历史只报最近 5 条的动作与字段名：历史里的值落盘时已脱敏，但全量历史
      // 对模型没用，反而挤占预算。
      const recent = record.changes.slice(-5).map((change) => {
        const when = change.at.slice(0, 10)
        const target = change.fieldKey !== undefined ? '（' + change.fieldKey + '）' : ''
        return '  · ' + when + ' ' + change.action + target
      })
      const parts = [renderRecord(record, sceneLabel)]
      if (recent.length > 0) parts.push('最近变更：' + LF + recent.join(LF))
      return capOutput(parts.join(LF + LF))
    },
  })))

  // ── vault_remember ────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'vault_remember',
    /*
     * 描述里必须写清「什么时候调」和「什么不能传」，理由：
     *  · 不写「用户刚说出来就调」→ 模型倾向只把值留在回复正文里（原来的注入
     *    规则甚至明说「正常对话即可」，等于劝退），写入要等下一轮的后台抽取；
     *  · 不写「用户没给的别编」→ 模型会把字段填满，档案里多一条看着完整的错记录；
     *  · 不写「参数里传了就别在正文复述」→ 同一份明文在会话历史里存两份。
     */
    description: '把一个账户 / 支付方式 / 联系方式 / 证件写进用户档案。同场景同标题的记录会被**就地更新**而不是新建第二条，这正是「密码变了」能被记住的原因。用户在这一轮里刚说出新的账号 / 密码 / 证件信息、或明确说某个字段变了时，**当场调它**，不要留到下一轮；值必须是用户给出的，用户没说的字段不要填。',
    parameters: {
      scene: { type: 'string', required: true, description: '场景 id：accounts（账号密码）/ email（邮箱登录）/ payment（支付方式）/ contact（联系方式）/ document（证件）/ other（其它）。' },
      title: { type: 'string', required: true, description: '主标题，账户类用「平台 · 账号」，证件类用「证件类型 · 姓名」。' },
      subtitle: { type: 'string', description: '副标题（可选，如手机号后四位、卡组织）。' },
      fields: {
        type: 'array',
        description: '字段列表。密码 / 卡号 / 证件号 / 安全码把 sensitive 设为 true。',
        items: {
          type: 'object',
          description: '单个字段。',
          additionalProperties: false,
          properties: {
            key: { type: 'string', description: '字段稳定标识（小写 ASCII：password / username / email）。更新已有记录时**必须复用已有 key**。' },
            label: { type: 'string', description: '显示名（中文优先）。' },
            type: { type: 'string', enum: ['text', 'secret', 'email', 'phone', 'url', 'date', 'number', 'note'], description: '字段类型。密码 / 密钥用 secret。' },
            value: { type: 'string', description: '字段值。' },
            sensitive: { type: 'boolean', description: '是否敏感（落盘加密且不进上下文）。' },
          },
        },
      },
      tags: { type: 'array', items: { type: 'string' }, description: '自由标签。' },
      note: { type: 'string', description: '记录级备注。' },
    },
    async execute(args) {
      const records = await store.listRecords()
      const scenes = await store.listScenes()
      const sceneIds = new Set(scenes.map((scene) => scene.id))
      const requestedScene = typeof args.scene === 'string' ? args.scene : ''
      const scene = sceneIds.has(requestedScene) ? requestedScene : 'other'
      const title = String(args.title ?? '').trim()
      if (title === '') throw new Error('title 不能为空')
      const rawFields = Array.isArray(args.fields) ? args.fields : []
      const fields: VaultField[] = []
      const now = new Date().toISOString()
      for (const item of rawFields) {
        if (item === null || typeof item !== 'object') continue
        const entry = item as Record<string, unknown>
        const key = typeof entry.key === 'string' ? entry.key.trim() : ''
        if (key === '') continue
        const type = isFieldType(entry.type) ? entry.type : 'text'
        fields.push({
          key,
          label: typeof entry.label === 'string' && entry.label !== '' ? entry.label : key,
          type,
          ...(entry.sensitive === true || type === 'secret' ? { sensitive: true as const } : {}),
          value: typeof entry.value === 'string' ? entry.value : '',
          updatedAt: now,
        })
      }
      if (fields.length === 0) throw new Error('至少需要一个 field')
      // 同场景同标题 → 就地更新（**不删未提到的字段**：模型这次没说，不代表用户删了）。
      const existing = records.find((record) => record.scene === scene
        && record.title.toLowerCase() === title.toLowerCase())
      if (existing !== undefined) {
        const before = new Map(existing.fields.map((field) => [field.key, field]))
        const merged = [...existing.fields]
        for (const field of fields) {
          const index = merged.findIndex((item) => item.key === field.key)
          if (index === -1) merged.push(field)
          else merged[index] = { ...merged[index], ...field }
        }
        const updated = await store.upsertRecord({
          id: existing.id,
          scene,
          title: existing.title,
          ...(existing.subtitle !== undefined ? { subtitle: existing.subtitle } : {}),
          fields: merged,
          tags: existing.tags,
          ...(existing.note !== undefined ? { note: existing.note } : {}),
          source: 'manual',
        })
        const changedKeys = fields
          .filter((field) => {
            const old = before.get(field.key)
            return old === undefined || old.value !== field.value
          })
          .map((field) => field.label)
        return '已更新档案「' + updated.title + '」'
          + (changedKeys.length > 0 ? '：' + changedKeys.join('、') + ' 已写入' : '（值没有变化）')
          + '。敏感字段已在磁盘上加密，明文不会再出现在上下文里。'
      }
      const created = await store.upsertRecord({
        scene,
        title,
        ...(typeof args.subtitle === 'string' && args.subtitle.trim() !== '' ? { subtitle: args.subtitle.trim() } : {}),
        fields,
        ...(Array.isArray(args.tags) ? { tags: args.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
        ...(typeof args.note === 'string' && args.note.trim() !== '' ? { note: args.note } : {}),
        source: 'manual',
      })
      return '已记录到档案：' + created.title + '（' + String(created.fields.length) + ' 个字段）'
        + '。密码 / 卡号这类敏感值已加密保存，不进上下文。'
    },
  })))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/* ───────────────────────── 辅助 ───────────────────────── */

/** 字段类型守卫。 */
function isFieldType(value: unknown): value is VaultField['type'] {
  return value === 'text' || value === 'secret' || value === 'email' || value === 'phone'
    || value === 'url' || value === 'date' || value === 'number' || value === 'note'
}

/** 输出截断（保住结尾：「另有 N 条」这类关键提示在末尾）。 */
function capOutput(text: string): string {
  if (text.length <= OUTPUT_MAX) return text
  const tail = text.slice(text.length - 400)
  return text.slice(0, OUTPUT_MAX - 440) + LF + '…（内容过长已截断）…' + LF + tail
}

/** 文本工具包装（与记忆库同款：presentCall 用中文标题）。 */
function textTool<S extends ParameterSchemaSpec>(definition: {
  name: string
  description: string
  parameters: S
  execute: (args: InferArgs<S>, exec: { agent?: unknown }) => Promise<string>
}): ReturnType<typeof defineTool> {
  return defineTool({
    ...definition,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: (args) => {
      const raw = args as Record<string, unknown>
      const title = definition.name === 'vault_search'
        ? '查档案：' + String(raw.query ?? '')
        : definition.name === 'vault_get'
          ? '看档案：' + String(raw.id ?? '')
          : '记档案：' + String(raw.title ?? '')
      return { card: 'generic' as const, kind: 'other' as const, title, rawInput: args }
    },
  })
}
