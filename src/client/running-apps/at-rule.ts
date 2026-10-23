/**
 * dsh-chat-plus — 修「普通对话里的 @ 被误渲染成蓝色文件芯片」。
 *
 * ## 症状
 *
 * 用户在对话里发一句普通中文：「@的时候不是实时获取的」，结果那段变成一枚
 * **蓝色芯片**（带虚线下划线 = 文件无效）。
 *
 * ## 根因（在官方 ui-reference 里，不是本插件）
 *
 * 官方 fileReferenceRule 的正则是：
 *
 *     /(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu
 *
 * 判据只有两条：① @ 前面是行首或空白；② @ 后面跟着一串非空白字符。
 * **完全不要求那串东西像路径** —— 中文、纯文字全都算。于是任何「@ 紧贴文字」
 * 的写法（中文里极常见，因为中文不打空格）都会被认成文件引用，文件当然不存在，
 * 于是渲染成 invalid 芯片（蓝色 + 虚线下划线）。
 *
 * ## 怎么修（不改官方源码）
 *
 * 官方规则无法注销（register 返回的 disposer 只能卸自己注册的），同 id 覆盖
 * 也会因「duplicate key」抛错。所以走**抢位**：
 *
 *  · user-text 的求值是「所有规则各自前向匹配，每次取 start 最小的候选；start
 *    相同时**按 order 升序先到先得**」（见 UserTextDocument.reconcile）；
 *  · 官方 file / folder 规则的 order 都是 30；
 *  · 本模块注册一条 order = 1 的规则，专门找「@ 后面不像路径」的位置，并返回
 *    一个 **text 节点**把那个 @ 覆盖成普通文字；
 *  · 于是同一位置官方规则竞争不过（start 相同、我方 order 更小），那个 @ 就
 *    老老实实当普通文字渲染。
 *
 * 只覆盖 @ 这一个字符（不是整段）是关键：官方规则的 nextPath 从 cursor 继续
 * 前向匹配，而 @ 后面那个字前面已经不再是空白，(?<!\S) 不成立，自然不再命中。
 * 覆盖整段会破坏后面的空白折叠与既有引用节点。
 *
 * ## 判据（什么算「像路径」）
 *
 * 只有满足下面任一条才让官方规则接管：
 *  1. **带引号** @"..." —— 官方就是用它表示含空格的路径，用户显式加引号
 *     说明他确实在指一个路径；
 *  2. 含**路径分隔符** / 或 \（如 @src/main.ts、@D:\\a\\b）；
 *  3. 含**扩展名点**（如 @README.md、@package.json）；
 *  4. 是**纯 ASCII 标识符/路径字符**且长度 ≥ 2（如 @goal、@src）——
 *     官方菜单插进来的裸目录名就是这种。
 *
 * 反例（不再变成芯片）：@的时候、@帮我看看、@然后 —— 含 CJK 且没有分隔符、
 * 没有扩展名，一律当普通文字。
 *
 * ## 为什么还要保留「纯 ASCII」这一条
 *
 * 官方菜单选中一个**没有扩展名的文件/目录**时，插进草稿的就是 @src / @LICENSE
 * 这种裸名字。收紧判据不能把它一起干掉，否则「选了文件却显示成普通文字」——
 * 比误判成芯片更让人困惑。
 *
 * @module
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 官方 file 规则的 id（覆盖它必须用同一个 id）。 */
export const FILE_RULE_ID = 'file'

/** 官方 folder 规则的 id。 */
export const FOLDER_RULE_ID = 'folder'

/** 一条被识别出来的路径引用。 */
export interface PathCandidate {
  /** 原文里的起始偏移（含 @）。 */
  start: number
  /** 原文里的结束偏移（不含）。 */
  end: number
  /** 去掉 @ 与引号后的路径。 */
  path: string
  /** 显示用的最后一段。 */
  label: string
}

/**
 * 判据核心：这一段（@ 之后的内容）像不像路径。
 *
 * @param path - 已去掉 @ 与引号的内容。
 * @param quoted - 原文是否带引号（`@"..."` 形式）。
 * @returns 是否认作路径引用。
 */
export function looksLikePath(path: string, quoted: boolean): boolean {
  if (path === '') return false
  // ① 用户显式加引号：他自己表明这是在指一个路径。
  if (quoted) return true
  // 含 CJK（中日韩统一表意文字、假名、谚文）且没有任何路径特征 → 普通中文，不是路径。
  const hasCjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u.test(path)
  const hasSeparator = /[\\/]/u.test(path)
  // 扩展名点：末段里有「.xx」且 .xx 不是纯数字（排除「3.5」这种小数）。
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const lastSegment = path.slice(lastSlash + 1)
  const dotIndex = lastSegment.lastIndexOf('.')
  // ⚠ 扩展名必须以字母开头：排除「3.5」「1.2.3」这类纯数字（否则小数会被当文件名）。
  const hasExtension = dotIndex > 0 && /^[A-Za-z][A-Za-z0-9]{0,9}$/u.test(lastSegment.slice(dotIndex + 1))
  if (hasCjk) {
    // 中文里带分隔符或扩展名的仍然认（`@文档/说明.md`、`@笔记.md`）。
    return hasSeparator || hasExtension
  }
  // ② 分隔符 / ③ 扩展名：任何语言都认。
  if (hasSeparator || hasExtension) return true
  // ④ 纯 ASCII 且长度 ≥ 2：官方菜单插入的裸文件名/目录名。
  // ⚠ 但**纯数字/小数**不算（`@3.5`、`@42` 是用户随口写的数字，不是文件名）；
  //   真文件名至少含一个字母或下划线/连字符之类的标识符字符。
  if (!/[A-Za-z_\-]/u.test(path)) return false
  return /^[A-Za-z0-9_@$~.#+\-]+$/u.test(path) && path.length >= 2
}

/**
 * 在文本里找下一个路径引用（与官方同款的前向匹配语义）。
 *
 * @param text - 完整原文。
 * @param from - 起始偏移（含）。
 * @param wantFolder - true 找目录（以 / 结尾），false 找文件。
 * @returns 命中的候选，或 undefined。
 */
export function nextPathCandidate(text: string, from: number, wantFolder: boolean): PathCandidate | undefined {
  const tokens = /(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu
  tokens.lastIndex = from
  for (let match = tokens.exec(text); match !== null; match = tokens.exec(text)) {
    const token = match[0]
    const quoted = token.startsWith('@"')
    // 未加引号时剥掉尾部的标点（与官方同款：句号逗号不是路径的一部分）。
    const raw = quoted ? token : token.replace(/[.,;:!?，。；：！？、]+$/u, '')
    if (raw.length <= 1) continue
    const path = raw.slice(1).replace(/^"|"$/gu, '')
    if (path === '') continue
    if (path.endsWith('/') !== wantFolder) continue
    if (!looksLikePath(path, quoted)) continue
    const label = path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
    return { start: match.index, end: match.index + raw.length, path, label }
  }
  return undefined
}

/** 构造 guard 规则本体（拆出来是为了让冒烟能直接喂文本对拍 match 的行为）。 */
export function buildGuardRule(): { id: string; order: number; match(text: string, from: number): unknown } {
  return {
    id: GUARD_RULE_ID,
    order: 1,
    match(text: string, from: number) {
      const tokens = /(?<!\S)@/gu
      tokens.lastIndex = from
      for (let m = tokens.exec(text); m !== null; m = tokens.exec(text)) {
        const start = m.index
        const rest = text.slice(start + 1)
        if (rest === '') return undefined
        const end = start + 1 + (rest.match(/^\S*/u)?.[0]?.length ?? 0)
        const token = text.slice(start + 1, end)
        if (token === '') return undefined
        const quoted = token.startsWith('"')
        const path = quoted ? token.replace(/^"|"$/gu, '') : token
        if (looksLikePath(path, quoted)) continue
        return { id: 'text', start, end: start + 1, data: { text: '@' } }
      }
      return undefined
    },
  }
}

/**
 * 本规则在 user-text 规则表里的 id。
 *
 * 必须与官方不同（同 id 会撞 duplicate key），且要一眼看出是哪个插件的。
 */
export const GUARD_RULE_ID = 'dsh-ra-at-guard'

/**
 * 抢在官方 @ 文件规则之前，把「不像路径的 @」盖回普通文字。
 *
 * @param ctx - 客户端根上下文。
 */
export function applyAtGuard(ctx: ClientContext): void {
  // uiConversation 是官方 ui-conversation 提供的根服务；缺失时（老宿主）静默跳过。
  const uiConversation = (ctx as unknown as { get?: (name: string) => any }).get?.('uiConversation') as
    | { userText?: { register?: (rule: unknown) => () => void } }
    | undefined
  const register = uiConversation?.userText?.register
  if (typeof register !== 'function') {
    console.warn('[running-apps] uiConversation.userText 不可用，@ 误判修复未装配')
    return
  }

  const rule = buildGuardRule()

  ctx.effect(() => {
    let dispose: (() => void) | undefined
    try {
      dispose = register(rule)
    } catch (error) {
      console.warn('[running-apps] @ 误判修复规则注册失败：', error)
    }
    return () => { if (dispose !== undefined) dispose() }
  }, 'running-apps: @ guard rule')
}

/** 导出给冒烟直接对拍（判据错了不会报错，只会让普通文字变成芯片、或让真路径变成文字）。 */
export const __test = { looksLikePath, nextPathCandidate, FILE_RULE_ID, FOLDER_RULE_ID, GUARD_RULE_ID, buildGuardRule }

