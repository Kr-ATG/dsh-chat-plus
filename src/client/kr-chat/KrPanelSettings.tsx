/**
 * dsh-chat-plus — Seeker 右栏大盘的「大盘设置」抽屉（从右侧滑入的面板）。
 *
 * 为什么存在：这些开关原先分散在两处 —— composer 输入框那枚「内置提示词通道」悬浮卡
 * （triad/memory/Toggle.tsx 的 BuiltinToggle）与邮箱工作台设置页。用户真正要拨它们的
 * 时刻，多半是盯着右栏大盘干活的时候：手得离开大盘、回到输入框、hover 展开、拨完再
 * 回来。于是把它们收敛成一张抽屉挂在右栏，composer 那张重复的卡整块删除。
 *
 * **入口不在本组件里**：齿轮按钮由 kr-chat-controller 以裸 DOM 注入顶栏标签行、
 * 紧邻 Seeker 标签（用户点名要求的位置）。本组件只负责抽屉本体，开合读
 * `panel-settings-store`。两者分处不同的 React 根（一个是裸 DOM 按钮、一个是
 * createRoot 挂的树），props 传不过去，所以走共享 store 而不是组件内 state ——
 * 这是本文件相对上一版最大的结构变化（上一版齿轮与抽屉同在一个组件里）。
 *
 * 数据口径：6 条注入通道走 `/api/dsh-memory/*`，3 条外观偏好是 localStorage；归一化
 * 复用 Toggle.tsx 导出的 `normalizeInjectState` / `FALLBACK_INJECT_STATE`，不另写一套。
 * 踩过的坑：两处各写一份兜底口径（谁按 `!== false`、谁按 `=== true`）的结果，是同一个
 * 开关在两处显示成两个值 —— 用户会以为其中一个坏了，而两边读的是同一份 host 状态。
 *
 * 为什么分两组：「提示词通道」那几条真的会改注入文本（回合结束自动收口除外，见下），
 * 「展示」那三条一个字都不进 prompt、只改本机观感。混在一列里，读者会以为「总结卡外框」
 * 也是往提示词里塞东西 —— 这正是本仓反复踩过的「两种不同的东西挤一张卡」的坑。
 * 自动收口（回合结束把残留的 in_progress 改回 pending）同属「插件内置、全局单值、无
 * 卸载入口」这一类能力，才并排放在注入组里；它一个字都不进 prompt 这件事由 hint 讲清。
 * 别把它挪进展示组：展示组是纯客户端 localStorage，而它走 host。
 *
 * 为什么 DOM 常驻：`data-open` 是**唯一**开合判据，可见性交给 CSS 的
 * visibility / opacity / pointer-events。写成 `{open && <div/>}` 的话，关闭时元素直接从
 * DOM 里消失，退场动画（滑出 + 淡出）根本没有机会播 —— 用户看到的是「啪」一下不见。
 * 代价是抽屉里的按钮始终在 DOM 里，靠 CSS 的 `visibility: hidden` 把它们移出 tab 序列
 * （visibility 隐藏的元素不可聚焦，这是 CSS 自带的，不需要额外 tabIndex）。
 *
 * 为什么两块根节点都内联 `position: absolute`：本组件渲染在 `.kr-split__side`
 * （display:flex; flex-direction:column）内部，任何 static 定位的子节点都会成为一根
 * flex 项、把大盘撑高。这里只兜底「脱离文档流」这一件事，坐标 / 尺寸 / 动效全部归
 * styles.ts —— 内联只写与 CSS 同值的 position，不抢布局决策。
 */

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createMemoryApi, type InjectStateView } from '../triad/memory/api.js'
import { FALLBACK_INJECT_STATE, normalizeInjectState } from '../triad/memory/Toggle.js'
import { replyCardChromeEnabled, setReplyCardChromeEnabled, subscribeReplyCardChrome } from '../reply-card-chrome.js'
import { setToolCallsVisible, subscribeToolCallsVisible, toolCallsVisible } from '../tool-calls-visible.js'
import { setPlainTimelineVisible, subscribePlainTimelineVisible, plainTimelineVisible } from '../plain-timeline-visible.js'
import { getPanelSettingsStore } from './panel-settings-store.js'

/**
 * 模块级单例，不是每次渲染新建。
 *
 * `createMemoryApi()` 每次调用都返回一个新对象；若写在组件里，任何以它为依赖的 effect
 * 每帧都会重跑（Toggle.tsx 为此专门用 ref 固定引用 —— 那边实测过一分钟 498 次请求的
 * 请求风暴）。提到模块级是从根上避免这件事，也让下面的 reload 只依赖 sessionId。
 */
const api = createMemoryApi()

export interface KrPanelSettingsProps {
  /** 当前会话 id（host 的 /inject-state 要它；null 时传空串）。 */
  readonly sessionId?: string | null
}

/**
 * 大盘设置抽屉：遮罩 + 抽屉本体。开合状态来自共享 store（顶栏齿轮按钮 toggle 它）。
 *
 * 对外只认一个 `sessionId`：抽屉里 6 条 host 通道的读取要带上它，好让 host 回传
 * 「本会话」的那份状态。
 */
export function KrPanelSettings({ sessionId }: KrPanelSettingsProps): JSX.Element {
  const sessionKey = sessionId ?? ''
  const store = getPanelSettingsStore()
  /*
   * 开合走 useSyncExternalStore 而不是 useState：状态由**组件外**的顶栏按钮写，
   * 且那份 store 跨 bundle 实例共享。useState + 自定义事件也能做，但事件会丢
   * （按钮先于抽屉挂载时那一次 toggle 没人接），而订阅式读值天然幂等。
   */
  const open = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.open,
    () => store.open,
  )
  const [state, setState] = useState<InjectStateView>(FALLBACK_INJECT_STATE)
  const [busy, setBusy] = useState(false)

  /** 回读整份状态；失败按兜底形状（与 composer 卡同一份兜底，不另写）。 */
  const reload = useCallback((): void => {
    void api.getInjectState(sessionKey)
      .then(res => { setState(normalizeInjectState(res)) })
      .catch(() => { setState(FALLBACK_INJECT_STATE) })
  }, [sessionKey])

  /**
   * 会话切换 → 关掉抽屉 + 立刻重读；抽屉打开 → 重读一次。
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
      return
    }
    if (open) reload()
  }, [sessionKey, open, reload, store])

  /**
   * Esc 关闭：监听只在打开期间挂。
   *
   * 不常驻监听 —— 抽屉没开时，Esc 属于页面上别的东西（官方弹层、输入框取消等），
   * 抢过来关一个看不见的抽屉是纯干扰。cleanup 同时负责组件卸载时摘干净。
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
    key: 'zhEnabled' | 'htmlEnabled' | 'soulEnabled' | 'teamEnabled' | 'todoClosureEnabled',
    next: boolean,
  ): void => {
    setBusy(true)
    setState(prev => ({ ...prev, [key]: next }))
    const write = key === 'zhEnabled'
      ? api.setZhInjectState(next)
      : key === 'htmlEnabled'
        ? api.setHtmlInjectState(next)
        : key === 'soulEnabled'
          ? api.setSoulInjectState(next)
          : key === 'teamEnabled'
            ? api.setTeamInjectState(next)
            : api.setTodoClosureState(next)
    void write
      .then(res => {
        // 中文 / 灵魂 / 自动收口缺字段按开兜底（默认开的内置能力）；html / team 缺字段按
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

  const zhOn = state.zhEnabled !== false
  const htmlOn = state.htmlEnabled === true
  const soulOn = state.soulEnabled !== false
  const teamOn = state.teamEnabled === true
  // 自动收口与 zh / soul 同口径（默认开）：缺字段按开，别抄 html / team 的 === true。
  const todoClosureOn = state.todoClosureEnabled !== false
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

  return (
    <>
      {/* 遮罩：点它关闭。纯装饰，键盘用户走 Esc 与关闭按钮，故 aria-hidden 恒为 true。
          齿轮触发按钮**不在这里** —— 它由 kr-chat-controller 注入顶栏标签行、
          紧邻 Seeker 标签（用户点名要求的位置），通过 panel-settings-store 与本抽屉联动。 */}
      <div
        className="kr-settings__scrim"
        data-open={open ? 'true' : 'false'}
        aria-hidden="true"
        onClick={() => { store.setOpen(false) }}
        style={{ position: 'absolute' }}
      />

      <div
        className="kr-settings"
        data-open={open ? 'true' : 'false'}
        role="dialog"
        aria-label="大盘设置"
        aria-hidden={!open}
        style={{ position: 'absolute' }}
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
              label="灵魂人设"
              hint="名字、语气与行为准则，跨会话恒定"
              on={soulOn}
              busy={busy}
              onToggle={() => { pushChannel('soulEnabled', !soulOn) }}
            />
            <SettingsRow
              index={3}
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
                  index={4}
                  label="Agent 邮箱"
                  hint={mailHint}
                  on={mailOn}
                  busy={busy}
                  onToggle={() => { pushMail(!mailOn) }}
                />
              )
              : (
                <SettingsRow
                  index={4}
                  label="Agent 邮箱"
                  hint={mailHint}
                  tag="不可用"
                />
              )}
            <SettingsRow
              index={5}
              label="回合结束自动收口"
              hint="回合结束时把残留的「进行中」任务项改回「未完成」，右栏任务卡不再挂着没收尾的项。它不改提示词，只动任务清单的状态。"
              on={todoClosureOn}
              busy={busy}
              onToggle={() => { pushChannel('todoClosureEnabled', !todoClosureOn) }}
            />
          </div>

          {/* 展示组：与上面那几条**不是一类东西**，所以另起一枚组标题隔开。 */}
          <div className="kr-settings__group">
            <span className="kr-settings__group-title">展示</span>
            <SettingsRow
              index={6}
              lead
              label="总结卡外框"
              hint="关掉后 Seeker 对话流的总结卡不留边框与阴影，退回纯正文。只改外观；全局所有会话生效，随本机浏览器持久保存（刷新 / 重启 DSH 后仍在）。"
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
              hint="关掉后 Seeker 右栏不再显示技术向的「工具调用」台账（默认 5 行滚动窗口那张）；人话行动流不受影响。只改外观；全局所有会话生效，随本机浏览器持久保存（刷新 / 重启 DSH 后仍在）。"
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
              hint="关掉后 Seeker 右栏不再显示那张中文人话行动流（把工具调用翻译成「打开携程 · 机票」的卡）；工具调用台账与其余卡片不受影响。只改外观；全局所有会话生效，随本机浏览器持久保存（刷新 / 重启 DSH 后仍在）。"
              on={plainTimelineOn}
              // 同族第三条：localStorage 同步落盘，busy 恒 false。
              busy={false}
              onToggle={() => { setPlainTimelineVisible(!plainTimelineOn) }}
            />
          </div>
        </div>

        <p className="kr-settings__foot">硬编码在插件内、无卸载入口；全局单值，不受记忆注入开关影响。</p>
      </div>
    </>
  )
}

/**
 * 抽屉里的一行：左侧标签（可带角标）+ 副说明，右侧开关。
 *
 * `on` 省略 = 这一行**不给开关**（邮箱模块没挂时那种「拨不动的开关」）。
 * `lead` 标出该组第一行：上方已经有组标题，不再叠一条分隔虚线。
 * `index` 是全局行序号（0 起），供 CSS 用 `--row-i` 做错开浮现。
 */
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
        {hint !== undefined && <span className="kr-settings__hint">{hint}</span>}
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

/** 齿轮图标：抽屉标题用（顶栏那枚触发按钮在 kr-chat-controller 里以裸 DOM 注入，
 *  它自带一份同形状的 SVG 字符串 —— 那边不是 React 树，拿不到这个组件）。 */
function GearIcon({ size = 15 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.7v1.7M8 12.6v1.7M1.7 8h1.7M12.6 8h1.7M3.55 3.55l1.2 1.2M11.25 11.25l1.2 1.2M12.45 3.55l-1.2 1.2M4.75 11.25l-1.2 1.2" />
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
