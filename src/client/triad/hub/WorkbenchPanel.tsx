/**
 * WorkbenchPanel — 5 合 1 统一工作台主容器。
 *
 * 聚合模块：
 *  1. 记忆 (Memory)  — 全新重设计的 DSH 暗色系大盘与卡片流
 *  2. 能力 (Skills)  — 技能与 MCP 工具包管理
 *  3. 用量 (Usage)   — Token 消耗总览、24小时/月度平滑曲线与 52 周全局热力大盘
 *  4. 画廊 (Gallery) — 多媒体画廊：所有对话生成的图片 / 网页 / 演示 / 文档一站查看
 *  5. 邮件 (Mail)    — Agent Mail 代理三栏工作台
 */

import { useMemo, useState } from 'react'
import { ensureWorkbenchStyles } from './styles.js'
import { MemoryPanel } from '../memory/Panel.js'
import { SkillsPanel } from '../usage/dashboard/SkillsPanel.js'
import { UsagePanel } from '../usage/dashboard/UsagePanel.js'
import { GalleryPanel, GalleryTabIcon } from '../gallery/GalleryPanel.js'
import { MailPanel } from '../mail/Panel.js'
import { createMemoryApi } from '../memory/api.js'
import { createMailApi } from '../mail/api.js'
import { PopoverShell } from '../popover-shell.js'

export type WorkbenchTab = 'memory' | 'skills' | 'usage' | 'gallery' | 'mail'

export interface WorkbenchPanelProps {
  onClose: () => void
  initialTab?: WorkbenchTab
}

/** 现代工作台方阵图标 */
export function WorkbenchGridIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

export function WorkbenchPanel({ onClose, initialTab = 'memory' }: WorkbenchPanelProps): JSX.Element {
  ensureWorkbenchStyles()

  const [activeTab, setActiveTab] = useState<WorkbenchTab>(() => {
    try {
      const saved = localStorage.getItem('dsh-workbench-active-tab') as WorkbenchTab | null
      if (saved && ['memory', 'skills', 'usage', 'gallery', 'mail'].includes(saved)) return saved
    } catch { /* 忽略读取错误 */ }
    return initialTab
  })

  const memoryApi = useMemo(() => createMemoryApi(), [])
  const mailApi = useMemo(() => createMailApi(), [])

  const handleSelectTab = (tab: WorkbenchTab): void => {
    setActiveTab(tab)
    try {
      localStorage.setItem('dsh-workbench-active-tab', tab)
    } catch { /* 忽略写入错误 */ }
  }

  return (
    <PopoverShell
      onClose={onClose}
      ariaLabel="工作台"
    >
      <div className="wb-root">
        {/* 顶部统一栏 (避免使用裸 header 与 role=tablist，彻底隔绝外部会话标签注入) */}
        <div className="wb-header">
          <div className="wb-header-left">
            <div className="wb-brand">
              <span>工作台</span>
            </div>

            {/* Segmented Tabs: 记忆 · 能力 · 用量 · 邮件 */}
            <div className="wb-tabs" data-workbench-nav="true">
              <button
                type="button"
                className="wb-tab-btn"
                data-active={activeTab === 'memory' ? 'true' : undefined}
                onClick={() => { handleSelectTab('memory') }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                  <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                </svg>
                <span>记忆</span>
              </button>

              <button
                type="button"
                className="wb-tab-btn"
                data-active={activeTab === 'skills' ? 'true' : undefined}
                onClick={() => { handleSelectTab('skills') }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>能力</span>
              </button>

              <button
                type="button"
                className="wb-tab-btn"
                data-active={activeTab === 'usage' ? 'true' : undefined}
                onClick={() => { handleSelectTab('usage') }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 20V10" />
                  <path d="M12 20V4" />
                  <path d="M6 20v-6" />
                </svg>
                <span>用量</span>
              </button>

              <button
                type="button"
                className="wb-tab-btn"
                data-active={activeTab === 'gallery' ? 'true' : undefined}
                onClick={() => { handleSelectTab('gallery') }}
              >
                <GalleryTabIcon size={13} />
                <span>画廊</span>
              </button>

              <button
                type="button"
                className="wb-tab-btn"
                data-active={activeTab === 'mail' ? 'true' : undefined}
                onClick={() => { handleSelectTab('mail') }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>邮件</span>
              </button>
            </div>
          </div>

          <div className="wb-header-right">
            <button
              type="button"
              className="wb-icon-btn"
              title="关闭并切回会话"
              aria-label="关闭"
              onClick={onClose}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 主体内容视图（按 Tab 切换） */}
        <div className="wb-body">
          {activeTab === 'memory' && (
            <MemoryPanel {...memoryApi} onClose={onClose} embedded />
          )}

          {activeTab === 'skills' && (
            <SkillsPanel onClose={onClose} embedded />
          )}

          {activeTab === 'usage' && (
            <UsagePanel onClose={onClose} embedded />
          )}

          {activeTab === 'gallery' && (
            <GalleryPanel onClose={onClose} />
          )}

          {activeTab === 'mail' && (
            <MailPanel api={mailApi} onClose={onClose} embedded />
          )}
        </div>
      </div>
    </PopoverShell>
  )
}
