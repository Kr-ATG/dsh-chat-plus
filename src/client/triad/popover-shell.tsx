/**
 * popover-shell — 面板外壳（三个工作台页 + 用量卡片共用）。
 *
 * 两种形态：
 *  - page（默认，能力 / 记忆 / 邮箱用）：**不 portal**，直接铺满官方 `main`
 *    槽位（`[data-slot="main"]` 是 `display:contents`，本根就是 centerCol 的
 *    直接 flex item），与官方「自动化任务」页同座位、同尺寸、同层级。
 *    入场只有 140ms 的 opacity 淡入——刻意不用 transform（动画的 transform 会
 *    把本根变成后代 `position:fixed` 元素（图表 tooltip）的包含块，浮层会整体
 *    偏移），也不用 mask：切页跟点会话是一回事，没有"对话框"语义。
 *  - compact（用量用）：贴入口弹出的定尺寸小卡片，按 size 内联宽高并夹紧在
 *    视口内，配一层透明遮罩吃掉卡片外的点击；portal 到 body（卡片不能留在
 *    侧边栏那棵由本插件手工插入的裸节点里）。
 *  - compact 在窄屏回退全屏 sheet（translateY(24px) 上滑，带遮罩）。
 *  - Esc 关闭走 props.onClose（面板可自行拦截）。
 *
 * z 层级：mask 999 / card 1000——与 ui-primitives Modal 的 root(1000) 同层，
 * 面板内部的 primitives 二级弹窗（如技能文件查看器）portal 到 body 更靠后，
 * DOM 顺序取胜浮于本壳之上。
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MODAL_ANIM_MS, modalDrawerAnimClass } from './triad-modal-animation.js'

const STYLE_ID = 'dsh-popover-shell-styles'

/** 会话主区左缘回退值（px）：侧栏实测失败时按 280 起算。 */
const FALLBACK_MAIN_LEFT = 280
/** 窄屏阈值（px）：低于该宽度 compact 回退全屏 sheet（与移动端全屏媒体查询同值）。 */
const NARROW_VP = 768

/** 读会话主区左缘 = 侧栏列右缘（跟随侧栏折叠变化；失败回退 280）。 */
function readMainLeft(): number {
  try {
    const host = document.getElementById('dsh-triad-nav-host')
    if (host !== null) {
      const hostRight = host.getBoundingClientRect().right
      let node = host.parentElement
      while (node !== null && node !== document.body) {
        const rect = node.getBoundingClientRect()
        if (rect.height >= window.innerHeight * 0.7 && rect.left <= 8 && rect.right >= hostRight - 4) {
          return Math.round(rect.right)
        }
        node = node.parentElement
      }
    }
  } catch { /* 量不到就回退固定值 */ }
  return FALLBACK_MAIN_LEFT
}

const SHEET = `
/* ── page：官方 main 槽位里的整页视图（与自动化任务页同座位） ── */
.psh-page{position:relative;flex:1 1 auto;width:100%;min-width:0;height:100%;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#eee);animation:dsh-psh-page-in 140ms ease-out}
@keyframes dsh-psh-page-in{from{opacity:0}to{opacity:1}}
/* ── 遮罩：淡入淡出（compact 卡片用透明遮罩，只吃点击不遮视野） ── */
.psh-mask{position:fixed;inset:0;z-index:999;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.psh-mask[data-plain]{background:transparent}
.psh-mask[data-anim='in']{animation:dsh-modal-mask-in ${MODAL_ANIM_MS}ms ease both}
.psh-mask[data-anim='out']{animation:dsh-modal-mask-out ${MODAL_ANIM_MS}ms ease both}
/* ── 卡片：compact 定尺寸小卡片 / 底部 sheet 回退 ── */
.psh-card{position:fixed;z-index:1000;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden;transition:width ${MODAL_ANIM_MS}ms cubic-bezier(.2,.8,.2,1),height ${MODAL_ANIM_MS}ms cubic-bezier(.2,.8,.2,1)}
/* compact：贴入口弹出的小卡片。宽高与位置由组件内联给（已按视口夹紧），这里
   只需撤掉尺寸过渡（改视口时即时跟随，别拖动画）。 */
.psh-card[data-mode='compact']{right:auto;bottom:auto;max-height:none;transition:none}
.psh-card[data-mode='compact'][data-anim='in']{animation:dsh-psh-pop-in 200ms cubic-bezier(.2,.8,.2,1)}
.psh-card[data-mode='compact'][data-anim='out']{animation:dsh-psh-pop-out 180ms cubic-bezier(.4,0,.2,1) both}
@keyframes dsh-psh-pop-in{from{opacity:0;transform:translateY(10px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dsh-psh-pop-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(6px) scale(.985)}}
.psh-card[data-mode='compact'][data-anim='in'] .dsh-modal-stagger{animation:dsh-modal-rise-in ${MODAL_ANIM_MS}ms cubic-bezier(.2,.8,.2,1) backwards;animation-delay:60ms}
.psh-card[data-mode='sheet']{left:12px !important;right:12px;bottom:12px;top:auto !important}
/* 实底卡片（solid 模式）：玻璃质感开启时也保持不透明表面。
   两条必要条件——
   1) 底色必须用 static token（bg-layer-* 等 alias 在玻璃模式下被
      overrideTokens 换成 rgba，用它们仍然透）；
   2) 选择器需带 html[data-dsh-glass] 前缀以压过 glass.ts 里
      「插件自绘面板一律 transparent」那条规则（同特异性靠顺序取胜不可靠）。 */
.psh-card[data-solid],html[data-dsh-glass] .psh-card[data-solid]{
  background:var(--dsw-static-neutral-bluish-00,#fff);
  backdrop-filter:none;-webkit-backdrop-filter:none}
body[data-ds-dark-theme] .psh-card[data-solid],
html[data-dsh-glass] body[data-ds-dark-theme] .psh-card[data-solid]{
  background:var(--dsw-static-neutral-bluish-850,#2c2c2e)}
.psh-card[data-mode='sheet'][data-anim='in']{animation:dsh-modal-slide-in ${MODAL_ANIM_MS}ms cubic-bezier(.2,.8,.2,1)}
.psh-card[data-mode='sheet'][data-anim='out']{animation:dsh-modal-slide-out ${MODAL_ANIM_MS}ms cubic-bezier(.4,0,.2,1) both}
/* ── 通用卡片头部：标题 + 关闭（对齐 auto-card-head 规格）── */
.psh-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.psh-title{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.psh-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.psh-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
/* 卡片主体滚动区 */
.psh-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
/* ── 移动端：compact 强制全屏 sheet（100vw / 100dvh，radius 0）。
     参考 tool-summary .dts__modal 的 767.98px 写法；!important 压过组件内联
     left/top/width/height。page 形态本来就是铺满 main，无需适配。
     transform:none 仅作静态兜底，滑入/滑出动画的 keyframe transform 仍优先播放；
     本块注释内容未写出「星号紧跟正斜杠」两字符序列。 ── */
@media (max-width: 767.98px){
  .psh-card{
    left:0 !important;
    top:0 !important;
    right:auto !important;
    bottom:auto !important;
    width:100vw !important;
    max-width:100vw !important;
    height:100vh !important;
    height:100dvh !important;
    max-height:100vh !important;
    max-height:100dvh !important;
    border-radius:0 !important;
    transform:none !important;
  }
}
@media (prefers-reduced-motion:reduce){
  .psh-page,.psh-mask,.psh-card{animation:none!important}
  .psh-card{transition:none!important}
}
`

/** 注入外壳样式（幂等）。 */
export function ensureShellStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-triad'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 锚点：入口按钮右缘 + 顶缘的视口坐标（getBoundingClientRect 系）。 */
export interface PopoverAnchor {
  left: number
  top: number
}

/** 理想尺寸（px）。 */
export interface PopoverSize {
  width: number
  /** compact 卡片的高度上限。 */
  height?: number
  fill?: boolean
}

/** 面板形态：page = 铺满官方 main 槽位的整页视图；compact = 贴入口的小卡片。 */
export type PopoverVariant = 'page' | 'compact'

/** PopoverShell 属性。 */
export interface PopoverShellProps {
  /** 正在播放收回动画（仅 compact 有意义：此时仍挂载，播 out 动画）。 */
  closing?: boolean
  /** 请求关闭（遮罩点击 / Esc / 关闭钮统一走这里；page 形态=切回会话）。 */
  onClose: () => void
  /** 入口锚点（compact 卡片据此定位；page 形态忽略）。 */
  anchor?: PopoverAnchor | null
  /** compact 理想宽度。 */
  width?: number
  /** 理想尺寸（compact 卡片按此内联宽高）。 */
  size?: PopoverSize
  /** 形态：默认 page 铺满 main 槽位；compact 为贴入口弹出的定尺寸小卡片。 */
  variant?: PopoverVariant
  /** 鼠标进入卡片（compact hover 模式：取消自动收回）。 */
  onCardMouseEnter?: () => void
  /** 鼠标离开卡片（compact hover 模式：启动自动收回计时）。 */
  onCardMouseLeave?: () => void
  /** 无障碍名（page 的 region 名 / compact 的 dialog 名）。 */
  ariaLabel: string
  /** 兼容保留：page 形态下底色已由官方 token 承担，该值不再生效。 */
  solid?: boolean
  children: ReactNode
}

/**
 * 渲染面板。
 *
 * page 形态直接返回根元素（不 portal）——它必须留在官方 main 槽位里才能拿到
 * centerCol 的 flex 布局、窗口标题栏内距与右栏让位；portal 到 body 就又变成
 * 浮层了。compact 形态 portal 到 body：卡片不能留在入口所在的 DOM 子树里
 * （入口 portal 进侧边栏导航槽，而槽位宿主是手工插进 DSH 自有 React 树的裸
 * 节点，侧边栏任何一次重渲染都可能连带回收它，且 position:fixed 会被侧边栏
 * 的 transform 祖先变成局部定位）。
 */
export function PopoverShell({
  closing = false, onClose, anchor = null, width = 560, size, variant = 'page', onCardMouseEnter, onCardMouseLeave, ariaLabel, solid = false, children,
}: PopoverShellProps): JSX.Element {
  // 视口宽高 + 会话主区左缘走 state：窗口缩放/侧栏折叠时实时跟随。
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [mainLeft, setMainLeft] = useState(readMainLeft)
  const page = variant === 'page'
  useEffect(() => {
    if (page) return undefined
    const reread = (): void => {
      setVp({ w: window.innerWidth, h: window.innerHeight })
      setMainLeft(readMainLeft())
    }
    reread()
    window.addEventListener('resize', reread)
    const observer = new MutationObserver(reread)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-sidebar-collapsed'], subtree: true })
    const timer = window.setInterval(reread, 1500)
    return () => {
      window.removeEventListener('resize', reread)
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [page])
  const vw = vp.w
  const anim = closing ? 'out' : 'in'
  // 窄屏回退全屏 sheet；桌面端 compact 走定尺寸小卡片。
  const narrow = vw < NARROW_VP
  const compact = variant === 'compact' && !narrow
  const mode = narrow ? 'sheet' : 'compact'
  const style: CSSProperties | undefined = compact
    ? ((): CSSProperties => {
      // 卡片贴着侧栏右缘 + 12px；宽高取理想值并夹在「主区宽 - 24」「视口高 - 24」内，
      // 位置再夹一次，保证任何窗口尺寸下都不会溢出屏幕。
      const w = Math.min(size?.width ?? width, Math.max(280, vw - mainLeft - 24))
      const h = Math.min(size?.height ?? 560, Math.max(220, vp.h - 24))
      const wantLeft = Math.max(mainLeft + 12, anchor?.left ?? mainLeft + 12)
      const wantTop = anchor?.top ?? 12
      return {
        left: Math.min(wantLeft, Math.max(12, vw - w - 12)),
        top: Math.min(Math.max(12, wantTop), Math.max(12, vp.h - h - 12)),
        width: w,
        height: h,
      }
    })()
    : undefined

  /*
   * Esc 关闭。
   *
   * page 形态的"关闭"是切回会话（与点侧边栏会话行同一效果），compact 是收起
   * 卡片；两者都由 onClose 收口。面板可自行拦截（技能面板在安装/确认进行中
   * 直接 return，不放行）。
   */
  useEffect(() => {
    if (closing) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [closing, onClose])

  /*
   * 焦点：打开时移进卡片，关闭时还给触发它的元素。
   *
   * 卡片 portal 到 body 末尾，Tab 顺序排在整个应用 UI 之后。不做这一步的话，
   * 键盘用户点开面板后按 Tab，焦点会先跑遍侧边栏、主区、composer，绕一圈才
   * 进得去面板——面板等于键盘不可达。focus 记在 ref 里（不用模块级变量），
   * 多个面板同时存在也不会串。
   */
  const cardRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (page || closing) return undefined
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const card = cardRef.current
    if (card !== null) {
      // 优先落在标了 data-autofocus 的控件上，其次是首个可聚焦元素，
      // 都没有就把焦点给卡片本身（tabIndex=-1，至少让读屏从这里开始念）。
      const target = card.querySelector<HTMLElement>('[data-autofocus]')
        ?? card.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      if (target !== null) target.focus()
      else card.focus()
    }
    return () => {
      const back = returnFocusRef.current
      if (back !== null && back.isConnected) back.focus()
      returnFocusRef.current = null
    }
  }, [page, closing])

  if (page) {
    // page：不 portal、不遮罩、不抢焦点。它是一个视图而不是对话框，焦点按
    // 浏览器默认顺序走（与官方自动化任务页一致）。
    return (
      <section className="psh-page" aria-label={ariaLabel}>
        {children}
      </section>
    )
  }

  return createPortal(
    <>
      {(narrow || compact) && (
        <div className="psh-mask" data-plain={compact || undefined} data-anim={anim} aria-hidden="true" onClick={onClose} />
      )}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`psh-card ${compact ? '' : modalDrawerAnimClass(closing)}`}
        data-anim={anim}
        data-mode={mode}
        data-solid={solid ? '' : undefined}
        style={style}
        role="dialog"
        /*
         * aria-modal 只在**真的有遮罩**时才是对的（narrow || compact）。
         * sheet 形态带遮罩，标了才准；没有遮罩时不标。
         */
        aria-modal={narrow || compact ? true : undefined}
        aria-label={ariaLabel}
        onMouseEnter={onCardMouseEnter}
        onMouseLeave={onCardMouseLeave}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

/** 卡片头部属性。 */
export interface PshHeadProps {
  title: string
  closeLabel: string
  onClose: () => void
}

/** 通用卡片头部（标题 + 关闭钮）。 */
export function PshHead({ title, closeLabel, onClose }: PshHeadProps): JSX.Element {
  return (
    <div className="psh-head">
      <span className="psh-title">{title}</span>
      <button type="button" className="psh-close" aria-label={closeLabel} onClick={onClose}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

/** 卡片主体滚动容器（flex:1 + overflow hidden，内部面板自行滚动）。 */
export function PshBody({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={className !== undefined && className !== '' ? `psh-body ${className}` : 'psh-body'}>{children}</div>
}
