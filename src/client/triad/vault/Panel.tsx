/**
 * dsh-vault 整页档案面板（工作台里的「档案」一页）。
 *
 * ── 这个页面在做什么 ────────────────────────────────────────────────
 * 它把「档案」按**场景**分组铺成卡片流（用户给的参考图是 Chrome 密码管理器
 * 的那种分组卡）：每张卡 = 一个场景，卡头是「图标 + 场景名 + 数量 + 加一条」，
 * 卡内是记录行（图标 + 标题 + 一行摘要）。点行就在**那一行下面原地展开**详情
 * （不遮页面、不滑抽屉）；「加一条」才是居中弹窗——新建时列表里还没有对应那一
 * 行可展开，只能浮起来。
 *
 * 它不是记忆库的第二份界面：记忆库存陈述句、可模糊检索；档案存实体与字段，
 * 同一账户再来一次「密码是 xxx」是**就地改字段**，不是追加一条。所以这个页面
 * 的基本单位是「记录（实体）」，不是「一句话」。
 *
 * ── 为什么摘要里的敏感字段是圆点 ────────────────────────────────────
 * 两个理由叠在一起：/list 下发的本来就是掩码（宿主 store.toPlainRecord 换过），
 * 页面手上根本没有明文；另外列表是一眼扫过的界面，就算拿得到也不该把密码铺在
 * 每一行上。所以列表只出圆点，要看明文得点开那条记录、再点眼睛（30 秒后自动回隐）。
 *
 * ── 三种状态一个都不能少 ────────────────────────────────────────────
 * 加载态用与真实行同高的骨架（避免切换时跳一下）；错误态给一行中文 + 重试；
 * 空态按场景给不同的引导句。任何一条请求失败都不会让页面白屏。
 * 另外把错误分成两级：**首屏**失败才整块切错误态（那时页面上本来也没有内容），
 * 局部动作（清理 / 保存 / 上传）失败只出一行提示、页面主体照旧——否则用户正在
 * 填的抽屉会被一块红屏盖掉。
 *
 * ── 侧栏联动 ────────────────────────────────────────────────────────
 * 侧栏「操作间 → 档案」的二级菜单点某个场景后，本页只显示那个场景的分组卡。
 * 通道是 api.ts 的 subscribeVaultScene（localStorage + window 事件），与
 * hub/workbench-intent.ts 里记忆 / 画廊那套完全同构——侧栏与页面是两个互不
 * 相邻的 React 根，没有别的通路。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type {
  VaultConfig,
  VaultRecord,
  VaultScene,
  VaultStats,
} from '../../../triad/vault/types.js'
import type { VaultReminderReport, VaultRestoreResult } from './api.js'
import type { VaultSyncPublic } from '../../../triad/vault/sync-types.js'
import {
  deleteVaultScene,
  fetchVaultReminders,
  formatVaultBytes,
  formatVaultStamp,
  getVaultSync,
  listVault,
  maintainVault,
  readVaultScene,
  requestVaultScene,
  saveVaultScene,
  subscribeVaultScene,
  vaultExportUrl,
  vaultRowSummary,
} from './api.js'
import { collectCategories } from '../../../triad/vault/types.js'
import { css, ensureVaultStyles } from './styles.js'
import {
  AlertIcon,
  ChevronRightIcon,
  ClockIcon,
  CloudIcon,
  CloseIcon,
  EmptyIcon,
  ExternalIcon,
  KeyIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
  sceneIconOf,
} from './icons.js'
import { VaultDetailDrawer } from './DetailDrawer.js'
import { VaultReminderWindow, reminderCount, reminderTone } from './ReminderWindow.js'
import { VaultBackupPanel } from './BackupPanel.js'
import { VaultSyncPanel } from './SyncPanel.js'
import { VaultModal } from './Shell.js'
import { PopoverShell, PshBody } from '../popover-shell.js'

/** 面板 props（与记忆 / 技能面板同形，便于接进统一工作台）。 */
export interface VaultPanelProps {
  onClose: () => void
  embedded?: boolean
}

/** 数据加载阶段。 */
type Phase = 'loading' | 'ready' | 'error'

/**
 * 每个场景的空态引导句。
 *
 * 按场景各写一句而不是共用一句「暂无数据」：空态是用户第一次进来时唯一会
 * 认真读的文案，它得告诉用户**这个分组是干什么的、怎么让它有内容**。
 */
const EMPTY_GUIDE: Record<string, { text: string; hint?: string }> = {
  accounts: {
    text: '还没有账号密码记录。',
    hint: '在对话里告诉我哪个网站的账号密码变了，它会自动记下来。',
  },
  email: {
    text: '还没有邮箱账户记录。',
    hint: '说一句「我的邮箱是 xxx，密码是 xxx」，它会把地址、密码、恢复邮箱分开记。',
  },
  payment: {
    text: '还没有支付方式记录。',
    hint: '卡号、有效期这类信息会被加密保存在本机，只有你能点开看。',
  },
  contact: {
    text: '还没有联系方式记录。',
    hint: '电话、地址、社交账号都可以放在这里，按人一条。',
  },
  document: {
    text: '还没有证件记录。',
    hint: '点上面的「拍照 / 上传」把身份证、驾驶证的正反面存进来，再把号码和有效期填上。',
  },
  other: {
    text: '还没有记录。',
    hint: '不属于上面几类的信息放在这里。',
  },
}

/** 记录的用途分类（去空白；老 host 不返回时给空串）。 */
function recordCategoryOf(record: VaultRecord): string {
  return typeof record.category === 'string' ? record.category.trim() : ''
}

/** 搜索匹配（只匹配看得见的文本，敏感值不参与）。 */
function matchesQuery(record: VaultRecord, keyword: string): boolean {
  if (keyword === '') return true
  const needle = keyword.toLowerCase()
  if (record.title.toLowerCase().includes(needle)) return true
  if ((record.subtitle ?? '').toLowerCase().includes(needle)) return true
  if ((record.note ?? '').toLowerCase().includes(needle)) return true
  if (record.tags.some((tag) => tag.toLowerCase().includes(needle))) return true
  // 分类参与搜索：「运维」两个字要能捞出整组服务器相关的记录。
  if (typeof record.category === 'string' && record.category.toLowerCase().includes(needle)) return true
  for (const field of record.fields) {
    if (field.label.toLowerCase().includes(needle)) return true
    // 敏感字段的值不参与匹配：那是密码，搜它既没有意义，还等于把「能搜到」
    // 本身变成一条可观察的明文线索。
    if (field.type === 'secret' || field.sensitive === true) continue
    if (field.value.toLowerCase().includes(needle)) return true
  }
  return false
}

export function VaultPanel({ onClose, embedded = false }: VaultPanelProps): JSX.Element {
  ensureVaultStyles()

  const [phase, setPhase] = useState<Phase>('loading')
  /** 首屏加载失败的原因（只有 phase==='error' 时才渲染成整块错误态）。 */
  const [error, setError] = useState<string>('')
  /** 局部动作失败的一过性错误（保存 / 上传 / 清理），页面主体不受影响。 */
  const [actionError, setActionError] = useState<string>('')
  const [records, setRecords] = useState<VaultRecord[]>([])
  const [scenes, setScenes] = useState<VaultScene[]>([])
  const [stats, setStats] = useState<VaultStats | null>(null)
  const [config, setConfig] = useState<Partial<VaultConfig>>({})

  const [query, setQuery] = useState<string>('')
  /** 侧栏选中的场景（null = 看全部分组）。 */
  const [sceneFilter, setSceneFilter] = useState<string | null>(() => readVaultScene())
  /** 只看已归档（默认关：归档的语义就是「平时不用看见」）。 */
  const [showArchived, setShowArchived] = useState<boolean>(false)
  /** 折叠着的分组（缺省全展开——参考图里所有分组都是摊开的）。 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  /**
   * 每个分组选中的用途分类（scene id → 分类；缺省/空串 = 不过滤）。
   *
   * 为什么筛选条挂在**分组卡内部**而不是页面顶部：分类的语汇是按分组不同的
   * （账号密码里是「服务器运维」，证件里是「本人」），做成全局一条筛选器就得
   * 先选分组再选分类，两步。挂在组里就是「这一组按用途再看细一点」，一步。
   */
  const [categoryFilter, setCategoryFilter] = useState<Record<string, string>>({})
  /** 打开着的记录 id（null = 抽屉没开）。 */
  const [openId, setOpenId] = useState<string | null>(null)
  /** 新建态用哪个场景（非 null = 抽屉开着且是新建）。 */
  const [creatingScene, setCreatingScene] = useState<VaultScene | null>(null)
  /** 一过性提示（保存成功之类），3 秒后自己消失。 */
  const [flash, setFlash] = useState<string>('')
  const [busy, setBusy] = useState<string>('')

  /**
   * 到期提醒清单（null = 还没查过）。
   *
   * 存在父级而不是提醒窗口内部：头部那枚入口要显示「有几项要到期」，它得先拿到
   * 清单才能画。窗口只是这份清单的展开视图，所以数据归父级、窗口是纯展示 +
   * 自己负责重新拉。
   *
   * ⚠ 这里原来放的是「密码健康报告」（分数 + 弱口令 / 复用 / 明文 / 重名四类
   * 问题）。用户 2026-10-27 明确要求删掉那套审计，只保留「会自己变坏」的日期
   * 提醒——判据在宿主侧 reminders.ts，与注入行尾那句「还剩 N 天」同源。
   */
  const [reminders, setReminders] = useState<VaultReminderReport | null>(null)
  const [reminderOpen, setReminderOpen] = useState<boolean>(false)
  const [backupOpen, setBackupOpen] = useState<boolean>(false)
  /**
   * 云端备份（GitHub 私库）那一屏。
   *
   * 与备份/提醒**互斥**（同一个 VaultModal 槽位），但数据流不同：这里的状态
   * 还要驱动页面顶部那条「还没配置好」的提示，所以同步状态挂在父级而不是面板
   * 内部——否则关掉弹窗就看不到「还没配置」这条提醒了。
   */
  const [syncOpen, setSyncOpen] = useState<boolean>(false)
  const [syncState, setSyncState] = useState<VaultSyncPublic | null>(null)

  /** 拉全量（首屏与「刷新 / 重试」共用一条路径）。 */
  const refresh = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const response = await listVault()
      setRecords(response.records)
      setScenes(response.scenes)
      setStats(response.stats)
      setConfig(response.config)
      setPhase('ready')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      // 只有**首屏**失败才整块切错误态：那时页面上本来也没有内容。已经渲染出
      // 数据之后刷新失败（宿主重启中之类），把用户正在看的东西换成一块红屏是
      // 得不偿失的——照旧显示旧数据，只出一行提示。
      setPhase((previous) => {
        if (previous === 'ready') {
          setActionError('刷新失败：' + message + '（下面是上次读到的数据）')
          return previous
        }
        setError(message)
        return 'error'
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * 拉到期提醒（首屏与主数据**分开**）。
   *
   * 不并进 refresh 的三条理由：
   *   1. 它要遍历全部记录算天数，与 /list 是两次不同的读，并进去只会让首屏多等；
   *   2. 它失败不该影响主页面——档案能看，只是暂时不知道有没有东西要到期；
   *   3. 头部那枚按钮的条数是「可以晚一点出现」的信息，而不是页面骨架。
   * 所以这里失败**完全静默**（不弹错误），头部入口退化成「提醒」两个字。
   */
  const loadReminders = useCallback(async (): Promise<void> => {
    try {
      setReminders(await fetchVaultReminders())
    } catch {
      // 静默：提醒是附加信息，失败时头部按钮仍然可以点（点开会给出重试路径）。
      setReminders(null)
    }
  }, [])

  useEffect(() => { void loadReminders() }, [loadReminders])

  /**
   * 读云端备份状态（首屏与「配置变化后」共用）。
   *
   * 失败**静默**：旧版 host 根本没有 /sync 路由（client 刷新即生效、host 要重启
   * DSH），那时请求会 503。让整个档案页显示一条红字「云端备份不可用」，会把
   * 一个可选功能的问题放大成主功能故障。所以这里失败只是让提示条不出现，
   * 用户点进「云端备份」时会在面板里看到具体原因。
   */
  const loadSync = useCallback(async (): Promise<void> => {
    try {
      setSyncState(await getVaultSync())
    } catch {
      setSyncState(null)
    }
  }, [])

  useEffect(() => { void loadSync() }, [loadSync])

  // 侧栏场景意图：页面已挂载时原地切换（写的是同一把 localStorage 键，
  // 所以「侧栏点击 → 页面切换」与「重开页面回到上次场景」共用一条状态）。
  useEffect(() => subscribeVaultScene((sceneId) => {
    setSceneFilter(sceneId === '' ? null : sceneId)
  }), [])

  // Esc 关抽屉。没有抽屉时**不动**：切回会话是工作台外层的事，这里越权会让人
  // 「按一下 Esc 整页没了」。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 顺序＝层叠顺序：最上面那层先关，一次 Esc 只关一层（否则「按一下
      // 全关掉」会让用户找不回刚才看的位置）。
      if (syncOpen) {
        setSyncOpen(false)
        return
      }
      if (backupOpen) {
        setBackupOpen(false)
        return
      }
      if (reminderOpen) {
        setReminderOpen(false)
        return
      }
      if (creatingScene !== null) {
        setCreatingScene(null)
        return
      }
      if (openId !== null) setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [openId, creatingScene, reminderOpen, backupOpen, syncOpen])

  // flash 自动消失（定时器随文本变化重置）。
  useEffect(() => {
    if (flash === '') return undefined
    const timer = window.setTimeout(() => { setFlash('') }, 3000)
    return () => { window.clearTimeout(timer) }
  }, [flash])

  /** 记录被更新（改字段 / 照片增删 / 归档）：替换本地那一份。 */
  const onRecord = useCallback((next: VaultRecord): void => {
    setRecords((previous) => {
      const index = previous.findIndex((item) => item.id === next.id)
      if (index < 0) return [next, ...previous]
      const copy = [...previous]
      copy[index] = next
      return copy
    })
  }, [])

  /** 保存 / 创建成功：从「新建中」切到「编辑这一条」，并给一句提示。 */
  const onSaved = useCallback((next: VaultRecord): void => {
    onRecord(next)
    setCreatingScene(null)
    setOpenId(next.id)
    setActionError('')
    setFlash('已保存')
  }, [onRecord])

  const onDeleted = useCallback((id: string): void => {
    setRecords((previous) => previous.filter((item) => item.id !== id))
    setOpenId(null)
    setFlash('已删除')
  }, [])

  /**
   * 备份恢复成功。
   *
   * 恢复是**整库覆盖**：本地那份 records/scenes 全都作废，必须重新 /list。
   * 顺带重算健康（新库的问题分布完全不同）与关掉备份抽屉（它已经完成使命，
   * 留在屏幕上会让人以为还有一步没做）。
   */
  const onRestored = useCallback((result: VaultRestoreResult): void => {
    setBackupOpen(false)
    setOpenId(null)
    setCreatingScene(null)
    void refresh()
    void loadReminders()
    setActionError('')
    setFlash('已恢复 ' + String(result.records) + ' 条记录')
  }, [refresh, loadReminders])

  /** 提醒窗口里点某一条 → 跳到那条记录（关掉窗口，原地展开详情）。 */
  const onOpenReminder = useCallback((recordId: string): void => {
    setReminderOpen(false)
    setCreatingScene(null)
    setOpenId(recordId)
  }, [])

  /** 清理：清孤儿 blob + 按配额淘汰（一个按钮做完两件事）。 */
  const onMaintain = useCallback(async (): Promise<void> => {
    setBusy('maintain')
    setActionError('')
    try {
      const result = await maintainVault()
      if (result.stats !== null) setStats(result.stats)
      setFlash('清理完成：扫掉 ' + String(result.swept) + ' 个无引用文件，'
        + (result.evicted > 0 ? '按配额淘汰 ' + String(result.evicted) + ' 张照片，' : '')
        + '释放 ' + formatVaultBytes(result.freedBytes))
      await refresh()
    } catch (reason) {
      setActionError('清理失败：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setBusy('')
    }
  }, [refresh])

  /** 删除自定义场景（内置场景不给入口：抽取归集需要落点）。 */
  const onDeleteScene = useCallback(async (scene: VaultScene): Promise<void> => {
    const message = '删除场景「' + scene.label + '」？\n场景里的记录不会被删除，它们会出现在「其它」里。'
    if (!window.confirm(message)) return
    setBusy('scene:' + scene.id)
    try {
      const next = await deleteVaultScene(scene.id)
      setScenes(next)
      if (sceneFilter === scene.id) {
        setSceneFilter(null)
        requestVaultScene('')
      }
      setFlash('已删除场景「' + scene.label + '」')
    } catch (reason) {
      setActionError('删除场景失败：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setBusy('')
    }
  }, [sceneFilter])

  /**
   * 重命名场景。
   *
   * 用原生 prompt 而不是行内输入框：这是**每个场景一辈子可能只改一次**的动作，
   * 为此在卡头常驻一个输入框（或一个编辑图标）会让卡头多一块噪声，而参考图
   * 里卡头只有「名字 + 动作」。低频动作配一个轻量的原生弹窗是合适的取舍。
   */
  const onRenameScene = useCallback(async (scene: VaultScene): Promise<void> => {
    const next = window.prompt('场景名', scene.label)
    if (next === null) return
    const label = next.trim()
    if (label === '' || label === scene.label) return
    setBusy('scene:' + scene.id)
    try {
      const updated = await saveVaultScene({ ...scene, label })
      setScenes(updated)
    } catch (reason) {
      setActionError('改场景名失败：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setBusy('')
    }
  }, [])

  /** 按场景分组后的记录（保持 /list 给的 updatedAt 降序）。 */
  const grouped = useMemo(() => {
    const keyword = query.trim()
    const map = new Map<string, VaultRecord[]>()
    for (const scene of scenes) map.set(scene.id, [])
    for (const record of records) {
      if (showArchived ? record.archived !== true : record.archived === true) continue
      if (!matchesQuery(record, keyword)) continue
      const bucket = map.get(record.scene)
      if (bucket === undefined) {
        // 记录挂在一个已经不存在的场景上（场景被删了）：落到「其它」，
        // 否则这条记录会在页面上凭空消失——用户会以为数据丢了。
        map.get('other')?.push(record)
        continue
      }
      bucket.push(record)
    }
    return map
  }, [records, scenes, query, showArchived])

  /** 原地展开着的那条记录（null = 没有展开的）。 */
  const openRecord = openId === null
    ? null
    : records.find((record) => record.id === openId) ?? null
  /** 原地展开那条记录所属的场景（详情里的照片区块要用它的 photoFirst）。 */
  const openScene = openRecord === null
    ? null
    : scenes.find((scene) => scene.id === openRecord.scene) ?? null

  /** 当前可见的场景（侧栏选中时只留一个）。 */
  const visibleScenes = useMemo(() => {
    if (sceneFilter === null) return scenes
    const hit = scenes.filter((scene) => scene.id === sceneFilter)
    // 侧栏记着一个已经被删掉的场景：回落成全部分组，而不是给一张白页。
    return hit.length > 0 ? hit : scenes
  }, [scenes, sceneFilter])

  const filteredScene = sceneFilter === null
    ? null
    : scenes.find((scene) => scene.id === sceneFilter) ?? null

  const totalVisible = useMemo(
    () => [...grouped.values()].reduce((sum, list) => sum + list.length, 0),
    [grouped],
  )

  /* ── 提醒入口的展示值 ──
   * 条数直接给人看（「3 项要到期了」是这条入口的全部价值），颜色只表达「有没有
   * 已经过期的」。清单还没拿到时按钮照常可点、照常显示——点开窗口里有它自己的
   * 加载与重试路径，不必在头部分出一个禁用的中间态。 */
  const reminderTotal = reminderCount(reminders)
  const reminderToneValue = reminderTone(reminders)
  const reminderLabel = '提醒'
  const reminderTitle = reminders === null
    ? '到期提醒（证件、银行卡、证书这类有有效期的记录）'
    : reminderTotal === 0
      ? '到期提醒：90 天内没有要到期的东西'
      : '到期提醒：有 ' + String(reminderTotal) + ' 项要到期了'

  /* ── 云端备份入口的展示值 ──
   * 三态：读不到（null，旧 host / 403）/ 已就绪 / 还缺东西。缺东西时按钮上挂
   * 一个感叹号角标，并在页面顶部出一条常显提示——用户明确要求「以后别人用这个
   * 插件时都会提示他填 GitHub 地址」，所以这条提示不能藏在弹窗里。 */
  const syncNeedsSetup = syncState !== null && syncState.needsSetup
  const syncTone = syncState === null
    ? 'low'
    : syncState.lastStatus === 'error'
      ? 'bad'
      : syncNeedsSetup
        ? 'warn'
        : 'good'
  const syncTitle = syncState === null
    ? '云端备份（把加密档案包定时上传到 GitHub 私有仓库）'
    : syncNeedsSetup
      ? '云端备份还没配置好：点开填一个 GitHub 私有仓库地址'
      : syncState.upToDate === true
        ? '云端备份：已全部上传（' + (syncState.uploadedRecords > 0 ? String(syncState.uploadedRecords) + ' 条记录 · ' : '') + '上次 ' + formatVaultStamp(syncState.lastAt) + '）'
        : syncState.upToDate === false
          ? '云端备份：有改动尚未上传（当前 ' + String(syncState.currentRecords) + ' 条 / 云端 ' + String(syncState.uploadedRecords) + ' 条）'
          : syncState.lastStatus === 'error'
            ? '云端备份：上次同步失败'
            : syncState.lastStatus === 'ok'
              ? '云端备份：已传过备份，待确认是否最新'
              : '云端备份：尚未上传'

  /* 按钮上那枚小角标：绿点=已全部上传，黄点=有改动未传，! = 还没配置。
     用户要求「要显示状态是否全部上传了」，所以这个状态必须出现在不打开弹窗
     也能看到的地方——就是这枚按钮。 */
  const syncBadge = syncState === null
    ? null
    : syncNeedsSetup
      ? <span className={css.remindBadge}>!</span>
      : syncState.upToDate === true
        ? <span className={css.syncDot} data-state="done" />
        : syncState.upToDate === false
          ? <span className={css.syncDot} data-state="dirty" />
          : null

  const shell = (children: JSX.Element): JSX.Element => (
    embedded
      ? <div className={css.root}>{children}</div>
      : (
        <PopoverShell onClose={onClose} ariaLabel="档案">
          <PshBody>
            <div className={css.root}>{children}</div>
          </PshBody>
        </PopoverShell>
      )
  )

  const head = (
    <header className={css.head}>
      <div className={css.headMain}>
        <h1 className={css.title}>档案</h1>
        <p className={css.hint}>
          这些内容每次会话都会自动读取；密码等敏感值只保存在本机、不会发送给模型。
          列表里默认显示成圆点，点开记录再点眼睛才看得到明文，30 秒后自动隐藏。
        </p>
        <div className={css.headActions}>
          <button
            type="button"
            className={css.remindBtn}
            data-tone={reminderToneValue}
            title={reminderTitle}
            aria-label={reminderTitle}
            onClick={() => { setBackupOpen(false); setSyncOpen(false); setReminderOpen(true) }}
          >
            <ClockIcon size={13} />
            {reminderLabel}
            {reminderTotal > 0 && (
              <span className={css.remindBadge}>{String(reminderTotal)}</span>
            )}
          </button>
          <button
            type="button"
            className={css.ghostBtn}
            title={syncTitle}
            data-tone={syncTone}
            onClick={() => { setReminderOpen(false); setBackupOpen(false); setSyncOpen(true); void loadSync() }}
          >
            <CloudIcon size={13} /> 云端
            {syncBadge}
          </button>
          <button
            type="button"
            className={css.ghostBtn}
            title="备份密钥与恢复（换机器时用）"
            onClick={() => { setReminderOpen(false); setSyncOpen(false); setBackupOpen(true) }}
          >
            <KeyIcon size={13} /> 备份
          </button>
          <button
            type="button"
            className={css.ghostBtn}
            title="重新读取档案"
            disabled={busy !== ''}
            onClick={() => { void refresh(); void loadReminders() }}
          >
            <RefreshIcon size={13} /> 刷新
          </button>
        </div>
      </div>
      <div className={css.searchWrap}>
        <span className={css.searchIcon}><SearchIcon size={14} /></span>
        <input
          className={css.searchInput}
          value={query}
          placeholder="搜索记录、字段名或标签（密码不进索引）"
          aria-label="搜索档案"
          onChange={(event) => { setQuery(event.target.value) }}
        />
        {query !== '' && (
          <button
            type="button"
            className={css.searchClear}
            aria-label="清空搜索"
            onClick={() => { setQuery('') }}
          >
            <CloseIcon size={10} />
          </button>
        )}
      </div>
    </header>
  )

  if (phase === 'loading') {
    return shell(
      <>
        {head}
        <div className={css.scroll}>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className={css.skeleton}
              style={{ '--v-i': String(index) } as CSSProperties}
            >
              <div className={css.skeletonRow} style={{ height: 20, width: '30%' }} />
              <div className={css.skeletonRow} />
              <div className={css.skeletonRow} />
            </div>
          ))}
        </div>
      </>,
    )
  }

  if (phase === 'error') {
    return shell(
      <>
        {head}
        <div className={css.scroll}>
          <div className={css.error}>
            <span style={{ display: 'inline-flex', flex: 'none' }}><AlertIcon size={15} /></span>
            <div className={css.errorText}>读取档案失败：{error}</div>
            <button type="button" className={css.errorRetry} onClick={() => { void refresh() }}>
              重试
            </button>
          </div>
          <div className={css.emptyText} style={{ color: 'var(--v-text-3)', fontSize: 12 }}>
            档案数据保存在本机，读不到通常是宿主半身还没启动完（插件改动后要重启 DSH Web 服务）。
          </div>
        </div>
      </>,
    )
  }

  return shell(
    <>
      {head}

      {actionError !== '' && (
        <div className={css.error} style={{ margin: '10px 20px 0' }}>
          <span style={{ display: 'inline-flex', flex: 'none' }}><AlertIcon size={15} /></span>
          <div className={css.errorText}>{actionError}</div>
          <button type="button" className={css.errorRetry} onClick={() => { setActionError('') }}>
            知道了
          </button>
        </div>
      )}

      {flash !== '' && <div className={css.notice}>{flash}</div>}

      {/*
        「还没配 GitHub 私库」的常显提示条。
        用户明确要求：以后别人用这个插件时都要提示他填这个地址。所以它不是弹窗、
        不是一次性 toast，而是配好之前一直在的一条。点「去配置」直接开那一屏。
        配好之后立刻消失（判据是 host 回算的 needsSetup，前端不自己再推一遍）。
      */}
      {syncNeedsSetup && (
        <div className={css.notice} data-tone="warn">
          <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1 }}><CloudIcon size={13} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            档案还没有云端备份：填一个<b>你自己的</b> GitHub <b>私有</b>仓库地址，之后每
            {' '}{String(syncState?.everyHours ?? 5)} 小时自动传一份加密备份上去（换机器、重装系统后靠它恢复）。
          </span>
          <button
            type="button"
            className={css.ghostBtn}
            style={{ height: 24, flex: 'none' }}
            onClick={() => { void loadSync(); setSyncOpen(true) }}
          >
            去配置
          </button>
        </div>
      )}

      {filteredScene !== null && (
        <div className={css.notice}>
          <span>只看「{filteredScene.label}」</span>
          <button
            type="button"
            className={css.ghostBtn}
            style={{ height: 24 }}
            onClick={() => { setSceneFilter(null); requestVaultScene('') }}
          >
            显示全部分组
          </button>
        </div>
      )}

      <div className={css.scroll}>
        {visibleScenes.map((scene, index) => {
          const all = grouped.get(scene.id) ?? []
          // 这个分组里实际用到的分类（按建议清单顺序 + 使用次数），只有真的出现
          // 两种以上才画筛选条：只有一种分类时那一条筛选器是纯噪音。
          // 筛选条只列**实际在用的分类**，不把场景的建议清单全铺上来：
          // 建议清单是给「新建 / 编辑」时点选用的，铺进筛选条会让每个分组都长出一排
          // 点了必然为空的胶囊（联系方式组里根本没有「服务器运维」这种选项）。
          const usedCategories = [...new Set(all.map((record) => recordCategoryOf(record)).filter((value) => value !== ''))]
          const categoryChoices = usedCategories.length > 1 ? usedCategories : []
          const activeCategory = categoryFilter[scene.id] ?? ''
          const list = activeCategory === '' ? all : all.filter((record) => recordCategoryOf(record) === activeCategory)
          const Icon = sceneIconOf(scene.id)
          const guide = EMPTY_GUIDE[scene.id] ?? { text: '还没有记录。' }
          const isCollapsed = collapsed[scene.id] === true
          const sceneBusy = busy === 'scene:' + scene.id
          return (
            <section
              key={scene.id}
              className={css.group}
              style={{ '--v-i': String(index) } as CSSProperties}
            >
              <div className={css.groupHead}>
                <span className={css.groupIcon}><Icon size={15} /></span>
                <button
                  type="button"
                  className={css.groupName}
                  title="点一下改场景名"
                  disabled={sceneBusy}
                  onClick={() => { void onRenameScene(scene) }}
                >
                  {scene.label}
                </button>
                <span className={css.groupDesc}>{scene.desc}</span>
                <span
                  className={css.groupCount}
                  title={activeCategory === '' ? String(all.length) + ' 条' : String(list.length) + ' / ' + String(all.length) + ' 条（已按用途筛选）'}
                >
                  {activeCategory === '' ? String(all.length) : String(list.length) + '/' + String(all.length)}
                </span>
                {!scene.builtin && (
                  <button
                    type="button"
                    className={css.groupAdd}
                    title="删除这个自定义场景（记录会移到「其它」）"
                    aria-label={'删除场景' + scene.label}
                    disabled={sceneBusy}
                    onClick={() => { void onDeleteScene(scene) }}
                  >
                    <TrashIcon size={12} />
                  </button>
                )}
                <button
                  type="button"
                  className={css.groupAdd}
                  title="在这个分组里加一条记录"
                  aria-label={'在' + scene.label + '里加一条记录'}
                  onClick={() => { setCreatingScene(scene); setOpenId(null) }}
                >
                  <PlusIcon size={14} />
                </button>
                <button
                  type="button"
                  className={css.groupAdd}
                  title={isCollapsed ? '展开这个分组' : '收起这个分组'}
                  aria-label={isCollapsed ? '展开' + scene.label : '收起' + scene.label}
                  aria-expanded={!isCollapsed}
                  onClick={() => {
                    setCollapsed((previous) => ({ ...previous, [scene.id]: !isCollapsed }))
                  }}
                >
                  <span style={{
                    display: 'inline-flex',
                    transform: isCollapsed ? 'none' : 'rotate(90deg)',
                    transition: 'transform .18s cubic-bezier(.2,.8,.2,1)',
                  }}>
                    <ChevronRightIcon size={13} />
                  </span>
                </button>
              </div>

              {/* 用途筛选条：只有组内出现两种以上分类时才画（一种分类时它是噪音）。 */}
              {!isCollapsed && categoryChoices.length > 1 && (
                <div className={css.categoryFilter}>
                  <button
                    type="button"
                    className={css.categoryChip}
                    data-on={activeCategory === '' ? '1' : '0'}
                    title="显示这一组的全部记录"
                    onClick={() => {
                      setCategoryFilter((previous) => {
                        const next = { ...previous }
                        delete next[scene.id]
                        return next
                      })
                    }}
                  >
                    全部
                  </button>
                  {categoryChoices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className={css.categoryChip}
                      data-on={activeCategory === choice ? '1' : '0'}
                      title={'只看「' + choice + '」'}
                      onClick={() => {
                        setCategoryFilter((previous) => {
                          const next = { ...previous }
                          if (next[scene.id] === choice) delete next[scene.id]
                          else next[scene.id] = choice
                          return next
                        })
                      }}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              )}

              {!isCollapsed && (
                <div className={css.groupBody}>
                  {list.length === 0 ? (
                    <div className={css.empty}>
                      <span className={css.emptyIcon}><EmptyIcon size={15} /></span>
                      <span className={css.emptyText}>
                        {query.trim() !== ''
                          ? '这个分组里没有匹配「' + query.trim() + '」的记录。'
                          : activeCategory !== ''
                            ? '「' + activeCategory + '」下面还没有记录。'
                            : guide.text}
                        {query.trim() === '' && guide.hint !== undefined && (
                          <span className={css.emptyHint}>{guide.hint}</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    list.map((record) => {
                      const isOpen = openId === record.id
                      return (
                        <Fragment key={record.id}>
                          <button
                            type="button"
                            className={css.row + (isOpen ? ' ' + css.rowSel : '')}
                            aria-expanded={isOpen}
                            // 点已展开的那一行＝收起来。再点一次还得给个出口，
                            // 否则用户只能去找那个小小的关闭按钮。
                            onClick={() => { setCreatingScene(null); setOpenId(isOpen ? null : record.id) }}
                          >
                            <span className={css.rowIcon}><Icon size={15} /></span>
                            <span className={css.rowMain}>
                              <span className={css.rowTitle}>
                                {/* 分类胶囊排在标题前：用户要「一眼看出用途」，
                                    它必须落在扫视第一落点上。未分类不画（见 styles 注释）。 */}
                                {recordCategoryOf(record) !== '' && (
                                  <span className={css.rowCategory} title={'用途：' + recordCategoryOf(record)}>
                                    {recordCategoryOf(record)}
                                  </span>
                                )}
                                {record.title === '' ? '（未命名）' : record.title}
                              </span>
                              <span className={css.rowSub}>{vaultRowSummary(record)}</span>
                            </span>
                            <span className={css.rowTail}>
                              {record.archived === true && <span className={css.badgeArchived}>已归档</span>}
                              <span className={css.rowArrow}><ChevronRightIcon size={13} /></span>
                            </span>
                          </button>
                          {/*
                            原地展开的详情：就在被点开那一行的正下方，与它同处一个
                            分组卡里。key 用记录 id 保证「换一条」是重新挂载——已显示
                            的明文、标题草稿、行内编辑态必须跟着换人，不然上一条的密码
                            会挂在新记录上（光看界面发现不了的串台）。
                          */}
                          {isOpen && (
                            <div className={css.expand} key={'expand:' + record.id}>
                              <VaultDetailDrawer
                                record={record}
                                siblings={records.filter((item) => item.scene === record.scene && item.id !== record.id)}
                                scene={scenes.find((item) => item.id === record.scene) ?? null}
                                config={config}
                                shell="expand"
                                onError={(message) => { setActionError(message) }}
                                onRecord={onRecord}
                                onSaved={onSaved}
                                onDeleted={onDeleted}
                                onClose={() => { setOpenId(null) }}
                              />
                            </div>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                </div>
              )}
            </section>
          )
        })}

        {visibleScenes.length === 0 && (
          <div className={css.empty}>
            <span className={css.emptyIcon}><EmptyIcon size={15} /></span>
            <span className={css.emptyText}>还没有任何分组。</span>
          </div>
        )}

        {/* 底部：统计 + 低频动作（归档开关 / 清理 / 导出）。
            放在滚动区末尾而不是顶栏：它们都是偶尔才动一次的东西，顶栏留给
            搜索与刷新（与参考图一致：顶上是搜索，动作贴着内容）。 */}
        <footer className={css.foot}>
          <span>
            {String(records.length)} 条记录 · {String(stats?.photos ?? 0)} 张照片 · 占用{' '}
            {formatVaultBytes(stats?.blobBytes ?? 0)}
            {query.trim() !== '' ? ' · 当前筛出 ' + String(totalVisible) + ' 条' : ''}
          </span>
          <span className={css.footActions}>
            <button
              type="button"
              className={css.ghostBtn}
              style={{ height: 24 }}
              onClick={() => { setShowArchived(!showArchived) }}
            >
              {showArchived ? '看未归档的' : '看已归档的'}
            </button>
            <button
              type="button"
              className={css.ghostBtn}
              style={{ height: 24 }}
              title="清掉没有记录引用的图片文件，并按配额淘汰旧照片"
              disabled={busy !== ''}
              onClick={() => { void onMaintain() }}
            >
              {busy === 'maintain' ? '清理中…' : '清理占用'}
            </button>
            <a
              className={css.ghostBtn}
              style={{ height: 24, textDecoration: 'none' }}
              href={vaultExportUrl()}
              download="dsh-vault-export.json"
              title="导出 JSON（敏感值仍是密文，换机器导入要靠同一把密钥）"
            >
              <ExternalIcon size={12} /> 导出
            </a>
          </span>
        </footer>
      </div>

      {/* ── 三块浮层，形态按语义分两种 ───────────────────────────────

           · 新建记录 / 健康检查 / 备份恢复 → 居中弹窗。
             它们都是「一次性的整块任务」，背后没有「对应的那一行」可以展开：
             新建时记录还不存在，健康与备份是整库报告。

           · 查看 / 编辑一条已有记录 → 不在这里，而是**原地展开**在那一行下面
             （见上面 list.map 里的 VaultDetailDrawer）。用户要的就是这个：点开
             一条记录不该把整页压暗，也不该从右边滑出来。

           三块互斥（同一时刻只开一个），所以各自一段条件渲染、不共用状态。 */}
      {syncOpen && (
        <VaultModal label="云端备份" onClose={() => { setSyncOpen(false) }}>
          <div className={css.panelHead}>
            <span style={{ display: 'inline-flex', color: 'var(--v-text-2)' }}><CloudIcon size={16} /></span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' }}>
              云端备份（GitHub 私库）
            </div>
            <button
              type="button"
              className={css.panelClose}
              aria-label="关闭云端备份"
              title="关闭（Esc）"
              onClick={() => { setSyncOpen(false) }}
            >
              <CloseIcon size={15} />
            </button>
          </div>
          <div className={css.panelBody}>
            <VaultSyncPanel
              onError={(message) => { setActionError(message) }}
              onFlash={(message) => { setFlash(message) }}
              onSynced={() => { void loadSync(); void refresh() }}
            />
          </div>
        </VaultModal>
      )}

      {reminderOpen && (
        <VaultModal label="到期提醒" onClose={() => { setReminderOpen(false) }}>
          <VaultReminderWindow
            onOpenRecord={onOpenReminder}
            onClose={() => { setReminderOpen(false) }}
          />
        </VaultModal>
      )}

      {backupOpen && (
        <VaultModal label="备份与恢复" onClose={() => { setBackupOpen(false) }}>
          <div className={css.panelHead}>
            <span style={{ display: 'inline-flex', color: 'var(--v-text-2)' }}><KeyIcon size={16} /></span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' }}>
              备份与恢复
            </div>
            <button
              type="button"
              className={css.panelClose}
              aria-label="关闭备份与恢复"
              title="关闭（Esc）"
              onClick={() => { setBackupOpen(false) }}
            >
              <CloseIcon size={15} />
            </button>
          </div>
          <div className={css.panelBody}>
            <VaultBackupPanel
              onRestored={onRestored}
              onError={(message) => { setActionError(message) }}
              onFlash={(message) => { setFlash(message) }}
            />
          </div>
        </VaultModal>
      )}

      {creatingScene !== null && (
        <VaultModal label="新建档案记录" onClose={() => { setCreatingScene(null) }}>
          <VaultDetailDrawer
            /*
             * key 让「换一个场景新建」变成**重新挂载**而不是改 props。
             * 不加 key 的话，从 A 的加号直接点 B 的加号时，弹窗里那份「按场景模板
             * 预填的草稿」还是 A 的字段表——新建出来的记录带着上一个场景的字段，
             * 而且界面上完全看不出异常。重新挂载顺带把已显示的明文、标题草稿、
             * 行内编辑态一起清干净，比逐个 useEffect 复位更不容易漏。
             */
            key={'new:' + creatingScene.id}
            record={null}
            scene={creatingScene}
            siblings={records.filter((item) => item.scene === creatingScene.id)}
            config={config}
            shell="modal"
            onError={(message) => { setActionError(message) }}
            onRecord={onRecord}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onClose={() => { setCreatingScene(null) }}
          />
        </VaultModal>
      )}
    </>,
  )
}