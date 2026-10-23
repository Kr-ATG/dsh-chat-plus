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
  viewActions: 'dsh-memory-view-actions',
  primaryAdd: 'dsh-memory-primary-add',
  // ── 左栏 ──
  navIcon: 'dsh-memory-nav-icon',
  navCount: 'dsh-memory-nav-count',
  navCountZero: 'dsh-memory-nav-count-zero',
  navCountPop: 'dsh-memory-nav-count-pop',
  navCountInline: 'dsh-memory-nav-count-inline',
  catDot: 'dsh-memory-cat-dot',
  // ── 顶栏 ──
  topSearchIcon: 'dsh-memory-top-search-icon',
  topKbd: 'dsh-memory-top-kbd',
  topStats: 'dsh-memory-top-stats',
  topStat: 'dsh-memory-top-stat',
  topStatVal: 'dsh-memory-top-stat-val',
  topStatIcon: 'dsh-memory-top-stat-icon',
  topStatSep: 'dsh-memory-top-stat-sep',
  // ── 筛选行 ──
  filterSelect: 'dsh-memory-filter-select',
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
  // ── 2026-10 重做新增：左轨（类型点 + 命中热力）、徽章、悬浮操作组 ──
  entryRail: 'dsh-memory-entry-rail',
  entryKindDot: 'dsh-memory-entry-kind-dot',
  entryHeat: 'dsh-memory-entry-heat',
  entryPendBadge: 'dsh-memory-entry-pend-badge',
  entryImpBadge: 'dsh-memory-entry-imp-badge',
  entryTags: 'dsh-memory-entry-tags',
  entryTag: 'dsh-memory-entry-tag',
  entryActions: 'dsh-memory-entry-actions',
  entryAction: 'dsh-memory-entry-action',
  entryActionPri: 'dsh-memory-entry-action-pri',
  entryActionDanger: 'dsh-memory-entry-action-danger',
  entryCardPend: 'dsh-memory-entry-card-pend',
  // ── 2026-10 第二轮重做：真正的左侧栏 + 独立顶栏 ──
  sidebarNav: 'dsh-memory-sidebar-nav',
  sidebarBrand: 'dsh-memory-sidebar-brand',
  sidebarBrandIcon: 'dsh-memory-sidebar-brand-icon',
  sidebarBrandText: 'dsh-memory-sidebar-brand-text',
  sidebarSection: 'dsh-memory-sidebar-section',
  sidebarSectionTitle: 'dsh-memory-sidebar-section-title',
  sidebarSectionCount: 'dsh-memory-sidebar-section-count',
  sidebarItem: 'dsh-memory-sidebar-item',
  sidebarItemActive: 'dsh-memory-sidebar-item-active',
  sidebarItemLabel: 'dsh-memory-sidebar-item-label',
  sidebarItemCount: 'dsh-memory-sidebar-item-count',
  sidebarEmpty: 'dsh-memory-sidebar-empty',
  searchWrap: 'dsh-memory-search-wrap',
  searchInput: 'dsh-memory-search-input',
  searchKbd: 'dsh-memory-search-kbd',
  searchClearBtn: 'dsh-memory-search-clear-btn',
  topActions: 'dsh-memory-top-actions',
  contentCol: 'dsh-memory-content-col',
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
  chipMuteBtn: 'dsh-memory-chip-mute-btn',
  chipOkBtn: 'dsh-memory-chip-ok-btn',
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
  // switchText / switchLine 随 2026-10-18 那两个开关（自动记忆 / 排除注入）迁出
  // 记忆面板而删除：它们只服务项目上下文条里那两行，留着就是零消费者的死类名。
  batchCount: 'dsh-memory-batch-count',
  error: 'dsh-memory-error',
  notice: 'dsh-memory-notice',
  detailForm: 'dsh-memory-detail-form',
  formTitle: 'dsh-memory-form-title',
  field: 'dsh-memory-field',
  fieldLabel: 'dsh-memory-field-label',
  fieldRow: 'dsh-memory-field-row',
  revActions: 'dsh-memory-rev-actions',
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
  // 注：composer 注入开关（toggle* / inject* 共 20 个键）已随组件删除，
  // 键与规则一并清掉。开关本身还在，它用下面的 switch。
} as const

const STYLE_ID = 'dsh-memory-styles'

const SHEET = `
/* ── 主题变量（跟随 DSH 明/暗主题；accent 恒为主题蓝） ────────────────
   所有 --m-* 派生自 DSH 主题 token（--dsw-alias-*），明暗主题切换时
   面板自动跟进：浅色=白底，高亮/蓝字；深色=暗底，亮字。数据色板图标
   （分类圆点/项目文件夹/kind 图标色）不随主题变。 */
/* ── 设计变量（2026-10 重做：从「后台管理面板」改为「记忆流」）─────────
   设计取向：数据量小（十几到几十条），所以每条记忆都值得被看见——
   给足留白、给每条一个可扫读的卡片，而不是挤成密集列表行。
   颜色克制到「一个主色 + 中性灰」，避免一屏五六个色相打架。 */
.dsh-memory-panel{
  /* 主色只用于「正在发生的事」：选中态、命中热力、主操作按钮。 */
  --m-primary:var(--dsw-alias-state-business-primary);
  --m-on-primary:var(--dsw-alias-label-on-primary,#fff);
  --m-primary-hover:var(--dsw-alias-button-info-hover);
  --m-primary-soft:color-mix(in srgb,var(--m-primary) 10%,transparent);
  --m-primary-chip:color-mix(in srgb,var(--m-primary) 9%,transparent);
  --m-primary-bar:var(--dsw-alias-state-business-primary);
  --m-accent-line:color-mix(in srgb,var(--m-primary) 45%,transparent);
  --m-card-bg-sel:color-mix(in srgb,var(--m-primary) 6%,var(--dsw-alias-bg-layer-1,#fff));
  --m-card-line:var(--dsw-alias-border-l1,rgba(0,0,0,.08));
  /* 文字四级：主 / 次 / 弱 / 极弱。层级靠这四级拉开，不靠字号堆叠。 */
  --m-text:var(--dsw-alias-label-primary,#111);
  --m-text-2:var(--dsw-alias-label-secondary,#5b6068);
  --m-text-3:var(--dsw-alias-label-tertiary,#8b9098);
  --m-border:var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  --m-border-2:var(--dsw-alias-border-l2,rgba(0,0,0,.11));
  /* ── 字号（5 档，去掉原 11/11.5/12/12.5/13/13.5 的六连挤）──────────
     重做要点：正文从 13 提到 13.5、行高从 18 提到 1.62 倍。
     记忆是长文本，行高比字号更影响可读性。 */
  --m-fs-caption:11px;   /* 徽章、计数 */
  --m-fs-meta:12px;      /* 时间、标签 */
  --m-fs-body:13.5px;    /* 正文主力档 */
  --m-fs-title:15px;     /* 卡片标题 */
  --m-fs-h2:18px;        /* 详情标题 */
  --m-fs-h1:22px;        /* 页面标题 */
  /* ── 圆角：统一到 3 档 + 胶囊，去掉原来的 12 种 ───────────────── */
  --m-r-chip:6px;
  --m-r-ctrl:9px;
  --m-r-card:13px;
  --m-r-pill:999px;
  /* ── 间距：4 的倍数，只留 5 档 ──────────────────────────────── */
  --m-sp-1:4px;
  --m-sp-2:8px;
  --m-sp-3:12px;
  --m-sp-4:16px;
  --m-sp-5:20px;
  --m-sp-6:24px;
  /* 中性底色：hover 用极浅一层，不做整块变色。 */
  --m-hover:color-mix(in srgb,var(--m-text-3) 9%,transparent);
  --m-soft:color-mix(in srgb,var(--m-text-3) 6%,transparent);
  --m-side:color-mix(in srgb,var(--m-text-3) 11%,transparent);
  --m-side-line:var(--m-border);
  --m-ok:var(--dsw-alias-state-success-primary,#1e7d43);
  --m-warn:var(--dsw-alias-state-warn-primary,#c2740a);
  --m-err:var(--dsw-alias-state-error-primary,#c0392b);
  --m-ok-bg:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1e7d43) 11%,transparent);
  --m-warn-bg:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c2740a) 11%,transparent);
  --m-err-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c0392b) 10%,transparent);
  --m-info:var(--dsw-alias-state-info-primary,#5b9dff);
  --m-info-bg:color-mix(in srgb,var(--dsw-alias-state-info-primary,#5b9dff) 11%,transparent);
  --m-count-bg:color-mix(in srgb,var(--m-text-3) 15%,transparent);
  --m-count-bg-hover:color-mix(in srgb,var(--m-text-3) 26%,transparent);
  /* 卡片投影：hover 才给，静止态靠描边分隔（静止态加阴影 = 一屏浮块）。 */
  --m-shadow:0 2px 10px rgba(0,0,0,.045);
  --m-shadow-lg:0 8px 28px rgba(0,0,0,.09);
  background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--m-text);
}

/* ── 面板骨架 ─────────────────────────────────────────────────────── */
.dsh-memory-modal-body{overflow:hidden;display:flex;flex-direction:column}
/* 面板：侧栏 + 内容两栏。原来是 column（顶栏压在上面），
   现在导航进侧栏，改成 row 才能左右布局。 */
.dsh-memory-panel{flex:1;width:100%;height:100%;min-height:0;display:flex;flex-direction:row;gap:0;overflow:hidden;padding:0;box-sizing:border-box}

/* ══ 左侧栏（2026-10 第二轮重做）════════════════════════════════════
   旧版根本没有侧栏：6 个导航 tab 全挤在顶部一行，项目/分类是两个下拉框。
   数据只有十几个项目两个分类，下拉框完全是过度设计——看不见选项就得先点开。
   新方案：真侧栏，导航 / 项目 / 分类全部平铺可点，一眼看全。 */

/* 面板整体改成「侧栏 + 右侧内容」两栏。
   注意 .dsh-memory-panel 原本是 flex-direction:column，现在改成 row。 */
.dsh-memory-sidebar-nav{
  flex:none;width:212px;align-self:stretch;box-sizing:border-box;
  display:flex;flex-direction:column;gap:2px;
  padding:14px 10px 16px;
  overflow-y:auto;overflow-x:hidden;
  background:color-mix(in srgb,var(--m-text-3) 4%,var(--dsw-alias-bg-layer-1,#fff));
  border-right:1px solid var(--m-border);
}
/* 品牌头：图标 + 标题。它不是装饰——它给这个侧栏一个「这是哪」的锚点。 */
.dsh-memory-sidebar-brand{display:flex;align-items:center;gap:9px;padding:4px 8px 14px;flex:none}
.dsh-memory-sidebar-brand-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:var(--m-primary-soft);color:var(--m-primary)}
.dsh-memory-sidebar-brand-text{font-size:14px;font-weight:650;line-height:19px;color:var(--m-text);letter-spacing:-.005em}

/* 分区：标题 + 条目列表。分区之间靠 margin 分隔，不用分割线（线多了像表格）。 */
.dsh-memory-sidebar-section{display:flex;flex-direction:column;gap:1px;margin-top:14px}
.dsh-memory-sidebar-section-title{
  display:flex;align-items:center;gap:6px;
  padding:0 9px 6px;
  font-size:10.5px;font-weight:600;line-height:15px;
  color:var(--m-text-3);letter-spacing:.06em;text-transform:uppercase;
}
.dsh-memory-sidebar-section-count{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:500;opacity:.75}

/* 侧栏条目：整行可点，左图标 + 文字 + 右侧计数。
   选中态用「主色柔底 + 主色文字」，不用左侧色条（色条在窄栏里太吵）。 */
.dsh-memory-sidebar-item{
  display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;
  padding:7px 9px;border:none;border-radius:8px;
  background:transparent;color:var(--m-text-2);
  font-family:inherit;font-size:var(--m-fs-body);line-height:19px;font-weight:500;
  text-align:left;cursor:pointer;
  transition:background .15s cubic-bezier(.2,.8,.2,1),color .15s cubic-bezier(.2,.8,.2,1),
             transform .15s cubic-bezier(.2,.8,.2,1);
}
.dsh-memory-sidebar-item:hover{background:var(--m-hover);color:var(--m-text)}
.dsh-memory-sidebar-item:active{transform:scale(.985)}
.dsh-memory-sidebar-item:focus-visible{outline:2px solid var(--m-primary);outline-offset:-2px}
.dsh-memory-sidebar-item-active,.dsh-memory-sidebar-item-active:hover{background:var(--m-primary-soft);color:var(--m-primary);font-weight:600}
.dsh-memory-sidebar-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-memory-sidebar-item-count{flex:none;min-width:18px;text-align:right;font-size:var(--m-fs-caption);line-height:15px;font-variant-numeric:tabular-nums;color:var(--m-text-3);opacity:.85}
.dsh-memory-sidebar-item-active .dsh-memory-sidebar-item-count{color:var(--m-primary);opacity:1;font-weight:600}
.dsh-memory-sidebar-empty{padding:6px 9px;font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-3);opacity:.8}

/* 右侧内容列：顶栏 + 主区纵向堆叠，自己管滚动边界。 */
.dsh-memory-content-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
/* ══ 顶栏（2026-10 第二轮重做）══════════════════════════════════════
   旧版顶部塞了两行：第一行 6 个 tab + 4 个统计 + 添加按钮，第二行搜索 + 2 个下拉 + 胶囊。
   现在导航进了侧栏，顶栏只留三样东西：搜索框（占主位）、统计、主按钮。 */

/* 搜索框：从「带图标的输入框 + 右侧 ⌘K 角标」重做成「胶囊容器 + 内嵌清除键」。
   重点变化：高度 36→38、圆角改胶囊、聚焦时主色描边 + 柔和光晕。 */
.dsh-memory-search-wrap{
  display:flex;align-items:center;gap:8px;
  flex:1;min-width:0;max-width:520px;height:38px;box-sizing:border-box;
  padding:0 12px;
  border:1px solid var(--m-border);border-radius:var(--m-r-pill);
  background:color-mix(in srgb,var(--m-text-3) 5%,transparent);
  transition:border-color .18s cubic-bezier(.2,.8,.2,1),
             background .18s cubic-bezier(.2,.8,.2,1),
             box-shadow .18s cubic-bezier(.2,.8,.2,1);
}
.dsh-memory-search-wrap:focus-within{
  border-color:var(--m-primary);
  background:var(--dsw-alias-bg-layer-1,#fff);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--m-primary) 11%,transparent);
}
.dsh-memory-search-input{
  flex:1;min-width:0;border:0;outline:0;background:transparent;
  font-family:inherit;font-size:var(--m-fs-body);line-height:20px;color:var(--m-text);
}
.dsh-memory-search-input::placeholder{color:var(--m-text-3)}
/* ⌘K 角标：只在不聚焦且无输入时出现（聚焦后它没有信息价值，只是在碍事）。 */
.dsh-memory-search-kbd{
  flex:none;padding:1px 6px;border:1px solid var(--m-border-2);border-radius:5px;
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--m-text-3);
  font-size:10.5px;line-height:15px;font-variant-numeric:tabular-nums;
  pointer-events:none;transition:opacity .16s ease;
}
.dsh-memory-search-wrap:focus-within .dsh-memory-search-kbd{opacity:0}
/* 清除键：有内容才出现。 */
.dsh-memory-search-clear-btn{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;padding:0;border:none;border-radius:50%;
  background:color-mix(in srgb,var(--m-text-3) 20%,transparent);
  color:var(--dsw-alias-bg-layer-1,#fff);
  font-size:11px;line-height:1;cursor:pointer;
  transition:background .15s ease,transform .15s cubic-bezier(.2,.8,.2,1);
}
.dsh-memory-search-clear-btn:hover{background:color-mix(in srgb,var(--m-text-3) 40%,transparent);transform:scale(1.08)}
.dsh-memory-search-clear-btn:active{transform:scale(.94)}

/* 顶栏按钮区：统计弱化成一行小字，添加按钮改成实心主色胶囊。 */
.dsh-memory-top-actions{display:flex;align-items:center;gap:var(--m-sp-3);flex:none;margin-left:auto}

/* ── 左侧栏：品牌 / 添加 / 导航 / 项目 / 分类 / 设置竖排 ───────── */
/* 一级：视图 tabs 收进分段控件底座，跟下面的胶囊拉开层级 */
.dsh-memory-nav-icon{flex:none;display:inline-flex;align-items:center;color:inherit}
/* 计数徽章：取代「标签 + 裸数字」（旧样式在 4 位数时把整条导航撑得很难看）。
   小胶囊 + 紧凑记数（4407 → 4.4k，悬停看精确值）+ 选中态实心 + 数值变化弹一下。 */
.dsh-memory-nav-count{margin-left:auto;flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;box-sizing:border-box;padding:0 6px;border-radius:var(--m-r-pill);background:var(--m-count-bg);color:var(--m-text-3);font-size:var(--m-fs-caption);font-weight:600;line-height:18px;letter-spacing:.2px;font-variant-numeric:tabular-nums;transition:background .18s cubic-bezier(.2,.8,.2,1),color .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease}
.dsh-memory-nav-count-zero{min-width:16px;padding:0 4px;background:transparent;color:var(--m-text-3);opacity:.55;font-weight:500}
.dsh-memory-nav-count-pop{animation:dsh-memory-count-pop .3s cubic-bezier(.2,.8,.2,1)}
@keyframes dsh-memory-count-pop{0%{transform:scale(.72);opacity:.25}55%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}
/* 行内用法（详情区小节标题）：不顶到行尾 */
.dsh-memory-nav-count-inline{margin-left:0}
/* 「更多分类」的展开箭头不是计数，别套胶囊 */
@media (prefers-reduced-motion:reduce){.dsh-memory-nav-count-pop{animation:none}}
/* 二级布局：导航行占满首行，项目 / 分类各起新行；胶囊更小更轻 */
.dsh-memory-cat-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--dot,#5b8def)}

/* ── 顶栏：搜索框 + 统计 + 关闭 ───────────────────────────────────── */
.dsh-memory-top-search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);display:inline-flex;color:var(--m-text-3);pointer-events:none}
.dsh-memory-top-kbd{position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:var(--m-r-chip);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--m-text-3);font-size:var(--m-fs-caption);line-height:16px}
.dsh-memory-top-stats{display:flex;align-items:center;gap:var(--m-sp-2);margin-left:auto;font-size:var(--m-fs-body);line-height:20px;color:var(--m-text-2);white-space:nowrap}
.dsh-memory-top-stat{display:inline-flex;align-items:center;gap:var(--m-sp-1);font-variant-numeric:tabular-nums}
/* 统计行图标：中性二级字色（2026-10 色彩收敛，去掉内联金星/蓝灯泡） */
.dsh-memory-top-stat-icon{display:inline-flex;align-items:center;color:var(--m-text-2)}
.dsh-memory-top-stat .dsh-memory-top-stat-val{font-weight:600;color:var(--m-text)}
.dsh-memory-top-stat-sep{color:var(--m-text-3);font-size:var(--m-fs-meta)}

/* ── 筛选行 ───────────────────────────────────────────────────────── */
.dsh-memory-filter-select{height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:var(--m-r-card);padding:0 30px 0 12px;font-size:var(--m-fs-body);line-height:20px;font-family:inherit;color:var(--m-text);background-color:var(--dsw-alias-bg-layer-1,#fff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:12px 12px;appearance:none;cursor:pointer;max-width:230px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-filter-select:hover{border-color:color-mix(in srgb,var(--m-text-3) 55%,transparent)}
.dsh-memory-filter-select:focus,.dsh-memory-filter-select:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-tool-btn{flex:none;display:inline-flex;align-items:center;gap:var(--m-sp-2);height:32px;padding:0 12px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:var(--m-r-ctrl);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--m-text-2);font-size:var(--m-fs-body);font-weight:500;line-height:19px;font-family:inherit;cursor:pointer;transition:border-color .14s ease,color .14s ease,background .14s ease,transform .12s ease}
.dsh-memory-tool-btn:hover:not(:disabled){border-color:var(--m-primary);color:var(--m-primary);background:var(--m-card-bg-sel)}
.dsh-memory-tool-btn:active:not(:disabled){transform:scale(.97)}
.dsh-memory-tool-btn:disabled{opacity:.45;cursor:default}
.dsh-memory-tool-btn-icon{width:30px;padding:0;justify-content:center}
.dsh-memory-tool-btn-danger:hover:not(:disabled){border-color:var(--m-err);color:var(--m-err);background:var(--m-err-bg)}

/* ══ 主区：记忆流（2026-10 重做）═════════════════════════════════════
   旧设计是「左列表 + 右详情」双栏 —— 那是给 500 条数据做的。实测库里只有
   十几条，右栏常驻一张空详情，左栏宽度还被固定 420px 锁死。
   新设计：列表本身承载全部信息（内容预览 + 元信息 + 操作），详情改为
   「选中后在流内就地展开」，窄屏也不打架。 */

/* ── 主区容器 ──────────────────────────────────────────────────────── */
.dsh-memory-main-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
/* cols 不再是双栏，而是「单列流 + 可选侧详情」的容器。
   保留 .dsh-memory-cols 这个类名是因为 Panel.tsx 的结构没改，
   只把 flex-direction 变成列、并允许换行（详情放不下时下移）。 */
.dsh-memory-cols{flex:1;min-height:0;display:flex;align-items:stretch;box-sizing:border-box;overflow:hidden}
/* 列表列：占满可用宽度，自己滚。内边距左右 20px 给卡片呼吸。 */
.dsh-memory-list-col{
  flex:1;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;
  min-height:0;overflow-y:auto;overflow-x:hidden;
  background:transparent;border-right:none;
  padding:2px 20px 28px;
  scrollbar-gutter:stable;
}
/* 详情列：只在选中条目时出现，宽度收窄到 380px（原来 flex:1 吃满剩余空间，
   在宽屏上会把列表压成一条）。带左侧描边 + 极轻底色，视觉上「贴在流旁边」。 */
.dsh-memory-detail-col{
  flex:none;width:380px;min-width:0;box-sizing:border-box;
  overflow-y:auto;
  background:color-mix(in srgb,var(--m-text-3) 3%,var(--dsw-alias-bg-layer-1,#fff));
  border-left:1px solid var(--m-border);
}
.dsh-memory-view-full{flex:1;min-height:0;overflow-y:auto;background:transparent;display:flex;flex-direction:column;box-sizing:border-box;padding-bottom:24px}

/* ── 列表头部工具条 ────────────────────────────────────────────────── */
/* 不再是「密排的一行按钮」，改成左侧计数 + 右侧操作组的松散排布。
   高度从 42 降到 auto，让它在内容少时不占视觉重量。 */
.dsh-memory-list-head{
  flex:none;display:flex;align-items:center;gap:var(--m-sp-2);
  padding:10px 0 12px;flex-wrap:wrap;
}
.dsh-memory-list-head-text{font-size:var(--m-fs-meta);line-height:18px;color:var(--m-text-3);font-variant-numeric:tabular-nums;letter-spacing:.01em}
/* 排序钮：弱化成纯文字，去掉按钮底色（它在工具条里是次要动作）。 */
.dsh-memory-list-sort{
  flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:26px;padding:0 8px;border:none;border-radius:var(--m-r-ctrl);
  background:transparent;color:var(--m-text-3);font-family:inherit;
  font-size:var(--m-fs-meta);line-height:16px;white-space:nowrap;cursor:pointer;
  transition:background .16s ease,color .16s ease;
}
.dsh-memory-list-sort:hover{background:var(--m-hover);color:var(--m-text-2)}
.dsh-memory-list-sort:active{transform:scale(.96)}
.dsh-memory-proj-context{
  flex:none;display:flex;align-items:center;gap:var(--m-sp-2);flex-wrap:wrap;
  margin:0 0 12px;padding:9px 12px;
  border:1px solid var(--m-border);border-radius:var(--m-r-ctrl);
  background:var(--m-soft);
}
.dsh-memory-proj-name{display:inline-flex;align-items:center;gap:6px;max-width:100%;font-size:var(--m-fs-meta);font-weight:600;line-height:18px;color:var(--m-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 分组标题：从「实心粗标题」退成「细横线 + 小字」，让卡片本身成为主角。 */
.dsh-memory-group-section{
  display:flex;align-items:center;gap:var(--m-sp-2);
  margin:14px 0 9px;font-size:var(--m-fs-caption);font-weight:600;
  line-height:16px;color:var(--m-text-3);
  letter-spacing:.05em;text-transform:uppercase;
  animation:dsh-memory-section-in .26s cubic-bezier(.2,.8,.2,1) both;
}
/* 标题后的那条延伸细线：把「分组」这件事用留白 + 线条表达，而不是靠字重。 */
.dsh-memory-group-section::after{content:"";flex:1;height:1px;background:var(--m-border);margin-left:2px}
.dsh-memory-group-section-count{font-variant-numeric:tabular-nums;font-weight:500;color:var(--m-text-3);opacity:.8}
/* 待确认分组标题：暖色，与卡片底色呼应，扫读时先看到「这里要处理」。 */
.dsh-memory-group-section[data-tone="warn"]{color:var(--m-warn)}
@keyframes dsh-memory-section-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

/* ── 记忆卡片（重做核心）─────────────────────────────────────────────
   结构与旧版的关键差别：
   · 旧：图标 + 单行标题 + 摘要 + 时间，是一张「文件列表项」。
   · 新：左侧竖轨（类型点 + 命中热力条）+ 右上元信息徽章 + 正文预览，
     是一张「记忆卡」。热力条是全新信息维度——旧版完全看不出哪些记忆
     真的在被唤醒、哪些写进去就再没人用过。
   · 卡片间距 9px（旧 6px），留白换呼吸感：数据量小，不必挤。 */
/* 卡片：改为 flex 列 + 左轨绝对定位。
   为什么放弃 grid：grid 里 grid-row:1/-1 的项在 align-self:stretch 下
   仍按内容高度撑，实测 rail 只拿到 31px（卡片 155px），热力条被压成一小截。
   relative + absolute 的组合不依赖网格推导，高度必然贴满。 */
.dsh-memory-entry-card{
  position:relative;display:flex;flex-direction:column;
  gap:0;
  box-sizing:border-box;margin:0 0 9px;padding:13px 15px 12px 35px;
  border:1px solid var(--m-card-line);border-radius:var(--m-r-card);
  background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;
  text-align:left;font-family:inherit;color:inherit;width:100%;
  transition:border-color .18s cubic-bezier(.2,.8,.2,1),
             box-shadow .18s cubic-bezier(.2,.8,.2,1),
             background .18s cubic-bezier(.2,.8,.2,1),
             transform .18s cubic-bezier(.2,.8,.2,1);
  animation:dsh-memory-entry-in .34s cubic-bezier(.2,.8,.2,1) both;
}
/* 逐条错峰浮现：靠 nth-child 而非内联 delay（不污染 DOM 属性）。
   上限截到 8 条，再多就看不出错峰、只剩整体变慢。 */
.dsh-memory-entry-card:nth-child(1){animation-delay:0ms}
.dsh-memory-entry-card:nth-child(2){animation-delay:26ms}
.dsh-memory-entry-card:nth-child(3){animation-delay:52ms}
.dsh-memory-entry-card:nth-child(4){animation-delay:78ms}
.dsh-memory-entry-card:nth-child(5){animation-delay:104ms}
.dsh-memory-entry-card:nth-child(6){animation-delay:130ms}
.dsh-memory-entry-card:nth-child(7){animation-delay:156ms}
.dsh-memory-entry-card:nth-child(n+8){animation-delay:182ms}
.dsh-memory-entry-card:hover{border-color:var(--m-border-2);box-shadow:var(--m-shadow);transform:translateY(-1px)}
.dsh-memory-entry-card-sel,.dsh-memory-entry-card-sel:hover{
  border-color:var(--m-accent-line);background:var(--m-card-bg-sel);
  box-shadow:var(--m-shadow);
}
@keyframes dsh-memory-entry-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* 顶部行：类型点（左轨顶部）+ 元信息徽章。标题单行省略，保留 title 兜底。 */
.dsh-memory-entry-top{display:flex;align-items:center;gap:var(--m-sp-2);min-width:0;align-self:stretch;max-width:100%;}
.dsh-memory-entry-icon{flex:none;display:inline-flex;align-items:center;color:var(--m-text-3);transition:color .18s ease,transform .18s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-entry-card:hover .dsh-memory-entry-icon{color:var(--m-primary);transform:scale(1.1)}
.dsh-memory-entry-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--m-fs-title);font-weight:600;line-height:1.4;color:var(--m-text);letter-spacing:-.005em}
/* 作用域徽章：极轻的胶囊，不抢标题。 */
.dsh-memory-entry-chip{
  flex:none;display:inline-flex;align-items:center;gap:4px;max-width:96px;
  padding:1.5px 7px;border-radius:var(--m-r-pill);
  background:var(--m-side);color:var(--m-text-3);
  font-size:var(--m-fs-caption);line-height:15px;font-weight:500;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.dsh-memory-entry-chip svg{flex:none;opacity:.75}
/* 多选圆点：描边改细、尺寸收小，与整体轻量化一致。 */
.dsh-memory-entry-check{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:17px;height:17px;box-sizing:border-box;
  border:1.5px solid var(--m-border-2);border-radius:50%;
  background:transparent;color:#fff;
  transition:border-color .16s ease,background .16s ease,transform .16s cubic-bezier(.2,.8,.2,1);
}
.dsh-memory-entry-check-on,.dsh-memory-entry-check-on:hover{border-color:var(--m-primary);background:var(--m-primary)}
.dsh-memory-entry-card-sel .dsh-memory-entry-check{border-color:var(--m-primary);background:var(--m-primary)}
/* 正文预览：3 行（旧 2 行）。记忆是长文本，多一行能多带一个语义单元；
   行高 1.62 而非固定 18px —— 中文长句靠行高才读得下去。 */
.dsh-memory-entry-snippet{
  margin-top:6px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
  font-size:var(--m-fs-body);line-height:1.62;color:var(--m-text-2);
  white-space:pre-wrap;word-break:break-word;
}
/* 底部行：时间 + 状态点。去掉原来的实心蓝点（它传达不了任何信息），
   改成「最近命中」相关的状态指示。 */
.dsh-memory-entry-foot{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-3);}
.dsh-memory-entry-dot{flex:none;width:4px;height:4px;border-radius:50%;background:var(--m-text-3);opacity:.55}
.dsh-memory-entry-time{white-space:nowrap}

/* ── 2026-10 重做新增：左轨 / 徽章 / 悬浮操作组 ─────────────────────── */
/* 左轨：卡片左侧 20px 宽的竖条容器，上端类型点、下端命中热力条。
   它是 grid 的第一列（卡片是 grid-template-columns:20px 1fr）。 */
/* 左轨：卡片是 grid（20px + 1fr），轨道默认只占第 1 行（高度=28px），
   热力条会被压成一小截。grid-row:1/-1 让它跨满所有行，才能真正「竖起来」。 */
/* 左轨：绝对定位贴左边缘，上下留 12px 内缩，高度必然撑满卡片。 */
.dsh-memory-entry-rail{
  position:absolute;left:12px;top:13px;bottom:12px;width:14px;
  display:flex;flex-direction:column;align-items:center;gap:6px;
}
/* 类型点：只表示「这条是什么类型」，颜色克制到三档——
   偏好=主色（用户给的行为指令，最该被看见）、事实=次文字色、踩坑=错误色。 */
.dsh-memory-entry-kind-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--m-text-3);transition:transform .18s cubic-bezier(.2,.8,.2,1),background .18s ease}
.dsh-memory-entry-card[data-kind="preference"] .dsh-memory-entry-kind-dot{background:var(--m-primary)}
.dsh-memory-entry-card[data-kind="fact"] .dsh-memory-entry-kind-dot{background:var(--m-text-2)}
.dsh-memory-entry-card[data-kind="gotcha"] .dsh-memory-entry-kind-dot{background:var(--m-err)}
.dsh-memory-entry-card:hover .dsh-memory-entry-kind-dot{transform:scale(1.3)}
/* 命中热力条：竖向，越长说明越常被注入到对话里。
   高度用 --h（0-5）× 20% 控制，切换数据时 400ms 缓动生长。 */
.dsh-memory-entry-heat{position:relative;width:3px;flex:1 1 auto;min-height:12px;border-radius:2px;background:color-mix(in srgb,var(--m-text-3) 16%,transparent);overflow:hidden}
.dsh-memory-entry-heat i{position:absolute;bottom:0;left:0;right:0;display:block;border-radius:2px;background:var(--m-primary);height:calc(var(--h,0) * 20%);opacity:.7;transition:height .4s cubic-bezier(.2,.8,.2,1),opacity .18s ease}
.dsh-memory-entry-card:hover .dsh-memory-entry-heat i{opacity:1}
/* 待确认徽章：暖色，与卡片整体底色呼应。 */
.dsh-memory-entry-pend-badge{flex:none;display:inline-flex;align-items:center;padding:1px 7px;border-radius:var(--m-r-pill);background:var(--m-warn-bg);color:var(--m-warn);font-size:var(--m-fs-caption);line-height:16px;font-weight:600;white-space:nowrap}
/* 重要度徽章：极淡，只在扫读时提供「这条多重要」的量感。 */
.dsh-memory-entry-imp-badge{flex:none;display:inline-flex;align-items:center;padding:1px 7px;border-radius:var(--m-r-pill);background:var(--m-primary-chip);color:var(--m-primary);font-size:var(--m-fs-caption);line-height:16px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
/* 标签行：底部时间后面的 #tag，弱到几乎只是纹理。 */
.dsh-memory-entry-tags{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden}
.dsh-memory-entry-tag{font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-3);white-space:nowrap;opacity:.85}
/* 悬浮操作组：默认透明且不可点（pointer-events:none），悬浮/聚焦才浮现。
   待确认卡片例外——它的两个动作常显，由 .dsh-memory-entry-card-pend 覆盖。 */
.dsh-memory-entry-actions{display:flex;gap:5px;margin-top:9px;opacity:0;transform:translateY(-3px);pointer-events:none;transition:opacity .16s ease,transform .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-entry-card:hover .dsh-memory-entry-actions,.dsh-memory-entry-card:focus-within .dsh-memory-entry-actions,.dsh-memory-entry-card-pend .dsh-memory-entry-actions{opacity:1;transform:none;pointer-events:auto}
.dsh-memory-entry-action{display:inline-flex;align-items:center;justify-content:center;padding:3px 9px;border:1px solid var(--m-border-2);border-radius:var(--m-r-ctrl);background:transparent;color:var(--m-text-2);font-size:var(--m-fs-caption);line-height:16px;font-weight:500;white-space:nowrap;cursor:pointer;user-select:none;transition:background .14s ease,color .14s ease,border-color .14s ease,transform .14s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-entry-action:hover{background:var(--m-hover);color:var(--m-text);transform:translateY(-1px)}
.dsh-memory-entry-action:active{transform:translateY(0) scale(.97)}
.dsh-memory-entry-action:focus-visible{outline:2px solid var(--m-primary);outline-offset:1px}
.dsh-memory-entry-action-pri{background:var(--m-primary);border-color:var(--m-primary);color:var(--m-on-primary)}
.dsh-memory-entry-action-pri:hover{background:var(--m-primary-hover);border-color:var(--m-primary-hover);color:var(--m-on-primary)}
.dsh-memory-entry-action-danger:hover{background:var(--m-err-bg);border-color:color-mix(in srgb,var(--m-err) 35%,transparent);color:var(--m-err)}
/* 待确认卡片：暖色底 + 暖色描边，在流里一眼可辨。 */
.dsh-memory-entry-card-pend{background:color-mix(in srgb,var(--m-warn) 4%,var(--dsw-alias-bg-layer-1,#fff));border-color:color-mix(in srgb,var(--m-warn) 22%,transparent)}
.dsh-memory-entry-card-pend:hover{border-color:color-mix(in srgb,var(--m-warn) 40%,transparent)}
@media (prefers-reduced-motion: reduce){
  .dsh-memory-entry-card,.dsh-memory-entry-card:hover,.dsh-memory-entry-action,.dsh-memory-entry-action:hover{transform:none}
  .dsh-memory-entry-card,.dsh-memory-entry-kind-dot,.dsh-memory-entry-heat i,.dsh-memory-entry-actions{animation:none;transition:none}
}

/* ── 紧凑行（时间分组内）───────────────────────────────────────────
   重做后它不再是一条「细线」，而是一张低配版卡片：左侧保留类型色条，
   但去掉大卡片的正文预览，只留标题 + 元信息。区别靠密度而非样式族。 */
.dsh-memory-entry-row{
  position:relative;overflow:hidden;display:flex;align-items:center;gap:var(--m-sp-2);
  width:100%;min-width:0;box-sizing:border-box;margin:0 0 3px;
  padding:9px 12px;border:1px solid transparent;border-radius:var(--m-r-ctrl);
  background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer;
  transition:background .16s cubic-bezier(.2,.8,.2,1),border-color .16s ease;
}
.dsh-memory-entry-row::before{
  content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:3px;height:0;border-radius:0 2px 2px 0;background:var(--m-primary);
  transition:height .2s cubic-bezier(.2,.8,.2,1);
}
.dsh-memory-entry-row:hover{background:var(--m-hover);border-color:var(--m-border)}
.dsh-memory-entry-row:hover::before{height:60%}
.dsh-memory-entry-row-sel,.dsh-memory-entry-row-sel:hover{background:var(--m-primary-soft);border-color:var(--m-accent-line)}
.dsh-memory-entry-row-sel::before{height:72%}
.dsh-memory-entry-row-icon{flex:none;display:inline-flex;align-items:center;color:var(--m-text-3)}
.dsh-memory-entry-row-sel .dsh-memory-entry-row-icon{color:var(--m-primary)}
.dsh-memory-entry-row .dsh-memory-entry-title{font-weight:500;font-size:var(--m-fs-body)}
.dsh-memory-entry-row-sel .dsh-memory-entry-title{color:var(--m-primary);font-weight:600}
.dsh-memory-entry-row .dsh-memory-entry-check{width:16px;height:16px}
.dsh-memory-entry-row-sel .dsh-memory-entry-check{border-color:var(--m-primary);background:var(--m-primary)}
.dsh-memory-entry-row:active{transform:scale(.995)}

/* ── 右栏详情 ────────────────────────────────────────────────────────
   宽度收窄到 380 后，内边距从 18/22 收到 16/18；标题字号降一档，
   因为在这个宽度里 22px 的标题会频繁换行成三行。 */

/* ── 右栏详情（重做：宽度收窄到 380 后的适配）───────────────────────
   旧版按 flex:1 的宽栏设计，22px 内边距 + 22px 标题字号。
   收窄到固定宽度后：内边距降到 16/18，标题降一档，避免频繁换行。 */
/* ── 右栏详情（第二轮重做）───────────────────────────────────────────
   旧版是「标题 + chips + 重要度 + 正文 + 标签 + 关联 + 历史 + 相关」一条竖线
   平铺下来，所有信息权重相同 —— 扫一眼分不清哪里是「这条记忆讲了什么」、
   哪里是「它的元数据」。新版按三层组织：
     ① 头部（标题 + 操作）—— 粘在顶部，滚动正文时始终可见
     ② 概要（chips + 重要度 + 命中）—— 一条紧凑信息带
     ③ 正文（阅读区）—— 最大的视觉权重给它
   元数据块（关联 / 历史 / 相关）统一用小节标题分隔，不再与正文平权。 */
.dsh-memory-detail-col{padding:0;display:flex;flex-direction:column;gap:0;box-sizing:border-box}
/* 详情主容器：padding 放在这里，粘性头部用负 margin 顶出去再贴回来。 */
.dsh-memory-detail-anim{
  animation:dsh-memory-detail-in .24s cubic-bezier(.2,.8,.2,1) both;
  display:flex;flex-direction:column;gap:14px;min-width:0;
  padding:16px 18px 44px;box-sizing:border-box;
}
@keyframes dsh-memory-detail-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}
/* 头部：吸顶。滚动长正文时标题与操作始终可见——
   旧版滚下去就找不到「编辑」「删除」在哪了。 */
.dsh-memory-detail-head{
  display:flex;align-items:flex-start;gap:10px;
  position:sticky;top:0;z-index:2;
  margin:-16px -18px 0;padding:16px 18px 12px;
  background:linear-gradient(
    to bottom,
    color-mix(in srgb,var(--m-text-3) 3%,var(--dsw-alias-bg-layer-1,#fff)) 78%,
    transparent
  );
}
/* 标题：从 16px 提到 17px 并加字重，它是详情里唯一的一级信息。 */
.dsh-memory-detail-title{
  flex:1;min-width:0;margin:0;
  font-size:17px;line-height:1.42;font-weight:680;
  color:var(--m-text);word-break:break-word;letter-spacing:-.01em;
}
.dsh-memory-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:var(--m-fs-meta);line-height:18px}
/* chip 统一成胶囊（旧版是 6px 圆角小方块，与卡片圆角体系不协调）*/
.dsh-memory-chip-mute{display:inline-flex;align-items:center;gap:4px;max-width:200px;padding:1.5px 8px;border-radius:var(--m-r-pill);background:var(--m-side);color:var(--m-text-2);font-size:var(--m-fs-caption);line-height:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-chip-accent{display:inline-flex;align-items:center;gap:4px;padding:1.5px 8px;border-radius:var(--m-r-pill);background:var(--m-primary-chip);color:var(--m-primary);font-size:var(--m-fs-caption);line-height:16px;font-weight:500;white-space:nowrap}
.dsh-memory-chip-warn{display:inline-flex;align-items:center;gap:4px;padding:1.5px 8px;border-radius:var(--m-r-pill);background:var(--m-warn-bg);color:var(--m-warn);font-size:var(--m-fs-caption);line-height:16px;font-weight:500;white-space:nowrap}
.dsh-memory-chip-time{margin-left:auto;font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-3);white-space:nowrap}
/* 可点击 chip：静态标签会被当成装饰，加 hover 反馈说明「它可以点」。 */
.dsh-memory-chip-ok-btn,.dsh-memory-chip-mute-btn{display:inline-flex;align-items:center;gap:4px;padding:1.5px 8px;border-radius:var(--m-r-pill);font-size:var(--m-fs-caption);line-height:16px;font-weight:500;white-space:nowrap;border:0;cursor:pointer;font-family:inherit;transition:background .16s ease,color .16s ease,transform .12s ease,box-shadow .16s ease}
.dsh-memory-chip-ok-btn{background:var(--m-ok-bg);color:var(--m-ok)}
.dsh-memory-chip-mute-btn{background:var(--m-side);color:var(--m-text-2)}
.dsh-memory-chip-ok-btn:hover{box-shadow:0 0 0 1px var(--m-ok) inset}
.dsh-memory-chip-mute-btn:hover{background:var(--m-hover);color:var(--m-text)}
.dsh-memory-chip-ok-btn:active,.dsh-memory-chip-mute-btn:active{transform:scale(.96)}
.dsh-memory-chip-ok-btn:focus-visible,.dsh-memory-chip-mute-btn:focus-visible{outline:2px solid var(--m-primary);outline-offset:1px}
@media (prefers-reduced-motion: reduce){.dsh-memory-chip-ok-btn,.dsh-memory-chip-mute-btn{transition:none}.dsh-memory-chip-ok-btn:active,.dsh-memory-chip-mute-btn:active{transform:none}}
/* 重要度行：从「一块灰底卡片」退成「一条无底的行」，减少框套框。 */
/* 重要度信息带：从「一行散落的数字」做成一条有底色的紧凑信息条。
   旧版是裸文字 + 进度条，混在正文里像段落；加一层极浅底色后，
   它自己成为一个可扫读的「元数据块」。 */
.dsh-memory-importance-row{
  display:flex;align-items:center;gap:9px;flex-wrap:wrap;
  padding:9px 12px;
  border-radius:var(--m-r-ctrl);
  background:color-mix(in srgb,var(--m-text-3) 5%,transparent);
}
.dsh-memory-importance-icon{flex:none;display:inline-flex;align-items:center;color:var(--m-text-3)}
.dsh-memory-importance-label{font-size:var(--m-fs-meta);line-height:18px;color:var(--m-text-3)}
.dsh-memory-importance-bar{position:relative;flex:none;width:72px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--m-text-3) 18%,transparent);overflow:hidden}
.dsh-memory-importance-bar i{position:absolute;top:0;bottom:0;left:0;display:block;border-radius:2px;background:var(--m-primary);transition:width .4s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-importance-value{font-variant-numeric:tabular-nums;font-size:var(--m-fs-meta);line-height:18px;font-weight:600;color:var(--m-text-2)}
.dsh-memory-importance-row .dsh-memory-top-stat-sep{margin:0 2px}
/* 正文：行高 1.7，中文长句靠行高才读得下去。 */
/* 正文：整块的最大视觉权重给它。行高 1.72 + 段落间距，中文长文才读得下去。 */
.dsh-memory-detail-body{min-width:0;font-size:var(--m-fs-body);line-height:1.72;color:var(--m-text);word-break:break-word}
.dsh-memory-detail-body p{margin:0 0 10px}
.dsh-memory-detail-body p:last-child{margin-bottom:0}
.dsh-memory-detail-body > *{max-width:68ch}
.dsh-memory-detail-body{max-width:100%}
.dsh-memory-detail-tags{display:flex;flex-wrap:wrap;gap:6px;padding-top:12px;border-top:1px solid var(--m-border)}
.dsh-memory-detail-foot{display:flex;align-items:center;gap:var(--m-sp-2);flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--m-border);font-size:var(--m-fs-caption);line-height:17px;color:var(--m-text-3)}
/* 小节标题：改用「小写标签 + 细线」的轻量样式，弱于正文标题。 */
.dsh-memory-section-title-lg{display:flex;align-items:center;gap:6px;font-size:var(--m-fs-caption);font-weight:600;line-height:16px;color:var(--m-text-3);letter-spacing:.05em;text-transform:uppercase;margin-top:10px}
.dsh-memory-section-title-lg::after{content:"";flex:1;height:1px;background:var(--m-border)}
.dsh-memory-section-line{display:none}
.dsh-memory-stat{display:inline-flex;align-items:center;gap:5px;font-size:var(--m-fs-meta);line-height:18px;color:var(--m-text-3);white-space:nowrap}
.dsh-memory-stat-value{font-variant-numeric:tabular-nums;font-weight:600;color:var(--m-text-2)}
.dsh-memory-stat-dot{flex:none;width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.5}
/* 关联卡：两列网格在 380px 宽度里会挤，改成 1 列。 */
.dsh-memory-relation-grid{display:grid;grid-template-columns:1fr;gap:6px}
.dsh-memory-relation-card{display:flex;flex-direction:column;gap:3px;padding:9px 11px;border:1px solid var(--m-border);border-radius:var(--m-r-ctrl);box-sizing:border-box;background:transparent;transition:border-color .16s ease,background .16s ease}
.dsh-memory-relation-card:hover{border-color:var(--m-border-2);background:var(--m-hover)}
.dsh-memory-relation-label{font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-3)}
.dsh-memory-relation-main{display:flex;align-items:center;gap:6px;min-width:0;font-size:var(--m-fs-body);font-weight:600;line-height:19px;color:var(--m-text)}
.dsh-memory-relation-sub{font-size:var(--m-fs-caption);line-height:17px;color:var(--m-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-memory-history-list{display:flex;flex-direction:column;gap:8px}
.dsh-memory-history-row{display:grid;grid-template-columns:56px 1fr;gap:var(--m-sp-2);align-items:baseline}
.dsh-memory-history-time{font-size:var(--m-fs-caption);line-height:17px;color:var(--m-text-3);white-space:nowrap;font-variant-numeric:tabular-nums}
.dsh-memory-history-desc{min-width:0;font-size:var(--m-fs-meta);line-height:18px;color:var(--m-text-2);word-break:break-word}
.dsh-memory-history-link{display:inline-flex;align-items:center;gap:4px;margin-top:5px;padding:0;border:none;background:transparent;font-family:inherit;font-size:var(--m-fs-meta);line-height:18px;color:var(--m-primary);cursor:pointer;transition:opacity .16s ease}
.dsh-memory-history-link:hover{opacity:.7;text-decoration:underline}
.dsh-memory-change-more{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin:10px 0 2px;padding:8px 12px;box-sizing:border-box;border:1px solid var(--m-border);border-radius:var(--m-r-ctrl);background:transparent;color:var(--m-text-3);font-family:inherit;font-size:var(--m-fs-meta);line-height:18px;cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease}
.dsh-memory-change-more:hover{border-color:var(--m-border-2);color:var(--m-text-2);background:var(--m-hover)}
.dsh-memory-change-more:active{transform:translateY(1px)}
.dsh-memory-change-more[disabled]{opacity:.5;cursor:default;transform:none}
/* 相关记忆卡：3 列在 380px 里放不下，改 1 列。 */
.dsh-memory-related-grid{display:grid;grid-template-columns:1fr;gap:6px}
.dsh-memory-related-card{position:relative;display:flex;flex-direction:column;gap:2px;padding:9px 11px;border:1px solid var(--m-border);border-radius:var(--m-r-ctrl);box-sizing:border-box;background:transparent;cursor:pointer;text-align:left;font-family:inherit;transition:border-color .16s ease,background .16s ease}
.dsh-memory-related-card:hover{border-color:var(--m-border-2);background:var(--m-hover)}
.dsh-memory-related-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--m-fs-meta);font-weight:600;line-height:18px;color:var(--m-text)}
.dsh-memory-related-sub{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-3)}
.dsh-memory-related-arrow{position:absolute;top:8px;right:9px;color:var(--m-text-3);opacity:0;transition:opacity .16s ease,color .16s ease}
.dsh-memory-related-card:hover .dsh-memory-related-arrow{opacity:.9;color:var(--m-primary)}

/* ── 通用 chip（详情标签筛选行沿用） ──────────────────────────────── */
.dsh-memory-chip{flex:none;display:inline-flex;align-items:center;padding:1px 7px;font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-2);border:1px solid var(--m-border-2);border-radius:var(--m-r-chip);background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;font-family:inherit;transition:color .14s ease,border-color .14s ease,background .14s ease}
.dsh-memory-chip:hover{color:var(--m-primary);border-color:var(--m-primary)}
.dsh-memory-chip-active,.dsh-memory-chip-active:hover{color:var(--m-primary);border-color:var(--m-primary);background:var(--m-primary-chip)}

/* ── 图标钮 ───────────────────────────────────────────────────────── */
.dsh-memory-card-actions{flex:none;display:flex;align-items:center;gap:var(--m-sp-1);margin-left:auto}
.dsh-memory-icon-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:var(--m-r-ctrl);padding:0;background:transparent;cursor:pointer;color:var(--m-text-2);box-sizing:border-box;transition:background .14s ease,color .14s ease,transform .12s ease}
.dsh-memory-icon-action:hover:not(:disabled){background:var(--m-hover);color:var(--m-text)}
.dsh-memory-icon-action:active:not(:disabled){transform:scale(.93)}
.dsh-memory-icon-action:disabled{opacity:.4;cursor:default}
.dsh-memory-icon-action-danger:hover:not(:disabled){background:var(--m-err-bg);color:var(--m-err)}
@keyframes dsh-memory-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}

/* ── 空态 ─────────────────────────────────────────────────────────── */
.dsh-memory-empty{flex:1;min-height:120px;margin:16px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--m-sp-2);font-size:var(--m-fs-body);line-height:20px;color:var(--m-text-3);text-align:center;border:1px dashed var(--m-border-2);border-radius:var(--m-r-card);box-sizing:border-box}
.dsh-memory-empty-icon{display:inline-flex;color:var(--m-text-3);opacity:.75}
.dsh-memory-empty-text{color:var(--m-text-2)}
.dsh-memory-empty-hint{font-size:var(--m-fs-meta);line-height:18px;color:var(--m-text-3);max-width:420px}

/* ── 变更 / 修订（全宽列表） ──────────────────────────────────────── */
.dsh-memory-card-list{flex:1;min-height:0;list-style:none;margin:0;padding:16px;display:flex;flex-direction:column;gap:var(--m-sp-2);overflow-y:auto}
.dsh-memory-change-row{display:flex;align-items:flex-start;gap:var(--m-sp-3);border:1px solid var(--m-border-2);border-radius:var(--m-r-card);padding:12px 14px;background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
/* 「查看」按钮：变更行末尾的跳转入口。默认低对比度（不抢内容的注意力），
   hover 才提亮 —— 它是次要动作，但必须存在，否则变更与条目是两个死胡同。 */
/* 右栏留白态：列表为空/未选中时的最低限度说明。刻意做得比正式空态盒更轻
   （无边框、无背景），它是留白而不是一块内容，但也不是「什么都没有」。 */
.dsh-memory-change-row:hover{border-color:var(--m-accent-line)}
.dsh-memory-change-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--m-sp-2)}
.dsh-memory-change-badge{flex:none;margin-top:2px;padding:1px 7px;border:1px solid var(--m-border-2);border-radius:var(--m-r-chip);font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-2);white-space:nowrap}
.dsh-memory-change-badge-add{border-color:var(--m-ok);color:var(--m-ok);background:var(--m-ok-bg)}
.dsh-memory-change-badge-promote{border-color:var(--m-warn);color:var(--m-warn);background:var(--m-warn-bg)}
.dsh-memory-change-badge-delete{border-color:var(--m-err);color:var(--m-err);background:var(--m-err-bg)}
.dsh-memory-change-badge-revise{border-color:var(--m-info);color:var(--m-info);background:var(--m-info-bg)}
.dsh-memory-change-badge-retire{border-color:var(--m-warn);color:var(--m-warn);background:var(--m-warn-bg)}
.dsh-memory-change-old{color:var(--m-text-3);text-decoration:line-through;opacity:.8}
.dsh-memory-change-new{color:var(--m-text)}
.dsh-memory-change-diff{flex:1;min-width:0;display:flex;align-items:stretch;gap:var(--m-sp-3)}
.dsh-memory-change-diff-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--m-sp-1)}
.dsh-memory-change-diff-divider{flex:none;width:1px;background:var(--m-border-2)}
.dsh-memory-card-content{min-width:0;font-size:var(--m-fs-body);line-height:20px;color:var(--m-text);white-space:pre-wrap;word-break:break-word}
.dsh-memory-card-meta{display:flex;align-items:center;gap:var(--m-sp-2);font-size:var(--m-fs-caption);line-height:16px;color:var(--m-text-3);flex-wrap:wrap}

/* ── 工具栏（变更视图段控行） ─────────────────────────────────────── */
.dsh-memory-search-row{flex:none;display:flex;align-items:center;gap:var(--m-sp-2);padding:12px 16px;border-bottom:1px solid var(--m-border);background:var(--dsw-alias-bg-layer-1,#fff)}
.dsh-memory-tag-select{height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:var(--m-r-ctrl);padding:0 30px 0 11px;font-size:var(--m-fs-body);line-height:20px;font-family:inherit;color:var(--m-text);background-color:var(--dsw-alias-bg-layer-1,#fff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:12px 12px;appearance:none;max-width:240px;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-tag-select:hover{border-color:color-mix(in srgb,var(--m-text-3) 55%,transparent)}
.dsh-memory-tag-select:focus,.dsh-memory-tag-select:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-scope-select{flex:none;max-width:190px}
.dsh-memory-bar-sep{flex:none;width:1px;height:20px;background:var(--m-border-2)}
.dsh-memory-segment{flex:none;display:inline-flex;align-items:center;gap:var(--m-sp-1);padding:2px;height:32px;box-sizing:border-box;border-radius:var(--m-r-ctrl);background:var(--m-side)}
.dsh-memory-segment-item{appearance:none;border:none;background:transparent;border-radius:var(--m-r-ctrl);height:28px;padding:0 14px;font-size:var(--m-fs-body);line-height:19px;font-family:inherit;color:var(--m-text-2);cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-memory-segment-item:hover{color:var(--m-text)}
.dsh-memory-segment-item-active,.dsh-memory-segment-item-active:hover{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--m-primary);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.dsh-memory-spacer{flex:1 1 auto;min-width:0}
.dsh-memory-batch-count{font-size:var(--m-fs-body);line-height:19px;color:var(--m-text);font-variant-numeric:tabular-nums}

/* ── 表单件（添加 / 编辑 / 移动） ─────────────────────────────────── */
.dsh-memory-detail-form{display:flex;flex-direction:column;gap:var(--m-sp-4);border-radius:var(--m-r-card);background:var(--m-side);padding:16px;box-sizing:border-box}
.dsh-memory-form-title{font-size:var(--m-fs-title);line-height:22px;font-weight:600;color:var(--m-text)}
.dsh-memory-field{display:flex;flex-direction:column;gap:var(--m-sp-2);min-width:0}
.dsh-memory-field-label{display:inline-flex;align-items:center;gap:var(--m-sp-2);font-size:var(--m-fs-meta);line-height:18px;font-weight:500;color:var(--m-text-2)}
.dsh-memory-field-row{display:flex;align-items:flex-end;gap:var(--m-sp-3);flex-wrap:wrap}
.dsh-memory-detail-form textarea,.dsh-memory-detail-form .dsh-memory-inline-input{box-sizing:border-box}
.dsh-memory-inline-input{height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:var(--m-r-ctrl);padding:0 10px;font-size:var(--m-fs-body);line-height:20px;font-family:inherit;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-inline-input::placeholder{color:var(--m-text-3)}
.dsh-memory-inline-input:focus,.dsh-memory-inline-input:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-inline-textarea{min-height:64px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:var(--m-r-ctrl);padding:8px 10px;font-size:var(--m-fs-body);line-height:20px;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);resize:vertical;font-family:inherit;width:100%;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-inline-textarea::placeholder{color:var(--m-text-3)}
.dsh-memory-inline-textarea:focus,.dsh-memory-inline-textarea:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-add-meta{display:flex;align-items:center;gap:var(--m-sp-3);flex-wrap:wrap}
.dsh-memory-check{display:inline-flex;align-items:center;gap:var(--m-sp-2);font-size:var(--m-fs-body);line-height:19px;color:var(--m-text-2);cursor:pointer}
.dsh-memory-check input{accent-color:var(--m-primary);margin:0}
.dsh-memory-edit-buttons{display:flex;align-items:center;justify-content:flex-end;gap:var(--m-sp-2)}
/* 开关走**中性黑白**，不用主题蓝。
   开 = 主文字色的实心轨道 + 反色圆点（浅色主题：黑轨白点；深色：白轨黑点），
   关 = 一层淡灰轨道 + 三级字色圆点。开合靠明暗对比说清，与卡片里的文字同一套
   色阶，不引入第二个强调色；--m-text / --m-bg 都在各主题下自动跟随。 */
.dsh-memory-switch{position:relative;flex:none;width:40px;height:22px;border:none;border-radius:var(--m-r-pill);padding:0;background:var(--dsw-alias-border-l2,rgba(0,0,0,.12));cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.dsh-memory-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--m-text-3,var(--dsw-alias-label-tertiary,#81858c));box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-switch[aria-checked='true']{background:var(--m-text,var(--dsw-alias-label-primary,#1f2329))}
.dsh-memory-switch[aria-checked='true']::after{transform:translateX(18px);background:var(--m-card-bg,var(--dsw-static-neutral-bluish-00,#fff))}
.dsh-memory-switch:disabled{opacity:.5;cursor:default}

/* ── 通知 / 错误 ──────────────────────────────────────────────────── */
.dsh-memory-error{flex:none;margin:12px 16px 0;padding:8px 12px;border-radius:var(--m-r-card);border:1px solid var(--m-err);background:var(--m-err-bg);font-size:var(--m-fs-body);line-height:19px;color:var(--m-err)}
.dsh-memory-notice{flex:none;margin:12px 16px 0;padding:8px 12px;border-radius:var(--m-r-card);border:1px solid var(--m-ok);background:var(--m-ok-bg);font-size:var(--m-fs-body);line-height:19px;color:var(--m-ok)}

/* ── 修订 / 设置 ──────────────────────────────────────────────────── */
.dsh-memory-rev-actions{display:flex;align-items:center;gap:var(--m-sp-2)}
.dsh-memory-settings-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:var(--m-sp-5)}
.dsh-memory-settings-group{display:flex;flex-direction:column;gap:var(--m-sp-1)}
.dsh-memory-settings-group-title{padding:0 2px 6px;font-size:var(--m-fs-title);font-weight:600;line-height:22px;color:var(--m-text)}
.dsh-memory-settings-row{display:flex;align-items:center;gap:var(--m-sp-3);padding:10px 14px;border:1px solid var(--m-border-2);border-radius:var(--m-r-card);box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease}
.dsh-memory-settings-row:hover{border-color:var(--m-accent-line)}
.dsh-memory-settings-row+.dsh-memory-settings-row{margin-top:6px}
.dsh-memory-settings-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--m-sp-1)}
.dsh-memory-settings-label{font-size:var(--m-fs-body);line-height:21px;font-weight:500;color:var(--m-text)}
.dsh-memory-settings-hint{font-size:var(--m-fs-meta);line-height:18px;color:var(--m-text-3)}
.dsh-memory-settings-control{flex:none;display:flex;align-items:center;gap:var(--m-sp-2)}
.dsh-memory-number-input{width:96px;height:32px;box-sizing:border-box;border:1px solid var(--m-border-2);border-radius:var(--m-r-ctrl);padding:0 10px;font-size:var(--m-fs-body);line-height:20px;font-family:inherit;font-variant-numeric:tabular-nums;color:var(--m-text);background:var(--dsw-alias-bg-layer-1,#fff);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-memory-number-input:focus,.dsh-memory-number-input:focus-visible{outline:none;border-color:var(--m-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.dsh-memory-settings-foot{display:flex;align-items:center;justify-content:flex-end;gap:var(--m-sp-2);padding-top:4px}

/* ── 骨架屏 ───────────────────────────────────────────────────────── */
.dsh-memory-skeleton{flex:1;min-height:0;display:flex;flex-direction:column;gap:var(--m-sp-2);padding:16px}
.dsh-memory-skeleton-row{height:48px;border-radius:var(--m-r-ctrl);background:var(--m-side);animation:dsh-memory-pulse 1.4s ease-in-out infinite}
.dsh-memory-skeleton-row:nth-child(2){animation-delay:.12s}
.dsh-memory-skeleton-row:nth-child(3){animation-delay:.24s}
.dsh-memory-skeleton-row:nth-child(4){animation-delay:.36s}
@keyframes dsh-memory-pulse{0%,100%{opacity:.45}50%{opacity:.9}}

/* ── 徽标（禁用 / 废弃 / 作用域） ─────────────────────────────────── */

/* ── focus 规范 ───────────────────────────────────────────────────── */
/* 注：composer 注入开关（.dsh-memory-toggle*）与它的悬浮卡片（.dsh-memory-inject-*）
   已于 2026-10-23 按用户要求整块删除，样式一并清掉。开关能力仍在——它住在大盘
   设置抽屉里（kr-chat/KrPanelSettings.tsx），用的是本文件保留的 .dsh-memory-switch。 */
.dsh-memory-tool-btn:focus-visible,.dsh-memory-icon-action:focus-visible,
.dsh-memory-entry-card:focus-visible,.dsh-memory-entry-row:focus-visible,.dsh-memory-chip:focus-visible,
.dsh-memory-related-card:focus-visible,.dsh-memory-history-link:focus-visible,.dsh-memory-change-more:focus-visible,
.dsh-memory-switch:focus-visible{
  /* 2026-10-23 顺带修掉一处历史破损：这条选择器列表原先以逗号结尾、后面直接接
     .dsh-memory-inject-card{，于是卡片样式成了这些 focus 选择器的规则体 —— 列出的
     九类元素从来没拿到过 focus 样式。卡片删掉后把规则体补成本来想要的焦点环。 */
  outline:none;
  box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent)
}

/* ── 窄屏适配 ─────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .dsh-memory-list-col{width:340px}
  .dsh-memory-related-grid{grid-template-columns:1fr}
}
@media (max-width: 900px) {
  .dsh-memory-top-stats .dsh-memory-top-stat-long{display:none}
}
/* ── 窄屏适配（2026-10 第二轮重做后重写）────────────────────────────
   旧规则的坑：它只改了 panel 和 list-col 的方向，却没管 .dsh-memory-detail-col
   上写死的 width:380px —— 于是窄屏下详情栏照样占 380px，
   列表被挤到 40px、卡片 52px、正文宽度 0（实测数据）。用户看到的就是
   「文字全被裁掉」的截图。
   现在：窄屏下详情栏改成「浮层覆盖」——不参与 flex 分配，不挤压列表。 */
@media (max-width: 900px) {
  .dsh-memory-panel{flex-direction:column}
  /* 详情栏：脱离文档流，浮在列表右侧。它只在选中条目时出现，
     用浮层不会有「关不掉」的问题（点其他条目就换内容，点空白可加关闭）。 */
  .dsh-memory-detail-col{
    position:absolute;right:0;top:0;bottom:0;z-index:5;
    width:min(380px,92vw) !important;min-width:0;
    box-shadow:-8px 0 28px rgba(0,0,0,.12);
    border-left:1px solid var(--m-border);
  }
  .dsh-memory-cols{position:relative}
  /* 列表占满整宽（详情是浮层，不占位）。 */
  .dsh-memory-list-col{width:100% !important;max-height:none;flex:1 1 auto;padding:2px 12px 20px}
  .dsh-memory-related-grid{grid-template-columns:1fr}
  .dsh-memory-relation-grid{grid-template-columns:1fr}
  /* 卡片内边距收窄，给正文更多宽度。 */
  .dsh-memory-entry-card{padding:11px 12px 10px 32px}
  .dsh-memory-entry-rail{left:10px;width:12px}
}

/* 超窄屏（手机竖屏）：搜索框与统计行改为独占一行。 */
@media (max-width: 640px) {
  /* 侧栏限高：410px 宽时 15 个条目平铺会吃掉 309px（近半屏），
     列表只剩一小条。改成横向滚动的窄带，高度锁在 96px。 */
  .dsh-memory-sidebar-nav{max-height:96px;overflow-y:hidden;overflow-x:auto;padding:6px 8px}
  .dsh-memory-sidebar-section{flex-direction:row !important;flex-wrap:nowrap !important;gap:4px !important;margin-top:0 !important}
  .dsh-memory-sidebar-item{width:auto !important;flex:none;white-space:nowrap}
  .dsh-memory-sidebar-item-count{display:none}
  .dsh-memory-top-bar{padding:10px 12px}
  .dsh-memory-view-row{flex-wrap:wrap;gap:8px;height:auto}
  .dsh-memory-search-wrap{max-width:none;flex:1 1 100%}
  .dsh-memory-top-actions{width:100%;justify-content:space-between}
  .dsh-memory-detail-col{width:100% !important;position:fixed;left:0;right:0;top:auto;bottom:0;
    height:70vh;border-radius:16px 16px 0 0;box-shadow:0 -8px 28px rgba(0,0,0,.18)}
}
@media (prefers-reduced-motion: reduce) {
  .dsh-memory-entry-card,.dsh-memory-entry-row,.dsh-memory-related-card,
  .dsh-memory-history-link,.dsh-memory-tool-btn,.dsh-memory-change-more{transition:none}
  .dsh-memory-entry-card,.dsh-memory-entry-row,.dsh-memory-group-section,.dsh-memory-detail-anim{animation:none}
  .dsh-memory-skeleton-row{animation:none}
  .dsh-memory-importance-bar i{transition:none}
}

/* ── 顶部两级工具筛选栏 ── */
.dsh-memory-top-bar{flex:none;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);border-bottom:1px solid var(--m-border);z-index:5}

/* 一级：视图分段器 + 统计 + 新增按钮 */
.dsh-memory-view-row{display:flex;align-items:center;justify-content:space-between;gap:var(--m-sp-3);height:46px;padding:0 16px;box-sizing:border-box}
.dsh-memory-view-actions{display:flex;align-items:center;gap:var(--m-sp-3)}
.dsh-memory-primary-add{display:inline-flex;align-items:center;gap:var(--m-sp-2);height:28px;padding:0 12px;border-radius:var(--m-r-ctrl);border:none;background:var(--m-primary,#3b82f6);color:var(--m-on-primary);font-size:var(--m-fs-body);font-weight:600;font-family:inherit;cursor:pointer;transition:all 140ms ease}
.dsh-memory-primary-add:hover{background:var(--m-primary-hover);box-shadow:0 2px 10px rgba(59,130,246,.35)}
.dsh-memory-primary-add:active{transform:scale(.98)}

/* 二级：搜索框 + 项目下拉 + 分类下拉与分类胶囊 Pills */
/* ── 记忆正文的轻量 Markdown（替代 webui 全量渲染器，见 markdown.tsx） ── */
.dsh-triad-md{font-size:var(--m-fs-title);line-height:1.7;color:var(--m-text);word-break:break-word}
.dsh-triad-md>*:first-child{margin-top:0}
.dsh-triad-md>*:last-child{margin-bottom:0}
.dsh-triad-md__p{margin:0 0 8px}
.dsh-triad-md__h{margin:16px 0 8px;font-weight:600;line-height:1.4}
.dsh-triad-md__h:first-child{margin-top:0}
.dsh-triad-md__list{margin:0 0 8px;padding-left:20px}
.dsh-triad-md__list li{margin:2px 0}
.dsh-triad-md__quote{margin:0 0 8px;padding:2px 0 2px 10px;border-left:2px solid var(--m-border-2);color:var(--m-text-2)}
.dsh-triad-md__code{padding:1px 5px;border-radius:var(--m-r-chip);background:var(--m-side);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
.dsh-triad-md__pre{margin:0 0 8px;padding:10px 12px;border-radius:var(--m-r-ctrl);overflow-x:auto;background:var(--m-side);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--m-fs-body);line-height:1.6;white-space:pre}
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
