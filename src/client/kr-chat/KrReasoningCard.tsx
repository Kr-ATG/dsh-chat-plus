/**
 * dsh-chat-plus — 思考过程卡片（带电灯泡图标、要点、实时跟随滚动）。
 *
 * 行为（2026-09 需求：实时滚动 + 可手动截停 + 最大 15 行）：
 * 1. **实时滚动**：思考流式增长时视口自动跟到底，新内容逐行出现；复用左侧
 *    实时轨道那套 `useSteppedFollow`（同一节拍与手感，两处体验一致）。
 * 2. **可手动截停**：向上滚动即停住跟随（读者要往回看时不会被拽走），
 *    滚回底部（≤24px）自动恢复；选中文字期间也不跟随。
 * 3. **最大 15 行**：视口高度按 15 行封顶（见 CSS --kr-reasoning-rows），
 *    超出部分在视口内滚动，不再把卡片撑成长条。行数上限可由
 *    `maxRows` prop 覆盖——右栏被常驻的记忆卡挤压时，大盘会传一档更小的值。
 *
 * 与旧版的差异：旧版是「默认 3 条 + 展开其余 N 项」的静态列表；现在改成
 * 有界视口内的完整文本流——内容不再被截断，滚动由用户掌控。
 */
import { memo, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMotionAllowed, useSteppedFollow } from '../motion-utils.ts'
import { KrFreshText } from './KrFreshText.tsx'

/** 视口最多显示的行数（超出在视口内滚动）。 */
export const REASONING_MAX_ROWS = 25

export interface ReasoningCardProps {
  readonly reasoningTexts: readonly string[]
  readonly running: boolean
  /**
   * 视口行数上限。默认 REASONING_MAX_ROWS；右栏被挤压时由 KrAgentPanel 经
   * use-adaptive-rows.ts 算出一档更小的值传进来（记忆卡常驻底部会挤掉高度）。
   */
  readonly maxRows?: number
}

export const KrReasoningCard = memo(function KrReasoningCard({
  reasoningTexts,
  running,
  maxRows = REASONING_MAX_ROWS,
}: ReasoningCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const motion = useMotionAllowed(true)

  // 要点行：优先编号行，否则逐行取全部（完整保留，不再截前 4 行）
  const points = useMemo(() => {
    const full = reasoningTexts.join('\n')
    if (!full.trim()) return [] as readonly string[]
    const lines = full.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    const numbered = lines.filter((l) => /^\d+[\.、\s]/.test(l))
    return numbered.length > 0 ? numbered : lines
  }, [reasoningTexts])

  // 跟随探针：内容或运行态变化都触发重新贴底
  const probe = useMemo(() => `${running ? '1' : '0'}:${points.join('\u0000')}`, [points, running])
  const followActive = running && !collapsed
  const { ref, onScroll, onWheel, edges, overflow, following } =
    useSteppedFollow(probe, followActive, motion)

  if (reasoningTexts.length === 0 && !running) return null

  const hasContent = points.length > 0

  return (
    <div className="kr-card kr-card--reasoning">
      <div className="kr-card__header" onClick={() => setCollapsed(!collapsed)}>
        <span className="kr-card__icon">
          {/* 电灯泡线框无色彩矢量图标 */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 13h4M6.5 15h3M6 10.5c-.7-.7-1.5-1.7-1.5-3a4.5 4.5 0 1 1 9 0c0 1.3-.8 2.3-1.5 3-.5.5-.8 1.2-.8 2h-4.4c0-.8-.3-1.5-.8-2z" />
          </svg>
        </span>
        <span className="kr-card__title">
          思考过程 {hasContent ? `(${points.length})` : running ? '(思考中…)' : ''}
        </span>
        {/* 跟随状态提示：截停时给出明确反馈（否则用户不知道为何不再滚动） */}
        {followActive && overflow && (
          <span className="kr-card__follow" data-following={following ? 'true' : 'false'}>
            {following ? '跟随中' : '已暂停'}
          </span>
        )}
        <span className="kr-card__chevron" data-collapsed={collapsed ? 'true' : 'false'}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M2.5 4.5 6 8 9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {!collapsed && (
        <div className="kr-reasoning-list">
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
              aria-live={running ? 'polite' : 'off'}
              /* 行数上限由 JS 常量/入参驱动，避免与 CSS 里的字面量各写一份而漂移。
                 右栏空间富余时用默认 25 行；被记忆卡等常驻内容挤压时由大盘
                 自适应下调（见 use-adaptive-rows.ts）。 */
              style={{ '--kr-reasoning-rows': maxRows } as CSSProperties}
            >
              <div className="kr-reasoning-inner">
                {points.map((item, idx) => (
                  <div className="kr-reasoning-row" key={idx}>
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
