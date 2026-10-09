/**
 * dsh-chat-plus — 供应商页样式注入（原 dsh-provider-hub/webui/styles）。
 *
 * 供应商设置**回到官方「设置」弹窗**的 `settings.section` 座位（2026-10-05
 * 用户点名：把供应商配置和代理放回设置里），官方「模型」页导航项随之隐藏
 * （两页管同一件事，并存会让用户不知道该点哪个）。
 *
 * 设置弹窗天生只有 800×800（官方 `.panel` 的硬规格），塞不下「左列表 + 右详情 +
 * 底部三块 + 代理」。所以这里按 `:has(.phub-host)` 精确加宽加高——**只对供应商页
 * 生效**，其它设置页（通用 / 插件 / 会话）维持官方 800×800 原样。
 *
 * 尺寸与高度上限走 `--phub-max-h` 变量（定义在弹窗上，靠继承下发）：左栏与详情
 * 面板的限高必须按弹窗实高算，写 `100vh - 150px` 在 1080p 上会算出 930px，
 * 比弹窗内容区还高，结果是内外两条滚动条打架。
 */
const STYLE_ID = 'dsh-provider-hub-styles'
let injected = false

/** 注入全局样式；返回移除函数。 */
export function injectStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-chat-plus'
    tag.textContent = `
/* ── 官方控件规格的交互态（等价官方 CSS Modules，插件自绘控件共用） ──
   官方 input:focus 换 business-primary 描边并去 outline；outline:hover 出中性底；
   ghost:hover 同底、ghost:active 用 active 底。这些态官方组件自带，插件复刻的
   控件必须自己补，否则「长得像、点起来不像」。 */

.phub-host select:focus,
.phub-host input:focus,
.pp-panel select:focus,
.pp-panel input:focus {
  border-color: var(--dsw-alias-state-business-primary);
  outline: none;
}
.phub-host select:disabled,
.phub-host input:disabled,
.pp-panel select:disabled,
.pp-panel input:disabled {
  opacity: .6;
  cursor: default;
}
/* 官方 outline 小按钮的 hover / active（Button.module.css 同款 token）。 */
.phub-host button.dsh-webui-capsule-btn:hover:not(:disabled),
.pp-panel button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.phub-host button.dsh-webui-capsule-btn:active:not(:disabled),
.pp-panel button:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover));
}
.phub-host button:disabled,
.pp-panel button:disabled { opacity: .4; cursor: not-allowed; }

/* ── 页面骨架：窄屏纵向堆叠 / 宽屏三栏（列表 · 详情 · 模型设置） ──
   宽窄由组件用 ResizeObserver 量自身宽度后打 data-wide（媒体查询量视口，
   与容器实宽不是一回事）。 */
.phub-host{display:flex;flex-direction:column;gap:18px;animation:phub-page-in 360ms cubic-bezier(.22,1,.36,1) backwards}
/* 弹窗放大过程中内容一直在重排，淡入 + 轻微上浮让这一拍读起来是「铺开」而不是「被拉伸」。 */
@keyframes phub-page-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.phub-host[data-wide] > div:first-child{display:flex;align-items:flex-start;gap:16px;min-width:0;width:100%}
/* 宽屏时三个模型设置卡作为 hub 的第三列：宽度随容器走（clamp 560–900），自身可滚。
   写死 380 太窄（下拉被挤成一小截），按容器比例给足宽度。
   切档（窄屏第二行 → 宽屏第三列）时播 phub-col-in：只淡入 + 轻微右移，
   **不做宽度插值**——从 0 撑开会把卡里的下拉/输入框压扁，那种畸变比
   布局一次到位更扎眼；重排本身由这层淡入遮住即可。
   容器自身只播 col-in（带 120ms 延后，等弹窗先铺开），卡片错峰由下面的
   nth-child 承担——容器再播一份 block-in 会和子卡叠成双重淡入，时序全乱。 */
.phub-host[data-wide] > div:first-child > .phub-blocks{flex:0 0 clamp(560px,44%,900px);width:clamp(560px,44%,900px);max-height:var(--phub-max-h, calc(100vh - 150px));overflow-y:auto;overflow-x:hidden;padding-right:2px;animation:phub-col-in 360ms cubic-bezier(.22,1,.36,1) 120ms backwards}
@keyframes phub-col-in{from{opacity:0;transform:translateX(10px)}}
/* 窄屏（未打 data-wide）：三块模型设置换行落到第二行，占满整行。
   flex-basis:100% 是换行的关键——只给 flex:1 的话它会被压在同一行里，
   详情面板被挤成一条。容器自身不播动画，错峰淡入由下面的 nth-child 接管。 */
.phub-host:not([data-wide]) > div:first-child > .phub-blocks{flex:1 1 100%;width:100%}
.phub-host[data-wide] > div:first-child > .phub-blocks::-webkit-scrollbar{width:8px}
.phub-host[data-wide] > div:first-child > .phub-blocks::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3,#c9cdd4);border-radius:4px}
.phub-host[data-wide] > div:first-child > .phub-blocks::-webkit-scrollbar-track{background:transparent}
/* 宽屏时详情列与左栏一起收在视口内，底部三块跟着右列滚。
   详情面板自身限宽：表单行拉到 1200+ 时「标签—控件」两端的距离已经超出
   扫视范围，模型目录那几行也会变成一条横带。 */
.phub-host[data-wide] > div:first-child > div:nth-child(2){align-self:stretch;min-width:0}
.phub-host[data-wide] .phub-panel{max-width:1080px}
.phub-block-title{font-size:14px;font-weight:600;margin-bottom:8px}
.phub-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#888);margin-bottom:10px}

/* 左栏容器（外层）：宽度滑动 + 滚动时跟随（sticky）。
   高度上限按视口算：目录预设展开后行数可以到一百多，不限高就会把右侧详情
   与底部三块一起顶到视口外——那正是「页面看着乱」的主因。
   overflow:hidden 只收横向（过渡期间的行溢出），纵向交给内层滚动区。 */
.phub-navwrap{overflow:hidden;transition:width 220ms cubic-bezier(.2,.8,.2,1);position:sticky;top:0;align-self:flex-start;display:flex;flex-direction:column;max-height:var(--phub-max-h, calc(100vh - 150px));box-sizing:border-box}

/* 右侧详情：打开/切换/关闭回占位时滑入（key 变化重播） */
.phub-detail-in{display:flex;flex-direction:column;min-width:0;animation:phub-slide-in 220ms cubic-bezier(.2,.8,.2,1)}
@keyframes phub-slide-in{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}

/* ── 行 hover / 按下：列表行与底部三块的行卡片共用同一套反馈 ── */
.phub-host .dsh-webui-provider-nav-row{transition:background .16s ease,box-shadow .16s ease}
.phub-host .dsh-webui-provider-nav-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.phub-host .dsh-webui-provider-nav-row:active{transform:translateY(1px)}
.phub-host .dsh-webui-provider-nav-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}

/* 可折叠分组标题（「目录预设」）：hover 提亮，chevron 旋转由内联样式给。 */
.phub-group-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));color:var(--dsw-alias-label-secondary,#4e5969)}

/* 「说明」链接钮：官方 .linkButton 规格（28px / radius-sm / label-tertiary / hover 出底）。 */
.phub-host button[aria-expanded]{border-radius:var(--dsw-radius-sm,8px);transition:background 120ms ease,color 120ms ease}
.phub-host button[aria-expanded]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}

/* 官方 .addModelButton / .addButton 的虚线添加面（生图/生视频的「+ 添加」）。 */
.phub-host button.dsh-webui-capsule-btn:not(:disabled){border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,8px);height:28px;padding:0 10px;font-size:12px;line-height:18px}
.phub-host button.dsh-webui-capsule-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}

/* ── 详情面板与底部三块：同一张卡片的两种用法（同 token / 同圆角 / 同内距） ── */
.phub-panel{border:.5px solid var(--dsw-alias-settings-card-stroke, rgba(255,255,255,.2));border-radius:var(--dsw-radius-xl,20px);padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-width:0;box-sizing:border-box;background:var(--dsw-alias-settings-card-fill, transparent)}
/* 能力卡 = 官方 .rowCard 规格：0.5px settings-card-stroke + settings-card-fill +
   --dsw-radius-xl(20px) + gap 12 + padding 12/14。原自绘版是 1px border-l2 + 12px 圆角，
   与官方设置页的卡片并排一眼能看出两套。 */
.phub-block{border:.5px solid var(--dsw-alias-settings-card-stroke, rgba(255,255,255,.2));border-radius:var(--dsw-radius-xl,20px);padding:12px 14px;display:flex;flex-direction:column;gap:12px;min-width:0;box-sizing:border-box;background:var(--dsw-alias-settings-card-fill, transparent);transition:border-color 120ms ease}
.phub-block:hover{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.24))}
.phub-block-in{animation:phub-block-in 320ms cubic-bezier(.22,1,.36,1) backwards}
/* 底部三块错峰入场：弹窗放大的 420ms 里先让骨架铺开，内容晚一拍跟进，
   整页像一次性铺开而不是同时闪出来。代理块跟在第三块后面。
   注意：nth-child 直接写 animation 简写（而非 animation-delay），
   会覆盖子卡自带的 .phub-block-in——这正是要的：时序以这里为准。 */
.phub-blocks{display:flex;flex-direction:column;gap:14px;min-width:0}
.phub-blocks > *:nth-child(1){animation:phub-block-in 320ms cubic-bezier(.22,1,.36,1) 140ms backwards}
.phub-blocks > *:nth-child(2){animation:phub-block-in 320ms cubic-bezier(.22,1,.36,1) 220ms backwards}
.phub-blocks > *:nth-child(3){animation:phub-block-in 320ms cubic-bezier(.22,1,.36,1) 300ms backwards}
.phub-proxy.phub-block-in{animation:phub-block-in 320ms cubic-bezier(.22,1,.36,1) 360ms backwards}
@keyframes phub-block-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* 展开的「说明」段落：高度不变，只淡入，避免整块跳动。 */
.phub-desc-in{animation:phub-desc-in 200ms ease backwards}
@keyframes phub-desc-in{from{opacity:0}to{opacity:1}}

/* ── 网络代理：整页底部区块（不占右列，用户 2026-10-05 点名） ──
   横跨整页宽度，两张卡在宽屏时并排、窄屏堆叠。 */
.phub-proxy{width:100%;min-width:0}
.phub-proxy > .pp-panel{display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:14px;align-items:start}
@media (max-width: 1200px){.phub-proxy > .pp-panel{grid-template-columns:1fr}}

/* 空态占位：细虚线 + 居中说明，随页面淡入（无内容时不撑一条边框出来）。 */
.phub-placeholder{border-style:dashed;border-color:var(--dsw-alias-border-l3,#c9cdd4);color:var(--dsw-alias-label-tertiary,#8f959e);text-align:center;align-items:center;justify-content:center;min-height:220px;padding:24px;animation:phub-block-in 260ms cubic-bezier(.2,.8,.2,1) backwards}

/* ── 官方设置弹窗：尺寸过渡**常驻**（进入 / 退出两个方向都要有） ──
   不能把 transition 写进下面那条 :has(.phub-host) 里：
     · 进入：规则与尺寸同帧生效，浏览器把「首帧」当成初始值，不产生过渡（瞬变）；
     · 退出：点其他页那一刻 .phub-host 卸载，规则与尺寸同帧失效，弹窗瞬间回弹
       ——用户反馈的「点其他收回没动效」就是这个。
   锚点取官方的 data-shortcut-modal="settings"（SettingsPanel 里写死的属性），
   它在弹窗整个生命周期内都成立，两个方向都有过渡。尺寸没变化时不触发过渡，
   其余设置页零影响。 */
[role="presentation"] > [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]{
  transition:width 420ms cubic-bezier(.22,1,.36,1), height 420ms cubic-bezier(.22,1,.36,1);
}
/* 兜底：万一官方改了那个属性名，至少在供应商页内还有过渡（退出方向会丢，但不至于全丢）。 */
[role="presentation"] > [dialog][aria-modal="true"]:has(.phub-host){
  transition:width 420ms cubic-bezier(.22,1,.36,1), height 420ms cubic-bezier(.22,1,.36,1);
}
/* options 内距同步过渡：供应商页把它从 24px 收成 16px，收放时不跟着跳一格。 */
[role="presentation"] > [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"] > div:last-child > div:last-child{
  transition:padding 420ms cubic-bezier(.22,1,.36,1);
}

/* ── 官方设置弹窗里的尺寸适配（只对供应商页生效） ──
   :has(.phub-host) 把规则锁死在「当前打开的是供应商 section」这一种情况：
   通用 / 插件 / 会话页完全没有 .phub-host，一律维持官方 800×800 原规格。
   宽度给到 min(1680px, 100vw - 48px)，高度吃掉视口（减去上下留白），因为这一页
   本身就是「左列表 + 右详情 + 底部四块」的整页工作区。
   高度沿用官方那条算式（2 × max(24px, --dsh-frame-overlay-top)），只把 800px
   的上限拿掉——壳内顶部有 chrome 时留白会更大，写死 48px 会被压出滚动条。 */
[role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby]:has(.phub-host){
  width:min(1680px, calc(100vw - 48px));
  --phub-panel-h:calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)));
  --phub-panel-h:calc(100dvh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)));
  height:var(--phub-panel-h);
  /* 弹窗实高减去 header(54) 与 options 的下内距(16)，供左栏 / 详情面板限高。 */
  --phub-max-h:calc(var(--phub-panel-h) - 54px - 16px);
}
/* 首次渲染起点：设置弹窗**打开时就落在供应商页**（上次停在这一页）时，dialog 是
   这一帧新建的，没有「上一帧」可插值——官方 .panel 的 800×800 在这里靠
   @starting-style 补成起点，过渡才会真的播出来；否则第一帧就跳到 1680。
   切换页面进来的路径本来就有上一帧，不需要它，也不受影响。 */
@starting-style{
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby]:has(.phub-host){
    width:800px;
    height:min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px))));
  }
}
/* 官方 options 有 24px 内距：宽屏三栏本来就吃紧，这里收成 16px 并留出底距。 */
[role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby]:has(.phub-host) > div:last-child > div:last-child{
  padding:0 16px 16px;
}
/* 设置弹窗内的纵向滚动交给 options 一列，页面本体不再自造第二条滚动条。 */
[role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby]:has(.phub-host) .phub-host{overflow:visible}

@media (prefers-reduced-motion: reduce){
  .phub-navwrap{transition:none}
  .phub-detail-in,.phub-block-in,.phub-placeholder,.phub-desc-in,.phub-host,.phub-blocks,.phub-blocks > *,.phub-proxy{animation:none}
  .phub-host .dsh-webui-provider-nav-row{transition:none}
  [role="presentation"] > [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"],
  [role="presentation"] > [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"] > div:last-child > div:last-child,
  [role="presentation"] > [role="dialog"][aria-modal="true"]:has(.phub-host){
    transition:none;
  }
}
`
    document.head.appendChild(tag)
    injected = true
  }
  return () => {
    if (!injected) return
    document.getElementById(STYLE_ID)?.remove()
    injected = false
  }
}

/** 官方「模型」页导航项 label（中英文），用于文本匹配隐藏。 */
const MODEL_LABELS = new Set(['模型', 'Models'])

/**
 * 隐藏设置导航中官方「模型」项。
 *
 * 官方导航项没有稳定 DOM 锚点（SettingsRoot.tsx 里 nav 项是 `<button>`，
 * 只有 React key + navLabel 文本；CSS Module 前缀每次构建都变），所以只能
 * 按 label 文本匹配。这里的**座位归属**没变：供应商页接管了模型目录的编辑，
 * 官方「模型」页留着就是同一件事两个入口。
 *
 * 匹配失败时降级为两页并存（不会报错、也不会挡住任何功能）。
 * @returns 撤销隐藏、还原导航项的清理函数。
 */
export function hideOfficialModelsNav(): () => void {
  /** 被本模块隐藏的按钮：dispose 时逐个还原，避免关闭模块后官方页永久消失。 */
  const hidden = new Set<HTMLElement>()
  const hide = (): void => {
    // 设置弹窗未打开时整页没有 nav>button：直接返回，省掉逐按钮读文本。
    const buttons = document.querySelectorAll<HTMLElement>('nav button')
    if (buttons.length === 0) return
    for (const btn of buttons) {
      const label = btn.querySelector('span')?.textContent?.trim() ?? btn.textContent?.trim() ?? ''
      if (!MODEL_LABELS.has(label)) continue
      if (btn.style.display === 'none') continue
      btn.style.display = 'none'
      hidden.add(btn)
    }
  }
  // 观察器挂在 body 全子树上，对话流式渲染期间每秒可触发上百次；回调只允许
  // 排一个短延时任务，真正的查询按批合并执行（未节流版本会在每个 mutation
  // 批次里跑一次全树 querySelectorAll + 逐按钮读文本，属性能红线）。
  let timer: number | undefined
  const schedule = (): void => {
    if (timer !== undefined) return
    timer = window.setTimeout(() => {
      timer = undefined
      hide()
    }, 60)
  }
  hide()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    if (timer !== undefined) window.clearTimeout(timer)
    for (const btn of hidden) btn.style.removeProperty('display')
    hidden.clear()
  }
}
