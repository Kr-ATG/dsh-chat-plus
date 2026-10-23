/**
 * dsh-chat-plus — 「@ 误判成文件芯片」修复的冒烟（纯判据）。
 *
 * 钉住两类判据，判错了都**不会抛错**：
 *  1. 什么算路径（looksLikePath）—— 判松了普通中文变芯片，判紧了真路径变文字；
 *  2. 抢位规则（buildGuardRule）—— 覆盖范围错一位，要么修不好，要么把整段文字吃掉。
 *
 * 为什么这两条必须断言：它们影响的是「用户发出去的话长什么样」，
 * 出错了界面上没有任何报错，只有一枚莫名其妙的蓝色芯片。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const toUrl = (rel) => new URL(rel, 'file:///' + ROOT.replace(/\\/g, '/') + '/').href
const at = await import(toUrl('src/client/running-apps/at-rule.ts'))

let failures = 0
function check(label, condition, detail) {
  if (condition) { console.log('  ok   ' + label); return }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

console.log('[at-guard] 什么算路径')
{
  // 应该算路径的
  check('带引号一律算', at.looksLikePath('a b.txt', true) === true)
  check('含 / 算', at.looksLikePath('src/main.ts', false) === true)
  check('含 \\ 算', at.looksLikePath('D:\\a\\b.txt', false) === true)
  check('含扩展名算', at.looksLikePath('README.md', false) === true)
  check('裸 ASCII 目录名算', at.looksLikePath('src', false) === true)
  check('裸 ASCII 文件名算', at.looksLikePath('LICENSE', false) === true)
  check('中文 + 分隔符算', at.looksLikePath('文档/说明', false) === true)
  check('中文 + 扩展名算', at.looksLikePath('笔记.md', false) === true)
  // 不该算路径的（这是 bug 本体）
  check('中文紧贴 @ 不算（bug 本体）', at.looksLikePath('的时候不是实时获取的', false) === false)
  check('中文短词不算', at.looksLikePath('然后', false) === false)
  check('中文带标点不算', at.looksLikePath('帮我看看这个', false) === false)
  check('空串不算', at.looksLikePath('', false) === false)
  check('单个 ASCII 字符不算', at.looksLikePath('a', false) === false)
  check('纯数字小数不算扩展名', at.looksLikePath('3.5', false) === false)
}

console.log('[at-guard] 抢位规则覆盖范围')
{
  const rule = at.buildGuardRule()
  check('规则 id 与官方不同', rule.id !== 'file' && rule.id !== 'folder', rule.id)
  check('order 小于官方（30）', rule.order < 30, String(rule.order))

  const text = '@的时候不是实时获取的'
  const hit = rule.match(text, 0)
  check('中文 @ 命中', hit !== undefined, JSON.stringify(hit))
  check('只覆盖 @ 一个字符', hit.start === 0 && hit.end === 1, JSON.stringify(hit))
  check('返回 text 节点（渲染成普通文字）', hit.id === 'text')
  check('text 节点保留原文', hit.data.text === '@')

  // 真路径不该被盖
  check('真路径不命中', rule.match('@src/main.ts 看看', 0) === undefined)
  check('带引号路径不命中', rule.match('@"a b.txt"', 0) === undefined)
  check('裸目录名不命中', rule.match('@src 看看', 0) === undefined)

  // 行中间的 @ 不该命中（官方 (?<!\\S) 的前提）
  check('邮箱里的 @ 不命中', rule.match('a@b.com', 0) === undefined)

  // 多个 @：第一个是中文，第二个是真路径
  const mixed = '@你好 然后 @README.md'
  const first = rule.match(mixed, 0)
  check('混合场景只盖第一个', first !== undefined && first.start === 0, JSON.stringify(first))
  const second = rule.match(mixed, first.end)
  check('混合场景不盖真路径', second === undefined, JSON.stringify(second))
}

console.log('[at-guard] 装配')
{
  const src = readFileSync(resolve(ROOT, 'src/client/index.ts'), 'utf8')
  check('client 入口装配了 guard', src.includes('applyAtGuard'))
  check('guard 走 guarded 容错', src.includes("guarded(ctx, 'running apps @ guard'"))
  const mod = readFileSync(resolve(ROOT, 'src/client/running-apps/at-rule.ts'), 'utf8')
  check('通过 uiConversation.userText.register 注册', mod.includes('uiConversation') && mod.includes('register'))
  check('缺服务时静默降级', mod.includes('console.warn'))
}

if (failures > 0) {
  console.error('\n[at-guard] ' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n[at-guard] 全部通过')
