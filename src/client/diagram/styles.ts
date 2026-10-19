/** diagram 流程图卡片容器样式（命名空间 dtt-diagram，幂等注入）。 */

const CSS = [
  '/* diagram：整张图 = 正文里的**一张插图**，而不是「图纸卡」。',
  ' *',
  ' * 融合第三版（2026-10-19）：此前是 1px 边框 + 12px 圆角 + 投影 + 16px 内边距的「图纸卡」，',
  ' * 还叠着两层 !important 覆盖链（先去底色、再加回边框投影），是全场唯一还在自成一派的通道 ——',
  ' * iu 与 html 早就去外框了，只剩它像一块贴上去的面板。',
  ' * 现在与另两条通道同一套语言：无框、无影、无底色，只留内容本身；比例切换器从「绝对定位',
  ' * 压在图右上角」挪进图注行（它是控件，不该盖在图上）。',
  ' *',
  ' * ⚠ 别再给容器加边框 / 圆角 / 投影：图形自己就是内容，容器只是载体。',
  ' *   历史坑：这里曾用 !important 反复覆盖同一条规则，改一处漏一处，最终视觉效果取决于',
  ' *   哪条 !important 排在后面 —— 那种写法不该再回来。 */',
  '.dtt-diagram {',
  '  position: relative;',
  '  margin: 8px 0 10px;',
  '  border: 0; border-radius: 0; padding: 0;',
  '  background: transparent; box-shadow: none;',
  '  animation: dtt-dg-rise .34s cubic-bezier(.2,.8,.25,1) both;',
  '}',
  '/* 入场：与 iu / html 同一条曲线（起点 .72，可见性不依赖动画）。 */',
  '@keyframes dtt-dg-rise { from { opacity: .72; transform: translateY(3px) } to { opacity: 1; transform: none } }',
  '/* 图注行：标题 + 比例切换器，与 iu 的 .dtt-iu__head 同一分量。 */',
  '.dtt-dg-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; min-height: 18px; }',
  '.dtt-dg-title { flex: 1; min-width: 0; font-size: calc(11px * var(--dsw-content-font-size, 14px) / 14px);',
  '  font-weight: 500; letter-spacing: .04em;',
  '  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, currentColor));',
  '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '/* 比例切换：文字式，不是胶囊分段控件。三个中文字贴着图注右端，平时半隐。 */',
  '.dtt-dg-scale { display: flex; align-items: center; gap: 2px; flex: none;',
  '  opacity: 0; transition: opacity .18s ease; }',
  '.dtt-diagram:hover .dtt-dg-scale, .dtt-diagram:focus-within .dtt-dg-scale { opacity: 1; }',
  '@media (hover: none) { .dtt-dg-scale { opacity: .8; } }',
  '.dtt-dg-scale-btn { border: 0; background: transparent; font-family: inherit; cursor: pointer;',
  '  font-size: calc(10.5px * var(--dsw-content-font-size, 14px) / 14px); line-height: 18px;',
  '  min-width: 20px; padding: 0 4px; border-radius: 4px; color: inherit; opacity: .5;',
  '  transition: opacity .16s ease, background-color .16s ease; }',
  '.dtt-dg-scale-btn:hover { opacity: .9; background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }',
  '.dtt-dg-scale-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 1px; }',
  '.dtt-dg-scale-btn--active { opacity: 1; font-weight: 600;',
  '  color: var(--dsw-alias-label-secondary, currentColor); }',
  '/* 图本体：占满整行。SVG 是矢量的，放大不糊；此前 max-width 660 居中，在 1100px 的',
  '   对话流里图只占中间六成，两侧各留一条空白 —— 图越小越难读，而空间恰恰是有的。 */',
  '/* 图本体：占满可用宽度，但**最多放大到原生尺寸的 1.45 倍**（上限由组件按 viewBox',
  '   算出写进 max-width）。为什么要有上限：SVG 是等比缩放的，撑满 1034px 时 12px 的',
  '   标签会变成 20px —— 图是大了，但字号跳出了正文节奏，看起来像「被放大的截图」。',
  '   1.45 倍是可读性与版面填充的折中：窄图不再只占中间六成，也不会字大如标题。 */',
  '.dtt-diagram svg { display: block; width: 100%; height: auto; margin: 0 auto; }',
  '/* 放大档：允许横向滚动（图比容器宽时才出现），不加外框。 */',
  '.dtt-diagram--large { overflow-x: auto; }',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-diagram { animation: none; }',
  '  .dtt-dg-scale, .dtt-dg-scale-btn { transition: none; }',
  '}',
].join('\n')

/** 完整样式表（导出给探针 / 截图侧复用；与 iu 的 IU_CSS、html 的 HE_CSS 同构）。 */
export const DG_CSS = CSS

export function injectDiagramStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-chat-flow-diagram-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-chat-flow-diagram-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}
