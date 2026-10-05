/**
 * WorkbenchPanel — 7 合 1 统一工作台主容器。
 *
 * 聚合模块：
 *  1. 灵魂 (Soul)      — 身份契约层：卡片 + 预设 + 整段正文/身份/档案/蒸馏
 *  2. 记忆 (Memory)    — DSH 暗色系大盘与卡片流
 *  2. 能力 (Skills)    — 技能与 MCP 工具包管理
 *  3. 用量 (Usage)     — Token 消耗总览、24小时/月度平滑曲线与 52 周全局热力大盘
 *  4. 画廊 (Gallery)   — 多媒体画廊：所有对话生成的图片 / 网页 / 演示 / 文档一站查看
 *  5. 邮件 (Mail)      — Agent Mail 代理三栏工作台
 *  6. 供应商 (Provider)— 原 dsh-provider-hub 的独立设置页（2026-10-05 融合）：
 *                        左供应商列表 / 右详情（API Key、Base URL、协议、模型列表、
 *                        推理等级检测）+ 辅助视觉 / 生图 / 生视频三块
 *  （网络代理不是独立 Tab：用户 2026-10-05 明确「不需要一个单独分类」，
 *    已并入「供应商」页底部的区块列表，与辅助视觉 / 生图 / 生视频同列）
 */

import { useMemo, useState } from 'react'
import { ensureWorkbenchStyles } from './styles.js'
import { MemoryPanel } from '../memory/Panel.js'
import { SkillsPanel } from '../usage/dashboard/SkillsPanel.js'
import { UsagePanel } from '../usage/dashboard/UsagePanel.js'
import { GalleryPanel, GalleryTabIcon } from '../gallery/GalleryPanel.js'
import { MailPanel } from '../mail/Panel.js'
import { createMemoryApi } from '../memory/api.js'
import { SoulPanel, createSoulApi } from '../soul/index.js'
import { createMailApi } from '../mail/api.js'
import { PopoverShell } from '../popover-shell.js'
import { SupplierSection } from '../../provider/webui/section.js'
import { DSH_WHALE_PATH, DSH_WHALE_VIEWBOX } from '../brand/whale-path.js'

export type WorkbenchTab = 'soul' | 'memory' | 'skills' | 'usage' | 'gallery' | 'mail' | 'provider'

/** 合法 Tab（localStorage 回填白名单）。 */
const TABS: readonly WorkbenchTab[] = ['soul', 'memory', 'skills', 'usage', 'gallery', 'mail', 'provider']

/**
 * 默认 Tab。
 *
 * 2026-10-05 用户先要求「灵魂与记忆同屏并排」，随后改为**拆成两个独立分类**
 * （「还是把记忆和灵魂分开两个分类吧」）。现在的形态是：
 *
 *   [灵魂] [记忆] [能力] [用量] [画廊] [邮件] [供应商]
 *
 * 灵魂占一个平级 Tab（整页宽度给卡片与预设），记忆占另一个（完整三栏工作台）。
 * 两者仍是同一件事的两端，但各自独立成页——并排时每边只有半屏，灵魂的卡片
 * 与记忆的列表都伸展不开。soul 仍在首位并作为默认 Tab，只有用户主动切过
 * 别的 Tab 才会被 localStorage 记住。
 */
export const DEFAULT_TAB: WorkbenchTab = 'soul'

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

/**
 * 灵魂 Tab 图标：DSH 鲸鱼剪影。
 *
 * 用官方 FishLogo 的 path（与截图卡里的品牌徽标同一形状），只取一小段足以辨认的
 * 轮廓——Tab 里 13px 的尺寸下细节全糊，认的是「那是一条鲸鱼」这个整体剪影。
 */
function WhaleTabIcon(): JSX.Element {
  return (
    <svg width="14" height="11" viewBox={DSH_WHALE_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d={DSH_WHALE_PATH} />
    </svg>
  )
}

/** 供应商图标（插头 + 座，与原设置页语义一致）。 */
function ProviderTabIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  )
}

export function WorkbenchPanel({ onClose, initialTab = DEFAULT_TAB }: WorkbenchPanelProps): JSX.Element {
  ensureWorkbenchStyles()

  const [activeTab, setActiveTab] = useState<WorkbenchTab>(() => {
    try {
      const saved = localStorage.getItem('dsh-workbench-active-tab') as WorkbenchTab | null
      if (saved && TABS.includes(saved)) {
        // 'memory' 是**合法**值（记忆是独立分类），原样回填——2026-10-05 拆开之前
        // 这里曾把它强制迁移到 'soul'（当时灵魂与记忆同屏并排），拆分后那条迁移
        // 必须去掉，否则用户每次打开工作台都会被拽去灵魂页。
        return saved
      }
    } catch { /* 忽略读取错误 */ }
    return initialTab
  })

  const memoryApi = useMemo(() => createMemoryApi(), [])
  const mailApi = useMemo(() => createMailApi(), [])
  // 灵魂 API 面用单例（无状态 fetch 包装）：每次渲染返回新对象会让子面板的
  // useEffect 依赖随渲染重发请求，记忆面板历史上打过一分钟 498 次的请求风暴。
  const soulApi = useMemo(() => createSoulApi(), [])

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

            {/* Segmented Tabs: 灵魂 · 记忆 · 能力 · 用量 · 画廊 · 邮件 · 供应商 */}
            <div className="wb-tabs" data-workbench-nav="true">
              <button
                type="button"
                className="wb-tab-btn"
                data-active={activeTab === 'soul' ? 'true' : undefined}
                onClick={() => { handleSelectTab('soul') }}
              >
                <WhaleTabIcon />
                <span>灵魂</span>
              </button>

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

              <button
                type="button"
                className="wb-tab-btn"
                data-active={activeTab === 'provider' ? 'true' : undefined}
                onClick={() => { handleSelectTab('provider') }}
              >
                <ProviderTabIcon />
                <span>供应商</span>
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

        {/* 主体内容视图（按 Tab 切换；key 随 Tab 变化，重播 .wb-body > * 的入场动效） */}
        <div className="wb-body">
          {/* 灵魂：身份契约层独占一页。整页宽度给卡片区与预设区——并排时左半屏
              只有 485px，卡片列表和预设行都被挤成一列小按钮（2026-10-05 拆分原因）。 */}
          {activeTab === 'soul' && (
            <div key="soul" className="wb-soul-scroll">
              <SoulPanel api={soulApi} embedded />
            </div>
          )}

          {/* 记忆：完整三栏工作台（列表 / 详情 / 导航），一个能力都不少。
              面板内不再挂「灵魂」子 Tab——灵魂是平级分类，入口只此一处。 */}
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

          {activeTab === 'provider' && (
            <div key="provider" className="wb-supplier-scroll">
              <SupplierSection />
            </div>
          )}

        </div>
      </div>
    </PopoverShell>
  )
}
