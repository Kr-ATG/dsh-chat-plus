/**
 * dsh-mail — 邮箱工作台（client 半身）。
 *
 * 三栏应用布局，与记忆/用量/技能三个工作台同一套壳（PopoverShell 的 drawer
 * 形态：自右向左滑入、盖住会话主区、Esc / 遮罩 / 关闭钮统一收口）：
 *
 *   ┌────────┬──────────────┬────────────────────────────────┐
 *   │ 文件夹  │ 邮件列表      │ 详情 / 写信 / 回复 / 转发        │
 *   │ 导航    │ 搜索·过滤·翻页 │ 正文（HTML 走沙箱 iframe）       │
 *   │ 设置    │              │ 附件下载                        │
 *   └────────┴──────────────┴────────────────────────────────┘
 *
 * 三条与「邮件是外部不可信输入」直接相关的实现约束：
 *
 *  1. **正文永不直接 innerHTML**：HTML 邮件先过 sanitize.ts 字符串净化，再塞进
 *     `<iframe sandbox="allow-same-origin">`（不给 allow-scripts）。样式隔离 +
 *     脚本不可执行，双保险。
 *  2. **点一下就执行，不二次追问**：面板上的写操作（移入回收站 / 永久删除 /
 *     发信）都是「用户亲手点 = 明确许可」，host 侧一次请求走完 CLI 的两阶段
 *     确认（trashNow / deleteNow）。**不给「待确认」条**——同一个动作问两遍是
 *     噪音；真失败了就报错并重新对齐状态（见 handleWriteError）。
 *  3. **永久删除保留一次确认**：不可恢复，是回收站里的最后一道门；移入回收站
 *     可逆（30 天内能恢复），不弹确认。危险按钮走红色变体。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconPaperclipOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSendOutline16,
  IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirVerdict, MailApi, MailAccountView, MailConfigView, MailDetailView, MailSummaryView } from './api.js'
import { MailApiError } from './api.js'
import { css, ensureMailStyles } from './styles.js'
import { wrapMailHtml } from './sanitize.js'
import { ConfirmDialog } from '../memory/ConfirmDialog.js'
import { PopoverShell, type PopoverAnchor } from '../popover-shell.js'

/** 文件夹。 */
type Folder = 'inbox' | 'sent' | 'trash' | 'spam'

/** 面板视图。 */
type View = 'mail' | 'settings'

/** 右侧主区模式。 */
type PaneMode =
  | { kind: 'read'; id: string }
  | { kind: 'compose'; replyTo?: { id: string; subject: string; from: string } }
  | { kind: 'forward'; source: MailDetailView }

/** 文件夹文案与图标。 */
const FOLDERS: ReadonlyArray<{ id: Folder; label: string; icon: JSX.Element }> = [
  { id: 'inbox', label: '收件箱', icon: inboxIcon() },
  { id: 'sent', label: '已发送', icon: sentIcon() },
  { id: 'trash', label: '回收站', icon: trashIcon() },
  { id: 'spam', label: '垃圾邮件', icon: spamIcon() },
]

function inboxIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M5 5h14l2 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" />
    </svg>
  )
}

function sentIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12 20 4l-4 16-4-6z" />
      <path d="M12 14 20 4" />
    </svg>
  )
}

function trashIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  )
}

function spamIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 3 20h18z" />
      <path d="M12 10v4M12 17.2v.1" />
    </svg>
  )
}

/** 邮箱图标（导航行与顶栏共用）。 */
export function MailIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
    </svg>
  )
}

/** 时间格式化：今天显示时:分，今年显示月-日，更早显示年-月-日。 */
function formatTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  const date = new Date(time)
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 完整时间（详情头）。 */
function formatFullTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  const date = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 字节数。 */
function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

/** 发件人显示名。 */
function fromText(message: { from: { email: string; name?: string } }): string {
  const name = message.from?.name ?? ''
  return name === '' ? message.from?.email ?? '(未知)' : name
}

/**
 * 打开系统的文件夹选择对话框。
 *
 * 走官方 `ctx.uiWorkspace.pickDirectory()`（`@deepseek-ai/dsh-client-ui-workspace`
 * 提供的跨控制器能力），**不自己造选择器**：那个服务背后是 host 的原生
 * directoryPicker Remote，宿主换实现（原生 / 应用内浏览）本插件都不用改。
 *
 * 拿不到服务时**抛错**，由调用方决定降级（设置页隐藏「选择文件夹」按钮、下载时
 * 退回默认目录）—— 返回 null 会被当成「用户取消」，与「能力不可用」混为一谈。
 *
 * 根上下文从 `window.__dshClientCtx__` 取（`src/client/index.ts` 里挂的，
 * 与 client-ctx.ts 同一份）；本面板活在独立 React 根里，拿不到 DSH 的 hooks 上下文。
 */
async function pickDirectory(): Promise<string | null> {
  const ctx = (window as unknown as { __dshClientCtx__?: { get?: (name: string) => unknown } }).__dshClientCtx__
  const service = ctx?.get?.('uiWorkspace') as { pickDirectory?: () => Promise<string | null> } | null | undefined
  if (service === null || service === undefined || typeof service.pickDirectory !== 'function') {
    throw new Error('当前环境没有目录选择器')
  }
  return await service.pickDirectory()
}

/**
 * 面板属性。
 *
 * ⚠️ **open=false 且不在退场时必须返回 null**（见下方渲染前的早退）。
 *
 * 这一条踩过真实的坑：`PopoverShell` 的 drawer 形态是 `position:fixed` 全高
 * 覆盖会话主区的，如果无条件渲染，面板会从**插件加载那一刻**就盖住整个界面；
 * 而关闭路径只翻 `open` 状态，对「本来就一直挂着的面板」毫无作用 ——
 * 用户看到的就是「一进邮箱界面就再也退不出去」。
 *
 * 三个已有工作台（用量/能力/记忆）都靠 `{open && <Panel/>}` 规避，本面板当时
 * 漏了。所以这里在组件内部也留一道守卫：**渲染前判断，而不是只靠调用方**。
 * 两处守卫（调用方的条件挂载 + 本组件的早退）互为兜底，任何一处写错都不会
 * 再出现「盖住整屏退不出去」。
 */
export interface MailPanelProps {
  open: boolean
  closing?: boolean
  onClose: () => void
  anchor?: PopoverAnchor | null
  api: MailApi
  /** 打开时的初始文件夹（默认收件箱）。 */
  initialFolder?: Folder
  /** 打开时直接定位到某封邮件（从新邮件提示进来时用）。 */
  initialMessageId?: string
}

/** 邮箱工作台面板。 */
export function MailPanel({ open, closing = false, onClose, anchor = null, api, initialFolder, initialMessageId }: MailPanelProps): JSX.Element | null {
  ensureMailStyles()

  const [view, setView] = useState<View>('mail')
  const [folder, setFolder] = useState<Folder>(initialFolder ?? 'inbox')
  const [query, setQuery] = useState('')
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [onlyAttach, setOnlyAttach] = useState(false)
  const [messages, setMessages] = useState<MailSummaryView[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<{ message: string; needsAuth: boolean } | null>(null)
  const [pane, setPane] = useState<PaneMode | null>(initialMessageId === undefined ? null : { kind: 'read', id: initialMessageId })
  const [detail, setDetail] = useState<MailDetailView | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [account, setAccount] = useState<MailAccountView | null>(null)
  const [config, setConfig] = useState<MailConfigView | null>(null)
  const [watching, setWatching] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; danger?: boolean; onConfirm: () => void } | null>(null)
  /** 已展示过的新邮件事件时间戳（避免同一封反复弹 toast）。 */
  const seenEvents = useRef(new Set<number>())

  /* ── 数据加载 ─────────────────────────────────────────────────────── */

  const loadAccount = useCallback(async (): Promise<void> => {
    try {
      setAccount(await api.account())
    } catch (err) {
      setAccount({
        auth: { logged_in: false, status: 'error' },
        me: null,
        primary: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [api])

  const loadConfig = useCallback(async (): Promise<void> => {
    try { setConfig(await api.config()) } catch { /* 设置页拉不到就留空 */ }
  }, [api])

  /**
   * 拉列表。
   *
   * `fresh` 决定要不要吃本地缓存秒开：
   *  - 不传（首屏/换文件夹）→ 走 `cache=1`，面板一打开就有内容，不白屏；
   *  - 传 true（刷新按钮 / 写操作之后 / 写失败重对齐）→ 强制实时。
   *
   * 这条区分是必需的：早先所有调用都带 `cache=1`，于是「刷新」按钮点下去
   * 拿到的是同一份磁盘快照 —— 用户刚删掉的邮件还在列表里，看起来就是
   * 「删除没生效」，再点一次就撞上服务端的目录约束。
   */
  const loadList = useCallback(async (target: Folder, options: { append?: boolean; cursor?: string; q?: string; unread?: boolean; attach?: boolean; fresh?: boolean } = {}): Promise<void> => {
    const append = options.append === true
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const keyword = (options.q ?? '').trim()
      const page = keyword === ''
        ? await api.list({
          dir: target,
          limit: 30,
          cursor: options.cursor,
          isUnread: options.unread === true,
          hasAttachments: options.attach === true,
          // 首屏走缓存秒开：面板一打开就有内容。刷新/写后一律实时（见上）。
          cache: append || options.fresh === true ? undefined : true,
        })
        : await api.search({
          q: keyword,
          dir: target,
          limit: 30,
          cursor: options.cursor,
          isUnread: options.unread === true ? 1 : undefined,
          hasAttachments: options.attach === true ? 1 : undefined,
        })
      setMessages(previous => append ? [...previous, ...page.messages] : page.messages)
      setHasMore(page.hasMore)
      setCursor(page.nextCursor)
    } catch (err) {
      const apiError = err instanceof MailApiError ? err : null
      setError({
        message: err instanceof Error ? err.message : String(err),
        needsAuth: apiError?.needsAuth === true || (account !== null && account.auth.logged_in !== true),
      })
      if (!append) setMessages([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [api, account])

  const loadDetail = useCallback(async (id: string): Promise<void> => {
    setDetailLoading(true)
    try {
      setDetail(await api.read(id))
      // 读过的邮件在列表里同步去未读点，避免「点开了还是未读」的错位。
      setMessages(previous => previous.map(item => item.message_id === id ? { ...item, is_read: true } : item))
    } catch (err) {
      setDetail(null)
      setError({ message: err instanceof Error ? err.message : String(err), needsAuth: err instanceof MailApiError && err.needsAuth })
    } finally {
      setDetailLoading(false)
    }
  }, [api])

  // 打开 / 换文件夹 / 换过滤条件 → 重新拉列表。
  useEffect(() => {
    if (!open || view !== 'mail') return
    void loadList(folder, { q: query, unread: onlyUnread, attach: onlyAttach })
    // query 走 320ms 防抖，见下面的 effect；这里只依赖结构化条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, folder, onlyUnread, onlyAttach])

  // 搜索防抖：输入停顿 320ms 才打接口（邮箱接口有每分钟 10 次的限额）。
  useEffect(() => {
    if (!open || view !== 'mail') return undefined
    const timer = window.setTimeout(() => {
      void loadList(folder, { q: query, unread: onlyUnread, attach: onlyAttach })
    }, 320)
    return () => { window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    if (!open) return
    void loadAccount()
    void loadConfig()
  }, [open, loadAccount, loadConfig])

  // 打开时定位到指定邮件。
  useEffect(() => {
    if (!open || initialMessageId === undefined) return
    setPane({ kind: 'read', id: initialMessageId })
    void loadDetail(initialMessageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMessageId])

  // 选中邮件 → 拉详情。
  useEffect(() => {
    if (pane?.kind !== 'read') { setDetail(null); return }
    void loadDetail(pane.id)
  }, [pane, loadDetail])

  /* ── 新邮件提示（轮询 watch 事件缓冲） ────────────────────────────── */

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    const tick = async (): Promise<void> => {
      try {
        const state = await api.events()
        if (!alive) return
        setWatching(state.watching)
        const fresh = state.events.filter(event => !seenEvents.current.has(event.at))
        if (fresh.length > 0) {
          for (const event of fresh) seenEvents.current.add(event.at)
          const count = fresh.length
          setToast(count === 1 ? '收到 1 封新邮件' : `收到 ${count} 封新邮件`)
          // 提示的同时刷新列表（用户此刻多半就在看收件箱）。
          if (folder === 'inbox') void loadList('inbox', { q: query, unread: onlyUnread, attach: onlyAttach, fresh: true })
        }
      } catch { /* 轮询失败静默 */ }
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, 5000)
    return () => { alive = false; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folder, query, onlyUnread, onlyAttach])

  // toast 3.6 秒后自动消失。
  useEffect(() => {
    if (toast === null) return undefined
    const timer = window.setTimeout(() => { setToast(null) }, 3600)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  /* ── 写操作 ───────────────────────────────────────────────────────── */

  /**
   * 统一的写结果处理：`done` → 提示成功并刷新列表。
   *
   * 面板上的写操作（移入回收站 / 永久删除 / 发信）都是**一次请求走完两阶段**
   * （见 host 的 trashNow / deleteNow）—— 用户亲手点的那一下就是许可，所以
   * 正常只会拿到 `done`。`pending` 是异常兜底（服务端没接受令牌），不再引导
   * 用户去点什么「确认执行」，而是直接说明没成功，别把没做的事说成做了。
   */
  const handleOutcome = useCallback(async (outcome: { status: string }, successText: string): Promise<void> => {
    if (outcome.status !== 'done') {
      setToast('这一步没有执行成功，请重试')
      return
    }
    setToast(successText)
    setPane(null)
    setDetail(null)
    // 写操作之后必须拿实时结果：缓存里的还是「操作前」的快照。
    await loadList(folder, { q: query, unread: onlyUnread, attach: onlyAttach, fresh: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, query, onlyUnread, onlyAttach, loadList])

  /**
   * 写操作失败的统一收口：报错 **+ 重新对齐本地状态**。
   *
   * 光弹红字不够。破坏性操作最常见的失败是「这封邮件已经不在原文件夹里了」
   * （服务端 `Cannot delete message from this directory`）—— 此刻本地列表
   * 与详情都是过期快照，不刷新的话用户面对的是：一句报错 + 一个**注定失败
   * 的按钮**，点几次都撞同一堵墙。
   *
   * 刷新之后，详情里的 `dir` 会拿到服务端的真实归属，按钮自动从「移入回收站」
   * 翻成「永久删除」，用户顺势就能完成他本来想做的事。
   */
  const handleWriteError = useCallback(async (err: unknown): Promise<void> => {
    setError({ message: err instanceof Error ? err.message : String(err), needsAuth: err instanceof MailApiError && err.needsAuth })
    await loadList(folder, { q: query, unread: onlyUnread, attach: onlyAttach, fresh: true })
    if (pane?.kind === 'read') await loadDetail(pane.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, query, onlyUnread, onlyAttach, pane, loadList, loadDetail])

  /**
   * 下载附件：`askDir` 为真时先让用户挑位置（走系统原生选择器），否则用设置里
   * 配的目录。选择器不可用（非桌面端 / 服务缺失）时静默退回默认目录，不让
   * 「挑位置」这个增强把「下载」本身弄失败。
   */
  const downloadAttachment = useCallback(async (
    messageId: string,
    att: { attachment_id?: string; download_url?: string; filename?: string },
    askDir = false,
  ): Promise<void> => {
    let outputDir: string | undefined
    if (askDir) {
      try {
        const picked = await pickDirectory()
        if (picked === null) return // 用户取消：什么都不做
        outputDir = picked
      } catch {
        // 选择器不可用：退回默认目录继续下载。
        outputDir = undefined
      }
    }
    try {
      const result = await api.downloadAttachment({
        msg: messageId,
        att: att.attachment_id,
        downloadUrl: att.download_url,
        outputDir,
      })
      if (result.downloadUrl !== undefined) {
        setToast('超大附件无法直接下载，链接已复制到剪贴板')
        void navigator.clipboard?.writeText(result.downloadUrl).catch(() => undefined)
        return
      }
      setToast(`已保存到 ${result.savedTo ?? '本地'}`)
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : String(err), needsAuth: err instanceof MailApiError && err.needsAuth })
    }
  }, [api, pickDirectory])

  /* ── 渲染 ─────────────────────────────────────────────────────────── */

  const unreadCount = useMemo(() => messages.filter(item => !item.is_read).length, [messages])

  // 渲染守卫（详见 MailPanelProps 的注释）：不在开/关动画期间就什么都不渲染。
  // 少了这一行，drawer 形态的 PopoverShell 会一直 fixed 覆盖会话主区，
  // 表现为「进了邮箱界面退不出来」。closing 期间必须继续渲染，否则退场动画
  // 会被直接掐掉（面板瞬间消失而不是滑出）。
  if (!open && !closing) return null

  const head = (
    <div className={css.topbar}>
      <div className={css.brand}>
        <MailIcon size={18} />
        <span className={css.brandText}>邮箱</span>
      </div>
      {account?.primary !== null && account?.primary !== undefined && (
        <div className={css.address}>
          <button
            type="button"
            className={css.addressBtn}
            title={`${account.primary.email}（点击复制）`}
            onClick={() => {
              void navigator.clipboard?.writeText(account.primary!.email).catch(() => undefined)
              setToast('邮箱地址已复制')
            }}
          >
            <span>{account.primary.email}</span>
          </button>
        </div>
      )}
      <div className={css.topSearch}>
        <IconSearchOutline16 size={15} />
        <input
          className={css.topInput}
          value={query}
          placeholder="搜索主题、正文、发件人…"
          onChange={event => { setQuery(event.target.value) }}
        />
      </div>
      <div className={css.topActions}>
        <button
          type="button"
          className={css.topBtn}
          data-watch={watching ? 'true' : undefined}
          title={watching ? '正在监听新邮件（点击停止）' : '开启新邮件监听'}
          onClick={() => {
            void api.setWatch(!watching)
              .then(next => {
                setWatching(next)
                // 记住这个偏好：开启后写入配置，下次启动自动起（默认关闭 ——
                // 常驻 watch 进程不该是「装上插件」的默认副作用）。
                return api.updateConfig({ watchEnabled: next })
              })
              .then(setConfig)
              .catch(() => undefined)
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
            <path d="M10.5 19a2 2 0 0 0 3 0" />
          </svg>
        </button>
        <button
          type="button"
          className={css.topBtn}
          title="刷新"
          onClick={() => { void loadList(folder, { q: query, unread: onlyUnread, attach: onlyAttach, fresh: true }) }}
        >
          <IconRefreshOutline16 size={15} />
        </button>
        <button type="button" className={css.close} aria-label="关闭" onClick={onClose}>
          <IconCloseOutline16 size={16} />
        </button>
      </div>
    </div>
  )

  return (
    <PopoverShell
      closing={closing}
      onClose={onClose}
      anchor={anchor}
      variant="drawer"
      solid
      ariaLabel="邮箱工作台"
    >
      <div className={css.panel}>
        {head}

        {view === 'settings'
          ? (
            <SettingsView
              config={config}
              account={account}
              onClose={() => { setView('mail') }}
              onSave={async patch => {
                try {
                  setConfig(await api.updateConfig(patch))
                  setToast('设置已保存')
                } catch (err) {
                  setError({ message: err instanceof Error ? err.message : String(err), needsAuth: false })
                }
              }}
              onVerifyDir={path => api.verifyDir(path)}
              onPickDir={pickDirectory}
            />
          )
          : (
            <div className={css.body}>
              {/* 左栏：文件夹 */}
              <div className={css.sidebar}>
                <div className={css.navList}>
                  {FOLDERS.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`${css.navItem} ${folder === item.id ? css.navItemActive : ''}`}
                      onClick={() => { setFolder(item.id); setPane(null) }}
                    >
                      <span className={css.navIcon}>{item.icon}</span>
                      <span>{item.label}</span>
                      {item.id === 'inbox' && unreadCount > 0 && <span className={css.navCount}>{unreadCount}</span>}
                    </button>
                  ))}
                </div>
                <div className={css.navSep} />
                <div className={css.navList}>
                  <button
                    type="button"
                    className={`${css.navItem} ${onlyUnread ? css.navItemActive : ''}`}
                    onClick={() => { setOnlyUnread(value => !value) }}
                  >
                    <span className={css.navIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="8" />
                        <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
                      </svg>
                    </span>
                    <span>只看未读</span>
                  </button>
                  <button
                    type="button"
                    className={`${css.navItem} ${onlyAttach ? css.navItemActive : ''}`}
                    onClick={() => { setOnlyAttach(value => !value) }}
                  >
                    <span className={css.navIcon}><IconPaperclipOutline16 size={16} /></span>
                    <span>只看附件</span>
                  </button>
                  <button
                    type="button"
                    className={css.navItem}
                    onClick={() => { setPane({ kind: 'compose' }) }}
                  >
                    <span className={css.navIcon}><IconEditOutline16 size={16} /></span>
                    <span>写邮件</span>
                  </button>
                </div>
                <div className={css.sideFoot}>
                  <button type="button" className={css.sideSetting} onClick={() => { setView('settings') }}>
                    <span className={css.navIcon}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z" />
                      </svg>
                    </span>
                    <span>设置</span>
                  </button>
                </div>
              </div>

              {/* 中栏：列表 */}
              <div className={css.listCol} data-has-selection={pane !== null ? 'true' : 'false'}>
                <div className={css.listHead}>
                  <span className={css.listHeadText}>
                    {loading ? '加载中…' : `${messages.length} 封${hasMore ? '（还有更多）' : ''}${onlyUnread ? ' · 未读' : ''}${onlyAttach ? ' · 带附件' : ''}`}
                  </span>
                </div>
                <div className={css.listScroll}>
                  {error !== null && (
                    <div className={css.error}>
                      {error.needsAuth
                        ? <>邮箱尚未授权。<br />请在本机终端执行下面的命令，并把输出的授权链接用浏览器打开、微信扫码：</>
                        : error.message}
                      {error.needsAuth && (
                        <pre className={css.authCode}>agently-cli auth login</pre>
                      )}
                      <div className={css.errorActions}>
                        <button type="button" className={`${css.btn} ${css.btnSmall}`} onClick={() => { void loadAccount(); void loadList(folder, { q: query, fresh: true }) }}>
                          重试
                        </button>
                      </div>
                    </div>
                  )}
                  {loading && messages.length === 0 && (
                    <div className={css.skeleton}>
                      {[0, 1, 2, 3, 4].map(index => <div key={index} className={css.skeletonRow} />)}
                    </div>
                  )}
                  {!loading && error === null && messages.length === 0 && (
                    <div className={css.empty}>
                      <span className={css.emptyIcon}><MailIcon size={30} /></span>
                      <span>{query.trim() === '' ? '这个文件夹里没有邮件' : '没有匹配的邮件'}</span>
                    </div>
                  )}
                  {messages.map((message, index) => (
                    <button
                      key={message.message_id}
                      type="button"
                      className={[
                        css.row,
                        pane?.kind === 'read' && pane.id === message.message_id ? css.rowActive : '',
                        message.is_read ? '' : css.rowUnread,
                      ].filter(Boolean).join(' ')}
                      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
                      onClick={() => { setPane({ kind: 'read', id: message.message_id }) }}
                    >
                      {!message.is_read && <span className={css.dot} />}
                      <span className={css.rowTop}>
                        <span className={css.rowFrom}>{fromText(message)}</span>
                        <span className={css.rowTime}>{formatTime(message.created_at)}</span>
                      </span>
                      <span className={css.rowSubject}>{message.subject === '' ? '(无主题)' : message.subject}</span>
                      <span className={css.rowSnippet}>{message.snippet.replace(/\s+/g, ' ').trim()}</span>
                      <span className={css.rowMeta}>
                        {message.has_attachments && <span className={`${css.chip} ${css.chipAttach}`}><IconPaperclipOutline16 size={11} />附件</span>}
                      </span>
                    </button>
                  ))}
                  {hasMore && (
                    <button
                      type="button"
                      className={css.more}
                      disabled={loadingMore}
                      onClick={() => { void loadList(folder, { append: true, cursor, q: query, unread: onlyUnread, attach: onlyAttach }) }}
                    >
                      {loadingMore ? '加载中…' : '加载更多'}
                    </button>
                  )}
                </div>
              </div>

              {/* 右栏：详情 / 写信 */}
              <div className={css.detailCol}>
                {pane === null && (
                  <div className={css.empty}>
                    <span className={css.emptyIcon}><MailIcon size={34} /></span>
                    <span>选择一封邮件查看内容</span>
                    <span className={css.hint}>也可以点左侧「写邮件」，或直接在对话里让我帮你收发</span>
                  </div>
                )}
                {pane?.kind === 'read' && (
                  <ReadPane
                    key={pane.id}
                    detail={detail}
                    loading={detailLoading}
                    /* 邮件所在文件夹：决定右侧给哪些操作。
                       Agent Mail 的规则是「+trash 只能作用于不在回收站里的邮件、
                       +delete 只能作用于回收站里的邮件」，所以按钮必须跟着**邮件
                       实际所在的文件夹**走 —— 在收件箱里给「永久删除」只会让用户
                       点出一个 404。
                       这里传的是「当前列表的文件夹」，只作为**兜底**：真实判定在
                       ReadPane 内部用 detail.dir 做（见那边的注释）。 */
                    listFolder={folder}
                    onReply={() => {
                      if (detail === null) return
                      setPane({ kind: 'compose', replyTo: { id: detail.message_id, subject: detail.subject, from: detail.from.email } })
                    }}
                    onForward={() => {
                      if (detail === null) return
                      setPane({ kind: 'forward', source: detail })
                    }}
                    /* 移入回收站**点一下就执行**，不弹确认：它是可逆的（30 天内
                       都能从回收站恢复），而且用户亲手点这一下本身就是许可 ——
                       再问一遍只是把同一件事问两遍。host 侧一次请求走完两阶段。 */
                    onTrash={() => {
                      if (detail === null) return
                      void api.trash(detail.message_id)
                        .then(outcome => handleOutcome(outcome, '已移入回收站'))
                        .catch((err: unknown) => { void handleWriteError(err) })
                    }}
                    /* 永久删除**保留确认**：不可恢复，且它是回收站里的最后一道门。 */
                    onDelete={() => {
                      if (detail === null) return
                      setConfirmState({
                        title: '永久删除',
                        message: `确定永久删除「${detail.subject || '(无主题)'}」吗？\n此操作不可恢复，删除后会释放邮箱空间。`,
                        danger: true,
                        onConfirm: () => {
                          void api.remove({ id: detail.message_id })
                            .then(outcome => handleOutcome(outcome, '已永久删除'))
                            .catch((err: unknown) => { void handleWriteError(err) })
                        },
                      })
                    }}
                    onDownload={att => { void downloadAttachment(pane.id, att) }}
                    onDownloadAlt={att => { void downloadAttachment(pane.id, att, true) }}
                  />
                )}
                {pane?.kind === 'compose' && (
                  <ComposePane
                    mode="compose"
                    replyTo={pane.replyTo}
                    onCancel={() => { setPane(null) }}
                    onSubmit={async payload => {
                      try {
                        const outcome = await api.send(payload)
                        await handleOutcome(outcome, '邮件已发送')
                      } catch (err) {
                        setError({ message: err instanceof Error ? err.message : String(err), needsAuth: err instanceof MailApiError && err.needsAuth })
                      }
                    }}
                  />
                )}
                {pane?.kind === 'forward' && (
                  <ComposePane
                    mode="forward"
                    forwardSource={pane.source}
                    onCancel={() => { setPane(null) }}
                    onSubmit={async payload => {
                      try {
                        const outcome = await api.forward({
                          ...payload,
                          id: pane.source.message_id,
                          includeAttachments: true,
                        })
                        await handleOutcome(outcome, '邮件已转发')
                      } catch (err) {
                        setError({ message: err instanceof Error ? err.message : String(err), needsAuth: err instanceof MailApiError && err.needsAuth })
                      }
                    }}
                  />
                )}
              </div>
            </div>
          )}

        {toast !== null && (
          <div className={css.toast}>
            <span className={css.toastText}>{toast}</span>
            <button type="button" className={css.toastClose} aria-label="关闭提示" onClick={() => { setToast(null) }}>
              <IconCloseOutline16 size={13} />
            </button>
          </div>
        )}
      </div>

      {confirmState !== null && (
        <ConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel="确定"
          cancelLabel="取消"
          danger={confirmState.danger === true}
          onConfirm={confirmState.onConfirm}
          onClose={() => { setConfirmState(null) }}
        />
      )}
    </PopoverShell>
  )
}

/* ── 读信区 ─────────────────────────────────────────────────────────── */

interface ReadPaneProps {
  detail: MailDetailView | null
  loading: boolean
  /**
   * 当前**列表**所在的文件夹（兜底用）。
   *
   * ⚠️ 不能直接拿它当「邮件在不在回收站」的答案：列表可能是缓存里的旧快照
   * （邮件其实已经被删/被移走了），真实判定必须用 detail.dir —— 那是服务端
   * 对这一封邮件给出的实际归属。这里只在 detail 拿不到 dir 时兜底。
   */
  listFolder: Folder
  onReply: () => void
  onForward: () => void
  onTrash: () => void
  onDelete: () => void
  /** 下载到设置里配的目录。 */
  onDownload: (att: { attachment_id?: string; download_url?: string; filename?: string }) => void
  /** 先让用户挑位置再下载。 */
  onDownloadAlt: (att: { attachment_id?: string; download_url?: string; filename?: string }) => void
}

function ReadPane({ detail, loading, listFolder, onReply, onForward, onTrash, onDelete, onDownload, onDownloadAlt }: ReadPaneProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const dark = useMemo(() => {
    if (typeof document === 'undefined') return false
    return document.body.hasAttribute('data-ds-dark-theme')
      || document.documentElement.hasAttribute('data-ds-dark-theme')
  }, [detail?.message_id])

  // iframe 高度自适应：onLoad 里读一次文档高度，再挂 ResizeObserver 跟随
  // 内容变化（图片加载完会二次变高，只读一次会截断）。
  const fitFrame = useCallback((): void => {
    const frame = frameRef.current
    if (frame === null) return
    try {
      const doc = frame.contentDocument
      if (doc === null) return
      const height = Math.max(220, Math.min(1200, doc.documentElement.scrollHeight + 8))
      frame.style.height = `${height}px`
    } catch { /* 跨源（理论上不会）：保持默认高度 */ }
  }, [])

  if (loading && detail === null) {
    return (
      <div className={css.detailScroll}>
        <div className={css.skeleton}>
          {[0, 1, 2, 3, 4, 5].map(index => <div key={index} className={css.skeletonRow} style={{ height: index === 0 ? 34 : 18 }} />)}
        </div>
      </div>
    )
  }
  if (detail === null) {
    return (
      <div className={css.empty}>
        <span className={css.emptyIcon}><MailIcon size={30} /></span>
        <span>没能读到这封邮件</span>
      </div>
    )
  }

  const isHtml = /^HTML$/i.test(detail.body_format ?? '')
  const attachments = detail.attachments ?? []
  const to = (detail.to ?? []).map(item => item.email).join('、')
  const cc = (detail.cc ?? []).map(item => item.email).join('、')

  /**
   * 这封邮件**现在**在哪个文件夹 —— 破坏性按钮的唯一依据。
   *
   * 早先用的是「当前列表的文件夹」，那是个会撒谎的输入：列表可能来自本地
   * 缓存（邮件早已被移走），用户点开详情时面板还以为它在收件箱/已发送里，
   * 于是给了「移入回收站」；而服务端按邮件真实归属判定，直接回
   * `Cannot delete message from this directory` —— 用户看到的就是截图里那句
   * 英文报错，而且**怎么点都失败**（刷新也白搭，列表还是缓存的旧快照）。
   *
   * `detail.dir.dir_name` 是服务端随正文一起给的实际归属（实测 trash 邮件
   * 会返回 `{dir_id: 5, dir_name: "trash"}`），比任何本地推断都权威。
   * 拿不到 dir 时才退回列表文件夹 —— 降级方向是「按用户以为的来」，
   * 至少与服务端报错后的提示一致。
   */
  const actualDir = detail.dir?.dir_name
  const inTrash = actualDir === undefined || actualDir === ''
    ? listFolder === 'trash'
    : actualDir === 'trash'

  return (
    <div className={css.detailAnim} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className={css.detailHead}>
        <div className={css.detailSubject}>{detail.subject === '' ? '(无主题)' : detail.subject}</div>
        <div className={css.detailMeta}>
          <span><b>{detail.from?.name ?? ''}</b> {detail.from?.email}</span>
          <span>{formatFullTime(detail.created_at)}</span>
          <span>收件：{to}</span>
          {cc !== '' && <span>抄送：{cc}</span>}
        </div>
        <div className={css.detailActions}>
          <button type="button" className={`${css.btn} ${css.btnSmall}`} onClick={onReply}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 7 4 12l5 5" /><path d="M4 12h10a6 6 0 0 1 6 6v2" /></svg>
            回复
          </button>
          <button type="button" className={`${css.btn} ${css.btnSmall}`} onClick={onForward}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 7l5 5-5 5" /><path d="M20 12H10a6 6 0 0 0-6 6v2" /></svg>
            转发
          </button>
          {/* 回收站内外给不同的破坏性操作：CLI 的 +trash 只作用于非回收站邮件、
              +delete 只作用于回收站邮件，给错按钮就是让用户点出一个 404。 */}
          {inTrash
            ? (
              <button type="button" className={`${css.btn} ${css.btnSmall}`} onClick={onDelete}>
                <IconTrashOutline16 size={13} />
                永久删除
              </button>
            )
            : (
              <button type="button" className={`${css.btn} ${css.btnSmall}`} onClick={onTrash}>
                <IconTrashOutline16 size={13} />
                移入回收站
              </button>
            )}
        </div>
      </div>
      <div className={css.detailScroll}>
        {isHtml
          ? (
            <iframe
              ref={frameRef}
              className={css.frame}
              title="邮件正文"
              // 只给 allow-same-origin（用于读取高度）；**不给 allow-scripts**：
              // 净化万一漏了某个向量，脚本在这层沙箱里也执行不了。
              sandbox="allow-same-origin"
              srcDoc={wrapMailHtml(detail.body ?? '', dark)}
              onLoad={() => {
                fitFrame()
                const frame = frameRef.current
                try {
                  const doc = frame?.contentDocument
                  if (doc !== null && doc !== undefined && typeof ResizeObserver !== 'undefined') {
                    const observer = new ResizeObserver(() => { fitFrame() })
                    observer.observe(doc.documentElement)
                    observer.observe(doc.body)
                  }
                } catch { /* 观察不到就只留首次高度 */ }
              }}
            />
          )
          : <div className={`${css.detailBody} ${css.detailPlain}`}>{detail.body ?? ''}</div>}
        {attachments.length > 0 && (
          <div className={css.attachList}>
            {attachments.map((att, index) => {
              const size = formatBytes(att.size)
              const downloadable = att.attachment_id !== undefined && att.attachment_id !== ''
              return (
                <span key={att.attachment_id ?? att.download_url ?? String(index)} className={css.attachGroup}>
                  <button
                    type="button"
                    className={css.attachItem}
                    title={downloadable ? '下载到设置里配的附件目录' : '超大附件：点击复制下载链接'}
                    onClick={() => { onDownload(att) }}
                  >
                    <IconDownloadOutline16 size={15} />
                    <span className={css.attachName}>{att.filename ?? `附件${index + 1}`}</span>
                    {size !== '' && <span className={css.attachMeta}>{size}</span>}
                  </button>
                  {/* 「另选位置」只在普通附件上给：超大附件拿不到 attachment_id，
                      只能把链接交给用户自己去浏览器下载，选目录没有意义。 */}
                  {downloadable && (
                    <button
                      type="button"
                      className={css.attachAlt}
                      title="选择另一个文件夹保存"
                      onClick={() => { onDownloadAlt(att) }}
                    >
                      <IconFolderOpenOutline16 size={13} />
                      另选位置
                    </button>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── 写信 / 转发区 ──────────────────────────────────────────────────── */

interface ComposePaneProps {
  mode: 'compose' | 'forward'
  replyTo?: { id: string; subject: string; from: string }
  forwardSource?: MailDetailView
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}

function ComposePane({ mode, replyTo, forwardSource, onCancel, onSubmit }: ComposePaneProps): JSX.Element {
  const [to, setTo] = useState(forwardSource === undefined ? (replyTo?.from ?? '') : '')
  const [subject, setSubject] = useState(
    replyTo !== undefined
      ? (replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`)
      : forwardSource !== undefined
        ? (forwardSource.subject.startsWith('Fwd:') ? forwardSource.subject : `Fwd: ${forwardSource.subject}`)
        : '',
  )
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (to.trim() === '' || subject.trim() === '' || (body.trim() === '' && mode === 'compose')) return
    setBusy(true)
    try {
      await onSubmit({
        to: to.split(/[,;，；\s]+/).map(item => item.trim()).filter(item => item !== ''),
        subject: subject.trim(),
        body,
        format: 'plain',
        attachments: attachments.split(/\r?\n/).map(item => item.trim()).filter(item => item !== ''),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.composer}>
      <div className={css.composerRow}>
        <span className={css.composerLabel}>收件人</span>
        <input className={css.input} value={to} placeholder="多个地址用逗号分隔" onChange={event => { setTo(event.target.value) }} />
      </div>
      <div className={css.composerRow}>
        <span className={css.composerLabel}>主题</span>
        <input className={css.input} value={subject} onChange={event => { setSubject(event.target.value) }} />
      </div>
      <div className={css.composerRow} style={{ alignItems: 'flex-start' }}>
        <span className={css.composerLabel} style={{ paddingTop: 7 }}>正文</span>
        <textarea
          className={css.inputArea}
          value={body}
          placeholder={mode === 'forward' ? '可留空（原邮件正文会一并转发）' : '写点什么…'}
          onChange={event => { setBody(event.target.value) }}
        />
      </div>
      <div className={css.composerRow}>
        <span className={css.composerLabel}>附件</span>
        <input
          className={css.input}
          value={attachments}
          placeholder="本地文件的绝对路径，每行一个（如 D:\docs\report.pdf）"
          onChange={event => { setAttachments(event.target.value) }}
        />
      </div>
      <div className={css.composerFoot}>
        <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={busy} onClick={() => { void submit() }}>
          <IconSendOutline16 size={14} />
          {busy ? '提交中…' : '生成确认'}
        </button>
        <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={onCancel}>取消</button>
        <span className={css.hint}>
          发送是两阶段确认：点这里只会生成确认令牌，还要在顶部警示条点「确认执行」才会真正发出。
        </span>
      </div>
    </div>
  )
}

/* ── 设置页 ─────────────────────────────────────────────────────────── */

interface SettingsViewProps {
  config: MailConfigView | null
  account: MailAccountView | null
  onClose: () => void
  onSave: (patch: Record<string, unknown>) => Promise<void>
  /** 目录校验（真的试写一下），返回结论。 */
  onVerifyDir: (path: string) => Promise<DirVerdict>
  /** 打开系统原生目录选择器，取消返回 null。 */
  onPickDir: () => Promise<string | null>
}

/** 工具说明（与 host 侧 MAIL_TOOL_NAMES 对应）。 */
const TOOL_DESC: Record<string, string> = {
  mail_account: '查看邮箱地址、授权状态、发信额度与附件限制',
  mail_list: '列出邮件（收件箱/已发送/回收站/垃圾邮件，可过滤翻页）',
  mail_search: '按关键词、发件人、时间、附件、未读搜索邮件',
  mail_read: '读取一封邮件的完整内容与附件信息',
  mail_send: '发送新邮件（两阶段确认）',
  mail_reply: '回复邮件（两阶段确认）',
  mail_forward: '转发邮件（两阶段确认）',
  mail_trash: '移入回收站（两阶段确认）',
  mail_delete: '永久删除 / 清空回收站（两阶段确认）',
  mail_download_attachment: '下载附件到本地（缺省存到下面配的目录）',
  mail_wait_code: '等新邮件并提取验证码（注册 / 登录场景）',
}

/**
 * 附件保存位置设置块。
 *
 * 三条交互上的讲究：
 *  1. **输入不即时落盘**，点「保存」才写 —— 边打字边存会把半截路径（`D:\M`）
 *     反复写进配置，用户中途刷新页面就得到一个不存在的目录；
 *  2. **保存前先校验**（host 侧真的试写一个探针文件），不可写就当场红字说明，
 *     而不是存下去、等下次下载才撞上 CLI 的英文报错；
 *  3. 「选择文件夹」走系统原生选择器（`ctx.uiWorkspace.pickDirectory()`），
 *     不可用时按钮隐藏、退化成手输 —— 手输路径必须始终可用。
 */
function DownloadDirSetting({ config, onSave, onVerifyDir, onPickDir }: {
  config: MailConfigView | null
  onSave: (patch: Record<string, unknown>) => Promise<void>
  onVerifyDir: (path: string) => Promise<DirVerdict>
  onPickDir: () => Promise<string | null>
}): JSX.Element {
  const effective = config?.downloadDir ?? ''
  const factoryDefault = config?.defaultDownloadDir ?? ''
  const [draft, setDraft] = useState(effective)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [verdict, setVerdict] = useState<DirVerdict | null>(null)
  const [pickerAvailable, setPickerAvailable] = useState(true)

  // 配置从外部变化（保存后回包 / 切面板重开）时同步草稿，但**不覆盖正在编辑的
  // 内容**：只有草稿还等于上一次的生效值时（用户没动过）才跟随。
  const lastEffective = useRef(effective)
  useEffect(() => {
    if (lastEffective.current === draft) setDraft(effective)
    lastEffective.current = effective
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective])

  const dirty = draft.trim() !== effective
  const isDefault = config?.downloadDirOverridden !== true

  const save = async (value: string): Promise<void> => {
    setSaving(true)
    setVerdict(null)
    try {
      if (value.trim() !== '') {
        const check = await onVerifyDir(value.trim())
        if (!check.ok) { setVerdict(check); return }
      }
      await onSave({ downloadDir: value.trim() })
      setVerdict(null)
    } finally {
      setSaving(false)
    }
  }

  const pick = async (): Promise<void> => {
    setPicking(true)
    try {
      const picked = await onPickDir()
      if (picked === null) return
      setDraft(picked)
      // 选完就存：用户已经用系统对话框明确表达过意图，再要求点一次「保存」是多余的。
      const check = await onVerifyDir(picked)
      if (!check.ok) { setVerdict(check); return }
      await onSave({ downloadDir: picked })
      setVerdict(null)
    } catch (error) {
      setVerdict({ ok: false, path: draft, error: error instanceof Error ? error.message : String(error) })
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className={css.settingRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={css.settingLabel}>附件保存位置</div>
        <div className={css.settingDesc}>
          下载邮件附件时存到哪里。单个附件下载时也可以临时另选一个位置。
          {isDefault ? '当前用的是默认目录。' : '已自定义。'}
        </div>
        <div className={css.dirRow}>
          <input
            className={css.input}
            value={draft}
            spellCheck={false}
            placeholder={factoryDefault}
            onChange={event => { setDraft(event.target.value); setVerdict(null) }}
            onKeyDown={event => {
              if (event.key === 'Enter' && dirty) void save(draft)
            }}
          />
          {pickerAvailable && (
            <button
              type="button"
              className={`${css.btn} ${css.btnSmall}`}
              disabled={picking || saving}
              title="打开系统的文件夹选择对话框"
              onClick={() => { void pick().catch(() => { setPickerAvailable(false) }) }}
            >
              <IconFolderOpenOutline16 size={13} />
              {picking ? '选择中…' : '选择文件夹'}
            </button>
          )}
          <button
            type="button"
            className={`${css.btn} ${css.btnPrimary} ${css.btnSmall}`}
            disabled={!dirty || saving}
            onClick={() => { void save(draft) }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {!isDefault && (
            <button
              type="button"
              className={`${css.btn} ${css.btnGhost} ${css.btnSmall}`}
              disabled={saving}
              title={factoryDefault}
              onClick={() => { setDraft(factoryDefault); void save('') }}
            >
              恢复默认
            </button>
          )}
        </div>
        {verdict !== null && !verdict.ok && (
          <div className={css.dirError}>{verdict.error ?? '目录不可用'}</div>
        )}
        {dirty && verdict === null && (
          <div className={css.hint}>改完记得点「保存」（回车也可以）。</div>
        )}
      </div>
    </div>
  )
}

function SettingsView({ config, account, onClose, onSave, onVerifyDir, onPickDir }: SettingsViewProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const toggle = async (key: 'enabled' | 'injectEnabled' | 'watchEnabled', value: boolean): Promise<void> => {
    setBusy(true)
    try { await onSave({ [key]: value }) } finally { setBusy(false) }
  }
  const limits = account?.me?.rate_limits
  const constraints = account?.me?.constraints
  return (
    <div className={css.settings}>
      <div className={css.settingGroup}>
        <div className={css.settingGroupTitle}>账号</div>
        <div className={css.settingRow}>
          <div>
            <div className={css.settingLabel}>邮箱地址</div>
            <div className={css.settingDesc}>腾讯 Agent Mail 为 Agent 创建的专属邮箱，与你的个人邮箱完全隔离</div>
          </div>
          <div className={css.settingValue}>{account?.primary?.email ?? '（未授权）'}</div>
        </div>
        <div className={css.settingRow}>
          <div>
            <div className={css.settingLabel}>授权状态</div>
            <div className={css.settingDesc}>
              {account?.auth.logged_in === true
                ? `凭据存于 ${account.auth.storage ?? '本机'}，访问令牌自动续期，无需人工维护`
                : '未授权。在本机终端执行 agently-cli auth login，用微信扫码完成授权'}
            </div>
          </div>
          <div className={css.settingValue}>{account?.auth.logged_in === true ? '已授权' : '未授权'}</div>
        </div>
        {limits !== undefined && (
          <div className={css.settingRow}>
            <div>
              <div className={css.settingLabel}>额度</div>
              <div className={css.settingDesc}>
                每天 {limits.daily_send_quota} 封 · 每小时 {limits.requests_per_hour} 次 · 每分钟 {limits.requests_per_minute} 次
              </div>
            </div>
            <div className={css.settingValue}>
              {constraints === undefined ? '' : `附件 ≤ ${constraints.max_attachment_count} 个 / ${formatBytes(Number(constraints.max_attachment_size_bytes))}`}
            </div>
          </div>
        )}
      </div>

      <div className={css.settingGroup}>
        <div className={css.settingGroupTitle}>能力</div>
        <div className={css.settingRow}>
          <div>
            <div className={css.settingLabel}>启用邮箱工作台</div>
            <div className={css.settingDesc}>关掉后模型工具与对话注入都不注册（路由保留，面板仍可打开）</div>
          </div>
          <button
            type="button"
            className={`${css.switch} ${config?.enabled !== false ? css.switchOn : ''}`}
            disabled={busy || config === null}
            aria-label="启用邮箱工作台"
            onClick={() => { void toggle('enabled', config?.enabled === false) }}
          >
            <span className={css.switchKnob} />
          </button>
        </div>
        <div className={css.settingRow}>
          <div>
            <div className={css.settingLabel}>对话里自动声明邮箱能力</div>
            <div className={css.settingDesc}>
              每个会话首步注入一次「本 Agent 有专属邮箱」的说明 —— 注册第三方服务、收验证码时模型会直接用这个邮箱，不再问你要邮箱
            </div>
          </div>
          <button
            type="button"
            className={`${css.switch} ${config?.injectEnabled !== false ? css.switchOn : ''}`}
            disabled={busy || config === null}
            aria-label="对话里自动声明邮箱能力"
            onClick={() => { void toggle('injectEnabled', config?.injectEnabled === false) }}
          >
            <span className={css.switchKnob} />
          </button>
        </div>
        <div className={css.settingRow}>
          <div>
            <div className={css.settingLabel}>新邮件实时监听</div>
            <div className={css.settingDesc}>
              常驻 `agently-cli message +watch` 长轮询，收到新邮件立即提示（默认关闭，靠 30 秒一次的未读轮询）
            </div>
          </div>
          <button
            type="button"
            className={`${css.switch} ${config?.watchEnabled === true ? css.switchOn : ''}`}
            disabled={busy || config === null}
            aria-label="新邮件实时监听"
            onClick={() => { void toggle('watchEnabled', config?.watchEnabled !== true) }}
          >
            <span className={css.switchKnob} />
          </button>
        </div>
        <div className={css.settingRow}>
          <div>
            <div className={css.settingLabel}>CLI</div>
            <div className={css.settingDesc}>{config?.cliPath ?? '未找到 agently-cli'}</div>
          </div>
          <div className={css.settingValue}>{config?.cliVersion === null || config?.cliVersion === undefined ? '' : `v${config.cliVersion}`}</div>
        </div>
        <div className={css.settingRow}>
          <div>
            <div className={css.settingLabel}>数据目录</div>
            <div className={css.settingDesc}>待确认操作、新邮件事件与列表缓存</div>
          </div>
          <div className={css.settingValue} title={config?.dataDir}>{config?.dataDir ?? ''}</div>
        </div>
      </div>

      <div className={css.settingGroup}>
        <div className={css.settingGroupTitle}>附件</div>
        <DownloadDirSetting
          config={config}
          onSave={onSave}
          onVerifyDir={onVerifyDir}
          onPickDir={onPickDir}
        />
      </div>

      <div className={css.settingGroup}>
        <div className={css.settingGroupTitle}>模型可用工具（{(config?.tools ?? Object.keys(TOOL_DESC)).length} 个）</div>
        <div className={css.toolList}>
          {(config?.tools ?? Object.keys(TOOL_DESC)).map(name => (
            <div key={name} className={css.toolRow}>
              <span className={css.toolName}>{name}</span>
              <span className={css.toolDesc}>{TOOL_DESC[name] ?? ''}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={css.settingGroup}>
        <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={onClose}>
          <IconChevronDownOutline14 size={13} />
          返回邮箱
        </button>
      </div>
    </div>
  )
}
