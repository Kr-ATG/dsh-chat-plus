/**
 * dsh-chat-plus — KR 右栏「记忆」卡片。
 *
 * 用户要的三件事：
 *  1. **没有新增就整卡不出现**：加载中、两个分区都没有新增、记忆模块不可用
 *     —— 三种情况一律 return null，dock 容器由 `.kr-panel__memory-dock:empty`
 *     自动收掉，右栏回到「只有三张卡」的干净状态。加载中不渲染是为了不闪一张
 *     空卡；模块不可用不渲染是因为这张卡的全部价值就是「这次对话新记了什么」，
 *     它没有新增时只剩一行诊断文字，host 侧异常本来就有 console.warn 兜底。
 *  2. **常驻底部、常态折叠**：卡片挂在滚动区之下的独立 flex footer
 *     （.kr-panel__memory-dock，见 KrAgentPanel 与 styles.ts），永远钉在右栏
 *     最下方，**但默认收起**，标题行留一枚「N 条」徽标说明这次对话记了几条，
 *     要看由用户点开。展开后默认只露 6 条、列表封顶在 40vh。
 *
 *     折叠是默认值而不是「无新增就不显示」的补充：默认展开时，模型每记下一条
 *     右栏就自己长高一截，把用户正在读的思考卡顶走一截，而位置还是他没动过的
 *     ——观感上就是「界面在抖」。顺带也让 footer 常态只占一行，思考卡多拿回
 *     几行视口。切会话不重置这个状态：用户手动点过一次就说明他想看。
 *
 *     「这个会话写下」按**条目溯源**判定：host 在写入/更新条目时把
 *     `provenance.sessionId` 一并落盘（自动提取、memory_remember / memory_revise
 *     都填），前端拿当前 sessionId 做纯等值比较——不掺任何时间口径。旧实现按
 *     「进入会话的时间基线」猜（localStorage + 5 分钟时钟冗余），时钟偏差、刷新
 *     时机、切会话都会把别的会话的记忆误判成本会话的，已被替换。
 *
 *  3. **行内单条删除 + 标题行「一键清掉本会话新增」**：分区行只放「小圆点 +
 *     名称 + 计数 + 目录」，「展开其余 N 条」下沉到列表底部居中一行；卡片标题行
 *     留「图标 + 名称 + 总数」，最右端再挂一枚 hover 才浮现的垃圾桶 —— 它删的是
 *     **本会话新增的全集**（这张卡的全部内容），点一下标题行原地变确认态，确认后
 *     条目错峰退场、卡片收拢消失。行尾那枚垃圾桶仍然只删它自己那一行。
 *     原来那套「选择 → 每行 checkbox → 已选 N 条 → 删除 → 确认 → 取消」的六层
 *     状态压在一条 400px 的标题行上，是「乱」的主因；批量删记忆的记忆工作台
 *     （triad 面板）里有完整实现，右栏是轻量视图，不该承担管理职责。
 *     置顶收成属性行里的一枚可点星标，顺手消掉原来那条 11px 的置顶空槽。
 *
 *     host 侧零改动：一键删除复用面板那套 `POST /delete-batch`（一次事务删完、
 *     一次编译产物、逐条 appendChange 审计），所以这次升级只需刷新页面。
 *
 * 之所以把「内容变了要重新测量」上报给 KrAgentPanel：记忆卡条目数直接决定右栏
 * 溢出程度，而挤压自适应（use-adaptive-rows.ts）需要知道这件事才重算思考卡行数。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteMemoryBatch,
  listMemory,
  listProjects,
  memoryKindLabel,
  pinMemoryEntry,
  type MemoryEntryView,
  type ProjectView,
} from './memory-api.ts'
import { getLatestChatSessionId, subscribeLatestChatSnapshot } from '../tool-summary/TurnProcessShadowView.tsx'

/** 两个分区的 key。 */
type SectionKey = 'workspace' | 'global'

/** 每个分区默认 preview 的条数（超出点「展开其余」，避免一屏全是记忆）。
 *  与 .kr-memory__list 的 max-height 成对维护：只抬条数会被封顶裁掉，只抬封顶
 *  则条数不够撑不满，两边一起抬记忆卡的默认高度才真翻一倍。 */
const SECTION_PREVIEW_COUNT = 6

/**
 * 标题行「一键删除」的确认态自动回退窗口（毫秒）。
 *
 * 这枚按钮删的是**整卡全部本会话新增**（当前会话的新记忆全集），比行内单条删除
 * 重得多，所以复用的是同一套「就地二次确认」而不是弹窗。但标题行那枚按钮是
 * hover 才浮现的，确认态留在原地时用户可能没注意到它一直亮着，几分钟后顺手点
 * 一下就把整批删了——6 秒后自动回到待命态，把误触窗口压到「确实看着它点的」。
 */
const CLEAR_CONFIRM_MS = 6000

/** 一键删除时每行错峰退场的间隔（毫秒）。 */
const CLEAR_STAGGER_MS = 45

/** 单行退场动画时长（毫秒），与 .kr-memory__row[data-leaving] 的 animation 成对。 */
const CLEAR_ROW_MS = 220

/** 卡片自身收拢退场的时长（毫秒），与 .kr-card--memory[data-collapsing] 成对。 */
const CARD_COLLAPSE_MS = 260

/** 第 N 行错峰退场的延后量：删多条时读起来是「一条条被抹掉」而不是整块闪没。 */
function staggerDelay(index: number): number {
  return index * CLEAR_STAGGER_MS
}

/** 一键删除的最短等待：让退场动画播完，但封顶 900ms（条数多时不再线性拉长）。 */
function clearAnimationMs(count: number): number {
  return Math.min(900, CLEAR_ROW_MS + Math.max(0, count - 1) * CLEAR_STAGGER_MS)
}

/** 单个分区的交互态（请求中 / 行内报错 / 展开）。 */
interface SectionState {
  busy: boolean
  error: string
  /** 是否展开全部条目（默认只 preview 前几条）。 */
  showAll: boolean
}

const EMPTY_SECTION: SectionState = {
  busy: false,
  error: '',
  showAll: false,
}

/**
 * 标题行「一键删除」的状态机。
 *
 *   idle     常态：一枚 hover 才浮现的垃圾桶
 *   confirm  确认态：标题行右侧换成「删除本会话新增？确认 取消」
 *   deleting 请求中：按钮置灰显示「删除中…」，条目已开始错峰退场
 *
 * 错误单独放在 error（不塞进 phase）：删除失败要能退回 idle 并把整批条目原样
 * 放回，同时把 host 给的文案显示出来——确认态和错误态是两件事，不该互相覆盖。
 */
type ClearPhase = 'idle' | 'confirm' | 'deleting'

/**
 * 替换 records[key]。
 *
 * 之所以不用 `{ ...record, [key]: value }`：key 是联合字面量类型时，TS 的计算
 * 属性只会产出字符串索引签名，赋不回具名的 Record<SectionKey, …>。显式写死两个
 * key 最稳，也只有两行。
 */
function replaceSection(
  record: Record<SectionKey, SectionState>,
  key: SectionKey,
  value: SectionState,
): Record<SectionKey, SectionState> {
  return key === 'workspace'
    ? { workspace: value, global: record.global }
    : { workspace: record.workspace, global: value }
}

/** 按更新时间倒序（新的在前）。时间解析失败排最后。 */
function byUpdatedDesc(a: MemoryEntryView, b: MemoryEntryView): number {
  const ta = Date.parse(a.updatedAt)
  const tb = Date.parse(b.updatedAt)
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0
  if (!Number.isFinite(ta)) return 1
  if (!Number.isFinite(tb)) return -1
  return tb - ta
}

/**
 * 两份条目集合是否等价（轮询去重用）。
 *
 * 比对 id + updatedAt + pinned 三项：内容与 scope 变了必然伴随 updatedAt 变化，
 * 而这正是轮询唯一需要捕捉的变化——别的差异（比如服务端重排）不值得让整张卡
 * 重渲染。数组顺序不参与判定，所以 /list 的返回顺序抖动不会造成假更新。
 */
function sameEntrySet(
  previous: readonly MemoryEntryView[],
  next: readonly MemoryEntryView[],
): boolean {
  if (previous.length !== next.length) return false
  const index = new Map<string, MemoryEntryView>()
  for (const entry of previous) index.set(entry.id, entry)
  for (const entry of next) {
    const old = index.get(entry.id)
    if (old === undefined) return false
    if (old.updatedAt !== entry.updatedAt || old.pinned !== entry.pinned) return false
  }
  return true
}

/** 归一化路径：统一分隔符、去尾部斜杠（Windows 会话 cwd 常带 `\`，host 存的是原样）。 */
function normalizeMemoryPath(value: string): string {
  return value.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
}

/** 是否 Windows 盘符 / UNC 路径（这些大小写不敏感，其余平台大小写敏感）。 */
function isWindowsMemoryPath(value: string): boolean {
  return /^[a-z]:\//i.test(value) || value.startsWith('//')
}

/** 两条路径是否指向同一个目录。 */
function sameMemoryPath(a: string, b: string): boolean {
  const na = normalizeMemoryPath(a)
  const nb = normalizeMemoryPath(b)
  if (na === '' || nb === '') return false
  if (na === nb) return true
  if (isWindowsMemoryPath(na) && isWindowsMemoryPath(nb)) return na.toLowerCase() === nb.toLowerCase()
  return false
}

/**
 * 从项目注册表里挑出「当前 cwd 对应的项目」。
 *
 * 先找全等；找不到再退一步找「项目路径是 cwd 的前缀」里最长的那条——会话常
 * 从仓库子目录发起，而 host 记忆挂在仓库根 hash 上，纯全等会漏。
 * 取最长前缀是为了在「多个项目互为父子」时选最贴近的那个；同时要求前缀必须
 * 落在目录边界上，否则 `D:/AI/Dsh2` 会误匹配 `D:/AI/Dsh`。
 */
function pickWorkspaceProject(projects: readonly ProjectView[], cwd: string): ProjectView | null {
  const target = normalizeMemoryPath(cwd)
  if (target === '') return null
  const exact = projects.find((project) => sameMemoryPath(project.path, target))
  if (exact !== undefined) return exact
  let best: ProjectView | null = null
  let bestLength = -1
  for (const project of projects) {
    const base = normalizeMemoryPath(project.path)
    if (base === '') continue
    const insensitive = isWindowsMemoryPath(target) && isWindowsMemoryPath(base)
    const needle = insensitive ? target.toLowerCase() : target
    const prefix = insensitive ? base.toLowerCase() : base
    if (!needle.startsWith(prefix)) continue
    const next = needle[prefix.length]
    if (next !== undefined && next !== '/') continue
    if (base.length > bestLength) {
      best = project
      bestLength = base.length
    }
  }
  return best
}

/** 当前会话的工作目录（读 client ctx 上的 sessions 快照；取不到返回空串）。 */
function resolveCurrentCwd(sessionId: string | null): string {
  try {
    const ctx = (window as unknown as { __dshClientCtx__?: { get?: (name: string) => unknown } }).__dshClientCtx__
    const sessions = ctx?.get?.('sessions') as
      | { list?: { getSnapshot?: () => { byId?: Record<string, { cwd?: string } | undefined> } } }
      | undefined
    const byId = sessions?.list?.getSnapshot?.()?.byId
    const cwd = sessionId !== null ? byId?.[sessionId]?.cwd : undefined
    return typeof cwd === 'string' ? cwd : ''
  } catch {
    return ''
  }
}

/** 相对时间：3 分钟内「刚刚」，之后分/时/天，超过一周退回具体日期。 */
function formatWhen(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 目录名（分区副标题用；取不到就回落整串路径）。 */
function dirName(path: string): string {
  const normalized = normalizeMemoryPath(path)
  if (normalized === '') return ''
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

export interface KrMemoryCardProps {
  /** 右栏高度输入变化时通知大盘重算思考卡行数（见 use-adaptive-rows.ts）。 */
  readonly onContentChange?: () => void
  /** 右栏是否已被挤压（思考卡行数低于默认）：挤压态下记忆列表进一步让步。 */
  readonly squeezed?: boolean
}

/** 记忆卡片（常驻右栏底部）。 */
export const KrMemoryCard = memo(function KrMemoryCard({
  onContentChange,
  squeezed = false,
}: KrMemoryCardProps) {
  const [sessionKey, setSessionKey] = useState<string>(() => getLatestChatSessionId() ?? '')
  const [reloadToken, setReloadToken] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [entries, setEntries] = useState<readonly MemoryEntryView[]>([])
  const [projects, setProjects] = useState<readonly ProjectView[]>([])
  const [workspaceHash, setWorkspaceHash] = useState<string | null>(null)
  /**
   * 默认**折叠**（有新增也不自动展开）。
   *
   * 这张卡钉死在右栏最下方，展开时是要占掉思考卡行数的。原来默认展开，等于
   * 「模型一记下东西，右栏就自己长高一截」——用户正在读的那块区域被顶走一截，
   * 位置还是他没动过的，观感上就是「界面在抖」。
   *
   * 所以折叠态才是常态，标题行那枚「N 条」徽标负责说清「这次对话记了什么、
   * 记了几条」，要不要看由用户点。这也让 footer 常态只占一行，思考卡能多拿
   * 回几行视口。
   *
   * 切会话时**不重置**这个状态：用户刚手动展开就被下一个会话抽走，比自动展开
   * 更烦。他手动点过一次就说明他想看，尊重那个选择。
   */
  const [collapsed, setCollapsed] = useState(true)
  const [openedIds, setOpenedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [sections, setSections] = useState<Record<SectionKey, SectionState>>({
    workspace: EMPTY_SECTION,
    global: EMPTY_SECTION,
  })
  /**
   * 行内单条删除的确认态：只记 id，不存整份选择集。
   *
   * 同一时刻至多一条处于确认态——点第二条时上一条自动解除，所以这里既没有
   * 多选 checkbox，也没有「已选 N 条」那种要跨行维护的中间态。
   */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  /**
   * 标题行一键删除（本会话新增全集）的状态。
   *
   * 删的就是这张卡当前显示的那批条目：sessionNewEntries 的两个分区合集，条数
   * 与标题行「N 条」严格一致。分区是渲染期现算的，所以真正的 id 集合在点击那
   * 一刻现取（clearSessionNew 里读 ref），不另存一份可能与渲染脱节的镜像。
   */
  const [clearPhase, setClearPhase] = useState<ClearPhase>('idle')
  const [clearError, setClearError] = useState('')
  /** 正在退场的行 id（错峰动画期间仍留在 DOM 里，动画播完才从数据里摘掉）。 */
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(() => new Set())
  /** 一键删除请求在飞（用于冻结 20s 轮询，见下方轮询处的说明）。 */
  const clearBusyRef = useRef(false)
  /**
   * 会话代次。
   *
   * 一键删除要等退场动画播完才真正改数据（几百毫秒），而这期间用户可能切走会话：
   * 闭包里那个 sessionKey 已经过期，照它算「本会话新增」会删错会话的记忆。
   * 每次会话切换把代次 +1，异步回调（动画后的取 id、请求回来后的收尾）一律先
   * 比对代次，不一致就整体放弃 —— 宁可这次删除没生效，也不能删错东西。
   */
  const sessionGenRef = useRef(0)
  const clearConfirmTimerRef = useRef<number | null>(null)
  const collapseTimerRef = useRef<number | null>(null)
  /**
   * 一键删除成功后卡片自身的收拢退场。
   *
   * 删掉最后一条时本会话新增归零，卡片本来就该整张消失（dock 的 :empty 会连带
   * 把 footer 的 padding 收掉）。直接卸载是「啪一下没了」，这里让它先淡出下沉
   * 260ms 再卸载——但**保持挂载**得有个开关：归零那一刻若直接命中
   * `newEntryCount === 0` 的 return null，动画根本没机会播。
   */
  const [collapsing, setCollapsing] = useState(false)

  // 会话身份变化才重新拉记忆（subscriber 在流式期间每秒触发多次，绝不能跟着重拉）。
  useEffect(() => {
    return subscribeLatestChatSnapshot(() => {
      const id = getLatestChatSessionId() ?? ''
      setSessionKey((previous) => (previous === id ? previous : id))
    })
  }, [])

  // 会话切换：清掉上一个会话/工作区的记忆，等新数据到位再渲染。绝不能复用
  // 旧 state——那半秒里右栏挂的会是别的项目的记忆，还可能被误删。
  // 一键删除的中间态（确认态 / 退场动画 / 错误行）同样一并清掉：它们全是按
  // 上一个会话的条目算出来的，跟到新会话里就是悬空的。
  useEffect(() => {
    sessionGenRef.current += 1
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
    setCollapsing(false)
    setEntries([])
    setProjects([])
    setWorkspaceHash(null)
    setOpenedIds(new Set<string>())
    setPendingDeleteId(null)
    setSections({ workspace: EMPTY_SECTION, global: EMPTY_SECTION })
    setClearPhase('idle')
    setClearError('')
    setLeavingIds(new Set<string>())
  }, [sessionKey])

  // 拉全量 + 解析当前工作区。reloadToken 用于删除成功后与 host 对齐。
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void (async () => {
      try {
        const workspaceCwd = resolveCurrentCwd(sessionKey === '' ? null : sessionKey)
        const response = await listMemory()
        if (cancelled) return
        let registry = response.projects
        if (registry.length === 0) {
          // 旧 host 的 /list 可能不返回 projects：补拉一次注册表，否则工作区
          // 分区永远匹配不上（拿不到 path → hash 的映射）。
          try {
            registry = await listProjects()
          } catch {
            registry = []
          }
        }
        if (cancelled) return
        const workspace = pickWorkspaceProject(registry, workspaceCwd)
        setProjects(registry)
        setEntries(response.entries)
        setWorkspaceHash(workspace?.hash ?? null)
        setSections({ workspace: EMPTY_SECTION, global: EMPTY_SECTION })
        setStatus('ready')
      } catch (error) {
        if (cancelled) return
        console.warn('[kr-memory-card] 记忆模块加载失败', error)
        setEntries([])
        setProjects([])
        setWorkspaceHash(null)
        setStatus('unavailable')
      }
    })()
    return () => { cancelled = true }
  }, [sessionKey, reloadToken])

  /**
   * 轻量轮询：让「会话进行中新写入的记忆」也能让卡片自己冒出来。
   *
   * 这条是「没有新增就不渲染」的前提条件：卡片既然默认不在屏上，就不能只靠
   * 会话切换时拉的那一次数据——否则用户刚记完一条，右栏依旧空着，看起来就像
   * 功能坏了。host 侧的写入有两条路径（memory_remember 工具与自动提取），后者
   * 根本没有客户端事件可订阅，所以只能用轮询兜。
   *
   * 三道约束把它压到几乎无感：页面不可见时不发请求（后台标签页别空转）；20s
   * 一轮而不是更密；拿到结果先逐条比对 id/updatedAt/pinned，没变就原样返回
   * 旧数组引用，React 不会重渲染，更不会触发大盘重测高度。
   *
   * 第四道（一键删除引入）：请求在飞的那一拍整轮跳过。删除是「先播退场动画、
   * 再改数据」，若这期间轮询先回来，会把正在退场的条目原样带回来——行闪一下
   * 又消失。宁可漏一拍轮询，也不要这个闪回。
   */
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (clearBusyRef.current) return
      void listMemory()
        .then((response) => {
          if (cancelled) return
          // 用 applyEntries 而不是裸 setEntries：一键删除在飞时整轮丢弃，
          // 否则正在退场的行会被这轮结果带回来闪一下（见 applyEntries）。
          setEntries((previous) => {
            if (clearBusyRef.current) return previous
            return sameEntrySet(previous, response.entries) ? previous : response.entries
          })
        })
        .catch(() => { /* 轮询失败静默：下轮再来，不打断阅读 */ })
    }, 20_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [status])

  const workspaceProject = useMemo(
    () => projects.find((project) => project.hash === workspaceHash) ?? null,
    [projects, workspaceHash],
  )

  const workspaceEntries = useMemo(
    () => entries.filter(
      (entry) => entry.scope === 'project' && workspaceHash !== null && entry.projectHash === workspaceHash,
    ).sort(byUpdatedDesc),
    [entries, workspaceHash],
  )

  const globalEntries = useMemo(
    () => entries.filter((entry) => entry.scope === 'global').sort(byUpdatedDesc),
    [entries],
  )

  // 一键删除请求在飞时冻结 entries：这期间（先播动画、再发请求）任何一次 setEntries
  // 都会让正在退场的行闪回来。轮询那条路径在 setEntries 里直接短路（见下），这里
  // 供单条删除的失败回滚用。之所以放在 globalEntries 之后：useCallback 属于 Hook，
  // 与别的 Hook 挨在一起读更顺，但顺序上仍必须在下面那条 early return 之前。
  const applyEntries = useCallback((next: readonly MemoryEntryView[]) => {
    if (clearBusyRef.current) return
    setEntries(next)
  }, [])

  /**
   * 「本会话新增」子集：按条目溯源判定。
   *
   * host 在写入/更新条目时把 `provenance.sessionId` 一并落盘（自动提取、
   * memory_remember / memory_revise 都填），这里与当前 sessionId 做纯等值
   * 比较——不掺任何时间口径，时钟偏差 / 刷新时机 / 切会话都不再影响结果。
   *
   * 旧 host 还没重启（不返回 provenance）时该分区会一直显示「暂无」而不是
   * 错误数据：宁可少显示，也不把别的会话的记忆混进来。挺过这个窗口只需重启
   * DSH 让新 host 半身生效。
   */
  const sessionNewEntries = useMemo(() => {
    if (sessionKey === '') {
      return { workspace: [], global: [] } as {
        workspace: readonly MemoryEntryView[]
        global: readonly MemoryEntryView[]
      }
    }
    const isNew = (entry: MemoryEntryView): boolean =>
      entry.provenance?.sessionId === sessionKey
    return {
      workspace: workspaceEntries.filter(isNew),
      global: globalEntries.filter(isNew),
    }
  }, [workspaceEntries, globalEntries, sessionKey])

  // 内容量变化 → 通知大盘重测「是否需要挤压思考卡」。
  const contentSignature = [
    status,
    sessionNewEntries.workspace.length,
    sessionNewEntries.global.length,
    sections.workspace.showAll ? 1 : 0,
    sections.global.showAll ? 1 : 0,
    openedIds.size,
    collapsed ? 0 : 1,
  ].join('|')
  useEffect(() => {
    onContentChange?.()
    // 只认内容指纹：父组件传的回调必须是用 useCallback 稳住的，否则这里会自激。
  }, [contentSignature, onContentChange])

  const patchSection = useCallback((key: SectionKey, patch: Partial<SectionState>) => {
    setSections((previous) => replaceSection(previous, key, { ...previous[key], ...patch }))
  }, [])

  const toggleShowAll = useCallback((key: SectionKey) => {
    setSections((previous) => replaceSection(previous, key, { ...previous[key], showAll: !previous[key].showAll }))
  }, [])

  const toggleOpened = useCallback((id: string) => {
    setOpenedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** 单条删除：乐观摘掉本地条目 → 请求 → 失败整份回滚并留在该行确认态。 */
  const confirmDelete = useCallback(async (entry: MemoryEntryView) => {
    const key: SectionKey = entry.scope === 'global' ? 'global' : 'workspace'
    // 一键删除在飞时整卡正在退场，这期间不接受行级删除：两批请求叠在一起，
    // 失败回滚会把刚删掉的行又插回来。
    if (sections[key].busy || clearBusyRef.current) return
    const snapshot = entries
    setPendingDeleteId(null)
    setEntries((previous) => previous.filter((item) => item.id !== entry.id))
    patchSection(key, { busy: true, error: '' })
    try {
      await deleteMemoryBatch([entry.id])
      patchSection(key, { busy: false })
      // 与 host 对齐（missing / 并发删除造成的差异），顺带刷新置顶态
      setReloadToken((value) => value + 1)
    } catch (error) {
      applyEntries(snapshot)
      patchSection(key, {
        busy: false,
        error: error instanceof Error ? error.message : '删除失败',
      })
      // 一键删除在飞时不还原这一行的确认态：那一行此刻已经不在列表里
      // （整批都在退场），把 pendingDeleteId 指过去只会留下一个指向空气的 id。
      if (!clearBusyRef.current) setPendingDeleteId(entry.id)
    }
  }, [applyEntries, entries, patchSection, sections])

  /** 单条置顶（可选能力；host 不支持时只报一行错，不影响其余交互）。 */
  const togglePin = useCallback(async (entry: MemoryEntryView) => {
    if (clearBusyRef.current) return
    const nextPinned = !entry.pinned
    const key: SectionKey = entry.scope === 'global' ? 'global' : 'workspace'
    // 乐观更新：先翻图标，失败再翻回来
    setEntries((previous) => previous.map((item) => (item.id === entry.id ? { ...item, pinned: nextPinned } : item)))
    try {
      await pinMemoryEntry(entry.id, nextPinned)
    } catch (error) {
      // 只翻回这一条的 pinned（不用整份快照回滚：这期间轮询可能已经带回了新条目）
      setEntries((previous) => previous.map((item) => (item.id === entry.id ? { ...item, pinned: entry.pinned } : item)))
      patchSection(key, { error: error instanceof Error ? error.message : '置顶失败' })
    }
  }, [patchSection])

  /** 清掉确认态的自动回退定时器（进删除 / 取消 / 切会话时都要先收掉）。 */
  const cancelClearConfirmTimer = useCallback(() => {
    if (clearConfirmTimerRef.current !== null) {
      window.clearTimeout(clearConfirmTimerRef.current)
      clearConfirmTimerRef.current = null
    }
  }, [])

  /** 取消一键删除：收回确认态与提示，什么都不改。 */
  const cancelClear = useCallback(() => {
    cancelClearConfirmTimer()
    setClearPhase('idle')
    setClearError('')
  }, [cancelClearConfirmTimer])

  /**
   * 请求一键删除：标题行那枚垃圾桶点第一下只进确认态，这里才是真删。
   *
   * 时序刻意分成两段——**先播退场动画、动画走完再改数据**：
   *  - 进 deleting 态、把这批行标成 leaving，行按索引错峰淡出右移，读起来是
   *    「一条条被抹掉」；
   *  - 动画跑完（条数越多等得越久，但封顶 900ms）才把请求发出去，成功即把这批
   *    条目从 state 摘掉 —— 摘掉那一刻行早就淡到透明了，视觉上接得上。
   *
   * 为什么不等请求回来再播动画：请求失败时动画已经播完，就得把这些行重新插回来，
   * 那一下「删掉的东西又长回来」比不播动画更吓人。现在失败是**整批原样放回**
   * 并在标题行留一行错误文案，条目本身从头到尾没离开过屏幕。
   *
   * 取 id 走 sessionGenRef 代次校验：动画这段窗口里用户切了会话就整体放弃，
   * 绝不拿过期 sessionKey 算出来的集合去删。
   */
  const clearSessionNew = useCallback(async () => {
    if (clearBusyRef.current) return
    const generation = sessionGenRef.current
    const ids = [...sessionNewEntries.workspace, ...sessionNewEntries.global].map((entry) => entry.id)
    cancelClearConfirmTimer()
    if (ids.length === 0) {
      setClearPhase('idle')
      return
    }
    // 删完之后卡片必然归零：ids 就是两个分区拼起来的全集，删掉它等于本会话新增
    // 一条不剩。所以「是否全删光」不需要另算一个布尔（算了也恒为真），直接进收拢。
    clearBusyRef.current = true
    setClearPhase('deleting')
    setClearError('')
    setPendingDeleteId(null)
    setLeavingIds(new Set(ids))
    // 这里**不能**顺手 setCollapsed(true)：折叠会让 body 立刻卸载，那批正在错峰
    // 退场的行连一帧都播不出来（展开态下点一键删除，看到的就是列表凭空消失）。
    // 收起动作交给数据本身——条目摘掉后分区自然不渲染，卡片随后走收拢退场。

    await new Promise<void>((resolvePromise) => {
      window.setTimeout(resolvePromise, clearAnimationMs(ids.length))
    })

    // 退场动画期间切了会话：这批 id 属于上一个会话，整批作废（动画白播，
    // 但下一个会话的卡片是全新状态，不留任何中间态）。
    if (sessionGenRef.current !== generation) {
      clearBusyRef.current = false
      setLeavingIds(new Set<string>())
      setClearPhase('idle')
      return
    }

    try {
      await deleteMemoryBatch(ids)
      if (sessionGenRef.current === generation) {
        const gone = new Set(ids)
        setEntries((previous) => previous.filter((entry) => !gone.has(entry.id)))
        setSections({ workspace: EMPTY_SECTION, global: EMPTY_SECTION })
        setOpenedIds((previous) => {
          const next = new Set(previous)
          for (const id of ids) next.delete(id)
          return next
        })
        setLeavingIds(new Set<string>())
        setClearPhase('idle')
        // 卡片自身收拢退场：保持挂载 260ms 让动画播完再真正卸载（见 collapsing 的说明）。
        setCollapsing(true)
        collapseTimerRef.current = window.setTimeout(() => {
          collapseTimerRef.current = null
          setCollapsing(false)
        }, CARD_COLLAPSE_MS)
        // 与 host 对齐：missing / 并发删除 / 别的客户端同时写，都以 host 为准
        setReloadToken((value) => value + 1)
      }
    } catch (error) {
      if (sessionGenRef.current === generation) {
        setClearError(error instanceof Error ? error.message : '删除失败')
        setClearPhase('idle')
        setLeavingIds(new Set<string>())
      }
    } finally {
      clearBusyRef.current = false
    }
  }, [cancelClearConfirmTimer, sessionNewEntries])

  /** 点标题行那枚垃圾桶：先进确认态，并起一个自动回退定时器。 */
  const armClear = useCallback(() => {
    // 有行正处在确认态就先收掉：两处确认态同时亮着，用户分不清「确认」会删哪一批。
    setPendingDeleteId(null)
    setClearError('')
    setClearPhase('confirm')
    cancelClearConfirmTimer()
    clearConfirmTimerRef.current = window.setTimeout(() => {
      clearConfirmTimerRef.current = null
      setClearPhase('idle')
    }, CLEAR_CONFIRM_MS)
  }, [cancelClearConfirmTimer])

  // 组件卸载：把两个定时器收掉（确认态的自动回退、卡片的收拢退场）。退场等待
  // 那个是 Promise 里的裸 setTimeout，卸载后仍会 resolve —— 回调里的 setState 在
  // React 18 下是无害 no-op，但它会继续 await 完 deleteMemoryBatch，所以真正需要
  // 拦的是 clearBusyRef 与代次校验，这里只负责把两个定时器清干净。
  useEffect(() => () => {
    if (clearConfirmTimerRef.current !== null) window.clearTimeout(clearConfirmTimerRef.current)
    if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current)
  }, [])

  /**
   * 首屏加载中（一条都还没拿到）时不渲染：宁可这一拍右栏少一张卡，也不要闪
   * 一张写着「加载中…」的空卡——那半秒看起来像出了错。
   */
  const firstLoading = status === 'loading' && entries.length === 0 && projects.length === 0

  const newEntryCount = sessionNewEntries.workspace.length + sessionNewEntries.global.length

  /**
   * 标题行上显示 / 朗读的条数。
   *
   * 一键删光的那一刻 newEntryCount 归零，而卡片还要挂着播 260ms 的收拢退场——
   * 直接用 0 会让那半秒里标题行写着「0 条」、按钮的 title 变成「删除本会话新增的
   * 0 条记忆」。记住最后一个正值，收拢期间沿用，等卡片真正卸载。
   */
  const lastCountRef = useRef(0)
  if (newEntryCount > 0) lastCountRef.current = newEntryCount
  const displayCount = newEntryCount > 0 ? newEntryCount : lastCountRef.current

  // 三种「不出现在屏上」：加载中（不闪空卡）、模块不可用（只剩一行诊断文字，
  // host 侧异常另有 console.warn）、本会话没有新增记忆（这张卡的全部意义）。
  // return null 后 dock 变空，.kr-panel__memory-dock:empty 负责把 footer 收掉。
  //
  // 唯一的例外是 collapsing：一键删光之后卡片要先播完 260ms 的收拢退场再卸载，
  // 否则归零那一拍就命中这里，动画根本没有机会出现（那一下就是「啪一下没了」）。
  if ((firstLoading || status === 'unavailable' || newEntryCount === 0) && !collapsing) {
    return null
  }

  const renderSection = (key: SectionKey): JSX.Element | null => {
    const sessionList = sessionNewEntries[key]
    const state = sections[key]
    const title = key === 'workspace' ? '工作区记忆' : '全局记忆'
    /** 本会话新增条数（分区随它出现/消失）。 */
    const count = sessionList.length
    const scopeLabel = key === 'workspace'
      ? (workspaceProject === null ? '' : (workspaceProject.alias ?? dirName(workspaceProject.path)))
      : ''
    const visible = state.showAll ? sessionList : sessionList.slice(0, SECTION_PREVIEW_COUNT)
    const hiddenCount = sessionList.length - visible.length

    // 分区行只做一件事：说清「哪一批、几条」。原来挤在这一行的「展开其余 N 条」
    // 与「选择」两枚按钮已分别下沉到列表底部与行尾操作区，标题行不再需要交互。

    return (
      <section className="kr-memory__section">
        <div className="kr-memory__section-head">
          <span className="kr-memory__section-title" title={scopeLabel !== '' ? `${title} · ${scopeLabel}` : title}>
            {title}
            <span className="kr-memory__count">({count})</span>
            {scopeLabel !== '' && <span className="kr-memory__scope">{scopeLabel}</span>}
          </span>
        </div>

        {state.error !== '' && <div className="kr-memory__err">{state.error}</div>}

        <div className="kr-memory__list">
          {visible.map((entry, index) => {
            const opened = openedIds.has(entry.id)
            const confirming = pendingDeleteId === entry.id
            const leaving = leavingIds.has(entry.id)
            const kind = memoryKindLabel(entry.kind)
            return (
              <div
                className="kr-memory__row"
                key={entry.id}
                data-confirming={confirming ? 'true' : undefined}
                data-leaving={leaving ? 'true' : undefined}
                // 错峰退场：第 N 行晚 N×45ms 开始淡出（封顶 900ms 与请求等待一致），
                // 删多条时读起来是「一条条被抹掉」，而不是整块闪没。
                style={leaving ? { animationDelay: `${String(staggerDelay(index))}ms` } : undefined}
                role="button"
                tabIndex={0}
                title={opened ? undefined : entry.content}
                onClick={() => { if (!confirming && !leaving) toggleOpened(entry.id) }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  if (!confirming && !leaving) toggleOpened(entry.id)
                }}
              >
                <div className="kr-memory__body-col">
                  {/* 默认 1-2 行 + 省略号，点条目展开全文 */}
                  <div className="kr-memory__text" data-open={opened ? 'true' : undefined}>
                    {entry.content}
                  </div>
                  <div className="kr-memory__meta">
                    {/* 属性行只留三样：置顶星标（有才有）、类型、最多一个标签。
                        标签从两个砍到一个——右栏是速览，完整标签在记忆工作台里看；
                        版本号 vN 同样不在这里堆。 */}
                    {entry.pinned && (
                      <button
                        type="button"
                        className="kr-memory__flag"
                        title="取消置顶"
                        aria-label="取消置顶"
                        onClick={(event) => { event.stopPropagation(); void togglePin(entry) }}
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.6 1.8 14.2 6.4l-2.1.7-2.6 3.9.4 3.2-2.3-1.4-3 2.6.2-3.5-3.6-2.3 3.3-.4 1-3.5 3.1 1.1z" />
                        </svg>
                      </button>
                    )}
                    {kind !== '' && <span className="kr-memory__tag">{kind}</span>}
                    {entry.tags[0] !== undefined && entry.tags[0] !== '' && (
                      <span className="kr-memory__tag">#{entry.tags[0]}</span>
                    )}
                  </div>
                </div>

                {/* 行尾操作：常态只有时间，删除键 hover/聚焦才浮现。确认态下时间
                    就地换成「删除？确认 取消」——反悔在这一行里完成，不弹窗、
                    不跳走，也不需要先进入什么「选择」模式。 */}
                <div className="kr-memory__side" onClick={(event) => event.stopPropagation()}>
                  {confirming ? (
                    <>
                      <span className="kr-memory__ask">删除？</span>
                      <button
                        type="button"
                        className="kr-memory__link kr-memory__link--danger"
                        disabled={state.busy}
                        onClick={() => { void confirmDelete(entry) }}
                      >
                        {state.busy ? '删除中…' : '确认'}
                      </button>
                      <button
                        type="button"
                        className="kr-memory__link"
                        onClick={() => setPendingDeleteId(null)}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="kr-memory__time kr-memory__time--side">{formatWhen(entry.updatedAt)}</span>
                      <button
                        type="button"
                        className="kr-memory__act"
                        title="删除这条记忆"
                        aria-label="删除这条记忆"
                        onClick={() => setPendingDeleteId(entry.id)}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.9 4.3h10.2M6.4 4.3V3.1a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9v1.2M4.4 4.3l.5 8.4a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.5-8.4" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 「展开其余 N 条 / 收起」沉到列表底部居中一行：分区标题行只负责
            说清是哪一批，交互不跟说明文字抢同一行的横向空间。 */}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="kr-memory__more"
            onClick={() => toggleShowAll(key)}
          >
            {state.showAll ? '收起' : `展开其余 ${hiddenCount} 条`}
          </button>
        )}
      </section>
    )
  }

  return (
    <div
      className="kr-card kr-card--memory"
      data-squeezed={squeezed ? 'true' : undefined}
      data-collapsing={collapsing ? 'true' : undefined}
    >
      <div
        className="kr-card__header"
        data-busy={clearPhase === 'deleting' ? 'true' : undefined}
        onClick={() => { if (clearPhase !== 'deleting' && !collapsing) setCollapsed(!collapsed) }}
      >
        <span className="kr-card__icon">
          {/* 大脑/记忆线框图标，与任务/思考/工具三张卡同规格（16px 线性） */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2.6A2.6 2.6 0 0 0 3.4 5.2 2.4 2.4 0 0 0 2 6.2a2.4 2.4 0 0 0 .8 3.9 2.6 2.6 0 0 0 2.2 2.7c.2 1.2 1.2 2 2.4 2 .9 0 1.6-.4 2-1 .4.6 1.1 1 2 1 1.2 0 2.2-.8 2.4-2a2.6 2.6 0 0 0 2.2-2.7A2.4 2.4 0 0 0 14 6.2a2.4 2.4 0 0 0-.8-1 2.6 2.6 0 0 0-2.6-2.6c-.7-.7-1.7-1.1-2.7-1.1-1.2 0-2.3.5-2.9 1.1z" />
            <path d="M6.6 6.4h2.8M6.6 9.2h2.8" />
          </svg>
        </span>
        <span className="kr-card__title">记忆</span>
        {/* 头部只留图标 + 名称 + 条数：原来把「(N)」「展开其余」「选择」三样都
            堆在这一行，是「乱」的直接来源。现在总数是唯一的数字来源，分区行
            只报各批条数，两者不再互相重复。
            条数是**纯文字**而不是带底色的徽标（按用户要求，与其它卡片一致）：
            带单位（「3 条」而不是光一个 3），因为卡片常态是折叠的，这行字是折叠
            状态下唯一的正文，写清楚「几条」比让人数数字更省一步理解。
            确认态下暂时撤掉它：那会儿右侧写的是「删除这 3 条？」，同一句话里的
            条数出现两遍就成了「3 条 删除这 3 条？」，挤在一起还读着重复。 */}
        {clearPhase !== 'confirm' && <span className="kr-card__meta">{displayCount} 条</span>}

        {/* 标题行最右端：一键删掉**本会话新增的全部记忆**（就是这张卡列出的那批，
            条数与左边那行「N 条」严格一致）。
            为什么值得单独放一枚：这张卡是「本会话写了什么」的速览，会话结束时
            最常见的诉求就是「这些临时记的别留下」，逐条点垃圾桶在十几条时要十几下。
            交互沿用行内那套就地二次确认（不弹窗、不跳走），区别是这枚按钮**常态
            隐藏、hover 才浮现**：它是破坏性操作，不该在标题行常驻抢注意力。
            确认态另带 6s 自动回退（见 CLEAR_CONFIRM_MS）。 */}
        <span
          className="kr-memory__clear"
          onClick={(event) => event.stopPropagation()}
        >
          {clearPhase === 'idle' && !collapsing && (
            <button
              type="button"
              className="kr-memory__clear-act"
              title={`删除本会话新增的 ${displayCount} 条记忆`}
              aria-label={`删除本会话新增的 ${displayCount} 条记忆`}
              onClick={armClear}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.9 4.3h10.2M6.4 4.3V3.1a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9v1.2M4.4 4.3l.5 8.4a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.5-8.4" />
              </svg>
            </button>
          )}
          {clearPhase === 'confirm' && (
            <>
              <span className="kr-memory__ask">删除这 {displayCount} 条？</span>
              <button
                type="button"
                className="kr-memory__link kr-memory__link--danger"
                onClick={() => { void clearSessionNew() }}
              >
                确认
              </button>
              <button type="button" className="kr-memory__link" onClick={cancelClear}>
                取消
              </button>
            </>
          )}
          {clearPhase === 'deleting' && (
            <span className="kr-memory__clear-busy">删除中…</span>
          )}
        </span>
      </div>

      {/* 一键删除失败：错误留在标题行下面一行（折叠态也看得见），条目本身一条没少
          —— 失败路径从头到尾没动过数据，所以这里只需要说清「没删成、原因是这个」。 */}
      {clearError !== '' && (
        <div className="kr-memory__err kr-memory__err--clear">
          <span>{clearError}</span>
          <button type="button" className="kr-memory__link" onClick={() => setClearError('')}>
            知道了
          </button>
        </div>
      )}


      {/* 到这里必有本会话新增（否则组件早已 return null），所以只剩两种分区
          组合，且都可以直接铺开渲染，不需要任何空态分支。
          收拢退场（collapsing）时不渲染 body：那时条目已归零，留着只会渲染一个
          空容器把卡片撑在「标题行 + 空白」上，收拢动作看起来像卡了一下。 */}
      {!collapsed && !collapsing && (
        <div className="kr-memory__body">
          {sessionNewEntries.workspace.length > 0 && renderSection('workspace')}
          {sessionNewEntries.global.length > 0 && renderSection('global')}
        </div>
      )}
    </div>
  )
})
