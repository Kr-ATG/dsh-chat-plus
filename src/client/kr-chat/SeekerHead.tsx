/**
 * dsh-chat-plus — 「Seeker 卡头」（鲸鱼娘 + 名字 + 一行当前状态 + 右上角两枚动作）。
 *
 * ## 为什么单独抽出来
 *
 * 2026-10-25 用户要求：「新对话页面的上面放上我们这个东西」—— 新对话（空白 Hero
 * 态）也要有这张卡头，让用户在发第一条消息之前就能看到"她在这儿"。
 *
 * 但卡头不能复制两份：它包含立绘、浏览器标志、按钟点轮换的空闲文案、Git / 邮箱 /
 * 齿轮三枚动作按钮（还带着 e2e 依赖的 id）。两份必然分叉 —— 改一处忘了另一处，
 * 表现是"新对话页的图标是旧的"这类没人会想到去查的 bug。
 *
 * 所以把卡头抽成这个组件，操作面板卡与新对话页共用同一份。
 *
 * ## 它不负责什么
 *
 * 不订阅任何数据源：浏览器标志、齿轮/邮箱的开合、当前动作/空闲文案，全部由调用方
 * 通过 props 传进来。这样同一个组件既能用在操作面板卡里（那里本来就有一整套数据），
 * 也能用在新对话页（那里只需要一个"她在这儿"的静态卡头）。
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { SeekerStage } from './SeekerStage.tsx'
import { idleClipFor, type MotionClipId } from './motion-clips.ts'
import type { StageMode } from './stage-mode.ts'
import { activateBrowserWindow } from '../browser-flag/activate.ts'
import { browserFlagTitle, type BrowserActivitySession } from '../browser-flag/store.ts'
import { workspaceCwdOf } from '../client-ctx.ts'
import { getPanelSettingsStore } from './panel-settings-store.ts'
import { getMailDrawerStore } from './mail-drawer-store.ts'
import { getMailUnreadStore } from './mail-unread-store.ts'
import { getGitRosterStore, useGitRosterSnapshot } from './git-roster-store.ts'
import { SeekerGitStatus } from './SeekerGitStatus.tsx'
import { GitRosterModal } from './GitRosterModal.tsx'
import { useFeature } from '../features/gate.tsx'

/** 一行状态：要么是一个动作，要么是空闲文案。 */
export interface SeekerHeadLine {
  /** 动作图标键（有动作时）。 */
  readonly icon?: string
  /** 动词（有动作时）。 */
  readonly verb?: string
  /** 动词是否不必显示（纯复述图标，见 plain-language 的 hideVerb）。 */
  readonly hideVerb?: boolean
  /** 对象/细节。 */
  readonly detail?: string
  /** 状态（running / done / failed），驱动图标颜色。 */
  readonly status?: string
}

export interface SeekerHeadProps {
  /** 动画开关（系统「减少动态效果」时为 false）。 */
  readonly motion?: boolean
  /**
   * 卡头此刻演哪一段（见 stage-mode.ts）。默认 'idle'。
   *
   * 右栏由 KrPlainTimelineCard 按当前动作算好传进来；新对话页只有「在思考中 /
   * 没在干活」两档，直接给 thinking / idle。
   */
  readonly stageMode?: StageMode
  /**
   * 空闲时段对应的片段。不传就按 {@link SeekerHeadProps.idleLine} 的文案反查
   * （idle-phrase.ts 的三个说法各对应一段，见 motion-clips.ts 的 idleClipFor）。
   */
  readonly idleClip?: MotionClipId
  /** 当前这一行要显示什么；null 表示没有动作，显示 {@link idleLine}。 */
  readonly line?: SeekerHeadLine | null
  /** 没动作时显示的那句话（休息中 / 吃饭中 / 在思考中…）。 */
  readonly idleLine: string
  /** idleLine 是否表示「正在思考」（驱动主色与呼吸点）。 */
  readonly thinking?: boolean
  /** 本会话的浏览器活动条目（有就显示那枚可点击的图标）。 */
  readonly browserEntry?: BrowserActivitySession | undefined
  /** 是否显示浏览器标志（粘滞判据在调用方，见 KrPlainTimelineCard）。 */
  readonly browserOn?: boolean
  /** 整个卡头可点（操作面板卡用它折叠时间线；新对话页不需要）。 */
  readonly onClick?: () => void
  /** aria-expanded（只有可折叠时才传）。 */
  readonly expanded?: boolean
  /** 渲染动作图标 SVG 的函数（由调用方提供，避免这里依赖那套图标表）。 */
  readonly renderIcon?: (name: string) => ReactElement
  /** 额外类名（新对话页要一版更大的尺寸）。 */
  readonly className?: string
  /** 当前会话 ID（用于解析当前工作区根目录）。 */
  readonly sessionId?: string | null
  /** 工作区根目录（优先）。 */
  readonly cwd?: string
  /**
   * 是否渲染右上角那三枚动作按钮（Git / 邮箱 / 齿轮）。默认 true。
   *
   * **新对话页必须传 false**（2026-10-25 修）：那两枚按钮带固定 id
   * （`kr-panel-settings-btn` / `kr-mail-btn`），而新对话页的 Hero 卡头是**常驻
   * DOM** 的 —— 控制器收起它时只设 `style.display = 'none'`，节点并没有被移除。
   * 于是同一个页面上会同时存在两组同 id 按钮：`getElementById` 只返回第一个，
   * 而它恰好是隐藏的那个（尺寸 0×0），e2e 与任何按 id 取节点的代码都会拿到
   * 一个点不动的幽灵按钮 —— 表现是「齿轮明明在，点了没反应」。
   *
   * 为什么不是「收起时把节点移除」：Hero 卡头要保留 running 状态、避免每次进出
   * 空白页都重建 React 根（重建会闪一下）。少渲染两枚按钮更简单 —— 它们在
   * 新对话页本来也没有意义（那时还没有大盘可设置、也没有邮箱要开）。
   */
  readonly chrome?: boolean
}

/**
 * Seeker 卡头。
 *
 * @param props - 见 {@link SeekerHeadProps}。
 * @returns 卡头节点。
 */
export function SeekerHead(props: SeekerHeadProps): ReactElement {
  const {
    motion = true,
    stageMode = 'idle',
    idleClip,
    line = null,
    idleLine,
    thinking = false,
    browserEntry,
    browserOn = false,
    onClick,
    expanded,
    renderIcon,
    className,
    sessionId,
    cwd,
    chrome = true,
  } = props

  /*
   * 功能开关（live）——卡头是「右栏操作面板」与「新对话页 Hero」共用的唯一一份，
   * 所以动画 / Git / 邮箱三个开关都在这里统一判，两处自然一致，不需要各写一遍。
   *
   * 同样必须顶层无条件调用：卡头经常随面板每 250ms 重渲染，条件调 hook 会让
   * 组件树直接崩。
   */
  const taskMotionOn = useFeature('view.task-motion')
  const gitStatusOn = useFeature('view.git-status')
  const mailOn = useFeature('view.mail')

  /*
   * 两枚动作按钮的开合态。必须**订阅**而不是读一次：按钮的 data-open 决定它亮不亮，
   * 读一次的话点了之后要等下一次重渲染才变色（而且可能是几十秒后）。
   *
   * 用 useSyncExternalStore 而不是 useState + effect：store 本身就是这个 hook 的
   * 标准形态（subscribe + getSnapshot），不必自己管订阅与清理。
   */
  const settingsStore = getPanelSettingsStore()
  const settingsOpen = useSyncExternalStore(
    (cb) => settingsStore.subscribe(cb),
    () => settingsStore.open,
    () => settingsStore.open,
  )
  const mailStore = getMailDrawerStore()
  const mailOpen = useSyncExternalStore(
    (cb) => mailStore.subscribe(cb),
    () => mailStore.open,
    () => mailStore.open,
  )
  const unreadStore = getMailUnreadStore()
  /*
   * view.mail 关闭时**不能订阅 unreadStore**：它的 `subscribe()` 内部会调用
   * `ensureAutoPoll()`，一订阅就启动 45s 轮询 + visibility / focus 监听。
   * Agent Mail 有 10 次/分的硬限额，关掉的按钮不该还在后台打请求。
   *
   * 做法是给 useSyncExternalStore 换一个**空订阅函数**（订阅动作本身不能条件
   * 跳过，hook 必须无条件调用）；开关重新打开时 mailOn 变化会让它重新用真
   * 订阅，store 那边的 `ensureAutoPoll` 若从未启动过就会在这一刻启动。
   */
  const unreadSubscribe = useCallback(
    (cb: () => void): (() => void) => (mailOn ? unreadStore.subscribe(cb) : () => {}),
    [mailOn, unreadStore],
  )
  const unreadSnapshot = useSyncExternalStore(
    unreadSubscribe,
    () => unreadStore.getSnapshot(),
    () => unreadStore.getSnapshot(),
  )
  const { count: unreadCount, hasMore: unreadHasMore } = unreadSnapshot

  useEffect(() => {
    // view.mail 关闭：连这一次首帧静默检查也不发（订阅层同理，见上）。
    if (!mailOn) return
    void unreadStore.checkUnread(false)
  }, [mailOn, unreadStore])

  /*
   * Git 未提交项目角标（2026-10-29 用户要求：Git 图标要像邮箱按钮一样提示
   * 「有多少个 Git 项目没有提交」）。
   *
   * 数字取 **Git 大盘里有未提交改动的仓库个数**（工作区 + 自制插件）：
   * 一个仓库改了 11 个文件也只算 1，不是文件条数。当前工作区本身不是 Git
   * 仓库时（例如 D:\AI\Dsh 这种多插件工作区），仍能显示各插件仓库里有
   * 未提交改动的项目数，不会整枚消失。
   *
   * 数据走共享的 git-roster-store：角标与大盘弹窗共用同一份快照、同一个
   * 45 秒轮询（/api/chat-flow/git-roster 会逐个仓库跑 git status，不能让
   * 两处各轮一遍）。view.git-status 关闭时不订阅，store 内也不会启动定时器。
   */
  const resolvedCwd = cwd ?? workspaceCwdOf(sessionId)
  const gitRosterSnapshot = useGitRosterSnapshot(chrome && gitStatusOn)
  const gitDirtyRepoCount = gitRosterSnapshot.dirtyRepoCount
  const gitRosterOpen = gitRosterSnapshot.open
  const gitRosterStore = getGitRosterStore()

  /*
   * 点浏览器标志 → 把那个窗口拉到前台（2026-10-25 用户要求）。
   *
   * 候选进程名从活动条目的 service/tool 推：ego-browser 背后的桌面进程是 ego，
   * playwright-mcp 背后通常是 chrome。推不出来时退到 'ego'（用户的默认场景）。
   * 服务端按序试，第一个成功的赢。
   *
   * ## 失败反馈（2026-10-25 补）
   *
   * 原先完全静默。问题是：**失败和成功在界面上长得一模一样**，用户点完不知道
   * 到底发生了没有 —— 而这轮修的正是「点了不跳转」，静默失败让人连"是不是坏了"
   * 都判断不了。
   *
   * 现在成功后给一次极短的**主色脉冲**（图标闪一下），失败则把图标变成一次性
   * 的警示色 + title 里换成"没找到窗口"。都不弹窗、不打断，但能分清两种结果。
   */
  const busyRef = useRef(false)
  const [flash, setFlash] = useState<'ok' | 'fail' | null>(null)
  const flashTimerRef = useRef(0)
  const onBrowserClick = useCallback((event: React.MouseEvent): void => {
    // 卡头整块可能是折叠热区：点图标不该顺带展开时间线。
    event.stopPropagation()
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    const label = browserFlagTitle(browserEntry).toLowerCase()
    const candidates = label.includes('playwright') || label.includes('chrome')
      ? ['chrome', 'msedge', 'ego']
      : ['ego', 'chrome', 'msedge']
    void activateBrowserWindow(candidates).then((ok) => {
      if (flashTimerRef.current !== 0) window.clearTimeout(flashTimerRef.current)
      setFlash(ok ? 'ok' : 'fail')
      flashTimerRef.current = window.setTimeout(() => { setFlash(null) }, ok ? 700 : 2200)
    }).finally(() => {
      // 给一点冷却：连点会把同一个窗口反复拽到前台（观感上像在抖）。
      window.setTimeout(() => { busyRef.current = false }, 600)
    })
  }, [browserEntry])
  useEffect(() => () => {
    if (flashTimerRef.current !== 0) window.clearTimeout(flashTimerRef.current)
  }, [])

  const hasLine = line !== null && line !== undefined
  const lineText = hasLine
    ? (line.hideVerb === true && line.detail !== undefined && line.detail !== ''
      ? line.detail
      : line.verb)
    : idleLine

  const headClass = className === undefined ? 'kr-card__header kr-plain-head' : `kr-card__header kr-plain-head ${className}`

  return (
    <div
      className={headClass}
      onClick={onClick}
      role={onClick === undefined ? undefined : 'button'}
      tabIndex={onClick === undefined ? undefined : 0}
      aria-expanded={onClick === undefined ? undefined : expanded}
      aria-label={`Seeker · ${lineText ?? ''}${expanded === true ? '（已展开时间线）' : ''}`}
      onKeyDown={onClick === undefined ? undefined : (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      {/*
       * 立绘位现在是**任务动画**（2026-10-26 用户给的 9 个 GIF 转成的透明底
       * WebM，见 SeekerStage.tsx / motion-clips.ts）。
       *
       * 盒子尺寸不变（92×164，见 styles.ts 的 .kr-stage）：用户点名
       * 「不需要动」—— 卡头的排版一个像素都不该因为换素材而位移。
       */}
      {/* view.task-motion 关闭：motion=false 让 SeekerStage 只显示当前状态的静态首帧
          （它内部会把画面收到 restingClip，不会停在一段被暂停的一次性动画上）。 */}
      <SeekerStage
        mode={stageMode}
        idleClip={idleClip ?? idleClipFor(idleLine)}
        motion={motion && taskMotionOn}
      />
      {/*
       * 名字 + 浏览器标志（同一行）。
       *
       * 标志只在**本会话真的在跑浏览器操作**时出现（判据在调用方）。
       * title 里带工具名，悬停即可知道在用什么；点击切到那个窗口。
       */}
      <span className="kr-plain-head__name-row">
        <span className="kr-plain-head__name">Seeker</span>
        {browserOn && (
          <button
            type="button"
            className="kr-plain-head__browser"
            data-flash={flash ?? undefined}
            title={flash === 'fail'
              ? '没找到那个窗口（可能已经关掉了）'
              : `${browserFlagTitle(browserEntry)} · 点击切到窗口`}
            aria-label={`${browserFlagTitle(browserEntry)}，点击切到那个窗口`}
            onClick={onBrowserClick}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="6.25" />
              <path d="M1.75 8h12.5" />
              <path d="M8 1.75c1.7 1.8 2.6 3.9 2.6 6.25S9.7 12.45 8 14.25C6.3 12.45 5.4 10.35 5.4 8S6.3 3.55 8 1.75z" />
            </svg>
          </button>
        )}
      </span>
      {hasLine ? (
        <span className="kr-plain-head__act" data-status={line.status}>
          <span className="kr-plain-head__ic" aria-hidden>
            {renderIcon === undefined ? null : renderIcon(line.icon ?? 'bolt')}
          </span>
          {line.hideVerb !== true && (
            <span className="kr-plain-head__verb">{line.verb}</span>
          )}
          {line.detail !== undefined && line.detail !== '' && (
            <span className="kr-plain-head__detail">{line.detail}</span>
          )}
        </span>
      ) : (
        <span className="kr-plain-head__idle" data-thinking={thinking || undefined}>
          {idleLine}
        </span>
      )}

      {/*
       * 卡头右上角的两枚动作按钮（2026-10-25 从顶栏搬来）。
       *
       * stopPropagation：卡头整块可能是折叠热区，点齿轮不该顺带展开时间线。
       * 用真 button 而不是 span：键盘可达、自带 :active / :focus-visible。
       * id 沿用顶栏那版 —— e2e（test-settings-card / test-mail-drawer）按它找节点。
       *
       * ⚠ 这组按钮**只能渲染一处**（chrome=false 时不渲染）：它们带固定 id，而
       * 新对话页的 Hero 卡头是常驻 DOM（收起时只 display:none，节点还在）。两处
       * 同时渲染就会出现重复 id，getElementById 拿到隐藏的那个，表现为「齿轮在、
       * 点了没反应」。详见 SeekerHeadProps.chrome 的注释。
       */}
      {chrome && (
      <>
      {/*
       * 三枚按钮各自受功能开关控制：Git（view.git-status）、邮箱（view.mail）可以
       * 单独关掉，齿轮设置按钮（大盘设置）不属于这几个 id，保持常驻。
       * 关掉 Git 时连 SeekerGitStatus 的 15s 轮询与 GitRosterModal 一起摘掉——
       * 只藏按钮不卸载组件等于还在后台每 15 秒请求一次 /git-status。
       */}
      <div className="kr-plain-head__tools">
        {gitStatusOn && (
        <button
          type="button"
          id="kr-git-roster-btn"
          className="kr-plain-head__tool"
          title={gitDirtyRepoCount > 0 ? `工作区与自制插件 Git 大盘 · ${gitDirtyRepoCount} 个项目有未提交改动` : '工作区与自制插件 Git 大盘'}
          aria-label={gitDirtyRepoCount > 0 ? `工作区与自制插件 Git 大盘，${gitDirtyRepoCount} 个项目有未提交改动` : '工作区与自制插件 Git 大盘'}
          aria-expanded={gitRosterOpen}
          data-open={gitRosterOpen || undefined}
          data-dirty={gitDirtyRepoCount > 0 || undefined}
          onClick={(event) => {
            event.stopPropagation()
            gitRosterStore.toggle()
          }}
        >
          {/*
           * Git 分支图标（2026-10-29 按用户提供的图二替换原来的菱形 Logo）：
           * 两个节点 + 一条分支线，语义是「分支 / 提交历史」，与 Git 大盘入口一致。
           * 纯手写内联 SVG（仓库硬约束，禁止外部图标库）。
           */}
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" data-git-branch-icon="true">
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 8a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0-9a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
          </svg>
          {gitDirtyRepoCount > 0 && (
            <span className="kr-plain-head__badge" data-count={gitDirtyRepoCount} data-kind="git-dirty-repos" aria-hidden="true">
              {gitDirtyRepoCount > 99 ? '99+' : gitDirtyRepoCount}
            </span>
          )}
        </button>
        )}
        {mailOn && (
        <button
          type="button"
          id="kr-mail-btn"
          className="kr-plain-head__tool"
          title={unreadCount > 0 ? `邮箱 · ${unreadCount}${unreadHasMore ? '+' : ''} 封未读` : '邮箱'}
          aria-label={unreadCount > 0 ? `邮箱，${unreadCount}${unreadHasMore ? '+' : ''} 封未读` : '邮箱'}
          aria-expanded={mailOpen}
          data-open={mailOpen || undefined}
          data-unread={unreadCount > 0 || undefined}
          onClick={(event) => {
            event.stopPropagation()
            mailStore.toggle()
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.6" y="3.2" width="12.8" height="9.6" rx="1.6" />
            <path d="M2.2 4.4 8 8.6l5.8-4.2" />
          </svg>
          {unreadCount > 0 && (
            <span
              className="kr-plain-head__badge"
              data-count={unreadCount}
              data-kind="mail-unread"
              aria-hidden="true"
            >
              {unreadCount > 99 ? '99+' : unreadCount}{unreadHasMore && unreadCount <= 99 ? '+' : ''}
            </span>
          )}
        </button>
        )}
        <button
          type="button"
          id="kr-panel-settings-btn"
          className="kr-plain-head__tool"
          title="大盘设置"
          aria-label="大盘设置"
          aria-expanded={settingsOpen}
          data-open={settingsOpen || undefined}
          onClick={(event) => {
            event.stopPropagation()
            settingsStore.toggle()
          }}
        >
          {/*
           * 齿轮（2026-10-25 第二次修正形状）：**实心** 8 齿 + 中心圆孔。
           *
           * 前两版都不对：① 圆 + 八根发散线（那是太阳/辐条）；② 描边闭合 path
           * （16px 下描边细、齿形糊成一圈锯齿，用户反馈「有点丑」）。
           *
           * 现在用 fill + fill-rule:evenodd 一次画出「外齿廓 + 中心孔」—— 实心齿轮
           * 在小尺寸下比描边齿轮干净得多（描边在 14px 时线宽只剩 1px，齿的轮廓
           * 全靠反锯齿撑着）。尺寸也放大到 16px（原来 14px）。
           */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10.6 1.5h2.8a1 1 0 0 1 .99.86l.24 1.83a8.2 8.2 0 0 1 2.14 1.24l1.72-.7a1 1 0 0 1 1.24.42l1.4 2.42a1 1 0 0 1-.22 1.28l-1.4 1.2a8.2 8.2 0 0 1 0 2.47l1.4 1.2a1 1 0 0 1 .22 1.28l-1.4 2.42a1 1 0 0 1-1.24.42l-1.72-.7a8.2 8.2 0 0 1-2.14 1.24l-.24 1.83a1 1 0 0 1-.99.86h-2.8a1 1 0 0 1-.99-.86l-.24-1.83a8.2 8.2 0 0 1-2.14-1.24l-1.72.7a1 1 0 0 1-1.24-.42l-1.4-2.42a1 1 0 0 1 .22-1.28l1.4-1.2a8.2 8.2 0 0 1 0-2.47l-1.4-1.2a1 1 0 0 1-.22-1.28l1.4-2.42a1 1 0 0 1 1.24-.42l1.72.7a8.2 8.2 0 0 1 2.14-1.24l.24-1.83a1 1 0 0 1 .99-.86Zm1.4 6.9a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" />
          </svg>
        </button>
      </div>
      {gitStatusOn && <SeekerGitStatus sessionId={sessionId} cwd={resolvedCwd} />}
      {gitStatusOn && <GitRosterModal />}
      </>
      )}
    </div>
  )
}