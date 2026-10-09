/**
 * iu kind: **piano**（可弹的小键盘，Web Audio 合成发声）。
 *
 * 为什么做成 iu 而不是 html 沙箱卡片：发声要 Web Audio，而沙箱 iframe 是
 * opaque origin（连 localStorage 都没有）；虽然 AudioContext 在沙箱里能用，
 * 但键盘手感、主题跟随、动效都与宿主一致才像「对话里的一张琴」。原生组件
 * 还能顺手把弹过的音回写成简谱。
 *
 * 键盘布局 / 音高 / 简谱换算全部来自 geometry.ts（与截图快照同源）。
 *
 * ⚠ 本文件零 React、零 DOM、零 Web Audio（那些都在 piano.body.tsx）。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { boolOrTrue, esc, escAttr, int, oneOf, str, strOr } from './core.ts'
import { noteToJianpu, pianoLayout } from '../geometry.ts'

/** 允许的音色。 */
const WAVES = ['sine', 'triangle', 'square', 'sawtooth'] as const
export type IuPianoWave = typeof WAVES[number]

export interface IuPianoSpec extends IuSpecBase {
  readonly kind: 'piano'
  readonly title: string
  readonly desc: string
  /** 起始八度（科学音高记号，C4 = 中央 C）。 */
  readonly octave: number
  /** 显示几个八度（1–3）。 */
  readonly octaves: number
  /** 音色。 */
  readonly wave: IuPianoWave
  /** 琴键上标注音名（C D E…）。 */
  readonly showNotes: boolean
}

/**
 * piano 的本地状态：弹过的音（音名序列，回写用）。
 *
 * 持久化它有意义吗？有——用户弹了一段旋律，切走再回来还在，可以接着「填入
 * 输入框」。但音频本身是命令式的（AudioContext / oscillator 都在 body 的 ref 里，
 * 不可序列化），恢复的只是「弹过哪些音」这份记录，不重放声音。
 */
export interface PianoState extends IuState {
  readonly played: readonly string[]
}

function parse(raw: Record<string, unknown>): IuPianoSpec | undefined {
  // 八度钳到 [0,7]：C8 = 4186Hz 已是听觉上限，再高没意义；负八度同理（C0 接近次声）。
  const octave = int(raw.octave, 0, 7, 4)
  const octaves = int(raw.octaves, 1, 3, 1)
  return {
    kind: 'piano',
    title: strOr(raw.title, 40, '钢琴'),
    desc: str(raw.desc, 80),
    octave,
    octaves,
    wave: oneOf<IuPianoWave>(raw.wave, WAVES, 'sine'),
    showNotes: boolOrTrue(raw.showNotes),
  }
}

function initState(_spec: IuPianoSpec): PianoState {
  return { played: [] }
}

/** 回填：把弹过的音拼成音名 + 简谱两行（只记弹奏顺序，不去重不排序）。 */
function fillText(spec: IuPianoSpec, state: PianoState): string {
  const played = state.played
  if (played.length === 0) return `${spec.title}：还没弹`
  const names = played.join(' ')
  const jianpu = played.map(noteToJianpu).join(' ')
  return `${spec.title}：${names}（简谱 ${jianpu}）`
}

/**
 * 静态快照（截图用）。
 *
 * DOM 结构必须与 piano.body.tsx 逐字同构——**尤其 pwhite / pblack 两层容器不能省**：
 * 白键靠 pwhite{display:flex} 等分、黑键靠 pblack{position:absolute} 叠上去。
 * 少了这两层，白键的百分比定位全落回静态流，截图里的琴键变成一级级往下掉的
 * 阶梯（对话流里正常）。共用样式表就必须共用结构。
 */
function snapshot(spec: IuPianoSpec): string {
  const keys = pianoLayout(spec.octave, spec.octaves)
  const label = (name: string): string =>
    (spec.showNotes && name.startsWith('C') ? `<span class="dtt-iu__plabel">${esc(name)}</span>` : '')
  const white = keys.filter(k => !k.black)
    .map(k => `<span class="dtt-iu__pkey">${label(k.name)}</span>`).join('')
  const black = keys.filter(k => k.black)
    .map(k => `<span class="dtt-iu__pkey" style="left:${k.leftPct}%;width:${k.widthPct}%"></span>`).join('')
  const desc = spec.desc !== '' ? `<p class="dtt-iu__desc">${esc(spec.desc)}</p>` : ''
  return desc
    + `<div class="dtt-iu__piano" role="group" aria-label="${escAttr(spec.title)}">`
    + `<div class="dtt-iu__pwhite">${white}</div>`
    + `<div class="dtt-iu__pblack">${black}</div>`
    + `</div>`
    // pcount 空 span 与 Body 对齐：Body 恒渲染「已弹 N 个音」计数节点（初始空文本），
    // snapshot 也输出同一个空 span，两侧 class 集合完全一致（DOM 对齐验证零差异）。
    + `<div class="dtt-iu__phint"><span>点键或用电脑键盘 A W S E D F T G Y H U J K 演奏</span><span class="dtt-iu__pcount"></span></div>`
}

const CSS = [
  /* 钢琴键盘：**白键走 flex 等分、黑键绝对定位叠层**。
     不用「白键也绝对定位 + 百分比 left/width」——容器一旦有 padding，
     百分比就相对于 padding box 算，白键会整体错位并露缝（实测踩中：
     白键缩成几根细线、黑键挤成一堆）。flex 让浏览器自己等分，最稳。 */
  '.dtt-iu__piano { position: relative; height: calc(136px * var(--iu-piano-scale, 1)); margin: 8px 0 4px;',
  '  border-radius: 10px; user-select: none; touch-action: none;',
  '  background: linear-gradient(180deg, rgba(127,127,127,.14), rgba(127,127,127,.05));',
  '  padding: 6px 6px 6px; box-sizing: border-box; }',
  /* 白键层：铺满，flex 等分。**不能加 gap** —— 黑键的百分比坐标是按「白键宽 =
     总宽 / 白键数」算的，任何间隙都会让黑键逐键累积偏移（第 5 个黑键能偏出 8px）。
     键与键的分隔交给 border。 */
  '.dtt-iu__pwhite { display: flex; height: 100%; }',
  '.dtt-iu__pkey { flex: 1 1 0; min-width: 0; padding: 0; cursor: pointer;',
  '  font: inherit; border-radius: 0 0 6px 6px; position: relative;',
  '  border: 1px solid rgba(20,40,90,.22); border-top: 0;',
  '  background: linear-gradient(180deg, #ffffff 0%, #f7f8fb 76%, #e6eaf1 100%);',
  '  color: #7b8494; display: flex; align-items: flex-end; justify-content: center;',
  '  padding-bottom: 7px; box-shadow: 0 2px 0 rgba(20,40,90,.14), inset 0 -3px 6px -3px rgba(20,40,90,.14);',
  '  transition: background-color .08s ease, transform .08s ease, box-shadow .12s ease; }',
  /* 按下：键面下沉 + 品牌色高亮 + 一圈光晕（合成器友好，只动 transform/box-shadow）。
     动画只做「按下那一刻」的增强，常态始终可见 —— 与图表那条纪律一致。 */
  '.dtt-iu__pkey[data-on="1"] { background: linear-gradient(180deg,',
  '  color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 24%, #fff) 0%,',
  '  color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 50%, #fff) 100%);',
  '  transform: translateY(2px) scaleY(.985); transform-origin: top;',
  '  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, transparent),',
  '    0 0 14px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 45%, transparent);',
  '  animation: dtt-iu-pkey-press .28s cubic-bezier(.2,.8,.25,1); }',
  '@keyframes dtt-iu-pkey-press { 0% { transform: translateY(2px) scaleY(.985) scaleX(.96) } 100% { transform: translateY(2px) scaleY(.985) scaleX(1) } }',
  /* 黑键层：绝对定位叠在白键交界处（left/width 来自 pianoLayout，相对于键盘区） */
  '.dtt-iu__pblack { position: absolute; left: 6px; right: 6px; top: 6px; height: 62%;',
  '  pointer-events: none; }',
  '.dtt-iu__pblack .dtt-iu__pkey { position: absolute; top: 0; bottom: auto; height: 100%;',
  '  flex: none; z-index: 2; border-radius: 0 0 5px 5px; pointer-events: auto;',
  '  background: linear-gradient(180deg, #55606f 0%, #2b3444 72%, #1a2130 100%);',
  '  border: 1px solid rgba(0,0,0,.55); border-top: 1px solid rgba(255,255,255,.16);',
  '  box-shadow: 0 3px 5px rgba(0,0,0,.4); }',
  '.dtt-iu__pblack .dtt-iu__pkey[data-on="1"] { background: linear-gradient(180deg,',
  '  color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 72%, #1a2130) 0%,',
  '  color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 42%, #1a2130) 100%); }',
  '.dtt-iu__plabel { font-size: 9.5px; font-weight: 600; letter-spacing: .02em; pointer-events: none; }',
  '.dtt-iu__phint { display: flex; align-items: center; justify-content: space-between; gap: 8px;',
  '  margin-top: 6px; font-size: calc(11px * var(--iu-text-scale, 1)); opacity: .5; }',
  '.dtt-iu__pcount { font-variant-numeric: tabular-nums; white-space: nowrap; }',
  'body[data-ds-dark-theme] .dtt-iu__pkey { background: linear-gradient(180deg, #eef1f5 0%, #d3d9e2 100%); }',
  'body[data-ds-dark-theme] .dtt-iu__pblack .dtt-iu__pkey { background: linear-gradient(180deg, #49525f 0%, #151a22 100%); }',
  'body[data-ds-dark-theme] .dtt-iu__pblack .dtt-iu__pkey[data-on="1"] { background: linear-gradient(180deg,',
  '  color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 72%, #0d1117) 0%,',
  '  color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 42%, #0d1117) 100%); }',
  /* 窄屏：琴键本来就窄，缩一点高度避免挤成缝（--iu-piano-scale 由 IuCard 按容器宽给）。 */
  '@media (max-width: 480px) { .dtt-iu__piano { height: 108px; } }',
  /* reduced-motion 兜底：关掉「按下回弹」动画与过渡，但**下沉与高亮保留**——
     那是按键反馈本身，不是装饰。去掉它按下去就没反应了。
     ⚠ 不得给 [data-on="1"] 写 transform:none（冒烟有断言钉这条）。 */
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu__pkey[data-on="1"] { animation: none; }',
  '  .dtt-iu__pkey { transition: none; }',
  '}',
].join('\n')

export const pianoKind: IuKind<PianoState, IuPianoSpec> = {
  kind: 'piano',
  label: '钢琴',
  parse,
  initState,
  fillText,
  snapshot,
  css: CSS,
  doc: '  · piano 钢琴：{"kind":"piano","title":"标题","octave":4,"octaves":1,"wave":"sine","desc":"一句话","showNotes":true}（octave 0–7 起始八度、octaves 1–3、wave=sine|triangle|square|sawtooth、showNotes 是否在 C 键标音名；点键或用电脑键盘 A W S E D F T G Y H U J K 演奏，右下「填入输入框」把弹过的音写成音名+简谱）。',
}
