/**
 * dsh-vault 图标集（纯展示组件，零业务依赖）。
 *
 * 分两类：
 *   · 场景图标 —— 每个内置场景一个（账号密码 / 邮箱 / 支付 / 联系方式 / 证件 /
 *     其它），另有兜底图标给用户自建场景。场景 id 是稳定值（见 types.ts 的
 *     DEFAULT_SCENES），所以这里按 id 索引即可，不需要把图标挂到数据里——
 *     图标是界面的事，不该跟着数据落盘。
 *   · 界面图标 —— 搜索 / 加号 / 眼睛 / 关闭 / 删除 / 相机 / 外链 / 箭头等等。
 *
 * 全部 24×24 viewBox + currentColor：颜色由父级决定，于是明暗主题自动跟随，
 * 这里一个颜色都不写死。线宽分两档（1.7 场景 / 1.6 界面），视觉重量对齐。
 */

import type { JSX } from 'react'

/** 图标组件的统一形状。 */
export interface VaultIconProps {
  size?: number
  className?: string
}

/* ───────────────────────── 场景图标 ───────────────────────── */

/** 账号密码：钥匙。 */
export function SceneAccountsIcon({ size = 16, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 19 4" />
      <path d="M18 5l2 2" />
      <path d="M15 8l2 2" />
    </svg>
  )
}

/** 邮箱与登录：信封。 */
export function SceneMailIcon({ size = 16, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3 6.5l8.4 6a1 1 0 0 0 1.2 0L21 6.5" />
    </svg>
  )
}

/** 支付方式：卡片。 */
export function ScenePaymentIcon({ size = 16, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6 15h3.5" />
    </svg>
  )
}

/** 联系方式：电话。 */
export function SceneContactIcon({ size = 16, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.2 3.5h2.3l1.6 4-2 1.4a12.5 12.5 0 0 0 5.5 5.5l1.4-2 4 1.6v2.3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.2 5.7a2 2 0 0 1 2-2.2Z" />
    </svg>
  )
}

/** 证件：一张带照片的卡。 */
export function SceneDocumentIcon({ size = 16, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.4 16.2a3.4 3.4 0 0 1 6.2 0" />
      <path d="M14.5 10h4" />
      <path d="M14.5 13.5h4" />
    </svg>
  )
}

/** 其它：文件夹（兜底场景）。 */
export function SceneOtherIcon({ size = 16, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5a2 2 0 0 1 2-2h3.6l1.8 2H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

/**
 * 按场景 id 取图标。
 *
 * 认不出的 id（用户自建的场景）回落到「其它」的文件夹，绝不返回 null ——
 * 少一个图标的行会比别的行矮一截，反而更像渲染错误。
 */
export function sceneIconOf(sceneId: string): (props: VaultIconProps) => JSX.Element {
  switch (sceneId) {
    case 'accounts': return SceneAccountsIcon
    case 'email': return SceneMailIcon
    case 'payment': return ScenePaymentIcon
    case 'contact': return SceneContactIcon
    case 'document': return SceneDocumentIcon
    default: return SceneOtherIcon
  }
}

/* ───────────────────────── 界面图标 ───────────────────────── */

/** 搜索。 */
export function SearchIcon({ size = 15, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4 21 21" />
    </svg>
  )
}

/** 加号（卡头「加一条」/ 小节「加字段」）。 */
export function PlusIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

/** 眼睛（显示敏感值）。 */
export function EyeIcon({ size = 15, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** 眼睛划掉（隐藏敏感值）。 */
export function EyeOffIcon({ size = 15, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.2" />
      <path d="M6.5 7.8A17 17 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3.5 3.5 20.5 20.5" />
    </svg>
  )
}

/** 关闭。 */
export function CloseIcon({ size = 15, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M5.5 5.5 18.5 18.5" />
      <path d="M18.5 5.5 5.5 18.5" />
    </svg>
  )
}

/** 行尾箭头。 */
export function ChevronRightIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  )
}

/** 删除（垃圾桶）。 */
export function TrashIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L18 7" />
      <path d="M10.5 11v5.5" />
      <path d="M13.5 11v5.5" />
    </svg>
  )
}

/** 相机（上传照片）。 */
export function CameraIcon({ size = 15, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-1.7c.3-.5.8-.8 1.4-.8h4.4c.6 0 1.1.3 1.4.8L16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
      <circle cx="12" cy="12.4" r="3.4" />
    </svg>
  )
}

/** 归档（箱子封条）。 */
export function ArchiveIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="4.5" rx="1.2" />
      <path d="M4.8 9v9.2A1.8 1.8 0 0 0 6.6 20h10.8a1.8 1.8 0 0 0 1.8-1.8V9" />
      <path d="M10 13h4" />
    </svg>
  )
}

/** 普通记录占位（列表行图标，非场景图标时用）。 */
export function RecordIcon({ size = 15, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
      <path d="M8.5 8.5h7" />
      <path d="M8.5 12.5h7" />
      <path d="M8.5 16.5h4" />
    </svg>
  )
}

/** 空态提示（虚线框里的文件 + 问号）。 */
export function EmptyIcon({ size = 16, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4.5h9.5L19 9v10.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5Z" />
      <path d="M14 4.5V9h4.5" />
      <path d="M9.3 14.6a2 2 0 1 1 2.7 1.9v1" />
      <path d="M12 19.4v.2" />
    </svg>
  )
}

/** 提示（错误行里的小三角感叹号）。 */
export function AlertIcon({ size = 15, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 21.5 20H2.5Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.2v.2" />
    </svg>
  )
}

/** 重试（环形箭头）。 */
export function RefreshIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  )
}

/** 健康检查（盾牌 + 勾）。 */
export function ShieldIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 20 6v6.2c0 4.2-3.2 7.4-8 8.8-4.8-1.4-8-4.6-8-8.8V6Z" />
      <path d="M8.6 12.2 11 14.6l4.4-4.6" />
    </svg>
  )
}

/** 密钥（备份与恢复）。 */
export function KeyIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="12" r="3.5" />
      <path d="M11 12h9.5" />
      <path d="M17.5 12v3.2" />
      <path d="M20.5 12v2.2" />
    </svg>
  )
}

/** 下载（导出备份）。 */
export function DownloadIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 18.5h15" />
    </svg>
  )
}

/** 上传（导入备份）。 */
export function UploadIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15.5v-11" />
      <path d="M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 18.5h15" />
    </svg>
  )
}

/** 时钟（验证码倒计时）。 */
export function ClockIcon({ size = 13, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

/**
 * 云（云端备份 / GitHub 私库自动上传）。
 *
 * 为什么是云而不是 GitHub 的章鱼猫：这个功能对用户的意义是「传到别人看不见的
 * 地方去」，仓库服务只是实现手段（将来换 GitLab 也不该换图标）。而且 GitHub
 * 官方 mark 的授权条款对「用作品牌标识」有额外要求，用通用云朵更省心。
 */
export function CloudIcon({ size = 14, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 18.5h9.2a3.8 3.8 0 0 0 .5-7.57 5.5 5.5 0 0 0-10.62-1.3A3.9 3.9 0 0 0 7.5 18.5Z" />
      <path d="M12 14.6V9.6" />
      <path d="M9.9 11.7 12 9.6l2.1 2.1" />
    </svg>
  )
}

/** 复制到剪贴板。 */
export function CopyIcon({ size = 13, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
      <path d="M15.5 5.5H6.7A2.2 2.2 0 0 0 4.5 7.7v8.8" />
    </svg>
  )
}

/** 外链（导出 / 打开站点）。 */
export function ExternalIcon({ size = 13, className }: VaultIconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 4.5H19.5V10.5" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4" />
    </svg>
  )
}
