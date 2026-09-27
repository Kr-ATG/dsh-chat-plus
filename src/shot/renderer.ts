/**
 * webui — 截图渲染引擎（host 端）：常驻无头浏览器 + 串行渲染队列。
 *
 * 与旧实现的区别：不再「每次截图起一个 Edge/Chrome、截完杀掉」——那条路径每张
 * 图都要付 1.5~3s 的冷启动。这里维护一个常驻实例（固定 profile 目录，复用磁盘
 * 与字体缓存），首张图之后只剩导航 + 截图的开销；空闲超过 IDLE_TTL_MS 自动
 * 回收，插件卸载时一并关掉。
 *
 * 稳定性：连接/目标失效（用户手杀进程、Chrome 崩溃）时自动重建一次再试，不把
 * 首次失败直接抛给调用方；渲染串行化，避免多请求同时抢同一个 target。
 */
import { createGunzip } from 'node:zlib'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  CdpConnection, captureScreenshot, createPageSession, evaluateJson,
  fetchBrowserWsUrl, navigateAndWait, setViewport, type CdpSession,
} from '../browser/cdp.ts'
import {
  DEFAULT_CHROME_CANDIDATES, findFreePort, killChrome, launchChrome,
  resolveChromePath, type ChromeRuntime,
} from '../browser/chrome.ts'
import { MERMAID_FILE, MERMAID_HOOK } from './card.ts'
import { stitchPng, MAX_STITCH_PIXELS, type PngTile } from './stitch.ts'

/**
 * 随包分发的 mermaid 引擎（预压缩，与前端 /dyn-assets/vendor 同一份资源）。
 *
 * 路径要兼容两种产物形态：tsdown 把 host 打成单文件 lib/index.js（`..` 即包根），
 * tsc 则保留目录结构 lib/screenshot/renderer.js（`../..` 才是包根）。
 */
const MERMAID_GZ = ((): string => {
  const candidates = [
    join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'vendor', 'mermaid.min.js.gz'),
    join(fileURLToPath(new URL('../..', import.meta.url)), 'assets', 'vendor', 'mermaid.min.js.gz'),
  ]
  return candidates.find(path => existsSync(path)) ?? candidates[0]!
})()
/** 图表渲染等待上限（引擎解析 + 画图；超时按现状截，不卡死截图）。 */
const MERMAID_WAIT_MS = 20000

/** 常驻实例空闲回收时长：这段时间没有新截图就关掉浏览器。 */
const IDLE_TTL_MS = 5 * 60_000
/** 长图高度上限（输出设备像素）：4K 档缩放更大，同一上限要按 scale 折算。 */
const MAX_DEVICE_HEIGHT = 28000
/**
 * 单段截图输出像素高度上限。Chromium/Edge 无头（--disable-gpu 软件渲染）的
 * 合成表面超过可处理临界（实测约 4300~4500 万输出像素，4080 宽 × ~1.05 万高）
 * 时，Page.captureScreenshot 会挂死 → 渲染管线被重置 → CDP 断连报
 * 「CDP 连接已关闭」。分段截图把每段压到 4080×8190（≈3342 万像素，留 25%+
 * 余量），实测每段 <600ms 稳定出图。clip + captureBeyondViewport 不可行：
 * 合成表面仍按整视口全高合成，照样挂死——必须让视口本身保持小尺寸。
 */
const MAX_SEGMENT_DEVICE_HEIGHT = 8192
/**
 * 单次/单段截图输出设备像素安全上限（约 800 万像素，留出充足安全裕量）。
 * 保证单次输出 PNG 体积在 1.5MB 以内（Base64 <= 2MB），杜绝 DevTools WebSocket
 * 报文溢出（~4MB 限制）与 CDP 异常断连崩溃。
 */
const MAX_SAFE_SURFACE_PIXELS = 8_000_000
/** 固定画幅模式下允许的最大输出设备宽度（4096px，对应 4K 宽屏），超出时平滑转为全长长图。 */
const MAX_DEVICE_WIDTH = 4096

/** 渲染引擎运行时状态。 */
interface Engine {
  runtime: ChromeRuntime
  conn: CdpConnection
  session: CdpSession
  /** 该实例的工作目录（临时页面等）。 */
  dir: string
  /** 该实例独立分配的 profile 目录。 */
  profileDir: string
}

let engine: Engine | null = null
let idleTimer: NodeJS.Timeout | null = null
let chain: Promise<unknown> = Promise.resolve()
/** 工作目录提供者（由 applyScreenshot 注入，指向 storages 下的 .engine）。 */
let baseDirProvider: () => string = () => join(process.cwd(), '.dsh-shot-engine')
/**
 * 浏览器候选游标：默认从 0（Chrome 优先）开始；渲染失败重试时
 * 顺延到下一个候选（Chrome 失败 → Edge 兜底），全部候选都失败
 * 才上报。空闲回收后重置回 0，保持「默认 Chrome、坏了自动换 Edge」。
 */
let candidateOffset = 0

/** 取截图引擎专用的浏览器可执行文件：默认 Chrome 优先，失败重试时按游标轮换到 Edge 等候选。 */
function pickChromeCandidate(): string {
  const usable = DEFAULT_CHROME_CANDIDATES.filter(candidate => Boolean(candidate && existsSync(candidate)))
  if (usable.length === 0) {
    throw new Error('未找到 Chrome/Edge 可执行文件')
  }
  const chromeFirst = [...usable].sort((a, b) => Number(/chrome/i.test(b)) - Number(/chrome/i.test(a)))
  const pick = chromeFirst[candidateOffset % chromeFirst.length] as string
  return pick
}

/**
 * 配置渲染引擎的工作目录。
 * @param baseDir - 返回工作目录绝对路径的函数（profile 与临时 HTML 落在这里）。
 */
export function configureRenderer(baseDir: () => string): void {
  baseDirProvider = baseDir
}

/** 重置空闲回收计时（每次渲染后调用）。空闲回收关停实例时把浏览器候选
 *  游标一并重置——下一次冷启动仍从 Chrome 开始（Edge 只是兜底）。 */
function touchIdle(): void {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    candidateOffset = 0
    void shutdownRenderer()
  }, IDLE_TTL_MS)
  // 不阻塞进程退出：空闲回收只为省内存，不该拖住 DSH 关停。
  idleTimer.unref?.()
}

/** 关闭常驻实例（幂等；空闲回收与插件卸载共用）。 */
export async function shutdownRenderer(): Promise<void> {
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null }
  const current = engine
  engine = null
  if (current === null) return
  try { current.conn.close() } catch { /* 已断开 */ }
  killChrome(current.runtime, true)
  // 给进程树一点退出时间：Windows 上文件句柄释放有延迟
  await new Promise(resolve => setTimeout(resolve, 300))
  await rm(join(current.dir, 'page'), { recursive: true, force: true }).catch(() => {})
  await rm(current.profileDir, { recursive: true, force: true }).catch(() => {})
  /*
   * 顺带清理**崩溃残留**的历史 profile 目录。
   *
   * 原来这里清的是 `join(current.dir, 'profile')` —— 一个精确路径，现在的代码
   * 根本不会生成它（launch 建的是 `profile-<时间戳>-<随机>`）。于是这段「历史
   * 清理」从来没清到过任何东西：DSH 崩溃 / 被任务管理器强杀 / 渲染中进程被杀
   * 时留下的完整 Chrome user-data-dir（Cache、GPUCache、Service Worker，
   * 几十到数百 MB）没有任何回收路径，反复崩溃使用会无上限堆积。
   * renderOnce 的 finally 同理只在进程活着时才清 page/shot-*.html。
   */
  await cleanupOrphanProfiles(current.dir, current.profileDir).catch(() => {})
}

/** 删除 dir 下除 keep 之外的所有 profile-* 目录（keep 传 undefined 表示全清）。 */
async function cleanupOrphanProfiles(dir: string, keep?: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (!name.startsWith('profile-')) continue
    const full = join(dir, name)
    if (keep !== undefined && full === keep) continue
    await rm(full, { recursive: true, force: true }).catch(() => {})
  }
}

/** 取得可用实例：已存在且连接健康则复用，否则重建。
 *  健康判定不止 ws readyState——连接可能假死（ws 开着但浏览器已无响应），
 *  这里多发一个轻量 Browser.getVersion 探活，任何异常都走重建。 */
async function ensureEngine(): Promise<Engine> {
  if (engine !== null && engine.conn.connected) {
    try {
      await engine.conn.send('Browser.getVersion', {}, undefined, 5000)
      return engine
    } catch {
      // 假死连接：按失活处理，走下方重建。
    }
  }
  await shutdownRenderer()
  engine = await launch()
  return engine
}

/** 启动一个新的常驻实例。 */
async function launch(): Promise<Engine> {
  const chromePath = pickChromeCandidate()
  const port = await findFreePort(9400)
  const dir = baseDirProvider()
  // 启动前先收一遍上一批崩溃残留（见 cleanupOrphanProfiles 的说明）：这次
  // 异常退出留下的目录正好是「没有 keep 的历史批次」，一次启动即可清空。
  await cleanupOrphanProfiles(dir).catch(() => {})
  // 采用独立带时间戳的 profile 目录，彻底免疫 Windows 下进程残留引发的 SingletonLock 冲突
  const profileDir = join(dir, `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await mkdir(profileDir, { recursive: true })
  const flags = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--disable-web-security',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-sync',
    '--mute-audio',
  ]
  const runtime = launchChrome(chromePath, profileDir, port, flags, join(dir, 'engine.log'))
  try {
    const wsUrl = await fetchBrowserWsUrl(port, 20000)
    const conn = new CdpConnection(wsUrl)
    await conn.connect(10000)
    const session = await createPageSession(conn, 'about:blank')
    return { runtime, conn, session, dir, profileDir }
  } catch (error) {
    killChrome(runtime, true)
    // 启动失败（可能是残留进程占着 profile）：等退出后清掉目录，下次全新启动。
    await new Promise(resolve => setTimeout(resolve, 300))
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** 页面稳定脚本：字体就绪 + 图片解码完成（最多等 waitMs，超时按现状截）。 */
function settleJs(waitMs: number): string {
  return `(async () => {
  const deadline = Date.now() + ${waitMs};
  try {
    await Promise.race([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, Math.min(${waitMs}, 1200))),
    ]);
  } catch (e) {}
  await Promise.all(Array.from(document.images).map((img) => {
    if (img.complete) return null;
    return new Promise((resolve) => {
      const done = () => resolve(null);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, Math.max(0, deadline - Date.now()));
    });
  }));
  return true;
})()`
}

/** 测量卡片及外边距的实际渲染高度（CSS px）。 */
async function measureContentHeight(session: CdpSession): Promise<number> {
  const value = await evaluateJson(
    session,
    `(() => {
      const card = document.querySelector('.card');
      const body = document.body;
      const html = document.documentElement;
      if (!card) return Math.max(body ? body.scrollHeight : 0, html ? html.scrollHeight : 0);
      const rect = card.getBoundingClientRect();
      const style = window.getComputedStyle(body);
      const padTop = parseFloat(style.paddingTop) || 0;
      const padBottom = parseFloat(style.paddingBottom) || 0;
      return Math.round(rect.height + padTop + padBottom);
    })()`,
    false,
  )
  return Math.round(Number(value)) || 0
}

/** 测量文档内容高度（CSS px）。 */
async function measureHeight(session: CdpSession): Promise<number> {
  const value = await evaluateJson(
    session,
    'Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)',
    false,
  )
  return Math.round(Number(value)) || 0
}

/** 渲染参数。 */
export interface RenderInput {
  html: string
  /** 布局视口宽度（CSS px）。 */
  width: number
  /** 起始视口高度（CSS px），内容更高时自动扩展成长图。 */
  height: number
  /** 目标画幅比例（width / height，如 16/9），自适应长图为 null / undefined。 */
  aspectRatio?: number | null
  /** 输出缩放（deviceScaleFactor；缺省 2x）。 */
  scale?: number
  /** 正文含 mermaid 围栏：投放引擎文件并等图画完再截。 */
  needsMermaid?: boolean
}

/**
 * 把 mermaid 引擎解压到临时页面目录（页面用相对路径同目录加载）。
 * 已存在就复用 —— 常驻实例的 page 目录在两次截图之间不清理，解压只付一次
 * （~3.4MB 写盘）；引擎资源缺失时返回 false，页面回落成源码块。
 */
async function ensureMermaidAsset(pageDir: string): Promise<boolean> {
  const target = join(pageDir, MERMAID_FILE)
  if (existsSync(target)) return true
  if (!existsSync(MERMAID_GZ)) {
    console.warn('[chat-flow-screenshot] mermaid asset missing, diagrams fall back to source:', MERMAID_GZ)
    return false
  }
  try {
    await pipeline(createReadStream(MERMAID_GZ), createGunzip(), createWriteStream(target))
    return true
  } catch (error) {
    console.warn('[chat-flow-screenshot] mermaid asset unpack failed:', String((error as Error)?.message ?? error))
    await rm(target, { force: true }).catch(() => {})
    return false
  }
}

/**
 * 等页面里的图画完（card.ts 的引导脚本把整批渲染暴露成 window 上的 promise）。
 * 超时/异常都不抛：宁可截一张图没画完的，也不让截图整体失败。
 */
async function waitMermaid(session: CdpSession): Promise<void> {
  await evaluateJson(
    session,
    `(async () => {
  const hook = window.${MERMAID_HOOK};
  if (hook === undefined) return 'absent';
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), ${MERMAID_WAIT_MS}));
  const result = await Promise.race([Promise.resolve(hook).catch(() => 'failed'), timeout]);
  // 图是同步插进 DOM 的，但字体/布局要一帧才稳定。
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    await Promise.race([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
  } catch (error) {}
  return result;
})()`,
    true,
    MERMAID_WAIT_MS + 2000,
  ).catch(() => null)
}

/**
 * 引擎健康诊断：逐步探测「实例状态 → CDP 探活 → 冷启动新实例 → 版本信息」，
 * 并报告浏览器候选与游标。供 /api/webui-screenshot/diagnose 调用，排查
 * 「CDP 连接已关闭」不再靠猜。
 */
export async function diagnoseEngine(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    hasEngine: engine !== null,
    candidateOffset,
    browser: engine?.runtime.proc.spawnfile ?? null,
    candidates: DEFAULT_CHROME_CANDIDATES.filter(candidate => existsSync(candidate)),
  }
  if (engine !== null) {
    out.connected = engine.conn.connected
    if (engine.conn.connected) {
      try {
        const version = await engine.conn.send('Browser.getVersion', {}, undefined, 5000)
        out.version = version
      } catch (error) {
        out.probeError = String((error as Error)?.message ?? error)
      }
    }
  }
  try {
    const started = await ensureEngine()
    out.engineReady = true
    out.port = started.runtime.port
    out.browser = started.runtime.proc.spawnfile
    try {
      const version = await started.conn.send('Browser.getVersion', {}, undefined, 5000)
      out.version = version
    } catch (error) {
      out.versionError = String((error as Error)?.message ?? error)
    }
  } catch (error) {
    out.engineError = String((error as Error)?.message ?? error)
  }
  return out
}

/** 一次渲染（内部：假定已在串行队列内、实例已就绪）。 */
async function renderOnce(target: Engine, input: RenderInput): Promise<string> {
  const scale = input.scale ?? 2
  // 高度上限按缩放折算成 CSS px，保证输出设备像素不超 Chromium 合成限制。
  const maxCssHeight = Math.min(16000, Math.floor(MAX_DEVICE_HEIGHT / scale))
  const pageDir = join(target.dir, 'page')
  await mkdir(pageDir, { recursive: true })
  if (input.needsMermaid === true) await ensureMermaidAsset(pageDir)
  const htmlFile = join(pageDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`)
  await writeFile(htmlFile, input.html, 'utf8')
  try {
    await setViewport(target.session, input.width, input.height, scale)
    await navigateAndWait(target.session, `file:///${htmlFile.replaceAll('\\', '/')}`, 15000, true)
    await evaluateJson(target.session, settleJs(2500), true, 5000).catch(() => null)
    // 图表要等引擎画完再量高度，否则测到的是源码块的高度（长图会被截断）。
    if (input.needsMermaid === true) await waitMermaid(target.session)
    let cssWidth = input.width
    let cssHeight = input.height
    const ratio = typeof input.aspectRatio === 'number' && input.aspectRatio > 0 ? input.aspectRatio : null

    // 测量卡片真实内容高度（包含 padding）
    const measuredHeight = await measureContentHeight(target.session)
    const contentHeight = Math.max(measuredHeight, input.height)

    // 视口安全宽度上限（按缩放折算成 CSS px，不超过 4K 物理宽 4096px，也不低于基准排版宽）
    const maxCssWidth = Math.max(input.width, Math.min(2560, Math.floor(MAX_DEVICE_WIDTH / scale)))

    if (ratio !== null) {
      // 固定画幅比例（width / height = ratio）：
      // 既包容内容高度（不截断文字），又保持排版宽度不小于基准排版宽。
      const candidateH = Math.round(input.width / ratio)
      if (candidateH >= contentHeight) {
        // 短内容：排版宽度保持不变，高度向下延展补画布以满足比例
        cssWidth = input.width
        cssHeight = Math.min(candidateH, maxCssHeight)
      } else {
        // 较长内容：高度由卡片内容撑开，宽度向两侧延展以满足画幅比例
        const candidateW = Math.round(contentHeight * ratio)
        const totalPixels = candidateW * contentHeight * scale * scale
        if (candidateW <= maxCssWidth && totalPixels <= MAX_SAFE_SURFACE_PIXELS) {
          // 在安全尺寸与像素预算内，完全维持画幅比例
          cssWidth = candidateW
          cssHeight = Math.min(contentHeight, maxCssHeight)
        } else {
          // 极端超长长图：无法在安全分辨率内维持画幅；
          // 宽度钳制在安全上限，高度完整保留长图（由 aspectLocked = false 告知前端）
          cssWidth = Math.min(candidateW, maxCssWidth)
          cssHeight = Math.min(contentHeight, maxCssHeight)
        }
      }
    } else {
      // 自适应模式：宽度为基准宽度，高度贴合内容长图
      cssHeight = Math.min(contentHeight, maxCssHeight)
    }

    /*
     * 长图整图输出预算。
     *
     * 前面几个上限管的是**单段**（Chromium 合成表面 / WebSocket 报文），整图拼
     * 接阶段没人管：4K 档 + 超长会话会排出 1.15 亿像素，拼接的峰值内存逼近 1GB，
     * Node 扛不住就是被 OOM 直接带崩。这里把整图钳到预算内——宁可长图被截断
     * （前端已能通过 aspectLocked=false 知道画幅没守住），也不让整个 DSH 消失。
     */
    const outWidth = Math.round(cssWidth * scale)
    const maxOutHeight = Math.max(600, Math.floor(MAX_STITCH_PIXELS / Math.max(1, outWidth)))
    if (Math.round(cssHeight * scale) > maxOutHeight) {
      cssHeight = Math.min(cssHeight, Math.floor(maxOutHeight / scale))
    }

    const deviceWidth = Math.round(cssWidth * scale)
    const deviceHeight = Math.round(cssHeight * scale)
    const totalPixels = deviceWidth * deviceHeight
    const needsTiling = deviceHeight > MAX_SEGMENT_DEVICE_HEIGHT || totalPixels > MAX_SAFE_SURFACE_PIXELS

    // 仅在单张直出模式下设置全高视口；需要分段截取时跳过，避免一次性分配超大合成表面导致 Chromium 崩溃
    if (!needsTiling) {
      await setViewport(target.session, cssWidth, cssHeight, scale)
      await evaluateJson(target.session, 'new Promise(r => requestAnimationFrame(r))', true).catch(() => null)
    }

    return await captureTiled(target.session, cssWidth, cssHeight, scale)
  } finally {
    await rm(htmlFile, { force: true }).catch(() => {})
  }
}

/**
 * 截取当前页面为 PNG（base64）。输出表面超临界时自动分段滚动截图 + 拼接。
 * 段与段之间的衔接：滚动位置 y 逐段累加，最后一段视口高设为「剩余高」，
 * 保证 scrollTo(y) 不被浏览器钳制（钳制会导致该段与上一段重叠/错位）。
 */
async function captureTiled(
  session: CdpSession,
  cssWidth: number,
  cssHeight: number,
  scale: number,
): Promise<string> {
  const deviceWidth = Math.round(cssWidth * scale)
  const deviceHeight = Math.round(cssHeight * scale)
  const totalPixels = deviceWidth * deviceHeight

  // 只有当高度在分段上限内且单次输出像素在安全预算内，才走单张直出
  if (deviceHeight <= MAX_SEGMENT_DEVICE_HEIGHT && totalPixels <= MAX_SAFE_SURFACE_PIXELS) {
    return captureScreenshot(session, 100, 'png', true, 30000)
  }

  // 动态分段高度：既不超过 MAX_SEGMENT_DEVICE_HEIGHT，也保证单段设备像素不超 MAX_SAFE_SURFACE_PIXELS
  const maxSegDeviceHeight = Math.min(
    MAX_SEGMENT_DEVICE_HEIGHT,
    Math.floor(MAX_SAFE_SURFACE_PIXELS / Math.max(1, deviceWidth)),
  )
  const segCss = Math.max(200, Math.floor(maxSegDeviceHeight / scale))
  const tiles: PngTile[] = []
  // 视口高缓存：参数相同时跳过 setDeviceMetricsOverride（每次覆写都会重置
  // 页面的合成/滚动状态，白付一个 CDP 往返）；最后一段视口=剩余高。
  let vpHeight = -1
  for (let y = 0; y < cssHeight; y += segCss) {
    const segCssHeight = Math.min(segCss, cssHeight - y)
    if (segCssHeight !== vpHeight) {
      await setViewport(session, cssWidth, segCssHeight, scale)
      vpHeight = segCssHeight
    }
    await evaluateJson(
      session,
      `new Promise((resolve) => { window.scrollTo(0, ${y}); setTimeout(resolve, 150) })`,
      true,
    ).catch(() => {})
    const png = Buffer.from(await captureScreenshot(session, 100, 'png', true, 30000), 'base64')
    tiles.push({
      png,
      x: 0,
      y: Math.round(y * scale),
      width: deviceWidth,
      height: Math.round(segCssHeight * scale),
    })
  }
  const totalHeight = tiles.reduce((sum, tile) => sum + tile.height, 0)
  return stitchPng(tiles, deviceWidth, totalHeight).toString('base64')
}

/**
 * 量一个本地 HTML 页面在给定排版宽度下的内容高度（CSS px）。
 *
 * 截图里内嵌本地 HTML 用的是 file:// iframe（卡片页自己也是 file://，相对
 * 资源能正常解析），但跨源的 iframe 读不到内部 DOM，高度只能事先单独量：
 * 复用常驻实例导航到该文件 → 等稳定 → 量 scrollHeight → 夹进 [160, 2400]。
 * 任何失败都回兜底高度，绝不因为一张嵌入页量不到而让整张截图失败。
 * @param fileUrl - 目标页面的 file:// 地址。
 * @param cssWidth - 与 iframe 一致的排版宽度（CSS px）。
 * @param fallback - 量不到时的兜底高度。
 */
export async function probePageHeight(fileUrl: string, cssWidth: number, fallback = 620): Promise<number> {
  const task = async (): Promise<number> => {
    try {
      const target = await ensureEngine()
      await setViewport(target.session, cssWidth, 800, 1)
      await navigateAndWait(target.session, fileUrl, 8000, true)
      await evaluateJson(target.session, settleJs(1500), true, 4000).catch(() => null)
      const measured = await measureHeight(target.session)
      return Math.max(160, Math.min(2400, measured > 0 ? measured : fallback))
    } catch {
      return fallback
    } finally {
      touchIdle()
    }
  }
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run
}

/**
 * 渲染 HTML 为 PNG（base64）。串行执行；实例失效时自动重建并重试一次。
 * @param input - HTML 与视口尺寸。
 * @returns PNG 的 base64 数据（不含 data: 前缀）。
 */
export function renderPng(input: RenderInput): Promise<string> {
  const task = async (): Promise<string> => {
    try {
      return await renderOnce(await ensureEngine(), input)
    } catch (firstError) {
      // 实例可能已被外部杀掉或崩溃：重建一次再试，且**换下一个浏览器候选**
      //（Chrome 失败 → Edge 兜底），排除单一浏览器无头模式的偶发问题。
      const firstBrowser = engine?.runtime.proc.spawnfile ?? 'unknown'
      console.warn('[chat-flow-screenshot] render failed, engine will be rebuilt with next browser candidate:',
        `${firstBrowser}:`, String((firstError as Error)?.message ?? firstError))
      candidateOffset += 1
      await shutdownRenderer()
      try {
        return await renderOnce(await ensureEngine(), input)
      } catch (retryError) {
        await shutdownRenderer()
        const message = retryError instanceof Error ? retryError.message : String(retryError)
        throw new Error(`${message}（截图引擎已自动重建并换用备用浏览器重试仍失败；可再点一次「重新渲染」触发全新实例）`)
      }
    } finally {
      touchIdle()
    }
  }
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run
}
