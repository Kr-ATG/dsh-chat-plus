/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 壳子顶栏热区让位（客户端上报器）。
 *
 * 背景：电子壳子（D:\AI\Dsh\.shell-src）顶部中间有一条 300×28 的隐形拖拽带
 * （#drag-strip，-webkit-app-region:drag，z-index 99998，压在 WebUI iframe
 * 之上）。胶囊停靠在顶部时，落在拖拽带矩形内的上半段点击/悬停会被壳层
 * 吞掉——表现为「胶囊点不到、悬停面板展不开」。
 *
 * 方案：本模块跟踪光标与胶囊外壳（.dsh-done-pill-shell）的实时矩形，把
 * 热区状态 {over, rects} POST 给本插件 host 半身（/api/dsh-done-pill/shell-hot）；
 * host 经壳子 CDP 把状态注入壳页面，壳页面据此让拖拽带在胶囊矩形处
 * 穿透（pointer-events:none），光标离开/胶囊移开自动恢复。全程不改壳子
 * 文件、不碰 DSH 源码；壳子未运行（纯浏览器访问 WebUI）时自动降级。
 *
 * 坐标系：壳子窗口与 WebUI iframe 视口 1:1（iframe inset:0 铺满窗口），
 * 页面 client 坐标即壳页面坐标，无需换算。
 */

import { featureEnabledNow, onFeatureChange } from '../features/gate.tsx'

/** 胶囊外壳矩形（页面视口坐标）。 */
export interface HotRect {
  x: number
  y: number
  w: number
  h: number
}

/** host 路由：胶囊热区状态上报。 */
const HOT_ROUTE = '/api/dsh-done-pill/shell-hot'
/** 矩形轮询周期：捕捉宽度形变/拖拽下光标静止时的布局变化。 */
const RECT_POLL_MS = 200
/** host/壳子不可达时的冷却（纯浏览器访问 WebUI、壳子重启窗口期）。 */
const COOLDOWN_MS = 5000
/** 拖拽带纵向范围（与壳子 topbar.css 的 #drag-strip 一致：高 28px）。 */
const STRIP_H = 28

/**
 * 启动壳子热区上报（受「对话完成胶囊」总开关控制）。返回停止函数。
 *
 * 关闭总开关时连 200ms 的 DOM 轮询也一起停：胶囊本来就不存在，上报器继续跑
 * 只是每秒 5 次空转。打开时重新启动，下一次 tick 就会把胶囊矩形报上去。
 */
export function startShellHotReporter(): () => void {
  let stopRaw: (() => void) | null = null
  const sync = (enabled: boolean): void => {
    if (enabled) {
      if (stopRaw === null) stopRaw = startShellHotReporterRaw()
    } else {
      stopRaw?.()
      stopRaw = null
    }
  }
  sync(featureEnabledNow('view.done-pill'))
  const off = onFeatureChange('view.done-pill', sync)
  return () => {
    off()
    stopRaw?.()
    stopRaw = null
  }
}

/**
 * 原始上报器实现（不带总开关判断）。
 *
 * 胶囊被关闭（设置开关）时元素不存在，自动上报空状态 → 壳页面恢复拖拽带。
 */
function startShellHotReporterRaw(): () => void {
  let stopped = false
  let lastCursor: { x: number; y: number } | null = null
  let lastPost: string | null = null
  let coolingUntil = 0

  /** 胶囊外壳当前矩形；胶囊未挂载/隐藏时为 null。 */
  function shellRect(): HotRect | null {
    const el = document.querySelector('.dsh-done-pill-shell')
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
  }

  async function post(state: { over: boolean; rects: HotRect[] }): Promise<void> {
    if (Date.now() < coolingUntil) return
    try {
      const res = await fetch(HOT_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
      if (!res.ok) throw new Error(`http ${res.status}`)
      coolingUntil = 0
    } catch {
      // host 不可达 / 壳子不在：冷却后自愈重试，对胶囊本身零影响。
      coolingUntil = Date.now() + COOLDOWN_MS
    }
  }

  /** 计算当前热区状态；与上次上报不同才发（状态驱动，不随 mousemove 刷屏）。 */
  function tick(): void {
    if (stopped) return
    const rect = shellRect()
    let over = false
    if (rect !== null && lastCursor !== null) {
      over = lastCursor.x >= rect.x && lastCursor.x < rect.x + rect.w
        && lastCursor.y >= rect.y && lastCursor.y < rect.y + rect.h
    }
    // 胶囊与拖拽带纵向重叠（贴顶停靠）时也上报矩形：壳页面用它按光标
    // 命中做兜底判断（光标从壳层一侧进入的场景）。
    const overlapStrip = rect !== null && rect.y < STRIP_H && rect.y + rect.h > 0
    const rects = rect !== null && (over || overlapStrip) ? [rect] : []
    const next = JSON.stringify({ over, rects })
    if (next === lastPost) return
    lastPost = next
    void post({ over, rects })
  }

  function onMouseMove(event: MouseEvent): void {
    lastCursor = { x: event.clientX, y: event.clientY }
    tick()
  }

  function onMouseLeave(): void {
    lastCursor = null
    tick()
  }

  document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true })
  document.addEventListener('mouseleave', onMouseLeave, { capture: true, passive: true })
  const timer = window.setInterval(tick, RECT_POLL_MS)

  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('mousemove', onMouseMove, { capture: true } as EventListenerOptions)
    document.removeEventListener('mouseleave', onMouseLeave, { capture: true } as EventListenerOptions)
    // 曾上报过非空状态 → 补发空状态，壳页面立即恢复拖拽带常态。
    const cleared = JSON.stringify({ over: false, rects: [] })
    if (lastPost !== null && lastPost !== cleared) void post({ over: false, rects: [] })
    lastPost = cleared
  }
}
