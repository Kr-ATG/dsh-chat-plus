/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 共享前端 store（client 半身叶子模块）。
 *
 * 从 pill.tsx 抽出、供「顶部悬浮胶囊」与「左下角小横条卡片」共用：
 *  - 胶囊形态（卡片 / 悬浮）：dsh.donePill.mode
 *  - 总显隐开关：dsh.donePill.enabled
 *  - 外观（缩放 + 字体）：dsh.donePill.appearance
 *
 * 约束：本文件**不** import pill.tsx / sidebar-card.tsx（叶子，无循环依赖）；
 * 只做 localStorage 持久化 + 订阅通知，不碰任何 DSH 服务。
 */

/** 胶囊形态：card = 左下角小横条卡片；float = 顶部悬浮可拖拽胶囊。 */
export type PillMode = 'float' | 'card'

export const MODE_KEY = 'dsh.donePill.mode'

interface ModeStore {
  get: () => PillMode
  set: (next: PillMode) => void
  subscribe: (fn: (next: PillMode) => void) => () => void
}

function createModeStore(key: string): ModeStore {
  let value: PillMode = 'card'
  try {
    const raw = localStorage.getItem(key)
    // 历史版本没有该键：默认 'card'（左下角小横条，悬停看动态）；
    // 显式存过 'float' 的老用户继续保持悬浮。
    value = raw === 'float' ? 'float' : 'card'
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: PillMode) => void>()
  return {
    get: () => value,
    set(next) {
      if (next === value) return
      value = next
      try { localStorage.setItem(key, next) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

export const modeStore = createModeStore(MODE_KEY)

// ---- 总显隐开关（localStorage 持久化，默认显示）----

export const ENABLED_KEY = 'dsh.donePill.enabled'

function createEnabledStore(): {
  get: () => boolean
  set: (next: boolean) => void
  subscribe: (fn: (next: boolean) => void) => () => void
} {
  let value = true
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    if (raw === '0' || raw === 'false') value = false
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: boolean) => void>()
  return {
    get: () => value,
    set(next) {
      if (next === value) return
      value = next
      try { localStorage.setItem(ENABLED_KEY, next ? '1' : '0') } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

export const enabledStore = createEnabledStore()

// ---- 胶囊外观（大小缩放 + 字体风格，两种形态共用）----

export const APPEARANCE_KEY = 'dsh.donePill.appearance'

export interface AppearanceConfig {
  /** 缩放系数：0.8 ~ 1.6（1 = 默认）。 */
  scale: number
  /** 字体方案 id。 */
  font: string
}

/** 字体方案（Windows 常见字体栈）。 */
export const FONT_OPTIONS: Array<{ id: string; label: string; stack: string }> = [
  { id: 'system', label: '跟随系统', stack: '' },
  { id: 'yahei', label: '雅黑', stack: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { id: 'songti', label: '宋体 · 衬线', stack: "SimSun, 'Songti SC', serif" },
  { id: 'kaiti', label: '楷体 · 手写感', stack: "KaiTi, 'Kaiti SC', cursive" },
  { id: 'simhei', label: '黑体 · 厚重', stack: 'SimHei, sans-serif' },
  { id: 'mono', label: '等宽 · 代码', stack: "Consolas, 'Courier New', monospace" },
  { id: 'cute', label: '可爱 · 圆润', stack: "'Yuanti SC', 'YouYuan', '幼圆', 'HYWenHei-85W', 'Microsoft YaHei', sans-serif" },
  { id: 'comic', label: '可爱 · 漫画', stack: "'Comic Sans MS', 'Comic Neue', 'Segoe UI', cursive" },
]

export function fontStackOf(id: string): string {
  return FONT_OPTIONS.find(option => option.id === id)?.stack ?? ''
}

interface AppearanceStore {
  get: () => AppearanceConfig
  set: (next: AppearanceConfig) => void
  subscribe: (fn: (next: AppearanceConfig) => void) => () => void
}

function createAppearanceStore(key: string): AppearanceStore {
  let value: AppearanceConfig = { scale: 1, font: 'system' }
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<AppearanceConfig>
      value = {
        scale: typeof parsed?.scale === 'number' && Number.isFinite(parsed.scale)
          ? Math.min(1.6, Math.max(0.65, parsed.scale))
          : 1,
        font: typeof parsed?.font === 'string' ? parsed.font : 'system',
      }
    }
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: AppearanceConfig) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

export const appearanceStore = createAppearanceStore(APPEARANCE_KEY)

// ---- 录屏（screen recorder）配置：帧率可调，持久化 ----

export const REC_KEY = 'dsh.donePill.rec'

// 帧率范围/默认值与钳制函数在 rec-core.ts 单点定义（录制器与设置行共用），
// 此处 re-export 供 pill.tsx 的设置行按老路径取用。
export { REC_FPS_MIN, REC_FPS_MAX, REC_FPS_DEFAULT, clampFps } from './rec-core'
export { REC_WIDTH_OPTIONS, REC_WIDTH_DEFAULT, recWidthLabel, clampRecWidth } from './rec-core'
import { getFontRatio, subscribeFontRatio } from './font-axis'
import { REC_FPS_DEFAULT, REC_WIDTH_DEFAULT, clampFps, clampRecWidth } from './rec-core'

// ---- 官方字号轴（对话胶囊跟随「设置 → 字号」）----

/**
 * 字号比例 store：把 `font-axis.ts` 的订阅面包成本文件统一的 store 形态，
 * 供胶囊 / 小横条 / 提醒卡按同一个范式消费。
 *
 * **它是只读的**（没有 `set`）：真值由官方设置决定，插件只能读。
 * 与 `appearanceStore` 的关系是**正交**——
 *   `scale`  = 用户自设的「胶囊大小」（0.65–1.6，胶囊自己的开关）
 *   `ratio`  = 官方正文字号的比例（10/14–22/14，官方设置）
 * 两者相乘才是最终视觉尺寸，互不覆盖（见 pill.tsx 的 `--dps` 与 `--dpt`）。
 */
export interface FontRatioStore {
  get: () => number
  subscribe: (fn: (next: number) => void) => () => void
}

export const fontRatioStore: FontRatioStore = {
  get: () => getFontRatio(),
  subscribe(fn) {
    return subscribeFontRatio(() => { fn(getFontRatio()) })
  },
}

export interface RecConfig {
  /** 录制帧率（fps）。 */
  fps: number
  /** 输出宽度档位（px）；0 = 原始分辨率不缩放。 */
  width: number
}

interface RecStore {
  get: () => RecConfig
  set: (next: RecConfig) => void
  subscribe: (fn: (next: RecConfig) => void) => () => void
}

function createRecStore(key: string): RecStore {
  let value: RecConfig = { fps: REC_FPS_DEFAULT, width: REC_WIDTH_DEFAULT }
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<RecConfig>
      // 老配置没有 width 字段：落新默认档，不继承 undefined。
      value = {
        fps: typeof parsed?.fps === 'number' && Number.isFinite(parsed.fps) ? clampFps(parsed.fps) : REC_FPS_DEFAULT,
        width: typeof parsed?.width === 'number' && Number.isFinite(parsed.width) ? clampRecWidth(parsed.width) : REC_WIDTH_DEFAULT,
      }
    }
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: RecConfig) => void>()
  return {
    get: () => value,
    set(next) {
      const fps = clampFps(next.fps)
      const width = clampRecWidth(next.width)
      if (fps === value.fps && width === value.width) return
      value = { fps, width }
      try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(value)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

export const recStore = createRecStore(REC_KEY)
