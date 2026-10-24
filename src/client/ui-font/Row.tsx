/**
 * dsh-chat-plus — 「界面字体」设置行（官方「通用」设置页的一个偏好行）。
 *
 * 座位：`settings.general.item`（官方 `ui-settings-general` 的 General 入口声明）。
 * 与官方的「外观」「字号」两行同一列堆叠——这个槽位只堆行，行内全部内容
 * （标签、当前值、写入路径）由注册方自己负责，owner 不传任何 props。
 *
 * ## 版式逐字对齐官方 FontSizeRow
 *
 * 官方那一行的规格（`ui-theme` 内联的 FontSizeRow.module.css）：
 *   .row      flex / align-items:center / gap:8 / padding:16px 0 / border-bottom .5px border-l2
 *   .rowText  flex:1 / column / gap:4 / padding-right:48px
 *   .title    14px/22px 400 label-primary
 *   .desc     12px/18px 400 label-tertiary
 *
 * 直接复刻这套 token 而不是 require 官方组件：官方 CSS Modules 由各自的 bundle
 * 注入，插件渲染其组件时样式表未必就位（实测查不到规则），会出现「结构对、外观裸」。
 *
 * ## 为什么下拉框旁边要显示体积与状态
 *
 * 霞鹜新致宋是 4.2MB 的 webfont：首次切换要真下载。不告诉用户就会变成
 * 「点了没反应」（其实在下 4MB）。所以切换中显示「加载中」，失败显示
 * 「加载失败，已回退系统字体」——失败必须可见，否则用户只会觉得字体坏了。
 */
import { useSyncExternalStore } from 'react'
import { FONT_OPTIONS, FONT_SELECT_STYLE } from './font.js'
import { getSnapshot, setFont, subscribe } from './store.js'

/** 行外壳：官方 .row 规格。 */
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '16px 0',
  borderBottom: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))',
} as const

/** 文本列：官方 .rowText 规格。 */
const textStyle = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  gap: 4,
  minWidth: 0,
  paddingRight: 48,
} as const

/** 标题：官方 .title 规格。 */
const titleStyle = {
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 14,
  fontWeight: 400,
  lineHeight: '22px',
} as const

/** 说明：官方 .desc 规格。 */
const descStyle = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  fontWeight: 400,
  lineHeight: '18px',
} as const

/** 控制列：官方 .control 规格。 */
const controlStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
} as const

/**
 * 状态徽标（加载中 / 失败）。
 *
 * 返回类型写 `JSX.Element | null` 而不是 `unknown`：`unknown` 会让 TS 拒绝把它
 * 当 JSX 组件使用（TS2786），而这里确实要嵌进元素树里。
 */
function StatusBadge({ load, sizeLabel }: { load: string; sizeLabel: string }): JSX.Element | null {
  if (load === 'loading') {
    return (
      <span style={{ ...descStyle, whiteSpace: 'nowrap' }} role="status">
        加载中 {sizeLabel}
      </span>
    )
  }
  if (load === 'failed') {
    return (
      <span
        style={{ ...descStyle, color: 'var(--dsw-alias-state-error-primary, #d54941)', whiteSpace: 'nowrap' }}
        role="status"
      >
        加载失败，已回退系统字体
      </span>
    )
  }
  return null
}

/**
 * 渲染「界面字体」偏好行。
 *
 * `inject` 面按官方契约传入（`settings.general.item` 的注册要求组件收一个
 * inject 面）。本行的写入路径走模块内单例 store（`setFont`），不经过 inject，
 * 所以这里只把它当可选参数忽略——但**不能**因此省掉注册时的 `inject` 声明，
 * 否则类型与运行时契约都对不上。
 * @param props - 槽位注入面（本行不使用）。
 * @returns 设置行元素树。
 */
export function UiFontRow(_props: { setFont?: (id: string) => void } = {}): JSX.Element {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { option } = state
  const sizeLabel = option.webfont?.sizeLabel ?? ''
  return (
    <div style={rowStyle} data-ui-font-row="true">
      <div style={textStyle}>
        <div style={titleStyle}>界面字体</div>
        <div style={descStyle}>应用到整个 DSH 界面与对话正文</div>
      </div>
      <div style={controlStyle}>
        <StatusBadge load={state.load} sizeLabel={sizeLabel} />
        <select
          style={{ ...FONT_SELECT_STYLE, width: 160, flex: 'none' }}
          value={state.id}
          aria-label="界面字体"
          onChange={(event) => { setFont(event.target.value) }}
        >
          {FONT_OPTIONS.map(item => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
