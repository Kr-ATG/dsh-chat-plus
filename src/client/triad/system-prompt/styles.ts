/**
 * dsh-chat-plus — 「系统提示词」页样式（运行时注入 style 标签，幂等）。
 *
 * ── 视觉取向 ────────────────────────────────────────────────────────
 * 这一页是**只读的调试视图**，不是仪表盘：用户来这里只想知道「模型收到了什么」。
 * 所以没有强调色、没有图表、没有装饰性动效 —— 只有排版层级（段名 / 正文）、
 * 一条发丝线、以及能一眼扫完的规模数字。文字色一律走 --dsw-alias-* token，
 * 深浅主题自动跟随；正文用等宽字体，因为提示词里的缩进与符号本身就是信息。
 *
 * ⚠ 本文件的整张样式表是一个模板字面量：**注释里绝对不能出现反引号**，
 * 否则模板提前闭合、构建报一个与根因无关的错（build.mjs 有源码级守卫）。
 */

/** 类名表（组件侧统一从这里取，避免字符串散落两处各写一遍）。 */
export const css = {
  root: 'dsh-sp',
  head: 'dsh-sp-head',
  headMain: 'dsh-sp-head-main',
  eyebrow: 'dsh-sp-eyebrow',
  title: 'dsh-sp-title',
  hint: 'dsh-sp-hint',
  headActions: 'dsh-sp-head-actions',
  tabs: 'dsh-sp-tabs',
  tab: 'dsh-sp-tab',
  tabsTail: 'dsh-sp-tabs-tail',
  select: 'dsh-sp-select',
  btn: 'dsh-sp-btn',
  btnGhost: 'dsh-sp-btn-ghost',
  btnOn: 'dsh-sp-btn-on',
  scroll: 'dsh-sp-scroll',
  notice: 'dsh-sp-notice',
  noticeText: 'dsh-sp-notice-text',
  stats: 'dsh-sp-stats',
  stat: 'dsh-sp-stat',
  statLabel: 'dsh-sp-stat-label',
  statValue: 'dsh-sp-stat-value',
  meta: 'dsh-sp-meta',
  metaRow: 'dsh-sp-meta-row',
  metaKey: 'dsh-sp-meta-key',
  metaValue: 'dsh-sp-meta-value',
  badge: 'dsh-sp-badge',
  badgeLive: 'dsh-sp-badge-live',
  full: 'dsh-sp-full',
  fullHead: 'dsh-sp-full-head',
  fullLabel: 'dsh-sp-full-label',
  fullHint: 'dsh-sp-full-hint',
  fullBody: 'dsh-sp-full-body',
  groups: 'dsh-sp-groups',
  group: 'dsh-sp-group',
  groupHead: 'dsh-sp-group-head',
  groupCaret: 'dsh-sp-group-caret',
  groupLabel: 'dsh-sp-group-label',
  groupCount: 'dsh-sp-group-count',
  groupChars: 'dsh-sp-group-chars',
  groupDesc: 'dsh-sp-group-desc',
  section: 'dsh-sp-sec',
  sectionHead: 'dsh-sp-sec-head',
  sectionCaret: 'dsh-sp-sec-caret',
  sectionName: 'dsh-sp-sec-name',
  sectionLabel: 'dsh-sp-sec-label',
  sectionChars: 'dsh-sp-sec-chars',
  sectionCopy: 'dsh-sp-sec-copy',
  sectionBody: 'dsh-sp-sec-body',
  sectionWarn: 'dsh-sp-sec-warn',
  body: 'dsh-sp-body',
  empty: 'dsh-sp-empty',
  emptyIcon: 'dsh-sp-empty-icon',
  emptyText: 'dsh-sp-empty-text',
  emptyHint: 'dsh-sp-empty-hint',
  skeleton: 'dsh-sp-skeleton',
  error: 'dsh-sp-error',
  errorText: 'dsh-sp-error-text',
  errorRetry: 'dsh-sp-error-retry',
  tools: 'dsh-sp-tools',
  toolName: 'dsh-sp-tool-name',
  divider: 'dsh-sp-divider',
} as const

const STYLE_ID = 'dsh-system-prompt-styles'

const SHEET = [
  /* ── 页面骨架：铺满工作台 main 槽位（与其它分类页同形） ── */
  '.dsh-sp{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;width:100%;box-sizing:border-box;',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);font-family:inherit;overflow:hidden}',

  /* ── 页头：eyebrow + 标题 + 一句定位 + 右侧动作 ── */
  '.dsh-sp-head{display:flex;align-items:flex-end;gap:16px;flex:none;flex-wrap:wrap;',
  '  padding:18px 22px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
  '.dsh-sp-head-main{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 320px}',
  '.dsh-sp-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:15px;',
  '  letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#888);user-select:none}',
  '.dsh-sp-eyebrow i{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.6}',
  '.dsh-sp-title{margin:0;font-size:22px;line-height:30px;font-weight:650;letter-spacing:-.01em}',
  '.dsh-sp-title em{font-style:normal;font-weight:400;font-size:14px;color:var(--dsw-alias-label-tertiary,#888)}',
  '.dsh-sp-hint{margin:0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-tertiary,#8b8b8b);max-width:76ch}',
  '.dsh-sp-head-actions{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap}',

  /* ── 控件：下拉与按钮（中性灰阶，不引入第二个强调色） ── */
  '.dsh-sp-select{height:30px;max-width:240px;box-sizing:border-box;padding:0 26px 0 10px;border-radius:8px;',
  '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));background:transparent;',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);font-family:inherit;font-size:12.5px;line-height:28px;',
  '  cursor:pointer;appearance:none;-webkit-appearance:none;',
  '  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);',
  '  background-position:calc(100% - 14px) 13px,calc(100% - 9px) 13px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}',
  '.dsh-sp-select:hover{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.36))}',
  '.dsh-sp-select:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:1px}',
  '.dsh-sp-btn{display:inline-flex;align-items:center;gap:6px;height:30px;box-sizing:border-box;',
  '  padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));',
  '  background:transparent;color:var(--dsw-alias-label-secondary,#b9b9b9);font-family:inherit;font-size:12.5px;',
  '  line-height:28px;cursor:pointer;white-space:nowrap;transition:background 120ms ease,color 120ms ease,border-color 120ms ease}',
  '.dsh-sp-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.36))}',
  '.dsh-sp-btn:active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
  '.dsh-sp-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:1px}',
  '.dsh-sp-btn[disabled]{opacity:.5;cursor:default}',
  '.dsh-sp-btn-on{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));',
  '  color:var(--dsw-alias-label-primary,#e8e8e8)}',

  /* ── 滚动区 ── */
  '.dsh-sp-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;',
  '  padding:16px 22px 40px;scrollbar-width:thin;display:flex;flex-direction:column;gap:14px}',
  '.dsh-sp-scroll::-webkit-scrollbar{width:8px}',
  '.dsh-sp-scroll::-webkit-scrollbar-thumb{background:transparent;border-radius:4px}',
  '.dsh-sp-scroll:hover::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(127,127,127,.3))}',

  /* ── 提示条（没取到 / 降级说明）：只有一条发丝线，不做成黄色警告块 ── */
  '.dsh-sp-notice{display:flex;align-items:flex-start;gap:10px;flex:none;padding:10px 12px;border-radius:10px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));',
  '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05))}',
  '.dsh-sp-notice-text{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary,#b0b0b0);min-width:0}',

  /* ── 规模数字：一排等宽数字，标签在上值在下 ── */
  '.dsh-sp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:1px;flex:none;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));border-radius:12px;overflow:hidden;',
  '  background:var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
  '.dsh-sp-stat{display:flex;flex-direction:column;gap:3px;padding:11px 13px;',
  '  background:var(--dsw-alias-bg-base,#16181d)}',
  '.dsh-sp-stat-label{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b8b8b);user-select:none}',
  '.dsh-sp-stat-value{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  font-size:15px;line-height:21px;font-weight:640;color:var(--dsw-alias-label-primary,#e8e8e8);',
  '  font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ── 元信息行（工作目录 / 抓取时间 / 来源） ── */
  '.dsh-sp-meta{display:flex;flex-wrap:wrap;gap:6px 18px;flex:none;font-size:12px;line-height:18px;',
  '  color:var(--dsw-alias-label-tertiary,#8b8b8b)}',
  '.dsh-sp-meta-row{display:inline-flex;align-items:baseline;gap:6px;min-width:0;max-width:100%}',
  '.dsh-sp-meta-key{flex:none;user-select:none}',
  '.dsh-sp-meta-value{color:var(--dsw-alias-label-secondary,#b0b0b0);overflow:hidden;text-overflow:ellipsis;',
  '  white-space:nowrap;max-width:52ch}',
  '.dsh-sp-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;',
  '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));font-size:11px;line-height:17px;',
  '  color:var(--dsw-alias-label-secondary,#b0b0b0);user-select:none}',
  '.dsh-sp-badge-live{border-style:dashed}',

  /* ── tab 切换行（全文 / 详细）：与官方页内分段条同一套几何 ──
     下沿一条发丝线把它与内容分开；选中态是中性灰底 + 主文字色，不引入强调色
     （工作台换肤层会把业务色统一成灰阶，这里自己就别再上一遍）。 */
  '.dsh-sp-tabs{display:flex;align-items:center;gap:2px;flex:none;padding:8px 22px 0;',
  '  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
  '.dsh-sp-tab{position:relative;height:30px;box-sizing:border-box;padding:0 12px;border:none;',
  '  border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b8b);',
  '  font-family:inherit;font-size:13px;line-height:30px;cursor:pointer;',
  '  transition:background 120ms ease,color 120ms ease}',
  '.dsh-sp-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));',
  '  color:var(--dsw-alias-label-secondary,#b9b9b9)}',
  '.dsh-sp-tab[data-active]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));',
  '  color:var(--dsw-alias-label-primary,#e8e8e8);font-weight:600}',
  '.dsh-sp-tab[data-active]:after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;',
  '  height:2px;border-radius:1px;background:currentColor;opacity:.55}',
  '.dsh-sp-tab:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:-2px}',
  '.dsh-sp-tabs-tail{margin-left:auto;padding-left:12px;font-size:11.5px;line-height:17px;',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  color:var(--dsw-alias-label-tertiary,#8b8b8b);font-variant-numeric:tabular-nums;user-select:none;',
  '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

  /* ── 全文视图：整段原文，等宽、保留所有空白与换行 ──
     white-space:pre-wrap + overflow-wrap:anywhere：提示词里有长路径与长 URL，
     不折行会横向溢出；但换行与缩进必须原样保留（那是文本本身的信息）。 */
  '.dsh-sp-full{display:flex;flex-direction:column;gap:8px;flex:none;min-width:0}',
  '.dsh-sp-full-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
  '.dsh-sp-full-label{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  font-size:11px;line-height:16px;letter-spacing:.06em;text-transform:uppercase;',
  '  color:var(--dsw-alias-label-tertiary,#8b8b8b);user-select:none}',
  '.dsh-sp-full-hint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b8b8b);user-select:none}',
  '.dsh-sp-full-body{margin:0;padding:14px 16px;border-radius:10px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));',
  '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.045));',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#cfcfcf);',
  '  white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}',

  /* ── 详细视图：分类块（类头可折叠，类内仍是逐段折叠） ── */
  '.dsh-sp-groups{display:flex;flex-direction:column;gap:6px;flex:none;min-width:0}',
  '.dsh-sp-group{display:flex;flex-direction:column;min-width:0;',
  '  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}',
  '.dsh-sp-group:last-child{border-bottom:none}',
  '.dsh-sp-group-head{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;',
  '  padding:10px 4px;border:none;background:transparent;color:inherit;font-family:inherit;',
  '  text-align:left;cursor:pointer;transition:background 110ms ease}',
  '.dsh-sp-group-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}',
  '.dsh-sp-group-head:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:-2px}',
  '.dsh-sp-group-caret{flex:none;width:14px;display:inline-flex;color:var(--dsw-alias-label-tertiary,#8b8b8b);',
  '  transition:transform 140ms ease}',
  '.dsh-sp-group-head[data-open] .dsh-sp-group-caret{transform:rotate(90deg)}',
  '.dsh-sp-group-label{flex:none;font-size:13px;line-height:20px;font-weight:640;',
  '  color:var(--dsw-alias-label-primary,#e8e8e8)}',
  '.dsh-sp-group-count{flex:none;padding:0 7px;border-radius:999px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));',
  '  font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b8b8b);user-select:none}',
  '.dsh-sp-group-chars{margin-left:auto;flex:none;font-size:11.5px;line-height:17px;',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  color:var(--dsw-alias-label-tertiary,#8b8b8b);font-variant-numeric:tabular-nums;user-select:none}',
  '.dsh-sp-group-desc{margin:0 4px 6px;font-size:11.5px;line-height:18px;',
  '  color:var(--dsw-alias-label-tertiary,#8b8b8b)}',

  /* ── 分段列表：一条发丝线分隔，段名等宽、正文折叠 ── */
  '.dsh-sp-body{display:flex;flex-direction:column;flex:none;min-width:0}',
  '.dsh-sp-sec{border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}',
  '.dsh-sp-sec:last-child{border-bottom:none}',
  '.dsh-sp-sec-head{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;',
  '  padding:9px 4px;border:none;background:transparent;color:inherit;font-family:inherit;',
  '  text-align:left;cursor:pointer;transition:background 110ms ease}',
  '.dsh-sp-sec-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}',
  '.dsh-sp-sec-head:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:-2px}',
  '.dsh-sp-sec-caret{flex:none;width:14px;color:var(--dsw-alias-label-tertiary,#8b8b8b);',
  '  transition:transform 140ms ease}',
  '.dsh-sp-sec-head[data-open] .dsh-sp-sec-caret{transform:rotate(90deg)}',
  '.dsh-sp-sec-name{flex:none;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e8e8e8)}',
  '.dsh-sp-sec-label{flex:none;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b8b8b);',
  '  user-select:none}',
  '.dsh-sp-sec-chars{margin-left:auto;flex:none;font-size:11.5px;line-height:17px;',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  color:var(--dsw-alias-label-tertiary,#8b8b8b);font-variant-numeric:tabular-nums;user-select:none}',
  '.dsh-sp-sec-copy{flex:none;display:inline-flex;align-items:center;justify-content:center;',
  '  width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:inherit;',
  '  cursor:pointer;opacity:0;transition:opacity 120ms ease,background 120ms ease}',
  '.dsh-sp-sec-head:hover .dsh-sp-sec-copy,.dsh-sp-sec-copy:focus-visible{opacity:.7}',
  '.dsh-sp-sec-copy:hover{opacity:1!important;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
  '.dsh-sp-sec-copy:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:-2px}',
  '.dsh-sp-sec-body{margin:0 4px 10px;padding:11px 13px;border-radius:10px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));',
  '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.045));',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#cfcfcf);',
  '  white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;max-height:520px;overflow-y:auto}',
  '.dsh-sp-sec-warn{margin:0 4px 8px;font-size:11.5px;line-height:17px;',
  '  color:var(--dsw-alias-label-tertiary,#8b8b8b)}',

  /* ── 工具清单 ── */
  '.dsh-sp-tools{display:flex;flex-wrap:wrap;gap:5px;flex:none}',
  '.dsh-sp-tool-name{padding:1px 7px;border-radius:6px;',
  '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));',
  '  font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);',
  '  font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary,#b0b0b0)}',
  '.dsh-sp-divider{height:1px;flex:none;margin:2px 0;',
  '  background:var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',

  /* ── 空态 / 骨架 / 错误态（三态一个都不能少，且都不白屏） ── */
  '.dsh-sp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;',
  '  flex:1 1 auto;min-height:220px;padding:40px 20px;text-align:center}',
  '.dsh-sp-empty-icon{color:var(--dsw-alias-label-tertiary,#8b8b8b);opacity:.55}',
  '.dsh-sp-empty-text{font-size:13.5px;line-height:21px;color:var(--dsw-alias-label-secondary,#b0b0b0)}',
  '.dsh-sp-empty-hint{font-size:12px;line-height:19px;color:var(--dsw-alias-label-tertiary,#8b8b8b);max-width:56ch}',
  '.dsh-sp-skeleton{display:flex;flex-direction:column;gap:10px;flex:none;padding:4px 0}',
  '.dsh-sp-skeleton span{display:block;height:14px;border-radius:6px;',
  '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));animation:dsh-sp-pulse 1.4s ease-in-out infinite}',
  '@keyframes dsh-sp-pulse{0%,100%{opacity:.45}50%{opacity:.9}}',
  '.dsh-sp-error{display:flex;flex-direction:column;align-items:flex-start;gap:10px;flex:none;',
  '  padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24))}',
  '.dsh-sp-error-text{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary,#b0b0b0)}',
  '.dsh-sp-error-retry{align-self:flex-start}',

  /* ── 窄屏：页头折行、分段头把中文标签收掉（段名与字数保留） ── */
  '@media (max-width:720px){',
  '  .dsh-sp-head{padding:14px 14px 12px;gap:10px}',
  '  .dsh-sp-scroll{padding:12px 14px 32px}',
  '  .dsh-sp-title{font-size:19px;line-height:26px}',
  '  .dsh-sp-sec-label{display:none}',
  '  .dsh-sp-sec-name{max-width:56%}',
  '  .dsh-sp-stats{grid-template-columns:repeat(auto-fit,minmax(96px,1fr))}',
  '}',
  '@media (prefers-reduced-motion:reduce){',
  '  .dsh-sp-skeleton span{animation:none}',
  '  .dsh-sp-sec-caret,.dsh-sp-sec-head,.dsh-sp-btn{transition:none}',
  '}',
].join('\n')

/**
 * 注入样式表（幂等）。
 *
 * 按**内容**比对而不是只按 id 判重：插件升级后已打开的页面里那份旧 style 会
 * 一直命中早退分支，JSX 拿到新类名却匹配不到新规则，界面直接裸奔。
 */
export function ensureSystemPromptStyles(): void {
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
