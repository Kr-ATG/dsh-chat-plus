/**
 * dsh-chat-plus — 阅读流里的一篇文章（右侧阅读器布局的唯一实现）。
 *
 * ── 视觉是「还原参考界面」，不是设计 ─────────────────────────────────
 * 用户给的参考截图是一篇长文的阅读器：顶部一行灰色小字元信息、下面一个
 * 约 30px 的粗标题、一张占满内容宽度的大图、再往下是宽松行高的正文段落，
 * 整体**纯色背景 + 一条分隔线**，没有卡片外框。
 *
 * 所以这里刻意**不画卡片**：没有 border-radius、没有背景色、没有阴影。
 * 之前那一版是「卡片流」（每条一个圆角盒子），用户明确要的是阅读流 ——
 * 区别不在于好不好看，而在于「一屏里能读多少字」：卡片的内距与边框会把
 * 可用行宽吃掉一截，长文读起来一直在断。
 *
 * ── DOM 结构（与截图逐行对应）──────────────────────────────────────
 *
 *   <article class="fd-art">
 *     <div class="fd-art-meta">      ← 2026/9/30 · Austin Kleon · 来源名(可点)
 *     <h2 class="fd-art-title">      ← 大标题（30px/800）
 *     <MediaGrid />                  ← 图片 / 视频（可点全屏、可播放）
 *     <div class="fd-art-body">      ← 正文，每段一个 <p>（\n 已拆开）
 *     <div class="fd-art-acts">      ← 讨论 / 点赞 / 删除
 *     <div class="fd-art-disc">      ← 讨论区（展开时）
 *   </article>
 *
 * ── 正文为什么必须拆段 ────────────────────────────────────────────
 * host 下发的 body 是模型现写的纯文本，换行是真实结构。整段塞进一个 <p>
 * 会被 HTML 压成一大坨没有段落的长文 —— 那正是阅读器要解决的问题。
 * 拆段口径在 progress.ts 的 splitParagraphs（纯函数，冒烟钉得住）。
 */
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { FeedComment, FeedPost, FeedSource } from './api.js'
import { MediaGrid } from './MediaGrid.js'
import { agoText, clockText, fullDateText, shortDateText, sourceLabelOf, splitParagraphs } from './progress.js'

export interface ReaderArticleProps {
  readonly post: FeedPost
  /** 这条动态归属的账号名（没有归属信息时为空串 → 元信息行用来源名顶上）。 */
  readonly authorName: string
  readonly now: number
  /** 搜索词（命中处标 <mark>）。 */
  readonly query: string
  /** 是否是左栏点中的那一条（高亮 + 滚动定位目标）。 */
  readonly active: boolean
  /** 讨论区是否展开。 */
  readonly discussionOpen: boolean
  /** 本轮新上架、要播入场动画。 */
  readonly entering: boolean
  /** 正在退场（删除动画）。 */
  readonly leaving: boolean
  readonly onToggleDiscussion: (id: string) => void
  readonly onLike: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onOpenSources: (sources: readonly FeedSource[]) => void
  readonly onComment: (id: string, text: string) => Promise<boolean>
  /** 点某张媒体 → 打开全屏查看器（参数是这条动态里的下标）。 */
  readonly onOpenMedia: (post: FeedPost, index: number) => void
}

/** 把命中关键词包成 <mark>（大小写不敏感，只标第一处）。 */
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

/** 是否已过期：有截止时间且已经过了。 */
function isExpired(post: FeedPost, now: number): boolean {
  return post.dueAt > 0 && post.dueAt < now
}

/**
 * 一篇文章（阅读器布局）。
 *
 * 交互与旧卡片版**完全一致**（点赞 / 讨论 / 删除 / 来源浮层），只换了视觉：
 * 从「卡片」变成「阅读流」。这样功能面零回归，用户看到的差别只有排版。
 */
export function ReaderArticle({
  post, authorName, now, query, active, discussionOpen, entering, leaving,
  onToggleDiscussion, onLike, onDelete, onOpenSources, onComment, onOpenMedia,
}: ReaderArticleProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pop, setPop] = useState(false)
  const expired = isExpired(post, now)

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
    // 回弹动画只播一次：480ms 后摘掉标记（连点会重播）。
    setTimeout(() => { setPop(false) }, 480)
    onLike(post.id)
  }

  /*
   * 元信息行中间那一位（作者）：
   *   · 有归属账号 → 账号名（这是「按账号分类」的落点，用户要能对上）；
   *   · 没有归属   → 来源名（真实数据，不编作者）。
   * 第三位是来源，单来源是真链接直开、多来源弹浮层 —— 与旧版卡头同一套行为。
   */
  const who = authorName !== '' ? authorName : sourceLabelOf(post)
  const sourceNode: JSX.Element = post.sources.length === 1 ? (
    <a
      className="fd-art-src"
      href={post.sources[0].url}
      target="_blank"
      rel="noopener noreferrer"
      title={'打开原文：' + post.sources[0].url}
    >
      {sourceLabelOf(post)}
    </a>
  ) : post.sources.length > 1 ? (
    <button
      className="fd-art-src"
      type="button"
      onClick={() => { onOpenSources(post.sources) }}
      title={'查看 ' + String(post.sources.length) + ' 个原文来源'}
    >
      {sourceLabelOf(post)}
    </button>
  ) : (
    <span className="fd-art-src" data-static="true">{sourceLabelOf(post)}</span>
  )

  const paragraphs = splitParagraphs(post.body)

  return (
    <article
      className="fd-art"
      data-active={active ? 'true' : undefined}
      data-enter={entering ? 'true' : undefined}
      data-gone={leaving ? 'true' : undefined}
      data-expired={expired ? 'true' : undefined}
      // 左栏点条目时 scrollIntoView 的锚点（样式表里用 scroll-margin-top 留出呼吸）。
      data-post-id={post.id}
    >
      {/* ① 元信息行：日期 · 作者 · 来源（小字灰色，与截图逐字对应） */}
      <div className="fd-art-meta">
        <span className="fd-art-date" title={fullDateText(post.createdAt)}>
          {shortDateText(post.createdAt)}
        </span>
        <span className="fd-art-dot" aria-hidden="true">·</span>
        <span className="fd-art-who">{who}</span>
        <span className="fd-art-dot" aria-hidden="true">·</span>
        {sourceNode}
        {post.topics.length > 0 ? (
          <>
            <span className="fd-art-dot" aria-hidden="true">·</span>
            <span className="fd-art-topic">{post.topics[0]}</span>
          </>
        ) : null}
        <span className="fd-art-ago">{agoText(post.createdAt, now)}</span>
        {expired ? <span className="fd-art-flag">已过期</span> : null}
      </div>

      {/* ② 大标题（约 30px 粗体）。空标题不画一个空盒子 —— 元信息行已经够了。 */}
      {post.title !== '' && post.title !== '（无标题）' ? (
        <h2 className="fd-art-title">{highlight(post.title, query)}</h2>
      ) : null}

      {/* ③ 媒体：没有 media 时整块不渲染（老 host / 纯文字动态都走这条路） */}
      <MediaGrid items={post.media} onOpen={(index) => { onOpenMedia(post, index) }} />

      {/* ④ 正文：每段一个 <p>，宽松行高。正文为空时整块不渲染（不留空段）。 */}
      {paragraphs.length === 1 && paragraphs[0] === '' ? null : (
        <div className="fd-art-body">
          {paragraphs.map((text, index) => (
            <p key={index}>{highlight(text, query)}</p>
          ))}
        </div>
      )}

      {/* ⑤ 操作行（讨论 / 点赞 / 删除）—— 功能与旧卡片版一致，只是位置在正文之后 */}
      <div className="fd-art-acts">
        <button
          className="fd-act"
          type="button"
          aria-expanded={discussionOpen}
          onClick={() => { onToggleDiscussion(post.id) }}
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
          title={post.liked ? '取消收藏' : '收藏'}
        >
          {/* 只显示 post.likes，**不要**再加 (liked ? 1 : 0)：契约里 likes 是
              host 算好的总数（已经包含自己那一票），liked 只表示「我点过没有」。 */}
          <IconHeart /><span className="fd-num">{post.likes}</span>
        </button>

        <span className="fd-grow" />
        <button className="fd-act" data-del="true" type="button" onClick={() => { onDelete(post.id) }} title="删除">
          <IconTrash />
        </button>
      </div>

      {/* ⑥ 讨论区 */}
      <div className="fd-disc" data-on={discussionOpen ? 'true' : undefined}>
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

/* ───────────────────────── 图标（内联 SVG，不引图标库） ───────────────────────── */

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
