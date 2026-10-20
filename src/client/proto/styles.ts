/** proto-tabs 交互卡片样式（命名空间 dtt-proto__，幂等注入）。 */

/*
 * proto-tabs：对话流里的「多方案对比」块。
 *
 * 融合第三版（2026-10-19）：此前是 1px 边框 + 16px 圆角 + 投影 + 7px 光点 + 胶囊分段控件的
 * 「应用卡片」，还叠着一层 background: transparent !important 覆盖链 —— 与 iu / html / diagram
 * 另外三条通道完全不是一套语言。现在统一成「图注 + 正文级区块」：
 *   · 容器无框无影无底；标题降成 caption（与 .dtt-iu__head / .dtt-he__bar 同源）；
 *   · tabs 从胶囊分段控件改成下划线分页（与 iu 的 tabs kind 同一套）；
 *   · 去掉品牌色光点、写死的 Tailwind slate 色、以及 dashed 边框；
 *   · hover 一律不位移（正文里的元素不做「浮起」）。
 */
const CSS = [
  '.dtt-proto {',
  '  --dtp-accent: var(--dsw-alias-state-business-primary, #4176e6);',
  '  margin: 8px 0 10px;',
  '  border: 0; border-radius: 0; padding: 0;',
  '  background: transparent; box-shadow: none;',
  '  animation: dtt-proto-rise .34s cubic-bezier(.2,.8,.25,1) both;',
  '}',
  '@keyframes dtt-proto-rise {',
  '  from { opacity: .72; transform: translateY(3px) }',
  '  to { opacity: 1; transform: none }',
  '}',
  '/* 头：图注行（标题 + 分段），不再有底部分隔线与 12px 留白。 */',
  '.dtt-proto__head {',
  '  display: flex; align-items: center; justify-content: space-between;',
  '  gap: 10px; flex-wrap: wrap;',
  '  padding: 0; margin: 0 0 6px; border-bottom: 0;',
  '}',
  '.dtt-proto__title { display: flex; align-items: center; gap: 8px;',
  '  font-size: calc(11px * var(--dsw-content-font-size, 14px) / 14px); font-weight: 500; letter-spacing: .04em;',
  '  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, currentColor)); }',
  '/* 品牌色光点已移除：它是「状态指示灯」的语言，这里没有状态。 */',
  '.dtt-proto__dot { display: none; }',
  '/* 分段控件 → 下划线分页（与 iu tabs 同款）。 */',
  '.dtt-proto__tabs { display: flex; gap: 2px; flex-wrap: wrap; background: none; padding: 0; border-radius: 0;',
  '  border-bottom: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); }',
  '.dtt-proto__tab { position: relative; border: 0; background: transparent; font-family: inherit; cursor: pointer;',
  '  font-size: calc(12.5px * var(--dsw-content-font-size, 14px) / 14px); padding: 5px 10px 7px;',
  '  border-radius: 0; color: inherit; opacity: .55; transition: opacity .18s ease; }',
  '.dtt-proto__tab::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 1.5px;',
  '  border-radius: 2px 2px 0 0; background: currentColor; opacity: 0; transform: scaleX(.4);',
  '  transition: opacity .2s ease, transform .24s cubic-bezier(.2,.8,.25,1); }',
  '.dtt-proto__tab:hover { opacity: .85; }',
  '.dtt-proto__tab--active { opacity: 1; font-weight: 600; color: inherit; background: transparent; box-shadow: none; }',
  '.dtt-proto__tab--active::after { opacity: 1; transform: none; }',
  '.dtt-proto__panel { animation: dtt-proto-fade .22s cubic-bezier(.2,.8,.25,1) both; }',
  '@keyframes dtt-proto-fade { from { opacity: .55; transform: translateY(2px) } to { opacity: 1; transform: none } }',
  '/* 小标题：去掉写死的 #4caf50 与圆点，改用正文色 + 字重。 */',
  '.dtt-proto__heading { display: block; font-size: calc(12.5px * var(--dsw-content-font-size, 14px) / 14px);',
  '  font-weight: 600; color: inherit; margin: 2px 0 8px; }',
  '.dtt-proto__heading::before { content: none; }',
  '/* pill：从「1.5px 描边胶囊 + hover 辉光上浮」改成正文式的可点行。 */',
  '.dtt-proto__pill { display: flex; align-items: center; gap: 10px; cursor: pointer;',
  '  border: 0; border-bottom: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);',
  '  border-radius: 0; padding: 8px 2px; transition: background-color .18s ease; }',
  '.dtt-proto__pill:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }',
  '/* 灯泡装饰圆点：去掉（正文里不需要一颗渐变玻璃球）。 */',
  '.dtt-proto__bulb { display: none; }',
  '.dtt-proto__tag { font-size: calc(10.5px * var(--dsw-content-font-size, 14px) / 14px); font-weight: 600;',
  '  padding: 0; border-radius: 0; background: none; color: var(--dtp-accent); letter-spacing: .04em; white-space: nowrap; }',
  '/* 写死的 Tailwind slate 色已删除：它们不跟主题，暗色/亮色下都可能是错的。 */',
  '.dtt-proto__desc { flex: 1; font-size: calc(12.5px * var(--dsw-content-font-size, 14px) / 14px);',
  '  color: var(--dsw-alias-label-secondary, currentColor); white-space: nowrap; overflow: hidden;',
  '  text-overflow: ellipsis; min-width: 0; }',
  '.dtt-proto__arrow { color: var(--dsw-alias-label-tertiary, currentColor); opacity: .7; transition: transform .22s ease; }',
  '.dtt-proto__arrow--open { transform: rotate(90deg); }',
  '/* 详情：从虚线框 + 品牌底改成左侧一条发丝线（引用块的读法）。 */',
  '.dtt-proto__detail { margin-top: 8px; padding: 2px 0 2px 10px;',
  '  border: 0; border-left: .5px solid color-mix(in srgb, var(--dtp-accent) 45%, transparent); border-radius: 0;',
  '  background: none; font-size: calc(12.5px * var(--dsw-content-font-size, 14px) / 14px);',
  '  color: var(--dsw-alias-label-secondary, currentColor);',
  '  animation: dtt-proto-fade .22s ease both; }',
  '/* 可展开卡：去 1.5px 描边与圆角，改成「一条底线 + 可点行」。 */',
  '.dtt-proto__expand { border: 0; border-radius: 0; overflow: visible;',
  '  border-bottom: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }',
  '.dtt-proto__expand-head { display: flex; align-items: center; gap: 10px; padding: 8px 2px; cursor: pointer; }',
  '.dtt-proto__expand-body { padding: 2px 0 10px 10px; font-size: calc(12.5px * var(--dsw-content-font-size, 14px) / 14px);',
  '  border-top: 0; border-left: .5px solid color-mix(in srgb, var(--dtp-accent) 45%, transparent);',
  '  margin: 0 0 0 2px; animation: dtt-proto-fade .22s ease both; }',
  '/* 流光：正文里不要循环动画（会把注意力钉在这条线上）。改成静态渐变描边。 */',
  '.dtt-proto__glow { border-radius: 10px; padding: 1px;',
  '  background: linear-gradient(110deg, color-mix(in srgb, var(--dtp-accent) 55%, transparent),',
  '    color-mix(in srgb, var(--dtp-accent) 18%, transparent) 60%, color-mix(in srgb, var(--dtp-accent) 40%, transparent));',
  '  animation: none; cursor: pointer; }',
  '.dtt-proto__glow-inner { border-radius: 9px; padding: 10px 14px; display: flex; align-items: center; gap: 10px;',
  '  background: var(--dsw-alias-bg-base, #fff); color: inherit; }',
  '.dtt-proto__spark { color: var(--dsw-alias-state-warn-primary, #f59e0b); }',
  '/* 三小卡：去边框圆角与 hover 上浮，改成三栏文字块。 */',
  '.dtt-proto__minis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 10px; }',
  '.dtt-proto__mini { border: 0; border-radius: 0; padding: 0; font-size: calc(12.5px * var(--dsw-content-font-size, 14px) / 14px);',
  '  color: var(--dsw-alias-label-secondary, currentColor); }',
  '.dtt-proto__mini b { display: block; color: inherit; font-weight: 600; margin-bottom: 2px; }',
  '.dtt-proto__hint { font-size: calc(11px * var(--dsw-content-font-size, 14px) / 14px);',
  '  color: var(--dsw-alias-label-caption, currentColor); margin-top: 8px; text-align: left; }',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-proto, .dtt-proto__panel, .dtt-proto__detail, .dtt-proto__expand-body { animation: none; }',
  '  .dtt-proto__tab, .dtt-proto__pill, .dtt-proto__expand { transition: none; }',
  '  .dtt-pt-pending-dot { animation: none; opacity: .75; }',
  '}',
  '/* 流式占位：与 iu / html / diagram 同一分量的一条行内提示。 */',
  '.dtt-pt-stage--pending { display: flex; align-items: center; gap: 9px; padding: 2px 0; }',
  '.dtt-pt-pending-dot { width: 6px; height: 6px; border-radius: 50%; flex: none;',
  '  background: var(--dsw-alias-label-tertiary, #7a8399);',
  '  animation: dtt-pt-blink 1.15s ease-in-out infinite; }',
  '@keyframes dtt-pt-blink { 0%, 100% { opacity: .28 } 50% { opacity: 1 } }',
  '.dtt-pt-pending-text { font-size: calc(12px * var(--dsw-content-font-size, 14px) / 14px);',
  '  color: var(--dsw-alias-label-tertiary, currentColor); }',
  '.dtt-pt-pending-bytes { font-size: calc(10.5px * var(--dsw-content-font-size, 14px) / 14px);',
  '  opacity: .32; font-variant-numeric: tabular-nums; }',
].join('\n')

/** 完整样式表（导出给探针 / 截图侧复用）。 */
export const PROTO_CSS = CSS

export function injectProtoStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-chat-flow-proto-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-chat-flow-proto-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}
