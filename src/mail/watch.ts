/**
 * dsh-mail — 新邮件监听（host 半身）。
 *
 * `agently-cli message +watch --msg-format event` 是长轮询：进程常驻，每来一封
 * 新邮件吐一行 NDJSON（`{"dir":"inbox","message_id":"msg_…","occurred_at":"…"}`）。
 *
 * 三条工程约束：
 *
 *  1. **单例**：watch 是常驻进程，重复 start 会攒出一堆长轮询把请求额度吃光
 *     （额度只有 200 次/小时）。start 幂等，已经在跑就直接返回。
 *  2. **退避重启**：CLI 因网络/授权问题退出时不能疯狂重启——指数退避到 5 分钟
 *     封顶；授权失效（stderr 提到 authorization）直接停，等用户重新登录。
 *  3. **事件落盘**：面板可能没开着（浏览器关了），新邮件提示不能丢，所以事件写
 *     进 store 的环形缓冲（最多 50 条），面板打开时再读。
 */

import type { MailStore } from './store.js'
import { startWatch } from './cli.js'

/** 最小重启间隔（毫秒），指数退避到 MAX。 */
const MIN_RESTART_MS = 3_000
const MAX_RESTART_MS = 5 * 60_000

/** 新邮件监听器。 */
export class MailWatcher {
  private readonly store: MailStore
  private readonly logger: { info?: (message: string) => void; warn?: (message: string) => void } | undefined
  private running = false
  private stopChild: (() => void) | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private backoff = MIN_RESTART_MS
  private stoppedByUser = false

  constructor(store: MailStore, logger?: { info?: (message: string) => void; warn?: (message: string) => void }) {
    this.store = store
    this.logger = logger
  }

  /** 是否在监听。 */
  isRunning(): boolean {
    return this.running
  }

  /** 起监听（幂等）。 */
  start(): void {
    if (this.running) return
    this.stoppedByUser = false
    this.spawn()
  }

  /** 停监听（用户主动关，或插件卸载）。 */
  stop(): void {
    this.stoppedByUser = true
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.stopChild?.()
    this.stopChild = null
    this.running = false
  }

  private spawn(): void {
    if (this.running || this.stoppedByUser) return
    this.running = true
    const handle = startWatch(
      (event) => {
        // 只关心收件箱的新邮件（sent 是自己发出去的，不提示）。
        if (event.dir !== undefined && event.dir !== 'inbox') return
        void this.store.pushEvent({
          message_id: event.message_id,
          dir: event.dir,
          occurred_at: event.occurred_at,
          at: Date.now(),
        }).catch(() => undefined)
        this.backoff = MIN_RESTART_MS
      },
      (code, stderr) => {
        this.running = false
        this.stopChild = null
        if (this.stoppedByUser) return
        // 授权失效：不重启，等用户重新登录（重启也只会立刻失败）。
        if (/authorization|not logged in|auth/i.test(stderr)) {
          this.logger?.warn?.('[dsh-mail] watch stopped: authorization required')
          this.stoppedByUser = true
          return
        }
        const delay = this.backoff
        this.backoff = Math.min(MAX_RESTART_MS, this.backoff * 2)
        this.logger?.info?.(`[dsh-mail] watch exited (code=${String(code)}); restart in ${Math.round(delay / 1000)}s`)
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null
          this.spawn()
        }, delay)
        // 计时器不阻止进程退出（DSH 关服时不该被它吊住）。
        this.restartTimer.unref?.()
      },
    )
    this.stopChild = handle.stop
  }
}
