/**
 * dsh-vault 注入引擎：agent/pre-step 把「已保存的档案索引」注入为一条带来源的
 * user message。
 *
 * ── 为什么注入的是「索引」而不是「内容」──────────────────────────────
 * 档案里装的是密码、卡号、证件号。这些东西一旦进上下文，就等于发给了模型厂商，
 * 而且会永久留在会话历史里（连压缩摘要都可能带上）。所以注入文本只回答三个
 * 问题：**用户有哪些档案、每条有哪些字段、哪些字段是加密的**。值本身不出现。
 * 唯一例外是非敏感字段（用户名、站点、邮箱这类本来就到处可见的），它们对模型
 * 有实际帮助（知道用户的 GitHub 用户名就能少问一句）。
 *
 * ── 与记忆库注入的关系 ──────────────────────────────────────────────
 * 完全独立：不读记忆库的 store，不看 isInjectExcluded / isInjectEnabled，
 * 有自己的 autoInject 开关。装配时用 prepend: true 注册，因此跑在记忆库那两道
 * 闸门之前——记忆库被关掉不影响档案。
 *
 * ── 一次会话注入几次 ────────────────────────────────────────────────
 * 首步注入全量索引；此后只有在**档案真的变了**（某条记录的 updatedAt 变新）时
 * 才补一条「变更摘要」，只列变了的那几条。这样「刚记下的密码」立刻对模型可见，
 * 而没变化的会话不会每轮重复灌同一份清单。
 *
 * ── 绝不抛穿 ────────────────────────────────────────────────────────
 * 注入失败一律记日志后原样返回下游决策：档案没注入顶多让模型多问一句，
 * 而 pre-step 抛错会毁掉用户的整个回合。
 */

import { createUserMessage } from '../../vendor/dsh-llm/index.js'
import type { VaultConfig, VaultRecord, VaultScene } from './types.js'
import { fieldSummaryOf, hasSensitiveField, isFieldSensitive } from './types.js'
import { expiryNoteOf } from './reminders.js'
import type { VaultStore } from './store.js'

/** pre-step 载荷的最小 agent 面（与记忆库同款，不依赖 agent 的完整类型）。 */
export interface VaultPreStepAgent {
  readonly id: string
  readonly session: {
    readonly id: string
    readonly header?: { cwd?: string }
  }
}

/** 日志口（ctx.logger 里本模块用到的三个方法）。 */
export interface VaultLogger {
  debug?: (message: string) => void
  info?: (message: string) => void
  warn?: (message: string) => void
}

/** pre-step 的决策形状。 */
type PreStepDecision = { kind: 'enter'; messages: unknown[] } | { kind: 'reject' }

/** 换行符（避免在源码里出现转义序列，便于本文件的逐行生成与审阅）。 */
const LF = String.fromCharCode(10)

/**
 * 注入引导语。
 *
 * 六条纪律缺一不可，每一条都对应一种「模型自作聪明」的具体失败：
 *  1. 不说清「没有明文」→ 模型会照着字段名猜一个密码写进回答里；
 *  2. 不说清「非敏感字段可以直接用」→ 模型明明有用户名还去问用户；
 *  3. 不说清「没记录就是没记录」→ 拿记忆库的模糊句子冒充档案；
 *  4. 不说清「该自己写就自己写」→ 模型把用户刚给的新密码只写进回复正文就收工，
 *     指望回合结束的后台抽取去捡。抽取那边虽然能捡（它读的是原始对话），但**慢
 *     一拍**：这一轮里档案还是旧值，用户下一句「那你去登一下」就踩空；
 *  5. 不说清「参数里传一次、正文里别再写」→ 模型在 vault_remember 的参数里传一次
 *     密码、又在回复里复述「已记住 xxx」，凭空多一份明文副本。参数里那一次是入库
 *     的唯一通道（无法避免，见下方 SAFE 边界说明），正文里那次纯粹是白送的；
 *  6. 不说清「用户没给的值不要编」→ 模型拿索引里的旧值或示例值把字段填满，档案就
 *     此多一条看着很完整的错记录。
 *
 * ── 原来还有第 3 条「待确认可能有误」，为什么删掉了（2026-10-27 用户要求）──
 * 那条原文是：「标了「待确认」的记录来自自动抽取，可能有误。引用之前先跟用户
 * 确认一句。」它成立的唯一前提是记录上真的挂着一个「待确认」标记——而用户明确
 * 要求档案**不需要确认**，抽取结果直接生效，记录上再没有任何「未确认」状态。
 * 标记没了这句话就成了无源之谈（模型会去找一个不存在的标记，或者把正常记录也
 * 当可疑），所以整条删除、其余六条原样保留并重排编号。教训不在「确认」这个动作
 * 上，而在：**注入规则里每一句都必须指向一个真实存在的状态**，状态退役了，规则
 * 必须同批退役，否则模型会照着死规则做多余的动作。
 *
 * ── 第 4 条为什么反转了（2026-10-26 用户要求「我就是想主 agent 会话中自己写」）──
 * 这条原来是反向的：明说「正常对话即可，回合结束会自动抽取入库」，等于劝住
 * 模型别自己调 vault_remember。那是「后台抽取为主、工具为辅」的设计，代价是写入
 * 永远滞后一轮。改成主 agent 主动写之后，后台抽取退为兜底（模型漏调时仍能捡到），
 * 两条路写同一份 store：applyVaultOps 的「同场景同标题 → 退化为字段更新」与
 * patchField 的「值没变就不写」保证重复写不会产生脏数据。
 *
 * ── 必须承认的边界：模型自写 = 明文经过模型厂商一次 ──────────────────
 * 这不是实现缺陷，是「让模型自己写」这件事的固有代价，写在代码里免得以后有人
 * 以为可以绕开：官方 tool/call 事件保留模型产出的原始 arguments JSON 串
 * （dsh-session types 原文：the raw arguments JSON string exactly as the model
 * produced it），且 ToolCallBlock 属于 ContentBlockMap，会随 assistant message
 * 在后续每一轮重发给 provider。也就是说本轮传入的密码明文，与其他对话内容同级别
 * 地走了厂商、并留在会话历史里。后台抽取那条路反而更隐蔽（抽取是独立的一次调用，
 * 明文只经过那一次、不留在主会话历史）——但它同样要发给模型才能抽出字段来。
 * 两条路都做不到「模型不看见明文」，真正的零暴露只有用户自己在页面上手录。所以
 * 这里的取舍是**方便 > 极小概率的会话历史残留**，并在规则里把「别在正文复述」
 * 钉死，把多出来的那份副本消掉。
 */
export const VAULT_INJECTION_RULE = [
  '【档案 · 内置通道】以下是用户的**个人档案索引**（账号密码、支付方式、联系方式、证件），由本机插件维护并注入；与记忆库开关无关，始终生效。',
  '',
  '怎么用：',
  '  · 这里**只有字段名，没有密码 / 卡号 / 证件号的明文**——它们在本机加密保存，绝不发给模型（包括你）。需要明文时请让用户自己在侧栏「操作间 → 档案」页面查看，不要猜、不要编、不要用示例值凑。',
  '  · 档案记录还可以挂**文件附件**（Clash / mihomo 订阅、Xray 配置、证书、脚本等）；附件字节不会注入上下文，只保存文件名与大小，需要内容时让用户在档案详情页下载。',
  '  · 非敏感字段（用户名、站点、邮箱、电话、有效期）带值，可以直接引用，不必再问用户一遍。',
  '  · 用户提到「我那个 GitHub 账号」「我的身份证」时，先在这份索引里找对应记录；找到了就按记录里的字段回答。',
  '  · 索引里没有的账户就是没记过——直接说没有记录，不要拿记忆库里的模糊句子冒充档案。',
  '  · **该记就当场写**：用户这一轮说出新的账号 / 密码 / 证件信息，或明确说某个字段变了，就立刻调 `vault_remember` 写进去（同场景同标题会就地更新，不会建出重复记录）。别只把它留在回复正文里等回合结束的后台抽取——那要下一轮才生效，而用户很可能紧接着就让你去用它。',
  '  · 写进去的值**必须是用户刚给出的**。用户没说、你也推不出来的（「密码改了」但没给新的），先问一句，不要拿旧值或示例值把字段填满。',
  '  · `vault_remember` 的参数里传一次密码是必须的（那是它入库的唯一通道），但**不要在回复正文里复述**——那会把同一份明文再写一遍进会话历史。写完只报「已记到档案」。',
  '  · 拿不准的值宁可不写：档案里一条错密码，比缺一条记录害处大得多。',
  '  · 用户问「我的档案备份了吗 / 传上去了吗 / 云端在哪」时：档案已纳入工作台资产云同步，入口是侧栏「操作间 → 同步设置」（填 GitHub 私有仓库地址 + 同步口令 + 访问令牌，可只勾选「档案数据」）。同步是双向的：既能自动上传加密包，也能从云端恢复。**这是用户自己的仓库**，你无法代替他创建或授权；需要时把入口告诉他，不要凭空猜仓库名，也不要去读他的令牌。',
].join(LF)

/**
 * 排序权重：越可能「马上就要用」的排越前。
 *
 * 证件类（有 date 字段）排最前，因为它们会过期，而「还剩几天」是唯一会让用户
 * 立刻行动的字段；其次是带加密字段的记录（账号密码、卡），这些是查得最勤的。
 * 同权重内按 updatedAt 倒序——刚变过的就是用户此刻在谈的。
 */
function priorityOf(record: VaultRecord): number {
  let score = 0
  if (record.fields.some((field) => field.type === 'date')) score += 100
  if (hasSensitiveField(record)) score += 10
  return score
}

/**
 * 一条记录的注入行（**不含任何敏感值**，全部走 fieldSummaryOf）。
 *
 * 行尾的「到期」提示是本模块最实用的一处主动信息：证件、银行卡有效期这类
 * 日期字段本身就是「什么时候要动手」的答案，而用户与模型都不会主动去算。
 * 只报「还剩 N 天 / 已过期」，不报具体日期——剩余天数是行动依据，日期是噪音。
 */
function formatRecordLine(record: VaultRecord, sceneLabel: string): string {
  // 分类紧跟场景标签：[账号密码 · 服务器运维] 阿里云 ECS · 101.133…
  // 放在方括号里而不是句尾：模型读这一行时「这是什么 / 干什么用」应该在同一处
  // 一次说完，句尾的分类容易被当成标题的一部分。
  const category = typeof record.category === 'string' ? record.category.trim() : ''
  const label = category === '' ? sceneLabel : sceneLabel + ' · ' + category
  let line = '- [' + label + '] ' + record.title
  if (record.subtitle !== undefined && record.subtitle.trim() !== '') line += '（' + record.subtitle.trim() + '）'
  const summary = fieldSummaryOf(record, 200)
  if (summary !== '') line += '：' + summary
  const expiry = expiryNoteOf(record)
  if (expiry !== '') line += ' · ' + expiry
  if (record.photos.length > 0) line += ' · 照片 ' + String(record.photos.length) + ' 张（本机保存）'
  // 这里原有 ' ·（自动记录，待确认）' 的后缀，v2 退役待确认机制后记录上再也没有
  // 这个状态可标——自动抽取的结果就是普通记录，和其它记录长得一样。
  return line
}

/*
 * 到期提示与阈值都搬去了 reminders.ts（expiryNoteOf / EXPIRY_NOTE_DAYS）。
 * 提醒窗口和这里的注入行必须永远说同一句话，判据只能有一份：两处各算一遍，
 * 迟早会出现「窗口里没有、但模型被提示了」或者反过来。所以这里不再保留副本。
 */

/** 全库水位（最大 updatedAt；空库返回空串）。 */
function maxUpdatedAt(records: VaultRecord[]): string {
  let max = ''
  for (const record of records) {
    if (record.updatedAt > max) max = record.updatedAt
  }
  return max
}

/** 错误描述（日志用，绝不再抛）。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 泄漏自检：注入文本里是否出现了任何敏感字段的明文。
 *
 * 这不是给运行时用的（运行时不该有泄漏），而是给**冒烟测试与回归**用的：
 * 一旦有人图省事在注入文本里拼了 field.value，这条断言会立刻红。
 * 长度小于 4 的值不参与比对——那类值的假阳性高到无法使用。
 * @returns 命中的「记录标题/字段 key」列表；空数组 = 干净。
 */
export function findLeakedSecrets(text: string, records: VaultRecord[]): string[] {
  const hits: string[] = []
  for (const record of records) {
    for (const field of record.fields) {
      if (!isFieldSensitive(field)) continue
      const value = field.value.trim()
      if (value.length < 4) continue
      if (text.includes(value)) hits.push(record.title + '/' + field.key)
    }
  }
  return hits
}

/**
 * 档案注入器。
 *
 * 只持有 store 与 config 的引用（config 是可变的运行时对象，页面改开关后
 * 立即生效，不需要重建注入器）。会话级状态只有两个：是否已注入过全量索引、
 * 上次注入时的水位。两者在 agent/disposed 与压缩事件时清空。
 */
export class VaultInjector {
  /** 已注入过全量索引的会话。 */
  private readonly injected = new Set<string>()
  /** 每会话上次注入时的档案水位（用于判断要不要补变更摘要）。 */
  private readonly watermarks = new Map<string, string>()

  constructor(
    private readonly store: VaultStore,
    private readonly config: VaultConfig,
    private readonly logger?: VaultLogger,
  ) {}

  /** 清空会话级状态（agent/disposed、压缩后重新注入都走这里，幂等）。 */
  disposeSession(sessionId: string): void {
    this.injected.delete(sessionId)
    this.watermarks.delete(sessionId)
  }

  /** 全量索引文本（供页面预览与冒烟断言直接调用）。 */
  buildInjectionText(records: VaultRecord[], scenes: VaultScene[]): string {
    return this.buildText(records, scenes, true)
  }

  /** 变更摘要文本（只列 sinceIso 之后变过的记录）。 */
  buildDeltaText(records: VaultRecord[], scenes: VaultScene[], sinceIso: string): string {
    if (sinceIso === '') return ''
    const changed = records.filter((record) => record.updatedAt > sinceIso)
    if (changed.length === 0) return ''
    return this.buildText(changed, scenes, false)
  }

  /** 组装文本：排序 → 截条数 → 按字符预算逐行塞。 */
  private buildText(records: VaultRecord[], scenes: VaultScene[], full: boolean): string {
    const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))
    const active = records.filter((record) => record.archived !== true)
    if (active.length === 0) return ''
    const ordered = [...active].sort((a, b) => {
      const byPriority = priorityOf(b) - priorityOf(a)
      if (byPriority !== 0) return byPriority
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    const cap = Math.max(1, this.config.injectMaxRecords)
    const limited = ordered.slice(0, cap)
    const header = full
      ? '已保存的档案（共 ' + String(active.length) + ' 条；以下为索引，敏感值已加密不在其中）：'
      : '档案有更新（自上次注入后 ' + String(limited.length) + ' 条发生变化）：'
    const budget = Math.max(200, this.config.injectBudget)
    const body: string[] = []
    let used = header.length
    let shown = 0
    for (const record of limited) {
      const sceneLabel = sceneById.get(record.scene)?.label ?? record.scene
      const line = formatRecordLine(record, sceneLabel)
      if (used + line.length + 1 > budget) break
      body.push(line)
      used += line.length + 1
      shown += 1
    }
    if (shown === 0) return ''
    const rest = active.length - shown
    const tail = rest > 0
      ? '（另有 ' + String(rest) + ' 条未列出，可在「操作间 → 档案」页面查看）'
      : ''
    return [header, ...body, ...(tail === '' ? [] : [tail])].join(LF)
  }

  /** pre-step 监听器（装配时用 prepend: true 注册，跑在记忆库两道闸门之前）。 */
  async preStepListener(
    payload: { agent: VaultPreStepAgent; messages: unknown[]; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> {
    let decision: PreStepDecision
    try {
      decision = await next()
    } catch (error) {
      this.logger?.warn?.('[dsh-vault] pre-step next() failed: ' + describeError(error))
      return { kind: 'reject' }
    }
    if (decision.kind !== 'enter' || payload.signal.aborted) return decision
    if (this.config.autoInject !== true) return decision
    const sessionId = payload.agent.session.id
    try {
      const records = await this.store.listRecords()
      if (records.length === 0) {
        this.injected.add(sessionId)
        return decision
      }
      const scenes = await this.store.listScenes()
      const text = this.injected.has(sessionId)
        ? this.buildDeltaText(records, scenes, this.watermarks.get(sessionId) ?? '')
        : this.buildInjectionText(records, scenes)
      this.injected.add(sessionId)
      this.watermarks.set(sessionId, maxUpdatedAt(records))
      if (text === '') return decision
      const message = createUserMessage({
        content: [{ type: 'text', text: VAULT_INJECTION_RULE + LF + LF + text }],
        source: {
          kind: 'plugin:dsh-vault',
          plugin: 'dsh-vault',
          form: 'snapshot',
          sections: [{ name: '个人档案索引', text }],
        },
      })
      this.logger?.debug?.('[dsh-vault] injection ok (' + String(text.length) + ' chars)')
      return { kind: 'enter', messages: [...decision.messages, message] }
    } catch (error) {
      this.logger?.warn?.('[dsh-vault] injection failed: ' + describeError(error))
      return decision
    }
  }
}