/**
 * dsh-chat-plus — 「关注的对象」管理块（设置面板里那一段）。
 *
 * 用户原话：「在设置里可添加人物与公司」。
 *
 * ── 为什么做成独立组件 ─────────────────────────────────────────────
 *
 * 设置面板住在 FeedPanel.tsx 里，而那个文件正在被另一个人（feed-progress）大改。
 * 把这块逻辑留在那个文件里，等于每次改这里都要在一个 1600 行的组件里跟别人抢行号。
 * 抽成独立组件之后，接入只需要在设置面板里加**一行** JSX。
 *
 * ── 保存之后怎么让悬浮球跟着变 ─────────────────────────────────────
 *
 * 悬浮球挂在 body（另一棵 React 树），没有 props 通道。所以每次成功的写操作
 * 之后都调 notifyEntitiesChanged() 往 window 发一次自定义事件 —— 这是项目里
 * 跨 React 根同步的既有做法（与意图通道同款）。
 *
 * ── 三条交互取舍 ───────────────────────────────────────────────────
 *
 *  1. **别名是一个逗号分隔的输入框**，不是一排「+」小输入框：一个人通常只有
 *     两三个别名，一排输入框会让这块比整张设置面板还高。
 *  2. **添加成功之后表单不清空名字**：连续给同一个人补第二个别名是常见动作，
 *     清空等于逼他重新打一遍。改成「保留名字、清空别名」，并在按钮上给出
 *     明确的成功提示。
 *  3. **错误照 host 原文显示**（「已经关注过同名对象了」这种），不在前端
 *     自己再编一套判重 —— 两处判重迟早不一致，而且 host 才是真相。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  createFeedEntity,
  deleteFeedEntity,
  fetchFeedEntities,
  type FeedEntity,
} from './api.js'
import { notifyEntitiesChanged } from './EntityOrbs.js'

/** 表单的初始值（也用于「重置」）。 */
const EMPTY_FORM = {
  name: '',
  kind: 'person' as 'person' | 'company',
  xHandle: '',
  aliases: '',
}

/** 一枚小头像（列表行用；与悬浮球同款首字兜底，只是尺寸更小）。 */
function EntityAvatar({ entity }: { entity: FeedEntity }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const showAvatar = entity.avatarUrl !== undefined && entity.avatarUrl !== '' && !broken
  return (
    <span className="fd-ent-ava">
      <span className="fd-orb-initial" style={{ fontSize: 12, background: 'linear-gradient(135deg,#5b7cfa,#3f5bd6)' }}>
        {entity.initial}
      </span>
      {showAvatar ? (
        <img
          className="fd-orb-img"
          src={entity.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => { setBroken(true) }}
        />
      ) : null}
    </span>
  )
}

/**
 * 「关注的对象」管理块。
 *
 * 自包含：自己拉列表、自己写、自己报错。父组件只需要决定「渲染在哪里」。
 */
export function EntitySettings(): JSX.Element {
  const [entities, setEntities] = useState<readonly FeedEntity[]>([])
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const result = await fetchFeedEntities()
    if (result.ok) setEntities(result.data)
    setLoaded(true)
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = useCallback(async (): Promise<void> => {
    /*
     * 支持「只粘一条主页链接就加人」（用户 2026-10-28：「设置里的账号我以后直接
     * 给你他的主页 https://x.com/lilililiMozi，这样省 token 生成又不容易错字」）。
     *
     * 判据：第一格里填的东西**像不像 X 地址**（含 x.com/twitter.com，或以 @ 开头）。
     * 像就当成账号处理 —— 名字与头像由 host 抓主页自动补全，用户一个字都不用打；
     * 不像就按原来的「名字」处理（保持老用法可用）。
     */
    const raw = form.name.trim()
    if (raw === '') { setError('粘贴 X 主页链接，或填一个名字'); return }
    const looksLikeX = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(raw) || raw.startsWith('@')
    setBusy(true)
    setError(null)
    const result = await createFeedEntity(
      looksLikeX && form.xHandle.trim() === ''
        // 走「主页链接」路径：只传 url，name 留空 → host 抓主页补全
        ? { name: '', kind: form.kind, url: raw, aliases: form.aliases.trim() }
        : {
            name: raw,
            kind: form.kind,
            xHandle: form.xHandle.trim() === '' ? undefined : form.xHandle.trim(),
            aliases: form.aliases.trim(),
          },
    )
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    // createFeedEntity 的成功值在 result.data（FeedResult<FeedEntity>），不是 result.entity。
    const added = result.data?.name ?? raw
    setNotice('已关注 ' + added)
    // 保留名字（便于紧接着补别名），清掉其余录入。
    setForm({ ...EMPTY_FORM, name: looksLikeX ? '' : raw, kind: form.kind })
    await load()
    notifyEntitiesChanged()
  }, [form, load])

  const remove = useCallback(async (entity: FeedEntity): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await deleteFeedEntity(entity.id)
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setNotice('已取消关注 ' + entity.name)
    await load()
    notifyEntitiesChanged()
  }, [load])

  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => { setNotice(null) }, 2600)
    return () => { window.clearTimeout(timer) }
  }, [notice])

  return (
    <div className="fd-ent">
      <div className="fd-ent-h">
        <span>关注的对象</span>
        <small>右侧悬浮球里就是这几个人 / 公司</small>
      </div>

      {!loaded ? (
        <div className="fd-ent-empty">正在读取…</div>
      ) : entities.length === 0 ? (
        <div className="fd-ent-empty">
          还没有关注任何对象。加一个人或公司，右侧就会出现它的悬浮球；
          点球能看它名下的动态。
        </div>
      ) : (
        <ul className="fd-ent-list">
          {entities.map((entity) => (
            <li key={entity.id} className="fd-ent-row">
              <EntityAvatar entity={entity} />
              <span className="fd-ent-nm">
                <b>{entity.name}</b>
                <small>
                  {entity.xHandle !== undefined ? '@' + entity.xHandle : ''}
                  {entity.aliases.length > 0 ? (entity.xHandle !== undefined ? ' · ' : '') + '别名：' + entity.aliases.join('、') : ''}
                  {entity.xHandle === undefined && entity.aliases.length === 0 ? '（按名字匹配动态）' : ''}
                </small>
              </span>
              <span className="fd-ent-tag">{entity.kind === 'person' ? '人物' : '公司'}</span>
              <button
                className="fd-ent-del"
                type="button"
                title={'取消关注 ' + entity.name}
                aria-label={'取消关注 ' + entity.name}
                disabled={busy}
                onClick={() => { void remove(entity) }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="fd-ent-form">
        <input
          className="fd-ent-wide"
          type="text"
          placeholder="粘贴 X 主页链接：https://x.com/lilililiMozi（或填名字：黄仁勋）"
          aria-label="X 主页链接或名字"
          value={form.name}
          /* ⚠ 必须先把值取出来再进 updater：React 的 updater 是**延迟执行**的，
             那时合成事件的 currentTarget 已经被置 null —— 在 updater 里读
             event.currentTarget.value 会抛 "Cannot read properties of null"，
             而这个异常发生在渲染期，整页会被 ErrorBoundary 兜成「动态页渲染出错了」。
             2026-10-28 用户粘贴主页链接时踩到。 */
          onChange={(event) => {
            const value = event.currentTarget.value
            setForm((prev) => ({ ...prev, name: value }))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void submit() }
          }}
        />
        <select
          aria-label="类型"
          value={form.kind}
          onChange={(event) => {
            const next = event.currentTarget.value === 'company' ? 'company' : 'person'
            setForm((prev) => ({ ...prev, kind: next }))
          }}
        >
          <option value="person">人物</option>
          <option value="company">公司</option>
        </select>
        <input
          type="text"
          placeholder="X 账号（粘了主页链接就不用填）"
          aria-label="X 账号"
          value={form.xHandle}
          onChange={(event) => {
            const value = event.currentTarget.value
            setForm((prev) => ({ ...prev, xHandle: value }))
          }}
        />
        <input
          className="fd-ent-wide"
          type="text"
          placeholder="别名（可选，逗号分隔）：黄仁勋, Jensen Huang, 英伟达 CEO"
          aria-label="别名"
          value={form.aliases}
          onChange={(event) => {
            const value = event.currentTarget.value
            setForm((prev) => ({ ...prev, aliases: value }))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void submit() }
          }}
        />
        <div className="fd-ent-actions">
          <button className="fd-ent-btn" data-primary="true" type="button" disabled={busy} onClick={() => { void submit() }}>
            {busy ? '保存中…' : '添加关注'}
          </button>
          {notice !== null ? <span className="fd-ent-tag">{notice}</span> : null}
          {error !== null ? <span className="fd-ent-err">{error}</span> : null}
        </div>
      </div>
    </div>
  )
}