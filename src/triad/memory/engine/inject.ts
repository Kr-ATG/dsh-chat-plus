/**
 * dsh-memory 注入引擎：agent/pre-step 把「全局 identity + 当前项目 memory +
 * pinned + facts」组装为一条带来源的 user message 注入（source: { kind: 'plugin' }）。
 * 绝不写 system prompt（DSH persona complete:true 会静默丢弃）；
 * 只注入当前工作区项目 + 全局层；token 超预算按重要性截断，最低保留置顶。
 * 命中刷新：被注入的条目距上次命中 ≥1 天时刷新 lastHitAt 并加分。
 *
 * 除主注入外，本文件还承载三条**内置通道**（zh 中文偏好 / diagram 流程图规范 /
 * soul 顶层身份契约）：各自独立 stepCounters、各自全局开关、每会话只注首步、
 * 位置一律在「项目排除 + 主注入开关」两道闸门之前，失败只记日志。
 */

import { createUserMessage } from '../../../vendor/dsh-llm/index.js'
import type { MemoryConfig } from '../types.js'
import { buildChineseInjectionText, buildInjectionText, selectChineseEntries, selectInjectionEntries, workspaceHashOf } from './compile.js'
import { searchEntries } from './retrieval.js'
import { daysSince } from './scoring.js'
import type { MemoryStore } from './store.js'

/** pre-step 载荷的最小 agent 面。 */
export interface PreStepAgent {
  readonly id: string
  readonly session: {
    readonly id: string
    readonly header?: { cwd?: string }
  }
}

/**
 * 灵魂通道的读取面。
 *
 * 刻意只要求一个方法而不是 import SoulStore 类型：注入引擎不该知道 Soul 的存储
 * 布局（数据根、档案切换、原子写都在 store 里），它只问一句「现在要注入的正文是
 * 什么」。这样 Soul 模块整体坏掉时，这里拿到的是 '' 而不是一个 import 期崩溃。
 * 卡片化（schema v2）改的是这个方法的**内部实现**，签名与语义不变：仍然返回
 * 「现在要注入的正文」，空串 = 不注入。
 */
export interface SoulSource {
  /** 当前灵魂正文（卡片装配结果；空串 = 无内容，不注入）。 */
  injectionContent(): Promise<string>
}

export interface MemoryInjector {
  /** 注入监听器（注册时用 prepend: true）。 */
  preStepListener: (payload: {
    agent: PreStepAgent
    messages: unknown[]
    signal: AbortSignal
  }, next: () => Promise<{ kind: 'enter'; messages: unknown[] } | { kind: 'reject' }>) => Promise<unknown>
  /** 清理会话级状态。 */
  disposeSession: (sessionId: string) => void
}

/** 每次注入最多刷新的命中条目数。 */
const MAX_HITS_PER_INJECTION = 5

/** ContentBlock[] 或字符串 → 纯文本。 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      if (typeof part !== 'object' || part === null) return ''
      const record = part as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .join(' ')
}

/** 从 pre-step 消息里提取当前用户输入文本（作检索 query；跳过插件/指令注入源）。 */
function extractQuery(messages: unknown[]): string {
  const texts: string[] = []
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const msg = message as { role?: string; source?: { kind?: string }; content?: unknown }
    if (typeof msg.source?.kind === 'string' && msg.source.kind !== 'user') continue
    if (msg.role !== 'user' && msg.role !== undefined) continue
    texts.push(textOf(msg.content))
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * 内置安全规范（每次注入都携带）：敏感凭据严禁提交/更新到 GitHub。
 * 与提取敏感过滤、面板风险提示共同构成凭据防线。
 */
const SAFETY_RULE = [
  '【安全规范】所有 GitHub/OpenAI/AWS/Slack token、私钥、password 等敏感凭据',
  '严禁提交或更新到 GitHub 仓库；代码中一律用环境变量引用，',
  '并确保 .gitignore 排除含凭据的文件。',
].join('')

/**
 * 中文记忆内置通道的引导语。
 *
 * 单独成块而非并入主注入的理由：主注入整体可能处于关闭状态（用户显式关掉、
 * 项目被标记为不注入），但语言契约必须仍然成立——否则同一个用户在不同会话
 * 得到互相矛盾的回答语言。措辞里显式声明它与项目指令的优先关系，避免和
 * AGENTS.md 打架。
 */
const ZH_INJECTION_RULE = [
  '【中文偏好记忆 · 内置通道】以下为用户长期语言偏好，与上方记忆库开关无关，始终生效。',
  '请始终遵循：内部分析/推理过程与对外输出默认使用简体中文。',
  '代码、路径、命令、标识符、报错原文、API/协议名等技术内容保持原文不翻译。',
  '（若与当前项目的 AGENTS.md / 项目指令或系统提示冲突，一律以项目指令为准。）',
].join('\n')

/**
 * 中文通道的注入预算：只投 preference/identity 子集，给多了纯浪费。
 *
 * 口径是**字符数**不是 token 数（buildChineseInjectionText 直接比 length），
 * 中文 1 字符 ≈ 1 token 以上，所以这里的数字基本等于实烧 token。
 *
 * 2026-10-05 由 1500 提到 2500：实测本机 26 条候选全量装配需 2087 字符，
 * 1500 只装得下 16 条，被丢的恰恰是 reduced-motion 兜底、容器查询响应式、
 * 最小改动不重构这几条——全是做 UI 时最该在场的偏好，且长条目更容易被
 * 预算挤掉，截断结果与 importance 排序并不同向。2500 留约 20% 余量给后续
 * 新增条目，再多就是拿常驻 token 换永远不会被读到的尾巴。
 */
const ZH_INJECTION_BUDGET = 2500

/**
 * 对话内流程图（diagram 围栏）能力规范注入文本。
 *
 * 为什么需要它：客户端的 `splitDiagram()` 会拦截正文里的 ```diagram 围栏并
 * 渲染成 SVG 卡片，但**模型默认完全不知道这个围栏存在**——渲染器、样式、
 * README 全在，指令侧是空的。这是「有渲染器、没接线」的典型缺口。
 *
 * 与 zh 通道的差异：zh 投的是记忆条目（动态检索 + 预算截断），这里投的是一段
 * 纯静态规范文本，不读条目、不做检索、不参与命中加分——它是能力声明，不是记忆。
 *
 * 措辞刻意写清「非法静默回退」：模型对 JSON 围栏的容错直觉很强，但本解析器
 * 遇到非法结构不报错、直接把围栏当普通代码块显示。不知道这点，模型会以为出图
 * 失败然后重试越修越乱。
 */
const DIAGRAM_INJECTION_RULE = [
  '【对话内流程图 · 内置通道】本客户端的对话流会把 ```diagram 代码围栏渲染成可交互的 SVG 流程图卡片。',
  '需要画流程图时输出下面这种围栏（内容为单行 JSON）。不要用 mermaid——mermaid 只在对话截图里被渲染，对话流里始终是代码块。',
  '',
  '格式：{"type":"flowchart","title":"标题","desc":"一句话","size":"full","nodes":[…],"edges":[…]}',
  '',
  'nodes（1–9 个）：{"id":"唯一标识","shape":"oval|rect|diamond","x":0,"y":0,"w":160,"h":48,"name":"主标签","sub":"副标签","focal":false}',
  '  · shape：oval=起止，rect=步骤，diamond=判断（最多 3 个出口）。形状承担类型，颜色不承担。',
  '  · 坐标：x∈[0,800]、y∈[0,1000]，建议对齐 4 的网格；w∈[40,400]、h∈[32,200]。',
  '  · name ≤14 字，sub ≤24 字（compact 模式不渲染 sub）。',
  '  · focal=true 走品牌橙高亮，整图最多用一个，标在主干或最关键的那个节点上。',
  '',
  'edges（0–12 条）：每条由两端节点 id、分支文字、高亮开关、折线点数组四个字段组成——',
  '  字段名依次是 from（起点节点 id）、to（终点节点 id）、label（分支文字，≤8 字）、accent（是否橙色高亮）、pts（[[x,y],[x,y]] 这样的点数组）。',
  '  · pts 是完整折线点，必须含起点与终点、2–8 个点、坐标为数字；拐角圆角由渲染器自动倒，label 画在水平边中点。',
  '  · 流向自上而下；判断分支一律要标 label（如「是」「否」「超限」），未标分支的判断图是反模式。',
  '  · accent=true 的连线是橙箭头：只标主干或最关键的那条分支，不要每条都标。',
  '',
  '硬性约束（违反会**静默回退成代码块**，不报错、也不会告诉你失败）：',
  '  · type 必须是 "flowchart"；节点 id 不得重复；edges 的 from/to 必须是已声明的节点 id。',
  '  · 节点 ≤9、边 ≤12。图复杂了就别硬塞——用文字或表格说清楚，或改用 mermaid。',
  '  · 一条回复里最多一个 diagram 围栏。',
  '',
  '两条纪律：',
  '  · 图是补充不是正文：先给文字结论或步骤清单，再决定要不要附一张图，不要为画图而画图。',
  '  · 该围栏只在「Seeker」视图渲染，普通「对话」视图里会原样显示成代码块。你无法确知当前处于哪个视图——若这次任务明确要出图供人阅读，优先用 mermaid（截图能出真图）。',
].join('\n')

/**
 * 灵魂（Soul）通道的注入头部。
 *
 * 与 zh / diagram 的差异：那两条投的是**插件内置**的文本（语言契约、渲染规范），
 * 这一条投的是**用户自己写的**人设。因此头部措辞要显式声明两件事：
 *  1. 它是「顶层身份契约」，优先于模型的默认人格设定 —— 不写这句，模型会把
 *     它当成又一段参考资料，语气照旧。
 *  2. 它**不覆盖**项目指令 —— 灵魂是全局恒定的，而 AGENTS.md 是本工作区的硬约束；
 *     不写优先级，模型在「灵魂说英文、项目说中文」时只能靠猜。
 *
 * 正文由 SoulStore.injectionContent() 提供，**schema v2 起是卡片装配结果**
 * （按 order 升序、只取启用卡、每 kind 一个段标题、2000 字符硬预算丢整张卡）。
 * 这个文件刻意不知道卡片的存在：它只问一句「现在要注入什么」，装配与预算都在
 * soul/cards.ts 里，改装配策略不需要动注入引擎。
 */
const SOUL_INJECTION_HEADER = [
  '【灵魂 · 内置通道】以下是用户的顶层身份契约（名字/角色/语气/语言/行为准则），跨会话恒定，优先于模型的默认人格设定。',
  '（若与当前项目的 AGENTS.md / 项目指令或系统提示冲突，一律以项目指令为准。）',
].join('\n')

/** 创建注入器。 */
export function createMemoryInjector(
  store: MemoryStore,
  config: MemoryConfig,
  logger: { debug?: (message: string) => void; warn?: (message: string) => void } | undefined,
  soulSource?: SoulSource,
): MemoryInjector {
  /** 每会话 step 计数（仅内存）。 */
  const stepCounters = new Map<string, number>()
  /**
   * 中文通道的每会话 step 计数，**必须独立于 stepCounters**。
   *
   * 共用一个 Map 会互相抢占首步名额：主注入先跑就把 sessionId 记上，中文
   * 通道随后的 has() 命中而静默跳过——而主注入恰恰在最常被关闭的那条路径上
   * 提前 return，来不及置位，反而是中文通道把它占了。两边各记各的。
   */
  const zhStepCounters = new Map<string, number>()

  /**
   * diagram 通道的每会话 step 计数，理由同 zhStepCounters——三条内置通道各记
   * 各的，共用一个 Map 会互相抢占首步名额。
   */
  const diagramStepCounters = new Map<string, number>()

  /**
   * soul 通道的每会话 step 计数，理由同 zhStepCounters——四条通道各记各的，
   * 共用一个 Map 会互相抢占首步名额。
   */
  const soulStepCounters = new Map<string, number>()

  async function buildMemoryBlock(
    agent: PreStepAgent,
    query: string,
  ): Promise<{ text: string; sections: Array<{ name: string; text: string }> } | null> {
    const entries = await store.readEntries()
    const hash = workspaceHashOf(agent.session.header)
    // disabled 条目保留在库与检索中，但绝不参与注入；
    // deprecated 条目（软废弃）同样不参与注入。
    const visible = entries.filter(entry =>
      entry.disabled !== true && entry.deprecated !== true &&
      (entry.scope === 'global' || (entry.scope === 'project' && entry.projectHash === hash)))
    if (visible.length === 0) return null

    // 常驻：pinned（无条件）+ 全局身份/偏好 + 长期沉淀；其余按当前任务检索 top-k。
    const pinned = visible.filter(entry => entry.pinned)
    const identity = visible.filter(entry =>
      entry.scope === 'global' && !entry.pinned && (entry.kind === 'identity' || entry.kind === 'preference'))
    const longterm = visible.filter(entry =>
      entry.layer === 'long' && !entry.pinned && !identity.includes(entry))
    const rest = visible.filter(entry =>
      !pinned.includes(entry) && !identity.includes(entry) && !longterm.includes(entry))
    const topK = query.trim() === ''
      ? selectInjectionEntries(rest, config.compileThreshold).slice(0, config.injectTopK)
      : searchEntries(query, rest, 'hybrid').slice(0, config.injectTopK).map(match => match.entry)
    const selected = [...pinned, ...identity, ...longterm, ...topK]
    if (selected.length === 0) return null

    // 命中刷新：从未命中或距上次命中 ≥1 天的条目加分并重置衰减起点（最多 MAX_HITS 条）。
    const hitCandidates = selected
      .filter(entry => entry.lastHitAt === null || daysSince(entry.lastHitAt) >= 1)
      .slice(0, MAX_HITS_PER_INJECTION)
    if (hitCandidates.length > 0) {
      const hitIds = new Set(hitCandidates.map(entry => entry.id))
      const refreshed = await store.applyHits(hitIds, config.hitBonus)
      logger?.debug?.(`[dsh-memory] hit refresh: ${refreshed} entries`)
    }

    return buildInjectionText(selected, config)
  }

  /**
   * 构建中文记忆块（内置通道）。
   *
   * 与 buildMemoryBlock 的三处刻意差异：
   *  1. 不看 isInjectExcluded —— 项目级「不注入」管的是记忆库整体，不该
   *     顺带掐掉语言契约；
   *  2. 不做检索 top-k —— 中文偏好条目本来就少且全是高 importance，全量带上；
   *  3. 不做命中刷新加分 —— 每会话每轮都注入同一批，刷新会把它顶到封顶，
   *     反而污染主注入的 importance 排序。
   */
  async function buildChineseBlock(agent: PreStepAgent): Promise<string> {
    const entries = await store.readEntries()
    const selected = selectChineseEntries(entries, workspaceHashOf(agent.session.header))
    if (selected.length === 0) return ''
    return buildChineseInjectionText(selected, ZH_INJECTION_BUDGET)
  }

  const preStepListener: MemoryInjector['preStepListener'] = async (payload, next) => {
    let decision: { kind: 'enter'; messages: unknown[] } | { kind: 'reject' }
    try {
      // next() 抛错（下游 listener 失败）绝不能扩散：DSH 会把 pre-step
      // 失败上报为 turn 错误，但我们要保证本插件永远不成为崩溃源。
      decision = await next()
    } catch (error) {
      logger?.warn?.(`[dsh-memory] pre-step next() failed: ${error instanceof Error ? error.message : String(error)}`)
      return { kind: 'reject' }
    }
    if (decision.kind !== 'enter' || payload.signal.aborted) return decision
    const sessionId = payload.agent.session.id
    const hash = workspaceHashOf(payload.agent.session.header)

    // ── 中文记忆内置通道 ──────────────────────────────────────────────
    // 位置是刻意的：在下面两道闸门（项目排除 / 主开关）**之前**求值。这两道
    // 闸门回答的是「记忆库整体要不要进上下文」，而中文通道回答的是「用户的
    // 语言契约是否成立」，两者正交。放在闸门之后，就等于主开关一关中文记忆
    // 跟着消失，那这条通道就没有存在意义了。
    let messages = decision.messages
    const zhEnabled = await store.isZhInjectEnabled(config.zhInjectDefaultEnabled !== false)
    if (!zhEnabled) {
      logger?.debug?.('[dsh-memory] zh injection off (switch disabled)')
    } else if (!zhStepCounters.has(sessionId)) {
      zhStepCounters.set(sessionId, 1)
      try {
        const zhText = await buildChineseBlock(payload.agent)
        if (zhText !== '') {
          messages = [...messages, createUserMessage({
            content: [{ type: 'text', text: `${ZH_INJECTION_RULE}\n\n${zhText}` }],
            source: {
              kind: 'plugin:dsh-memory',
              plugin: 'dsh-memory',
              form: 'snapshot',
              sections: [{ name: '中文偏好记忆', text: zhText }],
            },
          })]
          logger?.debug?.(`[dsh-memory] zh injection ok (${zhText.length} chars)`)
        } else {
          logger?.debug?.('[dsh-memory] zh injection skipped (no chinese entries)')
        }
      } catch (error) {
        // 中文通道失败绝不能影响主注入：记日志后继续往下走。
        logger?.warn?.(`[dsh-memory] zh injection failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // ── 对话内流程图能力规范注入（内置通道） ──────────────────────────
    // 位置同样刻意：两道闸门之前，与中文通道并列。它回答的是「本客户端支持
    // 什么呈现能力」，跟「记忆库要不要进上下文」正交。
    const diagramEnabled = await store.isDiagramInjectEnabled(config.diagramInjectDefaultEnabled !== false)
    if (!diagramEnabled) {
      logger?.debug?.('[dsh-memory] diagram injection off (switch disabled)')
    } else if (!diagramStepCounters.has(sessionId)) {
      diagramStepCounters.set(sessionId, 1)
      try {
        messages = [...messages, createUserMessage({
          content: [{ type: 'text', text: DIAGRAM_INJECTION_RULE }],
          source: {
            kind: 'plugin:dsh-memory',
            plugin: 'dsh-memory',
            form: 'snapshot',
            sections: [{ name: '对话内流程图', text: DIAGRAM_INJECTION_RULE }],
          },
        })]
        logger?.debug?.('[dsh-memory] diagram injection ok')
      } catch (error) {
        // 失败绝不能影响主注入与中文通道。
        logger?.warn?.(`[dsh-memory] diagram injection failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // ── 灵魂（Soul）顶层身份契约注入（内置通道） ─────────────────────
    // 位置与理由同上面两条内置通道：两道闸门**之前**。灵魂回答的是「这个助手
    // 是谁」，跟「记忆库要不要进上下文」正交；放到闸门之后，用户一关主注入
    // 人设就跟着消失，而人设恰恰是最该跨会话恒定的那部分。
    // 没有任何启用卡片（或卡片正文全空）时 injectionContent() 返回空串，整条通道
    // 静默跳过——默认模板只在面板里当编辑起点，绝不冒充用户人设注入。
    if (soulSource !== undefined) {
      const soulEnabled = await store.isSoulInjectEnabled(config.soulInjectDefaultEnabled !== false)
      if (!soulEnabled) {
        logger?.debug?.('[dsh-memory] soul injection off (switch disabled)')
      } else if (!soulStepCounters.has(sessionId)) {
        soulStepCounters.set(sessionId, 1)
        try {
          const soulText = await soulSource.injectionContent()
          if (soulText !== '') {
            messages = [...messages, createUserMessage({
              content: [{ type: 'text', text: `${SOUL_INJECTION_HEADER}\n\n${soulText}` }],
              source: {
                kind: 'plugin:dsh-memory',
                plugin: 'dsh-memory',
                form: 'snapshot',
                sections: [{ name: '灵魂', text: soulText }],
              },
            })]
            logger?.debug?.(`[dsh-memory] soul injection ok (${soulText.length} chars)`)
          } else {
            logger?.debug?.('[dsh-memory] soul injection skipped (no enabled cards)')
          }
        } catch (error) {
          // 灵魂通道失败绝不能影响主注入与其它通道：记日志后继续往下走。
          logger?.warn?.(`[dsh-memory] soul injection failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    // 项目注入排除：被排除的工作区里，会话不注入**记忆库条目**（用户在面板
    // 项目上下文条里按项目关闭注入）。判定在会话级开关之前——排除是项目级
    // 硬闸，会话级开关管不到它。注意这不再影响上面已产出的中文块。
    if (hash !== null && await store.isInjectExcluded(hash)) {
      logger?.debug?.(`[dsh-memory] injection skipped (project excluded): ${hash}`)
      return { kind: 'enter', messages }
    }
    // 该会话的记忆注入开关（对话框旁开关控制）：会话里手动开/关优先，
    // 没单独设置过则跟随 config.injectDefaultEnabled（面板「默认开启」）。
    if (!(await store.isInjectEnabled(sessionId, config.injectDefaultEnabled !== false))) {
      return { kind: 'enter', messages }
    }
    // 每个会话只在首步注入一次：后续轮次不再重复注入，
    // 避免置顶/记忆内容在多轮里反复出现（用户明确要求仅首轮注入）。
    if (stepCounters.has(sessionId)) return { kind: 'enter', messages }
    stepCounters.set(sessionId, 1)
    try {
      // 检索 query 刻意取 payload.messages（原始）而非已追加中文块的 messages：
      // 否则中文偏好记忆会参与本次任务的相似度检索，等于自己检索自己。
      const query = extractQuery(payload.messages)
      const block = await buildMemoryBlock(payload.agent, query)
      if (block === null || block.text === '') return { kind: 'enter', messages }
      // 注入引导：明确记忆属于用户指令/参考，模型应"该执行就执行"；
      // 同时声明优先级——与 AGENTS.md/项目指令/系统提示冲突时，以项目指令为准，
      // 记忆不覆盖项目级规范（避免与项目指令打架）。
      const wrapped = [
        SAFETY_RULE,
        '【长期记忆 · 用户要求按需执行或参考】',
        '（若与当前项目的 AGENTS.md / 项目指令或系统提示冲突，一律以项目指令为准；记忆仅作参考与用户偏好补充）',
        block.text,
      ].join('\n')
      const memoryMessage = createUserMessage({
        content: [{ type: 'text', text: wrapped }],
        source: {
          kind: 'plugin:dsh-memory',
          plugin: 'dsh-memory',
          form: 'snapshot',
          sections: [{ name: '安全规范', text: SAFETY_RULE }, ...block.sections],
        },
      })
      return { kind: 'enter', messages: [...messages, memoryMessage] }
    } catch (error) {
      // 注入失败绝不阻塞对话。
      logger?.warn?.(`[dsh-memory] injection failed: ${error instanceof Error ? error.message : String(error)}`)
      return { kind: 'enter', messages }
    }
  }

  return {
    preStepListener,
    disposeSession: (sessionId: string) => {
      stepCounters.delete(sessionId)
      zhStepCounters.delete(sessionId)
      diagramStepCounters.delete(sessionId)
      soulStepCounters.delete(sessionId)
    },
  }
}
