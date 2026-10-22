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
 *     --iu-text-scale: calc(var(--dsh-content-font-size, 14px) / 14px)
 *
 * ⚠ **除数是 14px，不是 14**。CSS calc 的量纲规则：长度 ÷ 数字 = 长度，
 * 长度 ÷ 长度 = 数字。写成 `/14` 时该变量求值为 `1px`（长度），于是各 kind 的
 * `calc(12.5px * var(--iu-text-scale))` 变成 px² —— 非法量纲，**整条 font-size
 * 声明被静默丢弃**，文字回退成继承值（SVG 里 16px）。真浏览器实测：
 * `/14` → font-size 16px（失效）；`/14px` → 12.5px（正确）。
 * 症状是「字号轴完全不生效 + 图形里文字撑爆节点框」，不报任何错。
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
  '/* ⚠ 除数必须带单位（14px，不是 14）：CSS calc 里「长度 / 数字」的结果仍是长度，',
  '   而 --iu-text-scale 必须是**无单位数字**。写成 /14 时该值是 1px，于是所有',
  '   calc(Npx * var(--iu-text-scale)) 变成 px² 这种非法量纲，整条 font-size 被',
  '   静默丢弃、回退成继承值（SVG 里 16px）——表现为「字号轴不生效 + 文字撑爆节点框」。',
  '   长度 / 长度 = 数字，所以除数是 14px。 */',
  '/* --iu-zoom 是**外部注入的备用轴**（只有截图链路会写它）；对话流里的卡片',
  '   缩放按钮已移除，组件自身不再设置这个变量，取不到时恒为 1。 */',
  '.dtt-iu { --iu-text-scale: calc((var(--dsh-content-font-size, 14px) / 14px) * var(--iu-zoom, 1));',
  '  /* 圆角轴只跟 --iu-zoom（外部注入），不跟字号轴。',
  '     ⚠ 这里踩过：原先写 calc(14px * var(--iu-text-scale, 1))——只要字号轴变量',
  '     求值失效（宿主 --dsh-content-font-size 是脏值时，calc 里出现非法量纲，',
  '     整个 --iu-text-scale 变成 guaranteed-invalid，而 var() 的第二参数只在',
  '     「未定义」时兜底、接不住 invalid），圆角就静默归零，四角变直角。',
  '     圆角是容器骨架，必须自带兜底且不依赖别的变量链。 */',
  '  /* 圆角轴对齐官方 --dsw-radius-lg（16px）：全站一个圆角语言，卡片不再自成一套。',
  '     盒阴影轴（--iu-sh-sm/md）已删除——它们从未被任何规则消费，是死变量；',
  '     现在抬升统一走 --dsw-elevation-stroke，不再需要独立阴影 token。 */',
  '  --iu-r-lg: calc(var(--dsw-radius-lg, 16px) * var(--iu-zoom, 1));',
  '  --iu-r-md: calc(var(--dsw-radius-sm, 8px) * var(--iu-zoom, 1)); }',
  '/*',
  ' * 容器：**正文的一部分，不再是「一块面板」**。',
  ' *',
  ' * 改之前它是一张独立卡：1px border-l3 + 18px 圆角 + bg-layer-1 面 + 0 8px 30px 投影。',
  ' * 落在总结卡（.dtt__card--reply，本身已有 1px 描边 + 14px 圆角 + 投影）里时是**三层',
  ' * 取景框**，眼睛直接读出「这块是嵌进去的」。实测（_tmp/card-probe.mjs）改造前嵌套态',
  ' * 计算值：border 1px / radius 18px / bg #232324（暗色，比底 #151517 亮两档）',
  ' * / shadow 0 10px 30px rgba(0,0,0,.55)。',
  ' *',
  ' * 现在**外框整个不要了**（不是变淡：变淡仍然是框）：',
  ' *  · 没有 border、没有圆角外框、没有投影 —— 卡片与正文之间只剩一条分隔线；',
  ' *  · 和 html 卡（.dtt-he 早已无框无影）用同一套「图注 + 细线 + 内容」语言；',
  ' *  · 上下留白并进正文节奏（12px），不再自带一圈「呼吸区」。',
  ' *',
  ' * ⚠ 横向 padding 必须为 0 且**不能再配圆角**：第一版保留 16px 圆角 + 0 横向 padding，',
  ' * 顶栏的细线在圆角内侧被切掉一截，标题文字直接压在线头上（实测截图可见）。',
  ' * 无框的容器不该有圆角 —— 圆角只在「有面」的时候才有意义。',
  ' */',
  '.dtt-iu {',
  '  position: relative; margin: 8px 0 10px;',
  '  border: 0; border-radius: 0;',
  '  padding: 2px 0 0;',
  '  background: none;',
  '  animation: dtt-iu-rise .34s cubic-bezier(.2,.8,.25,1) both;',
  '}',
  '@keyframes dtt-iu-rise {',
  '  from { opacity: .72; transform: translateY(3px) }',
  '  to { opacity: 1; transform: none }',
  '}',
  '/* 头 = 图注行（caption），不是标题栏。',
  ' *',
  ' * 融合第二版（2026-10-19）：上一版去掉了外框，但头部仍是「标题 + 一条横贯分隔线 + 10px 空档」——',
  ' * 那套语法读起来仍然是「一张表的表头」，卡片在正文里依旧自成一段。真正让它变自然的不是「更淡的框」，',
  ' * 而是**取消「这里开始是一个控件」这个信号本身**：',
  ' *  · 分隔线整条删掉（它是唯一剩下的「边界」残留）；',
  ' *  · 标题降成 caption（11px / 500 / label-caption），分量低于正文，读起来像「一张插图的图注」；',
  ' *  · 图注与内容之间只留 4px，和 markdown 的 <figcaption> 一个节奏。',
  ' * 这样卡片顶部不再是「一条线 + 一行标题」，而是「一行小字说明」——眼睛不会把它当成一个 panel。',
  ' * ⚠ 不要给它加回任何 border-bottom / 背景：线一回来，整张卡立刻退回「窗口」。 */',
  '.dtt-iu__head { display: flex; align-items: center; gap: 8px; margin: 0 0 4px;',
  '  padding: 0; min-height: 16px; }',
  '.dtt-iu__title { font-size: calc(11px * var(--iu-text-scale, 1)); font-weight: 500;',
  '  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, currentColor));',
  '  letter-spacing: .04em;',
  '  flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '/* 副说明：走 label-tertiary 令牌，不用 opacity —— opacity 会把文字往背景里混，',
  '   得到的是非法定中间色，暗色下发灰（实测旧值 opacity:.62 叠在 label-primary 上）。 */',
  '.dtt-iu__desc { font-size: calc(12px * var(--iu-text-scale, 1)); color: var(--dsw-alias-label-tertiary, currentColor);',
  '  margin: 0 0 10px; line-height: 1.6; }',
  '/* 卡片动作：只剩**全屏**一枚（缩放档位按钮已按用户要求整块移除）。',
  '   **藏进图注行**，平时完全不可见（opacity 0 + 不占位收缩），鼠标落到卡片上或',
  '   键盘聚焦才浮现。融合后的卡片没有「标题栏」这个容器了，按钮再挂着一圈描边',
  '   就是唯一一块「界面」残留，所以这里也去掉边框，只留图标本身。',
  '   ⚠ opacity 0 仍然占位（不给 display:none）：按钮要能被键盘 Tab 到，也要在',
  '   hover 时平滑浮现；display:none 会让它既不可聚焦也动不起来。 */',
  '.dtt-iu__acts { display: flex; align-items: center; gap: 2px; flex: none; opacity: 0;',
  '  transition: opacity .18s ease; }',
  '.dtt-iu:hover .dtt-iu__acts, .dtt-iu:focus-within .dtt-iu__acts { opacity: 1; }',
  '/* 触摸设备没有 hover：直接常显，否则这枚按钮永远点不到。 */',
  '@media (hover: none) { .dtt-iu__acts { opacity: .7; } }',
  '.dtt-iu__act { display: inline-flex; align-items: center; justify-content: center; gap: 3px;',
  '  min-width: 22px; height: 20px; padding: 0 5px;',
  '  border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer;',
  '  opacity: .55;',
  '  font: inherit; font-size: calc(10.5px * var(--iu-text-scale, 1)); font-weight: 600;',
  '  font-variant-numeric: tabular-nums; white-space: nowrap;',
  '  transition: opacity .18s ease, background-color .18s ease, transform .18s ease; }',
  '/* 正文内的控件不做位移（位移是「浮起」的语言，卡都融进正文了，' + "'" + '按钮再浮就更跳）；反馈靠底色。 */',
  '  .dtt-iu__act:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }',
  '  .dtt-iu__act:active { transform: scale(.94); }',
  '.dtt-iu__act:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 1px; }',
  '/* 窄屏：外层不再收横向 padding —— 容器已经和正文同宽（padding 只在纵向），',
  '   收窄反而让内容比正文窄一截，看起来像内嵌了个更小的东西。',
  '   各 kind 自己的横向布局降级留在各自 css 里。 */',
  '@media (max-width: 480px) {',
  '  .dtt-iu { padding: 2px 0 0; margin: 8px 0 10px; }',
  '}',
  '/* 流式占位：**一行小字 + 一个呼吸点**，居中、无框、无扫光条。',
  ' *',
  ' * 融合第二版（2026-10-19）：原来是「呼吸点 + 「正在生成交互卡片…」+ 扫光进度槽 + N 字」三行居中块，',
  ' * 高 84px —— 在正文里等于插入一块「加载中的组件」，而且文案在向用户解释内部机制。',
  ' * 现在收成一行：一句话 + 点，高度压到内容本身，读起来是「这段内容正在写」而不是「组件在构建」。 */',
  '.dtt-iu--pending { animation: dtt-iu-rise .34s cubic-bezier(.2,.8,.25,1) both; }',
  '.dtt-iu__stage--pending { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;',
  '  min-height: 0; padding: 2px 0 4px; }',
  '.dtt-iu__stage--pending .dtt-iu__pending-track { display: none; }',
  '.dtt-iu__pending { display: flex; align-items: center; gap: 9px; }',
  '/* 呼吸点走中性灰、不走品牌蓝：过渡态的指示器一旦上色，就变成「系统任务指示灯」，',
  '   而这里只是文字还没写完。 */',
  '.dtt-iu__pending-dot { width: 6px; height: 6px; border-radius: 50%; flex: none;',
  '  background: var(--dsw-alias-label-tertiary, rgba(127,127,127,.6));',
  '  animation: dtt-iu-breathe 1.4s ease-in-out infinite; }',
  '@keyframes dtt-iu-breathe { 0%, 100% { opacity: .3; transform: scale(.82) } 50% { opacity: 1; transform: scale(1) } }',
  '.dtt-iu__pending-text { font-size: calc(12px * var(--iu-text-scale, 1)); color: var(--dsw-alias-label-tertiary, currentColor); }',
  '.dtt-iu__pending-track { width: min(200px, 60%); height: 3px; border-radius: 999px; overflow: hidden;',
  '  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }',
  '.dtt-iu__pending-bar { display: block; width: 38%; height: 100%; border-radius: 999px;',
  '  background: linear-gradient(90deg, transparent, var(--dsw-alias-state-business-primary, #4176e6), transparent);',
  '  animation: dtt-iu-sweep 1.5s cubic-bezier(.4,0,.2,1) infinite; }',
  '@keyframes dtt-iu-sweep { 0% { transform: translateX(-110%) } 100% { transform: translateX(300%) } }',
  '/* 无障碍：关掉全部装饰动效，等待态留常亮反馈。',
  '   图表/琴键的状态反馈保留——那是反馈本身，不是装饰（见文件头纪律 2）。 */',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dtt-iu, .dtt-iu__panel, .dtt-iu__tkids, .dtt-iu__tl-body, .dtt-iu__progress i { animation: none; }',
  '  .dtt-iu__out:hover, .dtt-iu__chip:hover, .dtt-iu__tab:hover { transform: none; }',

  '  .dtt-iu__progress i, .dtt-iu__box, .dtt-iu__box svg, .dtt-iu__check, .dtt-iu__tab { transition: none; }',
  '  .dtt-iu__pending-dot { animation: none; opacity: .75; }',
  '  .dtt-iu__pending-bar { animation: none; transform: translateX(80%); opacity: .6; }',
  '  .dtt-iu-fs, .dtt-iu-fs__panel { animation: none; }',
  '}',
  '/* ── 全屏层（body 级 portal）────────────────────────────────────',
  '   为什么需要：看板 / 大表格 / 长清单在对话流那点宽度里根本铺不开，全屏是',
  '   这类「信息密度高」卡片的刚需。全屏层复用同一份 Body 与同一份 state ——',
  '   两边同时挂载、共享持久化状态，改一边另一边立刻同步。',
  '   ⚠ 曾经的卡片缩放档位（--iu-zoom 乘进 --iu-text-scale）已随缩放按钮一起',
  '   移除：--iu-zoom 只保留为「外部/截图链路可注入的备用轴」，组件自身恒为 1。 */',
  '.dtt-iu-fs { position: fixed; inset: 0; z-index: 2147483000;',
  '  display: flex; flex-direction: column;',
  '  background: var(--dsw-alias-bg-base, #fff);',
  '  animation: dtt-iu-fs-in .26s cubic-bezier(.2,.8,.25,1) both; }',
  '@keyframes dtt-iu-fs-in { from { opacity: .6; transform: scale(.99) } to { opacity: 1; transform: none } }',
  '.dtt-iu-fs__bar { display: flex; align-items: center; gap: 8px; flex: none;',
  '  padding: 10px 12px 10px 16px;',
  '  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.16)); }',
  '.dtt-iu-fs__title { font-size: calc(13px * var(--iu-text-scale, 1)); font-weight: 600; flex: 1; min-width: 0;',
  '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '.dtt-iu-fs__acts { display: flex; align-items: center; gap: 6px; flex: none; }',
  '.dtt-iu-fs__btn { border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.22));',
  '  background: transparent; color: inherit; font: inherit; cursor: pointer;',
  '  font-size: calc(11.5px * var(--iu-text-scale, 1)); border-radius: 8px; padding: 3px 11px;',
  '  white-space: nowrap; transition: opacity .18s ease, background-color .18s ease, transform .18s ease; }',
  '.dtt-iu-fs__btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }',
  '.dtt-iu-fs__btn:active { transform: translateY(0) scale(.96); }',
  '.dtt-iu-fs__btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 1px; }',
  '.dtt-iu-fs__stage { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 24px; }',
  '/* 全屏里的卡片：撑满可用宽度（字号仍走基座的 --iu-text-scale，不再有额外缩放）。',
  '   ⚠ 全屏层**不是正文**，这里要把「面」补回来：正文态刻意无框无面（见容器注释），',
  '   但全屏是一块独立的放大工作区，没有面就分不清内容边界，横向不补 padding',
  '   内容还会直接贴屏幕边缘。所以只在这一档给回 padding + 抬升笔画。 */',
  '.dtt-iu.dtt-iu--fs {',
  '  margin: 0 auto; max-width: 1180px; animation: none;',
  '  padding: 20px 24px 16px; border-radius: var(--dsw-radius-lg, 16px);',
  '  background: var(--dsw-alias-bg-base, transparent);',
  '  box-shadow: var(--dsw-elevation-stroke, 0 0 0 .5px var(--dsw-alias-border-l1, rgba(127,127,127,.16))); }',

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
