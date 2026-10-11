/**
 * dsh-soul —— 灵魂面板（记忆工作台第四层「灵魂」Tab 的内容）。
 *
 * ── 这一层是什么 ──────────────────────────────────────────────────────
 * 记忆库回答「记住什么」，灵魂回答「我是谁」。它由两块组成：一段用户可编辑的
 * markdown 人设（soul.md 正文）+ 一组结构化身份字段（名字/角色/语气/语言/准则），
 * 每会话首步注入一次、跨会话恒定，与记忆注入的开关互不影响。
 *
 * ── 设计取舍 ──────────────────────────────────────────────────────────
 * 1. **诚实空态优先**。client 与 host 各自独立部署：插件更新后浏览器刷新即生效，
 *    host 要重启 DSH 才换新。这段窗口里旧 host 没有 /soul 路由，面板必须说
 *    「host 半身未更新，请重启 DSH」，而不是显示一个空的、看起来像「你还没写」
 *    的编辑器——那会让用户以为数据丢了。判断由 api.isHostStale 给出。
 * 2. **本地草稿 + 显式保存**。正文与身份字段都先在本地编辑，改动未保存时给
 *    「有未保存的修改」提示与「撤销修改」；保存成功给按钮内打勾 + 顶部 notice
 *    淡入淡出（不用 alert）。切档案/刷新回来以 host 回包为准，不本地假装成功。
 * 3. **蒸馏不落盘**。蒸馏结果是一份草案，面板并排展示「当前灵魂 vs 草案」的
 *    两栏 diff（差异行整行高亮），用户点「采用草案」才写库。模型输出永远不直接
 *    覆盖用户的身份契约。
 * 4. **零运行时依赖**。所有动效都是 CSS（入场错峰、草案位移落位、按钮打勾、
 *    转圈、diff 行底色过渡），没有引入任何动画库。
 * 5. **api 由调用方传入且必须稳定引用**。props.api 每次渲染都新建的话，加载
 *    effect 会随渲染重发请求（记忆面板历史上打过一分钟 498 次的请求风暴）。
 *    Lead 侧用 useMemo 固定；本组件内部只用 ref 持有它。
 * 6. **卡片是权威，正文是投影**（2026-10-05 卡片化）。面板顶部一枚会动的 DSH 鲸鱼，
 *    其下是「卡片区」：每张卡单独开关、单独编辑、单独排序；再下面是预设库。
 *    原先那套「整段正文 / 身份四件套 / 档案 / 蒸馏」**一个都没删**，收进一个默认
 *    展开的折叠区——它们是整段改写的入口，而卡片是逐项调的入口，两者都留着。
 *    保存卡片后以 host 回包为准刷新（正文由 host 用卡片重算），不本地拼接。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  ProfileView,
  SoulApi,
  SoulDraft,
  SoulIdentity,
  SoulUser,
  SoulView,
  SoulDistillStats,
} from './api.js'
import {
  AVATAR_USER_ID,
  EMPTY_IDENTITY,
  EMPTY_SOUL,
  EMPTY_SOUL_USER,
  USER_NAME_MAX,
  USER_PROFILE_MAX,
} from './api.js'
import type { SoulCard, SoulCardsResponse, SoulPreset } from './api.js'
import { CardsSection } from './CardsSection.js'
import { ProfileGallery, type RoleCard } from './ProfileGallery.js'
import { SoulMarkdown } from './Markdown.js'
import { WhaleLogo } from './WhaleLogo.js'
import { makeSoulT, SOUL_CHAR_LIMIT, type SoulT } from './locales.js'
import { css, ensureSoulStyles } from './styles.js'

/** SoulPanel 属性。 */
export interface SoulPanelProps {
  /** 灵魂 API 面（调用方用 useMemo 固定引用，避免每渲染重发请求）。 */
  api: SoulApi
  onClose?: () => void
  /** 嵌在记忆工作台里（true 时不自带滚动容器与外框）。 */
  embedded?: boolean
  /** 翻译函数（缺省跟随 <html lang>）。 */
  t?: SoulT
}

/** 顶部 notice 的自动消失时长（毫秒）。 */
const NOTICE_MS = 2400

/** 灵魂档案数量上限（host 侧不设限，但 UI 只服务「几种人格」这种量级）。 */
const PROFILE_LIMIT = 20

/**
 * 非激活角色卡里最多预览几张卡片标题。
 *
 * 为什么要有上限：一排卡里只有一张是展开的，其余窄条/次宽卡的预览区高度有限；
 * 一张预设可能有十几张卡，全列出来会把卡撑得比激活卡还高，一排卡的节奏就乱了。
 * 超出部分由「还有 N 张」收尾。
 */
const PREVIEW_CARDS = 4

/** 保存按钮的三种反馈态。 */
type SaveFeedback = 'idle' | 'busy' | 'done'

/** 通知（顶部淡入淡出条）。 */
interface Notice {
  kind: 'ok' | 'err'
  text: string
}

/** 规范化身份草稿：与 host 的 SoulIdentity 同形，principles 去掉纯空白行。 */
function toIdentity(source: SoulIdentity): SoulIdentity {
  return {
    name: source.name.trim(),
    role: source.role.trim(),
    tone: source.tone.trim(),
    language: source.language.trim(),
    principles: source.principles.map(item => item.trim()).filter(item => item !== ''),
  }
}

/** 身份是否等价（用于「有没有改动」判断；principles 按行序比较）。 */
function sameIdentity(a: SoulIdentity, b: SoulIdentity): boolean {
  return a.name === b.name
    && a.role === b.role
    && a.tone === b.tone
    && a.language === b.language
    && a.principles.length === b.principles.length
    && a.principles.every((item, index) => item === b.principles[index])
}

/** 时间戳 → 本地短时间（读不出来就原样返回，不显示 Invalid Date）。 */
function formatTime(iso: string | null): string {
  if (iso === null || iso === '') return ''
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 错误 → 可读文案。 */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

/**
 * 逐行 LCS 对齐（diff 用）。
 *
 * 灵魂正文通常几十行，O(n·m) 的动态规划完全够用；文本一致时走 Map 快路径，
 * 避免「只是重新保存一次」也跑一遍全量 DP。行数过大时退化为「整体替换」，
 * 防止极端输入把主线程卡住。
 */
function diffLines(
  left: readonly string[],
  right: readonly string[],
): { left: Array<{ text: string; changed: boolean }>; right: Array<{ text: string; changed: boolean }> } {
  const LIMIT = 400
  if (left.length > LIMIT || right.length > LIMIT) {
    return {
      left: left.map(text => ({ text, changed: true })),
      right: right.map(text => ({ text, changed: true })),
    }
  }
  const n = left.length
  const m = right.length
  // dp[i][j] = left[i..] 与 right[j..] 的最长公共子序列长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const outLeft: Array<{ text: string; changed: boolean }> = []
  const outRight: Array<{ text: string; changed: boolean }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      outLeft.push({ text: left[i], changed: false })
      outRight.push({ text: right[j], changed: false })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      outLeft.push({ text: left[i], changed: true })
      i += 1
    } else {
      outRight.push({ text: right[j], changed: true })
      j += 1
    }
  }
  while (i < n) { outLeft.push({ text: left[i], changed: true }); i += 1 }
  while (j < m) { outRight.push({ text: right[j], changed: true }); j += 1 }
  return { left: outLeft, right: outRight }
}

/** 拆分正文为行（空文本给一行占位，避免 diff 区塌成 0 高）。 */
function splitLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

/** 灵魂图标（面板标题 / Tab / composer 按钮共用）。 */
export function SoulIcon({ size = 16 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* 一个「内核 + 环绕」的抽象灵魂：中心实心点表示恒定人设，两圈弧表示跨会话环绕 */}
      <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
      <path d="M3.4 5.1a5.4 5.4 0 0 0 0 5.8" />
      <path d="M12.6 5.1a5.4 5.4 0 0 1 0 5.8" />
      <path d="M1.6 3.2a8.2 8.2 0 0 0 0 9.6" opacity=".55" />
      <path d="M14.4 3.2a8.2 8.2 0 0 1 0 9.6" opacity=".55" />
    </svg>
  )
}

/** 小勾（保存成功反馈）。 */
function CheckIcon({ size = 13 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.2 8.4 6.4 11.6 12.8 4.8" />
    </svg>
  )
}

/** 转圈（蒸馏 / 保存进行中）。 */
function SpinIcon({ size = 13 }: { readonly size?: number }): JSX.Element {
  return (
    <span className={css.spin} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M8 1.6a6.4 6.4 0 1 1-6.4 6.4" />
      </svg>
    </span>
  )
}

/** 蒸馏图标（星火）。 */
function SparkIcon({ size = 14 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 9.5 6 13.7 7.5 9.5 9 8 13.2 6.5 9 2.3 7.5 6.5 6z" />
    </svg>
  )
}

/** 骨架屏（首帧加载）。 */
function Skeleton(): JSX.Element {
  return (
    <div className={css.skeleton} aria-hidden="true">
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
    </div>
  )
}

/** 灵魂面板主体。 */
export function SoulPanel({ api, onClose, embedded = false, t = makeSoulT() }: SoulPanelProps): JSX.Element {
  ensureSoulStyles()
  // api 只经 ref 使用：即使调用方忘了 memo，也不会让加载 effect 反复重跑。
  const apiRef = useRef(api)
  apiRef.current = api

  /** 加载态：loading | stale（host 未更新）| error | ready */
  const [status, setStatus] = useState<'loading' | 'stale' | 'error' | 'ready'>('loading')
  const [error, setError] = useState('')
  /** host 侧当前灵魂（保存/采用后以回包为准）。 */
  const [soul, setSoul] = useState<SoulView>(EMPTY_SOUL)
  const [profiles, setProfiles] = useState<ProfileView[]>([])

  // ── 本地草稿（正文 + 结构化身份） ──
  const [draftText, setDraftText] = useState('')
  const [draftIdentity, setDraftIdentity] = useState<SoulIdentity>(EMPTY_IDENTITY)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveFeedback>('idle')

  // 注：原先这里有个 previewTab（卡片 / 全文 两视图）。统摄改版后卡片预览搬进了
  // 画廊的激活卡，这一栏只剩「注入全文」，段控失去意义 —— 状态随之删除。

  // ── 蒸馏 ──
  const [distilling, setDistilling] = useState(false)
  const [draft, setDraft] = useState<SoulDraft | null>(null)
  const [stats, setStats] = useState<SoulDistillStats | null>(null)
  const [applying, setApplying] = useState(false)

  // ── 档案（角色）──
  // 新建表单的名字 / 定位 / 标签草稿现在由 ProfileGallery 自己持有（表单与卡片同排，
  // 状态跟着卡片走更近）；面板这边只留两个「有请求在飞」的标志位。
  const [profileBusy, setProfileBusy] = useState(false)
  /** 角色头像请求在飞（与切换/新建分开：同时点两张卡的头像不该互相禁用）。 */
  const [profileAvatarBusy, setProfileAvatarBusy] = useState(false)
  /** 预设套用/删除在飞（带 id + 模式，让按钮内能转圈）。 */
  const [presetBusy, setPresetBusy] = useState<{ presetId: string; mode: 'replace' | 'merge' } | null>(null)
  /** 「存为预设」保存请求在飞。 */
  const [presetSaving, setPresetSaving] = useState(false)

  /**
   * 「我的资料」（用户侧身份，2026-10-09 补回）。
   *
   * 这一块 host 与 api/client 两侧的端点、类型、文案、样式一直都在
   * （GET/POST /soul/user + AVATAR_USER_ID 头像），只是上一次版式改版把**界面**
   * 整块弄丢了——用户打开面板再也改不了自己的称呼与档案，而磁盘上的 user.json
   * 仍然生效（注入侧的「## 用户」段照常拼），于是表现为「档案像消失了」。
   *
   * 状态刻意与灵魂草稿分开：改自己的名字不该 bump 人格版本号、也不该被
   * 「保存灵魂」按钮顺带提交（host 侧本来就是两条独立写路径）。
   */
  const [meName, setMeName] = useState('')
  const [meProfile, setMeProfile] = useState('')
  const [meDirty, setMeDirty] = useState(false)
  const [meSaving, setMeSaving] = useState(false)
  const [meSaved, setMeSaved] = useState(false)
  /** 用户头像文件名（null = 未上传）+ 上传中标志。 */
  const [meAvatar, setMeAvatar] = useState<string | null>(null)
  const [meAvatarBusy, setMeAvatarBusy] = useState(false)
  /** 头像缓存破坏值：换图后路径不变，不加它浏览器会一直显示旧脸。 */
  const [meAvatarBust, setMeAvatarBust] = useState(0)
  const meFileRef = useRef<HTMLInputElement | null>(null)
  /** meDirty 的镜像：回包要按**最新**的脏标记决定是否覆盖我的资料草稿。 */
  const meDirtyRef = useRef(false)
  meDirtyRef.current = meDirty

  // ── 注入开关 ──
  const [injectOn, setInjectOn] = useState(true)
  const [injectKnown, setInjectKnown] = useState(false)
  const [injectBusy, setInjectBusy] = useState(false)

  // ── 顶部通知 ──
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeTimer = useRef<number | null>(null)

  /** 弹一条会自动消失的顶部通知（不用 alert）。 */
  const flash = useCallback((next: Notice): void => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    setNotice(next)
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null
      setNotice(null)
    }, NOTICE_MS)
  }, [])

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
  }, [])

  /** 把 host 回包灌进本地状态（同时覆盖草稿）。 */
  const adopt = useCallback((next: SoulView, nextProfiles: ProfileView[]): void => {
    setSoul(next)
    setProfiles(nextProfiles)
    setDraftText(next.content)
    setDraftIdentity(next.identity)
    setDirty(false)
    // 「我的资料」跟着回包走，但**不覆盖正在编辑的草稿**——用户敲了半句名字，
    // 这时切人格/存卡片触发一次回包，草稿被冲掉就是丢字。
    if (!meDirtyRef.current) {
      setMeName(next.user.name)
      setMeProfile(next.user.profile)
    }
    setMeAvatar(next.userAvatar)
  }, [])

  /** 拉取灵魂 + 档案。 */
  const load = useCallback((): void => {
    setStatus('loading')
    void apiRef.current.load()
      .then(response => {
        adopt(response.soul, response.profiles)
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) {
          setStatus('stale')
          return
        }
        setError(errorText(reason))
        setStatus('error')
      })
  }, [adopt])

  /** 拉取注入开关状态。 */
  const loadState = useCallback((): void => {
    void apiRef.current.getState()
      .then(response => { setInjectOn(response.enabled !== false); setInjectKnown(true) })
      .catch(() => { setInjectKnown(false) })
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadState() }, [loadState])

  // ── 卡片 / 预设（卡片是灵魂的权威形态，正文由 host 用卡片重算） ──
  const [cards, setCards] = useState<SoulCard[]>([])
  const [presets, setPresets] = useState<SoulPreset[]>([])
  /** 卡片区是否可用：false = 这版 host 没有 /soul/cards（卡片降级，其余照常）。 */
  const [cardsAvailable, setCardsAvailable] = useState(true)
  /** 「存为预设」表单要用的卡片快照；null = 表单收起。 */
  const [saveAs, setSaveAs] = useState<SoulCard[] | null>(null)
  // 说明：修改区（整段正文 / 身份字段 / 档案 / 蒸馏）**常驻展开**，2026-10-06 二轮
  // 删掉了外层折叠按钮（用户原话「这个折叠去掉」）。它原先是默认收起的折叠区，
  // 理由是「展开会把首屏占满」——那是它当年跨整页铺在最下面时的判断；现在它只占
  // 右栏半屏、自己会滚，常驻才是正确默认态，也不再需要 legacyOpen 这个状态。
  /** dirty 的镜像：卡片回包要按**最新**的 dirty 决定是否覆盖正文草稿。 */
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  /** t 的镜像：t 缺省是每次渲染新建的函数，放进 useCallback 依赖会导致请求风暴。 */
  const tRef = useRef(t)
  tRef.current = t

  /** 把卡片回包灌进面板：卡片是权威，正文按 host 重算结果刷新。 */
  const onCards = useCallback((response: SoulCardsResponse): void => {
    setCards(response.cards)
    if (response.soul === null) return
    setSoul(response.soul)
    // 用户有未保存的正文改动时不覆盖草稿——那会把正在敲的字吞掉；
    // 此时 host 的新正文已经记在 soul 里，用户「撤销修改」即可拿到。
    if (!dirtyRef.current) {
      setDraftText(response.soul.content)
      setDraftIdentity(response.soul.identity)
    }
    // 「我的资料」同款口径：卡片写入的回包也带着 user，别让它把用户在编辑的
    // 称呼冲掉（同一个坑，两处都要防）。
    if (!meDirtyRef.current) {
      setMeName(response.soul.user.name)
      setMeProfile(response.soul.user.profile)
    }
    setMeAvatar(response.soul.userAvatar)
  }, [])

  /** 拉取卡片 + 预设。卡片读不出来不拖垮正文与档案，只降级卡片区。 */
  const loadCards = useCallback((): void => {
    void Promise.all([
      apiRef.current.loadCards(),
      // 预设单独兜底：它挂了也不该让卡片区一起不可用。
      apiRef.current.loadPresets().catch(() => [] as SoulPreset[]),
    ])
      .then(([cardResponse, presetList]) => {
        setCards(cardResponse.cards)
        setPresets(presetList)
        setCardsAvailable(true)
        if (cardResponse.soul !== null && !dirtyRef.current) {
          setSoul(cardResponse.soul)
          setDraftText(cardResponse.soul.content)
          setDraftIdentity(cardResponse.soul.identity)
        }
        // 「我的资料」独立于上面的正文草稿判定：它是另一份主体（用户自己），
        // 正文有未保存改动不代表我的资料也不能刷新。
        if (cardResponse.soul !== null) {
          if (!meDirtyRef.current) {
            setMeName(cardResponse.soul.user.name)
            setMeProfile(cardResponse.soul.user.profile)
          }
          setMeAvatar(cardResponse.soul.userAvatar)
        }
      })
      .catch((reason: unknown) => {
        setCardsAvailable(false)
        if (apiRef.current.isHostStale(reason)) return
        flash({ kind: 'err', text: tRef.current('soulCardsLoadFailed', { reason: errorText(reason) }) })
      })
  }, [flash])
  useEffect(() => { loadCards() }, [loadCards])

  const hasContent = soul.content.trim() !== '' || soul.identity.name !== '' || soul.identity.role !== ''
    || cards.some(card => card.enabled && card.body.trim() !== '')

  /** 保存：正文 + 身份一起提交（host 只认显式传入的字段）。 */
  const save = useCallback((): void => {
    if (saveState === 'busy') return
    setSaveState('busy')
    void apiRef.current.save({ content: draftText, identity: toIdentity(draftIdentity) })
      .then(response => {
        // profiles 为 null = 这版 host 没回这个字段 → 保留旧列表（[] 才是真的空）。
        adopt(response.soul, response.profiles ?? profiles)
        setSaveState('done')
        flash({ kind: 'ok', text: t('soulSavedNotice') })
        window.setTimeout(() => { setSaveState('idle') }, 900)
      })
      .catch((reason: unknown) => {
        setSaveState('idle')
        if (apiRef.current.isHostStale(reason)) { setStatus('stale'); return }
        flash({ kind: 'err', text: t('soulLoadFailed', { reason: errorText(reason) }) })
      })
  }, [adopt, draftIdentity, draftText, flash, profiles, saveState, t])

  /** 撤销未保存的修改，回到 host 已知状态。 */
  const resetDraft = useCallback((): void => {
    setDraftText(soul.content)
    setDraftIdentity(soul.identity)
    setDirty(false)
  }, [soul])

  /** 正文改动。 */
  const onText = useCallback((next: string): void => {
    setDraftText(next)
    setDirty(true)
  }, [])

  /** 身份字段改动。 */
  const onIdentity = useCallback((patch: Partial<SoulIdentity>): void => {
    setDraftIdentity(prev => ({ ...prev, ...patch }))
    setDirty(true)
  }, [])

  /** 从记忆库蒸馏一份草案。 */
  const distill = useCallback((): void => {
    if (distilling) return
    setDistilling(true)
    void apiRef.current.distill()
      .then(result => {
        if (!result.ok) {
          const failed = result.failed === 'empty' ? t('soulDistillEmpty')
            : result.failed === 'no-model' ? t('soulDistillNoModel')
              : t('soulDistillFailed', { reason: result.failed })
          flash({ kind: 'err', text: failed })
          return
        }
        setDraft(result.draft)
        setStats(result.stats ?? null)
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setStatus('stale'); return }
        flash({ kind: 'err', text: t('soulDistillFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setDistilling(false) })
  }, [distilling, flash, t])

  /** 采用草案（落盘）。 */
  const applyDraft = useCallback((): void => {
    if (draft === null || applying) return
    setApplying(true)
    void apiRef.current.apply(draft)
      .then(response => {
        setSoul(response.soul)
        setDraftText(response.soul.content)
        setDraftIdentity(response.soul.identity)
        setDirty(false)
        setDraft(null)
        setStats(null)
        flash({ kind: 'ok', text: t('soulDraftApplied') })
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setStatus('stale'); return }
        flash({ kind: 'err', text: t('soulDistillFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setApplying(false) })
  }, [applying, draft, flash, t])

  /** 切换激活档案（null = 回主档）。 */
  const activate = useCallback((profileId: string | null): void => {
    if (profileBusy) return
    setProfileBusy(true)
    void apiRef.current.activateProfile(profileId)
      .then(response => {
        adopt(response.soul, response.profiles ?? profiles)
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setStatus('stale'); return }
        flash({ kind: 'err', text: t('soulProfileSwitchFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setProfileBusy(false) })
  }, [adopt, flash, profileBusy, profiles, t])

  /**
   * 保存角色卡的展示件（desc / tag）。
   *
   * 走 `save` 的**独立路径**：只带 desc/tag、不带 content/identity，host 侧因此
   * 不重算卡片、不 bump 版本号（见 host router.ts:196-204 的 metaOnly 分支）。
   * 改一句定位不该被当成「改了人格」——版本号一动，注入缓存与卡片投影全部重算。
   */
  const saveProfileMeta = useCallback((profileId: string | null, meta: { desc?: string; tag?: string }): void => {
    if (profileBusy) return
    setProfileBusy(true)
    void apiRef.current.save({ profileId, ...meta })
      .then(response => { adopt(response.soul, response.profiles ?? profiles) })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setStatus('stale'); return }
        flash({ kind: 'err', text: t('soulProfileMetaSaveFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setProfileBusy(false) })
  }, [adopt, flash, profileBusy, profiles, t])

  /** 角色头像上传（dataUrl 已由画廊读好；这里只负责发请求与回包校准）。 */
  const uploadProfileAvatar = useCallback((profileId: string | null, dataUrl: string): void => {
    setProfileAvatarBusy(true)
    void apiRef.current.uploadAvatar(profileId, dataUrl)
      .then(response => {
        if (response.avatar === null) {
          flash({ kind: 'err', text: t('soulProfileAvatarFailed', { reason: 'host rejected' }) })
          return
        }
        // 头像换图后路径不变，必须重取一次视图拿新的 bust 值（否则旧脸留在缓存里）。
        return apiRef.current.load().then(next => { adopt(next.soul, next.profiles) })
      })
      .catch((reason: unknown) => {
        flash({ kind: 'err', text: t('soulProfileAvatarFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setProfileAvatarBusy(false) })
  }, [adopt, flash, t])

  /** 移除角色头像。 */
  const removeProfileAvatar = useCallback((profileId: string | null): void => {
    setProfileAvatarBusy(true)
    void apiRef.current.removeAvatar(profileId)
      .then(() => apiRef.current.load().then(next => { adopt(next.soul, next.profiles) }))
      .catch((reason: unknown) => {
        flash({ kind: 'err', text: t('soulProfileAvatarFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setProfileAvatarBusy(false) })
  }, [adopt, flash, t])

  /** 头像被前端拦下（体积超限 / 读失败）——与「我的资料」同一套文案。 */
  const rejectProfileAvatar = useCallback((reason: 'tooLarge' | 'readFailed', detail: string): void => {
    flash({
      kind: 'err',
      text: reason === 'tooLarge'
        ? t('soulAvatarTooLarge', { size: detail })
        : t('soulAvatarReadFailed'),
    })
  }, [flash, t])

  /**
   * 套用预设（画廊里预设卡的动作）。
   *
   * 与 activate 是两条完全不同的路径：预设没有 profile id，套用它不改变「现在用的
   * 是哪份人格」，只把一套卡片替换/合并进当前人格。混成一个入口会让用户以为
   * 「点预设 = 切到某个叫工程搭档的人格」，而那个档案根本不存在。
   *
   * 回包只有 cards（host `/presets/apply` 的契约），所以卡片区要单独刷新一次；
   * 同时重读一次 soul —— 写卡片会连带重算生效层的正文（store.writeCards 的语义）。
   */
  const applyPreset = useCallback((presetId: string, mode: 'replace' | 'merge'): void => {
    if (presetBusy !== null) return
    setPresetBusy({ presetId, mode })
    void apiRef.current.applyPreset(presetId, mode)
      .then(response => {
        onCards(response)
        flash({ kind: 'ok', text: t('soulPresetApplied') })
        // 卡片写入会重算生效层正文，重新读一次让预览与卡片区同步。
        return apiRef.current.load().then(next => { adopt(next.soul, next.profiles) })
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setCardsAvailable(false); return }
        flash({ kind: 'err', text: t('soulPresetApplyFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setPresetBusy(null) })
  }, [adopt, flash, onCards, presetBusy, t])

  /** 删除自定义预设（内置的不给入口）。 */
  const removePreset = useCallback((presetId: string): void => {
    if (presetBusy !== null) return
    setPresetBusy({ presetId, mode: 'merge' })
    void apiRef.current.deletePreset(presetId)
      .then(next => { setPresets(next) })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setCardsAvailable(false); return }
        flash({ kind: 'err', text: t('soulPresetDeleteFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setPresetBusy(null) })
  }, [flash, presetBusy, t])

  /**
   * 把当前卡片存成新预设。
   *
   * 落点原本在预设区（PresetsSection），预设并进画廊后那块整块消失 —— 表单必须
   * 跟着搬到画廊末尾，否则「存为预设」按钮点了只是置状态、界面上什么都没发生。
   */
  const savePreset = useCallback((input: { name: string; desc: string }): void => {
    if (presetSaving) return
    setPresetSaving(true)
    void apiRef.current.createPreset({ name: input.name, desc: input.desc, cards: [...cards] })
      .then(response => {
        if (response.preset !== null) setPresets(current => [...current, response.preset as SoulPreset])
        setSaveAs(null)
        flash({ kind: 'ok', text: t('soulPresetSaved', { name: input.name }) })
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setCardsAvailable(false); return }
        flash({ kind: 'err', text: t('soulPresetSaveFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setPresetSaving(false) })
  }, [cards, flash, presetSaving, t])

  /**
   * 新建档案：以当前灵魂为种子，避免新档案是一片空白。
   *
   * desc / tag 由画廊表单一起收上来（与名字同一趟），走 host 的 cardMeta 参数落盘；
   * 分开两次请求会让「新建」这个动作在面板上闪两次。
   */
  const createProfile = useCallback((input: { name: string; desc: string; tag: string }): void => {
    const name = input.name.trim()
    if (name === '') { flash({ kind: 'err', text: t('soulProfileNameRequired') }); return }
    if (profileBusy) return
    setProfileBusy(true)
    void apiRef.current.createProfile(name, {
      content: draftText,
      identity: toIdentity(draftIdentity),
      desc: input.desc.trim(),
      tag: input.tag.trim(),
    })
      .then(response => {
        adopt(response.soul, response.profiles ?? profiles)
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setStatus('stale'); return }
        flash({ kind: 'err', text: t('soulProfileSwitchFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setProfileBusy(false) })
  }, [adopt, draftIdentity, draftText, flash, profileBusy, profiles, t])

  /**
   * 删除档案。契约里没有删除端点，host 若不认 remove 字段会原样忽略——以回包为准渲染。
   *
   * 入参只收 id（+ 展示用的 name / active），不收整份 ProfileView：删除这个动作
   * 真正需要的就只有「删谁」，以及回包回来时核对「它还在不在」。
   */
  const removeProfile = useCallback((target: { id: string; name: string; active: boolean }): void => {
    if (profileBusy) return
    setProfileBusy(true)
    void apiRef.current.removeProfile(target.id)
      .then(response => {
        adopt(response.soul, response.profiles ?? profiles)
        if (response.profiles !== null && response.profiles.some(item => item.id === target.id)) {
          // host 忽略了 remove 字段（尚未支持）：如实告知，不本地假装删掉。
          flash({ kind: 'err', text: t('soulProfileSwitchFailed', { reason: 'host ignored remove' }) })
        }
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) { setStatus('stale'); return }
        flash({ kind: 'err', text: t('soulProfileSwitchFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setProfileBusy(false) })
  }, [adopt, flash, profileBusy, t])

  /** 切换注入开关（乐观更新 + 失败回读真实状态）。 */
  const toggleInject = useCallback((): void => {
    if (injectBusy) return
    const next = !injectOn
    setInjectBusy(true)
    setInjectOn(next)
    void apiRef.current.setState(next)
      .then(response => { setInjectOn(response.enabled !== false); setInjectKnown(true) })
      .catch(() => { loadState() })
      .finally(() => { setInjectBusy(false) })
  }, [injectBusy, injectOn, loadState])

  // ── 我的资料：读写与头像（与灵魂是两条独立写路径，互不 bump 版本号） ──

  /** 我的资料改动（任一字段）。 */
  const onMe = useCallback((patch: Partial<SoulUser>): void => {
    if (patch.name !== undefined) setMeName(patch.name)
    if (patch.profile !== undefined) setMeProfile(patch.profile)
    setMeDirty(true)
    setMeSaved(false)
  }, [])

  /** 保存我的资料（整份覆盖：host 侧就是这么定义的，空串 = 清掉该字段）。 */
  const saveMe = useCallback((): void => {
    if (meSaving) return
    setMeSaving(true)
    void apiRef.current.saveUser({ name: meName.trim(), profile: meProfile.trim() })
      .then(response => {
        // 以回包为准：host 会对字段做 trim / 截断，本地假装成功会让面板显示
        // 一个与磁盘不同的值。
        setMeName(response.user.name)
        setMeProfile(response.user.profile)
        setMeAvatar(response.avatar)
        setMeDirty(false)
        setMeSaved(true)
        flash({ kind: 'ok', text: t('soulMeSaved') })
        window.setTimeout(() => { setMeSaved(false) }, 900)
      })
      .catch((reason: unknown) => {
        if (apiRef.current.isHostStale(reason)) {
          flash({ kind: 'err', text: tRef.current('soulMeSaveFailed', { reason: errorText(reason) }) })
          return
        }
        flash({ kind: 'err', text: t('soulMeSaveFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setMeSaving(false) })
  }, [flash, meName, meProfile, meSaving, t])

  /** 撤销我的资料改动。 */
  const resetMe = useCallback((): void => {
    setMeName(soul.user.name)
    setMeProfile(soul.user.profile)
    setMeDirty(false)
    setMeSaved(false)
  }, [soul.user.name, soul.user.profile])

  /** 头像上传（读成 data URL 后交给 host；体积与类型在前端先拦一道）。 */
  const onMeAvatarFile = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    // 清空 value：选了同一张图时 change 不再触发，等于「换回上一张」点不动。
    event.currentTarget.value = ''
    if (file === undefined) return
    if (file.size > 2 * 1024 * 1024) {
      flash({ kind: 'err', text: t('soulAvatarTooLarge', { size: `${(file.size / 1024 / 1024).toFixed(1)}MB` }) })
      return
    }
    setMeAvatarBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (dataUrl === '') {
        setMeAvatarBusy(false)
        flash({ kind: 'err', text: t('soulAvatarReadFailed') })
        return
      }
      void apiRef.current.uploadAvatar(AVATAR_USER_ID, dataUrl)
        .then(response => {
          if (response.avatar === null) {
            flash({ kind: 'err', text: t('soulAvatarFailed', { reason: 'host rejected' }) })
            return
          }
          setMeAvatar(response.avatar)
          setMeAvatarBust(Date.now())
        })
        .catch((reason: unknown) => {
          flash({ kind: 'err', text: t('soulAvatarFailed', { reason: errorText(reason) }) })
        })
        .finally(() => { setMeAvatarBusy(false) })
    }
    reader.onerror = () => {
      setMeAvatarBusy(false)
      flash({ kind: 'err', text: t('soulAvatarReadFailed') })
    }
    reader.readAsDataURL(file)
  }, [flash, t])

  /** 移除我的头像。 */
  const removeMeAvatar = useCallback((): void => {
    if (meAvatarBusy) return
    setMeAvatarBusy(true)
    void apiRef.current.removeAvatar(AVATAR_USER_ID)
      .then(() => {
        setMeAvatar(null)
        setMeAvatarBust(Date.now())
        flash({ kind: 'ok', text: t('soulAvatarRemoved') })
      })
      .catch((reason: unknown) => {
        flash({ kind: 'err', text: t('soulAvatarFailed', { reason: errorText(reason) }) })
      })
      .finally(() => { setMeAvatarBusy(false) })
  }, [flash, meAvatarBusy, t])

  /** 两栏 diff：当前灵魂 vs 草案。 */
  const diff = useMemo(() => {
    if (draft === null) return null
    return diffLines(splitLines(soul.content), splitLines(draft.content))
  }, [draft, soul.content])

  const charCount = draftText.length

  /**
   * 画廊里的角色列表：**主档 + 全部档案**，同级同形。
   *
   * 主档没有 profile id，但它在「切谁就注入谁」这件事上与档案完全同类，只是恰好
   * 没有 id（见 host store.view 的两个分支）。把它单列成一段会让用户以为它是另一种
   * 东西；放进同一排、同样可点，语义才对。
   *
   * 主档的展示字段只能从**当前 soul 视图**取：soul.identity 描述的就是「现在生效
   * 的那份人格」。所以主档卡片在**非激活**状态下，铭牌显示的是「当前生效人格」的
   * 语气/语言，而不是主档自己那份——这是数据面的既有约束（ProfileView 只列档案、
   * 不含主档），不在这里造假数据；激活主档后它自然就准了。
   *
   * **必须放在下面所有 early return 之前**：它是个 Hook，而 loading / stale / error
   * 三个分支会提前 return。Hook 落在 return 之后就违反 Hooks 规则——那三个分支下
   * 少执行一个 Hook，React 直接抛 error #310（Rendered fewer hooks than expected），
   * 整页被错误边界兜住变空白。实测踩过：加载态一闪过，工作台整页崩。
   */
  const roles = useMemo<RoleCard[]>(() => {
    /**
     * 主档卡的数据源。
     *
     * soul.* 描述的是**当前生效的那份人格**：激活档案时，回包里的 identity / desc /
     * tag / avatar 全是那份档案的，主档自己的这些值 host 根本没回（view() 在档案
     * 分支不读 base）。所以主档卡只有在**它自己就是激活态**（profileId === null）
     * 时才照抄 soul.*；否则一律退化成占位——不然主档卡会顶别人的名字和脸，
     * 画廊里出现两张同名卡（端到端实测踩过）。
     */
    const baseActive = soul.profileId === null
    const base: RoleCard = {
      id: null,
      source: 'base',
      presetId: null,
      name: baseActive
        ? (soul.identity.name === '' ? t('soulProfileMain') : soul.identity.name)
        : t('soulProfileMain'),
      active: baseActive,
      updatedAt: baseActive ? soul.updatedAt : null,
      desc: baseActive ? soul.desc : '',
      tag: baseActive ? soul.tag : '',
      avatar: baseActive ? soul.avatar : null,
      role: baseActive ? soul.identity.role : '',
      tone: baseActive ? soul.identity.tone : '',
      language: baseActive ? soul.identity.language : '',
      principles: baseActive ? soul.identity.principles.length : 0,
      // 卡片统计来自 cards 接口，与「哪份人格在生效」无关，主档随时可显示。
      cardsOn: cards.filter(card => card.enabled).length,
      cardsTotal: cards.length,
      version: baseActive ? soul.version : 0,
      detailKnown: baseActive,
      builtin: false,
      // 激活时预览就是本尊的卡片；非激活时卡片接口给的是「生效层」的，
      // 与主档无关，故不冒充（detailKnown 已表达这层诚实）。
      cardTitles: baseActive ? cards.slice(0, PREVIEW_CARDS).map(card => card.title) : [],
    }
    const rest: RoleCard[] = profiles.map(profile => ({
      id: profile.id,
      source: 'profile',
      presetId: null,
      name: profile.name,
      active: profile.active,
      updatedAt: profile.updatedAt,
      desc: profile.desc,
      tag: profile.tag,
      avatar: profile.avatar,
      // 这三个字段由 host profileViews 提供（2026-10 新增展示件）；旧 host 不回时
      // 归一化成空串/0，卡片铭牌退化成「—」，不崩也不编。
      role: profile.role,
      tone: profile.tone,
      language: profile.language,
      principles: profile.principles,
      cardsOn: profile.cardsOn,
      cardsTotal: profile.cardsTotal,
      version: 0,
      // 档案的详情 host 总是给（它就是 profile JSON 本身），与激活态无关。
      detailKnown: true,
      builtin: false,
      // 激活档案时 cards 就是它的卡片（host cards() 读生效层）；非激活档案
      // 拿不到它的卡片标题（ProfileView 不带），预览留空 —— 不编。
      cardTitles: profile.active ? cards.slice(0, PREVIEW_CARDS).map(card => card.title) : [],
    }))
    /**
     * 预设也进这一排。
     *
     * 它们本来就是「一个角色」（工程搭档 / 严谨分析师 / 罗莉…），用户心里点它就是
     * 「换个人」。上一版把预设单独摆在另一块网格里，等于同一件事两个入口 ——
     * 正是用户说的「又一个新的这么冗余」。
     *
     * 但**语义必须可分辨**：预设没有 profile id，点它不是 activate 而是
     * applyPreset（把一套卡片套进当前人格）。所以它们带 source='preset' 与
     * presetId，动作按钮走「合并 / 替换」而不是「启用」。
     *
     * 排序刻意放在主档与档案之后：可激活的人格在前（那是「我在用谁」），
     * 现成模板在后（那是「我想变成谁」）。
     */
    const presetCards: RoleCard[] = presets.map(preset => ({
      id: null,
      source: 'preset',
      presetId: preset.id,
      name: preset.name,
      // 预设不是「当前生效的人格」，永远不可能是激活态。
      active: false,
      updatedAt: null,
      desc: preset.desc,
      tag: '',
      avatar: null,
      // 预设的「身份」由它那套卡片决定，这里没有独立字段可读 —— 留空，
      // 铭牌走 detailKnown=false 的「—」，不编。
      role: '',
      tone: '',
      language: '',
      principles: 0,
      cardsOn: preset.cards.filter(card => card.enabled).length,
      cardsTotal: preset.cards.length,
      version: 0,
      detailKnown: false,
      builtin: preset.builtin,
      cardTitles: preset.cards.slice(0, PREVIEW_CARDS).map(card => card.title),
    }))
    return [base, ...rest, ...presetCards]
  }, [cards, presets, profiles, soul, t])

  if (status === 'loading') {
    return (
      <div className={css.root}>
        <div className={css.header}>
          <div className={css.headMain}>
            <span className={css.title}><SoulIcon size={16} />{t('soulTitle')}</span>
            <span className={css.desc}>{t('soulDesc')}</span>
          </div>
        </div>
        <Skeleton />
      </div>
    )
  }

  // ── host 未更新：诚实空态（不是「你还没写灵魂」） ──
  if (status === 'stale') {
    return (
      <div className={css.root}>
        <div className={css.header}>
          <div className={css.headMain}>
            <span className={css.title}><SoulIcon size={16} />{t('soulTitle')}</span>
            <span className={css.desc}>{t('soulDesc')}</span>
          </div>
        </div>
        <div className={`${css.empty} ${css.stale}`} role="status">
          <span className={css.emptyIcon}><SoulIcon size={26} /></span>
          <span className={css.emptyText}>{t('soulHostStale')}</span>
          <span className={css.emptyHint}>{t('soulHostStaleHint')}</span>
          <div className={css.actions}>
            <button type="button" className={css.btn} onClick={load}>{t('soulRetry')}</button>
            {onClose !== undefined && (
              <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={onClose}>{t('soulClose')}</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── 真失败 ──
  if (status === 'error') {
    return (
      <div className={css.root}>
        <div className={css.header}>
          <div className={css.headMain}>
            <span className={css.title}><SoulIcon size={16} />{t('soulTitle')}</span>
            <span className={css.desc}>{t('soulDesc')}</span>
          </div>
        </div>
        <div className={css.empty} role="alert">
          <span className={css.emptyText}>{t('soulLoadFailed', { reason: error })}</span>
          <div className={css.actions}>
            <button type="button" className={css.btn} onClick={load}>{t('soulRetry')}</button>
          </div>
        </div>
      </div>
    )
  }


  const body = (
    <>
      {/* ── 头部：会动的 DSH 鲸鱼 + 标题 ──
          左列那枚「人格核心卡」（SoulPersonaCard）已被统摄式画廊取代：它显示的名字 /
          角色 / 语气 / 语言 / 准则 / 卡片统计，现在就在画廊的激活卡上，而且**可切换**
          —— 同一份信息摆在两处、其中一处还不能操作，正是用户说的冗余。
          鲸鱼本身留着（它是这一层的门面，不是重复信息），跟着标题行。 */}
      <div className={css.header}>
        <div className={css.brand}>
          <span className={css.hero} aria-label={t('soulWhaleLabel')} role="img">
            <WhaleLogo size={30} />
          </span>
          <div className={css.headMain}>
            <span className={css.title}><SoulIcon size={16} />{t('soulTitle')}</span>
            <span className={css.desc} title={t('soulDesc')}>{t('soulDesc')}</span>
          </div>
        </div>
      </div>

      {/* ── 顶部通知（淡入淡出，不用 alert） ── */}
      <div
        className={[
          css.notice,
          notice === null ? '' : css.noticeOn,
          notice?.kind === 'err' ? css.noticeErr : css.noticeOk,
        ].filter(Boolean).join(' ')}
        role="status"
        aria-live="polite"
      >
        {notice !== null && (notice.kind === 'err' ? '⚠ ' : <CheckIcon size={12} />)}
        {notice?.text ?? ''}
      </div>

      {/* ── 蒸馏草案（有草案时才出现，位移 + 淡入落位） ── */}
      {draft !== null && (
        <section className={css.draft} aria-label={t('soulDraftTitle')}>
          <div className={css.draftHead}>
            <span className={css.draftTitle}><SparkIcon />{t('soulDraftTitle')}</span>
            {stats?.entries !== undefined && (
              <span className={css.draftStats}>{t('soulDistillStats', { n: stats.entries })}</span>
            )}
            <div className={css.actions}>
              <button
                type="button"
                className={`${css.btn} ${css.btnPrimary}`}
                disabled={applying}
                onClick={applyDraft}
              >
                {applying ? <SpinIcon /> : <CheckIcon />}
                {applying ? t('soulDraftApplying') : t('soulDraftApply')}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnGhost}`}
                disabled={applying}
                onClick={() => { setDraft(null); setStats(null) }}
              >
                {t('soulDraftDiscard')}
              </button>
            </div>
          </div>
          {draft.notes !== undefined && draft.notes !== '' && (
            <div className={css.draftNotes}>
              <strong>{t('soulDraftNotes')}</strong>
              {'\n'}{draft.notes}
            </div>
          )}
          {diff !== null && (
            <>
              <div className={css.diff}>
                <div className={css.diffCol}>
                  <div className={css.diffColHead}>{t('soulDraftCurrent')}</div>
                  <div className={css.diffBody}>
                    {diff.left.length === 0
                      ? <p className={css.diffLine}>{t('soulDraftEmptySide')}</p>
                      : diff.left.map((line, index) => (
                        <p
                          key={`l${String(index)}`}
                          className={`${css.diffLine} ${line.changed ? css.diffLineDel : css.diffLineSame}`}
                        >{line.text === '' ? ' ' : line.text}</p>
                      ))}
                  </div>
                </div>
                <div className={css.diffDivider} />
                <div className={css.diffCol}>
                  <div className={css.diffColHead}>{t('soulDraftTitle')}</div>
                  <div className={css.diffBody}>
                    {diff.right.length === 0
                      ? <p className={css.diffLine}>{t('soulDraftEmptySide')}</p>
                      : diff.right.map((line, index) => (
                        <p
                          key={`r${String(index)}`}
                          className={`${css.diffLine} ${line.changed ? css.diffLineAdd : css.diffLineSame}`}
                        >{line.text === '' ? ' ' : line.text}</p>
                      ))}
                  </div>
                </div>
              </div>
              <span className={css.diffHint}>{t('soulDraftHint')}</span>
            </>
          )}
        </section>
      )}

      {/* ── 角色画廊：**这一页唯一的角色入口**（2026-10 统摄改版）────────────
          用户原话：「我要的是相当于把他们都替换掉，而不是又一个新的这么冗余」。
          上一版画廊只是并列加进来的第三块（左列人格核心卡 / 右列卡片区 / 右列预设区
          之外又多一块），等于把「换人格」这件事拆到四个地方讲。

          现在它吃掉三块：
            · 左列**人格核心卡**（大鲸鱼 + 名字 + 铭牌）—— 画廊宽卡就是它，而且能切
            · 右列**卡片区**（那 5 张卡）—— 搬进激活卡的肚子里（cardsSlot），
              「我切的人格里有什么」与「我用的是谁」在同一个视线里
            · 右列**预设区**（8 套）—— 预设本来就是「一个角色」，并进同一排卡，
              点一下套用；它们的动作是「套进当前人格」而不是「换人」，
              靠来源徽标（虚线边框）与按钮（合并/替换）区分

          保留在主列之外的：蒸馏草案（跨栏 diff）、我的资料（用户自己的身份，
          与「我是谁」无关）、深改区（正文/身份/开关，低频）。 */}
      <ProfileGallery
        api={apiRef.current}
        roles={roles}
        onActivate={activate}
        busy={profileBusy}
        onSaveMeta={saveProfileMeta}
        onUploadAvatar={uploadProfileAvatar}
        onAvatarRejected={rejectProfileAvatar}
        onRemoveAvatar={removeProfileAvatar}
        onCreate={createProfile}
        onRemove={removeProfile}
        atLimit={profiles.length >= PROFILE_LIMIT}
        avatarBusy={profileAvatarBusy}
        onApplyPreset={applyPreset}
        presetBusy={presetBusy}
        onRemovePreset={removePreset}
        onSaveAsPreset={() => { setSaveAs(cards) }}
        saveAsOpen={saveAs !== null}
        onSaveAsPresetDone={() => { setSaveAs(null) }}
        onSavePreset={savePreset}
        presetSaving={presetSaving}
        cardsAvailable={cardsAvailable}
        cardsSlot={cardsAvailable
          ? (
            <CardsSection
              api={apiRef.current}
              cards={cards}
              presets={presets}
              onCards={onCards}
              onPresets={setPresets}
              onStale={() => { setCardsAvailable(false) }}
              onError={message => { flash({ kind: 'err', text: tRef.current('soulCardsSaveFailed', { reason: message }) }) }}
              onSaveAsPreset={next => { setSaveAs(next) }}
              t={t}
            />
          )
          : null}
        t={t}
      />

      {/* ── 预览区（2026-10 统摄改版后只剩「全文」）─────────────────────────
          卡片预览搬进了画廊的激活卡（cardsSlot）——「这份人格里有什么」现在紧贴着
          「我用的是谁」。这里只留**注入全文**：它是卡片装配的投影，用途不同
          （核对最终注入模型的字面文本、看有没有超预算），所以独立成一块。
          段控只剩一个 Tab 时不再需要，直接以区头表达。 */}
      <div className={css.work}>
        <div className={css.stage}>
          <div className={`${css.pane} ${css.panePreview}`} data-soul-zone="preview">
            <div className={css.paneHead}>
              <span className={css.paneTitle}><SoulIcon size={14} />{t('soulPreviewTextTab')}</span>
              <span className={css.paneHint} title={t('soulPreviewRendered')}>{t('soulPreviewRendered')}</span>
              <span className={css.paneHint} />
              <span
                className={dirty ? `${css.state} ${css.stateDirty}` : `${css.state} ${css.stateSaved}`}
                title={[
                  dirty ? t('soulDirty') : t('soulUnchanged'),
                  t('soulVersion', { n: soul.version }),
                  soul.updatedAt === null ? t('soulNeverSaved') : t('soulSavedAt', { time: formatTime(soul.updatedAt) }),
                  injectOn ? t('soulInjectOn') : t('soulInjectOff'),
                ].join(' · ')}
              >
                <span className={css.stateDot} aria-hidden="true" />
                {dirty ? t('soulDirty') : t('soulUnchanged')}
              </span>
            </div>

        <section className={css.card} data-soul-section="preview-text">
          {draftText.trim() === ''
            ? <span className={css.previewEmpty}>{t('soulPreviewEmpty')}</span>
            : <SoulMarkdown text={draftText} />}
          <div className={css.counter}>
            <span>{t('soulPreviewRendered')}</span>
            <span className={charCount > SOUL_CHAR_LIMIT ? css.counterOver : undefined}>
              {t('soulCharCount', { n: charCount })}
            </span>
          </div>
        </section>
          </div>

          <div className={`${css.pane} ${css.paneEdit}`} data-soul-zone="edit">
            <div className={css.paneHead}>
              <span className={css.paneTitle}><SoulIcon size={14} />{t('soulZoneEdit')}</span>
              <span className={css.paneHint} title={t('soulZoneEditHint')}>{t('soulZoneEditHint')}</span>
            </div>

      {/* host 未更新（/soul/cards 不存在）时卡片层整块不可用：画廊里那块编辑槽
          会是空的，这里给一句诚实说明 + 重试，而不是让用户对着空白猜。 */}
      {!cardsAvailable && (
        <div className={`${css.empty} ${css.stale}`} role="status" data-soul-section="cards-stale">
          <span className={css.emptyIcon}><SoulIcon size={24} /></span>
          <span className={css.emptyText}>{t('soulHostStale')}</span>
          <span className={css.emptyHint}>{t('soulHostStaleHint')}</span>
          <div className={css.actions}>
            <button type="button" className={css.btn} onClick={loadCards}>{t('soulRetry')}</button>
          </div>
        </div>
      )}

          </div>

      {/* ── 我的资料（用户侧身份：称呼 + 个人档案 + 头像） ──────────────
          2026-10-09 补回。host 端点（GET/POST /soul/user）、client api、
          文案与样式一直都在，丢的只是这一块 JSX——用户打开面板再也改不了
          自己的称呼与档案，而磁盘上的 user.json 仍在生效，于是表现为
          「灵魂里关于我的档案不见了」。

          刻意放在那条「深改」折叠区**外面**：它是用户改自己的唯一入口，
          默认收起等于没有，上次就是在折叠里弄丢的。 */}
      <section className={css.me} aria-label={t('soulMe')} data-soul-section="me">
        <div className={css.meHead}>
          <span className={css.cardTitle}><SoulIcon size={14} />{t('soulMe')}</span>
          <span className={css.paneHint} title={t('soulMeHint')}>{t('soulMeHint')}</span>
        </div>
        <div className={css.meBody}>
          <button
            type="button"
            className={css.meAvatar}
            disabled={meAvatarBusy}
            aria-label={meAvatar === null ? t('soulMeAvatarUpload') : t('soulAvatarReplace')}
            title={`${meAvatar === null ? t('soulMeAvatarUpload') : t('soulAvatarReplace')} · ${t('soulMeAvatarHint')}`}
            onClick={() => { meFileRef.current?.click() }}
          >
            {meAvatarBusy
              ? <span className={css.meAvatarBusy}><SpinIcon size={16} /></span>
              : meAvatar === null
                ? <span className={css.personaAvatarEmpty}><SoulIcon size={22} /></span>
                : (
                  <img
                    className={css.personaAvatarImg}
                    src={api.avatarUrl(AVATAR_USER_ID, meAvatarBust)}
                    alt=""
                  />
                )}
          </button>
          <input
            ref={meFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={onMeAvatarFile}
          />
          <div className={css.meGrid}>
            <div className={css.field}>
              <span className={css.label}>{t('soulMeName')}</span>
              <input
                className={css.input}
                aria-label={t('soulMeName')}
                placeholder={t('soulMeNamePlaceholder')}
                maxLength={USER_NAME_MAX}
                value={meName}
                onChange={event => { onMe({ name: event.currentTarget.value }) }}
              />
            </div>
            <div className={css.field}>
              <span className={css.label}>{t('soulMeProfile')}</span>
              <textarea
                className={css.textarea}
                aria-label={t('soulMeProfile')}
                placeholder={t('soulMeProfilePlaceholder')}
                maxLength={USER_PROFILE_MAX}
                value={meProfile}
                onChange={event => { onMe({ profile: event.currentTarget.value }) }}
              />
              <div className={css.counter}>
                <span>{meProfile.length} / {USER_PROFILE_MAX}</span>
                {/* 空态才提示「还没填」；已填时这里留空——变量写法由下面那枚
                    {{userName}} · {{userProfile}} chip 承担，不重复说两遍。 */}
                <span>{meName.trim() === '' && meProfile.trim() === '' ? t('soulMeEmpty') : ''}</span>
              </div>
            </div>
            <div className={css.meActions}>
              <button
                type="button"
                className={[
                  css.btn,
                  css.btnPrimary,
                  meSaved ? css.btnDone : '',
                ].filter(Boolean).join(' ')}
                disabled={meSaving || !meDirty}
                onClick={saveMe}
              >
                {meSaving ? <SpinIcon /> : meSaved ? <span className={css.check}><CheckIcon /></span> : null}
                {meSaving ? t('soulMeSaving') : meSaved ? t('soulMeSaved') : t('soulMeSave')}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnGhost}`}
                disabled={!meDirty}
                onClick={resetMe}
              >{t('soulReset')}</button>
              {meAvatar !== null && (
                <button
                  type="button"
                  className={`${css.btn} ${css.btnGhost}`}
                  disabled={meAvatarBusy}
                  onClick={removeMeAvatar}
                >{t('soulAvatarRemove')}</button>
              )}
              <span className={css.meVar} title={t('soulVarHint')}>{'{{userName}}'} · {'{{userProfile}}'}</span>
            </div>
          </div>
        </div>
      </section>



      {/* ── 修改区：整段正文 / 身份字段 / 档案 / 蒸馏 ──
          2026-10-06 二轮：外层那枚「整段正文 / 身份字段 / 档案 / 蒸馏」折叠按钮
          删掉了（用户原话「这个折叠去掉」）——它只是一枚纯标签，点开才见到真内容，
          等于多点一次才知道「修改」里有什么，还常占右栏顶部一整行。内容现在常驻，
          区头已说明这里是「修改」，不需要第二层名字。
          内部固定单列堆叠：原来那套「正文编辑器 + 300px 档案侧栏」的双栏在
          半屏里会把主栏压到 120px，正文竖排成两个字一行。 */}
      <details className="dsh-soul-legacy-details">
        <summary>深改 · 整段正文 / 身份 / 档案 / 蒸馏</summary>
      <div className={css.legacy}>

      {/* ── 两栏：编辑区 / 档案与开关 ── */}
      <div className={css.cols}>
        <div className={css.mainCol}>
          <section className={css.card}>
            <div className={css.cardTitle}><SoulIcon size={14} />{t('soulContentLabel')}</div>
            {/* 三区改版后这里**只做编辑**：预览搬到左栏（有「卡片 / 全文」段控），
                右栏再留一个预览 Tab 就是同一份内容两处入口，纯噪音。 */}
            <div className={css.field}>
              <textarea
                className={`${css.textarea} ${css.textareaTall}`}
                aria-label={t('soulContentLabel')}
                placeholder={t('soulContentPlaceholder')}
                value={draftText}
                onChange={event => { onText(event.currentTarget.value) }}
              />
              <div className={css.counter}>
                <span className={charCount > SOUL_CHAR_LIMIT ? css.counterOver : undefined}>
                  {t('soulCharCount', { n: charCount })}
                </span>
                <span>{t('soulCharLimitHint', { n: SOUL_CHAR_LIMIT })}</span>
              </div>
            </div>

            <div className={css.field}>
              <span className={css.label}>{t('soulIdentityLabel')}</span>
              <span className={css.cardHint}>{t('soulIdentityHint')}</span>
              <div className={css.fieldRow}>
                <div className={css.field}>
                  <span className={css.label}>{t('soulName')}</span>
                  <input
                    className={css.input}
                    aria-label={t('soulName')}
                    placeholder={t('soulNamePlaceholder')}
                    value={draftIdentity.name}
                    onChange={event => { onIdentity({ name: event.currentTarget.value }) }}
                  />
                </div>
                <div className={css.field}>
                  <span className={css.label}>{t('soulRole')}</span>
                  <input
                    className={css.input}
                    aria-label={t('soulRole')}
                    placeholder={t('soulRolePlaceholder')}
                    value={draftIdentity.role}
                    onChange={event => { onIdentity({ role: event.currentTarget.value }) }}
                  />
                </div>
                <div className={css.field}>
                  <span className={css.label}>{t('soulTone')}</span>
                  <input
                    className={css.input}
                    aria-label={t('soulTone')}
                    placeholder={t('soulTonePlaceholder')}
                    value={draftIdentity.tone}
                    onChange={event => { onIdentity({ tone: event.currentTarget.value }) }}
                  />
                </div>
                <div className={css.field}>
                  <span className={css.label}>{t('soulLanguage')}</span>
                  <input
                    className={css.input}
                    aria-label={t('soulLanguage')}
                    placeholder={t('soulLanguagePlaceholder')}
                    value={draftIdentity.language}
                    onChange={event => { onIdentity({ language: event.currentTarget.value }) }}
                  />
                </div>
              </div>
              <div className={css.principles}>
                <span className={css.label}>
                  {t('soulPrinciples')}
                  <span className={`${css.chip} ${css.chipMuted}`}>
                    {t('soulPrinciplesCount', { n: draftIdentity.principles.length })}
                  </span>
                </span>
                <textarea
                  className={css.textarea}
                  aria-label={t('soulPrinciples')}
                  placeholder={t('soulPrinciplesPlaceholder')}
                  value={draftIdentity.principles.join('\n')}
                  onChange={event => { onIdentity({ principles: event.currentTarget.value.split('\n') }) }}
                />
              </div>
            </div>

            <div className={css.actions}>
              <button
                type="button"
                className={[
                  css.btn,
                  css.btnPrimary,
                  saveState === 'done' ? css.btnDone : '',
                ].filter(Boolean).join(' ')}
                disabled={saveState === 'busy' || !dirty}
                onClick={save}
              >
                {saveState === 'busy' ? <SpinIcon /> : saveState === 'done' ? <span className={css.check}><CheckIcon /></span> : null}
                {saveState === 'busy' ? t('soulSaving') : saveState === 'done' ? t('soulSaved') : t('soulSave')}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnGhost}`}
                disabled={!dirty}
                onClick={resetDraft}
              >{t('soulReset')}</button>
              <button
                type="button"
                className={css.btn}
                disabled={distilling}
                onClick={distill}
              >
                {distilling ? <SpinIcon /> : <SparkIcon />}
                {distilling ? t('soulDistilling') : t('soulDistill')}
              </button>
            </div>
            <span className={css.cardHint}>{t('soulDistillHint')}</span>
          </section>
        </div>

        <div className={css.sideCol}>

          {/* ── 注入开关 ── */}
          <section className={css.card}>
            <div className={css.cardTitle}><SoulIcon size={14} />{t('soulInjectLabel')}</div>
            <div className={css.toggleRow}>
              <span className={css.toggleMain}>
                <span className={css.toggleLabel}>
                  {injectOn ? t('soulInjectOn') : t('soulInjectOff')}
                  <span className={`${css.badge} ${css.badgeOn}`}>{t('soulInjectBuiltin')}</span>
                </span>
                <span className={css.toggleHint}>{t('soulInjectHint')}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={injectOn}
                aria-label={t('soulInjectLabel')}
                disabled={injectBusy || !injectKnown}
                className={css.switch}
                onClick={toggleInject}
              />
            </div>
            {!injectKnown && <span className={css.cardHint}>{t('soulInjectReadFailed')}</span>}
          </section>

          {/* ── 只读的身份总览：一眼看到「现在生效的是什么」 ── */}
          <section className={css.card}>
            <div className={css.cardTitle}><SoulIcon size={14} />{t('soulIdentityLabel')}</div>
            <div className={css.identityList}>
              <div className={css.identityRow}>
                <span className={css.identityKey}>{t('soulName')}</span>
                <span className={css.identityVal}>{soul.identity.name === '' ? '—' : soul.identity.name}</span>
              </div>
              <div className={css.identityRow}>
                <span className={css.identityKey}>{t('soulRole')}</span>
                <span className={css.identityVal}>{soul.identity.role === '' ? '—' : soul.identity.role}</span>
              </div>
              <div className={css.identityRow}>
                <span className={css.identityKey}>{t('soulTone')}</span>
                <span className={css.identityVal}>{soul.identity.tone === '' ? '—' : soul.identity.tone}</span>
              </div>
              <div className={css.identityRow}>
                <span className={css.identityKey}>{t('soulLanguage')}</span>
                <span className={css.identityVal}>{soul.identity.language === '' ? '—' : soul.identity.language}</span>
              </div>
              <div className={css.identityRow}>
                <span className={css.identityKey}>{t('soulPrinciples')}</span>
                <span className={css.identityVal}>
                  {soul.identity.principles.length === 0
                    ? '—'
                    : soul.identity.principles.map((item, index) => (
                      <span key={`${String(index)}-${item}`} style={{ display: 'block' }}>· {item}</span>
                    ))}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
        </div>
      </details>
      </div>
        </div>

      {/* ── 空态提示：还没有灵魂时给一句引导（不挡编辑区） ── */}
      {!hasContent && !dirty && (
        <div className={css.empty}>
          <span className={css.emptyIcon}><SoulIcon size={26} /></span>
          <span className={css.emptyText}>{t('soulEmpty')}</span>
          <span className={css.emptyHint}>{t('soulDistillHint')}</span>
        </div>
      )}
    </>
  )

  // embedded：挂在工作台整页里（父级 .wb-soul-scroll 是 flex 列）。此时 root 撑满
  // 高度、三区按「上 1/3」定高分配——比例语义只有在定高语境里才成立。
  // 非 embedded（composer 浮层）保持内容自适应 + 整页滚动。
  if (embedded) return <div className={`${css.root} ${css.rootFill}`}>{body}</div>
  return <div className={css.scroll}><div className={css.root}>{body}</div></div>
}

/**
 * composer 浮层里的一行开关（label + 最小开关）。
 *
 * 与记忆面板的 SwitchRow 同款结构，但不依赖那份 styles.ts：浮层挂在记忆面板
 * 作用域之外，拿不到 --m-* 变量，必须自带一份（本文件顶部已把官方 token 聚合成
 * --s-*，明暗主题自动跟随）。
 */
export function SoulToggleRow({ api, t = makeSoulT() }: { readonly api: SoulApi; readonly t?: SoulT }): JSX.Element {
  ensureSoulStyles()
  const apiRef = useRef(api)
  apiRef.current = api
  const [on, setOn] = useState(true)
  const [known, setKnown] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = useCallback((): void => {
    void apiRef.current.getState()
      .then(response => { setOn(response.enabled !== false); setKnown(true) })
      .catch(() => { setKnown(false) })
  }, [])

  useEffect(() => { reload() }, [reload])

  const toggle = useCallback((): void => {
    if (busy) return
    const next = !on
    setBusy(true)
    setOn(next)
    void apiRef.current.setState(next)
      .then(response => { setOn(response.enabled !== false); setKnown(true) })
      .catch(reload)
      .finally(() => { setBusy(false) })
  }, [busy, on, reload])

  return (
    <div className={css.toggleRow}>
      <span className={css.toggleMain}>
        <span className={css.toggleLabel}>
          {t('soulInjectLabel')}
          <span className={`${css.badge} ${css.badgeOn}`}>{t('soulInjectBuiltin')}</span>
        </span>
        <span className={css.toggleHint}>{t('soulInjectHint')}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t('soulInjectLabel')}
        disabled={busy || !known}
        className={css.switch}
        onClick={toggle}
      />
    </div>
  )
}
