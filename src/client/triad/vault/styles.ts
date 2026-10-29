/**
 * dsh-vault — 整页档案面板样式（运行时注入 style 标签，卸载时由 loader 清理）。
 *
 * ── 视觉：Vault Deck（2026-10-29 全量改版）────────────────────────────
 * 用户要求「UI 样式与布局全部改版换一套，深色模式下背景色换 #151517」。
 * 旧版是 Chrome 密码管理器式的纵向分组卡流；新版换成：
 *
 *   Hero 概览区（eyebrow + 大标题 + 统计矩阵）
 *     → 工具条（搜索 + 提醒/备份/刷新）
 *     → 场景切换条（全部 / 各场景计数）
 *     → 场景分节 + 记录卡片网格（记录详情在卡片下方跨行展开）
 *     → 底部统计条
 *
 * 配色语言：石墨底 + 冷银蓝强调（#B1B1B3）。强调色只用于「身份 / 选中 / 主操作」
 * 三处，语义色（红黄绿）只出现在真正的状态上，不做装饰。
 *
 * 深色页面底色固定 #151517（用户点名）。浅色走暖纸白 #F6F6F4。
 * 其余 token 全部由这两个底色派生，明暗两套在手写变量里各给一份。
 *
 * ⚠ 本文件的整张样式表是一个模板字面量：注释里绝对不能出现反引号，
 * 否则模板提前闭合、构建报一个与根因无关的错（build.mjs 有源码级守卫）。
 * 同时避免出现美元符加花括号的插值写法。
 */

/** 类名表（组件侧统一从这里取，避免字符串散落两处各写一遍）。 */
export const css = {
  root: 'dsh-vault',
  // ── Hero / 工具条 / 场景切换（2026-10-29 新版布局）──
  hero: 'dsh-vault-hero',
  heroMain: 'dsh-vault-hero-main',
  heroEyebrow: 'dsh-vault-hero-eyebrow',
  heroStats: 'dsh-vault-hero-stats',
  heroStat: 'dsh-vault-hero-stat',
  heroStatNum: 'dsh-vault-hero-stat-num',
  heroStatLabel: 'dsh-vault-hero-stat-label',
  toolbar: 'dsh-vault-toolbar',
  sceneTabs: 'dsh-vault-scene-tabs',
  sceneTab: 'dsh-vault-scene-tab',
  sceneTabCount: 'dsh-vault-scene-tab-count',
  rowMeta: 'dsh-vault-row-meta',
  rowMetaItem: 'dsh-vault-row-meta-item',
  // ── 旧页头键（保留给兼容与渐进迁移）──
  head: 'dsh-vault-head',
  headMain: 'dsh-vault-head-main',
  title: 'dsh-vault-title',
  hint: 'dsh-vault-hint',
  searchWrap: 'dsh-vault-search-wrap',
  searchIcon: 'dsh-vault-search-icon',
  searchInput: 'dsh-vault-search-input',
  searchClear: 'dsh-vault-search-clear',
  headActions: 'dsh-vault-head-actions',
  ghostBtn: 'dsh-vault-ghost-btn',
  scroll: 'dsh-vault-scroll',
  group: 'dsh-vault-group',
  groupHead: 'dsh-vault-group-head',
  groupIcon: 'dsh-vault-group-icon',
  groupName: 'dsh-vault-group-name',
  groupDesc: 'dsh-vault-group-desc',
  groupCount: 'dsh-vault-group-count',
  groupAdd: 'dsh-vault-group-add',
  groupBody: 'dsh-vault-group-body',
  row: 'dsh-vault-row',
  rowSel: 'dsh-vault-row-sel',
  rowIcon: 'dsh-vault-row-icon',
  rowMain: 'dsh-vault-row-main',
  rowTitle: 'dsh-vault-row-title',
  rowSub: 'dsh-vault-row-sub',
  rowTail: 'dsh-vault-row-tail',
  rowArrow: 'dsh-vault-row-arrow',
  badgeArchived: 'dsh-vault-badge-archived',
  rowCategory: 'dsh-vault-row-category',
  categoryRow: 'dsh-vault-category-row',
  categoryLabel: 'dsh-vault-category-label',
  categoryInput: 'dsh-vault-category-input',
  categoryChip: 'dsh-vault-category-chip',
  categoryChips: 'dsh-vault-category-chips',
  categoryFilter: 'dsh-vault-category-filter',
  empty: 'dsh-vault-empty',
  emptyIcon: 'dsh-vault-empty-icon',
  emptyText: 'dsh-vault-empty-text',
  emptyHint: 'dsh-vault-empty-hint',
  skeleton: 'dsh-vault-skeleton',
  skeletonRow: 'dsh-vault-skeleton-row',
  error: 'dsh-vault-error',
  errorText: 'dsh-vault-error-text',
  errorRetry: 'dsh-vault-error-retry',
  notice: 'dsh-vault-notice',
  // ── 详情面板（内容本体 + 两种外壳）──
  backdrop: 'dsh-vault-backdrop',
  modal: 'dsh-vault-modal',
  expand: 'dsh-vault-expand',
  panelHead: 'dsh-vault-panel-head',
  panelEyebrow: 'dsh-vault-panel-eyebrow',
  panelTitleInput: 'dsh-vault-panel-title-input',
  panelClose: 'dsh-vault-panel-close',
  panelBody: 'dsh-vault-panel-body',
  panelFoot: 'dsh-vault-panel-foot',
  section: 'dsh-vault-section',
  sectionHead: 'dsh-vault-section-head',
  sectionTitle: 'dsh-vault-section-title',
  sectionAdd: 'dsh-vault-section-add',
  // ── 字段行 ──
  fieldGrid: 'dsh-vault-field-grid',
  field: 'dsh-vault-field',
  fieldLabel: 'dsh-vault-field-label',
  fieldValueRow: 'dsh-vault-field-value-row',
  fieldValue: 'dsh-vault-field-value',
  fieldValueMono: 'dsh-vault-field-mono',
  fieldSecret: 'dsh-vault-field-secret',
  fieldEye: 'dsh-vault-field-eye',
  fieldEyeOn: 'dsh-vault-field-eye-on',
  fieldInput: 'dsh-vault-field-input',
  fieldKeyHint: 'dsh-vault-field-key-hint',
  // ── 照片 ──
  photoGrid: 'dsh-vault-photo-grid',
  photoCard: 'dsh-vault-photo-card',
  photoThumb: 'dsh-vault-photo-thumb',
  photoLabel: 'dsh-vault-photo-label',
  photoDel: 'dsh-vault-photo-del',
  photoUpload: 'dsh-vault-photo-upload',
  photoUploadPri: 'dsh-vault-photo-upload-pri',
  photoBusy: 'dsh-vault-photo-busy',
  // ── 文件附件 ──
  fileList: 'dsh-vault-file-list',
  fileHint: 'dsh-vault-file-hint',
  fileRow: 'dsh-vault-file-row',
  fileIcon: 'dsh-vault-file-icon',
  fileMain: 'dsh-vault-file-main',
  fileName: 'dsh-vault-file-name',
  fileMeta: 'dsh-vault-file-meta',
  fileAction: 'dsh-vault-file-action',
  fileDelete: 'dsh-vault-file-delete',
  fileUpload: 'dsh-vault-file-upload',
  // ── 变更历史 ──
  changeList: 'dsh-vault-change-list',
  changeRow: 'dsh-vault-change-row',
  changeTime: 'dsh-vault-change-time',
  changeBody: 'dsh-vault-change-body',
  changeField: 'dsh-vault-change-field',
  changeDiff: 'dsh-vault-change-diff',
  changeOld: 'dsh-vault-change-old',
  changeNew: 'dsh-vault-change-new',
  changeAction: 'dsh-vault-change-action',
  // ── 按钮 ──
  btn: 'dsh-vault-btn',
  btnPri: 'dsh-vault-btn-pri',
  btnDanger: 'dsh-vault-btn-danger',
  btnGhost: 'dsh-vault-btn-ghost',
  // ── 底部统计条 ──
  foot: 'dsh-vault-foot',
  footActions: 'dsh-vault-foot-actions',
  // ── 到期提醒 ──
  remindBtn: 'dsh-vault-remind-btn',
  remindBadge: 'dsh-vault-remind-badge',
  remindHead: 'dsh-vault-remind-head',
  remindFacts: 'dsh-vault-remind-facts',
  remindFact: 'dsh-vault-remind-fact',
  remindFactNum: 'dsh-vault-remind-fact-num',
  remindGroup: 'dsh-vault-remind-group',
  remindGroupHead: 'dsh-vault-remind-group-head',
  remindLevel: 'dsh-vault-remind-level',
  remindItem: 'dsh-vault-remind-item',
  remindItemMain: 'dsh-vault-remind-item-main',
  remindItemTitle: 'dsh-vault-remind-item-title',
  remindItemMeta: 'dsh-vault-remind-item-meta',
  remindItemDays: 'dsh-vault-remind-item-days',
  remindDue: 'dsh-vault-remind-due',
  // ── 备份与恢复 ──
  backup: 'dsh-vault-backup',
  backupSection: 'dsh-vault-backup-section',
  backupLabel: 'dsh-vault-backup-label',
  backupInput: 'dsh-vault-backup-input',
  backupHint: 'dsh-vault-backup-hint',
  backupFingerprint: 'dsh-vault-backup-fingerprint',
  backupWarn: 'dsh-vault-backup-warn',
  backupRow: 'dsh-vault-backup-row',
  // ── 强口令生成（详情页密码字段右侧那枚按钮）──
  genBtn: 'dsh-vault-gen-btn',
  genHint: 'dsh-vault-gen-hint',
  // ── 验证码 ──
  totpBtn: 'dsh-vault-totp-btn',
  totpBox: 'dsh-vault-totp-box',
  totpCode: 'dsh-vault-totp-code',
  totpRing: 'dsh-vault-totp-ring',
  totpLeft: 'dsh-vault-totp-left',
  // ── 大图 ──
  lightbox: 'dsh-vault-lightbox',
  lightboxImg: 'dsh-vault-lightbox-img',
  lightboxBar: 'dsh-vault-lightbox-bar',
} as const

/** 样式标签 id（带 triad 前缀，避免与业务方同名旧表互相吞掉）。 */
const STYLE_ID = 'dsh-triad-vault-styles'

const SHEET = `
/* ═══════════════════════════════════════════════════════════════════
   1 · 主题变量（Vault Deck）
   ───────────────────────────────────────────────────────────────────
   底色：深色 #151517（用户点名）/ 浅色 #F6F6F4。
   表面三阶、发丝线两阶、冷银蓝强调三档；语义色只用于状态。
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault{
  --v-bg:#F6F6F4;
  --v-surface:#FFFFFF;
  --v-surface-2:#FBFBF9;
  --v-surface-3:#F0F0ED;
  --v-text:#17171A;
  --v-text-2:#5D5D66;
  --v-text-3:#74747D;
  --v-line:rgba(20,20,24,.09);
  --v-line-2:rgba(20,20,24,.16);
  /* 强调色（变量名沿用 --v-gold 以免大范围改名）：冷银蓝。
     浅色下用同色系加深版（浅底上的亮银蓝对比度不够）。 */
  --v-gold:#56637A;
  --v-gold-hi:#3C4A60;
  --v-gold-soft:rgba(86,99,122,.08);
  --v-gold-line:rgba(86,99,122,.28);
  --v-on-gold:#FFFFFF;
  --v-ok:#2F7A4E;
  --v-warn:#9A6320;
  --v-err:#B4433F;
  --v-shadow:0 14px 34px rgba(20,20,24,.12);
  --v-shadow-sm:0 4px 14px rgba(20,20,24,.07);
  --v-r-card:16px;
  --v-r-ctrl:10px;
  --v-r-pill:999px;
  --v-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --v-ease:cubic-bezier(.22,.68,.24,1);
  position:relative;
  flex:1;min-width:0;min-height:0;
  display:flex;flex-direction:column;overflow:hidden;
  color:var(--v-text);
  background:var(--v-bg);
  font-size:13px;
  box-sizing:border-box;
}
body[data-ds-dark-theme] .dsh-vault{
  --v-bg:#151517;
  --v-surface:#1C1C21;
  --v-surface-2:#202026;
  --v-surface-3:#26262D;
  --v-text:#F2F2F4;
  --v-text-2:#A3A3AE;
  --v-text-3:#8A8A94;
  --v-line:rgba(255,255,255,.075);
  --v-line-2:rgba(255,255,255,.14);
  /* 强调色：冷银蓝（用户反馈纯灰太沉闷，换成更亮、带一点冷蓝的银）。 */
  --v-gold:#C3CEDF;
  --v-gold-hi:#E0E8F4;
  --v-gold-soft:rgba(195,206,223,.10);
  --v-gold-line:rgba(195,206,223,.34);
  --v-on-gold:#0F1420;
  --v-ok:#7FBF95;
  --v-warn:#D9A05B;
  --v-err:#E06C6C;
  --v-shadow:0 20px 44px rgba(0,0,0,.50);
  --v-shadow-sm:0 6px 18px rgba(0,0,0,.32);
}

/* ═══════════════════════════════════════════════════════════════════
   2 · Hero 概览区
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-hero{
  flex:none;
  display:flex;align-items:flex-end;gap:28px;flex-wrap:wrap;
  padding:24px 30px 20px;
  border-bottom:1px solid var(--v-line);
  background:
    radial-gradient(120% 150% at 100% 0%, color-mix(in srgb,var(--v-gold) 6%,transparent) 0%, transparent 58%),
    linear-gradient(180deg, color-mix(in srgb,var(--v-surface) 55%,transparent), transparent);
  box-sizing:border-box;
}
.dsh-vault-hero-main{flex:1 1 460px;min-width:0;display:flex;flex-direction:column;gap:7px}
.dsh-vault-hero-eyebrow{
  display:inline-flex;align-items:center;gap:8px;
  font-size:10px;font-weight:700;letter-spacing:.18em;line-height:16px;
  color:var(--v-gold);text-transform:uppercase;
}
.dsh-vault-hero-eyebrow::before{
  content:"";width:16px;height:1px;background:currentColor;flex:none;
}
.dsh-vault-title{
  margin:0;font-size:32px;font-weight:650;line-height:1.12;
  letter-spacing:-.025em;color:var(--v-text);
}
.dsh-vault-hint{
  margin:0;font-size:12px;line-height:19px;color:var(--v-text-2);
  max-width:72ch;
}
.dsh-vault-hero-stats{
  flex:none;display:flex;align-items:stretch;
  border:1px solid var(--v-line);border-radius:14px;
  background:transparent;
  overflow:hidden;
}
.dsh-vault-hero-stat{
  position:relative;min-width:88px;
  display:flex;flex-direction:column;gap:2px;
  padding:12px 18px 11px;
}
.dsh-vault-hero-stat + .dsh-vault-hero-stat::before{
  content:"";position:absolute;left:0;top:11px;bottom:11px;width:1px;
  background:var(--v-line);
}
.dsh-vault-hero-stat-num{
  font-size:22px;font-weight:650;line-height:1.15;color:var(--v-gold);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-hero-stat-label{
  font-size:10.5px;letter-spacing:.08em;line-height:14px;color:var(--v-text-3);
}

/* ═══════════════════════════════════════════════════════════════════
   3 · 工具条（搜索 + 动作按钮）
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-toolbar{
  flex:none;display:flex;align-items:center;gap:10px;
  padding:16px 30px 0;box-sizing:border-box;
}
.dsh-vault-search-wrap{
  flex:1;min-width:0;
  display:flex;align-items:center;gap:9px;
  height:38px;box-sizing:border-box;padding:0 14px;
  border:1px solid var(--v-line);border-radius:12px;
  background:var(--v-surface);
  box-shadow:var(--v-shadow-sm);
  transition:border-color .16s var(--v-ease),box-shadow .16s var(--v-ease);
}
.dsh-vault-search-wrap:focus-within{
  border-color:var(--v-gold-line);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-gold) 12%,transparent);
}
.dsh-vault-search-icon{display:inline-flex;flex:none;color:var(--v-text-3)}
.dsh-vault-search-input{
  flex:1;min-width:0;border:0;outline:0;background:transparent;
  font-family:inherit;font-size:13px;line-height:18px;color:var(--v-text);
}
.dsh-vault-search-input::placeholder{color:var(--v-text-3)}
.dsh-vault-search-clear{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;padding:0;border:none;border-radius:50%;
  background:var(--v-surface-3);color:var(--v-text-3);
  font-size:11px;line-height:1;cursor:pointer;
}
.dsh-vault-search-clear:hover{background:var(--v-line-2);color:var(--v-text)}
.dsh-vault-head-actions{flex:none;display:flex;align-items:center;gap:6px;margin-left:auto}
.dsh-vault-ghost-btn{
  display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;
  border:1px solid var(--v-line);border-radius:10px;
  background:var(--v-surface);color:var(--v-text-2);
  font-family:inherit;font-size:12px;font-weight:500;line-height:16px;
  cursor:pointer;white-space:nowrap;
  transition:border-color .15s var(--v-ease),color .15s var(--v-ease),background .15s var(--v-ease),transform .12s var(--v-ease);
}
.dsh-vault-ghost-btn:hover{border-color:var(--v-gold-line);color:var(--v-gold);background:var(--v-gold-soft)}
.dsh-vault-ghost-btn:active{transform:scale(.98)}
.dsh-vault-ghost-btn:disabled{opacity:.45;cursor:default}

/* ═══════════════════════════════════════════════════════════════════
   4 · 场景切换条
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-scene-tabs{
  flex:none;display:flex;align-items:center;gap:6px;
  padding:14px 30px 16px;box-sizing:border-box;
  overflow-x:auto;scrollbar-width:none;
}
.dsh-vault-scene-tabs::-webkit-scrollbar{display:none}
.dsh-vault-scene-tab{
  display:inline-flex;align-items:center;gap:7px;flex:none;
  height:32px;padding:0 13px;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:var(--v-r-pill);
  background:transparent;color:var(--v-text-2);
  font-family:inherit;font-size:12px;font-weight:500;line-height:16px;
  white-space:nowrap;cursor:pointer;
  transition:border-color .15s var(--v-ease),color .15s var(--v-ease),background .15s var(--v-ease);
}
.dsh-vault-scene-tab:hover{border-color:var(--v-gold-line);color:var(--v-text)}
.dsh-vault-scene-tab[data-on="1"]{
  border-color:var(--v-gold-line);background:var(--v-gold-soft);
  color:var(--v-gold);font-weight:600;
}
.dsh-vault-scene-tab-count{
  display:inline-flex;align-items:center;justify-content:center;
  min-width:17px;height:16px;box-sizing:border-box;padding:0 5px;
  border-radius:var(--v-r-pill);background:var(--v-surface-3);
  color:var(--v-text-3);font-size:10px;font-weight:600;line-height:16px;
  font-variant-numeric:tabular-nums;
}
.dsh-vault-scene-tab[data-on="1"] .dsh-vault-scene-tab-count{
  background:color-mix(in srgb,var(--v-gold) 16%,transparent);color:var(--v-gold);
}

/* ═══════════════════════════════════════════════════════════════════
   5 · 滚动区 / 场景分节
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-scroll{
  flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;
  padding:4px 30px 40px;box-sizing:border-box;
  display:flex;flex-direction:column;gap:28px;
  scrollbar-gutter:stable;
}
.dsh-vault-scroll::-webkit-scrollbar{width:9px}
.dsh-vault-scroll::-webkit-scrollbar-thumb{
  background:var(--v-line-2);border-radius:5px;border:2px solid transparent;background-clip:content-box;
}
.dsh-vault-scroll::-webkit-scrollbar-track{background:transparent}

.dsh-vault-group{
  flex:none;display:flex;flex-direction:column;gap:12px;
  animation:dsh-vault-rise .32s var(--v-ease) backwards;
  animation-delay:calc(var(--v-i,0) * 40ms);
}
.dsh-vault-group-head{
  display:flex;align-items:center;gap:10px;min-width:0;
  padding:0 2px;
}
.dsh-vault-group-icon{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:34px;height:34px;border-radius:11px;
  background:var(--v-gold-soft);border:1px solid var(--v-gold-line);
  color:var(--v-gold);
}
.dsh-vault-group-name{
  flex:none;border:none;background:transparent;padding:0;
  font-family:inherit;font-size:17px;font-weight:650;line-height:24px;
  letter-spacing:-.01em;color:var(--v-text);
  white-space:nowrap;cursor:pointer;
  transition:color .14s var(--v-ease);
}
.dsh-vault-group-name:hover{color:var(--v-gold)}
.dsh-vault-group-name:focus-visible{outline:none;box-shadow:0 0 0 2px var(--v-gold-line);border-radius:6px}
.dsh-vault-group-desc{
  flex:1;min-width:0;
  font-size:11.5px;line-height:16px;color:var(--v-text-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-group-count{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  min-width:22px;height:20px;box-sizing:border-box;padding:0 7px;
  border-radius:var(--v-r-pill);
  background:var(--v-surface-3);color:var(--v-text-3);
  font-size:11px;font-weight:600;line-height:20px;
  font-variant-numeric:tabular-nums;
}
.dsh-vault-group-add{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:10px;
  background:var(--v-surface);color:var(--v-text-2);cursor:pointer;
  transition:border-color .15s var(--v-ease),color .15s var(--v-ease),background .15s var(--v-ease),transform .12s var(--v-ease);
}
.dsh-vault-group-add:hover{border-color:var(--v-gold-line);color:var(--v-gold);background:var(--v-gold-soft)}
.dsh-vault-group-add:active{transform:scale(.94)}
.dsh-vault-group-add[data-primary="1"]{
  width:auto;padding:0 12px;gap:6px;
  border-color:transparent;background:var(--v-gold);color:var(--v-on-gold);
  font-family:inherit;font-size:12px;font-weight:600;line-height:30px;
}
.dsh-vault-group-add[data-primary="1"]:hover{
  background:var(--v-gold-hi);border-color:transparent;color:var(--v-on-gold);
}
.dsh-vault-group-body{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
  gap:12px;
  align-items:start;
}

/* ═══════════════════════════════════════════════════════════════════
   6 · 记录卡
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-row{
  position:relative;display:grid;
  grid-template-columns:38px minmax(0,1fr) auto;
  align-items:start;gap:12px;
  width:100%;box-sizing:border-box;
  padding:15px 14px 13px 15px;
  border:1px solid var(--v-line);border-radius:var(--v-r-card);
  /* 用户要求：卡片不要背景色。卡片与页面同底，只靠发丝边框与圆角分隔；
     hover 时才浮出一层极淡的反馈色。 */
  background:transparent;
  box-shadow:none;
  color:inherit;text-align:left;font-family:inherit;cursor:pointer;
  transition:transform .18s var(--v-ease),border-color .18s var(--v-ease),box-shadow .18s var(--v-ease),background .18s var(--v-ease);
}
.dsh-vault-row:hover{
  transform:translateY(-2px);
  border-color:var(--v-gold-line);
  background:color-mix(in srgb,var(--v-text) 3%,transparent);
  box-shadow:var(--v-shadow);
}
.dsh-vault-row:focus-visible{
  outline:none;box-shadow:0 0 0 2px var(--v-gold-line),var(--v-shadow);
}
.dsh-vault-row-sel,.dsh-vault-row-sel:hover{
  grid-column:1/-1;
  border-color:var(--v-gold-line);
  background:transparent;
}
.dsh-vault-row-icon{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:36px;height:36px;border-radius:11px;
  background:var(--v-gold-soft);border:1px solid var(--v-gold-line);
  color:var(--v-gold);
}
.dsh-vault-row-sel .dsh-vault-row-icon{background:var(--v-gold);border-color:transparent;color:var(--v-on-gold)}
.dsh-vault-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-top:1px}
.dsh-vault-row-title{
  font-size:14px;font-weight:600;line-height:20px;color:var(--v-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-row-sub{
  font-size:11.5px;line-height:17px;color:var(--v-text-3);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;
  font-variant-numeric:tabular-nums;
}
.dsh-vault-row-meta{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin-top:1px;
  font-size:10.5px;line-height:14px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-row-meta-item{display:inline-flex;align-items:center;gap:4px}
.dsh-vault-row-meta-item + .dsh-vault-row-meta-item::before{
  content:"·";margin-right:1px;color:var(--v-text-3);opacity:.7;
}
.dsh-vault-row-tail{display:flex;align-items:center;gap:6px;padding-top:2px}
.dsh-vault-row-arrow{display:inline-flex;color:var(--v-gold);opacity:0;transition:opacity .15s var(--v-ease),transform .15s var(--v-ease)}
.dsh-vault-row:hover .dsh-vault-row-arrow{opacity:1;transform:translateX(2px)}
.dsh-vault-row:focus-visible .dsh-vault-row-arrow{opacity:1}
.dsh-vault-badge-archived{
  display:inline-flex;align-items:center;gap:4px;
  height:18px;padding:0 7px;border-radius:var(--v-r-pill);
  font-size:10px;font-weight:600;line-height:18px;white-space:nowrap;
  color:var(--v-text-3);background:var(--v-surface-3);
  border:1px solid var(--v-line);
}
.dsh-vault-row-category{
  display:inline-flex;align-items:center;flex:none;
  height:17px;padding:0 7px;margin-right:6px;border-radius:var(--v-r-pill);
  font-size:10px;font-weight:600;line-height:17px;white-space:nowrap;
  max-width:110px;overflow:hidden;text-overflow:ellipsis;
  color:var(--v-gold);background:var(--v-gold-soft);border:1px solid var(--v-gold-line);
  vertical-align:1px;
}

/* 分类筛选条 */
.dsh-vault-category-filter{
  display:flex;flex-wrap:wrap;gap:6px;min-width:0;padding:0 2px 2px;
}
.dsh-vault-category-chip{
  display:inline-flex;align-items:center;
  height:24px;padding:0 10px;box-sizing:border-box;border-radius:var(--v-r-pill);
  border:1px solid var(--v-line);background:transparent;
  color:var(--v-text-2);font-size:11px;font-family:inherit;
  cursor:pointer;transition:border-color .15s var(--v-ease),color .15s var(--v-ease),background .15s var(--v-ease);
}
.dsh-vault-category-chip:hover{border-color:var(--v-gold-line);color:var(--v-gold)}
.dsh-vault-category-chip[data-on="1"]{
  border-color:var(--v-gold-line);color:var(--v-gold);
  background:var(--v-gold-soft);font-weight:600;
}

/* 详情里的分类行 */
.dsh-vault-category-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.dsh-vault-category-label{font-size:11.5px;color:var(--v-text-3);flex:none}
.dsh-vault-category-input{
  flex:1;min-width:140px;height:32px;padding:0 10px;box-sizing:border-box;
  border:1px solid var(--v-line-2);border-radius:var(--v-r-ctrl);
  background:var(--v-surface-2);color:var(--v-text);
  font-size:12.5px;font-family:inherit;outline:none;
}
.dsh-vault-category-input:focus{
  border-color:var(--v-gold);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-gold) 14%,transparent);
}
.dsh-vault-category-chips{display:flex;flex-wrap:wrap;gap:6px;min-width:0}

/* ═══════════════════════════════════════════════════════════════════
   7 · 空态 / 骨架 / 错误 / 提示
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-empty{
  display:flex;align-items:flex-start;gap:10px;
  padding:18px 16px;box-sizing:border-box;
  border:1px dashed var(--v-line-2);border-radius:14px;
  background:transparent;
  grid-column:1/-1;
}
.dsh-vault-empty-icon{flex:none;display:inline-flex;color:var(--v-gold);opacity:.8;margin-top:1px}
.dsh-vault-empty-text{font-size:12.5px;line-height:19px;color:var(--v-text-2)}
.dsh-vault-empty-hint{display:block;margin-top:3px;font-size:11.5px;line-height:17px;color:var(--v-text-3)}
.dsh-vault-skeleton{
  border:1px solid var(--v-line);border-radius:var(--v-r-card);
  padding:14px;display:flex;flex-direction:column;gap:10px;
  box-sizing:border-box;background:transparent;
}
.dsh-vault-skeleton-row{
  height:38px;border-radius:10px;
  background:linear-gradient(90deg,var(--v-surface-2) 25%,var(--v-surface-3) 50%,var(--v-surface-2) 75%);
  background-size:200% 100%;
  animation:dsh-vault-shimmer 1.1s linear infinite;
}
.dsh-vault-error{
  display:flex;align-items:center;gap:10px;
  padding:12px 14px;box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--v-err) 36%,transparent);
  border-radius:14px;
  background:color-mix(in srgb,var(--v-err) 8%,transparent);
  color:var(--v-err);
}
.dsh-vault-error-text{flex:1;min-width:0;font-size:12.5px;line-height:19px;word-break:break-word}
.dsh-vault-error-retry{
  flex:none;height:28px;padding:0 12px;
  border:1px solid color-mix(in srgb,var(--v-err) 48%,transparent);
  border-radius:var(--v-r-ctrl);background:transparent;color:var(--v-err);
  font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;
}
.dsh-vault-error-retry:hover{background:color-mix(in srgb,var(--v-err) 12%,transparent)}
.dsh-vault-notice{
  flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin:10px 30px 0;padding:9px 12px;
  font-size:11.5px;line-height:17px;color:var(--v-text-2);
  border:1px solid var(--v-line);border-radius:10px;background:transparent;
}
.dsh-vault-notice[data-tone="warn"]{
  border-left:2px solid var(--v-warn);
  background:color-mix(in srgb,var(--v-warn) 7%,transparent);
}
.dsh-vault-notice[data-tone="warn"] b{color:var(--v-text);font-weight:600}

/* ═══════════════════════════════════════════════════════════════════
   8 · 详情面板：外壳（原地展开 / 弹窗）
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-backdrop{
  position:absolute;inset:0;z-index:20;
  display:flex;align-items:center;justify-content:center;
  padding:32px 24px;box-sizing:border-box;
  background:rgba(0,0,0,.18);
  animation:dsh-vault-fade .16s ease;
}
body[data-ds-dark-theme] .dsh-vault .dsh-vault-backdrop{background:rgba(0,0,0,.58)}
.dsh-vault-modal{
  position:relative;display:flex;flex-direction:column;
  width:min(640px,100%);max-height:100%;min-height:0;
  background:var(--v-bg);
  border:1px solid var(--v-line-2);
  border-radius:20px;
  box-shadow:var(--v-shadow);
  overflow:hidden;
  box-sizing:border-box;
  animation:dsh-vault-pop .24s var(--v-ease);
}
.dsh-vault-expand{
  position:relative;display:flex;flex-direction:column;
  grid-column:1/-1;
  margin:2px 0 4px;
  background:var(--v-bg);
  border:1px solid var(--v-gold-line);
  border-radius:18px;
  box-shadow:var(--v-shadow-sm);
  overflow:hidden;
  animation:dsh-vault-rise .24s var(--v-ease);
}
.dsh-vault-panel-head{
  flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:10px 8px;
  padding:18px 20px 14px;
  border-bottom:1px solid var(--v-line);
  background:transparent;
  box-sizing:border-box;
}
.dsh-vault-panel-eyebrow{
  flex:1 1 100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  font-size:10px;font-weight:700;letter-spacing:.16em;line-height:15px;
  color:var(--v-gold);text-transform:uppercase;
}
.dsh-vault-panel-eyebrow::before{
  content:"";width:14px;height:1px;background:currentColor;flex:none;
}
/* 第一枚 span 是「记录详情 / 新建记录」这句文案，保持纯文字；
   场景 chip 走 .dsh-vault-row-category，这里只放开它的宽度限制。 */
.dsh-vault-panel-eyebrow > span{
  letter-spacing:.02em;text-transform:none;font-weight:600;
  color:var(--v-text-3);font-size:10.5px;
}
.dsh-vault-panel-eyebrow .dsh-vault-row-category{
  max-width:none;height:20px;padding:0 8px;line-height:18px;
  font-size:10.5px;letter-spacing:.02em;
}
.dsh-vault-panel-title-input{
  flex:1;min-width:0;order:1;
  border:1px solid transparent;border-radius:var(--v-r-ctrl);
  background:transparent;padding:5px 8px;margin:0 -8px;
  font-family:inherit;font-size:18px;font-weight:650;line-height:26px;color:var(--v-text);
  letter-spacing:-.01em;
  transition:border-color .15s var(--v-ease),background .15s var(--v-ease);
}
.dsh-vault-panel-title-input:hover{border-color:var(--v-line)}
.dsh-vault-panel-title-input:focus{
  outline:none;border-color:var(--v-gold-line);background:var(--v-surface-2);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-gold) 12%,transparent);
}
.dsh-vault-panel-close{
  flex:none;order:2;
  display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;border:1px solid var(--v-line);border-radius:9px;
  background:transparent;color:var(--v-text-2);cursor:pointer;
  transition:background .14s var(--v-ease),color .14s var(--v-ease),border-color .14s var(--v-ease);
}
.dsh-vault-panel-close:hover{background:var(--v-surface-3);color:var(--v-text);border-color:var(--v-line-2)}
.dsh-vault-panel-body{
  flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;
  padding:16px 20px 20px;box-sizing:border-box;
  display:flex;flex-direction:column;gap:14px;
  background:var(--v-bg);
}
.dsh-vault-panel-body::-webkit-scrollbar{width:9px}
.dsh-vault-panel-body::-webkit-scrollbar-thumb{
  background:var(--v-line-2);border-radius:5px;border:2px solid transparent;background-clip:content-box;
}
.dsh-vault-panel-foot{
  flex:none;display:flex;align-items:center;gap:8px;
  padding:14px 20px;box-sizing:border-box;
  border-top:1px solid var(--v-line);
  background:transparent;
}

/* ═══════════════════════════════════════════════════════════════════
   9 · 详情小节 / 字段
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-section{
  display:flex;flex-direction:column;gap:10px;
  padding:14px 16px 16px;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:var(--v-r-card);
  background:transparent;
}
.dsh-vault-section-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-vault-section-title{
  flex:none;font-size:10.5px;font-weight:700;line-height:16px;
  color:var(--v-gold);letter-spacing:.14em;text-transform:uppercase;
}
.dsh-vault-section-add{
  flex:none;display:inline-flex;align-items:center;gap:4px;
  height:24px;padding:0 9px;margin-left:auto;
  border:1px solid var(--v-gold-line);border-radius:var(--v-r-pill);
  background:var(--v-gold-soft);color:var(--v-gold);
  font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;
}
.dsh-vault-section-add:hover{background:color-mix(in srgb,var(--v-gold) 15%,transparent)}
.dsh-vault-field-grid{
  /* 固定两列：字段值（URL / 密码 / 备注）比标题长得多，列再窄就只剩折行。
     窄屏在下面的媒体查询里退成一列。 */
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;
}
.dsh-vault-field{
  display:flex;flex-direction:column;gap:4px;
  padding:10px 12px;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:12px;
  background:transparent;
  transition:border-color .15s var(--v-ease);
}
.dsh-vault-field:hover{border-color:var(--v-line-2)}
.dsh-vault-field-label{
  display:flex;align-items:center;gap:6px;
  font-size:10.5px;line-height:15px;color:var(--v-text-3);font-weight:600;
  letter-spacing:.04em;
}
.dsh-vault-field-key-hint{
  font-size:10px;color:var(--v-text-3);opacity:.75;
  font-family:var(--v-mono);
}
.dsh-vault-field-value-row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.dsh-vault-field-value{
  flex:1;min-width:0;
  font-size:13px;line-height:19px;color:var(--v-text);
  word-break:break-all;
  border:1px solid transparent;border-radius:8px;
  background:transparent;padding:2px 6px;margin:0 -6px;
  font-family:inherit;text-align:left;cursor:text;
  transition:border-color .15s var(--v-ease),background .15s var(--v-ease);
}
.dsh-vault-field-value:hover{border-color:var(--v-line)}
.dsh-vault-field-value:focus{
  outline:none;border-color:var(--v-gold-line);background:var(--v-surface);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-gold) 12%,transparent);
}
.dsh-vault-field-mono{font-family:var(--v-mono);letter-spacing:.02em}
.dsh-vault-field-secret{
  flex:1;min-width:0;
  font-size:11px;line-height:19px;letter-spacing:2.5px;color:var(--v-text-3);
  padding:2px 6px;margin:0 -6px;user-select:none;
}
.dsh-vault-field-eye{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;
  border:1px solid transparent;border-radius:8px;
  background:transparent;color:var(--v-text-3);cursor:pointer;
  transition:color .14s var(--v-ease),background .14s var(--v-ease),border-color .14s var(--v-ease);
}
.dsh-vault-field-eye:hover{color:var(--v-text);background:var(--v-surface-3)}
.dsh-vault-field-eye-on{color:var(--v-gold);border-color:var(--v-gold-line);background:var(--v-gold-soft)}
.dsh-vault-field-input{
  flex:1;min-width:0;
  border:1px solid var(--v-gold-line);border-radius:8px;
  background:var(--v-surface);padding:3px 8px;
  font-family:inherit;font-size:13px;line-height:19px;color:var(--v-text);
  outline:none;
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-gold) 10%,transparent);
}

/* ═══════════════════════════════════════════════════════════════════
   10 · 照片 / 文件 / 变更历史
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-photo-grid{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:9px;
}
.dsh-vault-photo-card{
  position:relative;display:flex;flex-direction:column;gap:4px;
  border:1px solid var(--v-line);border-radius:12px;overflow:hidden;
  background:transparent;
}
.dsh-vault-photo-thumb{
  width:100%;aspect-ratio:4/3;object-fit:cover;display:block;
  cursor:zoom-in;background:var(--v-surface-3);
}
.dsh-vault-photo-label{
  padding:0 7px 6px;
  font-size:10.5px;line-height:14px;color:var(--v-text-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-photo-del{
  position:absolute;top:5px;right:5px;
  display:inline-flex;align-items:center;justify-content:center;
  width:21px;height:21px;padding:0;
  border:1px solid rgba(255,255,255,.24);border-radius:7px;
  background:rgba(15,17,23,.66);color:#fff;cursor:pointer;
  opacity:0;transition:opacity .14s ease,background .14s ease;
}
.dsh-vault-photo-card:hover .dsh-vault-photo-del{opacity:1}
.dsh-vault-photo-del:hover{background:rgba(15,17,23,.88)}
.dsh-vault-photo-upload{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
  min-height:96px;box-sizing:border-box;padding:9px;
  border:1px dashed var(--v-line-2);border-radius:12px;
  background:transparent;color:var(--v-text-3);
  font-family:inherit;font-size:11.5px;line-height:16px;
  cursor:pointer;transition:border-color .15s var(--v-ease),color .15s var(--v-ease),background .15s var(--v-ease);
}
.dsh-vault-photo-upload:hover{border-color:var(--v-gold-line);color:var(--v-gold);background:var(--v-gold-soft)}
.dsh-vault-photo-upload-pri{
  border-style:solid;border-color:var(--v-gold-line);
  background:var(--v-gold-soft);color:var(--v-gold);font-weight:600;
}
.dsh-vault-photo-upload-pri:hover{border-color:var(--v-gold)}
.dsh-vault-photo-busy{grid-column:1/-1;font-size:11.5px;line-height:17px;color:var(--v-text-2)}
.dsh-vault-file-list{display:flex;flex-direction:column;gap:6px}
.dsh-vault-file-row{
  display:flex;align-items:center;gap:9px;
  padding:8px 10px;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:10px;
  background:transparent;min-width:0;
}
.dsh-vault-file-icon{flex:none;display:inline-flex;color:var(--v-gold);opacity:.85}
.dsh-vault-file-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-vault-file-name{
  font-size:12.5px;font-weight:500;line-height:17px;color:var(--v-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-file-meta{
  font-size:11px;line-height:15px;color:var(--v-text-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-variant-numeric:tabular-nums;
}
.dsh-vault-file-action,.dsh-vault-file-delete{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;box-sizing:border-box;
  border:1px solid transparent;border-radius:8px;
  background:transparent;color:var(--v-text-3);cursor:pointer;
  font-family:inherit;text-decoration:none;
  transition:color .14s var(--v-ease),background .14s var(--v-ease),border-color .14s var(--v-ease);
}
.dsh-vault-file-action:hover{color:var(--v-gold);background:var(--v-gold-soft);border-color:var(--v-gold-line)}
.dsh-vault-file-delete:hover{color:var(--v-err);background:color-mix(in srgb,var(--v-err) 9%,transparent);border-color:color-mix(in srgb,var(--v-err) 34%,transparent)}
.dsh-vault-file-delete:disabled{opacity:.45;cursor:default}
.dsh-vault-file-hint{font-size:11.5px;line-height:17px;color:var(--v-text-3)}
.dsh-vault-file-upload{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  align-self:flex-start;height:30px;padding:0 12px;box-sizing:border-box;
  border:1px dashed var(--v-line-2);border-radius:10px;
  background:transparent;color:var(--v-text-2);
  font-family:inherit;font-size:11.5px;line-height:16px;cursor:pointer;
  transition:border-color .15s var(--v-ease),color .15s var(--v-ease),background .15s var(--v-ease);
}
.dsh-vault-file-upload:hover:not(:disabled){border-color:var(--v-gold-line);color:var(--v-gold);background:var(--v-gold-soft)}
.dsh-vault-file-upload:disabled{opacity:.55;cursor:default}
.dsh-vault-change-list{display:flex;flex-direction:column;gap:2px}
.dsh-vault-change-row{
  display:flex;align-items:flex-start;gap:10px;
  padding:7px 2px;
  border-bottom:1px solid var(--v-line);
}
.dsh-vault-change-row:last-child{border-bottom:none}
.dsh-vault-change-time{
  flex:none;width:66px;
  font-size:10.5px;line-height:17px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-change-body{flex:1;min-width:0;font-size:12px;line-height:17px;color:var(--v-text-2)}
.dsh-vault-change-field{color:var(--v-text);font-weight:600}
.dsh-vault-change-action{
  display:inline-flex;align-items:center;
  margin-right:6px;padding:0 6px;height:16px;
  border-radius:5px;font-size:10px;line-height:16px;
  background:var(--v-gold-soft);border:1px solid var(--v-gold-line);color:var(--v-gold);
}
.dsh-vault-change-diff{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-top:2px;min-width:0}
.dsh-vault-change-old{color:var(--v-text-3);text-decoration:line-through;word-break:break-all;max-width:100%}
.dsh-vault-change-new{color:var(--v-text);word-break:break-all;max-width:100%}
.dsh-vault-change-old + .dsh-vault-change-new::before{content:"→ ";color:var(--v-text-3)}

/* ═══════════════════════════════════════════════════════════════════
   11 · 按钮
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:32px;padding:0 15px;box-sizing:border-box;
  border:1px solid var(--v-line-2);border-radius:10px;
  background:var(--v-surface);color:var(--v-text-2);
  font-family:inherit;font-size:12.5px;font-weight:500;line-height:18px;
  cursor:pointer;white-space:nowrap;
  transition:border-color .14s var(--v-ease),color .14s var(--v-ease),background .14s var(--v-ease),transform .12s var(--v-ease);
}
.dsh-vault-btn:hover:not(:disabled){border-color:var(--v-gold-line);color:var(--v-text);background:var(--v-surface-2)}
.dsh-vault-btn:active:not(:disabled){transform:scale(.98)}
.dsh-vault-btn:disabled{opacity:.45;cursor:default}
.dsh-vault-btn-pri{
  border-color:transparent;background:var(--v-gold);color:var(--v-on-gold);
  font-weight:650;
}
.dsh-vault-btn-pri:hover:not(:disabled){background:var(--v-gold-hi);border-color:transparent;color:var(--v-on-gold)}
.dsh-vault-btn-danger:hover:not(:disabled){
  border-color:color-mix(in srgb,var(--v-err) 46%,transparent);
  color:var(--v-err);background:color-mix(in srgb,var(--v-err) 9%,transparent);
}
.dsh-vault-btn-ghost{border-color:transparent;background:transparent}
.dsh-vault-btn-ghost:hover:not(:disabled){border-color:var(--v-line);background:var(--v-surface-2)}

/* ═══════════════════════════════════════════════════════════════════
   12 · 底部统计条
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-foot{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  margin-top:2px;padding:14px 2px 0;
  border-top:1px solid var(--v-line);
  font-size:11.5px;line-height:17px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-foot-actions{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}

/* ═══════════════════════════════════════════════════════════════════
   13 · 到期提醒入口 / 窗口
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-remind-btn{
  display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;
  border:1px solid var(--v-line);border-radius:10px;
  background:var(--v-surface);color:var(--v-text-2);
  font-family:inherit;font-size:12px;font-weight:500;line-height:16px;
  cursor:pointer;white-space:nowrap;
  transition:border-color .15s var(--v-ease),color .15s var(--v-ease),background .15s var(--v-ease);
}
.dsh-vault-remind-btn:hover{border-color:var(--v-gold-line);color:var(--v-gold);background:var(--v-gold-soft)}
.dsh-vault-remind-btn[data-tone="warn"]{
  border-color:color-mix(in srgb,var(--v-warn) 40%,transparent);
  color:var(--v-warn);background:color-mix(in srgb,var(--v-warn) 8%,transparent);
}
.dsh-vault-remind-btn[data-tone="bad"]{
  border-color:color-mix(in srgb,var(--v-err) 42%,transparent);
  color:var(--v-err);background:color-mix(in srgb,var(--v-err) 8%,transparent);
}
.dsh-vault-remind-badge{
  display:inline-flex;align-items:center;justify-content:center;
  min-width:17px;height:17px;box-sizing:border-box;padding:0 5px;
  border-radius:var(--v-r-pill);
  background:var(--v-text-3);color:var(--v-surface);
  font-size:10.5px;font-weight:700;line-height:17px;
  font-variant-numeric:tabular-nums;
}
.dsh-vault-remind-btn[data-tone="warn"] .dsh-vault-remind-badge{background:var(--v-warn);color:var(--v-surface)}
.dsh-vault-remind-btn[data-tone="bad"] .dsh-vault-remind-badge{background:var(--v-err);color:var(--v-surface)}
.dsh-vault-remind-btn[data-tone="good"] .dsh-vault-remind-badge{display:none}
.dsh-vault-remind-head{
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:14px 16px;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:var(--v-r-card);
  background:transparent;
}
.dsh-vault-remind-facts{display:flex;flex-wrap:wrap;gap:7px}
.dsh-vault-remind-fact{
  display:inline-flex;align-items:center;gap:6px;
  height:24px;padding:0 10px;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:var(--v-r-pill);
  font-size:11.5px;line-height:24px;color:var(--v-text-2);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-remind-fact-num{font-weight:700;color:var(--v-gold)}
.dsh-vault-remind-group{display:flex;flex-direction:column;gap:7px}
.dsh-vault-remind-group-head{
  display:flex;align-items:center;gap:8px;
  font-size:10.5px;font-weight:700;line-height:16px;letter-spacing:.1em;
  color:var(--v-text-3);text-transform:uppercase;
}
.dsh-vault-remind-level{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;line-height:16px}
.dsh-vault-remind-level::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.dsh-vault-remind-level[data-level="expired"]{color:var(--v-err)}
.dsh-vault-remind-level[data-level="soon"]{color:var(--v-warn)}
.dsh-vault-remind-level[data-level="later"]{color:var(--v-text-3)}
.dsh-vault-remind-item{
  display:flex;align-items:flex-start;gap:10px;
  width:100%;box-sizing:border-box;
  padding:10px 12px;text-align:left;
  border:1px solid var(--v-line);border-radius:12px;
  background:transparent;color:inherit;font-family:inherit;
  cursor:pointer;transition:border-color .14s var(--v-ease),background .14s var(--v-ease),transform .14s var(--v-ease);
}
.dsh-vault-remind-item:hover{border-color:var(--v-gold-line);background:color-mix(in srgb,var(--v-text) 3%,transparent);transform:translateY(-1px)}
.dsh-vault-remind-item[data-level="expired"]{border-left:2px solid var(--v-err)}
.dsh-vault-remind-item[data-level="soon"]{border-left:2px solid var(--v-warn)}
.dsh-vault-remind-item[data-level="later"]{border-left:2px solid var(--v-line-2)}
.dsh-vault-remind-item:focus-visible{outline:none;box-shadow:0 0 0 2px var(--v-gold-line)}
.dsh-vault-remind-item-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-vault-remind-item-title{
  font-size:12.5px;font-weight:600;line-height:18px;color:var(--v-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-remind-item-meta{font-size:11.5px;line-height:17px;color:var(--v-text-2)}
.dsh-vault-remind-item-days{
  flex:none;align-self:center;font-size:12px;font-weight:700;line-height:18px;
  font-variant-numeric:tabular-nums;white-space:nowrap;
}
.dsh-vault-remind-item-days[data-level="expired"]{color:var(--v-err)}
.dsh-vault-remind-item-days[data-level="soon"]{color:var(--v-warn)}
.dsh-vault-remind-item-days[data-level="later"]{color:var(--v-text-2)}
.dsh-vault-remind-due{font-size:11px;line-height:16px;color:var(--v-text-3);font-variant-numeric:tabular-nums}

/* ═══════════════════════════════════════════════════════════════════
   14 · 备份与恢复
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-backup{display:flex;flex-direction:column;gap:16px}
.dsh-vault-backup-section{
  display:flex;flex-direction:column;gap:10px;
  padding:15px 16px;box-sizing:border-box;
  border:1px solid var(--v-line);border-radius:var(--v-r-card);
  background:transparent;
}
.dsh-vault-backup-label{
  display:flex;align-items:center;gap:7px;
  font-size:12.5px;font-weight:650;line-height:18px;color:var(--v-text);
}
.dsh-vault-backup-label svg{color:var(--v-gold)}
.dsh-vault-backup-input{
  width:100%;box-sizing:border-box;height:34px;padding:0 11px;
  border:1px solid var(--v-line-2);border-radius:var(--v-r-ctrl);
  background:var(--v-surface-2);color:var(--v-text);
  font-family:inherit;font-size:13px;line-height:18px;
  transition:border-color .15s var(--v-ease),box-shadow .15s var(--v-ease);
}
.dsh-vault-backup-input:focus{
  outline:none;border-color:var(--v-gold);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-gold) 12%,transparent);
}
.dsh-vault-backup-input::placeholder{color:var(--v-text-3)}
.dsh-vault-backup-hint{font-size:11.5px;line-height:17px;color:var(--v-text-3)}
.dsh-vault-backup-fingerprint{
  display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;
  padding:7px 10px;box-sizing:border-box;
  border-radius:10px;background:var(--v-surface-2);border:1px solid var(--v-line);
  font-family:var(--v-mono);font-size:11.5px;line-height:17px;color:var(--v-text-2);
  word-break:break-all;
}
.dsh-vault-backup-fingerprint b{color:var(--v-text);font-weight:600}
.dsh-vault-backup-warn{
  display:flex;align-items:flex-start;gap:8px;
  padding:10px 12px;box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--v-err) 34%,transparent);
  border-radius:12px;
  background:color-mix(in srgb,var(--v-err) 8%,transparent);
  font-size:11.5px;line-height:17px;color:var(--v-err);
}
.dsh-vault-backup-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* ═══════════════════════════════════════════════════════════════════
   15 · 强口令 / TOTP
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-gen-btn{
  flex:none;display:inline-flex;align-items:center;gap:4px;
  height:27px;padding:0 9px;
  border:1px solid var(--v-gold-line);border-radius:var(--v-r-pill);
  background:var(--v-gold-soft);color:var(--v-gold);
  font-family:inherit;font-size:11px;font-weight:600;line-height:27px;
  cursor:pointer;white-space:nowrap;
  transition:background .14s var(--v-ease),border-color .14s var(--v-ease);
}
.dsh-vault-gen-btn:hover:not(:disabled){background:color-mix(in srgb,var(--v-gold) 17%,transparent)}
.dsh-vault-gen-btn:disabled{opacity:.5;cursor:default}
.dsh-vault-gen-hint{
  flex:1 1 100%;font-size:11px;line-height:16px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-totp-btn{
  flex:none;display:inline-flex;align-items:center;gap:5px;
  height:27px;padding:0 9px;
  border:1px solid var(--v-gold-line);border-radius:var(--v-r-pill);
  background:var(--v-gold-soft);color:var(--v-gold);
  font-family:inherit;font-size:11px;font-weight:600;line-height:27px;
  cursor:pointer;white-space:nowrap;
  transition:background .14s var(--v-ease),border-color .14s var(--v-ease);
}
.dsh-vault-totp-btn:hover{background:color-mix(in srgb,var(--v-gold) 17%,transparent)}
.dsh-vault-totp-btn:disabled{opacity:.5;cursor:default}
.dsh-vault-totp-box{
  flex:1 1 100%;display:flex;align-items:center;gap:12px;
  padding:11px 13px;box-sizing:border-box;
  border:1px solid var(--v-gold-line);border-radius:12px;
  background:var(--v-gold-soft);
}
.dsh-vault-totp-code{
  flex:none;font-family:var(--v-mono);
  font-size:21px;font-weight:650;line-height:25px;letter-spacing:3px;
  color:var(--v-text);font-variant-numeric:tabular-nums;
  cursor:pointer;user-select:all;
}
.dsh-vault-totp-ring{flex:none;position:relative;width:28px;height:28px}
.dsh-vault-totp-ring svg{display:block;transform:rotate(-90deg)}
.dsh-vault-totp-left{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;line-height:1;color:var(--v-gold);
  font-variant-numeric:tabular-nums;
}

/* ═══════════════════════════════════════════════════════════════════
   16 · 大图查看
   ═══════════════════════════════════════════════════════════════════ */
.dsh-vault-lightbox{
  position:fixed;inset:0;z-index:4000;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  padding:28px;box-sizing:border-box;
  background:rgba(8,9,12,.90);
  animation:dsh-vault-fade .16s ease;
  cursor:zoom-out;
}
.dsh-vault-lightbox-img{
  max-width:100%;max-height:calc(100% - 46px);
  object-fit:contain;border-radius:12px;
  box-shadow:0 18px 50px rgba(0,0,0,.55);
}
.dsh-vault-lightbox-bar{display:flex;align-items:center;gap:12px;font-size:12px;line-height:18px;color:rgba(255,255,255,.72)}

/* ═══════════════════════════════════════════════════════════════════
   17 · 动效
   ═══════════════════════════════════════════════════════════════════ */
@keyframes dsh-vault-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes dsh-vault-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-vault-pop{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes dsh-vault-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){
  .dsh-vault-group,.dsh-vault-backdrop,.dsh-vault-modal,.dsh-vault-expand,
  .dsh-vault-lightbox{animation:none!important}
  .dsh-vault-skeleton-row{animation:none!important}
  .dsh-vault-row,.dsh-vault-row-arrow,.dsh-vault-ghost-btn,.dsh-vault-group-add,
  .dsh-vault-photo-upload,.dsh-vault-btn,.dsh-vault-field-eye,.dsh-vault-photo-del,
  .dsh-vault-remind-btn,.dsh-vault-remind-item,.dsh-vault-totp-btn,
  .dsh-vault-backup-input,.dsh-vault-gen-btn,.dsh-vault-scene-tab{
    transition:none!important;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   18 · 响应式
   ═══════════════════════════════════════════════════════════════════ */
@media (max-width:1120px){
  .dsh-vault-hero{padding:20px 22px 16px;gap:20px}
  .dsh-vault-toolbar{padding:14px 22px 0}
  .dsh-vault-scene-tabs{padding:12px 22px 14px}
  .dsh-vault-scroll{padding:4px 22px 32px}
  .dsh-vault-notice{margin:10px 22px 0}
  .dsh-vault-hero-stat{min-width:76px;padding:10px 14px 9px}
}
@media (max-width:900px){
  .dsh-vault-hero{align-items:flex-start;flex-direction:column;gap:16px}
  /* 纵向排列时 flex-basis 会变成「高度基准」，不重置会在标题下留出 460px 空白 */
  .dsh-vault-hero-main{flex:0 0 auto}
  .dsh-vault-hero-stats{width:100%}
  .dsh-vault-hero-stat{flex:1;min-width:0;padding:10px 12px}
  .dsh-vault-hero-stat-num{font-size:19px}
  .dsh-vault-group-body{grid-template-columns:1fr}
  .dsh-vault-toolbar{flex-wrap:wrap}
  .dsh-vault-search-wrap{flex:1 1 100%}
  .dsh-vault-head-actions{margin-left:0}
}
@media (max-width:720px){
  .dsh-vault-hero{padding:16px 14px 14px}
  .dsh-vault-toolbar{padding:12px 14px 0}
  .dsh-vault-scene-tabs{padding:10px 14px 12px}
  .dsh-vault-scroll{padding:4px 14px 28px;gap:22px}
  .dsh-vault-notice{margin:10px 14px 0}
  .dsh-vault-backdrop{padding:16px 10px}
  .dsh-vault-modal{width:100%}
  .dsh-vault-expand{margin:2px 0 4px}
  .dsh-vault-group-desc{display:none}
  .dsh-vault-title{font-size:26px}
  .dsh-vault-field-grid{grid-template-columns:1fr}
}
`

/**
 * 注入样式表（幂等）。
 *
 * 按**内容**比对而不是只按 id 判重：插件升级后已打开的页面里那份旧 style 会
 * 一直命中早退分支，JSX 拿到新类名却匹配不到新规则，界面直接裸奔。
 */
export function ensureVaultStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (existing !== null) {
    if (existing.textContent !== SHEET) existing.textContent = SHEET
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-chat-plus'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
