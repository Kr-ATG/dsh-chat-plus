/**
 * dsh-memory 注入引擎：agent/pre-step 把「全局 identity + 当前项目 memory +
 * pinned + facts」组装为一条带来源的 user message 注入（source: { kind: 'plugin' }）。
 * 绝不写 system prompt（DSH persona complete:true 会静默丢弃）；
 * 只注入当前工作区项目 + 全局层；token 超预算按重要性截断，最低保留置顶。
 * 命中刷新：被注入的条目距上次命中 ≥1 天时刷新 lastHitAt 并加分。
 *
 * 除主注入外，本文件还承载四条**内置通道**（zh 中文偏好 / html+iu 卡片规范 /
 * soul 顶层身份契约 / team 团队协作）：各自独立 stepCounters、各自全局开关、
 * 每会话只注首步、位置一律在「项目排除 + 主注入开关」两道闸门之前，失败只记日志。
 */

import { createUserMessage } from '../../../vendor/dsh-llm/index.js'
// iu kind 注册表（**纯逻辑**，host 半身可用）：注入文档直接取每个 kind 自带
// 的 doc 行，不再在这里手写示例——手写必然漂移（piano 的 showNotes 字段实现了
// 但文档从没提过，模型永远不知道能用它）。文档跟着实现走。
import { iuKindsDoc, IU_KIND_NAMES } from '../../../client/iu/kinds/registry.ts'
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
 * 对话内 HTML 卡片（html 围栏）能力规范注入文本。
 *
 * 客户端 `splitHtml()` 会拦截正文里的 ```html
 * 围栏并渲染成沙箱 iframe 卡片，但模型默认不知道这个围栏存在——又是「有渲染器、
 * 没接线」。这里补的是指令侧那一半。
 *
 * 措辞里刻意写清三条**沙箱事实**，因为模型对 HTML 的默认直觉全都基于普通浏览器：
 *  · 没有 same-origin —— localStorage / 宿主 DOM / 外部接口调用都拿不到；
 *  · 高度必须自适应（宿主按上报高度给框，写死 100vh 会撑出滚动条）；
 *  · 不引外网资源（CDN 脚本在内网/离线环境直接白屏）。
 * 不写这三条，模型会写出「能跑但什么都不显示」的卡片，而且它自己看不到结果。
 */
const HTML_INJECTION_RULE = [
  '【对话内 HTML 卡片 · 内置通道】本客户端的对话流会把 ```html 代码围栏渲染成一张可交互的沙箱卡片（独立 iframe，带预览/源码切换、复制、重载、全屏）。',
  '需要给出「能点、能动、能算」的东西时用它：小工具、计算器、图表、可视化、演示页、单页原型。纯静态说明文字不要用它。',
  '',
  '格式：直接写 ```html 围栏，围栏正文就是完整可运行的 HTML（片段或整篇文档都行）。',
  '',
  '沙箱事实（不知道这些会写出「能跑但什么都不显示」的卡片）：',
  '  · iframe 只有 allow-scripts，**没有 same-origin**：拿不到宿主页面与 DOM，localStorage / cookie / 宿主接口一律不可用；也不要假设能读外部接口。',
  '  · 高度自适应：宿主按内容真实高度给框。不要写 height:100vh、不要给 body 加固定高度，否则会出现内部滚动条或大片空白。',
  '  · 不引外部资源：CDN 脚本、外链字体、外链图片在离线或内网环境直接白屏。CSS 与 JS 全部内联，图形用内联 SVG / canvas 画。',
  '  · 点击链接会开新标签页（文档已设 base target=_blank），不要在卡片内部做整页跳转。',
  '  · 深浅主题：宿主会把明暗状态以 html[data-ds-dark-theme] 属性同步进来，可用它写两套配色；不写就跟随 color-scheme。',
  '  · 回写输入框：页面里调用 window.__dshFill(text) 可把当前结果（如计算得数、换算份量）填入用户输入框，由用户检查后发送；不要自动发送。',
  '',
  '硬性约束：',
  '  · 单张卡片正文 ≤ 80KB，超出会静默回退成普通代码块（不报错、也不会告诉你失败）。',
  '  · 围栏语言标记必须正好是 html（```html-preview 这类不算）。',
  '  · 一条回复里可以有多张卡片：文字解说与卡片穿插混排，简单问答仍用纯文本，不要为放卡而放卡。',
  '  · **围栏正文必须是完整可直接运行的内容；严禁只写一行注释/占位文字来代替**。',
  '    「<!-- 内容较长，此处省略 -->」「<!-- 见附件 -->」这种会被**当成合法卡片渲染成一片空白**',
  '    （判定只看「有没有标签」，`<!--` 就算标签），用户看到的就是一张空白框，而不是你写的说明。',
  '    真写不下（超 80KB）：改用 ```iu 做精简版，或把文件落盘后**用文字给出路径**，不要再贴一个空围栏。',
  '',
   '轻量交互优先用 ```iu 围栏（原生卡片，不走 iframe，内容为单行 JSON）。',
   `全部 ${IU_KIND_NAMES.length} 种 kind（按常用度排序；卡片状态会持久化，刷新不丢）：`,
   // kind 清单与示例 JSON **来自注册表**（kinds/<kind>.ts 的 doc 字段）：
   // 文档跟着实现走，新增 kind 自动出现在这里，杜绝「字段实现了文档没写」
   //（真事：piano 的 showNotes 实现了，手写文档从没提过，模型永远不知道能用）。
   iuKindsDoc(),
   '  · 复杂页面（整站原型、多视图联动、自由交互）仍用 ```html；上面这些 kind 能覆盖的优先用 ```iu，体积小、不白屏、状态可持久化。',
  '',
  '【图形一律用 ```html】流程图 / 架构图 / 时序图 / 关系图 / 任何示意图，都用 ```html 手写内联 SVG，',
  '不要用文字节点凑一张「图」。原因：图形是最需要设计感的一类内容，而 iu 的图形 kind',
  '（原 graph / arch / sequence）只能画算法排版的拓扑图，视觉上限被锁死，已整块下线。',
  '',
  '写 ```html 图形的硬要求（这几条做不到就是白干）：',
  '  · 用一个 `viewBox` 定坐标系，内部**全部用绝对坐标**写死（rect x/y、path d），不要靠 flex 排版；',
  '  · 节点宽高按文字长度给足（中文约 14px/字），标签与边框留 10px 以上内边距，否则文字溢出框；',
  '  · 连线画成 `<path>` 正交折线（`M … H … V …`），箭头用 `<marker>`，别用字符箭头；',
  '  · 配色只用一个主色 + 中性灰，深浅主题各写一套（`html[data-ds-dark-theme]`）；',
  '  · 不要写 `height:100vh`、不要引 CDN，图形必须内联 SVG；',
  '  · 复杂度控制：节点 ≤16 个、连线 ≤24 条，再多就拆成两张图，别把一张图画成一团乱麻。',
  '',
  '【/iu 前缀 · 用户强制出卡】用户在输入框以 `/iu` 开头时，这条消息会**连 `/iu` 一起原样发给你**（客户端不做任何转换，别把它当未知命令或笔误）。',
  '看到以 `/iu` 开头的消息 = 用户**明确要求**用卡片回答（不是建议，是指令）：必须用 ```iu 或 ```html 围栏出卡，不要用纯文字或 Markdown 表格替代。',
   'kind 由你按内容判断：取值换算→slider、数据行列→table、待办检查→checklist、方案对比→tabs、任务分列→kanban、收集输入→form、时间安排→timeline、前后修改→diff、层级结构→tree、完成度指标→gauge、考察理解→quiz、乐器→piano、**任何图形/图表/示意图（含柱状图、折线图、流程图、架构图、时序图）→html**、复杂页面→html。',
  '若消息里没说清要什么，就用最贴合其意图的那种卡片，不要反问。',
  '',
  '两条纪律：',
  '  · 卡片是交付物本身，不是正文的插图：先用一句话说清它是什么、怎么用，再给围栏。',
  '  · 不要用 ```html 来展示「示例代码」——那会被渲染成真卡片。要给人看源码请用其它语言标记。',
  '  · 同理，不要在 ```iu 里写「示例 JSON」或注释占位：它会被当真卡片渲染（非法 JSON 则回退成代码块，',
  '    两种结果都不是「给人看示例」）。',
].join('\n')

/**
 * 灵魂（Soul）通道的注入头部。
 *
 * 与 zh / html 的差异：那两条投的是**插件内置**的文本（语言契约、渲染规范），
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

/**
 * 团队协作（Agent Teams / 子代理委派）规范注入文本。
 *
 * 为什么需要它（2026-10-06 由「效率约束」通道改写而来）：模型默认倾向
 * 单线程自己串完，把本该并行的活排成队列——既慢又把大文件、长输出全灌进
 * 自己这一条上下文。而 DSH 侧本来就给了完整的团队面（subagent /
 * spawn_teammate / 共享任务板），不主动注入纪律，模型几乎不会去用。
 *
 * 与原效率通道同构：纯静态规范文本，不读条目、不做检索、不参与命中加分。
 *
 * **基调是「更积极」，但不是「无条件」**：只喊「多组队」会退化成每个小改动
 * 都开四个 teammate，协调开销吃掉全部收益。所以文本自带分档判据，且把判据的
 * 顺序写成「独立子任务默认并行 → 复杂任务组队 → 只有小事才自己做」，并给
 * 「我顺手就做完了」这句最常见的偷懒借口钉了一个反判据。
 *
 * 开头带一句「本会话若提供了 subagent / spawn_teammate / 共享任务板」：普通
 * 对话会话里这些工具可能没注入，不加这句模型会去调不存在的工具。
 *
 * **文本长度本身要受约束**：这段文字首步注入后进历史，之后每步都被
 * cacheRead 一次。判据同前：一句话若删掉后模型的做法不会变，它就是水分。
 * 保留的高价值事实：①委派必须用 fresh 子代理，fork 继承全部历史起点即大上下文；
 * ②「先自己串完再补一个验证代理」是顺序错误，返工成本翻倍。
 */
const TEAM_INJECTION_RULE = [
  '【团队协作 · 内置通道】先问一句「这活能不能拆」，而不是默认自己串完。本会话若提供了 subagent / spawn_teammate / 共享任务板，按下面三档走：',
  '',
  '一、判据（顺序不能反）：',
  '  · 互不依赖的独立子任务（多文件调研、多方案对比、批量审计/迁移、多个独立修复）→ **默认并行**：同一条消息里发多个 subagent，一个子任务一个；不要串行等，也不要先自己做一个试试。',
  '  · 跨阶段或多角色的复杂任务（调研→实现→验证、大重构、对抗式审查）→ spawn_teammate 组队，你当 Lead 收口。',
  '  · 单文件小改、单步查询、纯问答才自己做。判据是「拆出一个子任务的沟通成本是否大于它本身」，不是「我顺手就做完了」——后者是最常见的偷懒借口。',
  '',
  '二、组队的硬规矩：',
  '  · 委派 prompt 必须自包含：fresh 子代理看不到本会话历史，目标 / 输入 / 产出物路径 / 验收标准要写全。',
  '  · 写作用域先切分到不重叠，重叠的写操作一律串行；开写前在共享任务板上建任务并标 write_scopes。',
  '  · 依赖用 blocked_by 表达，不靠「发消息时它大概做完了」这种时序假设。',
  '  · 交最终答复前等齐所有 required teammate，并亲自跑一遍最终验证；子代理的自我报告不算验收。',
  '',
  '三、反模式：',
  '  · 先自己单线程串完，再补一个「验证代理」——顺序错了，返工成本翻倍。',
  '  · 让子代理干你已有上下文的活：fork 继承全部历史，起点就是那个大上下文。',
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
   * html 通道的每会话 step 计数，理由同 zhStepCounters——各内置通道各记
   * 各的，共用一个 Map 会互相抢占首步名额。
   */
  const htmlStepCounters = new Map<string, number>()

  /**
   * soul 通道的每会话 step 计数，理由同 zhStepCounters——各通道各记各的，
   * 共用一个 Map 会互相抢占首步名额。
   */
  const soulStepCounters = new Map<string, number>()

  /**
   * team 通道的每会话 step 计数，理由同 zhStepCounters——各通道各记各的，
   * 共用一个 Map 会互相抢占首步名额。
   */
  const teamStepCounters = new Map<string, number>()

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

    // ── 对话内流程图注入通道已移除（2026-10-09）──────────────────────────
    // 原 ```diagram 围栏要求模型手工算节点坐标与折线点，画歪是常态，且开关默认关、
    // 能力常年闲置。图形结构改由 iu kind 承接（graph 自动布局流程图 / arch 分层
    // 架构图 / sequence 时序图），注入文档随 kind 注册表走 html 卡片通道（默认开）。
    // 渲染器（splitDiagram + DiagramCard）保留：历史消息里的 ```diagram 围栏
    // 必须继续显示成卡片，不能变成一坨 JSON 代码块。

    // ── 对话内 HTML 卡片能力规范注入（内置通道） ──────────────────────
    // 位置刻意：两道闸门之前。它回答的是「本客户端支持什么呈现能力」，
    // 与「记忆库要不要进上下文」正交。iu 的 kind 文档（含图形三件套）也随它注入。
    const htmlEnabled = await store.isHtmlInjectEnabled(config.htmlInjectDefaultEnabled !== false)
    if (!htmlEnabled) {
      logger?.debug?.('[dsh-memory] html injection off (switch disabled)')
    } else if (!htmlStepCounters.has(sessionId)) {
      htmlStepCounters.set(sessionId, 1)
      try {
        messages = [...messages, createUserMessage({
          content: [{ type: 'text', text: HTML_INJECTION_RULE }],
          source: {
            kind: 'plugin:dsh-memory',
            plugin: 'dsh-memory',
            form: 'snapshot',
            sections: [{ name: '对话内 HTML 卡片', text: HTML_INJECTION_RULE }],
          },
        })]
        logger?.debug?.('[dsh-memory] html injection ok')
      } catch (error) {
        // 失败绝不能影响主注入与其它通道。
        logger?.warn?.(`[dsh-memory] html injection failed: ${error instanceof Error ? error.message : String(error)}`)
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

    // ── 团队协作（Agent Teams / 子代理委派）规范注入（内置通道） ────────
    // 位置同 html / soul：两道闸门之前。它回答的是「这活该怎么组织」，
    // 跟「记忆库要不要进上下文」正交；这套纪律跨会话恒定，不该随主开关一起消失。
    const teamEnabled = await store.isTeamInjectEnabled(config.teamInjectDefaultEnabled !== false)
    if (!teamEnabled) {
      logger?.debug?.('[dsh-memory] team injection off (switch disabled)')
    } else if (!teamStepCounters.has(sessionId)) {
      teamStepCounters.set(sessionId, 1)
      try {
        messages = [...messages, createUserMessage({
          content: [{ type: 'text', text: TEAM_INJECTION_RULE }],
          source: {
            kind: 'plugin:dsh-memory',
            plugin: 'dsh-memory',
            form: 'snapshot',
            sections: [{ name: '团队协作', text: TEAM_INJECTION_RULE }],
          },
        })]
        logger?.debug?.('[dsh-memory] team injection ok')
      } catch (error) {
        // 失败绝不能影响主注入与其它通道。
        logger?.warn?.(`[dsh-memory] team injection failed: ${error instanceof Error ? error.message : String(error)}`)
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
      htmlStepCounters.delete(sessionId)
      soulStepCounters.delete(sessionId)
      teamStepCounters.delete(sessionId)
    },
  }
}
