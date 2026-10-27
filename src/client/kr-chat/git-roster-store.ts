/**
 * dsh-chat-plus — Seeker 卡头「Git 全局大盘」开合状态共享 Store。
 *
 * 管理右上角 Git 图标与 GitRosterModal / Drawer 之间的开合。
 * 遵循相同规范：跨 live reload 共享 window 单例槽位，带品牌字段校验。
 *
 * @module
 */

type Listener = () => void

const STORE_GLOBAL_KEY = '__dshChatPlusGitRosterStore__'
const STORE_BRAND = '__dshGitRosterStoreBrand__'

class GitRosterStore {
  readonly [STORE_BRAND] = true as const

  private _open = false
  private readonly _listeners = new Set<Listener>()

  get open(): boolean {
    return this._open
  }

  setOpen(next: boolean): void {
    if (this._open === next) return
    this._open = next
    this.notify()
  }

  toggle(): void {
    this.setOpen(!this._open)
  }

  close(): void {
    this.setOpen(false)
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this._listeners) {
      try {
        listener()
      } catch {}
    }
  }
}

function isStore(value: unknown): value is GitRosterStore {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[STORE_BRAND] === true
}

export function getGitRosterStore(): GitRosterStore {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[STORE_GLOBAL_KEY]
  if (isStore(existing)) return existing
  const created = new GitRosterStore()
  g[STORE_GLOBAL_KEY] = created
  return created
}
