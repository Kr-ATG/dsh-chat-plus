/**
 * 「模型供应商」右详情：一个提供方的编辑卡片，覆盖三种目标：
 * - `edit`：已配置行——从用户层 profile 起稿，保存走最小路径 ops；
 * - `adopt`：目录预设行——未配置但适配器已发货，同样的表单，保存即创建；
 * - `custom`：自定义提供方——适配器不发货的路由，route id 在此被*选择*，
 *   一次性 `settings.mutate` 写入整个 `providers.<route>` profile。
 *
 * 主字段是 write-only 的 **API Key** 输入（本页从不询问环境变量名——键入
 * 的密钥经 `credentials.set` 存入 profile 引用的凭据名，profile 无引用时
 * 派生 `<ROUTE>_API_KEY`；pi-ai profile 仅在键入密钥时把派生名记为
 * `apiKeyEnv`，留空则物化一个无引用的 profile 走提供方原生认证）。
 * 字段标签右侧的 **替换密钥** 是旁路：只把 profile 已点名的那把钥匙换成新值，
 * 不过 settings.mutate、不碰 revision，用于其他配置都已正确的老提供方换 key。
 * 它走 host 的密钥环（`/api/provider-hub-keys`，见 ./keyring.ts），所以**换 key
 * 不是覆盖**：旧值被存档（最多 4 个槽位），可起名、可一键切回（host 侧交换，
 * 两边都不丢）。页面上永远看不到密钥值，只有短指纹和用户起的名字。
 * 启动环境提供的引用是只读的，按钮随之禁用。
 * 其余字段：显示名称（profile schema 声明了 displayName 才可改——pi-ai 有、
 * llm-deepseek 没有）、baseURL、协议（仅手工声明的 pi-ai 路由）、模型列表
 * （含获取可用模型）。headers 字段按任务约定省略（有安全风险）。
 *
 * 每次编辑都以最小 `settings.mutate` 路径 ops 落在存储的 section 上——卡片
 * 只点名自己能看见的字段，而不是从部分描述符重建整棵子树。
 *
 * 移植自官方 ui-settings-models 的 ProviderEditor.tsx / CustomProviderCard.tsx。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  CredentialView, IApiClient, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  deletePath, getPath, hasPath, nodeAtPath, rehydrateSchema, setPath, validateDraft,
} from '../schema-path'
import {
  ModelListEditor, ensureProviderFieldStyles, inlineCapGroupStyle, inlineCapPillOnStyle, inlineCapPillStyle, modelDrafts, validateModels, PROVIDER_DATA_CHANGED,
} from './ModelListEditor.tsx'
import type { ModelDraft, T } from './ModelListEditor.tsx'
import {
  isProxyMember, proxyKeyOf, proxyTagStyle, setProviderProxied, useProxySnapshot,
} from './proxy.ts'
import type { ProxySnapshot } from './proxy.ts'
import { chatCopy, t as chatT } from './ModelListEditor.tsx'
import { ProviderIcon } from '../provider-icons.tsx'
import { deriveKeyRef, messageOf, protocolChoices } from './store.ts'
import type { ModelsSettingsState } from './store.ts'
import { fingerprintText, slotTitle, useKeyring } from './keyring.ts'

/** 详情卡片的目标模式。 */
export type ChatProviderMode = 'edit' | 'adopt' | 'custom'

/** 详情卡片寻址的一个提供方目标。 */
export interface ChatProviderTarget {
  /** 稳定的提供方路由 id。 */
  provider: string
  /** 人类可读的提供方名。 */
  displayName: string
  /** 配置该提供方的设置命名空间。 */
  settingsNs: string
  /** 从该 section 根到提供方 profile 的路径（空 = 整个 section）。 */
  settingsPath: readonly string[]
  /** 本页惯例引用下可写的凭据名（删除时一并 unset）。 */
  credentialRef?: string
  /** 适配器报告该路由为手工声明（无内建 catalog 条目）。 */
  declared?: boolean
  /** 编辑 / 目录预设创建 / 自定义创建。 */
  mode: ChatProviderMode
}

/** {@link ChatProviderDetail} 的 props。 */
export interface ChatProviderDetailProps {
  /** 当前页面快照（提供命名空间视图与写权限）。 */
  state: ModelsSettingsState
  /** 正在编辑/创建的目标。 */
  target: ChatProviderTarget
  /** wire 面。 */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** 本地化函数；缺省用内置中文字典。 */
  t?: T
  /** 关闭卡片；`changed` 报告是否有提交落地。 */
  onClose: (changed: boolean) => void
}

/** 未知命名空间只渲染提示（与官方 EditorLayout 对齐）。 */
type EditorLayout = 'deepseek' | 'pi-ai' | 'unknown'

/** 官方 DeepSeek 公共端点，作为 deepseek baseURL 的占位。 */
const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** 自定义路由 id 的合法性：小写字母开头，之后小写字母/数字/短横线。 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** 与官方 apiKey.ts 同步的浏览器侧密钥判断。 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

/** 是否被一对匹配引号包裹（粘贴伪影）。 */
function isQuoted(value: string): boolean {
  const first = value[0]
  if (first !== '"' && first !== '\'' && first !== '`') return false
  return value.length > 1 && value.endsWith(first)
}

/**
 * 判断 key 输入当前值：空字段不算失败（每张卡打开时都空，即使已存 key，
 * 空 = 保留旧值）；只有空白是失败（键入的输入绝不静默丢弃）。
 */
function apiKeyFailure(draft: string): 'keyBlank' | 'keyIllegalCharacters' | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value) || isQuoted(value)) return 'keyIllegalCharacters'
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}

/** 用户 section 的一棵子树作为普通草稿对象（缺失 → 空）。 */
function draftAt(namespace: SettingsNamespaceView, path: readonly string[]): Record<string, unknown> {
  const subtree = getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return structuredClone(subtree) as Record<string, unknown>
}

/**
 * 携带 `after` 越过 `before` 的最小路径 ops，两侧都是卡片所见。只有卡片
 * 观察过的键被点名；两侧都缺席的字段不产生 op——这正是路径寻址而非重建
 * section 的意义。
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOpView[] {
  const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
    ? before as Record<string, unknown>
    : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** 拥有命名空间选择的编辑布局。 */
function layoutOf(ns: string): EditorLayout {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

/** 该 profile 解析出的密钥经由的凭据引用。 */
function refFor(namespace: SettingsNamespaceView, path: readonly string[], provider: string): string {
  const profile = getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider)
}

/**
 * 读取 profile 自己点名的凭据引用（`apiKeyEnv`）。没有名字的（提供方走原生
 * 认证，或 profile 尚未物化）返回 `undefined`——「替换密钥」只对这种引用
 * 有意义：改一个没人引用的名字，写完也不会被任何请求读到。
 * @param namespace - 声明 profile 的命名空间视图。
 * @param path - 从 section 根到 profile 的路径。
 * @returns 引用名，或缺省。
 */
function namedKeyRefOf(
  namespace: SettingsNamespaceView | undefined,
  path: readonly string[],
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/**
 * 渲染「模型供应商」右详情。
 * @param props - 目标、快照、wire 面与回调。
 * @returns 详情卡片。
 */
export function ChatProviderDetail(props: ChatProviderDetailProps): ReactNode {
  const { state, target, api, onClose } = props
  const t = props.t ?? chatT
  const namespace = state.namespaces.get(target.settingsNs)

  // 草稿/提交状态在目标切换时整体重置（父组件也可用 key 强制 remount）。
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    namespace === undefined ? {} : draftAt(namespace, target.settingsPath))
  const [committedOriginal, setCommittedOriginal] = useState<unknown>(() =>
    namespace === undefined ? undefined : getPath(namespace.user, target.settingsPath))
  const [expectedRevision, setExpectedRevision] = useState(() => namespace?.revision ?? 0)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<CredentialView | undefined>(undefined)
  // 「替换密钥」内联面板：只写凭据（host 密钥环入环），不触碰 profile 其他字段。
  const [replacing, setReplacing] = useState(false)
  const [replaceDraft, setReplaceDraft] = useState('')
  const [replaceName, setReplaceName] = useState('')
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [replaceDone, setReplaceDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)

  // 展开编辑 UI 的共享伪类样式（focus/placeholder/hover/disabled）。
  useEffect(() => { ensureProviderFieldStyles() }, [])

  // 自定义创建模式专用字段。
  const [route, setRoute] = useState('')
  const [customName, setCustomName] = useState('')
  const [customBaseURL, setCustomBaseURL] = useState('')
  const [customProtocol, setCustomProtocol] = useState('')
  const [customModels, setCustomModels] = useState<readonly ModelDraft[]>([])
  /** 创建模式的 profile 写入已落地；只有 key 写入可能还挂着。 */
  const [committed, setCommitted] = useState(false)

  useEffect(() => {
    setDraft(namespace === undefined ? {} : draftAt(namespace, target.settingsPath))
    setCommittedOriginal(namespace === undefined ? undefined : getPath(namespace.user, target.settingsPath))
    setExpectedRevision(namespace?.revision ?? 0)
    setKeyDraft('')
    setKeyState(undefined)
    setReplacing(false)
    setReplaceDraft('')
    setReplaceName('')
    setReplaceError(null)
    setReplaceDone(false)
    setFailure(undefined)
    setSaved(false)
    setDeleteArmed(false)
    setBusy(false)
    setRoute('')
    setCustomName('')
    setCustomBaseURL('')
    setCustomProtocol('')
    setCustomModels([])
    setCommitted(false)
    // 目标身份由 provider + settingsNs + path + mode 决定；命名空间从「加载中」
    // 变为可用时也需重新起稿（首帧 namespace 可能还没到）。
    //
    // ⚠ 绝不能把 namespace.revision 放进依赖：任何后台 settings 写入（另一张卡
    // 保存、Developer Role 一键检测、推理等级检测自动落盘）都会推 revision，
    // 卡片会在用户打字途中把 keyDraft / baseURL / 模型草稿整体清空；自定义创建
    // 模式更致命——committed 被重置回 false 后重试会重跑 mutate，携带已被自己
    // 那次写入取代的 revision，必得 settings-conflict，密钥再也存不进去。
    // 陈旧基线由下面的「基线重挂」effect 维护，不必清空草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.provider, target.settingsNs, target.settingsPath.join('/'), target.mode, namespace === undefined])

  // 基线重挂：后台写入推高 revision 后（本卡的推理等级检测就会 host 侧落盘），
  // 只把写入基线换成最新的用户层子树与 revision，草稿一字不动——否则保存必得
  // settings-conflict，而重置草稿又会吞掉用户已键入的内容。
  const rebasedAt = useRef<number | undefined>(undefined)
  useEffect(() => {
    const revision = namespace?.revision
    if (revision === undefined) return
    if (rebasedAt.current === undefined) { rebasedAt.current = revision; return }
    if (rebasedAt.current === revision) return
    rebasedAt.current = revision
    setExpectedRevision(revision)
    setCommittedOriginal(getPath(namespace!.user, target.settingsPath))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace?.revision])

  const layout = layoutOf(target.settingsNs)
  const root = useMemo(() => namespace === undefined ? undefined : rehydrateSchema(namespace.schema), [namespace])
  const node = useMemo(() => namespace !== undefined && root !== undefined
    ? nodeAtPath(root, target.settingsPath)
    : undefined, [root, namespace, target.settingsPath])
  const fallback = namespace === undefined ? undefined : getPath(namespace.value, target.settingsPath)
  const disabled = !state.writable || busy
  // 命名空间缺失时（加载中）退化为惯例引用；describe 未知引用返回 unconfigured，无害。
  const keyRef = target.mode === 'custom'
    ? deriveKeyRef(route.length > 0 ? route : target.provider)
    : namespace === undefined
      ? deriveKeyRef(target.provider)
      : refFor(namespace, target.settingsPath, target.provider)
  // profile 真正点名的引用：只有它才能被「替换密钥」——派生名无人引用时，
  // 写进去也只是一个没人读的孤儿密钥。
  const namedKeyRef = target.mode === 'edit' ? namedKeyRefOf(namespace, target.settingsPath) : undefined
  // keyLocked 必须算在 keyring/useState 之前：下面的 useKeyring 要靠它决定这个
  // 引用到底可不可写（env 只读时既不给换、也不把密钥环拉起来）。
  const keyLocked = keyState?.writable === false
  // 「替换密钥」入口：profile 点了名，且那把钥匙不是启动环境只读提供的。
  const canReplaceKey = namedKeyRef !== undefined && keyLocked !== true
  // 密钥环常驻：只要这个引用可管就拉一次（字段标签行的快捷切换胶囊要用它），
  // 不再等用户打开面板。ref 变化由 hook 自己重拉。
  const keyring = useKeyring(canReplaceKey ? namedKeyRef : undefined)
  // 只有 pi-ai 的 schema 有按路由的协议可供读取；deepseek 整节 profile 跳过。
  const protocols = useMemo(() => layout === 'pi-ai' ? protocolChoices(namespace) : [],
    [layout, namespace],
  )

  // 凭据写入（旋转/切换）后，红点与整页快照都要跟上：reference-updated 会
  // 触发 section 级 reload，这里补一次本地 describe 让圆点立刻变色。
  useEffect(() => {
    if (keyring.state === null || keyring.state.ok !== true) return
    if (namedKeyRef === undefined) return
    void api.credentials.describe({ refs: [namedKeyRef] }).then(
      (response) => {
        if (!response.result.ok) return
        setKeyState(response.result.value.credentials[namedKeyRef])
      },
      () => undefined,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyring.state, namedKeyRef])

  useEffect(() => {
    let stale = false
    setKeyState(undefined)
    // 自定义创建模式不查凭据：路由 id 还在键入中，keyRef 每敲一个字符就变一次，
    // 会按键发一串 credentials.describe；而且新路由必然 unconfigured，那颗红点
    // 只会在创建卡上谎报「API 密钥缺失」。留 undefined = 不显示状态点。
    if (target.mode === 'custom') return () => { stale = true }
    // key 状态只是占位提示，不是编辑前提：业务拒绝或传输失败都不得以未
    // 处理的 rejection 到达浏览器，卡片直接不带「已配置」提示渲染。
    void api.credentials.describe({ refs: [keyRef] }).then(
      (response) => {
        if (stale || !response.result.ok) return
        setKeyState(response.result.value.credentials[keyRef])
      },
      () => undefined,
    )
    return () => { stale = true }
  }, [api.credentials, keyRef, target.mode])

  // 自定义创建的协议默认取适配器报告的第一个选项。
  useEffect(() => {
    if (target.mode === 'custom' && customProtocol === '' && protocols.length > 0) {
      const first = protocols[0]
      if (first !== undefined) setCustomProtocol(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.mode, protocols])

  const stringAt = (source: unknown, key: string): string | undefined => {
    const value = getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setField = (key: string, next: string | undefined): void => {
    // 纯空白不存储：stringAt 已把它报为缺席，否则字段渲染为空而草稿仍把
    // 空格带进 settings.yaml，两个适配器都会把该非空串当真值。
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined ? deletePath(current, [key]) : setPath(current, [key], value))
  }

  // 供应商显示名是否可改，按 schema 说话：pi-ai 的 profile 有 displayName 字段，
  // llm-deepseek 没有（名字由适配器硬编码），写进去只会被 Host 拒成一条看不懂的报错。
  const nameWritable = target.mode !== 'custom'
    && root !== undefined
    && nodeAtPath(root, [...target.settingsPath, 'displayName']) !== undefined
  const nameDraft = stringAt(draft, 'displayName') ?? ''
  // 标题跟着正在键入的值走：改名是「改哪个说哪个」，不必先保存才看得到。
  const shownName = nameDraft.length === 0 ? target.displayName : nameDraft
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const modelFailure = validateModels(target.mode === 'custom' ? customModels : getPath(draft, ['models']))
  const keyFailure = apiKeyFailure(keyDraft)

  /**
   * 字段标签行的快捷切换条目：活动位 + 全部已配置存档。slot 0 = 活动位。
   * 名字优先（入库/改名时起的），没起名退回指纹——一串「未命名」在有多把钥匙
   * 时毫无分辨度，指纹至少能对上「刚才换的是哪把」。
   */
  const quickSwitchKeys = useMemo(() => {
    const ring = keyring.state
    if (ring === null || ring.ok !== true) return []
    const entries: { slot: number; title: string; ref: string; active: boolean }[] = []
    if (ring.active.configured) {
      entries.push({
        slot: 0,
        title: ring.active.label ?? fingerprintText(ring.active.fingerprint),
        ref: ring.ref,
        active: true,
      })
    }
    for (const slot of ring.slots) {
      if (!slot.configured) continue
      entries.push({
        slot: slot.slot,
        title: slot.label ?? fingerprintText(slot.fingerprint),
        ref: slot.ref,
        active: false,
      })
    }
    return entries
  }, [keyring.state])
  // 键入的 key 去掉粘贴空白；空白字段产出空串，两个调用点都读作「未提供 key」。
  const keyValue = keyDraft.trim()
  const shownKeyFailure = keyFailure

  /** 表单当前显示的内容，即询问必须携带的：编辑过但未保存的端点，键入未存的 key。 */
  const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api')
  const probeBaseURL = target.mode === 'custom'
    ? (customBaseURL.length > 0 ? customBaseURL : undefined)
    : stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL')
  const probe = {
    settingsNs: target.settingsNs,
    // 命名路由让能描述它的适配器从自己的注册表作答。
    provider: target.mode === 'custom' ? undefined : target.provider,
    ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
    ...probeApi === undefined ? {} : { api: probeApi },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue },
  }

  /** 编辑/预设创建的提交，返回失败消息或 undefined。 */
  const applyOnce = async (): Promise<string | undefined> => {
    const ns = target.settingsNs
    // pi-ai profile 只在要存 key 时命名惯例引用；否则保持提供方原生认证路径。
    const next = layout === 'pi-ai' && stringAt(draft, 'apiKeyEnv') === undefined
      && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
      ? setPath(draft, ['apiKeyEnv'], keyRef)
      : draft
    if (modelFailure !== undefined) {
      return `${chatCopy.modelId} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`
    }
    if (node !== undefined && target.settingsPath.length === 0) {
      const sectionError = validateDraft(node, next)
      if (sectionError !== undefined) return sectionError
    }
    const materializesNativeProfile = layout === 'pi-ai'
      && fallback === undefined
      && committedOriginal === undefined
      && Object.keys(next).length === 0
    const ops: SettingsPathOpView[] = materializesNativeProfile
      ? [{ op: 'set', path: [...target.settingsPath], value: {} }]
      : pathOps(target.settingsPath, committedOriginal, next)
    // 密钥先落。写反了（先 mutate 再存 key）时，key 失败会让用户看到「保存失败」
    // 却已经把 baseURL/模型改动写进了 settings——错误提示与实际落盘状态不符。
    // 先存密钥则最坏只是「密钥存了、配置没存」，重试一次即可，语义可解释。
    if (keyValue.length > 0) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    if (ops.length > 0) {
      const response = await api.settings.mutate({ ns, ops, expectedRevision })
      if (!response.result.ok) {
        return response.result.error.code === 'settings-conflict'
          ? chatCopy.conflict
          : response.result.error.message
      }
      setCommittedOriginal(getPath(response.result.value.user, target.settingsPath))
      setExpectedRevision(response.result.value.revision)
      setDraft(next)
    }
    setKeyDraft('')
    return undefined
  }

  /** 自定义创建的提交，返回失败消息或 undefined。 */
  const createOnce = async (): Promise<string | undefined> => {
    const keyRefForRoute = deriveKeyRef(route)
    const storesKey = keyValue.length > 0
    if (!committed) {
      const profile = {
        ...customName.length === 0 ? {} : { displayName: customName },
        // 与编辑卡一致：只有要存 key 时命名惯例引用，留空保持原生认证。
        ...storesKey ? { apiKeyEnv: keyRefForRoute } : {},
        api: customProtocol,
        baseURL: customBaseURL,
        models: customModels.map(model => ({ ...model })),
      }
      const response = await api.settings.mutate({
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: ['providers', route], value: profile }],
        // `taken` 也是快照，id 检查看不到卡打开后才声明的路由；revision
        // 让该竞争变成 settings-conflict 而不是覆盖别人整个 profile。
        expectedRevision: expectedRevision,
      })
      if (!response.result.ok) return response.result.error.message
      // 提供方已存在。key 写入失败后的重试不得重跑这次 mutate：它持有的
      // revision 已被本次写入取代，Host 会答 settings-conflict，key 将永远
      // 无法从这张卡存进去。
      setCommitted(true)
    }
    if (storesKey) {
      const stored = await api.credentials.set({ ref: keyRefForRoute, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    return undefined
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = target.mode === 'custom' ? await createOnce() : await applyOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      setSaved(true)
      // 兜底广播：composer 的模型选择器监听此事件强制重读目录。正常情况
      // host 的 settings/document-updated 推送已让 ui-model-selection 刷新；
      // 事件流丢帧时（长会话偶发）这里是唯一能让新模型立刻出现的通道。
      window.dispatchEvent(new CustomEvent(PROVIDER_DATA_CHANGED))
      onClose(true)
    } catch (error) {
      // 传输失败 reject 而非作答；不捕获卡片会永远 busy 且无任何错误。
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  /** 删除已配置 profile（凭据先删，第二步失败则行仍可见、操作可安全重试）。 */
  const removeOnce = async (): Promise<string | undefined> => {
    try {
      if (target.credentialRef !== undefined) {
        const credential = await api.credentials.unset({ ref: target.credentialRef })
        if (!credential.result.ok) return credential.result.error.message
      }
      const response = await api.settings.mutate({
        ns: target.settingsNs,
        ops: [{ op: 'unset', path: [...target.settingsPath] }],
      })
      if (!response.result.ok) return response.result.error.message
      // 与保存同理：广播让模型选择器立即重读目录（路由已减少）。
      window.dispatchEvent(new CustomEvent(PROVIDER_DATA_CHANGED))
    } catch (error) {
      return messageOf(error)
    }
    onClose(true)
    return undefined
  }

  /**
   * 「替换密钥」：只把 profile 引用的那把钥匙换成新值。与表单的「保存」分工
   * 明确——保存是 profile + 密钥一起落盘，这里只动凭据，因此不经过
   * settings.mutate、不碰 revision、也不要求改名/改地址先存盘。
   *
   * 走 keyring（host 侧入环而非覆盖）：旧值进存档槽位，之后可一键切回。
   * 凭据引用是每请求解析的，写入成功后下一个请求即用新密钥。
   */
  const replaceKey = async (): Promise<void> => {
    const value = replaceDraft.trim()
    // 空字段在本流里是失败而非「保持不变」：这个按钮的意义就是换一把新钥匙。
    if (value.length === 0) { setReplaceError(chatCopy.keyBlank); return }
    const illegal = apiKeyFailure(value)
    if (illegal !== undefined) { setReplaceError(t(illegal)); return }
    const ok = await keyring.rotate(value, replaceName.trim())
    if (!ok) return
    // 状态点与密钥环都由各自的 hook/事件刷新；这里只收 UI。
    // 面板故意不关：刚入环的旧钥匙和起了名的新钥匙都在这里，关掉就看不见了。
    setReplaceDraft('')
    setReplaceName('')
    setReplaceDone(true)
  }

  const confirmDelete = (): void => {
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    setBusy(true)
    setFailure(undefined)
    void removeOnce().then((outcome) => {
      if (outcome !== undefined) {
        setFailure(outcome)
        setDeleteArmed(false)
      }
    }).finally(() => { setBusy(false) })
  }

  if (namespace === undefined || root === undefined) {
    return <p style={errorStyle}>{`${target.provider}: 命名空间 ${target.settingsNs} 不可用`}</p>
  }
  if (node === undefined && target.mode !== 'custom') {
    // 目录条目寻址到 schema 无法解析的位置是 Host 侧不一致；显示胜过空白卡。
    return <p style={errorStyle}>{`${target.provider}: unresolvable settings path`}</p>
  }

  /** 用户层之下的目录：组合入口钉住的，或 schema 默认（resolve 会供应）。 */
  const inheritedModels = (): unknown => {
    const pinned = getPath(namespace.base, [...target.settingsPath, 'models'])
    return pinned ?? nodeAtPath(root, [...target.settingsPath, 'models'])?.meta.default
  }

  const modelsOverridden = hasPath(draft, ['models'])
  const models = target.mode === 'custom'
    ? customModels
    : modelDrafts(modelsOverridden ? getPath(draft, ['models']) : inheritedModels())

  const keyPlaceholder = keyLocked
    ? chatCopy.keyEnvLocked
    : keyState?.configured === true
      ? chatCopy.keyStored
      : chatCopy.keyPlaceholder
  const canRemove = target.mode === 'edit'
    && state.rows.find(row => row.entry.provider === target.provider)?.removable === true

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route)
  const routeTaken = route.length > 0 && state.rows.some(row => row.entry.provider === route)
  // 代理开关：只给已配置的 pi-ai 家（宿主只按 llm-pi-ai providers 表解析域名）。
  const proxySnapshot = useProxySnapshot()
  const proxyKey = target.mode === 'edit' ? proxyKeyOf(target) : undefined
  const isThisProxied = proxyKey ? isProxyMember(proxySnapshot, proxyKey) : false
  const customReady = target.mode === 'custom'
    && route.length > 0 && !routeInvalid && !routeTaken
    && customBaseURL.length > 0 && customProtocol.length > 0
    && customModels.length > 0 && modelFailure === undefined
    && keyFailure === undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {target.mode === 'custom'
            ? (
              <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, #1f2329)' }}>
                {chatCopy.addCustom}
              </span>
            )
            : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <ProviderIcon provider={target.provider} name={shownName} size={18} />
                {nameWritable
                  ? (
                    /* 标题即重命名入口：点一下聚焦到下方「显示名称」框（hover 浮出铅笔）。 */
                    <button
                      type="button"
                      className="dsh-webui-name-title"
                      title={chatCopy.renameProvider}
                      aria-label={chatCopy.renameProvider}
                      onClick={() => {
                        nameInputRef.current?.focus()
                        nameInputRef.current?.select()
                      }}
                    >
                      <span style={nameTextStyle}>{shownName}</span>
                      <IconPencil />
                    </button>
                  )
                  : <span style={nameTextStyle}>{shownName}</span>}
              </span>
            )}
          {target.mode !== 'custom' && target.provider !== shownName
            ? <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8f959e)' }}>{target.provider}</span>
            : null}
          {isThisProxied
            ? <span style={proxyTagStyle} title="走代理">P</span>
            : null}
          {saved ? <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-success-primary, #00b42a)' }}>{chatCopy.saved}</span> : null}
        </div>

        {/* 右侧代理开关 */}
        {proxyKey !== undefined ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #8f959e)' }}>走代理</span>
            <div className="dsh-cap-group" style={inlineCapGroupStyle}>
              <button
                type="button"
                className="dsh-cap-pill"
                aria-pressed={isThisProxied}
                style={isThisProxied ? inlineCapPillOnStyle : inlineCapPillStyle}
                disabled={disabled}
                onClick={() => {
                  if (!isThisProxied) void setProviderProxied(proxyKey, true)
                }}
                title="该供应商走代理转发"
              >
                是
              </button>
              <button
                type="button"
                className="dsh-cap-pill"
                aria-pressed={!isThisProxied}
                style={!isThisProxied ? inlineCapPillOnStyle : inlineCapPillStyle}
                disabled={disabled}
                onClick={() => {
                  if (isThisProxied) void setProviderProxied(proxyKey, false)
                }}
                title="该供应商直连"
              >
                否
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {layout === 'unknown' && target.mode !== 'custom'
        ? <p style={hintStyle}>{`其他字段在 settings.yaml 中（${target.settingsNs}）`}</p>
        : null}

      {target.mode === 'custom'
        ? (
          <>
            <Field label={chatCopy.providerId}>
              <input
                className="dsh-webui-field"
                style={inputStyle}
                type="text"
                value={route}
                placeholder="acme-gateway"
                aria-label={chatCopy.providerId}
                disabled={disabled || committed}
                onChange={(event) => { setRoute(event.target.value) }}
              />
            </Field>
            {routeInvalid || routeTaken
              ? <p style={errorStyle}>{t(routeInvalid ? 'providerIdInvalid' : 'providerIdTaken')}</p>
              : <p style={hintStyle}>{chatCopy.providerIdHint}</p>}
            <Field label={chatCopy.displayName}>
              <input
                className="dsh-webui-field"
                style={inputStyle}
                type="text"
                value={customName}
                placeholder={route.length === 0 ? chatCopy.displayName : route}
                aria-label={chatCopy.displayName}
                disabled={disabled || committed}
                onChange={(event) => { setCustomName(event.target.value) }}
              />
            </Field>
          </>
        )
        : null}

      {nameWritable
        ? (
          <Field label={chatCopy.displayName}>
            <input
              ref={nameInputRef}
              className="dsh-webui-field"
              style={inputStyle}
              type="text"
              value={nameDraft}
              placeholder={target.displayName}
              aria-label={chatCopy.displayName}
              disabled={disabled}
              onChange={(event) => { setField('displayName', event.target.value) }}
            />
            <p style={hintStyle}>{chatCopy.displayNameHint}</p>
          </Field>
        )
        : null}

      <Field
        label={chatCopy.keyInput}
        labelExtra={(
          <>
            {keyState === undefined
              ? null
              : (
                <span
                  role="img"
                  aria-label={keyState.configured === true ? chatCopy.credentialConfigured : chatCopy.credentialMissing}
                  title={keyState.configured === true ? chatCopy.credentialConfigured : chatCopy.credentialMissing}
                  style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: keyState.configured === true
                      ? 'var(--dsw-alias-state-success-primary, #00b42a)'
                      : 'var(--dsw-alias-state-error-primary, #d54941)',
                  }}
                />
              )}
            {/* 快捷切换：钥匙的名字直接排在这一行，点一下就地换（不等开面板）。
                只有攒下两把以上才出现——只有一把时这行跟「替换密钥」按钮重复。 */}
            {quickSwitchKeys.length >= 2
              ? quickSwitchKeys.map(entry => (
                <button
                  key={entry.slot}
                  type="button"
                  className="dsh-webui-capsule-btn phub-key-chip"
                  style={entry.active ? keyChipActiveStyle : keyChipStyle}
                  disabled={disabled || keyring.busy || entry.active}
                  aria-pressed={entry.active}
                  title={entry.active
                    ? chatCopy.keyChipActiveTitle
                    : `${chatCopy.keyringSwitchTitle}（${entry.ref}）`}
                  onClick={() => {
                    if (entry.active) return
                    void keyring.switchTo(entry.slot)
                  }}
                >
                  {keyring.busy ? '…' : entry.title}
                </button>
              ))
              : null}
            {canReplaceKey
              ? (
                <button
                  type="button"
                  className="dsh-webui-capsule-btn"
                  style={keyReplaceBtnStyle}
                  disabled={disabled}
                  aria-expanded={replacing}
                  title={chatCopy.replaceKeyTitle}
                  onClick={() => {
                    setReplacing(current => !current)
                    setReplaceError(undefined)
                    setReplaceDone(false)
                  }}
                >
                  {replacing ? chatCopy.cancel : chatCopy.replaceKey}
                </button>
              )
              : null}
          </>
        )}
      >
        <input
          className="dsh-webui-field"
          style={inputStyle}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={keyPlaceholder}
          aria-label={chatCopy.keyInput}
          aria-invalid={shownKeyFailure !== undefined}
          disabled={disabled || keyLocked}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {shownKeyFailure === undefined
          ? null
          : <p style={errorStyle}>{t(shownKeyFailure === 'keyBlank' && target.mode === 'custom' ? 'keyBlankNew' : shownKeyFailure)}</p>}
        {replacing && namedKeyRef !== undefined
          ? (
            <KeyReplacePanel
              refName={namedKeyRef}
              nameDraft={replaceName}
              draft={replaceDraft}
              failure={keyring.error ?? replaceError}
              done={replaceDone}
              disabled={disabled}
              keyring={keyring}
              onNameChange={setReplaceName}
              onDraftChange={setReplaceDraft}
              onSave={() => { void replaceKey() }}
              onCancel={() => { setReplacing(false) }}
            />
          )
          : replaceDone
            ? <p style={{ ...hintStyle, color: 'var(--dsw-alias-state-success-primary, #00b42a)' }}>{chatCopy.replaceKeyDone}</p>
            : null}
      </Field>

      {target.mode === 'custom' || layout !== 'unknown' ? (
        <Field label={chatCopy.baseUrl}>
          <input
            className="dsh-webui-field"
            style={inputStyle}
            type="text"
            value={target.mode === 'custom' ? customBaseURL : stringAt(draft, 'baseURL') ?? ''}
            placeholder={target.mode === 'custom'
              ? 'https://gateway.example/v1'
              : layout === 'deepseek'
                ? DEEPSEEK_PUBLIC_BASE_URL
                : stringAt(fallback, 'baseURL') ?? chatCopy.baseUrlDefault}
            aria-label={chatCopy.baseUrl}
            disabled={disabled}
            onChange={(event) => {
              if (target.mode === 'custom') setCustomBaseURL(event.target.value)
              else setField('baseURL', event.target.value === '' ? undefined : event.target.value)
            }}
          />
        </Field>
      ) : null}

      {target.mode === 'custom' || (target.declared === true && layout === 'pi-ai') ? (
        <Field label={chatCopy.apiProtocol}>
          <select
            className="dsh-webui-field"
            style={selectInputStyle}
            value={target.mode === 'custom' ? customProtocol : probeApi ?? ''}
            aria-label={chatCopy.apiProtocol}
            disabled={disabled}
            onChange={(event) => {
              if (target.mode === 'custom') setCustomProtocol(event.target.value)
              else setField('api', event.target.value === '' ? undefined : event.target.value)
            }}
          >
            {target.mode === 'custom'
              ? null
              : probeApi === undefined
                ? <option value="">{chatCopy.apiProtocolUnset}</option>
                : null}
            {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </Field>
      ) : null}

      {target.mode === 'custom' || layout !== 'unknown' ? (
        <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #dcdfe6)', paddingTop: 10 }}>
          <ModelListEditor
            models={models}
            overridden={modelsOverridden}
            onChange={target.mode === 'custom' ? setCustomModels : (next) => {
              setDraft(current => setPath(current, ['models'], next))
            }}
            onReset={target.mode === 'custom' ? undefined : () => {
              setDraft(current => deletePath(current, ['models']))
            }}
            probe={probe}
            api={api}
            disabled={disabled}
          />
        </div>
      ) : null}

      {failure !== undefined ? <p style={errorStyle}>{failure}</p> : null}
      {modelFailure !== undefined
        ? <p style={errorStyle}>{`${chatCopy.modelId} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}</p>
        : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="dsh-webui-secondary-btn"
          style={secondaryButtonStyle}
          disabled={busy}
          onClick={() => { onClose(false) }}
        >
          {chatCopy.cancel}
        </button>
        {canRemove
          ? (
            <button
              type="button"
              className="dsh-webui-danger-btn"
              style={deleteArmed ? dangerConfirmStyle : dangerButtonStyle}
              disabled={busy}
              onClick={confirmDelete}
            >
              {busy ? chatCopy.deleting : deleteArmed ? chatCopy.confirmDelete : chatCopy.delete}
            </button>
          )
          : null}
        <button
          type="button"
          className="dsh-webui-primary-btn"
          style={primaryButtonStyle}
          disabled={disabled || (target.mode === 'custom' ? !customReady : modelFailure !== undefined || shownKeyFailure !== undefined)}
          onClick={() => { void submit() }}
        >
          {busy ? (target.mode === 'custom' ? chatCopy.creating : chatCopy.saving) : (target.mode === 'custom' ? chatCopy.create : chatCopy.save)}
        </button>
      </div>
    </div>
  )
}

/**
 * 「替换密钥」内联面板 = 密钥环控制台。与上方表单里的密钥框分开，是为了让
 * 「换钥匙」不必连带保存 Base URL / 协议 / 模型草稿——换 key 常常发生在其他
 * 配置都已正确的老提供方上，那时一次全量保存只会多出风险。
 *
 * 语义是**入环**而不是覆盖：粘贴新值 → 旧值进存档槽位（host 侧交换式实现，
 * 见 ./keyring.ts）→ 想回去就点某个槽位的「切回」。页面上只有指纹和用户起
 * 的名字，任何一路响应都不带密钥值。
 * @param props - 引用名、草稿、keyring 句柄与回调。
 * @returns 面板节点。
 */
function KeyReplacePanel(props: {
  /** profile 点名的凭据引用名（读写目标）。 */
  refName: string
  /** 给新钥匙起的名字（入库时一并写下，之后点名字就能切回来）。 */
  nameDraft: string
  draft: string
  failure: string | null
  done: boolean
  disabled: boolean
  keyring: ReturnType<typeof useKeyring>
  onNameChange: (value: string) => void
  onDraftChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}): ReactNode {
  const {
    refName, nameDraft, draft, failure, done, disabled, keyring, onNameChange, onDraftChange, onSave, onCancel,
  } = props
  const busy = keyring.busy
  const ring = keyring.state
  const active = ring?.active
  const slots = (ring?.slots ?? []).filter(slot => slot.configured)
  // 行内改名：slot 0 = 活动位，1..n = 存档；null = 没在改名。
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const commitRename = (slot: number): void => {
    setRenaming(null)
    void keyring.label(slot, renameDraft.trim())
  }

  /** 行内改名输入（Enter 保存 / Esc 取消 / 失焦保存）。 */
  const RenameInput = ({ slot }: { slot: number }): ReactNode => (
    <input
      className="dsh-webui-field"
      style={keyRenameInputStyle}
      type="text"
      autoFocus
      value={renameDraft}
      maxLength={40}
      placeholder={chatCopy.keyringUnnamed}
      aria-label={chatCopy.keyringRenameTitle}
      disabled={busy}
      onChange={(event) => { setRenameDraft(event.target.value) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commitRename(slot) }
        if (event.key === 'Escape') { event.preventDefault(); setRenaming(null) }
      }}
      onBlur={() => { commitRename(slot) }}
    />
  )

  return (
    <div style={keyReplacePanelStyle}>
      <p style={hintStyle}>
        {`${chatCopy.replaceKeyHint} ${refName}${chatCopy.replaceKeyHintTail}`}
      </p>

      {/* 新钥匙：值 + 名字一起给。名字是给这把钥匙起的，不是给输入框起的。 */}
      <Field label={chatCopy.keyringNameInput}>
        <input
          className="dsh-webui-field"
          style={inputStyle}
          type="text"
          value={nameDraft}
          maxLength={40}
          placeholder={chatCopy.keyringNamePlaceholder}
          aria-label={chatCopy.keyringNameInput}
          disabled={busy || disabled}
          onChange={(event) => { onNameChange(event.target.value) }}
        />
      </Field>
      <input
        className="dsh-webui-field"
        style={inputStyle}
        type="password"
        autoComplete="off"
        autoFocus
        value={draft}
        placeholder={chatCopy.replaceKeyInput}
        aria-label={chatCopy.replaceKeyInput}
        aria-invalid={failure !== null}
        disabled={busy || disabled}
        onChange={(event) => { onDraftChange(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || busy || disabled) return
          event.preventDefault()
          onSave()
        }}
      />
      <div style={keyReplaceRowStyle}>
        <button
          type="button"
          className="dsh-webui-primary-btn"
          style={smallPrimaryButtonStyle}
          disabled={busy || disabled}
          onClick={onSave}
        >
          {busy ? chatCopy.replaceKeySaving : chatCopy.replaceKeySave}
        </button>
        <button
          type="button"
          className="dsh-webui-secondary-btn"
          style={smallSecondaryButtonStyle}
          disabled={busy}
          onClick={onCancel}
        >
          {chatCopy.cancel}
        </button>
      </div>
      {failure === null ? null : <p style={errorStyle}>{failure}</p>}
      {done ? <p style={{ ...hintStyle, color: 'var(--dsw-alias-state-success-primary, #00b42a)' }}>{chatCopy.replaceKeyDone}</p> : null}

      {/* 当前在位：名字是「文本 + 铅笔」（复用本卡标题的改名先例），不是一个大按钮。 */}
      <div style={keySlotListStyle}>
        <span style={fieldLabelStyle}>{chatCopy.keyringActive}</span>
        <div style={keySlotRowStyle}>
          {renaming === 0
            ? <RenameInput slot={0} />
            : (
              <button
                type="button"
                className="dsh-webui-name-title"
                style={keyActiveNameStyle}
                title={chatCopy.keyringRenameTitle}
                aria-label={chatCopy.keyringRenameTitle}
                onClick={() => { setRenaming(0); setRenameDraft(active?.label ?? '') }}
              >
                <span style={active?.label == null ? keyActiveNameEmptyStyle : keyActiveNameTextStyle}>
                  {active?.label ?? chatCopy.keyringUnnamed}
                </span>
                <IconPencil />
              </button>
            )}
          <span style={keyFingerprintChipStyle}>{fingerprintText(active?.fingerprint ?? null)}</span>
          {active?.writable === false
            ? <span style={{ ...hintStyle, flex: 'none' }}>{chatCopy.keyringReadOnly}</span>
            : null}
        </div>
      </div>

      {/* 存档区：点名字即一键切回（host 侧交换，两边都不丢）。 */}
      <div style={keySlotListStyle}>
        <span style={fieldLabelStyle}>{chatCopy.keyringSlots}</span>
        {slots.length === 0
          ? <p style={hintStyle}>{chatCopy.keyringEmpty}</p>
          : slots.map(slot => (
            <div key={slot.slot} style={keySlotRowStyle}>
              {/* 名字本身就是切换按钮——这是用户要的「点名字一键替换」。 */}
              {renaming === slot.slot
                ? <RenameInput slot={slot.slot} />
                : (
                  <button
                    type="button"
                    className="dsh-webui-capsule-btn"
                    style={keySlotNameBtnStyle}
                    disabled={busy || disabled}
                    title={`${chatCopy.keyringSwitchTitle}（${slot.ref}）`}
                    onClick={() => { void keyring.switchTo(slot.slot) }}
                  >
                    {busy ? '…' : slotTitle(slot)}
                  </button>
                )}
              <span style={keyFingerprintChipStyle}>{fingerprintText(slot.fingerprint)}</span>
              <button
                type="button"
                className="dsh-webui-capsule-btn"
                style={keySlotBtnStyle}
                disabled={busy || disabled}
                title={chatCopy.keyringRenameTitle}
                onClick={() => { setRenaming(slot.slot); setRenameDraft(slot.label ?? '') }}
              >
                {chatCopy.keyringRename}
              </button>
              <button
                type="button"
                className="dsh-webui-icon-btn-danger"
                style={keySlotBtnStyle}
                disabled={busy}
                title={chatCopy.keyringForgetTitle}
                onClick={() => { void keyring.forget(slot.slot) }}
              >
                {chatCopy.keyringForget}
              </button>
            </div>
          ))}
      </div>
    </div>
  )
}

/**
 * 标题旁的铅笔：默认透明，标题 hover/focus 时淡入并归位
 * （动效规则随 ensureProviderFieldStyles 一起注入）。
 */
function IconPencil(): ReactNode {
  return (
    <svg className="dsh-webui-name-pencil" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M11.1 2.4l2.5 2.5-7.9 7.9-3.2.7.7-3.2 7.9-7.9z"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** 一个字段（label [+ 标签附加节点] + 控件 + 字段级错误）。 */
function Field({ label, labelExtra, children }: { label: string; labelExtra?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* flexWrap：密钥字段的标签行会带状态点 + N 个钥匙胶囊 + 替换按钮，窄栏下必须能换行 */}
      <span style={{ ...fieldLabelStyle, display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 4, gap: 6 }}>
        {label}
        {labelExtra}
      </span>
      {children}
    </div>
  )
}

/* ---------- 内联样式（主题令牌 + fallback） ---------- */

/* 详情卡标题：14/22/500，可截断；可改名时它同时是重命名入口的文字层。 */
const nameTextStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: '22px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
}

/* 官方 .input 规格：32px 高、14px 字、8px 圆角、0 10px 内边距。 */
/* 官方 .input 规格：0.5px border-l4 / radius-md(12px) / 32px / 14-22 / bg-layer-1。
   原自绘版是 1px border-l2 + 8px 圆角，与官方设置页的输入框并排能看出差别。 */
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  padding: '0 10px',
  fontSize: 14,
  lineHeight: '22px',
  font: 'inherit',
  borderRadius: 'var(--dsw-radius-md, 12px)',
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(255,255,255,.2))',
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  outline: 'none',
}

/* 官方 .selectInput：隐藏原生箭头，改用共享 chevron（右 12px 内嵌）。 */
const selectInputStyle: CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  paddingRight: 32,
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  cursor: 'pointer',
  maxWidth: 240,
}

/* 官方 .fieldLabel：12/18、500、secondary。 */
const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
}

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-state-error-primary, #d54941)',
}

/* 「替换密钥」触发器：12px 小胶囊，贴在字段标签右侧，不与状态点抢位。 */
const keyReplaceBtnStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center',
  height: 22, padding: '0 8px', flexShrink: 0,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 11,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
}

/* 快捷切换胶囊（字段标签行）：未选中 = 描边空心；选中 = 品牌色淡底实心，
 * 并禁用点击（再点一下没有意义）。chrome 三件套显式写死，别继承浏览器默认。 */
const keyChipStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center',
  height: 22, padding: '0 10px', flexShrink: 0, maxWidth: 180,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 11,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
  fontFamily: 'inherit', textAlign: 'center',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const keyChipActiveStyle: CSSProperties = {
  ...keyChipStyle,
  border: '1px solid var(--dsw-alias-brand-primary, #4176e6)',
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(65,118,230,0.08))',
  color: 'var(--dsw-alias-brand-primary, #4176e6)',
  cursor: 'default',
}

/* 替换面板：浅底描边小卡，与表单字段区分开——它是旁路操作，不是表单的一段。 */
const keyReplacePanelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  marginTop: 2, padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l3, #e5e6eb)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)',
}

const keyReplaceRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
}

/* 存档区：与上方输入/按钮隔开，一眼看出「这是历史，不是当前配置」。 */
const keySlotListStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  borderTop: '1px dashed var(--dsw-alias-border-l3, #e5e6eb)',
  paddingTop: 8,
}

const keySlotRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
}

/**
 * 活动位的名字按钮。**必须自带浏览器 chrome 重置**（border/background/
 * padding/font/text-align）：只挂 class 而不重置的话，未命中注入规则的那一刻
 * 就是 Chrome 默认按钮——灰底、描边、居中文字，看起来像个坏掉的输入框
 * （线上就是这么翻车的，见 ensureProviderFieldStyles 的 name-title 规则）。
 * 这里与 `.dsh-webui-name-title` 同规格内联一份，双保险。
 */
const keyActiveNameStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center', gap: 4,
  flex: 1, minWidth: 0,
  border: 0, background: 'transparent',
  padding: '1px 4px 1px 6px', marginLeft: -6,
  borderRadius: 6,
  font: 'inherit', textAlign: 'left', color: 'inherit',
  cursor: 'pointer',
}

/* 已起名：主文字色；未起名降为三级色——一眼看出"这把还没名字"，而不是像个值。 */
const keyActiveNameTextStyle: CSSProperties = {
  fontSize: 12, lineHeight: '18px',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
}

const keyActiveNameEmptyStyle: CSSProperties = {
  ...keyActiveNameTextStyle,
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

/* 行内改名输入：24px 高、12px 字，贴合行高不把布局撑跳。 */
const keyRenameInputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%', height: 24, flex: 1, minWidth: 0,
  padding: '0 8px',
  fontSize: 12, lineHeight: '18px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-brand-primary, #4176e6)',
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  outline: 'none',
}

/* 指纹 chip：等宽小字 + 淡底，只作「这是哪把钥匙」的视觉线索，不当主标识。 */
const keyFingerprintChipStyle: CSSProperties = {
  flex: 'none',
  padding: '0 6px',
  borderRadius: 4,
  background: 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
  fontSize: 11, lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

/* 存档行的名字按钮：点它就是一键切换，所以做得比「删除」醒目。 */
const keySlotNameBtnStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center',
  height: 24, padding: '0 10px', flex: '1', minWidth: 0,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 12,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
  fontFamily: 'inherit', textAlign: 'left',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/* 槽位内小按钮：24px 高、12px 字，比主按钮再轻一档。 */
const keySlotBtnStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 24, padding: '0 8px', flexShrink: 0,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 12,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
}

/* 官方 .primaryButton/.secondaryButton/.dangerButton：36px 高、18px 圆角
 * 胶囊、14 字、0 14 内边距；hover 态由注入的 .dsh-webui-*-btn 类提供。 */
const primaryButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  padding: '0 14px',
  fontSize: 14,
  lineHeight: '22px',
  borderRadius: 18,
  border: 'none',
  background: 'var(--dsw-alias-button-primary-fill, #4176e6)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  cursor: 'pointer',
}

const secondaryButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  padding: '0 14px',
  fontSize: 14,
  lineHeight: '22px',
  borderRadius: 18,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  cursor: 'pointer',
}

const dangerButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  padding: '0 14px',
  fontSize: 14,
  lineHeight: '22px',
  borderRadius: 18,
  border: '1px solid var(--dsw-alias-state-error-primary, #d54941)',
  background: 'transparent',
  color: 'var(--dsw-alias-state-error-primary, #d54941)',
  cursor: 'pointer',
}

const dangerConfirmStyle: CSSProperties = {
  ...dangerButtonStyle,
  background: 'var(--dsw-alias-interactive-bg-hover-danger, rgba(213,73,65,0.1))',
}

/* 面板内按钮沿用官方 18px 圆角胶囊规格，降到 28px 高让面板保持轻量。
 * 必须排在 primaryButtonStyle / secondaryButtonStyle 之后：前者 spread 后者，
 * 提前一行读到的是 TDZ（源码里直接 ReferenceError，esbuild 降成 var 后则是
 * 静默拿到 undefined、按钮整体丢样式）。 */
const smallPrimaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  height: 28,
  borderRadius: 14,
  padding: '0 12px',
  fontSize: 12,
  lineHeight: '18px',
}

const smallSecondaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  height: 28,
  borderRadius: 14,
  padding: '0 12px',
  fontSize: 12,
  lineHeight: '18px',
}
