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
.phub-host{display:flex;flex-direction:column;gap:20px}
.phub-block-title{font-size:14px;font-weight:600;margin-bottom:8px}
.phub-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#888);margin-bottom:10px}
/* 左栏收窄/展开：宽度滑动（进出同动画，flex 右侧自动跟随伸缩） */
.phub-nav{overflow:hidden;transition:width 220ms ease}
/* 右侧详情：打开/切换/关闭回占位时滑入（key 变化重播） */
.phub-detail-in{display:flex;flex-direction:column;min-width:0;animation:phub-slide-in 220ms ease}
@keyframes phub-slide-in{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.phub-nav{transition:none}.phub-detail-in{animation:none}}
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
