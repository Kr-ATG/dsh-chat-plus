/**
 * dsh-soul — 卡片区（灵魂的权威形态）。
 *
 * ── 这一层解决什么 ────────────────────────────────────────────────────
 * 之前「灵魂」是一整段 soul.md 正文 + 四件套身份字段：想改语气就得在整段散文里
 * 找那一句，想临时关掉「行为准则」只能整段删掉。用户要的是「针对性的每一个卡片
 * 设置灵魂里边所带有的内容」——于是卡片成为权威：一张卡 = 一段可单独开关、单独
 * 排序、单独编辑的注入内容，soul.md 退化成由卡片拼出来的全文视图。
 *
 * ── 设计取舍 ──────────────────────────────────────────────────────────
 * 1. **排序先本地生效、再以回包为准**。拖拽/箭头调序若等一次往返才动，手感是断的；
 *    所以本地立刻重排（带位移动效），POST /soul/cards 的回包回来后再校准一次。
 *    校准用 host 回包而不是本地结果——两边不一致时以磁盘为准是唯一的收敛方式。
 * 2. **写卡片是「合并请求」**。一次 POST 里可同时带 upsert / remove / reorder，
 *    面板把一次操作收敛成一个请求：中途失败不会让面板与磁盘处于半新半旧的状态。
 * 3. **不本地假装成功**。开关、删除、排序全部等回包；失败时回滚到 host 上次给的
 *    列表并弹错误 notice。旧 host 没有 /soul/cards 路由 → 走 onStale，整块换成
 *    「重启 DSH」的诚实提示（与面板其余部分一致）。
 * 4. **展开是受控的、编辑是草稿式的**。同一时刻只展开一张卡（面板窄，多张同时
 *    展开会淹没信息）；编辑落在本地 draft，失焦或点保存才写库——每敲一个字就发
 *    一次请求既浪费又会让 host 反复重算 soul.md。
 * 5. **动效全部 CSS**。展开用 max-height + opacity 过渡（高度动画无法用 transform
 *    表达），开关沿用面板同款滑块，调序落位用一次性 keyframes 弹一下。零依赖。
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  SoulApi,
  SoulCard,
  SoulCardKind,
  SoulCardsResponse,
  SoulPreset,
} from './api.js'
import { SOUL_CARD_KINDS } from './api.js'
import type { SoulT, SoulLocaleKey } from './locales.js'
import { css } from './styles.js'

/** 单张卡片标题 / 正文的上限（与 host 侧截断一致，用于面板计数与输入限制）。 */
const CARD_TITLE_LIMIT = 40
const CARD_BODY_LIMIT = 1200

/** CardsSection 属性。 */
export interface CardsSectionProps {
  readonly api: SoulApi
  /** host 给的最新卡片列表（权威）。 */
  readonly cards: readonly SoulCard[]
  /** 预设列表（「存为预设」要把当前卡片带过去）。 */
  readonly presets: readonly SoulPreset[]
  /** 卡片写入成功：把回包交给面板（含重算后的 soul 视图）。 */
  readonly onCards: (response: SoulCardsResponse) => void
  /** 预设列表更新（存为预设后）。 */
  readonly onPresets: (next: SoulPreset[]) => void
  /** host 未更新（/soul/cards 404）→ 面板切到「重启 DSH」空态。 */
  readonly onStale: () => void
  /** 真失败：交给面板统一弹 notice。 */
  readonly onError: (message: string) => void
  readonly t: SoulT
  /** 跳去预设区（「存为预设」按钮的落点由 PresetsSection 提供）。 */
  readonly onSaveAsPreset: (cards: SoulCard[]) => void
}

/** kind → 文案 key（面板展示用）。 */
const KIND_LABEL: Record<SoulCardKind, SoulLocaleKey> = {
  identity: 'soulCardKindIdentity',
  tone: 'soulCardKindTone',
  principles: 'soulCardKindPrinciples',
  boundaries: 'soulCardKindBoundaries',
  style: 'soulCardKindStyle',
  custom: 'soulCardKindCustom',
}

/** 卡片种类图标（六种 kind 各一枚 16×16 线性图标）。 */
export function CardKindIcon({ kind, size = 15 }: { readonly kind: SoulCardKind; readonly size?: number }): JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (kind === 'identity') {
    // 徽章：身份 = 一个被框住的名字
    return <svg {...common}><circle cx="8" cy="6.1" r="2.5" /><path d="M3.4 13.2c.7-2.2 2.5-3.3 4.6-3.3s3.9 1.1 4.6 3.3" /></svg>
  }
  if (kind === 'tone') {
    // 声波：语气 = 怎么说话
    return <svg {...common}><path d="M2.2 6.2v3.6M5.4 4v8M8.6 2.4v11.2M11.8 4.6v6.8M15 6.6v2.8" /></svg>
  }
  if (kind === 'principles') {
    // 清单：准则 = 一条条要守的东西
    return <svg {...common}><path d="M2.4 4.6l1.6 1.6 3-3.2" /><path d="M2.4 11.2l1.6 1.6 3-3.2" /><path d="M9.6 4.6h4.4M9.6 12h4.4" /></svg>
  }
  if (kind === 'boundaries') {
    // 盾牌：边界 = 不做什么
    return <svg {...common}><path d="M8 1.8l5 1.9v4.1c0 3.1-2 5.3-5 6.4-3-1.1-5-3.3-5-6.4V3.7z" /><path d="M6.1 8.1l1.4 1.4 2.6-2.8" /></svg>
  }
  if (kind === 'style') {
    // 画笔：风格 = 表达方式
    return <svg {...common}><path d="M2.6 13.4c1.9.3 3.2-.4 3.6-2.1l4.9-4.9" /><path d="M9.8 2.9l3.3 3.3" /><path d="M6.9 8.3l1.8 1.8" /></svg>
  }
  // custom：自由扩展
  return <svg {...common}><path d="M8 1.9l1.6 4.1 4.1 1.6-4.1 1.6L8 13.3 6.4 9.2 2.3 7.6l4.1-1.6z" /></svg>
}

/** 上下箭头（调序）。 */
function ArrowIcon({ dir }: { readonly dir: 'up' | 'down' }): JSX.Element {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'up' ? 'M8 12.6V3.4M3.9 7.5 8 3.4l4.1 4.1' : 'M8 3.4v9.2M3.9 8.5 8 12.6l4.1-4.1'} />
    </svg>
  )
}

/** 展开/收起箭头（会旋转）。 */
function CaretIcon({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      className={open ? `${css.caret} ${css.caretOpen}` : css.caret}
      width={13}
      height={13}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.6 3.4 10.2 8l-4.6 4.6" />
    </svg>
  )
}

/** 正在编辑的卡片草稿。 */
interface CardDraft {
  id: string
  title: string
  body: string
}

/** 新建卡片的小表单状态。 */
interface NewCardForm {
  kind: SoulCardKind
  title: string
}

/** 把卡片数组按 order 升序（host 已排序，这里兜底）。 */
function byOrder(cards: readonly SoulCard[]): SoulCard[] {
  return [...cards].sort((a, b) => a.order - b.order)
}

/** 重新分配 order（步长 10，留出手工插入的余量）。 */
function reindex(cards: readonly SoulCard[]): SoulCard[] {
  return cards.map((card, index) => ({ ...card, order: index * 10 }))
}

/**
 * 卡片区主体。
 *
 * 所有写操作都走 `submit` 一个出口：它把 patch 发给 host、把回包交给面板、
 * 把三类失败（host 未更新 / 真错误）分流到对应回调。
 */
export function CardsSection(props: CardsSectionProps): JSX.Element {
  const { api, cards, onCards, onPresets, onStale, onError, t, onSaveAsPreset } = props

  /** 本地乐观顺序（拖拽/箭头期间生效，回包后清空）。 */
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CardDraft | null>(null)
  const [newForm, setNewForm] = useState<NewCardForm | null>(null)
  /** 「刚刚落位」的卡片 id：给它一次弹跳动效（keyframes 只播一次）。 */
  const [landedId, setLandedId] = useState<string | null>(null)
  /**
   * 正在退场的卡片 id。
   *
   * 用一个 Set 而不是单个 id：连点两张卡的删除时，单值会被后一张覆盖，前一张
   * 的退场样式突然消失（视觉上像「撤销了删除」）。退场是纯视觉的，不需要串行。
   */
  const [leaving, setLeaving] = useState<readonly string[]>([])
  /** 拖拽悬停在哪张卡上：给它一条插入位指示线（原生 drag 没有默认视觉反馈）。 */
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  /** 取消按钮的 onMouseDown 先置位：避免 blur 抢在 click 之前把草稿写进库。 */
  const cancelRef = useRef(false)

  /** 渲染用的卡片列表：本地顺序优先，否则用 host 的。 */
  const view = useMemo(() => {
    const base = byOrder(cards)
    if (localOrder === null) return base
    const index = new Map(base.map(card => [card.id, card]))
    const ordered: SoulCard[] = []
    for (const id of localOrder) {
      const card = index.get(id)
      if (card !== undefined) { ordered.push(card); index.delete(id) }
    }
    // 本地顺序里没有的新卡（host 刚生成 id）追加到末尾，不能丢。
    for (const card of base) if (index.has(card.id)) ordered.push(card)
    return ordered
  }, [cards, localOrder])

  /** 统一写入口。 */
  const submit = useCallback((patch: Parameters<SoulApi['saveCards']>[0], after?: (response: SoulCardsResponse) => void): void => {
    if (busy) return
    setBusy(true)
    void api.saveCards(patch)
      .then(response => {
        setLocalOrder(null)
        onCards(response)
        after?.(response)
      })
      .catch((reason: unknown) => {
        setLocalOrder(null)
        if (api.isHostStale(reason)) { onStale(); return }
        onError(reason instanceof Error && reason.message !== '' ? reason.message : String(reason))
      })
      .finally(() => { setBusy(false) })
  }, [api, busy, onCards, onError, onStale])

  /** 启用 / 禁用一张卡（乐观切换 + 失败回滚由回包校准兜住）。 */
  const toggleEnabled = useCallback((card: SoulCard): void => {
    submit({ upsert: [{ ...card, enabled: !card.enabled }] })
  }, [submit])

  /** 删除一张卡：先播退场动效，再提交（回包把列表收敛成权威结果）。 */
  const removeCard = useCallback((card: SoulCard): void => {
    if (openId === card.id) { setOpenId(null); setDraft(null) }
    setLeaving(current => (current.includes(card.id) ? current : [...current, card.id]))
    window.setTimeout(() => { setLeaving(current => current.filter(id => id !== card.id)) }, 220)
    submit({ remove: [card.id] })
  }, [openId, submit])

  /** 展开 / 收起一张卡（展开时把当前值拷进草稿）。 */
  const toggleOpen = useCallback((card: SoulCard): void => {
    if (openId === card.id) { setOpenId(null); setDraft(null); return }
    setOpenId(card.id)
    setDraft({ id: card.id, title: card.title, body: card.body })
    setNewForm(null)
  }, [openId])

  /** 保存草稿（失焦或点保存都走这里；无改动时静默返回，不发请求）。 */
  const commitDraft = useCallback((): void => {
    if (cancelRef.current) { cancelRef.current = false; return }
    const current = draft
    if (current === null) return
    const original = cards.find(card => card.id === current.id)
    if (original === undefined) return
    const title = current.title.trim().slice(0, CARD_TITLE_LIMIT)
    const body = current.body.slice(0, CARD_BODY_LIMIT)
    if (title === original.title && body === original.body) return
    submit({ upsert: [{ ...original, title: title === '' ? original.title : title, body }] })
  }, [cards, draft, submit])

  /**
   * 提交一次新顺序：本地先动（手感），再发 reorder（权威）。
   *
   * 两个入口共用：上下箭头（一次一格）与拖拽（一次到任意位）。合并成一处是因为
   * 它们的差别只在「怎么算出新顺序」，之后的落位动效、提交、回包校准完全一样。
   */
  const commitOrder = useCallback((next: SoulCard[], movedId: string): void => {
    const reordered = reindex(next)
    setLocalOrder(reordered.map(card => card.id))
    setLandedId(movedId)
    window.setTimeout(() => { setLandedId(current => (current === movedId ? null : current)) }, 320)
    submit({ reorder: reordered.map(card => card.id) })
  }, [submit])

  /** 调序：本地先动，再提交 reorder。 */
  const move = useCallback((index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= view.length) return
    const next = [...view]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    commitOrder(next, moved.id)
  }, [commitOrder, view])

  /** 拖拽调序：拖动过程本地实时预览，松手提交。 */
  const onDrop = useCallback((targetId: string): void => {
    const from = dragId.current
    dragId.current = null
    setDragOverId(null)
    if (from === null || from === targetId) return
    const next = [...view]
    const fromIndex = next.findIndex(card => card.id === from)
    const toIndex = next.findIndex(card => card.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    commitOrder(next, moved.id)
  }, [commitOrder, view])

  /** 新建卡片：id 留空串，由 host 生成稳定 id（kind+title 的 sha1）。 */
  const createCard = useCallback((): void => {
    const form = newForm
    if (form === null) return
    const title = form.title.trim()
    if (title === '') return
    const order = view.length === 0 ? 0 : Math.max(...view.map(card => card.order)) + 10
    submit({
      upsert: [{
        id: '',
        kind: form.kind,
        title: title.slice(0, CARD_TITLE_LIMIT),
        body: '',
        enabled: true,
        order,
        presetId: null,
        updatedAt: new Date().toISOString(),
      }],
    }, response => {
      setNewForm(null)
      // 新卡落位：回包后按标题找到 host 生成的那张，让它弹一下——否则新卡是
      // 悄悄出现在列表里的，用户不知道加到了哪里（尤其列表已经很长时）。
      const created = response.cards.find(card => card.title === title && card.body === '')
      if (created !== undefined) {
        setLandedId(created.id)
        window.setTimeout(() => { setLandedId(current => (current === created.id ? null : current)) }, 320)
      }
    })
  }, [newForm, submit, view])

  const enabledCount = view.filter(card => card.enabled).length

  return (
    <section className={css.card} aria-label={t('soulCards')} data-soul-section="cards">
      <div className={css.cardTitle}>
        <CardKindIcon kind="principles" size={14} />
        {t('soulCards')}
        <span className={`${css.chip} ${css.chipMuted}`}>{t('soulCardsCount', { n: view.length, on: enabledCount })}</span>
      </div>
      <span className={css.cardHint}>{t('soulCardsHint')}</span>

      <div className={css.cardList}>
        {view.map((card, index) => {
          const open = openId === card.id
          const editing = open && draft !== null && draft.id === card.id
          const title = editing ? draft.title : card.title
          const body = editing ? draft.body : card.body
          return (
            <div
              key={card.id}
              className={[
                css.cardRow,
                open ? css.cardRowOpen : '',
                card.enabled ? '' : css.cardRowOff,
                landedId === card.id ? css.cardRowLanded : '',
                leaving.includes(card.id) ? css.cardRowLeaving : '',
                dragOverId === card.id ? css.cardRowDrop : '',
                css.cardRowIn,
              ].filter(item => item !== '').join(' ')}
              style={{ animationDelay: `${String(Math.min(index, 8) * 28)}ms` }}
              draggable
              onDragStart={() => { dragId.current = card.id }}
              onDragOver={event => {
                event.preventDefault()
                // 拖到自己身上不显示插入位（否则会闪一下又消失）
                if (dragId.current !== null && dragId.current !== card.id) setDragOverId(card.id)
              }}
              onDragLeave={() => { setDragOverId(current => (current === card.id ? null : current)) }}
              onDrop={event => { event.preventDefault(); onDrop(card.id) }}
              data-card-id={card.id}
              data-card-kind={card.kind}
            >
              <div className={css.cardRowHead}>
                <span className={css.cardGrips}>
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnIcon} ${css.btnGhost}`}
                    aria-label={t('soulCardMoveUp')}
                    title={t('soulCardMoveUp')}
                    disabled={busy || index === 0}
                    onClick={() => { move(index, -1) }}
                  ><ArrowIcon dir="up" /></button>
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnIcon} ${css.btnGhost}`}
                    aria-label={t('soulCardMoveDown')}
                    title={t('soulCardMoveDown')}
                    disabled={busy || index === view.length - 1}
                    onClick={() => { move(index, 1) }}
                  ><ArrowIcon dir="down" /></button>
                </span>

                <span className={css.cardKindIcon} data-kind={card.kind} title={t(KIND_LABEL[card.kind])}>
                  <CardKindIcon kind={card.kind} />
                </span>

                <button
                  type="button"
                  className={css.cardRowMain}
                  aria-expanded={open}
                  aria-label={`${t('soulCardExpand')} ${card.title}`}
                  onClick={() => { toggleOpen(card) }}
                >
                  <span className={css.cardRowTitle}>{title.trim() === '' ? t('soulCardUntitled') : title}</span>
                  <span className={css.cardRowMeta}>
                    {t(KIND_LABEL[card.kind])}
                    <span className={css.cardRowDot}>·</span>
                    {t('soulCardChars', { n: body.length })}
                    {card.presetId !== null && <><span className={css.cardRowDot}>·</span>{t('soulCardFromPreset')}</>}
                  </span>
                </button>

                <span className={css.cardRowActions}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={card.enabled}
                    aria-label={`${card.enabled ? t('soulCardDisable') : t('soulCardEnable')} ${card.title}`}
                    title={card.enabled ? t('soulCardDisable') : t('soulCardEnable')}
                    disabled={busy}
                    className={css.switch}
                    onClick={() => { toggleEnabled(card) }}
                  />
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnIcon} ${css.btnGhost}`}
                    aria-label={`${open ? t('soulCardCollapse') : t('soulCardExpand')} ${card.title}`}
                    title={open ? t('soulCardCollapse') : t('soulCardExpand')}
                    onClick={() => { toggleOpen(card) }}
                  ><CaretIcon open={open} /></button>
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnIcon} ${css.btnDanger}`}
                    aria-label={`${t('soulCardDelete')} ${card.title}`}
                    title={t('soulCardDelete')}
                    disabled={busy}
                    onClick={() => { removeCard(card) }}
                  >×</button>
                </span>
              </div>

              {/* 正文摘要两行：磁贴形态下让每张卡「看得见内容」而不只是一行标题。
                  默认 display:none（行式宿主不重复正文），工作台主题（hub/theme.ts）
                  在 .wb-root 里把它打开成两行截断。 */}
              <span className="dsh-soul-card-body-excerpt" aria-hidden="true">{body}</span>

              {/* 展开的编辑区：max-height 过渡（高度动画只能用高度属性表达） */}
              <div className={open ? `${css.cardEditor} ${css.cardEditorOpen}` : css.cardEditor}>
                <div className={css.cardEditorInner}>
                  <div className={css.field}>
                    <span className={css.label}>{t('soulCardTitleLabel')}</span>
                    <input
                      className={css.input}
                      aria-label={t('soulCardTitleLabel')}
                      placeholder={t('soulCardTitlePlaceholder')}
                      maxLength={CARD_TITLE_LIMIT}
                      value={title}
                      onChange={event => {
                        const value = event.currentTarget.value
                        setDraft(current => (current === null ? current : { ...current, title: value }))
                      }}
                      onBlur={commitDraft}
                    />
                  </div>
                  <div className={css.field}>
                    <span className={css.label}>
                      {t('soulCardBodyLabel')}
                      <span className={`${css.chip} ${css.chipMuted}`}>{t('soulCardCharCount', { n: body.length, max: CARD_BODY_LIMIT })}</span>
                    </span>
                    <textarea
                      className={css.textarea}
                      aria-label={t('soulCardBodyLabel')}
                      placeholder={t('soulCardBodyPlaceholder')}
                      maxLength={CARD_BODY_LIMIT}
                      value={body}
                      onChange={event => {
                        const value = event.currentTarget.value
                        setDraft(current => (current === null ? current : { ...current, body: value }))
                      }}
                      onBlur={commitDraft}
                    />
                  </div>
                  <div className={css.actions}>
                    <button
                      type="button"
                      className={`${css.btn} ${css.btnPrimary}`}
                      disabled={busy}
                      onClick={commitDraft}
                    >{t('soulCardSave')}</button>
                    <button
                      type="button"
                      className={`${css.btn} ${css.btnGhost}`}
                      onMouseDown={() => { cancelRef.current = true }}
                      onClick={() => {
                        setOpenId(null)
                        setDraft(null)
                        window.setTimeout(() => { cancelRef.current = false }, 0)
                      }}
                    >{t('soulCardCancel')}</button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {view.length === 0 && (
          <div className={css.cardEmpty}>{t('soulCardsEmpty')}</div>
        )}
      </div>

      {/* ── 新增卡片 ── */}
      {newForm === null
        ? (
          <div className={css.actions}>
            <button
              type="button"
              className={css.btn}
              disabled={busy}
              onClick={() => { setNewForm({ kind: 'custom', title: '' }); setOpenId(null); setDraft(null) }}
            >+ {t('soulCardNew')}</button>
            <button
              type="button"
              className={css.btn}
              disabled={busy || view.length === 0}
              onClick={() => { onSaveAsPreset(view) }}
            >{t('soulPresetSaveAs')}</button>
          </div>
        )
        : (
          <div className={css.newCard}>
            <div className={css.field}>
              <span className={css.label}>{t('soulCardKindLabel')}</span>
              <div className={css.kindPicker} role="radiogroup" aria-label={t('soulCardKindLabel')}>
                {SOUL_CARD_KINDS.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={newForm.kind === kind}
                    aria-label={t(KIND_LABEL[kind])}
                    title={t(KIND_LABEL[kind])}
                    className={newForm.kind === kind ? `${css.kindChip} ${css.kindChipOn}` : css.kindChip}
                    onClick={() => { setNewForm(current => (current === null ? current : { ...current, kind })) }}
                  >
                    <CardKindIcon kind={kind} size={14} />
                    <span>{t(KIND_LABEL[kind])}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={css.fieldRow}>
              <div className={css.field}>
                <span className={css.label}>{t('soulCardTitleLabel')}</span>
                <input
                  className={css.input}
                  aria-label={t('soulCardNewTitle')}
                  placeholder={t('soulCardTitlePlaceholder')}
                  maxLength={CARD_TITLE_LIMIT}
                  value={newForm.title}
                  autoFocus
                  onChange={event => {
                    const value = event.currentTarget.value
                    setNewForm(current => (current === null ? current : { ...current, title: value }))
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); createCard() }
                    if (event.key === 'Escape') { setNewForm(null) }
                  }}
                />
              </div>
            </div>
            <div className={css.actions}>
              <button
                type="button"
                className={`${css.btn} ${css.btnPrimary}`}
                disabled={busy || newForm.title.trim() === ''}
                onClick={createCard}
              >{t('soulCardCreate')}</button>
              <button
                type="button"
                className={`${css.btn} ${css.btnGhost}`}
                onClick={() => { setNewForm(null) }}
              >{t('soulCardCancel')}</button>
            </div>
          </div>
        )}
    </section>
  )
}
