// dsh-model-capabilities — host 半身
//
// 目标：不改内核源码，为「模型目录」里的每个模型提供四类能力开关：
//   1. 识图（vision）   → 直接改写 llm-pi-ai 的 providers.<route>.models[].input
//   2. 推理强度（reasoning）→ 直接改写 providers.<route>.models[].reasoningEfforts
//   3. 生图（image）    → 本插件自有标记 + generate_image 工具
//   4. 视频（video）    → 本插件自有标记 + generate_video 工具
//
// 为什么 3/4 是「自有标记」：内核 pi-ai 的 Model.input 只有 text | image
// 两种模态（packages/llm/llm-pi-ai/src/catalog.ts 的 MODALITY_GATE），写入
// video 会被 schema 拒绝并让整个 llm-pi-ai 命名空间的路由失效。所以生图/
// 视频记录在本插件自己的 settings 命名空间里，由本插件的工具消费。
//
// 关键约束（内核契约，勿违反）：
//   * settings 的 path op 只能走 plain object，models 是数组 →
//     只能整体 set providers.<route>.models，不能寻址 models.0.input。
//   * 下一层必须从 descriptor.user（原始用户层）构建，不能用 resolved value：
//     resolved 里带着 schema 物化出来的 input: []、modelOverrides: {} 等，
//     写回去会改变语义。
//   * llm-pi-ai 命名空间由 llm-pi-ai 插件注册（不可重复注册），但非拥有者
//     允许写入；其 validate=assertServiceable 会校验整个 section。
//
// HTTP API（仅回环放行，与 opendesign / file-explorer 同款围栏）：
//   GET  /api/model-capabilities/snapshot
//   POST /api/model-capabilities/vision     { provider, model, state }
//   POST /api/model-capabilities/reasoning  { provider, model, state, levels }
//   POST /api/model-capabilities/flag       { provider, model, kind, enabled }
//   POST /api/model-capabilities/active     { kind, key }
//   POST /api/model-capabilities/settings   { videoPath, proxyUrl }
import z from '../vendor/schemastery/index.mjs'
import { defineTool } from '../vendor/dsh-tools/schema.ts'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return join(homedir(), '.dsh')
}

export const name = 'dsh-model-capabilities'

export const inject = ['llm', 'settings', 'webServer', 'tools']

/** 本插件自有设置命名空间。 */
const NS = 'model-capabilities'
/** 被改写的目标命名空间（llm-pi-ai 拥有，允许外部写入）。 */
const PI_NS = 'llm-pi-ai'
/** HTTP 路由前缀。 */
const ROUTE_PREFIX = '/api/model-capabilities'
/** pi-ai 支持的全部推理档位，按升级顺序（catalog.ts THINKING_LEVELS）。 */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** 可勾选的档位（off 由插件自动补齐，不作为独立选项）。 */
const SELECTABLE_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** 请求体上限。 */
const MAX_BODY_BYTES = 1024 * 1024

// ── 回环围栏 ────────────────────────────────────────────────────────────────

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
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

// ── 通用小工具 ──────────────────────────────────────────────────────────────

/** "provider/model" → { provider, model }；非法返回 null。 */
function splitKey(key) {
  if (typeof key !== 'string') return null
  const idx = key.indexOf('/')
  if (idx <= 0 || idx === key.length - 1) return null
  return { provider: key.slice(0, idx), model: key.slice(idx + 1) }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 深路径读取（只走 plain object）。 */
function getPath(root, path) {
  let node = root
  for (const key of path) {
    if (!isPlainObject(node)) return undefined
    node = node[key]
  }
  return node
}

export function apply(ctx) {
  // ── 1. 自有设置命名空间（生图 / 视频标记与当前活跃模型） ──────────────
  //
  // flags 用 "provider/model" 作为 dict 键；schemastery 的 dict 键是自由
  // 字符串，斜杠安全。
  const Config = z.object({
    flags: z.dict(z.object({
      image: z.boolean().default(false),
      video: z.boolean().default(false),
      // 语音输出标记：与 image/video 同族，供客户端模型编辑器的第三开关写入。
      // 此前 UI 把它写进工作区 model-router.json，工具侧读不到，等于空开关。
      speech: z.boolean().default(false),
      // 模型总开关（截图式行内 toggle）：缺省 true，老数据无该键视为启用。
      enabled: z.boolean().default(true),
    })).default({}),
    imageActive: z.string().default(''),
    videoActive: z.string().default(''),
    // 生图/视频接口路径（相对 provider baseURL）。不同网关差异很大，做成可配。
    imagePath: z.string().default('images/generations'),
    videoPath: z.string().default('videos/generations'),
    // 出网代理（可选）。留空=直连；填 http://127.0.0.1:10808 走本地代理。
    proxyUrl: z.string().default(''),
  })

  let scope
  try {
    if (typeof ctx.settings?.register === 'function') {
      scope = ctx.settings.register(NS, Config)
    }
  } catch (error) {
    ctx.logger?.warn?.('[model-capabilities] settings namespace register error: %s', String(error?.message ?? error))
  }

  // 若内核环境无 settings.register（如 DSH 0.1.7+），退化为本地 JSON 文件持久化
  if (!scope) {
    const configPath = join(dshHome(), 'model-capabilities.json')
    let localData = {
      flags: {},
      imageActive: '',
      videoActive: '',
      imagePath: 'images/generations',
      videoPath: 'videos/generations',
      proxyUrl: '',
    }
    const loadFromDisk = () => {
      try {
        if (existsSync(configPath)) {
          const raw = JSON.parse(readFileSync(configPath, 'utf8'))
          if (raw && typeof raw === 'object') {
            localData = {
              flags: raw.flags && typeof raw.flags === 'object' ? raw.flags : {},
              imageActive: typeof raw.imageActive === 'string' ? raw.imageActive : '',
              videoActive: typeof raw.videoActive === 'string' ? raw.videoActive : '',
              imagePath: typeof raw.imagePath === 'string' ? raw.imagePath : 'images/generations',
              videoPath: typeof raw.videoPath === 'string' ? raw.videoPath : 'videos/generations',
              proxyUrl: typeof raw.proxyUrl === 'string' ? raw.proxyUrl : '',
            }
          }
        }
      } catch (err) {
        ctx.logger?.warn?.('[model-capabilities] load local config error: %s', String(err?.message ?? err))
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
            ctx.logger?.warn?.('[model-capabilities] save local config error: %s', String(err?.message ?? err))
          }
        }
      },
    }
  }

  /** 本插件配置的当前值（命名空间注册失败时给出安全默认）。 */
  function ownConfig() {
    if (scope !== undefined) {
      try {
        const value = scope.get()
        if (isPlainObject(value)) return value
      } catch { /* fallthrough */ }
    }
    return { flags: {}, imageActive: '', videoActive: '', imagePath: 'images/generations', videoPath: 'videos/generations', proxyUrl: '' }
  }

  // ── 2. llm-pi-ai section 读写 ────────────────────────────────────────────

  /** llm-pi-ai 的完整描述符（含原始 user 层与 revision）。 */
  function piDescriptor() {
    const all = ctx.settings.describe()
    return all.find(entry => entry.ns === PI_NS)
  }

  /** 某路由在「用户层」的 profile（未经 schema 物化）。 */
  function piUserProfile(descriptor, route) {
    return getPath(descriptor?.user, ['providers', route])
  }

  /** 某路由生效后的 profile（含 base 与 schema 默认）。 */
  function piResolvedProfile(route) {
    const resolved = typeof ctx.settings?.get === 'function'
      ? ctx.settings.get(PI_NS)
      : ctx.settings?.describe?.()?.find(entry => entry.ns === PI_NS)?.value
    return getPath(resolved, ['providers', route])
  }

  /**
   * 构建某路由下一版 models 数组：
   *  - 用户层已有 models → 深拷贝后原地改；
   *  - 用户层没有 models → 从 ctx.llm.listModels(route) 物化成 [{ id }]，
   *    其余字段仍由内置 catalog 兜底（catalog.ts 的 `...base` 展开）。
   * 返回 { models, error }，error 非空表示不可安全改写。
   */
  async function nextModels(descriptor, route, modelId) {
    const userProfile = piUserProfile(descriptor, route)
    const existing = userProfile?.models
    if (Array.isArray(existing)) {
      const models = JSON.parse(JSON.stringify(existing))
      const index = models.findIndex(entry => isPlainObject(entry) && entry.id === modelId)
      if (index < 0) {
        return { error: `模型目录里没有 "${modelId}"：请先在「模型」设置页把它添加到该供应商的模型目录。` }
      }
      return { models, index }
    }
    // modelOverrides 与 models 列表互斥（catalog.ts:814），不能自动物化。
    const resolvedProfile = piResolvedProfile(route)
    const overrides = resolvedProfile?.modelOverrides
    if (isPlainObject(overrides) && Object.keys(overrides).length > 0) {
      return { error: `供应商 "${route}" 使用了 modelOverrides，与 models 列表互斥；请改用 modelOverrides 或先移除它。` }
    }
    let listed = []
    try {
      listed = await ctx.llm.listModels(route)
    } catch (error) {
      return { error: `无法枚举供应商 "${route}" 的模型（${String(error?.message ?? error)}）：请先在「模型」设置页手动添加模型目录。` }
    }
    if (listed.length === 0) {
      return { error: `供应商 "${route}" 没有可枚举的模型：请先在「模型」设置页手动添加模型目录。` }
    }
    const models = listed.map(model => ({ id: model.id }))
    const index = models.findIndex(entry => entry.id === modelId)
    if (index < 0) {
      return { error: `供应商 "${route}" 不提供模型 "${modelId}"。` }
    }
    return { models, index }
  }

  /**
   * 整体写回某路由的 models 数组（数组无法按元素寻址，只能整体 set）。
   * 冲突（revision 过期）时重读一次并由调用方重试。
   */
  async function writeModels(route, models, revision) {
    await ctx.settings.mutate(PI_NS, [
      { op: 'set', path: ['providers', route, 'models'], value: models },
    ], revision)
  }

  /** 该路由是否由 pi-ai 适配器管理（只有它的 profile 才有 models/input/reasoningEfforts）。 */
  function isPiRoute(route) {
    return ctx.llm.listConfigurableProviders().some(entry => entry.provider === route && entry.settingsNs === PI_NS)
  }

  /**
   * 对某模型执行一次字段改写（带一次冲突重试）。
   *
   * `mutateEntry` 可以「拒绝」：返回非空字符串表示这次改写不合法（例如推理
   * 档位一个都没勾）。拒绝时**必须整轮不写盘**——否则用户点了个被拒的操作，
   * 却白白消耗一次 settings revision，并且在「自动物化」路径下把 [{id}] 列表
   * 落盘，副作用远超预期。
   * @param route - 路由 key。
   * @param modelId - 模型 id。
   * @param mutateEntry - 就地改写模型条目；返回非空字符串表示拒绝。
   */
  async function editModel(route, modelId, mutateEntry) {
    if (!isPiRoute(route)) {
      return {
        ok: false,
        error: `供应商 "${route}" 不由 pi-ai 适配器（${PI_NS}）管理，识图与推理档位需在它自己的编辑器里改；本插件只为它提供生图 / 视频开关。`,
      }
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = piDescriptor()
      if (descriptor === undefined) {
        return { ok: false, error: `设置命名空间 "${PI_NS}" 未注册：该供应商不由 pi-ai 适配器管理。` }
      }
      const built = await nextModels(descriptor, route, modelId)
      if (built.error !== undefined) return { ok: false, error: built.error }
      const entry = built.models[built.index]
      const refusal = mutateEntry(entry)
      if (typeof refusal === 'string' && refusal.length > 0) {
        return { ok: false, error: refusal }
      }
      try {
        await writeModels(route, built.models, descriptor.revision)
        return { ok: true }
      } catch (error) {
        const code = error?.code
        if (code === 'SETTINGS_CONFLICT' && attempt === 0) continue
        return { ok: false, error: String(error?.message ?? error) }
      }
    }
    return { ok: false, error: '设置写入反复冲突，请重试。' }
  }

  // ── 3. 三类状态的读写语义 ───────────────────────────────────────────────

  /**
   * 识图状态。
   *   'on'      → input: ['text','image']
   *   'off'     → input: ['text']（明确只收文本）
   *   'inherit' → 删除 input，回到内置 catalog / 路由 defaultInput
   * 注意 pi-ai 把 input: [] 视作「未表态」（catalog.ts declaredInput），
   * 所以「关」必须写 ['text'] 而不是 []。
   */
  function visionStateOf(entry) {
    const input = entry?.input
    if (!Array.isArray(input) || input.length === 0) return 'inherit'
    return input.includes('image') ? 'on' : 'off'
  }

  function applyVision(entry, state) {
    if (state === 'inherit') { delete entry.input; return }
    entry.input = state === 'on' ? ['text', 'image'] : ['text']
  }

  /**
   * 推理状态。
   *   'levels'  → reasoningEfforts: { off: null, <level>: '<level>', ... }
   *   'off'     → reasoningEfforts: false（非推理模型）
   *   'inherit' → 删除字段，继承内置 catalog 的能力
   * pi-ai 规则：off 之外的档位必须带线路值；至少要有一个 off 以外的档位；
   * 空 dict / null 会被拒绝（catalog.ts:684-705）。
   */
  function reasoningStateOf(entry) {
    const efforts = entry?.reasoningEfforts
    if (efforts === false) return { state: 'off', levels: [] }
    if (!isPlainObject(efforts)) return { state: 'inherit', levels: [] }
    const levels = SELECTABLE_LEVELS.filter(level => efforts[level] !== undefined && efforts[level] !== null)
    return { state: 'levels', levels }
  }

  function applyReasoning(entry, state, levels, offWire) {
    if (state === 'inherit') { delete entry.reasoningEfforts; return undefined }
    if (state === 'off') { entry.reasoningEfforts = false; return undefined }
    const picked = SELECTABLE_LEVELS.filter(level => levels.includes(level))
    if (picked.length === 0) {
      return '请至少勾选一个推理档位；若该模型不支持推理，请选「关闭推理」。'
    }
    // OpenAI 系网关的关闭语义是线值 `none`（off: 'none' 即发 reasoning_effort='none'），
    // 而不是省略参数（off: null）。自动检测到合法值表含 none 时透传 offWire。
    const efforts = { off: offWire === 'none' ? 'none' : null }
    for (const level of picked) efforts[level] = level
    entry.reasoningEfforts = efforts
    return undefined
  }

  /** 某条目 off 的线值（'none' = OpenAI 系关闭语义，null/其他 = 省略参数）。 */
  function offWireOf(entry) {
    const efforts = entry?.reasoningEfforts
    if (!isPlainObject(efforts)) return null
    return efforts.off === 'none' ? 'none' : null
  }

  // ── 4. 快照 ─────────────────────────────────────────────────────────────

  /** 某路由的有效模型能力（来自适配器的解析结果，只读展示用）。 */
  async function effectiveInfo(route, modelId) {
    try {
      const info = await ctx.llm.resolveModelInfo(route, modelId)
      return {
        name: info.name,
        inputModalities: Array.isArray(info.inputModalities) ? [...info.inputModalities] : [],
        reasoningEfforts: info.reasoning?.efforts?.map(effort => effort.id) ?? [],
      }
    } catch {
      return undefined
    }
  }

  async function snapshot() {
    const own = ownConfig()
    const descriptor = piDescriptor()
    const registered = new Set(ctx.llm.listProviders().map(entry => entry.id))
    const directory = ctx.llm.listConfigurableProviders()
    const providers = []
    for (const entry of directory) {
      const route = entry.provider
      const active = registered.has(route)
      const userProfile = piUserProfile(descriptor, route)
      const userModels = Array.isArray(userProfile?.models) ? userProfile.models : undefined
      // 目录来源：用户层 models 优先；否则问适配器（未注册路由问不到）。
      let ids = []
      if (userModels !== undefined) {
        ids = userModels.filter(isPlainObject).map(model => model.id).filter(id => typeof id === 'string')
      } else if (active) {
        try {
          ids = (await ctx.llm.listModels(route)).map(model => model.id)
        } catch { ids = [] }
      }
      const models = []
      for (const id of ids) {
        const stored = userModels?.find(model => isPlainObject(model) && model.id === id)
        const reasoning = reasoningStateOf(stored)
        const effective = active ? await effectiveInfo(route, id) : undefined
        const key = `${route}/${id}`
        const flag = own.flags?.[key]
        models.push({
          id,
          name: stored?.name ?? effective?.name ?? id,
          vision: visionStateOf(stored),
          reasoning: reasoning.state,
          reasoningLevels: reasoning.levels,
          reasoningOffWire: offWireOf(stored),
          effectiveVision: effective?.inputModalities.includes('image') ?? null,
          effectiveReasoning: effective?.reasoningEfforts ?? null,
          image: flag?.image === true,
          video: flag?.video === true,
          speech: flag?.speech === true,
          enabled: flag?.enabled !== false,
        })
      }
      providers.push({
        provider: route,
        displayName: entry.displayName,
        settingsNs: entry.settingsNs,
        declared: entry.declared === true,
        active,
        editable: entry.settingsNs === PI_NS,
        modelsOverridden: userModels !== undefined,
        models,
      })
    }
    // 目录之外的活跃路由兜底：适配器已注册 route、但目录里没有它的声明
    // （目录更新未生效 / 由其他适配器家族管理）时，卡片仍会渲染「模型能力」
    // 区域，却永远匹配不到清单条目 →「该供应商未出现在能力清单中」。
    // 这里把它们也枚举进快照，让卡片至少能显示模型与生图/视频标记；
    // editable 恒为 false，识图/推理档位仅 pi-ai 目录行可改（UI 已有说明）。
    const seen = new Set(providers.map(provider => provider.provider))
    for (const info of ctx.llm.listProviders()) {
      if (seen.has(info.id)) continue
      const route = info.id
      const userProfile = piUserProfile(descriptor, route)
      const userModels = Array.isArray(userProfile?.models) ? userProfile.models : undefined
      let ids = []
      if (userModels !== undefined) {
        ids = userModels.filter(isPlainObject).map(model => model.id).filter(id => typeof id === 'string')
      } else {
        try {
          ids = (await ctx.llm.listModels(route)).map(model => model.id)
        } catch { ids = [] }
      }
      const models = []
      for (const id of ids) {
        const stored = userModels?.find(model => isPlainObject(model) && model.id === id)
        const reasoning = reasoningStateOf(stored)
        const key = `${route}/${id}`
        const flag = own.flags?.[key]
        models.push({
          id,
          name: stored?.name ?? id,
          vision: visionStateOf(stored),
          reasoning: reasoning.state,
          reasoningLevels: reasoning.levels,
          reasoningOffWire: offWireOf(stored),
          effectiveVision: null,
          effectiveReasoning: null,
          image: flag?.image === true,
          video: flag?.video === true,
          speech: flag?.speech === true,
          enabled: flag?.enabled !== false,
        })
      }
      providers.push({
        provider: route,
        displayName: info.name,
        settingsNs: '',
        declared: false,
        active: true,
        editable: false,
        modelsOverridden: userModels !== undefined,
        models,
      })
    }
    return {
      ok: true,
      writable: ctx.settings.writable === true,
      levels: SELECTABLE_LEVELS,
      imageActive: own.imageActive ?? '',
      videoActive: own.videoActive ?? '',
      imagePath: own.imagePath ?? 'images/generations',
      videoPath: own.videoPath ?? 'videos/generations',
      proxyUrl: own.proxyUrl ?? '',
      providers,
    }
  }

  // ── 5. 自有标记写入 ─────────────────────────────────────────────────────

  async function setFlag(key, kind, enabled) {
    if (scope === undefined) return { ok: false, error: `设置命名空间 "${NS}" 不可用。` }
    const current = ownConfig()
    const flags = JSON.parse(JSON.stringify(current.flags ?? {}))
    const existing = flags[key] ?? { image: false, video: false, speech: false, enabled: true }
    flags[key] = {
      image: existing.image === true,
      video: existing.video === true,
      speech: existing.speech === true,
      enabled: existing.enabled !== false,
    }
    flags[key][kind] = enabled === true
    const patch = { flags }
    // 取消勾选时同步清掉「当前模型」，避免工具指向一个已关能力的模型。
    if (enabled !== true) {
      if (kind === 'image' && current.imageActive === key) patch.imageActive = ''
      if (kind === 'video' && current.videoActive === key) patch.videoActive = ''
      // 总开关关闭时同样清掉指向，避免生图/视频工具选中已停用模型。
      if (kind === 'enabled') {
        if (current.imageActive === key) patch.imageActive = ''
        if (current.videoActive === key) patch.videoActive = ''
      }
    }
    await scope.update(patch)
    return { ok: true }
  }

  async function setActive(kind, key) {
    if (scope === undefined) return { ok: false, error: `设置命名空间 "${NS}" 不可用。` }
    if (key !== '') {
      const own = ownConfig()
      if (own.flags?.[key]?.[kind] !== true) {
        return { ok: false, error: `模型 "${key}" 尚未开启${kind === 'image' ? '生图' : '视频'}能力。` }
      }
    }
    await scope.update(kind === 'image' ? { imageActive: key } : { videoActive: key })
    return { ok: true }
  }

  // ── 6. 生图 / 视频调用 ──────────────────────────────────────────────────

  /** 从 pi-ai 解析出的 profile 拿 baseURL 与凭据引用。 */
  function endpointOf(route) {
    const profile = piResolvedProfile(route)
    if (!isPlainObject(profile) || typeof profile.baseURL !== 'string' || profile.baseURL.length === 0) {
      return { error: `供应商 "${route}" 未配置 baseURL。` }
    }
    return { baseURL: profile.baseURL.replace(/[\\/]+$/, ''), apiKeyEnv: profile.apiKeyEnv }
  }

  async function apiKeyOf(apiKeyEnv) {
    if (typeof apiKeyEnv !== 'string' || apiKeyEnv.length === 0) return undefined
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    try {
      const resolved = await credentials.resolve(apiKeyEnv)
      return resolved?.value
    } catch {
      return undefined
    }
  }

  // 代理出网：Node 内置 fetch 会用 UND_ERR_INVALID_ARG 拒绝外部 dispatcher，
  // 所以要代理时必须换用 undici 自己的 fetch + ProxyAgent；undici 不可用或
  // 未配置代理时回落到内置 fetch 直连。
  let proxyCache
  async function transportFor(proxyUrl) {
    if (typeof proxyUrl !== 'string' || proxyUrl.length === 0) {
      return { fetch: globalThis.fetch, init: {} }
    }
    if (proxyCache?.url === proxyUrl) return proxyCache.transport
    try {
      const undici = await import('undici')
      const dispatcher = new undici.ProxyAgent(proxyUrl)
      // 换代理地址时先把旧连接池关掉：留着就是一批永远不会被回收的 socket。
      if (proxyCache?.transport?.init?.dispatcher !== undefined) {
        try { await proxyCache.transport.init.dispatcher.close() } catch { /* 旧池关闭失败不影响切换 */ }
      }
      const transport = { fetch: undici.fetch, init: { dispatcher } }
      proxyCache = { url: proxyUrl, transport }
      return transport
    } catch (error) {
      ctx.logger.warn('[model-capabilities] proxy %s unavailable, falling back to direct: %s', proxyUrl, String(error?.message ?? error))
      return { fetch: globalThis.fetch, init: {} }
    }
  }

  /** 调用 OpenAI 兼容的生成接口，返回原始 JSON。 */
  async function callGeneration(kind, prompt, extra, signal) {
    const own = ownConfig()
    const key = kind === 'image' ? own.imageActive : own.videoActive
    const active = splitKey(key)
    if (active === null) {
      return {
        ok: false,
        error: kind === 'image'
          ? '尚未选择生图模型：请在「模型」设置页的供应商卡片里为某个模型开启「生图」，并把它设为当前生图模型。'
          : '尚未选择视频模型：请在「模型」设置页的供应商卡片里为某个模型开启「视频」，并把它设为当前视频模型。',
      }
    }
    const endpoint = endpointOf(active.provider)
    if (endpoint.error !== undefined) return { ok: false, error: endpoint.error }
    const apiKey = await apiKeyOf(endpoint.apiKeyEnv)
    if (endpoint.apiKeyEnv !== undefined && apiKey === undefined) {
      return { ok: false, error: `未找到凭据 ${endpoint.apiKeyEnv}：请在「模型」设置页填写该供应商的 API Key。` }
    }
    const path = (kind === 'image' ? own.imagePath : own.videoPath) || (kind === 'image' ? 'images/generations' : 'videos/generations')
    const url = `${endpoint.baseURL}/${String(path).replace(/^[\\/]+/, '')}`
    const headers = { 'content-type': 'application/json' }
    if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`
    const transport = await transportFor(own.proxyUrl)
    const body = { model: active.model, prompt, ...extra }
    let response
    try {
      response = await transport.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...signal === undefined ? {} : { signal },
        ...transport.init,
      })
    } catch (error) {
      return { ok: false, error: `请求 ${url} 失败：${String(error?.message ?? error)}` }
    }
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, error: `${kind === 'image' ? '生图' : '视频'}接口返回 ${response.status}：${text.slice(0, 600)}` }
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: `响应不是 JSON：${text.slice(0, 600)}` }
    }
    return { ok: true, model: `${active.provider}/${active.model}`, endpoint: url, data: parsed }
  }

  // ── 7. 工具注册 ─────────────────────────────────────────────────────────

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'generate_image',
    description: '调用用户已开启「生图」能力并设为当前的模型生成图片（OpenAI 兼容 images/generations 接口）。'
      + '用户要求生成/绘制/画一张图时使用；提示词越具体越好。若返回 ok=false，把 error 原文转告用户。',
    parameters: {
      prompt: { type: 'string', required: true, description: '详细的图片生成提示词：主体、风格、场景、构图、光线等。' },
      size: { type: 'string', description: '可选尺寸，如 1024x1024；不确定时省略。' },
      n: { type: 'integer', description: '可选生成张数，默认 1。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const extra = {}
      if (typeof args.size === 'string' && args.size.length > 0) extra.size = args.size
      extra.n = typeof args.n === 'number' && args.n > 0 ? args.n : 1
      return callGeneration('image', String(args.prompt), extra, exec.signal)
    },
  })), 'model-capabilities: generate_image')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'generate_video',
    description: '调用用户已开启「视频」能力并设为当前的模型生成视频。'
      + '多数网关此接口为异步任务制，返回体里通常带任务 id 或轮询地址——原样转告用户即可，不要臆造结果。'
      + '若返回 ok=false，把 error 原文转告用户。',
    parameters: {
      prompt: { type: 'string', required: true, description: '详细的视频生成提示词：主体、动作、镜头运动、风格、时长意向。' },
      duration: { type: 'integer', description: '可选时长（秒）；不确定时省略。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const extra = {}
      if (typeof args.duration === 'number' && args.duration > 0) extra.duration = args.duration
      return callGeneration('video', String(args.prompt), extra, exec.signal)
    },
  })), 'model-capabilities: generate_video')

  // ── 8. HTTP 路由 ────────────────────────────────────────────────────────

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => { void route(req, res) },
  }), 'model-capabilities: http routes')

  async function route(req, res) {
    try {
      if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback only' }); return }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rest = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      const method = String(req.method ?? 'GET').toUpperCase()

      if (rest === '/snapshot' && method === 'GET') {
        json(res, 200, await snapshot())
        return
      }
      if (method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
      const body = await readBody(req)

      if (rest === '/vision') {
        const provider = String(body?.provider ?? '')
        const model = String(body?.model ?? '')
        const state = String(body?.state ?? '')
        if (!['on', 'off', 'inherit'].includes(state)) {
          json(res, 400, { ok: false, error: 'state must be on | off | inherit' })
          return
        }
        const result = await editModel(provider, model, entry => { applyVision(entry, state); return undefined })
        json(res, result.ok ? 200 : 400, result)
        return
      }

      if (rest === '/reasoning') {
        const provider = String(body?.provider ?? '')
        const model = String(body?.model ?? '')
        const state = String(body?.state ?? '')
        const levels = Array.isArray(body?.levels) ? body.levels.map(String) : []
        if (!['levels', 'off', 'inherit'].includes(state)) {
          json(res, 400, { ok: false, error: 'state must be levels | off | inherit' })
          return
        }
        // applyReasoning 的拒绝现在由 editModel 自己处理（整轮不写盘），
        // 这里不再需要事后判断。
        const offWire = body?.offWire === 'none' ? 'none' : undefined
        const result = await editModel(provider, model, entry => applyReasoning(entry, state, levels, offWire))
        json(res, result.ok ? 200 : 400, result)
        return
      }

      if (rest === '/flag') {
        const provider = String(body?.provider ?? '')
        const model = String(body?.model ?? '')
        const kind = String(body?.kind ?? '')
        if (kind !== 'image' && kind !== 'video' && kind !== 'speech' && kind !== 'enabled') {
          json(res, 400, { ok: false, error: 'kind must be image | video | speech | enabled' })
          return
        }
        if (provider === '' || model === '') {
          json(res, 400, { ok: false, error: 'provider and model are required' })
          return
        }
        json(res, 200, await setFlag(`${provider}/${model}`, kind, body?.enabled === true))
        return
      }

      if (rest === '/active') {
        const kind = String(body?.kind ?? '')
        if (kind !== 'image' && kind !== 'video') {
          json(res, 400, { ok: false, error: 'kind must be image | video' })
          return
        }
        const result = await setActive(kind, String(body?.key ?? ''))
        json(res, result.ok ? 200 : 400, result)
        return
      }

      if (rest === '/settings') {
        if (scope === undefined) { json(res, 400, { ok: false, error: `设置命名空间 "${NS}" 不可用。` }); return }
        const patch = {}
        if (typeof body?.imagePath === 'string') patch.imagePath = body.imagePath
        if (typeof body?.videoPath === 'string') patch.videoPath = body.videoPath
        if (typeof body?.proxyUrl === 'string') patch.proxyUrl = body.proxyUrl
        if (Object.keys(patch).length > 0) await scope.update(patch)
        json(res, 200, { ok: true })
        return
      }

      json(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      ctx.logger.error('[model-capabilities] route error: %s', String(error?.message ?? error))
      if (!res.headersSent) json(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  }
}
