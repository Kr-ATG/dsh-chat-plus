/**
 * dsh-chat-plus — 对话流总结卡外观开关（框 + 阴影）。
 *
 * 用户在 Seeker 对话流里看到的「总结卡」= `.dtt__card--reply`（回合最终回复的
 * 那张卡，外壳定义在 styles.ts）。它身上有两件纯装饰：1px 发丝描边 + 一层投影。
 * 本模块只决定这两件要不要显示，**一个字都不进 prompt**，与任何注入通道都无关。
 *
 * 关掉后卡片本身仍在、正文仍在、动效仍在，只是不再有框和影——退成一片纯正文。
 *
 * 为什么走 localStorage 而不是 host 状态表：
 *  · 它是**纯客户端呈现偏好**，host 那头没有任何消费者，写进 host 只会让
 *    「换个观感」这件事被迫等一次 DSH 重启（host 半身必须重启才认新端点）；
 *  · 仓库里已有同款先例（kr-chat-store 的 dsh.kr_chat.panel_width），同一套
 *    读写 + 订阅形态，不引入第二种持久化范式。
 *
 * 生效方式：给 body 挂 `data-dsh-reply-plain`，CSS 据此把描边与投影让掉
 * （见 styles.ts「总结卡外观开关」那一段）。写在 body 上而不是卡片自身上，
 * 是因为卡片由官方节点视图渲染、插件拿不到它的 className；body 属性是现成的
 * 全局钩子（`data-dsh-kr-chat` 同款）。
 *
 * 过渡动效：两道属性都走 transition（见 styles.ts），切换时框与影是**渐变**掉
 * 的，不会有「啪一下换了个样」的跳变；边框宽度不变、只变颜色，所以正文不会位移。
 */

/** localStorage 键（跨刷新保留）。 */
const STORAGE_KEY = 'dsh.chat_plus.reply_card_chrome'

/**
 * body 上的标记属性：**存在 = 关掉框与阴影**（纯正文形态）。
 *
 * 取「关掉才挂」而不是「开着才挂」：默认态（有框有影）是当前观感，也是绝大多数
 * 时刻，属性缺席时 CSS 不需要任何显式规则——少一条规则就少一条可能与官方样式
 * 打架的路径。
 */
export const REPLY_PLAIN_ATTR = 'data-dsh-reply-plain'

/** 当前值（true = 显示框与阴影，维持现状）。 */
let enabled = true

/**
 * 是否已初始化过。
 *
 * installReplyCardChrome 目前由 apply 调用一次，但 apply 在热重载 / 二次挂载下
 * 可能被再调一次，而每次都会新绑一个 storage 监听 —— 两个监听干同一件事，
 * 一次改动触发两轮通知。短路掉最省事（重入时只重读状态，不重复绑定）。
 */
let installed = false

/** 订阅者（组件用 useSyncExternalStore 接）。 */
const listeners = new Set<() => void>()

/**
 * 从 localStorage 读取（读不到 / 被禁用 → 保持默认 true）。
 *
 * 默认 true 的理由：当前观感是用户认可的成熟形态，升级本身不该改变任何人的
 * 界面。开关只服务于「想换的时候换」。
 */
function readStored(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // 只认显式的 '0' / '1'：脏值（手工改坏、别的版本写的别的东西）一律回默认，
    // 不把随机字符串当成某种意图。
    if (raw === '0') return false
    if (raw === '1') return true
    return true
  } catch {
    // 隐私模式 / 存储被禁时 getItem 会抛，读取失败按默认处理。
    return true
  }
}

/**
 * 把当前值同步到 body 属性（幂等）。
 *
 * 只在值真的变化时写 DOM：属性写入会触发一次样式重算，而这个函数在每次
 * 开关变化与初始化时都会被调到。
 *
 * body 还没就绪（极少数：脚本早于 body 解析执行）时不硬等也不报错——补一次
 * DOMContentLoaded 重试。不这么做的话，那一次同步会静默丢失，表现为「刷新后
 * 开关是关的、卡片却还带框」，而控制台干干净净。
 */
function syncBodyAttribute(): void {
  if (typeof document === 'undefined') return
  if (document.body === null) {
    document.addEventListener('DOMContentLoaded', () => { syncBodyAttribute() }, { once: true })
    return
  }
  if (enabled) {
    if (document.body.hasAttribute(REPLY_PLAIN_ATTR)) {
      document.body.removeAttribute(REPLY_PLAIN_ATTR)
    }
    return
  }
  if (document.body.getAttribute(REPLY_PLAIN_ATTR) !== '') {
    document.body.setAttribute(REPLY_PLAIN_ATTR, '')
  }
}

/** 读当前值（useSyncExternalStore 的 getSnapshot）。 */
export function replyCardChromeEnabled(): boolean {
  return enabled
}

/** 订阅变化（useSyncExternalStore 的 subscribe）。 */
export function subscribeReplyCardChrome(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 写值：落盘 + 刷 body 属性 + 通知订阅者。 */
export function setReplyCardChromeEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // 落盘失败只影响「刷新后还记得吗」，本次会话内的显示照常生效——
      // 不因为存储不可用就把用户刚点的开关弹回去。
    }
  }
  syncBodyAttribute()
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('[reply-card-chrome] listener error', error)
    }
  }
}

/**
 * 初始化：读盘 → 刷 body 属性 → 跟随别的窗口的改动。
 *
 * 在插件 apply 时调用一次（见 index.ts）。**不在这里订阅 DOM**：本开关只影响
 * 一条 CSS 规则，属性一挂全部生效，没有任何需要观察的节点。
 *
 * `storage` 事件只在**其它**窗口/标签页改动时触发，所以这里直接重读整份状态，
 * 不区分来源；同窗口的改动由 setReplyCardChromeEnabled 自己负责广播。
 */
export function installReplyCardChrome(): void {
  enabled = readStored()
  syncBodyAttribute()
  // 重入时只把状态重读一遍，不再叠第二个 storage 监听（见 installed 的注释）。
  if (installed) return
  installed = true
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return
      const next = readStored()
      if (next === enabled) return
      enabled = next
      syncBodyAttribute()
      for (const listener of listeners) {
        try {
          listener()
        } catch (error) {
          console.error('[reply-card-chrome] listener error', error)
        }
      }
    })
  }
}
