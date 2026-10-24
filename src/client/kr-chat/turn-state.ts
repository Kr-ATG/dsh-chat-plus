/**
 * dsh-chat-plus — 回合状态判据（最新轮次 / 是否仍在执行）。
 *
 * ## 为什么单独一个文件
 *
 * 这两个判据原先只住在 kr-chat-controller.tsx 里（模块私有）。2026-10-25 新对话页
 * 卡头（SeekerHeroHead）也要判断"本轮在不在跑"，而控制器反过来 import 了那个组件
 * —— 直接复用会形成循环依赖（controller → SeekerHeroHead → controller）。
 *
 * 抽成无依赖的叶子模块，两边都 import 它，谁也不用认识谁。
 *
 * @module
 */

import { getCurrentChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'

/**
 * 当前会话的最新轮次号。
 *
 * 空白新会话没有任何 navigation 条目，此时返回 1（面板随即走空态），
 * 绝不能沿用上一会话遗留的轮次号。数据源优先取实时快照，其次 DOM。
 *
 * @returns 最新轮次（最小 1）。
 */
export function resolveLatestTurn(): number {
  const snap = getCurrentChatSnapshot()
  const snapTurns = snap?.navigation?.current?.map((n: any) => n.turn).filter((n: any) => typeof n === 'number' && n > 0) || []
  if (snapTurns.length > 0) return Math.max(...snapTurns)
  const domTurns = typeof document !== 'undefined'
    ? Array.from(document.querySelectorAll('[data-chat-turn]'))
      .map(el => parseInt(el.getAttribute('data-chat-turn') || '0', 10))
      .filter(n => Number.isFinite(n) && n > 0)
    : []
  return domTurns.length > 0 ? Math.max(...domTurns) : 1
}

/**
 * 回合是否仍在执行。
 *
 * 以 snapshot.timeline 的 start/end 为事实源，避免活动卡正在播放退场动画时，
 * DOM 仍有节点就把右侧大盘误判为 running。只有旧 host 读不到 timeline 时才回退
 * 到「active 卡 / assistant running」DOM。
 *
 * @param turn - 轮次号。
 * @returns 是否仍在执行。
 */
export function isCurrentTurnRunning(turn: number): boolean {
  const snap = getCurrentChatSnapshot()
  try {
    const turns = snap?.timeline?.turns
    const timing = turns?.get ? turns.get(turn) : turns?.[turn]
    if (typeof timing?.start?.time === 'number') {
      return typeof timing.end?.time !== 'number'
    }
  } catch { /* 旧 snapshot 形状回退 DOM */ }
  if (typeof document === 'undefined') return false
  return Boolean(
    document.querySelector('.kr-agent-mini-shell[data-active="true"] .kr-agent-mini-card')
    || document.querySelector('[data-turn-process] [data-running="true"]')
    || document.querySelector('.dtt__assistant[data-running="true"]'),
  )
}
