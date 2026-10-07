/**
 * PersonaCard.tsx — 灵魂页左列「人格核心卡」（效果图 Editorial Split 的左半）。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────
 * 效果图定稿的灵魂页左列是一枚竖排核心卡：会动的大鲸鱼 + 名字 + 一句话
 * 定位 + 四行铭牌。这些数据 SoulPanel 手里都有（soul.identity / soul.content /
 * 卡片统计），但 SoulPanel 已经 1200 行，再塞一段展示 JSX 会让它的 body
 * 更难读；抽成纯展示组件（props 进、JSX 出，零状态零请求）最干净。
 *
 * ── 取舍 ─────────────────────────────────────────────────────────────
 * 1. quote 取正文第一条非空非标题行：那是人设的「第一句话」，比整段正文
 *    更适合当核心卡的一句话定位；取不到就回落 identity.tone。
 * 2. 铭牌四行走真字段：语气 / 语言 / 准则条数 / 卡片启用数。效果图里的
 *    「边界」在数据模型里没有独立字段（边界是卡片的一种 kind），不造假数据，
 *    换成真实存在的「卡片」统计。
 * 3. 鲸鱼复用 WhaleLogo（呼吸/流光/摆尾全在它那侧），这里只给尺寸。
 * 4. 样式全在 hub/theme.ts 的 .wb2-persona-*（跟工作台主题一起管深浅同步），
 *    本文件不注入任何 CSS。
 */

import type { CSSProperties } from 'react'
import type { SoulView } from './api.js'
import { WhaleLogo } from './WhaleLogo.js'

export interface SoulPersonaCardProps {
  soul: SoulView
  /** 已启用卡片数 / 卡片总数（右列 Bento 的统计，铭牌第四行用）。 */
  cardsOn: number
  cardsTotal: number
}

/** 取正文第一条「非空且非 markdown 标题/列表符号」的行当一句话定位。 */
function firstMeaningfulLine(content: string): string {
  const lines = content.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#')) continue
    if (line.startsWith('-') || line.startsWith('*')) continue
    return line
  }
  return ''
}

export function SoulPersonaCard({ soul, cardsOn, cardsTotal }: SoulPersonaCardProps): JSX.Element {
  const identity = soul.identity
  const quote = firstMeaningfulLine(soul.content) || identity.tone
  const plates: ReadonlyArray<readonly [string, string]> = [
    ['语气', identity.tone === '' ? '—' : identity.tone],
    ['语言', identity.language === '' ? '—' : identity.language],
    ['准则', identity.principles.length === 0 ? '—' : `${String(identity.principles.length)} 条 · 事实优先`],
    ['卡片', cardsTotal === 0 ? '—' : `${String(cardsOn)} / ${String(cardsTotal)} 启用中`],
  ]
  return (
    <aside className="wb2-persona wb2-rise" style={{ '--d': '60ms' } as CSSProperties}>
      <WhaleLogo size={96} />
      <h2 className="wb2-persona-name">{identity.name === '' ? '未命名' : identity.name}</h2>
      <p className="wb2-persona-role">{identity.role === '' ? '尚未填写角色' : identity.role}</p>
      <p className="wb2-persona-quote">{quote === '' ? '还没有写人设正文，去右列卡片或深改区落第一笔。' : quote}</p>
      <div className="wb2-persona-plates">
        {plates.map(([key, value]) => (
          <div className="wb2-persona-plate" key={key}>
            <span className="wb2-persona-plate-k">{key}</span>
            <span className="wb2-persona-plate-v" title={value}>{value}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
