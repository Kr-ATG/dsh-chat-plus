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
/* ── 工作台页面切换动效（Tab 内容滑入 + 顶部 Tab 滑块） ──
   .wb-body 的每个直接子级在 key 变化时重播 wb-page-in：淡入 + 轻微右移，
   与官方 schedule 页换 tab 的观感一致；150ms 足够快，不拖手感。 */
.wb-body > * {
  animation: wb-page-in 190ms cubic-bezier(.2,.8,.2,1);
}
@keyframes wb-page-in {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: none; }
}

/* ── 工作台「供应商」页：整页留白 + 纵向滚动（页面比设置弹窗宽得多） ── */
.wb-supplier-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 22px 28px;
  box-sizing: border-box;
}
.wb-supplier-scroll > * { animation: wb-page-in 190ms cubic-bezier(.2,.8,.2,1); }

/* ── 供应商页底部的「网络代理」区块：普通列容器（滚动交给 .phub-blocks） ── */
.pp-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
/* 逐供应商开关行：hover 提亮 + 按下位移，与供应商列表行同一套反馈。 */
.pp-row { transition: border-color .16s, background .16s, opacity .16s; }
.pp-row:hover { border-color: var(--dsw-alias-border-l3, rgba(255,255,255,.22)); background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.04)); }

@media (prefers-reduced-motion: reduce) {
  .wb-body > *, .wb-supplier-scroll > * { animation: none !important; }
  .pp-row { transition: none; }
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
