/**
 * dsh-chat-plus — 「本轮用户输入里带了图片」的判定。
 *
 * ## 它解决什么问题
 *
 * 用户发一张图（或图 + 文字）过来时，卡头那一刻**什么都没在跑**：模型还在读
 * 上下文、还没有任何工具调用，于是 `plainTimeline.steps` 是空的 →
 * `stageModeOf` 判出 `thinking` → 卡头直接播「思考中」。
 *
 * 但用户看到的事实是「我给了她一张照片」—— 她这时候应该先去**看**那张图。
 * 卡头演「查看照片」才和用户的心智对上（用户 2026-10-26 点名要这个）。
 *
 * ## 为什么不是「等 read_image 跑起来再演」
 *
 * `photo` 那一段原本只由 PHOTO_ICONS（image / fileView / eye 三个图标）触发，
 * 而它要求**有一条工具调用正在跑**。图片是在模型这一步的**输入**里，不是某个
 * 工具的产出 —— 模型看到图之后往往直接开始写回答，一次工具都不调，于是照片
 * 动画永远等不到。所以判据必须提前到「用户输入里有没有图片」。
 *
 * ## 判定口径（两条，任一成立即算）
 *
 *  1. 用户消息（`kind === 'user'` / `'steering'`）的 `content` 里有一个
 *     `{ type: 'image', attachment }` 内容块 —— 这是官方 `user/message` 事件的
 *     真实形状（见 dsh-llm 的 ContentBlockMap / ImageBlock）。
 *  2. 消息列表里根本没有 user 节点（快照未就绪 / 历史截断），但本轮**已经**
 *     跑过读图类工具 —— 退化成「事后」判据，总比不演好。
 *
 * 纯函数、不做任何缓存：调用方按轮次算一次就够了。
 *
 * @module
 */

/** 读图类工具名（与 plain-language 的图标映射不同源：这里只关心"读了图"）。 */
const IMAGE_READ_TOOLS: ReadonlySet<string> = new Set([
  'read_image',
  'vision_describe',
  'vision',
  'view_image',
])

/**
 * 从一条消息节点的 `content` 里数图片块。
 *
 * 形状防御式取：`type === 'image'` 或 `kind === 'image'` 都认（宿主两套投影
 * 历史上都用过），有 `attachment` 才算。
 *
 * @param content - 消息的 content 数组（可能不存在）。
 * @returns 图片块数量。
 */
function countImages(content: unknown): number {
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as { type?: unknown; kind?: unknown; attachment?: unknown }
    if (record.type !== 'image' && record.kind !== 'image') continue
    if (record.attachment === undefined || record.attachment === null) continue
    n += 1
  }
  return n
}

/**
 * 快照里「本轮」的节点遍历器。
 *
 * 与 collectTurnNodes 同一套三层扫描（locations.getTurn → nodes.values → order），
 * 但**只要 user / steering 节点**，而且不依赖 turn 号：用户消息的 location 常常
 * 是它自己那一轮的第一个 step，用 turn 号过滤反而会漏。
 *
 * @param snapshot - 官方 chat 快照（形状未知，全程防御）。
 * @returns 本轮出现过的 user / steering 节点数组。
 */
function collectTurnUserNodes(snapshot: any, turn: number): any[] {
  if (snapshot === null || snapshot === undefined) return []
  const seen = new Set<string>()
  const out: any[] = []
  const add = (node: any): void => {
    if (node === undefined || node === null) return
    const kind = node.kind
    if (kind !== 'user' && kind !== 'steering') return
    const key = typeof node.key === 'string' ? node.key : `seq:${String(node.payload?.seq ?? node.data?.seq ?? '')}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(node)
  }
  const turnOf = (node: any): number | undefined => {
    const data = node?.data
    if (typeof data?.turn === 'number') return data.turn
    const loc = node?.location
    if (typeof loc?.turn === 'number') return loc.turn
    if (typeof loc?.turn?.turn === 'number') return loc.turn.turn
    return undefined
  }
  try {
    const keys = snapshot?.locations?.getTurn?.(turn)
    if (Array.isArray(keys)) for (const key of keys) add(snapshot?.nodes?.get?.(key))
  } catch { /* 快照形状不认识：继续走下一层 */ }
  try {
    if (typeof snapshot?.nodes?.values === 'function') {
      for (const node of snapshot.nodes.values()) {
        const t = turnOf(node)
        if (t === undefined || t === turn) add(node)
      }
    }
  } catch { /* 同上 */ }
  try {
    if (Array.isArray(snapshot?.order)) {
      for (const key of snapshot.order) {
        const node = snapshot?.nodes?.get?.(key)
        const t = turnOf(node)
        if (t === undefined || t === turn) add(node)
      }
    }
  } catch { /* 同上 */ }
  return out
}

/**
 * 本轮用户输入里带了几张图片。
 *
 * @param snapshot - 官方 chat 快照。
 * @param turn - 本轮轮次号。
 * @returns 图片数量（0 = 没带图）。
 */
export function turnInputImageCount(snapshot: any, turn: number): number {
  let total = 0
  for (const node of collectTurnUserNodes(snapshot, turn)) {
    // 节点自身就是 user 消息：payload / data 两处都可能放 content。
    const payload = node?.payload ?? node?.data ?? node
    total += countImages(payload?.content)
  }
  return total
}

/**
 * 本轮是否**在读图**（卡头该演「查看照片」）。
 *
 * @param input.snapshot - 官方 chat 快照（可为 null）。
 * @param input.turn - 本轮轮次号。
 * @param input.toolNames - 本轮已出现的工具名（读图类工具的事后兜底）。
 * @returns 是否该播照片动画。
 */
export function shouldPlayPhotoStage(input: {
  readonly snapshot: any
  readonly turn: number
  readonly toolNames: readonly string[]
}): boolean {
  try {
    if (turnInputImageCount(input.snapshot, input.turn) > 0) return true
  } catch { /* 快照形状异常：退回工具名判据 */ }
  for (const name of input.toolNames) {
    if (IMAGE_READ_TOOLS.has(name)) return true
  }
  return false
}

/** 读图类工具名集合（调用方判缓存指纹要用，导出只读视图）。 */
export const IMAGE_READ_TOOL_NAMES: ReadonlySet<string> = IMAGE_READ_TOOLS
