/**
 * dsh-vault — 整页档案面板样式（运行时注入 style 标签，卸载时由 loader 清理）。
 *
 * ── 视觉取向：照用户给的参考图（Chrome 密码管理器的分组卡）────────────
 * 参考图是深色、卡片化的：每张卡 = 一个场景，卡头一行「场景名 + 右侧动作」，
 * 卡内是记录行（左图标 + 名称 + 右侧次要信息）。所以这里的骨架就是
 * 「搜索条 → 分组卡列表 → 点行开右侧抽屉」，不做左右两栏的管理后台。
 *
 * 颜色只用一个中性强调色（DSH 主题的 business-primary）+ 现有 --dsw-alias-*
 * token，不引入第二套配色：这个页面里没有需要靠色相区分的信息层级，「哪个是
 * 场景 / 哪个是记录 / 哪个能点」靠结构与字号说清楚就够了。
 *
 * 深色 / 浅色都靠 token 自动跟随；只有少数必须手写颜色的地方（图片占位底色、
 * 抽屉投影）才额外写一条 body[data-ds-dark-theme] 覆盖。
 *
 * ⚠ 本文件的整张样式表是一个模板字面量：**注释里绝对不能出现反引号**，
 * 否则模板提前闭合、构建报一个与根因无关的错（build.mjs 有源码级守卫）。
 */

/** 类名表（组件侧统一从这里取，避免字符串散落两处各写一遍）。 */
export const css = {
  root: 'dsh-vault',
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
  panelTitleInput: 'dsh-vault-panel-title-input',
  panelClose: 'dsh-vault-panel-close',
  panelBody: 'dsh-vault-panel-body',
  panelFoot: 'dsh-vault-panel-foot',
  section: 'dsh-vault-section',
  sectionHead: 'dsh-vault-section-head',
  sectionTitle: 'dsh-vault-section-title',
  sectionAdd: 'dsh-vault-section-add',
  // ── 字段行 ──
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
  // ── 健康抽屉 ──
  healthBtn: 'dsh-vault-health-btn',
  healthBadge: 'dsh-vault-health-badge',
  healthScore: 'dsh-vault-health-score',
  healthScoreRing: 'dsh-vault-health-score-ring',
  healthScoreNum: 'dsh-vault-health-score-num',
  healthScoreLabel: 'dsh-vault-health-score-label',
  healthFacts: 'dsh-vault-health-facts',
  healthFact: 'dsh-vault-health-fact',
  healthFactNum: 'dsh-vault-health-fact-num',
  healthGroup: 'dsh-vault-health-group',
  healthGroupHead: 'dsh-vault-health-group-head',
  healthSeverity: 'dsh-vault-health-sev',
  healthIssue: 'dsh-vault-health-issue',
  healthIssueMain: 'dsh-vault-health-issue-main',
  healthIssueTitle: 'dsh-vault-health-issue-title',
  healthIssueMsg: 'dsh-vault-health-issue-msg',
  healthIssueDetail: 'dsh-vault-health-issue-detail',
  // ── 备份与恢复 ──
  backup: 'dsh-vault-backup',
  backupSection: 'dsh-vault-backup-section',
  backupLabel: 'dsh-vault-backup-label',
  backupInput: 'dsh-vault-backup-input',
  backupHint: 'dsh-vault-backup-hint',
  backupFingerprint: 'dsh-vault-backup-fingerprint',
  backupWarn: 'dsh-vault-backup-warn',
  backupRow: 'dsh-vault-backup-row',
  // ── 强口令生成 / 批量轮换 ──
  genBtn: 'dsh-vault-gen-btn',
  genHint: 'dsh-vault-gen-hint',
  rotateBlock: 'dsh-vault-rotate-block',
  rotateBlockHead: 'dsh-vault-rotate-block-head',
  rotateBlockTitle: 'dsh-vault-rotate-block-title',
  rotateBtn: 'dsh-vault-rotate-btn',
  rotateConfirm: 'dsh-vault-rotate-confirm',
  rotateConfirmTitle: 'dsh-vault-rotate-confirm-title',
  rotateConfirmText: 'dsh-vault-rotate-confirm-text',
  rotateConfirmRow: 'dsh-vault-rotate-confirm-row',
  rotateResult: 'dsh-vault-rotate-result',
  rotateResultTitle: 'dsh-vault-rotate-result-title',
  rotateResultRow: 'dsh-vault-rotate-result-row',
  rotateResultName: 'dsh-vault-rotate-result-name',
  rotateResultCode: 'dsh-vault-rotate-result-code',
  rotateResultHint: 'dsh-vault-rotate-result-hint',
  rotateSkipped: 'dsh-vault-rotate-skipped',
  rotateSkippedRow: 'dsh-vault-rotate-skipped-row',
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
/* ── 主题变量：全部派生自 DSH token，明暗自动跟随 ────────────────────
   只有一个强调色（--v-accent），其余是中性灰阶。 */
.dsh-vault{
  --v-accent:var(--dsw-alias-state-business-primary,#3b82f6);
  --v-accent-soft:color-mix(in srgb,var(--v-accent) 10%,transparent);
  --v-accent-line:color-mix(in srgb,var(--v-accent) 36%,transparent);
  --v-text:var(--dsw-alias-label-primary,#111827);
  --v-text-2:var(--dsw-alias-label-secondary,#5b6068);
  --v-text-3:var(--dsw-alias-label-tertiary,#8b9098);
  --v-border:var(--dsw-alias-border-l1,rgba(127,127,127,.16));
  --v-border-2:var(--dsw-alias-border-l2,rgba(127,127,127,.26));
  --v-card:var(--dsw-alias-bg-layer-1,transparent);
  /* 浮层实底：--v-card 可能是 transparent（贴底色），弹窗与原地展开卡必须是不
     透明的一层，否则会透出后面的列表看起来像蒙了灰。 */
  --v-raise:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#16181d));
  --v-hover:color-mix(in srgb,var(--v-text-3) 10%,transparent);
  --v-soft:color-mix(in srgb,var(--v-text-3) 6%,transparent);
  --v-sunk:color-mix(in srgb,var(--v-text-3) 4%,transparent);
  --v-ok:var(--dsw-alias-state-success-primary,#1e7d43);
  --v-warn:var(--dsw-alias-state-warn-primary,#c2740a);
  --v-err:var(--dsw-alias-state-error-primary,#c0392b);
  --v-r-ctrl:9px;
  --v-r-card:14px;
  --v-r-pill:999px;
  --v-shadow:0 10px 30px color-mix(in srgb,var(--v-text) 14%,transparent);
  position:relative;
  flex:1;min-width:0;min-height:0;
  display:flex;flex-direction:column;overflow:hidden;
  color:var(--v-text);
  font-size:13px;
  box-sizing:border-box;
}

/* ── 顶部：说明句独占一行，搜索框在它下面 ──────────────────────────
   说明句是**信任声明**（「密码只保存在本机、不会发送给模型」），它必须能被
   读一遍而不是被挤成一行小字贴在按钮边上——用户对这个页面最不放心的就是这
   件事，所以给它独立一行、正常字号、二级字色。 */
.dsh-vault-head{
  flex:none;display:flex;flex-direction:column;gap:10px;
  padding:14px 20px 12px;
  border-bottom:1px solid var(--v-border);
  box-sizing:border-box;
}
.dsh-vault-head-main{display:flex;align-items:flex-start;gap:12px;min-width:0}
.dsh-vault-title{margin:0;font-size:16px;font-weight:600;line-height:22px;letter-spacing:.01em;flex:none}
.dsh-vault-hint{
  flex:1;min-width:0;margin:0;
  font-size:12px;line-height:18px;color:var(--v-text-2);
  /* 说明句里带一句「点眼睛才显示」，允许折两行，但不许撑高到挤压卡片区 */
  display:block;
}
.dsh-vault-head-actions{flex:none;display:flex;align-items:center;gap:6px;margin-left:auto}

.dsh-vault-ghost-btn{
  display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;
  border:1px solid var(--v-border);border-radius:var(--v-r-ctrl);
  background:transparent;color:var(--v-text-2);
  font-family:inherit;font-size:12px;font-weight:500;line-height:16px;
  cursor:pointer;white-space:nowrap;
  transition:border-color .15s ease,color .15s ease,background .15s ease;
}
.dsh-vault-ghost-btn:hover{border-color:var(--v-border-2);color:var(--v-text);background:var(--v-soft)}
.dsh-vault-ghost-btn:active{transform:scale(.98)}
.dsh-vault-ghost-btn:disabled{opacity:.45;cursor:default}

.dsh-vault-search-wrap{
  display:flex;align-items:center;gap:8px;
  height:34px;box-sizing:border-box;padding:0 12px;
  border:1px solid var(--v-border);border-radius:var(--v-r-pill);
  background:var(--v-sunk);
  transition:border-color .16s ease,box-shadow .16s ease,background .16s ease;
}
.dsh-vault-search-wrap:focus-within{
  border-color:var(--v-accent);background:var(--v-card);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-accent) 12%,transparent);
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
  background:color-mix(in srgb,var(--v-text-3) 22%,transparent);
  color:var(--v-card);font-size:11px;line-height:1;cursor:pointer;
}
.dsh-vault-search-clear:hover{background:color-mix(in srgb,var(--v-text-3) 42%,transparent)}

/* ── 滚动区：分组卡一列排开 ────────────────────────────────────── */
.dsh-vault-scroll{
  flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;
  padding:16px 20px 40px;box-sizing:border-box;
  display:flex;flex-direction:column;gap:14px;
  scrollbar-gutter:stable;
}
.dsh-vault-scroll::-webkit-scrollbar{width:8px}
.dsh-vault-scroll::-webkit-scrollbar-thumb{
  background:var(--v-border-2);border-radius:4px;
}

/* ── 场景分组卡 ────────────────────────────────────────────────── */
.dsh-vault-group{
  flex:none;
  border:1px solid var(--v-border);
  border-radius:var(--v-r-card);
  background:var(--v-card);
  overflow:hidden;
  animation:dsh-vault-rise .26s cubic-bezier(.2,.8,.2,1) backwards;
  animation-delay:calc(var(--v-i,0) * 26ms);
}
.dsh-vault-group-head{
  display:flex;align-items:center;gap:9px;
  padding:11px 14px;box-sizing:border-box;
  min-width:0;
}
.dsh-vault-group-icon{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;border-radius:8px;
  background:var(--v-soft);color:var(--v-text-2);
}
/* 场景名本身就是「改名」的按钮：低频动作藏在零成本的点按里，卡头不加编辑图标
   （参考图里卡头只有名字与动作，多一枚铅笔图标就多一份噪声）。 */
.dsh-vault-group-name{
  flex:none;
  border:none;background:transparent;padding:0;
  font-family:inherit;font-size:13.5px;font-weight:600;line-height:18px;
  color:var(--v-text);white-space:nowrap;cursor:pointer;
  transition:color .14s ease;
}
.dsh-vault-group-name:hover{color:var(--v-accent)}
.dsh-vault-group-name:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--v-accent) 40%,transparent);border-radius:5px}
.dsh-vault-group-desc{
  flex:1;min-width:0;
  font-size:11.5px;line-height:16px;color:var(--v-text-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-group-count{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  min-width:20px;height:18px;box-sizing:border-box;padding:0 6px;
  border-radius:var(--v-r-pill);
  background:color-mix(in srgb,var(--v-text-3) 15%,transparent);
  color:var(--v-text-3);
  font-size:11px;font-weight:600;line-height:18px;
  font-variant-numeric:tabular-nums;
}
/* 「加一条」：这是分组卡头上唯一的动作。做成常显而不是 hover 才出现——
   参考图里那个箭头也是常显的，且这个页面的主要动作就是「补一条记录」。 */
.dsh-vault-group-add{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;
  border:1px solid var(--v-border);border-radius:8px;
  background:transparent;color:var(--v-text-2);cursor:pointer;
  transition:border-color .15s ease,color .15s ease,background .15s ease,transform .12s ease;
}
.dsh-vault-group-add:hover{
  border-color:var(--v-accent-line);color:var(--v-accent);background:var(--v-accent-soft);
}
.dsh-vault-group-add:active{transform:scale(.94)}
.dsh-vault-group-body{display:flex;flex-direction:column;padding:0 8px 8px}

/* ── 记录行：左图标 + 标题/摘要 + 行尾箭头 ────────────────────────── */
.dsh-vault-row{
  display:flex;align-items:center;gap:10px;
  width:100%;box-sizing:border-box;
  padding:9px 8px;
  border:none;border-radius:10px;
  background:transparent;color:inherit;text-align:left;
  font-family:inherit;cursor:pointer;
  transition:background .14s ease;
}
.dsh-vault-row:hover{background:var(--v-hover)}
.dsh-vault-row:focus-visible{
  outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--v-accent) 40%,transparent);
}
.dsh-vault-row-sel,.dsh-vault-row-sel:hover{background:var(--v-accent-soft)}
.dsh-vault-row-icon{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:30px;border-radius:9px;
  background:var(--v-soft);color:var(--v-text-2);
}
.dsh-vault-row-sel .dsh-vault-row-icon{color:var(--v-accent)}
.dsh-vault-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-vault-row-title{
  font-size:13px;font-weight:500;line-height:18px;color:var(--v-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-row-sub{
  font-size:11.5px;line-height:16px;color:var(--v-text-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  /* 摘要里会混排「用户名：xxx · 密码：●●●●●●」，用等宽数字让圆点不跳 */
  font-variant-numeric:tabular-nums;
}
.dsh-vault-row-tail{flex:none;display:flex;align-items:center;gap:6px}
.dsh-vault-row-arrow{display:inline-flex;color:var(--v-text-3);opacity:0;transition:opacity .14s ease,transform .14s ease}
.dsh-vault-row:hover .dsh-vault-row-arrow{opacity:1;transform:translateX(1px)}
.dsh-vault-row:focus-visible .dsh-vault-row-arrow{opacity:1}

/* 已归档徽标：唯一一种「这条记录现在不太一样」的行内标记，用中性色而不是强调色
   ——一页里铺满彩色徽标会把强调色稀释掉。（原来的「待确认」徽标已随待确认机制
   一起退役：档案现在没有待确认态，行尾只剩这一枚。） */
.dsh-vault-badge-archived{
  display:inline-flex;align-items:center;gap:4px;
  height:17px;padding:0 6px;border-radius:var(--v-r-pill);
  font-size:10.5px;font-weight:600;line-height:17px;white-space:nowrap;
  color:var(--v-text-3);background:color-mix(in srgb,var(--v-text-3) 14%,transparent);
}

/* ── 空态：一句话中文引导（用户明确要求每个场景都给）─────────────── */
.dsh-vault-empty{
  display:flex;align-items:flex-start;gap:9px;
  padding:14px 12px 15px;box-sizing:border-box;
  border-radius:10px;background:var(--v-sunk);
  margin:0 0 4px;
}
.dsh-vault-empty-icon{flex:none;display:inline-flex;color:var(--v-text-3);margin-top:1px}
.dsh-vault-empty-text{font-size:12.5px;line-height:19px;color:var(--v-text-2)}
.dsh-vault-empty-hint{display:block;margin-top:2px;font-size:11.5px;line-height:17px;color:var(--v-text-3)}

/* ── 加载态（骨架）：不做全屏 spinner，骨架与真实行同高，切换时不跳 ── */
.dsh-vault-skeleton{
  border:1px solid var(--v-border);border-radius:var(--v-r-card);
  padding:12px;display:flex;flex-direction:column;gap:10px;
  box-sizing:border-box;
}
.dsh-vault-skeleton-row{
  height:36px;border-radius:10px;
  background:linear-gradient(90deg,var(--v-soft) 25%,var(--v-hover) 50%,var(--v-soft) 75%);
  background-size:200% 100%;
  animation:dsh-vault-shimmer 1.1s linear infinite;
}
/* ── 错误态：一行可读中文 + 重试按钮（绝不白屏）─────────────────── */
.dsh-vault-error{
  display:flex;align-items:center;gap:10px;
  padding:12px 14px;box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--v-err) 34%,transparent);
  border-radius:var(--v-r-card);
  background:color-mix(in srgb,var(--v-err) 8%,transparent);
  color:var(--v-err);
}
.dsh-vault-error-text{flex:1;min-width:0;font-size:12.5px;line-height:19px;word-break:break-word}
.dsh-vault-error-retry{
  flex:none;height:26px;padding:0 12px;
  border:1px solid color-mix(in srgb,var(--v-err) 46%,transparent);
  border-radius:var(--v-r-ctrl);background:transparent;color:var(--v-err);
  font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;
}
.dsh-vault-error-retry:hover{background:color-mix(in srgb,var(--v-err) 12%,transparent)}
/* 顶部提示条（「已保存」「只看某分组」）。
   默认中性二级字色：红色留给真正的错误（.dsh-vault-error）——把「已保存」
   也涂成红的话，红色就不再表示「出事了」。 */
.dsh-vault-notice{
  flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:9px 20px 0;
  font-size:11.5px;line-height:17px;color:var(--v-text-2);
}

/* ══ 详情面板：内容本体 + 两种外壳 ══════════════════════════════════
   同一条记录有两种呈现方式，壳不同、内容完全一样（Panel 与 DetailDrawer 共用
   同一份组件）：

   · .dsh-vault-expand —— **列表里原地展开**（查看 / 编辑已有记录）。
     它就长在被点开的那一行下面，是页面内容的一部分，所以没有遮罩、没有浮层
     投影，只有一圈描边把「这是展开出来的」和「这是列表行」分开。
     这是用户明确要的形态：点开一条记录不该把整页压暗、也不该从右边滑出来。

   · .dsh-vault-modal —— **居中弹窗**（新建记录 / 健康检查 / 备份恢复）。
     这三个都是「一次性的整块任务」：新建时列表里根本没有对应那一行可展开，
     健康与备份是巡检报表、不属于任何一条记录，所以给弹窗。
     ⚠ 外壳必须是 position:absolute 而不是 fixed：这个页面在官方 main 槽位里，
     fixed 会连侧栏与顶栏一起盖住。absolute 只覆盖 .dsh-vault 这一屏，
     语义是「在这块区域里居中」，用户仍然看得见侧栏、能随时切走。 */
.dsh-vault-backdrop{
  position:absolute;inset:0;z-index:20;
  display:flex;align-items:center;justify-content:center;
  padding:32px 24px;box-sizing:border-box;
  /* 遮罩几乎透明：只负责吃掉点击与一点点聚焦感，绝不再把整页压暗。
     用户说的「灰蒙蒙」就是旧版那层 22% 文字色盖在列表上造成的。 */
  background:color-mix(in srgb,var(--v-text) 6%,transparent);
  animation:dsh-vault-fade .16s ease;
}
.dsh-vault-modal{
  position:relative;
  display:flex;flex-direction:column;
  width:min(560px,100%);
  max-height:100%;min-height:0;
  background:var(--v-card);
  /* 弹窗底必须是实色：--v-card 在官方主题里可能是 transparent（贴底色），
     那样会透出后面的列表、又变成「灰蒙蒙」。这里用底色 token 兜底纯色。 */
  background-color:var(--dsw-alias-bg-layer-1,var(--v-raise));
  border:1px solid var(--v-border-2);
  border-radius:var(--v-r-card);
  box-shadow:var(--v-shadow);
  box-sizing:border-box;
  animation:dsh-vault-pop .22s cubic-bezier(.2,.8,.2,1);
}
.dsh-vault-expand{
  position:relative;
  display:flex;flex-direction:column;
  margin:2px 8px 10px;
  background:var(--v-card);
  background-color:var(--dsw-alias-bg-layer-1,var(--v-raise));
  border:1px solid var(--v-border-2);
  border-radius:var(--v-r-card);
  box-sizing:border-box;
  overflow:hidden;
  animation:dsh-vault-rise .2s cubic-bezier(.2,.8,.2,1);
}
.dsh-vault-panel-head{
  flex:none;display:flex;align-items:center;gap:8px;
  padding:14px 12px 12px 18px;
  border-bottom:1px solid var(--v-border);
  box-sizing:border-box;
}
.dsh-vault-panel-title-input{
  flex:1;min-width:0;
  border:1px solid transparent;border-radius:var(--v-r-ctrl);
  background:transparent;padding:4px 8px;margin:0 -8px;
  font-family:inherit;font-size:15px;font-weight:600;line-height:22px;color:var(--v-text);
  transition:border-color .15s ease,background .15s ease;
}
.dsh-vault-panel-title-input:hover{border-color:var(--v-border)}
.dsh-vault-panel-title-input:focus{
  outline:none;border-color:var(--v-accent);background:var(--v-raise);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-accent) 12%,transparent);
}
.dsh-vault-panel-close{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;padding:0;border:none;border-radius:8px;
  background:transparent;color:var(--v-text-2);cursor:pointer;
  transition:background .14s ease,color .14s ease;
}
.dsh-vault-panel-close:hover{background:var(--v-hover);color:var(--v-text)}
.dsh-vault-panel-body{
  flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;
  padding:14px 18px 18px;box-sizing:border-box;
  display:flex;flex-direction:column;gap:18px;
}
.dsh-vault-panel-body::-webkit-scrollbar{width:8px}
.dsh-vault-panel-body::-webkit-scrollbar-thumb{background:var(--v-border-2);border-radius:4px}
.dsh-vault-panel-foot{
  flex:none;display:flex;align-items:center;gap:8px;
  padding:12px 18px;box-sizing:border-box;
  border-top:1px solid var(--v-border);
}

/* ── 抽屉内小节 ─────────────────────────────────────────────────── */
.dsh-vault-section{display:flex;flex-direction:column;gap:8px}
.dsh-vault-section-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-vault-section-title{
  flex:none;font-size:11.5px;font-weight:600;line-height:16px;
  color:var(--v-text-3);letter-spacing:.06em;
}
.dsh-vault-section-add{
  flex:none;display:inline-flex;align-items:center;gap:4px;
  height:22px;padding:0 8px;margin-left:auto;
  border:1px solid var(--v-border);border-radius:var(--v-r-pill);
  background:transparent;color:var(--v-text-2);
  font-family:inherit;font-size:11.5px;cursor:pointer;
}
.dsh-vault-section-add:hover{border-color:var(--v-accent-line);color:var(--v-accent)}

/* ── 字段行 ─────────────────────────────────────────────────────── */
.dsh-vault-field{
  display:flex;flex-direction:column;gap:3px;
  padding:8px 10px;box-sizing:border-box;
  border:1px solid var(--v-border);border-radius:10px;
  background:var(--v-sunk);
}
.dsh-vault-field-label{
  display:flex;align-items:center;gap:6px;
  font-size:11.5px;line-height:16px;color:var(--v-text-3);font-weight:500;
}
.dsh-vault-field-key-hint{
  font-size:10.5px;color:var(--v-text-3);opacity:.7;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
/* wrap 是为了验证码那块：按钮排在眼睛旁边，展开后的 6 位码自己换到下一行
   （不换行的话它会把这一行撑宽，值本身被挤成一列竖排文字）。 */
.dsh-vault-field-value-row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.dsh-vault-field-value{
  flex:1;min-width:0;
  font-size:13px;line-height:19px;color:var(--v-text);
  word-break:break-all;
  border:1px solid transparent;border-radius:7px;
  background:transparent;padding:3px 6px;margin:0 -6px;
  font-family:inherit;
  /* 这个元素是 button（点一下进入编辑）：必须显式左对齐并把光标改成文本光标，
     否则浏览器默认居中 + 手型，看起来像一个按钮而不是一个值。 */
  text-align:left;cursor:text;
  transition:border-color .15s ease,background .15s ease;
}
.dsh-vault-field-value:hover{border-color:var(--v-border)}
.dsh-vault-field-value:focus{
  outline:none;border-color:var(--v-accent);background:var(--v-card);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-accent) 12%,transparent);
}
.dsh-vault-field-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em}
/* 敏感值的圆点：比正文小一号、字距拉开，一眼看出「这里有个值但看不见」 */
.dsh-vault-field-secret{
  flex:1;min-width:0;
  font-size:11px;line-height:19px;letter-spacing:2.5px;color:var(--v-text-3);
  padding:3px 6px;margin:0 -6px;
  user-select:none;
}
.dsh-vault-field-eye{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;
  border:1px solid transparent;border-radius:7px;
  background:transparent;color:var(--v-text-3);cursor:pointer;
  transition:color .14s ease,background .14s ease,border-color .14s ease;
}
.dsh-vault-field-eye:hover{color:var(--v-text);background:var(--v-hover)}
.dsh-vault-field-eye-on{color:var(--v-accent);border-color:var(--v-accent-line);background:var(--v-accent-soft)}
.dsh-vault-field-input{
  flex:1;min-width:0;
  border:1px solid var(--v-accent);border-radius:7px;
  background:var(--v-card);padding:3px 7px;
  font-family:inherit;font-size:13px;line-height:19px;color:var(--v-text);
  outline:none;
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-accent) 12%,transparent);
}

/* ── 照片网格 ───────────────────────────────────────────────────── */
.dsh-vault-photo-grid{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;
}
.dsh-vault-photo-card{
  position:relative;display:flex;flex-direction:column;gap:4px;
  border:1px solid var(--v-border);border-radius:10px;overflow:hidden;
  background:var(--v-sunk);
}
.dsh-vault-photo-thumb{
  width:100%;aspect-ratio:4/3;object-fit:cover;display:block;
  cursor:zoom-in;background:var(--v-soft);
  /* 图片是从 /image?sha= 直出的字节流：加载完成前这里是纯色块，
     不会出现破图标（alt 空字符串 + 底色） */
}
.dsh-vault-photo-label{
  padding:0 6px 5px;
  font-size:10.5px;line-height:14px;color:var(--v-text-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-photo-del{
  position:absolute;top:4px;right:4px;
  display:inline-flex;align-items:center;justify-content:center;
  width:20px;height:20px;padding:0;
  border:1px solid rgba(255,255,255,.24);border-radius:6px;
  background:rgba(15,17,23,.66);color:#fff;cursor:pointer;
  opacity:0;transition:opacity .14s ease,background .14s ease;
}
.dsh-vault-photo-card:hover .dsh-vault-photo-del{opacity:1}
.dsh-vault-photo-del:hover{background:rgba(15,17,23,.88)}
/* 上传按钮：普通场景是虚线占位块；证件类场景（scene.photoFirst）给主色实心，
   因为那些场景的主内容就是照片，不给醒目入口用户根本找不到。 */
.dsh-vault-photo-upload{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  min-height:88px;box-sizing:border-box;padding:8px;
  border:1px dashed var(--v-border-2);border-radius:10px;
  background:transparent;color:var(--v-text-3);
  font-family:inherit;font-size:11.5px;line-height:16px;
  cursor:pointer;transition:border-color .15s ease,color .15s ease,background .15s ease;
}
.dsh-vault-photo-upload:hover{border-color:var(--v-accent-line);color:var(--v-accent);background:var(--v-accent-soft)}
.dsh-vault-photo-upload-pri{
  border-style:solid;border-color:var(--v-accent-line);
  background:var(--v-accent-soft);color:var(--v-accent);font-weight:600;
}
.dsh-vault-photo-upload-pri:hover{border-color:var(--v-accent)}
.dsh-vault-photo-busy{
  grid-column:1/-1;
  font-size:11.5px;line-height:17px;color:var(--v-text-2);
}

/* ── 变更历史：时间 · 字段 · 旧 → 新 ─────────────────────────────── */
.dsh-vault-change-list{display:flex;flex-direction:column;gap:1px}
.dsh-vault-change-row{
  display:flex;align-items:flex-start;gap:9px;
  padding:6px 2px;
  border-bottom:1px solid var(--v-border);
}
.dsh-vault-change-row:last-child{border-bottom:none}
.dsh-vault-change-time{
  flex:none;width:64px;
  font-size:11px;line-height:17px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-change-body{flex:1;min-width:0;font-size:12px;line-height:17px;color:var(--v-text-2)}
.dsh-vault-change-field{color:var(--v-text);font-weight:500}
.dsh-vault-change-action{
  display:inline-flex;align-items:center;
  margin-right:5px;padding:0 5px;height:15px;
  border-radius:4px;font-size:10px;line-height:15px;
  background:color-mix(in srgb,var(--v-text-3) 14%,transparent);
  color:var(--v-text-3);
}
.dsh-vault-change-diff{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;margin-top:2px;min-width:0}
.dsh-vault-change-old{
  color:var(--v-text-3);text-decoration:line-through;
  word-break:break-all;max-width:100%;
}
.dsh-vault-change-new{color:var(--v-text);word-break:break-all;max-width:100%}
.dsh-vault-change-old + .dsh-vault-change-new::before{content:"→ ";color:var(--v-text-3)}

/* ── 按钮 ───────────────────────────────────────────────────────── */
.dsh-vault-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:30px;padding:0 14px;box-sizing:border-box;
  border:1px solid var(--v-border-2);border-radius:var(--v-r-ctrl);
  background:transparent;color:var(--v-text-2);
  font-family:inherit;font-size:12.5px;font-weight:500;line-height:18px;
  cursor:pointer;white-space:nowrap;
  transition:border-color .14s ease,color .14s ease,background .14s ease,transform .12s ease;
}
.dsh-vault-btn:hover:not(:disabled){border-color:var(--v-border-2);color:var(--v-text);background:var(--v-hover)}
.dsh-vault-btn:active:not(:disabled){transform:scale(.98)}
.dsh-vault-btn:disabled{opacity:.45;cursor:default}
.dsh-vault-btn-pri{
  border-color:transparent;background:var(--v-accent);color:var(--dsw-alias-label-on-primary,#fff);
  font-weight:600;
}
.dsh-vault-btn-pri:hover:not(:disabled){
  background:var(--dsw-alias-button-info-hover,var(--v-accent));
  border-color:transparent;color:var(--dsw-alias-label-on-primary,#fff);
}
.dsh-vault-btn-danger:hover:not(:disabled){
  border-color:color-mix(in srgb,var(--v-err) 46%,transparent);
  color:var(--v-err);background:color-mix(in srgb,var(--v-err) 9%,transparent);
}
.dsh-vault-btn-ghost{border-color:transparent;background:transparent}

/* ── 大图查看 ───────────────────────────────────────────────────── */
.dsh-vault-lightbox{
  position:fixed;inset:0;z-index:4000;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  padding:28px;box-sizing:border-box;
  background:rgba(8,9,12,.86);
  animation:dsh-vault-fade .16s ease;
  cursor:zoom-out;
}
.dsh-vault-lightbox-img{
  max-width:100%;max-height:calc(100% - 46px);
  object-fit:contain;border-radius:10px;
  box-shadow:0 18px 50px rgba(0,0,0,.5);
}
.dsh-vault-lightbox-bar{
  display:flex;align-items:center;gap:12px;
  font-size:12px;line-height:18px;color:rgba(255,255,255,.72);
}

/* ── 底部统计条：滚动区末尾的一行小字 + 低频动作 ────────────────── */
.dsh-vault-foot{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  margin-top:4px;padding-top:12px;
  border-top:1px solid var(--v-border);
  font-size:11.5px;line-height:17px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-foot-actions{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}

/* ══ 健康入口（头部那枚按钮）════════════════════════════════════════
   它显示「待处理条数」，所以不能只是一个图标：数字是这条入口存在的理由。
   有问题时用警示色（这是页面上唯一允许出现的第二种颜色状态：它表达的是
   「出事了」，与错误行同一语义），没问题时回到中性。 */
.dsh-vault-health-btn{
  display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;
  border:1px solid var(--v-border);border-radius:var(--v-r-ctrl);
  background:transparent;color:var(--v-text-2);
  font-family:inherit;font-size:12px;font-weight:500;line-height:16px;
  cursor:pointer;white-space:nowrap;
  transition:border-color .15s ease,color .15s ease,background .15s ease;
}
.dsh-vault-health-btn:hover{border-color:var(--v-border-2);color:var(--v-text);background:var(--v-soft)}
.dsh-vault-health-btn[data-tone="warn"]{
  border-color:color-mix(in srgb,var(--v-warn) 40%,transparent);
  color:var(--v-warn);background:color-mix(in srgb,var(--v-warn) 8%,transparent);
}
.dsh-vault-health-btn[data-tone="bad"]{
  border-color:color-mix(in srgb,var(--v-err) 42%,transparent);
  color:var(--v-err);background:color-mix(in srgb,var(--v-err) 8%,transparent);
}
/* 徽标：数字反相（底=语义色、字=卡片底色）。不用 currentColor 做底——
   那样字色与底色同源，深色主题下数字会整块消失。 */
.dsh-vault-health-badge{
  display:inline-flex;align-items:center;justify-content:center;
  min-width:17px;height:17px;box-sizing:border-box;padding:0 5px;
  border-radius:var(--v-r-pill);
  background:var(--v-text-3);color:var(--v-card);
  font-size:10.5px;font-weight:700;line-height:17px;
  font-variant-numeric:tabular-nums;
}
.dsh-vault-health-btn[data-tone="warn"] .dsh-vault-health-badge{background:var(--v-warn);color:var(--v-card)}
.dsh-vault-health-btn[data-tone="bad"] .dsh-vault-health-badge{background:var(--v-err);color:var(--v-card)}
/* 全部健康：不显示「0」——一个灰 0 会让人以为有 0 件事要处理（其实是没有
   这个维度），图标本身已经说明了。 */
.dsh-vault-health-btn[data-tone="good"] .dsh-vault-health-badge{display:none}

/* ══ 健康抽屉内容 ══════════════════════════════════════════════════ */
.dsh-vault-health-score{
  display:flex;align-items:center;gap:14px;
  padding:14px;box-sizing:border-box;
  border:1px solid var(--v-border);border-radius:var(--v-r-card);
  background:var(--v-sunk);
}
.dsh-vault-health-score-ring{flex:none;position:relative;width:62px;height:62px}
.dsh-vault-health-score-ring svg{display:block;transform:rotate(-90deg)}
.dsh-vault-health-score-num{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:19px;font-weight:600;line-height:1;color:var(--v-text);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-health-score-label{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsh-vault-health-facts{display:flex;flex-wrap:wrap;gap:6px}
.dsh-vault-health-fact{
  display:inline-flex;align-items:center;gap:5px;
  height:22px;padding:0 9px;box-sizing:border-box;
  border:1px solid var(--v-border);border-radius:var(--v-r-pill);
  font-size:11.5px;line-height:22px;color:var(--v-text-2);
  font-variant-numeric:tabular-nums;
}
.dsh-vault-health-fact-num{font-weight:600;color:var(--v-text)}

.dsh-vault-health-group{display:flex;flex-direction:column;gap:6px}
.dsh-vault-health-group-head{
  display:flex;align-items:center;gap:7px;
  font-size:11.5px;font-weight:600;line-height:16px;letter-spacing:.04em;
  color:var(--v-text-3);
}
/* 严重度：只靠一枚小圆点 + 文字，不做色块条（一页里有三档严重度，色块会把
   整个抽屉变成红黄绿灯箱）。 */
.dsh-vault-health-sev{
  display:inline-flex;align-items:center;gap:5px;
  font-size:11px;font-weight:600;line-height:16px;
}
.dsh-vault-health-sev::before{
  content:"";width:6px;height:6px;border-radius:50%;background:currentColor;
}
.dsh-vault-health-sev[data-sev="high"]{color:var(--v-err)}
.dsh-vault-health-sev[data-sev="medium"]{color:var(--v-warn)}
.dsh-vault-health-sev[data-sev="low"]{color:var(--v-text-3)}

.dsh-vault-health-issue{
  display:flex;align-items:flex-start;gap:9px;
  width:100%;box-sizing:border-box;
  padding:9px 10px;text-align:left;
  border:1px solid var(--v-border);border-radius:10px;
  background:transparent;color:inherit;font-family:inherit;
  cursor:pointer;
  transition:border-color .14s ease,background .14s ease;
}
.dsh-vault-health-issue:hover{border-color:var(--v-border-2);background:var(--v-hover)}
.dsh-vault-health-issue:focus-visible{
  outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--v-accent) 40%,transparent);
}
.dsh-vault-health-issue-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-vault-health-issue-title{
  font-size:12.5px;font-weight:500;line-height:18px;color:var(--v-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-health-issue-msg{font-size:11.5px;line-height:17px;color:var(--v-text-2)}
.dsh-vault-health-issue-detail{
  font-size:11px;line-height:16px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}

/* ══ 备份与恢复 ═════════════════════════════════════════════════════
   这两块是**救命通道**，所以视觉上要克制但信息必须齐：指纹（可核对）、
   口令（不落盘）、覆盖警告（红）。 */
.dsh-vault-backup{display:flex;flex-direction:column;gap:18px}
.dsh-vault-backup-section{
  display:flex;flex-direction:column;gap:9px;
  padding:13px 14px;box-sizing:border-box;
  border:1px solid var(--v-border);border-radius:var(--v-r-card);
  background:var(--v-sunk);
}
.dsh-vault-backup-label{
  display:flex;align-items:center;gap:6px;
  font-size:12.5px;font-weight:600;line-height:18px;color:var(--v-text);
}
.dsh-vault-backup-label svg{color:var(--v-text-3)}
.dsh-vault-backup-input{
  width:100%;box-sizing:border-box;height:32px;padding:0 10px;
  border:1px solid var(--v-border-2);border-radius:var(--v-r-ctrl);
  background:var(--v-card);color:var(--v-text);
  font-family:inherit;font-size:13px;line-height:18px;
  transition:border-color .15s ease,box-shadow .15s ease;
}
.dsh-vault-backup-input:focus{
  outline:none;border-color:var(--v-accent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--v-accent) 12%,transparent);
}
.dsh-vault-backup-input::placeholder{color:var(--v-text-3)}
.dsh-vault-backup-hint{font-size:11.5px;line-height:17px;color:var(--v-text-3)}
.dsh-vault-backup-fingerprint{
  display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;
  padding:6px 9px;box-sizing:border-box;
  border-radius:9px;background:var(--v-soft);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11.5px;line-height:17px;color:var(--v-text-2);
  word-break:break-all;
}
.dsh-vault-backup-fingerprint b{color:var(--v-text);font-weight:600}
.dsh-vault-backup-warn{
  display:flex;align-items:flex-start;gap:8px;
  padding:9px 11px;box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--v-err) 34%,transparent);
  border-radius:10px;
  background:color-mix(in srgb,var(--v-err) 8%,transparent);
  font-size:11.5px;line-height:17px;color:var(--v-err);
}
.dsh-vault-backup-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* ══ 生成按钮（密码字段右侧）════════════════════════════════════════
   与眼睛、验证码按钮并排，用同一档强调色（accent = 可逆动作）：它只把新口令
   填进输入框，**不落库**，用户还得回车 / 点保存才写入，所以浏览态也给这枚按钮。
   与它形成对照的是 rotate-btn 的 warn 色与确认块的 err 色——那两级才是不可逆的。 */
.dsh-vault-gen-btn{
  flex:none;display:inline-flex;align-items:center;gap:4px;
  height:26px;padding:0 9px;
  border:1px solid var(--v-accent-line);border-radius:var(--v-r-pill);
  background:var(--v-accent-soft);color:var(--v-accent);
  font-family:inherit;font-size:11.5px;font-weight:600;line-height:26px;
  cursor:pointer;white-space:nowrap;
  transition:background .14s ease,border-color .14s ease;
}
.dsh-vault-gen-btn:hover:not(:disabled){background:color-mix(in srgb,var(--v-accent) 18%,transparent)}
.dsh-vault-gen-btn:disabled{opacity:.5;cursor:default}
.dsh-vault-gen-hint{
  flex:1 1 100%;
  font-size:11px;line-height:16px;color:var(--v-text-3);
  font-variant-numeric:tabular-nums;
}

/* ══ 批量轮换（健康抽屉里的「一键修」）══════════════════════════════
   这是全模块唯一会给**多条记录**同时写库的动作，视觉上必须与其它条目明显不同：
   一块独立的带框区域，红边，确认按钮用 danger。 */
.dsh-vault-rotate-block{
  display:flex;flex-direction:column;gap:8px;
  margin-top:2px;padding:11px 12px;box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--v-warn) 34%,transparent);
  border-radius:10px;
  background:color-mix(in srgb,var(--v-warn) 7%,transparent);
}
.dsh-vault-rotate-block-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-vault-rotate-block-title{
  flex:1;min-width:0;
  font-size:12px;line-height:18px;color:var(--v-text-2);
}
.dsh-vault-rotate-btn{
  flex:none;display:inline-flex;align-items:center;gap:5px;
  height:26px;padding:0 10px;
  border:1px solid color-mix(in srgb,var(--v-warn) 44%,transparent);
  border-radius:var(--v-r-pill);
  background:transparent;color:var(--v-warn);
  font-family:inherit;font-size:11.5px;font-weight:600;line-height:26px;
  cursor:pointer;white-space:nowrap;
  transition:background .14s ease;
}
.dsh-vault-rotate-btn:hover:not(:disabled){background:color-mix(in srgb,var(--v-warn) 14%,transparent)}
.dsh-vault-rotate-btn:disabled{opacity:.5;cursor:default}

/* 二次确认块：把「会立即写入、无法恢复」这句话放大到足以被读到。
   这一屏是整条链上唯一不可撤销的动作，文案比按钮更重要。 */
.dsh-vault-rotate-confirm{
  display:flex;flex-direction:column;gap:9px;
  padding:12px;box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--v-err) 40%,transparent);
  border-radius:10px;
  background:color-mix(in srgb,var(--v-err) 9%,transparent);
}
.dsh-vault-rotate-confirm-title{
  font-size:12.5px;font-weight:600;line-height:19px;color:var(--v-err);
}
.dsh-vault-rotate-confirm-text{
  font-size:11.5px;line-height:18px;color:var(--v-text-2);
}
.dsh-vault-rotate-confirm-text b{color:var(--v-text);font-weight:600}
.dsh-vault-rotate-confirm-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* 结果面板：新密码必须能一眼看清、能复制。这是本功能唯一的产出。 */
.dsh-vault-rotate-result{
  display:flex;flex-direction:column;gap:8px;
  padding:12px;box-sizing:border-box;
  border:1px solid var(--v-border-2);border-radius:10px;
  background:var(--v-sunk);
}
.dsh-vault-rotate-result-title{
  font-size:12.5px;font-weight:600;line-height:19px;color:var(--v-text);
}
.dsh-vault-rotate-result-row{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:7px 0;
  border-top:1px solid var(--v-border);
}
.dsh-vault-rotate-result-row:first-of-type{border-top:none}
.dsh-vault-rotate-result-name{
  flex:1 1 120px;min-width:0;
  font-size:12px;line-height:18px;color:var(--v-text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-vault-rotate-result-code{
  flex:none;
  padding:2px 7px;
  border-radius:6px;
  background:var(--v-soft);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:12px;line-height:18px;color:var(--v-text);
  letter-spacing:.4px;
  cursor:pointer;
  user-select:all;
  word-break:break-all;
}
.dsh-vault-rotate-result-hint{
  flex:1 1 100%;
  font-size:11px;line-height:16px;color:var(--v-text-3);
}
.dsh-vault-rotate-skipped{
  display:flex;flex-direction:column;gap:5px;
}
.dsh-vault-rotate-skipped-row{
  display:flex;align-items:flex-start;gap:6px;
  font-size:11.5px;line-height:17px;color:var(--v-text-3);
}

/* ══ TOTP 验证码 ════════════════════════════════════════════════════
   6 位码要能被一眼读出来并一次选中复制：等宽、大字距、可点击整块选中。 */
.dsh-vault-totp-btn{
  flex:none;display:inline-flex;align-items:center;gap:5px;
  height:26px;padding:0 9px;
  border:1px solid var(--v-accent-line);border-radius:var(--v-r-pill);
  background:var(--v-accent-soft);color:var(--v-accent);
  font-family:inherit;font-size:11.5px;font-weight:600;line-height:26px;
  cursor:pointer;white-space:nowrap;
  transition:background .14s ease,border-color .14s ease;
}
.dsh-vault-totp-btn:hover{background:color-mix(in srgb,var(--v-accent) 18%,transparent)}
.dsh-vault-totp-btn:disabled{opacity:.5;cursor:default}
.dsh-vault-totp-box{
  flex:1 1 100%;
  display:flex;align-items:center;gap:12px;
  padding:10px 12px;box-sizing:border-box;
  border:1px solid var(--v-accent-line);border-radius:10px;
  background:var(--v-accent-soft);
}
.dsh-vault-totp-code{
  flex:none;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:20px;font-weight:600;line-height:24px;letter-spacing:3px;
  color:var(--v-text);
  font-variant-numeric:tabular-nums;
  cursor:pointer;
  user-select:all;
}
.dsh-vault-totp-ring{flex:none;position:relative;width:28px;height:28px}
.dsh-vault-totp-ring svg{display:block;transform:rotate(-90deg)}
.dsh-vault-totp-left{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:600;line-height:1;color:var(--v-text-2);
  font-variant-numeric:tabular-nums;
}

/* ── 动效 ───────────────────────────────────────────────────────── */
@keyframes dsh-vault-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes dsh-vault-fade{from{opacity:0}to{opacity:1}}
/* 弹窗入场：从下方 8px 轻微上浮 + 缩放淡入。不用整块飞入——120ms 内的位移一大
   就会读成「界面在晃」，而这里只是把「刚刚出现」这件事说出来。 */
@keyframes dsh-vault-pop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
@keyframes dsh-vault-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}

/* 减弱动效：只关动画帧，不动布局与可见性（否则「看不看得见」会取决于这条
   媒体查询是否命中）。 */
@media (prefers-reduced-motion:reduce){
  .dsh-vault-group,.dsh-vault-backdrop,.dsh-vault-modal,.dsh-vault-expand,
  .dsh-vault-lightbox{animation:none!important}
  .dsh-vault-skeleton-row{animation:none!important}
  .dsh-vault-row,.dsh-vault-row-arrow,.dsh-vault-ghost-btn,.dsh-vault-group-add,
  .dsh-vault-photo-upload,.dsh-vault-btn,.dsh-vault-field-eye,.dsh-vault-photo-del,
  .dsh-vault-health-btn,.dsh-vault-health-issue,.dsh-vault-totp-btn,
  .dsh-vault-backup-input,.dsh-vault-gen-btn,.dsh-vault-rotate-btn{
    transition:none!important;
  }
}

/* ── 窄屏：弹窗整宽、头部说明句折行 ────────────────────────────── */
@media (max-width:720px){
  .dsh-vault-head{padding:12px 14px 10px}
  .dsh-vault-scroll{padding:12px 14px 32px}
  /* 窄屏没有多余留白可给：弹窗铺到只剩一圈能让点击落在外面关掉的缝。 */
  .dsh-vault-backdrop{padding:16px 10px}
  .dsh-vault-modal{width:100%}
  .dsh-vault-expand{margin:2px 4px 10px}
  .dsh-vault-head-main{flex-wrap:wrap}
  .dsh-vault-hint{flex-basis:100%;order:3}
  .dsh-vault-group-desc{display:none}
}

/* 深色主题：只覆盖必须手写颜色的两处（图片占位与浮层投影）。
   其余全部走 --dsw-alias-* token，随主题自动切换。 */
body[data-ds-dark-theme] .dsh-vault{
  --v-shadow:0 10px 32px rgba(0,0,0,.56);
}
body[data-ds-dark-theme] .dsh-vault-row-icon,
body[data-ds-dark-theme] .dsh-vault-group-icon{
  background:color-mix(in srgb,var(--v-text) 8%,transparent);
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
