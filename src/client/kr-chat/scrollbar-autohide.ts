/**
 * dsh-chat-plus — 对话流 / 右栏滚动条自动隐藏（2026-10-29）。
 *
 * 用户要求：对话流那根常驻的灰色滚动条，停止滚动 3 秒后自动隐藏。
 *
 * 覆盖两个容器：
 *   · [data-conversation-scroll] —— 官方对话流滚动区；
 *   · .kr-panel__scroll         —— Seeker 右侧大盘的卡片滚动区。
 * 做法是给容器挂两个属性：
 *   · data-scrollbar-autohide      —— 只对被接管的容器生效，不污染其它滚动区；
 *   · data-scrollbar-active="true" —— 滚动 / 滚轮 / 指针按下时点亮，3 秒后摘掉。
 * 颜色切换在 styles.ts 的「对话流滚动条」段：thumb 从 transparent 切回 token 色。
 *
 * 为什么用 JS 计时：CSS 没有「滚动停止后延迟」的通用能力。两个容器各一份
 * 监听 + 一个定时器；右栏其它自绘滚动区仍走纯 CSS（hover 提亮），不受影响。
 *
 * 槽位不隐藏：官方 .scrollBody 有 scrollbar-gutter: stable，右栏滚动条是
 * 6px 宽的常驻槽；这里只切 thumb 颜色，内容宽度不会因为滚动条显隐而跳动。
 *
 * 生命周期：会话切换 / 视图重建会把容器节点整个换掉，所以每 500ms 做一次
 * 对账 —— 新节点挂上、消失的节点清理，和 scroll-guard 的重挂策略一致。
 */

/** 停止滚动后多久隐藏（ms）。 */
export const SCROLLBAR_HIDE_DELAY_MS = 3000

/** 需要自动隐藏滚动条的容器。 */
export const SCROLLBAR_TARGET_SELECTORS = [
  '[data-conversation-scroll]',
  '.kr-panel__scroll',
] as const

/** 掉线重挂检查间隔（ms）。 */
const WATCH_INTERVAL_MS = 500

/**
 * 在当前对话流 / 右栏滚动容器上安装自动隐藏。
 * @returns 卸载函数（交给 ctx.effect / useEffect 回收）。
 */
export function installConversationScrollbarAutoHide(): () => void {
  const bound = new Map<HTMLElement, () => void>()
  let disposed = false
  let watcher = 0

  const bind = (scroller: HTMLElement): (() => void) => {
    let timer = 0
    scroller.setAttribute('data-scrollbar-autohide', '')
    scroller.removeAttribute('data-scrollbar-active')

    const reveal = (): void => {
      scroller.setAttribute('data-scrollbar-active', 'true')
      if (timer !== 0) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        scroller.removeAttribute('data-scrollbar-active')
      }, SCROLLBAR_HIDE_DELAY_MS)
    }

    /*
     * scroll 覆盖滚轮 / 键盘 / 拖拽滚动条；wheel 让「刚碰到滚轮」就亮，不必
     * 等到第一帧位移；pointerdown 覆盖按住滚动条但还没产生位移的瞬间。
     * 三个监听都是 passive / 捕获，不与官方滚动逻辑抢事件。
     */
    scroller.addEventListener('scroll', reveal, { passive: true })
    scroller.addEventListener('wheel', reveal, { passive: true })
    scroller.addEventListener('pointerdown', reveal, true)

    return () => {
      if (timer !== 0) window.clearTimeout(timer)
      scroller.removeEventListener('scroll', reveal)
      scroller.removeEventListener('wheel', reveal)
      scroller.removeEventListener('pointerdown', reveal, true)
      scroller.removeAttribute('data-scrollbar-autohide')
      scroller.removeAttribute('data-scrollbar-active')
    }
  }

  const sync = (): void => {
    if (disposed) return
    const current = new Set<HTMLElement>()
    for (const selector of SCROLLBAR_TARGET_SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => {
        if (node !== null) current.add(node as HTMLElement)
      })
    }
    for (const [node, dispose] of [...bound]) {
      if (!current.has(node)) {
        dispose()
        bound.delete(node)
      }
    }
    for (const node of current) {
      if (!bound.has(node)) bound.set(node, bind(node))
    }
    watcher = window.setTimeout(sync, WATCH_INTERVAL_MS)
  }

  sync()

  return () => {
    disposed = true
    if (watcher !== 0) window.clearTimeout(watcher)
    for (const dispose of bound.values()) dispose()
    bound.clear()
  }
}
