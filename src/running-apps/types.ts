/**
 * dsh-chat-plus — 「@ 运行中的程序」公共契约（host / client 两半身逐字共用）。
 *
 * ## 这个功能要解决什么
 *
 * 用户的原话：「想要跟 CODEX 一样输入 @ 可以显示出来目前正在运行的程序，
 * 目的是为了网页标签页不需要输入网址或某一个程序想解决什么事情不需要输入
 * 程序名等等操作」。
 *
 * 换句话说：**让「那个正开着的东西」成为对话上下文的一部分**。用户不必再
 * 手打 `https://www.bilibili.com`、不必再说「就是那个哔哩哔哩客户端」——
 * 打 `@`、从列表里点中它、接着说「帮我把这个视频标题复制出来」就够了。
 *
 * ## 为什么字段名集中在这里
 *
 * 与 browser-activity 同一条纪律：host 产出的键名就是 client 消费的键名，
 * 改名即契约破裂，而破裂的表现是「列表里一片空白」——没有异常、没有日志。
 * 所以类型只有一份，两半身都从这里 import type。
 *
 * @module
 */

/** 客户端拉取的路由（只读、同源 GET）。 */
export const RUNNING_APPS_ROUTE = '/api/chat-flow/running-apps'

/**
 * 「把某个程序的窗口拉到前台」的路由（POST，2026-10-25）。
 *
 * 用途：操作面板那枚浏览器标志可点击 —— 点它直接跳回 ego 的窗口。
 *
 * 为什么是 POST：这是一条**会改变前台窗口**的副作用操作，不是读取。GET 会被
 * 浏览器预取 / 缓存 / 链接预览触发，那意味着「用户还没点，ego 就被拽到前面」。
 *
 * 请求体：`{ "process": "ego" }`（进程名，不含 .exe）。
 * 回包：`{ ok: boolean, activated: string }` —— activated 是真正被激活的进程名，
 * 空串表示没找到窗口（客户端据此走兜底，不弹错）。
 */
export const RUNNING_APPS_ACTIVATE_ROUTE = '/api/chat-flow/activate-window'

/**
 * 采集超时：超过这个时间直接返回 ok:false + 空列表，绝不让请求挂着。
 *
 * 正常采集是 2~4ms（常驻子进程一次往返），8 秒只用于兜住「子进程卡死」
 * 这种异常：超时即杀掉重建，下次请求自愈。
 */
export const RUNNING_APPS_TIMEOUT_MS = 8000

/** 最多返回多少个窗口（菜单一次也放不下更多，多了反而难找）。 */
export const RUNNING_APPS_MAX = 24

/** 一个可见的顶层窗口。 */
export interface RunningAppWindow {
  /** 窗口所属进程 PID。 */
  pid: number
  /** 进程名（不含 .exe，如 `bilibili`）。 */
  process: string
  /** 窗口标题（已经过空标题过滤，不会为空串）。 */
  title: string
  /** 可执行文件绝对路径；受权限限制时可能为 null。 */
  exe: string | null
  /** 是否当前前台窗口。 */
  focused: boolean
  /** 是否最小化（最小化的窗口仍然「正在运行」，只是不可见，保留并标注）。 */
  minimized: boolean
  /** 进程图标（PNG data URL）；取不到为 null，前端用首字母色块兜底。 */
  icon: string | null
}

/** 路由回包。 */
export interface RunningAppsSnapshot {
  /** 采集是否成功。false 时 apps 为空数组（前端静默降级成「没有候选」）。 */
  ok: boolean
  apps: RunningAppWindow[]
  /** 本次采集在 host 侧花掉的毫秒数（0 表示直接命中缓存）。 */
  ms: number
  /** 这份数据产生的时间戳（ms）。 */
  at: number
  /** 失败原因（仅 ok:false 时给，前端只用于 debug 日志，不展示）。 */
  error?: string
}
