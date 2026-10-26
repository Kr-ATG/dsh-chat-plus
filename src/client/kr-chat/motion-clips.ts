/**
 * dsh-chat-plus — 「任务动画」片段表（客户端唯一真相）。
 *
 * # 这是什么
 *
 * 用户 2026-10-26 给了 9 个本地 GIF，替掉操作面板卡头原来那张静态立绘
 * （WhalePortrait：一张位图 + 摇一摇的尾巴 + 冒泡）。现在是 9 段**带透明通道**的
 * WebM，按卡头此刻的状态挑一段播。
 *
 * # 为什么是 WebM 而不是原来的 GIF
 *
 * 9 个 GIF 全是 320x640、在近白底上**完全不透明**。直接贴进深色右栏就是一块白板。
 * 所以先用「从四条边洪泛」的算法把白底抠成 alpha（不能用色键：白色蕾丝裙会被
 * 一起打穿，而它被深色裙摆包住、不连边界，洪泛法天然保得住），再编码成
 * yuva420p 的 VP9 —— 浏览器原生支持带 alpha 的 WebM，体积只有等价 GIF 的几十分
 * 之一，还能被 <video> 直接播放 / 暂停 / 铺帧。
 *
 * 素材随包在 assets/motion/ 下，经 host 路由 /api/chat-flow/motion 吐出
 * （见 src/motion/index.ts；与字体同一套理由：不内联进 client 产物）。
 *
 * # 片段与状态
 *
 *  | 片段 id    | 源 GIF   | 时长   | 何时播 |
 *  |------------|----------|--------|--------|
 *  | thinking   | 思考中   | 19.9s  | 本轮在跑、但一个动作都还没有 |
 *  | start-op   | 开始操作 | 10s    | 本轮第一个真动作开始的那一刻 |
 *  | working    | 操作中   | 19.9s  | 有动作在跑（默认） |
 *  | photo      | 查看照片 | 10s    | 在跑的那一步是看图片（image/fileView/eye） |
 *  | end-op     | 操作结束 | 5s     | 全部接收后的收尾 |
 *  | done       | 完成     | 10s    | 本轮收口 |
 *  | meal       | 吃饭中   | 19.9s  | 空闲，11:00–13:00 |
 *  | moon       | 观月中   | 19.9s  | 空闲，19:00–次日 05:00 |
 *  | nap        | 小憩中   | 19.9s  | 空闲，其余时段 |
 *
 * # 循环 / 单次
 *
 * 原始 GIF 的首尾帧差 27%–70%（不闭环），直接 loop 会看到一次明显跳帧。所以
 * **五个循环片段**（thinking / working / meal / moon / nap）在转码时做成了
 * **乒乓（正放 + 倒放）**，首尾天然相接，可以安全 loop。
 *
 * 另外四个（start-op / photo / end-op / done）是**一次性**动作：播完停在最后一帧，
 * 绝不 loop —— 「开始操作」重复播会变成抽搐。
 *
 * # 为什么时长写死在表里
 *
 * <video> 的 ended 事件在本机实测**会**丢（切片段太快、或 video 被 pause 时被
 * 取消），丢了就永远卡在那一段。所以每个非循环片段都配一个 durationMs，播放器
 * 在 durationMs + 180ms 处兜底推进 —— 与 ended 谁先到算谁。这个兜底的代价是
 * 时长必须与素材**真实一致**，所以这张表是唯一真相，别在别处另写一份。
 *
 * @module
 */

/** 路由前缀：与 host 半身 src/motion/index.ts 的 MOTION_ROUTE 必须一致。 */
export const MOTION_ROUTE = '/api/chat-flow/motion'

/**
 * 全部片段 id（顺序即 DOM 里 <video> 的挂载顺序）。
 *
 * **9 个节点一次性挂满、永不卸载**：操作面板每 250ms 重渲染一次，按需挂载/卸载
 * video 会让浏览器反复中断请求、并且每次都要重新解码首帧 —— 表现是「每次闪一下
 * 才动起来」。挂满之后切片段只是 pause 一个、play 另一个。
 */
export const MOTION_CLIP_IDS = [
  'thinking',
  'start-op',
  'working',
  'photo',
  'end-op',
  'done',
  'meal',
  'moon',
  'nap',
] as const

/** 片段 id。 */
export type MotionClipId = (typeof MOTION_CLIP_IDS)[number]

/** 一个片段的元信息。 */
export interface MotionClipSpec {
  /** 时长（毫秒）。非循环片段用它做 ended 的兜底，必须与素材真实长度一致。 */
  readonly durationMs: number
  /** 是否循环。只有乒乓转码过的片段可以为 true。 */
  readonly loop: boolean
  /** 人类可读的名字（只用于 title / 调试，不进 UI 正文）。 */
  readonly label: string
}

/** 片段表（见文件头的映射说明）。 */
export const MOTION_CLIPS: Record<MotionClipId, MotionClipSpec> = {
  thinking: { durationMs: 19_900, loop: true, label: '思考中' },
  'start-op': { durationMs: 10_000, loop: false, label: '开始操作' },
  working: { durationMs: 19_900, loop: true, label: '操作中' },
  photo: { durationMs: 10_000, loop: false, label: '查看照片' },
  'end-op': { durationMs: 5_000, loop: false, label: '操作结束' },
  done: { durationMs: 10_000, loop: false, label: '完成' },
  meal: { durationMs: 19_900, loop: true, label: '吃饭中' },
  moon: { durationMs: 19_900, loop: true, label: '观月中' },
  nap: { durationMs: 19_900, loop: true, label: '小憩中' },
}

/** 视频地址。 */
export function motionVideoUrl(id: MotionClipId): string {
  return MOTION_ROUTE + '/' + id + '.webm'
}

/**
 * 首帧海报地址。
 *
 * 海报不是可选项：preload="none" 时、以及「减少动态效果」下不播放时，用户看到的
 * 就是它。缺了海报，那两种情况下会是一片空白。
 */
export function motionPosterUrl(id: MotionClipId): string {
  return MOTION_ROUTE + '/' + id + '.webp'
}

/**
 * 「在跑的那一步是在看图片」的图标集合。
 *
 * 三类都算：image（截图 / 生图）、fileView（查看文件）、eye（看屏幕 / 浏览器
 * 快照）。它们对应的 GIF 是「查看照片」—— 她真的在看一张图。
 */
export const PHOTO_ICONS: ReadonlySet<string> = new Set(['image', 'fileView', 'eye'])

/**
 * 空闲文案 → 空闲片段。
 *
 * 以 idle-phrase.ts 的**文案**为键（不是时段），这样改时段不必动这里；新增一个
 * 说法时才需要在这里加一行（缺了会退回 nap，不会白屏）。
 */
export function idleClipFor(phrase: string): MotionClipId {
  if (phrase === '观月中') return 'moon'
  if (phrase === '吃饭中') return 'meal'
  return 'nap'
}
