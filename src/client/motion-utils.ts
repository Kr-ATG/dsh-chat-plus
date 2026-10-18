/**
 * dsh-chat-plus — client/motion-utils.ts
 *
 * 动效常量与小 hook，移植自 github:aa2246740/dsh-better-display（MIT）：
 * - `REASON_HOLD / REASON_STEP / REASON_LINES`：思考跟随的「840ms 停顿、
 *   500ms 走两行」节拍（见其 DESIGN.md「Long reasoning」与
 *   reasoning-follow.ts）。
 * - `MOTION_EASING`：两家统一的缓动曲线 cubic-bezier(.22,1,.36,1)。
 * - `useMotionAllowed`：总开关 + 系统「减少动态效果」的与结果。
 * - `useSteppedFollow`：文本增长时分步跟随到底（两行一步），用户上翻即停、
 *   滚回底部自动恢复；减少动态效果时直接跳到底。
 * - `useHeightAnimation`：展开/收起的高度补间（WAAPI），元素常驻 DOM，
 *   收起态加 inert（焦点不掉进去）。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Upstream reasoning-follow 节拍：停顿 840ms，走两行，单步 500ms。 */
export const REASON_HOLD = 840
export const REASON_STEP = 500
export const REASON_LINES = 2

/** 两家统一的缓动曲线（Transitions.dev 系）。 */
export const MOTION_EASING = 'cubic-bezier(.22,1,.36,1)'

/** 260ms 展开/收起（上游 ProcessFragment 同值）。 */
export const EXPAND_MS = 260

/**
 * 文本交叉淡入淡出（crossfade）节拍。
 *
 * 进场比出场快 20ms：新字先稳，旧字才彻底走，读起来是「换过去了」而不是
 * 「闪了一下」。`OVERLAP` 是两层的交叠段——出场层在淡出的同时，进场层已经
 * 开始淡入，中间任何一帧都不出现空白，这就是「平滑」的来源。
 */
export const TEXT_FADE_IN_MS = 180
export const TEXT_FADE_OVERLAP_MS = 70
/** 出场层在整段动画走完后卸载；期间它在交叠区就已不可见，卸载不产生跳变。 */
export const TEXT_FADE_EXIT_MS = TEXT_FADE_OVERLAP_MS + TEXT_FADE_IN_MS
/** 极快连续切换时的层数上限：超出就把最老的出场层直接丢掉，不留残影。 */
const TEXT_FADE_MAX_LAYERS = 3

/** 插件总开关与系统偏好都允许时才做动效。 */
export function useMotionAllowed(enabled: boolean): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      const change = (): void => { setReduced(query.matches) }
      query.addEventListener('change', change)
      return () => query.removeEventListener('change', change)
    } catch {
      return undefined
    }
  }, [])
  return enabled && !reduced
}

/** 交叉淡入淡出中的一层。`exiting` 为真表示正在退场、到点后被卸载。 */
export interface TextLayer {
  readonly id: number
  readonly text: string
  readonly exiting: boolean
}

/**
 * 文本替换的交叉淡入淡出：旧层淡出与新层淡入**重叠**进行。
 *
 * 之前是靠 `key={text}` 重建节点 + 一次性入场动画实现的，那条路做不到平滑：
 * 旧节点先被卸载（瞬间消失），新节点再淡入，中间必然有一帧空白，读起来是
 * 「闪了一下」。这里改成保留旧层、让它淡出，新层同时淡入，两层叠在同一格里，
 * 任何一帧都有字。
 *
 * 退场层在 `TEXT_FADE_EXIT_MS` 后卸载，且它在那之前已不可见，卸载不产生跳变。
 * 卸载用定时器而不是 `onAnimationEnd`：系统开了「减少动态效果」时动画根本不会
 * 触发，挂在 `onAnimationEnd` 上清理就永远不会执行，层会一直堆着。
 *
 * `motion` 为假（系统偏好）时退化成单层直接替换，不产生任何层。
 */
export function useCrossfadeText(text: string, motion: boolean): readonly TextLayer[] {
  const [layers, setLayers] = useState<readonly TextLayer[]>(() => [{ id: 0, text, exiting: false }])
  const seqRef = useRef(0)

  useEffect(() => {
    const id = (seqRef.current += 1)
    setLayers((prev) => {
      const top = prev[prev.length - 1]
      // 挂载后的首次 effect、或最新一层就是这段文字：没有任何变化要做。
      if (top !== undefined && !top.exiting && top.text === text) return prev
      if (!motion) return [{ id, text, exiting: false }]
      const next: TextLayer[] = [...prev.map((layer) => ({ ...layer, exiting: true })), { id, text, exiting: false }]
      return next.length > TEXT_FADE_MAX_LAYERS ? next.slice(next.length - TEXT_FADE_MAX_LAYERS) : next
    })
  }, [text, motion])

  useEffect(() => {
    if (!layers.some((layer) => layer.exiting)) return undefined
    const timer = window.setTimeout(() => {
      setLayers((prev) => {
        const kept = prev.filter((layer) => !layer.exiting)
        return kept.length === prev.length ? prev : kept
      })
    }, TEXT_FADE_EXIT_MS)
    return () => { window.clearTimeout(timer) }
  }, [layers])

  return layers
}

/**
 * 实时跟随到底：`text` 增长且跟随意图仍在、读者停在底部（≤24px）时，
 * 实时自动跟随滚动到底部；上翻/选中即停，滚回底部自动恢复；
 * 同时报告视口溢出与边缘位置（供渐隐遮罩）。
 */
export function useSteppedFollow(text: string, running: boolean, _motion: boolean): {
  readonly ref: React.MutableRefObject<HTMLDivElement | null>
  readonly onScroll: (event: React.UIEvent<HTMLDivElement>) => void
  readonly onWheel: () => void
  readonly edges: FollowEdges
  readonly overflow: boolean
  readonly following: boolean
  readonly setFollowing: (value: boolean) => void
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  const followingRef = useRef(true)
  const selectingRef = useRef(false)
  /**
   * 「减少动态效果」的实时快照。
   *
   * 不进 useState：这个值只影响 scrollToBottom 的一个分支，而它每帧都可能被调用
   * ——走 state 会让每次跟随都排一次 React 渲染。ref + matchMedia 监听即可。
   */
  const reducedMotionRef = useRef(false)
  useEffect(() => {
    try {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      reducedMotionRef.current = query.matches
      const change = (): void => { reducedMotionRef.current = query.matches }
      query.addEventListener('change', change)
      return () => query.removeEventListener('change', change)
    } catch {
      return undefined
    }
  }, [])
  const [edges, setEdges] = useState<FollowEdges>('none')
  const [overflow, setOverflow] = useState(false)
  const [following, setFollowingState] = useState(true)

  /*
   * 边缘判定的滞回阈值（px）。
   *
   * 原来用 1px，等于「差一个像素就算到边」：只要 scrollTop 在阈值附近抖一下，
   * edges 就在 none / top / bottom 之间翻，渐隐遮罩随之出现-消失-出现，读起来
   * 就是「卡片在一闪一闪」。
   *
   * 触发链并不罕见 —— 展开/收起 footer 里的工具调用卡会改变 footer 高度 →
   * 上方滚动区变矮 → 思考卡重排行 → 视口内列表的 ResizeObserver 反复回调 →
   * 每次都重测。4px 的吸附区让 ±2px 的重排噪声不再翻转状态，而真的滚到边
   * （超过 4px）时判定照常。
   */
  const EDGE_EPS_PX = 4

  const measure = (): void => {
    const el = ref.current
    if (el === null) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    setOverflow(el.scrollHeight > el.clientHeight + EDGE_EPS_PX)
    const top = el.scrollTop > EDGE_EPS_PX
    const bottom = max - el.scrollTop > EDGE_EPS_PX
    setEdges(top ? (bottom ? 'both' : 'top') : (bottom ? 'bottom' : 'none'))
  }

  /*
   * 平滑跟随：把「瞬移到底」换成「逐帧追上去」。
   *
   * 列表在流式期每落一步就往底部瞬移一次 scrollTop。视觉上是整列文字「咔」地
   * 跳一行——因为瞬移不产生任何中间帧，人眼读到的就是一次硬跳。一屏九行的窗口
   * 里，这一跳会连带把上面所有行一起推上去，读起来像画面在打嗝。
   *
   * 改成每帧走剩余距离的 28%（最小 1px），内容连续涌入时读作「内容在往下淌」，
   * 停下来时最后几像素也自然收口，不会有「差半行没贴底」的悬空感。每帧只写
   * scrollTop 一次，且**不在追逐过程中 measure**——measure 会 setState，每帧
   * 一次就是每帧一次 React 调度，那才是真卡顿。收口时补一次。
   *
   * 追上之后必须精确落到 scrollHeight：28% 的步进永远差最后一两像素，不补齐
   * 的话「是否贴底」的判定会一直悬在边界上。
   */
  const followRaf = useRef(0)
  const cancelFollow = (): void => {
    if (followRaf.current !== 0) {
      cancelAnimationFrame(followRaf.current)
      followRaf.current = 0
    }
  }
  const stepFollow = (): void => {
    const el = ref.current
    if (el === null) {
      followRaf.current = 0
      return
    }
    const target = Math.max(0, el.scrollHeight - el.clientHeight)
    const delta = target - el.scrollTop
    if (!(delta > 0.5)) {
      el.scrollTop = target
      followRaf.current = 0
      measure()
      return
    }
    el.scrollTop = el.scrollTop + Math.max(1, delta * 0.28)
    followRaf.current = requestAnimationFrame(stepFollow)
  }

  const scrollToBottom = (smooth = true): void => {
    const el = ref.current
    if (el === null) return
    // 系统开了「减少动态效果」时不做追逐：滚动本身就是一种动效，逐帧追底对
    // 前庭敏感用户是明确的负担，直接瞬移。
    if (!smooth || reducedMotionRef.current) {
      cancelFollow()
      el.scrollTop = el.scrollHeight
      measure()
      return
    }
    // 已经在追了就不再排一帧：循环自己会重算目标，重复排帧只会越排越多。
    if (followRaf.current === 0) {
      followRaf.current = requestAnimationFrame(stepFollow)
    }
  }

  const setFollowing = (value: boolean): void => {
    followingRef.current = value
    pinnedRef.current = value
    setFollowingState(value)
    if (value) {
      scrollToBottom()
    } else {
      cancelFollow()
    }
  }

  const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    /*
     * 平滑跟随期间不要自己掐断自己。
     *
     * 逐帧追底时 scrollTop 每帧都在变，scroll 事件随之连发；一旦某一帧的距离
     * 因为内容刚撑高而超过 24px，这里就会把 following 判成 false，刚启动的追逐
     * 立刻被 cancel —— 表现是「跟随追一下、停一下」，比瞬移还难受。
     * 追逐进行中直接放行，收口那一帧再正常判定。
     */
    if (followRaf.current !== 0) {
      pinnedRef.current = true
      return
    }
    const pinned = distance <= 24
    pinnedRef.current = pinned
    if (followingRef.current !== pinned) {
      followingRef.current = pinned
      setFollowingState(pinned)
    }
    measure()
  }

  const onWheel = (): void => {
    /*
     * 用户一动手就**立刻**停下追逐。
     *
     * 滚轮事件早于 scroll 事件到达，如果等 onScroll 的几何判定，追逐可能已经在
     * 用户滚动的同时又往前推了几帧 —— 手指在往上滚、列表还在往下追，抵消感非常
     * 明显。这里直接取消，几何判定交给随后到达的 onScroll 恢复。
     */
    cancelFollow()
  }

  // 选中即停（选区释放前不跟随，避免跟随拽走选区）
  useEffect(() => {
    const onSelection = (): void => {
      const el = ref.current
      if (el === null) return
      try {
        const selection = document.getSelection()
        const active = selection !== null && !selection.isCollapsed && selection.anchorNode !== null && el.contains(selection.anchorNode)
        selectingRef.current = active
      } catch { /* 选择区不可读时忽略 */ }
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])

  // 文本流式增长或状态激活时实时自动滚到底
  useLayoutEffect(() => {
    measure()
    if (!running || !pinnedRef.current || selectingRef.current) return
    scrollToBottom()
  }, [text, running])

  // 卸载时掐掉未完成的追逐帧，否则回调会打到已脱离文档的节点上。
  useEffect(() => cancelFollow, [])

  // 内容高度变化监测（DOM 节点追加、换行撑高、段落新增等）
  useEffect(() => {
    const el = ref.current
    if (el === null || typeof ResizeObserver === 'undefined') return undefined
    let rafId = 0
    const ro = new ResizeObserver(() => {
      if (rafId !== 0) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        measure()
        if (!running || !pinnedRef.current || selectingRef.current) return
        scrollToBottom()
      })
    })
    if (el.firstElementChild) {
      ro.observe(el.firstElementChild)
    }
    ro.observe(el)
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [running])

  return { ref, onScroll, onWheel, edges, overflow, following, setFollowing }
}

/**
 * 高度展开/收起补间：`open` 翻转时在 `scrollHeight ↔ 0` 之间做
 * `EXPAND_MS` 动画；/`motion` 关闭或首帧直接落位。收起动画播完才卸载
 * （返回的 `present` 为 false 时调用方不渲染），收起态叠加 inert +
 * aria-hidden（由调用方写）。
 */
export function useHeightAnimation(open: boolean, motion: boolean): {
  readonly ref: React.MutableRefObject<HTMLDivElement | null>
  readonly present: boolean
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const running = useRef<Animation | null>(null)
  const previous = useRef(open)
  const [present, setPresent] = useState(open)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) {
      // 尚未挂载：只有要求打开时才挂载（下一轮 effect 再做补间）。
      if (open) setPresent(true)
      return
    }
    const from = running.current !== null ? el.getBoundingClientRect().height : previous.current ? el.scrollHeight : 0
    running.current?.cancel()
    running.current = null
    const changed = previous.current !== open
    previous.current = open
    if (open) setPresent(true)
    el.style.height = open ? 'auto' : '0px'
    el.style.overflow = open ? '' : 'hidden'
    const target = open ? el.scrollHeight : 0
    if (!motion || !changed || Math.abs(from - target) < 1) {
      setPresent(open)
      return
    }
    try {
      const animation = el.animate(
        [{ height: `${from}px` }, { height: `${target}px` }],
        { duration: EXPAND_MS, easing: MOTION_EASING, fill: 'both' },
      )
      running.current = animation
      animation.onfinish = () => {
        if (running.current !== animation) return
        running.current = null
        animation.cancel()
        setPresent(open)
      }
    } catch {
      /* WAAPI 不可用（如测试桩 DOM）：直接落位即可 */
      setPresent(open)
    }
  }, [open, motion, present])
  useEffect(() => () => { running.current?.cancel() }, [])
  return { ref, present }
}
