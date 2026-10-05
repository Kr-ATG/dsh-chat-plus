/**
 * dsh-soul — 样式（运行时注入 <style>，卸载时由 loader 清理）。
 *
 * 设计取舍：
 *  - 类名前缀 dsh-soul-，style id 带 dsh-triad- 前缀（与 skill-source 同款）：
 *    id 撞车会让后注入的表把先注入的整张吞掉（本仓踩过 dsh-chat-flow-styles）。
 *  - **颜色一律取官方 --dsw-alias-***，本文件只在 .dsh-soul-root / .dsh-soul-card
 *    两个作用域里把它们聚合成一组 --s-* 短名。原因：灵魂面板有两个宿主——
 *    记忆面板的 Tab（在 .dsh-memory-panel 里，能拿到 --m-*）与 composer 浮层
 *    （在面板作用域之外，拿不到任何 --m-*）。只依赖官方 token 才能两处通用；
 *    自建调色板则会在明暗主题切换时露馅。
 *  - 动效全部是 CSS transition/animation，零运行时依赖（本插件零依赖策略）。
 *    时长统一 160–260ms：低于 160ms 读不出「发生了什么」，高于 260ms 会拖。
 *  - 入场沿用工作台同款的错峰淡入（各区块按 nth-child 递增延迟），与
 *    triad-modal-animation 的 stagger 节奏对齐。
 *  - 注入样式是幂等的，且**按内容比对**判重而非只按 id：插件升级后已打开的
 *    页面里那份旧 <style> 会一直命中早退分支，JSX 拿到新 class 却永远匹配不到
 *    新规则（本仓新增中文记忆通道时踩过：开关正常、新排版全散架）。
 *
 * ── 2026-10-05 二轮「简化」改版（用户：整张页面太丑、要简化 + 要动效） ──
 *  问题不是功能太多，是**每样东西都在抢视觉权重**：四行说明文字、四个状态胶囊、
 *  每个预设两个大按钮、每张卡一行 hint，全部常驻。改法是把说明降级成 hover/title，
 *  把按钮降级成 hover 显形，把「常驻信息」压到真正需要一眼看到的那几条：
 *
 *  1. **头部从三行压成一行**。原来鲸鱼独占 44px 高的一行，下面再跟标题 + 两行
 *     说明，头部吃掉 162px。现在鲸鱼 30px 与标题同行，说明单行省略（全文进 title）。
 *  2. **四个状态胶囊收成一枚呼吸点**。version / updatedAt / 注入开关原来各占一个
 *     胶囊，其实只有「有没有未保存改动」需要一眼可见；其余进 title 与侧栏档案。
 *     未保存 = 琥珀点脉冲，已保存 = 静息绿点。
 *  3. **两栏改容器查询**。原来 .dsh-soul-cols 写死 `1fr 320px`，并排模式下左栏
 *     只有 485px，主栏被压到 ~100px——正文编辑器竖排成两个字一行（截图里最难看的
 *     那处）。现在 .dsh-soul-root 是 inline-size 容器，窄于 820px 自动单列。
 *  4. **预设行紧凑 + 动作 hover 显形**。每行两个按钮常驻会变成一堵按钮墙；默认
 *     降到 55% 透明度，行 hover 才提到 100%。说明文字改 title。
 *  5. **卡片行左侧主色竖条**：hover / 展开时从 40% 高度弹到满高，替代原来纯边框
 *     高亮——一张卡是不是「当前正在编辑的」因此一眼可辨。
 *  6. **主体改双栏**（同日第三轮，用户要求「灵魂用双栏布局」）：左栏卡片区、右栏预设区。
 *     拆成独立分类后灵魂独占整页 969px，单列堆叠会让右半边整片空着；两栏比 1.55:1，
 *     卡片行需要更宽（标题+元信息+开关+两个图标按钮），预设行 440px 足够。
 *     窄面板下由容器查询折叠回单列。
 *  7. 所有新动效同样在 prefers-reduced-motion 下关闭；本文件**只保留一处**
 *     reduced-motion 媒体查询（冒烟脚本按「第一处匹配后 600 字符内出现鲸鱼规则」
 *     断言，分散成多块会让那条断言静默失效）。
 */

export const css = {
  root: 'dsh-soul-root',
  scroll: 'dsh-soul-scroll',
  header: 'dsh-soul-header',
  brand: 'dsh-soul-brand',
  hero: 'dsh-soul-hero',
  headMain: 'dsh-soul-head-main',
  title: 'dsh-soul-title',
  desc: 'dsh-soul-desc',
  headMeta: 'dsh-soul-head-meta',
  chip: 'dsh-soul-chip',
  chipOk: 'dsh-soul-chip-ok',
  chipWarn: 'dsh-soul-chip-warn',
  chipErr: 'dsh-soul-chip-err',
  chipMuted: 'dsh-soul-chip-muted',

  // ── 头部那一枚「有没有未保存改动」的呼吸点 ──
  state: 'dsh-soul-state',
  stateDot: 'dsh-soul-state-dot',
  stateSaved: 'dsh-soul-state-saved',
  stateDirty: 'dsh-soul-state-dirty',

  notice: 'dsh-soul-notice',
  noticeOn: 'dsh-soul-notice-on',
  noticeOk: 'dsh-soul-notice-ok',
  noticeErr: 'dsh-soul-notice-err',

  // ── 双栏主体（左卡片 / 右预设） ──
  columns: 'dsh-soul-columns',
  colLeft: 'dsh-soul-col-left',
  colRight: 'dsh-soul-col-right',

  cols: 'dsh-soul-cols',
  mainCol: 'dsh-soul-main-col',
  sideCol: 'dsh-soul-side-col',
  card: 'dsh-soul-card',
  cardTitle: 'dsh-soul-card-title',
  cardHint: 'dsh-soul-card-hint',

  tabs: 'dsh-soul-tabs',
  tab: 'dsh-soul-tab',
  tabActive: 'dsh-soul-tab-active',

  field: 'dsh-soul-field',
  label: 'dsh-soul-label',
  input: 'dsh-soul-input',
  textarea: 'dsh-soul-textarea',
  textareaTall: 'dsh-soul-textarea-tall',
  counter: 'dsh-soul-counter',
  counterOver: 'dsh-soul-counter-over',
  fieldRow: 'dsh-soul-field-row',
  principles: 'dsh-soul-principles',

  actions: 'dsh-soul-actions',
  btn: 'dsh-soul-btn',
  btnPrimary: 'dsh-soul-btn-primary',
  btnGhost: 'dsh-soul-btn-ghost',
  btnDanger: 'dsh-soul-btn-danger',
  btnDone: 'dsh-soul-btn-done',
  btnIcon: 'dsh-soul-btn-icon',
  spin: 'dsh-soul-spin',
  check: 'dsh-soul-check',

  profiles: 'dsh-soul-profiles',
  profileRow: 'dsh-soul-profile-row',
  profileRowActive: 'dsh-soul-profile-row-active',
  profileRowIn: 'dsh-soul-profile-row-in',
  profileMain: 'dsh-soul-profile-main',
  profileName: 'dsh-soul-profile-name',
  profileMeta: 'dsh-soul-profile-meta',
  profileActions: 'dsh-soul-profile-actions',
  profileNew: 'dsh-soul-profile-new',
  profileNewRow: 'dsh-soul-profile-new-row',
  badge: 'dsh-soul-badge',
  badgeOn: 'dsh-soul-badge-on',

  draft: 'dsh-soul-draft',
  draftHead: 'dsh-soul-draft-head',
  draftTitle: 'dsh-soul-draft-title',
  draftStats: 'dsh-soul-draft-stats',
  draftNotes: 'dsh-soul-draft-notes',
  diff: 'dsh-soul-diff',
  diffCol: 'dsh-soul-diff-col',
  diffColHead: 'dsh-soul-diff-col-head',
  diffBody: 'dsh-soul-diff-body',
  diffLine: 'dsh-soul-diff-line',
  diffLineAdd: 'dsh-soul-diff-line-add',
  diffLineDel: 'dsh-soul-diff-line-del',
  diffLineSame: 'dsh-soul-diff-line-same',
  diffDivider: 'dsh-soul-diff-divider',
  diffHint: 'dsh-soul-diff-hint',

  preview: 'dsh-soul-preview',
  previewEmpty: 'dsh-soul-preview-empty',
  identityList: 'dsh-soul-identity-list',
  identityRow: 'dsh-soul-identity-row',
  identityKey: 'dsh-soul-identity-key',
  identityVal: 'dsh-soul-identity-val',

  empty: 'dsh-soul-empty',
  emptyIcon: 'dsh-soul-empty-icon',
  emptyText: 'dsh-soul-empty-text',
  emptyHint: 'dsh-soul-empty-hint',
  skeleton: 'dsh-soul-skeleton',
  skeletonRow: 'dsh-soul-skeleton-row',
  stale: 'dsh-soul-stale',

  toggleRow: 'dsh-soul-toggle-row',
  toggleMain: 'dsh-soul-toggle-main',
  toggleLabel: 'dsh-soul-toggle-label',
  toggleHint: 'dsh-soul-toggle-hint',
  switch: 'dsh-soul-switch',

  // ── 会动的鲸鱼（面板顶部的 DSH logo） ──
  whale: 'dsh-soul-whale',
  whaleStill: 'dsh-soul-whale-still',
  whaleGlow: 'dsh-soul-whale-glow',
  whaleBody: 'dsh-soul-whale-body',
  whaleShape: 'dsh-soul-whale-shape',
  whaleSweep: 'dsh-soul-whale-sweep',
  caret: 'dsh-soul-caret',
  caretOpen: 'dsh-soul-caret-open',

  // ── 卡片区（灵魂的权威形态） ──
  cardList: 'dsh-soul-card-list',
  cardRow: 'dsh-soul-card-row',
  cardRowOpen: 'dsh-soul-card-row-open',
  cardRowOff: 'dsh-soul-card-row-off',
  cardRowLanded: 'dsh-soul-card-row-landed',
  cardRowLeaving: 'dsh-soul-card-row-leaving',
  cardRowDrop: 'dsh-soul-card-row-drop',
  cardRowIn: 'dsh-soul-card-row-in',
  cardRowHead: 'dsh-soul-card-row-head',
  cardGrips: 'dsh-soul-card-grips',
  cardKindIcon: 'dsh-soul-card-kind',
  cardRowMain: 'dsh-soul-card-row-main',
  cardRowTitle: 'dsh-soul-card-row-title',
  cardRowMeta: 'dsh-soul-card-row-meta',
  cardRowDot: 'dsh-soul-card-row-dot',
  cardRowActions: 'dsh-soul-card-row-actions',
  cardEditor: 'dsh-soul-card-editor',
  cardEditorOpen: 'dsh-soul-card-editor-open',
  cardEditorInner: 'dsh-soul-card-editor-inner',
  cardEmpty: 'dsh-soul-card-empty',
  newCard: 'dsh-soul-new-card',
  kindPicker: 'dsh-soul-kind-picker',
  kindChip: 'dsh-soul-kind-chip',
  kindChipOn: 'dsh-soul-kind-chip-on',

  // ── 预设区 ──
  presetList: 'dsh-soul-preset-list',
  presetRow: 'dsh-soul-preset-row',
  presetRowIn: 'dsh-soul-preset-row-in',
  presetIcon: 'dsh-soul-preset-icon',
  presetIconBuiltin: 'dsh-soul-preset-icon-builtin',
  presetMain: 'dsh-soul-preset-main',
  presetName: 'dsh-soul-preset-name',
  presetDesc: 'dsh-soul-preset-desc',
  presetActions: 'dsh-soul-preset-actions',
  presetForm: 'dsh-soul-preset-form',
  presetFormOpen: 'dsh-soul-preset-form-open',
  presetFormInner: 'dsh-soul-preset-form-inner',

  // ── 折叠的「整段正文 / 身份 / 档案 / 蒸馏」（旧能力全保留，默认收起） ──
  legacy: 'dsh-soul-legacy',
  legacyHead: 'dsh-soul-legacy-head',
  legacyHeadDirty: 'dsh-soul-legacy-head-dirty',
  legacyBody: 'dsh-soul-legacy-body',
  legacyBodyOpen: 'dsh-soul-legacy-body-open',
  legacyInner: 'dsh-soul-legacy-inner',
} as const

const STYLE_ID = 'dsh-triad-soul-styles'

const SHEET = `
/* ── 变量域：官方 token 的短名聚合（面板与浮层两处各挂一次） ─────────── */
.dsh-soul-root,.dsh-soul-card,.dsh-soul-toggle-row{
  --s-primary:var(--dsw-alias-state-business-primary,#4176e6);
  --s-primary-hover:var(--dsw-alias-button-info-hover,var(--dsw-alias-state-business-primary,#4176e6));
  --s-primary-soft:color-mix(in srgb,var(--s-primary) 12%,transparent);
  --s-primary-chip:color-mix(in srgb,var(--s-primary) 10%,transparent);
  --s-text:var(--dsw-alias-label-primary,#1f2329);
  --s-text-2:var(--dsw-alias-label-secondary,#5b6068);
  --s-text-3:var(--dsw-alias-label-tertiary,#81858c);
  --s-border:var(--dsw-alias-border-l1,rgba(0,0,0,.08));
  --s-border-2:var(--dsw-alias-border-l2,rgba(0,0,0,.14));
  --s-border-3:var(--dsw-alias-border-l3,rgba(0,0,0,.2));
  --s-layer:var(--dsw-alias-bg-layer-1,#fff);
  --s-soft:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--s-text) 5%,transparent));
  --s-hover:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--s-text) 6%,transparent));
  --s-ok:var(--dsw-alias-state-success-primary,#3aa675);
  --s-ok-bg:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3aa675) 13%,transparent);
  --s-warn:var(--dsw-alias-state-warn-primary,#e8a33d);
  --s-warn-bg:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 14%,transparent);
  --s-err:var(--dsw-alias-state-error-primary,#e0434b);
  --s-err-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 12%,transparent);
  --s-info:var(--dsw-alias-state-info-primary,#5b9dff);
  --s-info-bg:color-mix(in srgb,var(--dsw-alias-state-info-primary,#5b9dff) 12%,transparent);
  /* 草案对比的高亮底：由状态色派生，不另立色板 */
  --s-diff-add:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3aa675) 16%,transparent);
  --s-diff-del:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 14%,transparent);
  /* 鲸鱼流光色：由主色派生（不是新色板），保证与面板强调色同源 */
  --s-whale-sweep:var(--dsw-alias-state-business-primary,#4176e6);
  --s-whale-glow:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 26%,transparent);
  /* 浮层卡片底色（开关圆点要用它做反色） */
  --s-card-bg:var(--dsw-static-neutral-bluish-00,#fff);
  color:var(--s-text);
}

/* ── 面板骨架 ─────────────────────────────────────────────────────── */
/* root = 内容列（自带内距与错峰入场）；scroll 只负责在「非 embedded」时撑满并滚动。
   embedded 时面板挂在记忆工作台的 viewFull 里（父级已经 overflow-y:auto），
   这里再套一层滚动容器就会出现两条滚动条。
   container-type:inline-size —— 面板既可能独占一整页（宽），也可能只是并排布局的
   左半（485px）。两栏编辑器在后者会被压塌，所以尺寸判断必须看**自身宽度**而不是
   视口宽度：容器查询是唯一正确的手段（媒体查询在这里永远是错的）。 */
.dsh-soul-root{container-type:inline-size;container-name:soulpanel;display:flex;flex-direction:column;gap:12px;padding:14px 16px 26px;box-sizing:border-box;min-width:0;font-size:13px;line-height:20px}
.dsh-soul-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column}

/* 入场错峰：与工作台弹窗的 stagger 同节奏（60ms 起步、每块 +40ms）。
   backwards 而非 both——both 会在结束后残留 to 帧 transform，把后代 position:fixed
   的浮层变成局部坐标（本仓在 modal stagger 上踩过）。 */
.dsh-soul-root>*{animation:dsh-soul-rise .24s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-root>*:nth-child(1){animation-delay:0ms}
.dsh-soul-root>*:nth-child(2){animation-delay:40ms}
.dsh-soul-root>*:nth-child(3){animation-delay:80ms}
.dsh-soul-root>*:nth-child(4){animation-delay:120ms}
.dsh-soul-root>*:nth-child(5){animation-delay:160ms}
.dsh-soul-root>*:nth-child(n+6){animation-delay:200ms}
@keyframes dsh-soul-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ── 头部：**一行**放下鲸鱼 + 标题 + 状态 ─────────────────────────────
   改版前是「鲸鱼独占一行 + 标题 + 两行说明 + 右侧四个胶囊」，头部 162px；
   现在 30px 鲸鱼与标题同行，说明压成单行省略（全文进 title），
   只有「有没有未保存改动」留成可见状态。 */
.dsh-soul-header{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-soul-brand{flex:1;min-width:0;display:flex;align-items:center;gap:10px}
.dsh-soul-hero{flex:none;display:inline-flex;align-items:center;justify-content:center}
.dsh-soul-head-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}
.dsh-soul-title{display:inline-flex;align-items:center;gap:7px;font-size:14.5px;font-weight:650;line-height:21px;color:var(--s-text)}
.dsh-soul-title svg{color:var(--s-primary)}
.dsh-soul-desc{font-size:11.5px;line-height:16px;color:var(--s-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-head-meta{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}

/* ── 状态胶囊 ─────────────────────────────────────────────────────── */
.dsh-soul-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;font-size:11px;line-height:17px;white-space:nowrap;background:color-mix(in srgb,var(--s-text-3) 14%,transparent);color:var(--s-text-2)}
.dsh-soul-chip-ok{background:var(--s-ok-bg);color:var(--s-ok)}
.dsh-soul-chip-warn{background:var(--s-warn-bg);color:var(--s-warn)}
.dsh-soul-chip-err{background:var(--s-err-bg);color:var(--s-err)}
.dsh-soul-chip-muted{background:color-mix(in srgb,var(--s-text-3) 12%,transparent);color:var(--s-text-3)}

/* ── 头部那枚「保存状态」呼吸点 ─────────────────────────────────────
   四个胶囊收成一枚：只有「有没有未保存改动」需要一眼看到，version / 时间 /
   注入开关降级进 title 与侧栏档案卡。未保存时琥珀点脉冲——一眼就知道要保存。 */
.dsh-soul-state{display:inline-flex;align-items:center;gap:5px;flex:none;padding:1px 8px 1px 6px;border-radius:999px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;transition:background .22s ease,color .22s ease}
.dsh-soul-state-dot{flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
.dsh-soul-state-saved{background:var(--s-ok-bg);color:var(--s-ok)}
.dsh-soul-state-dirty{background:var(--s-warn-bg);color:var(--s-warn)}
.dsh-soul-state-dirty .dsh-soul-state-dot{animation:dsh-soul-blink 1.5s ease-in-out infinite}
@keyframes dsh-soul-blink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.78)}}

/* ── 顶部 notice（淡入淡出，不用 alert） ──────────────────────────── */
.dsh-soul-notice{display:flex;align-items:center;gap:7px;margin:0;padding:7px 11px;border-radius:9px;font-size:12.5px;line-height:19px;opacity:0;transform:translateY(-4px);max-height:0;padding-top:0;padding-bottom:0;overflow:hidden;transition:opacity .18s ease,transform .18s cubic-bezier(.2,.8,.2,1),max-height .2s ease,padding .2s ease;pointer-events:none}
.dsh-soul-notice-on{opacity:1;transform:none;max-height:80px;padding-top:7px;padding-bottom:7px;pointer-events:auto}
.dsh-soul-notice-ok{border:1px solid var(--s-ok);background:var(--s-ok-bg);color:var(--s-ok)}
.dsh-soul-notice-err{border:1px solid var(--s-err);background:var(--s-err-bg);color:var(--s-err)}

/* ── 折叠区（旧能力：整段正文 / 身份字段 / 档案 / 蒸馏） ────────────── */
.dsh-soul-legacy{display:flex;flex-direction:column;gap:10px}
.dsh-soul-legacy-head{display:flex;align-items:center;gap:7px;align-self:stretch;justify-content:center;appearance:none;border:1px solid var(--s-border-2);border-radius:9px;background:var(--s-layer);padding:6px 11px;font-family:inherit;font-size:12px;font-weight:500;line-height:18px;color:var(--s-text-2);cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease}
.dsh-soul-legacy-head:hover{border-color:var(--s-primary);color:var(--s-primary);background:var(--s-primary-soft)}
/* 未保存态：折叠时保存按钮藏在里面，入口必须自己会喊人（琥珀色 + 呼吸点） */
.dsh-soul-legacy-head-dirty,.dsh-soul-legacy-head-dirty:hover{border-color:color-mix(in srgb,var(--s-warn) 55%,transparent);color:var(--s-warn);background:var(--s-warn-bg)}
.dsh-soul-legacy-head-dirty .dsh-soul-state-dot{animation:dsh-soul-blink 1.5s ease-in-out infinite}
.dsh-soul-legacy-body{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),opacity .2s ease,visibility 0s linear .22s}
.dsh-soul-legacy-body-open{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),opacity .2s ease,visibility 0s}
.dsh-soul-legacy-body>*{overflow:hidden;min-height:0}
.dsh-soul-legacy-inner{display:flex;flex-direction:column;gap:12px}

/* ── 双栏主体：左卡片 / 右预设（2026-10-05 用户要求「灵魂用双栏布局」） ──
   拆成独立分类后灵魂独占整页（实测 969px），单列堆叠会让右半边整片空着。
   左栏给卡片区（内容随卡片数量增长，是主工作区），右栏给预设区（条数固定 4~6 条）。
   比例 1.55 : 1 —— 卡片行有标题 + 元信息 + 开关 + 两个图标按钮，需要更宽；
   预设行只有「图标 + 名称 + 两个按钮」，440px 足够。
   align-items: start：预设只有 4 条时不要被拉伸成与左栏等高的空卡。
   折叠看**自身**宽度（容器查询）而非视口，窄面板下顺序为卡片 → 预设。 */
.dsh-soul-columns{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px;align-items:start}
.dsh-soul-col-left,.dsh-soul-col-right{min-width:0;display:flex;flex-direction:column;gap:12px}

/* ── 两栏 ───────────────────────────────────────────────────────────
   侧栏从写死的 320px 收到 300px，并在**面板自身**窄于 820px 时折叠成单列。
   并排布局里左栏只有 485px：不折叠的话主栏剩不到 120px，正文编辑器会竖排成
   两个字一行（改版前截图里最难看的正是这处）。 */
.dsh-soul-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,300px);gap:14px;align-items:start}
.dsh-soul-main-col,.dsh-soul-side-col{min-width:0;display:flex;flex-direction:column;gap:14px}

/* ── 卡片 ─────────────────────────────────────────────────────────── */
.dsh-soul-card{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--s-border-2);border-radius:12px;background:var(--s-layer);box-sizing:border-box;transition:border-color .18s ease,box-shadow .18s ease}
.dsh-soul-card:hover{border-color:color-mix(in srgb,var(--s-primary) 40%,transparent)}
.dsh-soul-card-title{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;line-height:21px;color:var(--s-text)}
.dsh-soul-card-title svg{color:var(--s-primary)}
.dsh-soul-card-hint{font-size:11.5px;line-height:17px;color:var(--s-text-3)}

/* ── 编辑 / 预览 段控 ─────────────────────────────────────────────── */
.dsh-soul-tabs{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:var(--s-soft);align-self:flex-start}
.dsh-soul-tab{appearance:none;border:none;background:transparent;border-radius:6px;height:26px;padding:0 12px;font-family:inherit;font-size:12px;font-weight:500;line-height:18px;color:var(--s-text-2);cursor:pointer;transition:background .16s ease,color .16s ease}
.dsh-soul-tab:hover{color:var(--s-text)}
.dsh-soul-tab-active,.dsh-soul-tab-active:hover{background:var(--s-layer);color:var(--s-primary);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--s-text) 14%,transparent)}

/* ── 表单 ─────────────────────────────────────────────────────────── */
.dsh-soul-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.dsh-soul-field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0}
.dsh-soul-label{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;line-height:18px;color:var(--s-text-2)}
.dsh-soul-input,.dsh-soul-textarea{box-sizing:border-box;border:1px solid var(--s-border-2);border-radius:9px;padding:0 10px;font-family:inherit;font-size:13px;line-height:20px;color:var(--s-text);background:var(--s-layer);transition:border-color .16s ease,box-shadow .16s ease}
.dsh-soul-input{height:32px}
.dsh-soul-input::placeholder,.dsh-soul-textarea::placeholder{color:var(--s-text-3)}
.dsh-soul-input:focus,.dsh-soul-input:focus-visible,.dsh-soul-textarea:focus,.dsh-soul-textarea:focus-visible{outline:none;border-color:var(--s-primary);box-shadow:0 0 0 2px var(--s-primary-soft)}
.dsh-soul-textarea{width:100%;min-height:96px;padding:8px 10px;resize:vertical;line-height:21px}
.dsh-soul-textarea-tall{min-height:240px;font-size:13.5px;line-height:22px}
.dsh-soul-counter{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;line-height:16px;color:var(--s-text-3);font-variant-numeric:tabular-nums}
.dsh-soul-counter-over{color:var(--s-warn)}
.dsh-soul-principles{display:flex;flex-direction:column;gap:2px}
.dsh-soul-principles .dsh-soul-textarea{min-height:76px}

/* ── 按钮 ─────────────────────────────────────────────────────────── */
.dsh-soul-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-soul-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;box-sizing:border-box;border:1px solid var(--s-border-2);border-radius:9px;background:var(--s-layer);color:var(--s-text-2);font-family:inherit;font-size:12.5px;font-weight:500;line-height:19px;cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease,transform .12s ease,box-shadow .16s ease}
.dsh-soul-btn:hover:not(:disabled){border-color:var(--s-primary);color:var(--s-primary);background:var(--s-primary-soft)}
.dsh-soul-btn:active:not(:disabled){transform:scale(.97)}
.dsh-soul-btn:disabled{opacity:.45;cursor:default}
.dsh-soul-btn-primary{border-color:transparent;background:var(--s-primary);color:#fff}
.dsh-soul-btn-primary:hover:not(:disabled){border-color:transparent;background:var(--s-primary-hover);color:#fff;box-shadow:0 4px 14px color-mix(in srgb,var(--s-primary) 30%,transparent)}
.dsh-soul-btn-ghost{border-color:transparent;background:transparent}
.dsh-soul-btn-ghost:hover:not(:disabled){background:var(--s-hover);color:var(--s-text)}
.dsh-soul-btn-danger:hover:not(:disabled){border-color:var(--s-err);color:var(--s-err);background:var(--s-err-bg)}
.dsh-soul-btn-icon{width:28px;height:28px;padding:0;border-radius:8px}
/* 保存成功的按钮内打勾反馈：按钮闪一下 + 勾号自己弹出来 */
.dsh-soul-btn-done{border-color:var(--s-ok);color:var(--s-ok);background:var(--s-ok-bg);animation:dsh-soul-btn-pop .26s cubic-bezier(.2,.8,.2,1)}
@keyframes dsh-soul-btn-pop{0%{transform:scale(1)}45%{transform:scale(1.045)}100%{transform:scale(1)}}
.dsh-soul-check{display:inline-flex;animation:dsh-soul-check-in .26s cubic-bezier(.2,1.4,.4,1)}
@keyframes dsh-soul-check-in{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
/* 进行中的转圈 */
.dsh-soul-spin{display:inline-flex;animation:dsh-soul-rotate .9s linear infinite}
@keyframes dsh-soul-rotate{from{transform:rotate(0)}to{transform:rotate(360deg)}}

/* ── 灵魂档案 ─────────────────────────────────────────────────────── */
.dsh-soul-profiles{display:flex;flex-direction:column;gap:6px}
.dsh-soul-profile-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--s-border-2);border-radius:10px;background:var(--s-layer);box-sizing:border-box;transition:border-color .18s ease,background .18s ease,transform .16s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-profile-row:hover{border-color:color-mix(in srgb,var(--s-primary) 45%,transparent);transform:translateY(-1px)}
.dsh-soul-profile-row-active,.dsh-soul-profile-row-active:hover{border-color:color-mix(in srgb,var(--s-primary) 55%,transparent);background:var(--s-primary-soft)}
.dsh-soul-profile-row-in{animation:dsh-soul-row-in .22s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes dsh-soul-row-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.dsh-soul-profile-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-soul-profile-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;font-weight:600;line-height:19px;color:var(--s-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-profile-meta{font-size:11px;line-height:16px;color:var(--s-text-3);font-variant-numeric:tabular-nums}
.dsh-soul-profile-actions{flex:none;display:flex;align-items:center;gap:2px}
.dsh-soul-badge{flex:none;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--s-text-3) 14%,transparent);color:var(--s-text-3);font-size:10px;font-weight:600;line-height:16px}
.dsh-soul-badge-on{background:var(--s-primary-chip);color:var(--s-primary)}
.dsh-soul-profile-new{display:flex;align-items:center;gap:6px}
.dsh-soul-profile-new-row{display:flex;align-items:center;gap:6px;animation:dsh-soul-row-in .2s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-profile-new-row .dsh-soul-input{flex:1;min-width:0}

/* ── 蒸馏草案（位移 + 淡入落位） ──────────────────────────────────── */
.dsh-soul-draft{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid color-mix(in srgb,var(--s-primary) 45%,transparent);border-radius:12px;background:var(--s-layer);box-sizing:border-box;box-shadow:0 4px 18px color-mix(in srgb,var(--s-primary) 12%,transparent);animation:dsh-soul-draft-in .26s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes dsh-soul-draft-in{from{opacity:0;transform:translateY(12px) scale(.99)}to{opacity:1;transform:none}}
.dsh-soul-draft-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-soul-draft-title{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;line-height:21px;color:var(--s-text)}
.dsh-soul-draft-title svg{color:var(--s-primary)}
.dsh-soul-draft-stats{margin-left:auto;font-size:11.5px;line-height:17px;color:var(--s-text-3);font-variant-numeric:tabular-nums}
.dsh-soul-draft-notes{padding:8px 10px;border-radius:9px;background:var(--s-soft);font-size:12px;line-height:19px;color:var(--s-text-2);white-space:pre-wrap;word-break:break-word}
.dsh-soul-diff-hint{font-size:11px;line-height:16px;color:var(--s-text-3)}

/* 两栏 diff（左=当前灵魂，右=草案）：差异行整行高亮，同色系底 */
.dsh-soul-diff{display:flex;align-items:stretch;gap:10px;min-width:0}
.dsh-soul-diff-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.dsh-soul-diff-divider{flex:none;width:1px;background:var(--s-border-2)}
.dsh-soul-diff-col-head{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;line-height:17px;color:var(--s-text-2)}
.dsh-soul-diff-body{max-height:320px;overflow-y:auto;border:1px solid var(--s-border);border-radius:9px;background:var(--s-layer);padding:6px 0}
.dsh-soul-diff-line{margin:0;padding:1px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:18px;color:var(--s-text-2);white-space:pre-wrap;word-break:break-word;transition:background .18s ease,color .18s ease}
.dsh-soul-diff-line-same{color:var(--s-text-2)}
.dsh-soul-diff-line-add{background:var(--s-diff-add);color:var(--s-text)}
.dsh-soul-diff-line-del{background:var(--s-diff-del);color:var(--s-text);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--s-err) 60%,transparent)}

/* ── 预览 / 身份只读展示 ──────────────────────────────────────────── */
.dsh-soul-preview{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:21px;color:var(--s-text);max-height:320px;overflow-y:auto}
.dsh-soul-preview-empty{font-size:12.5px;line-height:19px;color:var(--s-text-3)}
.dsh-soul-identity-list{display:flex;flex-direction:column;gap:4px}
.dsh-soul-identity-row{display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px;align-items:baseline}
.dsh-soul-identity-key{font-size:11.5px;line-height:18px;color:var(--s-text-3)}
.dsh-soul-identity-val{min-width:0;font-size:12.5px;line-height:18px;color:var(--s-text);word-break:break-word}

/* ── 空态 / 骨架 / host 未更新 ────────────────────────────────────── */
.dsh-soul-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:32px 20px;border:1px dashed var(--s-border-2);border-radius:12px;box-sizing:border-box;text-align:center}
.dsh-soul-empty-icon{display:inline-flex;color:var(--s-text-3);opacity:.8}
.dsh-soul-empty-text{font-size:13px;line-height:20px;color:var(--s-text-2)}
.dsh-soul-empty-hint{font-size:11.5px;line-height:17px;color:var(--s-text-3);max-width:440px}
.dsh-soul-stale{border-color:var(--s-warn);border-style:solid;background:var(--s-warn-bg)}
.dsh-soul-stale .dsh-soul-empty-icon{color:var(--s-warn);opacity:1}
.dsh-soul-stale .dsh-soul-empty-text{color:var(--s-warn)}
.dsh-soul-skeleton{display:flex;flex-direction:column;gap:10px}
.dsh-soul-skeleton-row{height:44px;border-radius:10px;background:var(--s-soft);animation:dsh-soul-pulse 1.4s ease-in-out infinite}
.dsh-soul-skeleton-row:nth-child(2){animation-delay:.12s}
.dsh-soul-skeleton-row:nth-child(3){animation-delay:.24s}
@keyframes dsh-soul-pulse{0%,100%{opacity:.45}50%{opacity:.9}}

/* ── composer 浮层里的一行开关（挂在记忆面板作用域之外） ─────────── */
.dsh-soul-card{background:var(--s-card-bg)}
body[data-ds-dark-theme] .dsh-soul-card,
body[data-ds-dark-theme] .dsh-soul-toggle-row{--s-card-bg:var(--dsw-static-neutral-bluish-1000,#16181d)}
.dsh-soul-toggle-row{display:flex;align-items:center;gap:10px;padding:8px 0}
.dsh-soul-toggle-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-soul-toggle-label{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;line-height:19px;color:var(--s-text)}
.dsh-soul-toggle-hint{font-size:11px;line-height:15px;color:var(--s-text-3)}
/* 开关走中性黑白（与记忆面板同款）：开 = 主文字色实心轨道 + 反色圆点，
   关 = 淡灰轨道。不引入第二个强调色，主题切换自动跟随。 */
.dsh-soul-switch{position:relative;flex:none;width:40px;height:22px;border:none;border-radius:11px;padding:0;background:var(--s-border-2);cursor:pointer;box-sizing:border-box;transition:background .18s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--s-text-3);box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .18s cubic-bezier(.2,.8,.2,1),background .18s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-switch[aria-checked='true']{background:var(--s-text)}
.dsh-soul-switch[aria-checked='true']::after{transform:translateX(18px);background:var(--s-card-bg)}
.dsh-soul-switch:disabled{opacity:.5;cursor:default}

/* ── 会动的鲸鱼（面板顶部那枚 DSH logo） ─────────────────────────────
   三组动效各管一件事，互不干扰：
     whale        外层 hover 判定（摆尾用；hover 在 svg 子元素上不好控）
     whale-body   呼吸缩放 + hover 摆尾（同一个 transform 属性，必须合并在一条规则里，
                  否则后写的 animation 会把前面的覆盖掉）
     whale-sweep  沿轮廓跑的流光描边
   stroke-dasharray 的段长按 path 总长（3448）取：亮段 0.6%，暗段 99.4%，
   dashoffset 从 0 跑到 -3448 恰好绕轮廓一圈。 */
.dsh-soul-whale{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--s-text);cursor:default}
.dsh-soul-whale svg{display:block;overflow:visible}
.dsh-soul-whale-body{transform-box:fill-box;transform-origin:50% 50%;animation:dsh-soul-whale-breathe 3.6s ease-in-out infinite}
.dsh-soul-whale:hover .dsh-soul-whale-body{animation:dsh-soul-whale-breathe 3.6s ease-in-out infinite,dsh-soul-whale-tail 1.05s cubic-bezier(.36,.07,.19,.97) infinite}
@keyframes dsh-soul-whale-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes dsh-soul-whale-tail{0%,100%{transform:rotate(-3.2deg) scale(1.02)}50%{transform:rotate(3.2deg) scale(1.06)}}
.dsh-soul-whale-shape{transition:opacity .2s ease}
.dsh-soul-whale-glow{fill:var(--s-whale-glow);animation:dsh-soul-whale-glow 3.6s ease-in-out infinite}
@keyframes dsh-soul-whale-glow{0%,100%{opacity:.25;transform:scaleX(.86)}50%{opacity:.6;transform:scaleX(1.06)}}
.dsh-soul-whale-sweep{color:var(--s-whale-sweep);stroke-dasharray:20.7 3427.3;stroke-dashoffset:0;animation:dsh-soul-whale-sweep 2.8s linear infinite}
@keyframes dsh-soul-whale-sweep{from{stroke-dashoffset:0}to{stroke-dashoffset:-3448}}
/* 静态模式（animated=false）：只留呼吸，去掉流光与光晕，图形仍然完整可辨 */
.dsh-soul-whale-still .dsh-soul-whale-sweep,.dsh-soul-whale-still .dsh-soul-whale-glow{display:none}
.dsh-soul-whale-still .dsh-soul-whale-body{animation:none}

/* ── 卡片区 ─────────────────────────────────────────────────────────
   一行一张卡：左 = 调序握把 + kind 图标 + 标题（点开编辑）；右 = 启用开关 + 展开 + 删除。
   拖拽调序用原生 HTML5 drag（零依赖），落位时给一次性 keyframes 弹一下。
   左侧那条主色竖条 = 「当前行」标记：hover / 展开时从 40% 高度弹到满高，
   比纯边框高亮更容易在长列表里定位到自己正在编辑的那张卡。 */
.dsh-soul-card-list{display:flex;flex-direction:column;gap:6px}
.dsh-soul-card-row{position:relative;display:flex;flex-direction:column;border:1px solid var(--s-border-2);border-radius:10px;background:var(--s-layer);box-sizing:border-box;transition:border-color .18s ease,background .18s ease,box-shadow .18s ease,transform .16s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-card-row::after{content:'';position:absolute;left:0;top:9px;bottom:9px;width:2px;border-radius:0 2px 2px 0;background:var(--s-primary);opacity:0;transform:scaleY(.35);transition:opacity .2s ease,transform .24s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-card-row:hover{border-color:color-mix(in srgb,var(--s-primary) 42%,transparent)}
.dsh-soul-card-row:hover::after{opacity:.7;transform:scaleY(1)}
.dsh-soul-card-row-open{border-color:color-mix(in srgb,var(--s-primary) 55%,transparent);background:var(--s-layer);box-shadow:0 4px 16px color-mix(in srgb,var(--s-primary) 10%,transparent)}
.dsh-soul-card-row-open::after{opacity:1;transform:scaleY(1)}
/* 禁用态：整行降透明度 + 虚线边，一眼看出「这张卡不参与注入」 */
.dsh-soul-card-row-off{opacity:.62;border-style:dashed;background:transparent}
.dsh-soul-card-row-off:hover{opacity:.82}
.dsh-soul-card-row-in{animation:dsh-soul-row-in .22s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-card-row-landed{animation:dsh-soul-land .3s cubic-bezier(.2,1.3,.4,1)}
@keyframes dsh-soul-land{0%{transform:scale(1)}40%{transform:scale(1.018) translateY(-1px)}100%{transform:scale(1)}}
/* 删除的退场：向左缩掉再让回包把行摘掉（破坏性操作要有「确实处理了」的反馈） */
.dsh-soul-card-row-leaving{opacity:0;transform:translateX(-10px) scale(.985);pointer-events:none}
/* 拖拽插入位：顶部一条主色指示线（原生 drag 默认没有任何视觉反馈） */
.dsh-soul-card-row-drop{box-shadow:inset 0 2px 0 0 var(--s-primary)}
.dsh-soul-card-row-drop::before{content:'';position:absolute;left:8px;right:8px;top:-3px;height:2px;border-radius:2px;background:var(--s-primary);animation:dsh-soul-drop-in .18s ease}
@keyframes dsh-soul-drop-in{from{opacity:0;transform:scaleX(.6)}to{opacity:1;transform:scaleX(1)}}
.dsh-soul-card-row-head{display:flex;align-items:center;gap:8px;padding:7px 9px;min-width:0}
.dsh-soul-card-grips{flex:none;display:inline-flex;align-items:center;gap:1px;opacity:0;transition:opacity .18s ease}
.dsh-soul-card-row:hover .dsh-soul-card-grips,.dsh-soul-card-row-open .dsh-soul-card-grips{opacity:1}
.dsh-soul-card-grips .dsh-soul-btn-icon{width:24px;height:24px;border-radius:7px}
.dsh-soul-card-kind{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:var(--s-primary-chip);color:var(--s-primary);transition:background .18s ease,color .18s ease}
.dsh-soul-card-kind[data-kind='boundaries']{background:var(--s-warn-bg);color:var(--s-warn)}
.dsh-soul-card-kind[data-kind='custom']{background:color-mix(in srgb,var(--s-text-3) 14%,transparent);color:var(--s-text-2)}
.dsh-soul-card-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;align-items:flex-start;appearance:none;border:none;background:transparent;padding:0;text-align:left;font-family:inherit;cursor:pointer}
.dsh-soul-card-row-title{max-width:100%;font-size:12.5px;font-weight:600;line-height:19px;color:var(--s-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-card-row-meta{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;line-height:15px;color:var(--s-text-3)}
.dsh-soul-card-row-dot{opacity:.6}
.dsh-soul-card-row-actions{flex:none;display:inline-flex;align-items:center;gap:3px;opacity:.7;transition:opacity .18s ease}
.dsh-soul-card-row:hover .dsh-soul-card-row-actions,.dsh-soul-card-row-open .dsh-soul-card-row-actions{opacity:1}
.dsh-soul-card-row-actions .dsh-soul-btn-icon{width:26px;height:26px;border-radius:7px}
/* 展开：高度动画只能用 max-height；内层再淡入，读起来像「抽出来」而不是「撑开」 */
.dsh-soul-card-editor{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
.dsh-soul-card-editor-open{grid-template-rows:1fr;opacity:1}
.dsh-soul-card-editor-inner{overflow:hidden;min-height:0;display:flex;flex-direction:column;gap:9px;padding:0 9px;visibility:hidden;transition:padding .22s ease,visibility 0s linear .22s}
.dsh-soul-card-editor-open .dsh-soul-card-editor-inner{padding:2px 9px 10px;visibility:visible;transition:padding .22s ease,visibility 0s}
.dsh-soul-caret{transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-caret-open{transform:rotate(90deg)}
/* 空态：从「虚线大框」降成一行灰字——空列表不需要一块 66px 高的牌子 */
.dsh-soul-card-empty{padding:8px 2px;font-size:12px;line-height:18px;color:var(--s-text-3)}
.dsh-soul-new-card{display:flex;flex-direction:column;gap:9px;padding:11px;border:1px solid color-mix(in srgb,var(--s-primary) 45%,transparent);border-radius:10px;background:var(--s-primary-soft);box-sizing:border-box;animation:dsh-soul-row-in .22s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-kind-picker{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-soul-kind-chip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:1px solid var(--s-border-2);border-radius:8px;background:var(--s-layer);color:var(--s-text-2);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease,transform .12s ease}
.dsh-soul-kind-chip:hover{border-color:var(--s-primary);color:var(--s-primary)}
.dsh-soul-kind-chip:active{transform:scale(.97)}
.dsh-soul-kind-chip-on,.dsh-soul-kind-chip-on:hover{border-color:transparent;background:var(--s-primary);color:#fff}

/* ── 预设区 ─────────────────────────────────────────────────────────
   一行一个预设：左图标 + 名称/徽标，右两个动作（整体替换 / 合并应用）+ 删除（仅自定义）。
   两个按钮常驻会变成一堵按钮墙，所以默认压到 55% 透明度、行 hover 才提满；
   说明文字也不再常驻，改为整行的 title 提示（信息没丢，只是不再抢视线）。 */
.dsh-soul-preset-list{display:flex;flex-direction:column;gap:6px}
.dsh-soul-preset-row{display:flex;align-items:center;gap:9px;padding:7px 10px;border:1px solid var(--s-border-2);border-radius:10px;background:var(--s-layer);box-sizing:border-box;transition:border-color .18s ease,background .18s ease,transform .16s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease}
.dsh-soul-preset-row:hover{border-color:color-mix(in srgb,var(--s-primary) 45%,transparent);transform:translateY(-1px);box-shadow:0 3px 12px color-mix(in srgb,var(--s-text) 7%,transparent)}
.dsh-soul-preset-row-in{animation:dsh-soul-row-in .22s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-preset-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:color-mix(in srgb,var(--s-text-3) 13%,transparent);color:var(--s-text-2)}
.dsh-soul-preset-icon-builtin{background:var(--s-primary-chip);color:var(--s-primary)}
.dsh-soul-preset-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-soul-preset-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;font-weight:600;line-height:19px;color:var(--s-text);flex-wrap:wrap}
.dsh-soul-preset-desc{font-size:11px;line-height:16px;color:var(--s-text-3);word-break:break-word}
.dsh-soul-preset-actions{flex:none;display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:flex-end;opacity:.42;transition:opacity .2s ease}
.dsh-soul-preset-row:hover .dsh-soul-preset-actions{opacity:1}
.dsh-soul-preset-actions .dsh-soul-btn{height:26px;padding:0 10px;font-size:11.5px;border-radius:8px}
.dsh-soul-preset-actions .dsh-soul-btn-icon{width:26px;padding:0}
/* 主按钮在预设行里静止时降为描边，行 hover 才点亮成实心主色：
   四行预设 = 四个实心蓝按钮，静止时那就是一堵按钮墙（用户嫌「丑」的主因之一）。
   功能一个没少，只是把「可点」的强调推迟到用户真的看向这一行的时候。 */
.dsh-soul-preset-actions .dsh-soul-btn-primary{border-color:color-mix(in srgb,var(--s-primary) 42%,transparent);background:var(--s-layer);color:var(--s-primary);box-shadow:none}
.dsh-soul-preset-row:hover .dsh-soul-preset-actions .dsh-soul-btn-primary{border-color:transparent;background:var(--s-primary);color:#fff}
.dsh-soul-preset-row:hover .dsh-soul-preset-actions .dsh-soul-btn-primary:hover:not(:disabled){background:var(--s-primary-hover);box-shadow:0 4px 14px color-mix(in srgb,var(--s-primary) 30%,transparent)}
/* 已应用（打勾态）与失败态优先于上面的降级规则，否则成功反馈会被盖掉 */
.dsh-soul-preset-actions .dsh-soul-btn-primary.dsh-soul-btn-done,
.dsh-soul-preset-row:hover .dsh-soul-preset-actions .dsh-soul-btn-primary.dsh-soul-btn-done{border-color:var(--s-ok);background:var(--s-ok-bg);color:var(--s-ok)}
/* 存为预设表单：与卡片展开同款的高度过渡，收起时不占位 */
.dsh-soul-preset-form{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
.dsh-soul-preset-form-open{grid-template-rows:1fr;opacity:1}
.dsh-soul-preset-form-inner{overflow:hidden;min-height:0;display:flex;flex-direction:column;gap:9px;padding:0;visibility:hidden;transition:padding .22s ease,visibility 0s linear .22s}
.dsh-soul-preset-form-open .dsh-soul-preset-form-inner{padding-top:10px;visibility:visible;transition:padding .22s ease,visibility 0s}

/* ── focus 规范 ───────────────────────────────────────────────────── */
.dsh-soul-tab:focus-visible,.dsh-soul-btn:focus-visible,.dsh-soul-input:focus-visible,
.dsh-soul-textarea:focus-visible,.dsh-soul-switch:focus-visible,.dsh-soul-legacy-head:focus-visible,
.dsh-soul-card-row-main:focus-visible,.dsh-soul-kind-chip:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--s-primary) 35%,transparent)}

/* ── 窄面板：右栏落到主栏下面 ───────────────────────────────────────
   看的是**面板自身**宽度（container-type 在 .dsh-soul-root 上），
   所以并排布局的 485px 左半页也会正确折叠成单列。 */
@container soulpanel (max-width: 820px){
  .dsh-soul-cols{grid-template-columns:minmax(0,1fr)}
  .dsh-soul-diff{flex-direction:column}
  .dsh-soul-diff-divider{width:auto;height:1px}
}
/* 双栏在 900px 以下折叠：再窄卡片行的动作按钮会被挤到换行 */
@container soulpanel (max-width: 900px){
  .dsh-soul-columns{grid-template-columns:minmax(0,1fr)}
}
/* ── 右栏（预设）在半宽下的降级 ──────────────────────────────────────
   右栏实测 380~440px：预设行里「名称 + 内置徽标 + N 张卡 + 两个按钮」挤不下，
   徽标会被 flex-wrap 顶到第二行，一行从 42px 涨到 66px——四行就是 100px 白高。
   做法不是砍按钮（功能不能少），而是让**徽标让位**：名称单行省略、卡片数徽标隐藏
   （卡数在「整体替换」的语义里不是决策信息），按钮永远完整。 */
@container soulpanel (max-width: 1180px){
  .dsh-soul-preset-name{flex-wrap:nowrap;overflow:hidden}
  .dsh-soul-preset-name>span:not(.dsh-soul-badge){display:none}
  .dsh-soul-preset-main{overflow:hidden}
  /* 开关行同理：说明文字必须能换行，否则会被右侧 40px 的开关压住
     （实测「每会话首步注入一次…」在 300px 侧栏里被开关盖掉后半句）。 */
  .dsh-soul-toggle-row{flex-wrap:wrap}
  .dsh-soul-toggle-label{flex-wrap:wrap}
  .dsh-soul-toggle-hint{overflow-wrap:anywhere}
  .dsh-soul-switch{margin-left:auto}
}
@container soulpanel (max-width: 560px){
  .dsh-soul-field-row{grid-template-columns:minmax(0,1fr)}
  .dsh-soul-card-row-head{flex-wrap:wrap}
  .dsh-soul-card-row-actions{margin-left:auto}
  .dsh-soul-preset-row{flex-wrap:wrap}
  .dsh-soul-preset-actions{margin-left:auto}
}
/* 媒体查询兜底：宿主没开容器查询时（老 WebView），按视口宽度折叠。 */
@media (max-width: 1080px){
  .dsh-soul-cols{grid-template-columns:minmax(0,1fr)}
  .dsh-soul-diff{flex-direction:column}
  .dsh-soul-diff-divider{width:auto;height:1px}
}
/* 媒体查询兜底同样覆盖双栏（老 WebView 无容器查询时按视口折叠） */
@media (max-width: 1180px){
  .dsh-soul-columns{grid-template-columns:minmax(0,1fr)}
}
@media (max-width: 720px){
  .dsh-soul-field-row{grid-template-columns:minmax(0,1fr)}
  .dsh-soul-scroll{padding:12px 12px 22px}
  .dsh-soul-card-row-head{flex-wrap:wrap}
  .dsh-soul-card-row-actions{margin-left:auto}
  .dsh-soul-preset-row{flex-wrap:wrap}
  .dsh-soul-preset-actions{margin-left:auto}
}
/* ── 唯一的 reduced-motion 块（冒烟脚本按「第一处匹配后 600 字符内出现鲸鱼规则」
      断言，拆成多块会让那条断言静默失效，勿动顺序） ───────────────────── */
@media (prefers-reduced-motion:reduce){
  .dsh-soul-whale-body,.dsh-soul-whale:hover .dsh-soul-whale-body{animation:none}
  .dsh-soul-whale-sweep,.dsh-soul-whale-glow{animation:none;display:none}
  .dsh-soul-root>*,.dsh-soul-draft,.dsh-soul-profile-row-in,.dsh-soul-profile-new-row{animation:none}
  .dsh-soul-spin,.dsh-soul-check,.dsh-soul-btn-done{animation:none}
  .dsh-soul-skeleton-row{animation:none}
  .dsh-soul-state-dirty .dsh-soul-state-dot{animation:none}
  .dsh-soul-card-row-in,.dsh-soul-card-row-landed,.dsh-soul-preset-row-in,.dsh-soul-new-card,.dsh-soul-card-row-drop::before{animation:none}
  .dsh-soul-card-row-leaving{transform:none}
  .dsh-soul-btn,.dsh-soul-profile-row,.dsh-soul-notice,.dsh-soul-input,.dsh-soul-textarea,.dsh-soul-tab,.dsh-soul-switch,.dsh-soul-switch::after,
  .dsh-soul-card-row,.dsh-soul-card-row::after,.dsh-soul-card-editor,.dsh-soul-card-editor-inner,.dsh-soul-caret,
  .dsh-soul-card-grips,.dsh-soul-card-row-actions,.dsh-soul-state,
  .dsh-soul-preset-row,.dsh-soul-preset-actions,.dsh-soul-preset-form,.dsh-soul-preset-form-inner,.dsh-soul-kind-chip,.dsh-soul-card-kind{transition:none}
}
`

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureSoulStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  // 内容比对而非只按 id 判重：插件升级后已打开的页面里那份旧 <style> 会一直
  // 命中早退分支，JSX 拿到新 class 却匹配不到新规则（本仓踩过）。
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
