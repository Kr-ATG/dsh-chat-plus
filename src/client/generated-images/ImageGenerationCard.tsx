/**
 * dsh-chat-plus — 生图实时卡（client 组件）。
 *
 * 解决的问题（2026-10-30 用户点名）：
 *  1. `generate_image` 跑起来时对话流里只有「深度求索中…」一行，看不到「图正在画」；
 *     这里补上一块点阵动画占位。
 *  2. 图片原本要等回合收口、由总结卡里的画廊条（GeneratedImageStrip）显示；模型
 *     生图后往往还要落盘 / 校验 / 写总结，用户要再等十几秒才见到图。本卡直接吃
 *     工具结果：`generate_image` 一返回就换成真实图片，回合还没收口也能看。
 *
 * 2026-10-30 第二轮用户要求：
 *  · 点阵按**要生成图片的比例**排（size / aspect_ratio 解析成宽高比），
 *    不再是一整块铺满宽度的大方阵；
 *  · **要生成几张就画几个点阵**（n 参数），不是所有情况都并成一大块；
 *  · 点阵要有明显的呼吸动效；颜色去掉橙色，改用跟随主题的中性色。
 *
 * 放在 Seeker 对话流的 turn-process 座位里（见 TurnProcessShadowView）：那里是
 * 每轮唯一的常驻锚点，第一条 assistant 文本出现前就已经挂好，因此不会漏掉
 * 「模型直接调工具、没有中间正文」的生图回合。
 *
 * 与 GeneratedImageStrip 的分工：本卡只负责「此刻这一轮的生图」与占位动画；
 * 多图排版、点击放大、另存为全部复用画廊条，不复制第二套交互。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { injectGalleryStyles } from '../styles'
import { noteConversationScrollIntent } from '../kr-chat/scroll-guard.ts'
import { useNow } from '../tool-summary/use-now.ts'
import { GeneratedImageStrip } from './GeneratedImageStrip.tsx'
import { dotGridForRatio } from './layout.ts'
import type { GeneratedImageCall } from './use-generated-images.ts'

const NS = 'dgi-stage'

const L = {
  generating: '正在生成图片',
  reading: '正在读取图片',
  done: '生成图片',
  failed: '图片生成失败',
}

interface DotSpec {
  readonly key: number
  readonly delay: string
}

/** 同一组行列共用一个点阵（多张同比例图片不重复造元素描述）。 */
const dotCache = new Map<string, readonly DotSpec[]>()

/**
 * 点阵布局：以格子中心为圆心算径向距离，越靠外的点延迟越大，形成一圈圈
 * 向外扩散的波。负延迟让首帧就处在波形的不同相位，不会先齐刷刷闪一下。
 */
function dotsFor(cols: number, rows: number): readonly DotSpec[] {
  const key = `${cols}x${rows}`
  const hit = dotCache.get(key)
  if (hit !== undefined) return hit
  const dots: DotSpec[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const dx = (col - (cols - 1) / 2) / ((cols - 1) / 2)
      const dy = (row - (rows - 1) / 2) / ((rows - 1) / 2)
      const distance = Math.sqrt(dx * dx + dy * dy)
      dots.push({
        key: row * cols + col,
        delay: `${Math.round(distance * 620 - 1100)}ms`,
      })
    }
  }
  dotCache.set(key, dots)
  return dots
}

/**
 * 让卡片跟着对话滚动贴底。
 *
 * 为什么需要：对话流底部是输入框的浮层，turn-process 座位不在官方「消息节点」
 * 的跟随算法里 —— 卡片出现时内容高度已经变了，但官方不会为它补一次贴底，
 * 结果新卡片的点阵 / 图片大半藏在输入框后面，用户以为「怎么没反应」。
 *
 * 只跟「本来就在底部」的情况：阈值按卡片自身高度算（卡片出现造成的
 * scrollHeight 增量），用户上翻超过一屏就不再拽他回来；滚动事件每次都重新
 * 判定，官方自己的滚动守卫逻辑不受影响。
 */
function usePinToConversationBottom(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return undefined
    const element = ref.current
    if (element === null) return undefined
    const scroller = element.closest('[data-conversation-scroll]') as HTMLElement | null
    if (scroller === null) return undefined
    const threshold = Math.max(360, element.offsetHeight + 80)
    let pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= threshold
    const onScroll = (): void => {
      pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= threshold
    }
    const follow = (): void => {
      if (!pinned) return
      const target = scroller.scrollHeight - scroller.clientHeight
      if (Math.abs(scroller.scrollTop - target) < 2) return
      // 滚动守卫把「无意图的大跳落底」认成官方拽人并回滚；这里的贴底是插件
      // 主动为用户补的，不是官方偷偷拽人，所以先登记一次意图让它放行。
      noteConversationScrollIntent()
      scroller.scrollTop = target
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => { follow() })
      observer.observe(element)
      observer.observe(scroller)
    }
    const raf = requestAnimationFrame(follow)
    return () => {
      cancelAnimationFrame(raf)
      scroller.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [active, ref])
}

const DotMatrix = memo(function DotMatrix({ cols, rows }: { readonly cols: number; readonly rows: number }): JSX.Element {
  return (
    <div
      className={`${NS}__dots`}
      style={{ '--dgi-dot-cols': cols, '--dgi-dot-rows': rows } as CSSProperties}
      aria-hidden="true"
    >
      {dotsFor(cols, rows).map((dot) => (
        <i key={dot.key} style={{ '--dgi-dot-delay': dot.delay } as CSSProperties} />
      ))}
    </div>
  )
})

/** 一次调用的占位：n 张就画 n 个格子，每个格子按该次图片比例。 */
const DotPlaceholder = memo(function DotPlaceholder({ call }: { readonly call: GeneratedImageCall }): JSX.Element {
  const grid = dotGridForRatio(call.ratio)
  const cells = Array.from({ length: call.count }, (_, index) => index)
  return (
    <div className={`${NS}__grid`} data-multi={call.count > 1 || undefined} data-count={call.count}>
      {cells.map((index) => (
        <div
          key={index}
          className={`${NS}__cell`}
          style={{ '--dgi-ratio': call.ratio } as CSSProperties}
        >
          <DotMatrix cols={grid.cols} rows={grid.rows} />
        </div>
      ))}
    </div>
  )
})

/**
 * 单个生图调用：点阵 → 图片之间做羽化（dissolve）过渡。
 *
 * 为什么不是直接切换：点阵是灰色小点、图片是彩色画面，硬切会「啪」一下换脸。
 * 这里在图片出现的 560ms 内把点阵留在下面做一层「鬼影」，图片层从 blur(10px) /
 * opacity 0 羽化显影，点阵层同时淡出 —— 视觉上是图从点阵里长出来。
 *
 * 只在「本次从无图变有图」的那一拍播；图片再增加（1→2 张）不重复播，避免闪烁。
 */
const GenerationGroup = memo(function GenerationGroup({ group }: { readonly group: GeneratedImageCall }): JSX.Element {
  const hasImages = group.urls.length > 0
  const previousHasImages = useRef(hasImages)
  const [ghost, setGhost] = useState(false)
  const grid = dotGridForRatio(group.ratio)

  useLayoutEffect(() => {
    const justArrived = hasImages && !previousHasImages.current
    previousHasImages.current = hasImages
    if (!justArrived) {
      if (!hasImages) setGhost(false)
      return undefined
    }
    setGhost(true)
    const timer = window.setTimeout(() => setGhost(false), 560)
    return () => { window.clearTimeout(timer) }
  }, [hasImages])

  return (
    <div className={`${NS}__group`}>
      {!hasImages && (group.running || group.loading) && (
        <DotPlaceholder call={group} />
      )}
      {hasImages && (
        <div className={`${NS}__reveal`}>
          <GeneratedImageStrip images={group.urls} model={group.model} />
        </div>
      )}
      {hasImages && ghost && (
        <div className={`${NS}__ghost`} aria-hidden="true">
          <div className={`${NS}__cell`} style={{ '--dgi-ratio': group.ratio } as CSSProperties}>
            <DotMatrix cols={grid.cols} rows={grid.rows} />
          </div>
        </div>
      )}
      {group.error !== null && group.urls.length === 0 && !group.running && !group.loading && (
        <p className={`${NS}__error`}>{group.error}</p>
      )}
    </div>
  )
})

export interface ImageGenerationCardProps {
  /**
   * 按调用分组的实时状态（useGeneratedImages().calls）。
   *
   * 传了它就用它渲染「每张图一个点阵」；没传时用下面的一组聚合 props 兜底
   * （单块 1:1 占位），保持组件在别处单独使用时不会崩。
   */
  readonly calls?: readonly GeneratedImageCall[] | undefined
  /** 已经拿到的图片（data URL 或 http(s) URL），空数组 = 还没出图。 */
  readonly images: readonly string[]
  readonly model?: string | null | undefined
  /** 有 generate_image 正在执行。 */
  readonly running: boolean
  /** 结果已返回、正在从 spill 读图（马上有图）。 */
  readonly loading?: boolean | undefined
  /** 生成失败且没有可显示图片时的错误文案。 */
  readonly error?: string | null | undefined
  /** 本次生图的提示词；用作卡片的副标题（两行截断）。 */
  readonly prompt?: string | null | undefined
  /** 调用发起时间（ms），用于右上角的实时秒数。 */
  readonly startedAt?: number | null | undefined
}

/**
 * 生图实时卡：生成中 = 按比例的点阵动画，出图 = 立刻换成图片。
 * 没有进行中的调用、没有图片、也没有错误时返回 null（不占对话流位置）。
 */
export const ImageGenerationCard = memo(function ImageGenerationCard({
  calls,
  images,
  model = null,
  running,
  loading = false,
  error = null,
  prompt = null,
  startedAt = null,
}: ImageGenerationCardProps): JSX.Element | null {
  // 幂等注入样式（与画廊条共用同一张 <style>，SSR 环境静默跳过）
  useEffect(() => { injectGalleryStyles() }, [])
  const sectionRef = useRef<HTMLElement | null>(null)

  const groups: readonly GeneratedImageCall[] = calls !== undefined && calls.length > 0
    ? calls
    : [{
      callId: 'fallback',
      running,
      loading,
      error,
      prompt,
      startedAt,
      model,
      urls: images,
      count: 1,
      ratio: 1,
    }]

  const busy = groups.some(group => group.running || group.loading)
  usePinToConversationBottom(sectionRef, busy || groups.some(group => group.urls.length > 0) || groups.some(group => group.error !== null))

  const now = useNow(busy, 1000)
  // 计时与提示词都跟着「当前正在生成的那一组」走：多调用时旧图已出、新图还在画，
  // 取第一组会把计时/提示词停在旧调用上，看起来像卡住了。
  const activeGroup = groups.find(group => group.running || group.loading) ?? null
  const anchorStartedAt = activeGroup?.startedAt
    ?? groups.find(group => group.startedAt !== null)?.startedAt
    ?? null
  const elapsed = busy && anchorStartedAt !== null
    ? Math.max(0, Math.round((now - anchorStartedAt) / 1000))
    : null
  const totalImages = groups.reduce((sum, group) => sum + group.urls.length, 0)
  const firstError = groups.find(group => group.error !== null)?.error ?? null
  const firstPrompt = activeGroup?.prompt
    ?? groups.find(group => group.prompt !== null)?.prompt
    ?? null

  const title = busy
    ? (groups.some(group => group.loading) ? L.reading : L.generating)
    : totalImages > 0 ? L.done : firstError !== null ? L.failed : L.generating

  if (totalImages === 0 && !busy && firstError === null) return null

  return (
    <section
      ref={sectionRef}
      className={NS}
      data-busy={busy || undefined}
      data-done={totalImages > 0 || undefined}
      aria-label={title}
      aria-live="polite"
    >
      <header className={`${NS}__head`}>
        <span className={`${NS}__badge`} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2.6" width="12" height="10.8" rx="2" />
            <circle cx="5.6" cy="6.1" r="1.1" />
            <path d="m3 12 3.5-3.4 2.4 2.2 1.7-1.5L13 12" />
          </svg>
        </span>
        <span className={`${NS}__title`}>{title}</span>
        {elapsed !== null && (
          <span className={`${NS}__timer`} aria-hidden="true">{elapsed}s</span>
        )}
      </header>

      {/* 提示词只在生成中当副标题；出图后图片本身才是主角，不再占行。 */}
      {busy && firstPrompt !== null && firstPrompt !== '' && (
        <p className={`${NS}__prompt`} title={firstPrompt}>{firstPrompt}</p>
      )}

      <div className={`${NS}__groups`} data-groups={groups.length}>
        {groups.map(group => (
          <GenerationGroup key={group.callId} group={group} />
        ))}
      </div>
    </section>
  )
})
