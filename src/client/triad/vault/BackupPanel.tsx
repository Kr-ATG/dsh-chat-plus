/**
 * 备份与恢复 —— 换机器时唯一能把密码带走的通道。
 *
 * ── 为什么这件事必须做完整（而不是「导出一份 JSON 就够了」）──────────────
 * 档案里的敏感值用**本机密钥**加密落盘。只导出数据文件（vault.json）换一台
 * 机器就是一堆解不开的密文——密钥留在旧机器上，等于那批密码永久丢失。所以
 * 备份包必须包含密钥本身，而包含密钥又意味着这个包**必须再加密一层**（用户
 * 给的口令），否则就是明文密码库。这两条互为前提，缺一条这个功能都是有害的。
 *
 * ── 为什么口令不从 props / state 之外的地方来 ────────────────────────
 * 口令只存在于这个组件的 useState 里，请求发出去就不再需要它。不写 localStorage
 * （持久化口令＝把保险箱钥匙贴在门上）、不进日志、不塞 URL。组件卸载即蒸发。
 *
 * ── 为什么恢复是「选文件 + 口令 + 覆盖警告」三步而不是一键 ─────────────
 * 恢复是**整库覆盖**（不是合并）。用户手滑点到它、又填了个口令，几秒钟就能
 * 把现在整个库换成半个月前的快照。所以：覆盖警告常显（不是确认框里一闪而过
 * 的一句话），执行前还要再过一道 window.confirm。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  fetchVaultKeyInfo,
  downloadVaultBackup,
  formatVaultBytes,
  formatVaultStamp,
  restoreVaultBackup,
} from './api.js'
import type { VaultKeyInfo, VaultRestoreResult } from './api.js'
import { css } from './styles.js'
import { AlertIcon, DownloadIcon, KeyIcon, ShieldIcon, UploadIcon } from './icons.js'

/** 备份面板属性。 */
export interface VaultBackupPanelProps {
  /** 恢复成功（父级要重新 /list 一遍：整库都换了）。 */
  onRestored: (result: VaultRestoreResult) => void
  /** 错误上报（父级统一渲染中文错误行）。 */
  onError: (message: string) => void
  /** 成功提示（一过性，父级的提示条）。 */
  onFlash: (message: string) => void
}

export function VaultBackupPanel({ onRestored, onError, onFlash }: VaultBackupPanelProps): JSX.Element {
  // ── 密钥信息 ──
  const [info, setInfo] = useState<VaultKeyInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState<boolean>(true)

  // ── 导出 ──
  const [exportPassword, setExportPassword] = useState<string>('')
  const [exportPasswordAgain, setExportPasswordAgain] = useState<string>('')
  const [includePhotos, setIncludePhotos] = useState<boolean>(false)
  const [exporting, setExporting] = useState<boolean>(false)

  // ── 导入 ──
  const [restorePassword, setRestorePassword] = useState<string>('')
  const [restoreText, setRestoreText] = useState<string>('')
  const [restoreName, setRestoreName] = useState<string>('')
  const [restoreBytes, setRestoreBytes] = useState<number>(0)
  const [restoring, setRestoring] = useState<boolean>(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const loadInfo = useCallback(async (): Promise<void> => {
    setInfoLoading(true)
    try {
      setInfo(await fetchVaultKeyInfo())
    } catch (reason) {
      // 取不到密钥信息不算致命：导出按钮自己会在服务端报错时说清楚原因。
      // 但页面必须让用户知道「指纹读不到」，否则他会以为核对过了。
      setInfo(null)
      onError('读不到密钥信息：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setInfoLoading(false)
    }
  }, [onError])

  useEffect(() => { void loadInfo() }, [loadInfo])

  /**
   * 导出。
   *
   * 口令要求「输两遍且一致」：这是唯一一次设定备份口令的机会，输错一个字符
   * 的后果是**几个月后换机器时才发现打不开**，那时已经无从补救。
   */
  const onExport = async (): Promise<void> => {
    // 门槛与宿主一致（都是 8 位）：前端放宽会让用户在填 6 位时被服务端拒，
    // 前端收紧则会出现「服务端接受但页面不让过」。两边同一个数字。
    if (exportPassword.length < 8) {
      onError('备份口令至少 8 位：这个包里有你的密钥，太短的容易被人试出来')
      return
    }
    if (exportPassword !== exportPasswordAgain) {
      onError('两次输入的口令不一致')
      return
    }
    if (!window.confirm(
      '现在导出备份包（' + (includePhotos ? '含图片与文件' : '不含图片与文件') + '）。' + '\n'
      + '请把口令记在别的地方：口令丢了这个包就打不开，也没有任何办法找回。',
    )) return
    setExporting(true)
    try {
      const result = await downloadVaultBackup(exportPassword, includePhotos)
      onFlash('已导出 ' + result.filename + '（' + formatVaultBytes(result.bytes) + '）')
      // 成功即清空口令：它已经用完，留在输入框里只是多一个被看见的机会。
      setExportPassword('')
      setExportPasswordAgain('')
    } catch (reason) {
      onError('导出失败：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setExporting(false)
    }
  }

  /** 选文件：只读，不解码、不上传，等用户填完口令再一起提交。 */
  const onPickFile = async (file: File | null): Promise<void> => {
    if (file === null) return
    setRestoreName(file.name)
    setRestoreBytes(file.size)
    try {
      // text() 读的是 UTF-8 全文；备份包本身就是文本格式（JSON 外壳），
      // 所以这里不经过任何二进制转换——多转一次就把内容弄坏了。
      setRestoreText(await file.text())
    } catch (reason) {
      setRestoreText('')
      onError('这个文件读不出来：' + (reason instanceof Error ? reason.message : String(reason)))
    }
  }

  /**
   * 恢复。
   *
   * 三道闸：选了文件 → 填了口令 → 确认覆盖警告。缺一道都不发请求。
   */
  const onRestore = async (): Promise<void> => {
    if (restoreText === '') {
      onError('先选一个备份包文件（.dshvault）')
      return
    }
    if (restorePassword === '') {
      onError('请填写备份包的导出密码')
      return
    }
    if (!window.confirm(
      '恢复会覆盖这台机器上现在的全部档案记录、照片与文件，之后无法退回。' + '\n'
      + '确定要恢复吗？',
    )) return
    setRestoring(true)
    try {
      const result = await restoreVaultBackup(restorePassword, restoreText)
      onRestored(result)
      // 恢复成功要报三件事：恢复了多少、以及这是一份什么时候的备份——后者最重要，
      // 用户常常拿错了包（比如上个月的），看到日期才发现。
      const from = result.createdAt === undefined ? '' : '（备份于 ' + formatVaultStamp(result.createdAt) + '）'
      onFlash(
        '已恢复 ' + String(result.records) + ' 条记录、'
        + String(result.photos) + ' 张照片、' + String(result.scenes) + ' 个场景'
        + (result.replaced ? '，覆盖了原有数据' : '') + from,
      )
      // 口令与文件内容都清掉：包已经落在库里了，再留一份在内存里没有意义。
      setRestorePassword('')
      setRestoreText('')
      setRestoreName('')
      setRestoreBytes(0)
      if (fileRef.current !== null) fileRef.current.value = ''
    } catch (reason) {
      onError('恢复失败：' + (reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setRestoring(false)
    }
  }

  const keyMissing = info !== null && !info.exists
  const busy = exporting || restoring

  return (
    <div className={css.backup} data-role="backup">
      {/* ── 密钥 ── */}
      <div className={css.backupSection} data-role="section" data-section="key">
        <div className={css.backupLabel} data-role="section-head">
          <KeyIcon size={14} />
          本机密钥
        </div>
        {infoLoading
          ? <div className={css.backupHint}>正在读取…</div>
          : info === null
            ? <div className={css.backupHint}>读不到密钥信息（不影响使用，但无法核对指纹）。</div>
            : (
              <>
                <div className={css.backupFingerprint}>
                  指纹 <b>{info.fingerprint === '' ? '（无）' : info.fingerprint}</b>
                </div>
                <div className={css.backupHint}>
                  指纹可以贴给别人核对是不是同一把钥匙；密钥本身永远不会离开这台机器。
                </div>
              </>
            )}
        {keyMissing && (
          <div className={css.backupWarn}>
            <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1 }}><AlertIcon size={13} /></span>
            <span>
              这台机器上还没有密钥。以后写进去的密码会自动生成一把——但现在没有，
              所以先把档案导出或删掉，别让旧密文烂在库里。
            </span>
          </div>
        )}
      </div>

      {/* ── 导出 ── */}
      <div className={css.backupSection} data-role="section" data-section="export">
        <div className={css.backupLabel} data-role="section-head">
          <DownloadIcon size={14} />
          导出备份
        </div>
        <div className={css.backupHint}>
          包里是密钥 + 全部记录，用你下面设的口令加密。换机器时用它恢复：
          {' '}<b>没有它，旧机器一坏，密码就真的找不回来了</b>。
        </div>
        <input
          className={css.backupInput}
          type="password"
          autoComplete="new-password"
          value={exportPassword}
          placeholder="给备份包设一个口令（至少 8 位）"
          aria-label="备份口令"
          onChange={(event) => { setExportPassword(event.target.value) }}
        />
        <input
          className={css.backupInput}
          type="password"
          autoComplete="new-password"
          value={exportPasswordAgain}
          placeholder="再输一遍确认"
          aria-label="确认备份口令"
          onChange={(event) => { setExportPasswordAgain(event.target.value) }}
        />
        <label className={css.backupHint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={includePhotos}
            onChange={(event) => { setIncludePhotos(event.target.checked) }}
          />
          把图片也打进包里（包会变大，但证件照片换机器后还在）
        </label>
        <div className={css.backupRow} data-role="actions">
          <button
            type="button"
            className={css.btn + ' ' + css.btnPri}
            disabled={busy}
            onClick={() => { void onExport() }}
          >
            <DownloadIcon size={13} /> {exporting ? '正在生成…' : '导出'}
          </button>
          {exportPassword !== '' && exportPassword === exportPasswordAgain && (
            <span className={css.backupHint}>口令一致。</span>
          )}
        </div>
      </div>

      {/* ── 导入 ── */}
      <div className={css.backupSection} data-role="section" data-section="restore">
        <div className={css.backupLabel} data-role="section-head">
          <UploadIcon size={14} />
          从备份恢复
        </div>
        <div className={css.backupWarn}>
          <span style={{ display: 'inline-flex', flex: 'none', marginTop: 1 }}><AlertIcon size={13} /></span>
          <span>
            恢复会{' '}<b>覆盖</b>{' '}这台机器上现在的全部记录、照片与文件，而且没有撤销。
            一般是换了机器、或旧库彻底坏了才用它。
          </span>
        </div>
        <input
          ref={fileRef}
          className={css.backupHint}
          type="file"
          accept=".dshvault,.json,application/json"
          aria-label="选择备份包"
          onChange={(event) => { void onPickFile(event.target.files?.[0] ?? null) }}
        />
        {restoreName !== '' && (
          <div className={css.backupFingerprint}>
            已选 <b>{restoreName}</b>
            {restoreBytes > 0 ? ' · ' + formatVaultBytes(restoreBytes) : ''}
          </div>
        )}
        <input
          className={css.backupInput}
          type="password"
          autoComplete="off"
          value={restorePassword}
          placeholder="备份包的导出密码"
          aria-label="备份包密码"
          onChange={(event) => { setRestorePassword(event.target.value) }}
        />
        <div className={css.backupRow} data-role="actions">
          <button
            type="button"
            className={css.btn + ' ' + css.btnDanger}
            disabled={busy || restoreText === ''}
            onClick={() => { void onRestore() }}
          >
            <UploadIcon size={13} /> {restoring ? '正在恢复…' : '覆盖恢复'}
          </button>
        </div>
        <div className={css.backupHint}>
          密码不对、包损坏、版本不支持这三种情况会分别提示，按提示换一份包或重新输入即可。
        </div>
      </div>

      <div className={css.backupHint} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShieldIcon size={13} />
        备份包在本机生成，口令不会离开这台机器。
      </div>
    </div>
  )
}
