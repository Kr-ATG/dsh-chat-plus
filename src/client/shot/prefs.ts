/**
 * dsh-chat-plus — 对话截图面板的选项持久化（纯客户端，走 localStorage）。
 *
 * ## 为什么是 localStorage 而不是 host settings
 *
 * 截图面板的六项选择（范围 / 宽度 / 画质 / 主题 / 标题 / 徽章）全是**纯呈现
 * 偏好**：跟 host 无关、跟会话无关，刷新页面就该记住。按项目既有先例
 * （`dsh.kr_chat.panel_width`、`dsh.chat_plus.iu_zoom`），这类偏好一律走
 * localStorage —— 改完刷新即生效，不需要重启 DSH、也不需要动 host。
 *
 * ## 为什么「未编辑」要单独记成 null
 *
 * 标题与主题有各自的**动态默认值**，不能拿写死的值当默认：
 *  - 标题默认是本次对话标题（换一条消息就不同）；
 *  - 主题默认跟随界面深浅色 + 玻璃质感开关（用户改外观就该跟着变）。
 *
 * 若把这两项一上来就落盘，用户只是打开面板看一眼、什么都没改，下次就会看到
 * 上一条消息的标题、或一个和当前外观不符的主题。所以用 null 表示「用户没动过，
 * 继续跟随默认」，只有真正手动改过才写进存储。
 *
 * ## 存储形状
 *
 * 一个 JSON 对象而不是六个 key：字段少、读写一次完成。**但校验逐字段做**，
 * 某个字段脏了只让那一个回默认，不会因为一处坏值把整份偏好丢掉。
 */

import type { ShotTheme } from './api.ts'
import type { ShotRange } from './collect.ts'
import { DEFAULT_WIDTH, WIDTH_MAX, WIDTH_MIN, type ShotQuality } from '../../shot/presets.ts'

/** 面板全部可持久化选项。 */
export interface ShotPrefs {
  /** 截图范围。 */
  range: ShotRange
  /** 截图主题；null = 用户没选过，跟随当前界面主题。 */
  theme: ShotTheme | null
  /** 卡片排版宽度（CSS px）。 */
  width: number
  /** 输出画质档。 */
  quality: ShotQuality
  /** 卡片标题；null = 用户没编辑过，跟随会话 / 本次对话标题。 */
  title: string | null
  /**
   * 上面那个标题属于哪条消息（面板传入的 messageKey）。
   *
   * 标题与其他项不同：它的**默认值**是「本次对话标题」，每条消息都不同。
   * 不做锚定的话，给 A 消息起的标题会在打开 B 消息的截图面板时冒出来，
   * 看起来像 bug。锚定后换消息即回落当前对话标题，同一条消息内则记得住。
   */
  titleFor: string | null
  /** 页头徽章；null = 用户没编辑过，用默认徽章。 */
  label: string | null
}

/** 默认徽章文案。 */
export const DEFAULT_LABEL = 'Kr'

/** 持久化键。 */
const KEY = 'dsh.chat_plus.shot_options'

/** 标题 / 徽章的长度上限（与面板输入框的 maxLength 一致）。 */
const TEXT_MAX = 80

const RANGES: readonly ShotRange[] = ['reply', 'turn', 'all']
const THEMES: readonly ShotTheme[] = ['light', 'reader', 'dark', 'glass', 'glass-dark']
const QUALITIES: readonly ShotQuality[] = ['1080p', '2k', '4k']

/** 默认偏好（读取失败 / 首访时的起点）。 */
export function defaultShotPrefs(): ShotPrefs {
  return { range: 'reply', theme: null, width: DEFAULT_WIDTH, quality: '2k', title: null, titleFor: null, label: null }
}

/** 读一段合法文本（null 表示「没编辑过」，空串表示「编辑后清空」）。 */
function parseText(input: unknown): string | null {
  if (typeof input !== 'string') return null
  return input.slice(0, TEXT_MAX)
}

/** 把未知值规整成合法偏好（逐字段校验，坏字段单独回默认）。 */
function coerce(raw: unknown): ShotPrefs {
  const base = defaultShotPrefs()
  if (raw === null || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>
  const range = RANGES.find(item => item === record.range)
  const theme = THEMES.find(item => item === record.theme)
  const quality = QUALITIES.find(item => item === record.quality)
  const width = typeof record.width === 'number' && Number.isFinite(record.width)
    ? Math.round(record.width)
    : NaN
  return {
    range: range ?? base.range,
    theme: theme ?? base.theme,
    // 宽度钳在合法区间：这个值直接决定排版宽度，脏数据会把卡片撑成一屏一个字。
    width: Number.isNaN(width) ? base.width : Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, width)),
    quality: quality ?? base.quality,
    title: parseText(record.title),
    titleFor: typeof record.titleFor === 'string' ? record.titleFor : null,
    label: parseText(record.label),
  }
}

/**
 * 读面板偏好。
 *
 * 无痕模式 / 存储被禁用时访问会抛（Safari 与部分企业策略），一律吞掉并回默认值：
 * 偏好读不出来只是「不记住」，绝不该让面板打不开。
 */
export function readShotPrefs(): ShotPrefs {
  try {
    if (typeof localStorage === 'undefined') return defaultShotPrefs()
    const raw = localStorage.getItem(KEY)
    if (raw === null) return defaultShotPrefs()
    return coerce(JSON.parse(raw) as unknown)
  } catch {
    return defaultShotPrefs()
  }
}

/**
 * 改几项并落盘（其余字段原样保留）。
 *
 * 读-改-写整份对象：面板每次只动一项，若直接覆盖写就会把别的项抹成默认。
 * 写失败（配额满 / 无痕模式）静默忽略 —— 本次交互照常，只是下次不记住。
 * @param patch - 要更新的字段。
 */
export function patchShotPrefs(patch: Partial<ShotPrefs>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify({ ...readShotPrefs(), ...patch }))
  } catch {
    // 写不进去就算了，不影响本次交互。
  }
}
