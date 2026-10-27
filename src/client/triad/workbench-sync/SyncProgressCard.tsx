/**
 * 同步实时进度卡片组件：以步骤清单与进度条展示上传或恢复状态。
 * 全面去除 Emoji，统一使用基础单色 SVG 图标，并支持高亮显示提交历史与无变更提示。
 */

import React from 'react'
import type { SyncProgress } from '../../../triad/workbench-sync/types.js'
import { CheckCircleIcon, DownloadIcon, UploadIcon } from './icons.js'
import { syncCss } from './styles.js'

export interface SyncProgressCardProps {
  progress: SyncProgress | null
  running: boolean
  onDismiss?: () => void
}

export function SyncProgressCard({ progress, running, onDismiss }: SyncProgressCardProps): JSX.Element | null {
  if (!progress) return null

  const isCompleted = progress.status === 'completed'
  const isFailed = progress.status === 'failed'
  const total = progress.totalSteps || 1
  const completedCount = progress.steps.filter((s) => s.status === 'done').length
  const percent = Math.min(100, Math.round((completedCount / total) * 100))

  const durationSec = progress.endTime
    ? ((progress.endTime - progress.startTime) / 1000).toFixed(1)
    : ((Date.now() - progress.startTime) / 1000).toFixed(0)

  return (
    <div className={syncCss.progressCard}>
      <div className={syncCss.progressHead}>
        <div className={syncCss.progressTitle}>
          <span className={syncCss.progressBadge} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            {progress.action === 'upload' ? (
              <>
                <UploadIcon size={12} />
                <span>备份上传</span>
              </>
            ) : (
              <>
                <DownloadIcon size={12} />
                <span>一键拉取</span>
              </>
            )}
          </span>
          <span className={syncCss.progressState}>
            {running && <span className="dsh-sync-spin" />}
            {isCompleted && <span className="dsh-sync-check">✓</span>}
            {isFailed && <span className="dsh-sync-fail">✕</span>}
            {running ? '正在同步进行中…' : isCompleted ? '同步完成' : '同步失败'}
          </span>
        </div>
        <div className={syncCss.progressMeta}>
          <span>耗时 {durationSec}s</span>
          {onDismiss && !running && (
            <button
              className={syncCss.btn}
              style={{ height: '22px', padding: '0 8px', fontSize: '11px', marginLeft: '8px' }}
              onClick={onDismiss}
              type="button"
            >
              关闭
            </button>
          )}
        </div>
      </div>

      <div className={syncCss.progressTrack}>
        <div
          className={syncCss.progressFill}
          style={{
            width: `${percent}%`,
            backgroundColor: isFailed ? '#ef4444' : isCompleted ? '#10b981' : '#3b82f6',
          }}
        />
      </div>

      {/* 当检测到已提交过、无需重复上传时的明确通知区块 */}
      {progress.notice && (
        <div className={syncCss.progressNotice}>
          <CheckCircleIcon size={14} style={{ flexShrink: 0 }} />
          <span>{progress.notice}</span>
        </div>
      )}

      <div className={syncCss.progressList}>
        {progress.steps.map((step, idx) => {
          return (
            <div key={step.id || idx} className={syncCss.progressRow}>
              <div className={syncCss.progressIcon}>
                {step.status === 'done' && <span className="dsh-sync-check">✓</span>}
                {step.status === 'running' && <span className="dsh-sync-spin" />}
                {step.status === 'error' && <span className="dsh-sync-fail">!</span>}
                {step.status === 'pending' && <span className="dsh-sync-dot" />}
              </div>
              <span className={syncCss.progressName}>{step.name}</span>
              {step.detail && <span className={syncCss.progressDetail}>{step.detail}</span>}
            </div>
          )
        })}
      </div>

      {progress.error && (
        <div className={syncCss.progressError}>
          <b>错误原因：</b>{progress.error}
        </div>
      )}
    </div>
  )
}
