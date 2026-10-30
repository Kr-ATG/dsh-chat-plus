/**
 * dsh-chat-plus — 把子智能体的产出物拉进主会话产出物卡。
 *
 * 子智能体是独立会话：主会话快照只有「派生了谁」，没有子会话内部的工具事件。
 * 这个 hook 按子智能体目录里的 id 批量请求 host 的只读路由，得到子会话的产出
 * 清单并合并（按路径去重）。轮询策略：
 *  · 目录第一次出现 / 运行态变化时立刻拉一次；
 *  · 有子智能体仍在跑时每 4 秒补拉一次（产出随时可能落盘）；
 *  · 都结束后 2.5 秒再补一拍，兜住「最后一批事件刚刚落盘」的窗口，之后停。
 *
 * 返回的条目带 sessionId（子会话 id）与 origin='subagent'，卡片打开文件时按
 * 子会话工作区解析，而不是误用主会话的 cwd。
 */

import { useEffect, useRef, useState } from 'react'
import type { SubagentRow } from './subagent-catalog.ts'
import { fetchSessionOutputs } from './session-outputs-api.ts'
import type { OutputItem } from './outputs.ts'

export function useSubagentOutputs(rows: readonly SubagentRow[]): readonly OutputItem[] {
  const [items, setItems] = useState<readonly OutputItem[]>([])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const key = rows.map((row) => row.id + ':' + (row.running ? '1' : '0')).join('|')

  useEffect(() => {
    if (rowsRef.current.length === 0) {
      setItems([])
      return undefined
    }
    let alive = true
    let timer: number | undefined
    let retry: number | undefined
    let controller: AbortController | undefined
    const load = async (): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      const current = rowsRef.current
      const lists = await Promise.all(current.map(async (row) => {
        const list = await fetchSessionOutputs(row.id, controller?.signal)
        return list.map((item) => ({ ...item, origin: 'subagent' as const }))
      }))
      if (!alive) return
      const seen = new Set<string>()
      const merged: OutputItem[] = []
      for (const list of lists) {
        for (const item of list) {
          const dedupe = item.path.replace(/\\/g, '/').toLowerCase()
          if (seen.has(dedupe)) continue
          seen.add(dedupe)
          merged.push(item)
        }
      }
      setItems(merged)
    }
    void load()
    retry = window.setTimeout(() => { void load() }, 2500)
    if (rowsRef.current.some((row) => row.running)) {
      timer = window.setInterval(() => { void load() }, 4000)
    }
    return () => {
      alive = false
      controller?.abort()
      if (retry !== undefined) window.clearTimeout(retry)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [key])

  return items
}
