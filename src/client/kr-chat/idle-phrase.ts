/**
 * dsh-chat-plus — 卡头「没在干活」时那句话（空闲文案）的唯一真相。
 *
 * ## 为什么单独成模块
 *
 * 这张卡头出现在**两处**：右栏「操作面板」卡（KrPlainTimelineCard）与新对话页顶部
 * （SeekerHeroHead）。两处都按钟点挑一句话，原先各抄一份时段表 —— 改一处忘了
 * 另一处，表现是「新对话页说她还在晒太阳，右栏说她已经在观月」这种没人会想到
 * 去查的不一致。
 *
 * 现在时段表只有这一份，两个调用方都 import 它。
 *
 * ## 2026-10-26 的改动（用户点名）
 *
 * 用户删掉了「休息中」与「晒太阳」两个说法，加回「观月中」「小憩中」：
 *
 *   19:00–次日 05:00  观月中   （夜里，抬头能看到月亮）
 *   05:00–11:00       小憩中
 *   11:00–13:00       吃饭中   （唯一真跟吃饭绑定的时段）
 *   13:00–19:00       小憩中
 *
 * 边界左闭右开：19 点整算观月中，05 点整算小憩中。
 *
 * 不按「每 6 小时轮一个」那种均分 —— 凌晨 3 点显示「小憩中」会立刻暴露这是假状态，
 * 而凌晨 3 点说「观月中」在这个语境里是真的（她真的在夜里看月亮）。
 *
 * ## 与动画片段的对应关系
 *
 * 这三个说法各自对应一段动画（观月中 → moon / 吃饭中 → meal / 小憩中 → nap，
 * 见 motion-clips.ts 的 idleClipFor）。**映射以本模块的文案为准**，动画那边
 * 按说法反查片段 id —— 这样改文案时不需要同步改两处，只有新增说法才需要。
 *
 * @module
 */

/**
 * 时段表：左闭右开的小时区间 → 那句话。
 *
 * 跨零点的「观月中」拆成 [0,5] 与 [19,24] 两段：区间表不支持环绕，
 * 拆两段比在查找函数里写特例清楚。
 */
export const IDLE_SLOTS: ReadonlyArray<readonly [number, number, string]> = [
  [0, 5, '观月中'],
  [5, 11, '小憩中'],
  [11, 13, '吃饭中'],
  [13, 19, '小憩中'],
  [19, 24, '观月中'],
]

/**
 * 空闲说法的全集（去重、按一天里第一次出现的顺序）。
 *
 * 这个数组只作为**兜底与断言**存在：实际用哪个由 IDLE_SLOTS 按钟点决定，
 * 不由随机或计数决定。保留它是为了让「一共就这几种说法」这件事有个可断言的
 * 出处（冒烟据此检查没有残留已被删掉的旧说法）。
 */
export const IDLE_PHRASES: readonly string[] = ['观月中', '小憩中', '吃饭中']

/**
 * 按当前时间挑一句空闲文案。
 *
 * 取**本地时间**（用户看的是自己墙上的钟，不是 UTC）。传入 now 是为了让这个
 * 函数可测：组件里传 new Date()，测试里传固定时刻，不必 mock 全局 Date。
 *
 * @param now - 当前时刻。
 * @returns 该时段对应的空闲短语。
 */
export function idlePhraseFor(now: Date): string {
  const hour = now.getHours()
  for (const slot of IDLE_SLOTS) {
    const start = slot[0]
    const end = slot[1]
    const phrase = slot[2]
    if (hour >= start && hour < end) return phrase
  }
  return IDLE_PHRASES[1] ?? '小憩中'
}

/** 刚发出消息、还没有任何动作时的一句话（不是空闲文案，见 KrPlainTimelineCard）。 */
export const THINKING_PHRASE = '在思考中'
