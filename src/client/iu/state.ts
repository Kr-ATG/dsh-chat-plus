/**
 * dsh-chat-plus — iu 卡片本地状态的持久化（client 半身专用）。
 *
 * ## 为什么要有这一层
 *
 * 卡片状态原先全在组件 useState 里：勾完的清单刷新页面就归零、拖好的滑块
 * 切个会话再回来也回到初始值。用户视角这是「我操作过的东西丢了」。
 *
 * 走 localStorage（与本插件其它纯客户端偏好一致，先例 `dsh.kr_chat.panel_width`）：
 * 刷新即生效、不需要重启 DSH、与 host 无关。
 *
 * ## key 怎么来
 *
 * 卡片没有稳定 id（同一条消息重渲染、同一份围栏在多处出现都可能），所以用
 * **围栏正文的哈希**当身份：内容一样就是同一张卡，内容变了就是新卡（不会把
 * 旧状态错套到新数据上）。会话维度用不到——同一段 JSON 在哪个会话里语义都一样。
 *
 * ## 三条硬约束
 *
 *  1. **写失败必须静默**：隐私模式 / 配额满 / storage 被禁都会抛，卡片功能
 *     不能因为存不下就挂掉（catch 后只当没存过）。
 *  2. **读出来必须再过一遍 initState 的形状校验**：localStorage 里可能是任何
 *     旧版本写的脏数据，直接展开进 state 会让组件拿到意外字段。
 *  3. **要有总量上限**：一张卡一条记录，长会话能攒几百条。超出时按写入时间
 *     淘汰最旧的（LRU），不能无限增长把配额吃满。
 */

/** localStorage 键前缀（带版本号：状态形状变更时整代作废，比逐字段迁移便宜）。 */
const KEY_PREFIX = 'dsh.iu.state.v1.'

/** 最多保留多少张卡的状态（超出按 LRU 淘汰）。 */
const MAX_ENTRIES = 200

/** 一条持久化记录。 */
interface Entry {
  /** 状态本体。 */
  readonly s: Record<string, unknown>
  /** 最后写入时间（LRU 用）。 */
  readonly t: number
}

/** storage 不可用时（SSR / 隐私模式）一律走这个空实现。 */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    // 有些浏览器访问 localStorage 本身就抛（禁用了 cookie）。
    const probe = '__dsh_iu_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return null
  }
}

/**
 * 围栏正文 → 稳定短哈希（FNV-1a 32 位，转 36 进制）。
 *
 * 不追求密码学强度，只要「内容不同 → key 不同」的碰撞概率足够低。
 * 32 位空间在几百张卡的量级上碰撞概率可忽略，且碰撞后果只是两张卡共用状态
 * （不会崩、不会丢数据）。
 */
export function iuStateKey(body: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < body.length; i += 1) {
    h ^= body.charCodeAt(i)
    // h *= 16777619，拆成位运算避免 32 位溢出后精度丢失。
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(36)
}

/** 读状态：没有 / 脏数据 / storage 不可用一律返回 undefined（调用方用 initState）。 */
export function readIuState(key: string): Record<string, unknown> | undefined {
  const store = storage()
  if (store === null) return undefined
  try {
    const raw = store.getItem(KEY_PREFIX + key)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Entry | null
    if (parsed === null || typeof parsed !== 'object') return undefined
    const state = (parsed as Entry).s
    if (state === null || typeof state !== 'object' || Array.isArray(state)) return undefined
    return state as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** 按 LRU 淘汰超额记录（只在写入时跑，读路径不做整理）。 */
function evict(store: Storage): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i)
      if (k !== null && k.startsWith(KEY_PREFIX)) keys.push(k)
    }
    if (keys.length <= MAX_ENTRIES) return
    const aged = keys
      .map((k) => {
        let t = 0
        try { t = (JSON.parse(store.getItem(k) ?? 'null') as Entry | null)?.t ?? 0 } catch { t = 0 }
        return { k, t }
      })
      .sort((a, b) => a.t - b.t)
    for (const { k } of aged.slice(0, keys.length - MAX_ENTRIES)) store.removeItem(k)
  } catch { /* 淘汰失败不影响写入 */ }
}

/** 写状态：静默失败，节流由调用方负责（拖动时高频写会拖慢主线程）。 */
export function writeIuState(key: string, state: Record<string, unknown>): void {
  const store = storage()
  if (store === null) return
  try {
    const entry: Entry = { s: state, t: Date.now() }
    store.setItem(KEY_PREFIX + key, JSON.stringify(entry))
    evict(store)
  } catch { /* 配额满 / 只读：只当没存过 */ }
}

/** 清空全部 iu 状态（设置面板「重置卡片状态」用）。 */
export function clearIuStates(): number {
  const store = storage()
  if (store === null) return 0
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i)
      if (k !== null && k.startsWith(KEY_PREFIX)) keys.push(k)
    }
    for (const k of keys) store.removeItem(k)
    return keys.length
  } catch {
    return 0
  }
}

/** 当前存了多少张卡的状态（诊断用）。 */
export function countIuStates(): number {
  const store = storage()
  if (store === null) return 0
  try {
    let n = 0
    for (let i = 0; i < store.length; i += 1) {
      if (store.key(i)?.startsWith(KEY_PREFIX) === true) n += 1
    }
    return n
  } catch {
    return 0
  }
}
