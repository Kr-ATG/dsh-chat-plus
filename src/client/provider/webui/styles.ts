/**
 * dsh-chat-plus — 供应商页样式注入（原 dsh-provider-hub/webui/styles）。
 *
 * 供应商设置已从官方「设置」弹窗的 `settings.section` 座位迁进**工作台**
 * 的一个 Tab（2026-10-05 融合进 dsh-chat-plus），因此这里只保留样式注入：
 * 官方「模型」设置页不再被隐藏（hideOfficialModelsNav 已删除），
 * 两处入口并存——官方模型页管内核目录，工作台供应商页管多供应商配置。
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
.phub-host{display:flex;flex-direction:column;gap:18px}
.phub-host[data-wide] > div:first-child{display:flex;align-items:flex-start;gap:16px;min-width:0;width:100%}
/* 宽屏时三个模型设置卡作为 hub 的第三列：宽度随容器走（clamp 560–900），自身可滚。
   写死 380 太窄（下拉被挤成一小截），按容器比例给足宽度。 */
.phub-host[data-wide] > div:first-child > .phub-blocks{flex:0 0 clamp(560px,44%,900px);width:clamp(560px,44%,900px);max-height:calc(100vh - 150px);overflow-y:auto;overflow-x:hidden;padding-right:2px;animation:phub-block-in 280ms cubic-bezier(.2,.8,.2,1) backwards}
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
.phub-navwrap{overflow:hidden;transition:width 220ms cubic-bezier(.2,.8,.2,1);position:sticky;top:0;align-self:flex-start;display:flex;flex-direction:column;max-height:calc(100vh - 150px);box-sizing:border-box}

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

/* ── 详情面板与底部三块：同一张卡片的两种用法（同 token / 同圆角 / 同内距） ── */
.phub-panel{border:1px solid var(--dsw-alias-border-l2,#dcdfe6);border-radius:12px;padding:14px 18px;display:flex;flex-direction:column;gap:10px;min-width:0;box-sizing:border-box}
.phub-block{border:1px solid var(--dsw-alias-border-l2,#dcdfe6);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;min-width:0;box-sizing:border-box;transition:border-color .18s ease}
.phub-block:hover{border-color:var(--dsw-alias-border-l3,#c9cdd4)}
.phub-block-in{animation:phub-block-in 280ms cubic-bezier(.2,.8,.2,1) backwards}
/* 底部三块错峰入场：60ms 一档，整页像一次性铺开而不是同时闪出来。 */
.phub-blocks{display:flex;flex-direction:column;gap:14px;min-width:0}
.phub-blocks > *:nth-child(1){animation-delay:40ms}
.phub-blocks > *:nth-child(2){animation-delay:100ms}
.phub-blocks > *:nth-child(3){animation-delay:160ms}
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

@media (prefers-reduced-motion: reduce){
  .phub-navwrap{transition:none}
  .phub-detail-in,.phub-block-in,.phub-placeholder,.phub-desc-in{animation:none}
  .phub-host .dsh-webui-provider-nav-row{transition:none}
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
