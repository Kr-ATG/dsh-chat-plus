/**
 * dsh-chat-plus — 流式文本的平滑显影。
 *
 * DSH 推 reasoning 是**按块到达**的：一整行字常常在同一次更新里凭空出现，
 * 读起来就是「一行字突然出现」。这里把文本切成「已稳定的前缀」+「本次新增的
 * 一段」，只让新增段淡入一次——旧内容不重播，否则每帧闪一次反而更碎。
 *
 * 逐字 span + 递增 delay，而不是整段一起淡：整段一起淡仍然是一块状地冒出来，
 * 逐字错峰才读作「正在被写出来」。span 是 inline，不改变布局，也不影响
 * pre-wrap 的换行与缩进还原。
 *
 * 纯 opacity、没有位移：带位移的逐字显影会被读成「一跳一跳」，那是上一版
 * 状态卡逐字动画被砍掉的原因。
 */
import { memo, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

export interface KrFreshTextProps {
  readonly text: string
  /** 相邻两字的淡入间隔（毫秒）。 */
  readonly step?: number
  /** 错峰字数上限：超过这个字数后的字同时淡入，避免长片段拖出一条长尾。 */
  readonly cap?: number
  /**
   * 逐字显影的字数上限。超过就整段一次性淡入。
   *
   * 逐字意味着一个字符一个 span：整段几千字挂满时是几千个 DOM 节点，每次流式
   * 更新都要 diff 一遍，展开长思考时肉眼可见地卡。超过这个量级，整段一起淡入
   * 观感损失很小（本来就是一大块新内容），节点数却从几千降到 1。
   */
  readonly maxStaggerChars?: number
}

export const KrFreshText = memo(function KrFreshText({
  text,
  step = 12,
  cap = 28,
  maxStaggerChars = 400,
}: KrFreshTextProps) {
  const previousRef = useRef<string | null>(null)
  // 纯追加（流式的常态）时前缀即已稳定部分；一旦不是追加（重写、截断、换了一条
  // 思考），整段当作新增，绝不留一段永远不更新的旧文本。
  const stable = previousRef.current !== null && text.startsWith(previousRef.current)
    ? previousRef.current
    : ''
  const fresh = text.slice(stable.length)
  useEffect(() => {
    previousRef.current = text
  }, [text])

  if (fresh === '') return <>{stable === '' ? null : <span className="kr-fresh-stable">{stable}</span>}</>

  /*
   * 三段式节点结构，是为了让「已显示的部分」永远只占一个 DOM 节点：
   * stable 整体一个 span（它不再动，逐字包裹毫无意义），只有 fresh 逐字。
   * 流式每帧的 diff 规模因此是 1 + 新增字数，而不是全文总字数。
   */
  return (
    <>
      {stable === '' ? null : <span className="kr-fresh-stable">{stable}</span>}
      {/* key 用新增段的起点：同一段内继续追加不会重播动画，换段才重播一次。 */}
      {Array.from(fresh).length > maxStaggerChars ? (
        <span key={stable.length} className="kr-fresh kr-fresh--bulk">{fresh}</span>
      ) : (
        <span key={stable.length} className="kr-fresh-run">
          {Array.from(fresh).map((character, index) => (
            <span
              key={index}
              className="kr-fresh"
              style={{ animationDelay: `${Math.min(index * step, (cap - 1) * step)}ms` } as CSSProperties}
            >
              {character}
            </span>
          ))}
        </span>
      )}
    </>
  )
})
