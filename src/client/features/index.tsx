/**
 * dsh-chat-plus — 组件开关的客户端启动入口。
 *
 * 组件级开关由 DSH 插件页面「包含的组件」列表原生提供（bundle patch 的每个
 * insert 一行、每行一个「运行中」开关）。本模块不再向插件页注册任何自绘
 * 表单：只负责启动组件状态同步（每 2 秒 / 聚焦时拉一次宿主状态），供全插件
 * 的 useFeature / featureEnabledNow 使用。
 *
 * 旧版这里注册过 plugins.bundle.config 的「功能开关」66 项面板；按用户
 * 2026-10-28 的明确要求撤回 —— 用户要的是「像组件列表那样一行一个开关」，
 * 不是把每个细项都摊在插件页上。
 *
 * @module
 */

import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bootstrapFeatures } from './store.ts'

/**
 * 启动组件状态同步（幂等）。
 *
 * @param _ctx - client 半身上下文（保留参数以兼容调用点）。
 */
export function applyFeatureSwitches(_ctx: ClientContext): void {
  bootstrapFeatures()
}
