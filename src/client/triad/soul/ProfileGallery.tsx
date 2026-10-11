/**
 * ProfileGallery.tsx — 灵魂「角色」画廊（横向卡片排，点一张就换人格）。
 *
 * ── 这一层解决什么 ────────────────────────────────────────────────────
 * 档案（profile）原本渲染成一行行列表：一行 = 一个角色，右侧一枚「启用」按钮。
 * 用户看不出这个角色长什么样、什么脾气——而档案是「一整份备用人格」，切换它是
 * 面板上语义最重的动作，却长得最像一条设置项。
 *
 * 改成横向画廊后：当前生效的角色横向展开成宽卡（脸 / 名字 / 角色 / 一句定位 /
 * 语气 / 语言 / 准则数 / 卡片统计），其余收缩成竖排名字的窄条；点窄条即切换。
 * 形态与「灵魂是卡片集合」这条主线一致——卡片区管**这一份人格里有什么**，
 * 画廊管**现在用的是哪一份人格**。
 *
 * ── 设计取舍 ──────────────────────────────────────────────────────────
 * 1. **主档与档案同级**。主档（soul.md 本体）没有 profile id，但它在「切谁就注入
 *    谁」这件事上与档案完全同类，只是恰好没有 id。给它单开一段列表会让用户以为
 *    它是另一种东西；放进同一排、同样可点，语义才对。
 * 2. **切换不本地假装成功**。activate 是一次网络请求，回包才改激活态；请求期间
 *    卡片挂 data-busy 走底部进度条 + 「切换中」徽标，失败弹 notice 并保持原状。
 * 3. **展示件（desc / tag / 头像）与人格内容解耦**。这三样只影响卡片长相，不参与
 *    注入（见 host types.ProfileView 注释）。所以它们的保存走**独立入口**，不碰
 *    正文、不 bump 版本号——改一句定位不该被当成「改了人格」。
 * 4. **窄态竖排名字**。窄条只有 96px 宽，横排中文名会被截成两个字；竖排
 *    （writing-mode）反而能把整个名字读全，也天然贴合「一列卡脊」的观感。
 * 5. **动效全部 CSS**。宽度伸缩用 flex-basis + flex-grow 过渡（宽度无法用
 *    transform 表达）；头像两态、信息区淡入、进度条全部 transition。零依赖。
 * 6. **头像上传沿用「我的资料」那套**。读成 data URL → 前端先拦体积与类型 →
 *    交 host；换图后路径不变，必须带 cache-busting 值，否则浏览器一直显示旧脸。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ProfileView, SoulApi } from './api.js'
import type { SoulT } from './locales.js'
import { css } from './styles.js'

/** 头像体积上限（与「我的资料」一致；超出直接拦在前端，不浪费一次往返）。 */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** desc / tag 上限（与 host PROFILE_DESC_MAX / PROFILE_TAG_MAX 一致）。 */
const DESC_LIMIT = 60
const TAG_LIMIT = 12

/**
 * 角色的来源。三类同级同形排在一排里，但**点击语义不同**：
 *
 *   base    —— 主档（soul.md 本体）。点 = 切回主档。
 *   profile —— 备用档案。点 = 切换到这份人格。
 *   preset  —— 预设（一套现成卡片，没有 profile id）。点 = 把**这套卡片套进当前人格**
 *              （replace / merge），它不改变「现在用的是哪份人格」。
 *
 * 为什么预设也要进这一排：它本来就是「一个角色」（工程搭档 / 严谨分析师 / 罗莉…），
 * 用户心里它就是「换个人」。把它单独摆在另一块网格里，等于同一件事有两个入口 ——
 * 这正是用户说的「又一个新的这么冗余」。语义差别靠徽标（预设 = 虚线边框）与
 * 动作按钮（套用而非启用）表达，不靠「另起一块」表达。
 */
export type RoleSource = 'base' | 'profile' | 'preset'

/** 画廊里的一张角色卡。 */
export interface RoleCard {
  /**
   * 角色 id。
   *   主档 = null；档案 = profile id；预设 = 预设 id（但 presetId 字段另有其值，
   *   因为预设 id 与档案 id 是两个命名空间，不能混用同一个字段做 activate）。
   */
  readonly id: string | null
  readonly source: RoleSource
  /** 预设 id（source === 'preset' 时才有值）。 */
  readonly presetId: string | null
  readonly name: string
  readonly active: boolean
  readonly updatedAt: string | null
  readonly desc: string
  readonly tag: string
  /** 头像文件名；null = 未上传。 */
  readonly avatar: string | null
  /** 该角色身份里的四个展示字段（主档取当前 soul 视图，档案取自身）。 */
  readonly role: string
  readonly tone: string
  readonly language: string
  readonly principles: number
  /** 卡片启用数 / 总数（主档与档案各算各的）。 */
  readonly cardsOn: number
  readonly cardsTotal: number
  /** 版本号。 */
  readonly version: number
  /**
   * 这份角色的详情是否**已知**。
   *
   * 为什么需要这个标志：host 的 SoulView 只描述「当前生效的那份人格」——激活档案时，
   * soul.identity / desc / tag / avatar 全是**那份档案的**，主档自己的这些值在回包里
   * 根本不存在（host 在档案分支不读 base）。画廊若照抄 soul.*，主档卡就会顶着一张
   * 别人的脸和名字，界面上出现两张同名卡（实测踩过：切到「验证甲」后主档卡也叫
   * 「验证甲」）。所以非激活的主档卡**如实退化成占位**，等它被激活再显示真值。
   */
  readonly detailKnown: boolean
  /** 预设是否内置（内置不可删）。非预设恒为 false。 */
  readonly builtin: boolean
  /** 卡片预览：该角色的卡片标题（宽卡内只读预览用，最多取前若干张）。 */
  readonly cardTitles: readonly string[]
}

/** ProfileGallery 属性。 */
export interface ProfileGalleryProps {
  readonly api: SoulApi
  /** 画廊里的全部角色（主档在第一位）。 */
  readonly roles: readonly RoleCard[]
  /** 切换激活角色（null = 回主档）。 */
  readonly onActivate: (profileId: string | null) => void
  /** 切换请求进行中（禁用重复点击）。 */
  readonly busy: boolean
  /** 保存展示件（desc / tag）——独立入口，不碰正文。 */
  readonly onSaveMeta: (profileId: string | null, meta: { desc?: string; tag?: string }) => void
  /** 头像上传（已读成 data URL）。 */
  readonly onUploadAvatar: (profileId: string | null, dataUrl: string) => void
  /** 头像体积超限 / 读失败：交给面板统一弹 notice（本组件不自己造提示 UI）。 */
  readonly onAvatarRejected: (reason: 'tooLarge' | 'readFailed', detail: string) => void
  /** 头像移除。 */
  readonly onRemoveAvatar: (profileId: string | null) => void
  /** 新建角色（画廊末尾的入口）。 */
  readonly onCreate: (input: { name: string; desc: string; tag: string }) => void
  /**
   * 删除角色（主档不可删）。
   *
   * 入参刻意只收**删除动作真正需要的三个字段**，而不是整份 ProfileView：调用方
   * （SoulPanel.removeProfile）只读 id 判断回包，name 供确认文案，active 供拦截。
   * 传整份会逼着画廊在删卡时伪造一堆它并不掌握的展示字段（cardsOn/principles 等），
   * 那是「把半个对象当整份用」——类型上过得去、语义上是假的。
   */
  readonly onRemove: (target: { id: string; name: string; active: boolean }) => void
  /** 角色数量是否已达上限。 */
  readonly atLimit: boolean
  /** 头像上传中（禁用重复点击）。 */
  readonly avatarBusy: boolean
  /**
   * 宽卡内的卡片区（当前生效人格的卡片）。
   *
   * 为什么由外部传进来而不是画廊自己渲染：卡片区（CardsSection）已经是一套成熟的
   * 组件（增删改序、拖拽、预设、失焦保存），把它重写一遍等于把那些踩过的坑重踩一遍。
   * 画廊只负责给它一块地方。传 null = 这块不显示（例如 host 未更新）。
   */
  readonly cardsSlot: React.ReactNode
  /** 卡片区是否可用（host 未更新时为 false，画廊显示提示而非空槽）。 */
  readonly cardsAvailable: boolean
  /**
   * 套用预设（预设卡的动作）。
   *
   * 与 onActivate 分开是**语义要求**：预设没有 profile id，套用它不改变「现在用的是
   * 哪份人格」，只是把一套卡片替换/合并进当前人格。混成一个入口会让用户以为
   * 「点预设 = 切到某个叫工程搭档的人格」，而那个档案根本不存在。
   */
  readonly onApplyPreset: (presetId: string, mode: 'replace' | 'merge') => void
  /** 预设应用中的 id + 模式（禁用重复点击 + 按钮内转圈）。 */
  readonly presetBusy: { presetId: string; mode: 'replace' | 'merge' } | null
  /** 删除预设（内置的不显示入口）。 */
  readonly onRemovePreset: (presetId: string) => void
  /** 把当前卡片存为新预设（宽卡底部的动作）。 */
  readonly onSaveAsPreset: () => void
  /**
   * 「存为预设」表单是否展开。
   *
   * 展开态由外部持有（卡片区的「存为预设」按钮与宽卡底部按钮都指向它），
   * 表单本身渲染在画廊末尾 —— 与「新建角色」并列。
   */
  readonly saveAsOpen: boolean
  /** 表单收口（存好了或取消了）。 */
  readonly onSaveAsPresetDone: () => void
  /** 保存预设（名字 + 说明）。 */
  readonly onSavePreset: (input: { name: string; desc: string }) => void
  readonly presetSaving: boolean
  readonly t: SoulT
}

/** 头像缓存破坏值的取值来源：每次上传成功 +1，避免同 URL 命中旧图。 */
function avatarSrc(api: SoulApi, id: string | null, bust: number): string {
  return api.avatarUrl(id, bust)
}

/** 把时间戳格式化成短时间（与面板其余部分同款口径）。 */
function shortTime(iso: string | null): string {
  if (iso === null || iso === '') return ''
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 未命名角色的兜底首字（窄态竖排与无头像时都用到）。 */
function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed === '' ? '·' : trimmed.slice(0, 1)
}

/**
 * 单张角色卡的**展示件编辑**状态。
 *
 * 为什么编辑态是「一次只开一张」而不是每张各自持有：面板窄、卡片横排，多张同时
 * 展开会把整排撑成一堆输入框；而且用户改定位时视线只在一张卡上。
 */
interface MetaDraft {
  id: string | null
  desc: string
  tag: string
}

export function ProfileGallery(props: ProfileGalleryProps): JSX.Element {
  const {
    api, roles, onActivate, busy, onSaveMeta, onUploadAvatar, onAvatarRejected, onRemoveAvatar,
    onCreate, onRemove, atLimit, avatarBusy,
    cardsSlot, cardsAvailable, onApplyPreset, presetBusy, onRemovePreset, onSaveAsPreset,
    saveAsOpen, onSaveAsPresetDone, onSavePreset, presetSaving,
    t,
  } = props

  /** 正在编辑展示件的角色（null = 没在编辑）。 */
  const [draft, setDraft] = useState<MetaDraft | null>(null)
  /** 新建角色的表单（null = 收起）。 */
  const [newForm, setNewForm] = useState<{ name: string; desc: string; tag: string } | null>(null)
  /** 「存为预设」表单的本地草稿（展开态由外部给，草稿跟着表单走）。 */
  const [presetName, setPresetName] = useState('')
  const [presetDesc, setPresetDesc] = useState('')
  /** 头像缓存破坏值：上传成功后 +1，否则浏览器拿缓存里的旧脸。 */
  const [bust, setBust] = useState(0)
  /** 正在传头像的角色 id（含 null 主档，用 sentinel 区分「没在传」）。 */
  const [uploadingId, setUploadingId] = useState<string | null | undefined>(undefined)
  /** 各卡自己的隐藏 file input（一张卡一个，避免共享 ref 时选错卡）。 */
  const fileRefs = useRef(new Map<string, HTMLInputElement | null>())

  /** 卡片 key：主档用固定串，档案用 id（Map 的 key 不能是 null）。 */
  /**
   * 卡片的 React key。
   *
   * **不能只按 role.id 派生**：预设没有 profile id（id 恒为 null），8 套预设会全部
   * 落到同一个 '__base__' 上 —— React 把重复 key 当成同一张卡复用，切换时整排卡的
   * DOM 会错位（实测踩过）。key 必须带上来源与 presetId 才能全局唯一。
   */
  const keyOf = (role: RoleCard): string =>
    role.source === 'preset'
      ? `preset:${role.presetId ?? ''}`
      : role.source === 'profile'
        ? `profile:${role.id ?? ''}`
        : 'base'

  // 角色列表变化（切换/删除）后，若正在编辑的那张已经不存在，收起编辑区。
  useEffect(() => {
    if (draft === null) return
    if (!roles.some(role => role.id === draft.id)) setDraft(null)
  }, [draft, roles])

  /** 提交展示件（无改动则静默返回，不发请求）。 */
  const commitMeta = useCallback((): void => {
    const current = draft
    if (current === null) return
    const role = roles.find(item => item.id === current.id)
    if (role === undefined) { setDraft(null); return }
    const desc = current.desc.trim().slice(0, DESC_LIMIT)
    const tag = current.tag.trim().slice(0, TAG_LIMIT)
    if (desc === role.desc && tag === role.tag) { setDraft(null); return }
    onSaveMeta(current.id, { desc, tag })
    setDraft(null)
  }, [draft, onSaveMeta, roles])

  /** 选图 → 读成 data URL → 交 host。体积先拦一道，别浪费往返。 */
  const onAvatarFile = useCallback((id: string | null, event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    // 清空 value：选同一张图时 change 不再触发，等于「换回上一张」点不动。
    event.currentTarget.value = ''
    if (file === undefined) return
    if (file.size > AVATAR_MAX_BYTES) {
      onAvatarRejected('tooLarge', `${(file.size / 1024 / 1024).toFixed(1)}MB`)
      return
    }
    setUploadingId(id)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      setUploadingId(undefined)
      if (dataUrl === '') { onAvatarRejected('readFailed', ''); return }
      onUploadAvatar(id, dataUrl)
      setBust(current => current + 1)
    }
    reader.onerror = () => {
      setUploadingId(undefined)
      onAvatarRejected('readFailed', '')
    }
    reader.readAsDataURL(file)
  }, [onAvatarRejected, onUploadAvatar])

  /** 提交「存为预设」：名字非空才发请求；成功后清草稿。 */
  const commitPreset = useCallback((): void => {
    const name = presetName.trim()
    if (name === '' || presetSaving) return
    onSavePreset({ name: name.slice(0, 40), desc: presetDesc.trim().slice(0, 120) })
    setPresetName('')
    setPresetDesc('')
  }, [onSavePreset, presetDesc, presetName, presetSaving])

  return (
    <section
      className={`${css.profileGallery} ${css.profileFull}`}
      aria-label={t('soulGalleryTitle')}
      data-soul-section="profiles"
    >
      <div className={css.cardTitle}>
        <RoleIcon size={14} />
        {t('soulGalleryTitle')}
        <span className={`${css.chip} ${css.chipMuted}`}>{roles.length}</span>
      </div>
      <span className={css.cardHint} title={t('soulGalleryHint')}>{t('soulGalleryHint')}</span>

      <div className={css.profileRail} role="tablist" aria-label={t('soulProfiles')}>
        {roles.map((role, index) => {
          const key = keyOf(role)
          const editing = draft !== null && draft.id === role.id
          const uploading = uploadingId === role.id
          const isBase = role.source === 'base'
          const isPreset = role.source === 'preset'
          return (
            <article
              key={key}
              className={[
                css.profileCard,
                role.active ? css.profileCardOn : '',
                css.profileCardIn,
              ].filter(item => item !== '').join(' ')}
              style={{ animationDelay: `${String(Math.min(index, 6) * 40)}ms` }}
              data-busy={busy && role.active ? '1' : undefined}
              data-role-id={key}
              tabIndex={0}
              role="tab"
              aria-selected={role.active}
              aria-label={`${role.name} · ${role.active ? t('soulProfileActive') : t('soulProfileClickSwitch')}`}
              onClick={() => {
                // 点卡片 = 执行这张卡的主动作。**必须按来源分流**：
                //   预设没有 profile id（role.id 恒为 null），若照主档/档案那条路走
                //   onActivate(role.id) 会变成 onActivate(null) = **切回主档** ——
                //   用户点「工程搭档」却回到了主档，看起来就是「点了没反应」。
                //   预设的主动作是「把这套卡片套进当前人格」（replace）。
                if (editing) return
                if (isPreset) {
                  if (role.presetId !== null) onApplyPreset(role.presetId, 'replace')
                  return
                }
                if (!role.active) onActivate(role.id)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (editing) return
                  if (isPreset) {
                    if (role.presetId !== null) onApplyPreset(role.presetId, 'replace')
                    return
                  }
                  if (!role.active) onActivate(role.id)
                }
              }}
            >
              {/* ── 头像：窄态居中 40×40，宽态左上 56×56（两态全走 CSS 过渡） ── */}
              <button
                type="button"
                className={css.profileAvatar}
                disabled={avatarBusy || uploading}
                aria-label={role.avatar === null ? t('soulAvatarUpload') : t('soulAvatarReplace')}
                title={`${role.avatar === null ? t('soulAvatarUpload') : t('soulAvatarReplace')} · ${t('soulMeAvatarHint')}`}
                onClick={event => {
                  // 点头像 = 传图，不该顺带切换角色。
                  event.stopPropagation()
                  fileRefs.current.get(key)?.click()
                }}
              >
                {uploading
                  ? <span className={css.profileAvatarBusy}><SpinIcon size={15} /></span>
                  : role.avatar === null
                    ? <span className={css.profileInitial}>{initialOf(role.name)}</span>
                    : <img className={css.profileAvatarImg} src={avatarSrc(api, role.id, bust)} alt="" />
                }
              </button>
              <input
                ref={node => { fileRefs.current.set(key, node) }}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={event => { onAvatarFile(role.id, event) }}
              />

              {/* ── 窄态：竖排名字（横排中文名会被截成两个字） ── */}
              <div className={css.profileVName} aria-hidden="true">
                <span className={role.active ? `${css.profileDot} ${css.profileDotOn}` : css.profileDot} />
                <span className={css.profileVNameText}>{role.name}</span>
              </div>

              {/* ── 宽态：完整角色信息 ── */}
              <div className={css.profileBody}>
                <div className={css.profileBadges}>
                  {/* 来源徽标：预设用虚线边框（它的点击语义是「套用这套卡片」，
                      不是「切换人格」——两者必须在视觉上分得开）。 */}
                  <span
                    className={role.source === 'preset'
                      ? `${css.profileSource} ${css.profileSourcePreset}`
                      : css.profileSource}
                  >
                    {role.source === 'preset'
                      ? t('soulRoleSourcePreset')
                      : role.source === 'profile' ? t('soulRoleSourceProfile') : t('soulRoleSourceBase')}
                  </span>
                  <span className={`${css.profileBadge} ${role.active ? css.profileBadgeOn : css.profileBadgePending}`}>
                    {role.source === 'preset'
                      ? t('soulPresetCustom')
                      : busy && role.active
                        ? t('soulProfileSwitching')
                        : role.active ? t('soulProfileActive') : t('soulProfileClickSwitch')}
                  </span>
                  {role.desc !== '' && <span className={css.profileBadge}>{role.desc}</span>}
                  {role.tag !== '' && <span className={`${css.profileBadge} ${css.profileTag}`}>{role.tag}</span>}
                  {role.version > 0 && <span className={css.profileBadge}>v{role.version}</span>}
                </div>

                <h3 className={css.profileNameBig}>{role.name === '' ? t('soulProfileMain') : role.name}</h3>
                {role.detailKnown
                  ? (role.role !== '' && <p className={css.profileRole}>{role.role}</p>)
                  : <p className={css.profileRoleUnknown}>{t('soulProfileDetailHidden')}</p>}

                <div className={css.profilePlates}>
                  <div className={css.profilePlate}>
                    <span className={css.profilePlateK}>{t('soulTone')}</span>
                    <span className={css.profilePlateV} title={role.tone}>
                      {!role.detailKnown ? '—' : role.tone === '' ? '—' : role.tone}
                    </span>
                  </div>
                  <div className={css.profilePlate}>
                    <span className={css.profilePlateK}>{t('soulLanguage')}</span>
                    <span className={css.profilePlateV} title={role.language}>
                      {!role.detailKnown ? '—' : role.language === '' ? '—' : role.language}
                    </span>
                  </div>
                  <div className={css.profilePlate}>
                    <span className={css.profilePlateK}>{t('soulPrinciples')}</span>
                    <span className={css.profilePlateV}>
                      {!role.detailKnown || role.principles === 0 ? '—' : t('soulPrinciplesCount', { n: role.principles })}
                    </span>
                  </div>
                  <div className={css.profilePlate}>
                    <span className={css.profilePlateK}>{t('soulCards')}</span>
                    <span className={css.profilePlateV}>
                      {role.cardsTotal === 0 ? '—' : t('soulProfileCardsPlate', { on: role.cardsOn, total: role.cardsTotal })}
                    </span>
                  </div>
                </div>

                {/* ── 这份人格的卡片：灵魂的「内容层」 ──
                    这是「统摄」的关键一块：以前它是页面另一侧的独立区，用户要在
                    两处之间来回看「我切的人格里到底有什么」。现在它就在激活卡的
                    肚子里 —— 切换角色与查看/编辑这份角色的卡片是同一个视线的两半。

                    只有**当前生效**的角色才给编辑槽：卡片接口（cards()）读写的
                    永远是「生效层」，给非激活角色渲染编辑区等于让用户改一份
                    不会生效的东西（改了也看不到效果）。非激活角色只给只读预览。 */}
                {role.active && cardsAvailable && cardsSlot !== null && (
                  <div className={css.profileCards} onClick={event => { event.stopPropagation() }}>
                    <div className={css.profileCardsHead}>
                      <span className={css.profileCardsTitle}>{t('soulRoleCardsTitle')}</span>
                      <span className={`${css.chip} ${css.chipMuted}`}>
                        {t('soulProfileCardsPlate', { on: role.cardsOn, total: role.cardsTotal })}
                      </span>
                      <span className={css.profileFootSpacer} />
                      <button
                        type="button"
                        className={`${css.btn} ${css.btnGhost}`}
                        onClick={event => { event.stopPropagation(); onSaveAsPreset() }}
                      >{t('soulPresetSaveAs')}</button>
                    </div>
                    <span className={css.profileCardsHint}>{t('soulRoleCardsHint')}</span>
                    <div className={css.profileCardsBody}>
                      {role.cardsTotal === 0
                        ? <div className={css.profileCardsEmpty}>{t('soulRoleCardsEmpty')}</div>
                        : cardsSlot}
                    </div>
                  </div>
                )}

                {/* 非激活角色：只读预览（这份人格里有哪些卡）。预设天然是只读的
                    —— 它还没有被套用，谈不上「它的卡片在生效」。 */}
                {!role.active && role.cardTitles.length > 0 && (
                  <div className={css.profilePreview}>
                    {role.cardTitles.map(title => (
                      <div className={css.profilePreviewItem} key={title}>
                        <span>{title}</span>
                      </div>
                    ))}
                    {role.cardsTotal > role.cardTitles.length && (
                      <div className={css.profilePreviewMore}>
                        {t('soulRolePreviewMore', { n: role.cardsTotal - role.cardTitles.length })}
                      </div>
                    )}
                  </div>
                )}
                {!role.active && role.source !== 'preset' && role.cardTitles.length === 0 && (
                  <span className={css.profileCardsHint}>{t('soulRoleCardsReadonly')}</span>
                )}

                {/* ── 展示件编辑：默认收起，展开时改 desc / tag ── */}
                {editing && (
                  <div className={css.profileEdit} onClick={event => { event.stopPropagation() }}>
                    <div className={css.profileEditRow}>
                      <div className={css.field}>
                        <span className={css.label}>{t('soulProfileDescLabel')}</span>
                        <input
                          className={css.input}
                          aria-label={t('soulProfileDescLabel')}
                          placeholder={t('soulProfileDescPlaceholder')}
                          maxLength={DESC_LIMIT}
                          value={draft.desc}
                          autoFocus
                          onChange={event => {
                            const value = event.currentTarget.value
                            setDraft(current => (current === null ? current : { ...current, desc: value }))
                          }}
                          onKeyDown={event => {
                            // 必须吃掉冒泡：卡片本体的 onKeyDown 把空格当「切换角色」，
                            // 而空格是「均衡的助手」这类定位文案的常客 —— 不拦就会
                            // 边打字边被切人格。Enter/Escape 同理（它们是本编辑区的快捷键）。
                            event.stopPropagation()
                            if (event.key === 'Enter') { event.preventDefault(); commitMeta() }
                            if (event.key === 'Escape') setDraft(null)
                          }}
                        />
                      </div>
                      <div className={css.field}>
                        <span className={css.label}>{t('soulProfileTagLabel')}</span>
                        <input
                          className={css.input}
                          aria-label={t('soulProfileTagLabel')}
                          placeholder={t('soulProfileTagPlaceholder')}
                          maxLength={TAG_LIMIT}
                          value={draft.tag}
                          onChange={event => {
                            const value = event.currentTarget.value
                            setDraft(current => (current === null ? current : { ...current, tag: value }))
                          }}
                          onKeyDown={event => {
                            // 同上：小标签虽然短，也可能带空格（如「MOOD BOARD」）。
                            event.stopPropagation()
                            if (event.key === 'Enter') { event.preventDefault(); commitMeta() }
                            if (event.key === 'Escape') setDraft(null)
                          }}
                        />
                      </div>
                    </div>
                    <div className={css.actions}>
                      <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={commitMeta}>{t('soulCardSave')}</button>
                      <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { setDraft(null) }}>{t('soulCardCancel')}</button>
                    </div>
                  </div>
                )}

                <div className={css.profileFoot}>
                  <span>{role.updatedAt === null ? t('soulNeverSaved') : t('soulSavedAt', { time: shortTime(role.updatedAt) })}</span>
                </div>

                {/* 动作行与「更新时间」那行分开：动作按钮比时间重要，单独成行后
                    在窄卡里也能整行换行，不会被时间挤成逐字竖排（上一版踩过）。 */}
                <div className={css.profileActionsRow}>

                  {/* ── 预设：动作是「套用这套卡片」，不是「切换人格」 ──
                      两种模式都给（与旧预设区一致）：merge = 并进当前人格（缺省、
                      幂等、不破坏已有卡）；replace = 整套换掉。用户对「我要换成
                      这个人格」的预期是 replace，所以两个都得有，且 replace 用
                      主色按钮承担「更重」的语义。 */}
                  {role.source === 'preset' && role.presetId !== null && (
                    <>
                      <button
                        type="button"
                        className={`${css.btn} ${css.btnGhost}`}
                        disabled={presetBusy !== null}
                        onClick={event => {
                          event.stopPropagation()
                          onApplyPreset(role.presetId as string, 'merge')
                        }}
                      >{presetBusy?.presetId === role.presetId && presetBusy.mode === 'merge'
                        ? <SpinIcon size={12} />
                        : t('soulPresetApplyMerge')}</button>
                      <button
                        type="button"
                        className={`${css.btn} ${css.btnPrimary}`}
                        disabled={presetBusy !== null}
                        onClick={event => {
                          event.stopPropagation()
                          onApplyPreset(role.presetId as string, 'replace')
                        }}
                      >{presetBusy?.presetId === role.presetId && presetBusy.mode === 'replace'
                        ? <SpinIcon size={12} />
                        : t('soulPresetApplyReplace')}</button>
                      {!role.builtin && (
                        <button
                          type="button"
                          className={`${css.btn} ${css.btnIcon} ${css.btnDanger}`}
                          aria-label={`${t('soulPresetDelete')} ${role.name}`}
                          disabled={presetBusy !== null}
                          onClick={event => {
                            event.stopPropagation()
                            onRemovePreset(role.presetId as string)
                          }}
                        >×</button>
                      )}
                    </>
                  )}

                  {/* ── 主档 / 档案：动作是「切换人格」 ── */}
                  {role.source !== 'preset' && (
                    <>
                      {role.avatar !== null && (
                        <button
                          type="button"
                          className={`${css.btn} ${css.btnGhost}`}
                          disabled={avatarBusy || uploading}
                          onClick={event => { event.stopPropagation(); onRemoveAvatar(role.id) }}
                        >{t('soulAvatarRemove')}</button>
                      )}
                      <button
                        type="button"
                        className={`${css.btn} ${css.btnGhost}`}
                        onClick={event => {
                          event.stopPropagation()
                          setDraft({ id: role.id, desc: role.desc, tag: role.tag })
                        }}
                      >{t('soulProfileEditMeta')}</button>
                      {!role.active && (
                        <button
                          type="button"
                          className={`${css.btn} ${css.btnPrimary}`}
                          disabled={busy}
                          onClick={event => { event.stopPropagation(); onActivate(role.id) }}
                        >{t('soulProfileActivate')}</button>
                      )}
                      {role.active && <span className={css.profileKbd}>{t('soulProfileKeyHint')}</span>}
                      {!isBase && (
                        <button
                          type="button"
                          className={`${css.btn} ${css.btnIcon} ${css.btnDanger}`}
                          aria-label={`${t('soulProfileDelete')} ${role.name}`}
                          disabled={busy}
                          onClick={event => {
                            event.stopPropagation()
                            // 删除走面板那条「以回包为准」的路径；这里只递删除动作需要的三个字段。
                            onRemove({ id: role.id as string, name: role.name, active: role.active })
                          }}
                        >×</button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 切换进度条：activate 是网络请求，别让点击看起来没反应 */}
              <div className={css.profileBar} aria-hidden="true"><i className={css.profileBarFill} /></div>
            </article>
          )
        })}

        {/* ── 新建角色：与卡片同排（放列表下方会让整排高度跳动） ── */}
        {newForm === null
          ? (
            <button
              type="button"
              className={css.profileAdd}
              disabled={busy || atLimit}
              title={atLimit ? t('soulProfileLimit') : t('soulProfileNew')}
              onClick={() => { setNewForm({ name: '', desc: '', tag: '' }) }}
            >
              <span className={css.profileAddPlus}>+</span>
              <span className={css.profileAddText}>{t('soulProfileNew')}</span>
            </button>
          )
          : (
            <div className={css.profileAddForm} role="form" aria-label={t('soulProfileNew')}>
              <div className={css.field}>
                <span className={css.label}>{t('soulProfileNew')}</span>
                <input
                  className={css.input}
                  aria-label={t('soulProfileNew')}
                  placeholder={t('soulProfileNamePlaceholder')}
                  value={newForm.name}
                  autoFocus
                  onChange={event => {
                    const value = event.currentTarget.value
                    setNewForm(current => (current === null ? current : { ...current, name: value }))
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); onCreate(newForm); setNewForm(null) }
                    if (event.key === 'Escape') setNewForm(null)
                  }}
                />
              </div>
              <div className={css.field}>
                <span className={css.label}>{t('soulProfileDescLabel')}</span>
                <input
                  className={css.input}
                  aria-label={t('soulProfileDescLabel')}
                  placeholder={t('soulProfileDescPlaceholder')}
                  maxLength={DESC_LIMIT}
                  value={newForm.desc}
                  onChange={event => {
                    const value = event.currentTarget.value
                    setNewForm(current => (current === null ? current : { ...current, desc: value }))
                  }}
                />
              </div>
              <div className={css.field}>
                <span className={css.label}>{t('soulProfileTagLabel')}</span>
                <input
                  className={css.input}
                  aria-label={t('soulProfileTagLabel')}
                  placeholder={t('soulProfileTagPlaceholder')}
                  maxLength={TAG_LIMIT}
                  value={newForm.tag}
                  onChange={event => {
                    const value = event.currentTarget.value
                    setNewForm(current => (current === null ? current : { ...current, tag: value }))
                  }}
                />
              </div>
              <div className={css.actions}>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnPrimary}`}
                  disabled={busy || newForm.name.trim() === ''}
                  onClick={() => { onCreate(newForm); setNewForm(null) }}
                >{t('soulProfileCreate')}</button>
                <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { setNewForm(null) }}>{t('soulProfileCancel')}</button>
              </div>
            </div>
          )}
      </div>

      {roles.length === 0 && <span className={css.cardHint}>{t('soulProfileEmpty')}</span>}

      {/* ── 存为预设：把「当前这份人格的卡片」存成一套可复用的模板 ──
          这个表单原来是预设区（PresetsSection）渲染的。预设并进画廊后那块整块消失，
          表单就成了孤儿 —— 点「存为预设」只置了状态、界面上什么都没发生（静默无效）。
          所以落点必须跟着搬过来：表单渲染在画廊末尾，与「新建角色」并列。 */}
      {saveAsOpen && (
        <div className={css.profileAddForm} role="form" aria-label={t('soulPresetSaveAs')}>
          <div className={css.field}>
            <span className={css.label}>{t('soulPresetNameLabel')}</span>
            <input
              className={css.input}
              aria-label={t('soulPresetNameLabel')}
              placeholder={t('soulPresetNamePlaceholder')}
              maxLength={40}
              value={presetName}
              autoFocus
              onChange={event => { setPresetName(event.currentTarget.value) }}
              onKeyDown={event => {
                event.stopPropagation()
                if (event.key === 'Enter') { event.preventDefault(); commitPreset() }
                if (event.key === 'Escape') { setPresetName(''); onSaveAsPresetDone() }
              }}
            />
          </div>
          <div className={css.field}>
            <span className={css.label}>{t('soulPresetDescLabel')}</span>
            <input
              className={css.input}
              aria-label={t('soulPresetDescLabel')}
              placeholder={t('soulPresetDescPlaceholder')}
              maxLength={120}
              value={presetDesc}
              onChange={event => { setPresetDesc(event.currentTarget.value) }}
              onKeyDown={event => { event.stopPropagation() }}
            />
          </div>
          <div className={css.actions}>
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              disabled={presetSaving || presetName.trim() === ''}
              onClick={commitPreset}
            >{presetSaving ? <SpinIcon size={12} /> : null}{t('soulPresetSave')}</button>
            <button
              type="button"
              className={`${css.btn} ${css.btnGhost}`}
              onClick={() => { setPresetName(''); setPresetDesc(''); onSaveAsPresetDone() }}
            >{t('soulPresetCancel')}</button>
          </div>
        </div>
      )}
    </section>
  )
}

/** 角色图标（一枚被框住的人形——与「我的资料」区分：那是用户自己，这是人格）。 */
function RoleIcon({ size = 14 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.9" y="1.9" width="12.2" height="12.2" rx="3.2" />
      <circle cx="8" cy="6.6" r="1.9" />
      <path d="M4.7 12.4c.6-1.6 1.9-2.4 3.3-2.4s2.7.8 3.3 2.4" />
    </svg>
  )
}

/** 转圈（头像上传中）。 */
function SpinIcon({ size = 14 }: { readonly size?: number }): JSX.Element {
  return (
    <span className={css.spin} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M8 1.6a6.4 6.4 0 1 1-6.4 6.4" />
      </svg>
    </span>
  )
}
