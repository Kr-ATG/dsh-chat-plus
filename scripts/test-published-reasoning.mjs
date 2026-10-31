/**
 * dsh-chat-plus — 供应商 /models 公布推理等级解析回归测试（纯 Node ESM）。
 *
 * 覆盖 published-reasoning.ts 的三件事：
 *   1. publishedReasoningOf：magpie 的 reasoning_levels / OpenAI 的
 *      supported_reasoning_levels / OpenRouter 的 reasoning 对象三种形态；
 *      「只声明支持没给档位」「明确不支持」「空档位表」的区分；
 *   2. modelListOf：data 数组 / models 数组 / models 对象 map / 裸数组；
 *   3. pickModelEntry：id 精确、id 大小写、name / display_name、找不到。
 *
 * 样本取自真实网关响应（2026-10-31 实测 alymagpie / vpsmagpie / openrouter /
 * sensenova），不是凭空编的字段。
 *
 * Usage: node scripts/test-published-reasoning.mjs
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

let failed = 0
const check = (condition, message) => {
  if (condition) console.log('ok    ' + message)
  else {
    failed += 1
    console.error('FAIL  ' + message)
  }
}

const moduleUrl = pathToFileURL(resolve(ROOT, 'src/provider/modules/published-reasoning.ts')).href
let publishedReasoningOf
let modelListOf
let pickModelEntry
try {
  ({ publishedReasoningOf, modelListOf, pickModelEntry } = await import(moduleUrl))
} catch (error) {
  console.error('FAIL  无法加载 published-reasoning.ts：' + String(error?.message ?? error))
  process.exitCode = 1
  process.exit()
}

// ── 1. 真实条目：magpie 网关（alymagpie）──────────────────────────────
const magpie = {
  id: 'auto/deepseek-v4.1-flash',
  display_name: 'Deepseek-V4.1-Flash',
  reasoning: true,
  reasoning_levels: ['low', 'high', 'max'],
  supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }],
  context_length: 1000000,
}
const magpieOut = publishedReasoningOf(magpie)
check(magpieOut !== null, 'magpie 条目解析出公布信息')
check(magpieOut?.levelsKnown === true, 'magpie levelsKnown = true')
check(JSON.stringify(magpieOut?.levels) === JSON.stringify(['low', 'high', 'max']), 'magpie 档位 = low/high/max（按升序归一）')
check(magpieOut?.offWire === null, 'magpie 没有 none 档：off 走省略参数')
check(magpieOut?.nonReasoning === false, 'magpie 不是非推理模型')
check((magpieOut?.sources ?? []).includes('reasoning_levels'), 'magpie sources 含 reasoning_levels')

// ── 2. 真实条目：vpsmagpie（档位不同）────────────────────────────────
const vps = { id: 'antigravity/gemini-3.8-flash', reasoning: true, reasoning_levels: ['low', 'medium', 'high'], supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }] }
const vpsOut = publishedReasoningOf(vps)
check(JSON.stringify(vpsOut?.levels) === JSON.stringify(['low', 'medium', 'high']), 'vpsmagpie 档位 = low/medium/high')

// ── 3. 真实条目：OpenRouter 的 reasoning 对象形态 ────────────────────
const openrouter = { id: 'particle-ai/particle-1', reasoning: { mandatory: false, default_enabled: true, supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'], default_effort: 'high' } }
const orOut = publishedReasoningOf(openrouter)
check(orOut?.levelsKnown === true, 'OpenRouter supported_efforts 视为已公布档位')
check(JSON.stringify(orOut?.levels) === JSON.stringify(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']), 'OpenRouter 全档归一')
check(orOut?.offWire === 'none', 'OpenRouter 含 none：off 走线值 none')

// ── 4. 真实条目：sensenova 没有推理字段 ──────────────────────────────
const sensenova = { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', supported_features: ['tools', 'json_mode', 'reasoning'], context_length: 1048576 }
check(publishedReasoningOf(sensenova) === null, 'sensenova 无推理字段 → null（回落实测）')

// ── 5. 边界形态 ──────────────────────────────────────────────────────
check(publishedReasoningOf({ id: 'x', reasoning: false })?.nonReasoning === true, 'reasoning:false → 明确非推理')
const emptyLevels = publishedReasoningOf({ id: 'x', reasoning_levels: [] })
check(emptyLevels?.levelsKnown === true && emptyLevels?.nonReasoning === true, 'reasoning_levels:[] → 已公布且无推理档')
const supportOnly = publishedReasoningOf({ id: 'x', reasoning: true })
check(supportOnly?.declared === true && supportOnly?.levelsKnown === false && (supportOnly?.levels ?? []).length === 0, '只写 reasoning:true → 已声明但档位未知')
const stringLevels = publishedReasoningOf({ id: 'x', supported_reasoning_levels: ['high', 'low'] })
check(JSON.stringify(stringLevels?.levels) === JSON.stringify(['low', 'high']), 'supported_reasoning_levels 字符串数组也能解析')
const unknownLevel = publishedReasoningOf({ id: 'x', reasoning_levels: ['turbo', 'high'] })
check(JSON.stringify(unknownLevel?.levels) === JSON.stringify(['high']), '未知档位名被忽略，不污染档位表')

// ── 6. modelListOf 的四种响应形态 ────────────────────────────────────
check(modelListOf({ data: [{ id: 'a' }] }).length === 1, 'modelListOf: OpenAI data 数组')
check(modelListOf({ models: [{ id: 'a' }] }).length === 1, 'modelListOf: models 数组')
check(modelListOf({ models: { a: { id: 'a' }, b: { id: 'b' } } }).length === 2, 'modelListOf: models 对象 map')
check(modelListOf([{ id: 'a' }, { id: 'b' }]).length === 2, 'modelListOf: 裸数组')
check(modelListOf({ result: [{ id: 'a' }] }).length === 1, 'modelListOf: result 数组')
check(modelListOf({ error: 'nope' }).length === 0, 'modelListOf: 无清单字段 → 空')

// ── 7. pickModelEntry 的匹配顺序 ─────────────────────────────────────
const list = [
  { id: 'auto/deepseek-v4.1-flash', display_name: 'Deepseek Flash' },
  { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash' },
]
check(pickModelEntry(list, 'auto/deepseek-v4.1-flash')?.id === 'auto/deepseek-v4.1-flash', 'pickModelEntry: id 精确命中')
check(pickModelEntry(list, 'deepseek-v4.1-flash')?.id === 'DeepSeek-V4.1-Flash', 'pickModelEntry: id 大小写不敏感')
check(pickModelEntry(list, 'Deepseek Flash')?.id === 'auto/deepseek-v4.1-flash', 'pickModelEntry: display_name 命中')
check(pickModelEntry(list, 'not-there') === null, 'pickModelEntry: 找不到 → null')
check(pickModelEntry(list, '') === null, 'pickModelEntry: 空 id → null')

if (failed > 0) {
  console.error('\n' + failed + ' 项失败')
  process.exitCode = 1
} else {
  console.log('\n全部通过')
}
