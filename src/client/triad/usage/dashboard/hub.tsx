/**
 * hub — 用量面板共享视觉层。
 *
 * 精简前这里承载「用量工作台」整套骨架（分类导航、统计卡行、下拉菜单、区块
 * 标题、今日概览瓦片、供应商排行行…）。工作台下线后只留下两类东西：
 *
 *  - 查询胶囊与下拉菜单的类名（`usm-range-*` / `usm-drop-*` / `usm-tool-button`）
 *    —— RangePicker 与 Token 活动的指标下拉在用；
 *  - 一组线性图标（feather 风，与导航/技能面板同款描边）。
 *
 * 卡片自身的紧凑样式在 UsagePanel.tsx 局部注入，不进这里。
 *
 * 前缀 usm-（usage workbench）避免与宿主/skm 冲突；样式注入幂等。
 */

const STYLE_ID = 'dsh-usage-hub-styles'

/* 注入式 CSS 红线：注释内部不得出现会提前闭合注释块的字符序列，
   本块注释均已回避该写法。 */
const SHEET = `
/* ── 查询范围胶囊 ── */
.usm-range-grid { flex: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 0 2px; }
.usm-range-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center; height: 30px;
  box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 999px; background: var(--dsw-alias-bg-base, #fff); padding: 0 8px;
  font-size: 12px; line-height: 17px; font-family: inherit; white-space: nowrap; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #61666b);
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}
.usm-range-btn:hover { color: var(--dsw-alias-label-primary, #1f2430); border-color: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.16)); }
.usm-range-btn:active { transform: scale(0.96); }
/* 选中态与技能面板选中按钮一致：品牌蓝底白字（两种主题下均成立） */
.usm-range-btn[data-active] {
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
  color: #fff;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent);
}
/* 紧凑形态（用量卡片顶行）：单行小胶囊，按钮矮一档 */
.usm-range-grid[data-compact] { display: flex; flex-wrap: wrap; gap: 4px; padding: 0; }
.usm-range-grid[data-compact] .usm-range-btn { height: 24px; padding: 0 9px; font-size: 11px; line-height: 15px; }
.usm-range-custom { flex: none; display: flex; flex-direction: column; gap: 6px; margin-top: 10px; animation: usm-form-in 160ms ease-out; }
.usm-range-date-row { display: flex; align-items: center; gap: 6px; padding: 0 2px; }
.usm-range-date-sep { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.usm-range-date {
  flex: 1; min-width: 0; height: 30px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px; background: var(--dsw-alias-bg-base, #fff); padding: 0 8px; font-size: 12px;
  color: var(--dsw-alias-label-primary, #1f2430); font-family: inherit; color-scheme: dark light; outline: none;
}
.usm-range-date:focus { border-color: var(--dsw-alias-state-business-primary, #4176e6); }
/* ── 工具栏按钮 + 下拉菜单（指标口径切换） ── */
.usm-tool-button {
  flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12)); border-radius: 10px;
  background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 13px; line-height: 18px; font-family: inherit; padding: 0 12px; cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
}
.usm-tool-button:hover { background: var(--dsw-alias-interactive-bg-hover-solid, #f7f8f9); color: var(--dsw-alias-label-primary, #0f1115); }
.usm-tool-button:active { transform: scale(0.97); }
.usm-drop-wrap { position: relative; flex: none; }
.usm-bulk-overlay { position: fixed; inset: 0; z-index: 995; border: none; background: transparent; cursor: default; padding: 0; }
.usm-drop-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 996; min-width: 180px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12)); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 14%, transparent);
  padding: 4px; display: flex; flex-direction: column; gap: 2px; animation: usm-form-in 140ms ease-out;
}
.usm-drop-item {
  display: flex; align-items: center; gap: 8px; border: none; border-radius: 8px; padding: 7px 10px;
  background: transparent; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary, #61666b);
  cursor: pointer; font-family: inherit; text-align: left; white-space: nowrap;
  transition: background 120ms ease, color 120ms ease;
}
.usm-drop-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04)); color: var(--dsw-alias-label-primary, #0f1115); }
.usm-drop-item[aria-checked='true'] { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; }
.usm-drop-check { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--dsw-alias-state-business-primary, #4176e6); opacity: 0; transform: scale(0.6); transition: opacity 140ms ease, transform 140ms ease; }
.usm-drop-check[data-on] { opacity: 1; transform: scale(1); }
/* ── 供应商 / 模型下拉（查询区，选项多一量级：搜索 + 滚动 + token 次要信息） ── */
.usm-scope { flex: none; display: flex; align-items: center; gap: 6px; min-width: 0; }
.usm-tool-button[data-compact] { height: 24px; padding: 0 8px; font-size: 11px; line-height: 16px; gap: 4px; max-width: 190px; }
.usm-scope-trigger-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usm-drop-menu[data-wide] { max-height: 292px; overflow-y: auto; overscroll-behavior: contain; }
.usm-scope-search {
  flex: none; width: 100%; height: 26px; box-sizing: border-box; margin: 2px 2px 4px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); border-radius: 7px;
  background: var(--dsw-alias-bg-base, #fff); font-size: 12px; line-height: 16px; font-family: inherit;
  color: var(--dsw-alias-label-primary, #1f2430); outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.usm-scope-search:focus { border-color: var(--dsw-alias-state-business-primary, #4176e6); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.usm-scope-item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.usm-scope-item-num { flex: none; margin-left: auto; padding-left: 10px; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary, #81858c); }
.usm-scope-empty { padding: 8px 10px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
/* ── 头部刷新按钮（spin 态） ── */
.usm-refresh { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 8px; padding: 0; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #bbb); transition: background 140ms ease, color 140ms ease, transform 140ms ease; }
.usm-refresh:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06)); color: var(--dsw-alias-label-primary, #eee); }
.usm-refresh:active { transform: scale(0.94); }
.usm-refresh[data-spin] svg { animation: usm-spin 700ms linear infinite; }
@keyframes usm-spin { to { transform: rotate(360deg); } }
@keyframes usm-form-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 767.98px) {
  .usm-range-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 260px; }
}
@media (prefers-reduced-motion: reduce) {
  .usm-range-btn { transition: none; }
  .usm-drop-menu, .usm-range-custom { animation: none; }
}
`

/** 类名表（仅保留仍在用的几族）。 */
export const css = {
  rangeGrid: 'usm-range-grid',
  rangeBtn: 'usm-range-btn',
  rangeCustom: 'usm-range-custom',
  rangeDateRow: 'usm-range-date-row',
  rangeDateSep: 'usm-range-date-sep',
  rangeDate: 'usm-range-date',
  toolButton: 'usm-tool-button',
  dropWrap: 'usm-drop-wrap',
  bulkOverlay: 'usm-bulk-overlay',
  dropMenu: 'usm-drop-menu',
  dropItem: 'usm-drop-item',
  dropCheck: 'usm-drop-check',
  refresh: 'usm-refresh',
}

/** 幂等注入 hub 样式。 */
export function ensureHubStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/* ─────────────────────────────── 组件 ─────────────────────────────── */

/** 线性图标集（feather 风，与导航/技能面板同款描边）。 */
export function tokensIcon(size = 18, stroke = 1.8): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  )
}

export function inputIcon(size = 18, stroke = 1.8): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  )
}

export function outputIcon(size = 18, stroke = 1.8): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21V9" />
      <path d="m7 14 5-5 5 5" />
      <path d="M4 3h16" />
    </svg>
  )
}

export function hitIcon(size = 18, stroke = 1.8): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  )
}

/* ── 通用小尺寸 SVG 图标 ── */

/** 对勾（下拉选中态）。 */
export function CheckIcon({ size = 12, stroke = 2.4 }: { size?: number; stroke?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/** 关闭叉（面板关闭 / 明细收起）。 */
export function CloseIcon({ size = 12, stroke = 2.2 }: { size?: number; stroke?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" aria-hidden="true" style={{ flex: 'none' }}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

/** 告警三角（错误卡）。 */
export function WarnIcon({ size = 14, stroke = 1.8 }: { size?: number; stroke?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
