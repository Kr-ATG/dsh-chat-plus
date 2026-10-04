/**
 * dsh-chat-plus — 对话滚动位置守卫（KR 视图常驻）。
 *
 * 修「滚到上面读旧内容，点一下右栏（或回合收口）就被拽回底部」。
 *
 * 根因在官方对话视图的跟随控制器（dsh-client-ui-chat 的 useChatReading /
 * ChatViewport，源码不可改）：内容提交、布局变化（思考卡收拢、右栏开合
 * resize、Lightbox portal 卸载）都会让它重新评估 followingTail，某些提交点
 * 会把不贴底的读者一把拉回 floor。官方自己的 preserve 机制只服务历史分页
 * （paging），不覆盖这些路径。
 *
 * 守卫是一个 rAF 状态机，只对抗**一种**形态：读者停在上方（离底 ≥24px）时，
 * 滚动位置在**没有用户意图**的前提下离开原位、并在 900ms 内落到贴底 —— 这正是
 * 官方跟随拽人的指纹（瞬时或短动画、无 wheel/键/拖拽事件）。其余一律放行：
 *
 *  · wheel / 滚动键 / 滚动区 pointerdown 打开 400ms 意图窗口，窗口内只重定基线
 *    不干预（用户自己滚到底是期望行为）；
 *  · 读者本来就在底部：不装状态（following 是期望）；
 *  · 离开→回落→再离开的慢速漂移：900ms 窗口外只重定基线；
 *  · 回滚次数封顶 12 次：真出现持续对抗（说明跟随是此刻的真实意图）就永久
 *    让位，绝不和官方控制器死磕。
 *
 * 回滚用瞬时赋值（scrollTop=）而不是 smooth：对抗窗口内 smooth 会被控制器的
 * 下一次写入打断，瞬时写才能赢；读者视觉上是「没跳」而不是「跳了又滚回来」。
 */

/** 触发「用户意图窗口」的滚动键。 */
const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ',
])

/** 离底阈值（px）：小于它视为贴底。 */
const AT_BOTTOM = 24
/** 单帧/短动画判定窗口（ms）：离开原位到贴底超过它就不算「被拽」。 */
const JUMP_WINDOW_MS = 900
/** 用户意图窗口（ms）。 */
const INTENT_MS = 400
/** 回滚次数封顶。 */
const MAX_RESTORES = 12
/** 离开原位的最小位移（px）：小于它视为抖动。 */
const LEAVE_EPS = 60

type GuardState = 'up' | 'leaving' | 'bottom'

/**
 * 在 [data-conversation-scroll] 上装守卫。
 * @returns 卸载函数（交给 ctx.effect / useEffect 回收）。
 */
export function installConversationScrollGuard(): () => void {
  let dispose: (() => void) | null = null
  let disposed = false
  let retries = 0
  let timer = 0

  const attach = (): void => {
    if (disposed || dispose !== null) return
    const scroller = document.querySelector('[data-conversation-scroll]') as HTMLElement | null
    // 会话视图还没挂载（首帧 / 切视图途中）：短重试，别把守卫静默丢掉。
    if (scroller === null) {
      if (retries >= 8) return
      retries += 1
      timer = window.setTimeout(attach, 250)
      return
    }
    dispose = attachGuard(scroller)
  }
  attach()
  return () => {
    disposed = true
    if (timer !== 0) window.clearTimeout(timer)
    dispose?.()
  }
}

function attachGuard(scroller: HTMLElement): () => void {

  let state: GuardState = 'up'
  let before = scroller.scrollTop
  let leftUpAt = 0
  let userIntentUntil = 0
  let restores = 0
  let raf = 0
  let done = false

  const markIntent = (): void => { userIntentUntil = performance.now() + INTENT_MS }
  const onWheel = (event: WheelEvent): void => { if (event.deltaY !== 0) markIntent() }
  const onKey = (event: KeyboardEvent): void => { if (SCROLL_KEYS.has(event.key)) markIntent() }
  const onPointer = (event: PointerEvent): void => {
    const target = event.target as Element | null
    if (target !== null && typeof target.closest === 'function' && target.closest('[data-conversation-scroll]') !== null) markIntent()
  }
  scroller.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('keydown', onKey, true)
  scroller.addEventListener('pointerdown', onPointer, true)

  const tick = (): void => {
    if (done) return
    const now = performance.now()
    const floor = scroller.scrollHeight - scroller.clientHeight
    let current = scroller.scrollTop

    if (now < userIntentUntil || restores >= MAX_RESTORES) {
      // 意图窗口 / 已让位：只重定基线，不干预。
      before = current
      state = floor - current < AT_BOTTOM ? 'bottom' : 'up'
    } else if (state === 'up') {
      if (floor - current < AT_BOTTOM) {
        // 单帧落底。用户自己滚到底必然带意图事件（wheel / 键 / 拖滚动条的
        // pointerdown），意图窗口在最上面的分支已经把基线重置掉了 —— 走到这里
        // 的「无意图 + 单帧落底 + 离原位超过 eps」就是官方跟随拽人的指纹，
        // 直接回滚。位移很小（< eps）说明读者本来就停在底部附近，认作 bottom。
        if (Math.abs(current - before) > LEAVE_EPS && restores < MAX_RESTORES) {
          restores += 1
          scroller.scrollTop = before
          current = before
        } else {
          state = 'bottom'
          before = current
        }
      } else if (Math.abs(current - before) > LEAVE_EPS) {
        state = 'leaving'
        leftUpAt = now
      }
    } else if (state === 'leaving') {
      if (floor - current < 8 && now - leftUpAt <= JUMP_WINDOW_MS) {
        // 官方跟随的指纹：无意图、短窗口内从上方落到贴底。瞬时回滚。
        restores += 1
        scroller.scrollTop = before
        current = before
        state = 'up'
      } else if (now - leftUpAt > JUMP_WINDOW_MS) {
        before = current
        state = floor - current < AT_BOTTOM ? 'bottom' : 'up'
      } else if (Math.abs(current - before) <= LEAVE_EPS) {
        state = 'up'
      }
    } else { // bottom
      if (floor - current >= AT_BOTTOM) {
        state = 'up'
        before = current
      }
    }

    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return () => {
    done = true
    cancelAnimationFrame(raf)
    scroller.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKey, true)
    scroller.removeEventListener('pointerdown', onPointer)
  }
}
