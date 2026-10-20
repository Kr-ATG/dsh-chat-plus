/**
 * dsh-memory 主面板 —— 三栏应用布局（按参考设计图复刻，浅色系）：
 *
 *   ┌────────┬─────────────────────────────────────────────┐
 *   │ 左栏    │ 顶栏：搜索框（⌘K）· 统计 · 关闭                 │
 *   │ 导航    ├─────────────────────────────────────────────┤
 *   │ 项目    │ （筛选行移除：作用域/分类由左栏导航控制）        │
 *   │ 分类    ├──────────────┬──────────────────────────────┤
 *   │ 设置    │ 中栏列表      │ 右栏详情（关联/历史/相关）         │
 *   └────────┴──────────────┴──────────────────────────────┘
 *
 *  - 左栏：全部记忆 / 变更 / 修订 / 回收站 导航 + 项目区 + 分类区 + 底部设置；
 *  - 顶栏：全局搜索（260ms 防抖，⌘K 聚焦）+ 统计（条数·项目·置顶·变更）+ 关闭；
 *  - 中栏列表头：计数 + 排序切换 / 整理 / 多选 / 刷新（多选时换成批量操作），
 *    选中具体项目时项目上下文条（别名 / 清空）出现在列表头下方 —— 自动记忆与
 *    排除注入两个开关 2026-10-18 已迁到「大盘设置」卡片（按工作区逐个列出）；
 *  - 中栏：置顶大卡（星标 + 摘要 + 时间行）+ 时间分组紧凑行，选中蓝描边；
 *  - 右栏：标题 + 标鉴 chips + 重要度卡 + 正文 + 关联信息 + 历史记录 + 相关记忆。
 *
 * 数据加载分片：list/tags 随筛选条件走；changes / revisions / config / summary
 * 各自独立加载，切视图时按需拉取。相关记忆（/related）随选中条目懒加载。
 * 既有能力（编辑 / 移动 / 多选删除 / 整理 / 回滚 / 设置）全部保留。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconEditOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkstreamMarkdown } from './markdown.js'
import type {
  ChangeView,
  MemoryApi,
  MemoryConfigView,
  MemoryEntryView,
  MemoryKind,
  MemoryListResponse,
  MemorySummaryResponse,
  ModelCatalogView,
  ProjectView,
  RevisionView,
} from './api.js'
import { css, ensureStyles } from './styles.js'
import { SettingsTab } from './SettingsTab.js'
import { MemoryHome } from './Home.js'
import { makeT, type MemoryLocaleKey, type MemoryT } from './locales.js'
import { modalStaggerClass } from '../triad-modal-animation.js'
import { ConfirmDialog } from './ConfirmDialog.js'
// 图标已抽到 ./icons.js（纯展示组件，零业务依赖）。
// 这里 re-export 是刻意的：Toggle.tsx / index.ts 历史上从 Panel.js 取 BrainIcon，
// 保持这个出口不变，抽取就是纯粹的内部重构，不牵连任何调用方。
export { BrainIcon, PinIcon } from './icons.js'
import { BrainIcon, PinIcon, BoxIcon, HomeIcon, ClockIcon, HistoryIcon, TrashIcon, EraserIcon, ShieldIcon, CopyIcon, RingOffIcon, LightbulbIcon, GearIcon, SortArrowsIcon, GlobeIcon, FolderIcon, TagIcon, PenIcon, SparkIcon, LayersIcon, VerifiedIcon, CheckMark, PowerIcon } from './icons.js'
import { PshBody, PopoverShell } from '../popover-shell.js'
import { markReadIds, markViewed, readIds } from './Notify.js'

/**
 * 面板视图（左栏导航决定）。
 *
 * 灵魂**不再是这里的子 Tab**（2026-10-05 用户要求「把记忆和灵魂分开两个分类」）：
 * 它曾作为记忆第四层挂在这个面板里，拆分后归工作台的「灵魂」分类独占。
 * 同一个面板留两个入口只会让人困惑「哪个才是真的」，所以这里整块移除，
 * 而不是留一个跳转按钮。
 */
export type MemoryTab = 'home' | 'all' | 'changes' | 'revisions' | 'trash' | 'settings'

/** 时间分组。 */
type GroupKey = 'today' | 'week' | 'earlier' | 'longterm'

/** 面板数据状态。 */
type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: MemoryListResponse }

/** 项目筛选值：all | global | project:<hash>。 */
type ScopeFilter = 'all' | 'global' | `project:${string}`

/** 变更 Tab 的时间范围。 */
type ChangeRange = 'today' | 'all'

/** 变更列表每页渲染条数（全量历史数千条，一次性渲染会冻结渲染进程）。 */
const CHANGE_PAGE = 100

/** 列表排序方向（最近 / 最旧）。 */
type SortDir = 'new' | 'old'

/** 编辑中的条目（含归属范围与元数据，保存时一并提交）。 */
interface EditState {
  entryId: string
  content: string
  tags: string
  scope: 'global' | 'project'
  projectHash: string | null
  importance: number
  pinned: boolean
  kind: MemoryKind
}

/** 移动中的条目。 */
interface MoveState {
  entryId: string
  target: 'global' | 'project'
  project: string
}

/** 相关记忆状态（随选中条目懒加载）。 */
interface RelatedState {
  entryId: string | null
  entries: MemoryEntryView[]
  loading: boolean
}

/** 面板 props。 */
export type MemoryPanelProps = {
  onClose: () => void
  initialTab?: MemoryTab
  embedded?: boolean
  /** 轻量翻译函数（入口经 makeT 提供）。 */
  t?: MemoryT
} & MemoryApi

/** 全部记忆类型（编辑区下拉）。 */
const KINDS: readonly MemoryKind[] = ['identity', 'preference', 'fact', 'decision', 'gotcha', 'session-summary']

/** 记忆类型 → 文案 key。 */
const KIND_LABEL: Record<MemoryKind, MemoryLocaleKey> = {
  identity: 'kindIdentity',
  preference: 'kindPreference',
  fact: 'kindFact',
  decision: 'kindDecision',
  gotcha: 'kindGotcha',
  'session-summary': 'kindSession',
}

/** 主文字色 p% 混透明（2026-10 色彩收敛的数据色板基元）：
 *  分类 / 项目 / kind 的区分改由「同色不同明度」承担，不再一物一色相。 */
const ink = (p: number): string => `color-mix(in srgb,var(--dsw-alias-label-primary) ${p}%,transparent)`

/** 分类圆点色板（按标签名哈希稳定取色；灰阶十档，明暗主题自动跟随）。 */
const DOT_COLORS = [ink(88), ink(78), ink(68), ink(58), ink(50), ink(42), ink(35), ink(29), ink(24), ink(19)] as const

/** 项目图标色板（按项目 hash 哈希稳定取色；灰阶六档）。 */
const PROJ_COLORS = [ink(84), ink(68), ink(54), ink(42), ink(32), ink(24)] as const

/** 条目图标颜色（按 kind 取灰阶档位；与记忆首页 KIND_META 同口径）。 */
const KIND_COLORS: Record<MemoryKind, string> = {
  identity: ink(88),
  preference: ink(72),
  fact: ink(56),
  decision: ink(80),
  gotcha: ink(64),
  'session-summary': ink(46),
}

/** 字符串哈希（稳定取色）。 */
function hashOf(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * 计数紧凑化：4407 → 4.4k。导航徽章里塞四位数会把整行撑变形，
 * 精确值放 title 里，悬停可看。
 */
function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(value)
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(value / 1000)}k`
}

/**
 * 计数徽章（取代「标签 + 裸数字」）。
 *
 * 调用方写 `<CountBadge key={value} … />`：数值一变 React 就重挂载，
 * 顺带重放一次弹跳——整理/删除/新增后计数自己跳一下，不用去盯列表。
 */
function CountBadge({ value, inline = false, hint }: { value: number; inline?: boolean; hint?: string }): JSX.Element {
  const cls = [
    css.navCount,
    css.navCountPop,
    inline ? css.navCountInline : '',
    value === 0 ? css.navCountZero : '',
  ].filter(Boolean).join(' ')
  const exact = `${value.toLocaleString()}${value === 1 ? '' : ''}`
  return <span className={cls} title={hint !== undefined ? `${hint} · ${exact}` : exact}>{formatCount(value)}</span>
}

/**
 * 分类计数（面板本地口径）：只数活跃条目。
 *
 * 不用 host 的 /tags —— 它与 /list 的过滤口径不一致（/list 默认排除已废弃，
 * /tags 不排除），于是出现「踩坑 1」点开却是「共 0 条记忆」。计数由面板已经
 * 拿到的活跃条目集算出，host 半身没重启时也立刻正确。
 */
function countTagsFromEntries(entries: MemoryEntryView[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (entry.deprecated === true) continue
    for (const tagName of entry.tags) counts.set(tagName, (counts.get(tagName) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([tagName, count]) => ({ tag: tagName, count }))
}

/** 用活跃条目集重算项目计数（同口径：已废弃的不算）。 */
function recountProjects(projects: ProjectView[], entries: MemoryEntryView[]): ProjectView[] {
  if (projects.length === 0) return projects
  return projects.map(project => {
    const owned = entries.filter(entry => entry.scope === 'project' && entry.projectHash === project.hash)
    return { ...project, entryCount: owned.length, pinnedCount: owned.filter(entry => entry.pinned).length }
  })
}

/** 分割标签输入（逗号/空格/中文逗号）。 */
function splitTags(raw: string): string[] {
  return raw.split(/[,，\s]+/).map(tag => tag.trim()).filter(Boolean).slice(0, 8)
}

/** 提取条目标题：`【主题】…` 取主题；否则取首个短首行；都没有回退正文前 40 字。 */
function entryTitle(content: string): string {
  const trimmed = content.trim()
  const bracket = trimmed.match(/^【([^】]{1,30})】/)
  if (bracket !== null) return bracket[1].trim()
  const firstLine = (trimmed.split('\n', 1)[0] ?? '').replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s*/, '').trim()
  if (firstLine !== '' && firstLine.length <= 60) return firstLine
  return trimmed.slice(0, 40)
}

/**
 * 命中热度（0-5）：这条记忆被唤醒的频次，用来画卡片左轨的竖条。
 *
 * 数据只有 lastHitAt（最后一次注入命中）与 importance（写入时 10 起步、
 * 每次命中加分、每日衰减），拿不到精确的命中次数。这里用 importance 的
 * 「超出基线部分」做代理：基线 10 分是刚写入，14 分意味着被命中过几次。
 *
 * 为什么不显示次数：host 侧没有这个计数，凭空造一个数字就是假指标。
 * 竖条只表达「相对多寡」，悬停时给的是真实的时间（见 hitHeatTitle）。
 */
function hitHeat(entry: { importance: number; lastHitAt: string | null; pending?: boolean }): number {
  // 待确认条目从未参与过任何上下文，热力恒为 0——这不是「没被用到」，
  // 而是「还没开始」。给 0 比给个中间值诚实。
  if (entry.pending === true) return 0
  if (entry.lastHitAt === null) return 0
  const base = 10
  const bonus = Math.max(0, entry.importance - base)
  // importance 每命中 +hitBonus（默认 1-2），封顶 20 → bonus 上限 10。
  // 除以 2 再夹到 5 档：4 分以上（≈命中 2 次以上）就是满格。
  return Math.max(1, Math.min(5, Math.round(bonus / 2)))
}

/** 热力条的悬停说明（给的是真实时间，不是编造的次数）。 */
function hitHeatTitle(entry: { lastHitAt: string | null; pending?: boolean }): string {
  if (entry.pending === true) return '待确认 · 尚未参与对话'
  if (entry.lastHitAt === null) return '从未被注入到对话中'
  const time = new Date(entry.lastHitAt)
  const days = Math.floor((Date.now() - time.getTime()) / 86_400_000)
  const when = days <= 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`
  return `最近一次被唤醒：${when}`
}

/** 提取列表摘要：去掉标题部分后的纯文本前 ~64 字符。 */
function entrySnippet(content: string): string {
  const trimmed = content.trim()
  const bracket = trimmed.match(/^【([^】]{1,30})】\s*/)
  let rest = trimmed
  if (bracket !== null) rest = trimmed.slice(bracket[0].length).trim()
  else {
    const nl = trimmed.indexOf('\n')
    const firstLine = (trimmed.split('\n', 1)[0] ?? '').trim()
    if (nl !== -1 && firstLine.length <= 60) rest = trimmed.slice(nl + 1).trim()
  }
  const flat = rest.replace(/[#*`>[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim()
  return flat === '' ? trimmed.replace(/\s+/g, ' ').slice(0, 64) : flat.slice(0, 64)
}

/** 相对时间（刚刚 / N 分钟前 / 昨天 / N 天前 / 日期）。 */
function relativeTime(iso: string, now = new Date()): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const diff = now.getTime() - time
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return new Date(time).toLocaleDateString()
}

/** 绝对时间（详情脚注：本地日期 + 时分）。 */
function absoluteTime(iso: string | null): string {
  if (iso === null) return ''
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const date = new Date(time)
  return `${date.toLocaleDateString()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 本地日期 YYYY-MM-DD（「今日记忆」筛选/删除口径，与 host localDate 一致）。 */
function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 按 updatedAt 分组（与 host groupEntries 一致）。 */
function groupEntries(entries: MemoryEntryView[]): Record<GroupKey, MemoryEntryView[]> {
  const groups: Record<GroupKey, MemoryEntryView[]> = { today: [], week: [], earlier: [], longterm: [] }
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const entry of entries) {
    if (entry.layer === 'long') {
      groups.longterm.push(entry)
      continue
    }
    const time = Date.parse(entry.updatedAt)
    if (Number.isNaN(time)) {
      groups.earlier.push(entry)
      continue
    }
    const days = Math.floor((startOfDay - time) / 86_400_000)
    if (days <= 0) groups.today.push(entry)
    else if (days < 7) groups.week.push(entry)
    else groups.earlier.push(entry)
  }
  return groups
}

/** 项目显示名（从 projects 列表按 hash 查；未知 hash 用前缀）。 */
function projectName(hash: string | null, projects: ProjectView[]): string {
  if (hash === null) return ''
  const project = projects.find(candidate => candidate.hash === hash)
  if (project === undefined) return hash.slice(0, 6)
  return project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? hash.slice(0, 6)
}

/** 敏感凭据检测（与 host 过滤规则同源；用于手动添加时的风险提示，不阻断）。 */
const SENSITIVE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/i,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[=:]\s*[^\s,，。；;]{8,}/i,
]

function containsSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * 重要度数值 → 条形百分比（初始 10、命中加分累积封顶 20；20 视为满格）。
 *
 * 满格仍取 20 而不是 10：命中加分能让条目涨到 20，若按 10 折算，
 * 所有「被反复用到」的条目条形会一律顶格、失去区分度。
 */
function importancePercent(importance: number): number {
  if (!Number.isFinite(importance) || importance <= 0) return 0
  return Math.min(100, Math.round((importance / 20) * 100))
}

/** 主面板。 */
export function MemoryPanel({ onClose, initialTab, embedded = false, t = makeT(), ...api }: MemoryPanelProps): JSX.Element {
  ensureStyles()
  // slots 的 inject 函数每次渲染返回新 api 对象；用 ref 固定引用，
  // 否则 load 的 useCallback 依赖 api 每次变化 → useEffect 无限重触发请求风暴。
  const apiRef = useRef(api)
  apiRef.current = api
  const [tab, setTab] = useState<MemoryTab>(initialTab ?? 'home')
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [q, setQ] = useState('')
  // 防抖后的搜索词：list 请求只跟这个走（边打字边请求会打爆 host）。
  const [debouncedQ, setDebouncedQ] = useState('')
  const [tag, setTag] = useState('')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [allTags, setAllTags] = useState<Array<{ tag: string; count: number }>>([])
  // 无筛选的活跃条目集（分类 / 项目计数的本地口径来源）。
  const [activePool, setActivePool] = useState<MemoryEntryView[] | null>(null)
  const [summary, setSummary] = useState<MemorySummaryResponse | null>(null)
  const [changes, setChanges] = useState<ChangeView[]>([])
  const [changeRange, setChangeRange] = useState<ChangeRange>('all')
  // 变更列表分页渲染：全量历史可达数千条（实测 4183 行 / 3.3 万 DOM 节点 /
  // 34 万 px 列表高），一次挂载会把渲染主线程卡死数秒——这正是「点开记忆
  // 卡死」的第二层元凶（入口在有未读时直接跳变更 Tab）。默认 100 条一页。
  const [changeLimit, setChangeLimit] = useState(CHANGE_PAGE)
  /**
   * 修订列表的可见条数。
   *
   * 变更列表早就有分页（CHANGE_PAGE），修订列表却一次性渲染全部 —— 而修订
   * 是每日/每次整理都写一条的，跑几个月就是几百条 DOM，进这个 tab 直接卡。
   * 两个列表在视觉上是同一种东西，行为不该不一致。
   */
  const [revisionLimit, setRevisionLimit] = useState(CHANGE_PAGE)
  const [revisions, setRevisions] = useState<RevisionView[]>([])
  const [editing, setEditing] = useState<EditState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  const [busy, setBusy] = useState(false)
  const [consolidating, setConsolidating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // 手动添加记忆表单。
  const [adding, setAdding] = useState(false)
  const [addContent, setAddContent] = useState('')
  const [addTags, setAddTags] = useState('')
  const [addPinned, setAddPinned] = useState(false)
  const [addScope, setAddScope] = useState<'global' | 'project'>('project')
  const [addProject, setAddProject] = useState('')
  // 主从布局：当前选中的条目。
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 多选删除模式。
  const [selecting, setSelecting] = useState(false)
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  // 运行时配置（设置视图，按需加载）。
  const [config, setConfigState] = useState<MemoryConfigView | null>(null)
  // 项目别名草稿（选中某项目时可改名）。
  const [aliasDraft, setAliasDraft] = useState<string | null>(null)
  // 列表排序方向（最新 / 最旧）。
  const [sortDir, setSortDir] = useState<SortDir>('new')
  // 分类区：是否展开全部标签。
  const [catExpanded, setCatExpanded] = useState(false)
  // 详情：相关记忆 / 历史记录展开。
  const [related, setRelated] = useState<RelatedState>({ entryId: null, entries: [], loading: false })
  const [historyExpanded, setHistoryExpanded] = useState(false)
  // 顶栏搜索框引用（⌘K 聚焦）。
  const searchRef = useRef<HTMLInputElement | null>(null)

  // 当前 tab / 变更范围的最新值（供 mutation 后的刷新决定拉哪些接口）。
  const tabRef = useRef(tab)
  tabRef.current = tab
  const rangeRef = useRef(changeRange)
  rangeRef.current = changeRange

  // 搜索防抖：260ms 内的连续输入合并成一次请求。
  useEffect(() => {
    if (q === debouncedQ) return undefined
    const timer = window.setTimeout(() => { setDebouncedQ(q) }, 260)
    return () => { window.clearTimeout(timer) }
  }, [q, debouncedQ])

  // ⌘K / Ctrl+K：聚焦顶栏搜索（本页挂在 main 槽位，页面在=生效）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setTab(currentTab => (currentTab !== 'all' && currentTab !== 'trash' ? 'all' : currentTab))
        setTimeout(() => { searchRef.current?.focus() }, 0)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [])

  // ── 数据加载（分片：条目 / 概览 / 变更 / 修订 / 配置各自独立）───────

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const current = apiRef.current
    if (options.silent !== true) setState({ status: 'loading' })
    setError('')
    try {
      const scopeParam = scope === 'all' ? undefined : scope === 'global' ? 'global' : 'project'
      const projectParam = scope.startsWith('project:') ? scope.slice('project:'.length) : undefined
      // 当前这次请求本身就是「无筛选」时，list 即条目全集，不必再拉一遍。
      const unfiltered = scopeParam === undefined && projectParam === undefined
        && tag === '' && debouncedQ === ''
      const [list, poolRes] = await Promise.all([
        current.list({
          scope: scopeParam,
          project: projectParam,
          q: debouncedQ !== '' ? debouncedQ : undefined,
          tag: tag !== '' ? tag : undefined,
          includeDeprecated: true,
        }),
        unfiltered ? Promise.resolve(null) : current.list({ includeDeprecated: true }),
      ])
      const pool = (unfiltered ? list.entries : poolRes?.entries ?? []).filter(entry => entry.deprecated !== true)
      setState({ status: 'ready', snapshot: list })
      setActivePool(pool)
      setAllTags(countTagsFromEntries(pool))
    } catch (loadError) {
      setState({ status: 'error' })
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [scope, debouncedQ, tag])

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await apiRef.current.summary())
    } catch {
      // 概览是装饰性信息，失败静默（不遮蔽列表本身的错误）。
    }
  }, [])

  const loadChanges = useCallback(async () => {
    try {
      const response = await apiRef.current.changes('all')
      setChanges(response.changes)
    } catch (changesError) {
      setError(changesError instanceof Error ? changesError.message : String(changesError))
    }
  }, [])

  const loadRevisions = useCallback(async () => {
    try {
      setRevisions((await apiRef.current.revisions()).revisions)
    } catch (revisionsError) {
      setError(revisionsError instanceof Error ? revisionsError.message : String(revisionsError))
    }
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      setConfigState((await apiRef.current.getConfig()).config)
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError))
    }
  }, [])

  /** 运行时配置补丁（设置视图；host 会钳制越界值并回传结果）。 */
  const patchConfig = useCallback(async (patchValue: Partial<MemoryConfigView>) => {
    setError('')
    try {
      const response = await apiRef.current.setConfig(patchValue)
      setConfigState(response.config)
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError))
    }
  }, [])

  /** 恢复引擎默认配置。 */
  const resetConfig = useCallback(async () => {
    setError('')
    try {
      const response = await apiRef.current.resetConfig()
      setConfigState(response.config)
      setNotice(t('settingsReset'))
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError))
    }
  }, [t])

  /** 改动后的静默刷新：条目 + 概览 + 变更 + 修订（计数依赖）。 */
  const refresh = useCallback(async () => {
    await load({ silent: true })
    await loadSummary()
    await loadChanges()
    await loadRevisions()
  }, [load, loadSummary, loadChanges, loadRevisions])

  // 挂载即加载。本页现在挂在官方 main 槽位（keyed），只有被选中时才渲染、
  // 切走即卸载，所以「打开」= 挂载，不再需要 open 依赖。
  useEffect(() => {
    void load()
    void loadSummary()
    void loadChanges()
    void loadRevisions()
  }, [load, loadSummary, loadChanges, loadRevisions])

  // 视图按需加载：设置只在被切到该 Tab 时拉取。
  useEffect(() => {
    if (tab === 'settings') void loadConfig()
  }, [tab, loadConfig])

  /*
   * 有未读变更时直达「变更」Tab，并顺手清掉未读。
   *
   * 这是原侧边栏入口的点击语义（`openPanel(unread.count > 0 ? 'changes' :
   * 'home')` + `markRead()`）。入口改成官方菜单行后那段逻辑没地方挂了，就挪到
   * 页面自己身上：挂载后拉一次未读，有就跳并标记已读，只跳一次（jumpedRef 守
   * 住，用户自己切回「全部」不会被再拽走）。
   *
   * 只拉一次、不轮询：官方菜单行没有角标位（`sidebar.panellist` 只渲染图标 +
   * 文案），常驻轮询已经没有消费方；原先 60s 一次的那条轮询随入口一并去掉。
   */
  const jumpedRef = useRef(false)
  useEffect(() => {
    if (jumpedRef.current) return
    jumpedRef.current = true
    void apiRef.current.changes().then(
      (response) => {
        const seen = readIds()
        if (!response.changes.some(change => !seen.has(change.id))) return
        markReadIds(response.changes.map(change => change.id))
        setTab('changes')
      },
      () => { /* 未读是尽力而为的副产物：拉不到就停在「首页」。 */ },
    )
  }, [])

  // 切项目时清空别名草稿：草稿是「当前选中项目」的编辑态，跟着筛选一起复位。
  useEffect(() => { setAliasDraft(null) }, [scope])

  // 切换范围 / 项目时回到第一页：筛选变了，页码没意义。
  useEffect(() => { setChangeLimit(CHANGE_PAGE) }, [changeRange, scope])

  // 提示语（保存成功等）2.4s 后自动消失。
  useEffect(() => {
    if (notice === '') return undefined
    const timer = window.setTimeout(() => { setNotice('') }, 2400)
    return () => { window.clearTimeout(timer) }
  }, [notice])

  // 相关记忆随选中条目懒加载。
  useEffect(() => {
    if (selectedId === null) {
      setRelated({ entryId: null, entries: [], loading: false })
      return undefined
    }
    let alive = true
    setRelated(prev => ({ ...prev, entryId: selectedId, loading: true }))
    void apiRef.current.related(selectedId, 3)
      .then(response => { if (alive) setRelated({ entryId: selectedId, entries: response.entries, loading: false }) })
      .catch(() => { if (alive) setRelated({ entryId: selectedId, entries: [], loading: false }) })
    return () => { alive = false }
  }, [selectedId])

  // ── 裁决 / 条目操作 ──────────────────────────────────────────────────

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError))
      return
    } finally {
      setBusy(false)
    }
    // 无论成功与否都刷新：清除幽灵条目（已被外部删除/并发丢失的条目），
    // 避免"删除报不存在但面板仍显示"。
    await refresh()
  }

  const handlePin = (entry: MemoryEntryView): void => {
    void run(() => apiRef.current.pin(entry.id, !entry.pinned))
  }

  /**
   * 切换「已确认」状态。
   *
   * 与编辑分开：确认的语义是「用户核对了这条内容，认可它作为长期事实」，
   * 而编辑只是改字。混在一起会让「改个标签」等于「确认」，〔待确认〕标记
   * 从此再不出现——模型也就无法区分自己写的和用户认可过的。
   */
  const handleVerify = (entry: MemoryEntryView): void => {
    void run(() => apiRef.current.verify(entry.id, !entry.verified))
  }

  // ── 主题化确认弹窗（替代 window.confirm：原生对话框样式/标题均不可定制） ──
  interface ConfirmRequest {
    title: string
    message: string
    danger: boolean
    onConfirm: () => void
  }
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  /** 弹出确认；onConfirm 在用户点「确定」时执行（危险操作红钮）。 */
  const askConfirm = (message: string, onConfirm: () => void, danger = false): void => {
    setConfirmRequest({ title: t('confirmTitle'), message, danger, onConfirm })
  }

  /** 启用/禁用单条记忆（禁用=保留但不参与注入与编译）。 */
  const handleEnable = (entry: MemoryEntryView): void => {
    void run(() => apiRef.current.enable(entry.id, entry.disabled))
  }

  const handleDelete = (entry: MemoryEntryView): void => {
    askConfirm(t('deleteConfirm'), () => { void run(() => apiRef.current.deleteEntry(entry.id)) }, true)
  }

  /** 软废弃（retire）：数据保留，退出活跃生命周期。 */
  const handleRetire = (entry: MemoryEntryView): void => {
    askConfirm(t('retireConfirm'), () => { void run(() => apiRef.current.retire(entry.id)) })
  }

  /** 恢复已废弃条目（undo retire）。 */
  const handleRestore = (entry: MemoryEntryView): void => {
    askConfirm(t('restoreConfirm'), () => { void run(() => apiRef.current.restore(entry.id)) })
  }

  /**
   * 确认待确认记忆：清挂起标记 + 置 verified，此后它参与注入与检索。
   *
   * 不弹二次确认：这个动作是可逆的（随时可以 retire / 删除），
   * 而且「确认」本身就是用户点这一下的意图，再问一遍纯属打扰。
   */
  const handleConfirmPending = (entry: MemoryEntryView): void => {
    void run(() => apiRef.current.confirmPending(entry.id))
  }

  /**
   * 拒绝待确认记忆：直接删除。
   *
   * 这里**要**弹确认：它是硬删除（pending 条目没进过任何上下文，留回收站记录只是垃圾），
   * 误点一下内容就没了。确认文案与普通删除区分开，避免用户以为只是「取消挂起」。
   */
  const handleRejectPending = (entry: MemoryEntryView): void => {
    askConfirm(t('rejectConfirm'), () => { void run(() => apiRef.current.rejectPending(entry.id)) }, true)
  }

  /** 复制正文到剪贴板。 */
  const handleCopy = (entry: MemoryEntryView): void => {
    void navigator.clipboard.writeText(entry.content)
      .then(() => { setNotice(t('copyDone')) })
      .catch(() => { setError(t('copyContent')) })
  }

  /** 一键整理（Memory Dream）：当前筛选为某项目时只整理该项目，否则全量。 */
  const handleConsolidate = (): void => {
    askConfirm(t('consolidateConfirm'), () => {
      setConsolidating(true)
      setError('')
      void (async () => {
        try {
          const target: 'all' | 'global' | 'project' = scope === 'global'
            ? 'global'
            : scope.startsWith('project:') ? 'project' : 'all'
          const hash = scope.startsWith('project:') ? scope.slice('project:'.length) : undefined
          const response = await apiRef.current.consolidate(target, hash)
          const changed = response.results.reduce((sum, result) => sum + result.changed, 0)
          // 失败原因走 error 条（role=alert、持久可见），不再把失败误报成「无需整理」；
          // 部分成功（如 global 完成、project 超时）时并存：error=失败原因，notice=完成数。
          const failedResult = response.results.find(result => result.failed !== undefined)
          if (failedResult !== undefined) {
            setError(t('consolidateFailed', { reason: failedResult.failed ?? '' }))
            setNotice(changed > 0 ? t('consolidateDone', { n: changed }) : '')
          } else {
            setError('')
            setNotice(changed > 0 ? t('consolidateDone', { n: changed }) : t('consolidateNoop'))
          }
        } catch (consolidateError) {
          setError(consolidateError instanceof Error ? consolidateError.message : String(consolidateError))
        } finally {
          setConsolidating(false)
          await refresh()
        }
      })()
    })
  }

  // ── 多选删除 ─────────────────────────────────────────────────────────

  const enterSelecting = (): void => {
    closeForms()
    setSelecting(true)
    setCheckedIds(new Set())
  }

  const exitSelecting = (): void => {
    setSelecting(false)
    setCheckedIds(new Set())
  }

  const toggleChecked = (id: string): void => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 提交手动添加记忆（敏感内容确认后走同一入口）。 */
  const commitAdd = (): void => {
    void run(async () => {
      const created = await apiRef.current.remember({
        content: addContent.trim(),
        scope: addScope,
        projectHash: addScope === 'project' ? addProject : undefined,
        tags: splitTags(addTags),
        pinned: addPinned,
        importance: 8,
      })
      setAdding(false)
      setAddContent('')
      setAddTags('')
      setAddPinned(false)
      setAddProject('')
      setNotice(t('addSaved'))
      setSelectedId(created.entry.id)
    })
  }

  const saveAdd = (): void => {
    const content = addContent.trim()
    if (content === '') return
    if (addScope === 'project' && addProject === '') {
      setError(t('selectProject'))
      return
    }
    // 敏感内容风险提示：不阻断，确认后允许保存（用户自担风险）。
    if (containsSensitive(content)) {
      askConfirm(t('sensitiveConfirm'), commitAdd, true)
      return
    }
    commitAdd()
  }

  /** 清空当前选中项目的全部记忆（仅项目层，全局层不动）。 */
  const handleClearProject = (): void => {
    if (!scope.startsWith('project:')) return
    const hash = scope.slice('project:'.length)
    const project = projects.find(candidate => candidate.hash === hash)
    const name = project?.alias ?? project?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? hash
    askConfirm(
      t('clearProjectConfirm', { name, count: project?.entryCount ?? 0 }),
      () => { void run(() => apiRef.current.deleteProject(hash)) },
      true,
    )
  }

  /** 保存项目别名（空串=清除别名，回退目录名）。 */
  const saveAlias = (hash: string, current: string | null): void => {
    if (aliasDraft === null) return
    const next = aliasDraft.trim()
    setAliasDraft(null)
    if (next === (current ?? '')) return
    void run(async () => {
      await apiRef.current.meta(hash, { alias: next })
      setNotice(t('aliasSaved'))
    })
  }

  /** 回滚到某修订版本。 */
  const handleRollback = (revision: RevisionView): void => {
    askConfirm(
      t('rollbackConfirm', { id: revision.id, time: relativeTime(revision.at) }),
      () => { void run(() => apiRef.current.rollback(revision.id)) },
      true,
    )
  }

  const startEdit = (entry: MemoryEntryView): void => {
    setAdding(false)
    setMoving(null)
    setEditing({
      entryId: entry.id,
      content: entry.content,
      tags: entry.tags.join(', '),
      scope: entry.scope,
      projectHash: entry.projectHash,
      importance: entry.importance,
      pinned: entry.pinned,
      kind: entry.kind,
    })
  }

  const saveEdit = (): void => {
    if (editing === null) return
    const content = editing.content.trim()
    if (content === '') {
      setError(t('addContentPlaceholder'))
      return
    }
    void run(async () => {
      const original = state.status === 'ready'
        ? state.snapshot.entries.find(entry => entry.id === editing.entryId)
        : undefined
      const updated = await apiRef.current.update(editing.entryId, {
        content,
        tags: splitTags(editing.tags),
        importance: editing.importance,
        pinned: editing.pinned,
        kind: editing.kind,
      })
      // 归属变更（全局 ⇄ 项目 / 换项目）：update 后条目 id 可能因内容变化而重算，
      // 所以 move 必须用 update 回传的最新 id，而不是编辑开始时的旧 id。
      const moved = original !== undefined
        && (editing.scope !== original.scope
          || (editing.scope === 'project' && editing.projectHash !== original.projectHash))
      let finalId = updated.entry.id
      if (moved) {
        const movedEntry = await apiRef.current.move(finalId, {
          scope: editing.scope,
          projectHash: editing.scope === 'project' && editing.projectHash !== null ? editing.projectHash : undefined,
        })
        finalId = movedEntry.entry.id
      }
      setEditing(null)
      setSelectedId(finalId)
    })
  }

  const startMove = (entry: MemoryEntryView): void => {
    setAdding(false)
    setEditing(null)
    setMoving({
      entryId: entry.id,
      target: entry.scope === 'global' ? 'project' : 'global',
      project: entry.projectHash ?? '',
    })
  }

  const saveMove = (): void => {
    if (moving === null) return
    void run(async () => {
      if (moving.target === 'project' && moving.project.trim() === '') {
        throw new Error(t('selectProject'))
      }
      const moved = await apiRef.current.move(moving.entryId, {
        scope: moving.target,
        projectHash: moving.target === 'project' ? moving.project.trim() : undefined,
      })
      setMoving(null)
      setSelectedId(moved.entry.id)
    })
  }

  // ── 渲染数据 ─────────────────────────────────────────────────────────

  const snapshot = state.status === 'ready' ? state.snapshot : null
  /** 项目列表：计数按活跃条目重算（见 countTagsFromEntries 处的口径说明）。 */
  const projects: ProjectView[] = useMemo(
    () => (activePool === null ? snapshot?.projects ?? [] : recountProjects(snapshot?.projects ?? [], activePool)),
    [snapshot, activePool],
  )
  /** 当前视图的条目集（回收站=只保留已废弃；其余视图=只保留活跃条目）。 */
  const filtered = useMemo(() => {
    const entries = snapshot?.entries ?? []
    return tab === 'trash' ? entries.filter(entry => entry.deprecated === true) : entries.filter(entry => entry.deprecated !== true)
  }, [snapshot, tab])

  /** 排序后的列表：置顶在前；搜索时保持 host 相关度排序。 */
  const ordered = useMemo(() => {
    if (q !== '') return filtered
    const arr = [...filtered]
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      const byTime = b.updatedAt.localeCompare(a.updatedAt)
      return sortDir === 'new' ? byTime : -byTime
    })
    return arr
  }, [filtered, sortDir, q])

  /**
   * 待确认条目：单独成组，排在置顶之前。
   *
   * 为什么置顶之前：置顶是「已知的重要」，待确认是「需要你决定的」——后者更急。
   * 而且待确认条目天然少（只有开启 extractRequireConfirm 后才会产生），
   * 放最上面不会挤占视线。
   */
  const pendingEntries = useMemo(() => ordered.filter(entry => entry.pending === true), [ordered])
  /** 置顶条目（排除待确认：一条待确认的记忆即使被标 pinned 也不该走置顶逻辑，
   *  它还没生效，置顶语义无从谈起）。 */
  const pinned = useMemo(() => ordered.filter(entry => entry.pinned && entry.pending !== true), [ordered])
  const grouped = useMemo(
    () => groupEntries(ordered.filter(entry => !entry.pinned && entry.pending !== true)),
    [ordered],
  )
  // 变更按当前 全部/全局/项目 筛选（chips 选择即时生效）。
  const visibleChanges = useMemo(() => changes.filter(change => {
    if (scope === 'global') return change.scope === 'global'
    if (scope.startsWith('project:')) {
      return change.scope === 'project' && change.projectHash === scope.slice('project:'.length)
    }
    return true
  }).filter(change => {
    if (changeRange === 'today') return change.at.slice(0, 10) === (summary?.today ?? '')
    return true
  }), [changes, scope, changeRange, summary])

  /** 当前页渲染的变更（visibleChanges 的前 changeLimit 条）。 */
  const shownChanges = useMemo(
    () => visibleChanges.slice(0, changeLimit),
    [visibleChanges, changeLimit],
  )

  const groupTitles: Record<GroupKey, string> = {
    today: t('groupToday'),
    week: t('groupWeek'),
    earlier: t('groupEarlier'),
    longterm: t('groupLongterm'),
  }

  // 选中条目：过滤结果变化时若失联则自动落到第一条。
  const detail = useMemo(
    () => filtered.find(entry => entry.id === selectedId) ?? null,
    [filtered, selectedId],
  )
  useEffect(() => {
    if (tab !== 'all' && tab !== 'trash') return
    if (detail === null && filtered.length > 0) setSelectedId(filtered[0]?.id ?? null)
    if (detail === null && filtered.length === 0 && selectedId !== null) setSelectedId(null)
  }, [detail, filtered, tab, selectedId])
  const closeForms = (): void => { setEditing(null); setMoving(null); setAdding(false) }
  const selectEntry = (entry: MemoryEntryView): void => {
    closeForms()
    setSelectedId(entry.id)
    // 记一次浏览：首页「最近浏览」卡的数据源（与「最近更新」区分开）
    markViewed(entry.id)
  }

  // ── 一键删除今日记忆 ──────────────────────────────────────────────────

  /** 今日记忆数（当前范围、未置顶、未废弃；口径与 host /delete-today 一致）。 */
  const todayCount = useMemo(() => {
    const pool = activePool ?? (state.status === 'ready' ? state.snapshot.entries : [])
    const today = localDay(new Date())
    return pool.filter(entry => {
      if (entry.pinned || entry.deprecated === true) return false
      if (scope === 'global' && entry.scope !== 'global') return false
      if (scope.startsWith('project:')
        && !(entry.scope === 'project' && entry.projectHash === scope.slice('project:'.length))) return false
      const time = Date.parse(entry.updatedAt || entry.createdAt)
      return !Number.isNaN(time) && localDay(new Date(time)) === today
    }).length
  }, [activePool, state, scope])

  /** 一键删除今日记忆（跟随当前范围筛选；置顶与已废弃条目保留）。 */
  const handleDeleteToday = (): void => {
    if (todayCount === 0) return
    const target: { scope?: 'global' | 'project'; projectHash?: string } = scope === 'global'
      ? { scope: 'global' }
      : scope.startsWith('project:')
        ? { scope: 'project', projectHash: scope.slice('project:'.length) }
        : {}
    askConfirm(
      t('deleteTodayConfirm', { n: todayCount }),
      () => {
        void run(async () => {
          const response = await apiRef.current.deleteToday(target)
          setNotice(t('deleteTodayDone', { n: response.deleted }))
        })
      },
      true,
    )
  }

  // 多选派生与批量删除（依赖 filtered，须在其后定义）。
  const allChecked = filtered.length > 0 && filtered.every(entry => checkedIds.has(entry.id))
  const toggleAllChecked = (): void => {
    setCheckedIds(allChecked ? new Set() : new Set(filtered.map(entry => entry.id)))
  }
  const deleteChecked = (): void => {
    const ids = [...checkedIds]
    if (ids.length === 0) return
    // 批量路由：一次事务删完再编译一次产物（此前是 N 次 /delete，
    // 每次都重编译一遍全部 md 产物）。
    askConfirm(
      t('deleteSelectedConfirm', { n: ids.length }),
      () => {
        void run(async () => {
          await apiRef.current.deleteBatch(ids)
          exitSelecting()
        })
      },
      true,
    )
  }

  /** 当前条目的变更历史（详情页「历史记录」，按时间倒序）。 */
  const entryChanges = useMemo(() => {
    if (detail === null) return []
    return changes
      .filter(change => change.entryId === detail.id)
      .sort((a, b) => b.at.localeCompare(a.at))
  }, [changes, detail])

  /** 历史行文案：新增=创建；其他直接用 host 摘要（已含前缀）。 */
  const historyDesc = (change: ChangeView): string => {
    if (change.action === 'add') return t('changeCreated')
    const label = changeActionLabel(change.action, t)
    if (change.summary.startsWith(label)) return change.summary
    return `${label}：${change.summary}`
  }

  /** 相关记忆（选中条目匹配时的结果）。 */
  const relatedEntries = useMemo(
    () => (related.entryId !== null && detail !== null && related.entryId === detail.id ? related.entries : []),
    [related, detail],
  )

  /** 左侧分类可见集：默认前 5 + 「更多分类」展开全部。 */
  const visibleCats = useMemo(
    () => (catExpanded ? allTags : allTags.slice(0, 5)),
    [allTags, catExpanded],
  )

  /** 首页仪表盘条目集：活跃池优先（与分类计数同口径），未就绪时回落快照。 */
  const homeEntries = (activePool ?? snapshot?.entries ?? []).filter(entry => entry.deprecated !== true)
  /** 首页导航回调：复用既有 tab/筛选/选中态，不新增数据链路。 */
  const homeNav = {
    goAll: (opts?: { tag?: string; scope?: string; q?: string }): void => {
      if (opts?.tag !== undefined) setTag(opts.tag)
      if (opts?.scope !== undefined) setScope(opts.scope as ScopeFilter)
      if (opts?.q !== undefined) setQ(opts.q)
      setTab('all'); closeForms(); exitSelecting()
    },
    goChanges: (): void => { setTab('changes'); closeForms(); exitSelecting() },
    goSettings: (): void => { setTab('settings'); closeForms(); exitSelecting() },
    goAdd: (prefill?: { content?: string; tags?: string }): void => {
      if (prefill?.content !== undefined) setAddContent(prefill.content)
      if (prefill?.tags !== undefined) setAddTags(prefill.tags)
      setAdding(true); setEditing(null); setMoving(null); setTab('all'); exitSelecting()
    },
    pickEntry: (id: string): void => {
      setSelectedId(id)
      setTab('all')
      closeForms()
      exitSelecting()
      // 首页点条目同样算一次浏览（首页卡片自己也是入口）
      markViewed(id)
    },
  }
  /** 变更导航计数：优先全量 changeCount，旧 host 无该字段时回落 todayChanges。 */
  const changeCount = summary?.changeCount ?? summary?.todayChanges ?? 0
  /** 项目总数：与下面列出的项目行同源（含零记忆的 DSH 工作区）。 */
  const projectTotal = projects.length > 0 ? projects.length : (summary?.projectCount ?? 0)

  // ── 渲染函数 ─────────────────────────────────────────────────────────

  /** 空态占位（图标 + 主文案 + 可选提示 + 可选动作按钮）。 */
  const renderEmpty = (
    text: string,
    hint?: string,
    action?: { label: string; onClick: () => void },
  ): JSX.Element => (
    <div className={css.empty}>
      <span className={css.emptyIcon}><BrainIcon size={26} /></span>
      <span className={css.emptyText}>{text}</span>
      {hint !== undefined && <span className={css.emptyHint}>{hint}</span>}
      {action !== undefined && (
        <Button variant="outline" size="sm" onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  )

  /** 骨架屏（首次加载）。 */
  const renderSkeleton = (): JSX.Element => (
    <div className={css.skeleton} aria-busy="true">
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
    </div>
  )

  /** 条目来源/性质图标（置顶星 > 长期层叠 > 手动笔 > 自动闪光；颜色按 kind）。 */
  const entryIcon = (entry: MemoryEntryView, size = 16): JSX.Element => {
    const color = KIND_COLORS[entry.kind]
    if (entry.pinned) {
      return <span style={{ color: 'var(--m-primary)' }}><PinIcon size={size} filled /></span>
    }
    if (entry.layer === 'long') {
      return <span style={{ color }}><LayersIcon size={size} /></span>
    }
    if (entry.source === 'manual') {
      return <span style={{ color }}><PenIcon size={size} /></span>
    }
    return <span style={{ color }}><SparkIcon size={size} /></span>
  }

  const renderCheck = (entry: MemoryEntryView): JSX.Element => {
    const on = selecting ? checkedIds.has(entry.id) : entry.id === selectedId
    return (
      <span className={`${css.entryCheck}${on ? ` ${css.entryCheckOn}` : ''}`} aria-hidden="true">
        {on && <CheckMark size={11} />}
      </span>
    )
  }

  /** 作用域小徽章（列表行内）。 */
  const renderScopeChip = (entry: MemoryEntryView): JSX.Element => (
    <span className={css.entryChip} title={t('scopeBadgeTitle')}>
      {entry.scope === 'global' ? <GlobeIcon size={9} /> : <FolderIcon size={9} />}
      {entry.scope === 'global' ? t('scopeGlobal') : projectName(entry.projectHash, projects)}
    </span>
  )

  /**
   * 记忆卡片（2026-10 重做的核心）。
   *
   * 与旧实现的结构差异：
   *   · 旧：图标 + 单行标题 + 2 行摘要 + 时间行 —— 一张「文件列表项」。
   *   · 新：左侧竖轨（类型点 + 命中热力条）+ 元信息徽章行 + 3 行正文预览
   *     + 悬浮浮现的操作组 —— 一张「记忆卡」。
   *
   * 热力条是全新信息维度：旧版完全看不出哪些记忆真的在被唤醒、哪些写进去
   * 就再没人用过。它由 lastHitAt 与 importance 推算（见 hitHeat()），
   * 只是可视化，不改任何数据。
   *
   * 为什么外层用 div + role=button 而不是真 <button>：卡片内还有快捷操作，
   * 而 HTML 不允许 button 嵌套 button（浏览器会拆开标签，事件也会错乱）。
   * 键盘可达性由 tabIndex + Enter/Space 处理保住。
   */
  const renderEntryCard = (entry: MemoryEntryView): JSX.Element => {
    const selected = !selecting && entry.id === selectedId
    const isPending = entry.pending === true
    const cls = [
      css.entryCard,
      selected ? css.entryCardSel : '',
      isPending ? css.entryCardPend : '',
    ].filter(Boolean).join(' ')
    return (
      <div
        key={entry.id}
        className={cls}
        data-kind={entry.kind}
        data-pending={isPending ? 'true' : undefined}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => { if (selecting) toggleChecked(entry.id); else selectEntry(entry) }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (selecting) toggleChecked(entry.id)
            else selectEntry(entry)
          }
        }}
      >
        {/* 左轨：类型点 + 命中热力条（记忆被唤醒的频次，纯可视化） */}
        <span className={css.entryRail} aria-hidden="true">
          <span className={css.entryKindDot} />
          <span className={css.entryHeat} title={hitHeatTitle(entry)}>
            <i style={{ ['--h' as string]: String(hitHeat(entry)) }} />
          </span>
        </span>

        <span className={css.entryTop}>
          {selecting && renderCheck(entry)}
          <span className={css.entryIcon}>{entryIcon(entry, 15)}</span>
          {/* title 兜底：长标题被省略号截断后，悬停仍能看到全文 */}
          <span className={css.entryTitleTxt} title={entryTitle(entry.content)}>{entryTitle(entry.content)}</span>
          {isPending && <span className={css.entryPendBadge}>{t('badgePending')}</span>}
          <span className={css.entryImpBadge} title={t('importanceLabel')}>★ {entry.importance.toFixed(1)}</span>
          {renderScopeChip(entry)}
        </span>

        <span className={css.entrySnippet}>{entrySnippet(entry.content)}</span>

        <span className={css.entryFootRow}>
          <span className={css.entryTime}>{relativeTime(entry.updatedAt)}</span>
          <span className={css.entryDot} />
          {entry.tags.length > 0 && (
            <span className={css.entryTags}>
              {entry.tags.slice(0, 3).map(tagName => (
                <span key={tagName} className={css.entryTag}>#{tagName}</span>
              ))}
            </span>
          )}
        </span>

        {renderCardActions(entry)}
      </div>
    )
  }

  /**
   * 卡片内的快捷操作组。
   *
   * 待确认条目常显两组按钮（确认 / 拒绝）—— 它们是这张卡片存在的理由，
   * 藏起来等于让用户去翻菜单；生效条目平时隐藏、悬浮才浮现，避免十几张
   * 卡片挂几十个按钮的视觉噪音。
   *
   * stopPropagation 是必须的：否则点「删除」会先触发外层卡片的「选中条目」，
   * 表现为「删一条，右栏还打开了它」。
   */
  const renderCardActions = (entry: MemoryEntryView): JSX.Element | null => {
    if (selecting) return null
    const isPending = entry.pending === true
    const act = (fn: () => void) => (event: ReactMouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      fn()
    }
    const keyAct = (fn: () => void) => (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation()
        event.preventDefault()
        fn()
      }
    }
    return (
      <span className={css.entryActions}>
        {isPending ? (
          <>
            <span className={css.entryAction + ' ' + css.entryActionPri} role="button" tabIndex={0}
              onClick={act(() => { handleConfirmPending(entry) })} onKeyDown={keyAct(() => { handleConfirmPending(entry) })}>
              {t('confirmPending')}
            </span>
            <span className={css.entryAction + ' ' + css.entryActionDanger} role="button" tabIndex={0}
              onClick={act(() => { handleRejectPending(entry) })} onKeyDown={keyAct(() => { handleRejectPending(entry) })}>
              {t('rejectPending')}
            </span>
          </>
        ) : (
          <>
            <span className={css.entryAction} role="button" tabIndex={0}
              onClick={act(() => { startEdit(entry) })} onKeyDown={keyAct(() => { startEdit(entry) })}>{t('edit')}</span>
            <span className={css.entryAction} role="button" tabIndex={0}
              onClick={act(() => { handlePin(entry) })} onKeyDown={keyAct(() => { handlePin(entry) })}>
              {entry.pinned ? t('unpin') : t('pinAction')}
            </span>
            <span className={css.entryAction} role="button" tabIndex={0}
              onClick={act(() => { handleCopy(entry) })} onKeyDown={keyAct(() => { handleCopy(entry) })}>{t('copy')}</span>
            <span className={css.entryAction + ' ' + css.entryActionDanger} role="button" tabIndex={0}
              onClick={act(() => { handleDelete(entry) })} onKeyDown={keyAct(() => { handleDelete(entry) })}>{t('delete')}</span>
          </>
        )}
      </span>
    )
  }

  /** 紧凑条目行（时间分组内：图标 + 标题 + 徽章 + 勾圆）。 */
  const renderEntryRow = (entry: MemoryEntryView): JSX.Element => {
    const selected = !selecting && entry.id === selectedId
    const cls = [css.entryRow, selected ? css.entryRowSel : ''].filter(Boolean).join(' ')
    return (
      <button
        key={entry.id}
        type="button"
        className={cls}
        aria-pressed={selected}
        onClick={() => { if (selecting) toggleChecked(entry.id); else selectEntry(entry) }}
      >
        {selecting && renderCheck(entry)}
        <span className={css.entryRowIcon}>{entryIcon(entry, 16)}</span>
        <span className={css.entryTitleTxt} title={entryTitle(entry.content)}>{entryTitle(entry.content)}</span>
        {renderScopeChip(entry)}
      </button>
    )
  }

  /** 详情区头部操作钮组（置顶 / 编辑 / 复制 / 移动 / 启停 / 废弃 / 删除）。 */
  const detailActions = (entry: MemoryEntryView): JSX.Element => {
    const enabled = entry.disabled !== true
    const retired = entry.deprecated === true
    return (
      <div className={css.cardActions}>
        <Tooltip label={entry.pinned ? t('unpin') : t('pin')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconAction} aria-label={entry.pinned ? t('unpin') : t('pin')} disabled={busy} onClick={() => { handlePin(entry) }}>
            <PinIcon size={14} filled={entry.pinned} />
          </button>
        </Tooltip>
        <Tooltip label={t('edit')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconAction} aria-label={t('edit')} disabled={busy} onClick={() => { startEdit(entry) }}>
            <IconEditOutlineRegular size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('copyContent')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconAction} aria-label={t('copyContent')} disabled={busy} onClick={() => { handleCopy(entry) }}>
            <CopyIcon size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('move')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconAction} aria-label={t('move')} disabled={busy} onClick={() => { startMove(entry) }}>
            <IconFolderOpenOutlineRegular size={14} />
          </button>
        </Tooltip>
        <Tooltip label={enabled ? t('disable') : t('enable')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconAction}
            aria-label={enabled ? t('disable') : t('enable')}
            disabled={busy}
            onClick={() => { handleEnable(entry) }}
          >
            <PowerIcon size={14} dim={!enabled} />
          </button>
        </Tooltip>
        {retired ? (
          <Tooltip label={t('restore')} side="bottom" delayMs={500}>
            <button type="button" className={css.iconAction} aria-label={t('restore')} disabled={busy} onClick={() => { handleRestore(entry) }}>
              <IconRefreshOutlineRegular size={14} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label={t('retire')} side="bottom" delayMs={500}>
            <button type="button" className={css.iconAction} aria-label={t('retire')} disabled={busy} onClick={() => { handleRetire(entry) }}>
              <RingOffIcon size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t('delete')} side="bottom" delayMs={500}>
          <button type="button" className={`${css.iconAction} ${css.iconActionDanger}`} aria-label={t('delete')} disabled={busy} onClick={() => { handleDelete(entry) }}>
            <IconTrashOutlineRegular size={14} />
          </button>
        </Tooltip>
      </div>
    )
  }

  /** 归属范围选择（编辑/新建共用）。 */
  const scopeFields = (
    name: string,
    scopeValue: 'global' | 'project',
    onScope: (scope: 'global' | 'project') => void,
    projectValue: string,
    onProject: (hash: string) => void,
  ): JSX.Element => (
    <>
      <label className={css.check}>
        <input type="radio" name={name} checked={scopeValue === 'global'} onChange={() => { onScope('global') }} />
        {t('moveToGlobal')}
      </label>
      <label className={css.check}>
        <input type="radio" name={name} checked={scopeValue === 'project'} onChange={() => {
          onScope('project')
          if (projectValue === '') {
            const first = projects.find(project => project.entryCount > 0) ?? projects[0]
            if (first !== undefined) onProject(first.hash)
          }
        }} />
        {t('moveToProject')}
      </label>
      {scopeValue === 'project' && (
        <select className={css.tagSelect} value={projectValue} aria-label={t('projectPlaceholder')} onChange={(event) => { onProject(event.currentTarget.value) }}>
          {projects.length === 0 && <option value="">{t('noProjects')}</option>}
          {projects.map(project => (
            <option key={project.hash} value={project.hash}>
              {project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash}
            </option>
          ))}
        </select>
      )}
    </>
  )

  /** 详情标签 chips（属性 + 时间）。 */
  const renderDetailChips = (entry: MemoryEntryView): JSX.Element => (
    <div className={css.chips}>
      <span className={css.chipMute} title={t('scopeBadgeTitle')}>
        {entry.scope === 'global' ? <GlobeIcon /> : <FolderIcon />}
        {entry.scope === 'global' ? t('scopeGlobal') : projectName(entry.projectHash, projects)}
      </span>
      {entry.source === 'manual'
        ? <span className={css.chipAccent}><PenIcon />{t('sourceManual')}</span>
        : <span className={css.chipMute}><SparkIcon />{t('sourceExtract')}</span>}
      <span className={css.chipMute}>{t(KIND_LABEL[entry.kind])}</span>
      {entry.layer === 'long' && <span className={css.chipWarn}><LayersIcon />{t('groupLongterm')}</span>}
      {entry.pinned && <span className={css.chipWarn}><PinIcon size={11} filled />{t('tabPinned')}</span>}
      <button
        type="button"
        className={entry.verified ? css.chipOkBtn : css.chipMuteBtn}
        title={entry.verified ? t('verifyHintOn') : t('verifyHintOff')}
        onClick={() => handleVerify(entry)}
      >
        {entry.verified ? <VerifiedIcon /> : null}
        {entry.verified ? t('verified') : t('unverified')}
      </button>
      {entry.deprecated === true && <span className={css.chipWarn}>{t('retiredTag')}</span>}
      {entry.disabled === true && <span className={css.chipMute}>{t('disabledTag')}</span>}
      <span className={css.chipTime} title={absoluteTime(entry.updatedAt)}>{relativeTime(entry.updatedAt)}</span>
    </div>
  )

  /** 详情正文（区块：关联信息 / 历史记录 / 相关记忆）。 */
  const renderDetailExtras = (entry: MemoryEntryView): JSX.Element => {
    const mainTag = entry.tags[0] ?? null
    const tagCount = mainTag !== null ? allTags.find(item => item.tag === mainTag)?.count ?? 0 : 0
    const project = projects.find(item => item.hash === entry.projectHash)
    const entries = relatedEntries
    const historyRows = historyExpanded ? entryChanges : entryChanges.slice(0, 3)
    return (
      <>
        <div className={css.sectionTitle}>{t('relationSection')}</div>
        <div className={css.sectionLine} />
        <div className={css.relationGrid}>
          <div className={css.relationCard}>
            <span className={css.relationLabel}>{t('relationProject')}</span>
            <span className={css.relationMain}>
              <span style={{ color: entry.scope === 'global' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-secondary)', display: 'inline-flex' }}>
                {entry.scope === 'global' ? <GlobeIcon size={12} /> : <FolderIcon size={12} />}
              </span>
              {entry.scope === 'global' ? t('scopeGlobal') : (project?.alias ?? projectName(entry.projectHash, projects))}
            </span>
            <span className={css.relationSub} title={project?.path ?? ''}>
              {entry.scope === 'global' ? t('scopeGlobal') : (project?.path ?? '')}
            </span>
          </div>
          <div className={css.relationCard}>
            <span className={css.relationLabel}>{t('relationCategory')}</span>
            <span className={css.relationMain}>
              <span className={css.catDot} style={{ ['--dot' as string]: mainTag !== null ? DOT_COLORS[hashOf(mainTag) % DOT_COLORS.length] : 'var(--dsw-alias-border-l2, #CED2DA)' }} />
              {mainTag ?? '—'}
            </span>
            <span className={css.relationSub}>
              {mainTag !== null ? t('tagCountSuffix', { n: tagCount }) : t('unverified')}
            </span>
          </div>
        </div>
        <div className={css.sectionTitle}>{t('historyTitle')}</div>
        <div className={css.sectionLine} />
        {entryChanges.length === 0 ? (
          <div className={css.historyDesc}>{t('historyEmpty')}</div>
        ) : (
          <div className={css.historyList}>
            {historyRows.map(change => (
              <div key={change.id} className={css.historyRow}>
                <span className={css.historyTime}>{relativeTime(change.at)}</span>
                <span className={css.historyDesc}>{historyDesc(change)}</span>
              </div>
            ))}
            {entryChanges.length > 3 && (
              <button
                type="button"
                className={css.historyLink}
                onClick={() => { setHistoryExpanded(value => !value) }}
              >
                {historyExpanded ? t('historyCollapse') : t('historyAll')}
                <span>▾</span>
              </button>
            )}
          </div>
        )}
        <div className={css.sectionTitle}>{t('relatedTitle')}<CountBadge key={entries.length} value={entries.length} inline /></div>
        <div className={css.sectionLine} />
        {entries.length === 0 ? (
          <div className={css.historyDesc}>
            {/* 原来这里复用 t('consolidating')「整理中…」，但此刻根本没在整理，
                只是在算相关记忆 —— 用错的加载文案比没有更让人困惑。 */}
            {related.loading ? t('relatedLoading') : t('relatedEmpty')}
          </div>
        ) : (
          <div className={css.relatedGrid}>
            {entries.map(relatedEntry => (
              <button
                key={relatedEntry.id}
                type="button"
                className={css.relatedCard}
                onClick={() => { selectEntry(relatedEntry) }}
              >
                <span className={css.relatedTitleTxt}>{entryTitle(relatedEntry.content)}</span>
                <span className={css.relatedSub}>
                  {relatedEntry.scope === 'global' ? <GlobeIcon size={9} /> : <FolderIcon size={9} />}
                  {relatedEntry.scope === 'global' ? t('scopeGlobal') : projectName(relatedEntry.projectHash, projects)}
                  <span>·</span>
                  {relatedEntry.tags[0] ?? t('retiredTag')}
                </span>
                <span className={css.relatedArrow}>↗</span>
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  /** 右栏内容（详情 / 表单）。 */
  const renderDetailPane = (): JSX.Element => {
    if (adding) {
      return (
        <div className={css.detailForm}>
          <span className={css.formTitle}>{t('addTitle')}</span>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('addContentPlaceholder')}</span>
            <textarea
              className={css.inlineTextarea}
              style={{ minHeight: 200 }}
              value={addContent}
              placeholder={t('addContentPlaceholder')}
              aria-label={t('addContentPlaceholder')}
              autoFocus
              onChange={(event) => { setAddContent(event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('addTagsPlaceholder')}</span>
            <input
              className={css.inlineInput}
              value={addTags}
              placeholder={t('addTagsPlaceholder')}
              aria-label={t('addTagsPlaceholder')}
              onChange={(event) => { setAddTags(event.currentTarget.value) }}
            />
          </label>
          <div className={css.addMeta}>
            <label className={css.check}>
              <input type="checkbox" checked={addPinned} onChange={(event) => { setAddPinned(event.currentTarget.checked) }} />
              {t('addPinned')}
            </label>
            {scopeFields('dsh-memory-add-scope', addScope, setAddScope, addProject, setAddProject)}
          </div>
          <div className={css.editButtons}>
            <Button variant="outline" disabled={busy} onClick={() => { setAdding(false) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy || addContent.trim() === ''} onClick={saveAdd}>{t('save')}</Button>
          </div>
        </div>
      )
    }
    if (editing !== null) {
      return (
        <div className={css.detailForm}>
          <span className={css.formTitle}>{t('editTitle')}</span>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('addContentPlaceholder')}</span>
            <textarea
              className={css.inlineTextarea}
              style={{ minHeight: 200 }}
              value={editing.content}
              aria-label={t('edit')}
              onChange={(event) => { setEditing({ ...editing, content: event.currentTarget.value }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('tagEditPlaceholder')}</span>
            <input
              className={css.inlineInput}
              value={editing.tags}
              placeholder={t('tagEditPlaceholder')}
              aria-label={t('tagEditPlaceholder')}
              onChange={(event) => { setEditing({ ...editing, tags: event.currentTarget.value }) }}
            />
          </label>
          <div className={css.fieldRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('importanceField')}</span>
              <input
                type="number"
                className={css.numberInput}
                min={1}
                max={10}
                step={0.5}
                value={editing.importance}
                aria-label={t('importanceField')}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value)
                  // 手动评分上限 10：超过 10 的值只可能来自「命中加分累积」（封顶 20），
                  // 那是系统对"这条确实被反复用到"的度量，不该由人手填。后端 /update
                  // 与本处口径一致，避免 UI 放行、服务端拒绝的割裂。
                  if (Number.isFinite(next)) setEditing({ ...editing, importance: Math.max(1, Math.min(10, next)) })
                }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('kindLabel')}</span>
              <select
                className={css.tagSelect}
                value={editing.kind}
                aria-label={t('kindLabel')}
                onChange={(event) => { setEditing({ ...editing, kind: event.currentTarget.value as MemoryKind }) }}
              >
                {KINDS.map(kind => (
                  <option key={kind} value={kind}>{t(KIND_LABEL[kind])}</option>
                ))}
              </select>
            </label>
          </div>
          <div className={css.addMeta}>
            <label className={css.check}>
              <input type="checkbox" checked={editing.pinned} onChange={(event) => { setEditing({ ...editing, pinned: event.currentTarget.checked }) }} />
              {t('pin')}
            </label>
            {scopeFields(`dsh-memory-edit-scope-${editing.entryId}`, editing.scope, (next) => {
              setEditing({ ...editing, scope: next, projectHash: next === 'global' ? null : editing.projectHash })
            }, editing.projectHash ?? '', (hash) => { setEditing({ ...editing, scope: 'project', projectHash: hash }) })}
          </div>
          <div className={css.editButtons}>
            <Button variant="outline" disabled={busy} onClick={() => { setEditing(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy || editing.content.trim() === ''} onClick={saveEdit}>{t('save')}</Button>
          </div>
        </div>
      )
    }
    if (moving !== null) {
      return (
        <div className={css.detailForm}>
          <span className={css.formTitle}>{t('moveTitle')}</span>
          <div className={css.addMeta}>
            {scopeFields(`dsh-memory-move-scope-${moving.entryId}`, moving.target, (next) => {
              setMoving({ ...moving, target: next })
            }, moving.project, (hash) => { setMoving({ ...moving, target: 'project', project: hash }) })}
          </div>
          <div className={css.editButtons}>
            <Button variant="outline" disabled={busy} onClick={() => { setMoving(null) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={busy || (moving.target === 'project' && moving.project.trim() === '')}
              onClick={saveMove}
            >
              {t('save')}
            </Button>
          </div>
        </div>
      )
    }
    if (detail !== null) {
      return (
        <div key={detail.id} className={css.detailAnim}>
          <div className={css.detailHead}>
            <h3 className={css.detailTitle}>{entryTitle(detail.content)}</h3>
            {detailActions(detail)}
          </div>
          {renderDetailChips(detail)}
          <div className={css.importanceRow}>
            <span className={css.importanceIcon}><ShieldIcon size={14} /></span>
            <span className={css.importanceLabel}>{t('importanceTitle')}</span>
            <span className={css.importanceBar} role="img" aria-label={t('importanceTitle')}>
              <i style={{ width: `${importancePercent(detail.importance)}%` }} />
            </span>
            <span className={css.importanceValue}>{Number(detail.importance).toFixed(1)}</span>
            <span className={css.topStatSep}>|</span>
            {/* 「有没有被注入过」是判断该不该删的唯一客观信号：从没命中过的条目
                对模型从未产生过价值。原来它埋在页脚时间行里，等于看不见。 */}
            <span className={css.importanceLabel} title={t('lastHitHint')}>
              {detail.lastHitAt === null ? t('neverHit') : t('lastHitLabel', { time: relativeTime(detail.lastHitAt) })}
            </span>
          </div>
          <div className={css.detailBody}>
            <MarkstreamMarkdown text={detail.content} streaming={false} />
          </div>
          {detail.tags.length > 0 && (
            <div className={css.detailTags}>
              {detail.tags.map(tagName => (
                <button
                  key={tagName}
                  type="button"
                  className={tag === tagName ? `${css.chip} ${css.chipActive}` : css.chip}
                  onClick={() => { setTag(tag === tagName ? '' : tagName) }}
                >
                  {tagName}
                </button>
              ))}
            </div>
          )}
          {renderDetailExtras(detail)}
          <div className={css.detailFoot}>
            <span>{t('createdAtLabel', { time: absoluteTime(detail.createdAt) })}</span>
          </div>
        </div>
      )
    }
    // 列表为空（无条目可看）时不叠第二个空态盒，保持中栏空态独白。
    if (filtered.length === 0) return <div />
    return renderEmpty(
      tab === 'trash' ? t('trashEmpty') : t('selectHint'),
      // 回收站的副句说清保留期（30 天后自动清）：用户要知道「不捞就没了」。
      tab === 'trash' ? t('trashRetention') : undefined,
    )
  }

  /** 作用域下拉（全部 / 全局 / 各项目）：「变更」工具行使用（列表筛选已由左栏导航承担）。 */
  const scopeSelectEl = (
    <select
      className={`${css.filterSelect} ${css.scopeSelect}`}
      value={scope}
      aria-label={t('scopeFilterLabel')}
      onChange={(event) => { setScope(event.currentTarget.value as ScopeFilter) }}
    >
      <option value="all">{t('filterAllProjects')} ({summary?.entryCount ?? 0})</option>
      <option value="global">{t('scopeGlobal')} ({summary?.globalCount ?? 0})</option>
      {projects.map(project => (
        <option key={project.hash} value={`project:${project.hash}`}>
          {project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash} ({project.entryCount})
        </option>
      ))}
    </select>
  )

  const selectedProject = scope.startsWith('project:')
    ? projects.find(candidate => candidate.hash === scope.slice('project:'.length))
    : undefined

  /* 顶部视图分段 Tab 项。 */
  /**
   * 侧栏导航条目（2026-10 第二轮重做：从顶部 tab 行搬进左侧栏）。
   *
   * 与旧版的关键差别：
   *   · 旧：横向排一排，6 个 tab 挤在顶部，计数用小徽章挂在右侧。
   *   · 新：纵向列表，图标 + 文字 + 右对齐计数，整行可点（点击区从文字
   *     宽度扩到整行 212px，左侧栏本来就窄，整行点击才够好按）。
   * 计数为 0 时不显示——「0 条」在两个地方同时出现只是噪音。
   */
  const viewTab = (key: MemoryTab, icon: JSX.Element, label: string, count: number, badge = true, hint?: string): JSX.Element => (
    <button
      key={key}
      type="button"
      role="tab"
      title={hint ?? (label + (count > 0 ? ' · ' + count.toLocaleString() : ''))}
      className={css.sidebarItem + (tab === key ? ' ' + css.sidebarItemActive : '')}
      aria-selected={tab === key}
      onClick={() => {
        setTab(key)
        closeForms()
        exitSelecting()
        if (key === 'all') { setScope('all'); setTag('') }
      }}
    >
      <span className={css.navIcon}>{icon}</span>
      <span className={css.sidebarItemLabel}>{label}</span>
      {badge && count > 0 && <span className={css.sidebarItemCount}>{formatCount(count)}</span>}
    </button>
  )

  const shellOrWrap = (children: JSX.Element): JSX.Element => (
    embedded
      ? <div className={css.modalBody} style={{ flex: '1 1 auto', minHeight: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>{children}</div>
      : (
        <PopoverShell
          onClose={onClose}
          ariaLabel={t('panelTitle')}
        >
          <PshBody className={css.modalBody}>
            {children}
          </PshBody>
        </PopoverShell>
      )
  )

  return (
    <>
      {shellOrWrap(
        <div className={`${css.panel} ${modalStaggerClass}`} aria-busy={state.status === 'loading'}>
        {/* ── 左侧栏（2026-10 第二轮重做：从顶部 tab 行搬下来）── */}
        <nav className={css.sidebarNav} aria-label={t('panelTitle')}>
          <div className={css.sidebarBrand}>
            <span className={css.sidebarBrandIcon}><BrainIcon size={15} /></span>
            <span className={css.sidebarBrandText}>{t('panelTitle')}</span>
          </div>

          <div className={css.sidebarSection} role="tablist" aria-label={t('panelTitle')}>
            {viewTab('home', <HomeIcon size={15} />, '首页', 0, false)}
            {viewTab('all', <BoxIcon size={15} />, t('navAll'), summary?.entryCount ?? 0, true, t('hintActive'))}
            {viewTab('changes', <ClockIcon size={15} />, t('tabChanges'), changeCount, true, t('hintAllChanges'))}
            {viewTab('revisions', <HistoryIcon size={15} />, t('tabRevisions'), revisions.length, true, t('hintRevisions'))}
            {viewTab('trash', <TrashIcon size={15} />, t('navTrash'), summary?.deprecatedCount ?? 0, true, t('hintDeprecated'))}
          </div>

          {/* 项目：平铺列出（旧版是下拉框 —— 十几个项目时看不见选项就得先点开） */}
          <div className={css.sidebarSection}>
            <div className={css.sidebarSectionTitle}>
              {t('navProjects') || '项目'}
              <span className={css.sidebarSectionCount}>{projects.length}</span>
            </div>
            <button
              type="button"
              className={css.sidebarItem + (scope === 'all' ? ' ' + css.sidebarItemActive : '')}
              onClick={() => { setTab('all'); setScope('all') }}
            >
              <span className={css.navIcon}><GlobeIcon size={15} /></span>
              <span className={css.sidebarItemLabel}>{t('filterAllProjects')}</span>
              <span className={css.sidebarItemCount}>{formatCount(summary?.entryCount ?? 0)}</span>
            </button>
            <button
              type="button"
              className={css.sidebarItem + (scope === 'global' ? ' ' + css.sidebarItemActive : '')}
              onClick={() => { setTab('all'); setScope('global') }}
            >
              <span className={css.navIcon}><GlobeIcon size={15} /></span>
              <span className={css.sidebarItemLabel}>{t('scopeGlobal')}</span>
              <span className={css.sidebarItemCount}>{formatCount(summary?.globalCount ?? 0)}</span>
            </button>
            {projects.map(project => {
              const active = scope === `project:${project.hash}`
              const label = project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash
              return (
                <button
                  key={project.hash}
                  type="button"
                  title={project.path}
                  className={css.sidebarItem + (active ? ' ' + css.sidebarItemActive : '')}
                  onClick={() => { setTab('all'); setScope(`project:${project.hash}`) }}
                >
                  <span className={css.navIcon}><FolderIcon size={15} /></span>
                  <span className={css.sidebarItemLabel}>{label}</span>
                  <span className={css.sidebarItemCount}>{formatCount(project.entryCount)}</span>
                </button>
              )
            })}
            {projects.length === 0 && <span className={css.sidebarEmpty}>{t('noProjects')}</span>}
          </div>

          {/* 分类：平铺（旧版同样是下拉 + 一排胶囊，重复了两遍） */}
          {allTags.length > 0 && (
            <div className={css.sidebarSection}>
              <div className={css.sidebarSectionTitle}>
                {t('navCategories') || '分类'}
                <span className={css.sidebarSectionCount}>{allTags.length}</span>
              </div>
              <button
                type="button"
                className={css.sidebarItem + (tag === '' ? ' ' + css.sidebarItemActive : '')}
                onClick={() => { setTag('') }}
              >
                <span className={css.navIcon}><TagIcon size={15} /></span>
                <span className={css.sidebarItemLabel}>{t('filterAllCategories')}</span>
              </button>
              {visibleCats.map(cat => (
                <button
                  key={cat.tag}
                  type="button"
                  className={css.sidebarItem + (tag === cat.tag ? ' ' + css.sidebarItemActive : '')}
                  onClick={() => { setTag(tag === cat.tag ? '' : cat.tag) }}
                >
                  <span className={css.navIcon}>
                    <span className={css.catDot} style={{ ['--dot' as string]: DOT_COLORS[hashOf(cat.tag) % DOT_COLORS.length] }} />
                  </span>
                  <span className={css.sidebarItemLabel}>{cat.tag}</span>
                  <span className={css.sidebarItemCount}>{formatCount(cat.count)}</span>
                </button>
              ))}
              {allTags.length > 6 && (
                <button
                  type="button"
                  className={css.sidebarItem}
                  aria-expanded={catExpanded}
                  onClick={() => { setCatExpanded((value) => !value) }}
                >
                  <span className={css.navIcon}>{catExpanded ? '−' : '+'}</span>
                  <span className={css.sidebarItemLabel}>{catExpanded ? t('catLess') : t('navMoreCategories')}</span>
                </button>
              )}
            </div>
          )}

          {/* 设置固定在底部：它是低频入口，不该跟导航抢位置 */}
          <div className={css.sidebarSection} style={{ marginTop: 'auto' }}>
            {viewTab('settings', <GearIcon size={15} />, t('tabSettings'), 0, false)}
          </div>
        </nav>

        {/* ── 右侧内容列：顶栏 + 主区 ── */}
        <div className={css.contentCol}>
          <header className={css.topBar}>
            <div className={css.viewRow}>
              {/* 搜索框（重做：胶囊容器 + 聚焦光晕 + 内容清除键） */}
              {(tab === 'all' || tab === 'trash') ? (
                <label className={css.searchWrap}>
                  <span className={css.topSearchIcon}><IconSearchOutlineRegular size={15} /></span>
                  <input
                    ref={searchRef}
                    className={css.searchInput}
                    value={q}
                    placeholder={t('searchPlaceholderApp')}
                    aria-label={t('searchPlaceholderApp')}
                    onChange={(event) => { setQ(event.currentTarget.value) }}
                    onKeyDown={event => { if (event.key === 'Escape' && q !== '') { event.preventDefault(); setQ('') } }}
                  />
                  {q !== ''
                    ? (
                      <button
                        type="button"
                        className={css.searchClearBtn}
                        aria-label={t('clearFilters')}
                        onClick={() => { setQ('') }}
                      >✕</button>
                    )
                    : <span className={css.searchKbd}>⌘K</span>}
                </label>
              ) : <span style={{ flex: 1 }} />}

              <div className={css.topActions}>
                <div className={css.topStats}>
                  {summary !== null && (
                    <>
                      <span className={css.topStat}>
                        <span className={css.topStatVal}>{summary.entryCount}</span>
                        {t('statEntries')}
                      </span>
                      {summary.pinnedCount !== undefined && (
                        <>
                          <span className={css.topStatSep}>·</span>
                          <span className={css.topStat} title={t('tabPinned')}>
                            <span className={css.topStatIcon} aria-hidden="true">★</span>
                            <span className={css.topStatVal}>{summary.pinnedCount}</span>
                            {t('statPinnedShort')}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>

                <button
                  type="button"
                  className={css.primaryAdd}
                  aria-expanded={adding}
                  title={t('add')}
                  onClick={() => {
                    setTab('all')
                    setAdding(value => !value)
                    setEditing(null)
                    setMoving(null)
                    if (!adding) {
                      if (scope.startsWith('project:')) {
                        setAddScope('project')
                        setAddProject(scope.slice('project:'.length))
                      }
                    }
                  }}
                >
                  <IconPlusOutlineRegular size={15} />
                  <span>{t('add')}</span>
                </button>
              </div>
            </div>
          </header>

        {/* ── 主区 ── */}

        {/* ── 主区：纯双栏（左列表 + 右详情）或全宽视图 ── */}
        <div className={css.mainCol}>
          {notice !== '' && <p className={css.notice}>{notice}</p>}
          {error !== '' && <p className={css.error} role="alert">{error}</p>}

          {tab === 'home' ? (
            state.status === 'loading' ? renderSkeleton() : (
              state.status === 'error' ? (
                <div className={css.viewFull}>
                  <div className={css.empty}>{t('loadFailed')}</div>
                </div>
              ) : (
                <MemoryHome
                  api={apiRef.current}
                  entries={homeEntries}
                  projects={projects}
                  tags={allTags}
                  summary={summary}
                  changes={changes}
                  nav={homeNav}
                  refresh={() => { void refresh() }}
                />
              )
            )
          ) : (
          <>

          {/* 主区框架 */}
          {tab !== 'changes' && tab !== 'revisions' && tab !== 'settings' && (
            state.status === 'loading' ? renderSkeleton() : (
              state.status === 'error' ? (
                <div className={css.viewFull}>
                  <div className={css.empty}>
                    <span className={css.emptyIcon}><BrainIcon size={26} /></span>
                    <span className={css.emptyText}>{t('error')}</span>
                    <Button variant="outline" size="sm" onClick={() => { void load() }}>{t('retry')}</Button>
                  </div>
                </div>
              ) : (
                <div className={css.cols}>
                  {/* 中栏：列表 */}
                  <div className={css.listCol}>
                    {selecting ? (
                      <div className={css.listHead}>
                        <span className={css.batchCount}>{t('selectedCount', { n: checkedIds.size })}</span>
                        <span className={css.barSep} aria-hidden="true" />
                        <Button variant="outline" size="sm" onClick={toggleAllChecked}>{allChecked ? t('collapse') : t('selectAll')}</Button>
                        <span className={css.spacer} />
                        <Button variant="outline" size="sm" disabled={busy} onClick={exitSelecting}>{t('cancel')}</Button>
                        <Button variant="primary" size="sm" disabled={busy || checkedIds.size === 0} onClick={deleteChecked}>
                          {t('delete')} ({checkedIds.size})
                        </Button>
                      </div>
                    ) : (
                      <div className={css.listHead}>
                        <span className={css.listHeadText}>{t('listCount', { n: filtered.length })}</span>
                        <span className={css.spacer} />
                        {/* 排序：图标 + 文字标签（效果图「排序：最新」）。
                            纯图标在数据密集的工具条里读不出当前口径。 */}
                        <button
                          type="button"
                          className={css.listSort}
                          aria-label={sortDir === 'new' ? t('sortNewest') : t('sortOldest')}
                          title={sortDir === 'new' ? t('sortNewest') : t('sortOldest')}
                          onClick={() => { setSortDir(dir => (dir === 'new' ? 'old' : 'new')) }}
                        >
                          <SortArrowsIcon size={13} />
                          <span>{sortDir === 'new' ? t('sortNewest') : t('sortOldest')}</span>
                        </button>
                        <Tooltip label={t('deleteTodayHint')} side="top" delayMs={500}>
                          <button
                            type="button"
                            className={`${css.toolBtn} ${css.toolBtnDanger}`}
                            aria-label={t('deleteTodayHint')}
                            disabled={busy || todayCount === 0}
                            onClick={handleDeleteToday}
                          >
                            <EraserIcon size={13} />
                            {t('deleteToday')}{todayCount > 0 ? ` (${todayCount})` : ''}
                          </button>
                        </Tooltip>
                        <Tooltip label={consolidating ? t('consolidating') : t('consolidateHint')} side="top" delayMs={500}>
                          <button
                            type="button"
                            className={css.toolBtn}
                            aria-label={t('consolidate')}
                            disabled={busy || consolidating}
                            onClick={handleConsolidate}
                          >
                            <IconSparkleRegular size={13} />
                            {t('consolidate')}
                          </button>
                        </Tooltip>
                        <Tooltip label={t('retry')} side="top" delayMs={500}>
                          <button type="button" className={`${css.toolBtn} ${css.toolBtnIcon}`} aria-label={t('retry')} disabled={busy} onClick={() => { void refresh() }}>
                            <IconRefreshOutlineRegular size={13} />
                          </button>
                        </Tooltip>
                        <button type="button" className={css.toolBtn} disabled={filtered.length === 0} onClick={enterSelecting}>
                          {t('multiSelect')}
                        </button>
                      </div>
                    )}
                    {/* 项目上下文条：选中具体项目时出现（别名 / 清空）。
                        两个工作区开关（自动记忆 / 排除注入）已迁到大盘设置卡片 —— 见下方注释。 */}
                    {selectedProject !== undefined && !selecting && (
                      <div className={css.projContext}>
                        <span className={css.projName} title={selectedProject.path}>
                          <FolderIcon size={11} />
                          {selectedProject.alias ?? selectedProject.path.split(/[\\/]/).filter(Boolean).at(-1) ?? selectedProject.hash}
                        </span>
                        <input
                          className={css.inlineInput}
                          style={{ flex: '1 1 110px', minWidth: 90, width: 'auto' }}
                          value={aliasDraft ?? selectedProject.alias ?? ''}
                          placeholder={t('aliasPlaceholder')}
                          aria-label={t('projectAlias')}
                          title={t('projectAlias')}
                          disabled={busy}
                          onChange={event => { setAliasDraft(event.currentTarget.value) }}
                          onBlur={() => { saveAlias(selectedProject.hash, selectedProject.alias) }}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              saveAlias(selectedProject.hash, selectedProject.alias)
                            }
                            if (event.key === 'Escape') setAliasDraft(null)
                          }}
                        />
                        {/*
                         * 这两个开关（自动记忆 / 排除注入）2026-10-18 整块搬到**大盘设置**
                         * 卡片里去了，那里按工作区逐个列出来（`KrPanelSettings.tsx` 的
                         * 「工作区记忆」组），一次能看到全部工作区、连着拨好几个。
                         *
                         * 为什么这里不留一份：同一个开关出现在两个地方，用户拨完一边、
                         * 另一边还是旧值（两处各自缓存一份 projects 快照），看到的就是
                         * 「明明关掉了却还开着」。一处入口、一份真相。
                         *
                         * 这里保留的只有**别名编辑**与**清空本项目记忆** —— 那是这个面板
                         * 独有的、按条目操作的能力，设置卡片里没有。
                         */}
                        <Tooltip label={t('clearProject')} side="top" delayMs={500}>
                          <button type="button" className={`${css.iconAction} ${css.iconActionDanger}`} aria-label={t('clearProject')} disabled={busy} onClick={handleClearProject}>
                            <IconTrashOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                    {filtered.length === 0 ? (
                      renderEmpty(
                        tab === 'trash' ? t('trashEmpty') : (q !== '' || tag !== '' ? t('searchEmpty') : t('empty')),
                        q !== '' || tag !== '' ? t('searchEmptyHint') : undefined,
                        q !== '' || tag !== ''
                          ? { label: t('clearFilters'), onClick: () => { setQ(''); setTag('') } }
                          : undefined,
                      )
                    ) : (
                      <>
                        {pendingEntries.length > 0 && (
                          <div className={css.groupSection} data-tone="warn">
                            {t('groupPending')}
                            <span className={css.groupSectionCount}>{pendingEntries.length}</span>
                          </div>
                        )}
                        {pendingEntries.map(renderEntryCard)}
                        {pinned.length > 0 && (
                          <div className={css.groupSection}>
                            {t('tabPinned')}
                            <span className={css.groupSectionCount}>{pinned.length}</span>
                          </div>
                        )}
                        {pinned.map(renderEntryCard)}
                        {(Object.keys(grouped) as GroupKey[]).map(groupKey => (
                          grouped[groupKey].length > 0 ? (
                            <div key={groupKey}>
                              <div className={css.groupSection}>
                                {groupTitles[groupKey]}
                                <span className={css.groupSectionCount}>{grouped[groupKey].length}</span>
                              </div>
                              {grouped[groupKey].map(renderEntryRow)}
                            </div>
                          ) : null
                        ))}
                      </>
                    )}
                  </div>
                  {/* 右栏：详情 */}
                  <div className={css.detailCol}>
                    {renderDetailPane()}
                  </div>
                </div>
              )
            )
          )}

          {/* 全宽视图：变更 / 修订 / 设置 */}
          {tab === 'changes' && (
            <div className={css.viewFull}>
              <div className={css.searchRow}>
                {scopeSelectEl}
                <span className={css.barSep} aria-hidden="true" />
                <div className={css.segment} role="group" aria-label={t('tabChanges')}>
                  {(['today', 'all'] as const).map(range => (
                    <button
                      key={range}
                      type="button"
                      aria-pressed={changeRange === range}
                      className={changeRange === range ? `${css.segmentItem} ${css.segmentItemActive}` : css.segmentItem}
                      onClick={() => { setChangeRange(range) }}
                    >
                      {range === 'today' ? t('changesToday') : t('changesAll')}
                    </button>
                  ))}
                </div>
                <span className={css.stat}>
                  <span className={css.statValue}>{visibleChanges.length}</span>
                  {t('statChanges')}
                </span>
                <span className={css.spacer} />
                <Tooltip label={t('retry')} side="top" delayMs={500}>
                  <button type="button" className={css.iconAction} aria-label={t('retry')} disabled={busy} onClick={() => { void loadChanges() }}>
                    <IconRefreshOutlineRegular />
                  </button>
                </Tooltip>
              </div>
              {visibleChanges.length === 0
                ? renderEmpty(t('changesEmpty'))
                : (
                  <>
                    <ul className={css.cardList}>{shownChanges.map(renderChange)}</ul>
                    {visibleChanges.length > shownChanges.length && (
                      <button
                        type="button"
                        className={css.changeMore}
                        onClick={() => { setChangeLimit(limit => limit + CHANGE_PAGE) }}
                      >
                        {t('changesLoadMore', { n: visibleChanges.length - shownChanges.length })}
                        <span aria-hidden="true">▾</span>
                      </button>
                    )}
                  </>
                )}
            </div>
          )}

          {tab === 'revisions' && (
            <div className={css.viewFull}>
              <div className={css.searchRow}>
                <span className={css.stat}>
                  <span className={css.statValue}>{revisions.length}</span>
                  {t('statChanges')}
                </span>
                <span className={css.spacer} />
                <Tooltip label={t('retry')} side="top" delayMs={500}>
                  <button type="button" className={css.iconAction} aria-label={t('retry')} disabled={busy} onClick={() => { void loadRevisions() }}>
                    <IconRefreshOutlineRegular />
                  </button>
                </Tooltip>
              </div>
              {revisions.length === 0
                ? renderEmpty(t('revisionsEmpty'))
                : <ul className={css.cardList}>{revisions.map(renderRevision)}</ul>}
            </div>
          )}

          {tab === 'settings' && (
            <div className={css.viewFull}>
              <SettingsTab
                config={config}
                busy={busy}
                t={t}
                listModels={() => apiRef.current.listModels().then((response: { models: ModelCatalogView[] }) => response.models)}
                onPatch={patchValue => { void patchConfig(patchValue) }}
                onReset={() => { askConfirm(t('settingsResetConfirm'), () => { void resetConfig() }) }}
              />
            </div>
          )}
          </>
          )}
        </div>
        </div>
      </div>
      )}
    {confirmRequest !== null && (
      <ConfirmDialog
        open
        title={confirmRequest.title}
        message={confirmRequest.message}
        confirmLabel={t('confirmOk')}
        cancelLabel={t('confirmCancel')}
        danger={confirmRequest.danger}
        onConfirm={confirmRequest.onConfirm}
        onClose={() => { setConfirmRequest(null) }}
      />
    )}
    </>
  )

  /** 渲染一条修订版本（快照信息 + 回滚按钮）。 */
  function renderRevision(revision: RevisionView): JSX.Element {
    return (
      <li key={revision.id} className={css.changeRow}>
        <span className={css.changeBadge}>{revision.trigger === 'manual' ? t('revManual') : t('revDaily')}</span>
        <div className={css.changeMain}>
          <div className={css.cardMeta}>
            <span>{revision.scope === 'global' ? t('scopeGlobal') : revision.scope}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span>{t('revEntries', { n: revision.entryCount })}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span title={absoluteTime(revision.at)}>{relativeTime(revision.at)}</span>
          </div>
        </div>
        <div className={css.revActions}>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { handleRollback(revision) }}>
            {t('rollback')}
          </Button>
        </div>
      </li>
    )
  }

  /** 渲染一条变更（含前后内容对比，无删除按钮）。 */
  function renderChange(change: ChangeView): JSX.Element {
    const hasDiff = change.before !== undefined && change.after !== undefined && change.before !== change.after
    const badgeClass = change.action === 'delete'
      ? `${css.changeBadge} ${css.changeBadgeDelete}`
      : change.action === 'add'
        ? `${css.changeBadge} ${css.changeBadgeAdd}`
        : change.action === 'promote'
          ? `${css.changeBadge} ${css.changeBadgePromote}`
          : change.action === 'revise'
            ? `${css.changeBadge} ${css.changeBadgeRevise}`
            : change.action === 'retire'
              ? `${css.changeBadge} ${css.changeBadgeRetire}`
              : css.changeBadge
    return (
      <li key={change.id} className={css.changeRow}>
        <span className={badgeClass}>{changeActionLabel(change.action, t)}</span>
        <div className={css.changeMain}>
          <div className={css.cardMeta}>
            <span>{change.scope === 'global' ? t('scopeGlobal') : projectName(change.projectHash, projects)}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span title={absoluteTime(change.at)}>{relativeTime(change.at)}</span>
          </div>
          {change.action === 'delete' ? (
            <div className={css.cardContent}>{change.summary}</div>
          ) : hasDiff ? (
            /* 左右并排对比：旧 | 新 */
            <div className={css.changeDiff}>
              <div className={css.changeDiffCol}>
                <div className={css.cardMeta}><span>{t('diffOld')}</span></div>
                <div className={`${css.cardContent} ${css.changeOld}`}>{change.before}</div>
              </div>
              <div className={css.changeDiffDivider} />
              <div className={css.changeDiffCol}>
                <div className={css.cardMeta}><span>{t('diffNew')}</span></div>
                <div className={`${css.cardContent} ${css.changeNew}`}>{change.after}</div>
              </div>
            </div>
          ) : (
            <div className={css.cardContent}>{change.after ?? change.summary}</div>
          )}
        </div>
      </li>
    )
  }
}

/** 变更动作徽标文案（双语，走面板 t）。 */
export function changeActionLabel(action: ChangeView['action'], t: MemoryT): string {
  switch (action) {
    case 'add': return t('changeAdd')
    case 'update': return t('changeUpdate')
    case 'promote': return t('changePromote')
    case 'delete': return t('changeDelete')
    case 'revise': return t('changeRevise')
    case 'retire': return t('changeRetire')
    case 'consolidate': return t('changeConsolidate')
  }
}
