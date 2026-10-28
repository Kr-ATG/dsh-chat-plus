/**
 * dsh-chat-plus — 组件开关的宿主侧读取与 HTTP 路由。
 *
 * 新的真相是**原生 Cordis 行开关**：插件页面「包含的组件」里每一行的「运行中」
 * 开关直接启用/停用 cordis.patch.yml 中对应的 loader entry。本模块不再维护
 * 自己的 features.json，也不再解析保存值 —— 它只做两件事：
 *
 *   1. 读 loader 当前有哪些组件行处于启用状态（entry.disabled !== true）；
 *   2. 把这些状态经 GET /api/chat-flow/components 交给浏览器侧的 store，
 *      让界面上的组件 UI 与实际行状态同步（行一关，2 秒内对应 UI 消失）。
 *
 * 为什么不在客户端去读 loader：浏览器侧没有宿主 Loader 的入口；而新增一条
 * 只读路由是仓库里已有几十处的成熟做法（/api/chat-flow/*），成本最低。
 *
 * @module
 */

import { rejectCrossSite } from '../shared/csrf.ts'
import { COMPONENTS, componentOfFeature, type ComponentId } from '../shared/components.ts'

/** 组件状态路由（只读 GET）。 */
export const COMPONENTS_ROUTE = '/api/chat-flow/components'

/** 旧名保留（客户端 store 的历史导出叫 FEATURES_ROUTE）。 */
export const FEATURES_ROUTE = COMPONENTS_ROUTE

/** 当前宿主 context（apply 开头登记；供 loader 查询用）。 */
let hostCtx: any = null

/** 登记宿主 context（apply 开头调用；幂等）。 */
export function initializeFeatures(ctx?: any): void {
  if (ctx !== undefined) hostCtx = ctx
}

/** 取 loader（cordis 的 root.loader / ctx.get('loader') 两种形态都兼容）。 */
function loaderOf(ctx: any): any {
  if (ctx === null || ctx === undefined) return undefined
  try {
    if (ctx.root?.loader !== undefined) return ctx.root.loader
  } catch { /* proxy 读取失败继续试 get */ }
  try {
    if (typeof ctx.get === 'function') return ctx.get('loader')
  } catch { /* 没有 loader 服务 */ }
  return undefined
}

/**
 * 读取全部组件行的启用状态。
 *
 * 缺省策略：entry 不存在 = 默认开启（比如老版本 bundle 还没有这一行），
 * 避免升级后因为「查不到」把功能误关。entry 存在时看 disabled —— 这是
 * plugin manager 开关直接改的字段，不需要等 fiber 起来。
 */
export function readComponentStates(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  let entries: any[] = []
  try {
    const loader = loaderOf(hostCtx)
    entries = typeof loader?.entries === 'function' ? [...loader.entries()] : []
  } catch {
    entries = []
  }
  for (const component of COMPONENTS) {
    const entry = entries.find((candidate: any) => candidate?.options?.id === component.rowId)
    out[component.id] = entry === undefined ? component.defaultEnabled : entry.disabled !== true
  }
  return out
}

/** 单个宿主侧细粒度功能是否开启（映射到所属组件）。 */
export function hostFeatureEnabled(featureId: string): boolean {
  const componentId: ComponentId = componentOfFeature(featureId)
  const states = readComponentStates()
  return states[componentId] !== false
}

/** 单个组件是否开启。 */
export function hostComponentEnabled(componentId: ComponentId): boolean {
  return readComponentStates()[componentId] !== false
}

/** 当前回包形状（与客户端 store 的 FeatureSnapshot 对齐）。 */
export function snapshot(): { ok: true; version: number; updatedAt: number; values: Record<string, boolean> } {
  return { ok: true, version: 1, updatedAt: Date.now(), values: readComponentStates() }
}

/**
 * 注册组件状态路由。只依赖 webServer（延迟注入，缺失时整块静默跳过）。
 *
 * @param ctx - 已注入 webServer 的上下文。
 */
export function applyFeatureRoutes(ctx: any): void {
  initializeFeatures(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: COMPONENTS_ROUTE,
    handler: (req: any, res: any) => {
      const json = (status: number, payload: Record<string, unknown>): void => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      if (rejectCrossSite(req?.headers, json)) return
      if (String(req?.method ?? 'GET').toUpperCase() !== 'GET') {
        json(405, { ok: false, error: 'method not allowed' })
        return
      }
      json(200, snapshot() as unknown as Record<string, unknown>)
    },
  }), 'dsh-chat-plus: component states route')
}

/** 供冒烟直接对拍（纯函数）。 */
export const __test = { loaderOf }
