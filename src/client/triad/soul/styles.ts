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
  rootFill: 'dsh-soul-root-fill',
  scroll: 'dsh-soul-scroll',
  header: 'dsh-soul-header',
  brand: 'dsh-soul-brand',
  hero: 'dsh-soul-hero',
  headMain: 'dsh-soul-head-main',
  title: 'dsh-soul-title',
  desc: 'dsh-soul-desc',
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

  // ── 三区骨架（2026-10-06：上 1/3 预设 · 左下预览 · 右下修改） ──
  work: 'dsh-soul-work',
  presetsTop: 'dsh-soul-presets-top',
  stage: 'dsh-soul-stage',
  pane: 'dsh-soul-pane',
  panePreview: 'dsh-soul-pane-preview',
  paneEdit: 'dsh-soul-pane-edit',
  paneHead: 'dsh-soul-pane-head',
  paneTitle: 'dsh-soul-pane-title',
  paneHint: 'dsh-soul-pane-hint',

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
  presetNameText: 'dsh-soul-preset-name-text',
  presetDesc: 'dsh-soul-preset-desc',
  presetActions: 'dsh-soul-preset-actions',
  presetForm: 'dsh-soul-preset-form',
  presetFormOpen: 'dsh-soul-preset-form-open',
  presetFormInner: 'dsh-soul-preset-form-inner',

  // ── 修改列容器（整段正文 / 身份 / 档案 / 蒸馏，常驻展开） ──
  legacy: 'dsh-soul-legacy',

  // ── 角色卡形态（2026-10-07）：左列身份区 / 人格卡组 / 说明横幅 / 身份简介 ──
  persona: 'dsh-soul-persona',
  personaId: 'dsh-soul-persona-id',
  personaAvatar: 'dsh-soul-persona-avatar',
  personaAvatarImg: 'dsh-soul-persona-avatar-img',
  personaAvatarEmpty: 'dsh-soul-persona-avatar-empty',
  personaAvatarBusy: 'dsh-soul-persona-avatar-busy',
  personaAvatarEdit: 'dsh-soul-persona-avatar-edit',
  personaFields: 'dsh-soul-persona-fields',
  deck: 'dsh-soul-deck',
  deckHead: 'dsh-soul-deck-head',
  deckTitle: 'dsh-soul-deck-title',
  deckHint: 'dsh-soul-deck-hint',
  deckGrid: 'dsh-soul-deck-grid',
  deckCard: 'dsh-soul-deck-card',
  deckCardOn: 'dsh-soul-deck-card-on',
  deckCardBusy: 'dsh-soul-deck-card-busy',
  deckCardNew: 'dsh-soul-deck-card-new',
  deckFace: 'dsh-soul-deck-face',
  deckFaceImg: 'dsh-soul-deck-face-img',
  deckName: 'dsh-soul-deck-name',
  deckDesc: 'dsh-soul-deck-desc',
  deckTag: 'dsh-soul-deck-tag',
  deckDelete: 'dsh-soul-deck-delete',
  deckMeta: 'dsh-soul-deck-meta',
  banner: 'dsh-soul-banner',
  bannerMain: 'dsh-soul-banner-main',
  bannerName: 'dsh-soul-banner-name',
  bannerDesc: 'dsh-soul-banner-desc',
  bannerBg: 'dsh-soul-banner-bg',
  bannerEdit: 'dsh-soul-banner-edit',
  intro: 'dsh-soul-intro',
  introHead: 'dsh-soul-intro-head',
  introBody: 'dsh-soul-intro-body',
  advanced: 'dsh-soul-advanced',
  advancedOpen: 'dsh-soul-advanced-open',
  advancedHead: 'dsh-soul-advanced-head',
  advancedInner: 'dsh-soul-advanced-inner',
  advancedCaret: 'dsh-soul-advanced-caret',

  // ── 我的资料（用户侧身份块，2026-10-07） ──
  me: 'dsh-soul-me',
  meHead: 'dsh-soul-me-head',
  meAvatar: 'dsh-soul-me-avatar',
  meAvatarBusy: 'dsh-soul-me-avatar-busy',
  meBody: 'dsh-soul-me-body',
  meGrid: 'dsh-soul-me-grid',
  meActions: 'dsh-soul-me-actions',
  meVar: 'dsh-soul-me-var',

  // ── 2026-10-07 简明易懂 UI 新增类名 ──
  headTools: 'dsh-soul-head-tools',
  headInject: 'dsh-soul-head-inject',
  headInjectDot: 'dsh-soul-head-inject-dot',
  nav: 'dsh-soul-nav',
  navItem: 'dsh-soul-nav-item',
  navItemActive: 'dsh-soul-nav-item-active',
  paneView: 'dsh-soul-pane-view',
  heroCard: 'dsh-soul-hero-card',
  heroCardRow: 'dsh-soul-hero-card-row',
  heroCardAvatar: 'dsh-soul-hero-card-avatar',
  heroCardInfo: 'dsh-soul-hero-card-info',
  heroNameInput: 'dsh-soul-hero-name-input',
  heroMottoRow: 'dsh-soul-hero-motto-row',
  heroTag: 'dsh-soul-hero-tag',
  heroDesc: 'dsh-soul-hero-desc',
  heroActions: 'dsh-soul-hero-actions',
  sectionHead: 'dsh-soul-section-head',
  sectionTitle: 'dsh-soul-section-title',
  sectionDesc: 'dsh-soul-section-desc',
  quickGrid: 'dsh-soul-quick-grid',
  quickCard: 'dsh-soul-quick-card',
  quickHead: 'dsh-soul-quick-head',
  quickIcon: 'dsh-soul-quick-icon',
  quickName: 'dsh-soul-quick-name',
  quickDesc: 'dsh-soul-quick-desc',
  quickBtn: 'dsh-soul-quick-btn',
  chipsRow: 'dsh-soul-chips-row',
  chipBtn: 'dsh-soul-chip-btn',
  userTip: 'dsh-soul-user-tip',

  // ── 2026-10-07 简明可视化表单 ──
  modeToggle: 'dsh-soul-mode-toggle',
  modeBtn: 'dsh-soul-mode-btn',
  modeBtnActive: 'dsh-soul-mode-btn-active',
  visualGroup: 'dsh-soul-visual-group',
  visualHead: 'dsh-soul-visual-head',
  visualTitle: 'dsh-soul-visual-title',
  visualDesc: 'dsh-soul-visual-desc',
  ruleList: 'dsh-soul-rule-list',
  ruleItem: 'dsh-soul-rule-item',
  ruleNum: 'dsh-soul-rule-num',
  ruleText: 'dsh-soul-rule-text',
  ruleDel: 'dsh-soul-rule-del',
  ruleAddRow: 'dsh-soul-rule-add-row',
  ruleAddInput: 'dsh-soul-rule-add-input',
  ruleAddBtn: 'dsh-soul-rule-add-btn',
  ruleEmpty: 'dsh-soul-rule-empty',

  // ── 药丸灵感栏（Tab 1 紧凑分身与风格选择） ──
  pillBar: 'dsh-soul-pill-bar',
  pillLabel: 'dsh-soul-pill-label',
  pillList: 'dsh-soul-pill-list',
  pill: 'dsh-soul-pill',
  pillOn: 'dsh-soul-pill-on',
  pillNew: 'dsh-soul-pill-new',
  pillDel: 'dsh-soul-pill-del',
  pillAvatar: 'dsh-soul-pill-avatar',
  pillBusy: 'dsh-soul-pill-busy',
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
/* embedded（工作台整页）：父级 .wb-soul-scroll 是 flex 列，root 撑满高度，
   高度配额交给 .dsh-soul-work 的两行网格——「上 1/3」只有在这种定高语境里才成立。
   非 embedded（composer 浮层）仍是内容自适应 + 整页滚动。 */
.dsh-soul-root-fill{flex:1;min-height:0}
.dsh-soul-root-fill>.dsh-soul-work{flex:1;min-height:0}

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

/* ── 三区入场：上 → 左下 → 右下 依次落位（60ms 步进，与工作台 stagger 同节奏）──
   区域多了一层容器，root 的 nth-child 错峰此时只覆盖到 work 这一个子级，
   所以三区各自补一条。用 backwards 而非 both（both 会把 to 帧 transform 残留，
   让后代的 position:sticky / fixed 变成局部坐标）。 */
.dsh-soul-presets-top,.dsh-soul-pane{animation:dsh-soul-rise .26s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-presets-top{animation-delay:0ms}
.dsh-soul-pane-preview{animation-delay:60ms}
.dsh-soul-pane-edit{animation-delay:120ms}
/* 区头 sticky 时下面滚过的卡片会被它半透明底压住，加一条分隔线让层次清楚 */
.dsh-soul-pane-head::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--s-border);opacity:.7}

/* ── 头部：**一行**放下鲸鱼 + 标题 + 状态 ─────────────────────────────
   改版前是「鲸鱼独占一行 + 标题 + 两行说明 + 右侧四个胶囊」，头部 162px；
   现在 30px 鲸鱼与标题同行，说明压成单行省略（全文进 title），
   只有「有没有未保存改动」留成可见状态。 */
.dsh-soul-header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-soul-brand{flex:1;min-width:0;display:flex;align-items:center;gap:10px}
.dsh-soul-hero{flex:none;display:inline-flex;align-items:center;justify-content:center}
.dsh-soul-head-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}
.dsh-soul-title{display:inline-flex;align-items:center;gap:7px;font-size:14.5px;font-weight:650;line-height:21px;color:var(--s-text)}
.dsh-soul-title svg{color:var(--s-primary)}
.dsh-soul-desc{font-size:11.5px;line-height:16px;color:var(--s-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-head-tools{display:flex;align-items:center;gap:8px;flex-wrap:nowrap}
.dsh-soul-head-inject{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 7px;border-radius:999px;border:1px solid var(--s-border-2);background:var(--s-layer);font-size:11.5px;font-weight:500;color:var(--s-text-2);cursor:pointer;transition:border-color .18s ease,background .18s ease,color .18s ease}
.dsh-soul-head-inject:hover{border-color:color-mix(in srgb,var(--s-primary) 40%,transparent);color:var(--s-text)}
.dsh-soul-head-inject-dot{width:6px;height:6px;border-radius:50%;background:var(--s-ok);box-shadow:0 0 5px var(--s-ok);transition:background .2s ease,box-shadow .2s ease}
.dsh-soul-head-inject[data-off='1'] .dsh-soul-head-inject-dot{background:var(--s-text-3);box-shadow:none}

/* ── 顶部主分段导航：助手人设 / 关于我 / 进阶调优 ─────────────────── */
.dsh-soul-nav{display:flex;align-items:center;gap:4px;padding:3px;border-radius:11px;background:var(--s-soft);border:1px solid var(--s-border);box-sizing:border-box}
.dsh-soul-nav-item{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:none;border-radius:8px;background:transparent;color:var(--s-text-2);font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;transition:background .16s ease,color .16s ease,box-shadow .16s ease}
.dsh-soul-nav-item:hover{color:var(--s-text);background:color-mix(in srgb,var(--s-hover) 80%,transparent)}
.dsh-soul-nav-item-active,.dsh-soul-nav-item-active:hover{background:var(--s-layer);color:var(--s-primary);font-weight:600;box-shadow:0 1px 4px color-mix(in srgb,var(--s-text) 10%,transparent)}

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

/* ── 编辑列容器（整段正文 / 身份字段 / 档案 / 蒸馏） ─────────────────
   2026-10-06 二轮：外层那枚「整段正文 / 身份字段 / 档案 / 蒸馏」折叠按钮**删掉**了。
   用户原话「这个折叠去掉」——它是一枚纯标签（居中的一行字 + 收起箭头），
   点开之后里面才是真内容，等于让用户多点一次才看到「修改」区有什么；
   而它平时还占着右栏顶部一整行的视觉宽度。现在内容常驻，区头已经说明这里是
   「修改」，不再需要第二层名字。 */
.dsh-soul-legacy{display:flex;flex-direction:column;gap:10px}

/* ── 三区骨架：上 1/3 预设 · 左下预览 · 右下修改（2026-10-06 用户要求） ──
   为什么必须定高分区：用户要的「上面三分之一」是**高度比例**语义。继续整页滚动
   的话「三分之一」会退化成「第一块内容多高就是多高」——预设只有 4 行时占 200px，
   加一条自定义预设就变成四分之一，比例语义直接失效。所以 root 从「内容列」改成
   「撑满可用高度 + 纵向 flex」，work 两行网格里把上面那一格限定成 1/3，
   三区各自滚动。窄面板（容器查询）下比例语义不成立，回到整页滚动的堆叠形态。
   预设区在顶部是**横宽矮**的形状，所以预设列表改多列网格（原来一列纵向排，在
   三分之一高度里只能露出两行）。

   2026-10-06 二轮：行高用 fit-content(33%) 而不是写死的 1fr。
   写死 1fr 时预设内容只有 224px、格子却有 285px，预设卡片和下面两栏之间
   白白空出一条 60px 的带子（用户点名反馈「上面和左右侧布局中间不要留这么大空白」）。
   fit-content(33%) = 内容高度为准、最多吃到 1/3：预设少时不空、预设多了也不会
   顶穿比例。 */
.dsh-soul-work{flex:1;min-height:0;display:grid;grid-template-rows:fit-content(33%) minmax(0,1fr);gap:10px}
/* 预设区没内容（host 未更新）：整格塌掉，高度让给下面两栏 */
.dsh-soul-presets-top[data-empty]{display:none}
.dsh-soul-presets-top[data-empty]+.dsh-soul-stage{grid-row:1 / -1}
.dsh-soul-presets-top{min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px;overflow-y:auto;overflow-x:hidden}
.dsh-soul-stage{min-width:0;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:stretch}
.dsh-soul-pane{min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px;overflow-y:auto;overflow-x:hidden}
/* 卡片是内容自适应高度的块，不要被 flex 列拉成等高的空卡 */
.dsh-soul-pane>.dsh-soul-card,.dsh-soul-pane>.dsh-soul-legacy{flex:none}
/* 两栏的语义靠**底色差**表达（左预览 = 只读观感，右修改 = 可编辑面），
   而不是加标题文字或边框堆叠：用户反感注释性文字堆砌。 */
.dsh-soul-pane-preview{padding-right:2px}
.dsh-soul-pane-edit{padding-right:2px}

/* ── 区头：区名 + 段控 + 状态点（一行，粘在区顶） ───────────────────── */
.dsh-soul-pane-head{flex:none;position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 0 8px;background:color-mix(in srgb,var(--s-layer) 88%,transparent);backdrop-filter:blur(6px)}
.dsh-soul-pane-head::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--s-border);opacity:.7}
.dsh-soul-pane-title{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;line-height:20px;color:var(--s-text);white-space:nowrap}
.dsh-soul-pane-title svg{color:var(--s-primary)}
.dsh-soul-pane-hint{flex:1;min-width:0;font-size:11px;line-height:16px;color:var(--s-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-pane-head .dsh-soul-tabs{margin-left:auto}
.dsh-soul-pane-head .dsh-soul-state{margin-left:auto}
.dsh-soul-pane-head .dsh-soul-tabs+.dsh-soul-state{margin-left:0}

/* ── 折叠区内部（整段正文 / 身份字段 / 蒸馏） ─────────────────────────
   这一段现在活在右下「修改」栏里（半宽），原来写死的 300px 侧栏在这里放不下：
   主栏会被压到 ~120px，正文编辑器竖排成两个字一行。所以它固定单列堆叠。 */
.dsh-soul-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start}
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
/* 「全文」预览渲染的是**富文本**而不是裸 markdown 源码：用户看到的应该是
   「身份 / 名字：执行者」这样的排版结果，而不是 ## 身份 、- 名字：执行者
   这种带记号的原文（用户原话「预览没有正常的格式吗，非要做技术的才能看懂吗」）。
   样式取 --s-* 短名，与面板其余部分同源；行内强调与代码沿用记忆面板的比例。 */
.dsh-soul-md{font-size:13px;line-height:1.65;color:var(--s-text);word-break:break-word;animation:dsh-soul-rise .2s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-md>*:first-child{margin-top:0}
.dsh-soul-md>*:last-child{margin-bottom:0}
.dsh-soul-md__p{margin:0 0 8px}
.dsh-soul-md__h{margin:14px 0 7px;font-weight:650;line-height:1.4;color:var(--s-text)}
.dsh-soul-md__h:first-child{margin-top:0}
.dsh-soul-md__h[data-level='3']{font-size:14.5px}
.dsh-soul-md__h[data-level='4']{font-size:13.5px}
.dsh-soul-md__h[data-level='5'],.dsh-soul-md__h[data-level='6']{font-size:12.5px;color:var(--s-text-2)}
.dsh-soul-md__list{margin:0 0 8px;padding-left:20px}
.dsh-soul-md__list li{margin:2px 0}
.dsh-soul-md__quote{margin:0 0 8px;padding:2px 0 2px 10px;border-left:2px solid var(--s-border-2);color:var(--s-text-2)}
.dsh-soul-md__code{padding:1px 5px;border-radius:4px;background:var(--s-soft);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
.dsh-soul-md__pre{margin:0 0 8px;padding:10px 12px;border-radius:8px;overflow-x:auto;background:var(--s-soft);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6;white-space:pre}
.dsh-soul-md__pre code{background:none;padding:0}
.dsh-soul-md__hr{margin:12px 0;border:0;border-top:1px solid var(--s-border-2)}
.dsh-soul-md__link{color:var(--s-primary);text-decoration:none}
.dsh-soul-md__link:hover{text-decoration:underline}
/* 卡片 ⇄ 全文 切换时给全文一个落位淡入：切换本身没有别的视觉线索，
   完全没有动效会让人以为「点了没反应」（用户要求 UI 改动必须有可见动效）。 */
.dsh-soul-preview{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:21px;color:var(--s-text);animation:dsh-soul-rise .2s cubic-bezier(.2,.8,.2,1) backwards}
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
/* 正文摘要默认隐藏：行式宿主（composer 浮层）不重复正文；工作台磁贴形态由
   hub/theme.ts 在 .wb-root 里打开成两行截断（2026-10 深空改版）。 */
.dsh-soul-card-body-excerpt{display:none}
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
   说明文字也不再常驻，改为整行的 title 提示（信息没丢，只是不再抢视线）。
   2026-10-06：预设区搬到顶部三分之一高度，纵向排只能露出两行，改成多列网格
   （auto-fill 300px），窄到排不下两列时由容器查询回落单列。 */
.dsh-soul-preset-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:6px;align-content:start}
.dsh-soul-preset-row{display:flex;align-items:center;gap:9px;padding:7px 10px;border:1px solid var(--s-border-2);border-radius:10px;background:var(--s-layer);box-sizing:border-box;transition:border-color .18s ease,background .18s ease,transform .16s cubic-bezier(.2,.8,.2,1),box-shadow .18s ease}
.dsh-soul-preset-row:hover{border-color:color-mix(in srgb,var(--s-primary) 45%,transparent);transform:translateY(-1px);box-shadow:0 3px 12px color-mix(in srgb,var(--s-text) 7%,transparent)}
.dsh-soul-preset-row-in{animation:dsh-soul-row-in .22s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-preset-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:color-mix(in srgb,var(--s-text-3) 13%,transparent);color:var(--s-text-2)}
.dsh-soul-preset-icon-builtin{background:var(--s-primary-chip);color:var(--s-primary)}
.dsh-soul-preset-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-soul-preset-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;font-weight:600;line-height:19px;color:var(--s-text);flex-wrap:wrap}
/* 名字本体：单行省略，不参与折行（徽标/chip 才允许换到第二行） */
.dsh-soul-preset-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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

/* ══ 角色卡形态（2026-10-07）══════════════════════════════════════════
   参考稿的形态：左列「头像 + 名字 + Ta 的模型」，右上「人格卡组」（竖排卡片，
   选中那张描边与文字转强调色），右下「说明横幅」（带背景图的横条），
   最下面「身份简介」多行文本框。

   为什么保留成可折叠的「卡片与预设」而不是删掉旧的卡片区/预设区：
   参考稿只描述了**首页形态**，而逐张编辑注入内容、套用预设、蒸馏是真实功能。
   把它们降级进折叠区，首屏得到参考稿的样子，功能一个不少。

   选中色的取舍：参考稿是粉紫。直接用官方 business-primary（蓝）会丢掉「选中」
   与「主色按钮」的区分度——一屏里三处同色，眼睛找不到哪张卡在生效。所以从主色
   混一点粉得到一个**派生强调色**（--s-persona），主题切换自动跟随，不引入新色板。 */
.dsh-soul-root{--s-persona:color-mix(in srgb,var(--s-primary) 52%,#e879a8);
  --s-persona-soft:color-mix(in srgb,var(--s-persona) 14%,transparent);
  --s-persona-line:color-mix(in srgb,var(--s-persona) 58%,transparent)}

/* 左列 300px：要放下「名字」输入框与「Ta 的模型」那行模型名（DeepSeek V4 Flash
   这类名字在 200px 里会被省略号吃掉，用户看不到自己用的是什么模型）。 */
.dsh-soul-persona{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:16px;align-items:start;min-width:0}

/* ── 左列：头像 + 名字 + 模型 ───────────────────────────────────────
   参考稿是**头像在左、字段在右**的横排（不是头像压在上面）。 */
.dsh-soul-persona-id{display:flex;flex-direction:row;align-items:flex-start;gap:12px;min-width:0}
.dsh-soul-persona-avatar{position:relative;align-self:flex-start;width:72px;height:72px;border-radius:50%;box-sizing:border-box;border:2px solid var(--s-border-2);background:var(--s-soft);overflow:hidden;cursor:pointer;padding:0;transition:border-color .2s ease,transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .22s ease}
.dsh-soul-persona-avatar:hover{border-color:var(--s-persona-line);transform:translateY(-2px) scale(1.03);box-shadow:0 6px 20px color-mix(in srgb,var(--s-persona) 24%,transparent)}
.dsh-soul-persona-avatar:active{transform:scale(.98)}
.dsh-soul-persona-avatar-img{width:100%;height:100%;object-fit:cover;display:block;animation:dsh-soul-face-in .3s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes dsh-soul-face-in{from{opacity:0;transform:scale(1.06)}to{opacity:1;transform:none}}
/* 未上传：剪影占位（一眼看出「这里可以放一张脸」，而不是一个空洞） */
.dsh-soul-persona-avatar-empty{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--s-text-3);background:linear-gradient(160deg,color-mix(in srgb,var(--s-text-3) 16%,transparent),transparent)}
.dsh-soul-persona-avatar-edit{position:absolute;left:0;right:0;bottom:0;padding:3px 0;font-size:10px;line-height:14px;font-weight:600;text-align:center;color:#fff;background:color-mix(in srgb,var(--s-text) 62%,transparent);opacity:0;transform:translateY(100%);transition:opacity .2s ease,transform .22s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-persona-avatar:hover .dsh-soul-persona-avatar-edit{opacity:1;transform:none}
.dsh-soul-persona-avatar-busy{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--s-persona)}
.dsh-soul-persona-fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}

/* ── 右上：人格卡组 ───────────────────────────────────────────────── */
.dsh-soul-deck{display:flex;flex-direction:column;gap:9px;min-width:0}
.dsh-soul-deck-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-soul-deck-title{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;line-height:20px;color:var(--s-text)}
.dsh-soul-deck-title svg{color:var(--s-persona)}
.dsh-soul-deck-hint{flex:1;min-width:0;font-size:11px;line-height:16px;color:var(--s-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-deck-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:9px;align-content:start}
/* 卡片：上脸下字，底部标签。静止时是中性描边，hover 微浮，选中转强调色。 */
.dsh-soul-deck-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 9px 9px;box-sizing:border-box;border:1px solid var(--s-border-2);border-radius:12px;background:var(--s-layer);color:var(--s-text-2);font-family:inherit;text-align:center;cursor:pointer;transition:border-color .2s ease,background .2s ease,transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s ease}
.dsh-soul-deck-card:hover:not(:disabled){border-color:var(--s-persona-line);transform:translateY(-2px);box-shadow:0 6px 18px color-mix(in srgb,var(--s-text) 9%,transparent)}
.dsh-soul-deck-card:active:not(:disabled){transform:scale(.985)}
.dsh-soul-deck-card:disabled{cursor:default;opacity:.7}
.dsh-soul-deck-card-on,.dsh-soul-deck-card-on:hover{border-color:var(--s-persona);background:var(--s-persona-soft);color:var(--s-persona);box-shadow:0 0 0 1px var(--s-persona-line),0 8px 22px color-mix(in srgb,var(--s-persona) 20%,transparent)}
/* 选中卡片的一次性落位：切人格要有「确实切了」的反馈 */
.dsh-soul-deck-card-on{animation:dsh-soul-pick .34s cubic-bezier(.2,1.2,.4,1)}
@keyframes dsh-soul-pick{0%{transform:scale(.96)}55%{transform:scale(1.025)}100%{transform:none}}
.dsh-soul-deck-card-busy{pointer-events:none}
.dsh-soul-deck-card-busy::after{content:'';position:absolute;inset:0;border-radius:12px;background:color-mix(in srgb,var(--s-layer) 62%,transparent);animation:dsh-soul-pulse 1.1s ease-in-out infinite}
.dsh-soul-deck-face{flex:none;display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;overflow:hidden;background:var(--s-soft);color:var(--s-text-3);box-sizing:border-box;border:1.5px solid var(--s-border-2);transition:border-color .2s ease,transform .22s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-deck-card-on .dsh-soul-deck-face{border-color:var(--s-persona-line)}
.dsh-soul-deck-card:hover .dsh-soul-deck-face{transform:scale(1.05)}
.dsh-soul-deck-face-img{width:100%;height:100%;object-fit:cover;display:block}
.dsh-soul-deck-name{max-width:100%;font-size:13px;font-weight:600;line-height:19px;color:var(--s-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-deck-card-on .dsh-soul-deck-name{color:var(--s-persona)}
.dsh-soul-deck-desc{max-width:100%;font-size:11.5px;line-height:17px;color:var(--s-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-deck-card-on .dsh-soul-deck-desc{color:var(--s-persona)}
.dsh-soul-deck-tag{max-width:100%;padding:1px 7px;border:1px solid var(--s-border-2);border-radius:5px;font-size:10.5px;line-height:15px;color:var(--s-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-deck-card-on .dsh-soul-deck-tag{border-color:var(--s-persona-line);color:var(--s-persona)}
.dsh-soul-deck-delete{position:absolute;top:4px;right:4px;width:20px;height:20px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--s-text-3);font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .18s ease,background .18s ease,color .18s ease}
.dsh-soul-deck-card:hover .dsh-soul-deck-delete{opacity:1}
.dsh-soul-deck-delete:hover{background:var(--s-err-bg);color:var(--s-err)}
/* 新建卡：虚线描边，与真实人格卡区分开（它是动作不是人格） */
.dsh-soul-deck-card-new{border-style:dashed;color:var(--s-text-3);justify-content:center;gap:5px;min-height:132px}
.dsh-soul-deck-card-new:hover{border-color:var(--s-persona);color:var(--s-persona)}
.dsh-soul-deck-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--s-text-3)}

/* ── 右下：说明横幅（选中人格的一句话定位） ─────────────────────────
   参考稿那条横条带月夜背景图。这里用**纯 CSS 画**（径向渐变当月亮 + 暗蓝底），
   不引外部图片：卡片是离线环境也要能看的，外链图一律白板。
   背景只在有选中人格且写了定位时出现——没内容时不铺一块装饰性空图。 */
.dsh-soul-banner{position:relative;display:flex;align-items:center;gap:10px;min-height:56px;padding:12px 14px;box-sizing:border-box;border:1px solid var(--s-border-2);border-radius:12px;overflow:hidden;background:var(--s-layer)}
.dsh-soul-banner-bg{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .4s ease;background:
  radial-gradient(48px 48px at 74% 26%,color-mix(in srgb,#f4ead2 62%,transparent),transparent 70%),
  radial-gradient(120% 160% at 78% -30%,color-mix(in srgb,#3b5a86 55%,transparent),transparent 62%),
  linear-gradient(105deg,#16233a,#1d2c46 45%,#101a2c)}
.dsh-soul-banner[data-art] .dsh-soul-banner-bg{opacity:.92}
/* 树枝剪影：纯 CSS 的斜向细线，不引 SVG 也不引图 */
.dsh-soul-banner[data-art]::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:
    linear-gradient(78deg,transparent 62%,#0b1220 62.6%,transparent 63.6%),
    linear-gradient(102deg,transparent 74%,#0b1220 74.6%,transparent 75.6%),
    linear-gradient(66deg,transparent 84%,#0b1220 84.5%,transparent 85.4%)}
.dsh-soul-banner-main{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-soul-banner-name{font-size:15px;font-weight:650;line-height:22px;color:var(--s-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-banner-desc{font-size:12px;line-height:18px;color:var(--s-text-2);word-break:break-word}
.dsh-soul-banner[data-art] .dsh-soul-banner-name{color:#f6f1e6}
.dsh-soul-banner[data-art] .dsh-soul-banner-desc{color:color-mix(in srgb,#e8e2d6 82%,transparent)}
/* 横幅换人时的落位：内容整体淡入 + 轻微上移 */
.dsh-soul-banner-main{animation:dsh-soul-banner-in .3s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes dsh-soul-banner-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.dsh-soul-banner-edit{position:relative;flex:none}
/* 横幅右上那枚「一句话定位」按钮：静止时压到 40% 透明度、横幅 hover 才提满。
   它常驻会跟横幅正文抢视线，而横幅是**读**的地方，不是操作区。 */
.dsh-soul-banner .dsh-soul-banner-edit{opacity:.4;transition:opacity .2s ease}
.dsh-soul-banner:hover .dsh-soul-banner-edit{opacity:1}

/* ── 我的资料（用户侧身份块） ───────────────────────────────────────
   与「Ta」那一列同规格的横排（圆形头像 + 字段），刻意**不复用** .dsh-soul-persona-id：
   那块是「当前人格」，会随卡片切换重渲染并带动画；这块是用户自己，切换人格时
   不该有任何视觉动静（否则每次切人格都闪一下自己的资料，读起来像被改了）。

   视觉上用一个弱外框把它与人格区分开：它的主体是「你」，不是「Ta」。 */
.dsh-soul-me{display:flex;flex-direction:column;gap:9px;padding:12px;box-sizing:border-box;border:1px solid var(--s-border);border-radius:12px;background:var(--s-soft);min-width:0}
.dsh-soul-me-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dsh-soul-me-head .dsh-soul-deck-title svg{color:var(--s-text-2)}
.dsh-soul-me-avatar{position:relative;flex:none;width:56px;height:56px;border-radius:50%;box-sizing:border-box;border:2px solid var(--s-border-2);background:var(--s-layer);overflow:hidden;cursor:pointer;padding:0;transition:border-color .2s ease,transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .22s ease}
.dsh-soul-me-avatar:hover{border-color:color-mix(in srgb,var(--s-text-2) 55%,transparent);transform:translateY(-2px) scale(1.03);box-shadow:0 6px 18px color-mix(in srgb,var(--s-text) 12%,transparent)}
.dsh-soul-me-avatar:active{transform:scale(.98)}
.dsh-soul-me-avatar-busy{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--s-text-2)}
.dsh-soul-me-body{display:flex;flex-direction:row;align-items:flex-start;gap:12px;min-width:0}
.dsh-soul-me-grid{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}
.dsh-soul-me .dsh-soul-textarea{min-height:76px}
.dsh-soul-me-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* 变量提示：等宽字体 + 弱底色，一眼看出「这是要写进正文的记号」而不是装饰文字 */
.dsh-soul-me-var{display:inline-flex;align-items:center;gap:5px;padding:1px 7px;border-radius:5px;background:var(--s-primary-chip);color:var(--s-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:17px}

/* ── 2026-10-07 简明易懂 UI：分标签主视口 ─────────────────────────── */
.dsh-soul-pane-view{display:flex;flex-direction:column;gap:13px;animation:dsh-soul-rise .22s cubic-bezier(.2,.8,.2,1) backwards}
.dsh-soul-pane-view[hidden]{display:none !important}

/* ── 助手角色名片卡（Hero Card） ──────────────────────────────────── */
.dsh-soul-hero-card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:14px;border:1px solid color-mix(in srgb,var(--s-primary) 24%,var(--s-border-2));background:linear-gradient(145deg,var(--s-layer) 0%,color-mix(in srgb,var(--s-primary) 5%,var(--s-layer)) 100%);box-shadow:0 3px 16px color-mix(in srgb,var(--s-text) 3%,transparent);box-sizing:border-box}
.dsh-soul-hero-card-row{display:flex;align-items:center;gap:14px;min-width:0;flex-wrap:wrap}
.dsh-soul-hero-card-avatar{position:relative;flex:none;width:64px;height:64px;border-radius:50%;border:2px solid color-mix(in srgb,var(--s-primary) 35%,var(--s-border-2));background:var(--s-soft);overflow:hidden;cursor:pointer;padding:0;box-sizing:border-box;box-shadow:0 3px 12px color-mix(in srgb,var(--s-primary) 16%,transparent);transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
.dsh-soul-hero-card-avatar:hover{transform:scale(1.04);border-color:var(--s-primary);box-shadow:0 5px 18px color-mix(in srgb,var(--s-primary) 28%,transparent)}
.dsh-soul-hero-card-info{flex:1;min-width:160px;display:flex;flex-direction:column;gap:4px}
.dsh-soul-hero-name-input{box-sizing:border-box;height:34px;font-size:15px;font-weight:650;color:var(--s-text);background:transparent;border:1px solid transparent;border-radius:7px;padding:0 8px;margin-left:-8px;max-width:240px;transition:border-color .16s ease,background .16s ease}
.dsh-soul-hero-name-input:hover{border-color:var(--s-border-2);background:var(--s-layer)}
.dsh-soul-hero-name-input:focus{border-color:var(--s-primary);background:var(--s-layer);outline:none;box-shadow:0 0 0 2px var(--s-primary-soft)}
.dsh-soul-hero-motto-row{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--s-text-2);flex-wrap:wrap}
.dsh-soul-hero-tag{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:5px;background:var(--s-primary-chip);color:var(--s-primary);font-size:11px;font-weight:600;line-height:16px;border:1px solid color-mix(in srgb,var(--s-primary) 22%,transparent)}
.dsh-soul-hero-desc{color:var(--s-text-2);cursor:pointer;padding:2px 6px;border-radius:6px;transition:background .16s ease,color .16s ease}
.dsh-soul-hero-desc:hover{background:var(--s-hover);color:var(--s-text)}
.dsh-soul-hero-actions{display:flex;align-items:center;gap:8px;margin-left:auto}

/* ── 优雅段落头 ───────────────────────────────────────────────────── */
.dsh-soul-section-head{display:flex;flex-direction:column;gap:2px}
.dsh-soul-section-title{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:650;line-height:19px;color:var(--s-text)}
.dsh-soul-section-title svg{color:var(--s-primary)}
.dsh-soul-section-desc{font-size:11.5px;line-height:16px;color:var(--s-text-3)}

/* ── 推荐预设网格（Tab 1 快速套用） ────────────────────────────────── */
.dsh-soul-quick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:9px}
.dsh-soul-quick-card{display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:11px;border:1px solid var(--s-border-2);background:var(--s-layer);box-sizing:border-box;transition:border-color .18s ease,transform .16s ease,box-shadow .18s ease}
.dsh-soul-quick-card:hover{border-color:color-mix(in srgb,var(--s-primary) 42%,transparent);transform:translateY(-2px);box-shadow:0 4px 14px color-mix(in srgb,var(--s-text) 7%,transparent)}
.dsh-soul-quick-head{display:flex;align-items:center;gap:7px;min-width:0}
.dsh-soul-quick-icon{flex:none;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--s-primary-chip);color:var(--s-primary)}
.dsh-soul-quick-name{flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--s-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-soul-quick-desc{font-size:11px;line-height:16px;color:var(--s-text-3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:32px}
.dsh-soul-quick-btn{width:100%;height:26px;font-size:11.5px;border-radius:7px}

/* ── 灵感胶囊行 ───────────────────────────────────────────────────── */
.dsh-soul-chips-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0}
.dsh-soul-chip-btn{display:inline-flex;align-items:center;gap:3px;height:25px;padding:0 9px;border-radius:7px;border:1px solid var(--s-border-2);background:var(--s-layer);color:var(--s-text-2);font-size:11px;font-family:inherit;cursor:pointer;transition:border-color .15s ease,background .15s ease,color .15s ease,transform .1s ease}
.dsh-soul-chip-btn:hover{border-color:var(--s-primary);color:var(--s-primary);background:var(--s-primary-soft);transform:scale(1.02)}
.dsh-soul-chip-btn:active{transform:scale(.97)}

/* ── 药丸灵感栏（Tab 1 紧凑分身与风格选择） ── */
.dsh-soul-pill-bar{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap;padding:3px 0}
.dsh-soul-pill-label{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--s-text-2);flex:none}
.dsh-soul-pill-list{display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:1;min-width:0}
.dsh-soul-pill{position:relative;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:14px;border:1px solid var(--s-border-2);background:var(--s-layer);color:var(--s-text-2);font-size:12px;font-family:inherit;cursor:pointer;transition:border-color .15s ease,background .15s ease,color .15s ease,transform .1s ease}
.dsh-soul-pill:hover{border-color:var(--s-primary);color:var(--s-text);background:var(--s-hover);transform:translateY(-1px)}
.dsh-soul-pill:active{transform:scale(.98)}
.dsh-soul-pill-on,.dsh-soul-pill-on:hover{border-color:var(--s-primary);background:var(--s-primary-chip);color:var(--s-primary);font-weight:600;box-shadow:0 0 0 1px color-mix(in srgb,var(--s-primary) 35%,transparent)}
.dsh-soul-pill-new{border-style:dashed;color:var(--s-text-3)}
.dsh-soul-pill-new:hover{border-color:var(--s-primary);color:var(--s-primary)}
.dsh-soul-pill-del{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:transparent;color:var(--s-text-3);font-size:12px;line-height:1;margin-left:2px;cursor:pointer;transition:all .15s ease}
.dsh-soul-pill-del:hover{background:var(--s-err-bg);color:var(--s-err)}
.dsh-soul-pill-avatar{width:16px;height:16px;border-radius:50%;object-fit:cover;flex:none}
.dsh-soul-pill-busy{pointer-events:none;opacity:.7}

/* ── 友好引导条 ───────────────────────────────────────────────────── */
.dsh-soul-user-tip{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:9px;background:color-mix(in srgb,var(--s-primary) 7%,var(--s-layer));border:1px solid color-mix(in srgb,var(--s-primary) 18%,transparent);color:var(--s-text-2);font-size:11.5px;line-height:18px}

/* ── 2026-10-07 可视化表单与模式切换 ───────────────────────────────── */
.dsh-soul-mode-toggle{display:inline-flex;align-items:center;background:var(--s-soft);padding:2px;border-radius:8px;border:1px solid var(--s-border);gap:2px}
.dsh-soul-mode-btn{border:none;background:transparent;color:var(--s-text-3);font-family:inherit;font-size:11px;font-weight:500;padding:3px 9px;border-radius:6px;cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;gap:4px;line-height:16px}
.dsh-soul-mode-btn:hover{color:var(--s-text)}
.dsh-soul-mode-btn-active{background:var(--s-layer);color:var(--s-primary);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--s-text) 10%,transparent)}
.dsh-soul-visual-group{display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:color-mix(in srgb,var(--s-soft) 40%,var(--s-layer));border:1px solid var(--s-border-2);border-radius:11px;transition:border-color .16s ease}
.dsh-soul-visual-group:focus-within{border-color:color-mix(in srgb,var(--s-primary) 40%,transparent)}
.dsh-soul-visual-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dsh-soul-visual-title{font-size:12.5px;font-weight:650;color:var(--s-text);display:inline-flex;align-items:center;gap:6px}
.dsh-soul-visual-desc{font-size:11px;color:var(--s-text-3)}
.dsh-soul-rule-list{display:flex;flex-direction:column;gap:6px;margin:2px 0}
.dsh-soul-rule-item{display:flex;align-items:center;gap:8px;padding:7px 11px;background:var(--s-layer);border:1px solid var(--s-border-2);border-radius:8px;font-size:12px;color:var(--s-text);transition:border-color .15s ease,box-shadow .15s ease}
.dsh-soul-rule-item:hover{border-color:color-mix(in srgb,var(--s-primary) 35%,transparent);box-shadow:0 2px 8px color-mix(in srgb,var(--s-text) 4%,transparent)}
.dsh-soul-rule-num{flex:none;font-size:10.5px;font-weight:700;color:var(--s-primary);background:var(--s-primary-chip);padding:1px 6px;border-radius:999px;min-width:14px;text-align:center}
.dsh-soul-rule-text{flex:1;min-width:0;line-height:1.45;word-break:break-word}
.dsh-soul-rule-del{flex:none;border:none;background:transparent;color:var(--s-text-3);font-size:12px;cursor:pointer;padding:3px 6px;border-radius:5px;line-height:1;transition:all .14s ease}
.dsh-soul-rule-del:hover{color:var(--s-err);background:var(--s-err-bg)}
.dsh-soul-rule-add-row{display:flex;gap:7px;align-items:center;margin-top:2px}
.dsh-soul-rule-add-input{flex:1;min-width:0;font-size:12px}
.dsh-soul-rule-add-btn{flex:none;height:32px;font-size:11.5px;padding:0 12px;border-radius:8px}
.dsh-soul-rule-empty{padding:14px 10px;text-align:center;font-size:11.5px;color:var(--s-text-3);border:1px dashed var(--s-border-2);border-radius:8px;background:transparent}

/* ── 身份简介（注入正文） ─────────────────────────────────────────── */
.dsh-soul-intro{display:flex;flex-direction:column;gap:8px}
.dsh-soul-intro-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-soul-intro-body{display:flex;flex-direction:column;gap:6px}
.dsh-soul-intro-body .dsh-soul-textarea{min-height:104px}

/* ── 「卡片与预设」折叠区（旧三区整体收进这里） ───────────────────── */
.dsh-soul-advanced{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .26s cubic-bezier(.2,.8,.2,1),opacity .22s ease}
.dsh-soul-advanced-open{grid-template-rows:1fr;opacity:1}
.dsh-soul-advanced-inner{overflow:hidden;min-height:0;visibility:hidden;transition:visibility 0s linear .26s}
.dsh-soul-advanced-open .dsh-soul-advanced-inner{visibility:visible;transition:visibility 0s}
.dsh-soul-advanced-head{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;box-sizing:border-box;border:1px solid var(--s-border-2);border-radius:10px;background:var(--s-layer);color:var(--s-text-2);font-family:inherit;font-size:12.5px;font-weight:500;line-height:19px;cursor:pointer;text-align:left;transition:border-color .18s ease,color .18s ease,background .18s ease}
.dsh-soul-advanced-head:hover{border-color:color-mix(in srgb,var(--s-primary) 42%,transparent);color:var(--s-text)}
.dsh-soul-advanced-caret{flex:none;display:inline-flex;transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.dsh-soul-advanced-open .dsh-soul-advanced-caret{transform:rotate(90deg)}


.dsh-soul-tab:focus-visible,.dsh-soul-btn:focus-visible,.dsh-soul-input:focus-visible,
.dsh-soul-textarea:focus-visible,.dsh-soul-switch:focus-visible,
.dsh-soul-card-row-main:focus-visible,.dsh-soul-kind-chip:focus-visible,
.dsh-soul-deck-card:focus-visible,.dsh-soul-persona-avatar:focus-visible,
.dsh-soul-advanced-head:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--s-primary) 35%,transparent)}

/* ── 角色卡形态的窄面板降级 ─────────────────────────────────────────
   左列 240px + 右栏是参考稿的并排形态；面板窄到 720px 时并排会把右栏压成
   一条缝（人格卡最小 132px 一列都排不下），改成上下堆叠、左列横向排。 */
@container soulpanel (max-width: 720px){
  .dsh-soul-persona{grid-template-columns:minmax(0,1fr)}
  .dsh-soul-deck-grid{grid-template-columns:repeat(auto-fill,minmax(112px,1fr))}
}

/* ── 窄面板：右下「修改」落到左下「预览」下面 ─────────────────────────
   看的是**面板自身**宽度（container-type 在 .dsh-soul-root 上），
   所以并排布局的 485px 左半页也会正确折叠成单列。 */
@container soulpanel (max-width: 820px){
  .dsh-soul-stage{grid-template-columns:minmax(0,1fr)}
  .dsh-soul-diff{flex-direction:column}
  .dsh-soul-diff-divider{width:auto;height:1px}
}
/* 三区比例只在宽面板下成立：窄于 900px 时上下比例会把两栏压成两条缝，
   改为「三区纵向堆叠 + 父级整页滚动」的形态（比例语义此时无意义）。
   注意这里**不能**写 .dsh-soul-root-fill 自己的 display/overflow——CSS 容器查询
   只匹配容器的后代，容器自身（.dsh-soul-root 就是那个 container）永远不会命中，
   写了是死规则。root 在窄面板下仍高 1940 > 视口 971，滚动由父级 .wb-soul-scroll
   的 overflow-y:auto 承担（实测 client 971 / scroll 1940，可滚）。 */
@container soulpanel (max-width: 900px){
  .dsh-soul-work{display:flex;flex-direction:column;gap:14px;min-height:0}
  .dsh-soul-presets-top,.dsh-soul-pane{overflow:visible;min-height:0}
}
/* ── 右栏（预设）在半宽下的降级 ──────────────────────────────────────
   预设区现在横宽铺满顶部：4~6 条预设排成多列网格，比原来一列纵向排省一半高度。
   窄到排不下两列时回到单列（每行「名称 + 内置徽标 + N 张卡 + 两个按钮」挤不下，
   徽标会被 flex-wrap 顶到第二行，一行从 42px 涨到 66px）。 */
@container soulpanel (max-width: 1180px){
  .dsh-soul-preset-list{grid-template-columns:minmax(0,1fr)}
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
  .dsh-soul-stage{grid-template-columns:minmax(0,1fr)}
  .dsh-soul-diff{flex-direction:column}
  .dsh-soul-diff-divider{width:auto;height:1px}
}
/* 媒体查询兜底同样覆盖三区比例（老 WebView 无容器查询时按视口回落堆叠） */
@media (max-width: 1180px){
  .dsh-soul-root-fill{display:block;overflow-y:auto}
  .dsh-soul-work{display:flex;flex-direction:column}
  .dsh-soul-presets-top,.dsh-soul-pane{overflow:visible}
  .dsh-soul-preset-list{grid-template-columns:minmax(0,1fr)}
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
  .dsh-soul-presets-top,.dsh-soul-pane,.dsh-soul-preview{animation:none}
  .dsh-soul-spin,.dsh-soul-check,.dsh-soul-btn-done{animation:none}
  .dsh-soul-skeleton-row{animation:none}
  .dsh-soul-state-dirty .dsh-soul-state-dot{animation:none}
  .dsh-soul-card-row-in,.dsh-soul-card-row-landed,.dsh-soul-preset-row-in,.dsh-soul-new-card,.dsh-soul-card-row-drop::before{animation:none}
  .dsh-soul-deck-card-on,.dsh-soul-deck-card-busy::after,.dsh-soul-persona-avatar-img,.dsh-soul-banner-main{animation:none}
  .dsh-soul-card-row-leaving{transform:none}
  .dsh-soul-btn,.dsh-soul-profile-row,.dsh-soul-notice,.dsh-soul-input,.dsh-soul-textarea,.dsh-soul-tab,.dsh-soul-switch,.dsh-soul-switch::after,
  .dsh-soul-card-row,.dsh-soul-card-row::after,.dsh-soul-card-editor,.dsh-soul-card-editor-inner,.dsh-soul-caret,
  .dsh-soul-card-grips,.dsh-soul-card-row-actions,.dsh-soul-state,
  .dsh-soul-preset-row,.dsh-soul-preset-actions,.dsh-soul-preset-form,.dsh-soul-preset-form-inner,.dsh-soul-kind-chip,.dsh-soul-card-kind,
  .dsh-soul-deck-card,.dsh-soul-deck-face,.dsh-soul-deck-delete,.dsh-soul-persona-avatar,.dsh-soul-persona-avatar-edit,
  .dsh-soul-banner-bg,.dsh-soul-advanced,.dsh-soul-advanced-inner,.dsh-soul-advanced-head,.dsh-soul-advanced-caret,
  .dsh-soul-nav-item,.dsh-soul-quick-card,.dsh-soul-chip-btn,.dsh-soul-hero-card-avatar,.dsh-soul-me-avatar,
  .dsh-soul-mode-btn,.dsh-soul-rule-item,.dsh-soul-rule-del{transition:none}
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
