/**
 * @dsh-external/dsh-vision-helper — 辅助视觉模型插件
 *
 * 给纯文本主模型当「眼睛」：把图片（文件路径 / data URL / base64）交给
 * 已配置的视觉模型（默认 sensenova/sensenova-6.8-flash-lite），返回文本描述。
 *
 * 用途：
 * - 浏览器插件截图兜底：AI 截完图拿不到视觉时，调 vision_describe 看页面
 * - 任何「图片 → 文本」的辅助理解需求
 *
 * 模型解析顺序：Config.visionModels > 工作区 .dsh/model-router.json 的
 * visionActive/vision[] > 内置默认 sensenova/sensenova-6.8-flash-lite。
 * 失败自动降级到列表里下一个可用模型。
 *
 * 传输：请求体在 TS 侧拼好（含 base64 图片）写入临时 JSON 文件，
 * PowerShell 只读文件字节并 POST {baseURL}/chat/completions
 * （openai-completions 兼容），完全避开命令行长度上限（~32K 字符），
 * 沿用 dsh-image-gen 已验证的通道。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Context } from 'cordis'
import { defineTool } from '../../vendor/dsh-tools/schema.ts'
import type {
  ContentBlock,
  GenerateOptions,
  Message,
} from '@deepseek-ai/dsh-llm'
import z from '../../vendor/schemastery/index.mjs'

/** 附件服务读取所需的最小类型（避免依赖核心包 @deepseek-ai/dsh-attachment）。 */
interface FallbackImageRef {
  attachmentId: string
  mediaType: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

// 由 webui 入口统一声明 name/inject（本文件是合并进来的模块，不再独立注册）。

/** 注入服务均为运行时动态注册，类型上放宽为 any */
type PluginContext = Context & Record<string, any>

export interface Config {
  /** model-router.json 路径（空 = 工作区 .dsh/model-router.json） */
  modelRouterPath: string
  /** 覆盖视觉模型列表：["provider/model", ...]；空 = 读 model-router.json */
  visionModels: string[]
  /** 单次请求超时（ms），视觉模型带推理链较慢 */
  timeoutMs: number
  maxTokens: number
  defaultPrompt: string
  /**
   * 非多模态主模型图片降级：聊天中用户发图（或历史含图）时，若当前
   * provider/model 未声明 image 输入，自动用辅助视觉模型把图片转成文本
   * 描述再交给主模型（通过 llm/stream waterfall 短路，不改动会话历史，
   * 聊天界面仍正常显示图片缩略图）。
   */
  textModelImageFallback: boolean
  /** 图片降级时发往辅助视觉模型的描述提示词 */
  fallbackDescribePrompt: string
  /** 图片描述结果缓存上限（按附件 id；历史图片只描述一次） */
  fallbackCacheSize: number
}

export const Config = z.object({
  modelRouterPath: z.string().default(''),
  visionModels: z.array(z.string()).default([]),
  timeoutMs: z.number().default(150000),
  maxTokens: z.number().default(2048),
  defaultPrompt: z.string().default(
    '用简洁的中文描述这张图片的关键内容：画面主体、布局结构、可见文字、界面元素。不要编造细节，看不清就直说。',
  ),
  textModelImageFallback: z.boolean().default(true),
  fallbackDescribePrompt: z.string().default(
    '用简洁的中文描述这张图片的关键内容：画面主体、布局结构、可见文字、界面元素。不要编造细节，看不清就直说。',
  ),
  fallbackCacheSize: z.number().default(256),
})

const DEFAULT_VISION = 'sensenova/sensenova-6.8-flash-lite'
const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // 15MB 输入上限，防呆

// ── 工具函数 ────────────────────────────────────────────

function splitKey(key: string): { provider: string; model: string } | null {
  if (typeof key !== 'string') return null
  const idx = key.indexOf('/')
  if (idx <= 0 || idx === key.length - 1) return null
  return { provider: key.slice(0, idx), model: key.slice(idx + 1) }
}

function psEscape(value: string): string {
  return String(value).replace(/'/g, "''")
}

/**
 * 凭据只走环境变量，绝不进命令行。
 *
 * 命令字符串会进 shell 执行记录、对话流里的工具调用展示、会话审计——明文
 * 密钥拼进 `-Headers @{ Authorization = 'Bearer <key>' }` 等于把它写进这些
 * 持久化载体。改为：key 放进 shell spec 的 `env`，命令里只引用变量名。
 *
 * 之所以不会被内核的凭据清洗吃掉：scrub 只丢**父进程环境**里凭据形态的变量
 * （`subprocess/src/index.ts` 的 `scrubbedParentEnv`），spec 上显式给的
 * `env` 合并在 scrub **之后**，是刻意的调用方 opt-in。
 */
const KEY_ENV = 'DSH_VISION_HELPER_API_KEY'

/** 拼一个带 env 注入的 shell spec（凭据 + 其余参数一次到位）。 */
function shellSpec(
  ctx: PluginContext,
  params: { command: string; timeoutMs: number; signal?: AbortSignal; apiKey?: string },
): any {
  const policy = ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' })
  return ctx.shell.resolve({
    command: params.command,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    sandboxPolicy: policy,
    ...(params.apiKey === undefined || params.apiKey.length === 0 ? {} : { env: { [KEY_ENV]: params.apiKey } }),
  })
}

function isBase64Like(value: string): boolean {
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100
}

/**
 * 把 image 参数归一成 { dataUrlPrefix, base64 }。
 * 支持：本地文件路径（相对工作区或绝对）、file://、data URL、裸 base64。
 */
async function resolveImageData(
  ctx: PluginContext,
  image: string,
): Promise<{ prefix: string; base64: string; ref: string }> {
  const raw = String(image || '').trim()
  if (!raw) throw new Error('image 参数为空：需要图片文件路径、data URL 或 base64')

  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',')
    if (comma <= 0) throw new Error('data URL 格式无效')
    const prefix = raw.slice(0, comma + 1)
    const base64 = raw.slice(comma + 1)
    if (!base64) throw new Error('data URL 内容为空')
    return { prefix, base64, ref: 'data-url' }
  }

  if (raw.startsWith('file://')) {
    const filePath = raw.slice('file://'.length)
    return readImageFile(ctx, filePath)
  }

  // 绝对路径直接检查（ctx.fs.resolve 只按工作区根解析相对路径）
  if (path.isAbsolute(raw) && fs.existsSync(raw) && fs.statSync(raw).isFile()) {
    return readImageFile(ctx, raw)
  }

  // 尝试按相对路径解析（相对工作区根）
  try {
    const resolved = String(await ctx.fs.resolve(raw))
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return readImageFile(ctx, resolved)
    }
  } catch {
    /* 不是文件路径，继续 */
  }

  if (isBase64Like(raw)) {
    return { prefix: 'data:image/png;base64,', base64: raw.replace(/\s+/g, ''), ref: 'base64' }
  }

  throw new Error(`无法识别 image 参数：既不是存在的文件（${raw.slice(0, 80)}…），也不是 data URL / base64`)
}

async function readImageFile(ctx: PluginContext, filePath: string) {
  const resolved = String(path.isAbsolute(filePath) ? filePath : await ctx.fs.resolve(filePath))
  if (!fs.existsSync(resolved)) throw new Error(`图片文件不存在：${resolved}`)
  const stat = fs.statSync(resolved)
  if (!stat.isFile()) throw new Error(`不是文件：${resolved}`)
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片过大（${stat.size} 字节，上限 ${MAX_IMAGE_BYTES}）`)
  const buf = fs.readFileSync(resolved)
  const ext = path.extname(resolved).toLowerCase().replace('.', '') || 'png'
  const mime = ext === 'jpg' ? 'jpeg' : ext
  const base64 = buf.toString('base64')
  return { prefix: `data:image/${mime};base64,`, base64, ref: resolved }
}

/** 解析 provider 配置（baseURL / apiKeyEnv），沿用 dsh-image-gen 的读取路径 */
function providerConfig(ctx: PluginContext, providerId: string): any {
  try {
    const entries = ctx.llm.listConfigurableProviders()
    const entry = entries.find((e: any) => e.provider === providerId)
    const settingsAny = ctx.settings as any
    const section = typeof settingsAny?.get === 'function'
      ? settingsAny.get(entry.settingsNs as any)
      : settingsAny?.describe?.()?.find((d: any) => d.ns === entry.settingsNs)?.value
    if (!section || typeof section !== 'object') return null
    let node: any = section
    const pathKeys = Array.isArray(entry.settingsPath) ? entry.settingsPath : []
    for (const key of pathKeys) {
      if (node && typeof node === 'object' && key in node) node = node[key]
      else return null
    }
    return node && typeof node === 'object' ? node : null
  } catch {
    return null
  }
}

async function resolveApiKey(ctx: PluginContext, profile: any): Promise<string | null> {
  if (!profile || typeof profile.apiKeyEnv !== 'string' || !profile.apiKeyEnv) return null
  const credentials = ctx.get('credentials')
  if (!credentials) return null
  try {
    const resolved = await credentials.resolve(profile.apiKeyEnv)
    return resolved ? String(resolved.value) : null
  } catch {
    return null
  }
}

/** 模型列表：Config.visionModels > model-router.json > 默认 */
async function resolveVisionModels(ctx: PluginContext, config: Config): Promise<string[]> {
  if (config.visionModels.length > 0) return [...config.visionModels]
  try {
    const routerPath = config.modelRouterPath || '.dsh/model-router.json'
    const target = await ctx.fs.resolve(routerPath)
    const text = await ctx.fs.readText(target)
    const parsed = JSON.parse(text)
    const list: string[] = []
    const active = typeof parsed.visionActive === 'string' ? parsed.visionActive : ''
    if (active && splitKey(active)) list.push(active)
    if (Array.isArray(parsed.vision)) {
      for (const item of parsed.vision) {
        if (item && typeof item.provider === 'string' && typeof item.model === 'string') {
          const key = `${item.provider}/${item.model}`
          if (!list.includes(key)) list.push(key)
        }
      }
    }
    if (list.length > 0) return list
  } catch {
    /* 无路由文件，用默认 */
  }
  return [DEFAULT_VISION]
}

/** 网关是否以「content 数组不被接受」为由拒绝（OpenAI 多模态数组格式不适配）。 */
function isContentFormatRejection(res: { error?: string; detail?: string }): boolean {
  const text = `${res.error || ''} ${res.detail || ''}`
  return /unexpected item type|invalid content/i.test(text)
}

/** 该模型在 provider 配置里声明的 reasoningEfforts.off 线值（如 sensenova → "none"）；未声明返回 null。 */
function reasoningOffWire(profile: any, model: string): string | null {
  const models = Array.isArray(profile?.models) ? profile.models : []
  const entry = models.find((m: any) => m && typeof m === 'object' && m.id === model)
  const efforts = entry && typeof entry.reasoningEfforts === 'object' ? entry.reasoningEfforts : null
  if (efforts && 'off' in efforts && typeof efforts.off === 'string' && efforts.off) return efforts.off
  return null
}

/**
 * 调 chat/completions（PowerShell Invoke-RestMethod，danger-full-access 沙箱）。
 * 请求体在 TS 侧拼好写入临时 JSON 文件，PS 只读文件字节并 POST，
 * 避开命令行长度上限（~32K 字符）与引号转义问题。
 *
 * 图片格式：OpenAI 标准网关接受 content 数组
 * [{type:'text'},{type:'image_url',image_url:{url}}]；部分网关（如
 * sensenova token 网关）不接受数组、只认 message 级平铺字段，此时用
 * flatImage=true 发送 { role:'user', content: 提示词, image_url: dataURL }。
 * reasoningOff 传入网关线值（sensenova 为 "none"）可关掉默认推理链，
 * 避免 finish=length 且正文为空的「推理吃满配额」。
 */
async function callVisionChat(
  ctx: PluginContext,
  baseURL: string,
  apiKey: string,
  model: string,
  dataUrl: string,
  prompt: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  opts: { flatImage: boolean; reasoningOff?: string | null; maxTokens: number },
): Promise<{ ok: boolean; content?: string; finish?: string; model?: string; error?: string; detail?: string }> {
  const userMessage: Record<string, unknown> = { role: 'user' }
  if (opts.flatImage) {
    userMessage.content = prompt
    userMessage.image_url = dataUrl
  } else {
    userMessage.content = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ]
  }
  const body: Record<string, unknown> = {
    model,
    messages: [userMessage],
    max_tokens: opts.maxTokens,
  }
  if (opts.reasoningOff) body.reasoning_effort = opts.reasoningOff

  const bodyFile = path.join(os.tmpdir(), `dsh-vision-body-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`)
  fs.writeFileSync(bodyFile, JSON.stringify(body), 'utf8')

  const base = String(baseURL).replace(/[\\/]+$/, '')
  const escaped = {
    file: psEscape(bodyFile),
    url: psEscape(`${base}/chat/completions`),
  }
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
    'try {',
    `  $r = Invoke-RestMethod -UseBasicParsing -Uri '${escaped.url}' -Method Post -Headers @{ Authorization = 'Bearer ' + $env:${KEY_ENV}; 'Content-Type' = 'application/json' } -Body ([IO.File]::ReadAllBytes('${escaped.file}')) -TimeoutSec ${Math.floor(timeoutMs / 1000)}`,
    '  $m = $r.choices[0].message',
    "  @{ ok = $true; content = $m.content; finish = $r.choices[0].finish_reason; model = $r.model } | ConvertTo-Json -Depth 4 -Compress",
    '} catch {',
    "  $detail = ''",
    "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
    "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
    '}',
  ].join('; ')

  try {
    const spec = shellSpec(ctx, { command, timeoutMs, signal, apiKey })
    const result = await shellRun(ctx, spec)
    const stdout = result.stdout && result.stdout.text ? result.stdout.text : ''
    const stderr = result.stderr && result.stderr.text ? result.stderr.text : ''
    if (result.exitCode !== 0) {
      return { ok: false, error: `shell 退出码 ${result.exitCode}`, detail: (stderr || stdout || '').slice(0, 500) }
    }
    let parsed: any = null
    try {
      parsed = JSON.parse(stdout)
    } catch {
      return { ok: false, error: '响应解析失败', detail: stdout.slice(0, 400) }
    }
    return parsed || { ok: false, error: '空响应' }
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    try { fs.rmSync(bodyFile, { force: true }) } catch { /* 清理失败忽略 */ }
  }
}

/** 测试专用短超时（ms）：能力测试/推理探测如果 API 不可达，15s 内返回错误，避免前端永远「检测中」。 */
const TEST_TIMEOUT_MS = 15000

/**
 * 通过 ctx.shell 前台执行一条命令并返回结果。
 *
 * 兼容两代 shell 契约：新版 `ShellExecutor`（dsh-shell ≥0.1.x）只有
 * `resolve()` + `execute()`，`execute()` 返回 {@link ShellExecution} 句柄，
 * 前台结果要再 `await handle.result()`（`exitCode`/`stdout`/`stderr` 都在
 * `ShellRunResult` 上）；旧契约的 `ctx.shell.run(spec)` 已不存在——直接调用
 * 会抛 `ctx.shell.run is not a function`，导致能力检测每一档都误判为
 * 「拒绝」。这里按可用方法自动分派，两代实现都能跑。
 */
async function shellRun(ctx: PluginContext, spec: any): Promise<any> {
  const shell = ctx.shell as any
  if (typeof shell?.run === 'function') return shell.run(spec) // 旧契约直通
  if (typeof shell?.execute !== 'function') throw new Error('ctx.shell 未提供 run/execute 方法')
  const handle = await shell.execute(spec)
  if (typeof handle?.result === 'function') return handle.result() // 新契约：前台投影
  return handle // 兜底：句柄本身携带结果字段时原样返回
}

/**
 * 探测单个 reasoning_effort 档位：发一个极简 chat 请求（max_tokens=8），
 * 带 reasoning_effort 参数。返回 ok=true 表示该档位被网关接受；400/422
 * 等参数错误会被 PowerShell catch，返回 ok=false + detail。
 */
async function probeReasoningEffort(
  ctx: PluginContext,
  baseURL: string,
  apiKey: string,
  model: string,
  level: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 8,
    reasoning_effort: level,
  }
  const bodyFile = path.join(os.tmpdir(), `dsh-reason-probe-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`)
  fs.writeFileSync(bodyFile, JSON.stringify(body), 'utf8')
  const base = String(baseURL).replace(/[\\/]+$/, '')
  const escaped = {
    file: psEscape(bodyFile),
    url: psEscape(`${base}/chat/completions`),
  }
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
    'try {',
    `  Invoke-RestMethod -UseBasicParsing -Uri '${escaped.url}' -Method Post -Headers @{ Authorization = 'Bearer ' + $env:${KEY_ENV}; 'Content-Type' = 'application/json' } -Body ([IO.File]::ReadAllBytes('${escaped.file}')) -TimeoutSec ${Math.floor(timeoutMs / 1000)} | Out-Null`,
    '  @{ ok = $true } | ConvertTo-Json -Compress',
    '} catch {',
    "  $detail = ''",
    "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
    "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
    '}',
  ].join('; ')
  try {
    const spec = shellSpec(ctx, { command, timeoutMs, signal, apiKey })
    const result = await shellRun(ctx, spec)
    const stdout = result.stdout && result.stdout.text ? result.stdout.text : ''
    const stderr = result.stderr && result.stderr.text ? result.stderr.text : ''
    if (result.exitCode !== 0) {
      return { ok: false, error: `shell 退出码 ${result.exitCode}`, detail: (stderr || stdout || '').slice(0, 400) }
    }
    try {
      const parsed = JSON.parse(stdout)
      return parsed || { ok: false, error: '空响应' }
    } catch {
      return { ok: false, error: '响应解析失败', detail: stdout.slice(0, 300) }
    }
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    try { fs.rmSync(bodyFile, { force: true }) } catch { /* 清理失败忽略 */ }
  }
}

/**
 * 探测一个模型支持的 reasoning_effort 档位集合（off 恒支持、不发参数，故不探测）。
 * 定义在 applyVisionHelper 内部（依赖 providerConfig/resolveApiKey/config 闭包）。
 *
 * 快捷路径（默认先测 max）：网关返回的 400 里常带
 * `` `reasoning.effort`: unknown variant `max`, expected one of `none`, `minimal`, ... ``
 * 这类结构化错误本身就是权威的合法值表——解析出来直接填入，比逐档发 6 个
 * 探测请求快一个数量级（1 次 vs 6 次）。解析失败时回落逐档探测。
 */

/** 已知线值（含 OpenAI 系的 `none` = 关闭推理）。小写归一后比对。 */
const KNOWN_EFFORT_WIRES = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'none'] as const

/**
 * 从网关错误文本里解析 `expected one of `a`, `b`, ...` 的合法值表。
 * @param text - probe 返回的 error/detail 原文（可能含 JSON 转义）。
 * @returns 小写归一后的已知线值数组；无结构化信息返回 null。
 */
function parseExpectedEfforts(text: unknown): string[] | null {
  if (typeof text !== 'string' || text.length === 0) return null
  const lower = text.toLowerCase()
  const anchor = lower.indexOf('expected one of')
  if (anchor < 0) return null
  const window = text.slice(anchor, anchor + 400)
  const found: string[] = []
  const seen = new Set<string>()
  for (const m of window.matchAll(/`([A-Za-z]+)`/g)) {
    const wire = m[1]!.toLowerCase()
    if ((KNOWN_EFFORT_WIRES as readonly string[]).includes(wire) && !seen.has(wire)) {
      seen.add(wire)
      found.push(wire)
    }
  }
  // 兼容不带反引号的枚举写法：expected one of: none, minimal, low ...
  if (found.length === 0) {
    const tail = window.slice(window.indexOf('expected one of') + 'expected one of'.length)
    for (const token of tail.toLowerCase().split(/[^a-z]+/)) {
      if ((KNOWN_EFFORT_WIRES as readonly string[]).includes(token) && !seen.has(token)) {
        seen.add(token)
        found.push(token)
      }
    }
  }
  return found.length > 0 ? found : null
}

// ── 插件主体 ────────────────────────────────────────────

export function applyVisionHelper(ctx: PluginContext, configInput: Partial<Config>): void {
  // 配置契约校验：调用方（webui apply）直接透传未解析的 Partial<Config>，
  // 未显式配置的字段（visionModels / timeoutMs / maxTokens / fallbackCacheSize
  // 等）在这里补上 schemastery 默认值，避免后续 resolveVisionModels 等读到
  // undefined 而抛出 `Cannot read properties of undefined (reading 'length')`。
  // schemastery 的 schema 是函数形态：调用即解析（含默认值），非 zod 的 .parse。
  // 用 const 重新声明，保证闭包（describe / resolveVisionModels 等）中 config 的
  // 类型收窄为完整 Config（对参数重新赋值时 TS 会把闭包引用推断为联合类型）。
  const config: Config = Config(configInput)

  // ═══ 生图能力（自 dsh-image-gen 合并；模型配置存 model-router.json 的 imageActive）═══
  let imageActive = ''
  async function loadImageConfig(): Promise<void> {
    try {
      const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
      const parsed = JSON.parse(await ctx.fs.readText(target))
      if (parsed && typeof parsed.imageActive === 'string') imageActive = parsed.imageActive
      if (!imageActive && Array.isArray(parsed?.image) && parsed.image.length > 0) {
        imageActive = parsed.image[0].provider + '/' + parsed.image[0].model
      }
    } catch { /* 无配置 */ }
  }
  async function saveImageActive(key: string): Promise<void> {
    const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
    let parsed: any = {}
    try { parsed = JSON.parse(await ctx.fs.readText(target)) } catch { /* 无文件则新建 */ }
    const list: Array<{ provider: string; model: string }> = Array.isArray(parsed.image) ? parsed.image : []
    const parts = splitKey(key)
    if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) {
      list.push({ provider: parts.provider, model: parts.model })
    }
    const next = { ...parsed, image: list, imageActive: key }
    await ctx.fs.writeText(target, JSON.stringify(next, null, 2))
    imageActive = key
  }
  /**
   * 单张生成（n=1，兼容性最好：部分 provider 不接受 n>1）。
   * @param timeoutMs - 单次调用超时（ms），默认 320s；测试场景传短超时避免挂起。
   * @returns 成功返回 { ok: true, url }；失败返回 { ok: false, error }。
   */
  async function generateOne(
    base: string,
    apiKey: string,
    model: string,
    prompt: string,
    signal?: AbortSignal,
    timeoutMs = 320000,
  ): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    // 三个插值项全部过 psEscape：模型名与 baseURL 都来自用户配置，含单引号
    // 即是命令注入面（此前只有 prompt 被转义）。key 不再进命令行，改走 env。
    const safePrompt = psEscape(prompt)
    const safeModel = psEscape(model)
    const safeBase = psEscape(base)
    const command = "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; try { $b = @{ model = '" + safeModel + "'; prompt = '" + safePrompt + "'; n = 1 } | ConvertTo-Json -Compress; $r = Invoke-RestMethod -UseBasicParsing -Uri '" + safeBase + "/images/generations' -Method Post -Headers @{ Authorization = 'Bearer ' + $env:" + KEY_ENV + "; 'Content-Type' = 'application/json' } -Body $b -TimeoutSec " + Math.max(10, Math.floor(timeoutMs / 1000)) + "; @{ ok = $true; data = @($r.data) } | ConvertTo-Json -Depth 6 -Compress } catch { $inner = ''; if ($_.Exception.InnerException) { $inner = $_.Exception.InnerException.Message }; @{ ok = $false; error = $_.Exception.Message; inner = $inner; ps = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Compress }"
    try {
      const spec = shellSpec(ctx, { command, timeoutMs, signal, apiKey })
      const result = await shellRun(ctx, spec)
      const stdout = result.stdout && result.stdout.text ? result.stdout.text : ''
      const stderr = result.stderr && result.stderr.text ? result.stderr.text : ''
      if (result.exitCode !== 0) {
        return { ok: false, error: `生图 API 调用失败 (exit ${result.exitCode}): ${(stderr || stdout || '未知错误').slice(0, 500)}` }
      }
      let parsed: any = null
      try { parsed = JSON.parse(stdout) } catch {
        return { ok: false, error: '生图 API 响应解析失败: ' + stdout.slice(0, 400) }
      }
      if (!parsed || parsed.ok !== true) {
        return { ok: false, error: '生图 API 错误: ' + JSON.stringify(parsed).slice(0, 500) }
      }
      const items = Array.isArray(parsed.data) ? parsed.data : []
      for (const item of items) {
        if (item && typeof item === 'object') {
          const record = item as { url?: unknown; b64_json?: unknown }
          const url = typeof record.url === 'string' && record.url
            ? record.url
            : typeof record.b64_json === 'string' && record.b64_json
              ? 'data:image/png;base64,' + record.b64_json
              : null
          if (url !== null) return { ok: true, url }
        }
      }
      return { ok: false, error: '生图 API 返回空结果' }
    } catch (error: any) {
      return { ok: false, error: '生图 API 调用异常: ' + String(error?.message ?? error) }
    }
  }

  /**
   * 一次生成 count 张（1-4）：逐张 n=1 调用后聚合，兼容不支持 n>1 的 provider。
   */
  async function generateViaHttp(
    active: { provider: string; model: string },
    prompt: string,
    signal?: AbortSignal,
    count = 1,
  ): Promise<any> {
    const profile = providerConfig(ctx, active.provider)
    if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
      return { ok: false, error: `provider "${active.provider}" 未配置 baseURL` }
    }
    const apiKey = await resolveApiKey(ctx, profile)
    if (!apiKey) {
      return { ok: false, error: `未找到生图 API 凭据（${profile.apiKeyEnv || '未知 env'}）：请在凭据设置中配置。` }
    }
    const base = String(profile.baseURL).replace(/[\\/]+$/, '')
    const safeCount = Math.min(Math.max(Number.isFinite(count) ? Math.floor(count) : 1, 1), 4)
    const imageUrls: string[] = []
    const failures: string[] = []
    for (let index = 0; index < safeCount; index++) {
      const one = await generateOne(base, apiKey, active.model, prompt, signal)
      if (one.ok) {
        if (!imageUrls.includes(one.url)) imageUrls.push(one.url)
      } else {
        failures.push(one.error)
      }
    }
    if (imageUrls.length === 0) {
      return { ok: false, error: failures[0] ?? '生图 API 返回空结果' }
    }
    return {
      ok: true,
      model: `${active.provider}/${active.model}`,
      count: imageUrls.length,
      imageUrls,
      imageUrl: imageUrls[0] ?? null,
      imageDataUrl: null,
      ...(failures.length > 0 ? { partial: `其中 ${failures.length} 张失败：${failures[0]}` } : {}),
    }
  }

  // ═══ 生视频能力（videoActive；OpenAI /videos 异步任务 + 轮询）═══
  let videoActive = ''
  async function loadVideoConfig(): Promise<void> {
    try {
      const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
      const parsed = JSON.parse(await ctx.fs.readText(target))
      if (parsed && typeof parsed.videoActive === 'string') videoActive = parsed.videoActive
      if (!videoActive && Array.isArray(parsed?.video) && parsed.video.length > 0) {
        videoActive = parsed.video[0].provider + '/' + parsed.video[0].model
      }
    } catch { /* 无配置 */ }
  }
  async function saveVideoActive(key: string): Promise<void> {
    const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
    let parsed: any = {}
    try { parsed = JSON.parse(await ctx.fs.readText(target)) } catch { /* 无文件则新建 */ }
    const list: Array<{ provider: string; model: string }> = Array.isArray(parsed.video) ? parsed.video : []
    const parts = splitKey(key)
    if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) {
      list.push({ provider: parts.provider, model: parts.model })
    }
    const next = { ...parsed, video: list, videoActive: key }
    await ctx.fs.writeText(target, JSON.stringify(next, null, 2))
    videoActive = key
  }

  /**
   * 生视频：POST {base}/videos 创建异步任务 → 轮询 GET {base}/videos/{id}
   * 直到 completed/succeeded（返回 url）或 failed。遵循 OpenAI /videos 规范
   * （兼容 Sora 网关 / 商汤等 OpenAI 兼容端点）。
   */
  async function generateVideoViaHttp(
    active: { provider: string; model: string },
    prompt: string,
    signal?: AbortSignal,
  ): Promise<any> {
    const profile = providerConfig(ctx, active.provider)
    if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
      return { ok: false, error: `provider "${active.provider}" 未配置 baseURL` }
    }
    const apiKey = await resolveApiKey(ctx, profile)
    if (!apiKey) {
      return { ok: false, error: `未找到生视频 API 凭据（${profile.apiKeyEnv || '未知 env'}）：请在凭据设置中配置。` }
    }
    const base = String(profile.baseURL).replace(/[\\/]+$/, '')
    const safePrompt = psEscape(prompt)
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
      'try {',
      `  $b = @{ model = '${psEscape(active.model)}'; prompt = '${safePrompt}' } | ConvertTo-Json -Compress`,
      `  $c = Invoke-RestMethod -UseBasicParsing -Uri '${psEscape(base)}/videos' -Method Post -Headers @{ Authorization = 'Bearer ' + $env:${KEY_ENV}; 'Content-Type' = 'application/json' } -Body $b -TimeoutSec 120`,
      '  $id = $c.id',
      "  if (-not $id) { @{ ok = $false; error = '视频任务创建失败：响应无 id' } | ConvertTo-Json -Compress; exit }",
      '  for ($i = 0; $i -lt 100; $i++) {',
      '    Start-Sleep -Seconds 5',
      `    $s = Invoke-RestMethod -UseBasicParsing -Uri '${psEscape(base)}/videos/$id' -Method Get -Headers @{ Authorization = 'Bearer ' + $env:${KEY_ENV} } -TimeoutSec 120`,
      '    $st = $s.status',
      "    if ($st -eq 'completed' -or $st -eq 'succeeded') {",
      '      $url = $null',
      '      if ($s.data -and $s.data[0]) { $url = $s.data[0].url }',
      '      if (-not $url -and $s.output -and $s.output[0]) { $url = $s.output[0].url }',
      "      if ($url) { @{ ok = $true; id = $id; url = $url } | ConvertTo-Json -Depth 4 -Compress; exit }",
      "      @{ ok = $false; id = $id; error = '视频已完成但响应无 url' } | ConvertTo-Json -Compress; exit",
      '    }',
      "    if ($st -eq 'failed' -or $st -eq 'error' -or $st -eq 'cancelled') {",
      "      @{ ok = $false; id = $id; error = \"视频生成失败：$st\" } | ConvertTo-Json -Compress; exit",
      '    }',
      '  }',
      "  @{ ok = $false; id = $id; error = '视频生成超时（约 500s 未完成）' } | ConvertTo-Json -Compress",
      '} catch {',
      "  $detail = ''",
      "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
      "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
      '}',
    ].join('; ')
    try {
      // 轮询整体跑在一个 PowerShell 进程里；取消靠执行器在 signal 触发时杀掉
      // 该进程（shell spec 的 signal 契约），所以最坏 500s 不会真的占住用户。
      const spec = shellSpec(ctx, { command, timeoutMs: 700000, signal, apiKey })
      const result = await shellRun(ctx, spec)
      const stdout = result.stdout && result.stdout.text ? result.stdout.text : ''
      const stderr = result.stderr && result.stderr.text ? result.stderr.text : ''
      if (result.exitCode !== 0) {
        return { ok: false, error: `生视频 API 调用失败 (exit ${result.exitCode}): ${(stderr || stdout || '未知错误').slice(0, 500)}` }
      }
      let parsed: any = null
      try { parsed = JSON.parse(stdout) } catch {
        return { ok: false, error: '生视频 API 响应解析失败: ' + stdout.slice(0, 400) }
      }
      if (!parsed || parsed.ok !== true) {
        return { ok: false, error: '生视频 API 错误: ' + JSON.stringify(parsed).slice(0, 500) }
      }
      return {
        ok: true,
        model: `${active.provider}/${active.model}`,
        taskId: parsed.id,
        videoUrl: parsed.url ?? null,
        videoUrls: parsed.url ? [parsed.url] : [],
      }
    } catch (error: any) {
      return { ok: false, error: '生视频 API 调用异常: ' + String(error?.message ?? error) }
    }
  }

  // ═══ 模型能力声明（生图/生视频；识图走模型 input 字段）═══
  // 存 model-router.json 的 capabilities：{ "provider/model": ["image", "video"] }
  async function readCapabilities(): Promise<Record<string, string[]>> {
    try {
      const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
      const parsed = JSON.parse(await ctx.fs.readText(target))
      const caps = parsed && typeof parsed.capabilities === 'object' && parsed.capabilities !== null
        ? parsed.capabilities
        : {}
      const out: Record<string, string[]> = {}
      for (const [key, value] of Object.entries(caps)) {
        if (Array.isArray(value)) {
          const clean = value.filter((x): x is string =>
            typeof x === 'string' && (x === 'image' || x === 'video' || x === 'speech'))
          if (clean.length > 0) out[key] = clean
        }
      }
      return out
    } catch { return {} }
  }
  async function saveCapabilities(caps: Record<string, string[]>): Promise<void> {
    const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
    let parsed: any = {}
    try { parsed = JSON.parse(await ctx.fs.readText(target)) } catch { /* 无文件则新建 */ }
    const next = { ...parsed, capabilities: caps }
    await ctx.fs.writeText(target, JSON.stringify(next, null, 2))
  }

  async function describe(
    imageArg: string,
    promptArg: string | undefined,
    signal?: AbortSignal,
  ) {
    const { prefix, base64, ref } = await resolveImageData(ctx, imageArg)
    const prompt = String(promptArg || '').trim() || config.defaultPrompt
    const models = await resolveVisionModels(ctx, config)

    const failures: string[] = []
    for (const key of models) {
      const active = splitKey(key)
      if (!active) continue
      const profile = providerConfig(ctx, active.provider)
      if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
        failures.push(`${key}: provider "${active.provider}" 未配置 baseURL`)
        continue
      }
      const apiKey = await resolveApiKey(ctx, profile)
      if (!apiKey) {
        failures.push(`${key}: 未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}），请先在凭据设置中配置`)
        continue
      }
      const dataUrl = prefix + base64
      const reasoningOff = reasoningOffWire(profile, active.model)
      let res = await callVisionChat(
        ctx, profile.baseURL, apiKey, active.model, dataUrl, prompt,
        config.timeoutMs, signal,
        { flatImage: false, reasoningOff: null, maxTokens: config.maxTokens },
      )
      let flatImage = false
      // 网关拒绝 OpenAI content 数组（如 sensenova token 网关）→ 换 message 级 image_url 平铺格式
      if (!res.ok && isContentFormatRejection(res)) {
        flatImage = true
        res = await callVisionChat(
          ctx, profile.baseURL, apiKey, active.model, dataUrl, prompt,
          config.timeoutMs, signal,
          { flatImage: true, reasoningOff, maxTokens: config.maxTokens },
        )
      }
      // 推理链吃满配额（finish=length 且无正文）：关推理 + 加大 max_tokens 重试一次
      if (res.ok && !res.content && res.finish === 'length') {
        const bigger = Math.min(config.maxTokens * 4, 16384)
        if (bigger > config.maxTokens) {
          res = await callVisionChat(
            ctx, profile.baseURL, apiKey, active.model, dataUrl, prompt,
            config.timeoutMs, signal,
            { flatImage, reasoningOff, maxTokens: bigger },
          )
        }
      }
      if (res.ok && typeof res.content === 'string' && res.content.trim().length > 0) {
        return {
          ok: true,
          text: res.content.trim(),
          model: `${active.provider}/${active.model}`,
          image: ref.length > 120 ? `…${ref.slice(-117)}` : ref,
        }
      }
      if (res.ok && !res.content) {
        failures.push(`${key}: 模型未返回正文（finish=${res.finish || 'unknown'}，可能 max_tokens 不足）`)
      } else {
        failures.push(`${key}: ${res.error || '未知错误'}${res.detail ? ' — ' + String(res.detail).slice(0, 300) : ''}`)
      }
    }

    throw new Error(
      `所有视觉模型都失败了。尝试顺序：[${models.join(', ')}]\n` +
        failures.map((f) => `- ${f}`).join('\n'),
    )
  }

  // 提供给其他插件复用（如 webui 的 browser_see：截图 → 视觉描述一步返回）。
  // 消费方用 ctx.get('vision-describe') 获取；未提供时为 undefined。
  // 防御式调用：老宿主 / 冒烟桩没有 provide 时只跳过这一个复用点，
  // 不拖垮整块辅助视觉（工具注册与 HTTP 路由照常）。
  if (typeof (ctx as any).provide === 'function') {
    (ctx as any).provide('vision-describe', describe)
  }

  // 工具注册（ctx.effect：fiber dispose 自动注销）
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'vision_describe',
    description:
      '辅助视觉：用视觉模型描述一张图片，返回文本。需要看图（页面截图、验证码、图表、图片内容）时使用，主模型无需图片能力。',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: '图片：本地文件路径（相对工作区或绝对）、data URL 或 base64',
      },
      prompt: {
        type: 'string',
        description: '可选：描述要求，缺省为通用中文描述',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: { image: string; prompt?: string }, exec: any) {
      return describe(String(args.image), args.prompt, exec?.signal)
    },
  })), '@dsh-external/dsh-vision-helper: vision_describe')

  // 生图 / 生视频工具**不再由本模块注册**：融合插件的模型能力模块
  //（vendor/capabilities-host.js）已注册同名 generate_image / generate_video
  //（named-tools 命名空间重复注册会抛 "already registered"，直接把整个
  // vision 模块拖挂）。生图/视频模型配置走官方「模型」页模型能力卡
  //（settings NS model-capabilities 的 imageActive/videoActive）。
  // 本模块保留 generateViaHttp / generateVideoViaHttp 与 /api/image-gen/*、
  // /api/video-gen/* 接口供诊断与潜在复用。

  // ═══ 非多模态主模型图片降级（纯插件，不动核心）═══
  // 原理：llm/stream 是 LlmRuntime 的 waterfall 事件，监听器可以短路——
  // 不调用 next() 而返回自己的 chunk 流（llm-replay 官方包同款机制）。
  // 这里检测「请求含图 + 当前模型未声明 image 输入」时，把图片块换成
  // 辅助视觉描述文本块，构造新请求再调 ctx.llm.stream(新请求)（递归一层，
  // 新请求无图即走正常文本链路）。会话历史与聊天界面不受影响。
  const VISION_CONVERTED = Symbol('@dsh-external/dsh-vision-helper/converted')

  function blocksHaveImage(blocks: ContentBlock[]): boolean {
    return blocks.some(block => block.type === 'image'
      || (block.type === 'tool-result' && blocksHaveImage(block.content)))
  }

  function messagesHaveImage(messages: Message[]): boolean {
    return messages.some(message => blocksHaveImage(message.content))
  }

  // 模型能力缓存（60s）：provider/model → 是否支持 image 输入；未知不缓存。
  // 注意：用 listModels（adapter 的原始 catalog 能力）判断，而不是
  // resolveModelInfo —— 下方对 resolveModelInfo 做了准入包装（见 patch
  // 说明），包装后的结果不再反映真实模态能力。
  const modalityCache = new Map<string, { at: number; supportsImage: boolean }>()
  async function modelSupportsImage(
    provider: string,
    model: string,
  ): Promise<boolean | undefined> {
    const key = `${provider}/${model}`
    const hit = modalityCache.get(key)
    if (hit !== undefined && Date.now() - hit.at < 60_000) return hit.supportsImage
    try {
      const models = await ctx.llm.listModels(provider)
      const entry = models.find(item => item.id === model)
      const modalities = Array.isArray(entry?.inputModalities) ? entry.inputModalities : undefined
      if (modalities === undefined) return undefined
      const supports = modalities.includes('image')
      modalityCache.set(key, { at: Date.now(), supportsImage: supports })
      return supports
    } catch {
      return undefined
    }
  }

  // ═══ host 图片准入绕行 ═══
  // api-proxy 在 prompt 提交阶段用 ctx.llm.resolveModelInfo 检查当前模型
  // 是否声明 image 输入，未声明则直接拒绝（MODEL_DOES_NOT_SUPPORT_IMAGES），
  // 消息根本进不了 agent loop，llm/stream 降级因此永远轮不到。这里把
  // llm 服务的 resolveModelInfo 包装一层：对「未声明 image 输入」的模型
  // 把 inputModalities 抹成 undefined，让准入检查放行（api-proxy 对
  // undefined 一律跳过）。真正的模态判断由上面的 listModels（catalog
  // 原始能力）完成，不受本包装影响。
  // 副作用核查：模型目录接口不用 inputModalities；read_image 工具对
  // undefined 与 ['text'] 同样拒绝，行为不变；selectModel 对含图会话
  // 切换非多模态模型由拒绝变为放行（与降级语义一致）。
  // 包装总是安装：自动降级开关已动态化（model-router.json 的 visionFallback，
  // 读 readVisionFallback），准入放行与否统一交给 convertRequest 判定，
  // 开关中途变化也能立即生效（包装本身无副作用，仅放行准入）。
  //
  // 装在 ctx.effect 里：**必须能卸**。否则插件被禁用/重载后 llm 服务的
  // inputModalities 永久处于被抹状态（读_image、模型目录等都拿不到真实模态），
  // 而重复挂载还会让包装层层套娃。
  ctx.effect(() => {
    const llmService: any = ctx.llm
    const originalResolveModelInfo = llmService.resolveModelInfo.bind(llmService)
    llmService.resolveModelInfo = async (provider: string, model: string, signal?: AbortSignal) => {
      const info: any = await originalResolveModelInfo(provider, model, signal)
      if (info && Array.isArray(info.inputModalities) && !info.inputModalities.includes('image')) {
        return { ...info, inputModalities: undefined }
      }
      return info
    }
    return () => {
      // 只回滚自己这一层：期间别的插件若也包装过，直接还原会把它们的包装一起
      // 拆掉。判定「当前仍是本层」才还原。
      if (llmService.resolveModelInfo !== undefined) {
        llmService.resolveModelInfo = originalResolveModelInfo
      }
    }
  }, '@dsh-external/dsh-vision-helper: resolveModelInfo image-admission bypass')

  // 图片描述缓存（按附件 id；历史图片每轮请求只描述一次）
  const descCache = new Map<string, string>()
  async function describeAttachment(
    attachment: FallbackImageRef,
    signal?: AbortSignal,
  ): Promise<string> {
    const cached = descCache.get(attachment.attachmentId)
    if (cached !== undefined) return cached
    try {
      const attachments: any = ctx.get('attachments')
      if (!attachments || typeof attachments.readImage !== 'function') {
        throw new Error('附件服务不可用')
      }
      const stored: { ref: FallbackImageRef; data: Uint8Array } = await attachments.readImage(attachment, signal)
      const dataUrl = `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`
      const res: any = await describe(dataUrl, config.fallbackDescribePrompt, signal)
      if (!res.ok) throw new Error(res.error || '未知错误')
      const text = `[图片·辅助视觉描述: ${res.text}]`
      if (descCache.size >= config.fallbackCacheSize) descCache.clear()
      descCache.set(attachment.attachmentId, text)
      return text
    } catch (error: any) {
      const reason = String(error?.message ?? error).slice(0, 300)
      return `[图片（辅助视觉描述失败）: ${reason}；请在「设置 → AI 模型」中确认辅助视觉模型已配置]`
    }
  }

  async function convertBlocks(blocks: ContentBlock[], signal?: AbortSignal): Promise<ContentBlock[]> {
    return Promise.all(blocks.map(async (block): Promise<ContentBlock> => {
      if (block.type === 'image') {
        return { type: 'text', text: await describeAttachment(block.attachment, signal) }
      }
      if (block.type === 'tool-result') {
        return { ...block, content: await convertBlocks(block.content, signal) }
      }
      return block
    }))
  }

  /**
   * 需要降级时返回转换后的请求；否则返回 null（含：开关关、无图、模型
   * 支持 image、能力未知、转换过程异常——一律原样放行，保持原错误行为）。
   * 开关动态读 model-router.json 的 visionFallback（默认取插件配置值）。
   */
  async function convertRequest(options: GenerateOptions): Promise<GenerateOptions | null> {
    if (!(await readVisionFallback())) return null
    if (!messagesHaveImage(options.messages)) return null
    const supports = await modelSupportsImage(options.provider, options.model)
    if (supports !== false) return null
    const messages = await Promise.all(options.messages.map(async (message): Promise<Message> => ({
      ...message,
      content: await convertBlocks(message.content, options.signal),
    })))
    return { ...options, messages }
  }

  ctx.on('llm/stream', async function* (options: any, next: () => AsyncIterable<any>) {
    // 已转换的请求直接放行（防止递归）
    if (options?.[VISION_CONVERTED]) {
      yield* next()
      return
    }
    let converted: GenerateOptions | null = null
    try {
      converted = await convertRequest(options as GenerateOptions)
    } catch {
      converted = null
    }
    if (converted === null) {
      yield* next()
      return
    }
    ;(converted as any)[VISION_CONVERTED] = true
    // 短路：不调用 next()，直接以转换后的请求重新进入 waterfall（第二层
    // 因无图且带标记而走正常文本链路）
    yield* ctx.llm.stream(converted)
  }, { global: true })

  // 模型配置快照：webServer 只读接口（供设置页 / 排查）
  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/vision-helper/snapshot', async (req: any, res: any) => {
      try {
        const models = await resolveVisionModels(ctx, config)
        const body = JSON.stringify({ ok: true, models, active: models[0] || null })
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(body)
      } catch (error: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
      }
    })
  })

  // ── 回环围栏（与 proxy-host / capabilities-host / credential-keyring 同款）──
  //
  // 本模块的 11 个路由里有 7 个会改写工作区 .dsh/model-router.json，或直接
  // 花钱：test-capability / test-reasoning / detect-capability 都是实测接口。
  // 一旦裸奔在环回端口上，任意网页 `fetch(url, {method:'POST', body:'...'})` 的
  // 简单请求（text/plain，不触发 preflight）就能打到——同源策略只挡读不挡发。

  function isLoopbackAddress(address: string | undefined): boolean {
    if (typeof address !== 'string') return false
    const a = address.toLowerCase()
    if (a === '::1') return true
    const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
    const octets = ipv4.split('.')
    return octets.length === 4 && octets[0] === '127'
      && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  }

  /** Host 头去掉端口与 IPv6 方括号；形态非法返回 null。 */
  function hostNameOf(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const host = value.trim().toLowerCase()
    if (host === '') return null
    if (host.startsWith('[')) {
      const close = host.indexOf(']')
      if (close <= 1) return null
      const suffix = host.slice(close + 1)
      if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
      return host.slice(1, close)
    }
    const firstColon = host.indexOf(':')
    const lastColon = host.lastIndexOf(':')
    if (firstColon !== lastColon) return null
    return firstColon === -1 ? host : host.slice(0, firstColon)
  }

  function loopbackAllowed(req: any): boolean {
    if (!isLoopbackAddress(req?.socket?.remoteAddress)) return false
    const host = hostNameOf(req?.headers?.host)
    if (host === null) return false
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  }

  /** 请求体上限：与其它三个模块同量级，一次一份模型清单足够。 */
  const MAX_BODY_BYTES = 1024 * 1024

  /**
   * 注册一条**受回环围栏保护**的 exact 路由。
   *
   * 刻意做成「注册器」而不是让每个 handler 各自记得判围栏：本模块历史上就是
   * 十一处各写各的、结果一处都没判。走注册器让「裸奔」在结构上无法发生——
   * 新增路由必须经过它。
   */
  function registerRoute(
    webServer: any,
    path: string,
    handler: (req: any, res: any) => Promise<void> | void,
  ): () => void {
    return webServer.register({
      kind: 'exact',
      path,
      handler: (req: any, res: any) => {
        if (!loopbackAllowed(req)) {
          jsonResponse(res, 403, { ok: false, error: 'loopback only' })
          return
        }
        void Promise.resolve(handler(req, res)).catch((error: unknown) => {
          // 各 handler 自带 try/catch，走到这里说明它们自己的 finally 之后仍抛了
          // （理论上不会）。响应可能已写出，故先探 headersSent / writableEnded。
          if (res.headersSent || res.writableEnded) return
          jsonResponse(res, 500, { ok: false, error: String((error as any)?.message ?? error) })
        })
      },
    })
  }

  // ── 配置接口：模型枚举（providers）+ 保存（config）──
  function jsonResponse(res: any, status: number, payload: any): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  function readBody(req: any): Promise<any> {
    return new Promise((resolve) => {
      let data = ''
      let size = 0
      let settled = false
      const done = (value: any): void => {
        if (settled) return
        settled = true
        resolve(value)
      }
      req.on('data', (chunk: any) => {
        if (settled) return
        size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk?.length ?? 0)
        if (size > MAX_BODY_BYTES) {
          // 与 proxy-host / capabilities-host / credential-keyring 同款：毁流
          // 断连，不让它继续往内存里灌。
          try { req.destroy() } catch { /* 已断开 */ }
          done(null)
          return
        }
        data += chunk
      })
      req.on('end', () => {
        try { done(JSON.parse(data || '{}')) } catch { done(null) }
      })
      req.on('error', () => done(null))
    })
  }
  async function saveVisionActive(key: string): Promise<void> {
    const list = await readVisionList()
    const parts = splitKey(key)
    if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) {
      list.push({ provider: parts.provider, model: parts.model })
    }
    await saveVisionList(list, key)
  }

  /** 自动降级开关运行态：model-router.json 的 visionFallback ?? 插件配置默认。 */
  async function readVisionFallback(): Promise<boolean> {
    try {
      const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
      const parsed = JSON.parse(await ctx.fs.readText(target))
      if (typeof parsed.visionFallback === 'boolean') return parsed.visionFallback
    } catch { /* 无路由文件 */ }
    return config.textModelImageFallback
  }

  /** 读 model-router.json 的 vision 降级列表（有序）。 */
  async function readVisionList(): Promise<Array<{ provider: string; model: string }>> {
    try {
      const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
      const parsed = JSON.parse(await ctx.fs.readText(target))
      if (Array.isArray(parsed.vision)) {
        return parsed.vision.filter((item: any) =>
          item && typeof item.provider === 'string' && typeof item.model === 'string')
      }
    } catch { /* 无路由文件 */ }
    return []
  }

  /** 写 model-router.json 的 vision 降级列表 + 首选（默认列表第一个）+ 降级开关（可选）。 */
  async function saveVisionList(
    list: Array<{ provider: string; model: string }>,
    active?: string,
    fallback?: boolean,
  ): Promise<void> {
    const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json')
    let parsed: any = {}
    try { parsed = JSON.parse(await ctx.fs.readText(target)) } catch { /* 无文件则新建 */ }
    const next: any = {
      ...parsed,
      vision: list,
      visionActive: active || (list.length > 0 ? `${list[0].provider}/${list[0].model}` : ''),
    }
    if (fallback !== undefined) next.visionFallback = fallback === true
    await ctx.fs.writeText(target, JSON.stringify(next, null, 2))
  }

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/vision-helper/providers', async (_req: any, res: any) => {
      try {
        const caps = await readCapabilities()
        const providers: any[] = []
        for (const info of ctx.llm.listProviders()) {
          let models: any[] = []
          try { models = await ctx.llm.listModels(info.id) } catch { /* 无发现 */ }
          providers.push({
            id: info.id,
            name: info.name,
            models: models.map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              input: Array.isArray(m.inputModalities)
                ? [...m.inputModalities]
                : Array.isArray(m.input) ? m.input : null,
              outputs: caps[`${info.id}/${m.id}`] ?? [],
            })),
          })
        }
        const active = (await resolveVisionModels(ctx, config))[0] || null
        const visionList = await readVisionList()
        jsonResponse(res, 200, { ok: true, providers, active, visionList, visionFallback: await readVisionFallback() })
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/vision-helper/config', async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method not allowed' })
        const body = await readBody(req)
        // 完整降级列表保存：{ vision: [{provider, model}...], visionActive?: string }
        if (body && Array.isArray(body.vision)) {
          const list: Array<{ provider: string; model: string }> = []
          for (const item of body.vision) {
            if (item && typeof item.provider === 'string' && typeof item.model === 'string'
              && splitKey(`${item.provider}/${item.model}`)
              && !list.some((x) => x.provider === item.provider && x.model === item.model)) {
              list.push({ provider: item.provider, model: item.model })
            }
          }
          if (list.length === 0) return jsonResponse(res, 400, { ok: false, error: 'vision 列表为空或格式无效' })
          const active = typeof body.visionActive === 'string' && splitKey(body.visionActive) ? body.visionActive : ''
          const resolved = active || `${list[0].provider}/${list[0].model}`
          const fallback = typeof body.visionFallback === 'boolean' ? body.visionFallback : undefined
          await saveVisionList(list, resolved, fallback)
          return jsonResponse(res, 200, { ok: true, active: resolved, vision: list })
        }
        // 仅切换自动降级开关：保留现有 vision 列表与首选，写 visionFallback。
        if (body && typeof body.visionFallback === 'boolean' && !Array.isArray(body.vision)) {
          const list = await readVisionList()
          const resolved = (await resolveVisionModels(ctx, config))[0] || ''
          await saveVisionList(list, resolved, body.visionFallback)
          return jsonResponse(res, 200, { ok: true, active: resolved, vision: list, visionFallback: body.visionFallback })
        }
        const key = body && typeof body.visionActive === 'string' ? body.visionActive : ''
        if (!splitKey(key)) return jsonResponse(res, 400, { ok: false, error: 'visionActive 须为 provider/model 格式' })
        await saveVisionActive(key)
        jsonResponse(res, 200, { ok: true, active: key })
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  // ── 生图接口（兼容原 /api/image-gen/* 路径，AI 模型页生图区块依赖）──

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/image-gen/snapshot', async (_req: any, res: any) => {
      try {
        const caps = await readCapabilities()
        const providers: any[] = []
        for (const info of ctx.llm.listProviders()) {
          let models: any[] = []
          try { models = await ctx.llm.listModels(info.id) } catch { /* 无发现 */ }
          providers.push({
            id: info.id,
            name: info.name,
            models: models.map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              input: Array.isArray(m.inputModalities)
                ? [...m.inputModalities]
                : Array.isArray(m.input) ? m.input : null,
              outputs: caps[`${info.id}/${m.id}`] ?? [],
            })),
          })
        }
        jsonResponse(res, 200, { ok: true, providers, imageActive })
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  // ── 生视频接口（AI 模型页生视频区块依赖）──

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/video-gen/snapshot', async (_req: any, res: any) => {
      try {
        const caps = await readCapabilities()
        const providers: any[] = []
        for (const info of ctx.llm.listProviders()) {
          let models: any[] = []
          try { models = await ctx.llm.listModels(info.id) } catch { /* 无发现 */ }
          providers.push({
            id: info.id,
            name: info.name,
            models: models.map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              input: Array.isArray(m.inputModalities)
                ? [...m.inputModalities]
                : Array.isArray(m.input) ? m.input : null,
              outputs: caps[`${info.id}/${m.id}`] ?? [],
            })),
          })
        }
        jsonResponse(res, 200, { ok: true, providers, videoActive })
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/video-gen/config', async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method not allowed' })
        const body = await readBody(req)
        const key = body && typeof body.videoActive === 'string' ? body.videoActive : ''
        if (!splitKey(key)) return jsonResponse(res, 400, { ok: false, error: 'videoActive 须为 provider/model 格式' })
        await saveVideoActive(key)
        jsonResponse(res, 200, { ok: true, videoActive: key })
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  // ── 模型能力声明接口（生图/生视频；ModelListEditor 三开关读写）──

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/model-capabilities', async (req: any, res: any) => {
      try {
        if (req.method === 'POST') {
          const body = await readBody(req)
          const caps = body && typeof body.capabilities === 'object' && body.capabilities !== null
            ? body.capabilities
            : {}
          const clean: Record<string, string[]> = {}
          for (const [key, value] of Object.entries(caps)) {
            if (splitKey(key) && Array.isArray(value)) {
              const mods = value.filter((x): x is string =>
                typeof x === 'string' && (x === 'image' || x === 'video' || x === 'speech'))
              if (mods.length > 0) clean[key] = mods
            }
          }
          await saveCapabilities(clean)
          return jsonResponse(res, 200, { ok: true, capabilities: clean })
        }
        const caps = await readCapabilities()
        jsonResponse(res, 200, { ok: true, capabilities: caps })
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  // ── 模型能力验证接口（「测试」按钮：实际调用一次对应能力）──
  // capability: vision(识图) / image(生图) / video(生视频)
  // vision/image 同步验证；video 只验证任务能否创建成功（不等待生成完成）。

  /** 1×1 红色像素 PNG（识图测试用，能返回描述即说明模型支持图片输入）。 */
  const TEST_IMAGE_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  async function createVideoTask(
    provider: string,
    model: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
    const profile = providerConfig(ctx, provider)
    if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
      return { ok: false, error: `provider "${provider}" 未配置 baseURL` }
    }
    const apiKey = await resolveApiKey(ctx, profile)
    if (!apiKey) return { ok: false, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` }
    const base = String(profile.baseURL).replace(/[\\/]+$/, '')
    const safePrompt = psEscape(prompt)
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
      'try {',
      `  $b = @{ model = '${psEscape(model)}'; prompt = '${safePrompt}' } | ConvertTo-Json -Compress`,
      `  $c = Invoke-RestMethod -UseBasicParsing -Uri '${psEscape(base)}/videos' -Method Post -Headers @{ Authorization = 'Bearer ' + $env:${KEY_ENV}; 'Content-Type' = 'application/json' } -Body $b -TimeoutSec 15`,
      '  $id = $c.id',
      "  if ($id) { @{ ok = $true; id = $id } | ConvertTo-Json -Compress } else { @{ ok = $false; error = '响应无 id' } | ConvertTo-Json -Compress }",
      '} catch {',
      "  $detail = ''",
      "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
      "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
      '}',
    ].join('; ')
    try {
      const spec = shellSpec(ctx, { command, timeoutMs: TEST_TIMEOUT_MS, signal, apiKey })
      const result = await shellRun(ctx, spec)
      const stdout = result.stdout && result.stdout.text ? result.stdout.text : ''
      const stderr = result.stderr && result.stderr.text ? result.stderr.text : ''
      if (result.exitCode !== 0) {
        return { ok: false, error: `生视频 API 调用失败 (exit ${result.exitCode}): ${(stderr || stdout || '未知错误').slice(0, 400)}` }
      }
      let parsed: any = null
      try { parsed = JSON.parse(stdout) } catch {
        return { ok: false, error: '生视频 API 响应解析失败: ' + stdout.slice(0, 300) }
      }
      if (!parsed || parsed.ok !== true) {
        return { ok: false, error: '生视频 API 错误: ' + JSON.stringify(parsed).slice(0, 400) }
      }
      return { ok: true, taskId: String(parsed.id ?? '') }
    } catch (error: any) {
      return { ok: false, error: '生视频 API 调用异常: ' + String(error?.message ?? error) }
    }
  }

  /** 探测模型支持的 reasoning_effort 档位（off 恒支持、不发参数，不探测）。 */
  async function probeReasoningEfforts(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<any> {
    const profile = providerConfig(ctx, provider)
    if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
      return { ok: false, error: `provider "${provider}" 未配置 baseURL` }
    }
    const apiKey = await resolveApiKey(ctx, profile)
    if (!apiKey) return { ok: false, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` }
    const base = String(profile.baseURL).replace(/[\\/]+$/, '')
    const levels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    // —— 快捷路径 1：默认先测 max，通过则其余低档默认全支持（网关按序升级），直接返回 ——
    const maxProbe = await probeReasoningEffort(ctx, base, apiKey, model, 'max', TEST_TIMEOUT_MS, signal)
    if (maxProbe.ok) {
      return { ok: true, supported: [...levels], rejected: [], fastPath: 'max-accepted', offWire: null }
    }
    const maxErrText = `${(maxProbe as any)?.detail ?? ''} ${(maxProbe as any)?.error ?? ''}`
    // —— 快捷路径 2：max 被拒且错误里带 expected one of → 解析合法值表直接填入 ——
    const parsed = parseExpectedEfforts(maxErrText)
    if (parsed !== null) {
      const selectable = parsed.filter((w) => w !== 'none')
      const supported = levels.filter((l) => selectable.includes(l))
      const rejected = levels
        .filter((l) => !selectable.includes(l))
        .map((level) => ({ level, reason: level === 'max' ? (maxErrText || '网关拒绝 max').slice(0, 300) : `网关合法值表无此档（expected one of: ${parsed.join(', ')})`.slice(0, 200) }))
      return {
        ok: true,
        supported,
        rejected,
        fastPath: 'parsed-from-error',
        offWire: parsed.includes('none') ? 'none' : null,
        hint: `max 不被该网关接受，已按其返回的合法值表自动填入：${supported.length > 0 ? supported.join(' / ') : '（无推理档，视为非推理模型）'}`,
      }
    }
    // —— 回落：逐档探测（网关错误无结构化信息时） ——
    const supported: string[] = []
    const rejected: Array<{ level: string; reason: string }> = [
      { level: 'max', reason: (((maxProbe as any)?.error || (maxProbe as any)?.detail || '拒绝') as string).slice(0, 200) },
    ]
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
      const r = await probeReasoningEffort(ctx, base, apiKey, model, level, TEST_TIMEOUT_MS, signal)
      if (r.ok) supported.push(level)
      else rejected.push({ level, reason: (r.error || r.detail || '拒绝').slice(0, 200) })
    }
    // 保持升级顺序输出
    supported.sort((a, b) => levels.indexOf(a) - levels.indexOf(b))
    return { ok: true, supported, rejected, fastPath: 'full-probe' }
  }

  async function testCapability(
    provider: string,
    model: string,
    capability: string,
    signal?: AbortSignal,
  ): Promise<any> {
    if (capability === 'vision') {
      // 直接对指定 provider/model 发测试图，验证「该模型」是否支持识图，
      // 而不是复用全局视觉模型列表（那样测的是辅助视觉模型，不是被测模型）。
      const profile = providerConfig(ctx, provider)
      if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
        return { ok: false, capability, error: `provider "${provider}" 未配置 baseURL` }
      }
      const apiKey = await resolveApiKey(ctx, profile)
      if (!apiKey) return { ok: false, capability, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` }
      try {
        const res = await callVisionChat(
          ctx, profile.baseURL, apiKey, model, TEST_IMAGE_PNG,
          '这张图是什么颜色？用一句话回答。', TEST_TIMEOUT_MS, signal,
          { flatImage: false, reasoningOff: null, maxTokens: Math.min(config.maxTokens, 64) },
        )
        if (res.ok && typeof res.content === 'string' && res.content.trim().length > 0) {
          return { ok: true, capability, result: res.content.trim() }
        }
        return { ok: false, capability, error: (res.error || res.detail || '未返回描述').slice(0, 400) }
      } catch (error: any) {
        return { ok: false, capability, error: String(error?.message ?? error).slice(0, 400) }
      }
    }
    if (capability === 'image') {
      const profile = providerConfig(ctx, provider)
      if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
        return { ok: false, capability, error: `provider "${provider}" 未配置 baseURL` }
      }
      const apiKey = await resolveApiKey(ctx, profile)
      if (!apiKey) return { ok: false, capability, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` }
      const base = String(profile.baseURL).replace(/[\\/]+$/, '')
      const one = await generateOne(base, apiKey, model, 'a single red dot on white background', signal, TEST_TIMEOUT_MS)
      if (!one.ok) return { ok: false, capability, error: one.error }
      return { ok: true, capability, result: one.url }
    }
    if (capability === 'video') {
      const created = await createVideoTask(provider, model, 'a slowly moving red dot', signal)
      if (!created.ok) return { ok: false, capability, error: created.error }
      return { ok: true, capability, result: `任务已创建（id: ${created.taskId}），生成中…` }
    }
    return { ok: false, capability, error: `未知能力：${capability}` }
  }

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/test-capability', async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method not allowed' })
        const body = await readBody(req)
        const provider = body && typeof body.provider === 'string' ? body.provider : ''
        const model = body && typeof body.model === 'string' ? body.model : ''
        const capability = body && typeof body.capability === 'string' ? body.capability : ''
        if (!provider || !model) return jsonResponse(res, 400, { ok: false, error: 'provider/model 不能为空' })
        if (!['vision', 'image', 'video'].includes(capability)) {
          return jsonResponse(res, 400, { ok: false, error: 'capability 须为 vision/image/video' })
        }
        const result = await testCapability(provider, model, capability)
        jsonResponse(res, 200, result)
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  // ── 推理等级自动探测接口（「自动检测」按钮：逐档位发请求探测支持情况）──

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/test-reasoning', async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method not allowed' })
        const body = await readBody(req)
        const provider = body && typeof body.provider === 'string' ? body.provider : ''
        const model = body && typeof body.model === 'string' ? body.model : ''
        if (!provider || !model) return jsonResponse(res, 400, { ok: false, error: 'provider/model 不能为空' })
        const result = await probeReasoningEfforts(provider, model)
        jsonResponse(res, 200, result)
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  // ── 新版推理等级检测（webui 异步协议 + max 优先快探）──────────────────
  // 协议与 webui perf-bench 的 /api/detect-capability 完全一致（POST 启动 →
  // GET 轮询 state），只有探测核心换掉：默认先测 max，网关拒绝且错误里带
  // 合法值表时直接按表填入（含 OpenAI 系 off:'none'），解析不到才回落逐档。

  const DETECT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const DETECT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh']
  interface DetectItem { key: string; label: string; status: 'pending' | 'running' | 'done'; ok: boolean | null; note: string }
  let detect: {
    running: boolean; provider: string; model: string; startedAt: number; finishedAt: number | null
    error: string; savedLevels: boolean; saveError: string; offWire: string | null; hint: string
    items: DetectItem[]
  } | null = null

  /** 把检测到的档位落盘到 llm-pi-ai（只写 reasoningEfforts，识图等由手动开关负责）。 */
  async function saveDetectedLevels(provider: string, model: string, levels: string[], offWire: string | null): Promise<{ saved: boolean; error: string }> {
    const PI_NS = 'llm-pi-ai'
    const SELECTABLE = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    try {
      const manageable = ctx.llm.listConfigurableProviders()
        .some((e: any) => e.provider === provider && e.settingsNs === PI_NS)
      if (!manageable) return { saved: false, error: '该供应商不由 pi-ai 适配器管理，检测结果仅回显未落盘' }
      const picked = SELECTABLE.filter(l => levels.includes(l))
      if (picked.length === 0) return { saved: false, error: '' }
      for (let attempt = 0; attempt < 2; attempt++) {
        const all = ctx.settings.describe()
        const descriptor = all.find((e: any) => e.ns === PI_NS)
        if (!descriptor) return { saved: false, error: `设置命名空间 "${PI_NS}" 未注册` }
        const user = (descriptor as any)?.user
        const userProviders = user && typeof user === 'object' ? (user as any).providers : undefined
        const userProfile = userProviders && typeof userProviders === 'object' ? userProviders[provider] : undefined
        const existing = userProfile?.models
        let models: any[]
        let index: number
        if (Array.isArray(existing)) {
          models = JSON.parse(JSON.stringify(existing))
          index = models.findIndex(m => m && typeof m === 'object' && m.id === model)
          if (index < 0) return { saved: false, error: `模型目录里没有 "${model}"：请先添加模型目录` }
        } else {
          let listed: any[] = []
          try { listed = await ctx.llm.listModels(provider) }
          catch (e: any) { return { saved: false, error: `无法枚举模型：${String(e?.message ?? e)}` } }
          models = listed.map(m => ({ id: m.id }))
          index = models.findIndex(m => m.id === model)
          if (index < 0) return { saved: false, error: `供应商不提供模型 "${model}"` }
        }
        const efforts: Record<string, string | null> = { off: offWire === 'none' ? 'none' : null }
        for (const l of picked) efforts[l] = l
        models[index].reasoningEfforts = efforts
        try {
          await ctx.settings.mutate(PI_NS, [{ op: 'set', path: ['providers', provider, 'models'], value: models }], (descriptor as any).revision)
          return { saved: true, error: '' }
        } catch (e: any) {
          if ((e as any)?.code === 'SETTINGS_CONFLICT' && attempt === 0) continue
          return { saved: false, error: String(e?.message ?? e) }
        }
      }
      return { saved: false, error: '设置写入反复冲突，请重试' }
    } catch (e: any) {
      return { saved: false, error: String(e?.message ?? e) }
    }
  }

  async function runDetectAsync(provider: string, model: string): Promise<void> {
    const st = detect
    if (!st) return
    const mark = (level: string, ok: boolean, note: string): void => {
      const it = st.items.find(i => i.key === `level:${level}`)
      if (it) { it.status = 'done'; it.ok = ok; it.note = note }
    }
    const markRunning = (level: string): void => {
      const it = st.items.find(i => i.key === `level:${level}`)
      if (it) { it.status = 'running'; it.ok = null; it.note = '' }
    }
    try {
      const profile = providerConfig(ctx, provider)
      if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
        throw new Error(`provider "${provider}" 未配置 baseURL`)
      }
      const apiKey = await resolveApiKey(ctx, profile)
      if (!apiKey) throw new Error(`未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）`)
      const base = String(profile.baseURL).replace(/[\\/]+$/, '')
      mark('off', true, '不发参数恒支持')
      markRunning('max')
      const maxProbe = await probeReasoningEffort(ctx, base, apiKey, model, 'max', TEST_TIMEOUT_MS, undefined)
      let supported: string[] = []
      let offWire: string | null = null
      if (maxProbe.ok) {
        supported = [...DETECT_ORDER, 'max']
        for (const l of DETECT_ORDER) mark(l, true, 'max 已通过，低档默认支持')
        mark('max', true, '网关接受 max')
        st.hint = 'max 一次通过：全档支持'
      } else {
        const errText = `${(maxProbe as any)?.detail ?? ''} ${(maxProbe as any)?.error ?? ''}`
        mark('max', false, '网关拒绝 max')
        const parsed = parseExpectedEfforts(errText)
        if (parsed !== null) {
          offWire = parsed.includes('none') ? 'none' : null
          const selectable = parsed.filter(w => w !== 'none')
          supported = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].filter(l => selectable.includes(l))
          for (const l of DETECT_ORDER) mark(l, selectable.includes(l), selectable.includes(l) ? '合法值表命中' : '合法值表无此档')
          st.hint = `max 不被接受，已按网关合法值表填入：${supported.length > 0 ? supported.join(' / ') : '无推理档'}`
        } else {
          // 回落逐档：5 档并行各发各的（独立临时文件/独立 shell），总耗时≈最慢一档，
          // 而不是串行 5 次超时叠加。单线程内按序落盘，无竞态。
          for (const l of DETECT_ORDER) markRunning(l)
          const settled = await Promise.all(DETECT_ORDER.map(async (l) => {
            const r = await probeReasoningEffort(ctx, base, apiKey, model, l, TEST_TIMEOUT_MS, undefined)
            return { level: l, ok: r.ok, reason: String(r.error || r.detail || '拒绝').slice(0, 120) }
          }))
          for (const l of DETECT_ORDER) {
            const found = settled.find(s => s.level === l)!
            if (found.ok) { supported.push(l); mark(l, true, '网关接受') }
            else mark(l, false, found.reason)
          }
          supported.sort((a, b) => DETECT_ORDER.indexOf(a) - DETECT_ORDER.indexOf(b))
          st.hint = supported.length > 0 ? `逐档实测：${supported.join(' / ')}` : '逐档实测均被拒绝，视为非推理模型'
        }
      }
      st.offWire = offWire
      if (supported.length > 0) {
        const saved = await saveDetectedLevels(provider, model, supported, offWire)
        st.savedLevels = saved.saved
        st.saveError = saved.error
      }
    } catch (error: any) {
      st.error = String(error?.message ?? error).slice(0, 300)
    } finally {
      st.running = false
      st.finishedAt = Date.now()
    }
  }

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/detect-capability', async (req: any, res: any) => {
      try {
        if (req.method === 'POST') {
          const body = await readBody(req)
          const provider = body && typeof body.provider === 'string' ? body.provider : ''
          const model = body && typeof body.model === 'string' ? body.model : ''
          if (!provider || !model) return jsonResponse(res, 400, { ok: false, error: 'provider/model 不能为空' })
          if (detect !== null && detect.running) {
            return jsonResponse(res, 409, { ok: false, error: `已有检测进行中（${detect.provider}/${detect.model}）` })
          }
          detect = {
            running: true, provider, model, startedAt: Date.now(), finishedAt: null,
            error: '', savedLevels: false, saveError: '', offWire: null, hint: '',
            items: DETECT_LEVELS.map(level => ({
              key: `level:${level}`, label: `推理等级 · ${level}`,
              status: 'pending' as const, ok: null as boolean | null, note: '',
            })),
          }
          void runDetectAsync(provider, model)
          return jsonResponse(res, 200, { ok: true, state: detect })
        }
        return jsonResponse(res, 200, { ok: true, state: detect })
      } catch (error: any) {
        return jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return registerRoute(webServer, '/api/image-gen/config', async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method not allowed' })
        const body = await readBody(req)
        const key = body && typeof body.imageActive === 'string' ? body.imageActive : ''
        if (!splitKey(key)) return jsonResponse(res, 400, { ok: false, error: 'imageActive 须为 provider/model 格式' })
        await saveImageActive(key)
        jsonResponse(res, 200, { ok: true, imageActive: key })
      } catch (error: any) {
        jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
  })

  void loadImageConfig()
  void loadVideoConfig()
}
