/**
 * dsh-chat-plus — 浏览器按需拉起（host 半身）。
 *
 * ## 为什么需要它
 *
 * `browser-use-playwright-mcp` 走 `mode: attach`，指向专用 Chrome 的
 * `--remote-debugging-port=9222`。此前该 Chrome 由 Windows 计划任务
 * （登录自启 + 每 5 分钟看门狗）**常驻**：实测 9 个进程、约 1.0GB 内存，
 * 而当时系统可用内存只剩 5.4GB —— 用一次浏览器工具就常驻一整天的代价，
 * 与「偶尔用一次」的收益严重不匹配。
 *
 * ## 为什么可以按需（实测依据，2026-10-15，@playwright/mcp 0.0.80）
 *
 *  · MCP server 在 `agent/created` 时 spawn，但 `--cdp-endpoint` 是**懒连接**：
 *    端点不可达时 `initialize` 与 `tools/list`（24 个工具）照常返回；
 *  · 首次工具调用才连 CDP，端点不可达时报 `ECONNREFUSED`；
 *  · 之后把 Chrome 拉起来，**同一个 MCP server 再调一次即成功**（自愈）——
 *    不需要重启 DSH、不需要重建会话；
 *  · Chrome 冷启动到 `/json/version` 就绪实测约 300ms。
 *
 * 结论：在**工具调用时**同步把 Chrome 拉起来即可，首次调用就能成功，
 * 既不需要让模型重试，也不需要任何 DSH 源码改动。
 *
 * ## 做法
 *
 *  1. 包装 `tools/execute`：命中 `mcp__playwright-mcp__*` 时先确保 9222 就绪
 *     （已就绪直接放行；未就绪则拉起并轮询 `/json/version`，默认上限 20s）；
 *  2. 调用进行中不关；调用全部结束后起算，空闲 `idleMs`（默认 5 分钟）关掉
 *     **只由本插件拉起**的那个实例（用户自己开的 Chrome 一律不碰）；
 *  3. 归属记录落盘（`$DSH_HOME/dsh-chat-plus-browser-on-demand.json`）：宿主
 *     崩溃重启后仍能认领上一次拉起的实例，避免它变成没人管的常驻进程。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_CHROME_CANDIDATES,
  launchChrome,
  resolveChromePath,
  type ChromeRuntime,
} from '../browser/chrome.ts'

/** 默认 attach 端口（与 cordis.patch.yml 的 browser-use endpoint 一致）。 */
export const DEFAULT_ATTACH_PORT = 9222
/** 默认空闲关停时间：用户指定 5 分钟。 */
export const DEFAULT_IDLE_MS = 5 * 60 * 1000
/** 拉起后等待 CDP 就绪的上限（实测冷启动约 300ms，20s 是宽松兜底）。 */
export const DEFAULT_START_TIMEOUT_MS = 20_000
/** 就绪轮询间隔。 */
export const DEFAULT_POLL_INTERVAL_MS = 150
/** 浏览器工具前缀（与 provider 的 `mcp__<serverName>__` 规则一致）。 */
export const BROWSER_TOOL_PREFIX = 'mcp__playwright-mcp__'

/** 配置面（cordis.patch.yml 的 browserOnDemand 段）。 */
export interface BrowserOnDemandConfig {
  /** 总开关，默认 true。 */
  enabled?: boolean
  port?: number
  profileDir?: string
  idleMs?: number
  startTimeoutMs?: number
  pollIntervalMs?: number
  toolPrefix?: string
  /** 显式指定 Chrome/Edge 可执行文件（缺省按候选表探测）。 */
  chromePath?: string
  markerPath?: string
}

/** 日志面（与 cordis logger 同形，全部可选）。 */
export interface BrowserOnDemandLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
}

/** 归一化后的配置。 */
export interface ResolvedBrowserOnDemandConfig {
  port: number
  profileDir: string
  idleMs: number
  startTimeoutMs: number
  pollIntervalMs: number
  toolPrefix: string
  markerPath: string
}

/** 落盘的归属记录。 */
export interface OwnershipMarker {
  pid: number
  port: number
  profileDir: string
  startedAt: number
}

/** 专用 profile 目录（与 scripts/start-dsh-chrome.ps1 同一处）。 */
export function defaultProfileDir(): string {
  const base = process.env.LOCALAPPDATA
  if (typeof base === 'string' && base !== '') return path.join(base, 'dsh-chrome')
  return path.join(os.homedir(), '.dsh-chrome')
}

/** 归属记录文件位置（放 DSH_HOME，避免落在系统临时目录被清理后失去认领能力）。 */
export function defaultMarkerPath(): string {
  const home = process.env.DSH_HOME
  const base = typeof home === 'string' && home !== '' ? home : path.join(os.homedir(), '.dsh')
  return path.join(base, 'dsh-chat-plus-browser-on-demand.json')
}

/** 归一化配置（纯函数）。 */
export function resolveBrowserOnDemandConfig(
  config: BrowserOnDemandConfig = {},
): ResolvedBrowserOnDemandConfig {
  return {
    port: typeof config.port === 'number' && config.port > 0 ? config.port : DEFAULT_ATTACH_PORT,
    profileDir: typeof config.profileDir === 'string' && config.profileDir !== '' ? config.profileDir : defaultProfileDir(),
    idleMs: typeof config.idleMs === 'number' && config.idleMs >= 0 ? config.idleMs : DEFAULT_IDLE_MS,
    startTimeoutMs: typeof config.startTimeoutMs === 'number' && config.startTimeoutMs > 0
      ? config.startTimeoutMs
      : DEFAULT_START_TIMEOUT_MS,
    pollIntervalMs: typeof config.pollIntervalMs === 'number' && config.pollIntervalMs > 0
      ? config.pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS,
    toolPrefix: typeof config.toolPrefix === 'string' && config.toolPrefix !== '' ? config.toolPrefix : BROWSER_TOOL_PREFIX,
    markerPath: typeof config.markerPath === 'string' && config.markerPath !== '' ? config.markerPath : defaultMarkerPath(),
  }
}

/** 该工具名是否属于浏览器工具组（纯函数）。 */
export function isBrowserTool(name: unknown, prefix: string = BROWSER_TOOL_PREFIX): boolean {
  return typeof name === 'string' && name !== '' && name.startsWith(prefix)
}

/** 默认就绪探针：CDP 的 `/json/version` 能返回才算真就绪（只看端口会被别的进程骗过）。 */
export async function probeCdp(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 轮询直到就绪、超时或取消。
 *
 * @param probe 就绪探针（可注入，供测试）。
 * @param options 端口 / 上限 / 间隔 / 取消信号。
 * @returns 就绪返回 true；超时或取消返回 false。
 */
export async function waitForCdp(
  probe: (port: number) => Promise<boolean>,
  options: { port: number; timeoutMs: number; intervalMs: number; signal?: AbortSignal },
): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs
  for (;;) {
    if (options.signal?.aborted === true) return false
    if (await probe(options.port)) return true
    if (Date.now() >= deadline) return false
    await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs))
  }
}

/** 按 pid 关掉整棵进程树（Windows 用 taskkill /T /F，其它平台 SIGTERM）。 */
export function killChromeByPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      process.kill(pid, 'SIGTERM')
    }
  } catch {
    /* 进程可能已退出 */
  }
}

/** pid 是否还活着（用于认领落盘的归属记录）。 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 可注入的副作用面（生产走真实实现，冒烟测试传假实现）。 */
export interface OnDemandHooks {
  probe?: (port: number) => Promise<boolean>
  launch?: (config: ResolvedBrowserOnDemandConfig, chromePath: string) => ChromeRuntime
  resolveChrome?: () => string
  kill?: (pid: number) => void
  isAlive?: (pid: number) => boolean
  readMarker?: () => OwnershipMarker | null
  writeMarker?: (marker: OwnershipMarker) => void
  clearMarker?: () => void
  log?: BrowserOnDemandLogger
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** 读归属记录（坏文件一律当没有）。 */
function readMarkerFile(markerPath: string): OwnershipMarker | null {
  try {
    const raw = fs.readFileSync(markerPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<OwnershipMarker>
    if (typeof parsed?.pid !== 'number' || typeof parsed?.port !== 'number') return null
    return {
      pid: parsed.pid,
      port: parsed.port,
      profileDir: typeof parsed.profileDir === 'string' ? parsed.profileDir : '',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    }
  } catch {
    return null
  }
}

/**
 * 按需浏览器：确保 attach 目标在需要时存在，空闲后关掉自己拉起的那一个。
 *
 * 线程模型：所有状态都在 host 单线程里读写；`ensure()` 并发调用共享同一次拉起
 * （`starting` 去重），不会拉起两个实例。
 */
export class OnDemandBrowser {
  readonly config: ResolvedBrowserOnDemandConfig
  private readonly hooks: Required<Pick<OnDemandHooks, 'probe' | 'launch' | 'resolveChrome' | 'kill' | 'isAlive' | 'readMarker' | 'writeMarker' | 'clearMarker' | 'setTimer' | 'clearTimer'>> & { log: BrowserOnDemandLogger }
  /** 进行中的浏览器工具调用数：>0 时绝不关停。 */
  private active = 0
  /** 正在进行的拉起（去重并发）。 */
  private starting: Promise<void> | null = null
  /** 本插件拉起的实例 pid；null 表示「不是我们的」。 */
  private ownedPid: number | null = null
  private idleTimer: unknown = null
  private disposed = false

  constructor(config: BrowserOnDemandConfig = {}, hooks: OnDemandHooks = {}) {
    this.config = resolveBrowserOnDemandConfig(config)
    this.hooks = {
      probe: hooks.probe ?? ((port) => probeCdp(port)),
      // launchChrome 自带屏幕外定位（--window-position=-32000,-32000）并在启动前
      // 预写 profile 的 window_placement，所以这里不重复传窗口参数。
      launch: hooks.launch ?? ((cfg, chromePath) => launchChrome(chromePath, cfg.profileDir, cfg.port)),
      resolveChrome: hooks.resolveChrome ?? (() => resolveChromePath(DEFAULT_CHROME_CANDIDATES)),
      kill: hooks.kill ?? killChromeByPid,
      isAlive: hooks.isAlive ?? isProcessAlive,
      readMarker: hooks.readMarker ?? (() => readMarkerFile(this.config.markerPath)),
      writeMarker: hooks.writeMarker ?? ((marker) => {
        try {
          fs.mkdirSync(path.dirname(this.config.markerPath), { recursive: true })
          fs.writeFileSync(this.config.markerPath, JSON.stringify(marker), 'utf8')
        } catch { /* 落盘失败不影响本次运行，只影响崩溃后的认领 */ }
      }),
      clearMarker: hooks.clearMarker ?? (() => {
        try { fs.rmSync(this.config.markerPath, { force: true }) } catch { /* 忽略 */ }
      }),
      setTimer: hooks.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: hooks.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
      log: hooks.log ?? {},
    }
  }

  /** 本插件是否持有某个实例（诊断用）。 */
  get owns(): boolean {
    return this.ownedPid !== null
  }

  /** 开始一次浏览器工具调用：暂停空闲计时。 */
  beginCall(): void {
    this.active += 1
    this.cancelIdle()
  }

  /** 结束一次浏览器工具调用：全部结束才重新起算空闲。 */
  endCall(): void {
    this.active = Math.max(0, this.active - 1)
    if (this.active === 0 && this.ownedPid !== null) this.scheduleIdle()
  }

  /**
   * 确保 attach 端点可用（已就绪直接返回；否则拉起并等待就绪）。
   *
   * @param signal 调用方取消信号；取消时本次等待立即结束（拉起的实例留给空闲回收）。
   * @throws 找不到浏览器、或拉起后 CDP 未在超时内就绪。
   */
  async ensure(signal?: AbortSignal): Promise<void> {
    if (this.disposed) return
    if (await this.hooks.probe(this.config.port)) {
      this.adoptIfOwned()
      return
    }
    if (this.starting === null) {
      this.starting = this.launchAndWait(signal).finally(() => { this.starting = null })
    }
    await this.starting
  }

  /** 关闭本插件拉起的实例（用户的实例不动）。 */
  shutdown(reason: string): void {
    this.cancelIdle()
    if (this.ownedPid === null) return
    const pid = this.ownedPid
    this.ownedPid = null
    this.hooks.kill(pid)
    this.hooks.clearMarker()
    this.hooks.log.info?.(`[browser-on-demand] 已关停 Chrome（pid=${pid}，${reason}）`)
  }

  /** 卸载：清计时器并关掉自己拉起的实例，避免留下孤儿进程。 */
  dispose(): void {
    this.disposed = true
    this.shutdown('插件卸载')
  }

  /** 端点本来就活着：若落盘记录表明是「上一次本插件拉起的」，认领它。 */
  private adoptIfOwned(): void {
    if (this.ownedPid !== null) return
    const marker = this.hooks.readMarker()
    if (marker === null) return
    if (marker.port !== this.config.port) return
    if (!this.hooks.isAlive(marker.pid)) return
    this.ownedPid = marker.pid
    this.hooks.log.info?.(`[browser-on-demand] 认领上次拉起的 Chrome（pid=${marker.pid}）`)
    if (this.active === 0) this.scheduleIdle()
  }

  /** 真正拉起 + 等就绪。 */
  private async launchAndWait(signal?: AbortSignal): Promise<void> {
    if (this.disposed) return
    if (await this.hooks.probe(this.config.port)) return
    let chromePath: string
    try {
      chromePath = this.hooks.resolveChrome()
    } catch (error) {
      throw new Error(
        `browser-on-demand: 未找到 Chrome/Edge 可执行文件（${error instanceof Error ? error.message : String(error)}）`,
      )
    }
    this.hooks.log.info?.(`[browser-on-demand] 按需拉起 Chrome（port=${this.config.port}, profile=${this.config.profileDir}）`)
    const runtime = this.hooks.launch(this.config, chromePath)
    const pid = runtime?.proc?.pid ?? 0
    this.ownedPid = pid > 0 ? pid : null
    if (this.ownedPid !== null) {
      this.hooks.writeMarker({
        pid: this.ownedPid,
        port: this.config.port,
        profileDir: this.config.profileDir,
        startedAt: Date.now(),
      })
    }
    const ready = await waitForCdp(this.hooks.probe, {
      port: this.config.port,
      timeoutMs: this.config.startTimeoutMs,
      intervalMs: this.config.pollIntervalMs,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!ready) {
      // 调用方取消 ≠ 启动失败：进程是好的，只是这次没人等了。留着交空闲回收，
      // 免得用户点了「停止」顺带把刚拉起的浏览器也一起杀掉。
      if (signal?.aborted === true) {
        if (this.active === 0) this.scheduleIdle()
        return
      }
      // 真没就绪：立刻关掉，别留半死进程白占内存。
      this.shutdown('启动未就绪')
      throw new Error(`browser-on-demand: Chrome 已启动但 CDP 未在 ${this.config.startTimeoutMs}ms 内就绪`)
    }
    this.hooks.log.info?.('[browser-on-demand] Chrome CDP 就绪')
    if (this.active === 0) this.scheduleIdle()
  }

  /** 起算空闲关停。 */
  private scheduleIdle(): void {
    this.cancelIdle()
    if (this.config.idleMs <= 0) return
    this.idleTimer = this.hooks.setTimer(() => {
      this.idleTimer = null
      if (this.active > 0) return
      this.shutdown(`空闲 ${Math.round(this.config.idleMs / 1000)}s`)
    }, this.config.idleMs)
  }

  /** 撤销空闲关停。 */
  private cancelIdle(): void {
    if (this.idleTimer === null) return
    this.hooks.clearTimer(this.idleTimer)
    this.idleTimer = null
  }
}

/** 本模块用到的 ctx 面（刻意不引 @deepseek-ai/cordis：host 产物必须零运行时依赖）。 */
export interface OnDemandHostContext {
  logger?: BrowserOnDemandLogger
  on?: (
    event: string,
    listener: (exec: { name?: unknown; signal?: AbortSignal }, next: () => Promise<unknown>) => Promise<unknown>,
  ) => void
  effect?: (fn: () => void | (() => void), label?: string) => void
}

/**
 * 装配按需浏览器。在 host 的 apply 同步路径上调用一次即可。
 *
 * 走 `tools/execute` 的**出口包装**而不是更早的钩子：CDP 连接发生在工具真正
 * 派发时（MCP server 的 `--cdp-endpoint` 是懒连接），所以在这一层等待 Chrome
 * 就绪，正好赶在连接之前 —— 首次调用即成功，无需模型重试。
 *
 * @param ctx host 上下文（只用 logger 与 on）。
 * @param config browserOnDemand 配置段。
 * @returns 句柄（诊断/测试用）。
 */
export function applyBrowserOnDemand(
  ctx: OnDemandHostContext,
  config: BrowserOnDemandConfig = {},
): OnDemandBrowser | null {
  if (config.enabled === false) return null
  if (typeof ctx.on !== 'function') {
    ctx.logger?.warn?.('[browser-on-demand] ctx.on unavailable: 按需拉起未装配')
    return null
  }
  const browser = new OnDemandBrowser(config, { ...(ctx.logger === undefined ? {} : { log: ctx.logger }) })
  const prefix = browser.config.toolPrefix
  ctx.on('tools/execute', async (exec, next) => {
    if (!isBrowserTool(exec?.name, prefix)) return next()
    browser.beginCall()
    try {
      await browser.ensure(exec?.signal)
      return await next()
    } finally {
      browser.endCall()
    }
  })
  // 插件卸载时关掉自己拉起的实例，别留孤儿进程。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => browser.dispose(), 'dsh-chat-plus.browser-on-demand')
  }
  ctx.logger?.info?.(
    `[browser-on-demand] 就绪：port=${browser.config.port}，空闲 ${Math.round(browser.config.idleMs / 1000)}s 后关停`,
  )
  return browser
}

/** 测试面（冒烟直接断言纯函数与状态机，不依赖真实 Chrome/计时器）。 */
export const __test = {
  resolveBrowserOnDemandConfig,
  isBrowserTool,
  waitForCdp,
  readMarkerFile,
  defaultProfileDir,
  defaultMarkerPath,
}
