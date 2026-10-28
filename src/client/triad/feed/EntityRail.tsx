/**
 * dsh-chat-plus — 左栏「按账号分类」的账号列表（用户原话的正面落点）。
 *
 * 用户原话：「账号的可以选左侧的tab分类按账号，然后出现我们已经配置过的账号，
 * 点击某一个账号右侧出现所有动态」。
 *
 * ── 结构与参考截图逐行对应 ────────────────────────────────────────
 *
 *   顶部：全部 / 未读 / 收藏   ← 三枚分类胶囊（.fd-scope）
 *   下面：条目列表             ← 标题 + 摘要 + 小缩略图 + 日期（.fd-it）
 *
 * 账号列表本身（本组件）夹在这两者之间：首项「全部动态」+ 每个已配置账号一行
 * （首字球 / 头像 + 名字 + 条数）。点一行 = 换账号，右侧只显示该账号的动态。
 *
 * ── 头像容错（硬要求）─────────────────────────────────────────────
 * 外链头像可能被 CSP 拦、被网络拦、被对方防盗链拦（pbs.twimg.com 按 Referer
 * 判盗链）。所以每一行**永远**先渲染一枚首字球，<img> 叠在它上面；
 * 加载失败就 onError 把 img 藏掉，首字球自然露出来。绝不出现灰底破图。
 */
import { useMemo, useState } from 'react'
import type { FeedEntity } from './api.js'

/** 首字球可选用的背景（低饱和、深浅主题都压得住）。 */
const PALETTE = [
  'linear-gradient(135deg,#5b7cfa,#3f5bd6)',
  'linear-gradient(135deg,#12a150,#0b7a3b)',
  'linear-gradient(135deg,#ff7a55,#e0512c)',
  'linear-gradient(135deg,#9a6bff,#6f42d9)',
  'linear-gradient(135deg,#0fa3b1,#0a7c88)',
  'linear-gradient(135deg,#e0a45c,#b4700f)',
]

/** 名字 → 一个稳定的色阶（同一个人每次都同一个颜色，不会刷新一次换一种）。 */
export function paletteOf(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/**
 * 首字球（**永远渲染**，是头像的兜底层）。
 *
 * 单独导出是为了让设置面板与悬浮球共用同一份取色逻辑 —— 三处各写一遍
 * 就会出现「同一个人在两个页面是两种颜色」。
 */
export function InitialBall({ name, initial, size }: {
  readonly name: string
  readonly initial: string
  readonly size: number
}): JSX.Element {
  const background = useMemo(() => paletteOf(name), [name])
  return (
    <span
      className="fd-ball"
      style={{ background, width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

/** 一枚头像（首字球打底 + 外链图叠加，失败自动回落）。 */
function Avatar({ entity, size }: { readonly entity: FeedEntity; readonly size: number }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const show = entity.avatarUrl !== undefined && entity.avatarUrl !== '' && !broken
  return (
    <span className="fd-ava" style={{ width: size, height: size }}>
      <InitialBall name={entity.name} initial={entity.initial} size={size} />
      {show ? (
        <img
          className="fd-ava-img"
          src={entity.avatarUrl}
          alt=""
          loading="lazy"
          // ⚠ pbs.twimg.com 按 Referer 判盗链：不带这句会 403。
          referrerPolicy="no-referrer"
          onError={() => { setBroken(true) }}
        />
      ) : null}
    </span>
  )
}

/** 左栏顶部那三枚分类（用户截图里的「全部 / 未读 / 收藏」）。 */
export type ScopeId = 'all' | 'unread' | 'saved'

export const SCOPES: ReadonlyArray<{ id: ScopeId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'saved', label: '收藏' },
]

export interface EntityRailProps {
  /** 已配置的账号（host 的 /entities；拉不到时是空数组）。 */
  readonly entities: readonly FeedEntity[]
  /** 当前选中的账号 id；null = 全部动态。 */
  readonly selected: string | null
  /** 每个账号名下的动态条数（按当前全量数据现算，没算到的不显示数字）。 */
  readonly counts: ReadonlyMap<string, number>
  /** 全部动态的总条数（「全部动态」那一行显示）。 */
  readonly totalCount: number
  /** 当前分类（全部 / 未读 / 收藏）。 */
  readonly scope: ScopeId
  readonly onScope: (scope: ScopeId) => void
  readonly onSelect: (id: string | null) => void
  /** 账号列表拉失败时的原因（有值时在「全部动态」下面给一行提示）。 */
  readonly entityError: string | null
}

/**
 * 账号列表（左栏中段）。
 *
 * 只负责画与回调，不拉数据 —— 数据在 FeedPanel 里拉一次，因为「切账号」要
 * 同时改右侧列表的过滤条件，两处各拉一次会出现「左边 3 条、右边 1 条」。
 */
export function EntityRail({
  entities, selected, counts, totalCount, scope, onScope, onSelect, entityError,
}: EntityRailProps): JSX.Element {
  return (
    <div className="fd-rail">
      {/* ① 分类胶囊：全部 / 未读 / 收藏 */}
      <div className="fd-scope" role="tablist" aria-label="分类">
        {SCOPES.map((item) => (
          <button
            key={item.id}
            className="fd-scope-btn"
            type="button"
            role="tab"
            aria-selected={scope === item.id}
            onClick={() => { onScope(item.id) }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ② 账号列表：首项「全部动态」+ 每个已配置账号 */}
      <div className="fd-rail-list" role="listbox" aria-label="按账号筛选">
        <button
          className="fd-ent-row"
          type="button"
          role="option"
          aria-selected={selected === null}
          onClick={() => { onSelect(null) }}
        >
          <span className="fd-ava" style={{ width: 26, height: 26 }}>
            <span className="fd-ball" style={{ background: 'var(--fd-sel)', color: 'var(--fd-ink2)', width: 26, height: 26, fontSize: 12 }}>
              全
            </span>
          </span>
          <span className="fd-ent-nm">
            <b>全部动态</b>
            <small>{totalCount > 0 ? String(totalCount) + ' 条' : '还没有动态'}</small>
          </span>
        </button>

        {entities.map((entity) => {
          const count = counts.get(entity.id)
          return (
            <button
              key={entity.id}
              className="fd-ent-row"
              type="button"
              role="option"
              aria-selected={selected === entity.id}
              title={entity.name + (entity.xHandle !== undefined ? ' · @' + entity.xHandle : '')}
              onClick={() => { onSelect(entity.id) }}
            >
              <Avatar entity={entity} size={26} />
              <span className="fd-ent-nm">
                <b>{entity.name}</b>
                <small>
                  {count === undefined
                    ? (entity.kind === 'person' ? '人物' : '公司')
                    : String(count) + ' 条动态'}
                </small>
              </span>
            </button>
          )
        })}
      </div>

      {/* 账号列表拉不到时的说明。**不是**错误弹窗：页面其余部分完全可用，
          只是这一层筛选暂时不可用（host 可能还没重启）。 */}
      {entityError !== null ? (
        <div className="fd-rail-err" role="status">{entityError}</div>
      ) : null}
    </div>
  )
}
