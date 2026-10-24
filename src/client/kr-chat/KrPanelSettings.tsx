/**
 * dsh-chat-plus — Seeker「大盘设置」卡片（视口居中的模态弹层）。
 *
 * 为什么存在：这些开关原先分散在两处 —— composer 输入框那枚「内置提示词通道」悬浮卡
 * （triad/memory/Toggle.tsx 的 BuiltinToggle）与邮箱工作台设置页。用户真正要拨它们的
 * 时刻，多半是盯着右栏大盘干活的时候：手得离开大盘、回到输入框、hover 展开、拨完再
 * 回来。于是把它们收敛成一块设置面板，composer 那张重复的卡整块删除。
 *
 * 2026-10-18 用户反馈「把大盘设置也变成弹出卡片，布局需要调整下」，于是外壳从
 * 「右栏内的右滑抽屉」换成「视口居中的模态卡片」，内部从单列长列表改成两栏：
 *
 *   左栏（提示词通道 6 行，说明最长）  右栏（工作区记忆 1 行 + 展示 3 行）
 *
 * 为什么必须跳出右栏：抽屉的定位基准是 `.kr-split__side`（440px 上下），做成卡片后
 * 若仍留在那棵子树里，卡片最宽也只能盖住右栏 —— 那不是"居中弹卡片"，是"右栏里的
 * 一块大点的浮层"。所以用 createPortal 挂到 document.body，与右栏的布局 / 裁剪 /
 * overflow 彻底解耦（与邮箱卡片同一套做法）。
 *
 * **入口不在本组件里**：齿轮按钮由 kr-chat-controller 以裸 DOM 注入顶栏标签行、
 * 紧邻 Seeker 标签（用户点名要求的位置）。本组件只负责卡片本体，开合读
 * `panel-settings-store`。两者分处不同的 React 根（一个是裸 DOM 按钮、一个是
 * createRoot 挂的树），props 传不过去，所以走共享 store 而不是组件内 state ——
 * 这是本文件相对上一版最大的结构变化（上一版齿轮与抽屉同在一个组件里）。
 *
 * 数据口径：6 条注入通道 + 1 条**工作区项目记忆记录**开关走 `/api/dsh-memory/*`
 * （后者顺带复用 `/inject-state` 的 cwd / projectMemory 两个新字段，不另开端点），
 * 3 条外观偏好是 localStorage；归一化复用 Toggle.tsx 导出的
 * `normalizeInjectState` / `FALLBACK_INJECT_STATE`，不另写一套。
 * 踩过的坑：两处各写一份兜底口径（谁按 `!== false`、谁按 `=== true`）的结果，是同一个
 * 开关在两处显示成两个值 —— 用户会以为其中一个坏了，而两边读的是同一份 host 状态。
 *
 * 为什么分三组：「提示词通道」那几条真的会改注入文本（回合结束自动收口除外，见下），
 * 「展示」那三条一个字都不进 prompt、只改本机观感。混在一列里，读者会以为「总结卡外框」
 * 也是往提示词里塞东西 —— 这正是本仓反复踩过的「两种不同的东西挤一张卡」的坑。
 * 自动收口（回合结束把残留的 in_progress 改回 pending）同属「插件内置、全局单值、无
 * 卸载入口」这一类能力，才并排放在注入组里；它一个字都不进 prompt 这件事由 hint 讲清。
 * 别把它挪进展示组：展示组是纯客户端 localStorage，而它走 host。
 *
 * 「工作区记忆」自成一组的理由（2026-10-15 新增）：它是**写入侧**（这个工作区要不要
 * 记下新记忆），而「提示词通道」那一组是**读取侧**（把已有记忆注进提示词）—— 两件事
 * 语义相反，并排放在一组会被读成同一种能力；它又**按工作区**存，与展示组那种全局
 * 单值的 localStorage 偏好也不同源。所以既不能并进提示词通道，也不能塞进展示组。
 *
 * 为什么 DOM 常驻：`data-open` 是**唯一**开合判据，可见性交给 CSS 的
 * visibility / opacity / pointer-events。写成 `{open && <div/>}` 的话，关闭时元素直接从
 * DOM 里消失，退场动画（滑出 + 淡出）根本没有机会播 —— 用户看到的是「啪」一下不见。
 * 代价是卡片里的按钮始终在 DOM 里，靠 CSS 的 `visibility: hidden` 把它们移出 tab 序列
 * （visibility 隐藏的元素不可聚焦，这是 CSS 自带的，不需要额外 tabIndex）。
 *
 * 为什么不再内联 `position: absolute`：卡片 portal 到 document.body，坐标由 CSS 的
 * `position: fixed` 决定（居中 + 视口夹紧）。之前内联 absolute 是因为渲染在
 * `.kr-split__side` 这个 flex column 里、static 子节点会把大盘撑高；portal 之后
 * 这个约束消失了，内联定位反而会与 CSS 打架。
 */

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { createMemoryApi, type InjectStateView, type ProjectView } from '../triad/memory/api.js'
import { FALLBACK_INJECT_STATE, normalizeInjectState } from '../triad/memory/Toggle.js'
import { replyCardChromeEnabled, setReplyCardChromeEnabled, subscribeReplyCardChrome } from '../reply-card-chrome.js'
import { setToolCallsVisible, subscribeToolCallsVisible, toolCallsVisible } from '../tool-calls-visible.js'
import { setPlainTimelineVisible, subscribePlainTimelineVisible, plainTimelineVisible } from '../plain-timeline-visible.js'
import { workspaceCwdOf } from '../client-ctx.js'
import { getPanelSettingsStore } from './panel-settings-store.js'

/**
 * 模块级单例，不是每次渲染新建。
 *
 * `createMemoryApi()` 每次调用都返回一个新对象；若写在组件里，任何以它为依赖的 effect
 * 每帧都会重跑（Toggle.tsx 为此专门用 ref 固定引用 —— 那边实测过一分钟 498 次请求的
 * 请求风暴）。提到模块级是从根上避免这件事，也让下面的 reload 只依赖 sessionId。
 */
const api = createMemoryApi()

/**
 * 两个路径是不是同一个工作区。
 *
 * 只做归一化比较（大小写 + 反斜杠 + 末尾分隔符）：Windows 上 D:\AI\Dsh 与
 * d:\ai\dsh\ 是同一个目录，但字符串不相等 —— 直接 !== 会让「当前」标永远不亮。
 * 刻意**不**做 resolve/realpath：client 侧拿不到文件系统，且工作区注册表里存的
 * 本来就是绝对路径，符号链接那种情况交给 host 的项目 hash 去认。
 */
function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

export interface KrPanelSettingsProps {
  /** 当前会话 id（host 的 /inject-state 要它；null 时传空串）。 */
  readonly sessionId?: string | null
}

/**
 * 大盘设置卡片：遮罩 + 居中卡片本体。开合状态来自共享 store（顶栏齿轮按钮 toggle 它）。
 *
 * 对外只认一个 `sessionId`：卡片里 6 条 host 通道的读取要带上它，好让 host 回传
 * 「本会话」的那份状态。
 */
export function KrPanelSettings({ sessionId }: KrPanelSettingsProps): JSX.Element {
  const sessionKey = sessionId ?? ''
  const store = getPanelSettingsStore()
  /*
   * 开合走 useSyncExternalStore 而不是 useState：状态由**组件外**的顶栏按钮写，
   * 且那份 store 跨 bundle 实例共享。useState + 自定义事件也能做，但事件会丢
   * （按钮先于卡片挂载时那一次 toggle 没人接），而订阅式读值天然幂等。
   */
  const open = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.open,
    () => store.open,
  )
  const [state, setState] = useState<InjectStateView>(FALLBACK_INJECT_STATE)
  const [busy, setBusy] = useState(false)
  /**
   * 工作区列表（「工作区记忆」组的全部行）。
   *
   * 2026-10-18 用户要求「显示出来所有工作区每个单独进行开关」：原来是只给**当前**
   * 工作区一行开关，用户想一次看到全部工作区、逐个拨。数据来自 host 的
   * GET /api/dsh-memory/projects（已含 DSH 工作区注册表里零记忆的新工作区）。
   */
  const [projects, setProjects] = useState<ProjectView[]>([])
  /** 列表状态：loading=首屏拉取中 / error=拉失败（给重试）/ idle=正常。 */
  const [projectsState, setProjectsState] = useState<'idle' | 'loading' | 'error'>('idle')
  /** 正在写的工作区 hash（逐行 busy：写 A 不该把 B 也变灰）。 */
  const [projectBusy, setProjectBusy] = useState<string | null>(null)
  /**
   * 失效工作区的清理交互（2026-10-23）。
   *
   * 为什么需要这几个 state 而不是一个 confirm()：项目档案按 cwd 派生 hash 存着、
   * 永不自动清除，文件夹删掉之后列表里会永久留一行死工作区；用户看到的第一反应
   * 是「这玩意怎么还在」。清理是**删档案**（条目按需一并进回收站），比拨开关危险，
   * 所以给两次机会而不是弹原生 confirm：
   *   · pruneConfirm  —— 哪一行展开了二次确认条（只有含记忆的行才需要）；
   *   · pruneBusy     —— 哪一行正在清理（逐行，写 A 不该把 B 变灰）；
   *   · pruneLeaving  —— 哪一行正在播退场动画（先动画、后从 state 移除）；
   *   · pruneError    —— 行内提示（host 拒绝 / 网络失败），不静默吞掉。
   */
  const [pruneConfirm, setPruneConfirm] = useState<string | null>(null)
  const [pruneBusy, setPruneBusy] = useState<string | null>(null)
  const [pruneLeaving, setPruneLeaving] = useState<string | null>(null)
  const [pruneError, setPruneError] = useState<{ hash: string; text: string } | null>(null)
  /** host 回的真实活跃条数（本地 entryCount 过时、被 /prune-project 拒回时记录）。 */
  const [pruneCount, setPruneCount] = useState<{ hash: string; count: number } | null>(null)

  /**
   * 回读整份状态；失败按兜底形状（与 composer 卡同一份兜底，不另写）。
   *
   * 顺带把**当前工作区**的 cwd 带上：卡片里那行「工作区项目记忆记录」是按 cwd
   * 派生的项目 hash 存的，不带 cwd 的话 host 只能回 null（不知道是哪个工作区），
   * 那一行就永远显示成「未在工作区内」。cwd 每次请求都现取而不是缓存进 state：
   * 右栏可以在同一个 sessionId 下换工作区，缓存会让开关指向上一个项目 —— 那会
   * 变成**拨这个项目的开关、改的是另一个项目**，最不能接受的一类静默错误。
   */
  const reload = useCallback((): void => {
    void api.getInjectState(sessionKey, workspaceCwdOf(sessionKey))
      .then(res => { setState(normalizeInjectState(res)) })
      .catch(() => { setState(FALLBACK_INJECT_STATE) })
  }, [sessionKey])

  /**
   * 拉全部工作区（含 DSH 注册表里零记忆的新工作区）。
   *
   * 打开卡片时拉一次、写完某个开关后再拉一次 —— 不做轮询：这些开关的写入者
   * 只有本卡片（记忆面板里那处项目上下文条也可能改，但那是另一个面板、不同时开），
   * 打开时现拉一份就够新。
   */
  const loadProjects = useCallback((): void => {
    setProjectsState(prev => (prev === 'loading' ? prev : 'loading'))
    void api.projects()
      .then(res => {
        setProjects(Array.isArray(res.projects) ? res.projects : [])
        setProjectsState('idle')
      })
      .catch(() => { setProjectsState('error') })
  }, [])

  /**
   * 会话切换 → 关掉卡片 + 立刻重读；卡片打开 → 重读一次。
   *
   * 两个触发条件合在一个 effect 里，是为了避免「sessionId 变化时 open 还是 true」
   * 那种跨帧状态下两条 effect 各发一次请求。展开看到的一定是最新值。
   */
  const sessionRef = useRef(sessionKey)
  useEffect(() => {
    if (sessionRef.current !== sessionKey) {
      sessionRef.current = sessionKey
      store.setOpen(false)
      reload()
      loadProjects()
      return
    }
    if (open) {
      reload()
      loadProjects()
    }
  }, [sessionKey, open, reload, loadProjects, store])

  /**
   * Esc 关闭：监听只在打开期间挂。
   *
   * 不常驻监听 —— 卡片没开时，Esc 属于页面上别的东西（官方弹层、输入框取消等），
   * 抢过来关一个看不见的卡片是纯干扰。cleanup 同时负责组件卸载时摘干净。
   */
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') store.setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open, store])

  /**
   * 写单条内置通道（全局单值）。形状完全同构，只有 setter 不同。
   *
   * 乐观更新 + 失败回读（与 Toggle.tsx 的 pushChannel 逐字同构）：旧 host 不认识新
   * 路由时会静默丢弃写入，回滚会让 UI 显示一个它并不具备的能力，回读拿到的是真实状态。
   */
  const pushChannel = useCallback((
    key: 'zhEnabled' | 'htmlEnabled' | 'teamEnabled' | 'todoClosureEnabled' | 'stepEnabled',
    next: boolean,
  ): void => {
    setBusy(true)
    setState(prev => ({ ...prev, [key]: next }))
    const write = key === 'zhEnabled'
      ? api.setZhInjectState(next)
      : key === 'htmlEnabled'
        ? api.setHtmlInjectState(next)
        : key === 'teamEnabled'
          ? api.setTeamInjectState(next)
          : key === 'stepEnabled'
            ? api.setStepInjectState(next)
            : api.setTodoClosureState(next)
    void write
      .then(res => {
        // 中文 / 自动收口缺字段按开兜底（默认开的内置能力）；html / team 缺字段按
        // 关兜底（旧 host 根本没有这个能力，显示「开」是假阳性）—— 与 normalizeInjectState
        // 的口径逐条一致，改这里必须同步改那里。
        const enabled = key === 'htmlEnabled' || key === 'teamEnabled' ? res.enabled === true : res.enabled !== false
        setState(prev => ({ ...prev, [key]: enabled }))
      })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [reload])

  /**
   * 写 Agent 邮箱能力声明（跨模块，落在 dsh-mail 的 `mail.injectEnabled`）。
   *
   * 与上面几条**刻意不同**：这条通道的闸门是两道（工作台总开关 + 声明开关），回包里
   * 带着 workbenchEnabled / toolsMounted / authorized / address，所以必须**整组替换**
   * 而不是只改自己那一个字段 —— 只写 mailEnabled 的话，用户在工作台关着时拨这一行，
   * 界面会显示成「已开启」而实际仍是哑的，那就是要修掉的那个假阳性。
   *
   * 也正因为要等回包才知道整组字段，这里**不做乐观置值**：猜一个 enabled 出来会与
   * workbench 状态打架。busy 期间开关 disabled，用户看得到「正在写」。
   */
  const pushMail = useCallback((next: boolean): void => {
    setBusy(true)
    void api.setMailInjectState(next)
      .then(res => {
        setState(prev => ({
          ...prev,
          mailAvailable: res.available !== false,
          mailEnabled: res.enabled === true,
          mailWorkbenchEnabled: res.workbenchEnabled === true,
          mailToolsMounted: res.toolsMounted === true,
          mailAuthorized: res.authorized === true,
          mailAddress: typeof res.address === 'string' ? res.address : null,
        }))
      })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [reload])


  /**
   * 写某个工作区的两个开关（autoMemory / injectExcluded）。
   *
   * 为什么**逐行 busy** 而不是全局 busy：这是本轮新加的批量交互 —— 用户会连着拨
   * 三四个工作区。用全局 busy 的话，拨第一个时其余所有行都变灰、点不动，读起来
   * 像「卡住了」；逐行 busy 只锁正在写的那一行，其余随时可拨。
   *
   * 乐观更新 + 失败回读（与其余几条同一口径）：host 的 /meta 回的是落盘后的真实
   * meta，所以回包里那两个布尔就是权威值；失败则重拉整份列表，绝不让 UI 停在
   * 「以为改成功了」的状态上。
   */
  const pushProjectFlag = useCallback((hash: string, patch: { autoMemory?: boolean; injectExcluded?: boolean }): void => {
    setProjectBusy(hash)
    setProjects(prev => prev.map(item => (item.hash === hash ? { ...item, ...patch } : item)))
    void api.meta(hash, patch)
      .then(res => {
        const meta = res.meta
        setProjects(prev => prev.map(item => (item.hash !== hash
          ? item
          : {
              ...item,
              ...(typeof meta.autoMemory === 'boolean' ? { autoMemory: meta.autoMemory } : {}),
              ...(typeof meta.injectExcluded === 'boolean' ? { injectExcluded: meta.injectExcluded } : {}),
            })))
      })
      .catch(() => { loadProjects() })
      .finally(() => { setProjectBusy(current => (current === hash ? null : current)) })
  }, [loadProjects])

  /**
   * 清理一条失效工作区的记忆档案。
   *
   * 只有「文件夹已经不存在」且「记忆库里有它的档案」的行才会走到这里（判据见
   * ProjectView.pathMissing / fromRegistry）。三种返回必须分开处理，否则用户
   * 看到的是「点了按钮没反应」：
   *   · ok            → 先播 320ms 退场动画再从列表摘掉（直接 filter 会让行
   *                     「啪」一下消失，与卡片其它过渡不是一套语言）；
   *   · has-entries   → 卡片上的 entryCount 过时了（别处刚给它加过记忆），把真实
   *                     条数摆出来，让用户重新确认；
   *   · 其它/网络失败 → 行内红字提示，不静默吞。
   */
  const pruneWorkspace = useCallback((hash: string, purgeEntries: boolean): void => {
    setPruneBusy(hash)
    setPruneError(null)
    void api.pruneProject(hash, purgeEntries)
      .then(res => {
        if (res.ok !== true) {
          // has-entries：本地 entryCount 过时了（别处刚给它加过记忆），把真实
          // 条数记下来并展开确认条，让用户按真实数字重新确认，而不是只弹一行错。
          if (res.reason === 'has-entries') {
            setPruneCount({ hash, count: res.entryCount ?? 0 })
            setPruneConfirm(hash)
            return
          }
          const text = res.reason === 'no-project'
            ? '记忆库里没有这个项目的档案（它只存在于 DSH 工作区注册表，那里由 DSH 自己清理）'
            : '档案没删掉（可能被占用），稍后再试'
          setPruneError({ hash, text })
          return
        }
        setPruneConfirm(null)
        setPruneCount(null)
        setPruneLeaving(hash)
        // 320ms 与 CSS 里 .kr-settings__ws-row--leaving 的动画时长一致，改一处必须同步另一处。
        window.setTimeout(() => {
          setProjects(prev => prev.filter(item => item.hash !== hash))
          setPruneLeaving(null)
        }, 320)
      })
      .catch(() => { setPruneError({ hash, text: '清理失败（宿主没响应）' }) })
      .finally(() => { setPruneBusy(current => (current === hash ? null : current)) })
  }, [])

  const zhOn = state.zhEnabled !== false
  const htmlOn = state.htmlEnabled === true
  const teamOn = state.teamEnabled === true
  // 自动收口与 zh 同口径（默认开）：缺字段按开，别抄 html / team 的 === true。
  const todoClosureOn = state.todoClosureEnabled !== false
  // step 纪律与 zh / 自动收口同口径（默认开）：缺字段按开。
  const stepOn = state.stepEnabled !== false
  /*
   * Agent 邮箱：唯一一条**跨模块**通道（承载在 dsh-mail），也是唯一一条会「不可用」的行。
   *
   * 两道开关解耦（与 composer 卡同口径）：这一行拨的是**声明**（injectEnabled），
   * 工作台总开关只决定 `mail_*` 工具在不在。工作台关着不是错误状态 —— 注入照常发生，
   * 只是文本改走 `agently-cli` 命令行，所以副说明如实交代，不把这一行画成关。
   * 模块没挂（旧 host / 装配失败）时才不给开关：拨不动的开关是骗人。
   */
  const mailAvailable = state.mailAvailable === true
  const mailOn = state.mailEnabled === true
  const mailToolsMounted = state.mailToolsMounted === true
  const mailAuthorized = state.mailAuthorized === true
  const mailAddress = typeof state.mailAddress === 'string' && state.mailAddress !== '' ? state.mailAddress : null
  const mailHint = !mailAvailable
    ? '邮箱模块未挂载（本机没有可用的邮箱能力）'
    : !mailAuthorized
      ? '邮箱尚未授权：在本机终端跑 agently-cli auth login 扫码，授权后才会注入'
      : mailToolsMounted
        ? (mailAddress === null ? '注册第三方服务、收验证码时直接用本 Agent 的专属邮箱，不再问你'
                                : `注册第三方服务、收验证码时直接用 ${mailAddress}，不再问你`)
        : (mailAddress === null ? '注册第三方服务、收验证码时直接用本 Agent 的专属邮箱，不再问你。邮箱工作台关着，模型走 agently-cli 命令行收发'
                                : `注册第三方服务、收验证码时直接用 ${mailAddress}，不再问你。邮箱工作台关着，模型走 agently-cli 命令行收发`)

  /*
   * 展示组两条：纯呈现偏好，状态在 localStorage（见 reply-card-chrome / tool-calls-visible）。
   *
   * 用 useSyncExternalStore 而不是 useState：它们必须与**别的浏览器窗口**里拨动的同一个
   * 开关保持一致（storage 事件会唤醒订阅），useState 只能看见本组件的那次点击。
   */
  const chromeOn = useSyncExternalStore(subscribeReplyCardChrome, replyCardChromeEnabled, replyCardChromeEnabled)
  const toolCallsOn = useSyncExternalStore(subscribeToolCallsVisible, toolCallsVisible, toolCallsVisible)
  // 操作面板与上面两条同族：它也是「这张卡要不要出现在右栏」，同样只写 localStorage。
  const plainTimelineOn = useSyncExternalStore(subscribePlainTimelineVisible, plainTimelineVisible, plainTimelineVisible)

  /*
   * 当前工作区 cwd（只用来给列表里那一行打「当前」标；拿不到就是 null）。
   *
   * 每次渲染现取（workspaceCwdOf 只读快照、无副作用）而不是缓存进 state：右栏
   * 可以在同一个 sessionId 下换工作区，缓存会让标记停在上一个项目。
   */
  const projectCwdRaw = workspaceCwdOf(sessionKey)
  const projectCwd = projectCwdRaw !== undefined && projectCwdRaw !== '' ? projectCwdRaw : null

  const card = (
    <>
      {/* 遮罩：点它关闭。纯装饰，键盘用户走 Esc 与关闭按钮，故 aria-hidden 恒为 true。
          齿轮触发按钮**不在这里** —— 它由 kr-chat-controller 注入顶栏标签行、
          紧邻 Seeker 标签（用户点名要求的位置），通过 panel-settings-store 与本卡片联动。 */}
      <div
        className="kr-settings__scrim"
        data-open={open ? 'true' : 'false'}
        aria-hidden="true"
        onClick={() => { store.setOpen(false) }}
      />

      <div
        className="kr-settings"
        data-open={open ? 'true' : 'false'}
        role="dialog"
        aria-label="大盘设置"
        aria-modal={open ? true : undefined}
        aria-hidden={!open}
      >
        <div className="kr-settings__head">
          <span className="kr-settings__title"><GearIcon size={13} />大盘设置</span>
          <button
            type="button"
            className="kr-settings__close"
            aria-label="关闭设置"
            onClick={() => { store.setOpen(false) }}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="kr-settings__body">
          {/* 左栏：提示词通道。这一组每行都有一大段说明（团队协作 / Agent 邮箱那两条
              尤其长），单列排下来要滚很久；卡片给到 960px 宽之后，把短的那两组挪到
              右栏，左栏独占整列高度，长说明不再被挤成窄条。 */}
          <div className="kr-settings__col kr-settings__col--main">
          <div className="kr-settings__group">
            <span className="kr-settings__group-title">提示词通道</span>
            <SettingsRow
              index={0}
              lead
              label="中文优先"
              hint="中文思考与输出；代码、路径、报错保持原文"
              on={zhOn}
              busy={busy}
              onToggle={() => { pushChannel('zhEnabled', !zhOn) }}
            />
            <SettingsRow
              index={1}
              label="对话内交互卡片"
              hint="注入沙箱规范，模型才会主动用它交付小工具"
              on={htmlOn}
              busy={busy}
              onToggle={() => { pushChannel('htmlEnabled', !htmlOn) }}
            />
            <SettingsRow
              index={2}
              label="团队协作"
              hint="独立子任务默认并行发 subagent；复杂任务组队当 Lead；只有小事自己做。每会话首步注入一次。"
              on={teamOn}
              busy={busy}
              onToggle={() => { pushChannel('teamEnabled', !teamOn) }}
            />
            {/* 邮箱行：模块没挂时不给开关，只留 label + 「不可用」角标 + 说明。 */}
            {mailAvailable
              ? (
                <SettingsRow
                  index={3}
                  label="Agent 邮箱"
                  hint={mailHint}
                  on={mailOn}
                  busy={busy}
                  onToggle={() => { pushMail(!mailOn) }}
                />
              )
              : (
                <SettingsRow
                  index={3}
                  label="Agent 邮箱"
                  hint={mailHint}
                  tag="不可用"
                />
              )}
            <SettingsRow
              index={4}
              label="step 纪律"
              hint="把无数据依赖的多条动作合并进一次调用，减少模型往返。实测同一批 3 条命令：拆 3 步 25.7s → 合并 1 步 5.3s。含反判据（真依赖 / 需独立审批 / 输出会超限时不合并）。每会话首步注入一次。"
              on={stepOn}
              busy={busy}
              onToggle={() => { pushChannel('stepEnabled', !stepOn) }}
            />
            <SettingsRow
              index={5}
              label="回合结束自动收口"
              hint="回合结束时把残留的「进行中」任务项改回「未完成」，右栏任务卡不再挂着没收尾的项。它不改提示词，只动任务清单的状态。"
              on={todoClosureOn}
              busy={busy}
              onToggle={() => { pushChannel('todoClosureEnabled', !todoClosureOn) }}
            />
          </div>
          </div>

          {/* 右栏：工作区记忆 + 展示。两组都短（1 行 + 3 行），叠在一列里正好与左栏
              那 6 行等高，读者一眼能把「会改提示词的」和「只改观感的」分到两半。 */}
          <div className="kr-settings__col kr-settings__col--aside">

          {/* 「工作区记忆」自成一枚组标题：这一行是**写入侧**（这个工作区要不要记下
              新记忆），与上面那组「提示词通道」（把已有记忆读着注进提示词）语义相反。
              并排塞进上一组会被读成同一种能力 —— 用户关掉它以为只是「不注入」，
              实际是整个工作区不再积累记忆。组说明写该行**按工作区**这条共性，
              行 hint 只讲关掉后具体会怎样。 */}
          <div className="kr-settings__group">
            <span className="kr-settings__group-title">工作区记忆</span>
            <span className="kr-settings__group-note">
              按工作区（项目文件夹）分别设置，不是全局单值。每个工作区两个开关：
              <b>记录</b>管要不要往这个工作区攒新记忆，<b>不注入</b>管要不要把已有记忆读进它的会话。
            </span>
            {/* 全部工作区逐行列出（2026-10-18 用户要求）：原来只给「当前工作区」
                一行开关，用户看不到别的工作区、也没法一次调好几个。

                三种状态各有归宿，缺一个都会变成「看着像坏了」：
                  · loading → 一行占位（首屏拉取，通常几十毫秒）；
                  · error   → 一行「读取失败 + 重试」，绝不留空白；
                  · 空列表  → 一行说明（本机还没有任何工作区）。
                列表本身限高可滚：工作区可能有十几个，右栏不能无限长下去。 */}
            {projectsState === 'loading' && projects.length === 0 && (
              <div className="kr-settings__ws-hint">正在读取工作区…</div>
            )}
            {projectsState === 'error' && projects.length === 0 && (
              <div className="kr-settings__ws-hint">
                读取工作区失败（宿主没响应）。
                <button type="button" className="kr-settings__ws-retry" onClick={loadProjects}>重试</button>
              </div>
            )}
            {projectsState !== 'loading' && projectsState !== 'error' && projects.length === 0 && (
              <div className="kr-settings__ws-hint">本机还没有工作区。打开一个文件夹作为工作区后，这里会出现它的两个开关。</div>
            )}
            {projects.length > 0 && (
              <div className="kr-settings__ws-list">
                {projects.map(project => {
                  const name = project.alias !== null && project.alias !== ''
                    ? project.alias
                    : (project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash)
                  const isCurrent = projectCwd !== null && samePath(project.path, projectCwd)
                  const rowBusy = projectBusy === project.hash
                  // 文件夹不存在（2026-10-23）：整行标灰 + 禁用开关 + 给「清理」。
                  // fromRegistry 行是「只存在于 DSH 注册表、记忆库没档案」，不给清理入口。
                  const missing = project.pathMissing === true
                  const cleanable = missing && project.fromRegistry !== true
                  const confirmOpen = pruneConfirm === project.hash
                  const leaving = pruneLeaving === project.hash
                  const rowError = pruneError !== null && pruneError.hash === project.hash ? pruneError.text : null
                  return (
                    <div
                      key={project.hash}
                      className={[
                        'kr-settings__ws-row',
                        isCurrent ? 'kr-settings__ws-row--current' : '',
                        missing ? 'kr-settings__ws-row--missing' : '',
                        leaving ? 'kr-settings__ws-row--leaving' : '',
                      ].filter(Boolean).join(' ')}
                      data-current={isCurrent ? 'true' : undefined}
                      data-missing={missing ? 'true' : undefined}
                      // 行上带 hash：e2e 按工作区定位开关（只靠名字会在重名/别名时选错行）。
                      data-hash={project.hash}
                    >
                      <div className="kr-settings__ws-main">
                        <span className="kr-settings__ws-name" title={project.path}>
                          {name}
                          {isCurrent && <span className="kr-settings__ws-badge">当前</span>}
                          {missing && <span className="kr-settings__ws-badge kr-settings__ws-badge--missing">文件夹已不存在</span>}
                        </span>
                        <span className="kr-settings__ws-path" title={project.path}>{project.path}</span>
                        {rowError !== null && (
                          <span className="kr-settings__ws-error" role="alert">{rowError}</span>
                        )}
                        {confirmOpen && (
                          <span className="kr-settings__ws-confirm" role="alertdialog" aria-label="确认清理">
                            <span className="kr-settings__ws-confirm-text">
                              这个项目下还有 {pruneCount !== null && pruneCount.hash === project.hash ? pruneCount.count : project.entryCount} 条记忆，清理会把它们一并移入回收站。
                            </span>
                            <button
                              type="button"
                              className="kr-settings__ws-confirm-ok"
                              disabled={pruneBusy === project.hash}
                              onClick={() => { pruneWorkspace(project.hash, true) }}
                            >
                              确认清理
                            </button>
                            <button
                              type="button"
                              className="kr-settings__ws-confirm-cancel"
                              disabled={pruneBusy === project.hash}
                              onClick={() => { setPruneConfirm(null); setPruneCount(null); setPruneError(null) }}
                            >
                              取消
                            </button>
                          </span>
                        )}
                      </div>
                      <div className="kr-settings__ws-flags">
                        <span className="kr-settings__ws-flag">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={project.autoMemory}
                            aria-label={`${name}：记录新记忆`}
                            title="记录新记忆：关掉后这个工作区不再自动提取，模型也不能手动往里记；已有记忆不受影响。"
                            disabled={rowBusy || missing}
                            className="kr-settings__switch kr-settings__switch--mini"
                            onClick={() => { pushProjectFlag(project.hash, { autoMemory: !project.autoMemory }) }}
                          />
                          <span className="kr-settings__ws-flag-text">记录</span>
                        </span>
                        <span className="kr-settings__ws-flag">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={project.injectExcluded === true}
                            aria-label={`${name}：不注入记忆`}
                            title="不注入：开启后，在这个工作区的会话里不再注入任何记忆条目；记录、检索与面板展示都不受影响。"
                            disabled={rowBusy || missing}
                            className="kr-settings__switch kr-settings__switch--mini kr-settings__switch--warn"
                            onClick={() => { pushProjectFlag(project.hash, { injectExcluded: !(project.injectExcluded === true) }) }}
                          />
                          <span className="kr-settings__ws-flag-text">不注入</span>
                        </span>
                        {cleanable && (
                          <span className="kr-settings__ws-flag">
                            <button
                              type="button"
                              className="kr-settings__ws-clean"
                              disabled={rowBusy}
                              onClick={() => {
                                setPruneError(null)
                                // 本地 count 大于 0 直接进确认（条数摆出来再确认一次）；
                                // 本地是 0 也可能过时（别处刚加过），host 会以 has-entries
                                // 拒回真实条数，届时再展开确认 —— 两处都兜住。
                                if (project.entryCount > 0) {
                                  setPruneCount({ hash: project.hash, count: project.entryCount })
                                  setPruneConfirm(project.hash)
                                } else {
                                  pruneWorkspace(project.hash, false)
                                }
                              }}
                            >
                              {pruneBusy === project.hash ? '清理中…' : '清理'}
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 展示组：与上面那几条**不是一类东西**，所以另起一枚组标题隔开。
              组说明承接标题、写该组**共性**（三条都是纯 localStorage 外观偏好：
              只改本机观感、不入 prompt、全局所有会话生效、随浏览器持久保存），
              各行 hint 于是只讲「关掉后具体会怎样」——2026-10-15 之前这三句共性
              在三条 hint 里各抄了一遍，是设置面板里最占地方的重复。
              `--compact` 让这一组走紧凑排版（单行省略、悬停/聚焦展开全文），
              与注入组「每行一大段说明」的读法区分开。 */}
          <div className="kr-settings__group kr-settings__group--compact">
            <span className="kr-settings__group-title">展示</span>
            <span className="kr-settings__group-note">
              只改本机观感，一个字都不进提示词；全局所有会话生效，随本机浏览器持久保存（刷新 / 重启 DSH 后仍在）。悬停或聚焦某行可展开完整说明。
            </span>
            <SettingsRow
              index={6}
              lead
              label="总结卡外框"
              hint="关掉后 Seeker 对话流的总结卡不留边框与阴影，退回纯正文。"
              on={chromeOn}
              // busy 恒为 false：这一行写的是 localStorage（同步落盘 + 刷 body 属性），
              // 没有网络往返，不存在「正在保存」的中间态。写成 busy={busy} 会让它在别的
              // host 通道保存时莫名变灰、点不动。
              busy={false}
              onToggle={() => { setReplyCardChromeEnabled(!chromeOn) }}
            />
            <SettingsRow
              index={7}
              label="工具调用卡"
              hint="关掉后 Seeker 右栏不再显示技术向的「工具调用」台账（默认 5 行滚动窗口那张）；人话行动流不受影响。"
              on={toolCallsOn}
              // 与总结卡外框同族：写 localStorage，同步落盘无网络往返，busy 恒 false。
              busy={false}
              onToggle={() => { setToolCallsVisible(!toolCallsOn) }}
            />
            {/* 操作面板：右栏滚动区那三张里的中间那张（人话行动流）。它与上面
                两条同族（纯外观、localStorage），但读者不同 —— 它是唯一一张讲
                人话的卡，关掉后右栏只剩技术台账，所以默认开、且 hint 要把这件事
                说明白，免得用户关完发现"什么都不知道了"。 */}
            <SettingsRow
              index={8}
              label="操作面板"
              hint="关掉后 Seeker 右栏不再显示那张中文人话行动流（把工具调用翻译成「打开携程 · 机票」的卡）；工具调用台账与其余卡片不受影响。"
              on={plainTimelineOn}
              // 同族第三条：localStorage 同步落盘，busy 恒 false。
              busy={false}
              onToggle={() => { setPlainTimelineVisible(!plainTimelineOn) }}
            />
          </div>
          </div>
        </div>

        <p className="kr-settings__foot">硬编码在插件内、无卸载入口；其中「提示词通道」与「工作区记忆」是全局/按工作区存于 host 的开关（后者随工作区各不相同），「展示」那三条只在本机浏览器里生效。</p>
      </div>
    </>
  )

  /*
   * portal 到 body：卡片是**全视口模态**，不能留在 .kr-split__side 那棵子树里。
   *
   * 留在里面的话，卡片的定位基准是右栏（440px 上下），最宽也只能盖住右栏 ——
   * 那不是"居中弹卡片"，是"右栏里一块大点的浮层"。而且 .kr-split__side 带
   * overflow:hidden，卡片超出部分会被直接裁掉。
   *
   * SSR / 首帧无 document 时退回原地渲染（本插件只在浏览器跑，这层纯兜底）。
   */
  if (typeof document === 'undefined') return card
  return createPortal(card, document.body)
}

/**
 * 卡片里的一行：左侧标签（可带角标）+ 副说明，右侧开关。
 *
 * `on` 省略 = 这一行**不给开关**（邮箱模块没挂时那种「拨不动的开关」）。
 * `lead` 标出该组第一行：上方已经有组标题，不再叠一条分隔虚线。
 * `index` 是全局行序号（0 起），供 CSS 用 `--row-i` 做错开浮现。
 *
 * hint 上挂 `title` 全文：紧凑组默认把它压成一行省略号，鼠标悬停虽会展开，
 * 但原生 title 是「文字被截断时仍拿得到完整内容」的最后一道保险（也覆盖
 * 悬停展开动画被系统减弱动效设置关掉的情形）。 */
function SettingsRow({
  index,
  lead = false,
  label,
  hint,
  on,
  busy = false,
  tag,
  onToggle,
}: {
  readonly index: number
  readonly lead?: boolean
  readonly label: string
  readonly hint?: string
  /** 省略 = 不渲染开关按钮。 */
  readonly on?: boolean
  readonly busy?: boolean
  readonly tag?: string
  readonly onToggle?: () => void
}): JSX.Element {
  return (
    <div
      className={lead ? 'kr-settings__row kr-settings__row--lead' : 'kr-settings__row'}
      style={{ '--row-i': String(index) } as CSSProperties}
    >
      <span className="kr-settings__main">
        <span className="kr-settings__label">
          {label}
          {tag !== undefined && <span className="kr-settings__badge">{tag}</span>}
        </span>
        {hint !== undefined && <span className="kr-settings__hint" title={hint}>{hint}</span>}
      </span>
      {on !== undefined && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={busy}
          className="kr-settings__switch"
          onClick={onToggle}
        />
      )}
    </div>
  )
}

/**
 * 齿轮图标：设置卡片标题用。
 *
 * 2026-10-25 第二次修正：**实心** 8 齿 + 中心圆孔（fill + fill-rule:evenodd）。
 *
 * 前两版都不对：① 圆 + 八根发散线（那是太阳/辐条）；② 描边闭合 path（小尺寸下
 * 线宽只剩 1px，齿形糊成一圈锯齿，用户反馈「有点丑」）。实心齿轮在小尺寸下干净
 * 得多。
 *
 * ⚠ 卡头那枚触发按钮在 SeekerHead.tsx 里，是同一形状的独立字符串；改这里时同步改那边。
 */
function GearIcon({ size = 15 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10.6 1.5h2.8a1 1 0 0 1 .99.86l.24 1.83a8.2 8.2 0 0 1 2.14 1.24l1.72-.7a1 1 0 0 1 1.24.42l1.4 2.42a1 1 0 0 1-.22 1.28l-1.4 1.2a8.2 8.2 0 0 1 0 2.47l1.4 1.2a1 1 0 0 1 .22 1.28l-1.4 2.42a1 1 0 0 1-1.24.42l-1.72-.7a8.2 8.2 0 0 1-2.14 1.24l-.24 1.83a1 1 0 0 1-.99.86h-2.8a1 1 0 0 1-.99-.86l-.24-1.83a8.2 8.2 0 0 1-2.14-1.24l-1.72.7a1 1 0 0 1-1.24-.42l-1.4-2.42a1 1 0 0 1 .22-1.28l1.4-1.2a8.2 8.2 0 0 1 0-2.47l-1.4-1.2a1 1 0 0 1-.22-1.28l1.4-2.42a1 1 0 0 1 1.24-.42l1.72.7a8.2 8.2 0 0 1 2.14-1.24l.24-1.83a1 1 0 0 1 .99-.86Zm1.4 6.9a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" />
    </svg>
  )
}

/** 关闭图标（×）。 */
function CloseIcon({ size = 14 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
    </svg>
  )
}