/**
 * skill-source — 技能 slash 源(替代内核 ui-skill 的平铺技能列表)。
 *
 * **不再强制「先进包才能选技能」**——包与技能两条路并存:
 *
 *  · 输入 `/` 不打字 → 只列技能集合(bundle)与散装技能行,首屏保持清爽;
 *  · 打了任意字符(`/kb`、`/flow`、`/注释`…) → 把 **全部启用技能**拉进来
 *    一起匹配,命中的技能排在最前,回车即落地 `/<skill> `
 *    (与内核 ui-skill 的纯文本引用路径一致);集合行同时参与名字匹配,
 *    仍可选中钻取。
 *  · **中文/口语也能搜**:技能名几乎全英文,所以另有一张别名表
 *    (./aliases.ts)把「注释」「流程图」「电子表格」这类词映射到技能名,
 *    别名命中优先级最高——否则中文 query 在英文名上永远零命中。
 *
 * 钻取仍走 slash 管线的 `continue: true` 协议:选中集合时落地
 * `/bundleId:` 文本并保持菜单打开,管线在光标处重新跟踪,第二级的 query
 * 形如 `bundleId:` → candidates 返回该集合下的技能。
 *
 * 直接匹配意味着短 query 会命中一批技能(`/iu` 就能子序列命中
 * `dsh-plugin-ui-slots` 之类)。`/iu` 指令源因此把 order 提到技能源之前
 * (见 src/client/iu/slash.ts),保证该场景下菜单高亮仍落在指令提示项上,
 * 回车不会被技能抢走。
 *
 * 数据源为 dsh-webui host 半身已挂载的 /api/skill-manager(与技能管理面板
 * 同一份数据:集合 + 散装技能),零 DSH 源码改动。
 *
 * 除 slash 源外,本模块同时补注册 `tool.call.toolview` key='skill' 的
 * SkillRow(内核 ui-skill 插件在 web profile 中被禁用后,技能调用的工具行
 * 由本插件接管,组件与文案照搬内核实现,样式改注入模式)。
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 inputTriggers 服务声明与 InputTriggerSource 契约。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  InputTriggerSource, InputTriggerServiceContract, ClientSessionContext, CandidateRequest,
  InputTriggerCandidate,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: 激活 ui-tool 的 SlotMap 合并(tool.call.toolview 的 key 注册契约)。
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { SKILL_ALIASES, matchesAlias } from './aliases.ts'
import { applySkillReference } from './reference.tsx'
import { SkillRow } from './SkillRow.tsx'
import { en, NS, zh, type SkillKey } from './locales.ts'
import { injectSkillRowStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated skill tool row's copy. */
    skill: SkillKey
  }
}

/** 技能管理面板数据模型(与 /api/skill-manager 响应一致)。 */
interface SkillView {
  name: string
  description: string
}

interface BundleView {
  id: string
  name: string
  skillCount: number
  skills: SkillView[]
}

interface SkillSnapshot {
  bundles: BundleView[]
  loose: SkillView[]
}

/** 快照 + 开关状态(/api/skill-toggles/status 的 skills 表;缺省视为启用)。 */
interface ResolvedSnapshot extends SkillSnapshot {
  enabled: Record<string, boolean>
}

/** /api/skill-toggles/presets 响应里本模块关心的两块。 */
interface PresetWire {
  overrides?: Record<string, Record<string, boolean>>
}

/** 集合内技能入口的候选 value 前缀(bundle 与 skill 候选区分)。 */
const BUNDLE_MARK = 'bundle:'
const SKILL_MARK = 'skill:'
/** 散装技能虚拟集合 id。 */
const LOOSE_ID = '_loose'
/** 快照 TTL:技能面板改动后,slash 菜单最多滞后此间隔(秒)。 */
const SNAPSHOT_TTL_MS = 30 * 1000
/**
 * 直接匹配时最多铺几行技能。
 *
 * 一个字符的 query(`/d`、`/u`)能子序列命中几十个技能名,不设上限会把
 * 集合行与指令挤到菜单可视区外;8 行足够首屏点选,再多就靠继续打字收窄。
 */
const SKILL_ROW_CAP = 8

/** 一个会话的目录抓取:共享 promise + settle 快照 + 拉取时刻 + 自身 abort。 */
interface CatalogFetch {
  promise: Promise<ResolvedSnapshot>
  settled?: ResolvedSnapshot
  fetchedAt: number
  abort: AbortController
}

/** 会话级目录缓存。 */
const fetches = new Map<SessionId, CatalogFetch>()
/** 会话级 lexicon 失效监听器。 */
const lexiconListeners = new Map<SessionId, Set<() => void>>()

/** apply() 时捕获的 client root ctx(读 sessions 快照拿会话预设 id)。 */
let rootCtx: ClientContext | undefined

/** 预设名单/覆盖缓存(全客户端共享;TTL 与快照一致)。 */
let presetsCache: { at: number; promise: Promise<PresetWire | null> } | undefined

function fetchPresets(): Promise<PresetWire | null> {
  if (presetsCache !== undefined && Date.now() - presetsCache.at < SNAPSHOT_TTL_MS) {
    return presetsCache.promise
  }
  const promise = fetch('/api/skill-toggles/presets', {
    headers: { accept: 'application/json' },
  })
    .then((response) => response.ok ? response.json() as Promise<PresetWire> : null)
    .catch(() => null)
  presetsCache = { at: Date.now(), promise }
  return promise
}

/** 当前会话运行的 Agent 预设 id(client sessions 列表快照;读不到返回 undefined)。 */
function sessionPresetOf(sessionId: SessionId): string | undefined {
  try {
    const sessions = (rootCtx as unknown as { get?: (name: string) => unknown } | undefined)?.get?.('sessions') as
      | { list?: { getSnapshot?: () => { byId?: Record<string, { agentPreset?: string }> } } }
      | undefined
    const byId = sessions?.list?.getSnapshot?.()?.byId
    const preset = byId?.[sessionId]?.agentPreset
    return typeof preset === 'string' && preset !== '' ? preset : undefined
  } catch {
    return undefined
  }
}

function notifyListeners(sessionId: SessionId): void {
  for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) {
    try { listener() } catch (error) { console.error('[skill-source] lexicon listener failed:', error) }
  }
}

/** 拉取技能快照 + 开关状态(会话级单飞;TTL 过期后重取;失败不毒化缓存键)。 */
function fetchSnapshot(sessionId: SessionId): Promise<ResolvedSnapshot> {
  const existing = fetches.get(sessionId)
  if (existing !== undefined && Date.now() - existing.fetchedAt < SNAPSHOT_TTL_MS) {
    return existing.promise
  }
  // 共享 fetch 自带 abort,不接收调用方 signal:关闭菜单/切换 keystroke 的
  // abort 只淘汰调用方,不杀死其它消费者仍在用的预取(内核 ui-skill 同款)。
  const abort = new AbortController()
  const entry: CatalogFetch = { promise: undefined as never, fetchedAt: Date.now(), abort }
  const promise = (async () => {
    const [listResponse, toggleResponse, presetWire] = await Promise.all([
      fetch('/api/skill-manager/list', {
        headers: { accept: 'application/json' },
        signal: abort.signal,
      }),
      fetch('/api/skill-toggles/status', {
        headers: { accept: 'application/json' },
        signal: abort.signal,
      }).catch(() => null),
      fetchPresets(),
    ])
    const body = await listResponse.json() as SkillSnapshot & { error?: string }
    if (!listResponse.ok) throw new Error(body.error ?? `skill list failed (${String(listResponse.status)})`)
    let enabled: Record<string, boolean> = {}
    if (toggleResponse !== null && toggleResponse.ok) {
      const toggles = await toggleResponse.json() as { skills?: Record<string, boolean>; error?: string }
      if (toggles.skills !== undefined) enabled = toggles.skills
    }
    // 会话预设覆盖:该会话所属 Agent 预设里显式 false 的技能,在 slash 菜单
    // 里同样隐藏(与 host 闸门语义一致——预设层只能收窄全局层)。
    const presetId = sessionPresetOf(sessionId)
    const overrides = presetId === undefined ? undefined : presetWire?.overrides?.[presetId]
    if (overrides !== undefined) {
      const merged: Record<string, boolean> = { ...enabled }
      for (const [name, state] of Object.entries(overrides)) {
        if (state === false) merged[name] = false
      }
      enabled = merged
    }
    return { ...body, enabled }
  })()
  entry.promise = promise
  fetches.set(sessionId, entry)
  promise.then(
    (snapshot) => {
      entry.settled = snapshot
      notifyListeners(sessionId)
    },
    () => { if (fetches.get(sessionId) === entry) fetches.delete(sessionId) },
  )
  return promise
}

/** 失效一个会话的缓存(技能面板改动后调用;sessionId 缺省时全清)。 */
export function invalidateSkillCache(sessionId?: SessionId): void {
  // 预设覆盖与全局开关一起失效:面板改动可能改了任意预设的账本。
  presetsCache = undefined
  if (sessionId === undefined) {
    for (const key of [...fetches.keys()]) {
      const entry = fetches.get(key)
      if (entry === undefined) continue
      fetches.delete(key)
      entry.abort.abort()
      notifyListeners(key)
    }
    return
  }
  const entry = fetches.get(sessionId)
  if (entry === undefined) return
  fetches.delete(sessionId)
  entry.abort.abort()
  notifyListeners(sessionId)
}

/** 技能是否启用(缺省视为启用)。 */
function skillEnabled(snapshot: ResolvedSnapshot, name: string): boolean {
  return snapshot.enabled[name] !== false
}

/** 全部启用技能名(集合内 + 散装),供输入框 `/name` 的 chip 装饰。 */
function allSkillNames(snapshot: ResolvedSnapshot): string[] {
  const names: string[] = []
  for (const bundle of snapshot.bundles) {
    for (const skill of bundle.skills) {
      if (skillEnabled(snapshot, skill.name)) names.push(skill.name)
    }
  }
  for (const skill of snapshot.loose) {
    if (skillEnabled(snapshot, skill.name)) names.push(skill.name)
  }
  return names
}

/** 集合 id → 集合内启用技能(loose 为散装)。 */
function skillsOf(snapshot: ResolvedSnapshot, bundleId: string): SkillView[] {
  const source = bundleId === LOOSE_ID ? snapshot.loose : snapshot.bundles.find(bundle => bundle.id === bundleId)?.skills ?? []
  return source.filter(skill => skillEnabled(snapshot, skill.name))
}

/** 解析第二级 query(`bundleId:` 或 `bundleId:过滤词`)→ 集合 id + 过滤词。 */
function parseLevelQuery(query: string): { bundleId: string; rest: string } | null {
  const match = /^([a-z0-9_-]+):(.*)$/.exec(query)
  if (match === null) return null
  return { bundleId: match[1]!, rest: match[2]! }
}

/** 技能候选(第二级)。 */
function skillCandidate(skill: SkillView): { name: string; description?: string; value: string } {
  return { name: skill.name, description: skill.description, value: `${SKILL_MARK}${skill.name}` }
}

/**
 * 全部启用技能(集合内 + 散装),第一层直接匹配的语料。
 *
 * @param snapshot - 已合并开关/预设覆盖的技能快照。
 * @returns 启用中的技能,顺序沿用快照(集合顺序 → 集合内顺序)。
 */
function enabledSkills(snapshot: ResolvedSnapshot): SkillView[] {
  const all: SkillView[] = []
  for (const bundle of snapshot.bundles) {
    for (const skill of bundle.skills) {
      if (skillEnabled(snapshot, skill.name)) all.push(skill)
    }
  }
  for (const skill of snapshot.loose) {
    if (skillEnabled(snapshot, skill.name)) all.push(skill)
  }
  return all
}

/**
 * 首层「直接匹配」技能:按 query 在**全部启用技能**里做多路匹配。
 *
 * 三档优先级(高 → 低),档内保持各自原有次序:
 *  1. **别名命中**({@link matchesAlias})——中文/口语入口,`/注释` 直达
 *     `no-comments`。这一档必须最先:中文 query 在英文技能名上永远零命中,
 *     等于把用户挡在门外。
 *  2. 名字直接**包含** query(`/ui` → `phone-ui-demos`)。
 *  3. 内核 `rankByName` 的子序列命中(模糊兜底)。
 *
 * **描述兜底**:前两档一个都没命中时,再拿 query 去**中文描述**里找。
 * 别名表要人工维护,新装的技能不可能立刻有别名;而 SKILL.md 的描述本来
 * 就是中文的(`no-comments` 写着「清剿无用代码注释」),用户打「注释」
 * 自然能捞到。只在前面全空时才启用,避免描述里的泛词(「插件」「技能」)
 * 把无关结果顶上来。
 *
 * 空 query 返回空数组:裸 `/` 首屏仍只列集合,否则一屏技能会把包与指令全挤走。
 *
 * @param snapshot - 已合并开关/预设覆盖的技能快照。
 * @param query - 触发字符之后的原文(未 trim;大小写不敏感)。
 * @returns 命中的技能候选,已截到 {@link SKILL_ROW_CAP} 条。
 */
function matchedSkillCandidates(snapshot: ResolvedSnapshot, query: string): ReturnType<typeof skillCandidate>[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const all = enabledSkills(snapshot)
  const byAlias: SkillView[] = []
  const rest: SkillView[] = []
  for (const skill of all) {
    if (matchesAlias(skill.name, needle)) byAlias.push(skill)
    else rest.push(skill)
  }
  const picked = [...byAlias, ...substringFirst(rankByName(rest, needle), needle)]
  /*
   * 描述兜底排最后、且只在「前面一个都没命中」时生效。
   *
   * 为什么不和别名档并列:描述里的词太泛(「插件」「文档」「工具」几乎每个
   * 技能都写),并列会把真正靠名字命中的技能挤到截断之外;而前面全空时它
   * 又是唯一还能救场的入口——新装的技能没有别名,只能靠这段中文描述被搜到。
   */
  if (picked.length === 0) {
    return all
      .filter(skill => (skill.description ?? '').toLowerCase().includes(needle))
      .slice(0, SKILL_ROW_CAP)
      .map(skillCandidate)
  }
  return picked.slice(0, SKILL_ROW_CAP).map(skillCandidate)
}

/**
 * `rankByName` 的子序列匹配**不理解词/词组边界**:`/ui` 会命中
 * `dsh-plugin-ui-slots`,而用户想找的往往是真正叫 `ui-*` 的那批。
 *
 * 所以先跑内核排序,再把「名字里**直接包含** query」的一撮提到前面——
 * 两组各自保持 rankByName 的相对次序,不重排、不丢项:
 *  · 包含组(子串命中) = 用户最可能要的那几个,顶到最上;
 *  · 其余(纯子序列命中) = 兜底,仍可点选。
 *
 * 前缀命中本身一定包含 query,所以「前缀优先」的既有语义被这一层包含,
 * 不需要额外判断。大小写与 rankByName 一致(都转小写比较)。
 */
function substringFirst(skills: readonly SkillView[], query: string): readonly SkillView[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return skills
  const contains: SkillView[] = []
  const fuzzy: SkillView[] = []
  for (const skill of skills) {
    if (skill.name.toLowerCase().includes(needle)) contains.push(skill)
    else fuzzy.push(skill)
  }
  return [...contains, ...fuzzy]
}

/** 集合候选(第一级);仅当集合内仍有启用技能时才出现。 */
function bundleCandidate(snapshot: ResolvedSnapshot, bundle: BundleView): { name: string; description: string; value: string } | null {
  const enabledCount = skillsOf(snapshot, bundle.id).length
  if (enabledCount === 0) return null
  return {
    name: bundle.name,
    description: `${String(enabledCount)} 个技能`,
    value: `${BUNDLE_MARK}${bundle.id}`,
  }
}

/**
 * 注册技能 slash 源与 SkillRow 工具行。
 * @param ctx - client root context。
 */
export function apply(ctx: ClientContext): void {
  rootCtx = ctx
  ctx.effect(() => {
    return () => { if (rootCtx === ctx) rootCtx = undefined }
  }, 'skill-source: root ctx capture')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-source: dictionaries')
  injectSkillRowStyles()
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'skill', locale: NS },
    SkillRow,
  ))

  /*
   * 技能引用着色(用户 2026-10-19 反馈「/指令发送之后没有颜色了」)。
   *
   * 内核 ui-skill 被整块禁用后,它负责的两块也一起没了:UserText 匹配规则
   * + `conversation.user.text.node` 的 skill chip。这里补回来(见 reference.tsx)。
   *
   * **必须在 inputTriggers 的早退之前**:着色与 slash 菜单是两条独立链路,
   * 菜单源注册失败(比如内核 ui-skill 又启用了)不该连带把着色也丢掉。
   */
  try { applySkillReference(ctx) } catch (error) {
    console.warn('[skill-source] 技能引用着色挂载失败:', error)
  }

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (inputTriggers === undefined) {
    console.warn('[skill-source] inputTriggers 服务不可用,技能 slash 源未注册')
    return
  }

  /*
   * slash 候选文案要跟着语言走,所以在这里 bind 一次 `skill` 命名空间。
   * 不能图省事写死中文:候选名是**过滤键**(见下方 loose 行的前缀匹配),
   * 写死中文会让英文界面下按 'Loose' 过滤不出任何东西。
   *
   * 之前这里是硬编码字符串 `'散装技能'`,借修 bug 一并收进字典。
   */
  const t = ctx.locale.bind(NS)

  const source: InputTriggerSource = {
    trigger: '/',
    name: 'skill',
    order: 2,
    async candidates(session: ClientSessionContext, req: CandidateRequest) {
      let snapshot: ResolvedSnapshot
      try {
        snapshot = await fetchSnapshot(session.sessionId)
      } catch {
        return []
      }
      if (req.signal.aborted) return []
      const level = parseLevelQuery(req.query)
      if (level !== null && skillsOf(snapshot, level.bundleId).length > 0) {
        // 第二级:已进入某集合,展示该集合下启用技能(可按冒号后文本过滤)。
        return skillsOf(snapshot, level.bundleId)
          .filter(skill => skill.name.startsWith(level.rest))
          .map(skillCandidate)
      }
      /*
       * 第一级 · 直接匹配技能(用户报的「必须先输入技能包才能选到技能」就是
       * 这里补上的):打了任何字符就按内核同一套 `rankByName` 在全部启用技能里
       * 匹配,命中的技能排在集合行**前面**,选中即落地 `/name `。
       *
       * 空 query(`/` 刚打出来)刻意不铺技能:一屏技能会把集合与指令挤走,
       * 首屏保持「先挑包,或接着打字直达技能」。
       */
      const matchedSkills: InputTriggerCandidate[] = matchedSkillCandidates(snapshot, req.query)
        .map((candidate) => ({ ...candidate, section: t('menu.skill') }))
      // 第一级:集合列表(可按 query 过滤集合名;空集合自动隐藏)。
      const bundles: InputTriggerCandidate[] = snapshot.bundles
        .filter(bundle => bundle.name.startsWith(req.query) || bundle.id.startsWith(req.query))
        .map(bundle => bundleCandidate(snapshot, bundle))
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .map(candidate => ({ ...candidate, section: t('menu.bundle') }))
      /*
       * 散装技能这一行**必须和下面的集合走同一个 query 过滤器**。
       *
       * 这里踩过一个很隐蔽的坑:早先它是无条件 push 的,理由是「散装技能不是
       * 某个 bundle,没有名字可过滤」。后果是**任何**跟技能无关的 `/xxx` 输入
       * 都会在菜单里留下一行「散装技能」并默认高亮 —— 而菜单开着时回车会被
       * 菜单吃掉(arbitrate 的 enter 分支:有高亮就 pick),于是草稿被替换成
       * `/_loose:`(onPick 的 `{ text: '/id:' , continue: true }`),消息根本
       * 没发出去,输入框里还多了个莫名其妙的 `/_loose:`。
       *
       * 实测触发路径:中文输入法下打 `/iu象棋`(不敲空格)回车 —— 用户看到的是
       * 「发不出去,输入框变成 `/_loose:`」,完全猜不到是技能菜单干的。
       *
       * 现在按同一套前缀规则过滤:无关 query 一律不出候选,菜单无高亮,
       * 回车就正常落到默认发送。
       */
      const looseEnabled = skillsOf(snapshot, LOOSE_ID)
      const looseName = t('loose.title')
      if (looseEnabled.length > 0
        && (looseName.startsWith(req.query) || LOOSE_ID.startsWith(req.query))) {
        bundles.push({
          name: looseName,
          description: t('loose.count', { count: looseEnabled.length }),
          value: `${BUNDLE_MARK}${LOOSE_ID}`,
          section: t('menu.bundle'),
        })
      }
      /*
       * 技能行在前、集合行在后:菜单的分段标题按「与上一行不同」才出现,
       * 顺序反了会先出「技能包」再出「技能」,读起来像两层同名分组。
       */
      return [...matchedSkills, ...bundles]
    },
    warm(session: ClientSessionContext) {
      fetchSnapshot(session.sessionId).catch(() => {})
    },
    lexicon(session: ClientSessionContext) {
      const entry = fetches.get(session.sessionId)
      return entry?.settled === undefined ? undefined : allSkillNames(entry.settled)
    },
    subscribeLexicon(session: ClientSessionContext, listener: () => void) {
      const key = session.sessionId
      const listeners = lexiconListeners.get(key) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(key)
      }
    },
    onPick({ candidate }) {
      const value = candidate.value ?? ''
      if (value.startsWith(BUNDLE_MARK)) {
        // 选中集合 → 落地 `/id:` 并保持菜单打开,进入第二级。
        const bundleId = value.slice(BUNDLE_MARK.length)
        return { text: `/${bundleId}:`, continue: true }
      }
      // 选中技能 → 落地 `/name `(与内核 ui-skill 一致的 plain-text 引用路径)。
      return { text: `/${candidate.name} ` }
    },
  }

  ctx.effect(() => {
    // 若 web profile 尚未禁用内核 ui-skill(同名 /skill 源),注册会抛错;
    // 捕获后仅降级(不注册 slash 源),SkillRow 工具行等其余功能不受影响。
    let unregister: (() => void) | undefined
    try {
      unregister = inputTriggers.registerSource(source)
    } catch (error) {
      console.warn('[skill-source] /skill 源注册失败(可能内核 ui-skill 仍激活):', error)
    }
    return () => {
      if (unregister !== undefined) unregister()
      for (const key of [...fetches.keys()]) {
        fetches.get(key)?.abort.abort()
        fetches.delete(key)
      }
      lexiconListeners.clear()
    }
  }, 'skill-source: slash source')
}
