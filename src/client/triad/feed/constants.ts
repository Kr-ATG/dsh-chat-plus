/**
 * dsh-chat-plus — 「动态」页的常量表。
 *
 * 单独一个文件是为了切断循环依赖：progress.ts 要用 RUN_STEPS 推阶段，
 * 而 FeedPanel.tsx 同时要用这两边。放在组件旁边，progress.ts 去 import
 * 组件文件就会形成「组件 → progress → 组件」的环。
 *
 * @module
 */

/** 生成状态条的五段文案（与原型 STEPS 同文；progress.ts 按它推当前阶段）。 */
export const RUN_STEPS: readonly string[] = [
  '正在读取提示词与用户资料…',
  '正在检索实时网络与社交平台…',
  '正在逐条验活、剔除不可用来源…',
  '正在结合记忆与目标现写内容…',
  '正在静默上架到列表顶部…',
]

/** 状态轮询间隔（毫秒）。只在「生成中」时轮询，空闲时一次都不发。 */
export const STATUS_POLL_MS = 2500

/** 「过了多久」文案的刷新间隔：每分钟重算一次，不重建组件树。 */
export const CLOCK_TICK_MS = 60000

/**
 * 进度弹卡的秒级刷新间隔。
 *
 * ⚠ 这是**纯本地时钟**，不是轮询：它只让「已用时间」那个数字每秒跳一格，
 * 一次网络请求都不发（拉状态的仍然是 STATUS_POLL_MS 那条，且只在 running 时跑）。
 * 用户在弹卡里盯着看的正是这个跳动的秒数 —— 停住不动会让人以为页面卡死了。
 */
export const PROGRESS_TICK_MS = 1000

/**
 * 「刚点下更新、host 还没把 running 报回来」的本地窗口（毫秒）。
 *
 * 点「更新」→ POST /refresh → 下一轮 2.5s 的轮询才把 running 拉回来。这几秒里
 * 如果按 host 的 running 判定，右上角还写着「上次更新」，用户会以为点了没反应。
 * 窗口内一律先当「更新中」，窗口外以 host 为准（host 说没在跑就是没在跑，
 * 不能永远停在自己编的「更新中」上）。
 */
export const LOCAL_RUN_WINDOW_MS = 20000

/**
 * 没有历史耗时时给用户的**保守区间**（毫秒）。
 *
 * 不编一个精确数字：真实一轮要多久取决于是不是要连网检索、模型快不快，
 * 历史实测跨度很大。给区间是诚实的，给「预计 24 秒」是编的。
 */
export const FALLBACK_ETA_MIN_MS = 30000
export const FALLBACK_ETA_MAX_MS = 60000
