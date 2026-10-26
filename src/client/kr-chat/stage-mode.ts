/**
 * dsh-chat-plus — 「卡头此刻该演哪一段」的判定（一处判定，两处使用）。
 *
 * ## 为什么单独成模块
 *
 * 判定需要**时间**（收尾要等一小会儿才认，见下），所以是个 hook，不能写成
 * 纯函数塞进 motion-clips.ts 那张表里。纯的那部分（stageModeOf）仍留在这里，
 * 方便单点看清「数据 → 状态」的映射。
 *
 * ## 三个容易搞错的地方
 *
 * 1. **running 但 empty** 是「在思考中」，不是「操作中」。消息发出去到第一个工具
 *    调用之间有一段空窗，那时卡头挂「操作中」会让用户以为她已经在动了。
 *
 * 2. **收尾（wrapping）必须等一小会儿**。判据本来是「本轮还在跑、但没有任何一步
 *    在跑」= 所有动作都做完了、正在收尾。但这个条件在**步与步之间**也成立（模型
 *    在两次调用之间思考时，上一步已经 done、下一步还没开始）。所以要求它**连续
 *    成立 900ms** 才认 —— 单个动作的间隙通常更短，不会误报；真的进入收尾后它
 *    一直成立，必然被认出来。
 *
 * 3. **photo 优先于 acting**：正在看图片时播「查看照片」，否则一律「操作中」。
 *
 * @module
 */

import { useEffect, useRef, useState } from 'react'
import { PHOTO_ICONS } from './motion-clips.ts'

/**
 * 卡头的动画态。片段选择见 motion-clips.ts 的 MOTION_CLIPS。
 *
 * `photo` 与 `viewing` **共用「查看照片」那段素材，但落点不同**（2026-10-26）：
 *  · `photo`  —— 有个**读图类工具正在跑**（截图 / 看文件 / 看屏幕）。片段演完
 *    就回「操作中」的循环，因为下一步多半是继续操作；
 *  · `viewing` —— 用户这一轮**发来了图片**，她正在看这张图。这时一条工具都还没
 *    跑，也不会马上跑（模型常常看完图直接作答），所以要**停在看图这一幕**
 *    并反复重播，直到真的开始动工具。
 *
 * 拆成两档而不是复用 `photo`：两者该停在哪完全相反（一个走、一个留），用同一个
 * 值就必须把"要不要继续播"的外部上下文塞进 SeekerStage，反而更绕。
 */
export type StageMode = 'thinking' | 'acting' | 'photo' | 'viewing' | 'wrapping' | 'idle'

/** 判定的输入。 */
export interface StageModeInput {
  /** 本轮是否还在跑（与卡片其它地方同一口径）。 */
  readonly running: boolean
  /** 本轮一条动作都还没有。 */
  readonly empty: boolean
  /** 此刻**有**一步正在跑（status === 'running'）。 */
  readonly hasRunningStep: boolean
  /** 卡头那一行动作的图标键；没有动作时 null。 */
  readonly icon: string | null
  /**
   * 本轮**用户输入**里带了几张图片（0 / 省略 = 没带）。
   *
   * 为什么这个信号要从输入侧来：图片是模型这一步的**输入**，不是哪个工具的
   * 产出。用户发图过来时，那一刻通常一条工具调用都还没有（`empty` 为真），
   * 若只按「有没有在跑的工具」判，就必然落到「思考中」—— 而用户看到的事实是
   * 「我给了她一张照片」，她该先去看图。用户 2026-10-26 点名要这个。
   */
  readonly inputImages?: number
}

/**
 * 「收尾」需要连续成立的时长。
 *
 * 这个判据**天生有歧义**：本轮还在跑、但没有任何一步在跑，既可能是「真的收尾了」
 * （最后一步做完、模型在写最终回答），也可能是「两次工具调用之间模型在思考」。
 * 前者是我们要的，后者会误报。
 *
 * 缓解靠两条：
 *  1. 2200ms 的滞回 —— 短间隙（<2.2s）不会触发；
 *  2. 收尾片段**只演一次**，演完就回「操作中」的循环（见 SeekerStage 的
 *     restingClipFor）—— 万一是误报，后果也只是「她做一个收尾手势又继续干活」，
 *     而不是**冻结在一个错误的姿势上**。
 *
 * 真正的收尾结束时 running 会翻 false，那条路是确定的（→ 播「完成」）。
 */
export const WRAP_DWELL_MS = 2200

/**
 * 纯判定：不含收尾那一档（收尾需要时间，见 {@link useStageMode}）。
 *
 * @param input - 见 {@link StageModeInput}。
 * @returns 基础态。
 */
export function stageModeOf(input: StageModeInput): Exclude<StageMode, 'wrapping'> {
  if (!input.running) return 'idle'
  /*
   * 带图的输入**压过「在思考中」**（2026-10-26）。
   *
   * 顺序很关键：`empty`（还没有任何工具调用）几乎必然为真 —— 用户刚把图和
   * 文字发出去，模型正在读上下文。这时候判「思考中」在技术上没错，但用户看到的
   * 是自己的照片发过去了、她却在发呆。所以只要本轮输入里有图，就先演「查看
   * 照片」，等她真的开始动工具，再由下面两条接管。
   *
   * 不压「收尾」：收尾是在本轮末尾判的（那时工具早就跑完了），两者不会同时成立。
   */
  if (input.inputImages !== undefined && input.inputImages > 0) {
    /*
     * 已经动过工具之后（非 empty）就不再被带图信号劫持：那时卡片已经能说清
     * 「她在操作中」，一直演看照片反而与卡头那行文字（正在做什么）打架。
     */
    if (input.empty) return 'viewing'
  }
  if (input.empty) return 'thinking'
  if (input.icon !== null && PHOTO_ICONS.has(input.icon)) return 'photo'
  return 'acting'
}

/**
 * 卡头当前的动画态（含带滞回的「收尾」）。
 *
 * @param input - 见 {@link StageModeInput}。
 * @returns 动画态。
 */
export function useStageMode(input: StageModeInput): StageMode {
  const base = stageModeOf(input)
  const [wrapping, setWrapping] = useState(false)

  /*
   * 只在「本轮在跑、有动作、但当下没有任何一步在跑」这一种情况下计时。
   * 其它情况立刻撤销收尾判定并清掉计时器 —— 一旦有新动作开始，收尾就该结束。
   */
  const settleReady = input.running && !input.empty && !input.hasRunningStep
  const timerRef = useRef(0)
  useEffect(() => {
    if (!settleReady) {
      if (timerRef.current !== 0) {
        window.clearTimeout(timerRef.current)
        timerRef.current = 0
      }
      setWrapping(false)
      return undefined
    }
    if (timerRef.current !== 0) return undefined
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      setWrapping(true)
    }, WRAP_DWELL_MS)
    return () => {
      if (timerRef.current !== 0) {
        window.clearTimeout(timerRef.current)
        timerRef.current = 0
      }
    }
  }, [settleReady])

  /*
   * 收尾**压过**基础态（包括 photo / viewing）：收尾时那一步已经做完了，"还在看照片"是错的
   * 读数；而 end-op 是一段 5 秒的收尾动作，正好该在这时说。
   * 只有 idle 不被压——本轮已经结束，收尾自然结束。
   */
  if (wrapping && base !== 'idle') return 'wrapping'
  return base
}
