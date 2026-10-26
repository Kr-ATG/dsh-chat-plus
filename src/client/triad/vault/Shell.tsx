/**
 * 档案弹窗外壳。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────
 * 档案里有三处「一次性的整块任务」需要同一个壳：新建记录、密码健康检查、备份
 * 与恢复。三处各自写一遍 backdrop + 居中 + 点外部关闭 + 定位，迟早会有一处忘
 * 了某个细节（最典型的是漏掉「点遮罩关闭」或把 fixed 写回去）。
 *
 * ── 为什么是 absolute 而不是 fixed ──────────────────────────────────
 * 这个页面挂在官方 main 槽位里。fixed 会连侧栏与顶栏一起盖住，用户在那几十秒
 * 里既切不了会话也看不见导航；absolute 只覆盖 .dsh-vault 这一屏，语义是「在
 * 这块区域里居中弹出来」。代价是它必须是 .dsh-vault 的后代——调用点都在
 * Panel 的同一层 JSX 里，这一点由结构保证。
 *
 * ── 遮罩只吃点击，不压暗 ────────────────────────────────────────────
 * 旧版那层 22% 文字色盖在列表上，就是用户说的「灰蒙蒙」。现在遮罩几乎是透明
 * 的：它的职责只有「点空白处关闭」和「把焦点圈在这一块」，视觉上的层级完全
 * 交给弹窗自己的描边与投影。
 */

import type { JSX, ReactNode } from 'react'
import { css } from './styles.js'

export interface VaultModalProps {
  /** 无障碍名称（读屏软件念的那句「这是什么对话框」）。 */
  label: string
  /** 点遮罩 / 按 Esc 时调用。 */
  onClose: () => void
  children: ReactNode
}

/**
 * 居中弹窗。
 *
 * Esc 交给调用方：同一个页面上可能同时存在「弹窗」与「原地展开的详情」，什么
 * 时候该关哪个由 Panel 那一个 keydown 统一裁决（顺序＝层叠顺序）。这里再挂一
 * 个监听会导致一次 Esc 关掉两层。
 */
export function VaultModal({ label, onClose, children }: VaultModalProps): JSX.Element {
  return (
    <div
      className={css.backdrop}
      // 只在点到遮罩本身时关闭。用 target 判断而不是 stopPropagation：弹窗内部
      // 有些自绘控件会自己冒泡，冒到遮罩上就误关了。
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      aria-hidden="true"
    >
      <div
        className={css.modal}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // 弹窗内部的点击一律不往上走（保险：上面的 target 判断已经兜住了）。
        onClick={(event) => { event.stopPropagation() }}
      >
        {children}
      </div>
    </div>
  )
}
