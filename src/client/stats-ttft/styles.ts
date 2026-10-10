/**
 * dsh-chat-plus — 首 token 平铺读数样式（命名空间 data-dsh-ttft，幂等注入）。
 *
 * 读数追认进官方 TimePill 的 label：字号颜色全部继承 pill，
 * 这里只补分隔点与入场淡入。字号轴变化自动跟随（不写死任何字号）。
 * 动效只有挂载那一次淡入，reduced-motion 下关闭。
 *
 * 注意：本字符串用数组 join 而非模板字面量 —— 构建期的注入式 CSS 守卫
 * 会求值赋值给标识符的模板字面量，而注释里的反引号会让模板提前闭合。
 * 本文件任何位置都不要出现反引号。
 */
const CSS = [
  '/* 平铺读数：继承 pill 的字体与颜色，只定展示形态。 */',
  '[data-dsh-ttft-flat] {',
  '  display: inline;',
  '  font-variant-numeric: tabular-nums;',
  '  white-space: nowrap;',
  '  animation: dsh-ttft-in .28s cubic-bezier(.2,.8,.25,1) both;',
  '}',
  '/* 分隔点与官方 pill 内分隔点同款（色与间距）。 */',
  '[data-dsh-ttft-flat] [data-dsh-ttft-sep] {',
  '  color: var(--dsw-alias-separator-primary);',
  '  margin: 0 6px;',
  '}',
  '@keyframes dsh-ttft-in {',
  '  from { opacity: 0; transform: translateY(2px); }',
  '  to { opacity: 1; transform: none; }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  [data-dsh-ttft-flat] { animation: none; }',
  '}',
].join('\n')

export const TTFT_FLAT_STYLE_ID = 'dsh-stats-ttft-styles'

/** 幂等注入（与其它模块同一约定）。 */
export function injectTtftFlatStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(TTFT_FLAT_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = TTFT_FLAT_STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
