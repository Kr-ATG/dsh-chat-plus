/**
 * dsh-chat-plus — 「Seeker 卡头」（鲸鱼娘 + 名字 + 一行当前状态 + 右上角两枚动作）。
 *
 * ## 为什么单独抽出来
 *
 * 2026-10-25 用户要求：「新对话页面的上面放上我们这个东西」—— 新对话（空白 Hero
 * 态）也要有这张卡头，让用户在发第一条消息之前就能看到"她在这儿"。
 *
 * 但卡头不能复制两份：它包含立绘、浏览器标志、按钟点轮换的空闲文案、齿轮与邮箱
 * 两枚动作按钮（还带着 e2e 依赖的 id）。两份必然分叉 —— 改一处忘了另一处，
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

import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { WhalePortrait } from './WhalePortrait.tsx'
import { activateBrowserWindow } from '../browser-flag/activate.ts'
import { browserFlagTitle, type BrowserActivitySession } from '../browser-flag/store.ts'
import { getPanelSettingsStore } from './panel-settings-store.ts'
import { getMailDrawerStore } from './mail-drawer-store.ts'

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
  /** 立绘动画开关（系统「减少动态效果」时为 false）。 */
  readonly motion?: boolean
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
    line = null,
    idleLine,
    thinking = false,
    browserEntry,
    browserOn = false,
    onClick,
    expanded,
    renderIcon,
    className,
  } = props

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

  /*
   * 点浏览器标志 → 把那个窗口拉到前台（2026-10-25 用户要求）。
   *
   * 候选进程名从活动条目的 service/tool 推：ego-browser 背后的桌面进程是 ego，
   * playwright-mcp 背后通常是 chrome。推不出来时退到 'ego'（用户的默认场景）。
   * 服务端按序试，第一个成功的赢。
   *
   * 失败静默：点一下没反应，比弹一个"窗口激活失败"的错误好 —— 这枚图标本来就
   * 只是个便利入口。
   */
  const busyRef = useRef(false)
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
    void activateBrowserWindow(candidates).finally(() => {
      // 给一点冷却：连点会把同一个窗口反复拽到前台（观感上像在抖）。
      window.setTimeout(() => { busyRef.current = false }, 600)
    })
  }, [browserEntry])

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
      <WhalePortrait size={92} motion={motion} />
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
            title={`${browserFlagTitle(browserEntry)} · 点击切到窗口`}
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
       */}
      <div className="kr-plain-head__tools">
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
        <button
          type="button"
          id="kr-mail-btn"
          className="kr-plain-head__tool"
          title="邮箱"
          aria-label="邮箱"
          aria-expanded={mailOpen}
          data-open={mailOpen || undefined}
          onClick={(event) => {
            event.stopPropagation()
            mailStore.toggle()
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.6" y="3.2" width="12.8" height="9.6" rx="1.6" />
            <path d="M2.2 4.4 8 8.6l5.8-4.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}