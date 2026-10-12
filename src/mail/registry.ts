/**
 * dsh-mail 的跨模块单例槽位（host 半身）。
 *
 * 为什么需要：`/api/dsh-memory/mail-inject-state` 是 composer 那张「内置提示词
 * 通道」卡片的端点，而邮箱的开关与授权状态住在 dsh-mail 模块里。两个模块同属
 * 一个插件、同一个进程，但**装配顺序**是 triad（记忆）在前、mail 在后，且各自
 * 独立 try/catch —— 所以记忆侧不能在自己的装配期去拿 mail 的实例（那时还没有），
 * 只能运行时通过这个槽位取。
 *
 * 与 `memory-store-singleton.ts` 同一手法，理由也一样：**不能把实例挂到 ctx 上**
 * ——harness rc.8 起的 cordis 对未 declare/provide 的 ctx 属性赋值直接 throw
 * （cannot set property without provide），那会让整个插件树 boot 失败。
 *
 * 槽位为空（mail 模块没挂上 / 挂了但装配失败）时，读取方按「这条通道不可用」
 * 处理，绝不猜一个状态出来。
 */

/** 邮箱状态的同步快照（读取方零等待）。 */
export interface MailStatusSnapshot {
  /** 邮箱工作台总开关（`mail.enabled`）——决定 `mail_*` 工具注册不注册。 */
  workbenchEnabled: boolean
  /**
   * 声明开关（`mail.injectEnabled`）——决定「模型知不知道有这个邮箱」。
   *
   * 与 workbenchEnabled **解耦**：工作台关着、这一项开着时，声明照常注入，
   * 只是文本改走 `agently-cli` 命令行（见 inject.ts 的 MAIL_CLI_FALLBACK_RULE）。
   */
  injectEnabled: boolean
  /** `mail_*` 工具当前是否已注册（= 工作台开着）。决定注入文本走工具还是命令行。 */
  toolsMounted: boolean
  /**
   * 是否已授权（null = 尚未探测出来）。
   *
   * 刻意区分 null 与 false：`false` 是「探测过，确实没授权」，`null` 是
   * 「还没问过 CLI」。把 null 当 false 显示，会让刚启动的那几秒里卡片上写着
   * 「未授权」，而实际上邮箱好好的。
   */
  authorized: boolean | null
  /** 本 Agent 的邮箱地址（未探测到/未授权时 null）。 */
  address: string | null
}

/** 槽位里存的能力面。 */
export interface MailStatusSource {
  /** 同步读当前快照（不阻塞、不打 CLI）。 */
  snapshot: () => MailStatusSnapshot
  /** 异步刷新授权状态与地址（内部节流，调用方可 fire-and-forget）。 */
  refresh: () => Promise<void>
  /** 改运行时配置（面板拨开关走它，立即生效）。 */
  updateConfig: (patch: { enabled?: boolean; injectEnabled?: boolean }) => Promise<void>
}

let mailStatusSource: MailStatusSource | null = null

/** 写入槽位（仅 dsh-mail 模块装配时调用）。 */
export function setMailStatusSource(source: MailStatusSource): void {
  mailStatusSource = source
}

/** 清空槽位（模块卸载时）。 */
export function clearMailStatusSource(): void {
  mailStatusSource = null
}

/** 读取槽位（未挂载时为 null）。 */
export function getMailStatusSource(): MailStatusSource | null {
  return mailStatusSource
}
