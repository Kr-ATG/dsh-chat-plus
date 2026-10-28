/**
 * dsh-chat-plus — 个人动态（Feed）· 模型解析（host 半身）。
 *
 * 这一层只做一件事：把 \`config.model\` 这个用户可配的字符串，解析成
 * \`ctx.llm.stream()\` 真正要的 \`{ provider, model }\` 路由。
 *
 * ── 为什么单独一层 ──────────────────────────────────────────────────
 *
 * 三个消费方要的是**同一份答案**：
 *
 *  1. 写作流水线（writer.ts）——"这一轮用哪个模型写"；
 *  2. \`GET /api/dsh-feed/models\` —— 客户端下拉里能选哪些模型、
 *     以及"跟随系统默认"到底跟的是谁；
 *  3. \`GET /api/dsh-feed/status\` —— 上一轮实际用的模型、以及解析不出来的
 *     时候**为什么**解析不出来。
 *
 * 三处各写一份的话，"下拉里选的是 A、实际跑的是 B"这种漂移必然发生，
 * 而且它不会报错 —— 只会让用户觉得"我选了模型怎么没生效"。
 *
 * ── 'default' 的语义（用户明确要求）────────────────────────────────
 *
 * 用户说「选中我们现在的这个模型」。所以 \`config.model === 'default'\` 必须
 * 真的解析出**当前会话正在用的那个模型**，而不是"随便挑一个能用的"。
 *
 * 解析顺序（每一步都记进 resolution，便于排查）：
 *
 *  1. \`agentDefaultModel.currentSelection()\` —— 这是 DSH 里"默认模型选择"
 *     的**唯一事实源**（cordis.patch.yml 的 \`agent-default-model\` 段配的就是它，
 *     本机实测是 \`alymagpie / auto/deepseek-v4.1-flash\`）；
 *  2. 遍历 \`llm.listProviders()\` + \`listModels()\`，挑第一个真有模型的 provider；
 *  3. 都没有 → **明确报错**，绝不静默降级成"随便一个"。
 *
 * 第 3 条是硬要求：静默降级的结果是用户在设置里看到"跟随系统默认"，
 * 实际跑的却是另一个模型，而界面上一句提示都没有。
 *
 * ── 缓存 ───────────────────────────────────────────────────────────
 *
 * \`listModels()\` 对未配置凭据的 provider 会走网络/失败路径，而 \`/status\`
 * 是会被轮询的接口。所以目录缓存 30 秒（按 llm 服务实例分别缓存，测试里
 * 换一个假 llm 不会读到上一个的缓存）。缓存只在**成功**时写入 —— 失败
 * 不缓存，否则一次抖动会让目录空 30 秒。
 *
 * @module
 */

import type { FeedRunStats } from './types.ts'

/* ───────────────────────── 最小服务面 ───────────────────────── */

/** 与 \`@deepseek-ai/dsh-llm\` 的 LlmProviderInfo 同形（只取用得上的字段）。 */
export interface LlmProviderInfoLike {
  id: string
  name?: string
}

/** 与 LlmModelInfo 同形。 */
export interface LlmModelInfoLike {
  provider?: string
  id: string
  name?: string
  description?: string
}

/**
 * llm 服务的**最小面**。
 *
 * 刻意不 import 官方类型：本插件的 host 产物必须完全自包含（build.mjs 的
 * assertHostExternals 会拦下任何运行时裸包名），而类型导入在 esbuild 里
 * 会被擦除、不会产生运行时依赖。用结构化的最小面还能让冒烟用纯对象假实现
 * 顶替 —— 不需要真的起一个 DSH。
 */
export interface LlmLike {
  listProviders?: () => LlmProviderInfoLike[]
  listModels?: (provider: string) => Promise<LlmModelInfoLike[]>
  resolveModelInfo?: (provider: string, model: string) => Promise<{ defaultMaxTokens?: number }>
  stream?: (options: unknown) => AsyncIterable<unknown>
}

/** 取 cordis 服务（\`ctx.get(name)\` 的最小投影；测试里直接给一个查表的函数）。 */
export type ServiceGetter = (name: string) => unknown

/* ───────────────────────── 目录形状 ───────────────────────── */

/** 客户端下拉里的一项。 */
export interface FeedModelOption {
  /**
   * 写进 \`config.model\` 的标识。
   *
   * 绝大多数情况就是模型自己的 id（如 \`auto/deepseek-v4.1-flash\`）。
   * 只有**多个 provider 报了同一个模型 id** 时才会多带一个 \`provider:\` 前缀
   * 用来消歧（如 \`alymagpie:deepseek-chat\`），因为那时裸 id 无法定位路由。
   * 这样「下拉里选什么、config 里存什么、解析回哪条路由」三件事永远一致。
   */
  id: string
  label: string
  /** provider 路由 id。 */
  provider: string
  /** provider 展示名。 */
  providerName: string
  /** 模型自身的 id（不带消歧前缀）。 */
  modelId: string
}

/** 一次目录加载的完整结果（\`GET /models\` 直接下发它）。 */
export interface FeedModelCatalog {
  /** 当前生效模型的人类可读短名（客户端下拉「跟随系统默认（XXX）」用它）。 */
  current: string
  /** 当前生效模型的**真实** model id。 */
  currentModel: string
  /** 当前生效模型的 provider 路由。 */
  currentProvider: string
  /**
   * \`config.model === 'default'\` 时应当写进配置/用于调用的标识。
   * 解析成功时等于 \`models[]\` 里能直接选中的那一项 id。
   */
  default: string
  /** 是否真的解析出了当前模型。false 时 error 一定有值。 */
  resolved: boolean
  /** 解析路径：agentDefaultModel / first-available / none。 */
  resolution: FeedModelResolutionKind
  /** 解析失败原因（中文，直接可展示）。 */
  error?: string
  models: FeedModelOption[]
}

/** 默认模型是怎么找到的（写进 run.stats 与 /status，排查全靠它）。 */
export type FeedModelResolutionKind = 'agentDefaultModel' | 'first-available' | 'none'

/* ───────────────────────── 服务读取 ───────────────────────── */

/**
 * 取 llm 服务。拿不到返回 null（调用方据此报「模型不可用」而不是抛）。
 *
 * 为什么用 \`ctx.get('llm')\` 而不是 \`ctx.inject\`：注入式依赖会抛
 * \`cannot get property "llm" without inject\`（cordis 的 Proxy 行为），而
 * 本模块要求「模型不可用时降级但整体不挂」。\`ctx.get\` 不检查 inject
 * 白名单，拿不到就是 undefined —— 正是这里想要的语义。
 */
export function readLlm(getService: ServiceGetter | undefined): LlmLike | null {
  if (typeof getService !== 'function') return null
  let raw: unknown
  try {
    raw = getService('llm')
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  return raw as LlmLike
}

/**
 * 读「系统当前主模型」（DSH 的 agent-default-model 服务）。
 *
 * 这是 \`config.model === 'default'\` 的第一优先级来源，也是唯一一个
 * "就是用户此刻在用的模型"的事实源。
 *
 * 读不到返回 null（服务未装载 / 还在装配 / 未配置），由调用方走下一级。
 */
export function readDefaultSelection(getService: ServiceGetter | undefined): { provider: string; model: string } | null {
  if (typeof getService !== 'function') return null
  try {
    const service = getService('agentDefaultModel') as { currentSelection?: () => unknown } | undefined
    if (typeof service?.currentSelection !== 'function') return null
    const selection = service.currentSelection()
    if (typeof selection !== 'object' || selection === null) return null
    const record = selection as Record<string, unknown>
    const provider = typeof record['provider'] === 'string' ? record['provider'].trim() : ''
    const model = typeof record['model'] === 'string' ? record['model'].trim() : ''
    if (provider === '' || model === '') return null
    return { provider, model }
  } catch {
    // 服务存在但读取失败（fiber 未激活 / 实现变更）→ 当作没有，不抛。
    return null
  }
}

/* ───────────────────────── 目录加载 ───────────────────────── */

/** 目录缓存时长：\`/status\` 会被轮询，不能每次都去问 provider。 */
export const MODEL_CACHE_TTL_MS = 30_000

/**
 * 目录缓存：按 llm 实例分别存，带**代际号**以便整体失效。
 *
 * 为什么不是裸 WeakMap：清缓存时 WeakMap 没有 clear()，而"换一个 llm 实例"
 * 也解决不了问题 —— 冒烟里同一个假 llm 会被反复复用，缓存不失效的话
 * 「上一组用例拿到的目录」会漏进下一组。
 * 代际号方案：清一次就把 generation 加一，所有旧条目自动判为过期。
 */
const catalogCache = new WeakMap<object, { at: number; generation: number; catalog: FeedModelCatalog }>()
let catalogGeneration = 0

/** 清掉全部目录缓存（冒烟用；也用于「刚配好 provider，立刻重新列表」）。 */
export function clearModelCatalogCache(): void {
  catalogGeneration += 1
}

/** 把 provider 目录拉平成一个模型列表；重名 id 用 \`provider:\` 前缀消歧。 */
function flattenCatalog(
  providers: readonly LlmProviderInfoLike[],
  listed: ReadonlyArray<{ provider: LlmProviderInfoLike; models: LlmModelInfoLike[] }>,
): FeedModelOption[] {
  const rows: Array<Omit<FeedModelOption, 'id'> & { rawId: string }> = []
  for (const entry of listed) {
    const providerId = entry.provider.id
    const providerName = typeof entry.provider.name === 'string' && entry.provider.name !== ''
      ? entry.provider.name
      : providerId
    for (const model of entry.models) {
      const modelId = typeof model.id === 'string' ? model.id.trim() : ''
      if (modelId === '') continue
      const name = typeof model.name === 'string' && model.name.trim() !== '' ? model.name.trim() : modelId
      rows.push({ label: name, provider: providerId, providerName, modelId, rawId: modelId })
    }
  }
  /*
   * 消歧只在**真的重名**时发生：同一个模型 id 被两个 provider 报了。
   * 不重名时 id 保持裸模型名 —— 那是用户在所有其它界面（供应商面板、
   * 模型选择器）里认得的字符串，加前缀只会让人以为要改配置。
   */
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.rawId, (counts.get(row.rawId) ?? 0) + 1)
  void providers
  return rows.map(row => ({
    id: (counts.get(row.rawId) ?? 0) > 1 ? row.provider + ':' + row.rawId : row.rawId,
    label: row.label,
    provider: row.provider,
    providerName: row.providerName,
    modelId: row.modelId,
  }))
}

/**
 * 加载（或读缓存的）模型目录。
 *
 * 永不抛：llm 不可用 / 所有 provider 都列不出来时返回 \`resolved:false\` +
 * 中文 error，让上层的 /models 与 /status 都能如实呈现"为什么没有模型"。
 *
 * @param getService - 取 cordis 服务。
 * @param now - 当前时刻（注入以便测试）。
 */
export async function loadModelCatalog(
  getService: ServiceGetter | undefined,
  now: () => number = Date.now,
): Promise<FeedModelCatalog> {
  const llm = readLlm(getService)
  if (llm === null) {
    return {
      current: '', currentModel: '', currentProvider: '', default: '',
      resolved: false, resolution: 'none', models: [],
      error: 'llm 服务不可用（ctx.get("llm") 拿不到）',
    }
  }

  const at = now()
  const cached = catalogCache.get(llm)
  if (cached !== undefined && cached.generation === catalogGeneration && at - cached.at < MODEL_CACHE_TTL_MS) {
    return cached.catalog
  }

  const selection = readDefaultSelection(getService)

  // ── 拉 provider 目录 ───────────────────────────────────────────
  let providers: LlmProviderInfoLike[] = []
  try {
    const listed = llm.listProviders?.()
    if (Array.isArray(listed)) {
      providers = listed.filter((entry): entry is LlmProviderInfoLike =>
        typeof entry === 'object' && entry !== null && typeof (entry as LlmProviderInfoLike).id === 'string')
    }
  } catch {
    providers = []
  }

  const listed: Array<{ provider: LlmProviderInfoLike; models: LlmModelInfoLike[] }> = []
  for (const provider of providers) {
    try {
      const models = await llm.listModels?.(provider.id)
      if (Array.isArray(models) && models.length > 0) listed.push({ provider, models })
    } catch {
      // 单个 provider 目录不可用（凭据缺失 / NO_ADAPTER）→ 跳过，不影响其余。
    }
  }

  const models = flattenCatalog(providers, listed)

  // ── 解析「当前模型」 ───────────────────────────────────────────
  let resolution: FeedModelResolutionKind = 'none'
  let currentProvider = ''
  let currentModel = ''
  let error: string | undefined

  if (selection !== null) {
    resolution = 'agentDefaultModel'
    currentProvider = selection.provider
    currentModel = selection.model
  } else if (models.length > 0) {
    // 兜底：agentDefaultModel 不可用（未装载 / 未配置）时，用目录里第一个
    // 真有模型的 provider。这条路径解析出来的**不保证**是用户此刻在用的
    // 那个模型，所以 resolution 如实标成 first-available —— /status 里
    // 用户与排查者都能看出"这是猜的"。
    resolution = 'first-available'
    const first = models[0]!
    currentProvider = first.provider
    currentModel = first.modelId
  } else {
    error = '无法解析当前模型：agentDefaultModel 读不到，且 llm.listProviders() 里没有任何可用模型'
  }

  // 找到与当前路由对应那一项的 id（客户端下拉「跟随系统默认」用它做默认选中）。
  const hit = models.find(option => option.provider === currentProvider && option.modelId === currentModel)
  const defaultId = hit !== undefined ? hit.id : currentModel
  const currentLabel = hit !== undefined ? hit.label : currentModel

  const catalog: FeedModelCatalog = {
    current: currentLabel,
    currentModel,
    currentProvider,
    default: defaultId,
    resolved: resolution !== 'none',
    resolution,
    models,
    ...(error === undefined ? {} : { error }),
  }

  // 只有解析出真东西才缓存：一次抖动不该让目录空 30 秒。
  if (catalog.resolved) catalogCache.set(llm, { at, generation: catalogGeneration, catalog })
  return catalog
}

/* ───────────────────────── 路由解析 ───────────────────────── */

/** 解析出来的写作路由。 */
export interface WriteRoute {
  provider: string
  model: string
  /** 展示用短名（写进 posts / run 记录便于溯源）。 */
  label: string
  /** 是否等于「系统默认模型」。 */
  isDefault: boolean
  /** 这一路由是怎么定下来的（写进 run.stats 便于排查）。 */
  resolution: string
  /** 模型声明的单次输出上限（拿不到就 undefined，由调用方兜底）。 */
  defaultMaxTokens?: number
  /** 非致命的说明（如「该模型不在目录里，按默认 provider 直连」）。 */
  note?: string
}

/** 路由解析结果。 */
export type WriteRouteResult =
  | { ok: true; route: WriteRoute; catalog: FeedModelCatalog }
  | { ok: false; error: string; catalog: FeedModelCatalog }

/**
 * 把 \`config.model\` 解析成调用路由。
 *
 * 三种语义（与 §5.4 一致）：
 *  - \`''\` / \`'default'\` → 系统当前主模型；
 *  - \`'provider:model'\` → 显式指定 provider（消歧用）；
 *  - 其余 → 按模型 id 在目录里找；**找不到时不立刻失败**，而是沿用默认
 *    provider 直连（用户可能是手填了一个刚配好、目录还没刷出来的模型）。
 *    真的连默认 provider 都拿不到才报错。
 *
 * @param getService - 取 cordis 服务。
 * @param wanted - \`config.model\`。
 * @param now - 当前时刻。
 */
export async function resolveWriteRoute(
  getService: ServiceGetter | undefined,
  wanted: string,
  now: () => number = Date.now,
): Promise<WriteRouteResult> {
  const catalog = await loadModelCatalog(getService, now)
  const wantedRaw = typeof wanted === 'string' ? wanted.trim() : ''
  const isDefault = wantedRaw === '' || wantedRaw === 'default'

  if (isDefault) {
    if (!catalog.resolved) {
      return { ok: false, error: catalog.error ?? '无法解析当前模型', catalog }
    }
    return {
      ok: true,
      catalog,
      route: {
        provider: catalog.currentProvider,
        model: catalog.currentModel,
        label: catalog.current,
        isDefault: true,
        resolution: catalog.resolution,
      },
    }
  }

  // ① 目录里精确命中（含 provider: 前缀的消歧写法）。
  const hit = catalog.models.find(option => option.id === wantedRaw)
    ?? catalog.models.find(option => option.label === wantedRaw)
  if (hit !== undefined) {
    return {
      ok: true,
      catalog,
      route: {
        provider: hit.provider,
        model: hit.modelId,
        label: hit.label,
        isDefault: hit.provider === catalog.currentProvider && hit.modelId === catalog.currentModel,
        resolution: 'configured',
      },
    }
  }

  // ② \`provider:model\` 显式写法（前半段必须是已知 provider）。
  const colon = wantedRaw.indexOf(':')
  if (colon > 0) {
    const maybeProvider = wantedRaw.slice(0, colon)
    const maybeModel = wantedRaw.slice(colon + 1)
    if (maybeModel !== '' && catalog.models.some(option => option.provider === maybeProvider)) {
      return {
        ok: true,
        catalog,
        route: {
          provider: maybeProvider,
          model: maybeModel,
          label: maybeModel,
          isDefault: false,
          resolution: 'configured-provider',
        },
      }
    }
  }

  // ③ 后缀唯一匹配（用户手填短名，如 deepseek-v4.1-flash 而目录里是
  //    auto/deepseek-v4.1-flash）。唯一才算命中 —— 多个候选就是猜，猜错
  //    比报错更糟。
  const suffixHits = catalog.models.filter(option =>
    option.modelId === wantedRaw || option.modelId.endsWith('/' + wantedRaw))
  if (suffixHits.length === 1) {
    const only = suffixHits[0]!
    return {
      ok: true,
      catalog,
      route: {
        provider: only.provider,
        model: only.modelId,
        label: only.label,
        isDefault: false,
        resolution: 'configured-suffix',
        note: '配置的模型名「' + wantedRaw + '」按后缀匹配到 ' + only.modelId,
      },
    }
  }

  // ④ 目录里没有 → 沿用默认 provider 直连（不打断生成），但要留下 note。
  if (catalog.resolved) {
    return {
      ok: true,
      catalog,
      route: {
        provider: catalog.currentProvider,
        model: wantedRaw,
        label: wantedRaw,
        isDefault: false,
        resolution: 'configured-assumed',
        note: '模型「' + wantedRaw + '」不在可用目录里，按默认 provider「'
          + catalog.currentProvider + '」直连；若持续失败请检查模型名或供应商配置',
      },
    }
  }

  return {
    ok: false,
    catalog,
    error: '模型「' + wantedRaw + '」不可用，且默认模型也解析不出来（'
      + (catalog.error ?? '未知原因') + '）',
  }
}

/** 读模型声明的单次输出上限（失败返回 undefined，永不抛）。 */
export async function readModelMaxTokens(
  getService: ServiceGetter | undefined,
  provider: string,
  model: string,
): Promise<number | undefined> {
  const llm = readLlm(getService)
  if (llm === null || typeof llm.resolveModelInfo !== 'function') return undefined
  try {
    const info = await llm.resolveModelInfo(provider, model)
    const cap = info?.defaultMaxTokens
    return typeof cap === 'number' && Number.isSafeInteger(cap) && cap > 0 ? cap : undefined
  } catch {
    return undefined
  }
}

/** 把路由信息折进 run.stats（三处消费方共用同一份字段名）。 */
export function routeStats(route: WriteRoute): Partial<FeedRunStats> {
  return { modelUsed: route.label + ' (' + route.provider + '/' + route.model + ')' }
}

/** 导出给冒烟对拍。 */
export const __test = { flattenCatalog, catalogCache }
