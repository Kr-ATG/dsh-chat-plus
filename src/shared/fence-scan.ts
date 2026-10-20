/**
 * dsh-chat-plus — 代码围栏扫描（纯字符串，无 DOM / 无 React / 无副作用）。
 *
 * 四条卡片通道（html / iu / diagram / proto-tabs）**共用这一份**。此前
 * findOpenFence 在 html-embed/parse.ts 与 iu/parse.ts 各有一份逐字相同的副本，
 * 再加 diagram / proto 就等于四份；任何一处判据变化（比如缩进上限从 3 改成 4）
 * 都会让四条通道对同一段 markdown 给出不同切分——那种漂移不会报错，只会让某种
 * 围栏在流式期表现异常。
 *
 * 放在 src/shared 而不是 src/client：它是纯函数，host 侧将来要给模型做发前
 * 校验（validate 工具）时可以直接复用同一份判据，不必再写一遍。
 */

/**
 * 找出文本里**最后一个未闭合**的代码围栏。
 *
 * 逐行 toggle：遇到围栏标记行就在「围栏内 / 围栏外」之间翻转，扫完仍在围栏
 * 内的那个就是没闭合的。返回语言标记、标记行起点、正文起点。
 *
 * 逐行扫描而不是正则：这里要处理的正是「正则匹配不了」的输入（半截围栏），
 * 用正则会退化成贪婪匹配，把后面所有正文一起吞掉。
 *
 * @param text - 已切掉全部闭合围栏之后的尾部文本。
 * @returns 未闭合围栏的位置与语言；没有则 undefined。
 */
export function findOpenFence(
  text: string,
): { lang: string; fenceStart: number; bodyStart: number } | undefined {
  let open: { lang: string; fenceStart: number; bodyStart: number } | undefined
  let cursor = 0
  for (const line of text.split('\n')) {
    const lineStart = cursor
    cursor += line.length + 1
    const fence = /^\s{0,3}(?:`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/.exec(line)
    if (fence === null) continue
    if (open === undefined) {
      open = { lang: (fence[1] ?? '').toLowerCase(), fenceStart: lineStart, bodyStart: cursor }
    } else {
      open = undefined
    }
  }
  return open
}

/**
 * 把「已闭合部分之后的尾巴」切成 [围栏前的 md, 占位卡正文]。
 *
 * 四条通道的流式分支逻辑完全同构：围栏前的内容照常走 markdown，围栏内的半截
 * 正文交给占位卡。这里收敛成一次调用，调用方只判断 `pending` 存不存在。
 *
 * @param tail - 切掉所有闭合围栏之后的尾部文本。
 * @param lang - 本条通道的语言标记（html / iu / diagram / proto-tabs）。
 * @returns `before` 是围栏前的 markdown（可能为空串），`partial` 是已写出的
 *   半截正文；尾部没有该语言的未闭合围栏时返回 undefined。
 */
export function openFenceTail(
  tail: string,
  lang: string,
): { before: string; partial: string } | undefined {
  if (tail === '') return undefined
  const open = findOpenFence(tail)
  if (open === undefined || open.lang !== lang) return undefined
  return { before: tail.slice(0, open.fenceStart), partial: tail.slice(open.bodyStart) }
}
