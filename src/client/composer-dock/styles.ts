/**
 * dsh-chat-plus — 底部状态栏归位：把官方 StatsPills 搬进输入框卡片内部底部居中。
 *
 * 现状（0.2.1 实测）：官方 InputBar 把统计行渲染在输入框卡片**外面**、与卡片同级
 * （`css.card` 是 `renderSlot('conversation.composer.dock')` 的**前一个兄弟**），
 * 所以那三块读数（轮次/步数 · tok/s · 首 token ｜ token · 缓存命中 ｜ 上下文）
 * 一直挂在卡片下沿外侧。用户要的是「对话框（输入框卡片）内部的正中下方」。
 *
 * 为什么是纯 CSS 而不是改 React 树：
 * 把 dock 搬成卡片的子节点要动官方渲染结构，官方每次重渲染都会把这颗被我们
 * 挪走的子树重新按自己的位置创建，结果是「搬一次、闪一次」；同槽另注册一个
 * 座位也做不到——那会多出一行而不是搬走原来那行。CSS 只改几何，结构一字不动，
 * 官方的重渲染、快捷键、点开卡片（portaled dialog）全部照旧。
 *
 * 为什么用负 margin 而不是绝对定位：
 * 绝对定位要先把公共父级改成 position:relative，而卡片里那个 overlayAnchor
 * 是 `inset: 0 0 auto`——包含块一换，toast / 菜单的锚点就跟着歪。负 margin 走
 * 正常流：dock 仍是父级 flex column 的一项，只是往上挪进卡片多出来的
 * padding-bottom 里。父级总高只变化 4px，外部布局感知不到。
 *
 * 几何（实测 1440 / 1600 / 1920 / 1280 各宽度一致）：
 *   卡片 padding-bottom 38px → 状态栏 22px 高，上下各留 8px 呼吸。
 *
 * 稳定钩子只用官方 data 属性（data-composer-card / data-composer-dock）。
 * CSS Module 的 hash 前缀每次构建都变，不碰。官方哪天去掉了这两个属性，
 * 整段规则静默失配、退回原样，不会把界面改坏。
 *
 * 注意：本文件任何位置都不要出现反引号——构建期的注入式 CSS 守卫会求值
 * 赋值给标识符的模板字面量，反引号会让模板提前闭合。
 */
const CSS = [
  '/* 容器 = 同时直接含「输入框卡片」与「非空状态栏」的那个父级（官方整个',
  '   compose 区块的根节点）。用 div 前缀把 :has 的求值面收到 div 上。 */',
  "div:has(> [data-composer-card]):has(> [data-composer-dock]:not(:empty)) > [data-composer-card] {",
  '  padding-bottom: 38px;',
  '  /* 一轮对话刚产生读数时状态栏才变非空，卡片顺势长高而不是硬跳。 */',
  '  transition: padding-bottom .32s cubic-bezier(.2, .8, .25, 1);',
  '}',
  '',
  '/* 状态栏：上移进卡片底部那 38px 里，水平居中由官方自己的',
  '   justify-content:center 负责（不要重复声明，官方改布局时跟着走）。 */',
  "div:has(> [data-composer-card]):has(> [data-composer-dock]:not(:empty)) > [data-composer-dock] {",
  '  margin-top: -30px;',
  '  /* 官方原本靠 padding-top:4 与卡片拉开距离，现在距离由上面的负 margin 给。 */',
  '  padding-top: 0;',
  '  animation: dsh-composer-dock-in .32s cubic-bezier(.2, .8, .25, 1) both;',
  '}',
  '',
  '@keyframes dsh-composer-dock-in {',
  '  from { opacity: 0; transform: translateY(-3px); }',
  '  to { opacity: 1; transform: none; }',
  '}',
  '',
  '@media (prefers-reduced-motion: reduce) {',
  "  div:has(> [data-composer-card]):has(> [data-composer-dock]:not(:empty)) > [data-composer-card] { transition: none; }",
  "  div:has(> [data-composer-card]):has(> [data-composer-dock]:not(:empty)) > [data-composer-dock] { animation: none; }",
  '}',
].join('\n')

export const COMPOSER_DOCK_STYLE_ID = 'dsh-composer-dock-styles'

/** 幂等注入（与其它模块同一约定）。 */
export function injectComposerDockStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(COMPOSER_DOCK_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = COMPOSER_DOCK_STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
