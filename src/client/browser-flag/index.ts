/**
 * dsh-chat-plus — 浏览器标志的装配（client 半身）。
 *
 * 与 host 半身配对的只读观测：host 包装 tools/execute，把「哪些会话正在跑浏览器
 * 操作」通过 /api/chat-flow/browser-activity 吐出来，这里把它变成一个可见信号：
 *
 *  **会话列表行右端一枚呼吸的小浏览器图标**（DOM 属性注入，见 row-mark.ts）。
 *
 * ## 为什么只在会话行、不做标题栏胶囊
 *
 * 2026-10-20 按用户要求定稿：胶囊（无论是标题栏最右的座位版，还是顶栏 Seeker
 * 左侧的裸 DOM 版）都太吵 —— 一块带底色描边的圆角块压在顶栏里，与官方的文字
 * 标签抢注意力。标志只保留「一枚安静的小图标」，位置在**行右端**（时间戳旁；
 * 2026-10-22 按用户要求从行首挪过来，行首那格还给会话状态点）。
 *
 * ## 降级
 *
 * 路由 404 / 网络失败 / host 未装，一律当「无活动」：不显示标志、不报错、
 * 不影响对话与列表。这是本模块唯一必须保证的失败姿态（见 store.ts 头注释）。
 *
 * @param ctx - client root context。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { mountBrowserFlagRows } from './row-mark.ts'
import { injectBrowserFlagStyles } from './styles.ts'
import {
  mountBrowserFlagPreview,
  startBrowserActivityPolling,
} from './store.ts'

/**
 * 装配：样式 + 轮询器 + window 预览入口 + 行标记观察器。
 *
 * 每一步各自 try/catch：界面增强里最不该发生的是「加了一枚小图标，结果整个
 * 插件 apply 抛错」。
 */
export function applyBrowserFlagClient(_ctx: ClientContext): void {
  try {
    injectBrowserFlagStyles()
  } catch (error) {
    console.warn('[dsh-chat-plus] 浏览器标志样式注入失败：', error)
  }

  // 一份全局轮询器（不是每行一个）：数据本来就是全量的，N 行 N 次请求没有意义。
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

  try {
    mountBrowserFlagRows()
  } catch (error) {
    console.warn('[dsh-chat-plus] 会话行标志观察器挂载失败：', error)
  }
}
