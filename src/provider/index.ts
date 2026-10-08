/**
 * dsh-chat-plus — 供应商中心 host 半身（原 dsh-provider-hub，2026-10-05 融合）。
 *
 * 把六个「供应商 / 模型相关」模块装进 dsh-chat-plus 的 host 半身，每个模块独立
 * try/catch 挂载，一个模块挂了不得拖垮其余：
 *
 *   1. 网络代理（proxy-host.js，自 dsh-network-proxy lib 产物）：
 *      全局 fetch 包装 + undici ProxyAgent，settings 命名空间 network-proxy，
 *      HTTP API /api/dsh-proxy/*（prefix，回环围栏）。
 *   2. 模型能力改写（capabilities-host.js，自 dsh-model-capabilities lib 产物）：
 *      llm-pi-ai providers 改写（识图/推理档位）+ 生图/视频标记与
 *      **generate_image / generate_video 两个工具的真正注册处**，
 *      命名空间 model-capabilities 是生图/生视频配置的唯一事实源，
 *      HTTP API /api/model-capabilities/*（回环围栏）。
 *   3. 辅助视觉（modules/vision-helper.ts，自 dsh-webui src）：只注册
 *      vision_describe 一个工具 + 非多模态主模型的图片自动降级；另有 11 条
 *      HTTP 路由（全部经 registerRoute 走回环围栏）读写工作区
 *      .dsh/model-router.json。**不再注册 generate_image/generate_video**
 *      ——那两个工具归上面的 capabilities-host，避免命名空间重复注册把整个
 *      vision 模块拖挂。
 *   4. 提示词优化（modules/prompt-optimize.ts）：HTTP API
 *      /api/dsh-prompt-optimize + /stop（回环围栏，走 ctx.llm.stream）。
 *   5. 网页搜索 AnySearch provider（modules/web-search-anysearch.ts +
 *      web-search-provider.ts）：向 `ctx.web` 注册 id=anysearch 的搜索后端
 *      （`POST {baseURL}/v1/search`），settings 命名空间 web-search-anysearch。
 *   6. 凭据密钥环（modules/credential-keyring.ts）：HTTP API
 *      /api/provider-hub-keys/*。替换 API key 不再覆盖——旧值入环
 *      （`R__KEY_n` 存档引用），可命名、可一键切回（交换语义，两边不丢）。
 *
 * 路由前缀、settings 命名空间、工具名一律原样保留（用户零迁移）。
 * 调用方（src/host.ts）负责用 `ctx.inject([...])` 等待上面这些服务就绪，
 * 因此本文件不再导出 name / inject —— 它只是被装配的模块，不是插件入口。
 */
import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as proxyHost from './proxy-host.js'
import * as capsHost from './capabilities-host.js'
import { applyVisionHelper } from './modules/vision-helper'
import { applyPromptOptimize } from './modules/prompt-optimize.ts'
import { applyAnySearch } from './modules/web-search-anysearch.ts'
import { applyCredentialKeyring } from './modules/credential-keyring.ts'

/** 本模块需要的宿主服务（由调用方 ctx.inject 满足）。 */
export const providerHubServices = [
  'settings', 'webServer', 'llm', 'tools', 'fs', 'sandboxPolicy', 'shell', 'web',
] as const

/** 诊断日志：宿主日志不可达时，把模块挂载失败落盘到这里（排查用）。 */
const DIAG_LOG = join(tmpdir(), 'dsh-chat-plus-provider-apply.log')

function diag(label: string, error: unknown): void {
  try {
    appendFileSync(DIAG_LOG, `[${new Date().toISOString()}] ${label}: ${String((error as Error)?.stack ?? error)}\n`)
  } catch { /* 诊断失败不干扰主流程 */ }
}

/** 装配六个供应商模块；任一失败只记日志，不影响其余模块与主插件。 */
export function applyProviderHub(ctx: Context): void {
  const warn = (label: string, error: unknown): void => {
    diag(label, error)
    ctx.logger?.warn?.(`[dsh-chat-plus] provider ${label} 模块挂载失败：${String(error)}`)
  }

  // 1. 网络代理：注册自身路由与 settings 命名空间。
  try {
    proxyHost.apply(ctx)
  } catch (error) {
    warn('proxy', error)
  }

  // 2. 模型能力改写：llm-pi-ai 改写 + 生图/视频工具。
  try {
    capsHost.apply(ctx)
  } catch (error) {
    warn('capabilities', error)
  }

  // 3. 辅助视觉：vision_describe 工具 + 图片自动降级 + 11 条受围栏的 HTTP 路由。
  try {
    applyVisionHelper(ctx, {})
  } catch (error) {
    warn('vision', error)
  }

  // 4. 提示词优化：/api/dsh-prompt-optimize（+ /stop），回环围栏。
  try {
    applyPromptOptimize(ctx)
  } catch (error) {
    warn('prompt-optimize', error)
  }

  // 5. 外接网页搜索：id=anysearch provider + web-search-anysearch 设置命名空间。
  try {
    applyAnySearch(ctx)
  } catch (error) {
    warn('web-search', error)
  }

  // 6. 凭据密钥环：/api/provider-hub-keys（换 key 入环不覆盖、可切回）。
  try {
    applyCredentialKeyring(ctx)
  } catch (error) {
    warn('credential-keyring', error)
  }
}
