/**
 * dsh-chat-plus — 全屏浮层的滚动锁（引用计数 + 兜底还原）。
 *
 * ## 为什么需要引用计数
 *
 * 对话流里可能同时存在多张卡片（iu 与 html 混排），各自都可能开全屏。若各自
 * 直接写 `body.style.overflow`，先关的那个会把后开的那个的锁一起放开——背景
 * 滚动在浮层还开着的时候就恢复了。计数保证「最后一个关掉才真正解锁」。
 *
 * ## 为什么需要兜底还原
 *
 * 曾经的事故（实测踩中）：卡片随消息重渲染被卸载，cleanup 没跑到 / 或全屏态
 * 被错误地从 localStorage 恢复，body 就**永久停在 overflow:hidden** ——
 * 用户看到的是「整个对话流滚不动」，而且完全找不到原因（没有报错、界面正常）。
 *
 * 这里做两件事防它：
 *  1. 记录「加锁前的原始值」，解锁时还原成那个值而不是硬写空串（尊重宿主可能
 *     自己设过的 overflow）；
 *  2. 提供 `releaseAllScrollLocks()`，在插件卸载 / 页面卸载时强制清零 ——
 *     任何路径漏掉 cleanup 都能被这条兜住。
 */

/** 当前加锁的浮层数量。 */
let lockCount = 0

/** 首次加锁前的原始 overflow（还原用；只记第一笔，避免多次加锁互相覆盖）。 */
let originalOverflow: string | null = null

/** 是否已经挂上兜底监听（只挂一次）。 */
let fallbackBound = false

/**
 * 兜底：页面卸载前强制解锁。
 *
 * `pagehide` 覆盖刷新 / 关闭 / bfcache 三种离开路径，比 `beforeunload` 更全。
 */
function bindFallback(): void {
  if (fallbackBound) return
  if (typeof window === 'undefined') return
  fallbackBound = true
  const release = (): void => { releaseAllScrollLocks() }
  try {
    window.addEventListener('pagehide', release)
    window.addEventListener('unload', release)
  } catch {
    // 极端环境下 addEventListener 可能不可用；不影响主路径。
  }
}

/**
 * 锁住背景滚动（全屏浮层打开时调用）。
 *
 * @returns 释放函数（幂等：重复调用只生效一次）。
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {}
  bindFallback()
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    unlockBodyScroll()
  }
}

/** 释放一把锁。 */
function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow ?? ''
    originalOverflow = null
  }
}

/**
 * 强制解锁（插件卸载 / 页面离开时的兜底）。
 *
 * 刻意无视计数直接清零：走到这里说明「没人再管这些锁了」，宁可多放一次
 * 也不能让 body 卡在 overflow:hidden。
 */
export function releaseAllScrollLocks(): void {
  if (typeof document === 'undefined') return
  lockCount = 0
  if (originalOverflow !== null) {
    document.body.style.overflow = originalOverflow
    originalOverflow = null
  } else {
    // 没记过原始值（异常路径）：直接清空，回到浏览器默认。
    document.body.style.overflow = ''
  }
}
