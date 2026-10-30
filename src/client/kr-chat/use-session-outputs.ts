/**
 * dsh-chat-plus — 会话产出物补全（client 半身）。
 *
 * 客户端从当前 Chat 快照收集产出物，但快照只包含**已加载的窗口**：重启 DSH
 * 或打开一个长会话时，前面的轮次还没分页加载，产出物卡就会误判「没有产出」。
 * 这里按会话 id 再向 host 的产出物索引取一份（精确路由，旧宿主回落画廊聚合），
 * 与客户端结果合并去重 —— 卡片因此是**会话累计**的，而不是「当前窗口累计」。
 */

import { useEffect, useState } from 'react'
import { fetchSessionOutputs } from './session-outputs-api.ts'
import type { OutputItem } from './outputs.ts'

export function useSessionOutputs(sessionId: string | null): readonly OutputItem[] {
  const [items, setItems] = useState<readonly OutputItem[]>([])
  useEffect(() => {
    if (sessionId === null || sessionId === '') {
      setItems([])
      return undefined
    }
    let alive = true
    let retry: number | undefined
    const load = async (): Promise<void> => {
      const list = await fetchSessionOutputs(sessionId)
      if (!alive) return
      setItems(list)
    }
    void load()
    // 冷启动时 host 索引可能还在折叠；补一拍即可，不常驻轮询（产出物是历史事实）。
    retry = window.setTimeout(() => { void load() }, 2500)
    return () => {
      alive = false
      if (retry !== undefined) window.clearTimeout(retry)
    }
  }, [sessionId])
  return items
}
