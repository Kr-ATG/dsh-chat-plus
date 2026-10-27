/**
 * 云端备份 —— 把档案加密包每 N 小时自动推到 GitHub **私库**。
 *
 * ── 为什么这个面板的第一屏是「填地址」而不是「一个开关」──────────────
 * 用户 2026-10-27 的诉求是「界面提供一个 GitHub 链接输入框，填进去就能自动上传」。
 * 所以打开面板时，视觉重心必须是那个输入框：没配过的人一眼知道要做什么，
 * 配过的人一眼看到当前指向哪个仓库。
 *
 * ── 为什么还要令牌与口令（用户可能会觉得「怎么这么多框」）─────────────
 * 见 src/triad/vault/sync-types.ts 与 sync.ts 的文件头：包里带着本机密钥，
 * 不加密就等于把密码库明文送上网；不填令牌 GitHub 就不让写。这两个框不是
 * 设计上的啰嗦，是「能传出去 yet 别人解不开」这条要求的直接推论。
 * 页面能做的补偿是：把令牌那一步尽量藏起来（本机 gh 登录过就自动回退），
 * 并在文案里说清「现在用的是哪个」。
 *
 * ── 三种状态的视觉纪律 ──────────────────────────────────────────────
 *  1. 未配置     → 顶部一条提示（醒目但不刺眼）+ 输入框是空的；
 *  2. 配置不全   → 提示条指出缺哪一项（不是笼统的「未配置」）；
 *  3. 已配置     → 显示仓库外链、上次结果、下次时间、历史。
 * 三种状态用同一套骨架，只换状态行与按钮文案——避免用户每换一次状态就得
 * 重新找一遍按钮在哪。
 */

import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import {
  describeGithubRepo,
  getVaultSync,
  saveVaultSync,
  syncVaultNow,
  verifyVaultSyncRepo,
} from './api.js'
import { css } from './styles.js'
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  ExternalIcon,
  RefreshIcon,
  ShieldIcon,
  UploadIcon,
} from './icons.js'
import type { VaultSyncPublic } from '../../../triad/vault/sync-types.js'
import { formatVaultBytes, formatVaultStamp } from './api.js'

/** 面板属性（与 BackupPanel 同形：三个回调，父级统一渲染错误与提示条）。 */
export interface VaultSyncPanelProps {
  onError: (message: string) => void
  onFlash: (message: string) => void
  /** 同步成功（父级可能要刷新统计——档案包刚被推出去，用户会想看到「已备份」）。 */
  onSynced?: () => void
}

export function VaultSyncPanel({ onError, onFlash, onSynced }: VaultSyncPanelProps): JSX.Element {
  const [state, setState] = useState<VaultSyncPublic | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  /** 输入框里的草稿（**与 state.repoInput 分离**：用户正在打字时不能被后台刷新覆盖）。 */
  const [repoDraft, setRepoDraft] = useState<string>('')
  const [tokenDraft, setTokenDraft] = useState<string>('')
  const [passDraft, setPassDraft] = useState<string>('')
  const [busy, setBusy] = useState<'' | 'save' | 'sync' | 'verify'>('')
  /** 保存成功后的一次性成功提示（不走 onFlash，避免面板外那条提示分不清是哪个动作的）。 */
  const [local, setLocal] = useState<string>('')

  const adopt = useCallback((next: VaultSyncPublic): void => {
    setState(next)
    // 只在「用户还没开始编辑」时同步草稿：否则后台轮询会把正在输入的内容冲掉。
    setRepoDraft((current) => (current === '' ? next.repoInput : current))
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    try {
      adopt(await getVaultSync())
    } catch (reason) {
      onError('读不到云端备份设置：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setLoading(false)
    }
  }, [adopt, onError])

  useEffect(() => { void reload() }, [reload])

  // 同步在后台跑的时候，面板每隔 3 秒对一次状态（「正在上传」→「上次成功」）。
  // 只在 running 为真时开轮询：常驻轮询会让这个面板变成一个隐形的请求源。
  useEffect(() => {
    if (state?.running !== true) return
    const timer = setInterval(() => { void reload() }, 3000)
    return () => { clearInterval(timer) }
  }, [state?.running, reload])

  const draftInfo = describeGithubRepo(repoDraft)
  const dirty = state !== null && (repoDraft !== state.repoInput
    || tokenDraft !== '' || passDraft !== '')

  /**
   * 保存。
   *
   * 只提交**用户实际动过的字段**：token / passphrase 留空表示「不改」而不是
   * 「清空」——用户只改仓库地址时，不该顺手把之前存好的令牌抹掉。
   * 要清除令牌得点专门的按钮（见下方「清除令牌」）。
   */
  const onSave = async (): Promise<void> => {
    if (repoDraft.trim() !== '' && !draftInfo.valid) {
      onError(draftInfo.hint)
      return
    }
    setBusy('save')
    setLocal('')
    try {
      const patch: Parameters<typeof saveVaultSync>[0] = { repo: repoDraft.trim() }
      if (tokenDraft !== '') patch.token = tokenDraft
      if (passDraft !== '') patch.passphrase = passDraft
      adopt(await saveVaultSync(patch))
      // 秘密立刻从 React state 里清掉：它们已经落到本机密文里了，留在输入框
      // 只是多一个被肩窥 / 截图带走的机会。
      setTokenDraft('')
      setPassDraft('')
      setLocal('已保存')
      onFlash('云端备份设置已保存')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  /** 清除本机存着的令牌 / 口令（改回「用本机 gh 登录态」或「还没设口令」）。 */
  const onClear = async (field: 'token' | 'passphrase'): Promise<void> => {
    if (!window.confirm(field === 'token'
      ? '清除本机保存的 GitHub 令牌？之后会改用本机 gh 登录态（如果登录过）。\n自动上传会停，直到你重新填一个令牌或登录 gh。'
      : '清除同步口令？没有口令就打不出加密包，自动上传会停。\n已经上传到 GitHub 的历史备份不受影响（它们仍用旧口令加密）。')) return
    setBusy('save')
    try {
      adopt(await saveVaultSync(field === 'token' ? { token: '' } : { passphrase: '' }))
      setLocal(field === 'token' ? '已清除令牌' : '已清除口令')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  /** 立即同步。失败不抛错（宿主把原因放在 run.error），这里只把它显示出来。 */
  const onSyncNow = async (): Promise<void> => {
    setBusy('sync')
    setLocal('')
    try {
      const { run, sync } = await syncVaultNow()
      adopt(sync)
      if (run.status === 'ok') {
        setLocal(run.unchanged === true
          ? '已比对：远端就是最新，没有产生新提交'
          : '已上传' + (run.bytes !== undefined ? '（' + formatVaultBytes(run.bytes) + '）' : ''))
        onFlash('云端备份完成')
        onSynced?.()
      } else {
        onError('同步失败：' + (run.error ?? '未知错误'))
      }
    } catch (reason) {
      onError('同步请求没有送达：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setBusy('')
    }
  }

  /** 校验仓库（可达 + 私有）。比「上传」轻，用户改完地址可以先点这个。 */
  const onVerify = async (): Promise<void> => {
    setBusy('verify')
    setLocal('')
    try {
      const { probe, sync } = await verifyVaultSyncRepo()
      adopt(sync)
      if (!probe.private) {
        onError('这个仓库是公开的（' + probe.repo + '）。档案包虽然加密，也不该放进公开仓库——请改成 Private 或换一个。')
      } else {
        setLocal('仓库可用（私有，默认分支 ' + probe.branch + '）')
      }
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return <div className={css.backupHint}>正在读取云端备份设置…</div>
  }

  const sync = state
  const ready = sync !== null && sync.repo !== '' && sync.passphraseSet && sync.tokenSet
  const canSyncNow = ready && busy === '' && sync?.running !== true

  return (
    <div className={css.backup}>
      {/* ── 状态条：一眼看到「能不能自动传 / 还缺什么」 ── */}
      <div className={sync?.needsSetup === true ? css.backupWarn : css.backupSection}>
        {sync?.needsSetup === true
          ? (
            <>
              <div className={css.backupLabel}>
                <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1 }}><AlertIcon size={13} /></span>
                还没配置好
              </div>
              <div className={css.backupHint}>
                {sync.repo === ''
                  ? '填一个 GitHub 私有仓库地址（下面第一个输入框），档案就会每 '
                    + String(sync.everyHours) + ' 小时自动传一份加密备份上去。'
                  : (sync.passphraseSet
                    ? '仓库已填，但还没有可用的 GitHub 令牌：填一个（见下方），或在本机执行 gh auth login。'
                    : '仓库已填，但还没设同步口令。包里有你的密钥，必须先用口令加密才能上传——见下方「同步口令」。')}
              </div>
            </>
          )
          : (
            <>
              <div className={css.backupLabel}>
                <span style={{ display: 'inline-flex', flex: 'none', color: 'var(--v-text-2)' }}><ShieldIcon size={14} /></span>
                自动备份已就绪
              </div>
              <div className={css.backupHint}>
                每 {String(sync?.everyHours ?? 5)} 小时把加密包推到{' '}
                {sync !== null && sync.repoUrl !== ''
                  ? <a href={sync.repoUrl} target="_blank" rel="noreferrer">{sync.repo}</a>
                  : '仓库'}
                。{sync !== null && sync.nextAt !== ''
                  ? '下次约 ' + formatVaultStamp(sync.nextAt) + '。'
                  : '自动上传当前是关闭的。'}
              </div>
            </>
          )}
      </div>

      {/* ── 仓库地址（用户要的那个输入框，放最上面） ── */}
      <div className={css.backupSection}>
        <div className={css.backupLabel}>GitHub 仓库地址（必须是私有仓库）</div>
        <input
          className={css.backupInput}
          type="text"
          value={repoDraft}
          placeholder="https://github.com/你的用户名/仓库名"
          aria-label="GitHub 仓库地址"
          spellCheck={false}
          onChange={(event) => { setRepoDraft(event.target.value) }}
        />
        {repoDraft.trim() !== '' && (
          <div className={css.backupHint}>
            {draftInfo.valid
              ? '将使用仓库 ' + draftInfo.fullName + '（' + draftInfo.url + '）'
              : draftInfo.hint}
          </div>
        )}
        {sync !== null && sync.repo !== '' && repoDraft === sync.repoInput && (
          <div className={css.backupRow}>
            {sync.repoUrl !== '' && (
              <a
                className={css.backupHint}
                href={sync.repoUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <ExternalIcon size={12} /> 在 GitHub 打开
              </a>
            )}
            <span className={css.backupHint}>
              {sync.repoPrivate === true
                ? '已确认是私有仓库'
                : sync.repoPrivate === false
                  ? '⚠ 这是公开仓库，同步会被拒绝'
                  : '私有性还没校验（点「校验仓库」或直接同步）'}
            </span>
          </div>
        )}
        {/*
          没有「一键填入推荐地址」按钮，这是刻意的：
          这个功能的语义是「每个人的档案传进他自己的私库」，不存在公共终点。
          给别人预填一个真实仓库名，轻则 403（用户以为插件坏了），重则如果他是
          协作者，就把自己的密码库传进了别人的仓库。所以只给建仓库的入口。
        */}
        {sync !== null && sync.repo === '' && (
          <div className={css.backupHint}>
            还没有私有仓库？点下面这个链接建一个：Name 随便起（比如 dsh-vault-backup），
            <b>Visibility 必须选 Private</b>，其它都不必勾。建完把地址粘到上面。
          </div>
        )}
        {sync !== null && sync.repo === '' && (
          <a
            className={css.backupHint}
            href="https://github.com/new?type=private&name=dsh-vault-backup"
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <ExternalIcon size={12} /> 在 GitHub 上新建一个私有仓库
          </a>
        )}
      </div>

      {/* ── 同步口令 ── */}
      <div className={css.backupSection}>
        <div className={css.backupLabel}>同步口令{sync?.passphraseSet === true ? '（已设置）' : ''}</div>
        <div className={css.backupHint}>
          包里有你的加密密钥，所以整包要再用这条口令加密一次——没有它，GitHub 上就是一份能直接解开的密码库。
          {' '}换机器恢复时要用同一条口令，请记在别处。
        </div>
        <input
          className={css.backupInput}
          type="password"
          autoComplete="new-password"
          value={passDraft}
          placeholder={sync?.passphraseSet === true ? '留空表示不修改' : '设一个口令（至少 8 位）'}
          aria-label="同步口令"
          onChange={(event) => { setPassDraft(event.target.value) }}
        />
        {sync?.passphraseSet === true && (
          <button
            type="button"
            className={css.btn + ' ' + css.btnGhost}
            disabled={busy !== ''}
            onClick={() => { void onClear('passphrase') }}
          >
            清除口令
          </button>
        )}
      </div>

      {/* ── 访问令牌 ── */}
      <div className={css.backupSection}>
        <div className={css.backupLabel}>GitHub 访问令牌</div>
        <div className={css.backupHint}>
          {sync?.tokenSource === 'gh'
            ? '当前用本机 gh 登录态（' + '…' + String(sync.tokenTail) + '）。本机已 gh auth login，不必再填。'
            : sync?.tokenSource === 'stored'
              ? '当前用你填的令牌（…' + String(sync?.tokenTail ?? '') + '）。'
              : '还没有令牌：填一个，或在本机执行 gh auth login。'}
          {' '}令牌需要对这个仓库有 <b>Contents 读写</b>权限（细粒度令牌）或 repo 作用域（经典令牌）。
        </div>
        <input
          className={css.backupInput}
          type="password"
          autoComplete="off"
          value={tokenDraft}
          placeholder={sync?.tokenSet === true ? '留空表示不修改' : 'ghp_… / github_pat_…'}
          aria-label="GitHub 访问令牌"
          onChange={(event) => { setTokenDraft(event.target.value) }}
        />
        <div className={css.backupRow}>
          <a
            className={css.backupHint}
            href="https://github.com/settings/tokens?type=beta"
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <ExternalIcon size={12} /> 去 GitHub 建一个细粒度令牌
          </a>
          {sync?.tokenSource === 'stored' && (
            <button
              type="button"
              className={css.btn + ' ' + css.btnGhost}
              disabled={busy !== ''}
              onClick={() => { void onClear('token') }}
            >
              清除令牌
            </button>
          )}
        </div>
        <div className={css.backupHint}>
          令牌只存在这台机器上，用档案的密钥加密保存，页面上只显示后四位。
        </div>
      </div>

      {/* ── 动作 ── */}
      <div className={css.backupRow}>
        <button
          type="button"
          className={css.btn + ' ' + css.btnPri}
          disabled={busy !== '' || (dirty === false && sync?.needsSetup === false)}
          onClick={() => { void onSave() }}
        >
          {busy === 'save' ? '正在保存…' : '保存'}
        </button>
        <button
          type="button"
          className={css.btn}
          disabled={busy !== '' || sync === null || sync.repo === ''}
          onClick={() => { void onVerify() }}
        >
          {busy === 'verify' ? '正在校验…' : '校验仓库'}
        </button>
        <button
          type="button"
          className={css.btn}
          disabled={!canSyncNow}
          onClick={() => { void onSyncNow() }}
        >
          <UploadIcon size={13} /> {busy === 'sync' || sync?.running === true ? '正在同步…' : '立即同步'}
        </button>
        <button
          type="button"
          className={css.btn + ' ' + css.btnGhost}
          disabled={busy !== ''}
          onClick={() => { setLocal(''); void reload() }}
        >
          <RefreshIcon size={13} /> 刷新状态
        </button>
      </div>
      {local !== '' && <div className={css.backupFingerprint}>{local}</div>}

      {/* ── 上传完整性：这是「档案到底传全了没」的唯一答案 ──
          三种状态分开说，不含糊：
            · 已全部上传  = 当前内容指纹与上次成功上传的一致
            · 有改动未上传 = 用户刚改过档案，还没到下次定时（或上次失败了）
            · 尚未上传    = 从来没成功传过（此时不能说"已上传"）
          判定在 host 侧算（publicView.upToDate）：客户端拿不到密钥、也不该
          为了一次判断去下载整个包。 */}
      {sync !== null && sync.needsSetup === false && (
        <div className={css.uploadState} data-state={
          sync.upToDate === 'unknown' ? 'pending' : (sync.upToDate ? 'done' : 'dirty')
        }>
          <span className={css.uploadStateIcon}>
            {sync.upToDate === true
              ? <CheckIcon size={14} />
              : (sync.upToDate === 'unknown' ? <ClockIcon size={14} /> : <AlertIcon size={14} />)}
          </span>
          <span className={css.uploadStateText}>
            {sync.upToDate === true && (
              <>
                <b>已全部上传</b>
                <span className={css.uploadStateMeta}>
                  {sync.uploadedRecords > 0 ? String(sync.uploadedRecords) + ' 条记录 · ' : ''}
                  内容与云端一致
                </span>
              </>
            )}
            {sync.upToDate === false && (
              <>
                <b>有改动尚未上传</b>
                <span className={css.uploadStateMeta}>
                  {sync.currentRecords !== sync.uploadedRecords && sync.uploadedRecords > 0
                    ? '当前 ' + String(sync.currentRecords) + ' 条，云端 ' + String(sync.uploadedRecords) + ' 条 · '
                    : ''}
                  点「立即同步」或等下次定时
                </span>
              </>
            )}
            {sync.upToDate === 'unknown' && (
              <>
                <b>{sync.lastStatus === 'ok' ? '已传过备份，待确认是否最新' : '尚未上传'}</b>
                <span className={css.uploadStateMeta}>
                  {sync.lastStatus === 'error'
                    ? '上次失败了，修好后点「立即同步」'
                    : sync.lastStatus === 'ok'
                      /* 走到这里只有两种可能：换了仓库（旧指纹被清掉），
                         或者 host 半身还是旧版本、不下发指纹字段。两种都
                         不该撒谎说「已全部上传」，也不该说「没传过」。 */
                      ? '点「立即同步」补齐一次，之后就能看到是否最新'
                      : '点「立即同步」把第一份备份传上去'}
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {sync?.lastStatus === 'error' && sync.lastError !== '' && (
        <div className={css.backupWarn}>
          <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1 }}><AlertIcon size={13} /></span>
          <span>上次同步失败：{sync.lastError}</span>
        </div>
      )}

      {/* ── 上次结果与历史 ── */}
      {sync !== null && (sync.lastAt !== '' || sync.history.length > 0) && (
        <div className={css.backupSection}>
          <div className={css.backupLabel}>
            <span style={{ display: 'inline-flex', flex: 'none', color: 'var(--v-text-3)' }}><ClockIcon size={13} /></span>
            同步记录
          </div>
          {sync.lastStatus === 'ok' && (
            <div className={css.backupHint}>
              上次成功 {formatVaultStamp(sync.lastAt)}
              {sync.lastBytes > 0 ? ' · ' + formatVaultBytes(sync.lastBytes) : ''}
              {sync.lastCommit !== '' ? ' · 提交 ' + sync.lastCommit.slice(0, 7) : ''}
            </div>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sync.history.slice(0, 6).map((run, index) => (
              <li key={run.at + ':' + String(index)} className={css.backupHint}>
                {run.status === 'ok' ? '✓' : '✗'}{' '}
                {formatVaultStamp(run.at)}
                {run.status === 'ok'
                  ? (run.unchanged === true
                    ? ' 已比对，无变化'
                    : (run.bytes !== undefined ? ' ' + formatVaultBytes(run.bytes) : ''))
                  : ' ' + (run.error ?? '失败')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={css.backupHint} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShieldIcon size={13} />
        上传的是加密包：口令 + 档案密钥双重保护，GitHub 上读不到任何明文。
        恢复时在「备份与恢复」里选这个包，输入同一条同步口令即可。
      </div>
    </div>
  )
}
