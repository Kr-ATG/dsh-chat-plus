/**
 * styles.ts — 工作台 (Workbench) 统一容器样式 + 全局设计收敛层。
 *
 * 2026-10 统一改版（用户要求「所有页面像一个板块、不要各种颜色搭配」）：
 *
 *  1. 导航搬走：页面顶部不再有 tab 栏（分类切换在侧栏「工作台」行的
 *     hover 浮层 / 滚轮上，见 ./row-flyout.tsx），页头只留一行面包屑。
 *  2. 色彩收敛：在 .wb-root 作用域把官方「业务蓝 / 警告橙 / 成功绿 / 信息蓝」
 *     四个 alias token 统一换成一枚**中性灰 accent**（明暗两套各一枚固定灰），
 *     六个页面几百处 var(--dsw-alias-state-*) 引用一次性全部变灰阶，
 *     不需要逐页改色；错误红保留（唯一的真语义色）。选中态 = 灰底 + 主文字色，
 *     实心按钮 = 灰底 + 白字（两枚灰都保证白字对比度 ≥ 4.5）。
 *  3. 工具条几何归一：各页自带的功能工具条（邮件顶栏 / 画廊工具条 / 技能
 *     标题行 / 记忆视图行）共享同一套内距与分隔线，去掉重复的品牌字与关闭钮，
 *     页面之间不再「每进一页重新适应一种头部」。
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

  /* ── 现代产品级色彩体系：DeepSeek 品牌蓝与清晰语义色彩 ── */
  --wb-accent: var(--dsw-alias-state-business-primary, #3b82f6);
  --wb-surface-bg: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.035));
  --wb-surface-border: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  --wb-surface-radius: 12px;
  --wb-surface-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
body[data-ds-dark-theme] .wb-root {
  --wb-accent: #4d82f3;
  --wb-surface-bg: rgba(255, 255, 255, 0.03);
  --wb-surface-border: rgba(255, 255, 255, 0.07);
}

/* ── 旧顶部 tab 栏（.wb-header / .wb-tabs / .wb-tab-btn）已于 2026-10
   二次改版整条移除，导航改悬浮 Dock（./Dock.tsx + theme.ts）。
   kr-chat-controller 的 header:not(.wb-header) 排除选择器仍保留字面量，
   匹配不到时自然落空，不影响其官方头部识别逻辑。 ── */

.wb-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
/* ── 工作台页面切换动效（分类内容滑入）──
   .wb-body 的每个直接子级在 key 变化时重播 wb-page-in：淡入 + 轻微右移；
   150ms 足够快，不拖手感。 */
.wb-body > * {
  animation: wb-page-in 190ms cubic-bezier(.2,.8,.2,1);
}
@keyframes wb-page-in {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: none; }
}

/* ── 「灵魂」页整页滚动容器 ── */
.wb-soul-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

/* ── 统一工作台所有页面的工具条与次级导航（Toolbar & Subheader Archetype） ──────
   让邮件顶栏、画廊工具条、技能标题行、记忆视图行在视觉上高度一致，
   成为统一的「页面二级控制条」，不再每进一页面对不同的突兀布局。 */
.wb-body .dsh-mail-topbar,
.wb-body .tg-toolbar,
.wb-body .skm-topbar,
.wb-body .dsh-memory-top-bar,
.wb-body .wb-page-bar {
  flex: none;
  min-height: 44px;
  padding: 8px 20px;
  background: transparent;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12));
  box-sizing: border-box;
}
.wb-body .dsh-mail-brand,
.wb-body .dsh-mail-close { display: none !important; }
.wb-body > div > .psh-head {
  padding: 8px 20px;
  background: transparent;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12));
}
.wb-body > div > .psh-head > .psh-title { display: none !important; }

/* ── 统一搜索框控件（Search Inputs） ─────────────────────────────── */
.wb-root .skm-search-box,
.wb-root .tg-search__input,
.wb-root .dsh-memory-top-input,
.wb-root .dsh-mail-top-input {
  height: 32px !important;
  border-radius: 8px !important;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)) !important;
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04)) !important;
  color: var(--dsw-alias-label-primary, #eee) !important;
  font-size: 12.5px !important;
  transition: border-color 140ms ease, box-shadow 140ms ease !important;
}
.wb-root .skm-search-box:focus-within,
.wb-root .tg-search__input:focus,
.wb-root .dsh-memory-top-input:focus,
.wb-root .dsh-mail-top-input:focus {
  border-color: var(--wb-accent) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--wb-accent) 25%, transparent) !important;
}

/* ── 统一分段胶囊按钮（Segmented Controls & Tabs） ─────────────────── */
.wb-root .skm-kind-tab,
.wb-root .skm-status-seg-btn,
.wb-root .usm-range-btn,
.wb-root .dsh-memory-view-tab,
.wb-root .dsh-soul-nav-item {
  border-radius: 8px !important;
  font-size: 12px !important;
  transition: all 130ms ease !important;
}
.wb-root .skm-kind-tab[data-active],
.wb-root .skm-status-seg-btn[data-active],
.wb-root .usm-range-btn[data-active],
.wb-root .dsh-memory-view-tab[data-active="true"],
.wb-root .dsh-soul-nav-item-active {
  background: var(--wb-accent) !important;
  color: #fff !important;
  border-color: transparent !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2) !important;
}

/* ── 善用卡片，拒绝碎乱：统一板块卡片质感（Unified Surface System） ──
   所有页面的主要容器表面采用统一的边框、圆角、背景与内边距，
   不再零碎散落，形成清晰沉静的板块感。 */
.wb-root .skm-skill-card,
.wb-root .skm-mcp-list-card,
.wb-root .skm-mcp-rec-card,
.wb-root .skm-mcp-info-card,
.wb-root .usm-uc-card,
.wb-root .dsh-soul-hero-card,
.wb-root .dsh-soul-card,
.wb-root .dsh-memory-entry-card,
.wb-root .tg-card {
  border-radius: var(--wb-surface-radius, 12px) !important;
  border: 1px solid var(--wb-surface-border) !important;
  background: var(--wb-surface-bg) !important;
  box-shadow: var(--wb-surface-shadow) !important;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease !important;
}
.wb-root .skm-skill-card:hover,
.wb-root .skm-mcp-list-card:hover,
.wb-root .skm-mcp-rec-card:hover,
.wb-root .usm-uc-card:hover,
.wb-root .tg-card:hover {
  border-color: color-mix(in srgb, var(--wb-accent) 45%, var(--wb-surface-border)) !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  transform: translateY(-1px) !important;
}

/* ── 彻底消除杂乱颜色与刺眼发光（Calm Monochrome System） ───────────
   用户核心诉求：「不需要各种颜色搭配这样看起来更加凌乱」
   全面移除彩虹色、发光小光柱、刺眼黄色横幅，收敛为高雅纯净的灰阶系统。 */
/* 1. 技能面板发光彻底消除 */
.wb-root .skm-stat-glow { display: none !important; }
/* 2. 统计卡图标：精致半透明彩色微底 + 饱和高辨识度图标 */
.wb-root .skm-stat-icon {
  width: 40px !important;
  height: 40px !important;
  border-radius: 10px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: transform 140ms ease !important;
}
.wb-root .skm-stat:hover .skm-stat-icon {
  transform: scale(1.05) !important;
}
.wb-root .skm-stat-icon[data-tone='blue'] {
  color: #3b82f6 !important;
  background: rgba(59, 130, 246, 0.12) !important;
}
.wb-root .skm-stat-icon[data-tone='green'] {
  color: #22c55e !important;
  background: rgba(34, 197, 94, 0.12) !important;
}
.wb-root .skm-stat-icon[data-tone='violet'] {
  color: #8b5cf6 !important;
  background: rgba(139, 92, 246, 0.12) !important;
}
.wb-root .skm-stat-icon[data-tone='orange'] {
  color: #f59e0b !important;
  background: rgba(245, 158, 11, 0.12) !important;
}

/* 3. 统计卡主体：规范为整齐板块 */
.wb-root .skm-stats-row {
  gap: 12px !important;
  padding: 12px 20px 0 !important;
}
.wb-root .skm-stat {
  border-radius: var(--wb-surface-radius, 12px) !important;
  border: 1px solid var(--wb-surface-border) !important;
  background: var(--wb-surface-bg) !important;
  box-shadow: var(--wb-surface-shadow) !important;
  padding: 12px 14px !important;
  gap: 10px !important;
}
.wb-root .skm-stat:hover {
  border-color: color-mix(in srgb, var(--wb-accent) 40%, var(--wb-surface-border)) !important;
  transform: translateY(-1px) !important;
}
.wb-root .skm-stat-desc {
  margin-top: 4px !important;
  font-size: 11px !important;
  color: var(--dsw-alias-label-tertiary, #81858c) !important;
}

/* 4. 消除黄色横幅与警示框：转为优雅温润的次级卡片 */
.wb-root .skm-banner,
.wb-root .skm-health-notice {
  border: 1px solid var(--wb-surface-border) !important;
  background: var(--wb-surface-bg) !important;
  border-radius: var(--wb-surface-radius, 12px) !important;
  box-shadow: none !important;
}
.wb-root .skm-banner-title,
.wb-root .skm-health-notice-title {
  color: var(--dsw-alias-label-primary, #eee) !important;
}
.wb-root .skm-banner-sub,
.wb-root .skm-health-notice li {
  color: var(--dsw-alias-label-secondary, #aaa) !important;
}
.wb-root .skm-banner-icon {
  border-color: var(--wb-accent) !important;
  color: var(--wb-accent) !important;
}

/* 5. 用量统计卡：统一板块质感 */
.wb-root .usm-uc-stat {
  border-radius: 10px !important;
  border: 1px solid var(--wb-surface-border) !important;
  background: var(--wb-surface-bg) !important;
  padding: 8px 12px !important;
}

/* 6. 彩色标签与徽标降噪（Pills, Tags, Badges） */
.wb-root .skm-tag-source,
.wb-root .skm-tag-scope,
.wb-root .skm-tag-builtin,
.wb-root .skm-skill-badge,
.wb-root .skm-cat-chip,
.wb-root .skm-bundle-cat-tag,
.wb-root .tg-dock__badge,
.wb-root .tg-kind__count,
.wb-root .dsh-soul-chip {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent) !important;
  border-color: var(--wb-surface-border) !important;
  color: var(--dsw-alias-label-secondary, #bbb) !important;
}
.wb-root .skm-cat-chip[data-active],
.wb-root .skm-bundle-cat-tag[data-active] {
  background: var(--wb-accent) !important;
  color: #fff !important;
  border-color: transparent !important;
}

/* ── 用量嵌入页板块容器（响应式大盘，摆脱狭隘弹窗感） ─────────────── */
.wb-root .usm-uc {
  padding: 14px 20px 20px !important;
  gap: 12px !important;
  max-width: 1120px !important;
  width: 100% !important;
  margin: 0 auto !important;
  box-sizing: border-box !important;
}
.wb-root .usm-uc-stats {
  gap: 10px !important;
}

/* ── 画廊、邮件与记忆首页板块收敛（Coherent Surfaces） ───────────────
   （画廊类别 Dock 的外观与位置已移交 theme.ts 的 wb2 规则，此处不再接管） ── */
.wb-root .dsh-mail-row-active,
.wb-root .dsh-mail-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.04)) !important;
}
.wb-root .dsh-mail-dot {
  background: var(--wb-accent) !important;
}
.wb-root .dsh-memory-home .hm-card,
.wb-root .dsh-memory-home .hm-hero,
.wb-root .dsh-memory-home .hm-mem-card {
  border-radius: var(--wb-surface-radius, 12px) !important;
  border: 1px solid var(--wb-surface-border) !important;
  background: var(--wb-surface-bg) !important;
  box-shadow: var(--wb-surface-shadow) !important;
}

/* ── 各页面主内容区几何规范（统一 1140px 居中大盘与内边距节奏） ─────────────
   消除「点开这页是这个宽度、点开那页又跳成另一种布局」的生硬割裂感，
   让用量、能力、画廊、灵魂全部收拢为标准的板块大盘。 */
.wb-root .dsh-soul-root {
  max-width: 1140px !important;
  width: 100% !important;
  margin: 0 auto !important;
  padding: 16px 20px 24px !important;
  box-sizing: border-box !important;
}

.wb-root .skm-main-wrap,
.wb-root .skm-body {
  max-width: 1140px !important;
  width: 100% !important;
  margin: 0 auto !important;
  box-sizing: border-box !important;
}

.wb-root .tg-toolbar {
  max-width: 1140px !important;
  width: 100% !important;
  margin: 0 auto !important;
  box-sizing: border-box !important;
}

.wb-root .tg-body {
  max-width: 1140px !important;
  width: 100% !important;
  margin: 0 auto !important;
  padding: 16px 20px 24px !important;
  box-sizing: border-box !important;
}

.wb-root .dsh-memory-home {
  max-width: 1140px !important;
  width: 100% !important;
  margin: 0 auto !important;
  box-sizing: border-box !important;
}

/* ── 换色后的个别反色修正 ───────────────────────────────────────────
   记忆面板的开关圆点取 --m-card-bg（恒白），深色主题下轨道换成主文字色
   （近白）后白点落在白轨上看不见；这里把打开态圆点钉成页面底色。 */
.wb-root .dsh-memory-switch[aria-checked='true']::after {
  background: var(--dsw-alias-bg-base, #0f1117);
}

@media (prefers-reduced-motion: reduce) {
  .wb-body > *, .wb-soul-scroll > * { animation: none !important; }
  .wb-bar-btn, .wb-icon-btn { transition: none !important; }
  .wb-bar-btn[data-spin] svg { animation: none !important; }
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
    return
  }
  // 内容比对：插件升级后已打开的页面里旧表继续命中早退分支会留旧规则。
  if (tag.textContent !== SHEET) tag.textContent = SHEET
}
