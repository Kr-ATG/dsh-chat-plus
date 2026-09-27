/**
 * Tool entry node: shadows the built-in `tool-call` chat node at a lower slot
 * priority. Instead of rendering the whole tool tree inline, it collapses one
 * turn's calls into a single clickable chip; clicking opens the shared
 * activity drawer with the full call list and a summary card.
 *
 * The chip renders for the FIRST tool-call node of the turn (by the chat node
 * order); every sibling node of the same turn renders null.
 */

import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode, ChatNodeViewProps, ChatViewSlotProps } from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: activates the ui-chat / ui-tool SlotMap augmentation so ChatNodeViewProps
// resolves its owner/keyed share (selectedCallId, cwd, openFile, inspectCall…).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  DiffBlock, IconApiOutlineRegular, IconBrowseOutlineRegular, IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular, IconDownloadOutlineRegular, IconEditOutlineRegular, IconSearchOutlineRegular,
  IconSkillOutlineRegular, IconSparkleRegular, JsonTree, MarkdownText, ReadBlock, SearchBlock,
  TerminalBlock, WebBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { callDurationMs, callName, classifyActivity, collectRunningCalls, computeStats, formatDuration, isRunning, parseDownload, type DownloadInfo } from './tool-stats.ts'
import {
  PHASE_LABEL, argFields, classifyCategory, diffHunksOf, executionFacts, rawResultJson,
  readWindowOf, resultExtraCount, resultParagraphs, rowSummary, rowTitle, searchViewOf,
  toolArgsRaw, viewPhase, webViewOf,
} from './activity-view-model.ts'
import type { ViewCategory, ViewPhase } from './activity-view-model.ts'
import { useNow } from './use-now.ts'
import { activityStore, useDrawerOpen, type ActivityHandlers, type ActivityStore } from './activity-drawer.tsx'
import { useMotionAllowed, useHeightAnimation } from '../motion-utils.ts'
import { LiveThinkingStack, LIVE_RECLAIM_UNMOUNT_MS, type LiveThinkingItem } from '../thinking/live-stack.tsx'
import { useTurnActivityCounts } from './TurnProcessShadowView.tsx'
import { LiveDownloadCard } from '../download/DownloadCard.tsx'
import { downloadPercent, useDownloadState } from '../download/api.ts'

const NS = 'dts'

const MD_LABELS: MarkdownLabels = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

const READ_LABELS = {
  window: (shown: number, total: number) => `显示 ${shown} / ${total} 行`,
  copy: '复制', copied: '已复制', collapseAria: '收起文件内容',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行`, collapse: '收起',
  expand: (hidden: number) => `展开其余 ${hidden} 行`,
}

const TERMINAL_LABELS = {
  signal: (signal: string) => `信号 ${signal}`, exitCode: (code: number) => `退出码 ${code}`,
  running: '执行中', failed: '失败', done: '已完成', copy: '复制', copied: '已复制',
  noOutput: '没有输出', collapseAria: '收起命令输出', collapse: '收起',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行`, expand: (hidden: number) => `展开其余 ${hidden} 行`,
}

const DIFF_LABELS = {
  copy: '复制', copied: '已复制', collapseAria: '收起差异', collapse: '收起',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行`, expand: (hidden: number) => `展开其余 ${hidden} 行`,
  files: (count: number) => `${count} 个文件`,
}

const SEARCH_LABELS = {
  pathsSummary: (shown: number, total: number, truncated: boolean) => `${shown} / ${total} 个路径${truncated ? '（结果已截断）' : ''}`,
  matchesSummary: (shown: number, total: number, files: number, truncated: boolean) => `${shown} / ${total} 处匹配 · ${files} 个文件${truncated ? '（结果已截断）' : ''}`,
  copy: '复制', copied: '已复制', noResults: '没有结果', collapseAria: '收起搜索结果', collapse: '收起',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行`, expand: (hidden: number) => `展开其余 ${hidden} 行`,
}

const WEB_LABELS = {
  noResults: '没有结果', sourcesTruncated: '来源已截断', http: 'HTTP', contentTruncated: '内容已截断',
  markdown: MD_LABELS,
}

const JSON_LABELS = {
  copyValue: '复制值', copyJson: '复制 JSON', copyPath: '复制路径', copyPrettyJson: '复制格式化 JSON',
  copyCompactJson: '复制紧凑 JSON', copied: '已复制', copyFailed: '复制失败', collapseNode: '收起节点',
  expandNode: '展开节点', copyButtonTitle: (action: string) => action,
}

const CATEGORY_ICONS = {
  write: IconEditOutlineRegular, read: IconBrowseOutlineRegular, terminal: IconApiOutlineRegular,
  search: IconSearchOutlineRegular, web: IconSearchOutlineRegular, other: IconSparkleRegular,
} satisfies Record<ViewCategory, unknown>

const languageOf = (path: string | undefined): string | undefined => path?.split('.').at(-1)
const elapsedText = (ms: number): string => ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`

const EMPTY: readonly ChatNode<'tool-call'>[] = []

/** Turn number owning one chat node, or undefined outside a turn/step location. */
function turnNumber(node: {
  readonly location?: { readonly kind?: string; readonly turn?: { readonly turn?: number } }
}): number | undefined {
  const location = node.location
  if (location === undefined) return undefined
  if (location.kind === 'turn' || location.kind === 'step') return location.turn?.turn
  return undefined
}

/** Handoff props the drawer needs from the seat (registered into the store). */
type HandoffProps = ActivityHandlers

type DetailTab = 'result' | 'input' | 'raw'

/** 输入页签：命令/文件内容优先，其次输入 JSON，末尾附全部输入字段。 */
function ToolInputView({ name, args, raw }: {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly raw: string
}) {
  const command = typeof args.command === 'string' && args.command !== ''
    ? args.command
    : typeof args.cmd === 'string' && args.cmd !== '' ? args.cmd
    : typeof args.script === 'string' && args.script !== '' ? args.script : undefined
  const cwd = typeof args.workdir === 'string' && args.workdir !== ''
    ? args.workdir
    : typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : undefined
  const content = typeof args.content === 'string' && args.content !== ''
    ? args.content
    : typeof args.new_string === 'string' && args.new_string !== '' ? args.new_string
    : typeof args.newText === 'string' && args.newText !== '' ? args.newText
    : typeof args.file_text === 'string' && args.file_text !== '' ? args.file_text : undefined
  const target = typeof args.file_path === 'string' && args.file_path !== ''
    ? args.file_path
    : typeof args.path === 'string' && args.path !== '' ? args.path : undefined
  if ((name === 'render_ui' || name === 'show_widget') && typeof args.html === 'string') {
    return <>
      <p className={`${NS}__tnote`}>交互式组件在弹窗里以输入 JSON 展示，完整交互见原轨迹。</p>
      <JsonTree data={args} label="工具输入" labels={JSON_LABELS} />
    </>
  }
  if (command !== undefined) {
    return <>
      <p className={`${NS}__tnote`}>提交的命令</p>
      <TerminalBlock command={command} cwd={cwd} labels={TERMINAL_LABELS} />
      <details className={`${NS}__tall`}>
        <summary>全部输入字段</summary>
        <JsonTree data={args} label="输入字段" labels={JSON_LABELS} />
      </details>
    </>
  }
  if (content !== undefined) {
    const lines = content.split('\n').map((text, index) => ({ number: index + 1, text }))
    const visible = lines.slice(0, 1600)
    return <>
      <p className={`${NS}__tnote`}>工具输入中的文件内容{lines.length > visible.length ? ' · 预览前 1,600 行，完整内容在原始数据中' : ''}</p>
      <ReadBlock label={target ?? '文件内容'} lang={languageOf(target)} lines={visible} totalLines={lines.length} maxLines={16} labels={READ_LABELS} />
      <details className={`${NS}__tall`}>
        <summary>全部输入字段</summary>
        <JsonTree data={args} label="输入字段" labels={JSON_LABELS} />
      </details>
    </>
  }
  return <JsonTree data={args} label={raw === '' ? '输入尚未到达' : '工具输入'} labels={JSON_LABELS} />
}

/** 结果页签：按分类用原生展示块渲染，文本回退 Markdown。 */
function ToolResultView({ name, category, block, text }: {
  readonly name: string
  readonly category: ViewCategory
  readonly block: ToolCallBlock
  readonly text: string
}) {
  if (!('kind' in block)) {
    return <>
      <p className={`${NS}__tnote`}>工具已开始执行，正在等待结果。</p>
      <ToolInputView name={name} args={argFields(toolArgsRaw(block))} raw={toolArgsRaw(block)} />
    </>
  }
  if (block.error?.code === 'ABORTED' || block.error?.code === 'interrupted') {
    return <>
      <p className={`${NS}__tnote`}>工具已取消，未正常完成。输入和原始返回记录仍可查看。</p>
      <pre className={`${NS}__traw`}>{text}</pre>
    </>
  }
  if (category === 'terminal') {
    const facts = executionFacts(block)
    const output = text.replace(/\n\[(?:exit code: \d+|killed by signal: [^\]\n]+)\]$/, '')
    const args = argFields(toolArgsRaw(block))
    const command = typeof args.command === 'string' && args.command !== ''
      ? args.command
      : typeof args.cmd === 'string' && args.cmd !== '' ? args.cmd : name
    const cwd = typeof args.workdir === 'string' && args.workdir !== ''
      ? args.workdir
      : typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : undefined
    return <TerminalBlock command={command} cwd={cwd} output={output} exitCode={facts.exitCode} signal={facts.signal} maxLines={18} labels={TERMINAL_LABELS} />
  }
  if (category === 'read') {
    const window = readWindowOf(block)
    if (window !== null) {
      return <ReadBlock label={window.path} lang={window.lang} lines={window.lines} totalLines={window.totalLines} maxLines={18} labels={READ_LABELS} />
    }
  }
  if (category === 'write') {
    const diffs = diffHunksOf(block)
    if (diffs !== null) return <DiffBlock diffs={diffs} maxLines={18} labels={DIFF_LABELS} />
  }
  if (category === 'search') {
    const view = searchViewOf(block)
    if (view !== null && view.shape === 'paths') {
      return <SearchBlock kind="paths" paths={view.paths} total={view.total} truncated={view.truncated} maxLines={18} labels={SEARCH_LABELS} />
    }
    if (view !== null && view.shape === 'matches') {
      return <SearchBlock kind="matches" files={view.files} total={view.total} truncated={view.truncated} maxLines={18} labels={SEARCH_LABELS} />
    }
  }
  if (category === 'web') {
    const view = webViewOf(name, block)
    if (view !== null && view.shape === 'fetch') {
      return <WebBlock kind="fetch" url={view.url} statusCode={view.statusCode} truncated={view.truncated} labels={WEB_LABELS} />
    }
    if (view !== null && view.shape === 'search') {
      return <WebBlock kind="search" sources={view.sources} answer={view.answer} truncated={view.truncated} labels={WEB_LABELS} />
    }
  }
  if (text !== '') {
    return <div className={`${NS}__tdoc`}><MarkdownText text={text} streaming={false} labels={MD_LABELS} /></div>
  }
  if (resultExtraCount(block) > 0) return <p className={`${NS}__tnote`}>图片或扩展内容已在轨迹视图中单独展示。</p>
  return <p className={`${NS}__tnote`}>工具没有返回可展示的内容。</p>
}

/**
 * 弹窗内单次工具调用卡片：图标 + 变体标题 + 一行摘要 + 阶段徽标；
 * 展开后是台账 + 结果/输入/原始数据页签。子调用沿左侧导轨递归。
 */
export const SimpleToolRow = memo(function SimpleToolRow({
  block, selected, cwd, openFile, inspectCall,
}: {
  readonly block: ToolCallBlock
  readonly selected: boolean
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}) {
  void cwd
  void openFile
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<DetailTab>('result')
  const panelId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  // 展开/收起高度补间（260ms，播完再卸载）。
  const rowMotion = useMotionAllowed(true)
  const { ref: rowBodyRef, present: rowBodyPresent } = useHeightAnimation(open, rowMotion)
  const running = isRunning(block)
  const name = callName(block)
  const raw = toolArgsRaw(block)
  const args = useMemo(() => argFields(raw), [raw])
  const category = classifyCategory(name)
  const title = rowTitle(name, category)
  const summary = rowSummary(name, category, args, raw)
  const phase: ViewPhase = viewPhase(block)
  const facts = executionFacts(block)
  const text = resultParagraphs(block)
  const Icon = name === 'skill' ? IconSkillOutlineRegular : CATEGORY_ICONS[category]
  const showBadge = phase === 'running' || phase === 'failed' || phase === 'interrupted'
  const now = useNow(running)
  const duration = callDurationMs(block, now)
  // download 运行中：轮询真实进度，台账里显示百分比。
  const dlState = useDownloadState(running && classifyActivity(block) === 'download' ? block.callId : undefined, running)
  const dlPct = downloadPercent(dlState)
  const tabs = useMemo(() => [
    { id: 'result' as const, label: '结果' },
    { id: 'input' as const, label: '输入' },
    { id: 'raw' as const, label: '原始数据' },
  ], [])
  const activateTab = (index: number): void => {
    const next = tabs[(index + tabs.length) % tabs.length]
    if (next === undefined) return
    setTab(next.id)
    tabRefs.current[(index + tabs.length) % tabs.length]?.focus()
  }
  const toggle = (): void => { setOpen(value => !value) }

  return (
    <div
      className={`${NS}__tcall`}
      data-selected={selected || undefined}
      data-state={phase === 'failed' ? 'error' : phase === 'running' ? 'running' : phase === 'interrupted' ? 'stopped' : 'ok'}
      data-expanded={open || undefined}
    >
      <div
        className={`${NS}__trow`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${title}：${summary}`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggle()
          }
        }}
      >
        <span className={`${NS}__trow-icon`} aria-hidden><Icon size={14} /></span>
        <span className={`${NS}__trow-main`}>
          <span className={`${NS}__trow-title`}>{title}</span>
          <span className={`${NS}__trow-summary`} title={summary}>{summary}</span>
        </span>
        {!running && duration !== undefined && (
          <span className={`${NS}__trow-time`} title="耗时">{formatDuration(duration)}</span>
        )}
        {showBadge && <span className={`${NS}__trow-badge`} data-phase={phase}>{PHASE_LABEL[phase]}</span>}
        <button
          type="button"
          className={`${NS}__trow-go`}
          title="在轨迹中查看"
          aria-label={`在轨迹中查看 ${name}`}
          onClick={(event) => {
            event.stopPropagation()
            inspectCall(block.callId)
          }}
        >
          <IconChevronRightOutlineRegular size={13} aria-hidden />
        </button>
        <IconChevronDownOutlineRegular size={14} aria-hidden className={`${NS}__trow-chevron`} data-open={open || undefined} />
      </div>
      {rowBodyPresent && (
        <div
          ref={rowBodyRef}
          className={`${NS}__tdetail`}
          data-open={open || undefined}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          <div className={`${NS}__tledger`} aria-live="off">
            <span>工具 · <span className={`${NS}__tengine`}>{name === '' ? block.callId : name}</span></span>
            {running && dlPct !== null && <span>下载中 · {dlPct}%{duration !== undefined ? ` · ${formatDuration(duration)}` : ''}</span>}
            {running && dlPct === null && <span>已提交 · 等待工具返回{duration !== undefined && duration > 1000 ? ` · ${formatDuration(duration)}` : ''}</span>}
            {!running && phase === 'interrupted' && <span>已停止 · 输入记录保留</span>}
            {!running && phase !== 'interrupted' && duration !== undefined && <span>执行 {elapsedText(duration)}</span>}
            {facts.exitCode !== undefined && <span>退出码 {facts.exitCode}</span>}
            {facts.signal !== undefined && facts.signal !== '' && <span>信号 {facts.signal}</span>}
          </div>
          {running && dlPct !== null && (
            <div className={`${NS}__tprog`} aria-hidden>
              <span className={`${NS}__tprog-fill`} style={{ width: `${dlPct}%` }} />
            </div>
          )}
          <div
            className={`${NS}__ttabs`}
            role="tablist"
            aria-label={`${title}的执行数据`}
            onKeyDown={(event) => {
              const index = tabs.findIndex(item => item.id === tab)
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault()
                activateTab(index + (event.key === 'ArrowRight' ? 1 : -1))
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                activateTab(event.key === 'Home' ? 0 : tabs.length - 1)
              }
            }}
          >
            {tabs.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => { tabRefs.current[index] = element }}
                type="button"
                role="tab"
                id={`${panelId}-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`${panelId}-panel`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => { setTab(item.id) }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div id={`${panelId}-panel`} className={`${NS}__tpanel`} role="tabpanel" aria-labelledby={`${panelId}-${tab}`} tabIndex={0}>
            {tab === 'result' && <ToolResultView name={name} category={category} block={block} text={text} />}
            {tab === 'input' && <ToolInputView name={name} args={args} raw={raw} />}
            {tab === 'raw' && (
              <>
                <p className={`${NS}__tnote`}>完整记录 · 只读 · 不执行其中的代码</p>
                <h4 className={`${NS}__traw-label`}>工具输入</h4>
                <pre className={`${NS}__traw`}>{raw === '' ? '输入尚未到达' : raw}</pre>
                {rawResultJson(block) !== '' && (
                  <>
                    <h4 className={`${NS}__traw-label`}>工具结果</h4>
                    <pre className={`${NS}__traw`}>{rawResultJson(block)}</pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

/** Recursive call list for the drawer (root + subcalls). */
export function ToolCallTreeList({ block, cwd, openFile, inspectCall }: {
  readonly block: ToolCallBlock
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}) {
  return (
    <div className={`${NS}__drawer-call`}>
      <SimpleToolRow
        block={block}
        selected={false}
        cwd={cwd}
        openFile={openFile}
        inspectCall={inspectCall}
      />
      {block.subCalls.length > 0 && (
        <div className={`${NS}__tsub`} data-subcalls aria-label="子调用">
          {block.subCalls.map(child => (
            <ToolCallTreeList key={child.callId} block={child} cwd={cwd} openFile={openFile} inspectCall={inspectCall} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The entry chip: one compact line that opens the drawer. Registered into the
 * shared store so the drawer can render the full material without re-reading
 * the conversation projection.
 */
const ToolEntry = memo(function ToolEntry({
  nodes, turn, turnStart, cwd, openFile, inspectCall, t, turnProcess, useChat, closed,
}: {
  readonly nodes: readonly ChatNode<'tool-call'>[]
  readonly turn: number
  readonly turnStart?: number | undefined
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
  readonly t: ChatViewSlotProps['t']
  readonly turnProcess?: { readonly foldable: boolean } | undefined
  readonly useChat: ChatNodeViewProps<'tool-call'>['useChat']
  /** 回合已结束（开始总结）：轨道逐行滑出再合拢，而不是一下全收。 */
  readonly closed: boolean
}) {
  const store: ActivityStore = activityStore()
  useEffect(() => {
    store.setTools(turn, nodes, cwd, turnStart)
    store.setHandlers({ openFile, inspectCall })
  }, [store, turn, nodes, cwd, turnStart, openFile, inspectCall])
  const stats = useMemo(() => computeStats(nodes.map(node => node.data.root)), [nodes])
  const activity = useTurnActivityCounts(turn, useChat)
  const running = stats.running > 0
  // 官方 control 行接管时（紧凑模式 closed 回合）本行让位：只登记抽屉数据，
  // 不占行（control 影子行是唯一的入口）。running 与接管互斥（接管要求回合
  // closed，运行时 control 不 foldable），因此直接整体返回 null 即可，实时卡
  // 片只在运行时出现、不受影响。
  const controlActive = turnProcess?.foldable === true
  // 抽屉开合态：官方 turn-process 行靠 data-open 把 chevron 转下来，这里同行。
  const drawerOpen = useDrawerOpen(turn)
  const now = useNow(running)
  // "当前工具"的时长：取仍在运行的最早一个 tool/call 时间，而不是整轮 turn 开始时间。
  const toolStart = useMemo(() => {
    let earliest: number | undefined
    for (const node of nodes) {
      const block = node.data.root
      if (isRunning(block) && (earliest === undefined || block.time < earliest)) earliest = block.time
    }
    return earliest
  }, [nodes])
  const elapsed = toolStart !== undefined ? Math.max(0, now - toolStart) : undefined
  // 本轮全部非空思考段（时间序，有工具调用时思考 chip 让位，实时预览改挂
  // 在工具行下方）。全部进单轨视口，新段在底部长出来、旧行从顶部逐行顶出，
  // 只有回合 closed 才整轨回收。
  const liveStackItems = useChat(snapshot => {
    if (turn === undefined) return [] as readonly LiveThinkingItem[]
    const out: LiveThinkingItem[] = []
    for (const key of snapshot.locations.getTurn(turn)) {
      const candidate = snapshot.nodes.get(key)
      if (candidate === undefined || candidate.kind !== 'assistant-step') continue
      const step = candidate as ChatNode<'assistant-step'>
      const stepRunning = step.data.status === 'running'
      for (const block of step.data.blocks) {
        if (block.kind === 'reasoning' && block.text !== '') {
          out.push({ text: block.text, step: step.data.step, running: stepRunning })
        }
      }
    }
    return out as readonly LiveThinkingItem[]
  })
  // 统计仍在运行的工具类型，决定是否在对话流外面直接显示下载/执行进度卡片。
  const liveActivity = useMemo(() => {
    let hasDownload = false
    let hasCommand = false
    let downloadInfo: DownloadInfo | undefined
    for (const node of nodes) {
      const block = node.data.root
      if (!isRunning(block)) continue
      const activity = classifyActivity(block)
      if (activity === 'download') {
        hasDownload = true
        if (downloadInfo === undefined) downloadInfo = parseDownload(block)
      } else if (activity === 'command') {
        hasCommand = true
      }
    }
    return { hasDownload, hasCommand, downloadInfo }
  }, [nodes])
  // 运行中的下载调用（root 或 run_code 子调用）：download 工具走 host 进度表；
  // shell 下载（curl/iwr -OutFile/-o 等解析出落盘路径）注册文件看护——host stat
  // 字节增长合成同形进度，真实速度/百分比。无落盘路径的 API 抓取回落不定长卡。
  const liveDownloadCalls = useMemo(
    () => nodes
      .flatMap(node => collectRunningCalls(node.data.root))
      .map(block => {
        const isTool = callName(block) === 'download'
        // 只给「确实是下载」的调用挂卡：跑构建/改文件的 shell 命令不算。
        const info = isTool || classifyActivity(block) === 'download' ? parseDownload(block) : undefined
        return {
          block,
          url: info?.url ?? '',
          outputPath: isTool ? undefined : (info?.output || undefined),
        }
      })
      .filter(({ block, outputPath }) => callName(block) === 'download' || outputPath !== undefined)
      .slice(0, 3),
    [nodes],
  )
  const showDownload = running && liveActivity.hasDownload && liveDownloadCalls.length === 0
  const showCommand = running && !liveActivity.hasDownload && liveDownloadCalls.length === 0 && liveActivity.hasCommand && (elapsed ?? 0) > 1000
  // 文案与官方 TurnProcessNodeView 逐字一致（同 chat locale 键）；运行中保持
  // 原有的实时时长（官方行在流式期不存在，进抽屉前给个活指示）。
  const resting = t(stats.total === 1 ? 'message.turnProcess.toolCalls.one' : 'message.turnProcess.toolCalls.other', { count: stats.total })
  const label = running
    ? elapsed !== undefined ? `工具调用中 · ${formatDuration(elapsed)}` : '工具调用中'
    : activity.reasoning > 0 ? `${resting}${t('message.turnProcess.separator') as string}${activity.reasoning} 次思考` : resting
  // 总结瞬间 control 接管不能直接卸载：否则堆叠来不及播回收，看起来“一瞬间
  // 就没了”。接管后保留挂载播完回收（只剩堆叠、按钮已让位），再彻底让位。
  const entryMotion = useMotionAllowed(true)
  const [deferredControl, setDeferredControl] = useState(controlActive)
  useEffect(() => {
    if (!controlActive) { setDeferredControl(false); return undefined }
    if (liveStackItems.length === 0) { setDeferredControl(true); return undefined }
    setDeferredControl(false)
    if (!entryMotion) { setDeferredControl(true); return undefined }
    const id = window.setTimeout(() => { setDeferredControl(true) }, LIVE_RECLAIM_UNMOUNT_MS)
    return () => { window.clearTimeout(id) }
  }, [controlActive, liveStackItems.length, entryMotion])
  const isKrMode = typeof document !== 'undefined' && document.body.hasAttribute('data-dsh-kr-chat')
  if (isKrMode) return null

  if (deferredControl) return null
  if (controlActive) {
    return (
      <div className={`${NS}__entry-wrap`} data-reclaim="true">
        <LiveThinkingStack items={liveStackItems} closing />
      </div>
    )
  }

  return (
    <div className={`${NS}__entry-wrap`} data-reclaim={closed || undefined}>
      <button
        type="button"
        className={`${NS}__process`}
        data-open={drawerOpen || undefined}
        data-running={running || undefined}
        data-turn-process={turn}
        data-turn-process-tool-calls={stats.total}
        data-turn-process-messages={0}
        data-turn-process-subagents={0}
        aria-expanded={drawerOpen}
        aria-label={label}
        onClick={() => { store.open(turn, 'tools') }}
      >
        <span className={`${NS}__process-label`}>{label}</span>
        <IconChevronDownOutlineRegular size={14} className={`${NS}__process-chevron`} />
      </button>
      <LiveThinkingStack items={liveStackItems} closing={closed} />
      {liveDownloadCalls.map(({ block, url, outputPath }) => (
        <LiveDownloadCard key={block.callId} callId={block.callId} url={url} startedAt={block.time} outputPath={outputPath} />
      ))}
      {showDownload && (
        <div className={`${NS}__download-card`}>
          <div className={`${NS}__download-head`}>
            <IconDownloadOutlineRegular size={14} aria-hidden />
            <span className={`${NS}__download-title`}>下载中 · {formatDuration(elapsed ?? 0)}</span>
          </div>
          {liveActivity.downloadInfo?.url !== undefined && liveActivity.downloadInfo.url !== '' && (
            <div className={`${NS}__download-url`} title={liveActivity.downloadInfo.url}>{liveActivity.downloadInfo.url}</div>
          )}
          {liveActivity.downloadInfo?.output !== undefined && liveActivity.downloadInfo.output !== '' && (
            <div className={`${NS}__download-dest`} title={liveActivity.downloadInfo.output}>保存到 <code>{liveActivity.downloadInfo.output}</code></div>
          )}
          <div className={`${NS}__download-progress`}><span className={`${NS}__progress`} aria-hidden /></div>
        </div>
      )}
      {showCommand && (
        <div className={`${NS}__entry-live`} data-kind="command">
          <span className={`${NS}__progress`} aria-hidden />
          <span>执行中 · {formatDuration(elapsed ?? 0)}</span>
        </div>
      )}
    </div>
  )
})

/** Shadows the built-in `tool-call` renderer: one chip per turn, drawer on click. */
export const ToolGroupNodeView = memo(function ToolGroupNodeView(props: ChatNodeViewProps<'tool-call'>) {
  // KR 门控的判定可以提前算，但**早退必须留在所有 hook 之后**。
  // 原来这里 `if (isKrMode) return null` 写在两个 useChat 之前，于是 hook 数量
  // 取决于一个渲染期从 body 属性读出的全局值：同一 fiber 在 KR 模式下渲染过
  // （0 个 hook）之后，只要宿主再次渲染它而此时 data-dsh-kr-chat 已被
  // controller 移除（切到「对话」标签就会 removeAttribute），React 会在
  // renderWithHooks 抛 "Rendered more hooks than during the previous render"，
  // 异常一路冒到聊天树的 ErrorBoundary。同文件的 ToolEntry 与
  // ThinkingStepNodeView 都是无条件调用 useChat 的写法。
  const isKrMode = typeof document !== 'undefined' && document.body?.getAttribute('data-dsh-kr-chat') === 'true'

  const { node, useChat, cwd, openFile, inspectCall, t, turnProcess } = props
  const turn = turnNumber(node)
  const nodes = useChat(snapshot => {
    if (turn === undefined) return EMPTY
    return snapshot.locations.getTurn(turn)
      .map(key => snapshot.nodes.get(key))
      .filter((candidate): candidate is ChatNode<'tool-call'> => (
        candidate !== undefined && candidate.kind === 'tool-call'
      ))
  })
  const turnStart = useChat(snapshot => {
    if (turn === undefined) return undefined
    return snapshot.legacy.turnTimings.get(turn)?.startTime
  })
  if (isKrMode) return null
  if (nodes.length === 0) return null
  // Only the first node of the turn renders the chip; siblings render empty.
  if (node.key !== nodes[0]?.key) return null
  const loc = node.location as { readonly kind?: string; readonly turn?: { readonly status?: string } } | undefined
  const closed = loc !== undefined && (loc.kind === 'turn' || loc.kind === 'step') && loc.turn?.status === 'closed'
  return (
    <ToolEntry
      nodes={nodes}
      turn={turn as number}
      turnStart={turnStart}
      cwd={cwd}
      openFile={openFile}
      inspectCall={inspectCall}
      t={t}
      turnProcess={turnProcess}
      useChat={useChat}
      closed={closed === true}
    />
  )
})
