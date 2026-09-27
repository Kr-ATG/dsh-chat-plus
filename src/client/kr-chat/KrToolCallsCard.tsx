/**
 * dsh-chat-plus — 工具调用明细卡片。
 * 支持点击展开查看详细调用参数、返回结果、退出码与执行元数据。
 * 失败的调用只展示错误信息，不提供重试按钮（重试由用户重新发起提问决定，
 * 卡片内的按钮无法真正重放工具调用）。
 */
import { memo, useState, useCallback } from 'react'

/**
 * 折叠态默认列出的工具调用条数。
 *
 * **0 = 一条都不列**：用户明确要求工具调用默认整块折叠，只留标题行与「展开 N 次
 * 调用」入口。理由和大盘顶栏隐藏一致——右栏的信息主角是「做了什么」而不是每次
 * 调用的参数与返回，铺开 5 行会把思考/记忆挤出屏幕。想看得点一下展开，展开后是
 * 全量列表。
 */
const TOOL_LIST_PREVIEW_COUNT = 0

export interface ToolCallItemView {
  readonly id: string
  readonly callId?: string
  readonly name: string
  readonly description: string
  readonly durationText: string
  readonly status: 'success' | 'running' | 'failed'
  readonly errorMessage?: string
  readonly argsRaw?: string
  readonly args?: Record<string, unknown>
  readonly resultText?: string
  readonly rawResultJson?: string
  readonly exitCode?: number
  readonly signal?: string
}

export interface ToolCallsCardProps {
  readonly tools: readonly ToolCallItemView[]
  readonly onInspectCall?: (callId: string) => void
}

export const KrToolCallsCard = memo(function KrToolCallsCard({
  tools,
  onInspectCall,
}: ToolCallsCardProps) {
  const [showAllTools, setShowAllTools] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [activeTabs, setActiveTabs] = useState<Record<string, 'result' | 'input' | 'raw'>>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  if (tools.length === 0) return null

  const visibleTools = showAllTools ? tools : tools.slice(0, TOOL_LIST_PREVIEW_COUNT)

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleCopy = (key: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1800)
    } catch {
      // fallback
    }
  }

  const renderToolIcon = (name: string) => {
    const n = name.toLowerCase()
    if (n.includes('code') || n.includes('bash') || n.includes('terminal') || n.includes('cmd') || n.includes('pwsh')) {
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4.5 5.5-3 3 3 3M11.5 5.5l3 3-3 3M9.5 3.5l-3 9" />
        </svg>
      )
    }
    if (n.includes('read') || n.includes('browse') || n.includes('cat') || n.includes('view')) {
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5v-9z" />
          <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
        </svg>
      )
    }
    if (n.includes('edit') || n.includes('write') || n.includes('replace') || n.includes('patch')) {
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 2l3 3-8.5 8.5H2.5v-3L11 2z" />
        </svg>
      )
    }
    if (n.includes('search') || n.includes('grep') || n.includes('find') || n.includes('glob')) {
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="m10 10 3.5 3.5" />
        </svg>
      )
    }
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
      </svg>
    )
  }

  return (
    <div className="kr-card kr-card--tools">
      {/* 卡片头部：标题与「展开 N 次调用」入口同在一行（用户要求文字不换行）。
          点头部任意位置 = 展开/收起整个调用列表。 */}
      <div className="kr-card__header" onClick={() => setShowAllTools(!showAllTools)}>
        <span className="kr-card__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 10.8a2 2 0 0 0-2.8-2.8l-1.4 1.4-2.8-2.8 1.4-1.4a2 2 0 0 0-2.8-2.8L4.8 3.9a5 5 0 0 0-.9 5.3L1.2 12a1 1 0 0 0 1.4 1.4l2.8-2.7a5 5 0 0 0 5.3-.9l1.5-1.5z" />
          </svg>
        </span>
        <span className="kr-card__title">工具调用 ({tools.length})</span>
        {/* 展开入口（同一行右端）：列表收起且还有未展示条目时才显示。 */}
        {!showAllTools && tools.length > TOOL_LIST_PREVIEW_COUNT && (
          <span className="kr-tools-expand-hint">展开 {tools.length} 次调用</span>
        )}
      </div>

      {showAllTools && (
        <div className="kr-tools-list">
          {visibleTools.map((tool) => {
            const isExpanded = expandedIds.has(tool.id)
            const isFailed = tool.status === 'failed'
            const isRunning = tool.status === 'running'
            const tab = activeTabs[tool.id] ?? (isFailed ? 'result' : (tool.resultText ? 'result' : (tool.argsRaw ? 'input' : 'result')))

            // 命令提取
            const command = typeof tool.args?.command === 'string'
              ? tool.args.command
              : typeof tool.args?.cmd === 'string' ? tool.args.cmd
              : typeof tool.args?.script === 'string' ? tool.args.script : undefined

            // 文件提取
            const filePath = typeof tool.args?.path === 'string'
              ? tool.args.path
              : typeof tool.args?.file_path === 'string' ? tool.args.file_path : undefined

            return (
              <div
                key={tool.id}
                className={`kr-tool-card-item ${isExpanded ? 'kr-tool-card-item--expanded' : ''} ${isFailed ? 'kr-tool-card-item--failed' : ''}`}
              >
                {/* 概览行（点击展开/收起详情） */}
                <div
                  className="kr-tool-row"
                  onClick={(e) => toggleExpand(tool.id, e)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  title="点击展开/收起调用明细"
                >
                  <span className="kr-tool-icon">{renderToolIcon(tool.name)}</span>
                  <span className="kr-tool-name">{tool.name}</span>
                  <span className="kr-tool-detail" title={tool.description}>
                    {tool.description}
                  </span>
                  <span className="kr-tool-time">{tool.durationText}</span>

                  <span className={`kr-tool-status ${isFailed ? 'kr-tool-status--fail' : 'kr-tool-status--done'}`}>
                    {isFailed ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
                      </svg>
                    ) : isRunning ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <circle cx="6" cy="6" r="4.5" strokeDasharray="3 3" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M2.5 6.2 4.8 8.5 9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>

                  <span className={`kr-tool-row__chevron ${isExpanded ? 'kr-tool-row__chevron--open' : ''}`}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M2.5 4.5 6 8 9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>

                {/* 点击展开后的详细调用面板 */}
                {isExpanded && (
                  <div className="kr-tool-detail-panel">
                    {/* 台账信息栏 */}
                    <div className="kr-tool-detail__ledger">
                      <span className="kr-tool-detail__badge">
                        状态: {isFailed ? '执行失败' : isRunning ? '执行中' : '执行完毕'}
                      </span>
                      <span className="kr-tool-detail__badge">
                        耗时: {tool.durationText}
                      </span>
                      {tool.exitCode !== undefined && (
                        <span className={`kr-tool-detail__badge ${tool.exitCode !== 0 ? 'kr-tool-detail__badge--err' : ''}`}>
                          退出码: {tool.exitCode}
                        </span>
                      )}
                      {tool.signal && (
                        <span className="kr-tool-detail__badge kr-tool-detail__badge--err">
                          信号: {tool.signal}
                        </span>
                      )}
                    </div>

                    {/* 页签栏 */}
                    <div className="kr-tool-detail__tabs" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === 'result'}
                        className={`kr-tool-detail__tab ${tab === 'result' ? 'kr-tool-detail__tab--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveTabs((prev) => ({ ...prev, [tool.id]: 'result' }))
                        }}
                      >
                        执行结果
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === 'input'}
                        className={`kr-tool-detail__tab ${tab === 'input' ? 'kr-tool-detail__tab--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveTabs((prev) => ({ ...prev, [tool.id]: 'input' }))
                        }}
                      >
                        调用入参
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === 'raw'}
                        className={`kr-tool-detail__tab ${tab === 'raw' ? 'kr-tool-detail__tab--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveTabs((prev) => ({ ...prev, [tool.id]: 'raw' }))
                        }}
                      >
                        原始数据
                      </button>
                    </div>

                    {/* 页签内容区 */}
                    <div className="kr-tool-detail__content">
                      {/* 1. 执行结果 */}
                      {tab === 'result' && (
                        <div className="kr-tool-detail__section">
                          {isFailed && (
                            <div className="kr-fail-card" style={{ marginBottom: 8 }}>
                              <div className="kr-fail-text">
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="7" cy="7" r="5.5" />
                                  <path d="M7 4.5v3M7 9.8h.01" />
                                </svg>
                                <span>{tool.errorMessage || '工具调用执行失败'}</span>
                              </div>
                            </div>
                          )}

                          {tool.resultText ? (
                            <div className="kr-tool-code-box">
                              <div className="kr-tool-code-header">
                                <span>输出文本</span>
                                <button
                                  type="button"
                                  className="kr-tool-copy-btn"
                                  onClick={(e) => handleCopy(`res-${tool.id}`, tool.resultText!, e)}
                                >
                                  {copiedKey === `res-${tool.id}` ? (
                                    <>
                                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M2 6.5 4.5 9 10 3" />
                                      </svg>
                                      <span>已复制</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
                                        <path d="M8.5 3.5V2.2A1.2 1.2 0 0 0 7.3 1H2.2A1.2 1.2 0 0 0 1 2.2V7.3a1.2 1.2 0 0 0 1.2 1.2h1.3" />
                                      </svg>
                                      <span>复制</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="kr-tool-code-pre">{tool.resultText}</pre>
                            </div>
                          ) : !isFailed ? (
                            <div className="kr-tool-empty-note">
                              {isRunning ? '正在等待工具返回执行结果…' : '工具调用已成功返回，无纯文本输出（可能为只读文件加载或外部操作）。'}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {/* 2. 调用入参 */}
                      {tab === 'input' && (
                        <div className="kr-tool-detail__section">
                          {command && (
                            <div className="kr-tool-code-box" style={{ marginBottom: 8 }}>
                              <div className="kr-tool-code-header">
                                <span>命令行执行</span>
                                <button
                                  type="button"
                                  className="kr-tool-copy-btn"
                                  onClick={(e) => handleCopy(`cmd-${tool.id}`, command, e)}
                                >
                                  {copiedKey === `cmd-${tool.id}` ? (
                                    <>
                                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M2 6.5 4.5 9 10 3" />
                                      </svg>
                                      <span>已复制</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
                                        <path d="M8.5 3.5V2.2A1.2 1.2 0 0 0 7.3 1H2.2A1.2 1.2 0 0 0 1 2.2V7.3a1.2 1.2 0 0 0 1.2 1.2h1.3" />
                                      </svg>
                                      <span>复制</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="kr-tool-code-pre" style={{ color: 'var(--kr-accent)' }}>
                                $ {command}
                              </pre>
                            </div>
                          )}

                          {filePath && (
                            <div className="kr-tool-path-row">
                              <span className="kr-tool-path-label">路径:</span>
                              <code className="kr-tool-path-code">{filePath}</code>
                            </div>
                          )}

                          {tool.argsRaw ? (
                            <div className="kr-tool-code-box">
                              <div className="kr-tool-code-header">
                                <span>输入参数 JSON</span>
                                <button
                                  type="button"
                                  className="kr-tool-copy-btn"
                                  onClick={(e) => handleCopy(`arg-${tool.id}`, tool.argsRaw!, e)}
                                >
                                  {copiedKey === `arg-${tool.id}` ? (
                                    <>
                                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M2 6.5 4.5 9 10 3" />
                                      </svg>
                                      <span>已复制</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
                                        <path d="M8.5 3.5V2.2A1.2 1.2 0 0 0 7.3 1H2.2A1.2 1.2 0 0 0 1 2.2V7.3a1.2 1.2 0 0 0 1.2 1.2h1.3" />
                                      </svg>
                                      <span>复制</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="kr-tool-code-pre">
                                {tool.argsRaw}
                              </pre>
                            </div>
                          ) : (
                            <div className="kr-tool-empty-note">无输入参数</div>
                          )}
                        </div>
                      )}

                      {/* 3. 原始数据 */}
                      {tab === 'raw' && (
                        <div className="kr-tool-detail__section">
                          <div className="kr-tool-code-box">
                            <div className="kr-tool-code-header">
                              <span>完整上下文载荷 (只读)</span>
                              <button
                                type="button"
                                className="kr-tool-copy-btn"
                                onClick={(e) => handleCopy(`raw-${tool.id}`, tool.rawResultJson || tool.argsRaw || '{}', e)}
                              >
                                {copiedKey === `raw-${tool.id}` ? (
                                  <>
                                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M2 6.5 4.5 9 10 3" />
                                    </svg>
                                    <span>已复制</span>
                                  </>
                                ) : (
                                  <>
                                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
                                      <path d="M8.5 3.5V2.2A1.2 1.2 0 0 0 7.3 1H2.2A1.2 1.2 0 0 0 1 2.2V7.3a1.2 1.2 0 0 0 1.2 1.2h1.3" />
                                    </svg>
                                    <span>复制</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <pre className="kr-tool-code-pre">
                              {tool.rawResultJson || tool.argsRaw || '{\n  "status": "ready"\n}'}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 底部动作栏 */}
                    <div className="kr-tool-detail__footer">
                      <button
                        type="button"
                        className="kr-tool-footer-btn"
                        onClick={(e) => handleCopy(`all-${tool.id}`, `[工具调用] ${tool.name}\n[摘要] ${tool.description}\n[耗时] ${tool.durationText}\n[入参]\n${tool.argsRaw || ''}\n[结果]\n${tool.resultText || tool.errorMessage || ''}`, e)}
                      >
                        {copiedKey === `all-${tool.id}` ? (
                          <>
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 6.5 4.5 9 10 3" />
                            </svg>
                            <span>已复制全部明细</span>
                          </>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
                              <path d="M8.5 3.5V2.2A1.2 1.2 0 0 0 7.3 1H2.2A1.2 1.2 0 0 0 1 2.2V7.3a1.2 1.2 0 0 0 1.2 1.2h1.3" />
                            </svg>
                            <span>复制明细</span>
                          </>
                        )}
                      </button>

                      {tool.callId && onInspectCall && (
                        <button
                          type="button"
                          className="kr-tool-footer-btn kr-tool-footer-btn--link"
                          onClick={(e) => {
                            e.stopPropagation()
                            onInspectCall(tool.callId!)
                          }}
                          title="在官方轨迹视图中定位本条调用"
                        >
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="5" cy="5" r="3.5" />
                            <path d="M7.8 7.8 11 11" />
                          </svg>
                          <span>轨迹定位</span>
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3.5 2.5h6v6M9.5 2.5l-6 6" />
                          </svg>
                        </button>
                      )}

                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* 展开入口已上移到卡片头部（标题同一行右端），列表内不再重复放按钮。
              收起入口 = 再点一次卡片头部。 */}
        </div>
      )}
    </div>
  )
})

