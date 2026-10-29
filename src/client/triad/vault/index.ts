/**
 * dsh-chat-plus — 档案（vault）客户端半身的模块出口。
 *
 * 这个文件是**给挂载器用的门面**，本身不含逻辑：
 *   · Panel  —— 整页面板（props 与记忆 / 技能面板同形：onClose + embedded）；
 *   · api   —— 所有 HTTP 包装与场景意图通道（侧栏二级菜单也走这里）；
 *   · icons —— 场景图标（侧栏菜单行与页内分组卡共用同一枚，避免两处各画一套）。
 *
 * 为什么单独留一个 index：lead 在 nav-sections.tsx 里只 import 一行就够了，
 * 不必知道内部拆了几个文件。将来把 DetailDrawer / PhotoGrid 合并或再拆，
 * 调用方不受影响。
 */

export { VaultPanel } from './Panel.js'
export type { VaultPanelProps } from './Panel.js'

export {
  // 数据面
  listVault,
  saveVaultRecord,
  patchVaultField,
  deleteVaultRecord,
  archiveVaultRecord,
  revealVaultField,
  saveVaultScene,
  deleteVaultScene,
  uploadVaultPhoto,
  deleteVaultPhoto,
  maintainVault,
  importVaultData,
  getVaultConfig,
  setVaultConfig,
  getVaultStats,
  searchVaultRecords,
  listVaultAudit,
  // 到期提醒 / 密钥备份 / 验证码
  fetchVaultReminders,
  formatReminderDays,
  fetchVaultKeyInfo,
  downloadVaultBackup,
  restoreVaultBackup,
  fetchVaultTotp,
  isTotpField,
  // 强口令生成
  generateVaultPassword,
  isPasswordSecretField,
  describeEntropy,
  // URL / 压缩 / 展示
  vaultImageUrl,
  vaultExportUrl,
  compressOptionsOf,
  compressPhotoVariants,
  vaultRowSummary,
  formatVaultBytes,
  formatVaultTime,
  formatVaultStamp,
  SECRET_DOTS,
  VAULT_API_BASE,
  // 侧栏二级菜单（写作用域只在 vault 目录内，nav-sections 的注册由 lead 做）
  fetchVaultSceneChildren,
  requestVaultScene,
  readVaultScene,
  clearVaultScene,
  subscribeVaultScene,
  VAULT_SCENE_EVENT,
  VAULT_SCENE_STORE,
} from './api.js'

export type {
  VaultListResponse,
  VaultRecordResponse,
  VaultSceneResponse,
  VaultMaintenanceResult,
  VaultRecordDraft,
  VaultPhotoVariantPayload,
  VaultAuditEntry,
  VaultCompressOptions,
  VaultReminder,
  VaultReminderReport,
  VaultKeyInfo,
  VaultRestoreResult,
  VaultTotpCode,
  VaultPasswordOptions,
  VaultGeneratedPassword,
} from './api.js'

export { ensureVaultStyles, css as vaultCss } from './styles.js'
export { sceneIconOf, SceneAccountsIcon, SceneDocumentIcon } from './icons.js'

// 子视图。VaultReminderWindow / VaultBackupPanel 由 Panel 内部挂进 VaultModal，
// 这里一并导出是为了让将来别处（例如侧栏入口直接开提醒）能复用同一份实现，
// 而不是各自再写一个「点开就是提醒」的弹窗。
export { VaultModal } from './Shell.js'
export type { VaultModalProps } from './Shell.js'
export { VaultReminderWindow } from './ReminderWindow.js'
export type { VaultReminderWindowProps } from './ReminderWindow.js'
export { VaultBackupPanel } from './BackupPanel.js'
export type { VaultBackupPanelProps } from './BackupPanel.js'
export { VaultTotpBox } from './TotpBox.js'
export type { VaultTotpBoxProps } from './TotpBox.js'
export type { VaultIconProps } from './icons.js'
