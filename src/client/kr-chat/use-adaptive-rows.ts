/**
 * dsh-chat-plus — 右栏「挤压自适应」hook：空间不够时自动缩小思考卡行数。
 *
 * 背景：记忆卡是滚动区之下的独立 flex footer（.kr-panel__memory-dock，永远
 * 钉在右栏最下方），滚动区 .kr-panel__scroll（flex: 1 1 0; min-height: 0）
 * 自动让出剩余高度。footer 占得越多、滚动区越矮，「任务 + 思考 + 工具」三张
 * 卡叠起来越容易溢出，唯一可让的尺寸就是思考卡的视口行数
 * （`--kr-reasoning-rows`，见 KrReasoningCard 与 styles.ts：行高 19.2px，
 * max-height = 行数 × 19.2px）。本 hook 就负责按溢出程度选一档。
 * 记忆卡高度变化经 onContentChange → memoryTick 进入 signature，会触发重测。
 *
 * 判定口径：容器 `scrollHeight > clientHeight + 1` 即视为挤压（1px 容差吸收
 * 亚像素缩放与滚动条出现带来的误差，否则会在临界点上反复跳档）。
 *
 * 防 ResizeObserver 死循环的三道闸：
 *  1. **探针法，不用逐档二分搜索**：直接把候选行数写进 `.kr-reasoning-view`
 *     的 inline `--kr-reasoning-rows`，量一次容器 scrollHeight 再还原。整个
 *     决策在**一次同步测量**里完成，不依赖「改 state → 重新测量」的反复逼近，
 *     因此不存在「缩小→不溢出了→回升一档→又溢出」的经典来回抖。
 *  2. **只在档位真正变化时 setState**：`bestTier()` 对同一份 DOM 是纯函数，
 *     档位不变就什么都不做——RO 回调 → setState → 高度变化 → 再触发 RO 的
 *     正反馈链条在这里被截断。
 *  3. **双 rAF + 状态在 effect 依赖里**：测量统一推迟到下一帧布局稳定之后；
 *     档位变化会再跑一次测量（收敛到同一个值即停），不会连续刷帧。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { REASONING_MAX_ROWS } from './KrReasoningCard.tsx'

/** 滚动容器 ref 的结构面（不绑 React 具体 RefObject 版本，改类型不牵连）。 */
interface ScrollContainerRef {
  readonly current: HTMLElement | null
}

/**
 * 行数档位表：索引越大行数越少。首档 = 思考卡默认行数（不挤压时保持原样）。
 *
 * 首档跟着 REASONING_MAX_ROWS 走（现 12），下面几档从它往下收；尾档留 4 行，
 * 极端挤压（右栏被记忆卡占满）时也要留住"正在想"的痕迹，而不是缩成一条缝。
 */
export const REASONING_ROW_LADDER: readonly number[] = [REASONING_MAX_ROWS, 10, 8, 6, 4]

/** 判定挤压的容差（px）。 */
const OVERFLOW_EPS_PX = 1

/** 思考卡视口的选择器（同一仓库内的私有契约，用于探针测量）。 */
const REASONING_VIEW_SELECTOR = '.kr-reasoning-view'

/**
 * 把思考卡临时设为 rows 行，测一次滚动容器是否溢出，随后还原原值。
 *
 * 走 inline style 而不是 React state：探针期间不能触发任何重渲染，否则量到的
 * 是中间态、且会把一次决策拆成多次渲染。
 */
function overflowsAtRows(container: HTMLElement, view: HTMLElement, rows: number): boolean {
  const previous = view.style.getPropertyValue('--kr-reasoning-rows')
  view.style.setProperty('--kr-reasoning-rows', String(rows))
  const overflow = container.scrollHeight > container.clientHeight + OVERFLOW_EPS_PX
  if (previous === '') view.style.removeProperty('--kr-reasoning-rows')
  else view.style.setProperty('--kr-reasoning-rows', previous)
  return overflow
}

/**
 * 选出「装得下的最大行数」档位。
 *
 * 容器高度对行数单调不增，所以「不溢出」这个谓词在小索引（行多）为假、
 * 大索引（行少）为真：从默认档往后扫，**第一个不溢出的档就是答案**
 * （行最多的那一档）。全部溢出（右栏被记忆卡占满）时退到最小档。找不到思考卡
 * 视口（没有思考内容、卡片返回 null）时返回默认档，等于什么都不做。
 */
function bestTier(container: HTMLElement): number {
  const view = container.querySelector<HTMLElement>(REASONING_VIEW_SELECTOR)
  if (view === null) return 0
  if (!overflowsAtRows(container, view, REASONING_ROW_LADDER[0])) return 0
  for (let tier = 1; tier < REASONING_ROW_LADDER.length; tier += 1) {
    if (!overflowsAtRows(container, view, REASONING_ROW_LADDER[tier])) return tier
  }
  return REASONING_ROW_LADDER.length - 1
}

/**
 * 挤压自适应：返回当前应使用的思考卡行数。
 *
 * @param containerRef - `.kr-panel__scroll` 滚动容器的 ref（由 KrAgentPanel 持有）。
 * @param signature - 内容指纹。任一影响右栏高度的输入变化都要体现在这里
 *                    （记忆卡条目数、思考文本长度、工具条数…），变化即重测。
 */
export function useAdaptiveReasoningRows(
  containerRef: ScrollContainerRef,
  signature: string,
): number {
  const [tier, setTier] = useState(0)
  const tierRef = useRef(0)

  /** 档位没变就绝不 setState——这是切断 RO 正反馈的唯一开关。 */
  const applyTier = useCallback((next: number) => {
    if (tierRef.current === next) return
    tierRef.current = next
    setTier(next)
  }, [])

  /** 同步测量 + 定档。rAF 里执行，读写布局不会散落在渲染期。 */
  const reconcile = useCallback(() => {
    const container = containerRef.current
    if (container === null || container === undefined) return
    try {
      applyTier(bestTier(container))
    } catch (error) {
      // 测量失败（极端布局）不致命：保持当前档位，绝不让大盘白屏。
      console.warn('[kr-adaptive-rows] measure failed', error)
    }
  }, [applyTier, containerRef])

  // 内容变化 / 档位变化 → 下一帧再测（双 rAF：等这一帧的布局与字体稳定）。
  // 把 tier 放进依赖是必要的：定档后右栏高度真的变了，必须再测一次确认收敛。
  useEffect(() => {
    const container = containerRef.current
    if (container === null || container === undefined) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(reconcile)
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [signature, tier, reconcile, containerRef])

  // 容器尺寸变化（窗口缩放、大盘宽度动画、滚动条出现/消失）→ 重新定档。
  // 容器是 flex:1 1 0，高度不随内容变，所以 RO 只可能被外部因素触发；
  // 叠加 reconcile 的「档位不变不 setState」，不会自激。
  useEffect(() => {
    const container = containerRef.current
    if (container === null || container === undefined) return
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(reconcile)
    })
    observer.observe(container)
    return () => { observer.disconnect() }
  }, [reconcile, containerRef])

  const rows = REASONING_ROW_LADDER[tier] ?? REASONING_MAX_ROWS
  return rows
}
