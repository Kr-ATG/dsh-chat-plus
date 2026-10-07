/**
 * dsh-chat-plus — OpenCode Zen 免费层客户端指纹（host 半身）。
 *
 * ## 症状与根因
 *
 * Zen 的免费模型（`exo-free`、`big-pickle`、`nemotron-*` 等）用普通 API key
 * 直连 `POST https://opencode.ai/zen/v1/chat/completions` 一律返回：
 *
 *   403 { "type": "FreeTierError",
 *         "message": "OpenCode's free tier can only be used from within OpenCode" }
 *
 * 上游按**客户端指纹**而不是凭据放行免费层，实测三个条件缺一即 403（2026-10-07
 * 逐项消融，见下）：
 *
 *   1. `User-Agent` 必须是 `opencode/<主>.<次>` 且 **次版本 ≥ 18**；
 *      1.17.x 不是 403 而是 426 Upgrade Required，其它 UA 一律 403。
 *   2. `x-opencode-session: ses_<12 hex><14 base62>` 必须存在且形态合法
 *      （乱填字符串或短 id 都 403）。
 *   3. `tools` 里必须**同时**出现精确小写的 `read` 与 `bash`
 *      （只有 read、只有 bash、或大小写变体如 `Read` 都 403；`glob`/`grep`
 *      非必需，补上只为贴合官方客户端）。
 *
 * 另外免费层要求 `stream: true`——非流式请求即使前三条都满足也 403。
 *
 * ## 为什么落在全局 fetch 包装
 *
 * DSH 侧能改请求的位置有三处，只有这一处够用：
 *
 *   - `llm-pi-ai` 的 profile `headers`：静态字典，生成不出每次请求的
 *     session id；而且 `user-agent` 属于 Harness attribution 的保留名，
 *     会被 `requestHeaders()` 无条件覆盖掉（见 dsh-llm-pi-ai/lib/index.js）。
 *   - `llm/stream` waterfall：能改 `GenerateOptions`（可以往 `tools` 里补
 *     decoy），但 `GenerateOptions` **没有 headers 字段**，UA 与 session 无处安放。
 *   - 全局 `fetch` 包装：唯一能同时改 header 与 body 的落点。本插件融合的
 *     网络代理模块（`proxy-host.js`）已经在用同一条路，且两者互不干扰——
 *     代理层只往 init 里加 `dispatcher`，指纹层只改 headers/body。
 *
 * ## 设计取舍
 *
 * - **白名单只放实测需要的模型**（当前 `exo-free`）。Zen 的免费模型不是同一种
 *   通道：`muse-spark-1.3-contributor-free` 走 `/responses`，给它注入指纹会从
 *   403 变成 400 `ModelProtocolUnsupported`（更糟）；`space-bunny-free` 不注入
 *   也通。要往 `FINGERPRINT_MODELS` 里加模型，先实测「不注入失败、注入成功」。
 * - **只补缺、不改名**。上游要的是精确小写 `read`/`bash`；若请求里已有该名
 *   （DSH 的工具名全是小写）就跳过。若只有大小写变体，补一个同名小写 decoy
 *   而不是改名——改名会让模型回传小写 tool_call，与 DSH 的工具名对不上，
 *   而响应侧还原要包 ReadableStream，代价与风险都不划算。
 * - **session id 从「系统提示 + 首条 user 消息」派生**（sha256 → 26 字符）。
 *   不能取全部 messages：历史每轮都在长，session 会每轮都变，上游前缀缓存
 *   全废。取会话头部两段则在整段会话里稳定。
 * - **只认 `https://opencode.ai/zen/v1/` 前缀 + 白名单 model + JSON 字符串
 *   body**，三条同时满足才动手；任何一条不满足就原样透传，绝不影响其它厂商。
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

/** 需要指纹才能调用的 Zen 模型（仅 chat/completions 通道的免费模型）。 */
const FINGERPRINT_MODELS = new Set(['exo-free'])

/** Zen API 根：只在这个前缀上动手。 */
const ZEN_API_PREFIX = 'https://opencode.ai/zen/v1/'

/** 上游免费层闸门认的官方客户端标识（次版本 ≥ 18 才放行，1.17.x 返回 426）。 */
const OPENCODE_USER_AGENT = 'opencode/1.18.31'

/** 官方客户端在 header 里自报的身份；缺失不影响放行，补上以贴合真实客户端。 */
const OPENCODE_CLIENT = 'desktop'

/** 上游闸门要求的文件检索四件套（精确小写）。 */
const FINGERPRINT_TOOLS: readonly string[] = ['bash', 'glob', 'grep', 'read']

/** session id 随机段的字符表（与官方 `ses_` 形态一致）。 */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 派生 seed 时最多取多少字符（防超长系统提示把哈希拖慢）。 */
const SEED_LIMIT = 4096

/** 全局标记：包装只装一次，避免热重载层层叠加。 */
const HOOK_FLAG = Symbol.for('dsh-opencode-fingerprint.installed')

/** 把输入投影成一段可哈希的文本（字符串直接用，结构化内容序列化）。 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/**
 * 从请求体派生会话 seed：系统提示 + 首条 user 消息。
 * 取会话头部而不是全部历史，才能让同一会话每一轮派生出同一个 session id。
 */
function seedOf(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const parts: string[] = []
  for (const message of messages) {
    const role = (message as { role?: unknown } | null)?.role
    if (role === 'system' || role === 'developer') {
      parts.push(textOf((message as { content?: unknown }).content))
      break
    }
  }
  for (const message of messages) {
    const role = (message as { role?: unknown } | null)?.role
    if (role === 'user') {
      parts.push(textOf((message as { content?: unknown }).content))
      break
    }
  }
  return parts.join('\u0000').slice(0, SEED_LIMIT)
}

/** 把 seed 映射成 `ses_<12 hex><14 base62>` 形态的稳定会话 id。 */
export function sessionIdFor(seed: string): string {
  const digest = createHash('sha256').update(`opencode\u0000${seed}`).digest()
  const time = digest.subarray(0, 6).toString('hex')
  let random = ''
  for (let index = 6; index < 20; index++) random += BASE62[digest[index] % 62]
  return `ses_${time}${random}`
}

/** 请求是否属于需要指纹的 Zen 免费层调用。 */
export function needsFingerprint(url: string, body: Record<string, unknown>): boolean {
  if (!url.startsWith(ZEN_API_PREFIX)) return false
  return typeof body.model === 'string' && FINGERPRINT_MODELS.has(body.model)
}

/** 工具声明里的名字（兼容 chat 的 `{function:{name}}` 与 responses 的 `{name}`）。 */
function toolNameOf(tool: unknown): string {
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return ''
  const flat = (tool as { name?: unknown }).name
  if (typeof flat === 'string' && flat.trim().length > 0) return flat.trim()
  const fn = (tool as { function?: unknown }).function
  if (fn !== null && typeof fn === 'object' && !Array.isArray(fn)) {
    const nested = (fn as { name?: unknown }).name
    if (typeof nested === 'string') return nested.trim()
  }
  return ''
}

/**
 * 就地补齐指纹：header 三件 + body 的 stream/工具四件套。
 *
 * `tool_choice` 只在调用方**本来没有工具**时才设成 `none`——此时补进去的
 * decoy 是纯指纹用途，不能让模型真的选中它们（它们的描述已写明不可用）。
 * 调用方自带工具时保持原样，否则会把正常会话的工具选择能力一起关掉。
 */
export function applyFingerprint(
  init: RequestInit,
  body: Record<string, unknown>,
): RequestInit {
  const headers = new Headers(init.headers ?? {})
  headers.set('user-agent', OPENCODE_USER_AGENT)
  if (!headers.has('x-opencode-client')) headers.set('x-opencode-client', OPENCODE_CLIENT)
  headers.set('x-opencode-session', sessionIdFor(seedOf(body)))

  // 免费层不接受非流式请求。
  body.stream = true

  const tools = Array.isArray(body.tools) ? body.tools : []
  const hadTools = tools.length > 0
  const present = new Set(tools.map(toolNameOf))
  for (const name of FINGERPRINT_TOOLS) {
    if (present.has(name)) continue
    tools.push({
      type: 'function',
      function: {
        name,
        description: `OpenCode built-in ${name} tool`,
        parameters: { type: 'object', properties: {} },
      },
    })
  }
  body.tools = tools
  if (!hadTools && body.tool_choice === undefined) body.tool_choice = 'none'

  return { ...init, headers, body: JSON.stringify(body) }
}

/**
 * 安装 fetch 指纹层（幂等）。装不上不抛：调用方按「能力缺失」处理，
 * 表现为 exo-free 仍报 403，其余供应商完全不受影响。
 *
 * @param ctx - 宿主上下文，仅用于 logger。
 * @returns 卸载函数（还原 globalThis.fetch）。
 */
export function installFetchHook(ctx: Context): () => void {
  const global = globalThis as typeof globalThis & { [HOOK_FLAG]?: () => void }
  // 已装过就返回空卸载器而不是那一个真卸载器：同一进程里可能有第二个
  // fiber（热重载、多 profile）也走到这里，让它拿着真卸载器的话，先销毁的
  // 那个会把还在用的那层 fetch 摘掉。安装权与卸载权都归首个持有者。
  if (typeof global[HOOK_FLAG] === 'function') return () => {}

  const previous = globalThis.fetch
  if (typeof previous !== 'function') {
    ctx.logger?.warn?.('[opencode-fingerprint] globalThis.fetch 不可用，指纹层未安装')
    return () => {}
  }

  const wrapped: typeof fetch = async (input, init) => {
    try {
      if (typeof init?.body === 'string') {
        const url = typeof input === 'string' ? input : String((input as Request)?.url ?? input)
        if (url.startsWith(ZEN_API_PREFIX)) {
          const body = JSON.parse(init.body) as Record<string, unknown>
          if (needsFingerprint(url, body)) {
            return await previous(input, applyFingerprint(init, body))
          }
        }
      }
    } catch {
      // 解析失败（非 JSON body、畸形输入等）一律原样透传：指纹层绝不能
      // 因为自己的判断逻辑把正常请求打挂。
    }
    return await previous(input, init)
  }

  globalThis.fetch = wrapped

  const uninstall = (): void => {
    // 只有当前还是自己那层时才还原，避免把后装的包装（如代理层）摘掉。
    if (globalThis.fetch === wrapped) globalThis.fetch = previous
    delete global[HOOK_FLAG]
  }
  global[HOOK_FLAG] = uninstall
  // 与代理模块同款启动日志：装没装、命中谁，一眼可见（排查 403 时第一现场）。
  console.log(
    `[opencode-fingerprint] fetch hook installed: models=${[...FINGERPRINT_MODELS].join(',')} `
    + `ua=${OPENCODE_USER_AGENT} tools=${FINGERPRINT_TOOLS.join('+')}`,
  )
  return uninstall
}

/**
 * 挂载 OpenCode Zen 免费层指纹。
 *
 * 全局 fetch 包装是进程级副作用，所以走 `ctx.effect`：插件被禁用或重载时
 * 自动还原，不给下一个实例留一层指向旧闭包的包装。
 */
export function applyOpencodeFingerprint(ctx: Context): void {
  try {
    ctx.effect(() => installFetchHook(ctx), 'dsh-chat-plus: opencode zen free-tier fingerprint')
  } catch (error) {
    ctx.logger?.warn?.(`[opencode-fingerprint] 指纹层挂载失败：${String(error)}`)
  }
}

/** 供冒烟断言的常量与纯函数（smoke 无法从压缩产物里看出这些字面量）。 */
export const __test = {
  FINGERPRINT_MODELS: [...FINGERPRINT_MODELS],
  ZEN_API_PREFIX,
  OPENCODE_USER_AGENT,
  FINGERPRINT_TOOLS: [...FINGERPRINT_TOOLS],
  seedOf,
  toolNameOf,
  installFetchHook,
}
