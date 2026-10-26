/**
 * dsh-vault 整页档案面板（工作台里的「档案」一页）。
 *
 * ── 这个页面在做什么 ────────────────────────────────────────────────
 * 它把「档案」按**场景**分组铺成卡片流（用户给的参考图是 Chrome 密码管理器
 * 的那种分组卡）：每张卡 = 一个场景，卡头是「图标 + 场景名 + 数量 + 加一条」，
 * 卡内是记录行（图标 + 标题 + 一行摘要）。点行开右侧详情抽屉。
 *
 * 它不是记忆库的第二份界面：记忆库存陈述句、可模糊检索；档案存实体与字段，
 * 同一账户再来一次「密码是 xxx」是**就地改字段**，不是追加一条。所以这个页面
 * 的基本单位是「记录（实体）」，不是「一句话」。
 *
 * ── 为什么摘要里的敏感字段是圆点 ────────────────────────────────────
 * 两个理由叠在一起：/list 下发的本来就是掩码（宿主 store.toPlainRecord 换过），
 * 页面手上根本没有明文；另外列表是一眼扫过的界面，就算拿得到也不该把密码铺在
 * 每一行上。所以列表只出圆点，要看明文得点开抽屉、再点眼睛（30 秒后自动回隐）。
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type {
  VaultConfig,
  VaultRecord,
  VaultScene,
  VaultStats,
} from '../../../triad/vault/types.js'
import type { VaultHealthReport, VaultRestoreResult } from './api.js'
import {
  deleteVaultScene,
  fetchVaultHealth,
  formatVaultBytes,
  listVault,
  maintainVault,
  readVaultScene,
  requestVaultScene,
  saveVaultScene,
  subscribeVaultScene,
  vaultExportUrl,
  vaultRowSummary,
} from './api.js'
import { css, ensureVaultStyles } from './styles.js'
import {
  AlertIcon,
  ChevronRightIcon,
  CloseIcon,
  EmptyIcon,
  ExternalIcon,
  PlusIcon,
  KeyIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  TrashIcon,
  sceneIconOf,
} from './icons.js'
import { VaultDetailDrawer } from './DetailDrawer.js'
import { VaultHealthDrawer, pendingIssueCount, worstSeverityOf } from './HealthDrawer.js'
import { VaultBackupPanel } from './BackupPanel.js'
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

/** 搜索匹配（只匹配看得见的文本，敏感值不参与）。 */
function matchesQuery(record: VaultRecord, keyword: string): boolean {
  if (keyword === '') return true
  const needle = keyword.toLowerCase()
  if (record.title.toLowerCase().includes(needle)) return true
  if ((record.subtitle ?? '').toLowerCase().includes(needle)) return true
  if ((record.note ?? '').toLowerCase().includes(needle)) return true
  if (record.tags.some((tag) => tag.toLowerCase().includes(needle))) return true
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
  /** 打开着的记录 id（null = 抽屉没开）。 */
  const [openId, setOpenId] = useState<string | null>(null)
  /** 新建态用哪个场景（非 null = 抽屉开着且是新建）。 */
  const [creatingScene, setCreatingScene] = useState<VaultScene | null>(null)
  /** 一过性提示（保存成功之类），3 秒后自己消失。 */
  const [flash, setFlash] = useState<string>('')
  const [busy, setBusy] = useState<string>('')

  /**
   * 健康报告（null = 还没查过）。
   *
   * 存在父级而不是健康抽屉内部：头部那枚入口要显示「待处理条数」，它得先拿到
   * 报告才能画。抽屉只是这份报告的展开视图，所以数据归父级、抽屉是纯展示 +
   * 自己负责重新拉。
   */
  const [health, setHealth] = useState<VaultHealthReport | null>(null)
  const [healthOpen, setHealthOpen] = useState<boolean>(false)
  const [backupOpen, setBackupOpen] = useState<boolean>(false)

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
   * 拉健康报告（首屏与主数据**分开**）。
   *
   * 不并进 refresh 的三条理由：
   *   1. 健康审计要扫全部密码，比 /list 慢，并进去会拖慢首屏；
   *   2. 它失败不该影响主页面——档案能看，只是暂时不知道健康状况；
   *   3. 头部那枚按钮的条数是「可以晚一点出现」的信息，而不是页面骨架。
   * 所以这里失败**完全静默**（不弹错误），只在头部入口上退化成「检查」两个字。
   */
  const loadHealth = useCallback(async (): Promise<void> => {
    try {
      setHealth(await fetchVaultHealth())
    } catch {
      // 静默：健康检查是附加功能，失败时头部按钮仍然可以点（点开会给出重试路径）。
      setHealth(null)
    }
  }, [])

  useEffect(() => { void loadHealth() }, [loadHealth])

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
      if (backupOpen) {
        setBackupOpen(false)
        return
      }
      if (healthOpen) {
        setHealthOpen(false)
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
  }, [openId, creatingScene, healthOpen, backupOpen])

  // flash 自动消失（定时器随文本变化重置）。
  useEffect(() => {
    if (flash === '') return undefined
    const timer = window.setTimeout(() => { setFlash('') }, 3000)
    return () => { window.clearTimeout(timer) }
  }, [flash])

  /** 记录被更新（改字段 / 照片增删 / 确认 / 归档）：替换本地那一份。 */
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
    void loadHealth()
    setActionError('')
    setFlash('已恢复 ' + String(result.records) + ' 条记录')
  }, [refresh, loadHealth])

  /**
   * 健康抽屉里批量轮换成功。
   *
   * 库里那几条记录的密码被**当场改写**了，父级这份 records 已经不新鲜：不重拉
   * 的话列表摘要与版本号都还是旧的。健康报告同样要重算（复用问题应当当场消失）。
   * 健康抽屉由它自己保持打开——它得留在屏幕上把新明文密码交给用户抄。
   */
  const onRotated = useCallback((): void => {
    void refresh()
    void loadHealth()
  }, [refresh, loadHealth])

  /** 健康抽屉里点某条问题 → 跳到那条记录（关掉健康抽屉，打开详情）。 */
  const onOpenHealthIssue = useCallback((recordId: string): void => {
    setHealthOpen(false)
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

  /** 待确认条数（顶部提醒用）。 */
  const pendingCount = useMemo(
    () => records.filter((record) => record.pending === true && record.archived !== true).length,
    [records],
  )

  const openRecord = openId === null
    ? null
    : records.find((record) => record.id === openId) ?? null
  const openScene = creatingScene !== null
    ? creatingScene
    : openRecord === null
      ? null
      : scenes.find((scene) => scene.id === openRecord.scene) ?? null
  const drawerOpen = creatingScene !== null || (openRecord !== null && openId !== null)

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

  /* ── 健康入口的展示值 ──
   * 条数直接给人看（「3 项待处理」是这条入口的全部价值），颜色只表达「有没有
   * 高危」。报告还没拿到时按钮照常可点、照常显示——点开抽屉里有它自己的加载与
   * 重试路径，不必在头部分出一个禁用的中间态。 */
  const healthCount = pendingIssueCount(health)
  const healthWorst = worstSeverityOf(health)
  const healthTone = healthWorst === 'high'
    ? 'bad'
    : healthWorst === 'medium'
      ? 'warn'
      : healthWorst === 'low'
        ? 'low'
        : 'good'
  const healthLabel = '健康'
  const healthTitle = health === null
    ? '检查密码健康（重复使用 / 太弱 / 太久没改 / 快过期）'
    : healthCount === 0
      ? '密码健康：没发现问题'
      : '密码健康：有 ' + String(healthCount) + ' 项待处理'

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
            className={css.healthBtn}
            data-tone={healthTone}
            title={healthTitle}
            aria-label={healthTitle}
            onClick={() => { setBackupOpen(false); setHealthOpen(true) }}
          >
            <ShieldIcon size={13} />
            {healthLabel}
            {healthCount > 0 && (
              <span className={css.healthBadge}>{String(healthCount)}</span>
            )}
          </button>
          <button
            type="button"
            className={css.ghostBtn}
            title="备份密钥与恢复（换机器时用）"
            onClick={() => { setHealthOpen(false); setBackupOpen(true) }}
          >
            <KeyIcon size={13} /> 备份
          </button>
          <button
            type="button"
            className={css.ghostBtn}
            title="重新读取档案"
            disabled={busy !== ''}
            onClick={() => { void refresh(); void loadHealth() }}
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

      {pendingCount > 0 && (
        <div className={css.notice}>
          有 {String(pendingCount)} 条自动记录下来的内容等你确认（点开记录，底部有「确认 / 驳回」）。
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
          const list = grouped.get(scene.id) ?? []
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
                <span className={css.groupCount} title={String(list.length) + ' 条'}>{String(list.length)}</span>
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

              {!isCollapsed && (
                <div className={css.groupBody}>
                  {list.length === 0 ? (
                    <div className={css.empty}>
                      <span className={css.emptyIcon}><EmptyIcon size={15} /></span>
                      <span className={css.emptyText}>
                        {query.trim() === ''
                          ? guide.text
                          : '这个分组里没有匹配「' + query.trim() + '」的记录。'}
                        {query.trim() === '' && guide.hint !== undefined && (
                          <span className={css.emptyHint}>{guide.hint}</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    list.map((record) => (
                      <button
                        key={record.id}
                        type="button"
                        className={css.row + (openId === record.id ? ' ' + css.rowSel : '')}
                        onClick={() => { setCreatingScene(null); setOpenId(record.id) }}
                      >
                        <span className={css.rowIcon}><Icon size={15} /></span>
                        <span className={css.rowMain}>
                          <span className={css.rowTitle}>
                            {record.title === '' ? '（未命名）' : record.title}
                          </span>
                          <span className={css.rowSub}>{vaultRowSummary(record)}</span>
                        </span>
                        <span className={css.rowTail}>
                          {record.pending === true && <span className={css.badgePending}>待确认</span>}
                          {record.archived === true && <span className={css.badgeArchived}>已归档</span>}
                          <span className={css.rowArrow}><ChevronRightIcon size={13} /></span>
                        </span>
                      </button>
                    ))
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

      {/* 健康抽屉与备份抽屉：都盖在页面上、都要先有一层 scrim。
          三个抽屉互斥（同一时刻只开一个），所以各自一段条件渲染、不共用状态。 */}
      {healthOpen && (
        <>
          <div className={css.scrim} onClick={() => { setHealthOpen(false) }} aria-hidden="true" />
          <VaultHealthDrawer
            onOpenRecord={onOpenHealthIssue}
            onRotated={onRotated}
            onClose={() => { setHealthOpen(false) }}
          />
        </>
      )}

      {backupOpen && (
        <>
          <div className={css.scrim} onClick={() => { setBackupOpen(false) }} aria-hidden="true" />
          <div className={css.drawer} role="dialog" aria-modal="true" aria-label="备份与恢复">
            <div className={css.drawerHead}>
              <span style={{ display: 'inline-flex', color: 'var(--v-text-2)' }}><KeyIcon size={16} /></span>
              <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' }}>
                备份与恢复
              </div>
              <button
                type="button"
                className={css.drawerClose}
                aria-label="关闭备份与恢复"
                title="关闭（Esc）"
                onClick={() => { setBackupOpen(false) }}
              >
                <CloseIcon size={15} />
              </button>
            </div>
            <div className={css.drawerBody}>
              <VaultBackupPanel
                onRestored={onRestored}
                onError={(message) => { setActionError(message) }}
                onFlash={(message) => { setFlash(message) }}
              />
            </div>
          </div>
        </>
      )}

      {drawerOpen && (
        <>
          <div
            className={css.scrim}
            onClick={() => { setOpenId(null); setCreatingScene(null) }}
            aria-hidden="true"
          />
          <VaultDetailDrawer
            /*
             * key 让「换一条记录 / 换一个场景新建」变成**重新挂载**而不是改 props。
             * 不加 key 的话，从 A 的加号直接点 B 的加号时，抽屉里那份「按场景模板
             * 预填的草稿」还是 A 的字段表——新建出来的记录带着上一个场景的字段，
             * 而且界面上完全看不出异常。重新挂载顺带把已显示的明文、标题草稿、
             * 行内编辑态一起清干净，比逐个 useEffect 复位更不容易漏。
             */
            key={creatingScene !== null ? 'new:' + creatingScene.id : 'rec:' + (openRecord?.id ?? '')}
            record={creatingScene !== null ? null : openRecord}
            scene={openScene}
            config={config}
            onError={(message) => { setActionError(message) }}
            onRecord={onRecord}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onClose={() => { setOpenId(null); setCreatingScene(null) }}
          />
        </>
      )}
    </>,
  )
}
