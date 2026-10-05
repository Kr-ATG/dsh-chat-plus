/**
 * ModelSeat — 纯模型选择器，接管 `conversation.input.model` 座位。
 *
 * 相比 ui-model-selection 自带的 ModelSelect，这里去掉了「模型 / 推理等级」
 * 两级 root 菜单，改为：触发按钮直接弹出模型分组列表。推理等级由独立的
 * EffortSeat 单独弹出。数据与提交仍走同一个 per-session ModelDirectory，
 * 因此两个入口与 `/model` 弹窗状态互通。
 *
 * 视觉（紧凑、透明底、不发光）：触发按钮透明无框，hover / 打开只提亮文字；
 * 弹出层为静态实色面板，带 rise/sink 动效与标准层级投影。头部行展示当前供应商
 * （官方图标 + 名 + 模型数 + 刷新），左栏供应商图标导航（淡染选中 + 实心强调条），
 * 右栏模型行悬浮微移、选中行淡染 + 实心勾。（模型行不再展示「推理」星芒徽标：
 * 推理档位由右侧 EffortSeat 单独表达。）
 *
 * 选中模型时默认带上该模型支持的最高推理档位（pi-ai 的 `efforts` 按
 * off→max 升序返回，末项即最高档），避免无 defaultEffort 的模型切换后
 * 推理等级回落为「默认/关」；无推理元数据的模型保持不带 effort。
 */
import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconRefreshOutlineRegular,
  IconWarningOutlineRegular, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ProviderIcon } from '../webui/provider-icons'
import { PROVIDER_DATA_CHANGED } from '../webui/chat/ModelListEditor.tsx'
import type { ModelSeatInjected } from './types'
import { css, ensureStyles } from './styles'

export type ModelSeatProps = ModelSeatInjected

/**
 * 渲染 composer 模型选择器（仅模型列表，无推理等级）。
 * 注册在 `conversation.input.right`，位于供应商标签与推理等级之间。
 */
export function ModelSeat({ available, directory, load, select }: ModelSeatProps) {
  ensureStyles()
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  // 关闭动画态：先播下沉淡出（.13s），结束后再真正卸载面板（与推理等级一致）。
  const [closing, setClosing] = useState(false)
  const [providerId, setProviderId] = useState<string | null>(null)
  // 已停用模型集合（能力卡行内总开关写 /api/model-capabilities/snapshot 的 enabled）。
  // 取不到快照时 fail-open：不过滤，保证选择器永远可用。
  const [disabledKeys, setDisabledKeys] = useState<Set<string> | null>(null)
  /**
   * 重读停用快照。`available` 来自宿主按 (entry × binding) 缓存的 inject 结果，
   * 实际是常量——只把它当依赖，「运行中停用了模型」就永远看不到。所以另有
   * 两个触发点：面板每次打开、以及别的卡片改了能力开关后的广播。
   */
  const refreshDisabled = useCallback((): void => {
    if (!available) return
    let cancelled = false
    fetch('/api/model-capabilities/snapshot', { cache: 'no-store' })
      .then(r => r.json())
      .then((payload: any) => {
        if (cancelled) return
        if (!payload || payload.ok === false || !Array.isArray(payload.providers)) return
        const hidden = new Set<string>()
        for (const provider of payload.providers) {
          if (!provider || !Array.isArray(provider.models)) continue
          for (const model of provider.models) {
            if (model && model.enabled === false) hidden.add(`${provider.provider}/${model.id}`)
          }
        }
        setDisabledKeys(hidden)
      })
      .catch(() => { /* 快照不可达时不过滤 */ })
    return () => { cancelled = true }
  }, [available])
  useEffect(() => refreshDisabled(), [refreshDisabled])
  // 能力开关是别的卡片写的：模型编辑器勾完/取消后广播一次，这里跟着刷新。
  useEffect(() => {
    window.addEventListener('dsh-webui:model-capabilities-changed', refreshDisabled)
    return () => { window.removeEventListener('dsh-webui:model-capabilities-changed', refreshDisabled) }
  }, [refreshDisabled])
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  // hover 移出后的延迟关闭定时器（悬停交互，与提示词优化/推理等级一致）
  const hoverLeaveTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const id = useId()

  // 平铺所有模型（分组 + 模型），供选中判定与标题回显。
  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({ group, model }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.group.id === state.current?.provider && c.model.id === state.current.model)
  const currentChoice = choices[selectedIndex]
  const busy = state.status === 'selecting'

  // 可见分组：滤掉能力卡里已停用的模型（未取到快照时不过滤）。
  const visibleGroups = useMemo(() => {
    if (disabledKeys === null || disabledKeys.size === 0) return state.groups
    return state.groups
      .map(group => ({
        ...group,
        models: group.models.filter(model => !disabledKeys.has(`${group.id}/${model.id}`)),
      }))
      .filter(group => group.models.length > 0)
  }, [state.groups, disabledKeys])

  // 当前展示的供应商：用户显式选中的优先，否则跟随当前模型所在供应商，最后回退第一个。
  const activeGroup = useMemo(() => {
    if (visibleGroups.length === 0) return undefined
    const pid = providerId ?? state.current?.provider
    return visibleGroups.find(group => group.id === pid) ?? visibleGroups[0]
  }, [visibleGroups, providerId, state.current])

  const reload = (): void => { load() }

  // 挂载即加载；此后每次打开面板也会重读（见 showPanel），此处只保证首帧有目录。
  useEffect(() => {
    if (available) load()
  }, [available, load])

  // 供应商页保存/删除后的兜底广播：host 推送事件（settings/document-updated
  // 等）依赖 remote.mux 事件流，长会话里偶发丢帧——收到本窗口事件就强制重读
  // 目录，保证刚保存的模型立刻出现在选择器里。
  useEffect(() => {
    if (!available) return
    const reload = (): void => { load() }
    window.addEventListener(PROVIDER_DATA_CHANGED, reload)
    return () => { window.removeEventListener(PROVIDER_DATA_CHANGED, reload) }
  }, [available, load])

  // 卸载清理 hover 延迟关闭 / 滑出动画定时器。
  useEffect(() => () => {
    if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  if (!available) return null

  /** 带滑出动画的关闭：closing 期间重复调用被守卫忽略。 */
  const closeMenu = (): void => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setClosing(false)
      setOpen(false)
    }, 130)
  }

  /** 取消「移出后延迟关闭」的定时器。 */
  const cancelHoverHide = (): void => {
    if (hoverLeaveTimer.current !== null) {
      window.clearTimeout(hoverLeaveTimer.current)
      hoverLeaveTimer.current = null
    }
  }

  /** hover 进入按钮/菜单：立即显示并取消延迟关闭；滑出动画中则中断恢复。 */
  const showPanel = (): void => {
    cancelHoverHide()
    if (closing) {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      closeTimer.current = null
      setClosing(false)
    }
    // 仅从关到开时复位供应商选择；已在菜单内穿梭不打断用户点选。
    if (!open) setProviderId(null)
    setOpen(true)
    // 每次打开都重读两样东西：
    //  1) 停用快照 —— 刚在供应商页关掉的模型，这里立刻从列表消失；
    //  2) 模型目录 —— ModelCatalogDirectory.load() 在 ready 态直接返回缓存
    //     （宿主 catalog.load 的 ready 短路），load() 不会真的发请求；真正的
    //     刷新通道是 PROVIDER_DATA_CHANGED 广播（见上方 effect），其效果取
    //     决于事件流是否丢帧，那属于宿主目录行为，不在本插件可修范围。
    refreshDisabled()
    load()
  }

  /** hover 移出：延迟 0.08 秒再关闭，给用户时间从按钮移入菜单点选。 */
  const scheduleHide = (): void => {
    cancelHoverHide()
    hoverLeaveTimer.current = window.setTimeout(() => {
      hoverLeaveTimer.current = null
      closeMenu()
    }, 80)
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      closeMenu()
      return
    }
    void select(selection).then((accepted) => {
      if (accepted) {
        closeMenu()
        return
      }
      const message = directory.getSnapshot().error
      if (message !== null) {
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text: `模型切换失败：${message}` })
      }
    })
  }

  const modelLabel = currentChoice?.model.name ?? '选择模型'
  const loading = state.status === 'loading'

  return (
    <div ref={rootRef} className={css.msRoot}>
      <button
        ref={triggerRef}
        type="button"
        className={[css.msTrigger, open && !closing ? css.msTriggerOpen : ''].join(' ')}
        aria-label={`选择模型，当前 ${modelLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={modelLabel}
        onClick={() => { if (open && !closing) closeMenu(); else showPanel(); }}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleHide}
      >
        <span className={css.msTriggerLabel}>{modelLabel}</span>
        <IconChevronDownOutlineRegular size={14} className={[css.msChevron, open ? css.msChevronOpen : ''].join(' ')} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={[css.msMenu, closing ? css.msMenuOut : ''].join(' ')}
          role="menu"
          aria-label="选择模型"
          aria-busy={loading || busy}
          onMouseEnter={showPanel}
          onMouseLeave={scheduleHide}
        >
          {state.status === 'loading' && (
            <div className={css.msStatus}>正在刷新模型列表…</div>
          )}
          {state.error !== null && (
            <div className={css.msError}>
              <span>{state.error}</span>
              <button type="button" className={css.msRetry} onClick={reload}>重试</button>
            </div>
          )}
          {state.failures.map(failure => (
            <div className={css.msWarning} key={failure.id}>
              <span>{failure.name} 加载失败：{failure.message}</span>
              <button type="button" className={css.msRetry} onClick={reload}>重试</button>
            </div>
          ))}
          <div className={css.msHead}>
            <span className={css.msHeadTitle}>
              {activeGroup !== undefined ? (
                <ProviderIcon provider={activeGroup.id} name={activeGroup.name} size={16} />
              ) : null}
              {activeGroup?.name ?? '选择模型'}
            </span>
            <span className={css.msHeadRight}>
              {activeGroup !== undefined && (
                <span className={css.msCount}>{activeGroup.models.length} 模型</span>
              )}
              <button
                type="button"
                className={[css.msRefresh, loading ? css.msRefreshSpin : ''].join(' ')}
                aria-label="刷新模型列表"
                title="刷新模型列表"
                disabled={loading}
                onClick={reload}
              >
                <IconRefreshOutlineRegular size={14} />
              </button>
            </span>
          </div>
          <div className={css.msBody}>
            <div className={css.msProviders} role="tablist" aria-label="供应商">
              {visibleGroups.map((group) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeGroup?.id === group.id}
                  className={[css.msProvider, activeGroup?.id === group.id ? css.msProviderActive : ''].join(' ')}
                  key={group.id}
                  title={group.name}
                  onClick={() => { setProviderId(group.id) }}
                >
                  <span className={css.msProviderIcon}>
                    <ProviderIcon provider={group.id} name={group.name} size={15} />
                  </span>
                  {group.name}
                </button>
              ))}
            </div>
            <div
              className={`${css.msModels} scrollable`}
              role="tabpanel"
              aria-label={`${activeGroup?.name ?? ''} 的模型`}
            >
              {activeGroup?.models.map((model) => {
                const selected = state.current?.provider === activeGroup.id && state.current.model === model.id
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={[css.msOption, selected ? css.msSelected : ''].join(' ')}
                    key={model.id}
                    title={model.name}
                    disabled={busy}
                    onClick={() => {
                      // 默认推理等级 = 该模型支持的最高档位（efforts 升序末项），
                      // 让选完模型即落在最大档，而不是回到「默认/关」。
                      const efforts = model.reasoning?.efforts
                      const highestEffort = efforts !== undefined && efforts.length > 0
                        ? efforts[efforts.length - 1]!.id
                        : undefined
                      choose({
                        provider: activeGroup.id,
                        model: model.id,
                        ...(highestEffort === undefined ? {} : { reasoningEffort: highestEffort }),
                      })
                    }}
                  >
                    <span className={css.msOptionCopy}>
                      <span className={css.msOptionTop}>
                        <span className={css.msModelName}>{model.name}</span>
                      </span>
                      {model.description !== undefined && (
                        <span className={css.msDescription}>{model.description}</span>
                      )}
                    </span>
                    <span className={css.msCheck}>
                      {selected ? <IconCheckOutlineRegular size={16} /> : null}
                    </span>
                  </button>
                )
              })}
              {activeGroup !== undefined && activeGroup.models.length === 0 && (
                <div className={css.msEmpty}>该供应商暂无模型。</div>
              )}
            </div>
          </div>
          {state.status === 'ready' && choices.length === 0 && (
            <div className={css.msEmpty}>没有可用的模型。</div>
          )}
          {state.status === 'ready' && choices.length > 0 && visibleGroups.length === 0 && (
            <div className={css.msEmpty}>全部模型已在设置页停用（模型能力 → 行内总开关可恢复）。</div>
          )}
        </div>
      )}

      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular size={16} />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
