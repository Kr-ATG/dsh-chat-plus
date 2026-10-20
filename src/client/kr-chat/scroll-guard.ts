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
 *
 * ## 2026-10-20 修正：两处判据漏洞（用户报「出现 html / iu 卡片后鼠标滚不动」）
 *
 * 漏洞一 —— **iframe 里的滚轮不会冒泡到宿主**。html 卡片是一张 opaque origin 的
 * iframe，鼠标停在它上面滚轮时，wheel 事件在 iframe 自己的文档里派发完就结束，
 * 宿主文档（包括 [data-conversation-scroll]）**一个 wheel 事件都收不到**（实测
 * 宿主侧 wheel 计数恒为 0，但对话流照样在滚）。于是意图窗口永远打不开，只要这一
 * 次滚动把读者从上方一次性带到底部（一格滚轮 100~120px，离底 60px 时就会发生），
 * 就会被当成「官方跟随拽人」回滚 —— 用户看到的就是「鼠标停在卡片上滚不动 / 一滚
 * 就被弹回去」。
 *   两条修法同时上：
 *     · 本文件把「无意图」的判据从「没有 wheel 事件」改成「不像用户在滚」——
 *       连续滚动串判据（见 looksUserDriven / SLOPE_MAX / STREAK_WINDOW_MS）：
 *       用户滚动是一串相邻小步，官方跟随拽人是孤立的一次瞬移。这条不依赖事件
 *       能否到达宿主，所以 iframe / 图片 / video 等一切吞掉滚轮的载体都被覆盖，
 *       是主修。
 *     · iframe 内的 wheel / pointerdown 经 postMessage 上报宿主，调
 *       noteConversationScrollIntent() 打开意图窗口（见 html-embed/bridge.ts），
 *       把缺口正面补上，是第二道保险。
 *
 * 漏洞二 —— **守卫只 attach 一次**。原实现拿到 scroller 就再不管了，而会话切换 /
 * 视图重建会把 [data-conversation-scroll] 整个换掉，守卫还挂在已脱离文档的旧节点
 * 上：新对话流的滚动完全不受保护，同时旧节点上的 rAF 还在空转。现在每帧检查
 * 连接状态，掉线就重新挂到当前节点。
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
/**
 * 单帧位移斜率上限（px/帧）：超过它的跳变才可能是「官方跟随拽人」。
 *
 * 为什么需要（2026-10-20，用户报「出现 html / iu 卡片后鼠标滚不动」）：
 * 判断「无意图落底」时，原实现只看**总位移 > LEAVE_EPS(60)**。而一格滚轮在
 * 触控板/滚轮上常常一次走 100~120px，读者离底 60~130px 时**一格就落底** ——
 * 位移过闸、意图事件又因为鼠标停在 iframe 上而根本没到宿主，于是自己滚到底
 * 被当成官方拽人回滚。用户看到的就是「一滚就被弹回去」。
 *
 * 真正的官方跟随拽人是**一帧内瞬移**（scrollTop 被直接赋值或 20ms 内补间），
 * 一帧最多 60fps → 单帧位移通常 ≥ 数百 px；而用户滚轮即使连续两帧派发，
 * 每帧也只有半格（50~60px）。取 220px 作分界：正常滚轮（含惯性甩动的高频
 * 小步）全部落在闸门内，一帧瞬移必然超过。
 *
 * ⚠ 这是**主修**：它不依赖任何事件能否到达宿主，所以 iframe、图片、video、
 * 第三方嵌入等一切「滚轮事件被吞掉」的载体都被这一条覆盖。
 */
const SLOPE_MAX = 220

/**
 * 「连续滚动串」的间隔窗口（ms）。
 *
 * 相邻两帧都在这个窗口内、且位移都不超过 SLOPE_MAX，就算同一段用户滚动。
 * 60fps 下相邻帧间隔 16ms；主线程忙时 rAF 会掉到 50~100ms，取 120ms 兜住
 * 掉帧但又不至于把「隔了半秒又蹦一下」算成连续。
 */
const STREAK_WINDOW_MS = 120

type GuardState = 'up' | 'leaving' | 'bottom'

/**
 * 跨模块的用户滚动意图登记（monotonic 时间戳）。
 *
 * html 卡片的滚轮发生在沙箱 iframe 内部，事件不会冒泡到宿主文档（实测宿主侧
 * wheel 计数恒为 0）。iframe 侧的 bridge 检测到 wheel / pointerdown 后通过
 * postMessage 上报，宿主在这里登记一次，守卫据此打开意图窗口 —— 这是把
 * 「鼠标停在卡片上滚动」和「官方偷偷拽人」区分开的第二道保险。
 *
 * 用模块级变量而不是闭包：守卫可能因为会话切换被重挂（见漏洞二），登记表
 * 必须跨挂载存活。
 */
let externalIntentUntil = 0

/**
 * 登记一次来自非宿主 DOM 的滚动意图（html 卡片 iframe 内）。
 *
 * 刻意只接受「刚刚发生」的调用：宿主侧校验 postMessage 来源窗口之后才调，
 * 页面里模型代码伪造不了（它拿不到宿主窗口引用）。
 */
export function noteConversationScrollIntent(): void {
  externalIntentUntil = performance.now() + INTENT_MS
}

/**
 * 在 [data-conversation-scroll] 上装守卫。
 * @returns 卸载函数（交给 ctx.effect / useEffect 回收）。
 */
export function installConversationScrollGuard(): () => void {
  let dispose: (() => void) | null = null
  let attached: HTMLElement | null = null
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
    attached = scroller
    dispose = attachGuard(scroller)
  }

  /*
   * 掉线重挂（漏洞二）：会话切换 / 视图重建会把 [data-conversation-scroll]
   * 整个换掉，守卫原来挂在脱离文档的旧节点上，新对话流完全失去保护。
   * 每 500ms 看一次：已挂的节点不在文档里、或者当前节点换了，就重新挂。
   * 用轮询而不是 MutationObserver：视图重建的形态（局部替换 / 整棵重挂）太多，
   * 观察 body 的 subtree 变化在流式输出时回调极密，代价远高于一次 500ms 查询。
   */
  const watch = (): void => {
    if (disposed) return
    const current = document.querySelector('[data-conversation-scroll]') as HTMLElement | null
    if (current !== null && current !== attached) {
      dispose?.()
      dispose = null
      attached = current
      dispose = attachGuard(current)
    }
    timer = window.setTimeout(watch, 500)
  }

  attach()
  if (dispose !== null) timer = window.setTimeout(watch, 500)

  return () => {
    disposed = true
    if (timer !== 0) window.clearTimeout(timer)
    dispose?.()
    dispose = null
    attached = null
  }
}

function attachGuard(scroller: HTMLElement): () => void {

  let state: GuardState = 'up'
  /** 「离开顶部」时的基线位置：回滚目标。 */
  let before = scroller.scrollTop
  /** 上一帧的 scrollTop（斜率统计用）。 */
  let lastTop = scroller.scrollTop
  /**
   * 当前这段连续滚动的累计位移与已用时间。
   *
   * 为什么需要累计而不是只看单帧：触控板惯性甩动会在 200~300ms 内派出十几到
   * 几十个小 delta，单帧全部落在 SLOPE_MAX 以内，但它合起来能一口气滚过一整
   * 屏。只看单帧会把「一路滚到底」的中间帧当成平滑、把落底那一帧当成…其实
   * 也还是平滑 —— 单帧判据已经够了。累计窗口只是给「单帧很大但明显是用户甩的」
   * 留出可能：真出现这种帧时，只要**这之前**有连续多帧的小步滚动，就认作用户。
   */
  let streakStart = 0
  let streakDistance = 0
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

  /**
   * 这次位移像不像「用户自己滚的」。
   *
   * 判据是**连续滚动串**（STREAK_WINDOW_MS 内相邻帧）：用户滚动是一串小步，
   * 哪怕中间某帧因为合并了多个 wheel 事件而偏大，前后也总有相邻的小步；官方
   * 跟随拽人是**孤立的一次瞬移** —— 前后帧纹丝不动。
   *
   * 这样比「只看单帧阈值」稳：既不会把真拽人放过去（孤立大跳照旧拦），也不会
   * 因为一格滚轮恰好 130px 就误拦（那帧通常还有相邻帧，或者本身 < SLOPE_MAX）。
   */
  const looksUserDriven = (step: number, now: number): boolean => {
    const gap = now - streakStart
    if (step <= SLOPE_MAX) {
      // 平滑小步：计入当前滚动串。
      if (streakStart === 0 || gap > STREAK_WINDOW_MS) {
        streakStart = now
        streakDistance = step
      } else {
        streakDistance += step
      }
      return true
    }
    /*
     * 大跳。只有当它前面紧挨着一串小步（说明用户正处在连续滚动中，这一帧是
     * 事件合并 / 主线程卡顿后的补帧）才认作用户；否则就是孤立瞬移。
     */
    const continuous = streakStart !== 0 && gap <= STREAK_WINDOW_MS
    return continuous && streakDistance >= step * 0.5
  }

  const tick = (): void => {
    if (done) return
    const now = performance.now()
    const floor = scroller.scrollHeight - scroller.clientHeight
    let current = scroller.scrollTop
    const step = Math.abs(current - lastTop)
    lastTop = current
    const userDriven = step === 0 ? true : looksUserDriven(step, now)

    const intent = now < userIntentUntil || now < externalIntentUntil

    if (intent || restores >= MAX_RESTORES) {
      // 意图窗口（宿主 wheel / 键 / 拖拽，或 iframe 内上报）/ 已让位：只重定基线。
      before = current
      state = floor - current < AT_BOTTOM ? 'bottom' : 'up'
    } else if (state === 'up') {
      if (floor - current < AT_BOTTOM) {
        /*
         * 落底了。两个条件都满足才算官方拽人：
         *  ① 离原位超过 LEAVE_EPS —— 不是本来就停在底部附近；
         *  ② 这次位移不像用户滚的 —— 见 looksUserDriven。
         * 满足就瞬时回滚；否则认作 bottom（用户自己滚到底）。
         */
        if (Math.abs(current - before) > LEAVE_EPS && !userDriven && restores < MAX_RESTORES) {
          restores += 1
          scroller.scrollTop = before
          current = before
          lastTop = before
          streakStart = 0
          streakDistance = 0
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
        // 上方 → 短窗口内贴底。同样是「不像用户滚的才算拽」。
        if (!userDriven) {
          restores += 1
          scroller.scrollTop = before
          current = before
          lastTop = before
          streakStart = 0
          streakDistance = 0
          state = 'up'
        } else {
          state = 'bottom'
          before = current
        }
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
