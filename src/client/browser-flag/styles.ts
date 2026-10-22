/**
 * dsh-chat-plus — 浏览器标志样式（命名空间 dsh-bflag，幂等注入）。
 *
 * 只有一处视觉：**会话行右端的一枚小浏览器图标**（::before + mask，由 row-mark.ts
 * 打的 data-dsh-browser-flag 属性触发）。
 *
 * 2026-10-20 定稿：标题栏胶囊整块去掉（带底色描边的圆角块压在顶栏里太吵）。
 * 2026-10-22 按用户要求把标志从行首挪到**行右侧**（时间戳旁边）——行首那格还给
 * 会话状态点，右侧本就承载「这个会话最近怎么了」（相对时间 / 进行中的 pending
 * 标签），浏览器活动放这里读起来是一路的。
 *
 * ## 为什么用伪元素而不是插节点
 *
 * 官方行是 32px 的 flex：span.slot(16px) / span.title(flex:1) / span.time(10px)
 * / 可选 pinIndicator / span.rowActions(hover 才 inline-flex)。往行里插节点会
 * 被 React 重渲染抹掉（见 row-mark.ts 头注释），所以图标必须是伪元素。
 *
 * ## 怎么放进右端而不与时间戳 / 行操作区打架
 *
 * 图标绝对定位在行的 padding 区（inset-inline-end: 6px），同时给这一行加
 * padding-inline-end: 28px，把时间戳与 hover 时出现的行操作按钮一起向内让出
 * 一格。这样三者永不重叠：图标固定最右，时间戳在其左侧；hover 时官方本来就会
 * 用 rowActions 顶掉时间戳，两者都在让出来的 padding 内侧，图标位置不跳。
 *
 * ## 动效
 *
 *  - 出现：从右滑入 + 轻微缩放淡入（.22s cubic-bezier），给「刚发生」一个触感；
 *  - 行让位：padding-inline-end 从 8px 展开到 28px（同一 .22s 曲线），时间戳被
 *    轻轻推开而不是瞬移；标志消失时由 transition 收回；
 *  - 活动期间：呼吸（opacity 与 drop-shadow 微光，1.6s infinite）。周期选 1.6s
 *    而不是更快：更快会读成「加载中转圈」，而这枚图标表达的是「正在进行」，
 *    稳定的慢呼吸才不会让整列列表看起来在闪。
 *
 * ## 颜色
 *
 * 全部走官方 CSS 变量（--dsw-alias-*），图标用 mask + background-color 上色
 * （currentColor 家族），暗色主题自动跟随 —— 不写死黑白。
 *
 * ## 注意
 *
 * 本字符串用数组 join 而非模板字面量：构建期守卫（build.mjs 的
 * assertInjectedCssStrings）会求值「赋值给标识符的模板字面量」，而 CSS 注释里
 * 的反引号会让模板提前闭合、整张样式表静默变成 false（tools-gate/styles.ts 同款）。
 */

/** 行标记属性（与 row-mark.ts 的 BROWSER_FLAG_ROW_ATTR 逐字一致）。 */
  const ROW_ATTR = 'data-dsh-browser-flag'

/** 浏览器图标（16x16 圆 + 横线 + 经线），取自 tools-gate/styles.ts 的同一形状。 */
  const BROWSER_ICON =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\' fill=\'none\' stroke=\'%23000\' stroke-width=\'1.2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Ccircle cx=\'8\' cy=\'8\' r=\'6.25\'/%3E%3Cpath d=\'M1.75 8h12.5\'/%3E%3Cpath d=\'M8 1.75c1.7 1.8 2.6 3.9 2.6 6.25S9.7 12.45 8 14.25C6.3 12.45 5.4 10.35 5.4 8S6.3 3.55 8 1.75z\'/%3E%3C/svg%3E")'

const CSS = [
  ':root {',
  '  --dsh-bflag-icon: ' + BROWSER_ICON + ';',
  '  --dsh-bflag-accent: var(--dsw-alias-state-business-primary, #4176e6);',
  '  /* 右端让位宽度：图标 14px + 图标右边距 6px + 与时间戳的间隙 8px。',
  '     实测 5px 间隙时时间戳与图标读起来贴在一起，8px 才有一格呼吸的空间。 */',
  '  --dsh-bflag-end-room: 28px;',
  '}',
  '',
  '/* ===== 1) 会话行右端的小浏览器图标 =================================== */',
  '/*',
  ' * 位置：**行右端**（时间戳的右边、行尾 padding 区里）。',
  ' *',
  ' * 为什么不占 flex 流：行是官方 React 渲染的 draggable treeitem，插节点会被下一次',
  ' * 重渲染抹掉（见 row-mark.ts 与 tools-gate/menu-icons.ts 的同一结论），而伪元素用',
  ' * order 只能排到最前或最后、挤不动时间戳，所以图标绝对定位在 padding 区，',
  ' * 再由行自己的 padding-inline-end 让出这一格。',
  ' *',
  ' * 行的 position:relative 是这套做法的基准。行内没有别的绝对定位元素（pin 角标与',
  ' * 行操作区都是静态），这个基准不会与官方打架。',
  ' */',
  '/*',
  ' * 过渡挂在**所有会话行**上，而不是只挂在有标志的行上：属性被摘掉的那一刻，',
  ' * 有标志的那条规则就不再匹配，过渡会跟着一起消失，让位宽度会硬跳回 8px。',
  ' * 挂在基础行选择器上，标志消失时才真的「收回去」。值不变时过渡不触发，',
  ' * 对没有标志的行零影响。',
  ' */',
  '[data-row-key^="session:"] {',
  '  transition: padding-inline-end .18s var(--ds-ease-in-out, ease);',
  '}',
  '/* 选择器叠两个属性：官方的 .sessionRow 也有 padding，权重必须压过它 ——',
  ' * 只写一个属性选择器时权重与官方的类选择器相等，谁后注入谁赢，太脆。 */',
  '[data-row-key^="session:"][' + ROW_ATTR + '] {',
  '  position: relative;',
  '  padding-inline-end: var(--dsh-bflag-end-room);',
  '  /* 出现方向由 animation 接管（同一属性上 animation 优先于 transition），',
  '     from 8px → to 让位宽度，读成「时间戳被推开」。 */',
  '  animation: dsh-bflag-row-room .22s cubic-bezier(.2,.8,.25,1) both;',
  '}',
  '[' + ROW_ATTR + ']::before {',
  '  content: "";',
  '  position: absolute;',
  '  inset-inline-end: 6px;',
  '  top: 50%;',
  '  width: 14px;',
  '  height: 14px;',
  '  margin-top: -7px;',
  '  background-color: var(--dsh-bflag-accent);',
  '  -webkit-mask-image: var(--dsh-bflag-icon);',
  '  mask-image: var(--dsh-bflag-icon);',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '  -webkit-mask-size: 13px 13px;',
  '  mask-size: 13px 13px;',
  '  pointer-events: none;',
  '  animation:',
  '    dsh-bflag-icon-in .22s cubic-bezier(.2,.8,.25,1) both,',
  '    dsh-bflag-icon-breathe 1.6s ease-in-out .22s infinite;',
  '  will-change: opacity, transform;',
  '}',
  '/* 行让位：时间戳被推开 20px（8 → 28），与图标入场同一时长，读成一次动作。 */',
  '@keyframes dsh-bflag-row-room {',
  '  from { padding-inline-end: 8px; }',
  '  to { padding-inline-end: 28px; }',
  '}',
  '/* 入场：从右侧滑入 + 轻微缩放淡入。距离只取 3px —— 行高 32px，位移一大就会',
  '   在密集列表里读成「抖」。 */',
  '@keyframes dsh-bflag-icon-in {',
  '  from { opacity: 0; transform: translateX(3px) scale(.72); }',
  '  to { opacity: 1; transform: translateX(0) scale(1); }',
  '}',
  '/* 活动期间：呼吸（不闪）。只动 opacity 与 filter —— 两者都在合成层，不触发',
  '   重排；整列列表里几十枚图标同时呼吸也不会掉帧。 */',
  '@keyframes dsh-bflag-icon-breathe {',
  '  0%, 100% { opacity: .78; filter: none; }',
  '  50% { opacity: 1; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--dsh-bflag-accent) 55%, transparent)); }',
  '}',
  '',
  '/* ===== 无障碍兜底：减弱动效时关掉全部动画与过渡 ===================== */',
  '/* 注意保留可见性：入场动画的 both 填充被关掉后，元素必须仍是完全可见的',
  '   终态，否则减弱动效用户会看到一枚永远不出现的图标。行让位宽度同理 —— 规则的',
  '   静态值本来就是终态，所以这里只需把 animation / transition 关掉。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  /* 过渡挂在基础行上（见上），这里也按同一选择器关掉。 */',
  '  [data-row-key^="session:"] {',
  '    transition: none !important;',
  '  }',
  '  [' + ROW_ATTR + '] {',
  '    animation: none !important;',
  '  }',
  '  [' + ROW_ATTR + ']::before {',
  '    animation: none !important;',
  '    opacity: 1;',
  '    transform: none;',
  '  }',
  '}',
].join('\n')

  export const BROWSER_FLAG_STYLES = CSS

/** 样式表 id（幂等注入 + 冒烟断言）。 */
  export const BROWSER_FLAG_STYLE_ID = 'dsh-browser-flag-style'

/** 幂等注入样式（与其它模块同一约定）。 */
  export function injectBrowserFlagStyles(): void {
    if (typeof document === 'undefined') return
    if (document.getElementById(BROWSER_FLAG_STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = BROWSER_FLAG_STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }
