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
import { ensureWorkbenchTheme } from './theme.js'
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
 * 2026-10 v4 导航定稿：分类切换**只在侧栏那一行横滑条上**（./strip.tsx），
 * 页内不再有任何切换器——原先的悬浮胶囊 Dock 与更早的顶部 tab 栏都已删除。
 * 六个页面各自成为完整板块，页头只表达「我是谁」。
 * 当前分类写 localStorage（侧栏条与页面共用同一把键），重开工作台回到上次那页。
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
 * 分类页页头（效果图每页的 eyebrow + 巨型标题 + 一句定位）。
 * 纯展示：eyebrow / 标题 / 副句按分类取，不接状态。
 */
const PAGE_HEADS: ReadonlyArray<{ id: WorkbenchTab; eyebrow: string; title: string; sub: string; tail: string }> = [
  { id: 'soul', eyebrow: 'Identity Contract', title: '灵魂', sub: '跨会话恒定的身份契约层。卡片是权威，正文是投影；逐项调走卡片，整段改写收进深改区。', tail: '我是谁' },
  { id: 'memory', eyebrow: 'Memory Stream', title: '记忆', sub: '按时间成河，按重要度分层。左侧图标轨切视图，选中条目右侧滑出详情抽屉。', tail: '记住什么' },
  { id: 'skills', eyebrow: 'Capability Matrix', title: '能力', sub: '技能包与 MCP 服务统一编目。左列是包（可归入、可重命名），右列是服务（带实时状态）。', tail: '会什么' },
  { id: 'usage', eyebrow: 'Token Telemetry', title: '用量', sub: '范围胶囊只作用于消耗汇总；热力带恒为全量 52 周，是横跨历史的总览。', tail: '烧了多少' },
  { id: 'gallery', eyebrow: 'Output Gallery', title: '画廊', sub: '所有对话产出的图片、网页、演示、文档一站看全。', tail: '产出过什么' },
  { id: 'mail', eyebrow: 'Agent Mail', title: '邮件', sub: '代理三栏工作台。HTML 正文一律走沙箱 iframe；写操作点一下就执行。', tail: '收件与回信' },
]

function PageHead({ tab }: { tab: WorkbenchTab }): JSX.Element | null {
  const head = PAGE_HEADS.find(item => item.id === tab)
  // 用量页头在 UsagePanel 嵌入分支内（与英雄区同一组件树）
  if (head === undefined || tab === 'usage') return null
  return (
    <header className="wb2-head wb2-rise">
      <div className="wb2-head-l">
        <span className="wb2-eyebrow"><i />{head.eyebrow}</span>
        <h1 className="wb2-title">{head.title} <em>/ {head.tail}</em></h1>
        <p className="wb2-sub">{head.sub}</p>
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

  /**
   * ⌘1–6 / Ctrl+1–6 直切分类（与侧栏横滑条的提示一致）。
   *
   * 只在工作台页挂载期间生效（本组件就是那一页），不进全局快捷键表——它是
   * 页内导航，离开工作台按这组键不该有任何反应。输入框内不劫持。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const index = Number.parseInt(event.key, 10) - 1
      if (!Number.isInteger(index) || index < 0 || index >= WORKBENCH_TABS.length) return
      const target = event.target
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      event.preventDefault()
      writeWorkbenchTab(WORKBENCH_TABS[index].id)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  return (
    <PopoverShell
      onClose={onClose}
      ariaLabel="工作台"
    >
      <div className="wb-root">
        {/* 分类切换在侧栏横滑条上（./strip.tsx），页内不再放切换器 */}

        {/* 主体内容视图（按分类切换；key 随分类变化，重播 .wb-body > * 的入场动效） */}
        <div className="wb-body">
          {/* 灵魂：身份契约层独占一页。整页宽度给卡片区与预设区。 */}
          {activeTab === 'soul' && (
            <div key="soul" className="wb-soul-scroll">
              <PageHead tab="soul" />
              <SoulPanel api={soulApi} embedded />
            </div>
          )}

          {/* 记忆：完整三栏工作台（列表 / 详情 / 导航），一个能力都不少。 */}
          {activeTab === 'memory' && (
            <div key="memory" className="wb2-page-wrap">
              <PageHead tab="memory" />
              <MemoryPanel {...memoryApi} onClose={onClose} embedded />
            </div>
          )}

          {activeTab === 'skills' && (
            <div key="skills" className="wb2-page-wrap">
              <PageHead tab="skills" />
              <SkillsPanel onClose={onClose} embedded />
            </div>
          )}

          {activeTab === 'usage' && (
            <UsagePanel key="usage" onClose={onClose} embedded />
          )}

          {activeTab === 'gallery' && (
            <div key="gallery" className="wb2-page-wrap">
              <PageHead tab="gallery" />
              <GalleryPanel onClose={onClose} />
            </div>
          )}

          {activeTab === 'mail' && (
            <div key="mail" className="wb2-page-wrap">
              <PageHead tab="mail" />
              <MailPanel api={mailApi} onClose={onClose} embedded />
            </div>
          )}

        </div>
      </div>
    </PopoverShell>
  )
}
