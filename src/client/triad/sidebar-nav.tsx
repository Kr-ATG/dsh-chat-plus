/**
 * sidebar-nav — 侧栏形态判定（**只剩 rail 判定**）。
 *
 * 2026-10-25 收缩：本模块原本是「侧栏导航区共享挂载器」，负责创建 nav host、
 * 槽位容器、自绘导航行（`NavButton`）与贴入口的浮层锚点。用户在同一层需求里
 * 把侧栏二级导航整体收敛成「区域 + 条目注册表」（见 `./nav-registry.ts` 与
 * `./nav-sections.tsx`），唯一的使用者（`usage/entry.tsx` 的用量自绘行）也已
 * 随之删除，这些导出全部失去消费者，一并清掉。
 *
 * 留下的是**跨模块共用的那一份真相**：侧栏是否折叠成 rail（56px 图标态）。
 * 三个模块各自需要它：
 *   · `nav-sections.tsx`：rail 下整块让位、把官方行还回去；
 *   · `row-flyout.tsx`：rail 下才允许弹旧的分类浮层（宽栏有自己的入口）；
 *   · `memory` / `gallery` 等面板的样式分支。
 *
 * 如果以后又需要自绘导航行，请用 `nav-registry.ts` 的 `navMenuItem` 注册——
 * 不要在这里重新长出第二套挂载器，那正是这次要清掉的东西。
 */

import { useEffect, useState } from 'react'

/** 侧边栏折叠观察：框架容器选择在所有 sidebar 状态（wide/rail）下都唯一。 */
const FRAME_SELECTOR = 'div:has(> [data-shell-overlay])'

/**
 * 读当前侧栏折叠态（同步、不订阅）。
 *
 * rail 判定只留这一份真相：多个模块各写一份选择器迟早会漂移，而这种漂移
 * 的表现是「折叠后侧栏一个入口都没有」这类难查的显隐 bug。
 */
export function readRail(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(FRAME_SELECTOR)?.hasAttribute('data-sidebar-collapsed') ?? false
}

/**
 * 侧栏折叠态（rail = 只显示图标），响应式版本。
 *
 * 观察挂在 body 子树上（attributeFilter 限定 data-sidebar-collapsed）：
 * 框架容器可能在折叠时被 React 重挂，盯单节点会失联；body 级观察 + 低频
 * 兜底重读对「框架迟到 / 节点替换 / 属性时序」都免疫。值不变时 React 自动
 * 跳过渲染，轮询无额外开销。
 * @returns 是否处于 rail 折叠态。
 */
export function useRail(): boolean {
  const [rail, setRail] = useState<boolean>(() => readRail())
  useEffect(() => {
    const read = (): void => { setRail(readRail()) }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-sidebar-collapsed'], subtree: true })
    const timer = window.setInterval(read, 1500)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [])
  return rail
}
