/**
 * dsh-chat-plus — 右栏「挤压自适应」hook：滚动区放不下时让列表卡缩一档。
 *
 * 历史：思考过程卡曾在右栏大盘里，本 hook 用 ResizeObserver 监视
 * `.kr-panel__scroll`，按溢出程度调低思考卡的视口行数
 * （`--kr-reasoning-rows`）。思考卡已于 2026-09-28 移到 KR 对话流内联展示，
 * 右栏不再有可缩放的思考视口，档位阶梯随之失去对象——**保留的只剩「挤了没有」
 * 这一个布尔量**，由它驱动操作面板与记忆卡各自的「缩一档」形态。
 *
 * 判据：容器 `scrollHeight > clientHeight + 1` 即视为挤压（1px 容差吸收亚像素
 * 缩放与滚动条出现带来的误差，否则会在临界点上反复跳档）。
 *
 * 防 ResizeObserver 死循环的两道闸：
 *  1. **只在结果真的翻转时 setState**：RO 回调 → setState → 高度变化 → 再触发
 *     RO 的正反馈链条在这里被截断（档位不变就什么都不做）。
 *  2. **双 rAF + 状态在 effect 依赖里**：测量统一推迟到下一帧布局稳定之后；
 *     结果变化会再跑一次测量（收敛到同一个值即停），不会连续刷帧。
 *
 * @param containerRef - `.kr-panel__scroll` 滚动容器的 ref（由 KrAgentPanel 持有）。
 * @param signature - 内容指纹。任一影响右栏高度的输入变化都要体现在这里
 *                    （记忆卡条目数、思考文本长度、工具条数…），变化即重测。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 滚动容器 ref 的结构面（不绑 React 具体 RefObject 版本，改类型不牵连）。 */
interface ScrollContainerRef {
  readonly current: HTMLElement | null
}

/** 判定挤压的容差（px）。 */
const OVERFLOW_EPS_PX = 1

/**
 * 抖动抑制窗口（ms）。
 *
 * 记忆卡条目增减会让滚动区高度剧变；若新高度恰好落在临界点上，布尔量就会在
 * true/false 之间来回翻，操作面板与记忆卡的列表高度跟着反复增减——观感就是
 * 「上面的卡片一闪一闪」。短时间内第二次改变直接忽略（内容还在变，窗口结束后
 * 自然会重测收敛）。单次变化不受影响。
 */
const STATE_QUIET_MS = 260

/**
 * 右栏是否已被挤压。
 *
 * @param containerRef - `.kr-panel__scroll` 滚动容器的 ref（由 KrAgentPanel 持有）。
 * @param signature - 内容指纹。任一影响右栏高度的输入变化都要体现在这里
 *                    （记忆卡条目数、思考文本长度、工具条数…），变化即重测。
 */
export function usePanelSqueezed(
  containerRef: ScrollContainerRef,
  signature: string,
): boolean {
  const [squeezed, setSqueezed] = useState(false)
  const squeezedRef = useRef(false)
  /** 上一次翻转的时刻；用于抖动抑制。 */
  const lastChangeAtRef = useRef(0)

  /** 结果没变就绝不 setState——这是切断 RO 正反馈的唯一开关。 */
  const apply = useCallback((next: boolean) => {
    if (squeezedRef.current === next) return
    const now = Date.now()
    // 抖动保护：上一次翻转刚发生过，这次多半是高度重排的余波，不是真实需求变化。
    if (now - lastChangeAtRef.current < STATE_QUIET_MS) return
    lastChangeAtRef.current = now
    squeezedRef.current = next
    setSqueezed(next)
  }, [])

  /** 同步测量。rAF 里执行，读写布局不会散落在渲染期。 */
  const reconcile = useCallback(() => {
    const container = containerRef.current
    if (container === null || container === undefined) return
    try {
      apply(container.scrollHeight > container.clientHeight + OVERFLOW_EPS_PX)
    } catch (error) {
      // 测量失败（极端布局）不致命：保持当前状态，绝不让大盘白屏。
      console.warn('[kr-adaptive-rows] measure failed', error)
    }
  }, [apply, containerRef])

  // 内容变化 / 状态变化 → 下一帧再测（双 rAF：等这一帧的布局与字体稳定）。
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
  }, [signature, squeezed, reconcile, containerRef])

  // 容器尺寸变化（窗口缩放、大盘宽度动画、滚动条出现/消失）→ 重新测量。
  // 容器是 flex:1 1 0，高度不随内容变，所以 RO 只可能被外部因素触发；
  // 叠加 reconcile 的「结果不变不 setState」，不会自激。
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

  return squeezed
}
