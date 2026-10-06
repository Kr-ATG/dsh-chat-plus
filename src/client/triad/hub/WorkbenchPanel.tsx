/**
 * WorkbenchPanel — 6 合 1 统一工作台主容器。
 *
 * 聚合模块：
 *  1. 灵魂 (Soul)      — 身份契约层：卡片 + 预设 + 整段正文/身份/档案/蒸馏
 *  2. 记忆 (Memory)    — DSH 暗色系大盘与卡片流
 *  2. 能力 (Skills)    — 技能与 MCP 工具包管理
 *  3. 用量 (Usage)     — Token 消耗总览、24小时/月度平滑曲线与 52 周全局热力大盘
 *  4. 画廊 (Gallery)   — 多媒体画廊：所有对话生成的图片 / 网页 / 演示 / 文档一站查看
 *  5. 邮件 (Mail)      — Agent Mail 代理三栏工作台
 *
 * 供应商与网络代理**不在这里**（2026-10-05 用户点名「还是把供应商配置和代理
 * 放在设置里面吧」）：两者都在官方「设置」弹窗的「供应商」页
 * （src/client/provider/webui/section.tsx，座位 settings.section / id provider-hub）。
 */

import { useEffect, useMemo, useState } from 'react'
import { ensureWorkbenchStyles } from './styles.js'
import { MemoryPanel } from '../memory/Panel.js'
import { SkillsPanel } from '../usage/dashboard/SkillsPanel.js'
import { UsagePanel } from '../usage/dashboard/UsagePanel.js'
import { GalleryPanel } from '../gallery/GalleryPanel.js'
import { MailPanel } from '../mail/Panel.js'
import { createMemoryApi } from '../memory/api.js'
import { SoulPanel, createSoulApi } from '../soul/index.js'
import { createMailApi } from '../mail/api.js'
import { PopoverShell } from '../popover-shell.js'
import {
  readWorkbenchTab,
  WORKBENCH_TAB_EVENT,
  WORKBENCH_TABS,
  WorkbenchTabIcon,
} from './row-flyout.js'

export type WorkbenchTab = 'soul' | 'memory' | 'skills' | 'usage' | 'gallery' | 'mail'

/**
 * 默认 Tab。
 *
 * 2026-10 导航改版：分类切换器从页面顶部**整条移除**，搬到侧栏「工作台」行
 * （hover 浮层 + 滚轮直切，见 ./row-flyout.tsx）。页面顶部只留一行面包屑
 * 说明身在何处，六个页面各自成为一个完整板块，不再像「某个 tab 的内容」。
 * 当前分类仍写 localStorage（与侧栏行共用同一把键），重开工作台回到上次那页。
 */
export const DEFAULT_TAB: WorkbenchTab = 'soul'

export interface WorkbenchPanelProps {
  onClose: () => void
  initialTab?: WorkbenchTab
}

/** 现代工作台方阵图标（侧栏「工作台」菜单行用）。 */
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

export function WorkbenchPanel({ onClose, initialTab = DEFAULT_TAB }: WorkbenchPanelProps): JSX.Element {
  ensureWorkbenchStyles()

  const [activeTab, setActiveTab] = useState<WorkbenchTab>(() => {
    // 与侧栏行共用同一把 localStorage 键：滚轮切到的分类在这里原样回填。
    const saved = readWorkbenchTab()
    return saved !== DEFAULT_TAB || initialTab === DEFAULT_TAB ? saved : initialTab
  })

  // 侧栏行的滚轮 / 浮层点击经事件广播过来：页面在就原地换页。
  useEffect(() => {
    const onTab = (event: Event): void => {
      const next = (event as CustomEvent<WorkbenchTab>).detail
      if (WORKBENCH_TABS.some((t) => t.id === next)) setActiveTab(next)
    }
    window.addEventListener(WORKBENCH_TAB_EVENT, onTab)
    return () => { window.removeEventListener(WORKBENCH_TAB_EVENT, onTab) }
  }, [])

  const memoryApi = useMemo(() => createMemoryApi(), [])
  const mailApi = useMemo(() => createMailApi(), [])
  // 灵魂 API 面用单例（无状态 fetch 包装）：每次渲染返回新对象会让子面板的
  // useEffect 依赖随渲染重发请求，记忆面板历史上打过一分钟 498 次的请求风暴。
  const soulApi = useMemo(() => createSoulApi(), [])

  const meta = WORKBENCH_TABS.find((t) => t.id === activeTab) ?? WORKBENCH_TABS[0]

  return (
    <PopoverShell
      onClose={onClose}
      ariaLabel="工作台"
    >
      <div className="wb-root">
        {/* 页头：面包屑一行说明身在何处（分类导航在侧栏行上，页内不再放切换器） */}
        <div className="wb-header">
          <div className="wb-crumb">
            <span className="wb-crumb-root">工作台</span>
            <span className="wb-crumb-sep" aria-hidden="true">/</span>
            <span className="wb-crumb-icon"><WorkbenchTabIcon tab={activeTab} size={13} /></span>
            <span className="wb-crumb-current">{meta.label}</span>
            <span className="wb-crumb-desc">{meta.desc}</span>
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

        {/* 主体内容视图（按分类切换；key 随分类变化，重播 .wb-body > * 的入场动效） */}
        <div className="wb-body">
          {/* 灵魂：身份契约层独占一页。整页宽度给卡片区与预设区。 */}
          {activeTab === 'soul' && (
            <div key="soul" className="wb-soul-scroll">
              <SoulPanel api={soulApi} embedded />
            </div>
          )}

          {/* 记忆：完整三栏工作台（列表 / 详情 / 导航），一个能力都不少。 */}
          {activeTab === 'memory' && (
            <MemoryPanel key="memory" {...memoryApi} onClose={onClose} embedded />
          )}

          {activeTab === 'skills' && (
            <SkillsPanel key="skills" onClose={onClose} embedded />
          )}

          {activeTab === 'usage' && (
            <UsagePanel key="usage" onClose={onClose} embedded />
          )}

          {activeTab === 'gallery' && (
            <GalleryPanel key="gallery" onClose={onClose} />
          )}

          {activeTab === 'mail' && (
            <MailPanel key="mail" api={mailApi} onClose={onClose} embedded />
          )}

        </div>
      </div>
    </PopoverShell>
  )
}
