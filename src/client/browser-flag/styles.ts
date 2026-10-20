/**
 * dsh-chat-plus — 浏览器标志样式（命名空间 dsh-bflag，幂等注入）。
 *
 * 只有一处视觉：**会话行首的一枚小浏览器图标**（::before + mask，由 row-mark.ts
 * 打的 data-dsh-browser-flag 属性触发）。
 *
 * 2026-10-20 按用户要求定稿：标题栏胶囊整块去掉（带底色描边的圆角块压在顶栏里
 * 太吵），标志只保留一枚安静的小图标，位置从行尾挪到**行首**。
 *
 * ## 为什么用伪元素而不是插节点
 *
 * 官方行是 32px 的 flex：span.slot(16px) / span.title(flex:1) / span.time(10px)
 * / 可选 pinIndicator / span.rowActions(hover 才 inline-flex)。往行里插节点会
 * 被 React 重渲染抹掉（见 row-mark.ts 头注释），所以图标必须是伪元素。
 *
 * ## 动效
 *
 *  - 出现：滑入 + 轻微缩放淡入（.22s cubic-bezier），给「刚发生」一个触感；
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
  '}',
  '',
  '/* ===== 1) 会话行首的小浏览器图标 ===================================== */',
  '/*',
  ' * 位置：**行首状态位**（官方行里那 16px 的 .slot 格子）。',
  ' *',
  ' * 为什么不是行尾：行尾紧邻时间戳与 hover 才出现的行操作区，图标挤在那里既压',
  ' * 时间、又要给 rowActions 让位；用户明确要求标志在**左边**。行首那格本是会话',
  ' * 状态点（spinner）的地盘 —— 同一语义（这个会话在动），扫列表时第一眼就看到。',
  ' *',
  ' * 怎么放进去而不改行结构：行是官方 React 渲染的 draggable treeitem，插节点会被',
  ' * 下一次重渲染抹掉（见 row-mark.ts 与 tools-gate/menu-icons.ts 的同一结论），所以',
  ' * 仍然只打属性，图标本体用行的 ::before 画出来（绝对定位，脱离 flex 流，不影响',
  ' * 标题的 flex:1 分配）。',
  ' *',
  ' * 两个必须的配套：',
  ' *  1. 行加 position:relative —— 绝对定位需要一个定位基准。行业内没有别的绝对',
  ' *     定位元素（pin 角标与行操作区都是静态），所以这个基准不会与官方打架；',
  ' *  2. 原状态点淡出 —— 同一格里既有转圈又有浏览器图标会糊成一团，而图标本身',
  ' *     带呼吸动效，已经表达了「正在进行」。',
  ' */',
  '[data-dsh-browser-flag] { position: relative; }',
  '[data-dsh-browser-flag] > span:first-child > svg { opacity: 0 !important; }',
  '[data-dsh-browser-flag]::before {',
  '  content: "";',
  '  position: absolute;',
  '  inset-inline-start: calc(8px + var(--dsh-workspace-indent, 0px) + 1px);',
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
  '/* 入场：从左侧滑入 + 轻微缩放淡入。距离只取 3px —— 行高 32px，位移一大就会',
  '   在密集列表里读成「抖」。 */',
  '@keyframes dsh-bflag-icon-in {',
  '  from { opacity: 0; transform: translateX(-3px) scale(.72); }',
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
  '   终态，否则减弱动效用户会看到一枚永远不出现的图标。 */',
  '@media (prefers-reduced-motion: reduce) {',
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
