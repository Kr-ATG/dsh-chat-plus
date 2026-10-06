/**
 * dsh-chat-plus — `/` 菜单里给两条指令补 SVG 图标（client 半身）。
 *
 * ## 为什么走 DOM 而不是注册 contribution
 *
 * 官方 `@deepseek-ai/dsh-client-ui-commands` 的 `candidates()` 只对 6 个内置
 * `definitionId`（goal/plan/feedback/compact/permission/export）调
 * `builtinRowFace` 取图标；**第三方宿主命令拿不到 icon 字段** —— 菜单行只
 * 拿到 `description`，所以 `/computer-use`、`/browser-use` 在菜单里是光秃秃的
 * 一行字，夹在一堆有图标的官方命令中间。
 *
 * 想用客户端 contribution 补？`candidates()` 里对同名有一条硬失败：
 * `ui-commands: contribution /x collides with a host command` —— 会抛异常把整个
 * `/` 菜单炸掉。装饰（`decorate`）只换裸调用的 UI，也不给图标。
 *
 * 所以只能：在菜单行上打一个 `data-dsh-gate-icon` 属性，图标本体交给纯 CSS 的
 * `::before` + mask（内联 SVG data URI）。::before 直接成为该 flex 行的第一个
 * item，与官方 `itemIcon` 同位同尺寸，不插节点、不碰官方 React 树。
 *
 * ## 为什么用属性而不是插一个 <svg> 节点
 *
 * 官方菜单每次候选变化都整块重渲染，插进去的节点会被 React 的 diff 抹掉，还得
 * 反复重插（会出现图标闪烁）。属性由观察器持续维持，且重渲染后官方不认识这个
 * 属性、不会清掉它 —— 只要元素还在，图标就在。
 *
 * ## 容错
 *
 * 找不到菜单、结构变了、观察器不可用，都只是「没图标」，绝不抛错影响对话。
 */

/** 菜单行上标记图标的属性（styles.ts 里按它选 ::before）。 */
export const GATE_ICON_ATTR = 'data-dsh-gate-icon'

/** 需要补图标的指令名（与 host 侧分组 key 逐字一致）。 */
export const GATE_ICON_COMMANDS: readonly string[] = ['computer-use', 'browser-use']

/** 官方菜单行的选择器：`role="option"` 的 button。 */
const MENU_ROW_SELECTOR = 'button[role="option"]'

/**
 * 判断一行菜单是不是某条指令，是则返回该指令名。
 *
 * 判据是**第一个子元素的文本严格等于指令名**：官方在 `item.icon` 缺席时根本不
 * 渲染 `itemIcon` 那个 span，于是 `itemName` 就是第一个子元素。用严格相等而不是
 * `includes`，是因为描述里也含命令名（「/computer-use on|off|status」），包含判定
 * 会把普通行误标。
 */
export function gateIconForRow(row: Element): string | null {
  const first = row.firstElementChild
  if (first === null) return null
  const name = (first.textContent ?? '').trim()
  if (name === '') return null
  return GATE_ICON_COMMANDS.includes(name) ? name : null
}

/**
 * 给一棵子树里所有匹配的菜单行打上图标属性。
 * @param root - 观察范围内的根（通常是 document.body）。
 * @returns 本次新标记的行数。
 */
export function decorateGateMenuRows(root: ParentNode): number {
  let marked = 0
  for (const row of root.querySelectorAll(MENU_ROW_SELECTOR)) {
    if (row.hasAttribute(GATE_ICON_ATTR)) continue
    const name = gateIconForRow(row)
    if (name === null) continue
    row.setAttribute(GATE_ICON_ATTR, name)
    marked += 1
  }
  return marked
}

let observer: MutationObserver | null = null
let scheduled = false

/** 把一次装饰推迟到下一帧：菜单每次按键都会重渲染，逐次同步跑会拖慢输入。 */
function scheduleDecorate(): void {
  if (scheduled) return
  scheduled = true
  const run = (): void => {
    scheduled = false
    try {
      decorateGateMenuRows(document.body)
    } catch {
      // 结构异常：本轮跳过，下次变化再试。
    }
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

/**
 * 常驻观察菜单挂载与重渲染，维持图标属性。幂等。
 *
 * 观察整个 body 的子树：官方菜单是 portal 到 body 的，且每次候选变化都重建
 * 节点，没有稳定的挂载点可以只观察一小块。
 */
export function mountGateMenuIcons(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  if (observer !== null) return
  try {
    observer = new MutationObserver(scheduleDecorate)
    observer.observe(document.body, { childList: true, subtree: true })
    // 首帧就扫一遍：插件可能晚于菜单挂载（例如热重载后菜单正开着）。
    scheduleDecorate()
  } catch {
    observer = null
  }
}
