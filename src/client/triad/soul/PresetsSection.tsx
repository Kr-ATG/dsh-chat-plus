/**
 * dsh-soul — 预设区（默认几个预设 + 自定义预设）。
 *
 * ── 这一层解决什么 ────────────────────────────────────────────────────
 * 用户原话要「默认的几个预设和自定义的预设」。预设 = 一套现成的卡片组合：
 * 工程搭档 / 写作助手 / 严谨分析师 / 极简执行者四个内置，加上用户自己存下来的。
 * 应用有两种语义，面板必须都给，因为它们是两种真实意图：
 *   replace 整套采用 —— 「我要换成这个人格」
 *   merge   合并应用 —— 「在现有基础上把语气、准则换掉，自定义卡保留」
 *
 * ── 设计取舍 ──────────────────────────────────────────────────────────
 * 1. **内置预设只读**。host 对删除内置预设回 400，前端直接把删除按钮藏掉——
 *    让用户点到一个注定失败的按钮不是「诚实」，是设计债。徽标用「内置」标出来，
 *    让「为什么这行没有删除」自解释。
 * 2. **应用成功给按钮内打勾 + 顶部 notice**，不用 alert。两种模式共用一个反馈槽，
 *    因为用户一次只会点一个。
 * 3. **存为预设是「当前卡片快照」**。表单默认名是空的（不编默认名，那等于替用户
 *    命名），但把「包含 N 张卡」写清楚，用户知道自己在存什么。
 * 4. **动效**：列表错峰淡入、应用中的转圈、成功打勾弹出、表单展开是
 *    max-height + opacity 过渡。全部 CSS，零依赖，160–260ms。
 */

import { useCallback, useState } from 'react'
import type { SoulApi, SoulCard, SoulCardsResponse, SoulPreset, SoulPresetApplyMode } from './api.js'
import type { SoulT } from './locales.js'
import { css } from './styles.js'

/** 预设名 / 说明的长度上限（与 host 侧截断一致）。 */
const PRESET_NAME_LIMIT = 40
const PRESET_DESC_LIMIT = 120

/** PresetsSection 属性。 */
export interface PresetsSectionProps {
  readonly api: SoulApi
  readonly presets: readonly SoulPreset[]
  /** 当前卡片（「存为预设」的快照来源）。 */
  readonly cards: readonly SoulCard[]
  /**
   * 触发「存为预设」表单：由卡片区的按钮置位（那才是用户视线所在的位置），
   * 表单本身渲染在预设区。null = 表单收起。
   */
  readonly saveAs: readonly SoulCard[] | null
  /** 表单收口（存好了或取消了）。 */
  readonly onSaveAsDone: () => void
  readonly onCards: (response: SoulCardsResponse) => void
  readonly onPresets: (next: SoulPreset[]) => void
  readonly onStale: () => void
  readonly onError: (message: string) => void
  readonly t: SoulT
}

/** 应用反馈槽：一次只服务一个预设。 */
interface ApplyFeedback {
  presetId: string
  mode: SoulPresetApplyMode
  state: 'busy' | 'done'
}

/** 转圈（应用进行中）。 */
function SpinIcon(): JSX.Element {
  return (
    <span className={css.spin} aria-hidden="true">
      <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M8 1.6a6.4 6.4 0 1 1-6.4 6.4" />
      </svg>
    </span>
  )
}

/** 小勾（应用成功）。 */
function CheckIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.2 8.4 6.4 11.6 12.8 4.8" />
    </svg>
  )
}

/** 预设图标（一套卡片 = 一叠）。 */
function PresetIcon({ builtin }: { readonly builtin: boolean }): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {builtin
        ? <path d="M8 1.9l1.5 3.9 4 1.5-4 1.5L8 12.7 6.5 8.8l-4-1.5 4-1.5z" />
        : <><rect x="2.4" y="3.4" width="11.2" height="9.2" rx="2" /><path d="M2.4 6.6h11.2M5.6 9.4h4.8" /></>}
    </svg>
  )
}

/** 预设区主体。 */
export function PresetsSection(props: PresetsSectionProps): JSX.Element {
  const { api, presets, cards, saveAs, onSaveAsDone, onCards, onPresets, onStale, onError, t } = props

  const [feedback, setFeedback] = useState<ApplyFeedback | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  /** 失败分流：host 未更新 / 真错误。 */
  const fail = useCallback((reason: unknown): void => {
    if (api.isHostStale(reason)) { onStale(); return }
    onError(reason instanceof Error && reason.message !== '' ? reason.message : String(reason))
  }, [api, onError, onStale])

  /** 应用预设（两种模式共用）。 */
  const apply = useCallback((preset: SoulPreset, mode: SoulPresetApplyMode): void => {
    if (busyId !== null) return
    setBusyId(preset.id)
    setFeedback({ presetId: preset.id, mode, state: 'busy' })
    void api.applyPreset(preset.id, mode)
      .then(response => {
        onCards(response)
        setFeedback({ presetId: preset.id, mode, state: 'done' })
        window.setTimeout(() => {
          setFeedback(current => (current !== null && current.presetId === preset.id && current.mode === mode && current.state === 'done' ? null : current))
        }, 1400)
      })
      .catch((reason: unknown) => { setFeedback(null); fail(reason) })
      .finally(() => { setBusyId(null) })
  }, [api, busyId, fail, onCards])

  /** 删除自定义预设（内置的不会渲染这个按钮）。 */
  const remove = useCallback((preset: SoulPreset): void => {
    if (busyId !== null) return
    setBusyId(preset.id)
    void api.deletePreset(preset.id)
      .then(next => { onPresets(next) })
      .catch(fail)
      .finally(() => { setBusyId(null) })
  }, [api, busyId, fail, onPresets])

  /** 把当前卡片存成自定义预设。 */
  const save = useCallback((): void => {
    const trimmed = name.trim()
    if (trimmed === '' || saving) return
    setSaving(true)
    void api.createPreset({
      name: trimmed.slice(0, PRESET_NAME_LIMIT),
      desc: desc.trim().slice(0, PRESET_DESC_LIMIT),
      cards: [...cards],
    })
      .then(response => {
        if (response.preset !== null) onPresets([...presets, response.preset])
        setName('')
        setDesc('')
        onSaveAsDone()
      })
      .catch(fail)
      .finally(() => { setSaving(false) })
  }, [api, cards, desc, fail, name, onPresets, onSaveAsDone, presets, saving])

  /** 某个动作当前是不是「进行中」。 */
  const isBusy = (presetId: string, mode: SoulPresetApplyMode): boolean =>
    feedback !== null && feedback.presetId === presetId && feedback.mode === mode && feedback.state === 'busy'
  /** 某个动作是不是「刚成功」。 */
  const isDone = (presetId: string, mode: SoulPresetApplyMode): boolean =>
    feedback !== null && feedback.presetId === presetId && feedback.mode === mode && feedback.state === 'done'

  return (
    <section className={css.card} aria-label={t('soulPresets')} data-soul-section="presets">
      <div className={css.cardTitle}>
        <PresetIcon builtin={false} />
        {t('soulPresets')}
        <span className={`${css.chip} ${css.chipMuted}`}>{t('soulPresetsCount', { n: presets.length })}</span>
      </div>
      <span className={css.cardHint} title={t('soulPresetsHint')}>{t('soulPresetsHint')}</span>

      <div className={css.presetList}>
        {presets.map((preset, index) => (
          <div
            key={preset.id}
            className={`${css.presetRow} ${css.presetRowIn}`}
            style={{ animationDelay: `${String(Math.min(index, 8) * 30)}ms` }}
            data-preset-id={preset.id}
            data-preset-builtin={preset.builtin ? '1' : '0'}
            title={preset.desc !== '' ? preset.desc : preset.name}
          >
            <span className={preset.builtin ? `${css.presetIcon} ${css.presetIconBuiltin}` : css.presetIcon}>
              <PresetIcon builtin={preset.builtin} />
            </span>
            <span className={css.presetMain}>
              <span className={css.presetName}>
                {preset.name}
                {preset.builtin
                  ? <span className={`${css.badge} ${css.badgeOn}`}>{t('soulPresetBuiltin')}</span>
                  : <span className={css.badge}>{t('soulPresetCustom')}</span>}
                <span className={`${css.chip} ${css.chipMuted}`}>{t('soulPresetCardCount', { n: preset.cards.length })}</span>
              </span>
            </span>
            <span className={css.presetActions}>
              <button
                type="button"
                className={[
                  css.btn,
                  css.btnPrimary,
                  isDone(preset.id, 'replace') ? css.btnDone : '',
                ].filter(item => item !== '').join(' ')}
                disabled={busyId !== null}
                onClick={() => { apply(preset, 'replace') }}
              >
                {isBusy(preset.id, 'replace') ? <SpinIcon /> : isDone(preset.id, 'replace') ? <CheckIcon /> : null}
                {isDone(preset.id, 'replace') ? t('soulPresetApplied') : t('soulPresetApplyReplace')}
              </button>
              <button
                type="button"
                className={[
                  css.btn,
                  isDone(preset.id, 'merge') ? css.btnDone : '',
                ].filter(item => item !== '').join(' ')}
                disabled={busyId !== null}
                onClick={() => { apply(preset, 'merge') }}
              >
                {isBusy(preset.id, 'merge') ? <SpinIcon /> : isDone(preset.id, 'merge') ? <CheckIcon /> : null}
                {isDone(preset.id, 'merge') ? t('soulPresetApplied') : t('soulPresetApplyMerge')}
              </button>
              {/* 内置预设只读：host 会回 400，前端直接不给这个入口 */}
              {!preset.builtin && (
                <button
                  type="button"
                  className={`${css.btn} ${css.btnIcon} ${css.btnDanger}`}
                  aria-label={`${t('soulPresetDelete')} ${preset.name}`}
                  title={t('soulPresetDelete')}
                  disabled={busyId !== null}
                  onClick={() => { remove(preset) }}
                >×</button>
              )}
            </span>
          </div>
        ))}

        {presets.length === 0 && <div className={css.cardEmpty}>{t('soulPresetsEmpty')}</div>}
      </div>

      {/* ── 存为预设（表单由卡片区的按钮置位） ── */}
      <div className={saveAs === null ? css.presetForm : `${css.presetForm} ${css.presetFormOpen}`}>
        <div className={css.presetFormInner}>
          <div className={css.cardTitle}>
            <PresetIcon builtin={false} />
            {t('soulPresetSaveAs')}
            <span className={`${css.chip} ${css.chipMuted}`}>{t('soulPresetCardCount', { n: cards.length })}</span>
          </div>
          <div className={css.fieldRow}>
            <div className={css.field}>
              <span className={css.label}>{t('soulPresetNameLabel')}</span>
              <input
                className={css.input}
                aria-label={t('soulPresetNameLabel')}
                placeholder={t('soulPresetNamePlaceholder')}
                maxLength={PRESET_NAME_LIMIT}
                value={name}
                onChange={event => { setName(event.currentTarget.value) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); save() }
                  if (event.key === 'Escape') { onSaveAsDone() }
                }}
              />
            </div>
            <div className={css.field}>
              <span className={css.label}>{t('soulPresetDescLabel')}</span>
              <input
                className={css.input}
                aria-label={t('soulPresetDescLabel')}
                placeholder={t('soulPresetDescPlaceholder')}
                maxLength={PRESET_DESC_LIMIT}
                value={desc}
                onChange={event => { setDesc(event.currentTarget.value) }}
              />
            </div>
          </div>
          <div className={css.actions}>
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              disabled={saving || name.trim() === ''}
              onClick={save}
            >
              {saving ? <SpinIcon /> : null}
              {saving ? t('soulPresetSaving') : t('soulPresetSave')}
            </button>
            <button
              type="button"
              className={`${css.btn} ${css.btnGhost}`}
              onClick={() => { onSaveAsDone() }}
            >{t('soulPresetCancel')}</button>
          </div>
        </div>
      </div>
    </section>
  )
}
