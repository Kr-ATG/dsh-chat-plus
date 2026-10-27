/**
 * dsh-chat-plus — Seeker 卡头右侧 Git 状态徽章与一键提交流。
 *
 * 位于操作面板人物（鲸鱼娘）右侧、邮件与设置按钮的正下方。
 * 显示内容：
 *   1. 最近一次 Git 提交时间（内联时钟 SVG + 相对时间，悬停显示提交详情）；
 *   2. 待提交提示（内联分支/提交 SVG + 待提交文件数 / 干净对勾 SVG）；
 *   3. 点击待提交项：自动新建会话并将结构化 Git 提交提示词填充到对话输入框中。
 *
 * 设计约束：
 *   - 严禁使用 Emoji 字符或外部图标库，所有图形一律使用纯手写内联 SVG；
 *   - 样式自适应浅色与暗黑主题，无待提交改动时呈现温和克制的就绪态；
 *   - 整个操作面板是折叠热区，因此内部按钮必须调用 stopPropagation 避免误触折叠。
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import { getService, workspaceCwdOf } from '../client-ctx.ts'
import { GitCommitModal } from './GitCommitModal.tsx'

export interface GitCommitInfo {
  readonly timestamp: number
  readonly relative: string
  readonly subject: string
  readonly hash: string
  readonly dateIso: string
}

export interface GitStatusData {
  readonly ok: boolean
  readonly isGit: boolean
  readonly cwd?: string
  readonly branch?: string
  readonly lastCommit?: GitCommitInfo
  readonly pendingCount: number
  readonly stagedCount: number
  readonly unstagedCount: number
  readonly clean: boolean
  readonly pendingFiles?: readonly string[]
  readonly changes?: readonly {
    readonly path: string
    readonly status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'
    readonly rawCode: string
  }[]
  readonly diffStat?: string
  readonly needsMerge?: boolean
  readonly mergeReason?: 'conflict' | 'behind' | 'merging'
  readonly aheadCount?: number
  readonly behindCount?: number
  readonly error?: string
}

export interface SeekerGitStatusProps {
  /** 当前会话 ID（用来解析工作区根目录）。 */
  readonly sessionId?: string | null
  /** 显式传入的工作区根目录（优先）。 */
  readonly cwd?: string
}

/**
 * 将提示词回写到 Composer 对话输入框。
 *
 * @param text - 要填入的提示词。
 */
function fillComposerDraft(text: string): void {
  try {
    const globalFill = (window as unknown as { __dshFill?: (val: string) => void }).__dshFill
    if (typeof globalFill === 'function') {
      globalFill(text)
      return
    }
  } catch {
    /* 忽略全局桥异常 */
  }

  try {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder], [class*="composer"] textarea'
    )
    if (textarea) {
      textarea.value = text
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
      return
    }

    const editable = document.querySelector<HTMLDivElement>(
      '[contenteditable="true"], [class*="composer"] [contenteditable="true"]'
    )
    if (editable) {
      editable.textContent = text
      editable.dispatchEvent(new Event('input', { bubbles: true }))
      editable.focus()
    }
  } catch {
    /* 容错 */
  }
}

/**
 * 生成规范的 Git 提交提示词。
 */
function buildCommitPrompt(data: GitStatusData): string {
  const branchText = data.branch ? `（当前分支: ${data.branch}）` : ''
  if (data.needsMerge) {
    const reasonText = data.mergeReason === 'conflict'
      ? '存在合并冲突待解决'
      : data.mergeReason === 'behind'
        ? `落后远程分支 ${data.behindCount || ''} 个提交`
        : '处于合并流程中'
    return `当前工作区检测到${reasonText}${branchText}，请帮我处理合并：
1. 检查 git status、冲突文件与远程最新变更；
2. 妥善拉取更新并解决所有合并冲突；
3. 验证无误后完成合并提交并推送到远程分支（git push）。`
  }

  const countText = data.pendingCount > 0 ? `，检测到 ${data.pendingCount} 个待提交变更` : ''
  const fileListText = data.pendingFiles && data.pendingFiles.length > 0
    ? `\n涉及文件概览：\n${data.pendingFiles.slice(0, 8).map(f => `  - ${f}`).join('\n')}`
    : ''

  return `请帮我将当前工作区的未提交修改整理并提交到 Git 仓库${branchText}${countText}：
1. 运行 git status 与 git diff 检查所有改动的具体细节；
2. 规范编写简洁清晰的 Git Commit 消息并完成提交；
3. 推送到对应的远程分支（git push）。${fileListText}`
}

/**
 * 触发新建会话并将提交提示词填入输入框。
 */
export function startCommitSession(data: GitStatusData, workspaceCwd?: string): boolean {
  const prompt = buildCommitPrompt(data)

  // 1. 尝试使用官方 uiWorkspace.startSession 接口
  try {
    const uiWorkspace = getService<{
      startSession?: (workspaceId?: string, options?: { prompt?: string; clearPreviousDraft?: boolean }) => void
    }>('uiWorkspace')
    if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
      uiWorkspace.startSession(undefined, {
        prompt,
        clearPreviousDraft: false,
      })
      return true
    }
  } catch (err) {
    console.warn('[seeker-git] uiWorkspace.startSession 失败，尝试 DOM 触发:', err)
  }

  // 2. 备选方案：通过侧栏新会话按钮触发
  try {
    const newSessionButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="新建会话"], button[aria-label="New session"], button[data-action="new-session"]'
    )
    if (newSessionButton) {
      newSessionButton.click()
      window.setTimeout(() => {
        fillComposerDraft(prompt)
      }, 180)
      return true
    }
  } catch {
    /* 忽略 */
  }

  // 3. 兜底方案：直接写回当前对话框
  fillComposerDraft(prompt)
  return true
}

/**
 * Seeker 卡头右侧 Git 状态小徽标。
 */
export function SeekerGitStatus({ sessionId, cwd: explicitCwd }: SeekerGitStatusProps): ReactElement | null {
  const [data, setData] = useState<GitStatusData | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const timerRef = useRef<number>(0)

  const resolvedCwd = explicitCwd ?? workspaceCwdOf(sessionId)

  const fetchStatus = useCallback(() => {
    const query = resolvedCwd ? `?cwd=${encodeURIComponent(resolvedCwd)}` : ''
    setLoading(true)
    fetch(`/api/chat-flow/git-status${query}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<GitStatusPayloadLike>
      })
      .then((json) => {
        if (json && json.ok) {
          setData(json as GitStatusData)
        } else {
          setData(null)
        }
      })
      .catch(() => {
        setData(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [resolvedCwd])

  useEffect(() => {
    fetchStatus()
    // 15 秒轮询一次保持提交时间与状态最新
    timerRef.current = window.setInterval(fetchStatus, 15000)
    return () => {
      if (timerRef.current !== 0) window.clearInterval(timerRef.current)
    }
  }, [fetchStatus])

  const onCommitClick = useCallback((event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    if (!data) return

    // 1. 如果有需要合并的（冲突、落后远程分支、合并中），按原方案新建会话并写入提示词
    if (data.needsMerge) {
      if (submitting) return
      setSubmitting(true)
      try {
        startCommitSession(data, resolvedCwd)
      } finally {
        window.setTimeout(() => setSubmitting(false), 1000)
      }
      return
    }

    // 2. 如果没有需要合并的，弹出卡片用本对话模型填写提交备注并执行脚本提交
    setModalOpen(true)
  }, [data, submitting, resolvedCwd])

  // 非 Git 仓库时优雅静默隐藏，不破坏卡头原有视觉
  if (!data || !data.isGit) {
    return null
  }

  const lastCommit = data.lastCommit
  const isClean = data.clean || data.pendingCount === 0
  const commitTitle = lastCommit
    ? `最近提交 [${lastCommit.hash}]: ${lastCommit.subject} (${lastCommit.dateIso})`
    : '暂无提交记录'

  return (
    <div
      className="kr-plain-head__git"
      onClick={(e) => e.stopPropagation()}
      role="region"
      aria-label="工作区 Git 状态"
    >
      {/* 第一行：最近提交时间 */}
      {lastCommit && (
        <span
          className="kr-plain-head__git-row kr-plain-head__git-time"
          title={commitTitle}
        >
          {/* 时钟内联 SVG */}
          <svg
            className="kr-plain-head__git-icon"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" />
            <polyline points="8 4.5 8 8 10.5 9.5" />
          </svg>
          <span className="kr-plain-head__git-text">{lastCommit.relative}</span>
        </span>
      )}

      {/* 第二行：待提交提示 / 提交确认按钮 */}
      {isClean ? (
        <span
          className="kr-plain-head__git-row kr-plain-head__git-clean"
          title={`工作区干净，当前分支: ${data.branch ?? 'HEAD'}，无待提交改动`}
        >
          <span className="kr-plain-head__git-text">工作区干净</span>
        </span>
      ) : (
        <button
          type="button"
          className={`kr-plain-head__git-row kr-plain-head__git-pending ${data.needsMerge ? 'kr-plain-head__git-pending--merge' : ''}`}
          onClick={onCommitClick}
          disabled={submitting}
          title={data.needsMerge
            ? `检测到待合并项（${data.mergeReason === 'conflict' ? '存在冲突' : '落后远程'}），点击自动新建会话协助合并`
            : `检测到 ${data.pendingCount} 个待提交变更，点击弹出提交卡片`}
          aria-label={data.needsMerge
            ? `待合并 ${data.pendingCount} 项，点击自动新建会话协助合并`
            : `待提交 ${data.pendingCount} 项，点击弹出提交卡片`}
        >
          {/* 经典正统 Git 分支内联 SVG */}
          <svg
            className="kr-plain-head__git-icon"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 8a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0-9a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
          </svg>
          <span className="kr-plain-head__git-text">
            {data.needsMerge ? `待合并 (${data.pendingCount})` : `${data.pendingCount} 个待提交`}
          </span>
          {/* 提交确认指示箭头内联 SVG */}
          <svg
            className="kr-plain-head__git-arrow"
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 12V4M4 8l4-4 4 4" />
          </svg>
        </button>
      )}

      {/* 提交确认弹窗卡片（当无需合并时） */}
      <GitCommitModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmitted={fetchStatus}
        data={data}
        cwd={resolvedCwd}
      />
    </div>
  )
}

interface GitStatusPayloadLike {
  ok?: boolean
  isGit?: boolean
  [key: string]: unknown
}
