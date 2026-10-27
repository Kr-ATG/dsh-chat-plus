/**
 * dsh-chat-plus — 「系统提示词」页（操作间里的第六个分类）。
 *
 * ── 这个页面回答什么 ────────────────────────────────────────────────
 * 用户在输入框敲一句话、按下回车，模型**先被交代**的那一大段 system 文本到底
 * 是什么。它由宿主每个 step 现组装（分段 + 运行时上下文 + 工具清单 + 变量），
 * 还会被本插件的工具闸门在出口删段、删工具、追加「哪些能力关着」。所以这份
 * 东西只能在宿主那边取，页面只负责显示 —— 见 src/system-prompt/index.ts。
 *
 * ── 布局 ────────────────────────────────────────────────────────────
 * 页头（标题 + 会话选择 + 刷新 / 复制）→ 规模数字 → 元信息 → 分段列表
 * （点一段展开正文，段头能单独复制那一段）→ 运行时上下文 → 工具清单。
 * 没有图表、没有强调色：这是一份只读的文本视图，排版层级就是全部信息量。
 *
 * ── 三态一个都不能少 ────────────────────────────────────────────────
 * 加载态用与真实内容同高的骨架（避免切换时跳一下）；没取到快照时把宿主给的
 * 原因原样显示并给一个刷新键（最常见的原因是「宿主刚重启、这个会话还是历史」）；
 * 网络/路由失败单独一条错误态。任何一条失败都不会让页面白屏。
 *
 * @module
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  copyText,
  fetchSystemPrompt,
  formatCount,
  formatPromptTime,
  groupSections,
  previewOf,
  sectionLabelOf,
  shortSessionId,
  snapshotToText,
  type PromptFetchResult,
  type PromptSectionView,
  type PromptSnapshot,
  type PromptSessionSummary,
  type SectionGroup,
} from './api.js'
import { css, ensureSystemPromptStyles } from './styles.js'

/** 面板 props（与记忆 / 技能 / 档案面板同形，便于接进统一工作台）。 */
export interface SystemPromptPanelProps {
  onClose: () => void
  embedded?: boolean
}

/** 页面相位。 */
type Phase = 'loading' | 'ready' | 'empty' | 'error'

/**
 * 页面视图（两个 tab）。
 *
 * 「全文」= 模型真正收到的那一整段文本，一个字符都不加工：想 Ctrl+F 找一句话、
 * 想整段复制给别人的时候用它。
 * 「详细」= 同一份内容的分类视图：分段按「身份 / 工具 / 上下文 / 界面 / 其它」
 * 归组，逐段可展开、可单独复制 —— 想弄清「这段是谁写的、为什么在这儿」时用它。
 *
 * 默认落在「全文」：这一页的第一诉求就是「模型到底看到了什么」，而分类是第二层
 * 的解释。反过来（先给一堆折叠的分段名）会让第一次进来的人以为提示词只有标题。
 */
type ViewTab = 'full' | 'detail'

/** tab 定义（顺序即页面上从左到右的顺序）。 */
const VIEW_TABS: readonly { readonly id: ViewTab; readonly label: string; readonly hint: string }[] = [
  { id: 'full', label: '全文', hint: '模型收到的整段文本，原样呈现' },
  { id: 'detail', label: '详细', hint: '按类别拆开看每一段' },
]

/**
 * 当前会话 id（尽量读）。
 *
 * 来源是插件自己的会话身份镜像（TurnProcessShadowView 在会话座位挂载时写到
 * window 上）。工作台页打开时会话页可能已经卸载、这个值可能为空 —— 那也没
 * 关系：空串交给宿主，它会回「最近一次真实组装」的那份，比拿一个过期 id 去
 * 问一个已经不存在的会话更靠谱。
 *
 * @returns 会话 id；读不到返回空串。
 */
function currentSessionId(): string {
  try {
    const value = (window as unknown as { __dshLatestChatSessionId__?: unknown }).__dshLatestChatSessionId__
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/** 小图标：折叠箭头。 */
function CaretIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** 小图标：复制。 */
function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

/** 小图标：刷新。 */
function RefreshIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

/** 小图标：空态（一页文档）。 */
function DocIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  )
}

/**
 * 一段（可折叠）。
 *
 * 折叠态只给一行：段名 + 中文说明 + 字符数 + 复制键。展开后是等宽正文。
 * 段名与正文都是「用户要拿去对照 / 搜索」的东西，所以两处都能单独复制，
 * 不必先复制整份再自己抠。
 */
function SectionRow(props: {
  section: PromptSectionView
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const { section, open, onToggle } = props
  const label = sectionLabelOf(section.name)
  const [copied, setCopied] = useState(false)
  const copy = useCallback((): void => {
    void copyText(section.text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1200)
    })
  }, [section.text])

  return (
    <div className={css.section}>
      <button
        type="button"
        className={css.sectionHead}
        aria-expanded={open}
        onClick={onToggle}
        title={section.name + "：" + previewOf(section.text, 80)}
      >
        <span className={css.sectionCaret} data-open={open ? 'true' : undefined}><CaretIcon /></span>
        <span className={css.sectionName}>{section.name === '' ? '（无名段）' : section.name}</span>
        {label !== '' ? <span className={css.sectionLabel}>{label}</span> : null}
        <span className={css.sectionChars}>{formatCount(section.chars)}</span>
        <span
          role="button"
          tabIndex={0}
          className={css.sectionCopy}
          aria-label={copied ? '已复制' : '复制这一段'}
          title={copied ? '已复制' : '复制这一段'}
          onClick={(event) => { event.stopPropagation(); copy() }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            copy()
          }}
        >
          <CopyIcon />
        </span>
      </button>
      {open ? <pre className={css.sectionBody}>{section.text}</pre> : null}
      {open && section.unresolved.length > 0 ? (
        <p className={css.sectionWarn}>
          {'这段里有变量这次没解析出值（原样保留）：' + section.unresolved.join('、')}
        </p>
      ) : null}
      {open && section.truncated === true ? (
        <p className={css.sectionWarn}>这一段太长，页面只显示了前一部分。</p>
      ) : null}
    </div>
  )
}

/** 规模数字一格。 */
function Stat(props: { label: string; value: string }): JSX.Element {
  return (
    <div className={css.stat}>
      <span className={css.statLabel}>{props.label}</span>
      <span className={css.statValue} title={props.value}>{props.value}</span>
    </div>
  )
}

/**
 * 一个分类块（「详细」tab 里的一组）。
 *
 * 分类头是**可折叠**的：工具说明那一类常常有十几段（每个工具一段），全摊开会把
 * 其它分类挤出视野。默认展开「身份」与「其它」这两类小体量的，其余折叠 —— 但
 * 判断放在组件外面（见 defaultOpenGroups），这里只按传进来的值渲染。
 */
function GroupBlock(props: {
  group: SectionGroup
  open: boolean
  onToggle: () => void
  /** 该组里每一段的展开态（按 key 查）。 */
  openSections: Record<string, boolean>
  onToggleSection: (key: string) => void
}): JSX.Element {
  const { group, open, onToggle, openSections, onToggleSection } = props
  return (
    <section className={css.group}>
      <button
        type="button"
        className={css.groupHead}
        aria-expanded={open}
        onClick={onToggle}
        title={group.desc}
      >
        <span className={css.groupCaret} data-open={open ? 'true' : undefined}><CaretIcon /></span>
        <span className={css.groupLabel}>{group.label}</span>
        <span className={css.groupCount}>{formatCount(group.sections.length)} 段</span>
        <span className={css.groupChars}>{formatCount(group.chars)}</span>
      </button>
      {open ? (
        <>
          <p className={css.groupDesc}>{group.desc}</p>
          <div className={css.body}>
            {group.sections.map((section, index) => {
              const key = group.id + ':' + String(index) + ':' + section.name
              return (
                <SectionRow
                  key={key}
                  section={section}
                  open={openSections[key] === true}
                  onToggle={() => { onToggleSection(key) }}
                />
              )
            })}
          </div>
        </>
      ) : null}
    </section>
  )
}

/** 元信息一行。 */
function MetaRow(props: { label: string; value: string; title?: string }): JSX.Element {
  return (
    <span className={css.metaRow}>
      <span className={css.metaKey}>{props.label}</span>
      <span className={css.metaValue} title={props.title ?? props.value}>{props.value}</span>
    </span>
  )
}

/** 主面板。 */
export function SystemPromptPanel({ embedded = false }: SystemPromptPanelProps): JSX.Element {
  ensureSystemPromptStyles()

  const [phase, setPhase] = useState<Phase>('loading')
  const [result, setResult] = useState<PromptFetchResult | null>(null)
  /** 用户在下拉里选中的会话（空串 = 跟着「最近一次组装」走）。 */
  const [selected, setSelected] = useState('')
  /** 当前视图（全文 / 详细）。 */
  const [view, setView] = useState<ViewTab>('full')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  /** 「详细」tab 里分类块的展开态（按分类 id 查）。 */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [contextOpen, setContextOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [copyHint, setCopyHint] = useState('')
  /** 请求序号：慢请求回来时若已有更新的请求，直接丢弃（避免闪回旧会话）。 */
  const seq = useRef(0)

  const load = useCallback((sessionId: string, fresh = false): void => {
    const mine = ++seq.current
    setPhase('loading')
    void fetchSystemPrompt(sessionId, { fresh }).then((next) => {
      if (mine !== seq.current) return
      setResult(next)
      if (next.ok && next.prompt !== null) {
        setPhase('ready')
        return
      }
      // 没取到：区分「宿主说清楚了原因」与「连路由都没通」——前者是正常的
      // 空态（新会话 / 宿主重启过），后者才是错误态。
      setPhase(next.reason.startsWith('连不上') || next.reason.startsWith('宿主路由返回') ? 'error' : 'empty')
    })
  }, [])

  // 首次进入：优先问当前会话，宿主没有就回「最近一次组装」。
  useEffect(() => {
    load(currentSessionId())
  }, [load])

  const prompt: PromptSnapshot | null = result?.prompt ?? null
  const sessions: readonly PromptSessionSummary[] = result?.sessions ?? []

  const onSelect = useCallback((event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value
    setSelected(next)
    setOpenSections({})
    load(next)
  }, [load])

  // 刷新必须走 fresh：否则命中缓存 = 点了没反应（见 host 路由里 fresh 的说明）。
  const onRefresh = useCallback((): void => {
    load(selected, true)
  }, [load, selected])

  const onCopyAll = useCallback((): void => {
    if (prompt === null) return
    void copyText(snapshotToText(prompt)).then((ok) => {
      setCopyHint(ok ? '已复制整份快照' : '复制失败（浏览器拒绝了剪贴板权限）')
      window.setTimeout(() => { setCopyHint('') }, 1600)
    })
  }, [prompt])

  const toggleSection = useCallback((key: string): void => {
    setOpenSections((prev) => ({ ...prev, [key]: prev[key] !== true }))
  }, [])

  const sections = prompt?.sections ?? []
  const groups = useMemo(() => groupSections(sections), [sections])

  /**
   * 分类块的默认展开策略。
   *
   * 只在**第一次拿到这份快照**时定一次（用 openGroups 里有没有这个键判断），
   * 之后完全由用户点击决定 —— 若每帧重算，用户刚收起的那一组会在下次刷新时
   * 自己弹开。
   *
   * 规则：段数 ≤ 4 的组默认展开（身份 / 上下文 / 界面这类通常一两段，摊开正好），
   * 段数多的（工具说明，一个工具一段）默认收起，否则一屏全是 tool:xxx。
   */
  const groupOpen = useCallback((group: SectionGroup): boolean => {
    const saved = openGroups[group.id]
    if (saved !== undefined) return saved
    return group.sections.length <= 4
  }, [openGroups])

  const toggleGroup = useCallback((id: string, current: boolean): void => {
    setOpenGroups((prev) => ({ ...prev, [id]: !current }))
  }, [])

  const stats = useMemo(() => {
    if (prompt === null) return null
    return {
      chars: formatCount(prompt.chars),
      tokens: '约 ' + formatCount(prompt.tokens),
      sections: formatCount(prompt.sections.length),
      tools: formatCount(prompt.tools.count) + ' 个 · 约 ' + formatCount(prompt.tools.tokens) + ' token',
    }
  }, [prompt])

  return (
    <div className={css.root}>
      <header className={css.head}>
        <div className={css.headMain}>
          <span className={css.eyebrow}><i />System Prompt</span>
          <h1 className={css.title}>系统提示词 <em>/ 模型先看到了什么</em></h1>
          <p className={css.hint}>
            {'每次发送时真正带在请求里的那段 system 文本：分段、运行时上下文、工具清单都在这里。'
            + '它由宿主在发请求前现场组装，所以关掉的能力、切过的模型都会立刻反映在这一份里。'}
          </p>
        </div>
        <div className={css.headActions}>
          {sessions.length > 0 ? (
            <select
              className={css.select}
              value={selected}
              onChange={onSelect}
              aria-label="选择会话"
              title="宿主内存里有快照的会话（进程重启后清空）"
            >
              <option value="">最近一次组装</option>
              {sessions.map((item) => (
                <option key={item.sessionId} value={item.sessionId}>
                  {shortSessionId(item.sessionId) + ' · ' + formatPromptTime(item.at) + ' · ' + formatCount(item.chars) + ' 字符'}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className={css.btn} onClick={onRefresh} title="重新取一次（会让宿主现场组装活会话）">
            <RefreshIcon />
            <span>刷新</span>
          </button>
          <button type="button" className={css.btn} onClick={onCopyAll} disabled={prompt === null} title="复制整份快照（含正文、上下文、工具清单）">
            <CopyIcon />
            <span>{copyHint === '' ? '复制全文' : copyHint}</span>
          </button>
        </div>
      </header>

      {/* tab 切换行：与官方页内分段条同一套几何（下沿一条发丝线，选中态是中性灰底）。
          只在真有快照时出现 —— 没取到内容时切 tab 是空的，不给一个点了没反应的控件。 */}
      {phase === 'ready' && prompt !== null ? (
        <div className={css.tabs} role="tablist" aria-label="系统提示词视图">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={view === tab.id}
              data-active={view === tab.id ? 'true' : undefined}
              title={tab.hint}
              onClick={() => { setView(tab.id) }}
            >
              {tab.label}
            </button>
          ))}
          <span className={css.tabsTail}>
            {view === 'full'
              ? formatCount(prompt.chars) + ' 字符 · 约 ' + formatCount(prompt.tokens) + ' token'
              : groups.length + ' 类 · ' + formatCount(prompt.sections.length) + ' 段'}
          </span>
        </div>
      ) : null}

      <div className={css.scroll}>
        {phase === 'loading' ? (
          <div className={css.skeleton} aria-label="加载中">
            <span style={{ width: '38%' }} />
            <span style={{ width: '72%' }} />
            <span style={{ width: '61%' }} />
            <span style={{ width: '84%' }} />
            <span style={{ width: '46%' }} />
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className={css.error}>
            <p className={css.errorText}>{result?.reason ?? '读取失败'}</p>
            <button type="button" className={css.btn + ' ' + css.errorRetry} onClick={onRefresh}>
              <RefreshIcon />
              <span>重试</span>
            </button>
          </div>
        ) : null}

        {phase === 'empty' ? (
          <div className={css.empty}>
            <span className={css.emptyIcon}><DocIcon /></span>
            <p className={css.emptyText}>这一份暂时取不到</p>
            <p className={css.emptyHint}>{result?.reason ?? ''}</p>
            <button type="button" className={css.btn} onClick={onRefresh}>
              <RefreshIcon />
              <span>再试一次</span>
            </button>
          </div>
        ) : null}

        {phase === 'ready' && prompt !== null && stats !== null ? (
          <>
            <div className={css.stats}>
              <Stat label="提示词字符" value={stats.chars} />
              <Stat label="估算 token" value={stats.tokens} />
              <Stat label="分段" value={stats.sections} />
              <Stat label="工具" value={stats.tools} />
            </div>

            <div className={css.meta}>
              {prompt.cwd !== null ? <MetaRow label="工作目录" value={prompt.cwd} /> : null}
              <MetaRow label="抓取时间" value={new Date(prompt.at).toLocaleString("zh-CN")} />
              <span className={css.metaRow}>
                <span className={css.metaKey}>来源</span>
                <span className={css.badge + (prompt.source === 'live' ? ' ' + css.badgeLive : '')}>
                  {prompt.source === 'live' ? '现场组装（活会话）' : '真实请求出口'}
                </span>
              </span>
              {prompt.truncated ? <MetaRow label="注意" value="全文过长，已截断显示" /> : null}
            </div>

            {sections.length === 0 ? (
              <div className={css.empty}>
                <span className={css.emptyIcon}><DocIcon /></span>
                <p className={css.emptyText}>这一份组装结果是空的</p>
                <p className={css.emptyHint}>
                  {'所有分段都渲染成空串（通常是 persona 与内置段都被关掉了）。这不是读取失败。'}
                </p>
              </div>
            ) : view === 'full' ? (
              /* ── 全文：整段原文，不折叠、不加工 ──
                 这是「模型真正收到的字符串」，包括段与段之间那两个换行。任何
                 trim / 重新拼接都会让用户复制走的东西与实际请求不一致。 */
              <div className={css.full}>
                <div className={css.fullHead}>
                  <span className={css.fullLabel}>system</span>
                  <span className={css.fullHint}>下面就是整段文本，可 Ctrl+F 搜索、可整段选中复制</span>
                </div>
                <pre className={css.fullBody}>{prompt.text}</pre>
                {prompt.truncated ? (
                  <p className={css.sectionWarn}>全文过长，页面只显示了前一部分。</p>
                ) : null}
              </div>
            ) : (
              /* ── 详细：按分类分组，逐段可展开 ── */
              <div className={css.groups}>
                {groups.map((group) => (
                  <GroupBlock
                    key={group.id}
                    group={group}
                    open={groupOpen(group)}
                    onToggle={() => { toggleGroup(group.id, groupOpen(group)) }}
                    openSections={openSections}
                    onToggleSection={toggleSection}
                  />
                ))}
              </div>
            )}

            {prompt.contextText !== '' ? (
              <>
                <div className={css.divider} />
                <button
                  type="button"
                  className={css.sectionHead}
                  aria-expanded={contextOpen}
                  onClick={() => { setContextOpen((value) => !value) }}
                  title="运行时上下文是作为一条 user 消息注入的，不是 system 的一部分"
                >
                  <span className={css.sectionCaret} data-open={contextOpen ? 'true' : undefined}><CaretIcon /></span>
                  <span className={css.sectionName}>runtime-context</span>
                  <span className={css.sectionLabel}>运行时上下文（作为 user 消息）</span>
                  <span className={css.sectionChars}>{formatCount(prompt.contextText.length)}</span>
                </button>
                {contextOpen ? <pre className={css.sectionBody}>{prompt.contextText}</pre> : null}
              </>
            ) : null}

            {prompt.tools.count > 0 ? (
              <>
                <div className={css.divider} />
                <button
                  type="button"
                  className={css.sectionHead}
                  aria-expanded={toolsOpen}
                  onClick={() => { setToolsOpen((value) => !value) }}
                  title="工具 schema 也是每轮请求的一部分，一起算进上下文"
                >
                  <span className={css.sectionCaret} data-open={toolsOpen ? 'true' : undefined}><CaretIcon /></span>
                  <span className={css.sectionName}>tools</span>
                  <span className={css.sectionLabel}>工具清单</span>
                  <span className={css.sectionChars}>
                    {formatCount(prompt.tools.count) + ' 个 · 约 ' + formatCount(prompt.tools.tokens) + ' token'}
                  </span>
                </button>
                {toolsOpen ? (
                  <div className={css.tools}>
                    {prompt.tools.names.map((name) => (
                      <span key={name} className={css.toolName}>{name}</span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
