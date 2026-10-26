/**
 * 健康抽屉 —— 密码健康审计的报告页（分数 + 按严重度分组的问题清单）。
 *
 * ── 为什么单独一个抽屉而不是塞进主页面 ────────────────────────────────
 * 审计结论是**一次性的巡检报告**，不是常驻信息：用户看完、去改几条密码，
 * 这份报告就过期了。把它做主页面上的一块，等于让一份会过期的数据占据每天
 * 都在看的位置。做成抽屉＝「点开才查一次」，语义正好。
 *
 * ── 为什么分数是主角，清单是配角 ────────────────────────────────────
 * 这一页要回答的唯一问题是「我现在危不危险」。所以顶部先给一个 0-100 的数
 * 和一圈环形进度（一眼可读），下面才是「具体哪几条」。分组的顺序固定按
 * 严重度（高 → 中 → 低），不按数量：用户该先修最危险的那一条，而不是最多
 * 的那一类。
 *
 * ── 判定逻辑一律不在这一层 ──────────────────────────────────────────
 * 弱口令 / 重复 / 过期这些判定需要看全部记录的明文，那些数据在宿主侧。
 * 这里只做「把宿主给的 kind / severity 翻成中文、把同样的 kind 归到一组」。
 * 页面自己再判一遍必然与宿主漂移，而且浏览器里根本没有那份明文可比。
 *
 * ── 「一键修」：审计的价值在于修，不在于报 ──────────────────────────
 * 报告里最高频的两类（密码复用、密码太弱）有一个共同点：用户看到之后**接下来
 * 该做什么**是明确的（换一个新的强口令）。如果这里只报不改，用户得自己想三个
 * 密码、逐条打开、逐条手敲——绝大多数人到此就关掉页面了。所以这一类问题带上
 * 动作入口：
 *   · 复用组（同 groupId ≥2 条）→「全部换成随机强口令」批量轮换；
 *   · 弱口令单条 →「生成新密码」跳到那条记录（在那里点生成）。
 * ⚠ 轮换是**当场写库、旧密码不可恢复**的。所以两道闸门一步都不能省：确认块
 * 常显（不是一闪而过的 confirm）、且文案要求用户先确认自己能在对应站点改密。
 * 更关键的是：新密码明文只此一次返回，页面必须把它**列出来**，否则用户既没有
 * 旧密码也没有新密码，账号直接锁死。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { fetchVaultHealth, formatIssueDetail, formatVaultStamp, rotateVaultPasswords } from './api.js'
import type {
  VaultHealthReport,
  VaultIssue,
  VaultIssueKind,
  VaultIssueSeverity,
  VaultRotateResult,
} from './api.js'
import { css } from './styles.js'
import { AlertIcon, CloseIcon, CopyIcon, RefreshIcon, ShieldIcon } from './icons.js'

/** 严重度的中文名与展示顺序（数组顺序＝分组顺序）。 */
const SEVERITIES: { key: VaultIssueSeverity; label: string }[] = [
  { key: 'high', label: '需要马上处理' },
  { key: 'medium', label: '建议处理' },
  { key: 'low', label: '可以留意' },
]

/**
 * 每种问题的一句话标题。
 *
 * 宿主的 message 已经是一句完整的话（且不含明文），所以这里的标题只是**分类
 * 标签**，用于把同类问题折叠在一起看。不做成 Record<VaultIssueKind, string>
 * 而是普通对象 + 兜底：宿主将来新增一种 kind 时，页面显示它的原值而不是崩。
 */
const KIND_LABEL: Record<string, string> = {
  'reused-password': '密码重复使用',
  'weak-password': '密码太弱',
  'stale-password': '密码太久没改',
  'plaintext-secret': '敏感值未加密',
  'expired': '已经过期',
  'expiring': '快要到期',
  'no-password': '缺密码字段',
  'duplicate-record': '记录重复',
}

/** 分数 → 语义档位（决定环与数字的颜色）。 */
function toneOf(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 85) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

/** 严重度排序权重（数值小的先显示）。 */
const SEVERITY_RANK: Record<VaultIssueSeverity, number> = { high: 0, medium: 1, low: 2 }

export interface VaultHealthDrawerProps {
  /** 点某条问题 → 跳到那条记录（父级负责关抽屉并打开详情）。 */
  onOpenRecord: (recordId: string) => void
  /**
   * 批量轮换成功 → 父级重新 /list 并重算健康。
   * 不复用 onOpenRecord 之类是因为语义完全不同：这里库里有若干条记录被改写
   * 了，父级那份 records 已经不新鲜，必须重拉。
   */
  onRotated: (result: VaultRotateResult) => void
  /** 关闭抽屉。 */
  onClose: () => void
}

/**
 * 一条问题（一组里的成员、或独立的一条）。
 *
 * 抽成组件是因为它现在有两个调用点（复用组的成员行、独立问题行）；复制两份
 * 会让「以后给问题行加个状态徽标」变成两处改动。
 */
function IssueRow({ issue, onOpenRecord }: { issue: VaultIssue; onOpenRecord: (recordId: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      className={css.healthIssue}
      // 去重密码是按组报的：同一组里每条记录都会出现一次，点哪条都应该跳到
      // **那条记录**（用户要改的正是它）。
      onClick={() => { onOpenRecord(issue.recordId) }}
    >
      <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1, color: 'var(--v-text-3)' }}>
        <AlertIcon size={14} />
      </span>
      <span className={css.healthIssueMain}>
        <span className={css.healthIssueTitle}>
          {issue.title === '' ? '（未命名）' : issue.title}
        </span>
        <span className={css.healthIssueMsg}>
          {KIND_LABEL[issue.kind] ?? String(issue.kind)}：{issue.message}
        </span>
        {/* detail 是按 kind 变语义的裸数据（天数 / 组内条数），
            必须过 formatIssueDetail 翻成人话再显示。 */}
        {formatIssueDetail(issue) !== '' && (
          <span className={css.healthIssueDetail}>{formatIssueDetail(issue)}</span>
        )}
      </span>
      {/* 弱口令的处置动作只有「换一个」——把下一步写成按钮语气，用户才知道
          点进去能直接生成，而不是又得自己去想一个新密码。 */}
      {issue.kind === 'weak-password' && (
        <span className={css.genHint} style={{ flex: 'none', padding: '2px 0' }}>生成新密码 →</span>
      )}
    </button>
  )
}

/** 分数环（纯 SVG）。 */
function ScoreRing({ score }: { score: number }): JSX.Element {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const ratio = Math.max(0, Math.min(100, score)) / 100
  const tone = toneOf(score)
  const color = tone === 'good' ? 'var(--v-ok)' : (tone === 'warn' ? 'var(--v-warn)' : 'var(--v-err)')
  return (
    <div className={css.healthScoreRing}>
      <svg viewBox="0 0 62 62" width="62" height="62" aria-hidden="true">
        <circle cx="31" cy="31" r={radius} fill="none" stroke="var(--v-border-2)" strokeWidth="5" />
        <circle
          cx="31"
          cy="31"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference + ' ' + circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset .5s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <span className={css.healthScoreNum} style={{ color }}>{String(Math.round(score))}</span>
    </div>
  )
}

export function VaultHealthDrawer({ onOpenRecord, onRotated, onClose }: VaultHealthDrawerProps): JSX.Element {
  const [report, setReport] = useState<VaultHealthReport | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')

  /** 正在等待确认的复用组 groupId（null = 没有确认块打开）。 */
  const [confirming, setConfirming] = useState<string>('')
  /** 正在轮换的 groupId（按钮禁用，防连点写两遍）。 */
  const [rotating, setRotating] = useState<string>('')
  /** 轮换结果（含新明文密码）。只保留最近一次。 */
  const [rotated, setRotated] = useState<VaultRotateResult | null>(null)
  /** 复制成功的条目 key（「已复制」两秒后自己消失）。 */
  const [copiedKey, setCopiedKey] = useState<string>('')
  const copiedTimer = useRef<number | undefined>(undefined)

  /**
   * 拉报告。
   *
   * 首次失败 → 整块错误态（此时空白抽屉没有别的内容可看）；
   * 已有报告再刷新失败 → 只出一行提示，保留上次的数字（同主页面的两段式
   * 策略：把用户正在看的东西换成红屏是最差的选择）。
   */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const next = await fetchVaultHealth()
      setReport(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 卸载时收掉复制提示的定时器（否则抽屉关了还会对已卸载组件 setState）。
  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
  }, [])

  // Esc 关闭（抽屉盖在页面上，键盘用户需要一个出口）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  /** 按严重度分组（组内保持宿主给的顺序：它按危险程度排好了）。 */
  const groups = useMemo(() => {
    const sorted = [...(report?.issues ?? [])].sort(
      (left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
    )
    return SEVERITIES.map((severity) => ({
      ...severity,
      issues: sorted.filter((issue) => issue.severity === severity.key),
    })).filter((group) => group.issues.length > 0)
  }, [report])

  /**
   * 复用组：同一 groupId 且 ≥2 条的才值得批量换。
   *
   * 只有一条的 group 不可能是「复用」（宿主按组报重复密码），但防御一下——
   * 给它一个批量按钮反而会让人以为这条被复用了。
   */
  const reuseGroups = useMemo(() => {
    const map = new Map<string, VaultIssue[]>()
    for (const issue of report?.issues ?? []) {
      if (issue.kind !== 'reused-password') continue
      const groupId = issue.groupId ?? ''
      if (groupId === '') continue
      const bucket = map.get(groupId)
      if (bucket === undefined) map.set(groupId, [issue])
      else bucket.push(issue)
    }
    return map
  }, [report])

  /** 执行批量轮换。调用前必须已经过二次确认（按钮只在确认块里）。 */
  const onRotate = useCallback(async (groupId: string): Promise<void> => {
    const group = reuseGroups.get(groupId) ?? []
    if (group.length === 0) return
    setRotating(groupId)
    setError('')
    try {
      const result = await rotateVaultPasswords(group.map((issue) => issue.recordId))
      setRotated(result)
      setConfirming('')
      // 库被改写了：本地这份报告已经过期，重拉一份（复用应当当场消失）。
      // 但结果面板要留着——用户还没把新密码抄到各个站点去。
      await load()
      onRotated(result)
    } catch (reason) {
      setError('替换失败：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setRotating('')
    }
  }, [reuseGroups, load, onRotated])

  /**
   * 复制一条新密码。
   *
   * clipboard 不是「一定存在」的东西：非安全上下文（https / localhost 之外）与
   * 被企业策略禁用的浏览器里，navigator.clipboard 是 undefined。这里必须自己兜住
   * ——它是 rotate 结果面板的唯一快捷出口，抛一次异常整块面板就白屏，用户就拿不到
   * 刚生成的那串密码了。拿不到剪贴板不是错误：密码就在屏幕上，手动选中即可。
   */
  const onCopyPassword = useCallback((entryKey: string, password: string): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') return
    void clipboard.writeText(password).then(
      () => {
        setCopiedKey(entryKey)
        if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
        copiedTimer.current = window.setTimeout(() => { setCopiedKey('') }, 2000)
      },
      () => { /* 剪贴板被拒不是错误：密码就在屏幕上，手动选中即可。 */ },
    )
  }, [])

  /**
   * 把同一严重度里的 issue 列表折成「块」：复用组收成一块（多个成员 + 批量按钮），
   * 其余每条一块。
   *
   * 为什么要在渲染前做这个折叠，而不是在列表里「遇到第一条就插按钮」：复用是按
   * 组报的，同一组的几条记录散在列表里会让用户以为那是三个独立问题（其实它们是
   * **同一个**问题）。折成一块之后，「这三条用同一个密码」这件事才在视觉上成立，
   * 批量按钮也有了一个明确的归属（它换掉的是这一整组）。
   */
  const blocksOf = useCallback((issues: VaultIssue[]): Array<{ kind: 'one'; issue: VaultIssue } | { kind: 'reuse'; groupId: string; issues: VaultIssue[] }> => {
    const blocks: Array<{ kind: 'one'; issue: VaultIssue } | { kind: 'reuse'; groupId: string; issues: VaultIssue[] }> = []
    const emitted = new Set<string>()
    for (const issue of issues) {
      const groupId = issue.kind === 'reused-password' ? (issue.groupId ?? '') : ''
      if (groupId === '' || (reuseGroups.get(groupId)?.length ?? 0) < 2) {
        blocks.push({ kind: 'one', issue })
        continue
      }
      // 同一组只出一块，且放在它第一次出现的位置（宿主已按危险程度排好序）。
      if (emitted.has(groupId)) continue
      emitted.add(groupId)
      blocks.push({ kind: 'reuse', groupId, issues: reuseGroups.get(groupId) ?? [issue] })
    }
    return blocks
  }, [reuseGroups])

  const issueCount = report?.issues.length ?? 0

  const body = loading && report === null
    ? (
      <div className={css.drawerBody}>
        {[0, 1, 2].map((index) => (
          <div key={index} className={css.skeleton} style={{ height: 64 }} />
        ))}
      </div>
    )
    : error !== '' && report === null
      ? (
        <div className={css.drawerBody}>
          <div className={css.error}>
            <span style={{ display: 'inline-flex', flex: 'none' }}><AlertIcon size={15} /></span>
            <div className={css.errorText}>健康检查失败：{error}</div>
            <button type="button" className={css.errorRetry} onClick={() => { void load() }}>
              重试
            </button>
          </div>
          <div className={css.emptyText} style={{ color: 'var(--v-text-3)', fontSize: 12 }}>
            这一项是只读检查，失败不影响你的档案数据。
          </div>
        </div>
      )
      : (
        <div className={css.drawerBody}>
          {error !== '' && (
            <div className={css.error}>
              <span style={{ display: 'inline-flex', flex: 'none' }}><AlertIcon size={15} /></span>
              <div className={css.errorText}>刷新失败：{error}（下面是上次的结果）</div>
            </div>
          )}

          {report !== null && (
            <>
              <div className={css.healthScore}>
                <ScoreRing score={report.score} />
                <div className={css.healthScoreLabel}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '19px' }}>
                    {issueCount === 0 ? '没发现问题' : '有 ' + String(issueCount) + ' 项待处理'}
                  </div>
                  <div className={css.healthFacts}>
                    <span className={css.healthFact}>
                      <span className={css.healthFactNum}>{String(report.totalRecords)}</span> 条记录
                    </span>
                    <span className={css.healthFact}>
                      <span className={css.healthFactNum}>{String(report.sensitiveFields)}</span> 个敏感字段
                    </span>
                  </div>
                  {report.generatedAt !== '' && (
                    <div className={css.backupHint}>检查于 {formatVaultStamp(report.generatedAt)}</div>
                  )}
                </div>
              </div>

              {issueCount === 0 && (
                <div className={css.empty}>
                  <span className={css.emptyIcon}><ShieldIcon size={15} /></span>
                  <span className={css.emptyText}>
                    密码都很健康：没有重复、没有弱口令、没有过期。
                    <span className={css.emptyHint}>
                      定期回来看看——新加进来的账号最容易带上重复密码。
                    </span>
                  </span>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.key} className={css.healthGroup}>
                  <div className={css.healthGroupHead}>
                    <span className={css.healthSeverity} data-sev={group.key}>{group.label}</span>
                    <span style={{ fontWeight: 500 }}>{String(group.issues.length)}</span>
                  </div>
                  {blocksOf(group.issues).map((block) => block.kind === 'one' ? (
                    <IssueRow
                      key={block.issue.recordId + ':' + (block.issue.fieldKey ?? '') + ':' + block.issue.kind}
                      issue={block.issue}
                      onOpenRecord={onOpenRecord}
                    />
                  ) : (
                    <div key={'reuse:' + block.groupId} className={css.rotateBlock}>
                      <div className={css.rotateBlockHead}>
                        <span className={css.rotateBlockTitle}>
                          这 {String(block.issues.length)} 条记录用的是<b>同一个密码</b>
                          {' '}——换成互不相同的强口令，一次改完。
                        </span>
                        <button
                          type="button"
                          className={css.rotateBtn}
                          disabled={rotating !== ''}
                          onClick={() => { setConfirming(block.groupId); setRotated(null) }}
                        >
                          <ShieldIcon size={12} /> 全部换成随机强口令
                        </button>
                      </div>
                      {block.issues.map((issue, index) => (
                        <IssueRow
                          key={issue.recordId + ':' + String(index)}
                          issue={issue}
                          onOpenRecord={onOpenRecord}
                        />
                      ))}

                      {/* 二次确认：这一屏是整条链上唯一不可撤销的动作，所以它常驻在
                          组内（不是一闪而过的原生 confirm），文案也写死在页面上。 */}
                      {confirming === block.groupId && (
                        <div className={css.rotateConfirm}>
                          <div className={css.rotateConfirmTitle}>确认要现在替换吗？</div>
                          <div className={css.rotateConfirmText}>
                            会立即把上面 {String(block.issues.length)} 条记录的密码换成各自独立的新口令，
                            并<b>当场写入本机档案</b>。<b>旧密码会被覆盖、无法恢复</b>，
                            所以请先确认你能在这些站点上改密（新口令要逐条去各站粘贴）。
                          </div>
                          <div className={css.rotateConfirmRow}>
                            <button
                              type="button"
                              className={css.btn + ' ' + css.btnDanger}
                              disabled={rotating !== ''}
                              onClick={() => { void onRotate(block.groupId) }}
                            >
                              {rotating === block.groupId ? '正在替换…' : '确认替换这 ' + String(block.issues.length) + ' 条'}
                            </button>
                            <button
                              type="button"
                              className={css.btn + ' ' + css.btnGhost}
                              disabled={rotating !== ''}
                              onClick={() => { setConfirming('') }}
                            >
                              先不换
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {/* 结果面板：新明文密码列在这里。它在这个抽屉的**最后**，但语义上
                  最重要——用户离开这一屏之前必须把每条抄到对应站点去。所以只要
                  有结果就常驻，不随重拉报告消失。 */}
              {rotated !== null && rotated.rotated.length > 0 && (
                <div className={css.rotateResult}>
                  <div className={css.rotateResultTitle}>
                    已换成 {String(rotated.rotated.length)} 个新密码
                  </div>
                  <div className={css.rotateResultHint}>
                    现在逐条去对应站点改密：点密码复制，粘到站点的「修改密码」里。
                    {' '}<b>这一屏关掉之后，新密码就查不到了</b>——但记录里存着，点开那条记录还能再看。
                  </div>
                  {rotated.rotated.map((entry) => (
                    <div key={entry.id + ':' + entry.key} className={css.rotateResultRow}>
                      <span className={css.rotateResultName} title={entry.title}>
                        {entry.title === '' ? '（未命名）' : entry.title}
                      </span>
                      <span
                        className={css.rotateResultCode}
                        title="点击复制新密码"
                        onClick={() => { onCopyPassword(entry.id + ':' + entry.key, entry.password) }}
                      >
                        {entry.password}
                      </span>
                      <button
                        type="button"
                        className={css.btn + ' ' + css.btnGhost}
                        style={{ height: 24, padding: '0 8px' }}
                        onClick={() => { onCopyPassword(entry.id + ':' + entry.key, entry.password) }}
                      >
                        <CopyIcon size={12} />
                        {copiedKey === entry.id + ':' + entry.key ? ' 已复制' : ' 复制'}
                      </button>
                      <span className={css.rotateResultHint}>请到该站点改密后回来确认</span>
                    </div>
                  ))}

                  {rotated.skipped.length > 0 && (
                    <div className={css.rotateSkipped}>
                      {rotated.skipped.map((entry) => {
                        // 被跳过的记录一定**不在** rotated 里，标题只能回报告里找
                        // （报告是按 recordId 索引的，宿主给的问题项自带标题）。
                        const title = report?.issues.find((issue) => issue.recordId === entry.id)?.title ?? ''
                        return (
                          <div key={entry.id} className={css.rotateSkippedRow}>
                            <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1 }}>
                              <AlertIcon size={12} />
                            </span>
                            <span>
                              {(title === '' ? '有一条记录' : '「' + title + '」')}
                              {' '}没有换：{entry.reason}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 全部跳过（一条都没换成）：也要给结论，否则点了按钮像没反应。 */}
              {rotated !== null && rotated.rotated.length === 0 && (
                <div className={css.rotateResult}>
                  <div className={css.rotateResultTitle}>一条都没换成功</div>
                  <div className={css.rotateResultHint}>
                    这些记录里没有可替换的登录口令字段（批量替换只改密码，不动其它字段）。
                  </div>
                  {rotated.skipped.map((entry) => (
                    <div key={entry.id} className={css.rotateSkippedRow}>
                      <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1 }}>
                        <AlertIcon size={12} />
                      </span>
                      <span>{entry.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )

  return (
    <div className={css.drawer} role="dialog" aria-modal="true" aria-label="密码健康检查">
      <div className={css.drawerHead}>
        <span style={{ display: 'inline-flex', color: 'var(--v-text-2)' }}><ShieldIcon size={16} /></span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' }}>
          密码健康
        </div>
        <button
          type="button"
          className={css.drawerClose}
          title="重新检查"
          aria-label="重新检查"
          disabled={loading}
          onClick={() => { void load() }}
        >
          <RefreshIcon size={14} />
        </button>
        <button type="button" className={css.drawerClose} aria-label="关闭健康检查" title="关闭（Esc）" onClick={onClose}>
          <CloseIcon size={15} />
        </button>
      </div>
      {body}
    </div>
  )
}

/**
 * 给头部入口用的「待处理条数」。
 *
 * 单独导出一个纯函数而不是让 Panel 自己算：条数的口径（高+中+低全算）是这份
 * 报告的一部分，散到调用方去加起来，两处迟早不一致。
 */
export function pendingIssueCount(report: VaultHealthReport | null): number {
  if (report === null) return 0
  return report.issues.length
}

/** 报告里最严重的档位（用于头部按钮配色）。 */
export function worstSeverityOf(report: VaultHealthReport | null): VaultIssueSeverity | null {
  if (report === null || report.issues.length === 0) return null
  let worst: VaultIssueSeverity | null = null
  for (const issue of report.issues) {
    if (worst === null || SEVERITY_RANK[issue.severity] < SEVERITY_RANK[worst]) worst = issue.severity
  }
  return worst
}

/** 种类的中文名（别处要展示时复用，避免第二份映射表）。 */
export function issueKindLabel(kind: VaultIssueKind): string {
  return KIND_LABEL[kind] ?? String(kind)
}

export type { VaultIssue }
