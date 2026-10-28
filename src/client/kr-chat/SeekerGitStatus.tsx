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

import { useCallback, useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import { getService, workspaceCwdOf } from '../client-ctx.ts'
import { GitCommitModal } from './GitCommitModal.tsx'
import { getGitRosterStore } from './git-roster-store.ts'
import { refreshGitStatus, useGitStatusSnapshot } from './git-status-store.ts'
import type { GitStatusData } from './git-status-types.ts'

/**
 * 兼容旧导入路径：GitCommitInfo / GitStatusData 已搬到 git-status-types.ts，
 * 由状态 store 与组件共用（避免 store ↔ 组件循环 import）。
 */
export type { GitCommitInfo, GitStatusData } from './git-status-types.ts'

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
  const [submitting, setSubmitting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const resolvedCwd = explicitCwd ?? workspaceCwdOf(sessionId)

  /*
   * Git 状态由共享 store 统一拉取（2026-10-29）。
   *
   * 这张微组件与 GitCommitModal 共用同一份**单仓库**状态（git-status-store）；
   * 卡头 Git 图标的角标则取 git-roster-store 的「大盘待提交合计」（工作区 +
   * 自制插件）。两者职责不同：微组件回答「当前工作区怎样」，角标回答「所有
   * 仓库一共还有多少没提交」。提交成功后 fetchStatus 会把两边一起刷新。
   *
   * store 的引用计数保证只有一个订阅者时它才轮询，最后一个离开才停。原先
   * 这里自己 setInterval + setData，若角标再加一份就会同页请求两遍
   * /api/chat-flow/git-status（host 每次要跑 6~8 条 git 子命令）。
   */
  const snapshot = useGitStatusSnapshot(resolvedCwd, true)
  const data = snapshot.data
  const fetchStatus = useCallback(() => {
    void refreshGitStatus(resolvedCwd, true)
    // 表单提交完成后，卡头 Git 图标上的「大盘待提交合计」也要立即跟着掉。
    // 单仓库 store 与大盘 store 是两份数据（后者覆盖所有插件仓库），只刷前者
    // 会让角标停在旧数字上，最长要等 45 秒轮询才恢复。
    void getGitRosterStore().refresh(true)
  }, [resolvedCwd])

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
