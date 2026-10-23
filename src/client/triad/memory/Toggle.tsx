/**
 * dsh-memory 记忆注入的**归一化口径**（纯函数 + 兜底常量），不含任何 UI。
 *
 * 历史：本文件原名 Toggle.tsx，是 composer 输入框工具行左端的「记忆注入」按钮 +
 * 悬浮卡片。那张卡已按用户要求删除：
 *   · 2026-10-15 删掉紧邻的「内置提示词通道」卡（order 98），开关迁到 Seeker
 *     右栏「大盘设置」抽屉；
 *   · 2026-10-23 删掉这张「记忆注入」卡（order 99），用户原话「算了这个对话框内
 *     的记忆开关给删掉吧」。
 * 卡片删了，但**同一份 /inject-state 契约仍被大盘设置抽屉读写**
 * （kr-chat/KrPanelSettings.tsx 导入 FALLBACK_INJECT_STATE / normalizeInjectState），
 * 所以这两个导出必须留下 —— 抽屉与宿主之间「缺字段怎么兜底」的口径只此一份，
 * 各写一份的结果是同一个开关在两处显示成两个值。
 *
 * 因此本文件现在只剩两件事：兜底常量 + 归一化函数。别再往这里加组件。
 */

import type { InjectStateView } from './api.js'

/**
 * host 缺字段时的兜底形状：中文通道 / html / 自动收口默认开（内置能力），
 * team 默认关（旧 host 没这个能力，显示「开」是假阳性）。
 *
 * 只在请求失败时用（正常路径由 host 回包决定）。html 的兜底取 true 与
 * config.htmlInjectDefaultEnabled 同口径——它默认开，请求失败时显示「关」会让
 * 用户以为能力没开。自动收口同此理：host 侧 config.todoClosureDefaultEnabled
 * 默认 true，兜底取 false 会让请求一失败就显示成关。
 *
 * 邮箱（mail*）四个字段一律按「不可用」兜底：它是跨模块能力，旧 host 不回
 * 这些字段，猜一个值出来只会误导。
 *
 * 工作区三个字段（project*）一律按 null 兜底：null 是「不知道/不适用」，
 * 而这三个字段的唯一消费者（大盘设置抽屉那行「工作区项目记忆记录」）正是靠
 * null 决定**不渲染开关**。兜底成 true/false 会让它在拿不到工作区时凭空长出一个
 * 拨了没用的开关 —— 拨不动的开关是骗人。
 */
export const FALLBACK_INJECT_STATE: InjectStateView = {
  enabled: true, defaultEnabled: true, explicit: false, zhEnabled: true, htmlEnabled: true, teamEnabled: false, todoClosureEnabled: true,
  mailEnabled: false, mailAvailable: false, mailWorkbenchEnabled: false, mailToolsMounted: false, mailAuthorized: false, mailAddress: null,
  projectHash: null, projectPath: null, projectMemoryEnabled: null,
}

/**
 * 把 host 回包收敛成本地状态形状（缺字段按默认处理）。
 *
 * **导出**：Seeker 右栏的「大盘设置」抽屉（kr-chat/KrPanelSettings.tsx）读同一份
 * `/inject-state` 回包，必须复用这一套逐字段兜底口径。各写一份的结果是「同一个
 * 开关在 composer 卡与大盘抽屉里显示成两个值」——而这两处的差异全部来自
 * 「谁按 !== false 兜底、谁按 === true 兜底」，正是本文件反复注释的那类假阳性。
 */
export function normalizeInjectState(res: InjectStateView): InjectStateView {
  return {
    enabled: res.enabled !== false,
    defaultEnabled: res.defaultEnabled !== false,
    explicit: res.explicit === true,
    // 缺字段按 true 兜底：中文通道是内置能力，默认就该开着。
    zhEnabled: res.zhEnabled !== false,
    // html 缺字段按 false 兜底：缺字段意味着旧 host 没这个能力——显示「关」
    // 比显示「开」诚实（显示开着却注不进去是假阳性）。
    htmlEnabled: res.htmlEnabled === true,
    // team 与 html 同口径：缺字段意味着旧 host 根本没这个能力，
    // 显示「关」比显示「开」诚实（开着却注不进去是假阳性）。
    teamEnabled: res.teamEnabled === true,
    // 自动收口与 zh 同口径（**不是** html / team 那种）：它是默认开的
    // 通道，缺字段按开。写成 === true 的话，client 已更新、host 还没重启的那段
    // 窗口里开关会显示成关，host 一重启又跳成开。
    todoClosureEnabled: res.todoClosureEnabled !== false,
    // 邮箱字段全是「缺字段即不可用/关」：跨模块回传，旧 host 没有。
    mailEnabled: res.mailEnabled === true,
    mailAvailable: res.mailAvailable === true,
    mailWorkbenchEnabled: res.mailWorkbenchEnabled === true,
    mailToolsMounted: res.mailToolsMounted === true,
    mailAuthorized: res.mailAuthorized === true,
    mailAddress: typeof res.mailAddress === 'string' ? res.mailAddress : null,
    /*
     * 工作区三字段与上面所有通道**刻意不同口径**：这里 null 是一个有意义的值
     * （「不知道 / 不适用」），不是缺失兜底。
     *
     *  - projectMemoryEnabled：只有真 boolean 才认，其余（undefined / null /
     *    字符串 / 数字）一律收敛成 null。旧 host 不回该字段 → null → UI 不渲染
     *    开关。照 `!== false` 兜底会让「host 还没落地新契约」的那段窗口里凭空
     *    长出一个显示为「开」的开关，而它拨不动也存不下 —— 正是本仓反复强调的
     *    「拨不动的开关是骗人」。
     *  - projectHash / projectPath：只有非空字符串才认，否则 null（空串是
     *    「没有工作区」的另一种写法，收敛成同一个值，调用方只判 null 一处）。
     */
    projectMemoryEnabled: typeof res.projectMemoryEnabled === 'boolean' ? res.projectMemoryEnabled : null,
    projectHash: typeof res.projectHash === 'string' && res.projectHash !== '' ? res.projectHash : null,
    projectPath: typeof res.projectPath === 'string' && res.projectPath !== '' ? res.projectPath : null,
  }
}
