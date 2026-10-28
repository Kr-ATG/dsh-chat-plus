/**
 * dsh-chat-plus — 「关注的对象」右侧悬浮球（用户原话的正面落点）。
 *
 * 用户原话（2026-10-27）：「右侧增加悬浮球，鼠标移动上去后显示多个球每个关注的
 * 人物或公司头像与名称，点击后弹出该公司或人物的动态」。
 *
 * ── 交互三态 ──────────────────────────────────────────────────────
 *
 *  1. **收起**：贴着右侧边缘一枚小圆球（.fd-orbs-handle），不挡主内容；
 *  2. **悬停**：向上依次展开 N 枚实体球（每枚是头像 + 首字兜底），球左侧浮出
 *     名字标签；鼠标移出整列就收回；
 *  3. **点击某枚球**：弹出浮层，列出**这个人物/公司名下的动态**。
 *
 * ── 为什么展开由 data-open 驱动、而不是纯 :hover ────────────────────
 *
 * 用户要求「别用 JS 做动画」—— 这条说的是**不要用 JS 逐帧算动画**，动画本身
 * 仍然完全由 CSS transition 完成（见 styles.ts 的 .fd-orb 规则）。但「展开」这个
 * 状态必须是 JS 变量，理由是纯 :hover 在这里有个躲不掉的坑：
 *
 *   容器不拦点击（pointer-events:none，否则右侧会多出一条看不见的挡板），
 *   而 :hover 只在**指针位于容器或其盒子的区域**时才成立。球之间还有 8px
 *   间隙，鼠标滑过间隙的那一帧容器就不再 hover → 整列瞬间缩回 → 再进入又
 *   展开，形成肉眼可见的频闪。
 *
 * 所以：React 的 onMouseEnter/onMouseLeave 管「展开没展开」（它们基于
 * mouseover 的祖先比较，即使容器 pointer-events:none，进入任意后代也会触发），
 * CSS 管「怎么展开」（opacity/transform/transition-delay）。
 *
 * ── 头像容错（这一段是硬要求）──────────────────────────────────────
 *
 * 外链头像可能被 CSP 拦、被网络拦、被对方防盗链拦。所以每枚球里**永远**先渲染
 * 一枚首字球（.fd-orb-initial），<img> 叠在它上面；加载失败就 onError 把 img
 * 自己藏掉，露出下面的首字球。绝不出现「灰底破图」或「球是空的」。
 *
 * ── 拿不到数据时的行为 ─────────────────────────────────────────────
 *
 * 关注对象拉不到（host 没重启 / 路由还没挂 / 一个都没关注）→ **整块不渲染**
 * （返回 null），页面其余部分完全不受影响。这是刻意的：渲染一枚点了没反应的
 * 球，比不渲染更糟。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchFeedEntities,
  fetchEntityPosts,
  refreshFeed,
  type FeedDay,
  type FeedEntity,
} from './api.js'
import { agoText, fullDateText, sourceLabelOf } from './progress.js'

/**
 * 「关注对象变了」的跨组件通知。
 *
 * 设置面板保存 / 删除之后要立刻刷新悬浮球，但两者是**两棵不同的 React 树**
 * （设置面板在页面里，悬浮球挂在 body）—— 没有共同祖先就没有 props 通道。
 * 用 window 自定义事件是这里唯一干净的通道（与项目里其它跨根同步同款做法）。
 */
export const ENTITY_CHANGED_EVENT = 'dsh-feed-entities-changed'

/** 通知所有悬挂浮球：关注列表变了，重新拉一次。 */
export function notifyEntitiesChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(ENTITY_CHANGED_EVENT))
  } catch {
    // 老浏览器没有 CustomEvent 构造器 / window 是桩 —— 刷新交给下一次轮询。
  }
}

/** 球直径的 CSS 值（与 styles.ts 的 --fd-orb-size 必须一致，见那里的注释）。 */
const ORB_SIZE = 42
/** 球间距。 */
const ORB_GAP = 8

/* ───────────────────────── 首字球 ───────────────────────── */

/**
 * 首字球：**永远渲染**，是头像的兜底层。
 *
 * 背景色由名字哈希决定（同一个人每次都同一个颜色，不会刷新一次换一种），
 * 色相只取 6 档：随机取色会让一列球看起来像信号灯，固定色阶才像一套设计。
 */
function InitialBall({ entity, size }: { entity: FeedEntity; size: number }): JSX.Element {
  const hue = useMemo(() => {
    let hash = 0
    for (const char of entity.name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
    return PALETTE[Math.abs(hash) % PALETTE.length]
  }, [entity.name])
  return (
    <span
      className="fd-orb-initial"
      style={{ background: hue, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {entity.initial}
    </span>
  )
}

/** 首字球可选用的背景（低饱和、深浅主题都压得住，不用依赖主题变量）。 */
const PALETTE = [
  'linear-gradient(135deg,#5b7cfa,#3f5bd6)',
  'linear-gradient(135deg,#12a150,#0b7a3b)',
  'linear-gradient(135deg,#ff7a55,#e0512c)',
  'linear-gradient(135deg,#9a6bff,#6f42d9)',
  'linear-gradient(135deg,#0fa3b1,#0a7c88)',
  'linear-gradient(135deg,#e0a45c,#b4700f)',
]

/**
 * 一枚实体球（头像 + 首字兜底 + hover 名字标签）。
 *
 * @param open - 是否已展开（收起态下球不可点、也不参与 tab 顺序）。
 */
function EntityOrb({
  entity,
  index,
  open,
  onPick,
  onHover,
}: {
  readonly entity: FeedEntity
  readonly index: number
  readonly open: boolean
  readonly onPick: (entity: FeedEntity) => void
  /** 鼠标进到球上时取消「延迟收起」（球在容器盒外，容器收不到这次 mouseenter）。 */
  readonly onHover: () => void
}): JSX.Element {
  const [avatarBroken, setAvatarBroken] = useState(false)
  const showAvatar = entity.avatarUrl !== undefined && entity.avatarUrl !== '' && !avatarBroken
  return (
    <span
      className="fd-orb-slot"
      // 展开才可点/可聚焦：收起态这一列仍然存在（绝对定位），若保留 pointer-events
      // 就会在右侧形成一条看不见但吃点击的窄条。
      data-open={open ? 'true' : 'false'}
      style={{ bottom: (index + 1) * (ORB_SIZE + ORB_GAP) }}
      // 球在 .fd-orbs 盒外，容器的 mouseenter 收不到这次进入 —— 必须在这里
      // 取消待执行的收起，否则鼠标刚够到球它就缩回去了（「点不到人物」）。
      onMouseEnter={onHover}
    >
      <button
        className="fd-orb"
        type="button"
        title={entity.name}
        aria-label={'查看 ' + entity.name + ' 的动态'}
        tabIndex={open ? 0 : -1}
        style={{ transitionDelay: String(index * 40) + 'ms' }}
        onClick={(event) => {
          // 点球只开浮层，不触发任何页面跳转（工作台里没有路由可跳）。
          event.preventDefault()
          event.stopPropagation()
          onPick(entity)
        }}
      >
        <InitialBall entity={entity} size={ORB_SIZE} />
        {showAvatar ? (
          <img
            className="fd-orb-img"
            src={entity.avatarUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => { setAvatarBroken(true) }}
          />
        ) : null}
        {entity.postCount !== undefined && entity.postCount > 0 ? (
          <span className="fd-orb-count" aria-hidden="true">
            {entity.postCount > 99 ? '99+' : String(entity.postCount)}
          </span>
        ) : null}
      </button>
      <span className="fd-orb-name" aria-hidden="true">{entity.name}</span>
    </span>
  )
}

/* ───────────────────────── 实体动态浮层 ───────────────────────── */

/**
 * 点开某枚球后的浮层：这个人/公司名下的动态。
 *
 * 复用 host 的 GET /posts?entity=<id>（**与球上角标同一段归属判定**），所以
 * 「球上写 3 条、点开只有 1 条」这种自相矛盾不可能发生。
 */
function EntitySheet({
  entity,
  onClose,
  onRefresh,
}: {
  readonly entity: FeedEntity
  readonly onClose: () => void
  readonly onRefresh: () => void
}): JSX.Element {
  const [days, setDays] = useState<readonly FeedDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const now = Date.now()

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const result = await fetchEntityPosts(entity.id)
    if (result.ok) {
      setDays(result.data)
      setError(null)
    } else {
      setError(result.message)
    }
    setLoading(false)
  }, [entity.id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const posts = useMemo(() => {
    const list: Array<FeedDay['items'][number]> = []
    for (const day of days ?? []) list.push(...day.items)
    return list
  }, [days])

  return createPortal(
    /*
     * ⚠ data-on="true" 是**必需的**，不是装饰。
     *
     * .fd-pop 的基础规则是 position:fixed;inset:0;display:none，只有
     * .fd-pop[data-on="true"] 才 display:block（复用「原文来源」浮层那一套）。
     * 少了它，浮层容器是 display:none —— 实测表现就是面板 getBoundingClientRect
     * 全 0、innerText 里却搜得到内容（React 渲染了，盒子不参与布局）。
     */
    <div
      className="fd-pop fd-orb-pop"
      data-on="true"
      role="dialog"
      aria-modal="true"
      aria-label={entity.name + ' 的动态'}
    >
      <div className="fd-pop-bd" onClick={onClose} />
      <div className="fd-orb-sheet">
        <div className="fd-orb-hd">
          <span className="fd-orb-hd-ava">
            <InitialBall entity={entity} size={36} />
            {entity.avatarUrl !== undefined && entity.avatarUrl !== '' ? (
              <img
                className="fd-orb-img"
                src={entity.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={(event) => { event.currentTarget.style.display = 'none' }}
              />
            ) : null}
          </span>
          <span className="fd-orb-hd-txt">
            <b>{entity.name}</b>
            <small>
              {entity.kind === 'person' ? '人物' : '公司'}
              {' · '}
              {loading ? '正在数动态…' : String(posts.length) + ' 条动态'}
            </small>
          </span>
          <button className="fd-orb-x" type="button" aria-label="关闭" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
            </svg>
          </button>
        </div>
        <div className="fd-orb-body">
          {error !== null ? (
            <div className="fd-orb-empty">
              <p>{error}</p>
              <button type="button" className="fd-orb-act" onClick={() => { void load() }}>重试</button>
            </div>
          ) : loading ? (
            <div className="fd-orb-empty"><p>正在加载…</p></div>
          ) : posts.length === 0 ? (
            /*
             * 空态必须给出「为什么空 + 能做什么」。只写「暂无」会让用户以为
             * 功能坏了 —— 这是新功能上线时最容易被误判成 bug 的一屏。
             */
            <div className="fd-orb-empty">
              <p>还没有关于 {entity.name} 的动态。</p>
              <p className="fd-orb-dim">点下面的按钮让模型现在跑一轮；也可以到设置里给它加几个别名（别名命中同样算它的动态）。</p>
              <button type="button" className="fd-orb-act" onClick={onRefresh}>现在更新</button>
            </div>
          ) : (
            <ul className="fd-orb-list">
              {posts.map((post) => (
                <li key={post.id} className="fd-orb-item">
                  <div className="fd-orb-item-t">{post.title}</div>
                  <div className="fd-orb-item-b">
                    {post.body.length > 110 ? post.body.slice(0, 110) + '…' : post.body}
                  </div>
                  <div className="fd-orb-item-m">
                    <span>{fullDateText(post.createdAt)}</span>
                    <span className="fd-orb-dim">{agoText(post.createdAt, now)}</span>
                    <span className="fd-orb-dim">{sourceLabelOf(post)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ───────────────────────── 悬浮球主体 ───────────────────────── */

/**
 * 右侧悬浮球（收起态一枚，悬停展开为关注对象的头像球）。
 *
 * 挂在**页面根节点**上（由 FeedPanel 渲染），自身用 position:fixed 定位到右侧
 * 边缘并 portal 浮层到 body —— 工作台容器是 overflow:hidden，留在里面会被裁掉。
 */
export function EntityOrbs(): JSX.Element | null {
  const [entities, setEntities] = useState<readonly FeedEntity[] | null>(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<FeedEntity | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  /*
   * 延迟收起（2026-10-27 修「点不到人物」）。
   *
   * 展开后的球是**绝对定位在容器盒外面**的（第二个球在 .fd-orbs 上方 100px，
   * 而容器只有 56×56）。鼠标从手柄移向球时必须穿过容器边界，那一刻
   * onMouseLeave 就触发了 —— 原来的实现立刻 setOpen(false)，球在指尖前缩回去，
   * 用户点到的其实是下面的标题。实测：移到球中心时 elementFromPoint 已经是
   * .fd-dyn-h（页面标题）。
   *
   * 这里改成「离开后等 260ms 再收」，期间只要又进入容器/任意一枚球就取消。
   * 260ms 是实测值：正常人把鼠标从手柄移到最近那枚球约 120-180ms，
   * 给到 260ms 留足余量；再长会让「移开不想点」的人觉得球赖着不走。
   */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = useCallback((): void => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const closeSoon = useCallback((): void => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, 260)
  }, [cancelClose])
  // 组件卸载时清掉待执行的定时器（否则会在已卸载的组件上 setState）。
  useEffect(() => () => { cancelClose() }, [cancelClose])

  const load = useCallback(async (): Promise<void> => {
    const result = await fetchFeedEntities()
    // 失败就把球收掉（null = 不渲染）。宁可没有，也不要一颗点了没反应的球。
    setEntities(result.ok ? result.data : null)
  }, [])

  useEffect(() => { void load() }, [load])

  // 设置面板保存 / 删掉一个人之后立刻刷新（跨 React 树的唯一通道）。
  useEffect(() => {
    const onChange = (): void => { void load() }
    window.addEventListener(ENTITY_CHANGED_EVENT, onChange)
    return () => { window.removeEventListener(ENTITY_CHANGED_EVENT, onChange) }
  }, [load])

  // 浮层开着时点「现在更新」：走与页面同一个单飞闸门，不会跑两轮。
  const runRefresh = useCallback(async (): Promise<void> => {
    const result = await refreshFeed()
    setToast(result.ok
      ? (result.data === 'started' ? '已开始更新' : '正在更新中，这次的请求已合并')
      : result.message)
    if (result.ok && result.data === 'started') {
      // 生成要几十秒：给用户一句明确的期待，并过一会儿再拉一次实体条数。
      window.setTimeout(() => { void load() }, 45000)
    }
  }, [load])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => { setToast(null) }, 2600)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  // 一个关注对象都没有（或拉不到）→ 整块不渲染。
  if (entities === null || entities.length === 0) return null

  return (
    <div
      className="fd-orbs"
      data-open={open ? 'true' : 'false'}
      onMouseEnter={() => { cancelClose(); setOpen(true) }}
      // 延迟收起：见 closeSoon 的说明（球在容器盒外面，立刻收会让用户点空）。
      onMouseLeave={closeSoon}
      // 键盘用户：Tab 进任意一枚球时也展开（与 hover 等价的可见性）。
      onFocus={() => { setOpen(true) }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      {entities.map((entity, index) => (
        <EntityOrb
          key={entity.id}
          entity={entity}
          index={index}
          open={open}
          onHover={cancelClose}
          onPick={(target) => {
            setPicked(target)
            setOpen(false)
          }}
        />
      ))}
      <span className="fd-orbs-handle-slot">
        <button
          className="fd-orbs-handle"
          type="button"
          title={'关注的 ' + String(entities.length) + ' 个对象（悬停展开）'}
          aria-label={'关注的 ' + String(entities.length) + ' 个对象'}
          aria-expanded={open}
          onClick={() => { setOpen((value) => !value) }}
        >
          {/* 收起态那枚球：一颗星。点它是展开/收起（触屏没有 hover，需要这个入口）。 */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M9 2.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L9 13l-4.2 2.2.8-4.7L2.2 7.2l4.7-.7z" />
          </svg>
        </button>
      </span>
      {picked !== null ? (
        <EntitySheet
          entity={picked}
          onClose={() => { setPicked(null) }}
          onRefresh={() => { void runRefresh() }}
        />
      ) : null}
      {toast !== null ? (
        <div className="fd-toasts" aria-live="polite">
          <div className="fd-toast" data-in="true"><span>{toast}</span></div>
        </div>
      ) : null}
    </div>
  )
}