/**
 * dsh-mail — 最小 ctx 面（host 半身）。
 *
 * 刻意**不**用 `@deepseek-ai/cordis` 的 `Context` 类型：那个垫片对 `tools`
 * 服务与 `agent/pre-step` 这类事件没有声明，直接写 `ctx.tools` / `ctx.on('agent/pre-step')`
 * 会在 typecheck 里报一堆假错（既有模块就背着这类噪音）。这里只声明本模块
 * 真正用到的那几样，形状与真实 cordis 一致：
 *
 *  - `logger` 可选（cordis 允许没有 logger 的裸上下文）；
 *  - `effect(fn)` 注册随插件卸载回收的副作用，返回值是可选 disposer；
 *  - `on(event, listener, options)` 事件订阅（`prepend: true` 抢先跑）；
 *  - `webServer.register(route)` 返回注销函数；
 *  - `tools.register(definition)` 返回注销函数。
 *
 * 注意：cordis 的 ctx 是 Proxy，**未在 inject 中声明的属性一读就抛**
 * （`cannot get property "tools" without inject`）。所以本类型只用于编译期，
 * 运行时仍必须由调用方保证「只在已注入对应 service 的子上下文里用」。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** 日志面（三个方法都可选）。 */
export interface MailLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  debug?: (message: string) => void
}

/** webServer 服务面。 */
export interface MailWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): () => void
}

/** tools 服务面（definition 的形状由 defineTool 决定，这里只关心返回值）。 */
export interface MailTools {
  register(definition: unknown): () => void
}

/** 本模块用到的全部 ctx 面。 */
export interface MailHostContext {
  logger?: MailLogger
  webServer: MailWebServer
  tools: MailTools
  effect(fn: () => void | (() => void), label?: string): void
  on(
    event: string,
    listener: (...args: never[]) => void,
    options?: { prepend?: boolean },
  ): void
}
