/**
 * dsh-mail — 工作台样式（client 半身）。
 *
 * 与记忆面板同一套做法：固定浅色/深色双皮肤由 `light-dark()` + 面板作用域内的
 * `--m-*` 变量承担，**不污染 DSH 全局 token**；类名前缀 `dsh-mail-`。
 *
 * 动效原则（用户明确偏好，且要求「在成熟骨架上做替换」）：
 *  - 列表行进场的错落淡入（stagger）——同一屏内最多前 12 条，避免长列表每帧重排；
 *  - 详情区切换时的轻微上浮（rise），只动 transform/opacity，不触发重排；
 *  - 未读圆点呼吸、监听态脉冲、按钮按压回弹、附件 chip hover 抬起；
 *  - 「待确认」条有独立的警示呼吸（这条最需要被看见）；
 *  - 一律 `prefers-reduced-motion` 降级为无动画。
 */

export const css = {
  panel: 'dsh-mail-panel',
  modalBody: 'dsh-mail-modal-body',
  // 顶栏
  topbar: 'dsh-mail-topbar',
  brand: 'dsh-mail-brand',
  brandText: 'dsh-mail-brand-text',
  address: 'dsh-mail-address',
  addressBtn: 'dsh-mail-address-btn',
  topSearch: 'dsh-mail-top-search',
  topInput: 'dsh-mail-top-input',
  topActions: 'dsh-mail-top-actions',
  topBtn: 'dsh-mail-top-btn',
  topBtnBusy: 'dsh-mail-top-btn-busy',
  watchOn: 'dsh-mail-watch-on',
  close: 'dsh-mail-close',
  // 三栏
  body: 'dsh-mail-body',
  sidebar: 'dsh-mail-sidebar',
  navList: 'dsh-mail-nav-list',
  navItem: 'dsh-mail-nav-item',
  navItemActive: 'dsh-mail-nav-item-active',
  navIcon: 'dsh-mail-nav-icon',
  navCount: 'dsh-mail-nav-count',
  navCountZero: 'dsh-mail-nav-count-zero',
  navSep: 'dsh-mail-nav-sep',
  sideFoot: 'dsh-mail-side-foot',
  sideSetting: 'dsh-mail-side-setting',
  sideSettingActive: 'dsh-mail-side-setting-active',
  listCol: 'dsh-mail-list-col',
  listHead: 'dsh-mail-list-head',
  listHeadText: 'dsh-mail-list-head-text',
  listHeadTools: 'dsh-mail-list-head-tools',
  listScroll: 'dsh-mail-list-scroll',
  row: 'dsh-mail-row',
  rowActive: 'dsh-mail-row-active',
  rowUnread: 'dsh-mail-row-unread',
  rowTop: 'dsh-mail-row-top',
  rowFrom: 'dsh-mail-row-from',
  rowTime: 'dsh-mail-row-time',
  rowSubject: 'dsh-mail-row-subject',
  rowSnippet: 'dsh-mail-row-snippet',
  rowMeta: 'dsh-mail-row-meta',
  dot: 'dsh-mail-dot',
  chip: 'dsh-mail-chip',
  chipAttach: 'dsh-mail-chip-attach',
  detailCol: 'dsh-mail-detail-col',
  detailAnim: 'dsh-mail-detail-anim',
  detailHead: 'dsh-mail-detail-head',
  detailSubject: 'dsh-mail-detail-subject',
  detailMeta: 'dsh-mail-detail-meta',
  detailActions: 'dsh-mail-detail-actions',
  detailScroll: 'dsh-mail-detail-scroll',
  detailBody: 'dsh-mail-detail-body',
  detailPlain: 'dsh-mail-detail-plain',
  frame: 'dsh-mail-frame',
  attachList: 'dsh-mail-attach-list',
  attachGroup: 'dsh-mail-attach-group',
  attachItem: 'dsh-mail-attach-item',
  attachAlt: 'dsh-mail-attach-alt',
  attachName: 'dsh-mail-attach-name',
  attachMeta: 'dsh-mail-attach-meta',
  // 附件保存位置设置
  dirRow: 'dsh-mail-dir-row',
  dirError: 'dsh-mail-dir-error',
  // 状态
  empty: 'dsh-mail-empty',
  emptyIcon: 'dsh-mail-empty-icon',
  error: 'dsh-mail-error',
  errorActions: 'dsh-mail-error-actions',
  skeleton: 'dsh-mail-skeleton',
  skeletonRow: 'dsh-mail-skeleton-row',
  more: 'dsh-mail-more',
  // 写信/回复
  composer: 'dsh-mail-composer',
  composerRow: 'dsh-mail-composer-row',
  composerLabel: 'dsh-mail-composer-label',
  input: 'dsh-mail-input',
  inputArea: 'dsh-mail-input-area',
  inputGrow: 'dsh-mail-input-grow',
  composerFoot: 'dsh-mail-composer-foot',
  btn: 'dsh-mail-btn',
  btnPrimary: 'dsh-mail-btn-primary',
  btnGhost: 'dsh-mail-btn-ghost',
  btnDanger: 'dsh-mail-btn-danger',
  btnSmall: 'dsh-mail-btn-small',
  hint: 'dsh-mail-hint',
  hintWarn: 'dsh-mail-hint-warn',
  // 确认弹层（复用面板内联确认，不用 primitives Modal：需要贴着面板层级）
  confirmMask: 'dsh-mail-confirm-mask',
  confirmCard: 'dsh-mail-confirm-card',
  confirmTitle: 'dsh-mail-confirm-title',
  confirmBody: 'dsh-mail-confirm-body',
  confirmActions: 'dsh-mail-confirm-actions',
  // 设置页
  settings: 'dsh-mail-settings',
  settingGroup: 'dsh-mail-setting-group',
  settingGroupTitle: 'dsh-mail-setting-group-title',
  settingRow: 'dsh-mail-setting-row',
  settingLabel: 'dsh-mail-setting-label',
  settingDesc: 'dsh-mail-setting-desc',
  settingValue: 'dsh-mail-setting-value',
  switch: 'dsh-mail-switch',
  switchOn: 'dsh-mail-switch-on',
  switchKnob: 'dsh-mail-switch-knob',
  toolList: 'dsh-mail-tool-list',
  toolRow: 'dsh-mail-tool-row',
  toolName: 'dsh-mail-tool-name',
  toolDesc: 'dsh-mail-tool-desc',
  // 新邮件 toast
  toast: 'dsh-mail-toast',
  toastText: 'dsh-mail-toast-text',
  toastClose: 'dsh-mail-toast-close',
  // 授权引导
  authCard: 'dsh-mail-auth-card',
  authCode: 'dsh-mail-auth-code',
} as const

const STYLE_ID = 'dsh-mail-styles'

const SHEET = `
/* ── 面板根：把常用 alias 变量在作用域内重映射成「独立应用」皮肤 ── */
.dsh-mail-panel{
  --m-text:light-dark(#1a1d21,#e8eaed);
  --m-text-2:light-dark(rgba(26,29,33,.62),rgba(232,234,237,.62));
  --m-text-3:light-dark(rgba(26,29,33,.42),rgba(232,234,237,.42));
  --m-side:light-dark(rgba(15,23,42,.03),rgba(255,255,255,.03));
  --m-side-hover:light-dark(rgba(15,23,42,.06),rgba(255,255,255,.07));
  --m-card:light-dark(#ffffff,rgba(255,255,255,.035));
  --m-border:light-dark(rgba(15,23,42,.08),rgba(255,255,255,.09));
  --m-border-2:light-dark(rgba(15,23,42,.13),rgba(255,255,255,.15));
  --m-primary:light-dark(#0e70df,#5aa2ff);
  --m-primary-soft:light-dark(rgba(14,112,223,.10),rgba(90,162,255,.16));
  --m-warn:light-dark(#d97706,#f5b545);
  --m-warn-soft:light-dark(rgba(217,119,6,.12),rgba(245,181,69,.16));
  --m-danger:light-dark(#dc2626,#ff6b6b);
  --m-danger-soft:light-dark(rgba(220,38,38,.10),rgba(255,107,107,.16));
  --m-ok:light-dark(#0f9d58,#43c98a);
  color:var(--m-text);
  display:flex;flex-direction:column;height:100%;min-height:0;
}
.dsh-mail-modal-body{display:flex;flex-direction:column;min-height:0;flex:1}

/* ── 顶栏 ── */
.dsh-mail-topbar{flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--m-border);background:var(--m-card)}
.dsh-mail-brand{display:flex;align-items:center;gap:8px;min-width:0;color:var(--m-text)}
.dsh-mail-brand svg{flex:none;color:var(--m-primary)}
.dsh-mail-brand-text{font-size:15px;font-weight:600;line-height:22px;white-space:nowrap}
.dsh-mail-address{min-width:0;display:flex;align-items:center}
.dsh-mail-address-btn{display:inline-flex;align-items:center;gap:5px;max-width:230px;padding:3px 9px;border:1px solid var(--m-border);border-radius:999px;background:var(--m-side);color:var(--m-text-2);font-size:12px;line-height:18px;font-family:inherit;cursor:pointer;transition:background .16s ease,color .16s ease,transform .16s ease}
.dsh-mail-address-btn:hover{background:var(--m-primary-soft);color:var(--m-primary);transform:translateY(-1px)}
.dsh-mail-address-btn>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mail-top-search{flex:1;min-width:80px;display:flex;align-items:center;gap:7px;height:32px;padding:0 10px;border:1px solid var(--m-border);border-radius:9px;background:var(--m-side);transition:border-color .16s ease,background .16s ease}
.dsh-mail-top-search:focus-within{border-color:var(--m-primary);background:var(--m-card)}
.dsh-mail-top-search svg{flex:none;color:var(--m-text-3)}
.dsh-mail-top-input{flex:1;min-width:0;border:none;background:transparent;color:var(--m-text);font-size:13px;line-height:20px;font-family:inherit;outline:none}
.dsh-mail-top-actions{flex:none;display:flex;align-items:center;gap:6px}
.dsh-mail-top-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 10px;border:1px solid var(--m-border);border-radius:9px;background:var(--m-card);color:var(--m-text-2);font-size:13px;font-family:inherit;cursor:pointer;transition:background .16s ease,color .16s ease,transform .12s ease}
.dsh-mail-top-btn:hover{background:var(--m-side-hover);color:var(--m-text)}
.dsh-mail-top-btn:active{transform:scale(.96)}
.dsh-mail-top-btn[data-busy='true'] svg{animation:dsh-mail-spin 900ms linear infinite}
.dsh-mail-top-btn[data-watch='true']{color:var(--m-ok);border-color:color-mix(in srgb,var(--m-ok) 40%,transparent);background:color-mix(in srgb,var(--m-ok) 10%,transparent)}
.dsh-mail-top-btn[data-watch='true']::after{content:'';position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--m-ok);animation:dsh-mail-pulse 1.8s ease-in-out infinite}
.dsh-mail-close{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:9px;background:transparent;color:var(--m-text-2);cursor:pointer;transition:background .16s ease,color .16s ease,transform .12s ease}
.dsh-mail-close:hover{background:var(--m-side-hover);color:var(--m-text)}
.dsh-mail-close:active{transform:scale(.94)}

/* ── 三栏 ── */
.dsh-mail-body{flex:1;min-height:0;display:flex}
.dsh-mail-sidebar{flex:none;width:132px;display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid var(--m-border);background:var(--m-side)}
.dsh-mail-nav-list{display:flex;flex-direction:column;gap:2px}
.dsh-mail-nav-item{position:relative;display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 9px;border:none;border-radius:8px;background:transparent;color:var(--m-text-2);font-size:13.5px;line-height:20px;font-family:inherit;text-align:left;cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-mail-nav-item:hover{background:var(--m-side-hover);color:var(--m-text)}
.dsh-mail-nav-item-active{background:var(--m-primary-soft);color:var(--m-primary);font-weight:600}
.dsh-mail-nav-icon{flex:none;display:inline-flex}
.dsh-mail-nav-count{flex:none;margin-left:auto;min-width:18px;padding:0 5px;border-radius:9px;background:var(--m-side-hover);color:var(--m-text-3);font-size:11px;line-height:17px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-mail-nav-item-active .dsh-mail-nav-count{background:var(--m-primary);color:#fff}
.dsh-mail-nav-count-zero{display:none}
.dsh-mail-nav-sep{height:1px;margin:6px 4px;background:var(--m-border)}
.dsh-mail-side-foot{margin-top:auto;padding-top:6px;border-top:1px solid var(--m-border)}
.dsh-mail-side-setting{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 9px;border:none;border-radius:8px;background:transparent;color:var(--m-text-2);font-size:13px;font-family:inherit;text-align:left;cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-mail-side-setting:hover{background:var(--m-side-hover);color:var(--m-text)}
.dsh-mail-side-setting-active{background:var(--m-primary-soft);color:var(--m-primary)}

/* ── 列表栏 ── */
.dsh-mail-list-col{flex:none;width:296px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--m-border);background:var(--m-card)}
.dsh-mail-list-head{flex:none;display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--m-border)}
.dsh-mail-list-head-text{flex:1;min-width:0;font-size:12.5px;color:var(--m-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mail-list-head-tools{flex:none;display:flex;gap:4px}
.dsh-mail-list-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px}
.dsh-mail-row{position:relative;display:flex;flex-direction:column;gap:3px;width:100%;padding:9px 10px 10px 13px;margin-bottom:4px;border:1px solid transparent;border-radius:10px;background:transparent;font-family:inherit;text-align:left;cursor:pointer;transition:background .15s ease,border-color .15s ease,transform .15s cubic-bezier(.2,.8,.2,1);animation:dsh-mail-row-in 260ms cubic-bezier(.2,.8,.2,1) backwards}
.dsh-mail-row:hover{background:var(--m-side-hover);transform:translateY(-1px)}
.dsh-mail-row-active{border-color:color-mix(in srgb,var(--m-primary) 45%,transparent);background:var(--m-primary-soft)}
.dsh-mail-row-top{display:flex;align-items:baseline;gap:8px}
.dsh-mail-row-from{flex:1;min-width:0;font-size:13px;line-height:19px;color:var(--m-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mail-row-unread .dsh-mail-row-from{color:var(--m-text);font-weight:600}
.dsh-mail-row-time{flex:none;font-size:11px;line-height:17px;color:var(--m-text-3);font-variant-numeric:tabular-nums}
.dsh-mail-row-subject{font-size:13.5px;line-height:20px;color:var(--m-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mail-row-unread .dsh-mail-row-subject{font-weight:600}
.dsh-mail-row-snippet{font-size:12px;line-height:18px;color:var(--m-text-3);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dsh-mail-row-meta{display:flex;align-items:center;gap:5px;margin-top:2px}
.dsh-mail-dot{position:absolute;left:4px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:var(--m-primary);animation:dsh-mail-dot 2.4s ease-in-out infinite}
.dsh-mail-chip{display:inline-flex;align-items:center;gap:3px;padding:0 6px;border-radius:5px;background:var(--m-side-hover);color:var(--m-text-3);font-size:10.5px;line-height:16px}
.dsh-mail-chip-attach{background:var(--m-primary-soft);color:var(--m-primary);transition:transform .16s cubic-bezier(.2,.8,.2,1)}
.dsh-mail-row:hover .dsh-mail-chip-attach{transform:translateY(-1px) scale(1.04)}

/* ── 详情栏 ── */
.dsh-mail-detail-col{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--m-card)}
.dsh-mail-detail-anim{animation:dsh-mail-rise 280ms cubic-bezier(.2,.8,.2,1)}
.dsh-mail-detail-head{flex:none;display:flex;flex-direction:column;gap:6px;padding:12px 16px 10px;border-bottom:1px solid var(--m-border)}
.dsh-mail-detail-subject{font-size:16px;font-weight:600;line-height:24px;color:var(--m-text);word-break:break-word}
.dsh-mail-detail-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12px;line-height:18px;color:var(--m-text-2)}
.dsh-mail-detail-meta b{font-weight:600;color:var(--m-text)}
.dsh-mail-detail-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.dsh-mail-detail-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 20px}
.dsh-mail-detail-body{font-size:13.5px;line-height:1.75;color:var(--m-text);word-break:break-word}
.dsh-mail-detail-plain{white-space:pre-wrap;font-family:inherit}
.dsh-mail-frame{width:100%;min-height:220px;border:1px solid var(--m-border);border-radius:10px;background:transparent;display:block}
.dsh-mail-attach-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--m-border)}
/* 附件组：主按钮 + 「另选位置」，两者视觉上是一件事（同一个文件），
   故包在一个胶囊里、内部用分隔线，而不是并排两个独立控件。 */
.dsh-mail-attach-group{display:inline-flex;align-items:stretch;max-width:100%;border:1px solid var(--m-border);border-radius:9px;background:var(--m-side);overflow:hidden;transition:background .16s ease,border-color .16s ease,transform .16s cubic-bezier(.2,.8,.2,1)}
.dsh-mail-attach-group:hover{background:var(--m-primary-soft);border-color:color-mix(in srgb,var(--m-primary) 40%,transparent);transform:translateY(-2px)}
.dsh-mail-attach-group:active{transform:translateY(0) scale(.985)}
.dsh-mail-attach-item{display:flex;align-items:center;gap:8px;max-width:100%;padding:7px 10px;border:none;background:transparent;cursor:pointer;font-family:inherit;text-align:left}
.dsh-mail-attach-alt{display:inline-flex;align-items:center;gap:4px;padding:0 10px;border:none;border-left:1px solid var(--m-border);background:transparent;color:var(--m-text-2);font-size:11.5px;font-family:inherit;white-space:nowrap;cursor:pointer;transition:background .16s ease,color .16s ease}
.dsh-mail-attach-alt:hover{background:color-mix(in srgb,var(--m-primary) 14%,transparent);color:var(--m-primary)}
.dsh-mail-attach-name{font-size:12.5px;color:var(--m-text);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mail-attach-meta{font-size:11px;color:var(--m-text-3);font-variant-numeric:tabular-nums}
/* 附件保存位置：输入框 + 三个按钮一行，窄屏折行 */
.dsh-mail-dir-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.dsh-mail-dir-row .dsh-mail-input{flex:1 1 240px;min-width:180px}
.dsh-mail-dir-error{margin-top:6px;font-size:11.5px;line-height:17px;color:var(--m-danger);word-break:break-word}

/* ── 按钮 ── */
.dsh-mail-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 12px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-card);color:var(--m-text);font-size:12.5px;font-family:inherit;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .12s ease,box-shadow .16s ease}
.dsh-mail-btn:hover{background:var(--m-side-hover);transform:translateY(-1px)}
.dsh-mail-btn:active{transform:translateY(0) scale(.97)}
.dsh-mail-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.dsh-mail-btn-primary{border-color:transparent;background:var(--m-primary);color:#fff}
.dsh-mail-btn-primary:hover{background:color-mix(in srgb,var(--m-primary) 88%,#000);box-shadow:0 4px 12px color-mix(in srgb,var(--m-primary) 32%,transparent)}
.dsh-mail-btn-ghost{border-color:transparent;background:transparent;color:var(--m-text-2)}
.dsh-mail-btn-ghost:hover{background:var(--m-side-hover);color:var(--m-text)}
.dsh-mail-btn-danger{border-color:transparent;background:var(--m-danger);color:#fff}
.dsh-mail-btn-danger:hover{background:color-mix(in srgb,var(--m-danger) 88%,#000)}
.dsh-mail-btn-small{height:26px;padding:0 9px;font-size:12px;border-radius:7px}

/* ── 写信 / 回复表单 ── */
.dsh-mail-composer{display:flex;flex-direction:column;gap:8px;padding:12px 16px 14px;border-bottom:1px solid var(--m-border);background:var(--m-side);animation:dsh-mail-rise 240ms cubic-bezier(.2,.8,.2,1)}
.dsh-mail-composer-row{display:flex;align-items:center;gap:8px}
.dsh-mail-composer-label{flex:none;width:52px;font-size:12px;color:var(--m-text-2);text-align:right}
.dsh-mail-input{flex:1;min-width:0;height:30px;padding:0 9px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-card);color:var(--m-text);font-size:13px;font-family:inherit;outline:none;transition:border-color .16s ease,box-shadow .16s ease}
.dsh-mail-input:focus{border-color:var(--m-primary);box-shadow:0 0 0 3px var(--m-primary-soft)}
.dsh-mail-input-area{flex:1;min-height:130px;padding:9px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-card);color:var(--m-text);font-size:13px;line-height:1.7;font-family:inherit;outline:none;resize:vertical;transition:border-color .16s ease,box-shadow .16s ease}
.dsh-mail-input-area:focus{border-color:var(--m-primary);box-shadow:0 0 0 3px var(--m-primary-soft)}
.dsh-mail-composer-foot{display:flex;align-items:center;gap:8px}
.dsh-mail-hint{font-size:11.5px;line-height:17px;color:var(--m-text-3)}
.dsh-mail-hint-warn{color:var(--m-warn)}

/* ── 空态 / 错误 / 骨架 ── */
.dsh-mail-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:48px 20px;color:var(--m-text-3);text-align:center}
.dsh-mail-empty-icon{color:var(--m-text-3);opacity:.5}
.dsh-mail-error{margin:16px;padding:14px;border:1px solid color-mix(in srgb,var(--m-danger) 30%,transparent);border-radius:10px;background:var(--m-danger-soft);color:var(--m-text);font-size:13px;line-height:1.7}
.dsh-mail-error-actions{display:flex;gap:8px;margin-top:10px}
.dsh-mail-skeleton{padding:6px}
.dsh-mail-skeleton-row{height:64px;margin-bottom:6px;border-radius:10px;background:linear-gradient(90deg,var(--m-side) 25%,var(--m-side-hover) 37%,var(--m-side) 63%);background-size:400% 100%;animation:dsh-mail-shimmer 1.4s ease-in-out infinite}
.dsh-mail-more{display:block;width:100%;margin:4px 0 8px;padding:8px;border:1px dashed var(--m-border-2);border-radius:9px;background:transparent;color:var(--m-text-2);font-size:12.5px;font-family:inherit;cursor:pointer;transition:background .16s ease,color .16s ease}
.dsh-mail-more:hover{background:var(--m-side-hover);color:var(--m-text)}

/* ── 确认弹层（面板内联，不引 primitives Modal） ── */
.dsh-mail-confirm-mask{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42);animation:dsh-mail-fade 180ms ease}
.dsh-mail-confirm-card{width:min(440px,calc(100vw - 40px));padding:18px 20px 16px;border:1px solid var(--m-border-2);border-radius:14px;background:var(--m-card);box-shadow:0 18px 50px rgba(0,0,0,.34);animation:dsh-mail-pop 220ms cubic-bezier(.2,.8,.2,1)}
.dsh-mail-confirm-title{font-size:15px;font-weight:600;line-height:22px;color:var(--m-text)}
.dsh-mail-confirm-body{margin-top:10px;font-size:13px;line-height:1.7;color:var(--m-text-2);white-space:pre-wrap;word-break:break-word;max-height:46vh;overflow-y:auto}
.dsh-mail-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}

/* ── 设置页 ── */
.dsh-mail-settings{flex:1;min-height:0;overflow-y:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:18px;animation:dsh-mail-rise 260ms cubic-bezier(.2,.8,.2,1)}
.dsh-mail-setting-group{display:flex;flex-direction:column;gap:2px}
.dsh-mail-setting-group-title{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--m-text-3);margin-bottom:6px}
.dsh-mail-setting-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--m-border);border-radius:10px;background:var(--m-card);transition:border-color .16s ease}
.dsh-mail-setting-row:hover{border-color:var(--m-border-2)}
.dsh-mail-setting-label{font-size:13.5px;line-height:20px;color:var(--m-text)}
.dsh-mail-setting-desc{font-size:11.5px;line-height:17px;color:var(--m-text-3);margin-top:2px}
.dsh-mail-setting-value{margin-left:auto;flex:none;font-size:12px;color:var(--m-text-2);font-variant-numeric:tabular-nums;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mail-switch{flex:none;margin-left:auto;position:relative;width:40px;height:22px;border:none;border-radius:11px;background:var(--m-border-2);cursor:pointer;transition:background .2s cubic-bezier(.2,.8,.2,1)}
.dsh-mail-switch-on{background:var(--m-primary)}
.dsh-mail-switch-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.24);transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.dsh-mail-switch-on .dsh-mail-switch-knob{transform:translateX(18px)}
.dsh-mail-tool-list{display:flex;flex-direction:column;gap:6px}
.dsh-mail-tool-row{display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid var(--m-border);border-radius:9px;background:var(--m-card)}
.dsh-mail-tool-name{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--m-primary)}
.dsh-mail-tool-desc{font-size:12px;line-height:18px;color:var(--m-text-2)}

/* ── 新邮件 toast ── */
.dsh-mail-toast{position:absolute;right:16px;bottom:16px;z-index:40;display:flex;align-items:center;gap:10px;max-width:min(360px,calc(100% - 32px));padding:10px 12px;border:1px solid color-mix(in srgb,var(--m-primary) 32%,transparent);border-radius:11px;background:var(--m-card);box-shadow:0 12px 32px rgba(0,0,0,.22);animation:dsh-mail-toast-in 300ms cubic-bezier(.2,.8,.2,1)}
.dsh-mail-toast-text{flex:1;min-width:0;font-size:12.5px;line-height:18px;color:var(--m-text)}
.dsh-mail-toast-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--m-text-3);cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-mail-toast-close:hover{background:var(--m-side-hover);color:var(--m-text)}

/* ── 授权引导卡 ── */
.dsh-mail-auth-card{margin:20px;padding:18px;border:1px solid var(--m-border-2);border-radius:12px;background:var(--m-card);display:flex;flex-direction:column;gap:10px}
.dsh-mail-auth-code{margin:0;padding:10px 12px;border-radius:9px;background:var(--m-side);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.7;color:var(--m-text);white-space:pre-wrap;word-break:break-all;user-select:all}

/* ── 动效 ── */
@keyframes dsh-mail-row-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes dsh-mail-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes dsh-mail-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-mail-pop{from{opacity:0;transform:translateY(10px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dsh-mail-toast-in{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dsh-mail-spin{to{transform:rotate(360deg)}}
@keyframes dsh-mail-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.42;transform:scale(.86)}}
@keyframes dsh-mail-dot{0%,100%{opacity:1;box-shadow:0 0 0 0 color-mix(in srgb,var(--m-primary) 45%,transparent)}50%{opacity:.72;box-shadow:0 0 0 4px transparent}}
@keyframes dsh-mail-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
@media (prefers-reduced-motion:reduce){
  .dsh-mail-row,.dsh-mail-detail-anim,.dsh-mail-composer,.dsh-mail-settings,
  .dsh-mail-toast,.dsh-mail-confirm-card,.dsh-mail-confirm-mask{animation:none}
  .dsh-mail-top-btn svg,.dsh-mail-dot{animation:none}
  .dsh-mail-row:hover,.dsh-mail-btn:hover,.dsh-mail-attach-item:hover,.dsh-mail-address-btn:hover{transform:none}
}

/* ── 窄屏：三栏折成两段（列表全宽 / 详情全宽） ── */
@media (max-width: 900px){
  .dsh-mail-sidebar{width:52px;padding:8px 6px}
  .dsh-mail-nav-item span:not([class]),.dsh-mail-side-setting span:not([class]){display:none}
  .dsh-mail-nav-item,.dsh-mail-side-setting{justify-content:center;padding:0}
  .dsh-mail-nav-count{position:absolute;top:2px;right:2px;margin:0;min-width:15px;padding:0 4px;font-size:10px;line-height:15px}
  .dsh-mail-list-col{width:100%;border-right:none}
  .dsh-mail-list-col[data-has-selection='true']{display:none}
  .dsh-mail-detail-col{width:100%}
}
`

/** 注入样式表（幂等；内容比对，插件升级后已打开的页面也能收敛）。 */
export function ensureMailStyles(): void {
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
