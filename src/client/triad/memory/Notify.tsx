/**
 * dsh-memory 变更通知：未读状态的读写原语。
 *
 * 未读状态存 localStorage（已读 change id 集合）。原先这里还有一套「入口
 * 角标」设施（`useUnreadChanges` 的 60s 轮询 + badge 显隐偏好 + 跨根订阅），
 * 2026-10-04 入口改成官方 `sidebar.panellist` 菜单行后整套删掉：官方菜单行
 * 只渲染「图标 + 文案」，没有角标位，那套轮询与偏好开关都没有消费方了。
 * 页面自己（记忆工作台）用下面的原语做「有未读就直达变更 Tab」。
 */

/** localStorage key（未读集合）。 */
const READ_KEY = 'dsh-memory:read'

/**
 * 已读 id 上限：change id 只增不减，无上限会让这条 localStorage 记录
 * 无界增长（每天几十条，一年上万个 id）。只保留最近 N 个——更早的变更
 * 早已滚出当日窗口，不会再被算进未读。
 */
const READ_ID_CAP = 800

/** 读取已读 id 集合。 */
export function readIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (raw === null) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

/** 写回已读 id 集合（保留最近 READ_ID_CAP 个）。 */
function writeIds(ids: Set<string>): void {
  try {
    const list = [...ids]
    localStorage.setItem(READ_KEY, JSON.stringify(list.slice(Math.max(0, list.length - READ_ID_CAP))))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级。
  }
}

/** 把一批 change id 标记为已读。 */
export function markReadIds(ids: readonly string[]): void {
  if (ids.length === 0) return
  const next = new Set(readIds())
  for (const id of ids) next.add(id)
  writeIds(next)
}
