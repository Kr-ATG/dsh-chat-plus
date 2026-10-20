/**
 * dsh-memory 写入侧内容卫生：清洗 + 硬拒绝。
 *
 * 为什么需要：入库前的唯一一道门是 n-gram 去重（extract.ts 的 isDuplicateContent），
 * 它只管「像不像已有的」，完全不管「这条本身能不能用」。实测近 10 天 866 条
 * 自动抽取内容里，有 3.8% 是「用户叫 Kr，助手称呼其为 Kr」这类元信息、还有
 * 行首挂着反引号或井号的 markdown 残片——它们入库后要用户手动去删（同期手动
 * 删除 1781 次，这是主要来源之一）。
 *
 * 两道处理，危险度完全不同：
 *   · **清洗**（sanitize）：去掉行首 markdown 符、折叠空白、去尾部悬标点。
 *     只改表示形式、不改语义，永远不会伤到一条好记忆。
 *   · **硬拒绝**（memoryRejectReason）：只拦三类**确定**的垃圾——占位词、纯称呼
 *     元信息、空内容。不做「信息密度评分」之类的软判断：那类规则会误伤
 *     「用户要求不新增任何 npm 依赖。」（17 字，但完全有效）这种短而硬的约束。
 *
 * 参考 dsh-engram-relay 的 title-hygiene.ts。它的教训是：洗完不成入口就
 * **返回空串让调用方跳过**，而不是塞「对话片段」兜底——那让它的图谱白攒了
 * 175 条垃圾节点。本模块遵循同一原则：清洗后不合格就是空串，由调用方丢弃。
 */

/** 占位词：模型无话可说时的自述词，一律不是记忆。 */
const PLACEHOLDERS = new Set([
  'placeholder', 'todo', 'tbd', 'n/a', 'na', 'none', 'null', 'undefined',
  '摘要', '总结', '记录', '内容', '结果', '汇报', '报告', '说明', '如下', '以上',
  '对话片段', '对话', '暂无', '无', '略', '待补充', '待定',
])

/** 行首需要剥掉的：markdown 标题/列表/引用符、表格竖线、强调符、空白。 */
const LEADING_NOISE = /^[\s#>*\-|~`_=+\u3000]+/u

/** 行尾需要剥掉的：表格竖线、悬空的强调符（不碰下划线——_tmp/ 这类路径名要用）。 */
const TRAILING_NOISE = /[\s|*]+$/u

/** 行首标点（中英文）：抽取时常带回上一句的尾巴。 */
const LEADING_PUNCT = /^[：:，,、。.；;！!？?）)】」』"'“”‘’]+/u

/** 行首引导词：模型爱写「询问…」「关于…」，对语义无贡献。 */
const LEADING_FILLER = /^(?:询问|请问|查找|查询|关于|至于|另外|此外|同时|然后)[\s：:，,]*/u

/** 尾部悬标点：句子没说完就截断的痕迹（句号问号是正常结尾，不在其中）。 */
const TRAILING_PUNCT = /[：:，,、；;\-\u2014]+$/u

/**
 * 清洗一条记忆内容。返回空串 = 清完什么都不剩（调用方应丢弃）。
 *
 * **只做形式层面的处理**：不改动句中任何内容、不做同义替换、不截断正文。
 * 截断会丢信息，而记忆的价值就在于信息本身；长度是可配置的业务约束，
 * 由调用方按 config.extractMaxChars 处理，不在这里做。
 */
export function sanitizeMemoryContent(raw: unknown): string {
  let text = String(raw ?? '').trim()
  if (text === '') return ''

  // ① 先剥**成对的** markdown 强调符 / 内联代码符。顺序很重要：
  //    必须先做这一步再去行首噪声，否则行首字符类会把 `` `x` `` 的左半边吃掉，
  //    只剩一个孤零零的右反引号留在正文里（实测 「`waitFenceHeights` 的…」
  //    清洗后变成 「waitFenceHeights` 的…」）。
  //    只剥成对的；不碰单个下划线（_tmp/、snake_case 里它是正文的一部分）。
  text = text
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/`([^`\n]+)`/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')

  // ② 逐行剥行首/行尾噪声（保留换行结构，注入侧会自己压平）。
  text = text
    .split(/\r?\n/)
    .map(line => line.replace(LEADING_NOISE, '').replace(LEADING_PUNCT, '').replace(TRAILING_NOISE, '').trim())
    .filter(line => line !== '')
    .join('\n')

  // ③ 成对剥过之后可能还剩单边强调符（原文就只有一边，如表格行 `**三者全上 | 是`）。
  //    这种残符不配对，留着只会碍眼——按「不承载语义」直接去掉。
  text = text.replace(/\*+/gu, '')

  // ④ 行首引导词只剥一次（「关于关于」是模型偶发，不值得循环处理）。
  text = text.replace(LEADING_FILLER, '')

  // ⑤ 只剥「悬空」的标点：句号问号感叹号是正常结尾，保留。
  text = text.replace(TRAILING_PUNCT, '').trim()

  return text
}

/** 纯称呼元信息：谁叫什么、谁称呼谁。对行为没有指示作用，不该占记忆位。 */
// 每条都要带 ^ 锚点：isPureMetaAddress 是逐段剥离的，靠锚点保证只切句首。
// 「助手称呼其为 Kr」这种带宾语的变体单独一条——通用模式写成
// `助手(?:称呼|称)…为` 太松，会把「助手调用接口为例」之类真内容也切掉。
const META_ADDRESS_PATTERNS = [
  /^用户(?:的)?(?:昵称|名称|名字|称呼)(?:是|为)/u,
  /^用户(?:被)?(?:称呼|称)为/u,
  /^(?:助手|模型|AI|你)(?:的)?(?:自称|昵称|称呼)(?:是|为)?/u,
  /^(?:助手|模型|AI|你)(?:称呼|称)(?:其|用户|他|她)?为/u,
  /^用户(?:习惯)?(?:使用|用)(?:中文|英文|简体中文|繁體中文)(?:交流|沟通)/u,
]

/**
 * 判断一条（已清洗的）内容是否应当**拒绝入库**。
 *
 * 只拦三类确定垃圾。判据故意保守——每一条都必须「无论上下文如何都不该是记忆」：
 *   1. 空内容 / 只剩标点；
 *   2. 占位词（模型在无话可说时输出的自述词）；
 *   3. 纯称呼元信息（「用户昵称是 Kr」——知道这个对回答没有任何帮助）。
 *
 * 不拦的（虽然看起来可疑，但可能是真记忆）：
 *   · 「用户偏好直接、简洁」——这是行为指令，不是元信息；
 *   · 短句（「用户要求不新增任何 npm 依赖。」）——短不等于无效；
 *   · 含日期/路径/命令的内容——那往往正是要记的技术细节。
 *
 * @returns 拒绝原因（英文短码，进日志用）；空串 = 可以入库。
 */
export function memoryRejectReason(content: string): string {
  const text = content.trim()
  if (text === '') return 'empty'
  // 只剩标点/符号（清完行首噪声后可能残留中间的空壳）。
  if (!/[\p{L}\p{N}]/u.test(text)) return 'punctuation-only'

  const lower = text.toLowerCase()
  if (PLACEHOLDERS.has(lower)) return 'placeholder'
  // 「合并为：placeholder」这类带前缀的占位词。
  const stripped = text.replace(/^合并为[：:]\s*/u, '').trim()
  if (stripped !== text && PLACEHOLDERS.has(stripped.toLowerCase())) return 'placeholder'

  // 元信息只在「**整条都是元信息**」时拒绝。
  //
  // 这里踩过坑：最初写成「含元信息 + 长度 ≤40 就拒」，于是把
  // 「用户称呼为 Kr，交流简洁直接、不磨叽，禁止「考虑到 token 有限」类套话。」
  // 整条拒掉了——后半段是真记忆（行为指令），前半段才是不该占位的元信息。
  // 正确判据是**看剩余部分**：剥掉元信息片段后还剩实质内容，就保留整条。
  if (isPureMetaAddress(text)) return 'meta-address'

  return ''
}

/**
 * 整条是否「只由称呼元信息构成」。
 *
 * 判据是**按句读切分后逐句检查**：每一句都必须是元信息句，整条才算纯元信息。
 * 只要有一句不是（比如「…禁止『考虑到 token 有限』类套话」），整条就保留。
 *
 * 为什么不用「迭代剥模式直到剥不动」：那个写法在「用户昵称是 Kr，助手称呼其为 Kr」
 * 上会卡住——剥掉首句模式后剩下的是名字 `Kr，助手称呼…`，名字不在模式表里，
 * 于是剥不动、残留被当成实质内容，整条漏判。分句法天然绕开「名字怎么识别」
 * 这个伪问题：名字永远是元信息句的一部分，不需要单独建模。
 */
function isPureMetaAddress(text: string): boolean {
  // 按中英文句读切分；切出的空段（连续标点、首尾标点）直接丢弃。
  const clauses = text
    .split(/[，,、；;。.！!？?\n]+/u)
    .map(clause => clause.trim())
    .filter(clause => clause !== '')
  if (clauses.length === 0) return false
  return clauses.every(clause => META_ADDRESS_PATTERNS.some(pattern => pattern.test(clause)))
}

/** 一站式：清洗 + 判定。返回 { content } 表示可入库，{ rejected } 表示丢弃。 */
export function prepareMemoryContent(raw: unknown): { content: string } | { rejected: string } {
  const content = sanitizeMemoryContent(raw)
  const reason = memoryRejectReason(content)
  if (reason !== '') return { rejected: reason }
  return { content }
}
