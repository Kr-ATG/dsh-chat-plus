/**
 * dsh-chat-plus — 界面字体的纯逻辑测试面（供 smoke-client 直接断言）。
 *
 * 为什么单独开一个文件而不是就地导出：这些导出只服务于冒烟，放进功能模块的
 * 公共面会让「这个模块对外提供什么」变得含糊。测试面集中在 `__test` 命名下，
 * 语义明确（照 tools-gate / gallery / office 的既有约定）。
 */
import {
  FONT_OPTIONS,
  DEFAULT_FONT_ID,
  fontOptionOf,
  fontOverrideCss,
  fontFileUrl,
  readStoredFontId,
  writeStoredFontId,
  FONT_STORE_KEY,
} from './font.js'
/** 测试面聚合：smoke 通过 client 产物的 `uiFontTest` 取到这些纯函数。 */
export const __test = {
  FONT_OPTIONS,
  DEFAULT_FONT_ID,
  fontOptionOf,
  fontOverrideCss,
  fontFileUrl,
  readStoredFontId,
  writeStoredFontId,
  FONT_STORE_KEY,
} as const
