/**
 * ScopeFilter — 供应商 / 模型两个下拉。
 *
 * 与 ActivityGrid 的指标下拉同族（`usm-drop-*` 那套样式与勾选动效），只是
 * 选项多一个量级：供应商二十来个、模型四十多个，所以额外带搜索框和滚动，
 * 且把 token 量作为次要信息排在右侧——排序就是按它降序，用户能直接看出
 * 「选谁最费」。
 *
 * 供应商与模型是**级联**关系：选了供应商，模型下拉只列该供应商的模型；
 * 反过来选了模型（必然已经隐含了供应商），供应商下拉仍保持当前值不变，
 * 避免用户想「换个模型」时两级互相打架。
 *
 * ⚠️ 选项的 `id` 是**完整 model 串**（含 `provider/` 前缀），label 才是剥了前缀
 * 的短名——筛选按 id 全等比对，曾经这里拿 label 当 id 用过，选任何模型都筛不出
 * 数据（详见 aggregate.ts 的 collectOptions 注释）。因为 id 完整，同名不同供应商
 * 的模型（`workbuddy-ai/deepseek-v4.1-flash` 与 `workbuddy/deepseek-v4.1-flash`）
 * 是两个独立选项，展示时必须带上供应商前缀才不会读成同一个。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { css, CheckIcon } from '../hub'
import { formatUnits } from '../format'
import { providerOfModel, type ScopeOption } from '../aggregate'

export interface ScopeFilterProps {
  providers: ScopeOption[]
  models: ScopeOption[]
  provider: string | null
  model: string | null
  onChangeProvider: (provider: string | null) => void
  onChangeModel: (model: string | null) => void
}

const ALL_LABEL = '全部供应商'
const ALL_MODEL_LABEL = '全部模型'

/**
 * 同名模型的消歧后缀。
 *
 * 只在**确实重名**时才加供应商前缀：`deepseek-v4.1-flash` 在三个供应商下都有，
 * 三条并列时用户分不出选哪条；而唯一的模型加上前缀只是白白变长。
 * @param options - 当前下拉的全部选项。
 * @returns id → 追加的供应商前缀（无重名时为空串）。
 */
function disambiguationOf(options: ScopeOption[]): Map<string, string> {
  const byLabel = new Map<string, number>()
  for (const o of options) byLabel.set(o.label, (byLabel.get(o.label) ?? 0) + 1)
  const out = new Map<string, string>()
  for (const o of options) {
    if ((byLabel.get(o.label) ?? 0) > 1) out.set(o.id, providerOfModel(o.id))
  }
  return out
}

/** 一个下拉：触发钮 + 透明遮罩 + 浮层菜单（可带搜索）。 */
function Dropdown({
  label, options, value, allLabel, searchable, menuWidth, onSelect,
}: {
  label: string
  options: ScopeOption[]
  value: string | null
  allLabel: string
  searchable?: boolean
  menuWidth: number
  onSelect: (id: string | null) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  // 菜单挂到 body：卡片是 overflow:hidden 的圆角浮层，浮层留在里面会被左右
  // 裁掉（模型名一长就露馅）。定位用触发钮打开瞬间的视口坐标，页面一动就关。
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    const onMove = (): void => { setOpen(false) }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  useEffect(() => { if (!open) setQuery('') }, [open])

  /** 重名模型的消歧后缀（id → 供应商前缀）。 */
  const disambiguation = useMemo(() => disambiguationOf(options), [options])

  /** 展示名：重名时补上 `供应商 · ` 前缀。 */
  const displayOf = (o: ScopeOption): string => {
    const prefix = disambiguation.get(o.id)
    return prefix === undefined ? o.label : `${prefix} · ${o.label}`
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    // 搜索同时匹配展示名与完整 id：用户可能记得 `workbuddy-ai/...` 这种全名。
    return q === '' ? options : options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
  }, [options, query])

  // 当前值也要带消歧前缀，否则选中重名模型后触发钮上读不出选的是哪一个。
  const currentOption = value === null ? undefined : options.find((o) => o.id === value)
  const current = value === null ? allLabel : (currentOption === undefined ? value : displayOf(currentOption))

  const toggle = (): void => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r === undefined) return
    // 与触发钮左缘对齐向右展开（卡片右侧留白足够，右对齐反而会伸出卡片左缘）；
    // 底部空间不够就上翻。
    const left = Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8))
    const below = window.innerHeight - r.bottom - 12
    const top = below < 220 && r.top > below ? Math.max(8, r.top - Math.min(292, r.top - 8)) : r.bottom + 4
    setAnchor({ left, top })
    setOpen(true)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={css.toolButton}
        data-compact="true"
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-label={label}
        title={current}
        onClick={toggle}
      >
        <span className="usm-scope-trigger-label">{current}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.7, flex: 'none' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && anchor !== null && createPortal(
        <>
          <button type="button" className={css.bulkOverlay} aria-label="关闭" onClick={() => { setOpen(false) }} />
          <div className={css.dropMenu} role="menu" aria-label={label} data-wide="true" style={{ position: 'fixed', left: anchor.left, top: anchor.top, width: menuWidth, zIndex: 1200 }}>
            {searchable && (
              <input
                autoFocus
                className="usm-scope-search"
                placeholder={label === '供应商' ? '搜索供应商' : '搜索模型'}
                value={query}
                onChange={e => { setQuery(e.target.value) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (visible.length > 0) { onSelect(visible[0].id); setOpen(false) }
                  }
                }}
              />
            )}
            <button
              type="button"
              role="menuitemradio"
              className={css.dropItem}
              aria-checked={value === null}
              onClick={() => { onSelect(null); setOpen(false) }}
            >
              <span className={css.dropCheck} data-on={value === null || undefined} aria-hidden="true"><CheckIcon size={11} /></span>
              {allLabel}
            </button>
            {visible.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                className={css.dropItem}
                aria-checked={o.id === value}
                title={o.id}
                onClick={() => { onSelect(o.id); setOpen(false) }}
              >
                <span className={css.dropCheck} data-on={o.id === value || undefined} aria-hidden="true"><CheckIcon size={11} /></span>
                <span className="usm-scope-item-label">{displayOf(o)}</span>
                <span className="usm-scope-item-num">{formatUnits(o.tokens)}</span>
              </button>
            ))}
            {visible.length === 0 && <div className="usm-scope-empty">无匹配项</div>}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

/** 供应商 + 模型级联下拉。 */
export function ScopeFilter({ providers, models, provider, model, onChangeProvider, onChangeModel }: ScopeFilterProps): JSX.Element {
  return (
    <div className="usm-scope">
      <Dropdown
        label="供应商"
        allLabel={ALL_LABEL}
        options={providers}
        value={provider}
        menuWidth={184}
        searchable
        onSelect={onChangeProvider}
      />
      <Dropdown
        label="模型"
        allLabel={ALL_MODEL_LABEL}
        options={models}
        value={model}
        menuWidth={232}
        searchable
        onSelect={onChangeModel}
      />
    </div>
  )
}
