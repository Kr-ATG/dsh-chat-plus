/**
 * dsh-chat-plus — iu 卡片**基座**样式（命名空间 dtt-iu，幂等注入）。
 *
 * 本文件只留所有 kind 共用的部分：容器 / 头（标题+角标）/ desc / 底栏（填入
 * 输入框）/ 流式占位 / 字号轴变量 / 无障碍兜底。每个 kind 的专属样式在
 * kinds/<kind>.ts 的 css 字段里，由 iuKindsCss() 汇总后拼在本基座之后。
 *
 * @module
 */

import { iuKindsCss } from './kinds/registry.ts'

/**
 * 基座样式表正文（不含各 kind 专属样式）。
 *
 * ## 字号轴（跟随官方「设置 → 字号」）
 *
 * 官方把用户字号偏好落在 body 的 `--dsh-content-font-size`（默认 14px，
 * 见 ui-theme gradient-shadow-text.css 与 ui-layout theme-presenter.ts）。
 * 基座在 .dtt-iu 上定义：
 *
 *     --iu-text-scale: calc(var(--dsh-content-font-size, 14px) / 14)
 *
 * 各 kind 的字号一律写 `calc(Npx * var(--iu-text-scale, 1))`——用户在官方设置
 * 里调字号，卡片文字即时无级跟随（14→17px 时 scale = 1.214…），不需要 JS
 * 监听、不需要刷新。设计基准 14px 与官方正文一致。
 *
 * ## 动效纪律（两案都实测踩过，别再改回去）
 *
 *  1. 数据/内容的**可见性永远不依赖动画**：入场动画的起点必须是「已经看得
 *     见」的状态（opacity ≥ .5），绝不是 opacity 0 / scaleY(0) / dashoffset
 *     满偏移。无头截图、打印、全局节流（页面不可见时 animation-play-state:
 *     paused）都会让动画停在第一帧——起点不可见，卡片就是一片空。
 *  2. prefers-reduced-motion 下关掉全部装饰动画，但**按键/勾选一类的状态
 *     反馈保留**（那是反馈本身，不是装饰）。
 */

/**
 * 基座样式表正文（不含各 kind 专属样式）。
 *
 * kinds/<kind>.ts 只 import core/contract/geometry，**不会** import 本文件，
 * 所以这里直接 import registry 汇总 kinds CSS 没有静态环（依赖是单向的：
 * styles → registry → kinds → core）。shot/card.ts 拿到的 IU_CSS 因此就是
 * 「基座 + 全部 kind」的完整样式表，截图侧零改动。
 */
const IU_BASE_CSS = [
  '/* ── 字号轴：跟随官方设置字号（见文件头注释）──────────────────────── */',
  '.dtt-iu { --iu-text-scale: calc(var(--dsh-content-font-size, 14px) / 14);',
  '  --iu-r-lg: calc(14px * var(--iu-text-scale, 1)); --iu-r-md: calc(10px * var(--iu-text-scale, 1));',
  '  --iu-sh-sm: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary, #2d3142) 10%, transparent);',
  '  --iu-sh-md: 0 6px 16px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 22%, transparent); }',
  '/* 容器：正文里的小应用卡（V2：顶部 accent 线 + tinted 阴影 + 非对称留白） */',
  '.dtt-iu {',
  '  position: relative; margin: 14px 0 6px;',
  '  border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));',
  '  border-radius: var(--iu-r-lg);',
  '  padding: 14px 16px 12px;',
  '  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));',
  '  box-shadow: 0 8px 30px rgba(20,40,90,.07);',
  '  animation: dtt-iu-rise .45s cubic-bezier(.2,.8,.25,1) both;',
  '}',
  '.dtt-iu::before { content: ""; position: absolute; left: 14px; top: -1px; width: 44px; height: 3px;',
  '  border-radius: 0 0 4px 4px;',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  box-shadow: 0 0 8px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, transparent); }',
  'body[data-ds-dark-theme] .dtt-iu { border-color: rgba(255,255,255,.10); box-shadow: 0 10px 30px rgba(0,0,0,.55); }',
  '@keyframes dtt-iu-rise {',
  '  from { opacity: .5; transform: translateY(6px) }',
  '  to { opacity: 1; transform: none }',
  '}',
  '/* 头：标题 + 类型小标签 */',
  '.dtt-iu__head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
  '.dtt-iu__dot { width: 7px; height: 7px; border-radius: 50%; flex: none;',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  box-shadow: 0 0 6px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 45%, transparent); }',
  '.dtt-iu__title { font-size: calc(14px * var(--iu-text-scale, 1)); font-weight: 700; letter-spacing: -.01em; flex: 1; min-width: 0;',
  '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '.dtt-iu__tag { font-size: calc(10.5px * var(--iu-text-scale, 1)); opacity: .6; border: 1px solid currentColor;',
  '  border-radius: 8px; padding: 1px 8px; line-height: 18px; white-space: nowrap; font-weight: 600; }',
  '.dtt-iu__desc { font-size: calc(12px * var(--iu-text-scale, 1)); opacity: .62; margin: 0 0 10px; line-height: 1.6; }',
  '/* 底栏：填入输入框按钮（V2：主按钮实心化） */',
  '.dtt-iu__foot { display: flex; justify-content: flex-end; margin-top: 12px; padding-top: 10px;',
  '  border-top: 1px dashed var(--dsw-alias-border-l3, rgba(127,127,127,.25)); }',
  '.dtt-iu__fill {',
  '  border: 1px solid var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: var(--dsw-alias-state-business-primary, #4176e6); color: #fff; font: inherit;',
  '  font-size: calc(12px * var(--iu-text-scale, 1)); font-weight: 600;',
  '  border-radius: 8px; padding: 5px 14px; cursor: pointer;',
  '  transition: opacity .18s ease, filter .18s ease, transform .18s ease, box-shadow .18s ease;',
  '  box-shadow: 0 2px 8px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);',
  '}',
  '.dtt-iu__fill:hover { filter: brightness(1.08); transform: translateY(-1px);',
  '  box-shadow: 0 4px 14px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 40%, transparent); }',
  '.dtt-iu__fill:active { transform: translateY(0) scale(.96); }',
  '.dtt-iu__fill--done { border-color: var(--dsw-alias-state-success-primary, #27ae60);',
  '  background: var(--dsw-alias-state-success-primary, #27ae60); color: #fff; }',
  '/* 窄屏：容器留白收窄，正文别挤（各 kind 的横向布局在自己 css 里降级） */',
  '@media (max-width: 480px) {',
  '  .dtt-iu { padding: 10px 10px 8px; border-radius: 10px; }',
  '}',
  '/* 流式占位：与 html 卡片同语言的等待态（呼吸点 + 扫光条） */',
  '.dtt-iu--pending { animation: dtt-iu-rise .45s cubic-bezier(.2,.8,.25,1) both; }',
  '.dtt-iu__stage--pending { display: flex; flex-direction: column; align-items: center;',
  '  justify-content: center; gap: 10px; min-height: 84px; padding: 16px; }',
  '.dtt-iu__pending { display: flex; align-items: center; gap: 9px; }',
  '.dtt-iu__pending-dot { width: 7px; height: 7px; border-radius: 50%; flex: none;',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  animation: dtt-iu-breathe 1.4s ease-in-out infinite; }',
  '@keyframes dtt-iu-breathe { 0%, 100% { opacity: .3; transform: scale(.82) } 50% { opacity: 1; transform: scale(1) } }',
  '.dtt-iu__pending-text { font-size: calc(12px * var(--iu-text-scale, 1)); opacity: .55; }',
  '.dtt-iu__pending-track { width: min(200px, 60%); height: 3px; border-radius: 999px; overflow: hidden;',
  '  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14)); }',
  '.dtt-iu__pending-bar { display: block; width: 38%; height: 100%; border-radius: 999px;',
  '  background: linear-gradient(90deg, transparent, var(--dsw-alias-state-business-primary, #4176e6), transparent);',
  '  animation: dtt-iu-sweep 1.5s cubic-bezier(.4,0,.2,1) infinite; }',
  '@keyframes dtt-iu-sweep { 0% { transform: translateX(-110%) } 100% { transform: translateX(300%) } }',
  '/* 无障碍：关掉全部装饰动效，等待态留常亮反馈。',
  '   图表/琴键的状态反馈保留——那是反馈本身，不是装饰（见文件头纪律 2）。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu { animation: none; }',
  '  .dtt-iu__out:hover, .dtt-iu__chip:hover, .dtt-iu__tab:hover { transform: none; }',
  '  .dtt-iu__fill:hover { transform: none; }',
  '  .dtt-iu__progress i, .dtt-iu__box, .dtt-iu__box svg, .dtt-iu__check, .dtt-iu__fill, .dtt-iu__tab { transition: none; }',
  '  .dtt-iu__pending-dot { animation: none; opacity: .75; }',
  '  .dtt-iu__pending-bar { animation: none; transform: translateX(80%); opacity: .6; }',
  '}',
].join('\n')

/**
 * 完整 iu 样式表 = 基座 + 全部 kind 专属样式。
 *
 * **导出给截图管线复用**（shot/card.ts 的 `import { IU_CSS }` 零改动即拿到
 * 全量）。依赖单向：styles → registry → kinds/<kind> → core，无静态环
 * （没有任何 kind 模块反向 import styles.ts）。
 */
export const IU_CSS = IU_BASE_CSS + '\n' + iuKindsCss()

export function injectIuStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-chat-plus-iu-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-chat-plus-iu-styles'
  style.textContent = IU_CSS
  document.head.appendChild(style)
}
