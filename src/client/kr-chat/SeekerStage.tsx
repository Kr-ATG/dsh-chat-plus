/**
 * dsh-chat-plus — 「任务动画」播放器（卡头立绘位）。
 *
 * 用户 2026-10-26 给了 9 个本地 GIF，替掉原来那张静态立绘（WhalePortrait）。
 * 现在是 9 段带透明通道的 WebM（见 motion-clips.ts 的片段表），按卡头此刻的
 * 状态挑一段播。
 *
 * # 三条播放纪律（都踩过或差点踩）
 *
 * 1. **9 个 <video> 一次性挂满、永不卸载，只切 CSS 类名**。
 *    操作面板每 250ms 重渲染一次；按需挂载/卸载 video 会让浏览器反复中断请求、
 *    每次都要重新解码首帧 —— 表现是「每次闪一下才动起来」。挂满之后切片段只是
 *    pause 一个、play 另一个。
 *
 * 2. **不能只靠 ended 事件推进**。
 *    ended 在本机实测会丢（切片段太快、video 被 pause 时被取消），丢了就永远
 *    卡在那一段。所以每个一次性片段额外挂一个 durationMs + 250ms 的兜底定时器，
 *    ended 与它谁先到算谁（两者都收敛到同一个 resting 片段，重复触发无副作用）。
 *
 * 3. **preload="none" + poster**。
 *    9 段合计 2.57MB，全量预载等于每次打开大盘先把 2.57MB 拉一遍，而绝大多数
 *    时间只在一个片段里循环。preload="none" 让浏览器在 play() 之前一个字节都不
 *    下载；真播起来之前看到的是该片段的首帧海报，所以也不会有一闪的黑块。
 *
 * # 抢占
 *
 * 用户明确要求「允许打断」：任何时刻只有一个片段是激活的，新状态直接顶掉旧的
 * （pause 旧的、play 新的），不等前一段播完。这正是抢占式单通道的语义。
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  MOTION_CLIP_IDS,
  MOTION_CLIPS,
  motionPosterUrl,
  motionVideoUrl,
  type MotionClipId,
} from './motion-clips.ts'
import type { StageMode } from './stage-mode.ts'

/**
 * 一次性片段播完之后的「静止片段」——也就是该状态**不再有瞬时动画**时该停在哪。
 *
 *  · 思考 / 操作中：本来就该停在循环片段上；
 *  · 查看照片：照片看完就回去干活（换回「操作中」的循环，而不是冻在最后一张）；
 *  · 收尾：**停在收尾片段的最后一帧**（end-op 是一次性动作，收尾还在继续）；
 *  · 空闲：回到按钟点选的那一段（观月 / 吃饭 / 小憩）。
 *
 * @param mode - 当前动画态。
 * @param idleClip - 空闲时段对应的片段。
 * @returns 应当静止播放的片段 id。
 */
function restingClipFor(mode: StageMode, idleClip: MotionClipId): MotionClipId {
  switch (mode) {
    case 'thinking':
      return 'thinking'
    case 'acting':
    case 'photo':
      return 'working'
    case 'wrapping':
      /*
       * 收尾片段演完回「操作中」而不是**冻在最后一帧**：收尾判据天生可能误报
       * （模型在两次调用之间思考时同样成立，见 stage-mode.ts 的 WRAP_DWELL_MS）。
       * 误报的后果应该是「她做一个收尾手势又继续干活」，绝不是卡住不动。
       */
      return 'working'
    case 'idle':
    default:
      return idleClip
  }
}

/**
 * 首次挂载时该显示哪一段。
 *
 * **不播 done**：组件挂载时若本轮已经收口，播一段「完成」是错的（那件事可能
 * 几分钟前就结束了）。只有**亲眼看到本轮从跑到收口**才播 done。
 *
 * @param mode - 挂载时的动画态。
 * @param idleClip - 空闲时段对应的片段。
 * @returns 初始片段 id。
 */
function bootClipFor(mode: StageMode, idleClip: MotionClipId): MotionClipId {
  switch (mode) {
    case 'thinking':
      return 'thinking'
    case 'photo':
      return 'photo'
    case 'wrapping':
      return 'end-op'
    case 'acting':
      return 'working'
    case 'idle':
    default:
      return idleClip
  }
}

export interface SeekerStageProps {
  /** 卡头此刻的动画态（含收尾判定，见 stage-mode.ts）。 */
  readonly mode: StageMode
  /** 空闲时段对应的片段（观月中 / 吃饭中 / 小憩中，见 idle-phrase.ts）。 */
  readonly idleClip: MotionClipId
  /**
   * 是否播放。false 时**不播**、只显示当前状态那一段的首帧海报
   * （系统「减少动态效果」时由调用方传 false）。
   */
  readonly motion?: boolean
  /** 额外类名。 */
  readonly className?: string
}

/**
 * 任务动画播放器。
 *
 * @param props - 见 {@link SeekerStageProps}。
 * @returns 舞台节点（内含 9 个 video，只有一个是激活的）。
 */
export function SeekerStage({
  mode,
  idleClip,
  motion = true,
  className,
}: SeekerStageProps): ReactElement {
  const [clip, setClip] = useState<MotionClipId>(() => bootClipFor(mode, idleClip))

  /*
   * 三个 ref 做「最新值」通道：定时器与事件回调（ended / 可见性）里必须读到
   * **此刻**的 mode 与 idleClip，而它们是在 effect 之外、甚至在另一个闭包里跑的。
   * 把最新值塞进 ref 是唯一不会因为闭包捕获旧值而出错的做法。
   */
  const clipRef = useRef(clip)
  clipRef.current = clip
  const modeRef = useRef(mode)
  modeRef.current = mode
  const idleRef = useRef(idleClip)
  idleRef.current = idleClip
  /** 本轮是否「看见过在跑」：只有见过，收口时才播「完成」。 */
  const seenRunningRef = useRef(mode !== 'idle')
  /** 首次渲染时不播任何瞬时片段（见下面的 prev === null 分支）。 */
  const prevModeRef = useRef<StageMode | null>(null)

  /*
   * ① 状态迁移 → 选片段。
   *
   * 只有**真的换了一档**才动片段：面板每 250ms 重渲染，如果按「渲染即重算」，
   * 一个 19.9 秒的循环会被每次都从 0 开始播 —— 她永远只动前 250ms。
   */
  useEffect(() => {
    const prev = prevModeRef.current
    prevModeRef.current = mode
    if (mode !== 'idle') seenRunningRef.current = true
    // 首次渲染：片段已由 bootClipFor 定好，不在这里补播瞬时动画。
    if (prev === null || prev === mode) return
    switch (mode) {
      case 'thinking':
        setClip('thinking')
        break
      case 'acting':
        /*
         * 「开始操作」只在**从思考 / 空闲进入操作**那一刻演（用户口径：
         * 「操作电脑中就是开始操作」= 第一个真动作开始的那一刻）。
         * 之后动作与动作之间的切换一律回「操作中」的循环。
         */
        setClip(prev === 'thinking' || prev === 'idle' ? 'start-op' : 'working')
        break
      case 'photo':
        setClip('photo')
        break
      case 'wrapping':
        setClip('end-op')
        break
      case 'idle':
        /*
         * 收口播「完成」——但只在**见过本轮在跑**时播。
         * 没见过（组件刚挂载、本轮早就结束了）就老老实实回空闲片段，
         * 否则每打开一次页面都要先看一遍「完成」动画。
         */
        setClip(seenRunningRef.current ? 'done' : idleRef.current)
        break
    }
  }, [mode])

  /*
   * ② 空闲时段跨过去了（19:59 → 20:00 从小憩中变观月中）→ 换空闲片段。
   *
   * 必须判「当前正停在某个空闲片段上」：如果此刻正演「完成」，不该被这次换档
   * 打断（完成演完自己会落到新的空闲片段上）。
   */
  useEffect(() => {
    if (mode !== 'idle') return
    const current = clipRef.current
    if (current !== 'meal' && current !== 'moon' && current !== 'nap') return
    if (current !== idleClip) setClip(idleClip)
  }, [idleClip, mode])

  /*
   * ③ 一次性片段 → 定时兜底推进（ended 会丢，见文件头第 2 条）。
   *
   * 依赖只有 clip：**不依赖 mode**，否则动作一换 mode 就把定时器清掉重排，
   * 10 秒的片段会被无限续命。到期时现场读 modeRef / idleRef 算落点。
   */
  useEffect(() => {
    const spec = MOTION_CLIPS[clip]
    if (spec.loop) return undefined
    const timer = window.setTimeout(() => {
      const rest = restingClipFor(modeRef.current, idleRef.current)
      if (rest !== clipRef.current) setClip(rest)
    }, spec.durationMs + 250)
    return () => { window.clearTimeout(timer) }
  }, [clip])

  /*
   * ④ 减少动态效果：不播，只把画面切到「该状态的静止片段」。
   *
   * 不这么做的话，关掉动效的用户会停在一个**一次性片段被暂停**的画面上 ——
   * 而那段可能正是「开始操作」的起手式，看着像卡住了。
   */
  useEffect(() => {
    if (motion) return
    const rest = restingClipFor(mode, idleClip)
    if (rest !== clipRef.current) setClip(rest)
  }, [motion, mode, idleClip])

  /*
   * ⑤ 播放控制（唯一的 DOM 落地点）。
   *
   * 把「该播哪一个」收敛成一次扫描：激活的 play、其余的 pause。所有触发源
   * （片段切换 / 动效开关 / 可见性变化）都调它，行为只有这一份。
   */
  const holderRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef(new Map<MotionClipId, HTMLVideoElement>())
  /** 舞台是否在视口内（IntersectionObserver 维护）。 */
  const inViewRef = useRef(true)
  /** 标签页是否在前台（visibilitychange 维护）。 */
  const tabVisibleRef = useRef(true)
  const playedRef = useRef<MotionClipId | null>(null)

  const applyPlayback = useCallback(() => {
    const active = clipRef.current
    /*
     * 两个可见性条件**分开存**再相乘：合成一个布尔的话，「从隐藏回到可见」时
     * 无从判断自己该恢复成什么（上一版就是这么写的，结果一旦切到后台就再也不播）。
     */
    const wantPlay = motion && inViewRef.current && tabVisibleRef.current
    for (const id of MOTION_CLIP_IDS) {
      const el = nodesRef.current.get(id)
      if (el === undefined) continue
      if (wantPlay && id === active) {
        /*
         * 一次性片段每次都从头播（十个状态各自独立）；循环片段**接着上次的位置**
         * 播 —— 乒乓转码过的片段首尾相接，重进时不必回到第一帧，读起来像她一直
         * 在那儿动着，而不是每次都被"重新开机"。
         */
        if (!MOTION_CLIPS[id].loop && playedRef.current !== id) {
          try { el.currentTime = 0 } catch { /* 还没元数据，忽略 */ }
        }
        playedRef.current = id
        if (el.paused) {
          const started = el.play()
          // 自动播放被策略拒绝时（极少：这里全程 muted）静默认了，别抛到 React。
          if (started !== undefined) void started.catch(() => {})
        }
      } else if (!el.paused) {
        el.pause()
      }
    }
  }, [motion])

  /** 事件回调里永远调用**最新**的 applyPlayback（观察器闭包早于本次渲染）。 */
  const applyRef = useRef(applyPlayback)
  applyRef.current = applyPlayback

  useEffect(() => {
    applyPlayback()
  }, [applyPlayback, clip])

  /*
   * ⑥ 不可见就暂停。
   *
   * 两处容易白烧 CPU：
   *  · 新对话页的 Hero 卡头收起时只设 display:none，节点并没卸载 —— 不暂停的话
   *    它会和右栏那份**同时**在解 9 段视频；
   *  · 右栏本身是可滚动区，滚动到看不见时同样没必要解码。
   * IntersectionObserver 正好同时覆盖这两种（display:none 的元素天然不相交）。
   */
  useEffect(() => {
    const el = holderRef.current
    if (el === null || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      inViewRef.current = entry.isIntersecting
      applyRef.current()
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

  /* ⑦ 标签页切到后台同样暂停（浏览器对后台标签的解码节流并不总是生效）。 */
  useEffect(() => {
    const onVisibility = (): void => {
      tabVisibleRef.current = document.visibilityState !== 'hidden'
      applyRef.current()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { document.removeEventListener('visibilitychange', onVisibility) }
  }, [])

  /** 一次性片段播完：立刻推进到该状态的静止片段（定时器是兜底）。 */
  const onEnded = useCallback(() => {
    const rest = restingClipFor(modeRef.current, idleRef.current)
    if (rest !== clipRef.current) setClip(rest)
  }, [])

  const rootClass = className === undefined ? 'kr-stage' : 'kr-stage ' + className

  return (
    <div
      ref={holderRef}
      className={rootClass}
      data-clip={clip}
      data-mode={mode}
      data-motion={motion ? undefined : 'off'}
      aria-hidden
    >
      {/*
       * 身后的柔光：动画素材是抠掉白底的透明 WebM，直接贴在深色卡片上边缘
       * 会显得"浮"；一圈极淡的主色光把人物坐回卡片里（羽化效果的另一半，
       * 另一半是 .kr-stage__clip 上那圈 mask，见 styles.ts）。
       */}
      <span className="kr-stage__glow" aria-hidden />
      {MOTION_CLIP_IDS.map((id) => (
        <video
          key={id}
          className="kr-stage__clip"
          data-active={id === clip ? '' : undefined}
          /*
           * src 与 poster 都是写死的常量（片段表），**不随状态变化** ——
           * 变了就等于换源，浏览器会重新请求并回到第一帧。
           */
          src={motionVideoUrl(id)}
          poster={motionPosterUrl(id)}
          loop={MOTION_CLIPS[id].loop}
          muted
          playsInline
          preload="none"
          disablePictureInPicture
          onEnded={onEnded}
          ref={(el) => {
            if (el === null) nodesRef.current.delete(id)
            else {
              // muted 用属性设一次不够稳（部分浏览器在首次 play 前会重置），
              // 元素挂上时再压一次，保证自动播放策略放行。
              el.muted = true
              nodesRef.current.set(id, el)
            }
          }}
        />
      ))}
    </div>
  )
}
