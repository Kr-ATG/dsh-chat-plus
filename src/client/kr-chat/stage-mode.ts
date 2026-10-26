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

/** 卡头的动画态。片段选择见 motion-clips.ts 的 MOTION_CLIPS。 */
export type StageMode = 'thinking' | 'acting' | 'photo' | 'wrapping' | 'idle'

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
   * 收尾**压过**基础态（包括 photo）：收尾时那一步已经做完了，"还在看照片"是错的
   * 读数；而 end-op 是一段 5 秒的收尾动作，正好该在这时说。
   * 只有 idle 不被压——本轮已经结束，收尾自然结束。
   */
  if (wrapping && base !== 'idle') return 'wrapping'
  return base
}
