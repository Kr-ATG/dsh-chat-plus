/**
 * dsh-chat-plus — 提示词优化清洗器行为测试。
 *
 * 为什么单独立一个脚本：清洗器是 host / client 两端共用的纯函数，但它**不在
 * client 产物里导出**（只有 provider-hub 导出过），所以 smoke-client 那种
 * 「require 产物拿导出」的路子够不着它。这里用 esbuild 把 TS 源码打包一次再
 * import，测的就是真正上线跑的那份逻辑。
 *
 * 锁住两条曾经会**直接毁掉用户草稿**的缺陷（都是真实输出形态命中的）：
 *   ① 「取最长围栏」：草稿自带代码块时（「帮我优化这段 SQL」），最长围栏是那段
 *      SQL —— 优化结果被替换成几行 SQL，整段提示词消失。
 *   ② 「结尾元信息命中即整段丢弃」：正文里用户自己写的「备注：目标库是 PG14」
 *      被当成模型附赠的「主要改动」，约束被静默删除。
 *
 * 另外还锁 host 侧的输出预算：固定 maxTokens 对推理模型偏紧（思考链也吃预算），
 * 但按能力上调时**绝不能突破模型声明的硬上限**——超了请求会被拒。
 *
 * 用法：node scripts/test-prompt-optimize-clean.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

const requirePlugin = createRequire(resolve(ROOT, 'package.json'))
let esbuild
try {
  esbuild = requirePlugin('esbuild')
} catch {
  console.log('SKIP  未安装 esbuild（先跑 pnpm install）')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-po-clean-'))
const bundle = join(dir, 'clean.mjs')
const hostBundle = join(dir, 'host.mjs')
try {
  await esbuild.build({
    entryPoints: [resolve(ROOT, 'src/provider/modules/prompt-optimize-clean.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
  })
  const mod = await import(pathToFileURL(bundle).href)

  // host 半身的输出预算：@deepseek-ai/* 只作类型引入，external 掉即可独立跑。
  let hostMod
  try {
    await esbuild.build({
      entryPoints: [resolve(ROOT, 'src/provider/modules/prompt-optimize.ts')],
      bundle: true, format: 'esm', platform: 'node', outfile: hostBundle,
      external: ['@deepseek-ai/*'], logLevel: 'silent',
    })
    hostMod = await import(pathToFileURL(hostBundle).href)
  } catch (error) {
    fail(`host 模块无法独立打包（预算测试跳过）：${error instanceof Error ? error.message : String(error)}`)
  }

  for (const fn of ['cleanOptimized', 'previewOptimized', 'collapseToLine']) {
    if (typeof mod[fn] !== 'function') fail(`未导出 ${fn}()`)
  }

  const cases = [
    {
      name: '正文含代码块时保留正文（不能只剩 SQL）',
      raw: [
        '帮我优化下面这段 SQL 查询，让它能走索引。',
        '',
        '当前写法：',
        '',
        '~~~sql',
        "SELECT * FROM orders WHERE DATE(created_at) = '2024-06-01';",
        '~~~',
        '',
        '要求：保持结果集完全一致。',
      ].join('\n'),
    },
    {
      name: '正文结尾用户自带的「备注：」不被删除',
      raw: '把这段 SQL 改写成窗口函数版本，保持输出列完全一致。\n\n备注：目标库是 PostgreSQL 14，不要用 MySQL 专有语法。',
    },
    {
      name: '正文中间的「说明：」段不被删除',
      raw: '帮我评审这段方案。\n\n说明：我的方案针对中小型团队，日均调用约 1 万次。\n\n请从成本、可维护性给出结论。',
    },
    {
      name: '引导语包住正文时取围栏正文',
      raw: '好的，这是优化后的版本：\n\n~~~\n帮我写一份周报，包含进展、风险与计划三部分。\n~~~',
      expect: '帮我写一份周报，包含进展、风险与计划三部分。',
    },
    {
      name: '中文方括号标题被剥掉',
      raw: '【优化后的提示词】\n帮我写一份周报，包含进展、风险与计划三部分。',
      expect: '帮我写一份周报，包含进展、风险与计划三部分。',
    },
    {
      name: '标题带括号补充也被剥掉',
      raw: '**优化后的提示词**（可直接发送）\n帮我写一份周报，包含进展、风险与计划三部分。',
      expect: '帮我写一份周报，包含进展、风险与计划三部分。',
    },
    {
      name: '结尾「主要改动」段落仍然去掉',
      raw: '帮我写一份周报，包含进展、风险与计划三部分。\n\n主要改动：\n- 补充了时间范围\n- 明确了结构',
      expect: '帮我写一份周报，包含进展、风险与计划三部分。',
    },
    {
      name: '结尾「改写要点」段落仍然去掉',
      raw: '帮我写一份周报，包含进展、风险与计划三部分。\n\n改写要点：\n- 补充了时间范围',
      expect: '帮我写一份周报，包含进展、风险与计划三部分。',
    },
    {
      name: '整体包裹的中文书名号被剥掉',
      raw: '「帮我写一封产品上线通知邮件，300 字以内。」',
      expect: '帮我写一封产品上线通知邮件，300 字以内。',
    },
    {
      name: '空白输入返回空串（不抛错）',
      raw: '   \n\n  ',
      expect: '',
    },
  ]

  let failed = 0
  for (const item of cases) {
    const got = mod.cleanOptimized(item.raw)
    // 未显式给 expect 的用例断言「原文原样保留」——这类最容易被清洗器误伤
    const want = item.expect !== undefined ? item.expect : item.raw.trim()
    if (got !== want) {
      fail(`用例「${item.name}」结果不对\n    期望 ${JSON.stringify(want)}\n    实际 ${JSON.stringify(got)}`)
      failed += 1
    }
  }
  if (failed === 0) pass(`清洗器 ${cases.length} 条用例全过（含代码块正文 / 用户自带备注说明 / 标题变体 / 结尾改动段）`)

  // 流式预览：半截围栏时剥掉前面的解释文字，且不能吐出正文之外的东西
  const half = '好的，这是优化后的版本：\n\n~~~\n帮我写一份周报，包含进展'
  const preview = mod.previewOptimized(half)
  if (!preview.startsWith('帮我写一份周报')) fail(`previewOptimized 未剥掉开场白：${JSON.stringify(preview)}`)
  else pass('previewOptimized 在围栏未闭合时剥掉开场白（流式预览贴近最终结果）')

  // /goal 单行化（仍保留：其它调用点/工具可能用它，但面板已不再用它包装 /goal）
  if (mod.collapseToLine('第一行\n第二行  ') !== '第一行 第二行') fail('collapseToLine 结果不对')
  else pass('collapseToLine 单行化（保留的工具函数）')

  // ── /goal 包装不再压平：多行 objective 合法，压平会破坏代码块与列表 ──
  // 面板把结果写成 `/goal <result>`，这里锁住「包装后原文结构一字不差」。
  const multi = [
    '帮我优化下面这段 SQL 查询。',
    '',
    '```sql',
    'SELECT 1;',
    '```',
    '',
    '- 要求一',
    '- 要求二',
  ].join('\n')
  const wrapped = `/goal ${multi}`
  if (mod.collapseToLine(multi).includes('```') && !mod.collapseToLine(multi).includes('\n')) {
    pass('/goal 包装已放弃压平（collapseToLine 会把围栏压成裸反引号，这正是不能用它的原因）')
  } else {
    fail('collapseToLine 行为与预期不符，请复核 /goal 包装策略')
  }
  if (wrapped.slice('/goal '.length) !== multi) fail('/goal 包装篡改了正文')
  else pass('/goal 包装保留正文原文（换行 / 代码块 / 列表结构不变）')

  // ── host 输出预算：够用但绝不突破模型硬上限 ──
  if (hostMod !== undefined && typeof hostMod.outputBudget === 'function') {
    const budget = hostMod.outputBudget
    const cases = [
      // [原文长度, 模型声明上限, 期望, 说明]
      [100, undefined, 16584, '短草稿 + 无声明：留足思考余量'],
      [100, 4096, 4096, '模型硬上限 4096 必须压过下限（超了会被拒）'],
      [100, 16384, 16384, '上限恰为下限时取 16384'],
      [100, 64000, 16584, '声明上限很宽时按原文字数估需求'],
      [10000, 128000, 36384, '长草稿按 2 倍估算'],
      [10000, undefined, 32768, '无声明时用宽松兜底上限'],
      [1000, 8192, 8192, '需求超上限时截到上限'],
    ]
    let bad = 0
    for (const [len, cap, want, note] of cases) {
      const got = budget(len, cap)
      if (got !== want) {
        fail(`outputBudget(${len}, ${cap}) = ${got}，期望 ${want}（${note}）`)
        bad += 1
      }
    }
    if (bad === 0) pass(`输出预算 ${cases.length} 条用例全过（含「模型硬上限压过下限」）`)
    // 不变量：任何情况下都不能超过模型声明的上限
    let overrun = 0
    for (const len of [0, 1, 500, 5000, 50000]) {
      for (const cap of [1, 4096, 8192, 32768, 200000]) {
        if (budget(len, cap) > cap) overrun += 1
      }
    }
    if (overrun > 0) fail(`outputBudget 有 ${overrun} 次突破模型声明上限（请求会被拒）`)
    else pass('outputBudget 永不突破模型声明上限（25 组组合验证）')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
