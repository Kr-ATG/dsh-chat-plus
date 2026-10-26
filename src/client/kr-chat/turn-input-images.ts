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
 * 快照里**最新的一条**用户输入节点（user / steering，按 anchorSeq / seq 取最大）。
 *
 * @param snapshot - 官方 chat 快照。
 * @returns 最新用户输入节点；没有则 null。
 */
function collectLatestUserNode(snapshot: any): any | null {
  if (snapshot === null || snapshot === undefined) return null
  const seqOf = (node: any): number => {
    const candidates = [node?.anchorSeq, node?.data?.seq, node?.payload?.seq, node?.seq]
    for (const value of candidates) if (typeof value === 'number') return value
    return -1
  }
  const scan = (iterable: Iterable<any> | null | undefined): any | null => {
    let best: any | null = null
    let bestSeq = -1
    if (iterable === null || iterable === undefined) return null
    for (const node of iterable) {
      if (node === undefined || node === null) continue
      // steering（用户在一轮中途追发的消息）也承载用户输入，图可能从那儿来。
      if (node.kind !== 'user' && node.kind !== 'steering') continue
      const seq = seqOf(node)
      if (seq >= bestSeq) {
        bestSeq = seq
        best = node
      }
    }
    return best
  }
  try {
    if (typeof snapshot?.nodes?.values === 'function') {
      const found = scan(snapshot.nodes.values())
      if (found !== null) return found
    }
  } catch { /* 快照形状不认识：走 order */ }
  try {
    if (Array.isArray(snapshot?.order)) {
      const nodes: any[] = []
      for (const key of snapshot.order) {
        const node = snapshot?.nodes?.get?.(key)
        if (node !== undefined && node !== null) nodes.push(node)
      }
      return scan(nodes)
    }
  } catch { /* 同上 */ }
  return null
}

/**
 * 本轮用户输入里带了几张图片。
 *
 * @param snapshot - 官方 chat 快照。
 * @param turn - 本轮轮次号。
 * @param options - `latest: true` 表示调用方正在看**最新一轮**（而不是翻历史轮次），
 *   只在这种情况才允许"最新一条用户消息"兜底 —— 翻历史时若用最新消息兜底，
 *   会把"上一轮发的图"错算成"这一轮的图"，卡头就会在纯文字的历史轮次上演看图。
 * @returns 图片数量（0 = 没带图）。
 */
export function turnInputImageCount(
  snapshot: any,
  turn: number,
  options?: { readonly latest?: boolean },
): number {
  const counted = (nodes: readonly any[]): number => {
    let total = 0
    for (const node of nodes) {
      /*
       * content 三处都可能挂：`data`（官方 chatNode 的渲染负载 —— 实证见
       * dsh-client-ui-chat 的 messageDefinition：`content: event.data.content`
       * 被原样塞进 `data`）、`payload`（历史投影）、节点自身（扁平形状）。
       *
       * 三处**分别数**而不是 `??` 择一：官方节点只有 `data`，而某些投影会同时
       * 挂一个不含 content 的 `payload`；择一会在那种形状下漏判，等于整个动画
       * 都不演（正是这次要修的 bug 的同类）。
       */
      const data = node?.data
      const payload = node?.payload
      const own = node?.content
      total += countImages(data?.content)
      if (payload !== data) total += countImages(payload?.content)
      if (own !== data?.content && own !== payload?.content) total += countImages(own)
    }
    return total
  }

  const thisTurn = counted(collectTurnUserNodes(snapshot, turn))
  if (thisTurn > 0) return thisTurn
  if (options?.latest !== true) return 0
  /*
   * 兜底（仅限最新一轮）：按轮次没数到图时，再看**最新一条用户消息**。
   *
   * 用户刚把图发出去的那一刻，快照的 navigation 往往还没把 turn 号推进到新一轮，
   * 于是 `turn` 参数还停在上一轮 —— 按轮次过滤必然数不到。而此刻"最新一条
   * 用户消息"正是用户刚发的那条，语义上等价于"本轮输入"。
   *
   * 不会误报上一轮的图：用户若在本轮只发了文字，最新用户消息就是这条纯文字，
   * 数出来仍是 0；翻历史轮次时压根不走这条路（见 options.latest）。
   */
  const latest = collectLatestUserNode(snapshot)
  return latest === null ? 0 : counted([latest])
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
    if (turnInputImageCount(input.snapshot, input.turn, { latest: true }) > 0) return true
  } catch { /* 快照形状异常：退回工具名判据 */ }
  for (const name of input.toolNames) {
    if (IMAGE_READ_TOOLS.has(name)) return true
  }
  return false
}

/** 读图类工具名集合（调用方判缓存指纹要用，导出只读视图）。 */
export const IMAGE_READ_TOOL_NAMES: ReadonlySet<string> = IMAGE_READ_TOOLS
