/**
 * dsh-chat-plus — 界面字体：选项表与全局应用。
 *
 * 目标：让 DSH 全站（界面 + 对话正文 + 代码块）按用户选中的字体渲染，
 * 默认「微软雅黑」，可切「霞鹜新致宋」。
 *
 * ## 为什么覆盖这几个 CSS 变量就够（DSH 0.2.1 的变量分两层）
 *
 * 官方 `ui-theme` 的 base.css 里，字体变量是**两层**的：
 *
 *   :root{
 *     --dsh-font-family-text-default: -apple-system, …, "Microsoft YaHei", …;
 *     --dsh-font-family-code-default: "SF Mono", …, "Microsoft YaHei";
 *     --dsw-font-family: var(--dsh-font-family-text-default);
 *     --ds-font-family-code: var(--dsh-font-family-code-default);
 *   }
 *   body{
 *     --dsw-font-family: var(--dsh-font-family-text, var(--dsh-font-family-text-default)),
 *                        var(--dsh-font-family-text-default);
 *     --ds-font-family-code: var(--dsh-font-family-code, var(--dsh-font-family-code-default)),
 *                            var(--dsh-font-family-code-default);
 *   }
 *
 * 上层 `--dsh-font-family-text` / `--dsh-font-family-code` 是**用户可写槽位**
 * （官方「设置 → 更多字体设置」的正文字体 / 代码字体就是写它们，运行时由
 * `ThemePresenter` 以 `body.style.setProperty` 落盘），下层 `--dsw-font-family`
 * / `--ds-font-family-code` 才是被 `body{font-family:…}` 与 markdown 全部字号
 * token（`--dsw-font-markdown-h1` … 逐条写成 `… var(--dsw-font-family)`）消费的
 * 值，代码块统一走 `var(--ds-font-family-code)`。
 *
 * ⚠ **只写 `html:root{--dsw-font-family:…}` 在当前版本已经无效**，这是本功能
 * 恢复时踩到的第一个坑：CSS 变量不是「特异性高的赢」，而是**元素自身的声明
 * 压过一切继承值**。`body` 自己声明了 `--dsw-font-family`，于是 html 上写多高
 * 特异性都传不下去，表现为「@font-face 加载成功、`document.fonts.check` 为 true，
 * 但界面一个字都没变」。正确写法是把**上层槽位**（`--dsh-font-family-text` /
 * `--dsh-font-family-code`）设成所选字体栈，body 那条 `var(--dsh-font-family-text,
 * …)` 自然解析成它——这也是官方自己走的那条路。同时仍覆盖下层两个值，给
 * 直接读 `--dsw-font-family` 的少数地方（ui-layout 等）兜底。
 *
 * 因此**不需要**给任何官方元素打补丁、也不需要 `*{font-family:…}` 这种会破坏
 * 等宽与图标字体的暴力写法。
 *
 * 与官方「正文字体」的优先级：官方那条写入 `body.style`（内联样式），压过本
 * 样式表。用户在官方设置里显式填了正文字体时以官方为准——那是用户更明确的一次
 * 表达，插件不越权。
 *
 * ## 为什么走 CSS 变量而不是直接写 body.style
 *
 * 变量覆盖不影响官方自身的主题切换（暗色/亮色只换 alias token，不碰字体变量），
 * 且优先级天然低于任何组件自己写死的 `font-family`（如代码块），
 * 行为符合「换界面字体不该破坏代码块等宽」的预期。
 *
 * ## 持久化
 *
 * 走 localStorage（与本插件其它偏好一致）。**不**写官方 settings 文档：
 * 那需要 host 侧注册 schema 命名空间，而字体选择纯属浏览器侧渲染偏好，
 * 与「设置文档」的语义（跨设备、模型可见）不同族。
 */
import type { CSSProperties } from 'react'

/** localStorage 键：选中的字体档 id。 */
export const FONT_STORE_KEY = 'dsh.chat_plus.ui_font'

/** 默认档：系统自带的微软雅黑（零下载，且是官方回退链里的中文字体）。 */
export const DEFAULT_FONT_ID = 'system'

/** 一个可选字体档。 */
export interface FontOption {
  /** 稳定 id（持久化用，改文案不改它）。 */
  id: string
  /** 下拉框里显示的名字。 */
  label: string
  /**
   * 正文字体栈（写入 `--dsw-font-family`）。
   * 末尾一律保留官方那条通用回退链，任何字形缺失都不会掉成浏览器默认衬线。
   */
  body: string
  /**
   * 代码字体栈（写入 `--ds-font-family-code`）。
   * 微软雅黑档保持官方原值；中文字体档在**拉丁等宽字体之后**追加中文字体，
   * 这样代码里的英文/符号仍是真等宽，只有中文注释走所选字体。
   */
  code: string
  /**
   * 需要预加载的 webfont 描述；省略表示纯系统字体（不下载任何东西）。
   */
  webfont?: {
    /** @font-face 的 family 名。 */
    family: string
    /** host 路由下的文件名。 */
    file: string
    /** 供 UI 显示的大致体积。 */
    sizeLabel: string
  }
}

/** 官方 `:root` 的通用回退链（逐字抄自 ui-theme base.css，缺字时不会掉成衬线）。 */
const OFFICIAL_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'

/** 官方代码字体链（逐字抄自 ui-theme base.css）。 */
const OFFICIAL_CODE = '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"'

/**
 * 字体档表。顺序即下拉框顺序，第一项是默认档。
 *
 * 微软雅黑写成显式字体栈而非 `var(--dsw-font-family)`：后者在用户已经切到
 * 霞鹜新致宋之后会指向新字体，切回默认就失效了（自己引用自己）。
 */
export const FONT_OPTIONS: readonly FontOption[] = [
  {
    id: 'system',
    label: '微软雅黑',
    body: `"Microsoft YaHei", "Microsoft YaHei UI", ${OFFICIAL_FALLBACK}`,
    code: OFFICIAL_CODE,
  },
  {
    id: 'lxgw-neozhisong',
    label: '霞鹜新致宋',
    body: `"LXGW Neo ZhiSong", ${OFFICIAL_FALLBACK}`,
    // 中文放在等宽拉丁之后：代码里的英文与符号仍走真等宽，中文注释用所选字体。
    code: `"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "LXGW Neo ZhiSong", "PingFang SC", "Microsoft YaHei"`,
    webfont: {
      family: 'LXGW Neo ZhiSong',
      // 屏幕阅读版：原版在 UI 字号下笔画只有微软雅黑约 2/3 的墨量（14px 实测
      // 213 vs 313），界面上细得发飘；官方同作者用 FontLab 加粗的屏幕版
      // （LxgwNeoXiZhi-Screen，同为 v1.067 字库、IPA Font License 1.0）实测
      // 292，观感与雅黑同档。文件名带 -screen 是为了破 immutable 一年缓存。
      file: 'lxgw-neozhisong-screen.woff2',
      sizeLabel: '5.0 MB',
    },
  },
]

/** 字体路由前缀（与 host 半身的 FONT_ROUTE 一致）。 */
const FONT_ROUTE = '/api/chat-flow/fonts'

/** 字体文件的公开 URL。 */
export function fontFileUrl(file: string): string {
  return `${FONT_ROUTE}/${file}`
}

/** 按 id 取档位；未知 id 回落到默认档（存储里出现脏值时不会白屏）。 */
export function fontOptionOf(id: string | null | undefined): FontOption {
  return FONT_OPTIONS.find(option => option.id === id) ?? FONT_OPTIONS[0]!
}

/** 读持久化的选择（localStorage 不可用时回落默认档）。 */
export function readStoredFontId(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_FONT_ID
  try {
    return fontOptionOf(localStorage.getItem(FONT_STORE_KEY)).id
  } catch {
    return DEFAULT_FONT_ID
  }
}

/** 写持久化的选择（写失败静默：隐私模式下仍按内存值工作）。 */
export function writeStoredFontId(id: string): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(FONT_STORE_KEY, fontOptionOf(id).id) } catch { /* 忽略写入失败 */ }
}

/** 承载字体变量的 style 元素 id。 */
const STYLE_ID = 'dsh-chat-plus-ui-font'

/**
 * 把一份字体档写成根元素变量覆盖表。
 *
 * **选择器必须是 `html:root`，不能是 `html` 或 `:root`。**
 * 特异性算一下就知道：官方 base.css 把字体变量声明在 `:root` 上，那是
 * 伪类，特异性 (0,1,0)；`html` 是类型选择器，只有 (0,0,1) —— **更低**，
 * 写 `html` 会被官方原值压过，表现为「@font-face 明明加载成功、变量却没变」。
 * `html:root` 是类型 + 伪类 = (0,1,1)，稳定压过官方，且不依赖样式表插入顺序
 * （本插件的 `<style>` 与官方谁先谁后都不影响）。
 *
 * 这条是实机踩出来的：用 `html` 时页面里 `--dsw-font-family` 仍是官方原值，
 * 而 `document.fonts.check` 却是 true —— 字体白下载了，一个字都没用上。
 *
 * ## 为什么必须同时写四个变量（两层）
 *
 * 见文件头「变量分两层」：`--dsh-font-family-text` / `--dsh-font-family-code`
 * 是**上层可写槽位**，`--dsw-font-family` / `--ds-font-family-code` 是**下层消费值**。
 * 关键是 `body` 自己重新声明了下面两个（`var(--dsh-font-family-text, 默认), 默认`），
 * 于是 html 上写的下层值对 body 及后代**不生效**（元素自身声明压过继承），
 * 只有上层槽位能真正穿透下去。两个都写：上层负责真正生效，下层给直接读
 * `--dsw-font-family` 的地方兜底，且语义上「我选的就是这个字体」完整。
 * @param option - 选中的档位。
 * @returns CSS 文本。
 */
export function fontOverrideCss(option: FontOption): string {
  const rules = [
    'html:root{'
      + `--dsh-font-family-text:${option.body};`
      + `--dsh-font-family-code:${option.code};`
      + `--dsw-font-family:${option.body};`
      + `--ds-font-family-code:${option.code}`
      + '}',
  ]
  if (option.webfont !== undefined) {
    const { family, file } = option.webfont
    // font-display: swap —— 首帧先用回退字体渲染，字体到位后替换。
    // 用 block 会让整页文字在字体下载期间不可见（5MB 首拉有明显空窗）。
    rules.unshift(
      `@font-face{font-family:"${family}";src:url("${fontFileUrl(file)}") format("woff2");font-display:swap;font-weight:400;font-style:normal}`,
    )
  }
  return rules.join('\n')
}

/**
 * 应用字体档：写入/更新 `<style>` 覆盖变量。
 *
 * 幂等：重复调用同一档位只更新同一个 style 元素，不会堆叠。
 * @param option - 选中的档位。
 * @returns 移除该 style 元素的清理函数。
 */
export function applyFont(option: FontOption): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-chat-plus'
    tag.dataset.pluginCss = 'ui-font'
    document.head.appendChild(tag)
  }
  tag.textContent = fontOverrideCss(option)
  return () => {
    // 只在当前 style 仍是本模块写的那一份时移除，避免把后来者的覆盖删掉。
    if (document.getElementById(STYLE_ID) === tag) tag.remove()
  }
}

/**
 * 启动时按持久化值应用字体。
 *
 * 必须在插件 apply 阶段同步调用（而非等某个 React 组件挂载）：字体变量越早
 * 落到 `<head>`，首帧就越少一次「先用系统字体、再闪成所选字体」的跳变。
 * @returns 清理函数。
 */
export function applyStoredFont(): () => void {
  return applyFont(fontOptionOf(readStoredFontId()))
}

/**
 * 下拉框样式：逐字对齐官方 `ModelsSection.module.css` 的 `.input` + `.selectInput`
 * （见 src/client/provider/webui/blocks/shared.tsx 的 SELECT_STYLE，同一套规格）。
 */
export const FONT_SELECT_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: 32,
  padding: '0 32px 0 10px',
  borderRadius: 'var(--dsw-radius-md, 12px)',
  border: '0.5px solid var(--dsw-alias-border-l4, rgba(255,255,255,.2))',
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  appearance: 'none',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 14,
  lineHeight: '22px',
  cursor: 'pointer',
  minWidth: 0,
}
