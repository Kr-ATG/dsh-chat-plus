/**
 * dsh-memory 记忆注入开关（composer 输入框工具行左端的一枚按钮一张卡）。
 *
 * 大脑按钮 → **记忆注入**卡：本会话注入（host state.json 里的显式覆盖）、
 * 默认开启（config.injectDefaultEnabled，决定新会话与未单独设置过的会话）。
 * 已单独设置过时显示「已单独设置」角标，可一键「跟随默认」清除覆盖。
 *
 * 历史上这里还有第二枚按钮（提示符图标 → **内置提示词通道**卡：中文优先 / 交互
 * 卡片 / 团队协作 / 邮箱 / 自动收口 + 展示组三条）。2026-10-15 用户
 * 要求「对话框的给删了，并把设置放到 Seeker 旁边」，那张卡**整块删除**，内容迁到
 * Seeker 右栏的「大盘设置」抽屉（kr-chat/KrPanelSettings.tsx），入口是顶栏
 * Seeker 标签右侧那枚齿轮（由 kr-chat-controller 注入）。**因此本文件不再导出
 * BuiltinToggle**；它的归一化口径（normalizeInjectState / FALLBACK_INJECT_STATE）
 * 仍被那个抽屉复用，故保留导出。
 *
 * 浮层交互（与 AI 浏览器 gate 一致）：
 *  - hover 进入立即展开，移出延迟 120ms 收起（跨按钮↔卡片间隙不闪）；
 *  - 悬停打开后点击 = 钉住（移开鼠标不收），再点或外点/Esc = 收起；
 *  - 卡片常驻 DOM，显隐走 CSS visibility 过渡（160ms 位移+淡入）。
 *
 * 状态全在 host，重启保留。写入一律乐观更新 + 失败回读：host 半身未重启时新
 * 路由不存在、写入会失败，UI 必须诚实地弹回真实状态，而不是挂一个假的「已开启」。
 */

import type { CSSProperties } from 'react'
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

/**
 * host 缺字段时的兜底形状：中文通道 / html / 自动收口默认开（内置能力），
 * team 默认关（旧 host 没这个能力，显示「开」是假阳性）。
 *
 * 只在请求失败时用（正常路径由 host 回包决定）。html 的兜底取 true 与
 * config.htmlInjectDefaultEnabled 同口径——它默认开，请求失败时显示「关」会让
 * 用户以为能力没开。自动收口同此理：host 侧 config.todoClosureDefaultEnabled
 * 默认 true，兜底取 false 会让请求一失败就显示成关。
 *
 * 邮箱（mail*）四个字段一律按「不可用」兜底：它是跨模块能力，旧 host 不回
 * 这些字段，猜一个值出来只会误导。
 *
 * 工作区三个字段（project*）一律按 null 兜底：null 是「不知道/不适用」，
 * 而这三个字段的唯一消费者（大盘设置抽屉那行「工作区项目记忆记录」）正是靠
 * null 决定**不渲染开关**。兜底成 true/false 会让它在拿不到工作区时凭空长出一个
 * 拨了没用的开关 —— 拨不动的开关是骗人。
 */
export const FALLBACK_INJECT_STATE: InjectStateView = {
  enabled: true, defaultEnabled: true, explicit: false, zhEnabled: true, htmlEnabled: true, teamEnabled: false, todoClosureEnabled: true,
  mailEnabled: false, mailAvailable: false, mailWorkbenchEnabled: false, mailToolsMounted: false, mailAuthorized: false, mailAddress: null,
  projectHash: null, projectPath: null, projectMemoryEnabled: null,
}

/**
 * 把 host 回包收敛成本地状态形状（缺字段按默认处理）。
 *
 * **导出**：Seeker 右栏的「大盘设置」抽屉（kr-chat/KrPanelSettings.tsx）读同一份
 * `/inject-state` 回包，必须复用这一套逐字段兜底口径。各写一份的结果是「同一个
 * 开关在 composer 卡与大盘抽屉里显示成两个值」——而这两处的差异全部来自
 * 「谁按 !== false 兜底、谁按 === true 兜底」，正是本文件反复注释的那类假阳性。
 */
export function normalizeInjectState(res: InjectStateView): InjectStateView {
  return {
    enabled: res.enabled !== false,
    defaultEnabled: res.defaultEnabled !== false,
    explicit: res.explicit === true,
    // 缺字段按 true 兜底：中文通道是内置能力，默认就该开着。
    zhEnabled: res.zhEnabled !== false,
    // html 缺字段按 false 兜底：缺字段意味着旧 host 没这个能力——显示「关」
    // 比显示「开」诚实（显示开着却注不进去是假阳性）。
    htmlEnabled: res.htmlEnabled === true,
    // team 与 html 同口径：缺字段意味着旧 host 根本没这个能力，
    // 显示「关」比显示「开」诚实（开着却注不进去是假阳性）。
    teamEnabled: res.teamEnabled === true,
    // 自动收口与 zh 同口径（**不是** html / team 那种）：它是默认开的
    // 通道，缺字段按开。写成 === true 的话，client 已更新、host 还没重启的那段
    // 窗口里开关会显示成关，host 一重启又跳成开。
    todoClosureEnabled: res.todoClosureEnabled !== false,
    // 邮箱字段全是「缺字段即不可用/关」：跨模块回传，旧 host 没有。
    mailEnabled: res.mailEnabled === true,
    mailAvailable: res.mailAvailable === true,
    mailWorkbenchEnabled: res.mailWorkbenchEnabled === true,
    mailToolsMounted: res.mailToolsMounted === true,
    mailAuthorized: res.mailAuthorized === true,
    mailAddress: typeof res.mailAddress === 'string' ? res.mailAddress : null,
    /*
     * 工作区三字段与上面所有通道**刻意不同口径**：这里 null 是一个有意义的值
     * （「不知道 / 不适用」），不是缺失兜底。
     *
     *  - projectMemoryEnabled：只有真 boolean 才认，其余（undefined / null /
     *    字符串 / 数字）一律收敛成 null。旧 host 不回该字段 → null → UI 不渲染
     *    开关。照 `!== false` 兜底会让「host 还没落地新契约」的那段窗口里凭空
     *    长出一个显示为「开」的开关，而它拨不动也存不下 —— 正是本仓反复强调的
     *    「拨不动的开关是骗人」。
     *  - projectHash / projectPath：只有非空字符串才认，否则 null（空串是
     *    「没有工作区」的另一种写法，收敛成同一个值，调用方只判 null 一处）。
     */
    projectMemoryEnabled: typeof res.projectMemoryEnabled === 'boolean' ? res.projectMemoryEnabled : null,
    projectHash: typeof res.projectHash === 'string' && res.projectHash !== '' ? res.projectHash : null,
    projectPath: typeof res.projectPath === 'string' && res.projectPath !== '' ? res.projectPath : null,
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
  const [state, setState] = useState<InjectStateView>(FALLBACK_INJECT_STATE)
  const [busy, setBusy] = useState(false)

  const reload = useCallback((): void => {
    void apiRef.current.getInjectState(sessionId)
      .then(res => { setState(normalizeInjectState(res)) })
      .catch(() => { setState(FALLBACK_INJECT_STATE) })
  }, [sessionId])

  useEffect(() => { reload() }, [reload])

  /*
   * 历史注记：这里原有 pushChannel / pushMail 两个写入口，专供 BuiltinToggle
   * （「内置提示词通道」卡）用。2026-10-15 那张卡整块删除、开关迁到 Seeker 右栏的
   * 大盘设置抽屉后，这两个写入口**整体搬到 KrPanelSettings.tsx**（那边的实现与这里
   * 逐字同构：乐观更新 + 失败回读 + 同一套缺字段兜底口径），本文件不再保留副本 ——
   * 留一份没人调的写入逻辑，下次改口径就会漏改一处，正是本仓反复踩过的坑。
   */

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
          teamEnabled: typeof res.teamEnabled === 'boolean' ? res.teamEnabled : prev.teamEnabled,
          todoClosureEnabled: typeof res.todoClosureEnabled === 'boolean' ? res.todoClosureEnabled : prev.todoClosureEnabled,
        }))
      })
      .catch(() => undefined)
      .finally(() => { setBusy(false) })
  }, [sessionId])

  return { state, busy, reload, pushSession, pushDefault }
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
 * 记忆注入卡的两行共用它。`lead` 标出该组第一行——它上方已经有分隔线时不再叠一条。
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
