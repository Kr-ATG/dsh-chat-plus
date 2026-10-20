/**
 * skill-preview — 技能文件预览判据的单元测试（纯函数，无 DOM / 无 React）。
 *
 * 针对用户 2026-10-20 反馈「技能查看器点开 PNG 是乱码」：那条链路修了三处，
 * 这里是客户端那一处（按类型分派 + 相对图片改写）的守门测试。
 *
 * Usage: node scripts/test-skill-preview.mjs
 */

import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const requirePlugin = createRequire(resolve(ROOT, 'package.json'))
const esbuild = requirePlugin('esbuild')

/**
 * 转译 src 下的两个 TS 模块并保持它们的相对位置。
 *
 * 为什么要保持目录结构：skill-preview.ts 里 `import ... from
 * '../../../../shared/sanitize-html.ts'` 是相对路径，转译后原样保留；
 * 把两个产物平铺到同一目录里就解析不到了。
 *
 * @param from - 源模块相对 ROOT 的路径。
 * @returns 转译后的 mjs 绝对路径。
 */
async function compile(from) {
  const output = join(dir, from).replace(/\.ts$/, '.mjs')
  mkdirSync(dirname(output), { recursive: true })
  const source = readFileSync(resolve(ROOT, from), 'utf8')
  const compiled = await esbuild.transform(source, { loader: 'ts', format: 'esm', target: 'node22' })
  // import 里写的是 .ts 后缀；Node 只认 .mjs，改掉。
  writeFileSync(output, compiled.code.replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.mjs$2'))
  return output
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-skillprev-'))
await compile('src/shared/sanitize-html.ts')
const entry = await compile('src/client/triad/usage/dashboard/skill-preview.ts')
const mod = await import(pathToFileURL(entry).href)

let failed = 0
function check(cond, msg) {
  if (cond) { console.log(`ok    ${msg}`) } else { failed += 1; console.error(`FAIL  ${msg}`) }
}

// ── 1. 扩展名判据
check(mod.extName('assets/composer-icon.png') === 'png', 'extName 取小写扩展名')
check(mod.extName('assets/LOGO.PNG') === 'png', 'extName 大小写归一')
check(mod.extName('SKILL.md') === 'md', 'extName 认 SKILL.md')
check(mod.extName('Makefile') === '', 'extName 无扩展名返回空串')
check(mod.extName('assets/.hidden') === '', 'extName 点开头文件不算扩展名')

// ── 2. 二进制文件分派（乱码问题的核心）
check(mod.mediaKindOf('assets/composer-icon.png') === 'image', 'PNG → image')
check(mod.mediaKindOf('a/logo.svg') === 'image', 'SVG → image')
check(mod.mediaKindOf('demo/clip.mp4') === 'video', 'MP4 → video')
check(mod.mediaKindOf('demo/voice.mp3') === 'audio', 'MP3 → audio')
check(mod.mediaKindOf('docs/manual.pdf') === 'pdf', 'PDF → pdf')
check(mod.mediaKindOf('bundle.zip') === 'none', 'ZIP 没有渲染器 → none（给原生链接，不硬渲染）')
check(mod.mediaKindOf('SKILL.md') === 'none', 'markdown 走文本路（不是媒体）')

// ── 3. raw 地址：逐段编码，不能把 / 编成 %2F
const url = mod.skillRawUrl('ego-browser', 'assets/composer-icon.png')
check(url === '/api/skill-manager/skills/ego-browser/raw/assets/composer-icon.png', 'raw 地址逐段编码（分隔符保留）')
const urlSpace = mod.skillRawUrl('my skill', 'assets/a b.png')
check(urlSpace.includes('/raw/assets/a%20b.png'), 'raw 地址对空格编码')
check(!urlSpace.includes('my skill'), 'raw 地址对技能名编码')

// ── 4. 相对路径归一
check(mod.joinRelative('assets', 'logo.png') === 'assets/logo.png', 'joinRelative 拼目录')
check(mod.joinRelative('assets', '../logo.png') === 'logo.png', 'joinRelative 处理 ../')
check(mod.joinRelative('', './a/b.png') === 'a/b.png', 'joinRelative 去掉 ./')
check(mod.joinRelative('a/b/c', '../../d.png') === 'a/d.png', 'joinRelative 多级回溯')
check(mod.joinRelative('', '../outside.png') === 'outside.png', 'joinRelative 越界归一到根（host 再拦一次）')
check(mod.dirNameOf('assets/composer-icon.png') === 'assets', 'dirNameOf 取目录')
check(mod.dirNameOf('SKILL.md') === '', 'dirNameOf 根目录返回空串')

// ── 5. 体积格式化
check(mod.formatBytes(512) === '512 B', 'formatBytes 字节')
check(mod.formatBytes(3967) === '3.9 KB', 'formatBytes KB')
check(mod.formatBytes(3 * 1024 * 1024) === '3.0 MB', 'formatBytes MB')
check(mod.formatBytes(undefined) === '', 'formatBytes 未知体积返回空串（不显示 undefined）')

// ── 6. markdown 里的相对图片改写到 raw 子路由（裂图问题的核心）
const rawBase = { skillName: 'ego-browser', dir: '' }
const imgHtml = mod.renderSkillMarkdown('# 标题\n\n![图标](assets/composer-icon.png)\n', rawBase)
check(imgHtml.includes('src="/api/skill-manager/skills/ego-browser/raw/assets/composer-icon.png"'),
  '相对图片改写成 raw 地址（不再裂图）')
check(imgHtml.includes('alt="图标"'), '相对图片保留 alt')
check(imgHtml.includes('loading="lazy"'), '相对图片带懒加载')

// 子目录里的文档引用同级图片：按文件所在目录解析
const nested = mod.renderSkillMarkdown('![x](logo.png)', { skillName: 's', dir: 'docs/sub' })
check(nested.includes('/raw/docs/sub/logo.png'), '相对图片按文件所在目录解析')

// 外链图片保持原样（技能文档里常见徽章）
const remote = mod.renderSkillMarkdown('![badge](https://img.shields.io/x.svg)', rawBase)
check(remote.includes('src="https://img.shields.io/x.svg"'), '外链图片不被改写')

// 没有 rawBase 时退回纯文本，绝不猜路径
const noBase = mod.renderSkillMarkdown('![x](assets/a.png)')
check(!noBase.includes('<img'), '缺 rawBase 时不渲染图片（避免错误路径）')

// ── 7. 安全：只放行图片扩展名，且属性值必须转义
const txt = mod.renderSkillMarkdown('![x](../../secrets.txt)', rawBase)
check(!txt.includes('<img'), '相对非图片路径不渲染（不当资源读）')
const xss = mod.renderSkillMarkdown('![x](assets/" onerror="alert(1).png)', rawBase)
check(!xss.includes('onerror="alert(1)"'), 'alt/src 转义：注入的属性长不出来')
const linkXss = mod.renderSkillMarkdown('[x](https://a.test/" onmouseover="alert(1))', rawBase)
check(!linkXss.includes('onmouseover="alert'), '外链转义：不能闭合 href 属性')

// ── 8. 文本 markdown 仍然正常（回归）
const md = mod.renderSkillMarkdown('---\nname: t\n---\n# 标题\n\n- 一\n- 二\n', rawBase)
check(!md.includes('name: t'), 'frontmatter 被隐藏')
check(md.includes('<h1>标题</h1>'), '标题渲染成真实层级')
check(md.includes('<li>一</li>'), '列表项渲染')

rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? '\nSKILL-PREVIEW TEST PASSED' : `\nSKILL-PREVIEW TEST FAILED (${String(failed)})`)
process.exit(failed === 0 ? 0 : 1)
