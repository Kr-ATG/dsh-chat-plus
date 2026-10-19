/**
 * dsh-chat-plus — HTML 卡片的最小设计系统（kit）。
 *
 * ## 为什么要有这个文件
 *
 * 卡片跑在 opaque origin 的 iframe 里，宿主什么都传不进去（除了 postMessage）。
 * 于是模型每次写卡片都要从零手搓一套视觉：圆角灰底 + 阴影 + 蓝色渐变按钮。
 * 十次里有九次搓不干净，结果就是「对话流里嵌进来一块面板」——**这正是
 * 生成式 UI 不融合的根源**，不是配色没对齐。
 *
 * 这里注入一套**极小的**基线：token + 少量类。目标不是做组件库，是让模型
 * 不写 CSS 也能得到与宿主同一套语言的结果。
 *
 * ## 三条硬纪律
 *
 *  1. **按需注入**。正文里一个 kit 标记都没出现就不注入（见 needsKit）：
 *     每张卡片多背 8KB 是无意义的开销，而绝大多数卡片是纯 SVG 或纯静态片段。
 *  2. **不做「卡片感」**。没有 .card 的圆角+底色+阴影三件套当默认——那正是
 *     用户当成 bug 追问过的「一块色差板子」。分组用发丝线与留白表达。
 *  3. **不引任何外部资源**。CSDN 白名单在这里不存在：字体、图标、图表库
 *     全部离线。图标走内联 SVG 符号表（见 ICON_SPRITE），不进 kit 的 CSS。
 *
 * ## 与 ZCode visualize 的关系
 *
 * 取材自 zai-org/ZCode 的 visualize skill（Apache-2.0）同一套设计纪律，
 * 但**重写而非搬运**：它的 visualize.css 是 30KB（含 carousel / form-range /
 * 完整组件库），这里按 DSH 卡片的实际用法裁到 8KB 量级，并去掉一切依赖
 * 宿主 CSS 变量代入的部分（沙箱里读不到）。
 */

/**
 * 设计 token：全部由宿主下发（见 bridge.ts 的 surface 通道）覆盖，这里的值
 * 只是**离线兜底**——第三方宿主、截图页、独立导出都不会推 surface。
 *
 * 变量名前缀统一 `--k-`，与宿主自己的 `--dsw-*` 不冲突，也不会被模型的
 * 样式意外命中。
 */
const KIT_TOKENS = [
  ':root{',
  /*
   * 安全内边距。
   *
   * bridge 的 BASE_STYLE 把 body 的 margin/padding 清零（那是为了让高度上报
   * 精确），于是模型不写 padding 时，卡片内容会**直接贴着卡片边缘**——实测
   * 截图里左右文字被裁掉半个字。这里给一个最小呼吸量，模型自己写 padding
   * 的优先级更高（本段无 !important）。
   */
  /*
   * 文字三档（与宿主 label-primary / secondary / caption 同层级）。
   *
   * 兜底值必须用 light-dark() 而不是写死深色：bridge 的基线样式已经按主题设了
   * html{color-scheme}，所以 light-dark() 在亮暗下各取一套。写死 #16181d 的后果
   * 实测过——宿主没下发 fg 时（截图页 / 第三方宿主），暗色卡片就是黑字压深底。
   */
  '--k-ink:var(--dsh-frame-fg,light-dark(#16181d,#f2f3f5));',
  '--k-ink-2:color-mix(in srgb,var(--k-ink) 62%,transparent);',
  '--k-ink-3:color-mix(in srgb,var(--k-ink) 40%,transparent);',
  // 结构线：永远比文字淡一档，不抢视线
  '--k-line:color-mix(in srgb,var(--k-ink) 12%,transparent);',
  '--k-line-2:color-mix(in srgb,var(--k-ink) 7%,transparent);',
  // 一个主色 + 三档派生。刻意只有一个：多色 = 对等节点各配一色 = 视觉噪音
  '--k-accent:var(--dsh-frame-accent,light-dark(#4a6cf7,#7c9cff));',
  '--k-accent-2:color-mix(in srgb,var(--k-accent) 62%,transparent);',
  '--k-accent-3:color-mix(in srgb,var(--k-accent) 34%,transparent);',
  // 中性填充（用于轨道 / 未选中块）
  '--k-fill:color-mix(in srgb,var(--k-ink) 6%,transparent);',
  /*
   * 字号轴：跟宿主，不写死。
   *
   * `--k-scale` 是**整体缩放系数**——所有非文字的固定尺寸（内边距 / 间隙 /
   * 条高 / 圆角）都乘它，这样用户把字号从 14 调到 22 时，卡片的形状比例不变、
   * 只是整体变大，而不是「字变大了但条还是细的」。
   *
   * ⚠ **除数必须带单位（14px，不是 14）**。CSS calc 里「长度 ÷ 数字 = 长度」，
   * 「长度 ÷ 长度 = 数字」。写成 /14 时该变量求值为 1px（长度），于是
   * `calc(30px * var(--k-scale))` 变成 px² —— 非法量纲，**整条声明被静默丢弃**，
   * 元素回退成初始值（条高塌成 0）。iu/styles.ts 踩过同一个坑，注释里记着。
   */
  '--k-fs:var(--dsh-frame-font-size,14px);',
  /*
   * 缩放系数的取值来源要注意**继承方向**：CSS 自定义属性只向下继承。
   * 生产链路里 bridge 把 --dsh-frame-font-size 设在 documentElement（=html），
   * :root 正好在同一元素上，读得到。但如果哪天有人把它挂在 body（测试页、
   * 第三方宿主），:root 就再也读不到，scale 恒为 1、整套尺寸退化成写死 px。
   *
   * 所以这里做两层：:root 定义（生产主路径），body 再重算一次（兜住挂在 body
   * 上的宿主）。body 那份会覆盖 :root 的继承值，两类宿主都对。
   */
  '--k-scale:calc(var(--k-fs) / 14px);',
  '--k-fs-sm:calc(var(--k-fs) * .93);',
  '--k-fs-xs:calc(var(--k-fs) * .85);',
  /*
   * 跟随缩放的尺寸：内边距 / 间隙 / 条高 / 圆角。
   * 刻意**不跟随**的两类（见各自声明处的说明）：
   *  · 结构线（1px / 2px 描边）——放大会变成粗框，那是控件语言；
   *  · 网格断点（minmax 的最小宽度）——跟着字号放大会让宽屏更早堆叠，
   *    属于「布局该稳」的部分，不该随阅读偏好抖动。
   */
  '--k-pad:calc(16px * var(--k-scale));',
  '--k-gap:calc(16px * var(--k-scale));',
  '--k-gap-sm:calc(8px * var(--k-scale));',
  '--k-radius:calc(10px * var(--k-scale));',
  '}',
].join('')

/**
 * 类库：只收「卡片里高频、且模型手搓必翻车」的那一批。
 *
 * 入选判据（三条都要过）：
 *  · 高频 —— 90% 的图表/数据卡片都会用到；
 *  · 手搓易错 —— 模型自己写十次有两次忘了 tabular-nums / reduced-motion；
 *  · 无结构耦合 —— 一个类只做一件事，不会把模型锁进某种 DOM 结构。
 *
 * 刻意**不收**：按钮、表单、tab、tooltip。前三者 DSH 卡片里出现频率极低
 * （卡片是「看」的不是「填」的），后者需要 JS 运行时，属于 P2。
 */
const KIT_CLASSES = [
  /*
   * 根容器内边距：给 body 兜一层最小呼吸量（见 --k-pad 的说明）。
   * 只作用在 body 上，不包一层额外 div——卡片是正文，不该多一层结构。
   */
  /*
   * 根容器：内边距 + 正文色。
   *
   * **`color` 是必须的**，不是补丁：BASE_STYLE 只写了 `color:var(--dsh-frame-fg,inherit)`，
   * 宿主没下发 fg 时（截图页 / 第三方宿主）就一路 inherit 到浏览器默认黑。
   * 亮色下看不出来，暗色下就是黑字压深底——实测踩过。`var(--k-ink)` 自带
   * light-dark() 兜底，两种主题都可读。
   */
  'body{padding:var(--k-pad);color:var(--k-ink);',
  /*
   * 兜住「宿主把字号变量挂在 body 上」的情形（见 :root 里 --k-scale 的说明）。
   *
   * ⚠ **绝不能写成 `--k-fs:var(--dsh-frame-font-size,var(--k-fs))`**。
   * 那是对自身的引用：CSS 规范规定自定义属性的循环引用无效，整条声明变成
   * guaranteed-invalid，而 invalid 的自定义属性**在继承时也是 invalid**——
   * 于是 body 及其所有后代（.k-tabs / .k-bar / .k-track …）拿到的
   * `--k-scale` 全变成无效值，所有 `calc(20px * var(--k-scale))` 声明被丢弃，
   * gap 回退成 normal、条高回退成 auto。
   * 实测表现：三个页签文字紧贴在一起（用户 2026-10-20 截图反馈）。
   *
   * 正确做法：先继承上一层的实际值（`:root` 继承下来的 --k-fs），只在它缺失
   * 时才用宿主值兜底——用 `initial` 参与 fallback 也不行，同样是循环。
   * 这里用另一条独立变量名承接，避免自引用。
   */
  '--k-fs-host:var(--dsh-frame-font-size,14px);',
  '--k-fs:var(--k-fs-host);--k-scale:calc(var(--k-fs) / 14px)}',

  /* ── 排版 ── */
  // 标题：只有一个主标题时用；卡片标题已由宿主标题栏承担，正文里别重复
  '.k-title{margin:0 0 .35em;font-size:1.2em;line-height:1.35;font-weight:600;letter-spacing:-.01em}',
  // 副标题 / 一句话结论
  '.k-lede{margin:0 0 1.3em;color:var(--k-ink-2);font-size:.94em;line-height:1.6}',
  // 章节小标题（数据卡里常有「构成 / 变化 / 明细」三段）
  '.k-h{margin:1.4em 0 .5em;font-size:.9em;font-weight:500;color:var(--k-ink-2);letter-spacing:.02em}',
  '.k-muted{color:var(--k-ink-2)}',
  '.k-dim{color:var(--k-ink-3)}',
  // 数字：等宽对齐。模型几乎不会主动加这条，而它决定了一列数字能不能读
  '.k-num{font-variant-numeric:tabular-nums}',
  '.k-fs-sm{font-size:var(--k-fs-sm)}',
  '.k-fs-xs{font-size:var(--k-fs-xs)}',

  /* ── 结构（用线与留白，不用面板） ── */
  // 发丝线分隔：这是卡片里唯一合法的「分组边界」表达
  '.k-rule{height:0;margin:1.1em 0;border:0;border-top:1px solid var(--k-line)}',
  // 键值行：左边标签右边值，值右对齐等宽
  '.k-kv{list-style:none;margin:0;padding:0}',
  '.k-kv>li{display:grid;grid-template-columns:1fr auto;gap:var(--k-gap);',
  'align-items:baseline;padding:.62em 0;border-top:1px solid var(--k-line-2)}',
  '.k-kv>li:first-child{border-top:0}',
  '.k-kv dt,.k-kv .k-k{min-width:0;font-size:.96em}',
  '.k-kv dd,.k-kv .k-v{margin:0;text-align:right;white-space:nowrap;',
  'font-variant-numeric:tabular-nums;font-weight:500}',

  /* ── 图元 ── */
  // 堆叠条：比例构成。用 flex-grow 分配，不靠百分比手算
  '.k-bar{display:flex;gap:2px;height:var(--k-bar-h,calc(30px * var(--k-scale)));',
  'border-radius:var(--k-radius);',
  'overflow:hidden;background:var(--k-fill)}',
  '.k-bar>span{flex:var(--n,1) 1 0;min-width:0;height:100%;transform-origin:left center}',
  /*
   * 单条进度：不用 border 描边（描边会把条读成控件）。
   *
   * `display:block` 是必须的：它常被当成 flex 子项放进一列里，默认的
   * `display:inline-block` 会让它按内容宽度收缩，满宽轨道被拉成一小截
   * （实测：两根轨道长度不一致，看着像数据画错了）。
   */
  '.k-track{display:block;height:calc(6px * var(--k-scale));border-radius:99px;',
  'background:var(--k-fill);',
  'overflow:hidden}',
  '.k-track>span{display:block;height:100%;width:var(--p,0%);border-radius:inherit;background:var(--k-accent)}',
  /*
   * 色标：跟着 bar 用，小方块 + 一眼看懂的色阶。
   *
   * **可悬停热区必须比视觉方块大**：视觉上只有 .65em（约 9px），那是排版需要；
   * 但作为 data-tooltip 的触发区太小，鼠标要瞄好几下才停得上去。用 padding +
   * 负 margin 把命中区撑到约 24px，视觉尺寸不变（background-clip:content-box）。
   */
  '.k-swatch{display:inline-block;width:.65em;height:.65em;',
  'border-radius:calc(2.5px * var(--k-scale));',
  'margin:-.55em .35em -.55em -.55em;padding:.55em;box-sizing:content-box;',
  'vertical-align:baseline;background-clip:content-box}',
  /*
   * 用 background-color 而不是 background 简写：简写会把 .k-swatch 的
   * background-clip:content-box 重置成 border-box，色块立刻撑满整个 padding
   * 区域，热区方案就白做了（视觉方块变成 24px 大）。
   */
  '.k-a1{background-color:var(--k-accent)}',
  '.k-a2{background-color:var(--k-accent-2)}',
  '.k-a3{background-color:var(--k-accent-3)}',
  '.k-a4{background-color:var(--k-fill)}',

  /* ── 标签页 ── */
  /*
   * 配合 runtime.ts 的 tabs 接管（点击 + 方向键 + aria-selected）。
   *
   * **选中态必须有可见反馈**：验收截图里两个 tab 长得一模一样，完全看不出
   * 当前在哪个——运行时的 aria-selected 对了，但视觉没跟上，等于白做。
   * 用底部 2px 主色条而不是填充块：填充会让「一组 tab」看起来像「一组按钮」。
   */
  '.k-tabs{display:flex;gap:calc(20px * var(--k-scale));margin:0 0 1em;',
  'border-bottom:1px solid var(--k-line)}',
  '.k-tabs>button{appearance:none;border:0;background:none;padding:0 0 .55em;',
  'font:inherit;font-size:.96em;color:var(--k-ink-2);cursor:pointer;',
  'border-bottom:2px solid transparent;margin-bottom:-1px;',
  'transition:color .16s ease,border-color .16s ease}',
  '.k-tabs>button:hover{color:var(--k-ink)}',
  '.k-tabs>button:focus-visible{outline:2px solid var(--k-accent);outline-offset:2px;',
  'border-radius:2px}',
  '.k-tabs>button[aria-selected="true"],.k-tabs>button.active{',
  'color:var(--k-ink);font-weight:500;border-bottom-color:var(--k-accent)}',
  '@media (prefers-reduced-motion:reduce){.k-tabs>button{transition:none}}',

  /* ── 网格 ── */
  // 自适应多列，窄了自动堆叠。注意：这是**布局**，不是卡片
  '.k-grid{display:grid;gap:0 calc(28px * var(--k-scale));',
  'grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}',
  /*
   * align-items:start 让每栏各自按内容高度排——默认的 stretch 会把两栏拉到
   * 等高，短的那栏底部留一大片空，看着像「内容掉到中间」。实测踩过。
   */
  '.k-cols{display:grid;gap:calc(20px * var(--k-scale)) calc(32px * var(--k-scale));align-items:start;',
  'grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}',

  /* ── 入场动效（一次性，不循环） ── */
  '.k-rise{animation:k-rise .55s cubic-bezier(.22,.61,.36,1) both;',
  'animation-delay:calc(var(--i,0) * 80ms)}',
  '.k-grow{animation:k-grow .8s cubic-bezier(.22,.61,.36,1) both;',
  'transform-origin:left center;animation-delay:calc(var(--i,0) * 90ms)}',
  '@keyframes k-rise{from{opacity:0;transform:translateY(calc(7px * var(--k-scale)))}',
  'to{opacity:1;transform:none}}',
  '@keyframes k-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}',

  // 无障碍与截图：动效全部可关（截图管线会注入 SETTLE_STYLE 同理）
  '@media (prefers-reduced-motion:reduce){',
  '.k-rise,.k-grow{animation:none!important}}',

  // SVG 里的文字必须继承主题色，否则暗色下是黑字压深底
  'svg text{fill:currentColor}',
].join('')

/**
 * 完整的 kit 样式块（`<style>` 内容）。
 *
 * 注入位置刻意放在 `<head>` **最前面**：模型的样式表理应能盖掉它，
 * kit 只是「不写 CSS 时的合理默认」，不是必须遵守的规范。
 */
export const KIT_CSS = KIT_TOKENS + KIT_CLASSES

/**
 * 判断这张卡片要不要注入 kit。
 *
 * **只认 `k-` 前缀的类名与 token**，不做通用启发式：正文里出现 `class="k-bar"`
 * 或 `var(--k-accent)` 才注入。理由：
 *  · 误判代价不对称——漏注入 = 类名失效（用户看到一张平淡但能读的卡），
 *    误注入 = 每张卡多背 8KB（纯浪费）。所以宁可偏保守但要准；
 *  · 不做 `includes('class=')` 这种判据：几乎每张卡都有 class，等于永远注入。
 *
 * @param html - 围栏正文（未包装）。
 * @returns 正文是否用到 kit。
 */
export function needsKit(html: string): boolean {
  // `k-` 后面必须跟字母：避免把 `k-9`、`--k` 这类误判成 kit 类名。
  return /\bk-[a-z]|--k-[a-z]/.test(html)
}
