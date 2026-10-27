/**
 * 工作台同步面板基础单色 SVG 图标集合（遵循整体 UI 规范，无彩色 Emoji）。
 */

import React from 'react'

export interface IconProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

const baseProps = (size = 14) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

/** 云端同步（带双向刷新箭头的云朵） */
export function CloudSyncIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="m11 13 2-2 2 2" />
      <path d="M13 11v6" />
    </svg>
  )
}

/** 向上上传云/箭头 */
export function UploadIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

/** 向下同步下载云/箭头 */
export function DownloadIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

/** 齿轮（设置） */
export function GearIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** 时钟 */
export function ClockIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

/** 刷新 */
export function RefreshIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

/** 外链小箭头 */
export function ExternalLinkIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

/** 成功勾选圆圈 */
export function CheckCircleIcon({ size, className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
