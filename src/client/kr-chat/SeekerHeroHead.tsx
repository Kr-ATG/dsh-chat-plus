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
import { idlePhraseFor, THINKING_PHRASE } from './idle-phrase.ts'
import { idleClipFor } from './motion-clips.ts'
import { featureEnabledNow } from '../features/gate.tsx'

/** 容器 id（幂等复用 + 冒烟断言）。 */
export const HERO_HEAD_ID = 'dsh-seeker-hero-head'

/*
 * 空闲文案（观月中 / 吃饭中 / 小憩中，按钟点选）来自 idle-phrase.ts —— 右栏那张
 * 操作面板卡读的是**同一份**。
 *
 * 原先这里自己抄了一张时段表（注释还写着"与 KrPlainTimelineCard 逐字一致"，而
 * 这种保证只能靠人盯着）。2026-10-26 换词时正是它差点漏改的：只改右栏那张表，
 * 新对话页就会在夜里说"小憩中"。现在两处 import 同一个模块，物理上不可能分叉。
 */

/**
 * 新对话页的卡头内容。
 *
 * ## 运行态由外部传入（2026-10-25 修正）
 *
 * 上一版在这里自己开了个 400ms interval 读 DOM 判断"本轮在不在跑" —— 而
 * kr-chat-controller **本来就有 250ms 的 syncDom 轮询**在调 syncSeekerHeroHead。
 * 同一个状态两套轮询是纯浪费：两倍定时器、两倍 DOM 查询，而且两个来源可能短暂
 * 不一致（一个已更新、一个还没）。
 *
 * 现在只保留控制器那一条：它每 250ms 算好 running 传进来，组件只管渲染。
 *
 * ## 为什么它必须感知运行态（用户：「为什么总是在休息中」）
 *
 * 用户在新对话页发出第一条消息后、首条回复落定前，这块卡头原先一直挂着「休息中」
 * （它只显示按钟点选的空闲文案）。看起来像"她根本没在干活"。现在本轮在跑时显示
 * 「在思考中」（主色 + 呼吸点，与操作面板卡头同一句话）。
 */
function SeekerHeroHead({ running }: { readonly running: boolean }): ReactElement {
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

  const thinking = running
  const idleLine = thinking ? THINKING_PHRASE : idlePhraseFor(new Date(clockTick))

  return (
    <div className="kr-hero-head">
      <SeekerHead
        idleLine={idleLine}
        thinking={thinking}
        /* 动画：新对话页只有两档 —— 本轮在跑就是「思考中」，否则按钟点空闲。 */
        stageMode={thinking ? 'thinking' : 'idle'}
        idleClip={idleClipFor(idleLine)}
        browserEntry={browserEntry}
        browserOn={browserOn}
        /* 不渲染齿轮/邮箱（chrome=false）：这两枚按钮带固定 id，而 Hero 卡头是
           常驻 DOM（收起时只 display:none）—— 与右栏那段同时渲染就会出现重复 id，
           getElementById 拿到隐藏的那个，表现为「齿轮在、点了没反应」。
           新对话页本来也没有大盘可设置、没有邮箱要开，不渲染它们没有损失。 */
        chrome={false}
      />
    </div>
  )
}

/** 跨 bundle 共享的挂载句柄（live reload 后旧根不能重复 createRoot）。 */
const HOST_KEY = '__dshSeekerHeroHeadHost__'

interface HeroHeadHost {
  root: Root | null
  container: HTMLElement | null
  /** 上次已交给 React 根的 running 值（变化时才重渲染，见 syncSeekerHeroHead）。 */
  lastRunning?: boolean
}

function getHost(): HeroHeadHost {
  const holder = window as unknown as Record<string, unknown>
  const existing = holder[HOST_KEY] as HeroHeadHost | undefined
  if (existing && typeof existing === 'object') return existing
  const created: HeroHeadHost = { root: null, container: null, lastRunning: undefined }
  holder[HOST_KEY] = created
  return created
}

/**
 * 同步新对话页的卡头（幂等，由 kr-chat-controller 每 250ms 调一次）。
 *
 * **不再自己开轮询**：运行态由调用方算好传进来（见 SeekerHeroHead 的注释）。
 * 控制器那 250ms 的 syncDom 已经把「是否显示 + 是否在跑」都算清了，这里只负责
 * 挂载与渲染。
 *
 * @param shouldShow - 当前是否处于「空白新会话 + Seeker 视图」。
 * @param running - 本轮是否正在跑（控制器算好，与右栏大盘同一口径）。
 */
export function syncSeekerHeroHead(shouldShow: boolean, running = false): void {
  if (typeof document === 'undefined') return
  const host = getHost()

  /*
   * view.hero-head 关闭：**不挂载**，已挂的也隐藏。
   *
   * 判在这里而不是只判调用方：这个同步函数是 250ms 轮询入口，任何新增调用方
   * 都不该能绕过开关把卡头挂上去。已挂的容器只做 display:none（保留 React 根，
   * 重新打开时立刻恢复，也避免 Hero 区反复重建造成闪烁）；没挂的连 createRoot
   * 都不会发生。
   */
  if (!featureEnabledNow('view.hero-head')) {
    if (host.container !== null) host.container.style.display = 'none'
    return
  }

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
    // 根换了 → 上次的 running 记录作废，新根必须渲染一次。
    host.lastRunning = undefined
  }

  // 位置：composerStack 的前一个兄弟（会话切换 / 官方重渲染后可能被搬走）。
  if (container.nextElementSibling !== stack) {
    anchor.insertBefore(container, stack)
  }
  if (container.style.display === 'none') container.style.display = ''

  if (host.root === null) {
    host.root = createRoot(container)
    host.root.render(<SeekerHeroHead running={running} />)
    host.lastRunning = running
    return
  }

  /*
   * running 变化时**重渲染**。
   *
   * 这个根是 createRoot 手动挂的，不像普通 React 树那样由父组件驱动 —— 不主动
   * render 的话，控制器算出 running 变了、卡头还停在旧文案上（正是"总是休息中"
   * 的另一种成因）。
   *
   * 只在**值真的变了**才 render：250ms 一次无条件 render 会让整棵卡头每 250ms
   * 重跑一遍（立绘、SVG、动画声明全部重算），没必要。
   */
  if (host.lastRunning !== running) {
    host.lastRunning = running
    host.root.render(<SeekerHeroHead running={running} />)
  }
}
