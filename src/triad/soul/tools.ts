/**
 * dsh-chat-plus — Soul 模型工具：让 AI 在对话里读写自己的顶层身份契约。
 *
 * 工具面分两层，理由是「契约级改动」与「条目级改动」的风险完全不同：
 *   - 契约级（soul_show / soul_set）：整段读写人格。soul_set **只允许整段替换正文**，
 *     不给「局部追加」——灵魂是一份自洽的契约，允许增量拼接等于允许模型把互相
 *     矛盾的准则堆进去，三次对话后用户会看到一份谁也没写过的缝合怪。
 *   - 条目级（soul_cards / soul_card_set / soul_card_remove，schema v2 新增）：
 *     按卡片粒度增删改。这三条是**用户明确要求「每张卡单独设置」**后的必然结果：
 *     模型要改「只是语气」时不该被迫重写整份人格（那会顺带丢掉用户的自定义卡）。
 *     风险边界靠 kind 白名单 + 长度上限 + 逐张归一化兜住，而不是靠不给接口。
 *
 * 与记忆工具的关系：memory_remember 记的是「事实」，soul_* 改的是「我是谁」。
 * 两者的作用域、生效时机（首步注入 vs 检索注入）都不同，刻意不合并。
 */

import { defineTool } from '../../vendor/dsh-tools/schema.js'
import type { InferArgs, ParameterSchemaSpec } from '../../vendor/dsh-tools/schema.js'
import type { Context } from '@deepseek-ai/cordis'
import type { SoulStore } from './store.js'
import {
  normalizeCard,
  normalizeIdentity,
  SOUL_CARD_KINDS,
  SOUL_CARD_SECTION_TITLES,
  type SoulCard,
  type SoulCardKind,
  type SoulIdentity,
} from './types.js'

/**
 * 本模块用到的最小工具注册面。
 *
 * 为什么不直接写 `ctx.tools.register`：宿主 @deepseek-ai/cordis 的 Context 里
 * 没有声明 tools（真实声明在 DSH 侧，插件拿到的是运行时的并集），memory/tools.ts
 * 里那 8 条 TS2339 就是同一成因的既有债。Soul 是新增文件，不该把既有类型债
 * 复制成新增错误；这里显式收窄成「只用到 register 一个方法」，运行时行为一致。
 */
interface ToolRegistry {
  register(definition: ReturnType<typeof defineTool>): () => void
}

/** 注册 Soul 工具，返回合并 disposer。 */
export function registerSoulTools(ctx: Context, soul: SoulStore): () => void {
  const disposers: Array<() => void> = []
  const tools = (ctx as unknown as { tools: ToolRegistry }).tools

  disposers.push(tools.register(textTool({
    name: 'soul_show',
    description: '读取当前「灵魂」：顶层身份契约（名字/角色/语气/语言/行为准则 + 正文）。用于回答「你的人设是什么」或写入前先看现状。',
    parameters: {},
    async execute() {
      const view = await soul.view()
      const identity = view.identity
      const lines = [
        `名字：${identity.name === '' ? '（未设置）' : identity.name}`,
        `角色：${identity.role === '' ? '（未设置）' : identity.role}`,
        `语气：${identity.tone === '' ? '（未设置）' : identity.tone}`,
        `语言：${identity.language === '' ? '（未设置）' : identity.language}`,
        `准则：${identity.principles.length === 0 ? '（无）' : identity.principles.map((p, i) => `${i + 1}. ${p}`).join(' ')}`,
        `档案：${view.profileId ?? '默认层'}`,
        `版本：v${view.version}（${view.source === 'distill' ? '蒸馏' : '手动'}）`,
        '',
        view.content,
      ]
      return lines.join('\n')
    },
  })))

  disposers.push(tools.register(textTool({
    name: 'soul_set',
    description: '改写「灵魂」（顶层身份契约，跨会话恒定、每会话首步注入）。仅当用户明确要求修改人设/名字/语气/行为准则时使用；整段替换正文，不是追加。',
    parameters: {
      content: { type: 'string', required: true, description: '新的灵魂正文（markdown 人设契约）。整段替换，请保留仍要生效的既有内容。' },
      name: { type: 'string', description: '名字（留空表示不修改该字段）。' },
      role: { type: 'string', description: '一句话角色（留空表示不修改）。' },
      tone: { type: 'string', description: '语气（留空表示不修改）。' },
      language: { type: 'string', description: '语言（留空表示不修改）。' },
      principles: { type: 'array', items: { type: 'string' }, description: '行为准则列表（覆盖式；省略表示不修改）。' },
    },
    async execute(args) {
      const content = String(args.content ?? '').trim()
      if (content === '') throw new Error('content 不能为空；要清空灵魂请让用户直接在面板删除')
      // 先读一次当前生效视图：字段补齐与「写哪一层」都基于它。
      const snapshot = await soul.view()
      // 字段级「省略即不修改」：模型只给了正文时，不该把用户手写的名字清空。
      const next: SoulIdentity = normalizeIdentity({
        name: args.name !== undefined ? args.name : snapshot.identity.name,
        role: args.role !== undefined ? args.role : snapshot.identity.role,
        tone: args.tone !== undefined ? args.tone : snapshot.identity.tone,
        language: args.language !== undefined ? args.language : snapshot.identity.language,
        principles: args.principles !== undefined ? args.principles : snapshot.identity.principles,
      })
      // 写「当前生效的那一层」：激活了备用档案时写档案，否则写默认层。
      // 之前固定写默认层是错的——激活档案存在时 view() 返回的是档案内容，
      // 工具会回「已更新」而用户看到的人设纹丝不动（改了个看不见的地方）。
      // 两处写入都会同步卡片层（见 store.writeBase / writeProfile 注释），
      // 所以整段改写之后面板的卡片视图与注入内容仍然一致。
      if (snapshot.profileId !== null) {
        const profile = await soul.writeProfile(snapshot.profileId, content, next, 'manual')
        return `灵魂已更新（档案 ${profile.name} · v${profile.version}）：${next.name === '' ? '（未命名）' : next.name}·${next.role === '' ? '（未设角色）' : next.role}，正文 ${content.length} 字，卡片 ${profile.cards?.length ?? 0} 张。新会话首步生效。`
      }
      const view = await soul.writeBase(content, next, 'manual')
      const cardCount = (await soul.cards()).length
      return `灵魂已更新（v${view.version}）：${next.name === '' ? '（未命名）' : next.name}·${next.role === '' ? '（未设角色）' : next.role}，正文 ${content.length} 字，卡片 ${cardCount} 张。新会话首步生效。`
    },
  })))

  // ── 卡片级工具（schema v2：用户要求「每张卡单独设置」） ──────────────
  // 三条工具的分工刻意互斥：
  //   soul_cards      只读，列出现有卡片（模型改卡前必须先看现状，否则会重复建卡）
  //   soul_card_set   按 id 或 kind 覆盖/新建单张卡（最常用的「只改语气」路径）
  //   soul_card_remove 按 id 删卡
  // 不给「批量替换整个卡片集合」的工具：模型一次提交十张卡时，一张写坏就整体
  // 不一致，而它没有任何手段回滚；逐张改至少有明确的失败边界。

  disposers.push(tools.register(textTool({
    name: 'soul_cards',
    description: '列出当前「灵魂」的全部卡片（每张卡的 id/种类/标题/内容/是否启用/顺序）。改写卡片前先看现状，避免重复建卡。',
    parameters: {},
    async execute() {
      const cards = await soul.cards()
      if (cards.length === 0) return '当前没有任何灵魂卡片（灵魂为空，不会注入）。可用 soul_card_set 新建，或让用户在面板里应用一个预设。'
      const lines = cards.map(card =>
        `- [${card.enabled ? '启用' : '禁用'}] ${card.id} · ${SOUL_CARD_SECTION_TITLES[card.kind]} · ${card.title}\n  ${card.body.replace(/\n/g, '\n  ')}`)
      return `共 ${cards.length} 张灵魂卡片：\n${lines.join('\n')}`
    },
  })))

  disposers.push(tools.register(textTool({
    name: 'soul_card_set',
    description: '新建或改写「灵魂」里的一张卡片（按 id 或 kind 定位）。仅当用户明确要求调整人设的某一项（语气/准则/边界等）时使用；只动这一张卡，其余卡片原样保留。',
    parameters: {
      id: { type: 'string', description: '要改写的卡片 id（用 soul_cards 查）；省略时按 kind 定位第一张同种卡片，仍找不到则新建。' },
      kind: {
        type: 'string',
        enum: [...SOUL_CARD_KINDS],
        description: '卡片种类：identity 身份 / tone 语气与语言 / principles 行为准则 / boundaries 边界 / style 风格 / custom 自定义。',
      },
      title: { type: 'string', description: '卡片标题（≤40 字）。新建时省略会用种类名当标题。' },
      body: { type: 'string', required: true, description: '卡片内容（≤1200 字）。整张卡覆盖式写入，不是追加。' },
      enabled: { type: 'boolean', description: '是否参与注入（省略 = 保持原状；新建 = 启用）。' },
      order: { type: 'number', description: '注入与展示顺序（升序）。省略 = 保持原状；新建 = 排到最后。' },
    },
    async execute(args) {
      const body = String(args.body ?? '').trim()
      if (body === '') throw new Error('body 不能为空；要停用一张卡请传 enabled=false，要删除请用 soul_card_remove')
      const cards = await soul.cards()
      const byId = typeof args.id === 'string' && args.id.trim() !== ''
        ? cards.find(card => card.id === args.id!.trim())
        : undefined
      const kind = typeof args.kind === 'string' && (SOUL_CARD_KINDS as readonly string[]).includes(args.kind)
        ? args.kind as SoulCardKind
        : undefined
      const byKind = byId === undefined && kind !== undefined ? cards.find(card => card.kind === kind) : undefined
      const target = byId ?? byKind
      const card: SoulCard | null = normalizeCard({
        id: target?.id ?? (typeof args.id === 'string' ? args.id : undefined),
        kind: kind ?? target?.kind ?? 'custom',
        title: args.title !== undefined ? args.title : target?.title,
        body,
        enabled: args.enabled !== undefined ? args.enabled : (target?.enabled ?? true),
        order: args.order !== undefined ? args.order : target?.order,
      })
      if (card === null) throw new Error('卡片内容非法（标题与正文不能同时为空）')
      const next = await soul.mutateCards({ upsert: [card] })
      const saved = next.find(item => item.id === card.id) ?? card
      return `卡片已${target === undefined ? '新建' : '更新'}：${saved.id} · ${SOUL_CARD_SECTION_TITLES[saved.kind]} · ${saved.title}（${saved.enabled ? '启用' : '禁用'}，第 ${saved.order + 1} 张）。当前共 ${next.length} 张卡，新会话首步生效。`
    },
  })))

  disposers.push(tools.register(textTool({
    name: 'soul_card_remove',
    description: '删除「灵魂」里的一张卡片（按 id）。仅当用户明确要求移除某条人设内容时使用；只想临时停用请改用 soul_card_set 的 enabled=false。',
    parameters: {
      id: { type: 'string', required: true, description: '要删除的卡片 id（用 soul_cards 查）。' },
    },
    async execute(args) {
      const id = String(args.id ?? '').trim()
      if (id === '') throw new Error('id 不能为空')
      const before = await soul.cards()
      if (!before.some(card => card.id === id)) throw new Error(`卡片不存在：${id}（用 soul_cards 查当前 id）`)
      const next = await soul.mutateCards({ remove: [id] })
      return `卡片已删除：${id}。剩余 ${next.length} 张，新会话首步生效。`
    },
  })))

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** 工具展示身份（与记忆工具同款：面板卡片标题）。 */
const TOOL_PRESENTATION: Record<string, { kind: 'read' | 'other'; title: (args: Record<string, unknown>) => string }> = {
  soul_show: { kind: 'read', title: () => '查看灵魂' },
  soul_set: { kind: 'other', title: () => '改写灵魂' },
  soul_cards: { kind: 'read', title: () => '查看灵魂卡片' },
  soul_card_set: { kind: 'other', title: args => `改写灵魂卡片${typeof args.title === 'string' && args.title !== '' ? ` · ${args.title}` : ''}` },
  soul_card_remove: { kind: 'other', title: args => `删除灵魂卡片${typeof args.id === 'string' ? ` · ${args.id}` : ''}` },
}

/** 文本工具包装（与 memory/tools.ts 的 textTool 同款；本文件独立成模块不共享私有函数）。 */
function textTool<S extends ParameterSchemaSpec>(definition: {
  name: string
  description: string
  parameters: S
  execute: (args: InferArgs<S>, exec: { agent?: unknown }) => Promise<string>
}): ReturnType<typeof defineTool> {
  const presentation = TOOL_PRESENTATION[definition.name]
  return defineTool({
    ...definition,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: args => ({
      card: 'generic' as const,
      kind: presentation.kind,
      title: presentation.title(args as Record<string, unknown>),
      rawInput: args,
    }),
  })
}
