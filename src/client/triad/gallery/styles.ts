/**
 * dsh-chat-plus — 多媒体画廊样式（注入式，DSH 原生 token，暗/亮主题自适应）。
 *
 * 视觉骨架沿用工作台既有语言（与记忆 / 邮箱面板同一套 token 与圆角节奏），
 * 动效按「渐进式微调」原则加：卡片入场级联上浮、hover 提亮浮起、骨架屏微光
 * 扫动、类别徽标下滑浮现、时间轴竖轨自上而下生长 + 日期节点弹出 + 分组逐段
 * 浮入、时间筛选弹层缩放淡入。全部动画尊重 prefers-reduced-motion（只关动画，
 * 不动布局）。
 *
 * 2026-10-19：插件自己的 Lightbox（tg-lb__* / tg-paged__*）整块删除 —— 预览
 * 一律交官方右侧栏（用户点名「全部用官方的侧边栏查看」）。那一族样式没有别的
 * 使用者，留着只会让后来的人以为还有第二个弹窗。
 *
 * ⚠ 注入式 CSS 的正文与注释里都不能出现反引号（模板字面量会提前闭合，
 * 整张表静默变 false —— build.mjs 的 assertInjectedCssStrings 会拦，别去撞它）。
 */

const STYLE_ID = 'dsh-triad-gallery-styles'

const SHEET = `
.tg-root{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;position:relative}

/* ── 工具条右侧工具组（时间 / 视图 / 分类 / 数量 / 刷新）────────────
   整组 margin-left:auto 贴右；组内自带 flex-wrap + justify-content:flex-end，
   窄屏折行时后续行也贴右（原先各元素散在工具条里，折行后会被甩到左边）。
   顺序即 DOM 顺序：分类在前、数量与刷新在后（用户 2026-10 要求）。 */
.tg-tools{flex:none;display:flex;align-items:center;justify-content:flex-end;
  gap:10px;flex-wrap:wrap;margin-left:auto;min-width:0}

/* ── 工具条：搜索 + 时间筛选 + 视图切换 + 数量 + 刷新 ───────────── */
.tg-toolbar{flex:none;display:flex;align-items:center;gap:10px;padding:8px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));background:transparent;flex-wrap:wrap}

/* ── 类别筛选 chips（2026-10 简化：图标 + 文字 + 数字，仅此三样）─────
   基础形态就是一枚素胶囊；工作台作用域（hub/theme.ts）再覆写配色。
   简化时一并删掉了三个已不再渲染的装饰层：图标盒（圆角方底 + 描边）、
   悬浮计数角标、选中态圆点；它们的样式与 reduced-motion 引用都已清理干净。
   也删掉了原「底部悬浮 Dock」的绝对定位（absolute / bottom / 50% / 毛玻璃底 /
   阴影 / 入场动画）——它现在就是工具条里的一个普通 flex 子项。 */
.tg-dock{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px}
/* 芯片本体是 div（外层做布局与 data 态），真正的「选中这个分类」是里面那枚
   .tg-kind__pick —— 之所以不是单个 button：确认态里要放「确认/取消」两枚真按钮，
   而 button 不能嵌套 button。视觉上两者合一，用户看到的仍是一枚胶囊。 */
.tg-dock__item,.tg-kind{display:inline-flex;align-items:center;justify-content:center;gap:5px;
  padding:4px 10px;border-radius:999px;border:none;background:transparent;
  color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;user-select:none;outline:none;
  font-family:inherit;font-size:12px;line-height:18px;
  transition:background 280ms cubic-bezier(.32,.72,0,1),color 280ms cubic-bezier(.32,.72,0,1),padding-right 200ms cubic-bezier(.16,1,.3,1)}
.tg-kind__pick{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0;border:none;
  background:transparent;color:inherit;font-family:inherit;font-size:inherit;line-height:inherit;
  cursor:pointer;outline:none}
.tg-kind__pick:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px;border-radius:999px}
.tg-kind__pick:disabled{cursor:default}
.tg-dock__item:hover,.tg-kind:hover{color:var(--dsw-alias-label-primary,#111827)}
.tg-dock__item:active,.tg-kind:active{transform:scale(.97)}
.tg-dock__item:focus-visible,.tg-kind:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px}

.tg-dock__item[data-active="true"],.tg-kind[data-active="true"]{color:var(--dsw-alias-label-primary,#111827);font-weight:600}

.tg-dock__label{font-size:11px;line-height:14px;font-weight:500;white-space:nowrap;letter-spacing:.01em}
.tg-dock__item[data-active="true"] .tg-dock__label,.tg-kind[data-active="true"] .tg-dock__label{font-weight:600}
/* 计数：真实数字（2026-10-16 起不再做两位数的近似显示）。
   tabular-nums + nowrap 让 4~5 位数不换行；数字等宽，位数变多只是让胶囊变宽，
   超长时由 .tg-dock 的 flex-wrap 换行，不截断、不缩写 —— 用户问的就是这个数。 */
.tg-dock__num{font-size:10.5px;line-height:14px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#888);
  white-space:nowrap;font-feature-settings:"tnum" 1}

/* ── 分类芯片上的删除键（2026-10-16 新增：分类级删除）─────────────
   手感与 kr-chat 的 kr-memory__act 同一套：常态淡出并右移 3px，指针落到芯片上
   或键盘聚焦时才浮现归位 —— 破坏性操作不该在工具条里常驻抢注意力。
   与 kr-chat 的两处**刻意差异**：
   ① 这里不能只靠 :hover。触摸屏没有 hover 通路，hover-only 等于「永远点不到」，
      所以按 B3 走三档可见性兜底：触屏（hover:none）常显 / 键盘聚焦浮现 /
      当前选中分类常显。
   ② 隐藏态**只用 opacity + pointer-events**，不用 display:none，也不用
      visibility:hidden —— 后两者会把元素移出可聚焦序列，键盘用户 Tab 一辈子
      也到不了它（可见性依赖动画/隐藏的经典坑）。opacity:0 的元素仍可聚焦，
      一旦聚焦 :focus-visible 就把它显出来。 */
.tg-kind__del{display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:16px;height:16px;padding:0;margin-left:-1px;border:none;border-radius:5px;
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;
  opacity:0;pointer-events:none;
  transition:opacity 160ms ease,transform 200ms cubic-bezier(.16,1,.3,1),background 150ms ease,color 150ms ease;
  transform:translateX(3px)}
.tg-kind:hover .tg-kind__del,
.tg-kind__del:focus-visible,
.tg-kind[data-active="true"] .tg-kind__del{opacity:1;pointer-events:auto;transform:translateX(0)}
.tg-kind__del:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 12%,transparent);color:var(--dsw-alias-state-error-primary,#dc2626)}
.tg-kind__del:active{transform:scale(.88)}
.tg-kind__del:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:1px}
/* 空分类：删除键仍在位（布局不跳）但不可点，且不被 hover 浮现规则点亮 ——
   一枚"点了什么也不会发生"的垃圾桶比没有垃圾桶更糟。 */
.tg-kind__del:disabled{opacity:0!important;pointer-events:none;cursor:default}
.tg-kind:hover .tg-kind__del:disabled{opacity:0!important}
/* 触屏常显（没有 hover 就没有浮现通路） */
@media (hover:none){.tg-kind__del{opacity:.75;pointer-events:auto;transform:none}}

/* 确认态：删除键那一下之后，芯片**原地**换成问题 + 确认 / 取消。
   芯片本身撑宽一点（padding-right 让步），读起来像同一枚胶囊在展开，而不是
   旁边凭空多出一截 UI。
   两处 !important 是必要的：工作台主题（hub/theme.ts）用 !important 覆写了
   .tg-dock__item 的 padding 与 background，普通优先级在这里赢不了它，确认态
   的底色与内距会被吃回去（看起来就像"点了没反应"）。 */
.tg-kind[data-confirm="true"]{gap:6px;padding-right:6px!important;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 9%,transparent)!important}
.tg-kind[data-confirm="true"] .tg-kind__pick,
.tg-kind[data-busy="true"] .tg-kind__pick{color:var(--dsw-alias-label-primary,#111827)}
.tg-kind__confirm{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;animation:tg-kind-confirm-in 180ms cubic-bezier(.16,1,.3,1)}
@keyframes tg-kind-confirm-in{from{opacity:0;transform:translateX(4px)}to{opacity:1;transform:translateX(0)}}
.tg-kind__ask{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums}
/* 「不可恢复」是确认态里唯一不可省的语义（删的是磁盘文件），所以它**不能**被
   省略号截掉、也不能靠 title：小一号 + 告警色让它退到问句之后当附注，但仍与
   问句连读成一句完整的话，触屏与键盘用户一眼可见。
   刻意不写 overflow:hidden / text-overflow：那会把这四个字本身裁掉，等于回到
   "后果只有鼠标用户看得到"的老问题。宽度不够时由外层降字号承担（见下面的窄屏档）。 */
.tg-kind__warn{margin-left:4px;font-size:10px;color:var(--dsw-alias-state-error-primary,#dc2626);font-weight:600}
.tg-kind__yes,.tg-kind__no{display:inline-flex;align-items:center;height:17px;padding:0 7px;border-radius:9px;
  border:1px solid transparent;font-family:inherit;font-size:10.5px;font-weight:600;line-height:1;cursor:pointer;
  transition:background 140ms ease,color 140ms ease,transform 130ms cubic-bezier(.2,.8,.2,1)}
.tg-kind__yes{background:var(--dsw-alias-state-error-primary,#dc2626);color:#fff}
.tg-kind__yes:hover{filter:brightness(1.1);transform:translateY(-1px)}
.tg-kind__yes:active{transform:translateY(0) scale(.95)}
.tg-kind__yes:disabled{opacity:.55;cursor:default;transform:none;filter:none}
.tg-kind__no{background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.tg-kind__no:hover{color:var(--dsw-alias-label-primary,#111827);background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 8%,transparent)}
.tg-kind__no:active{transform:scale(.95)}
.tg-kind__yes:focus-visible,.tg-kind__no:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:1px}
/* 窄屏兜底：确认态比常态芯片宽（多了「不可恢复」四个字 + 两枚按钮），手机上再叠
   一层字号与内距收缩。按 169 项这个最长现实值估算：常规档约 202px，这一档约
   182px —— 落在最窄手机视口（320px）内，不会把工具条撑出横向滚动。
   收缩的是**字号与留白**，不是省略号：语义一个字都不能少（见上面的说明）。
   工具条本身是 flex-wrap，所以即便真的放不下，也是整体换行而不是溢出。 */
@media (max-width:640px){
  .tg-kind[data-confirm="true"]{gap:5px;padding-right:5px!important}
  .tg-kind__confirm{gap:4px}
  .tg-kind__ask{font-size:10px}
  .tg-kind__warn{font-size:9.5px;margin-left:3px}
  .tg-kind__yes,.tg-kind__no{height:16px;padding:0 6px;font-size:10px}
}

/* 删除中：芯片禁止重复点击，整枚胶囊轻微脉冲 —— 用「还在动」表达请求在飞，
   而不是塞一枚转圈（工具条里转圈太多，已经有一个刷新的了）。
   pointer-events:none 只挡鼠标，键盘的 Enter 由内层 button 的 disabled 拦。 */
.tg-kind[data-busy="true"]{pointer-events:none;opacity:.72;background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent)!important}
.tg-kind[data-busy="true"] .tg-kind__confirm{animation:tg-kind-busy 1.1s ease-in-out infinite}
@keyframes tg-kind-busy{0%,100%{opacity:1}50%{opacity:.5}}

.tg-search{position:relative;flex:1;min-width:140px;max-width:400px;margin-left:0}
.tg-search__icon{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary,#888);pointer-events:none;display:flex}
.tg-search__input{width:100%;box-sizing:border-box;height:30px;padding:0 10px 0 28px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:transparent;color:var(--dsw-alias-label-primary,#111827);font-size:12px;font-family:inherit;outline:none;transition:border-color 140ms ease,box-shadow 140ms ease}
.tg-search__input:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 20%,transparent)}
.tg-search__input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.tg-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:8px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:color 140ms ease,background 140ms ease}
.tg-icon-btn:hover{color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent))}
.tg-icon-btn[data-spinning="true"] svg{animation:tg-spin 800ms linear infinite}
@keyframes tg-spin{to{transform:rotate(360deg)}}
.tg-count{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── 会话筛选行（选了某个会话时出现）───────────────────────────── */
.tg-session-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));animation:tg-fade-in 180ms ease}
.tg-session-bar__name{color:var(--dsw-alias-label-primary,#111827);font-weight:600;max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-session-clear{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:11px;border:none;background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent));color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px;font-family:inherit;cursor:pointer;transition:background 140ms ease,color 140ms ease}
.tg-session-clear:hover{background:var(--dsw-alias-bg-layer-3,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 12%,transparent));color:var(--dsw-alias-label-primary,#111827)}

/* ── 主体：滚动区 + 网格 ───────────────────────────────────────── */
.tg-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px 18px 96px;scrollbar-width:thin}
.tg-scroll::-webkit-scrollbar{width:8px}
.tg-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:4px}
.tg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
@media (max-width:640px){.tg-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}}

/* ── 卡片 ──────────────────────────────────────────────────────── */
.tg-card{position:relative;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));cursor:pointer;overflow:hidden;padding:0;text-align:left;font-family:inherit;color:inherit;transition:transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms ease,border-color 180ms ease;animation:tg-card-in 320ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-i,0) * 22ms)}
.tg-card:hover{transform:translateY(-3px);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.28));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary,#000) 12%,transparent)}
.tg-card:active{transform:translateY(-1px) scale(.985)}
.tg-card:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px}
@keyframes tg-card-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.tg-card__thumb{position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent));display:flex;align-items:center;justify-content:center}
.tg-card__img{width:100%;height:100%;object-fit:cover;transition:transform 320ms cubic-bezier(.2,.8,.2,1),opacity 240ms ease;opacity:0}
.tg-card__img[data-loaded="true"]{opacity:1}
.tg-card:hover .tg-card__img{transform:scale(1.045)}
.tg-card__icon{color:var(--dsw-alias-label-tertiary,#888);transition:transform 220ms cubic-bezier(.2,.8,.2,1),color 220ms ease}
.tg-card:hover .tg-card__icon{transform:scale(1.08);color:var(--dsw-alias-label-secondary,#6b7280)}
/* 不用 backdrop-filter：时间轴 80+ 徽标各建 backdrop root，滚动时整页重采样掉帧；
   实底半透明 + 细边在缩略图上观感等价。 */
.tg-card__kind-dot{position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:9px;font-size:10px;font-weight:600;letter-spacing:.02em;color:#fff;background:rgba(15,17,23,.76);border:1px solid rgba(255,255,255,.16);opacity:0;transform:translateY(-3px);transition:opacity 180ms ease,transform 180ms ease;pointer-events:none}
.tg-card:hover .tg-card__kind-dot{opacity:1;transform:translateY(0)}
/* 「N 张」计数徽标：留在**左上角**（类型标签已挪到右上角，两者不再撞车）。
   计数是「这张卡里有几张」的量词，属于附加信息；类型才是主信息，占右上主位。 */
.tg-card__count{position:absolute;top:8px;left:8px;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:9px;font-size:10px;font-weight:600;letter-spacing:.02em;color:#fff;background:rgba(15,17,23,.76);border:1px solid rgba(255,255,255,.16);opacity:0;transform:translateY(-3px);transition:opacity 180ms ease,transform 180ms ease;pointer-events:none}
.tg-card:hover .tg-card__count{opacity:1;transform:translateY(0)}
/* 方格变体的徽标 / 快捷点尺寸统一在下面「时间轴视图」段落里定义（2026-10-24 归一），
   这里不再各写一份，改尺寸只改一处。 */
/* 「就地预览」快捷点（2026-10-20）。
   卡片的主语义换成了「用默认应用打开」，但浏览时不该被迫为每张图开一个外部窗口 ——
   这枚眼睛只负责「在这里看看」。hover / focus-within 浮现，平时不占视觉；
   缩略图角落铺一层模糊底，压在任意颜色的图上都读得清。 */
.tg-card__peek{position:absolute;right:8px;bottom:8px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;color:#fff;background:rgba(15,17,23,.72);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);opacity:0;transform:translateY(4px) scale(.94);transition:opacity 180ms ease,transform 220ms cubic-bezier(.2,.8,.2,1),background 160ms ease;cursor:pointer;z-index:2}
.tg-card:hover .tg-card__peek,.tg-card:focus-within .tg-card__peek{opacity:1;transform:translateY(0) scale(1)}
.tg-card__peek:hover{background:rgba(15,17,23,.9);border-color:rgba(255,255,255,.32)}
.tg-card__peek:active{transform:scale(.92)}
.tg-card__peek svg{pointer-events:none}
.tg-card__meta{display:flex;flex-direction:column;gap:2px;padding:8px 10px 10px;min-width:0}
.tg-card__name{font-size:12px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-primary,#111827);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__sub{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#888);display:flex;align-items:center;gap:6px;min-width:0}
.tg-card__sub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-card__play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.tg-card__play svg{filter:drop-shadow(0 2px 8px rgba(0,0,0,.5));opacity:.92;transition:transform 200ms cubic-bezier(.2,.8,.2,1)}
.tg-card:hover .tg-card__play svg{transform:scale(1.12)}

/* ── 分类删除的卡片退场（2026-10-16）──────────────────────────────
   分类级删除是「整批一起走」，所以逐条淡出 + 轻微下沉缩放，靠内联的
   animation-delay 错峰（见 GalleryPanel 的 delStaggerMs），读起来是「一条条
   被抹掉」而不是整块闪没 —— 与 kr-chat 一键删记忆的 kr-memory-row-out 同款手感，
   只是这里的卡片更大、位移收得更小（网格里横向抖一下会很晃）。
   animation-fill-mode:both 保证 delay 期间也是首帧（opacity 1），不会提前消失。 */
.tg-card--out{animation:tg-card-out 260ms cubic-bezier(.4,0,1,1) both;pointer-events:none}
@keyframes tg-card-out{
  from{opacity:1;transform:translateY(0) scale(1)}
  to{opacity:0;transform:translateY(6px) scale(.94)}
}

/* ── 骨架屏（加载态）────────────────────────────────────────────── */
.tg-skel{border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));overflow:hidden;animation:tg-card-in 260ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-i,0) * 30ms)}
.tg-skel__thumb{width:100%;aspect-ratio:4/3;position:relative;overflow:hidden;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent))}
.tg-skel__thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent) 45%,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 7%,transparent) 55%,transparent 80%);transform:translateX(-100%);animation:tg-shimmer 1.4s ease-in-out infinite}
@keyframes tg-shimmer{to{transform:translateX(100%)}}
.tg-skel__line{height:10px;margin:10px;border-radius:5px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent));position:relative;overflow:hidden}
.tg-skel__line::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent) 50%,transparent 80%);transform:translateX(-100%);animation:tg-shimmer 1.4s ease-in-out infinite}
.tg-skel__line--short{width:55%}

/* ── 空态 / 错误态 ─────────────────────────────────────────────── */
.tg-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 24px;color:var(--dsw-alias-label-tertiary,#888);animation:tg-fade-in 240ms ease}
.tg-empty__icon{opacity:.5;animation:tg-float 3.2s ease-in-out infinite}
@keyframes tg-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.tg-empty__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280)}
.tg-empty__hint{font-size:12px;text-align:center;max-width:42ch;line-height:1.7}
@keyframes tg-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

/* ── stale 提示条 ───────────────────────────────────────────────── */
.tg-stale{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));animation:tg-fade-in 200ms ease}
.tg-stale__dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#888);animation:tg-pulse 1.4s ease-in-out infinite;flex:none}
@keyframes tg-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}

/* ── 删除失败提示行（2026-10-16）──────────────────────────────────
   落在工具条下方、筛选条上方：删除是工具条上的动作，结果就近显示在同一视野里。
   与 .tg-stale 同高同内距（前后不跳版），但用告警色区分「只是慢」与「真出了事」。
   文案必须带条数与首条原因 —— 失败条目仍留在清单里，这行是它们的解释。 */
.tg-del-error{flex:none;display:flex;align-items:center;gap:8px;padding:6px 18px;font-size:11.5px;
  color:var(--dsw-alias-label-primary,#111827);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 8%,transparent);
  border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 24%,transparent);
  animation:tg-fade-in 180ms ease}
.tg-del-error__icon{display:flex;flex:none;color:var(--dsw-alias-state-error-primary,#dc2626)}
.tg-del-error__text{flex:1;min-width:0;word-break:break-word}
.tg-del-error__close{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 26%,transparent);
  background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-family:inherit;font-size:11px;cursor:pointer;
  transition:background 140ms ease,color 140ms ease}
.tg-del-error__close:hover{color:var(--dsw-alias-label-primary,#111827);background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 8%,transparent)}

/* ── 时间筛选钮 + 预设弹层 ──────────────────────────────────────── */
/* 注意：这里**不再**用 margin-left:auto —— 贴右已由外层 .tg-tools 承担；
   留在组内会把时间钮之后的分类/数量/刷新推到组外，顺序就散了。 */
.tg-time{position:relative;display:flex;align-items:center;flex:none}
.tg-time__btn{display:inline-flex;align-items:center;justify-content:center;height:28px;width:auto;padding:0 9px;gap:6px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;transition:color 140ms ease,background 140ms ease,border-color 140ms ease}
.tg-time__btn:hover{color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent))}
.tg-time__btn[data-active="true"]{color:var(--dsw-alias-state-business-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 24%,transparent);font-weight:600}
.tg-time__badge{font-size:11px;font-weight:600;white-space:nowrap;max-width:14ch;overflow:hidden;text-overflow:ellipsis}
.tg-time-pop{position:absolute;top:calc(100% + 8px);left:0;z-index:40;width:296px;padding:12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));box-shadow:0 12px 36px color-mix(in srgb,var(--dsw-alias-label-primary,#000) 18%,transparent),0 2px 8px rgba(0,0,0,.06);transform-origin:top left;animation:tg-pop-in 170ms cubic-bezier(.2,.8,.2,1)}
@keyframes tg-pop-in{from{opacity:0;transform:translateY(-6px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
.tg-time-pop__presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.tg-time-pop__preset{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;font-family:inherit;cursor:pointer;text-align:left;transition:color 140ms ease,background 140ms ease,border-color 140ms ease,transform 120ms cubic-bezier(.2,.8,.2,1)}
.tg-time-pop__preset:hover{color:var(--dsw-alias-label-primary,#111827);background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent));transform:translateY(-1px)}
.tg-time-pop__preset:active{transform:translateY(0) scale(.97)}
.tg-time-pop__preset[data-active="true"]{color:var(--dsw-alias-state-business-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 30%,transparent);font-weight:600}
.tg-time-pop__custom{margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));display:flex;flex-direction:column;gap:7px}
.tg-time-pop__custom-label{font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary,#888)}
.tg-time-pop__custom-row{display:flex;align-items:center;gap:6px}
.tg-time-pop__date{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent));color:var(--dsw-alias-label-primary,#111827);font-size:11.5px;font-family:inherit;outline:none;transition:border-color 140ms ease,box-shadow 140ms ease}
.tg-time-pop__date:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 24%,transparent)}
.tg-time-pop__sep{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);flex:none}
.tg-time-pop__apply{flex:none;height:28px;padding:0 12px;border-radius:8px;border:none;background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:filter 140ms ease,transform 120ms cubic-bezier(.2,.8,.2,1)}
.tg-time-pop__apply:hover{filter:brightness(1.1);transform:translateY(-1px)}
.tg-time-pop__apply:active{transform:translateY(0) scale(.97)}

/* ── 搜索框内的时间命中标记 ─────────────────────────────────────── */
.tg-search__input[data-time-hit="true"]{padding-right:104px;border-color:var(--dsw-alias-state-business-primary,#3b82f6)}
.tg-search__time-tag{position:absolute;right:7px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;gap:4px;height:19px;padding:0 7px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 24%,transparent);color:var(--dsw-alias-state-business-primary,#3b82f6);font-size:10.5px;font-weight:600;white-space:nowrap;pointer-events:none;animation:tg-tag-in 200ms cubic-bezier(.2,.8,.2,1)}
@keyframes tg-tag-in{from{opacity:0;transform:translateY(-50%) translateX(6px) scale(.9)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}

/* ── 视图切换（网格 ⇄ 时间轴，对齐分段控制样式）─────────────────── */
.tg-view{flex:none;display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));box-sizing:border-box;position:relative}
.tg-view__btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:color 150ms ease,background 180ms cubic-bezier(.2,.8,.2,1),transform 150ms cubic-bezier(.2,.8,.2,1),box-shadow 150ms ease}
.tg-view__btn:hover{color:var(--dsw-alias-label-primary,#111827)}
.tg-view__btn:active{transform:scale(.92)}
.tg-view__btn[data-active="true"]{color:var(--dsw-alias-state-business-primary,#3b82f6);background:var(--dsw-alias-bg-layer-1,#fff);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary,#000) 10%,transparent)}

/* ── 时间筛选条 ─────────────────────────────────────────────────── */
.tg-time-bar{flex:none;display:flex;align-items:center;gap:8px;padding:7px 18px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 4%,transparent);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12));animation:tg-fade-in 200ms ease}
.tg-time-bar__icon{display:flex;color:var(--dsw-alias-state-business-primary,#3b82f6);animation:tg-clock-sway 3.6s ease-in-out infinite}
@keyframes tg-clock-sway{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-9deg)}75%{transform:rotate(9deg)}}
.tg-time-bar__name{color:var(--dsw-alias-label-primary,#111827);font-weight:600;max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── 时间轴视图 ─────────────────────────────────────────────────── */
/* 不用 content-visibility:auto：滚动时分组进出视口会触发整组重布局 + 组内
   lazy 图集中加载，实测掉到 43fps 且伴随 longtask 卡顿；去掉后 280+fps。
   屏外成本改由 img loading=lazy 单独承担。 */
.tg-day{position:relative;padding-left:22px;margin-bottom:2px;animation:tg-day-in 340ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms)}
@keyframes tg-day-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
/* 竖轨：自上而下生长 */
.tg-day::before{content:"";position:absolute;left:5px;top:4px;bottom:-2px;width:2px;border-radius:1px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.18));transform-origin:top;animation:tg-rail-grow 520ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms)}
.tg-day:last-child::before{bottom:auto;height:22px}
@keyframes tg-rail-grow{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}
/* 日期头：钉住 + 节点 */
/* 不 sticky：sticky 头在滚动期每帧参与合成重绘（实测掉 6fps）；日期头随内容滚走，
   分组感由竖轨节点承担。 */
.tg-day__head{position:relative;display:flex;align-items:center;gap:7px;padding:5px 10px 5px 0;margin-bottom:7px;animation:tg-fade-in 260ms ease backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms)}
.tg-day__dot{position:absolute;left:-20px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 3px var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));animation:tg-dot-pop 380ms cubic-bezier(.2,1.5,.4,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms + 60ms)}
@keyframes tg-dot-pop{from{opacity:0;transform:scale(0)}60%{opacity:1;transform:scale(1.35)}to{opacity:1;transform:scale(1)}}
.tg-day__label{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#111827);letter-spacing:.01em}
.tg-day__weekday{font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary,#888);padding:1.5px 7px;border-radius:7px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--dsw-alias-label-primary,#000) 5%,transparent));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}
.tg-day__count{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums}
.tg-day__rule{flex:1;height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.12));transform-origin:left;animation:tg-rule-in 420ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--tg-day-i,0) * 55ms + 90ms)}
@keyframes tg-rule-in{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
/* 手机相册式高密度方格：正方形缩略图铺满。
   2026-10-24 用户要求「所有格式的时间轴都变大一点」：最小列宽 150 → 182、
   gutter 10 → 14，格子整体放大约 21%（缩略图、图标、徽标、文件名同步加法，
   见下面 .tg-card--tile / .tg-tile__* 一组），保持方格比例不变。 */
.tg-day__tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(182px,1fr));gap:14px 14px}
@media (max-width:640px){.tg-day__tiles{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px 10px}.tg-day{padding-left:18px}.tg-day::before{left:4px}.tg-day__dot{left:-17px}}

/* 方格卡片：无内边距、无下缘 meta，名字沉到 hover 浮层 */
.tg-card--tile{border-radius:12px;border-color:transparent;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));animation-duration:220ms;animation-delay:calc(var(--tg-i,0) * 14ms)}
.tg-card--tile:hover{transform:translateY(-3px);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.2));box-shadow:0 10px 26px rgba(0,0,0,.36);z-index:2}
.tg-tile__thumb{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;border-radius:12px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));display:flex;align-items:center;justify-content:center}
.tg-tile__thumb .tg-card__img{border-radius:12px}
.tg-tile__thumb .tg-card__icon svg{width:36px;height:36px}
.tg-tile__thumb .tg-card__play svg{width:38px;height:38px}
/* 方格右上角**不显示类型徽标**（2026-10-24 用户点名：右上角不用显示标识）。
   分类已经在工具条上选定了，每格再挂一枚「图片 / 网页 / 音频」纯属噪声 ——
   整块下掉，连 hover 也不放行（不是 opacity:0，直接不参与布局）。 */
.tg-card--tile .tg-card__kind-dot{display:none}
.tg-card--tile .tg-card__count{opacity:1;transform:none;top:7px;left:7px;height:17px;padding:0 8px;font-size:10px}
/* 徽标撤走后快捷点回到角上（原 top:30px 是为了给它让位） */
.tg-card--tile .tg-card__peek{right:7px;bottom:auto;top:7px;width:24px;height:24px;border-radius:8px}
/* 单卡删除钮（2026-10-24）：hover / 聚焦浮现，落在右下角，与右上角的预览眼不抢位。
   第一次点变成红底「删除?」，再点一次才真删 —— 所以确认态必须有足够宽的尺寸，
   否则文字挤不下会被裁掉。 */
.tg-card__del{position:absolute;right:8px;bottom:8px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border-radius:8px;color:#fff;background:rgba(15,17,23,.72);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);opacity:0;transform:translateY(4px) scale(.94);transition:opacity 180ms ease,transform 220ms cubic-bezier(.2,.8,.2,1),background 160ms ease,border-color 160ms ease,width 180ms cubic-bezier(.2,.8,.2,1);cursor:pointer;z-index:3;font-family:inherit}
.tg-card:hover .tg-card__del,.tg-card:focus-within .tg-card__del{opacity:1;transform:translateY(0) scale(1)}
.tg-card__del:hover{background:rgba(220,60,60,.9);border-color:rgba(255,255,255,.36)}
.tg-card__del:active{transform:scale(.92)}
.tg-card__del[data-armed="true"]{width:auto;min-width:52px;padding:0 9px;background:rgba(214,48,48,.96);border-color:rgba(255,255,255,.5);box-shadow:0 0 0 2px rgba(214,48,48,.22)}
.tg-card__del-text{font-size:11px;font-weight:600;line-height:1;white-space:nowrap;letter-spacing:.02em}
.tg-card__del svg{pointer-events:none}
/* 方格里：缩略图占满整块、下缘是文件名，没有"右下角"可用 ——
   两枚按钮并排挂在缩略图顶部：预览眼贴右（7px），删除在它左边（37px）。
   确认态向左撑开，不会盖住眼睛。 */
.tg-card--tile .tg-card__del{right:37px;bottom:auto;top:7px;width:24px;height:24px;border-radius:8px}
.tg-card--tile .tg-card__del[data-armed="true"]{min-width:50px;padding:0 8px}
/* 文件名常驻缩略图下方（不 hover 也看得见） */
.tg-tile__meta{display:flex;flex-direction:column;gap:2px;padding:7px 3px 3px;min-width:0}
.tg-tile__name{font-size:12px;font-weight:500;line-height:17px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg-tile__sub{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#7c828c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ══ 预览弹窗（2026-10-19 重做）═════════════════════════════════════════
 *
 * 旧版的问题不是配色，是**没有容器**：关闭钮与全屏钮挂在图片外右上角（负偏移，
 * 像贴纸）、文件名与元信息散在图片下方一行、图片和遮罩之间没有边界 —— 整块
 * 看起来就是「一张图浮在暗背景上」。
 *
 * 现在是一张完整的浮动面板：头部一条（类型图标 + 文件名 + 元信息 + 图标按钮组）、
 * 内容区自己持有边界、面板本体有 1px 内描边 + 双层投影。跟浏览器窗口是两张
 * 明确的层，不是贴纸。
 *
 * 尺寸用 clamp 而不是固定 px：1470 宽的屏上给 92vw/86vh，笔记本上用 min() 收敛，
 * 小屏退化成贴边全屏（<720px 时圆角归零、遮罩不留边）。
 *
 * 配色一律取官方 dsw-alias token；面板本身刻意是「深色玻璃」而不跟主题变白 ——
 * 看图的时候周围越暗越好，这是所有看图器件的共同约定（浅色面板会把图片边缘
 * 的白底照得发灰）。
 */

.glb{position:fixed;inset:0;z-index:1300;display:flex;align-items:center;justify-content:center;
  padding:clamp(12px,3vh,40px);
  background:color-mix(in srgb, #06070a 78%, transparent);
  backdrop-filter:blur(14px) saturate(.9);-webkit-backdrop-filter:blur(14px) saturate(.9);
  animation:glb-veil-in 200ms cubic-bezier(.32,.72,0,1);
  font-family:inherit;-webkit-font-smoothing:antialiased}
.glb[data-closing="true"]{animation:glb-veil-out 170ms ease forwards}
@keyframes glb-veil-in{from{opacity:0;backdrop-filter:blur(0) saturate(1)}to{opacity:1}}
@keyframes glb-veil-out{from{opacity:1}to{opacity:0}}

/* 面板：深色玻璃 + 双层投影（近距离一圈定义轮廓，远距离一层托出层次）。 */
.glb-panel{position:relative;display:flex;flex-direction:column;
  width:min(92vw,1480px);max-height:min(88vh,940px);
  border-radius:18px;overflow:hidden;
  background:color-mix(in srgb, #14161c 96%, transparent);
  border:1px solid rgba(255,255,255,.09);
  box-shadow:0 0 0 1px rgba(0,0,0,.5),0 32px 80px -12px rgba(0,0,0,.7),0 8px 24px -8px rgba(0,0,0,.5);
  animation:glb-panel-in 340ms cubic-bezier(.16,1,.3,1)}
.glb[data-closing="true"] .glb-panel{animation:glb-panel-out 170ms cubic-bezier(.4,0,1,1) forwards}
@keyframes glb-panel-in{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:none}}
@keyframes glb-panel-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(.98) translateY(4px)}}

/* ── 头部：52px，一条发丝线分隔 ─────────────────────────────────────── */
.glb-head{flex:none;display:flex;align-items:center;gap:9px;height:52px;padding:0 10px 0 16px;
  border-bottom:1px solid rgba(255,255,255,.07);
  background:color-mix(in srgb, #191c23 92%, transparent);
  animation:glb-fade 240ms ease 60ms backwards}
.glb-head__glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;border-radius:8px;
  background:rgba(255,255,255,.06);color:rgba(255,255,255,.72)}
.glb-head__title{flex:0 1 auto;min-width:0;font-size:13px;font-weight:600;line-height:1.35;
  color:#eceef2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.005em}
.glb-head__dims{flex:none;font-size:11.5px;color:rgba(255,255,255,.42);
  font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:2px}
.glb-head__sep{width:1px;height:16px;margin:0 2px;background:rgba(255,255,255,.12)}
/* 动作区贴右：图标按钮统一 30px 圆角方，hover 才亮起来（静止时只有 55% 明度）。 */
.glb-head__actions{display:flex;align-items:center;gap:2px;margin-left:auto;flex:none}
.glb-btn{display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;border:0;border-radius:9px;background:transparent;
  color:rgba(255,255,255,.55);cursor:pointer;
  transition:background 140ms ease,color 140ms ease,transform 140ms cubic-bezier(.16,1,.3,1)}
.glb-btn:hover{background:rgba(255,255,255,.1);color:#fff}
.glb-btn:active{transform:scale(.92)}
.glb-btn:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:-2px}
.glb-btn[data-active="true"]{color:#fff;background:rgba(255,255,255,.14)}
.glb-btn--close:hover{background:rgba(235,87,87,.9);color:#fff}

/* ── 内容区：自己持有边界；有内边距（图片类留白），无（iframe 撑满）─────
 *
 * 必须用 grid 而不是 flex 居中：flex 容器里 max-height 百分比的参考高度在
 * 「父级高度由 flex 决定」时会解析失败，图片按宽度撑满后高度溢出容器（实测
 * 面板 882 高、图片被撑到 963 高，底部被裁出一条白边）。grid 的网格区域高度
 * 是确定的，item 的 max-height:100% 才真正生效。 */
.glb-body{position:relative;flex:1 1 auto;min-height:0;
  display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);
  place-items:center;padding:18px;overflow:hidden;
  background:
    radial-gradient(120% 120% at 50% 0%,rgba(255,255,255,.045),transparent 62%),
    #0d0f13;
  animation:glb-fade 260ms ease 80ms backwards}

/*
 * 两类内容区的尺寸策略，必须分开 —— 这是旧版没做、新面板才定下的一条：
 *
 *  · **原生内容**（图片 / 视频 / 音频 / 生图）：面板高度由内容决定（一张小图
 *    不该被撑成整屏高、然后在四周包一圈空气）。所以 body 只给 grid 居中 +
 *    内容自己 max-width/height:100%，panel 保持 max-height 的弹性约束。
 *  · **承载式内容**（html / pdf / office 页图）：iframe 自己的固有高度是 150px
 *    （HTML 规范默认值），内容驱动高度会让它被压成一条 —— 实测 1480×150 的
 *    一条缝。所以这一类让 panel 拿到**确定高度**，body 的 grid 行用 1fr 填满。
 */
.glb-panel[data-fill="true"]{height:min(88vh,940px)}
.glb-body[data-fill="true"]{padding:0}
.glb-body[data-fill="true"] > *{width:100%;height:100%;min-height:0}

.glb-media{display:block;max-width:100%;max-height:100%;min-height:0;min-width:0;
  width:auto;height:auto;object-fit:contain;border-radius:10px;
  background:transparent;box-shadow:0 12px 40px -10px rgba(0,0,0,.65);
  animation:glb-media-in 320ms cubic-bezier(.16,1,.3,1) 40ms backwards}
.glb-media--video{background:#000}
@keyframes glb-media-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}

.glb-frame{width:100%;height:100%;border:0;background:#fff;display:block}

/* 音频：居中一张小卡（方头 + 播放器），没有画面就别铺满整块空区。 */
.glb-audio{display:flex;flex-direction:column;align-items:center;gap:22px;
  padding:40px 48px;border-radius:16px;
  background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);
  max-width:100%}
.glb-audio__glyph{display:inline-flex;align-items:center;justify-content:center;
  width:64px;height:64px;border-radius:50%;
  background:rgba(255,255,255,.06);color:rgba(255,255,255,.7)}
.glb-audio__glyph svg{width:30px;height:30px;stroke-width:1.5}
.glb-audio audio{width:min(460px,62vw);height:34px}

/* 生图多张：并排一列，超出滚动。 */
.glb-genrow{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center;
  max-width:100%;max-height:100%;min-height:0;overflow:auto;padding:2px}
.glb-genrow .glb-media{max-height:100%;width:auto;flex:0 0 auto}

/* 加载 / 空态提示。 */
.glb-note{display:flex;flex-direction:column;align-items:center;gap:12px;
  max-width:46ch;text-align:center;line-height:1.7;
  font-size:12.5px;color:rgba(255,255,255,.55)}
.glb-note svg{width:60px;height:60px;stroke-width:1.2;opacity:.5}
.glb-spin-inline{display:inline-flex;animation:glb-spin 900ms linear infinite}
.glb-spin{position:absolute;display:inline-flex;align-items:center;justify-content:center;
  width:38px;height:38px;border-radius:50%;background:rgba(12,14,18,.72);
  color:rgba(255,255,255,.85);animation:glb-spin 900ms linear infinite;pointer-events:none}
@keyframes glb-spin{to{transform:rotate(360deg)}}

/* ── 页图预览（PPT / Word / Excel）──────────────────────────────────── */
.glb-paged{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  padding:18px 18px 64px;overflow:auto}
.glb-paged__img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;
  background:#fff;box-shadow:0 12px 40px -10px rgba(0,0,0,.6);
  opacity:0;transition:opacity 260ms ease}
.glb-paged__img[data-loaded="true"]{opacity:1}
.glb-paged__bar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:4px;padding:4px;border-radius:11px;
  background:rgba(20,22,28,.92);border:1px solid rgba(255,255,255,.1);
  box-shadow:0 8px 24px -6px rgba(0,0,0,.6);
  animation:glb-fade 220ms ease 120ms backwards}
.glb-paged__step{height:28px;padding:0 12px;border:0;border-radius:8px;background:transparent;
  color:rgba(255,255,255,.78);font-family:inherit;font-size:12px;cursor:pointer;
  transition:background 140ms ease,color 140ms ease}
.glb-paged__step:hover:not(:disabled){background:rgba(255,255,255,.1);color:#fff}
.glb-paged__step:disabled{opacity:.32;cursor:default}
.glb-paged__pos{padding:0 8px;font-size:11.5px;color:rgba(255,255,255,.6);
  font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── 左右翻页：贴内容区两侧，半透明底，hover 才完全显形 ─────────────── */
.glb-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;
  display:flex;align-items:center;justify-content:center;
  width:38px;height:62px;border:1px solid rgba(255,255,255,.1);border-radius:11px;
  background:rgba(18,20,26,.72);color:rgba(255,255,255,.72);cursor:pointer;
  opacity:.55;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  transition:opacity 160ms ease,background 160ms ease,transform 160ms cubic-bezier(.16,1,.3,1)}
.glb-nav:hover{opacity:1;background:rgba(34,38,48,.92);color:#fff}
.glb-nav--prev{left:12px}
.glb-nav--next{right:12px}
.glb-nav--prev:active{transform:translateY(-50%) translateX(-2px) scale(.96)}
.glb-nav--next:active{transform:translateY(-50%) translateX(2px) scale(.96)}

/* ── 底栏：左计数 · 右缩放胶囊 ──────────────────────────────────────── */
.glb-foot{flex:none;position:relative;display:flex;align-items:center;justify-content:center;height:34px;
  padding:0 12px;
  border-top:1px solid rgba(255,255,255,.06);
  background:color-mix(in srgb, #191c23 92%, transparent)}
.glb-foot__count{position:absolute;left:0;right:0;text-align:center;
  font-size:11px;color:rgba(255,255,255,.42);font-variant-numeric:tabular-nums;letter-spacing:.02em;
  pointer-events:none}
.glb-zoom{margin-left:auto;display:flex;align-items:center;gap:6px;z-index:1;min-width:0}
/* 未缩放：一枚极淡的操作提示（提示 Ctrl+滚轮，同时说明这里能放大）。
   刻意压到 30% 明度：它不是按钮，只是说明，不该跟计数抢注意力。 */
.glb-zoom__hint{display:inline-flex;align-items:center;gap:5px;
  font-size:10.5px;color:rgba(255,255,255,.3);white-space:nowrap;
  transition:color 160ms ease}
.glb-body:hover ~ .glb-foot .glb-zoom__hint{color:rgba(255,255,255,.52)}
/* 已缩放：百分比 + 复位钮（亮起来，因为它现在是有信息量的状态）。 */
.glb-zoom[data-active="true"]{padding:2px 2px 2px 9px;border-radius:8px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);
  animation:glb-zoom-in 220ms cubic-bezier(.16,1,.3,1)}
@keyframes glb-zoom-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
.glb-zoom__pct{font-size:11px;font-weight:600;color:rgba(255,255,255,.86);
  font-variant-numeric:tabular-nums;min-width:3.2em;text-align:right}
.glb-zoom__reset{display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;
  color:rgba(255,255,255,.6);cursor:pointer;
  transition:background 140ms ease,color 140ms ease,transform 140ms cubic-bezier(.16,1,.3,1)}
.glb-zoom__reset:hover{background:rgba(255,255,255,.12);color:#fff}
.glb-zoom__reset:active{transform:rotate(-40deg) scale(.9)}
.glb-zoom__reset:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:-2px}

/* 缩放中：裁掉溢出（放大后的图不该盖住头部与底栏）。 */
.glb-body[data-zoomed="true"]{overflow:hidden}

/* Ctrl 遮罩：只在承载式内容（iframe）上出现，见 media-lightbox 里的说明。
   透明、满铺、吃掉所有指针事件 —— 它的唯一职责是把 wheel 接回宿主，
   好让 Ctrl+滚轮 不落到浏览器自己的页面缩放上。 */
.glb-shield{position:absolute;inset:0;z-index:5;background:transparent;cursor:zoom-in}
/* 可缩放目标的公共约束：transform 由 JS 贴，这里只保证合成层与缩放原点。 */
.glb-media,.glb-paged__img,.glb-genrow{transform-origin:center center;backface-visibility:hidden}

/* ── 全屏态：面板铺满、头部浮在内容上、圆角归零 ─────────────────────── */
.glb[data-full="true"]{padding:0;background:#08090c}
.glb[data-full="true"] .glb-panel{width:100vw;height:100vh;max-width:100vw;max-height:100vh;
  border-radius:0;border:0;background:#08090c;box-shadow:none}
/* 全屏下两类都填满（全屏语义就是「占满」）。 */
.glb[data-full="true"] .glb-body[data-fill="true"]{padding:0}
.glb[data-full="true"] .glb-head{position:absolute;top:0;left:0;right:0;z-index:3;
  border-bottom:0;background:linear-gradient(to bottom,rgba(8,9,12,.9),transparent);
  animation:glb-fade 200ms ease}
.glb[data-full="true"] .glb-body{padding:0;background:#08090c}
/* 头部是全屏态里的浮动渐变条（52px 压在内容上），图片给它让出这一条，
   否则顶部会被标题遮住一截。 */
.glb[data-full="true"] .glb-media{border-radius:0;box-shadow:none;max-height:calc(100vh - 52px)}
.glb[data-full="true"] .glb-paged{padding:56px 0 0}
.glb[data-full="true"] .glb-paged__img{max-height:calc(100vh - 56px);border-radius:0}
.glb[data-full="true"] .glb-foot{display:none}
.glb[data-full="true"] .glb-nav{width:44px;height:76px}
.glb[data-full="true"] .glb-nav--prev{left:16px}
.glb[data-full="true"] .glb-nav--next{right:16px}

@keyframes glb-fade{from{opacity:0}to{opacity:1}}

/* 窄屏：面板贴边，圆角收掉（小屏留白只会压缩内容）。 */
@media (max-width:720px){
  .glb{padding:0}
  .glb-panel{width:100vw;height:100vh;max-width:100vw;max-height:100vh;border-radius:0;border:0}
  .glb-body{padding:10px}
  .glb-nav{display:none}
  .glb-head__dims{display:none}
  /* 窄屏只留百分比（提示文案太占位，且手机上没有滚轮）。 */
  .glb-zoom__hint{display:none}
}

@media (prefers-reduced-motion:reduce){
  .tg-card,.tg-skel,.tg-empty,.tg-stale,.tg-session-bar,.tg-dock{animation:none!important}
  .tg-card,.tg-card:hover,.tg-icon-btn,.tg-kind,.tg-dock__item,.tg-card__img,.tg-card__icon,.tg-card__kind-dot,.tg-card__peek{transition:none!important}
  /* 减弱动效下这枚按钮不再靠过渡浮出：直接常显，否则要 hover 才有反应。 */
  .tg-card__peek{opacity:1!important;transform:none!important}
  .tg-skel__thumb::after,.tg-skel__line::after{animation:none!important}
  .tg-empty__icon,.tg-stale__dot,.tg-icon-btn[data-spinning="true"] svg{animation:none!important}
  .glb,.glb-panel,.glb-head,.glb-body,.glb-media,.glb-note,.glb-paged__bar,.glb-zoom{animation:none!important}
  .glb-btn,.glb-nav,.glb-paged__step,.glb-paged__img,.glb-zoom__hint,.glb-zoom__reset{transition:none!important}
  .glb-spin,.glb-spin-inline{animation:none!important}
  .tg-day,.tg-day::before,.tg-day__head,.tg-day__dot,.tg-day__rule,.tg-time-pop,.tg-search__time-tag,.tg-time-bar{animation:none!important}
  .tg-time-pop__preset,.tg-time-pop__apply,.tg-view__btn{transition:none!important}
  .tg-time-bar__icon{animation:none!important}
  /* 分类删除（2026-10-16）：只关动画与位移，**不动布局与可见性规则** ——
     删除键该浮现还是浮现（opacity 立即切换），确认态该出现还是出现，条目该被删
     还是被删，只是不再有过渡帧。注意这里刻意**不写** visibility / display：
     写了就等于让"看不看得见"取决于这段媒体查询是否命中。 */
  .tg-card--out,.tg-kind__confirm,.tg-kind[data-busy="true"] .tg-kind__confirm,.tg-del-error{animation:none!important}
  .tg-kind__del,.tg-kind__yes,.tg-kind__no,.tg-del-error__close{transition:opacity 120ms linear,background 120ms linear,color 120ms linear}
  .tg-kind__del{transform:none}
  .tg-kind__del:active,.tg-kind__yes:active,.tg-kind__no:active{transform:none}
  .tg-kind__yes:hover,.tg-kind__yes:active{transform:none}
  /* 刻意**不**在减弱动效下把退场卡片设成 opacity:0：动画关掉后它仍要等请求
     回来才从数据里摘掉，这期间让它保持原样（kr-chat 一键删记忆同款口径），
     否则会先"闪没"再等几百毫秒才真正消失。 */
}
`

/** 注入画廊样式（幂等）。 */
export function ensureGalleryStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) {
    if (existing.textContent !== SHEET) {
      existing.textContent = SHEET
    }
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
