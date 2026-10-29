/**
 * 详情面板 —— 点开一条记录（或新建一条）后的全部编辑能力。
 *
 * ── 为什么组件本身不带外壳 ──────────────────────────────────────────
 * 同一条记录要以两种形态出现：查看 / 编辑已有记录是**列表里原地展开**（不遮
 * 页面、不滑出侧栏），新建记录是**居中弹窗**（那时列表里还没有对应那一行可
 * 展开）。两者内容一字不差，所以外壳留给调用方（Panel），这里只出内容 + 头部
 * + 页脚三件套；外壳通过 shell 属性决定。这样「再要第三种形态」时只改外壳。
 *
 * ── 保留 Drawer 这个名字的原因 ──────────────────────────────────────
 * 组件与导出名继续叫 VaultDetailDrawer：改名会波及 index.ts 的导出面与下游
 * 引用，而这个文件解决的仍然是「一条记录的详情」，语义没有变——变的只是它被
 * 谁套了一层什么壳。
 *
 * ── 分工：为什么字段「就地改」，标题「整体保存」────────────────────
 * 这两条路走的是不同的 HTTP 路由，取舍很明确：
 *
 *   · 字段值 → POST /field（就地改单个字段）。宿主侧 store.patchField 的注释
 *     写死了理由：模型报「密码变了」时只该改那一个字段，其余字段必须原样保留。
 *     人在这张抽屉里改字段是同一类动作——用户只碰了他点开的那一行输入框，
 *     提交时就该只影响那一行。即使模型刚在别处改了别的字段，也不会被这次保存
 *     覆盖掉。所以字段编辑**失焦即提交**，不排队等「保存」。
 *   · 标题 / 备注 → POST /record（整体替换）。契约里没有「只改标题」的路由，
 *     整体提交是唯一途径；这一层风险靠「提交时用刚从服务端拿回来的那份
 *     record.fields」压到最小（每次 /field 回来都用返回值替换本地 record）。
 *
 * ── 敏感值：默认圆点，点眼睛才请求，30 秒自动回隐 ───────────────────
 * /list 下发的敏感值一律是掩码 VAULT_MASK（宿主 store.toPlainRecord 换过），
 * **明文只有一个来源**：POST /reveal —— 单字段、按次、宿主写审计。这条纪律
 * 不是风格问题：把掩码当真值渲染，用户看到的「密码」是六个星号；把掩码当真值
 * 提交回去，一次保存就把真密码写成星号（不可逆）。所以：
 *   · 眼睛取不到明文（空串 / 报错）→ 保持圆点 + 一句提示，绝不退回本地值；
 *   · 敏感字段的编辑框**不回填**，留空＝不改（宿主 isMaskedValue 那边认这个）；
 *   · 圆点用 SECRET_DOTS（页面上「已隐藏」的视觉符号），掩码是线上协议占位，
 *     两者不能混用——把 VAULT_MASK 显示出来等于告诉用户密码是 ********。
 * 30 秒回隐是因为「看一眼」之后大多数人会把窗口晾在那儿——明文长期停在
 * 屏幕上，比它的加密落盘还有意义损失。定时器在卸载 / 切换记录时清掉。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  archiveVaultRecord,
  deleteVaultRecord,
  describeEntropy,
  formatVaultStamp,
  formatVaultTime,
  generateVaultPassword,
  isPasswordSecretField,
  isTotpField,
  patchVaultField,
  revealVaultField,
  saveVaultRecord,
  SECRET_DOTS,
} from './api.js'
import type { VaultConfig, VaultField, VaultRecord, VaultScene } from '../../../triad/vault/types.js'
import { collectCategories, isFieldSensitive, isMaskedValue } from '../../../triad/vault/types.js'
import { css } from './styles.js'
import { VaultPhotoGrid } from './PhotoGrid.js'
import { VaultFileList } from './FileList.js'
import { VaultTotpBox } from './TotpBox.js'
import {
  AlertIcon,
  ArchiveIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  TrashIcon,
} from './icons.js'

/** 明文显示多久后自动回隐（毫秒）。 */
const REVEAL_MS = 30_000

/** 变更动作的中文名。 */
const ACTION_LABEL: Record<string, string> = {
  create: '新建',
  'field-add': '加字段',
  'field-update': '改字段',
  'field-remove': '删字段',
  'photo-add': '加照片',
  'photo-remove': '删照片',
  'file-add': '加文件',
  'file-remove': '删文件',
  'scene-move': '换分组',
  'title-update': '改标题',
  archive: '归档',
  restore: '恢复',
}

/**
 * 新建记录时用的骨架。
 *
 * 用场景的 fieldTemplate 预填，而不是给一张空表：切到「账号密码」场景点
 * 「加一条」，用户看到的是用户名 / 密码 / 绑定邮箱 / 站点四行空位——这比
 * 让用户先想「我该加哪些字段」快得多，也保证同场景的记录字段 key 一致
 * （key 一致是自动更新能命中同一行的前提）。
 */
function draftFromScene(scene: VaultScene): VaultRecord {
  const now = new Date().toISOString()
  return {
    id: '',
    scene: scene.id,
    title: '',
    subtitle: '',
    category: '',
    fields: scene.fieldTemplate.map((template) => ({
      key: template.key,
      label: template.label,
      type: template.type,
      ...(template.sensitive === true ? { sensitive: true as const } : {}),
      value: '',
      updatedAt: now,
    })),
    photos: [],
    files: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    confidence: 1,
    version: 0,
    changes: [],
  }
}

/** 面板形态：新建成弹窗，查看 / 编辑已有记录在列表里原地展开。 */
export type VaultDetailShell = 'modal' | 'expand'

/** 详情面板属性。 */
export interface VaultDetailDrawerProps {
  /** 要编辑的记录；null = 新建（此时 scene 必填，用来取模板）。 */
  record: VaultRecord | null
  /** 新建时用哪个场景（record 非空时忽略）。 */
  scene: VaultScene | null
  /** 宿主配置（压缩参数从它来，页面不另定一套数值）。 */
  config: Partial<VaultConfig>
  /** 错误上报（父级统一渲染一行中文错误 + 重试）。 */
  onError: (message: string) => void
  /** 记录被更新（改字段 / 照片增删 / 归档）。只更新数据，不触发「已保存」提示。 */
  onRecord: (record: VaultRecord) => void
  /**
   * 保存 / 创建成功（与 onRecord 分开是为了让父级只在这一个动作上弹提示：
   * 改标题时每次按键都会走 onRecord，若合并成一个回调，用户会看到提示一直闪）。
   */
  onSaved?: (record: VaultRecord) => void
  /** 记录被删除（父级从列表里摘掉并关抽屉）。 */
  onDeleted: (id: string) => void
  /** 关闭面板（弹窗＝关掉；原地展开＝收起这一块）。 */
  onClose: () => void
  /**
   * 外壳形态。
   *
   * 由调用方给而不是自己判断「有没有 id」：健康检查里点某条问题跳到详情时，
   * 那条记录是有 id 的，但它出现在列表里，一样该原地展开。形态取决于「它长在
   * 页面里还是浮在页面之上」，那是调用方的知识。
   */
  shell?: VaultDetailShell
  /**
   * 同一分组里的其它记录（可选）。
   *
   * 只用来收集「这个分组里已经在用的分类」——用户手输过一次「家庭NAS」，下次
   * 新建同组记录时它就该出现在候选里，而不是要再手输一遍。缺省空数组时退化成
   * 只有场景的建议清单，功能不受影响。
   */
  siblings?: VaultRecord[]
}

export function VaultDetailDrawer({
  record, scene, config, onError, onRecord, onSaved, onDeleted, onClose, shell = 'modal', siblings,
}: VaultDetailDrawerProps): JSX.Element {
  // 新建态用一个本地草稿；编辑态直接用父级那份 record（它是唯一真相，
  // 任何一次 /field 回来后父级会替换它，于是这里自动跟上）。
  const [draft, setDraft] = useState<VaultRecord | null>(() =>
    record === null && scene !== null ? draftFromScene(scene) : null)
  const current = record ?? draft

  /**
   * 分类候选（场景建议清单 + 这个分组里已有记录用过的分类）。
   *
   * 只给「点一下就填」的便利，不限制输入：分类是用户自己的语汇，任何下拉都会
   * 遇到「我要的那个不在里面」的情况，所以输入框永远可自由填。
   */
  const categoryOptions = useMemo(() => {
    if (scene === null) return []
    return collectCategories(siblings ?? [], scene)
  }, [scene, siblings])


  /** 已显示明文的字段 key（30 秒后自动移出）。 */
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  /** 正在向宿主取明文的字段 key（请求期间禁用那一枚眼睛，避免连点写一串审计）。 */
  const [revealing, setRevealing] = useState<string>('')
  /** 正在生成强口令的字段 key（防连点）。 */
  const [generating, setGenerating] = useState<string>('')
  /**
   * 刚生成的熵值提示（字段 key → 一句话）。
   *
   * 为什么挂在状态里而不是写进输入框：熵值是给人看的**判断依据**，不是字段值。
   * 拼进值里会真的把它变成密码的一部分，用户复制走就登录不上了。
   */
  const [genHint, setGenHint] = useState<Record<string, string>>({})
  /**
   * 刚生成、还没落进输入框的口令（字段 key → 明文）。
   *
   * 只在「本来不在编辑态」时需要：那一行的输入框还没挂载，写不进 ref，只能先
   * 值交给 state，等 setEditing 触发挂载时由 defaultValue 带进去。编辑态里
   * 直接写 DOM，不经过这里。提交 / 取消 / 换记录时一律清空。
   */
  const [genDraft, setGenDraft] = useState<Record<string, string>>({})
  /** 明文的到期定时器（卸载 / 关闭时统一清）。 */
  const revealTimers = useRef<Record<string, number>>({})
  /** 正在编辑的字段 key。 */
  const [editing, setEditing] = useState<string>('')
  /** 正在提交（禁用保存按钮，避免连点写出两条记录）。 */
  const [busy, setBusy] = useState<string>('')
  /** 删除二次确认。 */
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** 新增字段表单（null = 没开）。 */
  const [newField, setNewField] = useState<{ label: string; type: VaultField['type']; sensitive: boolean } | null>(null)
  /**
   * 标题草稿（null = 没改过，用记录里的那个）。
   *
   * 标题不走 /field（契约里没有「只改标题」的路由），只能跟「保存」一起整体提交。
   * 所以它必须是本地草稿：直接写到父级那份 record 上的话，用户敲了字又关掉抽屉，
   * 列表里会显示一个**没落盘**的新标题——下次刷新又变回去，最难查的那种不一致。
   */
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  /**
   * 分类草稿（null = 没改过）。
   *
   * 与标题同款理由：分类不在 fields 里，没有「只改分类」的路由，只能跟「保存」
   * 一起整体提交。用 null 而不是空串表示「没改过」，是因为空串本身是一个合法
   * 状态（＝取消分类），两者不能共用同一个哨兵值。
   */
  const [categoryDraft, setCategoryDraft] = useState<string | null>(null)
  /** 分类有没有未保存的改动（提示文案与关闭确认共用同一个判据）。 */
  const categoryDirty = categoryDraft !== null && categoryDraft !== (current?.category ?? '')
  /** 抽屉内部的局部错误（保存 / 上传 / 删除失败）；不用整页错误态。 */
  const [actionError, setActionError] = useState<string>('')

  const recordId = current?.id ?? ''
  const isNew = record === null
  /**
   * 这条记录是否已经落过盘（有 id）。
   *
   * 与 isNew 不是一回事：新建保存成功后父级会传回真记录，那时 isNew 变 false，
   * 但草稿里剩下的字段仍需按草稿逻辑处理。这里要回答的只是「值是否已经过宿主
   * ——过了就是掩码，没过就是用户自己敲的明文」。
   */
  const isPersisted = record !== null && record.id !== ''

  /** 清掉某个字段的明文（定时器 + 状态一起收）。 */
  const hideSecret = useCallback((key: string): void => {
    const timer = revealTimers.current[key]
    if (timer !== undefined) {
      window.clearTimeout(timer)
      delete revealTimers.current[key]
    }
    setRevealed((previous) => {
      if (previous[key] === undefined) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }, [])

  // 记录换了（切到另一条 / 新建落成真实记录）：明文全部回隐、编辑态复位。
  // 不复位的话，切到下一条记录时上一条的密码会挂在新记录上——那是最糟的
  // 一类「串台」，因为光看界面根本发现不了。
  useEffect(() => {
    for (const key of Object.keys(revealTimers.current)) {
      window.clearTimeout(revealTimers.current[key])
    }
    revealTimers.current = {}
    setRevealed({})
    setRevealing('')
    setGenerating('')
    setGenHint({})
    setGenDraft({})
    setEditing('')
    setConfirmDelete(false)
    setNewField(null)
    setTitleDraft(null)
    setActionError('')
  }, [recordId])

  // 卸载时收掉所有定时器：不清理的话抽屉关了 30 秒后还会对已卸载组件 setState。
  useEffect(() => () => {
    for (const key of Object.keys(revealTimers.current)) {
      window.clearTimeout(revealTimers.current[key])
    }
    revealTimers.current = {}
  }, [])

  /**
   * 抽屉内部的错误上报。
   *
   * 抽屉是页面里的一个面板，不是独立页面：动作失败不该把整页切成错误态
   * （那会把用户已经看到的内容全盖掉），只在这里出一行红字；同时通知父级，
   * 让它的一过性提示条也能显示（用户可能没注意到抽屉里那行小字）。
   */
  const reportError = useCallback((message: string): void => {
    setActionError(message)
    onError(message)
  }, [onError])

  /** 把明文放进 DOM，并挂一个 30 秒后自动回隐的定时器。 */
  const showSecret = useCallback((key: string, plain: string): void => {
    const existing = revealTimers.current[key]
    if (existing !== undefined) window.clearTimeout(existing)
    setRevealed((previous) => ({ ...previous, [key]: plain }))
    revealTimers.current[key] = window.setTimeout(() => { hideSecret(key) }, REVEAL_MS)
  }, [hideSecret])

  /**
   * 眼睛：显示 / 隐藏。
   *
   * ⚠ 明文**只能**来自 /reveal。这里没有「取不到就退回本地值」这条退路：
   * /list 下发的敏感值本身是掩码 VAULT_MASK，退回去等于把六个星号当成密码
   * 显示给用户——比不显示糟糕得多（用户会真的以为密码变成了 ********，
   * 甚至复制走）。所以失败时保持圆点 + 一句可读提示。
   */
  const toggleSecret = async (field: VaultField): Promise<void> => {
    if (revealed[field.key] !== undefined) {
      hideSecret(field.key)
      return
    }
    if (current === null) return
    // 新建态还没有记录 id，宿主那边不存在这条记录，/reveal 无从取起。
    // 此时 field.value 是用户自己刚在草稿里敲进去的，本来就是明文，直接显示。
    // （草稿里还是空串时说一句，否则点眼睛什么都不会发生，像是坏了。）
    if (current.id === '') {
      if (field.value === '') {
        reportError('这个字段还没有值，先填一个再看')
        return
      }
      showSecret(field.key, field.value)
      return
    }
    setRevealing(field.key)
    try {
      const value = await revealVaultField(current.id, field.key)
      // 空串＝宿主没有这个字段 / 拒绝了；掩码＝契约错位（把 /list 的值原样回）。
      // 两种都当作「取不到」，绝不上屏。
      if (value === '' || isMaskedValue(value)) {
        reportError('无法获取明文，请重试')
        return
      }
      showSecret(field.key, value)
    } catch (error) {
      reportError('无法获取明文：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setRevealing('')
    }
  }

  /** 编辑态输入框的 ref（生成强口令时要直接往里写值）。 */
  const editRefs = useRef<Record<string, HTMLInputElement | null>>({})

  /**
   * 生成一个强口令并填进当前编辑框。
   *
   * ── 为什么只填进输入框、不直接保存 ──────────────────────────────────
   * 「点一下就把密码换掉」是不可撤销的破坏性动作（旧密码当场没了）。所以这里
   * 只把新口令放进编辑框，仍然要用户自己按回车 / 失焦才提交——他在这一瞬间
   * 还看得见值、还来得及反悔。
   *
   * ── 为什么用 DOM 写值而不是受控 state ───────────────────────────────
   * 编辑框原本是非受控的（defaultValue + 失焦提交），改成受控会牵动 commitField
   * 的取值方式与 IME 行为。生成按钮改的是一个「用户本来也要手敲」的值，直接
   * 写 DOM 与人工输入在这里是同一件事，改动面最小。
   */
  const generateSecret = async (field: VaultField): Promise<void> => {
    setGenerating(field.key)
    try {
      const generated = await generateVaultPassword()
      const input = editRefs.current[field.key]
      if (input !== null && input !== undefined) {
        input.value = generated.password
        // 立刻聚焦，让用户能直接回车提交（也让他看清填进去的是什么）。
        input.focus()
      } else {
        // 还没进编辑态（这一行现在显示的是圆点或明文只读态）：先切进去，值交给
        // genDraft 由新挂载的输入框用 defaultValue 带进去。这样「点生成」就是
        // 一步到位——不必先点眼睛（取明文会额外写一条审计）再点输入框。
        setGenDraft((previous) => ({ ...previous, [field.key]: generated.password }))
        setEditing(field.key)
      }
      const tone = describeEntropy(generated.entropyBits)
      setGenHint((previous) => ({
        ...previous,
        [field.key]: '已生成 ' + String(generated.length) + ' 位随机口令'
          + (generated.entropyBits > 0 ? '，约 ' + String(Math.round(generated.entropyBits)) + ' 位熵' : '')
          + (tone === '' ? '' : '（' + tone + '）')
          + '。按回车保存。',
      }))
    } catch (error) {
      reportError('生成密码失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setGenerating('')
    }
  }

  /**
   * 提交单个字段（失焦 / 回车）。值没变就不发请求。
   *
   * 敏感字段的判断不能照搬「值相同就跳过」：/list 给的是掩码，任何输入都
   * 跟它不相等，于是「点开又原样失焦」会变成一次真提交。这里按宿主的语义
   * 显式处理——空串和掩码都表示「我没改这个字段」，直接 return。
   * （宿主 patchField 认得掩码，但空串会被当成「用户清空了密码」写进去。）
   */
  const commitField = async (field: VaultField, value: string): Promise<void> => {
    setEditing('')
    // 值已经交出去了，草稿副本没用了。不清的话下次再进编辑态会把这条旧口令
    // 回填进输入框——用户以为是当前值，其实可能早被保存成别的。
    setGenDraft((previous) => {
      if (previous[field.key] === undefined) return previous
      const next = { ...previous }
      delete next[field.key]
      return next
    })
    // 熵值提示也只对「刚生成、还没保存」的那个瞬间有意义。留着它，下次再点开
    // 这个字段会看到一句描述上一版口令的话，与输入框里的内容并不对应。
    setGenHint((previous) => {
      if (previous[field.key] === undefined) return previous
      const next = { ...previous }
      delete next[field.key]
      return next
    })
    const sensitive = isFieldSensitive(field)
    if (sensitive && (value === '' || isMaskedValue(value))) return
    if (!sensitive && value === field.value) return
    if (current === null) return
    if (current.id === '') {
      // 新建态还没有记录 id：只改本地草稿，等「保存」一起提交。
      setDraft((previous) => previous === null ? previous : {
        ...previous,
        fields: previous.fields.map((item) => item.key === field.key ? { ...item, value } : item),
      })
      return
    }
    setBusy('field:' + field.key)
    try {
      const next = await patchVaultField({
        id: current.id,
        key: field.key,
        value,
        label: field.label,
        type: field.type,
      })
      onRecord(next)
    } catch (error) {
      reportError('字段保存失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy('')
    }
  }

  /**
   * 改用途分类（本地草稿，等「保存」一起提交）。
   *
   * 为什么不走 /field 就地提交：分类不是字段（不在 fields 数组里），契约里没有
   * 「只改分类」的路由，只能跟标题一样整体提交。好处是行为可预期——用户在输入框
   * 里敲字的时候不会每敲一下就写一次盘。
   */
  const onChangeCategory = (category: string): void => {
    if (current === null) return
    if (isNew) {
      // 新建态：记录本身就是本地草稿，直接改它。
      setDraft((previous) => (previous === null ? previous : { ...previous, category }))
      return
    }
    // 已落盘记录：与标题同款草稿，等「保存」一起整体提交。
    setCategoryDraft(category)
  }

  /** 改标题（本地草稿，等「保存」一起提交）。 */
  const setTitle = (title: string): void => {
    setTitleDraft(title)
  }

  /** 保存：新建走 /record 创建，编辑态走 /record 整体提交（携带最新字段）。 */
  const onSave = async (): Promise<void> => {
    if (current === null) return
    const title = (titleDraft ?? current.title).trim()
    if (title === '') {
      reportError('标题不能为空：给它起一个能认出来的名字（例如「GitHub · Kr-ATG」）')
      return
    }
    setBusy('save')
    try {
      const saved = await saveVaultRecord({
        ...(current.id === '' ? {} : { id: current.id }),
        scene: current.scene,
        title,
        subtitle: current.subtitle,
        // 显式传（含空串）：空串＝取消分类，省略＝保留原值，这里要的是前者。
        category: categoryDraft ?? current.category ?? '',
        // 只提交有值的字段：空字段落盘没有意义，还会让列表摘要出现一堆
        // 「绑定邮箱：」这种空标签。
        fields: current.fields.filter((field) => field.value !== ''),
        tags: current.tags,
        note: current.note,
      })
      setTitleDraft(null)
      setCategoryDraft(null)
      setActionError('')
      if (isNew) setDraft(null)
      if (onSaved !== undefined) onSaved(saved)
      else onRecord(saved)
    } catch (error) {
      reportError('保存失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy('')
    }
  }

  /** 归档 / 恢复。 */
  const onArchive = async (): Promise<void> => {
    if (current === null || current.id === '') {
      reportError('这条记录还没保存，先保存再归档')
      return
    }
    setBusy('archive')
    try {
      const next = await archiveVaultRecord(current.id, current.archived !== true)
      onRecord(next)
    } catch (error) {
      reportError('归档失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy('')
    }
  }

  /** 删除（二次确认）。 */
  const onDelete = async (): Promise<void> => {
    if (current === null) return
    if (current.id === '') {
      // 还没落盘的草稿：直接关掉就是「不要了」。
      onClose()
      return
    }
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy('delete')
    try {
      await deleteVaultRecord(current.id)
      onDeleted(current.id)
    } catch (error) {
      reportError('删除失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy('')
    }
  }

  /** 新增字段：key 自动生成（人只填显示名），提交走 /field。 */
  const onAddField = async (): Promise<void> => {
    if (current === null || newField === null) return
    const label = newField.label.trim()
    if (label === '') {
      reportError('字段名不能为空')
      return
    }
    const taken = new Set(current.fields.map((field) => field.key))
    let index = current.fields.length + 1
    let key = 'custom_' + String(index)
    while (taken.has(key)) {
      index += 1
      key = 'custom_' + String(index)
    }
    const field: VaultField = {
      key,
      label,
      type: newField.type,
      ...(newField.sensitive ? { sensitive: true as const } : {}),
      value: '',
      updatedAt: new Date().toISOString(),
    }
    setNewField(null)
    if (current.id === '') {
      setDraft((previous) => previous === null ? previous : { ...previous, fields: [...previous.fields, field] })
      return
    }
    setBusy('add-field')
    try {
      const next = await patchVaultField({ id: current.id, key, value: '', label, type: newField.type, sensitive: newField.sensitive })
      onRecord(next)
    } catch (error) {
      reportError('新增字段失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy('')
    }
  }

  /** 变更历史（新的在上）。 */
  const changes = useMemo(() => {
    const list = current?.changes ?? []
    return [...list].reverse()
  }, [current])

  if (current === null) {
    // 既没有 record 也没有 scene：父级在构造参数时出错了，给一行可读提示
    // 而不是渲染一个空白面板。
    return (
      <div className={css.panelHead}>
        <div className={css.errorText} style={{ flex: 1 }}>没有可显示的记录</div>
        <button type="button" className={css.panelClose} aria-label="关闭" onClick={onClose}>
          <CloseIcon size={15} />
        </button>
      </div>
    )
  }

  const scenePhotoFirst = scene?.photoFirst === true

  /**
   * 关闭面板。
   *
   * 标题是草稿态（只在「保存」时落盘），所以关掉之前要问一句——否则用户改了
   * 标题、点右上角关闭，界面看起来「改过了」（输入框里确实是新标题），刷新后
   * 又变回去，而他从头到尾没收到任何提示。只在草稿与当前值不同时才问。
   */
  const requestClose = (): void => {
    const pendingTitle = titleDraft !== null && titleDraft !== current?.title
    const pendingCategory = categoryDirty
    if ((pendingTitle || pendingCategory) && !window.confirm('还有改动没保存，要放弃吗？')) return
    onClose()
  }

  return (
    <>
      {/* ── 头部：标题可直接改（新建时就是空输入框）── */}
      {/* data-shell 是给冒烟与调试用的：内容一样、壳不同，出问题时第一个要确认
          的就是「现在这个形态是弹窗还是原地展开」。 */}
      <div className={css.panelHead} data-shell={shell}>
        {/* 顶部一行元信息：新建 / 编辑的身份 + 所属场景。这里只负责分组，
            金色小字与场景 chip 的视觉由 styles.ts 的 panelEyebrow 承担。 */}
        <div className={css.panelEyebrow} data-role="eyebrow">
          <span>{isNew ? '新建记录' : '记录详情'}</span>
          {scene !== null && scene.label !== '' && (
            <span className={css.rowCategory} data-role="scene-chip">{scene.label}</span>
          )}
        </div>
        <input
          className={css.panelTitleInput}
          value={titleDraft ?? current.title}
          placeholder="给这条记录起个名字，例如「GitHub · Kr-ATG」"
          aria-label="记录标题"
          onChange={(event) => { setTitle(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void onSave()
            }
          }}
        />
        <button
          type="button"
          className={css.panelClose}
          aria-label={shell === 'modal' ? '关闭详情' : '收起详情'}
          // 两种壳里这枚按钮的语义不同：弹窗是「关掉」，原地展开是「收回去」，
          // 按钮上的提示得跟着说实话。
          title={shell === 'modal' ? '关闭（Esc）' : '收起这条记录（Esc）'}
          onClick={requestClose}
        >
          <CloseIcon size={shell === 'modal' ? 15 : 14} />
        </button>
      </div>

      <div className={css.panelBody}>
        {/* 局部错误：只盖掉这一行，不把整页切成错误态（用户可能正在填别的字段） */}
        {actionError !== '' && (
          <div className={css.error}>
            <span style={{ display: 'inline-flex', flex: 'none' }}><AlertIcon size={15} /></span>
            <div className={css.errorText}>{actionError}</div>
            <button type="button" className={css.errorRetry} onClick={() => { setActionError('') }}>
              知道了
            </button>
          </div>
        )}

        {/* ── 用途分类（2026-10-27 用户要求：区分什么用途一目了然）──
            为什么放在字段之前：它是这条记录的「一句话身份」，用户打开详情第一件事
            就是确认「我找的是不是这一条」。分类和标题一起构成这个判断，而字段是
            内容。 */}
        <div className={css.section} data-section="category">
          <div className={css.sectionHead}>
            <span className={css.sectionTitle}>用途分类</span>
            <span className={css.fieldKeyHint}>
              {current.category === undefined || current.category === ''
                ? '未分类（点下面的候选或自己填一个）'
                : categoryDirty
                  ? '改过了，点下面「保存」生效'
                  : '已保存'}
            </span>
          </div>
          <div className={css.categoryRow}>
            <span className={css.categoryLabel}>分类</span>
            <input
              className={css.categoryInput}
              value={categoryDraft ?? current.category ?? ''}
              placeholder="例如：服务器运维 / AI 服务 / 开发工具"
              aria-label="用途分类"
              onChange={(event) => { void onChangeCategory(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void onSave()
                }
              }}
            />
          </div>
          {categoryOptions.length > 0 && (
            <div className={css.categoryChips}>
              {categoryOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={css.categoryChip}
                  data-on={(categoryDraft ?? current.category ?? '') === option ? '1' : '0'}
                  title={(categoryDraft ?? current.category ?? '') === option ? '再点一次取消分类' : '设为「' + option + '」'}
                  onClick={() => {
                    onChangeCategory((categoryDraft ?? current.category ?? '') === option ? '' : option)
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 字段列表 ── */}
        <div className={css.section} data-section="fields">
          <div className={css.sectionHead}>
            <span className={css.sectionTitle}>字段</span>
            <button
              type="button"
              className={css.sectionAdd}
              title="补一个字段"
              onClick={() => { setNewField({ label: '', type: 'text', sensitive: false }) }}
            >
              <PlusIcon size={11} /> 加字段
            </button>
          </div>

          {current.fields.length === 0 && newField === null && (
            <div className={css.empty}>
              <span className={css.emptyText}>
                还没有字段。
                <span className={css.emptyHint}>在对话里说一句「我的 GitHub 密码是 xxx」，它会自己补上；也可以点右上角「加字段」手动填。</span>
              </span>
            </div>
          )}

          {/* 全部字段卡统一进两列网格（fieldGrid）；空态留在网格外，才能跨整行。 */}
          <div className={css.fieldGrid}>
          {current.fields.map((field) => {
            const sensitive = isFieldSensitive(field)
            const shown = revealed[field.key]
            const editingThis = editing === field.key
            const busyThis = busy === 'field:' + field.key
            return (
              <div key={field.key} className={css.field}>
                <div className={css.fieldLabel}>
                  <span>{field.label}</span>
                  {sensitive && <span className={css.fieldKeyHint}>已加密</span>}
                </div>
                <div className={css.fieldValueRow}>
                  {editingThis ? (
                    <>
                      <input
                        className={css.fieldInput}
                        autoFocus
                        ref={(node) => { editRefs.current[field.key] = node }}
                        // 已落盘的敏感字段**不回填**：/list 给的是掩码 VAULT_MASK，
                        // 回填出来就是六个星号；即使用已 reveal 的明文回填也不妥——
                        // 那等于把明文再摆回输入框（可能被浏览器记住 / 自动补全）。
                        // 空串 = 不改。新建态例外：那时值是用户自己刚敲的草稿明文，
                        // 回填才符合直觉（不回填会让人以为刚才白打了）。
                        defaultValue={
                          genDraft[field.key] !== undefined
                            ? genDraft[field.key]
                            : (sensitive && isPersisted ? '' : field.value)
                        }
                        placeholder={sensitive && isPersisted ? '留空表示不修改' : undefined}
                        type={field.type === 'secret' ? 'password' : 'text'}
                        aria-label={field.label}
                        onBlur={(event) => { void commitField(field, event.target.value) }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void commitField(field, event.currentTarget.value)
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setEditing('')
                          }
                        }}
                      />
                    </>
                  ) : sensitive && shown === undefined ? (
                    <span className={css.fieldSecret} aria-label="已隐藏的敏感值">{SECRET_DOTS}</span>
                  ) : (
                    <button
                      type="button"
                      className={css.fieldValue + (sensitive ? ' ' + css.fieldValueMono : '')}
                      title="点击修改"
                      disabled={busyThis}
                      onClick={() => { setEditing(field.key) }}
                    >
                      {/* 兜底：若 value 竟是掩码（前端判非敏感、宿主判敏感，或旧
                          host 混了形状），显示圆点而不是六个星号——星号上屏会被
                          当成真实密码。 */}
                      {shown !== undefined
                        ? shown
                        : (field.value === '' ? '（空）' : (isMaskedValue(field.value) ? SECRET_DOTS : field.value))}
                    </button>
                  )}
                  {sensitive && !editingThis && (
                    <button
                      type="button"
                      className={css.fieldEye + (shown !== undefined ? ' ' + css.fieldEyeOn : '')}
                      aria-label={shown !== undefined ? '隐藏' + field.label : '显示' + field.label}
                      title={shown !== undefined ? '隐藏（30 秒后自动隐藏）' : '显示明文 30 秒'}
                      // 取明文是一次带审计的真实请求：请求期间禁用，避免连点写一串日志。
                      disabled={revealing === field.key}
                      onClick={() => { void toggleSecret(field) }}
                    >
                      {shown !== undefined ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                    </button>
                  )}
                  {/* 生成强口令：只对「登录口令」字段出现（password / pwd / 密码 之类）。
                      它同时做两件事——把这一行切进明文编辑态、填入新口令——所以未编辑
                      时点它就能一步到位，不必先点眼睛（点眼睛会额外写一条审计）。
                      排掉 totp 种子字段：把 base32 密钥换成随机串等于废掉两步验证。 */}
                  {isPasswordSecretField(field) && (
                    <button
                      type="button"
                      className={css.genBtn}
                      title="生成一个随机强口令填进这个字段（还要按回车 / 点保存才写入本机）"
                      disabled={generating === field.key}
                      onClick={() => { void generateSecret(field) }}
                    >
                      {generating === field.key ? '生成中…' : '生成'}
                    </button>
                  )}
                  {genHint[field.key] !== undefined && (
                    <span className={css.genHint}>{genHint[field.key]}</span>
                  )}
                  {/* TOTP 密钥字段多一枚「生成验证码」。它与眼睛是两条独立的路：
                      眼睛出明文（写审计），这里出 30 秒到期的一次性码（宿主内部
                      解码，页面拿不到密钥）。两者都不能替代对方。 */}
                  {sensitive && isTotpField(field) && (
                    <VaultTotpBox recordId={recordId} fieldKey={field.key} onError={reportError} />
                  )}
                </div>
              </div>
            )
          })}

          {newField !== null && (
            <div className={css.field}>
              <div className={css.fieldLabel}>
                <span>新字段</span>
              </div>
              <div className={css.fieldValueRow}>
                <input
                  className={css.fieldInput}
                  autoFocus
                  value={newField.label}
                  placeholder="字段名，例如「登录问题」"
                  aria-label="新字段名"
                  onChange={(event) => { setNewField({ ...newField, label: event.target.value }) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void onAddField()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setNewField(null)
                    }
                  }}
                />
                <label className={css.fieldKeyHint} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={newField.sensitive}
                    onChange={(event) => { setNewField({ ...newField, sensitive: event.target.checked }) }}
                  />
                  敏感
                </label>
                <button type="button" className={css.btn} onClick={() => { void onAddField() }}>添加</button>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* ── 照片 ── */}
        <div className={css.section} data-section="photos">
          <div className={css.sectionHead}>
            <span className={css.sectionTitle}>照片</span>
            <span className={css.fieldKeyHint}>
              {scenePhotoFirst ? '证件类：建议正反面各一张' : '缩略图点开看大图'}
            </span>
          </div>
          <VaultPhotoGrid
            record={current}
            photoFirst={scenePhotoFirst}
            config={config}
            onRecord={onRecord}
            onError={onError}
          />
        </div>

        {/* ── 文件附件 ──
            与照片分开的一节：配置文件 / 订阅 / 证书是原样字节，不压图、不生成
            缩略图，下载时按原文件名还原。 */}
        <div className={css.section} data-section="files">
          <div className={css.sectionHead}>
            <span className={css.sectionTitle}>文件</span>
            <span className={css.fieldKeyHint}>配置文件、订阅、证书等（原样保存，随云同步上传）</span>
          </div>
          <VaultFileList
            record={current}
            onRecord={onRecord}
            onError={onError}
          />
        </div>

        {/* ── 变更历史 ── */}
        <div className={css.section} data-section="changes">
          <div className={css.sectionHead}>
            <span className={css.sectionTitle}>变更历史</span>
            <span className={css.fieldKeyHint}>{changes.length === 0 ? '还没有变化' : String(changes.length) + ' 条'}</span>
          </div>
          {changes.length === 0 ? (
            <div className={css.fieldKeyHint}>
              这条记录第一次落盘之后，每次字段变化都会在这里留一行「旧 → 新」。
            </div>
          ) : (
            <div className={css.changeList}>
              {changes.map((change, index) => {
                const label = change.fieldKey === undefined
                  ? ''
                  : (current.fields.find((field) => field.key === change.fieldKey)?.label ?? change.fieldKey)
                return (
                  <div key={String(index) + change.at} className={css.changeRow}>
                    <div className={css.changeTime} title={formatVaultStamp(change.at)}>{formatVaultTime(change.at)}</div>
                    <div className={css.changeBody}>
                      <span className={css.changeAction}>{ACTION_LABEL[change.action] ?? change.action}</span>
                      {label !== '' && <span className={css.changeField}>{label}</span>}
                      <div className={css.changeDiff}>
                        {change.before !== undefined && change.before !== '' && (
                          <span className={css.changeOld}>{change.before}</span>
                        )}
                        <span className={css.changeNew}>
                          {change.after === undefined || change.after === ''
                            ? (change.before === undefined ? '' : '已清空')
                            : change.after}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 底部：保存 / 归档 / 删除（删除走二次确认）── */}
      <div className={css.panelFoot}>
        <button
          type="button"
          className={css.btn + ' ' + css.btnPri}
          disabled={busy !== ''}
          onClick={() => { void onSave() }}
        >
          {busy === 'save' ? '保存中…' : isNew ? '创建' : '保存'}
        </button>
        <button
          type="button"
          className={css.btn}
          disabled={busy !== '' || current.id === ''}
          title={current.archived === true ? '恢复到列表' : '从列表里收起来，数据保留'}
          onClick={() => { void onArchive() }}
        >
          <ArchiveIcon size={13} />
          {current.archived === true ? '恢复' : '归档'}
        </button>
        <button
          type="button"
          className={css.btn + ' ' + css.btnDanger}
          style={{ marginLeft: 'auto' }}
          disabled={busy !== ''}
          onBlur={() => { setConfirmDelete(false) }}
          onClick={() => { void onDelete() }}
        >
          <TrashIcon size={13} />
          {busy === 'delete' ? '删除中…' : confirmDelete ? '确认删除？' : '删除'}
        </button>
      </div>
    </>
  )
}