/**
 * 三个「能力模型」区块（辅助视觉 / 生图 / 生视频）的共享外壳与控件。
 *
 * 统一版式，取代此前各块自绘的裸标题 + 整段说明文字 + 裸列表行：
 *  - {@link BlockShell}：标题行（标题 + 当前生效 pill + 「说明」折叠开关）
 *    + 折叠的说明段 + 内容区；说明默认收起，页面从三大段文字变成三行标题。
 *  - {@link Pill}：当前生效值的胶囊徽章（等宽字体，成功色点）。
 *  - {@link SelectField}：带浮起标签的下拉。
 *  - {@link IconButton}：24px 方形图标钮（上移/下移/删除），替代挤在一起的方块按钮。
 *
 * **控件规格逐字对齐官方**（2026-10-05 用户点名「都没用官方的那种样式，特别是下拉框」）：
 *  - 下拉 / 输入框：官方 `ModelsSection.module.css` 的 `.input` + `.selectInput`
 *    —— 0.5px `--dsw-alias-border-l4` 描边、`--dsw-radius-md`(12px) 圆角、32px 高、
 *    14px/22px 字、`--dsw-alias-bg-layer-1` 底、focus 换 `state-business-primary`、
 *    chevron 12×12 贴 right 12px center；
 *  - 开关：官方 `Switch.module.css` —— 36×20 轨道 + 16px 圆钮、`aria-checked` 驱动外观、
 *    开启态 `--dsw-alias-brand-primary`、120ms transform；
 *  - 按钮：官方 `Button.module.css` 的 `.sm` + `.outline`/`.ghost`/`.primary`
 *    —— 28px 高、12px 字、`--dsw-radius-sm`(8px) 圆角、0.5px `--dsw-alias-border-l3`。
 *
 * 为什么复刻 CSS 而不是直接 require 官方组件：`@deepseek-ai/dsh-client-ui-primitives`
 * 的 CSS Modules 由各 bundle 自己内联注入，插件渲染它的组件时样式表未必已注入
 * （实测页面上查不到 `Switch.module.css` 的规则），会出现「结构对、外观裸」。
 * 复刻规格则与官方逐字同 token、同尺寸，且不依赖注入时机。
 */
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

/**
 * 官方下拉规格（逐字对齐 `ModelsSection.module.css` 的 `.input` + `.selectInput`）。
 *
 * 与原自绘版的差别（也是「不像官方」的根因）：
 *   描边 1px border-l2 → **0.5px border-l4**；圆角 8 → **`--dsw-radius-md`(12px)**；
 *   字号 13 → **14/22**；chevron 贴 right 10px → **right 12px**；padding-right 30 → **32**；
 *   补上 focus 态（换 `state-business-primary` 描边、去 outline）与 disabled 态。
 */
export const SELECT_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: 32,
  padding: '0 32px 0 10px',
  borderRadius: 'var(--dsw-radius-md, 12px)',
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(255,255,255,.2))',
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  appearance: 'none',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 14, lineHeight: '22px', cursor: 'pointer',
  minWidth: 0,
}

/**
 * 官方文本输入规格（与 {@link SELECT_STYLE} 同族，只是不带 chevron）。
 * 逐字对齐官方 `.input`：0.5px border-l4 / radius-md / 32px / 14-22 / bg-layer-1。
 */
export const INPUT_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: 32,
  padding: '0 10px',
  borderRadius: 'var(--dsw-radius-md, 12px)',
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(255,255,255,.2))',
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 14, lineHeight: '22px',
  minWidth: 0, width: '100%',
  outline: 'none',
}

/**
 * 官方开关规格（`Switch.module.css`）：36×20 轨道 + 16px 圆钮。
 *
 * 外观由 `aria-checked` 驱动（官方注释原话：视觉态不能与无障碍态打架），
 * 所以这里的样式是**静态**的，开/关只切 aria-checked 与 thumb 的 transform。
 */
export const OFFICIAL_SWITCH: CSSProperties = {
  boxSizing: 'border-box',
  position: 'relative',
  flex: '0 0 auto',
  width: 36,
  height: 20,
  padding: 2,
  border: 'none',
  borderRadius: 999,
  background: 'var(--dsw-alias-border-l3, rgba(255,255,255,.14))',
  cursor: 'pointer',
  transition: 'background 120ms ease',
}

export const OFFICIAL_SWITCH_ON: CSSProperties = {
  ...OFFICIAL_SWITCH,
  background: 'var(--dsw-alias-brand-primary, #4176e6)',
}

export const OFFICIAL_SWITCH_THUMB: CSSProperties = {
  display: 'block',
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: 'var(--dsw-alias-switch-thumb, var(--dsw-alias-label-primary))',
  transition: 'transform 120ms ease',
}

export const OFFICIAL_SWITCH_THUMB_ON: CSSProperties = {
  ...OFFICIAL_SWITCH_THUMB,
  background: 'var(--dsw-alias-label-primary-foreground, #fff)',
  transform: 'translateX(16px)',
}

/** 官方小按钮（`Button.module.css` 的 `.sm` + `.outline`）。 */
export const OFFICIAL_BTN_SM: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  height: 28, padding: '0 10px', flexShrink: 0,
  border: '0.5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.14))',
  borderRadius: 'var(--dsw-radius-sm, 8px)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer',
  transition: 'background 120ms ease',
}

/** 官方小按钮（`.sm` + `.ghost`）：无描边，hover 出中性底。 */
export const OFFICIAL_BTN_GHOST: CSSProperties = {
  ...OFFICIAL_BTN_SM,
  border: 'none',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 官方小按钮（`.sm` + `.primary`）：实心主色。 */
export const OFFICIAL_BTN_PRIMARY: CSSProperties = {
  ...OFFICIAL_BTN_SM,
  border: 'none',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}

/** 官方行内小按钮（Button .sm + .outline）：28px / radius-sm(8px) / 0.5px border-l3。 */
export const CAPSULE_BTN: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  height: 28, padding: '0 10px', flexShrink: 0,
  border: '0.5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.14))',
  borderRadius: 'var(--dsw-radius-sm, 8px)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer',
  transition: 'background 120ms ease',
}

export const CAPSULE_BTN_DISABLED: CSSProperties = { ...CAPSULE_BTN, opacity: 0.45, cursor: 'default' }

/**
 * 行卡片：官方 `.modelEntry` 规格 —— 0.5px `border-l4` + `--dsw-radius-lg`(16px) + padding 6。
 *
 * 原自绘版是 1px border-l2 + 10px 圆角 + padding 9/12，与官方模型行并排能看出两套。
 */
export const ROW_CARD: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: 6, borderRadius: 'var(--dsw-radius-lg, 16px)', minWidth: 0,
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(255,255,255,.2))',
  transition: 'border-color 120ms ease, background 120ms ease',
}

/**
 * 编辑面（填充面）：官方 `.editor` 规格 —— `--dsw-radius-lg`(16px) +
 * `bg-module-platform` + gap 14 + padding 14/16。 */
export const FILL_PANEL: CSSProperties = {
  display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap',
  padding: '14px 16px', borderRadius: 'var(--dsw-radius-lg, 16px)',
  background: 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
}

export const MONO: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 12, lineHeight: '18px',
}

/* 官方 .modelCatalogMeta / .advancedHint 规格：12px / 18px / label-tertiary。 */
const HINT_TEXT: CSSProperties = {
  margin: 0, fontSize: 12, lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * 当前生效值的胶囊徽章。
 * @param props - 文本与语气（active=成功色点，muted=灰点）。
 */
export function Pill({ text, tone = 'active' }: { text: string; tone?: 'active' | 'muted' }): ReactNode {
  const color = tone === 'active'
    ? 'var(--dsw-alias-state-success-primary, #00b42a)'
    : 'var(--dsw-alias-label-tertiary, #8f959e)'
  // 官方 `.rowTag` 规格：0.5px border-l3 + --dsw-radius-xs(4px) + padding 1/6 + 11/16；
  // 状态点用官方 `.credentialDot` 的 8×8。
  return (
    <span
      title={`当前生效：${text}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: '1px 6px', borderRadius: 'var(--dsw-radius-xs, 4px)', maxWidth: 320,
        border: '0.5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.14))',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11, lineHeight: '16px',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ ...MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </span>
  )
}

/** 24px 方形图标钮（上移/下移/删除）。 */
export function IconButton({ label, glyph, disabled, danger, onClick }: {
  label: string
  glyph: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className={danger === true ? 'dsh-webui-icon-btn-danger' : 'dsh-webui-icon-btn'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      /* 官方 .iconButton 规格：28×28 / radius-sm / hover 出中性底并提亮文字。 */
      style={{
        width: 28, height: 28, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', borderRadius: 'var(--dsw-radius-sm, 8px)', background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 13, lineHeight: 1,
        cursor: disabled === true ? 'default' : 'pointer',
        opacity: disabled === true ? 0.4 : 1,
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      {glyph}
    </button>
  )
}

/**
 * 带小标签的下拉字段（标签在上，12px 次级色）。
 *
 * 宽度默认 `flex:1` **撑满可用空间**（原来是写死 176，窄栏里右边空一大片、
 * 宽栏里又挤在左边）。调用方给 `width` 时才退回定宽。
 */
export function SelectField({ label, value, disabled, width, onChange, children }: {
  label: string
  value: string
  disabled?: boolean
  /** 下拉定宽 px；省略则撑满父容器。 */
  width?: number
  onChange: (value: string) => void
  children: ReactNode
}): ReactNode {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 160px' }}>
      {/* 官方 .fieldLabel：12px / 500 / label-secondary。 */}
      <span style={{ fontSize: 12, fontWeight: 500, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>{label}</span>
      <select
        /* 宽度撑满由 width:100% 给；**不要**在这里写 flex —— label 是列向容器，
           flex-basis:0 会顶掉 height:32px，实测下拉被压成 24px 高。 */
        style={{ ...SELECT_STYLE, ...(width === undefined ? { width: '100%' } : { width, flex: 'none' }) }}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => { onChange(event.target.value) }}
      >
        {children}
      </select>
    </label>
  )
}

/**
 * 区块外壳：标题行 + 可折叠说明 + 内容区。
 * @param props - 标题、当前生效值、说明文本与内容。
 */
export function BlockShell({ title, activeText, description, children }: {
  title: string
  /** 当前生效的 provider/model；空串表示未配置。 */
  activeText?: string
  /** 折叠在「说明」后面的长文本。 */
  description: string
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <section className="phub-block phub-block-in" style={{ minWidth: 0 }}>
      {/* 官方 .rowHead（gap 10）+ .rowName（14px / 500 / 22px）。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)', flexShrink: 0 }}>
          {title}
        </span>
        {activeText !== undefined && activeText !== ''
          ? <Pill text={activeText} />
          : <Pill text="未配置" tone="muted" />}
        {/* 官方 .linkButton：28px / radius-sm / label-tertiary / hover 出中性底。 */}
        <button
          type="button"
          className="dsh-webui-link-btn"
          aria-expanded={open}
          onClick={() => { setOpen(v => !v) }}
          style={{
            marginLeft: 'auto', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 28, padding: '0 10px', borderRadius: 'var(--dsw-radius-sm, 8px)',
            border: 'none', background: 'transparent',
            color: 'var(--dsw-alias-label-tertiary)',
            font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer',
          }}
        >
          {open ? '收起说明' : '说明'}
        </button>
      </div>
      {open
        ? <p className="phub-desc-in" style={HINT_TEXT}>{description}</p>
        : null}
      {children}
    </section>
  )
}

/** 加载中/错误/空态的统一小字提示。 */
export function StateHint({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'error' }): ReactNode {
  return (
    <p style={{
      margin: 0, fontSize: 12, lineHeight: '18px',
      color: tone === 'error'
        ? 'var(--dsw-alias-state-error-primary, #d54941)'
        : 'var(--dsw-alias-label-tertiary)',
    }}>{text}</p>
  )
}
