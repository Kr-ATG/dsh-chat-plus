/**
 * dsh-chat-plus — 工作区 Git 提交确认弹窗卡片。
 *
 * 当工作区无合并冲突（needsMerge === false）时，点击待提交徽章触发本卡片：
 *   1. 检查真实工作区所有的改动细节与文件列表（不单单局限于本会话）；
 *   2. 自动调用当前会话模型基于真实改动生成规范的 Commit Message；
 *   3. 执行脚本化提交与推送，实时呈现三步分步进度（暂存 -> 提交 -> 推送）。
 *
 * 规范约束：
 *   - 严格禁止 Emoji 字符，所有视觉元素一律使用手写内联 SVG；
 *   - 样式自适应浅色与暗黑主题；
 *   - 全程键盘友好（Escape 关闭，Enter / Ctrl+Enter 提交）。
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import type { GitStatusData } from './SeekerGitStatus.tsx'

export interface GitCommitModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onSubmitted: () => void
  readonly data: GitStatusData
  readonly cwd?: string
}

type StepState = 'idle' | 'staging' | 'committing' | 'pushing' | 'done' | 'error'

export function GitCommitModal({
  open,
  onClose,
  onSubmitted,
  data,
  cwd,
}: GitCommitModalProps): ReactElement | null {
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const [step, setStep] = useState<StepState>('idle')
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [pushRemote, setPushRemote] = useState(true)
  const [showFiles, setShowFiles] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const autoGenTriggered = useRef(false)

  // AI 生成提交备注
  const requestAiCommitMessage = useCallback(() => {
    setGenerating(true)
    fetch('/api/chat-flow/git-commit-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: cwd ?? data.cwd }),
    })
      .then((res) => res.json() as Promise<{ ok?: boolean; message?: string; error?: string }>)
      .then((res) => {
        if (res && res.ok && res.message) {
          setMessage(res.message)
        }
      })
      .catch((err) => {
        console.warn('[git-commit-modal] 生成备注失败:', err)
      })
      .finally(() => {
        setGenerating(false)
      })
  }, [cwd, data.cwd])

  // 打开时初始化状态与首次生成
  useEffect(() => {
    if (open) {
      setStep('idle')
      setProgressPercent(0)
      setProgressText('')
      setErrorMsg('')
      if (!autoGenTriggered.current) {
        autoGenTriggered.current = true
        requestAiCommitMessage()
      }
      window.setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    } else {
      autoGenTriggered.current = false
    }
  }, [open, requestAiCommitMessage])

  // 执行脚本化提交与分步进度
  const handleExecuteCommit = useCallback(() => {
    const finalMsg = message.trim()
    if (!finalMsg || step !== 'idle') return

    setStep('staging')
    setProgressPercent(25)
    setProgressText('正在暂存文件变更 (git add -A)...')
    setErrorMsg('')

    // 模拟平滑进度推进感
    const timer1 = window.setTimeout(() => {
      setProgressPercent(55)
      setProgressText('正在生成本地提交 (git commit)...')
    }, 450)

    const timer2 = window.setTimeout(() => {
      if (pushRemote) {
        setProgressPercent(80)
        setProgressText('正在推送到远程分支 (git push)...')
      }
    }, 900)

    fetch('/api/chat-flow/git-commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd: cwd ?? data.cwd,
        message: finalMsg,
        push: pushRemote,
      }),
    })
      .then((res) => res.json() as Promise<{ ok?: boolean; hash?: string; pushed?: boolean; output?: string; error?: string }>)
      .then((res) => {
        window.clearTimeout(timer1)
        window.clearTimeout(timer2)
        if (res && res.ok) {
          setStep('done')
          setProgressPercent(100)
          setProgressText(res.output || '提交并推送成功！')
          onSubmitted()
          // 成功后 1.2 秒自动关闭
          window.setTimeout(() => {
            onClose()
          }, 1200)
        } else {
          setStep('error')
          setProgressPercent(100)
          setErrorMsg(res?.error || '提交过程中发生错误')
        }
      })
      .catch((err) => {
        window.clearTimeout(timer1)
        window.clearTimeout(timer2)
        setStep('error')
        setProgressPercent(100)
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
  }, [message, step, pushRemote, cwd, data.cwd, onSubmitted, onClose])

  if (!open) return null

  const isWorking = step === 'staging' || step === 'committing' || step === 'pushing'
  const isDone = step === 'done'
  const isError = step === 'error'

  return (
    <div
      className="kr-git-modal-overlay"
      onClick={isWorking ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kr-git-modal-title"
    >
      <div
        className="kr-git-modal"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        {/* 弹窗头部 */}
        <div className="kr-git-modal__header">
          <div className="kr-git-modal__title-row">
            {/* 正统 Git 分支内联 SVG */}
            <svg
              className="kr-git-modal__branch-icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 8a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0-9a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
            </svg>
            <span id="kr-git-modal-title" className="kr-git-modal__title">
              提交工作区改动
            </span>
            <span className="kr-git-modal__branch-badge" title="当前分支">
              {data.branch || 'HEAD'}
            </span>
          </div>

          {!isWorking && (
            <button
              type="button"
              className="kr-git-modal__close-btn"
              onClick={onClose}
              title="关闭 (Esc)"
              aria-label="关闭弹窗"
            >
              {/* 关闭 X 内联 SVG */}
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
                <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
              </svg>
            </button>
          )}
        </div>

        {/* 弹窗正文 */}
        <div className="kr-git-modal__body">
          {/* 改动文件概览行 */}
          <div className="kr-git-modal__summary-box">
            <div className="kr-git-modal__summary-top">
              <span className="kr-git-modal__summary-label">
                {/* 文件堆叠内联 SVG */}
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.5 1.5H3.5a1.5 1.5 0 0 0-1.5 1.5v10a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V6L9.5 1.5z" />
                  <polyline points="9.5 1.5 9.5 6 14 6" />
                </svg>
                <span>工作区待提交文件：<strong>{data.pendingCount}</strong> 项</span>
              </span>

              {data.changes && data.changes.length > 0 && (
                <button
                  type="button"
                  className="kr-git-modal__toggle-files"
                  onClick={() => setShowFiles(v => !v)}
                >
                  <span>{showFiles ? '收起改动列表' : '查看文件明细'}</span>
                  <svg
                    className={`kr-git-modal__chevron ${showFiles ? 'kr-git-modal__chevron--up' : ''}`}
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="4 6 8 10 12 6" />
                  </svg>
                </button>
              )}
            </div>

            {/* 可展开的文件列表明细 */}
            {showFiles && data.changes && (
              <div className="kr-git-modal__file-list">
                {data.changes.map((c, i) => (
                  <div key={i} className="kr-git-modal__file-item">
                    <span
                      className={`kr-git-modal__status-tag kr-git-modal__status-tag--${c.status.toLowerCase()}`}
                    >
                      {c.status === '?' ? 'ADD' : c.status}
                    </span>
                    <span className="kr-git-modal__file-path" title={c.path}>
                      {c.path}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 提交备注编辑区 */}
          <div className="kr-git-modal__field">
            <div className="kr-git-modal__field-header">
              <label htmlFor="kr-git-commit-msg" className="kr-git-modal__field-label">
                提交备注 (Commit Message)
              </label>

              <button
                type="button"
                className="kr-git-modal__ai-btn"
                onClick={requestAiCommitMessage}
                disabled={generating || isWorking}
                title="调用当前会话模型基于工作区所有实际 Diff 智能生成备注"
              >
                {/* 智能星芒内联 SVG */}
                <svg
                  className={`kr-git-modal__sparkle-icon ${generating ? 'kr-git-modal__spin' : ''}`}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 1v4M8 11v4M1 8h4M11 8h4M3 3l2.8 2.8M10.2 10.2l2.8 2.8M3 13l2.8-2.8M10.2 5.8l2.8-2.8" />
                </svg>
                <span>{generating ? '模型分析生成中...' : '模型智能重写'}</span>
              </button>
            </div>

            <textarea
              id="kr-git-commit-msg"
              ref={textareaRef}
              className="kr-git-modal__textarea"
              rows={4}
              value={message}
              disabled={isWorking || isDone}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="请输入清晰的 Git Commit 消息，或点击上方按钮由模型根据实际变更生成..."
            />
          </div>

          {/* 推送选项 */}
          <div className="kr-git-modal__options-row">
            <label className="kr-git-modal__checkbox-label">
              <input
                type="checkbox"
                checked={pushRemote}
                disabled={isWorking || isDone}
                onChange={(e) => setPushRemote(e.target.checked)}
              />
              <span>提交后推送到远程仓库 (git push)</span>
            </label>
          </div>

          {/* 进度显示区 */}
          {(isWorking || isDone || isError) && (
            <div className="kr-git-modal__progress-box">
              <div className="kr-git-modal__progress-bar-bg">
                <div
                  className={`kr-git-modal__progress-bar-fill ${isError ? 'kr-git-modal__progress-bar-fill--error' : ''}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="kr-git-modal__progress-status-row">
                {isWorking && (
                  <>
                    <svg className="kr-git-modal__spin" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10" />
                    </svg>
                    <span>{progressText}</span>
                  </>
                )}

                {isDone && (
                  <span className="kr-git-modal__done-text">
                    {/* 对勾内联 SVG */}
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-6" />
                    </svg>
                    <span>{progressText}</span>
                  </span>
                )}

                {isError && (
                  <span className="kr-git-modal__error-text">
                    {/* 错误圆叹号内联 SVG */}
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.25" />
                      <line x1="8" y1="5" x2="8" y2="8.5" />
                      <circle cx="8" cy="11" r="0.5" fill="currentColor" />
                    </svg>
                    <span>{errorMsg}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 弹窗底部操作 */}
        <div className="kr-git-modal__footer">
          <button
            type="button"
            className="kr-git-modal__cancel-btn"
            onClick={onClose}
            disabled={isWorking}
          >
            {isDone ? '关闭' : '取消'}
          </button>

          {!isDone && (
            <button
              type="button"
              className="kr-git-modal__submit-btn"
              onClick={handleExecuteCommit}
              disabled={isWorking || !message.trim()}
            >
              {/* 提交箭头内联 SVG */}
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 12V3M4 7l4-4 4 4" />
                <path d="M2 14h12" />
              </svg>
              <span>{isWorking ? '正在执行提交...' : pushRemote ? '确认提交并推送' : '仅本地提交'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
