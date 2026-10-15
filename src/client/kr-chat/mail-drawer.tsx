/**
 * dsh-chat-plus — Seeker 顶栏「邮箱」按钮 + 右侧只读邮件抽屉。
 *
 * 用户诉求（2026-10-15）：「把入口搬迁到设置旁边，只是单独的查看而已」。
 * 于是邮箱从「统一工作台里的一个 Tab」搬到 Seeker 标签右侧那排动作按钮里，
 * 点开是一张从右滑入的抽屉，里面复用现成的 MailPanel（`embedded` 形态 ——
 * 抽屉自己就是外壳，不要面板自带的 PopoverShell 再套一层）。
 *
 * 三块东西、三个归属，刻意不互相穿透：
 *
 *  1. **顶栏按钮**：裸 DOM（`syncMailButton`）。官方标签行 `[role="tablist"]`
 *     没有对应的 slots 座位，只能照 Seeker / 齿轮那套做法建节点。按钮由
 *     kr-chat-controller 每 250ms 幂等调用一次，位置不对就搬回来。
 *  2. **开合状态**：mail-drawer-store（挂 window 槽位，跨 bundle 共享）。
 *     按钮与抽屉不同树不同根，props 传不过去，只能走共享 store。
 *  3. **抽屉本体**：body 级容器 + createRoot（`mountMailDrawer`）。
 *     为什么不挂在右栏 `.kr-split__side` 里（设置抽屉就在那儿）：邮箱面板需要
 *     的宽度（420px）比右栏本身还宽，且右栏在空白会话里整块不渲染 —— 挂进去
 *     会出现「顶栏有邮箱按钮、点了却什么都没出来」；body 级 fixed 浮层与右栏的
 *     布局/裁剪/滚动完全解耦。
 *
 * 动效（用户明确偏好，且要求减弱动效下内容完整可见）：抽屉与遮罩的可见性**只**
 * 由 `data-open` 属性选择器决定，动画只负责过程 —— 于是 `prefers-reduced-motion`
 * 下把过渡整体关掉，抽屉照样是「打开即完整可见」，不存在停在半透明中间态。
 *
 * 首帧不发请求：抽屉的 **DOM 常驻**（否则退场动画没得播），但内部 MailPanel 用
 * `hasOpened` 闩锁延迟到**第一次真正打开**才挂载。常驻 + 条件渲染的取舍点就在这里：
 * 动画只可能发生在「打开过之后」，而插件加载时不该凭空去打邮箱接口。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
// 走邮箱模块的公开入口（barrel）而不是直接钻 Panel.js / api.js：那条导出面就是
// 「邮箱模块对外提供什么」的唯一声明处，绕过它会让 barrel 变成零消费者的死文件
// （2026-10 入口搬迁时真踩过：文件还在、README 与冒烟都称「入口 import 它」，
// 实际谁都直接钻进了子模块）。
import { MailPanel, createMailApi } from '../triad/mail/index.js'
import { getMailDrawerStore } from './mail-drawer-store.ts'

/**
 * 模块级单例：`createMailApi()` 是无状态 fetch 包装，但每次调用返回新对象；
 * 若写在组件里，任何以它为依赖的 useCallback / useEffect 每帧都会重建并重发请求
 * （KrPanelSettings.tsx:48-55 为此专门记过一次请求风暴）。提上来还让 MailPanel
 * 的 props 恒等，抽屉反复开合不会触发它的重载链。
 */
const mailApi = createMailApi()

/** body 级宿主容器 id：只挂一次，幂等复用。 */
const HOST_ID = 'dsh-mail-drawer-host'

/**
 * 两枚动作按钮之间的目标视觉间距（px）。
 *
 * 为什么不是「给邮箱按钮写个固定 margin-left」：齿轮与邮箱之间那段 22px 不是我们
 * 写的，是官方 `[role="tablist"]` 自己的 flex gap（给文字标签用的）。写死一个负
 * margin 去抵它，等于把官方 gap 当成常量 —— 官方一改，要么留下一条大缝，要么两枚
 * 按钮叠在一起。这里改成**运行时几何反推**：量出齿轮右缘到邮箱左缘的实际距离，
 * 减掉邮箱自己贡献的那份 margin，就还原出官方的自然间距；再据此反解出需要的
 * margin-left。这个闭环每 250ms 收敛一次，官方怎么改都跟得上。
 */
const MAIL_BUTTON_PAIR_GAP = 4

/** 把邮箱按钮与齿轮的视觉间距对齐成「并排的一对」。 */
function alignMailButtonToGear(btn: HTMLButtonElement, settings: HTMLElement): void {
  const gearRect = settings.getBoundingClientRect()
  const btnRect = btn.getBoundingClientRect()
  // 还没布局（宽高为 0）时跳过，下一轮 250ms 会再对齐一次。
  if (gearRect.width === 0 || btnRect.width === 0) return
  const currentMargin = parseFloat(getComputedStyle(btn).marginLeft)
  if (!Number.isFinite(currentMargin)) return
  // 自然间距 = 实测间距 − 自己贡献的 margin（还原官方 flex gap + 齿轮右外边距）。
  const natural = (btnRect.left - gearRect.right) - currentMargin
  const next = Math.round((MAIL_BUTTON_PAIR_GAP - natural) * 10) / 10
  const nextText = `${next}px`
  // 只在真的变了才写，避免每 250ms 触发一次样式失效。
  if (btn.style.marginLeft !== nextText) btn.style.marginLeft = nextText
}

/**
 * 顶栏「邮箱」按钮的幂等同步。
 *
 * 与 syncPanelSettingsButton 同构（同一套「建节点 → 挪位置 → 对齐属性」），
 * 但**位置在齿轮之后**：`settings.insertAdjacentElement('afterend', mail)`，
 * 保证视觉顺序是 Seeker → 齿轮 → 邮箱（用户点名的位置）。
 */
export function syncMailButton(tablist: HTMLElement): void {
  const settings = document.getElementById('kr-panel-settings-btn')
  if (settings === null) return

  let btn = document.getElementById('kr-mail-btn') as HTMLButtonElement | null

  if (!btn || !btn.isConnected || btn.parentElement !== tablist) {
    if (btn) {
      try { btn.remove() } catch { /* 已被别处摘走 */ }
    }
    btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'kr-mail-btn'
    btn.className = 'kr-mail-btn'
    btn.title = '邮箱'
    btn.setAttribute('aria-label', '邮箱')
    // 纯内联 SVG（与 MailPanel 的 MailIcon 同一形状的信封）：这里是裸 DOM，
    // 拿不到那个 React 组件，自带一份字符串，尺寸与齿轮按钮一致（14 / viewBox 16）。
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<rect x="1.6" y="3.2" width="12.8" height="9.6" rx="1.6" />'
      + '<path d="M2.2 4.4 8 8.6l5.8-4.2" />'
      + '</svg>'
    btn.onclick = (e) => {
      e.stopPropagation()
      // 走共享 store（跨 bundle 实例唯一）——旧实例闭包读到的也是同一份。
      getMailDrawerStore().toggle()
    }
  }

  // 紧贴齿轮右侧。会话切换 / 官方重渲染后 tablist 可能重建，位置不对就搬回来。
  if (btn.previousElementSibling !== settings) {
    settings.insertAdjacentElement('afterend', btn)
    // 刚搬过位置，先清掉上一轮算出的 margin，让几何反推从「自然间距」重新起算。
    btn.style.marginLeft = ''
  }
  alignMailButtonToGear(btn, settings)

  applyMailButtonState(btn)
}

/**
 * 把 store 里的开合状态写进按钮属性。
 *
 * 单独抽出来是为了让 controller 的 store 订阅回调直接复用 —— 只靠 250ms 轮询的话，
 * 点下按钮到按钮亮起来最坏有 250ms 延迟，按钮与抽屉读起来像两个不同步的东西。
 */
export function applyMailButtonState(el?: Element | null): void {
  const btn = el ?? document.getElementById('kr-mail-btn')
  if (btn === null) return
  const open = getMailDrawerStore().open
  if (btn.getAttribute('data-open') !== (open ? 'true' : 'false')) {
    btn.setAttribute('data-open', open ? 'true' : 'false')
  }
  if (btn.getAttribute('aria-expanded') !== (open ? 'true' : 'false')) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
}

/**
 * 抽屉本体：遮罩 + 右滑入面板。开合读共享 store，DOM 常驻、`data-open` 驱动显隐。
 */
export function KrMailDrawer(): JSX.Element {
  const store = getMailDrawerStore()
  const open = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.open,
    () => store.open,
  )

  /*
   * 首次打开闩锁：打开过就再也不卸载 MailPanel。
   *
   * 两个需求互相拉扯 ——「DOM 常驻才能播退场动画」与「插件加载时不要凭空去打
   * 邮箱接口」。闩锁把两者分开：第一次打开之前根本不挂面板（零请求），打开过
   * 之后就常驻（关闭时只是 data-open 转 false，面板不卸载，退场动画完整）。
   */
  const [hasOpened, setHasOpened] = useState(open)
  useEffect(() => {
    if (open && !hasOpened) setHasOpened(true)
  }, [open, hasOpened])

  /*
   * Esc 关闭：只在打开期间挂监听。
   *
   * 抽屉没开时 Esc 属于页面上别的东西（官方弹层、输入框取消等），抢过来关一个
   * 看不见的抽屉是纯干扰。与 KrPanelSettings 的处理逐字同构。
   */
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') store.setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open, store])

  return (
    <>
      {/* 遮罩：铺满视口，**只在打开时拦截指针**（常驻 pointer-events:auto 会把整页
          点击一起吃掉）。左缘必然落在抽屉左侧，于是「点外面关闭」这条通路永远是通的。 */}
      <div
        className="kr-mail-drawer__scrim"
        data-open={open ? 'true' : 'false'}
        onClick={() => { store.setOpen(false) }}
        aria-hidden="true"
      />
      <aside
        className="kr-mail-drawer"
        data-open={open ? 'true' : 'false'}
        role="dialog"
        aria-modal="true"
        aria-label="邮箱"
        aria-hidden={open ? 'false' : 'true'}
      >
        {/*
          关闭按钮不在这里另起一枚：MailPanel 顶栏自带一个（onClose 接到 store）。
          再画一条标题栏等于两套 chrome 叠在一起 —— 面板已经是完整的外壳了。
          于是关闭通路共三条：面板关闭钮 / 点遮罩 / Esc。
        */}
        {hasOpened && (
          <div className="kr-mail-drawer__body">
            <MailPanel
              api={mailApi}
              onClose={() => { store.setOpen(false) }}
              embedded
            />
          </div>
        )}
      </aside>
    </>
  )
}

/** 跨 bundle 共享的抽屉根句柄（live reload 后旧根不回收，必须认一份）。 */
const HOST_GLOBAL_KEY = '__dshChatPlusMailDrawerHost__'

interface MailDrawerHost {
  root: Root
  container: HTMLElement
}

/**
 * 挂载抽屉到 body 级容器。幂等：同页面重复调用（live reload / 多次 apply）只挂一次。
 *
 * 与 kr-chat-controller 的 PANEL_HOST_GLOBAL_KEY 同一套理由：两份 bundle 各持一个
 * 模块级变量的话，两边都会往同一容器上 createRoot，React 会告警并让两棵树互相覆盖。
 */
export function mountMailDrawer(): void {
  if (typeof document === 'undefined') return

  const holder = window as unknown as Record<string, unknown>
  const existing = holder[HOST_GLOBAL_KEY] as MailDrawerHost | undefined
  if (existing !== undefined) {
    if (existing.container.isConnected) return
    // 容器被外部摘掉了（官方重排 body 之类）：卸掉旧根再重建，
    // 否则 React 会对同一逻辑树重复挂载（内容闪两份）。
    try { existing.root.unmount() } catch { /* 旧根已半死不活 */ }
    delete holder[HOST_GLOBAL_KEY]
  }
  document.getElementById(HOST_ID)?.remove()

  const container = document.createElement('div')
  container.id = HOST_ID
  // display:contents —— 宿主 div 不参与布局，两个 fixed 子节点照自己的坐标走。
  container.style.display = 'contents'
  document.body.appendChild(container)

  const root = createRoot(container)
  try {
    root.render(<KrMailDrawer />)
  } catch (error) {
    // 抽屉挂不出来不该把整个控制器同步流程带崩（其它按钮还要照常工作）。
    console.error('[mail-drawer] mount failed', error)
    try { root.unmount() } catch { /* 未挂成，忽略 */ }
    container.remove()
    return
  }
  holder[HOST_GLOBAL_KEY] = { root, container } satisfies MailDrawerHost
}
