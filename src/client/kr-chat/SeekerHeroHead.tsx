/**
 * dsh-chat-plus — 新对话页（空白 Hero 态）顶部的 Seeker 卡头。
 *
 * ## 它解决什么
 *
 * 2026-10-25 用户要求：「新对话页面的上面放上我们这个东西」—— 附图是操作面板卡头
 * 那张（鲸鱼娘 + Seeker + 状态 + 右上角齿轮/邮箱）。空白新会话里右侧大盘整体不
 * 显示（没内容可看），于是这张卡头也跟着消失，用户在新对话页看不到她。
 *
 * ## 为什么不复用整个大盘
 *
 * 大盘里是四张卡（子智能体 / 操作面板 / 任务概览 / 产出物），空白会话里它们全是
 * 空的。只把**卡头**搬到新对话页顶部，是"她在这儿"的最小表达；把整块大盘搬过去
 * 只会得到四张空卡。
 *
 * ## 挂在哪
 *
 * 挂进官方 Hero 区的容器（`[class*="hero"]` 的父级）里，作为它的**前一个兄弟**
 * —— 这样它出现在「探索未至之境」标题与输入框之上，而不会挤进 Hero 自己的布局。
 *
 * 空白会话结束后（发出第一条消息）这块自动摘掉，卡头回到右栏操作面板里（同一个
 * SeekerHead 组件，所以两处永远长得一样）。
 *
 * @module
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SeekerHead } from './SeekerHead.tsx'
import { getBrowserFlagEntry, subscribeBrowserFlag } from '../browser-flag/store.ts'
import { latestChatSessionId } from '../tool-summary/TurnProcessShadowView.tsx'
import { getPanelSettingsStore } from './panel-settings-store.ts'
import { getMailDrawerStore } from './mail-drawer-store.ts'

/** 容器 id（幂等复用 + 冒烟断言）。 */
export const HERO_HEAD_ID = 'dsh-seeker-hero-head'

/** 空闲文案：新对话页没有「本轮」，永远用空闲那几句（按钟点选）。 */
const IDLE_SLOTS: ReadonlyArray<readonly [number, number, string]> = [
  [0, 5, '休息中'],
  [5, 9, '晒太阳'],
  [9, 11, '小憩中'],
  [11, 13, '吃饭中'],
  [13, 17, '晒太阳'],
  [17, 19, '小憩中'],
  [19, 24, '休息中'],
]

/** 按当前时间挑一句空闲文案（与 KrPlainTimelineCard 的时段表逐字一致）。 */
function idlePhraseFor(now: Date): string {
  const hour = now.getHours()
  for (const slot of IDLE_SLOTS) {
    if (hour >= slot[0] && hour < slot[1]) return slot[2]
  }
  return '休息中'
}

/**
 * 新对话页的卡头内容。
 *
 * 只订阅三样：浏览器标志（可能正在操作浏览器）、齿轮/邮箱开合（按钮要亮）、
 * 一分钟时钟（空闲文案跨时段要换）。没有"当前动作"——新对话还没有动作。
 */
function SeekerHeroHead(): ReactElement {
  const [clockTick, setClockTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setClockTick(Date.now()) }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [])

  const browserEntry = useSyncExternalStore(
    subscribeBrowserFlag,
    () => getBrowserFlagEntry(latestChatSessionId ?? undefined),
    () => getBrowserFlagEntry(latestChatSessionId ?? undefined),
  )
  const browserOn = browserEntry !== undefined
    && (browserEntry.active > 0 || browserEntry.lingering === true)

  return (
    <div className="kr-hero-head">
      <SeekerHead
        idleLine={idlePhraseFor(new Date(clockTick))}
        browserEntry={browserEntry}
        browserOn={browserOn}
      />
    </div>
  )
}

/** 跨 bundle 共享的挂载句柄（live reload 后旧根不能重复 createRoot）。 */
const HOST_KEY = '__dshSeekerHeroHeadHost__'

interface HeroHeadHost {
  root: Root | null
  container: HTMLElement | null
}

function getHost(): HeroHeadHost {
  const holder = window as unknown as Record<string, unknown>
  const existing = holder[HOST_KEY] as HeroHeadHost | undefined
  if (existing && typeof existing === 'object') return existing
  const created: HeroHeadHost = { root: null, container: null }
  holder[HOST_KEY] = created
  return created
}

/**
 * 同步新对话页的卡头（幂等，由 kr-chat-controller 每 250ms 调一次）。
 *
 * @param shouldShow - 当前是否处于「空白新会话 + Seeker 视图」。
 */
export function syncSeekerHeroHead(shouldShow: boolean): void {
  if (typeof document === 'undefined') return
  const host = getHost()

  if (!shouldShow) {
    if (host.container !== null) {
      host.container.style.display = 'none'
    }
    return
  }

  /*
   * 挂载点：**composerStack 的父级**，插成 composerStack 的前一个兄弟。
   *
   * 结构（实测 2026-10-25）：
   *   div.wSkVaW_composerStack.wSkVaW_composerHero
   *     ├ div.pXSMma_root            （工作区行）
   *     ├ div.wSkVaW_heroWorkspaceRow（"探索未至之境"标题那一行）
   *     ├ div                        （空）
   *     └ div > div.uV2eYG_hero      （输入框 + 选项行）
   *
   * 所以 composerStack 就是「整块新对话区域」，把卡头插在它**前面**，正好落在
   * 标题与输入框之上，又不参与它自己的纵向排布（塞进去会把标题挤下去）。
   *
   * 早先试过插进 composerStack 内部当 firstChild，结果是卡头被塞在"工作区行"
   * 与标题之间、把两者挤开 —— 那不是一个"上面多一块"的效果。
   */
  const stack = document.querySelector('[class*="composerStack"]')
  const anchor = stack?.parentElement ?? null
  if (anchor === null || stack === null) {
    if (host.container !== null) host.container.style.display = 'none'
    return
  }

  let container = host.container
  if (container === null || !container.isConnected || container.parentElement !== anchor) {
    if (container !== null) {
      try { container.remove() } catch { /* 已脱离 */ }
    }
    container = document.createElement('div')
    container.id = HERO_HEAD_ID
    host.container = container
    // 容器换新 → 旧根挂在已脱离文档的节点上，先卸掉再重建（否则 React 会警告重复挂载）。
    if (host.root !== null) {
      try { host.root.unmount() } catch { /* 已卸载 */ }
      host.root = null
    }
  }

  // 位置：composerStack 的前一个兄弟（会话切换 / 官方重渲染后可能被搬走）。
  if (container.nextElementSibling !== stack) {
    anchor.insertBefore(container, stack)
  }
  if (container.style.display === 'none') container.style.display = ''

  if (host.root === null) {
    host.root = createRoot(container)
    host.root.render(<SeekerHeroHead />)
  }
}
