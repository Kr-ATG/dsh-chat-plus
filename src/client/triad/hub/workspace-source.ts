/**
 * workspace-source — 侧栏「记忆 → 工作区」二级菜单的**自带数据源**。
 *
 * ── 为什么要有这个文件（2026-10-25 用户报障后新增）──────────────────
 * 用户原话：「点二级菜单为什么左侧的侧边栏会跳一下，并且工作区目录应该直接
 * 展示而不是点击全局记忆才展示」。两个现象其实是同一个根因：
 *
 *   工作区清单原先由**记忆页面**在挂载后调用 `setNavEntryChildren` 推给侧栏。
 *   而记忆页面只在「工作台已打开、且当前 tab 是 memory」时才挂载。于是：
 *     · 没进过记忆页 → 侧栏永远只有「全部工作区 / 全局记忆」两项固定项，
 *       真实工作区要等用户点进去才突然冒出来；
 *     · 那一下正是「跳动」——侧栏 host 高度实测 512px → 572px，子项 10 → 12，
 *       因为多出来的两行是在页面挂载之后才补进来的。
 *
 * 依赖方向本来就反了：**侧栏自己要显示的数据，不该依赖另一个页面先被访问**。
 * 所以把数据源挪到这里 —— 侧栏挂载时自己拉一次 `/api/dsh-memory/projects`，
 * 与记忆页面是否打开、是否曾经打开完全无关。
 *
 * ── 三条与记忆页面共存时的口径 ──────────────────────────────────
 *  1. **只拉一次**（+ 一次显式刷新），不做轮询：工作区清单变动频率极低，
 *     而 1.5s 轮询已经在跑，再叠一层请求没有收益；
 *  2. 拉失败**静默降级**：保留两项固定项，侧栏照常可用（绝不因为侧栏导航
 *     拉不到数据就少两行菜单）；
 *  3. 记忆页面**仍然可以**推它自己那份（它手上有更准的 entryCount，且能在
 *     删除/移动条目后即时更新）。两边都调 `setNavEntryChildren`，后写的赢 ——
 *     这是可接受的：两份数据同源（同一个 host 路由）、结构相同，差异只可能是
 *     「谁的计数更新」，而页面那份总是更新。
 */

import { createMemoryApi, type ProjectView } from '../memory/api.js'
import { type NavChildDef } from './nav-registry.js'

/** 记忆模块的 API（无状态 fetch 包装，单例安全，见 createMemoryApi 的注释）。 */
const api = createMemoryApi()

/** 工作区子项 id 前缀（与 MemoryScopeIntent 的 `project:<hash>` 天然同构）。 */
const PROJECT_PREFIX = 'project:'

/**
 * 把 host 下发的项目清单转成侧栏子项。
 *
 * 三条约定：
 *  · **每项都带 icon**：二级行是「图标 + 文字」两段式 flex，缺图标的行文字会
 *    左移一格、与上面几行对不齐（这条踩过，见 nav-sections 里 WorkspaceIcon 的说明）；
 *  · `count` 只在 > 0 时给：0 会让行尾挂一个"0"，是噪音（与既有约定一致）；
 *  · `order` 从 30 开始：给前两项固定项（10 / 20）让位，顺序稳定不跳位。
 * @param projects - host 的项目清单。
 * @param icon - 工作区行图标（由渲染层提供，保证与固定项同一套图形语言）。
 * @param run - 点击动作（写意图）。由调用方注入，本模块不关心怎么切。
 * @returns 侧栏子项数组（可能为空）。
 */
export function projectsToChildren(
  projects: readonly ProjectView[],
  icon: (props: { size: number }) => JSX.Element,
  run: (scope: string) => void,
): NavChildDef[] {
  return projects.map((project, index) => {
    /** 展示名：别名 > 路径末段 > hash（三级兜底，绝不显示空行）。 */
    const label = project.alias
      ?? project.path.split(/[\\/]/).filter(Boolean).at(-1)
      ?? project.hash
    return {
      id: `${PROJECT_PREFIX}${project.hash}`,
      label,
      icon,
      order: 30 + index,
      // 0 条不显示计数：行尾挂个"0"只是噪音。
      count: project.entryCount > 0 ? project.entryCount : undefined,
      // 完整路径放 title：侧栏只有 ~240px，长路径必然截断，但用户需要能看全。
      hint: project.path,
      run: () => { run(`${PROJECT_PREFIX}${project.hash}`) },
    }
  })
}

/**
 * 拉一次工作区清单。
 *
 * 失败时返回空数组而不是抛错 —— 侧栏导航的降级底线是「至少还有两项固定项」，
 * 不能因为一个副菜单的数据拉不到就少半屏菜单。调用方据此决定是否更新。
 * @returns 项目清单（失败时为空数组）。
 */
export async function fetchWorkspaces(): Promise<ProjectView[]> {
  try {
    const response = await api.projects()
    const projects = response.projects
    return Array.isArray(projects) ? projects : []
  } catch {
    return []
  }
}
