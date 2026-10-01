/**
 * dsh-chat-plus — client 半身入口（思考 chip + 工具调用聚合 + 对话流卡片
 * + 对话截图）。
 *
 * 自 dsh-webui 的 dsh-better-markdown（思考 chip 部分）+ dsh-tool-summary
 * 拆分为独立插件，三点行为差异见 thinking/ThinkingStepNodeView.tsx 头注释：
 *  1. 正文链路保持官方（MarkdownText / renderMessageImages），不引入 markstream；
 *  2. 对话流卡片只在回合结束后出现（流式期不包卡，保住流式输出）；
 *  3. 思考与工具共用同一个活动抽屉（window 级总线，键名与 webui 相同，
 *     与 webui 并存时按 last-write-wins 共享同一抽屉）。
 * 另含对话截图：assistant 消息操作栏相机按钮（conversation.chat.assistant-actions，
 * id chat-flow-screenshot），与 webui 的截图按钮 id 不同、互不冲突。
 */
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-chat / ui-tool / ui-session 的 SlotMap 与标准 props 合并
// 声明（assistant-step / tool-call keyed 槽位 + assistant-actions 槽位的
// useChat/useSessions 契约）+ ui-slots 的 slots 服务声明 + dsh-client-locale
// 的 common 词汇合并（t 的共享键域，markdown 标签用）。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { injectStyles as injectToolSummaryStyles } from './tool-summary/styles.ts'
import { injectStyles as injectBaseStyles } from './styles.ts'
import { injectDiagramStyles } from './diagram/styles.ts'
import { injectProtoStyles } from './proto/styles.ts'
import { injectDownloadStyles } from './download/styles.ts'
import { DownloadCard } from './download/DownloadCard.tsx'
import { mountActivityDrawer } from './tool-summary/activity-drawer.tsx'
import { ToolGroupNodeView } from './tool-summary/ToolGroupNodeView.tsx'
import { TurnProcessShadowView } from './tool-summary/TurnProcessShadowView.tsx'
import { ThinkingStepNodeView } from './thinking/ThinkingStepNodeView.tsx'
import { RetryShadowView } from './retry/RetryShadowView.tsx'
import { applyMessageScreenshot } from './shot/index.tsx'
import { mountShellChrome } from './shell-chrome.ts'
import { installOpenPathFix } from './open-path-fix.ts'
import { injectKrStyles } from './kr-chat/styles.ts'
import { mountKrChatController } from './kr-chat/kr-chat-controller.tsx'
import { KrTodoBridge } from './kr-chat/kr-todo-bridge.ts'
import { KR_CHAT_ENABLED } from './kr-chat/enabled.ts'
import { applyTriadClient } from './triad/index.ts'
import { buildActivityGrid, activityColor, ACTIVITY_COLUMNS } from './triad/usage/dashboard/ActivityGrid.js'
import { setClientCtx } from './client-ctx.ts'

/** 顶层服务依赖（client boot graph 用）。 */
// 并集 = 原 dsh-chat-plus 的 slots + 原 dsh-triad 的 locale/inputTriggers/sessions
// （四工作台融合后由本插件统一提供，少了哪个哪个工作台就不挂载）。
export const inject = ['slots', 'locale', 'inputTriggers', 'sessions']

/** 单个模块失败不拖垮插件整体。 */
function guarded(ctx: ClientContext, label: string, mount: () => void): void {
  try {
    mount()
  } catch (error) {
    console.warn(`[dsh-chat-plus] ${label} 挂载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 页面不可见 → 给 body 挂一个标记，配套样式把全页 CSS 动画置为 paused。
 *
 * 选 animation-play-state 而不是 display/opacity 关停：前者由合成器直接挂起
 * 时间轴，不触发任何布局与重绘，切回来就继续；后者会造成一次强制重排，反而
 * 在切走/切回的瞬间制造新的掉帧。
 */
const ANIM_PAUSE_ATTR = 'data-dsh-anim-paused'
const ANIM_PAUSE_CSS = `
body[${ANIM_PAUSE_ATTR}] *,
body[${ANIM_PAUSE_ATTR}] *::before,
body[${ANIM_PAUSE_ATTR}] *::after {
  animation-play-state: paused !important;
}
`
function installAnimationThrottle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-anim-pause') === null) {
    const style = document.createElement('style')
    style.id = 'dsh-anim-pause'
    style.textContent = ANIM_PAUSE_CSS
    document.head.appendChild(style)
  }
  const sync = (): void => {
    const hidden = document.visibilityState === 'hidden'
    if (hidden === document.body.hasAttribute(ANIM_PAUSE_ATTR)) return
    if (hidden) document.body.setAttribute(ANIM_PAUSE_ATTR, '')
    else document.body.removeAttribute(ANIM_PAUSE_ATTR)
  }
  document.addEventListener('visibilitychange', sync)
  sync()
}

let savedCtx: ClientContext | null = null
export let officialAssistantNodeView: any = null
export let officialTurnProcessNodeView: any = null

export function getOfficialAssistantNodeView(): any {
  if (officialAssistantNodeView) return officialAssistantNodeView
  if (savedCtx) {
    try {
      const entries = savedCtx.slots.entries('conversation.chat.node')
      const assistantEntry = entries.find((e: any) => e.options?.key === 'assistant-step' && (e.options?.priority ?? 0) >= 0)
      if (assistantEntry?.component) {
        officialAssistantNodeView = assistantEntry.component
      }
    } catch {
      // ignore
    }
  }
  return officialAssistantNodeView
}

/**
 * 捕获官方原生的 turn-process 折叠 control。
 *
 * 与 assistant-step 同理：插件用 priority -100 占这个座位只是为了在 KR 模式
 * 放实时活动卡，普通「对话」必须把座位原样还给官方那条「工具调用 N 次 /
 * 已思考…」的折叠行。没有这个捕获，插件一旦占座，官方组件就永远没机会渲染，
 * 普通对话里工具调用与思考就一起消失了。
 */
export function getOfficialTurnProcessNodeView(): any {
  if (officialTurnProcessNodeView) return officialTurnProcessNodeView
  if (savedCtx) {
    try {
      const entries = savedCtx.slots.entries('conversation.chat.node')
      const processEntry = entries.find((e: any) => e.options?.key === 'turn-process' && (e.options?.priority ?? 0) >= 0)
      if (processEntry?.component) {
        officialTurnProcessNodeView = processEntry.component
      }
    } catch {
      // ignore
    }
  }
  return officialTurnProcessNodeView
}

export function apply(ctx: ClientContext): void {
  savedCtx = ctx
  if (typeof window !== 'undefined') {
    (window as any).__dshClientCtx__ = ctx
  }
  // 登记根上下文：右栏「打开工作区预览」与正文文件提及都靠它读跨插件服务
  // （ctx.get('sidebarRight') / ctx.get('sessions')），见 client-ctx.ts。
  setClientCtx(ctx as unknown as { get?(name: string): any })
  // 样式：工具聚合（dts__）、思考/流卡（dtt__）两枚 + 截图面板（tsh__）独立
  // <style>，幂等注入。
  guarded(ctx, 'tool-summary styles', injectToolSummaryStyles)
  guarded(ctx, 'chat-flow styles', injectBaseStyles)
  guarded(ctx, 'proto card styles', injectProtoStyles)
  guarded(ctx, 'diagram styles', injectDiagramStyles)
  guarded(ctx, 'download card styles', injectDownloadStyles)
  // 共享活动抽屉：思考与工具调用的详情面板（body 级宿主，只挂一次）。
  guarded(ctx, 'activity drawer', mountActivityDrawer)

  // 壳窗口控制联动：壳内（iframe）检测 + header 右簇左移留位 + 主题上报。
  // 浏览器直开时整模块 no-op。
  guarded(ctx, 'shell chrome', mountShellChrome)

  // 「用文件资源管理器打开」：官方那条被 windowsHide 吞了窗口，fetch 层改道。
  guarded(ctx, 'open path fix', installOpenPathFix)

  // 对话截图：assistant 消息操作栏相机按钮 → 截图面板（独立 id，KR模式生效）。
  guarded(ctx, 'screenshot seat', () => { applyMessageScreenshot(ctx) })

  // 捕获官方原生的 assistant-step / turn-process 渲染组件：普通「对话」模式下
  // 两个座位都原样委托回官方，插件只负责 KR 那一栏。
  try {
    const entries = ctx.slots.entries('conversation.chat.node')
    const assistantEntry = entries.find((e: any) => e.options?.key === 'assistant-step' && (e.options?.priority ?? 0) >= 0)
    if (assistantEntry?.component) {
      officialAssistantNodeView = assistantEntry.component
    }
    const processEntry = entries.find((e: any) => e.options?.key === 'turn-process' && (e.options?.priority ?? 0) >= 0)
    if (processEntry?.component) {
      officialTurnProcessNodeView = processEntry.component
    }
  } catch (error) {
    console.warn('[dsh-chat-plus] 捕获官方节点视图失败：', error)
  }

  // 回合过程座位：KR 模式挂单张实时活动卡；普通「对话」把座位原样还给官方
  // 的折叠 control（工具调用 / 思考都在那条行里）。这个座位仍必须在首条
  // assistant 输出前占位，供 KR 使用。
  guarded(ctx, 'turn-process seat', () => {
    const entries = ctx.slots.entries('conversation.chat.node')
    const processEntry = entries.find((entry: any) => entry.options?.key === 'turn-process' && (entry.options?.priority ?? 0) >= 0)
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'turn-process',
      priority: -100,
      locale: 'chat',
      ...(processEntry?.options?.inject ? { inject: processEntry.options.inject } : {}),
    }, TurnProcessShadowView))
  })

  // 助手正文：流式期保持官方 Markdown / image 链路，回合结束后呈现步骤与
  // 总结卡；普通「对话」模式整体委托回官方 AssistantNodeView。
  guarded(ctx, 'assistant-step seat', () => {
    const entries = ctx.slots.entries('conversation.chat.node')
    const assistantEntry = entries.find((e: any) => e.options?.key === 'assistant-step' && (e.options?.priority ?? 0) >= 0)
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'assistant-step',
      priority: -100,
      locale: 'chat',
      ...(assistantEntry?.options?.inject ? { inject: assistantEntry.options.inject } : {}),
    }, ThinkingStepNodeView))
  })
  // download 原子卡片：接管内置 download 工具行（keyed tool.call.toolview，
  // key = wire 工具名）。host 半身注册 download 工具 + 进度路由；运行中约
  // 700ms 轮询真实进度（字节/速度/ETA），完成态读 meta 摘要。host 未就绪或
  // 旧版本时优雅降级为时长显示。
  guarded(ctx, 'download toolview seat', () => {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: 'download' },
      DownloadCard,
    ))
  })

  // KR 对话双栏布局与执行大盘（视图分类「KR对话」+ 右侧 Agent 轨迹大盘）。
  //
  // 已被 KR_CHAT_ENABLED 关闭 —— 只隐藏、不删除：控制器、样式、面板组件全部
  // 原样留在 kr-chat/ 下，把 enabled.ts 里的开关改回 true 即完整恢复。
  if (KR_CHAT_ENABLED) {
    guarded(ctx, 'kr-chat styles', injectKrStyles)
    guarded(ctx, 'kr-chat controller', mountKrChatController)
  }

  // 全局动画节流：页面不可见时把整页 CSS 动画按暂停处理。
  //
  // 背景：显示器 2560×1440 @ 300Hz，Chromium 的 requestAnimationFrame 跟随刷新
  // 走，实测 rAF 能到 196–300fps。于是一堆常驻 infinite 动画（官方 state-dot /
  // dash，本插件的卡片呼吸、扫光、转圈）在没人看的时候也按 300Hz 满帧重绘，
  // 渲染进程实测 121% 单核。
  //
  // 只在 document 不可见时暂停（标签页切走、窗口完全隐藏）。不做更激进的「空闲
  // 降频」——那要判断用户意图，误伤正在看的动画就得不偿失；不可见时暂停是零
  // 风险且覆盖了绝大多数浪费场景。
  guarded(ctx, 'animation throttle', installAnimationThrottle)

  // 桥接官方 todos 投影，供右侧大盘实时展示真实任务。
  //
  // 大盘已隐藏，但这个座位同时是「会话身份登记点」：它在 session 作用域、
  // 空白 Hero 态照常渲染，会话 id 一变即清空活动抽屉 / live todos / 已选轮次，
  // 免得切会话后抽屉里还留着上一会话的思考与工具树。与 KR 的可见 UI 无关，
  // 因此不随开关关闭。
  guarded(ctx, 'kr-todo bridge', () => {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
      { name: 'conversation.input.dock', id: 'kr-todo-bridge', order: 999 },
      KrTodoBridge,
    ))
  })

  // ── 融合的原 dsh-triad 工作台（记忆 / 用量 / 技能与 MCP）──────────────
  // 侧边栏导航行、面板、composer 记忆注入开关的座位 id / order / locale
  // namespace 全部原样保留（dsh-triad 退役，用户侧零迁移）。内部每个工作台
  // 各自 try/catch，一个挂载失败不影响其他两个，也不影响上面的对话增强。
  // 定时自动化不在此列：2026-09-28 起由官方 schedule bundle 提供。
  guarded(ctx, 'triad (memory/usage/skills)', () => {
    applyTriadClient(ctx)
  })
}

/** 纯逻辑再导出：供 smoke 断言「Token 活动」贡献热力模型 + 人话行动流翻译。 */
export { buildActivityGrid, activityColor, ACTIVITY_COLUMNS }
export { toPlainStep, plainToolName, siteOf, isMetaTool, spawnsSubagents, humanIssue } from './kr-chat/plain-language.ts'
export { buildPlainTimeline, condenseSteps } from './kr-chat/plain-timeline.ts'
