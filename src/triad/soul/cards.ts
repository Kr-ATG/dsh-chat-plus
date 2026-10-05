/**
 * dsh-chat-plus — Soul 卡片装配层：卡片集合 ⇄ 注入文本 / soul.md 全文 / 身份字段。
 *
 * 为什么把这一层单独抽出来、且**全是纯函数**：
 *   卡片是权威层，但它有四个不同的消费方——注入引擎（要带预算的紧凑文本）、
 *   soul.md 全文视图（要给人读的 markdown）、identity 四件套（面板表单要结构化
 *   字段）、预设应用（要按 kind 覆盖/追加）。四条路径各写一遍拼装逻辑，改一次
 *   段标题就要改四处，必然漂移。所以这里只做「输入卡片 → 输出某个视图」的纯计算，
 *   不碰磁盘、不碰 HTTP、不认识 SoulStore：读写与落盘全在 store.ts，测试也能
 *   直接拿这层做断言，不需要起临时数据根。
 *
 * 预算策略（刻意「丢整张卡」而不是截半张）：
 *   注入文本超预算时，从 order 最大的那张卡开始整张丢弃。截半张会得到「行为准则
 *   第 3 条写到一半」这种半句话——模型会把它当完整规则执行，比少一条规则更糟。
 *   丢整张至少语义自洽，而且用户能通过面板看到「这张卡没进上下文」。
 */

import {
  normalizeCard,
  normalizeCards,
  SOUL_CARD_SECTION_TITLES,
  sortCards,
  type SoulCard,
  type SoulCardKind,
  type SoulDraft,
  type SoulIdentity,
} from './types.js'

/**
 * 卡片装配的注入预算（字符）。
 *
 * 与 store.ts 的 SOUL_INJECT_BUDGET 同值但**刻意各存一份**：store 依赖 cards
 * （要调装配），cards 再反向 import store 的常量就成了循环导入，常量在模块
 * 初始化顺序上会撞 TDZ。store 调用时显式把它的常量传进来，两边天然对齐。
 */
export const CARDS_INJECT_BUDGET = 2000

/** 参与注入的卡片：enabled 且 body 非空，按 order 升序。 */
export function injectableCards(cards: SoulCard[]): SoulCard[] {
  return sortCards(cards).filter(card => card.enabled && card.body.trim() !== '')
}

/**
 * 卡片 → 注入文本（带 2000 字符硬预算）。
 *
 * 段标题走 SOUL_CARD_SECTION_TITLES（与面板分组同源），同 kind 多张卡各自成段，
 * 不合并——合并会把两张卡的标题吃掉一个，用户按标题找不到是哪张卡在生效。
 */
export function assembleInjection(cards: SoulCard[], budget = CARDS_INJECT_BUDGET): string {
  const sections = injectableCards(cards).map(card => sectionText(card))
  let kept = sections
  let text = kept.join('\n\n')
  // 超预算：从 order 最大的那张开始整张丢（见文件头说明）。
  while (text.length > budget && kept.length > 0) {
    kept = kept.slice(0, -1)
    text = kept.join('\n\n')
  }
  return text
}

/** 单张卡片的段落文本（段标题 + 正文）。 */
function sectionText(card: SoulCard): string {
  return `## ${SOUL_CARD_SECTION_TITLES[card.kind]}\n${card.body.trim()}`
}

/**
 * 卡片 → soul.md 全文视图（写入时同步回写，保证向后兼容）。
 *
 * 首行不写「默认模板」那句引导语：引导语只在 DEFAULT_SOUL_TEMPLATE 里出现，
 * 一旦用户动过卡片，这份正文就是他自己的契约，再顶一句「这是默认模板」会
 * 直接注入进上下文，变成一段自相矛盾的元信息。
 */
export function composeSoulText(cards: SoulCard[]): string {
  const usable = injectableCards(cards)
  if (usable.length === 0) return ''
  // 一级标题是文档骨架：有名字就用名字（`# 灵魂契约 · Seeker`），没名字用通用标题。
  // 它**不参与注入**（注入只取卡片段落），所以这里加信息不会污染上下文。
  const name = identityFromCards(cards).name
  const lines: string[] = [name === '' ? '# 灵魂契约' : `# 灵魂契约 · ${name}`, '']
  for (const card of usable) {
    lines.push(`## ${SOUL_CARD_SECTION_TITLES[card.kind]}`, '')
    if (card.kind === 'principles') {
      // 准则卡按行拆成有序列表：面板里用户就是一行一条写的。
      const items = bodyLines(card.body)
      items.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
    } else {
      for (const line of bodyLines(card.body)) lines.push(line.startsWith('- ') ? line : `- ${line}`)
    }
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** 正文按行拆分（去空行、去行首序号/短横，返回纯条目文本）。 */
function bodyLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+[.、)]\s*/, ''))
    .filter(line => line !== '')
}

/**
 * 一行「键：值」的解析（中英文冒号都认）。
 *
 * 必须先剥掉行首的列表标记（`- ` / `* ` / `1. `）：卡片正文里用户写的是
 * `- 名字：卡卡`，而 composeSoulText 输出的也是这个形状。不剥标记的话
 * key 会变成 `- 名字`，反推出的 identity 全是空值——面板改一张卡片就会把
 * 身份四件套清空，属于静默数据丢失。
 */
function keyValue(line: string): { key: string; value: string } | null {
  const cleaned = line.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.、)]\s*/, '')
  const match = /^([^：:]{1,8})[：:]\s*(.*)$/.exec(cleaned)
  if (match === null) return null
  return { key: match[1]!.trim(), value: match[2]!.trim() }
}

/** 从卡片集合反推结构化身份（面板表单用；缺的字段留空，不猜）。 */
export function identityFromCards(cards: SoulCard[]): SoulIdentity {
  const out: SoulIdentity = { name: '', role: '', tone: '', language: '', principles: [] }
  for (const card of sortCards(cards)) {
    if (card.enabled !== true) continue
    if (card.kind === 'principles') {
      out.principles.push(...bodyLines(card.body))
      continue
    }
    if (card.kind !== 'identity' && card.kind !== 'tone') continue
    for (const line of card.body.split(/\r?\n/)) {
      const parsed = keyValue(line)
      if (parsed === null) continue
      if (parsed.key === '名字' || parsed.key === 'name') out.name = parsed.value
      else if (parsed.key === '角色' || parsed.key === 'role') out.role = parsed.value
      else if (parsed.key === '语气' || parsed.key === 'tone') out.tone = parsed.value
      else if (parsed.key === '语言' || parsed.key === 'language') out.language = parsed.value
    }
  }
  out.principles = out.principles.slice(0, 20)
  return out
}

/** 身份字段 → 身份卡 / 语气卡的正文（只在有值时才输出对应行）。 */
function identityBody(identity: SoulIdentity): string {
  const lines: string[] = []
  if (identity.name !== '') lines.push(`名字：${identity.name}`)
  if (identity.role !== '') lines.push(`角色：${identity.role}`)
  return lines.join('\n')
}

function toneBody(identity: SoulIdentity): string {
  const lines: string[] = []
  if (identity.tone !== '') lines.push(`语气：${identity.tone}`)
  if (identity.language !== '') lines.push(`语言：${identity.language}`)
  return lines.join('\n')
}

/** soul.md 小节标题 → 卡片 kind 的关键词映射（迁移时按标题猜种类）。 */
const SECTION_KEYWORDS: Array<{ kind: SoulCardKind; keywords: string[] }> = [
  { kind: 'identity', keywords: ['身份', '角色', '我是谁', 'identity'] },
  { kind: 'tone', keywords: ['语气', '语言', '表达', '说话', 'tone', 'language'] },
  { kind: 'principles', keywords: ['准则', '原则', '规范', '规则', '纪律', 'principle', 'rule'] },
  { kind: 'boundaries', keywords: ['边界', '底线', '禁止', '不做', 'boundary'] },
  { kind: 'style', keywords: ['风格', '偏好', 'style'] },
]

/**
 * 一级标题里的占位词（这些是模板/文档骨架，不是人设内容）。
 * 用小写比较，中英各留几个最常见写法。
 */
const SOUL_TITLE_PLACEHOLDERS = ['灵魂契约', '灵魂', 'soul', 'soul contract', '人格契约', '默认模板']

/**
 * 是否为「文档骨架标题」。
 *
 * 判据刻意是**前缀匹配 + 分隔符**而不只是全等：composeSoulText 自己会产出
 * `# 灵魂契约 · 卡卡`（带名字的骨架标题）。只判全等的话，用户下一次在全文
 * 编辑器里保存同一个内容时，这个标题就会被当成用户写的标题，多出一张
 * 「灵魂契约 · 卡卡」的自定义卡——每存一次多一张，属于会自我繁殖的噪音。
 */
function isPlaceholderTitle(title: string): boolean {
  const lower = title.toLowerCase()
  return SOUL_TITLE_PLACEHOLDERS.some(word => lower === word || new RegExp(`^${word}[\\s·|\\-—:：]`).test(lower))
}

/** 按小节标题猜卡片种类（猜不出落 custom，不丢内容）。 */
function kindOfSection(title: string): SoulCardKind {
  const lower = title.toLowerCase()
  for (const entry of SECTION_KEYWORDS) {
    if (entry.keywords.some(keyword => lower.includes(keyword))) return entry.kind
  }
  return 'custom'
}

/**
 * 迁移：soul.md + identity.json → 初始卡片集合。
 *
 * 只跑一次（cards.json 不存在时），此后 cards.json 是权威。拆法刻意「先按小节拆，
 * 再补身份字段」：
 *   1. 按 markdown 的 `## ` 小节拆卡，标题关键词决定 kind；没有小节的整段文本
 *      落成一张 custom 卡（宁可是自定义卡，也不要凭空猜种类）。
 *   2. identity.json 里有而正文里没体现的字段（用户可能在面板只填了字段没写正文），
 *      补进 identity / tone 卡；已存在同 kind 卡则追加缺的行，不覆盖用户正文。
 * 返回空数组 = 没有可迁移的内容（此时不写 cards.json，保持「未设置」语义）。
 */
export function seedCardsFromText(content: string | null, identity: SoulIdentity): SoulCard[] {
  const seeds: Array<{ kind: SoulCardKind; title: string; body: string }> = []
  const text = (content ?? '').replace(/\r\n/g, '\n').trim()
  if (text !== '') {
    // 一级标题的处理是「保留内容、丢弃占位」：
    //   - `# 灵魂契约` / `# Soul` 这类是模板自带的文档标题，不是人设内容，丢掉；
    //   - 其它一级标题（用户或模型写下的 `# 工具写入的灵魂`）**必须留下**，否则
    //     一次 soul_set 之后用户写的标题就凭空消失，而 soul.md 又由卡片拼回，
    //     等于这段文本被静默吞掉。
    // 留下它的形态是「一张标题即正文的自定义卡」：卡片模型没有「文档标题」这个
    // 概念，硬造一个字段会污染对外契约，而一张 custom 卡既不参与身份反推、
    // 又能原样出现在全文视图与注入里。
    const lines = text.split('\n')
    const kept: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      const heading = /^#\s+(.*)$/.exec(trimmed)
      if (heading !== null) {
        const title = heading[1]!.trim()
        if (!isPlaceholderTitle(title)) {
          seeds.push({ kind: 'custom', title: title.slice(0, 40), body: title })
        }
        continue
      }
      if (/^>\s/.test(trimmed)) continue
      kept.push(line)
    }
    const body = kept.join('\n').trim()
    const chunks = body.split(/^##\s+/m).map(chunk => chunk.trim()).filter(chunk => chunk !== '')
    const hasSection = /^##\s+/m.test(body)
    if (hasSection) {
      for (const chunk of chunks) {
        const newline = chunk.indexOf('\n')
        const title = (newline === -1 ? chunk : chunk.slice(0, newline)).trim()
        const chunkBody = (newline === -1 ? '' : chunk.slice(newline + 1)).trim()
        if (title === '' || chunkBody === '') continue
        seeds.push({ kind: kindOfSection(title), title: title.slice(0, 40), body: chunkBody })
      }
    } else if (body !== '') {
      seeds.push({ kind: 'custom', title: '灵魂正文', body })
    }
  }
  // 身份字段补齐：正文里没写到的字段用 identity.json 补。
  const idBody = identityBody(identity)
  if (idBody !== '') {
    const existing = seeds.find(seed => seed.kind === 'identity')
    if (existing === undefined) seeds.unshift({ kind: 'identity', title: '身份', body: idBody })
    else existing.body = `${idBody}\n${existing.body}`
  }
  const tBody = toneBody(identity)
  if (tBody !== '') {
    const existing = seeds.find(seed => seed.kind === 'tone')
    if (existing === undefined) seeds.push({ kind: 'tone', title: '语气与语言', body: tBody })
    else existing.body = `${tBody}\n${existing.body}`
  }
  const principles = identity.principles.filter(item => item.trim() !== '')
  if (principles.length > 0) {
    const existing = seeds.find(seed => seed.kind === 'principles')
    if (existing === undefined) seeds.push({ kind: 'principles', title: '行为准则', body: principles.join('\n') })
    else existing.body = `${principles.join('\n')}\n${existing.body}`
  }
  // 统一过一遍归一化：去重（同 kind 同标题）、限长、生成稳定 id。
  return dedupeCards(seeds.map((seed, index) => normalizeCard({ ...seed, enabled: true, order: index, presetId: null }))
    .filter((card): card is SoulCard => card !== null))
}

/** 按 id 去重（后出现的同 id 卡片覆盖前者），并重排 order。 */
export function dedupeCards(cards: SoulCard[]): SoulCard[] {
  const byId = new Map<string, SoulCard>()
  for (const card of cards) byId.set(card.id, card)
  return renumber(sortCards([...byId.values()]))
}

/** 重排 order 为 0..n-1（保持现有相对顺序）。 */
export function renumber(cards: SoulCard[]): SoulCard[] {
  return sortCards(cards).map((card, index) => (card.order === index ? card : { ...card, order: index }))
}

/**
 * 蒸馏草案 → 卡片集合。
 *
 * 草案只有「一段正文 + 身份四件套」，没有卡片结构；这里按身份字段与正文小节拆。
 * 正文小节优先（用户看到的就是那段正文），身份字段只在正文里没体现时补卡——
 * 与迁移同一条规则，两条入口产出的卡片形状才一致。
 */
export function cardsFromDraft(draft: SoulDraft): SoulCard[] {
  return seedCardsFromText(draft.content, draft.identity).map(card => ({ ...card, presetId: null }))
}

/**
 * 应用预设：replace = 整套采用；merge = 同 kind 覆盖、custom 追加、其它保留。
 *
 * merge 的「同 kind 覆盖」是**整类替换**（不是逐张追加）：用户点合并的预期是
 * 「换掉语气，别动我的准则」，逐张追加会得到两份语气卡互相打架。
 * custom 追加则相反——自定义卡按定义就是「预设没覆盖到的私货」，只该加不该删。
 */
export function applyPresetCards(
  current: SoulCard[],
  presetCards: SoulCard[],
  mode: 'replace' | 'merge',
  presetId: string,
): SoulCard[] {
  const stamped = presetCards.map(card => ({ ...card, presetId, updatedAt: new Date().toISOString() }))
  if (mode === 'replace') return renumber(stamped)
  const replacedKinds = new Set(stamped.filter(card => card.kind !== 'custom').map(card => card.kind))
  const kept = current.filter(card => card.kind === 'custom' || !replacedKinds.has(card.kind))
  return renumber([...kept, ...stamped])
}

/** 卡片 → 纯数据快照（落盘与 HTTP 回包共用，顺手保证字段顺序稳定）。 */
export function toCardJson(cards: SoulCard[]): SoulCard[] {
  return normalizeCards(sortCards(cards))
}
