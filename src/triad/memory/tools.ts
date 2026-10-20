/**
 * dsh-memory 模型工具：AI 在对话中可主动调用的记忆操作。
 * memory_search / memory_remember / memory_pin / memory_verify / memory_tag
 * / memory_forget / memory_revise / memory_retire / memory_consolidate。
 * 全部经 @deepseek-ai/dsh-tools 的 defineTool 注册，输出为模型可见文本。
 */

import { defineTool } from '../../vendor/dsh-tools/schema.js'
import type { InferArgs, ParameterSchemaSpec } from '../../vendor/dsh-tools/schema.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ConsolidateResult, MemoryConfig } from './types.js'
import { projectHashOf, summarize, type MemoryStore } from './engine/store.js'
import { compileAll, workspaceHashOf } from './engine/compile.js'
import { consolidateAll, consolidateScope } from './engine/consolidate.js'
import { searchEntries, searchEntriesSemantic, type RetrievalMode } from './engine/retrieval.js'
import { resolveEmbeddingProvider, type EmbeddingProvider } from './engine/embedding.js'

/** 当前会话项目 hash（exec.agent 缺失时回退 null → global 或全部）。 */
interface AgentLike {
  readonly id: string
  readonly session: { readonly id: string; readonly header?: { cwd?: string } }
}

/** 注册全部记忆工具，返回合并 disposer。 */
export function registerMemoryTools(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
): () => void {
  const disposers: Array<() => void> = []

  // ── memory_search ────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_search',
    description: '搜索本地长期记忆（语义相似度 + 关键词，支持按内容/标签/项目/范围过滤）。用之前记住的决定、偏好、踩坑、项目上下文，或回答"我记得/之前说过"类问题时。',
    parameters: {
      query: { type: 'string', description: '搜索关键词（空格分隔多个词）。留空列出全部。' },
      scope: { type: 'string', enum: ['global', 'project'], description: 'global=全局层（身份/偏好）；project=项目层。默认全部。' },
      project: { type: 'string', description: '项目标识（workspace 路径或 hash）。默认当前工作区项目。' },
      tag: { type: 'string', description: '按标签筛选。' },
      mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'], description: '检索模式：hybrid=相似度+精确命中（默认）；keyword=仅精确子串；semantic=向量语义（需配置 embedding，未配置时回退 hybrid）。' },
      includeDeprecated: { type: 'boolean', description: '是否包含已软废弃（retire/revise 旧条目）的记忆。默认 false。' },
      limit: { type: 'integer', description: '返回条数上限（默认 10，最大 30）。' },
    },
    async execute(args, exec) {
      const entries = await store.readEntries()
      const agent = exec.agent as AgentLike | undefined
      const currentHash = agent !== undefined ? workspaceHashOf(agent.session.header) : null
      const projectFilter = typeof args.project === 'string' && args.project !== ''
        ? resolveProjectFilter(args.project)
        : currentHash
      const query = typeof args.query === 'string' ? args.query : ''
      const mode: RetrievalMode = args.mode === 'keyword' || args.mode === 'semantic' ? args.mode : 'hybrid'

      // 先做 scope/project/tag 硬过滤，再做检索排序。
      const visible = entries.filter(entry => {
        if (entry.scope === 'project' && projectFilter !== null && entry.projectHash !== projectFilter) return false
        if (typeof args.scope === 'string' && entry.scope !== args.scope) return false
        if (typeof args.tag === 'string' && args.tag !== '' && !entry.tags.includes(args.tag)) return false
        return true
      })

      const options = { includeDeprecated: args.includeDeprecated === true }
      const embeddingProvider = mode === 'semantic' ? await getEmbeddingProvider(config) : null
      const matches = mode === 'semantic'
        ? await searchEntriesSemantic(query, visible, embeddingProvider, options)
        : searchEntries(query, visible, mode, options)
      // semantic 检索会补算条目 embedding 缓存（原地写入内存态对象），一次节流刷盘。
      if (embeddingProvider !== null) await store.flush()
      const limit = Math.max(1, Math.min(30, typeof args.limit === 'number' ? args.limit : 10))
      const picked = matches.slice(0, limit)
      if (picked.length === 0) return '没有找到匹配的记忆。'
      const lines = picked.map(({ entry, score }) => {
        const head = entry.pinned ? '📌' : ''
        const scope = entry.scope === 'global' ? '全局' : '项目'
        const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
        const layer = entry.layer === 'long' ? '（长期）' : ''
        const verified = entry.verified ? '' : '〔待确认〕'
        // 禁用条目仍可被搜索到（避免「记忆凭空消失」），但明确标注不参与注入。
        const disabledMark = entry.disabled === true ? '〔已禁用·不参与注入〕' : ''
        // 软废弃条目（includeDeprecated 时才出现）：标注废弃状态。
        const deprecatedMark = entry.deprecated === true ? '〔已废弃·retire/revise 标记〕' : ''
        // pending 条目不会经由检索出现（searchEntries 恒定排除），但保留这个标记
        // 是为了兜底：万一将来有别的路径把 pending 带进结果集，模型也不会误以为
        // 它已生效。宁可白写一行，不要靠「调用方一定会过滤」这种隐式契约。
        const pendingMark = entry.pending === true ? '〔待确认·未生效〕' : ''
        const rel = query.trim() !== '' ? `·相关${Math.round(score * 100)}%` : ''
        // 单条正文截断：一条超长记忆（用户手记一整份规范）会把整个结果的预算
        // 吃掉，后面几条直接进不了输出。按条截断后每条都保留「开头 + 省略号」，
        // 模型能看出「这条被截了」，而不是在列表里看到半句残文。
        const body = entry.content.length > SEARCH_CONTENT_MAX
          ? `${entry.content.slice(0, SEARCH_CONTENT_MAX)}…`
          : entry.content
        // id 必须输出：memory_pin / memory_tag / memory_forget 都以 entryId 为入参，
        // 而它们的唯一来源就是本工具的结果。
        return `${entry.id} ${head}[${entry.importance}] ${scope}${layer}: ${body}${disabledMark}${deprecatedMark}${pendingMark}${verified}${rel}${tags}`
      })
      return capSearchOutput(lines)
    },
  })))

  // ── memory_remember ──────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_remember',
    description: '手动写入一条长期记忆（用户明确要求记住，或你判断值得跨会话保留的重要事实/决定）。',
    parameters: {
      content: { type: 'string', required: true, description: '要记住的内容。' },
      scope: { type: 'string', enum: ['global', 'project'], description: 'global=全局层（身份/偏好）；project=当前项目层。默认 project。' },
      tags: { type: 'array', items: { type: 'string' }, description: '分类标签（如 技术、踩坑、架构、偏好）。' },
      importance: { type: 'integer', description: '重要性 1-10（默认 8）。' },
    },
    async execute(args, exec) {
      const content = String(args.content ?? '').trim()
      if (content === '') throw new Error('content 不能为空')
      const agent = exec.agent as AgentLike | undefined
      const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null
      const scope = args.scope === 'global' ? 'global' as const : 'project' as const
      if (scope === 'project' && hash === null) {
        throw new Error('无法判定当前工作区项目（无 cwd），请用 scope: "global" 或稍后重试')
      }
      // 项目层写入受「自动记忆」开关约束：该项目关闭自动记忆时拒绝写入（global 层不受影响）。
      if (scope === 'project' && (hash === null || !(await store.isAutoMemoryEnabled(hash)))) {
        throw new Error('当前项目的自动记忆已关闭，已跳过记录；如需记录请先在记忆面板开启该项目开关')
      }
      const importance = typeof args.importance === 'number' ? Math.max(1, Math.min(10, args.importance)) : 8
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
        : []
      const { created, entry } = await store.upsertEntry({
        content,
        scope,
        projectHash: scope === 'project' ? hash : null,
        tags,
        importance,
        source: 'manual',
        // 溯源：手动记忆也记下写入它的会话（KR 右栏记忆卡按 sessionId 判定本会话新增）。
        provenance: agent !== undefined ? { sessionId: agent.session.id } : undefined,
      })
      // 项目层落盘时确保 meta.json 存在（面板项目列表可见）。
      if (scope === 'project' && hash !== null) {
        const meta = await store.readProjectMeta(hash)
        if (meta === undefined) {
          await store.writeProjectMeta(hash, {
            path: agent?.session.header?.cwd ?? '手动记忆',
            alias: null,
            locked: false,
          })
        }
      }
      await store.appendChange({
        action: created ? 'add' : 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: summarize(entry.content),
      })
      // 与 HTTP 路由（/remember、/pin、/tag、/delete）同口径：写入后统一走
      // compileAll 收口。它当前是空实现（注入改为内存现算，见 compile.ts 注释），
      // 但调用点必须补齐——否则将来它恢复落盘或加上逻辑索引时，只有面板改的
      // 记忆会进产物，模型工具改的那些永远漏在外面。
      await compileAll(store, config)
      return created
        ? `已记住：${entry.content}（${scope === 'global' ? '全局' : '项目'}${tags.length > 0 ? `，标签：${tags.join(', ')}` : ''}）`
        : `已更新记忆：${entry.content}`
    },
  })))

  // ── memory_pin ───────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_pin',
    description: '置顶/取消置顶一条记忆（置顶的记忆始终进入上下文注入并显示在置顶区）。',
    parameters: {
      entryId: { type: 'string', required: true, description: '记忆条目 id（用 memory_search 获取）。' },
      pinned: { type: 'boolean', description: 'true=置顶，false=取消。默认 true。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const entry = await store.patchEntry(id, { pinned: args.pinned !== false })
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      // 与 HTTP /pin 同口径（理由见 memory_remember 处注释）。
      await compileAll(store, config)
      return entry.pinned ? `已置顶：${summarize(entry.content)}` : `已取消置顶：${summarize(entry.content)}`
    },
  })))

  // ── memory_verify ────────────────────────────────────────────────────
  //
  // 为什么需要它：A 组把 patchEntry 的「编辑自动置 verified=true」去掉之后，
  // verified 的语义终于干净了（= 用户显式确认过这条内容），但也就意味着
  // **没有任何路径能把它置为 true 了**——memory_search 里那个〔待确认〕标记
  // 从此永远擦不掉。面板与模型各给一个显式入口，语义才闭环。
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_verify',
    description: '标记一条记忆「已确认」（或取消确认）。只应在用户明确认可/否定该条内容时调用，不要自己替用户确认。',
    parameters: {
      entryId: { type: 'string', required: true, description: '记忆条目 id（用 memory_search 获取）。' },
      verified: { type: 'boolean', description: 'true=已确认（默认），false=取消确认。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const verified = args.verified !== false
      const entry = await store.patchEntry(id, { verified })
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      // 不写变更流：确认状态是元数据微调，与置顶同理，不该给自己刷未读。
      // 仍走 compileAll 收口（理由见 memory_remember 处注释）。
      await compileAll(store, config)
      return verified
        ? `已确认：${summarize(entry.content)}`
        : `已取消确认：${summarize(entry.content)}`
    },
  })))

  // ── memory_tag ───────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_tag',
    description: '修改一条记忆的标签（覆盖式更新标签列表）。',
    parameters: {
      entryId: { type: 'string', required: true, description: '记忆条目 id。' },
      tags: { type: 'array', items: { type: 'string' }, required: true, description: '新的标签列表（覆盖旧的）。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
        : []
      const entry = await store.patchEntry(id, { tags })
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      await store.appendChange({
        action: 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `改标签：${summarize(entry.content)}`,
      })
      // 与 HTTP /update 同口径（理由见 memory_remember 处注释）。
      await compileAll(store, config)
      return `标签已更新：${entry.tags.length > 0 ? entry.tags.join(', ') : '（无）'}`
    },
  })))

  // ── memory_forget ────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_forget',
    description: '删除一条记忆（仅当用户明确要求删除/遗忘某条记忆时使用）。',
    parameters: {
      entryId: { type: 'string', required: true, description: '记忆条目 id（用 memory_search 获取）。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const entry = await store.getEntry(id)
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      const ok = await store.removeEntry(id)
      if (!ok) throw new Error(`记忆不存在：${id}`)
      await store.appendChange({
        action: 'delete',
        entryId: id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `删除：${summarize(entry.content)}`,
      })
      // 与 HTTP /delete 同口径（理由见 memory_remember 处注释）。
      await compileAll(store, config)
      return `已删除记忆：${summarize(entry.content)}`
    },
  })))

  // ── memory_revise ───────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_revise',
    description: '修订一条记忆：软废弃旧条目（保留数据但不再检索/注入），写入新内容作为后继条目。用于记忆过时/错误/需要重写时。返回新旧两个 id。',
    parameters: {
      entryId: { type: 'string', required: true, description: '要修订的旧条目 id（用 memory_search 获取）。' },
      content: { type: 'string', required: true, description: '新的记忆内容（作为后继条目）。' },
      reason: { type: 'string', description: '修订原因（记录在旧条目的废弃原因中）。' },
      tags: { type: 'array', items: { type: 'string' }, description: '后继条目的标签（缺省继承旧条目标签）。' },
      importance: { type: 'integer', description: '后继条目的重要度 1-10（缺省继承旧条目）。' },
    },
    async execute(args, exec) {
      const entryId = String(args.entryId ?? '')
      if (entryId === '') throw new Error('entryId 不能为空')
      const content = String(args.content ?? '').trim()
      if (content === '') throw new Error('content 不能为空')
      const agent = exec.agent as AgentLike | undefined
      const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null
      // 项目层受自动记忆开关约束（与 remember 一致）。
      const target = await store.getEntry(entryId)
      if (target === undefined) throw new Error(`记忆不存在：${entryId}`)
      if (target.scope === 'project' && (hash === null || !(await store.isAutoMemoryEnabled(target.projectHash ?? hash)))) {
        throw new Error('该项目的自动记忆已关闭，已跳过修订；如需记录请先在记忆面板开启该项目开关')
      }
      const result = await store.reviseEntry({
        id: entryId,
        content,
        reason: typeof args.reason === 'string' ? args.reason : undefined,
        tags: Array.isArray(args.tags)
          ? args.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
          : undefined,
        importance: typeof args.importance === 'number' ? Math.max(1, Math.min(10, args.importance)) : undefined,
        // 后继条目记本会话（新内容是本会话写的）。
        provenance: agent !== undefined ? { sessionId: agent.session.id } : undefined,
      })
      if (result === undefined) {
        // 旧条目不存在/已废弃 → 无法修订；内容未变化 → 无修订空间。
        const current = await store.getEntry(entryId)
        if (current !== undefined && current.deprecated !== true
          && current.content.trim() === content) {
          throw new Error('新内容与旧条目相同，无需修订；如需调整请用 memory_tag / memory_pin 或修改元数据')
        }
        throw new Error(`记忆不存在或已废弃：${entryId}`)
      }
      await store.appendChange({
        action: 'revise',
        entryId: result.deprecatedId,
        scope: target.scope,
        projectHash: target.projectHash,
        summary: `修订为：${summarize(result.entry.content)}`,
        before: target.content,
        after: result.entry.content,
      })
      await compileAll(store, config)
      return `已修订记忆：旧条目 ${result.deprecatedId} 已软废弃，新条目 ${result.newId} 已记录：${summarize(result.entry.content)}`
    },
  })))

  // ── memory_retire ───────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_retire',
    description: '软废弃一条记忆（retire）：数据保留但不再参与检索/注入/编译。用于「这条记忆过时了但不想彻底删除」的场景。彻底删除请用 memory_forget。',
    parameters: {
      entryId: { type: 'string', required: true, description: '要废弃的条目 id（用 memory_search 获取）。' },
      reason: { type: 'string', description: '废弃原因。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const entry = await store.retireEntry(id, typeof args.reason === 'string' ? args.reason : undefined)
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      await store.appendChange({
        action: 'retire',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `废弃：${summarize(entry.content)}`,
        before: entry.content,
      })
      await compileAll(store, config)
      return `已软废弃记忆：${summarize(entry.content)}（数据保留，不再注入；可用 memory_search includeDeprecated 查看）`
    },
  })))

  // ── memory_consolidate ───────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_consolidate',
    description: '整理本地记忆（合并重复/去重/精炼重写/删除低价值/提升长期）——即 openhanako 的 Memory Dream。每天会自动运行一次，也可手动触发。',
    parameters: {
      scope: { type: 'string', enum: ['all', 'global', 'project'], description: 'all=全局+全部项目；global=仅全局层；project=当前工作区项目。默认 all。' },
    },
    async execute(args, exec) {
      let results: ConsolidateResult[]
      if (args.scope === 'global') {
        results = [await consolidateScope(ctx, store, config, 'global', 'manual')]
      } else if (args.scope === 'project') {
        const agent = exec.agent as AgentLike | undefined
        const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null
        if (hash === null) throw new Error('无法判定当前工作区项目（无 cwd），请用 scope: "all" 或 "global"')
        results = [await consolidateScope(ctx, store, config, { projectHash: hash }, 'manual')]
      } else {
        results = await consolidateAll(ctx, store, config, 'manual')
      }
      const changed = results.reduce((sum, result) => sum + result.changed, 0)
      if (changed === 0) return '记忆已是最佳状态，本次整理无变动。'
      const lines = results.map(result =>
        `- ${result.scope}：合并 ${result.merged}、改写 ${result.rewritten}、删除 ${result.dropped}、提升长期 ${result.promoted}`)
      return `已整理记忆（${changed} 处变动）：\n${lines.join('\n')}`
    },
  })))

  // ── memory_pending ──────────────────────────────────────────────────
  //
  // 待确认制的工具面。为什么不复用 memory_verify：verify 只改可信度标记、
  // 不改可见性；pending 是可见性闸门，确认后要同时做「清 pending + 置 verified」，
  // 塞进 verify 会让那个工具的语义变成二义的（同一次调用既可能只是标可信、
  // 也可能顺手放行一条从未生效的记忆）。
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_pending',
    description: '列出待确认的自动记忆（pending）。这些是模型自动抽取、但用户还没确认的内容，不参与注入与检索。确认用 memory_confirm，拒绝用 memory_reject。',
    parameters: {
      limit: { type: 'number', description: '最多返回条数（默认 10）。' },
    },
    async execute(args) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10
      const pending = await store.listPending()
      if (pending.length === 0) return '当前没有待确认的记忆。'
      const shown = pending.slice(0, limit).map(entry => {
        const age = entry.pendingAt !== undefined ? entry.pendingAt.slice(0, 10) : entry.updatedAt.slice(0, 10)
        return `- ${entry.id}  [${entry.scope}] ${age}  ${summarize(entry.content)}`
      })
      const more = pending.length > shown.length ? `\n（另有 ${pending.length - shown.length} 条未显示）` : ''
      return `待确认记忆 ${pending.length} 条（不等于已生效，确认前不参与注入）：\n${shown.join('\n')}${more}`
    },
  })))

  // ── memory_confirm ──────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_confirm',
    description: '确认一条待确认记忆，让它正式生效（此后参与注入与检索）。只应在用户明确认可该内容时调用，不要自己替用户确认。',
    parameters: {
      entryId: { type: 'string', required: true, description: '待确认条目的 id（用 memory_pending 获取）。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const entry = await store.confirmPending(id)
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      await store.appendChange({
        action: 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `确认生效：${summarize(entry.content)}`,
        after: entry.content,
      })
      await compileAll(store, config)
      return `已确认并生效：${summarize(entry.content)}`
    },
  })))

  // ── memory_reject ───────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_reject',
    description: '拒绝（删除）一条待确认记忆。只能删待确认条目——已生效的记忆不可用本工具删除（请用 memory_forget）。',
    parameters: {
      entryId: { type: 'string', required: true, description: '待确认条目的 id（用 memory_pending 获取）。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const entry = await store.rejectPending(id)
      // 拒绝已生效条目是危险误操作（用户以为在清「待确认」，实际删了真记忆）。
      // 这里不静默返回 undefined，而是明确报错并指路到 memory_forget。
      if (entry === undefined) {
        const existing = await store.getEntry(id)
        if (existing === undefined) throw new Error(`记忆不存在：${id}`)
        throw new Error('该记忆不是待确认状态（已生效），拒绝操作被忽略。要删除已生效记忆请用 memory_forget。')
      }
      await store.appendChange({
        action: 'delete',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `拒绝待确认：${summarize(entry.content)}`,
        before: entry.content,
      })
      await compileAll(store, config)
      return `已拒绝并删除：${summarize(entry.content)}`
    },
  })))
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/**
 * memory_search 单条正文的字符上限。
 *
 * 记忆条目允许写很长（用户手动记一条完整规范并不罕见），而搜索结果是一条
 * 一条并排输出的：单条不封顶时，10 条各 800 字就能顶到 8000+ 字符。
 */
const SEARCH_CONTENT_MAX = 400

/**
 * memory_search 整段输出的字符上限（6000）。
 *
 * 官方 dsh-compaction-tool-result-pruner 的阈值是 8192，超了会**保留头 4096 +
 * 尾 1024、从中间腰斩**。对「一行一条记忆」的列表来说，被腰斩掉的正是中间那几条
 * ——模型会看到第 1-2 条与最后 1 条，中间凭空消失，还以为搜索结果只有这些。
 * 所以本工具在 6000 就自己截断：一是低于裁剪器阈值，二是截断处明确告诉模型
 * 「结果被截了、怎么拿到剩下的」，比无声腰斩可解释得多。
 */
const SEARCH_OUTPUT_MAX = 6000

/** 搜索结果的收尾提示（entryId 是后续所有记忆工具的入参，必须每轮都带上）。 */
const SEARCH_TAIL = '\n（首列为 entryId，可用于 memory_pin / memory_verify / memory_tag / memory_forget / memory_revise / memory_retire）'

/** 截断提示的预留长度（含「另有 N 条未显示」里 N 的位数余量）。 */
const SEARCH_TRUNC_HINT_RESERVE = 80

/**
 * 搜索结果整体封顶。
 *
 * 逐条累加而不是先 join 再 slice：先 join 再切会把最后一行切成半截（半个 entryId
 * + 半句正文），模型拿半截 id 去调 memory_pin 只会得到一个「记忆不存在」。
 * 截断时把被丢弃的条数写进提示，让「还有多少条没看到」是可数的。
 */
function capSearchOutput(lines: string[]): string {
  // 收尾提示与截断提示都从预算里扣掉，6000 才是真的硬上限（而不是「正文 6000
  // 再加两段提示」）。
  const budget = SEARCH_OUTPUT_MAX - SEARCH_TAIL.length - SEARCH_TRUNC_HINT_RESERVE
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    // +1 = 换行符。第一条不占换行，多算一个字符无伤大雅（预算本就留了余量）。
    const cost = line.length + 1
    if (used + cost > budget) break
    kept.push(line)
    used += cost
  }
  // 全部装下：原样输出（不追加任何截断提示，避免模型误以为有遗漏）。
  if (kept.length === lines.length) return `${lines.join('\n')}${SEARCH_TAIL}`
  const dropped = lines.length - kept.length
  return `${kept.join('\n')}\n…（另有 ${dropped} 条未显示）结果过长已截断，请用更窄的 query 或更小的 limit${SEARCH_TAIL}`
}

/** 按路径或 hash 解析项目筛选；解析失败返回 null（不筛）。 */
function resolveProjectFilter(project: string): string | null {
  const trimmed = project.trim()
  if (trimmed === '') return null
  // 直接 hash。
  if (/^[0-9a-f]{12}$/.test(trimmed)) return trimmed
  // 路径 → hash。
  return projectHashOf(trimmed)
}

/** 模块级 embedding provider 缓存（按 config 惰性创建，避免每次检索都重建）。 */
let cachedProvider: EmbeddingProvider | null | undefined
let cachedProviderKey = ''

async function getEmbeddingProvider(config: MemoryConfig): Promise<EmbeddingProvider | null> {
  const key = `${config.embeddingProvider}|${config.embeddingBaseUrl}|${config.embeddingModel}`
  if (cachedProviderKey === key) return cachedProvider ?? null
  cachedProviderKey = key
  cachedProvider = resolveEmbeddingProvider(config)
  return cachedProvider
}

/** 工具展示身份。 */
const TOOL_PRESENTATION: Record<string, { kind: 'read' | 'other'; title: (args: Record<string, unknown>) => string }> = {
  memory_search: { kind: 'read', title: args => `记忆搜索：${String(args.query ?? '')}` },
  memory_remember: { kind: 'other', title: () => '记录记忆' },
  memory_pin: { kind: 'other', title: args => `置顶：${String(args.entryId ?? '')}` },
  memory_verify: { kind: 'other', title: args => `确认：${String(args.entryId ?? '')}` },
  memory_tag: { kind: 'other', title: args => `改标签：${String(args.entryId ?? '')}` },
  memory_forget: { kind: 'other', title: args => `删除：${String(args.entryId ?? '')}` },
  memory_revise: { kind: 'other', title: args => `修订：${String(args.entryId ?? '')}` },
  memory_retire: { kind: 'other', title: args => `废弃：${String(args.entryId ?? '')}` },
  memory_pending: { kind: 'other', title: () => '待确认的记忆' },
  memory_confirm: { kind: 'other', title: args => `确认：${String(args.entryId ?? '')}` },
  memory_reject: { kind: 'other', title: args => `拒绝：${String(args.entryId ?? '')}` },
  memory_consolidate: { kind: 'other', title: () => '整理记忆' },
}

/** 文本工具包装（openviking 同款模式，泛型保留参数推断）。 */
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
