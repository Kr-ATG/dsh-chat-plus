// dsh-network-proxy — host 半身
//
// 目标：不改内核源码，为 DSH 提供「自定义网络代理」——解决 api.b.ai（B.AI）、
// 其他海外直连超时的服务。机制（自 dsh-webui 的 proxy.ts 移植并加固）：
//
//   1. 包装 globalThis.fetch：按目标 host 命中（all 模式全部命中 / selected
//      模式命中选中厂商域名与额外域名）时注入 undici ProxyAgent dispatcher；
//   2. all 模式额外把 Symbol.for('undici.globalDispatcher.1') 换成 ProxyAgent，
//      兜底不经 globalThis.fetch 的 undici 通道；
//   3. settings 命名空间 `network-proxy` 持久化，HTTP API 保存即生效、无需重启：
//        GET  /api/dsh-proxy/state | providers | test
//        POST /api/dsh-proxy/set
//
// 解除代理的注意点（内核契约）：该 symbol 是 Node 内建 configurable:false 数据
// 属性，delete 静默失败；解除必须「赋值回启动时捕获的原始 dispatcher」。
//
// 与旧版的差异：
//   * undici 加载改为 DSH home 的 profiles/node_modules → 当前工作目录（DSH
//     仓库根）→ pnpm store 扫描，不再依赖硬编码仓库绝对路径；
//   * HTTP API 加回环围栏（与 model-capabilities 同款），避免非本机访问。
import z from '../vendor/schemastery/index.mjs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

export const name = 'dsh-network-proxy'
export const inject = ['settings', 'webServer']

const DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1')
const ORIGINAL_FETCH = Symbol.for('dsh-proxy.originalFetch')
const DEFAULT_PROXY = 'http://127.0.0.1:10808'
/** 连通性自检目标与超时：走代理请求一个轻量海外端点。 */
const PROBE_URL = 'https://www.gstatic.com/generate_204'
const PROBE_TIMEOUT_MS = 8000
/** settings 命名空间。 */
const NS = 'network-proxy'
/** HTTP API 前缀（长于内核 /api 围栏前缀，最长前缀匹配优先 → 浏览器免鉴权可达）。 */
const ROUTE_PREFIX = '/api/dsh-proxy'
/** 请求体上限。 */
const MAX_BODY_BYTES = 1024 * 1024

// ── undici 加载（多级候选；按与 Node 内置 fetch 同大版本优先）──────────────

function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return join(homedir(), '.dsh')
}

/**
 * Node 内置 fetch 的 undici 主版本。dispatcher 协议在同大版本内兼容：把别处
 * 安装的 undici ProxyAgent 注入 Node 内置 fetch（undici 7.x），版本差异过大
 * 会抛 "invalid onRequestStart method"（实测：Node 24 内置 7.24.4，注入
 * undici 8.10.0 的 ProxyAgent 必挂；注入 7.28.0 正常）。所以加载时必须选
 * 与 process.versions.undici 同大版本的实例。
 */
function bundledUndiciMajor() {
  try {
    const raw = process.versions && process.versions.undici
    if (typeof raw !== 'string') return null
    const major = Number(raw.split('.')[0])
    return Number.isFinite(major) && major > 0 ? major : null
  } catch { return null }
}

/**
 * 从宿主可解析的位置加载 undici（候选：DSH home 的 profiles/node_modules ->
 * 当前工作目录 -> DSH pnpm store 扫描）。插件经 junction 装在
 * profiles/node_modules 下，但 ESM 解析会把模块锚定到真实路径
 * （D:\AI\Dsh\dsh-network-proxy），所以必须显式用锚点文件定位。
 */
function loadUndici() {
  const bundledMajor = bundledUndiciMajor()
  const candidates = []

  // 1) DSH home 的 profiles/node_modules（undici 已随安装就位）
  try {
    candidates.push(join(dshHome(), 'profiles', 'node_modules', '__probe__.js'))
    candidates.push(join(dshHome(), 'profiles', 'desktop', 'node_modules', '__probe__.js'))
    candidates.push(join(dshHome(), 'profiles', 'web', 'node_modules', '__probe__.js'))
  } catch { /* ignore */ }

  // 2) 当前工作目录（`dsh web` 在仓库根启动；仓库根若无 undici 则靠第 3 级兜底）
  try {
    candidates.push(join(process.cwd(), 'package.json'))
  } catch { /* ignore */ }

  // 3) cwd pnpm store 扫描：undici@* 全部入列
  try {
    const storeBase = join(process.cwd(), 'node_modules', '.pnpm')
    const dirs = readdirSync(storeBase)
      .filter((d) => d.startsWith('undici@') && !d.includes('undici-types'))
    for (const dir of dirs) {
      candidates.push(join(storeBase, dir, 'node_modules', 'undici', 'package.json'))
    }
  } catch { /* store 扫描失败则跳过 */ }

  // 3b) 插件自身物理目录向上找 pnpm store（含 sibling 目录如 dsh-runtime）
  try {
    const selfDir = join(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..')
    let cur = selfDir
    for (let i = 0; i < 5; i++) {
      for (const sub of ['', 'dsh-runtime', 'deepseek-harness']) {
        const storeBase = sub ? join(cur, sub, 'node_modules', '.pnpm') : join(cur, 'node_modules', '.pnpm')
        try {
          const dirs = readdirSync(storeBase)
            .filter((d) => d.startsWith('undici@') && !d.includes('undici-types'))
          for (const dir of dirs) {
            candidates.push(join(storeBase, dir, 'node_modules', 'undici', 'package.json'))
          }
        } catch { /* 这一层没有，继续尝试 */ }
      }
      const parent = join(cur, '..')
      if (parent === cur) break
      cur = parent
    }
  } catch { /* 整体失败则跳过 */ }

  // 逐级加载并收集「可用」的实例（附版本号）
  const found = []
  for (const target of candidates) {
    try {
      const req = createRequire(target)
      const ud = req('undici')
      if (!ud || typeof ud.ProxyAgent !== 'function') continue
      let version = ''
      try { version = String(req('undici/package.json').version ?? '') } catch { /* 读不到就算了 */ }
      let major = null
      try {
        const m = Number(version.split('.')[0])
        if (Number.isFinite(m) && m > 0) major = m
      } catch { /* ignore */ }
      found.push({ ud, version, major })
    } catch (err) {
      // ignore
    }
  }
  if (found.length === 0) return null

  // 同大版本优先（dispatcher 协议兼容）；同大版本内取版本最高者。
  // 若已知 Node 内置 fetch 主版本，但未找到同主版本实例，决不可强行注入
  // 不兼容的主版本 ProxyAgent（会导致 onRequestStart 断言错误瘫痪所有请求）。
  const sameMajor = bundledMajor === null ? [] : found.filter((f) => f.major === bundledMajor)
  if (bundledMajor !== null && sameMajor.length === 0) {
    console.warn(`[dsh-provider-hub] 未找到与内置 fetch 兼容的 undici@${bundledMajor}.x（候选：${found.map(f => f.version).join(', ')}），跳过全局 dispatcher 注入以避免连接错误。`)
    return null
  }
  const pool = sameMajor.length > 0 ? sameMajor : found
  pool.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
  loadedUndiciVersion = pool[0].version
  return pool[0].ud
}

/** 当前实际加载的 undici 版本（诊断用；loadUndici 命中时记录）。 */
let loadedUndiciVersion = ''

// ── 域名规范化 / 命中判定 ──────────────────────────────────────────────────

/**
 * 规范化用户输入的域名：允许直接粘 URL（取 hostname）、去空白、转小写、
 * 去端口/路径/尾点、去重，并丢掉空项；保留 *. 前缀（matchHost 支持子域）。
 */
function normalizeHosts(input) {
  const out = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    let value = raw.trim().toLowerCase()
    if (value === '') continue
    if (value.includes('://')) {
      try { value = new URL(value).hostname } catch { /* 不是合法 URL，按字面处理 */ }
    }
    value = value.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
    if (value === '' || out.includes(value)) continue
    out.push(value)
  }
  return out
}

/** 从 fetch 入参提取 hostname（小写）；解析失败返回 null（不代理）。 */
function hostnameOf(input) {
  try {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input && typeof input === 'object' && 'url' in input
          ? String(input.url)
          : ''
    return new URL(raw).hostname.toLowerCase()
  } catch { return null }
}

/** 命中判定：精确 host 或 `*.domain` 模式（含子域）。 */
function matchHost(host, hosts) {
  if (hosts.has(host)) return true
  for (const pattern of hosts) {
    if (typeof pattern !== 'string') continue
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // '.example.com'
      if (host.endsWith(suffix)) return true
    }
  }
  return false
}

// ── 回环围栏（与 model-capabilities 同款）──────────────────────────────────

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function loopbackAllowed(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = String(req.headers.host ?? '').trim().toLowerCase()
  return host === 'localhost' || host.startsWith('localhost:')
    || host === '127.0.0.1' || host.startsWith('127.0.0.1:')
}

// ── HTTP 小工具 ─────────────────────────────────────────────────────────────

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

// ── 代理状态（模块级单例）──────────────────────────────────────────────────

/** 当前代理状态；globalThis.fetch 包装函数在每次调用时读它来决定是否走代理。 */
let proxyState = null

/** 由 apply() 写入的 settings 引用；包装层实时解析命中域名时需要它。 */
let settingsRef = null

/**
 * 从「当前」settings 实时解析选中厂商的 host（selected 模式匹配用）。
 *
 * 为什么不能只信 boot 快照：服务冷启动时本插件的 apply 可能在 llm-pi-ai
 * 插件注册 `llm-pi-ai` 命名空间之前执行（inject 的 'llm' 由内核 dsh-llm 提前
 * 提供），此时 settings.get('llm-pi-ai') 返回 undefined → boot 快照 hosts 为
 * 空 → 包装层永远直连 → bai 全部超时且 failures=0（没进 catch）。而 /state
 * 的 hosts 是实时算的所以显示正常、/set 时设置已就绪所以一切恢复——这就是
 * 每次冷启动后「又超时」、/set 往返后「又好了」的根因。这里每次请求实时
 * 解析，彻底消除 boot 时序依赖（开销：一次内存读 + 十余次 URL 解析，亚毫秒）。
 */
function currentHosts(state) {
  const hosts = new Set()
  const providers = Array.isArray(state.providers) ? state.providers : []
  try {
    const ns = settingsRef && typeof settingsRef.get === 'function'
      ? settingsRef.get('llm-pi-ai')
      : (typeof settingsRef?.describe === 'function' ? settingsRef.describe().find(d => d.ns === 'llm-pi-ai')?.value : undefined)
    const provs = ns && typeof ns === 'object' && ns.providers && typeof ns.providers === 'object' ? ns.providers : {}
    const byKey = new Map()
    for (const [key, p] of Object.entries(provs)) {
      if (!p || typeof p !== 'object') continue
      const baseURL = typeof p.baseURL === 'string' ? p.baseURL : ''
      let host = null
      try { host = new URL(baseURL).hostname } catch { /* 非完整 URL，无 host */ }
      byKey.set(key, host)
    }
    for (const key of providers) {
      const host = byKey.get(key)
      if (host) hosts.add(host)
    }
  } catch { /* fallthrough */ }
  if (Array.isArray(state.extraHosts)) {
    for (const host of normalizeHosts(state.extraHosts)) hosts.add(host)
  }
  return hosts
}

/**
 * 启动时的原始全局 dispatcher（Node 内建 undici Agent）。
 * all 模式会把 symbol 换成 ProxyAgent，解除时必须赋值回这个基线——
 * 该属性 configurable:false，delete 静默失败，写 undefined 会让 fetch 断言崩溃。
 */
let baselineDispatcher
let baselineCaptured = false

function captureBaseline() {
  if (baselineCaptured) return
  baselineCaptured = true
  baselineDispatcher = globalThis[DISPATCHER_SYMBOL]
}

/** 把全局 dispatcher 恢复成基线；基线缺失（symbol 尚未初始化）时用新 Agent 兜底。 */
function restoreGlobalDispatcher() {
  const g = globalThis
  if (baselineDispatcher !== undefined && baselineDispatcher !== null) {
    g[DISPATCHER_SYMBOL] = baselineDispatcher
    return
  }
  if (g[DISPATCHER_SYMBOL] === undefined || g[DISPATCHER_SYMBOL] === null) return
  const undici = loadUndici()
  if (undici && typeof undici.Agent === 'function') g[DISPATCHER_SYMBOL] = new undici.Agent()
}

// 包装前的原始 fetch（只包一次，之后 globalThis.fetch 恒为代理选择层）。
function installFetchHook() {
  const g = globalThis
  if (g[ORIGINAL_FETCH] && typeof g[ORIGINAL_FETCH] === 'function') return
  const original = globalThis.fetch.bind(globalThis)
  Object.defineProperty(globalThis, ORIGINAL_FETCH, { value: original, configurable: true })
  globalThis.fetch = function (input, init) {
    const state = proxyState
    if (state === null || !state.agent) return original(input, init)
    let viaProxy = state.mode === 'all'
    if (!viaProxy) {
      const host = hostnameOf(input)
      // selected 模式用「当前」settings 实时解析命中域名（见 currentHosts 注释：
      // boot 时序会导致快照为空，实时解析自愈，不再依赖快照）。
      viaProxy = host !== null && matchHost(host, currentHosts(state))
    }
    if (!viaProxy) return original(input, init)
    const next = init === undefined || init === null ? {} : { ...init }
    next.dispatcher = state.agent
    return original(input, next).catch((error) => {
      // 自愈：连续失败达到阈值时销毁旧连接池、重建 ProxyAgent。实测过
      // 启动时创建的 ProxyAgent 连接池可能被卡死（首笔请求失败后池子一直
      // 复用坏连接，后续请求全部挂起直到超时——用户「又超时」的现场），
      // 而 /set 重建的代理立即恢复。这里让包装层自动完成同样的换血。
      state.failures = (state.failures ?? 0) + 1
      if (state.failures >= HEAL_THRESHOLD) {
        state.failures = 0
        rotateAgent(state)
      }
      throw error
    })
  }
}

/** 连续失败多少次后自动重建代理连接池（自愈阈值）。 */
const HEAL_THRESHOLD = 3
/** 累计自动换血次数（诊断用）。 */
let rotations = 0

/**
 * 销毁旧 ProxyAgent 并新建一个（新连接池）。调用方须持有 proxyState 引用
 * （state.agent 会被原地替换）；url 由 applyProxy 写入 proxyState。
 *
 * 顺序刻意是「先建新的、成功后再关旧的」：反过来的话，一旦 loadUndici 拿不到
 * undici 就 return，而旧池已经被 close —— `state.agent` 指向一个已销毁的连接
 * 池，代理从此每笔请求都失败，且 isActive() 仍报 true（constructor.name 还是
 * ProxyAgent），界面上看是「已生效」。换血失败必须保留一个还能用的池。
 */
function rotateAgent(state) {
  const undici = loadUndici()
  if (!undici) {
    console.log('[dsh-network-proxy] agent rotation skipped: undici unavailable, keeping the current pool')
    return
  }
  let fresh
  try {
    fresh = new undici.ProxyAgent(state.url)
  } catch (error) {
    console.log(`[dsh-network-proxy] agent rotation failed, keeping the current pool: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const previous = state.agent
  state.agent = fresh
  rotations += 1
  console.log(`[dsh-network-proxy] proxy agent rotated #${rotations} (pool self-healed), url=${state.url}`)
  // 新池已就位，旧池此刻才可以安全关闭。
  try {
    if (previous && typeof previous.close === 'function') {
      Promise.resolve(previous.close()).catch(() => { /* 旧池关闭失败不影响换血 */ })
    }
  } catch { /* ignore */ }
}

// ── 插件入口 ────────────────────────────────────────────────────────────────

export function apply(ctx) {
  // 供包装层实时解析命中域名（currentHosts）使用的 settings 引用。
  settingsRef = ctx.settings
  // ---- settings 命名空间（settings.yaml 持久化 或 本地 JSON 兜底）----
  let scope
  try {
    if (typeof ctx.settings?.register === 'function') {
      scope = ctx.settings.register(NS, z.object({
        enabled: z.boolean().default(false),
        url: z.string().default(DEFAULT_PROXY),
        mode: z.union([z.const('all'), z.const('selected')]).default('all'),
        providers: z.array(z.string()).default([]),
        // selected 模式下额外走代理的域名（厂商目录里没有的服务，如
        // generativelanguage.googleapis.com；支持 *.example.com 通配）。
        extraHosts: z.array(z.string()).default([]),
      }))
    }
  } catch (error) {
    console.log(`[dsh-network-proxy] ctx.settings.register failed/skipped: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 若内核环境无 settings.register（如 DSH 0.1.7+），退化为本地 JSON 文件持久化
  if (!scope) {
    const configPath = join(dshHome(), 'network-proxy.json')
    let localData = {
      enabled: false,
      url: DEFAULT_PROXY,
      mode: 'all',
      providers: [],
      extraHosts: [],
    }
    const loadFromDisk = () => {
      try {
        if (existsSync(configPath)) {
          const raw = JSON.parse(readFileSync(configPath, 'utf8'))
          if (raw && typeof raw === 'object') {
            localData = {
              enabled: raw.enabled === true,
              url: (typeof raw.url === 'string' && raw.url.trim()) || DEFAULT_PROXY,
              mode: raw.mode === 'selected' ? 'selected' : 'all',
              providers: Array.isArray(raw.providers) ? raw.providers.filter((p) => typeof p === 'string') : [],
              extraHosts: Array.isArray(raw.extraHosts) ? normalizeHosts(raw.extraHosts) : [],
            }
          }
        }
      } catch (err) {
        console.log(`[dsh-network-proxy] load local config error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    loadFromDisk()

    scope = {
      get: () => ({ ...localData }),
      update: async (patch) => {
        if (patch && typeof patch === 'object') {
          localData = {
            ...localData,
            ...patch,
          }
          try {
            writeFileSync(configPath, JSON.stringify(localData, null, 2), 'utf8')
          } catch (err) {
            console.log(`[dsh-network-proxy] save local config error: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      },
    }
  }

  const readConfig = () => {
    if (scope !== undefined) {
      try {
        const v = scope.get()
        return {
          // 缺字段视为关闭：v.enabled !== false 会把「命名空间存在但没写 enabled」
          // 当成开启，重启后凭空启用代理。
          enabled: v.enabled === true,
          url: (v.url && v.url.trim()) || DEFAULT_PROXY,
          mode: v.mode === 'selected' ? 'selected' : 'all',
          providers: Array.isArray(v.providers) ? v.providers.filter((p) => typeof p === 'string') : [],
          extraHosts: Array.isArray(v.extraHosts) ? normalizeHosts(v.extraHosts) : [],
        }
      } catch { /* fallthrough */ }
    }
    return { enabled: false, url: DEFAULT_PROXY, mode: 'all', providers: [], extraHosts: [] }
  }

  // ---- 读 llm-pi-ai 的厂商配置，导出 route key -> baseURL host ----
  const readProviders = () => {
    const out = []
    try {
      const ns = typeof ctx.settings?.get === 'function'
        ? ctx.settings.get('llm-pi-ai')
        : (typeof ctx.settings?.describe === 'function' ? ctx.settings.describe().find(d => d.ns === 'llm-pi-ai')?.value : undefined)
      const providers = ns && typeof ns === 'object' && ns.providers && typeof ns.providers === 'object'
        ? ns.providers
        : {}
      for (const [key, p] of Object.entries(providers)) {
        if (!p || typeof p !== 'object') continue
        const record = p
        const baseURL = typeof record.baseURL === 'string' ? record.baseURL : ''
        let host = null
        try { host = new URL(baseURL).hostname } catch { /* 非完整 URL，无 host */ }
        out.push({
          key,
          name: (typeof record.displayName === 'string' && record.displayName.trim()) || key,
          baseURL,
          host,
          api: typeof record.api === 'string' ? record.api : '',
        })
      }
    } catch (error) {
      console.log(`[dsh-network-proxy] readProviders failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return out
  }

  /** 选中的厂商 route key（+ 手填域名）-> 去重后的 hostname 集合。 */
  const selectedHosts = (cfg) => {
    const hosts = new Set()
    if (Array.isArray(cfg.providers)) {
      const byKey = new Map(readProviders().map((p) => [p.key, p]))
      for (const key of cfg.providers) {
        const p = byKey.get(key)
        if (p && p.host) hosts.add(p.host)
      }
    }
    if (Array.isArray(cfg.extraHosts)) {
      for (const host of normalizeHosts(cfg.extraHosts)) hosts.add(host)
    }
    return hosts
  }

  /**
   * 已勾选但当前厂商目录里不存在的 key（供应商被删/改名后留下的死选项）。
   * 这些 key 解析不出 host，静默不代理，界面需要提示用户清理。
   */
  const staleProviders = (cfg) => {
    if (!Array.isArray(cfg.providers)) return []
    const known = new Set(readProviders().map((p) => p.key))
    return cfg.providers.filter((key) => !known.has(key))
  }

  // ---- 状态：当前代理是否已生效 ----
  const isActive = () => {
    try {
      return proxyState !== null && !!(proxyState.agent && proxyState.agent.constructor
        && proxyState.agent.constructor.name === 'ProxyAgent')
    } catch { return false }
  }

  // ---- 应用代理 / 解除代理 ----
  function applyProxy(cfg) {
    const undici = loadUndici()
    if (!undici) return { ok: false, message: '无法加载 undici' }
    let agent
    try {
      agent = new undici.ProxyAgent(cfg.url)
    } catch (error) {
      return { ok: false, message: `代理地址无法建立连接池：${error instanceof Error ? error.message : String(error)}` }
    }
    proxyState = {
      agent,
      mode: cfg.mode,
      hosts: selectedHosts(cfg),
      providers: cfg.providers,
      extraHosts: cfg.extraHosts,
      url: cfg.url,
      failures: 0,
    }
    captureBaseline()
    if (cfg.mode === 'all') {
      globalThis[DISPATCHER_SYMBOL] = agent
    } else {
      // selected 模式必须让未命中的请求走直连：全局 dispatcher 恢复成基线
      // （delete 对 configurable:false 的内建属性无效，之前会把上一次的
      //  ProxyAgent 永久留在全局，导致关代理/切窄范围后全站仍走代理）。
      restoreGlobalDispatcher()
    }
    return { ok: true }
  }

  function clearProxy() {
    captureBaseline()
    restoreGlobalDispatcher()
    proxyState = null
  }

  // 安装 fetch 代理层（幂等），此后每次请求按 state 决定注入 dispatcher。
  installFetchHook()

  // 启动时按已存配置应用（若启用）。
  try {
    const cfg = readConfig()
    if (cfg.enabled) {
      const r = applyProxy(cfg)
      console.log(`[dsh-network-proxy] boot: proxy ${r.ok ? 'enabled' : 'FAILED'} url=${cfg.url} mode=${cfg.mode} hosts=${[...selectedHosts(cfg)].join(',')}`)
    } else {
      console.log('[dsh-network-proxy] boot: proxy disabled')
    }
  } catch (err) {
    console.log(`[dsh-network-proxy] boot apply failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ---- HTTP API（回环放行，免鉴权；长于 /api 前缀，最长前缀匹配优先）----
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => { void route(req, res) },
  }), 'dsh-network-proxy: http routes')

  async function route(req, res) {
    try {
      if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback only' }); return }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rest = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      const method = String(req.method ?? 'GET').toUpperCase()

      if (rest === '/state' && method === 'GET') {
        const cfg = readConfig()
        json(res, 200, {
          ok: true,
          ...cfg,
          hosts: [...selectedHosts(cfg)],
          stale: staleProviders(cfg),
          active: isActive(),
          // 运行时诊断：fetch 是否被本插件包装、全局 dispatcher 类型、实际加载的 undici 版本
          diag: {
            fetchWrapped: typeof globalThis[ORIGINAL_FETCH] === 'function',
            dispatcherType: globalThis[DISPATCHER_SYMBOL]?.constructor?.name ?? 'undefined',
            undiciVersion: loadedUndiciVersion || 'unknown',
            nodeUndici: process.versions?.undici ?? 'unknown',
            failures: proxyState?.failures ?? null,
            rotations,
          },
        })
        return
      }

      if (rest === '/providers' && method === 'GET') {
        json(res, 200, { ok: true, providers: readProviders() })
        return
      }

      /**
       * 经代理探活一个目标（与 LLM 请求同款：undici ProxyAgent 注入 fetch）。
       * 返回 { reachable, status, elapsedMs, message }。
       */
      async function probeViaProxy(url, agent) {
        const started = Date.now()
        const controller = new AbortController()
        const timer = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
        try {
          const original = globalThis[ORIGINAL_FETCH] ?? globalThis.fetch
          const response = await original(url, {
            method: 'GET',
            dispatcher: agent,
            signal: controller.signal,
            cache: 'no-store',
          })
          return { reachable: true, status: response.status, elapsedMs: Date.now() - started }
        } catch (error) {
          const cause = error?.cause?.message ? `（${String(error.cause.message)}）` : ''
          return {
            reachable: false,
            elapsedMs: Date.now() - started,
            message: `${error instanceof Error ? error.message : String(error)}${cause}`,
          }
        } finally {
          clearTimeout(timer)
        }
      }

      // 连通性自检：真正经代理发请求。isActive() 只说明 ProxyAgent 已挂载，
      // 代理进程没开时它仍是 true——这个接口给出真实结果：探活 gstatic（通用）
      // + 当前命中的厂商域名（如 api.b.ai），一次返回全部结果。
      if (rest === '/test' && method === 'GET') {
        try {
          const cfg = readConfig()
          const undici = loadUndici()
          if (!undici) {
            json(res, 200, { ok: false, message: '无法加载 undici' })
            return
          }
          let agent
          try {
            agent = new undici.ProxyAgent(cfg.url)
          } catch (error) {
            json(res, 200, { ok: false, message: `代理地址无效：${error instanceof Error ? error.message : String(error)}` })
            return
          }
          try {
            // gstatic 结果保留在主字段（客户端兼容），厂商域名放 targets
            const first = await probeViaProxy(PROBE_URL, agent)
            const hosts = [...selectedHosts(cfg)].slice(0, 3)
            const targets = []
            for (const host of hosts) {
              targets.push({
                host,
                url: `https://${host}/`,
                ...(await probeViaProxy(`https://${host}/`, agent)),
              })
            }
            json(res, 200, {
              ok: true,
              reachable: first.reachable,
              status: first.status,
              elapsedMs: first.elapsedMs,
              target: PROBE_URL,
              url: cfg.url,
              message: first.message,
              targets,
            })
          } finally {
            try { await agent.close() } catch { /* ignore */ }
          }
        } catch (error) {
          json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      /**
       * 运行时实测：对任意 URL 走「当前生效的请求路径」发请求，验证包装/分流
       * 是否真的在工作。
       *   GET /api/dsh-proxy/probe?url=https://api.b.ai/v1/models&mode=live
       *     mode=live   → globalThis.fetch 原样调用（走包装 + 全局 dispatcher）
       *     mode=direct → 强制直连（显式用基线 dispatcher，绕过代理）
       */
      if (rest === '/probe' && method === 'GET') {
        const target = String(url.searchParams.get('url') ?? '').trim()
        if (!/^https?:\/\//.test(target)) {
          json(res, 200, { ok: false, message: 'url 需为 http(s):// 开头' })
          return
        }
        const mode = url.searchParams.get('mode') === 'direct' ? 'direct' : 'live'
        const started = Date.now()
        const controller = new AbortController()
        const timer = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
        try {
          let response
          if (mode === 'direct') {
            // 强制直连：显式用基线 dispatcher（直连通道），绕过全局代理
            const undici = loadUndici()
            const baseline = baselineDispatcher ?? (undici ? new undici.Agent() : undefined)
            response = await (globalThis[ORIGINAL_FETCH] ?? globalThis.fetch)(target, {
              method: 'GET',
              ...(baseline !== undefined ? { dispatcher: baseline } : {}),
              signal: controller.signal,
              cache: 'no-store',
            })
          } else {
            // live：与 LLM 请求完全相同的路径（包装后的全局 fetch）
            response = await globalThis.fetch(target, { signal: controller.signal, cache: 'no-store' })
          }
          json(res, 200, {
            ok: true,
            mode,
            reachable: true,
            status: response.status,
            elapsedMs: Date.now() - started,
            target,
          })
        } catch (error) {
          const cause = error?.cause?.message ? `（${String(error.cause.message)}）` : ''
          json(res, 200, {
            ok: true,
            mode,
            reachable: false,
            elapsedMs: Date.now() - started,
            target,
            message: `${error instanceof Error ? error.message : String(error)}${cause}`,
          })
        } finally {
          clearTimeout(timer)
        }
        return
      }

      if (rest === '/member' && method === 'POST') {
        // 名单增删走 host 侧的读-改-写，不让客户端先 GET 再 POST 整份名单：
        // 两个供应商卡片同时切换时，后一次会拿自己那份过期快照整份覆盖，
        // 前一次的改动凭空消失。
        const body = await readBody(req)
        const key = body && typeof body.key === 'string' ? body.key.trim() : ''
        const on = body?.on === true
        if (key === '') {
          json(res, 200, { ok: false, message: '缺少 key' })
          return
        }
        const current = readConfig()
        const list = Array.isArray(current.providers) ? current.providers : []
        let providers
        let mode
        if (on) {
          if (!list.includes(key)) list.push(key)
          // 勾选某家 = 显式名单语义：全局 all 下再单点勾选没有意义。
          mode = 'selected'
          providers = list
        } else if (current.mode === 'all') {
          // all 模式关掉某家 = 迁移成「全集减自己」。
          const all = readProviders().map((p) => p.key)
          providers = all.filter((k) => k !== key)
          mode = 'selected'
        } else {
          providers = list.filter((k) => k !== key)
          mode = 'selected'
        }
        const next = {
          enabled: current.enabled,
          url: current.url,
          mode,
          providers,
          extraHosts: current.extraHosts,
        }
        if (current.enabled) {
          const r = applyProxy(next)
          if (!r.ok) {
            json(res, 200, { ok: false, message: r.message })
            return
          }
        } else {
          // 未启用时代理层是空的，只落配置即可。
          proxyState = null
        }
        try { await scope.update(next) } catch (err) {
          console.log(`[dsh-network-proxy] persist failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        json(res, 200, { ok: true, ...next, hosts: [...selectedHosts(next)], stale: staleProviders(next), active: isActive() })
        return
      }

      if (rest === '/set' && method === 'POST') {
        const body = await readBody(req)
        if (!body || typeof body !== 'object') {
          json(res, 200, { ok: false, message: '参数错误' })
          return
        }
        const current = readConfig()
        const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled
        const url = typeof body.url === 'string' ? body.url.trim() : current.url
        const mode = body.mode === 'selected' ? 'selected' : body.mode === 'all' ? 'all' : current.mode
        const providers = Array.isArray(body.providers)
          ? body.providers.filter((p) => typeof p === 'string')
          : current.providers
        const extraHosts = Array.isArray(body.extraHosts)
          ? normalizeHosts(body.extraHosts)
          : current.extraHosts
        if (enabled && !/^https?:\/\/.+/.test(url)) {
          json(res, 200, { ok: false, message: '代理地址需为 http:// 或 https:// 开头' })
          return
        }
        const next = { enabled, url, mode, providers, extraHosts }
        if (enabled) {
          const r = applyProxy(next)
          if (!r.ok) {
            json(res, 200, { ok: false, message: r.message })
            return
          }
          console.log(`[dsh-network-proxy] proxy ENABLED url=${url} mode=${mode} providers=[${providers.join(',')}] hosts=[${[...selectedHosts(next)].join(',')}]`)
        } else {
          clearProxy()
          console.log('[dsh-network-proxy] proxy DISABLED')
        }
        if (scope !== undefined) {
          try { await scope.update(next) } catch (err) {
            console.log(`[dsh-network-proxy] persist failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        json(res, 200, {
          ok: true,
          ...next,
          hosts: [...selectedHosts(next)],
          stale: staleProviders(next),
          active: isActive(),
        })
        return
      }

      json(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      ctx.logger.error('[dsh-network-proxy] route error: %s', error instanceof Error ? error.message : String(error))
      if (!res.headersSent) json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
