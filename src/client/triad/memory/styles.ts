/**
 * dsh-memory — 样式（运行时注入 <style>，卸载时由 loader 清理）。
 * 类名前缀 dsh-memory-；三栏应用布局（按参考设计图复刻，浅色系）：
 *
 *   ┌────────┬─────────────────────────────────────────────┐
 *   │ 左栏    │ 顶栏：搜索框 · 统计 · 关闭                     │
 *   │ 导航    ├─────────────────────────────────────────────┤
 *   │ 项目    │ 筛选行：项目 / 分类 / 排序 pills + 工具动作     │
 *   │ 分类    ├──────────────┬──────────────────────────────┤
 *   │ 设置    │ 中栏列表      │ 右栏详情                       │
 *   └────────┴──────────────┴──────────────────────────────┘
 *
 * 面板自身是固定浅色皮肤（独立应用窗口心智）：在 .dsh-memory-panel 作用域覆写
 * 常用 --dsw-alias-* 变量，子树内的原生控件与 primitives 自动变浅；显式颜色
 * 一律走 --m-* 变量（本文件顶部定义），保证只影响本面板、不污染 DSH 全局。
 */

export const css = {
  modalBody: 'dsh-memory-modal-body',
  panel: 'dsh-memory-panel',
  // ── 顶部两级工具筛选栏 ──
  topBar: 'dsh-memory-top-bar',
  viewRow: 'dsh-memory-view-row',
  viewTabs: 'dsh-memory-view-tabs',
  viewTab: 'dsh-memory-view-tab',
  viewActions: 'dsh-memory-view-actions',
  primaryAdd: 'dsh-memory-primary-add',
  subfilterRow: 'dsh-memory-subfilter-row',
  subfilterSearch: 'dsh-memory-subfilter-search',
  subfilterGroup: 'dsh-memory-subfilter-group',
  subfilterLabel: 'dsh-memory-subfilter-label',
  subfilterSelect: 'dsh-memory-subfilter-select',
  pills: 'dsh-memory-pills',
  pill: 'dsh-memory-pill',
  // ── 左栏 ──
  sidebar: 'dsh-memory-sidebar',
  sidebarBrand: 'dsh-memory-sidebar-brand',
  sidebarLogo: 'dsh-memory-sidebar-logo',
  sidebarTitle: 'dsh-memory-sidebar-title',
  sidebarAdd: 'dsh-memory-sidebar-add',
  navList: 'dsh-memory-nav-list',
  navItem: 'dsh-memory-nav-item',
  navItemActive: 'dsh-memory-nav-item-active',
  navIcon: 'dsh-memory-nav-icon',
  navCount: 'dsh-memory-nav-count',
  navCountZero: 'dsh-memory-nav-count-zero',
  navCountPop: 'dsh-memory-nav-count-pop',
  navChevron: 'dsh-memory-nav-chevron',
  navCountInline: 'dsh-memory-nav-count-inline',
  navSep: 'dsh-memory-nav-sep',
  sectionHeader: 'dsh-memory-section-header',
  sectionTitleTxt: 'dsh-memory-section-title',
  sectionPlus: 'dsh-memory-section-plus',
  projList: 'dsh-memory-proj-list',
  projRow: 'dsh-memory-proj-row',
  projRowActive: 'dsh-memory-proj-row-active',
  catList: 'dsh-memory-cat-list',
  catRow: 'dsh-memory-cat-row',
  catRowActive: 'dsh-memory-cat-row-active',
  catDot: 'dsh-memory-cat-dot',
  catMore: 'dsh-memory-cat-more',
  sidebarFoot: 'dsh-memory-sidebar-foot',
  settingsNav: 'dsh-memory-settings-nav',
  settingsNavActive: 'dsh-memory-settings-nav-active',
  // ── 顶栏 ──
  topbar: 'dsh-memory-topbar',
  topSearch: 'dsh-memory-top-search',
  topSearchIcon: 'dsh-memory-top-search-icon',
  topInput: 'dsh-memory-top-input',
  topKbd: 'dsh-memory-top-kbd',
  topStats: 'dsh-memory-top-stats',
  topStat: 'dsh-memory-top-stat',
  topStatVal: 'dsh-memory-top-stat-val',
  topStatIcon: 'dsh-memory-top-stat-icon',
  topStatSep: 'dsh-memory-top-stat-sep',
  topClose: 'dsh-memory-top-close',
  // ── 筛选行 ──
  filterRow: 'dsh-memory-filter-row',
  filterSelect: 'dsh-memory-filter-select',
  filterTools: 'dsh-memory-filter-tools',
  toolBtn: 'dsh-memory-tool-btn',
  toolBtnIcon: 'dsh-memory-tool-btn-icon',
  toolBtnDanger: 'dsh-memory-tool-btn-danger',
  projContext: 'dsh-memory-proj-context',
  projName: 'dsh-memory-proj-name',
  // ── 主区 ──
  mainCol: 'dsh-memory-main-col',
  cols: 'dsh-memory-cols',
  listCol: 'dsh-memory-list-col',
  detailCol: 'dsh-memory-detail-col',
  viewFull: 'dsh-memory-view-full',
  // ── 中栏列表 ──
  listHead: 'dsh-memory-list-head',
  listHeadText: 'dsh-memory-list-head-text',
  listSort: 'dsh-memory-list-sort',
  groupSection: 'dsh-memory-group-section',
  groupSectionCount: 'dsh-memory-group-section-count',
  entryCard: 'dsh-memory-entry-card',
  entryCardSel: 'dsh-memory-entry-card-sel',
  entryTop: 'dsh-memory-entry-top',
  entryIcon: 'dsh-memory-entry-icon',
  entryTitleTxt: 'dsh-memory-entry-title',
  entryChip: 'dsh-memory-entry-chip',
  entryCheck: 'dsh-memory-entry-check',
  entryCheckOn: 'dsh-memory-entry-check-on',
  entrySnippet: 'dsh-memory-entry-snippet',
  entryFootRow: 'dsh-memory-entry-foot',
  entryTime: 'dsh-memory-entry-time',
  entryDot: 'dsh-memory-entry-dot',
  entryRow: 'dsh-memory-entry-row',
  entryRowSel: 'dsh-memory-entry-row-sel',
  entryRowIcon: 'dsh-memory-entry-row-icon',
  // ── 右栏详情 ──
  detailHead: 'dsh-memory-detail-head',
  detailTitle: 'dsh-memory-detail-title',
  detailAnim: 'dsh-memory-detail-anim',
  chips: 'dsh-memory-chips',
  chipMute: 'dsh-memory-chip-mute',
  chipAccent: 'dsh-memory-chip-accent',
  chipWarn: 'dsh-memory-chip-warn',
  chipOk: 'dsh-memory-chip-ok',
  chipTime: 'dsh-memory-chip-time',
  importanceRow: 'dsh-memory-importance-row',
  importanceIcon: 'dsh-memory-importance-icon',
  importanceLabel: 'dsh-memory-importance-label',
  importanceBar: 'dsh-memory-importance-bar',
  importanceValue: 'dsh-memory-importance-value',
  detailBody: 'dsh-memory-detail-body',
  detailTags: 'dsh-memory-detail-tags',
  detailFoot: 'dsh-memory-detail-foot',
  sectionTitle: 'dsh-memory-section-title-lg',
  sectionLine: 'dsh-memory-section-line',
  relationGrid: 'dsh-memory-relation-grid',
  relationCard: 'dsh-memory-relation-card',
  relationLabel: 'dsh-memory-relation-label',
  relationMain: 'dsh-memory-relation-main',
  relationSub: 'dsh-memory-relation-sub',
  historyList: 'dsh-memory-history-list',
  historyRow: 'dsh-memory-history-row',
  historyTime: 'dsh-memory-history-time',
  historyDesc: 'dsh-memory-history-desc',
  historyLink: 'dsh-memory-history-link',
  relatedGrid: 'dsh-memory-related-grid',
  relatedCard: 'dsh-memory-related-card',
  relatedTitleTxt: 'dsh-memory-related-title',
  relatedSub: 'dsh-memory-related-sub',
  relatedArrow: 'dsh-memory-related-arrow',
  // ── 通用 ──
  searchRow: 'dsh-memory-search-row',
  searchBox: 'dsh-memory-search-box',
  searchIcon: 'dsh-memory-search-icon',
  searchInput: 'dsh-memory-search-input',
  searchClear: 'dsh-memory-search-clear',
  tagSelect: 'dsh-memory-tag-select',
  scopeSelect: 'dsh-memory-scope-select',
  barSep: 'dsh-memory-bar-sep',
  segment: 'dsh-memory-segment',
  segmentItem: 'dsh-memory-segment-item',
  segmentItemActive: 'dsh-memory-segment-item-active',
  spacer: 'dsh-memory-spacer',
  cardList: 'dsh-memory-card-list',
  cardContent: 'dsh-memory-card-content',
  cardMeta: 'dsh-memory-card-meta',
  chip: 'dsh-memory-chip',
  chipActive: 'dsh-memory-chip-active',
  cardActions: 'dsh-memory-card-actions',
  iconAction: 'dsh-memory-icon-action',
  iconActionDanger: 'dsh-memory-icon-action-danger',
  iconActionBusy: 'dsh-memory-icon-action-busy',
  pinMark: 'dsh-memory-pin-mark',
  empty: 'dsh-memory-empty',
  emptyIcon: 'dsh-memory-empty-icon',
  emptyText: 'dsh-memory-empty-text',
  emptyHint: 'dsh-memory-empty-hint',
  changeRow: 'dsh-memory-change-row',
  changeMore: 'dsh-memory-change-more',
  changeMain: 'dsh-memory-change-main',
  changeBadge: 'dsh-memory-change-badge',
  changeBadgeAdd: 'dsh-memory-change-badge-add',
  changeBadgeDelete: 'dsh-memory-change-badge-delete',
  changeBadgePromote: 'dsh-memory-change-badge-promote',
  changeBadgeRevise: 'dsh-memory-change-badge-revise',
  changeBadgeRetire: 'dsh-memory-change-badge-retire',
  changeOld: 'dsh-memory-change-old',
  changeNew: 'dsh-memory-change-new',
  changeDiff: 'dsh-memory-change-diff',
  changeDiffCol: 'dsh-memory-change-diff-col',
  changeDiffDivider: 'dsh-memory-change-diff-divider',
  stat: 'dsh-memory-stat',
  statValue: 'dsh-memory-stat-value',
  statDot: 'dsh-memory-stat-dot',
  inlineInput: 'dsh-memory-inline-input',
  inlineTextarea: 'dsh-memory-inline-textarea',
  editButtons: 'dsh-memory-edit-buttons',
  addMeta: 'dsh-memory-add-meta',
  check: 'dsh-memory-check',
  switch: 'dsh-memory-switch',
  switchText: 'dsh-memory-switch-text',
  switchLine: 'dsh-memory-switch-line',
  batchCount: 'dsh-memory-batch-count',
  error: 'dsh-memory-error',
  notice: 'dsh-memory-notice',
  detailForm: 'dsh-memory-detail-form',
  formTitle: 'dsh-memory-form-title',
  field: 'dsh-memory-field',
  fieldLabel: 'dsh-memory-field-label',
  fieldRow: 'dsh-memory-field-row',
  revActions: 'dsh-memory-rev-actions',
  disabledMark: 'dsh-memory-disabled-mark',
  retiredMark: 'dsh-memory-retired-mark',
  scopeBadge: 'dsh-memory-scope-badge',
  settingsBody: 'dsh-memory-settings-body',
  settingsGroup: 'dsh-memory-settings-group',
  settingsGroupTitle: 'dsh-memory-settings-group-title',
  settingsRow: 'dsh-memory-settings-row',
  settingsMain: 'dsh-memory-settings-main',
  settingsLabel: 'dsh-memory-settings-label',
  settingsHint: 'dsh-memory-settings-hint',
  settingsControl: 'dsh-memory-settings-control',
  numberInput: 'dsh-memory-number-input',
  settingsFoot: 'dsh-memory-settings-foot',
  skeleton: 'dsh-memory-skeleton',
  skeletonRow: 'dsh-memory-skeleton-row',
  toggle: 'dsh-memory-toggle',
  toggleOn: 'dsh-memory-toggle-on',
  toggleOff: 'dsh-memory-toggle-off',
  toggleWrap: 'dsh-memory-toggle-wrap',
  // ── 对话框注入开关的悬浮卡片 ──
  injectCard: 'dsh-memory-inject-card',
  injectCardOn: 'dsh-memory-inject-card-on',
  injectHead: 'dsh-memory-inject-head',
  injectTitle: 'dsh-memory-inject-title',
  injectTag: 'dsh-memory-inject-tag',
  injectTagOn: 'dsh-memory-inject-tag-on',
  injectTagOff: 'dsh-memory-inject-tag-off',
  builtinCard: 'dsh-memory-builtin-card',
  injectRow: 'dsh-memory-inject-row',
  injectRowLead: 'dsh-memory-inject-row-lead',
  injectMain: 'dsh-memory-inject-main',
  injectLabel: 'dsh-memory-inject-label',
  injectHint: 'dsh-memory-inject-hint',
  injectBadge: 'dsh-memory-inject-badge',
  injectFollow: 'dsh-memory-inject-follow',
  injectFoot: 'dsh-memory-inject-foot',
  injectRowOn: 'dsh-memory-inject-row-on',
  injectGroup: 'dsh-memory-inject-group',
  injectGroupTitle: 'dsh-memory-inject-group-title',
  injectGroupHint: 'dsh-memory-inject-group-hint',
} as const

const STYLE_ID = 'dsh-memory-styles'

const SHEET = `
/* ── 主题变量（跟随 DSH 明/暗主题；accent 恒为主题蓝） ────────────────
   所有 --m-* 派生自 DSH 主题 token（--dsw-alias-*），明暗主题切换时
   面板自动跟进：浅色=白底，高亮/蓝字；深色=暗底，亮字。数据色板图标
   （分类圆点/项目文件夹/kind 图标色）不随主题变。 */
.dsh-memory-panel{
  --m-primary:var(--dsw-alias-state-business-primary);
  --m-primary-hover:var(--dsw-alias-button-info-hover);
  --m-primary-soft:color-mix(in srgb,var(--m-primary) 14%,transparent);
  --m-primary-chip:color-mix(in srgb,var(--m-primary) 12%,transparent);
  --m-primary-bar:var(--dsw-alias-state-business-primary);
  --m-accent-line:color-mix(in srgb,var(--m-primary) 55%,transparent);
  --m-card-bg-sel:color-mix(in srgb,var(--m-primary) 7%,var(--dsw-alias-bg-layer-1,#fff));
  --m-card-line:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --m-text:var(--dsw-alias-label-primary,#eee);
  --m-text-2:var(--dsw-alias-label-secondary,#bbb);
  --m-text-3:var(--dsw-alias-label-tertiary,#888);
  --m-border:var(--dsw-alias-border-l1,rgba(255,255,255,.08));
  --m-border-2:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --m-side:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));
  --m-side-line:var(--dsw-alias-border-l1,rgba(255,255,255,.08));
  --m-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  --m-soft:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));
  --m-ok:var(--dsw-alias-state-success-primary,#3aa675);
  --m-warn:var(--dsw-alias-state-warn-primary,#e8a33d);
  --m-err:var(--dsw-alias-state-error-primary,#e0434b);
  --m-ok-bg:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3aa675) 12%,transparent);
  --m-warn-bg:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 12%,transparent);
  --m-err-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 12%,transparent);
  --m-info:var(--dsw-alias-state-info-primary,#5b9dff);
  --m-info-bg:color-mix(in srgb,var(--dsw-alias-state-info-primary,#5b9dff) 12%,transparent);
  /* 计数徽章底色（中性灰，明暗主题都成立） */
  --m-count-bg:color-mix(in srgb,var(--m-text-3) 17%,transparent);
  --m-count-bg-hover:color-mix(in srgb,var(--m-text-3) 28%,transparent);
  background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--m-text);
}

/* ── 面板骨架 ─────────────────────────────────────────────────────── */
.dsh-memory-modal-body{overflow:hidden;display:flex;flex-direction:column}
.dsh-memory-panel{flex:1;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:0;overflow:hidden;padding:0;box-sizing:border-box}

/* ── 左侧栏：品牌 / 添加 / 导航 / 项目 / 分类 / 设置竖排 ───────── */
.dsh-memory-sidebar{flex:none;width:216px;align-self:stretch;box-sizing:border-box;display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:2px;overflow-y:auto;overflow-x:hidden;padding:14px 12px;background:var(--m-side);border-right:1px solid var(--m-side-line);border-bottom:none}
.dsh-memory-sidebar-brand{display:flex;align-items:center;gap:8px;padding:0 4px;margin-bottom:10px}
.dsh-memory-sidebar-logo{flex:none;width:26px;height:26px;border-radius:8px;background:var(--m-primary);display:inline-flex;align-items:center;justify-content:center;color:#fff}
.dsh-memory-sidebar-title{font-size:16px;font-weight:700;line-height:24px;color:var(--m-text)}
.dsh-memory-sidebar-add{width:100%;height:34px;padding:0 14px;margin-bottom:10px;border:none;border-radius:10px;background:var(--m-primary);color:#fff;font-size:13px;font-weight:600;line-height:20px;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1),box-shadow .16s ease,transform .12s ease}
.dsh-memory-sidebar-add:hover{background:var(--m-primary-hover);box-shadow:0 4px 14px color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent)}
.dsh-memory-sidebar-add:active{transform:scale(.985)}
.dsh-memory-sidebar-add:disabled{opacity:.5;cursor:default}
/* 一级：视图 tabs 收进分段控件底座，跟下面的胶囊拉开层级 */
.dsh-memory-nav-list{display:flex;flex-direction:column;flex-wrap:nowrap;gap:2px;background:transparent;border:none;border-radius:0;padding:0}
.dsh-memory-nav-item{display:flex;align-items:center;gap:8px;width:100%;flex:none;box-sizing:border-box;height:30px;border-radius:8px;padding:0 10px;border:none;border-radius:8px;background:transparent;color:var(--m-text-2);font-family:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:background .15s cubic-bezier(.2,.8,.2,1),color .15s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-nav-item:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);color:var(--m-text)}
.dsh-memory-nav-item-active,.dsh-memory-nav-item-active:hover{background:var(--m-primary-soft);color:var(--m-primary);font-weight:600}
.dsh-memory-nav-icon{flex:none;display:inline-flex;align-items:center;color:inherit}
/* 计数徽章：取代「标签 + 裸数字」（旧样式在 4 位数时把整条导航撑得很难看）。
   小胶囊 + 紧凑记数（4407 → 4.4k，悬停看精确值）+ 选中态实心 + 数值变化弹一下。 */
.dsh-memory-nav-count{margin-left:auto;flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;box-sizing:border-box;padding:0 6px;border-radius:999px;background:var(--m-count-bg);color:var(--m-text-3);font-size:11px;font-weight:600;line-height:18px;letter-spacing:.2px;font-variant-numeric:tabular-nums;transition:background .18s cubic-bezier(.2,.8,.2,1),color .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease}
.dsh-memory-nav-count-zero{min-width:16px;padding:0 4px;background:transparent;color:var(--m-text-3);opacity:.55;font-weight:500}
.dsh-memory-nav-item:hover .dsh-memory-nav-count,.dsh-memory-proj-row:hover .dsh-memory-nav-count,.dsh-memory-cat-row:hover .dsh-memory-nav-count{background:var(--m-count-bg-hover);color:var(--m-text-2)}
.dsh-memory-nav-item-active .dsh-memory-nav-count,.dsh-memory-proj-row-active .dsh-memory-nav-count,.dsh-memory-cat-row-active .dsh-memory-nav-count{background:var(--m-primary);color:#fff;box-shadow:0 2px 8px color-mix(in srgb,var(--dsw-alias-state-business-primary) 32%,transparent)}
.dsh-memory-nav-item-active:hover .dsh-memory-nav-count,.dsh-memory-proj-row-active:hover .dsh-memory-nav-count,.dsh-memory-cat-row-active:hover .dsh-memory-nav-count{background:var(--m-primary-hover);color:#fff}
.dsh-memory-nav-count-pop{animation:dsh-memory-count-pop .3s cubic-bezier(.2,.8,.2,1)}
@keyframes dsh-memory-count-pop{0%{transform:scale(.72);opacity:.25}55%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}
/* 行内用法（详情区小节标题）：不顶到行尾 */
.dsh-memory-nav-count-inline{margin-left:0}
/* 「更多分类」的展开箭头不是计数，别套胶囊 */
.dsh-memory-nav-chevron{margin-left:auto;flex:none;color:var(--m-text-3);font-size:11px;line-height:18px}
@media (prefers-reduced-motion:reduce){.dsh-memory-nav-count-pop{animation:none}}
.dsh-memory-nav-sep{display:block;flex:none;height:1px;background:var(--m-side-line);margin:10px 4px}
.dsh-memory-section-header{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 4px}
.dsh-memory-section-title{font-size:13px;font-weight:500;line-height:20px;color:var(--m-text-2)}
.dsh-memory-section-plus{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--m-text-3);cursor:pointer;transition:background .14s ease,color .14s ease}
.dsh-memory-section-plus:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent);color:var(--m-primary)}
/* 二级布局：导航行占满首行，项目 / 分类各起新行；胶囊更小更轻 */
.dsh-memory-proj-list{display:flex;flex-direction:column;flex-wrap:nowrap;gap:2px;flex:none;order:0;margin-top:0}
.dsh-memory-proj-row{display:flex;align-items:center;gap:6px;width:100%;flex:none;box-sizing:border-box;height:28px;font-size:12px;border:1px solid var(--m-border);border-radius:999px;padding:0 10px 0 8px;padding:0 8px 0 6px;border:none;border-radius:7px;background:transparent;color:var(--m-text-2);font-family:inherit;font-size:12.5px;line-height:19px;text-align:left;cursor:pointer;transition:background .15s cubic-bezier(.2,.8,.2,1),color .15s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-proj-row:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);color:var(--m-text)}
.dsh-memory-proj-row-active,.dsh-memory-proj-row-active:hover{background:var(--m-primary-soft);color:var(--m-primary);font-weight:600}
.dsh-memory-cat-list{display:flex;flex-direction:column;flex-wrap:nowrap;gap:2px;flex:none;order:0}
.dsh-memory-cat-row{display:flex;align-items:center;gap:6px;width:100%;flex:none;box-sizing:border-box;height:28px;font-size:12px;border:1px solid var(--m-border);border-radius:999px;padding:0 8px 0 8px;border:none;border-radius:6px;background:transparent;color:var(--m-text-2);font-family:inherit;font-size:12.5px;line-height:19px;text-align:left;cursor:pointer;transition:background .15s cubic-bezier(.2,.8,.2,1),color .15s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-cat-row:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);color:var(--m-text)}
.dsh-memory-cat-row-active,.dsh-memory-cat-row-active:hover{background:var(--m-primary-soft);color:var(--m-primary);font-weight:600}
.dsh-memory-cat-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--dot,#5b8def)}
.dsh-memory-cat-more{color:var(--m-text-3)}
.dsh-memory-sidebar-foot{display:flex;margin:auto 0 0;padding:12px 0 0;border-top:1px solid var(--m-side-line);order:0}
.dsh-memory-settings-nav{display:flex;align-items:center;gap:8px;width:100%;flex:none;box-sizing:border-box;height:32px;padding:0 10px;border:none;border-radius:8px;background:transparent;color:var(--m-text-2);font-family:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:background .15s cubic-bezier(.2,.8,.2,1),color .15s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-settings-nav:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);color:var(--m-text)}
.dsh-memory-settings-nav-active,.dsh-memory-settings-nav-active:hover{background:var(--m-primary-soft);color:var(--m-primary);font-weight:600}

/* ── 顶栏：搜索框 + 统计 + 关闭 ───────────────────────────────────── */
.dsh-memory-topbar{flex:none;display:flex;align-items:center;gap:14px;height:52px;padding:0 14px;background:var(--dsw-alias-bg-layer-1,#fff);border-bottom:1px solid var(--m-border)}
.dsh-memory-top-search{position:relative;flex:1;min-width:160px;max-width:430px;display:flex;align-items:center}
.dsh-memory-top-search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);display:inline-flex;color:var(--m-text-3);pointer-events:none}
.dsh-memory-top-input{flex:1;min-width:0;height:34px;box-sizing:border-box;border:1px solid transparent;border-radius:10px;padding:0 66px 0 34px;font-size:13px;line-height:20px;font-family:inherit;color:var(--m-text);background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));transition:border-color .16s ease,background .16s ease,box-shadow .16s ease}
.dsh-memory-top-input::placeholder{color:var(--m-text-3)}
.dsh-memory-top-input:focus,.dsh-memory-top-input:focus-visible{outline:none;border-color:var(--m-primary);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-top-kbd{position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--m-text-3);font-size:11px;line-height:16px}
.dsh-memory-top-stats{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:13px;line-height:20px;color:var(--m-text-2);white-space:nowrap}
.dsh-memory-top-stat{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums}
/* 统计行图标：中性二级字色（2026-10 色彩收敛，去掉内联金星/蓝灯泡） */
.dsh-memory-top-stat-icon{display:inline-flex;align-items:center;color:var(--m-text-2)}
.dsh-memory-top-stat .dsh-memory-top-stat-val{font-weight:600;color:var(--m-text)}
.dsh-memory-top-stat-sep{color:var(--m-text-3);font-size:12px}
.dsh-memory-top-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;color:var(--m-text-3);cursor:pointer;transition:background .14s ease,color .14s ease}
.dsh-memory-top-close:hover{background:var(--m-hover);color:var(--m-text)}

/* ── 筛选行 ───────────────────────────────────────────────────────── */
.dsh-memory-filter-row{flex:none;display:flex;align-items:center;gap:8px;height:54px;padding:0 14px;background:var(--dsw-alias-bg-layer-1,#fff);border-bottom:1px solid var(--m-border)}
.dsh-memory-filter-select{height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:10px;padding:0 30px 0 12px;font-size:13px;line-height:20px;font-family:inherit;color:var(--m-text);background-color:var(--dsw-alias-bg-layer-1,#fff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:12px 12px;appearance:none;cursor:pointer;max-width:230px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-filter-select:hover{border-color:color-mix(in srgb,var(--m-text-3) 55%,transparent)}
.dsh-memory-filter-select:focus,.dsh-memory-filter-select:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-filter-tools{display:flex;align-items:center;gap:6px;margin-left:auto}
.dsh-memory-tool-btn{flex:none;display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--m-text-2);font-size:12.5px;font-weight:500;line-height:19px;font-family:inherit;cursor:pointer;transition:border-color .14s ease,color .14s ease,background .14s ease,transform .12s ease}
.dsh-memory-tool-btn:hover:not(:disabled){border-color:var(--m-primary);color:var(--m-primary);background:var(--m-card-bg-sel)}
.dsh-memory-tool-btn:active:not(:disabled){transform:scale(.97)}
.dsh-memory-tool-btn:disabled{opacity:.45;cursor:default}
.dsh-memory-tool-btn-icon{width:30px;padding:0;justify-content:center}
.dsh-memory-tool-btn-danger:hover:not(:disabled){border-color:var(--m-err);color:var(--m-err);background:var(--m-err-bg)}

/* ── 主区：中栏列表 / 右栏详情 / 全宽视图 ─────────────────────────── */
.dsh-memory-main-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.dsh-memory-cols{flex:1;min-height:0;display:flex;align-items:stretch;box-sizing:border-box}
.dsh-memory-list-col{flex:none;width:420px;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;overflow-y:auto;background:var(--dsw-alias-bg-layer-1,#fff);border-right:1px solid var(--m-border);padding-bottom:16px}
.dsh-memory-detail-col{flex:1;min-width:0;overflow-y:auto;background:var(--dsw-alias-bg-layer-1,#fff)}
.dsh-memory-view-full{flex:1;min-height:0;overflow-y:auto;background:var(--dsw-alias-bg-layer-1,#fff);display:flex;flex-direction:column;box-sizing:border-box;padding-bottom:16px}

/* ── 中栏列表头部 ─────────────────────────────────────────────────── */
.dsh-memory-list-head{flex:none;display:flex;align-items:center;gap:6px;padding:8px 14px 8px 16px;flex-wrap:wrap}
.dsh-memory-list-head-text{font-size:13px;line-height:20px;color:var(--m-text-2);font-variant-numeric:tabular-nums}
.dsh-memory-list-sort{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--m-text-3);cursor:pointer;transition:background .14s ease,color .14s ease,transform .14s ease}
.dsh-memory-list-sort:hover{background:var(--m-hover);color:var(--m-text)}
.dsh-memory-list-sort:active{transform:scale(.92)}
.dsh-memory-proj-context{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 14px 10px 16px;border-bottom:1px solid var(--m-border)}
.dsh-memory-proj-name{display:inline-flex;align-items:center;gap:5px;max-width:100%;font-size:12.5px;font-weight:600;line-height:19px;color:var(--m-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-group-section{display:flex;align-items:center;gap:6px;padding:10px 16px 4px;font-size:13px;font-weight:600;line-height:20px;color:var(--m-text-2);animation:dsh-memory-section-in .24s cubic-bezier(.2,.8,.2,1) both}
.dsh-memory-group-section-count{font-variant-numeric:tabular-nums;font-weight:400;color:var(--m-text-3)}
@keyframes dsh-memory-section-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

/* ── 置顶卡（大卡：图标 + 标题 + 摘要 + 时间行） ──────────────────── */
.dsh-memory-entry-card{position:relative;display:flex;flex-direction:column;min-width:0;max-width:calc(100% - 16px);box-sizing:border-box;margin:0 8px 6px;padding:8px 12px 7px;border:1px solid var(--m-card-line);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;transition:border-color .15s cubic-bezier(.2,.8,.2,1),background .15s cubic-bezier(.2,.8,.2,1),box-shadow .15s cubic-bezier(.2,.8,.2,1),transform .15s cubic-bezier(.2,.8,.2,1);animation:dsh-memory-entry-in .22s cubic-bezier(.2,.8,.2,1) both}
.dsh-memory-entry-card:hover{border-color:var(--m-accent-line);box-shadow:0 2px 10px color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent)}
.dsh-memory-entry-card-sel,.dsh-memory-entry-card-sel:hover{border-color:var(--m-accent-line);background:var(--m-card-bg-sel);box-shadow:0 2px 12px color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
@keyframes dsh-memory-entry-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
/* 卡片是 align-items:flex-start 的纵向 flex：不给 top 行显式 stretch，
   长标题（white-space:nowrap）会把整行撑到卡片外，行尾的作用域徽章
   （全局 / 项目名）直接被推出可视区——看起来就是「标题太长就不显示标签」。
   align-self:stretch 把行锁回卡片宽度，标题再按 flex:1 省略号截断。 */
.dsh-memory-entry-top{display:flex;align-items:center;gap:7px;min-width:0;align-self:stretch;max-width:100%}
.dsh-memory-entry-icon{flex:none;display:inline-flex;align-items:center;color:var(--m-primary)}
.dsh-memory-entry-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:600;line-height:20px;color:var(--m-text)}
.dsh-memory-entry-chip{flex:none;display:inline-flex;align-items:center;gap:3px;max-width:88px;padding:1px 6px;border-radius:5px;background:var(--m-side);color:var(--m-text-2);font-size:10.5px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-entry-chip svg{flex:none}
.dsh-memory-entry-check{flex:none;display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;box-sizing:border-box;border:1.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);color:#fff;transition:border-color .15s ease,background .15s ease,transform .15s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-entry-check-on,.dsh-memory-entry-check-on:hover{border-color:var(--m-primary);background:var(--m-primary)}
.dsh-memory-entry-card-sel .dsh-memory-entry-check{border-color:var(--m-primary);background:var(--m-primary)}
.dsh-memory-entry-snippet{margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12.5px;line-height:18px;color:var(--m-text-2)}
.dsh-memory-entry-foot{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11.5px;line-height:16px;color:var(--m-text-3)}
.dsh-memory-entry-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--m-primary)}
.dsh-memory-entry-time{white-space:nowrap}

/* ── 紧凑行（时间分组内） ─────────────────────────────────────────── */
.dsh-memory-entry-row{display:flex;align-items:center;gap:8px;width:auto;min-width:0;max-width:calc(100% - 16px);box-sizing:border-box;margin:0 8px 2px;padding:9px 10px;border:none;border-radius:9px;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer;transition:background .14s cubic-bezier(.2,.8,.2,1),transform .14s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-entry-row:hover{background:var(--m-hover)}
.dsh-memory-entry-row-sel,.dsh-memory-entry-row-sel:hover{background:var(--m-primary-soft)}
.dsh-memory-entry-row-icon{flex:none;display:inline-flex;align-items:center;color:var(--m-text-3)}
.dsh-memory-entry-row-sel .dsh-memory-entry-row-icon{color:var(--m-primary)}
.dsh-memory-entry-row .dsh-memory-entry-title{font-weight:500}
.dsh-memory-entry-row-sel .dsh-memory-entry-title{color:var(--m-primary);font-weight:600}
.dsh-memory-entry-row .dsh-memory-entry-check{width:18px;height:18px}
.dsh-memory-entry-row-sel .dsh-memory-entry-check{border-color:var(--m-primary);background:var(--m-primary)}
.dsh-memory-entry-row:active{transform:scale(.99)}

/* ── 右栏详情 ─────────────────────────────────────────────────────── */
.dsh-memory-detail-col{padding:18px 22px 76px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box}
.dsh-memory-detail-anim{animation:dsh-memory-detail-in .18s cubic-bezier(.2,.8,.2,1) both;display:flex;flex-direction:column;gap:14px;min-width:0}
@keyframes dsh-memory-detail-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.dsh-memory-detail-head{display:flex;align-items:flex-start;gap:8px}
.dsh-memory-detail-title{flex:1;min-width:0;margin:0;font-size:18px;line-height:27px;font-weight:700;color:var(--m-text);word-break:break-word}
.dsh-memory-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:12px;line-height:18px}
.dsh-memory-chip-mute{display:inline-flex;align-items:center;gap:4px;max-width:200px;padding:1px 7px;border-radius:6px;background:var(--m-side);color:var(--m-text-2);font-size:11px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-chip-accent{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;background:var(--m-primary-chip);color:var(--m-primary);font-size:11px;line-height:17px;white-space:nowrap}
.dsh-memory-chip-warn{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;background:var(--m-warn-bg);color:var(--m-warn);font-size:11px;line-height:17px;white-space:nowrap}
.dsh-memory-chip-ok{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;background:var(--m-ok-bg);color:var(--m-ok);font-size:11px;line-height:17px;white-space:nowrap}
.dsh-memory-chip-time{margin-left:auto;font-size:12px;line-height:18px;color:var(--m-text-3);white-space:nowrap}
.dsh-memory-importance-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;border-radius:10px;background:var(--m-soft)}
.dsh-memory-importance-icon{flex:none;display:inline-flex;align-items:center;color:var(--m-primary)}
.dsh-memory-importance-label{font-size:13px;line-height:20px;color:var(--m-text-2)}
.dsh-memory-importance-bar{position:relative;flex:none;width:96px;height:6px;border-radius:3px;background:color-mix(in srgb,var(--m-primary) 16%,transparent);overflow:hidden}
.dsh-memory-importance-bar i{position:absolute;top:0;bottom:0;left:0;display:block;border-radius:3px;background:var(--m-primary-bar);transition:width .3s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-importance-value{font-variant-numeric:tabular-nums;font-size:13px;line-height:20px;font-weight:600;color:var(--m-text)}
.dsh-memory-importance-row .dsh-memory-top-stat-sep{margin:0 2px}
.dsh-memory-detail-body{min-width:0;font-size:14px;line-height:23px;color:var(--m-text);word-break:break-word}
.dsh-memory-detail-tags{display:flex;flex-wrap:wrap;gap:5px;padding-top:12px;border-top:1px solid var(--m-border)}
.dsh-memory-detail-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--m-border);font-size:11.5px;line-height:17px;color:var(--m-text-3)}
/* 详情区小节标题（关联信息 / 历史记录 / 相关记忆）。旧实现的规则写在了
   .dsh-memory-section-title 上，而面板用的是 -lg 后缀，等于没样式。 */
.dsh-memory-section-title-lg{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;line-height:22px;color:var(--m-text);margin-top:12px}
.dsh-memory-section-title{font-size:15px;font-weight:600;line-height:22px;color:var(--m-text);margin-top:12px}
.dsh-memory-section-line{flex:none;width:28px;height:3px;border-radius:2px;background:var(--dsw-alias-state-business-primary);margin:6px 0 8px}
.dsh-memory-stat{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;line-height:19px;color:var(--m-text-2);white-space:nowrap}
.dsh-memory-stat-value{font-variant-numeric:tabular-nums;font-weight:600;color:var(--m-text)}
.dsh-memory-stat-dot{flex:none;width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.dsh-memory-relation-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dsh-memory-relation-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--m-card-line);border-radius:10px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-relation-card:hover{border-color:var(--m-accent-line);box-shadow:0 2px 8px color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent)}
.dsh-memory-relation-label{font-size:12px;line-height:18px;color:var(--m-text-3)}
.dsh-memory-relation-main{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;font-weight:600;line-height:21px;color:var(--m-text)}
.dsh-memory-relation-sub{font-size:12.5px;line-height:19px;color:var(--m-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-memory-history-list{display:flex;flex-direction:column;gap:7px}
.dsh-memory-history-row{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:baseline}
.dsh-memory-history-time{font-size:12.5px;line-height:19px;color:var(--m-text-3);white-space:nowrap}
.dsh-memory-history-desc{min-width:0;font-size:13px;line-height:20px;color:var(--m-text-2);word-break:break-word}
.dsh-memory-history-link{display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:0;border:none;background:transparent;font-family:inherit;font-size:13px;line-height:20px;color:var(--m-primary);cursor:pointer;transition:color .13s ease}
.dsh-memory-history-link:hover{color:var(--m-primary-hover);text-decoration:underline}
.dsh-memory-change-more{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin:10px 0 2px;padding:9px 12px;box-sizing:border-box;border:1px solid var(--m-border);border-radius:10px;background:var(--m-side);color:var(--m-text-2);font-family:inherit;font-size:12.5px;line-height:18px;cursor:pointer;transition:border-color .16s ease,color .16s ease,box-shadow .16s ease,transform .16s ease}
.dsh-memory-change-more:hover{border-color:color-mix(in srgb,var(--m-primary) 55%,transparent);color:var(--m-primary);box-shadow:0 0 0 3px var(--m-primary-soft);transform:translateY(-1px)}
.dsh-memory-change-more:active{transform:translateY(0)}
.dsh-memory-change-more[disabled]{opacity:.55;cursor:default;transform:none;box-shadow:none}
.dsh-memory-related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.dsh-memory-related-card{position:relative;display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--m-card-line);border-radius:10px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;text-align:left;font-family:inherit;transition:border-color .15s ease,box-shadow .15s ease,transform .15s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-related-card:hover{border-color:var(--m-accent-line);box-shadow:0 2px 8px color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent);transform:translateY(-1px)}
.dsh-memory-related-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:20px;color:var(--m-text)}
.dsh-memory-related-sub{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:17px;color:var(--m-text-3)}
.dsh-memory-related-arrow{position:absolute;top:8px;right:9px;color:var(--m-text-3);opacity:0;transition:opacity .14s ease,color .14s ease}
.dsh-memory-related-card:hover .dsh-memory-related-arrow{opacity:.9;color:var(--m-primary)}

/* ── 通用 chip（详情标签筛选行沿用） ──────────────────────────────── */
.dsh-memory-chip{flex:none;display:inline-flex;align-items:center;padding:1px 7px;font-size:11px;line-height:16px;color:var(--m-text-2);border:1px solid var(--m-border-2);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;font-family:inherit;transition:color .14s ease,border-color .14s ease,background .14s ease}
.dsh-memory-chip:hover{color:var(--m-primary);border-color:var(--m-primary)}
.dsh-memory-chip-active,.dsh-memory-chip-active:hover{color:var(--m-primary);border-color:var(--m-primary);background:var(--m-primary-chip)}

/* ── 图标钮 ───────────────────────────────────────────────────────── */
.dsh-memory-card-actions{flex:none;display:flex;align-items:center;gap:2px;margin-left:auto}
.dsh-memory-icon-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--m-text-2);box-sizing:border-box;transition:background .14s ease,color .14s ease,transform .12s ease}
.dsh-memory-icon-action:hover:not(:disabled){background:var(--m-hover);color:var(--m-text)}
.dsh-memory-icon-action:active:not(:disabled){transform:scale(.93)}
.dsh-memory-icon-action:disabled{opacity:.4;cursor:default}
.dsh-memory-icon-action-danger:hover:not(:disabled){background:var(--m-err-bg);color:var(--m-err)}
.dsh-memory-icon-action-busy svg{animation:dsh-memory-spin 900ms linear infinite}
@keyframes dsh-memory-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.dsh-memory-pin-mark{flex:none;display:inline-flex;align-items:center;color:var(--m-warn)}

/* ── 空态 ─────────────────────────────────────────────────────────── */
.dsh-memory-empty{flex:1;min-height:120px;margin:16px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font-size:13px;line-height:20px;color:var(--m-text-3);text-align:center;border:1px dashed var(--m-border-2);border-radius:12px;box-sizing:border-box}
.dsh-memory-empty-icon{display:inline-flex;color:var(--m-text-3);opacity:.75}
.dsh-memory-empty-text{color:var(--m-text-2)}
.dsh-memory-empty-hint{font-size:12px;line-height:18px;color:var(--m-text-3);max-width:420px}

/* ── 变更 / 修订（全宽列表） ──────────────────────────────────────── */
.dsh-memory-card-list{flex:1;min-height:0;list-style:none;margin:0;padding:16px;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.dsh-memory-change-row{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--m-border-2);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-change-row:hover{border-color:var(--m-accent-line)}
.dsh-memory-change-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.dsh-memory-change-badge{flex:none;margin-top:2px;padding:1px 7px;border:1px solid var(--m-border-2);border-radius:6px;font-size:11px;line-height:16px;color:var(--m-text-2);white-space:nowrap}
.dsh-memory-change-badge-add{border-color:var(--m-ok);color:var(--m-ok);background:var(--m-ok-bg)}
.dsh-memory-change-badge-promote{border-color:var(--m-warn);color:var(--m-warn);background:var(--m-warn-bg)}
.dsh-memory-change-badge-delete{border-color:var(--m-err);color:var(--m-err);background:var(--m-err-bg)}
.dsh-memory-change-badge-revise{border-color:var(--m-info);color:var(--m-info);background:var(--m-info-bg)}
.dsh-memory-change-badge-retire{border-color:var(--m-warn);color:var(--m-warn);background:var(--m-warn-bg)}
.dsh-memory-change-old{color:var(--m-text-3);text-decoration:line-through;opacity:.8}
.dsh-memory-change-new{color:var(--m-text)}
.dsh-memory-change-diff{flex:1;min-width:0;display:flex;align-items:stretch;gap:10px}
.dsh-memory-change-diff-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsh-memory-change-diff-divider{flex:none;width:1px;background:var(--m-border-2)}
.dsh-memory-card-content{min-width:0;font-size:13px;line-height:20px;color:var(--m-text);white-space:pre-wrap;word-break:break-word}
.dsh-memory-card-meta{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--m-text-3);flex-wrap:wrap}

/* ── 工具栏（变更视图段控行） ─────────────────────────────────────── */
.dsh-memory-search-row{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--m-border);background:var(--dsw-alias-bg-layer-1,#fff)}
.dsh-memory-search-box{position:relative;flex:1;min-width:160px;max-width:430px;display:flex;align-items:center}
.dsh-memory-search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);display:inline-flex;color:var(--m-text-3);pointer-events:none}
.dsh-memory-search-input{flex:1;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:9px;padding:0 30px 0 32px;font-size:13px;line-height:20px;font-family:inherit;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-search-input::placeholder{color:var(--m-text-3)}
.dsh-memory-search-input:focus,.dsh-memory-search-input:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-search-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:5px;padding:0;background:transparent;color:var(--m-text-3);cursor:pointer;transition:background .13s ease,color .13s ease}
.dsh-memory-search-clear:hover{background:var(--m-hover);color:var(--m-text)}
.dsh-memory-tag-select{height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:9px;padding:0 30px 0 11px;font-size:13px;line-height:20px;font-family:inherit;color:var(--m-text);background-color:var(--dsw-alias-bg-layer-1,#fff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:12px 12px;appearance:none;max-width:240px;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-tag-select:hover{border-color:color-mix(in srgb,var(--m-text-3) 55%,transparent)}
.dsh-memory-tag-select:focus,.dsh-memory-tag-select:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-scope-select{flex:none;max-width:190px}
.dsh-memory-bar-sep{flex:none;width:1px;height:20px;background:var(--m-border-2)}
.dsh-memory-segment{flex:none;display:inline-flex;align-items:center;gap:2px;padding:2px;height:32px;box-sizing:border-box;border-radius:9px;background:var(--m-side)}
.dsh-memory-segment-item{appearance:none;border:none;background:transparent;border-radius:7px;height:28px;padding:0 14px;font-size:12.5px;line-height:19px;font-family:inherit;color:var(--m-text-2);cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-memory-segment-item:hover{color:var(--m-text)}
.dsh-memory-segment-item-active,.dsh-memory-segment-item-active:hover{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--m-primary);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.dsh-memory-spacer{flex:1 1 auto;min-width:0}
.dsh-memory-batch-count{font-size:12.5px;line-height:19px;color:var(--m-text);font-variant-numeric:tabular-nums}

/* ── 表单件（添加 / 编辑 / 移动） ─────────────────────────────────── */
.dsh-memory-detail-form{display:flex;flex-direction:column;gap:14px;border-radius:12px;background:var(--m-side);padding:16px;box-sizing:border-box}
.dsh-memory-form-title{font-size:14px;line-height:22px;font-weight:600;color:var(--m-text)}
.dsh-memory-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-memory-field-label{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:18px;font-weight:500;color:var(--m-text-2)}
.dsh-memory-field-row{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.dsh-memory-detail-form textarea,.dsh-memory-detail-form .dsh-memory-inline-input{box-sizing:border-box}
.dsh-memory-inline-input{height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:9px;padding:0 10px;font-size:13px;line-height:20px;font-family:inherit;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-inline-input::placeholder{color:var(--m-text-3)}
.dsh-memory-inline-input:focus,.dsh-memory-inline-input:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-inline-textarea{min-height:64px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:9px;padding:8px 10px;font-size:13px;line-height:20px;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);resize:vertical;font-family:inherit;width:100%;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-inline-textarea::placeholder{color:var(--m-text-3)}
.dsh-memory-inline-textarea:focus,.dsh-memory-inline-textarea:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-add-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-memory-check{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;line-height:19px;color:var(--m-text-2);cursor:pointer}
.dsh-memory-check input{accent-color:var(--m-primary);margin:0}
.dsh-memory-edit-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsh-memory-switch-line{display:inline-flex;align-items:center;gap:8px}
/* 开关走**中性黑白**，不用主题蓝。
   开 = 主文字色的实心轨道 + 反色圆点（浅色主题：黑轨白点；深色：白轨黑点），
   关 = 一层淡灰轨道 + 三级字色圆点。开合靠明暗对比说清，与卡片里的文字同一套
   色阶，不引入第二个强调色；--m-text / --m-bg 都在各主题下自动跟随。 */
.dsh-memory-switch{position:relative;flex:none;width:40px;height:22px;border:none;border-radius:11px;padding:0;background:var(--dsw-alias-border-l2,rgba(0,0,0,.12));cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.dsh-memory-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--m-text-3,var(--dsw-alias-label-tertiary,#81858c));box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-switch[aria-checked='true']{background:var(--m-text,var(--dsw-alias-label-primary,#1f2329))}
.dsh-memory-switch[aria-checked='true']::after{transform:translateX(18px);background:var(--m-card-bg,var(--dsw-static-neutral-bluish-00,#fff))}
.dsh-memory-switch:disabled{opacity:.5;cursor:default}
.dsh-memory-switch-text{font-size:12.5px;line-height:19px;color:var(--m-text-2)}

/* ── 通知 / 错误 ──────────────────────────────────────────────────── */
.dsh-memory-error{flex:none;margin:12px 16px 0;padding:8px 12px;border-radius:9px;border:1px solid var(--m-err);background:var(--m-err-bg);font-size:12.5px;line-height:19px;color:var(--m-err)}
.dsh-memory-notice{flex:none;margin:12px 16px 0;padding:8px 12px;border-radius:9px;border:1px solid var(--m-ok);background:var(--m-ok-bg);font-size:12.5px;line-height:19px;color:var(--m-ok)}

/* ── 修订 / 设置 ──────────────────────────────────────────────────── */
.dsh-memory-rev-actions{display:flex;align-items:center;gap:8px}
.dsh-memory-settings-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:20px}
.dsh-memory-settings-group{display:flex;flex-direction:column;gap:2px}
.dsh-memory-settings-group-title{padding:0 2px 6px;font-size:14px;font-weight:600;line-height:22px;color:var(--m-text)}
.dsh-memory-settings-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--m-border-2);border-radius:12px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease}
.dsh-memory-settings-row:hover{border-color:var(--m-accent-line)}
.dsh-memory-settings-row+.dsh-memory-settings-row{margin-top:6px}
.dsh-memory-settings-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-memory-settings-label{font-size:13.5px;line-height:21px;font-weight:500;color:var(--m-text)}
.dsh-memory-settings-hint{font-size:12px;line-height:18px;color:var(--m-text-3)}
.dsh-memory-settings-control{flex:none;display:flex;align-items:center;gap:8px}
.dsh-memory-number-input{width:96px;height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:9px;padding:0 10px;font-size:13px;line-height:20px;font-family:inherit;font-variant-numeric:tabular-nums;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-number-input:focus,.dsh-memory-number-input:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-settings-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:4px}

/* ── 骨架屏 ───────────────────────────────────────────────────────── */
.dsh-memory-skeleton{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:16px}
.dsh-memory-skeleton-row{height:48px;border-radius:10px;background:var(--m-side);animation:dsh-memory-pulse 1.4s ease-in-out infinite}
.dsh-memory-skeleton-row:nth-child(2){animation-delay:.12s}
.dsh-memory-skeleton-row:nth-child(3){animation-delay:.24s}
.dsh-memory-skeleton-row:nth-child(4){animation-delay:.36s}
@keyframes dsh-memory-pulse{0%,100%{opacity:.45}50%{opacity:.9}}

/* ── 徽标（禁用 / 废弃 / 作用域） ─────────────────────────────────── */
.dsh-memory-disabled-mark{flex:none;margin-left:2px;padding:0 5px;border:1px solid var(--m-border-2);border-radius:4px;font-size:10px;line-height:14px;color:var(--m-text-3);white-space:nowrap}
.dsh-memory-retired-mark{flex:none;margin-left:2px;padding:0 5px;border:1px solid var(--m-warn);border-radius:4px;font-size:10px;line-height:14px;color:var(--m-warn);background:var(--m-warn-bg);white-space:nowrap}
.dsh-memory-scope-badge{flex:none;display:inline-flex;align-items:center;gap:3px;max-width:88px;padding:1px 6px;border:1px solid var(--m-border-2);border-radius:5px;font-size:10.5px;line-height:15px;color:var(--m-text-2);background:var(--m-side);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-scope-badge svg{flex:none}

/* ── 注入开关（composer 工具行）：iconButton 规格 ─────────────────── */
/* wrap 包住按钮与卡片：卡片是其 DOM 后代，按钮↔卡片间移动不丢 hover。 */
/* composer 上的两枚注入按钮：中性黑白，与它们各自的卡片同一套色阶。
   开 = 主文字色（主题深浅自动反色），关 = 三级字色。 */
.dsh-memory-toggle-wrap{position:relative;display:inline-flex}
.dsh-memory-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#9ca3af);box-sizing:border-box;transition:background .15s ease,color .15s ease}
.dsh-memory-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(65,118,230,.07))}
.dsh-memory-toggle-on{color:var(--dsw-alias-label-primary,#1f2329)}
.dsh-memory-toggle-off{color:var(--dsw-alias-label-tertiary,#9ca3af);opacity:.55}

/* ── focus 规范 ───────────────────────────────────────────────────── */
.dsh-memory-nav-item:focus-visible,.dsh-memory-proj-row:focus-visible,.dsh-memory-cat-row:focus-visible,
.dsh-memory-settings-nav:focus-visible,.dsh-memory-section-plus:focus-visible,.dsh-memory-top-close:focus-visible,
.dsh-memory-list-sort:focus-visible,.dsh-memory-tool-btn:focus-visible,.dsh-memory-icon-action:focus-visible,
.dsh-memory-entry-card:focus-visible,.dsh-memory-entry-row:focus-visible,.dsh-memory-chip:focus-visible,
.dsh-memory-search-clear:focus-visible,.dsh-memory-related-card:focus-visible,.dsh-memory-history-link:focus-visible,.dsh-memory-change-more:focus-visible,
/* ── 对话框大脑按钮的悬浮卡片：本会话开关 + 默认开关 ─────────────────
   卡片挂在按钮 wrap 内（同 AI 浏览器 gate），落在 .dsh-memory-panel
   作用域之外，故自带一份 --m-* 变量（开关等子元素复用面板样式，否则会
   拿到未定义的 var）。常驻 DOM + visibility 过渡：hidden 时不参与命中，
   鼠标划过其区域无误触；显隐走 160ms 位移+淡入。 */
.dsh-memory-inject-card{
  --m-primary:var(--dsw-alias-state-business-primary,#4176e6);
  --m-text:var(--dsw-alias-label-primary,#1f2329);
  --m-text-2:var(--dsw-alias-label-secondary,#5b6068);
  --m-text-3:var(--dsw-alias-label-tertiary,#81858c);
  --m-border:var(--dsw-alias-border-l1,rgba(0,0,0,.08));
  /* 卡片自身的底色：开关打开时圆点要用它，才能在深色主题下是"黑点白轨"而不是
     一枚永远的白点（白点在深色轨道上会糊掉）。 */
  --m-card-bg:var(--dsw-static-neutral-bluish-00,#fff);
  position:absolute;left:-4px;bottom:calc(100% + 10px);z-index:1150;width:272px;box-sizing:border-box;padding:10px 12px 9px;
  border:1px solid var(--m-border);border-radius:12px;
  background:var(--dsw-static-neutral-bluish-00,#fff);
  box-shadow:var(--dsw-shadow-lv3,0 10px 34px rgba(15,23,42,.18));
  font-family:inherit;color:var(--m-text);text-align:left;
  opacity:0;visibility:hidden;transform:translateY(6px) scale(.985);pointer-events:none;
  transition:opacity .16s ease,transform .16s cubic-bezier(.2,.8,.2,1),visibility 0s linear .16s}
.dsh-memory-inject-card-on{
  opacity:1;visibility:visible;transform:none;pointer-events:auto;
  transition:opacity .16s ease,transform .16s cubic-bezier(.2,.8,.2,1),visibility 0s}
html[data-dsh-glass] .dsh-memory-inject-card{background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none}
body[data-ds-dark-theme] .dsh-memory-inject-card{background:var(--dsw-static-neutral-bluish-1000,#16181d);--m-card-bg:var(--dsw-static-neutral-bluish-1000,#16181d)}
.dsh-memory-inject-head{display:flex;align-items:center;gap:6px;padding-bottom:7px;border-bottom:1px solid var(--m-border)}
.dsh-memory-inject-title{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:var(--m-text-2)}
/* 记忆注入的状态标签：中性灰阶。开=二级字色 + 淡底，关=三级字色 + 更淡的底。
   （原先用主题蓝，整张卡被染成蓝色调，已按要求去掉。） */
.dsh-memory-inject-tag{margin-left:auto;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;line-height:16px}
.dsh-memory-inject-tag-on{background:color-mix(in srgb,var(--m-text) 9%,transparent);color:var(--m-text-2)}
.dsh-memory-inject-tag-off{background:color-mix(in srgb,var(--m-text-3) 14%,transparent);color:var(--m-text-3)}
/* 内置提示词通道卡：只有三行，比记忆卡窄一档，两张卡挨在一起时宽度差本身就是
   一条无声的分组线。 */
.dsh-memory-builtin-card{width:238px}
.dsh-memory-inject-row{display:flex;align-items:center;gap:10px;padding:9px 0;transition:background .15s ease}
/* 悬停：极淡的底，让"这一行能点"被看见，又不与开态的底色混淆（开态更深一档）。 */
.dsh-memory-inject-row:hover{background:color-mix(in srgb,var(--m-text-3) 7%,transparent);border-radius:7px}
.dsh-memory-inject-row+.dsh-memory-inject-row{border-top:1px dashed var(--m-border)}
/* 每组第一行：上方已经有组标题，不再叠一条虚线，否则组标题与首行之间多一道割裂。 */
.dsh-memory-inject-row.dsh-memory-inject-row-lead{border-top:none}
.dsh-memory-inject-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-memory-inject-label{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;line-height:19px;color:var(--m-text)}
.dsh-memory-inject-hint{font-size:11px;line-height:15px;color:var(--m-text-3)}
.dsh-memory-inject-badge{padding:0 5px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 20%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d);font-size:10px;font-weight:600;line-height:15px}
.dsh-memory-inject-follow{display:block;width:100%;margin:2px 0 4px;padding:5px 8px;box-sizing:border-box;border:1px dashed var(--m-border);border-radius:8px;background:transparent;color:var(--m-text-2);font-family:inherit;font-size:11.5px;line-height:16px;cursor:pointer;transition:border-color .15s ease,color .15s ease,background .15s ease}
.dsh-memory-inject-follow:hover{border-color:var(--m-text-3);color:var(--m-text);background:color-mix(in srgb,var(--m-text-3) 9%,transparent)}
.dsh-memory-inject-foot{margin:2px 0 0;font-size:11px;line-height:15px;color:var(--m-text-3)}

/* ── 行与分组（内置通道 / 记忆注入 统一一套行） ───────────────────────
   以前三条内置通道是「每行一只圆角盒子 + 描边 + 外发光」，下面两行记忆开关却是
   裸行 + 虚线分隔——同一张卡里两种排版，盒子之间还夹着渐变分隔线，272px 的宽度
   被切成一摞小卡片，视觉碎、行高对不齐。现在两组共用同一套行：裸行 + 虚线
   分隔 + 右侧开关，组与组之间由一枚极轻的小标题分开。

   选中态改由「极淡主色底」承担：描边、外发光、左侧竖条都撤了（竖条此前已按
   要求删过一次），开关本身的蓝/灰已经足够说清开合，底色只补一层几乎察觉不到的
   暖意，让一列开关扫过去时开的那几枚不显得孤立。 */
.dsh-memory-inject-group{margin:9px 0 2px;padding:0 2px 5px;display:flex;align-items:baseline;gap:6px}
.dsh-memory-inject-group:first-of-type{margin-top:2px}
.dsh-memory-inject-group-title{font-size:11px;font-weight:600;line-height:15px;letter-spacing:.03em;color:var(--m-text-3)}
.dsh-memory-inject-group-hint{font-size:10.5px;line-height:15px;color:var(--m-text-3);opacity:.8}
/* 开态不再铺任何底色（原先是一层淡蓝，会把整列开关染成蓝色调）。
   状态由开关本身承担：开 = 主文字色实心轨道 + 反色圆点，关 = 淡灰轨道。 */
.dsh-memory-inject-row-on{background:transparent}
@media (prefers-reduced-motion:reduce){.dsh-memory-inject-card,.dsh-memory-inject-card-on{transition:none}}
.dsh-memory-switch:focus-visible,.dsh-memory-toggle:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent)}

/* ── 窄屏适配 ─────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .dsh-memory-list-col{width:340px}
  .dsh-memory-related-grid{grid-template-columns:1fr}
}
@media (max-width: 900px) {
  .dsh-memory-top-stats .dsh-memory-top-stat-long{display:none}
}
@media (max-width: 767.98px) {
  .dsh-memory-panel{flex-direction:column}
  .dsh-memory-sidebar{width:100%;flex-direction:row;flex-wrap:wrap;gap:6px;padding:10px 12px;border-right:none;border-bottom:1px solid var(--m-side-line)}
  .dsh-memory-sidebar-brand{display:none}
  .dsh-memory-sidebar-add{width:auto;padding:0 14px;margin-bottom:0;height:34px}
  .dsh-memory-nav-list,.dsh-memory-proj-list,.dsh-memory-cat-list{flex-direction:row;flex-wrap:wrap;gap:4px}
  .dsh-memory-nav-item,.dsh-memory-proj-row,.dsh-memory-cat-row{width:auto;height:32px}
  .dsh-memory-nav-sep,.dsh-memory-section-header{display:none}
  .dsh-memory-cols{flex-direction:column}
  .dsh-memory-list-col{width:100%;max-height:42%;border-right:none;border-bottom:1px solid var(--m-border)}
  .dsh-memory-detail-col{padding:14px 14px 18px}
  .dsh-memory-related-grid{grid-template-columns:1fr}
  .dsh-memory-relation-grid{grid-template-columns:1fr}
}
@media (prefers-reduced-motion: reduce) {
  .dsh-memory-entry-card,.dsh-memory-entry-row,.dsh-memory-related-card,
  .dsh-memory-history-link,.dsh-memory-tool-btn,.dsh-memory-top-input,.dsh-memory-change-more{transition:none}
  .dsh-memory-entry-card,.dsh-memory-entry-row,.dsh-memory-group-section,.dsh-memory-detail-anim{animation:none}
  .dsh-memory-skeleton-row,.dsh-memory-icon-action-busy svg{animation:none}
  .dsh-memory-importance-bar i{transition:none}
}

/* ── 顶部两级工具筛选栏 ── */
.dsh-memory-top-bar{flex:none;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);border-bottom:1px solid var(--m-border);z-index:5}

/* 一级：视图分段器 + 统计 + 新增按钮 */
.dsh-memory-view-row{display:flex;align-items:center;justify-content:space-between;gap:12px;height:46px;padding:0 16px;box-sizing:border-box}
.dsh-memory-view-tabs{display:flex;align-items:center;gap:3px;padding:3px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--m-text) 5%,transparent));border:1px solid var(--m-border)}
.dsh-memory-view-tab{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:6px;border:none;background:transparent;color:var(--m-text-2);font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 140ms ease;user-select:none;white-space:nowrap}
.dsh-memory-view-tab:hover{color:var(--m-text);background:var(--m-hover)}
.dsh-memory-view-tab[data-active="true"]{background:var(--m-primary,#3b82f6) !important;color:#fff !important;font-weight:600;box-shadow:0 1px 4px rgba(59,130,246,.28)}
.dsh-memory-view-tab[data-active="true"] .dsh-memory-nav-count{background:#fff;color:var(--m-primary,#3b82f6)}
.dsh-memory-view-actions{display:flex;align-items:center;gap:12px}
.dsh-memory-primary-add{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 12px;border-radius:6px;border:none;background:var(--m-primary,#3b82f6);color:#fff;font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 140ms ease}
.dsh-memory-primary-add:hover{background:var(--m-primary-hover);box-shadow:0 2px 10px rgba(59,130,246,.35)}
.dsh-memory-primary-add:active{transform:scale(.98)}

/* 二级：搜索框 + 项目下拉 + 分类下拉与分类胶囊 Pills */
.dsh-memory-subfilter-row{display:flex;align-items:center;gap:12px;height:44px;padding:0 16px;background:var(--dsw-alias-bg-layer-1,#fff);border-top:1px solid var(--m-border);box-sizing:border-box}
.dsh-memory-subfilter-search{position:relative;width:220px;flex:none;display:flex;align-items:center}
.dsh-memory-subfilter-search input{flex:1;min-width:0;height:28px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:7px;padding:0 46px 0 28px;font-size:12px;font-family:inherit;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease}
.dsh-memory-subfilter-search input:focus{outline:none;border-color:var(--m-primary)}
.dsh-memory-subfilter-search .dsh-memory-top-search-icon{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:inline-flex;color:var(--m-text-3);pointer-events:none}
.dsh-memory-subfilter-search .dsh-memory-top-kbd{position:absolute;right:6px;top:50%;transform:translateY(-50%);pointer-events:none;padding:1px 5px;border:1px solid var(--m-border-2);border-radius:4px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--m-text) 5%,transparent));color:var(--m-text-3);font-size:10px;line-height:14px}
.dsh-memory-subfilter-group{display:inline-flex;align-items:center;gap:6px;flex:none}
.dsh-memory-subfilter-label{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--m-text-2);white-space:nowrap}
.dsh-memory-subfilter-select{height:28px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:7px;padding:0 26px 0 10px;font-size:12px;line-height:18px;font-family:inherit;color:var(--m-text);background-color:var(--dsw-alias-bg-layer-1,#fff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;background-size:10px 10px;appearance:none;cursor:pointer;min-width:130px;max-width:240px;transition:border-color .15s ease}
.dsh-memory-subfilter-select:hover{border-color:color-mix(in srgb,var(--m-text-3) 55%,transparent)}
.dsh-memory-subfilter-select:focus{outline:none;border-color:var(--m-primary)}
.dsh-memory-pills{display:flex;align-items:center;gap:5px;overflow-x:auto;scrollbar-width:none}
.dsh-memory-pills::-webkit-scrollbar{display:none}
.dsh-memory-pill{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--m-border);background:var(--m-soft);color:var(--m-text-2);font-size:11.5px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all 120ms ease}
.dsh-memory-pill:hover{border-color:var(--m-border-2);color:var(--m-text);background:var(--m-hover)}
.dsh-memory-pill[data-active="true"]{border-color:var(--m-primary);color:var(--m-primary);background:var(--m-primary-soft);font-weight:600}
/* ── 记忆正文的轻量 Markdown（替代 webui 全量渲染器，见 markdown.tsx） ── */
.dsh-triad-md{font-size:14px;line-height:1.7;color:var(--m-text);word-break:break-word}
.dsh-triad-md>*:first-child{margin-top:0}
.dsh-triad-md>*:last-child{margin-bottom:0}
.dsh-triad-md__p{margin:0 0 8px}
.dsh-triad-md__h{margin:16px 0 8px;font-weight:600;line-height:1.4}
.dsh-triad-md__h:first-child{margin-top:0}
.dsh-triad-md__list{margin:0 0 8px;padding-left:20px}
.dsh-triad-md__list li{margin:2px 0}
.dsh-triad-md__quote{margin:0 0 8px;padding:2px 0 2px 10px;border-left:2px solid var(--m-border-2);color:var(--m-text-2)}
.dsh-triad-md__code{padding:1px 5px;border-radius:4px;background:var(--m-side);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
.dsh-triad-md__pre{margin:0 0 8px;padding:10px 12px;border-radius:8px;overflow-x:auto;background:var(--m-side);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6;white-space:pre}
.dsh-triad-md__pre code{background:none;padding:0}
.dsh-triad-md__hr{margin:12px 0;border:0;border-top:1px solid var(--m-border-2)}
.dsh-triad-md__link{color:var(--m-primary);text-decoration:none}
.dsh-triad-md__link:hover{text-decoration:underline}
`

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  // 内容比对，**不能只按 id 判重**。只判 id 时，插件升级后已打开的页面里那份
  // 旧 <style> 会一直命中早退分支：JSX 能拿到新 class 名、却永远匹配不到新
  // 规则，UI 裸奔（本仓新增中文记忆通道时踩过：开关正常、新排版全散架）。
  // 代价是一次字符串比较，换来热更新后样式必定收敛。
  if (existing !== null) {
    if (existing.textContent !== SHEET) existing.textContent = SHEET
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
