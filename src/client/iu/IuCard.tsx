/**
 * dsh-chat-plus — iu 原生交互卡片（iu 围栏的渲染器 / 外壳）。
 *
 * 与 HtmlCard 的差异只在载体：这里是原生 React 组件（无 iframe、无沙箱），
 * 状态在本地 + localStorage 持久化，主题与动效跟随宿主。安全上没有新边界：
 * 所有渲染都是宿主自己的 DOM，不执行模型给的代码。
 *
 * ## 外壳只做四件事（kind 的差异全在 registry / bodies 里）
 *
 *  1. **Head**：标题 + 角标（角标文案读 registry 的 label，两处渲染同源）；
 *  2. **状态容器**：按围栏内容哈希做持久化 key（见 state.ts），把 state/setState
 *     注入 Body——Body 自己不持有 useState，刷新页面状态不丢；
 *  3. **Body 路由**：按 spec.kind 从 bodies.ts 取 React 体渲染（未知 kind → 不渲染）；
 *  4. **FillRow**：「填入输入框」，文案来自 registry 的 fillText(spec, state)。
 *
 * 新增一个 kind **不需要碰本文件**：只要它注册进 registry.ts（纯逻辑）与
 * bodies.ts（React 体），外壳自动接住。这正是老结构「一个 kind 改四处」的解药。
 *
 * ## 字号轴
 *
 * 基座 CSS（styles.ts）在 .dtt-iu 上定义 --iu-text-scale = 官方正文字号 / 14，
 * 各 kind 的字号写 calc(Npx * var(--iu-text-scale,1))，于是卡片文字跟随官方
 * 「设置 → 字号」无级缩放，不需要 JS 监听。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { IuSpecBase } from './kinds/contract.ts'
import type { IuState } from './kinds/contract.ts'
import { iuKindOf } from './kinds/registry.ts'
import { IU_BODIES } from './kinds/bodies.ts'
import { iuStateKey, readIuState, writeIuState } from './state.ts'
import {
  IU_ZOOM_DEFAULT, nextIuZoom, readIuFullscreen, readIuZoom, writeIuFullscreen, writeIuZoom,
  type IuZoom,
} from './prefs.ts'

/** 图标：全屏（四角外扩）。 */
function ExpandIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2.4H2.4V6" />
      <path d="M10 13.6h3.6V10" />
      <path d="M13.6 6V2.4H10" />
      <path d="M2.4 10v3.6H6" />
    </svg>
  )
}

/** 填入输入框的回调（父组件用 inputActions.setDraft 实现，拿不到时回退剪贴板）。 */
export type IuFillFn = (text: string) => boolean

// ── 向后兼容的回写文案 wrapper ────────────────────────────────────────────
// 历史上这些函数从本文件导出、smoke 直接断言其文案。重构后 fillText 收敛到各
// kind 模块（签名 (spec, state)），这里保留旧签名的薄 wrapper：把标量/Set/数组
// 入参转成对应 kind 的 state 形状，再委派 registry。公开 API 与 smoke 断言零改动。

/** slider：旧签名 (spec, value)。 */
export function sliderFillText(spec: unknown, value: number): string {
  return callFill('slider', spec, { value })
}
/** checklist：旧签名 (spec, Set<下标>)。 */
export function checklistFillText(spec: unknown, checked: ReadonlySet<number>): string {
  return callFill('checklist', spec, { checked: [...checked].sort((a, b) => a - b) })
}
/** tabs：旧签名 (spec, 活动页下标)。 */
export function tabsFillText(spec: unknown, active: number): string {
  return callFill('tabs', spec, { active })
}
/** piano：旧签名 (spec, 弹过的音名数组)。 */
export function pianoFillText(spec: unknown, played: readonly string[]): string {
  return callFill('piano', spec, { played })
}

function callFill(kind: string, spec: unknown, state: IuState): string {
  const mod = iuKindOf(kind)
  if (mod === undefined || typeof spec !== 'object' || spec === null) return ''
  // spec 已是宽松对象；fillText 内部只读它认的字段，缺字段自有兜底。
  return mod.fillText(spec as never, state as never)
}

/** 卡片动作按钮（全屏 / 缩放）。`fs` 态下不渲染全屏按钮（已在全屏里）。 */
function CardActions({ zoom, onZoom, onFullscreen }: {
  readonly zoom: IuZoom
  readonly onZoom: () => void
  readonly onFullscreen?: (() => void) | undefined
}): JSX.Element {
  return (
    <span className="dtt-iu__acts">
      <button
        type="button"
        className={zoom === IU_ZOOM_DEFAULT ? 'dtt-iu__act' : 'dtt-iu__act dtt-iu__act--on'}
        title={`缩放：${Math.round(zoom * 100)}%（点击切下一档）`}
        aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击切换`}
        onClick={onZoom}
      >
        {Math.round(zoom * 100)}%
      </button>
      {onFullscreen !== undefined && (
        <button
          type="button"
          className="dtt-iu__act"
          title="全屏"
          aria-label="全屏查看"
          onClick={onFullscreen}
        >
          <ExpandIcon />
        </button>
      )}
    </span>
  )
}

function Head({ title, tag, actions }: {
  readonly title: string
  readonly tag: string
  readonly actions?: JSX.Element | undefined
}): JSX.Element {
  return (
    <div className="dtt-iu__head">
      <span className="dtt-iu__dot" aria-hidden />
      <span className="dtt-iu__title">{title}</span>
      <span className="dtt-iu__tag">{tag}</span>
      {actions}
    </div>
  )
}

function FillRow({ onFill, text }: { readonly onFill?: IuFillFn | undefined; readonly text: () => string }): JSX.Element | null {
  const [done, setDone] = useState(false)
  if (onFill === undefined) return null
  return (
    <div className="dtt-iu__foot">
      <button
        type="button"
        className={done ? 'dtt-iu__fill dtt-iu__fill--done' : 'dtt-iu__fill'}
        onClick={() => {
          const ok = onFill(text())
          if (ok) {
            setDone(true)
            window.setTimeout(() => { setDone(false) }, 1600)
          }
        }}
      >
        {done ? '已填入 ✓' : '填入输入框'}
      </button>
    </div>
  )
}

function pendingStage(bytes: number): JSX.Element {
  return (
    <div className="dtt-iu__stage--pending" aria-busy="true" aria-live="polite">
      <div className="dtt-iu__pending">
        <span className="dtt-iu__pending-dot" />
        <span className="dtt-iu__pending-text">正在生成交互卡片…</span>
      </div>
      <div className="dtt-iu__pending-track"><span className="dtt-iu__pending-bar" /></div>
      <span className="dtt-iu__pending-text">{bytes} 字</span>
    </div>
  )
}

/** 持久化写入的节流窗口（拖动滑块会高频 setState，逐次写会拖慢主线程）。 */
const PERSIST_DEBOUNCE = 400

/**
 * iu 原生交互卡片外壳。
 *
 * pending 只在流式期出现（半截 JSON 不渲染）；非法 spec 由 parse 层挡掉，
 * 这里收到的一定是合法结构。未知 kind（registry/bodies 查不到）→ 不渲染，
 * 与老实现「不认识就交给 markdown」语义一致（那种围栏根本到不了这里）。
 */
export const IuCard = memo(function IuCard({ spec, pending = false, bytes = 0, onFill }: {
  readonly spec?: IuSpecBase | undefined
  readonly pending?: boolean
  readonly bytes?: number
  readonly onFill?: IuFillFn | undefined
}): JSX.Element | null {
  if (pending || spec === undefined) {
    return (
      <figure className="dtt-iu dtt-iu--pending">
        {pendingStage(bytes)}
      </figure>
    )
  }
  // hooks 必须在任何提前 return 之后仍保持稳定调用——但 pending 分支不触发任何
  // hook（它在 hooks 之前 return）。为遵守 hooks 规则，把真正的有状态渲染拆到
  // 子组件 IuCardLive：pending 走无 hook 的静态分支，定稿走 IuCardLive。
  return <IuCardLive spec={spec} onFill={onFill} />
})

/**
 * 定稿卡片的有状态渲染（拆出来是为了让 pending 分支不触发 hooks）。
 *
 * 持久化 key = 围栏内容（spec）的稳定哈希：内容一样就是同一张卡（跨刷新、
 * 跨重渲染恢复状态），内容变了就是新卡（不会把旧状态错套到新数据上）。
 */
function IuCardLive({ spec, onFill }: {
  readonly spec: IuSpecBase
  readonly onFill?: IuFillFn | undefined
}): JSX.Element | null {
  const mod = useMemo(() => iuKindOf(spec.kind), [spec.kind])
  const bodyMod = useMemo(() => IU_BODIES.get(spec.kind), [spec.kind])
  // spec 是 parse 产出的纯数据对象，JSON.stringify 顺序稳定 → 哈希稳定。
  const stateKey = useMemo(() => iuStateKey(JSON.stringify(spec)), [spec])

  const [state, setStateRaw] = useState<IuState>(() => {
    if (mod === undefined) return {}
    const base = mod.initState(spec as never) as IuState
    // 合并持久化状态：以 base 为底，覆盖上存过的字段（脏字段由各 kind 的
    // Body/fillText 自行容错；这里只做浅合并，不深校验）。
    const stored = readIuState(stateKey)
    return stored === undefined ? base : { ...base, ...stored }
  })

  // stateKey 变化（同一位置内容被替换）→ 重新初始化，别把旧卡状态留给新卡。
  const prevKey = useRef(stateKey)
  useEffect(() => {
    if (prevKey.current === stateKey) return
    prevKey.current = stateKey
    if (mod === undefined) return
    const base = mod.initState(spec as never) as IuState
    const stored = readIuState(stateKey)
    setStateRaw(stored === undefined ? base : { ...base, ...stored })
  }, [stateKey, mod, spec])

  // 持久化：跟随 state 变化，节流写（卸载时 flush 掉最后一笔）。
  const timerRef = useRef<number | null>(null)
  const latestRef = useRef(state)
  latestRef.current = state
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      writeIuState(stateKey, latestRef.current)
    }, PERSIST_DEBOUNCE)
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
        writeIuState(stateKey, latestRef.current)
      }
    }
  }, [state, stateKey])

  const setState = useCallback((patch: Partial<IuState> | ((prev: IuState) => Partial<IuState>)): void => {
    setStateRaw((prev) => {
      const p = typeof patch === 'function' ? patch(prev) : patch
      return { ...prev, ...p }
    })
  }, [])

  /*
   * 全屏与缩放：两项都是**纯呈现偏好**，走 localStorage（见 prefs.ts 头注释）。
   *
   * 全屏层复用同一份 `state` / `setState` —— 内嵌卡与全屏卡同时挂载、共享状态，
   * 在全屏里拖看板、勾清单，退出全屏后内嵌卡立刻是同一个结果（不需要任何同步代码）。
   */
  const [zoom, setZoom] = useState<IuZoom>(() => readIuZoom())
  const [fullscreen, setFullscreen] = useState<boolean>(() => readIuFullscreen())

  const cycleZoom = useCallback((): void => {
    setZoom((prev) => {
      const next = nextIuZoom(prev)
      writeIuZoom(next)
      return next
    })
  }, [])

  const enterFullscreen = useCallback((): void => {
    setFullscreen(true)
    writeIuFullscreen(true)
  }, [])

  const exitFullscreen = useCallback((): void => {
    setFullscreen(false)
    writeIuFullscreen(false)
  }, [])

  // 全屏时锁背景滚动，Esc 退出（与 html 卡片同款交互）。
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') exitFullscreen()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [fullscreen, exitFullscreen])

  if (mod === undefined || bodyMod === undefined) return null
  const Body = bodyMod.Body
  /** 缩放经 CSS 变量下发（基座把 --iu-zoom 乘进 --iu-text-scale，全 kind 跟随）。 */
  const style = { '--iu-zoom': String(zoom) } as CSSProperties
  const bodyNode = (
    <Body spec={spec as never} state={state} setState={setState} onFill={onFill} />
  )
  return (
    <>
      <figure className="dtt-iu" style={style}>
        <Head
          title={spec.title}
          tag={mod.label}
          actions={<CardActions zoom={zoom} onZoom={cycleZoom} onFullscreen={enterFullscreen} />}
        />
        {bodyNode}
        <FillRow onFill={onFill} text={() => mod.fillText(spec as never, state as never)} />
      </figure>
      {fullscreen && typeof document !== 'undefined' && createPortal(
        <div className="dtt-iu-fs" role="dialog" aria-modal="true" aria-label={spec.title}>
          <div className="dtt-iu-fs__bar">
            <span className="dtt-iu-fs__title">{spec.title}</span>
            <span className="dtt-iu-fs__acts">
              <button
                type="button"
                className="dtt-iu-fs__btn"
                title={`缩放：${Math.round(zoom * 100)}%（点击切下一档）`}
                onClick={cycleZoom}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="dtt-iu-fs__btn"
                title="关闭（Esc）"
                onClick={exitFullscreen}
              >
                关闭
              </button>
            </span>
          </div>
          <div className="dtt-iu-fs__stage">
            {/* 全屏里再渲染一份卡片：与内嵌卡共享 state，改一边两边同步。 */}
            <figure className="dtt-iu dtt-iu--fs" style={style}>
              <Head title={spec.title} tag={mod.label} />
              {bodyNode}
              <FillRow onFill={onFill} text={() => mod.fillText(spec as never, state as never)} />
            </figure>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
