/**
 * dsh-chat-plus — download 工具（host 半身）。
 *
 * 模型侧：wire 工具 `download`（url / dest / overwrite），Node 全局 fetch
 * 流式写盘，进度（receivedBytes / totalBytes / speedBps / status）记入进程内
 * 进度表；浏览器侧：GET /api/chat-flow/download/progress?callId=<callId>
 * 轮询实时进度，GUI 渲染真实进度条。
 *
 * 关键对齐：进度表按 callId 索引。run_code 子调度进入工具体时
 * exec.callId == `<parent>:code:<n>`，与客户端 tool/code-dispatch-start
 * 投影出的 RunningToolCall.callId 完全一致（见 packages/core/tools/src/ptc.ts
 * 的 subCallId 生成）；native 直调时 callId 即模型调用 id，同样成立。
 * 两端不靠 URL 猜测、不靠时序窗口，纯 id 对齐。
 *
 * 约束（与 build.mjs assertHostExternals 一致）：
 *  - 零 @deepseek-ai 运行时导入，host 半身自包含；
 *  - 工具定义是手写 ToolDefinition 字面量——tools.register() 只校验
 *    output { schema, render } 且 output schema 在 JSON Schema 支持子集内
 *    （根级 required 数组合法，见 core/tools json-schema.ts 的
 *    checkObjectSchemaTail）；参数校验按 ToolExecutionInput 契约由 execute
 *    自行完成（"tools validate their own schema"）。
 */

import { createWriteStream, statSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { rejectCrossSite } from '../shared/csrf.ts'

/** 空闲超时：连续这么久没有任何字节进来就中止（防挂死连接）。 */
const IDLE_TIMEOUT_MS = 90_000
/** 已结束条目保留时长（过期清理）。 */
const SETTLED_TTL_MS = 30 * 60_000
/** 进度表容量上限（超过先淘汰最旧的已结束条目）。 */
const MAX_ENTRIES = 64

/** 一条下载的实时状态（浏览器轮询拿到的就是它）。 */
export interface DownloadState {
  /** 关联的工具调用 id（run_code 子调用为 `<parent>:code:<n>`）。 */
  callId: string
  /** 原始请求 URL。 */
  url: string
  /** 落盘绝对路径。 */
  dest: string
  /** 总字节数；Content-Length 缺失时为 null（进度条走不定长模式）。 */
  totalBytes: number | null
  /** 已接收字节数。 */
  receivedBytes: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt: number
  finishedAt?: number
  /** 平滑后的实时速度（B/s）。 */
  speedBps: number
}

/** 进度表：callId → 状态。对象就地更新，路由在请求时序列化最新值。 */
const downloads = new Map<string, DownloadState>()

/**
 * shell 下载的文件看护表：客户端解析出 -OutFile / -o 的落盘路径后 POST 上来，
 * host 周期 stat 文件大小，把「字节增长」合成与 download 工具同形的进度。
 * 客户端停轮询（调用落定）后 2 分钟自动淘汰。
 */
interface WatchEntry {
  path: string
  url: string
  totalBytes: number | null
  lastSize: number
  speedBps: number
  startedAt: number
  lastPolledAt: number
  timer: ReturnType<typeof setInterval>
}
const watchers = new Map<string, WatchEntry>()
const MAX_WATCHERS = 32
const WATCH_POLL_MS = 500
const WATCH_TTL_MS = 120_000

/** 淘汰过期/超限条目。 */
function prune(): void {
  const now = Date.now()
  for (const [key, entry] of downloads) {
    if (entry.status !== 'running' && entry.finishedAt !== undefined && now - entry.finishedAt > SETTLED_TTL_MS) {
      downloads.delete(key)
    }
  }
  while (downloads.size > MAX_ENTRIES) {
    let oldestKey: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [key, entry] of downloads) {
      if (entry.status !== 'running') {
        const at = entry.finishedAt ?? entry.startedAt
        if (at < oldestAt) { oldestAt = at; oldestKey = key }
      }
    }
    if (oldestKey === undefined) break
    downloads.delete(oldestKey)
  }
}

/** 文件名消毒：去路径分隔符/控制字符，限长。 */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return (cleaned === '' ? 'download.bin' : cleaned).slice(0, 120)
}

/** 从 Content-Disposition 提取文件名（filename* 优先，其次 filename）。 */
function filenameFromDisposition(disposition: string | null): string | null {
  if (disposition === null) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star?.[1] !== undefined) {
    try { return sanitizeFilename(decodeURIComponent(star[1].trim())) } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*"(?:UTF-8)?([^"]+)"|filename\s*=\s*([^;]+)/i.exec(disposition)
  const raw = plain?.[1] ?? plain?.[2]
  return raw === undefined || raw === '' ? null : sanitizeFilename(raw.trim())
}

/** 缺省保存目录（DSH storages 下，不污染工作区）。 */
function defaultDownloadDir(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'storages', 'dsh-chat-flow-downloads')
}

/** 字节数格式化（host 侧 result 文本用）。 */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** 执行一次下载：写进度表 + 流式落盘，返回 output schema 兼容的 canonical 值。 */
async function runDownload(args: Record<string, unknown>, callId: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const url = typeof args.url === 'string' ? args.url.trim() : ''
  if (!/^https?:\/\//i.test(url)) throw new Error('download: url 必须是 http(s) 地址')

  const startedAt = Date.now()
  const state: DownloadState = {
    callId,
    url,
    dest: '',
    totalBytes: null,
    receivedBytes: 0,
    status: 'running',
    startedAt,
    speedBps: 0,
  }
  downloads.set(callId, state)
  prune()

  const controller = new AbortController()
  const onCallerAbort = (): void => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', onCallerAbort, { once: true })

  /**
   * 本次下载的临时文件名（`<dest>.part-<pid>-<rand>`）。
   *
   * 声明在 try 之外：失败分支要删它，而它要到算出 dest 之后才能确定。
   * null = 还没走到建临时文件那步（此时磁盘上一个字节都没动，无需清理）。
   */
  let part: string | null = null

  // 空闲看门狗：每次收到字节都续期。
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
  }

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'dsh-chat-flow-download/1.0',
        accept: '*/*',
        ...(typeof args.headers === 'object' && args.headers !== null ? args.headers as Record<string, string> : {}),
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    armIdle()

    // 决定落盘路径：显式 dest 优先；否则按 Content-Disposition / 最终 URL 推导。
    const contentLength = response.headers.get('content-length')
    state.totalBytes = contentLength !== null && contentLength !== '' && Number.isFinite(Number(contentLength))
      ? Number(contentLength)
      : null
    let dest = typeof args.dest === 'string' && args.dest.trim() !== '' ? resolve(args.dest.trim()) : ''
    if (dest === '') {
      const name = filenameFromDisposition(response.headers.get('content-disposition'))
        ?? sanitizeFilename(decodeURIComponent(basename(new URL(response.url || url).pathname)))
      dest = join(defaultDownloadDir(), name)
    }
    await mkdir(dirname(dest), { recursive: true })
    const overwrite = args.overwrite === true
    if (!overwrite) {
      try {
        await stat(dest)
        throw new Error(`目标已存在：${dest}（overwrite: true 可覆盖）`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    /*
     * 落盘走「先写同目录临时文件、成功再 rename」。
     *
     * 为什么必须这样（2026-10-17 修数据丢失）：原来直接 createWriteStream(dest)
     * 流式覆盖，失败分支又统一 rm(dest) 清半截文件 —— 当 overwrite: true 且目标
     * 是**用户已有的文件**时，一次网络中断就把用户原文件删了，用户只看到
     * 「下载失败」，原文件没了且无从得知。实测复现：无 overwrite 时原文件保留
     * （正常报「目标已存在」），overwrite + 断流时原文件「不存在」。
     *
     * 临时名带 pid + 随机段：同目录并发下载同名目标时不会互相截断
     * （与 memory/engine/store.ts 的 atomicWrite 同一个坑，同一个修法）。
     * 用同目录而不是系统 tmp：rename 只有在同一文件系统内才是原子的，
     * 跨卷 rename 会退化成复制，反而丢掉原子性。
     */
    part = `${dest}.part-${String(process.pid)}-${Math.random().toString(36).slice(2, 8)}`
    state.dest = dest

    // 计数 transform：逐块累计 + 速度 EMA（400ms 窗口）。
    let lastAt = Date.now()
    let lastBytes = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        state.receivedBytes += chunk.length
        const now = Date.now()
        const dt = now - lastAt
        if (dt >= 400) {
          const instant = ((state.receivedBytes - lastBytes) * 1000) / Math.max(dt, 1)
          state.speedBps = state.speedBps === 0 ? instant : state.speedBps * 0.6 + instant * 0.4
          lastAt = now
          lastBytes = state.receivedBytes
        }
        armIdle()
        callback(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      counter,
      createWriteStream(part),
    )
    // 整份下完才顶替目标：此刻原文件还在，rename 一步换过去。
    await rename(part, dest)

    const finished = await stat(dest)
    state.status = 'completed'
    state.receivedBytes = finished.size
    state.finishedAt = Date.now()
    prune()

    const durationMs = state.finishedAt - startedAt
    const value: Record<string, unknown> = {
      ok: true,
      path: dest,
      url: response.url || url,
      bytes: finished.size,
      durationMs,
    }
    if (state.totalBytes !== null) value.totalBytes = state.totalBytes
    return value
  } catch (error) {
    const aborted = controller.signal.aborted
    state.status = aborted ? 'cancelled' : 'failed'
    state.error = aborted ? '已取消' : error instanceof Error ? error.message : String(error)
    state.finishedAt = Date.now()
    // 只清临时文件。**绝不能删 dest** —— overwrite 场景下它是用户的原文件。
    if (part !== null) await rm(part, { force: true }).catch(() => {})
    prune()
    throw aborted
      ? new Error(`下载已取消：${url}`)
      : new Error(`下载失败：${state.error}`)
  } finally {
    if (idleTimer !== null) clearTimeout(idleTimer)
    signal.removeEventListener('abort', onCallerAbort)
  }
}

/** 手写的 ToolDefinition 字面量（不引 @deepseek-ai/dsh-tools，保持自包含）。 */
export const downloadTool = {
  name: 'download',
  description: [
    '下载 http(s) 文件到本地（流式写盘，Web 界面实时进度条）。',
    '需要下载文件（安装包 / zip / release 资产 / 模型权重等）时优先用它，而不是用 pwsh 跑 curl。',
    'dest 给目标文件的绝对路径（目录会自动创建）；缺省存到 ~/.dsh/storages/dsh-chat-flow-downloads/。',
    '目标已存在时默认报错，传 overwrite: true 覆盖。返回 JSON { ok, path, url, bytes, totalBytes?, durationMs }。',
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'http(s) 下载地址' },
      dest: { type: 'string', description: '目标文件绝对路径（缺省按 Content-Disposition/URL 命名存入默认目录）' },
      overwrite: { type: 'boolean', description: '目标已存在时是否覆盖（默认 false）' },
    },
    required: ['url'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        path: { type: 'string' },
        url: { type: 'string' },
        bytes: { type: 'integer' },
        totalBytes: { type: 'integer' },
        durationMs: { type: 'integer' },
      },
      required: ['ok', 'path', 'url', 'bytes'],
    },
    render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
      const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
      const bytes = typeof v.bytes === 'number' ? formatBytes(v.bytes) : '?'
      const total = typeof v.totalBytes === 'number' ? ` / ${formatBytes(v.totalBytes)}` : ''
      const duration = typeof v.durationMs === 'number' ? ` · ${(v.durationMs / 1000).toFixed(1)}s` : ''
      return [{
        type: 'text',
        text: `已下载 → ${String(v.path ?? '?')}\n${bytes}${total}${duration}`,
      }]
    },
    presentationMeta(_args: unknown, value: unknown): unknown {
      // 完整 canonical 值随 tool/result 持久化，client 完成态卡片直接读 meta。
      return value
    },
  },
  timeoutMs: 3_600_000,
  isConcurrencySafe: (): boolean => true,
  async execute(args: unknown, exec: { callId: string; signal: AbortSignal }): Promise<Record<string, unknown>> {
    const record = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    if (typeof record.url !== 'string' || record.url.trim() === '') {
      throw new Error('download: 缺少必填参数 url（http(s) 地址）')
    }
    if (record.dest !== undefined && (typeof record.dest !== 'string' || record.dest.trim() === '')) {
      throw new Error('download: dest 必须是非空字符串（目标文件绝对路径）')
    }
    return await runDownload(record, exec.callId, exec.signal)
  },
}

/** JSON 响应小工具。 */
function json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/** 只读面：按 callId 取一条下载状态（测试与诊断用；未只读导出进度表本体）。 */
export function readDownloadState(callId: string): DownloadState | undefined {
  return downloads.get(callId)
}

/** 停掉一个 shell 文件看护（连带清进度表里的合成条目）。 */
function stopWatcher(callId: string, entry: WatchEntry): void {
  clearInterval(entry.timer)
  watchers.delete(callId)
  const state = downloads.get(callId)
  if (state !== undefined && state.status === 'running' && state.dest === entry.path) {
    downloads.delete(callId)
  }
}

/**
 * 注册/刷新一个 shell 下载看护：以 500ms 周期 stat 目标文件，把字节增长
 * 合成进进度表（同形 DownloadState，GUI 无差别渲染）。totalBytes 可由客户
 * 端 HEAD 预检提供，拿不到就是不定长（游标动画）。
 * @param callId - 关联的工具调用 id（与工具侧同键空间）。
 * @param body - { path?, url?, totalBytes? }；path 缺失视为撤销看护。
 */
export function watchShellDownload(callId: string, body: { path?: unknown; url?: unknown; totalBytes?: unknown }): void {
  // path 缺失/空串 = 撤销看护（resolve 只接受非空 string，先判再用）。
  const rawPath = typeof body.path === 'string' ? body.path.trim() : ''
  const path = rawPath !== '' ? resolve(rawPath) : ''
  if (path === '') {
    // 客户端说这条调用不对应本地文件：撤掉已有看护并保持表干净。
    const existing = watchers.get(callId)
    if (existing !== undefined) stopWatcher(callId, existing)
    return
  }
  const url = typeof body.url === 'string' ? body.url : ''
  const totalBytes = typeof body.totalBytes === 'number' && Number.isFinite(body.totalBytes) && body.totalBytes > 0
    ? body.totalBytes
    : null
  const existing = watchers.get(callId)
  if (existing !== undefined) {
    existing.lastPolledAt = Date.now()
    if (path !== existing.path) { existing.path = path }
    if (totalBytes !== null) existing.totalBytes = totalBytes
    // 同步合成条目的展示字段（url/totalBytes 可能随刷新变化）。
    const state = downloads.get(callId)
    if (state !== undefined) {
      state.url = url
      state.dest = path
      state.totalBytes = existing.totalBytes
    }
    return
  }
  // 容量守卫：满了先淘汰最久没被轮询的。
  while (watchers.size >= MAX_WATCHERS) {
    let oldestId = ''
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [id, entry] of watchers) {
      if (entry.lastPolledAt < oldestAt) { oldestAt = entry.lastPolledAt; oldestId = id }
    }
    if (oldestId === '') break
    stopWatcher(oldestId, watchers.get(oldestId)!)
  }

  const entry: WatchEntry = {
    path,
    url,
    totalBytes,
    lastSize: 0,
    speedBps: 0,
    startedAt: Date.now(),
    lastPolledAt: Date.now(),
    timer: null as unknown as ReturnType<typeof setInterval>,
  }
  const state: DownloadState = {
    callId,
    url,
    dest: path,
    totalBytes,
    receivedBytes: 0,
    status: 'running',
    startedAt: entry.startedAt,
    speedBps: 0,
  }
  downloads.set(callId, state)
  watchers.set(callId, entry)
  let lastAt = Date.now()
  entry.timer = setInterval(() => {
    try {
      const size = statSync(path).size
      const now = Date.now()
      const dt = now - lastAt
      if (size !== entry.lastSize && dt > 0) {
        const instant = ((size - entry.lastSize) * 1000) / dt
        entry.speedBps = entry.speedBps === 0 ? instant : entry.speedBps * 0.6 + instant * 0.4
        entry.lastSize = size
        lastAt = now
      }
      state.receivedBytes = size
      state.speedBps = entry.speedBps
      state.totalBytes = entry.totalBytes
    } catch {
      // 文件还没出现/被删：保持 0，不炸轮询。
    }
    // TTL：客户端不再轮询（100ms×120s 无心跳）→ 收尾清理。
    if (Date.now() - entry.lastPolledAt > WATCH_TTL_MS) {
      stopWatcher(callId, entry)
      prune()
    }
  }, WATCH_POLL_MS)
  prune()
}

/**
 * 注册下载进度路由（在已注入 webServer 的子上下文中调用）：
 *   GET /api/chat-flow/download/progress?callId=<id> → { ok, download|null }
 *   GET /api/chat-flow/download/progress            → { ok, downloads[] }
 * @param webCtx - webServer 已就绪的插件上下文。
 */
export function applyDownloadRoutes(webCtx: Record<string, any>): void {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'prefix',
    path: '/api/chat-flow/download',
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
      // 跨站闸门：这条路由原本一行来源校验都没有（见 shared/csrf.ts 头注释）。
      if (rejectCrossSite(req.headers as Record<string, unknown>, (status, payload) => {
        json(res, status, payload)
      })) return
      try {
        const parsed = new URL(req.url ?? '/', 'http://x')
        if (req.method === 'POST' && parsed.pathname === '/api/chat-flow/download/watch') {
          void handleWatch(req, res)
          return
        }
        if (req.method === 'GET' && parsed.pathname === '/api/chat-flow/download/progress') {
          const callId = parsed.searchParams.get('callId')
          if (callId !== null && callId !== '') {
            // 客户端轮询即心跳：刷新 shell 看护的 TTL。
            const watcher = watchers.get(callId)
            if (watcher !== undefined) watcher.lastPolledAt = Date.now()
            json(res, 200, { ok: true, download: downloads.get(callId) ?? null })
            return
          }
          const list = [...downloads.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)
          json(res, 200, { ok: true, downloads: list })
          return
        }
        json(res, 404, { ok: false, error: 'not found' })
      } catch {
        json(res, 500, { ok: false, error: 'internal error' })
      }
    },
  }), 'dsh-chat-plus: download routes')
}

/** 读请求体（小 JSON）。 */
function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) { rejectPromise(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectPromise)
  })
}

/** POST /watch：注册/刷新 shell 下载的文件看护。 */
async function handleWatch(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req)
    const parsedBody = JSON.parse(raw === '' ? '{}' : raw) as Record<string, unknown>
    const callId = typeof parsedBody.callId === 'string' ? parsedBody.callId : ''
    if (callId === '') {
      json(res, 400, { ok: false, error: 'callId required' })
      return
    }
    // totalBytes 允许客户端探测后带来；没带就服务端自己 HEAD 预检（尽力）。
    const url = typeof parsedBody.url === 'string' ? parsedBody.url : ''
    let totalBytes = typeof parsedBody.totalBytes === 'number' ? parsedBody.totalBytes : null
    if (totalBytes === null && url !== '') totalBytes = await probeTotalBytes(url)
    watchShellDownload(callId, { path: parsedBody.path, url, totalBytes })
    const watcher = watchers.get(callId)
    json(res, 200, { ok: true, totalBytes: watcher?.totalBytes ?? null })
  } catch {
    json(res, 500, { ok: false, error: 'internal error' })
  }
}

/** 尽力探测下载总大小：HEAD → Content-Length；退化 GET Range: 0-0 → Content-Range。 */
async function probeTotalBytes(url: string): Promise<number | null> {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'dsh-chat-flow-download/1.0' } })
    const len = res.headers.get('content-length')
    if (res.ok && len !== null && Number.isFinite(Number(len))) return Number(len)
  } catch { /* fall through */ }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'dsh-chat-flow-download/1.0', range: 'bytes=0-0' } })
    const range = res.headers.get('content-range')
    await res.body?.cancel().catch(() => {})
    const match = /\/(\d+)\s*$/.exec(range ?? '')
    if (match?.[1] !== undefined) return Number(match[1])
  } catch { /* give up */ }
  return null
}

/**
 * 注册 download 工具（在已注入 tools 的子上下文中调用）。
 * @param toolsCtx - tools 服务已就绪的插件上下文。
 */
export function applyDownloadTool(toolsCtx: Record<string, any>): void {
  toolsCtx.effect(() => toolsCtx.tools.register(downloadTool), 'dsh-chat-plus: download tool')
}
