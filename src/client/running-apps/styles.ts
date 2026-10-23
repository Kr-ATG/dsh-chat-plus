/**
 * dsh-chat-plus — 「@ 运行中的程序」样式（幂等注入，命名空间 dsh-ra）。
 *
 * ## 为什么需要额外样式
 *
 * 官方的候选菜单（MenuView）只能渲染「14px 的单色图标 + 标题 + 右侧灰字」。
 * 程序候选要的东西它给不了：
 *  · **真实的进程图标**（PNG data URL，彩色、24~32px）——官方 icon 座位只接受
 *    字符串枚举（file/folder/session）或一个 React 组件，且固定 14px；
 *  · 前台窗口的高亮（用户此刻正在看它，应该一眼能认出来）；
 *  · 图标在行内要有个圆角底片，否则浅色图标在浅色菜单上会消失。
 *
 * 于是：候选仍走官方菜单（顺序、键盘、回车、点选全部沿用官方管线），
 * 只在我们自己的图标组件里挂一个带 data 属性的容器，由本样式表接管外观。
 *
 * ## 动效纪律（照 iu 那条，别再踩）
 *
 *  · 数据/内容的**可见性永远不依赖动画**：入场起点是 opacity .55 而不是 0；
 *  · prefers-reduced-motion 下关掉全部装饰动画。
 *
 * 注意：本字符串用数组 join 而非模板字面量 —— 构建期的注入式 CSS 守卫会求值
 * 赋值给标识符的模板字面量，注释里出现反引号会让模板提前闭合。
 * 本文件任何位置都不要出现反引号。
 */
const CSS = [
  '/* ── 候选行图标：真实进程图标 + 圆角底片 ─────────────────────────── */',
  '[data-dsh-ra-icon] {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  width: 14px;',
  '  height: 14px;',
  '  flex: none;',
  '  overflow: hidden;',
  '  border-radius: 4px;',
  '  /* ⚠ 基础规则里 opacity 恒为 1，动画只做 transform 缩放，绝不碰 opacity。',
  '     实测教训（2026-10-23）：写成 opacity:.55 + animation forwards 时，在页面不可见',
  '     （窗口最小化 / 后台标签页）的环境里插件自己的动画节流会把 animation-play-state',
  '     置为 paused，动画永远停在 from 帧，图标就一直半透明——肉眼就是「图标发灰」。',
  '     不可见性不能依赖动画，这是 iu 卡片踩过的同一条坑。 */',
  '  opacity: 1;',
  '  animation: dsh-ra-icon-in .22s cubic-bezier(.2,.8,.25,1);',
  '}',
  '[data-dsh-ra-icon] img {',
  '  width: 14px;',
  '  height: 14px;',
  '  object-fit: contain;',
  '  display: block;',
  '  /* 深色主题下给浅色图标一点分离度。 */',
  '  filter: drop-shadow(0 0 .5px rgba(0, 0, 0, .28));',
  '}',
  '/* 取不到图标时的兜底：首字母色块。 */',
  '[data-dsh-ra-icon][data-dsh-ra-fallback] {',
  '  background: var(--dsw-alias-fill-tsp-secondary, rgba(127, 127, 127, .16));',
  '  color: var(--dsw-alias-label-secondary, currentColor);',
  '  font-size: 9px;',
  '  font-weight: 600;',
  '  line-height: 1;',
  '  letter-spacing: -.02em;',
  '}',
  '@keyframes dsh-ra-icon-in {',
  '  from { transform: scale(.86); }',
  '  to { transform: none; }',
  '}',
  '/* 前台窗口那一条：标题后面挂一枚小圆点，说明「你正在看它」。 */',
  '[data-dsh-ra-focused] {',
  '  display: inline-block;',
  '  width: 5px;',
  '  height: 5px;',
  '  margin-left: 5px;',
  '  border-radius: 50%;',
  '  background: var(--dsw-alias-accent-primary, #4d6bfe);',
  '  vertical-align: 1px;',
  '  animation: dsh-ra-pulse 2.4s ease-in-out infinite;',
  '}',
  '@keyframes dsh-ra-pulse {',
  '  0%, 100% { opacity: .45; }',
  '  50% { opacity: 1; }',
  '}',
  '/* 菜单里「运行中的程序」这一组的标题行：带一枚小图标，与官方其它组区分。 */',
  '[data-dsh-ra-section] {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 4px;',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  [data-dsh-ra-icon], [data-dsh-ra-focused] { animation: none; }',
  '}',
].join('\n')

export const RUNNING_APPS_STYLE_ID = 'dsh-running-apps-styles'

/** 幂等注入（与其它模块同一约定）。 */
export function injectRunningAppsStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(RUNNING_APPS_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = RUNNING_APPS_STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

export const RUNNING_APPS_CSS = CSS
