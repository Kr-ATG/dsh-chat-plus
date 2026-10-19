/**
 * html 卡片样式（命名空间 dtt-he，幂等注入）。
 *
 * 视觉定位：**总结正文里的内嵌插图**，而不是一张嵌套窗口卡。
 * 早期版本自带描边 + 投影 + 实底标题栏，套在总结卡里像「卡中卡」，读起来和
 * 正文是割裂的两块。现在容器完全去 chrome（无描边/无投影/无底色），标题栏降级为
 * 图注行（小字、低对比），动作按钮平时半隐、hover 卡片才浮现；只有预览舞台保留
 * 一圈细描边 + 圆角，承担「这是一张内嵌图」的边界感——和文章里插图一个待遇。
 * 唯一特别的是高度容器 —— 高度由 iframe 上报后写在行内 style 上，这里的
 * transition 负责把「内容变高」变成一次平滑生长，而不是硬跳。
 */

const CSS = [
  '/* 容器：无描边无投影，作为总结正文的内嵌块存在，不做「卡中卡」 */',
  '.dtt-he {',
  '  margin: 8px 0 10px;',
  '  border: 0; border-radius: 0; overflow: visible;',
  '  background: transparent; box-shadow: none;',
  '  animation: dtt-he-rise .34s cubic-bezier(.2,.8,.25,1) both;',
  '}',
  '/* 入场：起点 opacity .72 而不是 0 ——',
  '   ① 与 iu 卡统一（两张卡落进同一段正文时节奏要一致）；',
  '   ② 无头截图 / 全局节流 / 打印会把动画停在第一帧，起点是 0 就整块空白。',
  '   位移同时收到 3px：正文里的插图只需要「轻轻落定」，6px 上浮更像弹窗。 */',
  '@keyframes dtt-he-rise {',
  '  from { opacity: .72; transform: translateY(3px) }',
  '  to { opacity: 1; transform: none }',
  '}',
  '/* 标题：只活在全屏层（内嵌态没有标题栏了，卡片内容通常自带 h1）。',
  '   ⚠ 不用 opacity 做层级（会在暗色下混出非法定中间色，见 iu/styles.ts 的同款注释）。 */',
  '.dtt-he__title {',
  '  font-size: calc(11px * var(--dsw-content-font-size, 14px) / 14px); font-weight: 500;',
  '  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, currentColor)); letter-spacing: .04em;',
  '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;',
  '}',
  '/* 预览舞台：**给一条极细的内描边**（inset box-shadow，不占布局、不撑高度）。',
  ' *',
  ' * 之前完全无边界，理由是「iframe 画布自带主题背景」——那对**片段**成立，但模型写',
  ' * 完整文档时常常自带 body 底色或横向通栏色块，那块面在正文里没有任何边界，看起来',
  ' * 就是「突然出现一截不一样的背景」。一条 .5px 的 inset 描边只做「这是一块画布」的',
  ' * 提示，不构成面板（与 iu 的「线只划线、不围框」纪律一致：内描边不是边框）。',
  ' * 高度仍由 iframe 上报；transition 只负责把「变高」变成一次平滑生长。 */',
  '.dtt-he__stage {',
  '  width: 100%; overflow: hidden;',
  '  border: 0; border-radius: var(--dsw-radius-md, 12px);',
  '  background: transparent;',
  '  box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);',
  '}',
  '.dtt-he__stage--settled { transition: height .28s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-he__frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }',
  '/* ── 预渲染占位（流式期，围栏未闭合）────────────────────────────',
  '   结构与真卡片共用同一套骨架，闭合后只是内容换掉，尺寸与位置不跳。 */',
  '.dtt-he--pending { animation: dtt-he-rise .45s cubic-bezier(.2,.8,.25,1) both; }',
  '.dtt-he__stage--pending {',
  '  display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start;',
  '  gap: 8px; min-height: 0; padding: 2px 0 4px; position: relative;',
  '}',
  '.dtt-he__stage--pending .dtt-he__pending-track { display: none; }',
  '.dtt-he__pending { display: flex; align-items: center; gap: 9px; }',
  '/* 呼吸点：等待态唯一的常驻动效，克制到不抢成品卡片的戏 */',
  '.dtt-he__pending-dot {',
  '  width: 6px; height: 6px; border-radius: 50%; flex: none;',
  '  background: var(--dsw-alias-label-tertiary, rgba(127,127,127,.6));',
  '  animation: dtt-he-breathe 1.4s ease-in-out infinite;',
  '}',
  '@keyframes dtt-he-breathe {',
  '  0%, 100% { opacity: .3; transform: scale(.82) }',
  '  50% { opacity: 1; transform: scale(1) }',
  '}',
  '.dtt-he__pending-text { font-size: 12px; opacity: .55; letter-spacing: .02em; }',
  '.dtt-he__pending-bytes { font-size: 10.5px; opacity: .32; font-variant-numeric: tabular-nums; }',
  '/* 不确定进度条：从左往右扫，暗示「还在长」但不确定还剩多少 */',
  '.dtt-he__pending-track {',
  '  width: min(220px, 62%); height: 3px; border-radius: 999px; overflow: hidden;',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));',
  '}',
  '.dtt-he__pending-bar {',
  '  display: block; width: 38%; height: 100%; border-radius: 999px;',
  '  background: linear-gradient(90deg, transparent, var(--dsw-alias-state-business-primary, #4176e6), transparent);',
  '  animation: dtt-he-sweep 1.5s cubic-bezier(.4,0,.2,1) infinite;',
  '}',
  '@keyframes dtt-he-sweep {',
  '  0% { transform: translateX(-110%) }',
  '  100% { transform: translateX(300%) }',
  '}',
  '/* 无障碍：关掉全部动效 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-he { animation: none; }',
  '  .dtt-he__stage--settled { transition: none; }',
  '  /* 等待态不能动到 0 反馈：脉冲改成常亮，扫光条停在中间偏左的静止位置，',
  '     否则关掉动效后整张占位卡看起来像卡死了。 */',
  '  .dtt-he__pending-dot { animation: none; opacity: .75; transform: none; }',
  '  .dtt-he__pending-bar { animation: none; transform: translateX(80%); opacity: .6; }',
  '}',
].join('\n')

/**
 * 完整样式表（导出给探针 / 截图侧复用，与 iu 的 `IU_CSS` 同构）。
 *
 * 此前 html 卡样式只有 `injectHtmlEmbedStyles()` 一个出口，测试与视觉探针拿不到
 * 一份可复算的 CSS 文本，只能靠「打开真界面肉眼比对」——改前后的对比图因此做不出来。
 */
export const HE_CSS = CSS

export function injectHtmlEmbedStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-chat-flow-html-embed-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-chat-flow-html-embed-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}
