/**
 * dsh-chat-plus — 会话产出物收集（纯函数，无 React / 无 DOM）。
 *
 * 回答一个问题：**这次对话一共做出来了哪些文件。**
 *
 * 客户端只有一路数据：工具调用。在这一路里分两条：
 *  · **权威路** —— 工具**参数**里声明的目标路径（write / edit / download / present…）。
 *    与「操作面板」行内那枚预览入口同源，最准。
 *  · **结果路** —— 工具**返回文本**里出现的成品路径。模型跑脚本产出文件时
 *    （Blender 渲染、Python 画图、ffmpeg 导出），路径只出现在命令的输出里，
 *    参数里什么都没有 —— 这一路是这类产出的唯一来源。
 *
 * 三条刻意的取舍：
 *  1. **只认本地文件**：生图工具返回的 b64 / 远程 URL 不列。这张卡的全部价值是
 *     「点一下就看见」，点不开的条目只是在凑数；生图结果本来就有对话流里的画廊
 *     在展示（见 generated-images/）。
 *  2. **只列成品**：代码文件（.ts/.py/.css…）折成一行计数，不逐条占行 ——
 *     一次编码任务改十几个源文件，逐条列出来会把「做出来了什么」整个淹掉。
 *  3. **只扫会产出东西的工具**：read / grep / glob / web_fetch 的结果里出现的
 *     路径是「看到的东西」，不是「做出来的东西」，一概不算。
 *
 * 纯函数、无副作用（内部那张按节点缓存是幂等的，只为避开流式期每帧重扫正则），
 * 可直接在 smoke 里 import 断言。
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { callName, isRunning, resultText } from '../tool-summary/tool-stats.ts'
import { argFields, toolArgsRaw } from '../tool-summary/activity-view-model.ts'

/** 产出物的类别。决定行首那枚 SVG 缩略图长什么样。 */
export type OutputKind =
  | 'image' | 'video' | 'audio' | 'model3d'
  | 'doc' | 'pdf' | 'sheet' | 'slide' | 'archive' | 'page'
  | 'code' | 'other'

export interface OutputItem {
  /**
   * 完整路径（打开预览用）。
   *
   * 相对路径原样保留，由打开时按会话工作区根解析（与操作面板那枚入口同一套
   * 约定，见 open-preview.ts 的 fileAddressFor）。
   */
  readonly path: string
  /** 文件名（上屏文案，只留最后一段）。 */
  readonly name: string
  readonly kind: OutputKind
}

/**
 * 内部提取结果：OutputItem + 一条来源标记。
 *
 * `delivered` 只在 `present` 上为真 —— 它是模型**显式声明交付**的那几个文件，
 * 是这批产出里唯一的权威路径。之所以要这条标记：同一个文件在会话里往往先落到
 * 临时位置、再被搬到最终位置（download 到 `_tmp/` 后 move 到 `docs/` 是常见
 * 形态），两条路径的 basename 相同、完整路径不同，不去重就会在卡里并排留一条
 * 已经失效的旧路径，用户点到就是「文件不存在」。
 */
interface ExtractedItem extends OutputItem {
  readonly delivered: boolean
}

export interface OutputsView {
  /** 成品，首见顺序（同一路径只出现一次）。 */
  readonly items: readonly OutputItem[]
  /** 代码文件路径，首见顺序；默认折成一行计数，用户点开才逐条列。 */
  readonly code: readonly string[]
}

const EMPTY_VIEW: OutputsView = { items: [], code: [] }

/* ── 扩展名 → 类别 ─────────────────────────────────────────────────────── */

/**
 * 扩展名总表（小写、不带点）。
 *
 * 两个判断值得说明：
 *  · **gif 归 video**：它是「会动的」，给一枚播放符号比给山峰更贴它的语义。
 *    截图里那两个 `talos-*-motion.gif` 正是运镜动画。
 *  · **svg 归 image**：它同时也是 XML，但对用户来说那就是一张图。
 *  · **html 归 page**：对用户它是一个**能打开的页面**（演示页、报告页、交互原型），
 *    不是一段源码。归进 code 会被折进「另有 N 个代码文件」那一行 —— 用户做出来
 *    的东西就此消失在一个计数里。这是它和 .ts/.css 的根本区别：那些是"做页面的
 *    材料"，.html 是"做出来的页面本身"。
 *
 * 不在表内的扩展名一律 `other`，**不列也不计数** —— 认不出来就不占行。
 */
const KIND_BY_EXT: Readonly<Record<string, OutputKind>> = {
  // 图片
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image',
  avif: 'image', svg: 'image', ico: 'image', tif: 'image', tiff: 'image', heic: 'image',
  // 视频 / 动图
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video',
  avi: 'video', gif: 'video',
  // 音频
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio',
  // 3D / 建模
  blend: 'model3d', obj: 'model3d', fbx: 'model3d', stl: 'model3d', glb: 'model3d',
  gltf: 'model3d', dae: 'model3d', ply: 'model3d', '3ds': 'model3d',
  // 文档
  md: 'doc', markdown: 'doc', txt: 'doc', rtf: 'doc', doc: 'doc', docx: 'doc', odt: 'doc',
  pdf: 'pdf',
  // 表格 / 演示
  csv: 'sheet', tsv: 'sheet', xls: 'sheet', xlsx: 'sheet', ods: 'sheet',
  ppt: 'slide', pptx: 'slide', odp: 'slide',
  // 可打开的页面（演示页 / 报告页 / 交互原型）：成品，不是源码。
  html: 'page', htm: 'page', xhtml: 'page',
  // 压缩包
  zip: 'archive', '7z': 'archive', rar: 'archive', tar: 'archive',
  gz: 'archive', bz2: 'archive', xz: 'archive',
  // 代码（折一行计数）
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code',
  json: 'code', jsonl: 'code', py: 'code', rb: 'code', go: 'code', rs: 'code',
  java: 'code', kt: 'code', kts: 'code', swift: 'code', c: 'code', cc: 'code',
  cpp: 'code', cxx: 'code', h: 'code', hh: 'code', hpp: 'code', cs: 'code',
  php: 'code', sh: 'code', bash: 'code', zsh: 'code', ps1: 'code', bat: 'code',
  cmd: 'code', sql: 'code', xml: 'code', yaml: 'code', yml: 'code', toml: 'code',
  ini: 'code', cfg: 'code', conf: 'code', css: 'code', scss: 'code', less: 'code',
  vue: 'code', svelte: 'code', astro: 'code',
  lua: 'code', r: 'code', dart: 'code', scala: 'code', clj: 'code', ex: 'code',
  exs: 'code', erl: 'code', hs: 'code', ml: 'code', nim: 'code', zig: 'code',
  ipynb: 'code',
}

/** 扩展名判定用的候选串（长的排前面，避免短扩展名抢在长扩展名前命中）。 */
const EXT_ALTERNATION = Object.keys(KIND_BY_EXT)
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .map((ext) => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

/**
 * 结果文本里的成品路径（**自证前缀**那条：盘符、`./`、`../`）。
 *
 * 结构：**左边界** + **必选前缀** + **路径正文** + **扩展名**。四处都是实测踩出来的：
 *
 * ① **左边界**是必需的第一道保险。没有它，正则会在 `out/report.pdf` 里从中间的
 *    `/` 起匹配，捞出一条 `/report.pdf` —— 点开必然 404。边界取「不可能是路径
 *    开头」的那一类字符，于是匹配只能从 token 的开头起算。
 *
 * ② **前缀必须是盘符**（`D:/`）。这一条是从「可选」收窄两次来的：可选时
 *    `Saved: D:/out/a.png` 会从动词 `Saved:` 起一路吃掉空格和正文，得到
 *    `Saved: D:/out/a.png` 这种带动词的假路径；强制前缀把起点钉死在真正的路径
 *    开头。后来 `.`/`..` 前缀也被去掉（2026-10-01）—— 理由见下面「相对路径整类
 *    不收」那段注释：相对路径的基准是**命令执行时的当前目录**，客户端无从得知。
 *
 * ③ **正文非贪婪且允许中间空格**：非贪婪保证 `D:/a.png D:/b.png` 切成两条而不是
 *    吞成一条；允许空格是因为中文文件名常带空格（`我的 报告.pdf`），一律禁空格
 *    会把这类真产出整批漏掉。空格只允许「后面还跟着非空格字符」的单个，连续
 *    空格视为路径结束。
 *
 * ④ 尾部 `\b` 保证 `.png` 不会被 `.png1` / `.png_old` 骗过。
 *
 * ⑤ **裸斜杠前缀（`/`）不在这一条里** —— 它被拆到 SLASH_PATH_RE。原因见那条的
 *    注释：盘符自带「这是路径开头」的自证，斜杠没有，夹在 token 中间时是切断
 *    残片。这是 2026-10-01 修掉的第二个 `/report.pdf` 来源。
 */
const PATH_CHARS = '[^"\'`,;，。；、）)\\]}>|*?\u0060\\s]'
const PATH_BODY = `${PATH_CHARS}+?(?:\\s${PATH_CHARS}+?)*?`
const RESULT_PATH_RE = new RegExp(
  '(?:^|[^A-Za-z0-9_.\\\\/:\\-])'
  + '((?:[A-Za-z]:[\\\\/])'
  + PATH_BODY
  + '\\.(?:' + EXT_ALTERNATION + ')\\b)',
  'gi',
)

/**
 * **裸斜杠前缀**（`/`、`\`）的成品路径 —— 只认出现在**明确边界**后的那一个。
 *
 * ⚠ 2026-10-01 起，这条**只在证据 1（落盘说明）里用**，不再参与证据 2。
 * 理由是 `/index.html` 那个 BUG：一条探测 URL 的命令
 * （`foreach($p in @("/","/index.html",…)){ Invoke-WebRequest "http://host$p" }`）
 * 的结果行 `GET /index.html -> 404` 被证据 2 收下 —— 命令原文里确实"写出"了
 * `index.html`（斜杠被 token 切分吃掉），于是卡里多出一条点开必然空白的产出物，
 * 右栏路径行原样显示 `/index.html`。这**不是路径**，是 URL 的 path 段。
 * 区分二者在语法上不可能（`GET /a.png` 与 `cat /a.png` 同构），所以在**证据 2**
 * 这条更松的通道里整类禁掉：它本来兜的是「路径由变量拼出来」的脚本产出，而那类
 * 产出必带盘符（Windows）或落在证据 1 的落盘说明里（Unix）。
 * 证据 1 保留本条：`Saved: /tmp/out/v.mp4` 是模型自述的落盘，可信度高得多。
 *
 * 为什么必须与自证前缀那条分开：`/` 不像盘符那样能自证「我是路径的开头」。格式化
 * 输出里到处是 `items: [ 'pdf|/report.pdf' ]`、`path=/result.csv` 这种形状 —— 那个
 * 斜杠原本是相对路径 `out/report.pdf` 的分隔符，被切断后残留在分隔符（`|`、`=`）
 * 后面。上一条的排除式左边界恰好把 `|`、`=` 这类「不可能是路径开头」的字符放行
 * 了，于是卡片上出现一条点开必然 404 的假路径。这正是用户 2026-10-01 报的
 * 「产出物路径不全」：`/report.pdf` 看着像路径，实际是残片。
 *
 * 判据改成白名单：左边界只能是行首、空白、引号、括号、逗号/分号这类**真分隔符**。
 * Unix 绝对路径（`/var/log/report.pdf`、`to '/tmp/out/v.mp4':`）全部落在白名单里，
 * 不受影响；而 `pdf|/report.pdf` 的 `|` 不在白名单，直接不进。
 *
 * 白名单**刻意不含冒号、等号与反引号**，三个都是实测踩出来的：
 *  · 冒号与等号 —— `path=/result.csv`、`key:/report.pdf` 与「真 Unix 绝对路径」
 *    （`--out=/data/x.pdf`）语法完全同构，无法区分；而前者在真实输出里是**残片**
 *    （原路径 `out/result.csv` 被从中间的斜杠切开），后者在本机（Windows）产出里
 *    根本不存在。按「宁可漏，不可错」去掉。
 *  · 反引号 —— 它是 Markdown 的**引用标记**，不是路径边界：注释里那句
 *    「捞出一条 \`/report.pdf\` —— 点开必然 404」讲的是示例，不是产出。放行反引号
 *    会把这类说明性文字里的路径捞进卡（实测：git diff 的注释行就被捞过一次）。
 *    真正的落盘说明不用反引号包裹（`Saved: out/x.pdf`、`to '/tmp/v.mp4':`）。
 * 注意这三条都不影响盘符路径：`已保存：D:/out/x.png` 由上面那条自证前缀正则
 * 处理，与白名单无关。
 *
 * `(?<![A-Za-z]:)` 是必需的：没有它，`D:/out/a.png` 会在盘符后的斜杠处被本条
 * 重复匹配一次，得到 `/out/a.png` —— 修掉一个残片又造出另一个。盘符路径归上一条。
 */
const SLASH_PATH_RE = new RegExp(
  '(?:^|[\\s"\'（(\\[，,;；])'
  + '(?<![A-Za-z]:)'
  + '([\\\\/]'
  + PATH_BODY
  + '\\.(?:' + EXT_ALTERNATION + ')\\b)',
  'gi',
)

/**
 * **相对路径整类不收**（2026-10-01）。
 *
 * 这里原来有一条 BARE_PATH_RE，专门在「落盘说明」那一行里补 `Saved: out/report.pdf`
 * 这类无前缀相对路径。现在整条路删掉，理由是**基准目录客户端拿不到**：
 *
 *  · 相对路径相对的是**命令执行时的当前工作目录**，不是会话工作区。
 *    `cd sub && python x.py` 里脚本写的 `out/a.png` 落在 `sub/out/a.png`，
 *    而卡里按工作区拼成 `<cwd>/out/a.png` —— 指向一个**别处的**文件（存在时
 *    打开错文件，不存在时打开空白页，两种都比"不显示"更糟）。
 *  · 同一形态还有 `./` `../`（RESULT_PATH_RE 里也已去掉前缀）。实测数据里这类
 *    条目**没有一条是产出**：`../ui-chat/README.zh.md` 是文档正文里的相对链接，
 *    被工具结果原样回显后捞进来的。
 *  · `open-preview` 那侧的 `fileAddressFor` 同样把相对路径当「相对会话工作区」
 *    解析，两边假设不一致，修一边没用。
 *
 * 代价：脚本用相对路径落盘的产出会漏（`Saved: out/report.pdf` 不再上卡）。
 * 这是刻意的取舍 —— 这张卡的全部价值是「点一下就看见」，列出点开是错文件的条目
 * 比不列更伤。要收这类产出，模型应当用绝对路径或 `present` 显式交付（该工具
 * 的路径走 ARG_PATH_TOOLS，不受本条影响）。
 */

/** 捕获到的路径是否真的像路径（至少含一个分隔符，排除正文里的纯文件名）。 */
function hasSeparator(path: string): boolean {
  return path.includes('/') || path.includes('\\')
}

/**
 * DSH 自己的 **spill 目录**（`%TEMP%/dsh-spill-<6 位>/session-<12 位 hex>/`）。
 *
 * 工具结果超过阈值时，DSH 把完整结果落到这里，正文只留「preview + 定位路径」。
 * 这条路径**必然**出现在结果文本里，而它既不是用户要的东西、点开也没有意义
 * （一串哈希文件名的临时文件），必须整类排除。
 *
 * 目录形态是 DSH 的固定契约（见 @deepseek-ai/dsh-spill-local 的
 * DEFAULT_ROOT_PREFIX 与 SESSION_DIR_RE），所以按前缀认是可靠的。
 */
const SPILL_PATH_RE = /[/\\]dsh-spill-[^/\\]*[/\\]/i

/**
 * 「落盘动词」：结果文本里出现它，才说明**紧跟的路径是被写出来的**。
 *
 * 这条闸门是给命令行工具（pwsh / bash / exec_command…）用的，也是这个模块最
 * 重要的一道过滤。原因：命令的输出里出现路径的场景**绝大多数不是产出** ——
 * `Get-ChildItem`、`ls -R`、`git status`、`dir`、`grep` 都会把一堆已有文件
 * 列出来，其中还包括**别的会话生成的文件**。无差别扫描等于把"看到的"当成
 * "做出来的"，用户看到的就是「产出物里出现了我没生成过的文件」。
 *
 * 真正需要靠结果文本才能拿到路径的场景只有一类：**脚本自己落盘**
 * （Blender 渲染、Python 画图、ffmpeg 导出）—— 这类输出必然带一句落盘说明
 * （`Saved: '…'`、`已保存到 …`）。所以认这句说明就够，且不会误伤列表输出。
 *
 * 表里几个不显眼的形态都是实测补的：
 *  · `Output #0, mp4, to 'out/video.mp4':` —— ffmpeg 的落盘行，没有 saved/导出
 *    这类词，漏了它整批 ffmpeg 产出都进不了卡；
 *  · `Figure saved to …` —— matplotlib 的写法，靠 `saved` 命中；
 *  · `wrote out/result.csv` —— 自定义脚本的简写。
 */
const SAVE_VERB_RE = /(?:保存(?:到|至|成|在|为)|已保存|写入(?:到|至|了)?|已写入|输出(?:到|至|了)|已输出|导出(?:到|至|了)?|已导出|生成(?:到|至|了)|已生成|落盘|下载到|另存为|\bsaved\b|\bwritten\b|\bexported\b|\bwrote\b|\bwriting\b|\boutput\s+file\b|\bgenerated\b|\bstored\s+at\b|\bto\s+['"]?[^\s'"]+\.(?:mp4|mkv|mov|webm|mp3|wav|png|jpe?g|gif|pdf)\b)/i

/**
 * 落盘说明所在的**行**才允许取路径；命中后连同**下一行**一起看。
 *
 * 为什么带一行：`ffmpeg`、`blender` 这类工具常把说明与路径分行打印
 * （`Saved:` 换行后才是文件名）。多带一行能兜住，而"整份文本只要含动词就全取"
 * 又太松（列表输出里只要有一行提到"保存"就全放行了）。
 *
 * ⚠ 下一行的**前缀路**（盘符/斜杠）不再无条件放行 —— 见 pathsInSaveContext 的
 * 返回值与调用点。2026-10-01 实测：读源码时注释行写着「脚本自己落盘」，它命中
 * 动词闸门，而**下一行**恰好是 ` * 理由是 \`/index.html\` 那个 BUG` —— 于是这个
 * 与产出毫无关系的 `/index.html` 进了卡，点开正是用户报的「空白 tab」。
 * 分行动印（`Saved:` 单独一行、路径在下一行）保留，但它必须自己像路径。
 */
function pathsInSaveContext(text: string): { readonly sameLine: readonly string[]; readonly nextLine: readonly string[] } {
  const lines = text.split('\n')
  const sameLine: string[] = []
  const nextLine: string[] = []
  for (const [index, line] of lines.entries()) {
    if (!SAVE_VERB_RE.test(line)) continue
    // 注释/引用行整行跳过：读源码、读文档时正文里满是「落盘 / 写入 / 导出」，
    // 而它们所在的注释行常在同一行里就带着示例路径（`* 例：已保存到 D:/a.png`）。
    // 真实的落盘输出不会以注释标记开头。
    if (isCommentLikeLine(line)) continue
    sameLine.push(line)
    const next = lines[index + 1]
    if (next !== undefined) nextLine.push(next)
  }
  return { sameLine, nextLine }
}

/**
 * 这一行是否以注释/引用标记开头（代码注释、Markdown 引用块、HTML 注释）。
 *
 * ⚠ 必须先剥掉**检索输出的行号前缀**。2026-10-01 端到端实测：grep 的命中行是
 * `190:    * 都不落盘：…`，那个 `190:` 让整行不再以 `*` 开头，于是这道门放行、
 * 落盘动词又命中，随后的源码行被当成落盘上下文 —— 读自己源码时卡里就多出
 * 一堆 `D:/out/a.png`、`/报告.pdf` 这类**文档示例路径**。
 * 行号形态按 ripgrep / grep -n / Select-String 三种实际输出取：`数字:`、`数字-`、
 * `路径:数字:`。
 * @param line - 结果文本里的一行。
 * @returns 是否是注释/引用行。
 */
function isCommentLikeLine(line: string): boolean {
  const stripped = line
    .trim()
    // `190:` / `190-`（grep -n、ripgrep 的上下文行用 `-`）
    .replace(/^\d+[:\-]/, '')
    // `src/x.ts:190:` / `src\x.ts:190:`（Select-String、ripgrep 带文件名）
    .replace(/^[^\s:]+:\d+[:\-]/, '')
    .trim()
  return /^(?:\*|\/\/|#|<!--|--)/.test(stripped)
}

/**
 * 一行文本是否**自己就写着一条绝对路径**（盘符或斜杠开头）。
 *
 * 给「落盘说明的下一行」用的判据：分行动印确实存在（`Saved:` 换行后是路径），
 * 但只有这一行本身像路径，才认它。否则读源码/读文档时任何含「落盘 / 写入 /
 * 导出」的说明行都会把下一行的示例路径拖进卡。
 *
 * 判据取「自证前缀」而**不是** `scan()` 的全集：裸斜杠在正文里到处是
 * （Markdown 链接、URL path 段、代码注释），必须靠动词那句的自证来兜。
 */
function looksLikeOwnPathLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  // 以注释/引用标记开头的行不是落盘输出（` * …`、`// …`、`# …`、`<!-- …`，
  // 含 grep 行号前缀的形态）。
  if (isCommentLikeLine(line)) return false
  // 行号前缀同样要剥掉再看路径：`12: D:/out/a.png` 是一条落盘输出。
  const body = trimmed.replace(/^\d+[:\-]/, '').replace(/^[^\s:]+:\d+[:\-]/, '').trim()
  return /^[A-Za-z]:[\\/]/.test(body) || /^\\\\/.test(body) || body.startsWith('/')
}

/**
 * 命令原文里是否存在**写入语义**。
 *
 * 这是「证据 2」的前置闸门：证据 2 的判据是「文件名在命令里被写出」，但**查询**、
 * **打印**、**断言**同样会把文件名写出来（`"stat": "AGENTS.md"`、`Test-Path a.png`），
 * 光看名字无法区分。加一道写入动词后，只有真的要落盘的命令才会放行。
 *
 * 取的都是各 shell 里**唯一指向写操作**的形态：
 *  · 重定向 `>` / `>>` / `-OutFile` / `-o ` / `--output` —— 最硬的自证；
 *  · `Join-Path` + `Save(` / `.Save` / `WriteAllText` 这类 .NET 落盘 API；
 *  · `Set-Content` / `Out-File` / `New-Item` / `Copy-Item` / `Move-Item` /
 *    `tee` / `dd of=` / `cp` / `mv` / `install`；
 *  · Python 的 `savefig` / `open(..., 'w')` / `cv2.imwrite`；
 *  · ffmpeg / blender 的输出参数。
 *
 * 刻意**不**包含 `Test-Path` / `Get-Item` / `Select-String` / `cat` / `type` ——
 * 那些是读操作，正是要挡掉的那一类。
 *
 * @param command - 命令原文。
 * @returns 是否像「要写文件」的命令。
 */
function hasWriteIntent(command: string): boolean {
  return WRITE_INTENT_RE.test(command)
}

/** 写入语义正则（见 hasWriteIntent 的逐条说明）。 */
const WRITE_INTENT_RE = new RegExp([
  // 重定向与显式输出参数
  String.raw`(?:^|[^>])>{1,2}(?!&)`,
  String.raw`-OutFile\b`,
  String.raw`(?:^|\s)-o\s`,
  String.raw`--output(?:-document|-dir|-file)?[=\s]`,
  // PowerShell / .NET 落盘
  String.raw`\bSet-Content\b`, String.raw`\bAdd-Content\b`, String.raw`\bOut-File\b`,
  String.raw`\bNew-Item\b`, String.raw`\bCopy-Item\b`, String.raw`\bMove-Item\b`,
  String.raw`\bJoin-Path\b`, String.raw`\bSave\s*\(`, String.raw`\.Save\s*\(`,
  String.raw`\bWriteAllText\b`, String.raw`\bWriteAllBytes\b`, String.raw`\bDownloadFile\b`,
  String.raw`\bStart-BitsTransfer\b`, String.raw`\bInvoke-WebRequest\b`,
  // POSIX
  String.raw`\btee\b`, String.raw`\bdd\b[^\n]*\bof=`, String.raw`\bcp\b`, String.raw`\bmv\b`,
  String.raw`\binstall\b`, String.raw`\btouch\b`, String.raw`\bmkdir\b`,
  // Python / 脚本
  String.raw`\bsavefig\s*\(`, String.raw`\bimwrite\s*\(`, String.raw`\bopen\s*\([^)]*['"][wa]`,
  String.raw`\bto_csv\s*\(`, String.raw`\bto_excel\s*\(`, String.raw`\bwrite_text\s*\(`,
  // Node（run_code 代码体里的落盘 API，2026-10-04 补）：生图/脚本轮次里模型最常
  // 写的就是 fs.writeFileSync / writeFile / createWriteStream；mkdirSync 单独不算
  // 写文件，但它几乎总是与写盘代码同现，作为写入语义的弱证据放行（文件名仍要
  // 在代码里被写出、路径仍要过落盘说明或证据 2 两道门，不会单靠它放行）。
  String.raw`\bwriteFile(?:Sync)?\s*\(`, String.raw`\bcreateWriteStream\s*\(`,
  String.raw`\bcopyFileSync\b`, String.raw`\brenameSync\b`, String.raw`\bcpSync\b`,
  String.raw`\bmkdirSync\b`,
  // 媒体工具
  String.raw`\bffmpeg\b`, String.raw`\bblender\b`,
].join('|'), 'i')

/**
 * 从命令原文里取**被显式写出的文件名**（basename 集合）。
 *
 * 这是给命令行产出用的第二道正向证据。有些命令的落盘路径是**变量拼出来的**
 * （`$out = Join-Path $dir '验收图.png'; $bmp.Save($out, ...)`），结果里只有
 * `FullName : D:\...\验收图.png` 这样的字段，一句落盘说明都没有 —— 只认落盘
 * 说明会把这类真产出整批漏掉（实测：生成测试图那一轮就是这么丢的）。
 *
 * 但文件名只要**在命令里被写出**，就说明模型确实指定了这个产物；而
 * `Get-ChildItem` / `ls -R` / `git status` 这类列表命令里，被列出来的文件名
 * （尤其是**别的会话生成的文件**）绝不会出现在命令原文里 —— 这正是用户报的
 * 「产出物里出现不是我这次生成的文件」的根因。
 *
 * ⚠ 光有名字还不够，命令必须带**写入语义**（见 hasWriteIntent）。2026-10-01
 * 端到端实测到的反例：一条脚本里写了 `"stat": "AGENTS.md"`（把探测的路径名打印
 * 出来），脚本又把 `"abs": "D:\\AI\\Dsh\\AGENTS.md"` 打到了结果里 —— 名字在命令
 * 里、路径在结果里，两道闸门全过，于是一个**只读**的 AGENTS.md 被当成产出物。
 * 「名字被提到」与「文件被写出来」是两件事，字符串字面量无法区分，只能看动词。
 *
 * 只取带扩展名的 token：`*.png` 这种通配符天然匹配不上具体文件名，是刻意的
 * 保守取舍（宁可漏，不可误报）。
 */
function namesInCommand(command: string): ReadonlySet<string> {
  const names = new Set<string>()
  if (command === '') return names
  if (!hasWriteIntent(command)) return names
  for (const match of command.matchAll(/[^\s"'`,;，。；、）)\]}>|/\\]+/g)) {
    const token = match[0]
    const dot = token.lastIndexOf('.')
    if (dot <= 0 || dot === token.length - 1) continue
    names.add(token.toLowerCase())
  }
  return names
}

/**
 * **中转临时路径**：工作区根下的 `_tmp/` 目录。
 *
 * 为什么整类不列（2026-10-01）：这是本工作区的**一次性中间产物**约定目录
 * （临时脚本、探针、抓取结果、截图），dsh-webui 的清理器会定期自动清空它。
 * 于是卡里那些 `_tmp/...` 条目**注定会烂**：实测 33/80 条失效路径来自这里，
 * 点开是空白页。中转产物的正确归宿是 `present` 显式交付（搬到最终位置），
 * 只写到 `_tmp/` 就没人认领它 —— 不列比列一条点不开的更有用。
 *
 * 例外：模型**显式交付**（`present`）的路径照列，哪怕它在 `_tmp/` 下 ——
 * 那是模型自己声明的最终位置，判断权不在客户端。
 */
const TRANSIENT_DIR_RE = /(?:^|[/\\])_tmp[/\\]/i

/**
 * _tmp/ 下仍要列出的类别：媒体成品（2026-10-04）。
 *
 * 生图 / 生视频 / 脚本渲染（ffmpeg、matplotlib、Blender）的落点经常就是工作区
 * _tmp/，而这类产出**没有别的出口**：generate_image 只回 b64，模型把它写进
 * _tmp/ 再 read_image 核对就是完整闭环，不会再多一步 present 交付。整类排除
 * _tmp/ 等于把整轮媒体产出从卡里抹掉（用户 2026-10-04 报的「产出物 0 项」）。
 * 失效风险交给核对层兜底：文件真被清理器删掉后，probeWorkspaceFile 会把它
 * 从渲染清单里剔除。文档/表格/压缩包等仍按原约定排除（它们的中转形态确实没人认领）。
 */
const TRANSIENT_MEDIA_EXEMPT: ReadonlySet<OutputKind> = new Set(['image', 'video', 'audio'])

/** 这条路径是否落在一次性中转目录里。 */
export function isTransientOutputPath(path: string): boolean {
  return TRANSIENT_DIR_RE.test(path)
}

/** 路径里的扩展名（小写、不带点）；没有则空串。 */
function extOf(path: string): string {
  const base = path.split(/[/\\]/).filter(Boolean).at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 路径 → 类别。认不出来返回 'other'（调用方据此丢弃）。 */
export function classifyOutput(path: string): OutputKind {
  return KIND_BY_EXT[extOf(path)] ?? 'other'
}

/** 路径最后一段（上屏用的文件名）。 */
export function outputNameOf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
}

/* ── 路径归一化与去重键 ───────────────────────────────────────────────── */

/**
 * 归一化一条从文本里捞出来的路径。
 *
 * 主要处理一件事：工具结果常是 JSON 编码的，路径里的分隔符被转义成了
 * `\\`（`"D:\\a\\b.png"`）。不折叠的话同一条路径会因为写法不同去重失败，
 * 点开预览也会拿到一个带双反斜杠的非法地址。
 *
 * UNC 前缀（`\\server\share`）在这种折叠下会被压成 `\server\share`。这是已知的
 * 取舍：这张卡的实际产出几乎全是盘符路径，为它单独开一条分支不划算。
 */
export function normalizeOutputPath(raw: string): string {
  const trimmed = raw.trim().replace(/[.。]+$/, '')
  if (!trimmed.includes('\\\\')) return trimmed
  return trimmed.replace(/\\{2,}/g, '\\')
}

/** 去重键：分隔符与大小写都归一（Windows 盘符大小写不敏感）。 */
function dedupeKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/* ── 工具白名单 ───────────────────────────────────────────────────────── */

/**
 * **参数里声明的路径**可以算产出的工具（路 1，最准）。
 *
 * 判据是「这个参数写的就是**这次要做出来的东西**」：
 *  · write / edit / apply_patch / str_replace_editor —— 参数就是要写的目标文件；
 *  · download —— output / dest 是落盘位置；
 *  · present —— 参数就是要交付给用户的那几个文件。
 *
 * 刻意不在内：
 *  · **上传类**（browser_set_input_files / file_upload）—— 它的 paths 参数是
 *    **源文件**（用户本来就有的东西），把它当产出物等于把"用户给我的"说成
 *    "我做出来的"。
 *  · **命令行类**（pwsh / bash / exec_command…）—— 参数是命令原文，里面出现
 *    的路径多半是**输入**（`python script.py`、`ffmpeg -i in.mp4`），认了就会
 *    把源文件当产出。命令行真正的产出走结果路的「落盘说明」。
 */
const ARG_PATH_TOOLS = new Set([
  'write', 'edit', 'apply_patch', 'str_replace_editor',
  'download', 'present',
])

/**
 * **结果文本里**出现的成品路径可以算产出的工具（路 2）。
 *
 * 命令行类在这一路里，但只认「落盘说明」那几行（见 pathsFromResult）：
 * 脚本自己落盘（Blender 渲染、Python 画图、ffmpeg 导出）是这一类工具产出文件的
 * 唯一线索 —— 它的路径不会出现在参数里。
 *
 * read / grep / glob / web_* / browser_* 刻意不在内：它们的结果里出现的路径是
 * 「看到的东西」，不是「做出来的东西」。
 */
const RESULT_PATH_TOOLS = new Set([
  'write', 'edit', 'apply_patch', 'str_replace_editor',
  'download', 'present',
  'generate_image', 'generate_video',
  'bash', 'pwsh', 'exec_command', 'shell', 'terminal', 'terminal_send',
  // run_code（2026-10-04 补）：DSH 的 PTC 沙箱工具，模型在**代码体**里调
  // generate_image / fs.writeFileSync 落盘是它最主要的产出形态 —— 路径只出现在
  // 代码与打印结果里，参数里只有 code/description。不收它，整轮生图/脚本落盘的
  // 产出在卡里就是 0 项（用户 2026-10-04 报的「产出物 png 不显示」）。
  // 它的「命令原文」取 code 字段（见 extractFromBlock），证据 2 的两道闸门
  // （文件名被写出 + 写入语义）原样生效，列表/打印类代码依然进不来。
  'run_code',
])

/** 删除类：它确实动了文件，但产出物卡讲的是「做出来了什么」，删掉的不算。 */
const DELETING_TOOLS = new Set(['delete_file', 'rm', 'unlink', 'remove'])

/** 单条调用最多收多少条路径：防住 `dir D:\images` 这种把整个目录刷上屏。 */
const MAX_PER_CALL = 8

/** 工具名归一：剥掉命名空间前缀与大小写差异。 */
function normalizeToolName(name: string): string {
  const lower = name.trim().toLowerCase()
  const tail = lower.split(/[.:/]/).filter(Boolean).at(-1)
  return tail ?? lower
}

/* ── 按节点缓存 ───────────────────────────────────────────────────────── */

/**
 * 单个工具节点的提取结果。
 *
 * 快照发布的频率在流式期很高（每个 delta 一次），而扫结果文本是这条链路上
 * 最贵的一步（正则逐条跑）。节点对象在 React 不可变更新下引用稳定，所以按
 * 对象缓存是安全的：只有新增或真的变了的节点会被重算。
 */
const perNodeCache = new WeakMap<object, readonly ExtractedItem[]>()

/* ── 提取 ─────────────────────────────────────────────────────────────── */

/** 递归收集一个调用树的全部调用（root + subCalls）。 */
function collectBlocks(root: ToolCallBlock): ToolCallBlock[] {
  const out: ToolCallBlock[] = [root]
  for (const child of root.subCalls) out.push(...collectBlocks(child))
  return out
}

/** 从参数里取字符串（单个或数组的第一项）。 */
function argString(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Array.isArray(value)) {
      const picked = value.find((item): item is string => typeof item === 'string' && item.trim() !== '')
      if (picked !== undefined) return picked.trim()
    }
  }
  return undefined
}

/**
 * 参数里所有字符串路径（数组全取，用于 present 的多文件形态）。
 *
 * 两种形态都要认：
 *  · **字符串数组** —— `paths: ['a.png', 'b.png']`；
 *  · **对象数组** —— `present` 的 `files: [{ path, description }]`。这是官方
 *    present 工具的唯一入参形态，不认对象就等于**交付物永远进不了这张卡**：
 *    卡里只剩下 download 的中转路径（`_tmp/…`），用户点开的是已经被搬走的旧位置。
 */
function argPaths(args: Record<string, unknown>, ...keys: string[]): string[] {
  const out: string[] = []
  const take = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.trim() !== '') out.push(value.trim())
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) take(item)
      return
    }
    // present 的 files 是 `{ path, description }`：只取路径字段，描述不上屏。
    const record = recordOf(value)
    if (record !== null) take(record.path ?? record.file_path ?? record.filePath)
  }
  for (const key of keys) take(args[key])
  return out
}

/** 对象判定（数组不算对象）。 */
function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * 结果文本里所有成品路径（按出现顺序，去重）。
 *
 * **两道正向证据，满足其一才收**：
 *  1. **落盘说明**（`Saved:` / `已保存到` / `Exported to`…）所在行及其下一行 ——
 *     脚本自己落盘时必然会打印这类说明；
 *  2. **文件名在命令原文里被显式写出** —— 兜住"路径由变量拼出来、结果里只剩
 *     `FullName : …` 字段"的那类命令（实测生成测试图那一轮就是这样）。
 *
 * 两条合起来，`Get-ChildItem` / `ls -R` / `git status` 这类**列表命令**就完全
 * 进不来了：它们的输出里全是已有文件（其中还包括别的会话生成的），而命令原文
 * 里一个具体文件名都没有 —— 这正是用户报的 BUG 的根因。
 *
 * spill 临时目录的排除不在这里做：两条路（参数 / 结果文本）都会经过
 * extractFromBlock 末尾那一处统一过滤，只在那边挡一次。
 *
 * @param text - 工具结果文本。
 * @param command - 该调用的命令原文（命令行工具才有；用于第二道证据）。
 * @returns 成品路径（已归一化、已去重）。
 */
function pathsFromResult(text: string, command = ''): string[] {
  if (text === '') return []
  // URL 先抹成等长空白：正则里的分隔符前缀会把 https://cdn/a.png 从 //cdn 起
  // 匹配出一个看着像相对路径、点开必然 404 的片段。
  const scrubbed = text.replace(
    /[a-z][a-z\d+.-]*:\/\/[^\s"'`,;，。；、）)\]}>]*/gi,
    (match) => ' '.repeat(match.length),
  )
  const declaredNames = namesInCommand(command)
  const found: string[] = []
  const seen = new Set<string>()

  /**
   * 扫一段文本，收下其中像路径的捕获组。
   *
   * 两处过滤，缺一条都会捞出错路径：取的是**捕获组 1**（左边界那个字符只是锚，
   * 不能算进路径），再用 `hasSeparator` 挡掉正文里的纯文件名引用（`report.md`）。
   *
   * `regexes` 由调用方给：证据 1 走「盘符 + 裸斜杠」两条，证据 2 只走盘符那条
   * （裸斜杠在证据 2 里是 URL path 段的同构形态，整类禁掉，见 SLASH_PATH_RE）。
   */
  const scan = (source: string, regexes: readonly RegExp[]): string[] => {
    const out: string[] = []
    for (const regex of regexes) {
      for (const match of source.matchAll(regex)) {
        const captured = match[1]
        if (captured === undefined || captured === '') continue
        const path = normalizeOutputPath(captured)
        if (path === '' || !hasSeparator(path)) continue
        out.push(path)
      }
    }
    return out
  }

  const add = (path: string): void => {
    const key = dedupeKey(path)
    if (seen.has(key)) return
    seen.add(key)
    found.push(path)
  }

  const DECLARED_PREFIX_RE = [RESULT_PATH_RE]
  const ALL_PREFIX_RE = [RESULT_PATH_RE, SLASH_PATH_RE]

  /*
   * 证据 1：落盘说明所在的上下文行。
   *
   * 两段用**不同**的正则集：
   *  · 同一行 —— 动词与路径写在一起（`Saved: D:/out/a.png`、`to '/tmp/v.mp4':`），
   *    整行可信，走全集（含裸斜杠，Unix 绝对路径落在这里）。
   *  · 下一行 —— 仅当那一行**自己就像一条绝对路径**时才看，且仍只认自证前缀。
   *    这是 2026-10-01 的补丁：不设这道门，读源码时「落盘」出现在注释里就会把
   *    下一行的示例路径（`/index.html`）收进卡。
   */
  const save = pathsInSaveContext(scrubbed)
  for (const line of save.sameLine) {
    for (const path of scan(line, ALL_PREFIX_RE)) add(path)
  }
  for (const line of save.nextLine) {
    if (!looksLikeOwnPathLine(line)) continue
    for (const path of scan(line, DECLARED_PREFIX_RE)) add(path)
  }

  // 证据 2：结果里出现的路径，其**文件名**在命令原文里被显式写过。
  // 只认盘符路径 —— 裸斜杠在这条通道里会把 `GET /index.html -> 404` 这种
  // URL 探活结果收成产出物（2026-10-01 实测的 BUG），见 SLASH_PATH_RE。
  if (declaredNames.size > 0) {
    for (const path of scan(scrubbed, DECLARED_PREFIX_RE)) {
      const base = (path.split(/[/\\]/).filter(Boolean).at(-1) ?? '').toLowerCase()
      if (base === '' || !declaredNames.has(base)) continue
      add(path)
    }
  }

  return found
}

/** 一条调用 → 产出物条目（可能 0 条）。 */
function extractFromBlock(block: ToolCallBlock): readonly ExtractedItem[] {
  if (isRunning(block)) return []
  if (block.isError) return []
  const raw = callName(block)
  const name = normalizeToolName(raw)
  if (name === '' || DELETING_TOOLS.has(name)) return []

  // present 是**显式交付**：它的参数就是最终交付位置，权威性高于任何中转落盘。
  const delivered = name === 'present'
  const paths: string[] = []
  const args = argFields(toolArgsRaw(block))

  // 路 1：参数里声明的目标路径（最准，优先）。
  if (ARG_PATH_TOOLS.has(name)) {
    // present 的多文件形态：files 是 `{ path, description }[]`，path / paths 是裸字符串。
    const declared = argPaths(args, 'file_path', 'filePath', 'path', 'paths', 'files', 'output', 'dest')
    for (const item of declared) paths.push(item)
  }

  // 路 2：结果文本里带正向证据的成品路径（脚本产出的唯一来源）。
  if (RESULT_PATH_TOOLS.has(name)) {
    // 命令原文只在命令行工具上取：它是「文件名被显式写出」这道证据的来源。
    // run_code 没有 command 字段，它的等价物是 **code 代码体**：文件名与写入
    // 语义（fs.writeFileSync 等）都写在里面，证据 2 的两道闸门对它同样成立。
    const command = typeof args.command === 'string'
      ? args.command
      : (typeof args.code === 'string' ? args.code : '')
    for (const item of pathsFromResult(resultText(block), command)) paths.push(item)
  }

  const out: ExtractedItem[] = []
  const seen = new Set<string>()
  for (const item of paths) {
    const path = normalizeOutputPath(item)
    if (path === '') continue
    // spill 临时文件既不是产出、也没有查看价值：两条路都统一在这里挡掉。
    if (SPILL_PATH_RE.test(path)) continue
    const kind = classifyOutput(path)
    if (kind === 'other') continue
    // 一次性中转目录：只写到 _tmp/ 就没人认领它，而清理器会把它清掉 ——
    // 列出来等于列一条注定点不开的路径。模型显式交付的除外（它自己声明了
    // 最终位置，判断权不在客户端）。
    // **媒体类豁免**（2026-10-04）：生图 / 生视频 / 脚本渲染的成品落点常常就是
    // 工作区 _tmp/（本工作区的一次性产物约定目录），整类排除会让整轮生图在
    // 产出物卡上显示「0 项」—— 用户最想看见的那批文件恰恰全在 _tmp/ 里。
    // 清理器是**定期**跑、不是即时删：会话期间文件必然在磁盘上；真被清掉之后
    // 由卡片的核对层（probeWorkspaceFile → gonePaths）把条目剔除，不会留点不
    // 开的行。文档/表格/压缩包等仍按原约定排除（它们的中转形态确实没人认领）。
    if (!delivered && isTransientOutputPath(path) && !TRANSIENT_MEDIA_EXEMPT.has(kind)) continue
    const key = dedupeKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, name: outputNameOf(path), kind, delivered })
    if (out.length >= MAX_PER_CALL) break
  }
  return out
}

/** 一个工具节点 → 产出物条目（带缓存）。 */
function extractFromNode(tool: unknown): readonly ExtractedItem[] {
  if (typeof tool !== 'object' || tool === null) return []
  const cached = perNodeCache.get(tool)
  if (cached !== undefined) return cached
  const root = (tool as { data?: { root?: ToolCallBlock } }).data?.root
  let result: readonly ExtractedItem[] = []
  if (root !== undefined) {
    try {
      const out: ExtractedItem[] = []
      for (const block of collectBlocks(root)) {
        for (const item of extractFromBlock(block)) out.push(item)
      }
      result = out
    } catch {
      // 未知节点形状不该让整张卡消失：这一条按「没有产出」处理。
      result = []
    }
  }
  perNodeCache.set(tool, result)
  return result
}

/* ── 主入口 ───────────────────────────────────────────────────────────── */

/**
 * 收集会话产出物。
 *
 * 去重分两层：
 *  1. **完整路径**去重（大小写与分隔符归一）；
 *  2. **同名交付优先** —— 同一个文件在会话里往往先落到中转位置、再被搬到最终
 *     位置（download 到 `_tmp/` 后 move 到 `docs/`）。两条路径 basename 相同、
 *     完整路径不同，只按第 1 层去重就会在卡里并排留一条**已经失效**的旧路径，
 *     用户点到就是「文件不存在」。所以 `present` 声明的交付路径会**顶掉**同名
 *     的非交付路径；两条都是交付（或都不是）时视为两个真实文件，都保留。
 *
 * @param toolNodes - 会话里的 tool-call 节点（顺序即首见顺序，调用方按
 *   anchorSeq 升序给；见 collectSessionToolNodes）。
 * @returns 成品与代码文件两份清单。
 */
export function collectOutputs(toolNodes: readonly unknown[]): OutputsView {
  if (toolNodes.length === 0) return EMPTY_VIEW
  const items: ExtractedItem[] = []
  const code: string[] = []
  const seenPath = new Set<string>()
  const seenCode = new Set<string>()
  /** basename（小写）→ items 下标：用于「交付路径顶掉同名中转路径」。 */
  const baseIndex = new Map<string, number>()

  for (const tool of toolNodes) {
    for (const entry of extractFromNode(tool)) {
      const key = dedupeKey(entry.path)
      if (entry.kind === 'code') {
        if (seenCode.has(key)) continue
        seenCode.add(key)
        code.push(entry.path)
        continue
      }
      if (seenPath.has(key)) continue

      const base = entry.name.toLowerCase()
      const prior = baseIndex.get(base)
      if (prior !== undefined) {
        const kept = items[prior]
        if (kept !== undefined && kept.delivered !== entry.delivered) {
          if (entry.delivered) {
            // 显式交付顶掉同名中转路径：原地替换，保住首见顺序。
            items[prior] = entry
          }
          // 反向（已有交付、又来一条中转）直接丢弃，不上屏。
          seenPath.add(key)
          continue
        }
      }

      baseIndex.set(base, items.length)
      items.push(entry)
      seenPath.add(key)
    }
  }
  return { items, code }
}

/**
 * 从会话快照里取全部 tool-call 节点，按 anchorSeq 升序。
 *
 * 两条路都走（nodes.values + order）：与 collectTurnNodes 同样的理由 ——
 * 收口 / compact 之后官方会把一部分节点从 order 里摘掉，只扫 order 会漏。
 * 节点对象身份去重，同一个节点不会被收两次。
 */
export function collectSessionToolNodes(snapshot: unknown): readonly unknown[] {
  if (snapshot === null || snapshot === undefined) return []
  const snap = snapshot as {
    nodes?: { values?: () => Iterable<unknown>; get?: (key: string) => unknown }
    order?: unknown
  }
  const collected: { seq: number; node: unknown }[] = []
  const push = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    if ((node as { kind?: unknown }).kind !== 'tool-call') return
    const seq = (node as { anchorSeq?: unknown }).anchorSeq
    collected.push({ seq: typeof seq === 'number' ? seq : Number.MAX_SAFE_INTEGER, node })
  }

  try {
    if (typeof snap.nodes?.values === 'function') {
      for (const node of snap.nodes.values()) push(node)
    }
  } catch { /* 形状未知时退到 order 那条路 */ }
  try {
    if (Array.isArray(snap.order)) {
      for (const key of snap.order) {
        if (typeof key === 'string') push(snap.nodes?.get?.(key))
      }
    }
  } catch { /* ignore */ }

  collected.sort((a, b) => a.seq - b.seq)
  const seen = new Set<unknown>()
  const out: unknown[] = []
  for (const entry of collected) {
    if (seen.has(entry.node)) continue
    seen.add(entry.node)
    out.push(entry.node)
  }
  return out
}

/** 内容指纹：给调用方做引用稳定化，避免下游 memo 每帧被击穿。 */
export function outputsFingerprint(view: OutputsView): string {
  return `${view.items.map((item) => item.path).join('|')}#${view.code.join('|')}`
}
