/**
 * dsh-chat-plus — 界面字体功能的 client 装配。
 *
 * 两件事，顺序有讲究：
 *  1. **先**同步应用持久化的字体覆盖（applyStoredFont）——它只依赖 DOM，
 *     越早落到 `<head>`，首帧越少一次「系统字体闪成所选字体」的跳变。
 *  2. **再**把设置行注册进官方「通用」设置页的 `settings.general.item` 槽位。
 *     这一步失败时只有设置项不出现，第 1 步的字体应用照常生效
 *     （用户已选的字体不会因为设置页挂了而丢失）。
 *
 * 座位 id 用 `ui-font`：官方 ui-theme 已占 `appearance`(order 10) 与
 * `font-size`(order 11)，本行 order 12 排在它们之后，同列堆叠。
 */
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { applyStoredFont } from './font.js'
import { initFont, setFont } from './store.js'
import { UiFontRow } from './Row.js'
import { featureEnabledNow, onFeatureChange } from '../features/gate.tsx'

/** 设置行座位 id。 */
export const UI_FONT_ROW_ID = 'ui-font'

/**
 * 装配界面字体功能。
 * @param ctx - client root context。
 */
export function applyUiFont(ctx: ClientContext): void {
  /** 已应用的字体覆盖清理函数（null = 当前没有覆盖，页面用官方默认字体）。 */
  let removeFont: (() => void) | null = null
  /** 设置行的注销函数（null = 设置页里没有这一行）。 */
  let disposeRow: (() => void) | null = null

  // 第一步：应用持久化的字体覆盖。纯 DOM，不依赖任何服务——设置行注册失败时
  // 用户已选的字体也照常生效。
  const mountFont = (): void => {
    if (removeFont !== null) return
    initFont()
    removeFont = applyStoredFont()
  }
  const unmountFont = (): void => {
    removeFont?.()
    removeFont = null
  }

  // 第二步：注册官方「通用」设置页里的字体行。
  //
  // `inject` 面按官方契约必须提供：`settings.general.item` 的注册要求注册方交出
  // 一个注入面（官方两行就是拿它传 setTheme / setFontSize）。本行的写入走模块内
  // 单例 store，这里把 setFont 一并交出去，方便将来从 inject 面驱动。
  const injected = (): { setFont: (id: string) => void } => ({ setFont })
  const mountRow = (): void => {
    if (disposeRow !== null) return
    disposeRow = ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: UI_FONT_ROW_ID,
      order: 12,
      inject: injected,
    }, UiFontRow)) as unknown as () => void
  }
  const unmountRow = (): void => {
    try { disposeRow?.() } catch { /* 已被级联移除：忽略 */ }
    disposeRow = null
  }

  /**
   * 开关同步：关掉 = 移除字体变量覆盖（整站立刻回到官方默认字体）+ 设置行消失；
   * 打开 = 重新应用持久化档位并恢复设置行。两者同一拍完成，避免出现
   * 「设置行还在、字体已经不生效」的半截状态。
   */
  const sync = (enabled: boolean): void => {
    if (enabled) {
      mountFont()
      mountRow()
    } else {
      unmountFont()
      unmountRow()
    }
  }
  sync(featureEnabledNow('input.ui-font'))
  const off = onFeatureChange('input.ui-font', sync)
  ctx.effect(() => () => {
    off()
    unmountFont()
    unmountRow()
  }, 'dsh-chat-plus: ui font feature switch')
}

/**
 * 纯逻辑再导出：供冒烟直接断言「默认档是微软雅黑」「字体栈始终带通用回退」
 * 「webfont 档确实指向 host 路由」——这三条错了都不会报错，只会静默显示成
 * 错的字体或掉成浏览器默认衬线，必须能被测试钉死。
 */
export { FONT_OPTIONS, DEFAULT_FONT_ID, fontOptionOf, fontOverrideCss, fontFileUrl } from './font.js'
export { __test as uiFontTest } from './test-surface.js'
