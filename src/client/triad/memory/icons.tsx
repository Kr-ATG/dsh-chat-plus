/**
 * dsh-memory 面板图标集（纯展示组件，零业务依赖）。
 *
 * 从 Panel.tsx 抽出的原因：2420 行的主文件里塞了 24 个内联 SVG 组件（约 250 行），
 * 它们与业务逻辑零耦合，混在一起让「找某个视图的渲染逻辑」必须跳过一大段图标定义。
 * 抽出来之后 Panel.tsx 只关心状态与布局，图标改动也不必碰主文件。
 *
 * 全部图标：24×24 viewBox + stroke-width 2 + currentColor，颜色由父级决定，
 * 因此能在明暗主题下自动跟随（不要在这里写死颜色）。
 */
/**
 * 大脑/记忆图标（Lucide `brain`，MIT 开源，24 viewBox + stroke-width 2）。
 * 来源：https://lucide.dev/icons/brain
 */
export function BrainIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}

/** 置顶图标（线性 SVG）。 */
export function PinIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.8 2.2 13.8 6.2l-2.3.7-2.4 2.4-.7 2.3-1.6-1.6-2.7 2.7-1-1 2.7-2.7-1.6-1.6 2.3-.7 2.4-2.4.7-2.3Z" />
    </svg>
  )
}

/** 分类/记忆容器方块（左栏品牌与「全部」项）。 */
export function BoxIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3" />
      <path d="M6.2 8h3.6" />
    </svg>
  )
}

/** 首页（房子）。 */
export function HomeIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7 8 2.5 13.5 7" />
      <path d="M4 6.5V13.5h8V6.5" />
    </svg>
  )
}

/** 变更（时钟）。 */
export function ClockIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  )
}

/** 修订（时钟回卷）。 */
export function HistoryIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 8a5.2 5.2 0 1 1 1.5 3.7" />
      <path d="M2.6 5.2v2.6h2.6" />
      <path d="M8 5.4V8l2 1.2" />
    </svg>
  )
}

/** 回收站。 */
export function TrashIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 4.4h10.4" />
      <path d="M5.6 4.4V3a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v1.4" />
      <path d="M4.2 4.4l.6 8.2a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.2" />
      <path d="M6.6 7.2v3.6M9.4 7.2v3.6" />
    </svg>
  )
}

/** 板擦（lucide eraser 改 16 viewBox）——一键删今日记忆。 */
export function EraserIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 12.5h6" />
      <path d="M9.8 2.6 13.4 6.2a1.4 1.4 0 0 1 0 2L9.2 12.4H6.4L2.9 8.9a1.4 1.4 0 0 1 0-2l4.9-4.3a1.4 1.4 0 0 1 2 0Z" />
      <path d="M6.1 4.3 11.7 9.9" />
    </svg>
  )
}

/** 重要度（盾牌）。 */
export function ShieldIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 13 3.4v4.1c0 3-2 5.5-5 6.7-3-1.2-5-3.7-5-6.7V3.4L8 1.8Z" />
    </svg>
  )
}

/** 复制（两张卡片）。 */
export function CopyIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="8.4" height="8.4" rx="1.6" />
      <path d="M11 3.8A1.6 1.6 0 0 0 9.4 2.2H3.8A1.6 1.6 0 0 0 2.2 3.8v5.6A1.6 1.6 0 0 0 3.8 11" />
    </svg>
  )
}

/** 软废弃（圆环 + 斜杠）。 */
export function RingOffIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" />
      <path d="M4.1 4.1l7.8 7.8" />
    </svg>
  )
}

/** 灯泡（顶栏统计「今日变更」）。 */
export function LightbulbIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8a4 4 0 0 1 2.3 7.25c-.65.5-.9 1.05-.9 1.75h-2.8c0-.7-.25-1.25-.9-1.75A4 4 0 0 1 8 1.8Z" />
      <path d="M6.9 13.4h2.2M7.3 12.3h1.4" />
    </svg>
  )
}

/** 设置（齿轮）。 */
export function GearIcon({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    </svg>
  )
}

/** 排序箭头（↑↓）。 */
export function SortArrowsIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12.5V3.5M8 3.5 5.4 6.1M8 3.5l2.6 2.6" />
    </svg>
  )
}

/** 全局作用域（地球）。 */
export function GlobeIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.6 2.7 3.7 2.7 6S9.8 12.4 8 14C6.2 12.4 5.3 10.3 5.3 8S6.2 3.6 8 2Z" />
    </svg>
  )
}

/** 项目作用域（文件夹）。 */
export function FolderIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.6h4.8A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
    </svg>
  )
}

/** 分类标签（吊牌）。 */
export function TagIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 2h5l7 7-5 5-7-7V2Z" />
      <circle cx="5" cy="5" r="1" fill="currentColor" />
    </svg>
  )
}

/** 手动来源（铅笔）。 */
export function PenIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m11.5 2.5 2 2L6 12l-2.7.7L4 10l7.5-7.5Z" />
      <path d="m10 4 2 2" />
    </svg>
  )
}

/** 自动来源（闪光）。 */
export function SparkIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.2 9.3 6l3.8 1.3-3.8 1.3L8 12.4 6.7 8.6 2.9 7.3 6.7 6 8 2.2Z" />
      <path d="M12.8 11.4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z" />
    </svg>
  )
}

/** 长期沉淀（层叠）。 */
export function LayersIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 2.5 5.5 3L8 8.5l-5.5-3 5.5-3Z" />
      <path d="m2.5 8.5 5.5 3 5.5-3" />
      <path d="m2.5 11.5 5.5 3 5.5-3" />
    </svg>
  )
}

/** 已确认（对勾盾）。 */
export function VerifiedIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 13 3.4v4.1c0 3-2 5.5-5 6.7-3-1.2-5-3.7-5-6.7V3.4L8 1.8Z" />
      <path d="m5.8 7.8 1.6 1.6 3-3.2" />
    </svg>
  )
}

/** 多选勾（列表勾选框内）。 */
export function CheckMark({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

/** 电源（启用/禁用）。 */
export function PowerIcon({ size = 14, dim = false }: { size?: number; dim?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: dim ? 0.45 : undefined }} aria-hidden="true">
      <path d="M8 1.5v6" />
      <path d="M11.3 3.7a4.7 4.7 0 1 1-6.6 0" />
    </svg>
  )
}
