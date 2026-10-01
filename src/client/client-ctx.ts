/**
 * dsh-chat-plus — 客户端根上下文登记（client-ctx）。
 *
 * 为什么需要这一层：本插件的若干个「纯组件模块」（右栏操作面板、正文渲染）
 * 需要调用**跨插件的官方服务**（`ctx.get('sidebarRight')` 打开右栏工作区预览、
 * `ctx.get('sessions')` 读会话 cwd），但它们不该各自去 import 插件入口
 * （`index.ts` 会反过来 import 它们，形成循环）。
 *
 * 于是入口在 apply() 里登记一次，其它模块只读。读不到时（旧宿主、单元测试、
 * SSR）一律返回 null，调用方自己降级——绝不抛。
 */

/** 客户端根上下文的最小可读面（避免 import 官方类型造成运行时依赖）。 */
export interface ClientCtxLike {
  get?(name: string): any
}

let registered: ClientCtxLike | null = null

/** 由插件入口在 apply() 中登记（幂等）。 */
export function setClientCtx(ctx: ClientCtxLike | null): void {
  registered = ctx
}

/**
 * 取客户端根上下文。
 *
 * 两级来源：先看入口登记的值，其次看 `window.__dshClientCtx__`
 * （入口一直会写这个全局，壳内/调试时也常被其它插件共用）。
 */
export function getClientCtx(): ClientCtxLike | null {
  if (registered !== null) return registered
  try {
    const global = (globalThis as { __dshClientCtx__?: ClientCtxLike }).__dshClientCtx__
    return global ?? null
  } catch {
    return null
  }
}

/**
 * 取一个服务的防御式读法。
 *
 * cordis 的 ctx 是 Proxy：未在 inject 白名单里声明的属性**一读就抛**
 * `cannot get property "x" without inject`。本模块拿的是根 ctx，与插件的
 * inject 声明无关，但读一个不存在的服务仍可能抛，所以统一走 try/catch。
 * @param name - 服务名。
 * @returns 服务实例，或 undefined。
 */
export function getService<T = any>(name: string): T | undefined {
  const ctx = getClientCtx()
  if (ctx === null) return undefined
  try {
    if (typeof ctx.get === 'function') return ctx.get(name) as T
    return (ctx as unknown as Record<string, unknown>)[name] as T
  } catch {
    return undefined
  }
}

/** 某个会话的工作区根目录（cwd）；读不到返回 undefined。 */
export function workspaceCwdOf(sessionId: string | null | undefined): string | undefined {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const sessions = getService<any>('sessions')
  if (sessions === undefined || sessions === null) return undefined
  try {
    const snap = sessions.list?.getSnapshot?.() ?? sessions.getSnapshot?.()
    const cwd = snap?.byId?.[sessionId]?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}
