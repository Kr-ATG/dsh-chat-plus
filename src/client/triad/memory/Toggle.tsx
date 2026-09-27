/**
 * dsh-memory 注入开关（composer 输入框工具行左端）。
 *
 * 悬停大脑按钮弹出小卡片（与 AI 浏览器 gate 同款交互）：
 *  - hover 进入立即展开，移出延迟 120ms 收起（跨按钮↔卡片间隙不闪）；
 *  - 悬停打开后点击 = 钉住（移开鼠标不收），再点或外点/Esc = 收起；
 *  - 卡片常驻 DOM，显隐走 CSS visibility 过渡（160ms 位移+淡入）。
 * 卡片里三行开关，上面一行是内置通道，与下面两行零联动：
 *  - 中文记忆：内置能力，硬编码在插件内、无卸载入口（回包恒带 builtin）。
 *    不受本会话注入 / 默认开启 / 项目排除任何一道闸门约束——语言契约必须
 *    跨会话恒定，否则同一用户会得到互相矛盾的回答语言。全局单值，不做会话级。
 *  - 本会话注入：只影响当前会话（host state.json 里的显式覆盖）；
 *  - 默认开启：config.injectDefaultEnabled，决定新会话与未单独设置过的会话。
 * 会话单独设置过时显示「已单独设置」角标，并可一键「跟随默认」清除覆盖
 * （清除后该会话重新跟随默认值）。状态全在 host，重启保留。
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

/** 渲染注入开关按钮 + 悬浮卡片。 */
export function MemoryToggle({ sessionId, t, ...api }: MemoryToggleProps): JSX.Element {
  ensureStyles()
  // inject 每次渲染返回新 api 对象；固定引用，否则 effect 依赖 api 每次变化
  // 都会重发 /inject-state —— 实测一分钟 498 次请求（请求风暴，composer 每渲染
  // 一次就触发一轮）。与 Panel/Notify 的 apiRef 同款处理。
  const apiRef = useRef(api)
  apiRef.current = api
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | null>(null)
  const [state, setState] = useState<InjectStateView>({ enabled: true, defaultEnabled: true, explicit: false, zhEnabled: true, diagramEnabled: false, plainEnabled: true })
  const [open, setOpen] = useState(false)
  // 钉住（点击后悬停移出也不收）。pinnedRef 供 120ms 收起计时器闭包读取，
  // 避免计时器读到调度时的过期值。
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned
  const [busy, setBusy] = useState(false)

  const reload = useCallback((): void => {
    void apiRef.current.getInjectState(sessionId)
      .then(res => { setState(toState(res)) })
      .catch(() => { setState({ enabled: true, defaultEnabled: true, explicit: false, zhEnabled: true, diagramEnabled: false, plainEnabled: true }) })
  }, [sessionId])

  useEffect(() => { reload() }, [reload])

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

  /**
   * 写中文记忆内置通道开关（全局单值，与上面两个开关零联动）。
   *
   * 乐观更新 + 失败回读，与 pushDefault 同款：host 半数未重启时新路由不存在，
   * 写入会失败，此时 UI 应当诚实地弹回真实状态，而不是显示一个假的「已开启」。
   */
  const pushZh = useCallback((next: boolean): void => {
    setBusy(true)
    setState(prev => ({ ...prev, zhEnabled: next }))
    void apiRef.current.setZhInjectState(next)
      .then(res => { setState(prev => ({ ...prev, zhEnabled: res.enabled !== false })) })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [reload])

  /**
   * 写对话内流程图规范通道开关（全局单值，与上面三个开关零联动）。
   *
   * 乐观更新 + 失败回读，与 pushZh 同款：host 半身未重启时新路由不存在，
   * 写入会失败，此时 UI 必须诚实地弹回真实状态，而不是挂一个假的「已开启」。
   */
  const pushDiagram = useCallback((next: boolean): void => {
    setBusy(true)
    setState(prev => ({ ...prev, diagramEnabled: next }))
    void apiRef.current.setDiagramInjectState(next)
      .then(res => { setState(prev => ({ ...prev, diagramEnabled: res.enabled === true })) })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [reload])

  /**
   * 写执行过程播报通道开关（全局单值，与上面四个开关零联动）。
   *
   * 与 pushDiagram 完全同款：乐观更新 + 失败回读。host 半身未重启时新路由
   * 不存在、写入会失败，UI 必须诚实地弹回真实状态，而不是挂一个假的「已开启」。
   */
  const pushPlain = useCallback((next: boolean): void => {
    setBusy(true)
    setState(prev => ({ ...prev, plainEnabled: next }))
    void apiRef.current.setPlainInjectState(next)
      .then(res => { setState(prev => ({ ...prev, plainEnabled: res.enabled === true })) })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [reload])

  /** hover 进入按钮/卡片：立即展开并取消收起计时，顺带刷新最新开关状态。 */
  const showCard = useCallback((): void => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setOpen(true)
    reload()
  }, [reload])

  /** hover 移出：延迟 0.12 秒再收起，给鼠标跨过按钮↔卡片间隙留时间。 */
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

  const isOn = state.enabled !== false
  const isDefaultOn = state.defaultEnabled !== false
  const explicit = state.explicit === true
  // 中文通道独立于上面三个，纯读自己的字段。
  const zhOn = state.zhEnabled !== false
  const diagramOn = state.diagramEnabled === true
  const plainOn = state.plainEnabled !== false
  const button = (
    <button
      type="button"
      className={isOn ? `${css.toggle} ${css.toggleOn}` : `${css.toggle} ${css.toggleOff}`}
      aria-label={isOn ? t('injectOn') : t('injectOff')}
      aria-pressed={isOn}
      aria-expanded={open}
      onClick={togglePin}
    >
      <BrainIcon size={14} />
    </button>
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
        <div className={zhOn ? `${css.zhRow} ${css.zhRowOn}` : css.zhRow}>
          <span className={css.zhMain}>
            <span className={css.zhLabel}>
              {t('zhInjectLabel')}
              <span className={css.zhBuiltin}>{t('zhInjectBuiltin')}</span>
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={zhOn}
            aria-label={t('zhInjectLabel')}
            disabled={busy}
            className={css.switch}
            onClick={() => { pushZh(!zhOn) }}
          />
        </div>
        <div className={css.injectDivider} />
        <div className={diagramOn ? `${css.zhRow} ${css.zhRowOn}` : css.zhRow}>
          <span className={css.zhMain}>
            <span className={css.zhLabel}>
              {t('diagramInjectLabel')}
              <span className={css.zhBuiltin}>{t('diagramInjectBuiltin')}</span>
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={diagramOn}
            aria-label={t('diagramInjectLabel')}
            disabled={busy}
            className={css.switch}
            onClick={() => { pushDiagram(!diagramOn) }}
          />
        </div>
        <div className={css.injectDivider} />
        <div className={plainOn ? `${css.zhRow} ${css.zhRowOn}` : css.zhRow}>
          <span className={css.zhMain}>
            <span className={css.zhLabel}>
              {t('plainInjectLabel')}
              <span className={css.zhBuiltin}>{t('plainInjectBuiltin')}</span>
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={plainOn}
            aria-label={t('plainInjectLabel')}
            disabled={busy}
            className={css.switch}
            onClick={() => { pushPlain(!plainOn) }}
          />
        </div>
        <div className={css.injectDivider} />
        <div className={css.injectRow}>
          <span className={css.injectMain}>
            <span className={css.injectLabel}>
              {t('injectThisSession')}
              {explicit && <span className={css.injectBadge}>{t('injectOverrideTag')}</span>}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            aria-label={t('injectThisSession')}
            disabled={busy}
            className={css.switch}
            onClick={() => { pushSession(!isOn) }}
          />
        </div>
        <div className={css.injectRow}>
          <span className={css.injectMain}>
            <span className={css.injectLabel}>{t('injectDefaultOn')}</span>
            <span className={css.injectHint}>{t('injectDefaultHint')}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isDefaultOn}
            aria-label={t('injectDefaultOn')}
            disabled={busy}
            className={css.switch}
            onClick={() => { pushDefault(!isDefaultOn) }}
          />
        </div>
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
