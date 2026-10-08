/**
 * dsh-chat-plus — 正文里的裸文件路径 → 可点击的预览链接（path-linkify）。
 *
 * 为什么需要：模型讲「产出的东西在哪」时，多数情况写的是**裸路径**
 * （`D:\AI\Dsh\_tmp\shot.png`、`_tmp\shot.png`），既不是 Markdown 图片语法，
 * 也不是行内代码。官方渲染器对裸文本一律不处理，于是用户在 KR 对话里
 * 既看不到图、也点不开——正是本次要修的那件事。
 *
 * 做法：把裸路径改写成官方认识的本地 Markdown 链接
 * `[名字](编码后的路径 "完整路径")`。之后完全交给官方链路：
 *   renderAnchor → parseFileLink → MarkdownFileLink → openFile
 *   → sidebarRight.openResource → 右侧工作区预览。
 * 图片扩展名还会自动带上官方的悬停预览。
 *
 * 三条硬约束（都不报错，静默保持原样）：
 *  1. **代码不动**：围栏代码块（``` / ~~~）与缩进代码块整块跳过——那是代码，
 *     里面的路径往往只是示例，改写了反而破坏可复制性；
 *  2. **行内代码不动**：由 fileMentions 那条路接管（同一个入口，避免双重包装）；
 *  3. **已有链接/图片不动**：`[x](y)`、`![x](y)`、`<url>` 原样保留。
 *
 * 纯函数、无 React / 无 DOM 依赖，可直接在 smoke 里断言。
 */

/** 值得做成「可点文件」的扩展名白名单（产出物：图 / 文档 / 表格 / 媒体 / 压缩包）。 */
const PRODUCED_EXT = new Set([
  // 图片
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico', 'tif', 'tiff',
  // 文档
  'md', 'markdown', 'txt', 'log', 'pdf', 'rtf', 'doc', 'docx', 'odt', 'html', 'htm',
  // 表格
  'csv', 'tsv', 'xls', 'xlsx', 'ods', 'json', 'jsonl', 'yaml', 'yml', 'xml',
  // 演示 / 数据
  'ppt', 'pptx', 'odp', 'sqlite', 'db',
  // 音视频
  'mp3', 'wav', 'flac', 'm4a', 'ogg', 'mp4', 'webm', 'mov', 'mkv', 'avi',
  // 压缩包
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz',
])

/** 图片扩展名（决定「能不能直接当图显示」）。 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico', 'tif', 'tiff'])

/** 路径里不允许出现的字符（含中英文标点，防止把句子一起吞进来）。 */
const PATH_STOP = '\\s，。；：、！？（）()\\[\\]{}"\'`<>|*?\\n'

/** 绝对路径：盘符 / UNC / 正斜杠开头。前置负向断言排除 URL 与已处理段。 */
const ABS_PATH_RE = new RegExp(`(?<![\\w:.\\\\/-])(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/)[^${PATH_STOP}]+`, 'g')

/**
 * 相对路径：至少一个分隔符，且最后一段带扩展名。
 *
 * 前置断言与绝对路径同一套：排除 `https://…`（`/` 前是 `:`）与从单词中间切入
 * （`xindex.ts` 里的 `index.ts` 不该被认出来）。
 */
const REL_PATH_RE = new RegExp(`(?<![\\w:.\\\\/-])(?:[\\w.@~\\-]+[\\\\/])+[\\w.@~\\-]+`, 'g')

/**
 * 「疑似含空格的路径被截断」的行级预检。
 *
 * 自由文本里的含空格路径没法可靠切分：`C:\Program Files\App\x.txt` 会在第一个
 * 空格处断成 `C:\Program`，而剩下半截还可能被当成相对路径 `Files/App/x.txt`
 * 做成链接 —— 用户点开是个死链，比不处理更糟。
 *
 * 判据：`盘符:\非空` + 空白 + 一个**含分隔符的 token**。命中就整行不做改写，
 * 交给行内代码那条路（模型把含空格路径写进反引号里时，fileMentions 能精确处理）。
 */
const AMBIGUOUS_SPACED_PATH_RE = /[A-Za-z]:[\\/][^\s]*\s+[^\s]*[\\/]/

/** 需要原样保留的 Markdown 片段：行内代码 / 图片 / 链接 / 自动链接。 */
const PROTECTED_RE = /(`[^`\n]*`|!?\[[^\]]*\]\([^)]*\)|<[^>\s]+>)/g

/** 取路径最后一段（文件名）。 */
function basenameOf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
}

/** 取扩展名（小写，无点）；无扩展名返回空串。 */
function extensionOf(path: string): string {
  const base = basenameOf(path).split(/[?#]/)[0] ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * 这个路径是否「值得做成可点文件」。
 *
 * 判定刻意保守——正文里讨论代码时常出现 `index.ts`、`useState` 这类行内代码，
 * 全部做成链接会制造大量点开就报错的死链。所以：
 *  · 带分隔符（`a/b`、`D:\a`）的路径一律认；
 *  · 只有纯文件名时，扩展名必须落在产出物白名单里（图片、文档、表格、媒体、压缩包）。
 * 代码文件扩展名（.ts/.tsx/.js/.py…）的纯文件名**不做**，除非带目录。
 * @param raw - 候选路径（未 trim）。
 * @returns 是否可做链接。
 */
export function isMentionablePath(raw: string): boolean {
  const path = typeof raw === 'string' ? raw.trim() : ''
  if (path === '' || path.length > 400) return false
  if (/[\u0000-\u001f\u007f]/.test(path)) return false
  // URL 一律排除（http(s)/data/blob/file 等）。
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) return false
  const ext = extensionOf(path)
  if (ext === '') return false
  const hasSeparator = /[/\\]/.test(path)
  if (hasSeparator) return true
  return PRODUCED_EXT.has(ext)
}

/** 去掉路径尾部粘上的句子标点（`x.png。` / `x.png,` / `x.png)`）。 */
function trimTrailingPunctuation(token: string): { path: string; tail: string } {
  let end = token.length
  while (end > 0) {
    const ch = token[end - 1] ?? ''
    if ('.。，,；;：:！!？?、）)】]》>"\''.includes(ch)) {
      // 句点只在「后面没有别的字符且不构成扩展名」时才算标点；扩展名由
      // isMentionablePath 兜底判断，这里直接剥掉由它决定结果。
      end -= 1
      continue
    }
    break
  }
  return { path: token.slice(0, end), tail: token.slice(end) }
}

/**
 * 编码成 Markdown 链接可安全承载的 destination。
 *
 * 反斜杠统一成正斜杠（官方 fileAddressFor 也这么做），空格与括号、引号、
 * 百分号一律 percent-encode —— 官方 parseFileLink 会 decodeURIComponent 还原。
 * @param path - 原始路径。
 * @returns 编码后的 destination。
 */
export function encodePathForMarkdown(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/"/g, '%22')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
}

/**
 * 生成一段 Markdown 链接。
 *
 * 标签**必须用正斜杠形式**：Markdown 标签里的反斜杠是转义符，`[D:\AI\Dsh\a.png]`
 * 里的 `\A` 会被官方解析器吃掉转义、显示成 `D:AIDsha.png` —— 路径就废了。
 * title 属性里放原始路径（那里是纯文本，反斜杠安全），悬停能看到完整路径。
 * @param path - 原始路径（可为反斜杠形式）。
 * @returns Markdown 链接片段。
 */
function toMarkdownLink(path: string): string {
  const display = path.replace(/\\/g, '/')
  const label = display.length <= 60 ? display : basenameOf(display)
  const escapedLabel = label.replace(/[[\]]/g, '')
  return `[${escapedLabel}](${encodePathForMarkdown(path)} "${path.replace(/"/g, "'")}")`
}

/** 在一段普通文本里替换裸路径（不含受保护片段）。 */
function linkifyPlain(segment: string): string {
  // 1) 绝对路径
  let out = segment.replace(ABS_PATH_RE, (match) => {
    const { path, tail } = trimTrailingPunctuation(match)
    if (!isMentionablePath(path)) return match
    return `${toMarkdownLink(path)}${tail}`
  })
  // 2) 相对路径（前置断言已排除 URL 与单词中间，不需要捕获组拼前缀）
  out = out.replace(REL_PATH_RE, (match) => {
    const { path, tail } = trimTrailingPunctuation(match)
    if (!isMentionablePath(path)) return match
    return `${toMarkdownLink(path)}${tail}`
  })
  return out
}

/**
 * 把整段 Markdown 源里的裸文件路径改写成可点击的本地链接。
 *
 * 契约：不抛。输入非字符串、无路径、或任何异常都返回原文本。
 * @param text - 助手正文的 Markdown 源。
 * @returns 改写后的 Markdown 源（可安全交给官方 MarkdownText）。
 */
export function linkifyFilePaths(text: string): string {
  if (typeof text !== 'string' || text === '') return text
  // 快路径：整段一个可疑字符都没有就直接返回，省掉逐行扫描。
  if (!/[\\/]/.test(text)) return text
  try {
    const lines = text.split('\n')
    const out: string[] = []
    let fence: string | null = null
    for (const line of lines) {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
      if (fenceMatch !== null) {
        const marker = fenceMatch[1] ?? ''
        if (fence === null) fence = marker[0] ?? '`'
        else if (marker[0] === fence) fence = null
        out.push(line)
        continue
      }
      // 围栏内、或缩进代码块（4 空格 / 1 tab）内的行整行不动。
      if (fence !== null || /^(\s{4,}|\t)/.test(line)) {
        out.push(line)
        continue
      }
      out.push(linkifyLine(line))
    }
    return out.join('\n')
  } catch {
    return text
  }
}

/**
 * 整段正文**只有一个图片路径**时，直接升级成 Markdown 图片语法。
 *
 * 场景：模型产出截图后常单独回一行路径（`D:\AI\Dsh\_tmp\shot.png`）。
 * 只把它做成链接的话，用户仍然「看不到图」——而这正是原始抱怨的一半。
 * 判定刻意苛刻：整段 trim 后必须**不含空白**且是图片扩展名，才敢当图片；
 * 混在句子里的路径一律只做链接，避免把正文排版打乱。
 * @param text - 一段 Markdown 源。
 * @returns 图片语法的 Markdown，或原文本。
 */
export function promoteStandaloneImagePath(text: string): string {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return text
  if (!isMentionablePath(trimmed)) return text
  if (!PRODUCED_EXT.has(extensionOf(trimmed))) return text
  const ext = extensionOf(trimmed)
  if (!IMAGE_EXTS.has(ext)) return text
  return `![${basenameOf(trimmed).replace(/[[\]]/g, '')}](${encodePathForMarkdown(trimmed)})`
}

/** 单行处理：按受保护片段切分，只对普通片段做替换。 */
function linkifyLine(line: string): string {
  if (line === '' || !/[\\/]/.test(line)) return line
  // 含空格的路径无法可靠切分，整行不做（见 AMBIGUOUS_SPACED_PATH_RE 的注释）。
  if (AMBIGUOUS_SPACED_PATH_RE.test(line)) return line
  /*
   * 用显式下标遍历受保护片段，**不能用 split 的奇数下标判定**：PROTECTED_RE 里
   * 没有捕获组，split 返回的受保护片段落在**偶数**下标，奇数才是普通文本——判反了
   * 会把代码块里的路径做成链接、把正文里的路径漏掉。
   */
  let out = ''
  let last = 0
  const re = new RegExp(PROTECTED_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    out += linkifyPlain(line.slice(last, match.index))
    out += repairHandwrittenImagePath(match[0])
    last = match.index + match[0].length
    if (match[0].length === 0) re.lastIndex += 1
  }
  out += linkifyPlain(line.slice(last))
  return out
}

/**
 * 修手写的反斜杠图片路径：`![alt](D:\a\b.png)` → `![alt](D:/a/b.png)`。
 *
 * 为什么必须修：Markdown 里 `\` 是**转义符**。`![x](D:\AI\Dsh\_tmp\shot.png)`
 * 会被解析成 `D:AIDsh_tmp shot.png`（`\_` 退化成 `_`、`\A`/`\D` 各自成转义），
 * 渲染出的 `src` 直接指向一个不存在的文件 —— 用户看到「图片无法预览」，
 * 而路径本身完全合法。
 *
 * 这个坑只在**手写**语法里出现：插件自己生成的链接走 encodePathForMarkdown，
 * 反斜杠早已统一成正斜杠（见那里的注释）。但模型写 Windows 路径时天然用反斜杠，
 * 而 PROTECTED_RE 把 `![x](y)` 整块当作「已有链接，原样保留」跳过了 ——
 * 本意是保护，实际变成放行。所以在这里补一刀：只动 destination 里的反斜杠，
 * 其余（alt 文本、尖括号包裹、title）保持原样。
 *
 * 判据刻意保守：只有 `![...](...)` 图片语法、且 destination 里真的含 `\` 才改写；
 * 普通链接 `[x](y)` 不碰（那可能是 URL 或别的东西）。
 * @param fragment - 一个受保护片段（可能是图片/链接/行内代码/自动链接）。
 * @returns 修正后的片段；不该动就原样返回。
 */
function repairHandwrittenImagePath(fragment: string): string {
  if (!fragment.startsWith('![')) return fragment
  // 行内代码不会以 ![ 开头，这里只可能是图片语法。
  const match = /^(!\[[^\]]*\]\()([^)\s]*)(\s+"[^"]*")?(\))$/.exec(fragment)
  if (match === null) return fragment
  const destination = match[2] ?? ''
  if (!destination.includes('\\')) return fragment
  // 去掉尖括号包裹（`<D:\a\b.png>`）：CommonMark 只在链接语法里认它，
  // 且它不解决转义问题，统一去掉后交给正斜杠形式。
  const bare = destination.replace(/^</, '').replace(/>$/, '')
  return `${match[1]}${bare.replace(/\\/g, '/')}${match[3] ?? ''}${match[4]}`
}
