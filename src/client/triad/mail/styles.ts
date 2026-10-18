/**
 * dsh-mail — 面板样式（client 半身）。
 *
 * 与记忆面板同一套做法：固定浅色/深色双皮肤由 `light-dark()` + 面板作用域内的
 * `--m-*` 变量承担，**不污染 DSH 全局 token**；类名前缀 `dsh-mail-`。
 *
 * ── 布局基准：容器查询，不是视口媒体查询 ──────────────────────────────
 * 面板活在顶栏邮箱按钮弹出的居中卡片里，宽 `min(1080px, 100vw − 48px)`。
 * 宽度由外壳给、与视口不完全等同（窄窗口下会被压小），所以两种形态都由
 * `.dsh-mail-panel` 上的 `container-type: inline-size` +
 * `@container mailpanel (max-width: 620px)` 决定：>620px 排三栏（文件夹 /
 * 列表 / 正文，桌面常态），≤620px 落窄栏范式（移动端邮箱：单栏 + 横条）。
 * 2026-10-18 卡片化之前外壳只有 420px，窄栏是唯一形态；现在两种都真会被用到。
 *
 * ⚠️ `container-type` 必须挂在**有确定宽度的那个根**上（`.dsh-mail-panel`）。
 * 挂到 `display:contents` 的祖先（如官方 `[data-slot="main"]`）上不会有任何
 * 效果 —— 那种节点没有盒子，容器查询永远不匹配。
 *
 * ⚠️ 容器查询**不能匹配容器自己**（元素不能是自己的容器祖先）。所以下面
 * `@container` 里的选择器全是 `.dsh-mail-panel` 的后代，布局属性一律落在
 * `.dsh-mail-body` / 三栏上。
 *
 * ── 动效原则（用户明确偏好，且要求「动画关掉内容仍完整可见」）──────────
 *  - 列表行进场的错落淡入（stagger）——同一屏内最多前 12 条，避免长列表每帧重排；
 *  - 详情区切换时的轻微上浮（rise），只动 transform/opacity，不触发重排；
 *  - **窄栏「列表 ↔ 详情」是滑动 + 淡入淡出**（移动端邮箱范式）：两栏都在 DOM
 *    里，靠 transform/opacity 交接，退场用 visibility 延迟切换；
 *  - 未读圆点呼吸、监听态脉冲、按钮按压回弹、附件 chip hover 抬起；
 *  - 一律 `prefers-reduced-motion` 降级为无动画 —— **降级只关动画，不关状态**：
 *    选中详情时详情照样铺满、返回列表照样能回去，内容不会有任何一块消失。
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
  /** 窄栏专用「返回列表」（宽栏隐藏：三栏时列表常驻，没有返回语义）。 */
  back: 'dsh-mail-back',
  detailAnim: 'dsh-mail-detail-anim',
  detailHead: 'dsh-mail-detail-head',
  detailSubject: 'dsh-mail-detail-subject',
  detailMeta: 'dsh-mail-detail-meta',
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
  // 表单控件（设置页在用）
  input: 'dsh-mail-input',
  btn: 'dsh-mail-btn',
  btnPrimary: 'dsh-mail-btn-primary',
  btnGhost: 'dsh-mail-btn-ghost',
  btnSmall: 'dsh-mail-btn-small',
  hint: 'dsh-mail-hint',
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
/* ── 面板根：全部走 DSH 官方 alias token，明暗两套由官方主题切换驱动 ──
   这里是**容器查询的容器根**：它宽度由父级（邮箱卡片，最宽 1080px）决定，
   container-type 必须挂在这个有确定宽度的盒子上，挂到 display:contents 的
   祖先（官方 [data-slot="main"]）上不会有任何效果。 */
.dsh-mail-panel{
  --m-text:var(--dsw-alias-label-primary);
  --m-text-2:var(--dsw-alias-label-secondary);
  --m-text-3:var(--dsw-alias-label-tertiary);
  --m-side:var(--dsw-alias-bg-module-platform);
  --m-side-hover:var(--dsw-alias-interactive-bg-hover-solid);
  --m-card:var(--dsw-alias-bg-layer-1);
  --m-border:var(--dsw-alias-border-l1);
  --m-border-2:var(--dsw-alias-border-l2);
  --m-primary:var(--dsw-alias-state-business-primary);
  --m-primary-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);
  --m-warn:var(--dsw-alias-state-warn-primary);
  --m-danger:var(--dsw-alias-state-error-primary);
  --m-ok:var(--dsw-alias-state-success-primary);
  container-type:inline-size;
  container-name:mailpanel;
  position:relative;
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

/* ── 三栏（宽栏形态；窄栏由下方 @container 覆盖） ── */
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
/* 窄栏专用「返回列表」：宽栏三栏并存时列表常驻，不需要返回语义，故默认收起。 */
.dsh-mail-back{display:none;align-items:center;gap:5px;flex:none;align-self:flex-start;margin:10px 12px 0;padding:5px 10px 5px 7px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-card);color:var(--m-text-2);font-family:inherit;font-size:12.5px;line-height:18px;cursor:pointer;transition:background .16s ease,color .16s ease,transform .16s cubic-bezier(.2,.8,.2,1),border-color .16s ease}
.dsh-mail-back:hover{background:var(--m-primary-soft);color:var(--m-primary);border-color:color-mix(in srgb,var(--m-primary) 40%,transparent);transform:translateX(-2px)}
.dsh-mail-back:active{transform:translateX(-2px) scale(.97)}
.dsh-mail-detail-anim{animation:dsh-mail-rise 280ms cubic-bezier(.2,.8,.2,1)}
.dsh-mail-detail-head{flex:none;display:flex;flex-direction:column;gap:6px;padding:12px 16px 10px;border-bottom:1px solid var(--m-border)}
.dsh-mail-detail-subject{font-size:16px;font-weight:600;line-height:24px;color:var(--m-text);word-break:break-word}
.dsh-mail-detail-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12px;line-height:18px;color:var(--m-text-2)}
.dsh-mail-detail-meta b{font-weight:600;color:var(--m-text)}
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
.dsh-mail-btn-small{height:26px;padding:0 9px;font-size:12px;border-radius:7px}

/* ── 表单控件（设置页用：附件目录输入） ── */
.dsh-mail-input{flex:1;min-width:0;height:30px;padding:0 9px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-card);color:var(--m-text);font-size:13px;font-family:inherit;outline:none;transition:border-color .16s ease,box-shadow .16s ease}
.dsh-mail-input:focus{border-color:var(--m-primary);box-shadow:0 0 0 3px var(--m-primary-soft)}
.dsh-mail-hint{font-size:11.5px;line-height:17px;color:var(--m-text-3)}

/* ── 空态 / 错误 / 骨架 ── */
.dsh-mail-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:48px 20px;color:var(--m-text-3);text-align:center}
.dsh-mail-empty-icon{color:var(--m-text-3);opacity:.5}
.dsh-mail-error{margin:16px;padding:14px;border:1px solid color-mix(in srgb,var(--m-danger) 30%,transparent);border-radius:10px;background:color-mix(in srgb,var(--m-danger) 12%,transparent);color:var(--m-text);font-size:13px;line-height:1.7}
.dsh-mail-error-actions{display:flex;gap:8px;margin-top:10px}
.dsh-mail-skeleton{padding:6px}
.dsh-mail-skeleton-row{height:64px;margin-bottom:6px;border-radius:10px;background:linear-gradient(90deg,var(--m-side) 25%,var(--m-side-hover) 37%,var(--m-side) 63%);background-size:400% 100%;animation:dsh-mail-shimmer 1.4s ease-in-out infinite}
.dsh-mail-more{display:block;width:100%;margin:4px 0 8px;padding:8px;border:1px dashed var(--m-border-2);border-radius:9px;background:transparent;color:var(--m-text-2);font-size:12.5px;font-family:inherit;cursor:pointer;transition:background .16s ease,color .16s ease}
.dsh-mail-more:hover{background:var(--m-side-hover);color:var(--m-text)}

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
.dsh-mail-switch-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-switch-thumb);box-shadow:0 1px 3px rgba(0,0,0,.24);transition:transform .2s cubic-bezier(.2,.8,.2,1)}
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

/* ══════════════════════════════════════════════════════════════════════
   窄栏范式（容器查询）—— 卡片被压到 ≤620px 时的形态（窄窗口 / 手机）
   ══════════════════════════════════════════════════════════════════════
   移动端邮箱范式：列表 ↔ 详情单栏切换，文件夹从竖列改顶部横条。
   两栏都常驻 DOM，靠「列表/详情谁显示」+ 入场上浮交接 —— 这样返回时
   列表也有动画，且 reduced-motion 下只失去动画、状态一步不少。
   选择器都带 .dsh-mail-panel 前缀：① 容器查询匹配不到容器自己，布局
   属性必须落在后代上；② 提高特异性，压过上面的宽栏基础规则。 */
@container mailpanel (max-width: 620px){
  /* 主体改纵向：文件夹横条 + 内容区 */
  .dsh-mail-panel .dsh-mail-body{flex-direction:column}
  /* 文件夹横条：原竖列 → 横滚一行（无滚动条，两端不挤压） */
  .dsh-mail-panel .dsh-mail-sidebar{
    flex:none;width:auto;flex-direction:row;align-items:center;gap:4px;
    padding:7px 8px;border-right:none;border-bottom:1px solid var(--m-border);
    overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain}
  .dsh-mail-panel .dsh-mail-sidebar::-webkit-scrollbar{display:none}
  .dsh-mail-panel .dsh-mail-nav-list{flex-direction:row;align-items:center;gap:2px;flex:none}
  .dsh-mail-panel .dsh-mail-nav-item{width:auto;flex:none;height:30px;padding:0 9px;gap:6px;white-space:nowrap;font-size:12.5px}
  .dsh-mail-panel .dsh-mail-nav-count{margin-left:2px;min-width:16px;padding:0 4px;font-size:10.5px;line-height:16px}
  /* 分隔线：横条里改竖线（原横线在这里会变成一道突兀的通栏） */
  .dsh-mail-panel .dsh-mail-nav-sep{width:1px;height:18px;margin:0 4px;flex:none}
  /* 设置：从「贴底」改成横条末端一格 */
  .dsh-mail-panel .dsh-mail-side-foot{margin-top:0;padding-top:0;border-top:none;flex:none}
  .dsh-mail-panel .dsh-mail-side-setting{width:auto;height:30px;padding:0 9px;gap:6px;white-space:nowrap;font-size:12.5px}

  /* 列表铺满；选中邮件时让位给详情（同屏只显示一栏） */
  .dsh-mail-panel .dsh-mail-list-col{flex:1 1 auto;width:auto;min-width:0;border-right:none}
  .dsh-mail-panel .dsh-mail-list-col[data-has-selection='true']{display:none}
  .dsh-mail-panel .dsh-mail-detail-col{flex:1 1 auto;width:auto;min-width:0}
  .dsh-mail-panel .dsh-mail-detail-col[data-empty='true']{display:none}
  .dsh-mail-panel .dsh-mail-list-scroll{padding:8px}
  .dsh-mail-panel .dsh-mail-row{padding:10px 12px}

  /* 详情铺满：返回钮 + 头部 + 正文 */
  .dsh-mail-panel .dsh-mail-back{display:inline-flex}
  .dsh-mail-panel .dsh-mail-detail-head{padding:10px 14px 9px}
  .dsh-mail-panel .dsh-mail-detail-scroll{padding:12px 14px 20px}
  .dsh-mail-panel .dsh-mail-attach-name{max-width:150px}

  /* 列表 ↔ 详情切换的过渡：两栏都常驻，谁显示谁播一次入场上浮 + 淡入。
     display:none → 恢复会重启动画，所以「返回列表」同样有反馈。 */
  .dsh-mail-panel .dsh-mail-list-col,
  .dsh-mail-panel .dsh-mail-detail-col{animation:dsh-mail-pane-in 260ms cubic-bezier(.2,.8,.2,1) both}
  /* 顶栏在 420px 下要省地方：邮箱地址胶囊让位（地址在设置页里看得到） */
  .dsh-mail-panel .dsh-mail-address{display:none}
  .dsh-mail-panel .dsh-mail-topbar{gap:8px;padding:9px 12px}
  .dsh-mail-panel .dsh-mail-brand-text{display:none}
}

/* 超窄（≤380px）：横条与顶栏再收一档 */
@container mailpanel (max-width: 380px){
  .dsh-mail-panel .dsh-mail-top-btn{padding:0 8px}
  .dsh-mail-panel .dsh-mail-nav-item span:not([class]){font-size:12px}
  .dsh-mail-panel .dsh-mail-settings{padding:14px 12px 20px}
}

/* ── 动效 ── */
@keyframes dsh-mail-row-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes dsh-mail-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes dsh-mail-pane-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes dsh-mail-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-mail-toast-in{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dsh-mail-spin{to{transform:rotate(360deg)}}
@keyframes dsh-mail-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.42;transform:scale(.86)}}
@keyframes dsh-mail-dot{0%,100%{opacity:1;box-shadow:0 0 0 0 color-mix(in srgb,var(--m-primary) 45%,transparent)}50%{opacity:.72;box-shadow:0 0 0 4px transparent}}
@keyframes dsh-mail-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
/* 减弱动效：只关动画 —— 绝不用 opacity:0 / visibility:hidden 之类藏内容，
   窄栏「列表 ↔ 详情」的显示切换完全由 display 决定，动画关掉后一切照旧可见。 */
@media (prefers-reduced-motion:reduce){
  .dsh-mail-row,.dsh-mail-detail-anim,.dsh-mail-list-col,.dsh-mail-detail-col,
  .dsh-mail-settings,.dsh-mail-toast{animation:none !important}
  .dsh-mail-top-btn svg,.dsh-mail-dot{animation:none !important}
  .dsh-mail-row:hover,.dsh-mail-btn:hover,.dsh-mail-attach-item:hover,
  .dsh-mail-address-btn:hover,.dsh-mail-back:hover{transform:none}
  .dsh-mail-back,.dsh-mail-row,.dsh-mail-address-btn,.dsh-mail-btn,
  .dsh-mail-attach-group,.dsh-mail-chip-attach{transition:none}
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
