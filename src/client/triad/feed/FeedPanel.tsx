/**
 * dsh-chat-plus — 「动态」工作台页面（操作间一级菜单「动态」的正文）。
 *
 * 用户原话：「做在我们的对话插件里，操作间增加一级菜单动态」。
 *
 * ── 视觉是**还原**，不是设计 ──────────────────────────────────────────
 * deliverables/feed-proto/index.html 是用户已经确认满意、明确说过「界面这样我
 * 已经满足了」的定稿。所以本组件的每条结构、每个类名、每处间距都对着那份 HTML
 * 一比一落地，样式全在 feed/styles.ts（类名前缀 fd-），组件里**不写整页内联样式**
 * （只有浮层定位这类无法用静态 CSS 表达的坐标才用 style 属性）。改动前先问一句
 * 「原型里长这样吗」，不要重新发挥。
 *
 * 页面骨架（与原型 .page 一致）：
 *
 *   左栏（.fd-side）            主区（.fd-main）
 *   ├ 动态主题 + 搜索钮         ├ 头像 + 名字 + 未读火苗 + 更新/设置
 *   ├ 全部动态  ← 第一项        ├ 提示词与生成模型（点设置展开）
 *   ├ 我的动态                  ├ 生成状态条
 *   ├ 各主题频道                ├ 胶囊标签页：全部/未读/临近截止/已过期
 *   └ 发现更多主题              └ 按天分组的动态流 + 底部来源规则
 *
 * ── 数据与容错（本页最重要的一段）──────────────────────────────────────
 * host 路由（src/feed/）是**另一个人并行开发**的，页面写好时它可能还不存在。
 * 所以整条数据链路有三条硬规矩：
 *
 *  1. 所有请求经 feed/api.ts，**永不抛**；失败返回 ok:false + 一句人话；
 *  2. 首屏拉失败 → 显示**友好空态**（「还没有动态，点更新试试」+ 具体原因），
 *     绝不白屏、绝不抛异常、绝不把 @deepseek 的英文报错糊上去；
 *  3. 写操作（点赞 / 讨论 / 删除 / 保存设置 / 更新）失败只弹一条 toast 并回滚
 *     乐观更新，页面继续可用。
 *
 * 首次进入**不会自动跑一轮生成**（原型里那个 1s 定时器是演示脚本，真实产品
 * 里打开页面就烧一次模型调用是浪费）。用户点「更新」才跑，这是刻意的差异。
 *
 * ── 「原文」交互（用户特别要求过）────────────────────────────────────────
 *  · 单来源 → 直接一枚**真 <a href target="_blank" rel="noopener noreferrer">**，
 *    点开就是新标签页。**不用 window.open** —— 异步回调里的 window.open 会被
 *    弹窗拦截，用户点了没反应还以为是坏的；
 *  · 多来源 → 按钮弹出浮层列表，每条也是真链接，逐条可点；Esc / 点遮罩关闭。
 *
 * ── 已读语义（§6.3）────────────────────────────────────────────────────
 * 只在三处把「未读」变成已读：展开正文（点标题）、打开讨论区、点开原文来源。
 * **不在滚动经过时标记** —— 那会让「未读优先」的排序失去意义。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ErrorBoundary } from '../../error-boundary.js'
import {
  deleteFeedPost,
  fetchFeedConfig,
  fetchFeedEntities,
  fetchFeedModels,
  fetchFeedPosts,
  fetchFeedStatus,
  FOLLOW_DEFAULT,
  followDefaultLabel,
  postFeedComment,
  refreshFeed,
  saveFeedConfig,
  toggleFeedLike,
  type FeedAccess,
  type FeedComment,
  type FeedConfig,
  type FeedDay,
  type FeedEntity,
  type FeedMedia,
  type FeedModelCatalog,
  type FeedModelOption,
  type FeedPost,
  type FeedSource,
  type FeedStatus,
} from './api.js'
import { ensureFeedStyles } from './styles.js'
import { EntitySettings } from './EntitySettings.js'
import { MediaGrid } from './MediaGrid.js'
import { MediaViewer } from './MediaViewer.js'
import {
  CLOCK_TICK_MS,
  LOCAL_RUN_WINDOW_MS,
  PROGRESS_TICK_MS,
  RUN_STEPS,
  STATUS_POLL_MS,
} from './constants.js'
import {
  agoText,
  clockText,
  dateKeyOf,
  dayHeadingText,
  elapsedText,
  fullDateText,
  outcomeLabelOf,
  pickTopicChannels,
  runProgressOf,
  shortModelName,
  authorLabelOf,
  isPublishedTime,
  publishedAtOf,
  splitSkipNotes,
  statusLabelOf,
  type RunProgress,
} from './progress.js'

/* ───────────────────────── 常量 ───────────────────────── */

/*
 * 页面大标题「苏墨的动态」**已删除**（2026-10-28 用户：「这个给删掉」）。
 *
 * 它本来是还原原型时抄下来的作者名，与「这一页是我关注的人在说什么」这件事
 * 没有关系；而且它占掉头部最显眼的一行。删掉之后头部只剩右上角的更新状态
 * （.fd-pf-btns 自带 margin-left:auto，所以它自动靠右，布局不需要额外调整）。
 */

/** 频道：全部 / 我的 + 各主题（主题清单由数据里出现过的 topics 动态汇总）。 */
type ChannelId = 'all' | 'mine' | string

/**
 * 固定频道（顺序即左栏顺序）。
 *
 * 「全部动态」排第一、「我的动态」第二，其余主题按数据出现顺序追加 —— 与设计
 * 文档 §10.1 一致（「全部动态」已按要求补上，位于左栏第一项）。
 */
const FIXED_CHANNELS: ReadonlyArray<{ id: ChannelId; name: string; desc: string }> = [
  { id: 'all', name: '全部动态', desc: '所有主题合并 · 按时间倒序' },
  { id: 'mine', name: '我的动态', desc: '只含围绕你的目标生成的部分' },
]

/* ───────────────────────── 小工具 ───────────────────────── */
/** 是否已过期：有截止时间且已经过了。 */
function isExpired(post: FeedPost, now: number): boolean {
  return post.dueAt > 0 && post.dueAt < now
}

/** 截止还剩多久（原型文案：「还剩 6 小时 · 今天 18:00」）。 */
function dueText(post: FeedPost, now: number): string {
  const leftMs = post.dueAt - now
  const hours = leftMs / 3600000
  const short = hours < 1 ? '不到 1 小时'
    : hours < 12 ? '还剩 ' + String(Math.max(1, Math.round(hours))) + ' 小时'
      : '还剩约 ' + String(Math.max(1, Math.round(hours / 24))) + ' 天'
  return post.dueLabel === '' ? short : short + ' · ' + post.dueLabel
}

/**
 * 账号头像（用户 2026-10-28：「把头像放账号名称左侧，头像最好是链接渲染而不是
 * 保存下来」）。
 *
 * 三条约定：
 *   · 有 avatarUrl 就渲染 img，**只存 URL 不落地图片**（换头像时 URL 失效，
 *     自然回落到首字球，不会留一张过期的本地图）；
 *   · 首字球**永远垫在下面**，图片没加载完 / 加载失败都有一层可见内容；
 *   · referrerPolicy=no-referrer 是必须的 —— pbs.twimg.com 按 Referer 判盗链，
 *     不带这句会 403（实测）。
 */
function EntityAvatar({ entity, size = 22 }: {
  readonly entity: FeedEntity
  readonly size?: number
}): JSX.Element {
  const [broken, setBroken] = useState(false)
  const url = entity.avatarUrl ?? ''
  const show = url !== '' && !broken
  return (
    <span className="fd-gava" style={{ width: size, height: size }} aria-hidden="true">
      <span className="fd-gava-ch" style={{ fontSize: Math.round(size * 0.46) }}>
        {entity.initial !== '' ? entity.initial : entity.name.slice(0, 1)}
      </span>
      {show ? (
        <img
          className="fd-gava-img"
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => { setBroken(true) }}
        />
      ) : null}
    </span>
  )
}

/** 原文语言码 → 中文名（只列常见的；未知码原样显示）。 */
function originalLangLabel(code: string): string {
  const map: Record<string, string> = {
    en: '英文', ja: '日文', ko: '韩文', fr: '法文', de: '德文',
    es: '西班牙文', ru: '俄文', pt: '葡萄牙文', it: '意大利文',
  }
  return map[code] ?? code
}

/** 把命中关键词包成 <mark>（大小写不敏感，只标第一处，与原型 hl 同口径）。 */
function highlight(text: string, query: string): JSX.Element[] | string {
  const q = query.trim()
  if (q === '') return text
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return text
  return [
    <span key="pre">{text.slice(0, at)}</span>,
    <mark key="hit">{text.slice(at, at + q.length)}</mark>,
    <span key="post">{text.slice(at + q.length)}</span>,
  ]
}

/** 来源的一行摘要文字（浮层里用）。 */
function sourceSubline(source: FeedSource): string {
  return source.domain === '' ? source.url : source.domain
}

/* ───────────────────────── 图标（原型 I.* 的转写） ───────────────────────── */

const svgBase = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

function IconChat(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" strokeWidth="1.6" {...svgBase}>
      <path d="M17 9.6a1.9 1.9 0 0 1-1.9 1.9H7.3L4 14.6V4.7a1.9 1.9 0 0 1 1.9-1.9h9.2A1.9 1.9 0 0 1 17 4.7z" />
    </svg>
  )
}

function IconHeart(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" strokeWidth="1.6" {...svgBase}>
      <path d="M10 16.4s-6.3-3.7-6.3-8a3.6 3.6 0 0 1 6.3-2.4 3.6 3.6 0 0 1 6.3 2.4c0 4.3-6.3 8-6.3 8z" />
    </svg>
  )
}

function IconTrash(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" strokeWidth="1.6" {...svgBase}>
      <path d="M3.6 5.6h12.8M8 5.6V3.9h4v1.7M5.3 5.6l.7 10.2h8l.7-10.2" />
    </svg>
  )
}

/**
 * 「打开外部链接」图标。
 *
 * 曾经是操作行「原文」按钮的图标 —— 那个按钮已按用户要求删除，但图标**保留**：
 * 来源浮层（SourceSheet）每条来源左边仍用它，那枚浮层本身是明确要留的。
 */
function IconOut({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" strokeWidth="1.7" {...svgBase}>
      <path d="M6 3.2H3.4v9.4h9.4V10M9.6 2.6h3.8v3.8M13.2 2.8 7.4 8.6" />
    </svg>
  )
}

function IconLock(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" strokeWidth="1.7" {...svgBase}>
      <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.8" />
      <path d="M5.6 7V5a2.4 2.4 0 0 1 4.8 0v2" />
    </svg>
  )
}

function IconClock({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" strokeWidth="1.7" {...svgBase}>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M8 4.7V8l2.3 1.5" />
    </svg>
  )
}

function IconInfo(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" strokeWidth="1.7" {...svgBase}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.3v4M8 5.2v.4" />
    </svg>
  )
}

function IconTag(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" strokeWidth="1.7" {...svgBase}>
      <path d="M8 2.6h5.4v5.4L8 13.4 2.6 8z" />
    </svg>
  )
}

function IconSearch({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" strokeWidth="1.8" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" />
      <path d="M10.6 10.6 14.2 14.2" strokeLinecap="round" />
    </svg>
  )
}

function IconRefresh({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" strokeWidth="1.7" {...svgBase}>
      <path d="M13.65 8A5.65 5.65 0 1 1 8 2.35c1.8 0 3.4.84 4.45 2.15M13.65 2.5v2.85H10.8" />
    </svg>
  )
}

function IconUp(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" strokeWidth="1.9" {...svgBase}>
      <path d="M8 12.6V3.4M4.2 7.2 8 3.4l3.8 3.8" />
    </svg>
  )
}

function IconGear(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" strokeWidth="1.7" {...svgBase}>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" />
    </svg>
  )
}


function IconPlus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" strokeWidth="1.9" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.4v9.2M3.4 8h9.2" />
    </svg>
  )
}

function IconClose(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  )
}

function IconChevron(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" strokeWidth="1.8" {...svgBase}>
      <path d="M6 4.2 9.8 8 6 11.8" />
    </svg>
  )
}


/* ───────────────────────── Toast ───────────────────────── */

interface ToastItem {
  readonly id: number
  readonly text: string
  readonly icon: 'ok' | 'info' | 'trash'
}

/** 提示条（portal 到 body，与原型 .toasts 一致）。 */
function ToastStack({ items }: { items: readonly ToastItem[] }): JSX.Element {
  return createPortal(
    <div className="fd-toasts" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="fd-toast" data-in="true">
          {item.icon === 'trash' ? <IconTrash /> : item.icon === 'ok' ? <IconCheck /> : <IconInfo />}
          <span>{item.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

function IconCheck(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.8 5.2 4 7.3 8.3 2.8" />
    </svg>
  )
}

/* ───────────────────────── 原文来源浮层 ───────────────────────── */

/**
 * 多来源浮层（单来源不走这里，直接是一枚真链接）。
 *
 * 每条都是 **真 <a>**：target=_blank + rel=noopener noreferrer。不用
 * window.open 的理由见文件头。Esc / 点遮罩 / 点右上角关闭。
 */
function SourceSheet({ sources, onClose }: {
  readonly sources: readonly FeedSource[]
  readonly onClose: () => void
}): JSX.Element {
  const firstRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    // 打开后把焦点送进浮层（键盘用户不用 Tab 半天），与原型 setTimeout 40ms 同效。
    const timer = setTimeout(() => { firstRef.current?.focus() }, 40)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      /*
       * ⚠ 必须**先**把事件拦在这里，否则 Esc 会同时关掉上层。
       *
       * 动态页挂在工作台浮层里，工作台自己也监听 Esc 关闭。我们的监听装在
       * window 上，与它是同一层级的两个监听器 —— 一个 Esc 会把「来源浮层」
       * 和「整个工作台」一起关掉，用户看到的是「按 Esc 直接退出动态页」。
       * 拦截后其它监听器仍会被调用（stopImmediatePropagation 才是彻底截断），
       * 所以这里还依赖工作台侧检查 defaultPrevented（见 panel 的说明）。
       */
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return createPortal(
    <div className="fd-pop" data-on="true" role="dialog" aria-modal="true" aria-label="原文来源">
      <div className="fd-pop-bd" onClick={onClose} />
      <div className="fd-pop-sheet">
        <div className="fd-pop-hd">
          <span className="fd-t">原文来源 · {sources.length} 个</span>
          <button className="fd-x" type="button" onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </div>
        <div className="fd-pop-list">
          {sources.map((source, index) => {
            const limited = source.access === 'limited'
            return (
              <a
                key={source.url + String(index)}
                ref={index === 0 ? firstRef : undefined}
                className="fd-pop-item"
                data-lim={limited ? 'true' : undefined}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                title={source.url}
              >
                <span className="fd-pop-ic"><IconOut /></span>
                <span className="fd-pop-tx">
                  <span className="fd-pop-n">{source.title}</span>
                  <span className="fd-pop-d">
                    <span>{sourceSubline(source)}</span>
                    {limited ? <span className="fd-lk"><IconLock />需在平台查看</span> : null}
                  </span>
                </span>
                <span className="fd-pop-go"><IconChevron /></span>
              </a>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}


/* ───────────────────────── 更新进度弹卡 ───────────────────────── */

/**
 * 进度弹卡（点右上角状态弹出）。
 *
 * 照「原文来源」那套浮层的写法：portal 到 body、遮罩 + Esc + 点外部关闭。
 * 内容全部来自 {@link runProgressOf} 与实时跳动的 now —— 组件自己不推断任何
 * 进度，只负责画。
 */
function ProgressSheet({ status, progress, running, now, onClose, onRefresh }: {
  readonly status: FeedStatus | null
  readonly progress: RunProgress
  readonly running: boolean
  readonly now: number
  readonly onClose: () => void
  readonly onRefresh: () => void
}): JSX.Element {
  const firstRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => { firstRef.current?.focus() }, 40)
    // 与 SourceSheet 同一条约定：Esc 只关本浮层，不许连带关掉上层工作台。
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  /*
   * 进度条的形态：**跑着的时候一律不定态**。
   *
   * 为什么不做百分比：host 只在跑完时才把 stats 落进 run，生成中根本拿不到
   * 「走到第几步」；按时间估出来的百分比会一路冲到 99% 然后停在那儿等 —— 那
   * 比诚实的不定态更让人焦虑。所以这里只用两种形态：
   *   · 进行中 → indeterminate 扫过（表示「在动」）
   *   · 完成   → 满格（表示「走完了」）
   */
  const complete = progress.done && !progress.failed && !progress.skipped
  /*
   * 「没有新内容」要能**展开看模型给的具体理由**（用户要求：让用户亲眼看到
   * 为什么这条没写）。默认只摆前 3 条，其余折进「还有 N 条」—— 11 条理由一次
   * 全摊开会把弹卡撑成一整屏、把「再更新一轮」推出视野。
   */
  const [notesOpen, setNotesOpen] = useState(false)
  const noteSplit = splitSkipNotes(progress.skipNotes)
  const visibleNotes = notesOpen ? noteSplit.shown.concat(noteSplit.rest) : noteSplit.shown
  /*
   * 判重理由在**两种结局下都摆出来**，不只是「没有新内容」那一轮：
   *   · 全部跳过 → 用户想知道「为什么一条都没写」；
   *   · 写了 3 条、另跳过 2 条 → 用户同样想知道「那 2 条为什么不算」。
   * 后者以前完全看不到，等于把模型做对的事藏起来了。
   */
  const notesBlock = progress.skipNotes.length === 0 ? null : (
    <div className="fd-prog-notes">
      <div className="fd-prog-notes-hd">
        {/* 标题里的条数是**本轮实际跳过总数**，不是理由清单的长度
            （理由只存前 10 条，混用会让 11 条说成 10 条，用户一核就发现对不上）。 */}
        <span>
          本轮跳过 {String(progress.skippedTotal)} 条重复 · 模型判重理由
          {progress.skipNotes.length < progress.skippedTotal
            ? '（列出 ' + String(progress.skipNotes.length) + ' 条）'
            : ''}
        </span>
        {noteSplit.rest.length > 0 ? (
          <button
            className="fd-prog-notes-more"
            type="button"
            onClick={() => { setNotesOpen((open) => !open) }}
          >
            {notesOpen ? '收起' : '展开全部 ' + String(progress.skipNotes.length) + ' 条理由'}
          </button>
        ) : null}
      </div>
      <ul className="fd-prog-notes-list">
        {visibleNotes.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
      {notesOpen || noteSplit.rest.length === 0 ? null : (
        <span className="fd-prog-notes-rest">
          还有 {String(noteSplit.rest.length)} 条更早的判重理由
        </span>
      )}
    </div>
  )

  return createPortal(
    <div className="fd-pop" data-on="true" role="dialog" aria-modal="true" aria-label="更新进度">
      <div className="fd-pop-bd" onClick={onClose} />
      <div className="fd-pop-sheet">
        <div className="fd-pop-hd">
          <span className="fd-t">更新进度</span>
          <button className="fd-x" type="button" onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </div>

        <div className="fd-prog">
          <div className="fd-prog-top">
            <span className="fd-prog-phase" data-tone={progress.tone}>
              {running ? <span className="fd-prog-pulse" aria-hidden="true" /> : null}
              {progress.phase}
            </span>
            {running ? <span className="fd-prog-elapsed">{elapsedText(progress.elapsedMs)}</span> : null}
          </div>

          <div
            className="fd-prog-track"
            data-mode={complete ? 'done' : progress.failed ? 'fail' : progress.skipped ? 'skip' : 'busy'}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={complete ? 100 : undefined}
            aria-label="进度"
          >
            <i className="fd-prog-fill" />
          </div>

          <div className="fd-prog-meta">
            {running && progress.etaText !== '' ? (
              <span className="fd-prog-eta">
                <IconClock size={12} />
                {progress.etaText}
              </span>
            ) : null}
            {!running && progress.startedAt > 0 ? (
              <span className="fd-prog-eta">
                <IconClock size={12} />
                开始于 {fullDateText(progress.startedAt)}
              </span>
            ) : null}
            {!running && progress.elapsedMs > 0 ? (
              <span className="fd-prog-took">用时 {elapsedText(progress.elapsedMs)}</span>
            ) : null}
          </div>

          {/* 本轮产出：生成中 host 是最后一次性落盘的，所以只能说「即将写入」。 */}
          <div className="fd-prog-row">
            <span className="fd-prog-k">本轮产出</span>
            <span className="fd-prog-v" data-tone={progress.tone}>
              {running
                ? '即将写入（生成完成后一次落盘）'
                : progress.skipped && (progress.postsCreated === null || progress.postsCreated === 0)
                  ? '没有新内容'
                  : progress.postsCreated === null
                    ? '未知'
                    : String(progress.postsCreated) + ' 条'}
            </span>
          </div>

          {progress.degraded !== '' ? (
            <div className="fd-prog-row">
              <span className="fd-prog-k">降级说明</span>
              <span className="fd-prog-v" data-warn="true">{progress.degraded}</span>
            </div>
          ) : null}

          {/* 没有新内容：**不是错误**，所以用中性色块 + 一句结论，不用失败区。
              下面把模型判重的具体理由摆出来 —— 这是整个去重功能最有说服力的展示：
              用户能亲眼看到「为什么这条没写」，而不是只看到「0 条」。 */}
          {progress.skipped ? (
            <div className="fd-prog-skip" data-tone="skipped">
              <b>没有新内容</b>
              <span>
                {progress.noteText !== ''
                  ? progress.noteText
                  : '本轮没有可上架的新内容（写出的条目都未通过校验，或与已发内容重复）'}
              </span>
              {notesBlock}
            </div>
          ) : null}

          {/* 有产出、但模型也跳过了一些候选：理由同样要能看（以前这块完全看不到）。 */}
          {!progress.skipped && !progress.failed && !running && notesBlock !== null ? (
            <div className="fd-prog-skip" data-tone="notes">{notesBlock}</div>
          ) : null}

          {/* 失败：原因**原样**显示，不做任何美化或截断改写的尝试。 */}
          {progress.failed ? (
            <div className="fd-prog-err">
              <b>失败原因</b>
              <span>{progress.errorText === '' ? 'host 没有给出具体原因（可展开「已拦下」或看服务日志）' : progress.errorText}</span>
            </div>
          ) : null}

          <div className="fd-prog-foot">
            <span className="fd-prog-hint">
              {running
                ? '每秒刷新已用时间；状态每 2.5 秒向服务端核对一次。'
                : '空闲时不轮询，只有正在更新时才会向服务端查询状态。'}
            </span>
            {running ? null : (
              <button ref={firstRef} className="fd-pill" data-solid="true" type="button" onClick={onRefresh}>
                <IconUp />再更新一轮
              </button>
            )}
            <span hidden>{String(now)}</span>
            <span hidden>{String(status?.runs.length ?? 0)}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ───────────────────────── 设置弹卡 ───────────────────────── */

/**
 * 「设置」弹出卡片（用户 2026-10-27：「设置变成弹出卡片吧」）。
 *
 * 为什么从「页内展开」改成浮层：
 *  · 展开区会把下面的动态流整体推下去，读到一半的列表跳位；
 *  · 设置项越加越多（提示词 / 模型 / 关注对象），展开区把主内容挤到很下面；
 *  · 小屏上一屏放不下，要滚很久才够得着「保存」。
 *
 * 与「原文来源」「更新进度」共用同一套 .fd-pop 机制（portal 到 body +
 * 遮罩点击关闭 + Esc 关闭 + 右上角关闭按钮），三处行为一致。
 *
 * 表单状态**不在这里**：草稿与保存逻辑仍归 FeedPanel（openSetup 回填 /
 * saveSetup 提交），本组件只负责渲染与把用户输入回调上去 —— 这样「取消」
 * 天然等价于「丢弃草稿」，不需要额外回滚逻辑。
 */
function SetupSheet({
  promptDraft,
  modelDraft,
  modelOptions,
  saving,
  onPromptChange,
  onPromptKey,
  onModelChange,
  onCancel,
  onSave,
}: {
  readonly promptDraft: string
  readonly modelDraft: string
  readonly modelOptions: readonly { value: string; label: string }[]
  readonly saving: boolean
  readonly onPromptChange: (value: string) => void
  readonly onPromptKey: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onModelChange: (value: string) => void
  readonly onCancel: () => void
  readonly onSave: () => void
}): JSX.Element {
  /*
   * Esc 关卡片：与另外两个浮层同一条约定（捕获阶段拦下 + 阻止传播），
   * 否则一次 Esc 会连工作台一起关掉 —— 用户看到的是「按 Esc 退出动态页」。
   * textarea 里的 Esc 由 onPromptKey 先处理（它调 onCancel），这里兜住
   * 焦点在别处（select / 关注对象列表 / 空白）时的情形。
   */
  // onCancel 是调用方每次渲染新建的箭头函数，直接进依赖数组会让这个监听
  // 每一帧都拆装一次（粘贴触发 onChange → 重渲染 → 拆装）。用 ref 持有最新值，
  // 依赖数组保持空，监听只装一次、卸一次。
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancelRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [])

  return createPortal(
    <div className="fd-pop" data-on="true" role="dialog" aria-modal="true" aria-label="设置">
      <div className="fd-pop-bd" onClick={onCancel} />
      <div className="fd-pop-sheet fd-setup-sheet">
        <div className="fd-pop-hd">
          <span className="fd-t">设置</span>
          <button className="fd-x" type="button" onClick={onCancel} aria-label="关闭">
            <IconClose />
          </button>
        </div>

        <div className="fd-setup-in">
          <div className="fd-setup-sec">
            <label className="fd-setup-lbl" htmlFor="fd-prompt">提示词</label>
            <textarea
              id="fd-prompt"
              maxLength={800}
              placeholder="写一句你想让我盯的东西，比如：盯住健身与睡眠，只收一手来源"
              aria-label="生成提示词"
              value={promptDraft}
              onChange={(event) => { onPromptChange(event.currentTarget.value) }}
              onKeyDown={onPromptKey}
            />
          </div>
          <div className="fd-setup-m">
            <label className="fd-setup-lbl" htmlFor="fd-model">生成模型</label>
            <select
              id="fd-model"
              className="fd-m-select"
              aria-label="选择生成模型"
              value={modelDraft}
              onChange={(event) => { onModelChange(event.currentTarget.value) }}
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {/* 关注的对象（右侧悬浮球里那几枚球）。独立组件自包含 ——
              它自己拉列表、自己写、自己报错，保存后广播一次让悬浮球刷新。 */}
          <EntitySettings />
        </div>

        <div className="fd-setup-row">
          <span className="fd-setup-tip">保存后立即生效；提示词实质改变将自动生成一轮</span>
          <button
            className="fd-pill"
            type="button"
            onClick={onCancel}
            disabled={saving}
          >
            取消
          </button>
          <button
            className="fd-pill"
            data-solid="true"
            type="button"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ───────────────────────── 单条动态 ───────────────────────── */

interface PostCardProps {
  readonly post: FeedPost
  readonly now: number
  readonly query: string
  /** 讨论区是否展开。 */
  readonly open: boolean
  /** 正文是否已展开（默认 3 行截断，点标题展开 —— 原型 data-a="open" 的语义）。 */
  readonly bodyOpen: boolean
  readonly entering: boolean
  readonly leaving: boolean
  /** 切讨论区（展开即已读）。 */
  readonly onToggleOpen: (id: string) => void
  /** 切正文展开态（展开即已读）。 */
  readonly onToggleBody: (id: string) => void
  readonly onLike: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onOpenSources: (sources: readonly FeedSource[]) => void
  readonly onComment: (id: string, text: string) => Promise<boolean>
  /** 点某张媒体 → 打开全屏查看器（参数是这条动态里的下标）。 */
  readonly onOpenMedia: (post: FeedPost, index: number) => void
}

/** 单条动态（原型 dynHTML 的转写）。 */
function PostCard({
  post, now, query, open, bodyOpen, entering, leaving,
  onToggleOpen, onToggleBody, onLike, onDelete, onOpenSources, onComment, onOpenMedia,
}: PostCardProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pop, setPop] = useState(false)
  const expired = isExpired(post, now)
  const due = post.dueAt > 0 && !expired
  /*
   * 用户原话：「不需要显示这些，并且把红点给去掉」。红点（未读）/「新」角标 /
   * 未读火苗数字 / 左栏未读角标整块删除，所以这里也不再算 unread / fresh。
   * 卡片顺序改为 host 下发的纯时间倒序（见 visible：不再本地重排）。
   */

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    try {
      const ok = await onComment(post.id, text)
      if (ok) setDraft('')
    } finally {
      // finally 而不是「成功才复位」：请求抛错 / 失败也必须把按钮还原，
      // 否则按钮会永远停在「发送中」且点不动。
      setSending(false)
    }
  }

  const like = (): void => {
    setPop(true)
    // 回弹动画只播一次：480ms 后摘掉标记（连点会重播，符合原型的 void offsetWidth 重启动画）。
    setTimeout(() => { setPop(false) }, 480)
    onLike(post.id)
  }

  /*
   * 卡头那一位：**动态来源的名字**（原来写死的作者名「苏墨」已删除）。
   *
   * 三种形态，与「原文」按钮当年的行为**完全等价**（用户要求「点击就是跟原文
   * 点击一样的效果」）：
   *   · 单来源 → 真 <a href target="_blank" rel="noopener noreferrer">，点开即新标签页。
   *     不用 window.open：异步回调里的 window.open 会被拦截，点了没反应；
   *   · 多来源 → 按钮弹出来源浮层（复用 SourceSheet，每条都是真链接）；
   *   · 无来源 → 纯文本，不可点（没有链接可给，做成按钮等于骗点击）。
   */
  // 卡头第一位：作者账号优先（用户 2026-10-28：「作者账号放第一位置」）。
  const sourceLabel = authorLabelOf(post)
  const sourceNode: JSX.Element = post.sources.length === 1 ? (
    <a
      className="fd-src"
      href={post.sources[0].url}
      target="_blank"
      rel="noopener noreferrer"
      title={'打开原文：' + post.sources[0].url}
    >
      {sourceLabel}
    </a>
  ) : post.sources.length > 1 ? (
    <button
      className="fd-src"
      type="button"
      onClick={() => { onOpenSources(post.sources) }}
      title={'查看 ' + String(post.sources.length) + ' 个原文来源'}
    >
      {sourceLabel}
    </button>
  ) : (
    <span className="fd-src" data-static="true">{sourceLabel}</span>
  )

  return (
    <article
      className="fd-dyn"
      data-expired={expired ? 'true' : undefined}
      data-enter={entering ? 'true' : undefined}
      data-gone={leaving ? 'true' : undefined}
    >
      {/* 卡头：**没有头像、没有红点**（用户要求去掉）。
          第一行 = 可点的「来源名」+ 完整年月日 + 相对时间小字 + 主题/来源类型标签。 */}
      <div className="fd-dh">
        <span className="fd-dh-mid">
          <span className="fd-dh-line">
            {sourceNode}
            {/* 显示的是**对方发布的时间**（用户 2026-10-28 明确要求），
                不是我们生成这一轮的时间。X 来源取推文 createdAt，
                网页来源/老帖子退回 post.createdAt。 */}
            <span
              className="fd-dh-tm"
              title={(isPublishedTime(post) ? '发布时间 · ' : '收录时间 · ')
                + fullDateText(publishedAtOf(post)) + ' · ' + agoText(publishedAtOf(post), now)}
            >
              {fullDateText(publishedAtOf(post))}
            </span>
            <span className="fd-dh-ago">{agoText(publishedAtOf(post), now)}</span>
            {post.topics.length > 0 ? (
              <span className="fd-dh-note"><IconTag />{post.topics[0]}</span>
            ) : null}
            <span className="fd-dh-note">
              {post.sources.length === 1 && post.sources[0].access === 'limited' ? '社交平台' : '实时网络'}
            </span>
          </span>
        </span>
        {expired ? <span className="fd-dh-flag">已过期</span> : null}
      </div>

      {/*
        标题行**已整块删除**（用户 2026-10-28：「中间这个标题去掉」）。
        理由：那个标题是模型现起的概括句（如「liliMozi构想人情味Agent」），
        而正文本来就是这条推文的中文翻译 —— 标题与正文说的是同一件事，
        读起来等于同一句话说两遍。卡头已经有作者账号 + 时间，直接接正文更干净。
        截止胶囊（dueAt）仍保留在正文上方左侧。 */}
      <div className="fd-title-row" data-plain="true">
        {due ? (
          <span className="fd-due"><IconClock />{dueText(post, now)}</span>
        ) : null}
      </div>
      <p className="fd-dyn-p" data-clamp={bodyOpen ? undefined : 'true'}>
        {highlight(post.body, query)}
      </p>

      {/*
        媒体（用户 2026-10-28：「有图片或视频就把链接放上来，渲染出来，
        可播放可查看，可点击放大全屏可滚轮缩放」）。
        图片点开 → MediaViewer（滚轮缩放 0.5-5x + 拖动 + 双击）；
        视频内联 <video controls> 直接播，也可点开全屏。
      */}
      {(post.media ?? []).length > 0 ? (
        <MediaGrid
          items={post.media ?? []}
          onOpen={(index) => { onOpenMedia(post, index) }}
        />
      ) : null}

      {/*
        原文块（用户 2026-10-28：「X账号相关的动态不要压缩原文内容，
        如果原文是英文翻译中文原文放里面」）。
        正文是中文翻译/转述，这里是**推文原文全文** —— 用户能对照，也能核对
        翻译有没有丢信息。英文时标「译自英文」，默认折叠（原文往往比正文长）。
      */}
      {/*
        原文块**只在外文推文时出现**（2026-10-28 用户：「原文原文不是让你翻译人话，
        只是英文做一个翻译」）。
          · 中文推文 → 正文本身就是原话照录，再挂一个「原文」等于同一段话印两遍；
          · 外文推文 → 正文是中文直译，这里放外文原文供对照，标题标「译自英文」。
        判据是 originalLang，不是「有没有 originalText」—— 后者中文推文也有。
      */}
      {post.originalText !== undefined && post.originalText !== ''
        && post.originalLang !== undefined && post.originalLang !== 'zh'
        && post.originalLang !== '' ? (
          <details className="fd-orig">
            <summary className="fd-orig-hd">
              原文（译自{originalLangLabel(post.originalLang)}）
            </summary>
            <blockquote className="fd-orig-tx">{post.originalText}</blockquote>
          </details>
        ) : null}

      <div className="fd-acts">
        <button
          className="fd-act"
          type="button"
          aria-expanded={open}
          onClick={() => { onToggleOpen(post.id) }}
          title="展开讨论"
        >
          <IconChat /><span className="fd-num">{post.comments.length}</span>
        </button>

        <button
          className="fd-act"
          type="button"
          data-liked={post.liked ? 'true' : undefined}
          data-pop={pop ? 'true' : undefined}
          aria-pressed={post.liked}
          onClick={like}
          title={post.liked ? '取消点赞' : '点赞'}
        >
          {/* 只显示 post.likes，**不要**再加 (liked ? 1 : 0)。
              契约里 likes 是 host 算好的总数（已经包含自己那一票），liked 只表示
              「我点过没有」。原型里那一句 likes + (liked?1:0) 是因为原型的 likes 是
              「别人的票数」基数 —— 照抄过来会变成点一次跳两票（实测 12 → 14）。 */}
          <IconHeart /><span className="fd-num">{post.likes}</span>
        </button>

        {/* 「原文」按钮已整块删除（用户要求）：打开原文的动作移到卡片头的
            来源名上 —— 单来源是真链接直开、多来源弹同一张来源浮层。所以操作行
            现在只有 讨论 / 点赞 / 删除 三项。 */}

        <span className="fd-grow" />
        <button className="fd-act" data-del="true" type="button" onClick={() => { onDelete(post.id) }} title="删除">
          <IconTrash />
        </button>
      </div>

      <div className="fd-disc" data-on={open ? 'true' : undefined}>
        {post.comments.length === 0
          ? <div className="fd-none">还没有讨论。写一条，下一轮生成会把它算进取材。</div>
          : post.comments.map((comment: FeedComment, index) => {
            const me = comment.by === 'agent'
            return (
              <div className="fd-row" key={comment.id ?? String(index)}>
                <span className="fd-w" data-me={me ? 'true' : undefined}>{me ? '我' : '你'}</span>
                <span className="fd-t">{comment.text}</span>
                <span className="fd-h">{clockText(comment.at ?? 0)}</span>
              </div>
            )
          })}
        <form onSubmit={(event) => { void submit(event) }}>
          <input
            type="text"
            maxLength={240}
            placeholder="写点什么，或让它下一轮参考…"
            aria-label="发表讨论"
            value={draft}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
          />
          <button className="fd-send" type="submit" disabled={sending || draft.trim() === ''}>
            {sending ? '发送中' : '发送'}
          </button>
        </form>
      </div>
    </article>
  )
}

/* ───────────────────────── 面板本体 ───────────────────────── */

export interface FeedPanelProps {
  /** 与其它工作台面板同签名（本页没有独立浮层，关闭动作不影响内部状态）。 */
  readonly onClose?: () => void
  /** 是否以工作台内嵌形态渲染（真值只影响外层包裹，不影响布局）。 */
  readonly embedded?: boolean
}

/**
 * 动态页（带错误边界）。
 *
 * 为什么必须包一层：用户报「在设置弹卡的提示词框里从外部复制粘贴，页面就空白了」
 * （2026-10-27）。这类「整个页面变白」几乎都是**渲染期异常把整棵子树卸载**——
 * React 对未捕获的渲染错误会卸载到最近的错误边界，而本页此前没有任何边界，
 * 于是异常一路冒到工作台根，整页消失。界面还不会留下任何痕迹（DOM 还在、只是空了），
 * 用户只能看到一片白。
 *
 * 包上之后：崩了只替换成下面这块提示（可点「重新载入」恢复），工作台与侧栏不受影响，
 * 真实错误与组件栈会打到控制台，便于定位到底哪一行。
 * 这不等于修好了根因——它是**兜底**，让「偶发崩溃」不再表现为「整个功能消失」。
 */
export function FeedPanel(props: FeedPanelProps): JSX.Element {
  return (
    <ErrorBoundary
      label="动态页"
      fallback={(
        <div className="fd-root">
          <div className="fd-crash" role="alert">
            <b>动态页渲染出错了</b>
            <span>这一页的某处抛了异常，已拦在这里，没有影响其它功能。</span>
            <span>详细信息在浏览器控制台（搜 dsh-chat-plus）。</span>
            <button
              className="fd-pill"
              data-solid="true"
              type="button"
              onClick={() => { window.location.reload() }}
            >
              重新载入
            </button>
          </div>
        </div>
      )}
    >
      <FeedPanelBody {...props} />
    </ErrorBoundary>
  )
}

function FeedPanelBody({ onClose }: FeedPanelProps): JSX.Element {
  ensureFeedStyles()

  /* ── 数据 ── */
  const [days, setDays] = useState<readonly FeedDay[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [config, setConfig] = useState<FeedConfig>({ prompt: '', model: 'default' })
  const [status, setStatus] = useState<FeedStatus | null>(null)
  /**
   * 模型目录（真实可用的模型）。初值 = 空目录：「跟随系统默认」那一项由渲染层
   * 无条件补上，所以**拉不到时下拉照样有得选**，页面永远不空、不白屏。
   */
  const [catalog, setCatalog] = useState<FeedModelCatalog>({ models: [], current: '', source: 'none' })
  /**
   * 「固定选择」的候选快照（用户 2026-10-28：「生成模型改为固定选择」）。
   *
   * 进页面时把**当时真实可用的模型目录**记下来，之后无论目录再刷新多少次，
   * 下拉里的选项都不再变 —— 这样用户选中的项不会因为某次目录抖动/顺序变化
   * 而「自己跳掉」。不写死任何模型名（写死过一版假模型，用户明确说不要假数据）。
   */
  const [fixedModels, setFixedModels] = useState<readonly FeedModelOption[] | null>(null)

  /* ── 界面状态 ── */
  /**
   * 左栏分组方式（用户 2026-10-28：「左侧加tab分类全部、按账号、按分类」）。
   *   all    → 不分组，全部动态按时间倒序
   *   entity → 按关注账号分组（点某个账号，右侧只显示它的动态）
   *   topic  → 按动态的分类（topics）分组
   */
  const [groupMode, setGroupMode] = useState<'all' | 'entity' | 'topic'>('entity')
  /** 分组模式下选中的账号 id（null = 未选，显示全部）。 */
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null)
  /** 「按分类」模式下选中的分类名（null = 未选，显示全部）。 */
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  /** 已配置的关注账号（拉 /entities；失败时为空数组，不影响其它功能）。 */
  const [entities, setEntities] = useState<readonly FeedEntity[]>([])
  /**
   * 关注账号的加载状态（2026-10-28 用户报「刚启动服务后账号不显示」）。
   *
   * 为什么要单独记状态：以前只有 entities 数组，拉失败与「真的没关注任何人」
   * 在界面上长得一模一样 —— 都显示「还没有关注账号，去设置里添加」。
   * 而服务刚启动/重启的那几秒里，插件路由可能还没挂好，首次请求失败极正常；
   * 用户看到的就是「账号全没了」，还以为数据丢了。
   */
  const [entitiesState, setEntitiesState] = useState<'loading' | 'ready' | 'error'>('loading')
  /**
   * 页面视图（用户：「设置放单独的二级菜单变成设置页面」）。
   * feed = 动态流；settings = 设置页（提示词 / 模型 / 关注对象）。
   */
  const [view, setView] = useState<'feed' | 'settings'>('feed')
  const [channel, setChannel] = useState<ChannelId>('all')
  /* 筛选胶囊（全部 / 未读 / 临近截止 / 已过期）已整块删除 —— 用户原话
   * 「不需要显示这些」，连带 filter state 一起去掉：没有筛选就没有「筛选态」。 */
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('default')
  const [savingConfig, setSavingConfig] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  /** 讨论区展开的帖子（点「讨论」按钮切换）。 */
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set())
  /** 正文展开的帖子（点标题切换；默认 3 行截断）。 */
  const [bodyOpenIds, setBodyOpenIds] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * 本地点开过的帖子（只用于不再给「未读」态 —— 未读红点已按要求删除，
   * 所以这一份现在只剩「展示层要不要把 read 改写成 true」一个用途，
   * 而那个改写本身也随红点一起没了，故整块删除。保留说明以防有人再加回。
   */
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(() => new Set())
  /** 本轮新出现、要播入场动画的那几条（只对「更新」成功后新上架的帖生效）。 */
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set())
  const [sheetSources, setSheetSources] = useState<readonly FeedSource[] | null>(null)
  /** 全屏媒体查看器：null = 关闭；否则记住「哪条动态的第几张」。 */
  const [mediaView, setMediaView] = useState<{ items: readonly FeedMedia[]; index: number } | null>(null)
  /** 进度弹卡是否打开（点右上角更新状态切换）。 */
  const [progressOpen, setProgressOpen] = useState(false)
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const [runStep, setRunStep] = useState(0)
  const [blocked, setBlocked] = useState(0)
  /** 每分钟重算相对时间用的时钟（月日不受影响，但「N 分钟前」要跟着走）。 */
  const [now, setNow] = useState(() => Date.now())
  /**
   * 每秒跳动的时钟：**只在进度弹卡开着时才跑**。
   *
   * 弹卡里的「已用时间」要一秒一跳；弹卡关着时没有任何地方消费秒级精度
   * （卡片上是年月日 + 分钟），多一个每秒 setState 只会让整个面板每秒钟重渲染
   * 一次列表 —— 那是纯浪费。
   */
  const [tick, setTick] = useState(() => Date.now())
  /**
   * 本轮是本地几点点的「更新」（0 = 不是本地发起）。
   *
   * 用途：点下更新到 host 把这一轮写进 runs 之间有 1~2 秒的空窗，这段里
   * 「已用时间」必须能开始计时，否则弹卡会先空几秒再突然跳到 3 秒。
   */
  const [localStartedAt, setLocalStartedAt] = useState(0)

  const toastSeq = useRef(0)
  const mounted = useRef(true)
  const firstLoad = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /** 弹一条提示（3.2s 自动消失）。 */
  const toast = useCallback((text: string, icon: ToastItem['icon'] = 'info'): void => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts((prev) => [...prev, { id, text, icon }])
    setTimeout(() => {
      if (!mounted.current) return
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 3200)
  }, [])

  /* ── 加载：列表 ─────────────────────────────────────────────────────
   * 固定按 channel='all' 拉**全量**：左栏每个频道的未读角标、主题清单都从同一份
   * 数据算，切频道只是本地过滤（不再往返一次，也不会出现「切过去先空一下」）。
   * host 侧 /posts 支持 channel 参数，将来要分页/分频道按需拉可以改这里。 */
  const loadPosts = useCallback(async (opts: { silent?: boolean } = {}): Promise<void> => {
    const result = await fetchFeedPosts('all')
    if (!mounted.current) return
    if (!result.ok) {
      setLoadError(result.message)
      if (!opts.silent) {
        // 首屏失败：把 days 置空数组（不是 null）——null 会让页面走骨架屏永远转下去。
        setDays([])
      }
      return
    }
    setLoadError(null)
    setDays(result.data)
    firstLoad.current = false
  }, [])

  /**
   * 拉关注账号（左栏「按账号」分组用）。
   *
   * 失败**不再静默退回空列表**（2026-10-28 用户报「刚启动服务后账号不显示」）：
   *   · 服务刚启动/重启的几秒里插件路由可能还没挂好，首次请求失败很正常；
   *   · 以前一次失败就永久空着，界面还写着「还没有关注账号，去设置里添加」——
   *     用户以为账号被删了。
   * 现在：失败自动重试 2 次（1.2s / 3s），仍失败则把状态标成 error，
   * 左栏显示「账号没加载出来 · 点击重试」而不是「还没有关注账号」。
   */
  const loadEntities = useCallback(async (): Promise<void> => {
    setEntitiesState((previous) => (previous === 'ready' ? previous : 'loading'))
    const delays = [0, 1200, 3000]
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (attempt > 0) await new Promise<void>((resolve) => { setTimeout(resolve, delays[attempt]) })
      if (!mounted.current) return
      try {
        const result = await fetchFeedEntities()
        if (result.ok) {
          setEntities(result.data)
          setEntitiesState('ready')
          return
        }
      } catch {
        // 继续下一次尝试；全部失败才落到 error 态。
      }
    }
    if (mounted.current) setEntitiesState('error')
  }, [])

  const loadConfig = useCallback(async (): Promise<void> => {
    const result = await fetchFeedConfig()
    if (!mounted.current || !result.ok) return
    setConfig(result.data)
  }, [])

  /**
   * 拉模型目录。
   *
   * fetchFeedModels **永不抛**，所以这里不需要 try/catch；它最差也返回
   * source:'none' + 空列表，页面此时只剩「跟随系统默认」一项 —— 那正是
   * 设计好的降级形态，不是错误态（所以不弹 toast、不写 loadError：
   * 模型列表拉不到不该把整个「动态」页标成坏的）。
   *
   * 依赖 configuredId：配置拉回来后要用**已配置的**模型 id 再拉一次，否则
   * 「用户选过、但已从目录里消失」的那个 id 不会被补进候选，select 会因为没有
   * 匹配项而跳到第一项 —— 看起来像「页面自己把我的设置改了」。
   */
  const loadCatalog = useCallback(async (configuredId: string): Promise<void> => {
    const result = await fetchFeedModels(configuredId)
    if (!mounted.current || !result.ok) return
    setCatalog(result.data)
    // 「固定选择」：只认**第一次**拉到的真实目录，之后的刷新不再改选项。
    if (result.data.models.length > 0) {
      setFixedModels((previous) => previous ?? result.data.models)
    }
  }, [])

  const loadStatus = useCallback(async (): Promise<FeedStatus | null> => {
    const result = await fetchFeedStatus()
    if (!mounted.current || !result.ok) return null
    setStatus(result.data)
    return result.data
  }, [])

  // 首屏：五个请求并行发，任何一个失败都不影响其它几块（各自兜底）。
  useEffect(() => {
    void loadPosts()
    void loadConfig()
    void loadStatus()
    void loadCatalog(FOLLOW_DEFAULT)
    void loadEntities()
  }, [loadPosts, loadConfig, loadStatus, loadCatalog, loadEntities])

  /*
   * 回到前台 / 窗口聚焦时补拉关注账号（2026-10-28「重启服务后账号不显示」）。
   *
   * 典型场景：DSH 服务重启，浏览器标签一直挂着没刷新；重启那几秒里客户端
   * 发过一轮请求、失败后（老代码）就再也不试了 —— 用户切回来看到「还没有关注账号」。
   * 这里在用户回到页面时补一次，服务已就绪就能自动恢复，不用手动刷新页面。
   */
  useEffect(() => {
    const refresh = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void loadEntities()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadEntities])

  /*
   * 配置一到手就用**已配置的**模型 id 重拉一次目录。
   *
   * 首屏那一次只能拿 'default' 去拉（配置还没回来），拿不到「用户选过的那个
   * 已消失的 id」；这里补第二次。catalog 不进依赖 —— 否则它自己就是这次
   * setState 的结果，会打成死循环。判据用 config.model（配置只会因为用户保存
   * 或 host 回包而变化，频率天然很低）。
   */
  const configuredModel = config.model
  useEffect(() => {
    void loadCatalog(configuredModel)
  }, [configuredModel, loadCatalog])

  // 每分钟重算一次「N 分钟前」，让相对时间文案跟着真实时间走。
  useEffect(() => {
    const timer = setInterval(() => {
      if (mounted.current) setNow(Date.now())
    }, CLOCK_TICK_MS)
    return () => { clearInterval(timer) }
  }, [])

  /**
   * 秒级时钟：**只在进度弹卡打开时跑**。
   *
   * 弹卡里的「已用时间」要一秒跳一格，而弹卡关着时没有任何地方消费秒级精度
   * （卡片上是年月日 + 分钟粒度）。无条件每秒 setState 会让整个列表每秒重渲染
   * 一次，纯浪费。
   */
  useEffect(() => {
    if (!progressOpen) return
    const timer = setInterval(() => {
      if (mounted.current) setTick(Date.now())
    }, PROGRESS_TICK_MS)
    return () => { clearInterval(timer) }
  }, [progressOpen])

  /**
   * 「是否正在更新」。
   *
   * host 的 running 是权威，但有两个它答不上的窗口，都要兜：
   *  1. 点下更新后到 host 写入 runs 之间（refreshing 为真）；
   *  2. host 的 running 已经回落、但本地点下还不到 LOCAL_RUN_WINDOW_MS ——
   *     这段里如果立刻显示「上次更新」，看起来就像点了没反应。
   * 兜底有**上限**：窗口一过仍以 host 为准，不能永远停在自己编的「更新中」上。
   */
  const isUpdating = status?.running === true
    || refreshing
    || (localStartedAt > 0 && Date.now() - localStartedAt < LOCAL_RUN_WINDOW_MS)
  const running = isUpdating

  useEffect(() => {
    if (!running) return
    let stop = false
    const tick = async (): Promise<void> => {
      const next = await loadStatus()
      if (stop || next === null) return
      if (!next.running) {
        // 这一轮跑完了：重新拉列表（新动态在最上面），并对新出现的那几条播入场。
        const before = new Set<string>()
        for (const day of days ?? []) for (const post of day.items) before.add(post.id)
        const result = await fetchFeedPosts('all')
        if (stop || !mounted.current) return
        setRefreshing(false)
        setRunStep(0)
        // 本轮结束：本地占位起点可以退休了，之后一切以 host 的 runs 为准。
        setLocalStartedAt(0)
        if (result.ok) {
          const incoming = new Set<string>()
          for (const day of result.data) for (const post of day.items) if (!before.has(post.id)) incoming.add(post.id)
          setFreshIds(incoming)
          setDays(result.data)
          if (incoming.size > 0) {
            toast(`已生成 ${incoming.size} 条新动态`, 'ok')
          } else if (next.lastRunStatus === 'skipped') {
            toast('本轮更新完成 · 暂无新内容（候选均与已有动态重复）', 'info')
          } else if (next.lastRunStatus === 'failed') {
            toast('本轮更新未成功：' + (next.lastRunError || '未产出内容'), 'info')
          } else {
            toast('动态已更新', 'ok')
          }
        }
        void loadEntities()
      } else {
        setRunStep((step) => (step + 1) % RUN_STEPS.length)
      }
    }
    const timer = setInterval(() => { void tick() }, STATUS_POLL_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [running, loadStatus, days, toast, loadEntities])

  /* ── 派生态：频道清单 / 过滤后的分组 ──────────────────────────────── */

  /** 摊平所有动态（保留 days 的分组信息，用于分组渲染）。 */
  const allPosts = useMemo<readonly FeedPost[]>(() => {
    const list: FeedPost[] = []
    for (const day of days ?? []) list.push(...day.items)
    return list
  }, [days])

  /**
   * 左栏频道清单：固定的两项 + 数据里出现过的主题。
   *
   * 主题的中文名直接用 topic id（host 生成时写的就是可读串）；如果 host 将来
   * 下发 topic 目录，只需要在这里换一次映射，其它地方都用 ChannelId 走。
   */
  const channels = useMemo<ReadonlyArray<{ id: ChannelId; name: string; desc: string }>>(() => {
    const seen = new Map<string, number>()
    for (const post of allPosts) {
      for (const topic of post.topics) {
        if (topic === 'mine') continue
        seen.set(topic, (seen.get(topic) ?? 0) + 1)
      }
    }
    /*
     * 主题频道**收窄显示**（用户截图实测有 13+ 个，左栏变成一长串标签）。
     *
     * 判据在 pickTopicChannels 里：只留 ≥2 条的、最多 6 个、按条数降序，并且
     * **当前选中的那个一定保留**（否则点进只有 1 条的主题后它自己消失，
     * 选中态悬空、还切不回去）。完整主题集仍然从 topics 里算，只是不都摆出来。
     */
    const topics = [...seen.entries()].map(([id, count]) => ({ id, name: id, count }))
    const picked = pickTopicChannels(topics, channel)
    const dynamic = picked.map((item) => ({
      id: item.id as ChannelId,
      name: item.name,
      desc: String(item.count) + ' 条动态',
    }))
    return [...FIXED_CHANNELS, ...dynamic]
  }, [allPosts, channel])


  /** 某频道是否含这条（mine 语义：topics 里有 'mine'，或就是你自己的那条）。 */
  /*
   * 分组视图的数据（用户 2026-10-28：「左侧加tab分类全部、按账号、按分类」）。
   *
   * 三个 tab 共用同一份 days 数据，只是**呈现方式**不同：
   *   all    → 不显示分组列表
   *   entity → 列出关注账号 + 每个账号名下的动态数
   *   topic  → 列出动态里出现过的 topics + 每个分类的条数
   * 选中某一项后，右侧列表按它过滤（filteredDays 用同一个谓词，不各算一套）。
   */
  /** 账号 id → 该账号名下的动态数。 */
  const entityCounts = useMemo<ReadonlyMap<string, number>>(() => {
    const map = new Map<string, number>()
    for (const post of allPosts) {
      for (const id of post.entityIds ?? []) map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [allPosts])
  /** 分类名 → 条数（按条数降序，最多的排前面）。 */
  const topicList = useMemo<readonly { name: string; count: number }[]>(() => {
    const map = new Map<string, number>()
    for (const post of allPosts) {
      for (const topic of post.topics ?? []) {
        if (topic === 'mine') continue
        map.set(topic, (map.get(topic) ?? 0) + 1)
      }
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [allPosts])

  const inChannel = useCallback((post: FeedPost, id: ChannelId): boolean => {
    if (id === 'all') return true
    if (id === 'mine') return post.topics.includes('mine')
    return post.topics.includes(id)
  }, [])

  /** 当前频道内的全部动态（未过滤）。 */
  const channelPosts = useMemo<readonly FeedPost[]>(
    () => allPosts.filter((post) => inChannel(post, channel)),
    [allPosts, channel, inChannel],
  )



  /**
   * 只做**搜索**过滤，**一行排序都不做**。
   *
   * 用户原话：「按时间排序即可」。排序归 host（它下发什么顺序就渲染什么顺序）。
   * 前端此前的本地重排（过期沉底 → 未读优先 → 截止临近 → 时间倒序）整块删除：
   * 那是一套与「按时间」相冲突的优先级，留着就等于用户说了不算数。
   *
   * 这里连 sort 都不能出现 —— 即使「只是兜底按 createdAt 排一下」，遇到同一毫秒
   * 的多条也会引入与 host 不同的顺序，属于同一个错误换一种写法。
   */
  const visible = useMemo<readonly FeedPost[]>(() => {
    /*
     * 先按左栏的「按账号 / 按分类」分组过滤（用户 2026-10-28 要求），
     * 再做搜索过滤。顺序不能反：搜索是在「当前分组」里搜，不是全量搜完再分组 ——
     * 反过来的话，切到某个账号却搜出别的账号的内容，用户会以为分组坏了。
     */
    const scoped = (() => {
      if ((groupMode === 'entity' || groupMode === 'all') && selectedEntity !== null) {
        return channelPosts.filter((post) => (post.entityIds ?? []).includes(selectedEntity))
      }
      if (groupMode === 'topic' && selectedTopic !== null) {
        return channelPosts.filter((post) => (post.topics ?? []).includes(selectedTopic))
      }
      return channelPosts
    })()
    const q = query.trim().toLowerCase()
    if (q === '') return scoped
    return scoped.filter((post) => {
      const haystack = [
        post.title, post.body, post.dueLabel,
        post.topics.join(' '),
        post.sources.map((source) => source.title + ' ' + source.domain).join(' '),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [channelPosts, query, groupMode, selectedEntity, selectedTopic])

  /**
   * 按天分组的渲染结构（**只插标题，不重排**）。
   *
   * 按 host 下发的顺序走一遍，遇到「新的一天」就开一个新桶，桶按首次出现顺序
   * 排列。所以把所有桶首尾接起来一定等于 host 的原始顺序 —— 这就是「按时间
   * 排序即可」在渲染层的等价写法。
   *
   * 组标题带完整年月日（用户原话「每一条要显示出来年月日」，组标题同理）：
   *   今天 → 「今天 · 2026年10月27日」
   *   昨天 → 「昨天 · 2026年10月26日」
   *   更早 → 「2026年10月20日」
   * 取不到 createdAt（老 host 没给）时退回 host 的 label，绝不显示 1970 年。
   */
  /*
   * 按**发布时间**倒序（用户 2026-10-28：「时间应该是账号或者信息渠道来源他们
   * 发布的时间，而不是我们更新的时间」）。
   *
   * 为什么必须连排序一起改：卡头现在显示的是发布时间，如果列表仍按
   * post.createdAt（我们生成它的时刻）排，就会出现「上面 04:38、下面 23:07」
   * 这种看着像坏了的情况 —— 显示的时间与顺序必须用同一个口径。
   *
   * 排序是**稳定**的（Array.prototype.sort 在 V8 里稳定），同一发布时间的多条
   * 保持 host 下发的相对顺序，不会引入随机性。
   * 只在这一个地方排一次，渲染层不再动顺序。
   */
  const ordered = useMemo<readonly FeedPost[]>(() => {
    return [...visible].sort((a, b) => publishedAtOf(b) - publishedAtOf(a))
  }, [visible])

  const groups = useMemo<ReadonlyArray<{ key: string; label: string; items: readonly FeedPost[] }>>(() => {
    const buckets = new Map<string, { label: string; items: FeedPost[] }>()
    for (const post of ordered) {
      // 日期分组同样按发布时间，否则「今天」这一组里会混进昨天发的推文。
      const stamp = publishedAtOf(post)
      const key = stamp > 0 ? dateKeyOf(stamp) : 'unknown'
      let bucket = buckets.get(key)
      if (bucket === undefined) {
        bucket = { label: dayHeadingText(stamp, now), items: [] }
        buckets.set(key, bucket)
      }
      bucket.items.push(post)
    }
    return [...buckets.entries()].map(([key, bucket]) => ({ key, label: bucket.label, items: bucket.items }))
  }, [ordered, now])

  /* ── 动作 ────────────────────────────────────────────────────────── */

  /*
   * 展开 / 收起讨论区。
   *
   * 「展开即已读」那一套随未读红点一起删掉了（用户要求去掉红点，那就没有
   * 任何地方消费「已读」这个状态）：留着 markRead 只会写一份没人读的 state，
   * 还多一个渲染源。所以这两个 toggle 现在只做纯展开/收起。
   *
   * ⚠ 仍然不能在 setState 的 updater 里写另一个 state（updater 必须是纯函数，
   * React 会重放它，StrictMode 下还会故意调两次）。
   */
  const toggleOpen = useCallback((id: string): void => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** 展开 / 收起正文（默认 3 行截断）。 */
  const toggleBody = useCallback((id: string): void => {
    setBodyOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

/**
 * 点赞：先乐观改，失败**精确回滚**并提示。
 *
 * ── 回滚不要用「整表快照」（2026-10-27 修）───────────────────────────
 * 初版在 setDays 的 updater 里抓 prev 存成 snapshot，失败时 setDays(snapshot)。
 * 两个问题：
 *   1. updater 必须是纯函数，React 会重放它；在里面写外部变量拿到的可能是
 *      某一帧的中间值，不是「点之前」那一份；
 *   2. 整表回滚会把**这段时间里其它操作的结果一起冲掉**（比如刚发的讨论、
 *      另一张卡的点赞）。点赞只改了一个布尔和一个数字，就该只回滚这两个。
 *
 * 现在只要记住「点之前它是什么」，失败时按原值写回那一条。
 */
const like = useCallback((id: string): void => {
  // 先记下这一条的原值（点赞只动 liked / likes 两个字段）。
  let before: { liked: boolean; likes: number } | null = null
  for (const day of days ?? []) {
    const hit = day.items.find((post) => post.id === id)
    if (hit !== undefined) { before = { liked: hit.liked, likes: hit.likes }; break }
  }
  if (before === null) return
  const origin = before

  // 乐观更新：只动这一条。
  setDays((prev) => prev === null ? prev : prev.map((day) => ({
    ...day,
    items: day.items.map((post) => post.id === id
      ? { ...post, liked: !post.liked, likes: post.likes + (post.liked ? -1 : 1) }
      : post),
  })))

  void (async () => {
    const result = await toggleFeedLike(id)
    if (!mounted.current) return
    if (!result.ok) {
      // 精确回滚到点之前的值（不碰其它条目、不碰其它字段）。
      setDays((prev) => prev === null ? prev : prev.map((day) => ({
        ...day,
        items: day.items.map((post) => post.id === id
          ? { ...post, liked: origin.liked, likes: origin.likes }
          : post),
      })))
      toast('点赞没成功：' + result.message, 'info')
      return
    }
    // 成功则以 host 回来的这条为准（它才是真值，含最终 likes / liked）。
    const post = result.data
    setDays((prev) => prev === null ? prev : prev.map((day) => ({
      ...day,
      items: day.items.map((item) => (item.id === post.id ? post : item)),
    })))
  })()
}, [days, toast])

/**
 * 删除：先播退场动画，**等请求真的成功才把数据摘掉**。
 *
 * ── 这里踩过一个真 bug（2026-10-27 实测揪出）─────────────────────────
 * 初版是「乐观删除」：起一个 260ms 的定时器，时间一到就从 days 里剔掉卡片，
 * 请求失败时 clearTimeout 回滚。它只在「失败发生在 260ms 内」时才救得回来。
 * 真实服务对未挂载的路由往往几百毫秒才回（甚至超时），于是：
 *   260ms 卡片已消失 → 稍后请求失败 → clearTimeout 扑空 → 卡片永久消失，
 * 刷新后 host 又把这条吐回来。用户看到的就是「删了又回来」。
 *
 * 现在的分工：
 *   · leavingIds  = **视觉**（淡出 + 左移），动画跑完就撤标记；
 *   · days        = **数据**，只有 ok:true 才动。
 * 失败时卡片自然还在原地（只是重播一次入场），并且弹 toast 说清原因。
 * 这样即使请求要 10 秒才超时，界面也永远与真实状态一致。
 */
const remove = useCallback((id: string): void => {
  setLeavingIds((prev) => new Set(prev).add(id))
  // 260ms = 原型 gone 动画时长（样式表 .fd-dyn[data-gone] 的 transition 0.3s）。
  // 只撤视觉标记，不动数据 —— 见上面那段说明。
  const fadeTimer = setTimeout(() => {
    if (!mounted.current) return
    setLeavingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, 260)

  void (async () => {
    const result = await deleteFeedPost(id)
    if (!mounted.current) {
      clearTimeout(fadeTimer)
      return
    }
    if (!result.ok) {
      clearTimeout(fadeTimer)
      setLeavingIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      toast('删除没成功：' + result.message, 'info')
      return
    }
    // 到这里才是真删：把数据摘掉（这一步之后卡片不可能再出现，直到 host 重新下发）。
    setDays((prev) => prev === null ? prev : prev
      .map((day) => ({ ...day, items: day.items.filter((post) => post.id !== id) }))
      .filter((day) => day.items.length > 0))
    setLeavingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    toast('已删除，不会再出现', 'trash')
  })()
}, [toast])

  /** 发表讨论：成功返回 true（输入框自行清空）。 */
  const comment = useCallback(async (id: string, text: string): Promise<boolean> => {
    const result = await postFeedComment(id, text)
    if (!mounted.current) return false
    if (!result.ok) {
      toast('讨论没发出去：' + result.message, 'info')
      return false
    }
    const post = result.data
    setDays((prev) => prev === null ? prev : prev.map((day) => ({
      ...day,
      items: day.items.map((item) => (item.id === post.id ? post : item)),
    })))
    setOpenIds((prev) => new Set(prev).add(id))
    return true
  }, [toast])

  /** 打开原文来源：多来源时弹浮层（单来源由 PostCard 直接渲染成真链接）。 */
  const openSources = useCallback((sources: readonly FeedSource[]): void => {
    setSheetSources(sources)
  }, [])

  /**
   * 点「更新」：走单飞锁，host 回 started / queued / rejected。
   *
   * 这里同时记下**本地开始时刻**：点下去到 host 把这一轮写进 runs 之间有 1~2 秒
   * 空窗，进度弹卡要靠它立刻开始计「已用时间」，而不是先空几秒。
   */
  const runUpdate = useCallback((): void => {
    if (isUpdating) {
      setBlocked((n) => n + 1)
      toast('上一轮还没跑完，这次不重复启动', 'info')
      return
    }
    setRefreshing(true)
    setRunStep(0)
    setLocalStartedAt(Date.now())
    setTick(Date.now())
    void (async () => {
      const result = await refreshFeed()
      if (!mounted.current) return
      if (!result.ok) {
        setRefreshing(false)
        setLocalStartedAt(0)
        toast('更新没启动：' + result.message, 'info')
        return
      }
      if (result.data === 'queued') {
        toast('上一轮还没跑完，这次已排队（会合并进本轮）', 'info')
        void loadStatus()
        return
      }
      if (result.data === 'rejected') {
        setRefreshing(false)
        setLocalStartedAt(0)
        setBlocked((n) => n + 1)
        toast('上一轮还没跑完，这次不重复启动', 'info')
        return
      }
      toast('已开始生成新动态…', 'ok')
      void loadStatus()
    })()
  }, [isUpdating, toast, loadStatus])

  /** 手动仅刷新列表数据（不消耗 token 重新生成）。 */
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const handleManualRefresh = useCallback(async (): Promise<void> => {
    if (manualRefreshing) return
    setManualRefreshing(true)
    try {
      await Promise.all([
        // silent: 刷新失败时保留当前列表（只是提示失败），绝不把已看到的动态清空。
        loadPosts({ silent: true }),
        loadStatus(),
        loadEntities(),
      ])
      toast('动态列表已刷新', 'ok')
    } catch {
      toast('刷新失败，请检查服务', 'info')
    } finally {
      if (mounted.current) {
        setTimeout(() => { if (mounted.current) setManualRefreshing(false) }, 500)
      }
    }
  }, [manualRefreshing, loadPosts, loadStatus, loadEntities, toast])

  /** 打开设置：把当前配置回填进草稿。 */
  const openSetup = useCallback((): void => {
    setPromptDraft(config.prompt)
    setModelDraft(config.model === '' ? 'default' : config.model)
    setSetupOpen(true)
  }, [config])

  /**
   * 保存设置。
   *
   * 两种改动分别对应设计文档 §5.3/§5.4：提示词**实质**改动 → host 自己触发一轮
   * 生成（进入刷新状态并自动轮询更新）；只改模型 → 下一轮生效，界面提示一下。
   */
  const saveSetup = useCallback((): void => {
    const prompt = promptDraft.trim()
    const model = modelDraft
    const promptChanged = normalizePrompt(prompt) !== normalizePrompt(config.prompt)
    const modelChanged = model !== config.model
    if (!promptChanged && !modelChanged) {
      setSetupOpen(false)
      toast('设置未做改动', 'info')
      return
    }
    setSavingConfig(true)
    void (async () => {
      const result = await saveFeedConfig({
        ...(promptChanged ? { prompt } : {}),
        ...(modelChanged ? { model } : {}),
      })
      if (!mounted.current) return
      setSavingConfig(false)
      if (!result.ok) {
        toast('设置没保存：' + result.message, 'info')
        return
      }
      setConfig(result.data)
      setSetupOpen(false)
      if (promptChanged) {
        setRefreshing(true)
        setRunStep(0)
        setLocalStartedAt(Date.now())
        setTick(Date.now())
        toast('提示词已更新，正在重新生成…', 'ok')
        void loadStatus()
      } else {
        toast('已切换生成模型为 ' + modelLabel(result.data.model, catalog) + '（下轮生效）', 'ok')
      }
    })()
  }, [promptDraft, modelDraft, config, toast, loadStatus, catalog])

  /* ── 编辑面板的键盘：⌘/Ctrl+Enter 保存、Esc 取消 ── */
  const onPromptKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      saveSetup()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setSetupOpen(false)
    }
  }

  /* ── 空态文案 ─────────────────────────────────────────────────────── */

  const emptyTitle: string = (() => {
    if (query.trim() !== '') return '没有匹配「' + query.trim() + '」的动态'
    if (loadError !== null) return '还没有动态，点更新试试'
    if (channel !== 'all' && channel !== 'mine') return '这个主题还是空的'
    return '还没有动态，点更新试试'
  })()

  const emptyHint: string = (() => {
    if (query.trim() !== '') return '换个关键词试试'
    if (loadError !== null) return loadError
    return '点右上角「更新」生成一轮'
  })()

  /* ── 渲染 ─────────────────────────────────────────────────────────── */

  const loading = days === null
  /*
   * 顶部状态条要显示的是**实际生效**的模型，不是配置里的那个字符串。
   *
   * 三种情形（用户原话：「选中我们现在的这个模型然后实际测试」——所以必须看得出
   * 「现在到底是谁在写」）：
   *   · 配置是具体 id  → 就是它（下一轮用它）；
   *   · 配置是 default 且目录报了系统默认 → 显示那个真实模型名；
   *   · 配置是 default 但拿不到系统默认 → 显示「跟随系统默认」，**不编名字**。
   */
  const effective = effectiveModelOf(config.model, catalog, status)
  const modelName = effective.label
  /*
   * 顶部那行副标题：进行中显示当前阶段，空闲显示「静默上架，不发推送」。
   *
   * 「几点更新过」**不再放这里** —— 它搬到了右上角那枚常驻状态里（用户要求
   * 「在右上角显示当前更新状态」），带完整年月日。同一件事在一屏里写两遍，
   * 读的人会先怀疑哪个才是准的。
   */
  const progress = runProgressOf(status, tick, localStartedAt)
  const bioState = running
    ? <span><b>{progress.phase}</b></span>
    : <span><b>静默上架</b>，不发推送</span>

  /*
   * 下拉候选：首项「跟随系统默认」+ **固定快照**里的真实模型。
   *
   * 「固定」的含义（用户 2026-10-28：「生成模型改为固定选择」）：
   *   · 候选来自进页面时那一次真实目录快照（fixedModels），后续刷新不改变选项；
   *   · 目录拉不到时 fixedModels 为 null，列表只剩「跟随系统默认」——
   *     这是设计好的降级形态，不编任何假模型名。
   * 另外保留「当前配置了但不在快照里」的那一项，否则 select 找不到匹配项会
   * 跳到第一项，看起来像「页面自己把我的设置改了」。
   */
  const modelOptions = useMemo<ReadonlyArray<{ value: string; label: string }>>(() => {
    const source = fixedModels ?? catalog.models
    const list: Array<{ value: string; label: string }> = [
      { value: FOLLOW_DEFAULT, label: followDefaultLabel(catalog.current) },
    ]
    // 同名模型（同 label 不同 provider）只留第一个：下拉里出现三行
    // 「DeepSeek-V4.1-Flash」时用户根本分不清选的是哪一个。
    const seenLabels = new Set<string>()
    for (const option of source) {
      if (option.id === FOLLOW_DEFAULT) continue
      if (seenLabels.has(option.label)) continue
      seenLabels.add(option.label)
      list.push({ value: option.id, label: option.label })
    }
    const current = modelDraft.trim()
    if (current !== '' && current !== FOLLOW_DEFAULT && !list.some(item => item.value === current)) {
      const hit = source.find(item => item.id === current)
      list.push({ value: current, label: (hit !== undefined ? hit.label : current) + '（已配置）' })
    }
    return list
  }, [fixedModels, catalog.current, catalog.models, modelDraft])

  return (
    <div className="fd-root">
      {/*
        设置页（用户 2026-10-28：「设置放单独的二级菜单变成设置页面」）。
        从「弹卡」改成「整页」：提示词 + 模型 + 关注对象三块内容放进弹卡太挤，
        而且弹卡盖住动态流，改完提示词想对照着看效果还得先关掉。
        左栏底部「设置」与右上角的状态卡都能进；顶部一条返回回动态流。
      */}
      {view === 'settings' ? (
        <div className="fd-setpage">
          <header className="fd-setpage-hd">
            <button
              className="fd-pill"
              type="button"
              onClick={() => { setView('feed') }}
            >
              ← 返回动态
            </button>
            <h1 className="fd-setpage-ttl">设置</h1>
          </header>
          <div className="fd-setpage-bd">
            <section className="fd-setpage-sec">
              <label className="fd-setpage-lbl" htmlFor="fd-prompt">提示词</label>
              <p className="fd-setpage-tip">写一句你想让我盯的东西。提示词实质改变后会立刻生成一轮。</p>
              <textarea
                id="fd-prompt"
                className="fd-setpage-ta"
                maxLength={800}
                placeholder="比如：盯住健身与睡眠，只收一手来源"
                value={promptDraft}
                onChange={(event) => { setPromptDraft(event.currentTarget.value) }}
              />
            </section>
            <section className="fd-setpage-sec">
              <label className="fd-setpage-lbl" htmlFor="fd-model">生成模型</label>
              <p className="fd-setpage-tip">选项按进入页面时真实可用的模型固定（刷新不会改动选项）；选「跟随系统默认」就用你当前会话在跑的模型。</p>
              <select
                id="fd-model"
                className="fd-m-select"
                value={modelDraft}
                onChange={(event) => { setModelDraft(event.currentTarget.value) }}
              >
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </section>
            <section className="fd-setpage-sec">
              <span className="fd-setpage-lbl">关注的对象</span>
              <p className="fd-setpage-tip">这些账号的动态会进「按账号」分组，也决定生成时优先写谁。</p>
              <EntitySettings />
            </section>
            <div className="fd-setpage-act">
              <span className="fd-setpage-tip">保存后立即生效</span>
              <button
                className="fd-pill"
                type="button"
                onClick={() => { setView('feed') }}
                disabled={savingConfig}
              >
                取消
              </button>
              <button
                className="fd-pill"
                data-solid="true"
                type="button"
                onClick={() => { saveSetup() }}
                disabled={savingConfig}
              >
                {savingConfig ? '保存中' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : (
      <div className="fd-page">

        {/* ══════ 左栏：动态主题 ══════ */}
        <aside className="fd-side">
          <div className="fd-side-top">
            <span className="fd-side-ttl">动态主题</span>
            <div className="fd-side-top-actions">
              {/*
                「刷新」按钮（2026-10-28 用户：「刷新机制需要修复下」）。
                它只重新拉**列表 / 状态 / 关注账号**，不触发新的生成、不消耗 token；
                与右下角「更新」（真跑一轮生成）是两件事，所以分开放。
                刷新中图标转圈、按钮禁用，避免连点打出一串请求。
              */}
              <button
                className={'fd-side-mag' + (manualRefreshing ? ' fd-spinning' : '')}
                type="button"
                title={manualRefreshing ? '正在刷新…' : '刷新列表'}
                aria-label="刷新列表"
                disabled={manualRefreshing}
                onClick={() => { void handleManualRefresh() }}
              >
                <IconRefresh size={15} />
              </button>
              <button
                className="fd-side-mag"
                type="button"
                title="搜索"
                aria-label="搜索"
                aria-expanded={searchOpen}
                onClick={() => {
                  setSearchOpen((open) => {
                    if (open) setQuery('')
                    return !open
                  })
                }}
              >
                <IconSearch />
              </button>
            </div>
          </div>
          <div className="fd-side-search" data-on={searchOpen ? 'true' : undefined}>
            <input
              type="search"
              placeholder="搜索标题、正文、来源"
              autoComplete="off"
              aria-label="搜索动态"
              value={query}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('')
                  setSearchOpen(false)
                }
              }}
            />
          </div>

          {/*
            三档分组 tab（用户 2026-10-28：「左侧加tab分类全部、按账号、按分类」）。
            分组只改**左栏怎么列**与「右侧看哪一批」，不改数据、不改顺序。
          */}
          <div className="fd-gtabs" role="tablist" aria-label="分组方式">
            {([
              { id: 'all', label: '全部' },
              { id: 'entity', label: '按账号' },
              { id: 'topic', label: '按分类' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                className="fd-gtab"
                type="button"
                role="tab"
                aria-selected={groupMode === tab.id}
                onClick={() => { setGroupMode(tab.id) }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/*
            分组列表：
              · 按账号 → 关注账号 + 各自条数（点一个只看它）
              · 按分类 → 动态里出现过的 topics + 条数
              · 全部   → 不列子项（列表就是全部动态，见右侧）
          */}
          {/* 「全部」与「按账号」都列出账号（2026-10-28 用户反馈：「为什么只有设置里面有头像」）。
              他默认停在「全部」，而那一档原本左栏什么都不画 —— 一进页面看到空左栏，
              自然以为头像只存在于设置页。两档的区别现在只在于分组语义，左栏都不再是空的。 */}
          {groupMode === 'entity' || groupMode === 'all' ? (
            <div className="fd-glist">
              <button
                className="fd-gitem"
                type="button"
                aria-pressed={selectedEntity === null}
                onClick={() => { setSelectedEntity(null) }}
              >
                <span className="fd-gname">全部账号</span>
                <span className="fd-gcount">{allPosts.length}</span>
              </button>
              {entities.length === 0 ? (
                entitiesState === 'error' ? (
                  // 加载失败 ≠ 没有关注账号：给一个就地重试的出口（服务刚启动时最常见）。
                  <div className="fd-gempty">
                    账号没加载出来
                    <br />
                    <button
                      className="fd-gretry"
                      type="button"
                      onClick={() => { void loadEntities() }}
                    >
                      点击重试
                    </button>
                  </div>
                ) : entitiesState === 'loading' ? (
                  <div className="fd-gempty">账号加载中…</div>
                ) : (
                  <div className="fd-gempty">还没有关注账号<br />去设置里添加</div>
                )
              ) : entities.map((entity) => (
                <button
                  key={entity.id}
                  className="fd-gitem"
                  type="button"
                  aria-pressed={selectedEntity === entity.id}
                  onClick={() => { setSelectedEntity(entity.id) }}
                  title={entity.xHandle === undefined ? entity.name : '@' + entity.xHandle}
                >
                  <EntityAvatar entity={entity} />
                  <span className="fd-gname">{entity.name}</span>
                  <span className="fd-gcount">{entityCounts.get(entity.id) ?? 0}</span>
                </button>
              ))}
            </div>
          ) : groupMode === 'topic' ? (
            <div className="fd-glist">
              <button
                className="fd-gitem"
                type="button"
                aria-pressed={selectedTopic === null}
                onClick={() => { setSelectedTopic(null) }}
              >
                <span className="fd-gname">全部分类</span>
                <span className="fd-gcount">{allPosts.length}</span>
              </button>
              {topicList.length === 0 ? (
                <div className="fd-gempty">还没有分类</div>
              ) : topicList.map((topic) => (
                <button
                  key={topic.name}
                  className="fd-gitem"
                  type="button"
                  aria-pressed={selectedTopic === topic.name}
                  onClick={() => { setSelectedTopic(topic.name) }}
                >
                  <span className="fd-gname">{topic.name}</span>
                  <span className="fd-gcount">{topic.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="fd-side-foot">
            <button
              type="button"
              onClick={() => { setView('settings') }}
            >
              <IconGear />设置
            </button>
          </div>
        </aside>

        {/* ══════ 主区 ══════ */}
        <main className="fd-main">
          {/*
            整个头部**已删除**（用户 2026-10-28：「删掉，然后把右上角的更新和点击
            弹出的卡片删掉」）。

            删掉的是三块：
              · 页面大标题「苏墨的动态」（更早一轮已删）；
              · 副标题行「后台按你的提示词生成 · 读取提示词与用户资料… · 模型：xxx」
                —— 这一行是**状态播报**，用户看动态时并不关心流水线走到哪一步；
              · 右上角那枚「更新状态」按钮，以及点它弹出的进度卡片（ProgressSheet）。

            更新动作本身还在：右下角那枚悬浮按钮就是唯一的更新入口，
            进度反馈改成按钮自身的「生成中」态。

          {/* 提示词与模型设置 —— **弹出卡片**（用户 2026-10-27 要求：「设置变成弹出卡片吧」）。

              原来是一块「页内展开」的区域（max-height 过渡），问题在于：
                · 展开后会把下面的动态流整体往下推，读到一半的列表跳位；
                · 设置内容越加越多（提示词 / 模型 / 关注对象），展开区越长，
                  把主内容挤到很下面；
                · 小屏上展开区一屏放不下，要滚很久才能看到「保存」。
              改成 portal 到 body 的居中浮层，与「原文来源」「更新进度」同一套
              .fd-pop 机制（遮罩点击关闭 / Esc 关闭 / 关闭按钮）。 */}

          {/* 生成状态条（进行中才出现；空闲时整条收起到 0 高） */}
          <div className="fd-gbar" data-on={running ? 'true' : undefined}>
            <span className="fd-sp" />
            <span className="fd-gbar-st">{running ? progress.phase : RUN_STEPS[runStep]}</span>
            <span className="fd-gbar-cnt" data-on={blocked > 0 ? 'true' : undefined}>
              已拦下 {blocked} 次
            </span>
          </div>

          {/* 筛选胶囊条（全部 / 未读 / 临近截止 / 已过期）**已整块删除**：
              用户原话「不需要显示这些」。列表现在是纯时间倒序，不再需要筛选入口。 */}

          {/* 动态列表：按天分组 */}
          <div className="fd-feed">
            {loading ? (
              <div className="fd-skel" aria-label="加载中">
                <i /><i /><i /><i />
              </div>
            ) : groups.length === 0 ? (
              <div className="fd-empty">
                <div className="fd-ic"><IconSearch size={18} /></div>
                <h3>{emptyTitle}</h3>
                <p>{emptyHint}</p>
              </div>
            ) : groups.map((group) => (
              <section key={group.key}>
                <div className="fd-dayhd">
                  <b data-today={group.key !== 'older' ? 'true' : undefined}>{group.label}</b>
                  <span>{group.items.length} 条</span>
                  <span className="fd-ln" />
                </div>
                {group.items.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    now={now}
                    query={query}
                    open={openIds.has(post.id)}
                    bodyOpen={bodyOpenIds.has(post.id)}
                    entering={freshIds.has(post.id)}
                    leaving={leavingIds.has(post.id)}
                    onToggleOpen={toggleOpen}
                    onToggleBody={toggleBody}
                    onLike={like}
                    onDelete={remove}
                    onOpenSources={openSources}
                    onComment={comment}
                    onOpenMedia={(target, index) => {
                      const items = target.media ?? []
                      if (items.length > 0) setMediaView({ items, index })
                    }}
                  />
                ))}
              </section>
            ))}
          </div>

          {/* 底部规则说明 */}
          <div className="fd-rules">
            <div className="fd-r">
              <IconInfo />
              <span>
                <b>来源</b>：公开可抓取的给要点＋原文链接；
                <b>X、公众号这类不开放抓取的，只给原文入口、不复制正文</b>；
                私密与付费墙内容直接丢弃；不转载、不编造链接。
              </span>
            </div>
            <div className="fd-r">
              <IconInfo />
              <span><b>节奏</b>：定时（12:00 / 18:00）· 提示词实质改动后 · 手动点更新。上一轮没跑完时不会重复启动。</span>
            </div>
          </div>
        </main>
      </div>
      )}

      {/*
        右下角「更新」按钮（用户 2026-10-28：「更新放右下角」）。
        fixed 定位、贴在内容区右下：动态流再长也不用滚回顶部才能点更新。
        设置页不显示它（那一页的主动作是保存）。
      */}
      {view === 'feed' ? (
        <button
          className="fd-fab"
          type="button"
          onClick={runUpdate}
          disabled={refreshing}
          title="生成一轮新动态"
          aria-label="更新"
        >
          <IconUp /><span>{refreshing ? '生成中' : '更新'}</span>
        </button>
      ) : null}

      {/*
        右侧「关注的对象」悬浮球**已删除**（用户 2026-10-28：「悬浮球可以删除了」）。
        原因：左栏现在有「按账号」分组 tab，点账号就能筛出它名下的动态 ——
        悬浮球与它是同一个功能的两套入口，留着反而多一层遮挡（它悬停会展开成一列球，
        盖住正文右侧）。
        EntityOrbs.tsx 文件保留（不删源码），只是不再挂载；将来若要换个位置复用得着。
      */}

      {/* 浮层与提示条都 portal 到 body：工作台容器是 overflow:hidden，留在里面会被裁掉 */}
      {sheetSources !== null ? (
        <SourceSheet sources={sheetSources} onClose={() => { setSheetSources(null) }} />
      ) : null}
      {/* 进度弹卡：点右上角更新状态弹出（task-9 的核心）。
          tick 是秒级时钟，只在弹卡打开时推进 —— 已用时间那个数字要每秒跳一格。 */}
      {/* 全屏媒体查看器（滚轮缩放 / 拖动 / 双击 / 左右切换） */}
      {mediaView !== null ? (
        <MediaViewer
          items={mediaView.items}
          index={mediaView.index}
          onClose={() => { setMediaView(null) }}
        />
      ) : null}
      {/*
        进度弹卡（ProgressSheet）**已删除**（用户 2026-10-28：「把右上角的更新和
        点击弹出的卡片删掉」）。它原本挂在右上角那枚状态按钮上，按钮没了它就没有入口。
        ProgressSheet 组件本身保留在文件里（未挂载），将来若要换个位置复用不必重写。
      */}
      {/* 设置弹卡（用户：「设置变成弹出卡片吧」）。草稿状态仍在 FeedPanel，
          这里只负责渲染；取消 = 关掉浮层（草稿下次 openSetup 时会被回填覆盖）。 */}
      {setupOpen ? (
        <SetupSheet
          promptDraft={promptDraft}
          modelDraft={modelDraft}
          modelOptions={modelOptions}
          saving={savingConfig}
          onPromptChange={setPromptDraft}
          onPromptKey={onPromptKey}
          onModelChange={setModelDraft}
          onCancel={() => { setSetupOpen(false) }}
          onSave={saveSetup}
        />
      ) : null}
      <ToastStack items={toasts} />
      {/* onClose 目前没有独立浮层可关（页面是工作台的一页），保留 prop 只为与其它面板同签名。 */}
      <span hidden>{String(onClose !== undefined)}</span>
    </div>
  )
}

/* ───────────────────────── 纯函数（供冒烟断言） ───────────────────────── */

/**
 * 提示词「实质」归一化（§5.3 的客户端镜像）。
 *
 * 只用来判断**有没有实质改动**：去空白、全角标点转半角、小写。改个空格或把
 * 逗号改成句号不算改动 —— 那种也要触发一轮生成的话，用户手滑就会烧掉一次调用。
 */
export function normalizePrompt(text: string): string {
  const mapped: Record<string, string> = {
    '，': ',', '。': '.', '；': ';', '、': ',', '！': '!', '？': '?',
  }
  return text
    .replace(/\s+/g, '')
    .replace(/[，。；、！？]/g, (ch) => mapped[ch] ?? ch)
    .toLowerCase()
}

/**
 * 模型 id → 下拉里显示的短名。
 *
 * 判定顺序：
 *  1. 'default' / 空 → 「跟随系统默认」（不带括号版本；带当前模型名的版本由
 *     {@link followDefaultLabel} 在渲染层用目录里的 current 拼）；
 *  2. 目录里能找到 → 目录给的 label（同名的已带供应商）；
 *  3. 找不到 → **原样显示这个 id**。绝不能返回「未在目录中」之外的假名字 ——
 *     显示一个用户没配过的模型名，比显示一串 id 误导得多。
 */
export function modelLabel(model: string, catalog?: FeedModelCatalog): string {
  if (model === '' || model === FOLLOW_DEFAULT) return '跟随系统默认'
  const hit = catalog?.models.find((option) => option.id === model)
  return hit === undefined ? model : hit.label
}

/** 顶部状态条要显示的东西，由一个纯函数算出来（供冒烟断言）。 */
export interface EffectiveModel {
  /** 显示的名字。 */
  readonly label: string
  /** hover 提示：解释这个名字是怎么来的。 */
  readonly hint: string
  /** 上一轮实际用过的模型（配置值与它不同时页面会额外显示一格）。 */
  readonly lastUsed: string | undefined
}

/**
 * 算出「实际生效的模型」（顶部状态条那一段的唯一真相）。
 *
 * 纯函数、无副作用，四种组合各自有明确口径 —— 这一格最容易变成「写死一个值
 * 假装真实」，所以把判定抽出来让冒烟能钉住：
 *
 *  | config.model | catalog.current | 显示 |
 *  |---|---|---|
 *  | 'default'    | 'auto/xxx'      | auto/xxx（跟随系统默认） |
 *  | 'default'    | ''              | 跟随系统默认（不编名字） |
 *  | 'auto/xxx'   | 任意            | auto/xxx |
 *
 * lastUsed 优先取 {@link FeedStatus.modelUsed}（host 上一轮实测），配置是
 * 'default' 时它还是**唯一**能反推「系统默认到底是谁」的线索，所以一并用作
 * catalog.current 的兜底。
 */
export function effectiveModelOf(model: string, catalog: FeedModelCatalog, status: FeedStatus | null): EffectiveModel {
  const lastUsed = status?.modelUsed !== undefined && status.modelUsed !== '' ? status.modelUsed : undefined
  // 「系统默认是谁」：目录接口给的 current 优先，其次看上一轮实测用了谁。
  const systemDefault = catalog.current !== '' ? catalog.current : (lastUsed ?? '')

  if (model !== '' && model !== FOLLOW_DEFAULT) {
    const label = modelLabel(model, catalog)
    const hint = label === model ? '设置里指定的生成模型' : '设置里指定的生成模型：' + model
    return { label, hint, lastUsed }
  }

  if (systemDefault !== '') {
    return {
      label: systemDefault,
      hint: '跟随系统默认：系统当前主模型就是 ' + systemDefault,
      lastUsed,
    }
  }

  return {
    label: '跟随系统默认',
    hint: '跟随系统默认（暂时读不到当前主模型名，下一轮跑完会显示实测结果）',
    lastUsed,
  }
}

/** 排序键（§6.1，导出供冒烟断言顺序口径）。 */
export function priorityKey(post: FeedPost, now: number): readonly [number, number, number] {
  return [
    isExpired(post, now) ? 2 : 1,
    post.read || isExpired(post, now) ? 1 : 0,
    post.dueAt > 0 && !isExpired(post, now) ? post.dueAt : Number.MAX_SAFE_INTEGER,
  ]
}

/** 来源可用性标签（导出供冒烟断言）。 */
export function accessLabel(access: FeedAccess): string {
  return access === 'limited' ? '需在平台查看' : '可直接打开'
}
