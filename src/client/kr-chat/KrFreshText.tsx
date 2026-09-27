/**
 * dsh-chat-plus — 流式文本的平滑显影。
 *
 * DSH 推 reasoning 是**按块到达**的：一整行字常常在同一次更新里凭空出现，
 * 读起来就是「一行字突然出现」。这里把文本切成「已稳定的前缀」+「本次新增的
 * 一段」，只让新增段显影一次——旧内容不重播，否则每帧闪一次反而更碎。
 *
 * 新增段是**一个** span 配一道横向擦除的 mask，不是逐字 span：
 *  - 逐字 span 会把每个字符切成独立文本 run，中文的标点挤压、字距调整、连字
 *    全被 span 边界打断，「，」「。」后面拖出一截全角空隙，整段读起来「字体很
 *    别扭」——那不是字体问题，是排版被切碎了；
 *  - 一个 span 既保住了整段文本的排版，DOM 节点也只有 1 个（长思考几千字时
 *    逐字方案是几千个节点，展开即卡）。
 * 显影方向是自左向右擦出（mask 的黑色前沿从 0% 推到 100%），读作「正在被写出
 * 来」，又不像整块淡入那样是一坨同时冒出来。
 */
import { memo, useEffect, useRef } from 'react'

export interface KrFreshTextProps {
  readonly text: string
}

export const KrFreshText = memo(function KrFreshText({ text }: KrFreshTextProps) {
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

  if (fresh === '') {
    return <>{stable === '' ? null : <span className="kr-fresh-stable">{stable}</span>}</>
  }

  /*
   * 三段式节点结构：已显示的部分整体一个节点（它不再动了），新增段再一个节点。
   * 流式每帧的 diff 规模因此恒为 2，与全文总字数无关。
   * key 用新增段的起点：同一段内继续追加不会重播动画，换段才重播一次。
   */
  return (
    <>
      {stable === '' ? null : <span className="kr-fresh-stable">{stable}</span>}
      <span key={stable.length} className="kr-fresh-run">{fresh}</span>
    </>
  )
})
