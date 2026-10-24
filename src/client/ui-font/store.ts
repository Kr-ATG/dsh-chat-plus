/**
 * dsh-chat-plus — 界面字体偏好的单例 store。
 *
 * 为什么需要 store 而不是组件内 useState：字体是**全局**状态，写入路径是
 * 「改 CSS 变量 + 写 localStorage」，读取路径是「设置行显示当前值」。如果
 * 状态只活在设置行组件里，那么：
 *  - 设置行卸载重挂（切走再切回「通用」页）会重新读一次 localStorage，
 *    而 applyFont 已经在别处生效——两份真相一旦不同步就是「显示 A、实际 B」；
 *  - 启动时 applyStoredFont() 与设置行之间没有共同的可观测点。
 *
 * 用 useSyncExternalStore 订阅，写入只有一个入口（setFont），它负责
 * 落盘 + 改 DOM + 通知订阅者，三者原子完成，不存在中间态。
 *
 * 加载状态也放这里：切换到大体积 webfont 时，UI 需要如实告诉用户
 * 「正在下载 4.2MB」还是「加载失败、已回退系统字体」——静默等待会让人以为卡死。
 */
import { fontOptionOf, applyFont, readStoredFontId, writeStoredFontId } from './font.js'
import type { FontOption } from './font.js'

/** webfont 的加载状态。 */
export type FontLoadState = 'idle' | 'loading' | 'ready' | 'failed'

/** 对外快照：当前档位 + 加载状态。 */
export interface FontState {
  /** 当前生效的字体档 id。 */
  id: string
  /** 当前档位对应的完整选项。 */
  option: FontOption
  /** webfont 加载状态（系统字体档恒为 idle）。 */
  load: FontLoadState
}

type Listener = () => void

const listeners = new Set<Listener>()

let state: FontState = {
  id: readStoredFontId(),
  option: fontOptionOf(readStoredFontId()),
  load: 'idle',
}

/** 当前快照（useSyncExternalStore 的 getSnapshot 必须返回稳定引用）。 */
function getSnapshot(): FontState {
  return state
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(): void {
  for (const listener of listeners) {
    try { listener() } catch { /* 单个订阅者抛错不影响其余 */ }
  }
}

/**
 * 检测 webfont 是否真的可用。
 *
 * `document.fonts.load()` 在字体加载失败时也 resolve（返回空数组），所以不能
 * 用它判断成功——必须再用 `document.fonts.check()` 确认字形确实就位。
 * @param family - @font-face 的 family 名。
 * @returns 是否加载成功。
 */
async function probeWebfont(family: string): Promise<boolean> {
  if (typeof document === 'undefined' || document.fonts === undefined) return false
  try {
    await document.fonts.load(`16px "${family}"`, '霞鹜新致宋')
    return document.fonts.check(`16px "${family}"`)
  } catch {
    return false
  }
}

/**
 * 切换字体：落盘 + 改 DOM + 通知，三者一步到位。
 * @param id - 目标档位 id（未知 id 回落默认档）。
 */
export function setFont(id: string): void {
  const option = fontOptionOf(id)
  const changed = state.id !== option.id
  // 系统字体档无需加载：直接进 idle，UI 不显示进度。
  state = { id: option.id, option, load: option.webfont === undefined ? 'idle' : (changed ? 'loading' : state.load) }
  writeStoredFontId(option.id)
  applyFont(option)
  emit()

  if (option.webfont === undefined) return
  // 已确认加载过的档位不重复探测（切回来是即时生效，浏览器有缓存）。
  if (!changed && state.load === 'ready') return
  const { family } = option.webfont
  void probeWebfont(family).then((ok) => {
    // 探测期间用户可能又切走了：只在仍是同一档时才写回状态。
    if (state.id !== option.id) return
    state = { ...state, load: ok ? 'ready' : 'failed' }
    emit()
  })
}

/**
 * 启动初始化：按持久化值应用字体，并（若选中了 webfont 档）探测其可用性。
 *
 * 幂等：重复调用只重放一次同样的应用逻辑。
 */
export function initFont(): void {
  const option = fontOptionOf(readStoredFontId())
  state = { id: option.id, option, load: option.webfont === undefined ? 'idle' : 'loading' }
  applyFont(option)
  emit()
  if (option.webfont === undefined) return
  const { family } = option.webfont
  void probeWebfont(family).then((ok) => {
    if (state.id !== option.id) return
    state = { ...state, load: ok ? 'ready' : 'failed' }
    emit()
  })
}

export { getSnapshot, subscribe }
