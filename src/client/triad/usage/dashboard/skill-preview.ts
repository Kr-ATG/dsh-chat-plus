/**
 * skill-preview — 技能文件查看器的纯函数层（无 React，可在测试里直接跑）。
 *
 * 2026-10-20 从 SkillsPanel.tsx 抽出来的原因有两个：
 *
 *  1. **二进制文件曾经整片乱码**。旧链路是「host 一律 `readFile(…, 'utf8')`
 *     → 客户端一律按 markdown 渲染」，PNG 被解成替换字符再套 markdown 样式，
 *     用户点开 `assets/composer-icon.png` 看到一片 `IHDR\0\0…`。修复需要三件事
 *     协同：host 给 MIME + binary 标记、host 另开 raw 子路由回原始字节、
 *     客户端按族分派到 <img>/<video>/<audio>/<iframe>。前两条在
 *     `src/vendor/usage-skill/skills-host.js`，第三条的判据就在这里。
 *  2. 这些判据（扩展名 → 呈现族、相对路径归一、体积格式化）全是纯字符串
 *     逻辑，混在 2000 行的面板组件里既跑不了单测也没法复用（画廊、产出物
 *     卡片以后都可能要同一套）。
 *
 * 这一层刻意不 import React，也不碰 DOM：见 `scripts/test-skill-preview.mjs`。
 */

import { escapeAttr } from '../../../../shared/sanitize-html.ts'

/** HTML 文本转义（属性值请用 {@link escapeAttr}）。 */
function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 二进制文件的呈现族：同一族用同一种原生元素渲染。
 *
 * `none` 表示「知道是二进制，但没有合适的渲染器」——只给一句说明与原生链接，
 * 绝不再退回文本渲染（那正是乱码的来源）。
 */
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'none'

/** 文件扩展名（小写，不带点）；没有扩展名或点开头返回空串。 */
export function extName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/**
 * 扩展名 → 呈现族。
 *
 * 逐扩展名判而不是靠 MIME 前缀：技能文件由第三方包提供，`mime` 是 host 按
 * 扩展名推的（走同一张表）；这里只决定用哪个 DOM 元素，判错最多是降级成
 * 「浏览器打开」，不会执行任何内容。
 */
export function mediaKindOf(path: string): MediaKind {
  switch (extName(path)) {
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp':
    case 'avif': case 'bmp': case 'ico': case 'svg':
      return 'image'
    case 'mp4': case 'webm': case 'mov': case 'm4v':
      return 'video'
    case 'mp3': case 'wav': case 'ogg': case 'm4a': case 'flac': case 'aac':
      return 'audio'
    case 'pdf':
      return 'pdf'
    default:
      return 'none'
  }
}

/**
 * 二进制文件的原始字节地址（host 的 /raw 子路由）。
 *
 * 逐段编码路径，不能整串 encodeURIComponent：那会把 `assets/logo.png` 的
 * 分隔符也编成 %2F，host 端 `decodeURIComponent` 虽能还原，但只要中间某一层
 * 没解码就整条 404。逐段编是唯一稳的写法（与 open-preview 同款）。
 */
export function skillRawUrl(skillName: string, filePath: string): string {
  const segs = filePath.split('/').map(encodeURIComponent).join('/')
  return `/api/skill-manager/skills/${encodeURIComponent(skillName)}/raw/${segs}`
}

/**
 * 相对路径拼接（POSIX 语义）：把 `a/../b.png` 归一成 `b.png`，去掉 `./`。
 *
 * 不引 node:path（浏览器半身没有）：只做技能文件树里会出现的几种情况 ——
 * 相对段、`./`、`../`。结果仍会被 host 的越界防护再拦一次。
 *
 * @param dir - 当前文件所在目录（相对技能根，'' 表示根）。
 * @param rel - markdown 里写的相对路径。
 * @returns 相对技能根的路径。
 */
export function joinRelative(dir: string, rel: string): string {
  const stack = dir === '' ? [] : dir.split('/').filter((part) => part !== '')
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

/** 取一个文件的目录部分（相对技能根；根目录返回 ''）。 */
export function dirNameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash <= 0 ? '' : path.slice(0, slash)
}

/** 人类可读的体积（技能包里常见 KB 级小图与 MB 级演示资源）。 */
export function formatBytes(size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** markdown 里相对图片的改写上下文（技能名 + 当前文件目录）。 */
export interface RawBase {
  skillName: string
  dir: string
}

/**
 * 行内 markdown → HTML。
 *
 * ⚠ 链接分支必须用 escapeAttr，不能用 escapeHtml（2026-10-17 修 XSS）：
 * 原来写的是 `href="$2"`，而 `$2` 只要求 https?: 开头、**完全没有转义双引号**。
 * 一条 `[x](https://a.test/" onmouseover="alert(1))` 就能闭合 href 属性、
 * 凭空长出事件处理器；这段 HTML 随后经 dangerouslySetInnerHTML 注入。
 * 技能文件内容可由第三方技能包控制（zip / 文件夹上传安装），属于不受信输入，
 * 用户点开预览即触发。
 *
 * 顺带把 URL 也按白名单再筛一次：正则本身只放 https?:，但这里再确认一遍协议，
 * 防止未来有人放宽正则时把 javascript: 带进来。
 *
 * **图片分支**（2026-10-20 补）：SKILL.md 里的 `![](assets/logo.png)` 是**相对**
 * 技能目录的路径，浏览器会拿面板地址去解析，必然 404 —— 用户看到的是一个裂图。
 * 这里把相对路径改写成 host 的 raw 子路由（只有它知道技能目录在哪）。
 * 只放行图片扩展名，其余相对链接一律退回纯文本。
 *
 * @param s - 单行文本。
 * @param rawBase - 当前技能 + 文件所在目录；缺省时相对图片原样退回文本。
 * @returns 可直接拼进 HTML 的字符串（所有插值位置均已转义）。
 */
export function inlineMd(s: string, rawBase?: RawBase): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (all, alt: string, rawSrc: string) => {
      const src = rawSrc.replace(/&amp;/g, '&')
      // 外链图片保持原样（技能文档里常见 shields.io 徽章）。
      if (/^https?:\/\//i.test(src)) {
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async">`
      }
      if (rawBase === undefined) return escapeHtml(all)
      // 只认图片扩展名：避免把 `![](../../secrets.txt)` 之类当资源读。
      const rel = src.replace(/^\.\//, '')
      if (!/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(rel)) return escapeHtml(all)
      const target = rel.startsWith('/') ? rel.slice(1) : joinRelative(rawBase.dir, rel)
      return `<img src="${escapeAttr(skillRawUrl(rawBase.skillName, target))}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async">`
    })
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_all, label: string, rawUrl: string) => {
      // 正则捕获里已带 & 转义（escapeHtml 先跑），这里还原后再交给 URL 校验。
      const url = rawUrl.replace(/&amp;/g, '&')
      if (!/^https?:\/\//i.test(url)) return escapeHtml(label)
      return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
    })
}

/**
 * 极简 markdown → HTML（frontmatter 隐藏；标题 / 列表 / 代码块 / 引用 / 粗体 /
 * 行内代码 / 链接 / 图片）。
 *
 * @param text - 文件正文。
 * @param rawBase - 技能名 + 当前文件目录；给了它才能把相对图片改写到 raw 子路由。
 * @returns 可直接注入的 HTML。
 */
export function renderSkillMarkdown(text: string, rawBase?: RawBase): string {
  const body = String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = body.split('\n')
  let html = ''
  let inCode = false
  let codeBuf: string[] = []
  let inList = false
  let inQuote = false
  const closeList = (): void => {
    if (inList) { html += '</ul>'; inList = false }
  }
  const closeQuote = (): void => {
    if (inQuote) { html += '</blockquote>'; inQuote = false }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (inCode) {
        html += '<pre>' + escapeHtml(codeBuf.join('\n')) + '</pre>'
        codeBuf = []
        inCode = false
      } else {
        closeList(); closeQuote()
        inCode = true
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    if (trimmed === '---' || trimmed === '***') {
      closeList(); closeQuote()
      html += '<hr>'
      continue
    }
    if (trimmed.startsWith('>')) {
      if (!inQuote) { closeList(); html += '<blockquote>'; inQuote = true }
      html += '<p>' + inlineMd(trimmed.replace(/^>\s?/, ''), rawBase) + '</p>'
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      closeList(); closeQuote()
      // 直接用真实层级（# → h1 …… ###### → h6）：查看器字号一档一档拉得开，
      // 旧写法把 # 压成 h3，一级标题只有 15px，整篇文档看起来像没放大。
      const level = Math.min(heading[1].length, 6)
      html += `<h${String(level)}>` + inlineMd(heading[2], rawBase) + `</h${String(level)}>`
      continue
    }
    const item = /^[-*]\s+(.*)$/.exec(trimmed)
    if (item !== null) {
      if (!inList) { closeQuote(); html += '<ul>'; inList = true }
      html += '<li>' + inlineMd(item[1], rawBase) + '</li>'
      continue
    }
    closeList(); closeQuote()
    if (trimmed === '') { html += '<p></p>'; continue }
    html += '<p>' + inlineMd(trimmed, rawBase) + '</p>'
  }
  closeList(); closeQuote()
  if (inCode) html += '<pre>' + escapeHtml(codeBuf.join('\n')) + '</pre>'
  return html
}
