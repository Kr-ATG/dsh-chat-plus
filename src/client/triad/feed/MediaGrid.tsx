/**
 * dsh-chat-plus — 阅读器里的媒体区（图片内联显示 + 视频内联播放）。
 *
 * 用户原话：「他们的动态有图片或视频就把链接放上来，渲染出来，可播放可查看，
 * 可点击放大全屏可滚轮缩放」。
 *
 * ── 三种媒体的渲染分工 ────────────────────────────────────────────
 *
 *  | 形态                      | 内联                        | 点击        |
 *  |---------------------------|-----------------------------|-------------|
 *  | photo                     | <img> 占满内容宽度           | 全屏查看器  |
 *  | video / animated_gif 有直链 | <video controls> 就地可播  | 全屏按钮    |
 *  | video / animated_gif 无直链 | 封面图 + 播放角标          | 全屏查看器  |
 *
 * 第三行是**必须存在**的一条路：X 的 syndication 数据里大量视频不给 mp4 直链，
 * 只有封面。这时放一个 src 为空的 <video> 会得到一个永远转圈、点了没反应的
 * 播放器 —— 比只显示封面糟得多（用户会以为页面坏了）。所以按
 * {@link isPlayable} 分流，拿不到直链就老实显示封面并给原帖入口。
 *
 * ── 容错三条（硬要求）────────────────────────────────────────────
 *  1. 每张外链图都带 referrerPolicy="no-referrer"：pbs.twimg.com 按 Referer
 *     判盗链，不带这句会 403；
 *  2. onError 之后换成一整块「加载不出来 + 打开原帖」的占位，**绝不留破图**；
 *  3. 加载前按 host 给的宽高比先把盒子占好，避免图片一到就把下面的正文
 *     整体顶下去（CLS：读着读着跳行）。
 */
import { useState } from 'react'
import { mediaProxyUrl, type FeedMedia } from './api.js'
import { isPlayable, mediaAspectOf, mediaBadgeOf } from './progress.js'

export interface MediaGridProps {
  /** 这条动态的媒体（空数组 = 整块不渲染）。 */
  readonly items: readonly FeedMedia[]
  /** 点某一张 → 打开全屏查看器（参数是**这条动态里的下标**）。 */
  readonly onOpen: (index: number) => void
}

/** 单张媒体的盒子（图片 / 视频共用一套外壳）。 */
function MediaBox({
  media,
  index,
  onOpen,
}: {
  readonly media: FeedMedia
  readonly index: number
  readonly onOpen: (index: number) => void
}): JSX.Element {
  const [broken, setBroken] = useState(false)
  const playable = isPlayable(media)
  const badge = mediaBadgeOf(media.type)
  const aspect = mediaAspectOf(media)
  const ratio = aspect === null ? undefined : { aspectRatio: aspect }

  // 兜底：任何外链媒体都可能被防盗链 / CSP / 网络挡下，这一块保证不出现破图。
  if (broken) {
    return (
      <figure className="fd-mg-item" data-broken="true" style={ratio}>
        <div className="fd-mg-fail">
          <span>媒体加载不出来</span>
          <a href={media.sourceUrl} target="_blank" rel="noopener noreferrer">打开原帖</a>
        </div>
      </figure>
    )
  }

  // 可播视频：就地播放。**不能**把 <video> 包进 <button>（点播放会被按钮吞掉），
  // 所以「全屏」另起一枚小按钮叠在右上角。
  if (playable) {
    return (
      <figure className="fd-mg-item" data-kind="video" style={ratio}>
        <video
          className="fd-mg-video"
          /*
           * ⚠ 必须走 host 代理：video.twimg.com 按 Referer 判来源，
           * 浏览器带 127.0.0.1 的 Referer 会被 403（实测）。
           * <video> 没有 referrerpolicy 属性，前端无法绕过 —— 见 mediaProxyUrl 说明。
           */
          src={mediaProxyUrl(media.videoUrl ?? '')}
          poster={media.url}
          controls
          playsInline
          preload="metadata"
          // 视频也走同一条兜底：封面能显示就显示，播不了也不能白屏。
          onError={() => { setBroken(true) }}
        />
        <button
          className="fd-mg-expand"
          type="button"
          title="全屏查看"
          aria-label="全屏查看"
          onClick={() => { onOpen(index) }}
        >
          ⤢
        </button>
      </figure>
    )
  }

  // 图片 / 拿不到直链的视频：整块可点，进全屏查看器。
  return (
    <figure className="fd-mg-item" data-kind={media.type} style={ratio}>
      <button
        className="fd-mg-hit"
        type="button"
        onClick={() => { onOpen(index) }}
        title="点击放大（全屏，可滚轮缩放）"
        aria-label="放大查看"
      >
        <img
          className="fd-mg-img"
          src={media.url}
          alt=""
          loading="lazy"
          // ⚠ pbs.twimg.com 按 Referer 判盗链：不带这句会 403。
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => { setBroken(true) }}
        />
        {/* 拿不到 mp4 直链的视频：封面 + 播放角标，点开仍是全屏大图。
            角标是**如实标注**（这是一段视频），不是假装能播。 */}
        {badge !== null ? <span className="fd-mg-play" aria-hidden="true">▶</span> : null}
        {badge !== null ? <span className="fd-mg-tag">{badge}</span> : null}
      </button>
    </figure>
  )
}

/**
 * 媒体区。
 *
 * 布局口径：**一张占满宽度，多张走两列网格**。不用「全部等宽小缩略图」：
 * 用户点进阅读器是来读的，第一张图就该有信息量；多图时才退成网格。
 */
export function MediaGrid({ items, onOpen }: MediaGridProps): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="fd-mg" data-count={items.length > 1 ? 'many' : 'one'}>
      {items.map((media, index) => (
        <MediaBox
          key={media.url + '#' + String(index)}
          media={media}
          index={index}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
