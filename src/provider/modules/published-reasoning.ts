/**
 * 供应商 /models 公布的推理等级 —— 纯解析函数（可单测，无 IO）。
 *
 * 聚合网关（magpie 系、OpenRouter 等）会在 `GET /v1/models` 的每个条目上
 * 直接公布推理能力，比逐档发请求试探更准、也不花钱：
 *
 *   - `reasoning`: boolean               是否启用推理
 *   - `reasoning_levels`: string[]       可选用档位（Catwalk schema，Crush 等读它）
 *   - `supported_reasoning_levels`: [{ effort }]   OpenAI 形态
 *   - `reasoning`: { supported_efforts: [...] }    OpenRouter 对象形态
 *
 * 「检测推理等级」优先读这些公布值；供应商没公布时才回落逐档实测。
 */

/** pi-ai 的推理档位（不含 off；off 是「不发参数」语义，不是网关档位）。 */
export const REASONING_LEVEL_WIRES = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** 一个可选推理档位。 */
export type ReasoningLevelWire = typeof REASONING_LEVEL_WIRES[number]

/** 一条模型条目里公布的推理能力。 */
export interface PublishedReasoning {
  /** 条目里确实带了推理字段（reasoning / reasoning_levels / supported_reasoning_levels 任一）。 */
  declared: boolean
  /** 是否公布了具体档位表；false = 只说了支持/不支持，没说有哪些档。 */
  levelsKnown: boolean
  /** 公布的可选档位，按 {@link REASONING_LEVEL_WIRES} 顺序；不含 off。 */
  levels: ReasoningLevelWire[]
  /** 关闭语义的线上值：公布值里含 none/off 时为 'none'，否则 null（省略参数即关闭）。 */
  offWire: 'none' | null
  /** 条目明确说这个模型不启用推理（reasoning === false，或公布了一个空档位表）。 */
  nonReasoning: boolean
  /** 公布字段的来源名，供 UI 回显。 */
  sources: string[]
}

/** 把公布里的一个值归一：档位名、'off'（关闭语义），或 null（不认识）。 */
function normalizeLevel(raw: unknown): ReasoningLevelWire | 'off' | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  if (value === '') return null
  if (value === 'none' || value === 'off' || value === 'disabled' || value === 'no') return 'off'
  return (REASONING_LEVEL_WIRES as readonly string[]).includes(value) ? value as ReasoningLevelWire : null
}

/**
 * 从一个「档位列表」字段里取归一后的值。
 * 元素可以是字符串，也可以是 `{ effort }` / `{ level }` / `{ id }` 形态。
 */
function levelsOf(value: unknown): Array<ReasoningLevelWire | 'off'> {
  if (!Array.isArray(value)) return []
  const out: Array<ReasoningLevelWire | 'off'> = []
  for (const item of value) {
    let raw: unknown = item
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      raw = record.effort ?? record.level ?? record.id
    }
    const level = normalizeLevel(raw)
    if (level !== null && !out.includes(level)) out.push(level)
  }
  return out
}

/**
 * 读一条模型条目公布的推理能力。
 * @param entry - `/models` 里的一个模型对象。
 * @returns 公布信息；条目里没有任何推理字段时返回 null。
 */
export function publishedReasoningOf(entry: unknown): PublishedReasoning | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  const sources: string[] = []
  const collected: Array<ReasoningLevelWire | 'off'> = []
  const push = (values: Array<ReasoningLevelWire | 'off'>): void => {
    for (const value of values) if (!collected.includes(value)) collected.push(value)
  }

  let levelsKnown = false
  if (Array.isArray(record.reasoning_levels)) {
    sources.push('reasoning_levels')
    levelsKnown = true
    push(levelsOf(record.reasoning_levels))
  }
  if (Array.isArray(record.supported_reasoning_levels)) {
    sources.push('supported_reasoning_levels')
    levelsKnown = true
    push(levelsOf(record.supported_reasoning_levels))
  }

  let explicitlyFalse = false
  if (Object.prototype.hasOwnProperty.call(record, 'reasoning')) {
    sources.push('reasoning')
    const value = record.reasoning
    if (value === false) explicitlyFalse = true
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const object = value as Record<string, unknown>
      const efforts = object.supported_efforts ?? object.efforts ?? object.levels ?? object.reasoning_levels
      if (Array.isArray(efforts)) {
        levelsKnown = true
        push(levelsOf(efforts))
      }
      if (object.enabled === false) explicitlyFalse = true
    }
  }

  if (sources.length === 0) return null
  const off = collected.includes('off')
  const levels = REASONING_LEVEL_WIRES.filter(level => collected.includes(level))
  return {
    declared: true,
    levelsKnown,
    levels: [...levels],
    offWire: off ? 'none' : null,
    // 公布了档位表却是空的（reasoning_levels: []）= 明确没有推理档；
    // 只写 reasoning: true 而没有档位表不算「非推理」，只是档位未知。
    nonReasoning: explicitlyFalse || (levelsKnown && collected.length === 0),
    sources,
  }
}

/**
 * 把各种 `/models` 响应体归一成模型条目数组。
 * 兼容 OpenAI 的 `data`、`models` 数组、`models` 对象 map、`result`。
 */
export function modelListOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (body === null || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const data = record.data
  if (Array.isArray(data)) return data
  const models = record.models
  if (Array.isArray(models)) return models
  if (models !== null && typeof models === 'object') {
    return Object.values(models as Record<string, unknown>)
      .filter(item => item !== null && typeof item === 'object' && !Array.isArray(item))
  }
  const result = record.result
  if (Array.isArray(result)) return result
  return []
}

/**
 * 在模型清单里找目标条目。
 * 依次尝试 id 精确、id 大小写不敏感、name/display_name 精确与大小写不敏感
 * ——中转网关常把请求名放在 id、把厂商名放在 name。
 * @param models - {@link modelListOf} 的结果。
 * @param modelId - 配置里的模型 id。
 * @returns 命中的条目；找不到返回 null。
 */
export function pickModelEntry(models: readonly unknown[], modelId: string): Record<string, unknown> | null {
  const wanted = String(modelId ?? '').trim()
  if (wanted === '') return null
  const entries = models.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item),
  )
  const lower = wanted.toLowerCase()
  const idOf = (entry: Record<string, unknown>): string =>
    typeof entry.id === 'string' ? entry.id.trim() : ''
  const nameOf = (entry: Record<string, unknown>): string => {
    const name = entry.name ?? entry.display_name
    return typeof name === 'string' ? name.trim() : ''
  }
  return entries.find(entry => idOf(entry) === wanted)
    ?? entries.find(entry => idOf(entry).toLowerCase() === lower)
    ?? entries.find(entry => nameOf(entry) === wanted)
    ?? entries.find(entry => nameOf(entry).toLowerCase() === lower)
    ?? null
}
