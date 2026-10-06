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
 *    选中具体项目时项目上下文条（别名 / 自动记忆 / 清空）出现在列表头下方；
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
import { PshBody, PopoverShell } from '../popover-shell.js'
import { markReadIds, readIds } from './Notify.js'

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
 * 大脑/记忆图标（Lucide `brain`，MIT 开源，24 viewBox + stroke-width 2）。
 * 来源：https://lucide.dev/icons/brain
 */
export function BrainIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}

/** 置顶图标（线性 SVG）。 */
export function PinIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.8 2.2 13.8 6.2l-2.3.7-2.4 2.4-.7 2.3-1.6-1.6-2.7 2.7-1-1 2.7-2.7-1.6-1.6 2.3-.7 2.4-2.4.7-2.3Z" />
    </svg>
  )
}

/** 分类/记忆容器方块（左栏品牌与「全部」项）。 */
function BoxIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3" />
      <path d="M6.2 8h3.6" />
    </svg>
  )
}

/** 首页（房子）。 */
function HomeIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7 8 2.5 13.5 7" />
      <path d="M4 6.5V13.5h8V6.5" />
    </svg>
  )
}

/** 变更（时钟）。 */
function ClockIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  )
}

/** 修订（时钟回卷）。 */
function HistoryIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 8a5.2 5.2 0 1 1 1.5 3.7" />
      <path d="M2.6 5.2v2.6h2.6" />
      <path d="M8 5.4V8l2 1.2" />
    </svg>
  )
}

/** 回收站。 */
function TrashIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 4.4h10.4" />
      <path d="M5.6 4.4V3a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v1.4" />
      <path d="M4.2 4.4l.6 8.2a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.2" />
      <path d="M6.6 7.2v3.6M9.4 7.2v3.6" />
    </svg>
  )
}

/** 板擦（lucide eraser 改 16 viewBox）——一键删今日记忆。 */
function EraserIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 12.5h6" />
      <path d="M9.8 2.6 13.4 6.2a1.4 1.4 0 0 1 0 2L9.2 12.4H6.4L2.9 8.9a1.4 1.4 0 0 1 0-2l4.9-4.3a1.4 1.4 0 0 1 2 0Z" />
      <path d="M6.1 4.3 11.7 9.9" />
    </svg>
  )
}

/** 重要度（盾牌）。 */
function ShieldIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 13 3.4v4.1c0 3-2 5.5-5 6.7-3-1.2-5-3.7-5-6.7V3.4L8 1.8Z" />
    </svg>
  )
}

/** 复制（两张卡片）。 */
function CopyIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="8.4" height="8.4" rx="1.6" />
      <path d="M11 3.8A1.6 1.6 0 0 0 9.4 2.2H3.8A1.6 1.6 0 0 0 2.2 3.8v5.6A1.6 1.6 0 0 0 3.8 11" />
    </svg>
  )
}

/** 软废弃（圆环 + 斜杠）。 */
function RingOffIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" />
      <path d="M4.1 4.1l7.8 7.8" />
    </svg>
  )
}

/** 灯泡（顶栏统计「今日变更」）。 */
function LightbulbIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8a4 4 0 0 1 2.3 7.25c-.65.5-.9 1.05-.9 1.75h-2.8c0-.7-.25-1.25-.9-1.75A4 4 0 0 1 8 1.8Z" />
      <path d="M6.9 13.4h2.2M7.3 12.3h1.4" />
    </svg>
  )
}

/** 设置（齿轮）。 */
function GearIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    </svg>
  )
}

/** 排序箭头（↑↓）。 */
function SortArrowsIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12.5V3.5M8 3.5 5.4 6.1M8 3.5l2.6 2.6" />
    </svg>
  )
}

/** 全局作用域（地球）。 */
function GlobeIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.6 2.7 3.7 2.7 6S9.8 12.4 8 14C6.2 12.4 5.3 10.3 5.3 8S6.2 3.6 8 2Z" />
    </svg>
  )
}

/** 项目作用域（文件夹）。 */
function FolderIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.6h4.8A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
    </svg>
  )
}

/** 分类标签（吊牌）。 */
function TagIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 2h5l7 7-5 5-7-7V2Z" />
      <circle cx="5" cy="5" r="1" fill="currentColor" />
    </svg>
  )
}

/** 手动来源（铅笔）。 */
function PenIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m11.5 2.5 2 2L6 12l-2.7.7L4 10l7.5-7.5Z" />
      <path d="m10 4 2 2" />
    </svg>
  )
}

/** 自动来源（闪光）。 */
function SparkIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.2 9.3 6l3.8 1.3-3.8 1.3L8 12.4 6.7 8.6 2.9 7.3 6.7 6 8 2.2Z" />
      <path d="M12.8 11.4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z" />
    </svg>
  )
}

/** 长期沉淀（层叠）。 */
function LayersIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 2.5 5.5 3L8 8.5l-5.5-3 5.5-3Z" />
      <path d="m2.5 8.5 5.5 3 5.5-3" />
      <path d="m2.5 11.5 5.5 3 5.5-3" />
    </svg>
  )
}

/** 已确认（对勾盾）。 */
function VerifiedIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 13 3.4v4.1c0 3-2 5.5-5 6.7-3-1.2-5-3.7-5-6.7V3.4L8 1.8Z" />
      <path d="m5.8 7.8 1.6 1.6 3-3.2" />
    </svg>
  )
}

/** 多选勾（列表勾选框内）。 */
function CheckMark({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

/** 电源（启用/禁用）。 */
function PowerIcon({ size = 14, dim = false }: { size?: number; dim?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: dim ? 0.45 : undefined }} aria-hidden="true">
      <path d="M8 1.5v6" />
      <path d="M11.3 3.7a4.7 4.7 0 1 1-6.6 0" />
    </svg>
  )
}

/** 重要度数值 → 条形百分比（初始 10、命中加分上不封顶；20 视为满格）。 */
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

  const pinned = useMemo(() => ordered.filter(entry => entry.pinned), [ordered])
  const grouped = useMemo(() => groupEntries(ordered.filter(entry => !entry.pinned)), [ordered])
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
  const selectEntry = (entry: MemoryEntryView): void => { closeForms(); setSelectedId(entry.id) }

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
    pickEntry: (id: string): void => { setSelectedId(id); setTab('all'); closeForms(); exitSelecting() },
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

  /** 置顶条目（大卡：图标 + 标题 + 摘要 + 时间行）。 */
  const renderEntryCard = (entry: MemoryEntryView): JSX.Element => {
    const selected = !selecting && entry.id === selectedId
    const cls = [css.entryCard, selected ? css.entryCardSel : ''].filter(Boolean).join(' ')
    return (
      <button
        key={entry.id}
        type="button"
        className={cls}
        aria-pressed={selected}
        onClick={() => { if (selecting) toggleChecked(entry.id); else selectEntry(entry) }}
      >
        <span className={css.entryTop}>
          {selecting && renderCheck(entry)}
          <span className={css.entryIcon}>{entryIcon(entry, 17)}</span>
          {/* title 兜底：长标题被省略号截断后，悬停仍能看到全文 */}
          <span className={css.entryTitleTxt} title={entryTitle(entry.content)}>{entryTitle(entry.content)}</span>
          {renderScopeChip(entry)}
        </span>
        <span className={css.entrySnippet}>{entrySnippet(entry.content)}</span>
        <span className={css.entryFootRow}>
          <span className={css.entryTime}>{relativeTime(entry.updatedAt)}</span>
          <span className={css.entryDot} />
        </span>
      </button>
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
      {entry.verified
        ? <span className={css.chipOk}><VerifiedIcon />{t('verified')}</span>
        : <span className={css.chipMute}>{t('unverified')}</span>}
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
          <div className={css.historyDesc}>{related.loading ? t('consolidating') : t('relatedEmpty')}</div>
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
                max={20}
                step={0.5}
                value={editing.importance}
                aria-label={t('importanceField')}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value)
                  if (Number.isFinite(next)) setEditing({ ...editing, importance: Math.max(1, Math.min(20, next)) })
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
            <span className={css.importanceLabel}>{t('confidenceTitle')}</span>
            <span className={css.importanceValue}>{Math.round(detail.confidence * 100)}%</span>
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
            <span>{t('versionTitle', { n: detail.version })}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span>{t('createdAtLabel', { time: absoluteTime(detail.createdAt) })}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span>{detail.lastHitAt === null ? t('neverHit') : t('lastHitLabel', { time: relativeTime(detail.lastHitAt) })}</span>
          </div>
        </div>
      )
    }
    // 列表为空（无条目可看）时不叠第二个空态盒，保持中栏空态独白。
    if (filtered.length === 0) return <div />
    return renderEmpty(
      tab === 'trash' ? t('trashEmpty') : t('selectHint'),
      tab === 'trash' ? t('consolidateHint') : undefined,
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
  const viewTab = (key: MemoryTab, icon: JSX.Element, label: string, count: number, badge = true, hint?: string): JSX.Element => (
    <button
      key={key}
      type="button"
      role="tab"
      title={label + (count > 0 ? ' · ' + count.toLocaleString() : '')}
      className={css.viewTab}
      data-active={tab === key}
      aria-selected={tab === key}
      onClick={() => {
        setTab(key)
        closeForms()
        exitSelecting()
        if (key === 'all') { setScope('all'); setTag('') }
      }}
    >
      <span className={css.navIcon}>{icon}</span>
      <span>{label}</span>
      {badge && count > 0 && (<CountBadge key={count} value={count} hint={hint} />)}
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
        {/* ── 顶部两级工具筛选栏 ── */}
        <header className={css.topBar}>
          {/* 一级行：视图分段 Tab + 统计数值 +「+ 添加」主按钮 */}
          <div className={css.viewRow}>
            <div className={css.viewTabs} role="tablist">
              {viewTab('home', <HomeIcon size={14} />, '首页', 0, false)}
              {viewTab('all', <BoxIcon size={14} />, t('navAll'), summary?.entryCount ?? 0, true, t('hintActive'))}
              {viewTab('changes', <ClockIcon size={14} />, t('tabChanges'), changeCount, true, t('hintAllChanges'))}
              {viewTab('revisions', <HistoryIcon size={14} />, t('tabRevisions'), revisions.length, true, t('hintRevisions'))}
              {viewTab('trash', <TrashIcon size={14} />, t('navTrash'), summary?.deprecatedCount ?? 0, true, t('hintDeprecated'))}
              {viewTab('settings', <GearIcon size={14} />, t('tabSettings'), 0, false)}
            </div>

            <div className={css.viewActions}>
              <div className={css.topStats}>
                {summary !== null && (
                  <>
                    <span className={css.topStat}>
                      <span className={css.topStatVal}>{summary.entryCount}</span>
                      {t('statEntries')}
                    </span>
                    <span className={css.topStatSep}>·</span>
                    <span className={css.topStat} title={t('statProjects')}>
                      <span className={css.topStatVal}>{projectTotal}</span>
                      {t('statProjects')}
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
                    {(summary.todayChanges ?? 0) > 0 && (
                      <>
                        <span className={css.topStatSep}>·</span>
                        <span className={css.topStat} title={`${t('hintAllChanges')} ${changeCount.toLocaleString()}`}>
                          <span className={css.topStatIcon}><LightbulbIcon size={13} /></span>
                          <span className={css.topStatVal}>{summary.todayChanges}</span>
                          {t('statChangesToday')}
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
                <IconPlusOutlineRegular size={14} />
                <span>{t('add')}</span>
              </button>
            </div>
          </div>

          {/* 二级行：仅在「全部记忆」或「回收站」时展示：搜索框 + 项目选择下拉 + 分类选择下拉 + 分类胶囊 Pills */}
          {(tab === 'all' || tab === 'trash') && (
            <div className={css.subfilterRow}>
              {/* 搜索框 */}
              <label className={css.subfilterSearch} title={t('cmdK')}>
                <span className={css.topSearchIcon}><IconSearchOutlineRegular size={14} /></span>
                <input
                  ref={searchRef}
                  value={q}
                  placeholder={t('searchPlaceholderApp')}
                  aria-label={t('searchPlaceholderApp')}
                  onChange={(event) => { setQ(event.currentTarget.value) }}
                  onKeyDown={event => { if (event.key === 'Escape' && q !== '') { event.preventDefault(); setQ('') } }}
                />
                <span className={css.topKbd}>⌘K</span>
              </label>

              {/* 项目下拉（全部 / 全局 / 各项目） */}
              <div className={css.subfilterGroup}>
                <span className={css.subfilterLabel}>
                  <FolderIcon size={12} /> {t('navProjects') || '项目'}:
                </span>
                <select
                  className={css.subfilterSelect}
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
              </div>

              {/* 分类下拉选择 */}
              <div className={css.subfilterGroup}>
                <span className={css.subfilterLabel}>
                  <TagIcon size={12} /> {t('navCategories') || '分类'}:
                </span>
                <select
                  className={css.subfilterSelect}
                  value={tag}
                  aria-label={t('navCategories')}
                  onChange={(event) => { setTag(event.currentTarget.value) }}
                >
                  <option value="">{t('filterAllCategories')} ({summary?.entryCount ?? 0})</option>
                  {allTags.map(item => (
                    <option key={item.tag} value={item.tag}>
                      {item.tag} ({item.count})
                    </option>
                  ))}
                </select>
              </div>

              {/* 热门分类快速胶囊 Pills */}
              <div className={css.pills}>
                <button
                  type="button"
                  className={css.pill}
                  data-active={tag === ''}
                  onClick={() => setTag('')}
                >
                  {t('tabAll')}
                </button>
                {visibleCats.slice(0, 8).map(cat => (
                  <button
                    key={cat.tag}
                    type="button"
                    className={css.pill}
                    data-active={tag === cat.tag}
                    onClick={() => setTag(tag === cat.tag ? '' : cat.tag)}
                  >
                    <span className={css.catDot} style={{ ['--dot' as string]: DOT_COLORS[hashOf(cat.tag) % DOT_COLORS.length] }} />
                    <span>{cat.tag}</span>
                    <span style={{ opacity: 0.65, fontSize: 11 }}>{cat.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </header>

        {/* ── 主区：纯双栏（左列表 + 右详情）或全宽视图 ── */}
        <div className={css.mainCol}>
          {notice !== '' && <p className={css.notice}>{notice}</p>}
          {error !== '' && <p className={css.error} role="alert">{error}</p>}

          {tab === 'home' ? (
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
                        <button
                          type="button"
                          className={css.listSort}
                          aria-label={t('sortNewest')}
                          title={sortDir === 'new' ? t('sortNewest') : t('sortOldest')}
                          onClick={() => { setSortDir(dir => (dir === 'new' ? 'old' : 'new')) }}
                        >
                          <SortArrowsIcon size={13} />
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
                    {/* 项目上下文条：选中具体项目时出现（别名 / 自动记忆 / 清空） */}
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
                        <span className={css.switchLine}>
                          <button
                            type="button"
                            className={css.switch}
                            role="switch"
                            aria-checked={selectedProject.autoMemory}
                            aria-label={t('autoMemory')}
                            disabled={busy}
                            onClick={() => { void run(() => apiRef.current.meta(selectedProject.hash, { autoMemory: !selectedProject.autoMemory })) }}
                          />
                          <span className={css.switchText}>{t('autoMemory')}</span>
                        </span>
                        <span className={css.switchLine}>
                          <button
                            type="button"
                            className={css.switch}
                            role="switch"
                            aria-checked={selectedProject.injectExcluded === true}
                            aria-label={t('injectExclude')}
                            disabled={busy}
                            title={t('injectExcludeHint')}
                            onClick={() => { void run(() => apiRef.current.meta(selectedProject.hash, { injectExcluded: !(selectedProject.injectExcluded === true) })) }}
                          />
                          <span className={css.switchText}>{t('injectExclude')}</span>
                        </span>
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
