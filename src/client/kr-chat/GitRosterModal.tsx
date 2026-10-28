/**
 * dsh-chat-plus — 工作区与自制插件 Git 工作台大盘（宽幅优雅极简版）。
 *
 * 设计升级要点：
 *   1. 空间窗口扩至 840px 宽幅，彻底打开信息呼吸空间；
 *   2. 色彩全面收敛降噪：去除多余的彩色药丸，以现代高级黑白灰与层级排版为主；
 *   3. 结构化的列式对齐：[ 仓库名 & 类型 ] [ 分支 ] [ 提交详情 / 路径 ] [ 状态 ] [ 操作 ]；
 *   4. 全程手写纯内联 SVG，无任何 Emoji，字号与明暗主题自适应。
 *
 * @module
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import { getService } from '../client-ctx.ts'
import { getGitRosterStore, useGitRosterSnapshot } from './git-roster-store.ts'
import type { GitRosterItem } from './git-roster-store.ts'

/** 兼容旧导入路径：类型已搬到 git-roster-store.ts（store 与弹窗共用）。 */
export type { GitRosterData, GitRosterItem } from './git-roster-store.ts'

function fillComposerDraft(text: string): void {
  try {
    const globalFill = (window as unknown as { __dshFill?: (val: string) => void }).__dshFill
    if (typeof globalFill === 'function') {
      globalFill(text)
      return
    }
  } catch {}

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
  } catch {}
}

function launchSessionForRepo(repo: GitRosterItem, onClose: () => void): void {
  let prompt = ''
  const catLabel = repo.category === 'plugin' ? '自制插件' : '工作区'
  const branchText = repo.branch ? `（分支: ${repo.branch}）` : ''

  if (repo.conflictCount > 0 || repo.mergeReason === 'conflict') {
    prompt = `请协助我解决【${repo.name}】${catLabel}${branchText}中的 Git 合并冲突：
1. 检查 git status、冲突文件与冲突标记；
2. 细致分析并解决所有合并冲突；
3. 验证构建无误后完成合并提交并推送到远程。`.trim()
  } else if (repo.pendingCount > 0) {
    prompt = `请帮我将【${repo.name}】${catLabel}${branchText}的未提交修改整理并提交到 Git 仓库：
1. 检查当前工作区实际改动（git status 与 git diff）；
2. 规范编写简洁清晰的 Commit Message 并完成提交；
3. 推送到远程分支（git push）。`.trim()
  } else if (repo.behindCount > 0) {
    prompt = `【${repo.name}】${catLabel}${branchText}当前落后远程分支 ${repo.behindCount} 个提交，请协助我拉取最新远程代码并同步。`.trim()
  } else {
    prompt = `我想在【${repo.name}】${catLabel}${branchText}中开展新的开发任务，请先检查当前项目状态并协助我。`.trim()
  }

  try {
    const uiWorkspace = getService<{
      startSession?: (workspaceId?: string, options?: { prompt?: string; clearPreviousDraft?: boolean }) => void
    }>('uiWorkspace')
    if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
      uiWorkspace.startSession(undefined, {
        prompt,
        clearPreviousDraft: false,
      })
      onClose()
      return
    }
  } catch {}

  try {
    const newSessionButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="新建会话"], button[aria-label="New session"], button[data-action="new-session"]'
    )
    if (newSessionButton) {
      newSessionButton.click()
      window.setTimeout(() => {
        fillComposerDraft(prompt)
      }, 180)
      onClose()
      return
    }
  } catch {}

  fillComposerDraft(prompt)
  onClose()
}

export function GitRosterModal(): ReactElement | null {
  const store = getGitRosterStore()
  /*
   * 数据与开合状态全部来自共享 store（2026-10-29）：
   * 卡头 Git 图标的待提交角标与本弹窗用的是同一份大盘数据、同一个 45 秒轮询；
   * 弹窗打开时立即 force 刷新一次，避免看到打开前最多 45 秒的旧数字。
   */
  const snapshot = useGitRosterSnapshot(true)
  const [activeTab, setActiveTab] = useState<'all' | 'plugins' | 'workspaces'>('all')
  const open = snapshot.open
  const data = snapshot.data
  const loading = snapshot.loading

  const loadRoster = useCallback(() => {
    void store.refresh(true)
  }, [store])

  useEffect(() => {
    if (open) void store.refresh(true)
  }, [open, store])

  if (!open) return null

  const onClose = () => {
    store.close()
  }

  const workspaces = data?.workspaces ?? []
  const plugins = data?.plugins ?? []

  let displayItems: readonly GitRosterItem[] = []
  if (activeTab === 'all') {
    displayItems = [...plugins, ...workspaces]
  } else if (activeTab === 'plugins') {
    displayItems = plugins
  } else {
    displayItems = workspaces
  }

  // 与卡头角标同一份计算（store 的 dirtyRepoCountOf / totalConflictsOf），
  // 不在弹窗里另写一套 reduce —— 否则角标与弹窗顶部数字会各算各的。
  const dirtyRepoCount = snapshot.dirtyRepoCount
  const totalConflicts = snapshot.totalConflicts

  return (
    <div
      className="kr-git-roster-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kr-git-roster-title"
    >
      <div
        className="kr-git-roster-modal"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        {/* 顶部 Header：优雅克制 */}
        <div className="kr-git-roster-modal__header">
          <div className="kr-git-roster-modal__title-row">
            {/* 官方正统 Git SCM 经典菱形 Logo */}
            <svg
              className="kr-git-roster-modal__git-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M23.546 10.93L13.067.452a1.5 1.5 0 0 0-2.126 0L8.808 2.585l3.247 3.248a1.782 1.782 0 0 1 2.25 2.252l3.125 3.125a1.784 1.784 0 1 1-.95.952l-2.91-2.91v4.542a1.783 1.783 0 1 1-1.34 0V8.895a1.78 1.78 0 0 1-.986-.986L7.99 4.656.454 12.193a1.5 1.5 0 0 0 0 2.126l10.479 10.478a1.5 1.5 0 0 0 2.126 0l10.487-10.487a1.5 1.5 0 0 0 0-2.126l.002-.002z" />
            </svg>

            <span id="kr-git-roster-title" className="kr-git-roster-modal__title">
              Git 工作台
            </span>

            {/* 顶栏全局状态：中性色低饱和概览 */}
            <div className="kr-git-roster-modal__stats">
              {dirtyRepoCount > 0 && (
                <span className="kr-git-roster-stat kr-git-roster-stat--pending">
                  <span className="kr-git-roster-stat__dot" />
                  <span>{dirtyRepoCount} 个项目未提交</span>
                </span>
              )}
              {totalConflicts > 0 && (
                <span className="kr-git-roster-stat kr-git-roster-stat--conflict">
                  <span className="kr-git-roster-stat__dot" />
                  <span>{totalConflicts} 冲突</span>
                </span>
              )}
            </div>
          </div>

          <div className="kr-git-roster-modal__header-tools">
            {/* 刷新 */}
            <button
              type="button"
              className={`kr-git-roster-modal__tool-btn ${loading ? 'kr-git-roster-modal__spin' : ''}`}
              onClick={loadRoster}
              disabled={loading}
              title="重新扫描各仓库状态"
              aria-label="刷新状态"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2v4h-4M2 14v-4h4" />
                <path d="M2.5 6a6 6 0 0 1 9.5-2.5L14 6M13.5 10a6 6 0 0 1-9.5 2.5L2 10" />
              </svg>
            </button>

            {/* 关闭 */}
            <button
              type="button"
              className="kr-git-roster-modal__tool-btn"
              onClick={onClose}
              title="关闭 (Esc)"
              aria-label="关闭窗口"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
                <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* 现代分段控制条 (Segmented Control) */}
        <div className="kr-git-roster-modal__nav-bar">
          <div className="kr-git-roster-segmented">
            <button
              type="button"
              className={`kr-git-roster-segmented__btn ${activeTab === 'all' ? 'kr-git-roster-segmented__btn--active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              <span>全部</span>
              <span className="kr-git-roster-segmented__num">{plugins.length + workspaces.length}</span>
            </button>
            <button
              type="button"
              className={`kr-git-roster-segmented__btn ${activeTab === 'plugins' ? 'kr-git-roster-segmented__btn--active' : ''}`}
              onClick={() => setActiveTab('plugins')}
            >
              <span>自制插件</span>
              <span className="kr-git-roster-segmented__num">{plugins.length}</span>
            </button>
            <button
              type="button"
              className={`kr-git-roster-segmented__btn ${activeTab === 'workspaces' ? 'kr-git-roster-segmented__btn--active' : ''}`}
              onClick={() => setActiveTab('workspaces')}
            >
              <span>工作区</span>
              <span className="kr-git-roster-segmented__num">{workspaces.length}</span>
            </button>
          </div>
        </div>

        {/* 舒展宽幅列表区 */}
        <div className="kr-git-roster-modal__list-area">
          {loading && !data ? (
            <div className="kr-git-roster-modal__state-box">
              <svg className="kr-git-roster-modal__spin" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10" />
              </svg>
              <span>正在扫描工作区与插件 Git 状态...</span>
            </div>
          ) : displayItems.length === 0 ? (
            <div className="kr-git-roster-modal__state-box">
              <span>暂无匹配的项目</span>
            </div>
          ) : (
            <div className="kr-git-roster-table">
              {/* 列表表头 */}
              <div className="kr-git-roster-table__header">
                <div className="kr-git-roster-col kr-git-roster-col--repo">项目名称</div>
                <div className="kr-git-roster-col kr-git-roster-col--branch">分支</div>
                <div className="kr-git-roster-col kr-git-roster-col--commit">最近提交 / 路径</div>
                <div className="kr-git-roster-col kr-git-roster-col--status">状态</div>
                <div className="kr-git-roster-col kr-git-roster-col--action">操作</div>
              </div>

              {/* 数据行 */}
              <div className="kr-git-roster-table__body">
                {displayItems.map((item, idx) => {
                  const isPlugin = item.category === 'plugin'
                  const hasPending = item.pendingCount > 0
                  const hasConflict = item.conflictCount > 0

                  return (
                    <div key={idx} className="kr-git-roster-item-row">
                      {/* 1. 项目名称与分类 */}
                      <div className="kr-git-roster-col kr-git-roster-col--repo">
                        <span className="kr-git-roster-item__name" title={item.path}>
                          {item.name}
                        </span>
                        <span className={`kr-git-roster-item__tag kr-git-roster-item__tag--${item.category}`}>
                          {isPlugin ? '插件' : '工作区'}
                        </span>
                      </div>

                      {/* 2. 分支 */}
                      <div className="kr-git-roster-col kr-git-roster-col--branch">
                        {item.branch ? (
                          <div className="kr-git-roster-item__branch-chip" title={`分支: ${item.branch}`}>
                            {/* 标准 GitHub 分支 SVG */}
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 8a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0-9a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
                            </svg>
                            <span>{item.branch}</span>
                          </div>
                        ) : (
                          <span className="kr-git-roster-item__dim">-</span>
                        )}
                      </div>

                      {/* 3. 提交详情或路径（大空间舒展展开，不拥挤） */}
                      <div className="kr-git-roster-col kr-git-roster-col--commit">
                        {item.lastCommit ? (
                          <div
                            className="kr-git-roster-item__commit-cell"
                            title={`[${item.lastCommit.hash}] ${item.lastCommit.subject} (${item.lastCommit.dateIso})`}
                          >
                            <span className="kr-git-roster-item__commit-time">
                              {item.lastCommit.relative}
                            </span>
                            <span className="kr-git-roster-item__commit-subject">
                              {item.lastCommit.subject}
                            </span>
                          </div>
                        ) : (
                          <div className="kr-git-roster-item__path-cell" title={item.path}>
                            <span>{item.path}</span>
                          </div>
                        )}
                      </div>

                      {/* 4. 状态（低饱和、高级中性微胶囊） */}
                      <div className="kr-git-roster-col kr-git-roster-col--status">
                        {hasConflict ? (
                          <span className="kr-git-status-tag kr-git-status-tag--conflict" title="存在冲突需解决">
                            <span className="kr-git-status-tag__dot" />
                            <span>{item.conflictCount} 冲突</span>
                          </span>
                        ) : hasPending ? (
                          <span className="kr-git-status-tag kr-git-status-tag--pending" title={`${item.pendingCount} 个未提交变更`}>
                            <span className="kr-git-status-tag__dot" />
                            <span>{item.pendingCount} 待提交</span>
                          </span>
                        ) : item.isGit ? (
                          <span className="kr-git-status-tag kr-git-status-tag--clean" title="工作区干净">
                            <span className="kr-git-status-tag__dot" />
                            <span>干净</span>
                          </span>
                        ) : (
                          <span className="kr-git-status-tag kr-git-status-tag--folder" title="工作区根目录">
                            <span>工作区根</span>
                          </span>
                        )}
                      </div>

                      {/* 5. 一键建会话动作按钮 */}
                      <div className="kr-git-roster-col kr-git-roster-col--action">
                        <button
                          type="button"
                          className="kr-git-action-btn"
                          onClick={() => launchSessionForRepo(item, onClose)}
                          title={`以【${item.name}】自动新建会话并填充指令`}
                          aria-label={`开启 ${item.name} 会话`}
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6.5l-3.5 2.5V13h-1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                            <line x1="5.5" y1="7" x2="10.5" y2="7" />
                          </svg>
                          <span>开启会话</span>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
