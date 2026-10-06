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

  /* ── 中性灰 accent：整棵工作台子树的强调色统一换色 ──
     浅色 #3f444c / 深色 #5a6069：两枚都满足「白字 ≥4.5:1」与
     「灰底上主文字色图标可见」，所以子页面里所有「蓝底白字 / 蓝字 /
     蓝描边」的旧写法换色后在两套主题下都自动成立，无需逐处反色。 */
  --wb-accent: #3f444c;
  --dsw-alias-state-business-primary: var(--wb-accent);
  --dsw-alias-button-info-hover: color-mix(in srgb, var(--wb-accent) 84%, #000);
  --dsw-alias-state-warn-primary: var(--wb-accent);
  --dsw-alias-state-success-primary: var(--wb-accent);
  --dsw-alias-state-info-primary: var(--wb-accent);
}
body[data-ds-dark-theme] .wb-root { --wb-accent: #5a6069; }

.wb-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 46px;
  padding: 0 18px;
  background: transparent;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  z-index: 10;
}

/* ── 面包屑页头：工作台 / 分类（分类导航在侧栏行上，页内不放切换器） ── */
.wb-crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  user-select: none;
}
.wb-crumb-root {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  letter-spacing: -0.01em;
}
.wb-crumb-sep {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #7c828c);
}
.wb-crumb-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-primary, #eee);
}
.wb-crumb-current {
  flex: none;
  font-size: 13.5px;
  font-weight: 650;
  color: var(--dsw-alias-label-primary, #eee);
  letter-spacing: -0.01em;
}
.wb-crumb-desc {
  min-width: 0;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary, #7c828c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ── 「灵魂」页整页滚动容器（面板根自带内距，这里只滚动不叠 padding） ── */
.wb-soul-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

/* ── 页内功能工具条几何归一 ─────────────────────────────────────────
   各页自带的功能条（邮件：地址/搜索/写信；画廊：搜索/筛选/视图；
   技能：SKILL-MCP 切换；记忆：视图分段+统计）共享同一套内距与分隔线，
   并去掉与面包屑重复的品牌字 / 标题 / 关闭钮——功能一个不少，
   但六个页面的「第二行」看起来是同一件事。 */
.wb-body .dsh-mail-topbar,
.wb-body .tg-toolbar {
  padding: 8px 18px;
  background: transparent;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14));
}
.wb-body .dsh-mail-brand,
.wb-body .dsh-mail-close { display: none; }
.wb-body > div > .psh-head {
  padding: 8px 18px;
  background: transparent;
}
.wb-body > div > .psh-head > .psh-title { display: none; }
.wb-body .dsh-memory-top-bar {
  padding: 8px 18px;
  background: transparent;
}
/* 用量嵌入页的工具行（刷新钮右对齐） */
.wb-page-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 0 0;
}
.wb-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
  background: transparent;
  color: var(--dsw-alias-label-secondary, #aaa);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, transform 120ms ease;
}
.wb-bar-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-primary, #eee);
  transform: translateY(-1px);
}
.wb-bar-btn:active { transform: translateY(0) scale(.97); }
.wb-bar-btn[data-spin] svg { animation: wb-spin 900ms linear infinite; }
@keyframes wb-spin { to { transform: rotate(360deg); } }

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
