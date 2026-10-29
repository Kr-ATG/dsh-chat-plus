/**
 * 工作台资产云端双向同步（同步设置）页面样式。
 *
 * 视觉对齐系统提示词页（SystemPromptPanel）：
 *   · 统一采用 --dsw-alias-* 与 --ds-font-family-code 规范变量
 *   · 页头 eyebrow + 大标题 + em 辅助词 + 一句定位 + 右侧操作区
 *   · 规模数字采用 1px 细线切割方块栅格（等宽 tabular-nums）
 *   · 精致发丝线与中性灰阶按钮，拒绝大面积扎眼纯色与灰蒙蒙粗糙色块
 *   · 深浅两套主题自适应
 */

let injected = false

export const syncCss = {
  root: 'dsh-sync',
  head: 'dsh-sync-head',
  headMain: 'dsh-sync-head-main',
  eyebrow: 'dsh-sync-eyebrow',
  title: 'dsh-sync-title',
  hint: 'dsh-sync-hint',
  headActions: 'dsh-sync-head-actions',

  // 按钮与操作
  btn: 'dsh-sync-btn',
  btnPrimary: 'dsh-sync-btn-primary',
  btnSuccess: 'dsh-sync-btn-success',
  btnGhost: 'dsh-sync-btn-ghost',

  // 滚动区与内容骨架
  scroll: 'dsh-sync-scroll',
  notice: 'dsh-sync-notice',
  noticeText: 'dsh-sync-notice-text',

  // 规模数字大盘（对齐 system-prompt）
  stats: 'dsh-sync-stats',
  stat: 'dsh-sync-stat',
  statLabel: 'dsh-sync-stat-label',
  statValue: 'dsh-sync-stat-value',
  statSub: 'dsh-sync-stat-sub',

  // 动态进度卡片
  progressCard: 'dsh-sync-progress-card',
  progressHead: 'dsh-sync-progress-head',
  progressTitle: 'dsh-sync-progress-title',
  progressBadge: 'dsh-sync-progress-badge',
  progressState: 'dsh-sync-progress-state',
  progressMeta: 'dsh-sync-progress-meta',
  progressTrack: 'dsh-sync-progress-track',
  progressFill: 'dsh-sync-progress-fill',
  progressList: 'dsh-sync-progress-list',
  progressRow: 'dsh-sync-progress-row',
  progressIcon: 'dsh-sync-progress-icon',
  progressName: 'dsh-sync-progress-name',
  progressDetail: 'dsh-sync-progress-detail',
  progressNotice: 'dsh-sync-progress-notice',
  progressError: 'dsh-sync-progress-error',

  // 设置表单分区卡片
  section: 'dsh-sync-section',
  sectionTitle: 'dsh-sync-section-title',
  field: 'dsh-sync-field',
  fieldHead: 'dsh-sync-field-head',
  fieldLabel: 'dsh-sync-field-label',
  fieldStatus: 'dsh-sync-field-status',
  fieldHint: 'dsh-sync-field-hint',
  input: 'dsh-sync-input',
  select: 'dsh-sync-select',
  checkboxRow: 'dsh-sync-checkbox-row',
} as const

const SHEET = [
  /* ── 页面骨架：铺满工作台容器 ── */
  '.dsh-sync{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;width:100%;box-sizing:border-box;',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);font-family:inherit;overflow:hidden}',

  /* ── 页头：eyebrow + 标题 + 定位说明 + 右侧重点动作 ── */
  '.dsh-sync-head{display:flex;align-items:flex-end;gap:16px;flex:none;flex-wrap:wrap;',
  '  padding:20px 24px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
  '.dsh-sync-head-main{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 340px}',
  '.dsh-sync-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:15px;',
  '  letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#888);user-select:none}',
  '.dsh-sync-eyebrow i{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.6}',
  '.dsh-sync-title{margin:0;font-size:22px;line-height:30px;font-weight:650;letter-spacing:-.01em}',
  '.dsh-sync-title em{font-style:normal;font-weight:400;font-size:14px;color:var(--dsw-alias-label-tertiary,#888)}',
  '.dsh-sync-hint{margin:0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-tertiary,#8b8b8b);max-width:80ch}',
  '.dsh-sync-head-actions{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap}',

  /* ── 控件：高质感按钮（参考 system-prompt 的 dsh-sp-btn 体系） ── */
  '.dsh-sync-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;box-sizing:border-box;',
  '  padding:0 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));',
  '  background:transparent;color:var(--dsw-alias-label-secondary,#b9b9b9);font-family:inherit;font-size:12.5px;',
  '  line-height:30px;cursor:pointer;white-space:nowrap;transition:background 120ms ease,color 120ms ease,border-color 120ms ease,transform 100ms ease}',
  '.dsh-sync-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.36))}',
  '.dsh-sync-btn:active:not(:disabled){transform:translateY(1px)}',
  '.dsh-sync-btn:focus-visible{outline:2px solid var(--wb2-accent,#C3CEDF);outline-offset:1px}',
  '.dsh-sync-btn:disabled{opacity:.45;cursor:not-allowed}',

  /* 主行动按钮：冷银蓝强调微渐变（与工作台主题/档案页同一套强调色） */
  '.dsh-sync-btn-primary{background:linear-gradient(180deg,var(--wb2-accent-hi,#E0E8F4),var(--wb2-accent,#C3CEDF));border-color:transparent;',
  '  color:var(--wb2-on-accent,#0F1420)!important;font-weight:550;box-shadow:0 1px 3px color-mix(in srgb,var(--wb2-accent,#C3CEDF) 25%,transparent)}',
  '.dsh-sync-btn-primary:hover:not(:disabled){filter:brightness(1.06);',
  '  border-color:transparent;box-shadow:0 2px 8px color-mix(in srgb,var(--wb2-accent,#C3CEDF) 35%,transparent)}',

  /* 次级主按钮 */
  '.dsh-sync-btn-success{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.36));',
  '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary,#f3f4f6)!important}',
  '.dsh-sync-btn-success:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',

  /* ── 滚动区 ── */
  '.dsh-sync-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;',
  '  padding:18px 24px 48px;scrollbar-width:thin;display:flex;flex-direction:column;gap:18px}',
  '.dsh-sync-scroll::-webkit-scrollbar{width:8px}',
  '.dsh-sync-scroll::-webkit-scrollbar-thumb{background:transparent;border-radius:4px}',
  '.dsh-sync-scroll:hover::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(127,127,127,.3))}',

  /* ── 提示条 notice（参考 system-prompt notice） ── */
  '.dsh-sync-notice{display:flex;align-items:flex-start;gap:10px;flex:none;padding:11px 14px;border-radius:10px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));',
  '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05))}',
  '.dsh-sync-notice-text{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary,#b0b0b0);min-width:0}',

  /* ── 规模数字大盘（完全复用系统提示词 stats 1px 细线切割方块栅格） ── */
  '.dsh-sync-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1px;flex:none;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));border-radius:12px;overflow:hidden;',
  '  background:var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
  '.dsh-sync-stat{display:flex;flex-direction:column;gap:4px;padding:12px 16px;',
  '  background:var(--dsw-alias-bg-base,#16181d)}',
  '.dsh-sync-stat-label{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b8b8b);user-select:none}',
  '.dsh-sync-stat-value{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  font-size:17px;line-height:24px;font-weight:640;color:var(--dsw-alias-label-primary,#e8e8e8);',
  '  font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-sync-stat-sub{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b8b8b);',
  '  font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ── 动态同步进度卡片（极简工业风） ── */
  '.dsh-sync-progress-card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:12px;',
  '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));',
  '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));',
  '  animation:dshSyncFadeIn .2s ease-out}',
  '@keyframes dshSyncFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
  '.dsh-sync-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
  '.dsh-sync-progress-title{display:flex;align-items:center;gap:9px}',
  '.dsh-sync-progress-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;',
  '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));font-size:11px;line-height:16px;',
  '  color:var(--dsw-alias-label-secondary,#b0b0b0);font-weight:550;user-select:none}',
  '.dsh-sync-progress-state{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8e8);',
  '  display:flex;align-items:center;gap:6px}',
  '.dsh-sync-progress-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-variant-numeric:tabular-nums}',
  '.dsh-sync-progress-track{width:100%;height:3px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.15));',
  '  border-radius:2px;overflow:hidden}',
  '.dsh-sync-progress-fill{height:100%;transition:width 250ms ease}',
  '.dsh-sync-progress-list{display:flex;flex-direction:column;gap:7px;padding-top:4px}',
  '.dsh-sync-progress-row{display:flex;align-items:center;gap:9px;font-size:12.5px;line-height:18px}',
  '.dsh-sync-progress-icon{width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex:none}',
  '.dsh-sync-progress-name{color:var(--dsw-alias-label-primary,#e8e8e8)}',
  '.dsh-sync-progress-detail{color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:12px;',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}',
  '.dsh-sync-progress-notice{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;',
  '  background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);color:#10b981;font-size:12.5px;line-height:18px}',
  '.dsh-sync-progress-error{padding:8px 12px;border-radius:8px;background:rgba(239,68,68,.1);',
  '  border:1px solid rgba(239,68,68,.25);color:#ef4444;font-size:12.5px;line-height:18px}',

  /* 进度指示图标 */
  '.dsh-sync-spin{width:11px;height:11px;border:1.8px solid var(--dsw-alias-border-l3,rgba(127,127,127,.4));',
  '  border-top-color:var(--wb2-accent,#C3CEDF);border-radius:50%;display:inline-block;animation:dshSyncSpinner .7s linear infinite}',
  '@keyframes dshSyncSpinner{to{transform:rotate(360deg)}}',
  '.dsh-sync-check{color:#10b981;font-weight:bold;font-size:12px}',
  '.dsh-sync-fail{color:#ef4444;font-weight:bold;font-size:12px}',
  '.dsh-sync-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#8b8b8b);opacity:.6}',

  /* ── 配置分段区块（参考 system-prompt 组容器） ── */
  '.dsh-sync-section{display:flex;flex-direction:column;gap:16px;padding:20px;border-radius:12px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));',
  '  background:var(--dsw-alias-bg-base,#16181d)}',
  '.dsh-sync-section-title{font-size:13.5px;line-height:20px;font-weight:650;',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);display:flex;align-items:center;gap:7px;letter-spacing:-.01em}',

  /* 字段排布 */
  '.dsh-sync-field{display:flex;flex-direction:column;gap:6px}',
  '.dsh-sync-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
  '.dsh-sync-field-label{font-size:12.5px;font-weight:550;color:var(--dsw-alias-label-secondary,#b9b9b9);user-select:none}',
  '.dsh-sync-field-status{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b8b8b)}',
  '.dsh-sync-field-hint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b8b8b)}',

  /* 输入控件：透明底 + 发丝边框 + 聚焦环（与 system-prompt select 同规范） */
  '.dsh-sync-input{height:34px;box-sizing:border-box;padding:0 11px;border-radius:8px;',
  '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));background:transparent;',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);font-family:inherit;font-size:12.5px;outline:none;',
  '  transition:border-color 120ms ease,box-shadow 120ms ease}',
  '.dsh-sync-input:focus{border-color:var(--dsw-focus-ring-color,#4d6bfe);',
  '  box-shadow:0 0 0 1px var(--dsw-focus-ring-color,#4d6bfe)}',
  '.dsh-sync-input::placeholder{color:var(--dsw-alias-label-tertiary,#666)}',

  '.dsh-sync-select{height:32px;box-sizing:border-box;padding:0 26px 0 10px;border-radius:8px;',
  '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));background:transparent;',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);font-family:inherit;font-size:12.5px;line-height:30px;',
  '  cursor:pointer;appearance:none;-webkit-appearance:none;',
  '  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);',
  '  background-position:calc(100% - 14px) 14px,calc(100% - 9px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}',
  '.dsh-sync-select:focus-visible{outline:2px solid var(--wb2-accent,#C3CEDF);outline-offset:1px}',

  '.dsh-sync-checkbox-row{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;',
  '  color:var(--dsw-alias-label-secondary,#cfcfcf);cursor:pointer;user-select:none}',
  '.dsh-sync-checkbox-row input{cursor:pointer;accent-color:var(--wb2-accent,#C3CEDF)}',

  /* ── 主次模式滑块与分段控制器 ── */
  '.dsh-sync-slider-box{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:10px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}',
  '.dsh-sync-slider-head{display:flex;justify-content:space-between;align-items:baseline}',
  '.dsh-sync-slider-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#b9b9b9);user-select:none}',
  '.dsh-sync-segmented{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:3px;border-radius:9px;',
  '  background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.12));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}',
  '.dsh-sync-seg-item{display:flex;align-items:center;justify-content:center;gap:6px;height:30px;box-sizing:border-box;',
  '  border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b8b);font-family:inherit;',
  '  font-size:12px;font-weight:500;cursor:pointer;transition:all 140ms ease;user-select:none}',
  '.dsh-sync-seg-item:hover{color:var(--dsw-alias-label-primary,#e8e8e8)}',
  '.dsh-sync-seg-item[data-active="true"]{background:var(--dsw-alias-bg-base,#16181d);color:var(--dsw-alias-label-primary,#e8e8e8);',
  '  font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.25);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}',
  '.dsh-sync-slider-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a3a3a3);',
  '  padding-top:2px;display:flex;align-items:center;gap:6px}',
].join('')

export function ensureSyncStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.id = 'dsh-workbench-sync-styles'
  el.textContent = SHEET
  document.head.appendChild(el)
}
