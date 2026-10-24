/**
 * dsh-chat-plus — 浏览器标志的装配（client 半身）。
 *
 * 与 host 半身配对的只读观测：host 包装 tools/execute，把「哪些会话正在跑浏览器
 * 操作」通过 /api/chat-flow/browser-activity 吐出来，这里把它变成一个可见信号。
 *
 * ## 现在显示在哪（2026-10-25 搬迁）
 *
 * **右栏「操作面板」卡头，Seeker 文字右侧**。
 *
 * 它原先挂在**左侧会话列表那一行**的右端（DOM 属性注入 + 伪元素，见 row-mark.ts）。
 * 用户原话：「这个球标志放在操作面板的 Seeker 文字右侧」—— 理由很直接：那枚图标
 * 说的是「这个会话正在操作浏览器」，而操作面板正是这个会话的实时状态卡，它就该跟
 * 当前动作待在一起；会话列表那一行是**导航**，不是状态。
 *
 * 所以本模块现在只负责**数据面**（轮询 + 快照 + 订阅），渲染交给
 * KrPlainTimelineCard（它用 useSyncExternalStore 直接读 store）。
 *
 * ## 历史：为什么不再用 DOM 注入
 *
 * 原来必须用「属性 + 伪元素」是因为会话行由官方 React 渲染，插进去的节点会被
 * diff 抹掉。搬到操作面板之后那个约束消失了 —— 操作面板是我们自己的 React 树，
 * 正常渲染即可，不必再观察整棵 body、不必再往别人的行上打属性。row-mark.ts 与
 * styles.ts 保留（含测试），只是不再挂载。
 *
 * ## 降级
 *
 * 路由 404 / 网络失败 / host 未装，一律当「无活动」：不显示标志、不报错、
 * 不影响对话与列表。这是本模块唯一必须保证的失败姿态（见 store.ts 头注释）。
 *
 * @param ctx - client root context。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  mountBrowserFlagPreview,
  startBrowserActivityPolling,
} from './store.ts'

/**
 * 装配：轮询器 + window 预览入口。
 *
 * 每一步各自 try/catch：界面增强里最不该发生的是「加了一枚小图标，结果整个
 * 插件 apply 抛错」。
 *
 * **不再注入样式、也不再挂行标记观察器**：视觉已经搬到操作面板卡头（那边用
 * kr-chat/styles.ts 的 .kr-plain-head__browser），左侧会话列表不再有任何改动。
 * 这两步留着反而会往官方的会话行上打属性、注入一张用不到的样式表。
 */
export function applyBrowserFlagClient(_ctx: ClientContext): void {
  // 一份全局轮询器（不是每个消费点一个）：数据本来就是全量的。
  try {
    startBrowserActivityPolling()
  } catch (error) {
    console.warn('[dsh-chat-plus] 浏览器活动轮询启动失败：', error)
  }

  // window 调试/演示入口：不发起真实浏览器调用也能验证标志与动效。
  try {
    mountBrowserFlagPreview()
  } catch (error) {
    console.warn('[dsh-chat-plus] 浏览器标志预览入口挂载失败：', error)
  }
}
