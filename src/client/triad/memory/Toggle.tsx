/**
 * dsh-memory 注入相关开关（composer 输入框工具行左端，共两枚按钮两张卡）。
 *
 * 两枚按钮挨在一起，**各管各的**，卡片互不混装：
 *
 *  - 大脑按钮 → **记忆注入**卡：本会话注入（host state.json 里的显式覆盖）、
 *    默认开启（config.injectDefaultEnabled，决定新会话与未单独设置过的会话）。
 *    已单独设置过时显示「已单独设置」角标，可一键「跟随默认」清除覆盖。
 *  - 提示符按钮 → **内置提示词通道**卡：中文优先 / 对话内流程图 / 过程播报。
 *    三条硬编码在插件内、无卸载入口（回包恒带 builtin），全局单值，不做会话级，
 *    也不受记忆注入的任何一道闸门约束——语言契约必须跨会话恒定，否则同一用户
 *    会得到互相矛盾的回答语言。
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectStateView, MemoryApi } from './api.js'
import { BrainIcon } from './Panel.tsx'
import { css, ensureStyles } from './styles.js'

/** 完整 props：composer 插槽 standardProps 的 sessionId + 注入 API 面 + locale。 */
export type MemoryToggleProps =
  { sessionId: string }
  & InjectFace<MemoryApi>
  & PropsLocale<'dshMemory'>

/** 悬停移出后的延迟收起（毫秒）：给鼠标跨过按钮↔卡片间隙留时间。 */
const HIDE_DELAY_MS = 120

/** host 缺字段时的兜底形状：中文通道默认开（内置能力），另两条默认关。 */
const FALLBACK_STATE: InjectStateView = {
  enabled: true, defaultEnabled: true, explicit: false, zhEnabled: true, diagramEnabled: false, plainEnabled: true,
}

/** 把 host 回包收敛成本地状态形状（缺字段按默认处理）。 */
function toState(res: InjectStateView): InjectStateView {
  return {
    enabled: res.enabled !== false,
    defaultEnabled: res.defaultEnabled !== false,
    explicit: res.explicit === true,
    // 缺字段按 true 兜底：中文通道是内置能力，默认就该开着。
    zhEnabled: res.zhEnabled !== false,
    // 缺字段按 false 兜底：diagram 通道默认关，且缺字段意味着旧 host 根本没
    // 这个能力——显示「关」比显示「开」诚实（显示开着却注不进去是假阳性）。
    diagramEnabled: res.diagramEnabled === true,
    // 缺字段按 false 兜底：这条通道的老 host 根本没有，卡片会退回「只按工具
    // 事实推导当前动作」。显示「关」比显示一个实际注入不上的「开」诚实。
    plainEnabled: res.plainEnabled === true,
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
   * 写单个内置通道（全局单值）。三者的形状完全同构，只有 setter 不同。
   *
   * 失败时回读而不是回滚：旧 host 静默丢弃写入时，回滚会让 UI 显示一个它并不
   * 具备的能力；回读拿到的是真实状态。
   */
  const pushChannel = useCallback((
    key: 'zhEnabled' | 'diagramEnabled' | 'plainEnabled',
    next: boolean,
  ): void => {
    setBusy(true)
    setState(prev => ({ ...prev, [key]: next }))
    const write = key === 'zhEnabled'
      ? apiRef.current.setZhInjectState(next)
      : key === 'diagramEnabled'
        ? apiRef.current.setDiagramInjectState(next)
        : apiRef.current.setPlainInjectState(next)
    void write
      .then(res => {
        // 中文通道缺字段按开兜底（内置能力），另两条缺字段按关兜底（旧 host 根本
        // 没有这个能力，显示「开」是假阳性）——与 toState 的口径一致。
        const enabled = key === 'zhEnabled' ? res.enabled !== false : res.enabled === true
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
          diagramEnabled: typeof res.diagramEnabled === 'boolean' ? res.diagramEnabled : prev.diagramEnabled,
          plainEnabled: typeof res.plainEnabled === 'boolean' ? res.plainEnabled : prev.plainEnabled,
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
          diagramEnabled: typeof res.diagramEnabled === 'boolean' ? res.diagramEnabled : prev.diagramEnabled,
          plainEnabled: typeof res.plainEnabled === 'boolean' ? res.plainEnabled : prev.plainEnabled,
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
}: {
  readonly label: string
  readonly on: boolean
  readonly busy: boolean
  readonly onToggle: () => void
  readonly lead?: boolean
  readonly tag?: string | undefined
  readonly hint?: string | undefined
}): JSX.Element {
  const classes = [css.injectRow]
  if (lead) classes.push(css.injectRowLead)
  if (on) classes.push(css.injectRowOn)
  return (
    <div className={classes.join(' ')}>
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
          lead
          on={isOn}
          busy={busy}
          label={t('injectThisSession')}
          tag={explicit ? t('injectOverrideTag') : undefined}
          onToggle={() => { pushSession(!isOn) }}
        />
        <SwitchRow
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
  const diagramOn = state.diagramEnabled === true
  const plainOn = state.plainEnabled === true
  // 按钮状态取「三条里有没有开的」——全关才算关，半开按开显示（它是能力入口，
  // 不是记忆那种一刀切的开关）。
  const anyOn = zhOn || diagramOn || plainOn
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
          lead
          on={zhOn}
          busy={busy}
          label={t('zhInjectLabel')}
          onToggle={() => { pushChannel('zhEnabled', !zhOn) }}
        />
        <SwitchRow
          on={diagramOn}
          busy={busy}
          label={t('diagramInjectLabel')}
          onToggle={() => { pushChannel('diagramEnabled', !diagramOn) }}
        />
        <SwitchRow
          on={plainOn}
          busy={busy}
          label={t('plainInjectLabel')}
          onToggle={() => { pushChannel('plainEnabled', !plainOn) }}
        />
        <p className={css.injectFoot}>{t('builtinCardFoot')}</p>
      </div>
    </div>
  )
}
