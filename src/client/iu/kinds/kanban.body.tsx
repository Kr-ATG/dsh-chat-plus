/**
 * iu kind **kanban** 的 React 体（client 专用）。
 *
 * ## Body 契约（见 bodies.ts 头注释）
 *  · 只渲染「Head 之后、FillRow 之前」的正文；
 *  · DOM 结构与 kanban.ts 的 `snapshot()` **逐字对齐**：
 *    kanban > kcol(head[b + kcount + kmove(hidden)] + kcol-body > kcard[text + desc? + tag?])，
 *    「移到这里」按钮恒存在、无选中时 hidden——两侧子节点数量与顺序完全一致；
 *  · 持久化状态（layout / selected）一律走 props 的 state/setState，不 useState。
 *
 * ## 两套交互
 *  1. **HTML5 拖拽**：卡片 draggable；dragstart 记住 cardId（ref）并给源卡加
 *     data-dragging（半透明）；列 body 是 drop zone，dragover preventDefault +
 *     给所在列加 data-dragover（高亮）；drop 时按鼠标 Y 与各卡片中线比较算出
 *     落点 index，moveCard 生成新 layout 后 setState 持久化。
 *     拖动中的瞬时视觉（dragging/dragover）走 ref + 命令式属性开关——它是
 *     拖一次就没的视觉态，不该进持久化 state，dragend/drop 时统一清理。
 *  2. **点击降级**（触摸 / 键盘）：点卡片（或聚焦后按 Enter/Space）切换
 *     state.selected；有选中时各列头出现「移到这里」按钮，点击把卡片移到该列
 *     末尾；Esc 取消选中。
 */

import { memo, useMemo, useRef } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { IuBodyProps } from './bodies.ts'
import type { IuKanbanSpec, KanbanState } from './kanban.ts'
import { kanbanCardMap, moveCard, resolveLayout } from './kanban.ts'

export const KanbanBody = memo(function KanbanBody(
  { spec, state, setState }: IuBodyProps<KanbanState, IuKanbanSpec>,
): JSX.Element {
  /** 卡片 id → 卡片内容（文本永远从 spec 查，layout 只存顺序）。 */
  const byId = useMemo(() => kanbanCardMap(spec), [spec])
  /** 持久化 layout 洗成可信形状（脏数据 / 缺卡自动补齐，见 kanban.ts）。 */
  const layout = useMemo(() => resolveLayout(spec, state.layout), [spec, state.layout])
  /** 选中的卡片（脏 id 视为未选中）。 */
  const selected = typeof state.selected === 'string' && byId.has(state.selected) ? state.selected : null

  /** 拖动中的卡片 id（瞬时视觉态，不进持久化 state）。 */
  const dragIdRef = useRef<string | null>(null)
  /** 根容器（dragend 兜底清理命令式属性用）。 */
  const rootRef = useRef<HTMLDivElement | null>(null)

  const clearDragMarks = (): void => {
    const root = rootRef.current
    if (root === null) return
    for (const el of root.querySelectorAll('[data-dragging]')) el.removeAttribute('data-dragging')
    for (const el of root.querySelectorAll('[data-dragover]')) el.removeAttribute('data-dragover')
  }

  const onCardDragStart = (e: ReactDragEvent<HTMLDivElement>, cardId: string): void => {
    dragIdRef.current = cardId
    e.dataTransfer.effectAllowed = 'move'
    // Firefox 必须 setData 才会真正启动拖拽。
    e.dataTransfer.setData('text/plain', cardId)
    e.currentTarget.setAttribute('data-dragging', '1')
  }

  const onCardDragEnd = (): void => {
    dragIdRef.current = null
    clearDragMarks()
  }

  const onBodyDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (dragIdRef.current === null) return // 不是本卡片发起的拖拽，不接管
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const col = e.currentTarget.closest('.dtt-iu__kcol')
    if (col !== null && !col.hasAttribute('data-dragover')) col.setAttribute('data-dragover', '1')
  }

  const onBodyDragLeave = (e: ReactDragEvent<HTMLDivElement>): void => {
    // 只在真正离开列体时清除（子卡片之间移动会连发 dragleave）。
    const related = e.relatedTarget
    if (related instanceof Node && e.currentTarget.contains(related)) return
    const col = e.currentTarget.closest('.dtt-iu__kcol')
    if (col !== null) col.removeAttribute('data-dragover')
  }

  const onBodyDrop = (e: ReactDragEvent<HTMLDivElement>, colId: string): void => {
    e.preventDefault()
    const dragId = dragIdRef.current
    dragIdRef.current = null
    clearDragMarks()
    if (dragId === null) return
    // 落点 index：统计「中线在鼠标之上」的非拖动卡片数——与 moveCard 的
    // 语义一致（index 是从原列摘掉该卡之后的插入位）。
    const ids = layout[colId] ?? []
    let index = 0
    const children = Array.from(e.currentTarget.children)
    children.forEach((el, i) => {
      if (ids[i] === dragId) return
      const rect = el.getBoundingClientRect()
      if (e.clientY >= rect.top + rect.height / 2) index += 1
    })
    setState({ layout: moveCard(layout, dragId, colId, index), selected: null })
  }

  const toggleSelect = (cardId: string): void => {
    setState({ selected: selected === cardId ? null : cardId })
  }

  const onCardKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, cardId: string): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleSelect(cardId)
    } else if (e.key === 'Escape' && selected !== null) {
      setState({ selected: null })
    }
  }

  const moveTo = (colId: string): void => {
    if (selected === null) return
    setState({ layout: moveCard(layout, selected, colId), selected: null })
  }

  return (
    <div className="dtt-iu__kanban" ref={rootRef} role="group" aria-label={spec.title}>
      {spec.columns.map((col) => {
        const ids = layout[col.id] ?? []
        // 选中卡片已在本列时不显示「移到这里」（移给自己没有意义）。
        const showMove = selected !== null && !ids.includes(selected)
        return (
          <div className="dtt-iu__kcol" key={col.id} role="group" aria-label={col.label}>
            <div className="dtt-iu__kcol-head">
              <b>{col.label}</b>
              <span className="dtt-iu__kcount">{ids.length}</span>
              <button
                type="button"
                className="dtt-iu__kmove"
                hidden={!showMove}
                onClick={() => { moveTo(col.id) }}
              >
                移到这里
              </button>
            </div>
            <div
              className="dtt-iu__kcol-body"
              onDragOver={onBodyDragOver}
              onDragLeave={onBodyDragLeave}
              onDrop={(e) => { onBodyDrop(e, col.id) }}
            >
              {ids.map((cardId) => {
                const card = byId.get(cardId)
                if (card === undefined) return null
                const isSel = selected === cardId
                return (
                  <div
                    className="dtt-iu__kcard"
                    key={cardId}
                    draggable
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSel}
                    aria-label={card.tag !== '' ? `${card.text}（${card.tag}）` : card.text}
                    data-selected={isSel ? '1' : undefined}
                    onDragStart={(e) => { onCardDragStart(e, cardId) }}
                    onDragEnd={onCardDragEnd}
                    onClick={() => { toggleSelect(cardId) }}
                    onKeyDown={(e) => { onCardKeyDown(e, cardId) }}
                  >
                    <span className="dtt-iu__kcard-text">{card.text}</span>
                    {card.desc !== '' && <span className="dtt-iu__kcard-desc">{card.desc}</span>}
                    {card.tag !== '' && <span className="dtt-iu__kcard-tag">{card.tag}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})
