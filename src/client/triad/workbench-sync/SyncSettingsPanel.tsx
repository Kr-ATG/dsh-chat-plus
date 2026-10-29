/**
 * 工作台「同步设置」一级面板组件。
 *
 * 视觉对齐系统提示词面板（SystemPromptPanel）：
 *   · 全面去除 Emoji 图标，统一换用基础单色 SVG 图标
 *   · 统一采用 --dsw-alias-* 与 --ds-font-family-code 规范变量
 *   · 支持双向自动同步与区分主次的滑块分段控制（本地为主 / 智能双向 / 云端为主）
 *   · 页头 eyebrow + 大标题 + em 辅助词 + 一句定位 + 右侧操作区
 *   · 规模数字采用 1px 细线切割方块栅格（等宽 tabular-nums）
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { SyncPriority, SyncProgress, WorkbenchSyncPublic } from '../../../triad/workbench-sync/types.js'
import {
  fetchSyncProgress,
  fetchSyncStatus,
  saveSyncSettings,
  triggerSyncPull,
  triggerSyncUpload,
} from './api.js'
import {
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GearIcon,
  RefreshIcon,
  UploadIcon,
} from './icons.js'
import { emitSyncNotice } from '../hub/sync-notice.js'
import { ensureSyncStyles, syncCss } from './styles.js'
import { SyncProgressCard } from './SyncProgressCard.js'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatStamp(iso?: string): string {
  if (!iso) return '尚未进行'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '未知'
    const now = new Date()
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 3600)
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diffHours < 24 && d.getDate() === now.getDate()) {
      return `今天 ${timeStr}`
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${timeStr}`
  } catch {
    return iso
  }
}

export interface SyncSettingsPanelProps {
  onClose?: () => void
  embedded?: boolean
}

export function SyncSettingsPanel({ onClose }: SyncSettingsPanelProps): JSX.Element {
  ensureSyncStyles()

  const [status, setStatus] = useState<WorkbenchSyncPublic | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [running, setRunning] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // 表单输入
  const [repo, setRepo] = useState<string>('')
  const [passphrase, setPassphrase] = useState<string>('')
  const [showPassphrase, setShowPassphrase] = useState<boolean>(false)
  const [token, setToken] = useState<string>('')
  const [autoSync, setAutoSync] = useState<boolean>(true)
  const [syncPriority, setSyncPriority] = useState<SyncPriority>('balanced')
  const [everyHours, setEveryHours] = useState<number>(5)
  const [includeVault, setIncludeVault] = useState<boolean>(true)
  const [includeMemory, setIncludeMemory] = useState<boolean>(true)
  const [includeSkills, setIncludeSkills] = useState<boolean>(true)

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const s = await fetchSyncStatus()
      setStatus(s)
      setRepo(s.repoInput || s.repo || '')
      setAutoSync(s.autoSync ?? true)
      setSyncPriority(s.syncPriority ?? 'balanced')
      setEveryHours(s.everyHours ?? 5)
      setIncludeVault(s.includeVault)
      setIncludeMemory(s.includeMemory)
      setIncludeSkills(s.includeSkills)
      if (s.progress) setProgress(s.progress)
      setRunning(s.running)
    } catch (err) {
      setMsg({ text: `读取同步状态失败: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [loadData])

  const startProgressPolling = (): void => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    pollTimerRef.current = setInterval(async () => {
      try {
        const { progress: p, running: isRun } = await fetchSyncProgress()
        if (p) setProgress(p)
        setRunning(isRun)
        if (!isRun) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
          pollTimerRef.current = null
          loadData()
        }
      } catch {}
    }, 800)
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setMsg(null)
    try {
      const updated = await saveSyncSettings({
        repo,
        passphrase: passphrase.trim() !== '' ? passphrase : undefined,
        token: token.trim() !== '' ? token : undefined,
        autoSync,
        autoUpload: autoSync,
        syncPriority,
        everyHours,
        includeVault,
        includeMemory,
        includeSkills,
      })
      setStatus(updated)
      setPassphrase('')
      setToken('')
      setMsg({ text: '设置已成功保存！凭据已在端侧完成硬件密钥加密落盘。', type: 'success' })
    } catch (err) {
      setMsg({ text: `保存设置失败: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleUploadNow = async (): Promise<void> => {
    setRunning(true)
    setMsg(null)
    startProgressPolling()
    try {
      const res = await triggerSyncUpload()
      setStatus(res.status)
      if (res.run.status === 'skipped') {
        setMsg({ text: '数据未发生变更，云端私库已是最新。', type: 'success' })
        emitSyncNotice('已是最新')
      } else {
        setMsg({ text: '工作台资产已成功加密备份并上传至 GitHub 私库！', type: 'success' })
        emitSyncNotice('已上传')
      }
    } catch (err) {
      setMsg({ text: `备份上传失败: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
    }
  }

  const handlePullNow = async (): Promise<void> => {
    setRunning(true)
    setMsg(null)
    startProgressPolling()
    try {
      const res = await triggerSyncPull()
      setStatus(res.status)
      setMsg({ text: '从云端私库一键同步恢复成功！工作台数据已更新生效。', type: 'success' })
      emitSyncNotice('已同步')
    } catch (err) {
      setMsg({ text: `同步恢复失败: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
    }
  }

  if (loading) {
    return (
      <div className={syncCss.root}>
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--dsw-alias-label-tertiary,#888)', fontSize: '13px' }}>
          正在读取同步状态与资产规模…
        </div>
      </div>
    )
  }

  const canOperate = Boolean(status?.repo && status?.passphraseSet && status?.tokenSet) && !running

  return (
    <div className={syncCss.root}>
      {/* 页头：eyebrow + 标题 + 定位说明 + 右侧核心操作 */}
      <header className={syncCss.head}>
        <div className={syncCss.headMain}>
          <span className={syncCss.eyebrow}><i />Workbench Sync</span>
          <h1 className={syncCss.title}>同步设置 <em>/ 工作台资产双向漫游</em></h1>
          <p className={syncCss.hint}>
            将档案（账号密码与证件）、长期记忆库、自定义技能与 MCP 配置进行端侧加盐强加密后推送到您的 GitHub 私库，实现跨机一键漫游。
          </p>
        </div>
        <div className={syncCss.headActions}>
          <button
            type="button"
            className={`${syncCss.btn} ${syncCss.btnPrimary}`}
            onClick={handlePullNow}
            disabled={!canOperate}
            title={canOperate ? '从 GitHub 私库流式下载最新备份包并解密恢复' : '请先在下方配置私库与口令'}
          >
            <DownloadIcon size={13} />
            <span>一键同步下来</span>
          </button>
          <button
            type="button"
            className={`${syncCss.btn} ${syncCss.btnSuccess}`}
            onClick={handleUploadNow}
            disabled={!canOperate}
            title={canOperate ? '扫描本地工作台资产并打包加密推送到私库' : '请先在下方配置私库与口令'}
          >
            <UploadIcon size={13} />
            <span>立即备份上传</span>
          </button>
          <button
            type="button"
            className={syncCss.btn}
            onClick={() => { loadData() }}
            title="重新获取云端与本地状态"
          >
            <RefreshIcon size={12} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      {/* 滚动主体区 */}
      <div className={syncCss.scroll}>
        {/* 四格数据规模大盘（1px 细线切割方块栅格，对齐 system-prompt） */}
        <div className={syncCss.stats}>
          <div className={syncCss.stat}>
            <span className={syncCss.statLabel}>上次上传时间</span>
            <span className={syncCss.statValue}>{formatStamp(status?.lastUploadedAt)}</span>
            <span className={syncCss.statSub}>
              {status?.lastUploadedCommit ? `提交 ${status.lastUploadedCommit.slice(0, 7)} · 包大小 ${formatBytes(status.lastUploadedBytes)}` : '尚未向云端提交'}
            </span>
          </div>

          <div className={syncCss.stat}>
            <span className={syncCss.statLabel}>上次同步时间</span>
            <span className={syncCss.statValue}>{formatStamp(status?.lastPulledAt)}</span>
            <span className={syncCss.statSub}>
              {status?.lastPulledCommit ? `云端基线 ${status.lastPulledCommit.slice(0, 7)}` : '尚未从云端拉取'}
            </span>
          </div>

          <div className={syncCss.stat}>
            <span className={syncCss.statLabel}>本地数据总体积</span>
            <span className={syncCss.statValue}>{formatBytes(status?.localTotalBytes ?? 0)}</span>
            <span className={syncCss.statSub}>
              档案 {formatBytes(status?.localVaultBytes ?? 0)} · 记忆 {formatBytes(status?.localMemoryBytes ?? 0)}
            </span>
          </div>

          <div className={syncCss.stat}>
            <span className={syncCss.statLabel}>技能与配置规模</span>
            <span className={syncCss.statValue}>{formatBytes(status?.localSkillsBytes ?? 0)}</span>
            <span className={syncCss.statSub}>
              自定义技能包与 MCP 开关
            </span>
          </div>
        </div>

        {/* 动态同步进度卡片（操作执行中或完成时展开） */}
        {(progress || running) && (
          <SyncProgressCard
            progress={progress}
            running={running}
            onDismiss={() => { setProgress(null) }}
          />
        )}

        {/* 提示条（操作反馈） */}
        {msg && (
          <div className={msg.type === 'success' ? syncCss.notice : syncCss.progressError}>
            <span className={syncCss.noticeText}>{msg.text}</span>
          </div>
        )}

        {/* 隐私安全内敛提示 */}
        <div className={syncCss.notice}>
          <span className={syncCss.noticeText}>
            <b>安全与隐私承诺：</b>本插件已剔除系统提示词与环境配置，源码 100% 公开透明。插件中绝对不会出现您的私库名、口令或令牌，所有凭据均采用硬件级密钥落盘于本地，离开本机的所有数据均经 scrypt 派生的高强度 AES-256-GCM 加密。
          </span>
        </div>

        {/* 配置区块 1：云端私库与安全口令 */}
        <div className={syncCss.section}>
          <div className={syncCss.sectionTitle}>
            <GearIcon size={14} />
            <span>云端私库与安全口令</span>
          </div>

          <div className={syncCss.field}>
            <div className={syncCss.fieldHead}>
              <label className={syncCss.fieldLabel}>GitHub 私有仓库地址</label>
              {status?.repoUrl && (
                <a
                  href={status.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: '12px',
                    color: 'var(--wb2-accent,#C3CEDF)',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>打开私库</span>
                  <ExternalLinkIcon size={11} />
                </a>
              )}
            </div>
            <input
              className={syncCss.input}
              value={repo}
              onChange={(e) => { setRepo(e.target.value) }}
              placeholder="例如: 用户名/仓库名 或 https://github.com/用户名/仓库名"
            />
            <span className={syncCss.fieldHint}>
              请提供您自己的 GitHub 私库（必须是 Private Repo，公开仓库将被系统自动拒签阻止上传）。
            </span>
          </div>

          <div className={syncCss.field}>
            <div className={syncCss.fieldHead}>
              <label className={syncCss.fieldLabel}>同步主口令</label>
              <span className={syncCss.fieldStatus}>
                {status?.passphraseSet ? (
                  <span style={{ color: '#10b981' }}>✓ 已就绪（若不修改请留空）</span>
                ) : (
                  <span style={{ color: '#f59e0b' }}>未设置（至少 8 位）</span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type={showPassphrase ? 'text' : 'password'}
                className={syncCss.input}
                style={{ flex: 1 }}
                value={passphrase}
                onChange={(e) => { setPassphrase(e.target.value) }}
                placeholder={status?.passphraseSet ? '留空表示保持当前口令' : '设置一个同步主口令（至少 8 位，务必牢记）'}
              />
              <button
                type="button"
                className={syncCss.btn}
                onClick={() => { setShowPassphrase(!showPassphrase) }}
              >
                {showPassphrase ? '隐藏' : '显示'}
              </button>
            </div>
            <span className={syncCss.fieldHint}>
              备份包在离开本机前全部采用此口令进行 AES-256-GCM 端侧强加密，换机或恢复时需输入此口令解密。
            </span>
          </div>

          <div className={syncCss.field}>
            <div className={syncCss.fieldHead}>
              <label className={syncCss.fieldLabel}>GitHub 访问令牌（PAT）</label>
              <span className={syncCss.fieldStatus}>
                {status?.tokenSource === 'gh' && (
                  <span style={{ color: 'var(--wb2-accent,#C3CEDF)' }}>✓ 已安全复用本机 gh 登录凭据（…{status.tokenTail}）</span>
                )}
                {status?.tokenSource === 'stored' && (
                  <span style={{ color: '#10b981' }}>✓ 已配置自定义令牌（…{status.tokenTail}）</span>
                )}
                {status?.tokenSource === 'none' && (
                  <span style={{ color: '#f59e0b' }}>未检测到令牌</span>
                )}
              </span>
            </div>
            <input
              type="password"
              className={syncCss.input}
              value={token}
              onChange={(e) => { setToken(e.target.value) }}
              placeholder={status?.tokenSet ? '留空表示保持现有令牌' : 'ghp_… / github_pat_…（需 Contents 读写权限）'}
            />
            <span className={syncCss.fieldHint}>
              若本机已通过 GitHub CLI 登录（<code>gh auth login</code>），系统会自动无缝复用；也可手动填入 PAT。
            </span>
          </div>
        </div>

        {/* 配置区块 2：自动化与计划 + 主次滑块 */}
        <div className={syncCss.section}>
          <div className={syncCss.sectionTitle}>
            <ClockIcon size={14} />
            <span>自动同步策略与资产范围</span>
          </div>

          {/* 自动同步总开关与周期 */}
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className={syncCss.checkboxRow}>
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => { setAutoSync(e.target.checked) }}
              />
              <span>开启自动双向同步</span>
            </label>

            {autoSync && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary,#b9b9b9)' }}>检查周期:</span>
                <select
                  className={syncCss.select}
                  value={everyHours}
                  onChange={(e) => { setEveryHours(Number(e.target.value)) }}
                >
                  <option value={1}>每 1 小时</option>
                  <option value={2}>每 2 小时</option>
                  <option value={5}>每 5 小时（推荐）</option>
                  <option value={12}>每 12 小时</option>
                  <option value={24}>每 24 小时</option>
                </select>
                {status?.nextSyncAt && (
                  <span style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary,#888)' }}>
                    下次约 {formatStamp(status.nextSyncAt)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 主次区分滑块选项（Segmented Slider Track） */}
          <div className="dsh-sync-slider-box">
            <div className="dsh-sync-slider-head">
              <span className="dsh-sync-slider-title">主次同步优先级（覆盖倾斜）</span>
              <span style={{ fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary,#888)' }}>
                {syncPriority === 'local' && '主力机模式'}
                {syncPriority === 'balanced' && '智能双向模式'}
                {syncPriority === 'cloud' && '云端受控从机模式'}
              </span>
            </div>

            {/* 三档滑块分段器 */}
            <div className="dsh-sync-segmented" role="radiogroup" aria-label="主次同步优先级">
              <button
                type="button"
                className="dsh-sync-seg-item"
                data-active={syncPriority === 'cloud' ? 'true' : 'false'}
                onClick={() => { setSyncPriority('cloud') }}
              >
                <span>云端为主 (从机)</span>
              </button>
              <button
                type="button"
                className="dsh-sync-seg-item"
                data-active={syncPriority === 'balanced' ? 'true' : 'false'}
                onClick={() => { setSyncPriority('balanced') }}
              >
                <span>智能双向 (平衡)</span>
              </button>
              <button
                type="button"
                className="dsh-sync-seg-item"
                data-active={syncPriority === 'local' ? 'true' : 'false'}
                onClick={() => { setSyncPriority('local') }}
              >
                <span>本地为主 (主机)</span>
              </button>
            </div>

            {/* 动态说明 */}
            <div className="dsh-sync-slider-desc">
              {syncPriority === 'local' && (
                <span>💻 <b>本地为主：</b>以本台设备的数据为最高权威。当本地资产发生变动时优先同步上传至私库，防止云端旧数据覆盖。推荐主力机使用。</span>
              )}
              {syncPriority === 'balanced' && (
                <span>⚖️ <b>智能双向：</b>自动比对本地指纹与云端最新 Commit，感知两端变动进行智能双向漫游。推荐日常单人多设备使用。</span>
              )}
              {syncPriority === 'cloud' && (
                <span>☁️ <b>云端为主：</b>以云端私库为唯一真相源。当检测到云端有新提交时，自动拉取并覆盖恢复本地。推荐备用机、从属机使用。</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap', paddingTop: '4px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 550, color: 'var(--dsw-alias-label-secondary,#b9b9b9)' }}>
              同步范围:
            </span>
            <label className={syncCss.checkboxRow}>
              <input
                type="checkbox"
                checked={includeVault}
                onChange={(e) => { setIncludeVault(e.target.checked) }}
              />
              <span>档案数据</span>
            </label>
            <label className={syncCss.checkboxRow}>
              <input
                type="checkbox"
                checked={includeMemory}
                onChange={(e) => { setIncludeMemory(e.target.checked) }}
              />
              <span>长期记忆</span>
            </label>
            <label className={syncCss.checkboxRow}>
              <input
                type="checkbox"
                checked={includeSkills}
                onChange={(e) => { setIncludeSkills(e.target.checked) }}
              />
              <span>技能与 MCP 开关</span>
            </label>
          </div>

          <div style={{ paddingTop: '8px' }}>
            <button
              type="button"
              className={`${syncCss.btn} ${syncCss.btnPrimary}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '正在保存…' : '保存配置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
