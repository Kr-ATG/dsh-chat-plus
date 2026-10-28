/**
 * dsh-chat-plus — 左栏下半段：动态条目列表（标题 + 摘要 + 小缩略图 + 日期）。
 *
 * 与参考截图逐项对应：每一行是一枚按钮，左边是文字（标题一行、摘要一行），
 * 右边是 48×48 的小缩略图（没有媒体就只留文字），最下面是日期。
 * 点一行 = 右侧阅读器切到那一条。
 *
 * ── 为什么列表里也要显示缩略图 ────────────────────────────────────
 * 这是用户给的截图里的既有元素，而且它承担一件具体的事：**扫读**。
 * 纯文字列表在一屏 20 条时全靠标题区分，而动态里大量是「一张图配一句话」，
 * 缩略图比标题更快让人决定要不要点进去。
 *
 * ── 缩略图容错 ────────────────────────────────────────────────────
 * 外链图可能 403 / 被 CSP 拦。失败时**整块缩略图消失**（不是留一个灰方块）：
 * 留灰块会让列表看起来像还没加载完，用户会一直等。
 */
import { useState } from 'react'
import type { FeedPost } from './api.js'
import { shortDateText } from './progress.js'

/** 摘要最多多少字（再多就把行高撑成三行，列表失去扫读性）。 */
const SUMMARY_CHARS = 62

export interface PostListProps {
  readonly posts: readonly FeedPost[]
  /** 当前在右侧阅读器里打开的那一条。 */
  readonly activeId: string | null
  readonly query: string
  readonly onPick: (post: FeedPost) => void
}

/** 一条媒体缩略图（失败整块消失，绝不留破图）。 */
function Thumb({ url }: { readonly url: string }): JSX.Element | null {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  return (
    <img
      className="fd-it-thumb"
      src={url}
      alt=""
      loading="lazy"
      // ⚠ pbs.twimg.com 按 Referer 判盗链：不带这句会 403。
      referrerPolicy="no-referrer"
      onError={() => { setBroken(true) }}
    />
  )
}

/** 一条动态 → 一行摘要（去掉换行，超长截断）。 */
function summaryOf(post: FeedPost): string {
  const flat = post.body.replace(/\s+/g, ' ').trim()
  if (flat === '') return post.topics.length > 0 ? '#' + post.topics.join(' #') : ''
  return flat.length > SUMMARY_CHARS ? flat.slice(0, SUMMARY_CHARS) + '…' : flat
}

/**
 * 左栏条目列表。
 *
 * ⚠ 这里**不做任何排序**：顺序完全跟 host 下发的一致（用户原话「按时间排序
 * 即可」，排序归 host）。连「兜底按 createdAt 排一下」都不能加 —— 同一毫秒
 * 的多条会因此与 host 顺序不同，属于同一个错误换一种写法。
 */
export function PostList({ posts, activeId, query, onPick }: PostListProps): JSX.Element {
  if (posts.length === 0) {
    return (
      <div className="fd-it-empty">
        <p>{query.trim() === '' ? '这里还没有动态' : '没有匹配「' + query.trim() + '」的动态'}</p>
        <span>{query.trim() === '' ? '点右上角「更新」生成一轮' : '换个关键词试试'}</span>
      </div>
    )
  }
  return (
    <div className="fd-it-list" role="listbox" aria-label="动态列表">
      {posts.map((post) => {
        const thumb = post.media.length > 0 ? post.media[0].url : null
        const active = post.id === activeId
        return (
          <button
            key={post.id}
            className="fd-it"
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => { onPick(post) }}
            title={post.title}
          >
            <span className="fd-it-tx">
              <span className="fd-it-ttl">{post.title}</span>
              {summaryOf(post) !== '' ? <span className="fd-it-sum">{summaryOf(post)}</span> : null}
              <span className="fd-it-meta">
                <span className="fd-it-date">{shortDateText(post.createdAt)}</span>
                {post.media.length > 1 ? <span className="fd-it-n">图 {post.media.length}</span> : null}
                {post.topics.length > 0 ? <span className="fd-it-topic">{post.topics[0]}</span> : null}
              </span>
            </span>
            {thumb !== null ? <Thumb url={thumb} /> : null}
          </button>
        )
      })}
    </div>
  )
}
