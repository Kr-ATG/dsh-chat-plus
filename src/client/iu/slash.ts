/**
 * dsh-chat-plus — `/iu` 斜杠指令（对话内交互卡片的**强制**入口）。
 *
 * 用法：
 *
 *     /iu 做个钢琴
 *     /iu 三个方案对比
 *     /iu 帮我算下 8 个人的烤肉份量
 *
 * 消息**原样发出**（含 `/iu` 前缀），模型据注入通道里的 `/iu` 语义知道这是
 * 「要求出卡片」的指令。
 *
 * ── 为什么最终是「什么都不做」 ───────────────────────────────────────────
 *
 * 这个源走过三段弯路，值得记下来：
 *
 *  1. **第一版**：`matchEnter` 返回 `{ text: 改写文本 }`，想让输入机替换草稿。
 *     结果消息**发不出去也不报错** —— 输入机的 `onAdjudicated` 只认 `claim`
 *     （真命令）和 `undefined`（走默认发送），其余 outcome 一律丢弃。
 *
 *  2. **第二版**：自己用 `sessions.scope(id).conversation.send()` 投递。
 *     消息能发出去了，但冒出两个新毛病：前缀被剥（用户要的是原样保留）、
 *     输入框不清空（绕过了输入机，它那步「发送成功后清空草稿」没执行）。
 *
 *  3. **现在**：`matchEnter` 恒返回 `undefined` —— 不认领、不改写、不投递，
 *     让输入机的**默认发送**把原文照发。于是前缀保留、草稿清空、历史记录
 *     与手动输入完全一致，全部由官方链路保证。
 *
 * 结论：这个源真正需要的只有 `candidates`（菜单里能看见 `/iu` 这一项）。
 * `matchEnter` 存在的意义是**显式声明不拦**，并留一句注释挡住「再改回去」。
 *
 * ⚠ 别把 `onPick` 的 `{ text }` 一起删了：它俩语义完全不同。
 *   · `onPick` 返回 `{ text: '/iu ' }` —— 用户**主动点菜单项**，把前缀补进草稿，
 *     是合法且必要的（属于 `execute()` 支持的 outcome）；
 *   · `matchEnter` 返回 `{ text }` —— **抢回车键**，而 `onAdjudicated` 只认
 *     `claim`/`undefined`，其余一律丢弃 → 消息发不出去。
 *   冒烟里那条「不得返回 `{ text }`」的断言因此只查 `matchEnter` 的函数体。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 inputTriggers 服务声明与 InputTriggerSource 契约。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  InputTriggerSource, InputTriggerServiceContract, InputTriggerCandidate,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** 指令名（也是落进菜单的候选名）。 */
export const IU_COMMAND = 'iu'

/** 一行草稿是否以 `/iu` 开头（词边界见下方注释）。 */
export function hasIuPrefix(line: string): boolean {
  return /^\/iu(?![A-Za-z0-9])/.test(line.trim())
}

/**
 * 取出 `/iu` 之后的内容（**仅用于菜单/提示，不用于改写发送内容**）。
 *
 * 边界判据是「`/iu` 后面**不是 ASCII 字母数字**」，两个反例各踩过一次：
 *  · 用 `\s*`（不限边界）→ `/iux 别的命令` 被当成 `/iu`，吞掉别人的命令；
 *  · 用 `(?:\s|:|$)`（要求分隔符）→ `/iu做个钢琴`（中文紧贴）不认，
 *    而中文输入法下用户很可能不敲那个空格。
 * `(?![A-Za-z0-9])` 同时满足两边：中文/空格/冒号/行尾都算边界，`x` 不算。
 */
export function stripIuPrefix(line: string): string | null {
  const m = /^\/iu(?![A-Za-z0-9])[:：]?\s*([\s\S]*)$/.exec(line.trim())
  if (m === null) return null
  return (m[1] ?? '').trim()
}

/**
 * 菜单里的兜底提示项。
 *
 * `/iu` 打出来时菜单总得显示点什么——给一条说明行，告诉用户「直接接着说
 * 你要什么」。选中它等于把 `/iu ` 留在草稿里。
 */
function hintCandidate(): InputTriggerCandidate {
  return {
    name: IU_COMMAND,
    label: '交互卡片',
    description: '直接接着说你要什么，例如「/iu 做个钢琴」「/iu 三个方案对比」',
    value: IU_COMMAND,
  }
}

/** 挂载 `/iu` 源。 */
export function applyIuSlash(ctx: ClientContext): void {
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (inputTriggers === undefined) {
    console.warn('[iu-slash] inputTriggers 服务不可用，/iu 源未注册')
    return
  }

  const source: InputTriggerSource = {
    trigger: '/',
    name: IU_COMMAND,
    // 排在技能源（order 2）之后：/iu 是低频指令，不该抢技能列表的位置。
    order: 8,
    async candidates(_session, req) {
      if (req.signal.aborted) return []
      // 只在「刚打出 /iu」时给提示；用户已经开始描述内容就不再弹菜单挡打字。
      const q = req.query.trim().toLowerCase()
      if (q === '' || IU_COMMAND.startsWith(q)) return [hintCandidate()]
      return []
    },
    onPick() {
      // 选中提示项：把 `/iu ` 留在草稿里，用户接着描述。
      return { text: `/${IU_COMMAND} ` }
    },
    /**
     * **刻意恒返回 undefined：不拦、不改写、不投递。**
     *
     * 返回 undefined = 我不认领这一行 → 输入机走默认发送，把用户打的原文
     * （含 `/iu`）原样发出去，并正常清空草稿。
     *
     * 必须是 `async`：契约里 `matchEnter` 签的是 `Promise<PickOutcome>`
     * （`PickOutcome` 联合里含 `undefined`，但**外层**要的是 Promise）。
     * 写成同步 `matchEnter() { return undefined }` 会报
     * TS2322（`() => undefined` 不可赋给返回 Promise 的签名），而运行期
     * `await` 到 undefined 恰好也是「不认领」，所以这个错**只在类型层面暴露**，
     * 不改也能跑 —— 正因如此更要按签名写，别把类型错误留成噪音。
     *
     * 历史教训（别再改回去）：
     *  · 返回 `{ text }` → 消息被静默丢弃（输入机只认 claim/undefined）；
     *  · 自己调 `conversation.send()` → 前缀被剥、输入框不清空。
     * 两条都不如「什么都不做」——官方默认链路本来就全对。
     */
    async matchEnter() {
      return undefined
    },
  }

  ctx.effect(() => {
    let unregister: (() => void) | undefined
    try {
      unregister = inputTriggers.registerSource(source)
    } catch (error) {
      // 同名源已被别的插件占用时只降级，不影响卡片渲染本身。
      console.warn('[iu-slash] /iu 源注册失败：', error)
    }
    return () => { if (unregister !== undefined) unregister() }
  }, 'iu-slash: /iu source')
}

/** 供冒烟断言：前缀判定 + 指令名。 */
export const iuSlashTest = {
  hasPrefix: hasIuPrefix,
  strip: stripIuPrefix,
  command: IU_COMMAND,
}
