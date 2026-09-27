/**
 * dsh-chat-plus — 实时思考预览轨道（左侧竖条 + 逐行上顶）。
 *
 * 需求（2026-09）：
 * 1. 去掉实时预览的卡片：不再是带描边/圆角/底色的双卡堆叠，改为左侧
 *    一条竖条 + 右侧纯文本流（无卡片铬）。
 * 2. 第 3 个思考出来时不是第 1 个直接消失：新内容在底部逐行长出来，
 *    旧内容被单视口的跟随滚动逐行顶出顶部裁掉，不再有整卡消散/整卡
 *    卸载的割裂感。
 *
 * 实现：
 * - 调用方仍把本轮全部非空思考段按时间顺序传进来
 *   `items: [{ text, step, running }]`，本组件全部渲染（不再只取最后
 *   2 个做窗口），共用一个有界视口（max-height + overflow-y auto）。
 * - key 用全局序号（过滤后数组下标）保证稳定：流式追加文字时不重挂，
 *   新段挂载只播一次淡入。
 * - 视口复用 `useSteppedFollow`（840ms 停顿、500ms 走两行）：新文字在
 *   底部长出来时视口分步跟随到底，旧行从顶部被逐行顶出去——“出来一行
 *   顶一行”就是这次跟随滚动本身。上翻/选中即停，滚回底部自动恢复。
 * - `closing=true`（回合 closed / 开始总结）时冻结当前全部段，整条轨道
 *   像收银条一样从顶部逐行滑出去（ticker：视口高度钉住、内层匀速上移，
 *   每行依次经过视口再从顶部裁掉），滑完剩下的空盒再合拢高度卸载；
 *   closing 期间忽略新 items。
 * - `prefers-reduced-motion` 时经 `useMotionAllowed` 直接落位、无延迟。
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useMotionAllowed, useSteppedFollow } from '../motion-utils.ts'

export interface LiveThinkingItem {
  readonly text: string
  readonly step: number
  readonly running: boolean
}

/**
 * 收口滑出时长基线（与 CSS dtt-rail-scroll-out 对齐，实际时长按段数浮动，
 * 见 reclaimTiming：段越多滑得越久，保证每行都有露脸时间）。
 */
export const LIVE_RECLAIM_MS = 1100
/** 收口第二阶段：空盒高度合拢时长（与 CSS 槽位 collapse 对齐）。 */
export const LIVE_RECLAIM_COLLAPSE_MS = 350
/** 内联行被 control 接管 / 悬浮锚点清除后，保留挂载播完回收的总时长 + 余量。 */
export const LIVE_RECLAIM_UNMOUNT_MS =
  LIVE_RECLAIM_MS + LIVE_RECLAIM_COLLAPSE_MS + 220
const RECLAIM_COLLAPSE_MS = LIVE_RECLAIM_COLLAPSE_MS

/**
 * 收口滑出时长：700ms 起步、每段 +180ms，夹在 800～1800ms 之间。
 * 段少时不拖沓，段多时每行都从视口里走一遍，不会一闪而过。
 */
function reclaimTiming(count: number, motion: boolean): { readonly scroll: number; readonly collapse: number } {
  if (!motion) return { scroll: 0, collapse: 0 }
  const scroll = Math.min(1800, Math.max(800, 700 + count * 180))
  return { scroll, collapse: RECLAIM_COLLAPSE_MS }
}

export type LiveCardState = 'enter' | 'visible' | 'leaving' | 'reclaim'

/**
 * 轨道槽位：只用于整轨回收时的高度合拢（grid 0fr/1fr 过渡）。
 * 新段进入不再包槽位——高度跳变一次到位，逐行上顶由视口跟随滚动完成，
 * 比“新卡展开 + 旧卡合拢”两套高度动画对拍更稳，不会有总高度跳动。
 */
const LiveSlot = memo(function LiveSlot({ anim, kind, delayMs, motion, children }: {
  readonly anim: 'enter' | 'collapse'
  readonly kind?: 'leave' | 'reclaim' | undefined
  readonly delayMs?: number | undefined
  readonly motion: boolean
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(anim === 'collapse')
  useLayoutEffect(() => {
    if (!motion) { setOpen(anim === 'collapse' ? false : true); return undefined }
    if (anim === 'enter') {
      setOpen(false)
      const raf = requestAnimationFrame(() => { setOpen(true) })
      return () => { cancelAnimationFrame(raf) }
    }
    setOpen(true)
    const raf = requestAnimationFrame(() => { setOpen(false) })
    return () => { cancelAnimationFrame(raf) }
  }, [anim, motion])
  const delay = motion && delayMs !== undefined && delayMs > 0
    ? { transitionDelay: `${delayMs}ms` } as CSSProperties
    : undefined
  return (
    <div
      className="dtt__live-slot"
      data-anim={anim}
      data-kind={kind}
      data-open={open ? 'true' : 'false'}
      style={delay}
    >
      {children}
    </div>
  )
})

/**
 * 兼容保留的单段导出（此前是单张实时卡）：现渲染为无滚动的轨道小段，
 * 仅供外部按旧名引用不报错；堆叠本体不再使用它。
 */
export const LiveThinkingCard = memo(function LiveThinkingCard({ text, step, running = true, state, style }: {
  readonly text: string
  readonly step: number
  readonly running?: boolean | undefined
  readonly state?: LiveCardState | undefined
  readonly style?: CSSProperties | undefined
}) {
  const dataState = state === 'enter' || state === undefined ? undefined : state
  return (
    <div
      className="dtt__reasoning-live-rail"
      data-single="true"
      data-running={running ? 'true' : 'false'}
      data-state={dataState}
      style={style}
    >
      <span className="dtt__reasoning-live-rail-bar" aria-hidden />
      <div className="dtt__reasoning-live-rail-static">
        <section className="dtt__reasoning-live-seg" data-running={running ? 'true' : 'false'}>
          <div className="dtt__reasoning-live-seg-meta"><span>思考</span><span className="dtt__reasoning-live-seg-tag">{step}</span><span>{running ? ' · 进行中' : ' · 已完成'}</span></div>
          <div className="dtt__reasoning-live-seg-text">{text}</div>
        </section>
      </div>
    </div>
  )
})

interface DisplayEntry {
  readonly key: string
  readonly item: LiveThinkingItem
}

/** 单段正文：meta 行 + 文本流（无卡片铬）。 */
const RailSeg = memo(function RailSeg({ entry }: { readonly entry: DisplayEntry }) {
  return (
    <section
      className="dtt__reasoning-live-seg"
      data-running={entry.item.running ? 'true' : 'false'}
      data-seg={entry.key}
    >
      <div className="dtt__reasoning-live-seg-meta"><span>思考</span><span className="dtt__reasoning-live-seg-tag">{entry.item.step}</span><span>{entry.item.running ? ' · 进行中' : ' · 已完成'}</span></div>
      <div className="dtt__reasoning-live-seg-text">{entry.item.text}</div>
    </section>
  )
})

/**
 * 单轨堆叠：`items` 为本轮全部非空思考段（时间序），`closing` 为回合已结束
 * （开始总结）。closing 由调用方按 `locationTurn.status === 'closed'` 传入；
 * 思考中途的 tool 间隙（running=false 但回合未关）不算 closing，旧段保留。
 */
export const LiveThinkingStack = memo(function LiveThinkingStack({ items, closing, compact }: {
  readonly items: readonly LiveThinkingItem[]
  readonly closing: boolean
  /** 悬浮预览（fixed 容器）时收紧视口高度，不至于撑满屏。 */
  readonly compact?: boolean | undefined
}) {
  const motion = useMotionAllowed(true)

  // 全局序号 key：过滤后数组下标天然稳定（只有追加 + 末尾文字增长）。
  const entries: readonly DisplayEntry[] = useMemo(
    () => items.map((item, index) => ({ key: String(index), item })),
    [items],
  )

  // 单视口跟随：合并文本做跟随探针（新段挂载 / 末段流式增长都会改变它）。
  const probe = useMemo(
    () => items.map(item => `${item.step}:${item.running ? '1' : '0'}:${item.text}`).join('\0'),
    [items],
  )
  const anyRunning = useMemo(() => items.some(item => item.running), [items])
  const followActive = !closing
  const { ref, onScroll, onWheel, edges, overflow, following, setFollowing } =
    useSteppedFollow(probe, followActive, motion)

  // 回收中快照：closing 置 true 的瞬间冻结全部段，整轨一次回收再整体卸载。
  const [reclaim, setReclaim] = useState<readonly DisplayEntry[] | null>(null)
  const timersRef = useRef<readonly ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => {
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current = []
  }, [])
  const later = (ms: number, fn: () => void): void => {
    if (ms <= 0) { fn(); return }
    const id = setTimeout(() => {
      timersRef.current = timersRef.current.filter(other => other !== id)
      fn()
    }, ms)
    timersRef.current = [...timersRef.current, id]
  }

  const closingRef = useRef(closing)
  useLayoutEffect(() => {
    const was = closingRef.current
    closingRef.current = closing
    if (!closing || was) return
    if (reclaim !== null) return
    if (entries.length === 0) return
    setReclaim(entries)
    const timing = reclaimTiming(entries.length, motion)
    later(timing.scroll + timing.collapse + 30, () => { setReclaim(null) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, entries, motion])

  // 新回合（items 清空且 closing 回落）时清回收态，下一轮淡入不受污染。
  useEffect(() => {
    if (!closing && items.length === 0 && reclaim !== null) setReclaim(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, items.length])

  if (reclaim !== null) {
    if (reclaim.length === 0) return null
    // 两阶段收口：先 ticker 滑出（视口钉住、内层上移逐行经过），再合拢空盒。
    // 时长按段数浮动，行内 style 与 JS 卸载计时用同一份 timing，对得上拍。
    const timing = reclaimTiming(reclaim.length, motion)
    const innerStyle = motion && timing.scroll > 0
      ? { animationDuration: `${timing.scroll}ms` } as CSSProperties
      : undefined
    return (
      <div className="dtt__reasoning-live-stack" data-closing="true" aria-live="off">
        <LiveSlot anim="collapse" kind="reclaim" delayMs={timing.scroll} motion={motion}>
          <div
            className="dtt__reasoning-live-rail"
            data-closing="true"
            data-compact={compact || undefined}
          >
            <span className="dtt__reasoning-live-rail-bar" aria-hidden />
            <div className="dtt__reasoning-live-rail-view" data-reclaim="true">
              <div
                className="dtt__reasoning-live-rail-inner"
                data-reclaim="true"
                style={innerStyle}
              >
                {reclaim.map(entry => <RailSeg key={entry.key} entry={entry} />)}
              </div>
            </div>
          </div>
        </LiveSlot>
      </div>
    )
  }
  if (closing) return null
  if (entries.length === 0) return null
  return (
    <div className="dtt__reasoning-live-stack" data-compact={compact || undefined}>
      <div
        className="dtt__reasoning-live-rail"
        data-running={anyRunning ? 'true' : 'false'}
        data-compact={compact || undefined}
        data-following={following && followActive ? true : undefined}
        data-overflow={overflow || undefined}
      >
        <span className="dtt__reasoning-live-rail-bar" aria-hidden />
        <div
          className="dtt__reasoning-live-rail-view"
          data-edges={edges}
          ref={ref}
          onScroll={onScroll}
          onWheel={onWheel}
          role="region"
          aria-label={anyRunning ? '正在思考，可滚动阅读' : '已完成的思考，可滚动阅读'}
          tabIndex={overflow ? 0 : undefined}
          aria-live={anyRunning ? 'polite' : 'off'}
        >
          <div className="dtt__reasoning-live-rail-inner">
            {entries.map(entry => <RailSeg key={entry.key} entry={entry} />)}
          </div>
        </div>
      </div>
    </div>
  )
})
