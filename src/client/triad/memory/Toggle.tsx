/**
 * dsh-memory 注入相关开关（composer 输入框工具行左端，共两枚按钮两张卡）。
 *
 * 两枚按钮挨在一起，**各管各的**，卡片互不混装：
 *
 *  - 大脑按钮 → **记忆注入**卡：本会话注入（host state.json 里的显式覆盖）、
 *    默认开启（config.injectDefaultEnabled，决定新会话与未单独设置过的会话）。
 *    已单独设置过时显示「已单独设置」角标，可一键「跟随默认」清除覆盖。
 *  - 提示符按钮 → **内置提示词通道**卡：中文优先 / 交互卡片 / 灵魂人设 / 团队协作
 *    四条**注入通道**，外加一条**回合结束自动收口**——它一个字都不进 prompt，
 *    只管回合收尾时把残留的「进行中」任务项改回「未完成」，见 host 侧
 *    engine/todo-closure.ts。放在同一张卡里是因为它同属「插件内置、全局单值、
 *    无卸载入口」这一类能力，但它与注入无关这件事由 hint 文案说清。
 *    全部硬编码在插件内、无卸载入口（回包恒带 builtin），全局单值，不做会话级，
 *    也不受记忆注入的任何一道闸门约束——语言契约与人设必须跨会话恒定，否则同一用户
 *    会得到互相矛盾的回答语言。
 *    卡尾另有一行**总结卡外框**：它不是注入通道，一个字都不进 prompt，只管 Seeker
 *    对话流里那张总结卡要不要框和阴影（纯显示偏好，存 localStorage，见
 *    ../../reply-card-chrome.ts）。它与上面那几行刻意用一枚小组标题隔开——混在同一列
 *    里会让人以为「总结卡外框」也是往提示词里塞东西，而这正是本仓反复踩过的
 *    「两种不同的东西挤一张卡」的坑。因此按钮的开态只按**那四条注入通道**算，
 *    不含它，也不含自动收口——后者同样一个字都不进 prompt，只是同属「插件内置、
 *    全局单值、无卸载入口」这一类能力才并排放在同一张卡里。
 *
 * 两张卡曾经挤在一张里（「注入与记忆」）：那是把「提示词注入」与「记忆注入」两种
 * 不同的事塞给一个按钮，标题总有一半对不上，读者也要在无关的行之间来回跳。
 *
 * 两枚按钮的浮层交互完全同款（与 AI 浏览器 gate 一致）：
 *  - hover 进入立即展开，移出延迟 120ms 收起（跨按钮↔卡片间隙不闪）；
 *  - 悬停打开后点击 = 钉住（移开鼠标不收），再点或外点/Esc = 收起；
 *  - 卡片常驻 DOM，显隐走 CSS visibility 过渡（160ms 位移+淡入）。
 *
 * 状态全在 host，重启保留。写入一律乐观更新 + 失败回读：host 半身未重启时新
 * 路由不存在、写入会失败，UI 必须诚实地弹回真实状态，而不是挂一个假的「已开启」。
 */

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectStateView, MemoryApi } from './api.js'
import { BrainIcon } from './Panel.tsx'
import {
  replyCardChromeEnabled,
  setReplyCardChromeEnabled,
  subscribeReplyCardChrome,
} from '../../reply-card-chrome.js'
import {
  setToolCallsVisible,
  subscribeToolCallsVisible,
  toolCallsVisible,
} from '../../tool-calls-visible.js'
import { css, ensureStyles } from './styles.js'

/** 完整 props：composer 插槽 standardProps 的 sessionId + 注入 API 面 + locale。 */
export type MemoryToggleProps =
  { sessionId: string }
  & InjectFace<MemoryApi>
  & PropsLocale<'dshMemory'>

/** 悬停移出后的延迟收起（毫秒）：给鼠标跨过按钮↔卡片间隙留时间。 */
const HIDE_DELAY_MS = 120

/**
 * host 缺字段时的兜底形状：中文通道 / 灵魂 / html / 自动收口默认开（内置能力），
 * team 默认关（旧 host 没这个能力，显示「开」是假阳性）。
 *
 * 只在请求失败时用（正常路径由 host 回包决定）。html 的兜底取 true 与
 * config.htmlInjectDefaultEnabled 同口径——它默认开，请求失败时显示「关」会让
 * 用户以为能力没开。自动收口同此理：host 侧 config.todoClosureDefaultEnabled
 * 默认 true，兜底取 false 会让请求一失败就显示成关。
 */
const FALLBACK_STATE: InjectStateView = {
  enabled: true, defaultEnabled: true, explicit: false, zhEnabled: true, htmlEnabled: true, soulEnabled: true, teamEnabled: false, todoClosureEnabled: true,
}

/** 把 host 回包收敛成本地状态形状（缺字段按默认处理）。 */
function toState(res: InjectStateView): InjectStateView {
  return {
    enabled: res.enabled !== false,
    defaultEnabled: res.defaultEnabled !== false,
    explicit: res.explicit === true,
    // 缺字段按 true 兜底：中文通道是内置能力，默认就该开着。
    zhEnabled: res.zhEnabled !== false,
    // html 缺字段按 false 兜底：缺字段意味着旧 host 没这个能力——显示「关」
    // 比显示「开」诚实（显示开着却注不进去是假阳性）。
    htmlEnabled: res.htmlEnabled === true,
    // 灵魂与中文同口径：内置身份契约，缺字段按开。真正决定注不注得进去的是
    // soul.md 有没有内容（空灵魂不注入，由 host 注入器负责）。
    soulEnabled: res.soulEnabled !== false,
    // team 与 html 同口径：缺字段意味着旧 host 根本没这个能力，
    // 显示「关」比显示「开」诚实（开着却注不进去是假阳性）。
    teamEnabled: res.teamEnabled === true,
    // 自动收口与 zh / soul 同口径（**不是** html / team 那种）：它是默认开的
    // 通道，缺字段按开。写成 === true 的话，client 已更新、host 还没重启的那段
    // 窗口里开关会显示成关，host 一重启又跳成开。
    todoClosureEnabled: res.todoClosureEnabled !== false,
  }
}

/**
 * 两枚按钮共用的状态与写操作。
 *
 * `api` 每次渲染都是新对象，先固定引用再用：否则 effect 依赖 api 每帧变化，
 * 会重发 /inject-state（实测一分钟 498 次请求的请求风暴）。
 */
function useInjectState(api: InjectFace<MemoryApi>, sessionId: string) {
  const apiRef = useRef(api)
  apiRef.current = api
  const [state, setState] = useState<InjectStateView>(FALLBACK_STATE)
  const [busy, setBusy] = useState(false)

  const reload = useCallback((): void => {
    void apiRef.current.getInjectState(sessionId)
      .then(res => { setState(toState(res)) })
      .catch(() => { setState(FALLBACK_STATE) })
  }, [sessionId])

  useEffect(() => { reload() }, [reload])

  /**
   * 写单个内置通道（全局单值）。两者的形状完全同构，只有 setter 不同。
   *
   * 失败时回读而不是回滚：旧 host 静默丢弃写入时，回滚会让 UI 显示一个它并不
   * 具备的能力；回读拿到的是真实状态。
   */
  const pushChannel = useCallback((
    key: 'zhEnabled' | 'htmlEnabled' | 'soulEnabled' | 'teamEnabled' | 'todoClosureEnabled',
    next: boolean,
  ): void => {
    setBusy(true)
    setState(prev => ({ ...prev, [key]: next }))
    const write = key === 'zhEnabled'
      ? apiRef.current.setZhInjectState(next)
      : key === 'htmlEnabled'
        ? apiRef.current.setHtmlInjectState(next)
        : key === 'soulEnabled'
          ? apiRef.current.setSoulInjectState(next)
          : key === 'teamEnabled'
            ? apiRef.current.setTeamInjectState(next)
            : apiRef.current.setTodoClosureState(next)
    void write
      .then(res => {
        // 中文 / 灵魂 / 自动收口缺字段按开兜底（默认开的内置能力）；html / team
        // 缺字段按关兜底（旧 host 根本没有这个能力，显示「开」是假阳性）——
        // 与 toState 的口径逐条一致。
        const enabled = key === 'htmlEnabled' || key === 'teamEnabled' ? res.enabled === true : res.enabled !== false
        setState(prev => ({ ...prev, [key]: enabled }))
      })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [reload])

  /** 写会话级开关（null = 清除覆盖，回到默认）。 */
  const pushSession = useCallback((next: boolean | null): void => {
    setBusy(true)
    void apiRef.current.setInjectState(sessionId, next)
      .then(res => {
        setState(prev => ({
          enabled: res.enabled !== false,
          // 旧 host（未重启）不回 defaultEnabled / explicit 字段：缺字段时保留
          // 本地已知值，explicit 按本次动作推断，否则角标永远出不来。
          defaultEnabled: typeof res.defaultEnabled === 'boolean' ? res.defaultEnabled : prev.defaultEnabled,
          explicit: next === null ? false : (typeof res.explicit === 'boolean' ? res.explicit : true),
          // 同样要透传：这几个 setter 只该动自己的字段，写整个对象会把它抹掉。
          zhEnabled: typeof res.zhEnabled === 'boolean' ? res.zhEnabled : prev.zhEnabled,
          htmlEnabled: typeof res.htmlEnabled === 'boolean' ? res.htmlEnabled : prev.htmlEnabled,
          soulEnabled: typeof res.soulEnabled === 'boolean' ? res.soulEnabled : prev.soulEnabled,
          teamEnabled: typeof res.teamEnabled === 'boolean' ? res.teamEnabled : prev.teamEnabled,
          todoClosureEnabled: typeof res.todoClosureEnabled === 'boolean' ? res.todoClosureEnabled : prev.todoClosureEnabled,
        }))
      })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [sessionId, reload])

  /**
   * 写全局默认（config.injectDefaultEnabled），再回读会话态刷新按钮。
   *
   * 乐观更新：host 半身要重启 DSH 才认识这个键，旧进程会静默丢弃写入，
   * 回读于是把开关「弹回」原值，看着像按钮坏了。先按用户意图显示；host
   * 一旦回传该字段（新版）就以 host 为准。
   */
  const pushDefault = useCallback((next: boolean): void => {
    setBusy(true)
    setState(prev => ({ ...prev, defaultEnabled: next }))
    void apiRef.current.setConfig({ injectDefaultEnabled: next })
      .then(() => apiRef.current.getInjectState(sessionId))
      .then(res => {
        setState(prev => ({
          enabled: res.enabled !== false,
          defaultEnabled: typeof res.defaultEnabled === 'boolean' ? res.defaultEnabled : prev.defaultEnabled,
          explicit: typeof res.explicit === 'boolean' ? res.explicit : prev.explicit,
          zhEnabled: typeof res.zhEnabled === 'boolean' ? res.zhEnabled : prev.zhEnabled,
          htmlEnabled: typeof res.htmlEnabled === 'boolean' ? res.htmlEnabled : prev.htmlEnabled,
          soulEnabled: typeof res.soulEnabled === 'boolean' ? res.soulEnabled : prev.soulEnabled,
          teamEnabled: typeof res.teamEnabled === 'boolean' ? res.teamEnabled : prev.teamEnabled,
          todoClosureEnabled: typeof res.todoClosureEnabled === 'boolean' ? res.todoClosureEnabled : prev.todoClosureEnabled,
        }))
      })
      .catch(() => undefined)
      .finally(() => { setBusy(false) })
  }, [sessionId])

  return { state, busy, reload, pushChannel, pushSession, pushDefault }
}

/**
 * 悬停浮层：展开 / 钉住 / 延迟收起 / 外点与 Esc 关闭。
 *
 * 两枚按钮共用。`onShow` 在每次展开时刷新一次状态，展开看到的一定是最新值。
 */
function useHoverCard(onShow: () => void) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  // 钉住（点击后悬停移出也不收）。pinnedRef 供 120ms 收起计时器闭包读取，
  // 避免计时器读到调度时的过期值。
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned

  const showCard = useCallback((): void => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setOpen(true)
    onShow()
  }, [onShow])

  const scheduleCardHide = useCallback((): void => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      if (!pinnedRef.current) setOpen(false)
    }, HIDE_DELAY_MS)
  }, [])

  // 卸载时清掉未触发的收起计时器。
  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
  }, [])

  /** 点击按钮：悬停打开时 = 钉住（移开不收）；已钉住 = 收起。 */
  const togglePin = useCallback((): void => {
    setPinned(prev => {
      if (prev) { setOpen(false); return false }
      setOpen(true)
      return true
    })
  }, [])

  // 外点 / Esc → 收起并解除固定（卡片与按钮都在 wrap 内，wrap 内点击不算外点）。
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const node = event.target as Node | null
      if (node === null) return
      if (wrapRef.current?.contains(node) === true) return
      setOpen(false)
      setPinned(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setOpen(false); setPinned(false) }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return { wrapRef, open, showCard, scheduleCardHide, togglePin }
}

/**
 * 卡片里的一行开关：标签（可带角标 / 副说明）+ 右侧开关。
 *
 * 两张卡共用它，避免每行各写一遍几乎一样的 JSX。`lead` 标出该组第一行——
 * 它上方已经有分隔线时不再叠一条。
 */
function SwitchRow({
  label,
  on,
  busy,
  onToggle,
  lead = false,
  tag,
  hint,
  index,
}: {
  readonly label: string
  readonly on: boolean
  readonly busy: boolean
  readonly onToggle: () => void
  readonly lead?: boolean
  readonly tag?: string | undefined
  readonly hint?: string | undefined
  /** 行序号（0 起）：卡片展开时各行错开浮现，见 styles 里的 --row-i。 */
  readonly index?: number
}): JSX.Element {
  const classes = [css.injectRow]
  if (lead) classes.push(css.injectRowLead)
  if (on) classes.push(css.injectRowOn)
  return (
    <div
      className={classes.join(' ')}
      style={index === undefined ? undefined : ({ '--row-i': String(index) } as CSSProperties)}
    >
      <span className={css.injectMain}>
        <span className={css.injectLabel}>
          {label}
          {tag !== undefined && <span className={css.injectBadge}>{tag}</span>}
        </span>
        {hint !== undefined && <span className={css.injectHint}>{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        className={css.switch}
        onClick={onToggle}
      />
    </div>
  )
}

/** 注入开关的按钮本体（两枚共用）：中性黑白，主题自适应。 */
function ToggleButton({
  on,
  open,
  onClick,
  label,
  icon,
}: {
  readonly on: boolean
  readonly open: boolean
  readonly onClick: () => void
  readonly label: string
  readonly icon: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      className={on ? `${css.toggle} ${css.toggleOn}` : `${css.toggle} ${css.toggleOff}`}
      aria-label={label}
      aria-pressed={on}
      aria-expanded={open}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}

/** 提示符图标：内置提示词通道。 */
function PromptIcon({ size = 14 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2.4" />
      <path d="M4.4 6.2 6.5 8.2 4.4 10.2" />
      <path d="M8.6 10.4h3" />
    </svg>
  )
}

/** 渲染「记忆注入」开关按钮 + 悬浮卡片。 */
export function MemoryToggle({ sessionId, t, ...api }: MemoryToggleProps): JSX.Element {
  ensureStyles()
  const { state, busy, reload, pushSession, pushDefault } = useInjectState(api, sessionId)
  const { wrapRef, open, showCard, scheduleCardHide, togglePin } = useHoverCard(reload)

  const isOn = state.enabled !== false
  const isDefaultOn = state.defaultEnabled !== false
  const explicit = state.explicit === true
  const button = (
    <ToggleButton
      on={isOn}
      open={open}
      onClick={togglePin}
      label={isOn ? t('injectOn') : t('injectOff')}
      icon={<BrainIcon size={14} />}
    />
  )
  return (
    // 权限卡片展开期间不渲染 Tooltip：避免提示文字叠在卡片上（remount 无状态无感）。
    <div ref={wrapRef} className={css.toggleWrap} onMouseEnter={showCard} onMouseLeave={scheduleCardHide}>
      {open ? button : <Tooltip label={isOn ? t('injectOn') : t('injectOff')} side="top" delayMs={500}>{button}</Tooltip>}
      <div
        className={open ? `${css.injectCard} ${css.injectCardOn}` : css.injectCard}
        role="dialog"
        aria-label={t('injectCardTitle')}
        aria-hidden={!open}
      >
        <div className={css.injectHead}>
          <span className={css.injectTitle}><BrainIcon size={13} />{t('injectCardTitle')}</span>
          <span className={isOn ? `${css.injectTag} ${css.injectTagOn}` : `${css.injectTag} ${css.injectTagOff}`}>
            {isOn ? t('injectStateOn') : t('injectStateOff')}
          </span>
        </div>
        <SwitchRow
          index={0}
          lead
          on={isOn}
          busy={busy}
          label={t('injectThisSession')}
          tag={explicit ? t('injectOverrideTag') : undefined}
          onToggle={() => { pushSession(!isOn) }}
        />
        <SwitchRow
          index={1}
          on={isDefaultOn}
          busy={busy}
          label={t('injectDefaultOn')}
          hint={t('injectDefaultHint')}
          onToggle={() => { pushDefault(!isDefaultOn) }}
        />
        {explicit && (
          <button type="button" className={css.injectFollow} disabled={busy} onClick={() => { pushSession(null) }}>
            {t('injectFollowDefault')}
          </button>
        )}
        <p className={css.injectFoot}>{t('injectCardFoot')}</p>
      </div>
    </div>
  )
}

/** 渲染「内置提示词通道」开关按钮 + 悬浮卡片。 */
export function BuiltinToggle({ sessionId, t, ...api }: MemoryToggleProps): JSX.Element {
  ensureStyles()
  const { state, busy, reload, pushChannel } = useInjectState(api, sessionId)
  const { wrapRef, open, showCard, scheduleCardHide, togglePin } = useHoverCard(reload)

  const zhOn = state.zhEnabled !== false
  const htmlOn = state.htmlEnabled === true
  const soulOn = state.soulEnabled !== false
  const teamOn = state.teamEnabled === true
  // 自动收口与 zh / soul 同口径（默认开）：缺字段按开，别抄 html / team 的 === true。
  const todoClosureOn = state.todoClosureEnabled !== false
  /*
   * 总结卡外框：纯显示偏好，不走 host，状态在 localStorage（见 reply-card-chrome）。
   *
   * 用 useSyncExternalStore 而不是 useState：它必须与**别的浏览器窗口**里拨动的
   * 同一个开关保持一致（storage 事件会唤醒订阅），而 useState 只能看见本组件的
   * 那次点击。
   */
  const chromeOn = useSyncExternalStore(subscribeReplyCardChrome, replyCardChromeEnabled, replyCardChromeEnabled)
  // 工具调用卡显隐：与总结卡外框同族（纯呈现偏好、localStorage、跨窗口同步）。
  const toolCallsOn = useSyncExternalStore(subscribeToolCallsVisible, toolCallsVisible, toolCallsVisible)
  // 按钮状态取「这几条注入通道里有没有开的」——全关才算关，半开按开显示（它是
  // 能力入口，不是记忆那种一刀切的开关）。**不含总结卡外框**：那一行不是注入通道，
  // 把它算进来会让「通道全关、只想要无框卡片」的按钮显示成开着的入口。
  // **也不含自动收口**，同理：它一个字都不进 prompt，只是同属「插件内置、全局单值、
  // 无卸载入口」这一类能力才并排放在同一张卡里；算进来会让「四条通道全关、只留自动
  // 收口」的按钮显示成开着的入口，而用户点进去会发现注入其实一条都没开。
  const anyOn = zhOn || htmlOn || soulOn || teamOn
  const button = (
    <ToggleButton
      on={anyOn}
      open={open}
      onClick={togglePin}
      label={anyOn ? t('builtinToggleOn') : t('builtinToggleOff')}
      icon={<PromptIcon />}
    />
  )
  return (
    <div ref={wrapRef} className={css.toggleWrap} onMouseEnter={showCard} onMouseLeave={scheduleCardHide}>
      {open ? button : <Tooltip label={anyOn ? t('builtinToggleOn') : t('builtinToggleOff')} side="top" delayMs={500}>{button}</Tooltip>}
      <div
        className={open ? `${css.injectCard} ${css.builtinCard} ${css.injectCardOn}` : `${css.injectCard} ${css.builtinCard}`}
        role="dialog"
        aria-label={t('builtinCardTitle')}
        aria-hidden={!open}
      >
        <div className={css.injectHead}>
          <span className={css.injectTitle}><PromptIcon size={13} />{t('builtinCardTitle')}</span>
        </div>
        <SwitchRow
          index={0}
          lead
          on={zhOn}
          busy={busy}
          label={t('zhInjectLabel')}
          hint={t('zhInjectHint')}
          onToggle={() => { pushChannel('zhEnabled', !zhOn) }}
        />
        {/* HTML 卡片（含 iu 的 16 种原生卡：取值/图表/看板/图形三件套…）——
             「正文围栏 → 卡片」的呈现能力总开关；详细说明见 host 侧 HTML_INJECTION_RULE。 */}
        <SwitchRow
          index={1}
          on={htmlOn}
          busy={busy}
          label={t('htmlInjectLabel')}
          hint={t('htmlInjectHint')}
          onToggle={() => { pushChannel('htmlEnabled', !htmlOn) }}
        />
        {/* 灵魂：与中文同类的「跨会话恒定」契约，故与它们同卡；详细编辑在
            工作台 → 记忆 → 灵魂 Tab，这里只给一个总开关。 */}
        <SwitchRow
          index={2}
          on={soulOn}
          busy={busy}
          label={t('soulInjectLabel')}
          hint={t('soulInjectHint')}
          onToggle={() => { pushChannel('soulEnabled', !soulOn) }}
        />
        {/* 团队协作：默认「这活值得拆」的组织纪律（分档判据 + 组队硬规矩），
            跨会话恒定的行为契约，与灵魂同类放最后；文本见 host 侧 TEAM_INJECTION_RULE。 */}
        <SwitchRow
          index={3}
          on={teamOn}
          busy={busy}
          label={t('teamInjectLabel')}
          hint={t('teamInjectHint')}
          onToggle={() => { pushChannel('teamEnabled', !teamOn) }}
        />
        {/* 回合结束自动收口：不是注入通道（一个字都不进 prompt），只是同属「插件
            内置、全局单值、无卸载入口」这一类能力，所以并排放在同一张卡里。
            默认开（host 侧 config.todoClosureDefaultEnabled 默认 true）；关掉后
            回合结束时残留的「进行中」任务项保持原样。 */}
        <SwitchRow
          index={4}
          on={todoClosureOn}
          busy={busy}
          label={t('todoClosureLabel')}
          hint={t('todoClosureHint')}
          onToggle={() => { pushChannel('todoClosureEnabled', !todoClosureOn) }}
        />
        {/* 展示设置组：与上面那几行**不是一类东西**，所以另起一枚组标题隔开。
            不隔开的话，读者会以为「总结卡外框」也是往提示词里塞内容的能力，
            而它其实只管一张卡片长什么样。 */}
        <div className={css.injectGroup}>
          <span className={css.injectGroupTitle}>{t('displayGroupTitle')}</span>
        </div>
        <SwitchRow
          index={5}
          lead
          on={chromeOn}
          // busy 恒为 false：这一行写的是 localStorage（同步落盘 + 刷 body 属性），
          // 没有网络往返，不存在"正在保存"的中间态。上面几行要等 host 回包才有，
          // 所以它们共用那个 busy。写成 busy={busy} 会让这行在别的通道保存时
          // 莫名变灰、点不动。
          busy={false}
          label={t('replyChromeLabel')}
          hint={t('replyChromeHint')}
          onToggle={() => { setReplyCardChromeEnabled(!chromeOn) }}
        />
        <SwitchRow
          index={6}
          // 与总结卡外框同族：写 localStorage，同步落盘无网络往返，busy 恒 false。
          busy={false}
          on={toolCallsOn}
          label={t('toolCallsLabel')}
          hint={t('toolCallsHint')}
          onToggle={() => { setToolCallsVisible(!toolCallsOn) }}
        />
        <p className={css.injectFoot}>{t('builtinCardFoot')}</p>
      </div>
    </div>
  )
}
