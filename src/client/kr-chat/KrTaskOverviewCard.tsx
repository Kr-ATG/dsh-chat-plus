/**
 * dsh-chat-plus — 任务概览卡片（一个卡片框统领全部任务项）。
 * 呈现 DSH 官方真实的 todo / task 列表。
 *
 * 卡片常驻：当前轮没有任务时给一行低对比度空态，而不是整张 return null。
 * 原因见下方注释——整张卡消失会让「模型什么时候想起写 todo」直接变成
 * 「卡片什么时候出现」。
 */
import { memo, useState } from 'react'
import { StatusIcon } from './StatusIcon.tsx'

export interface DshTaskItem {
  readonly id: string
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

export interface TaskOverviewCardProps {
  readonly tasks: readonly DshTaskItem[]
  readonly isRunning?: boolean
}

export const KrTaskOverviewCard = memo(function KrTaskOverviewCard({
  tasks,
  isRunning = false,
}: TaskOverviewCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  /*
   * 原来这里是 `if (!tasks || tasks.length === 0) return null`——卡片整张消失。
   * 于是只要模型这一轮还没写出任务，右栏第一张卡就是空的；等第一条 todo 落地
   * 时整张卡突然弹出来，读作「最后才出现」。卡片的出现时机不该取决于模型
   * 什么时候想起写 todo。
   *
   * 现在常驻：没有任务时给一行低对比度的空态，位置永远稳定；有任务时进度条
   * 与列表自然填进去，不做整卡重挂载。
   */
  const empty = !tasks || tasks.length === 0
  const doneCount = tasks.filter((t) => t.status === 'completed').length
  const activeCount = tasks.filter((t) => t.status === 'in_progress').length
  const allDone = doneCount === tasks.length
  const percent = empty ? 0 : Math.round((doneCount / tasks.length) * 100)

  const progressText = empty
    ? '本轮还没有任务'
    : allDone
      ? `${tasks.length} 项已完成`
      : activeCount > 0
        ? `${doneCount}/${tasks.length} 完成 · 进行中`
        : `${doneCount}/${tasks.length} 完成`

  return (
    <div className="kr-card kr-card--task" data-empty={empty || undefined}>
      {/* 卡片头部 */}
      <div className="kr-card__header" onClick={() => setCollapsed(!collapsed)}>
        <span className="kr-card__icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M13.328 9.7v1.28H7.28V9.7h6.048zM13.328 2.97v1.28H7.28V2.97h6.048z" fill="currentColor"/>
            <path d="M4.645 10.336a1.283 1.283 0 1 1-2.566 0 1.283 1.283 0 0 1 2.566 0zm1.28 0c0 1.415-1.148 2.563-2.563 2.563A2.563 2.563 0 0 1 .8 10.336c0-1.415 1.147-2.562 2.562-2.562 1.415 0 2.563 1.147 2.563 2.562z" fill="currentColor"/>
            <path d="M4.645 3.612a1.283 1.283 0 1 1-2.565 0 1.283 1.283 0 0 1 2.565 0zm1.28 0C5.925 5.027 4.778 6.175 3.362 6.175A2.563 2.563 0 0 1 .8 3.612C.8 2.197 1.947 1.05 3.362 1.05c1.416 0 2.563 1.147 2.563 2.562z" fill="currentColor"/>
          </svg>
        </span>
        <span className="kr-card__title">任务概览</span>
        {/*
         * 进度说明是**纯文字**，不再是一枚带底色的徽标（按用户要求）：卡片标题行
         * 右侧挂一枚胶囊，右栏每张卡各挂一枚，三张并排时是一列色块，噪声比信息
         * 本身大。文字弱一级（.kr-card__meta）即可，扫读时不会和标题抢。
         */}
        <span className="kr-card__meta">{progressText}</span>
      </div>

      {/*
       * 空态时整张卡只剩这一行头。
       *
       * 原来空态要占三行：头部（徽标写"暂无任务"）+ 0% 进度条 + 正文
       * "本轮还没有任务清单"。后两者都是同一句话的重复与纯装饰（0% 的进度条
       * 不传达任何信息），三行换一行，右栏省下的高度直接给思考与操作面板。
       * 徽标改成把话说完整，读起来也不用猜"暂无任务"指的是什么。
       */}
      {!collapsed && !empty && (
        <div className="kr-task-progress-line">
          <div
            className="kr-task-progress-line__fill"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* 任务列表（整洁单层卡片排布，无俄式套盒，去除非必要重复徽标） */}
      {!collapsed && !empty && (
        <div className="kr-task-list">
          {tasks.map((task, index) => {
            const isCompleted = task.status === 'completed'
            const isInProgress = task.status === 'in_progress'

            return (
              <div
                key={task.id || index}
                className={`kr-task-item kr-task-item--${task.status}`}
                style={{ animationDelay: `${Math.min(index, 8) * 34}ms` }}
              >
                <span className="kr-task-item__icon">
                  {/* 状态圆圈：14px 实心对勾 / 蓝色转圈 / 点线，与右栏另一张卡
                      的行首图标同尺寸同色系（那枚是类别图标，本卡是三态圆圈）。 */}
                  <StatusIcon state={isCompleted ? 'done' : isInProgress ? 'running' : 'pending'} />
                </span>

                <div className="kr-task-item__content">
                  {task.content}
                </div>

                {/* 仅在进行中时提供微小状态标识，已完成依靠对勾图标自然传达，杜绝视觉垃圾 */}
                {isInProgress && (
                  <span className="kr-task-item__tag kr-task-item__tag--running">
                    进行中
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
