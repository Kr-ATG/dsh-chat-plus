/**
 * styles.ts — 工作台 (Workbench) 统一容器样式。
 *
 * 极简、清爽、纯净的 DSH 原生风格。
 */

const STYLE_ID = 'dsh-workbench-hub-styles'

const SHEET = `
.wb-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base, #0f1117);
  color: var(--dsw-alias-label-primary, #f3f4f6);
  font-family: inherit;
  overflow: hidden;
  position: relative;
}

.wb-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 46px;
  padding: 0 18px;
  background: transparent;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  z-index: 10;
}

.wb-header-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.wb-brand {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #fff);
  user-select: none;
  letter-spacing: -0.01em;
}

/* ── 统一 Segmented 切换器：官方 schedule 页 filterTabs 语言——
   无容器底色、无边框，active 只用中性灰底 + 主文字色 ── */
.wb-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.wb-tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 26px;
  padding: 0 13px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  font-size: 12.5px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 140ms ease;
  user-select: none;
  white-space: nowrap;
}

.wb-tab-btn svg {
  flex-shrink: 0;
  stroke: currentColor;
  color: inherit;
  transition: transform 120ms ease;
}

.wb-tab-btn span {
  color: inherit;
  line-height: 1;
}

.wb-tab-btn:hover {
  color: var(--dsw-alias-label-primary, #eee);
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.06));
}

.wb-tab-btn[data-active],
.wb-tab-btn[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-primary, #eee);
  font-weight: 600;
}

.wb-tab-btn[data-active] span,
.wb-tab-btn[data-active="true"] span,
.wb-tab-btn[data-active] svg,
.wb-tab-btn[data-active="true"] svg {
  color: inherit;
  stroke: currentColor;
}

.wb-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #999);
  cursor: pointer;
  transition: all 120ms ease;
}

.wb-icon-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-primary, #eee);
}

.wb-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
`

export function ensureWorkbenchStyles(): void {
  if (typeof document === 'undefined') return
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-triad'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
}
