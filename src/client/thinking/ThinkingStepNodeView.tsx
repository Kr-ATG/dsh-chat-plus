/**
 * dsh-chat-plus — 回合级思考 chip + 对话流卡片（assistant-step 槽位替换）。
 *
 * 移植自 dsh-webui 的 BETTER assistant 渲染（_tmp-webui/src/client/markdown/
 * renderer.tsx 的 ReasoningEntry + BetterAssistantNodeView），关键差异：
 *
 *  1. **正文链路保持官方**：text 块用官方 `MarkdownText`（ui-primitives）、
 *     image 块走官方 `renderMessageImages` 槽——不引入 markstream/shiki/katex，
 *     流式输出与官方渲染完全一致（「流式输出就没了」是本次移植的第一约束）。
 *  2. **KR 过程是一张瞬态活动卡**：由 turn-process 的 per-turn 座位聚合
 *     分析、思考与工具调用到有界时间线，自动跟随滚动；最终回答出现后整卡
 *     上移淡出。回合正文仍保持官方链路，结束后才包步骤 / 总结卡。
 *  3. **思考过程卡贴在 KR 对话流里**：挂在本回合第一条助手节点上（isFirstStep
 *     门控，一个回合一张），回合进行中展开跟随，收口自动折叠让位给正式回答。
 *     右栏大盘里原先那张思考卡已随之移除——思考与回答是同一件事的两半，分两栏
 *     摆就得来回对照才读得完整。普通「对话」视图不受影响：那边由官方
 *     ReasoningRow 自己渲染，本组件整体委托回官方 AssistantNodeView。
 *
 * 总结卡门控不变：turn.status === 'closed'（或中断）后，中间片段变轻量步骤
 * 卡，最终回复变总结卡（纯正文外壳，头部统计行已移除）。
 */
import { memo, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AssistantChatData, ChatNode, ChatNodeViewProps, ChatViewSlotProps, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: activates the ui-chat SlotMap augmentation ('assistant-step' keyed
// Seat props) so ChatNodeViewProps resolves its owner / hooks / session share.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { activityStore } from '../tool-summary/activity-drawer.tsx'
import { LiveThinkingCard as StackLiveCard, type LiveThinkingItem } from './live-stack.tsx'
import { FlowCard } from '../flow-card.tsx'
import { splitDiagram } from '../diagram/parse.ts'
import { DiagramCard } from '../diagram/DiagramCard.tsx'
import { splitProtoTabs } from '../proto/parse.ts'
import { ProtoTabsCard } from '../proto/ProtoTabsCard.tsx'
import { isRunning } from '../tool-summary/tool-stats.ts'
import { GeneratedImageStrip } from '../generated-images/GeneratedImageStrip.tsx'
import { useGeneratedImages } from '../generated-images/use-generated-images.ts'
import { getKrChatStore } from '../kr-chat/kr-chat-store.ts'
import { KR_CHAT_ENABLED } from '../kr-chat/enabled.ts'
import { KrReasoningCard } from '../kr-chat/KrReasoningCard.tsx'
import { getOfficialAssistantNodeView } from '../index.ts'
import { latestChatSnapshot, setLatestChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'

const EMPTY_STEPS: readonly ChatNode<'assistant-step'>[] = []
const EMPTY_TOOLS: readonly ChatNode<'tool-call'>[] = []
const EMPTY_REASONING: readonly ReasoningItem[] = []

/** Localized copy adapters for Cordis-free Markdown primitives（官方同款）。 */
function markdownLabelsFrom(t: ChatViewSlotProps['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/** One reasoning entry inside the turn-level group. */
interface ReasoningItem {
  readonly text: string
  /** Whether its owning step is still streaming. */
  readonly running: boolean
  /** The owning assistant step number (for the live card heading). */
  readonly step: number
}

/**
 * 旧版普通对话思考 chip 已移除；KR 思考由 turn-process 活动卡与右栏大盘承接。
 * 保留本文件的 LiveThinkingCard re-export，避免历史内部引用断裂。
 */
/**
 * 兼容 re-export：工具行仍 `import { LiveThinkingCard } from
 * '../thinking/ThinkingStepNodeView.tsx'`，新实现在 live-stack.tsx。
 */
export { StackLiveCard as LiveThinkingCard }
export type { LiveThinkingItem }

/**
 * 旧单卡实现已迁移到 live-stack.tsx（堆叠 + 淡入/消散/回收）。
 * 此处保留注释占位，避免外部按行号引用的文档失效。
 */

type AssistantBlockLike = AssistantBlock

/**
 * 新挂载内容在流式期柔和显现（上游 better-display word-motion 的块级近似：
 * 上游逐字形做 opacity/blur，这里官方 MarkdownText 整块渲染，只能做到
 * 新挂载块级节点淡入——已显示的旧节点绝不动）。
 */
function Fresh({ live, freshKey, children }: { live: boolean; freshKey: string; children: ReactNode }): ReactNode {
  if (!live) return <>{children}</>
  return <span className="dtt__fresh" data-fresh key={freshKey}>{children}</span>
}

/** 助手正文：text 走官方 MarkdownText、image 走官方槽、未知块 JsonBlock。 */
function AssistantBody({ blocks, streaming, interrupted, renderMessageImages, mentions, labels, t }: {
  blocks: readonly AssistantBlockLike[]
  streaming: boolean
  interrupted?: boolean | undefined
  renderMessageImages: RenderMessageImages
  mentions?: MarkdownFileMentions | undefined
  labels: MarkdownLabels
  t: ChatViewSlotProps['t']
}): { hasVisible: boolean; rendered: ReactNode[] } {
  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call')
  const rendered: ReactNode[] = []
  if (!hasVisible) return { hasVisible, rendered }
  // 连续 text 块先拼成整段：长围栏（proto-tabs 单行 JSON 很长）会被流式
  // 切成多个块，单块正则永远匹配不上，只能原样显示代码块。用空串拼接
  // 精确还原（JSON 字符串内不能插入换行，只能无缝拼）。
  const coalesced: AssistantBlockLike[] = []
  for (const source of blocks) {
    const prev = coalesced[coalesced.length - 1]
    if (source.kind === 'text' && prev !== undefined && prev.kind === 'text') {
      coalesced[coalesced.length - 1] = { ...prev, text: prev.text + source.text }
    } else {
      coalesced.push(source)
    }
  }
  for (let index = 0; index < coalesced.length; index += 1) {
    const block = coalesced[index]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text': {
        // proto-tabs / diagram 围栏 → 卡片组件，其余仍走官方 MarkdownText。
        const pushMd = (key: string, text: string): void => {
          if (text === '') return
          splitDiagram(text).forEach((sub, subIndex) => {
            if (sub.kind === 'diagram') {
              rendered.push(<Fresh live={streaming} freshKey={`${key}-dg${subIndex}`}><DiagramCard spec={sub.spec} /></Fresh>)
            } else if (sub.text !== '') {
              rendered.push(
                <Fresh live={streaming} freshKey={`${key}-md${subIndex}`}><MarkdownText text={sub.text} streaming={streaming} labels={labels} fileMentions={mentions} /></Fresh>,
              )
            }
          })
        }
        const parts = splitProtoTabs(block.text)
        if (parts.length === 1 && parts[0]?.kind === 'md' && parts[0].text.indexOf('diagram') < 0) {
          rendered.push(
            <Fresh live={streaming} freshKey={`md${index}`}><MarkdownText text={block.text} streaming={streaming} labels={labels} fileMentions={mentions} /></Fresh>,
          )
        } else {
          parts.forEach((part, partIndex) => {
            if (part.kind === 'card') {
              rendered.push(<Fresh live={streaming} freshKey={`proto${index}-${partIndex}`}><ProtoTabsCard spec={part.spec} /></Fresh>)
            } else {
              pushMd(`${index}-${partIndex}`, part.text)
            }
          })
        }
        break
      }
      case 'reasoning':
        // 回合级聚合进 chip；此处不渲染任何内联思考。
        break
      case 'image': {
        const start = index
        const group = [block]
        while (index + 1 < coalesced.length) {
          const next = coalesced[index + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          index += 1
        }
        rendered.push(
          <Fresh live={streaming} freshKey={`img${start}`}>
            {renderMessageImages({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fresh>,
        )
        break
      }
      // 聚合进工具 chip（tool-call 槽位）；此处跳过。
      case 'tool-call':
        break
      default:
        rendered.push(
          <Fresh live={streaming} freshKey={`unknown${index}`}>
            <JsonBlock
              label={t('message.unknownBlock')}
              payload={block.block}
              truncatedLabel={total => t('json.truncated', { total })}
            />
          </Fresh>,
        )
    }
  }
  return { hasVisible, rendered }
}

/**
 * Turn-level reasoning chip + 卡片门控：第一个 assistant-step 渲染 chip
 * （思考材料进共享活动抽屉）；片段正文按「回合是否结束」决定包卡形态。
 */
export const ThinkingStepNodeView = memo(function ThinkingStepNodeView(
  props: ChatNodeViewProps<'assistant-step'>,
) {
  const { node, useTurnData, useChat, openFile, renderMessageImages, fileMentions, t } = props
  const krStore = getKrChatStore()
  const krState = useSyncExternalStore(
    (cb) => krStore.subscribe(cb),
    () => krStore.snapshot,
  )
  const isKrMode = krState.activeTab === 'kr'
  /**
   * 本视图是否由插件自己渲染。
   *
   * KR 开启时（历史设计）：只有 KR 视图走插件渲染，「对话」委托回官方
   * AssistantNodeView 原生渲染 —— 增强呈现只属于 KR 那一栏。
   * KR 关闭后（KR_CHAT_ENABLED = false）：没有 KR 视图可去，「对话」本身就是
   * 插件渲染，回到 KR 之前的形态（思考 chip / 步骤卡 / proto-tabs / diagram）。
   */
  const pluginRenders = !KR_CHAT_ENABLED || isKrMode
  const data = node.data
  const locationTurn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (locationTurn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn: locationTurn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, locationTurn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )

  // Aggregate reasoning across every assistant step of this turn.
  const turnNumber = locationTurn?.turn
  const steps = useChat(snapshot => {
    setLatestChatSnapshot(snapshot)
    if (turnNumber === undefined) return EMPTY_STEPS
    return snapshot.locations.getTurn(turnNumber)
      .map(key => snapshot.nodes.get(key))
      .filter((candidate): candidate is ChatNode<'assistant-step'> => (
        candidate !== undefined && candidate.kind === 'assistant-step'
      ))
  })
  const toolNodes = useChat(snapshot => {
    if (turnNumber === undefined) return EMPTY_TOOLS
    return snapshot.locations.getTurn(turnNumber)
      .map(key => snapshot.nodes.get(key))
      .filter((candidate): candidate is ChatNode<'tool-call'> => (
        candidate !== undefined && candidate.kind === 'tool-call'
      ))
  })
  const localReasoning = useMemo<readonly ReasoningItem[]>(() => steps.flatMap(step => {
    const stepRunning = step.data.status === 'running'
    return step.data.blocks
      .filter((block): block is Extract<AssistantBlockLike, { kind: 'reasoning' }> => block.kind === 'reasoning')
      .map(block => ({ text: block.text, running: stepRunning, step: step.data.step }))
  }), [steps])
  /*
   * locations 拿不全时**兜底扫全量节点**。
   *
   * locations.getTurn 在工具间隙 / 紧凑模式下会把某些 assistant-step 摘掉，
   * 只靠它会整段漏掉思考——右栏大盘早就为同一个坑做过全量兜底
   * （TurnProcessShadowView.collectTurnNodes 第 2 步），这里必须同一口径，
   * 否则会出现「右栏能抽出思考里的预告、对话流里却没有思考卡」这种自相矛盾。
   */
  const reasoningItems = useChat((snapshot) => {
    if (turnNumber === undefined) return EMPTY_REASONING
    if (localReasoning.length > 0) return localReasoning
    try {
      const collected: ReasoningItem[] = []
      const nodes = snapshot?.nodes
      if (nodes !== undefined && nodes !== null && typeof nodes.values === 'function') {
        for (const node of nodes.values()) {
          if (node?.kind !== 'assistant-step') continue
          const loc = node.location
          const locTurn = node.data?.turn ?? (typeof loc?.turn === 'number' ? loc.turn : loc?.turn?.turn)
          if (locTurn !== turnNumber) continue
          const running = node.data?.status === 'running'
          for (const block of node.data.blocks ?? []) {
            if (block?.kind !== 'reasoning') continue
            const text = typeof block.text === 'string' ? block.text : ''
            if (text.trim() === '') continue
            collected.push({ text, running, step: node.data.step })
          }
        }
      }
      return collected.length > 0 ? collected : EMPTY_REASONING
    } catch {
      return EMPTY_REASONING
    }
  })
  /*
   * 喂给思考卡的文本数组必须**引用稳定**，否则那张卡的一切 memo 全部失效。
   *
   * 直接 `map(...)` 每次渲染都产出新数组：KrReasoningCard 的 memo 被打穿 →
   * 内部 points 的 useMemo 被打穿 → 每帧把整轮思考 join + split + trim +
   * filter 重跑一遍，几千字时这一下就是几毫秒，外加 probe 再把全文 join 成
   * 一个大字符串。流式期每来一个 delta 就重来一轮，思考越长越卡——这正是
   * 「思考过程有点多的时候就会很卡」的成因之一。
   *
   * 这里用**长度序列指纹**做依赖（同仓库 KrAgentPanel 的 fingerprintTurnData
   * 同一手法）：思考是纯追加流式（KrFreshText 的注释也这么认定），长度序列
   * 单调增长，指纹不变即内容不变，于是数组引用也跟着不变。
   */
  const reasoningSignature = useMemo(
    () => reasoningItems.map((item) => item.text.length).join(','),
    [reasoningItems],
  )
  const stableReasoningTexts = useMemo<readonly string[]>(
    () => reasoningItems.map((item) => item.text),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reasoningSignature],
  )
  /*
   * 思考卡挂在「回合内第一个带思考的 step」上，而不是 locations 里的 steps[0]。
   *
   * 用 steps[0] 会漏：工具间隙里官方会把前面的 step 从 locations 摘掉，
   * steps[0] 变成当前那个，而卡所在的节点不是它——于是整张卡挂不上，
   * 表现是「Agent 正在分析、思考也在长，但对话流里什么都没有」。改成按内容
   * 认领，谁是第一个真有思考的谁挂。
   */
  const ownsReasoningCard = useMemo(() => {
    for (const step of steps) {
      if (step.data.blocks.some((block) => block.kind === 'reasoning' && block.text.trim() !== '')) {
        return node.key === step.key
      }
    }
    return false
  }, [steps, node.key])
  const isFirstStep = steps.length > 0 && node.key === steps[0]?.key
  const toolsRunning = toolNodes.some((toolNode) => {
    try { return isRunning(toolNode.data.root) } catch { return false }
  })
  // 工具执行期通常没有 assistant-step 处于 running；两段任一仍在推进都算整轮活跃。
  const turnRunning = steps.some(step => step.data.status === 'running') || toolsRunning

  // ── 本回合生图结果（generate_image）→ 画廊条 ──────────────────────────
  // 数据源是工具结果：小结果内联 JSON（b64_json → data URL），大结果被
  // DSH spill 成「preview + locator」，由 host 路由读回完整图片（见
  // use-generated-images.ts）。不依赖正文 markdown，因此模型只写路径
  // 文字时图片也会直接显示。
  const generated = useGeneratedImages(toolNodes)
  // 画廊挂在回合内「最后一个 assistant-step」：回合进行中 = 生图后最新的
  // 步骤（图即时可见），回合收口后即最终回复总结卡（用户期望的位置）。
  const galleryStepKey = useChat(snapshot => {
    if (turnNumber === undefined || generated.urls.length === 0) return undefined
    let lastStep: string | undefined
    for (const key of snapshot.locations.getTurn(turnNumber)) {
      const candidate = snapshot.nodes.get(key)
      if (candidate === undefined) continue
      if (candidate.kind === 'assistant-step') lastStep = key
    }
    return lastStep
  })
  const gallery = generated.urls.length > 0 && node.key === galleryStepKey
    ? <GeneratedImageStrip images={generated.urls} model={generated.model} />
    : undefined

  // "当前思考"起点仅供历史兼容注释使用；普通对话不渲染思考 chip，KR 活动卡
  // 直接从 turn-process 投影读取实时状态。
  const visibleBlocks = useMemo(
    () => data.blocks.filter(block => block.kind !== 'reasoning'),
    [data.blocks],
  )
  // 思考材料登记（首步负责）：本轮有工具调用时思考行并入工具行（与官方
  // turn-process 一致，推理折叠不单独占行），chip 不挂载也得登记，抽屉里
  // 才有思考分区。
  useEffect(() => {
    if (isKrMode && isFirstStep && reasoningItems.length > 0 && turnNumber !== undefined) {
      activityStore().setReasoning(turnNumber, reasoningItems)
    }
  }, [isKrMode, isFirstStep, reasoningItems, turnNumber])

  // 普通「对话」不展示思考 chip；KR 过程由 turn-process 座位上的实时活动卡承接。
  // 即使官方 assistant-step 捕获失败而落到本组件的自有 renderer，也不能恢复旧折叠。
  const streaming = data.status === 'running'
  const interrupted = data.status === 'interrupted'
  // 卡片只在「回合已结束」时出现（含中断）：流式期不包卡，保住流式输出；
  // 中间步骤要等整轮收口才变轻量步骤卡，最终回复变总结卡。
  const turnClosed = locationTurn?.status === 'closed'
  const showCard = turnClosed === true || interrupted
  const isClosingReply = owner !== undefined
  const isSummary = isClosingReply || interrupted
  const variant: 'reply' | 'step' | undefined = !showCard
    ? undefined
    : isSummary ? 'reply' : 'step'
  const labels = useMemo(() => markdownLabelsFrom(t), [t])

  const OfficialComp = getOfficialAssistantNodeView()
  if (!pluginRenders && OfficialComp) {
    /*
     * 普通「对话」把 assistant-step 原样交回官方：thinking block 照常传给
     * AssistantNodeView，官方自己的 ReasoningRow / DisclosureRow 会照常渲染
     * 并可展开。
     *
     * 曾经在这里把 reasoning block 过滤掉再转发（"彻底移除 thinking block"），
     * 结果普通对话里思考被整段抹掉——官方组件拿不到 block，就不是"不折叠"
     * 而是"没有"。插件在普通模式下对官方节点只有「原样委托」这一种姿态。
     *
     * 也不在这里套卡片外壳：实测 0.1.5-rc.2 上普通「对话」视图里本组件根本
     * 不会被调用——官方 assistant-step 的 priority ≥ 0 高于本插件的 -100，
     * 官方直接渲染，这个分支不可达。想给普通对话加卡片只能走 DOM 观察器，
     * 那是另一件事（用户明确表示普通对话不需要）。
     */
    return <OfficialComp {...props} />
  }

  const { hasVisible, rendered } = AssistantBody({
    blocks: visibleBlocks,
    streaming,
    interrupted,
    renderMessageImages,
    mentions,
    labels,
    t,
  })

  /*
   * KR 模式不显示过程性发言。
   *
   * 工具调用之间的助手正文（“Chrome 已在运行”“窗口合并了，重新指向…”这类）
   * 走的是 response 投影、不是 thinking——KR 把 thinking 收进右栏是对的，但
   * 这些正文照样以消息气泡堆在左栏，读起来像一堆絮叨抢在正式回答前面。
   *
   * 判据是「本节点是不是本回合最后一个 assistant-step」：
   *   - 最后一个：流式期就是模型正在写的那句，实时可见；回合收口后它就是
   *     最终答案（isClosingReply），同样要显示。
   *   - 不是最后一个：说明后面还有工具调用，这段就是过程性发言，不渲染。
   * 于是过程性发言在新步骤产生时即退场，最终回答始终在场。
   * 生图画廊（gallery）挂在最后一个 step 上，不能被这条规则一起吃掉，所以
   * 正文被隐藏时仍保留画廊。
   */
  const hideProcessText = KR_CHAT_ENABLED && isKrMode
  const isLastStep = steps.length > 0 && node.key === steps[steps.length - 1]?.key
  const showBody = !hideProcessText || isLastStep || isClosingReply || interrupted
  const shown = showBody ? rendered : []

  /*
   * 思考过程卡：**贴在 KR 对话流里**，挂在本回合第一条助手节点上。
   *
   * 为什么回到对话流：思考与它对应的回答是同一件事的两半，摆在右栏大盘里
   * 就得来回对照两栏才读得完整。挂在首步（isFirstStep）而不是每步各挂一张：
   * 一个回合只该有一张思考卡，否则工具调用把它切成好几段、每段都断在半截。
   *
   * **折叠时机 = 总结卡出现**（summarizing = isClosingReply || interrupted），
   * 不是回合收口。回合 closed 只说明「模型这一轮说完了」，工具间隙的回合更是
   * closed 了大半程；真正的分界是最终回答（总结卡）开始出现在对话流里——此前
   * 思考还在源源不断长，卡就该一直摊开着跟随滚动；总结卡一出现就收成标题一行
   * 给它让位。中断等同总结（这一轮不会再有回答了）。
   *
   * running 用 turnRunning 而不是 data.status：工具执行期 assistant-step 往往
   * 已经不在 running 了，但那段时间思考轨仍在、卡也不该先收起来。
   */
  const summarizing = isClosingReply || interrupted
  /*
   * 回合是否「还没出总结卡」——思考卡在它为真时一律展开。
   *
   * 不能拿 turnRunning 当这个判据：assistant-step 在工具执行期就已经不在
   * running 了，但那段时间思考轨仍在、回合也远没到总结。实测这会让卡片在
   * 工具间隙挂载成折叠态，之后再没有任何东西把它展开——整轮都看不见。
   * 真正的分界只有一个：这回合的总结卡（最终回答）出来没有。
   */
  const turnActive = !summarizing
  const inlineReasoning = KR_CHAT_ENABLED && isKrMode && ownsReasoningCard && reasoningItems.length > 0
    ? (
      <KrReasoningCard
        reasoningTexts={stableReasoningTexts}
        running={turnActive}
        summarizing={summarizing}
        turnActive={turnActive}
        inline
      />
    )
    : undefined

  if (shown.length === 0 && inlineReasoning === undefined && gallery === undefined) return null

  return (
    <div
      className="dtt__assistant"
      data-streaming={streaming || undefined}
      data-running={turnRunning || undefined}
    >
      <div className="dtt__assistant-body">
        {inlineReasoning}
        {shown.length > 0 && (variant !== undefined
          ? <FlowCard variant={variant} interrupted={interrupted}>{shown}{gallery}</FlowCard>
          : <>{shown}{gallery}</>)}
        {shown.length === 0 && gallery}
        {interrupted && <span className="dtt__stopped">{t('message.stopped')}</span>}
      </div>
    </div>
  )
})
