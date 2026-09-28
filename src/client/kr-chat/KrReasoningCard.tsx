/**
 * dsh-chat-plus — 思考过程卡片（带电灯泡图标、实时跟随滚动）。
 *
 * 座位（2026-09-28 起）：**贴在 KR 对话流里**，由 assistant-step 座位挂在本回合
 * 第一条助手节点上（见 ThinkingStepNodeView），右栏大盘里那张已整块移除——
 * 思考是「这一轮正文的一部分」，摆在右栏等于要用户来回对照两栏才能把一段思考
 * 和它对应的回答读在一起。普通「对话」视图不挂这张卡（那边由官方 ReasoningRow
 * 自己渲染）。
 *
 * 行为：
 * 1. **实时滚动**：思考流式增长时视口自动跟到底，新内容逐行出现；复用对话流
 *    实时轨道那套 `useSteppedFollow`（同一节拍与手感）。
 * 2. **可手动截停**：向上滚动即停住跟随（读者要往回看时不会被拽走），
 *    滚回底部（≤24px）自动恢复；选中文字期间也不跟随。
 * 3. **行数封顶**：视口高度按 `maxRows` 行封顶（见 CSS --kr-reasoning-rows），
 *    超出部分在视口内滚动，不再把卡片撑成长条。
 * 4. **回合进行中自动展开、收口自动折叠**（`inline` 模式）：思考正在长的时候
 *    摊开给人看，模型转入总结后自动收成标题一行（带动画），让位给正式回答。
 *    历史轮次进来就是折叠态，点标题行随时能展开重读。
 *
 * 与旧版的差异：旧版是「默认 3 条 + 展开其余 N 项」的静态列表；现在改成
 * 有界视口内的完整文本流——内容不再被截断，滚动由用户掌控。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useHeightAnimation, useMotionAllowed, useSteppedFollow } from '../motion-utils.ts'
import { KrFreshText } from './KrFreshText.tsx'

/**
 * 视口最多显示的行数（超出在视口内滚动）。
 *
 * 16 行 ≈ 307px：对话流里这条卡要「看得见但别抢正文」，12 行太紧读不出本轮
 * 思路的走向，20 行以上又开始压过正式回答。留 16 行是「读得到走向，正式回答
 * 仍在视野中心」之间的平衡点。
 */
export const REASONING_MAX_ROWS = 16

/**
 * 尾部窗口一次挂多少行。
 *
 * 视口只有 16 行，60 行足够滚四五屏仍不用「向上翻」；再往上翻才是明确的
 * 「我要读很早以前那段」意图。挂 60 行 ≈ 120 个节点，而整轮思考可达上千行
 * ——这一条界线就是卡与不卡的差别。
 */
const WINDOW_ROWS = 60

export interface ReasoningCardProps {
  readonly reasoningTexts: readonly string[]
  readonly running: boolean
  /**
   * 视口行数上限。默认 REASONING_MAX_ROWS。
   *
   * 内联模式（对话流）不再有右栏挤压问题，这个值由调用方按需给；右栏模式保留
   * 该 prop 是为兼容仍在传的 maxRows。
   */
  readonly maxRows?: number
  /**
   * 内联模式：回合的**总结卡出现**（`summarizing`）时收拢，此前一直展开。
   *
   * true 时：总结卡一出现就播一次高度收拢动画并停在折叠态（用户此后仍可点
   * 标题行展开）。判据必须是**翻转**而不是 `summarizing` 的持续态——后者会在
   * 用户手动展开历史轮次后被下一次重渲染立刻按回去，「点开看看」这个动作
   * 根本留不住。
   */
  readonly summarizing?: boolean
  /**
   * 内联模式：贴在对话流里。默认按 running 决定初始展开/折叠；显式传
   * summarizing 时改按它决定（收口 → 折叠）。
   */
  readonly inline?: boolean
}

export const KrReasoningCard = memo(function KrReasoningCard({
  reasoningTexts,
  running,
  maxRows = REASONING_MAX_ROWS,
  summarizing = false,
  inline = false,
}: ReasoningCardProps) {
  // 初始态：内联且已出总结 → 折叠；其余（跑着 / 历史轮次）按旧口径。
  const settled = summarizing || !running
  const [collapsed, setCollapsed] = useState(inline ? settled : false)
  const motion = useMotionAllowed(true)

  /*
   * 收口自动折叠：只在 summarizing 由 false→true 的**那一次**翻转上触发。
   */
  const wasSettlingRef = useRef(summarizing)
  useEffect(() => {
    const was = wasSettlingRef.current
    wasSettlingRef.current = summarizing
    if (!inline || !summarizing || was) return
    setCollapsed(true)
  }, [inline, summarizing])

  /*
   * 完整保留：只按行拆开、去掉空行，不做任何"要点抽取"。
   *
   * 原来这里是「优先编号行」：全文里只要出现任意一行以数字开头（/^\d+[\.、\s]/），
   * 就只保留这些行，其余整段丢掉。后果是思考里绝大多数自然语言行凭空消失——
   * 模型写的是段落，屏幕上只剩它偶尔列出的几行清单。而且这个正则还会误判：
   * "401 Unauthorized。看 console 错误。" 以 401 + 空格开头，会被当成编号行
   * 留下，真正没有序号的句子反被删掉，整轮思考被抽成一堆残骸。
   *
   * 这也正是"内容突然更替"的来源：numbered 集合会随模型吐出编号而突变，
   * 一次 filter 就把整屏内容换掉，与 KrFreshText 设计的"只增不减"直接冲突。
   *
   * 思考过程卡要的就是"看模型当时怎么想的"，摘要化在这里只有坏处——视口本来
   * 就按行封顶滚动（--kr-reasoning-rows），高度不需要靠砍行数来控制。
   */
  const points = useMemo(() => {
    const full = reasoningTexts.join('\n')
    if (!full.trim()) return [] as readonly string[]
    return full.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  }, [reasoningTexts])

  /*
   * 跟随探针：**只放长度指纹，不放全文**。
   *
   * 原来探针是 `points.join('\u0000')` ——整轮思考拼成一个大字符串。流式期每个
   * delta 都要重建一次这个几万字符的字符串、再作为 useLayoutEffect 的依赖做一次
   * 全量比较，思考越长每帧越贵。指纹用长度序列（同 KrAgentPanel 的
   * fingerprintTurnData）：思考是纯追加流式，长度序列单调增长，指纹变即内容变。
   */
  const probe = useMemo(
    () => `${running ? '1' : '0'}:${points.length}:${points.map((p) => p.length).join(',')}`,
    [points, running],
  )
  const followActive = running && !collapsed
  const { ref, onScroll, onWheel, edges, overflow, following } =
    useSteppedFollow(probe, followActive, motion)
  // 折叠/展开的高度补间（收口那一帧看得见让位过程）。
  const { ref: bodyRef, present: bodyPresent } = useHeightAnimation(!collapsed, motion)

  /*
   * 尾部窗口：只把最后 WINDOW_ROWS 行挂进 DOM。
   *
   * `windowSize` 是**用户意愿**（点过几次「向上翻」），内容增长时不清零——否则
   * 思考每长一段就把用户翻出来的上文又收回去，那一下比一开始就不给更气人。
   */
  const [windowSize, setWindowSize] = useState(WINDOW_ROWS)
  const startIndex = Math.max(0, points.length - windowSize)
  const windowed = startIndex === 0 ? points : points.slice(startIndex)
  const hiddenCount = startIndex

  if (reasoningTexts.length === 0 && !running) return null

  const hasContent = points.length > 0
  const open = !collapsed

  return (
    <div className="kr-card kr-card--reasoning" data-inline={inline || undefined} data-open={open || undefined}>
      <div
        className="kr-card__header"
        onClick={() => setCollapsed((value) => !value)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setCollapsed((value) => !value)
          }
        }}
      >
        <span className="kr-card__icon">
          {/* 电灯泡线框无色彩矢量图标 */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 13h4M6.5 15h3M6 10.5c-.7-.7-1.5-1.7-1.5-3a4.5 4.5 0 1 1 9 0c0 1.3-.8 2.3-1.5 3-.5.5-.8 1.2-.8 2h-4.4c0-.8-.3-1.5-.8-2z" />
          </svg>
        </span>
        <span className="kr-card__title">
          思考过程 {hasContent ? `(${points.length})` : running ? '(思考中…)' : ''}
        </span>
        {/*
         * 折叠时的一枚小 chevron：内联模式下这张卡收口后只剩标题一行，
         * 没有它用户不知道点标题还能展开（.kr-card__chevron 旧样式已随右栏
         * 那套删除，这里内联卡自己带一枚，跟着 data-open 转 90°）。
         */}
        <span className="kr-reasoning-chevron" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6.2 8 10.2l4-4" />
          </svg>
        </span>
        {/* 跟随状态提示：截停时给出明确反馈（否则用户不知道为何不再滚动） */}
        {followActive && overflow && (
          <span className="kr-card__follow" data-following={following ? 'true' : 'false'}>
            {following ? '跟随中' : '已暂停'}
          </span>
        )}
      </div>

      {/*
       * 折叠体走 useHeightAnimation：收口那一帧是「高度从当前量归零」的补间，
       * 不是内容瞬间消失。思考卡此刻正贴在正式回答上方，让位的过程被看见，
       * 回答才是「顶上来」的而不是「被替换掉的」。
       */}
      {(bodyPresent || open) && (
        <div
          ref={bodyRef}
          className="kr-reasoning-list"
          data-open={open || undefined}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          {hasContent ? (
            <div
              className="kr-reasoning-view"
              data-edges={edges}
              data-following={followActive && following ? 'true' : undefined}
              ref={ref}
              onScroll={onScroll}
              onWheel={onWheel}
              role="region"
              aria-label={running ? '正在思考，可滚动阅读' : '已完成的思考，可滚动阅读'}
              tabIndex={overflow ? 0 : undefined}
              /*
               * aria-live 固定 off（原来 running 时是 polite）。
               *
               * 思考是**流式**到达的：整轮几千字、每秒都在长。polite 会让屏幕
               * 阅读器不停播报新增内容，读屏用户连自己正在看的那一段都听不全，
               * 最后只剩下一串断断续续的碎句。这块视口本来就是「可滚动阅读的
               * 思考记录」，读屏用户按需浏览比被动听更有用——需要跟踪最新内容
               * 时，右侧那枚「跟随中 / 已暂停」才是真正的状态指示。
               */
              aria-live="off"
              /* 行数上限由 JS 常量/入参驱动，避免与 CSS 里的字面量各写一份而漂移。 */
              style={{ '--kr-reasoning-rows': maxRows } as CSSProperties}
            >
              {/*
               * **只挂尾部 WINDOW 行**，前面的用一条「往上翻」入口逐批放出来。
               *
               * 视口只有 16 行，却原来把整轮思考（可达上千行）全部塞进 DOM：
               * 每行一个 div + 一个 KrFreshText 组件，长回合动辄几千个节点，
               * 展开那一刻的建树 + 布局 + 跟随滚动强制的回流就是「思考多就卡」的
               * 主因。行数是内容的函数，卡顿也就成了内容的函数。
               *
               * 为什么不做整窗虚拟滚动：行高并不恒定（长句 pre-wrap 换行会把一行
               * 撑成两三行），按 scrollTop 推算可见区间必然错位，滚动条也会跳。
               * 尾部窗口不需要知道行高，代价是「更早的内容要点一下才挂载」——
               * 而那本来就是用户主动往回翻的动作，不是被动等待的开销。
               *
               * 滚动位置因此**只由已挂载的批次决定**，上方那行入口就是分界线：
               * 挂更多即向上生长，滚动条随之变长，不会出现「明明还有内容却滚不到底」。
               */}
              <div className="kr-reasoning-inner">
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    className="kr-reasoning-more"
                    onClick={() => setWindowSize((size) => size + WINDOW_ROWS)}
                  >
                    ↑ 前面还有 {hiddenCount} 行，向上翻看
                  </button>
                )}
                {windowed.map((item, idx) => (
                  <div className="kr-reasoning-row" key={startIndex + idx}>
                    {/* 逐字淡入：思考是流式按块到达的，整行直接冒出来会被读成
                        「一行字突然出现」；这里只让本次新增的字错峰显影。 */}
                    <span><KrFreshText text={item} /></span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
              {running ? '正在深入推演需求与实施方案…' : '本轮无独立思考记录'}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
