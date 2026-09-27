/**
 * Shared activity drawer: a window-level bus that collects one turn's
 * reasoning and tool-call material from the two entry rows, plus the
 * centered dialog that renders it on demand (screenshot-panel同款居中弹窗，
 * modal-animation 进出场）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { IconApiOutlineRegular, IconThinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { computeStats, formatDuration, isRunning, isUrlEntry, shortenEntry, type ToolStats } from './tool-stats.ts'
import { kindByToolName, type ActivityKind } from './activity-kind.ts'
import { KindIcon } from './icons.tsx'
import { useNow } from './use-now.ts'
import { groupReasoning } from './reasoning-classify.ts'
import { ToolCallTreeList } from './ToolGroupNodeView.tsx'
import { ErrorBoundary } from '../error-boundary.tsx'
import { modalAnimClass, modalMaskAnimClass, modalStaggerClass } from '../modal-animation.ts'
import { LiveThinkingStack, LIVE_RECLAIM_UNMOUNT_MS, type LiveThinkingItem } from '../thinking/live-stack.tsx'
import { getKrChatStore } from '../kr-chat/kr-chat-store.ts'

/**
 * 活动抽屉进出场时长（ms）：必须与 tool-summary/styles.ts 里
 * `.dts__dialog(-mask).dsh-modal-*-in/out` 的 420ms 覆盖一致。
 * 共享的 MODAL_ANIM_MS 只有 240ms（截图面板等共用方在用），本弹窗放慢了一档，
 * 关闭计时用错就会提前卸载、退出动画播一半被掐。
 */
const DRAWER_ANIM_MS = 420

/** One reasoning block stranded in the drawer. */
export interface ActivityReasoningItem {
  readonly text: string
  readonly running: boolean
  /** 所属 assistant step（悬浮轨道的思考数字标签与稳定 key 用，无则按序号）。 */
  readonly step?: number | undefined
}

/** Everything the drawer can show for one turn. */
export interface ActivityTurnData {
  readonly reasoning?: readonly ActivityReasoningItem[]
  readonly tools?: readonly ChatNode<'tool-call'>[]
  readonly toolsCwd?: string | undefined
  readonly turnStart?: number | undefined
}

/** The cross-plugin bus shape. */
export type ViewMode = 'reasoning' | 'tools'

export interface ActivityHandlers {
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}

export interface ActivityStore {
  readonly openTurn: number | null
  readonly activeMode: ViewMode | null
  /** 流式思考预览：登记的 control 行元素与回合号（null = 无预览）。 */
  readonly previewAnchorEl: HTMLElement | undefined
  readonly previewTurn: number | null
  setPreviewAnchor(el: HTMLElement | undefined, turn: number | null): void
  open(turn: number, mode: ViewMode): void
  close(reason?: string): void
  setReasoning(turn: number, items: readonly ActivityReasoningItem[]): void
  setTools(turn: number, nodes: readonly ChatNode<'tool-call'>[], cwd: string | undefined, turnStart: number | undefined): void
  setHandlers(handlers: ActivityHandlers): void
  subscribe(fn: () => void): () => void
  get(turn: number): ActivityTurnData | undefined
  getLatestTurn(): number
  clear(): void
  handlers(): ActivityHandlers
}

const STORE_KEY = '__dshActivityDrawerStore__'
const guardedStores = new WeakSet<ActivityStore>()

/** 普通「对话」不应消费/打开 KR 的思考抽屉。 */
function isOrdinaryChat(): boolean {
  try {
    return getKrChatStore().snapshot.activeTab !== 'kr'
  } catch {
    return true
  }
}

/**
 * 兼容已经由旧 dsh-webui / 旧 chat-plus 创建的同名 window 总线。
 * 旧对象可能仍暴露 reasoning 打开入口；这里在总线边界统一拦截，避免旧
 * React 树或旧调用方把思考弹窗带回普通对话。KR 模式原样透传。
 */
function installModeGuards(store: ActivityStore): ActivityStore {
  if (guardedStores.has(store)) return store
  guardedStores.add(store)
  const originalOpen = store.open.bind(store)
  const originalGet = store.get.bind(store)
  store.open = (turn, mode) => {
    // 普通「对话」不展示回合折叠，也不打开活动弹窗；KR 视图原样透传。
    if (isOrdinaryChat()) {
      store.close('ordinary-chat-drawer-disabled')
      return
    }
    originalOpen(turn, mode)
  }
  store.get = (turn) => {
    const value = originalGet(turn)
    if (isOrdinaryChat() && value?.reasoning !== undefined) {
      return { ...value, reasoning: undefined }
    }
    return value
  }
  // 切回普通对话时关闭旧总线中已打开的抽屉；切到 KR 不做任何事。
  getKrChatStore().subscribe(() => {
    if (isOrdinaryChat() && store.openTurn !== null) store.close('mode-transition')
  })
  return store
}

/** Create-or-read the shared window bus. */
export function activityStore(): ActivityStore {
  const globalObj = globalThis as Record<string, unknown>
  const existing = globalObj[STORE_KEY] as ActivityStore | undefined
  if (existing !== undefined) {
    const guarded = installModeGuards(existing)
    // 页面加载后普通模式可能还挂着旧 bundle 留下的弹窗，立刻关掉。
    if (isOrdinaryChat() && guarded.openTurn !== null) guarded.close('ordinary-chat-drawer-disabled')
    return guarded
  }
  const listeners = new Set<() => void>()
  const data = new Map<number, ActivityTurnData>()
  let openTurn: number | null = null
  let activeMode: ViewMode | null = null
  let previewAnchorEl: HTMLElement | undefined
  let previewTurn: number | null = null
  let handlers: ActivityHandlers = { openFile: () => {}, inspectCall: () => {} }
  const notify = (): void => {
    for (const fn of [...listeners]) {
      try { fn() } catch { /* a dying listener must not kill the bus */ }
    }
  }
  const store: ActivityStore = {
    get openTurn() { return openTurn },
    get activeMode() { return activeMode },
    get previewAnchorEl() { return previewAnchorEl },
    get previewTurn() { return previewTurn },
    setPreviewAnchor: (el, turn) => {
      if (previewAnchorEl === el && previewTurn === turn) return
      previewAnchorEl = el
      previewTurn = turn
      notify()
    },
    open: (turn, mode) => {
      // 点击时自愈：如果抽屉根被 React 异常卸载（空壳 div）或 HMR 后失活，
      // 这里同步重挂，否则就是“点了没弹窗”（store 变了没人渲染）。
      try {
        ensureDrawerMounted()
      } catch (healError) {
        console.warn('[dsh-chat-plus] 弹窗 open 前自愈挂载失败：', healError)
      }
      openTurn = turn; activeMode = mode; notify()
      // 二次兜底：自愈靠 childNodes 判断，根已死但 DOM 残留时会 early-return，
      // 此时订阅者数为 0（没人能渲染），必须强制重挂。新挂载的 DrawerApp 会在
      // 首个 effect 里读到 openTurn 并弹出来，不需要二次 notify。
      if (listeners.size === 0) {
        try {
          mountActivityDrawer(true)
        } catch (healError) {
          console.warn('[dsh-chat-plus] 弹窗无订阅者强制重挂失败：', healError)
        }
      }
    },
    close: (reason?: string) => { void reason; openTurn = null; activeMode = null; notify() },
    setReasoning: (turn, items) => {
      data.set(turn, { ...(data.get(turn) ?? {}), reasoning: items })
      notify()
    },
    setTools: (turn, nodes, cwd, turnStart) => {
      data.set(turn, { ...(data.get(turn) ?? {}), tools: nodes, toolsCwd: cwd, turnStart })
      notify()
    },
    setHandlers: (next) => { handlers = next },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    get: (turn) => data.get(turn),
    getLatestTurn: () => {
      const keys = [...data.keys()]
      return keys.length > 0 ? Math.max(...keys) : 1
    },
    clear: () => {
      data.clear()
      openTurn = null
      activeMode = null
      previewAnchorEl = undefined
      previewTurn = null
      notify()
    },
    handlers: () => handlers,
  }
  globalObj[STORE_KEY] = store
  const guarded = installModeGuards(store)
  if (isOrdinaryChat() && guarded.openTurn !== null) guarded.close('ordinary-chat-drawer-disabled')
  return guarded
}

/**
 * Whether the shared drawer is currently open for one turn. Entry rows bind
 * it to `data-open` so the chevron mirrors the official turn-process row
 * (closed = chevron points left, open = points down).
 */
/** Drawer tab: which panel the modal shows (row click picks the initial one). */
export type DrawerTab = ViewMode

export function useDrawerOpen(turn: number): boolean {
  const store = activityStore()
  return useSyncExternalStore(store.subscribe, () => store.openTurn === turn)
}

/** Summary card for the drawer's tool section. */
function DrawerToolSummary({ stats, cwd, openFile, kinds }: {
  readonly stats: ToolStats
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly kinds: ReadonlyMap<string, ActivityKind>
}) {
  return (
    <div className="dts__summary">
      <div className="dts__summary-title"><IconApiOutlineRegular size={13} aria-hidden /> 工具调用总结</div>
      <div className="dts__summary-line">
        共 <b>{stats.total}</b> 次调用
        {stats.running > 0 && <> · <b>{stats.running}</b> 次进行中</>}
        {stats.errors > 0 && <> · <span className="dts__summary-errors"><b>{stats.errors}</b> 次失败</span></>}
      </div>
      {stats.byTool.length > 0 && (
        <div className="dts__chips">
          {stats.byTool.map(({ name, count }) => (
            <span key={name} className="dts__chip" data-tool={name} data-kind={kinds.get(name)?.key}>{name} ×{count}</span>
          ))}
        </div>
      )}
      {stats.files.length > 0 && (
        <div className="dts__files">
          {stats.files.map(path => {
            const url = isUrlEntry(path)
            return (
              <button
                key={path}
                type="button"
                className="dts__file"
                title={path}
                onClick={() => {
                  // URL 不是工作区文件：openFile 接不动，直接开新标签页。
                  if (url) window.open(path, '_blank', 'noopener,noreferrer')
                  else openFile(path)
                }}
              >
                {shortenEntry(path, cwd)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Classified reasoning blocks with per-category headings. */
function ReasoningGroups({ items, activeIndex }: {
  readonly items: readonly ActivityReasoningItem[]
  readonly activeIndex: number | null
}) {
  const groups = useMemo(() => groupReasoning(items), [items])
  let cursor = 0
  return (
    <div className="dts__modal-reasoning">
      {groups.map(group => {
        const firstIndex = cursor
        cursor += group.items.length
        return (
          <div key={group.category.label} className="dts__modal-reasoning-group" data-reasoning-category={group.category.label}>
            <div className="dts__modal-reasoning-group-title">
              <KindIcon kind={group.category.icon} size={12} /> {group.category.label} ({group.items.length})
            </div>
            {group.items.map((item) => {
              const globalIndex = firstIndex + group.items.indexOf(item)
              return (
                <div
                  key={globalIndex}
                  data-reasoning-index={globalIndex}
                  data-active={activeIndex === globalIndex || undefined}
                  className="dts__modal-reasoning-item"
                  data-running={item.running || undefined}
                >
                  <span className="dts__modal-reasoning-item-text">{item.text}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** The centered dialog: two separate panels — thinking and tools. */
function DrawerPanel({ turn, data, store, openFile, inspectCall, closing }: {
  readonly turn: number
  readonly data: ActivityTurnData | undefined
  readonly store: ActivityStore
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
  /** 出场中：播出场动画再卸载（见 DrawerApp 的 closing 状态机）。 */
  readonly closing: boolean
}) {
  const krStore = getKrChatStore()
  const isKrMode = useSyncExternalStore(
    (cb) => krStore.subscribe(cb),
    () => krStore.snapshot.activeTab === 'kr',
  )
  // 共享总线的历史数据可能来自 KR；普通「对话」渲染层再次硬隔离，
  // 即使旧调用方/旧 bundle 仍传来 reasoning，也不会显示思考页签或思考正文。
  const reasoning = isKrMode ? (data?.reasoning ?? []) : []
  const toolNodes = data?.tools ?? []
  const blocks = useMemo(() => toolNodes.map(node => node.data.root), [toolNodes])
  const stats = useMemo(() => computeStats(blocks), [blocks])
  const kinds = useMemo(() => kindByToolName(blocks), [blocks])
  const close = (): void => { store.close() }
  const mode = isKrMode ? store.activeMode : 'tools'
  // 分区页签：行点击只决定初始分区（工具有工具、纯思考进思考），两个分区
  // 都有内容时页签常驻可切——单行合并后不能再让思考“消失”。面板按 key=turn
  // 重挂，mode 变化（同轮重开）时跟随。
  const [tab, setTab] = useState<DrawerTab>(mode ?? (reasoning.length > 0 ? 'reasoning' : 'tools'))
  useEffect(() => {
    if (!isKrMode) setTab('tools')
  }, [isKrMode])
  useEffect(() => { if (mode !== null) setTab(mode) }, [mode])
  const showTabs = isKrMode && reasoning.length > 0 && toolNodes.length > 0
  // 下划线用选中页签自己的 ::after 画（纯 CSS，见 styles），切换时新线展开
  // 0.22s——不量位置、不插指示条元素，任何环境都不会走样。

  // Live elapsed time + auto-scroll while the turn is still working.
  const reasoningRunning = reasoning.some(item => item.running)
  const toolsRunning = stats.running > 0
  const anyRunning = reasoningRunning || toolsRunning
  const now = useNow(anyRunning)
  const turnStart = data?.turnStart
  const elapsed = turnStart !== undefined ? Math.max(0, now - turnStart) : undefined
  // "当前工具"的时长：取仍在运行的最早一个 tool/call 时间，而非整轮 turn 总时长。
  const toolsElapsed = useMemo(() => {
    let earliest: number | undefined
    for (const node of toolNodes) {
      const block = node.data.root
      if (isRunning(block) && (earliest === undefined || block.time < earliest)) earliest = block.time
    }
    return earliest !== undefined ? Math.max(0, now - earliest) : undefined
  }, [toolNodes, now])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 打开的卡片不强制压着读者走：仅在读者钉在底部时跟随新内容滚到底；
  // 向上翻阅即停止自动滚动（想看哪里自己滚），滚回底部（≤24px）自动恢复。
  // 阈值与 ChatView 的 FOLLOW_THRESHOLD 一致；滚动事件记录「是否钉底」，
  // 纯几何判断无法区分「内容自己长高」和「读者上翻」，必须有这面旗子。
  const pinnedRef = useRef(true)
  const onScrollPin = useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
  }, [])
  useEffect(() => {
    if (!anyRunning) return
    const el = scrollRef.current
    if (el === null) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    // 双保险：滚动事件尚未派发的一帧内，几何距离也能拦住一次误跟随。
    if (!pinnedRef.current && distance > 24) return
    el.scrollTop = el.scrollHeight
  }, [anyRunning, now, reasoning, toolNodes])

  // Jump navigation over reasoning items (querySelector over refs: refs get
  // cleared by effects and are unreliable across re-renders).
  const [activeIndex] = useState<number | null>(null)

  return (
    <>
      <div className={`dts__dialog-mask ${modalMaskAnimClass(closing)}`} onClick={close} aria-hidden />
      <div className={`dts__dialog ${modalAnimClass(closing)}`} role="dialog" aria-modal="true" aria-label={`第 ${turn} 轮活动详情`}>
        <header className="dts__modal-head">
          <span className="dts__modal-title">
            第 {turn} 轮
            {!showTabs && tab === 'reasoning' && (
              <> · <IconThinkOutlineRegular size={14} aria-hidden /> {reasoning.length}</>
            )}
            {!showTabs && tab === 'tools' && (
              <> · <IconApiOutlineRegular size={14} aria-hidden /> {toolNodes.length}</>
            )}
          </span>
          {showTabs && (
            <span className="dts__tabs" role="tablist" aria-label="分区">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'reasoning'}
                className="dts__tab"
                data-active={tab === 'reasoning' || undefined}
                onClick={() => { setTab('reasoning') }}
              >
                <IconThinkOutlineRegular size={13} aria-hidden /> {reasoning.length} 次思考
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'tools'}
                className="dts__tab"
                data-active={tab === 'tools' || undefined}
                onClick={() => { setTab('tools') }}
              >
                <IconApiOutlineRegular size={13} aria-hidden /> 工具 {toolNodes.length}
              </button>
            </span>
          )}
          <button type="button" className="dts__modal-close" onClick={close} aria-label="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
        </header>
        <div className={`dts__modal-scroll ${modalStaggerClass}`} ref={scrollRef} onScroll={onScrollPin}>
          {tab === 'reasoning' && reasoning.length > 0 && (
            <div className="dts__modal-panel">
              <header className="dts__modal-panel-head">
                <span className="dts__modal-panel-title"><IconThinkOutlineRegular size={14} aria-hidden /> 思考过程</span>
                {reasoningRunning && elapsed !== undefined && (
                  <span className="dts__modal-panel-live">思考中 · {formatDuration(elapsed)}</span>
                )}
              </header>
              <ReasoningGroups items={reasoning} activeIndex={activeIndex} />
            </div>
          )}
          {tab === 'tools' && toolNodes.length > 0 && (
            <div className="dts__modal-panel">
              <header className="dts__modal-panel-head">
                <span className="dts__modal-panel-title"><IconApiOutlineRegular size={14} aria-hidden /> 工具调用</span>
                {toolsRunning && toolsElapsed !== undefined && (
                  <span className="dts__modal-panel-live">进行中 · {formatDuration(toolsElapsed)}</span>
                )}
              </header>
              <DrawerToolSummary stats={stats} cwd={data?.toolsCwd} openFile={openFile} kinds={kinds} />
              <div className="dts__modal-tools">
                {toolNodes.map(node => (
                  <ToolCallTreeList
                    key={node.key}
                    block={node.data.root}
                    cwd={data?.toolsCwd}
                    openFile={openFile}
                    inspectCall={inspectCall}
                  />
                ))}
              </div>
            </div>
          )}
          {tab === 'reasoning' && reasoning.length === 0 && (
            <div className="dts__empty">这一轮没有可显示的思考过程</div>
          )}
          {tab === 'tools' && toolNodes.length === 0 && (
            <div className="dts__empty">这一轮没有可显示的工具调用</div>
          )}
        </div>
      </div>
    </>
  )
}

/** Drawer app: subscribes to the bus and renders the panel when open. */
function DrawerApp() {
  const [openTurn, setOpenTurn] = useState<number | null>(null)
  const [lastTurn, setLastTurn] = useState<number | null>(null)
  const [openMode, setOpenMode] = useState<ViewMode | null>(null)
  const [data, setData] = useState<ActivityTurnData | undefined>(undefined)
  // 出场过渡：store 关闭后多留一帧播出场动画再卸载。
  // 时长必须与 tool-summary/styles.ts 里本弹窗的 420ms 覆盖对齐
  //（共享 MODAL_ANIM_MS 只有 240ms，用它会提前卸载、退出播一半被掐掉，
  // 看起来就像没有关闭动画）。
  const [closing, setClosing] = useState(false)
  const openTurnRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
  }, [])
  useEffect(() => {
    const store = activityStore()
    const render = (): void => {
      const turn = store.openTurn
      if (turn === null) {
        // Close and play exit animation in the SAME batched update: setting
        // closing here avoids unmounting for one frame and remounting the
        // next (which reads as a flash).
        if (openTurnRef.current !== null) {
          openTurnRef.current = null
          if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
          setOpenTurn(null)
          setClosing(true)
          closeTimerRef.current = window.setTimeout(() => { setClosing(false) }, DRAWER_ANIM_MS)
        }
        return
      }
      openTurnRef.current = turn
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = undefined
      }
      setOpenTurn(turn)
      setClosing(false)
      setLastTurn(turn)
      setOpenMode(store.activeMode)
      setData(store.get(turn))
    }
    render()
    return store.subscribe(render)
  }, [])
  // Esc 关弹窗。
  useEffect(() => {
    if (openTurn === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') activityStore().close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [openTurn])
  // 悬浮思考预览轨道：贴着干活中回合的 control 行下方，单竖条 + 单视口。
  // 预览由 control 行把行元素登记进来（setPreviewAnchor，思考流 + tool 间隙
  // 常驻，整轮收口才清）；新段在底部长出来、旧行逐行顶出，收口逐行滑出回收。
  const [preview, setPreview] = useState<{ readonly top: number; readonly left: number; readonly turn: number; readonly items: readonly LiveThinkingItem[] } | null>(null)
  const [reclaimPreview, setReclaimPreview] = useState<{ readonly top: number; readonly left: number; readonly turn: number; readonly items: readonly LiveThinkingItem[] } | null>(null)
  const reclaimTimerRef = useRef<number | undefined>(undefined)
  const previewRef = useRef<typeof preview>(null)
  previewRef.current = preview
  useEffect(() => () => {
    if (reclaimTimerRef.current !== undefined) window.clearTimeout(reclaimTimerRef.current)
  }, [])
  useEffect(() => {
    const store = activityStore()
    const sameItems = (
      a: readonly LiveThinkingItem[],
      b: readonly LiveThinkingItem[],
    ): boolean => a.length === b.length && a.every((entry, idx) => (
      entry.text === b[idx]?.text && entry.running === b[idx]?.running && entry.step === b[idx]?.step
    ))
    const update = (): void => {
      const el = store.previewAnchorEl
      const turn = store.previewTurn
      const turnData = turn === null ? undefined : store.get(turn)
      const reasoning = turnData?.reasoning ?? []
      const items: LiveThinkingItem[] = []
      for (let index = 0; index < reasoning.length; index += 1) {
        const item = reasoning[index]
        if (item === undefined || item.text === '') continue
        items.push({
          text: item.text,
          step: item.step ?? (index + 1),
          running: item.running,
        })
      }
      const usable = el !== undefined && el.isConnected && turn !== null && items.length > 0
      if (!usable) {
        // 锚点没了（整轮收口）：把当前轨道冻结成回收态逐行滑出，不一下全收；
        // tool 间隙锚点常驻，走不到这里。
        if (reclaimTimerRef.current !== undefined) return
        const prev = previewRef.current
        if (prev === null) return
        setReclaimPreview({ top: prev.top, left: prev.left, turn: prev.turn, items: prev.items })
        reclaimTimerRef.current = window.setTimeout(() => {
          reclaimTimerRef.current = undefined
          setReclaimPreview(null)
        }, LIVE_RECLAIM_UNMOUNT_MS)
        setPreview(null)
        return
      }
      const box = (el as HTMLElement).getBoundingClientRect()
      if (box.bottom < 0 || box.top > window.innerHeight) return
      const top = box.bottom + 2
      const left = (el as HTMLElement).getBoundingClientRect().left
      // 新回合或新锚点：清掉上一轮的回收态，避免串味。
      setReclaimPreview(null)
      if (reclaimTimerRef.current !== undefined) {
        window.clearTimeout(reclaimTimerRef.current)
        reclaimTimerRef.current = undefined
      }
      const prev = previewRef.current
      if (prev !== null && prev.turn === turn && prev.top === top && prev.left === left && sameItems(prev.items, items)) return
      setPreview({ top, left, turn, items })
    }
    update()
    // store 变更（锚点/思考文字）即时跟进，不等 500ms 轮询，收口回收不拖拍。
    const unsubscribe = store.subscribe(() => { update() })
    const onMove = (): void => { requestAnimationFrame(update) }
    window.addEventListener('scroll', onMove, { passive: true, capture: true })
    window.addEventListener('resize', onMove)
    const id = window.setInterval(update, 500)
    return () => {
      unsubscribe()
      window.removeEventListener('scroll', onMove, { capture: true } as EventListenerOptions)
      window.removeEventListener('resize', onMove)
      window.clearInterval(id)
    }
  }, [])
  const floating = preview !== null
    ? { ...preview, closing: false as const }
    : reclaimPreview !== null
      ? { ...reclaimPreview, closing: true as const }
      : null
  const floatingNode = floating === null ? null : (
    <div className="dts__preview-stack" style={{ position: 'fixed', top: floating.top, left: floating.left }} aria-live="polite">
      <LiveThinkingStack key={floating.turn} items={floating.items} closing={floating.closing} compact />
    </div>
  )
  // 滚动跟随由抽屉内部的钉底逻辑负责。
  const store = activityStore()
  const shownTurn = openTurn ?? lastTurn
  if (shownTurn === null || (openTurn === null && !closing)) {
    // 无弹窗时仍可渲染悬浮思考预览堆叠。
    return floatingNode
  }
  const turn = shownTurn
  const handlers = store.handlers()
  const closeAll = (): void => { store.close() }
  return (
    <>
      <ErrorBoundary
        key={turn + ':' + (openMode ?? '')}
        label={'活动弹窗（第 ' + turn + ' 轮）'}
        fallback={(
          <div
            className="dts__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={'第 ' + turn + ' 轮活动详情'}
          >
            <header className="dts__modal-head">
              <span className="dts__modal-title">第 {turn} 轮</span>
              <button type="button" className="dts__modal-close" onClick={closeAll} aria-label="关闭">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                </svg>
              </button>
            </header>
            <div className="dts__modal-scroll">
              <div className="dts__empty">弹窗渲染失败，详情见控制台（F12）。关闭后换一轮重开可重试。</div>
            </div>
          </div>
        )}
      >
        <DrawerPanel
          turn={turn}
          data={data}
          store={store}
          openFile={handlers.openFile}
          inspectCall={handlers.inspectCall}
          closing={closing}
        />
      </ErrorBoundary>
      {floatingNode}
    </>
  )
}

let mounted = false

/** 抽屉根的 React 句柄（自愈重挂用）。 */
let drawerRoot: import('react-dom/client').Root | null = null

/** 根挂载代数：每次重挂 +1，用作根错误边界的 key（崩了下次重挂自动清错，不粘死）。 */
let mountGen = 0

/**
 * store.open 调用前的同步自愈：根空了（被 React 异常卸载 / HMR 失活）就地重建。
 * 与 mountActivityDrawer 共用同一套创建逻辑，但可被 store 提前调用。
 */
export function ensureDrawerMounted(): void {
  if (typeof document === 'undefined') return
  const host = document.getElementById('dsh-activity-drawer-root')
  if (host !== null && host.childNodes.length > 0) return
  mountActivityDrawer()
}

/**
 * Mount the drawer root (idempotent + self-healing).
 *
 * 保留 first-writer-wins：若宿主已存在且有内容（另一个兼容版本的抽屉正在工作），
 * 直接复用不覆盖；只有宿主为空壳（旧根被异常卸载剩下空 div）时才重新 render 自愈。
 * 根外再包一层错误边界，DrawerApp 本体抛错也不会卸载整个根。
 * force=true（仅 store.open 无订阅者时用）：宿主有残留 DOM 也视为已死，
 * 先 unmount 再重建——此时没有任何存活树可被误伤。
 */
export function mountActivityDrawer(force?: boolean): void {
  if (typeof document === 'undefined') return
  let host = document.getElementById('dsh-activity-drawer-root')
  if (!force && host !== null && host.childNodes.length > 0) {
    // 有内容：别人（或之前的自己）正在用，幂等返回。
    mounted = true
    return
  }
  if (host === null) {
    host = document.createElement('div')
    host.id = 'dsh-activity-drawer-root'
    document.body.appendChild(host)
  }
  try {
    drawerRoot?.unmount()
  } catch {
    /* 旧句柄已死，忽略直接重建 */
  }
  drawerRoot = createRoot(host)
  mountGen += 1
  const gen = mountGen
  drawerRoot.render(
    <ErrorBoundary
      key={gen}
      label="活动抽屉根"
      fallback={null}
      onError={() => {
        // 根崩（DrawerApp 本体抛错）会自动卸载整个根，之后点击全部无反应。
        // 下一微任务重挂一个新根（key 代数 +1，老错不残留）；若重挂也崩，
        // 控制台会留下两条渲染崩溃日志用于定位，不会静默死掉。
        try {
          console.error('[dsh-chat-plus] 活动抽屉根崩溃，正在自愈重挂…')
        } catch { /* 日志永不挡路 */ }
        queueMicrotask(() => {
          try { mountActivityDrawer() } catch (remountError) {
            try {
              console.error('[dsh-chat-plus] 活动抽屉根自愈重挂失败：', remountError)
            } catch { /* 忽略 */ }
          }
        })
      }}
    >
      <DrawerApp />
    </ErrorBoundary>,
  )
  mounted = true
  // 调试钩子：控制台可 `__dshChatFlowDrawer.store` 查 openTurn / 手动 remount。
  try {
    ;(globalThis as Record<string, unknown>).__dshChatFlowDrawer = {
      remount: mountActivityDrawer,
      ensure: ensureDrawerMounted,
      store: activityStore(),
    }
  } catch {
    /* 非浏览器环境忽略 */
  }
}