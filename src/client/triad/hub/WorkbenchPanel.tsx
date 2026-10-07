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
import type { CSSProperties } from 'react'
import { ensureWorkbenchStyles } from './styles.js'
import { ensureWorkbenchTheme } from './theme.js'
import { WorkbenchDock } from './Dock.js'
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
  writeWorkbenchTab,
  WORKBENCH_TAB_EVENT,
  WORKBENCH_TABS,
} from './row-flyout.js'

export type WorkbenchTab = 'soul' | 'memory' | 'skills' | 'usage' | 'gallery' | 'mail'

/**
 * 默认 Tab。
 *
 * 2026-10 导航二次改版：分类切换器是页面顶部的**悬浮胶囊 Dock**（./Dock.tsx），
 * 侧栏「工作台」行的 hover 浮层 / 滚轮直切（./row-flyout.tsx）与其经事件互通。
 * 六个页面各自成为一个完整板块，不再像「某个 tab 的内容」。
 * 当前分类仍写 localStorage（三处共用同一把键），重开工作台回到上次那页。
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

/**
 * 灵魂页页头（效果图的 Editorial Split 头部）。
 *
 * 纯展示：SoulPanel 自带的小头部在 theme.ts 里被隐藏，这里给整页一个
 * 与效果图一致的巨型标题 + 一句定位说明。不接任何状态——保存/蒸馏等
 * 动作仍在 SoulPanel 内，页头只承担「身在何处」的版面语义。
 */
function SoulPageHead(): JSX.Element {
  return (
    <header className="wb2-head wb2-rise" style={{ '--d': '0ms' } as CSSProperties}>
      <div className="wb2-head-l">
        <span className="wb2-eyebrow"><i />Identity Contract</span>
        <h1 className="wb2-title">灵魂 <em>/ 我是谁</em></h1>
        <p className="wb2-sub">跨会话恒定的身份契约层。卡片是权威，正文是投影；逐项调走卡片，整段改写收进修改区。</p>
      </div>
    </header>
  )
}

export function WorkbenchPanel({ onClose, initialTab = DEFAULT_TAB }: WorkbenchPanelProps): JSX.Element {
  ensureWorkbenchStyles()
  ensureWorkbenchTheme()

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

  const handleSelectTab = (tab: WorkbenchTab): void => {
    setActiveTab(tab)
    writeWorkbenchTab(tab)
  }

  return (
    <PopoverShell
      onClose={onClose}
      ariaLabel="工作台"
    >
      <div className="wb-root">
        {/* 悬浮胶囊 Dock：分类切换 + 关闭（2026-10 全新设计，取代顶部 tab 栏） */}
        <WorkbenchDock active={activeTab} onSelect={handleSelectTab} onClose={onClose} />

        {/* 主体内容视图（按分类切换；key 随分类变化，重播 .wb-body > * 的入场动效） */}
        <div className="wb-body">
          {/* 灵魂：身份契约层独占一页。整页宽度给卡片区与预设区。 */}
          {activeTab === 'soul' && (
            <div key="soul" className="wb-soul-scroll">
              <SoulPageHead />
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
