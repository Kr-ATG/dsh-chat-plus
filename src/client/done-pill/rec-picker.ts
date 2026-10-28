/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 录屏目标选择面板的 store 与数据拉取（叶子模块）。
 *
 * 壳内没有屏幕/窗口选择器时，点录屏按钮弹这个面板，三种目标：
 *  - 整屏：整个主屏（原路径，getUserMedia chromeMediaSource:desktop）；
 *  - 框选区域：先在整屏快照上拖一个矩形，之后只录这一块（同整屏流 + 裁剪）；
 *  - 窗口：host 侧用 PrintWindow 抓那个窗口自己（**免遮挡**，支持子窗口）。
 *
 * 窗口列表来自 GET /api/dsh-companion/rec-windows（host 枚举窗口树，含子窗口
 * 与父子归属）；抓帧走 GET /api/dsh-companion/rec-frame（见 recorder 的
 * window-source 路径）。
 *
 * 纯浏览器不走这里：那边 getDisplayMedia 有原生选择器，直接弹系统的。
 */
// 显式 .ts 扩展名：本模块被裸 node 单测直接 import（tests/rec-picker.test.mjs），
// node 的 TS 剥离模式不做扩展名解析，写 './rec-core' 会 ERR_MODULE_NOT_FOUND
// （esbuild 两种写法都认，构建不受影响；notify-center.ts 同样处理 session-nav）。
import { orderWindowTree, type RecRect, type RecWindowRow } from './rec-core.ts'

/** host 枚举的可见窗口（含子窗口）。 */
export type RecWindow = RecWindowRow

/** 选择面板里的目标种类。 */
export type RecPickKind = 'full' | 'region' | 'window'

const WINDOWS_ROUTE = '/api/dsh-companion/rec-windows'
/** 抓帧路由（recorder 用；这里导出常量避免路径两处各写一份）。 */
export const REC_FRAME_ROUTE = '/api/dsh-companion/rec-frame'

/** 拉取可见窗口树；路由不存在/失败一律空列表（面板退化为只有整屏+框选）。 */
export async function fetchRecWindows(): Promise<RecWindow[]> {
  try {
    const res = await fetch(WINDOWS_ROUTE, { cache: 'no-store' })
    if (!res.ok) return []
    const body = (await res.json()) as { ok?: boolean; windows?: RecWindow[] }
    if (!Array.isArray(body?.windows)) return []
    // 只保留字段完整的条目：缺 hwnd 的条目既抓不了帧也跟不了踪，显示了是骗人。
    const rows = body.windows.filter((w) =>
      w !== null && typeof w === 'object'
      && typeof w.hwnd === 'number' && w.hwnd !== 0
      && typeof w.pid === 'number'
      && typeof w.title === 'string' && typeof w.cls === 'string'
      && typeof w.x === 'number' && typeof w.y === 'number'
      && typeof w.w === 'number' && typeof w.h === 'number'
      && typeof w.parentHwnd === 'number' && typeof w.depth === 'number')
    return orderWindowTree(rows)
  } catch {
    return []
  }
}

interface PickerState {
  open: boolean
}

let state: PickerState = { open: false }
const listeners = new Set<(next: PickerState) => void>()

function publish(next: PickerState): void {
  state = next
  for (const fn of [...listeners]) {
    try { fn(state) } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

/** 选择面板开关 store（recorder 开、面板组件关）。 */
export const pickerStore = {
  get: (): PickerState => state,
  subscribe(fn: (next: PickerState) => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  open(): void {
    if (!state.open) publish({ open: true })
  },
  close(): void {
    if (state.open) publish({ open: false })
  },
}

/** 框选 overlay 的开关 store（面板点「框选区域」→ overlay 开；拖完/取消 → 关）。 */
interface RegionState {
  open: boolean
}

let regionState: RegionState = { open: false }
const regionListeners = new Set<(next: RegionState) => void>()

function publishRegion(next: RegionState): void {
  regionState = next
  for (const fn of [...regionListeners]) {
    try { fn(next) } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

/** 框选 store：overlay 组件订阅它决定挂载，交互结束由 overlay 自己 close。 */
export const regionStore = {
  get: (): RegionState => regionState,
  subscribe(fn: (next: RegionState) => void): () => void {
    regionListeners.add(fn)
    return () => { regionListeners.delete(fn) }
  },
  open(): void {
    if (!regionState.open) publishRegion({ open: true })
  },
  close(): void {
    if (regionState.open) publishRegion({ open: false })
  },
}

/** 目标描述（面板 → recorder 的载荷；与 recorder.RecTarget 对齐）。 */
export type RecPickTarget =
  | { kind: 'full' }
  | { kind: 'region'; rect: RecRect }
  | { kind: 'window'; hwnd: number; pid: number; title: string }
